import { useEffect, useMemo, useRef, useState } from "react";

import { parseStartPageProtocolWidgetSource } from "@/components/home/start-page-protocol-widget";

type RuntimeTheme = "light" | "dark";

interface RuntimeMessage {
  data?: unknown;
  payload?: Record<string, unknown>;
  type: string;
}

interface WidgetPackageRequestPayload {
  packageId?: string;
  requestId?: string;
}

interface WidgetPackageResponsePayload {
  error?: string;
  package?: WidgetPackageSummary | null;
  packageId?: string;
  requestId?: string;
}

const WIDGET_PACKAGE_RESPONSE_MESSAGE = "widget-runtime:get-package-result";
const WIDGET_PACKAGE_REQUEST_MESSAGE = "widget-runtime:get-package";
const WIDGET_PACKAGE_REQUEST_TIMEOUT_MS = 5_000;
const WIDGET_AUTOMATION_CALL_MESSAGE = "milo:browser:call";
const WIDGET_AUTOMATION_RESULT_MESSAGE = "milo:browser:result";

function getResolvedTheme() {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function createRuntimeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `widget-runtime-${crypto.randomUUID()}`;
  }

  return `widget-runtime-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function buildPackageAssetUrl(packageId: string, entry: string) {
  const normalizedEntry = entry.replace(/^\/+/, "");
  const encodedEntry = normalizedEntry
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `milo://widget-package/${encodeURIComponent(packageId)}/${encodedEntry}`;
}

function queryToRecord(params: URLSearchParams) {
  const result: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
}

function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function isWidgetPackageResponseMessage(
  value: unknown,
): value is RuntimeMessage & { payload?: WidgetPackageResponsePayload } {
  return isRuntimeMessage(value) && value.type === WIDGET_PACKAGE_RESPONSE_MESSAGE;
}

function requestWidgetPackageFromParent(packageId: string) {
  if (window.parent === window) {
    return Promise.reject(new Error("Widget registry is unavailable."));
  }

  const requestId = createRuntimeId();

  return new Promise<WidgetPackageSummary | null>((resolve, reject) => {
    const cleanupCallbacks: Array<() => void> = [];

    const cleanup = () => {
      while (cleanupCallbacks.length > 0) {
        cleanupCallbacks.pop()?.();
      }
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || !isWidgetPackageResponseMessage(event.data)) {
        return;
      }

      const payload = event.data.payload;
      if (payload?.requestId !== requestId || payload.packageId !== packageId) {
        return;
      }

      cleanup();

      if (typeof payload.error === "string" && payload.error.trim()) {
        reject(new Error(payload.error));
        return;
      }

      resolve(payload.package ?? null);
    };

    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Widget registry is unavailable."));
    }, WIDGET_PACKAGE_REQUEST_TIMEOUT_MS);

    cleanupCallbacks.push(() => {
      window.clearTimeout(timeoutId);
    });
    cleanupCallbacks.push(() => {
      window.removeEventListener("message", handleMessage);
    });

    window.addEventListener("message", handleMessage);
    window.parent.postMessage({
      payload: {
        packageId,
        requestId,
      } satisfies WidgetPackageRequestPayload,
      type: WIDGET_PACKAGE_REQUEST_MESSAGE,
    } satisfies RuntimeMessage, "*");
  });
}

