import { useState, type FormEvent, type ReactNode } from "react";
import "./Login.scss";

type LoginProps = {
  onEnter: (username: string, password: string) => Promise<void> | void;
  onRegister: (
    name: string,
    username: string,
    password: string,
  ) => Promise<void> | void;
  onClearError: () => void;
  error?: string;
  themeControl?: ReactNode;
};

const quickProfiles = [
  {
    label: "Участник",
    name: "Аня Морозова",
    username: "demo-participant-1",
    password: "demo123",
  },
  {
    label: "Участник",
    name: "Марк Смирнов",
    username: "demo-participant-2",
    password: "demo123",
  },
  {
    label: "Организатор",
    name: "Ирина Климова",
    username: "demo-organizer",
    password: "demo123",
  },
];

/** Экран использует существующую авторизацию; он не хранит пароль. */
export default function Login({
  onEnter,
  onRegister,
  onClearError,
  error = "",
  themeControl,
}: LoginProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const message = error || localError;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setLocalError("");
    onClearError();
    if (mode === "register" && password !== confirmation) {
      setLocalError("Пароли не совпадают.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "register")
        await onRegister(name.trim(), username.trim(), password);
      else await onEnter(username.trim(), password);
    } catch {
      setLocalError(
        mode === "register"
          ? "Не удалось зарегистрироваться. Попробуйте ещё раз."
          : "Не удалось войти. Попробуйте ещё раз.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <a className="skip-link" href="#login-main">
        К форме входа
      </a>
      <header className="login-header">
        <div className="brand login-brand" aria-label="КонтурКод">
          <span className="brand-logo" aria-hidden="true" />
          <span>
            контур<span className="brand-strong">код</span>
          </span>
        </div>
        {themeControl && <div className="login-theme">{themeControl}</div>}
      </header>

      <main id="login-main" className="login-main" tabIndex={-1}>
        <section className="login-intro" aria-labelledby="login-intro-title">
          <p className="login-kicker">Соревнования по программированию</p>
          <h1 id="login-intro-title">
            Решайте задачи.
            <br />
            Соревнуйтесь вместе.
          </h1>
          <p>
            Участвуйте в контестах, приглашайте соперника на дуэль или решайте
            задачи в команде.
          </p>
        </section>

        <section className="login-panel" aria-labelledby="login-heading">
          <h2 id="login-heading" tabIndex={-1}>
            {mode === "register" ? "Регистрация участника" : "Вход в КонтурКод"}
          </h2>
          <p className="login-help">
            {mode === "register"
              ? "Создайте учётную запись, чтобы участвовать в соревнованиях."
              : "Введите имя пользователя и пароль вашей учётной записи."}
          </p>
          {mode === "login" && (
            <div
              className="login-profiles"
              aria-label="Быстрый вход для проверки интерфейса"
            >
              <p>Быстрый вход</p>
              <div className="login-profile-list">
                {quickProfiles.map((profile) => (
                  <button
                    key={profile.username}
                    type="button"
                    className="login-profile"
                    onClick={() => {
                      setUsername(profile.username);
                      setPassword(profile.password);
                      setLocalError("");
                      onClearError();
                    }}
                  >
                    <span className="login-profile-avatar" aria-hidden="true">
                      {profile.name
                        .split(" ")
                        .map((part) => part[0])
                        .join("")}
                    </span>
                    <span className="login-profile-copy">
                      <strong>{profile.name}</strong>
                      <small>{profile.label}</small>
                    </span>
                    <span className="login-profile-action">Заполнить</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <form className="login-form" onSubmit={submit} aria-busy={busy}>
            {mode === "register" && (
              <div className="login-field">
                <label htmlFor="register-name">Как вас зовут</label>
                <input
                  id="register-name"
                  name="name"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={80}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setLocalError("");
                    onClearError();
                  }}
                />
              </div>
            )}
            <div className="login-field">
              <label htmlFor="login-username">Имя пользователя</label>
              <input
                id="login-username"
                name="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                minLength={mode === "register" ? 3 : undefined}
                maxLength={mode === "register" ? 32 : undefined}
                pattern={
                  mode === "register"
                    ? "[A-Za-z0-9][A-Za-z0-9_.-]{2,31}"
                    : undefined
                }
                aria-describedby={
                  mode === "register" ? "register-username-hint" : undefined
                }
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  setLocalError("");
                  onClearError();
                }}
              />
              {mode === "register" && (
                <small id="register-username-hint" className="login-hint">
                  От 3 до 32 латинских букв и цифр; также можно использовать
                  точку, дефис и подчёркивание. Первый символ — буква или цифра.
                </small>
              )}
            </div>
            <div className="login-field">
              <label htmlFor="login-password">Пароль</label>
              <div className="login-password-control">
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={
                    mode === "register" ? "new-password" : "current-password"
                  }
                  required
                  minLength={mode === "register" ? 8 : undefined}
                  maxLength={mode === "register" ? 128 : undefined}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setLocalError("");
                    onClearError();
                  }}
                  aria-describedby={
                    mode === "register"
                      ? "register-password-hint"
                      : message
                        ? "login-error"
                        : undefined
                  }
                />
                <button
                  type="button"
                  className="login-password-toggle"
                  aria-pressed={showPassword}
                  aria-controls="login-password"
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? "Скрыть" : "Показать"}
                </button>
              </div>
              {mode === "register" && (
                <small id="register-password-hint" className="login-hint">
                  Не менее 8 символов.
                </small>
              )}
            </div>
            {mode === "register" && (
              <div className="login-field">
                <label htmlFor="register-confirmation">Повторите пароль</label>
                <input
                  id="register-confirmation"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmation}
                  onChange={(event) => {
                    setConfirmation(event.target.value);
                    setLocalError("");
                    onClearError();
                  }}
                  aria-describedby={message ? "login-error" : undefined}
                />
              </div>
            )}
            {message && (
              <p id="login-error" className="login-error" role="alert">
                {message}
              </p>
            )}
            <button type="submit" className="login-submit" disabled={busy}>
              {busy
                ? mode === "register"
                  ? "Создаём аккаунт…"
                  : "Входим…"
                : mode === "register"
                  ? "Зарегистрироваться"
                  : "Войти"}
            </button>
          </form>
          <p className="login-contact">
            {mode === "login"
              ? "Нет учётной записи?"
              : "Уже есть учётная запись?"}{" "}
            <button
              className="login-mode-switch"
              type="button"
              disabled={busy}
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setPassword("");
                setConfirmation("");
                setLocalError("");
                onClearError();
                requestAnimationFrame(() =>
                  document.getElementById("login-heading")?.focus(),
                );
              }}
            >
              {mode === "login" ? "Зарегистрироваться" : "Войти"}
            </button>
          </p>
        </section>
      </main>
    </div>
  );
}
