import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";
import type { AddressInfo } from "node:net";
import {
  AutomationToolError,
  isMcpToolResultEnvelope,
  type McpServerExport,
  type McpToolResultEnvelope,
} from "./automation-mcp.js";

interface CreateAutomationMcpHttpServerOptions {
  mcpService: {
    exportMcp: () => McpServerExport;
    callTool: (name: string, input: Record<string, unknown>) => Promise<unknown> | unknown;
  };
  host?: string;
  port?: number;
}

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

const JSON_RPC_VERSION = "2.0";
const MCP_PROTOCOL_VERSION = "2025-03-26";
const MAX_REQUEST_BODY_BYTES = 1_000_000;
const DEFAULT_HOST = "127.0.0.1";
const ALLOWED_MCP_HTTP_METHODS = "GET, POST, OPTIONS";
const DEFAULT_CORS_ALLOWED_HEADERS = [
  "accept",
  "authorization",
  "content-type",
  "mcp-session-id",
  "x-mcp-session-id",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringifyJson(value: unknown) {
  return JSON.stringify(value);
}

function getCorsHeaders(request: IncomingMessage) {
  const headers: Record<string, string> = {
    "access-control-allow-origin": "*",
  };

  if (request.headers["access-control-request-private-network"] === "true") {
    headers["access-control-allow-private-network"] = "true";
  }

  return headers;
}

function getPreflightCorsHeaders(request: IncomingMessage) {
  const requestedHeaders = request.headers["access-control-request-headers"];
  const allowHeaders = new Set(DEFAULT_CORS_ALLOWED_HEADERS);

  if (typeof requestedHeaders === "string") {
    for (const headerName of requestedHeaders.split(",")) {
      const normalized = headerName.trim().toLowerCase();
      if (normalized) {
        allowHeaders.add(normalized);
      }
    }
  }

  const varyHeaders: string[] = [];
  if (typeof requestedHeaders === "string" && requestedHeaders.trim()) {
    varyHeaders.push("Access-Control-Request-Headers");
  }
  if (request.headers["access-control-request-private-network"] === "true") {
    varyHeaders.push("Access-Control-Request-Private-Network");
  }

  return {
    ...getCorsHeaders(request),
    "access-control-allow-methods": ALLOWED_MCP_HTTP_METHODS,
    "access-control-allow-headers": Array.from(allowHeaders).join(", "),
    "access-control-max-age": "86400",
    ...(varyHeaders.length > 0 ? { vary: varyHeaders.join(", ") } : {}),
  };
}

function sendJson(
  request: IncomingMessage,
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
  extraHeaders: Record<string, string> = {},
) {
  response.writeHead(statusCode, {
    ...getCorsHeaders(request),
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  response.end(stringifyJson(payload));
}

function sendJsonRpcResult(id: unknown, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    result,
  };
}

function sendJsonRpcError(
  id: unknown,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    error: {
      code,
      message,
      ...(data !== undefined ? { data } : {}),
    },
  };
}

function wrapToolResult(result: unknown): McpToolResultEnvelope {
  if (isMcpToolResultEnvelope(result)) {
    return result;
  }

  return {
    content: [
      {
        type: "text",
        text: stringifyJson(result),
      },
    ],
    structuredContent: result,
  };
}

function wrapToolError(toolName: string, error: unknown): McpToolResultEnvelope {
  const details = error instanceof AutomationToolError
    ? error.toJSON()
    : {
        errorCode: "MCP_TOOL_CALL_FAILED",
        category: "execution" as const,
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      };
  const structuredContent = {
    ok: false,
    toolName,
    error: details,
  };

  return {
    content: [
      {
        type: "text",
        text: stringifyJson(structuredContent),
      },
    ],
    structuredContent,
    isError: true,
  };
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalLength = 0;

    request.on("data", (chunk: string | Buffer) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalLength += buffer.length;
      if (totalLength > MAX_REQUEST_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        request.destroy();
        return;
      }
      chunks.push(buffer);
    });

    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });

    request.on("error", reject);
  });
}

