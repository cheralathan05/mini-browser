import path from "node:path";
import { pathToFileURL } from "node:url";
import { net, protocol, session } from "electron";

export const MILO_SCHEME = "milo";
export const MILO_HOME_HOST = "home";
export const MILO_AGENT_HOST = "agent";
export const MILO_SEARCH_HOST = "search";
export const MILO_TASKS_HOST = "tasks";
export const MILO_SETTINGS_HOST = "settings";
export const MILO_LEARNING_HOST = "learning";
export const MILO_BOOKMARKS_HOST = "bookmarks";
export const MILO_HISTORY_HOST = "history";
export const MILO_DOWNLOADS_HOST = "downloads";
export const MILO_WORKSPACE_HOST = "workspace";
export const MILO_EXTENSIONS_HOST = "extensions";
export const MILO_USER_SCRIPTS_HOST = "user-scripts";
export const MILO_WIDGETS_HOST = "widgets";
export const MILO_WIDGET_RUNTIME_HOST = "widget-runtime";
export const MILO_WIDGET_PACKAGE_HOST = "widget-package";
export const MILO_WIDGET_API_HOST = "widget-api";
export const MILO_RENDER_PREVIEW_HOST = "render-preview";

export const MILO_HOME_URL = `${MILO_SCHEME}://${MILO_HOME_HOST}`;
export const MILO_AGENT_URL = `${MILO_SCHEME}://${MILO_AGENT_HOST}`;
export const MILO_SEARCH_URL = `${MILO_SCHEME}://${MILO_SEARCH_HOST}`;
export const MILO_TASKS_URL = `${MILO_SCHEME}://${MILO_TASKS_HOST}`;
export const MILO_SETTINGS_URL = `${MILO_SCHEME}://${MILO_SETTINGS_HOST}`;
export const MILO_LEARNING_URL = `${MILO_SCHEME}://${MILO_LEARNING_HOST}`;
export const MILO_BOOKMARKS_URL = `${MILO_SCHEME}://${MILO_BOOKMARKS_HOST}`;
export const MILO_HISTORY_URL = `${MILO_SCHEME}://${MILO_HISTORY_HOST}`;
export const MILO_DOWNLOADS_URL = `${MILO_SCHEME}://${MILO_DOWNLOADS_HOST}`;
export const MILO_WORKSPACE_URL = `${MILO_SCHEME}://${MILO_WORKSPACE_HOST}`;
export const MILO_EXTENSIONS_URL = `${MILO_SCHEME}://${MILO_EXTENSIONS_HOST}`;
export const MILO_USER_SCRIPTS_URL = `${MILO_SCHEME}://${MILO_USER_SCRIPTS_HOST}`;
export const MILO_WIDGETS_URL = `${MILO_SCHEME}://${MILO_WIDGETS_HOST}`;
export const MILO_WIDGET_RUNTIME_URL = `${MILO_SCHEME}://${MILO_WIDGET_RUNTIME_HOST}`;
export const MILO_RENDER_PREVIEW_URL = `${MILO_SCHEME}://${MILO_RENDER_PREVIEW_HOST}`;
export const DEFAULT_SESSION_KEY = "__default__";

interface CreateMiloProtocolManagerOptions {
  rendererDistPath: string;
  devServerUrl?: string;
  resolveDynamicTarget?: (requestUrl: URL) => ResolvedMiloTarget | null | undefined;
}

interface RendererAssetUrlOptions {
  preferCssDirect?: boolean;
}

interface ResolvedMiloTarget {
  kind: "page" | "asset";
  allowHtml?: boolean;
  targetUrl: string;
}

