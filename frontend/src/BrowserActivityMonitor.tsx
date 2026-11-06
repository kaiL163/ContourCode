import { useEffect, useState } from "react";
import {
  api,
  ApiError,
  type BrowserActivityPolicy,
  type Contest,
  type User,
} from "./api";
import { BrowserActivityTracker } from "./BrowserActivityTracker";

function contestRunning(contest: Contest) {
  const start = Date.parse(contest.starts_at);
  const end = start + contest.duration_minutes * 60000;
  const now = Date.now();
  return now >= start && now < end;
}

export default function BrowserActivityMonitor({
  contest,
  user,
}: {
  contest: Contest | null;
  user: User;
}) {
  const [policy, setPolicy] = useState<BrowserActivityPolicy | null>(null);
  const [error, setError] = useState("");
  const enabled =
    Boolean(contest) &&
    user.role === "participant" &&
    contest!.registered &&
    contestRunning(contest!);

  useEffect(() => {
    if (!enabled || !contest) {
      setPolicy(null);
      return;
    }
    let cancelled = false;
    let tracker: BrowserActivityTracker | undefined;
    api
      .startBrowserActivity(contest.id)
      .then((session) => {
        if (cancelled) return;
        setPolicy(session.policy);
        tracker = new BrowserActivityTracker(
          contest.id,
          user.id,
          session.session_id,
          async (events, options) => {
            await api.sendBrowserActivity(
              contest.id,
              session.session_id,
              events,
              options,
            );
          },
        );
        tracker.start();
      })
      .catch((e) => {
        if (!cancelled)
          setError(
            e instanceof ApiError
              ? e.message
              : "Не удалось включить мониторинг активности.",
          );
      });
    return () => {
      cancelled = true;
      tracker?.stop();
    };
  }, [enabled, contest?.id, user.id]);

  if (!enabled && !error) return null;
  return (
    <aside className="activity-notice" role="status">
      <b>Мониторинг активности включён</b>
      <p>
        Во время участия фиксируются технические события вкладки и окна:
        переключение, фокус, полноэкранный режим, контекстное меню и факт
        копирования или вставки. Содержимое других вкладок, экран, камера,
        микрофон и буфер обмена не записываются. Потеря фокуса сама по себе не
        считается нарушением. Данные видит организатор соревнования и хранятся{" "}
        {policy?.retention_days ?? 90} дней.
      </p>
      {error && <p role="alert">{error}</p>}
    </aside>
  );
}
