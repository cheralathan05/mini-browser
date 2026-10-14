import "dotenv/config";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  nativeImage,
  nativeTheme,
  session,
  shell,
  WebContentsView,
  type WebContents,
  type WebFrameMain,
} from "electron";
import type {
  CreateTabOptions,
  OpenFolderSettingsDialogInput,
  OpenCreateWorkspaceDialogInput,
  SplitViewDragPreviewPayload,
  TabLayoutUpdateInput,
  TabRecord,
  TabScrollSyncPayload,
  ViewBounds,
  WindowRecord,
  WindowTabLayoutState,
  WindowTabSummary,
  WindowWorkspaceCacheRecord,
  WorkspaceRecord,
  WorkspaceSessionRecord,
} from "./shared/contracts.js";
import {
  createDownloadManager,
  type DownloadRecord,
} from "./services/downloads.js";
import { createExtensionManager } from "./services/extensions.js";
import { generateUserScriptAgentDraft } from "./services/user-script-agent.js";
import { createUserScriptManager } from "./services/user-scripts.js";
import { createMenuManager } from "./window/menu.js";
import { createAutomationMcpService } from "./mcp/automation-mcp.js";
import { createBrowserEventBus } from "./mcp/browser-event-bus.js";
import { createAutomationMcpHttpServer } from "./mcp/http-mcp-server.js";
import { resolveOpenAICompatibleBackendConfig } from "./agent/openai-compatible-config.js";
import {
  createBrowserAgentService,
  type AgentSessionSnapshot,
} from "./agent/browser-agent-service.js";
import {
  cloneOrganizerSidebarState,
  createOrganizerFolderGroup,
  findOrganizerFolderForTabId,
  moveOrganizerTabsToFolder,
  normalizeOrganizerSidebarState,
  renameOrganizerFolder,
  type OrganizerSidebarState,
} from "./agent/browser-organizer.js";
import { registerMainIpcHandlers } from "./bridge/main-ipc.js";
import { createLinkPreviewManager } from "./window/link-preview.js";
import { shouldHandleTabHistoryNavigation } from "./window/history-navigation.js";
import {
  createMiloProtocolManager,
  DEFAULT_SESSION_KEY,
  DOWNLOADS_PAGE_ENTRY,
  MILO_DOWNLOADS_URL,
  MILO_EXTENSIONS_URL,
  MILO_HOME_HOST,
  MILO_HOME_URL,
  MILO_RENDER_PREVIEW_URL,
  MILO_SCHEME,
  MILO_SEARCH_URL,
  MILO_SETTINGS_URL,
  EXTENSIONS_PAGE_ENTRY,
  resolveMiloPageEntry,
  SETTINGS_PAGE_ENTRY,
} from "./protocol/milo-protocol.js";
import { DEFAULT_TRANSLATION_PREFERENCES } from "./shared/translation.js";
import {
  buildChromeUserAgent,
  buildWorkspacePartition,
  compareWorkspacesByCreatedAt,
  inferTitleFromUrl,
  isGoogleRelatedUrl,
  isStartPageUrl,
  type DisplayUrlOptions,
  type ResolveInputToUrlOptions,
  type StartPageUrlOptions,
} from "./shared/utils.js";
import { createWindowManager } from "./window/windows.js";
import { createWorkspaceManager } from "./workspace/workspace.js";
import { createPasskeyManager } from "./services/passkeys.js";
import { createWidgetRegistry } from "./services/widget-registry.js";
import { createWorkspaceStateManager } from "./workspace/workspace-state.js";
import { createBrowserRuntimeManager } from "./state/browser-runtime.js";
import { createLibraryStateManager } from "./state/library-state.js";
import { createTabManager } from "./window/tabs.js";
import { createBrowserKeyboardShortcutsManager } from "./window/browser-keyboard-shortcuts.js";
import { createPageTranslationManager } from "./window/page-translation.js";
import { createSpecialPageManager } from "./window/special-pages.js";
import { createWindowActionsManager } from "./window/window-actions.js";
import { createAppSettingsManager } from "./state/app-settings.js";
import { redactSensitiveSettings } from "./state/settings-export.js";
import { createLearningService } from "./learning/learning-service.js";
import type { LearningSummaryInput } from "./learning/types.js";
import { createContextIntelligenceService } from "./context-intelligence/context-service.js";
import {
  createStartPageWidgetRefreshService,
  type StartPageWidgetRefreshEvent,
} from "./triggers/start-page-widget-refresh.js";
import {
  createSystemNotificationService,
  type SystemNotificationInput,
} from "./services/system-notifications.js";

const PRODUCT_NAME = "Nexus Browser";
const DEFAULT_WORKSPACE_ID = "default";
const AUTOMATION_WORKSPACE_TAG = "automation";
const WEB_PROTOCOLS = ["http", "https"] as const;
const WIDGET_AUTOMATION_ALLOWED_TOOLS = new Set([
  "page.open",
  "page.snapshot",
  "page.extract",
  "page.interact",
  "extract.records",
  "browser.extract_data",
  "browser.navigate",
  "browser.get_page_context",
]);
const WIDGET_AUTOMATION_IDLE_CLOSE_MS = 2_000;
const WIDGET_AUTOMATION_WINDOW_READY_TIMEOUT_MS = 8_000;
const RENDER_PREVIEW_DOCUMENT_TTL_MS = 60 * 60 * 1000;
const RENDER_PREVIEW_DOCUMENT_LIMIT = 32;

type RenderPreviewFormat = "html" | "markdown";

interface RenderPreviewDocument {
  id: string;
  format: RenderPreviewFormat;
  content: string;
  sourceTitle?: string;
  sourceUrl?: string;
  createdAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function isAutomationWorkspaceRecord(workspace: WorkspaceRecord | undefined) {
  return Boolean(workspace?.tags?.includes(AUTOMATION_WORKSPACE_TAG));
}

type DefaultBrowserStatusReason =
  | "ready"
  | "packaged_build_required"
  | "manual_confirmation_required";

interface DefaultBrowserStatus {
  http: boolean;
  https: boolean;
  isDefaultBrowser: boolean;
  canSetAsDefaultBrowser: boolean;
  manualActionRequired: boolean;
  reason: DefaultBrowserStatusReason;
}

interface DefaultBrowserRegistrationResult extends DefaultBrowserStatus {
  updated: boolean;
}

interface PageSearchResultPayload {
  tabId: string;
  query: string;
  activeMatchOrdinal: number;
  matches: number;
  finalUpdate: boolean;
}

interface PageSearchOverlayPayload {
  visible: boolean;
  tabId: string;
  query: string;
  result: PageSearchResultPayload | null;
  focusInput: boolean;
}

function configureUserDataPath() {
  app.setPath("userData", path.join(app.getPath("appData"), PRODUCT_NAME));
}

function configureChromiumBackgroundBehavior() {
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
  app.commandLine.appendSwitch("disable-background-timer-throttling");
  app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
}

const tabLoadingDebugEnabled = /^(1|true|yes|on)$/i.test(
  process.env.MILO_DEBUG_TAB_LOADING ?? "",
);

app.setName(PRODUCT_NAME);
if (process.platform === "win32") {
  app.setAppUserModelId("com.milo.browser");
}
configureUserDataPath();
configureChromiumBackgroundBehavior();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererDistPath = path.join(__dirname, "../dist-renderer");
const preloadPath = path.join(__dirname, "bridge/preload.cjs");
const appIconPath = app.isPackaged
  ? path.join(process.resourcesPath, "assets", "milo.png")
  : path.resolve(__dirname, "../assets/milo.png");
const systemNotificationService = createSystemNotificationService({
  appName: PRODUCT_NAME,
  iconPath: appIconPath,
});
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const pendingExternalWebUrls: string[] = [];

function normalizeExternalWebUrl(input: string | null | undefined) {
  if (typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim().replace(/^"(.*)"$/, "$1");
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function extractExternalWebUrlsFromArgv(argv: readonly string[]) {
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const value of argv) {
    const url = normalizeExternalWebUrl(value);
    if (!url || seen.has(url)) {
      continue;
    }

    seen.add(url);
    urls.push(url);
  }

  return urls;
}

function queueExternalWebUrls(urls: readonly string[]) {
  if (urls.length === 0) {
    return;
  }

  pendingExternalWebUrls.push(...urls);
}

function getProtocolClientRegistrationArgs() {
  if (process.defaultApp && process.argv.length >= 2) {
    return {
      executablePath: process.execPath,
      args: [path.resolve(process.argv[1] ?? "")],
    };
  }

  return {
    executablePath: undefined,
    args: undefined,
  };
}

function isDefaultProtocolHandler(protocol: (typeof WEB_PROTOCOLS)[number]) {
  const { executablePath, args } = getProtocolClientRegistrationArgs();
  return executablePath
    ? app.isDefaultProtocolClient(protocol, executablePath, args)
    : app.isDefaultProtocolClient(protocol);
}

function setAsDefaultProtocolHandler(protocol: (typeof WEB_PROTOCOLS)[number]) {
  const { executablePath, args } = getProtocolClientRegistrationArgs();
  return executablePath
    ? app.setAsDefaultProtocolClient(protocol, executablePath, args)
    : app.setAsDefaultProtocolClient(protocol);
}

function getDefaultBrowserStatus(
  reason: DefaultBrowserStatusReason = "ready",
): DefaultBrowserStatus {
  if (!app.isPackaged) {
    return {
      http: false,
      https: false,
      isDefaultBrowser: false,
      canSetAsDefaultBrowser: false,
      manualActionRequired: false,
      reason: "packaged_build_required",
    };
  }

  const http = isDefaultProtocolHandler("http");
  const https = isDefaultProtocolHandler("https");
  const isDefaultBrowser = http && https;

  return {
    http,
    https,
    isDefaultBrowser,
    canSetAsDefaultBrowser: true,
    manualActionRequired: !isDefaultBrowser && reason === "manual_confirmation_required",
    reason: isDefaultBrowser ? "ready" : reason,
  };
}

function setAsDefaultBrowser(): DefaultBrowserRegistrationResult {
  const previousStatus = getDefaultBrowserStatus();

  if (!previousStatus.canSetAsDefaultBrowser || previousStatus.isDefaultBrowser) {
    return {
      ...previousStatus,
      updated: false,
    };
  }

  WEB_PROTOCOLS.forEach((protocol) => {
    void setAsDefaultProtocolHandler(protocol);
  });

  const nextStatus = getDefaultBrowserStatus();

  if (!nextStatus.isDefaultBrowser) {
    return {
      ...nextStatus,
      manualActionRequired: nextStatus.reason !== "packaged_build_required",
      reason:
        nextStatus.reason === "packaged_build_required"
          ? "packaged_build_required"
          : "manual_confirmation_required",
      updated: false,
    };
  }

  return {
    ...nextStatus,
    updated: !previousStatus.isDefaultBrowser,
  };
}

function getExistingWorkspaceWindow() {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow && !focusedWindow.isDestroyed() && windowToWorkspace.has(focusedWindow.id)) {
    return focusedWindow;
  }

  return BrowserWindow.getAllWindows().find((targetWindow) =>
    !targetWindow.isDestroyed() && windowToWorkspace.has(targetWindow.id),
  ) ?? null;
}

function ensureVisibleWorkspaceWindow() {
  const existingWindow = getExistingWorkspaceWindow();
  if (existingWindow) {
    revealWorkspaceWindow(existingWindow);
    return existingWindow;
  }

  const defaultWorkspace = workspaces.get(DEFAULT_WORKSPACE_ID);
  if (!defaultWorkspace) {
    return null;
  }

  const targetWindow = createWorkspaceWindow(defaultWorkspace, { show: true });
  revealWorkspaceWindow(targetWindow);
  return targetWindow;
}

function flushPendingExternalWebUrls(preferredWindow?: BrowserWindow | null) {
  if (!app.isReady() || pendingExternalWebUrls.length === 0) {
    return;
  }

  const targetWindow =
    preferredWindow && !preferredWindow.isDestroyed() && windowToWorkspace.has(preferredWindow.id)
      ? preferredWindow
      : getExistingWorkspaceWindow();

  if (targetWindow?.webContents.isLoadingMainFrame()) {
    targetWindow.webContents.once("did-finish-load", () => {
      flushPendingExternalWebUrls(targetWindow);
    });
    return;
  }

  if (!targetWindow) {
    const defaultWorkspace = workspaces.get(DEFAULT_WORKSPACE_ID);
    const initialUrl = pendingExternalWebUrls.shift();

    if (!defaultWorkspace || !initialUrl) {
      return;
    }

    const nextWindow = createWorkspaceWindow(defaultWorkspace, {
      show: true,
      initialUrl,
      forceInitialUrl: true,
    });
    revealWorkspaceWindow(nextWindow);

    if (pendingExternalWebUrls.length > 0) {
      nextWindow.webContents.once("did-finish-load", () => {
        flushPendingExternalWebUrls(nextWindow);
      });
    }
    return;
  }

  const urls = pendingExternalWebUrls.splice(0);
  revealWorkspaceWindow(targetWindow);

  for (const [index, url] of urls.entries()) {
    handleTabCreate(targetWindow, url, {
      activate: index === urls.length - 1,
      creationSource: "api",
    });
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

queueExternalWebUrls(extractExternalWebUrlsFromArgv(process.argv));

if (!gotSingleInstanceLock) {
  app.quit();
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  queueExternalWebUrls([url]);
  if (app.isReady()) {
    flushPendingExternalWebUrls();
  }
});

app.on("second-instance", (_event, commandLine) => {
  const urls = extractExternalWebUrlsFromArgv(commandLine);
  queueExternalWebUrls(urls);

  if (!app.isReady()) {
    return;
  }

  if (urls.length > 0) {
    flushPendingExternalWebUrls();
    return;
  }

  ensureVisibleWorkspaceWindow();
});

const workspaces = new Map<string, WorkspaceRecord>();
const windows = new Map<number, WindowRecord>();
const windowToWorkspace = new Map<number, string>();
const browserViews = new Map<string, WebContentsView>();
const tabRecords = new Map<number, Map<string, TabRecord>>();
const windowActiveTabs = new Map<number, string>();
const windowTabLayouts = new Map<number, WindowTabLayoutState>();
const windowSidebarDragTabs = new Map<number, string>();
const windowSidebarDragClearTimers = new Map<number, ReturnType<typeof setTimeout>>();
const windowSidebarWidths = new Map<number, number>();
const windowUrlBarHeights = new Map<number, number>();
const workspaceCreateDialogs = new Map<number, BrowserWindow>();
const folderSettingsDialogs = new Map<number, BrowserWindow>();
let isAppQuitting = false;
const browserEventBus = createBrowserEventBus();
const browserDownloadSourceTabIds = new Map<string, string>();
const browserDownloadSnapshots = new Map<string, {
  status: string;
  receivedBytes: number;
  totalBytes: number | null;
  error?: string;
}>();
const tabManualInterventionState = new Map<string, {
  kind: "human_verification" | "verification_code" | "login_required" | "blocked";
  message: string;
}>();
const sidebarOrganizationStates = new Map<string, OrganizerSidebarState>();
const sidebarOrganizationSyncSequences = new Map<string, number>();
const pendingWorkspaceSessionRestores = new Map<number, Map<string, Set<string>>>();
const ephemeralWorkspaceSessionWindowIds = new Set<number>();

interface StartPageWidgetAutomationWindowState {
  key: string;
  workspaceId: string;
  windowId: number;
  tabId: string;
  inFlight: number;
  closeTimer?: ReturnType<typeof setTimeout>;
}

const startPageWidgetAutomationWindows = new Map<string, StartPageWidgetAutomationWindowState>();
const startPageWidgetAutomationWindowCreations = new Map<string, Promise<StartPageWidgetAutomationWindowState>>();

function beginWorkspaceSessionRestore(input: {
  windowId: number;
  workspaceId: string;
  tabIds: string[];
}) {
  const tabIds = input.tabIds.filter((tabId) => tabId.trim().length > 0);
  if (tabIds.length === 0) {
    return;
  }

  let windowRestores = pendingWorkspaceSessionRestores.get(input.windowId);
  if (!windowRestores) {
    windowRestores = new Map();
    pendingWorkspaceSessionRestores.set(input.windowId, windowRestores);
  }

  windowRestores.set(input.workspaceId, new Set(tabIds));
}

function endWorkspaceSessionRestore(input: {
  windowId: number;
  workspaceId: string;
}) {
  const windowRestores = pendingWorkspaceSessionRestores.get(input.windowId);
  if (!windowRestores) {
    return;
  }

  windowRestores.delete(input.workspaceId);
  if (windowRestores.size === 0) {
    pendingWorkspaceSessionRestores.delete(input.windowId);
  }
}

function shouldDeferWorkspaceSessionPersistence(input: {
  windowId?: number;
  workspaceId: string;
  tabIds: string[];
}) {
  if (typeof input.windowId !== "number") {
    return false;
  }

  if (ephemeralWorkspaceSessionWindowIds.has(input.windowId)) {
    return true;
  }

  const pendingTabIds = pendingWorkspaceSessionRestores
    .get(input.windowId)
    ?.get(input.workspaceId);
  if (!pendingTabIds) {
    return false;
  }

  const currentTabIds = new Set(input.tabIds);
  return Array.from(pendingTabIds).some((tabId) => !currentTabIds.has(tabId));
}

let searchOverlayView: WebContentsView | null = null;
let searchOverlayVisible = false;
let pageSearchOverlayView: WebContentsView | null = null;
let pageSearchOverlayVisible = false;
let pageSearchOverlayWindowId: number | null = null;
let pageSearchOverlayTabId = "";
let pageSearchOverlayQuery = "";
let pageSearchOverlayResult: PageSearchResultPayload | null = null;
let aiSidebarOverlayView: WebContentsView | null = null;
let aiSidebarOverlayVisible = false;
let aiSidebarOverlayWindowId: number | null = null;
let aiSidebarOverlayTabId: string | null = null;
let aiSidebarOverlayLoadedKey: string | null = null;
let aiSidebarOverlayRegistered = false;
const aiSidebarOpenTabIds = new Set<string>();
let browserRuntimeManager: ReturnType<typeof createBrowserRuntimeManager> | null = null;
let pageTranslationManager: ReturnType<typeof createPageTranslationManager> | null = null;
let specialPageManager: ReturnType<typeof createSpecialPageManager> | null = null;
let tabManager: ReturnType<typeof createTabManager<any>> | null = null;
let linkPreviewManager: ReturnType<typeof createLinkPreviewManager> | null = null;
let windowManagerApi: ReturnType<typeof createWindowManager> | null = null;
let windowActionsManager: ReturnType<typeof createWindowActionsManager> | null = null;
let getLinkPreviewWebContents: () => WebContents[] = () => [];
let workspaceManager: ReturnType<typeof createWorkspaceManager> | null = null;
let learningService: ReturnType<typeof createLearningService> | null = null;
let contextIntelligenceService: ReturnType<typeof createContextIntelligenceService> | null = null;
const renderPreviewDocuments = new Map<string, RenderPreviewDocument>();

function getSidebarOrganizationStateKey(windowId: number, workspaceId: string) {
  return `${windowId}:${workspaceId}`;
}

function buildOrganizerTabsFromTabRecords(tabs: TabRecord[], activeTabId?: string) {
  return tabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    url: tab.url,
    displayUrl: tab.displayUrl,
    isActive: tab.id === activeTabId,
  }));
}

