import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface NativeMessagingBridgeInfo {
  baseUrl: string;
  token: string;
}

interface NativeMessagingHostManifest {
  name: string;
  path: string;
  allowedOrigins: string[];
}

interface NativeMessagingBridgeEvent {
  id: number;
  type: "message" | "error" | "disconnect";
  message?: unknown;
  error?: string;
}

interface NativeMessagingConnection {
  id: string;
  extensionId: string;
  hostName: string;
  child: ChildProcessWithoutNullStreams;
  stdoutBuffer: Buffer;
  events: NativeMessagingBridgeEvent[];
  nextEventId: number;
  closed: boolean;
}

const EXTENSION_ID_PATTERN = /^[a-p]{32}$/i;
const HOST_NAME_PATTERN = /^[a-z0-9_.-]+$/i;
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_NATIVE_MESSAGE_BYTES = 64 * 1024 * 1024;
const MAX_RETAINED_EVENTS = 200;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readStringProperty(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function getNativeMessagingHostManifestPaths(hostName: string) {
  const manifestFileName = `${hostName}.json`;
  return [
    path.join(homedir(), "Library/Application Support/Google/Chrome/NativeMessagingHosts", manifestFileName),
    path.join("/Library/Google/Chrome/NativeMessagingHosts", manifestFileName),
    path.join(homedir(), "Library/Application Support/Chromium/NativeMessagingHosts", manifestFileName),
    path.join("/Library/Application Support/Chromium/NativeMessagingHosts", manifestFileName),
    path.join(homedir(), "Library/Application Support/Microsoft Edge/NativeMessagingHosts", manifestFileName),
    path.join("/Library/Application Support/Microsoft Edge/NativeMessagingHosts", manifestFileName),
  ];
}

function resolveNativeMessagingHost(
  hostName: string,
  extensionId: string,
): NativeMessagingHostManifest {
  let deniedManifestError = "";
  const extensionOrigin = `chrome-extension://${extensionId}/`;

  for (const manifestPath of getNativeMessagingHostManifestPaths(hostName)) {
    if (!existsSync(manifestPath)) {
      continue;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as unknown;
    if (!isPlainRecord(manifest)) {
      throw new Error(`Native messaging host manifest is invalid: ${manifestPath}`);
    }

    const manifestName = readStringProperty(manifest, "name");
    const hostPath = readStringProperty(manifest, "path");
    const hostType = readStringProperty(manifest, "type");
    const allowedOrigins = Array.isArray(manifest.allowed_origins)
      ? manifest.allowed_origins.filter((entry): entry is string => typeof entry === "string")
      : [];

    if (manifestName && manifestName !== hostName) {
      continue;
    }
    if (hostType && hostType !== "stdio") {
      throw new Error(`Native messaging host ${hostName} is not a stdio host.`);
    }
    if (!hostPath) {
      throw new Error(`Native messaging host ${hostName} is missing a path.`);
    }
    if (!path.isAbsolute(hostPath)) {
      throw new Error(`Native messaging host ${hostName} path must be absolute.`);
    }
    if (!existsSync(hostPath)) {
      throw new Error(`Native messaging host executable was not found: ${hostPath}`);
    }
    if (!allowedOrigins.includes(extensionOrigin)) {
      deniedManifestError = `Native messaging host ${hostName} does not allow ${extensionOrigin}`;
      continue;
    }

    return {
      name: manifestName || hostName,
      path: hostPath,
      allowedOrigins,
    };
  }

  throw new Error(deniedManifestError || `Native messaging host was not found: ${hostName}`);
}

class NativeMessagingBridgeServer {
  private readonly token = randomUUID();
  private readonly connections = new Map<string, NativeMessagingConnection>();
  private server: Server | null = null;
  private startPromise: Promise<NativeMessagingBridgeInfo> | null = null;
  private baseUrl = "";

  ensureStarted(): Promise<NativeMessagingBridgeInfo> {
    if (this.server && this.baseUrl) {
      return Promise.resolve({
        baseUrl: this.baseUrl,
        token: this.token,
      });
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.server = createServer((request, response) => {
      void this.handleRequest(request, response).catch((error) => {
        this.sendJson(response, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });

    this.startPromise = new Promise<NativeMessagingBridgeInfo>((resolve, reject) => {
      const server = this.server;
      if (!server) {
        reject(new Error("Native messaging bridge server was not created."));
        return;
      }

      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        const address = server.address() as AddressInfo | null;
        if (!address || typeof address.port !== "number") {
          reject(new Error("Native messaging bridge did not expose a TCP port."));
          return;
        }
        this.baseUrl = `http://127.0.0.1:${address.port}`;
        resolve({
          baseUrl: this.baseUrl,
          token: this.token,
        });
      };

      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(0, "127.0.0.1");
    });

    return this.startPromise;
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse) {
    this.writeCorsHeaders(request, response);
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    if (!this.isAuthorized(request, requestUrl)) {
      this.sendJson(response, 401, { error: "Unauthorized native messaging bridge request." });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/connect") {
      await this.handleConnect(request, response);
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/post") {
      await this.handlePost(request, response);
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/disconnect") {
      await this.handleDisconnect(request, response);
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/events") {
      this.handleEvents(requestUrl, response);
      return;
    }

    this.sendJson(response, 404, { error: "Native messaging bridge route not found." });
  }

  private async handleConnect(request: IncomingMessage, response: ServerResponse) {
    const body = await this.readJsonBody(request);
    if (!isPlainRecord(body)) {
      this.sendJson(response, 400, { error: "Invalid connect request." });
      return;
    }

    const extensionId = readStringProperty(body, "extensionId").toLowerCase();
    const hostName = readStringProperty(body, "hostName");
    if (!EXTENSION_ID_PATTERN.test(extensionId)) {
      this.sendJson(response, 400, { error: "Invalid extension id." });
      return;
    }
    if (!HOST_NAME_PATTERN.test(hostName)) {
      this.sendJson(response, 400, { error: "Invalid native messaging host name." });
      return;
    }

    const hostManifest = resolveNativeMessagingHost(hostName, extensionId);
    const connection = this.createConnection(extensionId, hostManifest);
    this.connections.set(connection.id, connection);
    this.sendJson(response, 200, { connectionId: connection.id });
  }

  private async handlePost(request: IncomingMessage, response: ServerResponse) {
    const body = await this.readJsonBody(request);
    if (!isPlainRecord(body) || !("message" in body)) {
      this.sendJson(response, 400, { error: "Invalid native message request." });
      return;
    }

    const connection = this.getOpenConnection(readStringProperty(body, "connectionId"));
    if (!connection) {
      this.sendJson(response, 404, { error: "Native messaging connection not found." });
      return;
    }

    try {
      await this.writeNativeMessage(connection, body.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.terminateConnection(connection, message);
      this.sendJson(response, 502, { error: message });
      return;
    }

    this.sendJson(response, 200, { ok: true });
  }

  private async handleDisconnect(request: IncomingMessage, response: ServerResponse) {
    const body = await this.readJsonBody(request);
    if (!isPlainRecord(body)) {
      this.sendJson(response, 400, { error: "Invalid disconnect request." });
      return;
    }

    const connection = this.connections.get(readStringProperty(body, "connectionId"));
    if (connection) {
      this.terminateConnection(connection);
    }
    this.sendJson(response, 200, { ok: true });
  }

  private handleEvents(requestUrl: URL, response: ServerResponse) {
    const connectionId = requestUrl.searchParams.get("connectionId") || "";
    const cursor = Number(requestUrl.searchParams.get("cursor") || 0);
    const connection = this.connections.get(connectionId);
    if (!connection) {
      this.sendJson(response, 404, { error: "Native messaging connection not found." });
      return;
    }

    const safeCursor = Number.isFinite(cursor) ? cursor : 0;
    const events = connection.events.filter((event) => event.id > safeCursor);
    const nextCursor = events.reduce((latest, event) => Math.max(latest, event.id), safeCursor);
    this.sendJson(response, 200, {
      events,
      nextCursor,
      closed: connection.closed,
    });
  }

  private createConnection(
    extensionId: string,
    hostManifest: NativeMessagingHostManifest,
  ): NativeMessagingConnection {
    const extensionOrigin = `chrome-extension://${extensionId}/`;
    const child = spawn(hostManifest.path, [extensionOrigin], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const connection: NativeMessagingConnection = {
      id: randomUUID(),
      extensionId,
      hostName: hostManifest.name,
      child,
      stdoutBuffer: Buffer.alloc(0),
      events: [],
      nextEventId: 1,
      closed: false,
    };

    child.stdout.on("data", (chunk: Buffer) => {
      this.handleNativeStdout(connection, chunk);
    });
    child.stdin.on("error", (error) => {
      this.closeConnection(
        connection,
        `Native messaging host ${connection.hostName} stdin error: ${error.message}`,
      );
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const message = chunk.toString("utf-8").trim();
      if (message) {
        console.warn(`[Extensions] Native messaging host ${hostManifest.name}: ${message}`);
      }
    });
    child.on("error", (error) => {
      this.closeConnection(connection, error.message);
    });
    child.on("exit", (code, signal) => {
      const details = code === 0 || code === null
        ? undefined
        : `Native messaging host exited with code ${code}${signal ? `, signal ${signal}` : ""}.`;
      this.closeConnection(connection, details);
    });

    return connection;
  }

  private handleNativeStdout(connection: NativeMessagingConnection, chunk: Buffer) {
    connection.stdoutBuffer = Buffer.concat([connection.stdoutBuffer, chunk]);

    while (connection.stdoutBuffer.length >= 4) {
      const messageLength = connection.stdoutBuffer.readUInt32LE(0);
      if (messageLength > MAX_NATIVE_MESSAGE_BYTES) {
        this.terminateConnection(connection, "Native messaging host sent an oversized message.");
        return;
      }
      if (connection.stdoutBuffer.length < messageLength + 4) {
        return;
      }

      const messageBuffer = connection.stdoutBuffer.subarray(4, messageLength + 4);
      connection.stdoutBuffer = connection.stdoutBuffer.subarray(messageLength + 4);

      try {
        this.pushEvent(connection, {
          type: "message",
          message: JSON.parse(messageBuffer.toString("utf-8")),
        });
      } catch (error) {
        this.terminateConnection(
          connection,
          `Native messaging host sent invalid JSON: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return;
      }
    }
  }

  private writeNativeMessage(connection: NativeMessagingConnection, message: unknown) {
    if (connection.closed) {
      return Promise.reject(new Error("Native messaging connection is closed."));
    }

    const json = JSON.stringify(message);
    if (typeof json !== "string") {
      return Promise.reject(new Error("Native messaging message is not JSON serializable."));
    }

    const payload = Buffer.from(json, "utf-8");
    if (payload.length > MAX_NATIVE_MESSAGE_BYTES) {
      return Promise.reject(new Error("Native messaging message is too large."));
    }

    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length, 0);
    const framedPayload = Buffer.concat([header, payload]);

    return new Promise<void>((resolve, reject) => {
      const fail = (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        reject(new Error(`Native messaging host ${connection.hostName} write failed: ${message}`));
      };

      if (
        connection.child.stdin.destroyed
        || connection.child.stdin.writableEnded
        || !connection.child.stdin.writable
      ) {
        fail(new Error("Native messaging host stdin is closed."));
        return;
      }

      try {
        connection.child.stdin.write(framedPayload, (error?: Error | null) => {
          if (error) {
            fail(error);
            return;
          }
          resolve();
        });
      } catch (error) {
        fail(error);
      }
    });
  }

  private getOpenConnection(connectionId: string) {
    const connection = this.connections.get(connectionId);
    if (!connection || connection.closed) {
      return null;
    }
    return connection;
  }

  private terminateConnection(connection: NativeMessagingConnection, error?: string) {
    this.closeConnection(connection, error);
    if (!connection.child.killed) {
      connection.child.kill();
    }
  }

  private closeConnection(connection: NativeMessagingConnection, error?: string) {
    if (connection.closed) {
      return;
    }

    connection.closed = true;
    if (error) {
      this.pushEvent(connection, {
        type: "error",
        error,
      });
    }
    this.pushEvent(connection, {
      type: "disconnect",
    });

    const cleanup = setTimeout(() => {
      this.connections.delete(connection.id);
    }, 30_000);
    cleanup.unref();
  }

  private pushEvent(
    connection: NativeMessagingConnection,
    event: Omit<NativeMessagingBridgeEvent, "id">,
  ) {
    connection.events.push({
      id: connection.nextEventId,
      ...event,
    });
    connection.nextEventId += 1;
    if (connection.events.length > MAX_RETAINED_EVENTS) {
      connection.events.splice(0, connection.events.length - MAX_RETAINED_EVENTS);
    }
  }

  private isAuthorized(request: IncomingMessage, requestUrl: URL) {
    const authorization = request.headers.authorization;
    if (typeof authorization === "string" && authorization === `Bearer ${this.token}`) {
      return true;
    }
    return requestUrl.searchParams.get("token") === this.token;
  }

  private writeCorsHeaders(request: IncomingMessage, response: ServerResponse) {
    const origin = request.headers.origin;
    response.setHeader("Access-Control-Allow-Origin", typeof origin === "string" ? origin : "*");
    response.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Private-Network", "true");
    response.setHeader("Access-Control-Max-Age", "86400");
    response.setHeader("Vary", "Origin");
  }

  private sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
    if (response.headersSent || response.writableEnded) {
      return;
    }

    response.statusCode = statusCode;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(payload));
  }

  private readJsonBody(request: IncomingMessage) {
    return new Promise<unknown>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      request.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_REQUEST_BYTES) {
          reject(new Error("Native messaging bridge request body is too large."));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on("error", reject);
      request.on("end", () => {
        try {
          const raw = Buffer.concat(chunks).toString("utf-8").trim();
          resolve(raw ? JSON.parse(raw) : {});
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}

const nativeMessagingBridgeServer = new NativeMessagingBridgeServer();

export function ensureNativeMessagingBridgeStarted() {
  return nativeMessagingBridgeServer.ensureStarted();
}
