import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Download,
  FolderOpen,
  Inbox,
  LoaderCircle,
  PackageOpen,
  Plus,
  Trash2,
} from "lucide-react";

type Locale = "en-US" | "zh-CN";
type StatusTone = "ok" | "err";

const SETTINGS_STORAGE_KEY = "milo.settings.v1";

const I18N = {
  "en-US": {
    pageTitle: "Widget Packages",
    heroTitle: "Widget Packages",
    heroBody:
      "Install, inspect, and remove local start page widget packages. These packages are available through widget://package/<id>.",
    shellMissing: "browserShell API is unavailable on this page. Please restart the app.",
    loadFailed: "Failed to load widget packages.",
    loading: "Loading widget packages…",
    installPackage: "Install Widget Package",
    installPackageFailed: "Failed to install the widget package.",
    openRootDirectory: "Open Widgets Folder",
    openRootDirectoryFailed: "Failed to open the widgets folder.",
    createStarterPackage: "Create Starter Package",
    createStarterPackageFailed: "Failed to create the starter widget package.",
    copyProtocol: "Copy Protocol",
    protocolCopied: "Protocol source copied.",
    copyProtocolFailed: "Failed to copy the protocol source.",
    revealFiles: "Open Package Folder",
    revealFilesFailed: "Failed to open the widget package folder.",
    remove: "Remove",
    removeFailed: "Failed to remove the widget package.",
    removeConfirm: "Remove widget package \"{name}\"?",
    replaceConfirm:
      "Widget package \"{name}\" ({id}) already exists. Replace the installed package with this folder?",
    statusInstalled: "Widget package installed.",
    statusRemoved: "Widget package removed.",
    statusStarterCreated: "Starter widget package created.",
    rootCardTitle: "Widgets Directory",
    rootCardBody:
      "Packages placed here can be referenced from the start page protocol modal and the widget runtime.",
    rootPathLabel: "Location",
    rootCountChip: "{count} packages",
    rootProtocolHint: "Protocol",
    emptyTitle: "No widget packages",
    emptyBody: "Install a local folder with widget.json, or create a starter package to begin development.",
    emptyCreateAction: "Create Starter Package",
    emptyInstallAction: "Install Package",
    packageNoDescription: "No description provided.",
    packageIdLabel: "Package ID",
    packageEntryLabel: "Entry",
    packageProtocolLabel: "Protocol",
    packageDefaultTitleLabel: "Default title",
    packagePermissionsLabel: "Permissions",
    manifestTitle: "Manifest",
    showManifest: "Show Manifest",
    hideManifest: "Hide Manifest",
    permissionNetwork: "Network",
    permissionOpenExternal: "Open external",
    permissionNone: "No extra permissions",
    sizeChip: "{w}×{h}",
  },
  "zh-CN": {
    pageTitle: "小组件包",
    heroTitle: "小组件包",
    heroBody:
      "用于安装、查看和移除本地起始页小组件包。安装后可通过 widget://package/<id> 直接引用。",
    shellMissing: "当前页面缺少 browserShell API，请重启应用后重试。",
    loadFailed: "加载小组件包失败。",
    loading: "正在加载小组件包…",
    installPackage: "安装小组件包",
    installPackageFailed: "安装小组件包失败。",
    openRootDirectory: "打开 widgets 目录",
    openRootDirectoryFailed: "打开 widgets 目录失败。",
    createStarterPackage: "创建示例包",
    createStarterPackageFailed: "创建示例包失败。",
    copyProtocol: "复制协议地址",
    protocolCopied: "协议地址已复制。",
    copyProtocolFailed: "复制协议地址失败。",
    revealFiles: "打开包目录",
    revealFilesFailed: "打开小组件包目录失败。",
    remove: "删除",
    removeFailed: "删除小组件包失败。",
    removeConfirm: "确认删除小组件包「{name}」吗？",
    replaceConfirm:
      "已存在同名小组件包「{name}」（{id}）。是否用当前目录覆盖已安装版本？",
    statusInstalled: "小组件包已安装。",
    statusRemoved: "小组件包已删除。",
    statusStarterCreated: "示例小组件包已创建。",
    rootCardTitle: "Widgets 目录",
    rootCardBody:
      "这里的包可直接被起始页协议组件和 widget runtime 引用。",
    rootPathLabel: "目录位置",
    rootCountChip: "{count} 个包",
    rootProtocolHint: "协议格式",
    emptyTitle: "当前还没有小组件包",
    emptyBody: "可以安装带 widget.json 的本地目录，或者先创建一个示例包开始开发。",
    emptyCreateAction: "创建示例包",
    emptyInstallAction: "安装小组件包",
    packageNoDescription: "这个包还没有描述。",
    packageIdLabel: "包 ID",
    packageEntryLabel: "入口文件",
    packageProtocolLabel: "协议地址",
    packageDefaultTitleLabel: "默认标题",
    packagePermissionsLabel: "权限",
    manifestTitle: "Manifest",
    showManifest: "查看 Manifest",
    hideManifest: "收起 Manifest",
    permissionNetwork: "网络访问",
    permissionOpenExternal: "打开外部链接",
    permissionNone: "无额外权限",
    sizeChip: "{w}×{h}",
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

function buildProtocolSource(widgetPackage: WidgetPackageSummary) {
  return `widget://package/${widgetPackage.id}`;
}

function buildFallbackManifest(widgetPackage: WidgetPackageSummary): WidgetPackageManifest {
  return {
    defaultSize: {
      h: widgetPackage.defaultSize.h,
      w: widgetPackage.defaultSize.w,
    },
    defaultTitle: widgetPackage.defaultTitle,
    description: widgetPackage.description,
    entry: widgetPackage.entry,
    id: widgetPackage.id,
    name: widgetPackage.name,
    permissions: {
      network: widgetPackage.permissions.network,
      openExternal: widgetPackage.permissions.openExternal,
    },
    version: widgetPackage.version,
  };
}

function formatManifest(manifest: WidgetPackageManifest | null | undefined) {
  return JSON.stringify(manifest ?? {}, null, 2);
}

export function WidgetsPage() {
  const [locale, setLocale] = useState<Locale>(() => resolveLocale(readStoredSettings().language));
  const [packages, setPackages] = useState<WidgetPackageSummary[]>([]);
  const [manifests, setManifests] = useState<Record<string, WidgetPackageManifest | null>>({});
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<StatusTone | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const [toastTone, setToastTone] = useState<StatusTone | null>(null);
  const [installing, setInstalling] = useState(false);
  const [creatingStarter, setCreatingStarter] = useState(false);
  const [busyPackageIds, setBusyPackageIds] = useState<string[]>([]);
  const [expandedManifestIds, setExpandedManifestIds] = useState<string[]>([]);

  const t = useCallback(
    (
      key: keyof (typeof I18N)["en-US"],
      vars?: Record<string, string | number>,
    ) => formatMessage(locale, key, vars),
    [locale],
  );

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

  const refreshPackages = useCallback(
    async (options?: {
      silent?: boolean;
      failureFallbackKey?: keyof (typeof I18N)["en-US"];
    }) => {
      const browserShell = window.browserShell;
      if (
        !browserShell?.widgetRegistryListPackages
        || !browserShell.widgetRegistryGetRootDirectory
      ) {
        setLoading(false);
        setStatus(t("shellMissing"), "err");
        return false;
      }

      try {
        const [nextRootDirectory, nextPackages] = await Promise.all([
          browserShell.widgetRegistryGetRootDirectory(),
          browserShell.widgetRegistryListPackages(),
        ]);

        const nextManifestEntries = browserShell.widgetRegistryGetPackageManifest
          ? await Promise.all(
            nextPackages.map(async (widgetPackage) => [
              widgetPackage.id,
              await browserShell.widgetRegistryGetPackageManifest(widgetPackage.id),
            ] as const),
          )
          : [];

        setPackages(nextPackages);
        setManifests(Object.fromEntries(nextManifestEntries));
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

    void refreshPackages({
      silent: true,
      failureFallbackKey: "loadFailed",
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

    return () => {
      disposed = true;
      disposeTheme();
      disposeLanguage();
    };
  }, [refreshPackages, setStatus, t]);

  function beginBusy(packageId: string) {
    setBusyPackageIds((current) => Array.from(new Set([...current, packageId])));
  }

  function endBusy(packageId: string) {
    setBusyPackageIds((current) => current.filter((candidate) => candidate !== packageId));
  }

  function isBusy(packageId: string) {
    return busyPackageIds.includes(packageId);
  }

  function toggleManifest(packageId: string) {
    setExpandedManifestIds((current) =>
      current.includes(packageId)
        ? current.filter((candidate) => candidate !== packageId)
        : [...current, packageId]);
  }

  async function handleInstallPackage() {
    const browserShell = window.browserShell;
    if (
      !browserShell?.widgetRegistryPickPackageDirectory
      || !browserShell.widgetRegistryInspectPackageDirectory
      || !browserShell.widgetRegistryInstallPackageFromDirectory
    ) {
      showToast(t("installPackageFailed"), "err");
      return;
    }

    setInstalling(true);
    try {
      const selectedPath = await browserShell.widgetRegistryPickPackageDirectory();
      if (!selectedPath) {
        return;
      }

      const inspectedPackage = await browserShell.widgetRegistryInspectPackageDirectory(selectedPath);
      const installedPackage = packages.find((candidate) => candidate.id === inspectedPackage.id);
      if (installedPackage) {
        const confirmed = window.confirm(
          t("replaceConfirm", {
            id: installedPackage.id,
            name: installedPackage.name,
          }),
        );
        if (!confirmed) {
          return;
        }
      }

      await browserShell.widgetRegistryInstallPackageFromDirectory(selectedPath);
      const reloaded = await refreshPackages({ silent: true });
      if (reloaded) {
        showToast(t("statusInstalled"), "ok");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("installPackageFailed"), "err");
    } finally {
      setInstalling(false);
    }
  }

  async function handleCreateStarterPackage() {
    const browserShell = window.browserShell;
    if (!browserShell?.widgetRegistryCreateStarterPackage) {
      showToast(t("createStarterPackageFailed"), "err");
      return;
    }

    setCreatingStarter(true);
    try {
      const nextPackage = await browserShell.widgetRegistryCreateStarterPackage();
      const reloaded = await refreshPackages({ silent: true });
      if (reloaded) {
        setExpandedManifestIds((current) => Array.from(new Set([...current, nextPackage.id])));
        showToast(t("statusStarterCreated"), "ok");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("createStarterPackageFailed"), "err");
    } finally {
      setCreatingStarter(false);
    }
  }

  async function handleRevealRootDirectory() {
    const browserShell = window.browserShell;
    if (!browserShell?.widgetRegistryRevealRootDirectory) {
      showToast(t("openRootDirectoryFailed"), "err");
      return;
    }

    try {
      await browserShell.widgetRegistryRevealRootDirectory();
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("openRootDirectoryFailed"), "err");
    }
  }

  async function handleRevealPackage(widgetPackage: WidgetPackageSummary) {
    const browserShell = window.browserShell;
    if (!browserShell?.widgetRegistryRevealPackage) {
      showToast(t("revealFilesFailed"), "err");
      return;
    }

    beginBusy(widgetPackage.id);
    try {
      await browserShell.widgetRegistryRevealPackage(widgetPackage.id);
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("revealFilesFailed"), "err");
    } finally {
      endBusy(widgetPackage.id);
    }
  }

  async function handleRemovePackage(widgetPackage: WidgetPackageSummary) {
    const browserShell = window.browserShell;
    if (!browserShell?.widgetRegistryRemovePackage) {
      showToast(t("removeFailed"), "err");
      return;
    }

    const confirmed = window.confirm(
      t("removeConfirm", {
        name: widgetPackage.name,
      }),
    );
    if (!confirmed) {
      return;
    }

    beginBusy(widgetPackage.id);
    try {
      await browserShell.widgetRegistryRemovePackage(widgetPackage.id);
      const reloaded = await refreshPackages({ silent: true });
      if (reloaded) {
        showToast(t("statusRemoved"), "ok");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("removeFailed"), "err");
    } finally {
      endBusy(widgetPackage.id);
    }
  }

  return (
    <main className="page">
      <header className="hero">
        <div>
          <h1>{t("heroTitle")}</h1>
          <p>{t("heroBody")}</p>
        </div>

        <div className="hero-actions">
          <button
            className="workspace-top-action"
            disabled={creatingStarter}
            onClick={() => {
              void handleCreateStarterPackage();
            }}
            title={t("createStarterPackage")}
            type="button"
          >
            {creatingStarter ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </button>

          <button
            className="workspace-top-action"
            disabled={installing}
            onClick={() => {
              void handleInstallPackage();
            }}
            title={t("installPackage")}
            type="button"
          >
            {installing ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
          </button>

          <button
            className="workspace-top-action"
            onClick={() => {
              void handleRevealRootDirectory();
            }}
            title={t("openRootDirectory")}
            type="button"
          >
            <FolderOpen className="h-4 w-4" />
          </button>
        </div>
      </header>

      {statusMessage && statusTone === "err" ? (
        <p className="status err" style={{ padding: "0 40px" }}>
          {statusMessage}
        </p>
      ) : null}

      <section className="workspace-grid widget-manager-grid custom-scrollbar">
        {loading ? (
          <article className="workspace-card widget-manager-card widget-manager-card-fill widget-manager-empty">
            <div className="widget-manager-empty-icon">
              <LoaderCircle className="h-6 w-6 animate-spin" />
            </div>
            <h2>{t("loading")}</h2>
          </article>
        ) : null}

        {!loading && packages.length === 0 ? (
          <article className="workspace-card widget-manager-card widget-manager-card-fill widget-manager-empty">
            <div className="widget-manager-empty-icon">
              <Inbox className="h-7 w-7" />
            </div>
            <h2>{t("emptyTitle")}</h2>
            <p>{t("emptyBody")}</p>
            <div className="widget-manager-empty-actions">
              <button
                className="widget-manager-empty-action"
                disabled={creatingStarter}
                onClick={() => {
                  void handleCreateStarterPackage();
                }}
                type="button"
              >
                {creatingStarter ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <PackageOpen className="h-4 w-4" />
                )}
                <span>{t("emptyCreateAction")}</span>
              </button>
              <button
                className="widget-manager-empty-action"
                disabled={installing}
                onClick={() => {
                  void handleInstallPackage();
                }}
                type="button"
              >
                {installing ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <FolderOpen className="h-4 w-4" />
                )}
                <span>{t("emptyInstallAction")}</span>
              </button>
            </div>
          </article>
        ) : null}

        {!loading && packages.length > 0
          ? packages.map((widgetPackage) => {
            const protocolSource = buildProtocolSource(widgetPackage);
            const manifest = manifests[widgetPackage.id] ?? buildFallbackManifest(widgetPackage);
            const permissions = [
              widgetPackage.permissions.network ? t("permissionNetwork") : "",
              widgetPackage.permissions.openExternal ? t("permissionOpenExternal") : "",
            ].filter(Boolean);
            return (
              <article className="workspace-card widget-manager-card" key={widgetPackage.id}>
                <div className="widget-manager-card-header">
                  <div className="min-w-0">
                    <div className="widget-manager-card-title-row">
                      <h2>{widgetPackage.name}</h2>
                      <span className="workspace-badge workspace-badge-current">
                        {`v${widgetPackage.version}`}
                      </span>
                      <span className="workspace-badge widget-manager-badge">
                        {t("sizeChip", {
                          h: widgetPackage.defaultSize.h,
                          w: widgetPackage.defaultSize.w,
                        })}
                      </span>
                    </div>

                    <p className="widget-manager-card-copy">
                      {widgetPackage.description || t("packageNoDescription")}
                    </p>
                  </div>

                  <div className="workspace-top-actions">
                    <button
                      className="workspace-top-action"
                      disabled={isBusy(widgetPackage.id)}
                      onClick={() => {
                        void handleRevealPackage(widgetPackage);
                      }}
                      title={t("revealFiles")}
                      type="button"
                    >
                      {isBusy(widgetPackage.id) ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <FolderOpen className="h-4 w-4" />
                      )}
                    </button>

                    <button
                      className="workspace-top-delete"
                      disabled={isBusy(widgetPackage.id)}
                      onClick={() => {
                        void handleRemovePackage(widgetPackage);
                      }}
                      title={t("remove")}
                      type="button"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="widget-manager-meta-list">
                  <div>
                    <dt>{t("packageIdLabel")}</dt>
                    <dd>{widgetPackage.id}</dd>
                  </div>
                  <div>
                    <dt>{t("packageEntryLabel")}</dt>
                    <dd>{widgetPackage.entry}</dd>
                  </div>
                  <div>
                    <dt>{t("packageProtocolLabel")}</dt>
                    <dd>{protocolSource}</dd>
                  </div>
                  <div>
                    <dt>{t("packageDefaultTitleLabel")}</dt>
                    <dd>{widgetPackage.defaultTitle}</dd>
                  </div>
                  <div>
                    <dt>{t("packagePermissionsLabel")}</dt>
                    <dd>{permissions.length > 0 ? permissions.join(" · ") : t("permissionNone")}</dd>
                  </div>
                </div>

                <div className="widget-manager-actions">
                  <button
                    className="widget-manager-action"
                    onClick={() => {
                      toggleManifest(widgetPackage.id);
                    }}
                    type="button"
                  >
                    {expandedManifestIds.includes(widgetPackage.id) ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                    <span>
                      {expandedManifestIds.includes(widgetPackage.id)
                        ? t("hideManifest")
                        : t("showManifest")}
                    </span>
                  </button>
                </div>

                {expandedManifestIds.includes(widgetPackage.id) ? (
                  <div className="widget-manager-manifest-wrap">
                    <p className="widget-manager-manifest-title">{t("manifestTitle")}</p>
                    <pre className="widget-manager-manifest">
                      {formatManifest(manifest)}
                    </pre>
                  </div>
                ) : null}
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
