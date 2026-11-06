import { useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  type BrowserActivityDetail,
  type BrowserActivityRow,
  type Contest,
} from "./api";
import "./activity-monitor.scss";

const eventLabel: Record<string, string> = {
  TAB_HIDDEN: "Вкладка скрыта",
  TAB_VISIBLE: "Вкладка снова видна",
  WINDOW_BLUR: "Окно потеряло фокус",
  WINDOW_FOCUS: "Окно получило фокус",
  FULLSCREEN_EXIT: "Выход из полноэкранного режима",
  FULLSCREEN_ENTER: "Вход в полноэкранный режим",
  PAGE_EXIT: "Уход со страницы",
  CONTEXT_MENU: "Контекстное меню",
  COPY: "Копирование",
  PASTE: "Вставка",
};

const TAB_EXIT_ALERT = 3;
const AWAY_MS_ALERT = 10_000;
const FULLSCREEN_ALERT = 1;

type SortKey =
  | "display_name"
  | "tab_switches"
  | "tab_hidden_ms"
  | "window_blurs"
  | "fullscreen_exits"
  | "last_activity_at";

function awayMs(stats: {
  tab_hidden_ms: number;
  window_blur_ms: number;
}) {
  return stats.tab_hidden_ms + stats.window_blur_ms;
}

