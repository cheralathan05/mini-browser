import { useEffect, useRef, useState } from "react";

const SETTINGS_STORAGE_KEY = "milo.settings.v1";

type Locale = "en-US" | "zh-CN";
type StatusTone = "ok" | "err";

interface DownloadPreferences {
  defaultDirectory: string;
  defaultThreadCount: number;
  defaultHeadersText: string;
}

const I18N = {
  "en-US": {
    pageTitle: "Downloads",
    heroTitle: "Downloads",
    noRecords: "No downloads yet",
    shellMissing: "browserShell API is unavailable on this page. Please restart the app.",
    openDialog: "Create download",
    dialogTitle: "Create Download",
    dialogDesc: "Only the target is entered here. Threading and disguise headers come from Settings.",
    dialogUrlLabel: "Download URL",
    dialogFilenameLabel: "Filename (Optional)",
    dialogUrlPlaceholder: "https://example.com/file.zip",
    dialogFilenamePlaceholder: "Leave empty to infer automatically",
    dialogSummaryDirectoryLabel: "Save to",
    dialogSummaryThreadsLabel: "Threads",
    dialogSummaryHeadersLabel: "Headers",
    createDownload: "Start download",
    cancelDialog: "Cancel",
    urlRequired: "Download URL is required.",
    createSuccess: "Download task created.",
    createFailed: "Failed to create download task.",
    statusPending: "Queued",
    statusRunning: "Downloading",
    statusPaused: "Paused",
    statusCompleted: "Completed",
    statusFailed: "Failed",
    statusCanceled: "Canceled",
    bytesUnknown: "Unknown size",
    fileMissing: "File missing",
    sourceBrowser: "Browser download",
    sourceManual: "Manual task",
    rangesOn: "Multi-thread enabled",
    rangesOff: "Single stream fallback",
    createdAtLabel: "Created",
    headerCount: "{count} headers",
    headerCountOne: "1 header",
    threadCount: "{count} threads",
    threadCountOne: "1 thread",
    removeAll: "Remove All",
    removeAllConfirm: "Remove all download records?",
    removeAllSuccess: "All download records removed.",
    removeAllFailed: "Failed to remove all download records.",
    openFolder: "Open Folder",
    copyLinkSuccess: "Link copied.",
    copyLinkFailed: "Failed to copy link.",
  },
  "zh-CN": {
    pageTitle: "下载内容",
    heroTitle: "下载内容",
    noRecords: "暂无下载任务",
    shellMissing: "当前页面缺少 browserShell API，请重启应用后重试。",
    openDialog: "新建下载",
    dialogTitle: "新建下载",
    dialogDesc: "这里只填写下载目标，线程数和伪装 headers 使用 settings 页中的默认值。",
    dialogUrlLabel: "下载 URL",
    dialogFilenameLabel: "文件名（可选）",
    dialogUrlPlaceholder: "https://example.com/file.zip",
    dialogFilenamePlaceholder: "留空则自动推断",
    dialogSummaryDirectoryLabel: "保存到",
    dialogSummaryThreadsLabel: "线程数",
    dialogSummaryHeadersLabel: "Headers",
    createDownload: "开始下载",
    cancelDialog: "取消",
    urlRequired: "下载 URL 不能为空。",
    createSuccess: "已创建下载任务。",
    createFailed: "创建下载任务失败。",
    statusPending: "排队中",
    statusRunning: "下载中",
    statusPaused: "已暂停",
    statusCompleted: "已完成",
    statusFailed: "失败",
    statusCanceled: "已取消",
    bytesUnknown: "大小未知",
    fileMissing: "文件已不存在",
    sourceBrowser: "浏览器触发",
    sourceManual: "手动任务",
    rangesOn: "已启用多线程",
    rangesOff: "已回退为单连接",
    createdAtLabel: "创建于",
    headerCount: "{count} 个 headers",
    headerCountOne: "1 个 header",
    threadCount: "{count} 线程",
    threadCountOne: "1 线程",
    removeAll: "移除全部",
    removeAllConfirm: "确定移除全部下载记录吗？",
    removeAllSuccess: "已移除全部下载记录。",
    removeAllFailed: "移除全部下载记录失败。",
    openFolder: "打开文件夹",
    copyLinkSuccess: "链接已复制。",
    copyLinkFailed: "复制链接失败。",
  },
} as const;

