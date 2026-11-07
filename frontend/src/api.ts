export type Role = "participant" | "organizer";
export interface User {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  avatar_image?: string | null;
  skills?: string[];
}
export interface Task {
  id: number;
  title: string;
  statement: string;
  time_limit_ms: number;
  memory_limit_kb: number;
  difficulty: TaskDifficulty;
  tests: { input: string; output: string }[];
}
export type TaskDifficulty = "easy" | "medium" | "hard";
export interface Contest {
  id: number;
  title: string;
  description: string;
  starts_at: string;
  duration_minutes: number;
  task_ids: number[];
  organizer_id: number;
  registered: boolean;
  cover_image?: string | null;
}
export type Verdict =
  "QUEUED" | "RUNNING" | "OK" | "WA" | "TLE" | "RE" | "CE" | "CHECKER_ERROR";
export interface Submission {
  id: number;
  contest_id: number | null;
  task_id: number;
  user_id: number;
  match_id: number | null;
  source_code: string;
  language: string;
  verdict: Verdict;
  created_at: string;
  checked_at: string | null;
  error: string | null;
}
export interface Match {
  id: number;
  public_id: string;
  mode: "duel" | "team";
  task_ids: number[];
  duration_minutes: number;
  invite_code: string;
  status: "waiting" | "active" | "finished" | "cancelled" | "declined";
  creator_id: number;
  participant_ids: number[];
  started_at: string | null;
  ends_at: string | null;
  progress: {
    user_id: number;
    display_name: string;
    solved: number;
    elapsed_seconds: number;
  }[];
  team_solved: number | null;
  winner_id: number | null;
  forfeited_by: number | null;
  finish_ready_ids: number[];
  drafts: MatchDraft[];
}
export interface MatchDraft {
  task_id: number;
  source_code: string;
  updated_by: number;
  updated_at: string;
}
export interface StandingRow {
  user_id: number;
  display_name: string;
  solved: number;
  elapsed_seconds: number;
  rank: number;
  score: number;
  tasks: StandingTask[];
}
export interface StandingTask {
  task_id: number;
  status: "not_started" | "checking" | "attempted" | "solved";
  attempts: number;
  solved: boolean;
  points: number;
  points_lost: number;
}
export interface Standings {
  contest_id: number;
  task_ids: number[];
  rows: StandingRow[];
}
export interface LoginResponse {
  access_token: string;
  token_type: "bearer";
  user: User;
}
export interface IntegrityReport {
  id: number;
  contest_id: number;
  created_at: string;
  engine: string;
  details: Record<string, unknown>;
}
export interface IntegrityConclusion {
  id: number;
  contest_id: number;
  organizer_id: number;
  subject_user_id: number;
  comment: string;
  created_at: string;
}
export interface BrowserActivityPolicy {
  retention_days: number;
  collects: string[];
  does_not_collect: string[];
  purpose: string;
}
export interface BrowserActivitySession {
  session_id: string;
  contest_id: number;
  user_id: number;
  started_at: string;
  monitoring_enabled: boolean;
  policy: BrowserActivityPolicy;
}
export interface BrowserActivitySummary {
  contest_id: number;
  title: string;
  participant_count: number;
  tab_switches: number;
  event_count: number;
  high_focus_loss_participants: number;
  high_focus_loss_threshold: number;
  retention_days: number;
  disclaimer: string;
  policy: BrowserActivityPolicy;
}
export interface BrowserActivityRow {
  user_id: number;
  username: string;
  display_name: string;
  tab_switches: number;
  tab_hidden_ms: number;
  tab_hidden_unknown_intervals: number;
  window_blurs: number;
  window_blur_ms: number;
  window_blur_unknown_intervals: number;
  fullscreen_exits: number;
  copy_count: number;
  paste_count: number;
  event_count: number;
  last_activity_at: string | null;
}
export interface BrowserActivityEventRow {
  event_id: string;
  event_type: string;
  occurred_at: string;
  session_id: string;
  timestamp_untrusted: boolean;
  duration_ms: number | null;
  duration_unknown: boolean;
}
export type CodeChangeType = "INITIAL" | "AUTOSAVE" | "MANUAL_SAVE" | "SUBMISSION";
export interface CodeVersionSummary {
  id: number;
  user_id: number;
  contest_id: number | null;
  match_id: number | null;
  task_id: number;
  session_id: string;
  submission_id: number | null;
  version_number: number;
  content_hash: string;
  change_type: CodeChangeType;
  added_lines: number;
  removed_lines: number;
  code_size: number;
  created_at: string;
  created?: boolean;
}
export interface CodeVersion extends CodeVersionSummary {
  code_content: string;
}
export interface CodeHistoryAnalytics {
  version_count: number;
  change_count: number;
  added_lines: number;
  removed_lines: number;
  duration_seconds: number;
  gaps_seconds: number[];
  median_gap_seconds: number;
  first_to_last_added_lines: number;
  first_to_last_removed_lines: number;
  first_to_last_changed_lines: number;
  disclaimer: string;
}
export interface CodeHistoryPage {
  user_id: number;
  contest_id: number | null;
  match_id: number | null;
  task_id: number;
  total: number;
  limit: number;
  offset: number;
  versions: CodeVersionSummary[];
  analytics: CodeHistoryAnalytics;
  latest_code: string | null;
  disclaimer: string;
}
export interface CodeDiffRow {
  kind: "same" | "added" | "removed" | "changed";
  left: string | null;
  right: string | null;
  left_line: number | null;
  right_line: number | null;
}
export interface CodeDiff {
  from_version_id: number;
  to_version_id: number;
  from_version_number: number;
  to_version_number: number;
  added_lines: number;
  removed_lines: number;
  changed_lines: number;
  rows: CodeDiffRow[];
  unified: string;
}
export interface BrowserActivityDetail {
  contest_id: number;
  user_id: number;
  username: string;
  display_name: string;
  disclaimer: string;
  stats: Omit<BrowserActivityRow, "user_id" | "username" | "display_name">;
  events: BrowserActivityEventRow[];
  timeline: BrowserActivityEventRow[];
}
const API_BASE =
  (import.meta as ImportMeta & { env: { VITE_API_BASE_URL?: string } }).env
    .VITE_API_BASE_URL ?? "";