export const HOME_PAGE_ENTRY = "home.html";
export const AGENT_PAGE_ENTRY = "agent.html";
export const SEARCH_PAGE_ENTRY = "search.html";
export const TASKS_PAGE_ENTRY = "tasks.html";
export const SETTINGS_PAGE_ENTRY = "settings.html";
export const LEARNING_PAGE_ENTRY = "learning.html";
export const BOOKMARKS_PAGE_ENTRY = "bookmarks.html";
export const HISTORY_PAGE_ENTRY = "history.html";
export const DOWNLOADS_PAGE_ENTRY = "downloads.html";
export const WORKSPACE_PAGE_ENTRY = "workspace.html";
export const EXTENSIONS_PAGE_ENTRY = "extensions.html";
export const USER_SCRIPTS_PAGE_ENTRY = "user-scripts.html";
export const WIDGETS_PAGE_ENTRY = "widgets.html";
export const WIDGET_RUNTIME_PAGE_ENTRY = "widget-runtime.html";
export const RENDER_PREVIEW_PAGE_ENTRY = "render-preview.html";

const miloProtocolRegisteredSessions = new Set<string>();

const WIDGET_HOST_API_CLIENT_SCRIPT = String.raw`
(() => {
  if (window.milo && window.milo.browser && window.milo.widget) {
    return;
  }

  const pending = new Map();
  const refreshListeners = new Set();
  const REQUEST_TIMEOUT_MS = 60000;

  function createRequestId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return "milo-widget-api-" + globalThis.crypto.randomUUID();
    }
    return "milo-widget-api-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  }

  function callBrowserTool(tool, input) {
    if (!tool || typeof tool !== "string") {
      return Promise.reject(new Error("A browser automation tool name is required."));
    }

    const requestId = createRequestId();
    window.parent.postMessage({
      type: "milo:browser:call",
      payload: {
        requestId,
        tool,
        input: input && typeof input === "object" ? input : {},
      },
    }, "*");

    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("Browser automation call timed out."));
      }, REQUEST_TIMEOUT_MS);
      pending.set(requestId, {
        resolve,
        reject,
        timeoutId,
      });
    });
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || typeof message !== "object" || typeof message.type !== "string") {
      return;
    }

    if (message.type === "milo:browser:result") {
      const requestId = message.payload && typeof message.payload.requestId === "string"
        ? message.payload.requestId
        : "";
      const request = pending.get(requestId);
      if (!request) {
        return;
      }
      pending.delete(requestId);
      window.clearTimeout(request.timeoutId);
      if (message.payload && typeof message.payload.error === "string" && message.payload.error) {
        request.reject(new Error(message.payload.error));
      } else {
        request.resolve(message.payload ? message.payload.result : undefined);
      }
      return;
    }

    if (message.type === "host:refresh") {
      const payload = message.payload || {};
      for (const listener of Array.from(refreshListeners)) {
        try {
          listener(payload);
        } catch (error) {
          setTimeout(() => { throw error; }, 0);
        }
      }
    }
  });

  const existing = window.milo && typeof window.milo === "object" ? window.milo : {};
  const browser = {
    call: callBrowserTool,
    open: (input) => callBrowserTool("page.open", input),
    snapshot: (input) => callBrowserTool("page.snapshot", input),
    extract: (input) => callBrowserTool("page.extract", input),
    extractRecords: (input) => callBrowserTool("extract.records", input),
    extractData: (input) => callBrowserTool("browser.extract_data", input),
    interact: (input) => callBrowserTool("page.interact", input),
    navigate: (input) => callBrowserTool("browser.navigate", input),
    context: (input) => callBrowserTool("browser.get_page_context", input),
  };
  const widget = {
    ready: () => window.parent.postMessage({ type: "widget:ready" }, "*"),
    refresh: () => window.parent.postMessage({ type: "widget:refresh" }, "*"),
    error: (message) => window.parent.postMessage({
      type: "widget:error",
      payload: { message: String(message || "Widget error") },
    }, "*"),
    onRefresh: (listener) => {
      if (typeof listener !== "function") {
        return () => {};
      }
      refreshListeners.add(listener);
      return () => refreshListeners.delete(listener);
    },
  };

  window.milo = {
    ...existing,
    browser,
    widget,
    onRefresh: widget.onRefresh,
  };
  window.dispatchEvent(new CustomEvent("milo:ready", { detail: window.milo }));
})();
`.trim();