function buildOrganizerTabsFromSessionRecord(sessionRecord?: WorkspaceSessionRecord) {
  if (!sessionRecord) {
    return [];
  }

  const activeTabId = sessionRecord.tabs[sessionRecord.activeTabIndex]?.id;
  return sessionRecord.tabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    url: tab.url,
    displayUrl: tab.url,
    isActive: tab.id === activeTabId,
  }));
}

function buildOrganizerTabsForWindow(windowId: number) {
  const tabs = Array.from(tabRecords.get(windowId)?.values() ?? []);
  const activeTabId = windowActiveTabs.get(windowId);
  return buildOrganizerTabsFromTabRecords(tabs, activeTabId);
}

function buildOrganizerTabsForWindowWorkspace(windowId: number, workspaceId: string) {
  const activeWorkspaceId = windowToWorkspace.get(windowId) ?? DEFAULT_WORKSPACE_ID;
  if (activeWorkspaceId === workspaceId) {
    return buildOrganizerTabsForWindow(windowId);
  }

  const cachedRecord = tabManager
    ? getWindowWorkspaceCacheMap(windowId)?.get(workspaceId)
    : undefined;
  if (cachedRecord) {
    return buildOrganizerTabsFromTabRecords(
      Array.from(cachedRecord.tabs.values()),
      resolveWorkspaceActiveTabId(cachedRecord),
    );
  }

  return buildOrganizerTabsFromSessionRecord(workspaceSessions.get(workspaceId));
}

function isDefaultSidebarOrganizationStateForTabs(
  state: OrganizerSidebarState,
  tabs: ReturnType<typeof buildOrganizerTabsFromTabRecords>,
) {
  if (Object.keys(state.folders).length > 0 || Object.keys(state.splits).length > 0) {
    return false;
  }

  if (state.entries.length !== tabs.length) {
    return false;
  }

  return state.entries.every((entry, index) =>
    entry.kind === "tab" && entry.tabId === tabs[index]?.id
  );
}

function isEffectivelyDefaultSidebarOrganizationStateForTabs(
  state: OrganizerSidebarState,
  tabs: ReturnType<typeof buildOrganizerTabsFromTabRecords>,
) {
  if (Object.keys(state.splits).length > 0) {
    return false;
  }

  if (Object.values(state.folders).some((folder) => folder.tabIds.length > 0)) {
    return false;
  }

  const rootTabEntries = state.entries.filter(
    (entry): entry is Extract<OrganizerSidebarState["entries"][number], { kind: "tab" }> =>
      entry.kind === "tab",
  );
  if (rootTabEntries.length !== tabs.length) {
    return false;
  }

  return rootTabEntries.every((entry, index) => entry.tabId === tabs[index]?.id);
}

function areSidebarOrganizationStatesEqual(
  left: OrganizerSidebarState,
  right: OrganizerSidebarState,
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasAllPersistedSessionTabs(workspaceId: string, tabs: ReturnType<typeof buildOrganizerTabsFromTabRecords>) {
  const sessionRecord = workspaceSessions.get(workspaceId);
  if (!sessionRecord || sessionRecord.tabs.length === 0) {
    return true;
  }

  const liveTabIds = new Set(tabs.map((tab) => tab.id));
  return sessionRecord.tabs.every((tab) => liveTabIds.has(tab.id));
}

function getSidebarOrganizationState(input: { windowId: number; workspaceId: string }) {
  const key = getSidebarOrganizationStateKey(input.windowId, input.workspaceId);
  const tabs = buildOrganizerTabsForWindowWorkspace(input.windowId, input.workspaceId);
  const persistedState = workspaceSessions.get(input.workspaceId)?.sidebarState;
  const cachedState = sidebarOrganizationStates.get(key);
  if (tabs.length === 0) {
    return cloneOrganizerSidebarState(
      cachedState
      ?? persistedState
      ?? normalizeOrganizerSidebarState(undefined, [], undefined),
    );
  }

  const rawState = cachedState ?? persistedState;
  const normalized = normalizeOrganizerSidebarState(
    rawState,
    tabs,
    windowActiveTabs.get(input.windowId),
  );

  if (
    rawState
    && rawState === persistedState
    && !hasAllPersistedSessionTabs(input.workspaceId, tabs)
  ) {
    return cloneOrganizerSidebarState(rawState);
  }

  sidebarOrganizationStates.set(key, normalized);
  return cloneOrganizerSidebarState(normalized);
}

function syncSidebarOrganizationState(input: {
  windowId: number;
  workspaceId: string;
  state: OrganizerSidebarState;
  sequence?: number;
}) {
  const key = getSidebarOrganizationStateKey(input.windowId, input.workspaceId);
  const activeWorkspaceId = windowToWorkspace.get(input.windowId) ?? DEFAULT_WORKSPACE_ID;
  const isActiveWindowWorkspace = activeWorkspaceId === input.workspaceId;
  const tabs = buildOrganizerTabsForWindowWorkspace(input.windowId, input.workspaceId);
  const activeTabId = tabs.find((tab) => tab.isActive)?.id;
  const existingState = sidebarOrganizationStates.get(key);
  if (tabs.length === 0) {
    const persistedState = workspaceSessions.get(input.workspaceId)?.sidebarState;
    return cloneOrganizerSidebarState(
      existingState
      ?? persistedState
      ?? normalizeOrganizerSidebarState(undefined, [], activeTabId),
    );
  }

  if (!isActiveWindowWorkspace) {
    const persistedState = workspaceSessions.get(input.workspaceId)?.sidebarState;
    const rawState = existingState ?? persistedState;
    const normalized = normalizeOrganizerSidebarState(rawState, tabs, activeTabId);
    sidebarOrganizationStates.set(key, normalized);
    return cloneOrganizerSidebarState(normalized);
  }

  const normalizedInput = normalizeOrganizerSidebarState(input.state, tabs);
  const inputSequence = Number.isFinite(input.sequence)
    ? Math.max(0, Math.floor(input.sequence!))
    : undefined;
  const lastSequence = sidebarOrganizationSyncSequences.get(key);
  if (inputSequence !== undefined && lastSequence !== undefined && inputSequence < lastSequence) {
    return cloneOrganizerSidebarState(existingState ?? normalizedInput);
  }
  const persistedSession = workspaceSessions.get(input.workspaceId);
  const persistedState = persistedSession?.sidebarState;
  const persistedTabs = buildOrganizerTabsFromSessionRecord(persistedSession);
  const persistedActiveTabId = persistedTabs.find((tab) => tab.isActive)?.id;
  const normalizedPersistedState = persistedState && persistedTabs.length > 0
    ? normalizeOrganizerSidebarState(persistedState, persistedTabs, persistedActiveTabId)
    : undefined;
  const hasMeaningfulPersistedState = Boolean(
    normalizedPersistedState
    && !isDefaultSidebarOrganizationStateForTabs(normalizedPersistedState, persistedTabs),
  );
  const shouldProtectPersistedStateFromInitialDefaultSync = Boolean(
    lastSequence === undefined
    && normalizedPersistedState
    && hasMeaningfulPersistedState
    && isEffectivelyDefaultSidebarOrganizationStateForTabs(normalizedInput, tabs)
    && (
      !existingState
      || areSidebarOrganizationStatesEqual(existingState, normalizedPersistedState)
    ),
  );
  if (shouldProtectPersistedStateFromInitialDefaultSync && normalizedPersistedState) {
    const normalized = normalizeOrganizerSidebarState(persistedState, tabs, activeTabId);
    sidebarOrganizationStates.set(key, normalized);
    return cloneOrganizerSidebarState(normalized);
  }
  if (
    !existingState
    && persistedState
    && persistedTabs.length > 0
    && hasMeaningfulPersistedState
    && !hasAllPersistedSessionTabs(input.workspaceId, tabs)
  ) {
    return cloneOrganizerSidebarState(normalizedInput);
  }
  const shouldPreferPersistedState =
    !existingState
    && persistedState
    && persistedTabs.length > 0
    && hasMeaningfulPersistedState;

  const normalized = shouldPreferPersistedState
    ? normalizeOrganizerSidebarState(persistedState, tabs, activeTabId)
    : normalizedInput;
  sidebarOrganizationStates.set(key, normalized);
  if (inputSequence !== undefined) {
    sidebarOrganizationSyncSequences.set(key, inputSequence);
  }
  persistWorkspaceSessionForWindow(input.windowId);
  return cloneOrganizerSidebarState(normalized);
}

function applySidebarOrganizationState(input: {
  windowId: number;
  workspaceId: string;
  state: OrganizerSidebarState;
}) {
  const normalized = syncSidebarOrganizationState(input);
  const targetWindow = BrowserWindow.fromId(input.windowId);
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send("browser:sidebar-organization-state-applied", {
      workspaceId: input.workspaceId,
      state: normalized,
    });
  }
  return cloneOrganizerSidebarState(normalized);
}

function updateSidebarFolderSettings(input: {
  windowId: number;
  workspaceId: string;
  folderId: string;
  name: string;
  icon?: string | null;
  backgroundColor?: string | null;
}) {
  const currentState = getSidebarOrganizationState({
    windowId: input.windowId,
    workspaceId: input.workspaceId,
  });
  const nextState = renameOrganizerFolder(currentState, input.folderId, {
    name: input.name,
    icon: input.icon,
    backgroundColor: input.backgroundColor ?? null,
  });

  return syncSidebarOrganizationState({
    windowId: input.windowId,
    workspaceId: input.workspaceId,
    state: nextState,
  });
}

function buildNextSidebarFolderTitle(state: OrganizerSidebarState) {
  let index = Object.keys(state.folders).length + 1;
  let title = `Folder ${index}`;
  while (Object.values(state.folders).some((folder) => folder.title === title)) {
    index += 1;
    title = `Folder ${index}`;
  }
  return title;
}

function groupSidebarTabWithCreatedTab(input: {
  windowId: number;
  workspaceId: string;
  sourceTabId: string;
  createdTabId: string;
}) {
  if (input.sourceTabId === input.createdTabId) {
    return;
  }

  const tabs = tabRecords.get(input.windowId);
  if (!tabs?.has(input.sourceTabId) || !tabs.has(input.createdTabId)) {
    return;
  }

  const sidebarState = getSidebarOrganizationState({
    windowId: input.windowId,
    workspaceId: input.workspaceId,
  });
  const sourceFolder = findOrganizerFolderForTabId(sidebarState, input.sourceTabId);
  const nextState = sourceFolder
    ? moveOrganizerTabsToFolder(sidebarState, sourceFolder.id, [input.createdTabId])
    : createOrganizerFolderGroup(sidebarState, {
      folderId: randomUUID(),
      name: buildNextSidebarFolderTitle(sidebarState),
      tabIds: [input.sourceTabId, input.createdTabId],
    });

  applySidebarOrganizationState({
    windowId: input.windowId,
    workspaceId: input.workspaceId,
    state: nextState,
  });
}

function requireInitialized<T>(value: T | null, message: string) {
  if (!value) throw new Error(message);
  return value;
}

const requireBrowserRuntimeManager = () =>
  requireInitialized(browserRuntimeManager, "Browser runtime manager has not been initialized.");
const requirePageTranslationManager = () =>
  requireInitialized(pageTranslationManager, "Page translation manager has not been initialized.");
const requireSpecialPageManager = () =>
  requireInitialized(specialPageManager, "Special page manager has not been initialized.");
const requireTabManager = () =>
  requireInitialized(tabManager, "Tab manager has not been initialized.");
const requireWindowActionsManager = () =>
  requireInitialized(windowActionsManager, "Window actions manager has not been initialized.");

function applyResolvedUserAgentToContents(
  targetContents: WebContents,
  targetUrl?: string,
) {
  requireBrowserRuntimeManager().applyResolvedUserAgentToContents(targetContents, targetUrl);
}

function cleanupManagedContents(contentsId: number) {
  requireBrowserRuntimeManager().cleanupManagedContents(contentsId);
}

function ensureDownloadHandlingForPartition(partition: string) {
  requireBrowserRuntimeManager().ensureDownloadHandlingForPartition(partition);
}

function applyColorSchemeToContents(targetContents: WebContents) {
  return requireBrowserRuntimeManager().applyColorSchemeToContents(targetContents);
}

function ensureContentsOverrides(
  targetContents: WebContents,
  options?: { targetUrl?: string },
) {
  return requireBrowserRuntimeManager().ensureContentsOverrides(targetContents, options);
}

async function syncColorSchemeForAllTabs() {
  await requireBrowserRuntimeManager().syncColorSchemeForAllTabs();
}

function clearPageTranslationState(contentsId: number) {
  requirePageTranslationManager().clearPageTranslationState(contentsId);
}

function getPageTranslationMenuState(webContents: WebContents) {
  return requirePageTranslationManager().getPageTranslationMenuState(webContents);
}

function handlePageTranslationToggle(targetWindow: BrowserWindow, webContents: WebContents) {
  return requirePageTranslationManager().handlePageTranslationToggle(targetWindow, webContents);
}

function handlePageTranslationNavigation(targetWindow: BrowserWindow, webContents: WebContents) {
  return requirePageTranslationManager().handlePageTranslationNavigation(targetWindow, webContents);
}

function handlePageTranslationCommandUrl(targetWindow: BrowserWindow, webContents: WebContents, url: string) {
  return requirePageTranslationManager().handlePageTranslationCommandUrl(targetWindow, webContents, url);
}

function handleSelectedTextTranslation(
  targetWindow: BrowserWindow,
  webContents: WebContents,
  selectedText: string,
  anchor?: { x: number; y: number },
) {
  return requirePageTranslationManager().handleSelectedTextTranslation(
    targetWindow,
    webContents,
    selectedText,
    anchor,
  );
}

function openPageFromApplicationMenu(pageEntry: string, pageUrl: string) {
  requireSpecialPageManager().openPageFromApplicationMenu(pageEntry, pageUrl);
}

function openSettingsFromApplicationMenu() { requireSpecialPageManager().openSettingsFromApplicationMenu(); }
function openDownloadsFromApplicationMenu() { requireSpecialPageManager().openDownloadsFromApplicationMenu(); }
function openExtensionsFromApplicationMenu() { requireSpecialPageManager().openExtensionsFromApplicationMenu(); }

function serializeTabRecord(tab: TabRecord): WindowTabSummary {
  return requireTabManager().serializeTabRecord(tab);
}

function resolveWorkspaceActiveTabId(record: WindowWorkspaceCacheRecord) {
  return requireTabManager().resolveWorkspaceActiveTabId(record);
}

function getWindowWorkspaceCacheMap(windowId: number, create = false) {
  return requireTabManager().getWindowWorkspaceCacheMap(windowId, create);
}

function findTabWindowContext(tabId: string) {
  return requireTabManager().findTabWindowContext(tabId);
}

function getWindowMainContentBounds(
  targetWindow: BrowserWindow,
  sidebarWidth: number,
  urlBarHeight: number,
  devToolsHeight = 0,
) {
  return requireTabManager().getWindowMainContentBounds(
    targetWindow,
    sidebarWidth,
    urlBarHeight,
    devToolsHeight,
  );
}

function getActiveTabContentBounds(targetWindow: BrowserWindow) {
  return requireTabManager().getActiveTabContentBounds(targetWindow);
}

function updateBrowserViewBounds(targetWindow: BrowserWindow, rightPanelWidth?: number) { requireTabManager().updateBrowserViewBounds(targetWindow, rightPanelWidth); }

function disposeCachedWorkspaceEntriesForWindow(
  targetWindow: BrowserWindow,
  workspaceIds?: ReadonlySet<string>,
) {
  requireTabManager().disposeCachedWorkspaceEntriesForWindow(targetWindow, workspaceIds);
}

function broadcastTabState(targetWindow: BrowserWindow) { requireTabManager().broadcastTabState(targetWindow); }

function handleTabCreate(targetWindow: BrowserWindow, url?: string, options?: CreateTabOptions) {
  return requireTabManager().handleTabCreate(targetWindow, url, options);
}

function handleTabClose(targetWindow: BrowserWindow, tabId: string) {
  aiSidebarOpenTabIds.delete(tabId);
  if (aiSidebarOverlayTabId === tabId) {
    closeAiSidebarOverlay(targetWindow, { tabId });
  }
  return requireTabManager().handleTabClose(targetWindow, tabId);
}

