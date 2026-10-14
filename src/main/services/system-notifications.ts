import { execFile } from "node:child_process";
import {
  Notification,
  app,
  nativeImage,
} from "electron";

export type SystemNotificationUrgency = "low" | "normal" | "critical";

export interface SystemNotificationInput {
  title?: string;
  body?: string;
  subtitle?: string;
  silent?: boolean;
  urgency?: SystemNotificationUrgency;
}

export interface SystemNotificationResult {
  shown: boolean;
  delivery?: "electron" | "macos-osascript";
  reason?: "app-not-ready" | "empty" | "unsupported";
}

interface SystemNotificationServiceOptions {
  appName: string;
  iconPath?: string;
}

interface ShowSystemNotificationOptions {
  onClick?: () => void;
}

const MAX_TITLE_LENGTH = 96;
const MAX_SUBTITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 320;

function normalizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 1))}...`
    : normalized;
}

function normalizeUrgency(value: unknown): SystemNotificationUrgency | undefined {
  return value === "low" || value === "normal" || value === "critical"
    ? value
    : undefined;
}

function toAppleScriptStringLiteral(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function showMacOsFallbackNotification(input: {
  title: string;
  body: string;
  subtitle: string;
}) {
  const clauses = [
    "display notification",
    toAppleScriptStringLiteral(input.body),
    "with title",
    toAppleScriptStringLiteral(input.title),
  ];

  if (input.subtitle) {
    clauses.push("subtitle", toAppleScriptStringLiteral(input.subtitle));
  }

  execFile(
    "/usr/bin/osascript",
    ["-e", clauses.join(" ")],
    { timeout: 3_000 },
    () => undefined,
  );
}

export function createSystemNotificationService(options: SystemNotificationServiceOptions) {
  const appName = normalizeText(options.appName, MAX_TITLE_LENGTH) || "Milo";

  function createNotificationIcon() {
    if (!options.iconPath) {
      return undefined;
    }

    const icon = nativeImage.createFromPath(options.iconPath);
    return icon.isEmpty() ? undefined : icon;
  }

  function show(
    input: SystemNotificationInput,
    showOptions?: ShowSystemNotificationOptions,
  ): SystemNotificationResult {
    if (!app.isReady()) {
      return { shown: false, reason: "app-not-ready" };
    }

    const normalizedTitle = normalizeText(input.title, MAX_TITLE_LENGTH);
    const body = normalizeText(input.body, MAX_BODY_LENGTH);
    const subtitle = normalizeText(input.subtitle, MAX_SUBTITLE_LENGTH);
    const urgency = normalizeUrgency(input.urgency);

    if (!normalizedTitle && !body && !subtitle) {
      return { shown: false, reason: "empty" };
    }

    if (process.platform === "darwin" && !app.isPackaged) {
      showMacOsFallbackNotification({
        title: normalizedTitle || appName,
        body,
        subtitle,
      });
      app.dock?.bounce("informational");
      return { shown: true, delivery: "macos-osascript" };
    }

    if (!Notification.isSupported()) {
      return { shown: false, reason: "unsupported" };
    }

    const notificationOptions: ConstructorParameters<typeof Notification>[0] = {
      title: normalizedTitle || appName,
      body,
      silent: Boolean(input.silent),
    };

    if (subtitle) {
      notificationOptions.subtitle = subtitle;
    }

    if (urgency) {
      notificationOptions.urgency = urgency;
    }

    const icon = createNotificationIcon();
    if (icon) {
      notificationOptions.icon = icon;
    }

    const notification = new Notification(notificationOptions);
    if (showOptions?.onClick) {
      notification.on("click", () => {
        showOptions.onClick?.();
      });
    }
    notification.show();
    app.dock?.bounce("informational");
    return { shown: true, delivery: "electron" };
  }

  return {
    show,
  };
}
