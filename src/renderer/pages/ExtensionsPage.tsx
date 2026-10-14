import { useCallback, useEffect, useState } from "react";
import {
  ExternalLink,
  FolderOpen,
  LoaderCircle,
  Puzzle,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from "lucide-react";
import type { BrowserExtensionSummary } from "@/types/extensions";
import type { BrowserBootstrapData } from "@/types/workspace";

const SETTINGS_STORAGE_KEY = "milo.settings.v1";
const CHROME_WEB_STORE_EXTENSIONS_URL = "https://chromewebstore.google.com/category/extensions";

type Locale = "en-US" | "zh-CN";
type StatusTone = "ok" | "err";

const I18N = {
  "en-US": {
    pageTitle: "Extensions",
    heroTitle: "Extensions",
    heroBody:
      "Manage installed extensions here, open the Chrome Web Store, or load local unpacked extensions directly from the toolbar.",
    shellMissing: "browserShell API is unavailable on this page. Please restart the app.",
    loadFailed: "Failed to load extension data.",
    loading: "Loading extensions…",
    loadUnpacked: "Load Unpacked Extension",
    loadUnpackedFailed: "Failed to load unpacked extension.",
    openStore: "Chrome Web Store",
    openStoreFailed: "Failed to open the Chrome Web Store.",
    revealFiles: "Reveal Files",
    remove: "Remove",
    enable: "Enable",
    disable: "Disable",
    reload: "Reload",
    removeConfirm: "Remove extension \"{name}\" from this profile?",
    removeFailed: "Failed to remove the extension.",
    revealFailed: "Failed to reveal the extension files.",
    enableFailed: "Failed to update extension state.",
    reloadFailed: "Failed to reload the extension.",
    sourceStore: "Chrome Web Store",
    sourceLocal: "Local unpacked",
    loaded: "Loaded",
    notLoaded: "Not loaded",
    enabled: "Enabled",
    disabled: "Disabled",
    installedAt: "Installed",
    emptyTitle: "No extensions",
    emptyBody:
      "Use the top-right buttons to open the Chrome Web Store or load a local unpacked extension directory.",
    statusInstalled: "Extension installed.",
    statusRemoved: "Extension removed.",
    statusUpdated: "Extension state updated.",
    statusReloaded: "Extension reloaded.",
    loadErrorLabel: "Load error",
  },
  "zh-CN": {
    pageTitle: "扩展程序",
    heroTitle: "扩展程序",
    heroBody:
      "这里用于管理已安装扩展，右上角可以打开 Chrome 商店或直接加载本地未打包的扩展程序。",
    shellMissing: "当前页面缺少 browserShell API，请重启应用后重试。",
    loadFailed: "加载扩展数据失败。",
    loading: "正在加载扩展…",
    loadUnpacked: "加载未打包的扩展程序",
    loadUnpackedFailed: "加载已解压扩展失败。",
    openStore: "Chrome 商店",
    openStoreFailed: "打开 Chrome 商店失败。",
    revealFiles: "打开文件位置",
    remove: "移除",
    enable: "启用",
    disable: "停用",
    reload: "重新加载",
    removeConfirm: "确定从当前 profile 移除扩展“{name}”吗？",
    removeFailed: "移除扩展失败。",
    revealFailed: "打开扩展文件位置失败。",
    enableFailed: "更新扩展状态失败。",
    reloadFailed: "重新加载扩展失败。",
    sourceStore: "Chrome 商店",
    sourceLocal: "本地解压",
    loaded: "已加载",
    notLoaded: "未加载",
    enabled: "已启用",
    disabled: "已停用",
    installedAt: "安装时间",
    emptyTitle: "当前还没有扩展",
    emptyBody: "可以通过右上角按钮打开 Chrome 商店，或直接加载本地未打包的扩展程序目录。",
    statusInstalled: "扩展已安装。",
    statusRemoved: "扩展已移除。",
    statusUpdated: "扩展状态已更新。",
    statusReloaded: "扩展已重新加载。",
    loadErrorLabel: "加载错误",
  },
} as const;

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
  if (normalized === "zh" || normalized === "zh-cn" || normalized === "zh-hans") {
    return "zh-CN";
  }
  if (normalized === "en" || normalized === "en-us") {
    return "en-US";
  }
  return "system";
}

