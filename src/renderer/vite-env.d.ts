/// <reference types="vite/client" />

import type {
  AutomationEvaluateInput,
  AutomationNavigateInput,
  BrowserBootstrapData,
  CdpCommandInput,
  CreateWorkspaceInput,
  DeleteWorkspacesResult,
  FolderSettingsUpdateInput,
  OpenCreateWorkspaceDialogInput,
  OpenFolderSettingsDialogInput,
  RenameWorkspaceInput,
  SidebarOrganizationState,
  SwitchWorkspaceInput,
  SyncWindowStateInput,
  WindowSummary,
  WindowTabSummary,
  WorkspaceSummary,
} from "./types/workspace";
import type {
  AgentLaunchScheduleSnapshot,
  AgentMcpServerExport,
  AgentMcpToolCallInput,
  AgentSessionDeleteResult,
  AgentSessionListItem,
  AgentSessionSnapshot,
  AgentSessionUpdate,
  McpToolResultEnvelope,
} from "./types/agent";
import type {
  BrowserExtensionActionSummary,
  BrowserExtensionSummary,
} from "./types/extensions";
import type {
  UserScriptAgentGenerateInput,
  UserScriptAgentGenerateResult,
  UserScriptCreateInput,
  UserScriptRecord,
  UserScriptRunResult,
  UserScriptTestResult,
  UserScriptUpdateInput,
} from "./types/user-scripts";

