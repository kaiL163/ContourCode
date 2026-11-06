import { useEffect, useState } from "react";
import { api, ApiError, type Contest, type Submission, type Task } from "./api";
import VerdictBadge from "./VerdictBadge";

type Page =
  | "home"
  | "contests"
  | "contest"
  | "results"
  | "duel"
  | "team"
  | "tasks"
  | "integrity"
  | "create-task"
  | "create-contest"
  | "participant-tasks"
  | "personal-results"
  | "organizer-results";
type Go = (page: Page) => void;

export function ParticipantOverview({
  contests,
  go,
  open,
}: {
  contests: Contest[];
  go: Go;
  open: (contest: Contest) => void;
}) {
  const registered = contests.filter((c) => c.registered);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Обзор</h1>
          <p>Ваши соревнования и решения.</p>
        </div>
      </div>
      <section className="panel">
        <h2>Мои соревнования</h2>
        {registered.length ? (
          registered.map((c) => (
            <div className="submission-item" key={c.id}>
              <div className="submission-data">
                <b>{c.title}</b>
                <span>
                  {c.task_ids.length} задач ·{" "}
                  {new Date(c.starts_at).toLocaleString("ru-RU")}
                </span>
              </div>
              <button className="button secondary" onClick={() => open(c)}>
                Открыть
              </button>
            </div>
          ))
        ) : (
          <p className="body-copy">
            Вы ещё не зарегистрированы на соревнования.
          </p>
        )}
        <button className="text-link" onClick={() => go("contests")}>
          Все соревнования →
        </button>
      </section>
      <section className="panel nav-overview-section">
        <h2>Продолжить</h2>
        <div className="nav-overview-actions">
          <button
            className="button secondary"
            onClick={() => go("participant-tasks")}
          >
            Мои задачи
          </button>
          <button
            className="button secondary"
            onClick={() => go("personal-results")}
          >
            Мои результаты и отправки
          </button>
        </div>
      </section>
    </>
  );
}

export function ParticipantTasks({
  contests,
  tasks,
  open,
}: {
  contests: Contest[];
  tasks: Task[];
  open: (contest: Contest, taskId: number) => void;
}) {
  const registered = contests.filter((c) => c.registered);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Задачи</h1>
          <p>Задачи соревнований, в которых вы зарегистрированы.</p>
        </div>
      </div>
      {registered.length ? (
        registered.map((c) => (
          <section className="panel nav-overview-section" key={c.id}>
            <h2>{c.title}</h2>
            {Date.parse(c.starts_at) > Date.now() ? (
              <p className="body-copy">
                Соревнование ещё не началось. Задачи появятся после старта.
              </p>
            ) : c.task_ids.length ? (
              c.task_ids.map((id) => {
                const task = tasks.find((t) => t.id === id);
                return task ? (
                  <div className="submission-item" key={id}>
                    <div className="submission-data">
                      <b>{task.title}</b>
                      <span>
                        {task.time_limit_ms / 1000} с ·{" "}
                        {Math.round(task.memory_limit_kb / 1024)} МБ
                      </span>
                    </div>
                    <button
                      className="button secondary"
                      onClick={() => open(c, id)}
                    >
                      Открыть
                    </button>
                  </div>
                ) : null;
              })
            ) : (
              <p className="body-copy">В этом контесте пока нет задач.</p>
            )}
          </section>
        ))
      ) : (
        <div className="panel empty-state">
          <b>Пока нет задач</b>
          <span>
            Зарегистрируйтесь на соревнование, чтобы увидеть его задачи.
          </span>
        </div>
      )}
    </>
  );
}

