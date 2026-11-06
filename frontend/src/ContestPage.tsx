import { useState, type ChangeEvent } from "react";
import { api, ApiError, type Contest, type Task, type User } from "./api";
import "./contest-page.scss";

export function readCover(file: File): Promise<string> {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 1048576
  )
    return Promise.reject(
      new Error("Выберите PNG, JPEG или WebP размером до 1 МБ."),
    );
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Не удалось прочитать изображение."));
    reader.onerror = () =>
      reject(new Error("Не удалось прочитать изображение."));
    reader.readAsDataURL(file);
  });
}

export function ContestCover({ contest }: { contest: Contest }) {
  return (
    <div className={`contest-cover ${contest.cover_image ? "" : "no-cover"}`}>
      {contest.cover_image ? (
        <img src={contest.cover_image} alt="" />
      ) : (
        <div className="contest-cover-empty">
          <span>КонтурКод</span>
          <small>Соревнование</small>
        </div>
      )}
    </div>
  );
}

export default function ContestPage({
  contest,
  tasks,
  user,
  update,
  go,
}: {
  contest: Contest | null;
  tasks: Task[];
  user: User;
  update: (c: Contest) => void;
  go: (page: "contests" | "contest" | "results") => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (!contest) return <p>Выберите соревнование в списке.</p>;
  const upcoming = Date.parse(contest.starts_at) > Date.now();
  async function register() {
    if (!contest) return;
    setBusy(true);
    setError("");
    try {
      await api.register(contest.id);
      update({ ...contest, registered: true });
      setMessage("Вы зарегистрированы.");
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Не удалось зарегистрироваться.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function changeCover(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !contest) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const image = await readCover(file);
      await api.contestCover(contest.id, image);
      update({ ...contest, cover_image: image });
      setMessage("Обложка сохранена.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось сохранить обложку.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="back-row">
        <button className="back-link" onClick={() => go("contests")}>
          ← Все соревнования
        </button>
      </div>
      <article className="contest-detail">
        <ContestCover contest={contest} />
        <div className="contest-detail-body">
          <div className="contest-detail-heading">
            <div>
              <p className="contest-detail-kicker">Соревнование</p>
              <h1>{contest.title}</h1>
            </div>
            {user.role === "organizer" && user.id === contest.organizer_id && (
              <label className="button secondary contest-cover-upload">
                {busy ? "Сохраняем…" : "Изменить обложку"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={busy}
                  onChange={changeCover}
                />
              </label>
            )}
          </div>
          <p className="contest-description">
            {contest.description || "Описание соревнования пока не добавлено."}
          </p>
          <dl className="contest-detail-facts">
            <div>
              <dt>Начало</dt>
              <dd>
                {new Date(contest.starts_at).toLocaleString("ru-RU", {
                  dateStyle: "long",
                  timeStyle: "short",
                })}
              </dd>
            </div>
            <div>
              <dt>Длительность</dt>
              <dd>{contest.duration_minutes} мин</dd>
            </div>
            <div>
              <dt>Задачи</dt>
              <dd>{contest.task_ids.length}</dd>
            </div>
            <div>
              <dt>Статус</dt>
              <dd>
                {upcoming
                  ? "Скоро"
                  : Date.now() <
                      Date.parse(contest.starts_at) +
                        contest.duration_minutes * 60000
                    ? "Идёт"
                    : "Завершено"}
              </dd>
            </div>
            <div>
              <dt>Участие</dt>
              <dd>
                {user.role === "organizer"
                  ? "Организатор"
                  : contest.registered
                    ? "Вы зарегистрированы"
                    : "Регистрация доступна"}
              </dd>
            </div>
          </dl>
          {error && (
            <p role="alert" className="contest-feedback">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="contest-feedback">
              {message}
            </p>
          )}
          <div className="contest-detail-actions">
            {user.role === "participant" && !contest.registered && (
              <button
                className="button primary"
                disabled={busy}
                onClick={register}
              >
                Зарегистрироваться
              </button>
            )}
            {upcoming && user.role === "participant" ? (
              <p className="body-copy">
                Задачи откроются после начала соревнования.
              </p>
            ) : (
              <button
                className={`button ${contest.registered || user.role === "organizer" ? "primary" : "secondary"}`}
                onClick={() => go("contest")}
              >
                Перейти к задачам
              </button>
            )}
            <button className="button secondary" onClick={() => go("results")}>
              Результаты
            </button>
          </div>
          <section className="contest-task-summary">
            <h2>Задачи соревнования</h2>
            {upcoming && user.role === "participant" ? (
              <p>Задачи появятся после начала соревнования.</p>
            ) : contest.task_ids.length ? (
              <ul>
                {contest.task_ids.map((id, i) => (
                  <li key={id}>
                    <span>{String.fromCharCode(65 + i)}</span>
                    {tasks.find((t) => t.id === id)?.title ?? `Задача ${i + 1}`}
                  </li>
                ))}
              </ul>
            ) : (
              <p>Задачи пока не добавлены.</p>
            )}
          </section>
        </div>
      </article>
    </>
  );
}
