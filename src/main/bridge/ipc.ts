import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  Menu,
  WebContentsView,
  ipcMain,
  type FoundInPageResult,
  type MenuItemConstructorOptions,
  type OpenDialogOptions,
  type WebContents,
} from "electron";
import type {
  BrowserExtensionActionSummary,
  BrowserExtensionSummary,
  ChromeWebStoreInstallRequest,
  ChromeWebStoreInstallState,
  ExtensionActionPopupAnchor,
} from "../services/extensions.js";
import type {
  PasskeyCreateRequest,
  PasskeyGetRequest,
  PasskeyOperationResult,
  SerializedAssertionCredential,
  SerializedAttestationCredential,
} from "../services/passkeys.js";
import type {
  DownloadCreateInput,
  DownloadRecord,
} from "../services/downloads.js";
import type {
  SystemNotificationInput,
  SystemNotificationResult,
} from "../services/system-notifications.js";
import type {
  UserScriptCreateInput,
  UserScriptRecord,
  UserScriptRunResult,
  UserScriptTestResult,
  UserScriptUpdateInput,
} from "../services/user-scripts.js";
import type {
  UserScriptAgentGenerateInput,
  UserScriptAgentGenerateResult,
} from "../services/user-script-agent.js";
import type {
  WidgetPackageManifest,
  WidgetPackageSummary,
} from "../services/widget-registry.js";
import type { StartPageWidgetRefreshEvent } from "../triggers/start-page-widget-refresh.js";
import type { TranslationPreferences } from "../shared/translation.js";
import type {
  AgentModelPreferences,
  AgentPreferences,
  LlmProvider,
  LearningPreferences,
  StartPageAppearance,
  StartPageDockItem,
  StartPageWidget,
  StartPageWidgetsState,
} from "../state/app-settings.js";
import type {
  LearningFlushResult,
  LearningInputAssistActionInput,
  LearningInputAssistContextInput,
  LearningSummaryInput,
  LearningUserMemorySignalInput,
  LearningUserMemoryUpsertInput,
} from "../learning/types.js";
import type {
  ContextOpportunityKind,
  ContextPageObservation,
  ContextPageState,
} from "../context-intelligence/types.js";
import type {
  AgentLaunchScheduleSnapshot,
  AgentMcpServerExport,
  AgentMcpToolCallInput,
  AgentSessionDeleteResult,
  AgentSessionListItem,
  AgentSessionSnapshot,
  AgentSessionUpdate,
} from "../agent/browser-agent-service.js";
import type { OrganizerSidebarState } from "../agent/browser-organizer.js";
import {
  compareWorkspacesByCreatedAt,
  inferTitleFromUrl,
  resolveInputToUrl,
  toDisplayUrl,
  type DisplayUrlOptions,
  type ResolveInputToUrlOptions,
  type StartPageUrlOptions,
} from "../shared/utils.js";
import {
  importBookmarksFromFile,
  importBookmarksFromSource,
  listBookmarkImportSources,
} from "../importers/bookmarks-import.js";
import {
  importHistoryFromSource,
  listHistoryImportSources,
} from "../importers/history-import.js";
import {
  shouldHandleTabHistoryNavigation,
  type TabHistoryNavigationDirection,
} from "../window/history-navigation.js";
type WorkspaceProfileMode = "new" | "attached";
const AUTOMATION_WORKSPACE_TAG = "automation";

function isAutomationWorkspace(workspace: WorkspaceRecord | undefined) {
  return Boolean(workspace?.tags?.includes(AUTOMATION_WORKSPACE_TAG));
}

interface WorkspaceRecord {
  id: string;
  name: string;
  createdAt: number;
  profileId: string;
  profileMode: WorkspaceProfileMode;
  profileSourceWorkspaceId?: string;
  automationEnabled: boolean;
  tags?: string[];
}

interface WindowTabSummary {
  id: string;
  title: string;
  url: string;
  displayUrl: string;
  favicon?: string;
  isLoading: boolean;
  isAutomationControlled?: boolean;
  manualInterventionMessage?: string;
}

interface WindowRecord {
  workspaceId: string;
  tabs: WindowTabSummary[];
  activeTabId?: string;
}

interface WorkspaceSummary {
  id: string;
  name: string;
  profileId: string;
  profileMode: WorkspaceProfileMode;
  profileSourceWorkspaceId?: string;
  profileSourceWorkspaceName?: string;
  automationEnabled: boolean;
  tags?: string[];
  automationAttached: boolean;
  automationTargetId?: number;
  automationTargetUrl?: string;
  hasWindow: boolean;
  windowVisible: boolean;
  windowCount: number;
}

interface WindowSummary {
  id: number;
  workspaceId: string;
  workspaceName: string;
  profileId: string;
  visible: boolean;
  focused: boolean;
  title: string;
  activeTabId?: string;
  tabCount: number;
  tabs: WindowTabSummary[];
}

interface StartPageShellLayout {
  shellHeight: number;
  shellWidth: number;
  viewHeight: number;
  viewWidth: number;
  viewX: number;
  viewY: number;
}

interface CreateWorkspaceInput {
  name?: string;
  profileMode: WorkspaceProfileMode;
  profileSourceWorkspaceId?: string;
  appearanceSourceWorkspaceId?: string;
  showWindow: boolean;
}

interface OpenCreateWorkspaceDialogInput {
  sourceWorkspaceId: string;
  sourceWorkspaceName?: string;
}

interface OpenFolderSettingsDialogInput {
  workspaceId: string;
  folderId: string;
  name: string;
  icon?: string;
  backgroundColor?: string;
}

interface FolderSettingsUpdateInput {
  workspaceId: string;
  folderId: string;
  name: string;
  icon?: string;
  backgroundColor?: string;
}

function normalizeFolderBackgroundColor(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const shortHexMatch = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (shortHexMatch) {
    const [, hex] = shortHexMatch;
    return `#${hex.split("").map((char) => `${char}${char}`).join("")}`.toLowerCase();
  }

  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toLowerCase() : undefined;
}

interface RenameWorkspaceInput {
  workspaceId: string;
  name: string;
}

interface SwitchWorkspaceInput {
  workspaceId: string;
  sidebarWidth?: number;
  urlBarHeight?: number;
}

interface DeleteWorkspacesResult {
  deletedWorkspaceIds: string[];
  skippedWorkspaceIds: string[];
  skippedDetails?: Array<{
    workspaceId: string;
    reason: "protected" | "not_found" | "bound_agent";
    agentSessionId?: string;
    agentTitle?: string;
  }>;
}

interface WorkspaceMenuAnchorInput {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface HistoryItemMenuInput {
  url: string;
}

interface TabItemMenuInput {
  tabId: string;
  x?: number;
  y?: number;
}

interface UserScriptsToolbarPopupInput {
  anchor?: Partial<WorkspaceMenuAnchorInput> | null;
  targetUrl?: string;
}

interface ExtensionsToolbarMenuInput {
  anchor?: Partial<WorkspaceMenuAnchorInput> | null;
}

type SplitViewMenuMode = "horizontal" | "vertical" | "bento";

type SplitViewMenuAction =
  | "create-horizontal"
  | "create-vertical"
  | "create-bento"
  | "set-horizontal"
  | "set-vertical"
  | "set-bento"
  | "toggle-sync-scroll"
  | "separate-all";

type SplitViewMenuInput =
  | {
    kind: "toolbar";
    x?: number;
    y?: number;
    isActiveSplit: boolean;
    activeMode?: SplitViewMenuMode;
    canCreatePair: boolean;
    canCreateBento: boolean;
    canUseBentoLayout: boolean;
    syncScroll: boolean;
  }
  | {
    kind: "sidebar";
    x?: number;
    y?: number;
  };

interface TabLayoutTileInput {
  tabId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TabLayoutUpdateInput {
  focusedTabId: string;
  syncScroll?: boolean;
  tiles: TabLayoutTileInput[];
}

interface TabScrollSyncPayload {
  top: number;
  left: number;
  maxTop: number;
  maxLeft: number;
}

interface SplitViewDragPreviewPayload {
  mode: "horizontal" | "vertical";
  side: "left" | "right" | "top" | "bottom";
}

interface SplitViewDragDropPayload extends SplitViewDragPreviewPayload {
  tabId: string;
}

interface TabViewHistoryNavigationPayload {
  direction: TabHistoryNavigationDirection;
}

const WORKSPACE_MENU_MIN_UNITS = 28;
const MILO_WORKSPACE_URL = "milo://workspace";
const MILO_USER_SCRIPTS_URL = "milo://user-scripts";
const SEARCH_HISTORY_MATCH_LIMIT = 100;

interface BrowserBootstrapData {
  appInfo: {
    name: string;
    version: string;
    platform: string;
  };
  currentWorkspace: WorkspaceSummary;
  currentWindow: WindowSummary;
  workspaces: WorkspaceSummary[];
  windows: WindowSummary[];
  sidebarOrganizationState?: OrganizerSidebarState;
}

type RenderPreviewFormat = "html" | "markdown";

interface RenderPreviewDocument {
  id: string;
  format: RenderPreviewFormat;
  content: string;
  sourceTitle?: string;
  sourceUrl?: string;
  createdAt: number;
}

interface CdpCommandInput {
  workspaceId: string;
  method: string;
  params?: Record<string, unknown>;
}

interface AutomationNavigateInput {
  workspaceId: string;
  url: string;
}

interface AutomationEvaluateInput {
  workspaceId: string;
  expression: string;
  awaitPromise?: boolean;
  returnByValue?: boolean;
}

interface SyncWindowStateInput {
  tabs: WindowTabSummary[];
  activeTabId?: string;
}

interface TabRecord {
  id: string;
  url: string;
  title: string;
  displayUrl: string;
  favicon?: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  hasLoaded: boolean;
}

interface LinkPreviewHoverPayload {
  url: string;
  bounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

export interface BookmarkRecord {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  folderId?: string | null;
  createdAt: number;
}

export interface BookmarkFolderRecord {
  id: string;
  name: string;
  parentId?: string | null;
  importSourceId?: string;
  createdAt: number;
}

export interface HistoryRecord {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  createdAt: number;
  updatedAt: number;
  lastVisitedAt: number;
  visitCount: number;
  importSourceStats?: HistoryImportSourceStat[];
  metadata?: HistoryMetadata;
}

export interface HistoryImportSourceStat {
  sourceId: string;
  visitCount: number;
  lastVisitedAt: number;
}

export interface HistoryOpenSourceMetadata {
  url: string;
  title?: string;
  firstOpenedAt: number;
  lastOpenedAt: number;
  openCount: number;
  lastTargetUrl?: string;
}

export interface HistoryMetadata {
  openedFrom?: HistoryOpenSourceMetadata[];
}

interface SearchOverlayState {
  view: WebContentsView | null;
  visible: boolean;
}

interface SearchOverlayData {
  tabs: WindowTabSummary[];
  bookmarks: BookmarkRecord[];
  history: HistoryRecord[];
  activeTabId: string;
}

interface PageSearchFindInput {
  tabId: string;
  query: string;
  findNext?: boolean;
  forward?: boolean;
}

interface PageSearchResultPayload {
  tabId: string;
  query: string;
  activeMatchOrdinal: number;
  matches: number;
  finalUpdate: boolean;
}

interface PageSearchSession {
  query: string;
  requestId: number;
  windowId: number;
}

interface PageSearchOverlayState {
  view: WebContentsView | null;
  visible: boolean;
  windowId: number | null;
  tabId: string;
  query: string;
  result: PageSearchResultPayload | null;
}

interface AiSidebarOverlayState {
  visible: boolean;
  windowId: number | null;
  tabId: string | null;
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

interface UserDataExportInput {
  rendererSettings?: unknown;
}

interface UserDataExportResult {
  canceled: boolean;
  filePath?: string;
  bytesWritten?: number;
  exportedAt?: string;
}

interface IpcContext {
  DEFAULT_WORKSPACE_ID: string;
  MILO_SEARCH_URL: string;
  preloadPath: string;

  workspaces: Map<string, WorkspaceRecord>;
  windows: Map<number, WindowRecord>;
  browserViews: Map<string, WebContentsView>;
  tabRecords: Map<number, Map<string, TabRecord>>;
  windowActiveTabs: Map<number, string>;
  windowSidebarWidths: Map<number, number>;
  windowUrlBarHeights: Map<number, number>;

  getBookmarks: (profileId?: string) => BookmarkRecord[];
  setBookmarks: (profileId: string, bookmarks: BookmarkRecord[]) => void;
  getBookmarkFolders: (profileId?: string) => BookmarkFolderRecord[];
  setBookmarkFolders: (profileId: string, folders: BookmarkFolderRecord[]) => void;
  saveBookmarks: () => void;
  notifyBookmarksChanged: () => void;
  getHistoryRecords: (profileId?: string) => HistoryRecord[];
  setHistoryRecords: (profileId: string, records: HistoryRecord[]) => void;
  saveHistoryRecords: () => void;
  notifyHistoryChanged: () => void;
  getDownloads: () => DownloadRecord[];
  createDownload: (input: DownloadCreateInput) => Promise<DownloadRecord>;
  pauseDownload: (id: string) => Promise<DownloadRecord>;
  resumeDownload: (id: string) => Promise<DownloadRecord>;
  cancelDownload: (id: string) => Promise<DownloadRecord>;
  retryDownload: (id: string) => Promise<DownloadRecord>;
  removeDownloadRecord: (
    id: string,
    options?: { deleteFile?: boolean },
  ) => Promise<DownloadRecord[]>;
  deleteDownloadFile: (id: string) => Promise<DownloadRecord>;
  showDownloadInFolder: (id: string) => Promise<string>;
  showSystemNotification: (
    input: SystemNotificationInput,
    options?: { onClick?: () => void },
  ) => SystemNotificationResult;

  buildBootstrapData: (contents: WebContents) => BrowserBootstrapData;
  createWorkspaceName: (name?: string) => string;
  createWorkspaceWindow: (
    workspace: WorkspaceRecord,
    options: { show: boolean; initialUrl?: string; forceInitialUrl?: boolean },
  ) => BrowserWindow;
  switchWindowWorkspace: (
    targetWindow: BrowserWindow,
    workspaceId: string,
    layout?: { sidebarWidth?: number; urlBarHeight?: number },
  ) => BrowserBootstrapData;
  openCreateWorkspaceDialog: (
    parentWindow: BrowserWindow,
    input: OpenCreateWorkspaceDialogInput,
  ) => BrowserWindow;
  openFolderSettingsDialog: (
    parentWindow: BrowserWindow,
    input: OpenFolderSettingsDialogInput,
  ) => BrowserWindow;
  deleteWorkspaces: (workspaceIds: string[]) => DeleteWorkspacesResult;
  openWorkspaceProfileDirectory: (workspaceId: string) => Promise<string>;
  getWorkspaceRecord: (workspaceId: string) => WorkspaceRecord;
  revealWorkspaceWindow: (targetWindow: BrowserWindow) => void;
  updateWindowTitle: (targetWindow: BrowserWindow) => void;
  serializeWorkspace: (workspace: WorkspaceRecord) => WorkspaceSummary;
  serializeWindow: (targetWindow: BrowserWindow) => WindowSummary;
  saveWorkspaceState: () => void;
  broadcastWorkspaceContext: () => void;
  setWorkspaceAutomationTarget: (
    workspaceId: string,
    targetContentsId: number,
  ) => Promise<WorkspaceSummary>;
  sendWorkspaceCdpCommand: (
    workspaceId: string,
    method: string,
    params?: Record<string, unknown>,
  ) => Promise<unknown>;
  handleTabCreate: (
    targetWindow: BrowserWindow,
    url?: string,
    options?: {
      activate?: boolean;
      deferInitialLoad?: boolean;
      preserveRawUrl?: boolean;
      initialTitle?: string;
      initialFavicon?: string;
    },
  ) => TabRecord;
  serializeTabRecord: (tab: TabRecord) => WindowTabSummary;
  handleTabClose: (
    targetWindow: BrowserWindow,
    tabId: string,
  ) => { activeTabId: string };
  handleTabSetActive: (
    targetWindow: BrowserWindow,
    tabId: string,
    layout?: { sidebarWidth?: number; urlBarHeight?: number; rightPanelWidth?: number },
  ) => void;
  handleTabApplyLayout: (
    targetWindow: BrowserWindow,
    input: TabLayoutUpdateInput,
    layout?: { sidebarWidth?: number; urlBarHeight?: number },
  ) => void;
  handleTabViewInteraction: (targetContents: WebContents) => void;
  handleTabDocumentTitleChanged: (
    targetContents: WebContents,
    title: string,
  ) => void;
  handleTabViewScroll: (
    targetContents: WebContents,
    payload: TabScrollSyncPayload,
  ) => void;
  handleTabSetSidebarDragState: (
    targetWindow: BrowserWindow,
    tabId: string | null,
  ) => void;
  handleTabSplitDragPreview: (
    targetContents: WebContents,
    payload: SplitViewDragPreviewPayload,
  ) => void;
  handleTabSplitDragLeave: (targetContents: WebContents) => void;
  handleTabSplitDragDrop: (
    targetContents: WebContents,
    payload: SplitViewDragPreviewPayload,
  ) => void;
  syncSidebarOrganizationState: (input: {
    windowId: number;
    workspaceId: string;
    state: OrganizerSidebarState;
    sequence?: number;
  }) => OrganizerSidebarState;
  updateSidebarFolderSettings: (input: {
    windowId: number;
    workspaceId: string;
    folderId: string;
    name: string;
    icon?: string | null;
    backgroundColor?: string | null;
  }) => OrganizerSidebarState;
  handleLinkPreviewHover: (
    senderContents: WebContents,
    payload: LinkPreviewHoverPayload,
  ) => void;
  handleLinkPreviewHoverLeave: (senderContents: WebContents) => void;
  handleLinkPreviewPointerState: (
    senderContents: WebContents,
    isPointerInside: boolean,
  ) => void;
  handleLinkPreviewClose: (senderContents: WebContents) => void;
  handleLinkPreviewMaximize: (senderContents: WebContents) => void;
  resolveInputToUrlOptions: ResolveInputToUrlOptions;
  displayUrlOptions: DisplayUrlOptions;
  startPageUrlOptions: StartPageUrlOptions;
  broadcastTabState: (targetWindow: BrowserWindow) => void;
  updateBrowserViewBounds: (targetWindow: BrowserWindow, rightPanelWidth?: number) => void;

  getSearchOverlayState: () => SearchOverlayState;
  setSearchOverlayState: (state: SearchOverlayState) => void;
  getSearchOverlayBounds: (
    windowId: number,
  ) => { x: number; y: number; width: number; height: number };
  closeSearchOverlay: (targetWindow: BrowserWindow) => void;
  getPageSearchOverlayState: () => PageSearchOverlayState;
  setPageSearchOverlayState: (state: PageSearchOverlayState) => void;
  getPageSearchOverlayBounds: (
    windowId: number,
  ) => { x: number; y: number; width: number; height: number };
  closePageSearchOverlay: (targetWindow?: BrowserWindow | null) => void;
  broadcastPageSearchOverlayState: (options?: { focusInput?: boolean }) => void;
  getAiSidebarOverlayState: () => AiSidebarOverlayState;
  openAiSidebarOverlay: (targetWindow: BrowserWindow) => Promise<AiSidebarOverlayState>;
  closeAiSidebarOverlay: (
    targetWindow?: BrowserWindow | null,
    options?: { tabId?: string | null },
  ) => AiSidebarOverlayState;
  toggleAiSidebarOverlay: (targetWindow: BrowserWindow) => Promise<AiSidebarOverlayState>;

  getTheme: () => string;
  setTheme: (theme: string) => Promise<void> | void;
  applyColorSchemeToContents: (targetContents: WebContents) => Promise<void>;
  getLanguage: () => string;
  getDefaultBrowserStatus: () => DefaultBrowserStatus;
  getBrowserLocale: () => string;
  setLanguage: (language: string) => void;
  setAsDefaultBrowser: () => DefaultBrowserRegistrationResult;
  getDownloadPreferences: () => {
    defaultDirectory: string;
    hasCustomDirectory: boolean;
    defaultThreadCount: number;
    defaultHeadersText: string;
  };
  getStartPageAppearance: (workspaceId?: string) => StartPageAppearance;
  getStartPageDockItems: (workspaceId?: string) => StartPageDockItem[];
  getStartPageWidgetsState: (workspaceId?: string) => StartPageWidgetsState;
  getStartPageWidgetRefreshes: (workspaceId?: string) => StartPageWidgetRefreshEvent[];
  runStartPageWidgetAutomationCall: (input: {
    input?: unknown;
    source: string;
    tool: string;
    widgetId: string;
    workspaceId: string;
  }) => Promise<unknown>;
  setStartPageAppearance: (
    workspaceId?: string,
    input?: Partial<StartPageAppearance> | null,
  ) => StartPageAppearance;
  setStartPageWidgets: (
    workspaceId?: string,
    input?: StartPageWidget[] | null,
  ) => StartPageWidgetsState;
  setStartPageDockItems: (
    workspaceId?: string,
    input?: StartPageDockItem[] | null,
  ) => StartPageDockItem[];
  addToStartPageDock: (
    workspaceId?: string,
    input?: Partial<StartPageDockItem> | null,
  ) => StartPageDockItem[];
  setStartPageDockItemFavicon: (
    workspaceId: string | undefined,
    id: string,
    favicon: string,
  ) => StartPageDockItem[];
  removeStartPageDockItem: (
    workspaceId: string | undefined,
    id: string,
  ) => StartPageDockItem[];
  clearStartPageDockItems: (workspaceId?: string) => StartPageDockItem[];
  widgetRegistryGetRootDirectory: () => string;
  widgetRegistryListPackages: () => WidgetPackageSummary[];
  widgetRegistryGetPackage: (packageId: string) => WidgetPackageSummary | null;
  widgetRegistryGetPackageManifest: (packageId: string) => WidgetPackageManifest | null;
  widgetRegistryInspectPackageDirectory: (directoryPath: string) => WidgetPackageSummary;
  widgetRegistryInstallPackageFromDirectory: (directoryPath: string) => WidgetPackageSummary;
  widgetRegistryRemovePackage: (packageId: string) => string;
  widgetRegistryRevealPackage: (packageId: string) => Promise<string>;
  widgetRegistryCreateStarterPackage: () => WidgetPackageSummary;
  widgetRegistryRevealRootDirectory: () => Promise<string>;
  broadcastStartPageAppearanceChanged: (
    workspaceId: string,
    appearance: StartPageAppearance,
  ) => void;
  broadcastStartPageDockChanged: (workspaceId: string, items: StartPageDockItem[]) => void;
  broadcastStartPageWidgetsChanged: (
    workspaceId: string,
    state: StartPageWidgetsState,
  ) => void;
  syncStartPageWidgetRefreshTriggers: (workspaceId: string) => void;
  syncAllStartPageWidgetRefreshTriggers: () => void;
  setDownloadPreferences: (input?: {
    defaultDirectory?: string | null;
    defaultThreadCount?: number;
    defaultHeadersText?: string;
  }) => {
    defaultDirectory: string;
    hasCustomDirectory: boolean;
      defaultThreadCount: number;
      defaultHeadersText: string;
  };
  getLlmProviders: () => LlmProvider[];
  setLlmProviders: (input?: LlmProvider[] | null) => LlmProvider[];
  getAgentPreferences: () => AgentPreferences;
  setAgentPreferences: (input?: Partial<AgentPreferences> | null) => AgentPreferences;
  getImageAgentPreferences: () => AgentModelPreferences;
  setImageAgentPreferences: (input?: Partial<AgentModelPreferences> | null) => AgentModelPreferences;
  getLearningPreferences: () => LearningPreferences;
  setLearningPreferences: (input?: Partial<LearningPreferences> | null) => LearningPreferences;
  clearLearningState: () => { success: boolean };
  flushLearningState: () => Promise<LearningFlushResult>;
  deleteLearningSite: (siteId: string) => { success: boolean };
  deleteLearningGuidance: (guidanceId: string) => { success: boolean };
  deleteLearningSiteSkill: (skillId: string) => { success: boolean };
  deleteLearningHistorySite: (domain: string) => { success: boolean };
  deleteLearningStyleProfile: (profileId: string) => { success: boolean };
  deleteLearningPreferenceProfile: (profileId: string) => { success: boolean };
  upsertLearningUserMemory: (input: LearningUserMemoryUpsertInput) => unknown;
  deleteLearningUserMemory: (input: LearningUserMemorySignalInput) => unknown;
  rejectLearningUserMemory: (input: LearningUserMemorySignalInput) => unknown;
  getLearningSummary: (input?: LearningSummaryInput | null) => unknown;
  getLearningCatalog: () => unknown;
  exportUserData: (
    ownerWindow: BrowserWindow | null,
    input?: UserDataExportInput | null,
  ) => Promise<UserDataExportResult>;
  resolveLearningInputAssistContext: (input: LearningInputAssistContextInput) => unknown;
  generateLearningInputAssistText: (input: LearningInputAssistActionInput) => Promise<unknown>;
  getContextPageState: (input: ContextPageObservation) => ContextPageState | Promise<ContextPageState>;
  dismissContextOpportunity: (input: {
    opportunityId?: string;
    kind?: ContextOpportunityKind;
    url?: string;
  }) => { success: boolean };
  getTranslationPreferences: () => TranslationPreferences;
  setTranslationPreferences: (
    input?: Partial<TranslationPreferences> | null,
  ) => TranslationPreferences;

