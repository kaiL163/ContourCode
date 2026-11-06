import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEBOUNCE_MS,
  SaveSequencer,
  decidePersist,
  decideRestore,
  pendingAfterSuccess,
  readPending,
  useKeepalive,
  writePending,
  type KeyValueStore,
  type PendingSave,
} from "./src/codeHistory.ts";

class MemoryStore implements KeyValueStore {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

const pending: PendingSave = {
  requestId: "req-1",
  sessionId: "session-1",
  code: "int main(){return 1;}",
  changeType: "AUTOSAVE",
  contentHash: "hash-1",
};

test("autosave waits a few seconds instead of saving every keystroke", () => {
  assert.ok(DEBOUNCE_MS >= 3000 && DEBOUNCE_MS <= 5000);
});

test("unchanged code is not sent again", () => {
  const decision = decidePersist({
    code: pending.code,
    hash: "hash-1",
    lastHash: "hash-1",
    pending,
    changeType: "AUTOSAVE",
    sessionId: pending.sessionId,
    newRequestId: "req-2",
  });
  assert.equal(decision.action, "skip");
  assert.equal(decision.pending, null);
});

test("a failed save keeps the same request and restores the editor", () => {
  const store = new MemoryStore();
  const first = decidePersist({
    code: pending.code,
    hash: pending.contentHash,
    lastHash: null,
    pending: null,
    changeType: "AUTOSAVE",
    sessionId: pending.sessionId,
    newRequestId: pending.requestId,
  });
  assert.equal(first.action, "send");
  if (first.action !== "send") return;
  writePending(store, "scope", first.pending);
  const stored = readPending(store, "scope");
  assert.deepEqual(stored, first.pending);
  const retry = decidePersist({
    code: pending.code,
    hash: pending.contentHash,
    lastHash: null,
    pending: stored,
    changeType: "AUTOSAVE",
    sessionId: pending.sessionId,
    newRequestId: "req-new",
  });
  assert.equal(retry.action, "send");
  if (retry.action !== "send") return;
  assert.equal(retry.pending.requestId, "req-1");
  const restored = decideRestore({
    editorCode: "template",
    fromMemory: false,
    allowPending: true,
    pendingCode: stored?.code ?? null,
    serverCode: "older server",
    editorDirty: false,
  });
  assert.equal(restored.code, pending.code);
  assert.equal(restored.restored, true);
  assert.equal(pendingAfterSuccess(stored, retry.pending), null);
  assert.equal(
    pendingAfterSuccess(
      { ...pending, requestId: "req-newer", contentHash: "hash-2", code: "newer" },
      retry.pending,
    )?.requestId,
    "req-newer",
  );
});

test("server code is restored when the editor still has the template", () => {
  const restored = decideRestore({
    editorCode: "template",
    fromMemory: false,
    allowPending: true,
    pendingCode: null,
    serverCode: "saved solution",
    editorDirty: false,
  });
  assert.equal(restored.code, "saved solution");
});

test("local edits stay in the editor while a request is still running", () => {
  const restored = decideRestore({
    editorCode: "typed",
    fromMemory: true,
    allowPending: true,
    pendingCode: null,
    serverCode: "old",
    editorDirty: true,
  });
  assert.equal(restored.code, "typed");
});

test("keepalive is skipped for a large snapshot", () => {
  assert.equal(useKeepalive(true, 100), true);
  assert.equal(useKeepalive(true, 60_000), false);
  assert.equal(useKeepalive(false, 10), false);
});

test("saves for one solution run one after another", async () => {
  const sequencer = new SaveSequencer();
  const order: string[] = [];
  const first = sequencer.enqueue(async () => {
    order.push("start-1");
    await new Promise((resolve) => setTimeout(resolve, 20));
    order.push("end-1");
    return 1;
  });
  const second = sequencer.enqueue(async () => {
    order.push("start-2");
    throw new Error("offline");
  });
  const third = sequencer.enqueue(async () => {
    order.push("start-3");
    return 3;
  });
  assert.equal(await first, 1);
  await assert.rejects(second, /offline/);
  assert.equal(await third, 3);
  assert.deepEqual(order, ["start-1", "end-1", "start-2", "start-3"]);
});