export function createAutomationMcpHttpServer(options: CreateAutomationMcpHttpServerOptions) {
  const host = options.host?.trim() || DEFAULT_HOST;
  const preferredPort = Number.isFinite(options.port) ? Math.max(0, Math.floor(Number(options.port))) : 0;
  let enabled = false;
  let server: Server | null = null;
  let endpoint: string | null = null;
  let token = randomUUID();
  let startPromise: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;

  function isAuthorized(requestUrl: URL, request: IncomingMessage) {
    const authHeader = request.headers.authorization?.trim();
    if (authHeader === `Bearer ${token}`) {
      return true;
    }

    return requestUrl.searchParams.get("token") === token;
  }

  async function listen(serverInstance: Server, port: number) {
    await new Promise<void>((resolve, reject) => {
      const handleError = (error: Error) => {
        serverInstance.removeListener("listening", handleListening);
        reject(error);
      };
      const handleListening = () => {
        serverInstance.removeListener("error", handleError);
        resolve();
      };

      serverInstance.once("error", handleError);
      serverInstance.once("listening", handleListening);
      serverInstance.listen(port, host);
    });
  }

  async function handleJsonRpcRequest(body: JsonRpcRequest) {
    const id = body.id ?? null;

    if (body.jsonrpc !== JSON_RPC_VERSION || typeof body.method !== "string" || !body.method.trim()) {
      return sendJsonRpcError(id, -32600, "Invalid JSON-RPC request.");
    }

    const method = body.method.trim();
    if (method === "notifications/initialized") {
      return null;
    }

    if (method === "initialize") {
      const exported = options.mcpService.exportMcp();
      return sendJsonRpcResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        serverInfo: exported.server,
      });
    }

    if (method === "ping") {
      return sendJsonRpcResult(id, {});
    }

    if (method === "tools/list") {
      const exported = options.mcpService.exportMcp();
      return sendJsonRpcResult(id, {
        tools: exported.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
    }

    if (method === "tools/call") {
      if (!isRecord(body.params)) {
        return sendJsonRpcError(id, -32602, "tools/call requires params to be an object.");
      }

      const toolName = typeof body.params.name === "string" ? body.params.name.trim() : "";
      const toolArguments = isRecord(body.params.arguments) ? body.params.arguments : {};
      if (!toolName) {
        return sendJsonRpcError(id, -32602, "tools/call requires a non-empty tool name.");
      }

      try {
        const result = await options.mcpService.callTool(toolName, toolArguments);
        return sendJsonRpcResult(id, wrapToolResult(result));
      } catch (error) {
        return sendJsonRpcResult(id, wrapToolError(toolName, error));
      }
    }

    return sendJsonRpcError(id, -32601, `Unsupported MCP method: ${method}`);
  }

  async function handleRequest(request: IncomingMessage, response: ServerResponse) {
    const requestUrl = new URL(request.url ?? "/", `http://${host}`);
    if (requestUrl.pathname !== "/mcp") {
      sendJson(request, response, 404, { ok: false, error: "Not found." });
      return;
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        ...getPreflightCorsHeaders(request),
        allow: ALLOWED_MCP_HTTP_METHODS,
        "cache-control": "no-store",
      });
      response.end();
      return;
    }

    if (!isAuthorized(requestUrl, request)) {
      sendJson(request, response, 401, { ok: false, error: "Unauthorized." });
      return;
    }

    if (request.method === "GET") {
      const exported = options.mcpService.exportMcp();
      sendJson(request, response, 200, {
        ok: true,
        protocolVersion: MCP_PROTOCOL_VERSION,
        server: exported.server,
        toolCount: exported.tools.length,
      });
      return;
    }

    if (request.method !== "POST") {
      response.writeHead(405, {
        ...getCorsHeaders(request),
        allow: ALLOWED_MCP_HTTP_METHODS,
        "cache-control": "no-store",
      });
      response.end();
      return;
    }

    let rawBody = "";
    try {
      rawBody = await readRequestBody(request);
    } catch (error) {
      sendJson(request, response, 413, {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to read request body.",
      });
      return;
    }

    let parsedBody: JsonRpcRequest;
    try {
      parsedBody = JSON.parse(rawBody) as JsonRpcRequest;
    } catch (error) {
      sendJson(request, response, 400, sendJsonRpcError(null, -32700, "Invalid JSON body.", {
        error: error instanceof Error ? error.message : String(error),
      }));
      return;
    }

    const jsonRpcResponse = await handleJsonRpcRequest(parsedBody);
    if (jsonRpcResponse === null) {
      response.writeHead(204, {
        ...getCorsHeaders(request),
        "cache-control": "no-store",
      });
      response.end();
      return;
    }

    sendJson(request, response, 200, jsonRpcResponse);
  }

  async function start() {
    if (!enabled) {
      endpoint = null;
      return;
    }
    if (server) {
      return;
    }
    if (startPromise) {
      return startPromise;
    }

    token = randomUUID();
    startPromise = (async () => {
      const nextServer = createServer((request, response) => {
        void handleRequest(request, response).catch((error) => {
          console.error("[MCP HTTP] Unhandled request error.", error);
          if (!response.headersSent) {
            sendJson(request, response, 500, { ok: false, error: "Internal server error." });
            return;
          }
          response.destroy();
        });
      });

      try {
        await listen(nextServer, preferredPort);
      } catch (error) {
        nextServer.close();
        throw error;
      }

      nextServer.on("error", (error) => {
        console.error("[MCP HTTP] Server error.", error);
      });

      const address = nextServer.address();
      if (!address || typeof address === "string") {
        nextServer.close();
        throw new Error("MCP HTTP server did not expose a TCP address.");
      }

      const { port } = address as AddressInfo;
      endpoint = `http://${host}:${port}/mcp?token=${encodeURIComponent(token)}`;
      server = nextServer;
    })().catch((error) => {
      endpoint = null;
      throw error;
    }).finally(() => {
      startPromise = null;
    });

    return startPromise;
  }

  async function stop() {
    enabled = false;
    endpoint = null;
    if (startPromise) {
      await startPromise.catch(() => undefined);
    }
    if (!server) {
      return;
    }
    if (stopPromise) {
      return stopPromise;
    }

    const activeServer = server;
    server = null;
    stopPromise = new Promise<void>((resolve) => {
      activeServer.close(() => resolve());
    }).finally(() => {
      stopPromise = null;
    });
    return stopPromise;
  }

  function syncEnabled(nextEnabled: boolean) {
    enabled = nextEnabled;
    if (enabled) {
      void start().catch((error) => {
        console.error("[MCP HTTP] Failed to start server.", error);
      });
      return;
    }

    void stop().catch((error) => {
      console.error("[MCP HTTP] Failed to stop server.", error);
    });
  }

  async function getAddress() {
    if (!enabled) {
      return null;
    }
    await start().catch((error) => {
      console.error("[MCP HTTP] Failed to resolve server address.", error);
      return undefined;
    });
    return endpoint;
  }

  async function shutdown() {
    await stop().catch((error) => {
      console.error("[MCP HTTP] Failed to shut down server.", error);
    });
  }

  return {
    getAddress,
    shutdown,
    syncEnabled,
  };
}