function handleTabSetActive(
  targetWindow: BrowserWindow,
  tabId: string,
  layout?: { sidebarWidth?: number; urlBarHeight?: number },
) {
  requireTabManager().handleTabSetActive(targetWindow, tabId, layout);
}

function handleTabApplyLayout(
  targetWindow: BrowserWindow,
  input: TabLayoutUpdateInput,
  layout?: { sidebarWidth?: number; urlBarHeight?: number },
) {
  requireTabManager().handleTabApplyLayout(targetWindow, input, layout);
}

function handleTabViewInteraction(targetContents: WebContents) { requireTabManager().handleTabViewInteraction(targetContents); }

function handleTabDocumentTitleChanged(targetContents: WebContents, title: string) {
  requireTabManager().handleTabDocumentTitleChanged(targetContents, title);
}

function handleTabViewScroll(targetContents: WebContents, payload: TabScrollSyncPayload) {
  requireTabManager().handleTabViewScroll(targetContents, payload);
}

function handleTabSetSidebarDragState(targetWindow: BrowserWindow, tabId: string | null) {
  requireTabManager().handleTabSetSidebarDragState(targetWindow, tabId);
}

function handleTabSplitDragPreview(
  targetContents: WebContents,
  payload: SplitViewDragPreviewPayload,
) {
  requireTabManager().handleTabSplitDragPreview(targetContents, payload);
}

function handleTabSplitDragLeave(targetContents: WebContents) { requireTabManager().handleTabSplitDragLeave(targetContents); }

function handleTabSplitDragDrop(
  targetContents: WebContents,
  payload: SplitViewDragPreviewPayload,
) {
  requireTabManager().handleTabSplitDragDrop(targetContents, payload);
}

function switchWindowWorkspace(
  targetWindow: BrowserWindow,
  workspaceId: string,
  layout?: { sidebarWidth?: number; urlBarHeight?: number },
) {
  return requireTabManager().switchWindowWorkspace(targetWindow, workspaceId, layout);
}

function focusActiveTabContents(targetWindow: BrowserWindow) {
  requireTabManager().focusActiveTabContents(targetWindow);
}

function deleteWorkspacesByIds(inputWorkspaceIds: string[]) {
  return requireWindowActionsManager().deleteWorkspacesByIds(inputWorkspaceIds);
}

function openWorkspaceProfileDirectory(workspaceId: string) {
  return requireWindowActionsManager().openWorkspaceProfileDirectory(workspaceId);
}

function createWindowForWorkspace(
  workspaceId: string,
  options: { show: boolean; focus: boolean },
) {
  return requireWindowActionsManager().createWindowForWorkspace(workspaceId, options);
}

function openCreateWorkspaceDialog(
  parentWindow: BrowserWindow,
  input: OpenCreateWorkspaceDialogInput,
) {
  return requireWindowActionsManager().openCreateWorkspaceDialog(parentWindow, input);
}

function openFolderSettingsDialog(
  parentWindow: BrowserWindow,
  input: OpenFolderSettingsDialogInput,
) {
  return requireWindowActionsManager().openFolderSettingsDialog(parentWindow, input);
}

function focusWindowById(windowId: number) { return requireWindowActionsManager().focusWindowById(windowId); }
function createTabInWindow(windowId: number, url?: string, options?: CreateTabOptions) {
  return requireWindowActionsManager().createTabInWindow(windowId, url, options);
}
function closeTabInWindow(windowId: number, tabId: string) {
  return requireWindowActionsManager().closeTabInWindow(windowId, tabId);
}
function activateTabInWindow(windowId: number, tabId: string) {
  return requireWindowActionsManager().activateTabInWindow(windowId, tabId);
}
function goBackInTab(windowId: number, tabId: string) { return requireWindowActionsManager().goBackInTab(windowId, tabId); }
function goForwardInTab(windowId: number, tabId: string) { return requireWindowActionsManager().goForwardInTab(windowId, tabId); }
function reloadTabInWindow(windowId: number, tabId: string) {
  return requireWindowActionsManager().reloadTabInWindow(windowId, tabId);
}
function getSearchOverlayBounds(windowId: number) {
  return requireWindowActionsManager().getSearchOverlayBounds(windowId);
}
function closeSearchOverlay(targetWindow: BrowserWindow) { requireWindowActionsManager().closeSearchOverlay(targetWindow); }

function buildPageSearchOverlayPayload(options?: { focusInput?: boolean }): PageSearchOverlayPayload {
  return {
    visible: pageSearchOverlayVisible,
    tabId: pageSearchOverlayTabId,
    query: pageSearchOverlayQuery,
    result: pageSearchOverlayResult,
    focusInput: Boolean(options?.focusInput),
  };
}

function sendPageSearchOverlayState(options?: { focusInput?: boolean }) {
  const contents = pageSearchOverlayView?.webContents;
  if (!contents || contents.isDestroyed()) {
    return;
  }

  contents.send("browser:page-search-overlay-state", buildPageSearchOverlayPayload(options));
}

function getPageSearchOverlayBounds(windowId: number): ViewBounds {
  const targetWindow = BrowserWindow.fromId(windowId);
  const fallbackBounds = {
    x: 990,
    y: 72,
    width: 380,
    height: 56,
  } satisfies ViewBounds;
  const contentBounds = targetWindow
    ? getActiveTabContentBounds(targetWindow) ?? fallbackBounds
    : fallbackBounds;
  const overlayWidth = Math.max(180, Math.min(420, contentBounds.width - 12));
  const overlayHeight = 56;
  const x = contentBounds.x + Math.max(12, contentBounds.width - overlayWidth - 16);
  const y = contentBounds.y + 12;

  return {
    x,
    y,
    width: overlayWidth,
    height: overlayHeight,
  };
}

function detachPageSearchOverlayViewFromAllWindows() {
  if (!pageSearchOverlayView) {
    return;
  }

  for (const windowRecord of BrowserWindow.getAllWindows()) {
    if (windowRecord.isDestroyed()) {
      continue;
    }

    try {
      windowRecord.contentView.removeChildView(pageSearchOverlayView);
    } catch {
      // Ignore when the overlay is not attached to this window.
    }
  }
}

function updatePageSearchOverlayBounds(targetWindow: BrowserWindow) {
  if (
    !pageSearchOverlayVisible
    || !pageSearchOverlayView
    || pageSearchOverlayWindowId !== targetWindow.id
  ) {
    return;
  }

  pageSearchOverlayView.setBounds(getPageSearchOverlayBounds(targetWindow.id));
}

