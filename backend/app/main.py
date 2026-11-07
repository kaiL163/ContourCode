from __future__ import annotations
import os, json, time, hmac, hashlib, base64, re
import asyncio
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any
from fastapi import (
    FastAPI,
    HTTPException,
    Depends,
    Header,
    WebSocket,
    WebSocketDisconnect,
    BackgroundTasks,
)
from pydantic import BaseModel, ConfigDict, Field
from fastapi.encoders import jsonable_encoder
from .browser_activity import attach_routes as attach_browser_activity_routes
from .code_history import (
    attach_routes as attach_code_history_routes,
    record_submission_version,
)

app = FastAPI(title="КонтурКод API", version="1")


def _secret():
    return (
        os.getenv("JWT_SECRET")
        or os.getenv("TOKEN_SECRET")
        or "local-demo-secret-change-me"
    )


def _contest_finished(starts_at, duration_minutes, now=None):
    from datetime import timedelta

    return (now or datetime.now(timezone.utc)) >= starts_at + timedelta(
        minutes=duration_minutes
    )


def _score_match(participants, submissions):
    first = {}
    for uid, task_id, verdict, elapsed in submissions:
        if verdict == "OK":
            first.setdefault((uid, task_id), elapsed)
    return [
        {
            "user_id": uid,
            "solved": sum(1 for (u, _), _t in first.items() if u == uid),
            "elapsed_seconds": sum(t for (u, _), t in first.items() if u == uid),
        }
        for uid in participants
    ]


class MatchSockets:
    def __init__(self):
        self.clients = {}

    async def add(self, mid, ws):
        self.clients.setdefault(mid, set()).add(ws)

    def remove(self, mid, ws):
        self.clients.get(mid, set()).discard(ws)

    async def broadcast(self, mid):
        for ws in list(self.clients.get(mid, ())):
            try:
                user = ws.state.match_user
                await ws.send_json(jsonable_encoder({"type": "match.updated", "match": _match(mid, user)}))
            except Exception:
                self.remove(mid, ws)


match_sockets = MatchSockets()


async def _finish_match_at(mid, ends_at, user):
    delay = max(0, (ends_at - datetime.now(timezone.utc)).total_seconds())
    await asyncio.sleep(delay)
    state = _match(mid, user)
    if state["status"] == "finished":
        await match_sockets.broadcast(mid)


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def issue_token(user: dict) -> str:
    payload = _b64(
        json.dumps(
            {"uid": user["id"], "exp": int(time.time()) + 43200}, separators=(",", ":")
        ).encode()
    )
    sig = _b64(hmac.new(_secret().encode(), payload.encode(), hashlib.sha256).digest())
    return payload + "." + sig


def decode_token(token: str) -> int:
    try:
        payload, sig = token.split(".", 1)
        expected = _b64(
            hmac.new(_secret().encode(), payload.encode(), hashlib.sha256).digest()
        )
        if not hmac.compare_digest(sig, expected):
            raise ValueError()
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if data["exp"] < time.time():
            raise ValueError()
        return int(data["uid"])
    except Exception as exc:
        raise HTTPException(401, "Неверный или истёкший токен") from exc


@contextmanager
def connection():
    try:
        import psycopg

        conn = psycopg.connect(
            os.getenv(
                "DATABASE_URL", "postgresql://kontur:localtest@localhost:55432/kontur"
            )
        )
    except Exception as exc:
        raise HTTPException(503, "База данных недоступна") from exc
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def user_by_id(uid: int):
    with connection() as c:
        row = c.execute(
            "SELECT id, username, display_name, role FROM users WHERE id=%s", (uid,)
        ).fetchone()
    if not row:
        raise HTTPException(401, "Пользователь не найден")
    return dict(zip(("id", "username", "display_name", "role"), row))


def profile_by_id(uid: int):
    with connection() as c:
        row = c.execute(
            "SELECT id, username, display_name, role, avatar_image, skills FROM users WHERE id=%s",
            (uid,),
        ).fetchone()
    if not row:
        raise HTTPException(401, "Пользователь не найден")
    return dict(
        zip(("id", "username", "display_name", "role", "avatar_image", "skills"), row)
    )


