import path from "node:path";
import { app, BrowserWindow, shell, WebContentsView, session, type WebContents } from "electron";
import type {
  CreateTabOptions,
  DeleteWorkspaceSkipDetail,
  DeleteWorkspacesResult,
  OpenFolderSettingsDialogInput,
  OpenCreateWorkspaceDialogInput,
  TabRecord,
  ViewBounds,
  WorkspaceRecord,
  WorkspaceSessionRecord,
} from "../shared/contracts.js";

interface CreateWindowActionsManagerOptions {
  defaultWorkspaceId: string;
  preloadPath: string;
  appIconPath: string;
  buildRendererPageUrl: (
    page: string,
    query?: Record<string, string>,
  ) => string;
  getResolvedColorScheme: () => "light" | "dark";
  getLanguage: () => string;
  workspaces: Map<string, WorkspaceRecord>;
  workspaceSessions: Map<string, WorkspaceSessionRecord>;
  windowToWorkspace: Map<number, string>;
  tabRecords: Map<number, Map<string, TabRecord>>;
  browserViews: Map<string, WebContentsView>;
  workspaceCreateDialogs: Map<number, BrowserWindow>;
  folderSettingsDialogs: Map<number, BrowserWindow>;
  getWorkspaceRecord: (workspaceId: string) => WorkspaceRecord;
  buildWorkspacePartition: (profileId: string) => string;
  createWorkspaceWindow: (
    workspace: WorkspaceRecord,
    options: { show: boolean; initialUrl?: string; forceInitialUrl?: boolean },
  ) => BrowserWindow;
  revealWorkspaceWindow: (targetWindow: BrowserWindow) => void;
  requestWindowClose: (targetWindow: BrowserWindow) => void;
  updateWindowTitle: (targetWindow: BrowserWindow) => void;
  broadcastWorkspaceContext: () => void;
  handleTabCreate: (targetWindow: BrowserWindow, url?: string, options?: CreateTabOptions) => TabRecord;
  handleTabClose: (
    targetWindow: BrowserWindow,
    tabId: string,
  ) => { activeTabId: string };
  handleTabSetActive: (targetWindow: BrowserWindow, tabId: string) => void;
  broadcastTabState: (targetWindow: BrowserWindow) => void;
  applyColorSchemeToContents: (targetContents: WebContents) => Promise<unknown>;
  disposeCachedWorkspaceEntriesForWindow: (
    targetWindow: BrowserWindow,
    workspaceIds?: ReadonlySet<string>,
  ) => void;
  flushWorkspaceStateSave: () => void;
  getActiveTabContentBounds: (targetWindow: BrowserWindow) => ViewBounds | null;
  focusActiveTabContents: (targetWindow: BrowserWindow) => void;
  getSearchOverlayView: () => WebContentsView | null;
  setSearchOverlayVisible: (visible: boolean) => void;
  getBoundAgentSessionsForWorkspace?: (
    workspaceId: string,
  ) => Array<{
    sessionId: string;
    title: string;
  }>;
  clearStartPageAppearanceOverrides?: (workspaceIds: string[]) => void;
  clearStartPageDockItemOverrides?: (workspaceIds: string[]) => void;
  clearStartPageWidgetStateOverrides?: (workspaceIds: string[]) => void;
}

const SEARCH_OVERLAY_WIDTH = 568;  // 540 content + 28px shadow padding (14px each side)
const SEARCH_OVERLAY_HEIGHT = 468; // 440 content + 28px shadow padding (14px each side)

