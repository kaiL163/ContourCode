export const BROWSER_ACTIVITY_TYPES = [
  "TAB_HIDDEN",
  "TAB_VISIBLE",
  "WINDOW_BLUR",
  "WINDOW_FOCUS",
  "FULLSCREEN_EXIT",
  "FULLSCREEN_ENTER",
  "PAGE_EXIT",
  "CONTEXT_MENU",
  "COPY",
  "PASTE",
] as const;

export type BrowserActivityEventType = (typeof BROWSER_ACTIVITY_TYPES)[number];

export type BrowserActivityEvent = {
  event_id: string;
  event_type: BrowserActivityEventType;
  client_timestamp: string;
  metadata: {
    visibility_state?: "hidden" | "visible";
    fullscreen?: boolean;
    source?: string;
  };
};

export type BrowserActivitySender = (
  events: BrowserActivityEvent[],
  options?: { keepalive?: boolean },
) => Promise<void>;

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID)
    return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const n = (Math.random() * 16) | 0;
    return (ch === "x" ? n : (n & 0x3) | 0x8).toString(16);
  });
}

export class BrowserActivityTracker {
  private queue: BrowserActivityEvent[] = [];
  private lastType: BrowserActivityEventType | null = null;
  private lastAt = 0;
  private timer: number | undefined;
  private sending = false;
  private stopped = false;
  private readonly listeners: Array<{
    target: EventTarget;
    type: string;
    handler: EventListener;
    capture: boolean;
  }> = [];

  constructor(
    readonly contestId: number,
    readonly userId: number,
    readonly sessionId: string,
    private readonly send: BrowserActivitySender,
  ) {}

  start() {
    this.on(document, "visibilitychange", () => {
      this.record(
        document.visibilityState === "hidden" ? "TAB_HIDDEN" : "TAB_VISIBLE",
        {
          visibility_state:
            document.visibilityState === "hidden" ? "hidden" : "visible",
          source: "visibilitychange",
        },
      );
    });
    this.on(window, "blur", () => {
      this.record("WINDOW_BLUR", { source: "blur" });
    });
    this.on(window, "focus", () => {
      this.record("WINDOW_FOCUS", { source: "focus" });
    });
    this.on(document, "fullscreenchange", () => {
      this.record(
        document.fullscreenElement ? "FULLSCREEN_ENTER" : "FULLSCREEN_EXIT",
        {
          fullscreen: Boolean(document.fullscreenElement),
          source: "fullscreenchange",
        },
      );
    });
    this.on(document, "contextmenu", () => {
      this.record("CONTEXT_MENU", { source: "contextmenu" });
    });
    this.on(
      document,
      "copy",
      () => {
        this.record("COPY", { source: "copy" });
      },
      true,
    );
    this.on(
      document,
      "paste",
      () => {
        this.record("PASTE", { source: "paste" });
      },
      true,
    );
    this.on(window, "pagehide", () => {
      this.record("PAGE_EXIT", { source: "pagehide" });
      void this.flush({ keepalive: true });
    });
  }

  stop() {
    this.stopped = true;
    window.clearTimeout(this.timer);
    for (const item of this.listeners)
      item.target.removeEventListener(item.type, item.handler, item.capture);
    this.listeners.length = 0;
    void this.flush({ keepalive: true });
  }

  private on(
    target: EventTarget,
    type: string,
    handler: EventListener,
    capture = false,
  ) {
    target.addEventListener(type, handler, capture);
    this.listeners.push({ target, type, handler, capture });
  }

  private record(
    event_type: BrowserActivityEventType,
    metadata: BrowserActivityEvent["metadata"],
  ) {
    if (this.stopped && event_type !== "PAGE_EXIT") return;
    const now = Date.now();
    if (this.lastType === event_type && now - this.lastAt < 400) return;
    this.lastType = event_type;
    this.lastAt = now;
    this.queue.push({
      event_id: newId(),
      event_type,
      client_timestamp: new Date(now).toISOString(),
      metadata,
    });
    if (this.queue.length >= 8 || event_type === "PAGE_EXIT")
      void this.flush({ keepalive: event_type === "PAGE_EXIT" });
    else this.schedule();
  }

  private schedule() {
    if (this.timer !== undefined) return;
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, 4000);
  }

  async flush(options?: { keepalive?: boolean }) {
    window.clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.queue.length) return;
    if (this.sending) {
      if (!this.stopped) this.schedule();
      return;
    }
    const batch = this.queue.splice(0, 50);
    this.sending = true;
    try {
      await this.send(batch, { keepalive: options?.keepalive });
    } catch {
      this.queue.unshift(...batch);
      if (!this.stopped) this.schedule();
    } finally {
      this.sending = false;
      if (this.queue.length && !this.stopped) this.schedule();
    }
  }
}
