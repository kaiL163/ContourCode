import Login from './Login';
import ConnectedIntegrity from './ConnectedIntegrity';
import { ContestList, TaskView, ResultsView, MatchView, OrganizerView, TasksView } from './LiveViews';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, setApiToken, type User, type Task as ApiTask, type Contest as ApiContest, type Submission as ApiSubmission, type Match as ApiMatch } from './api';

type ThemePreference = 'system' | 'light' | 'dark';
const themeStorageKey = 'kontur-kod-theme';

function readThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(themeStorageKey);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch { return 'system'; }
}

function ThemeSwitcher({ value, onChange }: { value: ThemePreference; onChange: (value: ThemePreference) => void }) {
  return <fieldset className="theme-switcher"><legend>Тема оформления</legend><div role="group" aria-label="Выбор темы" className="theme-options">{([['system','Системная'],['light','Светлая'],['dark','Тёмная']] as const).map(([theme,label])=><button key={theme} type="button" aria-pressed={value===theme} onClick={()=>onChange(theme)}>{label}</button>)}</div></fieldset>;
}

type Role = 'participant' | 'organizer';
type Page = 'home' | 'contests' | 'contest' | 'results' | 'duel' | 'team' | 'tasks' | 'integrity' | 'create-task' | 'create-contest';
type Verdict = 'OK' | 'WA' | 'TLE' | 'RE' | 'CE' | 'В очереди';
type Submission = { id: number; name: string; task: string; verdict: Verdict; time: string; points: number };
const icons: Record<string, string> = {
  grid:'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z',
  trophy:'M8 21h8m-4-4v4m0-4a6 6 0 0 0 6-6V4H6v7a6 6 0 0 0 6 6ZM6 7H3v2a4 4 0 0 0 4 4m11-6h3v2a4 4 0 0 1-4 4',
  code:'m8 17-5-5 5-5m8 0 5 5-5 5m-3-12-2 14',
  chart:'M4 19V9m5 10V5m5 14v-7m5 7V3',
  swords:'m14.5 17.5 3 3m-14-14 3 3m0 0L19 3l2 2L9.5 16.5m0 0-3 3m-1-1 2-2m8-8 3 3m0 0 2 2m-2-2 2-2m-2 2-2 2',
  users:'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m6-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm11 10v-2a4 4 0 0 0-3-3.87m-1-12.13a4 4 0 0 1 0 7.75',
  list:'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  shield:'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Zm-3-11 2 2 4-4',
  plus:'M12 5v14m-7-7h14',
  arrow:'M5 12h14m-7-7 7 7-7 7',
  clock:'M12 8v4l3 2m7-2a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  search:'m21 21-4.35-4.35M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0Z',
  copy:'M8 8V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-4m-12 6h10a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2Z',
  bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 13h4',
  back:'m15 18-6-6 6-6M20 12H9',
};
function Icon({name,size=19}:{name:string;size?:number}) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[name]||icons.grid}/></svg>; }

const verdictLabel: Record<Verdict,string> = {OK:'Принято',WA:'Неверный ответ',TLE:'Превышено время',RE:'Ошибка выполнения',CE:'Ошибка компиляции','В очереди':'В очереди'};