  listExtensions: (profileId: string) => BrowserExtensionSummary[];
  getChromeWebStoreInstallState: (
    profileId: string,
    input: string | ChromeWebStoreInstallRequest,
  ) => ChromeWebStoreInstallState;
  beginChromeWebStoreInstall: (
    profileId: string,
    input: ChromeWebStoreInstallRequest,
  ) => ChromeWebStoreInstallState;
  completeChromeWebStoreInstall: (
    profileId: string,
    extensionId: string,
  ) => Promise<BrowserExtensionSummary>;
  installExtensionFromStore: (
    profileId: string,
    input: string,
  ) => Promise<BrowserExtensionSummary>;
  installUnpackedExtension: (
    profileId: string,
    extensionPath: string,
  ) => Promise<BrowserExtensionSummary>;
  setExtensionEnabled: (
    profileId: string,
    extensionId: string,
    enabled: boolean,
  ) => Promise<BrowserExtensionSummary>;
  removeExtension: (profileId: string, extensionId: string) => Promise<void>;
  reloadExtension: (profileId: string, extensionId: string) => Promise<BrowserExtensionSummary>;
  revealExtension: (profileId: string, extensionId: string) => Promise<string>;
  openExtensionActionPopup: (
    profileId: string,
    extensionId: string,
    ownerWindow: BrowserWindow | null,
    anchor?: Partial<ExtensionActionPopupAnchor> | null,
  ) => Promise<BrowserExtensionActionSummary>;
  listUserScripts: (profileId: string) => UserScriptRecord[];
  createUserScript: (
    profileId: string,
    input: UserScriptCreateInput,
  ) => UserScriptRecord;
  updateUserScript: (
    profileId: string,
    scriptId: string,
    input: UserScriptUpdateInput,
  ) => UserScriptRecord;
  removeUserScript: (profileId: string, scriptId: string) => void;
  setUserScriptEnabled: (
    profileId: string,
    scriptId: string,
    enabled: boolean,
  ) => UserScriptRecord;
  runUserScriptNow: (
    profileId: string,
    targetContents: WebContents,
    scriptId: string,
  ) => Promise<UserScriptRunResult>;
  runUserScriptTest: (
    profileId: string,
    targetContents: WebContents,
    scriptId: string,
  ) => Promise<UserScriptTestResult>;
  generateUserScriptDraft: (
    input: UserScriptAgentGenerateInput,
  ) => Promise<UserScriptAgentGenerateResult>;
  createPasskeyCredential: (
    profileId: string,
    input: PasskeyCreateRequest,
    ownerWindow: BrowserWindow | null,
  ) => Promise<PasskeyOperationResult<SerializedAttestationCredential>>;
  getPasskeyAssertion: (
    profileId: string,
    input: PasskeyGetRequest,
    ownerWindow: BrowserWindow | null,
  ) => Promise<PasskeyOperationResult<SerializedAssertionCredential>>;
  getRenderPreviewDocument: (id: string) => RenderPreviewDocument | null;
  agentEnsureSession: (input: {
    workspaceId: string;
    windowId: number;
  }) => AgentSessionSnapshot;
  agentListSessions: (input: {
    workspaceId: string;
    windowId: number;
  }) => AgentSessionListItem[];
  agentCreateSession: (input: {
    workspaceId: string;
    windowId: number;
    scope?: "default" | "current-tab";
    tabId?: string;
    content?: string;
    privacyMode?: boolean;
    profile?: "default" | "organizer" | "widget-builder";
  }) => Promise<AgentSessionSnapshot>;
  agentGetSession: (sessionId: string) => AgentSessionSnapshot | null;
  agentGetSessionForTab: (input: {
    windowId?: number;
    tabId: string;
  }) => AgentSessionSnapshot | null;
  agentRebindSessionToTab: (input: {
    sessionId: string;
    workspaceId: string;
    windowId: number;
    tabId: string;
  }) => AgentSessionSnapshot;
  agentSendUserMessage: (input: {
    sessionId: string;
    content: string;
  }) => Promise<AgentSessionSnapshot>;
  agentSetSessionSchedule: (input: {
    sessionId: string;
    cronExpression: string;
    prompt?: string;
  }) => AgentSessionSnapshot;
  agentClearSessionSchedule: (sessionId: string) => AgentSessionSnapshot;
  agentListLaunchSchedules: () => AgentLaunchScheduleSnapshot[];
  agentGetLaunchSchedule: (triggerId: string) => AgentLaunchScheduleSnapshot | undefined;
  agentSetLaunchSchedule: (input: {
    workspaceId: string;
    windowId: number;
    cronExpression: string;
    prompt: string;
    privacyMode?: boolean;
    profile?: "default" | "organizer" | "widget-builder";
    scope?: "default" | "current-tab";
    tabId?: string;
    title?: string;
    triggerId?: string;
  }) => AgentLaunchScheduleSnapshot;
  agentClearLaunchSchedule: (triggerId: string) => AgentLaunchScheduleSnapshot | undefined | null;
  agentInterruptSession: (sessionId: string) => AgentSessionSnapshot;
  agentResumeSession: (sessionId: string) => AgentSessionSnapshot;
  agentDeleteSession: (sessionId: string) => AgentSessionDeleteResult;
  agentExportSessionMcp: (sessionId: string) => Promise<AgentMcpServerExport>;
  agentCallSessionMcpTool: (input: AgentMcpToolCallInput) => Promise<unknown>;
  getAgentMcpHttpAddress: () => Promise<string | null>;
  subscribeAgentUpdates: (
    listener: (update: AgentSessionUpdate) => void,
  ) => () => void;
}

export function registerIpcHandlers(context: IpcContext) {
  const {
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
    getDownloads,
    createDownload,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    retryDownload,
    removeDownloadRecord,
    deleteDownloadFile,
    showDownloadInFolder,
    showSystemNotification,
    buildBootstrapData,
    createWorkspaceName,
    createWorkspaceWindow,
    switchWindowWorkspace,
    openCreateWorkspaceDialog,
    openFolderSettingsDialog,
    deleteWorkspaces,
    openWorkspaceProfileDirectory,
    getWorkspaceRecord,
    revealWorkspaceWindow,
    updateWindowTitle,
    serializeWorkspace,
    serializeWindow,
    saveWorkspaceState,
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
    resolveInputToUrlOptions,
    displayUrlOptions,
    startPageUrlOptions,
    broadcastTabState,
    updateBrowserViewBounds,
    getSearchOverlayState,
    setSearchOverlayState,
    getSearchOverlayBounds,
    closeSearchOverlay,
    getPageSearchOverlayState,
    setPageSearchOverlayState,
    getPageSearchOverlayBounds,
    closePageSearchOverlay,
    broadcastPageSearchOverlayState,
    getAiSidebarOverlayState,
    openAiSidebarOverlay,
    closeAiSidebarOverlay,
    toggleAiSidebarOverlay,
    getTheme,
    setTheme,
    applyColorSchemeToContents,
    getLanguage,
    getDefaultBrowserStatus,
    getBrowserLocale,
    setLanguage,
    setAsDefaultBrowser,
    getDownloadPreferences,
    getStartPageAppearance,
    getStartPageDockItems,
    getStartPageWidgetsState,
    getStartPageWidgetRefreshes,
    runStartPageWidgetAutomationCall,
    setStartPageAppearance,
    setStartPageDockItems,
    setStartPageWidgets,
    syncStartPageWidgetRefreshTriggers,
    syncAllStartPageWidgetRefreshTriggers,
    addToStartPageDock,
    setStartPageDockItemFavicon,
    removeStartPageDockItem,
    clearStartPageDockItems,
    widgetRegistryGetRootDirectory,
    widgetRegistryListPackages,
    widgetRegistryGetPackage,
    widgetRegistryGetPackageManifest,
    widgetRegistryInspectPackageDirectory,
    widgetRegistryInstallPackageFromDirectory,
    widgetRegistryRemovePackage,
    widgetRegistryRevealPackage,
    widgetRegistryCreateStarterPackage,
    widgetRegistryRevealRootDirectory,
    broadcastStartPageAppearanceChanged,
    broadcastStartPageDockChanged,
    broadcastStartPageWidgetsChanged,
    setDownloadPreferences,
    getLlmProviders,
    setLlmProviders,
    getAgentPreferences,
    setAgentPreferences,
    getImageAgentPreferences,
    setImageAgentPreferences,
    getLearningPreferences,
    setLearningPreferences,
    clearLearningState,
    flushLearningState,
    deleteLearningSite,
    deleteLearningGuidance,
    deleteLearningSiteSkill,
    deleteLearningHistorySite,
    deleteLearningStyleProfile,
    deleteLearningPreferenceProfile,
    upsertLearningUserMemory,
    deleteLearningUserMemory,
    rejectLearningUserMemory,
    getLearningSummary,
    getLearningCatalog,
    exportUserData,
    resolveLearningInputAssistContext,
    generateLearningInputAssistText,
    getContextPageState,
    dismissContextOpportunity,
    getTranslationPreferences,
    setTranslationPreferences,
    listExtensions,
    getChromeWebStoreInstallState,
    beginChromeWebStoreInstall,
    completeChromeWebStoreInstall,
    installExtensionFromStore,
    installUnpackedExtension,
    setExtensionEnabled,
    removeExtension,
    reloadExtension,
    revealExtension,
    openExtensionActionPopup,
    listUserScripts,
    createUserScript,
    updateUserScript,
    removeUserScript,
    setUserScriptEnabled,
    runUserScriptNow,
    runUserScriptTest,
    generateUserScriptDraft,
    createPasskeyCredential,
    getPasskeyAssertion,
    getRenderPreviewDocument,
    agentEnsureSession,
    agentListSessions,
    agentCreateSession,
    agentGetSession,
    agentGetSessionForTab,
    agentRebindSessionToTab,
    agentSendUserMessage,
    agentSetSessionSchedule,
    agentClearSessionSchedule,
    agentListLaunchSchedules,
    agentGetLaunchSchedule,
    agentSetLaunchSchedule,
    agentClearLaunchSchedule,
    agentInterruptSession,
    agentResumeSession,
    agentDeleteSession,
    agentExportSessionMcp,
    agentCallSessionMcpTool,
    getAgentMcpHttpAddress,
    subscribeAgentUpdates,
  } = context;

  function resolveSenderWorkspaceId(senderContents: WebContents) {
    try {
      return buildBootstrapData(senderContents).currentWorkspace.id;
    } catch {
      return DEFAULT_WORKSPACE_ID;
    }
  }

  const agentSubscribersByContentsId = new Map<number, {
    contents: WebContents;
    sessionIds: Set<string>;
  }>();
  const trackedPageSearchContentsIds = new Set<number>();
  const pageSearchSessionsByTabId = new Map<string, PageSearchSession>();

  const stopAgentUpdates = typeof subscribeAgentUpdates === "function"
    ? subscribeAgentUpdates((update) => {
      for (const [contentsId, registration] of agentSubscribersByContentsId.entries()) {
        if (registration.contents.isDestroyed()) {
          agentSubscribersByContentsId.delete(contentsId);
          continue;
        }
        if (!registration.sessionIds.has(update.sessionId)) {
          continue;
        }
        registration.contents.send("agent:session-update", update);
      }
    })
    : () => {};

  app.once("will-quit", () => {
    stopAgentUpdates();
    agentSubscribersByContentsId.clear();
    trackedPageSearchContentsIds.clear();
    pageSearchSessionsByTabId.clear();
  });

  function registerAgentSubscriber(contents: WebContents, sessionId: string) {
    const existing = agentSubscribersByContentsId.get(contents.id);
    if (existing) {
      existing.sessionIds.add(sessionId);
      return;
    }

    const registration = {
      contents,
      sessionIds: new Set([sessionId]),
    };
    agentSubscribersByContentsId.set(contents.id, registration);
    contents.once("destroyed", () => {
      agentSubscribersByContentsId.delete(contents.id);
    });
  }

  function registerAgentSubscribers(contents: WebContents, sessionIds: string[]) {
    for (const sessionId of sessionIds) {
      registerAgentSubscriber(contents, sessionId);
    }
  }

  function sendPageSearchResult(
    targetWindow: BrowserWindow,
    payload: PageSearchResultPayload,
  ) {
    if (targetWindow.isDestroyed() || targetWindow.webContents.isDestroyed()) {
      return;
    }

    targetWindow.webContents.send("browser:page-search-result", payload);
  }

  function updatePageSearchOverlayState(input: Partial<PageSearchOverlayState>) {
    const currentState = getPageSearchOverlayState();
    setPageSearchOverlayState({
      ...currentState,
      ...input,
    });
  }

  function buildClearedPageSearchResult(
    tabId: string,
    query = "",
  ): PageSearchResultPayload {
    return {
      tabId,
      query,
      activeMatchOrdinal: 0,
      matches: 0,
      finalUpdate: true,
    };
  }

  function clearPageSearchSession(
    tabId: string,
    options?: {
      notifyWindow?: BrowserWindow | null;
      query?: string;
    },
  ) {
    const currentSession = pageSearchSessionsByTabId.get(tabId);
    pageSearchSessionsByTabId.delete(tabId);

    const targetWindow = options?.notifyWindow
      ?? (currentSession ? findWindow(currentSession.windowId) : null);
    if (!targetWindow) {
      return;
    }

    const payload = buildClearedPageSearchResult(tabId, options?.query ?? currentSession?.query ?? "");
    sendPageSearchResult(targetWindow, payload);

    const overlayState = getPageSearchOverlayState();
    if (overlayState.tabId === tabId) {
      updatePageSearchOverlayState({
        query: payload.query,
        result: payload,
      });
      broadcastPageSearchOverlayState();
    }
  }

  function handlePageSearchResult(tabId: string, result: FoundInPageResult) {
    const currentSession = pageSearchSessionsByTabId.get(tabId);
    if (!currentSession || currentSession.requestId !== result.requestId) {
      return;
    }

    const targetWindow = findWindow(currentSession.windowId);
    if (!targetWindow) {
      return;
    }

    const payload = {
      tabId,
      query: currentSession.query,
      activeMatchOrdinal: result.activeMatchOrdinal,
      matches: result.matches,
      finalUpdate: result.finalUpdate,
    } satisfies PageSearchResultPayload;
    sendPageSearchResult(targetWindow, payload);

    const overlayState = getPageSearchOverlayState();
    if (overlayState.tabId === tabId) {
      updatePageSearchOverlayState({
        query: currentSession.query,
        result: payload,
      });
      broadcastPageSearchOverlayState();
    }
  }

  function ensurePageSearchTracking(
    targetWindow: BrowserWindow,
    tabId: string,
    targetContents: WebContents,
  ) {
    if (targetContents.isDestroyed() || trackedPageSearchContentsIds.has(targetContents.id)) {
      return;
    }

    trackedPageSearchContentsIds.add(targetContents.id);

    targetContents.on("found-in-page", (_event, result) => {
      handlePageSearchResult(tabId, result);
    });

    targetContents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
      if (!isMainFrame || isInPlace) {
        return;
      }

      const currentSession = pageSearchSessionsByTabId.get(tabId);
      if (!currentSession) {
        return;
      }

      clearPageSearchSession(tabId, {
        notifyWindow: targetWindow,
        query: currentSession.query,
      });
    });

    targetContents.once("destroyed", () => {
      trackedPageSearchContentsIds.delete(targetContents.id);
      pageSearchSessionsByTabId.delete(tabId);
    });
  }

  function resolveMenuLocale() {
    const language = getLanguage().trim().toLowerCase();
    if (language.startsWith("zh")) {
      return "zh-CN";
    }
    if (language.startsWith("en")) {
      return "en-US";
    }

    const systemLocale = getBrowserLocale().trim().toLowerCase().replace(/_/g, "-");
    return systemLocale.startsWith("zh") ? "zh-CN" : "en-US";
  }

  function resolveWorkspaceMenuLocale() {
    if (resolveMenuLocale() === "zh-CN") {
      return {
        currentSuffix: "（当前）",
        createWorkspace: "新建 workspace",
        workspaceManager: "Workspace 管理",
      };
    }

    return {
      currentSuffix: " (Current)",
      createWorkspace: "Create Workspace",
      workspaceManager: "Workspace Manager",
    };
  }

  function resolveHistoryItemMenuLocale() {
    if (resolveMenuLocale() === "zh-CN") {
      return {
        openInNewTab: "在新标签页打开",
        copyLinkAddress: "复制链接地址",
      };
    }

    return {
      openInNewTab: "Open in New Tab",
      copyLinkAddress: "Copy Link Address",
    };
  }

  function resolveTabItemMenuLocale() {
    if (resolveMenuLocale() === "zh-CN") {
      return {
        newTabBelow: "在下方新建标签页",
        reload: "重新加载",
        duplicate: "复制",
        addToDock: "添加到 Dock 栏",
        close: "关闭",
        closeOtherTabs: "关闭其他标签页",
        closeTabsBelow: "关闭下方标签页",
      };
    }

      return {
        newTabBelow: "New Tab Below",
        reload: "Reload",
        duplicate: "Duplicate",
        addToDock: "Add to Dock",
        close: "Close",
        closeOtherTabs: "Close Other Tabs",
        closeTabsBelow: "Close Tabs Below",
      };
    }

  function resolveSplitViewMenuLocale() {
    if (resolveMenuLocale() === "zh-CN") {
      return {
        horizontal: "并排",
        vertical: "上下",
        bento: "Bento",
        syncScroll: "联动滚动",
        separateAll: "分离全部标签页",
      };
    }

    return {
      horizontal: "Side by side",
      vertical: "Stacked",
      bento: "Bento",
      syncScroll: "Sync Scroll",
      separateAll: "Separate All Tabs",
    };
  }

  function resolveUserScriptsToolbarPopupLocale() {
    if (resolveMenuLocale() === "zh-CN") {
      return {
        title: "用户脚本",
        currentPage: "当前页",
        allScripts: "全部脚本",
        noScripts: "还没有用户脚本",
        enabled: "已启用",
        disabled: "已停用",
        matchesCurrentPage: "命中当前页",
        notMatchingCurrentPage: "未命中当前页",
        enable: "启用",
        disable: "停用",
        runNow: "立即应用",
        edit: "编辑",
        delete: "删除",
        newScript: "新建脚本",
        openManager: "打开管理页",
        deleteTitle: "删除用户脚本",
        deleteMessage: "确定删除这个用户脚本吗？",
        deleteButton: "删除",
        cancelButton: "取消",
        runFailedTitle: "运行用户脚本失败",
        deleteFailedTitle: "删除用户脚本失败",
      };
    }

    return {
      title: "User Scripts",
      currentPage: "Current page",
      allScripts: "All scripts",
      noScripts: "No user scripts yet",
      enabled: "Enabled",
      disabled: "Disabled",
      matchesCurrentPage: "Matches current page",
      notMatchingCurrentPage: "Not matching current page",
      enable: "Enable",
      disable: "Disable",
      runNow: "Run now",
      edit: "Edit",
      delete: "Delete",
      newScript: "New script",
      openManager: "Open manager",
      deleteTitle: "Delete user script",
      deleteMessage: "Delete this user script?",
      deleteButton: "Delete",
      cancelButton: "Cancel",
      runFailedTitle: "Failed to run user script",
      deleteFailedTitle: "Failed to delete user script",
    };
  }

  function resolveExtensionsToolbarMenuLocale() {
    if (resolveMenuLocale() === "zh-CN") {
      return {
        title: "扩展程序",
        noExtensions: "还没有安装扩展",
        enabled: "已启用",
        disabled: "已停用",
        notLoaded: "未加载",
        noPopup: "无 popup",
        openFailedTitle: "打开扩展弹窗失败",
      };
    }

    return {
      title: "Extensions",
      noExtensions: "No extensions installed",
      enabled: "Enabled",
      disabled: "Disabled",
      notLoaded: "Not loaded",
      noPopup: "No popup",
      openFailedTitle: "Failed to open extension popup",
    };
  }