function PersonalPagination({
  label,
  page,
  total,
  onChange,
}: {
  label: string;
  page: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (total <= 1) return null;
  return (
    <nav className="personal-pagination" aria-label={label}>
      <span aria-live="polite">
        Страница {page} из {total}
      </span>
      <div>
        <button
          type="button"
          className="button secondary"
          disabled={page === 1}
          onClick={() => onChange(page - 1)}
        >
          Назад
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={page === total}
          onClick={() => onChange(page + 1)}
        >
          Далее
        </button>
      </div>
    </nav>
  );
}

export function PersonalResults({
  contests,
  tasks,
}: {
  contests: Contest[];
  tasks: Task[];
}) {
  const [rows, setRows] = useState<Submission[]>([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");
  const [contestPage, setContestPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const pageSize = 5;
  const registered = contests.filter((c) => c.registered);
  const contestPages = Math.max(1, Math.ceil(registered.length / pageSize));
  const currentContestPage = Math.min(contestPage, contestPages);
  const historyPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentHistoryPage = Math.min(historyPage, historyPages);
  useEffect(() => {
    let alive = true;
    setPending(true);
    setError("");
    const items = contests.filter((c) => c.registered);
    Promise.all(items.map((c) => api.submissions(c.id)))
      .then((groups) => {
        if (alive)
          setRows(
            groups
              .flat()
              .sort(
                (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
              ),
          );
      })
      .catch((e) => {
        if (alive)
          setError(
            e instanceof ApiError ? e.message : "Не удалось загрузить отправки",
          );
      })
      .finally(() => {
        if (alive) setPending(false);
      });
    return () => {
      alive = false;
    };
  }, [contests]);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Результаты и отправки</h1>
          <p>Ваша история решений в соревнованиях.</p>
        </div>
      </div>
      <section className="panel nav-overview-section">
        <h2>Мои соревнования</h2>
        {registered.length ? (
          <>
            {registered
              .slice(
                (currentContestPage - 1) * pageSize,
                currentContestPage * pageSize,
              )
              .map((c) => (
                <div className="submission-item" key={c.id}>
                  <div className="submission-data">
                    <b>{c.title}</b>
                    <span>
                      {new Date(c.starts_at).toLocaleString("ru-RU")} ·
                      зарегистрированы
                    </span>
                  </div>
                </div>
              ))}
            <PersonalPagination
              label="Страницы соревнований"
              page={currentContestPage}
              total={contestPages}
              onChange={setContestPage}
            />
          </>
        ) : (
          <p className="body-copy">
            Вы ещё не зарегистрированы на соревнования.
          </p>
        )}
      </section>
      <h2 className="personal-history-heading">История отправок</h2>
      {pending ? (
        <p role="status">Загружаем отправки…</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : rows.length ? (
        <section className="panel">
          {rows
            .slice(
              (currentHistoryPage - 1) * pageSize,
              currentHistoryPage * pageSize,
            )
            .map((s) => (
              <div className="submission-item" key={s.id}>
                <div className="submission-data">
                  <b>
                    {tasks.find((t) => t.id === s.task_id)?.title ??
                      `Задача № ${s.task_id}`}
                  </b>
                  <span>
                    {contests.find((c) => c.id === s.contest_id)?.title ??
                      `Контест № ${s.contest_id}`}{" "}
                    · {new Date(s.created_at).toLocaleString("ru-RU")}
                  </span>
                </div>
                <VerdictBadge verdict={s.verdict} />
              </div>
            ))}
          <PersonalPagination
            label="Страницы отправок"
            page={currentHistoryPage}
            total={historyPages}
            onChange={setHistoryPage}
          />
        </section>
      ) : (
        <div className="panel empty-state">
          <b>Отправок пока нет</b>
          <span>
            Здесь появятся решения, отправленные в ваших соревнованиях.
          </span>
        </div>
      )}
    </>
  );
}

export function OrganizerResults({
  contests,
  open,
}: {
  contests: Contest[];
  open: (contest: Contest) => void;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Результаты</h1>
          <p>Выберите контест, чтобы открыть таблицу участников и отправки.</p>
        </div>
      </div>
      {contests.length ? (
        <section className="panel">
          {contests.map((c) => (
            <div className="submission-item" key={c.id}>
              <div className="submission-data">
                <b>{c.title}</b>
                <span>
                  {new Date(c.starts_at).toLocaleString("ru-RU")} · задач:{" "}
                  {c.task_ids.length}
                </span>
              </div>
              <button className="button secondary" onClick={() => open(c)}>
                Открыть
              </button>
            </div>
          ))}
        </section>
      ) : (
        <div className="panel empty-state">
          <b>Контестов пока нет</b>
          <span>Создайте контест, чтобы увидеть его результаты.</span>
        </div>
      )}
    </>
  );
}
