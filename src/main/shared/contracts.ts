import type { NavigationEntry, WebContentsView } from "electron";

export type WorkspaceProfileMode = "new" | "attached";

export interface WorkspaceRecord {
  id: string;
  name: string;
  createdAt: number;
  profileId: string;
  profileMode: WorkspaceProfileMode;
  profileSourceWorkspaceId?: string;
  automationEnabled: boolean;
  tags?: string[];
}

export interface WindowTabSummary {
  id: string;
  title: string;
  url: string;
  displayUrl: string;
  favicon?: string;
  isLoading: boolean;
  isAutomationControlled?: boolean;
  manualInterventionMessage?: string;
}

export interface WindowRecord {
  workspaceId: string;
  tabs: WindowTabSummary[];
  activeTabId?: string;
}

export interface WorkspaceSummary {
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

export interface WindowSummary {
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

export type SidebarOrganizationEntry =
  | { id: string; kind: "tab"; tabId: string }
  | { id: string; kind: "folder"; folderId: string }
  | { id: string; kind: "split"; splitId: string };

export interface SidebarOrganizationFolderState {
  id: string;
  title: string;
  icon?: string;
  backgroundColor?: string;
  tabIds: string[];
  isExpanded: boolean;
}

export interface SidebarOrganizationSplitState {
  id: string;
  mode: "horizontal" | "vertical" | "bento";
  tabIds: string[];
  focusedTabId: string;
  syncScroll: boolean;
}

export interface SidebarOrganizationState {
  activeEntryId: string | null;
  entries: SidebarOrganizationEntry[];
  folders: Record<string, SidebarOrganizationFolderState>;
  splits: Record<string, SidebarOrganizationSplitState>;
}

export interface BrowserBootstrapData {
  appInfo: {
    name: string;
    version: string;
    platform: string;
  };
  currentWorkspace: WorkspaceSummary;
  currentWindow: WindowSummary;
  workspaces: WorkspaceSummary[];
  windows: WindowSummary[];
  sidebarOrganizationState?: SidebarOrganizationState;
}

export interface OpenCreateWorkspaceDialogInput {
  sourceWorkspaceId: string;
  sourceWorkspaceName?: string;
}

export interface OpenFolderSettingsDialogInput {
  workspaceId: string;
  folderId: string;
  name: string;
  icon?: string;
  backgroundColor?: string;
}

export interface FolderSettingsUpdateInput {
  workspaceId: string;
  folderId: string;
  name: string;
  icon?: string;
  backgroundColor?: string;
}

export type DeleteWorkspaceSkipReason = "protected" | "not_found" | "bound_agent";

export interface DeleteWorkspaceSkipDetail {
  workspaceId: string;
  reason: DeleteWorkspaceSkipReason;
  agentSessionId?: string;
  agentTitle?: string;
}

export interface DeleteWorkspacesResult {
  deletedWorkspaceIds: string[];
  skippedWorkspaceIds: string[];
  skippedDetails?: DeleteWorkspaceSkipDetail[];
}

export interface TabRecord {
  id: string;
  url: string;
  title: string;
  displayUrl: string;
  favicon?: string;
  historyEntries?: NavigationEntry[];
  historyIndex?: number;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  hasLoaded: boolean;
}

export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowTabLayoutTile extends ViewBounds {
  tabId: string;
}

export interface WindowTabLayoutState {
  focusedTabId: string;
  syncScroll: boolean;
  tiles: WindowTabLayoutTile[];
}

export interface TabLayoutUpdateInput {
  focusedTabId: string;
  syncScroll?: boolean;
  tiles: WindowTabLayoutTile[];
}

export interface TabScrollSyncPayload {
  top: number;
  left: number;
  maxTop: number;
  maxLeft: number;
}

export interface SplitViewDragPreviewPayload {
  mode: "horizontal" | "vertical";
  side: "left" | "right" | "top" | "bottom";
}

export interface SplitViewDragDropPayload extends SplitViewDragPreviewPayload {
  tabId: string;
}

export interface WindowWorkspaceCacheRecord {
  tabs: Map<string, TabRecord>;
  activeTabId?: string;
}

export interface WindowTabRuntimeLookupResult {
  workspaceId: string;
  tabs: Map<string, TabRecord>;
  tab: TabRecord;
  isCurrentWorkspace: boolean;
  isActiveTab: boolean;
}

export interface WorkspaceSessionTabRecord {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  historyEntries?: NavigationEntry[];
  historyIndex?: number;
}

export interface WorkspaceSessionRecord {
  workspaceId: string;
  tabs: WorkspaceSessionTabRecord[];
  activeTabIndex: number;
  updatedAt: number;
  sidebarState?: SidebarOrganizationState;
}

export interface CreateTabOptions {
  activate?: boolean;
  deferInitialLoad?: boolean;
  initialTitle?: string;
  initialFavicon?: string;
  existingView?: WebContentsView;
  managedByWindowOpen?: boolean;
  preserveRawUrl?: boolean;
  openerTabId?: string;
  sidebarGroupWithTabId?: string;
  creationSource?: "api" | "window_open";
  restoredTabId?: string;
  suppressStateBroadcast?: boolean;
  historyOpenSource?: {
    url: string;
    title?: string;
    linkUrl?: string;
    openedAt?: number;
  };
  restoredHistoryEntries?: NavigationEntry[];
  restoredHistoryIndex?: number;
}

export interface ContentsLanguageOverrideOptions {
  locale?: string;
  targetUrl?: string;
}
