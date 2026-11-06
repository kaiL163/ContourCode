import { useEffect, useState } from "react";
import {
  api,
  ApiError,
  type CodeDiff,
  type CodeHistoryAnalytics,
  type CodeVersion,
  type CodeVersionSummary,
} from "./api";

const labels: Record<CodeVersionSummary["change_type"], string> = {
  INITIAL: "Начальная версия",
  AUTOSAVE: "Автосохранение",
  MANUAL_SAVE: "Ручное сохранение",
  SUBMISSION: "Отправка",
};

function timeOnly(value: string) {
  return new Date(value).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function dateTime(value: string) {
  return new Date(value).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });
}

function duration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes <= 0) return `${rest} с`;
  return `${minutes} мин ${rest} с`;
}

export default function CodeHistoryPanel({
  contestId,
  taskId,
  userId,
  participantName,
  taskTitle,
  onClose,
}: {
  contestId: number;
  taskId: number;
  userId: number;
  participantName: string;
  taskTitle: string;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<CodeVersionSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [analytics, setAnalytics] = useState<CodeHistoryAnalytics | null>(null);
  const [disclaimer, setDisclaimer] = useState("");
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [current, setCurrent] = useState<CodeVersion | null>(null);
  const [leftId, setLeftId] = useState<number | null>(null);
  const [rightId, setRightId] = useState<number | null>(null);
  const [diff, setDiff] = useState<CodeDiff | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setVersions([]);
    setCurrent(null);
    setDiff(null);
    api
      .codeHistory(taskId, { contestId, userId, limit: 30, offset: 0 })
      .then((page) => {
        if (!live) return;
        const ordered = [...page.versions].reverse();
        setVersions(ordered);
        setTotal(page.total);
        setAnalytics(page.analytics);
        setDisclaimer(page.disclaimer);
        const latest = ordered[ordered.length - 1];
        if (latest) selectLoaded(ordered, latest.id);
        setError("");
      })
      .catch((reason) => {
        if (live) setError(reason instanceof ApiError ? reason.message : "Не удалось загрузить историю");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [contestId, taskId, userId]);

  function selectLoaded(list: CodeVersionSummary[], id: number) {
    setCurrentId(id);
    const index = list.findIndex((item) => item.id === id);
    setRightId(id);
    setLeftId(index > 0 ? list[index - 1].id : null);
  }

  useEffect(() => {
    if (currentId == null) return;
    let live = true;
    api
      .codeVersion(currentId)
      .then((version) => {
        if (live) setCurrent(version);
      })
      .catch((reason) => {
        if (live) setError(reason instanceof ApiError ? reason.message : "Не удалось открыть версию");
      });
    return () => {
      live = false;
    };
  }, [currentId]);

  useEffect(() => {
    if (leftId == null || rightId == null || leftId === rightId) {
      setDiff(null);
      return;
    }
    let live = true;
    api
      .codeDiff(leftId, rightId)
      .then((result) => {
        if (live) setDiff(result);
      })
      .catch((reason) => {
        if (live) setError(reason instanceof ApiError ? reason.message : "Не удалось сравнить версии");
      });
    return () => {
      live = false;
    };
  }, [leftId, rightId]);

  function choose(id: number) {
    selectLoaded(versions, id);
  }

  function move(step: number) {
    const index = versions.findIndex((item) => item.id === currentId);
    const next = versions[index + step];
    if (next) choose(next.id);
  }

  async function loadEarlier() {
    try {
      const page = await api.codeHistory(taskId, {
        contestId,
        userId,
        limit: 30,
        offset: versions.length,
      });
      setVersions((currentVersions) => [...[...page.versions].reverse(), ...currentVersions]);
      setTotal(page.total);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Не удалось загрузить историю");
    }
  }

  const index = versions.findIndex((item) => item.id === currentId);

  return (
    <section className="panel code-history" aria-label="История кода">
      <div className="code-history-heading">
        <div>
          <h2>История кода</h2>
          <p>
            {participantName} · {taskTitle}
          </p>
        </div>
        <button type="button" className="button secondary" onClick={onClose}>
          Закрыть
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {loading && <p className="body-copy">Загрузка истории…</p>}
      {!loading && !versions.length && <p className="body-copy">Сохранённых версий пока нет.</p>}
      {analytics && versions.length > 0 && (
        <>
          <p className="code-history-note">{disclaimer}</p>
          <div className="code-history-stats">
            <article>
              <span>Версий</span>
              <b>{analytics.version_count}</b>
            </article>
            <article>
              <span>Изменений</span>
              <b>{analytics.change_count}</b>
            </article>
            <article>
              <span>Добавлено строк</span>
              <b>{analytics.added_lines}</b>
            </article>
            <article>
              <span>Удалено строк</span>
              <b>{analytics.removed_lines}</b>
            </article>
            <article>
              <span>Длительность</span>
              <b>{duration(analytics.duration_seconds)}</b>
            </article>
            <article>
              <span>Первая и последняя</span>
              <b>
                +{analytics.first_to_last_added_lines} / −{analytics.first_to_last_removed_lines}
              </b>
            </article>
          </div>
        </>
      )}
      {versions.length > 0 && (
        <div className="code-history-layout">
          <div>
            <h3>Хронология</h3>
            <ol className="code-history-timeline">
              {versions.map((version) => (
                <li key={version.id}>
                  <button
                    type="button"
                    className={version.id === currentId ? "selected" : ""}
                    onClick={() => choose(version.id)}
                  >
                    <time dateTime={version.created_at}>{timeOnly(version.created_at)}</time>
                    <span>
                      {labels[version.change_type]} v{version.version_number}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            {versions.length < total && (
              <button type="button" className="button secondary" onClick={() => void loadEarlier()}>
                Более ранние версии
              </button>
            )}
            <table className="code-history-table">
              <thead>
                <tr>
                  <th scope="col">Версия</th>
                  <th scope="col">Время</th>
                  <th scope="col">Тип</th>
                  <th scope="col">Размер</th>
                  <th scope="col">Отправка</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((version) => (
                  <tr key={version.id} className={version.id === currentId ? "selected" : ""}>
                    <td>{version.version_number}</td>
                    <td>{dateTime(version.created_at)}</td>
                    <td>{labels[version.change_type]}</td>
                    <td>{version.code_size} симв.</td>
                    <td>{version.submission_id ? `#${version.submission_id}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="code-history-nav">
              <button type="button" className="button secondary" disabled={index <= 0} onClick={() => move(-1)}>
                Предыдущая
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={index < 0 || index >= versions.length - 1}
                onClick={() => move(1)}
              >
                Следующая
              </button>
            </div>
            {current && (
              <article className="code-history-view">
                <h3>
                  Версия {current.version_number} · {labels[current.change_type]}
                </h3>
                <p>
                  {dateTime(current.created_at)}
                  {current.submission_id ? ` · отправка #${current.submission_id}` : ""}
                </p>
                <pre>{current.code_content}</pre>
              </article>
            )}
            <div className="code-history-compare">
              <label>
                От версии
                <select
                  value={leftId ?? ""}
                  onChange={(event) => setLeftId(Number(event.target.value) || null)}
                >
                  <option value="">Не выбрана</option>
                  {versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      v{version.version_number}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                К версии
                <select
                  value={rightId ?? ""}
                  onChange={(event) => setRightId(Number(event.target.value) || null)}
                >
                  <option value="">Не выбрана</option>
                  {versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      v{version.version_number}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {diff && (
              <div className="code-diff" aria-label="Сравнение версий">
                <p>
                  {`v${diff.from_version_number} → v${diff.to_version_number}: +${diff.added_lines} / −${diff.removed_lines}`}
                  {diff.changed_lines ? `, изменено строк: ${diff.changed_lines}` : ""}
                </p>
                <div className="code-diff-grid">
                  {diff.rows.map((row, rowIndex) => (
                    <div className={`code-diff-row is-${row.kind}`} key={`${row.kind}-${rowIndex}`}>
                      <span>{row.left_line ?? ""}</span>
                      <code>{row.left ?? ""}</code>
                      <span>{row.right_line ?? ""}</span>
                      <code>{row.right ?? ""}</code>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
