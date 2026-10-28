// NEXUS BROWSER - Realtime WebSocket Client
import { getWsUrl } from "./nexus-config";

type WebSocketListener = (data: any) => void;

class NexusWebSocketClient {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<WebSocketListener>> = new Map();
  private reconnectTimeout: any = null;
  private url: string;
  private isConnected = false;

  constructor() {
    this.url = getWsUrl();
  }

  public connect(userId?: string, workspaceId?: string) {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      const connectUrl = new URL(this.url);
      if (userId) connectUrl.searchParams.set("userId", userId);
      if (workspaceId) connectUrl.searchParams.set("workspaceId", workspaceId);

      this.ws = new WebSocket(connectUrl.toString());

      this.ws.onopen = () => {
        this.isConnected = true;
        this.emit("connection.state", { connected: true });
        console.log("[NEXUS WS] Connected to backend realtime socket.");
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.event) {
            this.emit(message.event, message.payload);
            this.emit("*", message);

            if (message.event === "browser.command" && message.payload?.id) {
              this.handleBrowserCommand(message.payload);
            }
          }
        } catch {
          // Ignore non-json frames
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.emit("connection.state", { connected: false });
        this.scheduleReconnect(userId, workspaceId);
      };

      this.ws.onerror = () => {
        this.isConnected = false;
      };
    } catch (e) {
      console.warn("[NEXUS WS] Connection attempt failed:", e);
      this.scheduleReconnect(userId, workspaceId);
    }
  }

  private scheduleReconnect(userId?: string, workspaceId?: string) {
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = setTimeout(() => {
      this.connect(userId, workspaceId);
    }, 4000);
  }

  public subscribe(event: string, listener: WebSocketListener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);

    return () => {
      this.listeners.get(event)?.delete(listener);
    };
  }

  private emit(event: string, data: any) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach((fn) => fn(data));
    }
  }

  public send(data: any): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(typeof data === "string" ? data : JSON.stringify(data));
      return true;
    }
    return false;
  }

  private async handleBrowserCommand(payload: { id: string; action: string; params: Record<string, any> }) {
    const { id, action, params } = payload;
    const shell = (window as any).browserShell;

    if (shell?.executeBrowserAction) {
      try {
        const activeTabId = localStorage.getItem("nexus_active_tab_id") || "";
        const res = await shell.executeBrowserAction(1, activeTabId, action, params);
        this.send({
          type: "browser.command.result",
          payload: {
            id,
            success: res?.success !== false,
            result: res?.result || res,
            error: res?.error,
          },
        });
        return;
      } catch (err: any) {
        this.send({
          type: "browser.command.result",
          payload: {
            id,
            success: false,
            error: err.message || String(err),
          },
        });
        return;
      }
    }

    // Fallback for web / iframe environment
    this.send({
      type: "browser.command.result",
      payload: {
        id,
        success: true,
        result: {
          action,
          url: params.url || window.location.href,
          title: document.title,
          handledVia: "renderer-web",
        },
      },
    });
  }

  public getStatus(): boolean {
    return this.isConnected;
  }

  public onStateChange(listener: (connected: boolean) => void): () => void {
    listener(this.isConnected);
    return this.subscribe("connection.state", (data: { connected: boolean }) => {
      listener(Boolean(data?.connected));
    });
  }
}

export const nexusWs = new NexusWebSocketClient();
