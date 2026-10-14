import { Clock3, Hourglass, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const START_PAGE_WIDGET_PROTOCOL = "widget:";
const WIDGET_RUNTIME_PAGE_URL = "milo://widget-runtime";
const MIN_REFRESH_INTERVAL_MS = 1_000;
const MAX_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1_000;

type StartPageCustomWidgetId = "clock" | "countdown";

export type StartPageProtocolWidgetErrorCode =
  | "missing_source"
  | "invalid_source"
  | "unsupported_widget";

export type StartPageProtocolWidgetParseResult =
  | {
      kind: "iframe";
      defaultTitle: string;
      refreshIntervalMs: number | null;
      source: string;
      src: string;
    }
  | {
      defaultTitle: string;
      kind: "package";
      packageId: string;
      params: URLSearchParams;
      refreshIntervalMs: number | null;
      source: string;
    }
  | {
      defaultTitle: string;
      entry: string;
      kind: "dev";
      params: URLSearchParams;
      refreshIntervalMs: number | null;
      source: string;
      widgetId: string;
    }
  | {
      defaultTitle: string;
      kind: "custom";
      params: URLSearchParams;
      refreshIntervalMs: number | null;
      source: string;
      widgetId: StartPageCustomWidgetId;
    }
  | {
      code: StartPageProtocolWidgetErrorCode;
      kind: "error";
    };

interface StartPageProtocolWidgetProps {
  labels: {
    invalidSource: string;
    missingSource: string;
    unsupportedWidget: string;
  };
  locale?: string;
  refreshEvent?: StartPageWidgetRefreshEvent | null;
  source: string;
  title: string;
  widgetId: string;
}

interface RuntimeMessage {
  data?: unknown;
  payload?: Record<string, unknown>;
  type: string;
}

const WIDGET_PACKAGE_REQUEST_MESSAGE = "widget-runtime:get-package";
const WIDGET_PACKAGE_RESPONSE_MESSAGE = "widget-runtime:get-package-result";
const WIDGET_AUTOMATION_CALL_MESSAGE = "milo:browser:call";
const WIDGET_AUTOMATION_RESULT_MESSAGE = "milo:browser:result";

function getTrimmedValue(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function parseBooleanParam(value: string | null | undefined, fallback = false) {
  const normalized = getTrimmedValue(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function clampRefreshInterval(value: number) {
  return Math.min(MAX_REFRESH_INTERVAL_MS, Math.max(MIN_REFRESH_INTERVAL_MS, value));
}

function parseRefreshInterval(raw: string | null | undefined) {
  const normalized = getTrimmedValue(raw).toLowerCase();
  if (!normalized || normalized === "0" || normalized === "off" || normalized === "false") {
    return null;
  }

  const match = normalized.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/);
  if (!match) {
    return null;
  }

  const amount = Number.parseFloat(match[1] ?? "");
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const unit = match[2] ?? "s";
  const multiplier =
    unit === "ms"
      ? 1
      : unit === "m"
        ? 60_000
        : unit === "h"
          ? 3_600_000
          : unit === "d"
            ? 86_400_000
            : 1_000;

  return clampRefreshInterval(Math.round(amount * multiplier));
}

function formatRefreshInterval(intervalMs: number | null) {
  if (!intervalMs) {
    return null;
  }

  if (intervalMs % 86_400_000 === 0) {
    return `${intervalMs / 86_400_000}d`;
  }

  if (intervalMs % 3_600_000 === 0) {
    return `${intervalMs / 3_600_000}h`;
  }

  if (intervalMs % 60_000 === 0) {
    return `${intervalMs / 60_000}m`;
  }

  if (intervalMs % 1_000 === 0) {
    return `${intervalMs / 1_000}s`;
  }

  return `${intervalMs}ms`;
}

function isEmbeddableWidgetUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "milo:";
  } catch {
    return false;
  }
}

function isLocalDevWidgetUrl(value: string) {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
  } catch {
    return false;
  }
}

function isWidgetPackageId(value: string) {
  return /^[a-z0-9][a-z0-9._-]*$/i.test(value);
}

