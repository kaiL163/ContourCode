import { useEffect, useRef, useState } from "react";
import CodeEditor from "./CodeEditor";
import {
  api,
  ApiError,
  type Contest,
  type Match,
  type StandingRow,
  type Submission,
  type Task,
  type TaskDifficulty,
  type User,
} from "./api";
import VerdictBadge from "./VerdictBadge";
import { ContestCover } from "./ContestPage";
import BrowserActivityMonitor from "./BrowserActivityMonitor";
import CodeHistoryPanel from "./CodeHistoryPanel";
import { useCodeHistory, type SaveStatus } from "./useCodeHistory";
import {
  demoExamplesForTask,
  sumDemoNames,
  type SumDemoName,
} from "./sumDemoExamples";

type Go = (
  page:
    | "home"
    | "contests"
    | "contest"
    | "match-workspace"
    | "duel-history"
    | "team-history"
    | "contest-detail"
    | "results"
    | "duel"
    | "team"
    | "tasks"
    | "integrity"
    | "activity"
    | "create-task"
    | "create-contest",
) => void;
const errorText = (e: unknown) =>
  e instanceof ApiError ? e.message : "Не удалось загрузить данные";
const date = (s: string) =>
  new Date(s).toLocaleString("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
const defaultCode =
  "#include <iostream>\nusing namespace std;\n\nint main() {\n  return 0;\n}";

function FinishReady({
  match,
  userId,
  onUpdate,
}: {
  match: Match;
  userId: number;
  onUpdate: (match: Match) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (match.status !== "active" || match.participant_ids.length !== 2)
    return null;
  const ready = match.finish_ready_ids ?? [];
  const mine = ready.includes(userId);
  const partner = match.progress.find((p) => p.user_id !== userId);
  const partnerReady = partner && ready.includes(partner.user_id);
  const closing = match.ends_at && Date.parse(match.ends_at) <= Date.now();
  async function toggleReady() {
    setBusy(true);
    setError("");
    try {
      onUpdate(await api.setFinishReady(match.id, !mine));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="match-finish-ready" aria-live="polite">
      {closing ? (
        <p>Раунд завершается. Ожидаем результаты проверки отправок.</p>
      ) : (
        <>
          <p>
            {mine
              ? "Вы готовы завершить раунд."
              : "Досрочное завершение возможно, когда оба участника готовы."}{" "}
            {partnerReady
              ? `${partner.display_name}: готовность подтверждена.`
              : ""}
          </p>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={toggleReady}
          >
            {busy
              ? "Сохраняем…"
              : mine
                ? "Отменить готовность"
                : "Готов завершить"}
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

function DuelExit({
  match,
  onUpdate,
}: {
  match: Match;
  onUpdate: (match: Match) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setConfirming(false);
    setError("");
  }, [match.id, match.status]);
  if (match.mode !== "duel" || !["waiting", "active"].includes(match.status))
    return null;
  const waiting = match.status === "waiting";
  async function leave() {
    setBusy(true);
    setError("");
    try {
      onUpdate(await api.forfeitDuel(match.id));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="duel-exit">
      {!confirming ? (
        <button
          type="button"
          className="button secondary"
          onClick={() => setConfirming(true)}
        >
          {waiting ? "Отменить приглашение" : "Сдаться"}
        </button>
      ) : (
        <div
          role="group"
          aria-label={waiting ? "Отмена приглашения" : "Подтверждение сдачи"}
        >
          <p>
            {waiting
              ? "Приглашение перестанет действовать."
              : "Дуэль завершится, а победа достанется сопернику."}
          </p>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            Вернуться
          </button>{" "}
          <button
            type="button"
            className="button primary"
            disabled={busy}
            onClick={leave}
          >
            {busy
              ? "Завершаем…"
              : waiting
                ? "Отменить приглашение"
                : "Подтвердить сдачу"}
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function ContestList({
  contests,
  user,
  onSelect,
  go,
}: {
  contests: Contest[];
  user: User;
  onSelect: (c: Contest) => void;
  onRefresh: () => void;
  go: Go;
}) {
  const [page, setPage] = useState(1);
  const pageSize = 4;
  const pageCount = Math.max(1, Math.ceil(contests.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const shown = [...contests]
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
    .slice((currentPage - 1) * pageSize, currentPage * pageSize);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Соревнования</h1>
          <p>
            Выберите соревнование, чтобы узнать подробности и перейти к задачам.
          </p>
        </div>
        {user.role === "organizer" && (
          <button
            className="button primary"
            onClick={() => go("create-contest")}
          >
            Создать контест
          </button>
        )}
      </div>
      <div className="contest-catalog">
        {contests.length ? (
          shown.map((c) => (
            <article className="contest-catalog-row" key={c.id}>
              <ContestCover contest={c} />
              <div className="contest-catalog-info">
                <h2>{c.title}</h2>
                <p>
                  {c.description || "Описание соревнования пока не добавлено."}
                </p>
                <div className="contest-facts">
                  <span>
                    {Date.parse(c.starts_at) > Date.now()
                      ? "Скоро"
                      : Date.now() <
                          Date.parse(c.starts_at) + c.duration_minutes * 60000
                        ? "Идёт"
                        : "Завершено"}
                  </span>
                  <span>{date(c.starts_at)}</span>
                  <span>{c.duration_minutes} мин</span>
                  <span>Задач: {c.task_ids.length}</span>
                </div>
              </div>
              <button
                className="button secondary"
                onClick={() => {
                  onSelect(c);
                  go("contest-detail");
                }}
              >
                Открыть
              </button>
            </article>
          ))
        ) : (
          <p className="body-copy">Пока нет доступных соревнований.</p>
        )}
      </div>
      {pageCount > 1 && (
        <nav className="personal-pagination" aria-label="Страницы соревнований">
          <span aria-live="polite">
            Страница {currentPage} из {pageCount}
          </span>
          <div>
            <button
              type="button"
              className="button secondary"
              disabled={currentPage === 1}
              onClick={() => setPage(currentPage - 1)}
            >
              Назад
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={currentPage === pageCount}
              onClick={() => setPage(currentPage + 1)}
            >
              Далее
            </button>
          </div>
        </nav>
      )}
    </>
  );
}
export function TaskView({
  contest,
  tasks,
  user,
  match,
  go,
  initialTaskId,
  onMatchUpdate,
}: {
  contest: Contest | null;
  tasks: Task[];
  user: User;
  match: Match | null;
  go: Go;
  initialTaskId?: number | null;
  onMatchUpdate?: (match: Match) => void;
}) {
  const taskIds = match ? match.task_ids : (contest?.task_ids ?? []);
  const available = tasks.filter((t) => taskIds.includes(t.id));
  const [id, setId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Task | null>(null);
  const [code, setCode] = useState(defaultCode);
  const [codeByTask, setCodeByTask] = useState<Record<number, string>>({});
  const [draftReadyTaskId, setDraftReadyTaskId] = useState<number | null>(null);
  const lastRemoteCode = useRef<string | null>(null);
  const [demo, setDemo] = useState<SumDemoName | null>(null);
  const [result, setResult] = useState<Submission | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [historyFromMemory, setHistoryFromMemory] = useState(false);
  const saveLabel: Record<SaveStatus, string> = {
    idle: "",
    saving: "Сохранение…",
    saved: "Сохранено",
    failed: "Не удалось сохранить",
  };
  const history = useCodeHistory({
    enabled: user.role === "participant" && Boolean(match || contest),
    userId: user.id,
    contestId: match ? null : (contest?.id ?? null),
    matchId: match?.id ?? null,
    taskId: id,
    code,
    ready: draftReadyTaskId === id && id != null,
    fromMemory: historyFromMemory,
    allowPending: match?.mode !== "team",
    onRestore: (task, value) => {
      setCode(value);
      setCodeByTask((previous) => ({ ...previous, [task]: value }));
    },
  });
  useEffect(() => {
    if (user.role !== "participant") return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void history.saveNow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [history.saveNow, user.role]);
  useEffect(() => {
    setId(
      available.find((t) => t.id === initialTaskId)?.id ??
        available[0]?.id ??
        null,
    );
    setResult(null);
  }, [contest?.id, match?.id, tasks, initialTaskId]);
  const examples = demoExamplesForTask(available.find((t) => t.id === id));
  useEffect(() => {
    if (!id) return;
    const task = available.find((t) => t.id === id);
    const taskExamples = demoExamplesForTask(task);
    const saved = codeByTask[id];
    const sharedDraft =
      match?.mode === "team"
        ? match.drafts?.find((draft) => draft.task_id === id)?.source_code
        : undefined;
    const initialName =
      taskExamples && sumDemoNames.includes(task?.title as SumDemoName)
        ? (task?.title as SumDemoName)
        : null;
    const initial =
      sharedDraft ??
      saved ??
      (initialName && taskExamples ? taskExamples[initialName] : defaultCode);
    setCode(initial);
    setHistoryFromMemory(saved !== undefined || sharedDraft !== undefined);
    setDraftReadyTaskId(id);
    setDemo(
      taskExamples
        ? (sumDemoNames.find((name) => taskExamples[name] === initial) ?? null)
        : null,
    );
    if (saved === undefined)
      setCodeByTask((previous) => ({ ...previous, [id]: initial }));
  }, [id]);
  useEffect(() => {
    if (match?.mode !== "team" || !id) return;
    const draft = match.drafts?.find((item) => item.task_id === id);
    if (!draft || draft.updated_by === user.id || draft.source_code === code) return;
    lastRemoteCode.current = draft.source_code;
    setCode(draft.source_code);
    setCodeByTask((previous) => ({ ...previous, [id]: draft.source_code }));
  }, [match?.drafts, match?.mode, id, user.id]);
  useEffect(() => {
    if (
      match?.mode !== "team" ||
      match.status !== "active" ||
      !id ||
      draftReadyTaskId !== id ||
      lastRemoteCode.current === code
    ) return;
    const timer = window.setTimeout(() => {
      api.saveTeamDraft(match.id, id, code)
        .then((updated) => onMatchUpdate?.(updated))
        .catch((e) => setError(errorText(e)));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [code, draftReadyTaskId, id, match?.id, match?.mode, match?.status]);
  useEffect(() => {
    if (!id) return;
    let mounted = true;
    setDetail(null);
    api
      .task(id)
      .then((t) => {
        if (mounted) setDetail(t);
      })
      .catch((e) => {
        if (mounted) setError(errorText(e));
      });
    return () => {
      mounted = false;
    };
  }, [id]);
  useEffect(() => {
    if (!result || !["QUEUED", "RUNNING"].includes(result.verdict)) return;
    const timer = window.setTimeout(
      () =>
        api
          .submission(result.id)
          .then(setResult)
          .catch((e) => setError(errorText(e))),
      1500,
    );
    return () => window.clearTimeout(timer);
  }, [result]);
  async function send() {
    if (
      (!contest && !match) ||
      !id ||
      !code.trim() ||
      (match && match.status !== "active")
    )
      return;
    setError("");
    setBusy(true);
    try {
      const sessionId = await history.flush();
      setResult(
        await api.submit({
          ...(match ? { match_id: match.id } : { contest_id: contest!.id }),
          task_id: id,
          source_code: code,
          ...(sessionId ? { session_id: sessionId } : {}),
        }),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  if (!contest && !match)
    return (
      <p className="body-copy">Выберите контест в разделе «Соревнования».</p>
    );
  return (
    <>
      <div className="back-row">
        <button
          className="back-link"
          onClick={() => go(match ? match.mode : "contests")}
        >
          {match ? "← К раунду" : "← Все соревнования"}
        </button>
        <span>
          {match
            ? match.mode === "duel"
              ? "Дуэль"
              : "Командный раунд"
            : contest?.title}
        </span>
      </div>
      {contest && !match && (
        <BrowserActivityMonitor contest={contest} user={user} />
      )}
      <div className="page-heading">
        <div>
          <h1>
            {match
              ? match.mode === "duel"
                ? "Задачи дуэли"
                : "Задачи командного раунда"
              : "Задачи контеста"}
          </h1>
          <p>
            {match
              ? `${match.duration_minutes} минут · ${match.status === "active" ? "Раунд идёт" : "Раунд завершён"}`
              : `${date(contest!.starts_at)} · ${contest!.duration_minutes} минут`}
          </p>
        </div>
        {!match && (
          <button
            className="button secondary"
            onClick={() => go("results")}
          >
            Результаты
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {match && (
        <section
          className="panel match-workspace-progress"
          aria-label="Ход раунда"
        >
          <h2>Ход раунда</h2>
          <div aria-live="polite">
            {match.mode === "team" && (
              <p>
                <b>
                  Команда: {match.team_solved ?? 0} из {match.task_ids.length}{" "}
                  задач
                </b>
              </p>
            )}
            {match.progress.map((p) => (
              <p key={p.user_id}>
                {p.display_name}: решено {p.solved}
              </p>
            ))}
          </div>
          {match.ends_at && (
            <p className="body-copy">Окончание: {date(match.ends_at)}</p>
          )}
          {onMatchUpdate && (
            <FinishReady
              match={match}
              userId={user.id}
              onUpdate={onMatchUpdate}
            />
          )}
          {onMatchUpdate && <DuelExit match={match} onUpdate={onMatchUpdate} />}
        </section>
      )}
      <div className="contest-workbench">
        <nav
          className="task-switcher"
          aria-label={match ? "Задачи раунда" : "Задачи контеста"}
        >
          <span className="task-switcher-label">Задачи</span>
          <div className="task-number-list">
            {available.map((t, i) => (
              <button
                type="button"
                key={t.id}
                className={`task-number ${t.id === id ? "selected" : ""}`}
                aria-label={`Задача ${i + 1}: ${t.title}`}
                aria-pressed={t.id === id}
                title={t.title}
                disabled={busy}
                onClick={() => {
                  setId(t.id);
                  setResult(null);
                  setError("");
                }}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </nav>
        <section className="problem-panel">
          {detail ? (
            <>
              <h2>{detail.title}</h2>
              <p className="problem-copy" style={{ whiteSpace: "pre-wrap" }}>
                {detail.statement}
              </p>
              <p className="body-copy">
                Время: {detail.time_limit_ms / 1000} с · Память:{" "}
                {Math.round(detail.memory_limit_kb / 1024)} МБ
              </p>
              {detail.tests.map((t, i) => (
                <div className="example-block" key={i}>
                  <div>
                    <b>Пример {i + 1}</b>
                    <span>Ввод</span>
                    <pre>{t.input}</pre>
                    <span>Вывод</span>
                    <pre>{t.output}</pre>
                  </div>
                </div>
              ))}
            </>
          ) : (
            <p className="body-copy">
              {id ? "Загрузка задачи…" : "В контесте нет задач."}
            </p>
          )}
        </section>
        <section className="editor-panel">
          <div className="editor-header">
            <h2>{match?.mode === "team" ? "Общий код команды" : "Ваше решение"}</h2>
            <span>C++17</span>
          </div>
          <>
            {examples && (
              <>
                <label className="field-label" htmlFor="sum-demo">
                  Пример для демонстрации
                </label>
                <select
                  id="sum-demo"
                  value={demo ?? ""}
                  onChange={(e) => {
                    const value = e.target.value as SumDemoName | "";
                    setDemo(value || null);
                    if (value) {
                      setCode(examples[value]);
                      if (id)
                        setCodeByTask((previous) => ({
                          ...previous,
                          [id]: examples[value],
                        }));
                    }
                  }}
                >
                  <option value="">Не выбирать пример</option>
                  {sumDemoNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </>
            )}
          </>
          {match?.mode === "team" && match.status === "active" && (
            <p className="team-draft-hint" role="status">
              Изменения кода сохраняются для обоих участников автоматически.
            </p>
          )}
          <CodeEditor
            key={id ?? "empty"}
            value={code}
            onChange={(value) => {
              setCode(value);
              setDemo(null);
              if (id)
                setCodeByTask((previous) => ({ ...previous, [id]: value }));
            }}
          />
          <div className="editor-actions">
            {user.role === "participant" && (
              <span className={`code-save-state is-${history.status}`} role="status">
                {saveLabel[history.status]}
              </span>
            )}
            <div className="editor-action-buttons">
              {user.role === "participant" && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={!id}
                  onClick={() => void history.saveNow()}
                >
                  Сохранить
                </button>
              )}
              <button
                className="button primary"
                disabled={
                  busy ||
                  !id ||
                  user.role !== "participant" ||
                  (match !== null && match.status !== "active")
                }
                onClick={send}
              >
                {busy ? "Отправка…" : "Отправить решение"}
              </button>
            </div>
          </div>
          {result && (
            <div className="recent-result" role="status">
              Результат проверки: <VerdictBadge verdict={result.verdict} />
              {result.error && <p>{result.error}</p>}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
export function ResultsView({
  contest,
  tasks,
  user,
  go,
}: {
  contest: Contest | null;
  tasks: Task[];
  user: User;
  go: Go;
}) {
  const [rows, setRows] = useState<StandingRow[]>([]);
  const [error, setError] = useState("");
  const [taskIds, setTaskIds] = useState<number[]>([]);
  const [historyTarget, setHistoryTarget] = useState<{
    userId: number;
    name: string;
    taskId: number;
    title: string;
  } | null>(null);
  useEffect(() => {
    if (!contest) return;
    let live = true;
    const load = () =>
      api.standings(contest.id)
        .then((s) => {
          if (live) {
            setRows(s.rows);
            setTaskIds(s.task_ids);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(errorText(e));
        });
    load();
    const timer = window.setInterval(load, 5000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [contest?.id]);
  if (!contest) return <p>Выберите контест в разделе «Соревнования».</p>;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Результаты соревнования</h1>
          <p>{contest.title}</p>
        </div>
        <div className="heading-action results-navigation-actions">
          <button
            className="button secondary"
            onClick={() => go("contest-detail")}
          >
            К соревнованию
          </button>
          <button className="button secondary" onClick={() => go("contest")}>
            К задачам
          </button>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      <section className="panel results-board">
        <div className="results-board-heading">
          <div>
            <h2>Результаты участников</h2>
            <p className="body-copy">
              До 100 баллов за задачу. За каждую ошибочную проверку до первого
              решения снимается 10 баллов, не ниже нуля; после OK счёт фиксируется.
            </p>
          </div>
          <span className="results-live-indicator" role="status">
            Обновляется каждые 5 секунд
          </span>
        </div>
        {rows.length ? (
          <div className="results-board-wrap">
            <table className="results-board-table">
              <colgroup>
                <col className="results-col-rank" />
                <col className="results-col-participant" />
                <col className="results-col-tasks" />
                <col className="results-col-score" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Место</th>
                  <th scope="col">Участник</th>
                  <th scope="col">Задачи</th>
                  <th scope="col">Баллы</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.user_id}>
                    <td>{row.rank}</td>
                    <th scope="row" className="results-participant-name">
                      <span>
                        {row.display_name}{row.user_id === user.id ? " (вы)" : ""}
                      </span>
                      <small>
                        Решено {row.solved} из {taskIds.length} · {Math.floor(row.elapsed_seconds / 60)} мин
                      </small>
                    </th>
                    <td>
                      <div
                        className="results-task-grid"
                        style={{ gridTemplateColumns: `repeat(${taskIds.length}, minmax(0, 1fr))` }}
                      >
                        {taskIds.map((taskId, index) => {
                          const task = row.tasks.find((item) => item.task_id === taskId);
                          if (!task) return null;
                          const stateLabel = task.solved
                            ? "Решена"
                            : task.status === "checking"
                              ? "Проверяется"
                              : task.status === "attempted"
                                ? "Не решена"
                                : "Не начата";
                          const title = tasks.find((item) => item.id === taskId)?.title ?? `Задача ${index + 1}`;
                          const wrongCount = task.attempts;
                          const wrongLabel = wrongCount % 10 === 1 && wrongCount % 100 !== 11
                            ? "ошибка"
                            : wrongCount % 10 >= 2 && wrongCount % 10 <= 4 && (wrongCount % 100 < 12 || wrongCount % 100 > 14)
                              ? "ошибки"
                              : "ошибок";
                          return (
                            <div
                              key={taskId}
                              className={`results-task-state is-${task.status}`}
                            >
                              <b className="results-task-title">
                                <span>{String.fromCharCode(65 + (index % 26))}</span>
                                {title}
                              </b>
                              <span className="results-task-verdict">{stateLabel}</span>
                              <span className="results-task-points">
                                {task.solved || task.attempts > 0
                                  ? `${task.points}/100 баллов`
                                  : "до 100 баллов"}
                              </span>
                              {!task.solved && wrongCount > 0 && (
                                <span className="results-task-live-errors">
                                  {wrongCount} {wrongLabel} · −{task.points_lost} баллов
                                </span>
                              )}
                              {user.role === "organizer" && (
                                <button
                                  type="button"
                                  className="results-history-link"
                                  onClick={() =>
                                    setHistoryTarget({
                                      userId: row.user_id,
                                      name: row.display_name,
                                      taskId,
                                      title,
                                    })
                                  }
                                >
                                  История кода
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                    <td className="results-total-score">
                      <b>{row.score}</b>
                      <small>баллов</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="body-copy">Пока нет участников с регистрацией.</p>
        )}
      </section>
      {user.role === "organizer" && historyTarget && (
        <CodeHistoryPanel
          contestId={contest.id}
          taskId={historyTarget.taskId}
          userId={historyTarget.userId}
          participantName={historyTarget.name}
          taskTitle={historyTarget.title}
          onClose={() => setHistoryTarget(null)}
        />
      )}
    </>
  );
}
export function MatchView({
  mode,
  tasks,
  match,
  setMatch,
  go,
  userId,
}: {
  mode: "duel" | "team";
  tasks: Task[];
  match: Match | null;
  setMatch: (match: Match | null) => void;
  go: Go;
  userId: number;
}) {
  const [invite, setInvite] = useState(() => {
    const query = new URLSearchParams(window.location.search);
    return query.get("mode") === mode ? (query.get("invite") ?? "") : "";
  });
  const [duration, setDuration] = useState(60);
  const [difficulty, setDifficulty] = useState<TaskDifficulty>("easy");
  const [taskCount, setTaskCount] = useState("3");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const current = !invite && match?.mode === mode ? match : null;
  const difficultyTasks = tasks.filter(
    (task) =>
      task.difficulty === difficulty &&
      !task.title.startsWith("Демонстрация:") &&
      !task.title.startsWith("Демо:"),
  );
  const requestedTaskCount = Number(taskCount);
  const selectedTaskCount =
    Number.isInteger(requestedTaskCount) &&
    requestedTaskCount >= 1 &&
    requestedTaskCount <= difficultyTasks.length
      ? requestedTaskCount
      : 0;
  async function create() {
    if (!selectedTaskCount) {
      setError("Для этой сложности пока нет доступных задач.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      setMatch(
        await api.createMatch({
          mode,
          difficulty,
          task_count: selectedTaskCount,
          duration_minutes: duration,
        }),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function join() {
    let raw = invite.trim();
    try {
      raw = new URL(raw).searchParams.get("invite") ?? raw;
    } catch {
      /* Код, а не ссылка. */
    }
    if (!raw) return;
    setBusy(true);
    setError("");
    try {
      const joined = await api.joinMatch(raw);
      setInvite("");
      window.history.replaceState(null, "", window.location.pathname);
      setMatch(joined);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const link = current
    ? `${window.location.origin}/${mode === "duel" ? "duels" : "teams"}/${current.public_id}/invite?token=${encodeURIComponent(current.invite_code)}`
    : "";
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            {invite
              ? "Приглашение"
              : mode === "duel"
                ? "Дуэль один на один"
                : "Командный раунд"}
          </h1>
          <p>
            {mode === "duel"
              ? "Пригласите соперника и решайте одинаковые задачи."
              : "Пригласите напарника: задачи и результат будут общими."}
          </p>
        </div>
          <button
            type="button"
            className="button secondary"
            onClick={() => go(mode === "duel" ? "duel-history" : "team-history")}
          >
            {mode === "duel" ? "История дуэлей" : "История командных раундов"}
          </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {invite ? (
        <section className="panel" aria-live="polite">
          <p>
            {mode === "duel"
              ? "Вас пригласили на дуэль."
              : "Вас пригласили в командный раунд."}
          </p>
          <div className="match-round-actions">
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() => void join()}
            >
              {busy ? "Подключение…" : "Принять приглашение"}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => {
                setInvite("");
                window.history.replaceState(null, "", window.location.pathname);
              }}
            >
              Отклонить
            </button>
          </div>
        </section>
      ) : !current ? (
        <div className="match-columns">
          <section className="panel">
            <h2>Создать раунд</h2>
            <div className="match-random-settings">
              <div>
                <label className="field-label" htmlFor="match-difficulty">
                  Сложность
                </label>
                <select
                  id="match-difficulty"
                  value={difficulty}
                  onChange={(e) => {
                    const nextDifficulty = e.target.value as TaskDifficulty;
                    const nextCount = tasks.filter(
                      (task) =>
                        task.difficulty === nextDifficulty &&
                        !task.title.startsWith("Демонстрация:") &&
                        !task.title.startsWith("Демо:"),
                    ).length;
                    setDifficulty(nextDifficulty);
                    setTaskCount(
                      String(Math.min(Number(taskCount) || 1, Math.max(1, nextCount))),
                    );
                  }}
                >
                  <option value="easy">Начальная</option>
                  <option value="medium">Средняя</option>
                  <option value="hard">Сложная</option>
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="match-task-count">
                  Количество задач
                </label>
                <div
                  className="match-task-stepper"
                  role="group"
                  aria-label="Количество задач раунда"
                >
                  <button
                    type="button"
                    className="button secondary"
                    aria-label="Уменьшить количество задач"
                    disabled={!difficultyTasks.length || requestedTaskCount <= 1}
                    onClick={() => setTaskCount(String(Math.max(1, (Number(taskCount) || 1) - 1)))}
                  >
                    −
                  </button>
                  <input
                    id="match-task-count"
                    type="number"
                    min={1}
                    max={difficultyTasks.length}
                    step={1}
                    inputMode="numeric"
                    value={taskCount}
                    disabled={!difficultyTasks.length}
                    aria-describedby="match-task-count-help"
                    onChange={(e) => setTaskCount(e.target.value)}
                    onBlur={() => {
                      if (!difficultyTasks.length) return;
                      const value = Number(taskCount);
                      setTaskCount(
                        String(
                          Number.isInteger(value)
                            ? Math.max(1, Math.min(value, difficultyTasks.length))
                            : 1,
                        ),
                      );
                    }}
                  />
                  <button
                    type="button"
                    className="button secondary"
                    aria-label="Увеличить количество задач"
                    disabled={!difficultyTasks.length || requestedTaskCount >= difficultyTasks.length}
                    onClick={() => setTaskCount(String(Math.min(difficultyTasks.length, (Number(taskCount) || 0) + 1)))}
                  >
                    +
                  </button>
                </div>
              </div>
              <div>
                <label className="field-label" htmlFor="match-duration">
                  Длительность
                </label>
                <select
                  id="match-duration"
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                >
                  <option value={30}>30 минут</option>
                  <option value={60}>60 минут</option>
                  <option value={90}>90 минут</option>
                  <option value={120}>120 минут</option>
                </select>
              </div>
            </div>
            <p className="body-copy" id="match-task-count-help" aria-live="polite">
              {!difficultyTasks.length
                ? "Для этой сложности пока нет задач. Попросите организатора добавить их в банк."
                : selectedTaskCount
                  ? `Случайно выберем ${selectedTaskCount} из ${difficultyTasks.length} задач этого уровня.`
                  : `Введите число от 1 до ${difficultyTasks.length}.`}
            </p>
            <button
              className="button primary"
              disabled={busy || !selectedTaskCount}
              onClick={create}
            >
              {busy ? "Создание…" : "Создать приглашение"}
            </button>
          </section>
          <section className="panel">
            <h2>Присоединиться</h2>
            <p className="body-copy">
              Откройте ссылку, которую вам прислал участник. После входа вы
              присоединитесь к раунду.
            </p>
          </section>
        </div>
      ) : (
        <div className="match-columns match-round">
          <section className="panel">
            <h2>
              {current.status === "waiting" ? "Ожидание участника" : "Раунд"}
            </h2>
            <p role="status">
              {current.status === "waiting"
                ? mode === "duel"
                  ? "Ожидаем соперника. Раунд начнётся после его подключения."
                  : "Ожидаем напарника. Раунд начнётся после его подключения."
                : current.status === "declined"
                  ? "Приглашение отклонено"
                  : current.status === "cancelled"
                    ? "Приглашение отменено"
                    : current.status === "active"
                      ? "Раунд идёт"
                      : "Раунд завершён"}
            </p>
            {current.status === "waiting" && (
              <>
                <label className="field-label" htmlFor="invite-code">
                  Ссылка-приглашение
                </label>
                <div className="copy-row">
                  <input id="invite-code" readOnly value={link} />
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(link)
                        .then(() => setCopied(true))
                        .catch(() => setError("Не удалось скопировать ссылку"))
                    }
                  >
                    {copied ? "Скопировано" : "Скопировать"}
                  </button>
                </div>
              </>
            )}
            <p className="body-copy">
              Участников: {current.participant_ids.length} из 2 · Задач:{" "}
              {current.task_ids.length} · {current.duration_minutes} минут
            </p>
            {current.ends_at && (
              <p className="body-copy">Окончание: {date(current.ends_at)}</p>
            )}
            <FinishReady match={current} userId={userId} onUpdate={setMatch} />
            <div className="match-round-actions">
              {(current.status === "active" ||
                current.status === "finished") && (
                <button
                  className="button primary"
                  onClick={() => go("match-workspace")}
                >
                  Открыть задачи
                </button>
              )}
              <DuelExit match={current} onUpdate={setMatch} />
              {(current.status === "finished" ||
                current.status === "cancelled" ||
                current.status === "declined") && (
                <button
                  className="button secondary match-join-button"
                  onClick={() => setMatch(null)}
                >
                  Создать новый раунд
                </button>
              )}
            </div>
          </section>
          <section className="panel">
            <h2>{current.status === "finished" ? "Итог" : "Ход раунда"}</h2>
            {mode === "team" && (
              <p>
                <b>
                  Общий результат команды: {current.team_solved ?? 0} из{" "}
                  {current.task_ids.length}
                </b>
              </p>
            )}
            {current.progress.map((p) => (
              <p key={p.user_id}>
                {p.display_name}: решено {p.solved}
                {mode === "duel"
                  ? ` · время ${Math.floor(p.elapsed_seconds / 60)} мин`
                  : ""}
              </p>
            ))}
            {current.status === "finished" && mode === "duel" && (
              <p>
                {current.winner_id
                  ? `Победитель: ${current.progress.find((p) => p.user_id === current.winner_id)?.display_name ?? `участник ${current.winner_id}`}`
                  : "Ничья"}
              </p>
            )}
            {current.forfeited_by && (
              <p>
                Дуэль завершена:{" "}
                {current.progress.find(
                  (p) => p.user_id === current.forfeited_by,
                )?.display_name ?? "участник"}{" "}
                сдался.
              </p>
            )}
            <p className="body-copy">
              {mode === "duel"
                ? "Побеждает участник, решивший больше задач. При равенстве учитывается сумма времени первых успешных решений; при полном равенстве — ничья."
                : "Задача засчитывается команде один раз, независимо от того, кто её решил."}{" "}
              При обрыве соединения таймер продолжается; вернитесь на эту
              страницу, чтобы подключиться снова.
            </p>
          </section>
        </div>
      )}
    </>
  );
}
export function OrganizerView({
  contests,
  tasks,
  select,
  go,
}: {
  contests: Contest[];
  tasks: Task[];
  select: (c: Contest) => void;
  go: Go;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Кабинет организатора</h1>
          <p>Задачи, контесты и результаты.</p>
        </div>
        <div className="heading-action">
          <button
            className="button secondary"
            onClick={() => go("create-task")}
          >
            Создать задачу
          </button>
          <button
            className="button primary"
            onClick={() => go("create-contest")}
          >
            Создать контест
          </button>
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Контесты</h2>
          <button className="text-link" onClick={() => go("contests")}>
            Все контесты →
          </button>
        </div>
        {contests.length ? (
          contests.map((c) => (
            <div className="contest-row" key={c.id}>
              <div className="contest-main">
                <b>{c.title}</b>
                <div className="contest-facts">
                  {date(c.starts_at)} · {c.task_ids.length} задач
                </div>
              </div>
              <button
                className="button secondary"
                onClick={() => {
                  select(c);
                  go("results");
                }}
              >
                Результаты
              </button>
              <button
                className="button secondary"
                onClick={() => {
                  select(c);
                  go("integrity");
                }}
              >
                Проверка прохождения
              </button>
              <button
                className="button secondary"
                onClick={() => {
                  select(c);
                  go("activity");
                }}
              >
                Активность
              </button>
            </div>
          ))
        ) : (
          <p>Контестов пока нет.</p>
        )}
      </section>
      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-heading">
          <h2>Задачи</h2>
          <button className="text-link" onClick={() => go("tasks")}>
            Все задачи →
          </button>
        </div>
        {tasks.length ? (
          tasks.slice(0, 5).map((t) => (
            <div className="progress-task" key={t.id}>
              <b>{t.title}</b>
              <span>
                {t.time_limit_ms / 1000} с ·{" "}
                {Math.round(t.memory_limit_kb / 1024)} МБ
              </span>
            </div>
          ))
        ) : (
          <p>Задач пока нет.</p>
        )}
      </section>
    </>
  );
}
export function TasksView({ tasks, go }: { tasks: Task[]; go: Go }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Task | null>(null);
  const [error, setError] = useState("");
  const pageSize = 5;
  const filtered = tasks.filter((t) =>
    t.title
      .toLocaleLowerCase("ru-RU")
      .includes(search.trim().toLocaleLowerCase("ru-RU")),
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const displayed = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  function changePage(next: number) {
    setPage(next);
    setDetail(null);
    setError("");
  }
  async function openTask(id: number) {
    setError("");
    try {
      setDetail(await api.task(id));
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Банк задач</h1>
          <p>Условия, ограничения и примеры для соревнований.</p>
        </div>
        <button className="button primary" onClick={() => go("create-task")}>
          Создать задачу
        </button>
      </div>
      <label className="search-field task-bank-search">
        <span className="sr-only">Поиск задачи</span>
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
            setDetail(null);
            setError("");
          }}
          placeholder="Поиск по названию"
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {displayed.length ? (
        <div className="task-library task-bank-list">
          {displayed.map((t) => (
            <article className="library-row" key={t.id}>
              <div className="library-info">
                <b>{t.title}</b>
                <span>
                  {{ easy: "Начальная", medium: "Средняя", hard: "Сложная" }[t.difficulty]} · {t.time_limit_ms / 1000} с ·{" "}
                  {Math.round(t.memory_limit_kb / 1024)} МБ
                </span>
              </div>
              <button
                className="button secondary"
                onClick={() => openTask(t.id)}
              >
                Посмотреть
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="panel empty-state">
          <b>{search.trim() ? "Задачи не найдены" : "Задач пока нет"}</b>
          <span>
            {search.trim()
              ? "Попробуйте другое название."
              : "Создайте задачу для соревнования."}
          </span>
        </div>
      )}
      {filtered.length > pageSize && (
        <nav className="task-pagination" aria-label="Страницы банка задач">
          <span aria-live="polite">
            Страница {currentPage} из {pageCount} · задач: {filtered.length}
          </span>
          <div>
            <button
              className="button secondary"
              disabled={currentPage === 1}
              onClick={() => changePage(currentPage - 1)}
            >
              Назад
            </button>
            <button
              className="button secondary"
              disabled={currentPage === pageCount}
              onClick={() => changePage(currentPage + 1)}
            >
              Далее
            </button>
          </div>
        </nav>
      )}
      {detail && (
        <section className="panel task-bank-detail">
          <div className="panel-heading">
            <h2>{detail.title}</h2>
            <button
              className="button secondary"
              onClick={() => setDetail(null)}
            >
              Закрыть
            </button>
          </div>
          <p className="task-bank-statement">{detail.statement}</p>
          {detail.tests.map((test, i) => (
            <div key={i}>
              <b>Пример {i + 1}</b>
              <pre>{test.input}</pre>
              <pre>{test.output}</pre>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