async function ensurePageSearchOverlayLoaded() {
  if (!pageSearchOverlayView || pageSearchOverlayView.webContents.isDestroyed()) {
    const nextView = new WebContentsView({
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    nextView.setBackgroundColor("#00000000");
    nextView.webContents.once("destroyed", () => {
      if (pageSearchOverlayView === nextView) {
        pageSearchOverlayView = null;
        pageSearchOverlayVisible = false;
        pageSearchOverlayWindowId = null;
        pageSearchOverlayTabId = "";
        pageSearchOverlayQuery = "";
        pageSearchOverlayResult = null;
      }
    });
    pageSearchOverlayView = nextView;
  }

  const overlayContents = pageSearchOverlayView.webContents;
  if (overlayContents.getURL()) {
    return pageSearchOverlayView;
  }

  await new Promise<void>((resolve) => {
    const onReady = () => {
      overlayContents.removeListener("did-fail-load", onFail);
      resolve();
    };
    const onFail = () => {
      overlayContents.removeListener("did-finish-load", onReady);
      resolve();
    };
    overlayContents.once("did-finish-load", onReady);
    overlayContents.once("did-fail-load", onFail);
    void overlayContents.loadURL(PAGE_SEARCH_OVERLAY_URL);
  });

  return pageSearchOverlayView;
}

async function openPageSearchOverlay(targetWindow: BrowserWindow) {
  if (targetWindow.isDestroyed()) {
    return;
  }

  const activeTabId = windowActiveTabs.get(targetWindow.id) ?? "";
  if (!activeTabId) {
    return;
  }

  const previousTabId = pageSearchOverlayTabId;
  const previousWindowId = pageSearchOverlayWindowId;
  const overlayView = await ensurePageSearchOverlayLoaded();
  if (!overlayView || overlayView.webContents.isDestroyed()) {
    return;
  }

  if (
    previousTabId
    && previousTabId !== activeTabId
    && pageSearchOverlayQuery
  ) {
    const previousView = browserViews.get(previousTabId);
    if (previousView && !previousView.webContents.isDestroyed()) {
      previousView.webContents.stopFindInPage("clearSelection");
    }
  }

  detachPageSearchOverlayViewFromAllWindows();

  pageSearchOverlayVisible = true;
  pageSearchOverlayWindowId = targetWindow.id;
  pageSearchOverlayTabId = activeTabId;
  if (previousTabId !== activeTabId || previousWindowId !== targetWindow.id) {
    pageSearchOverlayQuery = "";
    pageSearchOverlayResult = null;
  }

  overlayView.setBounds(getPageSearchOverlayBounds(targetWindow.id));
  targetWindow.contentView.addChildView(overlayView);
  overlayView.webContents.focus();
  sendPageSearchOverlayState({ focusInput: true });
}

function closePageSearchOverlay(targetWindow?: BrowserWindow | null) {
  const hostWindow = targetWindow
    ?? (pageSearchOverlayWindowId !== null ? BrowserWindow.fromId(pageSearchOverlayWindowId) : null);
  const previousTabId = pageSearchOverlayTabId;
  if (previousTabId) {
    const previousView = browserViews.get(previousTabId);
    if (previousView && !previousView.webContents.isDestroyed()) {
      previousView.webContents.stopFindInPage("clearSelection");
    }
  }

  detachPageSearchOverlayViewFromAllWindows();
  pageSearchOverlayVisible = false;
  pageSearchOverlayWindowId = null;
  pageSearchOverlayResult = null;

  if (hostWindow && !hostWindow.isDestroyed()) {
    focusActiveTabContents(hostWindow);
  }
}

function syncPageSearchOverlayActiveTab(windowId: number, tabId: string) {
  if (
    !pageSearchOverlayVisible
    || pageSearchOverlayWindowId !== windowId
    || !tabId
    || pageSearchOverlayTabId === tabId
  ) {
    return;
  }

  const previousTabId = pageSearchOverlayTabId;
  if (previousTabId && pageSearchOverlayQuery) {
    const previousView = browserViews.get(previousTabId);
    if (previousView && !previousView.webContents.isDestroyed()) {
      previousView.webContents.stopFindInPage("clearSelection");
    }
  }

  pageSearchOverlayTabId = tabId;
  pageSearchOverlayQuery = "";
  pageSearchOverlayResult = null;
  sendPageSearchOverlayState();
  const hostWindow = BrowserWindow.fromId(windowId);
  if (hostWindow && !hostWindow.isDestroyed()) {
    updatePageSearchOverlayBounds(hostWindow);
  }
}

interface AiSidebarOverlayState {
  visible: boolean;
  windowId: number | null;
  tabId: string | null;
}

function getAiSidebarOverlayState(): AiSidebarOverlayState {
  return {
    visible: aiSidebarOverlayVisible,
    windowId: aiSidebarOverlayWindowId,
    tabId: aiSidebarOverlayTabId,
  };
}

function broadcastAiSidebarOverlayState() {
  const state = getAiSidebarOverlayState();
  const sentContentsIds = new Set<number>();

  const sendToContents = (contents?: WebContents | null) => {
    if (!contents || contents.isDestroyed() || sentContentsIds.has(contents.id)) {
      return;
    }
    sentContentsIds.add(contents.id);
    contents.send("browser:ai-sidebar-state", state);
  };

  for (const targetWindow of BrowserWindow.getAllWindows()) {
    sendToContents(targetWindow.webContents);
  }
  sendToContents(aiSidebarOverlayView?.webContents);
}

function getAiSidebarOverlayBounds(windowId: number): ViewBounds {
  const targetWindow = BrowserWindow.fromId(windowId);
  const fallbackBounds = {
    x: 960,
    y: 44,
    width: AI_SIDEBAR_OVERLAY_WIDTH,
    height: 720,
  } satisfies ViewBounds;
  const contentBounds = targetWindow
    ? getActiveTabContentBounds(targetWindow) ?? fallbackBounds
    : fallbackBounds;
  const horizontalInset = contentBounds.width > AI_SIDEBAR_OVERLAY_INSET
    ? AI_SIDEBAR_OVERLAY_INSET
    : 0;
  const verticalInset = contentBounds.height > AI_SIDEBAR_OVERLAY_INSET * 2
    ? AI_SIDEBAR_OVERLAY_INSET
    : 0;
  const availableWidth = Math.max(0, contentBounds.width - horizontalInset);
  const overlayWidth = Math.min(
    AI_SIDEBAR_OVERLAY_WIDTH,
    availableWidth,
  );
  const width = availableWidth >= AI_SIDEBAR_OVERLAY_MIN_WIDTH
    ? Math.max(AI_SIDEBAR_OVERLAY_MIN_WIDTH, overlayWidth)
    : overlayWidth;

  return {
    x: contentBounds.x + Math.max(0, contentBounds.width - width - horizontalInset),
    y: contentBounds.y + verticalInset,
    width,
    height: Math.max(0, contentBounds.height - verticalInset * 2),
  };
}

function detachAiSidebarOverlayViewFromAllWindows() {
  if (!aiSidebarOverlayView) {
    return;
  }

  for (const windowRecord of BrowserWindow.getAllWindows()) {
    if (windowRecord.isDestroyed()) {
      continue;
    }

    try {
      windowRecord.contentView.removeChildView(aiSidebarOverlayView);
    } catch {
      // Ignore when the overlay is not attached to this window.
    }
  }
}

async function ensureAiSidebarOverlayLoaded(targetWindow: BrowserWindow) {
  if (!aiSidebarOverlayView || aiSidebarOverlayView.webContents.isDestroyed()) {
    const nextView = new WebContentsView({
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    nextView.setBackgroundColor("#00000000");
    nextView.webContents.once("destroyed", () => {
      if (aiSidebarOverlayView === nextView) {
        aiSidebarOverlayView = null;
        aiSidebarOverlayVisible = false;
        aiSidebarOverlayWindowId = null;
        aiSidebarOverlayTabId = null;
        aiSidebarOverlayLoadedKey = null;
        aiSidebarOverlayRegistered = false;
        broadcastAiSidebarOverlayState();
      }
    });
    aiSidebarOverlayView = nextView;
    aiSidebarOverlayLoadedKey = null;
  }

  const overlayContents = aiSidebarOverlayView.webContents;
  const workspaceId = windowToWorkspace.get(targetWindow.id) ?? DEFAULT_WORKSPACE_ID;
  const tabId = windowActiveTabs.get(targetWindow.id) ?? "";
  const loadedKey = `${targetWindow.id}:${tabId}`;
  if (!aiSidebarOverlayRegistered) {
    registerGuestContents(workspaceId, overlayContents, { automationTargetEligible: false });
    aiSidebarOverlayRegistered = true;
  }

  if (aiSidebarOverlayLoadedKey === loadedKey && overlayContents.getURL()) {
    return aiSidebarOverlayView;
  }

  const overlayUrl = buildRendererPageUrl(AI_SIDEBAR_OVERLAY_ENTRY, {
    windowId: String(targetWindow.id),
    workspaceId,
    tabId,
  });
  await new Promise<void>((resolve) => {
    const onReady = () => {
      overlayContents.removeListener("did-fail-load", onFail);
      resolve();
    };
    const onFail = () => {
      overlayContents.removeListener("did-finish-load", onReady);
      resolve();
    };
    overlayContents.once("did-finish-load", onReady);
    overlayContents.once("did-fail-load", onFail);
    void overlayContents.loadURL(overlayUrl);
  });

  aiSidebarOverlayLoadedKey = loadedKey;
  return aiSidebarOverlayView;
}

function updateAiSidebarOverlayBounds(targetWindow: BrowserWindow) {
  if (
    !aiSidebarOverlayVisible
    || !aiSidebarOverlayView
    || aiSidebarOverlayView.webContents.isDestroyed()
    || aiSidebarOverlayWindowId !== targetWindow.id
  ) {
    return;
  }

  aiSidebarOverlayView.setBounds(getAiSidebarOverlayBounds(targetWindow.id));
  aiSidebarOverlayView.setBorderRadius(AI_SIDEBAR_OVERLAY_RADIUS);

  try {
    targetWindow.contentView.removeChildView(aiSidebarOverlayView);
  } catch {
    // Ignore when the overlay is already detached.
  }
  targetWindow.contentView.addChildView(aiSidebarOverlayView);
}

async function openAiSidebarOverlay(targetWindow: BrowserWindow): Promise<AiSidebarOverlayState> {
  if (targetWindow.isDestroyed()) {
    return getAiSidebarOverlayState();
  }

  const tabId = windowActiveTabs.get(targetWindow.id) ?? null;
  if (!tabId) {
    return getAiSidebarOverlayState();
  }

  const overlayView = await ensureAiSidebarOverlayLoaded(targetWindow);
  if (!overlayView || overlayView.webContents.isDestroyed()) {
    return getAiSidebarOverlayState();
  }

  detachAiSidebarOverlayViewFromAllWindows();
  aiSidebarOverlayVisible = true;
  aiSidebarOverlayWindowId = targetWindow.id;
  aiSidebarOverlayTabId = tabId;
  aiSidebarOpenTabIds.add(tabId);

  overlayView.setBounds(getAiSidebarOverlayBounds(targetWindow.id));
  overlayView.setBorderRadius(AI_SIDEBAR_OVERLAY_RADIUS);
  targetWindow.contentView.addChildView(overlayView);
  broadcastAiSidebarOverlayState();
  return getAiSidebarOverlayState();
}

function closeAiSidebarOverlay(
  targetWindow?: BrowserWindow | null,
  options?: { tabId?: string | null; keepTabOpenState?: boolean },
): AiSidebarOverlayState {
  const hostWindow = targetWindow
    ?? (aiSidebarOverlayWindowId !== null ? BrowserWindow.fromId(aiSidebarOverlayWindowId) : null);
  const closedTabId = options?.tabId ?? aiSidebarOverlayTabId;
  if (!options?.keepTabOpenState && closedTabId) {
    aiSidebarOpenTabIds.delete(closedTabId);
  }

  detachAiSidebarOverlayViewFromAllWindows();
  aiSidebarOverlayVisible = false;
  aiSidebarOverlayWindowId = null;
  aiSidebarOverlayTabId = null;
  broadcastAiSidebarOverlayState();

  if (hostWindow && !hostWindow.isDestroyed()) {
    focusActiveTabContents(hostWindow);
  }

  return getAiSidebarOverlayState();
}

function requestCloseAiSidebarOverlay(targetWindow?: BrowserWindow | null): AiSidebarOverlayState {
  if (
    !aiSidebarOverlayVisible
    || !aiSidebarOverlayView
    || aiSidebarOverlayView.webContents.isDestroyed()
    || (targetWindow && aiSidebarOverlayWindowId !== targetWindow.id)
  ) {
    return closeAiSidebarOverlay(targetWindow);
  }

  const requestedWindowId = aiSidebarOverlayWindowId;
  const requestedTabId = aiSidebarOverlayTabId;
  aiSidebarOverlayView.webContents.send("browser:ai-sidebar-close-requested");
  setTimeout(() => {
    if (
      aiSidebarOverlayVisible
      && aiSidebarOverlayWindowId === requestedWindowId
      && aiSidebarOverlayTabId === requestedTabId
    ) {
      closeAiSidebarOverlay(
        requestedWindowId !== null ? BrowserWindow.fromId(requestedWindowId) : targetWindow,
        { tabId: requestedTabId },
      );
    }
  }, 420);

  return getAiSidebarOverlayState();
}

async function toggleAiSidebarOverlay(targetWindow: BrowserWindow): Promise<AiSidebarOverlayState> {
  const tabId = windowActiveTabs.get(targetWindow.id) ?? null;
  if (
    tabId
    && aiSidebarOverlayVisible
    && aiSidebarOverlayWindowId === targetWindow.id
    && aiSidebarOverlayTabId === tabId
  ) {
    return requestCloseAiSidebarOverlay(targetWindow);
  }

  return openAiSidebarOverlay(targetWindow);
}

function syncAiSidebarOverlayActiveTab(windowId: number, tabId: string) {
  if (aiSidebarOverlayWindowId !== windowId && !aiSidebarOpenTabIds.has(tabId)) {
    return;
  }

  const targetWindow = BrowserWindow.fromId(windowId);
  if (!targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  if (aiSidebarOpenTabIds.has(tabId)) {
    void openAiSidebarOverlay(targetWindow).catch(() => undefined);
    return;
  }

  if (aiSidebarOverlayVisible && aiSidebarOverlayWindowId === windowId) {
    closeAiSidebarOverlay(targetWindow, { keepTabOpenState: true });
  }
}

const browserKeyboardShortcutsManager = createBrowserKeyboardShortcutsManager({
  openWindow: (targetWindow) => {
    if (targetWindow.isDestroyed()) {
      return;
    }

    const workspaceId = windowToWorkspace.get(targetWindow.id) ?? DEFAULT_WORKSPACE_ID;
    createWindowForWorkspace(workspaceId, { show: true, focus: true });
  },
  openTab: (targetWindow) => {
    handleTabCreate(targetWindow);
  },
  closeActiveTab: (targetWindow) => {
    const activeTabId = windowActiveTabs.get(targetWindow.id);
    if (!activeTabId) {
      return;
    }

    handleTabClose(targetWindow, activeTabId);
  },
  reloadActiveTab: async (targetWindow) => {
    const activeTabId = windowActiveTabs.get(targetWindow.id);
    if (!activeTabId) {
      return;
    }

    await reloadTabInWindow(targetWindow.id, activeTabId);
  },
  goBack: async (targetWindow) => {
    const activeTabId = windowActiveTabs.get(targetWindow.id);
    if (!activeTabId || !shouldHandleTabHistoryNavigation(targetWindow.id, "back", activeTabId)) {
      return;
    }

    await goBackInTab(targetWindow.id, activeTabId);
  },
  goForward: async (targetWindow) => {
    const activeTabId = windowActiveTabs.get(targetWindow.id);
    if (!activeTabId || !shouldHandleTabHistoryNavigation(targetWindow.id, "forward", activeTabId)) {
      return;
    }

    await goForwardInTab(targetWindow.id, activeTabId);
  },
  openPageSearch: (targetWindow) => {
    void openPageSearchOverlay(targetWindow).catch((error) => {
      console.warn("[PageSearch] Failed to open page-search overlay.", error);
    });
  },
  openSearch: (targetWindow) => {
    if (targetWindow.isDestroyed() || targetWindow.webContents.isDestroyed()) {
      return;
    }

    targetWindow.webContents.send("browser:open-search-overlay-requested");
  },
  focusAddressBar: (targetWindow) => {
    if (targetWindow.isDestroyed() || targetWindow.webContents.isDestroyed()) {
      return;
    }

    targetWindow.webContents.send("browser:focus-address-bar-requested");
  },
  toggleBrowserChrome: (targetWindow) => {
    if (targetWindow.isDestroyed() || targetWindow.webContents.isDestroyed()) {
      return;
    }

    targetWindow.webContents.send("browser:toggle-shell-chrome-requested");
  },
});

const widgetPackagesDirectoryPath = path.join(app.getPath("userData"), "widgets");
const widgetRegistry = createWidgetRegistry({
  rootPath: widgetPackagesDirectoryPath,
});

function resolveProtocolWidgetPackageDefaultSize(source: string) {
  try {
    const parsed = new URL(source);
    if (parsed.protocol.toLowerCase() !== "widget:" || parsed.hostname.toLowerCase() !== "package") {
      return null;
    }

    const packageId = parsed.pathname.split("/").filter(Boolean)[0]?.trim();
    if (!packageId) {
      return null;
    }

    const widgetPackage = widgetRegistry.getPackage(packageId);
    if (!widgetPackage) {
      return null;
    }

    return {
      gridH: widgetPackage.defaultSize.h,
      gridW: widgetPackage.defaultSize.w,
    };
  } catch {
    return null;
  }
}

const {
  buildRendererPageUrl,
  ensureMiloProtocolForPartition,
  registerMiloProtocol,
} = createMiloProtocolManager({
  rendererDistPath,
  devServerUrl,
  resolveDynamicTarget: (requestUrl) => {
    const resolvedTarget = widgetRegistry.resolveAssetRequest(requestUrl);
    return resolvedTarget
      ? {
        kind: "asset",
        ...resolvedTarget,
      }
      : null;
  },
});

const START_PAGE_URL = MILO_HOME_URL;
const HOME_DISPLAY_URL = "milo://home";
const SEARCH_BASE_URL = "https://www.google.com/search?q=";
const PAGE_SEARCH_OVERLAY_URL = buildRendererPageUrl("page-search.html");
const AI_SIDEBAR_OVERLAY_ENTRY = "ai-sidebar.html";
const AI_SIDEBAR_OVERLAY_WIDTH = 420;
const AI_SIDEBAR_OVERLAY_MIN_WIDTH = 320;
const AI_SIDEBAR_OVERLAY_INSET = 12;
const AI_SIDEBAR_OVERLAY_RADIUS = 12;
const START_PAGE_URL_OPTIONS: StartPageUrlOptions = {
  startPageUrl: START_PAGE_URL,
  miloScheme: MILO_SCHEME,
  miloHomeHost: MILO_HOME_HOST,
};
const DISPLAY_URL_OPTIONS: DisplayUrlOptions = {
  ...START_PAGE_URL_OPTIONS,
  homeDisplayUrl: HOME_DISPLAY_URL,
};
const RESOLVE_INPUT_TO_URL_OPTIONS: ResolveInputToUrlOptions = {
  homeDisplayUrl: HOME_DISPLAY_URL,
  startPageUrl: START_PAGE_URL,
  searchBaseUrl: SEARCH_BASE_URL,
};

const CHROME_USER_AGENT = buildChromeUserAgent();

function broadcastWorkspaceContext() { workspaceManager?.broadcastWorkspaceContext(); }

function pruneRenderPreviewDocuments(now = Date.now()) {
  for (const [id, document] of renderPreviewDocuments.entries()) {
    if (now - document.createdAt > RENDER_PREVIEW_DOCUMENT_TTL_MS) {
      renderPreviewDocuments.delete(id);
    }
  }

  while (renderPreviewDocuments.size > RENDER_PREVIEW_DOCUMENT_LIMIT) {
    const oldestId = renderPreviewDocuments.keys().next().value;
    if (!oldestId) {
      break;
    }
    renderPreviewDocuments.delete(oldestId);
  }
}

function createRenderPreviewDocument(input: {
  content: string;
  format: RenderPreviewFormat;
  sourceTitle?: string;
  sourceUrl?: string;
}) {
  pruneRenderPreviewDocuments();

  const id = randomUUID();
  const document: RenderPreviewDocument = {
    id,
    content: input.content,
    format: input.format,
    createdAt: Date.now(),
    ...(input.sourceTitle ? { sourceTitle: input.sourceTitle } : {}),
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
  };
  renderPreviewDocuments.set(id, document);
  return document;
}

function getRenderPreviewDocument(id: string) {
  const normalizedId = typeof id === "string" ? id.trim() : "";
  if (!normalizedId) {
    return null;
  }

  pruneRenderPreviewDocuments();
  return renderPreviewDocuments.get(normalizedId) ?? null;
}

function buildRenderPreviewUrl(id: string) {
  return `${MILO_RENDER_PREVIEW_URL}?id=${encodeURIComponent(id)}`;
}

function openSelectionRenderPreview(
  targetWindow: BrowserWindow,
  webContents: WebContents,
  input: {
    anchor: { x: number; y: number };
    content: string;
    destination: "preview" | "window";
    format: RenderPreviewFormat;
  },
) {
  if (targetWindow.isDestroyed() || webContents.isDestroyed()) {
    return;
  }

  const document = createRenderPreviewDocument({
    content: input.content,
    format: input.format,
    sourceTitle: webContents.getTitle().trim(),
    sourceUrl: webContents.getURL().trim(),
  });
  const previewUrl = buildRenderPreviewUrl(document.id);

  if (input.destination === "preview") {
    linkPreviewManager?.showManualPreview(targetWindow, webContents, previewUrl, input.anchor);
    return;
  }

  const workspaceId = windowToWorkspace.get(targetWindow.id) ?? DEFAULT_WORKSPACE_ID;
  const workspace = workspaces.get(workspaceId) ?? workspaces.get(DEFAULT_WORKSPACE_ID);
  if (!workspace) {
    return;
  }

  const nextWindow = createWorkspaceWindow(workspace, {
    show: true,
    initialUrl: previewUrl,
    forceInitialUrl: true,
  });
  revealWorkspaceWindow(nextWindow);
}

const { installApplicationMenu, setupBrowserViewContextMenu } = createMenuManager({
  searchBaseUrl: SEARCH_BASE_URL,
  defaultDevToolsDockMode: "right",
  handleTabCreate,
  isStartPageUrl: (url: string) => isStartPageUrl(url, START_PAGE_URL_OPTIONS),
  handleAddPageToDock: (targetContents) => {
    const dockItem = resolveDockItemForContents(targetContents);
    if (!dockItem) {
      return;
    }

    const workspaceId = resolveWorkspaceIdForContents(targetContents);
    const items = addToStartPageDock(workspaceId, {
      favicon: dockItem.favicon,
      title: dockItem.title,
      url: dockItem.url,
    });
    broadcastStartPageDockChanged(workspaceId, items);
  },
  openNewWindow: () => {
    const sourceWindow = getExistingWorkspaceWindow();
    const workspaceId = sourceWindow
      ? (windowToWorkspace.get(sourceWindow.id) ?? DEFAULT_WORKSPACE_ID)
      : DEFAULT_WORKSPACE_ID;
    createWindowForWorkspace(workspaceId, { show: true, focus: true });
  },
  openMenuPage: openPageFromApplicationMenu,
  openSettings: openSettingsFromApplicationMenu,
  openDownloads: openDownloadsFromApplicationMenu,
  openExtensions: openExtensionsFromApplicationMenu,
  getDefaultDownloadDirectory: () => resolveDownloadDirectory(),
  handleImageSave: async (targetWindow, targetContents, imageUrl, directory, point, frame) => {
    if (targetWindow.isDestroyed() || targetContents.isDestroyed()) {
      return;
    }

    await saveRenderedImageToDirectory({
      targetContents,
      frame,
      imageUrl,
      directory,
      point,
    });
  },
  getLanguage: () => appSettingsManager.getLanguage(),
  getPageTranslationState: (webContents) => getPageTranslationMenuState(webContents),
  handlePageTranslationToggle: (targetWindow, webContents) => {
    void handlePageTranslationToggle(targetWindow, webContents);
  },
  handleSelectedTextTranslation: (targetWindow, webContents, selectedText, anchor) => {
    void handleSelectedTextTranslation(targetWindow, webContents, selectedText, anchor);
  },
  handleSelectionRender: (targetWindow, webContents, input) => {
    openSelectionRenderPreview(targetWindow, webContents, input);
  },
  getAgentInteractionBlacklistDomains: () => getAgentPreferences().interactionBlacklistDomains,
  setAgentInteractionBlacklistDomains: (domains) => {
    setAgentPreferences({ interactionBlacklistDomains: domains });
  },
});

const workspaceStatePath = path.join(app.getPath("userData"), "workspace-state.json");
const workspaceStateBackupPath = `${workspaceStatePath}.bak`;
const workspaceStateTempPath = `${workspaceStatePath}.tmp`;
const workspaceSessions = new Map<string, WorkspaceSessionRecord>();
const workspaceStateManager = createWorkspaceStateManager({
  defaultWorkspaceId: DEFAULT_WORKSPACE_ID,
  workspaceStatePath,
  workspaceStateBackupPath,
  workspaceStateTempPath,
  workspaces,
  workspaceSessions,
  windowToWorkspace,
  tabRecords,
  browserViews,
  windowActiveTabs,
  getWindowWorkspaceCacheMap,
  resolveWorkspaceActiveTabId,
  compareWorkspacesByCreatedAt,
  shouldDeferWorkspaceSessionPersistence,
  getSidebarOrganizationStateForSession: ({ windowId, workspaceId, tabs, activeTabId }) => {
    const key = getSidebarOrganizationStateKey(windowId, workspaceId);
    const cachedState = sidebarOrganizationStates.get(key);
    const persistedState = workspaceSessions.get(workspaceId)?.sidebarState;
    if (tabs.length === 0) {
      const rawEmptyTabsState = cachedState ?? persistedState;
      return rawEmptyTabsState ? cloneOrganizerSidebarState(rawEmptyTabsState) : undefined;
    }

    const rawState = cachedState ?? persistedState;
    if (!rawState) {
      return undefined;
    }

    const normalized = normalizeOrganizerSidebarState(
      rawState,
      buildOrganizerTabsFromTabRecords(tabs, activeTabId),
      activeTabId,
    );
    sidebarOrganizationStates.set(key, normalized);
    return cloneOrganizerSidebarState(normalized);
  },
  inferTitleFromUrl,
  startPageUrlOptions: START_PAGE_URL_OPTIONS,
});

const {
  flushWorkspaceStateSave,
  getWorkspaceSession,
  loadWorkspaceState,
  persistAllWorkspaceSessionsForWindow,
  persistWorkspaceSessionForWindow,
} = workspaceStateManager;

linkPreviewManager = createLinkPreviewManager({
  defaultWorkspaceId: DEFAULT_WORKSPACE_ID,
  preloadPath,
  workspaces,
  windowToWorkspace,
  browserViews,
  tabRecords,
  windowActiveTabs,
  windowSidebarWidths,
  windowUrlBarHeights,
  buildWorkspacePartition,
  ensureMiloProtocolForPartition,
  ensureDownloadHandlingForPartition,
  applyResolvedUserAgentToContents,
  cleanupManagedContents,
  clearPageTranslationState,
  setupBrowserViewContextMenu,
  handleTabCreate,
  focusActiveTabContents,
  getWindowMainContentBounds,
  ensureContentsOverrides,
  getSearchOverlayBounds,
  isSearchOverlayVisible: () => searchOverlayVisible,
  getSearchOverlayView: () => searchOverlayView,
});

const {
  clearLinkPreviewForTab,
  cleanupLinkPreviewState,
  destroyLinkPreview,
  getManagedWebContents: nextGetLinkPreviewWebContents,
  handleLinkPreviewClose,
  handleLinkPreviewHover,
  handleLinkPreviewHoverLeave,
  handleLinkPreviewMaximize,
  handleLinkPreviewPointerState,
} = linkPreviewManager;
getLinkPreviewWebContents = nextGetLinkPreviewWebContents;

windowManagerApi = createWindowManager({
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
  persistAllWorkspaceSessionsFromWindow: persistAllWorkspaceSessionsForWindow,
  disposeCachedWorkspaceEntriesForWindow,
  beginWorkspaceSessionRestore,
  endWorkspaceSessionRestore,
  shouldHideWindowOnClose: (workspaceId) => isAutomationWorkspaceRecord(workspaces.get(workspaceId)),
  isAppQuitting: () => isAppQuitting,
  handleTabCreate,
  goBackInTab,
  goForwardInTab,
  handleTabSetActive,
  installBrowserKeyboardShortcuts: browserKeyboardShortcutsManager.install,
});

const {
  getWorkspaceWindows,
  updateWindowTitle,
  serializeWindow,
  serializeWindows,
  revealWorkspaceWindow,
  requestWindowClose,
  createWorkspaceWindow,
} = windowManagerApi;

specialPageManager = createSpecialPageManager({
  defaultWorkspaceId: DEFAULT_WORKSPACE_ID,
  settingsPageEntry: SETTINGS_PAGE_ENTRY,
  settingsUrl: MILO_SETTINGS_URL,
  downloadsPageEntry: DOWNLOADS_PAGE_ENTRY,
  downloadsUrl: MILO_DOWNLOADS_URL,
  extensionsPageEntry: EXTENSIONS_PAGE_ENTRY,
  extensionsUrl: MILO_EXTENSIONS_URL,
  workspaces,
  windowToWorkspace,
  tabRecords,
  resolvePageEntry: resolveMiloPageEntry,
  createWorkspaceWindow,
  revealWorkspaceWindow,
  handleTabSetActive,
  handleTabCreate,
});

workspaceManager = createWorkspaceManager({
  DEFAULT_WORKSPACE_ID,
  workspaces,
  windowToWorkspace,
  getWorkspaceWindows,
  serializeWindow,
  serializeWindows,
  getSidebarOrganizationState,
  startPageUrlOptions: START_PAGE_URL_OPTIONS,
  onAutomationTargetChanged: (workspaceId, targetContentsId) => {
    if (isAutomationWorkspaceRecord(workspaces.get(workspaceId))) {
      void learningService?.syncWorkspaceTarget(workspaceId, undefined);
      return;
    }
    void learningService?.syncWorkspaceTarget(workspaceId, targetContentsId);
  },
});

const {
  serializeWorkspace,
  buildBootstrapData,
  registerGuestContents,
  getWorkspaceRecord,
  setWorkspaceAutomationTarget,
  sendWorkspaceCdpCommand,
  sendContentsCdpCommand,
  subscribeContentsCdpEvents,
  createWorkspaceName,
  ensureDefaultWorkspace,
} = workspaceManager;

const automationMcpService = createAutomationMcpService({
  defaultWorkspaceId: DEFAULT_WORKSPACE_ID,
  windowToWorkspace,
  tabRecords,
  windowActiveTabs,
  browserViews,
  findTabWindowContext,
  getSidebarOrganizationState,
  requestWindowClose,
  createWindowForWorkspace,
  focusWindowById,
  createTabInWindow,
  closeTabInWindow,
  activateTabInWindow,
  goBackInTab,
  goForwardInTab,
  reloadTabInWindow,
  sendContentsCdpCommand,
  subscribeContentsCdpEvents,
  subscribeBrowserEvents: browserEventBus.subscribe,
});

const mainAgentMcpHttpServer = createAutomationMcpHttpServer({
  mcpService: {
    exportMcp: () => browserAgentService.exportHttpMcp(),
    callTool: (name, input) => browserAgentService.callHttpMcpTool({
      name,
      input,
    }),
  },
  port: Number.parseInt(process.env.MILO_MCP_HTTP_PORT ?? "", 10),
});

const bookmarksPath = path.join(app.getPath("userData"), "bookmarks.json");
const historyPath = path.join(app.getPath("userData"), "history.json");
const downloadsPath = path.join(app.getPath("userData"), "downloads.json");
const downloadsTempRootPath = path.join(app.getPath("userData"), "downloads-temp");
const userScriptsPath = path.join(app.getPath("userData"), "user-scripts-state.json");
const passkeysPath = path.join(app.getPath("userData"), "passkeys.json");
const agentTasksDirectoryPath = path.join(app.getPath("userData"), "tasks");
const legacyAgentTasksStatePath = path.join(app.getPath("userData"), "agent-tasks.json");
const legacyAgentTasksStateBackupPath = `${legacyAgentTasksStatePath}.bak`;
const learningStatePath = path.join(app.getPath("userData"), "learning-state.json");
const learningStateBackupPath = `${learningStatePath}.bak`;
const learningStateTempPath = `${learningStatePath}.tmp`;
const libraryStateManager = createLibraryStateManager({
  defaultProfileId: DEFAULT_WORKSPACE_ID,
  bookmarksPath,
  historyPath,
  inferTitleFromUrl,
  startPageUrlOptions: START_PAGE_URL_OPTIONS,
  onBookmarksChanged: () => {
    broadcastToRendererProcesses("bookmarks:changed");
  },
  onHistoryChanged: () => {
    broadcastToRendererProcesses("history:changed");
  },
});

const {
  getBookmarks,
  setBookmarks,
  getBookmarkFolders,
  setBookmarkFolders,
  loadBookmarks,
  saveBookmarks,
  notifyBookmarksChanged,
  getHistoryRecords,
  setHistoryRecords,
  loadHistory,
  saveHistoryRecords,
  notifyHistoryChanged,
  isTrackableHistoryUrl,
  recordHistoryVisit,
  updateHistoryMetadata,
} = libraryStateManager;

const appSettingsPath = path.join(app.getPath("userData"), "settings.json");
const DEFAULT_DOWNLOAD_THREAD_COUNT = 4;
const COLOR_SCHEME_COMMAND_TIMEOUT_MS = 1_500;
const COLOR_SCHEME_MEDIA_SYNC_STATE_KEY = "__miloColorSchemeMediaSync";
const appSettingsManager = createAppSettingsManager({
  settingsPath: appSettingsPath,
  defaultDownloadThreadCount: DEFAULT_DOWNLOAD_THREAD_COUNT,
  defaultTranslationPreferences: DEFAULT_TRANSLATION_PREFERENCES,
});

const {
  addStartPageProtocolWidget,
  addToStartPageDock,
  applyThemeToNativeTheme,
  clearStartPageAppearanceOverrides,
  clearStartPageDockItemOverrides,
  clearStartPageDockItems,
  clearStartPageWidgetStateOverrides,
  getAgentPreferences,
  getDownloadPreferences,
  getDownloadSettings,
  getImageAgentPreferences,
  getLanguage,
  getLlmProviders,
  getLearningPreferences,
  getSettings,
  getResolvedColorScheme,
  getStartPageAppearance,
  getStartPageDockItems,
  getStartPageWidgetsState,
  getTheme,
  getTranslationPreferences,
  loadAppSettings,
  parseDownloadHeadersText,
  removeStartPageDockItem,
  setStartPageDockItemFavicon,
  resolveBrowserLocale,
  resolveDownloadDirectory,
  resolveUiLocale,
  setAgentPreferences,
  setDownloadPreferences,
  setImageAgentPreferences,
  setLanguage,
  setLlmProviders,
  setLearningPreferences,
  setStartPageAppearance,
  setStartPageDockItems,
  setStartPageWidgets,
  setTheme,
  setTranslationPreferences,
} = appSettingsManager;

interface UserDataExportInput {
  rendererSettings?: unknown;
}

function cloneJsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null)) as unknown;
}

function ensureJsonExtension(filePath: string) {
  return path.extname(filePath).toLowerCase() === ".json" ? filePath : `${filePath}.json`;
}

function buildUserDataExportFilename(exportedAt: string) {
  const timestamp = exportedAt.replace(/[:.]/g, "-");
  return `milo-data-export-${timestamp}.json`;
}

async function exportUserData(
  ownerWindow: BrowserWindow | null,
  input?: UserDataExportInput | null,
) {
  const exportedAt = new Date().toISOString();
  const saveOptions = {
    defaultPath: path.join(app.getPath("downloads"), buildUserDataExportFilename(exportedAt)),
    filters: [
      { name: "JSON", extensions: ["json"] },
    ],
  };
  const saveResult = ownerWindow && !ownerWindow.isDestroyed()
    ? await dialog.showSaveDialog(ownerWindow, saveOptions)
    : await dialog.showSaveDialog(saveOptions);

  if (saveResult.canceled || !saveResult.filePath) {
    return { canceled: true };
  }

  const payload = {
    format: "milo.user-data-export",
    version: 1,
    exportedAt,
    app: {
      name: PRODUCT_NAME,
      version: app.getVersion(),
      platform: process.platform,
    },
    settings: {
      app: redactSensitiveSettings(cloneJsonValue(getSettings())),
      renderer: redactSensitiveSettings(cloneJsonValue(input?.rendererSettings)),
    },
    learning: redactSensitiveSettings(cloneJsonValue(learningService?.exportState() ?? null)),
    privacy: {
      credentialsIncluded: false,
      sensitiveSettingsRedacted: true,
    },
  };
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  const filePath = ensureJsonExtension(saveResult.filePath);
  await writeFile(filePath, serialized, "utf-8");

  return {
    canceled: false,
    filePath,
    bytesWritten: Buffer.byteLength(serialized, "utf-8"),
    exportedAt,
  };
}

const startPageWidgetRefreshService = createStartPageWidgetRefreshService({
  getWidgetsState: (workspaceId) => getStartPageWidgetsState(workspaceId),
  getWorkspaceIds: () => Array.from(workspaces.keys()),
  onRefresh: (event) => {
    broadcastStartPageWidgetRefresh(event.workspaceId, event);
  },
});

function getStartPageWidgetAutomationWindowKey(input: {
  source: string;
  widgetId: string;
  workspaceId: string;
}) {
  return `${input.workspaceId}\u0000${input.widgetId}\u0000${input.source}`;
}

function isStartPageWidgetAutomationWindowUsable(state: StartPageWidgetAutomationWindowState) {
  const targetWindow = BrowserWindow.fromId(state.windowId);
  const tabs = tabRecords.get(state.windowId);
  const view = browserViews.get(state.tabId);
  return Boolean(
    targetWindow
    && !targetWindow.isDestroyed()
    && windowToWorkspace.get(state.windowId) === state.workspaceId
    && tabs?.has(state.tabId)
    && view
    && !view.webContents.isDestroyed()
  );
}

async function waitForStartPageWidgetAutomationTab(input: {
  targetWindow: BrowserWindow;
  workspaceId: string;
}) {
  const startedAt = Date.now();
  let lastPendingReason = "window initialization is still pending";

  while (Date.now() - startedAt < WIDGET_AUTOMATION_WINDOW_READY_TIMEOUT_MS) {
    if (input.targetWindow.isDestroyed()) {
      throw new Error("Widget automation window was closed before initialization completed.");
    }

    if (windowToWorkspace.get(input.targetWindow.id) !== input.workspaceId) {
      throw new Error("Widget automation window changed workspace before initialization completed.");
    }

    const tabs = tabRecords.get(input.targetWindow.id);
    if (!tabs || tabs.size === 0) {
      lastPendingReason = "workspace tabs have not been created yet";
      await new Promise((resolve) => setTimeout(resolve, 40));
      continue;
    }

    const activeTabId = windowActiveTabs.get(input.targetWindow.id);
    if (!activeTabId || !tabs.has(activeTabId)) {
      lastPendingReason = "workspace active tab is not available yet";
      await new Promise((resolve) => setTimeout(resolve, 40));
      continue;
    }

    const activeView = browserViews.get(activeTabId);
    if (!activeView || activeView.webContents.isDestroyed()) {
      lastPendingReason = "workspace active tab view is not available yet";
      await new Promise((resolve) => setTimeout(resolve, 40));
      continue;
    }

    return activeTabId;
  }

  throw new Error(
    `Widget automation window did not finish initializing within ${WIDGET_AUTOMATION_WINDOW_READY_TIMEOUT_MS}ms: ${lastPendingReason}.`,
  );
}

function closeStartPageWidgetAutomationWindow(state: StartPageWidgetAutomationWindowState) {
  if (state.closeTimer) {
    clearTimeout(state.closeTimer);
    state.closeTimer = undefined;
  }

  const currentState = startPageWidgetAutomationWindows.get(state.key);
  if (currentState?.windowId === state.windowId) {
    startPageWidgetAutomationWindows.delete(state.key);
  }

  automationMcpService.releaseSessionsForTab(state.tabId);

  const targetWindow = BrowserWindow.fromId(state.windowId);
  if (targetWindow && !targetWindow.isDestroyed()) {
    requestWindowClose(targetWindow);
  } else {
    ephemeralWorkspaceSessionWindowIds.delete(state.windowId);
  }
}

function scheduleStartPageWidgetAutomationWindowClose(state: StartPageWidgetAutomationWindowState) {
  if (state.inFlight > 0 || state.closeTimer) {
    return;
  }

  state.closeTimer = setTimeout(() => {
    closeStartPageWidgetAutomationWindow(state);
  }, WIDGET_AUTOMATION_IDLE_CLOSE_MS);
}

async function createStartPageWidgetAutomationWindow(input: {
  key: string;
  workspaceId: string;
}) {
  const workspace = getWorkspaceRecord(input.workspaceId);
  const targetWindow = createWorkspaceWindow(workspace, {
    show: false,
    initialUrl: "about:blank",
    forceInitialUrl: true,
  });
  let tabId = "";

  ephemeralWorkspaceSessionWindowIds.add(targetWindow.id);
  targetWindow.setSkipTaskbar(true);
  if (targetWindow.isVisible()) {
    targetWindow.hide();
  }

  targetWindow.once("closed", () => {
    ephemeralWorkspaceSessionWindowIds.delete(targetWindow.id);
    if (tabId) {
      automationMcpService.releaseSessionsForTab(tabId);
    }

    const currentState = startPageWidgetAutomationWindows.get(input.key);
    if (currentState?.windowId === targetWindow.id) {
      if (currentState.closeTimer) {
        clearTimeout(currentState.closeTimer);
      }
      startPageWidgetAutomationWindows.delete(input.key);
    }
  });

  try {
    tabId = await waitForStartPageWidgetAutomationTab({
      targetWindow,
      workspaceId: input.workspaceId,
    });
  } catch (error) {
    if (!targetWindow.isDestroyed()) {
      requestWindowClose(targetWindow);
    }
    throw error;
  }

  const state: StartPageWidgetAutomationWindowState = {
    key: input.key,
    workspaceId: input.workspaceId,
    windowId: targetWindow.id,
    tabId,
    inFlight: 0,
  };
  startPageWidgetAutomationWindows.set(input.key, state);
  return state;
}

async function ensureStartPageWidgetAutomationWindow(input: {
  source: string;
  widgetId: string;
  workspaceId: string;
}) {
  const key = getStartPageWidgetAutomationWindowKey(input);
  const existingState = startPageWidgetAutomationWindows.get(key);
  if (existingState) {
    if (isStartPageWidgetAutomationWindowUsable(existingState)) {
      return existingState;
    }
    closeStartPageWidgetAutomationWindow(existingState);
  }

  const existingCreation = startPageWidgetAutomationWindowCreations.get(key);
  if (existingCreation) {
    return existingCreation;
  }

  const creation = createStartPageWidgetAutomationWindow({
    key,
    workspaceId: input.workspaceId,
  });
  startPageWidgetAutomationWindowCreations.set(key, creation);
  try {
    return await creation;
  } finally {
    if (startPageWidgetAutomationWindowCreations.get(key) === creation) {
      startPageWidgetAutomationWindowCreations.delete(key);
    }
  }
}

async function borrowStartPageWidgetAutomationWindow(input: {
  source: string;
  widgetId: string;
  workspaceId: string;
}) {
  const state = await ensureStartPageWidgetAutomationWindow(input);
  if (state.closeTimer) {
    clearTimeout(state.closeTimer);
    state.closeTimer = undefined;
  }
  state.inFlight += 1;
  return state;
}

function releaseStartPageWidgetAutomationWindow(state: StartPageWidgetAutomationWindowState) {
  state.inFlight = Math.max(0, state.inFlight - 1);
  scheduleStartPageWidgetAutomationWindowClose(state);
}

async function runStartPageWidgetAutomationCall(input: {
  input?: unknown;
  source: string;
  tool: string;
  widgetId: string;
  workspaceId: string;
}) {
  const workspaceId = readNonEmptyString(input.workspaceId);
  const widgetId = readNonEmptyString(input.widgetId);
  const source = readNonEmptyString(input.source);
  const tool = readNonEmptyString(input.tool);
  if (!workspaceId || !widgetId || !source || !tool) {
    throw new Error("Widget automation requires workspaceId, widgetId, source, and tool.");
  }
  if (!WIDGET_AUTOMATION_ALLOWED_TOOLS.has(tool)) {
    throw new Error(`Widget automation tool "${tool}" is not allowed.`);
  }

  const widget = getStartPageWidgetsState(workspaceId).items.find((item) =>
    item.id === widgetId
    && item.type === "protocol"
    && item.source === source);
  if (!widget) {
    throw new Error("Widget automation request does not match a live start page widget.");
  }

  const automationWindow = await borrowStartPageWidgetAutomationWindow({
    source,
    widgetId,
    workspaceId,
  });

  try {
    return await automationMcpService.callAgentTool(
      tool,
      isRecord(input.input) ? input.input : {},
      {
        boundWorkspaceId: workspaceId,
        boundScope: "tab",
        boundTabId: automationWindow.tabId,
      },
    );
  } finally {
    releaseStartPageWidgetAutomationWindow(automationWindow);
  }
}

learningService = createLearningService({
  automationService: automationMcpService,
  getLearningPreferences,
  setLearningPreferences,
  resolveLearningBackend: () => resolveOpenAICompatibleBackendConfig({
    getAgentPreferences,
    getLlmProviders,
    getTranslationPreferences,
    env: process.env,
    providerIdOverride: getLearningPreferences().providerId,
    modelOverride: getLearningPreferences().model,
  }),
  getTabIdForContentsId: (contentsId) => {
    for (const [tabId, view] of browserViews.entries()) {
      if (view.webContents.id === contentsId) {
        return tabId;
      }
    }
    return undefined;
  },
  getHistoryRecordsForWorkspace: (workspaceId) => {
    const workspace = getWorkspaceRecord(workspaceId);
    return getHistoryRecords(workspace.profileId);
  },
  getAllHistoryRecords: () => {
    const profileIds = new Set(
      Array.from(workspaces.values()).map((workspace) => workspace.profileId),
    );
    return Array.from(profileIds).flatMap((profileId) => getHistoryRecords(profileId));
  },
  statePath: learningStatePath,
  backupPath: learningStateBackupPath,
  tempPath: learningStateTempPath,
});

contextIntelligenceService = createContextIntelligenceService({
  resolveBackend: () => resolveOpenAICompatibleBackendConfig({
    getAgentPreferences,
    getLlmProviders,
    getTranslationPreferences,
    env: process.env,
  }),
  getInteractionBlacklistDomains: () => getAgentPreferences().interactionBlacklistDomains,
});

const browserAgentService = createBrowserAgentService({
  automationService: automationMcpService,
  getAgentPreferences,
  setAgentPreferences,
  getLlmProviders,
  getImageAgentPreferences,
  getTranslationPreferences,
  getProfileIdForWorkspace: (workspaceId) => getWorkspaceRecord(workspaceId).profileId,
  persistBookmarksState: (input) => {
    setBookmarkFolders(input.profileId, input.folders);
    setBookmarks(input.profileId, input.bookmarks);
    saveBookmarks();
    notifyBookmarksChanged();
    return {
      bookmarks: input.bookmarks,
      folders: input.folders,
    };
  },
  getBookmarks: (profileId) => getBookmarks(profileId),
  getBookmarkFolders: (profileId) => getBookmarkFolders(profileId),
  getHistoryRecords: (profileId) => getHistoryRecords(profileId),
  getDownloads: () => downloadManager.getRecords(),
  pauseDownload: (id) => downloadManager.pause(id),
  resumeDownload: (id) => downloadManager.resume(id),
  cancelDownload: (id) => downloadManager.cancel(id),
  retryDownload: (id) => downloadManager.retry(id),
  removeDownloadRecord: (id, options) => downloadManager.removeRecord(id, options),
  deleteDownloadFile: (id) => downloadManager.deleteFile(id),
  onSessionRunFinished: (snapshot) => {
    showAgentTaskFinishedNotification(snapshot);
  },
  listUserScripts: (profileId) => userScriptManager.list(profileId),
  listMatchingUserScripts: (profileId, url) => userScriptManager.listMatching(profileId, url),
  createUserScript: (profileId, input) => userScriptManager.create(profileId, input),
  updateUserScript: (profileId, scriptId, input) => userScriptManager.update(profileId, scriptId, input),
  runUserScriptNow: (profileId, targetContents, scriptId) =>
    userScriptManager.runNow(profileId, targetContents, scriptId),
  runUserScriptTest: (profileId, targetContents, scriptId) =>
    userScriptManager.runTest(profileId, targetContents, scriptId),
  getSidebarOrganizationState: (input) => getSidebarOrganizationState(input),
  applySidebarOrganizationState: (input) => applySidebarOrganizationState(input),
  searchLearningGuidance: (input) => learningService?.searchGuidance(input) ?? {
    guidanceCount: 0,
    actionStrategyCount: 0,
    siteSkillCount: 0,
    feedbackCount: 0,
    matches: [],
    actionStrategies: [],
    siteSkills: [],
  },
  searchLearningExtractionRecipes: (input) => learningService?.searchExtractionRecipes(input) ?? {
    recipeCount: 0,
    matches: [],
  },
  recordLearningExtractionObservation: (input) => learningService?.recordExtractionObservation(input) ?? {
    success: false,
  },
  getLearningGuidanceDetail: (input) => learningService?.getGuidanceDetail(input) ?? null,
  getUserMemory: (input) => learningService?.getPreferenceProfile(input) ?? null,
  upsertUserMemory: (input) => learningService?.upsertUserMemory(input) ?? { success: false },
  deleteUserMemory: (input) => learningService?.deleteUserMemory(input) ?? { success: false },
  rejectUserMemory: (input) => learningService?.rejectUserMemory(input) ?? { success: false },
  getWidgetRegistryRootDirectory: () => widgetRegistry.getRootDirectory(),
  listWidgetPackages: () => widgetRegistry.listPackages(),
  getWidgetPackageSource: (packageId) => widgetRegistry.getPackageSource(packageId),
  saveWidgetPackageSource: (input) => widgetRegistry.savePackageSource(input),
  getStartPageWidgetsState: (workspaceId) => getStartPageWidgetsState(workspaceId),
  addStartPageProtocolWidget: (input) => {
    const workspaceId = typeof input?.workspaceId === "string" ? input.workspaceId.trim() : "";
    const resolvedPackageDefaultSize = input?.source
      ? resolveProtocolWidgetPackageDefaultSize(input.source)
      : null;
    const result = addStartPageProtocolWidget(workspaceId, {
      ...input,
      gridH: typeof input?.gridH === "number" ? input.gridH : resolvedPackageDefaultSize?.gridH,
      gridW: typeof input?.gridW === "number" ? input.gridW : resolvedPackageDefaultSize?.gridW,
    });
    startPageWidgetRefreshService.syncWorkspace(workspaceId);
    broadcastStartPageWidgetsChanged(workspaceId, result.widgetsState);
    return result;
  },
  resolveUiLocale,
  getTabWebContents: (tabId) => browserViews.get(tabId)?.webContents ?? null,
  getStartPageUrl: () => MILO_HOME_URL,
  isWindowOpen: (windowId) => windowToWorkspace.has(windowId),
  resolveWorkspaceIdForWindow: (windowId) => windowToWorkspace.get(windowId),
  resolveDefaultMcpTarget: () => {
    const targetWindow = getExistingWorkspaceWindow();
    if (!targetWindow) {
      return null;
    }
    const workspaceId = windowToWorkspace.get(targetWindow.id);
    return workspaceId
      ? {
          workspaceId,
          windowId: targetWindow.id,
        }
      : null;
  },
  ensureAutomationWorkspaceBinding: async (input) => {
    async function waitForAutomationWorkspaceReady(
      workspace: WorkspaceRecord,
      workspaceWindow: BrowserWindow,
      timeoutMs = 8_000,
    ) {
      const startedAt = Date.now();
      let lastPendingReason = "workspace window initialization is still pending";

      while (Date.now() - startedAt < timeoutMs) {
        if (workspaceWindow.isDestroyed() || windowToWorkspace.get(workspaceWindow.id) !== workspace.id) {
          throw new Error(
            `Automation workspace window ${workspaceWindow.id} was destroyed before initialization completed.`,
          );
        }

        const tabs = tabRecords.get(workspaceWindow.id);
        if (!tabs || tabs.size === 0) {
          lastPendingReason = "workspace tabs have not been created yet";
          await new Promise((resolve) => setTimeout(resolve, 40));
          continue;
        }

        const activeTabId = windowActiveTabs.get(workspaceWindow.id);
        if (!activeTabId || !tabs.has(activeTabId)) {
          lastPendingReason = "workspace active tab is not available yet";
          await new Promise((resolve) => setTimeout(resolve, 40));
          continue;
        }

        const activeView = browserViews.get(activeTabId);
        if (!activeView || activeView.webContents.isDestroyed()) {
          lastPendingReason = "workspace active tab view is not available yet";
          await new Promise((resolve) => setTimeout(resolve, 40));
          continue;
        }

        const currentSummary = serializeWorkspace(workspace);
        if (currentSummary.automationTargetId !== activeView.webContents.id) {
          await setWorkspaceAutomationTarget(workspace.id, activeView.webContents.id);
        }

        return {
          activeTabId,
          targetContentsId: activeView.webContents.id,
        };
      }

      throw new Error(
        `Automation workspace ${workspace.id} did not finish initializing within ${timeoutMs}ms: ${lastPendingReason}.`,
      );
    }

    let workspace = input.workspaceId ? workspaces.get(input.workspaceId) : undefined;
    let shouldPersistWorkspace = false;
    const profileSourceWorkspace = input.privacyMode === false && input.originWorkspaceId
      ? workspaces.get(input.originWorkspaceId)
      : undefined;

    if (!workspace) {
      const workspaceId = randomUUID();
      const preferredName = input.title.trim()
        ? `automation-${input.title.trim().slice(0, 24)}`
        : `automation-${input.sessionId.slice(0, 8)}`;
      workspace = {
        id: workspaceId,
        name: createWorkspaceName(preferredName),
        createdAt: Date.now(),
        profileId: profileSourceWorkspace?.profileId ?? workspaceId,
        profileMode: profileSourceWorkspace ? "attached" : "new",
        profileSourceWorkspaceId: profileSourceWorkspace?.id,
        automationEnabled: true,
        tags: [AUTOMATION_WORKSPACE_TAG],
      };
      workspaces.set(workspace.id, workspace);
      shouldPersistWorkspace = true;
    } else if (!workspace.tags?.includes(AUTOMATION_WORKSPACE_TAG)) {
      workspace.tags = [...(workspace.tags ?? []), AUTOMATION_WORKSPACE_TAG];
      shouldPersistWorkspace = true;
    }

    if (shouldPersistWorkspace) {
      flushWorkspaceStateSave();
    }

    if (!workspace) {
      throw new Error("Failed to create or resolve an automation workspace.");
    }

    if (isAutomationWorkspaceRecord(workspace)) {
      void learningService?.syncWorkspaceTarget(workspace.id, undefined);
    }

    const workspaceWindow = BrowserWindow.getAllWindows()
      .filter((targetWindow) => !targetWindow.isDestroyed())
      .find((targetWindow) => windowToWorkspace.get(targetWindow.id) === workspace.id)
      ?? createWorkspaceWindow(workspace, { show: false });

    const ready = await waitForAutomationWorkspaceReady(workspace, workspaceWindow);
    const currentTabs = tabRecords.get(workspaceWindow.id);
    const resolvedTabId = input.tabId && currentTabs?.has(input.tabId)
      ? input.tabId
      : ready.activeTabId;

    if (shouldPersistWorkspace) {
      broadcastWorkspaceContext();
    }

    return {
      workspaceId: workspace.id,
      windowId: workspaceWindow.id,
      tabId: resolvedTabId,
    };
  },
  onAutomationWorkspaceReleased: ({ workspaceId }) => {
    const workspace = workspaces.get(workspaceId);
    if (!workspace?.tags?.includes(AUTOMATION_WORKSPACE_TAG)) {
      return;
    }

    windowActionsManager?.deleteWorkspacesByIds([workspaceId]);
  },
  onControlledTabsChanged: ({ windowId }) => {
    const targetWindow = BrowserWindow.fromId(windowId);
    if (targetWindow && !targetWindow.isDestroyed()) {
      tabManager?.broadcastTabState(targetWindow);
    }
  },
  onManualInterventionRequested: ({ tabId, kind, message }) => {
    requestTabManualIntervention({
      tabId,
      kind,
      message,
    });
  },
  agentTasksDirectoryPath,
  legacyAgentStatePath: legacyAgentTasksStatePath,
  legacyAgentStateBackupPath: legacyAgentTasksStateBackupPath,
  getWindowContext: (windowId) => {
    const tabs = Array.from(tabRecords.get(windowId)?.values() ?? []);
    const activeTabId = windowActiveTabs.get(windowId);
    const activeTab = tabs.find((tab) => tab.id === activeTabId);

    return {
      ...(activeTabId ? { activeTabId } : {}),
      ...(activeTab?.url ? { activeUrl: activeTab.url } : {}),
      ...(activeTab?.title ? { activeTitle: activeTab.title } : {}),
      tabs: tabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        displayUrl: tab.displayUrl,
        isActive: tab.id === activeTabId,
      })),
    };
  },
});