function resolveWidgetPathSegments(parsedUrl: URL) {
  return parsedUrl.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function resolveWidgetToken(parsedUrl: URL) {
  const host = parsedUrl.hostname.trim().toLowerCase();
  const pathSegments = resolveWidgetPathSegments(parsedUrl)
    .map((segment) => segment.toLowerCase());

  if (host === "custom") {
    return pathSegments[0] ?? "";
  }

  return host || pathSegments[0] || "";
}

function getHashUrlCandidate(parsedUrl: URL) {
  const hashValue = parsedUrl.hash.startsWith("#")
    ? parsedUrl.hash.slice(1).trim()
    : parsedUrl.hash.trim();
  return hashValue;
}

function buildWidgetRuntimeUrl(source: string, title: string) {
  const url = new URL(WIDGET_RUNTIME_PAGE_URL);
  url.searchParams.set("source", source);
  if (title.trim()) {
    url.searchParams.set("title", title.trim());
  }
  return url.toString();
}

function isValidDateValue(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp);
}

function getDefaultCustomWidgetTitle(widgetId: StartPageCustomWidgetId) {
  return widgetId === "countdown" ? "Countdown" : "Clock";
}

function resolveCustomWidgetRefreshInterval(
  widgetId: StartPageCustomWidgetId,
  params: URLSearchParams,
) {
  const explicitRefresh = parseRefreshInterval(params.get("refresh"));
  if (explicitRefresh !== null) {
    return explicitRefresh;
  }

  if (widgetId === "countdown") {
    return 60_000;
  }

  const showSeconds = parseBooleanParam(params.get("seconds"), true);
  return showSeconds ? 1_000 : 60_000;
}

export function parseStartPageProtocolWidgetSource(source: string): StartPageProtocolWidgetParseResult {
  const normalizedSource = source.trim();
  if (!normalizedSource) {
    return {
      code: "missing_source",
      kind: "error",
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalizedSource);
  } catch {
    return {
      code: "invalid_source",
      kind: "error",
    };
  }

  if (parsedUrl.protocol.toLowerCase() !== START_PAGE_WIDGET_PROTOCOL) {
    return {
      code: "invalid_source",
      kind: "error",
    };
  }

  const widgetToken = resolveWidgetToken(parsedUrl);
  const pathSegments = resolveWidgetPathSegments(parsedUrl);
  if (!widgetToken) {
    return {
      code: "invalid_source",
      kind: "error",
    };
  }

  if (widgetToken === "iframe") {
    const iframeSrc =
      getTrimmedValue(parsedUrl.searchParams.get("src"))
      || getTrimmedValue(parsedUrl.searchParams.get("url"))
      || getHashUrlCandidate(parsedUrl);
    if (!iframeSrc || !isEmbeddableWidgetUrl(iframeSrc)) {
      return {
        code: "invalid_source",
        kind: "error",
      };
    }

    return {
      defaultTitle: getTrimmedValue(parsedUrl.searchParams.get("title")) || "Embed",
      kind: "iframe",
      refreshIntervalMs: parseRefreshInterval(parsedUrl.searchParams.get("refresh")),
      source: normalizedSource,
      src: iframeSrc,
    };
  }

  if (widgetToken === "package") {
    const packageId = getTrimmedValue(pathSegments[0]);
    if (!packageId || !isWidgetPackageId(packageId)) {
      return {
        code: "invalid_source",
        kind: "error",
      };
    }

    return {
      defaultTitle: getTrimmedValue(parsedUrl.searchParams.get("title")) || packageId,
      kind: "package",
      packageId,
      params: new URLSearchParams(parsedUrl.searchParams),
      refreshIntervalMs: parseRefreshInterval(parsedUrl.searchParams.get("refresh")),
      source: normalizedSource,
    };
  }

  if (widgetToken === "dev") {
    const widgetId = getTrimmedValue(pathSegments[0]) || "dev-widget";
    const entry =
      getTrimmedValue(parsedUrl.searchParams.get("entry"))
      || getTrimmedValue(parsedUrl.searchParams.get("src"))
      || getHashUrlCandidate(parsedUrl);
    if (!entry || !isLocalDevWidgetUrl(entry)) {
      return {
        code: "invalid_source",
        kind: "error",
      };
    }

    return {
      defaultTitle:
        getTrimmedValue(parsedUrl.searchParams.get("title"))
        || getTrimmedValue(parsedUrl.searchParams.get("label"))
        || widgetId,
      entry,
      kind: "dev",
      params: new URLSearchParams(parsedUrl.searchParams),
      refreshIntervalMs: parseRefreshInterval(parsedUrl.searchParams.get("refresh")),
      source: normalizedSource,
      widgetId,
    };
  }

  if (widgetToken !== "clock" && widgetToken !== "countdown") {
    return {
      code: "unsupported_widget",
      kind: "error",
    };
  }

  if (widgetToken === "countdown") {
    const target = getTrimmedValue(parsedUrl.searchParams.get("target"));
    if (!target || !isValidDateValue(target)) {
      return {
        code: "invalid_source",
        kind: "error",
      };
    }
  }

  const widgetId: StartPageCustomWidgetId = widgetToken;
  return {
    defaultTitle:
      getTrimmedValue(parsedUrl.searchParams.get("title"))
      || getTrimmedValue(parsedUrl.searchParams.get("label"))
      || getDefaultCustomWidgetTitle(widgetId),
    kind: "custom",
    params: new URLSearchParams(parsedUrl.searchParams),
    refreshIntervalMs: resolveCustomWidgetRefreshInterval(widgetId, parsedUrl.searchParams),
    source: normalizedSource,
    widgetId,
  };
}

