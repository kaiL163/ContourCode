import { useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  type Contest,
  type IntegrityReport,
  type StandingRow,
  type Submission,
  type Task,
} from "./api";
import "./ConnectedIntegrity.scss";
import VerdictBadge from "./VerdictBadge";

type Props = { contests: Contest[]; tasks: Task[]; organizerId: number };
const errorText = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : "Не удалось получить данные. Попробуйте ещё раз.";
const fmt = (date: string) =>
  new Date(date).toLocaleString("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  });

export default function ConnectedIntegrity({
  contests,
  tasks,
  organizerId,
}: Props) {
  const own = useMemo(
    () => contests.filter((c) => c.organizer_id === organizerId),
    [contests, organizerId],
  );
  const [contestId, setContestId] = useState<number | null>(null);
  const [rows, setRows] = useState<Submission[]>([]);
  const [reports, setReports] = useState<IntegrityReport[]>([]);
  const [participants, setParticipants] = useState<StandingRow[]>([]);
  const [subject, setSubject] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(1);
  useEffect(() => {
    if (!own.some((c) => c.id === contestId)) setContestId(own[0]?.id ?? null);
  }, [own, contestId]);
  useEffect(() => {
    if (contestId === null) {
      setRows([]);
      setReports([]);
      setParticipants([]);
      return;
    }
    let active = true;
    setPending(true);
    setError("");
    setNotice("");
    setRows([]);
    setReports([]);
    setParticipants([]);
    setSubject(null);
    setSelected(null);
    setPage(1);
    setComment("");
    Promise.all([
      api.integritySubmissions(contestId),
      api.integrityReports(contestId),
      api.standings(contestId),
    ])
      .then(([history, reportList, standing]) => {
        if (!active) return;
        setRows(history);
        setReports(reportList);
        setParticipants(standing.rows);
        const first = history[0]?.user_id ?? standing.rows[0]?.user_id ?? null;
        setSubject(first);
        setSelected(null);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, [contestId, revision]);
  const names = useMemo(
    () => new Map(participants.map((p) => [p.user_id, p.display_name])),
    [participants],
  );
  const subjects = useMemo(
    () =>
      Array.from(
        new Set([
          ...participants.map((p) => p.user_id),
          ...rows.map((s) => s.user_id),
        ]),
      ),
    [participants, rows],
  );
  const shown = rows
    .filter((s) => s.user_id === subject)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const pageSize = 5;
  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = shown.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const current = shown.find((s) => s.id === selected) ?? shown[0];
  const latest = reports[0];
  const analyze = async () => {
    if (contestId === null) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.integrityAnalyze(contestId);
      setRevision((x) => x + 1);
      setNotice("Анализ завершён.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (contestId === null || subject === null || !comment.trim()) {
      setError("Выберите участника и заполните заключение.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.integrityConclusion(contestId, {
        subject_user_id: subject,
        comment: comment.trim(),
      });
      setComment("");
      setNotice("Заключение сохранено.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Разбор отправок</h1>
          <p>
            История отправок и отчёты о сходстве помогают организатору изучить
            решения.
          </p>
        </div>
      </div>
      <div className="integrity-callout">
        <div>
          <b>Решение принимает организатор</b>
          <p>Сходство программ само по себе не доказывает нарушение.</p>
        </div>
      </div>
      {!own.length ? (
        <div className="panel empty-state">
          <b>Нет доступных контестов</b>
          <span>Создайте контест, чтобы просматривать отправки.</span>
        </div>
      ) : (
        <>
          <label className="field-label" htmlFor="integrity-contest">
            Контест
          </label>
          <select
            className="participant-select"
            id="integrity-contest"
            value={contestId ?? ""}
            onChange={(e) => setContestId(Number(e.target.value))}
          >
            {own.map((c) => (
              <option value={c.id} key={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          {error && (
            <div role="alert" className="form-note">
              {error}{" "}
              <button
                type="button"
                className="text-link"
                onClick={() => setRevision((x) => x + 1)}
              >
                Повторить загрузку
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="form-note">
              {notice}
            </div>
          )}
          {pending ? (
            <div className="panel" role="status">
              Загружаем отправки…
            </div>
          ) : (
            <>
              <div className="review-workspace">
                <section
                  className="panel review-list"
                  aria-labelledby="review-list-title"
                >
                  <div className="review-section-heading">
                    <h2 id="review-list-title">Отправки</h2>
                    <span>{shown.length}</span>
                  </div>
                  {subjects.length ? (
                    <>
                      <label
                        className="field-label"
                        htmlFor="integrity-subject"
                      >
                        Участник
                      </label>
                      <select
                        id="integrity-subject"
                        className="participant-select"
                        value={subject ?? ""}
                        onChange={(e) => {
                          setSubject(Number(e.target.value));
                          setSelected(null);
                          setPage(1);
                          setComment("");
                        }}
                      >
                        {subjects.map((id) => (
                          <option key={id} value={id}>
                            {names.get(id) ?? `Участник #${id}`}
                          </option>
                        ))}
                      </select>
                      {shown.length ? (
                        <>
                          <div className="review-submissions">
                            {visible.map((s) => (
                              <button
                                type="button"
                                className={`review-submission ${current?.id === s.id ? "selected" : ""}`}
                                key={s.id}
                                aria-pressed={current?.id === s.id}
                                onClick={() => setSelected(s.id)}
                              >
                                <span className="review-submission-title">
                                  {tasks.find((t) => t.id === s.task_id)
                                    ?.title ?? `Задача #${s.task_id}`}
                                </span>
                                <span className="review-submission-meta">
                                  {fmt(s.created_at)}
                                </span>
                                <VerdictBadge verdict={s.verdict} />
                              </button>
                            ))}
                          </div>
                          {pages > 1 && (
                            <nav
                              className="review-pagination"
                              aria-label="Страницы отправок"
                            >
                              <span aria-live="polite">
                                {currentPage} из {pages}
                              </span>
                              <div>
                                <button
                                  type="button"
                                  className="button secondary"
                                  disabled={currentPage === 1}
                                  onClick={() => {
                                    setPage(currentPage - 1);
                                    setSelected(
                                      shown[(currentPage - 2) * pageSize]?.id ??
                                        null,
                                    );
                                  }}
                                >
                                  Назад
                                </button>
                                <button
                                  type="button"
                                  className="button secondary"
                                  disabled={currentPage === pages}
                                  onClick={() => {
                                    setPage(currentPage + 1);
                                    setSelected(
                                      shown[currentPage * pageSize]?.id ?? null,
                                    );
                                  }}
                                >
                                  Далее
                                </button>
                              </div>
                            </nav>
                          )}
                        </>
                      ) : (
                        <p className="review-empty">
                          У этого участника пока нет отправок.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="review-empty">
                      В контесте пока нет участников и отправок.
                    </p>
                  )}
                </section>
                <div className="review-main">
                  <section
                    className="panel review-code-panel"
                    aria-labelledby="review-code-title"
                  >
                    <div className="review-section-heading">
                      <div>
                        <h2 id="review-code-title">Код решения</h2>
                        {current && (
                          <p>
                            Отправка · {current.language} ·{" "}
                            {fmt(current.created_at)}
                          </p>
                        )}
                      </div>
                      {current && <VerdictBadge verdict={current.verdict} />}
                    </div>
                    {current ? (
                      <div
                        className="review-code"
                        tabIndex={0}
                        aria-label="Исходный код отправки"
                      >
                        <pre>
                          {current.source_code
                            .split("\n")
                            .map((line, index) => (
                              <span className="review-code-line" key={index}>
                                <span
                                  className="review-line-number"
                                  aria-hidden="true"
                                >
                                  {index + 1}
                                </span>
                                <span>{line || " "}</span>
                              </span>
                            ))}
                        </pre>
                      </div>
                    ) : (
                      <p className="review-empty">
                        Выберите отправку, чтобы посмотреть код.
                      </p>
                    )}
                  </section>
                  <div className="review-followup">
                    <section className="panel review-analysis">
                      <div className="review-section-heading">
                        <div>
                          <h2>Сравнение решений</h2>
                          <p>
                            Сходство помогает выбрать отправки для ручного
                            просмотра.
                          </p>
                        </div>
                        <button
                          type="button"
                          className="button secondary"
                          onClick={analyze}
                          disabled={busy || pending}
                        >
                          Запустить анализ
                        </button>
                      </div>
                      {latest ? (
                        <>
                          <p className="body-copy">
                            Отчёт от {fmt(latest.created_at)} · {latest.engine}
                          </p>
                          <pre className="integrity-report">
                            {JSON.stringify(latest.details, null, 2)}
                          </pre>
                        </>
                      ) : (
                        <p className="review-empty">Отчётов пока нет.</p>
                      )}
                    </section>
                    <section className="panel review-conclusion">
                      <h2>Заключение организатора</h2>
                      <label
                        className="field-label"
                        htmlFor="integrity-comment"
                      >
                        Комментарий
                      </label>
                      <textarea
                        id="integrity-comment"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="Опишите результаты рассмотрения"
                        rows={4}
                      />
                      <button
                        type="button"
                        className="button primary"
                        onClick={save}
                        disabled={busy || subject === null}
                      >
                        Сохранить заключение
                      </button>
                    </section>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
