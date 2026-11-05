import { useState, type FormEvent, type ReactNode } from 'react';
import './Login.css';

type LoginProps = {
  onEnter: (username: string, password: string) => Promise<void> | void;
  error?: string;
  themeControl?: ReactNode;
};

const quickProfiles = [
  { label: 'Участник', name: 'Аня Морозова', username: 'demo-participant-1', password: 'demo123' },
  { label: 'Участник', name: 'Марк Смирнов', username: 'demo-participant-2', password: 'demo123' },
  { label: 'Организатор', name: 'Ирина Климова', username: 'demo-organizer', password: 'demo123' },
];

/** Экран использует существующую авторизацию; он не хранит пароль. */
export default function Login({ onEnter, error = '', themeControl }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const message = error || localError;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setLocalError('');
    setBusy(true);
    try {
      await onEnter(username.trim(), password);
    } catch {
      setLocalError('Не удалось войти. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="login-page">
    <a className="skip-link" href="#login-main">К форме входа</a>
    <header className="login-header">
      <div className="brand login-brand" aria-label="КонтурКод">
        <span className="brand-mark" aria-hidden="true"><i/><i/><i/></span>
        <span>контур<span className="brand-strong">код</span><small>алгоритмические соревнования</small></span>
      </div>
      {themeControl && <div className="login-theme">{themeControl}</div>}
    </header>

    <main id="login-main" className="login-main" tabIndex={-1}>
      <section className="login-intro" aria-labelledby="login-intro-title">
        <p className="login-kicker">Соревнования по программированию</p>
        <h1 id="login-intro-title">Решайте задачи.<br/>Соревнуйтесь вместе.</h1>
        <p>Участвуйте в контестах, приглашайте соперника на дуэль или решайте задачи в команде.</p>
      </section>

      <section className="login-panel" aria-labelledby="login-heading">
        <h2 id="login-heading">Вход в КонтурКод</h2>
        <p className="login-help">Введите имя пользователя и пароль вашей учётной записи.</p>
        <div className="login-profiles" aria-label="Быстрый вход для проверки интерфейса">
          <p>Быстрый вход</p>
          <div className="login-profile-list">
            {quickProfiles.map(profile => <button
              key={profile.username}
              type="button"
              className="login-profile"
              onClick={() => { setUsername(profile.username); setPassword(profile.password); setLocalError(''); }}
            >
              <span className="login-profile-avatar" aria-hidden="true">{profile.name.split(' ').map(part => part[0]).join('')}</span>
              <span className="login-profile-copy"><strong>{profile.name}</strong><small>{profile.label}</small></span>
              <span className="login-profile-action">Заполнить</span>
            </button>)}
          </div>
        </div>
        <form className="login-form" onSubmit={submit} aria-busy={busy}>
          <div className="login-field">
            <label htmlFor="login-username">Имя пользователя</label>
            <input id="login-username" name="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={username} onChange={event => setUsername(event.target.value)} />
          </div>
          <div className="login-field">
            <label htmlFor="login-password">Пароль</label>
            <div className="login-password-control">
              <input id="login-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} aria-describedby={message ? 'login-error' : undefined}/>
              <button type="button" className="login-password-toggle" aria-pressed={showPassword} aria-controls="login-password" onClick={() => setShowPassword(value => !value)}>{showPassword ? 'Скрыть' : 'Показать'}</button>
            </div>
          </div>
          {message && <p id="login-error" className="login-error" role="alert">{message}</p>}
          <button type="submit" className="login-submit" disabled={busy}>{busy ? 'Входим…' : 'Войти'}</button>
        </form>
        <p className="login-contact">Нет учётной записи? Обратитесь к организатору соревнования.</p>
      </section>
    </main>
    <footer className="login-footer">КонтурКод · соревнования по программированию</footer>
  </div>;
}