def current_user(authorization: str | None = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Требуется Bearer токен")
    return user_by_id(decode_token(authorization[7:]))


def require_role(*roles):
    def dep(user=Depends(current_user)):
        if user["role"] not in roles:
            raise HTTPException(403, "Недостаточно прав")
        return user

    return dep


class Login(BaseModel):
    username: str
    password: str


class ParticipantRegistration(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(max_length=32)
    display_name: str = Field(max_length=80)
    password: str = Field(max_length=128)


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str = Field(max_length=80)
    avatar_image: str | None = Field(default=None, max_length=1398200)
    skills: list[str] = Field(default_factory=list, max_length=10)


class TaskIn(BaseModel):
    title: str
    statement: str
    time_limit_ms: int = Field(gt=0)
    memory_limit_kb: int = Field(gt=0)
    tests: list[dict] = Field(min_length=1)
    difficulty: str = "medium"


class ContestIn(BaseModel):
    title: str
    description: str = ""
    starts_at: datetime
    duration_minutes: int = Field(gt=0)
    task_ids: list[int]
    cover_image: str | None = None


class ContestCoverIn(BaseModel):
    cover_image: str | None = None


def validate_cover(value: str | None) -> str | None:
    if value is None:
        return None
    try:
        header, encoded = value.split(",", 1)
        signatures = {
            "data:image/png;base64": b"\x89PNG\r\n\x1a\n",
            "data:image/jpeg;base64": b"\xff\xd8\xff",
            "data:image/webp;base64": b"RIFF",
        }
        if header not in signatures or len(encoded) > 1398104:
            raise ValueError()
        raw = base64.b64decode(encoded, validate=True)
        if (
            len(raw) > 1048576
            or not raw.startswith(signatures[header])
            or (header == "data:image/webp;base64" and raw[8:12] != b"WEBP")
        ):
            raise ValueError()
    except (ValueError, TypeError):
        raise HTTPException(
            422, "Обложка должна быть PNG, JPEG или WebP размером до 1 МБ"
        )
    return value


class RegisterIn(BaseModel):
    pass


class SubmissionIn(BaseModel):
    contest_id: int | None = None
    task_id: int
    source_code: str = Field(min_length=1, max_length=100000)
    match_id: int | None = None
    session_id: str | None = None


class MatchIn(BaseModel):
    mode: str
    task_ids: list[int] | None = Field(default=None, max_length=50)
    difficulty: str = "easy"
    task_count: int = Field(default=3, gt=0)
    duration_minutes: int = Field(gt=0, le=1440)


class JoinIn(BaseModel):
    invite_code: str


class FinishReadyIn(BaseModel):
    ready: bool


class TeamDraftIn(BaseModel):
    task_id: int
    source_code: str = Field(max_length=100000)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.on_event("startup")
def startup_migrations():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1] / "migrations"
    with connection() as c:
        c.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
        )
        for path in sorted(root.glob("*.sql")):
            if c.execute(
                "SELECT 1 FROM schema_migrations WHERE name=%s", (path.name,)
            ).fetchone():
                continue
            c.execute(path.read_text(encoding="utf-8"))
            c.execute("INSERT INTO schema_migrations(name) VALUES(%s)", (path.name,))


@app.post("/api/auth/login")
def login(body: Login):
    with connection() as c:
        row = c.execute(
            "SELECT id, username, display_name, role, password_hash FROM users WHERE username=%s",
            (body.username.strip().lower(),),
        ).fetchone()
    if not row:
        raise HTTPException(401, "Неверные учётные данные")
    # PBKDF2 encoded values: pbkdf2$iterations$salt_hex$digest_hex
    try:
        _, rounds, salt, digest = row[4].split("$")
        actual = hashlib.pbkdf2_hmac(
            "sha256", body.password.encode(), bytes.fromhex(salt), int(rounds)
        ).hex()
        if not hmac.compare_digest(actual, digest):
            raise ValueError()
    except Exception:
        raise HTTPException(401, "Неверные учётные данные")
    user = profile_by_id(row[0])
    return {"access_token": issue_token(user), "token_type": "bearer", "user": user}


@app.post("/api/auth/register", status_code=201)
def register_participant(body: ParticipantRegistration):
    username = body.username.strip().lower()
    display_name = body.display_name.strip()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_.-]{2,31}", username):
        raise HTTPException(
            422,
            "Логин: от 3 до 32 латинских букв, цифр, точек, дефисов или подчёркиваний; первый символ — буква или цифра.",
        )
    if len(display_name) < 2 or any(ord(ch) < 32 for ch in display_name):
        raise HTTPException(422, "Укажите имя длиной от 2 до 80 символов.")
    if len(body.password) < 8:
        raise HTTPException(422, "Пароль должен содержать не менее 8 символов.")
    salt = os.urandom(16)
    rounds = 600000
    digest = hashlib.pbkdf2_hmac(
        "sha256", body.password.encode("utf-8"), salt, rounds
    ).hex()
    encoded = f"pbkdf2${rounds}${salt.hex()}${digest}"
    with connection() as c:
        row = c.execute(
            "INSERT INTO users(username,display_name,role,password_hash) VALUES(%s,%s,'participant',%s) ON CONFLICT (username) DO NOTHING RETURNING id,username,display_name,role",
            (username, display_name, encoded),
        ).fetchone()
        if not row:
            raise HTTPException(409, "Этот логин уже занят. Выберите другой.")
    user = dict(
        zip(("id", "username", "display_name", "role"), row),
        avatar_image=None,
        skills=[],
    )
    return {"access_token": issue_token(user), "token_type": "bearer", "user": user}


@app.get("/api/auth/me")
def me(user=Depends(current_user)):
    return profile_by_id(user["id"])


@app.get("/api/profile")
def get_profile(user=Depends(current_user)):
    return profile_by_id(user["id"])


@app.post("/api/profile")
def update_profile(body: ProfileUpdate, user=Depends(current_user)):
    name = body.display_name.strip()
    if len(name) < 2 or any(ord(ch) < 32 for ch in name):
        raise HTTPException(422, "Укажите имя длиной от 2 до 80 символов.")
    try:
        avatar = validate_cover(body.avatar_image)
    except HTTPException:
        raise HTTPException(
            422, "Аватар должен быть PNG, JPEG или WebP размером до 1 МБ."
        )
    skills = []
    for item in body.skills:
        skill = item.strip()
        if not skill or len(skill) > 40 or any(ord(ch) < 32 for ch in skill):
            raise HTTPException(
                422, "Каждый навык должен содержать от 1 до 40 символов."
            )
        if skill.casefold() not in {s.casefold() for s in skills}:
            skills.append(skill)
    with connection() as c:
        row = c.execute(
            "UPDATE users SET display_name=%s, avatar_image=%s, skills=%s WHERE id=%s RETURNING id,username,display_name,role,avatar_image,skills",
            (name, avatar, skills, user["id"]),
        ).fetchone()
    if not row:
        raise HTTPException(404, "Пользователь не найден")
    return dict(
        zip(("id", "username", "display_name", "role", "avatar_image", "skills"), row)
    )


