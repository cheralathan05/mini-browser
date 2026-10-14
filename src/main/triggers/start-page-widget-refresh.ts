import type { StartPageWidgetsState } from "../state/app-settings.js";
import { createTriggerEventBus, type TriggerEvent } from "./trigger-event-bus.js";
import { createNodeTimeEventSource, type TimeSourceEvent } from "./time-event-source.js";

export interface StartPageWidgetRefreshEvent {
  driftMs: number;
  reason: "interval";
  refreshedAt: number;
  refreshIntervalMs: number;
  scheduledAt: number;
  source: string;
  triggerId: string;
  widgetId: string;
  workspaceId: string;
}

interface CreateStartPageWidgetRefreshServiceOptions {
  getWidgetsState: (workspaceId: string) => StartPageWidgetsState;
  getWorkspaceIds: () => string[];
  onRefresh: (event: StartPageWidgetRefreshEvent) => void;
  onStaleRegistration?: (registration: {
    source: string;
    widgetId: string;
    workspaceId: string;
  }) => void;
}

interface WidgetRefreshRegistration {
  intervalMs: number;
  nextRunAt: number;
  source: string;
  triggerId: string;
  widgetId: string;
  workspaceId: string;
}

const WIDGET_REFRESH_TIME_SOURCE_PREFIX = "start-page-widget-refresh:";
const WIDGET_REFRESH_EVENT_TYPE = "widget.refresh";
const MIN_REFRESH_INTERVAL_MS = 1_000;
const MAX_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1_000;

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

export function resolveStartPageWidgetRefreshInterval(source: string) {
  const normalizedSource = source.trim();
  if (!normalizedSource) {
    return null;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalizedSource);
  } catch {
    return null;
  }

  if (parsedUrl.protocol.toLowerCase() !== "widget:") {
    return null;
  }

  const token = resolveWidgetToken(parsedUrl);
  const explicitRefresh = parseRefreshInterval(parsedUrl.searchParams.get("refresh"));
  if (token === "clock") {
    if (explicitRefresh !== null) {
      return explicitRefresh;
    }
    return parseBooleanParam(parsedUrl.searchParams.get("seconds"), true) ? 1_000 : 60_000;
  }

  if (token === "countdown") {
    return explicitRefresh ?? 60_000;
  }

  return explicitRefresh;
}

function getRegistrationKey(workspaceId: string, widgetId: string) {
  return `${workspaceId}::${widgetId}`;
}

function getTimeSourceId(workspaceId: string, widgetId: string) {
  return `${WIDGET_REFRESH_TIME_SOURCE_PREFIX}${getRegistrationKey(workspaceId, widgetId)}`;
}

function getNextIntervalRunAt(previousScheduledAt: number, intervalMs: number, now: number) {
  let nextRunAt = previousScheduledAt + intervalMs;
  while (nextRunAt <= now) {
    nextRunAt += intervalMs;
  }
  return nextRunAt;
}

