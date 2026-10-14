import { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { NexusWebSocketEventType, NexusWebSocketMessage } from "./events.js";

interface ExtendedWebSocket extends WebSocket {
  isAlive: boolean;
  userId?: string;
  workspaceId?: string;
}

export class NexusWebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients: Set<ExtendedWebSocket> = new Set();

  public init(server: HttpServer) {
    this.wss = new WebSocketServer({ server });

    this.wss.on("connection", (ws: ExtendedWebSocket, req) => {
      ws.isAlive = true;
      this.clients.add(ws);

      // Parse optional query params for userId and workspaceId
      try {
        const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
        ws.userId = url.searchParams.get("userId") || undefined;
        ws.workspaceId = url.searchParams.get("workspaceId") || undefined;
      } catch {
        // Ignore URL parsing errors
      }

      ws.on("pong", () => {
        ws.isAlive = true;
      });

      ws.on("message", async (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === "subscribe") {
            if (parsed.userId) ws.userId = parsed.userId;
            if (parsed.workspaceId) ws.workspaceId = parsed.workspaceId;
          } else if (parsed.type === "browser.command.result" || parsed.event === "browser.command.result") {
            const { BrowserAdapter } = await import("../agents/runtime/browser.adapter.js");
            BrowserAdapter.handleCommandResponse(parsed.payload || parsed);
          }
        } catch {
          // Ignore invalid client messages
        }
      });

      ws.on("close", () => {
        this.clients.delete(ws);
      });

      // Send initial welcome message
      this.sendToClient(ws, "system.heartbeat", { message: "Connected to NEXUS Realtime WebSocket" });
    });

    // Heartbeat ping-pong interval
    const interval = setInterval(() => {
      for (const client of this.clients) {
        if (!client.isAlive) {
          this.clients.delete(client);
          client.terminate();
          continue;
        }
        client.isAlive = false;
        client.ping();
      }
    }, 30000);
    interval.unref();

    this.wss.on("close", () => {
      clearInterval(interval);
    });

    console.log("[WebSocket] NEXUS WebSocket Server initialized.");
  }

  public close() {
    for (const client of this.clients) {
      try {
        client.terminate();
      } catch {}
    }
    this.clients.clear();
    if (this.wss) {
      try {
        this.wss.close();
      } catch {}
      this.wss = null;
    }
  }

  public broadcast<T>(
    event: NexusWebSocketEventType,
    payload: T,
    filters?: { userId?: string; workspaceId?: string }
  ) {
    const message: NexusWebSocketMessage<T> = {
      event,
      payload,
      timestamp: new Date().toISOString(),
      userId: filters?.userId,
      workspaceId: filters?.workspaceId,
    };

    const serialized = JSON.stringify(message);

    for (const client of this.clients) {
      if (client.readyState !== WebSocket.OPEN) {
        continue;
      }

      if (filters?.userId && client.userId && client.userId !== filters.userId) {
        continue;
      }

      if (filters?.workspaceId && client.workspaceId && client.workspaceId !== filters.workspaceId) {
        continue;
      }

      client.send(serialized);
    }
  }

  public getConnectedClientCount(): number {
    let count = 0;
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        count++;
      }
    }
    return count;
  }

  private sendToClient<T>(client: ExtendedWebSocket, event: NexusWebSocketEventType, payload: T) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(
        JSON.stringify({
          event,
          payload,
          timestamp: new Date().toISOString(),
        })
      );
    }
  }
}

export const wsManager = new NexusWebSocketManager();