declare global {
  interface TabStateUpdate {
    workspaceId?: string;
    tabs: WindowTabSummary[];
    activeTabId: string | null;
  }

  interface PageSearchResultPayload {
    tabId: string;
    query: string;
    activeMatchOrdinal: number;
    matches: number;
    finalUpdate: boolean;
  }

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

  interface UserScriptsToolbarPopupInput {
    anchor?: {
      left: number;
      top: number;
      width: number;
      height: number;
    };
    targetUrl?: string;
  }

  interface ExtensionsToolbarMenuInput {
    anchor?: {
      left: number;
      top: number;
      width: number;
      height: number;
    };
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

  interface SplitViewDragPreviewPayload {
    mode: "horizontal" | "vertical";
    side: "left" | "right" | "top" | "bottom";
  }

  interface SplitViewDragDropPayload extends SplitViewDragPreviewPayload {
    tabId: string;
  }

  interface BookmarkRecord {
    id: string;
    title: string;
    url: string;
    favicon?: string;
    folderId?: string | null;
    createdAt: number;
  }

  interface BookmarkFolderRecord {
    id: string;
    name: string;
    parentId?: string | null;
    importSourceId?: string;
    createdAt: number;
  }

  interface BookmarkImportSource {
    id: string;
    browserId: string;
    browserName: string;
    profileId: string;
    profileName: string;
    format: "chromium-json";
  }

  interface BookmarkImportResult {
    bookmarks: BookmarkRecord[];
    folders: BookmarkFolderRecord[];
    importedBookmarks: number;
    skippedBookmarks: number;
    importedFolders: number;
    sourceLabel: string;
  }

  interface HistoryRecord {
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

  interface HistoryImportSourceStat {
    sourceId: string;
    visitCount: number;
    lastVisitedAt: number;
  }

  interface HistoryOpenSourceMetadata {
    url: string;
    title?: string;
    firstOpenedAt: number;
    lastOpenedAt: number;
    openCount: number;
    lastTargetUrl?: string;
  }

  interface HistoryMetadata {
    openedFrom?: HistoryOpenSourceMetadata[];
  }

  interface HistoryImportSource {
    id: string;
    browserId: string;
    browserName: string;
    profileId: string;
    profileName: string;
    format: "chromium-sqlite";
  }

  interface HistoryImportResult {
    records: HistoryRecord[];
    importedRecords: number;
    mergedRecords: number;
    skippedRecords: number;
    sourceLabel: string;
  }

  interface LearningHistoryPageSummary {
    url: string;
    title: string;
    visitCount: number;
    lastVisitedAt: number;
  }

  interface LearningHistorySiteSummary {
    siteId: string;
    domain: string;
    visitCount: number;
    uniquePageCount: number;
    observedDayCount: number;
    firstSeenAt: number;
    lastVisitedAt: number;
    activityLevel?: "high" | "medium" | "low";
    revisitPattern?: "habitual" | "balanced" | "exploratory";
    topPages: LearningHistoryPageSummary[];
    profileSummary?: string;
    commonIntents: string[];
    revisitDrivers: string[];
    confidence?: number;
  }

  interface LearningProgressItem {
    progressId: string;
    mode: "observe_workflow" | "learn_writing_style";
    workspaceId: string;
    domain: string;
    url?: string;
    pageTitle?: string;
    pageType?: string;
    updatedAt: number;
    eventCount: number;
    methods: Array<"input" | "click" | "scroll" | "navigation" | "dialog" | "download" | "typing">;
    latestEventKind?: string;
    latestEventSummary?: string;
    targetSummary?: string;
    contentPreview?: string;
    contextType?: "email" | "forum" | "article_editor" | "general_editor";
    slot?: "subject" | "body" | "title" | "comment" | "message" | "recipient" | "unknown";
    fieldHint?: string;
    recipientLabel?: string;
    charCount?: number;
    wordCount?: number;
  }

  interface LearningTaskStatus {
    state: "idle" | "running" | "paused" | "error_paused";
    mode: "off" | "on";
    pauseReason?: "manual" | "llm_error";
    pauseStage?: "episode_learning" | "history_profile_refinement" | "guidance_refinement" | "style_profile_refinement";
    pauseMessage?: string;
    pauseAt?: number;
    observerCount: number;
    activeWorkflowCount: number;
    activeWritingCount: number;
    queuedGuidanceRefinementCount: number;
    runningGuidanceRefinementCount: number;
    queuedHistoryProfileRefinementCount: number;
    runningHistoryProfileRefinementCount: number;
    queuedStyleProfileRefinementCount: number;
    runningStyleProfileRefinementCount: number;
    activeDomains: string[];
  }

  interface LearningStyleProfileSummary {
    profileId: string;
    domain?: string;
    scheme?: string;
    pageType?: string;
    contextType?: "email" | "forum" | "article_editor" | "general_editor";
    contextLabel?: string;
    slot?: "subject" | "body" | "title" | "comment" | "message" | "recipient" | "unknown";
    slotLabel?: string;
    fieldHint?: string;
    recipientKey?: string;
    recipientLabel?: string;
    tone?: string;
    formality?: string;
    searchStyle?: string;
    emailStyle?: string;
    forumStyle?: string;
    articleStyle?: string;
    notesStyle?: string;
    styleSummary?: string;
    commonPhrases: string[];
    exemplarSnippets: string[];
    exemplarCount: number;
    averageLength: number;
    confidence: number;
    lastUpdatedAt: number;
  }

  interface LearningPreferenceSignal {
    id?: string;
    key: string;
    value: string;
    category?: "recent_focus" | "stable_preference" | "negative_preference" | "workflow_preference";
    confidence: number;
    source: "explicit" | "observed" | "manual" | "agent_interaction" | "browsing_history" | "workflow_learning" | "writing_style";
    strength?: number;
    evidenceRefs?: string[];
    scope?: "global" | "workspace" | "domain";
    domain?: string;
    createdAt?: number;
    lastSeenAt?: number;
    expiresAt?: number;
    status?: "active" | "stale" | "rejected";
    updatedAt: number;
  }

  interface LearningUserMemorySignalInput {
    profileId?: string;
    workspaceId?: string;
    signalId?: string;
    key?: string;
    category?: "recent_focus" | "stable_preference" | "negative_preference" | "workflow_preference";
    scope?: "global" | "workspace" | "domain";
    domain?: string;
  }

  interface LearningUserMemoryUpsertInput extends LearningUserMemorySignalInput {
    key: string;
    value: string;
    source?: "explicit" | "observed" | "manual" | "agent_interaction" | "browsing_history" | "workflow_learning" | "writing_style";
    confidence?: number;
    strength?: number;
    evidenceRefs?: string[];
    createdAt?: number;
    lastSeenAt?: number;
    expiresAt?: number;
    status?: "active" | "stale" | "rejected";
  }

  interface LearningPreferenceProfileSummary {
    profileId: string;
    signals: LearningPreferenceSignal[];
    lastUpdatedAt: number;
  }

  interface LearningFlushResult {
    success: boolean;
    processedEventCount: number;
    learnedEpisodeCount: number;
    learnedGuidanceCount: number;
    writingSampleCount: number;
  }

  interface DownloadSegmentRecord {
    index: number;
    start: number;
    end: number;
    receivedBytes: number;
    tempPath: string;
  }

  interface DownloadRecord {
    id: string;
    source: "manual" | "browser";
    url: string;
    finalUrl: string;
    sourcePageUrl?: string;
    partition?: string;
    headers: Record<string, string>;
    filename: string;
    directory: string;
    targetPath: string;
    targetPathLocked: boolean;
    tempDirectory: string;
    mimeType?: string;
    status: "pending" | "running" | "paused" | "completed" | "failed" | "canceled";
    threadCount: number;
    supportsRanges: boolean;
    totalBytes: number | null;
    receivedBytes: number;
    speedBytesPerSecond: number;
    fileExists: boolean;
    createdAt: number;
    updatedAt: number;
    completedAt?: number;
    error?: string;
    etag?: string;
    lastModified?: string;
    segments: DownloadSegmentRecord[];
  }

  interface BrowserShellAppInfo {
    name: string;
    version: string;
    platform: string;
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

  interface SystemNotificationInput {
    title?: string;
    body?: string;
    subtitle?: string;
    silent?: boolean;
    urgency?: "low" | "normal" | "critical";
  }

  interface SystemNotificationResult {
    shown: boolean;
    delivery?: "electron" | "macos-osascript";
    reason?: "app-not-ready" | "empty" | "unsupported";
  }

  interface StartPageDockItem {
    id: string;
    title: string;
    url: string;
    favicon?: string;
    createdAt: number;
  }

  interface StartPageAppearance {
    backgroundImage: string | null;
  }

  interface StartPageWidgetBase {
    gridH: number;
    gridW: number;
    gridX: number;
    gridY: number;
    id: string;
    title: string;
  }

  interface StartPageEmbedWidget extends StartPageWidgetBase {
    type: "embed";
    url: string;
  }

  interface StartPageProtocolWidget extends StartPageWidgetBase {
    source: string;
    type: "protocol";
  }

  interface StartPageNotesWidget extends StartPageWidgetBase {
    content: string;
    type: "notes";
  }

  type StartPageWidget =
    | StartPageEmbedWidget
    | StartPageProtocolWidget
    | StartPageNotesWidget;

  interface StartPageWidgetsState {
    items: StartPageWidget[];
    migrated: boolean;
  }

  interface StartPageWidgetRefreshEvent {
    driftMs: number;
    reason: "interval";
    refreshedAt: number;
    refreshIntervalMs: number;
    scheduledAt: number;
    source: string;
    triggerId: string;
    widgetId: string;
    workspaceId: string;
  }

  interface StartPageShellLayout {
    shellHeight: number;
    shellWidth: number;
    viewHeight: number;
    viewWidth: number;
    viewX: number;
    viewY: number;
  }

  interface WidgetPackageSummary {
    defaultSize: {
      h: number;
      w: number;
    };
    defaultTitle: string;
    description?: string;
    entry: string;
    id: string;
    name: string;
    permissions: {
      network: boolean;
      openExternal: boolean;
    };
    rootPath: string;
    version: string;
  }

  interface WidgetPackageManifest {
    id: string;
    name: string;
    version: string;
    entry: string;
    description?: string;
    defaultTitle?: string;
    defaultSize?: {
      h?: number;
      w?: number;
    };
    permissions?: {
      network?: boolean;
      openExternal?: boolean;
    };
  }

  interface BrowserShellAPI {
    getBootstrapData: () => Promise<BrowserBootstrapData>;
    renderPreviewGetDocument: (id: string) => Promise<RenderPreviewDocument | null>;
    createWorkspace: (input: CreateWorkspaceInput) => Promise<WorkspaceSummary>;
    deleteWorkspaces: (workspaceIds: string[]) => Promise<DeleteWorkspacesResult>;
    openWorkspaceProfileDirectory: (workspaceId: string) => Promise<string>;
    renameWorkspace: (input: RenameWorkspaceInput) => Promise<WorkspaceSummary>;
    showWorkspaceMenu: (anchor: {
      left: number;
      top: number;
      width: number;
      height: number;
    }) => Promise<void>;
    openCreateWorkspaceDialog: (input: OpenCreateWorkspaceDialogInput) => Promise<void>;
    openFolderSettingsDialog: (input: OpenFolderSettingsDialogInput) => Promise<void>;
    submitFolderSettingsDialog: (input: FolderSettingsUpdateInput) => Promise<void>;
    openWorkspaceWindow: (workspaceId: string) => Promise<WorkspaceSummary>;
    switchWorkspace: (input: SwitchWorkspaceInput) => Promise<BrowserBootstrapData>;
    closeCurrentWindow: () => Promise<void>;
    minimizeCurrentWindow: () => Promise<void>;
    maximizeCurrentWindow: () => Promise<boolean>;
    isWindowMaximized: () => Promise<boolean>;
    showSystemNotification: (input: SystemNotificationInput) => Promise<SystemNotificationResult>;
    focusWindow: (windowId: number) => Promise<WindowSummary>;
    syncWindowState: (input: SyncWindowStateInput) => Promise<WindowSummary>;
    sidebarSyncState: (input: {
      workspaceId: string;
      state: SidebarOrganizationState;
      sequence?: number;
    }) => Promise<SidebarOrganizationState>;
    sidebarSyncStateNow?: (input: {
      workspaceId: string;
      state: SidebarOrganizationState;
      sequence?: number;
    }) => SidebarOrganizationState;
    setAutomationTarget: (
      workspaceId: string,
      targetContentsId: number,
    ) => Promise<WorkspaceSummary>;
    sendAutomationCommand: (input: CdpCommandInput) => Promise<unknown>;
    automationNavigate: (input: AutomationNavigateInput) => Promise<unknown>;
    automationEvaluate: (input: AutomationEvaluateInput) => Promise<unknown>;
    onWorkspaceContext: (
      callback: (payload: BrowserBootstrapData) => void,
    ) => () => void;
    onFolderSettingsUpdated: (
      callback: (payload: FolderSettingsUpdateInput) => void,
    ) => () => void;
    onSidebarOrganizationStateApplied: (
      callback: (payload: {
        workspaceId: string;
        state: SidebarOrganizationState;
      }) => void,
    ) => () => void;

    // Tab management via BrowserView
    tabCreate: (windowId: number, url?: string) => Promise<WindowTabSummary>;
    tabClose: (windowId: number, tabId: string) => Promise<{ activeTabId: string }>;
    tabSetActive: (
      windowId: number,
      tabId: string,
      sidebarWidth?: number,
      urlBarHeight?: number,
      rightPanelWidth?: number,
    ) => Promise<void>;
    tabApplyLayout: (
      windowId: number,
      input: TabLayoutUpdateInput,
      sidebarWidth?: number,
      urlBarHeight?: number,
    ) => Promise<void>;
    tabNavigate: (windowId: number, tabId: string, url: string) => Promise<void>;
    tabGoBack: (windowId: number, tabId: string) => Promise<void>;
    tabGoForward: (windowId: number, tabId: string) => Promise<void>;
    tabReload: (windowId: number, tabId: string) => Promise<void>;
    tabReorder: (windowId: number, orderedTabIds: string[]) => Promise<void>;
    tabSetSidebarDragState: (windowId: number, tabId?: string | null) => Promise<void>;
    splitViewShowMenu: (input: SplitViewMenuInput) => Promise<SplitViewMenuAction | null>;
    tabShowItemMenu: (tabId: string, x?: number, y?: number) => Promise<void>;
    tabUpdateBounds: (windowId: number, sidebarWidth: number, urlBarHeight: number, rightPanelWidth?: number) => Promise<void>;
    tabCapturePage: (windowId: number, tabId?: string) => Promise<{
      success: boolean;
      dataUrl?: string;
      width?: number;
      height?: number;
      title?: string;
      url?: string;
      error?: string;
    }>;
    tabGetPageTelemetry: (windowId: number, tabId?: string) => Promise<{
      success: boolean;
      url: string;
      title: string;
      wordCount: number;
      readingTimeMin: number;
      headings: string[];
      linksCount: number;
      imagesCount: number;
      metaDescription: string;
      ogImage?: string;
      security: {
        isHttps: boolean;
        protocol: string;
      };
      dimensions: {
        innerWidth: number;
        innerHeight: number;
        scrollHeight: number;
        devicePixelRatio: number;
      };
      performance: {
        loadTimeMs: number;
        domContentLoadedMs: number;
      };
      snippet: string;
      error?: string;
    }>;
    tabGetCodingContext: (windowId: number, tabId?: string) => Promise<{
      isCodingSite: boolean;
      platform: string;
      problemTitle: string;
      problemDescription: string;
      detectedLanguage: string;
      starterCode: string;
      editorType: string;
      url: string;
      error?: string;
    }>;
    tabInjectCode: (windowId: number, tabId: string, code: string) => Promise<{
      success: boolean;
      methodUsed: string;
      codeLength: number;
      message: string;
      error?: string;
    }>;
    tabRunCode: (windowId: number, tabId: string) => Promise<{
      clicked: boolean;
      target?: string;
      message?: string;
      error?: string;
    }>;
    onSplitViewDragPreview: (
      callback: (payload: SplitViewDragPreviewPayload) => void,
    ) => () => void;
    onSplitViewDragClear: (callback: () => void) => () => void;
    onSplitViewDragDrop: (
      callback: (payload: SplitViewDragDropPayload) => void,
    ) => () => void;
    onTabStateUpdate: (
      callback: (payload: TabStateUpdate) => void,
    ) => () => void;
    pageSearchFind: (input: {
      tabId: string;
      query: string;
      findNext?: boolean;
      forward?: boolean;
    }) => Promise<void>;
    pageSearchStop: (
      tabId: string,
      action?: "clearSelection" | "keepSelection" | "activateSelection",
    ) => Promise<void>;
    pageSearchOverlayGetState: () => Promise<{
      visible: boolean;
      tabId: string;
      query: string;
      result: PageSearchResultPayload | null;
      focusInput: boolean;
    }>;
    pageSearchOverlayClose: () => Promise<void>;
    onPageSearchOverlayState: (callback: (payload: {
      visible: boolean;
      tabId: string;
      query: string;
      result: PageSearchResultPayload | null;
      focusInput: boolean;
    }) => void) => () => void;
    onPageSearchRequested: (callback: () => void) => () => void;
    onPageSearchResult: (
      callback: (payload: PageSearchResultPayload) => void,
    ) => () => void;

    // Bookmarks
    bookmarksList: () => Promise<BookmarkRecord[]>;
    bookmarksGetState: () => Promise<{ bookmarks: BookmarkRecord[]; folders: BookmarkFolderRecord[] }>;
    bookmarksFoldersList: () => Promise<BookmarkFolderRecord[]>;
    bookmarksFolderCreate: (name: string, parentId?: string | null) => Promise<{ bookmarks: BookmarkRecord[]; folders: BookmarkFolderRecord[] }>;
    bookmarksFolderUpdate: (id: string, input: { name?: string; parentId?: string | null }) => Promise<{ bookmarks: BookmarkRecord[]; folders: BookmarkFolderRecord[] }>;
    bookmarksFolderRemove: (id: string) => Promise<{ bookmarks: BookmarkRecord[]; folders: BookmarkFolderRecord[] }>;
    bookmarksAdd: (title: string, url: string, favicon?: string, folderId?: string | null) => Promise<BookmarkRecord[]>;
    bookmarksUpdate: (id: string, input: { title: string; url: string; favicon?: string; folderId?: string | null }) => Promise<BookmarkRecord[]>;
    bookmarksUpdateFavicons: (updates: Array<{ id: string; favicon: string }>) => Promise<BookmarkRecord[]>;
    bookmarksRemove: (id: string) => Promise<BookmarkRecord[]>;
    bookmarksClear: () => Promise<BookmarkRecord[]>;
    bookmarksImportListSources: () => Promise<BookmarkImportSource[]>;
    bookmarksImportSource: (sourceId: string) => Promise<BookmarkImportResult>;
    bookmarksImportFile: () => Promise<BookmarkImportResult | null>;

    // History
    historyList: () => Promise<HistoryRecord[]>;
    historyGetState: () => Promise<{ records: HistoryRecord[] }>;
    historyImportListSources: () => Promise<HistoryImportSource[]>;
    historyImportSource: (sourceId: string) => Promise<HistoryImportResult>;
    historyShowItemMenu: (url: string) => Promise<void>;
    historyUpdate: (id: string, input: { title: string; url: string; favicon?: string }) => Promise<HistoryRecord[]>;
    historyRemove: (id: string) => Promise<HistoryRecord[]>;
    historyClear: () => Promise<HistoryRecord[]>;

    // Downloads
    downloadsList: () => Promise<DownloadRecord[]>;
    downloadsGetState: () => Promise<{ records: DownloadRecord[] }>;
    downloadsCreate: (input: {
      url: string;
      source?: "manual" | "browser";
      sourcePageUrl?: string;
      partition?: string;
      headers?: Record<string, string>;
      filename?: string;
      directory?: string;
      targetPath?: string;
      threadCount?: number;
      mimeType?: string;
      totalBytes?: number | null;
      finalUrl?: string;
    }) => Promise<DownloadRecord>;
    downloadsPause: (id: string) => Promise<DownloadRecord>;
    downloadsResume: (id: string) => Promise<DownloadRecord>;
    downloadsCancel: (id: string) => Promise<DownloadRecord>;
    downloadsRetry: (id: string) => Promise<DownloadRecord>;
    downloadsRemove: (id: string, deleteFile?: boolean) => Promise<DownloadRecord[]>;
    downloadsDeleteFile: (id: string) => Promise<DownloadRecord>;
    downloadsShowInFolder: (id: string) => Promise<string>;
    downloadsShowSaveDialog: (input?: { filename?: string }) => Promise<string | null>;
    downloadsShowDirectoryDialog: (input?: { defaultPath?: string }) => Promise<string | null>;
    downloadsGetPreferences: () => Promise<{
      defaultDirectory: string;
      hasCustomDirectory: boolean;
      defaultThreadCount: number;
      defaultHeadersText: string;
    }>;
    downloadsSetPreferences: (input?: {
      defaultDirectory?: string | null;
      defaultThreadCount?: number;
      defaultHeadersText?: string;
    }) => Promise<{
      defaultDirectory: string;
      hasCustomDirectory: boolean;
      defaultThreadCount: number;
      defaultHeadersText: string;
    }>;

    // Extensions
    extensionsList: () => Promise<BrowserExtensionSummary[]>;
    extensionsPickUnpackedDirectory: () => Promise<string | null>;
    extensionsInstallFromStore: (input: string) => Promise<BrowserExtensionSummary>;
    extensionsInstallUnpacked: (extensionPath: string) => Promise<BrowserExtensionSummary>;
    extensionsSetEnabled: (extensionId: string, enabled: boolean) => Promise<BrowserExtensionSummary>;
    extensionsRemove: (extensionId: string) => Promise<void>;
    extensionsReload: (extensionId: string) => Promise<BrowserExtensionSummary>;
    extensionsReveal: (extensionId: string) => Promise<string>;
    extensionsOpenActionPopup: (
      extensionId: string,
      anchor?: { left: number; top: number; width: number; height: number },
    ) => Promise<BrowserExtensionActionSummary>;
    extensionsShowToolbarMenu: (input?: ExtensionsToolbarMenuInput) => Promise<void>;
    onExtensionsChanged: (callback: (payload: { profileId: string }) => void) => () => void;

    // User scripts
    userScriptsList: () => Promise<UserScriptRecord[]>;
    userScriptsCreate: (input: UserScriptCreateInput) => Promise<UserScriptRecord>;
    userScriptsUpdate: (scriptId: string, input: UserScriptUpdateInput) => Promise<UserScriptRecord>;
    userScriptsRemove: (scriptId: string) => Promise<void>;
    userScriptsSetEnabled: (scriptId: string, enabled: boolean) => Promise<UserScriptRecord>;
    userScriptsRunNow: (scriptId: string) => Promise<UserScriptRunResult>;
    userScriptsRunTest: (scriptId: string) => Promise<UserScriptTestResult>;
    userScriptsAgentGenerate: (input: UserScriptAgentGenerateInput) => Promise<UserScriptAgentGenerateResult>;
    userScriptsShowToolbarPopup: (input: UserScriptsToolbarPopupInput) => Promise<void>;
    onUserScriptsChanged: (callback: (payload: { profileId: string }) => void) => () => void;

    // Search overlay
    searchOpen: () => Promise<void>;
    searchGetOverlayData: () => Promise<{
      tabs: WindowTabSummary[];
      bookmarks: BookmarkRecord[];
      history: HistoryRecord[];
      activeTabId: string;
    }>;
    searchQuery: (query: string) => Promise<{
      tabs: WindowTabSummary[];
      bookmarks: BookmarkRecord[];
      history: HistoryRecord[];
      activeTabId: string;
    }>;
    searchClose: () => Promise<void>;
    aiSidebarGetState: () => Promise<{ visible: boolean; windowId: number | null; tabId: string | null }>;
    aiSidebarToggle: () => Promise<{ visible: boolean; windowId: number | null; tabId: string | null }>;
    aiSidebarClose: (input?: { windowId?: number | null; tabId?: string | null } | null) => Promise<{ visible: boolean; windowId: number | null; tabId: string | null }>;
    onAiSidebarStateChanged: (
      callback: (state: { visible: boolean; windowId: number | null; tabId: string | null }) => void,
    ) => () => void;
    onAiSidebarCloseRequested: (callback: () => void) => () => void;
    searchSelectTab: (tabId: string) => Promise<void>;
    searchNavigate: (url: string) => Promise<void>;
    searchRemoveBookmark: (id: string) => Promise<BookmarkRecord[]>;
    startPageGetAppearance: () => Promise<StartPageAppearance>;
    startPageGetShellLayout: () => Promise<StartPageShellLayout | null>;
    startPageSetAppearance: (input?: Partial<StartPageAppearance> | null) => Promise<StartPageAppearance>;
    startPageGetDockItems: () => Promise<StartPageDockItem[]>;
    startPageGetWidgets: () => Promise<StartPageWidgetsState>;
    startPageGetWidgetRefreshes: () => Promise<StartPageWidgetRefreshEvent[]>;
    startPageWidgetAutomationCall: (input: {
      source: string;
      widgetId: string;
      tool: string;
      input?: unknown;
    }) => Promise<unknown>;
    startPageSetWidgets: (input?: StartPageWidget[] | null) => Promise<StartPageWidgetsState>;
    startPageSetDockItemFavicon: (id: string, favicon: string) => Promise<StartPageDockItem[]>;
    startPageRemoveDockItem: (id: string) => Promise<StartPageDockItem[]>;
    startPageClearDockItems: () => Promise<StartPageDockItem[]>;
    widgetRegistryGetRootDirectory: () => Promise<string>;
    widgetRegistryListPackages: () => Promise<WidgetPackageSummary[]>;
    widgetRegistryGetPackage: (packageId: string) => Promise<WidgetPackageSummary | null>;
    widgetRegistryGetPackageManifest: (packageId: string) => Promise<WidgetPackageManifest | null>;
    widgetRegistryPickPackageDirectory: () => Promise<string | null>;
    widgetRegistryInspectPackageDirectory: (directoryPath: string) => Promise<WidgetPackageSummary>;
    widgetRegistryInstallPackageFromDirectory: (directoryPath: string) => Promise<WidgetPackageSummary>;
    widgetRegistryRemovePackage: (packageId: string) => Promise<string>;
    widgetRegistryRevealPackage: (packageId: string) => Promise<string>;
    widgetRegistryCreateStarterPackage: () => Promise<WidgetPackageSummary>;
    widgetRegistryRevealRootDirectory: () => Promise<string>;

    // Settings / Theme
    settingsGetTheme: () => Promise<string>;
    settingsSetTheme: (theme: string) => Promise<string>;
    settingsGetLanguage: () => Promise<string>;
    settingsGetDefaultBrowserStatus: () => Promise<{
      http: boolean;
      https: boolean;
      isDefaultBrowser: boolean;
      canSetAsDefaultBrowser: boolean;
      manualActionRequired: boolean;
      reason: "ready" | "packaged_build_required" | "manual_confirmation_required";
    }>;
    settingsSetLanguage: (language: string) => Promise<string>;
    settingsSetDefaultBrowser: () => Promise<{
      http: boolean;
      https: boolean;
      isDefaultBrowser: boolean;
      canSetAsDefaultBrowser: boolean;
      manualActionRequired: boolean;
      reason: "ready" | "packaged_build_required" | "manual_confirmation_required";
      updated: boolean;
    }>;
    settingsExportAllData: (input?: {
      rendererSettings?: Record<string, unknown> | null;
    } | null) => Promise<{
      canceled: boolean;
      filePath?: string;
      bytesWritten?: number;
      exportedAt?: string;
    }>;
    llmGetProviders: () => Promise<Array<{
      id: string;
      name: string;
      baseUrl: string;
      apiKey: string;
      models: string[];
      extraBodyEnabled: boolean;
      extraBody: Record<string, unknown>;
      extraHeadersEnabled: boolean;
      extraHeaders: Record<string, string>;
      extractThinkingContent: boolean;
      thinkingContentTagName: string;
      interleavedThinkingEnabled: boolean;
      interleavedThinkingFieldName: string;
      modelSettings: Record<string, {
        extraBodyEnabled: boolean;
        extraBody: Record<string, unknown>;
        extraHeadersEnabled: boolean;
        extraHeaders: Record<string, string>;
        extractThinkingContent: boolean;
        thinkingContentTagName: string;
        interleavedThinkingEnabled: boolean;
        interleavedThinkingFieldName: string;
      }>;
    }>>;
    agentGetPreferences: () => Promise<{
      providerId: string;
      model: string;
      mcpToolExportEnabled: boolean;
      profileInstructions: string;
      interactionBlacklistDomains: string[];
    }>;
    imageAgentGetPreferences: () => Promise<{
      providerId: string;
      model: string;
    }>;
    learningGetPreferences: () => Promise<{
      mode: "off" | "on";
      providerId: string;
      model: string;
      redactTextInput: boolean;
      retentionDays: number;
      blacklistDomains: string[];
    }>;
    llmSetProviders: (input?: Array<{
      id: string;
      name: string;
      baseUrl: string;
      apiKey: string;
      models: string[];
      extraBodyEnabled: boolean;
      extraBody: Record<string, unknown>;
      extraHeadersEnabled: boolean;
      extraHeaders: Record<string, string>;
      extractThinkingContent: boolean;
      thinkingContentTagName: string;
      interleavedThinkingEnabled: boolean;
      interleavedThinkingFieldName: string;
      modelSettings: Record<string, {
        extraBodyEnabled: boolean;
        extraBody: Record<string, unknown>;
        extraHeadersEnabled: boolean;
        extraHeaders: Record<string, string>;
        extractThinkingContent: boolean;
        thinkingContentTagName: string;
        interleavedThinkingEnabled: boolean;
        interleavedThinkingFieldName: string;
      }>;
    }> | null) => Promise<Array<{
      id: string;
      name: string;
      baseUrl: string;
      apiKey: string;
      models: string[];
      extraBodyEnabled: boolean;
      extraBody: Record<string, unknown>;
      extraHeadersEnabled: boolean;
      extraHeaders: Record<string, string>;
      extractThinkingContent: boolean;
      thinkingContentTagName: string;
      interleavedThinkingEnabled: boolean;
      interleavedThinkingFieldName: string;
      modelSettings: Record<string, {
        extraBodyEnabled: boolean;
        extraBody: Record<string, unknown>;
        extraHeadersEnabled: boolean;
        extraHeaders: Record<string, string>;
        extractThinkingContent: boolean;
        thinkingContentTagName: string;
        interleavedThinkingEnabled: boolean;
        interleavedThinkingFieldName: string;
      }>;
    }>>;
    agentSetPreferences: (input?: Partial<{
      providerId: string;
      model: string;
      mcpToolExportEnabled: boolean;
      profileInstructions: string;
      interactionBlacklistDomains: string[];
    }> | null) => Promise<{
      providerId: string;
      model: string;
      mcpToolExportEnabled: boolean;
      profileInstructions: string;
      interactionBlacklistDomains: string[];
    }>;
    imageAgentSetPreferences: (input?: Partial<{
      providerId: string;
      model: string;
    }> | null) => Promise<{
      providerId: string;
      model: string;
    }>;
    learningSetPreferences: (input?: Partial<{
      mode: "off" | "on";
      providerId: string;
      model: string;
      redactTextInput: boolean;
      retentionDays: number;
      blacklistDomains: string[];
    }> | null) => Promise<{
      mode: "off" | "on";
      providerId: string;
      model: string;
      redactTextInput: boolean;
      retentionDays: number;
      blacklistDomains: string[];
    }>;
    learningClearState: () => Promise<{
      success: boolean;
    }>;
    learningFlushNow: () => Promise<LearningFlushResult>;
    learningDeleteSite: (siteId: string) => Promise<{
      success: boolean;
    }>;
    learningDeleteGuidance: (guidanceId: string) => Promise<{
      success: boolean;
    }>;
    learningDeleteSiteSkill: (skillId: string) => Promise<{
      success: boolean;
    }>;
    learningDeleteHistorySite: (domain: string) => Promise<{
      success: boolean;
    }>;
    learningDeleteStyleProfile: (profileId: string) => Promise<{
      success: boolean;
    }>;
    learningDeletePreferenceProfile: (profileId: string) => Promise<{
      success: boolean;
    }>;
    learningUpsertUserMemory: (input: LearningUserMemoryUpsertInput) => Promise<{
      success: boolean;
      profile?: LearningPreferenceProfileSummary;
      signal?: LearningPreferenceSignal;
    }>;
    learningDeleteUserMemory: (input: LearningUserMemorySignalInput) => Promise<{
      success: boolean;
      profile?: LearningPreferenceProfileSummary;
      signal?: LearningPreferenceSignal;
    }>;
    learningRejectUserMemory: (input: LearningUserMemorySignalInput) => Promise<{
      success: boolean;
      profile?: LearningPreferenceProfileSummary;
      signal?: LearningPreferenceSignal;
    }>;
    learningGetSummary: (input?: {
      workspaceId?: string;
      activeUrl?: string;
    } | null) => Promise<{
      rawEventCount: number;
      pendingEventCount: number;
      pageSnapshotCount: number;
      observationCount: number;
      episodeCount: number;
      actionStrategyCount: number;
      guidanceCount: number;
      siteSkillCount: number;
      feedbackCount: number;
      styleProfileCount: number;
      preferenceProfileCount: number;
      historyRecordCount: number;
      historySiteCount: number;
      historyVisitCount: number;
      topHistorySites: LearningHistorySiteSummary[];
      recentActionStrategies: Array<{
        guidanceId: string;
        domain: string;
        pageType?: string;
        intentKey: string;
        intentLabel: string;
        purposeKey: "retrieve_data" | "submit_data" | "authenticate" | "download_export" | "navigate_workflow" | "other";
        purposeLabel: string;
        goalSummary: string;
        keywords: string[];
        preferredTargets: string[];
        recommendedSteps: string[];
        recoveryHints: string[];
        support: number;
        successRate: number;
        confidence: number;
        feedbackCount: number;
        lastSeenAt: number;
      }>;
      recentGuidance: Array<{
        guidanceId: string;
        domain: string;
        pageType?: string;
        intentKey: string;
        intentLabel: string;
        purposeKey: "retrieve_data" | "submit_data" | "authenticate" | "download_export" | "navigate_workflow" | "other";
        purposeLabel: string;
        goalSummary: string;
        keywords: string[];
        preferredTargets: string[];
        recommendedSteps: string[];
        recoveryHints: string[];
        support: number;
        successRate: number;
        confidence: number;
        feedbackCount: number;
        lastSeenAt: number;
      }>;
      lastUpdatedAt?: number;
    }>;
    learningGetCatalog: () => Promise<{
      rawEventCount: number;
      pendingEventCount: number;
      pageSnapshotCount: number;
      observationCount: number;
      episodeCount: number;
      actionStrategyCount: number;
      guidanceCount: number;
      siteSkillCount: number;
      feedbackCount: number;
      styleProfileCount: number;
      preferenceProfileCount: number;
      historyRecordCount: number;
      historySiteCount: number;
      historyVisitCount: number;
      historyTopSites: LearningHistorySiteSummary[];
      styleProfiles: LearningStyleProfileSummary[];
      preferenceProfiles: LearningPreferenceProfileSummary[];
      siteCount: number;
      activeProgress: LearningProgressItem[];
      taskStatus: LearningTaskStatus;
      sites: Array<{
        siteId: string;
        domain: string;
        scheme?: string;
        actionStrategyCount: number;
        guidanceCount: number;
        siteSkillCount: number;
        feedbackCount: number;
        totalSupport: number;
        lastSeenAt: number;
        history?: LearningHistorySiteSummary | null;
        actionStrategies: Array<{
          guidanceId: string;
          pageType?: string;
          intentKey: string;
          intentLabel: string;
          purposeKey: "retrieve_data" | "submit_data" | "authenticate" | "download_export" | "navigate_workflow" | "other";
          purposeLabel: string;
          goalSummary: string;
          keywords: string[];
          preferredTargets: string[];
          recommendedSteps: string[];
          recoveryHints: string[];
          support: number;
          successRate: number;
          confidence: number;
          feedbackCount: number;
          lastSeenAt: number;
        }>;
        behaviors: Array<{
          guidanceId: string;
          pageType?: string;
          intentKey: string;
          intentLabel: string;
          purposeKey: "retrieve_data" | "submit_data" | "authenticate" | "download_export" | "navigate_workflow" | "other";
          purposeLabel: string;
          goalSummary: string;
          keywords: string[];
          preferredTargets: string[];
          recommendedSteps: string[];
          recoveryHints: string[];
          support: number;
          successRate: number;
          confidence: number;
          feedbackCount: number;
          lastSeenAt: number;
        }>;
        siteSkills: Array<{
          skillId: string;
          domain: string;
          pageType?: string;
          patternKey:
            | "confirm_after_typing"
            | "scroll_before_primary_action"
            | "dialog_interruption"
            | "navigation_after_click"
            | "download_requires_verification"
            | "llm_inferred";
          patternLabel: string;
          rule: string;
          evidence: string[];
          support: number;
          successRate: number;
          confidence: number;
          lastSeenAt: number;
        }>;
      }>;
      lastUpdatedAt?: number;
    }>;
    translationGetPreferences: () => Promise<{
      provider: "openai-compatible" | "google-basic" | "google-system" | "baidu-standard";
      targetLanguage: "system" | "en-US" | "zh-CN";
      requestConcurrency: number;
      autoTranslateDomains: string[];
      sources: {
        "openai-compatible": {
          providerId: string;
          endpoint: string;
          apiKey: string;
          model: string;
          extraBodyEnabled: boolean;
          extraBody: Record<string, unknown>;
          extraHeadersEnabled: boolean;
          extraHeaders: Record<string, string>;
          extractThinkingContent: boolean;
          thinkingContentTagName: string;
          interleavedThinkingEnabled: boolean;
          interleavedThinkingFieldName: string;
        };
        "google-basic": {
          endpoint: string;
          apiKey: string;
        };
        "google-system": {
          endpoint: string;
        };
        "baidu-standard": {
          endpoint: string;
          appId: string;
          apiKey: string;
        };
      };
    }>;
    translationSetPreferences: (input?: Partial<{
      provider: "openai-compatible" | "google-basic" | "google-system" | "baidu-standard";
      targetLanguage: "system" | "en-US" | "zh-CN";
      requestConcurrency: number;
      autoTranslateDomains: string[];
      sources: Partial<{
        "openai-compatible": Partial<{
          providerId: string;
          endpoint: string;
          apiKey: string;
          model: string;
          extraBodyEnabled: boolean;
          extraBody: Record<string, unknown>;
          extraHeadersEnabled: boolean;
          extraHeaders: Record<string, string>;
          extractThinkingContent: boolean;
          thinkingContentTagName: string;
          interleavedThinkingEnabled: boolean;
          interleavedThinkingFieldName: string;
        }>;
        "google-basic": Partial<{
          endpoint: string;
          apiKey: string;
        }>;
        "google-system": Partial<{
          endpoint: string;
        }>;
        "baidu-standard": Partial<{
          endpoint: string;
          appId: string;
          apiKey: string;
        }>;
      }>;
    }> | null) => Promise<{
      provider: "openai-compatible" | "google-basic" | "google-system" | "baidu-standard";
      targetLanguage: "system" | "en-US" | "zh-CN";
      requestConcurrency: number;
      autoTranslateDomains: string[];
      sources: {
        "openai-compatible": {
          providerId: string;
          endpoint: string;
          apiKey: string;
          model: string;
          extraBodyEnabled: boolean;
          extraBody: Record<string, unknown>;
          extraHeadersEnabled: boolean;
          extraHeaders: Record<string, string>;
          extractThinkingContent: boolean;
          thinkingContentTagName: string;
          interleavedThinkingEnabled: boolean;
          interleavedThinkingFieldName: string;
        };
        "google-basic": {
          endpoint: string;
          apiKey: string;
        };
        "google-system": {
          endpoint: string;
        };
        "baidu-standard": {
          endpoint: string;
          appId: string;
          apiKey: string;
        };
      };
    }>;
    agentEnsureSession: (input: {
      workspaceId: string;
      windowId: number;
    }) => Promise<AgentSessionSnapshot>;
    agentListSessions: (input: {
      workspaceId: string;
      windowId: number;
    }) => Promise<AgentSessionListItem[]>;
    agentCreateSession: (input: {
      workspaceId: string;
      windowId: number;
      scope?: "default" | "current-tab";
      tabId?: string;
      content?: string;
      privacyMode?: boolean;
      profile?: "default" | "organizer" | "widget-builder";
    }) => Promise<AgentSessionSnapshot>;
    agentGetSession: (sessionId: string) => Promise<AgentSessionSnapshot | null>;
    agentGetSessionForTab: (input: { windowId?: number; tabId: string }) => Promise<AgentSessionSnapshot | null>;
    agentRebindSessionToTab: (input: {
      sessionId: string;
      workspaceId: string;
      windowId: number;
      tabId: string;
    }) => Promise<AgentSessionSnapshot>;
    agentSendMessage: (input: {
      sessionId: string;
      content: string;
    }) => Promise<AgentSessionSnapshot>;
    agentSetSessionSchedule: (input: {
      sessionId: string;
      cronExpression: string;
      prompt?: string;
    }) => Promise<AgentSessionSnapshot>;
    agentClearSessionSchedule: (sessionId: string) => Promise<AgentSessionSnapshot>;
    agentListLaunchSchedules: () => Promise<AgentLaunchScheduleSnapshot[]>;
    agentGetLaunchSchedule: (triggerId: string) => Promise<AgentLaunchScheduleSnapshot | undefined>;
    agentSetLaunchSchedule: (input: {
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
    }) => Promise<AgentLaunchScheduleSnapshot>;
    agentClearLaunchSchedule: (triggerId: string) => Promise<AgentLaunchScheduleSnapshot | null | undefined>;
    agentInterruptSession: (sessionId: string) => Promise<AgentSessionSnapshot>;
    agentResumeSession: (sessionId: string) => Promise<AgentSessionSnapshot>;
    agentDeleteSession: (sessionId: string) => Promise<AgentSessionDeleteResult>;
    agentGetMcpExport: (sessionId: string) => Promise<AgentMcpServerExport>;
    agentCallMcpTool: (input: AgentMcpToolCallInput) => Promise<McpToolResultEnvelope>;
    agentGetMcpHttpAddress: () => Promise<string | null>;
    onAgentSessionUpdate: (callback: (update: AgentSessionUpdate) => void) => () => void;
    onThemeChanged: (callback: (theme: string) => void) => () => void;
    onLanguageChanged: (callback: (language: string) => void) => () => void;
    onStartPageAppearanceChanged: (callback: (appearance: StartPageAppearance) => void) => () => void;
    onStartPageDockChanged: (callback: (items: StartPageDockItem[]) => void) => () => void;
    onStartPageWidgetsChanged: (callback: (state: StartPageWidgetsState) => void) => () => void;
    onStartPageWidgetRefresh: (callback: (event: StartPageWidgetRefreshEvent) => void) => () => void;
    onStartPageAddProtocolWidgetRequested: (callback: (payload: {
      source: string;
      title?: string | null;
      skipIfExists?: boolean;
    }) => void) => () => void;
  }

  interface Window {
    browserShell?: BrowserShellAPI;
  }
}

export {};