function formatDateTime(
  locale: string | undefined,
  date: Date,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat(locale, options).format(date);
}

function resolveTimeZone(value: string | null | undefined) {
  const normalized = getTrimmedValue(value);
  if (!normalized) {
    return null;
  }

  try {
    new Intl.DateTimeFormat(undefined, { timeZone: normalized }).format(new Date());
    return normalized;
  } catch {
    return null;
  }
}

function renderWidgetError(
  code: StartPageProtocolWidgetErrorCode,
  labels: StartPageProtocolWidgetProps["labels"],
) {
  if (code === "missing_source") {
    return <div className="widget-empty">{labels.missingSource}</div>;
  }

  if (code === "unsupported_widget") {
    return <div className="widget-empty">{labels.unsupportedWidget}</div>;
  }

  return <div className="widget-empty">{labels.invalidSource}</div>;
}

function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function ClockProtocolWidget({
  locale,
  params,
  refreshIntervalMs,
  refreshedAt,
  title,
}: {
  locale?: string;
  params: URLSearchParams;
  refreshIntervalMs: number | null;
  refreshedAt: number;
  title: string;
}) {
  const timeZone = resolveTimeZone(params.get("timezone") ?? params.get("tz"));
  const showSeconds = parseBooleanParam(
    params.get("seconds"),
    refreshIntervalMs !== null && refreshIntervalMs < 60_000,
  );
  const hour12 = getTrimmedValue(params.get("format")) === "12h";
  const current = new Date(refreshedAt);
  const refreshLabel = formatRefreshInterval(refreshIntervalMs);
  const timeText = formatDateTime(locale, current, {
    hour: "2-digit",
    hour12,
    minute: "2-digit",
    ...(showSeconds ? { second: "2-digit" } : {}),
    ...(timeZone ? { timeZone } : {}),
  });
  const dateText = formatDateTime(locale, current, {
    day: "numeric",
    month: "short",
    weekday: "short",
    ...(timeZone ? { timeZone } : {}),
  });
  const zoneLabel = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "Local";

  return (
    <div className="widget-protocol-shell widget-protocol-shell--clock">
      <div className="widget-protocol-content">
        <div className="widget-protocol-header">
          <span className="widget-protocol-badge">{title}</span>
          {refreshLabel ? (
            <span className="widget-protocol-refresh-pill">
              <RefreshCw className="h-3.5 w-3.5" />
              {refreshLabel}
            </span>
          ) : null}
        </div>
        <div className="widget-protocol-value widget-protocol-value--clock">
          {timeText}
        </div>
        <div className="widget-protocol-meta">{dateText}</div>
        <div className="widget-protocol-footer">
          <Clock3 className="h-3.5 w-3.5" />
          <span>{zoneLabel}</span>
        </div>
      </div>
    </div>
  );
}