type I18nKey = keyof (typeof I18N)["en-US"];

function readStoredSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function normalizeLanguage(value: unknown) {
  const normalized = String(value ?? "system").trim().toLowerCase();
  if (normalized === "zh" || normalized === "zh-cn" || normalized === "zh-hans") return "zh-CN";
  if (normalized === "en" || normalized === "en-us") return "en-US";
  return "system";
}

function resolveLocale(languageSetting: unknown): Locale {
  const normalized = normalizeLanguage(languageSetting);
  if (normalized === "zh-CN" || normalized === "en-US") return normalized;
  const systemLanguage = String(navigator.language || "en-US").toLowerCase();
  return systemLanguage.startsWith("zh") ? "zh-CN" : "en-US";
}

function applyTheme(themeSetting: unknown) {
  const normalizedTheme = String(themeSetting ?? "system").trim().toLowerCase();
  const theme =
    normalizedTheme === "dark" || normalizedTheme === "light"
      ? normalizedTheme
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  document.documentElement.setAttribute("data-theme", theme);
}

function formatMessage(
  locale: Locale,
  key: I18nKey,
  vars?: Record<string, string | number>,
) {
  const template = I18N[locale][key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_match, name) => String(vars[name] ?? ""));
}

function formatBytes(bytes: number, t: (key: I18nKey) => string) {
  if (!Number.isFinite(bytes) || bytes < 0) return t("bytesUnknown");
  const units = ["B", "KB", "MB", "GB", "TB"];
  let index = 0;
  let value = bytes;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return (
    (value >= 10 || index === 0 ? value.toFixed(index === 0 ? 0 : 1) : value.toFixed(2)) +
    " " +
    units[index]
  );
}

function formatSpeed(bytesPerSecond: number, t: (key: I18nKey) => string) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "";
  return formatBytes(bytesPerSecond, t) + "/s";
}

function formatTimestamp(timestamp: number, locale: Locale) {
  if (!Number.isFinite(timestamp)) return "";
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString(locale);
  }
}

function headerCountText(count: number, t: (key: I18nKey, vars?: Record<string, string | number>) => string) {
  if (count === 1) return t("headerCountOne");
  return t("headerCount", { count });
}

function threadCountText(count: number, t: (key: I18nKey, vars?: Record<string, string | number>) => string) {
  if (count === 1) return t("threadCountOne");
  return t("threadCount", { count });
}

function statusText(status: DownloadRecord["status"], t: (key: I18nKey) => string) {
  if (status === "running") return t("statusRunning");
  if (status === "paused") return t("statusPaused");
  if (status === "completed") return t("statusCompleted");
  if (status === "failed") return t("statusFailed");
  if (status === "canceled") return t("statusCanceled");
  return t("statusPending");
}

function formatProgress(record: DownloadRecord, t: (key: I18nKey) => string) {
  const totalBytes = record.totalBytes;
  if (totalBytes == null || !Number.isFinite(totalBytes) || totalBytes <= 0) {
    return { percent: null, label: formatBytes(record.receivedBytes, t) };
  }
  const percent = Math.max(0, Math.min(100, (record.receivedBytes / totalBytes) * 100));
  return {
    percent,
    label: formatBytes(record.receivedBytes, t) + " / " + formatBytes(totalBytes, t),
  };
}

