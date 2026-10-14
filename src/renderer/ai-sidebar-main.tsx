import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bot,
  History,
  Pause,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { normalizeLanguageSetting, resolveLocale } from "@/lib/i18n";
import type {
  AgentSessionListItem,
  AgentSessionSnapshot,
  AgentSubAgentDetails,
} from "@/types/agent";
import { AgentMessageMarkdown } from "@/components/agent/agent-message-markdown";
import { AgentSubAgentDetailsBlock as SharedSubAgentDetailsBlock, type SubAgentLabelMap } from "@/components/agent/sub-agent-details-block";
import type {
  BrowserBootstrapData,
  WindowSummary,
} from "@/types/workspace";
import "./ai-sidebar.css";

const messages = {
  "en-US": {
    title: "Milo AI",
    idle: "Idle",
    running: "Running",
    waiting_event: "Waiting",
    queued: "Queued",
    runningHint: "Agent is running...",
    waitingHint: "Agent is waiting for a browser event...",
    queuedHint: "Agent run is queued...",
    error: "Error",
    interrupted: "Interrupted",
    emptyTitle: "Ask Milo about this page",
    emptyBody: "Milo can inspect the active tab, operate the page, and turn useful workflows into reusable scripts.",
    newChat: "New chat",
    historyTitle: "Site history",
    restoreChat: "Restore",
    deleteChat: "Delete",
    deleteConfirm: "Delete this agent history item?",
    placeholder: "Ask Milo to inspect this page, automate steps, or write a user script...",
    send: "Send",
    pauseAgent: "Pause agent",
    pauseFailed: "Failed to pause agent session.",
    deleteFailed: "Failed to delete agent session.",
    createFailed: "Failed to start agent session.",
    sendFailed: "Failed to send message.",
    bootstrapFailed: "Failed to read browser context.",
    thinkingLabel: "Thinking",
    subAgentDetailsTitle: "Sub-agent details",
    subAgentTaskLabel: "Task",
    subAgentExtractionLabel: "Extraction",
    subAgentBookmarkLabel: "Bookmark organizer",
    subAgentImageLabel: "Image recognition",
    subAgentUserScriptLabel: "User script",
    subAgentWidgetBuilderLabel: "Widget builder",
    subAgentStatusPending: "Pending",
    subAgentStatusRunning: "Running",
    subAgentStatusCompleted: "Completed",
    subAgentStatusNeedsUser: "Needs user",
    subAgentStatusBlocked: "Blocked",
    subAgentStatusFailed: "Failed",
    subAgentStatusCancelled: "Cancelled",
    subAgentStarted: "Started",
    subAgentFinished: "Finished",
    subAgentTab: "Tab",
    subAgentWindow: "Window",
    subAgentStartUrl: "Start URL",
    subAgentConflictPolicy: "Policy",
    subAgentResourceKey: "Resource",
    subAgentSummary: "Summary",
    subAgentNextStep: "Next step",
    subAgentError: "Error",
    subAgentSteps: "Steps",
    subAgentResult: "Result",
    subAgentDuration: "Duration",
  },
  "zh-CN": {
    title: "Milo AI",
    idle: "空闲",
    running: "执行中",
    waiting_event: "等待事件",
    queued: "排队中",
    runningHint: "Agent 正在运行...",
    waitingHint: "Agent 正在等待浏览器事件...",
    queuedHint: "Agent 任务已排队...",
    error: "错误",
    interrupted: "已中断",
    emptyTitle: "向 Milo 询问当前页面",
    emptyBody: "Milo 可以检查当前标签页、操作页面，并把有价值的流程沉淀为可复用脚本。",
    newChat: "新对话",
    historyTitle: "站点历史",
    restoreChat: "恢复",
    deleteChat: "删除",
    deleteConfirm: "删除这条 Agent 历史记录？",
    placeholder: "让 Milo 检查当前页面、自动执行步骤，或编写 user-script...",
    send: "发送",
    pauseAgent: "暂停 Agent",
    pauseFailed: "暂停 Agent 会话失败。",
    deleteFailed: "删除 Agent 会话失败。",
    createFailed: "启动 Agent 会话失败。",
    sendFailed: "发送消息失败。",
    bootstrapFailed: "读取浏览器上下文失败。",
    thinkingLabel: "思考",
    subAgentDetailsTitle: "子 Agent 详情",
    subAgentTaskLabel: "任务",
    subAgentExtractionLabel: "数据提取",
    subAgentBookmarkLabel: "书签整理",
    subAgentImageLabel: "图片识别",
    subAgentUserScriptLabel: "用户脚本",
    subAgentWidgetBuilderLabel: "小组件构建",
    subAgentStatusPending: "等待中",
    subAgentStatusRunning: "运行中",
    subAgentStatusCompleted: "已完成",
    subAgentStatusNeedsUser: "需要用户",
    subAgentStatusBlocked: "已阻塞",
    subAgentStatusFailed: "失败",
    subAgentStatusCancelled: "已取消",
    subAgentStarted: "开始",
    subAgentFinished: "结束",
    subAgentTab: "标签页",
    subAgentWindow: "窗口",
    subAgentStartUrl: "起始 URL",
    subAgentConflictPolicy: "策略",
    subAgentResourceKey: "资源",
    subAgentSummary: "摘要",
    subAgentNextStep: "下一步",
    subAgentError: "错误",
    subAgentSteps: "步骤",
    subAgentResult: "结果",
    subAgentDuration: "耗时",
  },
} as const;

