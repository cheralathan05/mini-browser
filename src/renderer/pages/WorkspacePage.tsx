import { Bot, Eye, EyeOff, Lock, PencilLine, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { BrowserBootstrapData, DeleteWorkspacesResult, WorkspaceSummary } from "@/types/workspace";

const SETTINGS_STORAGE_KEY = "milo.settings.v1";
const DEFAULT_WORKSPACE_ID = "default";

type Locale = "en-US" | "zh-CN";
type StatusTone = "ok" | "err";

const I18N = {
  "en-US": {
    pageTitle: "Workspace",
    heroTitle: "Workspace Manager",
    heroBody:
      "Inspect every workspace, open fresh windows, and remove the ones you no longer need. The default workspace is protected.",
    shellMissing: "browserShell API is unavailable on this page. Please restart the app.",
    loadFailed: "Failed to load workspace data.",
    deleteFailed: "Failed to delete workspace.",
    deleteOneConfirm:
      "Delete workspace \"{name}\"? All windows in this workspace will be closed.",
    deleteSuccess: "Deleted {count} workspace(s).",
    deletePartial: "Deleted {deleted} workspace(s). Skipped {skipped}.",
    deleteSkipped: "No workspaces were deleted.",
    deleteBoundAgent:
      "Workspace \"{workspace}\" is bound to agent \"{agent}\". Delete that agent task first.",
    deleteBoundAgentUnknown:
      "Workspace \"{workspace}\" is bound to an agent task. Delete that agent task first.",
    deletePartialBoundAgent:
      "Deleted {deleted} workspace(s). Workspace \"{workspace}\" is still bound to agent \"{agent}\". Delete that agent task first.",
    deletePartialBoundAgentUnknown:
      "Deleted {deleted} workspace(s). Workspace \"{workspace}\" is still bound to an agent task. Delete that agent task first.",
    delete: "Delete",
    rename: "Rename",
    renamePlaceholder: "Workspace name",
    renameFailed: "Failed to rename workspace.",
    renameSuccess: "Renamed workspace to \"{name}\".",
    renameNameRequired: "Workspace name cannot be empty.",
    protectedLabel: "Protected",
    currentLabel: "Current",
    defaultLabel: "Default",
    automationTag: "Automation",
    freshProfile: "Fresh profile",
    attachedProfile: "Attached to {name}",
    attachedProfileUnknown: "Attached profile",
    automationOff: "Automation off",
    cdpAttached: "CDP attached",
    cdpWaiting: "CDP waiting",
    noWindows: "No windows",
    visibleWindows: "{count} visible window(s)",
    hiddenWindows: "{count} hidden window(s)",
    automationTarget: "Automation target",
    openProfileFailed: "Failed to open profile directory.",
  },
  "zh-CN": {
    pageTitle: "Workspace 管理",
    heroTitle: "Workspace 管理",
    heroBody:
      "这里可以查看全部 workspace、为它们打开新窗口，并删除不再需要的项。默认 workspace 会被保留。",
    shellMissing: "当前页面缺少 browserShell API，请重启应用后重试。",
    loadFailed: "加载 workspace 数据失败。",
    deleteFailed: "删除 workspace 失败。",
    deleteOneConfirm: "确定删除 workspace \"{name}\" 吗？该 workspace 的所有窗口都会被关闭。",
    deleteSuccess: "已删除 {count} 个 workspace。",
    deletePartial: "已删除 {deleted} 个 workspace，跳过 {skipped} 个。",
    deleteSkipped: "没有删除任何 workspace。",
    deleteBoundAgent:
      "workspace “{workspace}” 当前绑定了 agent “{agent}”，请先删除该 agent 任务。",
    deleteBoundAgentUnknown:
      "workspace “{workspace}” 当前绑定了 agent，请先删除对应的 agent 任务。",
    deletePartialBoundAgent:
      "已删除 {deleted} 个 workspace，但 workspace “{workspace}” 仍绑定了 agent “{agent}”，请先删除该 agent 任务。",
    deletePartialBoundAgentUnknown:
      "已删除 {deleted} 个 workspace，但 workspace “{workspace}” 仍绑定了 agent，请先删除对应的 agent 任务。",
    delete: "删除",
    rename: "重命名",
    renamePlaceholder: "Workspace 名称",
    renameFailed: "重命名 workspace 失败。",
    renameSuccess: "已将 workspace 重命名为 \"{name}\"。",
    renameNameRequired: "Workspace 名称不能为空。",
    protectedLabel: "受保护",
    currentLabel: "当前",
    defaultLabel: "默认",
    automationTag: "自动化",
    freshProfile: "独立 profile",
    attachedProfile: "复用自 {name}",
    attachedProfileUnknown: "复用 profile",
    automationOff: "自动化关闭",
    cdpAttached: "CDP 已连接",
    cdpWaiting: "CDP 等待中",
    noWindows: "暂无窗口",
    visibleWindows: "{count} 个可见窗口",
    hiddenWindows: "{count} 个隐藏窗口",
    automationTarget: "自动化目标",
    openProfileFailed: "打开 profile 目录失败。",
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

function isProtectedWorkspace(workspace: WorkspaceSummary) {
  return workspace.id === DEFAULT_WORKSPACE_ID;
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

function getProfileLabel(locale: Locale, workspace: WorkspaceSummary) {
  if (workspace.profileMode === "attached" && workspace.profileSourceWorkspaceName) {
    return formatMessage(locale, "attachedProfile", {
      name: workspace.profileSourceWorkspaceName,
    });
  }

  if (workspace.profileMode === "attached") {
    return formatMessage(locale, "attachedProfileUnknown");
  }

  return formatMessage(locale, "freshProfile");
}

function getAutomationLabel(locale: Locale, workspace: WorkspaceSummary) {
  if (!workspace.automationEnabled) {
    return formatMessage(locale, "automationOff");
  }

  if (workspace.automationAttached) {
    return formatMessage(locale, "cdpAttached");
  }

  return formatMessage(locale, "cdpWaiting");
}

function isAutomationWorkspace(workspace: WorkspaceSummary) {
  return workspace.tags?.includes("automation") ?? false;
}

function getWindowLabel(locale: Locale, workspace: WorkspaceSummary) {
  if (!workspace.hasWindow) {
    return formatMessage(locale, "noWindows");
  }

  if (workspace.windowVisible) {
    return formatMessage(locale, "visibleWindows", { count: workspace.windowCount });
  }

  return formatMessage(locale, "hiddenWindows", { count: workspace.windowCount });
}

export function WorkspacePage() {
  const [locale, setLocale] = useState<Locale>(() => resolveLocale(readStoredSettings().language));
  const [bootstrap, setBootstrap] = useState<BrowserBootstrapData | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<StatusTone | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const [toastTone, setToastTone] = useState<StatusTone | null>(null);
  const [pendingWorkspaceIds, setPendingWorkspaceIds] = useState<string[]>([]);
  const [renamingWorkspaceId, setRenamingWorkspaceId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");

  const t = (
    key: keyof (typeof I18N)["en-US"],
    vars?: Record<string, string | number>,
  ) => formatMessage(locale, key, vars);

  const allWorkspaces = bootstrap?.workspaces ?? [];
  const workspaces = allWorkspaces.filter((workspace) => !isAutomationWorkspace(workspace));
  const currentWorkspaceId = bootstrap?.currentWorkspace.id;

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t("pageTitle");
  }, [locale]);

  useEffect(() => {
    applyTheme(readStoredSettings().theme);

    const browserShell = window.browserShell;
    if (!browserShell) {
      setStatusMessage(t("shellMissing"));
      setStatusTone("err");
      return;
    }

    let disposed = false;

    void browserShell.getBootstrapData()
      .then((payload) => {
        if (disposed) {
          return;
        }

        setBootstrap(payload);
        setStatusMessage("");
        setStatusTone(null);
      })
      .catch((error) => {
        if (disposed) {
          return;
        }

        setStatusMessage(error instanceof Error ? error.message : t("loadFailed"));
        setStatusTone("err");
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

    return () => {
      disposed = true;
      disposeWorkspaceContext();
      disposeTheme();
      disposeLanguage();
    };
  }, []);

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

  function beginPending(workspaceIds: string[]) {
    setPendingWorkspaceIds((current) => Array.from(new Set([...current, ...workspaceIds])));
  }

  function endPending(workspaceIds: string[]) {
    const workspaceIdSet = new Set(workspaceIds);
    setPendingWorkspaceIds((current) =>
      current.filter((workspaceId) => !workspaceIdSet.has(workspaceId)));
  }

  function beginRenameWorkspace(workspace: WorkspaceSummary) {
    setRenamingWorkspaceId(workspace.id);
    setRenameInput(workspace.name);
    setStatus("", null);
  }

  function cancelRenameWorkspace() {
    setRenamingWorkspaceId(null);
    setRenameInput("");
  }

  function applyRenamedWorkspace(nextWorkspace: WorkspaceSummary) {
    setBootstrap((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        currentWorkspace:
          current.currentWorkspace.id === nextWorkspace.id
            ? { ...current.currentWorkspace, ...nextWorkspace }
            : current.currentWorkspace,
        workspaces: current.workspaces.map((workspace) =>
          workspace.id === nextWorkspace.id
            ? { ...workspace, ...nextWorkspace }
            : workspace),
      };
    });
  }

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

  function describeDeleteResult(result: DeleteWorkspacesResult) {
    const boundDetail = result.skippedDetails?.find((detail) => detail.reason === "bound_agent");
    const boundWorkspace = boundDetail
      ? allWorkspaces.find((workspace) => workspace.id === boundDetail.workspaceId)
      : undefined;
    const boundWorkspaceName = boundWorkspace?.name ?? boundDetail?.workspaceId ?? "";

    if (boundDetail) {
      if (result.deletedWorkspaceIds.length > 0) {
        return {
          message: boundDetail.agentTitle
            ? t("deletePartialBoundAgent", {
                deleted: result.deletedWorkspaceIds.length,
                workspace: boundWorkspaceName,
                agent: boundDetail.agentTitle,
              })
            : t("deletePartialBoundAgentUnknown", {
                deleted: result.deletedWorkspaceIds.length,
                workspace: boundWorkspaceName,
              }),
          tone: "err" as const,
        };
      }

      return {
        message: boundDetail.agentTitle
          ? t("deleteBoundAgent", {
              workspace: boundWorkspaceName,
              agent: boundDetail.agentTitle,
            })
          : t("deleteBoundAgentUnknown", {
              workspace: boundWorkspaceName,
            }),
        tone: "err" as const,
      };
    }

    if (result.deletedWorkspaceIds.length === 0) {
      return {
        message: t("deleteSkipped"),
        tone: "err" as const,
      };
    }

    if (result.skippedWorkspaceIds.length > 0) {
      return {
        message: t("deletePartial", {
          deleted: result.deletedWorkspaceIds.length,
          skipped: result.skippedWorkspaceIds.length,
        }),
        tone: "ok" as const,
      };
    }

    return {
      message: t("deleteSuccess", {
        count: result.deletedWorkspaceIds.length,
      }),
      tone: "ok" as const,
    };
  }

  async function handleDeleteSingle(workspace: WorkspaceSummary) {
    if (!window.browserShell || isProtectedWorkspace(workspace)) {
      return;
    }

    const shouldDelete = window.confirm(
      t("deleteOneConfirm", {
        name: workspace.name,
      }),
    );
    if (!shouldDelete) {
      return;
    }

    beginPending([workspace.id]);

    try {
      const result = await window.browserShell.deleteWorkspaces([workspace.id]);
      const outcome = describeDeleteResult(result);
      showToast(outcome.message, outcome.tone);
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("deleteFailed"), "err");
    } finally {
      endPending([workspace.id]);
    }
  }

  async function handleRenameWorkspace(workspace: WorkspaceSummary) {
    if (!window.browserShell) {
      showToast(t("shellMissing"), "err");
      return;
    }

    const nextName = renameInput.trim();
    if (!nextName) {
      showToast(t("renameNameRequired"), "err");
      return;
    }

    if (nextName === workspace.name.trim()) {
      cancelRenameWorkspace();
      return;
    }

    beginPending([workspace.id]);

    try {
      const nextWorkspace = await window.browserShell.renameWorkspace({
        workspaceId: workspace.id,
        name: nextName,
      });
      applyRenamedWorkspace(nextWorkspace);
      cancelRenameWorkspace();
      showToast(t("renameSuccess", { name: nextWorkspace.name }), "ok");
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("renameFailed"), "err");
    } finally {
      endPending([workspace.id]);
    }
  }

  return (
    <main className="page">
      {/* Header */}
      <header className="hero">
        <div>
          <h1>{t("heroTitle")}</h1>
          <p>{t("heroBody")}</p>
        </div>
      </header>

      {statusMessage && statusTone === "err" ? (
        <p className="status err" style={{ padding: "0 40px" }}>
          {statusMessage}
        </p>
      ) : null}

      {/* Workspace grid */}
      <section className="workspace-grid">
        {workspaces.map((workspace) => {
          const isCurrentWorkspace = workspace.id === currentWorkspaceId;
          const isProtected = isProtectedWorkspace(workspace);
          const isBusy = pendingWorkspaceIds.includes(workspace.id);
          const isRenaming = renamingWorkspaceId === workspace.id;

          return (
            <article
              className={[
                "workspace-card",
                isCurrentWorkspace ? "is-current" : "",
              ].join(" ").trim()}
              key={workspace.id}
            >
              {/* Top row: name left, actions right */}
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex flex-wrap items-center gap-2">
                  {isRenaming ? (
                    <input
                      autoFocus
                      className="workspace-rename-input"
                      disabled={isBusy}
                      onChange={(event) => {
                        setRenameInput(event.target.value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void handleRenameWorkspace(workspace);
                          return;
                        }

                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelRenameWorkspace();
                        }
                      }}
                      placeholder={t("renamePlaceholder")}
                      type="text"
                      value={renameInput}
                    />
                  ) : (
                    <h2>{workspace.name}</h2>
                  )}
                  {isCurrentWorkspace ? (
                    <span className="workspace-badge workspace-badge-current">
                      {t("currentLabel")}
                    </span>
                  ) : null}
                  {isProtected ? (
                    <span className="workspace-badge workspace-badge-locked">
                      <Lock className="h-3.5 w-3.5" />
                      {t("defaultLabel")}
                    </span>
                  ) : null}
                </div>

                <div className="workspace-top-actions">
                  {!isRenaming ? (
                    <button
                      className="workspace-top-action"
                      disabled={isBusy}
                      onClick={() => {
                        beginRenameWorkspace(workspace);
                      }}
                      title={t("rename")}
                      type="button"
                    >
                      <PencilLine className="h-4 w-4" />
                    </button>
                  ) : null}
                  {!isProtected ? (
                    <button
                      className="workspace-top-delete"
                      disabled={isBusy}
                      onClick={() => {
                        void handleDeleteSingle(workspace);
                      }}
                      title={t("delete")}
                      type="button"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Bottom row: chips */}
              <div className="workspace-chip-row">
                {isAutomationWorkspace(workspace) ? (
                  <span className="workspace-chip">
                    <Bot className="h-3.5 w-3.5" />
                    {t("automationTag")}
                  </span>
                ) : null}
                <span className="workspace-chip">{getProfileLabel(locale, workspace)}</span>
                <span className="workspace-chip">
                  {workspace.automationEnabled ? (
                    <Bot className="h-3.5 w-3.5" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {getAutomationLabel(locale, workspace)}
                </span>
                <span className="workspace-chip">
                  {workspace.windowVisible ? (
                    <Eye className="h-3.5 w-3.5" />
                  ) : (
                    <EyeOff className="h-3.5 w-3.5" />
                  )}
                  {getWindowLabel(locale, workspace)}
                </span>
              </div>

              {workspace.automationTargetUrl ? (
                <p className="mt-2 truncate text-xs text-[#9aa0a6]">
                  {workspace.automationTargetUrl}
                </p>
              ) : null}
            </article>
          );
        })}
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
