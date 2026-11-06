export const DEBOUNCE_MS = 4000;
export const KEEPALIVE_LIMIT = 60_000;

export type ClientChangeType = "INITIAL" | "AUTOSAVE" | "MANUAL_SAVE";

export interface PendingSave {
  requestId: string;
  sessionId: string;
  code: string;
  changeType: ClientChangeType;
  contentHash: string;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface HistoryScope {
  userId: number;
  contestId: number | null;
  matchId: number | null;
  taskId: number;
}

export function historyScope(scope: HistoryScope) {
  return `u${scope.userId}:c${scope.contestId ?? "-"}:m${scope.matchId ?? "-"}:t${scope.taskId}`;
}

function pendingKey(scope: string) {
  return `contour-code-history:${scope}`;
}

function sessionKey(scope: string) {
  return `contour-code-history-session:${scope}`;
}

export function readPending(store: KeyValueStore, scope: string): PendingSave | null {
  const raw = store.getItem(pendingKey(scope));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingSave;
    if (!parsed.requestId || !parsed.sessionId || typeof parsed.code !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writePending(store: KeyValueStore, scope: string, pending: PendingSave) {
  try {
    store.setItem(pendingKey(scope), JSON.stringify(pending));
  } catch {
    /* The browser can refuse the write. The in-memory queue still tries the network. */
  }
}

export function removePending(store: KeyValueStore, scope: string) {
  try {
    store.removeItem(pendingKey(scope));
  } catch {
    /* Ignore storage failures. */
  }
}

export function loadSessionId(store: KeyValueStore, scope: string, pending: PendingSave | null, createId: () => string) {
  if (pending?.sessionId) {
    try {
      store.setItem(sessionKey(scope), pending.sessionId);
    } catch {
      /* The id is still returned to the caller. */
    }
    return pending.sessionId;
  }
  const existing = store.getItem(sessionKey(scope));
  if (existing) return existing;
  const created = createId();
  try {
    store.setItem(sessionKey(scope), created);
  } catch {
    /* A refresh may start a new session id. Versions stay ordered on the server. */
  }
  return created;
}

export function initialRequestId(store: KeyValueStore, scope: string, hash: string, createId: () => string) {
  const key = `contour-code-history-initial:${scope}:${hash}`;
  const existing = store.getItem(key);
  if (existing) return existing;
  const created = createId();
  try {
    store.setItem(key, created);
  } catch {
    return created;
  }
  return created;
}

export function decideRestore(input: {
  editorCode: string;
  fromMemory: boolean;
  allowPending: boolean;
  pendingCode: string | null;
  serverCode: string | null;
  editorDirty: boolean;
}) {
  if (input.allowPending && input.pendingCode !== null) {
    return {
      code: input.pendingCode,
      restored: input.pendingCode !== input.editorCode,
    };
  }
  if (
    !input.editorDirty &&
    !input.fromMemory &&
    input.serverCode !== null &&
    input.serverCode !== input.editorCode
  ) {
    return { code: input.serverCode, restored: true };
  }
  return { code: input.editorCode, restored: false };
}

export function decidePersist(input: {
  code: string;
  hash: string;
  lastHash: string | null;
  pending: PendingSave | null;
  changeType: ClientChangeType;
  sessionId: string;
  newRequestId: string;
}): { action: "skip"; pending: PendingSave | null } | { action: "send"; pending: PendingSave } {
  if (input.lastHash === input.hash) {
    return {
      action: "skip",
      pending: input.pending?.contentHash === input.hash ? null : input.pending,
    };
  }
  if (input.pending && input.pending.contentHash === input.hash) {
    return { action: "send", pending: input.pending };
  }
  return {
    action: "send",
    pending: {
      requestId: input.newRequestId,
      sessionId: input.sessionId,
      code: input.code,
      changeType: input.changeType,
      contentHash: input.hash,
    },
  };
}

export function pendingAfterSuccess(current: PendingSave | null, sent: PendingSave) {
  if (current && current.requestId === sent.requestId) return null;
  return current;
}

export function useKeepalive(requested: boolean, codeLength: number) {
  return requested && codeLength < KEEPALIVE_LIMIT;
}

export class SaveSequencer {
  private tail: Promise<void> = Promise.resolve();

  enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.tail.then(job, job);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

export async function contentHash(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