function resolveLocale(languageSetting: unknown): Locale {
  const normalizedLanguage = normalizeLanguage(languageSetting);
  if (normalizedLanguage === "zh-CN" || normalizedLanguage === "en-US") {
    return normalizedLanguage;
  }

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
  key: keyof (typeof I18N)["en-US"],
  vars?: Record<string, string | number>,
) {
  const template = I18N[locale][key] ?? key;
  if (!vars) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_match, name) => String(vars[name] ?? ""));
}

function formatDate(locale: Locale, value: number) {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString();
  }
}

export function ExtensionsPage() {
  const [locale, setLocale] = useState<Locale>(() => resolveLocale(readStoredSettings().language));
  const [bootstrap, setBootstrap] = useState<BrowserBootstrapData | null>(null);
  const [extensions, setExtensions] = useState<BrowserExtensionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<StatusTone | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const [toastTone, setToastTone] = useState<StatusTone | null>(null);
  const [storeOpening, setStoreOpening] = useState(false);
  const [unpackedInstalling, setUnpackedInstalling] = useState(false);
  const [busyExtensionIds, setBusyExtensionIds] = useState<string[]>([]);

  const t = useCallback(
    (
      key: keyof (typeof I18N)["en-US"],
      vars?: Record<string, string | number>,
    ) => formatMessage(locale, key, vars),
    [locale],
  );

  const currentProfileId = bootstrap?.currentWorkspace.profileId ?? "";

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t("pageTitle");
  }, [locale, t]);

  useEffect(() => {
    if (!toastMessage) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setToastMessage("");
      setToastTone(null);
    }, 4200);
    return () => window.clearTimeout(timeoutId);
  }, [toastMessage]);

  const setStatus = useCallback((message: string, tone: StatusTone | null) => {
    setStatusMessage(message);
    setStatusTone(tone);
  }, []);

  const showToast = useCallback((message: string, tone: StatusTone) => {
    setStatus("", null);
    setToastMessage(message);
    setToastTone(tone);
  }, [setStatus]);

  const refreshExtensions = useCallback(
    async (options?: {
      silent?: boolean;
      failureFallbackKey?: keyof (typeof I18N)["en-US"];
    }) => {
      const browserShell = window.browserShell;
      if (!browserShell) {
        setLoading(false);
        setStatus(t("shellMissing"), "err");
        return false;
      }

      try {
        const [nextBootstrap, nextExtensions] = await Promise.all([
          browserShell.getBootstrapData(),
          browserShell.extensionsList(),
        ]);
        setBootstrap(nextBootstrap);
        setExtensions(nextExtensions);
        setLoading(false);

        if (options?.silent) {
          setStatus("", null);
        }
        return true;
      } catch (error) {
        setLoading(false);
        const message = error instanceof Error
          ? error.message
          : t(options?.failureFallbackKey ?? "loadFailed");

        if (options?.silent) {
          setStatus(message, "err");
        } else {
          showToast(message, "err");
        }
        return false;
      }
    },
    [setStatus, showToast, t],
  );

  useEffect(() => {
    applyTheme(readStoredSettings().theme);

    const browserShell = window.browserShell;
    if (!browserShell) {
      setLoading(false);
      setStatus(t("shellMissing"), "err");
      return;
    }

    let disposed = false;

    void refreshExtensions({
      silent: true,
      failureFallbackKey: "loadFailed",
    });

    const disposeWorkspaceContext = browserShell.onWorkspaceContext((payload) => {
      if (!disposed) {
        setBootstrap(payload);
      }
    });

    const disposeTheme = browserShell.onThemeChanged((theme) => {
      if (!disposed) {
        applyTheme(theme);
      }
    });

    const disposeLanguage = browserShell.onLanguageChanged((language) => {
      if (!disposed) {
        setLocale(resolveLocale(language));
      }
    });

    const disposeExtensionsChanged = browserShell.onExtensionsChanged((payload) => {
      if (disposed) {
        return;
      }

      if (!currentProfileId || payload.profileId === currentProfileId) {
        void refreshExtensions({ silent: true });
      }
    });

    return () => {
      disposed = true;
      disposeWorkspaceContext();
      disposeTheme();
      disposeLanguage();
      disposeExtensionsChanged();
    };
  }, [currentProfileId, refreshExtensions, t]);

  function beginBusy(extensionId: string) {
    setBusyExtensionIds((current) => Array.from(new Set([...current, extensionId])));
  }

  function endBusy(extensionId: string) {
    setBusyExtensionIds((current) => current.filter((candidate) => candidate !== extensionId));
  }

  async function handleLoadUnpacked() {
    if (!window.browserShell) {
      return;
    }

    setUnpackedInstalling(true);
    try {
      const selectedPath = await window.browserShell.extensionsPickUnpackedDirectory();
      if (!selectedPath) {
        return;
      }
      await window.browserShell.extensionsInstallUnpacked(selectedPath);
      const reloaded = await refreshExtensions({ silent: true });
      if (reloaded) {
        showToast(t("statusInstalled"), "ok");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("loadUnpackedFailed"), "err");
    } finally {
      setUnpackedInstalling(false);
    }
  }

  async function handleOpenChromeWebStore() {
    const currentWindowId = bootstrap?.currentWindow.id;
    if (!window.browserShell || !currentWindowId) {
      setStatus(t("shellMissing"), "err");
      return;
    }

    setStoreOpening(true);
    try {
      await window.browserShell.tabCreate(currentWindowId, CHROME_WEB_STORE_EXTENSIONS_URL);
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("openStoreFailed"), "err");
    } finally {
      setStoreOpening(false);
    }
  }

  async function handleToggleExtension(extension: BrowserExtensionSummary) {
    if (!window.browserShell) {
      return;
    }

    beginBusy(extension.id);
    try {
      await window.browserShell.extensionsSetEnabled(extension.id, !extension.enabled);
      const reloaded = await refreshExtensions({ silent: true });
      if (reloaded) {
        showToast(t("statusUpdated"), "ok");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("enableFailed"), "err");
    } finally {
      endBusy(extension.id);
    }
  }

  async function handleRemoveExtension(extension: BrowserExtensionSummary) {
    if (!window.browserShell) {
      return;
    }

    const confirmed = window.confirm(
      t("removeConfirm", {
        name: extension.name,
      }),
    );
    if (!confirmed) {
      return;
    }

    beginBusy(extension.id);
    try {
      await window.browserShell.extensionsRemove(extension.id);
      const reloaded = await refreshExtensions({ silent: true });
      if (reloaded) {
        showToast(t("statusRemoved"), "ok");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("removeFailed"), "err");
    } finally {
      endBusy(extension.id);
    }
  }

  async function handleRevealExtension(extension: BrowserExtensionSummary) {
    if (!window.browserShell) {
      return;
    }

    beginBusy(extension.id);
    try {
      await window.browserShell.extensionsReveal(extension.id);
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("revealFailed"), "err");
    } finally {
      endBusy(extension.id);
    }
  }

  async function handleReloadExtension(extension: BrowserExtensionSummary) {
    if (!window.browserShell) {
      return;
    }

    beginBusy(extension.id);
    try {
      await window.browserShell.extensionsReload(extension.id);
      const reloaded = await refreshExtensions({ silent: true });
      if (reloaded) {
        showToast(t("statusReloaded"), "ok");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("reloadFailed"), "err");
    } finally {
      endBusy(extension.id);
    }
  }

  const isBusy = (extensionId: string) => busyExtensionIds.includes(extensionId);

  return (
    <main className="page">
      <header className="hero">
        <div>
          <h1>{t("heroTitle")}</h1>
          <p>{t("heroBody")}</p>
        </div>

        <div className="hero-actions">
          <button
            className="extension-hero-action"
            disabled={storeOpening || !bootstrap}
            onClick={() => {
              void handleOpenChromeWebStore();
            }}
            title={t("openStore")}
            type="button"
          >
            {storeOpening ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <ExternalLink className="h-4 w-4" />
            )}
            <span>{t("openStore")}</span>
          </button>

          <button
            className="extension-hero-action"
            disabled={unpackedInstalling}
            onClick={() => {
              void handleLoadUnpacked();
            }}
            type="button"
          >
            {unpackedInstalling ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <FolderOpen className="h-4 w-4" />
            )}
            <span>{t("loadUnpacked")}</span>
          </button>
        </div>
      </header>

      {statusMessage && statusTone === "err" ? (
        <p className="status err" style={{ padding: "0 40px" }}>
          {statusMessage}
        </p>
      ) : null}

      <section className="workspace-grid extensions-grid custom-scrollbar">
        {loading ? (
          <article className="workspace-card extension-card extension-card-fill extension-card-empty">
            <LoaderCircle className="h-5 w-5 animate-spin" />
            <h2>{t("loading")}</h2>
          </article>
        ) : null}

        {!loading && extensions.length === 0 ? (
          <article className="workspace-card extension-card extension-card-fill extension-card-empty">
            <Puzzle className="h-5 w-5" />
            <h2>{t("emptyTitle")}</h2>
            <p>{t("emptyBody")}</p>
          </article>
        ) : null}

        {!loading && extensions.length > 0
          ? extensions.map((extension) => {
            const busy = isBusy(extension.id);
            return (
              <article className="workspace-card extension-card" key={extension.id}>
                <div className="extension-card-title-row">
                  <h2>{extension.name}</h2>
                  <span
                    className={[
                      "workspace-badge",
                      extension.enabled
                        ? "workspace-badge-current"
                        : "extension-badge-disabled",
                    ].join(" ")}
                  >
                    {extension.enabled ? t("enabled") : t("disabled")}
                  </span>
                </div>

                {extension.description ? (
                  <p className="extension-card-copy">{extension.description}</p>
                ) : null}

                {extension.lastError ? (
                  <p className="extension-card-error">
                    {t("loadErrorLabel")}: {extension.lastError}
                  </p>
                ) : null}

                <div className="extension-card-footer">
                  <div className="extension-card-actions">
                    <button
                      className="extension-action-icon"
                      disabled={busy}
                      onClick={() => {
                        void handleToggleExtension(extension);
                      }}
                      title={extension.enabled ? t("disable") : t("enable")}
                      type="button"
                    >
                      {busy ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : extension.enabled ? (
                        <ToggleRight className="h-4 w-4" />
                      ) : (
                        <ToggleLeft className="h-4 w-4" />
                      )}
                    </button>

                    <button
                      className="extension-action-icon"
                      disabled={busy}
                      onClick={() => {
                        void handleReloadExtension(extension);
                      }}
                      title={t("reload")}
                      type="button"
                    >
                      {busy ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </button>

                    <button
                      className="extension-action-icon"
                      disabled={busy}
                      onClick={() => {
                        void handleRevealExtension(extension);
                      }}
                      title={t("revealFiles")}
                      type="button"
                    >
                      <FolderOpen className="h-4 w-4" />
                    </button>

                    <button
                      className="extension-action-icon extension-action-delete"
                      disabled={busy}
                      onClick={() => {
                        void handleRemoveExtension(extension);
                      }}
                      title={t("remove")}
                      type="button"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </article>
            );
          })
          : null}
      </section>

      {toastMessage ? (
        <div className="page-toast-host">
          <div className={["page-toast", toastTone === "err" ? "err" : "ok"].join(" ")}>
            {toastMessage}
          </div>
        </div>
      ) : null}
    </main>
  );
}
