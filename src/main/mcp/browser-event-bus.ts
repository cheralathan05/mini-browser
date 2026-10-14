import { EventEmitter } from "node:events";

export interface BrowserAutomationEvent {
  kind: string;
  ts: number;
  windowId?: string;
  tabId?: string;
  openerTabId?: string;
  url?: string;
  title?: string;
  source?: string;
  summary?: string;
  dialogType?: "alert" | "confirm" | "prompt" | "beforeunload";
  message?: string;
  defaultPrompt?: string;
  accepted?: boolean;
  promptText?: string;
  downloadId?: string;
  filename?: string;
  state?: string;
  bytes?: number;
  totalBytes?: number;
  sourcePageUrl?: string;
  sourceTabId?: string;
  error?: string;
}

export type BrowserAutomationEventListener = (event: BrowserAutomationEvent) => void;
export interface BrowserAutomationEventSubscribeOptions {
  replayRecentMs?: number;
}

const MAX_BROWSER_EVENT_HISTORY = 256;
const MAX_BROWSER_EVENT_AGE_MS = 15_000;

export function createBrowserEventBus() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  const history: BrowserAutomationEvent[] = [];

  function pruneHistory(now = Date.now()) {
    while (history.length > 0 && now - history[0].ts > MAX_BROWSER_EVENT_AGE_MS) {
      history.shift();
    }
    if (history.length > MAX_BROWSER_EVENT_HISTORY) {
      history.splice(0, history.length - MAX_BROWSER_EVENT_HISTORY);
    }
  }

  return {
    emit(event: BrowserAutomationEvent) {
      history.push(event);
      pruneHistory(event.ts);
      emitter.emit("event", event);
    },
    subscribe(listener: BrowserAutomationEventListener, options?: BrowserAutomationEventSubscribeOptions) {
      emitter.on("event", listener);
      const replayRecentMs = Math.max(0, Math.floor(options?.replayRecentMs ?? 0));
      if (replayRecentMs > 0) {
        const cutoff = Date.now() - replayRecentMs;
        pruneHistory();
        for (const event of history) {
          if (event.ts >= cutoff) {
            listener(event);
          }
        }
      }
      return () => {
        emitter.off("event", listener);
      };
    },
  };
}
