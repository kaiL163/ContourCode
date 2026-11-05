import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, type Contest, type IntegrityReport, type StandingRow, type Submission, type Task } from './api';
import './ConnectedIntegrity.css';
import VerdictBadge from './VerdictBadge';

type Props = { contests: Contest[]; tasks: Task[]; organizerId: number };
const errorText = (error:unknown) => error instanceof ApiError ? error.message : 'Не удалось получить данные. Попробуйте ещё раз.';
const fmt = (date:string) => new Date(date).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'});

export default function ConnectedIntegrity({contests,tasks,organizerId}:Props) {
  const own = useMemo(()=>contests.filter(c=>c.organizer_id===organizerId),[contests,organizerId]);
  const [contestId,setContestId] = useState<number|null>(null);
  const [rows,setRows] = useState<Submission[]>([]);
  const [reports,setReports] = useState<IntegrityReport[]>([]);
  const [participants,setParticipants] = useState<StandingRow[]>([]);
  const [subject,setSubject] = useState<number|null>(null);
  const [selected,setSelected] = useState<number|null>(null);
  const [comment,setComment] = useState('');
  const [pending,setPending] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [revision,setRevision] = useState(0);
  useEffect(()=>{if(!own.some(c=>c.id===contestId)) setContestId(own[0]?.id??null)},[own,contestId]);
  useEffect(()=>{
    if(contestId===null) {setRows([]);setReports([]);setParticipants([]);return;}
    let active=true;setPending(true);setError('');setNotice('');setRows([]);setReports([]);setParticipants([]);setSubject(null);setSelected(null);
    Promise.all([api.integritySubmissions(contestId),api.integrityReports(contestId),api.standings(contestId)]).then(([history,reportList,standing])=>{
      if(!active)return;setRows(history);setReports(reportList);setParticipants(standing.rows);
      const first=history[0]?.user_id??standing.rows[0]?.user_id??null;setSubject(first);setSelected(history.find(s=>s.user_id===first)?.id??null);
    }).catch(e=>{if(active)setError(errorText(e))}).finally(()=>{if(active)setPending(false)});
    return ()=>{active=false};
  },[contestId,revision]);
  const names = useMemo(()=>new Map(participants.map(p=>[p.user_id,p.display_name])),[participants]);
  const subjects = useMemo(()=>Array.from(new Set([...participants.map(p=>p.user_id),...rows.map(s=>s.user_id)])),[participants,rows]);
  const shown = rows.filter(s=>s.user_id===subject);
  const current = shown.find(s=>s.id===selected)??shown[0];
  const latest = reports[0];
  const analyze = async()=>{if(contestId===null)return;setBusy(true);setError('');setNotice('');try{await api.integrityAnalyze(contestId);setRevision(x=>x+1);setNotice('Анализ завершён.')}catch(e){setError(errorText(e))}finally{setBusy(false)}};
  const save = async()=>{if(contestId===null||subject===null||!comment.trim()){setError('Выберите участника и заполните заключение.');return}setBusy(true);setError('');setNotice('');try{await api.integrityConclusion(contestId,{subject_user_id:subject,comment:comment.trim()});setComment('');setNotice('Заключение сохранено.')}catch(e){setError(errorText(e))}finally{setBusy(false)}};
  return <>
    <div className="page-heading"><div><h1>Проверка прохождения</h1><p>История отправок и отчёты о сходстве помогают организатору изучить решения.</p></div></div>
    <div className="integrity-callout"><div><b>Решение принимает организатор</b><p>Сходство программ само по себе не доказывает нарушение.</p></div></div>
    {!own.length?<div className="panel empty-state"><b>Нет доступных контестов</b><span>Создайте контест, чтобы просматривать отправки.</span></div>:<>
      <label className="field-label" htmlFor="integrity-contest">Контест</label>
      <select className="participant-select" id="integrity-contest" value={contestId??''} onChange={e=>setContestId(Number(e.target.value))}>{own.map(c=><option value={c.id} key={c.id}>{c.title}</option>)}</select>
      {error&&<div role="alert" className="form-note">{error} <button type="button" className="text-link" onClick={()=>setRevision(x=>x+1)}>Повторить загрузку</button></div>}
      {notice&&<div role="status" className="form-note">{notice}</div>}
      {pending?<div className="panel" role="status">Загружаем отправки…</div>:<div className="integrity-layout">
        <section className="panel integrity-history"><div className="panel-heading"><div><h2>История отправок</h2></div></div>
          {subjects.length?<><label className="field-label" htmlFor="integrity-subject">Участник</label><select id="integrity-subject" className="participant-select" value={subject??''} onChange={e=>{const id=Number(e.target.value);setSubject(id);setSelected(rows.find(s=>s.user_id===id)?.id??null)}}>{subjects.map(id=><option key={id} value={id}>{names.get(id)??`Участник #${id}`}</option>)}</select>
          {shown.length?<><div className="history-timeline">{shown.map(s=><div className="timeline-row" key={s.id}><span className="timeline-time">{fmt(s.created_at)}</span><span className="timeline-node"><i/></span><div className="timeline-entry"><b>{tasks.find(t=>t.id===s.task_id)?.title??`Задача #${s.task_id}`}</b><span>{s.language} · <VerdictBadge verdict={s.verdict}/></span><button type="button" className="text-link code-open" aria-pressed={current?.id===s.id} onClick={()=>setSelected(s.id)}>Посмотреть код</button></div></div>)}</div>{current&&<div className="code-compare"><div className="code-title"><span>Отправка #{current.id}</span><VerdictBadge verdict={current.verdict}/></div><pre>{current.source_code}</pre></div>}</>:<div className="empty-state"><b>Отправок пока нет</b><span>У этого участника ещё нет решений в контесте.</span></div>}</>:<div className="empty-state"><b>Нет участников</b><span>Здесь появятся участники и их отправки.</span></div>}
        </section>
        <section className="panel similarity-panel"><div className="panel-heading"><h2>Сравнение решений</h2><button type="button" className="button secondary" onClick={analyze} disabled={busy||pending}>Запустить анализ</button></div>
          {latest?<><p className="body-copy">Отчёт от {fmt(latest.created_at)} · {latest.engine}</p><pre className="integrity-report">{JSON.stringify(latest.details,null,2)}</pre></>:<div className="empty-state"><b>Отчётов пока нет</b><span>После завершения контеста можно запустить сравнение решений.</span></div>}
          <div className="human-review"><h3>Заключение организатора</h3><label className="field-label" htmlFor="integrity-comment">Комментарий</label><textarea id="integrity-comment" value={comment} onChange={e=>setComment(e.target.value)} placeholder="Опишите результаты рассмотрения" rows={4}/><div><button type="button" className="button primary" onClick={save} disabled={busy||subject===null}>Сохранить заключение</button></div></div>
        </section>
      </div>}
    </>}
  </>;
}