const downloadManager = createDownloadManager({
  storagePath: downloadsPath,
  tempRootPath: downloadsTempRootPath,
  fallbackUserAgent: CHROME_USER_AGENT,
  onChange: () => {
    emitDownloadStatusNotifications();
    emitBrowserDownloadEvents();
    notifyDownloadsChanged();
  },
});

browserRuntimeManager = createBrowserRuntimeManager({
  defaultSessionKey: DEFAULT_SESSION_KEY,
  chromeUserAgent: CHROME_USER_AGENT,
  colorSchemeCommandTimeoutMs: COLOR_SCHEME_COMMAND_TIMEOUT_MS,
  colorSchemeMediaSyncStateKey: COLOR_SCHEME_MEDIA_SYNC_STATE_KEY,
  isGoogleRelatedUrl,
  getResolvedColorScheme,
  resolveDownloadDirectory,
  parseDownloadHeadersText,
  getDownloadSettings,
  downloadManager,
  browserViews,
  getAuxiliaryWebContents: () => getLinkPreviewWebContents(),
  clearPageTranslationState,
  onBrowserDownloadCreated: ({ record, sourceTabId }) => {
    emitBrowserDownloadCreated(record, sourceTabId);
  },
});

function resolveExtensionTabSnapshot(
  profileId: string,
  targetWindow: BrowserWindow,
  tabId: string,
) {
  const workspaceId = windowToWorkspace.get(targetWindow.id);
  const workspace = workspaceId ? workspaces.get(workspaceId) : undefined;
  if (!workspace || workspace.profileId !== profileId) {
    return null;
  }

  const tabs = tabRecords.get(targetWindow.id);
  const tab = tabs?.get(tabId);
  if (!tabs || !tab) {
    return null;
  }

  const view = browserViews.get(tabId);
  const contents = view?.webContents;
  const url = contents && !contents.isDestroyed()
    ? contents.getURL() || tab.url
    : tab.url;
  const title = contents && !contents.isDestroyed()
    ? contents.getTitle() || tab.title
    : tab.title;

  return {
    tabId,
    windowId: targetWindow.id,
    url,
    title,
    active: windowActiveTabs.get(targetWindow.id) === tabId,
    index: Array.from(tabs.keys()).indexOf(tabId),
    favIconUrl: tab.favicon,
    isLoading: tab.isLoading,
  };
}