  function estimateMenuHeight(template: MenuItemConstructorOptions[]) {
    const itemHeight = process.platform === "darwin" ? 24 : 28;
    const separatorHeight = process.platform === "darwin" ? 8 : 10;
    const basePadding = 8;

    return template.reduce((total, item) => {
      if (item.type === "separator") {
        return total + separatorHeight;
      }

      return total + itemHeight;
    }, basePadding);
  }

  function measureMenuLabelUnits(text: string) {
    return Array.from(text).reduce((total, char) => {
      return total + (/[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF\uFF00-\uFFEF]/u.test(char) ? 2 : 1);
    }, 0);
  }

  function padWorkspaceMenuLabel(text: string) {
    const units = measureMenuLabelUnits(text);
    if (units >= WORKSPACE_MENU_MIN_UNITS) {
      return text;
    }

    return `${text}${"\u00A0".repeat(WORKSPACE_MENU_MIN_UNITS - units)}`;
  }

  function findWindow(windowId: number) {
    const targetWindow = BrowserWindow.fromId(windowId);
    if (!targetWindow || targetWindow.isDestroyed()) {
      return null;
    }

    return targetWindow;
  }

  function requireWindow(windowId: number) {
    const targetWindow = findWindow(windowId);
    if (!targetWindow) {
      throw new Error("Window not found.");
    }

    return targetWindow;
  }

  function resolveProfileIdForWindow(targetWindow: BrowserWindow) {
    const windowState = windows.get(targetWindow.id);
    if (!windowState) {
      throw new Error("Window state is not initialized.");
    }

    const workspace = workspaces.get(windowState.workspaceId)
      ?? workspaces.get(DEFAULT_WORKSPACE_ID);
    if (!workspace) {
      throw new Error("Workspace not found.");
    }

    return workspace.profileId;
  }

  function resolveSenderProfileId(sender: WebContents) {
    const senderWindow = BrowserWindow.fromWebContents(sender);
    if (senderWindow && !senderWindow.isDestroyed() && windows.has(senderWindow.id)) {
      return resolveProfileIdForWindow(senderWindow);
    }

    for (const [windowId, tabs] of tabRecords.entries()) {
      const matchedTab = Array.from(tabs.keys()).find((tabId) => {
        const view = browserViews.get(tabId);
        const contents = view?.webContents;
        return contents?.id === sender.id;
      });

      if (!matchedTab) {
        continue;
      }

      const windowState = windows.get(windowId);
      if (!windowState) {
        break;
      }

      const targetWindow = BrowserWindow.fromId(windowId);
      if (targetWindow && !targetWindow.isDestroyed()) {
        return resolveProfileIdForWindow(targetWindow);
      }
      break;
    }

    throw new Error("Window not found.");
  }

  function resolveSenderWindow(sender: WebContents) {
    const senderWindow = BrowserWindow.fromWebContents(sender);
    if (senderWindow && !senderWindow.isDestroyed()) {
      return senderWindow;
    }

    for (const [windowId, tabs] of tabRecords.entries()) {
      const matchedTab = Array.from(tabs.keys()).find((tabId) => {
        const view = browserViews.get(tabId);
        const contents = view?.webContents;
        return contents?.id === sender.id;
      });

      if (!matchedTab) {
        continue;
      }

      const targetWindow = BrowserWindow.fromId(windowId);
      if (targetWindow && !targetWindow.isDestroyed()) {
        return targetWindow;
      }
    }

    return null;
  }

  function resolveSenderTabContext(sender: WebContents) {
    for (const [windowId, tabs] of tabRecords.entries()) {
      for (const tabId of tabs.keys()) {
        const view = browserViews.get(tabId);
        const contents = view?.webContents;
        if (contents?.id !== sender.id) {
          continue;
        }
        const targetWindow = BrowserWindow.fromId(windowId);
        if (!targetWindow || targetWindow.isDestroyed()) {
          return null;
        }
        const workspaceId = windows.get(windowId)?.workspaceId
          ?? workspaces.values().next().value?.id
          ?? DEFAULT_WORKSPACE_ID;
        return {
          targetWindow,
          windowId,
          workspaceId,
          tabId,
        };
      }
    }

    const senderWindow = BrowserWindow.fromWebContents(sender);
    if (!senderWindow || senderWindow.isDestroyed()) {
      return null;
    }
    const windowId = senderWindow.id;
    const tabId = windowActiveTabs.get(windowId);
    if (!tabId) {
      return null;
    }
    return {
      targetWindow: senderWindow,
      windowId,
      workspaceId: windows.get(windowId)?.workspaceId ?? DEFAULT_WORKSPACE_ID,
      tabId,
    };
  }

  function isUserScriptRunnableUrl(url: string) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  function escapeUserScriptRegex(value: string) {
    return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }

  function userScriptGlobToRegex(pattern: string) {
    const source = pattern
      .split("*")
      .map(escapeUserScriptRegex)
      .join(".*");
    return new RegExp(`^${source}$`);
  }

  function matchesUserScriptHostPattern(hostname: string, hostPattern: string) {
    const normalizedHostname = hostname.toLowerCase();
    const normalizedPattern = hostPattern.trim().toLowerCase();

    if (!normalizedPattern || normalizedPattern === "*") {
      return true;
    }

    if (normalizedPattern.startsWith("*.")) {
      const suffix = normalizedPattern.slice(2);
      return normalizedHostname === suffix || normalizedHostname.endsWith(`.${suffix}`);
    }

    if (normalizedPattern.includes("*")) {
      return userScriptGlobToRegex(normalizedPattern).test(normalizedHostname);
    }

    return normalizedHostname === normalizedPattern;
  }

  function matchesUserScriptUrlPattern(url: string, pattern: string) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return false;
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return false;
    }

    const trimmed = pattern.trim();
    if (!trimmed) {
      return false;
    }

    if (trimmed === "<all_urls>" || trimmed === "*") {
      return true;
    }