@app.get("/api/tasks")
def tasks(user=Depends(current_user)):
    with connection() as c:
        rows = c.execute(
            "SELECT id,title,statement,time_limit_ms,memory_limit_kb,difficulty FROM tasks ORDER BY id"
        ).fetchall()
    return [
        dict(
            zip(("id", "title", "statement", "time_limit_ms", "memory_limit_kb", "difficulty"), r),
            tests=[],
        )
        for r in rows
    ]


@app.get("/api/tasks/{task_id}")
def task(task_id: int, user=Depends(current_user)):
    with connection() as c:
        r = c.execute(
            "SELECT id,title,statement,time_limit_ms,memory_limit_kb,difficulty FROM tasks WHERE id=%s",
            (task_id,),
        ).fetchone()
        if not r:
            raise HTTPException(404, "Задача не найдена")
        tests = c.execute(
            "SELECT input,output,is_hidden FROM task_tests WHERE task_id=%s ORDER BY id",
            (task_id,),
        ).fetchall()
        owner = c.execute(
            "SELECT EXISTS(SELECT 1 FROM tasks t WHERE t.id=%s AND t.owner_id=%s) OR EXISTS(SELECT 1 FROM contests c JOIN contest_tasks ct ON ct.contest_id=c.id WHERE ct.task_id=%s AND c.organizer_id=%s)",
            (task_id, user["id"], task_id, user["id"]),
        ).fetchone()[0]
    return dict(
        zip(("id", "title", "statement", "time_limit_ms", "memory_limit_kb", "difficulty"), r),
        tests=[{"input": x[0], "output": x[1]} for x in tests if owner or not x[2]],
    )


@app.post("/api/tasks", status_code=201)
def create_task(body: TaskIn, user=Depends(require_role("organizer"))):
    if body.difficulty not in ("easy", "medium", "hard"):
        raise HTTPException(422, "Выберите корректный уровень сложности")
    with connection() as c:
        r = c.execute(
            "INSERT INTO tasks(title,statement,time_limit_ms,memory_limit_kb,owner_id,difficulty) VALUES(%s,%s,%s,%s,%s,%s) RETURNING id",
            (
                body.title,
                body.statement,
                body.time_limit_ms,
                body.memory_limit_kb,
                user["id"],
                body.difficulty,
            ),
        ).fetchone()
        for t in body.tests:
            if not isinstance(t.get("input"), str) or not isinstance(
                t.get("output"), str
            ):
                raise HTTPException(422, "Каждый тест должен содержать input/output")
            c.execute(
                "INSERT INTO task_tests(task_id,input,output,is_hidden) VALUES(%s,%s,%s,%s)",
                (r[0], t["input"], t["output"], bool(t.get("hidden", False))),
            )
    return {
        "id": r[0],
        "title": body.title,
        "statement": body.statement,
        "time_limit_ms": body.time_limit_ms,
        "memory_limit_kb": body.memory_limit_kb,
        "difficulty": body.difficulty,
        "tests": body.tests,
    }


@app.get("/api/contests")
def contests(user=Depends(current_user)):
    with connection() as c:
        rows = c.execute(
            "SELECT id,title,description,starts_at,duration_minutes,organizer_id,cover_image FROM contests ORDER BY id"
        ).fetchall()
        out = []
        for r in rows:
            ids = [
                x[0]
                for x in c.execute(
                    "SELECT task_id FROM contest_tasks WHERE contest_id=%s ORDER BY task_id",
                    (r[0],),
                ).fetchall()
            ]
            reg = c.execute(
                "SELECT EXISTS(SELECT 1 FROM registrations WHERE contest_id=%s AND user_id=%s)",
                (r[0], user["id"]),
            ).fetchone()[0]
            out.append(
                dict(
                    zip(
                        (
                            "id",
                            "title",
                            "description",
                            "starts_at",
                            "duration_minutes",
                            "organizer_id",
                            "cover_image",
                        ),
                        r,
                    ),
                    task_ids=ids,
                    registered=reg,
                )
            )
    return out


@app.post("/api/contests", status_code=201)
def create_contest(body: ContestIn, user=Depends(require_role("organizer"))):
    with connection() as c:
        cover = validate_cover(body.cover_image)
        r = c.execute(
            "INSERT INTO contests(title,description,starts_at,duration_minutes,organizer_id,cover_image) VALUES(%s,%s,%s,%s,%s,%s) RETURNING id",
            (
                body.title,
                body.description,
                body.starts_at,
                body.duration_minutes,
                user["id"],
                cover,
            ),
        ).fetchone()
        for tid in set(body.task_ids):
            if not c.execute("SELECT 1 FROM tasks WHERE id=%s", (tid,)).fetchone():
                raise HTTPException(404, "Задача не найдена")
            c.execute(
                "INSERT INTO contest_tasks(contest_id,task_id) VALUES(%s,%s)",
                (r[0], tid),
            )
    return {
        "id": r[0],
        "title": body.title,
        "description": body.description,
        "starts_at": body.starts_at,
        "duration_minutes": body.duration_minutes,
        "task_ids": body.task_ids,
        "organizer_id": user["id"],
        "registered": False,
        "cover_image": cover,
    }


