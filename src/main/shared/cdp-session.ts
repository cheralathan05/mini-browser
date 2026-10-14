import type { Debugger, WebContents } from "electron";

export type CdpEventHandler = (
  method: string,
  params: Record<string, unknown>,
  sessionId?: string,
) => void;

export interface CdpEventSubscriptionOptions {
  replayRecentMs?: number;
}

type DebuggerLifecycleEvent = {
  preventDefault: () => void;
  readonly defaultPrevented: boolean;
};

export class CdpSession {
  private readonly debuggerHandle: Debugger;
  private readonly listeners = new Set<CdpEventHandler>();
  private readonly recentMessages: Array<{
    receivedAt: number;
    method: string;
    params: Record<string, unknown>;
    sessionId?: string;
  }> = [];

  private static readonly MAX_RECENT_MESSAGES = 512;
  private static readonly MAX_RECENT_MESSAGE_AGE_MS = 15_000;

  constructor(private readonly targetContents: WebContents) {
    this.debuggerHandle = targetContents.debugger;
    this.debuggerHandle.on("message", this.handleMessage);
    this.debuggerHandle.on("detach", this.handleDetach);
  }

  get contentsId() {
    return this.targetContents.id;
  }

  get isAttached() {
    return this.debuggerHandle.isAttached();
  }

  async attach(version = "1.3") {
    if (this.debuggerHandle.isAttached()) {
      return;
    }

    this.debuggerHandle.attach(version);
  }

  async detach() {
    if (!this.debuggerHandle.isAttached()) {
      return;
    }

    this.debuggerHandle.detach();
  }

  async send<TResult = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ) {
    await this.attach();
    return this.debuggerHandle.sendCommand(method, params) as Promise<TResult>;
  }

  onMessage(listener: CdpEventHandler, options?: CdpEventSubscriptionOptions) {
    this.listeners.add(listener);
    const replayRecentMs = Math.max(0, Math.floor(options?.replayRecentMs ?? 0));
    if (replayRecentMs > 0) {
      const cutoff = Date.now() - replayRecentMs;
      this.pruneRecentMessages();
      for (const message of this.recentMessages) {
        if (message.receivedAt >= cutoff) {
          listener(message.method, message.params, message.sessionId);
        }
      }
    }

    return () => {
      this.listeners.delete(listener);
    };
  }

  async waitForEvent<TParams extends Record<string, unknown>>(
    method: string,
    timeoutMs = 5_000,
  ) {
    return new Promise<TParams>((resolve, reject) => {
      const timeout = setTimeout(() => {
        dispose();
        reject(new Error(`Timed out waiting for CDP event ${method}.`));
      }, timeoutMs);

      const dispose = this.onMessage((incomingMethod, params) => {
        if (incomingMethod !== method) {
          return;
        }

        clearTimeout(timeout);
        dispose();
        resolve(params as TParams);
      });
    });
  }

  dispose() {
    this.listeners.clear();
    this.debuggerHandle.removeListener("message", this.handleMessage);
    this.debuggerHandle.removeListener("detach", this.handleDetach);

    if (this.debuggerHandle.isAttached()) {
      this.debuggerHandle.detach();
    }
  }

  private readonly handleMessage = (
    _event: DebuggerLifecycleEvent,
    method: string,
    params: Record<string, unknown>,
    sessionId: string,
  ) => {
    this.recentMessages.push({
      receivedAt: Date.now(),
      method,
      params,
      sessionId,
    });
    this.pruneRecentMessages();
    for (const listener of this.listeners) {
      listener(method, params, sessionId);
    }
  };

  private readonly handleDetach = (
    _event: DebuggerLifecycleEvent,
    _reason: string,
  ) => {
    this.listeners.clear();
    this.recentMessages.length = 0;
  };

  private pruneRecentMessages(now = Date.now()) {
    while (
      this.recentMessages.length > 0
      && now - this.recentMessages[0].receivedAt > CdpSession.MAX_RECENT_MESSAGE_AGE_MS
    ) {
      this.recentMessages.shift();
    }
    if (this.recentMessages.length > CdpSession.MAX_RECENT_MESSAGES) {
      this.recentMessages.splice(0, this.recentMessages.length - CdpSession.MAX_RECENT_MESSAGES);
    }
  }
}