    const chromePattern = trimmed.match(/^(\*|http|https):\/\/([^/]*)(\/.*)?$/i);
    if (chromePattern) {
      const schemePattern = chromePattern[1].toLowerCase();
      const hostPattern = chromePattern[2];
      const pathPattern = chromePattern[3] ?? "/*";
      const targetScheme = parsedUrl.protocol.slice(0, -1);

      if (schemePattern !== "*" && schemePattern !== targetScheme) {
        return false;
      }

      if (!matchesUserScriptHostPattern(parsedUrl.hostname, hostPattern)) {
        return false;
      }

      const targetPath = `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
      return userScriptGlobToRegex(pathPattern).test(targetPath);
    }

    return userScriptGlobToRegex(trimmed).test(url);
  }

  function userScriptMatchesTargetUrl(script: UserScriptRecord, url: string) {
    if (!isUserScriptRunnableUrl(url)) {
      return false;
    }

    const hasMatch = script.matches.some((pattern) => matchesUserScriptUrlPattern(url, pattern));
    if (!hasMatch) {
      return false;
    }

    return !script.excludes.some((pattern) => matchesUserScriptUrlPattern(url, pattern));
  }

  function resolveActiveTabUrlForWindow(targetWindow: BrowserWindow) {
    const activeTabId = windowActiveTabs.get(targetWindow.id);
    const activeTab = activeTabId ? tabRecords.get(targetWindow.id)?.get(activeTabId) : undefined;
    const activeView = activeTabId ? browserViews.get(activeTabId) : undefined;
    const activeContents = activeView?.webContents;
    return activeContents && !activeContents.isDestroyed()
      ? activeContents.getURL()
      : activeTab?.url ?? "";
  }

  function isUserScriptsManagerUrl(url: string) {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.protocol === "milo:"
        && parsedUrl.hostname.toLowerCase() === "user-scripts"
        && (parsedUrl.pathname === "" || parsedUrl.pathname === "/");
    } catch {
      return false;
    }
  }

  function openUserScriptsManagerTab(targetWindow: BrowserWindow, scriptId?: string) {
    const targetUrl = scriptId
      ? `${MILO_USER_SCRIPTS_URL}?scriptId=${encodeURIComponent(scriptId)}`
      : MILO_USER_SCRIPTS_URL;
    const tabs = tabRecords.get(targetWindow.id);
    const existingTab = tabs
      ? Array.from(tabs.values()).find((tab) =>
        isUserScriptsManagerUrl(tab.displayUrl) || isUserScriptsManagerUrl(tab.url))
      : undefined;

    if (existingTab) {
      handleTabSetActive(targetWindow, existingTab.id, {
        sidebarWidth: windowSidebarWidths.get(targetWindow.id),
        urlBarHeight: windowUrlBarHeights.get(targetWindow.id),
      });
      void navigateTab(targetWindow, existingTab.id, targetUrl).catch(() => undefined);
      return;
    }

    handleTabCreate(targetWindow, targetUrl);
  }

  function resolveSenderUserScriptTargetContents(sender: WebContents) {
    const senderWindow = resolveSenderWindow(sender);
    if (!senderWindow) {
      throw new Error("Window not found.");
    }

    const tabs = tabRecords.get(senderWindow.id);
    if (!tabs) {
      throw new Error("No tabs are available in this window.");
    }

    const activeTabId = windowActiveTabs.get(senderWindow.id);
    const candidateTabIds = [
      ...(activeTabId ? [activeTabId] : []),
      ...Array.from(tabs.keys()).reverse().filter((tabId) => tabId !== activeTabId),
    ];

    for (const tabId of candidateTabIds) {
      const view = browserViews.get(tabId);
      const contents = view?.webContents;
      if (!contents || contents.isDestroyed() || contents.id === sender.id) {
        continue;
      }

      if (isUserScriptRunnableUrl(contents.getURL())) {
        return contents;
      }
    }

    throw new Error("No http/https page tab is available for this script.");
  }

  function resolveSenderTabView(sender: WebContents) {
    for (const [windowId, tabs] of tabRecords.entries()) {
      for (const tabId of tabs.keys()) {
        const view = browserViews.get(tabId);
        const contents = view?.webContents;
        if (view && contents?.id === sender.id) {
          return {
            tabId,
            view,
            windowId,
          };
        }
      }
    }

    return null;
  }

  async function navigateSenderTabHistory(
    sender: WebContents,
    direction: TabHistoryNavigationDirection,
  ) {
    const matchedTabView = resolveSenderTabView(sender);
    if (!matchedTabView) {
      return;
    }

    const {
      tabId,
      view,
      windowId,
    } = matchedTabView;
    const contents = view.webContents;
    if (!contents || contents.isDestroyed()) {
      return;
    }

    if (!shouldHandleTabHistoryNavigation(windowId, direction, tabId)) {
      return;
    }

    if (direction === "back") {
      if (!contents.canGoBack()) {
        return;
      }

      await applyColorSchemeToContents(contents);
      contents.goBack();
      return;
    }

    if (!contents.canGoForward()) {
      return;
    }

    await applyColorSchemeToContents(contents);
    contents.goForward();
  }

  function resolveSearchHostWindow(
    sender: WebContents,
    tabId?: string,
  ) {
    const senderWindow = BrowserWindow.fromWebContents(sender);
    if (senderWindow && !senderWindow.isDestroyed()) {
      return senderWindow;
    }

    if (tabId) {
      for (const [windowId, tabs] of tabRecords.entries()) {
        if (!tabs.has(tabId)) {
          continue;
        }

        const tabWindow = BrowserWindow.fromId(windowId);
        if (tabWindow && !tabWindow.isDestroyed()) {
          return tabWindow;
        }
      }
    }

    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow && !focusedWindow.isDestroyed()) {
      return focusedWindow;
    }

    return BrowserWindow.getAllWindows().find((windowRecord) => !windowRecord.isDestroyed());
  }

  function usesChineseUi() {
    return getBrowserLocale().trim().toLowerCase().startsWith("zh");
  }

  function parseManifestPermissionPreview(manifest?: string) {
    if (typeof manifest !== "string" || !manifest.trim()) {
      return [] as string[];
    }

    try {
      const parsed = JSON.parse(manifest) as Record<string, unknown>;
      const permissions: string[] = [];
      const seen = new Set<string>();

      const appendValue = (value: unknown) => {
        if (typeof value !== "string") {
          return;
        }

        const normalizedValue = value.trim();
        if (!normalizedValue || seen.has(normalizedValue)) {
          return;
        }

        seen.add(normalizedValue);
        permissions.push(normalizedValue);
      };

      const appendValues = (value: unknown) => {
        if (Array.isArray(value)) {
          value.forEach(appendValue);
        }
      };

      appendValues(parsed.permissions);
      appendValues(parsed.host_permissions);
      appendValues(parsed.optional_permissions);
      appendValues(parsed.optional_host_permissions);

      return permissions;
    } catch {
      return [] as string[];
    }
  }

  function resolveChromeWebStoreInstallName(input: ChromeWebStoreInstallRequest) {
    if (typeof input.localizedName === "string" && input.localizedName.trim()) {
      return input.localizedName.trim();
    }

    if (typeof input.manifest === "string" && input.manifest.trim()) {
      try {
        const parsed = JSON.parse(input.manifest) as Record<string, unknown>;
        if (typeof parsed.name === "string" && parsed.name.trim()) {
          return parsed.name.trim();
        }
      } catch {
        // Ignore invalid page manifest previews here; the extension manager validates separately.
      }
    }

    return input.id;
  }

  function buildChromeWebStoreInstallPrompt(input: ChromeWebStoreInstallRequest) {
    const isChineseUi = usesChineseUi();
    const appName = app.getName().trim() || "Milo";
    const extensionName = resolveChromeWebStoreInstallName(input);
    const permissions = parseManifestPermissionPreview(input.manifest);
    const detailLines = isChineseUi
      ? [`扩展 ID: ${input.id}`]
      : [`Extension ID: ${input.id}`];

    if (permissions.length > 0) {
      detailLines.push("");
      detailLines.push(isChineseUi ? "请求的权限:" : "Requested permissions:");
      permissions.slice(0, 8).forEach((permission) => {
        detailLines.push(`• ${permission}`);
      });

      if (permissions.length > 8) {
        detailLines.push(
          isChineseUi
            ? `• 还有 ${permissions.length - 8} 项权限`
            : `• And ${permissions.length - 8} more permissions`,
        );
      }
    }

    return {
      buttons: isChineseUi ? ["添加扩展", "取消"] : ["Add Extension", "Cancel"],
      message: isChineseUi
        ? `将“${extensionName}”添加到 ${appName}？`
        : `Add "${extensionName}" to ${appName}?`,
      detail: detailLines.join("\n"),
    };
  }

  function requireWindowTab(windowId: number, tabId: string) {
    const tabs = tabRecords.get(windowId);
    const tab = tabs?.get(tabId);
    if (!tabs || !tab) {
      throw new Error("Tab not found in target window.");
    }

    return { tabs, tab };
  }

  function hasWindowTab(windowId: number, tabId: string) {
    return tabRecords.get(windowId)?.has(tabId) ?? false;
  }

  async function navigateTab(targetWindow: BrowserWindow, tabId: string, url: string) {
    const { tab } = requireWindowTab(targetWindow.id, tabId);
    const view = browserViews.get(tabId);
    const contents = view?.webContents;
    if (!contents || contents.isDestroyed()) {
      throw new Error("Tab webContents not found.");
    }

    const resolvedUrl = resolveInputToUrl(url, resolveInputToUrlOptions);
    await applyColorSchemeToContents(contents);
    void contents.loadURL(resolvedUrl);

    tab.hasLoaded = true;
    tab.isLoading = true;
    tab.url = resolvedUrl;
    tab.displayUrl = toDisplayUrl(resolvedUrl, displayUrlOptions);
    tab.title = inferTitleFromUrl(resolvedUrl, startPageUrlOptions);
    tab.canGoBack = false;
    tab.canGoForward = false;
    broadcastTabState(targetWindow);
  }

  function reorderWindowTabs(windowId: number, orderedTabIds: string[]) {
    const tabs = tabRecords.get(windowId);
    if (!tabs) {
      return;
    }

    const orderedSet = new Set(orderedTabIds);
    const reorderedTabs = new Map<string, TabRecord>();

    orderedTabIds.forEach((orderedTabId) => {
      const tab = tabs.get(orderedTabId);
      if (tab) {
        reorderedTabs.set(orderedTabId, tab);
      }
    });

    tabs.forEach((tab, existingTabId) => {
      if (!orderedSet.has(existingTabId)) {
        reorderedTabs.set(existingTabId, tab);
      }
    });

    tabRecords.set(windowId, reorderedTabs);
  }

  function moveTabAfter(windowId: number, tabId: string, anchorTabId: string) {
    const tabs = tabRecords.get(windowId);
    if (!tabs || !tabs.has(tabId) || !tabs.has(anchorTabId) || tabId === anchorTabId) {
      return;
    }

    const orderedTabIds = Array.from(tabs.keys()).filter((existingTabId) => existingTabId !== tabId);
    const anchorIndex = orderedTabIds.indexOf(anchorTabId);
    if (anchorIndex === -1) {
      return;
    }

    orderedTabIds.splice(anchorIndex + 1, 0, tabId);
    reorderWindowTabs(windowId, orderedTabIds);
  }

  async function reloadTab(targetWindow: BrowserWindow, tabId: string) {
    const { tab } = requireWindowTab(targetWindow.id, tabId);
    const view = browserViews.get(tabId);
    const contents = view?.webContents;
    if (!contents || contents.isDestroyed()) {
      return;
    }

    if (tab.isLoading) {
      contents.stop();
      return;
    }

    if (!tab.hasLoaded) {
      tab.hasLoaded = true;
      tab.isLoading = true;
      tab.canGoBack = false;
      tab.canGoForward = false;
      await applyColorSchemeToContents(contents);
      void contents.loadURL(tab.url);
      broadcastTabState(targetWindow);
      return;
    }

    await applyColorSchemeToContents(contents);
    contents.reload();
  }

  ipcMain.handle("browser:get-bootstrap-data", (event) => {
    return buildBootstrapData(event.sender);
  });

  ipcMain.handle("render-preview:get-document", (_event, id: string) => {
    return getRenderPreviewDocument(id);
  });

  ipcMain.handle("system-notifications:show", (event, input?: SystemNotificationInput) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const payload = input && typeof input === "object" ? input : {};
    return showSystemNotification(payload, {
      onClick: () => {
        if (senderWindow && !senderWindow.isDestroyed()) {
          revealWorkspaceWindow(senderWindow);
        }
      },
    });
  });

  ipcMain.handle(
    "browser:open-create-workspace-dialog",
    (event, input: OpenCreateWorkspaceDialogInput) => {
      const senderWindow = BrowserWindow.fromWebContents(event.sender);
      if (!senderWindow || senderWindow.isDestroyed()) {
        throw new Error("Window not found.");
      }

      openCreateWorkspaceDialog(senderWindow, input);
    },
  );

  ipcMain.handle(
    "browser:open-folder-settings-dialog",
    (event, input: OpenFolderSettingsDialogInput) => {
      const senderWindow = BrowserWindow.fromWebContents(event.sender);
      if (!senderWindow || senderWindow.isDestroyed()) {
        throw new Error("Window not found.");
      }

      openFolderSettingsDialog(senderWindow, input);
    },
  );

  ipcMain.handle(
    "browser:submit-folder-settings-dialog",
    (event, input: FolderSettingsUpdateInput) => {
      const senderWindow = BrowserWindow.fromWebContents(event.sender);
      if (!senderWindow || senderWindow.isDestroyed()) {
        throw new Error("Window not found.");
      }

      const parentWindow = senderWindow.getParentWindow();
      if (!parentWindow || parentWindow.isDestroyed()) {
        throw new Error("Parent window not found.");
      }

      const workspaceId = typeof input.workspaceId === "string" ? input.workspaceId.trim() : "";
      const folderId = typeof input.folderId === "string" ? input.folderId.trim() : "";
      if (!workspaceId || !folderId) {
        throw new Error("Folder dialog payload is invalid.");
      }

      const name = typeof input.name === "string" ? input.name.trim() : "";
      const icon = typeof input.icon === "string" && input.icon.trim()
        ? input.icon.trim()
        : undefined;
      const backgroundColor = normalizeFolderBackgroundColor(input.backgroundColor);
      updateSidebarFolderSettings({
        windowId: parentWindow.id,
        workspaceId,
        folderId,
        name,
        icon: icon ?? null,
        backgroundColor: backgroundColor ?? null,
      });

      parentWindow.webContents.send("browser:folder-settings-updated", {
        workspaceId,
        folderId,
        name,
        icon,
        backgroundColor,
      } satisfies FolderSettingsUpdateInput);
      senderWindow.close();
    },
  );

  ipcMain.handle("browser:close-current-window", (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow || senderWindow.isDestroyed()) {
      return;
    }

    senderWindow.close();
  });

  ipcMain.handle("browser:minimize-current-window", (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (senderWindow && !senderWindow.isDestroyed()) {
      senderWindow.minimize();
    }
  });

  ipcMain.handle("browser:maximize-current-window", (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow || senderWindow.isDestroyed()) {
      return false;
    }
    if (senderWindow.isMaximized()) {
      senderWindow.unmaximize();
      return false;
    } else {
      senderWindow.maximize();
      return true;
    }
  });

  ipcMain.handle("browser:is-window-maximized", (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    return senderWindow && !senderWindow.isDestroyed() ? senderWindow.isMaximized() : false;
  });

  ipcMain.handle("browser:create-workspace", (_event, input: CreateWorkspaceInput) => {
    const profileSourceWorkspace =
      input.profileMode === "attached" && input.profileSourceWorkspaceId
        ? workspaces.get(input.profileSourceWorkspaceId)
        : undefined;
    const appearanceSourceWorkspaceId =
      typeof input.appearanceSourceWorkspaceId === "string"
        ? input.appearanceSourceWorkspaceId.trim()
        : "";

    if (input.profileMode === "attached" && !profileSourceWorkspace) {
      throw new Error("The selected workspace profile does not exist.");
    }

    const workspaceId = randomUUID();
    const workspace: WorkspaceRecord = {
      id: workspaceId,
      name: createWorkspaceName(input.name),
      createdAt: Date.now(),
      profileId: profileSourceWorkspace?.profileId ?? workspaceId,
      profileMode: input.profileMode,
      profileSourceWorkspaceId: profileSourceWorkspace?.id,
      automationEnabled: true,
    };

    workspaces.set(workspace.id, workspace);
    saveWorkspaceState();
    setStartPageAppearance(workspace.id, {
      backgroundImage: null,
    });
    setStartPageDockItems(workspace.id, []);
    if (appearanceSourceWorkspaceId) {
      setStartPageWidgets(
        workspace.id,
        getStartPageWidgetsState(appearanceSourceWorkspaceId).items,
      );
    }
    syncStartPageWidgetRefreshTriggers(workspace.id);

    createWorkspaceWindow(workspace, { show: Boolean(input.showWindow) });

    broadcastWorkspaceContext();
    return serializeWorkspace(workspace);
  });

  ipcMain.handle("browser:delete-workspaces", (_event, workspaceIds: string[]) => {
    const result = deleteWorkspaces(workspaceIds);
    syncAllStartPageWidgetRefreshTriggers();
    return result;
  });

  ipcMain.handle("browser:open-workspace-profile-directory", async (_event, workspaceId: string) => {
    return openWorkspaceProfileDirectory(workspaceId);
  });

  ipcMain.handle("browser:rename-workspace", (_event, input: RenameWorkspaceInput) => {
    const workspace = getWorkspaceRecord(input.workspaceId);
    const nextName = input.name.trim();

    if (!nextName) {
      throw new Error("Workspace name cannot be empty.");
    }

    workspace.name = nextName;
    saveWorkspaceState();

    for (const [windowId, windowState] of windows.entries()) {
      if (windowState.workspaceId !== workspace.id) {
        continue;
      }

      const targetWindow = BrowserWindow.fromId(windowId);
      if (!targetWindow || targetWindow.isDestroyed()) {
        continue;
      }

      updateWindowTitle(targetWindow);
    }

    broadcastWorkspaceContext();
    return serializeWorkspace(workspace);
  });

  ipcMain.handle("browser:show-workspace-menu", (event, anchor?: WorkspaceMenuAnchorInput) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow || senderWindow.isDestroyed()) {
      throw new Error("Window not found.");
    }

    const currentWindowState = windows.get(senderWindow.id);
    const currentWorkspaceId = currentWindowState?.workspaceId;
    const currentWorkspace = currentWorkspaceId ? workspaces.get(currentWorkspaceId) : undefined;
    const menuText = resolveWorkspaceMenuLocale();

    const workspaceItems = Array.from(workspaces.values())
      .filter((workspace) => !isAutomationWorkspace(workspace))
      .sort((left, right) => compareWorkspacesByCreatedAt(left, right, DEFAULT_WORKSPACE_ID))
      .map((workspace): MenuItemConstructorOptions => ({
        label: padWorkspaceMenuLabel(
          workspace.id === currentWorkspaceId
            ? `${workspace.name}${menuText.currentSuffix}`
            : workspace.name,
        ),
        enabled: workspace.id !== currentWorkspaceId,
        click: () => {
          switchWindowWorkspace(senderWindow, workspace.id, {
            sidebarWidth: windowSidebarWidths.get(senderWindow.id),
            urlBarHeight: windowUrlBarHeights.get(senderWindow.id),
          });
        },
      }));

    const template: MenuItemConstructorOptions[] = [
      ...workspaceItems,
      { type: "separator" },
      {
        label: padWorkspaceMenuLabel(menuText.createWorkspace),
        click: () => {
          if (!currentWorkspace) {
            return;
          }

          openCreateWorkspaceDialog(senderWindow, {
            sourceWorkspaceId: currentWorkspace.id,
            sourceWorkspaceName: currentWorkspace.name,
          });
        },
      },
      {
        label: padWorkspaceMenuLabel(menuText.workspaceManager),
        click: () => {
          handleTabCreate(senderWindow, MILO_WORKSPACE_URL);
        },
      },
    ];

    const estimatedMenuHeight = estimateMenuHeight(template);
    const popupX = typeof anchor?.left === "number"
      ? Math.max(0, Math.round(anchor.left))
      : undefined;
    const popupY = typeof anchor?.top === "number"
      ? Math.max(0, Math.round(anchor.top - estimatedMenuHeight - 6))
      : undefined;

    Menu.buildFromTemplate(template).popup({
      window: senderWindow,
      x: popupX,
      y: popupY,
    });
  });

  ipcMain.handle("history:show-item-menu", (event, input: HistoryItemMenuInput) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow || senderWindow.isDestroyed()) {
      throw new Error("Window not found.");
    }

    const url = typeof input?.url === "string" ? input.url.trim() : "";
    if (!url) {
      throw new Error("History URL is required.");
    }

    const menuText = resolveHistoryItemMenuLocale();
    const template: MenuItemConstructorOptions[] = [
      {
        label: menuText.openInNewTab,
        click: () => {
          handleTabCreate(senderWindow, url);
        },
      },
      {
        label: menuText.copyLinkAddress,
        click: () => {
          clipboard.writeText(url);
        },
      },
    ];

    Menu.buildFromTemplate(template).popup({
      window: senderWindow,
    });
  });

  ipcMain.handle("tab:show-item-menu", (event, input: TabItemMenuInput) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow || senderWindow.isDestroyed()) {
      throw new Error("Window not found.");
    }

    const tabId = typeof input?.tabId === "string" ? input.tabId.trim() : "";
    if (!tabId) {
      throw new Error("Tab id is required.");
    }

    const { tabs, tab } = requireWindowTab(senderWindow.id, tabId);
    const orderedTabIds = Array.from(tabs.keys());
    const tabIndex = orderedTabIds.indexOf(tabId);
    const hasOtherTabs = orderedTabIds.length > 1;
    const hasTabsBelow = tabIndex >= 0 && tabIndex < orderedTabIds.length - 1;
    const menuText = resolveTabItemMenuLocale();
    const popupX = typeof input?.x === "number" ? Math.max(0, Math.round(input.x)) : undefined;
    const popupY = typeof input?.y === "number" ? Math.max(0, Math.round(input.y)) : undefined;

    const template: MenuItemConstructorOptions[] = [
      {
        label: menuText.newTabBelow,
        click: () => {
          if (!hasWindowTab(senderWindow.id, tabId)) {
            return;
          }
          const createdTab = handleTabCreate(senderWindow);
          moveTabAfter(senderWindow.id, createdTab.id, tabId);
          broadcastTabState(senderWindow);
        },
      },
      {
        label: menuText.reload,
        click: () => {
          if (!hasWindowTab(senderWindow.id, tabId)) {
            return;
          }
          void reloadTab(senderWindow, tabId).catch(() => undefined);
        },
      },
      {
        label: menuText.duplicate,
        click: () => {
          if (!hasWindowTab(senderWindow.id, tabId)) {
            return;
          }
          const duplicatedTab = handleTabCreate(senderWindow, tab.url, {
            initialTitle: tab.title,
            initialFavicon: tab.favicon,
          });
          moveTabAfter(senderWindow.id, duplicatedTab.id, tabId);
          broadcastTabState(senderWindow);
        },
      },
      { type: "separator" },
      {
        label: menuText.close,
        click: () => {
          if (!hasWindowTab(senderWindow.id, tabId)) {
            return;
          }
          handleTabClose(senderWindow, tabId);
        },
      },
      {
        label: menuText.closeOtherTabs,
        enabled: hasOtherTabs,
        click: () => {
          orderedTabIds
            .filter((existingTabId) => existingTabId !== tabId)
            .forEach((existingTabId) => {
              if (tabRecords.get(senderWindow.id)?.has(existingTabId)) {
                handleTabClose(senderWindow, existingTabId);
              }
            });
        },
      },
      {
        label: menuText.closeTabsBelow,
        enabled: hasTabsBelow,
        click: () => {
          orderedTabIds
            .slice(tabIndex + 1)
            .forEach((existingTabId) => {
              if (tabRecords.get(senderWindow.id)?.has(existingTabId)) {
                handleTabClose(senderWindow, existingTabId);
              }
          });
        },
      },
      { type: "separator" },
      {
        label: menuText.addToDock,
        enabled: Boolean(tab.url.trim()),
        click: () => {
          if (!hasWindowTab(senderWindow.id, tabId)) {
            return;
          }
          const workspaceId = resolveSenderWorkspaceId(senderWindow.webContents);
          const items = addToStartPageDock(workspaceId, {
            favicon: tab.favicon,
            title: tab.title,
            url: tab.url,
          });
          broadcastStartPageDockChanged(workspaceId, items);
        },
      },
    ];

    Menu.buildFromTemplate(template).popup({
      window: senderWindow,
      x: popupX,
      y: popupY,
    });
  });

  ipcMain.handle("split-view:show-menu", (event, input: SplitViewMenuInput) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow || senderWindow.isDestroyed()) {
      throw new Error("Window not found.");
    }

    const menuText = resolveSplitViewMenuLocale();
    const popupX = typeof input?.x === "number" ? Math.max(0, Math.round(input.x)) : undefined;
    const popupY = typeof input?.y === "number" ? Math.max(0, Math.round(input.y)) : undefined;
    let resolve!: (action: SplitViewMenuAction | null) => void;
    const result = new Promise<SplitViewMenuAction | null>((nextResolve) => {
      resolve = nextResolve;
    });
    let settled = false;
    const finish = (action: SplitViewMenuAction | null) => {
      if (!settled) {
        settled = true;
        resolve(action);
      }
    };

    const template: MenuItemConstructorOptions[] = input.kind === "sidebar"
      ? [
        {
          label: menuText.separateAll,
          click: () => {
            finish("separate-all");
          },
        },
      ]
      : input.isActiveSplit
        ? [
          {
            label: menuText.horizontal,
            type: "radio",
            checked: input.activeMode === "horizontal",
            click: () => {
              finish("set-horizontal");
            },
          },
          {
            label: menuText.vertical,
            type: "radio",
            checked: input.activeMode === "vertical",
            click: () => {
              finish("set-vertical");
            },
          },
          {
            label: menuText.bento,
            type: "radio",
            checked: input.activeMode === "bento",
            enabled: input.canUseBentoLayout,
            click: () => {
              finish("set-bento");
            },
          },
          { type: "separator" },
          {
            label: menuText.syncScroll,
            type: "checkbox",
            checked: input.syncScroll,
            click: () => {
              finish("toggle-sync-scroll");
            },
          },
          {
            label: menuText.separateAll,
            click: () => {
              finish("separate-all");
            },
          },
        ]
        : [
          {
            label: menuText.horizontal,
            enabled: input.canCreatePair,
            click: () => {
              finish("create-horizontal");
            },
          },
          {
            label: menuText.vertical,
            enabled: input.canCreatePair,
            click: () => {
              finish("create-vertical");
            },
          },
          {
            label: menuText.bento,
            enabled: input.canCreateBento,
            click: () => {
              finish("create-bento");
            },
          },
        ];

    Menu.buildFromTemplate(template).popup({
      window: senderWindow,
      x: popupX,
      y: popupY,
      callback: () => {
        finish(null);
      },
    });

    return result;
  });

  ipcMain.handle("browser:open-workspace-window", (_event, workspaceId: string) => {
    const workspace = getWorkspaceRecord(workspaceId);
    const targetWindow = createWorkspaceWindow(workspace, { show: true });
    revealWorkspaceWindow(targetWindow);
    broadcastWorkspaceContext();
    return serializeWorkspace(workspace);
  });

  ipcMain.handle("browser:switch-workspace", (event, input: SwitchWorkspaceInput) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    if (!targetWindow || targetWindow.isDestroyed()) {
      throw new Error("Window not found for renderer.");
    }

    return switchWindowWorkspace(targetWindow, input.workspaceId, {
      sidebarWidth: input.sidebarWidth,
      urlBarHeight: input.urlBarHeight,
    });
  });

  ipcMain.handle("browser:focus-window", (_event, windowId: number) => {
    const targetWindow = BrowserWindow.fromId(windowId);
    if (!targetWindow || targetWindow.isDestroyed()) {
      throw new Error("Window not found.");
    }

    revealWorkspaceWindow(targetWindow);
    updateWindowTitle(targetWindow);
    broadcastWorkspaceContext();
    return serializeWindow(targetWindow);
  });

  ipcMain.handle("browser:sync-window-state", (event, input: SyncWindowStateInput) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    if (!targetWindow) {
      throw new Error("Window not found for renderer.");
    }

    const windowState = windows.get(targetWindow.id);
    if (!windowState) {
      throw new Error("Window state is not initialized.");
    }

    windowState.tabs = input.tabs;
    windowState.activeTabId = input.activeTabId;
    updateWindowTitle(targetWindow);
    broadcastWorkspaceContext();
    return serializeWindow(targetWindow);
  });

  ipcMain.handle(
    "browser:sync-sidebar-organization-state",
    (event, input: { workspaceId: string; state: OrganizerSidebarState; sequence?: number }) => {
      const senderWindow = BrowserWindow.fromWebContents(event.sender);
      if (!senderWindow || senderWindow.isDestroyed()) {
        throw new Error("Window not found for renderer.");
      }

      const workspaceId = typeof input.workspaceId === "string" ? input.workspaceId.trim() : "";
      if (!workspaceId) {
        throw new Error("Workspace id is required.");
      }

      return syncSidebarOrganizationState({
        windowId: senderWindow.id,
        workspaceId,
        state: input.state,
        sequence: input.sequence,
      });
    },
  );

  ipcMain.on(
    "browser:sync-sidebar-organization-state-now",
    (event, input: { workspaceId: string; state: OrganizerSidebarState; sequence?: number }) => {
      try {
        const senderWindow = BrowserWindow.fromWebContents(event.sender);
        if (!senderWindow || senderWindow.isDestroyed()) {
          throw new Error("Window not found for renderer.");
        }

        const workspaceId = typeof input.workspaceId === "string" ? input.workspaceId.trim() : "";
        if (!workspaceId) {
          throw new Error("Workspace id is required.");
        }

        const state = syncSidebarOrganizationState({
          windowId: senderWindow.id,
          workspaceId,
          state: input.state,
          sequence: input.sequence,
        });
        saveWorkspaceState();
        event.returnValue = { ok: true, state };
      } catch (error) {
        event.returnValue = {
          ok: false,
          error: error instanceof Error ? error.message : "Failed to sync sidebar organization state.",
        };
      }
    },
  );

  ipcMain.handle(
    "browser:automation:set-target",
    async (_event, workspaceId: string, targetContentsId: number) => {
      return setWorkspaceAutomationTarget(workspaceId, targetContentsId);
    },
  );

  ipcMain.handle("browser:automation:send-command", async (_event, input: CdpCommandInput) => {
    return sendWorkspaceCdpCommand(input.workspaceId, input.method, input.params);
  });

  ipcMain.handle("browser:automation:navigate", async (_event, input: AutomationNavigateInput) => {
    await sendWorkspaceCdpCommand(input.workspaceId, "Page.enable");
    return sendWorkspaceCdpCommand(input.workspaceId, "Page.navigate", {
      url: input.url,
    });
  });

  ipcMain.handle("browser:automation:evaluate", async (_event, input: AutomationEvaluateInput) => {
    await sendWorkspaceCdpCommand(input.workspaceId, "Runtime.enable");
    return sendWorkspaceCdpCommand(input.workspaceId, "Runtime.evaluate", {
      expression: input.expression,
      awaitPromise: input.awaitPromise ?? true,
      returnByValue: input.returnByValue ?? true,
    });
  });

  ipcMain.handle("tab:create", (_event, windowId: number, url?: string) => {
    const targetWindow = requireWindow(windowId);
    const tab = handleTabCreate(targetWindow, url);
    return serializeTabRecord(tab);
  });

  ipcMain.handle("tab:close", (_event, windowId: number, tabId: string) => {
    const targetWindow = requireWindow(windowId);
    requireWindowTab(windowId, tabId);
    return handleTabClose(targetWindow, tabId);
  });

  ipcMain.handle(
    "tab:set-active",
    (
      _event,
      windowId: number,
      tabId: string,
      sidebarWidth?: number,
      urlBarHeight?: number,
      rightPanelWidth?: number,
    ) => {
      const targetWindow = requireWindow(windowId);
      requireWindowTab(windowId, tabId);
      handleTabSetActive(targetWindow, tabId, {
        sidebarWidth,
        urlBarHeight,
        rightPanelWidth,
      });
    },
  );

  ipcMain.handle(
    "tab:apply-layout",
    (
      _event,
      windowId: number,
      input: TabLayoutUpdateInput,
      sidebarWidth?: number,
      urlBarHeight?: number,
    ) => {
      const targetWindow = requireWindow(windowId);
      handleTabApplyLayout(targetWindow, input, {
        sidebarWidth,
        urlBarHeight,
      });
    },
  );

  ipcMain.handle("tab:navigate", async (_event, windowId: number, tabId: string, url: string) => {
    const targetWindow = requireWindow(windowId);
    await navigateTab(targetWindow, tabId, url);
  });

  ipcMain.handle("tab:go-back", async (_event, windowId: number, tabId: string) => {
    requireWindowTab(windowId, tabId);
    const view = browserViews.get(tabId);
    const contents = view?.webContents;
    if (contents && !contents.isDestroyed() && contents.canGoBack()) {
      await applyColorSchemeToContents(contents);
      contents.goBack();
    }
  });

  ipcMain.handle("tab:go-forward", async (_event, windowId: number, tabId: string) => {
    requireWindowTab(windowId, tabId);
    const view = browserViews.get(tabId);
    const contents = view?.webContents;
    if (contents && !contents.isDestroyed() && contents.canGoForward()) {
      await applyColorSchemeToContents(contents);
      contents.goForward();
    }
  });

  ipcMain.handle("tab:reload", async (_event, windowId: number, tabId: string) => {
    const targetWindow = requireWindow(windowId);
    await reloadTab(targetWindow, tabId);
  });

  ipcMain.handle("tab:reorder", (_event, windowId: number, orderedTabIds: string[]) => {
    const targetWindow = requireWindow(windowId);
    const tabs = tabRecords.get(windowId);
    if (!tabs) {
      return;
    }

    const normalizedOrderedTabIds = Array.isArray(orderedTabIds)
      ? Array.from(
        new Set(
          orderedTabIds
            .map((tabId) => (typeof tabId === "string" ? tabId.trim() : ""))
            .filter((tabId) => tabId.length > 0 && tabs.has(tabId)),
        ),
      )
      : [];

    if (normalizedOrderedTabIds.length === 0) {
      return;
    }

    reorderWindowTabs(windowId, normalizedOrderedTabIds);
    broadcastTabState(targetWindow);
  });

  ipcMain.handle("tab:get-coding-context", async (_event, windowId: number, tabId?: string) => {
    try {
      const targetTabId = tabId || windowActiveTabs.get(windowId);
      if (!targetTabId) {
        return { isCodingSite: false, platform: "Unknown", problemTitle: "", problemDescription: "", detectedLanguage: "Python3", starterCode: "", editorType: "unknown", url: "" };
      }
      const view = browserViews.get(targetTabId);
      const contents = view?.webContents;
      if (!contents || contents.isDestroyed()) {
        return { isCodingSite: false, platform: "Unknown", problemTitle: "", problemDescription: "", detectedLanguage: "Python3", starterCode: "", editorType: "unknown", url: "" };
      }

      const script = `
(function() {
  try {
    const url = window.location.href || "";
    const title = document.title || "";
    const isLeetCode = /leetcode\\.com/i.test(url);
    const isHackerRank = /hackerrank\\.com/i.test(url);
    const isCodeforces = /codeforces\\.com/i.test(url);
    const isOnlineGdb = /onlinegdb\\.com/i.test(url);
    const isProgramiz = /programiz\\.com/i.test(url);
    const isW3Schools = /w3schools\\.com/i.test(url);
    const isGeeksForGeeks = /geeksforgeeks\\.org/i.test(url);
    const isReplit = /replit\\.com/i.test(url);
    const isCodeChef = /codechef\\.com/i.test(url);
    const isCodewars = /codewars\\.com/i.test(url);

    let problemTitle = "";
    let problemDescription = "";
    let detectedLanguage = "";
    let starterCode = "";
    let editorType = "unknown";

    // 1. Monaco Editor (LeetCode, HackerRank, Replit, etc.)
    try {
      if (window.monaco && window.monaco.editor) {
        editorType = "monaco";
        const models = window.monaco.editor.getModels();
        if (models && models.length > 0) {
          starterCode = models[0].getValue() || "";
          detectedLanguage = models[0].getLanguageId() || "";
        }
      } else if (document.querySelector('.monaco-editor')) {
        editorType = "monaco";
      }
    } catch {}

    // 2. CodeMirror 5
    try {
      if (!starterCode) {
        const cmEl = document.querySelector('.CodeMirror');
        if (cmEl && cmEl.CodeMirror) {
          editorType = "codemirror";
          starterCode = cmEl.CodeMirror.getValue() || "";
        }
      }
    } catch {}

    // 3. Ace Editor
    try {
      if (!starterCode && window.ace) {
        const aceEl = document.querySelector('.ace_editor');
        if (aceEl) {
          editorType = "ace";
          const inst = window.ace.edit(aceEl);
          if (inst) starterCode = inst.getValue() || "";
        }
      }
    } catch {}

    // 4. Textarea / compiler input (only if explicitly a code/source editor)
    try {
      if (!starterCode) {
        const textareas = Array.from(document.querySelectorAll('textarea'));
        const codeArea = textareas.find(t => /code|source|editor|program|solution|compiler/i.test((t.id || '') + ' ' + (t.name || '') + ' ' + (t.className || '') + ' ' + (t.getAttribute('data-mode') || '')));
        if (codeArea) {
          if (editorType === "unknown") editorType = "textarea";
          starterCode = codeArea.value || "";
        }
      }
    } catch {}

    // LeetCode-specific
    if (isLeetCode) {
      try {
        const titleEl = document.querySelector('div[class*="text-title-large"], [data-cy="question-title"], .elfjS h4, div.flex.items-start.justify-between h1');
        problemTitle = titleEl ? (titleEl.textContent || "").trim() : title.replace(/ - LeetCode$/i, "");
        const descEl = document.querySelector('[data-track-load="description_content"], .elfjS, div[class*="question-content"], div[data-key="description-content"]');
        problemDescription = descEl ? (descEl.innerText || descEl.textContent || "").trim() : "";
        const langBtn = document.querySelector('button[id*="headlessui-listbox-button"], button[class*="rounded"][class*="text-xs"]');
        if (langBtn && !detectedLanguage) {
          detectedLanguage = (langBtn.textContent || "").trim();
        }
      } catch {}
    } else if (isHackerRank) {
      try {
        const titleEl = document.querySelector('h1.ui-icon-label, .challenge-crumb, .page-label');
        problemTitle = titleEl ? (titleEl.textContent || "").trim() : title;
        const descEl = document.querySelector('.challenge-body-html, .problem-statement');
        problemDescription = descEl ? (descEl.innerText || descEl.textContent || "").trim() : "";
      } catch {}
    } else if (isCodeforces) {
      try {
        const titleEl = document.querySelector('.problem-statement .title');
        problemTitle = titleEl ? (titleEl.textContent || "").trim() : title;
        const descEl = document.querySelector('.problem-statement');
        problemDescription = descEl ? (descEl.innerText || descEl.textContent || "").trim() : "";
      } catch {}
    } else if (isGeeksForGeeks) {
      try {
        const titleEl = document.querySelector('.problem-statement h3, .problems_header_content__h1');
        problemTitle = titleEl ? (titleEl.textContent || "").trim() : title;
        const descEl = document.querySelector('.problem-statement, .problems_header_description__content');
        problemDescription = descEl ? (descEl.innerText || descEl.textContent || "").trim() : "";
      } catch {}
    }

    if (!problemTitle) {
      const h1 = document.querySelector('h1');
      problemTitle = h1 ? (h1.textContent || "").trim() : title;
    }
    if (!problemDescription) {
      const main = document.querySelector('main, article, #problem, .problem, .description');
      problemDescription = main ? (main.innerText || main.textContent || "").slice(0, 8000).trim() : (document.body ? (document.body.innerText || "").slice(0, 4000).trim() : "");
    }

    let hostname = "";
    try {
      hostname = new URL(url).hostname.replace(/^www\\./, "");
    } catch {}

    const isKnownCodingPlatform = isLeetCode || isHackerRank || isCodeforces || isOnlineGdb || isProgramiz || isW3Schools || isGeeksForGeeks || isReplit || isCodeChef || isCodewars;
    const isCodingKeywords = /compiler|leetcode|hackerrank|codeforces|judge|coding challenge|codechef|codewars/i.test(url + ' ' + title);
    const hasCodeEditor = editorType === "monaco" || editorType === "codemirror" || editorType === "ace";
    const isCodingSite = isKnownCodingPlatform || hasCodeEditor || (editorType === "textarea" && isCodingKeywords);

    const platform = isLeetCode ? "LeetCode"
      : isHackerRank ? "HackerRank"
      : isCodeforces ? "Codeforces"
      : isOnlineGdb ? "OnlineGDB"
      : isProgramiz ? "Programiz"
      : isW3Schools ? "W3Schools"
      : isGeeksForGeeks ? "GeeksForGeeks"
      : isReplit ? "Replit"
      : isCodeChef ? "CodeChef"
      : isCodewars ? "Codewars"
      : (hasCodeEditor ? "Code Editor" : (hostname || "Web Page"));

    return {
      isCodingSite,
      platform,
      problemTitle: problemTitle || title || "Coding Problem",
      problemDescription: problemDescription.slice(0, 8000),
      detectedLanguage: detectedLanguage || "Python3",
      starterCode: starterCode.slice(0, 6000),
      editorType,
      url,
    };
  } catch (e) {
    return {
      isCodingSite: false,
      platform: "Unknown",
      problemTitle: document.title || "",
      problemDescription: "",
      detectedLanguage: "Python3",
      starterCode: "",
      editorType: "unknown",
      url: window.location.href,
      error: String(e),
    };
  }
})()
`;
      const result = await Promise.race([
        contents.executeJavaScript(script, true),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Tab context scan timed out")), 4000)),
      ]);
      return result;
    } catch (err) {
      return {
        isCodingSite: false,
        platform: "Web Page",
        problemTitle: "",
        problemDescription: "",
        detectedLanguage: "Python3",
        starterCode: "",
        editorType: "unknown",
        url: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle("tab:inject-code", async (_event, windowId: number, tabId: string, code: string) => {
    try {
      const targetTabId = tabId || windowActiveTabs.get(windowId);
      if (!targetTabId) {
        return { success: false, message: "No active tab selected." };
      }
      const view = browserViews.get(targetTabId);
      const contents = view?.webContents;
      if (!contents || contents.isDestroyed()) {
        return { success: false, message: "Tab webContents unavailable." };
      }

      const script = `
(function() {
  const code = ${JSON.stringify(code)};
  let injected = false;
  let methodUsed = "";

  function tryInjectInDoc(win, doc) {
    if (!doc) return false;

    try {
      // 1. Monaco Editor API (LeetCode, HackerRank, Replit)
      if (win.monaco && win.monaco.editor) {
        const models = win.monaco.editor.getModels ? win.monaco.editor.getModels() : [];
        if (models && models.length > 0) {
          models[0].setValue(code);
          methodUsed = "monaco-models-api";
          return true;
        }
        const editors = win.monaco.editor.getEditors ? win.monaco.editor.getEditors() : [];
        if (editors && editors.length > 0) {
          editors[0].setValue(code);
          methodUsed = "monaco-editor-instance";
          return true;
        }
      }

      // 2. Monaco DOM inputarea fallback
      const monacoDom = doc.querySelector('.monaco-editor');
      if (monacoDom) {
        const textarea = monacoDom.querySelector('textarea.inputarea');
        if (textarea) {
          textarea.focus();
          doc.execCommand('selectAll', false, null);
          doc.execCommand('insertText', false, code);
          methodUsed = "monaco-exec-command";
          return true;
        }
      }

      // 3. Ace Editor (Programiz, OnlineGDB, HackerEarth)
      if (win.ace && win.ace.edit) {
        const aceNodes = doc.querySelectorAll('.ace_editor, #editor, [id*="editor"], .compiler-editor');
        for (const node of aceNodes) {
          try {
            const ed = win.ace.edit(node);
            if (ed && typeof ed.setValue === 'function') {
              ed.setValue(code, -1);
              ed.focus();
              methodUsed = "ace-api";
              return true;
            }
          } catch {}
        }
      }
      const aceEls = doc.querySelectorAll('.ace_editor');
      for (const aceEl of aceEls) {
        if (aceEl.env && aceEl.env.editor) {
          try {
            aceEl.env.editor.setValue(code, -1);
            methodUsed = "ace-env-editor";
            return true;
          } catch {}
        }
      }

      // 4. CodeMirror 5 (Programiz, W3Schools, etc.)
      const cmEls = doc.querySelectorAll('.CodeMirror');
      for (const cmEl of cmEls) {
        if (cmEl.CodeMirror && typeof cmEl.CodeMirror.setValue === 'function') {
          cmEl.CodeMirror.setValue(code);
          cmEl.CodeMirror.focus();
          methodUsed = "codemirror5-api";
          return true;
        }
      }

      // 5. CodeMirror 6 (.cm-content, .cm-editor)
      const cm6 = doc.querySelector('.cm-content');
      if (cm6) {
        cm6.focus();
        doc.execCommand('selectAll', false, null);
        doc.execCommand('insertText', false, code);
        methodUsed = "cm6-exec-command";
        return true;
      }

      // 6. Programiz compiler textarea or code input
      const progEditor = doc.querySelector('#code, #editor, textarea#code, .desktop-editor textarea');
      if (progEditor && progEditor.tagName === 'TEXTAREA') {
        progEditor.focus();
        progEditor.value = code;
        progEditor.dispatchEvent(new Event('input', { bubbles: true }));
        progEditor.dispatchEvent(new Event('change', { bubbles: true }));
        methodUsed = "programiz-textarea";
        return true;
      }

      // 7. General textareas / HTML inputs
      const textareas = Array.from(doc.querySelectorAll('textarea'));
      const target = textareas.find(t => /code|source|editor|program|solution/i.test(t.id + ' ' + t.name + ' ' + t.className)) || textareas[0];
      if (target) {
        target.focus();
        target.value = code;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        methodUsed = "textarea-native";
        return true;
      }

      // 8. ContentEditable
      const ce = doc.querySelector('[contenteditable="true"]');
      if (ce) {
        ce.focus();
        ce.innerText = code;
        ce.dispatchEvent(new Event('input', { bubbles: true }));
        ce.dispatchEvent(new Event('change', { bubbles: true }));
        methodUsed = "contenteditable";
        return true;
      }
    } catch (e) {
      // Continue to next probe
    }

    return false;
  }

  try {
    // Probe 1: Top-level document
    injected = tryInjectInDoc(window, document);

    // Probe 2: Traverse iframes (Programiz, OnlineGDB, etc.)
    if (!injected) {
      const iframes = Array.from(document.querySelectorAll('iframe'));
      for (const ifr of iframes) {
        try {
          const iWin = ifr.contentWindow;
          const iDoc = ifr.contentDocument || iWin?.document;
          if (iDoc && tryInjectInDoc(iWin || window, iDoc)) {
            injected = true;
            methodUsed += " (nested iframe)";
            break;
          }
        } catch {}
      }
    }

    // Probe 3: Clipboard bridge fallback
    if (!injected && navigator.clipboard) {
      navigator.clipboard.writeText(code).catch(() => {});
      methodUsed = "clipboard-bridge";
      injected = true;
    }

    return {
      success: injected,
      methodUsed: methodUsed || "none",
      codeLength: code.length,
      message: injected
        ? (methodUsed === "clipboard-bridge"
            ? "Code copied to clipboard! (Ready to paste Ctrl+V)"
            : "Code successfully implanted into platform editor (" + methodUsed + ")!")
        : "No supported code editor found on active page.",
    };
  } catch (err) {
    return {
      success: false,
      methodUsed,
      error: err instanceof Error ? err.message : String(err),
      message: "Injection encountered script error.",
    };
  }
})()
`;
      const result = await Promise.race([
        contents.executeJavaScript(script, true),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Code injection timed out")), 4500)),
      ]);
      return result;
    } catch (err) {
      return {
        success: false,
        message: "Code injection timed out or tab unavailable. Code preserved in clipboard.",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle("tab:run-code", async (_event, windowId: number, tabId: string) => {
    try {
      const targetTabId = tabId || windowActiveTabs.get(windowId);
      if (!targetTabId) {
        return { clicked: false, message: "No active tab selected." };
      }
      const view = browserViews.get(targetTabId);
      const contents = view?.webContents;
      if (!contents || contents.isDestroyed()) {
        return { clicked: false, message: "Tab webContents unavailable." };
      }

      const script = `
(function() {
  function tryClickRunInDoc(doc) {
    if (!doc) return null;

    try {
      // 1. LeetCode Run Button
      const leetRun = doc.querySelector('[data-e2e-locator="console-run-button"], [data-cy="run-code-btn"], button:has([data-icon="play"])');
      if (leetRun) {
        leetRun.click();
        return { clicked: true, target: "LeetCode Run" };
      }

      // 2. Programiz Run Button
      const progRun = doc.querySelector('#run-btn, .run-btn, .desktop-run-button, button[data-cy="run-button"], .run-code-button, button.compiler-run-btn');
      if (progRun) {
        progRun.click();
        return { clicked: true, target: "Programiz Run" };
      }

      // 3. OnlineGDB Run
      const gdbRun = doc.querySelector('#control-btn-run, #run-btn, button[title*="Run"]');
      if (gdbRun) {
        gdbRun.click();
        return { clicked: true, target: "OnlineGDB Run" };
      }

      // 4. W3Schools Run
      const w3Run = doc.querySelector('#runbtn, .w3-button[onclick*="submit"]');
      if (w3Run) {
        w3Run.click();
        return { clicked: true, target: "W3Schools Run" };
      }

      // 5. HackerRank Run
      const hrRun = doc.querySelector('.hr-monaco-compile-btn, button[data-analytics="CompileAndTest"]');
      if (hrRun) {
        hrRun.click();
        return { clicked: true, target: "HackerRank Run" };
      }

      // 6. GeeksforGeeks Run
      const gfgRun = doc.querySelector('.run-button, button[data-track-label="Run"]');
      if (gfgRun) {
        gfgRun.click();
        return { clicked: true, target: "GeeksforGeeks Run" };
      }

      // 7. Generic search for Run / Submit buttons
      const buttons = Array.from(doc.querySelectorAll('button, a.btn, input[type="button"], input[type="submit"], [role="button"]'));
      const candidate = buttons.find(b => {
        const text = (b.textContent || b.value || b.getAttribute('title') || b.getAttribute('aria-label') || "").trim().toLowerCase();
        return text === "run" || text === "run code" || text === "compile & run" || text === "execute" || text === "submit" || text === "submit solution" || text.startsWith("run ");
      });

      if (candidate) {
        candidate.click();
        return { clicked: true, target: (candidate.textContent || candidate.value || "Run Button").trim() };
      }
    } catch (e) {}

    return null;
  }

  try {
    // Check main doc
    let res = tryClickRunInDoc(document);
    if (res) return res;

    // Check iframes
    const iframes = Array.from(document.querySelectorAll('iframe'));
    for (const ifr of iframes) {
      try {
        const iDoc = ifr.contentDocument || ifr.contentWindow?.document;
        if (iDoc) {
          res = tryClickRunInDoc(iDoc);
          if (res) {
            res.target += " (iframe)";
            return res;
          }
        }
      } catch {}
    }

    return { clicked: false, message: "No platform Run button detected on active page." };
  } catch (err) {
    return { clicked: false, error: String(err) };
  }
})()
`;
      const result = await Promise.race([
        contents.executeJavaScript(script, true),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Run trigger timed out")), 4500)),
      ]);
      return result;
    } catch (err) {
      return {
        clicked: false,
        message: "Run trigger timed out or tab unavailable.",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle(
    "tab:execute-browser-action",
    async (_event, windowId: number, tabId: string, action: string, params: Record<string, unknown> = {}) => {
      try {
        const targetTabId = tabId || windowActiveTabs.get(windowId);
        if (!targetTabId) {
          return { success: false, error: "No active browser tab found for action." };
        }
        const view = browserViews.get(targetTabId);
        const contents = view?.webContents;
        if (!contents || contents.isDestroyed()) {
          return { success: false, error: "Tab webContents unavailable or destroyed." };
        }

        switch (action) {
          case "browser.navigate": {
            const rawUrl = String(params.url || "").trim();
            if (!rawUrl) return { success: false, error: "URL is required" };
            await contents.loadURL(rawUrl);
            return {
              success: true,
              result: {
                url: contents.getURL(),
                title: contents.getTitle(),
                status: 200,
              },
            };
          }

          case "browser.click": {
            const selector = String(params.selector || "").trim();
            const script = `
(function() {
  try {
    const sel = ${JSON.stringify(selector)};
    let el = document.querySelector(sel);
    if (!el) {
      const all = Array.from(document.querySelectorAll('button, a, input[type="submit"], input[type="button"], [role="button"], span, div'));
      el = all.find(e => (e.textContent || '').trim().toLowerCase() === sel.toLowerCase() || (e.getAttribute('aria-label') || '').toLowerCase() === sel.toLowerCase());
    }
    if (!el) {
      return { clicked: false, error: 'Element not found for selector: ' + sel };
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (typeof el.focus === 'function') el.focus();
    const clickEvt = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
    el.dispatchEvent(clickEvt);
    if (typeof el.click === 'function') el.click();
    return {
      clicked: true,
      selector: sel,
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().slice(0, 100),
      resultingUrl: window.location.href,
    };
  } catch (err) {
    return { clicked: false, error: String(err) };
  }
})()
`;
            const result = await contents.executeJavaScript(script, true);
            return { success: Boolean(result?.clicked), result, error: result?.error };
          }

          case "browser.type": {
            const selector = String(params.selector || "").trim();
            const text = String(params.text ?? "");
            const clear = params.clear !== false;
            const script = `
(function() {
  try {
    const sel = ${JSON.stringify(selector)};
    const val = ${JSON.stringify(text)};
    let el = document.querySelector(sel);
    if (!el) {
      const inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'));
      el = inputs.find(i => (i.name || '').toLowerCase() === sel.toLowerCase() || (i.placeholder || '').toLowerCase().includes(sel.toLowerCase()));
    }
    if (!el) {
      return { typed: false, error: 'Input element not found for selector: ' + sel };
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (typeof el.focus === 'function') el.focus();
    if (${clear} && 'value' in el) {
      el.value = '';
    }
    if ('value' in el) {
      el.value = val;
    } else if (el.isContentEditable) {
      el.innerText = val;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      typed: true,
      selector: sel,
      text: val,
      characters: val.length,
      currentValue: 'value' in el ? el.value : el.innerText,
    };
  } catch (err) {
    return { typed: false, error: String(err) };
  }
})()
`;
            const result = await contents.executeJavaScript(script, true);
            return { success: Boolean(result?.typed), result, error: result?.error };
          }

          case "browser.press": {
            const key = String(params.key || "Enter");
            const script = `
(function() {
  try {
    const key = ${JSON.stringify(key)};
    const active = document.activeElement || document.body;
    const evtDown = new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true });
    const evtUp = new KeyboardEvent('keyup', { key, code: key, bubbles: true, cancelable: true });
    active.dispatchEvent(evtDown);
    active.dispatchEvent(evtUp);
    return { pressed: true, key };
  } catch (err) {
    return { pressed: false, error: String(err) };
  }
})()
`;
            const result = await contents.executeJavaScript(script, true);
            return { success: true, result };
          }

          case "browser.scroll": {
            const direction = String(params.direction || "down");
            const pixels = Number(params.pixels || 800);
            const delta = direction === "up" ? -pixels : pixels;
            await contents.executeJavaScript(`window.scrollBy({ top: ${delta}, behavior: 'smooth' });`, true);
            return { success: true, result: { scrolled: true, direction, pixels } };
          }

          case "browser.hover": {
            const selector = String(params.selector || "").trim();
            const script = `
(function() {
  try {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (el) {
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      return { hovered: true, selector: ${JSON.stringify(selector)} };
    }
    return { hovered: false, error: 'Element not found' };
  } catch (err) {
    return { hovered: false, error: String(err) };
  }
})()
`;
            const result = await contents.executeJavaScript(script, true);
            return { success: Boolean(result?.hovered), result, error: result?.error };
          }

          case "browser.wait": {
            const ms = Math.min(Number(params.ms || 1000), 5000);
            const selector = params.selector ? String(params.selector) : null;
            if (selector) {
              const script = `
(function() {
  return Boolean(document.querySelector(${JSON.stringify(selector)}));
})()
`;
              const exists = await contents.executeJavaScript(script, true);
              if (!exists) {
                await new Promise((r) => setTimeout(r, ms));
              }
            } else {
              await new Promise((r) => setTimeout(r, ms));
            }
            return { success: true, result: { waitedMs: ms, selector } };
          }

          case "browser.findElement": {
            const selector = String(params.selector || "").trim();
            const script = `
(function() {
  try {
    const elements = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
    return {
      found: elements.length > 0,
      count: elements.length,
      selector: ${JSON.stringify(selector)},
      text: elements[0] ? (elements[0].textContent || '').trim().slice(0, 100) : '',
    };
  } catch (err) {
    return { found: false, count: 0, error: String(err) };
  }
})()
`;
            const result = await contents.executeJavaScript(script, true);
            return { success: Boolean(result?.found), result, error: result?.error };
          }

          case "browser.extract": {
            const script = `
(function() {
  try {
    const title = document.title || '';
    const url = window.location.href || '';
    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
      .map(h => (h.textContent || '').trim())
      .filter(t => t.length > 0)
      .slice(0, 15);
    const links = Array.from(document.querySelectorAll('a[href]'))
      .map(a => ({ text: (a.textContent || '').trim(), href: a.href }))
      .filter(l => l.text.length > 3 && l.href.startsWith('http'))
      .slice(0, 15);
    const textSnippet = (document.body ? document.body.innerText || '' : '')
      .replace(/\\s+/g, ' ')
      .trim()
      .slice(0, 2500);
    return {
      title,
      url,
      headings,
      links,
      snippet: textSnippet,
      contentLength: textSnippet.length,
    };
  } catch (err) {
    return { error: String(err) };
  }
})()
`;
            const result = await contents.executeJavaScript(script, true);
            return { success: true, result: { ...result, url: contents.getURL(), title: contents.getTitle() } };
          }

          case "browser.getCurrentPage": {
            return {
              success: true,
              result: {
                url: contents.getURL(),
                title: contents.getTitle(),
                isLoading: contents.isLoading(),
              },
            };
          }

          case "browser.back": {
            if (contents.canGoBack()) contents.goBack();
            return { success: true, result: { url: contents.getURL() } };
          }

          case "browser.forward": {
            if (contents.canGoForward()) contents.goForward();
            return { success: true, result: { url: contents.getURL() } };
          }

          case "browser.reload": {
            contents.reload();
            return { success: true, result: { url: contents.getURL() } };
          }

          default:
            return { success: false, error: `Unknown browser action: ${action}` };
        }
      } catch (err: any) {
        return { success: false, error: err.message || String(err) };
      }
    }
  );

  ipcMain.handle(
    "tab:set-custom-bounds",
    (_event, windowId: number, tabId: string, bounds: { x: number; y: number; width: number; height: number }) => {
      try {
        const targetTabId = tabId || windowActiveTabs.get(windowId);
        if (!targetTabId) return;
        const view = browserViews.get(targetTabId);
        if (view && bounds && bounds.width > 0 && bounds.height > 0) {
          view.setBounds({
            x: Math.round(bounds.x),
            y: Math.round(bounds.y),
            width: Math.round(bounds.width),
            height: Math.round(bounds.height),
          });
        }
      } catch (err) {
        console.warn("tab:set-custom-bounds error:", err);
      }
    }
  );

  ipcMain.handle("tab:update-bounds", (event, windowId: number, sidebarWidth: number, urlBarHeight: number, rightPanelWidth?: number) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const targetWindow =
      senderWindow && !senderWindow.isDestroyed()
        ? senderWindow
        : findWindow(windowId);
    if (!targetWindow) {
      return;
    }

    windowSidebarWidths.set(targetWindow.id, sidebarWidth);
    windowUrlBarHeights.set(targetWindow.id, urlBarHeight);
    updateBrowserViewBounds(targetWindow, rightPanelWidth);
  });

  ipcMain.handle("tab:capture-page", async (event, windowId: number, tabId?: string) => {
    try {
      const senderWindow = BrowserWindow.fromWebContents(event.sender);
      const targetWindow = senderWindow && !senderWindow.isDestroyed() ? senderWindow : findWindow(windowId);
      const resolvedWinId = targetWindow?.id ?? windowId;
      const targetTabId = tabId || windowActiveTabs.get(resolvedWinId) || (windowActiveTabs.get(windowId));
      let capturedImage = null;
      let title = "";
      let url = "";

      if (targetTabId) {
        const view = browserViews.get(targetTabId);
        const contents = view?.webContents;
        if (contents && !contents.isDestroyed()) {
          title = contents.getTitle();
          url = contents.getURL();
          try {
            const img = await contents.capturePage();
            if (!img.isEmpty()) {
              capturedImage = img;
            }
          } catch (e) {
            console.warn("[ipc] tab capturePage error:", e);
          }
        }
      }

      // Fallback: If active tab webContents was not available or empty (e.g. internal start page), capture window
      if (!capturedImage && targetWindow && !targetWindow.isDestroyed()) {
        try {
          const winImg = await targetWindow.capturePage();
          if (!winImg.isEmpty()) {
            capturedImage = winImg;
            if (!title) title = targetWindow.getTitle();
          }
        } catch (e) {
          console.warn("[ipc] window capturePage error:", e);
        }
      }

      if (!capturedImage || capturedImage.isEmpty()) {
        return { success: false, error: "Failed to capture visual snapshot from active tab." };
      }

      const size = capturedImage.getSize();
      return {
        success: true,
        dataUrl: capturedImage.toDataURL(),
        width: size.width,
        height: size.height,
        title,
        url,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle("tab:get-page-telemetry", async (_event, windowId: number, tabId?: string) => {
    try {
      const targetTabId = tabId || windowActiveTabs.get(windowId);
      if (!targetTabId) {
        return { success: false, error: "No active tab found" };
      }
      const view = browserViews.get(targetTabId);
      const contents = view?.webContents;
      if (!contents || contents.isDestroyed()) {
        return { success: false, error: "Tab webContents unavailable" };
      }

      const script = `
(function() {
  try {
    const url = window.location.href || "";
    const title = document.title || "";
    const isHttps = url.startsWith("https://");

    // Real text extraction
    const bodyText = (document.body ? (document.body.innerText || "") : "");
    const words = bodyText.trim().split(/\\s+/).filter(Boolean);
    const wordCount = words.length;

    // Real Headings
    const headingEls = Array.from(document.querySelectorAll("h1, h2, h3"));
    const headings = headingEls
      .map(h => (h.textContent || "").trim())
      .filter(t => t.length > 0 && t.length < 150)
      .slice(0, 10);

    // Real Links & Images
    const linksCount = document.querySelectorAll("a[href]").length;
    const imagesCount = document.querySelectorAll("img").length;

    // Real Meta & OpenGraph
    const getMeta = (name) => {
      const el = document.querySelector('meta[name="' + name + '"], meta[property="' + name + '"]');
      return el ? (el.getAttribute("content") || "").trim() : "";
    };
    const metaDescription = getMeta("description") || getMeta("og:description") || "";
    const ogImage = getMeta("og:image");

    // Real Dimensions
    const dimensions = {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollHeight: document.documentElement ? document.documentElement.scrollHeight : (document.body ? document.body.scrollHeight : 0),
      devicePixelRatio: window.devicePixelRatio || 1,
    };

    // Performance
    let loadTimeMs = 0;
    let domContentLoadedMs = 0;
    try {
      const nav = performance.getEntriesByType("navigation")[0];
      if (nav) {
        loadTimeMs = Math.round(nav.loadEventEnd || nav.responseEnd || 0);
        domContentLoadedMs = Math.round(nav.domContentLoadedEventEnd || 0);
      } else if (performance.timing) {
        loadTimeMs = Math.max(0, performance.timing.loadEventEnd - performance.timing.navigationStart);
        domContentLoadedMs = Math.max(0, performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart);
      }
    } catch {}

    // Excerpt snippet
    const snippet = (metaDescription || bodyText.replace(/\\s+/g, " ").trim()).slice(0, 500);

    return {
      success: true,
      url,
      title,
      wordCount,
      readingTimeMin: Math.max(1, Math.ceil(wordCount / 200)),
      headings,
      linksCount,
      imagesCount,
      metaDescription,
      ogImage,
      security: {
        isHttps,
        protocol: window.location.protocol.replace(":", "").toUpperCase(),
      },
      dimensions,
      performance: {
        loadTimeMs,
        domContentLoadedMs,
      },
      snippet,
    };
  } catch (e) {
    return {
      success: false,
      error: String(e),
      url: window.location.href,
      title: document.title,
      wordCount: 0,
      readingTimeMin: 1,
      headings: [],
      linksCount: 0,
      imagesCount: 0,
      metaDescription: "",
      security: { isHttps: window.location.protocol === "https:", protocol: "HTTP" },
      dimensions: { innerWidth: window.innerWidth, innerHeight: window.innerHeight, scrollHeight: 0, devicePixelRatio: 1 },
      performance: { loadTimeMs: 0, domContentLoadedMs: 0 },
      snippet: "",
    };
  }
})()
`;
      const result = await contents.executeJavaScript(script, true);
      return result;
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("page-search:find", (event, input: PageSearchFindInput) => {
    const tabId = typeof input?.tabId === "string" ? input.tabId.trim() : "";
    if (!tabId) {
      throw new Error("Tab id is required.");
    }

    const senderWindow = resolveSenderWindow(event.sender);
    const targetWindow = senderWindow && !senderWindow.isDestroyed()
      ? senderWindow
      : resolveSearchHostWindow(event.sender, tabId);
    if (!targetWindow) {
      throw new Error("Window not found.");
    }

    requireWindowTab(targetWindow.id, tabId);

    const view = browserViews.get(tabId);
    const contents = view?.webContents;
    if (!contents || contents.isDestroyed()) {
      throw new Error("Tab webContents not found.");
    }

    ensurePageSearchTracking(targetWindow, tabId, contents);

    const query = typeof input?.query === "string" ? input.query : "";
    const overlayState = getPageSearchOverlayState();
    if (overlayState.tabId && overlayState.tabId !== tabId) {
      const previousView = browserViews.get(overlayState.tabId);
      if (previousView && !previousView.webContents.isDestroyed()) {
        previousView.webContents.stopFindInPage("clearSelection");
      }
      pageSearchSessionsByTabId.delete(overlayState.tabId);
    }

    updatePageSearchOverlayState({
      visible: getPageSearchOverlayState().visible,
      windowId: targetWindow.id,
      tabId,
      query,
      result: null,
    });

    if (!query) {
      view.webContents.stopFindInPage("clearSelection");
      clearPageSearchSession(tabId, {
        notifyWindow: targetWindow,
        query: "",
      });
      return;
    }

    const requestId = view.webContents.findInPage(query, {
      findNext: input.findNext ?? true,
      forward: input.forward ?? true,
    });

    pageSearchSessionsByTabId.set(tabId, {
      query,
      requestId,
      windowId: targetWindow.id,
    });
  });

  ipcMain.handle(
    "page-search:stop",
    (
      event,
      tabId: string,
      action: "clearSelection" | "keepSelection" | "activateSelection" = "clearSelection",
    ) => {
      const normalizedTabId = typeof tabId === "string" ? tabId.trim() : "";
      if (!normalizedTabId) {
        return;
      }

      const senderWindow = resolveSenderWindow(event.sender);
      const targetWindow = senderWindow && !senderWindow.isDestroyed()
        ? senderWindow
        : resolveSearchHostWindow(event.sender, normalizedTabId);
      if (!targetWindow || !hasWindowTab(targetWindow.id, normalizedTabId)) {
        pageSearchSessionsByTabId.delete(normalizedTabId);
        return;
      }

      const view = browserViews.get(normalizedTabId);
      const contents = view?.webContents;
      if (contents && !contents.isDestroyed()) {
        contents.stopFindInPage(action);
      }

      pageSearchSessionsByTabId.delete(normalizedTabId);
      const overlayState = getPageSearchOverlayState();
      if (overlayState.tabId === normalizedTabId) {
        updatePageSearchOverlayState({
          result: action === "clearSelection"
            ? buildClearedPageSearchResult(normalizedTabId, overlayState.query)
            : overlayState.result,
        });
        broadcastPageSearchOverlayState();
      }
    },
  );

  ipcMain.handle("page-search-overlay:get-state", () => {
    const overlayState = getPageSearchOverlayState();
    return {
      visible: overlayState.visible,
      tabId: overlayState.tabId,
      query: overlayState.query,
      result: overlayState.result,
      focusInput: false,
    };
  });

  ipcMain.handle("page-search-overlay:close", (event) => {
    const senderWindow = resolveSenderWindow(event.sender);
    const overlayState = getPageSearchOverlayState();
    if (overlayState.tabId) {
      pageSearchSessionsByTabId.delete(overlayState.tabId);
    }
    const targetWindow = senderWindow && !senderWindow.isDestroyed()
      ? senderWindow
      : (overlayState.windowId !== null ? findWindow(overlayState.windowId) : null);
    closePageSearchOverlay(targetWindow);
  });

  ipcMain.handle("tab:set-sidebar-drag-state", (event, windowId: number, tabId?: string | null) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const targetWindow =
      senderWindow && !senderWindow.isDestroyed()
        ? senderWindow
        : findWindow(windowId);
    if (!targetWindow) {
      return;
    }

    handleTabSetSidebarDragState(targetWindow, typeof tabId === "string" ? tabId : null);
  });

  ipcMain.on("tab:view-interaction", (event) => {
    handleTabViewInteraction(event.sender);
  });

  ipcMain.on("tab:document-title-changed", (event, payload: { title?: unknown }) => {
    handleTabDocumentTitleChanged(
      event.sender,
      typeof payload?.title === "string" ? payload.title : "",
    );
  });

  ipcMain.on("tab:view-history-navigation", (event, payload: TabViewHistoryNavigationPayload) => {
    const direction = payload?.direction;
    if (direction !== "back" && direction !== "forward") {
      return;
    }

    void navigateSenderTabHistory(event.sender, direction).catch((error) => {
      console.warn(`[IPC] Failed to navigate tab history from mouse input (${direction}).`, error);
    });
  });

  ipcMain.on("tab:view-scroll", (event, payload: TabScrollSyncPayload) => {
    handleTabViewScroll(event.sender, payload);
  });

  ipcMain.on(
    "tab:split-drag-preview",
    (event, payload: SplitViewDragPreviewPayload & { tabId?: unknown }) => {
      handleTabSplitDragPreview(event.sender, payload);
    },
  );

  ipcMain.on("tab:split-drag-leave", (event) => {
    handleTabSplitDragLeave(event.sender);
  });

  ipcMain.on(
    "tab:split-drag-drop",
    (event, payload: SplitViewDragPreviewPayload & { tabId?: unknown }) => {
      handleTabSplitDragDrop(event.sender, payload);
    },
  );

  ipcMain.on("link-preview:hover", (event, payload: LinkPreviewHoverPayload) => {
    handleLinkPreviewHover(event.sender, payload);
  });

  ipcMain.on("link-preview:hover-leave", (event) => {
    handleLinkPreviewHoverLeave(event.sender);
  });

  ipcMain.on("link-preview:pointer-state", (event, isPointerInside: boolean) => {
    handleLinkPreviewPointerState(event.sender, Boolean(isPointerInside));
  });

  ipcMain.on("link-preview:close", (event) => {
    handleLinkPreviewClose(event.sender);
  });

  ipcMain.on("link-preview:maximize", (event) => {
    handleLinkPreviewMaximize(event.sender);
  });

  ipcMain.handle("link-preview:copy-url", (_event, value: string) => {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) {
      return false;
    }

    try {
      clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("bookmarks:list", (event) => {
    return getBookmarks(resolveSenderProfileId(event.sender));
  });

  ipcMain.handle("bookmarks:get-state", (event) => {
    const profileId = resolveSenderProfileId(event.sender);
    return {
      bookmarks: getBookmarks(profileId),
      folders: getBookmarkFolders(profileId),
    };
  });

  ipcMain.handle("bookmarks:folders:list", (event) => {
    return getBookmarkFolders(resolveSenderProfileId(event.sender));
  });

  function normalizeBookmarkInput(rawTitle: string, rawUrl: string) {
    const url = resolveInputToUrl(rawUrl.trim(), resolveInputToUrlOptions);
    const title = rawTitle.trim() || inferTitleFromUrl(url, startPageUrlOptions);
    return { title, url };
  }

  function normalizeBookmarkFolderId(
    inputFolderId: string | null | undefined,
    folders: BookmarkFolderRecord[],
  ) {
    if (!inputFolderId) {
      return null;
    }

    const folderId = inputFolderId.trim();
    if (!folderId) {
      return null;
    }

    const folderExists = folders.some((folder) => folder.id === folderId);
    if (!folderExists) {
      throw new Error("Bookmark folder does not exist.");
    }

    return folderId;
  }

  function normalizeBookmarkFolderName(name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("Folder name is required.");
    }
    return trimmed;
  }

  function collectDescendantFolderIds(
    folders: BookmarkFolderRecord[],
    rootFolderId: string,
  ) {
    const descendants = new Set<string>();
    const queue = [rootFolderId];

    while (queue.length > 0) {
      const folderId = queue.shift();
      if (!folderId || descendants.has(folderId)) {
        continue;
      }
      descendants.add(folderId);

      for (const folder of folders) {
        if ((folder.parentId ?? null) === folderId) {
          queue.push(folder.id);
        }
      }
    }

    return descendants;
  }

  function persistBookmarkCollections(
    profileId: string,
    nextBookmarks: BookmarkRecord[],
    nextFolders: BookmarkFolderRecord[],
  ) {
    setBookmarks(profileId, nextBookmarks);
    setBookmarkFolders(profileId, nextFolders);
    saveBookmarks();
    notifyBookmarksChanged();
    return {
      bookmarks: nextBookmarks,
      folders: nextFolders,
    };
  }

  ipcMain.handle(
    "bookmarks:add",
    (
      event,
      title: string,
      url: string,
      favicon?: string,
      folderId?: string | null,
    ) => {
      const profileId = resolveSenderProfileId(event.sender);
      const normalized = normalizeBookmarkInput(title, url);
      const currentBookmarks = getBookmarks(profileId);
      const currentFolders = getBookmarkFolders(profileId);
      const normalizedFolderId = normalizeBookmarkFolderId(folderId, currentFolders);

      if (currentBookmarks.some((bookmark) => bookmark.url === normalized.url)) {
        return currentBookmarks;
      }

      const bookmark: BookmarkRecord = {
        id: randomUUID(),
        title: normalized.title,
        url: normalized.url,
        favicon,
        folderId: normalizedFolderId,
        createdAt: Date.now(),
      };

      return persistBookmarkCollections(
        profileId,
        [...currentBookmarks, bookmark],
        currentFolders,
      ).bookmarks;
    },
  );

  ipcMain.handle("bookmarks:remove", (event, id: string) => {
    const profileId = resolveSenderProfileId(event.sender);
    const currentBookmarks = getBookmarks(profileId);
    const currentFolders = getBookmarkFolders(profileId);
    const nextBookmarks = currentBookmarks.filter((bookmark) => bookmark.id !== id);
    if (nextBookmarks.length === currentBookmarks.length) {
      return currentBookmarks;
    }
    return persistBookmarkCollections(profileId, nextBookmarks, currentFolders).bookmarks;
  });

  ipcMain.handle(
    "bookmarks:update",
    (
      event,
      id: string,
      input: { title: string; url: string; favicon?: string; folderId?: string | null },
    ) => {
      const profileId = resolveSenderProfileId(event.sender);
      const currentBookmarks = getBookmarks(profileId);
      const currentFolders = getBookmarkFolders(profileId);
      const normalized = normalizeBookmarkInput(input.title, input.url);
      const normalizedFolderId = normalizeBookmarkFolderId(input.folderId, currentFolders);

      if (currentBookmarks.some((bookmark) => bookmark.id !== id && bookmark.url === normalized.url)) {
        throw new Error("Bookmark URL already exists.");
      }

      let found = false;
      const nextBookmarks = currentBookmarks.map((bookmark) => {
        if (bookmark.id !== id) {
          return bookmark;
        }

        found = true;
        return {
          ...bookmark,
          title: normalized.title,
          url: normalized.url,
          favicon: input.favicon ?? bookmark.favicon,
          folderId: normalizedFolderId,
        };
      });

      if (!found) {
        throw new Error("Bookmark not found.");
      }

      return persistBookmarkCollections(profileId, nextBookmarks, currentFolders).bookmarks;
    },
  );

  ipcMain.handle(
    "bookmarks:update-favicons",
    (
      event,
      updates: Array<{ id: string; favicon: string }>,
    ) => {
      const profileId = resolveSenderProfileId(event.sender);
      const currentBookmarks = getBookmarks(profileId);
      const currentFolders = getBookmarkFolders(profileId);
      if (!Array.isArray(updates) || updates.length === 0) {
        return currentBookmarks;
      }

      const faviconById = new Map<string, string>();
      for (const entry of updates) {
        if (!entry || typeof entry !== "object") {
          continue;
        }

        const id = typeof entry.id === "string" ? entry.id.trim() : "";
        const favicon = typeof entry.favicon === "string" ? entry.favicon.trim() : "";
        if (!id || !favicon) {
          continue;
        }

        faviconById.set(id, favicon);
      }

      if (faviconById.size === 0) {
        return currentBookmarks;
      }

      let changed = false;
      const nextBookmarks = currentBookmarks.map((bookmark) => {
        const favicon = faviconById.get(bookmark.id);
        if (!favicon || bookmark.favicon === favicon) {
          return bookmark;
        }

        changed = true;
        return {
          ...bookmark,
          favicon,
        };
      });

      if (!changed) {
        return currentBookmarks;
      }

      return persistBookmarkCollections(profileId, nextBookmarks, currentFolders).bookmarks;
    },
  );

  ipcMain.handle("bookmarks:clear", (event) => {
    const profileId = resolveSenderProfileId(event.sender);
    const currentBookmarks = getBookmarks(profileId);
    const currentFolders = getBookmarkFolders(profileId);
    if (currentBookmarks.length === 0 && currentFolders.length === 0) {
      return currentBookmarks;
    }
    return persistBookmarkCollections(profileId, [], []).bookmarks;
  });

  ipcMain.handle("bookmarks:import-sources:list", () => {
    return listBookmarkImportSources();
  });

  ipcMain.handle("bookmarks:import-source", (event, sourceId: string) => {
    const profileId = resolveSenderProfileId(event.sender);
    const currentBookmarks = getBookmarks(profileId);
    const currentFolders = getBookmarkFolders(profileId);
    const result = importBookmarksFromSource(sourceId, currentBookmarks, currentFolders);
    persistBookmarkCollections(profileId, result.bookmarks, result.folders);
    return result;
  });

  ipcMain.handle("bookmarks:import-file", async (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions: OpenDialogOptions = {
      title: "Import Bookmarks",
      properties: ["openFile"],
      filters: [
        {
          name: "Bookmarks",
          extensions: ["html", "htm", "json"],
        },
      ],
    };
    const selection = senderWindow && !senderWindow.isDestroyed()
      ? await dialog.showOpenDialog(senderWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (selection.canceled || selection.filePaths.length === 0) {
      return null;
    }

    const profileId = resolveSenderProfileId(event.sender);
    const currentBookmarks = getBookmarks(profileId);
    const currentFolders = getBookmarkFolders(profileId);
    const result = importBookmarksFromFile(
      selection.filePaths[0],
      currentBookmarks,
      currentFolders,
    );
    persistBookmarkCollections(profileId, result.bookmarks, result.folders);
    return result;
  });

  ipcMain.handle(
    "bookmarks:folders:create",
    (event, name: string, parentId?: string | null) => {
      const profileId = resolveSenderProfileId(event.sender);
      const currentBookmarks = getBookmarks(profileId);
      const currentFolders = getBookmarkFolders(profileId);
      const normalizedName = normalizeBookmarkFolderName(name);
      const normalizedParentId = normalizeBookmarkFolderId(parentId, currentFolders);

      const nextFolders: BookmarkFolderRecord[] = [
        ...currentFolders,
        {
          id: randomUUID(),
          name: normalizedName,
          parentId: normalizedParentId,
          createdAt: Date.now(),
        },
      ];

      return persistBookmarkCollections(profileId, currentBookmarks, nextFolders);
    },
  );

  ipcMain.handle(
    "bookmarks:folders:update",
    (
      event,
      id: string,
      input: { name?: string; parentId?: string | null },
    ) => {
      const profileId = resolveSenderProfileId(event.sender);
      const currentBookmarks = getBookmarks(profileId);
      const currentFolders = getBookmarkFolders(profileId);
      const targetFolder = currentFolders.find((folder) => folder.id === id);
      if (!targetFolder) {
        throw new Error("Folder not found.");
      }

      const nextName = input.name === undefined
        ? targetFolder.name
        : normalizeBookmarkFolderName(input.name);
      const requestedParentId = input.parentId === undefined
        ? targetFolder.parentId ?? null
        : normalizeBookmarkFolderId(input.parentId, currentFolders);

      if (requestedParentId === id) {
        throw new Error("Folder cannot be its own parent.");
      }

      if (requestedParentId) {
        const descendantIds = collectDescendantFolderIds(currentFolders, id);
        if (descendantIds.has(requestedParentId)) {
          throw new Error("Folder cannot be moved into its descendant.");
        }
      }

      const nextFolders = currentFolders.map((folder) => {
        if (folder.id !== id) {
          return folder;
        }
        return {
          ...folder,
          name: nextName,
          parentId: requestedParentId,
        };
      });

      return persistBookmarkCollections(profileId, currentBookmarks, nextFolders);
    },
  );

  ipcMain.handle("bookmarks:folders:remove", (event, id: string) => {
    const profileId = resolveSenderProfileId(event.sender);
    const currentBookmarks = getBookmarks(profileId);
    const currentFolders = getBookmarkFolders(profileId);
    const folderExists = currentFolders.some((folder) => folder.id === id);
    if (!folderExists) {
      throw new Error("Folder not found.");
    }

    const descendantIds = collectDescendantFolderIds(currentFolders, id);
    const nextFolders = currentFolders.filter((folder) => !descendantIds.has(folder.id));
    const nextBookmarks = currentBookmarks.filter((bookmark) => {
      if (!bookmark.folderId) {
        return true;
      }
      return !descendantIds.has(bookmark.folderId);
    });

    return persistBookmarkCollections(profileId, nextBookmarks, nextFolders);
  });

  function isTrackableHistoryUrl(url: string) {
    if (!url) {
      return false;
    }

    try {
      const parsed = new URL(url);
      if (parsed.protocol === "milo:" || parsed.protocol === "data:" || parsed.protocol === "devtools:") {
        return false;
      }
      if (parsed.protocol === "about:" && parsed.pathname === "blank") {
        return false;
      }
      return true;
    } catch {
      return !/^about:blank$/i.test(url);
    }
  }

  function normalizeHistoryInput(rawTitle: string, rawUrl: string) {
    const url = resolveInputToUrl(rawUrl.trim(), resolveInputToUrlOptions);
    if (!isTrackableHistoryUrl(url)) {
      throw new Error("Internal pages cannot be stored in browsing history.");
    }

    const title = rawTitle.trim() || inferTitleFromUrl(url, startPageUrlOptions);
    return { title, url };
  }

  function persistHistoryRecords(profileId: string, nextRecords: HistoryRecord[]) {
    setHistoryRecords(profileId, nextRecords);
    saveHistoryRecords();
    notifyHistoryChanged();
    return nextRecords;
  }

  ipcMain.handle("history:list", (event) => {
    return getHistoryRecords(resolveSenderProfileId(event.sender));
  });

  ipcMain.handle("history:get-state", (event) => {
    return {
      records: getHistoryRecords(resolveSenderProfileId(event.sender)),
    };
  });

  ipcMain.handle("history:import-sources:list", () => {
    return listHistoryImportSources();
  });

  ipcMain.handle("history:import-source", (event, sourceId: string) => {
    const profileId = resolveSenderProfileId(event.sender);
    const result = importHistoryFromSource(sourceId, getHistoryRecords(profileId));
    persistHistoryRecords(profileId, result.records);
    return result;
  });

  ipcMain.handle(
    "history:update",
    (
      event,
      id: string,
      input: { title: string; url: string; favicon?: string },
    ) => {
      const profileId = resolveSenderProfileId(event.sender);
      const normalized = normalizeHistoryInput(input.title, input.url);
      const currentRecords = getHistoryRecords(profileId);

      if (currentRecords.some((record) => record.id !== id && record.url === normalized.url)) {
        throw new Error("History URL already exists.");
      }

      let found = false;
      const nextRecords = currentRecords.map((record) => {
        if (record.id !== id) {
          return record;
        }

        found = true;
        return {
          ...record,
          title: normalized.title,
          url: normalized.url,
          favicon: input.favicon ?? record.favicon,
          updatedAt: Date.now(),
        };
      });

      if (!found) {
        throw new Error("History record not found.");
      }

      return persistHistoryRecords(profileId, nextRecords);
    },
  );

  ipcMain.handle("history:remove", (event, id: string) => {
    const profileId = resolveSenderProfileId(event.sender);
    const currentRecords = getHistoryRecords(profileId);
    const nextRecords = currentRecords.filter((record) => record.id !== id);
    if (nextRecords.length === currentRecords.length) {
      return currentRecords;
    }
    return persistHistoryRecords(profileId, nextRecords);
  });

  ipcMain.handle("history:clear", (event) => {
    const profileId = resolveSenderProfileId(event.sender);
    const currentRecords = getHistoryRecords(profileId);
    if (currentRecords.length === 0) {
      return currentRecords;
    }
    return persistHistoryRecords(profileId, []);
  });

  ipcMain.handle("downloads:list", () => {
    return getDownloads();
  });

  ipcMain.handle("downloads:get-state", () => {
    return {
      records: getDownloads(),
    };
  });

  ipcMain.handle("downloads:create", (_event, input: DownloadCreateInput) => {
    return createDownload(input);
  });

  ipcMain.handle("downloads:pause", (_event, id: string) => {
    return pauseDownload(id);
  });

  ipcMain.handle("downloads:resume", (_event, id: string) => {
    return resumeDownload(id);
  });

  ipcMain.handle("downloads:cancel", (_event, id: string) => {
    return cancelDownload(id);
  });

  ipcMain.handle("downloads:retry", (_event, id: string) => {
    return retryDownload(id);
  });

  ipcMain.handle("downloads:remove", (_event, id: string, deleteFile?: boolean) => {
    return removeDownloadRecord(id, { deleteFile: Boolean(deleteFile) });
  });

  ipcMain.handle("downloads:delete-file", (_event, id: string) => {
    return deleteDownloadFile(id);
  });

  ipcMain.handle("downloads:show-in-folder", (_event, id: string) => {
    return showDownloadInFolder(id);
  });

  ipcMain.handle(
    "downloads:show-save-dialog",
    async (event, input?: { filename?: string }) => {
      const senderWindow = BrowserWindow.fromWebContents(event.sender);
      const normalizedFilename =
        typeof input?.filename === "string" && input.filename.trim()
          ? input.filename.trim()
          : "download";
      const dialogOptions = {
        defaultPath: path.join(app.getPath("downloads"), normalizedFilename),
      };
      const result = senderWindow
        ? await dialog.showSaveDialog(senderWindow, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions);

      if (result.canceled || !result.filePath) {
        return null;
      }

      return result.filePath;
    },
  );

  ipcMain.handle(
    "downloads:show-directory-dialog",
    async (event, input?: { defaultPath?: string }) => {
      const senderWindow = BrowserWindow.fromWebContents(event.sender);
      const dialogOptions: OpenDialogOptions = {
        defaultPath: typeof input?.defaultPath === "string" && input.defaultPath.trim()
          ? input.defaultPath.trim()
          : app.getPath("downloads"),
        properties: ["openDirectory", "createDirectory"],
      };
      const result = senderWindow
        ? await dialog.showOpenDialog(senderWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      return result.filePaths[0];
    },
  );

  ipcMain.handle("downloads:get-preferences", () => {
    return getDownloadPreferences();
  });

  ipcMain.handle(
    "downloads:set-preferences",
    (_event, input?: {
      defaultDirectory?: string | null;
      defaultThreadCount?: number;
      defaultHeadersText?: string;
    }) => {
      return setDownloadPreferences(input);
    },
  );

  ipcMain.handle("start-page:get-dock-items", (event) => {
    return getStartPageDockItems(resolveSenderWorkspaceId(event.sender));
  });

  ipcMain.handle("start-page:get-widgets", (event) => {
    return getStartPageWidgetsState(resolveSenderWorkspaceId(event.sender));
  });

  ipcMain.handle("start-page:get-widget-refreshes", (event) => {
    return getStartPageWidgetRefreshes(resolveSenderWorkspaceId(event.sender));
  });

  ipcMain.handle(
    "start-page:widget-automation-call",
    (event, input?: { input?: unknown; source?: string; tool?: string; widgetId?: string } | null) => {
      const workspaceId = resolveSenderWorkspaceId(event.sender);
      return runStartPageWidgetAutomationCall({
        input: input?.input,
        source: typeof input?.source === "string" ? input.source : "",
        tool: typeof input?.tool === "string" ? input.tool : "",
        widgetId: typeof input?.widgetId === "string" ? input.widgetId : "",
        workspaceId,
      });
    },
  );

  ipcMain.handle("start-page:get-appearance", (event) => {
    return getStartPageAppearance(resolveSenderWorkspaceId(event.sender));
  });

  ipcMain.handle("start-page:get-shell-layout", (event): StartPageShellLayout | null => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    if (!targetWindow || targetWindow.isDestroyed()) {
      return null;
    }

    const view = Array.from(browserViews.values()).find(
      (candidateView) => candidateView.webContents?.id === event.sender.id,
    );
    if (!view) {
      return null;
    }

    const shellBounds = targetWindow.getContentBounds();
    const viewBounds = view.getBounds();
    if (
      shellBounds.width <= 0
      || shellBounds.height <= 0
      || viewBounds.width <= 0
      || viewBounds.height <= 0
    ) {
      return null;
    }

    return {
      shellHeight: shellBounds.height,
      shellWidth: shellBounds.width,
      viewHeight: viewBounds.height,
      viewWidth: viewBounds.width,
      viewX: viewBounds.x,
      viewY: viewBounds.y,
    };
  });

  ipcMain.handle("start-page:set-appearance", (event, input?: Partial<StartPageAppearance> | null) => {
    const workspaceId = resolveSenderWorkspaceId(event.sender);
    const appearance = setStartPageAppearance(workspaceId, input);
    broadcastStartPageAppearanceChanged(workspaceId, appearance);
    return appearance;
  });

  ipcMain.handle("start-page:set-widgets", (event, input?: StartPageWidget[] | null) => {
    const workspaceId = resolveSenderWorkspaceId(event.sender);
    const state = setStartPageWidgets(workspaceId, input);
    syncStartPageWidgetRefreshTriggers(workspaceId);
    broadcastStartPageWidgetsChanged(workspaceId, state);
    return state;
  });

  ipcMain.handle("start-page:set-dock-item-favicon", (event, id: string, favicon: string) => {
    const workspaceId = resolveSenderWorkspaceId(event.sender);
    const items = setStartPageDockItemFavicon(workspaceId, id, favicon);
    broadcastStartPageDockChanged(workspaceId, items);
    return items;
  });

  ipcMain.handle("start-page:remove-dock-item", (event, id: string) => {
    const workspaceId = resolveSenderWorkspaceId(event.sender);
    const items = removeStartPageDockItem(workspaceId, id);
    broadcastStartPageDockChanged(workspaceId, items);
    return items;
  });

  ipcMain.handle("start-page:clear-dock-items", (event) => {
    const workspaceId = resolveSenderWorkspaceId(event.sender);
    const items = clearStartPageDockItems(workspaceId);
    broadcastStartPageDockChanged(workspaceId, items);
    return items;
  });

  ipcMain.handle("widget-registry:get-root-directory", () => {
    return widgetRegistryGetRootDirectory();
  });

  ipcMain.handle("widget-registry:list-packages", () => {
    return widgetRegistryListPackages();
  });

  ipcMain.handle("widget-registry:get-package", (_event, packageId: string) => {
    return widgetRegistryGetPackage(packageId);
  });

  ipcMain.handle("widget-registry:get-package-manifest", (_event, packageId: string) => {
    return widgetRegistryGetPackageManifest(packageId);
  });

  ipcMain.handle("widget-registry:pick-package-directory", async (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions: OpenDialogOptions = {
      title: "Install Widget Package",
      properties: ["openDirectory"],
    };
    const result = senderWindow && !senderWindow.isDestroyed()
      ? await dialog.showOpenDialog(senderWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0] ?? null;
  });

  ipcMain.handle("widget-registry:inspect-package-directory", (_event, directoryPath: string) => {
    return widgetRegistryInspectPackageDirectory(directoryPath);
  });

  ipcMain.handle("widget-registry:install-package-directory", (_event, directoryPath: string) => {
    return widgetRegistryInstallPackageFromDirectory(directoryPath);
  });

  ipcMain.handle("widget-registry:remove-package", (_event, packageId: string) => {
    return widgetRegistryRemovePackage(packageId);
  });

  ipcMain.handle("widget-registry:reveal-package", (_event, packageId: string) => {
    return widgetRegistryRevealPackage(packageId);
  });

  ipcMain.handle("widget-registry:create-starter-package", () => {
    return widgetRegistryCreateStarterPackage();
  });

  ipcMain.handle("widget-registry:reveal-root-directory", () => {
    return widgetRegistryRevealRootDirectory();
  });

  ipcMain.handle("extensions:list", (event) => {
    return listExtensions(resolveSenderProfileId(event.sender));
  });

  ipcMain.handle(
    "extensions:chrome-web-store:get-status",
    (event, input: string | ChromeWebStoreInstallRequest) => {
      return getChromeWebStoreInstallState(resolveSenderProfileId(event.sender), input);
    },
  );

  ipcMain.handle(
    "extensions:chrome-web-store:begin-install",
    async (event, input: ChromeWebStoreInstallRequest) => {
      const profileId = resolveSenderProfileId(event.sender);
      const currentState = getChromeWebStoreInstallState(profileId, input);
      if (currentState !== "installable") {
        return {
          accepted: false,
          state: currentState,
        };
      }

      const senderWindow = BrowserWindow.fromWebContents(event.sender);
      const prompt = buildChromeWebStoreInstallPrompt(input);
      const result = senderWindow && !senderWindow.isDestroyed()
        ? await dialog.showMessageBox(senderWindow, {
          type: "question",
          buttons: prompt.buttons,
          defaultId: 0,
          cancelId: 1,
          message: prompt.message,
          detail: prompt.detail,
        })
        : await dialog.showMessageBox({
          type: "question",
          buttons: prompt.buttons,
          defaultId: 0,
          cancelId: 1,
          message: prompt.message,
          detail: prompt.detail,
        });

      if (result.response !== 0) {
        return {
          accepted: false,
          state: getChromeWebStoreInstallState(profileId, input),
        };
      }

      return {
        accepted: true,
        state: beginChromeWebStoreInstall(profileId, input),
      };
    },
  );

  ipcMain.handle(
    "extensions:chrome-web-store:complete-install",
    async (event, extensionId: string) => {
      return completeChromeWebStoreInstall(resolveSenderProfileId(event.sender), extensionId);
    },
  );

  ipcMain.handle("extensions:pick-unpacked-directory", async (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions: OpenDialogOptions = {
      title: "Load Unpacked Extension",
      properties: ["openDirectory"],
    };
    const result = senderWindow && !senderWindow.isDestroyed()
      ? await dialog.showOpenDialog(senderWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle("extensions:install-from-store", async (event, input: string) => {
    return installExtensionFromStore(resolveSenderProfileId(event.sender), input);
  });

  ipcMain.handle("extensions:install-unpacked", async (event, extensionPath: string) => {
    return installUnpackedExtension(resolveSenderProfileId(event.sender), extensionPath);
  });

  ipcMain.handle(
    "extensions:set-enabled",
    async (event, extensionId: string, enabled: boolean) => {
      return setExtensionEnabled(resolveSenderProfileId(event.sender), extensionId, enabled);
    },
  );

  ipcMain.handle("extensions:remove", async (event, extensionId: string) => {
    await removeExtension(resolveSenderProfileId(event.sender), extensionId);
  });

  ipcMain.handle("extensions:reload", async (event, extensionId: string) => {
    return reloadExtension(resolveSenderProfileId(event.sender), extensionId);
  });

  ipcMain.handle("extensions:reveal", async (event, extensionId: string) => {
    return revealExtension(resolveSenderProfileId(event.sender), extensionId);
  });

  ipcMain.handle(
    "extensions:open-action-popup",
    async (
      event,
      extensionId: string,
      anchor?: Partial<ExtensionActionPopupAnchor> | null,
    ) => {
      return openExtensionActionPopup(
        resolveSenderProfileId(event.sender),
        extensionId,
        resolveSenderWindow(event.sender),
        anchor,
      );
    },
  );

  ipcMain.handle("extensions:show-toolbar-menu", (event, input?: ExtensionsToolbarMenuInput | null) => {
    const senderWindow = resolveSenderWindow(event.sender);
    if (!senderWindow || senderWindow.isDestroyed()) {
      throw new Error("Window not found.");
    }

    const profileId = resolveSenderProfileId(event.sender);
    const menuText = resolveExtensionsToolbarMenuLocale();
    const extensions = listExtensions(profileId)
      .filter((extension) => extension.profileId === profileId)
      .sort((left, right) => {
        const leftCanOpen = left.enabled && left.loaded && Boolean(left.action?.popupUrl);
        const rightCanOpen = right.enabled && right.loaded && Boolean(right.action?.popupUrl);
        if (leftCanOpen !== rightCanOpen) {
          return leftCanOpen ? -1 : 1;
        }

        if (left.enabled !== right.enabled) {
          return left.enabled ? -1 : 1;
        }

        return left.name.localeCompare(right.name);
      });
    const popupCapableCount = extensions.filter((extension) =>
      extension.enabled && extension.loaded && Boolean(extension.action?.popupUrl)
    ).length;

    const showErrorDialog = (error: unknown) => {
      void dialog.showMessageBox(senderWindow, {
        type: "error",
        message: menuText.openFailedTitle,
        detail: error instanceof Error ? error.message : String(error || "Unknown error"),
      });
    };

    const extensionItems: MenuItemConstructorOptions[] = extensions.map((extension) => {
      const canOpenPopup = extension.enabled && extension.loaded && Boolean(extension.action?.popupUrl);
      const status = !extension.enabled
        ? menuText.disabled
        : !extension.loaded
          ? menuText.notLoaded
          : !extension.action?.popupUrl
            ? menuText.noPopup
            : extension.action?.title || menuText.enabled;

      return {
        label: canOpenPopup ? extension.name : `${extension.name}  ·  ${status}`,
        enabled: canOpenPopup,
        toolTip: status,
        click: () => {
          void openExtensionActionPopup(
            profileId,
            extension.id,
            senderWindow,
            input?.anchor ?? null,
          ).catch(showErrorDialog);
        },
      } satisfies MenuItemConstructorOptions;
    });

    const template: MenuItemConstructorOptions[] = [
      {
        label: `${menuText.title}  ·  ${popupCapableCount} / ${extensions.length}`,
        enabled: false,
      },
      { type: "separator" },
      ...(extensionItems.length > 0
        ? extensionItems
        : [{ label: menuText.noExtensions, enabled: false } satisfies MenuItemConstructorOptions]),
    ];

    const anchor = input?.anchor;
    const popupX = typeof anchor?.left === "number"
      ? Math.max(0, Math.round(anchor.left))
      : undefined;
    const popupY = typeof anchor?.top === "number" && typeof anchor.height === "number"
      ? Math.max(0, Math.round(anchor.top + anchor.height + 6))
      : undefined;

    let resolve!: () => void;
    const result = new Promise<void>((nextResolve) => {
      resolve = nextResolve;
    });

    Menu.buildFromTemplate(template).popup({
      window: senderWindow,
      x: popupX,
      y: popupY,
      callback: () => {
        resolve();
      },
    });

    return result;
  });

  ipcMain.handle("user-scripts:list", (event) => {
    return listUserScripts(resolveSenderProfileId(event.sender));
  });

  ipcMain.handle("user-scripts:create", (event, input: UserScriptCreateInput) => {
    return createUserScript(resolveSenderProfileId(event.sender), input);
  });

  ipcMain.handle(
    "user-scripts:update",
    (event, scriptId: string, input: UserScriptUpdateInput) => {
      return updateUserScript(resolveSenderProfileId(event.sender), scriptId, input);
    },
  );

  ipcMain.handle("user-scripts:remove", (event, scriptId: string) => {
    removeUserScript(resolveSenderProfileId(event.sender), scriptId);
  });

  ipcMain.handle(
    "user-scripts:set-enabled",
    (event, scriptId: string, enabled: boolean) => {
      return setUserScriptEnabled(resolveSenderProfileId(event.sender), scriptId, enabled);
    },
  );

  ipcMain.handle("user-scripts:run-now", async (event, scriptId: string) => {
    return runUserScriptNow(
      resolveSenderProfileId(event.sender),
      resolveSenderUserScriptTargetContents(event.sender),
      scriptId,
    );
  });

  ipcMain.handle("user-scripts:run-test", async (event, scriptId: string) => {
    return runUserScriptTest(
      resolveSenderProfileId(event.sender),
      resolveSenderUserScriptTargetContents(event.sender),
      scriptId,
    );
  });

  ipcMain.handle(
    "user-scripts:agent-generate",
    async (_event, input: UserScriptAgentGenerateInput) => {
      return generateUserScriptDraft(input);
    },
  );

  ipcMain.handle("user-scripts:show-toolbar-popup", (event, input?: UserScriptsToolbarPopupInput | null) => {
    const senderWindow = resolveSenderWindow(event.sender);
    if (!senderWindow || senderWindow.isDestroyed()) {
      throw new Error("Window not found.");
    }

    const profileId = resolveSenderProfileId(event.sender);
    const menuText = resolveUserScriptsToolbarPopupLocale();
    const targetUrl = typeof input?.targetUrl === "string" && input.targetUrl.trim()
      ? input.targetUrl.trim()
      : resolveActiveTabUrlForWindow(senderWindow);
    const scripts = listUserScripts(profileId);
    const scriptEntries = scripts
      .map((script) => ({
        script,
        matchesCurrentUrl: userScriptMatchesTargetUrl(script, targetUrl),
      }))
      .sort((left, right) => {
        if (left.matchesCurrentUrl !== right.matchesCurrentUrl) {
          return left.matchesCurrentUrl ? -1 : 1;
        }

        if (left.script.enabled !== right.script.enabled) {
          return left.script.enabled ? -1 : 1;
        }

        return right.script.updatedAt - left.script.updatedAt;
      });
    const matchingCount = scriptEntries.filter((entry) => entry.matchesCurrentUrl).length;

    const showErrorDialog = (title: string, error: unknown) => {
      void dialog.showMessageBox(senderWindow, {
        type: "error",
        message: title,
        detail: error instanceof Error ? error.message : String(error || "Unknown error"),
      });
    };

    const runScriptNow = (script: UserScriptRecord) => {
      let targetContents: WebContents;
      try {
        targetContents = resolveSenderUserScriptTargetContents(event.sender);
      } catch (error) {
        showErrorDialog(menuText.runFailedTitle, error);
        return;
      }

      void runUserScriptNow(
        profileId,
        targetContents,
        script.id,
      )
        .then((result) => {
          if (!result.success) {
            showErrorDialog(menuText.runFailedTitle, result.error ?? "Unknown error");
          }
        })
        .catch((error) => {
          showErrorDialog(menuText.runFailedTitle, error);
        });
    };

    const deleteScript = (script: UserScriptRecord) => {
      void dialog.showMessageBox(senderWindow, {
        type: "warning",
        buttons: [menuText.deleteButton, menuText.cancelButton],
        defaultId: 1,
        cancelId: 1,
        message: menuText.deleteMessage,
        detail: script.name,
      })
        .then((result) => {
          if (result.response !== 0) {
            return;
          }

          removeUserScript(profileId, script.id);
        })
        .catch((error) => {
          showErrorDialog(menuText.deleteFailedTitle, error);
        });
    };

    const scriptItems: MenuItemConstructorOptions[] = scriptEntries.flatMap((entry) => {
      const { script, matchesCurrentUrl } = entry;
      const status = script.enabled ? menuText.enabled : menuText.disabled;
      const matchStatus = matchesCurrentUrl
        ? menuText.matchesCurrentPage
        : menuText.notMatchingCurrentPage;
      const label = `${script.name}  ·  ${status}  ·  ${matchStatus}`;

      return [
        {
          label,
          submenu: [
            {
              label: script.enabled ? menuText.disable : menuText.enable,
              click: () => {
                setUserScriptEnabled(profileId, script.id, !script.enabled);
              },
            },
            {
              label: menuText.runNow,
              enabled: matchesCurrentUrl && isUserScriptRunnableUrl(targetUrl),
              click: () => {
                runScriptNow(script);
              },
            },
            { type: "separator" },
            {
              label: menuText.edit,
              click: () => {
                openUserScriptsManagerTab(senderWindow, script.id);
              },
            },
            {
              label: menuText.delete,
              click: () => {
                deleteScript(script);
              },
            },
          ],
        } satisfies MenuItemConstructorOptions,
      ];
    });

    const template: MenuItemConstructorOptions[] = [
      {
        label: `${menuText.title}  ·  ${menuText.currentPage} ${matchingCount} / ${menuText.allScripts} ${scripts.length}`,
        enabled: false,
      },
      { type: "separator" },
      ...(scriptItems.length > 0
        ? scriptItems
        : [{ label: menuText.noScripts, enabled: false } satisfies MenuItemConstructorOptions]),
      { type: "separator" },
      {
        label: menuText.newScript,
        click: () => {
          openUserScriptsManagerTab(senderWindow);
        },
      },
      {
        label: menuText.openManager,
        click: () => {
          openUserScriptsManagerTab(senderWindow);
        },
      },
    ];

    const anchor = input?.anchor;
    const popupX = typeof anchor?.left === "number"
      ? Math.max(0, Math.round(anchor.left))
      : undefined;
    const popupY = typeof anchor?.top === "number" && typeof anchor.height === "number"
      ? Math.max(0, Math.round(anchor.top + anchor.height + 6))
      : undefined;

    let resolve!: () => void;
    const result = new Promise<void>((nextResolve) => {
      resolve = nextResolve;
    });

    Menu.buildFromTemplate(template).popup({
      window: senderWindow,
      x: popupX,
      y: popupY,
      callback: () => {
        resolve();
      },
    });

    return result;
  });

  ipcMain.handle("passkeys:create", async (event, input: PasskeyCreateRequest) => {
    return createPasskeyCredential(
      resolveSenderProfileId(event.sender),
      input,
      resolveSenderWindow(event.sender),
    );
  });

  ipcMain.handle("passkeys:get", async (event, input: PasskeyGetRequest) => {
    return getPasskeyAssertion(
      resolveSenderProfileId(event.sender),
      input,
      resolveSenderWindow(event.sender),
    );
  });

  function matchesSearchQuery(query: string, ...values: Array<string | null | undefined>) {
    if (!query) {
      return true;
    }

    return values.some((value) => typeof value === "string" && value.toLowerCase().includes(query));
  }

  function getSearchOverlayData(targetWindow: BrowserWindow, rawQuery?: string): SearchOverlayData {
    const windowId = targetWindow.id;
    const profileId = resolveProfileIdForWindow(targetWindow);
    const normalizedQuery = typeof rawQuery === "string" ? rawQuery.trim().toLowerCase() : "";
    const tabs = tabRecords.get(windowId);
    const tabsData = tabs ? Array.from(tabs.values()).map(serializeTabRecord) : [];
    const bookmarks = getBookmarks(profileId);
    const history = normalizedQuery
      ? getHistoryRecords(profileId)
        .filter((record) => matchesSearchQuery(normalizedQuery, record.title, record.url))
        .sort((left, right) => {
          if (right.lastVisitedAt !== left.lastVisitedAt) {
            return right.lastVisitedAt - left.lastVisitedAt;
          }
          return right.updatedAt - left.updatedAt;
        })
        .slice(0, SEARCH_HISTORY_MATCH_LIMIT)
      : [];

    return {
      tabs: normalizedQuery
        ? tabsData.filter((tab) => matchesSearchQuery(normalizedQuery, tab.title, tab.displayUrl))
        : tabsData,
      bookmarks: normalizedQuery
        ? bookmarks.filter((bookmark) => matchesSearchQuery(normalizedQuery, bookmark.title, bookmark.url))
        : bookmarks,
      history,
      activeTabId: windowActiveTabs.get(windowId) ?? "",
    };
  }

  ipcMain.handle("search:open", async (event) => {
    const targetWindow = resolveSearchHostWindow(event.sender);
    if (!targetWindow) return;

    const windowId = targetWindow.id;
    let { view: overlayView, visible: overlayVisible } = getSearchOverlayState();

    if (!overlayView) {
      overlayView = new WebContentsView({
        webPreferences: {
          preload: preloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
      });
      overlayView.setBackgroundColor("#00000000");
      setSearchOverlayState({ view: overlayView, visible: false });
      overlayVisible = false;
    }

    if (overlayVisible) {
      for (const windowRecord of BrowserWindow.getAllWindows()) {
        if (windowRecord.isDestroyed()) {
          continue;
        }
        try {
          windowRecord.contentView.removeChildView(overlayView);
        } catch {
          // Ignore when the overlay is not attached to this window.
        }
      }
      setSearchOverlayState({ view: overlayView, visible: false });
    }

    await new Promise<void>((resolve) => {
      const wc = overlayView.webContents;
      const onReady = () => {
        wc.removeListener("did-fail-load", onFail);
        resolve();
      };
      const onFail = () => {
        wc.removeListener("did-finish-load", onReady);
        resolve();
      };
      wc.once("did-finish-load", onReady);
      wc.once("did-fail-load", onFail);
      void wc.loadURL(MILO_SEARCH_URL);
    });

    overlayView.setBounds(getSearchOverlayBounds(windowId));

    targetWindow.contentView.addChildView(overlayView);
    setSearchOverlayState({ view: overlayView, visible: true });
    overlayView.webContents.focus();
  });

  ipcMain.handle("search:close", (event) => {
    const targetWindow = resolveSearchHostWindow(event.sender);
    if (!targetWindow) return;
    closeSearchOverlay(targetWindow);
  });

  ipcMain.handle("ai-sidebar:get-state", () => getAiSidebarOverlayState());

  ipcMain.handle("ai-sidebar:toggle", async (event) => {
    const targetWindow = resolveSenderWindow(event.sender);
    if (!targetWindow) {
      throw new Error("Window not found.");
    }
    return toggleAiSidebarOverlay(targetWindow);
  });

  ipcMain.handle(
    "ai-sidebar:close",
    (
      event,
      input?: {
        windowId?: number | null;
        tabId?: string | null;
      } | null,
    ) => {
      const targetWindow = typeof input?.windowId === "number"
        ? findWindow(input.windowId)
        : resolveSenderWindow(event.sender);
      return closeAiSidebarOverlay(targetWindow, { tabId: input?.tabId ?? null });
    },
  );

  ipcMain.handle("search:select-tab", (event, tabId: string) => {
    const targetWindow = resolveSearchHostWindow(event.sender, tabId);
    if (!targetWindow) return;
    closeSearchOverlay(targetWindow);
    handleTabSetActive(targetWindow, tabId);
  });

  ipcMain.handle("search:navigate-url", async (event, url: string) => {
    const targetWindow = resolveSearchHostWindow(event.sender);
    if (!targetWindow) return;

    const windowId = targetWindow.id;
    const activeTabId = windowActiveTabs.get(windowId);
    if (!activeTabId) return;

    closeSearchOverlay(targetWindow);

    const view = browserViews.get(activeTabId);
    const contents = view?.webContents;
    if (!contents || contents.isDestroyed()) {
      return;
    }

    const resolvedUrl = resolveInputToUrl(url, resolveInputToUrlOptions);
    await applyColorSchemeToContents(contents);
    void contents.loadURL(resolvedUrl);

    const tabs = tabRecords.get(windowId);
    const tab = tabs?.get(activeTabId);
    if (tab) {
      tab.hasLoaded = true;
      tab.isLoading = true;
      tab.url = resolvedUrl;
      tab.displayUrl = toDisplayUrl(resolvedUrl, displayUrlOptions);
      tab.title = inferTitleFromUrl(resolvedUrl, startPageUrlOptions);
      tab.canGoBack = false;
      tab.canGoForward = false;
      broadcastTabState(targetWindow);
    }
  });

  ipcMain.handle("search:remove-bookmark", (event, id: string) => {
    const targetWindow = resolveSearchHostWindow(event.sender);
    if (!targetWindow) {
      return [] as BookmarkRecord[];
    }

    const profileId = resolveProfileIdForWindow(targetWindow);
    const currentBookmarks = getBookmarks(profileId);
    const currentFolders = getBookmarkFolders(profileId);
    const nextBookmarks = currentBookmarks.filter((bookmark) => bookmark.id !== id);
    if (nextBookmarks.length === currentBookmarks.length) {
      return currentBookmarks;
    }
    return persistBookmarkCollections(profileId, nextBookmarks, currentFolders).bookmarks;
  });

  ipcMain.handle("search:get-overlay-data", (event) => {
    const targetWindow = resolveSearchHostWindow(event.sender);
    if (!targetWindow) {
      return {
        tabs: [] as WindowTabSummary[],
        bookmarks: [] as BookmarkRecord[],
        history: [] as HistoryRecord[],
        activeTabId: "",
      };
    }

    return getSearchOverlayData(targetWindow);
  });

  ipcMain.handle("search:query", (event, query?: string) => {
    const targetWindow = resolveSearchHostWindow(event.sender);
    if (!targetWindow) {
      return {
        tabs: [] as WindowTabSummary[],
        bookmarks: [] as BookmarkRecord[],
        history: [] as HistoryRecord[],
        activeTabId: "",
      };
    }

    return getSearchOverlayData(targetWindow, query);
  });

  ipcMain.handle("settings:get-theme", () => {
    return getTheme();
  });

  ipcMain.handle("settings:set-theme", async (_event, theme: string) => {
    await setTheme(theme);
    return theme;
  });

  ipcMain.handle("settings:get-language", () => {
    return getLanguage();
  });

  ipcMain.handle("settings:get-default-browser-status", () => {
    return getDefaultBrowserStatus();
  });

  ipcMain.handle("settings:set-language", (_event, language: string) => {
    setLanguage(language);
    return language;
  });

  ipcMain.handle("settings:set-default-browser", () => {
    return setAsDefaultBrowser();
  });

  ipcMain.handle("settings:export-all-data", async (event, input?: UserDataExportInput | null) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    return exportUserData(
      senderWindow && !senderWindow.isDestroyed() ? senderWindow : null,
      input ?? null,
    );
  });

  ipcMain.handle("translation:get-preferences", () => {
    return getTranslationPreferences();
  });

  ipcMain.handle("llm:get-providers", () => {
    return getLlmProviders();
  });

  ipcMain.handle("agent:get-preferences", () => {
    return getAgentPreferences();
  });

  ipcMain.handle("image-agent:get-preferences", () => {
    return getImageAgentPreferences();
  });

  ipcMain.handle("learning:get-preferences", () => {
    return getLearningPreferences();
  });

  ipcMain.handle(
    "llm:set-providers",
    (_event, input?: LlmProvider[] | null) => {
      return setLlmProviders(input);
    },
  );

  ipcMain.handle(
    "agent:set-preferences",
    (_event, input?: Partial<AgentPreferences> | null) => {
      return setAgentPreferences(input);
    },
  );

  ipcMain.handle(
    "image-agent:set-preferences",
    (_event, input?: Partial<AgentModelPreferences> | null) => {
      return setImageAgentPreferences(input);
    },
  );

  ipcMain.handle(
    "learning:set-preferences",
    (_event, input?: Partial<LearningPreferences> | null) => {
      return setLearningPreferences(input);
    },
  );

  ipcMain.handle("learning:clear-state", () => {
    return clearLearningState();
  });

  ipcMain.handle("learning:flush-now", () => {
    return flushLearningState();
  });

  ipcMain.handle("learning:delete-site", (_event, siteId: string) => {
    return deleteLearningSite(siteId);
  });

  ipcMain.handle("learning:delete-guidance", (_event, guidanceId: string) => {
    return deleteLearningGuidance(guidanceId);
  });

  ipcMain.handle("learning:delete-site-skill", (_event, skillId: string) => {
    return deleteLearningSiteSkill(skillId);
  });

  ipcMain.handle("learning:delete-history-site", (_event, domain: string) => {
    return deleteLearningHistorySite(domain);
  });

  ipcMain.handle("learning:delete-style-profile", (_event, profileId: string) => {
    return deleteLearningStyleProfile(profileId);
  });

  ipcMain.handle("learning:delete-preference-profile", (_event, profileId: string) => {
    return deleteLearningPreferenceProfile(profileId);
  });

  ipcMain.handle("learning:upsert-user-memory", (_event, input: LearningUserMemoryUpsertInput) => {
    return upsertLearningUserMemory(input);
  });

  ipcMain.handle("learning:delete-user-memory", (_event, input: LearningUserMemorySignalInput) => {
    return deleteLearningUserMemory(input);
  });

  ipcMain.handle("learning:reject-user-memory", (_event, input: LearningUserMemorySignalInput) => {
    return rejectLearningUserMemory(input);
  });

  ipcMain.handle("learning:get-summary", (_event, input?: LearningSummaryInput | null) => {
    return getLearningSummary(input ?? undefined);
  });

  ipcMain.handle("learning:get-catalog", () => {
    return getLearningCatalog();
  });

  ipcMain.handle("learning:resolve-input-assist-context", (_event, input: LearningInputAssistContextInput) => {
    return resolveLearningInputAssistContext(input);
  });

  ipcMain.handle("learning:generate-input-assist-text", (_event, input: LearningInputAssistActionInput) => {
    return generateLearningInputAssistText(input);
  });

  ipcMain.handle("context:get-page-state", (event, input: ContextPageObservation) => {
    const tabContext = resolveSenderTabContext(event.sender);
    return getContextPageState({
      ...input,
      ...(tabContext ? {
        workspaceId: tabContext.workspaceId,
        tabId: tabContext.tabId,
      } : {}),
    });
  });

  ipcMain.handle(
    "context:dismiss-opportunity",
    (_event, input?: {
      opportunityId?: string;
      kind?: ContextOpportunityKind;
      url?: string;
    } | null) => {
      return dismissContextOpportunity(input ?? {});
    },
  );

  ipcMain.handle(
    "context:accept-opportunity",
    async (
      event,
      input?: {
        opportunityId?: string;
        kind?: ContextOpportunityKind;
        url?: string;
        title?: string;
        prompt?: string;
      } | null,
    ) => {
      const tabContext = resolveSenderTabContext(event.sender);
      if (!tabContext) {
        throw new Error("Tab context not found.");
      }
      if (typeof agentCreateSession !== "function") {
        throw new Error("Agent runtime is not available yet.");
      }
      const content = typeof input?.prompt === "string" && input.prompt.trim()
        ? input.prompt.trim()
        : `Please inspect the current tab and help with: ${input?.kind ?? "this page"}.`;
      const snapshot = await agentCreateSession({
        workspaceId: tabContext.workspaceId,
        windowId: tabContext.windowId,
        scope: "current-tab",
        tabId: tabContext.tabId,
        content,
        privacyMode: false,
        profile: "default",
      });
      registerAgentSubscriber(event.sender, snapshot.sessionId);
      void openAiSidebarOverlay(tabContext.targetWindow).catch(() => undefined);
      void dismissContextOpportunity({
        opportunityId: input?.opportunityId,
        kind: input?.kind,
        url: input?.url,
      });
      return snapshot;
    },
  );

  ipcMain.handle(
    "translation:set-preferences",
    (_event, input?: Partial<TranslationPreferences> | null) => {
      return setTranslationPreferences(input);
    },
  );

  ipcMain.handle(
    "agent:ensure-session",
    (event, input: { workspaceId: string; windowId: number }) => {
      if (typeof agentEnsureSession !== "function") {
        throw new Error("Agent runtime is not available yet.");
      }
      const snapshot = agentEnsureSession(input);
      registerAgentSubscriber(event.sender, snapshot.sessionId);
      return snapshot;
    },
  );

  ipcMain.handle(
    "agent:list-sessions",
    (event, input: { workspaceId: string; windowId: number }) => {
      if (typeof agentListSessions !== "function") {
        throw new Error("Agent runtime is not available yet.");
      }
      const items = agentListSessions(input);
      registerAgentSubscribers(event.sender, items.map((item) => item.sessionId));
      return items;
    },
  );

  ipcMain.handle(
    "agent:create-session",
    async (
      event,
      input: {
        workspaceId: string;
        windowId: number;
        scope?: "default" | "current-tab";
        tabId?: string;
        content?: string;
        privacyMode?: boolean;
        profile?: "default" | "organizer" | "widget-builder";
      },
    ) => {
      if (typeof agentCreateSession !== "function") {
        throw new Error("Agent runtime is not available yet.");
      }
      const snapshot = await agentCreateSession(input);
      registerAgentSubscriber(event.sender, snapshot.sessionId);
      return snapshot;
    },
  );

  ipcMain.handle("agent:get-session", (event, sessionId: string) => {
    if (typeof agentGetSession !== "function") {
      throw new Error("Agent runtime is not available yet.");
    }
    const snapshot = agentGetSession(sessionId);
    if (snapshot) {
      registerAgentSubscriber(event.sender, snapshot.sessionId);
    }
    return snapshot;
  });

  ipcMain.handle(
    "agent:get-session-for-tab",
    (
      event,
      input: {
        windowId?: number;
        tabId: string;
      },
    ) => {
      if (typeof agentGetSessionForTab !== "function") {
        throw new Error("Agent runtime is not available yet.");
      }
      const snapshot = agentGetSessionForTab(input);
      if (snapshot) {
        registerAgentSubscriber(event.sender, snapshot.sessionId);
      }
      return snapshot;
    },
  );

  ipcMain.handle(
    "agent:rebind-session-to-tab",
    (
      event,
      input: {
        sessionId: string;
        workspaceId: string;
        windowId: number;
        tabId: string;
      },
    ) => {
      if (typeof agentRebindSessionToTab !== "function") {
        throw new Error("Agent runtime is not available yet.");
      }
      const snapshot = agentRebindSessionToTab(input);
      registerAgentSubscriber(event.sender, snapshot.sessionId);
      return snapshot;
    },
  );

  ipcMain.handle(
    "agent:send-message",
    async (event, input: { sessionId: string; content: string }) => {
      if (typeof agentSendUserMessage !== "function") {
        throw new Error("Agent runtime is not available yet.");
      }
      registerAgentSubscriber(event.sender, input.sessionId);
      return agentSendUserMessage(input);
    },
  );

  ipcMain.handle(
    "agent:set-session-schedule",
    (event, input: { sessionId: string; cronExpression: string; prompt?: string }) => {
      if (typeof agentSetSessionSchedule !== "function") {
        throw new Error("Agent runtime is not available yet.");
      }
      registerAgentSubscriber(event.sender, input.sessionId);
      return agentSetSessionSchedule(input);
    },
  );

  ipcMain.handle("agent:clear-session-schedule", (event, sessionId: string) => {
    if (typeof agentClearSessionSchedule !== "function") {
      throw new Error("Agent runtime is not available yet.");
    }
    registerAgentSubscriber(event.sender, sessionId);
    return agentClearSessionSchedule(sessionId);
  });

  ipcMain.handle("agent:list-launch-schedules", () => {
    if (typeof agentListLaunchSchedules !== "function") {
      throw new Error("Agent runtime is not available yet.");
    }
    return agentListLaunchSchedules();
  });

  ipcMain.handle("agent:get-launch-schedule", (_event, triggerId: string) => {
    if (typeof agentGetLaunchSchedule !== "function") {
      throw new Error("Agent runtime is not available yet.");
    }
    return agentGetLaunchSchedule(triggerId);
  });

  ipcMain.handle(
    "agent:set-launch-schedule",
    (
      event,
      input: {
        workspaceId?: string;
        windowId?: number;
        cronExpression: string;
        prompt: string;
        privacyMode?: boolean;
        profile?: "default" | "organizer" | "widget-builder";
        scope?: "default" | "current-tab";
        tabId?: string;
        title?: string;
        triggerId?: string;
      },
    ) => {
      if (typeof agentSetLaunchSchedule !== "function") {
        throw new Error("Agent runtime is not available yet.");
      }
      const senderWindow = BrowserWindow.fromWebContents(event.sender);
      const workspaceId = typeof input.workspaceId === "string" && input.workspaceId.trim()
        ? input.workspaceId.trim()
        : resolveSenderWorkspaceId(event.sender);
      const windowId = typeof input.windowId === "number" && Number.isFinite(input.windowId)
        ? Math.floor(input.windowId)
        : senderWindow?.id;
      if (!windowId) {
        throw new Error("A browser window is required to schedule new agent launches.");
      }
      return agentSetLaunchSchedule({
        ...input,
        workspaceId,
        windowId,
      });
    },
  );

  ipcMain.handle("agent:clear-launch-schedule", (_event, triggerId: string) => {
    if (typeof agentClearLaunchSchedule !== "function") {
      throw new Error("Agent runtime is not available yet.");
    }
    return agentClearLaunchSchedule(triggerId);
  });

  ipcMain.handle("agent:interrupt-session", (event, sessionId: string) => {
    if (typeof agentInterruptSession !== "function") {
      throw new Error("Agent runtime is not available yet.");
    }
    registerAgentSubscriber(event.sender, sessionId);
    return agentInterruptSession(sessionId);
  });

  ipcMain.handle("agent:resume-session", (event, sessionId: string) => {
    if (typeof agentResumeSession !== "function") {
      throw new Error("Agent runtime is not available yet.");
    }
    registerAgentSubscriber(event.sender, sessionId);
    return agentResumeSession(sessionId);
  });

  ipcMain.handle("agent:delete-session", (event, sessionId: string) => {
    if (typeof agentDeleteSession !== "function") {
      throw new Error("Agent runtime is not available yet.");
    }
    registerAgentSubscriber(event.sender, sessionId);
    return agentDeleteSession(sessionId);
  });

  ipcMain.handle("agent:get-mcp-export", async (event, sessionId: string) => {
    if (typeof agentExportSessionMcp !== "function") {
      throw new Error("Agent MCP export is not available yet.");
    }
    registerAgentSubscriber(event.sender, sessionId);
    return agentExportSessionMcp(sessionId);
  });

  ipcMain.handle("agent:call-mcp-tool", async (event, input: AgentMcpToolCallInput) => {
    if (typeof agentCallSessionMcpTool !== "function") {
      throw new Error("Agent MCP export is not available yet.");
    }
    registerAgentSubscriber(event.sender, input.sessionId);
    return agentCallSessionMcpTool(input);
  });

  ipcMain.handle("agent:get-mcp-http-address", () => {
    if (typeof getAgentMcpHttpAddress !== "function") {
      throw new Error("Agent MCP HTTP export is not available yet.");
    }
    return getAgentMcpHttpAddress();
  });
}
