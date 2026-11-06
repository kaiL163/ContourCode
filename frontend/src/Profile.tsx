import { useState, type ChangeEvent, type FormEvent } from "react";
import { api, ApiError, type User } from "./api";
import { readCover } from "./ContestPage";
import "./profile.scss";

export function Avatar({
  user,
  className = "",
}: {
  user: User;
  className?: string;
}) {
  const initials = user.display_name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className={`avatar profile-avatar ${className}`} aria-hidden="true">
      {user.avatar_image ? <img src={user.avatar_image} alt="" /> : initials}
    </span>
  );
}

export default function Profile({
  user,
  onSaved,
}: {
  user: User;
  onSaved: (user: User) => void;
}) {
  const [name, setName] = useState(user.display_name);
  const [avatar, setAvatar] = useState<string | null>(
    user.avatar_image ?? null,
  );
  const [skills, setSkills] = useState((user.skills ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const preview = {
    ...user,
    display_name: name.trim() || user.display_name,
    avatar_image: avatar,
  };
  async function chooseAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setNotice("");
    setReading(true);
    try {
      setAvatar(await readCover(file));
    } catch {
      setError("Выберите изображение PNG, JPEG или WebP размером до 1 МБ.");
    } finally {
      setReading(false);
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    const values = skills
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (values.length > 10 || values.some((s) => s.length > 40)) {
      setError("Укажите до 10 навыков, каждый — не длиннее 40 символов.");
      return;
    }
    if (name.trim().length < 2) {
      setError("Имя должно содержать не менее двух символов.");
      return;
    }
    setBusy(true);
    try {
      const saved = await api.updateProfile({
        display_name: name.trim(),
        avatar_image: avatar,
        skills: values,
      });
      setName(saved.display_name);
      setAvatar(saved.avatar_image ?? null);
      setSkills((saved.skills ?? []).join(", "));
      onSaved(saved);
      setNotice("Изменения сохранены.");
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Не удалось сохранить профиль.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Мой профиль</h1>
          <p>Информация, которая отображается в вашем аккаунте.</p>
        </div>
      </div>
      <form className="panel profile-form" onSubmit={save}>
        <section className="profile-photo">
          <Avatar user={preview} className="profile-avatar-large" />
          <div>
            <h2>Фотография</h2>
            <p>PNG, JPEG или WebP, до 1 МБ.</p>
            <div className="profile-photo-actions">
              <label className="button secondary profile-file">
                Выбрать фото
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={busy || reading}
                  onChange={chooseAvatar}
                />
              </label>
              {avatar && (
                <button
                  type="button"
                  className="text-button"
                  disabled={busy || reading}
                  onClick={() => {
                    setAvatar(null);
                    setNotice("");
                    setError("");
                  }}
                >
                  Убрать фото
                </button>
              )}
            </div>
            {reading && <p role="status">Загружаем изображение…</p>}
          </div>
        </section>
        <div className="profile-fields">
          <div>
            <label className="field-label" htmlFor="profile-name">
              Имя
            </label>
            <input
              id="profile-name"
              value={name}
              required
              minLength={2}
              maxLength={80}
              autoComplete="name"
              disabled={busy}
              onChange={(e) => {
                setName(e.target.value);
                setNotice("");
              }}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="profile-username">
              Никнейм
            </label>
            <input
              id="profile-username"
              value={user.username}
              readOnly
              aria-describedby="profile-username-hint"
            />
            <p className="profile-hint" id="profile-username-hint">
              Никнейм используется для входа и не меняется.
            </p>
          </div>
          <div>
            <label className="field-label" htmlFor="profile-skills">
              Навыки
            </label>
            <input
              id="profile-skills"
              value={skills}
              maxLength={500}
              disabled={busy}
              onChange={(e) => {
                setSkills(e.target.value);
                setNotice("");
              }}
              placeholder="Например: C++, графы, динамическое программирование"
              aria-describedby="profile-skills-hint"
            />
            <p className="profile-hint" id="profile-skills-hint">
              Через запятую, до 10 навыков. Можно оставить пустым.
            </p>
          </div>
        </div>
        {error && (
          <p className="profile-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="profile-notice" role="status">
            {notice}
          </p>
        )}
        <button
          className="button primary"
          type="submit"
          disabled={busy || reading}
        >
          {busy ? "Сохраняем…" : "Сохранить изменения"}
        </button>
      </form>
    </>
  );
}
