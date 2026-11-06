import Login from "./Login";
import { useLocation, useNavigate } from "react-router-dom";
import { DuelHistory, InvitationPage } from "./DuelPages";
import Profile, { Avatar } from "./Profile";
import ContestPage, { readCover } from "./ContestPage";
import {
  ParticipantOverview,
  ParticipantTasks,
  PersonalResults,
  OrganizerResults,
} from "./NavigationViews";
import ConnectedIntegrity from "./ConnectedIntegrity";
import ActivityMonitor from "./ActivityMonitor";
import {
  ContestList,
  TaskView,
  ResultsView,
  MatchView,
  OrganizerView,
  TasksView,
} from "./LiveViews";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  ApiError,
  setApiToken,
  type User,
  type Task as ApiTask,
  type Contest as ApiContest,
  type Submission as ApiSubmission,
  type Match as ApiMatch,
  type LoginResponse,
} from "./api";

type ThemePreference = "system" | "light" | "dark";
const themeStorageKey = "kontur-kod-theme";
const authStorageKey = "kontur-kod-session";

function readAuthToken(): string | null {
  try {
    return localStorage.getItem(authStorageKey);
  } catch {
    return null;
  }
}

setApiToken(readAuthToken());

function readThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(themeStorageKey);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function ThemeSwitcher({
  value,
  onChange,
}: {
  value: ThemePreference;
  onChange: (value: ThemePreference) => void;
}) {
  return (
    <fieldset className="theme-switcher" aria-label="Тема оформления">
      <div role="group" aria-label="Выбор темы" className="theme-options">
        {(
          [
            ["system", "Системная"],
            ["light", "Светлая"],
            ["dark", "Тёмная"],
          ] as const
        ).map(([theme, label]) => (
          <button
            key={theme}
            type="button"
            aria-pressed={value === theme}
            onClick={() => onChange(theme)}
          >
            {label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

type Role = "participant" | "organizer";
type Page =
  | "home"
  | "contests"
  | "contest"
  | "match-workspace"
  | "results"
  | "duel"
  | "team"
  | "tasks"
  | "integrity"
  | "activity"
  | "create-task"
  | "create-contest"
  | "participant-tasks"
  | "personal-results"
  | "organizer-results"
  | "contest-detail"
  | "profile";
type RoutedPage = Page | "invitation" | "duel-history";
const pagePaths: Record<Page, string> = {
  home: "/",
  contests: "/contests",
  contest: "/contest/tasks",
  "match-workspace": "/match/tasks",
  results: "/contest/results",
  duel: "/duels",
  team: "/teams",
  tasks: "/organizer/tasks",
  integrity: "/organizer/review",
  activity: "/organizer/activity",
  "create-task": "/organizer/tasks/new",
  "create-contest": "/organizer/contests/new",
  "participant-tasks": "/tasks",
  "personal-results": "/results",
  "organizer-results": "/organizer/results",
  "contest-detail": "/contest",
  profile: "/profile",
};
function pageFromPath(path: string): RoutedPage {
  if (/^\/(duels|teams)\/[^/]+\/invite\/?$/.test(path)) return "invitation";
  if (path === "/duels/history") return "duel-history";
  if (/^\/(duels|teams)\/[^/]+\/tasks\/?$/.test(path)) return "match-workspace";
  if (/^\/duels\/[^/]+\/?$/.test(path)) return "duel";
  if (/^\/teams\/[^/]+\/?$/.test(path)) return "team";
  return (
    (Object.entries(pagePaths).find(([, value]) => value === path)?.[0] as
      Page | undefined) ?? "home"
  );
}
type Verdict = "OK" | "WA" | "TLE" | "RE" | "CE" | "В очереди";
type Submission = {
  id: number;
  name: string;
  task: string;
  verdict: Verdict;
  time: string;
  points: number;
};
const icons: Record<string, string> = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z",
  trophy:
    "M8 21h8m-4-4v4m0-4a6 6 0 0 0 6-6V4H6v7a6 6 0 0 0 6 6ZM6 7H3v2a4 4 0 0 0 4 4m11-6h3v2a4 4 0 0 1-4 4",
  code: "m8 17-5-5 5-5m8 0 5 5-5 5m-3-12-2 14",
  chart: "M4 19V9m5 10V5m5 14v-7m5 7V3",
  swords:
    "m14.5 17.5 3 3m-14-14 3 3m0 0L19 3l2 2L9.5 16.5m0 0-3 3m-1-1 2-2m8-8 3 3m0 0 2 2m-2-2 2-2m-2 2-2 2",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m6-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm11 10v-2a4 4 0 0 0-3-3.87m-1-12.13a4 4 0 0 1 0 7.75",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  shield: "M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Zm-3-11 2 2 4-4",
  plus: "M12 5v14m-7-7h14",
  arrow: "M5 12h14m-7-7 7 7-7 7",
  clock: "M12 8v4l3 2m7-2a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  search: "m21 21-4.35-4.35M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0Z",
  activity:
    "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  copy: "M8 8V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-4m-12 6h10a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2Z",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 13h4",
  back: "m15 18-6-6 6-6M20 12H9",
};
function Icon({ name, size = 19 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={icons[name] || icons.grid} />
    </svg>
  );
}

const verdictLabel: Record<Verdict, string> = {
  OK: "Принято",
  WA: "Неверный ответ",
  TLE: "Превышено время",
  RE: "Ошибка выполнения",
  CE: "Ошибка компиляции",
  "В очереди": "В очереди",
};

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<ThemePreference>(readThemePreference);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolved =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.setProperty(
        "--brand-logo-url",
        `url(/logo-${resolved}.svg)`,
      );
      document.documentElement.style.colorScheme = resolved;
    };
    applyTheme();
    try {
      localStorage.setItem(themeStorageKey, theme);
    } catch {
      /* Storage is optional. */
    }
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);
  const [role, setRole] = useState<Role | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState("");
  const [page, setPage] = useState<RoutedPage>(() =>
    pageFromPath(location.pathname),
  );
  useEffect(() => {
    setPage(pageFromPath(location.pathname));
  }, [location.pathname]);
  const [toast, setToast] = useState("");
  const [authChecking, setAuthChecking] = useState(() =>
    Boolean(readAuthToken()),
  );
  const [apiTasks, setApiTasks] = useState<ApiTask[]>([]);
  const [apiContests, setApiContests] = useState<ApiContest[]>([]);
  const [apiSubs, setApiSubs] = useState<ApiSubmission[]>([]);
  const [activeContest, setActiveContest] = useState<ApiContest | null>(null);
  const [activeMatch, setActiveMatch] = useState<ApiMatch | null>(null);
  const routeMatchId = location.pathname.match(
    /^\/(?:duels|teams)\/([a-f0-9]{16})(?:\/tasks)?\/?$/,
  )?.[1];
  // A match remains recoverable after a refresh or temporary disconnection.
  useEffect(() => {
    if (
      !user ||
      user.role !== "participant" ||
      (page !== "duel" && page !== "team") ||
      /^\/(duels|teams)\/[^/]+/.test(location.pathname)
    )
      return;
    let cancelled = false;
    let retry: number | undefined;
    const key = `kontur-kod-match-${user.id}-${page}`;
    const savedId = Number(localStorage.getItem(key));
    setActiveMatch(null);
    const restore = () => {
      if (cancelled || Number(localStorage.getItem(key)) !== savedId) return;
      api
        .matchState(savedId)
        .then((m) => {
          if (!cancelled && Number(localStorage.getItem(key)) === savedId)
            setActiveMatch(m);
        })
        .catch((e) => {
          if (cancelled) return;
          if (e instanceof ApiError && (e.status === 403 || e.status === 404))
            localStorage.removeItem(key);
          else retry = window.setTimeout(restore, 5000);
        });
    };
    if (savedId > 0) restore();
    return () => {
      cancelled = true;
      window.clearTimeout(retry);
    };
  }, [
    user?.id,
    page === "duel" || page === "team" ? page : null,
    location.pathname,
  ]);
  useEffect(() => {
    const match = location.pathname.match(
      /^\/(duels|teams)\/([a-f0-9]{16})(?:\/tasks)?\/?$/,
    );
    if (!user || !match) return;
    let alive = true;
    api
      .matchByPublicId(match[2])
      .then((m) => {
        if (alive) {
          setActiveMatch(m);
          setLiveError("");
        }
      })
      .catch((e) => {
        if (alive)
          setLiveError(
            e instanceof ApiError ? e.message : "Не удалось открыть раунд",
          );
      });
    return () => {
      alive = false;
    };
  }, [user?.id, location.pathname]);
  useEffect(() => {
    if (!user || user.role !== "participant" || !activeMatch) return;
    const token = readAuthToken();
    if (!token) return;
    let stopped = false;
    let socket: WebSocket | undefined;
    let retry: number | undefined;
    const refresh = () =>
      api
        .matchState(activeMatch.id)
        .then((m) => {
          if (!stopped) setActiveMatch(m);
        })
        .catch(() => {});
    const connect = () => {
      if (stopped) return;
      socket = api.matchSocket(activeMatch.id, token);
      socket.onopen = refresh;
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "match.updated" && payload.match)
            setActiveMatch(payload.match);
        } catch {
          /* Ignore malformed messages. */
        }
      };
      socket.onclose = () => {
        if (!stopped) retry = window.setTimeout(connect, 3000);
      };
    };
    connect();
    const polling = window.setInterval(refresh, 5000);
    return () => {
      stopped = true;
      window.clearInterval(polling);
      window.clearTimeout(retry);
      socket?.close();
    };
  }, [user?.id, activeMatch?.id]);
  const updateActiveMatch = (match: ApiMatch | null) => {
    setActiveMatch(match);
    if (!user) return;
    const mode =
      match?.mode ??
      (page === "duel" || page === "team" ? page : activeMatch?.mode);
    if (!mode) return;
    const key = `kontur-kod-match-${user.id}-${mode}`;
    if (match) localStorage.setItem(key, String(match.id));
    else localStorage.removeItem(key);
  };
  const [liveError, setLiveError] = useState("");
  const [subs, setSubs] = useState<Submission[]>([]);
  const [code, setCode] = useState(
    "#include <iostream>\nusing namespace std;\n\nint main() {\n  int a, b;\n  cin >> a >> b;\n  cout << a + b;\n  return 0;\n}",
  );
  const [activeTask, setActiveTask] = useState("A. Сумма чисел");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [joined, setJoined] = useState(false);
  const [joinedContest, setJoinedContest] = useState(false);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [createdTasks, setCreatedTasks] = useState<string[]>([]);
  const [createdContests, setCreatedContests] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [initialTaskId, setInitialTaskId] = useState<number | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);
  useEffect(() => {
    const token = readAuthToken();
    if (!token) {
      setAuthChecking(false);
      return;
    }
    let alive = true;
    api
      .me()
      .then((restored) => {
        if (!alive) return;
        setUser(restored);
        setRole(restored.role);
        const mode = new URLSearchParams(window.location.search).get("mode");
        if (location.pathname === "/")
          setPage(
            restored.role === "participant" &&
              (mode === "duel" || mode === "team")
              ? mode
              : "home",
          );
      })
      .catch(() => {
        setApiToken(null);
        try {
          localStorage.removeItem(authStorageKey);
        } catch {
          /* Storage is optional. */
        }
      })
      .finally(() => {
        if (alive) setAuthChecking(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  const ping = (message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      setToast("");
      toastTimer.current = undefined;
    }, 3000);
  };
  const startSession = (result: LoginResponse) => {
    setApiToken(result.access_token);
    try {
      localStorage.setItem(authStorageKey, result.access_token);
    } catch {
      /* Keep the current session if storage is unavailable. */
    }
    setUser(result.user);
    setRole(result.user.role);
    const inviteMode = new URLSearchParams(window.location.search).get("mode");
    if (location.pathname === "/")
      setPage(
        result.user.role === "participant" &&
          (inviteMode === "duel" || inviteMode === "team")
          ? inviteMode
          : "home",
      );
    ping(`Вы вошли: ${result.user.display_name}`);
  };
  const login = async (username: string, password: string) => {
    setAuthError("");
    try {
      startSession(await api.login(username, password));
    } catch (e) {
      setAuthError(e instanceof ApiError ? e.message : "Не удалось войти");
    }
  };
  const register = async (name: string, username: string, password: string) => {
    setAuthError("");
    try {
      startSession(await api.registerParticipant(name, username, password));
    } catch (e) {
      setAuthError(
        e instanceof ApiError ? e.message : "Не удалось зарегистрироваться",
      );
    }
  };
  useEffect(() => {
    if (!role) return;
    let alive = true;
    Promise.all([api.tasks(), api.contests()])
      .then(([t, c]) => {
        if (alive) {
          setApiTasks(t);
          setApiContests(c);
          setActiveContest(
            (previous) =>
              c.find((item) => item.id === previous?.id) ?? c[0] ?? null,
          );
        }
      })
      .catch((e) => {
        if (alive)
          setLiveError(
            e instanceof ApiError ? e.message : "Ошибка загрузки данных",
          );
      });
    return () => {
      alive = false;
    };
  }, [role]);
  const logout = () => {
    setApiToken(null);
    try {
      localStorage.removeItem(authStorageKey);
    } catch {
      /* Storage is optional. */
    }
    setUser(null);
    setRole(null);
    setPage("home");
    setApiTasks([]);
    setApiContests([]);
    setActiveContest(null);
    setActiveMatch(null);
    setLiveError("");
  };
  const refreshContests = () => {
    api
      .contests()
      .then((c) => {
        setApiContests(c);
        setActiveContest(
          (previous) =>
            c.find((item) => item.id === previous?.id) ?? c[0] ?? null,
        );
      })
      .catch((e) =>
        setLiveError(
          e instanceof ApiError
            ? e.message
            : "Не удалось загрузить соревнования",
        ),
      );
  };
  const navGroups: {
    label?: string;
    items: { id: Page; label: string; icon: string }[];
  }[] =
    role === "organizer"
      ? [
          {
            items: [
              { id: "home", label: "Обзор", icon: "grid" },
              { id: "contests", label: "Контесты", icon: "trophy" },
              { id: "tasks", label: "Банк задач", icon: "code" },
              { id: "organizer-results", label: "Результаты", icon: "chart" },
              { id: "integrity", label: "Разбор отправок", icon: "shield" },
              { id: "activity", label: "Активность", icon: "activity" },
            ],
          },
        ]
      : [
          {
            label: "Участие",
            items: [
              { id: "home", label: "Обзор", icon: "grid" },
              { id: "contests", label: "Соревнования", icon: "trophy" },
              { id: "participant-tasks", label: "Задачи", icon: "list" },
            ],
          },
          {
            label: "Парные режимы",
            items: [
              { id: "duel", label: "Дуэль 1 на 1", icon: "swords" },
              { id: "team", label: "Командный раунд", icon: "users" },
            ],
          },
          {
            label: "Мои итоги",
            items: [
              {
                id: "personal-results",
                label: "Результаты и отправки",
                icon: "chart",
              },
            ],
          },
        ];
  const navItems = navGroups.flatMap((group) => group.items);
  const isNavActive = (id: Page) =>
    page === id ||
    (id === "contests" &&
      (page === "contest-detail" ||
        (page === "contest" && initialTaskId === null) ||
        (page === "results" && role === "participant") ||
        page === "create-contest")) ||
    (id === "participant-tasks" &&
      page === "contest" &&
      initialTaskId !== null) ||
    (id === "organizer-results" &&
      page === "results" &&
      role === "organizer") ||
    (id === "tasks" && page === "create-task");
  const mobileLabels: Partial<Record<Page, string>> = {
    home: "Обзор",
    contests: "Контесты",
    tasks: "Банк",
    "participant-tasks": "Задачи",
    duel: "Дуэль",
    team: "Команда",
    "personal-results": "Итоги",
    "organizer-results": "Итоги",
    integrity: "Разбор",
    activity: "Активность",
  };
  const go = (p: RoutedPage) => {
    if (p === "duel" || p === "team") setInitialTaskId(null);
    setPage(p);
    if (p === "duel-history") navigate("/duels/history");
    else if (p !== "invitation") {
      const dynamic =
        activeMatch &&
        (p === "match-workspace" ||
          (p === activeMatch.mode && page === "match-workspace"));
      navigate(
        dynamic
          ? `/${activeMatch.mode === "duel" ? "duels" : "teams"}/${activeMatch.public_id}${p === "match-workspace" ? "/tasks" : ""}`
          : pagePaths[p],
      );
    }
    setNotice("");
  };
  const filteredSubs = useMemo(
    () =>
      subs.filter((s) =>
        (s.name + " " + s.task + " " + s.verdict)
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [subs, query],
  );
  const submit = async () => {
    if (!code.trim()) {
      ping("Добавьте код решения перед отправкой");
      return;
    }
    const contest = activeContest ?? apiContests[0];
    const task =
      apiTasks.find((t) => t.title === activeTask.replace(/^[A-Z]\. /, "")) ??
      apiTasks.find((t) => contest?.task_ids.includes(t.id));
    if (!contest || !task) {
      setLiveError(
        "Для отправки нужны загруженный контест и задача из его списка.",
      );
      return;
    }
    setLoading(true);
    setLiveError("");
    try {
      const sent = await api.submit({
        contest_id: contest.id,
        task_id: task.id,
        source_code: code,
      });
      const latest = await api.submission(sent.id);
      setApiSubs((current) => [
        latest,
        ...current.filter((x) => x.id !== latest.id),
      ]);
      setSubs((current) => [
        {
          id: latest.id,
          name: user?.display_name ?? "Вы",
          task: task.title,
          verdict: latest.verdict as unknown as Verdict,
          time: new Date(latest.created_at).toLocaleString("ru-RU"),
          points: latest.verdict === "OK" ? 100 : 0,
        },
        ...current,
      ]);
      ping(`Результат проверки: ${latest.verdict}`);
    } catch (e) {
      setLiveError(
        e instanceof ApiError ? e.message : "Не удалось отправить решение",
      );
    } finally {
      setLoading(false);
    }
  };
  const formSubmit = async (
    e: FormEvent<HTMLFormElement>,
    kind: "task" | "contest",
  ) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const title = String(data.get("title") || "").trim();
    setLoading(true);
    setLiveError("");
    try {
      if (kind === "task") {
        const time = String(data.get("time") || "1 секунда");
        const memory = String(data.get("memory") || "256 МБ");
        const created = await api.createTask({
          title,
          statement: String(data.get("description") || ""),
          time_limit_ms: time.startsWith("2")
            ? 2000
            : time.startsWith("3")
              ? 3000
              : 1000,
          memory_limit_kb: memory.startsWith("512") ? 524288 : 262144,
          difficulty: String(data.get("difficulty") || "medium") as "easy" | "medium" | "hard",
          tests: [
            {
              input: String(data.get("sampleInput") || ""),
              output: String(data.get("sampleOutput") || ""),
            },
          ],
        });
        setApiTasks((x) => [created, ...x]);
        go("tasks");
        ping("Задача создана");
      } else {
        const ids = data
          .getAll("selectedTasks")
          .map(Number)
          .filter(Number.isInteger);
        if (!ids.length) {
          ping("Выберите хотя бы одну задачу");
          return;
        }
        const date = String(data.get("date") || "");
        if (!date) {
          ping("Укажите дату и время начала");
          return;
        }
        const file = data.get("cover");
        const cover_image =
          file instanceof File && file.size ? await readCover(file) : null;
        const created = await api.createContest({
          title,
          description: String(data.get("description") || ""),
          cover_image,
          starts_at: new Date(date).toISOString(),
          duration_minutes: Number(
            String(data.get("duration") || "60").match(/\d+/)?.[0] || 60,
          ),
          task_ids: ids,
        });
        setApiContests((x) => [created, ...x]);
        go("contests");
        ping("Контест создан");
      }
    } catch (e) {
      setLiveError(
        e instanceof Error ? e.message : "Не удалось создать элемент",
      );
    } finally {
      setLoading(false);
    }
  };
  if (authChecking)
    return (
      <div className="auth-restoring" role="status">
        Восстанавливаем вход…
      </div>
    );
  if (!role || !user)
    return (
      <Login
        onEnter={login}
        onRegister={register}
        onClearError={() => setAuthError("")}
        error={authError}
        themeControl={<ThemeSwitcher value={theme} onChange={setTheme} />}
      />
    );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        К основному содержимому
      </a>
      <header className="topbar">
        <button
          className="brand"
          onClick={() => go("home")}
          aria-label="КонтурКод — на главную"
        >
          <span className="brand-logo" aria-hidden="true" />
          <span>
            контур<span className="brand-strong">код</span>
          </span>
        </button>
        <div className="topbar-right">
          <ThemeSwitcher value={theme} onChange={setTheme} />
          <button
            className="top-icon"
            aria-label="Уведомления"
            onClick={() => ping("Новых уведомлений нет")}
          >
            <Icon name="bell" />
          </button>
          <div className="user-menu">
            <button
              type="button"
              className="profile-trigger"
              onClick={() => go("profile")}
              aria-label="Открыть мой профиль"
            >
              <Avatar user={user} />
              <span className="user-meta">
                {user.display_name}
                <small>
                  {role === "participant" ? "Участник" : "Организатор"}
                </small>
              </span>
            </button>
            <button className="text-button" onClick={logout}>
              Выйти
            </button>
          </div>
          <div className="mobile-account">
            <button
              type="button"
              className="mobile-profile"
              onClick={() => go("profile")}
              aria-label="Открыть мой профиль"
            >
              <Avatar user={user} />
            </button>
            <button className="text-button mobile-logout" onClick={logout}>
              Выйти
            </button>
          </div>
        </div>
      </header>
      <div className="layout">
        <aside className="sidebar">
          <nav aria-label="Основная навигация">
            {navGroups.map((group, index) => (
              <div className="nav-group" key={group.label ?? index}>
                {group.label && (
                  <div className="nav-group-label">{group.label}</div>
                )}
                {group.items.map((n) => (
                  <button
                    key={n.id}
                    className={`nav-item ${isNavActive(n.id) ? "active" : ""}`}
                    aria-current={isNavActive(n.id) ? "page" : undefined}
                    aria-label={n.label}
                    onClick={() => go(n.id)}
                  >
                    <Icon name={n.icon} />
                    <span>{n.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </aside>
        <main id="main" className="main-content" tabIndex={-1}>
          {liveError && (
            <div role="alert" className="form-note">
              {liveError}
              <button className="text-link" onClick={() => setLiveError("")}>
                Закрыть
              </button>
            </div>
          )}
          {page === "profile" && <Profile user={user} onSaved={setUser} />}
          {page === "contests" && (
            <ContestList
              contests={apiContests}
              user={user}
              onSelect={(c) => {
                setActiveContest(c);
                setInitialTaskId(null);
              }}
              onRefresh={refreshContests}
              go={go}
            />
          )}
          {page === "contest-detail" && (
            <ContestPage
              contest={activeContest}
              tasks={apiTasks}
              user={user}
              update={(c) => {
                setActiveContest(c);
                setApiContests((items) =>
                  items.map((item) => (item.id === c.id ? c : item)),
                );
              }}
              go={go}
            />
          )}
          {page === "contest" && (
            <TaskView
              initialTaskId={initialTaskId}
              contest={activeContest}
              tasks={apiTasks}
              user={user}
              match={null}
              go={go}
            />
          )}
          {page === "match-workspace" &&
            routeMatchId &&
            activeMatch?.public_id !== routeMatchId && (
              <p role="status">
                {liveError ? "Не удалось открыть раунд." : "Загружаем раунд…"}
              </p>
            )}
          {page === "match-workspace" &&
            activeMatch &&
            (!routeMatchId || activeMatch.public_id === routeMatchId) && (
              <TaskView
                key={`match-${activeMatch.id}`}
                contest={null}
                tasks={apiTasks}
                user={user}
                match={activeMatch}
                onMatchUpdate={updateActiveMatch}
                go={go}
              />
            )}
          {page === "results" && (
            <ResultsView
              contest={activeContest}
              tasks={apiTasks}
              user={user}
              go={go}
            />
          )}
          {(page === "duel" || page === "team") &&
            routeMatchId &&
            activeMatch?.public_id !== routeMatchId && (
              <p role="status">
                {liveError ? "Не удалось открыть раунд." : "Загружаем раунд…"}
              </p>
            )}
          {(page === "duel" || page === "team") &&
            (!routeMatchId || activeMatch?.public_id === routeMatchId) && (
              <MatchView
                key={page}
                mode={page}
                userId={user.id}
                tasks={apiTasks}
                match={activeMatch}
                setMatch={(m) => {
                  updateActiveMatch(m);
                  navigate(
                    m
                      ? `/${m.mode === "duel" ? "duels" : "teams"}/${m.public_id}`
                      : page === "duel"
                        ? "/duels"
                        : "/teams",
                    { replace: true },
                  );
                }}
                go={go}
              />
            )}
          {page === "invitation" && role === "participant" && (
            <InvitationPage
              onAccept={(m) => {
                updateActiveMatch(m);
                navigate(
                  `/${m.mode === "duel" ? "duels" : "teams"}/${m.public_id}`,
                  { replace: true },
                );
              }}
            />
          )}
          {page === "duel-history" && role === "participant" && (
            <DuelHistory
              userId={user.id}
              onOpen={(m) => {
                updateActiveMatch(m);
                navigate(`/duels/${m.public_id}`);
              }}
            />
          )}
          {page === "home" && role === "participant" && (
            <ParticipantOverview
              contests={apiContests}
              go={go}
              open={(c) => {
                setActiveContest(c);
                setInitialTaskId(null);
                go("contest-detail");
              }}
            />
          )}
          {page === "participant-tasks" && role === "participant" && (
            <ParticipantTasks
              contests={apiContests}
              tasks={apiTasks}
              open={(c, id) => {
                setActiveContest(c);
                setInitialTaskId(id);
                go("contest");
              }}
            />
          )}
          {page === "personal-results" && role === "participant" && (
            <PersonalResults contests={apiContests} tasks={apiTasks} />
          )}
          {page === "organizer-results" && role === "organizer" && (
            <OrganizerResults
              contests={apiContests.filter((c) => c.organizer_id === user.id)}
              open={(c) => {
                setActiveContest(c);
                go("results");
              }}
            />
          )}
          {page === "home" && role === "organizer" && (
            <OrganizerView
              go={go}
              contests={apiContests.filter((c) => c.organizer_id === user.id)}
              tasks={apiTasks}
              select={setActiveContest}
            />
          )}
          {page === "tasks" && <TasksView tasks={apiTasks} go={go} />}
          {page === "integrity" && role === "organizer" && (
            <ConnectedIntegrity
              contests={apiContests}
              tasks={apiTasks}
              organizerId={user.id}
            />
          )}
          {page === "activity" && role === "organizer" && (
            <ActivityMonitor
              contests={apiContests.filter((c) => c.organizer_id === user.id)}
              organizerId={user.id}
            />
          )}
          {page === "create-task" && (
            <CreateForm
              kind="task"
              onSubmit={formSubmit}
              onBack={() => go("tasks")}
              tasks={apiTasks}
            />
          )}
          {page === "create-contest" && (
            <CreateForm
              kind="contest"
              onSubmit={formSubmit}
              onBack={() => go("home")}
              tasks={apiTasks}
            />
          )}
        </main>
        <nav className="mobile-bottom" aria-label="Основная навигация">
          {navItems.map((n) => (
            <button
              key={n.id}
              type="button"
              className={isNavActive(n.id) ? "selected" : ""}
              onClick={() => go(n.id)}
              aria-label={n.label}
              aria-current={isNavActive(n.id) ? "page" : undefined}
            >
              <Icon name={n.icon} />
              <span>{mobileLabels[n.id] ?? n.label}</span>
            </button>
          ))}
        </nav>
        {toast && (
          <div role="status" className="toast">
            <span className="toast-check">✓</span>
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

function PageHeading({
  eyebrow,
  title,
  desc,
  action,
}: {
  eyebrow: string;
  title: string;
  desc: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{desc}</p>
      </div>
      {action && <div className="heading-action">{action}</div>}
    </div>
  );
}
function CreateForm({
  kind,
  onSubmit,
  onBack,
  tasks,
}: {
  kind: "task" | "contest";
  onSubmit: (e: FormEvent<HTMLFormElement>, k: "task" | "contest") => void;
  onBack: () => void;
  tasks: ApiTask[];
}) {
  const task = kind === "task";
  const [query, setQuery] = useState("");
  const [taskPage, setTaskPage] = useState(1);
  const matching = tasks.filter((t) =>
    t.title.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(matching.length / 6));
  const currentPage = Math.min(taskPage, pages);
  const visibleIds = new Set(
    matching.slice((currentPage - 1) * 6, currentPage * 6).map((t) => t.id),
  );
  return (
    <>
      <div className="back-row">
        <button className="back-link" onClick={onBack}>
          <Icon name="back" />
          Назад
        </button>
      </div>
      <PageHeading
        eyebrow={task ? "БИБЛИОТЕКА ЗАДАЧ" : "КАЛЕНДАРЬ СОРЕВНОВАНИЙ"}
        title={task ? "Новая задача" : "Новый контест"}
        desc={
          task
            ? "Подготовьте условие, ограничения и тестовые примеры."
            : "Выберите задачи, задайте время и соберите новый раунд."
        }
      />
      <form
        className={`panel create-form ${!task ? "contest-create-form" : ""}`}
        onSubmit={(e) => onSubmit(e, kind)}
      >
        <label className="field-label" htmlFor="form-title">
          {task ? "Название задачи" : "Название контеста"} *
        </label>
        <input
          id="form-title"
          name="title"
          required
          minLength={3}
          maxLength={80}
          placeholder={
            task ? "Например, Сумма чисел" : "Например, Вечерний спринт"
          }
        />
        <div className="form-two">
          {task ? (
            <>
              <div>
                <label className="field-label" htmlFor="time-limit">
                  Лимит времени
                </label>
                <select id="time-limit" name="time">
                  <option>1 секунда</option>
                  <option>2 секунды</option>
                  <option>3 секунды</option>
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="mem-limit">
                  Лимит памяти
                </label>
                <select id="mem-limit" name="memory">
                  <option>256 МБ</option>
                  <option>512 МБ</option>
                </select>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="field-label" htmlFor="date">
                  Дата и время
                </label>
                <input id="date" type="datetime-local" name="date" />
              </div>
              <div>
                <label className="field-label" htmlFor="duration">
                  Длительность
                </label>
                <select id="duration" name="duration">
                  <option>60 минут</option>
                  <option>90 минут</option>
                  <option>120 минут</option>
                </select>
              </div>
            </>
          )}
        </div>
        {task && (
          <div>
            <label className="field-label" htmlFor="task-difficulty">
              Сложность задачи
            </label>
            <select id="task-difficulty" name="difficulty" defaultValue="medium">
              <option value="easy">Начальная</option>
              <option value="medium">Средняя</option>
              <option value="hard">Сложная</option>
            </select>
          </div>
        )}
        {!task && (
          <fieldset className="task-picker">
            <legend className="field-label">Задачи раунда *</legend>
            <label className="field-label" htmlFor="task-search">
              Поиск задачи
            </label>
            <input
              id="task-search"
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setTaskPage(1);
              }}
              placeholder="Название задачи"
            />
            <div className="contest-task-list">
              {tasks.map((t, i) => (
                <label key={t.id} hidden={!visibleIds.has(t.id)}>
                  <input
                    type="checkbox"
                    name="selectedTasks"
                    value={t.id}
                    defaultChecked={i === 0}
                  />
                  <span>{t.title}</span>
                </label>
              ))}
            </div>
            {!matching.length && (
              <p className="body-copy">Задачи не найдены.</p>
            )}
            {pages > 1 && (
              <nav className="personal-pagination" aria-label="Страницы задач">
                <span aria-live="polite">
                  Страница {currentPage} из {pages}
                </span>
                <div>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={currentPage === 1}
                    onClick={() => setTaskPage(currentPage - 1)}
                  >
                    Назад
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={currentPage === pages}
                    onClick={() => setTaskPage(currentPage + 1)}
                  >
                    Далее
                  </button>
                </div>
              </nav>
            )}
          </fieldset>
        )}
        <label className="field-label" htmlFor="description">
          {task ? "Условие задачи" : "Описание"}
        </label>
        <textarea
          id="description"
          name="description"
          rows={5}
          placeholder={
            task
              ? "Формат ввода, ограничения и формат вывода…"
              : "Кратко расскажите участникам о контесте…"
          }
        />
        {!task && (
          <>
            <label className="field-label" htmlFor="contest-cover">
              Обложка соревнования
            </label>
            <input
              id="contest-cover"
              name="cover"
              type="file"
              accept="image/png,image/jpeg,image/webp"
            />
            <p className="body-copy">
              PNG, JPEG или WebP, до 1 МБ. Необязательно.
            </p>
          </>
        )}
        {task && (
          <div className="form-two example-fields">
            <div>
              <label className="field-label" htmlFor="sample-input">
                Пример входных данных
              </label>
              <textarea
                id="sample-input"
                name="sampleInput"
                rows={2}
                placeholder="2 3"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="sample-output">
                Пример выходных данных
              </label>
              <textarea
                id="sample-output"
                name="sampleOutput"
                rows={2}
                placeholder="5"
              />
            </div>
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onBack}>
            Отмена
          </button>
          <button className="button primary">
            Создать {task ? "задачу" : "контест"} <Icon name="arrow" />
          </button>
        </div>
      </form>
    </>
  );
}
