export type WorkspaceProfileMode = "new" | "attached";

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

export interface BrowserShellAppInfo {
  name: string;
  version: string;
  platform: string;
}

export interface BrowserBootstrapData {
  appInfo: BrowserShellAppInfo;
  currentWorkspace: WorkspaceSummary;
  currentWindow: WindowSummary;
  workspaces: WorkspaceSummary[];
  windows: WindowSummary[];
  sidebarOrganizationState?: SidebarOrganizationState;
}

export interface CreateWorkspaceInput {
  name?: string;
  profileMode: WorkspaceProfileMode;
  profileSourceWorkspaceId?: string;
  appearanceSourceWorkspaceId?: string;
  showWindow: boolean;
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

export interface RenameWorkspaceInput {
  workspaceId: string;
  name: string;
}

export interface SwitchWorkspaceInput {
  workspaceId: string;
  sidebarWidth?: number;
  urlBarHeight?: number;
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

export interface CdpCommandInput {
  workspaceId: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface AutomationNavigateInput {
  workspaceId: string;
  url: string;
}

export interface AutomationEvaluateInput {
  workspaceId: string;
  expression: string;
  awaitPromise?: boolean;
  returnByValue?: boolean;
}

export interface SyncWindowStateInput {
  tabs: WindowTabSummary[];
  activeTabId?: string;
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