let authToken: string | null = null;
export function setApiToken(token: string | null) {
  authToken = token;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api${path}`, { ...init, headers });
  } catch {
    throw new ApiError(
      0,
      "Не удалось подключиться к серверу. Попробуйте ещё раз.",
    );
  }
  if (!response.ok) {
    let message = `Не удалось выполнить действие (${response.status})`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") message = body.detail;
      else if (body.detail) message = "Проверьте заполненные данные.";
    } catch {
      /* Keep HTTP status message. */
    }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
const json = (body: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
});
export const api = {
  login: (username: string, password: string) =>
    request<LoginResponse>("/auth/login", json({ username, password })),
  me: () => request<User>("/auth/me"),
  registerParticipant: (
    display_name: string,
    username: string,
    password: string,
  ) =>
    request<LoginResponse>(
      "/auth/register",
      json({ display_name, username, password }),
    ),
  profile: () => request<User>("/profile"),
  updateProfile: (body: {
    display_name: string;
    avatar_image: string | null;
    skills: string[];
  }) => request<User>("/profile", json(body)),
  tasks: () => request<Task[]>("/tasks"),
  task: (id: number) => request<Task>(`/tasks/${id}`),
  createTask: (body: Omit<Task, "id">) => request<Task>("/tasks", json(body)),
  contests: () => request<Contest[]>("/contests"),
  contest: (id: number) => request<Contest>(`/contests/${id}`),
  createContest: (body: Omit<Contest, "id" | "organizer_id" | "registered">) =>
    request<Contest>("/contests", json(body)),
  register: (id: number) =>
    request<{ registered: boolean }>(`/contests/${id}/register`, json({})),
  standings: (id: number) => request<Standings>(`/contests/${id}/standings`),
  contestCover: (id: number, cover_image: string | null) =>
    request<{ cover_image: string | null }>(
      `/contests/${id}/cover`,
      json({ cover_image }),
    ),
  submit: (
    body: (
      | { contest_id: number; match_id?: never }
      | { match_id: number; contest_id?: never }
    ) & { task_id: number; source_code: string; session_id?: string },
  ) => request<Submission>("/submissions", json(body)),
  saveCodeVersion: (
    body: {
      contest_id: number | null;
      match_id: number | null;
      task_id: number;
      session_id: string;
      code_content: string;
      change_type: "INITIAL" | "AUTOSAVE" | "MANUAL_SAVE";
      client_request_id: string;
    },
    options?: { keepalive?: boolean },
  ) =>
    request<CodeVersionSummary>("/code-history/versions", {
      method: "POST",
      body: JSON.stringify(body),
      keepalive: options?.keepalive,
    }),
  codeHistory: (
    taskId: number,
    query: {
      contestId?: number | null;
      matchId?: number | null;
      userId?: number;
      limit?: number;
      offset?: number;
      includeLatestCode?: boolean;
    } = {},
  ) => {
    const params = new URLSearchParams();
    if (query.contestId != null) params.set("contest_id", String(query.contestId));
    if (query.matchId != null) params.set("match_id", String(query.matchId));
    if (query.userId != null) params.set("user_id", String(query.userId));
    if (query.limit != null) params.set("limit", String(query.limit));
    if (query.offset != null) params.set("offset", String(query.offset));
    if (query.includeLatestCode) params.set("include_latest_code", "true");
    return request<CodeHistoryPage>(`/code-history/tasks/${taskId}?${params}`);
  },
  codeVersion: (id: number) => request<CodeVersion>(`/code-history/versions/${id}`),
  codeDiff: (versionId: number, otherVersionId: number) =>
    request<CodeDiff>(`/code-history/versions/${versionId}/diff/${otherVersionId}`),
  submissionCodeVersion: (submissionId: number) =>
    request<CodeVersion>(`/code-history/submissions/${submissionId}`),
  submission: (id: number) => request<Submission>(`/submissions/${id}`),
  submissions: (contestId: number) =>
    request<Submission[]>(
      `/submissions?contest_id=${encodeURIComponent(contestId)}`,
    ),
  createMatch: (body: {
    mode: "duel" | "team";
    difficulty: TaskDifficulty;
    task_count: number;
    duration_minutes: number;
  }) => request<Match>("/matches", json(body)),
  match: (id: number) => request<Match>(`/matches/${id}`),
  matchByPublicId: (id: string) =>
    request<Match>(`/matches/public/${encodeURIComponent(id)}`),
  duelHistory: (mode: "duel" | "team" = "duel") => request<Match[]>(`/matches/history?mode=${mode}`),
  declineInvitation: (id: string, token: string) =>
    request<{ status: string }>(
      `/invitations/${encodeURIComponent(id)}/decline`,
      json({ invite_code: token }),
    ),
  invitation: (id: string, token: string) =>
    request<{
      mode: "duel" | "team";
      status: string;
      duration_minutes: number;
      creator_name: string;
      task_count: number;
      already_joined: boolean;
    }>(
      `/invitations/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`,
    ),
  joinMatch: (invite_code: string) =>
    request<Match>("/matches/join", json({ invite_code })),
  matchState: (id: number) => request<Match>(`/matches/${id}/state`),
  forfeitDuel: (id: number) =>
    request<Match>(`/matches/${id}/forfeit`, json({})),
  setFinishReady: (id: number, ready: boolean) =>
    request<Match>(`/matches/${id}/finish-ready`, json({ ready })),
  saveTeamDraft: (id: number, task_id: number, source_code: string) =>
    request<Match>(`/matches/${id}/draft`, {
      method: "PUT",
      body: JSON.stringify({ task_id, source_code }),
    }),
  matchSocket: (id: number, token: string) => {
    const base = API_BASE || window.location.origin;
    const url = new URL(`/api/ws/matches/${id}`, base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", token);
    return new WebSocket(url);
  },
  integritySubmissions: (contestId: number) =>
    request<Submission[]>(`/contests/${contestId}/integrity/submissions`),
  integrityReports: (contestId: number) =>
    request<IntegrityReport[]>(`/contests/${contestId}/integrity/reports`),
  integrityAnalyze: (contestId: number) =>
    request<IntegrityReport>(
      `/contests/${contestId}/integrity/analyze`,
      json({}),
    ),
  integrityConclusion: (
    contestId: number,
    body: { subject_user_id: number; comment: string },
  ) =>
    request<IntegrityConclusion>(
      `/contests/${contestId}/integrity/conclusions`,
      json(body),
    ),
  startBrowserActivity: (contestId: number) =>
    request<BrowserActivitySession>(
      `/contests/${contestId}/browser-activity/session`,
      { method: "POST" },
    ),
  sendBrowserActivity: (
    contestId: number,
    sessionId: string,
    events: unknown[],
    options?: { keepalive?: boolean },
  ) =>
    request<{ accepted: number; duplicates: number }>(
      `/contests/${contestId}/browser-activity/events`,
      {
        method: "POST",
        body: JSON.stringify({ session_id: sessionId, events }),
        keepalive: options?.keepalive,
      },
    ),
  browserActivitySummary: (contestId: number) =>
    request<BrowserActivitySummary>(
      `/contests/${contestId}/browser-activity/summary`,
    ),
  browserActivityParticipants: (
    contestId: number,
    query: { q?: string; sort?: string; order?: "asc" | "desc" } = {},
  ) => {
    const params = new URLSearchParams();
    if (query.q) params.set("q", query.q);
    if (query.sort) params.set("sort", query.sort);
    if (query.order) params.set("order", query.order);
    const suffix = params.toString() ? `?${params}` : "";
    return request<{
      contest_id: number;
      disclaimer: string;
      rows: BrowserActivityRow[];
    }>(`/contests/${contestId}/browser-activity/participants${suffix}`);
  },
  browserActivityParticipant: (contestId: number, userId: number) =>
    request<BrowserActivityDetail>(
      `/contests/${contestId}/browser-activity/participants/${userId}`,
    ),
  deleteBrowserActivity: (contestId: number) =>
    request<{
      deleted_events: number;
      deleted_sessions: number;
      retention_days: number;
    }>(`/contests/${contestId}/browser-activity`, { method: "DELETE" }),
};