type LocaleKey = keyof typeof messages;
type MessageKey = keyof (typeof messages)["en-US"];

function getInitialWindowId() {
  const params = new URLSearchParams(window.location.search);
  const rawWindowId = Number(params.get("windowId"));
  return Number.isFinite(rawWindowId) && rawWindowId > 0 ? rawWindowId : null;
}

function getInitialTabId() {
  const params = new URLSearchParams(window.location.search);
  const tabId = params.get("tabId")?.trim();
  return tabId || null;
}

function getTabStateKey(tabId: string) {
  return `milo:ai-sidebar:${tabId}`;
}

function getSiteStateKey(siteKey: string) {
  return `milo:ai-sidebar:site:${siteKey}`;
}

function getUrlSiteKey(url: string | undefined) {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    const hostname = parsed.hostname.trim().toLowerCase().replace(/^www\./, "");
    return hostname || null;
  } catch {
    return null;
  }
}

function getSessionSiteKey(session: AgentSessionSnapshot | AgentSessionListItem | null | undefined) {
  return getUrlSiteKey(session?.context.originUrl);
}

function readSavedState(storageKey: string) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as { sessionId?: unknown; input?: unknown };
    return {
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : undefined,
      input: typeof parsed.input === "string" ? parsed.input : undefined,
    };
  } catch {
    return {};
  }
}

function readSavedTabState(tabId: string) {
  return readSavedState(getTabStateKey(tabId));
}

function readSavedSiteState(siteKey: string) {
  return readSavedState(getSiteStateKey(siteKey));
}

function writeSavedTabState(tabId: string, input: { sessionId?: string | null; text?: string }) {
  try {
    const current = readSavedTabState(tabId);
    const nextSessionId = input.sessionId === undefined
      ? current.sessionId
      : input.sessionId ?? undefined;
    window.localStorage.setItem(
      getTabStateKey(tabId),
      JSON.stringify({
        ...(nextSessionId ? { sessionId: nextSessionId } : {}),
        input: input.text ?? current.input ?? "",
      }),
    );
  } catch {
    // Ignore storage failures in private or restricted contexts.
  }
}

function writeSavedSiteState(siteKey: string, input: { sessionId?: string | null; text?: string }) {
  try {
    const current = readSavedSiteState(siteKey);
    const nextSessionId = input.sessionId === undefined
      ? current.sessionId
      : input.sessionId ?? undefined;
    window.localStorage.setItem(
      getSiteStateKey(siteKey),
      JSON.stringify({
        ...(nextSessionId ? { sessionId: nextSessionId } : {}),
        input: input.text ?? current.input ?? "",
      }),
    );
  } catch {
    // Ignore storage failures in private or restricted contexts.
  }
}

function resolveTargetWindow(
  bootstrap: BrowserBootstrapData | null,
  targetWindowId: number | null,
) {
  if (!bootstrap) {
    return null;
  }

  return bootstrap.windows.find((windowRecord) => windowRecord.id === targetWindowId)
    ?? bootstrap.currentWindow
    ?? null;
}