function resolveDialogLocale(languageSetting: string, systemLanguage: string) {
  const normalizedLanguage = languageSetting.trim().toLowerCase();
  if (normalizedLanguage === "zh" || normalizedLanguage === "zh-cn" || normalizedLanguage === "zh-hans") {
    return "zh-CN";
  }

  if (normalizedLanguage === "en" || normalizedLanguage === "en-us") {
    return "en-US";
  }

  return systemLanguage.trim().toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

function getFolderSettingsDialogTitle(locale: "en-US" | "zh-CN") {
  return locale === "zh-CN" ? "目录设置" : "Folder Settings";
}

export function createWindowActionsManager(options: CreateWindowActionsManagerOptions) {
  const {
    defaultWorkspaceId,
    preloadPath,
    appIconPath,
    buildRendererPageUrl,
    getResolvedColorScheme,
    getLanguage,
    workspaces,
    workspaceSessions,
    windowToWorkspace,
    tabRecords,
    browserViews,
    workspaceCreateDialogs,
    folderSettingsDialogs,
    getWorkspaceRecord,
    buildWorkspacePartition,
    createWorkspaceWindow,
    revealWorkspaceWindow,
    requestWindowClose,
    updateWindowTitle,
    broadcastWorkspaceContext,
    handleTabCreate,
    handleTabClose,
    handleTabSetActive,
    broadcastTabState,
    applyColorSchemeToContents,
    disposeCachedWorkspaceEntriesForWindow,
    flushWorkspaceStateSave,
    getActiveTabContentBounds,
    focusActiveTabContents,
    getSearchOverlayView,
    setSearchOverlayVisible,
    getBoundAgentSessionsForWorkspace,
    clearStartPageAppearanceOverrides,
    clearStartPageDockItemOverrides,
    clearStartPageWidgetStateOverrides,
  } = options;

  function deleteWorkspacesByIds(inputWorkspaceIds: string[]): DeleteWorkspacesResult {
    const requestedWorkspaceIds = Array.isArray(inputWorkspaceIds)
      ? Array.from(
        new Set(
          inputWorkspaceIds.flatMap((workspaceId) => {
            if (typeof workspaceId !== "string") {
              return [];
            }

            const trimmedWorkspaceId = workspaceId.trim();
            return trimmedWorkspaceId ? [trimmedWorkspaceId] : [];
          }),
        ),
      )
      : [];

    if (requestedWorkspaceIds.length === 0) {
      return {
        deletedWorkspaceIds: [],
        skippedWorkspaceIds: [],
      };
    }

    const deletedWorkspaceIds: string[] = [];
    const skippedWorkspaceIds: string[] = [];
    const skippedDetails: DeleteWorkspaceSkipDetail[] = [];

    for (const workspaceId of requestedWorkspaceIds) {
      if (workspaceId === defaultWorkspaceId) {
        skippedWorkspaceIds.push(workspaceId);
        skippedDetails.push({
          workspaceId,
          reason: "protected",
        });
        continue;
      }

      if (!workspaces.has(workspaceId)) {
        skippedWorkspaceIds.push(workspaceId);
        skippedDetails.push({
          workspaceId,
          reason: "not_found",
        });
        continue;
      }

      const boundSessions = getBoundAgentSessionsForWorkspace?.(workspaceId) ?? [];
      if (boundSessions.length > 0) {
        skippedWorkspaceIds.push(workspaceId);
        skippedDetails.push({
          workspaceId,
          reason: "bound_agent",
          agentSessionId: boundSessions[0]?.sessionId,
          agentTitle: boundSessions[0]?.title,
        });
        continue;
      }

      deletedWorkspaceIds.push(workspaceId);
    }

    if (deletedWorkspaceIds.length === 0) {
      return {
        deletedWorkspaceIds,
        skippedWorkspaceIds,
        ...(skippedDetails.length > 0 ? { skippedDetails } : {}),
      };
    }

    const deletedWorkspaceIdSet = new Set(deletedWorkspaceIds);

    for (const targetWindow of BrowserWindow.getAllWindows()) {
      if (targetWindow.isDestroyed()) {
        continue;
      }

      disposeCachedWorkspaceEntriesForWindow(targetWindow, deletedWorkspaceIdSet);
    }

    for (const workspaceId of deletedWorkspaceIds) {
      workspaces.delete(workspaceId);
      workspaceSessions.delete(workspaceId);
    }

    clearStartPageAppearanceOverrides?.(deletedWorkspaceIds);
    clearStartPageDockItemOverrides?.(deletedWorkspaceIds);
    clearStartPageWidgetStateOverrides?.(deletedWorkspaceIds);

    for (const workspace of workspaces.values()) {
      if (
        workspace.profileSourceWorkspaceId
        && deletedWorkspaceIdSet.has(workspace.profileSourceWorkspaceId)
      ) {
        workspace.profileSourceWorkspaceId = undefined;
      }
    }

    const windowsToClose = BrowserWindow.getAllWindows()
      .filter((targetWindow) => deletedWorkspaceIdSet.has(
        windowToWorkspace.get(targetWindow.id) ?? "",
      ));

    for (const targetWindow of windowsToClose) {
      if (!targetWindow.isDestroyed()) {
        requestWindowClose(targetWindow);
      }
    }

    flushWorkspaceStateSave();
    broadcastWorkspaceContext();

    return {
      deletedWorkspaceIds,
      skippedWorkspaceIds,
      ...(skippedDetails.length > 0 ? { skippedDetails } : {}),
    };
  }

  async function openWorkspaceProfileDirectory(workspaceId: string) {
    const workspace = getWorkspaceRecord(workspaceId);
    const partition = buildWorkspacePartition(workspace.profileId);
    const targetSession = session.fromPartition(partition);
    const storagePath = targetSession.storagePath;

    if (!storagePath) {
      throw new Error("This workspace does not have a persistent profile directory.");
    }

    const openError = await shell.openPath(storagePath);
    if (openError) {
      throw new Error(openError);
    }

    return storagePath;
  }

  function requireWindowForAutomation(windowId: number) {
    const targetWindow = BrowserWindow.fromId(windowId);
    if (!targetWindow || targetWindow.isDestroyed()) {
      throw new Error("Window not found.");
    }

    return targetWindow;
  }

  function requireWindowTabForAutomation(windowId: number, tabId: string) {
    const tabs = tabRecords.get(windowId);
    const tab = tabs?.get(tabId);
    if (!tabs || !tab) {
      throw new Error("Tab not found in target window.");
    }

    return { tabs, tab };
  }

  function createWindowForWorkspace(
    workspaceId: string,
    options: { show: boolean; focus: boolean },
  ) {
    const workspace = getWorkspaceRecord(workspaceId);
    const targetWindow = createWorkspaceWindow(workspace, { show: Boolean(options.show) });
    if (options.focus) {
      revealWorkspaceWindow(targetWindow);
    }

    return targetWindow;
  }

  function openCreateWorkspaceDialog(
    parentWindow: BrowserWindow,
    input: OpenCreateWorkspaceDialogInput,
  ) {
    const dialogHeight = 460;
    const existingDialog = workspaceCreateDialogs.get(parentWindow.id);
    if (existingDialog && !existingDialog.isDestroyed()) {
      if (!existingDialog.isVisible()) {
        existingDialog.show();
      }
      existingDialog.focus();
      return existingDialog;
    }

    const dialogBackgroundColor = getResolvedColorScheme() === "dark" ? "#1e1e1e" : "#ffffff";
    const dialogWindow = new BrowserWindow({
      width: 440,
      height: dialogHeight,
      minWidth: 440,
      minHeight: dialogHeight,
      maxWidth: 520,
      maxHeight: 520,
      show: false,
      parent: parentWindow,
      modal: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      autoHideMenuBar: true,
      backgroundColor: dialogBackgroundColor,
      title: "Create workspace",
      ...(process.platform === "darwin" ? {} : { icon: appIconPath }),
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: true,
      },
    });

    workspaceCreateDialogs.set(parentWindow.id, dialogWindow);

    dialogWindow.on("closed", () => {
      workspaceCreateDialogs.delete(parentWindow.id);
    });

    const url = buildRendererPageUrl("workspace-create.html", {
      sourceWorkspaceId: input.sourceWorkspaceId,
      sourceWorkspaceName: input.sourceWorkspaceName ?? "",
    });

    void dialogWindow.loadURL(url);
    dialogWindow.once("ready-to-show", () => {
      dialogWindow.show();
      dialogWindow.focus();
    });

    return dialogWindow;
  }

  function openFolderSettingsDialog(
    parentWindow: BrowserWindow,
    input: OpenFolderSettingsDialogInput,
  ) {
    const dialogHeight = 492;
    const existingDialog = folderSettingsDialogs.get(parentWindow.id);
    if (existingDialog && !existingDialog.isDestroyed()) {
      if (!existingDialog.isVisible()) {
        existingDialog.show();
      }
      existingDialog.focus();
      return existingDialog;
    }

    const dialogBackgroundColor = getResolvedColorScheme() === "dark" ? "#1e1e1e" : "#ffffff";
    const languageSetting = getLanguage();
    const systemLanguage = app.getLocale();
    const dialogLocale = resolveDialogLocale(languageSetting, systemLanguage);
    const dialogTitle = getFolderSettingsDialogTitle(dialogLocale);
    const dialogWindow = new BrowserWindow({
      width: 420,
      height: dialogHeight,
      minWidth: 420,
      minHeight: dialogHeight,
      maxWidth: 520,
      maxHeight: 560,
      show: false,
      parent: parentWindow,
      modal: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      autoHideMenuBar: true,
      backgroundColor: dialogBackgroundColor,
      title: dialogTitle,
      ...(process.platform === "darwin" ? {} : { icon: appIconPath }),
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: true,
      },
    });

    folderSettingsDialogs.set(parentWindow.id, dialogWindow);

    dialogWindow.on("closed", () => {
      folderSettingsDialogs.delete(parentWindow.id);
    });

    const url = buildRendererPageUrl("folder-settings.html", {
      workspaceId: input.workspaceId,
      folderId: input.folderId,
      name: input.name,
      icon: input.icon ?? "",
      backgroundColor: input.backgroundColor ?? "",
      language: languageSetting,
      systemLanguage,
    });

    void dialogWindow.loadURL(url);
    dialogWindow.once("ready-to-show", () => {
      dialogWindow.show();
      dialogWindow.focus();
    });

    return dialogWindow;
  }

  function focusWindowById(windowId: number) {
    const targetWindow = requireWindowForAutomation(windowId);
    revealWorkspaceWindow(targetWindow);
    updateWindowTitle(targetWindow);
    broadcastWorkspaceContext();
    return targetWindow;
  }

  function createTabInWindow(windowId: number, url?: string, options?: CreateTabOptions) {
    const targetWindow = requireWindowForAutomation(windowId);
    return handleTabCreate(targetWindow, url, options);
  }

  function closeTabInWindow(windowId: number, tabId: string) {
    const targetWindow = requireWindowForAutomation(windowId);
    requireWindowTabForAutomation(windowId, tabId);
    return handleTabClose(targetWindow, tabId);
  }

  function activateTabInWindow(windowId: number, tabId: string) {
    const targetWindow = requireWindowForAutomation(windowId);
    requireWindowTabForAutomation(windowId, tabId);
    handleTabSetActive(targetWindow, tabId);
  }

  async function goBackInTab(windowId: number, tabId: string) {
    requireWindowTabForAutomation(windowId, tabId);
    const view = browserViews.get(tabId);
    if (!view) {
      throw new Error("Tab webContents not found.");
    }

    if (!view.webContents.canGoBack()) {
      return false;
    }

    await applyColorSchemeToContents(view.webContents);
    view.webContents.goBack();
    return true;
  }

  async function goForwardInTab(windowId: number, tabId: string) {
    requireWindowTabForAutomation(windowId, tabId);
    const view = browserViews.get(tabId);
    if (!view) {
      throw new Error("Tab webContents not found.");
    }

    if (!view.webContents.canGoForward()) {
      return false;
    }

    await applyColorSchemeToContents(view.webContents);
    view.webContents.goForward();
    return true;
  }

  async function reloadTabInWindow(windowId: number, tabId: string) {
    const targetWindow = requireWindowForAutomation(windowId);
    requireWindowTabForAutomation(windowId, tabId);
    const view = browserViews.get(tabId);
    if (!view) {
      throw new Error("Tab webContents not found.");
    }

    const tabs = tabRecords.get(windowId);
    const tab = tabs?.get(tabId);
    if (!tab) {
      throw new Error("Tab not found in target window.");
    }

    if (tab.isLoading) {
      view.webContents.stop();
      return { reloading: false };
    }

    if (!tab.hasLoaded) {
      if (tab.url === "nexus://start" || tab.url.startsWith("nexus://") || tab.url === "milo://home" || tab.url.startsWith("milo://") || tab.url === "about:blank") {
        return { reloading: false };
      }
      tab.hasLoaded = true;
      tab.isLoading = true;
      tab.canGoBack = false;
      tab.canGoForward = false;
      await applyColorSchemeToContents(view.webContents);
      void view.webContents.loadURL(tab.url).catch(() => undefined);
      broadcastTabState(targetWindow);
      return { reloading: true };
    }

    await applyColorSchemeToContents(view.webContents);
    view.webContents.reload();
    return { reloading: true };
  }

  function getSearchOverlayBounds(windowId: number) {
    const targetWindow = BrowserWindow.getAllWindows().find((win) => win.id === windowId);
    const fallbackContentBounds = {
      x: 258,
      y: 60,
      width: 1128,
      height: 862,
    };
    const contentBounds = targetWindow
      ? getActiveTabContentBounds(targetWindow) ?? fallbackContentBounds
      : fallbackContentBounds;
    const overlayWidth = Math.min(SEARCH_OVERLAY_WIDTH, Math.max(360, contentBounds.width - 20));
    const overlayHeight = Math.min(SEARCH_OVERLAY_HEIGHT, Math.max(280, contentBounds.height - 24));
    const x = contentBounds.x + Math.floor((contentBounds.width - overlayWidth) / 2);
    const y = contentBounds.y + Math.max(12, Math.floor((contentBounds.height - overlayHeight) * 0.18));
    return {
      x,
      y,
      width: overlayWidth,
      height: overlayHeight,
    };
  }

  function detachSearchOverlayViewFromAllWindows() {
    const searchOverlayView = getSearchOverlayView();
    if (!searchOverlayView) {
      return;
    }

    for (const windowRecord of BrowserWindow.getAllWindows()) {
      if (windowRecord.isDestroyed()) {
        continue;
      }

      try {
        windowRecord.contentView.removeChildView(searchOverlayView);
      } catch {
        // Ignore when the overlay is not attached to this window.
      }
    }
  }

  function closeSearchOverlay(targetWindow: BrowserWindow) {
    detachSearchOverlayViewFromAllWindows();
    setSearchOverlayVisible(false);
    focusActiveTabContents(targetWindow);
    targetWindow.webContents.send("bookmarks:changed");
  }

  return {
    deleteWorkspacesByIds,
    openWorkspaceProfileDirectory,
    focusWindowById,
    createTabInWindow,
    closeTabInWindow,
    activateTabInWindow,
    goBackInTab,
    goForwardInTab,
    reloadTabInWindow,
    createWindowForWorkspace,
    openCreateWorkspaceDialog,
    openFolderSettingsDialog,
    getSearchOverlayBounds,
    closeSearchOverlay,
  };
}
