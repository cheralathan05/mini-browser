import { randomUUID } from "node:crypto";
import {
  BrowserWindow,
  WebContentsView,
  type BrowserWindowConstructorOptions,
  type DidCreateWindowDetails,
  type NavigationEntry,
  type WebContents,
} from "electron";
import type {
  CreateTabOptions,
  SplitViewDragDropPayload,
  SplitViewDragPreviewPayload,
  TabLayoutUpdateInput,
  TabRecord,
  TabScrollSyncPayload,
  ViewBounds,
  WindowRecord,
  WindowTabLayoutTile,
  WindowTabLayoutState,
  WindowTabRuntimeLookupResult,
  WindowTabSummary,
  WindowWorkspaceCacheRecord,
  WorkspaceRecord,
  WorkspaceSessionRecord,
} from "../shared/contracts.js";
import {
  buildWorkspacePartition,
  inferTitleFromUrl,
  resolveInputToUrl,
  toDisplayUrl,
  type DisplayUrlOptions,
  type ResolveInputToUrlOptions,
  type StartPageUrlOptions,
} from "../shared/utils.js";
import { shouldHandleTabHistoryNavigation } from "./history-navigation.js";

interface CreateTabManagerOptions<BootstrapData> {
  defaultWorkspaceId: string;
  preloadPath: string;
  tabLoadingDebugEnabled: boolean;
  displayUrlOptions: DisplayUrlOptions;
  startPageUrlOptions: StartPageUrlOptions;
  resolveInputToUrlOptions: ResolveInputToUrlOptions;
  workspaces: Map<string, WorkspaceRecord>;
  windows: Map<number, WindowRecord>;
  windowToWorkspace: Map<number, string>;
  browserViews: Map<string, WebContentsView>;
  tabRecords: Map<number, Map<string, TabRecord>>;
  windowActiveTabs: Map<number, string>;
  windowTabLayouts: Map<number, WindowTabLayoutState>;
  windowSidebarDragTabs: Map<number, string>;
  windowSidebarDragClearTimers: Map<number, ReturnType<typeof setTimeout>>;
  windowSidebarWidths: Map<number, number>;
  windowUrlBarHeights: Map<number, number>;
  ensureMiloProtocolForPartition: (partition: string) => void;
  ensureDownloadHandlingForPartition: (partition: string) => void;
  applyColorSchemeToContents: (targetContents: WebContents) => Promise<unknown>;
  applyResolvedUserAgentToContents: (
    targetContents: WebContents,
    targetUrl?: string,
  ) => void;
  cleanupManagedContents: (contentsId: number) => void;
  clearPageTranslationState: (contentsId: number) => void;
  handlePageTranslationNavigation: (
    targetWindow: BrowserWindow,
    webContents: WebContents,
  ) => Promise<unknown> | unknown;
  handlePageTranslationCommandUrl: (
    targetWindow: BrowserWindow,
    webContents: WebContents,
    url: string,
  ) => boolean;
  clearUserScriptsForContents?: (contentsId: number) => void;
  cleanupUserScriptUiForContents?: (
    targetContents: WebContents,
  ) => Promise<unknown> | unknown;
  injectUserScriptsForPage?: (
    profileId: string,
    targetContents: WebContents,
    url: string,
  ) => Promise<unknown> | unknown;
  ensureContentsOverrides: (
    targetContents: WebContents,
    options?: { targetUrl?: string },
  ) => Promise<unknown>;
  setupBrowserViewContextMenu: (
    targetWindow: BrowserWindow,
    webContents: WebContents,
  ) => void;
  registerGuestContents: (
    workspaceId: string,
    contents: WebContents,
    options?: { automationTargetEligible?: boolean },
  ) => void;
  beginWorkspaceSessionRestore?: (input: {
    windowId: number;
    workspaceId: string;
    tabIds: string[];
  }) => void;
  endWorkspaceSessionRestore?: (input: {
    windowId: number;
    workspaceId: string;
  }) => void;
  persistWorkspaceSessionForWindow: (windowId: number) => void;
  getWorkspaceSession: (workspaceId: string) => WorkspaceSessionRecord | undefined;
  isAutomationControlledTabId?: (tabId: string) => boolean;
  getTabManualInterventionMessage?: (tabId: string) => string | undefined;
  clearTabManualInterventionMessage?: (tabId: string) => void;
  broadcastWorkspaceContext: () => void;
  updateWindowTitle: (targetWindow: BrowserWindow) => void;
  clearLinkPreviewForTab: (windowId: number, tabId: string) => void;
  destroyLinkPreview: (windowId: number) => void;
  updateLinkPreviewBounds: (targetWindow: BrowserWindow) => void;
  updateWindowOverlayBounds: (targetWindow: BrowserWindow) => void;
  isTrackableHistoryUrl: (url: string) => boolean;
  recordHistoryVisit: (
    profileId: string,
    url: string,
    options?: {
      title?: string;
      favicon?: string;
      openedFrom?: {
        url: string;
        title?: string;
        linkUrl?: string;
        openedAt?: number;
      };
    },
  ) => void;
  updateHistoryMetadata: (
    profileId: string,
    url: string,
    options?: { title?: string; favicon?: string },
  ) => void;
  requestWindowClose: (targetWindow: BrowserWindow) => void;
  buildBootstrapData: (contents: WebContents) => BootstrapData;
  installBrowserKeyboardShortcuts: (
    targetWindow: BrowserWindow,
    targetContents: WebContents,
  ) => void;
  onTabCreated?: (payload: {
    windowId: number;
    tabId: string;
    url: string;
    title: string;
    isActive: boolean;
    openerTabId?: string;
    sidebarGroupWithTabId?: string;
    source: "api" | "window_open";
  }) => void;
  onActiveTabChanged?: (payload: {
    windowId: number;
    tabId: string;
    contentsId: number;
  }) => void;
}

const CONTENT_HORIZONTAL_INSET = 4;
const CONTENT_TOP_INSET = 4;
const CONTENT_BOTTOM_INSET = 4;
const CONTENT_RADIUS = 12;
const CONTENT_TOP_PROGRESS_BAR_HEIGHT = 3;
const TAB_MEMORY_SAVER_IDLE_MS = 10 * 60 * 1000;
const WORKSPACE_MEMORY_SAVER_IDLE_MS = 10 * 60 * 1000;
const TAB_METADATA_BROADCAST_DELAY_MS = 120;

interface BroadcastTabStateOptions {
  persistWorkspaceSession?: boolean;
  broadcastWorkspaceContext?: boolean;
  updateWindowTitle?: boolean;
}

const FAVICON_CANDIDATES_SCRIPT = String.raw`(() => {
  const getPriority = (relValue) => {
    const rel = String(relValue || "").trim().toLowerCase();
    const tokens = rel.split(/\s+/).filter(Boolean);
    if (rel === "icon") return 0;
    if (rel === "shortcut icon") return 1;
    if (tokens.includes("icon")) return 2;
    if (rel === "apple-touch-icon" || rel === "apple-touch-icon-precomposed") return 3;
    return -1;
  };

  const scoreSizes = (sizesValue) => {
    const sizes = String(sizesValue || "").trim().toLowerCase();
    if (!sizes || sizes === "any") return 0;
    let best = 0;
    for (const token of sizes.split(/\s+/)) {
      const match = token.match(/^(\d+)x(\d+)$/);
      if (!match) continue;
      const width = Number.parseInt(match[1], 10);
      const height = Number.parseInt(match[2], 10);
      if (!Number.isFinite(width) || !Number.isFinite(height)) continue;
      best = Math.max(best, Math.min(width, height));
    }
    return best;
  };

  const entries = [];
  const seen = new Set();
  for (const link of Array.from(document.querySelectorAll("link[href]"))) {
    const priority = getPriority(link.getAttribute("rel"));
    if (priority === -1) continue;
    const href = link.getAttribute("href");
    if (!href) continue;
    let absoluteHref;
    try {
      absoluteHref = new URL(href, document.baseURI).toString();
    } catch {
      continue;
    }
    if (seen.has(absoluteHref)) continue;
    seen.add(absoluteHref);
    entries.push({
      href: absoluteHref,
      priority,
      sizes: scoreSizes(link.getAttribute("sizes")),
    });
  }

  entries.sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }
    return right.sizes - left.sizes;
  });

  return entries.map((entry) => entry.href);
})()`;