function formatMs(ms: number | null | undefined, unknown = false) {
  if (unknown || ms == null) return "неизвестно";
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds} с`;
  return `${minutes} мин ${seconds} с`;
}

function formatTime(value: string | null) {
  if (!value) return "нет данных";
  return new Date(value).toLocaleString("ru-RU", {
    dateStyle: "short",
    timeStyle: "medium",
  });
}

function alertsFor(stats: {
  tab_switches: number;
  tab_hidden_ms: number;
  window_blur_ms: number;
  fullscreen_exits: number;
}) {
  return {
    tabs: stats.tab_switches > TAB_EXIT_ALERT,
    away: awayMs(stats) >= AWAY_MS_ALERT,
    fullscreen: stats.fullscreen_exits > FULLSCREEN_ALERT,
  };
}

export default function ActivityMonitor({
  contests,
  organizerId,
}: {
  contests: Contest[];
  organizerId: number;
}) {
  const own = useMemo(
    () => contests.filter((c) => c.organizer_id === organizerId),
    [contests, organizerId],
  );
  const [contestId, setContestId] = useState<number | null>(null);
  const [rows, setRows] = useState<BrowserActivityRow[]>([]);
  const [disclaimer, setDisclaimer] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("tab_switches");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<BrowserActivityDetail | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!own.some((c) => c.id === contestId)) setContestId(own[0]?.id ?? null);
  }, [own, contestId]);

  useEffect(() => {
    if (contestId === null) {
      setRows([]);
      setDetail(null);
      setSelected(null);
      return;
    }
    let active = true;
    setPending(true);
    setError("");
    api
      .browserActivityParticipants(contestId, { q: query, sort, order })
      .then((table) => {
        if (!active) return;
        setDisclaimer(table.disclaimer);
        setRows(table.rows);
        setSelected((current) =>
          table.rows.some((row) => row.user_id === current)
            ? current
            : (table.rows[0]?.user_id ?? null),
        );
      })
      .catch((e) => {
        if (active)
          setError(e instanceof ApiError ? e.message : "Не удалось загрузить данные");
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, [contestId, query, sort, order]);

  useEffect(() => {
    if (contestId === null || selected === null) {
      setDetail(null);
      return;
    }
    let active = true;
    api
      .browserActivityParticipant(contestId, selected)
      .then((item) => {
        if (active) setDetail(item);
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof ApiError ? e.message : "Не удалось открыть участника",
          );
      });
    return () => {
      active = false;
    };
  }, [contestId, selected]);

  function toggleSort(key: SortKey) {
    if (sort === key) setOrder(order === "asc" ? "desc" : "asc");
    else {
      setSort(key);
      setOrder(key === "display_name" ? "asc" : "desc");
    }
  }

  async function purge() {
    if (contestId === null) return;
    if (
      !window.confirm(
        "Удалить все события мониторинга этого соревнования? Это действие нельзя отменить.",
      )
    )
      return;
    try {
      const result = await api.deleteBrowserActivity(contestId);
      setNotice(
        `Удалено событий: ${result.deleted_events}, сессий: ${result.deleted_sessions}.`,
      );
      setDetail(null);
      const table = await api.browserActivityParticipants(contestId, {
        q: query,
        sort,
        order,
      });
      setDisclaimer(table.disclaimer);
      setRows(table.rows);
      setSelected(table.rows[0]?.user_id ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось удалить данные");
    }
  }

  const selectedRow = rows.find((row) => row.user_id === selected) ?? null;
  const hero = detail?.stats ?? selectedRow;
  const heroAlerts = hero ? alertsFor(hero) : null;
  const awayUnknown = Boolean(
    hero &&
      "tab_hidden_unknown_intervals" in hero &&
      hero.tab_hidden_unknown_intervals > 0 &&
      hero.tab_hidden_ms === 0 &&
      hero.window_blur_ms === 0,
  );

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ОРГАНИЗАТОР</p>
          <h1>Мониторинг активности</h1>
          <p>
            Показатели одного выбранного участника. Это не автоматическая
            дисквалификация и не доказательство нарушения.
          </p>
        </div>
      </div>
      {!own.length ? (
        <p className="body-copy">У вас пока нет соревнований.</p>
      ) : (
        <div className="activity-toolbar">
          <label>
            Соревнование
            <select
              value={contestId ?? ""}
              onChange={(e) => {
                setContestId(Number(e.target.value));
                setSelected(null);
              }}
            >
              {own.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Поиск участника
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Имя или логин"
            />
          </label>
          <button type="button" className="button secondary" onClick={purge}>
            Удалить записи
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {pending && <p>Загружаем данные…</p>}
      {hero && selectedRow && heroAlerts && (
        <div
          className="activity-stats"
          aria-label={`Статистика участника ${selectedRow.display_name}`}
        >
          <p className="activity-stats-who">
            <span>Выбранный участник</span>
            <strong>{selectedRow.display_name}</strong>
          </p>
          <div className="activity-stats-grid">
            <article className={heroAlerts.tabs ? "alert" : ""}>
              <span>Выходы из вкладки</span>
              <b>{hero.tab_switches}</b>
            </article>
            <article className={heroAlerts.away ? "alert" : ""}>
              <span>Вне фокуса</span>
              <b>{formatMs(awayMs(hero), awayUnknown)}</b>
            </article>
            <article className={heroAlerts.fullscreen ? "alert" : ""}>
              <span>Выходы из fullscreen</span>
              <b>{hero.fullscreen_exits}</b>
            </article>
            <article>
              <span>Потери фокуса окна</span>
              <b>{hero.window_blurs}</b>
            </article>
          </div>
        </div>
      )}
      {disclaimer && <p className="activity-disclaimer">{disclaimer}</p>}
      <div className={`activity-layout ${detail ? "split" : ""}`}>
        <div className="panel">
          <h2>Участники</h2>
          <div className="activity-table-wrap">
            <table className="activity-table">
              <thead>
                <tr>
                  <th>
                    <button type="button" onClick={() => toggleSort("display_name")}>
                      Участник
                    </button>
                  </th>
                  <th>
                    <button type="button" onClick={() => toggleSort("tab_switches")}>
                      Вкладки
                    </button>
                  </th>
                  <th>
                    <button type="button" onClick={() => toggleSort("tab_hidden_ms")}>
                      Вне фокуса
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      onClick={() => toggleSort("fullscreen_exits")}
                    >
                      Fullscreen
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      onClick={() => toggleSort("last_activity_at")}
                    >
                      Последняя активность
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const marks = alertsFor(row);
                  return (
                    <tr
                      key={row.user_id}
                      className={selected === row.user_id ? "selected" : ""}
                    >
                      <td>
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => setSelected(row.user_id)}
                        >
                          {row.display_name}
                        </button>
                      </td>
                      <td className={marks.tabs ? "alert" : ""}>
                        {row.tab_switches}
                      </td>
                      <td className={marks.away ? "alert" : ""}>
                        {formatMs(awayMs(row))}
                      </td>
                      <td className={marks.fullscreen ? "alert" : ""}>
                        {row.fullscreen_exits}
                      </td>
                      <td>{formatTime(row.last_activity_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!rows.length && !pending && (
              <p className="body-copy">Участники не найдены.</p>
            )}
          </div>
        </div>
        {detail && (
          <div className="panel activity-detail">
            <div className="panel-heading">
              <h2>{detail.display_name}</h2>
            </div>
            <p className="body-copy">{detail.disclaimer}</p>
            <h3>Хронология</h3>
            <div className="history-timeline">
              {detail.timeline.map((item) => (
                <div className="timeline-row" key={item.event_id}>
                  <div className="timeline-time">{formatTime(item.occurred_at)}</div>
                  <div className="timeline-node">
                    <i />
                  </div>
                  <div className="timeline-entry">
                    <b>{eventLabel[item.event_type] ?? item.event_type}</b>
                    <span>
                      {item.duration_unknown
                        ? "Длительность неизвестна: нет события возвращения"
                        : item.duration_ms != null
                          ? `Длительность ${formatMs(item.duration_ms)}`
                          : "Событие"}
                      {item.timestamp_untrusted
                        ? " · клиентское время скорректировано сервером"
                        : ""}
                    </span>
                  </div>
                </div>
              ))}
              {!detail.timeline.length && (
                <p className="body-copy">Событий пока нет.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
