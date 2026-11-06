import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import {
  DEBOUNCE_MS,
  SaveSequencer,
  contentHash,
  decidePersist,
  decideRestore,
  historyScope,
  initialRequestId,
  loadSessionId,
  pendingAfterSuccess,
  readPending,
  removePending,
  useKeepalive,
  writePending,
  type ClientChangeType,
} from "./codeHistory";

export type SaveStatus = "idle" | "saving" | "saved" | "failed";

const sequencers = new Map<string, SaveSequencer>();

function sequencerFor(scope: string) {
  const existing = sequencers.get(scope);
  if (existing) return existing;
  const created = new SaveSequencer();
  sequencers.set(scope, created);
  return created;
}

export function useCodeHistory({
  enabled,
  userId,
  contestId,
  matchId,
  taskId,
  code,
  ready,
  fromMemory,
  allowPending,
  onRestore,
}: {
  enabled: boolean;
  userId: number;
  contestId: number | null;
  matchId: number | null;
  taskId: number | null;
  code: string;
  ready: boolean;
  fromMemory: boolean;
  allowPending: boolean;
  onRestore: (taskId: number, code: string) => void;
}) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [armedTask, setArmedTask] = useState<number | null>(null);
  const armedRef = useRef(false);
  const codeRef = useRef(code);
  const lastHash = useRef<string | null>(null);
  const scopeRef = useRef<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  const contestRef = useRef<number | null>(contestId);
  const matchRef = useRef<number | null>(matchId);
  const taskRef = useRef<number | null>(taskId);
  const fromMemoryRef = useRef(fromMemory);
  const allowPendingRef = useRef(allowPending);
  const onRestoreRef = useRef(onRestore);
  codeRef.current = code;
  fromMemoryRef.current = fromMemory;
  allowPendingRef.current = allowPending;
  onRestoreRef.current = onRestore;

  const persistSnapshot = useCallback(
    async (
      changeType: ClientChangeType,
      snapshot: {
        scope: string;
        sessionId: string;
        contestId: number | null;
        matchId: number | null;
        taskId: number;
        code: string;
      },
      keepalive = false,
      knownHash: string | null = lastHash.current,
    ) => {
      const hash = await contentHash(snapshot.code);
      const pending = readPending(localStorage, snapshot.scope);
      const requestSeed =
        changeType === "INITIAL"
          ? initialRequestId(sessionStorage, snapshot.scope, hash, () => crypto.randomUUID())
          : crypto.randomUUID();
      const decision = decidePersist({
        code: snapshot.code,
        hash,
        lastHash: knownHash,
        pending,
        changeType,
        sessionId: snapshot.sessionId,
        newRequestId: requestSeed,
      });
      if (decision.action === "skip") {
        if (decision.pending) writePending(localStorage, snapshot.scope, decision.pending);
        else removePending(localStorage, snapshot.scope);
        setStatus((current) => (current === "saving" ? current : "saved"));
        return;
      }
      writePending(localStorage, snapshot.scope, decision.pending);
      setStatus("saving");
      try {
        await sequencerFor(snapshot.scope).enqueue(() =>
          api.saveCodeVersion(
            {
              contest_id: snapshot.contestId,
              match_id: snapshot.matchId,
              task_id: snapshot.taskId,
              session_id: snapshot.sessionId,
              code_content: decision.pending.code,
              change_type: decision.pending.changeType,
              client_request_id: decision.pending.requestId,
            },
            { keepalive: useKeepalive(keepalive, decision.pending.code.length) },
          ),
        );
        if (scopeRef.current === snapshot.scope) lastHash.current = hash;
        const currentPending = readPending(localStorage, snapshot.scope);
        const remaining = pendingAfterSuccess(currentPending, decision.pending);
        if (remaining) writePending(localStorage, snapshot.scope, remaining);
        else removePending(localStorage, snapshot.scope);
        setStatus("saved");
      } catch {
        setStatus("failed");
      }
    },
    [],
  );

  const persist = useCallback(
    async (changeType: ClientChangeType, keepalive = false) => {
      if (!scopeRef.current || !sessionRef.current || taskRef.current == null) return;
      await persistSnapshot(
        changeType,
        {
          scope: scopeRef.current,
          sessionId: sessionRef.current,
          contestId: contestRef.current,
          matchId: matchRef.current,
          taskId: taskRef.current,
          code: codeRef.current,
        },
        keepalive,
      );
    },
    [persistSnapshot],
  );

  useEffect(() => {
    if (!enabled || !ready || taskId == null || (contestId == null && matchId == null)) return;
    const scope = historyScope({ userId, contestId, matchId, taskId });
    lastHash.current = null;
    const pending = readPending(localStorage, scope);
    const session = loadSessionId(sessionStorage, scope, pending, () => crypto.randomUUID());
    scopeRef.current = scope;
    sessionRef.current = session;
    contestRef.current = contestId;
    matchRef.current = matchId;
    taskRef.current = taskId;
    setSessionId(session);
    let cancel = false;
    const snapshot = codeRef.current;
    void (async () => {
      const base = decideRestore({
        editorCode: snapshot,
        fromMemory: fromMemoryRef.current,
        allowPending: allowPendingRef.current,
        pendingCode: pending?.code ?? null,
        serverCode: null,
        editorDirty: false,
      });
      let nextCode = base.code;
      if (base.restored && !cancel) onRestoreRef.current(taskId, nextCode);
      if (!pending && !fromMemoryRef.current) {
        try {
          const page = await api.codeHistory(taskId, {
            contestId,
            matchId,
            includeLatestCode: true,
            limit: 1,
          });
          if (cancel) return;
          if (codeRef.current !== snapshot) {
            armedRef.current = true;
            setArmedTask(taskId);
            return;
          }
          if (page.latest_code != null) {
            const restored = decideRestore({
              editorCode: snapshot,
              fromMemory: false,
              allowPending: false,
              pendingCode: null,
              serverCode: page.latest_code,
              editorDirty: false,
            });
            nextCode = restored.code;
            if (restored.restored) onRestoreRef.current(taskId, nextCode);
          }
        } catch {
          if (!cancel) setStatus("failed");
        }
      }
      if (cancel) return;
      codeRef.current = nextCode;
      await persistSnapshot("INITIAL", {
        scope,
        sessionId: session,
        contestId,
        matchId,
        taskId,
        code: nextCode,
      });
      if (!cancel) {
        armedRef.current = true;
        setArmedTask(taskId);
      }
    })();
    return () => {
      cancel = true;
      const wasArmed = armedRef.current;
      const opened = snapshot;
      const code = codeRef.current;
      const savedHash = lastHash.current;
      armedRef.current = false;
      setArmedTask(null);
      if (!wasArmed && code === opened) return;
      void persistSnapshot(
        "AUTOSAVE",
        { scope, sessionId: session, contestId, matchId, taskId, code },
        true,
        savedHash,
      );
    };
  }, [contestId, enabled, matchId, persistSnapshot, ready, taskId, userId]);

  useEffect(() => {
    if (armedTask !== taskId || taskId == null) return;
    const timer = window.setTimeout(() => {
      void persist("AUTOSAVE");
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [armedTask, code, persist, taskId]);

  useEffect(() => {
    if (status !== "failed" || armedTask !== taskId) return;
    const timer = window.setTimeout(() => {
      void persist("AUTOSAVE");
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [armedTask, persist, status, taskId]);

  useEffect(() => {
    if (!enabled) return;
    const flush = () => {
      void persist("AUTOSAVE", true);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("online", flush);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("online", flush);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, persist]);

  const saveNow = useCallback(() => persist("MANUAL_SAVE"), [persist]);
  const flush = useCallback(async () => {
    await persist("AUTOSAVE");
    return sessionRef.current;
  }, [persist]);

  return { status, sessionId, saveNow, flush };
}
