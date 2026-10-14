import { BrowserWindow, WebContentsView } from "electron";
import type {
  CreateTabOptions,
  TabRecord,
  WindowRecord,
  WindowSummary,
  WorkspaceRecord,
  WorkspaceSessionRecord,
} from "../shared/contracts.js";
import {
  clearTabHistoryNavigationWindow,
  shouldHandleTabHistoryNavigation,
} from "./history-navigation.js";

interface WindowManagerContext {
  DEFAULT_WORKSPACE_ID: string;
  preloadPath: string;
  appIconPath: string;
  buildRendererPageUrl: (
    pageName: string,
    query?: Record<string, string>,
  ) => string;

  workspaces: Map<string, WorkspaceRecord>;
  windows: Map<number, WindowRecord>;
  windowToWorkspace: Map<number, string>;
  browserViews: Map<string, WebContentsView>;
  tabRecords: Map<number, Map<string, TabRecord>>;
  windowActiveTabs: Map<number, string>;
  windowTabLayouts: Map<number, {
    focusedTabId: string;
    syncScroll: boolean;
    tiles: Array<{
      tabId: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
  }>;
  windowSidebarWidths: Map<number, number>;
  windowUrlBarHeights: Map<number, number>;

  updateBrowserViewBounds: (targetWindow: BrowserWindow) => void;
  broadcastTabState: (targetWindow: BrowserWindow) => void;
  broadcastWorkspaceContext: () => void;
  getWorkspaceSession: (workspaceId: string) => WorkspaceSessionRecord | undefined;
  persistAllWorkspaceSessionsFromWindow: (windowId: number) => void;
  disposeCachedWorkspaceEntriesForWindow: (targetWindow: BrowserWindow) => void;
  beginWorkspaceSessionRestore?: (input: {
    windowId: number;
    workspaceId: string;
    tabIds: string[];
  }) => void;
  endWorkspaceSessionRestore?: (input: {
    windowId: number;
    workspaceId: string;
  }) => void;
  shouldHideWindowOnClose: (workspaceId: string) => boolean;
  isAppQuitting: () => boolean;
  handleTabCreate: (
    targetWindow: BrowserWindow,
    url?: string,
    options?: CreateTabOptions,
  ) => TabRecord;
  goBackInTab: (windowId: number, tabId: string) => Promise<boolean>;
  goForwardInTab: (windowId: number, tabId: string) => Promise<boolean>;
  handleTabSetActive: (
    targetWindow: BrowserWindow,
    tabId: string,
    layout?: { sidebarWidth?: number; urlBarHeight?: number; rightPanelWidth?: number },
  ) => void;
  installBrowserKeyboardShortcuts: (
    targetWindow: BrowserWindow,
    targetContents: BrowserWindow["webContents"],
  ) => void;
}

function buildWindowTitle(workspace: WorkspaceRecord, windowState?: WindowRecord) {
  const activeTab =
    windowState?.tabs.find((tab) => tab.id === windowState.activeTabId) ??
    windowState?.tabs[0];

  if (activeTab?.title?.trim()) {
    return `${workspace.name} · ${activeTab.title.trim()}`;
  }

  return workspace.name;
}

export function createWindowManager(context: WindowManagerContext) {
  const {
    DEFAULT_WORKSPACE_ID,
    preloadPath,
    appIconPath,
    buildRendererPageUrl,
    workspaces,
    windows,
    windowToWorkspace,
    browserViews,
    tabRecords,
    windowActiveTabs,
    windowTabLayouts,
    windowSidebarWidths,
    windowUrlBarHeights,
    updateBrowserViewBounds,
    broadcastTabState,
    broadcastWorkspaceContext,
    getWorkspaceSession,
    persistAllWorkspaceSessionsFromWindow,
    disposeCachedWorkspaceEntriesForWindow,
    beginWorkspaceSessionRestore,
    endWorkspaceSessionRestore,
    shouldHideWindowOnClose,
    isAppQuitting,
    handleTabCreate,
    goBackInTab,
    goForwardInTab,
    handleTabSetActive,
    installBrowserKeyboardShortcuts,
  } = context;

  const windowsAllowedToClose = new Set<number>();

  function getWorkspaceWindows(workspaceId: string) {
    return BrowserWindow.getAllWindows().filter(
      (targetWindow) => windowToWorkspace.get(targetWindow.id) === workspaceId,
    );
  }

  function updateWindowTitle(targetWindow: BrowserWindow) {
    const workspaceId = windowToWorkspace.get(targetWindow.id);
    const workspace = workspaceId ? workspaces.get(workspaceId) : undefined;
    if (!workspace) {
      return;
    }

    targetWindow.setTitle(buildWindowTitle(workspace, windows.get(targetWindow.id)));
  }

  function serializeWindow(targetWindow: BrowserWindow): WindowSummary {
    const workspaceId = windowToWorkspace.get(targetWindow.id) ?? DEFAULT_WORKSPACE_ID;
    const workspace = workspaces.get(workspaceId) ?? workspaces.get(DEFAULT_WORKSPACE_ID);

    if (!workspace) {
      throw new Error("Default workspace is not initialized.");
    }

    const windowState = windows.get(targetWindow.id);

    return {
      id: targetWindow.id,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      profileId: workspace.profileId,
      visible: targetWindow.isVisible(),
      focused: targetWindow.isFocused(),
      title: targetWindow.getTitle() || buildWindowTitle(workspace, windowState),
      activeTabId: windowState?.activeTabId,
      tabCount: windowState?.tabs.length ?? 0,
      tabs: windowState?.tabs ?? [],
    };
  }

  function serializeWindows() {
    return BrowserWindow.getAllWindows()
      .filter((targetWindow) => windowToWorkspace.has(targetWindow.id))
      .map((targetWindow) => serializeWindow(targetWindow))
      .sort((left, right) => {
        if (left.focused !== right.focused) {
          return Number(right.focused) - Number(left.focused);
        }

        if (left.visible !== right.visible) {
          return Number(right.visible) - Number(left.visible);
        }

        const workspaceOrder = left.workspaceName.localeCompare(right.workspaceName);
        if (workspaceOrder !== 0) {
          return workspaceOrder;
        }

        return left.id - right.id;
      });
  }

  function revealWorkspaceWindow(targetWindow: BrowserWindow) {
    targetWindow.setSkipTaskbar(false);
    if (!targetWindow.isVisible()) {
      targetWindow.show();
    }

    targetWindow.focus();
  }

  function requestWindowClose(targetWindow: BrowserWindow) {
    if (targetWindow.isDestroyed()) {
      return;
    }

    windowsAllowedToClose.add(targetWindow.id);
    targetWindow.close();
  }

  async function handleWindowAppCommand(
    targetWindow: BrowserWindow,
    command: string,
  ) {
    const activeTabId = windowActiveTabs.get(targetWindow.id);
    if (!activeTabId) {
      return;
    }

    if (command === "browser-backward") {
      if (!shouldHandleTabHistoryNavigation(targetWindow.id, "back", activeTabId)) {
        return;
      }

      await goBackInTab(targetWindow.id, activeTabId);
      return;
    }

    if (command === "browser-forward") {
      if (!shouldHandleTabHistoryNavigation(targetWindow.id, "forward", activeTabId)) {
        return;
      }

      await goForwardInTab(targetWindow.id, activeTabId);
    }
  }

  function createWorkspaceWindow(
    workspace: WorkspaceRecord,
    options: { show: boolean; initialUrl?: string; forceInitialUrl?: boolean },
  ) {
    const targetWindow = new BrowserWindow({
      width: 1440,
      height: 940,
      minWidth: 1120,
      minHeight: 760,
      show: false,
      paintWhenInitiallyHidden: true,
      transparent: process.platform === "darwin",
      backgroundColor: process.platform === "darwin" ? "#00000000" : "#050507",
      title: workspace.name,
      ...(process.platform === "darwin" ? {} : { icon: appIconPath }),
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
      autoHideMenuBar: true,
      ...(process.platform === "darwin"
        ? {
          vibrancy: "under-window",
          visualEffectState: "active",
        }
        : {}),
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webviewTag: false,
        spellcheck: true,
        backgroundThrottling: false,
      },
    });

    if (process.platform !== "darwin") {
      targetWindow.setMenu(null);
      targetWindow.setMenuBarVisibility(false);
    }

    targetWindow.webContents.setBackgroundThrottling(false);
    installBrowserKeyboardShortcuts(targetWindow, targetWindow.webContents);
    targetWindow.setSkipTaskbar(!options.show);
    windows.set(targetWindow.id, {
      workspaceId: workspace.id,
      tabs: [],
    });
    windowToWorkspace.set(targetWindow.id, workspace.id);
    windowSidebarWidths.set(targetWindow.id, 200);
    windowUrlBarHeights.set(targetWindow.id, 88);
    updateWindowTitle(targetWindow);

    targetWindow.on("show", () => {
      broadcastWorkspaceContext();
    });

    targetWindow.on("hide", () => {
      broadcastWorkspaceContext();
    });

    targetWindow.on("focus", () => {
      broadcastWorkspaceContext();
    });

    targetWindow.on("blur", () => {
      broadcastWorkspaceContext();
    });

    targetWindow.on("app-command", (event, command) => {
      if (command !== "browser-backward" && command !== "browser-forward") {
        return;
      }

      event.preventDefault();
      const remappedCommand = command === "browser-backward"
        ? "browser-forward"
        : "browser-backward";
      void handleWindowAppCommand(targetWindow, remappedCommand).catch((error) => {
        console.warn(`[Window] Failed to handle app command "${command}".`, error);
      });
    });

    targetWindow.on("swipe", (event, direction) => {
      if (direction !== "right" && direction !== "left") {
        return;
      }

      event.preventDefault();
      const command = direction === "right" ? "browser-forward" : "browser-backward";
      void handleWindowAppCommand(targetWindow, command).catch((error) => {
        console.warn(`[Window] Failed to handle swipe navigation "${direction}".`, error);
      });
    });

    const handleBoundsUpdate = () => {
      updateBrowserViewBounds(targetWindow);
      setTimeout(() => {
        if (!targetWindow.isDestroyed()) {
          updateBrowserViewBounds(targetWindow);
        }
      }, 60);
    };

    targetWindow.on("resize", handleBoundsUpdate);
    targetWindow.on("maximize", handleBoundsUpdate);
    targetWindow.on("unmaximize", handleBoundsUpdate);
    targetWindow.on("enter-full-screen", handleBoundsUpdate);
    targetWindow.on("leave-full-screen", handleBoundsUpdate);
    targetWindow.on("restore", handleBoundsUpdate);

    targetWindow.on("close", (event) => {
      const workspaceId = windowToWorkspace.get(targetWindow.id) ?? workspace.id;
      const allowClose = windowsAllowedToClose.has(targetWindow.id);
      if (!allowClose && !isAppQuitting() && shouldHideWindowOnClose(workspaceId)) {
        event.preventDefault();
        targetWindow.setSkipTaskbar(true);
        targetWindow.hide();
        broadcastWorkspaceContext();
        return;
      }

      windowsAllowedToClose.delete(targetWindow.id);
    });

    targetWindow.webContents.on("devtools-opened", () => {
      updateBrowserViewBounds(targetWindow);
    });
    targetWindow.webContents.on("devtools-closed", () => {
      updateBrowserViewBounds(targetWindow);
    });

    targetWindow.on("closed", () => {
      clearTabHistoryNavigationWindow(targetWindow.id);
      windowsAllowedToClose.delete(targetWindow.id);
      persistAllWorkspaceSessionsFromWindow(targetWindow.id);

      const windowTabs = tabRecords.get(targetWindow.id);
      if (windowTabs) {
        for (const tabId of windowTabs.keys()) {
          const view = browserViews.get(tabId);
          if (view) {
            try {
              targetWindow.contentView.removeChildView(view);
            } catch {
              // Already removed.
            }

            if (!view.webContents.isDestroyed()) {
              view.webContents.close();
            }
          }
          browserViews.delete(tabId);
        }
        tabRecords.delete(targetWindow.id);
      }

      disposeCachedWorkspaceEntriesForWindow(targetWindow);
      windowActiveTabs.delete(targetWindow.id);
      windowTabLayouts.delete(targetWindow.id);
      windowSidebarWidths.delete(targetWindow.id);
      windowUrlBarHeights.delete(targetWindow.id);

      windows.delete(targetWindow.id);
      windowToWorkspace.delete(targetWindow.id);
      broadcastWorkspaceContext();
    });

    const url = buildRendererPageUrl("index.html", { workspaceId: workspace.id });
    void targetWindow.loadURL(url)
      .then(() => {
        const session = getWorkspaceSession(workspace.id);
        const restoredTabs = session?.tabs.filter((tab) => tab.url.trim().length > 0) ?? [];
        const shouldRestoreSession = restoredTabs.length > 0 && !options.forceInitialUrl;
        const activeTabIndex = shouldRestoreSession
          ? Math.min(
            Math.max(0, session?.activeTabIndex ?? restoredTabs.length - 1),
            restoredTabs.length - 1,
          )
          : 0;
        const createdTabs =
          shouldRestoreSession
            ? (() => {
              beginWorkspaceSessionRestore?.({
                windowId: targetWindow.id,
                workspaceId: workspace.id,
                tabIds: restoredTabs.map((tab) => tab.id),
              });
              try {
                return restoredTabs.map((tab, index) => {
                  const shouldActivateTab = index === activeTabIndex;
                  return handleTabCreate(targetWindow, tab.url, {
                    activate: shouldActivateTab,
                    deferInitialLoad: !shouldActivateTab,
                    initialTitle: tab.title,
                    initialFavicon: tab.favicon,
                    restoredTabId: tab.id,
                    suppressStateBroadcast: true,
                    restoredHistoryEntries: tab.historyEntries,
                    restoredHistoryIndex: tab.historyIndex,
                  });
                });
              } finally {
                endWorkspaceSessionRestore?.({
                  windowId: targetWindow.id,
                  workspaceId: workspace.id,
                });
              }
            })()
            : [handleTabCreate(targetWindow, options.initialUrl)];

        if (shouldRestoreSession && createdTabs.length > 0) {
          broadcastTabState(targetWindow);
        }
      })
      .catch((error) => {
        console.error(`[Window] Failed to restore session for workspace "${workspace.id}".`, error);
        handleTabCreate(targetWindow, options.initialUrl);
      });

    if (options.show) {
      targetWindow.once("ready-to-show", () => {
        revealWorkspaceWindow(targetWindow);
        broadcastWorkspaceContext();
      });
    }

    broadcastWorkspaceContext();
    return targetWindow;
  }

  return {
    getWorkspaceWindows,
    updateWindowTitle,
    serializeWindow,
    serializeWindows,
    revealWorkspaceWindow,
    requestWindowClose,
    createWorkspaceWindow,
  };
}