@app.post("/api/contests/{cid}/cover")
def update_contest_cover(
    cid: int, body: ContestCoverIn, user=Depends(require_role("organizer"))
):
    cover = validate_cover(body.cover_image)
    with connection() as c:
        row = c.execute(
            "UPDATE contests SET cover_image=%s WHERE id=%s AND organizer_id=%s RETURNING id",
            (cover, cid, user["id"]),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Контест не найден")
    return {"cover_image": cover}


@app.get("/api/contests/{cid}")
def get_contest(cid: int, user=Depends(current_user)):
    result = next((x for x in contests(user) if x["id"] == cid), None)
    if not result:
        raise HTTPException(404, "Контест не найден")
    return result


@app.post("/api/contests/{cid}/register", status_code=201)
def register(cid: int, user=Depends(require_role("participant"))):
    with connection() as c:
        if not c.execute("SELECT 1 FROM contests WHERE id=%s", (cid,)).fetchone():
            raise HTTPException(404, "Контест не найден")
        c.execute(
            "INSERT INTO registrations(contest_id,user_id) VALUES(%s,%s) ON CONFLICT DO NOTHING",
            (cid, user["id"]),
        )
    return {"registered": True}


@app.get("/api/contests/{cid}/standings")
def standings(cid: int, user=Depends(current_user)):
    with connection() as c:
        contest = c.execute(
            "SELECT starts_at FROM contests WHERE id=%s", (cid,)
        ).fetchone()
        if not contest:
            raise HTTPException(404, "Контест не найден")
        participants = c.execute(
            "SELECT u.id,u.display_name FROM registrations r JOIN users u ON u.id=r.user_id WHERE r.contest_id=%s ORDER BY u.id",
            (cid,),
        ).fetchall()
        task_ids = [
            row[0]
            for row in c.execute(
                "SELECT task_id FROM contest_tasks WHERE contest_id=%s ORDER BY task_id",
                (cid,),
            ).fetchall()
        ]
        submissions = c.execute(
            "SELECT user_id,task_id,verdict,created_at FROM submissions WHERE contest_id=%s AND match_id IS NULL ORDER BY created_at,id",
            (cid,),
        ).fetchall()

    participant_scores = []
    failed_verdicts = {"WA", "TLE", "RE", "CE"}
    for participant_id, display_name in participants:
        task_stats = {
            task_id: {
                "task_id": task_id,
                "status": "not_started",
                "attempts": 0,
                "solved": False,
                "points": 100,
                "points_lost": 0,
            }
            for task_id in task_ids
        }
        first_solved_at = {}
        for submit_user_id, task_id, verdict, created_at in submissions:
            if submit_user_id != participant_id or task_id not in task_stats:
                continue
            task = task_stats[task_id]
            if task["solved"]:
                continue
            if verdict in ("QUEUED", "RUNNING"):
                task["status"] = "checking"
            elif verdict == "OK":
                task["status"] = "solved"
                task["solved"] = True
                first_solved_at[task_id] = created_at
                task["points"] = max(0, 100 - task["points_lost"])
            elif verdict in failed_verdicts:
                task["attempts"] += 1
                task["points_lost"] = min(100, task["points_lost"] + 10)
                task["points"] = max(0, 100 - task["points_lost"])
                task["status"] = "attempted"

        solved = sum(item["solved"] for item in task_stats.values())
        score = sum(item["points"] for item in task_stats.values() if item["solved"])
        elapsed = sum(
            max(0, int((created_at - contest[0]).total_seconds()))
            for created_at in first_solved_at.values()
        )
        participant_scores.append(
            {
                "user_id": participant_id,
                "display_name": display_name,
                "solved": solved,
                "elapsed_seconds": elapsed,
                "score": score,
                "tasks": list(task_stats.values()),
            }
        )
    participant_scores.sort(
        key=lambda item: (-item["score"], -item["solved"], item["elapsed_seconds"], item["user_id"])
    )
    return {
        "contest_id": cid,
        "task_ids": task_ids,
        "rows": [
            {**row, "rank": i + 1} for i, row in enumerate(participant_scores)
        ],
    }


@app.post("/api/submissions", status_code=202)
def submit(
    body: SubmissionIn,
    background_tasks: BackgroundTasks,
    user=Depends(require_role("participant")),
):
    if (body.contest_id is None) == (body.match_id is None):
        raise HTTPException(422, "Укажите контест или матч")
    now = datetime.now(timezone.utc)
    with connection() as c:
        if body.match_id is not None:
            match = c.execute(
                "SELECT status, started_at, ends_at, participant_ids FROM matches WHERE id=%s FOR UPDATE",
                (body.match_id,),
            ).fetchone()
            if not match or user["id"] not in match[3]:
                raise HTTPException(403, "Нет доступа к матчу")
            if match[0] != "active" or not match[1] or not match[2] or datetime.now(timezone.utc) >= match[2]:
                raise HTTPException(409, "Матч сейчас не принимает отправки")
            if not c.execute(
                "SELECT 1 FROM match_tasks WHERE match_id=%s AND task_id=%s",
                (body.match_id, body.task_id),
            ).fetchone():
                raise HTTPException(403, "Задача не входит в матч")
        else:
            q = c.execute(
                "SELECT c.starts_at,c.duration_minutes FROM contests c JOIN registrations r ON r.contest_id=c.id WHERE c.id=%s AND r.user_id=%s",
                (body.contest_id, user["id"]),
            ).fetchone()
            if not q:
                raise HTTPException(403, "Требуется регистрация в контесте")
            if not c.execute(
                "SELECT 1 FROM contest_tasks WHERE contest_id=%s AND task_id=%s",
                (body.contest_id, body.task_id),
            ).fetchone():
                raise HTTPException(403, "Задача не входит в контест")
            if now < q[0] or _contest_finished(q[0], q[1], now):
                raise HTTPException(409, "Контест сейчас не принимает отправки")
        row = c.execute(
            "INSERT INTO submissions(contest_id,task_id,user_id,match_id,source_code,language,verdict,created_at) VALUES(%s,%s,%s,%s,%s,'C++17','QUEUED',now()) RETURNING id,created_at",
            (
                body.contest_id,
                body.task_id,
                user["id"],
                body.match_id,
                body.source_code,
            ),
        ).fetchone()
        record_submission_version(
            c,
            user_id=user["id"],
            contest_id=body.contest_id,
            match_id=body.match_id,
            task_id=body.task_id,
            session_id=body.session_id,
            submission_id=row[0],
            code_content=body.source_code,
        )
    background_tasks.add_task(_check_submission, row[0], body.task_id, body.source_code)
    return _submission(row[0], user)


async def _check_submission(sid, tid, code):
    try:
        with connection() as c:
            tests = c.execute(
                "SELECT input,output FROM task_tests WHERE task_id=%s ORDER BY id",
                (tid,),
            ).fetchall()
            limits = c.execute(
                "SELECT time_limit_ms,memory_limit_kb FROM tasks WHERE id=%s", (tid,)
            ).fetchone()
            c.execute("UPDATE submissions SET verdict='RUNNING' WHERE id=%s", (sid,))
        try:
            from .checker import check_solution
        except ImportError:
            from app.checker import check_solution
        verdict, error = await check_solution(
            code, [{"input": x, "output": y} for x, y in tests], limits[0], limits[1]
        )
        if verdict not in {"OK", "WA", "TLE", "RE", "CE", "CHECKER_ERROR"}:
            verdict = "CHECKER_ERROR"
            error = "Неизвестный вердикт проверяющего"
    except Exception as exc:
        verdict = "CHECKER_ERROR"
        error = str(exc)[:1000]
    with connection() as c:
        c.execute(
            "UPDATE submissions SET verdict=%s,error=%s,checked_at=now() WHERE id=%s",
            (verdict, error, sid),
        )
    with connection() as c:
        mid = c.execute(
            "SELECT match_id FROM submissions WHERE id=%s", (sid,)
        ).fetchone()[0]
    if mid:
        await match_sockets.broadcast(mid)


def _submission(sid, user):
    with connection() as c:
        row = c.execute(
            "SELECT s.id,s.contest_id,s.task_id,s.user_id,s.match_id,s.source_code,s.language,s.verdict,s.created_at,s.checked_at,s.error,c.organizer_id FROM submissions s LEFT JOIN contests c ON c.id=s.contest_id WHERE s.id=%s",
            (sid,),
        ).fetchone()
    if not row:
        raise HTTPException(404, "Отправка не найдена")
    if user["id"] != row[3] and user["id"] != row[11]:
        raise HTTPException(403, "Нет доступа")
    return dict(
        zip(
            (
                "id",
                "contest_id",
                "task_id",
                "user_id",
                "match_id",
                "source_code",
                "language",
                "verdict",
                "created_at",
                "checked_at",
                "error",
            ),
            row[:11],
        )
    )


@app.get("/api/submissions/{sid}")
def get_submission(sid: int, user=Depends(current_user)):
    return _submission(sid, user)


@app.get("/api/submissions")
def list_submissions(contest_id: int, user=Depends(current_user)):
    with connection() as c:
        owner = c.execute(
            "SELECT organizer_id FROM contests WHERE id=%s", (contest_id,)
        ).fetchone()
        if not owner:
            raise HTTPException(404, "Контест не найден")
        if user["id"] != owner[0]:
            rows = c.execute(
                "SELECT id FROM submissions WHERE contest_id=%s AND match_id IS NULL AND user_id=%s ORDER BY id DESC",
                (contest_id, user["id"]),
            ).fetchall()
        else:
            rows = c.execute(
                "SELECT id FROM submissions WHERE contest_id=%s AND match_id IS NULL ORDER BY id DESC",
                (contest_id,),
            ).fetchall()
    return [_submission(r[0], user) for r in rows]


import secrets
from fastapi import status


@app.post("/api/matches", status_code=201)
def create_match(body: MatchIn, user=Depends(require_role("participant"))):
    if body.mode not in ("duel", "team"):
        raise HTTPException(422, "mode должен быть duel или team")
    task_ids = body.task_ids
    if task_ids and len(set(task_ids)) != len(task_ids):
        raise HTTPException(422, "Задачи не должны повторяться")
    with connection() as c:
        if task_ids:
            existing = c.execute(
                "SELECT id FROM tasks WHERE id=ANY(%s)", (task_ids,)
            ).fetchall()
            if len(existing) != len(task_ids):
                raise HTTPException(422, "Одна или несколько задач не найдены")
        else:
            if body.difficulty not in ("easy", "medium", "hard"):
                raise HTTPException(422, "Выберите корректный уровень сложности")
            task_ids = [row[0] for row in c.execute(
                "SELECT id FROM tasks WHERE difficulty=%s AND title NOT ILIKE 'Демонстрация:%%' AND title NOT ILIKE 'Демо:%%' ORDER BY random() LIMIT %s",
                (body.difficulty, body.task_count),
            ).fetchall()]
            if len(task_ids) < body.task_count:
                raise HTTPException(
                    422,
                    f"На выбранном уровне доступно только {len(task_ids)} задач. Уменьшите количество или выберите другой уровень.",
                )
        row = c.execute(
            "INSERT INTO matches(mode,contest_id,invite_code,creator_id,participant_ids,duration_minutes,public_id) VALUES(%s,NULL,%s,%s,ARRAY[%s]::bigint[],%s,%s) RETURNING id",
            (
                body.mode,
                secrets.token_urlsafe(18),
                user["id"],
                user["id"],
                body.duration_minutes,
                secrets.token_hex(8),
            ),
        ).fetchone()
        for position, task_id in enumerate(task_ids, 1):
            c.execute(
                "INSERT INTO match_tasks(match_id,task_id,position) VALUES(%s,%s,%s)",
                (row[0], task_id, position),
            )
    return _match(row[0], user)


def _match(mid, user):
    with connection() as c:
        r = c.execute(
            "SELECT id,mode,contest_id,invite_code,status,creator_id,participant_ids,started_at,ends_at,winner_id,duration_minutes,forfeited_by,public_id FROM matches WHERE id=%s",
            (mid,),
        ).fetchone()
        if not r:
            raise HTTPException(404, "Матч не найден")
        if not user or user["id"] not in r[6]:
            raise HTTPException(403, "Нет доступа к матчу")
        task_ids = [
            row[0]
            for row in c.execute(
                "SELECT task_id FROM match_tasks WHERE match_id=%s ORDER BY position",
                (mid,),
            ).fetchall()
        ]
        finish_ready_ids = [row[0] for row in c.execute(
            "SELECT user_id FROM match_finish_ready WHERE match_id=%s ORDER BY user_id", (mid,)
        ).fetchall()]
        drafts = [
            {"task_id": row[0], "source_code": row[1], "updated_by": row[2], "updated_at": row[3]}
            for row in c.execute(
                "SELECT task_id,source_code,updated_by,updated_at FROM match_drafts WHERE match_id=%s ORDER BY task_id",
                (mid,),
            ).fetchall()
        ]
        names = dict(
            c.execute(
                "SELECT id,display_name FROM users WHERE id=ANY(%s)", (r[6],)
            ).fetchall()
        )
        subs = c.execute(
            "SELECT user_id,task_id,verdict,EXTRACT(EPOCH FROM (created_at-%s))::int FROM submissions WHERE match_id=%s ORDER BY created_at,id",
            (r[7] or datetime.now(timezone.utc), mid),
        ).fetchall()
        if r[4] == "active" and r[8] and datetime.now(timezone.utc) >= r[8]:
            pending = any(verdict in ("QUEUED", "RUNNING") for _, _, verdict, _ in subs)
            if not pending:
                winner = None
                if r[1] == "duel":
                    duel_scores = _score_match(r[6], subs)
                    if duel_scores:
                        best = max(item["solved"] for item in duel_scores)
                        fastest = min(
                            item["elapsed_seconds"]
                            for item in duel_scores
                            if item["solved"] == best
                        )
                        winners = [
                            item["user_id"]
                            for item in duel_scores
                            if item["solved"] == best
                            and item["elapsed_seconds"] == fastest
                        ]
                        winner = winners[0] if len(winners) == 1 else None
                c.execute(
                    "UPDATE matches SET status='finished', winner_id=%s, finished_at=COALESCE(finished_at,now()) WHERE id=%s AND status='active'",
                    (winner, mid),
                )
                r = (*r[:4], "finished", *r[5:9], winner, *r[10:])
    progress = _score_match(r[6], subs)
    for item in progress:
        item["display_name"] = names.get(item["user_id"], "Участник")
    team_solved = len({task_id for _, task_id, verdict, _ in subs if verdict == "OK"})
    return dict(
        zip(
            (
                "id",
                "mode",
                "contest_id",
                "invite_code",
                "status",
                "creator_id",
                "participant_ids",
                "started_at",
                "ends_at",
                "winner_id",
                "duration_minutes",
                "forfeited_by",
                "public_id",
            ),
            r,
        ),
        task_ids=task_ids,
        progress=progress,
        team_solved=team_solved,
        finish_ready_ids=finish_ready_ids,
        drafts=drafts,
    )


@app.get("/api/matches/history")
def match_history(mode: str = "duel", user=Depends(require_role("participant"))):
    if mode not in ("duel", "team"):
        raise HTTPException(422, "Неизвестный режим")
    with connection() as c:
        rows = c.execute("SELECT id FROM matches WHERE mode=%s AND %s=ANY(participant_ids) ORDER BY id DESC", (mode, user["id"])).fetchall()
    return [_match(row[0], user) for row in rows]


@app.get("/api/matches/public/{public_id}")
def match_by_public_id(public_id: str, user=Depends(current_user)):
    with connection() as c:
        row = c.execute("SELECT id FROM matches WHERE public_id=%s", (public_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Раунд не найден")
    return _match(row[0], user)


@app.get("/api/invitations/{public_id}")
def invitation(public_id: str, token: str, user=Depends(require_role("participant"))):
    with connection() as c:
        row = c.execute("SELECT m.mode,m.status,m.duration_minutes,u.display_name,cardinality(m.participant_ids),m.participant_ids,m.id FROM matches m JOIN users u ON u.id=m.creator_id WHERE m.public_id=%s AND m.invite_code=%s", (public_id, token)).fetchone()
        if not row or row[1] == 'cancelled' or (row[1] != 'waiting' and user['id'] not in row[5]):
            raise HTTPException(404, "Приглашение недоступно")
        count = c.execute("SELECT count(*) FROM match_tasks WHERE match_id=%s", (row[6],)).fetchone()[0]
    return {"mode":row[0],"status":row[1],"duration_minutes":row[2],"creator_name":row[3],"task_count":count,"already_joined":user['id'] in row[5]}


@app.post("/api/invitations/{public_id}/decline")
async def decline_invitation(public_id: str, body: JoinIn, user=Depends(require_role("participant"))):
    with connection() as c:
        row = c.execute("SELECT id,creator_id,participant_ids,status FROM matches WHERE public_id=%s AND invite_code=%s FOR UPDATE", (public_id, body.invite_code)).fetchone()
        if not row or row[3] != "waiting":
            raise HTTPException(404, "Приглашение недоступно")
        if user["id"] in row[2]:
            raise HTTPException(409, "Вы уже участвуете в раунде")
        c.execute("UPDATE matches SET status='declined', finished_at=now() WHERE id=%s", (row[0],))
    await match_sockets.broadcast(row[0])
    return {"status":"declined"}


@app.get("/api/matches/{mid}")
def get_match(mid: int, user=Depends(current_user)):
    return _match(mid, user)


@app.get("/api/matches/{mid}/state")
def match_state(mid: int, user=Depends(current_user)):
    return _match(mid, user)


@app.post("/api/matches/{mid}/forfeit")
async def forfeit_duel(mid: int, user=Depends(require_role("participant"))):
    with connection() as c:
        row = c.execute(
            "SELECT mode,status,participant_ids,ends_at FROM matches WHERE id=%s FOR UPDATE",
            (mid,),
        ).fetchone()
        if not row or user["id"] not in row[2]:
            raise HTTPException(403, "Нет доступа к дуэли")
        if row[0] != "duel":
            raise HTTPException(409, "Действие доступно только в дуэли")
        if row[1] == "waiting":
            c.execute("UPDATE matches SET status='cancelled', finished_at=now() WHERE id=%s", (mid,))
        elif row[1] == "active" and row[3] and datetime.now(timezone.utc) < row[3]:
            opponent = next((uid for uid in row[2] if uid != user["id"]), None)
            if opponent is None:
                raise HTTPException(409, "Соперник ещё не подключился")
            c.execute("UPDATE matches SET status='finished', winner_id=%s, forfeited_by=%s, finished_at=now() WHERE id=%s", (opponent, user["id"], mid))
        else:
            raise HTTPException(409, "Дуэль уже завершена")
    result = _match(mid, user)
    await match_sockets.broadcast(mid)
    return result


@app.post("/api/matches/{mid}/finish-ready")
async def set_finish_ready(mid: int, body: FinishReadyIn, user=Depends(require_role("participant"))):
    with connection() as c:
        row = c.execute("SELECT status,participant_ids,ends_at FROM matches WHERE id=%s FOR UPDATE", (mid,)).fetchone()
        if not row or user["id"] not in row[1]:
            raise HTTPException(403, "Нет доступа к раунду")
        if row[0] != "active" or not row[2] or datetime.now(timezone.utc) >= row[2]:
            raise HTTPException(409, "Раунд уже завершается или завершён")
        if body.ready:
            c.execute("INSERT INTO match_finish_ready(match_id,user_id) VALUES (%s,%s) ON CONFLICT DO NOTHING", (mid,user["id"]))
        else:
            c.execute("DELETE FROM match_finish_ready WHERE match_id=%s AND user_id=%s", (mid,user["id"]))
        ready_count = c.execute("SELECT count(*) FROM match_finish_ready WHERE match_id=%s AND user_id=ANY(%s)", (mid,row[1])).fetchone()[0]
        if len(row[1]) == 2 and ready_count == 2:
            c.execute("UPDATE matches SET ends_at=now() WHERE id=%s", (mid,))
    result = _match(mid, user)
    await match_sockets.broadcast(mid)
    return result


@app.put("/api/matches/{mid}/draft")
async def save_team_draft(mid: int, body: TeamDraftIn, user=Depends(require_role("participant"))):
    with connection() as c:
        row = c.execute(
            "SELECT mode,status,participant_ids,ends_at FROM matches WHERE id=%s FOR UPDATE",
            (mid,),
        ).fetchone()
        if not row or user["id"] not in row[2]:
            raise HTTPException(403, "Нет доступа к раунду")
        if row[0] != "team":
            raise HTTPException(409, "Общий код доступен только в командном раунде")
        if row[1] != "active" or not row[3] or datetime.now(timezone.utc) >= row[3]:
            raise HTTPException(409, "Командный раунд уже завершён")
        if c.execute(
            "SELECT 1 FROM match_tasks WHERE match_id=%s AND task_id=%s",
            (mid, body.task_id),
        ).fetchone() is None:
            raise HTTPException(404, "Задача не входит в этот раунд")
        c.execute(
            "INSERT INTO match_drafts(match_id,task_id,source_code,updated_by,updated_at) VALUES(%s,%s,%s,%s,now()) "
            "ON CONFLICT(match_id,task_id) DO UPDATE SET source_code=EXCLUDED.source_code,updated_by=EXCLUDED.updated_by,updated_at=now()",
            (mid, body.task_id, body.source_code, user["id"]),
        )
    result = _match(mid, user)
    await match_sockets.broadcast(mid)
    return result


@app.post("/api/matches/join")
async def join_match(body: JoinIn, user=Depends(require_role("participant"))):
    from datetime import timedelta

    with connection() as c:
        r = c.execute(
            "SELECT id,creator_id,participant_ids,duration_minutes,status FROM matches WHERE invite_code=%s FOR UPDATE",
            (body.invite_code,),
        ).fetchone()
        if not r:
            raise HTTPException(404, "Приглашение недоступно")
        if user["id"] in r[2] and r[4] != "cancelled":
            return _match(r[0], user)
        if r[4] != "waiting":
            raise HTTPException(404, "Приглашение недоступно")
        start = datetime.now(timezone.utc)
        ends = start + timedelta(minutes=r[3])
        c.execute(
            "UPDATE matches SET participant_ids=ARRAY[%s,%s]::bigint[],status='active',started_at=%s,ends_at=%s WHERE id=%s",
            (r[1], user["id"], start, ends, r[0]),
        )
    result = _match(r[0], user)
    await match_sockets.broadcast(r[0])
    asyncio.create_task(_finish_match_at(r[0], ends, user))
    return result


@app.get("/api/contests/{cid}/integrity/submissions")
def integrity_submissions(cid: int, user=Depends(require_role("organizer"))):
    with connection() as c:
        owner = c.execute(
            "SELECT organizer_id FROM contests WHERE id=%s", (cid,)
        ).fetchone()
        if not owner:
            raise HTTPException(404, "Контест не найден")
        if owner[0] != user["id"]:
            raise HTTPException(403, "Только организатор контеста")
        rows = c.execute(
            "SELECT id,contest_id,task_id,user_id,match_id,source_code,language,verdict,created_at,checked_at,error FROM submissions WHERE contest_id=%s AND match_id IS NULL ORDER BY user_id,task_id,created_at",
            (cid,),
        ).fetchall()
    keys = (
        "id",
        "contest_id",
        "task_id",
        "user_id",
        "match_id",
        "source_code",
        "language",
        "verdict",
        "created_at",
        "checked_at",
        "error",
    )
    return [dict(zip(keys, row)) for row in rows]


@app.post("/api/contests/{cid}/integrity/analyze")
def integrity_analyze(cid: int, user=Depends(require_role("organizer"))):
    from datetime import timedelta

    with connection() as c:
        row = c.execute(
            "SELECT organizer_id,starts_at,duration_minutes FROM contests WHERE id=%s",
            (cid,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Контест не найден")
        if row[0] != user["id"]:
            raise HTTPException(403, "Только организатор контеста")
        if datetime.now(timezone.utc) < row[1] + timedelta(minutes=row[2]):
            raise HTTPException(409, "Анализ доступен после окончания контеста")
    raise HTTPException(503, "JPlag не настроен; анализ не выполнялся")


@app.get("/api/contests/{cid}/integrity/reports")
def integrity_reports(cid: int, user=Depends(require_role("organizer"))):
    with connection() as c:
        owner = c.execute(
            "SELECT organizer_id FROM contests WHERE id=%s", (cid,)
        ).fetchone()
        if not owner:
            raise HTTPException(404, "Контест не найден")
        if owner[0] != user["id"]:
            raise HTTPException(403, "Только организатор контеста")
        return [
            dict(zip(("id", "contest_id", "created_at", "engine", "details"), x))
            for x in c.execute(
                "SELECT id,contest_id,created_at,engine,details FROM integrity_reports WHERE contest_id=%s ORDER BY id DESC",
                (cid,),
            ).fetchall()
        ]


@app.post("/api/contests/{cid}/integrity/conclusions", status_code=201)
def integrity_conclusion(cid: int, body: dict, user=Depends(require_role("organizer"))):
    subject = body.get("subject_user_id")
    comment = body.get("comment")
    if (
        not isinstance(subject, int)
        or not isinstance(comment, str)
        or not comment.strip()
    ):
        raise HTTPException(422, "Нужны subject_user_id и непустой comment")
    with connection() as c:
        owner = c.execute(
            "SELECT organizer_id FROM contests WHERE id=%s", (cid,)
        ).fetchone()
        if not owner:
            raise HTTPException(404, "Контест не найден")
        if owner[0] != user["id"]:
            raise HTTPException(403, "Только организатор контеста")
        if not c.execute(
            "SELECT 1 FROM registrations WHERE contest_id=%s AND user_id=%s",
            (cid, subject),
        ).fetchone():
            raise HTTPException(404, "Участник контеста не найден")
        r = c.execute(
            "INSERT INTO integrity_conclusions(contest_id,organizer_id,subject_user_id,comment) VALUES(%s,%s,%s,%s) RETURNING id,created_at",
            (cid, user["id"], subject, comment.strip()),
        ).fetchone()
    return {
        "id": r[0],
        "contest_id": cid,
        "organizer_id": user["id"],
        "subject_user_id": subject,
        "comment": comment.strip(),
        "created_at": r[1],
    }


attach_browser_activity_routes(
    app, connection=connection, current_user=current_user, require_role=require_role
)
attach_code_history_routes(
    app, connection=connection, current_user=current_user, require_role=require_role
)


@app.websocket("/api/ws/matches/{mid}")
async def match_ws(ws: WebSocket, mid: int, token: str):
    try:
        user = user_by_id(decode_token(token))
        data = _match(mid, user)
    except HTTPException as exc:
        await ws.close(code=4401 if exc.status_code == 401 else 4403)
        return
    ws.state.match_user = user
    await ws.accept()
    await match_sockets.add(mid, ws)
    await ws.send_json(jsonable_encoder({"type": "match.updated", "match": data}))
    try:
        while True:
            await ws.receive_text()
            await ws.send_json(jsonable_encoder({"type": "match.updated", "match": _match(mid, user)}))
    except WebSocketDisconnect:
        match_sockets.remove(mid, ws)