export function DownloadsPage() {
  const [locale, setLocale] = useState<Locale>(() => resolveLocale(readStoredSettings().language));
  const [records, setRecords] = useState<DownloadRecord[]>([]);
  const [preferences, setPreferences] = useState<DownloadPreferences>({
    defaultDirectory: "",
    defaultThreadCount: 4,
    defaultHeadersText: "",
  });
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<StatusTone | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const [toastTone, setToastTone] = useState<StatusTone | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const [filenameValue, setFilenameValue] = useState("");
  const [creating, setCreating] = useState(false);
  const [removingAll, setRemovingAll] = useState(false);

  const urlInputRef = useRef<HTMLInputElement>(null);

  const t = (
    key: I18nKey,
    vars?: Record<string, string | number>,
  ) => formatMessage(locale, key, vars);

  function setStatus(message: string, tone: StatusTone | null) {
    setStatusMessage(message);
    setStatusTone(tone);
  }

  function showToast(message: string, tone: StatusTone) {
    setStatusMessage("");
    setStatusTone(null);
    setToastMessage(message);
    setToastTone(tone);
  }

  async function reloadState() {
    const shell = window.browserShell;
    if (!shell) return;
    const payload = await shell.downloadsGetState();
    setRecords(Array.isArray(payload.records) ? payload.records : []);
  }

  async function reloadPreferences() {
    const shell = window.browserShell;
    if (!shell) return;
    const prefs = await shell.downloadsGetPreferences();
    setPreferences({
      defaultDirectory: prefs.defaultDirectory || "",
      defaultThreadCount: Number.isFinite(prefs.defaultThreadCount) ? prefs.defaultThreadCount : 4,
      defaultHeadersText: String(prefs.defaultHeadersText || ""),
    });
  }

  // Init + event subscriptions
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t("pageTitle");
    applyTheme(readStoredSettings().theme);

    const shell = window.browserShell;
    if (!shell) {
      setStatus(t("shellMissing"), "err");
      return;
    }

    let disposed = false;

    void Promise.all([reloadState(), reloadPreferences()]).catch((error) => {
      if (disposed) return;
      setStatus(error instanceof Error ? error.message : t("createFailed"), "err");
    });

    if (shell.settingsGetLanguage) {
      void shell.settingsGetLanguage().then((nextLanguage) => {
        if (disposed) return;
        setLocale(resolveLocale(nextLanguage));
      }).catch(() => { /* ignore */ });
    }

    const handleDownloadsChanged = () => {
      if (!disposed) void reloadState();
    };

    const handleFocus = () => {
      if (!disposed) void reloadPreferences().catch(() => {});
    };

    window.addEventListener("downloads:changed", handleDownloadsChanged);
    window.addEventListener("focus", handleFocus);

    let disposeTheme: (() => void) | undefined;
    let disposeLanguage: (() => void) | undefined;

    if (shell.onThemeChanged) {
      disposeTheme = shell.onThemeChanged((theme: unknown) => {
        if (!disposed) applyTheme(theme);
      });
    }

    if (shell.onLanguageChanged) {
      disposeLanguage = shell.onLanguageChanged((language: unknown) => {
        if (!disposed) setLocale(resolveLocale(language));
      });
    }

    return () => {
      disposed = true;
      window.removeEventListener("downloads:changed", handleDownloadsChanged);
      window.removeEventListener("focus", handleFocus);
      disposeTheme?.();
      disposeLanguage?.();
    };
  }, []);

  // Update document when locale changes
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t("pageTitle");
  }, [locale]);

  useEffect(() => {
    if (!toastMessage) return;
    const timeoutId = window.setTimeout(() => {
      setToastMessage("");
      setToastTone(null);
    }, 4200);
    return () => window.clearTimeout(timeoutId);
  }, [toastMessage]);

  function handleOpenDialog() {
    void reloadPreferences().catch(() => {});
    setDialogOpen(true);
    setTimeout(() => urlInputRef.current?.focus(), 0);
  }

  function handleCloseDialog() {
    setDialogOpen(false);
  }

  async function handleCreateDownload(e: React.FormEvent) {
    e.preventDefault();
    const url = urlValue.trim();
    if (!url) {
      showToast(t("urlRequired"), "err");
      return;
    }

    setCreating(true);
    try {
      await window.browserShell!.downloadsCreate({
        url,
        source: "manual",
        filename: filenameValue.trim() || undefined,
      });
      setUrlValue("");
      setFilenameValue("");
      handleCloseDialog();
      showToast(t("createSuccess"), "ok");
      await reloadState();
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("createFailed"), "err");
    } finally {
      setCreating(false);
    }
  }

  async function handleRemoveAll() {
    if (!window.confirm(t("removeAllConfirm"))) return;

    setRemovingAll(true);
    try {
      const shell = window.browserShell!;
      for (const record of records) {
        await shell.downloadsRemove(record.id, false);
      }
      showToast(t("removeAllSuccess"), "ok");
      await reloadState();
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("removeAllFailed"), "err");
    } finally {
      setRemovingAll(false);
    }
  }

  const sortedRecords = [...records].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const headerLines = String(preferences.defaultHeadersText || "")
    .split(/\n/)
    .filter((line) => line.trim().length > 0).length;

  return (
    <div className="page downloads-page">
      {/* Header */}
      <header className="page-header">
        <div className="header-left">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span>{t("heroTitle")}</span>
        </div>
        <div className="header-actions">
          {statusMessage && statusTone === "err" ? (
            <span
              className={[
                "status",
                "err",
              ].join(" ").trim()}
              aria-live="polite"
            >
              {statusMessage}
            </span>
          ) : null}
          <button
            className="download-create-trigger"
            type="button"
            aria-label={t("openDialog")}
            onClick={handleOpenDialog}
          >
            +
          </button>
          {sortedRecords.length > 0 ? (
            <button
              className="inline-action-btn danger"
              type="button"
              disabled={removingAll}
              onClick={handleRemoveAll}
            >
              {t("removeAll")}
            </button>
          ) : null}
        </div>
      </header>

      {/* Content */}
      <main className="content custom-scrollbar">
        <div className="content-inner">
          <div className="downloads-list">
              {sortedRecords.length === 0 ? (
                <div className="downloads-empty">{t("noRecords")}</div>
              ) : (
                sortedRecords.map((record) => (
                  <DownloadRow
                    key={record.id}
                    record={record}
                    locale={locale}
                    onToast={showToast}
                    t={t}
                  />
                ))
              )}
          </div>
        </div>
      </main>

      {/* Create dialog */}
      {dialogOpen ? (
        <div
          className="download-dialog-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseDialog();
          }}
        >
          <div className="download-dialog">
            <div className="download-dialog-head">
              <div>
                <h2>{t("dialogTitle")}</h2>
                <p>{t("dialogDesc")}</p>
              </div>
              <button
                className="download-dialog-close"
                type="button"
                aria-label="Close"
                onClick={handleCloseDialog}
              >
                ×
              </button>
            </div>

            <form className="download-dialog-form" onSubmit={handleCreateDownload}>
              <label className="download-field">
                <span>{t("dialogUrlLabel")}</span>
                <input
                  ref={urlInputRef}
                  type="text"
                  placeholder={t("dialogUrlPlaceholder")}
                  value={urlValue}
                  onChange={(e) => setUrlValue(e.target.value)}
                />
              </label>

              <label className="download-field">
                <span>{t("dialogFilenameLabel")}</span>
                <input
                  type="text"
                  placeholder={t("dialogFilenamePlaceholder")}
                  value={filenameValue}
                  onChange={(e) => setFilenameValue(e.target.value)}
                />
              </label>

              <div className="download-dialog-summary">
                <div className="download-summary-row">
                  <span>{t("dialogSummaryDirectoryLabel")}</span>
                  <strong>{preferences.defaultDirectory || "-"}</strong>
                </div>
                <div className="download-summary-row">
                  <span>{t("dialogSummaryThreadsLabel")}</span>
                  <strong>
                    {threadCountText(preferences.defaultThreadCount || 1, t)}
                  </strong>
                </div>
                <div className="download-summary-row">
                  <span>{t("dialogSummaryHeadersLabel")}</span>
                  <strong>{headerCountText(headerLines, t)}</strong>
                </div>
              </div>

              <div className="download-dialog-actions">
                <button
                  className="inline-action-btn ghost"
                  type="button"
                  onClick={handleCloseDialog}
                >
                  {t("cancelDialog")}
                </button>
                <button
                  className="inline-action-btn primary"
                  type="submit"
                  disabled={creating}
                >
                  {t("createDownload")}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {toastMessage ? (
        <div className="page-toast-host">
          <div className={["page-toast", toastTone === "err" ? "err" : "ok"].join(" ")}>
            {toastMessage}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ── Download Row ── */

function DownloadRow({
  record,
  locale,
  onToast,
  t,
}: {
  record: DownloadRecord;
  locale: Locale;
  onToast: (message: string, tone: StatusTone) => void;
  t: (key: I18nKey, vars?: Record<string, string | number>) => string;
}) {
  const progress = formatProgress(record, t);
  const isCompleted = record.status === "completed";
  const headerCount = Object.keys(record.headers || {}).length;
  const speed = formatSpeed(record.speedBytesPerSecond, t);
  const primaryParts = [progress.label, speed].filter(Boolean);
  const secondaryParts = [
    threadCountText(record.threadCount > 1 ? record.threadCount : 1, t),
    headerCountText(headerCount, t),
    record.supportsRanges ? t("rangesOn") : t("rangesOff"),
    record.createdAt ? t("createdAtLabel") + " " + formatTimestamp(record.createdAt, locale) : "",
  ].filter(Boolean);
  const sourceLabel = record.source === "browser" ? t("sourceBrowser") : t("sourceManual");
  const downloadLink = record.finalUrl || record.url;

  async function handleCopyLink(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (!downloadLink) {
      return;
    }

    try {
      await navigator.clipboard.writeText(downloadLink);
      onToast(t("copyLinkSuccess"), "ok");
    } catch {
      onToast(t("copyLinkFailed"), "err");
    }
  }

  async function handleOpenFolder() {
    try {
      await window.browserShell?.downloadsShowInFolder(record.id);
    } catch (error) {
      onToast(error instanceof Error ? error.message : t("fileMissing"), "err");
    }
  }

  return (
    <article className={`download-row status-${record.status}`}>
      <div className="download-main">
        <div className="download-title-row">
          <div className="download-title-wrap">
            <div className="download-title">{record.filename || "download"}</div>
            <div className="download-source">{sourceLabel}</div>
          </div>
          <span className={`download-badge status-${record.status}`}>
            {statusText(record.status, t)}
          </span>
        </div>
        <div className="download-progress-row">
          <div className="download-progress-track">
            <span
              style={{
                width: progress.percent == null ? "12%" : `${progress.percent.toFixed(2)}%`,
              }}
            />
          </div>
          {progress.percent != null ? (
            <span className="download-progress-pct">{Math.round(progress.percent)}%</span>
          ) : null}
        </div>
        {primaryParts.length > 0 ? (
          <div className="download-stats-primary">{primaryParts.join(" · ")}</div>
        ) : null}
        <div className="download-footer">
          <a
            className="download-meta download-link"
            href={downloadLink || "#"}
            onClick={(event) => {
              event.preventDefault();
              if (downloadLink) {
                window.open(downloadLink, "_blank");
              }
            }}
            onContextMenu={(event) => {
              void handleCopyLink(event);
            }}
            title={downloadLink || ""}
          >
            {downloadLink || ""}
          </a>
          <button
            className="inline-action-btn ghost"
            onClick={() => {
              void handleOpenFolder();
            }}
            type="button"
          >
            {t("openFolder")}
          </button>
        </div>
        {secondaryParts.length > 0 ? (
          <div className="download-stats-secondary">{secondaryParts.join(" · ")}</div>
        ) : null}
        {record.error ? (
          <div className="download-error">{record.error}</div>
        ) : isCompleted && !record.fileExists ? (
          <div className="download-error">{t("fileMissing")}</div>
        ) : null}
      </div>
    </article>
  );
}