function resolveTargetWorkspace(
  bootstrap: BrowserBootstrapData | null,
  targetWindow: WindowSummary | null,
) {
  if (!bootstrap) {
    return null;
  }

  return bootstrap.workspaces.find((workspace) => workspace.id === targetWindow?.workspaceId)
    ?? bootstrap.currentWorkspace
    ?? null;
}

function getStatusMessageKey(status?: AgentSessionSnapshot["status"]): MessageKey {
  switch (status) {
    case "running":
      return "running";
    case "waiting_event":
      return "waiting_event";
    case "queued":
      return "queued";
    case "error":
      return "error";
    case "interrupted":
      return "interrupted";
    case "idle":
    default:
      return "idle";
  }
}

function getActivityMessageKey(status?: AgentSessionSnapshot["status"]): MessageKey | null {
  switch (status) {
    case "running":
      return "runningHint";
    case "waiting_event":
      return "waitingHint";
    case "queued":
      return "queuedHint";
    default:
      return null;
  }
}

function isAgentExecutingStatus(status: AgentSessionSnapshot["status"] | null | undefined) {
  return status === "running"
    || status === "waiting_event"
    || status === "queued";
}

function SidebarSubAgentLabels({ locale, t }: { locale: LocaleKey; t: (key: MessageKey) => string }): SubAgentLabelMap {
  return {
    detailsTitle: t("subAgentDetailsTitle"),
    taskLabel: t("subAgentTaskLabel"),
    extractionLabel: t("subAgentExtractionLabel"),
    bookmarkLabel: t("subAgentBookmarkLabel"),
    imageLabel: t("subAgentImageLabel"),
    userScriptLabel: t("subAgentUserScriptLabel"),
    widgetBuilderLabel: t("subAgentWidgetBuilderLabel"),
    statusPending: t("subAgentStatusPending"),
    statusRunning: t("subAgentStatusRunning"),
    statusCompleted: t("subAgentStatusCompleted"),
    statusNeedsUser: t("subAgentStatusNeedsUser"),
    statusBlocked: t("subAgentStatusBlocked"),
    statusFailed: t("subAgentStatusFailed"),
    statusCancelled: t("subAgentStatusCancelled"),
    started: t("subAgentStarted"),
    finished: t("subAgentFinished"),
    duration: t("subAgentDuration"),
    tab: t("subAgentTab"),
    window: t("subAgentWindow"),
    startUrl: t("subAgentStartUrl"),
    conflictPolicy: t("subAgentConflictPolicy"),
    resourceKey: t("subAgentResourceKey"),
    summary: t("subAgentSummary"),
    nextStep: t("subAgentNextStep"),
    error: t("subAgentError"),
    steps: t("subAgentSteps"),
    result: t("subAgentResult"),
  };
}

function getSystemPrefersLight() {
  return typeof window !== "undefined"
    && window.matchMedia("(prefers-color-scheme: light)").matches;
}

