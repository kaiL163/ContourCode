import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError, type Match } from "./api";

type InvitationDetails = Awaited<ReturnType<typeof api.invitation>>;
export function InvitationPage({
  onAccept,
}: {
  onAccept: (match: Match) => void;
}) {
  const publicId = useLocation().pathname.split("/")[2] ?? "";
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const [details, setDetails] = useState<InvitationDetails | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!token) {
      setError("Ссылка приглашения неполная.");
      return;
    }
    api
      .invitation(publicId, token)
      .then((data) => {
        if (alive) setDetails(data);
      })
      .catch((e) => {
        if (alive)
          setError(
            e instanceof ApiError
              ? e.message
              : "Не удалось загрузить приглашение",
          );
      });
    return () => {
      alive = false;
    };
  }, [publicId, token]);
  async function accept() {
    setBusy(true);
    setError("");
    try {
      onAccept(await api.joinMatch(token));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось присоединиться");
    } finally {
      setBusy(false);
    }
  }
  async function decline() {
    if (details?.already_joined) {
      navigate("/", { replace: true });
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.declineInvitation(publicId, token);
      navigate("/", { replace: true });
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Не удалось отклонить приглашение",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Приглашение</h1>
          <p>Проверьте условия раунда перед началом.</p>
        </div>
      </div>
      <section className="panel invitation-panel">
        {error && <p role="alert">{error}</p>}
        {!details && !error && <p role="status">Загружаем приглашение…</p>}
        {details && (
          <>
            <h2>
              {details.mode === "duel"
                ? "Дуэль один на один"
                : "Командный раунд"}
            </h2>
            <p>
              {details.creator_name} приглашает вас{" "}
              {details.mode === "duel" ? "на дуэль" : "в команду"}.
            </p>
            <p className="body-copy">
              Номер: {publicId} · Задач: {details.task_count} ·{" "}
              {details.duration_minutes} минут
            </p>
            <p className="body-copy">
              {details.already_joined
                ? "Вы уже участвуете в этом раунде."
                : "Раунд начнётся после принятия приглашения."}
            </p>
            <div className="match-round-actions">
              <button
                type="button"
                className="button primary"
                disabled={busy}
                onClick={accept}
              >
                {busy
                  ? "Подключение…"
                  : details.already_joined
                    ? "Открыть раунд"
                    : "Принять приглашение"}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={decline}
              >
                {details.already_joined ? "Закрыть" : "Отклонить"}
              </button>
            </div>
          </>
        )}
        {error && !details && (
          <button
            type="button"
            className="button secondary"
            onClick={() => navigate("/")}
          >
            На главную
          </button>
        )}
      </section>
    </>
  );
}

export function DuelHistory({
  onOpen,
  userId,
}: {
  onOpen: (match: Match) => void;
  userId: number;
}) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 4;
  useEffect(() => {
    let alive = true;
    api
      .duelHistory()
      .then((items) => {
        if (alive) setMatches(items);
      })
      .catch((e) => {
        if (alive)
          setError(
            e instanceof ApiError ? e.message : "Не удалось загрузить историю",
          );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  const current = Math.min(page, pages);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>История дуэлей</h1>
          <p>Ваши дуэли и их результаты.</p>
        </div>
      </div>
      {loading ? (
        <p role="status">Загружаем дуэли…</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : matches.length ? (
        <section className="panel">
          {matches
            .slice((current - 1) * pageSize, current * pageSize)
            .map((m) => (
            <div className="submission-item" key={m.id}>
              <div className="submission-data">
                <b>Дуэль {m.public_id}</b>
                <span>
                  {m.started_at
                    ? new Date(m.started_at).toLocaleString("ru-RU")
                    : "Ожидание участника"}{" "}
                  ·{" "}
                  {m.status === "finished"
                    ? m.winner_id === null
                      ? "Ничья"
                      : m.winner_id === userId
                        ? "Победа"
                        : "Поражение"
                    : m.status === "active"
                      ? "Идёт"
                      : m.status === "cancelled" || m.status === "declined"
                        ? "Отменена"
                        : "Ожидание"}
                </span>
                <span>
                  {m.progress
                    .map((p) => `${p.display_name}: ${p.solved}`)
                    .join(" · ")}
                </span>
              </div>
              <button
                type="button"
                className="button secondary"
                onClick={() => onOpen(m)}
              >
                Открыть
              </button>
            </div>
            ))}
          {pages > 1 && (
            <nav className="personal-pagination" aria-label="Страницы дуэлей">
              <span aria-live="polite">
                Страница {current} из {pages} · дуэлей: {matches.length}
              </span>
              <div>
                <button
                  type="button"
                  className="button secondary"
                  disabled={current === 1}
                  onClick={() => setPage(current - 1)}
                >
                  Назад
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={current === pages}
                  onClick={() => setPage(current + 1)}
                >
                  Далее
                </button>
              </div>
            </nav>
          )}
        </section>
      ) : (
        <div className="panel">
          <p>Пока нет дуэлей.</p>
        </div>
      )}
    </>
  );
}
