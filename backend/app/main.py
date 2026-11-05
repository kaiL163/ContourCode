from __future__ import annotations
import os, json, time, hmac, hashlib, base64
import asyncio
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any
from fastapi import FastAPI, HTTPException, Depends, Header, WebSocket, WebSocketDisconnect, BackgroundTasks
from pydantic import BaseModel, Field

app = FastAPI(title='КонтурКод API', version='1')

def _secret():
    return os.getenv('JWT_SECRET') or os.getenv('TOKEN_SECRET') or 'local-demo-secret-change-me'

def _contest_finished(starts_at, duration_minutes, now=None):
    from datetime import timedelta
    return (now or datetime.now(timezone.utc)) >= starts_at + timedelta(minutes=duration_minutes)

def _score_match(participants, submissions):
    first = {}
    for uid, task_id, verdict, elapsed in submissions:
        if verdict == 'OK': first.setdefault((uid, task_id), elapsed)
    return [{'user_id': uid, 'solved': sum(1 for (u, _), _t in first.items() if u == uid),
             'elapsed_seconds': sum(t for (u, _), t in first.items() if u == uid)} for uid in participants]

class MatchSockets:
    def __init__(self): self.clients = {}
    async def add(self, mid, ws): self.clients.setdefault(mid, set()).add(ws)
    def remove(self, mid, ws): self.clients.get(mid, set()).discard(ws)
    async def broadcast(self, mid):
        for ws in list(self.clients.get(mid, ())):
            try:
                user = ws.state.match_user
                await ws.send_json({'type':'match.updated','match':_match(mid,user)})
            except Exception: self.remove(mid, ws)

match_sockets = MatchSockets()

async def _finish_match_at(mid, ends_at, user):
    delay=max(0, (ends_at-datetime.now(timezone.utc)).total_seconds())
    await asyncio.sleep(delay)
    state=_match(mid,user)
    if state['status']=='finished': await match_sockets.broadcast(mid)


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip('=')

def issue_token(user: dict) -> str:
    payload = _b64(json.dumps({'uid': user['id'], 'exp': int(time.time()) + 43200}, separators=(',', ':')).encode())
    sig = _b64(hmac.new(_secret().encode(), payload.encode(), hashlib.sha256).digest())
    return payload + '.' + sig