protocol.registerSchemesAsPrivileged([
  {
    scheme: MILO_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
  {
    scheme: "nexus",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

export function resolveMiloPageEntry(requestUrl: URL) {
  const hostname = requestUrl.hostname.toLowerCase();
  const pathname = requestUrl.pathname || "";
  const hasRootPath = pathname === "" || pathname === "/";

  if (hostname === MILO_HOME_HOST && hasRootPath) {
    return HOME_PAGE_ENTRY;
  }

  if (hostname === MILO_AGENT_HOST && hasRootPath) {
    return AGENT_PAGE_ENTRY;
  }

  if (hostname === MILO_SEARCH_HOST && hasRootPath) {
    return SEARCH_PAGE_ENTRY;
  }

  if (hostname === MILO_TASKS_HOST && hasRootPath) {
    return TASKS_PAGE_ENTRY;
  }

  if (hostname === MILO_SETTINGS_HOST && hasRootPath) {
    return SETTINGS_PAGE_ENTRY;
  }

  if (hostname === MILO_LEARNING_HOST && hasRootPath) {
    return LEARNING_PAGE_ENTRY;
  }

  if (hostname === MILO_BOOKMARKS_HOST && hasRootPath) {
    return BOOKMARKS_PAGE_ENTRY;
  }

  if (hostname === MILO_HISTORY_HOST && hasRootPath) {
    return HISTORY_PAGE_ENTRY;
  }

  if (hostname === MILO_DOWNLOADS_HOST && hasRootPath) {
    return DOWNLOADS_PAGE_ENTRY;
  }

  if (hostname === MILO_WORKSPACE_HOST && hasRootPath) {
    return WORKSPACE_PAGE_ENTRY;
  }

  if (hostname === MILO_EXTENSIONS_HOST && hasRootPath) {
    return EXTENSIONS_PAGE_ENTRY;
  }

  if (hostname === MILO_USER_SCRIPTS_HOST && hasRootPath) {
    return USER_SCRIPTS_PAGE_ENTRY;
  }

  if (hostname === MILO_WIDGETS_HOST && hasRootPath) {
    return WIDGETS_PAGE_ENTRY;
  }

  if (hostname === MILO_WIDGET_RUNTIME_HOST && hasRootPath) {
    return WIDGET_RUNTIME_PAGE_ENTRY;
  }

  if (hostname === MILO_RENDER_PREVIEW_HOST && hasRootPath) {
    return RENDER_PREVIEW_PAGE_ENTRY;
  }

  const normalizedPath = pathname.toLowerCase().replace(/^\/+/, "");
  const pathSegments = normalizedPath.length > 0 ? normalizedPath.split("/") : [];
  const firstPathSegment = pathSegments[0] ?? "";
  const hasSinglePathSegment = pathSegments.length === 1;

  if (hasSinglePathSegment && firstPathSegment === MILO_HOME_HOST) {
    return HOME_PAGE_ENTRY;
  }

  if (hasSinglePathSegment && firstPathSegment === MILO_AGENT_HOST) {
    return AGENT_PAGE_ENTRY;
  }

  if (hasSinglePathSegment && firstPathSegment === MILO_SEARCH_HOST) {
    return SEARCH_PAGE_ENTRY;
  }

  if (hasSinglePathSegment && firstPathSegment === MILO_TASKS_HOST) {
    return TASKS_PAGE_ENTRY;
  }

  if (hasSinglePathSegment && firstPathSegment === MILO_SETTINGS_HOST) {
    return SETTINGS_PAGE_ENTRY;
  }

  if (hasSinglePathSegment && firstPathSegment === MILO_LEARNING_HOST) {
    return LEARNING_PAGE_ENTRY;
  }

  if (hasSinglePathSegment && firstPathSegment === MILO_BOOKMARKS_HOST) {
    return BOOKMARKS_PAGE_ENTRY;
  }

  if (hasSinglePathSegment && firstPathSegment === MILO_HISTORY_HOST) {
    return HISTORY_PAGE_ENTRY;
  }

  if (hasSinglePathSegment && firstPathSegment === MILO_DOWNLOADS_HOST) {
    return DOWNLOADS_PAGE_ENTRY;
  }

  if (hasSinglePathSegment && firstPathSegment === MILO_WORKSPACE_HOST) {
    return WORKSPACE_PAGE_ENTRY;
  }

  if (hasSinglePathSegment && firstPathSegment === MILO_EXTENSIONS_HOST) {
    return EXTENSIONS_PAGE_ENTRY;
  }

  if (hasSinglePathSegment && firstPathSegment === MILO_USER_SCRIPTS_HOST) {
    return USER_SCRIPTS_PAGE_ENTRY;
  }

  if (hasSinglePathSegment && firstPathSegment === MILO_WIDGETS_HOST) {
    return WIDGETS_PAGE_ENTRY;
  }

  if (hasSinglePathSegment && firstPathSegment === MILO_WIDGET_RUNTIME_HOST) {
    return WIDGET_RUNTIME_PAGE_ENTRY;
  }

  if (hasSinglePathSegment && firstPathSegment === MILO_RENDER_PREVIEW_HOST) {
    return RENDER_PREVIEW_PAGE_ENTRY;
  }

  return null;
}

export function createMiloProtocolManager(options: CreateMiloProtocolManagerOptions) {
  const {
    rendererDistPath,
    devServerUrl,
    resolveDynamicTarget,
  } = options;

  function buildRendererPageUrl(pageName: string, query?: Record<string, string>) {
    if (devServerUrl) {
      const base = devServerUrl.endsWith("/") ? devServerUrl : `${devServerUrl}/`;
      const url = new URL(pageName, base);
      if (query) {
        for (const [key, value] of Object.entries(query)) {
          url.searchParams.set(key, value);
        }
      }
      return url.toString();
    }

    const url = pathToFileURL(path.join(rendererDistPath, pageName));
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  function applyRendererQuery(url: URL, query?: string | URLSearchParams) {
    if (!query) {
      return;
    }

    if (typeof query === "string") {
      if (!query) {
        return;
      }
      url.search = query.startsWith("?") ? query : `?${query}`;
      return;
    }

    for (const [key, value] of query.entries()) {
      url.searchParams.set(key, value);
    }
  }

  function buildRendererAssetUrl(
    assetPath: string,
    query?: string | URLSearchParams,
    rendererAssetOptions?: RendererAssetUrlOptions,
  ) {
    if (devServerUrl) {
      const base = devServerUrl.endsWith("/") ? devServerUrl : `${devServerUrl}/`;
      const url = new URL(assetPath, base);
      applyRendererQuery(url, query);

      const normalizedPath = url.pathname.toLowerCase();
      const isCssAsset = normalizedPath.endsWith(".css");
      const hasCssModeParam = ["direct", "inline", "raw", "url", "used", "import"]
        .some((name) => url.searchParams.has(name));
      if (rendererAssetOptions?.preferCssDirect && isCssAsset && !hasCssModeParam) {
        url.search = url.search ? `${url.search}&direct` : "?direct";
      }

      return url.toString();
    }

    const normalizedAssetPath = assetPath.replace(/^\/+/, "");
    const url = pathToFileURL(path.join(rendererDistPath, normalizedAssetPath));
    applyRendererQuery(url, query);
    return url.toString();
  }

  function buildWidgetApiClientResponse() {
    return new Response(`${WIDGET_HOST_API_CLIENT_SCRIPT}\n`, {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
      },
    });
  }

  function injectWidgetApiClient(html: string) {
    if (html.includes("milo:browser:call") || html.includes("milo://widget-api/client.js")) {
      return html;
    }

    const scriptTag = `<script>${WIDGET_HOST_API_CLIENT_SCRIPT.replace(/<\/script/gi, "<\\/script")}</script>`;
    if (/<head(?:\s[^>]*)?>/i.test(html)) {
      return html.replace(/<head(?:\s[^>]*)?>/i, (match) => `${match}${scriptTag}`);
    }
    if (/<\/body\s*>/i.test(html)) {
      return html.replace(/<\/body\s*>/i, `${scriptTag}</body>`);
    }
    return `${scriptTag}${html}`;
  }

  function resolveMiloAssetPath(requestUrl: URL) {
    const hostname = requestUrl.hostname.toLowerCase();
    const pathname = requestUrl.pathname || "";
    const pathnameSegments = pathname.replace(/^\/+/, "").split("/").filter((segment) => segment.length > 0);
    const pathnameHostCandidate = (pathnameSegments[0] ?? "").toLowerCase();

    const isKnownEntryHost =
      hostname === MILO_HOME_HOST
      || hostname === MILO_AGENT_HOST
      || hostname === MILO_SEARCH_HOST
      || hostname === MILO_TASKS_HOST
      || hostname === MILO_SETTINGS_HOST
      || hostname === MILO_LEARNING_HOST
      || hostname === MILO_BOOKMARKS_HOST
      || hostname === MILO_HISTORY_HOST
      || hostname === MILO_DOWNLOADS_HOST
      || hostname === MILO_WORKSPACE_HOST
      || hostname === MILO_EXTENSIONS_HOST
      || hostname === MILO_USER_SCRIPTS_HOST
      || hostname === MILO_WIDGETS_HOST
      || hostname === MILO_WIDGET_RUNTIME_HOST
      || hostname === MILO_RENDER_PREVIEW_HOST;
    const isKnownEntryHostFromPath =
      pathnameHostCandidate === MILO_HOME_HOST
      || pathnameHostCandidate === MILO_AGENT_HOST
      || pathnameHostCandidate === MILO_SEARCH_HOST
      || pathnameHostCandidate === MILO_TASKS_HOST
      || pathnameHostCandidate === MILO_SETTINGS_HOST
      || pathnameHostCandidate === MILO_LEARNING_HOST
      || pathnameHostCandidate === MILO_BOOKMARKS_HOST
      || pathnameHostCandidate === MILO_HISTORY_HOST
      || pathnameHostCandidate === MILO_DOWNLOADS_HOST
      || pathnameHostCandidate === MILO_WORKSPACE_HOST
      || pathnameHostCandidate === MILO_EXTENSIONS_HOST
      || pathnameHostCandidate === MILO_USER_SCRIPTS_HOST
      || pathnameHostCandidate === MILO_WIDGETS_HOST
      || pathnameHostCandidate === MILO_WIDGET_RUNTIME_HOST
      || pathnameHostCandidate === MILO_RENDER_PREVIEW_HOST;
    if (isKnownEntryHost && (pathname === "" || pathname === "/")) {
      return null;
    }

    let candidatePath = "";
    if (!hostname) {
      if (isKnownEntryHostFromPath && pathnameSegments.length > 1) {
        candidatePath = `/${pathnameSegments.slice(1).join("/")}`;
      } else {
        candidatePath = pathname;
      }
    } else if (isKnownEntryHost) {
      candidatePath = pathname;
    } else {
      return null;
    }

    if (candidatePath === "" || candidatePath === "/") {
      return null;
    }

    if (!candidatePath.startsWith("/")) {
      return null;
    }

    const normalized = path.posix.normalize(candidatePath);
    if (!normalized.startsWith("/")) {
      return null;
    }

    if (normalized.split("/").some((segment) => segment === "..")) {
      return null;
    }

    return normalized;
  }

  function resolveMiloTargetUrl(
    requestUrlString: string,
    rendererAssetOptions?: RendererAssetUrlOptions,
  ): ResolvedMiloTarget | null {
    const requestUrl = new URL(requestUrlString);
    const pageEntry = resolveMiloPageEntry(requestUrl);

    if (pageEntry) {
      const targetUrl = new URL(buildRendererPageUrl(pageEntry));
      applyRendererQuery(targetUrl, requestUrl.search);

      return {
        kind: "page",
        targetUrl: targetUrl.toString(),
      };
    }

    const dynamicTarget = resolveDynamicTarget?.(requestUrl);
    if (dynamicTarget) {
      return dynamicTarget;
    }

    const assetPath = resolveMiloAssetPath(requestUrl);
    if (!assetPath) {
      return null;
    }

    return {
      kind: "asset",
      targetUrl: buildRendererAssetUrl(assetPath, requestUrl.search, rendererAssetOptions),
    };
  }

  function getRequestHeader(
    headers: Headers | Record<string, string | string[]>,
    key: string,
  ) {
    if (headers instanceof Headers) {
      const value = headers.get(key);
      return value ?? undefined;
    }

    const targetKey = key.toLowerCase();
    for (const [headerKey, value] of Object.entries(headers)) {
      if (headerKey.toLowerCase() !== targetKey) {
        continue;
      }
      if (Array.isArray(value)) {
        return value[0];
      }
      return value;
    }
    return undefined;
  }

  function registerMiloProtocolForSession(sessionKey: string) {
    if (miloProtocolRegisteredSessions.has(sessionKey)) {
      return;
    }

    const targetSession =
      sessionKey === DEFAULT_SESSION_KEY
        ? session.defaultSession
        : session.fromPartition(sessionKey);

    targetSession.protocol.handle(MILO_SCHEME, (request) => {
      const requestUrl = new URL(request.url);
      if (requestUrl.hostname.toLowerCase() === MILO_WIDGET_API_HOST) {
        return buildWidgetApiClientResponse();
      }

      const secFetchDest = getRequestHeader(request.headers, "sec-fetch-dest")?.toLowerCase() ?? "";
      const resolvedTarget = resolveMiloTargetUrl(request.url, {
        preferCssDirect: secFetchDest === "style",
      });
      if (!resolvedTarget) {
        return new Response("Not Found", { status: 404 });
      }

      const init: RequestInit = {
        method: request.method,
        redirect: "follow",
      };

      if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = request.body;
      }

      return net.fetch(resolvedTarget.targetUrl, init)
        .then((response) => {
          const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
          if (
            resolvedTarget.kind === "asset"
            && !resolvedTarget.allowHtml
            && contentType.includes("text/html")
          ) {
            return new Response("Not Found", { status: 404 });
          }
          if (
            requestUrl.hostname.toLowerCase() === MILO_WIDGET_PACKAGE_HOST
            && resolvedTarget.kind === "asset"
            && resolvedTarget.allowHtml
            && contentType.includes("text/html")
          ) {
            const headers = new Headers(response.headers);
            headers.delete("content-length");
            headers.set("content-type", "text/html; charset=utf-8");
            return response.text().then((html) => new Response(injectWidgetApiClient(html), {
              headers,
              status: response.status,
              statusText: response.statusText,
            }));
          }
          return response;
        })
        .catch((error) => {
          console.error(`[MILO] Failed to proxy ${request.url} -> ${resolvedTarget.targetUrl}`, error);
          return new Response("Bad Gateway", { status: 502 });
        });
    });

    targetSession.protocol.handle("nexus", () => {
      return new Response("<!DOCTYPE html><html><head><title>NEXUS</title></head><body style='background:#05050a;'></body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
        status: 200,
      });
    });

    miloProtocolRegisteredSessions.add(sessionKey);
  }

  function registerMiloProtocol() {
    registerMiloProtocolForSession(DEFAULT_SESSION_KEY);
  }

  function ensureMiloProtocolForPartition(partition: string) {
    registerMiloProtocolForSession(partition);
  }

  return {
    buildRendererPageUrl,
    ensureMiloProtocolForPartition,
    registerMiloProtocol,
  };
}