function AiSidebarPage() {
  const [targetWindowId, setTargetWindowId] = useState<number | null>(getInitialWindowId);
  const [targetTabId, setTargetTabId] = useState<string | null>(getInitialTabId);
  const [bootstrap, setBootstrap] = useState<BrowserBootstrapData | null>(null);
  const [theme, setTheme] = useState("system");
  const [language, setLanguage] = useState("system");
  const [systemPrefersLight, setSystemPrefersLight] = useState(getSystemPrefersLight);
  const [session, setSession] = useState<AgentSessionSnapshot | null>(null);
  const [siteSessions, setSiteSessions] = useState<AgentSessionListItem[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [agentActionBusy, setAgentActionBusy] = useState<"pause" | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const historyDropdownRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const resolvedTheme = theme === "system"
    ? (systemPrefersLight ? "light" : "dark")
    : theme;
  const resolvedLocale = resolveLocale(
    normalizeLanguageSetting(language),
    typeof navigator !== "undefined" ? navigator.language : "en-US",
  ) as LocaleKey;
  const t = useCallback(
    (key: MessageKey) => messages[resolvedLocale][key],
    [resolvedLocale],
  );
  const targetWindow = useMemo(
    () => resolveTargetWindow(bootstrap, targetWindowId),
    [bootstrap, targetWindowId],
  );
  const targetWorkspace = useMemo(
    () => resolveTargetWorkspace(bootstrap, targetWindow),
    [bootstrap, targetWindow],
  );
  const activeTab = targetWindow?.tabs.find((tab) => tab.id === targetTabId) ?? null;
  const activeSiteKey = getUrlSiteKey(activeTab?.url ?? activeTab?.displayUrl);
  const activityMessageKey = getActivityMessageKey(session?.status);
  const canPauseSession = isAgentExecutingStatus(session?.status);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: light)");
    const handler = (event: MediaQueryListEvent) => setSystemPrefersLight(event.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    const browserShell = window.browserShell;
    if (!browserShell) {
      return;
    }

    let disposed = false;
    void browserShell.settingsGetTheme()
      .then((nextTheme) => {
        if (!disposed) {
          setTheme(nextTheme);
        }
      })
      .catch(() => undefined);
    void browserShell.settingsGetLanguage()
      .then((nextLanguage) => {
        if (!disposed) {
          setLanguage(nextLanguage);
        }
      })
      .catch(() => undefined);

    const disposeTheme = browserShell.onThemeChanged(setTheme);
    const disposeLanguage = browserShell.onLanguageChanged(setLanguage);

    return () => {
      disposed = true;
      disposeTheme?.();
      disposeLanguage?.();
    };
  }, []);

  useEffect(() => {
    const browserShell = window.browserShell;
    if (!browserShell) {
      setError(t("bootstrapFailed"));
      return;
    }

    let disposed = false;
    void browserShell.getBootstrapData()
      .then((payload) => {
        if (!disposed) {
          setBootstrap(payload);
        }
      })
      .catch(() => {
        if (!disposed) {
          setError(t("bootstrapFailed"));
        }
      });

    const dispose = browserShell.onWorkspaceContext((payload) => {
      setBootstrap(payload);
    });

    return () => {
      disposed = true;
      dispose?.();
    };
  }, [t]);

  useEffect(() => {
    const browserShell = window.browserShell;
    if (!browserShell?.onAgentSessionUpdate) {
      return;
    }

    return browserShell.onAgentSessionUpdate((update) => {
      setSession((current) => {
        if (!current || current.sessionId !== update.sessionId) {
          return current;
        }
        return update.snapshot;
      });
    });
  }, []);

  const rebindSnapshotToActiveTab = useCallback(async (snapshot: AgentSessionSnapshot) => {
    const browserShell = window.browserShell;
    if (
      !browserShell?.agentRebindSessionToTab
      || !targetWorkspace
      || !targetWindow
      || !activeTab?.id
    ) {
      return snapshot;
    }
    const snapshotSiteKey = getSessionSiteKey(snapshot);
    if (activeSiteKey && snapshotSiteKey && snapshotSiteKey !== activeSiteKey) {
      return snapshot;
    }
    try {
      return await browserShell.agentRebindSessionToTab({
        sessionId: snapshot.sessionId,
        workspaceId: targetWorkspace.id,
        windowId: targetWindow.id,
        tabId: activeTab.id,
      });
    } catch {
      return snapshot;
    }
  }, [activeSiteKey, activeTab?.id, targetWindow, targetWorkspace]);

  useEffect(() => {
    const browserShell = window.browserShell;
    if (!browserShell?.agentGetSession || !targetTabId) {
      setSession(null);
      setSiteSessions([]);
      return;
    }

    const savedTab = readSavedTabState(targetTabId);
    const savedSite = activeSiteKey ? readSavedSiteState(activeSiteKey) : {};
    setInput(savedTab.input ?? savedSite.input ?? "");

    let disposed = false;
    const sessionMatchesCurrentContext = (snapshot: AgentSessionSnapshot | null) => {
      if (!snapshot) {
        return false;
      }
      if (
        targetTabId
        && (
          snapshot.context.activeTabId === targetTabId
          || snapshot.context.originTabId === targetTabId
        )
      ) {
        return true;
      }
      return Boolean(activeSiteKey && getSessionSiteKey(snapshot) === activeSiteKey);
    };
    const loadSession = async () => {
      if (!activeSiteKey) {
        if (!disposed) {
          setSiteSessions([]);
        }
      } else if (browserShell.agentListSessions && targetWorkspace && targetWindow) {
        const allSessions = await browserShell.agentListSessions({
          workspaceId: targetWorkspace.id,
          windowId: targetWindow.id,
        });
        const matchingSiteSessions = allSessions.filter((item) =>
          item.messageCount > 0 && getSessionSiteKey(item) === activeSiteKey);
        if (!disposed) {
          setSiteSessions(matchingSiteSessions);
        }
      }

      const tabSession = browserShell.agentGetSessionForTab
        ? await browserShell.agentGetSessionForTab({
            ...(targetWindowId ? { windowId: targetWindowId } : {}),
            tabId: targetTabId,
          })
        : null;

      if (tabSession && sessionMatchesCurrentContext(tabSession)) {
        return tabSession;
      }

      return null;
    };

    void loadSession()
      .then((snapshot) => {
        if (disposed) {
          return;
        }
        setSession((current) => {
          if (snapshot) {
            return snapshot;
          }
          return sessionMatchesCurrentContext(current) ? current : null;
        });
      })
      .catch(() => {
        if (!disposed) {
          setSession((current) => sessionMatchesCurrentContext(current) ? current : null);
        }
      });

    return () => {
      disposed = true;
    };
  }, [activeSiteKey, rebindSnapshotToActiveTab, targetTabId, targetWindow?.id, targetWindowId, targetWorkspace?.id]);

  useEffect(() => {
    const activeSessionId = session?.sessionId && (
      activeSiteKey && getSessionSiteKey(session) === activeSiteKey
    )
      ? session.sessionId
      : null;
    if (targetTabId) {
      writeSavedTabState(targetTabId, { sessionId: activeSessionId });
    }
    if (activeSiteKey) {
      writeSavedSiteState(activeSiteKey, { sessionId: null });
    }
  }, [activeSiteKey, session?.context.originUrl, session?.sessionId, targetTabId]);

  useEffect(() => {
    if (
      session?.sessionId
      && activeSiteKey
      && session.context.activeTabId !== targetTabId
      && session.context.originTabId !== targetTabId
      && getSessionSiteKey(session) !== activeSiteKey
    ) {
      setSession(null);
    }
  }, [
    activeSiteKey,
    session?.context.activeTabId,
    session?.context.originTabId,
    session?.context.originUrl,
    session?.sessionId,
    targetTabId,
  ]);

  useEffect(() => {
    if (targetTabId) {
      writeSavedTabState(targetTabId, { text: input });
    }
    if (activeSiteKey) {
      writeSavedSiteState(activeSiteKey, { text: input });
    }
  }, [activeSiteKey, input, targetTabId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session?.messages.length, session?.status]);

  const closeSidebar = useCallback(() => {
    if (isClosing) {
      return;
    }

    setIsClosing(true);
    window.setTimeout(() => {
      void window.browserShell?.aiSidebarClose({ windowId: targetWindowId, tabId: targetTabId });
    }, 240);
  }, [isClosing, targetTabId, targetWindowId]);

  useEffect(() => {
    const browserShell = window.browserShell;
    if (!browserShell?.onAiSidebarStateChanged) {
      return;
    }

    return browserShell.onAiSidebarStateChanged((state) => {
      if (state.visible) {
        setTargetWindowId(state.windowId);
        setTargetTabId(state.tabId);
        setIsClosing(false);
      }
    });
  }, []);

  useEffect(() => {
    const browserShell = window.browserShell;
    if (!browserShell?.onAiSidebarCloseRequested) {
      return;
    }

    return browserShell.onAiSidebarCloseRequested(closeSidebar);
  }, [closeSidebar]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeSidebar();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeSidebar]);

  useEffect(() => {
    if (!showHistory) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (historyDropdownRef.current && !historyDropdownRef.current.contains(event.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showHistory]);

  const sendMessage = useCallback(async (contentOverride?: string) => {
    const browserShell = window.browserShell;
    if (!browserShell || !targetWorkspace || !targetWindow || !targetTabId) {
      setError(t("createFailed"));
      return;
    }

    const content = (contentOverride ?? input).trim();
    if (!content || isSending) {
      return;
    }

    setError(null);
    setIsSending(true);
    setInput("");

    const reusableSession = session?.sessionId ? session : null;
    try {
      const nextSession = reusableSession
        ? await browserShell.agentSendMessage({
            sessionId: reusableSession.sessionId,
            content,
          })
        : await browserShell.agentCreateSession({
            workspaceId: targetWorkspace.id,
            windowId: targetWindow.id,
            scope: "current-tab",
            tabId: targetTabId,
            content,
            privacyMode: false,
            profile: "default",
          });
      setSession(nextSession);
    } catch (err) {
      setError(err instanceof Error ? err.message : t(reusableSession ? "sendFailed" : "createFailed"));
    } finally {
      setIsSending(false);
    }
  }, [input, isSending, session, t, targetTabId, targetWindow, targetWorkspace]);

  const startNewChat = useCallback(() => {
    setSession(null);
    setInput("");
    setError(null);
    if (targetTabId) {
      try {
        window.localStorage.removeItem(getTabStateKey(targetTabId));
      } catch {
        // Ignore storage failures.
      }
    }
    if (activeSiteKey) {
      try {
        window.localStorage.removeItem(getSiteStateKey(activeSiteKey));
      } catch {
        // Ignore storage failures.
      }
    }
  }, [activeSiteKey, targetTabId]);

  const restoreSession = useCallback(async (sessionId: string) => {
    const browserShell = window.browserShell;
    if (!browserShell?.agentGetSession) {
      return;
    }
    const snapshot = await browserShell.agentGetSession(sessionId);
    if (snapshot) {
      setSession(await rebindSnapshotToActiveTab(snapshot));
      setError(null);
    }
  }, [rebindSnapshotToActiveTab]);

  const deleteHistorySession = useCallback(async (item: AgentSessionListItem) => {
    const browserShell = window.browserShell;
    if (!browserShell?.agentDeleteSession || deletingSessionId) {
      return;
    }

    const sessionId = item.sessionId;
    if (!window.confirm(`${t("deleteConfirm")}\n${item.title}`)) {
      return;
    }

    setDeletingSessionId(sessionId);
    setError(null);
    try {
      const result = await browserShell.agentDeleteSession(sessionId);
      if (result.deleted) {
        setSiteSessions((current) => current.filter((item) => item.sessionId !== sessionId));
        setSession((current) => current?.sessionId === sessionId ? null : current);
        if (targetTabId && readSavedTabState(targetTabId).sessionId === sessionId) {
          writeSavedTabState(targetTabId, { sessionId: null });
        }
        if (activeSiteKey && readSavedSiteState(activeSiteKey).sessionId === sessionId) {
          writeSavedSiteState(activeSiteKey, { sessionId: null });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("deleteFailed"));
    } finally {
      setDeletingSessionId((current) => current === sessionId ? null : current);
    }
  }, [activeSiteKey, deletingSessionId, targetTabId, t]);

  const pauseSession = useCallback(async () => {
    const browserShell = window.browserShell;
    if (
      !browserShell?.agentInterruptSession
      || !session?.sessionId
      || agentActionBusy
      || !isAgentExecutingStatus(session.status)
    ) {
      return;
    }

    setAgentActionBusy("pause");
    setError(null);
    try {
      const snapshot = await browserShell.agentInterruptSession(session.sessionId);
      setSession(snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("pauseFailed"));
    } finally {
      setAgentActionBusy((current) => current === "pause" ? null : current);
    }
  }, [agentActionBusy, session, t]);

  const visibleSiteSessions = siteSessions.filter((item) => item.sessionId !== session?.sessionId).slice(0, 5);

  return (
    <div className={`ai-sidebar-shell${isClosing ? " closing" : ""}`}>
      <aside className="ai-sidebar-panel">
        <header className="ai-sidebar-header">
          <div className="ai-glow" />
          <div className="ai-header-row">
            <div className="ai-title-group">
              <span className="ai-avatar">
                <Bot size={16} />
              </span>
              <div className="ai-title-copy">
                <h1>{t("title")}</h1>
                <p>{t(getStatusMessageKey(session?.status))}</p>
              </div>
            </div>
            <div className="ai-header-actions">
              {visibleSiteSessions.length > 0 ? (
                <div className="ai-history-dropdown-wrap" ref={historyDropdownRef}>
                  <button
                    className={`ai-icon-button${showHistory ? " active" : ""}`}
                    onClick={() => setShowHistory((prev) => !prev)}
                    type="button"
                    aria-label={t("historyTitle")}
                  >
                    <History size={16} />
                  </button>
                  {showHistory ? (
                    <div className="ai-history-dropdown">
                      <div className="ai-history-dropdown-title">{t("historyTitle")}</div>
                      {visibleSiteSessions.map((item) => (
                        <div
                          className="ai-history-dropdown-item"
                          key={item.sessionId}
                        >
                          <button
                            className="ai-history-restore"
                            disabled={deletingSessionId === item.sessionId}
                            onClick={() => {
                              void restoreSession(item.sessionId);
                              setShowHistory(false);
                            }}
                            type="button"
                          >
                            <span className="ai-history-copy">
                              <strong>{item.title}</strong>
                              <small>{item.preview}</small>
                            </span>
                            <span className="ai-history-action">{t("restoreChat")}</span>
                          </button>
                          <button
                            aria-label={t("deleteChat")}
                            className="ai-history-delete"
                            disabled={deletingSessionId !== null}
                            onClick={() => {
                              void deleteHistorySession(item);
                            }}
                            title={t("deleteChat")}
                            type="button"
                          >
                            {deletingSessionId === item.sessionId
                              ? <RefreshCw className="spin" size={14} />
                              : <Trash2 size={14} />}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <button className="ai-icon-button" onClick={closeSidebar} type="button">
                <X size={16} />
              </button>
            </div>
          </div>
        </header>

        <section className="ai-message-list">
          {!session || session.messages.length === 0 ? (
            <div className="ai-empty-state">
              <Sparkles size={26} />
              <h2>{t("emptyTitle")}</h2>
              <p>{t("emptyBody")}</p>
            </div>
          ) : (
            <div className="ai-message-stack">
              {session.messages.map((message) => (
                <div
                  className={`ai-message-row ${message.role}`}
                  key={message.id}
                >
                  <div className={`ai-message-bubble ${message.role}`}>
                    {message.toolName ? (
                      <div className="ai-tool-name">{message.toolName}</div>
                    ) : null}
                    {message.thinkingContent ? (
                      <details className="ai-thinking-details">
                        <summary>{t("thinkingLabel")}</summary>
                        <AgentMessageMarkdown
                          className="ai-thinking-content ai-message-markdown"
                          content={message.thinkingContent}
                        />
                      </details>
                    ) : null}
                    {message.content.trim() ? (
                      <AgentMessageMarkdown
                        className="ai-message-content ai-message-markdown"
                        content={message.content}
                      />
                    ) : null}
                    {message.subAgentDetails ? (
                      <SharedSubAgentDetailsBlock
                        classPrefix="ai-subagent"
                        details={message.subAgentDetails}
                        labels={SidebarSubAgentLabels({ locale: resolvedLocale, t })}
                        locale={resolvedLocale}
                      />
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
          {activityMessageKey ? (
            <div className="ai-running-indicator" aria-live="polite">
              <RefreshCw className="spin" size={14} />
              <span>{t(activityMessageKey)}</span>
              <span className="ai-running-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </div>
          ) : null}
          <div ref={messagesEndRef} />
        </section>

        {error ? (
          <div className="ai-error">
            {error}
          </div>
        ) : null}

        <footer className="ai-composer">
          <div className="ai-composer-meta">
            <button onClick={startNewChat} type="button">
              {t("newChat")}
            </button>
            <span>{activeTab?.title ?? ""}</span>
          </div>
          <div className="ai-input-wrap">
            <textarea
              onChange={(event) => setInput(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder={t("placeholder")}
              rows={2}
              value={input}
            />
            {canPauseSession ? (
              <button
                aria-label={t("pauseAgent")}
                className="ai-input-action-button ai-input-pause-button"
                disabled={agentActionBusy !== null}
                onClick={() => void pauseSession()}
                title={t("pauseAgent")}
                type="button"
              >
                {agentActionBusy ? <RefreshCw className="spin" size={16} /> : <Pause size={16} />}
              </button>
            ) : null}
            <button
              aria-label={t("send")}
              className="ai-input-action-button"
              disabled={isSending || !input.trim()}
              onClick={() => void sendMessage()}
              type="button"
            >
              {isSending ? <RefreshCw className="spin" size={16} /> : <Send size={16} />}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <AiSidebarPage />
    </React.StrictMode>,
  );
}