export function createTabManager<BootstrapData>(options: CreateTabManagerOptions<BootstrapData>) {
  const {
    defaultWorkspaceId,
    preloadPath,
    tabLoadingDebugEnabled,
    displayUrlOptions,
    startPageUrlOptions,
    resolveInputToUrlOptions,
    workspaces,
    windows,
    windowToWorkspace,
    browserViews,
    tabRecords,
    windowActiveTabs,
    windowTabLayouts,
    windowSidebarDragTabs,
    windowSidebarDragClearTimers,
    windowSidebarWidths,
    windowUrlBarHeights,
    ensureMiloProtocolForPartition,
    ensureDownloadHandlingForPartition,
    applyColorSchemeToContents,
    applyResolvedUserAgentToContents,
    cleanupManagedContents,
    clearPageTranslationState,
    handlePageTranslationCommandUrl,
    handlePageTranslationNavigation,
    clearUserScriptsForContents,
    cleanupUserScriptUiForContents,
    injectUserScriptsForPage,
    ensureContentsOverrides,
    setupBrowserViewContextMenu,
    registerGuestContents,
    beginWorkspaceSessionRestore,
    endWorkspaceSessionRestore,
    persistWorkspaceSessionForWindow,
    getWorkspaceSession,
    isAutomationControlledTabId,
    getTabManualInterventionMessage,
    clearTabManualInterventionMessage,
    broadcastWorkspaceContext,
    updateWindowTitle,
    clearLinkPreviewForTab,
    destroyLinkPreview,
    updateLinkPreviewBounds,
    updateWindowOverlayBounds,
    isTrackableHistoryUrl,
    recordHistoryVisit,
    updateHistoryMetadata,
    requestWindowClose,
    buildBootstrapData,
    installBrowserKeyboardShortcuts,
    onTabCreated,
    onActiveTabChanged,
  } = options;

  const windowWorkspaceCaches = new Map<number, Map<string, WindowWorkspaceCacheRecord>>();
  const windowRightPanelWidths = new Map<number, number>();
  const tabFaviconResolutionTokens = new Map<string, number>();
  const pendingTabHistoryRestores = new Map<string, {
    entries: NavigationEntry[];
    index?: number;
  }>();
  const pendingHistoryOpenSources = new Map<string, {
    source: NonNullable<CreateTabOptions["historyOpenSource"]>;
    createdAt: number;
  }>();
  const tabMemorySaverTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const workspaceMemorySaverTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const tabMetadataBroadcastTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const HISTORY_OPEN_SOURCE_TTL_MS = 45_000;

  function getWorkspaceMemorySaverKey(windowId: number, workspaceId: string) {
    return `${windowId}:${workspaceId}`;
  }

  function cancelTabMemorySaver(tabId: string) {
    const timer = tabMemorySaverTimers.get(tabId);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    tabMemorySaverTimers.delete(tabId);
  }

  function cancelWorkspaceMemorySaver(windowId: number, workspaceId: string) {
    const key = getWorkspaceMemorySaverKey(windowId, workspaceId);
    const timer = workspaceMemorySaverTimers.get(key);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    workspaceMemorySaverTimers.delete(key);
  }

  function cancelTabMetadataBroadcast(windowId: number) {
    const timer = tabMetadataBroadcastTimers.get(windowId);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    tabMetadataBroadcastTimers.delete(windowId);
  }

  function normalizeNavigationEntries(entries: NavigationEntry[]) {
    return entries.flatMap((entry) => {
      const url = typeof entry.url === "string" ? entry.url.trim() : "";
      if (!url) {
        return [];
      }

      return [{
        url,
        title: typeof entry.title === "string" && entry.title.trim()
          ? entry.title.trim()
          : inferTitleFromUrl(url, startPageUrlOptions),
        pageState: typeof entry.pageState === "string" && entry.pageState.trim()
          ? entry.pageState
          : undefined,
      } satisfies NavigationEntry];
    });
  }

  function captureTabNavigationSnapshot(view?: WebContentsView | null) {
    const contents = view?.webContents;
    if (!contents || contents.isDestroyed()) {
      return null;
    }

    try {
      const history = contents.navigationHistory;
      const entries = normalizeNavigationEntries(history.getAllEntries());
      if (entries.length === 0) {
        return null;
      }

      return {
        entries,
        index: Math.min(Math.max(0, history.getActiveIndex()), entries.length - 1),
      };
    } catch {
      return null;
    }
  }

  function rememberTabNavigationSnapshot(tab: TabRecord, view?: WebContentsView | null) {
    const snapshot = captureTabNavigationSnapshot(view);
    if (!snapshot) {
      return;
    }

    tab.historyEntries = snapshot.entries;
    tab.historyIndex = snapshot.index;
    pendingTabHistoryRestores.set(tab.id, snapshot);
  }

  function syncTabRecordFromContents(tab: TabRecord, contents: WebContents) {
    if (contents.isDestroyed()) {
      return;
    }

    try {
      const currentUrl = contents.getURL().trim();
      if (currentUrl) {
        tab.url = currentUrl;
        tab.displayUrl = toDisplayUrl(currentUrl, displayUrlOptions);
      }

      tab.title = contents.getTitle() || tab.title;
      tab.canGoBack = contents.canGoBack();
      tab.canGoForward = contents.canGoForward();
    } catch {
      // Keep the last known tab state if the contents are already tearing down.
    }
  }

  function serializeTabRecord(tab: TabRecord): WindowTabSummary {
    return {
      id: tab.id,
      title: tab.title,
      url: tab.url,
      displayUrl: tab.displayUrl,
      favicon: tab.favicon,
      isLoading: tab.isLoading,
      isAutomationControlled: Boolean(isAutomationControlledTabId?.(tab.id)),
      ...(getTabManualInterventionMessage?.(tab.id)
        ? { manualInterventionMessage: getTabManualInterventionMessage(tab.id) }
        : {}),
    };
  }

  function notifyActiveTabChanged(windowId: number, tabId: string) {
    const view = browserViews.get(tabId);
    const contents = view?.webContents;
    if (!contents || contents.isDestroyed()) {
      return;
    }

    onActiveTabChanged?.({
      windowId,
      tabId,
      contentsId: contents.id,
    });
  }

  function resolveWorkspaceActiveTabId(record: WindowWorkspaceCacheRecord) {
    if (record.activeTabId && record.tabs.has(record.activeTabId)) {
      return record.activeTabId;
    }

    return record.tabs.keys().next().value;
  }

  function getWindowWorkspaceCacheMap(windowId: number, create = false) {
    const existingCacheMap = windowWorkspaceCaches.get(windowId);
    if (existingCacheMap || !create) {
      return existingCacheMap;
    }

    const nextCacheMap = new Map<string, WindowWorkspaceCacheRecord>();
    windowWorkspaceCaches.set(windowId, nextCacheMap);
    return nextCacheMap;
  }

  function takeWindowWorkspaceCache(windowId: number, workspaceId: string) {
    cancelWorkspaceMemorySaver(windowId, workspaceId);
    const cacheMap = getWindowWorkspaceCacheMap(windowId);
    const cachedRecord = cacheMap?.get(workspaceId);
    if (!cacheMap || !cachedRecord) {
      return null;
    }

    cacheMap.delete(workspaceId);
    if (cacheMap.size === 0) {
      windowWorkspaceCaches.delete(windowId);
    }

    return {
      tabs: cachedRecord.tabs,
      activeTabId: resolveWorkspaceActiveTabId(cachedRecord),
    } satisfies WindowWorkspaceCacheRecord;
  }

  function findWindowTabRuntime(windowId: number, tabId: string): WindowTabRuntimeLookupResult | null {
    const currentWorkspaceId = windowToWorkspace.get(windowId) ?? defaultWorkspaceId;
    const currentTabs = tabRecords.get(windowId);
    const currentTab = currentTabs?.get(tabId);

    if (currentTabs && currentTab) {
      return {
        workspaceId: currentWorkspaceId,
        tabs: currentTabs,
        tab: currentTab,
        isCurrentWorkspace: true,
        isActiveTab: windowActiveTabs.get(windowId) === tabId,
      };
    }

    const cacheMap = getWindowWorkspaceCacheMap(windowId);
    if (!cacheMap) {
      return null;
    }

    for (const [workspaceId, cachedRecord] of cacheMap.entries()) {
      const tab = cachedRecord.tabs.get(tabId);
      if (!tab) {
        continue;
      }

      return {
        workspaceId,
        tabs: cachedRecord.tabs,
        tab,
        isCurrentWorkspace: false,
        isActiveTab: resolveWorkspaceActiveTabId(cachedRecord) === tabId,
      };
    }

    return null;
  }

  function findTabWindowContext(tabId: string) {
    const candidateWindowIds = new Set<number>([
      ...tabRecords.keys(),
      ...windowWorkspaceCaches.keys(),
    ]);

    for (const windowId of candidateWindowIds) {
      const targetWindow = BrowserWindow.fromId(windowId);
      if (!targetWindow || targetWindow.isDestroyed()) {
        continue;
      }

      const runtime = findWindowTabRuntime(windowId, tabId);
      if (!runtime) {
        continue;
      }

      return {
        windowId,
        workspaceId: runtime.workspaceId,
        isCurrentWorkspace: runtime.isCurrentWorkspace,
      };
    }

    return null;
  }

  function getWindowMainContentBounds(
    targetWindow: BrowserWindow,
    sidebarWidth: number,
    urlBarHeight: number,
    devToolsHeight = 0,
    rightPanelWidth?: number,
  ): ViewBounds | null {
    const { width: winWidth, height: winHeight } = targetWindow.getContentBounds();
    const rightPanel = rightPanelWidth ?? windowRightPanelWidths.get(targetWindow.id) ?? 0;
    const isLegacyRight = sidebarWidth < 0;
    const leftWidth = isLegacyRight ? 0 : Math.max(0, sidebarWidth);
    const rightWidth = (isLegacyRight ? Math.abs(sidebarWidth) : 0) + Math.max(0, rightPanel);
    const width = winWidth - leftWidth - rightWidth - CONTENT_HORIZONTAL_INSET * 2;
    const height =
      winHeight
      - urlBarHeight
      - devToolsHeight
      - CONTENT_TOP_INSET
      - CONTENT_BOTTOM_INSET
      - CONTENT_TOP_PROGRESS_BAR_HEIGHT;
    if (width <= 0 || height <= 0) {
      return null;
    }

    return {
      x: leftWidth + CONTENT_HORIZONTAL_INSET,
      y: urlBarHeight + CONTENT_TOP_INSET + CONTENT_TOP_PROGRESS_BAR_HEIGHT,
      width,
      height,
    };
  }

  function getActiveTabContentBounds(targetWindow: BrowserWindow): ViewBounds | null {
    const activeTabId = windowActiveTabs.get(targetWindow.id);
    const activeView = activeTabId ? browserViews.get(activeTabId) : undefined;
    if (activeView) {
      return activeView.getBounds();
    }

    const sidebarWidth = windowSidebarWidths.get(targetWindow.id) ?? 0;
    const urlBarHeight = windowUrlBarHeights.get(targetWindow.id) ?? 88;
    return getWindowMainContentBounds(targetWindow, sidebarWidth, urlBarHeight);
  }

  function clampLayoutCoordinate(value: number, max: number) {
    if (!Number.isFinite(value)) {
      return 0;
    }

    if (max <= 0) {
      return 0;
    }

    return Math.min(Math.max(0, Math.round(value)), max);
  }

  function normalizeWindowTabLayout(
    targetWindow: BrowserWindow,
    input: TabLayoutUpdateInput,
  ): WindowTabLayoutState | null {
    const tabs = tabRecords.get(targetWindow.id);
    if (!tabs) {
      return null;
    }

    const { width: windowWidth, height: windowHeight } = targetWindow.getContentBounds();
    const tiles = Array.isArray(input.tiles)
      ? input.tiles
        .filter((tile) => tile && typeof tile.tabId === "string" && tabs.has(tile.tabId))
        .map((tile) => {
          const x = clampLayoutCoordinate(tile.x, windowWidth);
          const y = clampLayoutCoordinate(tile.y, windowHeight);
          const maxWidth = Math.max(0, windowWidth - x);
          const maxHeight = Math.max(0, windowHeight - y);
          const width = clampLayoutCoordinate(tile.width, maxWidth);
          const height = clampLayoutCoordinate(tile.height, maxHeight);

          if (width <= 0 || height <= 0) {
            return null;
          }

          return {
            tabId: tile.tabId,
            x,
            y,
            width,
            height,
          } satisfies WindowTabLayoutTile;
        })
        .filter((tile): tile is WindowTabLayoutTile => Boolean(tile))
      : [];

    const dedupedTiles: WindowTabLayoutTile[] = [];
    const seen = new Set<string>();
    for (const tile of tiles) {
      if (seen.has(tile.tabId)) {
        continue;
      }

      seen.add(tile.tabId);
      dedupedTiles.push(tile);
    }

    if (dedupedTiles.length < 2) {
      return null;
    }

    const focusedTabId = tabs.has(input.focusedTabId) ? input.focusedTabId : dedupedTiles[0].tabId;
    return {
      focusedTabId,
      syncScroll: Boolean(input.syncScroll),
      tiles: dedupedTiles,
    };
  }

  function getWindowTabLayout(windowId: number) {
    const layout = windowTabLayouts.get(windowId);
    const tabs = tabRecords.get(windowId);
    if (!layout || !tabs) {
      return null;
    }

    const tiles = layout.tiles.filter((tile) => tabs.has(tile.tabId));
    if (tiles.length < 2) {
      return null;
    }

    return {
      focusedTabId: tabs.has(layout.focusedTabId) ? layout.focusedTabId : tiles[0].tabId,
      syncScroll: layout.syncScroll,
      tiles,
    } satisfies WindowTabLayoutState;
  }

  function areWindowTabLayoutsEqual(
    left: WindowTabLayoutState | null | undefined,
    right: WindowTabLayoutState | null | undefined,
  ) {
    if (!left || !right) {
      return left === right;
    }

    return left.focusedTabId === right.focusedTabId
      && left.syncScroll === right.syncScroll
      && left.tiles.length === right.tiles.length
      && left.tiles.every((leftTile, index) => {
        const rightTile = right.tiles[index];
        return Boolean(rightTile)
          && leftTile.tabId === rightTile.tabId
          && leftTile.x === rightTile.x
          && leftTile.y === rightTile.y
          && leftTile.width === rightTile.width
          && leftTile.height === rightTile.height;
      });
  }

  function getVisibleTabIdsForWindow(windowId: number) {
    const layout = getWindowTabLayout(windowId);
    if (layout) {
      return layout.tiles.map((tile) => tile.tabId);
    }

    const activeTabId = windowActiveTabs.get(windowId);
    return activeTabId ? [activeTabId] : [];
  }

  function broadcastSidebarTabDragState(windowId: number) {
    const isActive = windowSidebarDragTabs.has(windowId);
    getVisibleTabIdsForWindow(windowId).forEach((tabId) => {
      const view = browserViews.get(tabId);
      const contents = view?.webContents;
      if (!contents || contents.isDestroyed()) {
        return;
      }

      contents.send("tab:sidebar-drag-state", isActive);
    });
  }

  function cancelSidebarTabDragClearTimer(windowId: number) {
    const timer = windowSidebarDragClearTimers.get(windowId);
    if (timer) {
      clearTimeout(timer);
      windowSidebarDragClearTimers.delete(windowId);
    }
  }

  function findTabByContents(targetContents: WebContents) {
    for (const [tabId, view] of browserViews.entries()) {
      const contents = view.webContents;
      if (!contents || contents.id !== targetContents.id) {
        continue;
      }

      for (const [windowId] of tabRecords.entries()) {
        const runtime = findWindowTabRuntime(windowId, tabId);
        if (!runtime) {
          continue;
        }

        const targetWindow = BrowserWindow.fromId(windowId);
        if (!targetWindow || targetWindow.isDestroyed()) {
          return null;
        }

        return {
          targetWindow,
          tabId,
          runtime,
        };
      }
    }

    return null;
  }

  function findWorkspaceWindow(workspaceId: string, excludeWindowId?: number) {
    return BrowserWindow.getAllWindows()
      .filter((candidateWindow) => !candidateWindow.isDestroyed())
      .filter((candidateWindow) => candidateWindow.id !== excludeWindowId)
      .filter((candidateWindow) => (
        windowToWorkspace.get(candidateWindow.id) ?? defaultWorkspaceId
      ) === workspaceId)
      .sort((left, right) => {
        if (left.isFocused() !== right.isFocused()) {
          return Number(right.isFocused()) - Number(left.isFocused());
        }

        if (left.isVisible() !== right.isVisible()) {
          return Number(right.isVisible()) - Number(left.isVisible());
        }

        return left.id - right.id;
      })[0];
  }

  function shouldTriggerTabLoad(tab: TabRecord, targetContents: WebContents) {
    if (tab.url === "nexus://start" || tab.url.startsWith("nexus://") || tab.url === "milo://home" || tab.url.startsWith("milo://") || tab.url === "about:blank") {
      return false;
    }

    if (!tab.hasLoaded) {
      return true;
    }

    if (targetContents.isLoading() || targetContents.isLoadingMainFrame() || targetContents.isWaitingForResponse()) {
      return false;
    }

    try {
      const currentUrl = targetContents.getURL();
      return currentUrl.length === 0 || currentUrl === "about:blank";
    } catch {
      return true;
    }
  }

  function ensureTabViewLoaded(targetWindow: BrowserWindow, tabId: string) {
    const tab = tabRecords.get(targetWindow.id)?.get(tabId);
    if (!tab || tab.url === "nexus://start" || tab.url.startsWith("nexus://") || tab.url === "milo://home" || tab.url.startsWith("milo://") || tab.url === "about:blank") {
      return;
    }
    const view = ensureTabBrowserView(targetWindow, tabId);
    const contents = view?.webContents;
    if (!view || !contents || contents.isDestroyed()) {
      return;
    }

    cancelTabMemorySaver(tabId);
    void ensureContentsOverrides(contents);
    if (!shouldTriggerTabLoad(tab, contents)) {
      return;
    }

    const requestedUrl = tab.url;
    const pendingHistoryRestore = pendingTabHistoryRestores.get(tabId)
      ?? (tab.historyEntries && tab.historyEntries.length > 0
        ? { entries: tab.historyEntries, index: tab.historyIndex }
        : undefined);
    tab.hasLoaded = true;
    tab.isLoading = true;
    tab.canGoBack = false;
    tab.canGoForward = false;
    if (findWindowTabRuntime(targetWindow.id, tabId)?.isCurrentWorkspace) {
      broadcastTabState(targetWindow);
    }
    const loadPromise = pendingHistoryRestore && pendingHistoryRestore.entries.length > 0
      ? contents.navigationHistory.restore({
        entries: pendingHistoryRestore.entries,
        ...(Number.isFinite(pendingHistoryRestore.index)
          ? { index: pendingHistoryRestore.index }
          : {}),
      })
      : contents.loadURL(requestedUrl);

    void loadPromise
      .then(() => {
        pendingTabHistoryRestores.delete(tabId);
      })
      .catch(() => {
        const latestTab = tabRecords.get(targetWindow.id)?.get(tabId);
        if (!latestTab || latestTab.url !== requestedUrl) {
          return;
        }

        latestTab.hasLoaded = false;
        latestTab.isLoading = false;
        if (findWindowTabRuntime(targetWindow.id, tabId)?.isCurrentWorkspace) {
          broadcastTabState(targetWindow);
        }
      });
  }

  function updateBrowserViewBounds(targetWindow: BrowserWindow, rightPanelWidth?: number) {
    const windowId = targetWindow.id;
    if (typeof rightPanelWidth === "number") {
      windowRightPanelWidths.set(windowId, rightPanelWidth);
    }
    const sidebarWidth = windowSidebarWidths.get(windowId) ?? 200;
    const urlBarHeight = windowUrlBarHeights.get(windowId) ?? 88;
    if (urlBarHeight >= 9000 || sidebarWidth >= 9000) {
      detachWindowActiveBrowserView(targetWindow);
      return;
    }
    const { height: winHeight } = targetWindow.getContentBounds();
    const isDevToolsOpen = targetWindow.webContents.isDevToolsOpened();
    const devToolsHeight = isDevToolsOpen ? Math.floor(winHeight * 0.4) : 0;
    const bounds = getWindowMainContentBounds(
      targetWindow,
      sidebarWidth,
      urlBarHeight,
      devToolsHeight,
      rightPanelWidth,
    );
    if (!bounds) {
      detachWindowActiveBrowserView(targetWindow);
      return;
    }

    const layout = getWindowTabLayout(windowId);
    if (layout) {
      for (const tile of layout.tiles) {
        const view = browserViews.get(tile.tabId);
        if (!view) {
          continue;
        }

        const x = bounds.x + clampLayoutCoordinate(tile.x, bounds.width);
        const y = bounds.y + clampLayoutCoordinate(tile.y, bounds.height);
        const width = clampLayoutCoordinate(tile.width, Math.max(0, bounds.width - (x - bounds.x)));
        const height = clampLayoutCoordinate(tile.height, Math.max(0, bounds.height - (y - bounds.y)));
        if (width <= 0 || height <= 0) {
          continue;
        }

        view.setBounds({ x, y, width, height });
        view.setBorderRadius(CONTENT_RADIUS);
      }
    } else {
      const activeTabId = windowActiveTabs.get(windowId);
      const view = activeTabId ? browserViews.get(activeTabId) : undefined;
      if (!view) {
        return;
      }

      const tabs = tabRecords.get(windowId);
      const activeTab = activeTabId ? tabs?.get(activeTabId) : undefined;
      const isStartTab = !activeTab?.url || activeTab.url === "nexus://start" || activeTab.url.startsWith("nexus://") || activeTab.url === "about:blank";
      if (isStartTab) {
        detachWindowActiveBrowserView(targetWindow);
        return;
      }

      try {
        const currentChildren = (targetWindow.contentView as any).children || [];
        if (!currentChildren.includes(view)) {
          targetWindow.contentView.addChildView(view);
        }
      } catch {}

      view.setBounds(bounds);
      view.setBorderRadius(CONTENT_RADIUS);
    }

    updateLinkPreviewBounds(targetWindow);
    updateWindowOverlayBounds(targetWindow);
  }

  function detachWindowActiveBrowserView(targetWindow: BrowserWindow) {
    if (targetWindow.isDestroyed()) {
      return;
    }

    try {
      const children = Array.from((targetWindow.contentView as any).children || []);
      for (const child of children) {
        try { targetWindow.contentView.removeChildView(child as any); } catch {}
      }
    } catch {}
  }

  function attachWindowActiveBrowserView(targetWindow: BrowserWindow) {
    if (targetWindow.isDestroyed()) {
      return;
    }

    const visibleTabIds = getVisibleTabIdsForWindow(targetWindow.id);
    if (visibleTabIds.length === 0) {
      return;
    }

    for (const tabId of visibleTabIds) {
      const tab = tabRecords.get(targetWindow.id)?.get(tabId);
      // Skip overlaying native view when the tab is on the start page or empty
      if (!tab || tab.url === "nexus://start" || tab.url === "milo://home" || tab.url === "about:blank") {
        const existingView = browserViews.get(tabId);
        if (existingView) {
          try { targetWindow.contentView.removeChildView(existingView); } catch {}
        }
        continue;
      }

      cancelTabMemorySaver(tabId);
      const view = ensureTabBrowserView(targetWindow, tabId);
      if (!view) {
        continue;
      }

      targetWindow.contentView.addChildView(view);
      ensureTabViewLoaded(targetWindow, tabId);
    }

    updateBrowserViewBounds(targetWindow);
  }

  function closeTabViewSoon(view: WebContentsView) {
    setImmediate(() => {
      const contents = view.webContents;
      if (contents && !contents.isDestroyed()) {
        contents.close();
      }
    });
  }

  function discardCreatedTab(
    targetWindow: BrowserWindow,
    tabId: string,
    view: WebContentsView,
    contentsId: number,
  ) {
    const tabs = tabRecords.get(targetWindow.id);
    tabs?.delete(tabId);
    if (tabs && tabs.size === 0) {
      tabRecords.delete(targetWindow.id);
    }

    if (windowActiveTabs.get(targetWindow.id) === tabId) {
      windowActiveTabs.delete(targetWindow.id);
    }

    browserViews.delete(tabId);
    tabFaviconResolutionTokens.delete(tabId);

    if (!targetWindow.isDestroyed()) {
      try {
        targetWindow.contentView.removeChildView(view);
      } catch {
        // Ignore when the view was never attached.
      }
    }

    const contents = view.webContents;
    if (!contents || contents.isDestroyed()) {
      cleanupManagedContents(contentsId);
      return;
    }

    closeTabViewSoon(view);
  }

  function disposeTabBrowserView(targetWindow: BrowserWindow, tabId: string) {
    cancelTabMemorySaver(tabId);
    const view = browserViews.get(tabId);
    if (view) {
      if (!targetWindow.isDestroyed()) {
        try {
          targetWindow.contentView.removeChildView(view);
        } catch {
          // Ignore when the view is already detached.
        }
      }

      const contents = view.webContents;
      if (contents && !contents.isDestroyed()) {
        cleanupManagedContents(contents.id);
        contents.close();
      }

      browserViews.delete(tabId);
    }

    tabFaviconResolutionTokens.delete(tabId);
  }

  function disposeCachedWorkspaceEntriesForWindow(
    targetWindow: BrowserWindow,
    workspaceIds?: ReadonlySet<string>,
  ) {
    const cacheMap = getWindowWorkspaceCacheMap(targetWindow.id);
    if (!cacheMap) {
      return;
    }

    for (const [workspaceId, cachedRecord] of Array.from(cacheMap.entries())) {
      if (workspaceIds && !workspaceIds.has(workspaceId)) {
        continue;
      }

      cancelWorkspaceMemorySaver(targetWindow.id, workspaceId);
      for (const tabId of cachedRecord.tabs.keys()) {
        disposeTabBrowserView(targetWindow, tabId);
      }

      cacheMap.delete(workspaceId);
    }

    if (cacheMap.size === 0) {
      windowWorkspaceCaches.delete(targetWindow.id);
    }
  }

  function broadcastTabState(
    targetWindow: BrowserWindow,
    options: BroadcastTabStateOptions = {},
  ) {
    if (targetWindow.isDestroyed()) {
      return;
    }

    const windowId = targetWindow.id;
    const tabs = tabRecords.get(windowId);
    if (!tabs) return;
    const {
      persistWorkspaceSession: shouldPersistWorkspaceSession = true,
      broadcastWorkspaceContext: shouldBroadcastWorkspaceContext = true,
      updateWindowTitle: shouldUpdateWindowTitle = true,
    } = options;

    if (shouldPersistWorkspaceSession || shouldBroadcastWorkspaceContext) {
      cancelTabMetadataBroadcast(windowId);
    }

    const tabList = Array.from(tabs.values()).map(serializeTabRecord);
    targetWindow.webContents.send("tab:state-update", {
      workspaceId: windowToWorkspace.get(windowId) ?? defaultWorkspaceId,
      tabs: tabList,
      activeTabId: windowActiveTabs.get(windowId) ?? null,
    });

    const windowState = windows.get(windowId);
    if (windowState) {
      windowState.tabs = tabList;
      windowState.activeTabId = windowActiveTabs.get(windowId);
      if (shouldPersistWorkspaceSession) {
        persistWorkspaceSessionForWindow(windowId);
      }
      if (shouldUpdateWindowTitle) {
        updateWindowTitle(targetWindow);
      }
      if (shouldBroadcastWorkspaceContext) {
        broadcastWorkspaceContext();
      }
    }
  }

  function scheduleTabMetadataBroadcast(targetWindow: BrowserWindow) {
    if (targetWindow.isDestroyed()) {
      return;
    }

    const windowId = targetWindow.id;
    if (tabMetadataBroadcastTimers.has(windowId)) {
      return;
    }

    const timer = setTimeout(() => {
      tabMetadataBroadcastTimers.delete(windowId);
      const latestWindow = BrowserWindow.fromId(windowId);
      if (!latestWindow || latestWindow.isDestroyed()) {
        return;
      }

      broadcastTabState(latestWindow, {
        persistWorkspaceSession: false,
        broadcastWorkspaceContext: false,
      });
    }, TAB_METADATA_BROADCAST_DELAY_MS);
    tabMetadataBroadcastTimers.set(windowId, timer);
  }

  function formatTabDebugValue(value: unknown) {
    if (typeof value === "string") {
      return JSON.stringify(value);
    }

    if (
      typeof value === "number"
      || typeof value === "boolean"
      || value === null
      || value === undefined
    ) {
      return String(value);
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  function debugTabLoadingEvent(
    targetWindow: BrowserWindow,
    tabId: string,
    webContents: WebContents,
    eventName: string,
    details: Record<string, unknown> = {},
  ) {
    if (!tabLoadingDebugEnabled) {
      return;
    }

    const baseDetails: Record<string, unknown> = {
      ts: new Date().toISOString(),
      windowId: targetWindow.id,
      tabId,
      contentsId: webContents.id,
      event: eventName,
      webContentsLoading: webContents.isLoading(),
    };

    try {
      baseDetails.currentUrl = webContents.getURL();
    } catch {
      baseDetails.currentUrl = undefined;
    }

    const message = Object.entries({
      ...baseDetails,
      ...details,
    })
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${formatTabDebugValue(value)}`)
      .join(" ");

    console.log(`[TabDebug] ${message}`);
  }

  function resolveProfileIdForTabRuntime(runtime: WindowTabRuntimeLookupResult | null) {
    return workspaces.get(runtime?.workspaceId ?? defaultWorkspaceId)?.profileId ?? defaultWorkspaceId;
  }

  function scheduleUserScriptInjection(
    targetWindow: BrowserWindow,
    tabId: string,
    webContents: WebContents,
    url: string,
    reason: string,
  ) {
    if (!injectUserScriptsForPage || webContents.isDestroyed()) {
      return;
    }

    const runtime = findWindowTabRuntime(targetWindow.id, tabId);
    if (!runtime?.tab) {
      return;
    }

    const profileId = resolveProfileIdForTabRuntime(runtime);
    void Promise.resolve(injectUserScriptsForPage(profileId, webContents, url))
      .catch((error) => {
        console.warn(`[Tabs] Failed to inject user scripts after ${reason}.`, error);
      });
  }

  function refreshUserScriptsAfterSameDocumentNavigation(
    targetWindow: BrowserWindow,
    tabId: string,
    webContents: WebContents,
    url: string,
    reason: string,
  ) {
    clearUserScriptsForContents?.(webContents.id);
    void Promise.resolve(cleanupUserScriptUiForContents?.(webContents))
      .catch((error) => {
        console.warn(`[Tabs] Failed to clean up user script UI after ${reason}.`, error);
      })
      .then(() => {
        scheduleUserScriptInjection(targetWindow, tabId, webContents, url, reason);
      });
  }

  function refreshPopupUserScriptsAfterSameDocumentNavigation(
    profileId: string,
    webContents: WebContents,
    url: string,
    reason: string,
  ) {
    clearUserScriptsForContents?.(webContents.id);
    void Promise.resolve(cleanupUserScriptUiForContents?.(webContents))
      .catch((error) => {
        console.warn(`[Tabs] Failed to clean up popup user script UI after ${reason}.`, error);
      })
      .then(() => {
        if (webContents.isDestroyed()) {
          return;
        }
        void Promise.resolve(injectUserScriptsForPage?.(profileId, webContents, url))
          .catch((error) => {
            console.warn(`[Tabs] Failed to inject popup user scripts after ${reason}.`, error);
          });
      });
  }

  function bumpTabFaviconResolutionToken(tabId: string) {
    const nextToken = (tabFaviconResolutionTokens.get(tabId) ?? 0) + 1;
    tabFaviconResolutionTokens.set(tabId, nextToken);
    return nextToken;
  }

  function getTabFaviconResolutionToken(tabId: string) {
    return tabFaviconResolutionTokens.get(tabId) ?? 0;
  }

  function isSupportedFaviconUrl(url: string) {
    try {
      const protocol = new URL(url).protocol;
      return protocol === "http:" || protocol === "https:" || protocol === "file:" || protocol === "data:";
    } catch {
      return false;
    }
  }

  function buildDefaultFaviconUrl(url: string) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return undefined;
      }
      return new URL("/favicon.ico", parsed.origin).toString();
    } catch {
      return undefined;
    }
  }

  function normalizeFaviconCandidates(rawCandidates: unknown, pageUrl: string) {
    const candidates: string[] = [];
    const seen = new Set<string>();

    const appendCandidate = (value: unknown) => {
      if (typeof value !== "string" || !value || !isSupportedFaviconUrl(value) || seen.has(value)) {
        return;
      }
      seen.add(value);
      candidates.push(value);
    };

    if (Array.isArray(rawCandidates)) {
      rawCandidates.forEach(appendCandidate);
    }

    appendCandidate(buildDefaultFaviconUrl(pageUrl));
    return candidates;
  }

  async function resolveTabFaviconFallback(
    tabId: string,
    targetWindow: BrowserWindow,
    webContents: WebContents,
    reason: string,
  ) {
    if (webContents.isDestroyed()) {
      return;
    }

    const initialRuntime = findWindowTabRuntime(targetWindow.id, tabId);
    const tab = initialRuntime?.tab;
    if (!tab || tab.favicon || !isTrackableHistoryUrl(tab.url)) {
      return;
    }

    const pageUrl = tab.url;
    const resolutionToken = getTabFaviconResolutionToken(tabId);
    let rawCandidates: unknown = [];

    try {
      rawCandidates = await webContents.executeJavaScript(FAVICON_CANDIDATES_SCRIPT, true);
    } catch (error) {
      debugTabLoadingEvent(targetWindow, tabId, webContents, "favicon-fallback-script-failed", {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const candidates = normalizeFaviconCandidates(rawCandidates, pageUrl);
    if (!candidates.length) {
      return;
    }

    const latestRuntime = findWindowTabRuntime(targetWindow.id, tabId);
    const latestTab = latestRuntime?.tab;
    if (
      !latestTab
      || latestTab.url !== pageUrl
      || latestTab.favicon
      || getTabFaviconResolutionToken(tabId) !== resolutionToken
    ) {
      return;
    }

    latestTab.favicon = candidates[0];
    updateHistoryMetadata(
      workspaces.get(latestRuntime?.workspaceId ?? defaultWorkspaceId)?.profileId ?? defaultWorkspaceId,
      latestTab.url,
      {
      favicon: latestTab.favicon,
      },
    );
    debugTabLoadingEvent(targetWindow, tabId, webContents, "favicon-fallback-resolved", {
      reason,
      favicon: latestTab.favicon,
      candidateCount: candidates.length,
    });

    if (latestRuntime?.isCurrentWorkspace) {
      scheduleTabMetadataBroadcast(targetWindow);
    }
  }

  function getWorkspaceWindowContext(targetWindow: BrowserWindow) {
    const workspaceId = windowToWorkspace.get(targetWindow.id) ?? defaultWorkspaceId;
    const workspace = workspaces.get(workspaceId);
    return {
      workspaceId,
      workspace,
    };
  }

  function isAutomationWorkspace(workspace?: WorkspaceRecord) {
    return workspace?.tags?.includes("automation") ?? false;
  }

  function canPutTabViewInMemorySaver(tabId: string, runtime: WindowTabRuntimeLookupResult) {
    if (isAutomationControlledTabId?.(tabId)) {
      return false;
    }

    return !isAutomationWorkspace(workspaces.get(runtime.workspaceId));
  }

  function discardDormantTabBrowserView(
    targetWindow: BrowserWindow,
    tabId: string,
    reason: string,
  ) {
    const runtime = findWindowTabRuntime(targetWindow.id, tabId);
    if (!runtime || !canPutTabViewInMemorySaver(tabId, runtime)) {
      return;
    }

    if (runtime.isCurrentWorkspace && getVisibleTabIdsForWindow(targetWindow.id).includes(tabId)) {
      return;
    }

    const view = browserViews.get(tabId);
    const contents = view?.webContents;
    if (!view || !contents || contents.isDestroyed()) {
      browserViews.delete(tabId);
      return;
    }

    if (contents.isDevToolsOpened()) {
      return;
    }

    syncTabRecordFromContents(runtime.tab, contents);
    rememberTabNavigationSnapshot(runtime.tab, view);
    runtime.tab.isLoading = false;
    runtime.tab.hasLoaded = false;

    cancelTabMemorySaver(tabId);
    browserViews.delete(tabId);
    tabFaviconResolutionTokens.delete(tabId);

    if (!targetWindow.isDestroyed()) {
      try {
        targetWindow.contentView.removeChildView(view);
      } catch {
        // Ignore when the view is already detached.
      }
    }

    cleanupManagedContents(contents.id);
    clearPageTranslationState(contents.id);
    clearUserScriptsForContents?.(contents.id);
    closeTabViewSoon(view);

    debugTabLoadingEvent(targetWindow, tabId, contents, "memory-saver-discard", {
      reason,
      workspaceId: runtime.workspaceId,
    });

    if (runtime.isCurrentWorkspace) {
      broadcastTabState(targetWindow);
    }
  }

  function scheduleTabMemorySaver(targetWindow: BrowserWindow, tabId: string) {
    if (tabMemorySaverTimers.has(tabId)) {
      return;
    }

    const runtime = findWindowTabRuntime(targetWindow.id, tabId);
    if (!runtime || !canPutTabViewInMemorySaver(tabId, runtime)) {
      return;
    }

    if (runtime.isCurrentWorkspace && getVisibleTabIdsForWindow(targetWindow.id).includes(tabId)) {
      cancelTabMemorySaver(tabId);
      return;
    }

    if (!browserViews.has(tabId)) {
      return;
    }

    const windowId = targetWindow.id;
    const timer = setTimeout(() => {
      tabMemorySaverTimers.delete(tabId);
      const liveWindow = BrowserWindow.fromId(windowId);
      if (!liveWindow || liveWindow.isDestroyed()) {
        return;
      }

      discardDormantTabBrowserView(liveWindow, tabId, "tab-idle");
    }, TAB_MEMORY_SAVER_IDLE_MS);
    tabMemorySaverTimers.set(tabId, timer);
  }

  function discardCachedWorkspaceBrowserViews(
    targetWindow: BrowserWindow,
    workspaceId: string,
  ) {
    const cacheMap = getWindowWorkspaceCacheMap(targetWindow.id);
    const cachedRecord = cacheMap?.get(workspaceId);
    if (!cachedRecord) {
      return;
    }

    for (const tabId of cachedRecord.tabs.keys()) {
      discardDormantTabBrowserView(targetWindow, tabId, "workspace-idle");
    }
  }

  function scheduleWorkspaceMemorySaver(targetWindow: BrowserWindow, workspaceId: string) {
    const windowId = targetWindow.id;
    if ((windowToWorkspace.get(windowId) ?? defaultWorkspaceId) === workspaceId) {
      cancelWorkspaceMemorySaver(windowId, workspaceId);
      return;
    }

    if (isAutomationWorkspace(workspaces.get(workspaceId))) {
      return;
    }

    const cacheMap = getWindowWorkspaceCacheMap(windowId);
    if (!cacheMap?.has(workspaceId)) {
      return;
    }

    const key = getWorkspaceMemorySaverKey(windowId, workspaceId);
    if (workspaceMemorySaverTimers.has(key)) {
      return;
    }

    const timer = setTimeout(() => {
      workspaceMemorySaverTimers.delete(key);
      const liveWindow = BrowserWindow.fromId(windowId);
      if (!liveWindow || liveWindow.isDestroyed()) {
        return;
      }

      if ((windowToWorkspace.get(windowId) ?? defaultWorkspaceId) === workspaceId) {
        return;
      }

      discardCachedWorkspaceBrowserViews(liveWindow, workspaceId);
    }, WORKSPACE_MEMORY_SAVER_IDLE_MS);
    workspaceMemorySaverTimers.set(key, timer);
  }

  function refreshMemorySaverForWindow(targetWindow: BrowserWindow) {
    if (targetWindow.isDestroyed()) {
      return;
    }

    const windowId = targetWindow.id;
    const visibleTabIds = new Set(getVisibleTabIdsForWindow(windowId));
    const currentTabs = tabRecords.get(windowId);
    if (currentTabs) {
      for (const tabId of currentTabs.keys()) {
        if (visibleTabIds.has(tabId)) {
          cancelTabMemorySaver(tabId);
        } else {
          scheduleTabMemorySaver(targetWindow, tabId);
        }
      }
    }

    const cacheMap = getWindowWorkspaceCacheMap(windowId);
    if (!cacheMap) {
      return;
    }

    for (const workspaceId of cacheMap.keys()) {
      scheduleWorkspaceMemorySaver(targetWindow, workspaceId);
    }
  }

  function buildHistoryOpenSourceFromTab(
    tab: TabRecord | undefined,
    linkUrl: string,
  ): CreateTabOptions["historyOpenSource"] | undefined {
    if (!tab || !isTrackableHistoryUrl(tab.url) || tab.url === linkUrl) {
      return undefined;
    }

    return {
      url: tab.url,
      title: tab.title,
      linkUrl,
      openedAt: Date.now(),
    };
  }

  function rememberHistoryOpenSource(
    tabId: string,
    source: CreateTabOptions["historyOpenSource"] | undefined,
  ) {
    if (!source) {
      return;
    }

    pendingHistoryOpenSources.set(tabId, {
      source,
      createdAt: Date.now(),
    });
  }

  function takeHistoryOpenSource(tabId: string) {
    const pending = pendingHistoryOpenSources.get(tabId);
    if (!pending) {
      return undefined;
    }

    pendingHistoryOpenSources.delete(tabId);
    if (Date.now() - pending.createdAt > HISTORY_OPEN_SOURCE_TTL_MS) {
      return undefined;
    }

    return pending.source;
  }

  function resolveTabCreationUrl(url: string | undefined, preserveRawUrl: boolean) {
    if (preserveRawUrl) {
      const value = url?.trim() ?? "";
      return value || "about:blank";
    }

    return resolveInputToUrl(url ?? "", resolveInputToUrlOptions);
  }

  function createWindowOpenBrowserWindowOptions(partition: string): BrowserWindowConstructorOptions {
    return {
      webPreferences: {
        preload: preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        spellcheck: true,
        backgroundThrottling: false,
        partition,
        additionalArguments: ["--milo-window-open=1"],
      },
    };
  }

  function buildHistoryOpenSourceFromContents(
    contents: WebContents,
    linkUrl: string,
  ): CreateTabOptions["historyOpenSource"] | undefined {
    let currentUrl = "";
    let currentTitle = "";
    try {
      currentUrl = contents.getURL();
      currentTitle = contents.getTitle();
    } catch {
      return undefined;
    }

    if (!currentUrl || !isTrackableHistoryUrl(currentUrl) || currentUrl === linkUrl) {
      return undefined;
    }

    return {
      url: currentUrl,
      title: currentTitle || undefined,
      linkUrl,
      openedAt: Date.now(),
    };
  }

  function readExistingViewState(view?: WebContentsView | null) {
    const contents = view?.webContents;
    if (!contents || contents.isDestroyed()) {
      return null;
    }

    const webContents = contents;
    const isLoading =
      webContents.isLoading()
      || webContents.isLoadingMainFrame()
      || webContents.isWaitingForResponse();

    let currentUrl = "";
    let currentTitle = "";
    let canGoBack = false;
    let canGoForward = false;

    try {
      currentUrl = webContents.getURL().trim();
      currentTitle = webContents.getTitle().trim();
      canGoBack = webContents.canGoBack();
      canGoForward = webContents.canGoForward();
    } catch {
      return {
        url: null,
        title: "",
        isLoading,
        canGoBack: false,
        canGoForward: false,
        hasLoaded: isLoading,
      };
    }

    const hasCommittedUrl = currentUrl.length > 0 && currentUrl !== "about:blank";
    return {
      url: hasCommittedUrl ? currentUrl : null,
      title: currentTitle,
      isLoading,
      canGoBack,
      canGoForward,
      hasLoaded: hasCommittedUrl || isLoading,
    };
  }

  function createTabWebContentsView(partition: string) {
    const view = new WebContentsView({
      webPreferences: {
        preload: preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
        partition,
        additionalArguments: ["--milo-tab-view=1"],
      },
    });
    view.webContents.setBackgroundThrottling(false);
    view.setBorderRadius(CONTENT_RADIUS);
    return view;
  }

  function registerTabBrowserView(
    targetWindow: BrowserWindow,
    tabId: string,
    tab: TabRecord,
    workspaceId: string,
    workspace: WorkspaceRecord | undefined,
    view: WebContentsView,
  ) {
    const partition = buildWorkspacePartition(workspace?.profileId ?? defaultWorkspaceId);
    ensureMiloProtocolForPartition(partition);
    ensureDownloadHandlingForPartition(partition);

    browserViews.set(tabId, view);
    const contents = view.webContents;
    const contentsId = contents.id;
    applyResolvedUserAgentToContents(contents, tab.url);
    contents.once("destroyed", () => {
      cleanupManagedContents(contentsId);
      clearUserScriptsForContents?.(contentsId);
      cancelTabMemorySaver(tabId);

      const currentTabs = tabRecords.get(targetWindow.id);
      const currentView = browserViews.get(tabId);
      const currentContents = currentView?.webContents;
      if (
        targetWindow.isDestroyed()
        || !currentTabs?.has(tabId)
        || !currentContents
        || currentContents.id !== contentsId
      ) {
        return;
      }

      pendingTabHistoryRestores.delete(tabId);
      pendingHistoryOpenSources.delete(tabId);
      handleTabClose(targetWindow, tabId);
    });

    registerGuestContents(workspaceId, contents);
    setupTabWebContentsEvents(tabId, targetWindow, contents, handleTabCreate, handleTabClose);
    setupBrowserViewContextMenu(targetWindow, contents);
    return view;
  }

  function ensureTabBrowserView(targetWindow: BrowserWindow, tabId: string) {
    const existingView = browserViews.get(tabId);
    const existingContents = existingView?.webContents;
    if (existingView && existingContents && !existingContents.isDestroyed()) {
      return existingView;
    }

    if (existingView) {
      browserViews.delete(tabId);
    }

    const runtime = findWindowTabRuntime(targetWindow.id, tabId);
    if (!runtime) {
      return null;
    }

    const workspace = workspaces.get(runtime.workspaceId);
    const partition = buildWorkspacePartition(workspace?.profileId ?? defaultWorkspaceId);
    return registerTabBrowserView(
      targetWindow,
      tabId,
      runtime.tab,
      runtime.workspaceId,
      workspace,
      createTabWebContentsView(partition),
    );
  }

  function setupWindowOpenBrowserWindow(
    ownerWindow: BrowserWindow,
    popupWindow: BrowserWindow,
    details: DidCreateWindowDetails,
    workspaceId: string,
    workspace: WorkspaceRecord | undefined,
    openerTabId: string,
    historyOpenSource?: CreateTabOptions["historyOpenSource"],
  ) {
    if (popupWindow.isDestroyed()) {
      return;
    }

    const popupContents = popupWindow.webContents;
    const popupContentsId = popupContents.id;
    const profileId = workspace?.profileId ?? defaultWorkspaceId;
    const initialUrl = details.url || popupContents.getURL();
    let pendingHistoryOpenSource = historyOpenSource;

    popupWindow.setMenuBarVisibility(false);
    popupContents.setBackgroundThrottling(false);
    applyResolvedUserAgentToContents(popupContents, initialUrl);
    void ensureContentsOverrides(popupContents, { targetUrl: initialUrl });
    registerGuestContents(workspaceId, popupContents, { automationTargetEligible: false });
    setupBrowserViewContextMenu(ownerWindow, popupContents);

    popupContents.once("destroyed", () => {
      cleanupManagedContents(popupContentsId);
      clearUserScriptsForContents?.(popupContentsId);
    });

    popupContents.on("did-start-navigation", (_event, url, isInPlace, isMainFrame) => {
      if (!isMainFrame || isInPlace) {
        return;
      }

      applyResolvedUserAgentToContents(popupContents, url);
      clearPageTranslationState(popupContentsId);
      clearUserScriptsForContents?.(popupContentsId);
      void ensureContentsOverrides(popupContents, { targetUrl: url });
    });

    popupContents.on("will-navigate", (event, url) => {
      if (handlePageTranslationCommandUrl(ownerWindow, popupContents, url)) {
        event.preventDefault();
      }
    });

    popupContents.on("did-navigate", (_event, url) => {
      popupWindow.setTitle(popupContents.getTitle() || inferTitleFromUrl(url, startPageUrlOptions));
      const openedFrom = pendingHistoryOpenSource;
      pendingHistoryOpenSource = undefined;
      recordHistoryVisit(profileId, url, {
        title: popupContents.getTitle() || undefined,
        openedFrom,
      });
    });

    popupContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (!isMainFrame) {
        return;
      }

      const openedFrom = pendingHistoryOpenSource;
      pendingHistoryOpenSource = undefined;
      recordHistoryVisit(profileId, url, {
        title: popupContents.getTitle() || undefined,
        openedFrom,
      });
      refreshPopupUserScriptsAfterSameDocumentNavigation(
        profileId,
        popupContents,
        url,
        "popup did-navigate-in-page",
      );
    });

    popupContents.on("did-finish-load", () => {
      void handlePageTranslationNavigation(ownerWindow, popupContents);
      void injectUserScriptsForPage?.(profileId, popupContents, popupContents.getURL());
    });

    popupContents.on("page-title-updated", (_event, title) => {
      popupWindow.setTitle(title || popupWindow.getTitle());
      updateHistoryMetadata(profileId, popupContents.getURL(), {
        title: title || undefined,
      });
    });

    popupContents.on("page-favicon-updated", (_event, favicons) => {
      updateHistoryMetadata(profileId, popupContents.getURL(), {
        favicon: favicons[0],
      });
    });

    popupContents.setWindowOpenHandler((nestedDetails) => {
      if (handlePageTranslationCommandUrl(ownerWindow, popupContents, nestedDetails.url)) {
        return {
          action: "deny",
        };
      }

      const nestedHistoryOpenSource = buildHistoryOpenSourceFromContents(
        popupContents,
        nestedDetails.url,
      );
      popupContents.once("did-create-window", (nestedWindow, nestedCreateDetails) => {
        setupWindowOpenBrowserWindow(
          ownerWindow,
          nestedWindow,
          nestedCreateDetails,
          workspaceId,
          workspace,
          openerTabId,
          nestedHistoryOpenSource,
        );
      });

      return {
        action: "allow",
        outlivesOpener: false,
        overrideBrowserWindowOptions: createWindowOpenBrowserWindowOptions(
          buildWorkspacePartition(profileId),
        ),
      };
    });
  }

  function setupTabWebContentsEvents(
    tabId: string,
    targetWindow: BrowserWindow,
    webContents: WebContents,
    handleTabCreate: (targetWindow: BrowserWindow, url?: string, options?: CreateTabOptions) => TabRecord,
    handleTabClose: (targetWindow: BrowserWindow, tabId: string) => { activeTabId: string },
  ) {
    const runReversedHistoryNavigation = async (
      requestedDirection: "back" | "forward",
    ) => {
      const direction = requestedDirection === "back" ? "forward" : "back";
      if (!shouldHandleTabHistoryNavigation(targetWindow.id, direction, tabId)) {
        return;
      }

      if (direction === "back") {
        if (!webContents.canGoBack()) {
          return;
        }

        await applyColorSchemeToContents(webContents);
        webContents.goBack();
        return;
      }

      if (!webContents.canGoForward()) {
        return;
      }

      await applyColorSchemeToContents(webContents);
      webContents.goForward();
    };

    const resolveRequestedHistoryDirectionFromMouse = (mouse: {
      button?: unknown;
      buttons?: unknown;
      modifiers?: unknown;
      type?: unknown;
    }) => {
      const button = typeof mouse.button === "string" ? mouse.button.trim().toLowerCase() : mouse.button;
      if (button === "back" || button === 3) {
        return "back";
      }

      if (button === "forward" || button === 4) {
        return "forward";
      }

      const buttons = typeof mouse.buttons === "number" ? mouse.buttons : null;
      if (buttons !== null) {
        if ((buttons & 8) !== 0) {
          return "back";
        }

        if ((buttons & 16) !== 0) {
          return "forward";
        }
      }

      const modifiers = Array.isArray(mouse.modifiers)
        ? mouse.modifiers
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim().toLowerCase())
        : [];
      if (modifiers.includes("browser-backward")) {
        return "back";
      }

      if (modifiers.includes("browser-forward")) {
        return "forward";
      }

      return null;
    };

    installBrowserKeyboardShortcuts(targetWindow, webContents);

    webContents.on("before-mouse-event", (event, mouse) => {
      const requestedDirection = resolveRequestedHistoryDirectionFromMouse(
        mouse as {
          button?: unknown;
          buttons?: unknown;
          modifiers?: unknown;
          type?: unknown;
        },
      );
      if (!requestedDirection) {
        return;
      }

      event.preventDefault();
      void runReversedHistoryNavigation(requestedDirection).catch((error) => {
        console.warn("[Tabs] Failed to handle low-level history mouse navigation.", error);
      });
    });

    webContents.on("did-start-loading", () => {
      const runtime = findWindowTabRuntime(targetWindow.id, tabId);
      debugTabLoadingEvent(targetWindow, tabId, webContents, "did-start-loading", {
        tabIsLoading: runtime?.tab.isLoading,
      });
    });

    webContents.on("did-stop-loading", () => {
      const runtime = findWindowTabRuntime(targetWindow.id, tabId);
      const tab = runtime?.tab;
      if (!tab) return;
      const currentUrl = webContents.getURL();
      tab.isLoading = false;
      tab.title = webContents.getTitle() || tab.title;
      tab.displayUrl = toDisplayUrl(currentUrl, displayUrlOptions);
      tab.canGoBack = webContents.canGoBack();
      tab.canGoForward = webContents.canGoForward();
      updateHistoryMetadata(
        workspaces.get(runtime?.workspaceId ?? defaultWorkspaceId)?.profileId ?? defaultWorkspaceId,
        currentUrl,
        {
        title: tab.title,
        favicon: tab.favicon,
        },
      );
      debugTabLoadingEvent(targetWindow, tabId, webContents, "did-stop-loading", {
        tabIsLoading: tab.isLoading,
        displayUrl: tab.displayUrl,
        title: tab.title,
        canGoBack: tab.canGoBack,
        canGoForward: tab.canGoForward,
      });
      if (runtime?.isCurrentWorkspace) {
        broadcastTabState(targetWindow);
      }
      void resolveTabFaviconFallback(tabId, targetWindow, webContents, "did-stop-loading");
    });

    webContents.on("did-start-navigation", (_event, url, isInPlace, isMainFrame) => {
      debugTabLoadingEvent(targetWindow, tabId, webContents, "did-start-navigation", {
        isInPlace,
        isMainFrame,
        navigationUrl: url,
      });

      if (!isMainFrame || isInPlace) {
        return;
      }

      try {
        if (new URL(url).protocol === "milo-translation:") {
          return;
        }
      } catch {
        // Continue with normal navigation cleanup for non-URL navigation values.
      }

      applyResolvedUserAgentToContents(webContents, url);

      clearLinkPreviewForTab(targetWindow.id, tabId);
      clearTabManualInterventionMessage?.(tabId);

      bumpTabFaviconResolutionToken(tabId);
      clearPageTranslationState(webContents.id);
      clearUserScriptsForContents?.(webContents.id);

      const runtime = findWindowTabRuntime(targetWindow.id, tabId);
      const tab = runtime?.tab;
      if (tab?.favicon) {
        tab.favicon = undefined;
        if (runtime?.isCurrentWorkspace) {
          scheduleTabMetadataBroadcast(targetWindow);
        }
      }

      if (tab && !tab.isLoading) {
        tab.isLoading = true;
        if (runtime?.isCurrentWorkspace) {
          scheduleTabMetadataBroadcast(targetWindow);
        }
      }

      if (runtime?.isCurrentWorkspace && runtime.isActiveTab) {
        void ensureContentsOverrides(webContents, { targetUrl: url });
      }
    });

    webContents.on("will-navigate", (event, url) => {
      if (handlePageTranslationCommandUrl(targetWindow, webContents, url)) {
        event.preventDefault();
        return;
      }

      const runtime = findWindowTabRuntime(targetWindow.id, tabId);
      rememberHistoryOpenSource(tabId, buildHistoryOpenSourceFromTab(runtime?.tab, url));
    });

    webContents.on("did-redirect-navigation", (_event, url, isInPlace, isMainFrame) => {
      debugTabLoadingEvent(targetWindow, tabId, webContents, "did-redirect-navigation", {
        isInPlace,
        isMainFrame,
        navigationUrl: url,
      });
    });

    webContents.on("did-navigate", (_event, url) => {
      const runtime = findWindowTabRuntime(targetWindow.id, tabId);
      const tab = runtime?.tab;
      if (!tab) return;
      clearLinkPreviewForTab(targetWindow.id, tabId);
      tab.url = url;
      tab.displayUrl = toDisplayUrl(url, displayUrlOptions);
      tab.title = webContents.getTitle() || inferTitleFromUrl(url, startPageUrlOptions);
      tab.canGoBack = webContents.canGoBack();
      tab.canGoForward = webContents.canGoForward();
      const openedFrom = takeHistoryOpenSource(tabId);
      recordHistoryVisit(
        workspaces.get(runtime?.workspaceId ?? defaultWorkspaceId)?.profileId ?? defaultWorkspaceId,
        url,
        {
        title: tab.title,
        favicon: tab.favicon,
        openedFrom,
        },
      );
      debugTabLoadingEvent(targetWindow, tabId, webContents, "did-navigate", {
        navigationUrl: url,
        displayUrl: tab.displayUrl,
        title: tab.title,
        canGoBack: tab.canGoBack,
        canGoForward: tab.canGoForward,
      });
      if (runtime?.isCurrentWorkspace) {
        broadcastTabState(targetWindow);
      }
    });

    webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      const runtime = findWindowTabRuntime(targetWindow.id, tabId);
      const tab = runtime?.tab;
      if (!tab) return;
      if (isMainFrame) {
        clearLinkPreviewForTab(targetWindow.id, tabId);
        clearTabManualInterventionMessage?.(tabId);
      }
      tab.url = url;
      tab.displayUrl = toDisplayUrl(url, displayUrlOptions);
      recordHistoryVisit(
        workspaces.get(runtime?.workspaceId ?? defaultWorkspaceId)?.profileId ?? defaultWorkspaceId,
        url,
        {
        title: webContents.getTitle() || tab.title,
        favicon: tab.favicon,
        },
      );
      debugTabLoadingEvent(targetWindow, tabId, webContents, "did-navigate-in-page", {
        navigationUrl: url,
        isMainFrame,
        displayUrl: tab.displayUrl,
      });
      if (isMainFrame) {
        refreshUserScriptsAfterSameDocumentNavigation(
          targetWindow,
          tabId,
          webContents,
          url,
          "did-navigate-in-page",
        );
      }
      if (runtime?.isCurrentWorkspace) {
        broadcastTabState(targetWindow);
      }
    });

    webContents.on("dom-ready", () => {
      debugTabLoadingEvent(targetWindow, tabId, webContents, "dom-ready");
    });

    webContents.on("did-finish-load", () => {
      debugTabLoadingEvent(targetWindow, tabId, webContents, "did-finish-load");
      void resolveTabFaviconFallback(tabId, targetWindow, webContents, "did-finish-load");
      void handlePageTranslationNavigation(targetWindow, webContents);
      scheduleUserScriptInjection(
        targetWindow,
        tabId,
        webContents,
        webContents.getURL(),
        "did-finish-load",
      );
    });

    webContents.on("did-frame-finish-load", (_event, isMainFrame, frameProcessId, frameRoutingId) => {
      debugTabLoadingEvent(targetWindow, tabId, webContents, "did-frame-finish-load", {
        isMainFrame,
        frameProcessId,
        frameRoutingId,
      });
    });

    webContents.on(
      "did-fail-load",
      (
        _event,
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
        frameProcessId,
        frameRoutingId,
      ) => {
        debugTabLoadingEvent(targetWindow, tabId, webContents, "did-fail-load", {
          errorCode,
          errorDescription,
          validatedURL,
          isMainFrame,
          frameProcessId,
          frameRoutingId,
        });
      },
    );

    webContents.on("page-title-updated", (_event, title) => {
      const runtime = findWindowTabRuntime(targetWindow.id, tabId);
      const tab = runtime?.tab;
      if (!tab) return;
      const nextTitle = title || tab.title;
      if (nextTitle === tab.title) {
        return;
      }

      tab.title = nextTitle;
      debugTabLoadingEvent(targetWindow, tabId, webContents, "page-title-updated", {
        title: tab.title,
      });
      if (runtime?.isCurrentWorkspace) {
        scheduleTabMetadataBroadcast(targetWindow);
      }
    });

    webContents.on("page-favicon-updated", (_event, favicons) => {
      const runtime = findWindowTabRuntime(targetWindow.id, tabId);
      const tab = runtime?.tab;
      if (!tab || !favicons.length) return;
      const nextFavicon = favicons[0];
      if (!nextFavicon || nextFavicon === tab.favicon) {
        return;
      }

      tab.favicon = nextFavicon;
      updateHistoryMetadata(
        workspaces.get(runtime?.workspaceId ?? defaultWorkspaceId)?.profileId ?? defaultWorkspaceId,
        tab.url,
        {
          favicon: tab.favicon,
        },
      );
      debugTabLoadingEvent(targetWindow, tabId, webContents, "page-favicon-updated", {
        favicon: tab.favicon,
        faviconCount: favicons.length,
      });
      if (runtime?.isCurrentWorkspace) {
        scheduleTabMetadataBroadcast(targetWindow);
      }
    });

    webContents.setWindowOpenHandler((details) => {
      if (handlePageTranslationCommandUrl(targetWindow, webContents, details.url)) {
        return {
          action: "deny",
        };
      }

      const { workspaceId, workspace } = getWorkspaceWindowContext(targetWindow);
      const openerRuntime = findWindowTabRuntime(targetWindow.id, tabId);
      const historyOpenSource = buildHistoryOpenSourceFromTab(openerRuntime?.tab, details.url);
      const shouldOpenManagedTab =
        isAutomationWorkspace(workspace)
        || details.disposition === "foreground-tab"
        || details.disposition === "background-tab";

      if (shouldOpenManagedTab) {
        const popupTargetWindow = targetWindow.isDestroyed()
          ? findWorkspaceWindow(workspaceId, targetWindow.id)
          : targetWindow;

        if (!popupTargetWindow) {
          return {
            action: "deny",
          };
        }

        try {
          handleTabCreate(popupTargetWindow, details.url, {
            activate: details.disposition !== "background-tab",
            preserveRawUrl: true,
            initialTitle: details.frameName,
            openerTabId: tabId,
            creationSource: "window_open",
            ...(historyOpenSource ? { historyOpenSource } : {}),
          });
        } catch (error) {
          console.warn(
            `[Tabs] Failed to create tab for window.open in workspace "${workspaceId}".`,
            error,
          );
        }

        return {
          action: "deny",
        };
      }

      const partition = buildWorkspacePartition(workspace?.profileId ?? defaultWorkspaceId);
      const popupOwnerWindow = targetWindow.isDestroyed()
        ? findWorkspaceWindow(workspaceId, targetWindow.id)
        : targetWindow;
      if (!popupOwnerWindow) {
        return {
          action: "deny",
        };
      }

      webContents.once("did-create-window", (popupWindow, createDetails) => {
        setupWindowOpenBrowserWindow(
          popupOwnerWindow,
          popupWindow,
          createDetails,
          workspaceId,
          workspace,
          tabId,
          historyOpenSource,
        );
      });

      return {
        action: "allow",
        outlivesOpener: false,
        overrideBrowserWindowOptions: createWindowOpenBrowserWindowOptions(partition),
      };
    });
  }

  function handleTabCreate(targetWindow: BrowserWindow, url?: string, options?: CreateTabOptions): TabRecord {
    if (targetWindow.isDestroyed()) {
      throw new Error(`Cannot create tab for destroyed window ${targetWindow.id}.`);
    }

    const windowId = targetWindow.id;
    const { workspaceId, workspace } = getWorkspaceWindowContext(targetWindow);
    const shouldActivate = options?.activate ?? true;
    const managedByWindowOpen = options?.managedByWindowOpen ?? false;
    const shouldLoadImmediately = !managedByWindowOpen && (shouldActivate || !options?.deferInitialLoad);
    const resolvedUrl = resolveTabCreationUrl(url, options?.preserveRawUrl ?? false);
    const existingViewState = readExistingViewState(options?.existingView);
    const initialUrl = existingViewState?.url ?? resolvedUrl;
    const requestedTabId = typeof options?.restoredTabId === "string"
      ? options.restoredTabId.trim()
      : "";
    const tabId = requestedTabId && !browserViews.has(requestedTabId)
      ? requestedTabId
      : randomUUID();
    const initialTitle = options?.initialTitle?.trim();
    const initialHistoryOpenSource = options?.historyOpenSource;

    const tab: TabRecord = {
      id: tabId,
      url: initialUrl,
      title: initialTitle || existingViewState?.title || inferTitleFromUrl(initialUrl, startPageUrlOptions),
      displayUrl: toDisplayUrl(initialUrl, displayUrlOptions),
      favicon: options?.initialFavicon,
      isLoading: existingViewState?.isLoading ?? false,
      canGoBack: existingViewState?.canGoBack ?? false,
      canGoForward: existingViewState?.canGoForward ?? false,
      hasLoaded: existingViewState ? existingViewState.hasLoaded : managedByWindowOpen,
    };

    if (!tabRecords.has(windowId)) {
      tabRecords.set(windowId, new Map());
    }
    tabRecords.get(windowId)!.set(tabId, tab);

    const partition = buildWorkspacePartition(workspace?.profileId ?? defaultWorkspaceId);
    rememberHistoryOpenSource(tabId, initialHistoryOpenSource);
    const view = registerTabBrowserView(
      targetWindow,
      tabId,
      tab,
      workspaceId,
      workspace,
      options?.existingView ?? createTabWebContentsView(partition),
    );
    const contents = view.webContents;
    const contentsId = contents.id;

    if (options?.existingView) {
      void resolveTabFaviconFallback(tabId, targetWindow, contents, "existing-view-adopted");
    }

    if (Array.isArray(options?.restoredHistoryEntries) && options.restoredHistoryEntries.length > 0) {
      const restoredHistoryEntries = normalizeNavigationEntries(options.restoredHistoryEntries);
      if (restoredHistoryEntries.length > 0) {
        tab.historyEntries = restoredHistoryEntries;
        tab.historyIndex = Number.isFinite(options.restoredHistoryIndex)
          ? Math.min(Math.max(0, Number(options.restoredHistoryIndex)), restoredHistoryEntries.length - 1)
          : Math.max(0, restoredHistoryEntries.length - 1);
        pendingTabHistoryRestores.set(tabId, {
          entries: tab.historyEntries,
          index: tab.historyIndex,
        });
      }
    }

    if (shouldActivate) {
      if (targetWindow.isDestroyed()) {
        discardCreatedTab(targetWindow, tabId, view, contentsId);
        throw new Error(`Cannot attach tab ${tabId} to destroyed window ${windowId}.`);
      }

      detachWindowActiveBrowserView(targetWindow);
      windowTabLayouts.delete(windowId);
      try {
        targetWindow.contentView.addChildView(view);
      } catch (error) {
        discardCreatedTab(targetWindow, tabId, view, contentsId);
        throw error;
      }
      windowActiveTabs.set(windowId, tabId);
      notifyActiveTabChanged(windowId, tabId);
      updateBrowserViewBounds(targetWindow);
    }

    if (targetWindow.isDestroyed()) {
      discardCreatedTab(targetWindow, tabId, view, contentsId);
      throw new Error(`Cannot finish tab creation for destroyed window ${windowId}.`);
    }

    if (!options?.suppressStateBroadcast) {
      broadcastTabState(targetWindow);
    }

    if (shouldLoadImmediately) {
      ensureTabViewLoaded(targetWindow, tabId);
    }

    onTabCreated?.({
      windowId,
      tabId,
      url: tab.url,
      title: tab.title,
      isActive: windowActiveTabs.get(windowId) === tabId,
      ...(options?.openerTabId ? { openerTabId: options.openerTabId } : {}),
      ...(options?.sidebarGroupWithTabId ? { sidebarGroupWithTabId: options.sidebarGroupWithTabId } : {}),
      source: options?.creationSource ?? (managedByWindowOpen ? "window_open" : "api"),
    });

    refreshMemorySaverForWindow(targetWindow);
    return tab;
  }

  function handleTabClose(targetWindow: BrowserWindow, tabId: string): { activeTabId: string } {
    const windowId = targetWindow.id;
    const tabs = tabRecords.get(windowId);
    if (!tabs || !tabs.has(tabId)) {
      throw new Error("Tab not found in target window.");
    }

    clearLinkPreviewForTab(windowId, tabId);
    clearTabManualInterventionMessage?.(tabId);
    pendingTabHistoryRestores.delete(tabId);
    pendingHistoryOpenSources.delete(tabId);
    cancelTabMemorySaver(tabId);
    const visibleTabIds = getVisibleTabIdsForWindow(windowId);
    const isVisibleInLayout = visibleTabIds.includes(tabId);
    const tabIdsBeforeClose = Array.from(tabs.keys());
    const closedTabIndex = tabIdsBeforeClose.indexOf(tabId);
    if (isVisibleInLayout) {
      detachWindowActiveBrowserView(targetWindow);
      windowTabLayouts.delete(windowId);
    }

    disposeTabBrowserView(targetWindow, tabId);
    tabs.delete(tabId);

    let nextActiveId = windowActiveTabs.get(windowId) ?? "";

    if (tabs.size === 0) {
      const replacement = handleTabCreate(targetWindow);
      return { activeTabId: replacement.id };
    }

    if (nextActiveId === tabId || !tabs.has(nextActiveId)) {
      const fallbackActiveIndex = closedTabIndex > 0 ? closedTabIndex - 1 : closedTabIndex + 1;
      nextActiveId = tabIdsBeforeClose[fallbackActiveIndex] ?? Array.from(tabs.keys())[0];
      windowActiveTabs.set(windowId, nextActiveId);
      attachWindowActiveBrowserView(targetWindow);
      notifyActiveTabChanged(windowId, nextActiveId);
    } else if (isVisibleInLayout) {
      attachWindowActiveBrowserView(targetWindow);
    }

    broadcastTabState(targetWindow);
    refreshMemorySaverForWindow(targetWindow);
    return { activeTabId: nextActiveId };
  }

  function handleTabSetActive(
    targetWindow: BrowserWindow,
    tabId: string,
    layout?: { sidebarWidth?: number; urlBarHeight?: number; rightPanelWidth?: number },
  ) {
    if (targetWindow.isDestroyed()) {
      return;
    }

    const windowId = targetWindow.id;
    const tabs = tabRecords.get(windowId);
    if (!tabs || !tabs.has(tabId)) {
      throw new Error("Tab not found in target window.");
    }

    destroyLinkPreview(windowId);

    const hasSplitLayout = Boolean(getWindowTabLayout(windowId));
    const isAlreadyActive = windowActiveTabs.get(windowId) === tabId && !hasSplitLayout;

    if (layout && Number.isFinite(layout.sidebarWidth)) {
      windowSidebarWidths.set(windowId, Number(layout.sidebarWidth));
    }
    if (layout && Number.isFinite(layout.urlBarHeight)) {
      windowUrlBarHeights.set(windowId, Math.max(0, Number(layout.urlBarHeight)));
    }
    if (layout && Number.isFinite((layout as any).rightPanelWidth)) {
      windowRightPanelWidths.set(windowId, Math.max(0, Number((layout as any).rightPanelWidth)));
    }

    const currentUrlBarHeight = windowUrlBarHeights.get(windowId) ?? 88;
    const targetTab = tabs.get(tabId);
    const isStartTab = !targetTab?.url || targetTab.url === "nexus://start" || targetTab.url.startsWith("nexus://") || targetTab.url === "about:blank";

    detachWindowActiveBrowserView(targetWindow);
    windowTabLayouts.delete(windowId);

    windowActiveTabs.set(windowId, tabId);

    if (!isStartTab && currentUrlBarHeight < 9000) {
      const view = ensureTabBrowserView(targetWindow, tabId);
      if (view) {
        if (!targetWindow.contentView.children.includes(view)) {
          targetWindow.contentView.addChildView(view);
        }
        updateBrowserViewBounds(targetWindow);
        ensureTabViewLoaded(targetWindow, tabId);
      }
    }

    notifyActiveTabChanged(windowId, tabId);
    broadcastTabState(targetWindow);
    refreshMemorySaverForWindow(targetWindow);
  }

  function handleTabApplyLayout(
    targetWindow: BrowserWindow,
    input: TabLayoutUpdateInput,
    layout?: { sidebarWidth?: number; urlBarHeight?: number },
  ) {
    const windowId = targetWindow.id;
    const tabs = tabRecords.get(windowId);
    if (!tabs || tabs.size === 0) {
      throw new Error("Window tabs are not initialized.");
    }

    const nextLayout = normalizeWindowTabLayout(targetWindow, input);
    if (!nextLayout) {
      handleTabSetActive(targetWindow, input.focusedTabId, layout);
      return;
    }

    destroyLinkPreview(windowId);

    if (layout && Number.isFinite(layout.sidebarWidth)) {
      windowSidebarWidths.set(windowId, Number(layout.sidebarWidth));
    }
    if (layout && Number.isFinite(layout.urlBarHeight)) {
      windowUrlBarHeights.set(windowId, Math.max(0, Number(layout.urlBarHeight)));
    }

    const previousLayout = getWindowTabLayout(windowId);
    if (areWindowTabLayoutsEqual(previousLayout, nextLayout)) {
      updateBrowserViewBounds(targetWindow);
      refreshMemorySaverForWindow(targetWindow);
      return;
    }

    const previousVisibleTabIds = getVisibleTabIdsForWindow(windowId);
    const nextVisibleTabIds = nextLayout.tiles.map((tile) => tile.tabId);
    const shouldReattach =
      previousVisibleTabIds.length !== nextVisibleTabIds.length
      || previousVisibleTabIds.some((currentTabId, index) => currentTabId !== nextVisibleTabIds[index]);

    if (shouldReattach) {
      detachWindowActiveBrowserView(targetWindow);
    }
    windowTabLayouts.set(windowId, nextLayout);
    windowActiveTabs.set(windowId, nextLayout.focusedTabId);
    if (shouldReattach) {
      attachWindowActiveBrowserView(targetWindow);
    } else {
      nextVisibleTabIds.forEach((currentTabId) => {
        ensureTabViewLoaded(targetWindow, currentTabId);
      });
      updateBrowserViewBounds(targetWindow);
    }
    notifyActiveTabChanged(windowId, nextLayout.focusedTabId);
    broadcastTabState(targetWindow);
    refreshMemorySaverForWindow(targetWindow);
  }

  function handleTabViewInteraction(targetContents: WebContents) {
    const match = findTabByContents(targetContents);
    if (!match) {
      return;
    }

    const layout = getWindowTabLayout(match.targetWindow.id);
    if (!layout || !layout.tiles.some((tile) => tile.tabId === match.tabId)) {
      return;
    }

    if (layout.focusedTabId !== match.tabId) {
      windowTabLayouts.set(match.targetWindow.id, {
        ...layout,
        focusedTabId: match.tabId,
      });
    }

    if (windowActiveTabs.get(match.targetWindow.id) === match.tabId) {
      return;
    }

    windowActiveTabs.set(match.targetWindow.id, match.tabId);
    notifyActiveTabChanged(match.targetWindow.id, match.tabId);
    broadcastTabState(match.targetWindow);
  }

  function handleTabDocumentTitleChanged(targetContents: WebContents, title: string) {
    const match = findTabByContents(targetContents);
    if (!match) {
      return;
    }

    const nextTitle = title || targetContents.getTitle() || match.runtime.tab.title;
    if (!nextTitle || nextTitle === match.runtime.tab.title) {
      return;
    }

    match.runtime.tab.title = nextTitle;
    debugTabLoadingEvent(match.targetWindow, match.tabId, targetContents, "document-title-changed", {
      title: nextTitle,
    });
    if (match.runtime.isCurrentWorkspace) {
      scheduleTabMetadataBroadcast(match.targetWindow);
    }
  }

  function buildScrollSyncScript(payload: TabScrollSyncPayload, eventId: number) {
    return `(() => {
      const payload = ${JSON.stringify(payload)};
      const markerKey = "__miloSplitScrollSync";
      const root = document.scrollingElement || document.documentElement || document.body;
      if (!root) {
        return;
      }

      const maxTop = Math.max(0, root.scrollHeight - window.innerHeight);
      const maxLeft = Math.max(0, root.scrollWidth - window.innerWidth);
      const ratioTop = payload.maxTop > 0 ? payload.top / payload.maxTop : 0;
      const ratioLeft = payload.maxLeft > 0 ? payload.left / payload.maxLeft : 0;
      const nextTop = maxTop > 0 ? Math.max(0, Math.min(maxTop, ratioTop * maxTop)) : 0;
      const nextLeft = maxLeft > 0 ? Math.max(0, Math.min(maxLeft, ratioLeft * maxLeft)) : 0;

      window[markerKey] = ${eventId};
      window.scrollTo({ top: nextTop, left: nextLeft, behavior: "auto" });
      window.setTimeout(() => {
        if (window[markerKey] === ${eventId}) {
          delete window[markerKey];
        }
      }, 120);
    })();`;
  }

  function handleTabViewScroll(targetContents: WebContents, payload: TabScrollSyncPayload) {
    const match = findTabByContents(targetContents);
    if (!match) {
      return;
    }

    const layout = getWindowTabLayout(match.targetWindow.id);
    if (!layout || !layout.syncScroll || !layout.tiles.some((tile) => tile.tabId === match.tabId)) {
      return;
    }

    if (layout.focusedTabId !== match.tabId) {
      return;
    }

    const script = buildScrollSyncScript(payload, Date.now());
    for (const tile of layout.tiles) {
      if (tile.tabId === match.tabId) {
        continue;
      }

      const view = browserViews.get(tile.tabId);
      const contents = view?.webContents;
      if (!contents || contents.isDestroyed()) {
        continue;
      }

      void contents.executeJavaScript(script, true).catch(() => undefined);
    }
  }

  function handleTabSetSidebarDragState(
    targetWindow: BrowserWindow,
    tabId: string | null,
  ) {
    cancelSidebarTabDragClearTimer(targetWindow.id);

    if (tabId) {
      windowSidebarDragTabs.set(targetWindow.id, tabId);
      broadcastSidebarTabDragState(targetWindow.id);
    } else {
      const currentTabId = windowSidebarDragTabs.get(targetWindow.id);
      if (!currentTabId) {
        broadcastSidebarTabDragState(targetWindow.id);
        return;
      }

      const timer = setTimeout(() => {
        if (windowSidebarDragTabs.get(targetWindow.id) === currentTabId) {
          windowSidebarDragTabs.delete(targetWindow.id);
        }
        windowSidebarDragClearTimers.delete(targetWindow.id);
        broadcastSidebarTabDragState(targetWindow.id);
      }, 160);
      windowSidebarDragClearTimers.set(targetWindow.id, timer);
    }
  }

  function normalizeSplitDragPreviewPayload(
    payload: SplitViewDragPreviewPayload | null | undefined,
  ): SplitViewDragPreviewPayload | null {
    const mode = payload?.mode;
    const side = payload?.side;
    if ((mode !== "horizontal" && mode !== "vertical")
      || (side !== "left" && side !== "right" && side !== "top" && side !== "bottom")) {
      return null;
    }

    return { mode, side };
  }

  function readSplitDragPayloadTabId(
    payload: SplitViewDragPreviewPayload & { tabId?: unknown },
  ) {
    return typeof payload.tabId === "string" && payload.tabId.trim()
      ? payload.tabId.trim()
      : null;
  }

  function resolveSidebarDragSourceTabId(
    windowId: number,
    payload: SplitViewDragPreviewPayload & { tabId?: unknown },
  ) {
    const tabs = tabRecords.get(windowId);
    if (!tabs) {
      return null;
    }

    const currentTabId = windowSidebarDragTabs.get(windowId);
    if (currentTabId && tabs.has(currentTabId)) {
      return currentTabId;
    }

    const payloadTabId = readSplitDragPayloadTabId(payload);
    if (payloadTabId && tabs.has(payloadTabId)) {
      cancelSidebarTabDragClearTimer(windowId);
      windowSidebarDragTabs.set(windowId, payloadTabId);
      broadcastSidebarTabDragState(windowId);
      return payloadTabId;
    }

    return null;
  }

  function handleTabSplitDragPreview(
    targetContents: WebContents,
    payload: SplitViewDragPreviewPayload & { tabId?: unknown },
  ) {
    const match = findTabByContents(targetContents);
    if (!match || match.targetWindow.webContents.isDestroyed()) {
      return;
    }

    const preview = normalizeSplitDragPreviewPayload(payload);
    if (!preview) {
      return;
    }

    if (!resolveSidebarDragSourceTabId(match.targetWindow.id, payload)) {
      return;
    }

    match.targetWindow.webContents.send("tab:split-drag-preview", preview);
  }

  function handleTabSplitDragLeave(targetContents: WebContents) {
    const match = findTabByContents(targetContents);
    if (!match || match.targetWindow.webContents.isDestroyed()) {
      return;
    }

    if (!windowSidebarDragTabs.has(match.targetWindow.id)) {
      return;
    }

    match.targetWindow.webContents.send("tab:split-drag-clear");
  }

  function handleTabSplitDragDrop(
    targetContents: WebContents,
    payload: SplitViewDragPreviewPayload & { tabId?: unknown },
  ) {
    const match = findTabByContents(targetContents);
    if (!match || match.targetWindow.webContents.isDestroyed()) {
      return;
    }

    const preview = normalizeSplitDragPreviewPayload(payload);
    if (!preview) {
      return;
    }

    const sourceTabId = resolveSidebarDragSourceTabId(match.targetWindow.id, payload);
    if (!sourceTabId) {
      return;
    }

    cancelSidebarTabDragClearTimer(match.targetWindow.id);
    windowSidebarDragTabs.delete(match.targetWindow.id);
    broadcastSidebarTabDragState(match.targetWindow.id);

    match.targetWindow.webContents.send("tab:split-drag-drop", {
      ...preview,
      tabId: sourceTabId,
    } satisfies SplitViewDragDropPayload);
  }

  function switchWindowWorkspace(
    targetWindow: BrowserWindow,
    workspaceId: string,
    layout?: { sidebarWidth?: number; urlBarHeight?: number },
  ) {
    if (!workspaces.has(workspaceId)) {
      throw new Error("Workspace not found.");
    }

    const windowId = targetWindow.id;
    const currentWorkspaceId = windowToWorkspace.get(windowId) ?? defaultWorkspaceId;

    if (layout && Number.isFinite(layout.sidebarWidth)) {
      windowSidebarWidths.set(windowId, Number(layout.sidebarWidth));
    }
    if (layout && Number.isFinite(layout.urlBarHeight)) {
      windowUrlBarHeights.set(windowId, Math.max(0, Number(layout.urlBarHeight)));
    }

    destroyLinkPreview(windowId);

    if (currentWorkspaceId === workspaceId) {
      updateWindowTitle(targetWindow);
      updateBrowserViewBounds(targetWindow);
      broadcastTabState(targetWindow);
      refreshMemorySaverForWindow(targetWindow);
      return buildBootstrapData(targetWindow.webContents);
    }

    const currentTabs = tabRecords.get(windowId);
    if (currentTabs && currentTabs.size > 0) {
      persistWorkspaceSessionForWindow(windowId);
      getWindowWorkspaceCacheMap(windowId, true)?.set(currentWorkspaceId, {
        tabs: currentTabs,
        activeTabId: windowActiveTabs.get(windowId),
      });
    }

    detachWindowActiveBrowserView(targetWindow);
    windowTabLayouts.delete(windowId);
    windowActiveTabs.delete(windowId);
    cancelSidebarTabDragClearTimer(windowId);
    windowSidebarDragTabs.delete(windowId);

    windowToWorkspace.set(windowId, workspaceId);
    const windowState = windows.get(windowId);
    if (windowState) {
      windowState.workspaceId = workspaceId;
    }

    const cachedWorkspace = takeWindowWorkspaceCache(windowId, workspaceId);
    if (cachedWorkspace && cachedWorkspace.tabs.size > 0) {
      tabRecords.set(windowId, cachedWorkspace.tabs);
      const restoredActiveTabId =
        cachedWorkspace.activeTabId ?? cachedWorkspace.tabs.keys().next().value;
      if (restoredActiveTabId) {
        windowActiveTabs.set(windowId, restoredActiveTabId);
        attachWindowActiveBrowserView(targetWindow);
        notifyActiveTabChanged(windowId, restoredActiveTabId);
      }
    } else {
      tabRecords.set(windowId, new Map());
      const sessionRecord = getWorkspaceSession(workspaceId);
      const restoredTabs = sessionRecord?.tabs.filter((tab) => tab.url.trim().length > 0) ?? [];

      if (restoredTabs.length > 0) {
        const activeTabIndex = Math.min(
          Math.max(0, sessionRecord?.activeTabIndex ?? restoredTabs.length - 1),
          restoredTabs.length - 1,
        );

        beginWorkspaceSessionRestore?.({
          windowId,
          workspaceId,
          tabIds: restoredTabs.map((tab) => tab.id),
        });
        try {
          restoredTabs.forEach((tab, index) => {
            const shouldActivateTab = index === activeTabIndex;
            handleTabCreate(targetWindow, tab.url, {
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
            windowId,
            workspaceId,
          });
        }
      } else {
        handleTabCreate(targetWindow);
      }
    }

    const fallbackActiveTabId = windowActiveTabs.get(windowId);
    if (!fallbackActiveTabId) {
      const firstTabId = tabRecords.get(windowId)?.keys().next().value;
      if (firstTabId) {
        windowActiveTabs.set(windowId, firstTabId);
        attachWindowActiveBrowserView(targetWindow);
        notifyActiveTabChanged(windowId, firstTabId);
      }
    }

    updateWindowTitle(targetWindow);
    broadcastTabState(targetWindow);
    refreshMemorySaverForWindow(targetWindow);
    return buildBootstrapData(targetWindow.webContents);
  }

  function focusActiveTabContents(targetWindow: BrowserWindow) {
    const activeTabId = windowActiveTabs.get(targetWindow.id);
    const activeView = activeTabId ? browserViews.get(activeTabId) : undefined;
    const activeContents = activeView?.webContents;
    if (activeContents && !activeContents.isDestroyed()) {
      activeContents.focus();
      return;
    }

    targetWindow.webContents.focus();
  }

  return {
    serializeTabRecord,
    resolveWorkspaceActiveTabId,
    getWindowWorkspaceCacheMap,
    findTabWindowContext,
    getWindowMainContentBounds,
    getActiveTabContentBounds,
    getWindowTabLayout,
    getVisibleTabIdsForWindow,
    updateBrowserViewBounds,
    setWindowRightPanelWidth: (windowId: number, width: number) => {
      windowRightPanelWidths.set(windowId, width);
    },
    disposeCachedWorkspaceEntriesForWindow,
    broadcastTabState,
    handleTabCreate,
    handleTabClose,
    handleTabSetActive,
    handleTabApplyLayout,
    handleTabViewInteraction,
    handleTabDocumentTitleChanged,
    handleTabViewScroll,
    handleTabSetSidebarDragState,
    handleTabSplitDragPreview,
    handleTabSplitDragLeave,
    handleTabSplitDragDrop,
    switchWindowWorkspace,
    focusActiveTabContents,
  };
}