export default function App(){
  const [theme, setTheme] = useState<ThemePreference>(readThemePreference);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    };
    applyTheme();
    try { localStorage.setItem(themeStorageKey, theme); } catch { /* Storage is optional. */ }
    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, [theme]);
  const [role,setRole]=useState<Role|null>(null); const [user,setUser]=useState<User|null>(null); const [authError,setAuthError]=useState(''); const [page,setPage]=useState<Page>('home'); const [toast,setToast]=useState('');
  const [apiTasks,setApiTasks]=useState<ApiTask[]>([]); const [apiContests,setApiContests]=useState<ApiContest[]>([]); const [apiSubs,setApiSubs]=useState<ApiSubmission[]>([]); const [activeContest,setActiveContest]=useState<ApiContest|null>(null); const [activeMatch,setActiveMatch]=useState<ApiMatch|null>(null); const [liveError,setLiveError]=useState('');
  const [subs,setSubs]=useState<Submission[]>([]); const [code,setCode]=useState('#include <iostream>\nusing namespace std;\n\nint main() {\n  int a, b;\n  cin >> a >> b;\n  cout << a + b;\n  return 0;\n}');
  const [activeTask,setActiveTask]=useState('A. Сумма чисел'); const [inviteCopied,setInviteCopied]=useState(false); const [joined,setJoined]=useState(false); const [joinedContest,setJoinedContest]=useState(false); const [loading,setLoading]=useState(false); const [query,setQuery]=useState(''); const [createdTasks,setCreatedTasks]=useState<string[]>([]); const [createdContests,setCreatedContests]=useState<string[]>([]); const [notice,setNotice]=useState('');
  const [mobileNav,setMobileNav]=useState(false);
  const toastTimer=useRef<number|undefined>(undefined);
  useEffect(()=>()=>window.clearTimeout(toastTimer.current),[]);
  const ping=(message:string)=>{setToast(message);window.clearTimeout(toastTimer.current);toastTimer.current=window.setTimeout(()=>{setToast('');toastTimer.current=undefined},3000)};
  const login=async (username:string,password:string)=>{setAuthError('');try{const result=await api.login(username,password);setApiToken(result.access_token);setUser(result.user);setRole(result.user.role);const inviteMode=new URLSearchParams(window.location.search).get('mode');setPage(result.user.role==='participant'&&(inviteMode==='duel'||inviteMode==='team')?inviteMode:result.user.role==='participant'?'contests':'home');ping(`Вы вошли: ${result.user.display_name}`)}catch(e){setAuthError(e instanceof ApiError?e.message:'Не удалось войти')}};
  useEffect(()=>{if(!role)return;let alive=true;Promise.all([api.tasks(),api.contests()]).then(([t,c])=>{if(alive){setApiTasks(t);setApiContests(c);setActiveContest(previous=>c.find(item=>item.id===previous?.id)??c[0]??null)}}).catch(e=>{if(alive)setLiveError(e instanceof ApiError?e.message:'Ошибка загрузки данных')});return()=>{alive=false}},[role]);
  const logout=()=>{setApiToken(null);setUser(null);setRole(null);setPage('home');setMobileNav(false);setApiTasks([]);setApiContests([]);setActiveContest(null);setActiveMatch(null);setLiveError('')};
  const refreshContests=()=>{api.contests().then(c=>{setApiContests(c);setActiveContest(previous=>c.find(item=>item.id===previous?.id)??c[0]??null)}).catch(e=>setLiveError(e instanceof ApiError?e.message:'Не удалось загрузить соревнования'))};
  const navItems: {id:Page;label:string;icon:string}[]=role==='organizer'?[{id:'home',label:'Обзор',icon:'grid'},{id:'tasks',label:'Задачи',icon:'code'},{id:'contests',label:'Контесты',icon:'trophy'},{id:'integrity',label:'Проверка прохождения',icon:'shield'}]:[{id:'contests',label:'Соревнования',icon:'trophy'},{id:'contest',label:'Задачи контеста',icon:'list'},{id:'results',label:'Результаты',icon:'chart'},{id:'duel',label:'Дуэль 1 на 1',icon:'swords'},{id:'team',label:'Команда из двух',icon:'users'}];
  const go=(p:Page)=>{setPage(p);setMobileNav(false);setNotice('')};
  const filteredSubs=useMemo(()=>subs.filter(s=>(s.name+' '+s.task+' '+s.verdict).toLowerCase().includes(query.toLowerCase())),[subs,query]);
  const submit=async()=>{if(!code.trim()){ping('Добавьте код решения перед отправкой');return}const contest=activeContest??apiContests[0];const task=apiTasks.find(t=>t.title===activeTask.replace(/^[A-Z]\. /,''))??apiTasks.find(t=>contest?.task_ids.includes(t.id));if(!contest||!task){setLiveError('Для отправки нужны загруженный контест и задача из его списка.');return}setLoading(true);setLiveError('');try{const sent=await api.submit({contest_id:contest.id,task_id:task.id,source_code:code});const latest=await api.submission(sent.id);setApiSubs(current=>[latest,...current.filter(x=>x.id!==latest.id)]);setSubs(current=>[{id:latest.id,name:user?.display_name??'Вы',task:task.title,verdict:latest.verdict as unknown as Verdict,time:new Date(latest.created_at).toLocaleString('ru-RU'),points:latest.verdict==='OK'?100:0},...current]);ping(`Отправка #${latest.id}: ${latest.verdict}`)}catch(e){setLiveError(e instanceof ApiError?e.message:'Не удалось отправить решение')}finally{setLoading(false)}};
  const formSubmit=async(e:FormEvent<HTMLFormElement>,kind:'task'|'contest')=>{e.preventDefault();const data=new FormData(e.currentTarget);const title=String(data.get('title')||'').trim();setLoading(true);setLiveError('');try{if(kind==='task'){const time=String(data.get('time')||'1 секунда');const memory=String(data.get('memory')||'256 МБ');const created=await api.createTask({title,statement:String(data.get('description')||''),time_limit_ms:time.startsWith('2')?2000:time.startsWith('3')?3000:1000,memory_limit_kb:memory.startsWith('512')?524288:262144,tests:[{input:String(data.get('sampleInput')||''),output:String(data.get('sampleOutput')||'')}]});setApiTasks(x=>[created,...x]);go('tasks');ping('Задача создана')}else{const ids=data.getAll('selectedTasks').map(Number).filter(Number.isInteger);if(!ids.length){ping('Выберите хотя бы одну задачу');return}const date=String(data.get('date')||'');if(!date){ping('Укажите дату и время начала');return}const created=await api.createContest({title,description:String(data.get('description')||''),starts_at:new Date(date).toISOString(),duration_minutes:Number(String(data.get('duration')||'60').match(/\d+/)?.[0]||60),task_ids:ids});setApiContests(x=>[created,...x]);go('contests');ping('Контест создан')}}catch(e){setLiveError(e instanceof ApiError?e.message:'Не удалось создать элемент')}finally{setLoading(false)}};
  if(!role||!user)return <Login onEnter={login} error={authError} themeControl={<ThemeSwitcher value={theme} onChange={setTheme}/>}/>;
  return (
    <div className="app-shell">
    <a className="skip-link" href="#main">К основному содержимому</a>
    <header className="topbar">
      <button className="brand" onClick={()=>go(role==='participant'?'contests':'home')} aria-label="КонтурКод — на главную"><span className="brand-mark"><i/><i/><i/></span><span>контур<span className="brand-strong">код</span><small>алгоритмические соревнования</small></span></button>
      <div className="topbar-right"><ThemeSwitcher value={theme} onChange={setTheme}/><button className="top-icon" aria-label="Уведомления" onClick={()=>ping('Новых уведомлений нет')}><Icon name="bell"/></button><div className="user-menu"><span className="avatar">{user.display_name.split(' ').map(part=>part[0]).join('').slice(0,2).toUpperCase()}</span><span className="user-meta">{user.display_name}<small>{role==='participant'?'Участник':'Организатор'}</small></span><button className="text-button" onClick={logout}>Выйти</button></div><button className="mobile-menu" aria-label={mobileNav?'Закрыть меню':'Открыть меню'} aria-expanded={mobileNav} onClick={()=>setMobileNav(!mobileNav)}><Icon name="list"/></button></div>
    </header>
    <div className="layout">
      <aside className={`sidebar ${mobileNav?'open':''}`}>
        <div className="side-eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        {navItems.map(n=><button key={n.id} className={`nav-item ${page===n.id?'active':''}`} onClick={()=>go(n.id)}><Icon name={n.icon}/><span>{n.label}</span></button>)}
        <div className="side-bottom"><button className="text-button" onClick={logout}>Выйти</button></div>
      </aside>
      <main id="main" className="main-content" tabIndex={-1}>{liveError&&<div role="alert" className="form-note">{liveError}<button className="text-link" onClick={()=>setLiveError('')}>Закрыть</button></div>}
      {page==='contests'&&<ContestList contests={apiContests} user={user} onSelect={setActiveContest} onRefresh={refreshContests} go={go}/>}
      {page==='contest'&&<TaskView contest={activeContest} tasks={apiTasks} user={user} match={activeMatch} go={go}/>}
      {page==='results'&&<ResultsView contest={activeContest} tasks={apiTasks} user={user} go={go}/>}
      {page==='duel'&&<MatchView mode="duel" contest={activeContest} match={activeMatch} setMatch={(m)=>{setActiveMatch(m);const c=apiContests.find(item=>item.id===m.contest_id);if(c)setActiveContest(c)}} go={go}/>}
      {page==='team'&&<MatchView mode="team" contest={activeContest} match={activeMatch} setMatch={(m)=>{setActiveMatch(m);const c=apiContests.find(item=>item.id===m.contest_id);if(c)setActiveContest(c)}} go={go}/>}
      {page==='home'&&role==='organizer'&&<OrganizerView go={go} contests={apiContests.filter(c=>c.organizer_id===user.id)} tasks={apiTasks} select={setActiveContest}/>}
      {page==='tasks'&&<TasksView tasks={apiTasks} go={go}/>}
      {page==='integrity'&&role==='organizer'&&<ConnectedIntegrity contests={apiContests} tasks={apiTasks} organizerId={user.id}/>}
      {page==='create-task'&&<CreateForm kind="task" onSubmit={formSubmit} onBack={()=>go('tasks')} tasks={apiTasks}/>}
            {page==='create-contest'&&<CreateForm kind="contest" onSubmit={formSubmit} onBack={()=>go('home')} tasks={apiTasks}/>}
                  </main>
      <div className="mobile-bottom">{navItems.slice(0,4).map(n=><button key={n.id} className={page===n.id?'selected':''} onClick={()=>go(n.id)} aria-label={n.label}><Icon name={n.icon}/><span>{n.label.split(' ')[0]}</span></button>)}</div>
      {toast&&<div role="status" className="toast"><span className="toast-check">✓</span>{toast}</div>}
    </div>
    </div>
  );
}