function resolveExtensionActiveTabSnapshot(profileId: string, ownerWindow: BrowserWindow | null) {
  const candidateWindows = [
    ...(ownerWindow && !ownerWindow.isDestroyed() ? [ownerWindow] : []),
    ...BrowserWindow.getAllWindows().filter((candidateWindow) =>
      !ownerWindow || candidateWindow.id !== ownerWindow.id),
  ];

  for (const candidateWindow of candidateWindows) {
    if (candidateWindow.isDestroyed()) {
      continue;
    }

    const activeTabId = windowActiveTabs.get(candidateWindow.id);
    if (!activeTabId) {
      continue;
    }

    const snapshot = resolveExtensionTabSnapshot(profileId, candidateWindow, activeTabId);
    if (snapshot) {
      return snapshot;
    }
  }

  return null;
}

const extensionManager = createExtensionManager({
  userAgent: CHROME_USER_AGENT,
  resolveRequestUserAgent: (url) =>
    requireBrowserRuntimeManager().resolveRequestUserAgent(url, CHROME_USER_AGENT),
  resolveActiveTab: (profileId, ownerWindow) =>
    resolveExtensionActiveTabSnapshot(profileId, ownerWindow),
  resolveTab: (profileId, windowId, tabId) => {
    const targetWindow = BrowserWindow.fromId(windowId);
    return targetWindow && !targetWindow.isDestroyed()
      ? resolveExtensionTabSnapshot(profileId, targetWindow, tabId)
      : null;
  },
  onChanged: (profileId) => {
    notifyExtensionsChanged(profileId);
  },
});

const userScriptManager = createUserScriptManager({
  storagePath: userScriptsPath,
  onChanged: (profileId) => {
    notifyUserScriptsChanged(profileId);
  },
});

const passkeyManager = createPasskeyManager({
  getStoragePath: () => passkeysPath,
  getLocale: () => {
    const language = getLanguage().trim().toLowerCase();
    return language === "system" ? resolveBrowserLocale() : getLanguage();
  },
});

pageTranslationManager = createPageTranslationManager({
  getTranslationPreferences,
  setTranslationPreferences,
  resolveBrowserLocale,
  resolveUiLocale,
  openSettings: openSettingsFromApplicationMenu,
});