export function WidgetRuntimePage() {
  const query = useMemo(() => new URL(window.location.href).searchParams, []);
  const source = query.get("source")?.trim() ?? "";
  const title = query.get("title")?.trim() ?? "";
  const parsed = useMemo(() => parseStartPageProtocolWidgetSource(source), [source]);
  const widgetFrameRef = useRef<HTMLIFrameElement | null>(null);
  const runtimeIdRef = useRef(createRuntimeId());
  const latestInitMessageRef = useRef<RuntimeMessage | null>(null);
  const [theme, setTheme] = useState<RuntimeTheme>(() => getResolvedTheme());
  const [locale, setLocale] = useState(() => navigator.language || "en-US");
  const [widgetUrl, setWidgetUrl] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("Loading widget...");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [packageSummary, setPackageSummary] = useState<WidgetPackageSummary | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const browserShell = window.browserShell;
    if (!browserShell) {
      return;
    }

    void browserShell.settingsGetTheme()
      .then((nextTheme) => {
        setTheme(nextTheme === "light" ? "light" : "dark");
      })
      .catch(() => undefined);
    void browserShell.settingsGetLanguage()
      .then((nextLanguage) => {
        if (typeof nextLanguage === "string" && nextLanguage.trim()) {
          setLocale(nextLanguage);
        }
      })
      .catch(() => undefined);

    const disposeTheme = browserShell.onThemeChanged((nextTheme) => {
      setTheme(nextTheme === "light" ? "light" : "dark");
    });
    const disposeLanguage = browserShell.onLanguageChanged((nextLanguage) => {
      if (typeof nextLanguage === "string" && nextLanguage.trim()) {
        setLocale(nextLanguage);
      }
    });

    return () => {
      disposeTheme();
      disposeLanguage();
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    if (parsed.kind === "error") {
      setWidgetUrl(null);
      setPackageSummary(null);
      setErrorText("Invalid widget runtime source.");
      setStatusText("Unable to load widget.");
      return;
    }

    if (parsed.kind === "package") {
      const browserShell = window.browserShell;
      const packageLoader = browserShell?.widgetRegistryGetPackage
        ? browserShell.widgetRegistryGetPackage(parsed.packageId)
        : requestWidgetPackageFromParent(parsed.packageId);

      setStatusText(`Loading package ${parsed.packageId}...`);
      setErrorText(null);
      setWidgetUrl(null);
      void packageLoader
        .then((resolvedPackage) => {
          if (disposed) {
            return;
          }

          if (!resolvedPackage) {
            setPackageSummary(null);
            setWidgetUrl(null);
            setErrorText(`Widget package "${parsed.packageId}" was not found.`);
            setStatusText("Package not found.");
            return;
          }

          setPackageSummary(resolvedPackage);
          setWidgetUrl(buildPackageAssetUrl(resolvedPackage.id, resolvedPackage.entry));
          setErrorText(null);
          setStatusText(`Loaded ${resolvedPackage.name}`);
        })
        .catch((error) => {
          if (disposed) {
            return;
          }

          setPackageSummary(null);
          setWidgetUrl(null);
          setErrorText(error instanceof Error ? error.message : String(error));
          setStatusText("Unable to load widget.");
        });

      return () => {
        disposed = true;
      };
    }

    if (parsed.kind === "dev") {
      setPackageSummary(null);
      setWidgetUrl(parsed.entry);
      setErrorText(null);
      setStatusText(`Connected to ${parsed.widgetId}`);
      return;
    }

    setWidgetUrl(null);
    setPackageSummary(null);
    setErrorText("This runtime only supports package or dev widgets.");
    setStatusText("Unsupported widget type.");
  }, [parsed]);

  useEffect(() => {
    if (parsed.kind === "error" || !widgetUrl) {
      latestInitMessageRef.current = null;
      return;
    }

    const nextMessage: RuntimeMessage = {
      payload: {
        instanceId: runtimeIdRef.current,
        locale,
        packageId: parsed.kind === "package" ? parsed.packageId : undefined,
        packageName: packageSummary?.name,
        params: "params" in parsed ? queryToRecord(parsed.params) : {},
        refreshIntervalMs: parsed.refreshIntervalMs,
        source: parsed.source,
        theme,
        title: title || packageSummary?.defaultTitle || parsed.defaultTitle,
      },
      type: "host:update-context",
    };
    latestInitMessageRef.current = nextMessage;
    widgetFrameRef.current?.contentWindow?.postMessage(nextMessage, "*");
  }, [locale, packageSummary?.defaultTitle, packageSummary?.name, parsed, theme, title, widgetUrl]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!isRuntimeMessage(message)) {
        return;
      }

      if (event.source === window.parent) {
        if (message.type === WIDGET_PACKAGE_RESPONSE_MESSAGE) {
          return;
        }

        widgetFrameRef.current?.contentWindow?.postMessage(message, "*");
        return;
      }

      if (event.source !== widgetFrameRef.current?.contentWindow) {
        return;
      }

      if (message.type === "widget:refresh" || message.type === WIDGET_AUTOMATION_CALL_MESSAGE) {
        window.parent.postMessage(message, "*");
        return;
      }

      if (message.type === WIDGET_AUTOMATION_RESULT_MESSAGE) {
        return;
      }

      if (message.type === "widget:ready") {
        setStatusText(packageSummary?.name ?? title ?? "Widget ready");
        return;
      }

      if (message.type === "widget:error") {
        const maybeMessage = typeof message.payload?.message === "string"
          ? message.payload.message
          : "Widget reported an error.";
        setErrorText(maybeMessage);
        setStatusText("Widget error");
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [packageSummary?.name, title]);

  return (
    <div className="widget-runtime-shell">
      {widgetUrl ? (
        <iframe
          className="widget-runtime-frame"
          onLoad={() => {
            const initMessage = latestInitMessageRef.current;
            if (initMessage) {
              widgetFrameRef.current?.contentWindow?.postMessage(initMessage, "*");
            }
          }}
          ref={widgetFrameRef}
          sandbox="allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
          src={widgetUrl}
          title={title || packageSummary?.name || "Widget Runtime"}
        />
      ) : null}
      {!widgetUrl || errorText ? (
        <div className="widget-runtime-overlay">
          <div className="widget-runtime-card">
            <span className="widget-runtime-badge">Widget Runtime</span>
            <h1>{statusText}</h1>
            <p>{errorText ?? "Preparing widget host..."}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