function readStringPayload(event: TriggerEvent, key: string) {
  const value = event.payload?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumberPayload(event: TriggerEvent, key: string) {
  const value = event.payload?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function createStartPageWidgetRefreshService(options: CreateStartPageWidgetRefreshServiceOptions) {
  const timeSource = createNodeTimeEventSource();
  const triggerEventBus = createTriggerEventBus();
  const registrations = new Map<string, WidgetRefreshRegistration>();
  const lastRefreshes = new Map<string, StartPageWidgetRefreshEvent>();

  function armRegistration(registration: WidgetRefreshRegistration) {
    timeSource.upsert({
      sourceId: registration.triggerId,
      type: "time.interval.tick",
      scheduledAt: registration.nextRunAt,
      payload: {
        intervalMs: registration.intervalMs,
        source: registration.source,
        widgetId: registration.widgetId,
        workspaceId: registration.workspaceId,
      },
    });
  }

  function removeRegistration(key: string) {
    const current = registrations.get(key);
    if (!current) {
      return;
    }
    timeSource.remove(current.triggerId);
    registrations.delete(key);
    lastRefreshes.delete(key);
  }

  function isRegistrationCurrent(registration: WidgetRefreshRegistration) {
    const widgetsState = options.getWidgetsState(registration.workspaceId);
    const widget = widgetsState.items.find((item) =>
      item.id === registration.widgetId
      && item.type === "protocol"
      && item.source === registration.source);
    if (!widget || widget.type !== "protocol") {
      return false;
    }

    return resolveStartPageWidgetRefreshInterval(widget.source) === registration.intervalMs;
  }

  function syncWorkspace(workspaceId: string) {
    const normalizedWorkspaceId = workspaceId.trim();
    if (!normalizedWorkspaceId) {
      return;
    }

    const widgetsState = options.getWidgetsState(normalizedWorkspaceId);
    const seenKeys = new Set<string>();
    const now = Date.now();

    for (const widget of widgetsState.items) {
      if (widget.type !== "protocol") {
        continue;
      }

      const intervalMs = resolveStartPageWidgetRefreshInterval(widget.source);
      if (!intervalMs) {
        continue;
      }

      const key = getRegistrationKey(normalizedWorkspaceId, widget.id);
      seenKeys.add(key);
      const current = registrations.get(key);
      if (
        current
        && current.intervalMs === intervalMs
        && current.source === widget.source
      ) {
        continue;
      }
      if (current) {
        timeSource.remove(current.triggerId);
        lastRefreshes.delete(key);
      }

      const registration: WidgetRefreshRegistration = {
        intervalMs,
        nextRunAt: now + intervalMs,
        source: widget.source,
        triggerId: getTimeSourceId(normalizedWorkspaceId, widget.id),
        widgetId: widget.id,
        workspaceId: normalizedWorkspaceId,
      };
      registrations.set(key, registration);
      armRegistration(registration);
    }

    for (const [key, registration] of registrations) {
      if (registration.workspaceId === normalizedWorkspaceId && !seenKeys.has(key)) {
        removeRegistration(key);
      }
    }
  }

  function syncAll() {
    const workspaceIds = new Set(options.getWorkspaceIds().map((workspaceId) => workspaceId.trim()).filter(Boolean));
    for (const workspaceId of workspaceIds) {
      syncWorkspace(workspaceId);
    }

    for (const [key, registration] of registrations) {
      if (!workspaceIds.has(registration.workspaceId)) {
        removeRegistration(key);
      }
    }
  }

  function handleTimeSourceEvent(event: TimeSourceEvent) {
    if (event.type !== "time.interval.tick") {
      return;
    }

    const registration = registrations.get(getRegistrationKey(
      typeof event.payload?.workspaceId === "string" ? event.payload.workspaceId : "",
      typeof event.payload?.widgetId === "string" ? event.payload.widgetId : "",
    ));
    if (!registration || registration.triggerId !== event.sourceId) {
      timeSource.remove(event.sourceId);
      return;
    }

    if (!isRegistrationCurrent(registration)) {
      options.onStaleRegistration?.({
        source: registration.source,
        widgetId: registration.widgetId,
        workspaceId: registration.workspaceId,
      });
      removeRegistration(getRegistrationKey(registration.workspaceId, registration.widgetId));
      timeSource.remove(event.sourceId);
      return;
    }

    registration.nextRunAt = getNextIntervalRunAt(event.scheduledAt, registration.intervalMs, event.occurredAt);
    armRegistration(registration);
    triggerEventBus.emit({
      type: WIDGET_REFRESH_EVENT_TYPE,
      triggerId: registration.triggerId,
      occurredAt: event.occurredAt,
      sourceEventId: event.id,
      sourceType: event.type,
      dedupeKey: `${event.sourceId}:${event.sequence}`,
      payload: {
        driftMs: event.driftMs,
        intervalMs: registration.intervalMs,
        scheduledAt: event.scheduledAt,
        source: registration.source,
        widgetId: registration.widgetId,
        workspaceId: registration.workspaceId,
      },
    });
  }

  function handleRefreshEvent(event: TriggerEvent) {
    const workspaceId = readStringPayload(event, "workspaceId");
    const widgetId = readStringPayload(event, "widgetId");
    const source = readStringPayload(event, "source");
    const intervalMs = readNumberPayload(event, "intervalMs");
    const scheduledAt = readNumberPayload(event, "scheduledAt");
    const driftMs = readNumberPayload(event, "driftMs") ?? 0;
    if (!workspaceId || !widgetId || !source || !intervalMs || !scheduledAt) {
      return;
    }

    const refresh: StartPageWidgetRefreshEvent = {
      driftMs,
      reason: "interval",
      refreshedAt: event.occurredAt,
      refreshIntervalMs: intervalMs,
      scheduledAt,
      source,
      triggerId: event.triggerId,
      widgetId,
      workspaceId,
    };
    lastRefreshes.set(getRegistrationKey(workspaceId, widgetId), refresh);
    options.onRefresh(refresh);
  }

  timeSource.subscribe(handleTimeSourceEvent);
  triggerEventBus.subscribe(handleRefreshEvent, { type: WIDGET_REFRESH_EVENT_TYPE });

  return {
    getWorkspaceRefreshes(workspaceId: string) {
      const normalizedWorkspaceId = workspaceId.trim();
      return Array.from(lastRefreshes.values())
        .filter((event) => event.workspaceId === normalizedWorkspaceId)
        .map((event) => ({ ...event }));
    },
    resolveRefreshInterval: resolveStartPageWidgetRefreshInterval,
    shutdown() {
      timeSource.stop();
      registrations.clear();
      lastRefreshes.clear();
    },
    syncAll,
    syncWorkspace,
  };
}