tabManager = createTabManager({
  defaultWorkspaceId: DEFAULT_WORKSPACE_ID,
  preloadPath,
  tabLoadingDebugEnabled,
  displayUrlOptions: DISPLAY_URL_OPTIONS,
  startPageUrlOptions: START_PAGE_URL_OPTIONS,
  resolveInputToUrlOptions: RESOLVE_INPUT_TO_URL_OPTIONS,
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
  clearUserScriptsForContents: (contentsId) => userScriptManager.clearContents(contentsId),
  cleanupUserScriptUiForContents: (targetContents) =>
    userScriptManager.cleanupPageUi(targetContents),
  injectUserScriptsForPage: (profileId, targetContents, url) =>
    userScriptManager.injectMatching(profileId, targetContents, url),
  ensureContentsOverrides,
  setupBrowserViewContextMenu,
  registerGuestContents,
  beginWorkspaceSessionRestore,
  endWorkspaceSessionRestore,
  persistWorkspaceSessionForWindow,
  getWorkspaceSession,
  isAutomationControlledTabId: browserAgentService.isTabControlled,
  getTabManualInterventionMessage,
  clearTabManualInterventionMessage,
  broadcastWorkspaceContext,
  updateWindowTitle,
  clearLinkPreviewForTab,
  destroyLinkPreview,
  updateLinkPreviewBounds: (targetWindow) => linkPreviewManager?.updateLinkPreviewBounds(targetWindow),
  updateWindowOverlayBounds: (targetWindow) => {
    linkPreviewManager?.updateWindowOverlayBounds(targetWindow);
    updatePageSearchOverlayBounds(targetWindow);
    updateAiSidebarOverlayBounds(targetWindow);
  },
  isTrackableHistoryUrl,
  recordHistoryVisit,
  updateHistoryMetadata,
  requestWindowClose,
  buildBootstrapData,
  installBrowserKeyboardShortcuts: browserKeyboardShortcutsManager.install,
  onTabCreated: ({ windowId, tabId, url, title, isActive, openerTabId, sidebarGroupWithTabId, source }) => {
    const workspaceId = windowToWorkspace.get(windowId) ?? DEFAULT_WORKSPACE_ID;
    if (sidebarGroupWithTabId) {
      groupSidebarTabWithCreatedTab({
        windowId,
        workspaceId,
        sourceTabId: sidebarGroupWithTabId,
        createdTabId: tabId,
      });
    }
    browserAgentService.recordAgentOpenedTab({
      tabId,
      ...(openerTabId ? { openerTabId } : {}),
    });

    browserEventBus.emit({
      kind: "tab.created",
      ts: Date.now(),
      windowId: String(windowId),
      tabId,
      url,
      title,
      source,
      ...(openerTabId ? { openerTabId } : {}),
      summary: isActive ? "active-tab-created" : "background-tab-created",
    });
  },
  onActiveTabChanged: ({ windowId, tabId, contentsId }) => {
    syncPageSearchOverlayActiveTab(windowId, tabId);
    syncAiSidebarOverlayActiveTab(windowId, tabId);
    const workspaceId = windowToWorkspace.get(windowId) ?? DEFAULT_WORKSPACE_ID;
    void setWorkspaceAutomationTarget(workspaceId, contentsId).catch(() => undefined);
  },
});

windowActionsManager = createWindowActionsManager({
  defaultWorkspaceId: DEFAULT_WORKSPACE_ID,
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
  getSearchOverlayView: () => searchOverlayView,
  setSearchOverlayVisible: (visible) => {
    searchOverlayVisible = visible;
  },
  getBoundAgentSessionsForWorkspace: (workspaceId) =>
    browserAgentService.listBoundSessionsForWorkspace(workspaceId),
  clearStartPageAppearanceOverrides,
  clearStartPageDockItemOverrides,
  clearStartPageWidgetStateOverrides,
});

function broadcastToRendererProcesses(channel: string, ...args: unknown[]) {
  const sentContentsIds = new Set<number>();

  function sendToContents(targetContents: WebContents | null | undefined) {
    if (!targetContents || targetContents.isDestroyed() || sentContentsIds.has(targetContents.id)) {
      return;
    }

    sentContentsIds.add(targetContents.id);
    targetContents.send(channel, ...args);
  }

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      sendToContents(win.webContents);
    }
  }

  for (const view of browserViews.values()) {
    sendToContents(view.webContents);
  }

  sendToContents(searchOverlayView?.webContents);
  sendToContents(pageSearchOverlayView?.webContents);
  sendToContents(aiSidebarOverlayView?.webContents);
}

function broadcastToWorkspaceRendererProcesses(
  workspaceId: string,
  channel: string,
  ...args: unknown[]
) {
  const sentContentsIds = new Set<number>();

  function sendToContents(targetContents: WebContents | null | undefined) {
    if (!targetContents || targetContents.isDestroyed() || sentContentsIds.has(targetContents.id)) {
      return;
    }

    sentContentsIds.add(targetContents.id);
    targetContents.send(channel, ...args);
  }

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && windowToWorkspace.get(win.id) === workspaceId) {
      sendToContents(win.webContents);
    }
  }

  for (const view of browserViews.values()) {
    if (view.webContents.isDestroyed()) {
      continue;
    }

    try {
      if (buildBootstrapData(view.webContents).currentWorkspace.id === workspaceId) {
        sendToContents(view.webContents);
      }
    } catch {
      // Ignore detached views that are not ready to receive workspace-scoped updates.
    }
  }
}

function broadcastThemeChanged(theme: string) { broadcastToRendererProcesses("theme:changed", theme); }
function broadcastLanguageChanged(language: string) {
  broadcastToRendererProcesses("language:changed", language);
}
function broadcastStartPageAppearanceChanged(
  workspaceId: string,
  appearance: ReturnType<typeof getStartPageAppearance>,
) {
  broadcastToWorkspaceRendererProcesses(workspaceId, "start-page:appearance-changed", appearance);
}
function broadcastStartPageDockChanged(
  workspaceId: string,
  items: ReturnType<typeof getStartPageDockItems>,
) {
  broadcastToWorkspaceRendererProcesses(workspaceId, "start-page:dock-changed", items);
}
function broadcastStartPageWidgetsChanged(
  workspaceId: string,
  state: ReturnType<typeof getStartPageWidgetsState>,
) {
  broadcastToWorkspaceRendererProcesses(workspaceId, "start-page:widgets-changed", state);
}
function broadcastStartPageWidgetRefresh(
  workspaceId: string,
  event: StartPageWidgetRefreshEvent,
) {
  broadcastToWorkspaceRendererProcesses(workspaceId, "start-page:widget-refresh", event);
}
function getWindowIdForTabId(tabId: string): string | undefined {
  for (const [windowId, tabs] of tabRecords.entries()) {
    if (tabs.has(tabId)) {
      return String(windowId);
    }
  }
  return undefined;
}

function sanitizeDownloadFilename(value: string) {
  const normalized = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "");
  return normalized || "image";
}

function inferSavedImageFilename(imageUrl: string) {
  let baseName = "image";

  try {
    const parsed = new URL(imageUrl);
    if (parsed.protocol !== "data:") {
      const candidate = decodeURIComponent(parsed.pathname.split("/").pop() ?? "").trim();
      if (candidate) {
        const sanitizedCandidate = sanitizeDownloadFilename(candidate);
        baseName = path.basename(sanitizedCandidate, path.extname(sanitizedCandidate));
      }
    }
  } catch {
    // Use the generic image filename when the source URL cannot be parsed.
  }

  return sanitizeDownloadFilename(`${baseName}.png`);
}

function ensureUniqueFilePath(targetPath: string) {
  if (!existsSync(targetPath)) {
    return targetPath;
  }

  const directory = path.dirname(targetPath);
  const extension = path.extname(targetPath);
  const baseName = path.basename(targetPath, extension);
  let index = 1;

  while (true) {
    const candidate = path.join(directory, `${baseName} (${index})${extension}`);
    if (!existsSync(candidate)) {
      return candidate;
    }
    index += 1;
  }
}

function parseImageDataUrl(dataUrl: string) {
  const trimmed = dataUrl.trim();
  if (!trimmed.toLowerCase().startsWith("data:")) {
    throw new Error("Image data URL is invalid.");
  }

  const commaIndex = trimmed.indexOf(",");
  if (commaIndex < 0) {
    throw new Error("Image data URL is missing content.");
  }

  const metadata = trimmed.slice(5, commaIndex);
  const metadataParts = metadata.split(";").map((part) => part.trim()).filter(Boolean);
  const mimeType = metadataParts[0]?.includes("/") ? metadataParts[0].toLowerCase() : "image/png";
  const isBase64 = metadataParts.some((part) => part.toLowerCase() === "base64");
  const dataPart = trimmed.slice(commaIndex + 1);
  const buffer = isBase64
    ? Buffer.from(dataPart.replace(/\s/g, ""), "base64")
    : Buffer.from(decodeURIComponent(dataPart), "utf-8");

  if (buffer.length === 0) {
    throw new Error("Image data is empty.");
  }

  return { buffer, mimeType };
}

async function readImageDataUrlFromFrame(
  targetContents: WebContents,
  frame: WebFrameMain | null | undefined,
  imageUrl: string,
) {
  const script = `
(async () => {
  const imageUrl = ${JSON.stringify(imageUrl)};
  const response = await fetch(imageUrl);
  if (!response.ok && response.status !== 0) {
    throw new Error("Image request failed with status " + response.status);
  }
  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image data."));
    reader.onload = () => resolve({
      dataUrl: String(reader.result || ""),
      mimeType: blob.type || response.headers.get("content-type") || "",
    });
    reader.readAsDataURL(blob);
  });
})()
`;
  const executionTarget = frame && !frame.isDestroyed() ? frame : targetContents.mainFrame;
  const result = await executionTarget.executeJavaScript(script, true);
  if (!result || typeof result !== "object" || typeof (result as { dataUrl?: unknown }).dataUrl !== "string") {
    throw new Error("Failed to extract image data from the page.");
  }

  return result as { dataUrl: string; mimeType?: string };
}

async function saveImageBytesToDirectory(input: {
  targetContents: WebContents;
  frame?: WebFrameMain | null;
  imageUrl: string;
  directory: string;
}) {
  const extracted = input.imageUrl.trim().toLowerCase().startsWith("data:")
    ? { dataUrl: input.imageUrl, mimeType: "" }
    : await readImageDataUrlFromFrame(input.targetContents, input.frame, input.imageUrl);
  const parsed = parseImageDataUrl(extracted.dataUrl);
  const filename = inferSavedImageFilename(input.imageUrl);
  await mkdir(input.directory, { recursive: true });
  await writeFile(
    ensureUniqueFilePath(path.join(input.directory, filename)),
    parsed.buffer,
  );
}

function readClipboardSnapshot() {
  const image = clipboard.readImage();
  return {
    text: clipboard.readText(),
    html: clipboard.readHTML(),
    rtf: clipboard.readRTF(),
    image: image.isEmpty() ? undefined : image,
  };
}

function restoreClipboardSnapshot(snapshot: ReturnType<typeof readClipboardSnapshot>) {
  const data: Parameters<typeof clipboard.write>[0] = {};
  if (snapshot.text) {
    data.text = snapshot.text;
  }
  if (snapshot.html) {
    data.html = snapshot.html;
  }
  if (snapshot.rtf) {
    data.rtf = snapshot.rtf;
  }
  if (snapshot.image) {
    data.image = snapshot.image;
  }

  if (Object.keys(data).length > 0) {
    clipboard.write(data);
    return;
  }

  clipboard.clear();
}

async function readRenderedImagePngAtPoint(
  targetContents: WebContents,
  point: { x: number; y: number },
) {
  const snapshot = readClipboardSnapshot();

  try {
    clipboard.clear();
    targetContents.copyImageAt(point.x, point.y);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const image = clipboard.readImage();
    if (image.isEmpty()) {
      throw new Error("Failed to read the image from the page.");
    }

    const png = image.toPNG();
    if (png.length === 0) {
      throw new Error("The copied image is empty.");
    }

    return png;
  } finally {
    restoreClipboardSnapshot(snapshot);
  }
}

async function saveRenderedImageToDirectory(input: {
  targetContents: WebContents;
  frame?: WebFrameMain | null;
  imageUrl: string;
  directory: string;
  point: { x: number; y: number };
}) {
  let png: Buffer;
  try {
    png = await readRenderedImagePngAtPoint(input.targetContents, input.point);
  } catch (error) {
    const canReadFromPage = input.imageUrl.trim().toLowerCase().startsWith("data:")
      || input.imageUrl.trim().toLowerCase().startsWith("blob:");
    if (!canReadFromPage) {
      throw error;
    }

    await saveImageBytesToDirectory(input);
    return;
  }

  await mkdir(input.directory, { recursive: true });
  await writeFile(
    ensureUniqueFilePath(path.join(input.directory, inferSavedImageFilename(input.imageUrl))),
    png,
  );
}

function getTabManualInterventionMessage(tabId: string) {
  return tabManualInterventionState.get(tabId)?.message;
}

function resolveDockItemForContents(targetContents: WebContents) {
  for (const [, tabs] of tabRecords.entries()) {
    for (const [tabId, tab] of tabs.entries()) {
      const view = browserViews.get(tabId);
      if (view?.webContents.id !== targetContents.id) {
        continue;
      }

      return {
        favicon: tab.favicon,
        title: tab.title || targetContents.getTitle() || `Tab ${tabId}`,
        url: tab.url,
      };
    }
  }

  const url = targetContents.getURL().trim();
  if (!url) {
    return null;
  }

  return {
    title: targetContents.getTitle() || url,
    url,
  };
}

function resolveWorkspaceIdForContents(targetContents: WebContents) {
  const targetWindow = BrowserWindow.fromWebContents(targetContents);
  if (targetWindow && !targetWindow.isDestroyed()) {
    return windowToWorkspace.get(targetWindow.id) ?? DEFAULT_WORKSPACE_ID;
  }

  for (const [windowId, tabs] of tabRecords.entries()) {
    for (const tabId of tabs.keys()) {
      const view = browserViews.get(tabId);
      if (view?.webContents.id === targetContents.id) {
        return windowToWorkspace.get(windowId) ?? DEFAULT_WORKSPACE_ID;
      }
    }
  }

  return DEFAULT_WORKSPACE_ID;
}

function clearTabManualInterventionMessage(tabId: string) {
  if (!tabManualInterventionState.delete(tabId)) {
    return;
  }

  const windowId = getWindowIdForTabId(tabId);
  if (!windowId) {
    return;
  }

  const targetWindow = BrowserWindow.fromId(Number(windowId));
  if (targetWindow && !targetWindow.isDestroyed()) {
    tabManager?.broadcastTabState(targetWindow);
  }
}