def decode_token(token: str) -> int:
    try:
        payload, sig = token.split('.', 1)
        expected = _b64(hmac.new(_secret().encode(), payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected): raise ValueError()
        data = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
        if data['exp'] < time.time(): raise ValueError()
        return int(data['uid'])
    except Exception as exc: raise HTTPException(401, 'Неверный или истёкший токен') from exc

@contextmanager
def connection():
    try:
        import psycopg
        conn = psycopg.connect(os.getenv('DATABASE_URL', 'postgresql://kontur:localtest@localhost:55432/kontur'))
    except Exception as exc:
        raise HTTPException(503, 'База данных недоступна') from exc
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback(); raise
    finally: conn.close()

def user_by_id(uid: int):
    with connection() as c:
        row = c.execute('SELECT id, username, display_name, role FROM users WHERE id=%s', (uid,)).fetchone()
    if not row: raise HTTPException(401, 'Пользователь не найден')
    return dict(zip(('id','username','display_name','role'), row))

def current_user(authorization: str | None = Header(default=None)):
    if not authorization or not authorization.startswith('Bearer '): raise HTTPException(401, 'Требуется Bearer токен')
    return user_by_id(decode_token(authorization[7:]))

def require_role(*roles):
    def dep(user=Depends(current_user)):
        if user['role'] not in roles: raise HTTPException(403, 'Недостаточно прав')
        return user
    return dep

class Login(BaseModel): username: str; password: str
class TaskIn(BaseModel): title:str; statement:str; time_limit_ms:int=Field(gt=0); memory_limit_kb:int=Field(gt=0); tests:list[dict]=Field(min_length=1)
class ContestIn(BaseModel): title:str; description:str=''; starts_at:datetime; duration_minutes:int=Field(gt=0); task_ids:list[int]
class RegisterIn(BaseModel): pass
class SubmissionIn(BaseModel): contest_id:int; task_id:int; source_code:str=Field(min_length=1,max_length=100000); match_id:int|None=None
class MatchIn(BaseModel): mode:str; contest_id:int
class JoinIn(BaseModel): invite_code:str

@app.get('/api/health')
def health(): return {'status':'ok'}

@app.on_event('startup')
def startup_migrations():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1] / 'migrations'
    with connection() as c:
        c.execute('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
        for path in sorted(root.glob('*.sql')):
            if c.execute('SELECT 1 FROM schema_migrations WHERE name=%s', (path.name,)).fetchone(): continue
            c.execute(path.read_text(encoding='utf-8'))
            c.execute('INSERT INTO schema_migrations(name) VALUES(%s)', (path.name,))

@app.post('/api/auth/login')
def login(body: Login):
    with connection() as c:
        row=c.execute('SELECT id, username, display_name, role, password_hash FROM users WHERE username=%s',(body.username,)).fetchone()
    if not row: raise HTTPException(401,'Неверные учётные данные')
    # PBKDF2 encoded values: pbkdf2$iterations$salt_hex$digest_hex
    try:
        _, rounds, salt, digest=row[4].split('$')
        actual=hashlib.pbkdf2_hmac('sha256',body.password.encode(),bytes.fromhex(salt),int(rounds)).hex()
        if not hmac.compare_digest(actual,digest): raise ValueError()
    except Exception: raise HTTPException(401,'Неверные учётные данные')
    user=dict(zip(('id','username','display_name','role'),row[:4]))
    return {'access_token':issue_token(user),'token_type':'bearer','user':user}

@app.get('/api/auth/me')
def me(user=Depends(current_user)): return user

@app.get('/api/tasks')
def tasks(user=Depends(current_user)):
    with connection() as c: rows=c.execute('SELECT id,title,statement,time_limit_ms,memory_limit_kb FROM tasks ORDER BY id').fetchall()
    return [dict(zip(('id','title','statement','time_limit_ms','memory_limit_kb'),r),tests=[]) for r in rows]

@app.get('/api/tasks/{task_id}')
def task(task_id:int,user=Depends(current_user)):
    with connection() as c:
        r=c.execute('SELECT id,title,statement,time_limit_ms,memory_limit_kb FROM tasks WHERE id=%s',(task_id,)).fetchone()
        if not r: raise HTTPException(404,'Задача не найдена')
        tests=c.execute('SELECT input,output,is_hidden FROM task_tests WHERE task_id=%s ORDER BY id',(task_id,)).fetchall()
        owner=c.execute('SELECT EXISTS(SELECT 1 FROM tasks t WHERE t.id=%s AND t.owner_id=%s) OR EXISTS(SELECT 1 FROM contests c JOIN contest_tasks ct ON ct.contest_id=c.id WHERE ct.task_id=%s AND c.organizer_id=%s)',(task_id,user['id'],task_id,user['id'])).fetchone()[0]
    return dict(zip(('id','title','statement','time_limit_ms','memory_limit_kb'),r), tests=[{'input':x[0],'output':x[1]} for x in tests if owner or not x[2]])

@app.post('/api/tasks',status_code=201)
def create_task(body:TaskIn,user=Depends(require_role('organizer'))):
    with connection() as c:
        r=c.execute('INSERT INTO tasks(title,statement,time_limit_ms,memory_limit_kb,owner_id) VALUES(%s,%s,%s,%s,%s) RETURNING id',(body.title,body.statement,body.time_limit_ms,body.memory_limit_kb,user['id'])).fetchone()
        for t in body.tests:
            if not isinstance(t.get('input'),str) or not isinstance(t.get('output'),str): raise HTTPException(422,'Каждый тест должен содержать input/output')
            c.execute('INSERT INTO task_tests(task_id,input,output,is_hidden) VALUES(%s,%s,%s,%s)',(r[0],t['input'],t['output'],bool(t.get('hidden',False))))
    return {'id':r[0],'title':body.title,'statement':body.statement,'time_limit_ms':body.time_limit_ms,'memory_limit_kb':body.memory_limit_kb,'tests':body.tests}

@app.get('/api/contests')
def contests(user=Depends(current_user)):
    with connection() as c:
        rows=c.execute('SELECT id,title,description,starts_at,duration_minutes,organizer_id FROM contests ORDER BY id').fetchall()
        out=[]
        for r in rows:
            ids=[x[0] for x in c.execute('SELECT task_id FROM contest_tasks WHERE contest_id=%s ORDER BY task_id',(r[0],)).fetchall()]
            reg=c.execute('SELECT EXISTS(SELECT 1 FROM registrations WHERE contest_id=%s AND user_id=%s)',(r[0],user['id'])).fetchone()[0]
            out.append(dict(zip(('id','title','description','starts_at','duration_minutes','organizer_id'),r),task_ids=ids,registered=reg))
    return out

@app.post('/api/contests',status_code=201)
def create_contest(body:ContestIn,user=Depends(require_role('organizer'))):
    with connection() as c:
        r=c.execute('INSERT INTO contests(title,description,starts_at,duration_minutes,organizer_id) VALUES(%s,%s,%s,%s,%s) RETURNING id',(body.title,body.description,body.starts_at,body.duration_minutes,user['id'])).fetchone()
        for tid in set(body.task_ids):
            if not c.execute('SELECT 1 FROM tasks WHERE id=%s',(tid,)).fetchone(): raise HTTPException(404,'Задача не найдена')
            c.execute('INSERT INTO contest_tasks(contest_id,task_id) VALUES(%s,%s)',(r[0],tid))
    return {'id':r[0],'title':body.title,'description':body.description,'starts_at':body.starts_at,'duration_minutes':body.duration_minutes,'task_ids':body.task_ids,'organizer_id':user['id'],'registered':False}

@app.get('/api/contests/{cid}')
def get_contest(cid:int,user=Depends(current_user)):
    result=next((x for x in contests(user) if x['id']==cid),None)
    if not result: raise HTTPException(404,'Контест не найден')
    return result

@app.post('/api/contests/{cid}/register',status_code=201)
def register(cid:int,user=Depends(require_role('participant'))):
    with connection() as c:
        if not c.execute('SELECT 1 FROM contests WHERE id=%s',(cid,)).fetchone(): raise HTTPException(404,'Контест не найден')
        c.execute('INSERT INTO registrations(contest_id,user_id) VALUES(%s,%s) ON CONFLICT DO NOTHING',(cid,user['id']))
    return {'registered':True}

@app.get('/api/contests/{cid}/standings')
def standings(cid:int,user=Depends(current_user)):
    with connection() as c:
        if not c.execute('SELECT 1 FROM contests WHERE id=%s',(cid,)).fetchone(): raise HTTPException(404,'Контест не найден')
        rows=c.execute("WITH first_ok AS (SELECT DISTINCT ON (user_id,task_id) user_id,task_id,created_at FROM submissions WHERE contest_id=%s AND verdict='OK' ORDER BY user_id,task_id,created_at,id) SELECT u.id,u.display_name,count(f.task_id)::int solved,COALESCE(sum(EXTRACT(EPOCH FROM (f.created_at-co.starts_at))),0)::int elapsed FROM registrations r JOIN users u ON u.id=r.user_id JOIN contests co ON co.id=r.contest_id LEFT JOIN first_ok f ON f.user_id=r.user_id WHERE r.contest_id=%s GROUP BY u.id,u.display_name,co.starts_at ORDER BY solved DESC,elapsed,u.id",(cid,cid)).fetchall()
    return {'contest_id':cid,'rows':[{'user_id':r[0],'display_name':r[1],'solved':r[2],'elapsed_seconds':r[3],'rank':i+1} for i,r in enumerate(rows)]}

@app.post('/api/submissions',status_code=202)
def submit(body:SubmissionIn,background_tasks:BackgroundTasks,user=Depends(require_role('participant'))):
    now=datetime.now(timezone.utc)
    with connection() as c:
        q=c.execute('SELECT c.starts_at,c.duration_minutes FROM contests c JOIN registrations r ON r.contest_id=c.id WHERE c.id=%s AND r.user_id=%s',(body.contest_id,user['id'])).fetchone()
        if not q: raise HTTPException(403,'Требуется регистрация в контесте')
        if not c.execute('SELECT 1 FROM contest_tasks WHERE contest_id=%s AND task_id=%s',(body.contest_id,body.task_id)).fetchone(): raise HTTPException(403,'Задача не входит в контест')
        if now<q[0] or _contest_finished(q[0],q[1],now): raise HTTPException(409,'Контест сейчас не принимает отправки')
        if body.match_id and not c.execute('SELECT 1 FROM matches WHERE id=%s AND contest_id=%s AND status=%s AND ends_at>now() AND %s=ANY(participant_ids)',(body.match_id,body.contest_id,'active',user['id'])).fetchone(): raise HTTPException(403,'Матч недоступен или уже завершён')
        row=c.execute("INSERT INTO submissions(contest_id,task_id,user_id,match_id,source_code,language,verdict,created_at) VALUES(%s,%s,%s,%s,%s,'C++17','QUEUED',now()) RETURNING id,created_at",(body.contest_id,body.task_id,user['id'],body.match_id,body.source_code)).fetchone()
    background_tasks.add_task(_check_submission,row[0],body.task_id,body.source_code)
    return _submission(row[0],user)

async def _check_submission(sid,tid,code):
    try:
        with connection() as c:
            tests=c.execute('SELECT input,output FROM task_tests WHERE task_id=%s ORDER BY id',(tid,)).fetchall()
            limits=c.execute('SELECT time_limit_ms,memory_limit_kb FROM tasks WHERE id=%s',(tid,)).fetchone()
            c.execute("UPDATE submissions SET verdict='RUNNING' WHERE id=%s",(sid,))
        try:
            from .checker import check_solution
        except ImportError:
            from app.checker import check_solution
        verdict,error=await check_solution(code,[{'input':x,'output':y} for x,y in tests],limits[0],limits[1])
        if verdict not in {'OK','WA','TLE','RE','CE','CHECKER_ERROR'}: verdict='CHECKER_ERROR'; error='Неизвестный вердикт проверяющего'
    except Exception as exc: verdict='CHECKER_ERROR'; error=str(exc)[:1000]
    with connection() as c: c.execute('UPDATE submissions SET verdict=%s,error=%s,checked_at=now() WHERE id=%s',(verdict,error,sid))
    with connection() as c:
        mid=c.execute('SELECT match_id FROM submissions WHERE id=%s',(sid,)).fetchone()[0]
    if mid: await match_sockets.broadcast(mid)

def _submission(sid,user):
    with connection() as c:
        row=c.execute('SELECT s.id,s.contest_id,s.task_id,s.user_id,s.match_id,s.source_code,s.language,s.verdict,s.created_at,s.checked_at,s.error,c.organizer_id FROM submissions s JOIN contests c ON c.id=s.contest_id WHERE s.id=%s',(sid,)).fetchone()
    if not row: raise HTTPException(404,'Отправка не найдена')
    if user['id']!=row[3] and user['id']!=row[11]: raise HTTPException(403,'Нет доступа')
    return dict(zip(('id','contest_id','task_id','user_id','match_id','source_code','language','verdict','created_at','checked_at','error'),row[:11]))

@app.get('/api/submissions/{sid}')
def get_submission(sid:int,user=Depends(current_user)): return _submission(sid,user)
@app.get('/api/submissions')
def list_submissions(contest_id:int,user=Depends(current_user)):
    with connection() as c:
        owner=c.execute('SELECT organizer_id FROM contests WHERE id=%s',(contest_id,)).fetchone()
        if not owner: raise HTTPException(404,'Контест не найден')
        if user['id']!=owner[0]:
            rows=c.execute('SELECT id FROM submissions WHERE contest_id=%s AND user_id=%s ORDER BY id DESC',(contest_id,user['id'])).fetchall()
        else: rows=c.execute('SELECT id FROM submissions WHERE contest_id=%s ORDER BY id DESC',(contest_id,)).fetchall()
    return [_submission(r[0],user) for r in rows]

import secrets
from fastapi import status

@app.post('/api/matches',status_code=201)
def create_match(body:MatchIn,user=Depends(require_role('participant'))):
    if body.mode not in ('duel','team'): raise HTTPException(422,'mode должен быть duel или team')
    with connection() as c:
        if not c.execute('SELECT 1 FROM registrations WHERE contest_id=%s AND user_id=%s',(body.contest_id,user['id'])).fetchone(): raise HTTPException(403,'Сначала зарегистрируйтесь в контесте')
        code=secrets.token_urlsafe(18)
        row=c.execute("INSERT INTO matches(mode,contest_id,invite_code,creator_id,participant_ids) VALUES(%s,%s,%s,%s,ARRAY[%s]::bigint[]) RETURNING id",(body.mode,body.contest_id,code,user['id'],user['id'])).fetchone()
    return _match(row[0],user)

def _match(mid,user):
    with connection() as c:
        r=c.execute('SELECT id,mode,contest_id,invite_code,status,creator_id,participant_ids,started_at,ends_at,winner_id FROM matches WHERE id=%s',(mid,)).fetchone()
    if not r: raise HTTPException(404,'Матч не найден')
    with connection() as c: owner=c.execute('SELECT organizer_id FROM contests WHERE id=%s',(r[2],)).fetchone()[0]
    if user['id'] not in r[6] and user['id']!=owner: raise HTTPException(403,'Нет доступа к матчу')
    progress=[]
    with connection() as c:
        contest=c.execute('SELECT starts_at FROM contests WHERE id=%s',(r[2],)).fetchone()[0]
        subs=c.execute("SELECT user_id,task_id,verdict,EXTRACT(EPOCH FROM (created_at-%s))::int FROM submissions WHERE match_id=%s ORDER BY created_at,id",(contest,mid)).fetchall()
    progress=_score_match(r[6],subs)
    if r[4]=='active' and r[8] and datetime.now(timezone.utc)>=r[8]:
        winner=None
        if progress:
            best=max(x['solved'] for x in progress); fastest=min(x['elapsed_seconds'] for x in progress if x['solved']==best)
            winners=[x['user_id'] for x in progress if x['solved']==best and x['elapsed_seconds']==fastest]
            winner=winners[0] if len(winners)==1 else None
        with connection() as c: c.execute("UPDATE matches SET status='finished',winner_id=%s WHERE id=%s AND status='active'",(winner,mid))
        r=(*r[:4],'finished',*r[5:9],winner)
    return dict(zip(('id','mode','contest_id','invite_code','status','creator_id','participant_ids','started_at','ends_at','winner_id'),r),progress=progress)

@app.get('/api/matches/{mid}')
def get_match(mid:int,user=Depends(current_user)): return _match(mid,user)
@app.get('/api/matches/{mid}/state')
def match_state(mid:int,user=Depends(current_user)): return _match(mid,user)

@app.post('/api/matches/join')
async def join_match(body:JoinIn,user=Depends(require_role('participant'))):
    with connection() as c:
        c.execute('LOCK TABLE matches IN SHARE ROW EXCLUSIVE MODE')
        r=c.execute("SELECT id,contest_id,creator_id,participant_ids FROM matches WHERE invite_code=%s AND status='waiting' FOR UPDATE",(body.invite_code,)).fetchone()
        if not r: raise HTTPException(404,'Приглашение недоступно')
        if user['id']==r[2]: raise HTTPException(409,'Нельзя присоединиться к собственному матчу')
        if not c.execute('SELECT 1 FROM registrations WHERE contest_id=%s AND user_id=%s',(r[1],user['id'])).fetchone(): raise HTTPException(403,'Сначала зарегистрируйтесь в контесте')
        start=c.execute('SELECT starts_at,duration_minutes FROM contests WHERE id=%s',(r[1],)).fetchone()
        from datetime import timedelta
        ends=start[0]+timedelta(minutes=start[1])
        c.execute("UPDATE matches SET participant_ids=ARRAY[%s,%s]::bigint[],status='active',started_at=now(),ends_at=%s WHERE id=%s",(r[2],user['id'],ends,r[0]))
    result=_match(r[0],user)
    await match_sockets.broadcast(r[0])
    if result['ends_at']:
        asyncio.create_task(_finish_match_at(r[0],result['ends_at'],user))
    return result

@app.get('/api/contests/{cid}/integrity/submissions')
def integrity_submissions(cid:int,user=Depends(require_role('organizer'))):
    with connection() as c:
        owner=c.execute('SELECT organizer_id FROM contests WHERE id=%s',(cid,)).fetchone()
        if not owner: raise HTTPException(404,'Контест не найден')
        if owner[0]!=user['id']: raise HTTPException(403,'Только организатор контеста')
        rows=c.execute('SELECT id,contest_id,task_id,user_id,match_id,source_code,language,verdict,created_at,checked_at,error FROM submissions WHERE contest_id=%s ORDER BY user_id,task_id,created_at',(cid,)).fetchall()
    keys=('id','contest_id','task_id','user_id','match_id','source_code','language','verdict','created_at','checked_at','error')
    return [dict(zip(keys,row)) for row in rows]

@app.post('/api/contests/{cid}/integrity/analyze')
def integrity_analyze(cid:int,user=Depends(require_role('organizer'))):
    from datetime import timedelta
    with connection() as c:
        row=c.execute('SELECT organizer_id,starts_at,duration_minutes FROM contests WHERE id=%s',(cid,)).fetchone()
        if not row: raise HTTPException(404,'Контест не найден')
        if row[0]!=user['id']: raise HTTPException(403,'Только организатор контеста')
        if datetime.now(timezone.utc)<row[1]+timedelta(minutes=row[2]): raise HTTPException(409,'Анализ доступен после окончания контеста')
    raise HTTPException(503,'JPlag не настроен; анализ не выполнялся')

@app.get('/api/contests/{cid}/integrity/reports')
def integrity_reports(cid:int,user=Depends(require_role('organizer'))):
    with connection() as c:
        owner=c.execute('SELECT organizer_id FROM contests WHERE id=%s',(cid,)).fetchone()
        if not owner: raise HTTPException(404,'Контест не найден')
        if owner[0]!=user['id']: raise HTTPException(403,'Только организатор контеста')
        return [dict(zip(('id','contest_id','created_at','engine','details'),x)) for x in c.execute('SELECT id,contest_id,created_at,engine,details FROM integrity_reports WHERE contest_id=%s ORDER BY id DESC',(cid,)).fetchall()]

@app.post('/api/contests/{cid}/integrity/conclusions',status_code=201)
def integrity_conclusion(cid:int,body:dict,user=Depends(require_role('organizer'))):
    subject=body.get('subject_user_id'); comment=body.get('comment')
    if not isinstance(subject,int) or not isinstance(comment,str) or not comment.strip(): raise HTTPException(422,'Нужны subject_user_id и непустой comment')
    with connection() as c:
        owner=c.execute('SELECT organizer_id FROM contests WHERE id=%s',(cid,)).fetchone()
        if not owner: raise HTTPException(404,'Контест не найден')
        if owner[0]!=user['id']: raise HTTPException(403,'Только организатор контеста')
        if not c.execute('SELECT 1 FROM registrations WHERE contest_id=%s AND user_id=%s',(cid,subject)).fetchone(): raise HTTPException(404,'Участник контеста не найден')
        r=c.execute('INSERT INTO integrity_conclusions(contest_id,organizer_id,subject_user_id,comment) VALUES(%s,%s,%s,%s) RETURNING id,created_at',(cid,user['id'],subject,comment.strip())).fetchone()
    return {'id':r[0],'contest_id':cid,'organizer_id':user['id'],'subject_user_id':subject,'comment':comment.strip(),'created_at':r[1]}

@app.websocket('/api/ws/matches/{mid}')
async def match_ws(ws:WebSocket,mid:int,token:str):
    try:
        user=user_by_id(decode_token(token)); data=_match(mid,user)
    except HTTPException as exc:
        await ws.close(code=4401 if exc.status_code==401 else 4403); return
    ws.state.match_user=user
    await ws.accept(); await match_sockets.add(mid,ws); await ws.send_json({'type':'match.updated','match':data})
    try:
        while True:
            await ws.receive_text(); await ws.send_json({'type':'match.updated','match':_match(mid,user)})
    except WebSocketDisconnect: match_sockets.remove(mid,ws)