function buildCountdownParts(durationMs: number, includeSeconds: boolean) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [
    { label: "D", value: days.toString().padStart(2, "0") },
    { label: "H", value: hours.toString().padStart(2, "0") },
    { label: "M", value: minutes.toString().padStart(2, "0") },
  ];

  if (includeSeconds) {
    parts.push({ label: "S", value: seconds.toString().padStart(2, "0") });
  }

  return parts;
}

function CountdownProtocolWidget({
  locale,
  params,
  refreshIntervalMs,
  refreshedAt,
  title,
}: {
  locale?: string;
  params: URLSearchParams;
  refreshIntervalMs: number | null;
  refreshedAt: number;
  title: string;
}) {
  const target = new Date(getTrimmedValue(params.get("target")));
  const remainingMs = Math.max(0, target.getTime() - refreshedAt);
  const includeSeconds = refreshIntervalMs !== null && refreshIntervalMs < 60_000;
  const parts = buildCountdownParts(remainingMs, includeSeconds);
  const refreshLabel = formatRefreshInterval(refreshIntervalMs);
  const targetLabel = formatDateTime(locale, target, {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
  const targetWeekday = formatDateTime(locale, target, {
    weekday: "long",
  });

  return (
    <div className="widget-protocol-shell widget-protocol-shell--countdown">
      <div className="widget-protocol-content">
        <div className="widget-protocol-header">
          <span className="widget-protocol-badge">{title}</span>
          {refreshLabel ? (
            <span className="widget-protocol-refresh-pill">
              <RefreshCw className="h-3.5 w-3.5" />
              {refreshLabel}
            </span>
          ) : null}
        </div>
        <div className="widget-protocol-meta">{targetLabel}</div>
        <div className="widget-protocol-stat-grid">
          {parts.map((part) => (
            <div className="widget-protocol-stat" key={part.label}>
              <span className="widget-protocol-stat-value">{part.value}</span>
              <span className="widget-protocol-stat-label">{part.label}</span>
            </div>
          ))}
        </div>
        <div className="widget-protocol-footer">
          <Hourglass className="h-3.5 w-3.5" />
          <span>{targetWeekday}</span>
        </div>
      </div>
    </div>
  );
}

export function StartPageProtocolWidget({
  labels,
  locale,
  refreshEvent,
  source,
  title,
  widgetId,
}: StartPageProtocolWidgetProps) {
  const parsed = parseStartPageProtocolWidgetSource(source);
  const runtimeFrameRef = useRef<HTMLIFrameElement | null>(null);
  const [refreshedAt, setRefreshedAt] = useState(() => Date.now());
  const resolvedTitle = parsed.kind === "error"
    ? title.trim()
    : title.trim() || parsed.defaultTitle;

  useEffect(() => {
    setRefreshedAt(Date.now());
  }, [source]);

  useEffect(() => {
    if (!refreshEvent || refreshEvent.source !== source) {
      return;
    }
    setRefreshedAt(refreshEvent.refreshedAt);
  }, [refreshEvent, source]);

  useEffect(() => {
    if (parsed.kind !== "package" && parsed.kind !== "dev") {
      return;
    }

    runtimeFrameRef.current?.contentWindow?.postMessage({
      payload: {
        reason: "interval",
        refreshedAt,
      },
      type: "host:refresh",
    }, "*");
  }, [parsed.kind, refreshedAt]);

  useEffect(() => {
    if (parsed.kind !== "package" && parsed.kind !== "dev") {
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      const frameWindow = runtimeFrameRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow || !isRuntimeMessage(event.data)) {
        return;
      }

      if (event.data.type === "widget:refresh") {
        setRefreshedAt(Date.now());
        return;
      }

      if (event.data.type === WIDGET_AUTOMATION_CALL_MESSAGE) {
        const requestId = typeof event.data.payload?.requestId === "string"
          ? event.data.payload.requestId
          : "";
        const tool = typeof event.data.payload?.tool === "string"
          ? event.data.payload.tool
          : "";
        const input = event.data.payload?.input;
        const postResult = (payload: Record<string, unknown>) => {
          frameWindow.postMessage({
            payload: {
              requestId,
              ...payload,
            },
            type: WIDGET_AUTOMATION_RESULT_MESSAGE,
          } satisfies RuntimeMessage, "*");
        };

        if (!requestId || !tool) {
          postResult({ error: "Widget automation call requires a requestId and tool." });
          return;
        }

        const browserShell = window.browserShell;
        if (!browserShell?.startPageWidgetAutomationCall) {
          postResult({ error: "Widget automation API is unavailable." });
          return;
        }

        void browserShell.startPageWidgetAutomationCall({
          input,
          source,
          tool,
          widgetId,
        })
          .then((result) => {
            postResult({ result });
          })
          .catch((error) => {
            postResult({ error: error instanceof Error ? error.message : String(error) });
          });
        return;
      }

      if (parsed.kind !== "package") {
        return;
      }

      if (event.data.type !== WIDGET_PACKAGE_REQUEST_MESSAGE) {
        return;
      }

      const requestId = typeof event.data.payload?.requestId === "string"
        ? event.data.payload.requestId
        : "";
      const requestedPackageId = typeof event.data.payload?.packageId === "string"
        ? event.data.payload.packageId
        : "";

      if (!requestId || requestedPackageId !== parsed.packageId) {
        return;
      }

      const browserShell = window.browserShell;
      if (!browserShell?.widgetRegistryGetPackage) {
        frameWindow.postMessage({
          payload: {
            error: "Widget registry is unavailable.",
            packageId: requestedPackageId,
            requestId,
          },
          type: WIDGET_PACKAGE_RESPONSE_MESSAGE,
        } satisfies RuntimeMessage, "*");
        return;
      }

      void browserShell.widgetRegistryGetPackage(requestedPackageId)
        .then((widgetPackage) => {
          frameWindow.postMessage({
            payload: {
              package: widgetPackage ?? null,
              packageId: requestedPackageId,
              requestId,
            },
            type: WIDGET_PACKAGE_RESPONSE_MESSAGE,
          } satisfies RuntimeMessage, "*");
        })
        .catch((error) => {
          frameWindow.postMessage({
            payload: {
              error: error instanceof Error ? error.message : String(error),
              packageId: requestedPackageId,
              requestId,
            },
            type: WIDGET_PACKAGE_RESPONSE_MESSAGE,
          } satisfies RuntimeMessage, "*");
        });
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [parsed, source, widgetId]);

  if (parsed.kind === "error") {
    return renderWidgetError(parsed.code, labels);
  }

  if (parsed.kind === "iframe") {
    return (
      <div className="widget-frame-shell widget-frame-shell--protocol">
        <iframe
          key={`${parsed.source}:${refreshedAt}`}
          src={parsed.src}
          title={resolvedTitle}
        />
      </div>
    );
  }

  if (parsed.kind === "package" || parsed.kind === "dev") {
    return (
      <div className="widget-frame-shell widget-frame-shell--protocol">
        <iframe
          onLoad={() => {
            setRefreshedAt(Date.now());
          }}
          ref={runtimeFrameRef}
          src={buildWidgetRuntimeUrl(parsed.source, resolvedTitle)}
          title={resolvedTitle}
        />
      </div>
    );
  }

  if (parsed.widgetId === "countdown") {
    return (
      <CountdownProtocolWidget
        locale={locale}
        params={parsed.params}
        refreshIntervalMs={parsed.refreshIntervalMs}
        refreshedAt={refreshedAt}
        title={resolvedTitle}
      />
    );
  }

  return (
    <ClockProtocolWidget
      locale={locale}
      params={parsed.params}
      refreshIntervalMs={parsed.refreshIntervalMs}
      refreshedAt={refreshedAt}
      title={resolvedTitle}
    />
  );
}