function requestTabManualIntervention(input: {
  tabId: string;
  kind: "human_verification" | "verification_code" | "login_required" | "blocked";
  message: string;
}) {
  const current = tabManualInterventionState.get(input.tabId);
  const changed =
    !current
    || current.kind !== input.kind
    || current.message !== input.message;

  if (changed) {
    tabManualInterventionState.set(input.tabId, {
      kind: input.kind,
      message: input.message,
    });
  }

  const windowId = getWindowIdForTabId(input.tabId);
  if (!windowId) {
    return;
  }

  const targetWindow = BrowserWindow.fromId(Number(windowId));
  if (!targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  revealWorkspaceWindow(targetWindow);
  try {
    handleTabSetActive(targetWindow, input.tabId);
  } catch {
    // Ignore transient tab/window teardown while surfacing the intervention tab.
  }
  focusActiveTabContents(targetWindow);

  if (changed) {
    tabManager?.broadcastTabState(targetWindow);
  }
}

const downloadNotificationStatuses = new Map<string, DownloadRecord["status"]>();

function showSystemNotification(
  input: SystemNotificationInput,
  options?: { onClick?: () => void },
) {
  return systemNotificationService.show(input, options);
}

function showAgentTaskFinishedNotification(snapshot: AgentSessionSnapshot) {
  const title = "Agent task finished";
  const body = snapshot.title || snapshot.preview || "Milo has finished a task.";
  showSystemNotification(
    {
      title,
      body,
    },
    {
      onClick: () => {
        const targetWindow = BrowserWindow.fromId(snapshot.windowId);
        if (targetWindow && !targetWindow.isDestroyed()) {
          revealWorkspaceWindow(targetWindow);
        }
      },
    },
  );
}

function showDownloadStatusNotification(record: DownloadRecord) {
  const filename = record.filename || "Downloaded file";

  if (record.status === "completed") {
    showSystemNotification(
      {
        title: "Download complete",
        body: filename,
      },
      {
        onClick: () => {
          shell.showItemInFolder(record.targetPath);
        },
      },
    );
    return;
  }

  if (record.status === "failed") {
    showSystemNotification(
      {
        title: "Download failed",
        body: record.error ? `${filename}: ${record.error}` : filename,
        urgency: "normal",
      },
      {
        onClick: () => {
          openDownloadsFromApplicationMenu();
        },
      },
    );
  }
}

function emitDownloadStatusNotifications() {
  const seenIds = new Set<string>();

  for (const record of downloadManager.getRecords()) {
    seenIds.add(record.id);
    const previousStatus = downloadNotificationStatuses.get(record.id);
    downloadNotificationStatuses.set(record.id, record.status);

    if (
      previousStatus
      && previousStatus !== record.status
      && (record.status === "completed" || record.status === "failed")
    ) {
      showDownloadStatusNotification(record);
    }
  }

  for (const downloadId of Array.from(downloadNotificationStatuses.keys())) {
    if (!seenIds.has(downloadId)) {
      downloadNotificationStatuses.delete(downloadId);
    }
  }
}

function buildBrowserDownloadSnapshot(record: DownloadRecord) {
  return {
    status: record.status,
    receivedBytes: record.receivedBytes,
    totalBytes: record.totalBytes,
    ...(record.error ? { error: record.error } : {}),
  };
}

function emitBrowserDownloadCreated(record: DownloadRecord, sourceTabId?: string) {
  if (sourceTabId) {
    browserDownloadSourceTabIds.set(record.id, sourceTabId);
  }
  browserDownloadSnapshots.set(record.id, buildBrowserDownloadSnapshot(record));
  browserEventBus.emit({
    kind: "download.created",
    ts: Date.now(),
    ...(sourceTabId ? { sourceTabId, tabId: sourceTabId, windowId: getWindowIdForTabId(sourceTabId) } : {}),
    downloadId: record.id,
    url: record.finalUrl || record.url,
    filename: record.filename,
    state: record.status,
    bytes: record.receivedBytes,
    ...(record.totalBytes !== null ? { totalBytes: record.totalBytes } : {}),
  });
}

function emitBrowserDownloadEvents() {
  const currentRecords = downloadManager.getRecords()
    .filter((record) => record.source === "browser");
  const seenIds = new Set<string>();

  for (const record of currentRecords) {
    seenIds.add(record.id);
    const previous = browserDownloadSnapshots.get(record.id);
    const nextSnapshot = buildBrowserDownloadSnapshot(record);
    const sourceTabId = browserDownloadSourceTabIds.get(record.id);
    const basePayload = {
      ts: Date.now(),
      ...(sourceTabId ? { sourceTabId, tabId: sourceTabId, windowId: getWindowIdForTabId(sourceTabId) } : {}),
      downloadId: record.id,
      url: record.finalUrl || record.url,
      filename: record.filename,
      state: record.status,
      bytes: record.receivedBytes,
      ...(record.totalBytes !== null ? { totalBytes: record.totalBytes } : {}),
    };

    if (!previous) {
      browserDownloadSnapshots.set(record.id, nextSnapshot);
      continue;
    }

    if (record.receivedBytes !== previous.receivedBytes) {
      browserEventBus.emit({
        kind: "download.progress",
        ...basePayload,
      });
    }

    if (record.status !== previous.status) {
      browserEventBus.emit({
        kind: "download.updated",
        ...basePayload,
      });

      if (record.status === "completed") {
        browserEventBus.emit({
          kind: "download.completed",
          ...basePayload,
        });
      } else if (record.status === "failed") {
        browserEventBus.emit({
          kind: "download.failed",
          ...basePayload,
          ...(record.error ? { error: record.error } : {}),
        });
      } else if (record.status === "canceled") {
        browserEventBus.emit({
          kind: "download.canceled",
          ...basePayload,
        });
      }
    }

    browserDownloadSnapshots.set(record.id, nextSnapshot);
  }

  for (const downloadId of Array.from(browserDownloadSnapshots.keys())) {
    if (seenIds.has(downloadId)) {
      continue;
    }
    browserDownloadSnapshots.delete(downloadId);
    browserDownloadSourceTabIds.delete(downloadId);
  }
}

function notifyDownloadsChanged() { broadcastToRendererProcesses("downloads:changed"); }
function notifyExtensionsChanged(profileId: string) {
  broadcastToRendererProcesses("extensions:changed", { profileId });
}
function notifyUserScriptsChanged(profileId: string) {
  broadcastToRendererProcesses("user-scripts:changed", { profileId });
}

registerMainIpcHandlers({
  DEFAULT_WORKSPACE_ID,
  MILO_SEARCH_URL,
  preloadPath,
  workspaces,
  windows,
  browserViews,
  tabRecords,
  windowActiveTabs,
  windowSidebarWidths,
  windowUrlBarHeights,
  getBookmarks,
  setBookmarks,
  getBookmarkFolders,
  setBookmarkFolders,
  saveBookmarks,
  notifyBookmarksChanged,
  getHistoryRecords,
  setHistoryRecords,
  saveHistoryRecords,
  notifyHistoryChanged,
  showSystemNotification,
  buildBootstrapData,
  createWorkspaceName,
  createWorkspaceWindow,
  switchWindowWorkspace,
  openCreateWorkspaceDialog,
  openFolderSettingsDialog,
  deleteWorkspaces: deleteWorkspacesByIds,
  openWorkspaceProfileDirectory,
  getWorkspaceRecord,
  revealWorkspaceWindow,
  updateWindowTitle,
  serializeWorkspace,
  serializeWindow,
  saveWorkspaceState: flushWorkspaceStateSave,
  broadcastWorkspaceContext,
  setWorkspaceAutomationTarget,
  sendWorkspaceCdpCommand,
  handleTabCreate,
  serializeTabRecord,
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
  syncSidebarOrganizationState,
  updateSidebarFolderSettings,
  handleLinkPreviewHover,
  handleLinkPreviewHoverLeave,
  handleLinkPreviewPointerState,
  handleLinkPreviewClose,
  handleLinkPreviewMaximize,
  resolveInputToUrlOptions: RESOLVE_INPUT_TO_URL_OPTIONS,
  displayUrlOptions: DISPLAY_URL_OPTIONS,
  startPageUrlOptions: START_PAGE_URL_OPTIONS,
  broadcastTabState,
  updateBrowserViewBounds,
  getSearchOverlayState: () => ({
    view: searchOverlayView,
    visible: searchOverlayVisible,
  }),
  setSearchOverlayState: ({ view, visible }) => {
    searchOverlayView = view;
    searchOverlayVisible = visible;
  },
  getSearchOverlayBounds,
  closeSearchOverlay,
  getPageSearchOverlayState: () => ({
    view: pageSearchOverlayView,
    visible: pageSearchOverlayVisible,
    windowId: pageSearchOverlayWindowId,
    tabId: pageSearchOverlayTabId,
    query: pageSearchOverlayQuery,
    result: pageSearchOverlayResult,
  }),
  setPageSearchOverlayState: (input) => {
    pageSearchOverlayView = input.view;
    pageSearchOverlayVisible = input.visible;
    pageSearchOverlayWindowId = input.windowId;
    pageSearchOverlayTabId = input.tabId;
    pageSearchOverlayQuery = input.query;
    pageSearchOverlayResult = input.result;
  },
  getPageSearchOverlayBounds,
  closePageSearchOverlay,
  broadcastPageSearchOverlayState: sendPageSearchOverlayState,
  getAiSidebarOverlayState,
  openAiSidebarOverlay,
  closeAiSidebarOverlay,
  toggleAiSidebarOverlay,
  getTheme,
  applyColorSchemeToContents,
  getLanguage,
  getDefaultBrowserStatus,
  getBrowserLocale: resolveBrowserLocale,
  setAsDefaultBrowser,
  getDownloadPreferences,
  setDownloadPreferences,
  getLlmProviders,
  setLlmProviders,
  getAgentPreferences,
  setAgentPreferences: (input) => {
    const preferences = setAgentPreferences(input);
    mainAgentMcpHttpServer.syncEnabled(preferences.mcpToolExportEnabled);
    return preferences;
  },
  getImageAgentPreferences,
  setImageAgentPreferences,
  getLearningPreferences,
  setLearningPreferences: (input) => {
    const preferences = setLearningPreferences(input);
    setTimeout(() => {
      learningService?.applyPreferencesChanged();
    }, 0);
    return preferences;
  },
  clearLearningState: () => {
    learningService?.clearState();
    return { success: true };
  },
  flushLearningState: () => learningService?.flushState() ?? {
    success: true,
    processedEventCount: 0,
    learnedEpisodeCount: 0,
    learnedGuidanceCount: 0,
    writingSampleCount: 0,
  },
  deleteLearningSite: (siteId: string) => {
    return learningService?.deleteSite(siteId) ?? { success: false };
  },
  deleteLearningGuidance: (guidanceId: string) => {
    return learningService?.deleteGuidance(guidanceId) ?? { success: false };
  },
  deleteLearningSiteSkill: (skillId: string) => {
    return learningService?.deleteSiteSkill(skillId) ?? { success: false };
  },
  deleteLearningHistorySite: (domain: string) => {
    return learningService?.deleteHistorySite(domain) ?? { success: false };
  },
  deleteLearningStyleProfile: (profileId: string) => {
    return learningService?.deleteStyleProfile(profileId) ?? { success: false };
  },
  deleteLearningPreferenceProfile: (profileId: string) => {
    return learningService?.deletePreferenceProfile(profileId) ?? { success: false };
  },
  upsertLearningUserMemory: (input) => {
    return learningService?.upsertUserMemory(input) ?? { success: false };
  },
  deleteLearningUserMemory: (input) => {
    return learningService?.deleteUserMemory(input) ?? { success: false };
  },
  rejectLearningUserMemory: (input) => {
    return learningService?.rejectUserMemory(input) ?? { success: false };
  },
  getLearningSummary: (input?: LearningSummaryInput | null) => learningService?.getSummary(input ?? undefined) ?? {
    rawEventCount: 0,
    pendingEventCount: 0,
    pageSnapshotCount: 0,
    observationCount: 0,
    episodeCount: 0,
    actionStrategyCount: 0,
    guidanceCount: 0,
    siteSkillCount: 0,
    feedbackCount: 0,
    styleProfileCount: 0,
    preferenceProfileCount: 0,
    historyRecordCount: 0,
    historySiteCount: 0,
    historyVisitCount: 0,
    topHistorySites: [],
    recentActionStrategies: [],
    recentGuidance: [],
  },
  getLearningCatalog: () => learningService?.getCatalog() ?? {
    rawEventCount: 0,
    pendingEventCount: 0,
    pageSnapshotCount: 0,
    observationCount: 0,
    episodeCount: 0,
    actionStrategyCount: 0,
    guidanceCount: 0,
    siteSkillCount: 0,
    feedbackCount: 0,
    styleProfileCount: 0,
    preferenceProfileCount: 0,
    historyRecordCount: 0,
    historySiteCount: 0,
    historyVisitCount: 0,
    historyTopSites: [],
    styleProfiles: [],
    preferenceProfiles: [],
    siteCount: 0,
    sites: [],
    activeProgress: [],
    taskStatus: {
      state: "idle",
      mode: "on",
      observerCount: 0,
      activeWorkflowCount: 0,
      activeWritingCount: 0,
      queuedGuidanceRefinementCount: 0,
      runningGuidanceRefinementCount: 0,
      queuedStyleProfileRefinementCount: 0,
      runningStyleProfileRefinementCount: 0,
      activeDomains: [],
    },
  },
  exportUserData,
  resolveLearningInputAssistContext: (input) => learningService?.resolveInputAssistContext(input) ?? {
    showMenu: false,
    supported: false,
    recentExamples: [],
  },
  generateLearningInputAssistText: (input) => learningService?.generateInputAssistText(input) ?? Promise.resolve({
    success: false,
    error: "Learning service is not available.",
  }),
  getContextPageState: (input) => contextIntelligenceService?.getPageState(input) ?? {
    pageType: "unknown",
    opportunities: [],
    updatedAt: Date.now(),
  },
  dismissContextOpportunity: (input) => contextIntelligenceService?.dismissOpportunity(input) ?? {
    success: true,
  },
  getTranslationPreferences,
  setTranslationPreferences,
  widgetRegistryGetRootDirectory: widgetRegistry.getRootDirectory,
  widgetRegistryListPackages: widgetRegistry.listPackages,
  widgetRegistryGetPackage: widgetRegistry.getPackage,
  widgetRegistryGetPackageManifest: widgetRegistry.getPackageManifest,
  widgetRegistryInspectPackageDirectory: widgetRegistry.inspectPackageDirectory,
  widgetRegistryInstallPackageFromDirectory: widgetRegistry.installPackageFromDirectory,
  widgetRegistryRemovePackage: widgetRegistry.removePackage,
  widgetRegistryRevealPackage: widgetRegistry.revealPackage,
  widgetRegistryCreateStarterPackage: widgetRegistry.createStarterPackage,
  widgetRegistryRevealRootDirectory: widgetRegistry.revealRootDirectory,
  getRenderPreviewDocument,
  agentEnsureSession: browserAgentService.ensureSession,
  agentListSessions: browserAgentService.listSessions,
  agentCreateSession: browserAgentService.createSession,
  agentGetSession: browserAgentService.getSession,
  agentGetSessionForTab: browserAgentService.getSessionForTab,
  agentRebindSessionToTab: browserAgentService.rebindSessionToTab,
  agentSendUserMessage: browserAgentService.sendUserMessage,
  agentSetSessionSchedule: browserAgentService.setSessionSchedule,
  agentClearSessionSchedule: browserAgentService.clearSessionSchedule,
  agentListLaunchSchedules: browserAgentService.listAgentLaunchSchedules,
  agentGetLaunchSchedule: browserAgentService.getAgentLaunchSchedule,
  agentSetLaunchSchedule: browserAgentService.setAgentLaunchSchedule,
  agentClearLaunchSchedule: browserAgentService.clearAgentLaunchSchedule,
  agentInterruptSession: browserAgentService.interruptSession,
  agentResumeSession: browserAgentService.resumeSession,
  agentDeleteSession: browserAgentService.deleteSession,
  agentExportSessionMcp: browserAgentService.exportSessionMcp,
  agentCallSessionMcpTool: browserAgentService.callSessionMcpTool,
  getAgentMcpHttpAddress: () => mainAgentMcpHttpServer.getAddress(),
  subscribeAgentUpdates: browserAgentService.subscribe,
  installApplicationMenu,
  applyThemeToNativeTheme,
  broadcastThemeChanged,
  broadcastLanguageChanged,
  syncColorSchemeForAllTabs,
  getDownloadSettings,
  setThemeSetting: setTheme,
  setLanguageSetting: setLanguage,
  parseDownloadHeadersText,
  resolveDownloadDirectory,
  getStartPageAppearance,
  getStartPageDockItems,
  getStartPageWidgetsState,
  getStartPageWidgetRefreshes: (workspaceId) =>
    startPageWidgetRefreshService.getWorkspaceRefreshes(workspaceId ?? DEFAULT_WORKSPACE_ID),
  runStartPageWidgetAutomationCall,
  addToStartPageDock,
  setStartPageAppearance,
  setStartPageDockItems,
  setStartPageWidgets,
  syncStartPageWidgetRefreshTriggers: (workspaceId) =>
    startPageWidgetRefreshService.syncWorkspace(workspaceId),
  syncAllStartPageWidgetRefreshTriggers: () =>
    startPageWidgetRefreshService.syncAll(),
  setStartPageDockItemFavicon,
  removeStartPageDockItem,
  clearStartPageDockItems,
  broadcastStartPageAppearanceChanged,
  broadcastStartPageDockChanged,
  broadcastStartPageWidgetsChanged,
  downloadManager,
  extensionManager,
  userScriptManager,
  passkeyManager,
  generateUserScriptDraft: (input) => {
    const backend = resolveOpenAICompatibleBackendConfig({
      getAgentPreferences,
      getLlmProviders,
      getTranslationPreferences,
      env: process.env,
    });
    if (!backend) {
      throw new Error("Agent backend is not configured. Configure an OpenAI-compatible provider in Settings.");
    }
    return generateUserScriptAgentDraft({ backend, input });
  },
});

app.on("browser-window-created", (_event, targetWindow) => {
  targetWindow.on("closed", () => {
    try {
      persistAllWorkspaceSessionsForWindow(targetWindow.id);
      flushWorkspaceStateSave();
    } catch {
      // Window state may already be fully torn down by the window manager.
    }
    cleanupLinkPreviewState(targetWindow.id);
    for (const key of Array.from(sidebarOrganizationStates.keys())) {
      if (key.startsWith(`${targetWindow.id}:`)) {
        sidebarOrganizationStates.delete(key);
      }
    }
    for (const key of Array.from(sidebarOrganizationSyncSequences.keys())) {
      if (key.startsWith(`${targetWindow.id}:`)) {
        sidebarOrganizationSyncSequences.delete(key);
      }
    }
    pendingWorkspaceSessionRestores.delete(targetWindow.id);
  });
});

function persistAllOpenWorkspaceSessions() {
  for (const targetWindow of BrowserWindow.getAllWindows()) {
    if (targetWindow.isDestroyed() || !windowToWorkspace.has(targetWindow.id)) {
      continue;
    }

    try {
      persistAllWorkspaceSessionsForWindow(targetWindow.id);
    } catch {
      // The window may be in the middle of teardown.
    }
  }
}

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) {
    return;
  }

  if (process.platform === "darwin") {
    const appIcon = nativeImage.createFromPath(appIconPath);
    if (!appIcon.isEmpty()) {
      app.dock?.setIcon(appIcon);
    }
  }

  requireBrowserRuntimeManager().setOriginalBrowserUserAgent(
    session.defaultSession.getUserAgent(),
  );
  app.userAgentFallback = CHROME_USER_AGENT;
  registerMiloProtocol();
  requireBrowserRuntimeManager().registerDownloadHandlingForSession(DEFAULT_SESSION_KEY);

  loadAppSettings();
  mainAgentMcpHttpServer.syncEnabled(getAgentPreferences().mcpToolExportEnabled);
  installApplicationMenu();
  applyThemeToNativeTheme(getTheme());
  nativeTheme.on("updated", () => {
    if (getTheme() === "system") {
      broadcastThemeChanged(getTheme());
      void syncColorSchemeForAllTabs();
    }
  });
  loadBookmarks();
  loadHistory();
  downloadManager.load();
  userScriptManager.load();
  loadWorkspaceState();
  ensureDefaultWorkspace();
  startPageWidgetRefreshService.syncAll();
  await Promise.all(
    extensionManager.getInstalledProfileIds().map((profileId) =>
      extensionManager.ensureProfileExtensionsLoaded(profileId)),
  );
  flushWorkspaceStateSave();
  const defaultWorkspace = workspaces.get(DEFAULT_WORKSPACE_ID);

  if (!defaultWorkspace) {
    throw new Error("Default workspace could not be created.");
  }

  const startupExternalUrl = pendingExternalWebUrls.shift();
  const startupWindow = createWorkspaceWindow(defaultWorkspace, {
    show: true,
    ...(startupExternalUrl
      ? {
        initialUrl: startupExternalUrl,
        forceInitialUrl: true,
      }
      : {}),
  });
  flushPendingExternalWebUrls(startupWindow);

  app.on("activate", () => {
    const hasVisibleWindow = BrowserWindow.getAllWindows().some((targetWindow) =>
      targetWindow.isVisible() && windowToWorkspace.has(targetWindow.id),
    );

    if (!hasVisibleWindow) {
      const defaultTarget = workspaces.get(DEFAULT_WORKSPACE_ID);
      if (!defaultTarget) {
        return;
      }

      const existingWindow = getWorkspaceWindows(defaultTarget.id)[0];
      const targetWindow =
        existingWindow ?? createWorkspaceWindow(defaultTarget, { show: true });
      revealWorkspaceWindow(targetWindow);
    }
  });
});

app.on("before-quit", () => {
  isAppQuitting = true;
  void downloadManager.pauseAll().catch(() => undefined);
  void mainAgentMcpHttpServer.shutdown().catch(() => undefined);
  startPageWidgetRefreshService.shutdown();
  persistAllOpenWorkspaceSessions();
  flushWorkspaceStateSave();
  learningService?.shutdown();
  browserAgentService.flushState();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