function PageHeading({eyebrow,title,desc,action}:{eyebrow:string;title:string;desc:string;action?:React.ReactNode}){return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{desc}</p></div>{action&&<div className="heading-action">{action}</div>}</div>}
function CreateForm({kind,onSubmit,onBack,tasks}:{kind:'task'|'contest';onSubmit:(e:FormEvent<HTMLFormElement>,k:'task'|'contest')=>void;onBack:()=>void;tasks:ApiTask[]}){const task=kind==='task';return <><div className="back-row"><button className="back-link" onClick={onBack}><Icon name="back"/>Назад</button></div><PageHeading eyebrow={task?'БИБЛИОТЕКА ЗАДАЧ':'КАЛЕНДАРЬ СОРЕВНОВАНИЙ'} title={task?'Новая задача':'Новый контест'} desc={task?'Подготовьте условие, ограничения и тестовые примеры.':'Выберите задачи, задайте время и соберите новый раунд.'}/><form className="panel create-form" onSubmit={e=>onSubmit(e,kind)}><label className="field-label" htmlFor="form-title">{task?'Название задачи':'Название контеста'} *</label><input id="form-title" name="title" required minLength={3} maxLength={80} placeholder={task?'Например, Сумма чисел':'Например, Вечерний спринт'}/><div className="form-two">{task?<><div><label className="field-label" htmlFor="time-limit">Лимит времени</label><select id="time-limit" name="time"><option>1 секунда</option><option>2 секунды</option><option>3 секунды</option></select></div><div><label className="field-label" htmlFor="mem-limit">Лимит памяти</label><select id="mem-limit" name="memory"><option>256 МБ</option><option>512 МБ</option></select></div></>:<><div><label className="field-label" htmlFor="date">Дата и время</label><input id="date" type="datetime-local" name="date"/></div><div><label className="field-label" htmlFor="duration">Длительность</label><select id="duration" name="duration"><option>60 минут</option><option>90 минут</option><option>120 минут</option></select></div></>}</div>{!task&&<fieldset className="task-picker"><legend className="field-label">Задачи раунда *</legend>{tasks.map((t,i)=><label key={`${t}-${i}`}><input type="checkbox" name="selectedTasks" value={t.id} defaultChecked={i===0}/><span className="task-letter">{String.fromCharCode(65+i)}</span><span>{t.title}</span><small>{i%2===0?'100 баллов':'200 баллов'}</small></label>)}</fieldset>}<label className="field-label" htmlFor="description">{task?'Условие задачи':'Описание'}</label><textarea id="description" name="description" rows={5} placeholder={task?'Формат ввода, ограничения и формат вывода…':'Кратко расскажите участникам о контесте…'}/>{task&&<div className="form-two example-fields"><div><label className="field-label" htmlFor="sample-input">Пример входных данных</label><textarea id="sample-input" name="sampleInput" rows={2} placeholder="2 3"/></div><div><label className="field-label" htmlFor="sample-output">Пример выходных данных</label><textarea id="sample-output" name="sampleOutput" rows={2} placeholder="5"/></div></div>}<div className="form-actions"><button type="button" className="button secondary" onClick={onBack}>Отмена</button><button className="button primary">Создать {task?'задачу':'контест'} <Icon name="arrow"/></button></div></form></>}
