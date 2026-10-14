import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { URL } from "node:url";
import { nativeImage, type WebContents } from "electron";
import type {
  LearningExtractionMode,
  LearningExtractionObservationInput,
  LearningExtractionRecipeSearchInput,
  LearningExtractionRecipeSearchResult,
  LearningGuidanceDetail,
  LearningGuidanceSearchInput,
  LearningGuidanceSearchResult,
  LearningPreferenceProfileSummary,
  LearningUserMemoryMutationResult,
  LearningUserMemorySignalInput,
  LearningUserMemoryUpsertInput,
} from "../learning/types.js";
import type {
  AgentModelPreferences,
  AgentPreferences,
  AppLanguage,
  LlmProvider,
  StartPageWidgetsState,
} from "../state/app-settings.js";
import { MAX_AGENT_PROFILE_INSTRUCTIONS_LENGTH } from "../state/app-settings.js";
import type { TranslationPreferences } from "../shared/translation.js";
import {
  AutomationToolError,
  isMcpToolResultEnvelope,
  type AutomationMcpService,
  type McpServerExport,
  type McpToolExport,
  type McpToolResultEnvelope,
} from "../mcp/automation-mcp.js";
import type { BookmarkFolderRecord, BookmarkRecord, HistoryRecord } from "../bridge/ipc.js";
import type { DownloadRecord } from "../services/downloads.js";
import type {
  UserScriptCreateInput,
  UserScriptRecord,
  UserScriptRunResult,
  UserScriptTestResult,
  UserScriptUpdateInput,
} from "../services/user-scripts.js";
import type {
  SaveWidgetPackageSourceInput,
  WidgetPackageFileRecord,
  WidgetPackageManifest,
  WidgetPackageSource,
  WidgetPackageSummary,
} from "../services/widget-registry.js";
import {
  generateUserScriptAgentDraft,
  type UserScriptAgentExistingScript,
  type UserScriptAgentMode,
} from "../services/user-script-agent.js";
import {
  cloneOrganizerSidebarState,
  collectOrganizerSplitTabIds,
  createDefaultOrganizerSidebarState,
  createOrganizerFolderGroup,
  findOrganizerFolderForTabId,
  groupOrganizerRootTabsByDomain,
  moveOrganizerTabsToFolder,
  renameOrganizerFolder,
  sortOrganizerRootTabs,
  type OrganizerSidebarState,
  type OrganizerSortDirection,
  type OrganizerSortStrategy,
  ungroupOrganizerFolders,
} from "./browser-organizer.js";
import { resolveOpenAICompatibleBackendConfig } from "./openai-compatible-config.js";
import {
  type AgentBackendToolDefinition,
  type OpenAICompatibleBackendConfig,
  type OpenAICompatibleChatMessage,
  type OpenAICompatibleContentPart,
} from "./openai-compatible-backend.js";
import {
  defineAgent,
  requestDefinedAgentTurn,
  resolveAgentTools,
} from "./define-agent.js";
import { createTriggerEventBus, type TriggerEvent } from "../triggers/trigger-event-bus.js";
import { createNodeTimeEventSource, type TimeSourceEvent } from "../triggers/time-event-source.js";

type AgentSessionStatus = "idle" | "running" | "waiting_event" | "queued" | "error" | "interrupted";
type AgentUiMessageRole = "system" | "user" | "assistant";
type AgentUiMessageKind = "message" | "tool" | "error";
type AgentFinishStatus = "completed" | "needs_user" | "blocked" | "failed";
type ExtractionAgentFinishStatus = "completed" | "blocked" | "failed";
type AgentSubAgentRunStatus =
  | "pending"
  | "running"
  | AgentFinishStatus
  | "cancelled";
type AgentSubAgentRunKind =
  | "delegated_task"
  | "extraction"
  | "bookmark_organizer"
  | "image_recognition"
  | "user_script"
  | "widget_builder";
const MANUAL_INTERVENTION_KIND_VALUES = [
  "human_verification",
  "verification_code",
  "login_required",
  "blocked",
] as const;
type ManualInterventionKind = typeof MANUAL_INTERVENTION_KIND_VALUES[number];
export type AgentSessionProfile = "default" | "organizer" | "widget-builder";
export type AgentSessionScope = "default" | "current-tab";
type SessionAgentId =
  | "browser-main-agent"
  | "browser-organizer-agent"
  | "browser-widget-builder-agent";
const FALLBACK_CHROME_VERSION = "120.0.0.0";

interface AgentUiMessage {
  id: string;
  role: AgentUiMessageRole;
  kind: AgentUiMessageKind;
  content: string;
  thinkingContent?: string;
  createdAt: number;
  state?: "running" | "completed" | "failed";
  toolName?: string;
  subAgentDetails?: AgentSubAgentDetails;
}

interface AgentSubAgentRunDetail {
  id: string;
  kind: AgentSubAgentRunKind;
  title: string;
  status: AgentSubAgentRunStatus;
  task?: string;
  startUrl?: string;
  tabId?: string;
  windowId?: number;
  workspaceId?: string;
  resourceKey?: string;
  conflictPolicy?: string;
  createdAt?: number;
  updatedAt?: number;
  startedAt?: number;
  finishedAt?: number;
  cancelRequestedAt?: number;
  cancelRequested?: boolean;
  summary?: string;
  nextStep?: string;
  lastError?: string;
  result?: Record<string, unknown>;
  steps?: string[];
}

interface AgentSubAgentDetails {
  kind: "sub_agents";
  updatedAt: number;
  runs: AgentSubAgentRunDetail[];
}

export interface AgentSessionContextSnapshot {
  activeTabId?: string;
  activeUrl?: string;
  activeTitle?: string;
  originTabId?: string;
  originUrl?: string;
  originTitle?: string;
  browserSessionCount: number;
  subscriptionCount: number;
  recentEventCount: number;
}

export interface AgentBackendSnapshot {
  configured: boolean;
  provider: "openai-compatible";
  providerId: string | null;
  providerName: string | null;
  endpoint: string | null;
  model: string | null;
  source: "env" | "agent-settings" | "image-agent-settings" | "translation-settings" | "missing";
}

export type AgentSessionScheduleTriggerStatus = "triggered" | "skipped" | "failed";
export type AgentSessionEventTriggerStatus = "triggered" | "skipped" | "failed";

export interface AgentSessionScheduleSnapshot {
  prompt: string;
  cronExpression: string;
  timezone: string;
  nextRunAt: number;
  lastTriggeredAt?: number;
  lastTriggerStatus?: AgentSessionScheduleTriggerStatus;
  lastTriggerError?: string;
}

export interface AgentSessionEventMatchSnapshot {
  kinds?: string[];
  source?: string;
  urlMatches?: string;
  titleMatches?: string;
  summaryMatches?: string;
}

export interface AgentSessionEventSnapshot {
  kind: string;
  ts: number;
  url?: string;
  title?: string;
  summary?: string;
  source?: string;
}

export interface AgentSessionEventTriggerSnapshot {
  prompt: string;
  channels: string[];
  match?: AgentSessionEventMatchSnapshot;
  awaitTimeoutMs: number;
  cooldownMs: number;
  lastTriggeredAt?: number;
  lastTriggerStatus?: AgentSessionEventTriggerStatus;
  lastTriggerError?: string;
  lastEvent?: AgentSessionEventSnapshot;
}

export interface AgentLaunchScheduleSnapshot {
  triggerId: string;
  workspaceId: string;
  windowId: number;
  scope: AgentSessionScope;
  privacyMode: boolean;
  profile: AgentSessionProfile;
  prompt: string;
  cronExpression: string;
  timezone: string;
  nextRunAt: number;
  createdAt: number;
  updatedAt: number;
  tabId?: string;
  title?: string;
  lastTriggeredAt?: number;
  lastTriggerStatus?: AgentSessionScheduleTriggerStatus;
  lastTriggerError?: string;
  lastSessionId?: string;
}

export type AgentPlanItemStatus = "pending" | "in_progress" | "completed" | "blocked" | "skipped";

export interface AgentPlanItemSnapshot {
  id: string;
  title: string;
  status: AgentPlanItemStatus;
  notes?: string;
}

export interface AgentPlanSnapshot {
  objective: string;
  revision: number;
  updatedAt: number;
  revisionReason?: string;
  items: AgentPlanItemSnapshot[];
}

export interface AgentSessionSnapshot {
  sessionId: string;
  workspaceId: string;
  windowId: number;
  privacyMode: boolean;
  automationWorkspaceBound: boolean;
  createdAt: number;
  updatedAt: number;
  title: string;
  preview: string;
  status: AgentSessionStatus;
  messages: AgentUiMessage[];
  context: AgentSessionContextSnapshot;
  backend: AgentBackendSnapshot;
  schedule?: AgentSessionScheduleSnapshot;
  eventTrigger?: AgentSessionEventTriggerSnapshot;
  plan?: AgentPlanSnapshot;
  lastError?: string;
}

export interface AgentSessionListItem {
  sessionId: string;
  workspaceId: string;
  windowId: number;
  privacyMode: boolean;
  automationWorkspaceBound: boolean;
  createdAt: number;
  updatedAt: number;
  title: string;
  preview: string;
  status: AgentSessionStatus;
  messageCount: number;
  context: AgentSessionContextSnapshot;
  schedule?: AgentSessionScheduleSnapshot;
  eventTrigger?: AgentSessionEventTriggerSnapshot;
  plan?: AgentPlanSnapshot;
  lastError?: string;
}

export interface AgentSessionUpdate {
  sessionId: string;
  reason: "created" | "message" | "status" | "tool" | "context" | "error" | "schedule" | "deleted";
  snapshot: AgentSessionSnapshot | null;
}

export interface AgentSessionDeleteResult {
  sessionId: string;
  deleted: boolean;
}

export interface AgentWorkspaceBindingSummary {
  sessionId: string;
  title: string;
}

export interface AgentMcpToolExport extends McpToolExport {}

export interface AgentMcpServerExport {
  sessionId: string;
  title: string;
  workspaceId: string;
  windowId: number;
  tabId?: string;
  automationWorkspaceBound: boolean;
  server: {
    name: string;
    version: string;
  };
  tools: AgentMcpToolExport[];
}

export interface AgentMcpToolCallInput {
  sessionId: string;
  name: string;
  input?: Record<string, unknown> | null;
}

type TransportMessage =
  | {
    role: "user" | "system";
    content: string;
  }
  | {
    role: "assistant";
    content: string | null;
    thinkingContent?: string;
    toolCalls?: Array<{
      id: string;
      name: string;
      argumentsText: string;
    }>;
  }
  | {
    role: "tool";
    content: string;
    toolCallId: string;
    name: string;
  };

interface KnownBrowserSession {
  sessionId: string;
  tabId: string;
  windowId?: string;
  url?: string;
  title?: string;
  attachedAt: number;
}

interface KnownSourceTab {
  sourceTabRef: string;
  workspaceId: string;
  windowId: number;
  tabId: string;
  title?: string;
  url?: string;
  displayUrl?: string;
  isActive?: boolean;
  rememberedAt: number;
}

interface KnownSubscription {
  subscriptionId: string;
  sessionId: string;
  startedAt: number;
  channels: string[];
  cursorSeq?: number;
  lastReadAt?: number;
}

interface KnownBrowserEvent {
  kind: string;
  ts?: number;
  summary?: string;
  windowId?: string;
  tabId?: string;
  openerTabId?: string;
  url?: string;
  title?: string;
  source?: string;
  state?: string;
  filename?: string;
  message?: string;
  selector?: string;
  backendNodeId?: number;
  axNodeId?: string;
  axRole?: string;
  axName?: string;
  axResolvedDepth?: number;
  axResolvedSelector?: string;
  axDiffSummary?: string;
}

interface AgentRuntimeContext {
  browserSessions: Map<string, KnownBrowserSession>;
  sourceTabs: Map<string, KnownSourceTab>;
  subscriptions: Map<string, KnownSubscription>;
  recentEvents: KnownBrowserEvent[];
}

interface AgentFinishResult {
  ok: true;
  status: AgentFinishStatus;
  summary: string;
  nextStep?: string;
}

interface ManualInterventionRequest {
  kind: ManualInterventionKind;
  message: string;
}

interface ExtractionAgentFinishResult {
  ok: true;
  status: ExtractionAgentFinishStatus;
  summary: string;
  result?: Record<string, unknown>;
  nextStep?: string;
}

interface AgentSessionState {
  sessionId: string;
  agentId: SessionAgentId;
  workspaceId: string;
  windowId: number;
  scope: AgentSessionScope;
  automationTabId?: string;
  originTabId?: string;
  originUrl?: string;
  originTitle?: string;
  originWorkspaceId: string;
  originWindowId: number;
  privacyMode: boolean;
  automationWorkspaceBound: boolean;
  schedule: AgentSessionScheduleSnapshot | null;
  plan: AgentPlanSnapshot | null;
  createdAt: number;
  updatedAt: number;
  status: AgentSessionStatus;
  lastError?: string;
  transportMessages: TransportMessage[];
  uiMessages: AgentUiMessage[];
  runtimeContext: AgentRuntimeContext;
  delegatedTasks: Map<string, DelegatedTaskState>;
  delegatedTaskWaiters: Map<string, DelegatedTaskWaiter>;
  eventTrigger: AgentSessionEventTriggerSnapshot | null;
  queuedTurn: boolean;
  runningPromise: Promise<void> | null;
  activeAbortController: AbortController | null;
  terminalResult: AgentFinishResult | null;
  manualInterventionPending: boolean;
  interruptRequested: boolean;
  deleted: boolean;
}

interface AgentSessionStoragePayload {
  version: number;
  sessions: PersistedAgentSessionRecord[];
}

interface PersistedAgentSessionRecord {
  sessionId: string;
  agentId?: SessionAgentId;
  workspaceId: string;
  windowId: number;
  scope?: AgentSessionScope;
  automationTabId?: string;
  originTabId?: string;
  originUrl?: string;
  originTitle?: string;
  originWorkspaceId?: string;
  originWindowId?: number;
  privacyMode?: boolean;
  automationWorkspaceBound?: boolean;
  createdAt: number;
  updatedAt: number;
  status: AgentSessionStatus;
  schedule?: AgentSessionScheduleSnapshot;
  eventTrigger?: AgentSessionEventTriggerSnapshot;
  plan?: AgentPlanSnapshot;
  lastError?: string;
  terminalResult?: AgentFinishResult;
  transportMessages: TransportMessage[];
  uiMessages: AgentUiMessage[];
}

interface PersistedAgentSessionFileRecord extends PersistedAgentSessionRecord {
  version: number;
}

interface WindowTabContext {
  id: string;
  title: string;
  url: string;
  displayUrl: string;
  isActive: boolean;
}

interface BrowserWindowContext {
  activeTabId?: string;
  activeUrl?: string;
  activeTitle?: string;
  tabs: WindowTabContext[];
}

interface AgentSessionScheduleInput {
  sessionId: string;
  cronExpression: string;
  prompt?: string;
}

interface AgentLaunchScheduleInput {
  cronExpression: string;
  prompt: string;
  privacyMode?: boolean;
  profile?: AgentSessionProfile;
  scope?: AgentSessionScope;
  tabId?: string;
  title?: string;
  triggerId?: string;
  windowId: number;
  workspaceId: string;
}

type SessionScheduleToolAction = "get" | "set" | "clear";
type AgentLaunchScheduleToolAction = "list" | "get" | "set" | "clear";
type AgentPlanToolAction = "get" | "set" | "update" | "revise" | "clear";
type AgentProfileToolAction = "get" | "set" | "update" | "clear";
type UserMemoryToolAction = "get" | "upsert" | "delete" | "reject";

interface BrowserAgentServiceOptions {
  automationService: AutomationMcpService;
  getAgentPreferences: () => AgentPreferences;
  setAgentPreferences: (input?: Partial<AgentPreferences> | null) => AgentPreferences;
  getLlmProviders: () => LlmProvider[];
  getImageAgentPreferences?: () => AgentModelPreferences;
  getTranslationPreferences: () => TranslationPreferences;
  getProfileIdForWorkspace?: (workspaceId: string) => string;
  persistBookmarksState?: (input: {
    profileId: string;
    bookmarks: BookmarkRecord[];
    folders: BookmarkFolderRecord[];
  }) => {
    bookmarks: BookmarkRecord[];
    folders: BookmarkFolderRecord[];
  };
  getBookmarks?: (profileId?: string) => BookmarkRecord[];
  getBookmarkFolders?: (profileId?: string) => BookmarkFolderRecord[];
  getHistoryRecords?: (profileId?: string) => HistoryRecord[];
  getDownloads?: () => DownloadRecord[];
  pauseDownload?: (id: string) => Promise<DownloadRecord>;
  resumeDownload?: (id: string) => Promise<DownloadRecord>;
  cancelDownload?: (id: string) => Promise<DownloadRecord>;
  retryDownload?: (id: string) => Promise<DownloadRecord>;
  removeDownloadRecord?: (
    id: string,
    options?: { deleteFile?: boolean },
  ) => Promise<DownloadRecord[]>;
  deleteDownloadFile?: (id: string) => Promise<DownloadRecord>;
  listUserScripts?: (profileId: string) => UserScriptRecord[];
  listMatchingUserScripts?: (profileId: string, url: string) => UserScriptRecord[];
  createUserScript?: (profileId: string, input: UserScriptCreateInput) => UserScriptRecord;
  updateUserScript?: (profileId: string, scriptId: string, input: UserScriptUpdateInput) => UserScriptRecord;
  runUserScriptNow?: (
    profileId: string,
    targetContents: WebContents,
    scriptId: string,
  ) => Promise<UserScriptRunResult>;
  runUserScriptTest?: (
    profileId: string,
    targetContents: WebContents,
    scriptId: string,
  ) => Promise<UserScriptTestResult>;
  getSidebarOrganizationState?: (input: {
    windowId: number;
    workspaceId: string;
  }) => OrganizerSidebarState;
  applySidebarOrganizationState?: (input: {
    windowId: number;
    workspaceId: string;
    state: OrganizerSidebarState;
  }) => OrganizerSidebarState;
  searchLearningGuidance?: (input: LearningGuidanceSearchInput) => LearningGuidanceSearchResult;
  searchLearningExtractionRecipes?: (input: LearningExtractionRecipeSearchInput) => LearningExtractionRecipeSearchResult;
  recordLearningExtractionObservation?: (input: LearningExtractionObservationInput) => { success: boolean };
  getLearningGuidanceDetail?: (input: {
    workspaceId: string;
    guidanceId: string;
  }) => LearningGuidanceDetail | null;
  getUserMemory?: (input?: { profileId?: string; workspaceId?: string }) => LearningPreferenceProfileSummary | null;
  upsertUserMemory?: (input: LearningUserMemoryUpsertInput) => LearningUserMemoryMutationResult;
  deleteUserMemory?: (input: LearningUserMemorySignalInput) => LearningUserMemoryMutationResult;
  rejectUserMemory?: (input: LearningUserMemorySignalInput) => LearningUserMemoryMutationResult;
  getWidgetRegistryRootDirectory?: () => string;
  listWidgetPackages?: () => WidgetPackageSummary[];
  getWidgetPackageSource?: (packageId: string) => WidgetPackageSource | null;
  saveWidgetPackageSource?: (input: SaveWidgetPackageSourceInput) => WidgetPackageSource;
  getStartPageWidgetsState?: (workspaceId?: string) => StartPageWidgetsState;
  addStartPageProtocolWidget?: (input: {
    gridH?: number;
    gridW?: number;
    workspaceId?: string;
    source: string;
    title?: string;
    skipIfExists?: boolean;
  }) => {
    added: boolean;
    widgetId: string;
    widgetsState: {
      migrated: boolean;
    };
  };
  resolveUiLocale: () => AppLanguage;
  getWindowContext: (windowId: number) => BrowserWindowContext;
  getTabWebContents: (tabId: string) => WebContents | null;
  getStartPageUrl: () => string;
  isWindowOpen: (windowId: number) => boolean;
  resolveWorkspaceIdForWindow?: (windowId: number) => string | undefined;
  resolveDefaultMcpTarget?: () => {
    workspaceId: string;
    windowId: number;
  } | null;
  ensureAutomationWorkspaceBinding: (input: {
    sessionId: string;
    workspaceId?: string;
    windowId?: number;
    tabId?: string;
    originWorkspaceId?: string;
    privacyMode?: boolean;
    title: string;
  }) => Promise<{
    workspaceId: string;
    windowId: number;
    tabId: string;
  }>;
  onAutomationWorkspaceReleased?: (input: {
    sessionId: string;
    workspaceId: string;
  }) => void;
  onControlledTabsChanged?: (payload: { workspaceId: string; windowId: number }) => void;
  onSessionRunFinished?: (snapshot: AgentSessionSnapshot) => void;
  onManualInterventionRequested?: (payload: {
    sessionId: string;
    workspaceId: string;
    windowId: number;
    tabId: string;
    kind: ManualInterventionKind;
    message: string;
  }) => void;
  agentTasksDirectoryPath: string;
  legacyAgentStatePath: string;
  legacyAgentStateBackupPath: string;
}

const MAX_RECENT_EVENTS = 12;
const MAX_CONTEXT_CHARS = 16_000;
const MAX_IMAGE_REFERENCE_COUNT = 32;
const MAX_IMAGE_RECOGNITION_LONG_EDGE = 1024;
const MAX_IMAGE_RECOGNITION_PIXELS = 1_200_000;
const MAX_TASK_TITLE_CHARS = 48;
const MAX_TASK_PREVIEW_CHARS = 120;
const CRON_LOOKAHEAD_MINUTES = 366 * 24 * 60 * 5;
const EXTRACTION_CONFIRMATION_MAX_TOOL_LOOKBACK = 8;
const EXTRACTION_CONFIRMATION_MAX_OBSERVED_TEXTS = 3;
const AGENT_STATE_VERSION = 3;
const AGENT_STATE_SAVE_DELAY_MS = 180;
const AGENT_LAUNCH_SCHEDULES_STATE_VERSION = 1;
const AGENT_LAUNCH_SCHEDULES_FILE_NAME = "launch-schedules.json";
const LEGACY_CLIPPED_UI_MESSAGE_COUNT = 80;
const BROWSER_CONTEXT_TOOL_NAME = "browser_context_get";
const BROWSER_RUNTIME_TOOL_NAME = "browser_runtime_get";
const SOURCE_WORKSPACE_CONTEXT_TOOL_NAME = "source_workspace_context_get";
const SOURCE_TAB_SNAPSHOT_TOOL_NAME = "source_tab_snapshot";
const SOURCE_TAB_EXTRACT_TOOL_NAME = "source_tab_extract";
const SOURCE_TAB_CLONE_TOOL_NAME = "source_tab_clone_to_automation";
const TIME_TOOL_NAME = "time_get";
const AGENT_PLAN_TOOL_NAME = "agent_plan_manage";
const AGENT_PROFILE_TOOL_NAME = "agent_profile_manage";
const USER_MEMORY_TOOL_NAME = "user_memory_manage";
const SESSION_SCHEDULE_TOOL_NAME = "agent_schedule_manage";
const AGENT_LAUNCH_SCHEDULE_TOOL_NAME = "agent_launch_schedule_manage";
const EVENT_TRIGGER_TOOL_NAME = "agent_event_trigger_manage";
const CURRENT_TAB_SCOPE_SYSTEM_PREFIX = "Current-tab scope:";
const ASK_HUMAN_HELP_TOOL_NAME = "askHumanHelp";
const ASK_HUMAN_HELP_TOOL_DESCRIPTION =
  "Request human intervention for the current browser task. "
  + "Use this when a login page, account sign-in, CAPTCHA, human verification, verification code, or other manual-only step blocks automation, "
  + "or when the agent cannot complete the task by itself after reasonable inspection. "
  + "A task-relevant page showing only login, sign-up, registration, account picker, or access-gated content is a login_required blocker even if the visible auth screen can be inspected, unless the user explicitly asked to analyze that auth screen itself. "
  + "If you are about to tell the user that login is required or that the current page is a login/register page, call this tool with kind=login_required instead of continuing with screenshots, planning, or unrelated page analysis. "
  + "This will surface the relevant tab to the user and display a prompt on that tab.";
const ASK_HUMAN_HELP_TOOL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  properties: {
    reason: {
      type: "string",
      description: "Why automation is blocked and what the human needs to do.",
    },
    kind: {
      type: "string",
      enum: [...MANUAL_INTERVENTION_KIND_VALUES],
      description:
        "Type of human help needed: login_required for sign-in/account access, verification_code for OTP/2FA, human_verification for CAPTCHA or anti-bot checks, blocked for other manual-only blockers.",
    },
    message: {
      type: "string",
      description: "Optional short prompt shown on the surfaced tab. Defaults to a localized built-in prompt.",
    },
    tabId: {
      type: "string",
      description: "Optional explicit tab id to surface.",
    },
    browserSessionId: {
      type: "string",
      description: "Optional attached browser session id used to resolve the tab when tabId is omitted.",
    },
  },
  required: ["reason", "kind"],
  additionalProperties: false,
};
const ELEMENT_SCREENSHOT_TOOL_NAME = "browser_capture_element_screenshot";
const IMAGE_RECOGNITION_TOOL_NAME = "agent_recognize_image";
const USER_SCRIPT_DRAFT_TOOL_NAME = "agent_generate_user_script";
const USER_SCRIPT_INSTALL_TOOL_NAME = "user_script_install";
const USER_SCRIPT_CURRENT_PAGE_LIST_TOOL_NAME = "user_scripts_list_for_current_page";
const BOOKMARK_ORGANIZER_TOOL_NAME = "agent_organize_bookmarks";
const BOOKMARK_ORGANIZER_FINISH_TOOL_NAME = "bookmark_organizer_finish";
const HISTORY_SEARCH_TOOL_NAME = "browser_history_search";
const ORGANIZER_SNAPSHOT_TOOL_NAME = "browser_organizer_snapshot";
const ORGANIZER_TABS_TOOL_NAME = "browser_organizer_tabs";
const ORGANIZER_BOOKMARKS_TOOL_NAME = "browser_organizer_bookmarks";
const ORGANIZER_DOWNLOADS_TOOL_NAME = "browser_organizer_downloads";
const AGENT_FINISH_TOOL_NAME = "agent_finish"; // Legacy-only: kept for old session recovery and stale tool-call rejection.
const LEARNING_GUIDANCE_TOOL_NAME = "browser_learning_lookup";
const DATA_EXTRACTION_TOOL_NAME = "agent_extract_data";
const SUBTASK_AGENT_FINISH_TOOL_NAME = "subtask_agent_finish";
const EXTRACTION_AGENT_FINISH_TOOL_NAME = "extraction_agent_finish";
const TASK_TOOL_NAME = "task";
const START_PAGE_CURRENT_WIDGETS_LIST_TOOL_NAME = "start_page_current_widgets_list";
const START_PAGE_WIDGETS_LIST_TOOL_NAME = "start_page_widgets_list";
const START_PAGE_WIDGET_DOCS_READ_TOOL_NAME = "start_page_widget_docs_read";
const START_PAGE_WIDGET_PACKAGE_READ_TOOL_NAME = "start_page_widget_package_read";
const START_PAGE_WIDGET_PACKAGE_FILES_LIST_TOOL_NAME = "start_page_widget_package_files_list";
const START_PAGE_WIDGET_PACKAGE_FILES_READ_TOOL_NAME = "start_page_widget_package_files_read";
const START_PAGE_WIDGET_PACKAGE_FILES_SEARCH_TOOL_NAME = "start_page_widget_package_files_search";
const START_PAGE_WIDGET_PACKAGE_FILES_EDIT_TOOL_NAME = "start_page_widget_package_files_edit";
const START_PAGE_WIDGET_PACKAGE_SAVE_TOOL_NAME = "start_page_widget_package_save";
const START_PAGE_WIDGET_ADD_TOOL_NAME = "start_page_widget_add";
const START_PAGE_WIDGET_BUILDER_TOOL_NAME = "agent_create_start_page_widget";
const START_PAGE_SYSTEM_MESSAGE_PREFIX = "The Milo start page URL is ";
const SESSION_DATE_ANCHOR_PREFIX = "At session start, local date was ";
const ORGANIZER_PROFILE_SYSTEM_PREFIX = "Specialization: organizer";
const WIDGET_BUILDER_PROFILE_SYSTEM_PREFIX = "Specialization: widget-builder";
const MAIN_BROWSER_AGENT_ID: SessionAgentId = "browser-main-agent";
const ORGANIZER_BROWSER_AGENT_ID: SessionAgentId = "browser-organizer-agent";
const WIDGET_BUILDER_BROWSER_AGENT_ID: SessionAgentId = "browser-widget-builder-agent";
const MAIN_AGENT_MCP_SERVER_NAME = "milo-main-agent-mcp";
const MAIN_AGENT_MCP_TOOL_NAME = "browser_main_agent";
const DEFAULT_EVENT_TRIGGER_CHANNELS = ["dom", "navigation"] as const;
const DEFAULT_EVENT_TRIGGER_AWAIT_TIMEOUT_MS = 120_000;
const DEFAULT_EVENT_TRIGGER_COOLDOWN_MS = 15_000;
const EVENT_TRIGGER_RETRY_DELAY_MS = 5_000;
const AGENT_SESSION_SCHEDULE_TIME_SOURCE_PREFIX = "agent-session-schedule:";
const AGENT_LAUNCH_SCHEDULE_TIME_SOURCE_PREFIX = "agent-launch-schedule:";
const WIDGET_PACKAGE_SEARCH_DEFAULT_LIMIT = 50;
const WIDGET_PACKAGE_SEARCH_MAX_LIMIT = 200;
const WIDGET_PACKAGE_VALIDATION_MAX_FINDINGS = 20;
const WIDGET_AUTOMATION_ALLOWED_BROWSER_CALL_TOOLS = new Set([
  "page.open",
  "page.snapshot",
  "page.extract",
  "page.interact",
  "extract.records",
  "browser.extract_data",
  "browser.navigate",
  "browser.get_page_context",
]);
const EVENT_TRIGGER_CHANNEL_VALUES = [
  "input",
  "navigation",
  "dom",
  "dialog",
  "download",
  "tab",
  "network",
  "runtime",
  "focus",
  "selection",
] as const;

interface LocalAgentToolExecutionContext {
  uiMessageId?: string;
}

interface LocalAgentToolDefinition extends AgentBackendToolDefinition {
  execute: (
    input: Record<string, unknown>,
    session: AgentSessionState,
    context?: LocalAgentToolExecutionContext,
  ) => Promise<unknown> | unknown;
}

interface ExtractionAgentToolDefinition extends AgentBackendToolDefinition {
  execute: (
    input: Record<string, unknown>,
    runtime: ExtractionAgentRuntime,
    session: AgentSessionState,
  ) => Promise<unknown> | unknown;
}

interface ExtractionAgentRuntime {
  page: Record<string, unknown>;
  transportMessages: TransportMessage[];
  terminalResult: ExtractionAgentFinishResult | null;
  toolSummaries: string[];
  snapshotRegionHints: Map<string, {
    regionRole?: string;
    regionName?: string;
    regionHint?: string;
  }>;
  latestExtractionObservation: {
    extractionMode: LearningExtractionMode;
    sourceRole?: string;
    regionRole?: string;
    regionName?: string;
    regionHint?: string;
    fieldKeys: string[];
    keywords: string[];
  } | null;
}

interface ExtractionTargetContext {
  tabId: string;
  source: "attached_session" | "active_tab";
  browserSessionId?: string;
  url?: string;
  title?: string;
}

interface StoredImageReference {
  ref: string;
  sessionId: string;
  createdAt: number;
  mimeType: "image/png";
  dataUrl: string;
  width: number;
  height: number;
  tabId: string;
  selector: string;
  matchedBy: "direct" | "semantic";
  url?: string;
  title?: string;
}

interface ExtractionPageConfirmation {
  summary: string;
  observedTexts: string[];
}

interface ExtractionPageReadiness {
  status: "verified" | "hint_only" | "missing";
  confirmation: ExtractionPageConfirmation | null;
  note: string;
  nextStep?: string;
}

interface SubtaskAgentFinishResult {
  ok: true;
  status: AgentFinishStatus;
  summary: string;
  result?: Record<string, unknown>;
  nextStep?: string;
}

interface OwnedSubtaskTab {
  tabId: string;
  windowId?: number;
}

interface SubtaskAgentRuntime {
  tabId: string;
  windowId: number;
  transportMessages: TransportMessage[];
  runtimeContext: AgentRuntimeContext;
  terminalResult: SubtaskAgentFinishResult | null;
  toolSummaries: string[];
  ownedTabs: Map<string, OwnedSubtaskTab>;
}

interface SubtaskAgentToolDefinition extends AgentBackendToolDefinition {
  execute: (
    input: Record<string, unknown>,
    runtime: SubtaskAgentRuntime,
    session: AgentSessionState,
  ) => Promise<unknown> | unknown;
}

type DelegatedTaskStatus = "pending" | "running" | AgentFinishStatus | "cancelled";
type DelegatedTaskConflictPolicy = "independent" | "host_serialized" | "exclusive";

interface DelegatedTaskRunResult extends SubtaskAgentFinishResult {
  taskId: string;
  tabId: string;
  windowId: number;
  workspaceId: string;
  steps: string[];
}

interface DelegatedTaskState {
  taskId: string;
  task: string;
  uiMessageId?: string;
  startUrl?: string;
  conflictPolicy: DelegatedTaskConflictPolicy;
  resourceKey: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  cancelRequestedAt?: number;
  status: DelegatedTaskStatus;
  tabId?: string;
  windowId?: number;
  summary?: string;
  nextStep?: string;
  result?: Record<string, unknown>;
  steps: string[];
  lastError?: string;
  abortController: AbortController | null;
  promise: Promise<void> | null;
}

interface DelegatedTaskWaiter {
  waiterId: string;
  taskIds?: Set<string>;
  resolve: (result: Record<string, unknown>) => void;
}

interface SessionEventWatcherState {
  sessionId: string;
  loopPromise: Promise<void> | null;
  stopRequested: boolean;
  browserSession?: {
    sessionId: string;
    tabId: string;
  };
  subscriptionId?: string;
}

function encodeSessionIdForFilename(sessionId: string) {
  return encodeURIComponent(sessionId);
}

function getSessionStateFilePath(tasksDirectoryPath: string, sessionId: string) {
  return join(tasksDirectoryPath, `${encodeSessionIdForFilename(sessionId)}.json`);
}

function getSessionStateTempFilePath(tasksDirectoryPath: string, sessionId: string) {
  return `${getSessionStateFilePath(tasksDirectoryPath, sessionId)}.tmp`;
}

function isPersistedSessionFilename(filename: string) {
  return filename.endsWith(".json") && filename !== AGENT_LAUNCH_SCHEDULES_FILE_NAME;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseToolCallArguments(toolCall: { name: string; argumentsText: string }) {
  try {
    const raw = toolCall.argumentsText.trim() ? JSON.parse(toolCall.argumentsText) : {};
    if (!isRecord(raw)) {
      throw new Error("Tool arguments must be a JSON object.");
    }
    return {
      ok: true as const,
      arguments: raw,
    };
  } catch (error) {
    return {
      ok: false as const,
      error: `${toolCall.name} received invalid JSON arguments: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringifyForMcpContent(value: unknown) {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized : String(value);
  } catch {
    return String(value);
  }
}

function wrapMcpToolResult(output: unknown): McpToolResultEnvelope {
  if (isMcpToolResultEnvelope(output)) {
    return output;
  }

  return {
    content: [
      {
        type: "text",
        text: stringifyForMcpContent(output),
      },
    ],
    structuredContent: output,
  };
}

function wrapMcpToolError(toolName: string, error: unknown): McpToolResultEnvelope {
  const details = error instanceof AutomationToolError
    ? error.toJSON()
    : {
        errorCode: "MCP_TOOL_CALL_FAILED",
        category: "execution" as const,
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      };
  const structuredContent = {
    ok: false,
    toolName,
    error: details,
  };

  return {
    content: [
      {
        type: "text",
        text: stringifyForMcpContent(structuredContent),
      },
    ],
    structuredContent,
    isError: true,
  };
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Number(value) : undefined;
}

function readWindowIdNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readAgentFinishStatus(value: unknown): AgentFinishStatus | undefined {
  return value === "completed" || value === "needs_user" || value === "blocked" || value === "failed"
    ? value
    : undefined;
}

function readAgentSubAgentRunStatus(value: unknown): AgentSubAgentRunStatus | undefined {
  return value === "pending"
    || value === "running"
    || value === "completed"
    || value === "needs_user"
    || value === "blocked"
    || value === "failed"
    || value === "cancelled"
    ? value
    : undefined;
}

function readAgentSubAgentRunKind(value: unknown): AgentSubAgentRunKind | undefined {
  return value === "delegated_task"
    || value === "extraction"
    || value === "bookmark_organizer"
    || value === "image_recognition"
    || value === "user_script"
    || value === "widget_builder"
    ? value
    : undefined;
}

function readDelegatedTaskConflictPolicy(value: unknown): DelegatedTaskConflictPolicy | undefined {
  return value === "independent" || value === "host_serialized" || value === "exclusive"
    ? value
    : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readAgentSessionScheduleTriggerStatus(value: unknown): AgentSessionScheduleTriggerStatus | undefined {
  return value === "triggered" || value === "skipped" || value === "failed"
    ? value
    : undefined;
}

function readAgentSessionEventTriggerStatus(value: unknown): AgentSessionEventTriggerStatus | undefined {
  return value === "triggered" || value === "skipped" || value === "failed"
    ? value
    : undefined;
}

function readSessionScheduleToolAction(value: unknown): SessionScheduleToolAction | undefined {
  return value === "get" || value === "set" || value === "clear"
    ? value
    : undefined;
}

function readAgentLaunchScheduleToolAction(value: unknown): AgentLaunchScheduleToolAction | undefined {
  return value === "list" || value === "get" || value === "set" || value === "clear"
    ? value
    : undefined;
}

function readAgentPlanToolAction(value: unknown): AgentPlanToolAction | undefined {
  return value === "get" || value === "set" || value === "update" || value === "revise" || value === "clear"
    ? value
    : undefined;
}

function readAgentProfileToolAction(value: unknown): AgentProfileToolAction | undefined {
  return value === "get" || value === "set" || value === "update" || value === "clear"
    ? value
    : undefined;
}

function readUserMemoryToolAction(value: unknown): UserMemoryToolAction | undefined {
  return value === "get" || value === "upsert" || value === "delete" || value === "reject"
    ? value
    : undefined;
}

function readAgentPlanItemStatus(value: unknown): AgentPlanItemStatus | undefined {
  return value === "pending"
    || value === "in_progress"
    || value === "completed"
    || value === "blocked"
    || value === "skipped"
    ? value
    : undefined;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    const text = readString(entry);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    result.push(text);
  }
  return result;
}

function sanitizeAgentSubAgentRunDetail(value: unknown, index: number): AgentSubAgentRunDetail | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id) ?? readString(value.taskId) ?? readString(value.runId) ?? `sub-agent-${index + 1}`;
  const kind = readAgentSubAgentRunKind(value.kind) ?? "delegated_task";
  const status = readAgentSubAgentRunStatus(value.status);
  const title = readString(value.title) ?? readString(value.task) ?? `${kind} ${index + 1}`;
  if (!status) {
    return null;
  }

  const steps = readStringArray(value.steps);
  const result = isRecord(value.result) ? value.result : undefined;
  const detail: AgentSubAgentRunDetail = {
    id,
    kind,
    title,
    status,
    ...(readString(value.task) ? { task: readString(value.task) } : {}),
    ...(readString(value.startUrl) ? { startUrl: readString(value.startUrl) } : {}),
    ...(readString(value.tabId) ? { tabId: readString(value.tabId) } : {}),
    ...(readWindowIdNumber(value.windowId) !== undefined ? { windowId: readWindowIdNumber(value.windowId) } : {}),
    ...(readString(value.workspaceId) ? { workspaceId: readString(value.workspaceId) } : {}),
    ...(readString(value.resourceKey) ? { resourceKey: readString(value.resourceKey) } : {}),
    ...(readString(value.conflictPolicy) ? { conflictPolicy: readString(value.conflictPolicy) } : {}),
    ...(readNumber(value.createdAt) !== undefined ? { createdAt: readNumber(value.createdAt) } : {}),
    ...(readNumber(value.updatedAt) !== undefined ? { updatedAt: readNumber(value.updatedAt) } : {}),
    ...(readNumber(value.startedAt) !== undefined ? { startedAt: readNumber(value.startedAt) } : {}),
    ...(readNumber(value.finishedAt) !== undefined ? { finishedAt: readNumber(value.finishedAt) } : {}),
    ...(readNumber(value.cancelRequestedAt) !== undefined ? { cancelRequestedAt: readNumber(value.cancelRequestedAt) } : {}),
    ...(readBoolean(value.cancelRequested) !== undefined ? { cancelRequested: readBoolean(value.cancelRequested) } : {}),
    ...(readString(value.summary) ? { summary: readString(value.summary) } : {}),
    ...(readString(value.nextStep) ? { nextStep: readString(value.nextStep) } : {}),
    ...(readString(value.lastError) ? { lastError: readString(value.lastError) } : {}),
    ...(result ? { result } : {}),
    ...(steps.length > 0 ? { steps } : {}),
  };

  return detail;
}

function sanitizeAgentSubAgentDetails(value: unknown): AgentSubAgentDetails | undefined {
  if (!isRecord(value) || value.kind !== "sub_agents" || !Array.isArray(value.runs)) {
    return undefined;
  }

  const runs = value.runs
    .map((entry, index) => sanitizeAgentSubAgentRunDetail(entry, index))
    .filter((entry): entry is AgentSubAgentRunDetail => entry !== null);
  if (runs.length === 0) {
    return undefined;
  }

  return {
    kind: "sub_agents",
    updatedAt: readNumber(value.updatedAt) ?? Date.now(),
    runs,
  };
}

function cloneAgentSubAgentDetails(details: AgentSubAgentDetails | undefined): AgentSubAgentDetails | undefined {
  if (!details) {
    return undefined;
  }

  return {
    kind: "sub_agents",
    updatedAt: details.updatedAt,
    runs: details.runs.map((run) => ({
      ...run,
      ...(run.steps ? { steps: [...run.steps] } : {}),
      ...(run.result ? { result: { ...run.result } } : {}),
    })),
  };
}

function readManualInterventionKind(value: unknown): ManualInterventionKind | undefined {
  return MANUAL_INTERVENTION_KIND_VALUES.find((kind) => kind === value);
}

function readUserScriptAgentMode(value: unknown): UserScriptAgentMode | undefined {
  return value === "script" || value === "test" || value === "script-and-test"
    ? value
    : undefined;
}

function getLocalTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Local";
  } catch {
    return "Local";
  }
}

interface ParsedCronExpression {
  normalizedExpression: string;
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  dayOfMonthWildcard: boolean;
  dayOfWeekWildcard: boolean;
}

const CRON_MONTH_ALIASES = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
} satisfies Record<string, number>;

const CRON_DAY_OF_WEEK_ALIASES = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
} satisfies Record<string, number>;

function normalizeCronExpression(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeCronDayOfWeekValue(value: number) {
  return value === 7 ? 0 : value;
}

function parseCronFieldValue(
  rawValue: string,
  min: number,
  max: number,
  options?: {
    aliases?: Readonly<Record<string, number>>;
    normalize?: (value: number) => number;
  },
) {
  const value = rawValue.trim().toUpperCase();
  if (!value) {
    throw new Error("Cron field contains an empty token.");
  }

  const aliasValue = options?.aliases?.[value];
  const numericValue = aliasValue ?? Number.parseInt(value, 10);
  if (!Number.isFinite(numericValue)) {
    throw new Error(`Invalid cron token "${rawValue}".`);
  }

  const normalizedValue = options?.normalize ? options.normalize(numericValue) : numericValue;
  if (normalizedValue < min || normalizedValue > max) {
    throw new Error(`Cron value "${rawValue}" is outside the allowed range ${min}-${max}.`);
  }

  return normalizedValue;
}

function addCronRangeValues(
  output: Set<number>,
  start: number,
  end: number,
  step: number,
  options?: {
    normalize?: (value: number) => number;
  },
) {
  if (step <= 0) {
    throw new Error("Cron step must be a positive integer.");
  }
  if (end < start) {
    throw new Error("Cron ranges must be ascending.");
  }

  for (let value = start; value <= end; value += step) {
    output.add(options?.normalize ? options.normalize(value) : value);
  }
}

function parseCronField(
  rawField: string,
  min: number,
  max: number,
  options?: {
    aliases?: Readonly<Record<string, number>>;
    normalize?: (value: number) => number;
  },
) {
  const field = rawField.trim();
  if (!field) {
    throw new Error("Cron field cannot be empty.");
  }

  const values = new Set<number>();
  const segments = field.split(",");
  for (const segment of segments) {
    const trimmedSegment = segment.trim();
    if (!trimmedSegment) {
      throw new Error("Cron field contains an empty list segment.");
    }

    const [basePart, stepPart, overflowPart] = trimmedSegment.split("/");
    if (overflowPart !== undefined) {
      throw new Error(`Invalid cron segment "${trimmedSegment}".`);
    }

    const step = stepPart === undefined ? 1 : Number.parseInt(stepPart.trim(), 10);
    if (!Number.isFinite(step) || step <= 0) {
      throw new Error(`Invalid cron step "${stepPart}".`);
    }

    if (basePart === "*") {
      addCronRangeValues(values, min, max, step, options);
      continue;
    }

    if (basePart.includes("-")) {
      const [startPart, endPart, extraRangePart] = basePart.split("-");
      if (extraRangePart !== undefined) {
        throw new Error(`Invalid cron range "${basePart}".`);
      }
      const start = parseCronFieldValue(startPart, min, max, options);
      const end = parseCronFieldValue(endPart, min, max, options);
      addCronRangeValues(values, start, end, step, options);
      continue;
    }

    const value = parseCronFieldValue(basePart, min, max, options);
    if (stepPart !== undefined) {
      addCronRangeValues(values, value, max, step, options);
      continue;
    }
    values.add(value);
  }

  return {
    values,
    wildcard: field === "*",
  };
}

function parseCronExpression(cronExpression: string): ParsedCronExpression {
  const normalizedExpression = normalizeCronExpression(cronExpression);
  const parts = normalizedExpression.split(" ");
  if (parts.length !== 5) {
    throw new Error("Cron expression must use 5 fields: minute hour day month weekday.");
  }

  const minute = parseCronField(parts[0]!, 0, 59);
  const hour = parseCronField(parts[1]!, 0, 23);
  const dayOfMonth = parseCronField(parts[2]!, 1, 31);
  const month = parseCronField(parts[3]!, 1, 12, {
    aliases: CRON_MONTH_ALIASES,
  });
  const dayOfWeek = parseCronField(parts[4]!, 0, 7, {
    aliases: CRON_DAY_OF_WEEK_ALIASES,
    normalize: normalizeCronDayOfWeekValue,
  });

  return {
    normalizedExpression,
    minute: minute.values,
    hour: hour.values,
    dayOfMonth: dayOfMonth.values,
    month: month.values,
    dayOfWeek: dayOfWeek.values,
    dayOfMonthWildcard: dayOfMonth.wildcard,
    dayOfWeekWildcard: dayOfWeek.wildcard,
  };
}

function cronMatches(parsedExpression: ParsedCronExpression, date: Date) {
  if (
    !parsedExpression.minute.has(date.getMinutes())
    || !parsedExpression.hour.has(date.getHours())
    || !parsedExpression.month.has(date.getMonth() + 1)
  ) {
    return false;
  }

  const dayOfMonthMatches = parsedExpression.dayOfMonth.has(date.getDate());
  const dayOfWeekMatches = parsedExpression.dayOfWeek.has(date.getDay());
  if (parsedExpression.dayOfMonthWildcard && parsedExpression.dayOfWeekWildcard) {
    return true;
  }
  if (parsedExpression.dayOfMonthWildcard) {
    return dayOfWeekMatches;
  }
  if (parsedExpression.dayOfWeekWildcard) {
    return dayOfMonthMatches;
  }
  return dayOfMonthMatches || dayOfWeekMatches;
}

function computeNextScheduleRunAt(cronExpression: string, fromTimestamp = Date.now()) {
  const parsedExpression = parseCronExpression(cronExpression);
  const candidate = new Date(fromTimestamp);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  for (let minuteOffset = 0; minuteOffset < CRON_LOOKAHEAD_MINUTES; minuteOffset += 1) {
    if (cronMatches(parsedExpression, candidate)) {
      return candidate.getTime();
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  return null;
}

function cloneSessionSchedule(
  schedule: AgentSessionScheduleSnapshot | null | undefined,
): AgentSessionScheduleSnapshot | undefined {
  if (!schedule) {
    return undefined;
  }

  return {
    prompt: schedule.prompt,
    cronExpression: schedule.cronExpression,
    timezone: schedule.timezone,
    nextRunAt: schedule.nextRunAt,
    ...(schedule.lastTriggeredAt !== undefined ? { lastTriggeredAt: schedule.lastTriggeredAt } : {}),
    ...(schedule.lastTriggerStatus ? { lastTriggerStatus: schedule.lastTriggerStatus } : {}),
    ...(schedule.lastTriggerError ? { lastTriggerError: schedule.lastTriggerError } : {}),
  };
}

function cloneAgentLaunchSchedule(
  schedule: AgentLaunchScheduleSnapshot | null | undefined,
): AgentLaunchScheduleSnapshot | undefined {
  if (!schedule) {
    return undefined;
  }

  return {
    triggerId: schedule.triggerId,
    workspaceId: schedule.workspaceId,
    windowId: schedule.windowId,
    scope: schedule.scope,
    privacyMode: schedule.privacyMode,
    profile: schedule.profile,
    prompt: schedule.prompt,
    cronExpression: schedule.cronExpression,
    timezone: schedule.timezone,
    nextRunAt: schedule.nextRunAt,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
    ...(schedule.tabId ? { tabId: schedule.tabId } : {}),
    ...(schedule.title ? { title: schedule.title } : {}),
    ...(schedule.lastTriggeredAt !== undefined ? { lastTriggeredAt: schedule.lastTriggeredAt } : {}),
    ...(schedule.lastTriggerStatus ? { lastTriggerStatus: schedule.lastTriggerStatus } : {}),
    ...(schedule.lastTriggerError ? { lastTriggerError: schedule.lastTriggerError } : {}),
    ...(schedule.lastSessionId ? { lastSessionId: schedule.lastSessionId } : {}),
  };
}

function cloneSessionEventMatch(
  match: AgentSessionEventMatchSnapshot | null | undefined,
): AgentSessionEventMatchSnapshot | undefined {
  if (!match) {
    return undefined;
  }

  return {
    ...(match.kinds?.length ? { kinds: [...match.kinds] } : {}),
    ...(match.source ? { source: match.source } : {}),
    ...(match.urlMatches ? { urlMatches: match.urlMatches } : {}),
    ...(match.titleMatches ? { titleMatches: match.titleMatches } : {}),
    ...(match.summaryMatches ? { summaryMatches: match.summaryMatches } : {}),
  };
}

function cloneSessionEventSnapshot(
  event: AgentSessionEventSnapshot | null | undefined,
): AgentSessionEventSnapshot | undefined {
  if (!event) {
    return undefined;
  }

  return {
    kind: event.kind,
    ts: event.ts,
    ...(event.url ? { url: event.url } : {}),
    ...(event.title ? { title: event.title } : {}),
    ...(event.summary ? { summary: event.summary } : {}),
    ...(event.source ? { source: event.source } : {}),
  };
}

function cloneSessionEventTrigger(
  trigger: AgentSessionEventTriggerSnapshot | null | undefined,
): AgentSessionEventTriggerSnapshot | undefined {
  if (!trigger) {
    return undefined;
  }

  const match = cloneSessionEventMatch(trigger.match);
  const lastEvent = cloneSessionEventSnapshot(trigger.lastEvent);

  return {
    prompt: trigger.prompt,
    channels: [...trigger.channels],
    awaitTimeoutMs: trigger.awaitTimeoutMs,
    cooldownMs: trigger.cooldownMs,
    ...(match ? { match } : {}),
    ...(trigger.lastTriggeredAt !== undefined ? { lastTriggeredAt: trigger.lastTriggeredAt } : {}),
    ...(trigger.lastTriggerStatus ? { lastTriggerStatus: trigger.lastTriggerStatus } : {}),
    ...(trigger.lastTriggerError ? { lastTriggerError: trigger.lastTriggerError } : {}),
    ...(lastEvent ? { lastEvent } : {}),
  };
}

function cloneAgentPlan(
  plan: AgentPlanSnapshot | null | undefined,
): AgentPlanSnapshot | undefined {
  if (!plan) {
    return undefined;
  }

  return {
    objective: plan.objective,
    revision: plan.revision,
    updatedAt: plan.updatedAt,
    ...(plan.revisionReason ? { revisionReason: plan.revisionReason } : {}),
    items: plan.items.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      ...(item.notes ? { notes: item.notes } : {}),
    })),
  };
}

function buildAgentPlanToolResult(
  session: AgentSessionState,
  action: AgentPlanToolAction,
) {
  const plan = cloneAgentPlan(session.plan);
  return {
    ok: true,
    action,
    sessionId: session.sessionId,
    hasPlan: Boolean(plan),
    ...(plan ? { plan } : {}),
  };
}

function buildSessionScheduleToolResult(
  session: AgentSessionState,
  action: SessionScheduleToolAction,
) {
  const schedule = cloneSessionSchedule(session.schedule);
  return {
    ok: true,
    action,
    sessionId: session.sessionId,
    hasSchedule: Boolean(schedule),
    ...(schedule ? { schedule } : {}),
  };
}

function buildSessionEventTriggerToolResult(
  session: AgentSessionState,
  action: SessionScheduleToolAction,
) {
  const eventTrigger = cloneSessionEventTrigger(session.eventTrigger);
  return {
    ok: true,
    action,
    sessionId: session.sessionId,
    hasEventTrigger: Boolean(eventTrigger),
    ...(eventTrigger ? { eventTrigger } : {}),
  };
}

function readAgentSessionSchedule(value: unknown): AgentSessionScheduleSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const prompt = readString(value.prompt);
  const cronExpression = readString(value.cronExpression);
  const timezone = readString(value.timezone) ?? getLocalTimeZone();
  const nextRunAt = readNumber(value.nextRunAt);
  if (!prompt || !cronExpression) {
    return null;
  }

  const normalizedCronExpression = normalizeCronExpression(cronExpression);
  let computedNextRunAt: number | null;
  try {
    computedNextRunAt = nextRunAt ?? computeNextScheduleRunAt(normalizedCronExpression);
  } catch {
    return null;
  }
  if (computedNextRunAt === null) {
    return null;
  }

  return {
    prompt,
    cronExpression: normalizedCronExpression,
    timezone,
    nextRunAt: computedNextRunAt > Date.now()
      ? computedNextRunAt
      : computeNextScheduleRunAt(normalizedCronExpression, Date.now()) ?? computedNextRunAt,
    ...(readNumber(value.lastTriggeredAt) !== undefined ? { lastTriggeredAt: readNumber(value.lastTriggeredAt)! } : {}),
    ...(readAgentSessionScheduleTriggerStatus(value.lastTriggerStatus)
      ? { lastTriggerStatus: readAgentSessionScheduleTriggerStatus(value.lastTriggerStatus)! }
      : {}),
    ...(readString(value.lastTriggerError) ? { lastTriggerError: readString(value.lastTriggerError)! } : {}),
  };
}

function readAgentLaunchSchedule(value: unknown): AgentLaunchScheduleSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const triggerId = readString(value.triggerId);
  const workspaceId = readString(value.workspaceId);
  const windowId = readNumber(value.windowId);
  const prompt = readString(value.prompt);
  const cronExpression = readString(value.cronExpression);
  const createdAt = readNumber(value.createdAt) ?? Date.now();
  const updatedAt = readNumber(value.updatedAt) ?? createdAt;
  if (!triggerId || !workspaceId || windowId === undefined || !prompt || !cronExpression) {
    return null;
  }

  const normalizedCronExpression = normalizeCronExpression(cronExpression);
  let computedNextRunAt: number | null;
  try {
    computedNextRunAt = readNumber(value.nextRunAt) ?? computeNextScheduleRunAt(normalizedCronExpression);
  } catch {
    return null;
  }
  if (computedNextRunAt === null) {
    return null;
  }

  const scope: AgentSessionScope = value.scope === "current-tab" ? "current-tab" : "default";
  const profile: AgentSessionProfile =
    value.profile === "organizer" || value.profile === "widget-builder" ? value.profile : "default";
  const lastTriggerStatus = readAgentSessionScheduleTriggerStatus(value.lastTriggerStatus);
  const lastTriggerError = readString(value.lastTriggerError);
  const lastSessionId = readString(value.lastSessionId);

  return {
    triggerId,
    workspaceId,
    windowId: Math.floor(windowId),
    scope,
    privacyMode: readBoolean(value.privacyMode) ?? true,
    profile,
    prompt,
    cronExpression: normalizedCronExpression,
    timezone: readString(value.timezone) ?? getLocalTimeZone(),
    nextRunAt: computedNextRunAt > Date.now()
      ? computedNextRunAt
      : computeNextScheduleRunAt(normalizedCronExpression, Date.now()) ?? computedNextRunAt,
    createdAt,
    updatedAt,
    ...(readString(value.tabId) ? { tabId: readString(value.tabId)! } : {}),
    ...(readString(value.title) ? { title: readString(value.title)! } : {}),
    ...(readNumber(value.lastTriggeredAt) !== undefined ? { lastTriggeredAt: readNumber(value.lastTriggeredAt)! } : {}),
    ...(lastTriggerStatus ? { lastTriggerStatus } : {}),
    ...(lastTriggerError ? { lastTriggerError } : {}),
    ...(lastSessionId ? { lastSessionId } : {}),
  };
}

function readAgentPlanItem(value: unknown, index: number): AgentPlanItemSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const rawId = readString(value.id);
  const title = readString(value.title) ?? readString(value.task);
  if (!title) {
    return null;
  }

  const status = readAgentPlanItemStatus(value.status) ?? "pending";
  const notes = readString(value.notes);
  return {
    id: rawId ?? `step-${index + 1}`,
    title,
    status,
    ...(notes ? { notes } : {}),
  };
}

function readAgentPlan(value: unknown): AgentPlanSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const objective = readString(value.objective);
  if (!objective || !Array.isArray(value.items)) {
    return null;
  }

  const seenIds = new Set<string>();
  const items: AgentPlanItemSnapshot[] = [];
  value.items.forEach((entry, index) => {
    const item = readAgentPlanItem(entry, index);
    if (!item || seenIds.has(item.id)) {
      return;
    }
    seenIds.add(item.id);
    items.push(item);
  });

  if (items.length === 0) {
    return null;
  }

  const revision = Math.max(1, Math.floor(readNumber(value.revision) ?? 1));
  const updatedAt = Math.max(0, Math.floor(readNumber(value.updatedAt) ?? Date.now()));
  const revisionReason = readString(value.revisionReason);
  return {
    objective,
    revision,
    updatedAt,
    ...(revisionReason ? { revisionReason } : {}),
    items,
  };
}

function readAgentFinishResult(value: unknown): AgentFinishResult | null {
  if (!isRecord(value)) {
    return null;
  }

  const status = readAgentFinishStatus(value.status);
  const summary = readString(value.summary);
  const nextStep = readString(value.nextStep);
  if (!status || !summary) {
    return null;
  }

  return {
    ok: true,
    status,
    summary,
    ...(nextStep ? { nextStep } : {}),
  };
}

function readExtractionAgentFinishStatus(value: unknown): ExtractionAgentFinishStatus | undefined {
  return value === "completed" || value === "blocked" || value === "failed"
    ? value
    : undefined;
}

function isPageRefRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && Boolean(readString(value.sessionId))
    && Boolean(readString(value.tabId))
    && Boolean(readString(value.documentId))
    && Boolean(readString(value.leaseId));
}

function extractPageRefFromToolResult(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) {
    if (isPageRefRecord(value.page)) {
      return value.page;
    }
    if (isRecord(value.result) && isPageRefRecord(value.result.page)) {
      return value.result.page;
    }
  }
  return undefined;
}

function mapExtractionBlockTypeToSourceRole(value: string | undefined) {
  switch (value) {
    case "table":
    case "list":
    case "form":
    case "panel":
    case "main":
      return value;
    case "card_group":
    case "text":
    case "metric_group":
    case "image":
      return "panel";
    case "article":
      return "main";
    default:
      return undefined;
  }
}

function readAgentSessionEventMatch(value: unknown): AgentSessionEventMatchSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const nextKinds = readStringArray(value.kinds);
  const source = readString(value.source);
  const urlMatches = readString(value.urlMatches);
  const titleMatches = readString(value.titleMatches);
  const summaryMatches = readString(value.summaryMatches);

  if (!nextKinds.length && !source && !urlMatches && !titleMatches && !summaryMatches) {
    return null;
  }

  return {
    ...(nextKinds.length ? { kinds: nextKinds } : {}),
    ...(source ? { source } : {}),
    ...(urlMatches ? { urlMatches } : {}),
    ...(titleMatches ? { titleMatches } : {}),
    ...(summaryMatches ? { summaryMatches } : {}),
  };
}

function readAgentSessionEventSnapshot(value: unknown): AgentSessionEventSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const kind = readString(value.kind);
  const ts = readNumber(value.ts);
  if (!kind || ts === undefined) {
    return null;
  }

  return {
    kind,
    ts,
    ...(readString(value.url) ? { url: readString(value.url) } : {}),
    ...(readString(value.title) ? { title: readString(value.title) } : {}),
    ...(readString(value.summary) ? { summary: readString(value.summary) } : {}),
    ...(readString(value.source) ? { source: readString(value.source) } : {}),
  };
}

function readAgentSessionEventTrigger(value: unknown): AgentSessionEventTriggerSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const prompt = readString(value.prompt);
  if (!prompt) {
    return null;
  }

  const channelsInput = readStringArray(value.channels).filter((entry) =>
    (EVENT_TRIGGER_CHANNEL_VALUES as readonly string[]).includes(entry));
  const channels = channelsInput.length > 0
    ? channelsInput
    : [...DEFAULT_EVENT_TRIGGER_CHANNELS];
  const awaitTimeoutMs = Math.min(
    DEFAULT_EVENT_TRIGGER_AWAIT_TIMEOUT_MS,
    Math.max(1_000, Math.floor(readNumber(value.awaitTimeoutMs) ?? DEFAULT_EVENT_TRIGGER_AWAIT_TIMEOUT_MS)),
  );
  const cooldownMs = Math.max(0, Math.floor(readNumber(value.cooldownMs) ?? DEFAULT_EVENT_TRIGGER_COOLDOWN_MS));
  const match = readAgentSessionEventMatch(value.match);
  const lastEvent = readAgentSessionEventSnapshot(value.lastEvent);
  const lastTriggeredAt = readNumber(value.lastTriggeredAt);
  const lastTriggerStatus = readAgentSessionEventTriggerStatus(value.lastTriggerStatus);
  const lastTriggerError = readString(value.lastTriggerError);

  return {
    prompt,
    channels,
    awaitTimeoutMs,
    cooldownMs,
    ...(match ? { match } : {}),
    ...(lastTriggeredAt !== undefined ? { lastTriggeredAt } : {}),
    ...(lastTriggerStatus ? { lastTriggerStatus } : {}),
    ...(lastTriggerError ? { lastTriggerError } : {}),
    ...(lastEvent ? { lastEvent } : {}),
  };
}

function collectExtractionFieldKeys(value: unknown, limit = 12) {
  if (!Array.isArray(value)) {
    return [];
  }
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    for (const key of Object.keys(entry)) {
      const normalized = key.trim();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      keys.push(normalized);
      if (keys.length >= limit) {
        return keys;
      }
    }
  }
  return keys;
}

function inferExtractionModeFromToolResult(result: unknown): LearningExtractionMode | undefined {
  if (!isRecord(result)) {
    return undefined;
  }
  if (typeof result.recordCount === "number" || Array.isArray(result.records)) {
    return "records";
  }
  if (typeof result.text === "string") {
    return "text";
  }
  if (Array.isArray(result.images)) {
    return "images";
  }
  const source = isRecord(result.source) ? result.source : null;
  const sourceMode = source ? readString(source.mode) : undefined;
  return sourceMode === "records" || sourceMode === "text" || sourceMode === "images"
    ? sourceMode
    : undefined;
}

function buildSnapshotRegionHints(result: unknown) {
  const hints = new Map<string, {
    regionRole?: string;
    regionName?: string;
    regionHint?: string;
  }>();
  if (!isRecord(result) || !Array.isArray(result.regions)) {
    return hints;
  }

  for (const entry of result.regions) {
    if (!isRecord(entry)) {
      continue;
    }
    const regionId = readString(entry.regionId);
    if (!regionId) {
      continue;
    }
    const regionRole = readString(entry.role);
    const regionName = readString(entry.name);
    const regionHint = (
      readString(entry.summary)
      ?? readString(entry.description)
      ?? [regionRole, regionName]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join(" ")
    ) || undefined;
    hints.set(regionId, {
      ...(regionRole ? { regionRole } : {}),
      ...(regionName ? { regionName } : {}),
      ...(regionHint ? { regionHint } : {}),
    });
  }
  return hints;
}

function rememberExtractionObservation(
  runtime: ExtractionAgentRuntime,
  toolName: string,
  input: Record<string, unknown>,
  result: unknown,
) {
  if (toolName === "page.snapshot") {
    runtime.snapshotRegionHints = buildSnapshotRegionHints(result);
    return;
  }

  if (toolName !== "page.extract" && toolName !== "extract.records") {
    return;
  }
  if (!isRecord(result)) {
    return;
  }

  const extractionMode = inferExtractionModeFromToolResult(result);
  if (!extractionMode) {
    return;
  }

  const source = isRecord(result.source) ? result.source : null;
  const sourceRegionId = readString(result.sourceRegionId)
    ?? (source ? readString(source.regionId) : undefined)
    ?? readString(input.regionId);
  const snapshotHint = sourceRegionId ? runtime.snapshotRegionHints.get(sourceRegionId) : undefined;
  const sourceRole = readString(result.sourceRole)
    ?? readString(input.sourceRole)
    ?? mapExtractionBlockTypeToSourceRole(source ? readString(source.type) : undefined);
  const fieldKeys = collectExtractionFieldKeys(result.records);
  if (fieldKeys.length === 0 && isRecord(input.recordSchema) && isRecord(input.recordSchema.properties)) {
    for (const key of Object.keys(input.recordSchema.properties)) {
      if (!fieldKeys.includes(key)) {
        fieldKeys.push(key);
      }
      if (fieldKeys.length >= 12) {
        break;
      }
    }
  }

  runtime.latestExtractionObservation = {
    extractionMode,
    ...(sourceRole ? { sourceRole } : {}),
    ...(snapshotHint?.regionRole ? { regionRole: snapshotHint.regionRole } : {}),
    ...(snapshotHint?.regionName ? { regionName: snapshotHint.regionName } : {}),
    ...(snapshotHint?.regionHint ? { regionHint: snapshotHint.regionHint } : {}),
    fieldKeys,
    keywords: [
      ...(sourceRole ? [sourceRole] : []),
      ...(snapshotHint?.regionRole ? [snapshotHint.regionRole] : []),
      ...(snapshotHint?.regionName ? [snapshotHint.regionName] : []),
      ...(snapshotHint?.regionHint ? [snapshotHint.regionHint] : []),
      ...fieldKeys,
    ],
  };
}

function toSessionRefFromPage(page: Record<string, unknown>) {
  const sessionId = readString(page.sessionId);
  const tabId = readString(page.tabId);
  if (!sessionId || !tabId) {
    return null;
  }

  return {
    sessionId,
    tabId,
    ...(readString(page.frameId) ? { frameId: readString(page.frameId) } : {}),
    ...(readString(page.userId) ? { userId: readString(page.userId) } : {}),
  };
}

function formatJsonCompact(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncateText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]`;
}

function compactText(value: string, maxChars: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function normalizeEvidenceText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function canonicalizeToolName(name: string) {
  return name.replace(/\./g, "_");
}

function tryParseJson(value: string): unknown | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function buildAgentRequestHeaders(sessionId: string) {
  const chromeVersion = typeof process.versions.chrome === "string" && process.versions.chrome.trim()
    ? process.versions.chrome.trim()
    : FALLBACK_CHROME_VERSION;
  return {
    "x-agent-session-id": sessionId,
    "user-agent": `milo/1.0 Browser/${chromeVersion}`,
  };
}

function padDateTimePart(value: number) {
  return String(Math.trunc(value)).padStart(2, "0");
}

function formatUtcOffsetLabel(date: Date) {
  const totalMinutes = -date.getTimezoneOffset();
  const sign = totalMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(totalMinutes);
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  return `UTC${sign}${padDateTimePart(hours)}:${padDateTimePart(minutes)}`;
}

function formatLocalDateTime(date: Date) {
  return [
    `${date.getFullYear()}-${padDateTimePart(date.getMonth() + 1)}-${padDateTimePart(date.getDate())}`,
    `${padDateTimePart(date.getHours())}:${padDateTimePart(date.getMinutes())}:${padDateTimePart(date.getSeconds())}`,
  ].join(" ");
}

function formatLocalDateOnly(date: Date) {
  return `${date.getFullYear()}-${padDateTimePart(date.getMonth() + 1)}-${padDateTimePart(date.getDate())}`;
}

function sanitizeUiMessageRecord(value: unknown): AgentUiMessage | null {
  if (!isRecord(value)) {
    return null;
  }

  const role = value.role === "system" || value.role === "user" || value.role === "assistant"
    ? value.role
    : null;
  const kind = value.kind === "message" || value.kind === "tool" || value.kind === "error"
    ? value.kind
    : null;
  const content = typeof value.content === "string" ? value.content : null;

  if (!role || !kind || content === null) {
    return null;
  }

  const subAgentDetails = sanitizeAgentSubAgentDetails(value.subAgentDetails);
  const thinkingContent = readString(value.thinkingContent);
  return {
    id: readString(value.id) ?? randomUUID(),
    role,
    kind,
    content,
    createdAt: readNumber(value.createdAt) ?? Date.now(),
    ...(value.state === "running" || value.state === "completed" || value.state === "failed"
      ? { state: value.state }
      : {}),
    ...(readString(value.toolName) ? { toolName: readString(value.toolName) } : {}),
    ...(thinkingContent ? { thinkingContent } : {}),
    ...(subAgentDetails ? { subAgentDetails } : {}),
  };
}

function sanitizeTransportMessageRecord(value: unknown): TransportMessage | null {
  if (!isRecord(value)) {
    return null;
  }

  if ((value.role === "user" || value.role === "system") && typeof value.content === "string") {
    return {
      role: value.role,
      content: value.content,
    };
  }

  if (value.role === "assistant") {
    const toolCalls = Array.isArray(value.toolCalls)
      ? value.toolCalls.flatMap((toolCall) => {
        if (!isRecord(toolCall)) {
          return [];
        }

        const id = readString(toolCall.id);
        const name = readString(toolCall.name);
        const argumentsText = typeof toolCall.argumentsText === "string"
          ? toolCall.argumentsText
          : "{}";

        if (!id || !name) {
          return [];
        }

        return [{
          id,
          name,
          argumentsText,
        }];
      })
      : [];
    const thinkingContent = readString(value.thinkingContent);

    if (typeof value.content !== "string" && value.content !== null && toolCalls.length === 0) {
      return null;
    }

    return {
      role: "assistant",
      content: typeof value.content === "string" ? value.content : null,
      ...(thinkingContent ? { thinkingContent } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }

  if (
    value.role === "tool"
    && typeof value.content === "string"
    && readString(value.toolCallId)
    && readString(value.name)
  ) {
    return {
      role: "tool",
      content: value.content,
      toolCallId: readString(value.toolCallId)!,
      name: readString(value.name)!,
    };
  }

  return null;
}

function normalizeTransportMessageSequence(messages: TransportMessage[]) {
  const normalized: TransportMessage[] = [];
  let changed = false;
  let pendingAssistant: Extract<TransportMessage, { role: "assistant" }> | null = null;
  let pendingToolMessages: Array<Extract<TransportMessage, { role: "tool" }>> = [];
  let pendingMatchedToolCallIds = new Set<string>();

  const finalizePendingAssistant = () => {
    if (!pendingAssistant) {
      return;
    }

    const originalToolCalls = pendingAssistant.toolCalls ?? [];
    const matchedToolCalls = originalToolCalls.filter((toolCall) => pendingMatchedToolCallIds.has(toolCall.id));
    if (matchedToolCalls.length !== originalToolCalls.length) {
      changed = true;
    }

    if (matchedToolCalls.length > 0) {
      normalized.push({
        role: "assistant",
        content: pendingAssistant.content,
        ...(pendingAssistant.thinkingContent ? { thinkingContent: pendingAssistant.thinkingContent } : {}),
        toolCalls: matchedToolCalls.map((toolCall) => ({ ...toolCall })),
      });
      normalized.push(...pendingToolMessages.map((message) => ({ ...message })));
    } else if (typeof pendingAssistant.content === "string") {
      normalized.push({
        role: "assistant",
        content: pendingAssistant.content,
        ...(pendingAssistant.thinkingContent ? { thinkingContent: pendingAssistant.thinkingContent } : {}),
      });
      if (originalToolCalls.length > 0) {
        changed = true;
      }
    } else {
      changed = true;
    }

    pendingAssistant = null;
    pendingToolMessages = [];
    pendingMatchedToolCallIds = new Set<string>();
  };

  for (const message of messages) {
    if (message.role === "assistant") {
      finalizePendingAssistant();
      if (!message.toolCalls?.length) {
        if (message.content === null) {
          changed = true;
          continue;
        }
        normalized.push({
          role: "assistant",
          content: message.content,
          ...(message.thinkingContent ? { thinkingContent: message.thinkingContent } : {}),
        });
        continue;
      }

      pendingAssistant = {
        role: "assistant",
        content: message.content,
        ...(message.thinkingContent ? { thinkingContent: message.thinkingContent } : {}),
        toolCalls: message.toolCalls.map((toolCall) => ({ ...toolCall })),
      };
      pendingToolMessages = [];
      pendingMatchedToolCallIds = new Set<string>();
      continue;
    }

    if (message.role === "tool") {
      if (!pendingAssistant || !pendingAssistant.toolCalls?.length) {
        changed = true;
        continue;
      }

      const matchesKnownToolCall = pendingAssistant.toolCalls.some((toolCall) => toolCall.id === message.toolCallId);
      if (!matchesKnownToolCall || pendingMatchedToolCallIds.has(message.toolCallId)) {
        changed = true;
        continue;
      }

      pendingMatchedToolCallIds.add(message.toolCallId);
      pendingToolMessages.push({ ...message });
      continue;
    }

    finalizePendingAssistant();
    normalized.push(message);
  }

  finalizePendingAssistant();
  return {
    changed,
    messages: normalized,
  };
}

function sanitizeEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return `${url.origin}${url.pathname}`;
  } catch {
    return endpoint;
  }
}

function normalizeToolResultForContext(result: unknown): string {
  return truncateText(formatJsonCompact(result), MAX_CONTEXT_CHARS);
}

function isDelegatedTaskTerminalStatus(status: DelegatedTaskStatus) {
  return status === "completed"
    || status === "needs_user"
    || status === "blocked"
    || status === "failed"
    || status === "cancelled";
}

function readAbortMessage(reason: unknown, fallback: string) {
  if (reason instanceof Error && reason.message.trim()) {
    return reason.message;
  }
  if (typeof reason === "string" && reason.trim()) {
    return reason.trim();
  }
  return fallback;
}

function throwIfAborted(signal: AbortSignal | null | undefined, fallback = "Task interrupted.") {
  if (!signal?.aborted) {
    return;
  }

  throw new Error(readAbortMessage(signal.reason, fallback));
}

function createUiMessage(input: Omit<AgentUiMessage, "id" | "createdAt"> & Partial<Pick<AgentUiMessage, "id" | "createdAt">>): AgentUiMessage {
  return {
    id: input.id ?? randomUUID(),
    createdAt: input.createdAt ?? Date.now(),
    role: input.role,
    kind: input.kind,
    content: input.content,
    ...(input.state ? { state: input.state } : {}),
    ...(input.toolName ? { toolName: input.toolName } : {}),
    ...(input.thinkingContent ? { thinkingContent: input.thinkingContent } : {}),
    ...(input.subAgentDetails ? { subAgentDetails: cloneAgentSubAgentDetails(input.subAgentDetails) } : {}),
  };
}

function createRuntimeContext(): AgentRuntimeContext {
  return {
    browserSessions: new Map(),
    sourceTabs: new Map(),
    subscriptions: new Map(),
    recentEvents: [],
  };
}

function rememberOwnedSubtaskTab(
  runtime: SubtaskAgentRuntime,
  tabId: unknown,
  windowId?: unknown,
) {
  const normalizedTabId = readString(tabId);
  if (!normalizedTabId) {
    return;
  }

  const normalizedWindowId = readWindowIdNumber(windowId);
  const existing = runtime.ownedTabs.get(normalizedTabId);
  runtime.ownedTabs.set(normalizedTabId, {
    tabId: normalizedTabId,
    ...(normalizedWindowId !== undefined
      ? { windowId: normalizedWindowId }
      : existing?.windowId !== undefined
        ? { windowId: existing.windowId }
        : {}),
  });
}

function rememberOwnedSubtaskTabsFromOpenedTabs(
  runtime: SubtaskAgentRuntime,
  result: Record<string, unknown>,
) {
  if (!Array.isArray(result.openedTabs)) {
    return;
  }

  for (const entry of result.openedTabs) {
    if (!isRecord(entry)) {
      continue;
    }
    rememberOwnedSubtaskTab(runtime, entry.tabId, entry.windowId);
  }
}

function rememberOwnedSubtaskTabsFromEvents(
  runtime: SubtaskAgentRuntime,
  result: Record<string, unknown>,
) {
  if (!Array.isArray(result.events)) {
    return;
  }

  for (const event of result.events) {
    if (!isRecord(event) || readString(event.kind) !== "tab.created") {
      continue;
    }

    const tabId = readString(event.tabId);
    if (!tabId) {
      continue;
    }

    const openerTabId = readString(event.openerTabId);
    if (openerTabId && !runtime.ownedTabs.has(openerTabId)) {
      continue;
    }

    rememberOwnedSubtaskTab(runtime, tabId, event.windowId);
  }
}

function reconcileOwnedSubtaskTabsFromTool(
  runtime: SubtaskAgentRuntime,
  name: string,
  input: Record<string, unknown>,
  result: unknown,
) {
  if (!isRecord(result)) {
    return;
  }

  if (name === "browser_tab_create") {
    rememberOwnedSubtaskTab(runtime, result.tabId, result.windowId);
    return;
  }

  if (name === "browser_session_open") {
    const sessionRef = isRecord(result.session) ? result.session : null;
    const resultTabId = readString(result.tabId) ?? readString(sessionRef?.tabId);
    const inputTabId = readString(input.tabId);
    const shouldOwnTab = result.createdTab === true
      || (inputTabId ? runtime.ownedTabs.has(inputTabId) : false)
      || (resultTabId ? runtime.ownedTabs.has(resultTabId) : false);

    if (shouldOwnTab) {
      rememberOwnedSubtaskTab(runtime, resultTabId, result.windowId);
    }
  }

  rememberOwnedSubtaskTabsFromOpenedTabs(runtime, result);

  if (name === "browser_events_read" || name === "browser_events_await") {
  rememberOwnedSubtaskTabsFromEvents(runtime, result);
  }
}

function buildElementScreenshotCaptureScript(selector: string, padding: number) {
  return String.raw`(async () => {
    const selector = ${JSON.stringify(selector)};
    const padding = ${JSON.stringify(padding)};

    const safeQuery = (root, value) => {
      if (!root || !value || typeof root.querySelector !== "function") {
        return null;
      }
      try {
        return root.querySelector(value);
      } catch {
        return null;
      }
    };

    const queryDeep = (value) => {
      const queue = [document];
      const visited = new Set();
      while (queue.length > 0) {
        const root = queue.shift();
        if (!root || visited.has(root)) {
          continue;
        }
        visited.add(root);

        const found = safeQuery(root, value);
        if (found) {
          return found;
        }

        if (typeof root.querySelectorAll !== "function") {
          continue;
        }

        for (const node of Array.from(root.querySelectorAll("*"))) {
          if (node && node.shadowRoot) {
            queue.push(node.shadowRoot);
          }
        }
      }
      return null;
    };

    const waitForFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    const element = queryDeep(selector);
    if (!element) {
      return {
        ok: false,
        error: "No element matched the requested selector.",
        selector,
      };
    }

    if (typeof element.scrollIntoView === "function") {
      element.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "auto",
      });
    }

    await waitForFrame();
    await waitForFrame();

    const rect = element.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(element);
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width < 1 || rect.height < 1) {
      return {
        ok: false,
        error: "The matched element does not have a visible bounding box.",
        selector,
      };
    }

    if (computedStyle.display === "none" || computedStyle.visibility === "hidden") {
      return {
        ok: false,
        error: "The matched element is not visible.",
        selector,
      };
    }

    return {
      ok: true,
      selector,
      tagName: typeof element.tagName === "string" ? element.tagName.toLowerCase() : "",
      text: String(element.innerText || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 160),
      rect: {
        x: Math.max(0, Math.floor(rect.left - padding)),
        y: Math.max(0, Math.floor(rect.top - padding)),
        width: Math.max(1, Math.ceil(rect.width + (padding * 2))),
        height: Math.max(1, Math.ceil(rect.height + (padding * 2))),
      },
    };
  })();`;
}

export function createBrowserAgentService(options: BrowserAgentServiceOptions) {
  const sessions = new Map<string, AgentSessionState>();
  const sessionIdsByWindowKey = new Map<string, string[]>();
  const agentLaunchSchedules = new Map<string, AgentLaunchScheduleSnapshot>();
  const runningAgentLaunchSchedules = new Set<string>();
  const sessionScheduleTimeSource = createNodeTimeEventSource();
  const triggerEventBus = createTriggerEventBus();
  const sessionEventWatchers = new Map<string, SessionEventWatcherState>();
  const agentOpenedTabSessionIds = new Map<string, string>();
  const listeners = new Set<(update: AgentSessionUpdate) => void>();
  let stateSaveTimer: NodeJS.Timeout | null = null;
  const localTools: LocalAgentToolDefinition[] = [];
  const imageReferences = new Map<string, StoredImageReference>();
  const hasStartPageWidgetPackageTools = Boolean(
    options.getWidgetRegistryRootDirectory
    && options.listWidgetPackages
    && options.getWidgetPackageSource
    && options.saveWidgetPackageSource
  );

  sessionScheduleTimeSource.subscribe(handleAgentTimeSourceEvent);
  triggerEventBus.subscribe(handleSessionScheduleTriggerEvent, { type: "timer.fired" });
  triggerEventBus.subscribe(handleAgentLaunchTriggerEvent, { type: "agent.launch" });

  function waitForDelay(delayMs: number) {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  function pruneImageReferences() {
    while (imageReferences.size > MAX_IMAGE_REFERENCE_COUNT) {
      const oldestKey = imageReferences.keys().next().value;
      if (!oldestKey) {
        return;
      }
      imageReferences.delete(oldestKey);
    }
  }

  function rememberImageReference(reference: Omit<StoredImageReference, "ref" | "createdAt">) {
    const stored: StoredImageReference = {
      ref: `image-ref:${randomUUID()}`,
      createdAt: Date.now(),
      ...reference,
    };
    imageReferences.set(stored.ref, stored);
    pruneImageReferences();
    return stored;
  }

  function getStoredImageReference(ref: string) {
    const normalizedRef = ref.trim();
    return normalizedRef ? (imageReferences.get(normalizedRef) ?? null) : null;
  }

  function prepareImageRecognitionInput(storedImage: StoredImageReference) {
    const sourceWidth = Math.max(1, storedImage.width);
    const sourceHeight = Math.max(1, storedImage.height);
    const longEdgeScale = Math.min(1, MAX_IMAGE_RECOGNITION_LONG_EDGE / Math.max(sourceWidth, sourceHeight));
    const pixelScale = Math.min(1, Math.sqrt(MAX_IMAGE_RECOGNITION_PIXELS / (sourceWidth * sourceHeight)));
    const scale = Math.min(longEdgeScale, pixelScale);
    if (scale >= 0.999) {
      return {
        dataUrl: storedImage.dataUrl,
        width: sourceWidth,
        height: sourceHeight,
        resized: false,
      };
    }

    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const image = nativeImage.createFromDataURL(storedImage.dataUrl);
    if (image.isEmpty()) {
      return {
        dataUrl: storedImage.dataUrl,
        width: sourceWidth,
        height: sourceHeight,
        resized: false,
      };
    }

    const resized = image.resize({ width, height, quality: "best" });
    if (resized.isEmpty()) {
      return {
        dataUrl: storedImage.dataUrl,
        width: sourceWidth,
        height: sourceHeight,
        resized: false,
      };
    }

    return {
      dataUrl: `data:image/png;base64,${resized.toPNG().toString("base64")}`,
      width,
      height,
      resized: true,
    };
  }

  function deleteSessionImageReferences(sessionId: string) {
    for (const [ref, imageReference] of imageReferences.entries()) {
      if (imageReference.sessionId === sessionId) {
        imageReferences.delete(ref);
      }
    }
  }

  function readSessionAgentId(value: unknown): SessionAgentId | undefined {
    return value === ORGANIZER_BROWSER_AGENT_ID
      || value === MAIN_BROWSER_AGENT_ID
      || value === WIDGET_BUILDER_BROWSER_AGENT_ID
      ? value as SessionAgentId
      : undefined;
  }

  function readAgentSessionScope(value: unknown): AgentSessionScope {
    return value === "current-tab" ? "current-tab" : "default";
  }

  function resolveSessionAgentIdFromProfile(profile?: AgentSessionProfile): SessionAgentId {
    if (profile === "organizer") {
      return ORGANIZER_BROWSER_AGENT_ID;
    }
    if (profile === "widget-builder") {
      return WIDGET_BUILDER_BROWSER_AGENT_ID;
    }
    return MAIN_BROWSER_AGENT_ID;
  }

  function isLegacyOrganizerProfileMessage(message: TransportMessage) {
    return message.role === "system" && message.content.startsWith(ORGANIZER_PROFILE_SYSTEM_PREFIX);
  }

  function stripLegacySessionAgentMessages(messages: TransportMessage[]) {
    return messages.filter((message) => !isLegacyOrganizerProfileMessage(message));
  }

  function inferSessionAgentIdFromTransportMessages(messages: TransportMessage[]): SessionAgentId {
    return messages.some((message) => isLegacyOrganizerProfileMessage(message))
      ? ORGANIZER_BROWSER_AGENT_ID
      : MAIN_BROWSER_AGENT_ID;
  }

  function notifyControlledTabsChanged(session: AgentSessionState) {
    options.onControlledTabsChanged?.({
      workspaceId: session.workspaceId,
      windowId: session.windowId,
    });
  }

  function buildManualInterventionMessage(kind: ManualInterventionKind) {
    if (kind === "verification_code") {
      return options.resolveUiLocale() === "zh-CN"
        ? "请填写验证码后继续"
        : "Please enter the verification code to continue.";
    }

    if (kind === "login_required") {
      return options.resolveUiLocale() === "zh-CN"
        ? "请登录该页面后继续"
        : "Please sign in on this page to continue.";
    }

    if (kind === "blocked") {
      return options.resolveUiLocale() === "zh-CN"
        ? "请处理当前页面上的阻塞点后继续"
        : "Please handle the blocker on this page to continue.";
    }

    return options.resolveUiLocale() === "zh-CN"
      ? "请完成人机验证"
      : "Please complete the human verification.";
  }

  function resolveManualInterventionTabId(
    session: AgentSessionState,
    input: Record<string, unknown>,
    fallbackTabId?: string,
  ) {
    const explicitTabId = readString(input.tabId);
    if (explicitTabId) {
      return explicitTabId;
    }

    const browserSessionId = readString(input.browserSessionId);
    if (browserSessionId) {
      const browserSession = session.runtimeContext.browserSessions.get(browserSessionId);
      if (browserSession?.tabId) {
        return browserSession.tabId;
      }
    }

    if (isRecord(input.page)) {
      const pageTabId = readString(input.page.tabId);
      if (pageTabId) {
        return pageTabId;
      }
    }

    if (isRecord(input.session)) {
      const inputSessionTabId = readString(input.session.tabId);
      if (inputSessionTabId) {
        return inputSessionTabId;
      }
    }

    if (fallbackTabId) {
      return fallbackTabId;
    }

    const latestBrowserSession = Array.from(session.runtimeContext.browserSessions.values()).at(-1);
    if (latestBrowserSession?.tabId) {
      return latestBrowserSession.tabId;
    }

    if (session.automationTabId) {
      return session.automationTabId;
    }

    return options.getWindowContext(session.windowId).activeTabId;
  }

  function requestManualInterventionForSession(
    session: AgentSessionState,
    input: Record<string, unknown>,
    resolveOptions?: {
      fallbackTabId?: string;
    },
  ) {
    const reason = readString(input.reason);
    const kind = readManualInterventionKind(input.kind);
    const message = readString(input.message);
    if (!reason) {
      throw new Error(`${ASK_HUMAN_HELP_TOOL_NAME} requires a non-empty reason.`);
    }
    if (!kind) {
      throw new Error(
        `${ASK_HUMAN_HELP_TOOL_NAME} requires kind to be one of ${MANUAL_INTERVENTION_KIND_VALUES.join(", ")}.`,
      );
    }

    const tabId = resolveManualInterventionTabId(session, input, resolveOptions?.fallbackTabId);
    if (!tabId) {
      throw new Error(
        `${ASK_HUMAN_HELP_TOOL_NAME} could not resolve a target tab. Attach or open the relevant page first, or pass tabId explicitly.`,
      );
    }

    const request: ManualInterventionRequest = {
      kind,
      message: message ?? buildManualInterventionMessage(kind),
    };
    session.manualInterventionPending = true;
    options.onManualInterventionRequested?.({
      sessionId: session.sessionId,
      workspaceId: session.workspaceId,
      windowId: session.windowId,
      tabId,
      kind: request.kind,
      message: request.message,
    });

    return {
      ok: true,
      tabId,
      kind: request.kind,
      message: request.message,
      reason,
    };
  }

  function resolveSessionTabContext(session: AgentSessionState) {
    const windowContext = options.getWindowContext(session.windowId);
    const boundTab = session.automationTabId
      ? windowContext.tabs.find((tab) => tab.id === session.automationTabId)
      : undefined;
    if (session.scope === "current-tab") {
      if (!boundTab) {
        return {
          windowContext: {
            tabs: [],
          },
          activeTab: undefined,
        };
      }

      const scopedTab = {
        ...boundTab,
        isActive: true,
      };
      return {
        windowContext: {
          activeTabId: scopedTab.id,
          activeUrl: scopedTab.url,
          activeTitle: scopedTab.title,
          tabs: [scopedTab],
        },
        activeTab: scopedTab,
      };
    }
    return {
      windowContext,
      activeTab: boundTab
        ?? (windowContext.activeTabId
          ? windowContext.tabs.find((tab) => tab.id === windowContext.activeTabId)
          : undefined),
    };
  }

  function buildSessionAutomationToolOptions(
    session: AgentSessionState,
    signal?: AbortSignal | null,
  ) {
    return {
      ...(signal ? { signal } : {}),
      boundWorkspaceId: session.workspaceId,
      ...(session.automationTabId ? { boundTabId: session.automationTabId } : {}),
    };
  }

  function isRealWebsiteUrl(url: string | undefined) {
    if (!url?.trim()) {
      return false;
    }

    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return false;
      }
      try {
        const startPageUrl = new URL(options.getStartPageUrl());
        if (parsed.protocol === startPageUrl.protocol && parsed.hostname === startPageUrl.hostname) {
          return false;
        }
      } catch {
        if (url === options.getStartPageUrl()) {
          return false;
        }
      }
      return Boolean(parsed.hostname);
    } catch {
      return false;
    }
  }

  function hasLearningLookupSinceLatestUserMessage(session: AgentSessionState) {
    for (let index = session.transportMessages.length - 1; index >= 0; index -= 1) {
      const message = session.transportMessages[index];
      if (message.role === "user") {
        return false;
      }
      if (message.role === "tool" && message.name === LEARNING_GUIDANCE_TOOL_NAME) {
        return true;
      }
    }
    return false;
  }

  function requiresLearningLookupBeforeTool(toolName: string) {
    return toolName === "browser_element_click"
      || toolName === "browser_element_input"
      || toolName === "browser_element_select"
      || toolName === "browser_element_press"
      || toolName === "browser_element_scroll"
      || toolName === "browser_dialog_handle";
  }

  function shouldRequireLearningLookupBeforeTool(
    session: AgentSessionState,
    toolName: string,
  ) {
    if (!options.searchLearningGuidance || !options.getLearningGuidanceDetail) {
      return false;
    }
    if (!requiresLearningLookupBeforeTool(toolName)) {
      return false;
    }
    if (hasLearningLookupSinceLatestUserMessage(session)) {
      return false;
    }
    const { windowContext, activeTab } = resolveSessionTabContext(session);
    return isRealWebsiteUrl(activeTab?.url ?? windowContext.activeUrl);
  }

  function buildLearningLookupRequiredResult(session: AgentSessionState, toolName: string) {
    const { windowContext, activeTab } = resolveSessionTabContext(session);
    return {
      ok: false,
      reasonCode: "learning_lookup_required",
      error:
        `Call ${LEARNING_GUIDANCE_TOOL_NAME} before ${toolName}. `
        + "Use an empty object to search the current task and tab automatically, then verify the learned guidance against the live page before acting.",
      requiredTool: LEARNING_GUIDANCE_TOOL_NAME,
      suggestedInput: {},
      ...(activeTab?.url ?? windowContext.activeUrl ? { activeUrl: activeTab?.url ?? windowContext.activeUrl } : {}),
      ...(getLatestUserTaskText(session) ? { task: getLatestUserTaskText(session) } : {}),
    };
  }

  function rememberSourceTabRef(
    session: AgentSessionState,
    input: {
      workspaceId: string;
      windowId: number;
      tab: WindowTabContext;
    },
  ) {
    const existing = Array.from(session.runtimeContext.sourceTabs.values()).find((entry) =>
      entry.workspaceId === input.workspaceId
      && entry.windowId === input.windowId
      && entry.tabId === input.tab.id);
    const sourceTabRef = existing?.sourceTabRef ?? `source-tab-${randomUUID()}`;
    session.runtimeContext.sourceTabs.set(sourceTabRef, {
      sourceTabRef,
      workspaceId: input.workspaceId,
      windowId: input.windowId,
      tabId: input.tab.id,
      title: input.tab.title,
      url: input.tab.url,
      displayUrl: input.tab.displayUrl,
      isActive: input.tab.isActive,
      rememberedAt: Date.now(),
    });
    return sourceTabRef;
  }

  function buildSourceTabPayload(
    session: AgentSessionState,
    input: {
      workspaceId: string;
      windowId: number;
      tab: WindowTabContext;
    },
  ) {
    return {
      sourceTabRef: rememberSourceTabRef(session, input),
      title: input.tab.title,
      url: input.tab.url,
      displayUrl: input.tab.displayUrl,
      isActive: input.tab.isActive,
    };
  }

  function resolveSourceTabRef(session: AgentSessionState, sourceTabRef: string | undefined) {
    const normalizedRef = sourceTabRef?.trim();
    if (!normalizedRef) {
      throw new Error(`Source workspace tab tools require sourceTabRef from ${SOURCE_WORKSPACE_CONTEXT_TOOL_NAME}.`);
    }
    const known = session.runtimeContext.sourceTabs.get(normalizedRef);
    if (!known || known.workspaceId !== session.originWorkspaceId || known.windowId !== session.originWindowId) {
      throw new Error(
        `Unknown sourceTabRef "${normalizedRef}". Call ${SOURCE_WORKSPACE_CONTEXT_TOOL_NAME} first and use a returned sourceTabRef.`,
      );
    }
    if (!options.isWindowOpen(known.windowId)) {
      throw new Error("The source workspace window is no longer open.");
    }
    const windowContext = options.getWindowContext(known.windowId);
    const currentTab = windowContext.tabs.find((tab) => tab.id === known.tabId);
    if (!currentTab) {
      session.runtimeContext.sourceTabs.delete(normalizedRef);
      throw new Error(
        `Source tab ${normalizedRef} is no longer available. Call ${SOURCE_WORKSPACE_CONTEXT_TOOL_NAME} again.`,
      );
    }
    const refreshed: KnownSourceTab = {
      ...known,
      title: currentTab.title,
      url: currentTab.url,
      displayUrl: currentTab.displayUrl,
      isActive: currentTab.isActive,
      rememberedAt: Date.now(),
    };
    session.runtimeContext.sourceTabs.set(normalizedRef, refreshed);
    return refreshed;
  }

  function buildSourceTabRefForWindow(
    session: AgentSessionState,
    input: {
      workspaceId: string;
      windowId: number;
      windowContext: BrowserWindowContext;
    },
  ) {
    const tabsById = new Map(input.windowContext.tabs.map((tab) => [tab.id, tab]));
    return (tabId: string) => {
      const tab = tabsById.get(tabId);
      return tab
        ? rememberSourceTabRef(session, {
            workspaceId: input.workspaceId,
            windowId: input.windowId,
            tab,
          })
        : undefined;
    };
  }

  function readPageRefFromResult(result: unknown) {
    return isRecord(result) && isRecord(result.page) ? result.page : null;
  }

  function readSessionRefFromPage(page: Record<string, unknown>) {
    const sessionId = readString(page.sessionId);
    const tabId = readString(page.tabId);
    return sessionId && tabId ? { sessionId, tabId } : null;
  }

  async function withSourcePage<T>(
    session: AgentSessionState,
    sourceTab: KnownSourceTab,
    callback: (page: Record<string, unknown>) => Promise<T>,
  ) {
    const attachResult = await options.automationService.callAgentTool(
      "context.attach",
      {
        tabId: sourceTab.tabId,
        observeOnly: true,
      },
      {
        signal: session.activeAbortController?.signal,
        boundWorkspaceId: sourceTab.workspaceId,
        boundScope: "tab",
        boundTabId: sourceTab.tabId,
      },
    );
    const page = readPageRefFromResult(attachResult);
    if (!page) {
      throw new Error("Could not attach a read-only source page context.");
    }

    try {
      return await callback(page);
    } finally {
      const sourceSession = readSessionRefFromPage(page);
      if (sourceSession) {
        await options.automationService.callAgentTool(
          "browser.detach_session",
          { session: sourceSession },
          {
            boundWorkspaceId: sourceTab.workspaceId,
            boundScope: "tab",
            boundTabId: sourceTab.tabId,
          },
        ).catch(() => undefined);
      }
    }
  }

  function stripPageRefFromRecord(value: unknown) {
    if (!isRecord(value)) {
      return value;
    }
    const { page: _page, ...rest } = value;
    return rest;
  }

  async function buildSourceWorkspaceContextPayload(session: AgentSessionState) {
    await ensureAutomationWorkspaceBinding(session);
    if (!options.isWindowOpen(session.originWindowId)) {
      throw new Error("The source workspace window is no longer open.");
    }
    const windowContext = options.getWindowContext(session.originWindowId);
    const sourceTabRefForTabId = buildSourceTabRefForWindow(session, {
      workspaceId: session.originWorkspaceId,
      windowId: session.originWindowId,
      windowContext,
    });
    const activeSourceTabRef = windowContext.activeTabId
      ? sourceTabRefForTabId(windowContext.activeTabId) ?? null
      : null;

    return {
      ok: true,
      isolation: {
        sourceWorkspaceId: session.originWorkspaceId,
        sourceWindowId: session.originWindowId,
        executionWorkspaceId: session.workspaceId,
        executionWindowId: session.windowId,
        sourceAccess: "read_only_via_source_tools",
      },
      sourceWorkspaceId: session.originWorkspaceId,
      sourceWindowId: session.originWindowId,
      activeSourceTabRef,
      activeUrl: windowContext.activeUrl ?? null,
      activeTitle: windowContext.activeTitle ?? null,
      totalTabCount: windowContext.tabs.length,
      tabs: windowContext.tabs.slice(0, 30).map((tab) =>
        buildSourceTabPayload(session, {
          workspaceId: session.originWorkspaceId,
          windowId: session.originWindowId,
          tab,
        })),
      tabOrganization: buildTabOrganizationPayload({
        windowId: session.originWindowId,
        workspaceId: session.originWorkspaceId,
        windowContext,
        sourceTabRefForTabId,
      }),
    };
  }

  async function buildWindowContextPayload(session: AgentSessionState) {
    await ensureAutomationWorkspaceBinding(session);
    const { windowContext, activeTab } = resolveSessionTabContext(session);
    const tabOrganization = buildTabOrganizationPayload({
      windowId: session.windowId,
      workspaceId: session.workspaceId,
      windowContext,
      ...(session.scope === "current-tab"
        ? {
            sidebarState: createDefaultOrganizerSidebarState(windowContext.tabs, windowContext.activeTabId),
          }
        : {}),
    });
    const buildWindowPayload = (input: {
      windowId: number;
      workspaceId: string;
      windowContext: BrowserWindowContext;
      sourceTabRefForTabId?: (tabId: string) => string | undefined;
    }) => ({
      workspaceId: input.workspaceId,
      windowId: input.windowId,
      ...(input.sourceTabRefForTabId
        ? {
            activeSourceTabRef: input.windowContext.activeTabId
              ? input.sourceTabRefForTabId(input.windowContext.activeTabId) ?? null
              : null,
          }
        : {
            activeTabId: input.windowContext.activeTabId ?? null,
          }),
      activeUrl: input.windowContext.activeUrl ?? null,
      activeTitle: input.windowContext.activeTitle ?? null,
      totalTabCount: input.windowContext.tabs.length,
      tabs: input.windowContext.tabs.slice(0, 12).map((tab) => ({
        ...(input.sourceTabRefForTabId
          ? { sourceTabRef: input.sourceTabRefForTabId(tab.id) ?? null }
          : { id: tab.id }),
        title: tab.title,
        url: tab.url,
        displayUrl: tab.displayUrl,
        isActive: tab.isActive,
      })),
      tabOrganization: buildTabOrganizationPayload(input),
    });
    const sourceWindow = options.isWindowOpen(session.originWindowId)
      ? (() => {
          const sourceWindowContext = options.getWindowContext(session.originWindowId);
          return buildWindowPayload({
            windowId: session.originWindowId,
            workspaceId: session.originWorkspaceId,
            windowContext: sourceWindowContext,
            sourceTabRefForTabId: buildSourceTabRefForWindow(session, {
              workspaceId: session.originWorkspaceId,
              windowId: session.originWindowId,
              windowContext: sourceWindowContext,
            }),
          });
        })()
      : null;
    return {
      scope: session.scope,
      workspaceId: session.workspaceId,
      windowId: session.windowId,
      originWorkspaceId: session.originWorkspaceId,
      originWindowId: session.originWindowId,
      isolation: {
        sourceWorkspaceId: session.originWorkspaceId,
        sourceWindowId: session.originWindowId,
        executionWorkspaceId: session.workspaceId,
        executionWindowId: session.windowId,
        sourceAccess: "read_only_via_source_tools",
      },
      activeTabId: activeTab?.id ?? null,
      activeUrl: activeTab?.url ?? null,
      activeTitle: activeTab?.title ?? null,
      windowActiveTabId: windowContext.activeTabId ?? null,
      windowActiveUrl: windowContext.activeUrl ?? null,
      windowActiveTitle: windowContext.activeTitle ?? null,
      totalTabCount: windowContext.tabs.length,
      tabs: windowContext.tabs.slice(0, 12).map((tab) => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        displayUrl: tab.displayUrl,
        isActive: tab.isActive,
      })),
      tabOrganization,
      automationWindow: buildWindowPayload({
        windowId: session.windowId,
        workspaceId: session.workspaceId,
        windowContext,
      }),
      sourceWindow,
    };
  }
  function buildRuntimeContextPayload(session: AgentSessionState) {
    return {
      plan: cloneAgentPlan(session.plan) ?? null,
      eventTrigger: cloneSessionEventTrigger(session.eventTrigger) ?? null,
      browserSessionCount: session.runtimeContext.browserSessions.size,
      sourceTabRefCount: session.runtimeContext.sourceTabs.size,
      subscriptionCount: session.runtimeContext.subscriptions.size,
      recentEventCount: session.runtimeContext.recentEvents.length,
      delegatedTaskCount: session.delegatedTasks.size,
      activeDelegatedTaskCount: getDelegatedTaskActiveCount(session),
      browserSessions: Array.from(session.runtimeContext.browserSessions.values()).map((entry) => ({
        sessionId: entry.sessionId,
        tabId: entry.tabId,
        attachedAt: entry.attachedAt,
        windowId: entry.windowId ?? null,
        url: entry.url ?? null,
        title: entry.title ?? null,
      })),
      delegatedTasks: listDelegatedTaskSnapshots(session, {
        includeCompleted: true,
      }),
      subscriptions: Array.from(session.runtimeContext.subscriptions.values()).map((entry) => ({
        subscriptionId: entry.subscriptionId,
        sessionId: entry.sessionId,
        startedAt: entry.startedAt,
        channels: [...entry.channels],
        cursorSeq: entry.cursorSeq ?? null,
        lastReadAt: entry.lastReadAt ?? null,
      })),
      recentEvents: session.runtimeContext.recentEvents.map((event) => ({
        kind: event.kind,
        ts: event.ts ?? null,
        summary: event.summary ?? null,
        windowId: event.windowId ?? null,
        tabId: event.tabId ?? null,
        openerTabId: event.openerTabId ?? null,
        url: event.url ?? null,
        title: event.title ?? null,
        source: event.source ?? null,
        state: event.state ?? null,
        filename: event.filename ?? null,
        message: event.message ?? null,
        selector: event.selector ?? null,
        backendNodeId: event.backendNodeId ?? null,
        axNodeId: event.axNodeId ?? null,
        axRole: event.axRole ?? null,
        axName: event.axName ?? null,
        axResolvedDepth: event.axResolvedDepth ?? null,
        axResolvedSelector: event.axResolvedSelector ?? null,
        axDiffSummary: event.axDiffSummary ?? null,
      })),
    };
  }

  function readAgentPlanItemsInput(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }

    const seenIds = new Set<string>();
    const items: AgentPlanItemSnapshot[] = [];
    value.forEach((entry, index) => {
      const item = typeof entry === "string" && entry.trim()
        ? {
            id: `step-${index + 1}`,
            title: entry.trim(),
            status: "pending" as const,
          }
        : readAgentPlanItem(entry, index);
      if (!item || seenIds.has(item.id)) {
        return;
      }
      seenIds.add(item.id);
      items.push(item);
    });
    return items;
  }

  function applyAgentPlanTool(input: Record<string, unknown>, session: AgentSessionState) {
    const explicitAction = readAgentPlanToolAction(input.action);
    if (input.action !== undefined && !explicitAction) {
      throw new Error(`${AGENT_PLAN_TOOL_NAME} action must be one of get, set, update, revise, or clear.`);
    }

    const action = explicitAction
      ?? (Array.isArray(input.items)
        ? "set"
        : (readString(input.itemId) || Array.isArray(input.updates) ? "update" : "get"));

    if (action === "get") {
      return buildAgentPlanToolResult(session, action);
    }

    if (action === "clear") {
      session.plan = null;
      emitUpdate(session, "context");
      return buildAgentPlanToolResult(session, action);
    }

    if (action === "set" || action === "revise") {
      const objective = readString(input.objective) ?? session.plan?.objective;
      const items = readAgentPlanItemsInput(input.items);
      if (!objective) {
        throw new Error(`${AGENT_PLAN_TOOL_NAME} requires objective when setting or revising a plan.`);
      }
      if (items.length === 0) {
        throw new Error(`${AGENT_PLAN_TOOL_NAME} requires a non-empty items array when setting or revising a plan.`);
      }

      session.plan = {
        objective,
        revision: action === "revise" ? (session.plan?.revision ?? 1) + 1 : 1,
        updatedAt: Date.now(),
        ...(readString(input.reason) ? { revisionReason: readString(input.reason)! } : {}),
        items,
      };
      emitUpdate(session, "context");
      return buildAgentPlanToolResult(session, action);
    }

    if (!session.plan) {
      throw new Error(`${AGENT_PLAN_TOOL_NAME} cannot update because no plan is set.`);
    }

    const updates = Array.isArray(input.updates)
      ? input.updates.filter(isRecord)
      : [input].filter(isRecord);
    if (updates.length === 0) {
      throw new Error(`${AGENT_PLAN_TOOL_NAME} requires itemId/status/notes or an updates array when action is update.`);
    }

    const nextItems = session.plan.items.map((item) => ({ ...item }));
    for (const update of updates) {
      const itemId = readString(update.itemId) ?? readString(update.id);
      if (!itemId) {
        throw new Error(`${AGENT_PLAN_TOOL_NAME} update requires itemId.`);
      }
      const item = nextItems.find((entry) => entry.id === itemId);
      if (!item) {
        throw new Error(`${AGENT_PLAN_TOOL_NAME} could not find plan item ${itemId}.`);
      }
      const status = readAgentPlanItemStatus(update.status);
      if (update.status !== undefined && !status) {
        throw new Error(`${AGENT_PLAN_TOOL_NAME} status must be one of pending, in_progress, completed, blocked, or skipped.`);
      }
      const title = readString(update.title);
      const notes = readString(update.notes);
      if (status) {
        item.status = status;
      }
      if (title) {
        item.title = title;
      }
      if (notes) {
        item.notes = notes;
      }
    }

    session.plan = {
      ...session.plan,
      updatedAt: Date.now(),
      items: nextItems,
    };
    emitUpdate(session, "context");
    return buildAgentPlanToolResult(session, "update");
  }

  function normalizeAgentProfileInstructionsInput(value: unknown) {
    if (typeof value !== "string") {
      return "";
    }

    return value
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, MAX_AGENT_PROFILE_INSTRUCTIONS_LENGTH);
  }

  function buildAgentProfileToolResult(
    action: AgentProfileToolAction,
    profileInstructions = options.getAgentPreferences().profileInstructions,
    reason?: string,
  ) {
    const normalizedProfileInstructions = normalizeAgentProfileInstructionsInput(profileInstructions);
    return {
      ok: true,
      action,
      profileInstructions: normalizedProfileInstructions,
      profileSet: normalizedProfileInstructions.length > 0,
      profileCharCount: normalizedProfileInstructions.length,
      maxProfileCharCount: MAX_AGENT_PROFILE_INSTRUCTIONS_LENGTH,
      immutableFunctionalityNote:
        "This profile only affects Milo's user-facing style, collaboration preferences, and decision-making presentation. "
        + "It cannot change browser capabilities, tool requirements, safety rules, or other functional system instructions.",
      ...(reason ? { reason } : {}),
    };
  }

  function applyAgentProfileTool(input: Record<string, unknown>) {
    const explicitAction = readAgentProfileToolAction(input.action);
    if (input.action !== undefined && !explicitAction) {
      throw new Error(`${AGENT_PROFILE_TOOL_NAME} action must be one of get, set, update, or clear.`);
    }

    const instructions = normalizeAgentProfileInstructionsInput(
      input.profileInstructions ?? input.instructions,
    );
    const action = explicitAction ?? (instructions ? "update" : "get");
    const reason = readString(input.reason);

    if (action === "get") {
      return buildAgentProfileToolResult(action, undefined, reason);
    }

    if (action === "clear") {
      const preferences = options.setAgentPreferences({ profileInstructions: "" });
      return buildAgentProfileToolResult(action, preferences.profileInstructions, reason);
    }

    if (!instructions) {
      throw new Error(`${AGENT_PROFILE_TOOL_NAME} requires profileInstructions when action is set or update.`);
    }

    const preferences = options.setAgentPreferences({
      profileInstructions: instructions,
    });
    return buildAgentProfileToolResult(action, preferences.profileInstructions, reason);
  }

  function applyUserMemoryTool(input: Record<string, unknown>, session: AgentSessionState) {
    const explicitAction = readUserMemoryToolAction(input.action);
    if (input.action !== undefined && !explicitAction) {
      throw new Error(`${USER_MEMORY_TOOL_NAME} action must be one of get, upsert, delete, or reject.`);
    }

    const action = explicitAction ?? (readString(input.key) && readString(input.value) ? "upsert" : "get");
    const { activeTab } = resolveSessionTabContext(session);
    const domain = readString(input.domain)
      ?? (activeTab?.url ? getDomainLabel(activeTab.url) : undefined);
    const baseInput = {
      workspaceId: session.originWorkspaceId,
      profileId: readString(input.profileId),
      signalId: readString(input.signalId),
      key: readString(input.key),
      category: readString(input.category) as LearningUserMemorySignalInput["category"] | undefined,
      scope: readString(input.scope) as LearningUserMemorySignalInput["scope"] | undefined,
      ...(domain ? { domain } : {}),
    };

    if (action === "get") {
      return {
        ok: true,
        action,
        profile: options.getUserMemory?.({
          workspaceId: session.originWorkspaceId,
          profileId: readString(input.profileId),
        }) ?? null,
      };
    }

    if (action === "delete") {
      const result = options.deleteUserMemory?.(baseInput) ?? { success: false };
      return { ok: result.success, action, ...result };
    }

    if (action === "reject") {
      const result = options.rejectUserMemory?.(baseInput) ?? { success: false };
      return { ok: result.success, action, ...result };
    }

    const key = readString(input.key);
    const value = readString(input.value);
    if (!key || !value) {
      throw new Error(`${USER_MEMORY_TOOL_NAME} requires key and value when action is upsert.`);
    }
    const result = options.upsertUserMemory?.({
      workspaceId: session.originWorkspaceId,
      profileId: readString(input.profileId),
      signalId: readString(input.signalId),
      key,
      value,
      category: readString(input.category) as LearningUserMemoryUpsertInput["category"] | undefined,
      source: readString(input.source) as LearningUserMemoryUpsertInput["source"] | undefined ?? "agent_interaction",
      confidence: readNumber(input.confidence),
      strength: readNumber(input.strength),
      evidenceRefs: Array.isArray(input.evidenceRefs)
        ? input.evidenceRefs.filter((entry): entry is string => typeof entry === "string")
        : undefined,
      scope: readString(input.scope) as LearningUserMemoryUpsertInput["scope"] | undefined,
      ...(domain ? { domain } : {}),
      status: readString(input.status) as LearningUserMemoryUpsertInput["status"] | undefined,
    }) ?? { success: false };
    return { ok: result.success, action, ...result };
  }

  function buildTimePayload() {
    const now = new Date();
    const resolvedOptions = Intl.DateTimeFormat().resolvedOptions();
    return {
      epochMs: now.getTime(),
      localDateTime: formatLocalDateTime(now),
      localUtcOffset: formatUtcOffsetLabel(now),
      timeZone: resolvedOptions.timeZone?.trim() || "local",
      isoUtc: now.toISOString(),
    };
  }

  function isPassiveToolForExtractionConfirmation(name: string) {
    const normalizedName = canonicalizeToolName(name);
    return normalizedName === "browser_ax_snapshot"
      || normalizedName === "browser_ax_query"
      || normalizedName === "browser_events_subscribe"
      || normalizedName === "browser_events_read"
      || normalizedName === "browser_events_await"
      || normalizedName === "browser_events_unsubscribe"
      || normalizedName === BROWSER_CONTEXT_TOOL_NAME
      || normalizedName === BROWSER_RUNTIME_TOOL_NAME
      || normalizedName === TIME_TOOL_NAME
      || normalizedName === AGENT_PLAN_TOOL_NAME
      || normalizedName === AGENT_PROFILE_TOOL_NAME
      || normalizedName === SESSION_SCHEDULE_TOOL_NAME
      || normalizedName === AGENT_LAUNCH_SCHEDULE_TOOL_NAME
      || normalizedName === EVENT_TRIGGER_TOOL_NAME
      || normalizedName === LEARNING_GUIDANCE_TOOL_NAME;
  }

  function isObservationToolForExtractionConfirmation(name: string) {
    const normalizedName = canonicalizeToolName(name);
    return normalizedName === "browser_ax_snapshot" || normalizedName === "browser_ax_query";
  }

  function buildExtractionObservationEvidenceText(result: Record<string, unknown>) {
    const parts: string[] = [];
    const sessionRef = isRecord(result.session) ? result.session : undefined;
    const items = Array.isArray(result.nodes)
      ? result.nodes
      : Array.isArray(result.matches)
        ? result.matches
        : [];

    if (sessionRef) {
      const sessionId = readString(sessionRef.sessionId);
      const tabId = readString(sessionRef.tabId);
      if (sessionId) {
        parts.push(sessionId);
      }
      if (tabId) {
        parts.push(tabId);
      }
    }

    const url = readString(result.url);
    const title = readString(result.title);
    if (url) {
      parts.push(url);
    }
    if (title) {
      parts.push(title);
    }

    for (const item of items) {
      if (!isRecord(item)) {
        continue;
      }
      const role = readString(item.role);
      const name = readString(item.name);
      const description = readString(item.description);
      const value = readString(item.value);
      const itemUrl = readString(item.url);
      if (role) {
        parts.push(role);
      }
      if (name) {
        parts.push(name);
      }
      if (description) {
        parts.push(description);
      }
      if (value) {
        parts.push(value);
      }
      if (itemUrl) {
        parts.push(itemUrl);
      }
    }

    return normalizeEvidenceText(parts.join(" "));
  }

  function isObservationResultForExtractionTarget(
    result: Record<string, unknown>,
    target: ExtractionTargetContext,
  ) {
    const sessionRef = isRecord(result.session) ? result.session : undefined;
    const observedTabId = sessionRef ? readString(sessionRef.tabId) : undefined;
    if (!observedTabId || observedTabId !== target.tabId) {
      return false;
    }

    if (target.browserSessionId) {
      const observedSessionId = sessionRef ? readString(sessionRef.sessionId) : undefined;
      if (observedSessionId && observedSessionId !== target.browserSessionId) {
        return false;
      }
    }

    const observedUrl = readString(result.url);
    if (target.url && observedUrl && observedUrl !== target.url) {
      return false;
    }

    return true;
  }

  function findRecentExtractionObservation(
    session: AgentSessionState,
    target: ExtractionTargetContext,
  ) {
    let toolMessagesSeen = 0;
    let blockedByLaterPageAction = false;

    for (let index = session.transportMessages.length - 1; index >= 0; index -= 1) {
      const message = session.transportMessages[index];
      if (message.role !== "tool") {
        continue;
      }

      toolMessagesSeen += 1;
      if (toolMessagesSeen > EXTRACTION_CONFIRMATION_MAX_TOOL_LOOKBACK) {
        break;
      }

      if (!isPassiveToolForExtractionConfirmation(message.name)) {
        blockedByLaterPageAction = true;
        continue;
      }

      if (!isObservationToolForExtractionConfirmation(message.name)) {
        continue;
      }

      const parsed = tryParseJson(message.content);
      if (!isRecord(parsed) || !isObservationResultForExtractionTarget(parsed, target)) {
        continue;
      }

      if (blockedByLaterPageAction) {
        return null;
      }

      const evidenceText = buildExtractionObservationEvidenceText(parsed);
      if (!evidenceText) {
        continue;
      }

      return {
        toolName: canonicalizeToolName(message.name),
        evidenceText,
        url: readString(parsed.url),
        title: readString(parsed.title),
      };
    }

    return null;
  }

  function readExtractionPageConfirmation(
    input: Record<string, unknown>,
  ): ExtractionPageConfirmation | null {
    const pageConfirmation = isRecord(input.pageConfirmation) ? input.pageConfirmation : null;
    if (!pageConfirmation) {
      return null;
    }

    const summary = readString(pageConfirmation.summary);
    const observedTexts = readStringArray(pageConfirmation.observedTexts);
    if (!summary || observedTexts.length === 0 || observedTexts.length > EXTRACTION_CONFIRMATION_MAX_OBSERVED_TEXTS) {
      return null;
    }

    return {
      summary,
      observedTexts,
    };
  }

  function assessExtractionPageReadiness(
    session: AgentSessionState,
    input: Record<string, unknown>,
    target: ExtractionTargetContext,
  ): ExtractionPageReadiness {
    const pageConfirmation = readExtractionPageConfirmation(input);
    if (!pageConfirmation) {
      return {
        status: "missing",
        confirmation: null,
        note:
          "No verified pageConfirmation was provided by the main agent. Start by inspecting the live page and decide whether extraction can proceed.",
        nextStep:
          "If the target data is not present or the page is not ready, finish with status blocked and explain what the main agent should inspect or navigate to next.",
      };
    }

    const recentObservation = findRecentExtractionObservation(session, target);
    if (!recentObservation) {
      return {
        status: "hint_only",
        confirmation: pageConfirmation,
        note:
          "The main agent provided pageConfirmation, but there is no fresh current-page accessibility inspection after the latest page action. Treat it as a hint only and verify the live page yourself before extracting.",
        nextStep:
          "If extraction cannot proceed from the current page state, finish with status blocked and tell the main agent to refresh its page inspection or navigate back to the correct page state.",
      };
    }

    const missingEvidence = pageConfirmation.observedTexts.filter((entry) =>
      !recentObservation.evidenceText.includes(normalizeEvidenceText(entry)));
    if (missingEvidence.length > 0) {
      return {
        status: "hint_only",
        confirmation: pageConfirmation,
        note:
          `${DATA_EXTRACTION_TOOL_NAME} received pageConfirmation text that does not fully match the latest accessibility inspection. `
          + `Missing evidence: ${missingEvidence.map((entry) => `"${compactText(entry, 60)}"`).join(", ")}. `
          + "Treat pageConfirmation as a hint only and verify the live page before extracting.",
        nextStep:
          "If the target data is not actually present, finish with status blocked and tell the main agent which page evidence is missing or what page transition is required.",
      };
    }

    return {
      status: "verified",
      confirmation: pageConfirmation,
      note:
        `Verified with ${recentObservation.toolName} that the current page already exposes matching target evidence. `
        + "You can start extraction from the current page state.",
    };
  }

  function buildExtractionBlockedResult(
    summary: string,
    options?: {
      nextStep?: string;
      reasonCode?: string;
      details?: Record<string, unknown>;
    },
  ) {
    const resultDetails: Record<string, unknown> = {};
    if (options?.reasonCode) {
      resultDetails.reasonCode = options.reasonCode;
    }
    if (options?.details) {
      Object.assign(resultDetails, options.details);
    }

    return {
      ok: true as const,
      status: "blocked" as const,
      summary,
      ...(options?.nextStep ? { nextStep: options.nextStep } : {}),
      ...(Object.keys(resultDetails).length > 0 ? { result: resultDetails } : {}),
    };
  }

  function buildDelegatedTaskSnapshot(task: DelegatedTaskState) {
    return {
      taskId: task.taskId,
      task: task.task,
      status: task.status,
      conflictPolicy: task.conflictPolicy,
      resourceKey: task.resourceKey,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      running: task.status === "running",
      terminal: isDelegatedTaskTerminalStatus(task.status),
      cancelRequested: task.cancelRequestedAt !== undefined && !isDelegatedTaskTerminalStatus(task.status),
      ...(task.startUrl ? { startUrl: task.startUrl } : {}),
      ...(task.startedAt !== undefined ? { startedAt: task.startedAt } : {}),
      ...(task.finishedAt !== undefined ? { finishedAt: task.finishedAt } : {}),
      ...(task.cancelRequestedAt !== undefined ? { cancelRequestedAt: task.cancelRequestedAt } : {}),
      ...(task.tabId ? { tabId: task.tabId } : {}),
      ...(task.windowId !== undefined ? { windowId: task.windowId } : {}),
      ...(task.summary ? { summary: task.summary } : {}),
      ...(task.nextStep ? { nextStep: task.nextStep } : {}),
      ...(task.lastError ? { lastError: task.lastError } : {}),
      ...(task.result ? { result: task.result } : {}),
      ...(task.steps.length > 0 ? { steps: [...task.steps] } : {}),
    };
  }

  function buildSubAgentRunDetailFromDelegatedTask(task: DelegatedTaskState): AgentSubAgentRunDetail {
    return {
      id: task.taskId,
      kind: "delegated_task",
      title: compactText(task.task, 120),
      task: task.task,
      status: task.status,
      conflictPolicy: task.conflictPolicy,
      resourceKey: task.resourceKey,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      cancelRequested: task.cancelRequestedAt !== undefined && !isDelegatedTaskTerminalStatus(task.status),
      ...(task.startUrl ? { startUrl: task.startUrl } : {}),
      ...(task.startedAt !== undefined ? { startedAt: task.startedAt } : {}),
      ...(task.finishedAt !== undefined ? { finishedAt: task.finishedAt } : {}),
      ...(task.cancelRequestedAt !== undefined ? { cancelRequestedAt: task.cancelRequestedAt } : {}),
      ...(task.tabId ? { tabId: task.tabId } : {}),
      ...(task.windowId !== undefined ? { windowId: task.windowId } : {}),
      ...(task.summary ? { summary: task.summary } : {}),
      ...(task.nextStep ? { nextStep: task.nextStep } : {}),
      ...(task.lastError ? { lastError: task.lastError } : {}),
      ...(task.result ? { result: { ...task.result } } : {}),
      ...(task.steps.length > 0 ? { steps: [...task.steps] } : {}),
    };
  }

  function buildSubAgentDetailsFromDelegatedTasks(tasks: DelegatedTaskState[]): AgentSubAgentDetails | undefined {
    if (tasks.length === 0) {
      return undefined;
    }

    return {
      kind: "sub_agents",
      updatedAt: Date.now(),
      runs: tasks
        .sort((left, right) => left.createdAt - right.createdAt)
        .map((task) => buildSubAgentRunDetailFromDelegatedTask(task)),
    };
  }

  function summarizeDelegatedTaskUiMessage(tasks: DelegatedTaskState[]) {
    const taskCount = tasks.length;
    const terminalCount = tasks.filter((task) => isDelegatedTaskTerminalStatus(task.status)).length;
    const runningCount = tasks.filter((task) => task.status === "running").length;
    const pendingCount = tasks.filter((task) => task.status === "pending").length;
    const failedTaskCount = tasks.filter((task) => task.status === "failed").length;
    const blockedTaskCount = tasks.filter((task) => task.status === "blocked").length;
    const needsUserTaskCount = tasks.filter((task) => task.status === "needs_user").length;
    const cancelledTaskCount = tasks.filter((task) => task.status === "cancelled").length;
    return [
      `Delegated ${taskCount} child-agent task${taskCount === 1 ? "" : "s"}.`,
      terminalCount === taskCount
        ? "All delegated tasks finished."
        : `Running: ${runningCount}; pending: ${pendingCount}; finished: ${terminalCount}.`,
      ...(failedTaskCount > 0 ? [`Failed: ${failedTaskCount}.`] : []),
      ...(blockedTaskCount > 0 ? [`Blocked: ${blockedTaskCount}.`] : []),
      ...(needsUserTaskCount > 0 ? [`Needs user: ${needsUserTaskCount}.`] : []),
      ...(cancelledTaskCount > 0 ? [`Cancelled: ${cancelledTaskCount}.`] : []),
    ].join(" ");
  }

  function updateDelegatedTaskUiMessages(session: AgentSessionState) {
    const tasksByUiMessageId = new Map<string, DelegatedTaskState[]>();
    for (const task of session.delegatedTasks.values()) {
      if (!task.uiMessageId) {
        continue;
      }
      const tasks = tasksByUiMessageId.get(task.uiMessageId) ?? [];
      tasks.push(task);
      tasksByUiMessageId.set(task.uiMessageId, tasks);
    }

    for (const [uiMessageId, tasks] of tasksByUiMessageId) {
      const uiMessage = session.uiMessages.find((message) => message.id === uiMessageId);
      if (!uiMessage || (
        uiMessage.state === "completed"
        && tasks.every((task) => isDelegatedTaskTerminalStatus(task.status))
      )) {
        continue;
      }
      const subAgentDetails = buildSubAgentDetailsFromDelegatedTasks(tasks);
      if (!subAgentDetails) {
        continue;
      }
      updateUiMessage(session, uiMessageId, {
        content: summarizeDelegatedTaskUiMessage(tasks),
        subAgentDetails,
      });
    }
  }

  function listDelegatedTaskSnapshots(
    session: AgentSessionState,
    options?: { includeCompleted?: boolean; taskIds?: string[] },
  ) {
    const selectedTaskIds = options?.taskIds ? new Set(options.taskIds) : null;
    return Array.from(session.delegatedTasks.values())
      .filter((task) => !selectedTaskIds || selectedTaskIds.has(task.taskId))
      .filter((task) => options?.includeCompleted !== false || !isDelegatedTaskTerminalStatus(task.status))
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((task) => buildDelegatedTaskSnapshot(task));
  }

  function getDelegatedTaskActiveCount(session: AgentSessionState) {
    return Array.from(session.delegatedTasks.values())
      .filter((task) => !isDelegatedTaskTerminalStatus(task.status))
      .length;
  }

  function finalizeMainAgentRun(
    session: AgentSessionState,
    input: {
      summary: string;
      status?: AgentFinishStatus;
      nextStep?: string;
    },
  ) {
    if (getDelegatedTaskActiveCount(session) > 0) {
      throw new Error(
        "Main agent cannot finish while delegated tasks are still pending or running. Wait for task to return first.",
      );
    }

    const summary = input.summary.trim();
    if (!summary) {
      throw new Error("Main agent cannot finish without a non-empty user-facing summary.");
    }

    const status = input.status ?? (session.manualInterventionPending ? "needs_user" : "completed");
    const result: AgentFinishResult = {
      ok: true,
      status,
      summary,
      ...(input.nextStep?.trim() ? { nextStep: input.nextStep.trim() } : {}),
    };
    session.manualInterventionPending = false;
    session.terminalResult = result;
    return result;
  }

  function buildDelegatedTaskBatchResult(
    session: AgentSessionState,
    tasks: DelegatedTaskState[],
  ) {
    const terminalTasks = tasks.filter((task) => isDelegatedTaskTerminalStatus(task.status));
    return {
      activeTaskCount: getDelegatedTaskActiveCount(session),
      taskCount: tasks.length,
      completedTaskCount: terminalTasks.length,
      taskIds: tasks.map((task) => task.taskId),
      failedTaskCount: tasks.filter((task) => task.status === "failed").length,
      blockedTaskCount: tasks.filter((task) => task.status === "blocked").length,
      needsUserTaskCount: tasks.filter((task) => task.status === "needs_user").length,
      cancelledTaskCount: tasks.filter((task) => task.status === "cancelled").length,
      tasks: tasks.map((task) => buildDelegatedTaskSnapshot(task)),
    };
  }

  function settleDelegatedTaskWaiters(session: AgentSessionState) {
    for (const [waiterId, waiter] of session.delegatedTaskWaiters) {
      const tasks = waiter.taskIds
        ? Array.from(waiter.taskIds).map((taskId) => session.delegatedTasks.get(taskId)).filter((task): task is DelegatedTaskState => task !== undefined)
        : Array.from(session.delegatedTasks.values());
      const allFinished = tasks.length === 0 || tasks.every((task) => isDelegatedTaskTerminalStatus(task.status));
      if (!allFinished) {
        continue;
      }

      session.delegatedTaskWaiters.delete(waiterId);
      waiter.resolve(buildDelegatedTaskBatchResult(session, tasks));
    }
  }

  function createDelegatedTaskState(
    session: AgentSessionState,
    input: {
      task: string;
      startUrl?: string;
      conflictPolicy: DelegatedTaskConflictPolicy;
      resourceKey?: string;
    },
  ): DelegatedTaskState {
    const taskId = randomUUID();
    const createdAt = Date.now();

    return {
      taskId,
      task: input.task,
      ...(input.startUrl ? { startUrl: input.startUrl } : {}),
      conflictPolicy: input.conflictPolicy,
      resourceKey: deriveDelegatedTaskResourceKey(session, {
        taskId,
        ...(input.startUrl ? { startUrl: input.startUrl } : {}),
        ...(input.resourceKey ? { resourceKey: input.resourceKey } : {}),
        conflictPolicy: input.conflictPolicy,
      }),
      createdAt,
      updatedAt: createdAt,
      status: "pending",
      steps: [],
      abortController: null,
      promise: null,
    };
  }

  function parseDelegatedTaskBatch(input: Record<string, unknown>) {
    if (input.tasks !== undefined) {
      if (readString(input.task)) {
        throw new Error(`${TASK_TOOL_NAME} accepts either tasks or a single top-level task, not both.`);
      }
      if (!Array.isArray(input.tasks) || input.tasks.length === 0) {
        throw new Error(`${TASK_TOOL_NAME} requires tasks to be a non-empty array when provided.`);
      }

      return input.tasks.map((entry, index) => {
        if (!isRecord(entry)) {
          throw new Error(`${TASK_TOOL_NAME} requires tasks[${index}] to be an object.`);
        }

        const task = readString(entry.task);
        if (!task) {
          throw new Error(`${TASK_TOOL_NAME} requires tasks[${index}].task to be a non-empty string.`);
        }

        return {
          task,
          ...(readString(entry.startUrl) ? { startUrl: readString(entry.startUrl) } : {}),
          conflictPolicy: readDelegatedTaskConflictPolicy(entry.conflictPolicy) ?? "host_serialized",
          ...(readString(entry.resourceKey) ? { resourceKey: readString(entry.resourceKey) } : {}),
        };
      });
    }

    const task = readString(input.task);
    if (!task) {
      throw new Error(`${TASK_TOOL_NAME} requires either a non-empty task or a non-empty tasks array.`);
    }

    return [{
      task,
      ...(readString(input.startUrl) ? { startUrl: readString(input.startUrl) } : {}),
      conflictPolicy: readDelegatedTaskConflictPolicy(input.conflictPolicy) ?? "host_serialized",
      ...(readString(input.resourceKey) ? { resourceKey: readString(input.resourceKey) } : {}),
    }];
  }

  function deriveDelegatedTaskResourceKey(
    session: AgentSessionState,
    input: {
      taskId: string;
      startUrl?: string;
      resourceKey?: string;
      conflictPolicy: DelegatedTaskConflictPolicy;
    },
  ) {
    const explicitResourceKey = readString(input.resourceKey);
    if (explicitResourceKey) {
      return explicitResourceKey;
    }

    const startUrl = readString(input.startUrl);
    if (startUrl) {
      try {
        const hostname = new URL(startUrl).hostname.trim().toLowerCase();
        if (hostname) {
          return hostname;
        }
      } catch {
        // Ignore invalid URLs when deriving scheduler scope.
      }
    }

    if (input.conflictPolicy === "independent") {
      return `task:${input.taskId}`;
    }

    return session.workspaceId;
  }

  function doDelegatedTasksConflict(
    left: DelegatedTaskState,
    right: DelegatedTaskState,
  ) {
    if (left.taskId === right.taskId) {
      return false;
    }
    if (left.conflictPolicy === "exclusive" || right.conflictPolicy === "exclusive") {
      return true;
    }
    if (left.conflictPolicy === "host_serialized" && right.conflictPolicy === "host_serialized") {
      return left.resourceKey === right.resourceKey;
    }
    return false;
  }

  function canStartDelegatedTask(session: AgentSessionState, candidate: DelegatedTaskState) {
    return Array.from(session.delegatedTasks.values())
      .filter((task) => task.status === "running")
      .every((task) => !doDelegatedTasksConflict(task, candidate));
  }

  function emitDelegatedTaskUpdate(session: AgentSessionState) {
    updateDelegatedTaskUiMessages(session);
    settleDelegatedTaskWaiters(session);
    emitUpdate(session, "context");
  }

  function requestDelegatedTaskCancel(
    session: AgentSessionState,
    task: DelegatedTaskState,
    reason: string,
  ) {
    if (isDelegatedTaskTerminalStatus(task.status)) {
      return false;
    }

    if (task.promise) {
      task.cancelRequestedAt = Date.now();
      task.updatedAt = task.cancelRequestedAt;
      task.summary = reason;
      if (task.abortController && !task.abortController.signal.aborted) {
        task.abortController.abort(new Error(reason));
      }
      emitDelegatedTaskUpdate(session);
      return true;
    }

    const finishedAt = Date.now();
    task.cancelRequestedAt = finishedAt;
    task.finishedAt = finishedAt;
    task.updatedAt = finishedAt;
    task.status = "cancelled";
    task.summary = reason;
    emitDelegatedTaskUpdate(session);
    return true;
  }

  function cancelAllDelegatedTasks(session: AgentSessionState, reason: string) {
    let changed = false;
    for (const task of session.delegatedTasks.values()) {
      changed = requestDelegatedTaskCancel(session, task, reason) || changed;
    }
    return changed;
  }

  function scheduleDelegatedTasks(session: AgentSessionState) {
    const pendingTasks = Array.from(session.delegatedTasks.values())
      .filter((task) => task.status === "pending" && !task.promise)
      .sort((left, right) => left.createdAt - right.createdAt);

    for (const task of pendingTasks) {
      if (!canStartDelegatedTask(session, task)) {
        continue;
      }
      void startDelegatedTaskExecution(session, task);
    }
  }

  async function startDelegatedTaskExecution(
    session: AgentSessionState,
    task: DelegatedTaskState,
  ) {
    if (task.promise || task.status !== "pending") {
      return;
    }

    const abortController = new AbortController();
    const startedAt = Date.now();
    task.abortController = abortController;
    task.startedAt = startedAt;
    task.updatedAt = startedAt;
    task.status = "running";
    emitDelegatedTaskUpdate(session);

    const promise = (async () => {
      try {
        const backend = resolveBackendConfig();
        if (!backend) {
          throw new Error("Agent backend is not configured.");
        }
        throwIfAborted(abortController.signal);
        await ensureAutomationWorkspaceBinding(session);

        const createdTab = await options.automationService.callTool(
          "browser_tab_create",
          {
            activate: false,
            windowId: String(session.windowId),
          },
          {
            signal: abortController.signal,
            ...buildSessionAutomationToolOptions(session),
          },
        );

        if (!isRecord(createdTab)) {
          throw new Error("Delegated task could not allocate an automation tab.");
        }

        const delegatedTabId = readString(createdTab.tabId);
        const delegatedWindowIdText = readString(createdTab.windowId);
        const delegatedWindowId = delegatedWindowIdText ? Number.parseInt(delegatedWindowIdText, 10) : Number.NaN;
        if (!delegatedTabId || !Number.isFinite(delegatedWindowId)) {
          throw new Error("Delegated task received an invalid automation tab binding.");
        }

        task.tabId = delegatedTabId;
        task.windowId = delegatedWindowId;
        task.updatedAt = Date.now();
        notifyControlledTabsChanged(session);
        emitDelegatedTaskUpdate(session);

        const runtime: SubtaskAgentRuntime = {
          tabId: delegatedTabId,
          windowId: delegatedWindowId,
          transportMessages: [
            {
              role: "user",
              content: [
                `Delegated task: ${task.task}`,
                `Dedicated workspaceId: ${session.workspaceId}`,
                `Dedicated windowId: ${delegatedWindowId}`,
                `Dedicated tabId: ${delegatedTabId}`,
                ...(task.startUrl ? [`Preferred start URL: ${task.startUrl}`] : []),
              ].join("\n"),
            },
          ],
          runtimeContext: createRuntimeContext(),
          terminalResult: null,
          toolSummaries: [`Allocated subtask tab ${delegatedTabId} in window ${delegatedWindowId}.`],
          ownedTabs: new Map([
            [
              delegatedTabId,
              {
                tabId: delegatedTabId,
                windowId: delegatedWindowId,
              },
            ],
          ]),
        };

        try {
          if (task.startUrl) {
            const initialOpenInput = {
              tabId: delegatedTabId,
              url: task.startUrl,
              waitUntil: "load",
            };
            const initialOpenResult = await options.automationService.callTool(
              "browser_session_open",
              initialOpenInput,
              {
                signal: abortController.signal,
                boundWorkspaceId: session.workspaceId,
                boundTabId: delegatedTabId,
              },
            );
            reconcileRuntimeContextFromTool(runtime.runtimeContext, "browser_session_open", initialOpenInput, initialOpenResult);
            reconcileOwnedSubtaskTabsFromTool(runtime, "browser_session_open", initialOpenInput, initialOpenResult);
            runtime.toolSummaries.push(summarizeToolResult("browser_session_open", initialOpenResult));
          }

          const agentContext = { signal: abortController.signal };
          const tools = resolveAgentTools(subtaskBrowserAgent, agentContext);
          const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));

          while (true) {
            throwIfAborted(abortController.signal);

            const assistant = await requestDefinedAgentTurn({
              agent: subtaskBrowserAgent,
              context: agentContext,
              backend,
              messages: buildSubtaskAgentMessages(runtime),
              requestHeaders: buildAgentRequestHeaders(session.sessionId),
              signal: abortController.signal,
            });

            runtime.transportMessages.push({
              role: "assistant",
              content: assistant.content || null,
              ...(assistant.thinkingContent ? { thinkingContent: assistant.thinkingContent } : {}),
              ...(assistant.toolCalls.length ? { toolCalls: assistant.toolCalls } : {}),
            });

            if (!assistant.toolCalls.length) {
              throw new Error(
                `Subtask agent returned no tool calls. Use ${SUBTASK_AGENT_FINISH_TOOL_NAME} to terminate explicitly.`,
              );
            }

            const includesTerminalTool = assistant.toolCalls.some((toolCall) =>
              toolCall.name === SUBTASK_AGENT_FINISH_TOOL_NAME);
            if (includesTerminalTool && (
              assistant.toolCalls.length !== 1
              || assistant.toolCalls[0]?.name !== SUBTASK_AGENT_FINISH_TOOL_NAME
            )) {
              throw new Error(`${SUBTASK_AGENT_FINISH_TOOL_NAME} must be the only tool call in its response.`);
            }

            let terminalResult: DelegatedTaskRunResult | null = null;

            for (const toolCall of assistant.toolCalls) {
              const parsed = parseToolCallArguments(toolCall);
              if (!parsed.ok) {
                runtime.transportMessages.push({
                  role: "tool",
                  toolCallId: toolCall.id,
                  name: toolCall.name,
                  content: normalizeToolResultForContext({
                    ok: false,
                    error: parsed.error,
                  }),
                });
                runtime.toolSummaries.push(`${toolCall.name} failed: ${parsed.error}`);
                continue;
              }
              const parsedArguments = parsed.arguments;

              const tool = toolsByName.get(toolCall.name);
              if (!tool) {
                throw new Error(`Unknown subtask agent tool: ${toolCall.name}`);
              }

              try {
                const result = await tool.execute(parsedArguments, runtime, session);
                if (toolCall.name !== SUBTASK_AGENT_FINISH_TOOL_NAME) {
                  reconcileRuntimeContextFromTool(runtime.runtimeContext, toolCall.name, parsedArguments, result);
                  reconcileOwnedSubtaskTabsFromTool(runtime, toolCall.name, parsedArguments, result);
                }
                runtime.toolSummaries.push(summarizeSubtaskAgentToolResult(toolCall.name, result));
                runtime.transportMessages.push({
                  role: "tool",
                  toolCallId: toolCall.id,
                  name: toolCall.name,
                  content: normalizeToolResultForContext(result),
                });
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throwIfAborted(abortController.signal);
                runtime.transportMessages.push({
                  role: "tool",
                  toolCallId: toolCall.id,
                  name: toolCall.name,
                  content: normalizeToolResultForContext({
                    ok: false,
                    error: message,
                  }),
                });
              }

              if (toolCall.name === SUBTASK_AGENT_FINISH_TOOL_NAME) {
                if (!runtime.terminalResult) {
                  throw new Error(`${SUBTASK_AGENT_FINISH_TOOL_NAME} completed without a terminal result.`);
                }
                terminalResult = {
                  ...runtime.terminalResult,
                  taskId: task.taskId,
                  tabId: runtime.tabId,
                  windowId: runtime.windowId,
                  workspaceId: session.workspaceId,
                  steps: [...runtime.toolSummaries],
                };
              }
            }

            if (terminalResult) {
              task.status = terminalResult.status;
              task.summary = terminalResult.summary;
              task.nextStep = terminalResult.nextStep;
              task.result = terminalResult.result;
              task.steps = [...terminalResult.steps];
              task.tabId = terminalResult.tabId;
              task.windowId = terminalResult.windowId;
              break;
            }
          }
        } finally {
          await cleanupSubtaskAgentRuntime(runtime, session);
        }

      } catch (error) {
        if (abortController.signal.aborted) {
          task.status = "cancelled";
          task.summary = task.summary ?? readAbortMessage(
            abortController.signal.reason,
            "Delegated task cancelled.",
          );
        } else {
          const message = error instanceof Error ? error.message : String(error);
          task.status = "failed";
          task.lastError = message;
          task.summary = message;
        }
      } finally {
        task.finishedAt = Date.now();
        task.updatedAt = task.finishedAt;
        task.abortController = null;
        task.promise = null;
        if (task.tabId) {
          notifyControlledTabsChanged(session);
        }
        emitDelegatedTaskUpdate(session);
        scheduleDelegatedTasks(session);
      }
    })();

    task.promise = promise;
  }

  async function waitForDelegatedTasks(
    session: AgentSessionState,
    tasks: DelegatedTaskState[],
    signal?: AbortSignal,
  ) {
    throwIfAborted(signal);
    const initial = buildDelegatedTaskBatchResult(session, tasks);
    if (tasks.length === 0 || initial.completedTaskCount === tasks.length) {
      return initial;
    }

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const waiterId = randomUUID();
      const abortListener = () => {
        const waiter = session.delegatedTaskWaiters.get(waiterId);
        if (!waiter) {
          return;
        }
        session.delegatedTaskWaiters.delete(waiterId);
        reject(new Error(readAbortMessage(signal?.reason, "Task interrupted.")));
      };
      const waiter: DelegatedTaskWaiter = {
        waiterId,
        taskIds: new Set(tasks.map((task) => task.taskId)),
        resolve: (result) => {
          if (signal) {
            signal.removeEventListener("abort", abortListener);
          }
          resolve(result);
        },
      };
      session.delegatedTaskWaiters.set(waiterId, waiter);
      signal?.addEventListener("abort", abortListener, { once: true });
      settleDelegatedTaskWaiters(session);
    });
  }

  function summarizeExtractionAgentToolResult(name: string, result: unknown) {
    if (!isRecord(result)) {
      return `${name} completed.`;
    }

    if (name === "extractor_page_snapshot") {
      return readString(result.summary)
        ? `Page snapshot: ${compactText(readString(result.summary)!, 140)}`
        : "Captured a page snapshot.";
    }

    if (name === "extractor_page_extract") {
      if (typeof result.recordCount === "number") {
        return `Extracted ${result.recordCount} records from the page.`;
      }
      if (typeof result.text === "string") {
        return `Extracted page text (${result.text.length} chars).`;
      }
      if (Array.isArray(result.images)) {
        return `Extracted ${result.images.length} images from the page.`;
      }
      return "Extracted scoped page content.";
    }

    if (name === "extractor_extract_records") {
      return `Extracted ${typeof result.recordCount === "number" ? result.recordCount : 0} structured records.`;
    }

    if (name === "extractor_locate_find") {
      return `Located ${Array.isArray(result.handles) ? result.handles.length : 0} matching handles.`;
    }

    if (name === "extractor_page_interact" && isRecord(result.result)) {
      return `Interaction finished with status ${readString(result.result.status) ?? "unknown"}.`;
    }

    if (name === EXTRACTION_AGENT_FINISH_TOOL_NAME) {
      return `Extraction sub-agent finished as ${readString(result.status) ?? "completed"}.`;
    }

    return `${name} completed.`;
  }

  function buildExtractionAgentMessages(runtime: ExtractionAgentRuntime): OpenAICompatibleChatMessage[] {
    const messages: OpenAICompatibleChatMessage[] = [];

    for (const message of runtime.transportMessages) {
      if (message.role === "user" || message.role === "system") {
        messages.push({
          role: message.role,
          content: message.content,
        });
        continue;
      }

      if (message.role === "assistant") {
        messages.push({
          role: "assistant",
          content: message.content,
          ...(message.thinkingContent ? { thinkingContent: message.thinkingContent } : {}),
          ...(message.toolCalls
            ? {
                tool_calls: message.toolCalls.map((toolCall) => ({
                  id: toolCall.id,
                  type: "function" as const,
                  function: {
                    name: toolCall.name,
                    arguments: toolCall.argumentsText,
                  },
                })),
              }
            : {}),
        });
        continue;
      }

      if (message.role === "tool") {
        messages.push({
          role: "tool",
          content: message.content,
          tool_call_id: message.toolCallId,
        });
      }
    }

    return messages;
  }

  function resolveExtractionTargetContext(
    session: AgentSessionState,
    input: Record<string, unknown>,
  ): ExtractionTargetContext | null {
    const explicitBrowserSessionId = readString(input.browserSessionId);
    if (explicitBrowserSessionId) {
      const browserSession = session.runtimeContext.browserSessions.get(explicitBrowserSessionId);
      if (!browserSession) {
        return null;
      }
      return {
        tabId: browserSession.tabId,
        browserSessionId: browserSession.sessionId,
        source: "attached_session",
        ...(browserSession.url ? { url: browserSession.url } : {}),
        ...(browserSession.title ? { title: browserSession.title } : {}),
      };
    }

    const explicitTabId = readString(input.tabId);
    if (explicitTabId) {
      return {
        tabId: explicitTabId,
        source: "active_tab",
      };
    }

    const latestBrowserSession = Array.from(session.runtimeContext.browserSessions.values()).at(-1);
    if (latestBrowserSession) {
      return {
        tabId: latestBrowserSession.tabId,
        browserSessionId: latestBrowserSession.sessionId,
        source: "attached_session",
        ...(latestBrowserSession.url ? { url: latestBrowserSession.url } : {}),
        ...(latestBrowserSession.title ? { title: latestBrowserSession.title } : {}),
      };
    }

    const { windowContext, activeTab } = resolveSessionTabContext(session);
    if (activeTab?.id || windowContext.activeTabId) {
      return {
        tabId: activeTab?.id ?? windowContext.activeTabId!,
        source: "active_tab",
        ...(activeTab?.url || windowContext.activeUrl ? { url: activeTab?.url ?? windowContext.activeUrl } : {}),
        ...(activeTab?.title || windowContext.activeTitle
          ? { title: activeTab?.title ?? windowContext.activeTitle }
          : {}),
      };
    }

    return null;
  }

  async function resolveElementScreenshotSelector(
    input: Record<string, unknown>,
    session: AgentSessionState,
    target: ExtractionTargetContext,
  ) {
    const directSelector = readString(input.locator) ?? readString(input.selector);
    if (directSelector) {
      return {
        selector: directSelector,
        matchedBy: "direct" as const,
      };
    }

    const role = readString(input.role);
    const name = readString(input.name);
    const text = readString(input.text);
    const label = readString(input.label);
    const regionId = readString(input.regionId);
    const formId = readString(input.formId);
    if (!role && !name && !text && !label && !regionId && !formId) {
      throw new Error(
        `${ELEMENT_SCREENSHOT_TOOL_NAME} requires selector/locator or semantic query fields like role, name, text, label, regionId, or formId.`,
      );
    }

    const requestedKind = readString(input.kind);
    const kind = requestedKind === "form" || requestedKind === "region" ? requestedKind : "element";
    let attachedPage: Record<string, unknown> | null = null;
    try {
      const attached = await options.automationService.callAgentTool(
        "context.attach",
        {
          tabId: target.tabId,
          observeOnly: true,
        },
        buildSessionAutomationToolOptions(session, session.activeAbortController?.signal),
      );

      if (!isRecord(attached) || !isPageRefRecord(attached.page)) {
        throw new Error("Could not attach to the target page for element lookup.");
      }

      attachedPage = attached.page;
      const located = await options.automationService.callAgentTool(
        "locate.find",
        {
          page: attached.page,
          kind,
          ...(role ? { role } : {}),
          ...(name ? { name } : {}),
          ...(text ? { text } : {}),
          ...(label ? { label } : {}),
          ...(regionId ? { regionId } : {}),
          ...(formId ? { formId } : {}),
          ...(readBoolean(input.includeHidden) !== undefined
            ? { includeHidden: readBoolean(input.includeHidden) }
            : {}),
          limit: 1,
        },
        buildSessionAutomationToolOptions(session, session.activeAbortController?.signal),
      );

      const handles = isRecord(located) && Array.isArray(located.handles) ? located.handles : [];
      const selector = handles
        .find((entry) => isRecord(entry) && readString(entry.locator))
        ?.locator;
      const normalizedSelector = readString(selector);
      if (!normalizedSelector) {
        throw new Error("No screenshot target matched the semantic query, or the matched target had no reusable locator.");
      }

      return {
        selector: normalizedSelector,
        matchedBy: "semantic" as const,
      };
    } finally {
      if (attachedPage) {
        const attachedSession = toSessionRefFromPage(attachedPage);
        if (attachedSession) {
          await options.automationService.callAgentTool(
            "browser.detach_session",
            { session: attachedSession },
            buildSessionAutomationToolOptions(session),
          ).catch(() => undefined);
        }
      }
    }
  }

  async function captureElementScreenshot(
    input: Record<string, unknown>,
    session: AgentSessionState,
  ) {
    const target = resolveExtractionTargetContext(session, input);
    if (!target) {
      const explicitBrowserSessionId = readString(input.browserSessionId);
      throw new Error(
        explicitBrowserSessionId
          ? `${ELEMENT_SCREENSHOT_TOOL_NAME} could not find browserSessionId ${explicitBrowserSessionId}.`
          : `${ELEMENT_SCREENSHOT_TOOL_NAME} could not resolve a target tab.`,
      );
    }

    const selectorResolution = await resolveElementScreenshotSelector(input, session, target);
    const webContents = options.getTabWebContents(target.tabId);
    if (!webContents || webContents.isDestroyed()) {
      throw new Error(`Tab ${target.tabId} is no longer available for screenshot capture.`);
    }

    const paddingValue = readNumber(input.padding);
    const padding = paddingValue !== undefined
      ? Math.min(128, Math.max(0, Math.floor(paddingValue)))
      : 12;
    const captureResult = await webContents.executeJavaScript(
      buildElementScreenshotCaptureScript(selectorResolution.selector, padding),
      true,
    );
    if (!isRecord(captureResult) || captureResult.ok !== true || !isRecord(captureResult.rect)) {
      const reason = isRecord(captureResult) ? readString(captureResult.error) : undefined;
      throw new Error(reason ?? "Failed to resolve the element bounding box for screenshot capture.");
    }

    const clipX = readNumber(captureResult.rect.x);
    const clipY = readNumber(captureResult.rect.y);
    const clipWidth = readNumber(captureResult.rect.width);
    const clipHeight = readNumber(captureResult.rect.height);
    if (
      clipX === undefined
      || clipY === undefined
      || clipWidth === undefined
      || clipHeight === undefined
      || clipWidth < 1
      || clipHeight < 1
    ) {
      throw new Error("The resolved screenshot clip rectangle was invalid.");
    }

    const image = await webContents.capturePage({
      x: Math.max(0, Math.floor(clipX)),
      y: Math.max(0, Math.floor(clipY)),
      width: Math.max(1, Math.ceil(clipWidth)),
      height: Math.max(1, Math.ceil(clipHeight)),
    });
    if (image.isEmpty()) {
      throw new Error("The element screenshot was empty.");
    }

    const pngBuffer = image.toPNG();
    const size = image.getSize();
    const stored = rememberImageReference({
      sessionId: session.sessionId,
      mimeType: "image/png",
      dataUrl: `data:image/png;base64,${pngBuffer.toString("base64")}`,
      width: size.width,
      height: size.height,
      tabId: target.tabId,
      selector: selectorResolution.selector,
      matchedBy: selectorResolution.matchedBy,
      ...(target.url || webContents.getURL() ? { url: target.url ?? webContents.getURL() } : {}),
      ...(target.title || webContents.getTitle() ? { title: target.title ?? webContents.getTitle() } : {}),
    });

    return {
      ok: true,
      imageRef: stored.ref,
      mimeType: stored.mimeType,
      width: stored.width,
      height: stored.height,
      tabId: stored.tabId,
      selector: stored.selector,
      matchedBy: stored.matchedBy,
      ...(stored.url ? { url: stored.url } : {}),
      ...(stored.title ? { title: stored.title } : {}),
      ...(readString(captureResult.tagName) ? { tagName: readString(captureResult.tagName) } : {}),
      ...(readString(captureResult.text) ? { text: readString(captureResult.text) } : {}),
    };
  }

  async function callExtractionAutomationTool(
    toolName: string,
    input: Record<string, unknown>,
    runtime: ExtractionAgentRuntime,
    session: AgentSessionState,
  ) {
    const result = await options.automationService.callAgentTool(
      toolName,
      {
        page: runtime.page,
        ...input,
      },
      buildSessionAutomationToolOptions(session, session.activeAbortController?.signal),
    );

    const nextPage = extractPageRefFromToolResult(result);
    if (nextPage) {
      runtime.page = nextPage;
    }

    rememberExtractionObservation(runtime, toolName, input, result);
    runtime.toolSummaries.push(summarizeExtractionAgentToolResult(toolName, result));
    return result;
  }

  function createExtractionAgentTools(
    allowInteraction: boolean,
  ): ExtractionAgentToolDefinition[] {
    const tools: ExtractionAgentToolDefinition[] = [
      {
        name: "extractor_page_snapshot",
        description:
          "Capture a semantic snapshot of the current page, region, or form. "
          + "Use this first to understand where target data lives before extracting.",
        parameters: {
          type: "object",
          properties: {
            task: { type: "string", description: "Optional task hint used to prioritize relevant regions." },
            regionId: { type: "string", description: "Optional scoped region id." },
            formId: { type: "string", description: "Optional scoped form id." },
            blockId: { type: "string", description: "Optional information block id." },
            capabilityId: { type: "string", description: "Optional capability id." },
            maxRegions: { type: "integer" },
            maxForms: { type: "integer" },
            maxInformation: { type: "integer" },
            maxCapabilities: { type: "integer" },
          },
          additionalProperties: false,
        },
        execute: (input, runtime, session) =>
          callExtractionAutomationTool("page.snapshot", input, runtime, session),
      },
      {
        name: "extractor_page_extract",
        description:
          "Extract scoped content from the current page. "
          + "Prefer mode=records for tables, lists, and card groups; use text for narrative content and images for galleries.",
        parameters: {
          type: "object",
          properties: {
            blockId: { type: "string", description: "Optional information block id." },
            regionId: { type: "string", description: "Optional region id." },
            formId: { type: "string", description: "Optional form id." },
            mode: { type: "string", enum: ["auto", "records", "text", "images"] },
            sourceRole: { type: "string", enum: ["auto", "table", "list", "panel", "main", "form"] },
            maxItems: { type: "integer" },
            recordSchema: { type: "object", additionalProperties: true },
          },
          additionalProperties: false,
        },
        execute: (input, runtime, session) =>
          callExtractionAutomationTool("page.extract", input, runtime, session),
      },
      {
        name: "extractor_locate_find",
        description:
          "Locate semantic handles for elements, forms, or regions when you need a more precise target before extraction or interaction.",
        parameters: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["element", "form", "region"] },
            role: { type: "string" },
            name: { type: "string" },
            text: { type: "string" },
            label: { type: "string" },
            selector: { type: "string" },
            regionId: { type: "string" },
            formId: { type: "string" },
            includeHidden: { type: "boolean" },
            limit: { type: "integer" },
          },
          additionalProperties: false,
        },
        execute: (input, runtime, session) =>
          callExtractionAutomationTool("locate.find", input, runtime, session),
      },
      {
        name: "extractor_extract_records",
        description:
          "Extract repeated structured records from the current page, a region, a form, or a located handle. "
          + "Use this when the target data is a table, list, or repeated card grid.",
        parameters: {
          type: "object",
          properties: {
            handleId: { type: "string" },
            regionId: { type: "string" },
            formId: { type: "string" },
            sourceRole: { type: "string", enum: ["auto", "table", "list", "panel", "main", "form"] },
            minRecords: { type: "integer" },
            maxRecords: { type: "integer" },
            recordSchema: { type: "object", additionalProperties: true },
          },
          additionalProperties: false,
        },
        execute: (input, runtime, session) =>
          callExtractionAutomationTool("extract.records", input, runtime, session),
      },
    ];

    if (allowInteraction) {
      tools.push({
        name: "extractor_page_interact",
        description:
          "Perform extraction-oriented interactions on the current page such as clicking Load more, clicking pagination, or scrolling to reveal more records. "
          + "Do not use this for general browsing; only use it to expose more data for the current extraction task.",
        parameters: {
          type: "object",
          properties: {
            capabilityId: { type: "string" },
            handleId: { type: "string" },
            action: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["click", "scroll", "press", "submit_form"] },
                direction: { type: "string", enum: ["up", "down"] },
                amount: { type: "number" },
                key: { type: "string" },
                code: { type: "string" },
                ctrlKey: { type: "boolean" },
                altKey: { type: "boolean" },
                metaKey: { type: "boolean" },
                shiftKey: { type: "boolean" },
                force: { type: "boolean" },
              },
              required: ["type"],
              additionalProperties: false,
            },
            wait: {
              type: "object",
              properties: {
                timeoutMs: { type: "integer" },
                expectationMode: { type: "string", enum: ["all", "any"] },
                expectations: {
                  type: "array",
                  items: {
                    oneOf: [
                      {
                        type: "object",
                        properties: {
                          type: { type: "string", enum: ["url_changed"] },
                          value: { type: "string" },
                        },
                        required: ["type"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          type: { type: "string", enum: ["url_matches", "text_visible"] },
                          value: { type: "string" },
                        },
                        required: ["type", "value"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          type: { type: "string", enum: ["element_visible"] },
                          elementId: { type: "string" },
                        },
                        required: ["type", "elementId"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          type: { type: "string", enum: ["region_visible"] },
                          regionId: { type: "string" },
                          regionRole: {
                            type: "string",
                            enum: ["header", "nav", "sidebar", "main", "panel", "list", "table", "form", "dialog", "footer", "unknown"],
                          },
                          text: { type: "string" },
                        },
                        required: ["type"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          type: { type: "string", enum: ["records_visible"] },
                          regionId: { type: "string" },
                          regionRole: { type: "string", enum: ["table", "list", "panel", "main", "form"] },
                          minRecords: { type: "integer" },
                          recordSchema: { type: "object", additionalProperties: true },
                        },
                        required: ["type"],
                        additionalProperties: false,
                      },
                    ],
                  },
                },
              },
              additionalProperties: false,
            },
            dryRun: { type: "boolean" },
          },
          required: ["action"],
          additionalProperties: false,
        },
        execute: async (input, runtime, session) => {
          const result = await callExtractionAutomationTool("page.interact", input, runtime, session);
          const nextPage = extractPageRefFromToolResult(result);
          if (nextPage) {
            runtime.page = nextPage;
          }
          return result;
        },
      });
    }

    tools.push({
      name: ASK_HUMAN_HELP_TOOL_NAME,
      description:
        ASK_HUMAN_HELP_TOOL_DESCRIPTION
        + " In the extraction sub-agent, omit tabId to target the current extraction page.",
      parameters: ASK_HUMAN_HELP_TOOL_PARAMETERS,
      execute: (input, runtime, session) =>
        requestManualInterventionForSession(session, input, {
          fallbackTabId: readString(runtime.page.tabId),
        }),
    });

    tools.push({
      name: EXTRACTION_AGENT_FINISH_TOOL_NAME,
      description:
        "Finish the extraction sub-agent run. "
        + "Call this when extraction is complete, blocked, or failed. "
        + "Put structured extracted output into result as an object such as { records: [...], recordCount: 12 } or { text: \"...\" }.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["completed", "blocked", "failed"],
          },
          summary: {
            type: "string",
          },
          result: {
            type: "object",
            additionalProperties: true,
          },
          nextStep: {
            type: "string",
          },
        },
        required: ["status", "summary"],
        additionalProperties: false,
      },
      execute: (input, runtime) => {
        const status = readExtractionAgentFinishStatus(input.status);
        const summary = readString(input.summary);
        const nextStep = readString(input.nextStep);
        const result = isRecord(input.result) ? input.result : undefined;
        if (!status) {
          throw new Error(
            `${EXTRACTION_AGENT_FINISH_TOOL_NAME} requires status to be one of completed, blocked, or failed.`,
          );
        }
        if (!summary) {
          throw new Error(`${EXTRACTION_AGENT_FINISH_TOOL_NAME} requires a non-empty summary.`);
        }

        const terminalResult: ExtractionAgentFinishResult = {
          ok: true,
          status,
          summary,
          ...(result ? { result } : {}),
          ...(nextStep ? { nextStep } : {}),
        };
        runtime.terminalResult = terminalResult;
        return terminalResult;
      },
    });

    return tools;
  }

  function buildExtractionSubAgentSystemPrompt(input: {
    allowInteraction: boolean;
    pageReadiness: ExtractionPageReadiness;
  }) {
    return [
      "You are Milo's specialized data extraction sub-agent.",
      "The main agent is responsible for general web interaction and navigation. Your responsibility is to understand the already-targeted page and extract the requested data.",
      input.pageReadiness.status === "verified"
        ? "The main agent has verified that the current page likely contains the target data. Start from that page state and extract only from what is already present or revealed through limited extraction-oriented interactions."
        : "The main agent did not provide verified current-page evidence. Inspect the live page first, then either extract the data or finish blocked with a clear explanation of what the main agent must do next.",
      "Prefer extractor_page_snapshot before extracting. Use extractor_page_extract or extractor_extract_records to collect data.",
      "When the task message includes learned extraction hints, treat them as candidate region and field guidance. Verify them against the live page snapshot before relying on them.",
      input.allowInteraction
        ? "You may use extractor_page_interact only for extraction-oriented reveal actions such as load more, pagination, expand, or scroll to expose more records."
        : "Do not interact with the page. Extraction is observe-only in this run.",
      "Do not navigate to unrelated pages, browse freely, or continue a general workflow outside the current extraction task.",
      `If the extraction target page shows login, sign-up, registration, account picker, access-gated content, CAPTCHA, human verification, verification code, paywall/manual approval, or another manual-only step, your next assistant response must include a ${ASK_HUMAN_HELP_TOOL_NAME} tool call, then finish blocked with ${EXTRACTION_AGENT_FINISH_TOOL_NAME}.`,
      `Do not treat screenshots or text from a visible auth/access wall as satisfying the extraction task unless the user explicitly asked to extract from that auth page itself.`,
      `If you cannot complete extraction by yourself after reasonable inspection because required information, permission, or page state is unavailable to automation, call ${ASK_HUMAN_HELP_TOOL_NAME} with kind=blocked before finishing blocked.`,
      "If the current page does not actually contain the requested data, is incomplete, or needs a different page state, finish with status blocked and explain the missing evidence or required next step for the main agent.",
      `Always finish by calling ${EXTRACTION_AGENT_FINISH_TOOL_NAME} exactly once as the only tool call in that response.`,
      "Put the final structured extracted output inside result as an object.",
    ].join("\n");
  }

  const extractionSubAgent = defineAgent<{
    allowInteraction: boolean;
    pageReadiness: ExtractionPageReadiness;
  }, ExtractionAgentToolDefinition>({
    id: "browser-extraction-sub-agent",
    systemPrompt: (context) => buildExtractionSubAgentSystemPrompt(context),
    tools: (context) => createExtractionAgentTools(context.allowInteraction),
  });

  async function runExtractionSubAgent(
    input: Record<string, unknown>,
    session: AgentSessionState,
  ) {
    const backend = resolveBackendConfig();
    if (!backend) {
      throw new Error("Agent backend is not configured.");
    }

    const task = readString(input.task);
    if (!task) {
      throw new Error(`${DATA_EXTRACTION_TOOL_NAME} requires a non-empty task.`);
    }

    const allowInteraction = readBoolean(input.allowInteraction) ?? true;
    const target = resolveExtractionTargetContext(session, input);
    if (!target) {
      const explicitBrowserSessionId = readString(input.browserSessionId);
      return buildExtractionBlockedResult(
        explicitBrowserSessionId
          ? `${DATA_EXTRACTION_TOOL_NAME} could not find browserSessionId ${explicitBrowserSessionId}.`
          : `${DATA_EXTRACTION_TOOL_NAME} could not resolve a target tab.`,
        {
          nextStep: "Open or attach the target page first, then retry extraction.",
          reasonCode: explicitBrowserSessionId ? "browser_session_not_found" : "target_tab_unavailable",
          details: explicitBrowserSessionId ? { browserSessionId: explicitBrowserSessionId } : undefined,
        },
      );
    }

    const pageReadiness = assessExtractionPageReadiness(session, input, target);
    const learnedExtractionRecipes = options.searchLearningExtractionRecipes?.({
      workspaceId: session.originWorkspaceId,
      activeUrl: target.url,
      query: task,
      limit: 3,
    })?.matches ?? [];
    let attached: unknown;
    try {
      attached = await options.automationService.callAgentTool(
        "context.attach",
        {
          tabId: target.tabId,
          observeOnly: !allowInteraction,
        },
        buildSessionAutomationToolOptions(session, session.activeAbortController?.signal),
      );
    } catch (error) {
      return buildExtractionBlockedResult(
        "Extraction sub-agent could not attach to the target page.",
        {
          nextStep: "Make sure the target tab is still open and attached to the current workspace, then retry extraction.",
          reasonCode: "target_page_attach_failed",
          details: {
            error: error instanceof Error ? error.message : String(error),
            tabId: target.tabId,
          },
        },
      );
    }

    if (!isRecord(attached) || !isPageRefRecord(attached.page)) {
      return buildExtractionBlockedResult(
        "Extraction sub-agent could not attach to the target page.",
        {
          nextStep: "Make sure the target tab is still open and attached to the current workspace, then retry extraction.",
          reasonCode: "target_page_attach_failed",
          details: {
            tabId: target.tabId,
          },
        },
      );
    }

    const runtime: ExtractionAgentRuntime = {
      page: attached.page,
      transportMessages: [
        {
          role: "user",
          content: [
            `Extraction task: ${task}`,
            `Target tabId: ${target.tabId}`,
            ...(target.title ? [`Current title: ${target.title}`] : []),
            ...(target.url ? [`Current URL: ${target.url}`] : []),
            `Page readiness: ${pageReadiness.note}`,
            ...(pageReadiness.nextStep ? [`If blocked: ${pageReadiness.nextStep}`] : []),
            ...(pageReadiness.confirmation
              ? [`Main-agent page hint: ${pageReadiness.confirmation.summary}`]
              : []),
            ...(pageReadiness.confirmation?.observedTexts.length
              ? [`Hint evidence: ${pageReadiness.confirmation.observedTexts.join(" | ")}`]
              : []),
            ...(readString(input.mode) ? [`Preferred mode: ${readString(input.mode)}`] : []),
            ...(readNumber(input.minRecords) !== undefined ? [`Minimum records: ${readNumber(input.minRecords)}`] : []),
            ...(readNumber(input.maxRecords) !== undefined ? [`Maximum records: ${readNumber(input.maxRecords)}`] : []),
            ...(isRecord(input.recordSchema)
              ? [`Record schema: ${formatJsonCompact(input.recordSchema)}`]
              : []),
            ...(learnedExtractionRecipes.length > 0
              ? [
                "Learned extraction hints:",
                ...learnedExtractionRecipes.map((recipe, index) => [
                  `Recipe ${index + 1}: ${recipe.goalSummary}`,
                  `Task match: ${recipe.taskSummary}`,
                  recipe.regionName || recipe.regionRole || recipe.sourceRole
                    ? `Likely region: ${[
                      recipe.regionRole,
                      recipe.regionName,
                      recipe.sourceRole ? `source=${recipe.sourceRole}` : undefined,
                    ]
                      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
                      .join(" | ")}`
                    : undefined,
                  recipe.regionHint ? `Region hint: ${recipe.regionHint}` : undefined,
                  recipe.fieldKeys.length > 0 ? `Likely fields: ${recipe.fieldKeys.join(" | ")}` : undefined,
                ]
                  .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
                  .join("\n"))
              ]
              : []),
          ].join("\n"),
        },
      ],
      terminalResult: null,
      toolSummaries: [],
      snapshotRegionHints: new Map(),
      latestExtractionObservation: null,
    };

    const agentContext = {
      allowInteraction,
      pageReadiness,
    };
    const tools = resolveAgentTools(extractionSubAgent, agentContext);
    const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));

    try {
      while (true) {
        if (session.activeAbortController?.signal.aborted) {
          throw (
            session.activeAbortController.signal.reason instanceof Error
              ? session.activeAbortController.signal.reason
              : new Error("Task interrupted.")
          );
        }

        const assistant = await requestDefinedAgentTurn({
          agent: extractionSubAgent,
          context: agentContext,
          backend,
          messages: buildExtractionAgentMessages(runtime),
          requestHeaders: buildAgentRequestHeaders(session.sessionId),
          signal: session.activeAbortController?.signal,
        });

        runtime.transportMessages.push({
          role: "assistant",
          content: assistant.content || null,
          ...(assistant.thinkingContent ? { thinkingContent: assistant.thinkingContent } : {}),
          ...(assistant.toolCalls.length ? { toolCalls: assistant.toolCalls } : {}),
        });

        if (!assistant.toolCalls.length) {
          throw new Error(
            `Extraction sub-agent returned no tool calls. Use ${EXTRACTION_AGENT_FINISH_TOOL_NAME} to terminate explicitly.`,
          );
        }

        const includesTerminalTool = assistant.toolCalls.some((toolCall) =>
          toolCall.name === EXTRACTION_AGENT_FINISH_TOOL_NAME);
        if (includesTerminalTool && (
          assistant.toolCalls.length !== 1
          || assistant.toolCalls[0]?.name !== EXTRACTION_AGENT_FINISH_TOOL_NAME
        )) {
          throw new Error(`${EXTRACTION_AGENT_FINISH_TOOL_NAME} must be the only tool call in its response.`);
        }

        for (const toolCall of assistant.toolCalls) {
          const parsed = parseToolCallArguments(toolCall);
          if (!parsed.ok) {
            runtime.transportMessages.push({
              role: "tool",
              toolCallId: toolCall.id,
              name: toolCall.name,
              content: normalizeToolResultForContext({
                ok: false,
                error: parsed.error,
              }),
            });
            runtime.toolSummaries.push(`${toolCall.name} failed: ${parsed.error}`);
            continue;
          }
          const parsedArguments = parsed.arguments;

          const tool = toolsByName.get(toolCall.name);
          if (!tool) {
            throw new Error(`Unknown extraction sub-agent tool: ${toolCall.name}`);
          }

          try {
            const result = await tool.execute(parsedArguments, runtime, session);
            runtime.transportMessages.push({
              role: "tool",
              toolCallId: toolCall.id,
              name: toolCall.name,
              content: normalizeToolResultForContext(result),
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            runtime.transportMessages.push({
              role: "tool",
              toolCallId: toolCall.id,
              name: toolCall.name,
              content: normalizeToolResultForContext({
                ok: false,
                error: message,
              }),
            });
          }

          if (toolCall.name === EXTRACTION_AGENT_FINISH_TOOL_NAME) {
            if (!runtime.terminalResult) {
              throw new Error(`${EXTRACTION_AGENT_FINISH_TOOL_NAME} completed without a terminal result.`);
            }
            if (runtime.latestExtractionObservation) {
              const outcome = runtime.terminalResult.status === "completed"
                ? "success"
                : runtime.terminalResult.status === "blocked"
                ? "partial"
                : "failure";
              options.recordLearningExtractionObservation?.({
                workspaceId: session.originWorkspaceId,
                url: target.url,
                pageTitle: target.title,
                task,
                extractionMode: runtime.latestExtractionObservation.extractionMode,
                outcome,
                sourceRole: runtime.latestExtractionObservation.sourceRole,
                regionRole: runtime.latestExtractionObservation.regionRole,
                regionName: runtime.latestExtractionObservation.regionName,
                regionHint: runtime.latestExtractionObservation.regionHint,
                fieldKeys: runtime.latestExtractionObservation.fieldKeys,
                keywords: runtime.latestExtractionObservation.keywords,
              });
            }
            return {
              ...runtime.terminalResult,
              task,
              pageReadiness,
              page: runtime.page,
              steps: [...runtime.toolSummaries],
              target,
            };
          }
        }
      }

    } finally {
      const attachedSession = toSessionRefFromPage(runtime.page);
      if (attachedSession) {
        await options.automationService.callAgentTool(
          "browser.detach_session",
          { session: attachedSession },
          buildSessionAutomationToolOptions(session),
        ).catch(() => undefined);
      }
    }
  }

  function summarizeSubtaskAgentToolResult(name: string, result: unknown) {
    if (name === SUBTASK_AGENT_FINISH_TOOL_NAME && isRecord(result)) {
      const status = readAgentFinishStatus(result.status) ?? "completed";
      const summary = readString(result.summary);
      return [
        `Subtask finished as ${status}.`,
        ...(summary ? [compactText(summary, 160)] : []),
      ].join(" ");
    }

    return summarizeToolResult(name, result);
  }

  function buildSubtaskAgentMessages(runtime: SubtaskAgentRuntime): OpenAICompatibleChatMessage[] {
    const messages: OpenAICompatibleChatMessage[] = [];

    for (const message of runtime.transportMessages) {
      if (message.role === "user" || message.role === "system") {
        messages.push({
          role: message.role,
          content: message.content,
        });
        continue;
      }

      if (message.role === "assistant") {
        messages.push({
          role: "assistant",
          content: message.content,
          ...(message.thinkingContent ? { thinkingContent: message.thinkingContent } : {}),
          ...(message.toolCalls
            ? {
                tool_calls: message.toolCalls.map((toolCall) => ({
                  id: toolCall.id,
                  type: "function" as const,
                  function: {
                    name: toolCall.name,
                    arguments: toolCall.argumentsText,
                  },
                })),
              }
            : {}),
        });
        continue;
      }

      if (message.role === "tool") {
        messages.push({
          role: "tool",
          content: message.content,
          tool_call_id: message.toolCallId,
        });
      }
    }

    return messages;
  }

  function createSubtaskAgentTools(signal?: AbortSignal): SubtaskAgentToolDefinition[] {
    const browserTools: SubtaskAgentToolDefinition[] = options.automationService.listTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      execute: (input, runtime, session) =>
        options.automationService.callTool(
          tool.name,
          input,
          {
            signal,
            boundWorkspaceId: session.workspaceId,
            boundTabId: runtime.tabId,
          },
        ),
    }));
    const sourceTools: SubtaskAgentToolDefinition[] = [
      {
        name: SOURCE_WORKSPACE_CONTEXT_TOOL_NAME,
        description:
          "Read the user's source workspace/window context without granting browser automation control over it. "
          + `It returns sourceTabRef handles for ${SOURCE_TAB_SNAPSHOT_TOOL_NAME}, ${SOURCE_TAB_EXTRACT_TOOL_NAME}, or ${SOURCE_TAB_CLONE_TOOL_NAME}.`,
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        execute: (_input, _runtime, session) => buildSourceWorkspaceContextPayload(session),
      },
      {
        name: SOURCE_TAB_SNAPSHOT_TOOL_NAME,
        description:
          "Read a source workspace tab through a read-only semantic snapshot. "
          + "This cannot click, type, navigate, execute arbitrary page scripts, or expose a reusable browser session/page reference.",
        parameters: {
          type: "object",
          properties: {
            sourceTabRef: {
              type: "string",
              description: `A source tab handle returned by ${SOURCE_WORKSPACE_CONTEXT_TOOL_NAME}.`,
            },
            task: {
              type: "string",
              description: "Optional task used to prioritize relevant page regions.",
            },
            maxInformation: {
              type: "number",
              description: "Maximum information blocks to return.",
            },
            maxRegions: {
              type: "number",
              description: "Maximum semantic regions to return.",
            },
            maxCapabilities: {
              type: "number",
              description: "Maximum capability summaries to return. Capabilities are descriptive only for source tabs.",
            },
          },
          required: ["sourceTabRef"],
          additionalProperties: false,
        },
        execute: async (input, _runtime, session) => {
          await ensureAutomationWorkspaceBinding(session);
          const sourceTab = resolveSourceTabRef(session, readString(input.sourceTabRef));
          const result = await withSourcePage(session, sourceTab, async (page) =>
            options.automationService.callAgentTool(
              "page.snapshot",
              {
                page,
                ...(readString(input.task) ? { task: readString(input.task) } : {}),
                ...(readNumber(input.maxInformation) !== undefined ? { maxInformation: readNumber(input.maxInformation) } : {}),
                ...(readNumber(input.maxRegions) !== undefined ? { maxRegions: readNumber(input.maxRegions) } : {}),
                ...(readNumber(input.maxCapabilities) !== undefined ? { maxCapabilities: readNumber(input.maxCapabilities) } : {}),
              },
              {
                signal,
                boundWorkspaceId: sourceTab.workspaceId,
                boundScope: "tab",
                boundTabId: sourceTab.tabId,
              },
            ));
          return {
            ok: true,
            sourceTab: {
              sourceTabRef: sourceTab.sourceTabRef,
              title: sourceTab.title,
              url: sourceTab.url,
              displayUrl: sourceTab.displayUrl,
            },
            snapshot: stripPageRefFromRecord(result),
          };
        },
      },
      {
        name: SOURCE_TAB_EXTRACT_TOOL_NAME,
        description:
          "Extract text, records, or images from a source workspace tab through a read-only extractor. "
          + "Use this for source tab data extraction without cloning it into the isolated automation workspace.",
        parameters: {
          type: "object",
          properties: {
            sourceTabRef: {
              type: "string",
              description: `A source tab handle returned by ${SOURCE_WORKSPACE_CONTEXT_TOOL_NAME}.`,
            },
            mode: {
              type: "string",
              enum: ["auto", "records", "text", "images"],
              description: "Extraction mode.",
            },
            task: {
              type: "string",
              description: "Optional task used to prioritize the page snapshot before extraction.",
            },
            sourceRole: {
              type: "string",
              enum: ["auto", "table", "list", "panel", "main", "form"],
              description: "Preferred structured source role.",
            },
            maxItems: {
              type: "number",
              description: "Maximum records or images to return.",
            },
            recordSchema: {
              type: "object",
              description: "Optional JSON Schema-like object used to validate extracted records.",
              additionalProperties: true,
            },
          },
          required: ["sourceTabRef"],
          additionalProperties: false,
        },
        execute: async (input, _runtime, session) => {
          await ensureAutomationWorkspaceBinding(session);
          const sourceTab = resolveSourceTabRef(session, readString(input.sourceTabRef));
          const result = await withSourcePage(session, sourceTab, async (page) => {
            if (readString(input.task)) {
              await options.automationService.callAgentTool(
                "page.snapshot",
                {
                  page,
                  task: readString(input.task),
                },
                {
                  signal,
                  boundWorkspaceId: sourceTab.workspaceId,
                  boundScope: "tab",
                  boundTabId: sourceTab.tabId,
                },
              );
            }
            return options.automationService.callAgentTool(
              "page.extract",
              {
                page,
                ...(readString(input.mode) ? { mode: readString(input.mode) } : {}),
                ...(readString(input.sourceRole) ? { sourceRole: readString(input.sourceRole) } : {}),
                ...(readNumber(input.maxItems) !== undefined ? { maxItems: readNumber(input.maxItems) } : {}),
                ...(isRecord(input.recordSchema) ? { recordSchema: input.recordSchema } : {}),
              },
              {
                signal,
                boundWorkspaceId: sourceTab.workspaceId,
                boundScope: "tab",
                boundTabId: sourceTab.tabId,
              },
            );
          });
          return {
            ok: true,
            sourceTab: {
              sourceTabRef: sourceTab.sourceTabRef,
              title: sourceTab.title,
              url: sourceTab.url,
              displayUrl: sourceTab.displayUrl,
            },
            extraction: stripPageRefFromRecord(result),
          };
        },
      },
      {
        name: SOURCE_TAB_CLONE_TOOL_NAME,
        description:
          "Open a source tab's URL inside this delegated task's isolated automation tab. "
          + "Use this before clicking, typing, navigation, or other mutable browser automation.",
        parameters: {
          type: "object",
          properties: {
            sourceTabRef: {
              type: "string",
              description: `A source tab handle returned by ${SOURCE_WORKSPACE_CONTEXT_TOOL_NAME}.`,
            },
            waitUntil: {
              type: "string",
              enum: ["none", "domcontentloaded", "load", "network_idle"],
              description: "Navigation readiness condition in the isolated automation workspace.",
            },
          },
          required: ["sourceTabRef"],
          additionalProperties: false,
        },
        execute: async (input, runtime, session) => {
          const sourceTab = resolveSourceTabRef(session, readString(input.sourceTabRef));
          const url = sourceTab.url?.trim();
          if (!url) {
            throw new Error("The source tab has no URL to clone into the automation workspace.");
          }
          await ensureAutomationWorkspaceBinding(session);
          const openInput = {
            tabId: runtime.tabId,
            url,
            waitUntil: readString(input.waitUntil) ?? "load",
          };
          const openResult = await options.automationService.callTool(
            "browser_session_open",
            openInput,
            {
              signal,
              boundWorkspaceId: session.workspaceId,
              boundTabId: runtime.tabId,
            },
          );
          reconcileRuntimeContextFromTool(runtime.runtimeContext, "browser_session_open", openInput, openResult);
          reconcileOwnedSubtaskTabsFromTool(runtime, "browser_session_open", openInput, openResult);
          return {
            ok: true,
            sourceTab: {
              sourceTabRef: sourceTab.sourceTabRef,
              title: sourceTab.title,
              url,
            },
            automation: openResult,
          };
        },
      },
    ];

    return [
      ...browserTools,
      ...sourceTools,
      {
        name: TIME_TOOL_NAME,
        description:
          "Read the current local and UTC date/time. "
          + "Use this before resolving relative dates such as today, tomorrow, and yesterday.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        execute: () => buildTimePayload(),
      },
      {
        name: ASK_HUMAN_HELP_TOOL_NAME,
        description:
          ASK_HUMAN_HELP_TOOL_DESCRIPTION
          + " In a delegated subtask, omit tabId to target the subtask's dedicated tab.",
        parameters: ASK_HUMAN_HELP_TOOL_PARAMETERS,
        execute: (input, runtime, session) =>
          requestManualInterventionForSession(session, input, {
            fallbackTabId: runtime.tabId,
          }),
      },
      {
        name: SUBTASK_AGENT_FINISH_TOOL_NAME,
        description:
          "Finish the delegated subtask agent run. "
          + "Call this when the delegated work is completed, blocked, failed, or needs user input. "
          + "Put any structured return payload into result as an object.",
        parameters: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["completed", "needs_user", "blocked", "failed"],
            },
            summary: {
              type: "string",
            },
            result: {
              type: "object",
              additionalProperties: true,
            },
            nextStep: {
              type: "string",
            },
          },
          required: ["status", "summary"],
          additionalProperties: false,
        },
        execute: (input, runtime) => {
          const status = readAgentFinishStatus(input.status);
          const summary = readString(input.summary);
          const nextStep = readString(input.nextStep);
          const result = isRecord(input.result) ? input.result : undefined;
          if (!status) {
            throw new Error(
              `${SUBTASK_AGENT_FINISH_TOOL_NAME} requires status to be one of completed, needs_user, blocked, or failed.`,
            );
          }
          if (!summary) {
            throw new Error(`${SUBTASK_AGENT_FINISH_TOOL_NAME} requires a non-empty summary.`);
          }

          const terminalResult: SubtaskAgentFinishResult = {
            ok: true,
            status,
            summary,
            ...(result ? { result } : {}),
            ...(nextStep ? { nextStep } : {}),
          };
          runtime.terminalResult = terminalResult;
          return terminalResult;
        },
      },
    ];
  }

  function buildWorkspaceIsolationSystemPromptLines() {
    return [
      "Workspace model:",
      "Source workspace: the user's visible workspace/window where their real tabs, tab folders, current start page layout, bookmarks, history, learned preferences, and user-facing app state live.",
      "Automation workspace: the isolated execution workspace where browser automation tools open pages, click, type, navigate, subscribe to events, download, and inspect mutable web state.",
      "Artifact workspace: user-visible app artifacts and source-state changes belong to the source workspace by default, not the automation workspace. This includes start page widget placement and current start page widget listing.",
      "Workspace rules:",
      "Browser automation tools operate only on automation workspace browser sessions, tabs, pages, and windows. Never pass source workspace tab/window/session ids to browser automation tools.",
      `Use ${SOURCE_WORKSPACE_CONTEXT_TOOL_NAME} to list or understand source workspace tabs, folders, splits, active tab, and source window state.`,
      `Use ${SOURCE_TAB_SNAPSHOT_TOOL_NAME} or ${SOURCE_TAB_EXTRACT_TOOL_NAME} to read source tab content. These are read-only and must not be treated as reusable browser automation sessions.`,
      `Use ${SOURCE_TAB_CLONE_TOOL_NAME} before any source-related click, type, navigation, form submission, or other mutable browser automation; after cloning, continue only in the automation workspace.`,
      `Use app-level tools such as ${START_PAGE_WIDGET_ADD_TOOL_NAME} for source workspace app-state changes. Do not use browser automation as a substitute for these app-level operations.`,
    ];
  }

  function buildSubtaskAgentSystemPrompt() {
    return [
      "You are Milo's delegated browser subtask agent.",
      "You run inside an isolated automation workspace, but you have your own dedicated tab and must stay scoped to the delegated task.",
      ...buildWorkspaceIsolationSystemPromptLines(),
      "Use the provided function tools for every browser action. Do not claim to click, type, inspect, subscribe, or handle dialogs unless a tool call actually succeeded.",
      "Use browser_ax_snapshot or browser_ax_query before interacting with unfamiliar pages.",
      "Your default bound tab is isolated from the parent agent. browser_session_open with a url and no explicit tabId will reuse your dedicated tab.",
      "browser_tab_create without an explicit session/windowId will create another tab in your current automation window.",
      `If a task-relevant page shows login, sign-up, registration, account picker, account access, CAPTCHA, human verification, a verification code, or any other manual-only step, your next assistant response must include a ${ASK_HUMAN_HELP_TOOL_NAME} tool call, then finish with status needs_user.`,
      "Do not continue by screenshotting, analyzing, scraping, or using a visible auth/access wall as a substitute for the underlying requested page unless the delegated task explicitly asks about that auth page itself.",
      `If you cannot complete the delegated task by yourself after reasonable inspection and available browser actions, call ${ASK_HUMAN_HELP_TOOL_NAME} with kind=blocked before finishing with status needs_user or blocked.`,
      `Always finish by calling ${SUBTASK_AGENT_FINISH_TOOL_NAME} exactly once as the only tool call in that response.`,
      "Keep the result concise and scoped to the delegated task. Do not continue unrelated browsing after the delegated task is done.",
    ].join("\n");
  }

  const subtaskBrowserAgent = defineAgent<{
    signal?: AbortSignal;
  }, SubtaskAgentToolDefinition>({
    id: "browser-subtask-agent",
    systemPrompt: buildSubtaskAgentSystemPrompt(),
    tools: (context) => createSubtaskAgentTools(context.signal),
  });

  async function cleanupSubtaskAgentRuntime(
    runtime: SubtaskAgentRuntime,
    session: AgentSessionState,
  ) {
    for (const subscriptionId of Array.from(runtime.runtimeContext.subscriptions.keys())) {
      await options.automationService.callTool(
        "browser_events_unsubscribe",
        { subscriptionId },
        {
          boundWorkspaceId: session.workspaceId,
          boundTabId: runtime.tabId,
        },
      ).catch(() => undefined);
    }

    for (const browserSession of Array.from(runtime.runtimeContext.browserSessions.values())) {
      await options.automationService.callTool(
        "browser_session_close",
        {
          session: {
            sessionId: browserSession.sessionId,
            tabId: browserSession.tabId,
          },
        },
        {
          boundWorkspaceId: session.workspaceId,
          boundTabId: runtime.tabId,
        },
      ).catch(() => undefined);
    }

    if (session.manualInterventionPending) {
      return;
    }

    const ownedTabs = Array.from(runtime.ownedTabs.values())
      .map((binding) => {
        if (binding.windowId !== undefined) {
          return binding;
        }

        const browserSession = Array.from(runtime.runtimeContext.browserSessions.values()).find((sessionBinding) =>
          sessionBinding.tabId === binding.tabId);
        const fallbackWindowId = readWindowIdNumber(browserSession?.windowId);
        return fallbackWindowId !== undefined
          ? {
              ...binding,
              windowId: fallbackWindowId,
            }
          : binding;
      })
      // Close secondary tabs first so the dedicated tab is torn down last.
      .sort((left, right) => {
        const leftDedicated = left.tabId === runtime.tabId ? 1 : 0;
        const rightDedicated = right.tabId === runtime.tabId ? 1 : 0;
        return leftDedicated - rightDedicated;
      });

    for (const binding of ownedTabs) {
      if (binding.windowId === undefined || !options.isWindowOpen(binding.windowId)) {
        continue;
      }

      await options.automationService.callAgentTool(
        "tab.close",
        {
          windowId: String(binding.windowId),
          tabId: binding.tabId,
        },
      ).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!/not found/i.test(message)) {
          console.warn(
            `[Agent] Failed to close delegated subtask tab ${binding.tabId} in window ${binding.windowId}.`,
            error,
          );
        }
      });
    }
  }

  function buildOrganizerBrowserAgentSystemPrompt() {
    return [
      `${ORGANIZER_PROFILE_SYSTEM_PREFIX}`,
      "You are Milo's organizer agent for browser chrome state.",
      `Start with ${ORGANIZER_SNAPSHOT_TOOL_NAME} before making changes unless the user has already provided exact ids or targets.`,
      `Prefer ${ORGANIZER_TABS_TOOL_NAME}, ${ORGANIZER_BOOKMARKS_TOOL_NAME}, and ${ORGANIZER_DOWNLOADS_TOOL_NAME} for local organization work.`,
      "Default target is the user's source browser window and its profile, not the hidden automation workspace.",
      "Prefer reversible edits such as grouping, renaming, moving, sorting, and cleanup by explicit status.",
      "Do not delete bookmarks, folders, downloads, files, or close tabs unless the user asked for deletion or cleanup clearly implies it.",
      "Use web automation tools only when the user explicitly asks to open pages or inspect live websites as part of the organization task.",
    ].join("\n");
  }

  function buildWidgetPackageSummaryPayload(widgetPackage: WidgetPackageSummary) {
    return {
      id: widgetPackage.id,
      name: widgetPackage.name,
      version: widgetPackage.version,
      entry: widgetPackage.entry,
      defaultTitle: widgetPackage.defaultTitle,
      defaultSize: {
        w: widgetPackage.defaultSize.w,
        h: widgetPackage.defaultSize.h,
      },
      permissions: {
        network: widgetPackage.permissions.network,
        openExternal: widgetPackage.permissions.openExternal,
      },
      ...(widgetPackage.description ? { description: widgetPackage.description } : {}),
      rootPath: widgetPackage.rootPath,
      source: `widget://package/${widgetPackage.id}`,
    };
  }

  function buildWidgetPackageSourcePayload(widgetPackageSource: WidgetPackageSource) {
    return {
      package: buildWidgetPackageSummaryPayload(widgetPackageSource.package),
      manifest: widgetPackageSource.manifest,
      files: widgetPackageSource.files.map((file) => ({
        path: file.path,
        content: file.content,
      })),
    };
  }

  function normalizeWidgetPackageToolFilePath(value: unknown) {
    const rawPath = readString(value);
    if (!rawPath) {
      return null;
    }

    const normalized = rawPath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalized) {
      return null;
    }

    const parts: string[] = [];
    for (const part of normalized.split("/")) {
      const segment = part.trim();
      if (!segment || segment === ".") {
        continue;
      }
      if (segment === "..") {
        return null;
      }
      parts.push(segment);
    }
    return parts.length > 0 ? parts.join("/") : null;
  }

  function readWidgetPackageToolFilePaths(value: unknown) {
    return readStringArray(value).map((entry) => {
      const path = normalizeWidgetPackageToolFilePath(entry);
      if (!path) {
        throw new Error(`Widget file path "${entry}" is invalid.`);
      }
      return path;
    });
  }

  function getWidgetPackageSourceForTool(packageId: unknown, toolName: string) {
    const normalizedPackageId = readString(packageId);
    if (!normalizedPackageId) {
      throw new Error(`${toolName} requires a non-empty packageId.`);
    }

    const widgetPackageSource = options.getWidgetPackageSource!(normalizedPackageId);
    if (!widgetPackageSource) {
      throw new Error(`Widget package "${normalizedPackageId}" was not found.`);
    }
    return widgetPackageSource;
  }

  function buildWidgetManifestFileRecord(widgetPackageSource: WidgetPackageSource) {
    return {
      path: "widget.json",
      content: `${JSON.stringify(widgetPackageSource.manifest, null, 2)}\n`,
    } satisfies WidgetPackageFileRecord;
  }

  function listWidgetPackageToolFiles(widgetPackageSource: WidgetPackageSource) {
    return [
      buildWidgetManifestFileRecord(widgetPackageSource),
      ...widgetPackageSource.files,
    ];
  }

  function buildWidgetPackageFileMetadata(file: WidgetPackageFileRecord) {
    return {
      path: file.path,
      charCount: file.content.length,
      lineCount: file.content ? file.content.split(/\r\n|\r|\n/).length : 0,
    };
  }

  function findWidgetPackageToolFiles(
    widgetPackageSource: WidgetPackageSource,
    requestedPaths: string[],
  ) {
    const filesByPath = new Map(
      listWidgetPackageToolFiles(widgetPackageSource).map((file) => [file.path, file]),
    );
    if (requestedPaths.length === 0) {
      return {
        files: Array.from(filesByPath.values()),
        missingPaths: [],
      };
    }

    const files: WidgetPackageFileRecord[] = [];
    const missingPaths: string[] = [];
    for (const requestedPath of requestedPaths) {
      const file = filesByPath.get(requestedPath);
      if (file) {
        files.push(file);
      } else {
        missingPaths.push(requestedPath);
      }
    }
    return { files, missingPaths };
  }

  function getWidgetPackageSourcePosition(content: string, index: number) {
    const prefix = content.slice(0, Math.max(0, index));
    const lines = prefix.split(/\r\n|\r|\n/);
    return {
      line: lines.length,
      column: (lines[lines.length - 1] ?? "").length + 1,
    };
  }

  function findWidgetPackageMatchingCharacter(
    source: string,
    startIndex: number,
    openCharacter: string,
    closeCharacter: string,
  ) {
    let depth = 0;
    let quote: "\"" | "'" | "`" | null = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;

    for (let index = startIndex; index < source.length; index += 1) {
      const character = source[index] ?? "";
      const nextCharacter = source[index + 1] ?? "";

      if (lineComment) {
        if (character === "\n" || character === "\r") {
          lineComment = false;
        }
        continue;
      }

      if (blockComment) {
        if (character === "*" && nextCharacter === "/") {
          blockComment = false;
          index += 1;
        }
        continue;
      }

      if (quote) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (character === "\\") {
          escaped = true;
          continue;
        }
        if (character === quote) {
          quote = null;
        }
        continue;
      }

      if (character === "/" && nextCharacter === "/") {
        lineComment = true;
        index += 1;
        continue;
      }
      if (character === "/" && nextCharacter === "*") {
        blockComment = true;
        index += 1;
        continue;
      }
      if (character === "\"" || character === "'" || character === "`") {
        quote = character as "\"" | "'" | "`";
        continue;
      }

      if (character === openCharacter) {
        depth += 1;
        continue;
      }
      if (character === closeCharacter) {
        depth -= 1;
        if (depth === 0) {
          return index;
        }
      }
    }

    return -1;
  }

  function findWidgetBrowserObjectCalls(content: string, methodName: string) {
    const calls: Array<{
      body: string;
      index: number;
    }> = [];
    const callPattern = new RegExp(`(?:window\\.)?milo\\.browser\\.${methodName}\\s*\\(`, "g");
    let match: RegExpExecArray | null;
    while ((match = callPattern.exec(content)) !== null) {
      const callStartIndex = match.index;
      let cursor = callPattern.lastIndex;
      while (cursor < content.length && /\s/.test(content[cursor] ?? "")) {
        cursor += 1;
      }
      if (content[cursor] !== "{") {
        continue;
      }

      const closeIndex = findWidgetPackageMatchingCharacter(content, cursor, "{", "}");
      if (closeIndex === -1) {
        continue;
      }

      calls.push({
        body: content.slice(cursor + 1, closeIndex),
        index: callStartIndex,
      });
    }
    return calls;
  }

  function stripWidgetPackageStringAndCommentContent(source: string) {
    let output = "";
    let quote: "\"" | "'" | "`" | null = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;

    const mask = (character: string) => (character === "\n" || character === "\r" ? character : " ");

    for (let index = 0; index < source.length; index += 1) {
      const character = source[index] ?? "";
      const nextCharacter = source[index + 1] ?? "";

      if (lineComment) {
        output += mask(character);
        if (character === "\n" || character === "\r") {
          lineComment = false;
        }
        continue;
      }

      if (blockComment) {
        output += mask(character);
        if (character === "*" && nextCharacter === "/") {
          output += " ";
          blockComment = false;
          index += 1;
        }
        continue;
      }

      if (quote) {
        output += mask(character);
        if (escaped) {
          escaped = false;
          continue;
        }
        if (character === "\\") {
          escaped = true;
          continue;
        }
        if (character === quote) {
          quote = null;
        }
        continue;
      }

      if (character === "/" && nextCharacter === "/") {
        output += "  ";
        lineComment = true;
        index += 1;
        continue;
      }
      if (character === "/" && nextCharacter === "*") {
        output += "  ";
        blockComment = true;
        index += 1;
        continue;
      }
      if (character === "\"" || character === "'" || character === "`") {
        output += " ";
        quote = character as "\"" | "'" | "`";
        continue;
      }

      output += character;
    }

    return output;
  }

  function hasWidgetTopLevelObjectProperty(objectBody: string, propertyName: string) {
    const body = stripWidgetPackageStringAndCommentContent(objectBody);
    let depth = 0;

    for (let index = 0; index < body.length; index += 1) {
      const character = body[index] ?? "";
      if (character === "{" || character === "[" || character === "(") {
        depth += 1;
        continue;
      }
      if (character === "}" || character === "]" || character === ")") {
        depth = Math.max(0, depth - 1);
        continue;
      }
      if (depth !== 0 || !body.startsWith(propertyName, index)) {
        continue;
      }

      const before = index > 0 ? body[index - 1] ?? "" : "";
      const after = body[index + propertyName.length] ?? "";
      if (/[$\w]/.test(before) || /[$\w]/.test(after)) {
        continue;
      }

      let cursor = index + propertyName.length;
      while (cursor < body.length && /\s/.test(body[cursor] ?? "")) {
        cursor += 1;
      }
      if (body[cursor] === ":") {
        return true;
      }
    }

    return false;
  }

  function validateWidgetPackageAutomationUsage(files: WidgetPackageFileRecord[]) {
    const findings: Array<{
      code: string;
      column: number;
      line: number;
      message: string;
      path: string;
      severity: "error" | "warning";
    }> = [];

    const addFinding = (
      file: WidgetPackageFileRecord,
      index: number,
      severity: "error" | "warning",
      code: string,
      message: string,
    ) => {
      if (findings.length >= WIDGET_PACKAGE_VALIDATION_MAX_FINDINGS) {
        return;
      }
      const position = getWidgetPackageSourcePosition(file.content, index);
      findings.push({
        path: file.path,
        line: position.line,
        column: position.column,
        severity,
        code,
        message,
      });
    };

    for (const file of files) {
      if (!/\.(?:html|js|mjs|cjs|ts|tsx)$/i.test(file.path)) {
        continue;
      }

      const browserCallPattern = /(?:window\.)?milo\.browser\.call\s*\(\s*(['"])([^'"]+)\1/g;
      let browserCallMatch: RegExpExecArray | null;
      while ((browserCallMatch = browserCallPattern.exec(file.content)) !== null) {
        const toolName = browserCallMatch[2] ?? "";
        if (!WIDGET_AUTOMATION_ALLOWED_BROWSER_CALL_TOOLS.has(toolName)) {
          addFinding(
            file,
            browserCallMatch.index,
            "error",
            "unsupported-browser-call-tool",
            `window.milo.browser.call("${toolName}") is not allowed in start page widgets. Use one of the documented helpers or allowed tools only.`,
          );
        }
      }

      for (const call of findWidgetBrowserObjectCalls(file.content, "extractData")) {
        if (hasWidgetTopLevelObjectProperty(call.body, "page")) {
          addFinding(
            file,
            call.index,
            "error",
            "extract-data-page-ref",
            "milo.browser.extractData maps to browser.extract_data and requires { session, script } or { session, extraction }. It does not accept page.",
          );
        }
        if (hasWidgetTopLevelObjectProperty(call.body, "task")) {
          addFinding(
            file,
            call.index,
            "error",
            "extract-data-task",
            "milo.browser.extractData is not a natural-language task extractor. Do not pass task; use milo.browser.extract({ page, mode }) or extractData({ session, script }).",
          );
        }
        if (hasWidgetTopLevelObjectProperty(call.body, "mode")) {
          addFinding(
            file,
            call.index,
            "error",
            "extract-data-mode",
            "mode belongs to milo.browser.extract, not milo.browser.extractData. extractData accepts script or extraction.",
          );
        }
        if (!hasWidgetTopLevelObjectProperty(call.body, "session")) {
          addFinding(
            file,
            call.index,
            "error",
            "extract-data-missing-session",
            "milo.browser.extractData requires a session object, usually { sessionId: opened.page.sessionId, tabId: opened.page.tabId } after milo.browser.open.",
          );
        }
        if (!hasWidgetTopLevelObjectProperty(call.body, "script")
          && !hasWidgetTopLevelObjectProperty(call.body, "extraction")) {
          addFinding(
            file,
            call.index,
            "error",
            "extract-data-missing-mode",
            "milo.browser.extractData requires either script or extraction. It does not accept prompt/task/mode.",
          );
        }
      }

      for (const call of findWidgetBrowserObjectCalls(file.content, "extract")) {
        if (hasWidgetTopLevelObjectProperty(call.body, "task")) {
          addFinding(
            file,
            call.index,
            "error",
            "page-extract-task",
            "milo.browser.extract maps to page.extract and does not accept task. Use page.snapshot for task-prioritized summaries, or extract({ page, mode }).",
          );
        }
      }

      for (const call of findWidgetBrowserObjectCalls(file.content, "navigate")) {
        if (!hasWidgetTopLevelObjectProperty(call.body, "session")) {
          addFinding(
            file,
            call.index,
            "error",
            "navigate-missing-session",
            "milo.browser.navigate maps to browser.navigate and requires { session, url }. To open a URL first, use milo.browser.open({ url }).",
          );
        }
      }
    }

    return {
      errors: findings.filter((finding) => finding.severity === "error"),
      findings,
      ok: findings.every((finding) => finding.severity !== "error"),
    };
  }

  function formatWidgetPackageValidationErrors(validation: ReturnType<typeof validateWidgetPackageAutomationUsage>) {
    return validation.errors.slice(0, WIDGET_PACKAGE_VALIDATION_MAX_FINDINGS).map((finding) =>
      `${finding.path}:${finding.line}:${finding.column} [${finding.code}] ${finding.message}`,
    ).join("\n");
  }

  function readWidgetPackageReplacementInputs(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.map((entry) => {
      if (!isRecord(entry)) {
        throw new Error("Widget replacement edits must be objects.");
      }
      const path = normalizeWidgetPackageToolFilePath(entry.path);
      if (!path || path === "widget.json") {
        throw new Error(`Widget replacement path "${String(entry.path)}" is invalid.`);
      }
      if (typeof entry.oldText !== "string" || entry.oldText.length === 0) {
        throw new Error(`Widget replacement for "${path}" requires a non-empty oldText.`);
      }
      if (typeof entry.newText !== "string") {
        throw new Error(`Widget replacement for "${path}" requires newText.`);
      }
      return {
        path,
        oldText: entry.oldText,
        newText: entry.newText,
        replaceAll: readBoolean(entry.replaceAll) === true,
      };
    });
  }

  function buildStartPageWidgetPayload(widget: StartPageWidgetsState["items"][number]) {
    return {
      id: widget.id,
      type: widget.type,
      title: widget.title,
      grid: {
        x: widget.gridX,
        y: widget.gridY,
        w: widget.gridW,
        h: widget.gridH,
      },
      ...(widget.type === "protocol" ? { source: widget.source } : {}),
      ...(widget.type === "embed" ? { url: widget.url } : {}),
      ...(widget.type === "notes" ? { content: widget.content } : {}),
    };
  }

  function readStartPageWidgetDocs() {
    const docsPath = join(process.cwd(), "docs", "start-page-widgets.md");
    try {
      if (existsSync(docsPath)) {
        const content = readFileSync(docsPath, "utf-8");
        if (content.trim()) {
          return {
            content,
            path: docsPath,
            source: "file",
          };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          "# Start Page Widgets",
          "",
          "Package widgets receive window.milo automatically.",
          "Use milo.widget.ready(), milo.widget.onRefresh(handler), and milo.browser.open/snapshot/extract/extractRecords/extractData/interact/navigate/context.",
          "milo.browser.extract({ page, mode }) maps to page.extract. milo.browser.extractData({ session, script }) maps to browser.extract_data. Do not pass page, task, or mode to extractData.",
          "After milo.browser.open({ url }), use opened.page for page helpers; derive { sessionId: opened.page.sessionId, tabId: opened.page.tabId } for session helpers.",
          "Do not call milo.browser.call('close', ...); widget automation owns a hidden bound tab and only allowlisted browser tools are available.",
          "Use widget://package/<id>?refresh=<interval> to let Milo's main-process cron trigger send host:refresh. Do not create saved data-source objects.",
          "Dev widgets can load <script src=\"milo://widget-api/client.js\"></script>.",
        ].join("\n"),
        path: docsPath,
        source: "fallback",
        warning: message,
      };
    }

    return {
      content: [
        "# Start Page Widgets",
        "",
        "Package widgets receive window.milo automatically.",
        "Use milo.widget.ready(), milo.widget.onRefresh(handler), and milo.browser.open/snapshot/extract/extractRecords/extractData/interact/navigate/context.",
        "milo.browser.extract({ page, mode }) maps to page.extract. milo.browser.extractData({ session, script }) maps to browser.extract_data. Do not pass page, task, or mode to extractData.",
        "After milo.browser.open({ url }), use opened.page for page helpers; derive { sessionId: opened.page.sessionId, tabId: opened.page.tabId } for session helpers.",
        "Do not call milo.browser.call('close', ...); widget automation owns a hidden bound tab and only allowlisted browser tools are available.",
        "Use widget://package/<id>?refresh=<interval> to let Milo's main-process cron trigger send host:refresh. Do not create saved data-source objects.",
        "Dev widgets can load <script src=\"milo://widget-api/client.js\"></script>.",
      ].join("\n"),
      path: docsPath,
      source: "fallback",
    };
  }

  function readWidgetPackageManifestInput(value: unknown): WidgetPackageManifest | null {
    if (!isRecord(value)) {
      return null;
    }

    const id = readString(value.id);
    const name = readString(value.name);
    const version = readString(value.version);
    const entry = readString(value.entry);
    if (!id || !name || !version || !entry) {
      return null;
    }

    return {
      id,
      name,
      version,
      entry,
      ...(readString(value.description) ? { description: readString(value.description)! } : {}),
      ...(readString(value.defaultTitle) ? { defaultTitle: readString(value.defaultTitle)! } : {}),
      ...(isRecord(value.defaultSize)
        ? {
            defaultSize: {
              ...(readNumber(value.defaultSize.w) !== undefined ? { w: readNumber(value.defaultSize.w) } : {}),
              ...(readNumber(value.defaultSize.h) !== undefined ? { h: readNumber(value.defaultSize.h) } : {}),
            },
          }
        : {}),
      ...(isRecord(value.permissions)
        ? {
            permissions: {
              ...(readBoolean(value.permissions.network) !== undefined
                ? { network: readBoolean(value.permissions.network) }
                : {}),
              ...(readBoolean(value.permissions.openExternal) !== undefined
                ? { openExternal: readBoolean(value.permissions.openExternal) }
                : {}),
            },
          }
        : {}),
    };
  }

  function readWidgetPackageFileInputs(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.flatMap((entry) => {
      if (!isRecord(entry)) {
        return [];
      }

      const filePath = readString(entry.path);
      if (!filePath || typeof entry.content !== "string") {
        return [];
      }

      return [{
        path: filePath,
        content: entry.content,
      } satisfies WidgetPackageFileRecord];
    });
  }

  function buildWidgetBuilderBrowserAgentSystemPrompt() {
    return [
      `${WIDGET_BUILDER_PROFILE_SYSTEM_PREFIX}`,
      "You are Milo's start page widget builder agent.",
      `Your job is to turn the user's request into a local Milo widget package that can be added with widget://package/<id>.`,
      `Read the current widget authoring docs with ${START_PAGE_WIDGET_DOCS_READ_TOOL_NAME} before creating or updating package files, especially when the widget uses refresh scheduling or browser automation.`,
      `Start with ${START_PAGE_WIDGETS_LIST_TOOL_NAME} before creating a new package unless the user already gave an exact package id to update.`,
      `Use ${START_PAGE_CURRENT_WIDGETS_LIST_TOOL_NAME} when you need to know which widgets are currently on the user's start page, including before deciding whether to add another widget or explaining the current layout.`,
      `If the user wants to update or fix an existing widget package, inspect the existing package first. Use ${START_PAGE_WIDGET_PACKAGE_FILES_LIST_TOOL_NAME}, ${START_PAGE_WIDGET_PACKAGE_FILES_SEARCH_TOOL_NAME}, and ${START_PAGE_WIDGET_PACKAGE_FILES_READ_TOOL_NAME} to find the relevant files instead of recreating the package.`,
      `Create self-contained local widget packages with HTML/CSS/JS and a valid widget manifest.`,
      `Prefer a simple package layout with index.html, widget.css, and widget.js unless the task clearly needs more files.`,
      "Choose manifest.defaultSize intentionally based on the widget's information density and intended layout. Milo uses manifest.defaultSize as the initial grid size when a widget://package/<id> widget is added to the start page.",
      "Do not include widget.json inside files when saving; pass it through the manifest field instead.",
      `Use ${START_PAGE_WIDGET_PACKAGE_SAVE_TOOL_NAME} to create or update the package once the files are ready.`,
      `For targeted updates, prefer ${START_PAGE_WIDGET_PACKAGE_FILES_EDIT_TOOL_NAME} with exact replacements or file writes. Only use replace=true in ${START_PAGE_WIDGET_PACKAGE_SAVE_TOOL_NAME} when doing an intentional clean rewrite with the full package contents.`,
      "For live webpage data, build the widget so its JS calls window.milo.browser.* APIs during milo.widget.onRefresh callbacks. The start page refresh query parameter is the scheduler; browser automation belongs to the widget code.",
      "Do not invent window.milo browser API schemas. milo.browser.extract({ page, mode: 'text' | 'records' | 'images' | 'auto' }) is the page/mode extractor. milo.browser.extractData(...) maps to browser.extract_data and only accepts { session, script } or { session, extraction: { type: 'records', ... } }.",
      "After milo.browser.open({ url }), use opened.page for page.* helpers. For session.* helpers, derive { sessionId: opened.page.sessionId, tabId: opened.page.tabId } from opened.page.",
      "Never pass page, task, or mode to milo.browser.extractData. Never call milo.browser.call('close', ...); start page widgets only allow the documented browser automation tools and the host manages the hidden automation tab lifecycle.",
      `If the user wants the widget placed on the Milo start page right away, call ${START_PAGE_WIDGET_ADD_TOOL_NAME} after saving the package, using the final widget:// source from the save result.`,
      "Package widgets receive window.milo automatically. Use milo.widget.ready(), milo.widget.onRefresh(handler), and milo.browser.open/snapshot/extract/extractRecords/extractData/interact/navigate/context.",
      "Avoid direct widget network access for webpage scraping. Use the Milo browser API so automation runs through the user's browser profile and the system scheduler triggers refresh work.",
      "If a package save/edit validation error is returned, fix the existing package files with the file read/search/edit tools and save again before reporting success.",
      "When requirements are ambiguous, ask a short focused follow-up before creating files.",
      "After saving the package, tell the user the final widget source and the package id that was created or updated.",
      "Respond in the user's language unless they explicitly switch languages.",
    ].join("\n");
  }

  function normalizeOrganizerSortStrategy(value: unknown): OrganizerSortStrategy {
    return value === "domain" || value === "url" ? value : "title";
  }

  function normalizeOrganizerSortDirection(value: unknown): OrganizerSortDirection {
    return value === "desc" ? "desc" : "asc";
  }

  function getOrganizerTargetContext(session: AgentSessionState) {
    const workspaceId = session.originWorkspaceId;
    const windowId = session.originWindowId;
    if (!options.isWindowOpen(windowId)) {
      throw new Error("The source browser window for this organizer task is no longer open.");
    }

    const windowContext = options.getWindowContext(windowId);
    const sidebarState = options.getSidebarOrganizationState
      ? options.getSidebarOrganizationState({ windowId, workspaceId })
      : createDefaultOrganizerSidebarState(windowContext.tabs, windowContext.activeTabId);
    const profileId = options.getProfileIdForWorkspace?.(workspaceId) ?? workspaceId;

    return {
      windowId,
      workspaceId,
      profileId,
      windowContext,
      sidebarState: cloneOrganizerSidebarState(sidebarState),
    };
  }

  function resolveStartPageTargetContext(session: AgentSessionState) {
    const windowId = session.originWindowId;
    if (!options.isWindowOpen(windowId)) {
      throw new Error("The source browser window for this task is no longer open.");
    }

    const startPageUrl = options.getStartPageUrl();
    let startPageProtocol = "";
    let startPageHost = "";
    try {
      const parsedStartPageUrl = new URL(startPageUrl);
      startPageProtocol = parsedStartPageUrl.protocol;
      startPageHost = parsedStartPageUrl.hostname;
    } catch {
      startPageProtocol = "";
      startPageHost = "";
    }

    const matchesStartPageUrl = (url: string) => {
      if (!url) {
        return false;
      }

      try {
        const parsedUrl = new URL(url);
        return Boolean(startPageProtocol)
          && Boolean(startPageHost)
          && parsedUrl.protocol === startPageProtocol
          && parsedUrl.hostname === startPageHost;
      } catch {
        return url === startPageUrl;
      }
    };

    const windowContext = options.getWindowContext(windowId);
    const activeStartPageTab = windowContext.activeTabId
      ? windowContext.tabs.find((tab) => tab.id === windowContext.activeTabId && matchesStartPageUrl(tab.url))
      : undefined;
    const targetTab = activeStartPageTab ?? windowContext.tabs.find((tab) => matchesStartPageUrl(tab.url));
    if (!targetTab) {
      throw new Error("No Milo start page tab is open in the source browser window.");
    }

    const targetContents = options.getTabWebContents(targetTab.id);
    if (!targetContents || targetContents.isDestroyed()) {
      throw new Error("The Milo start page tab is unavailable.");
    }

    return {
      windowId,
      startPageUrl,
      tabId: targetTab.id,
      targetContents,
    };
  }

  function getBookmarkFolderPathLabel(
    folderId: string | null | undefined,
    folderById: Map<string, BookmarkFolderRecord>,
  ) {
    if (!folderId) {
      return "Root";
    }

    const names: string[] = [];
    let cursor = folderById.get(folderId) ?? null;
    let guard = 0;
    while (cursor && guard < 64) {
      names.unshift(cursor.name);
      cursor = cursor.parentId ? folderById.get(cursor.parentId) ?? null : null;
      guard += 1;
    }
    return names.length > 0 ? names.join(" / ") : "Root";
  }

  function getDomainLabel(value: string) {
    try {
      return new URL(value).hostname.replace(/^www\./i, "").trim().toLowerCase() || "other";
    } catch {
      return "other";
    }
  }

  function collectDescendantBookmarkFolderIds(
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

  function resolveBookmarkFolderScope(
    input: Record<string, unknown>,
    folders: BookmarkFolderRecord[],
  ) {
    const folderById = new Map(folders.map((folder) => [folder.id, folder]));
    const folderId = readString(input.folderId);
    if (folderId) {
      const folder = folderById.get(folderId);
      if (!folder) {
        throw new Error(`Bookmark folder ${folderId} was not found.`);
      }
      return {
        folderId,
        label: getBookmarkFolderPathLabel(folderId, folderById),
      };
    }

    const folderPath = readString(input.folderPath);
    const folderName = readString(input.folderName);
    const requestedLabel = folderPath ?? folderName;
    if (!requestedLabel) {
      return {
        folderId: null,
        label: "All bookmarks",
      };
    }

    const normalizedRequestedLabel = requestedLabel.toLowerCase();
    const matches = folders.filter((folder) => {
      const path = getBookmarkFolderPathLabel(folder.id, folderById).toLowerCase();
      const name = folder.name.trim().toLowerCase();
      return folderPath ? path === normalizedRequestedLabel : name === normalizedRequestedLabel;
    });

    if (matches.length === 0) {
      throw new Error(`Bookmark folder "${requestedLabel}" was not found.`);
    }
    if (matches.length > 1) {
      throw new Error(`Bookmark folder "${requestedLabel}" is ambiguous. Provide folderId or folderPath.`);
    }

    const match = matches[0]!;
    return {
      folderId: match.id,
      label: getBookmarkFolderPathLabel(match.id, folderById),
    };
  }

  function buildBookmarkOrganizerSnapshot(
    profileId: string,
    scopeFolderId: string | null,
    limit = 1000,
  ) {
    const folders = options.getBookmarkFolders?.(profileId) ?? [];
    const bookmarks = options.getBookmarks?.(profileId) ?? [];
    const folderById = new Map(folders.map((folder) => [folder.id, folder]));
    const scopedFolderIds = scopeFolderId
      ? collectDescendantBookmarkFolderIds(folders, scopeFolderId)
      : new Set(folders.map((folder) => folder.id));
    const scopedFolders = folders.filter((folder) => scopedFolderIds.has(folder.id));
    const scopedBookmarks = bookmarks.filter((bookmark) =>
      scopeFolderId
        ? Boolean(bookmark.folderId && scopedFolderIds.has(bookmark.folderId))
        : true);
    const sortedFolders = scopedFolders
      .slice()
      .sort((left, right) =>
        getBookmarkFolderPathLabel(left.id, folderById).localeCompare(getBookmarkFolderPathLabel(right.id, folderById)));
    const sortedBookmarks = scopedBookmarks
      .slice()
      .sort((left, right) => {
        const leftLabel = `${getBookmarkFolderPathLabel(left.folderId, folderById)} ${left.title} ${left.url}`.toLowerCase();
        const rightLabel = `${getBookmarkFolderPathLabel(right.folderId, folderById)} ${right.title} ${right.url}`.toLowerCase();
        return leftLabel.localeCompare(rightLabel);
      });

    return {
      profileId,
      scope: {
        folderId: scopeFolderId,
        folderPath: scopeFolderId ? getBookmarkFolderPathLabel(scopeFolderId, folderById) : null,
        includesAllBookmarks: scopeFolderId === null,
      },
      totalBookmarkCount: bookmarks.length,
      totalFolderCount: folders.length,
      scopedBookmarkCount: scopedBookmarks.length,
      scopedFolderCount: scopedFolders.length,
      folders: sortedFolders.slice(0, limit).map((folder) => ({
        folderId: folder.id,
        name: folder.name,
        parentId: folder.parentId ?? null,
        path: getBookmarkFolderPathLabel(folder.id, folderById),
        createdAt: folder.createdAt,
      })),
      bookmarks: sortedBookmarks.slice(0, limit).map((bookmark) => ({
        bookmarkId: bookmark.id,
        title: bookmark.title,
        url: bookmark.url,
        domain: getDomainLabel(bookmark.url),
        folderId: bookmark.folderId ?? null,
        folderPath: getBookmarkFolderPathLabel(bookmark.folderId, folderById),
        createdAt: bookmark.createdAt,
      })),
      truncated: sortedFolders.length > limit || sortedBookmarks.length > limit,
    };
  }

  function buildTabOrganizationPayload(input: {
    windowId: number;
    workspaceId: string;
    windowContext: BrowserWindowContext;
    sidebarState?: OrganizerSidebarState;
    sourceTabRefForTabId?: (tabId: string) => string | undefined;
  }) {
    const sidebarState = input.sidebarState
      ?? (options.getSidebarOrganizationState
        ? options.getSidebarOrganizationState({
            windowId: input.windowId,
            workspaceId: input.workspaceId,
          })
        : createDefaultOrganizerSidebarState(input.windowContext.tabs, input.windowContext.activeTabId));
    const tabsById = new Map(input.windowContext.tabs.map((tab) => [tab.id, tab]));
    const buildTabIdentity = (tab: BrowserWindowContext["tabs"][number]) => input.sourceTabRefForTabId
      ? { sourceTabRef: input.sourceTabRefForTabId(tab.id) ?? null }
      : { tabId: tab.id };
    const groups = Object.values(sidebarState.folders).map((folder) => ({
      folderId: folder.id,
      title: folder.title,
      ...(folder.icon ? { icon: folder.icon } : {}),
      ...(folder.backgroundColor ? { backgroundColor: folder.backgroundColor } : {}),
      isExpanded: folder.isExpanded,
      tabCount: folder.tabIds.length,
      tabs: folder.tabIds
        .map((tabId) => tabsById.get(tabId))
        .filter((tab): tab is BrowserWindowContext["tabs"][number] => tab !== undefined)
        .map((tab) => ({
          ...buildTabIdentity(tab),
          title: tab.title,
          url: tab.url,
          displayUrl: tab.displayUrl,
          isActive: Boolean(tab.isActive),
        })),
    }));

    const rootTabs = sidebarState.entries
      .filter((entry): entry is Extract<OrganizerSidebarState["entries"][number], { kind: "tab" }> => entry.kind === "tab")
      .map((entry) => tabsById.get(entry.tabId))
      .filter((tab): tab is BrowserWindowContext["tabs"][number] => tab !== undefined)
      .map((tab) => ({
        ...buildTabIdentity(tab),
        title: tab.title,
        url: tab.url,
        displayUrl: tab.displayUrl,
        isActive: Boolean(tab.isActive),
      }));

    const splits = Object.values(sidebarState.splits).map((split) => ({
      splitId: split.id,
      mode: split.mode,
      tabCount: split.tabIds.length,
      ...(input.sourceTabRefForTabId
        ? { focusedSourceTabRef: input.sourceTabRefForTabId(split.focusedTabId) ?? null }
        : { focusedTabId: split.focusedTabId }),
      syncScroll: split.syncScroll,
      tabs: split.tabIds
        .map((tabId) => tabsById.get(tabId))
        .filter((tab): tab is BrowserWindowContext["tabs"][number] => tab !== undefined)
        .map((tab) => ({
          ...buildTabIdentity(tab),
          title: tab.title,
          url: tab.url,
          displayUrl: tab.displayUrl,
          isActive: Boolean(tab.isActive),
        })),
    }));

    const groupedTabIds = new Set(Object.values(sidebarState.folders).flatMap((folder) => folder.tabIds));
    const splitTabIds = collectOrganizerSplitTabIds(sidebarState);
    const totalTabCount = input.windowContext.tabs.length;

    return {
      windowId: input.windowId,
      workspaceId: input.workspaceId,
      ...(input.sourceTabRefForTabId
        ? {
            activeSourceTabRef: input.windowContext.activeTabId
              ? input.sourceTabRefForTabId(input.windowContext.activeTabId) ?? null
              : null,
          }
        : {
            activeTabId: input.windowContext.activeTabId ?? null,
          }),
      totalTabCount,
      rootTabCount: rootTabs.length,
      groupCount: groups.length,
      splitCount: splits.length,
      groupedTabCount: groupedTabIds.size,
      splitTabCount: splitTabIds.size,
      rootTabs,
      groups,
      splits,
    };
  }

  function buildOrganizerTabsPayload(
    target: ReturnType<typeof getOrganizerTargetContext>,
  ) {
    return buildTabOrganizationPayload(target);
  }

  function buildOrganizerBookmarksPayload(
    profileId: string,
    limit = 120,
  ) {
    const folders = options.getBookmarkFolders?.(profileId) ?? [];
    const bookmarks = options.getBookmarks?.(profileId) ?? [];
    const folderById = new Map(folders.map((folder) => [folder.id, folder]));
    const items = bookmarks
      .slice()
      .sort((left, right) => {
        const leftLabel = `${getBookmarkFolderPathLabel(left.folderId, folderById)} ${left.title} ${left.url}`.toLowerCase();
        const rightLabel = `${getBookmarkFolderPathLabel(right.folderId, folderById)} ${right.title} ${right.url}`.toLowerCase();
        return leftLabel.localeCompare(rightLabel);
      })
      .slice(0, limit)
      .map((bookmark) => ({
        bookmarkId: bookmark.id,
        title: bookmark.title,
        url: bookmark.url,
        domain: getDomainLabel(bookmark.url),
        folderId: bookmark.folderId ?? null,
        folderPath: getBookmarkFolderPathLabel(bookmark.folderId, folderById),
        createdAt: bookmark.createdAt,
      }));

    return {
      profileId,
      totalBookmarkCount: bookmarks.length,
      rootBookmarkCount: bookmarks.filter((bookmark) => !bookmark.folderId).length,
      folderCount: folders.length,
      folders: folders
        .slice()
        .sort((left, right) =>
          getBookmarkFolderPathLabel(left.id, folderById).localeCompare(getBookmarkFolderPathLabel(right.id, folderById)))
        .slice(0, limit)
        .map((folder) => ({
          folderId: folder.id,
          name: folder.name,
          parentId: folder.parentId ?? null,
          path: getBookmarkFolderPathLabel(folder.id, folderById),
          createdAt: folder.createdAt,
        })),
      items,
      itemsTruncated: bookmarks.length > limit,
    };
  }

  function buildOrganizerDownloadsPayload(limit = 120) {
    const records = (options.getDownloads?.() ?? [])
      .slice()
      .sort((left, right) => right.createdAt - left.createdAt);
    const statusCounts: Record<string, number> = {};
    for (const record of records) {
      statusCounts[record.status] = (statusCounts[record.status] ?? 0) + 1;
    }

    return {
      totalDownloadCount: records.length,
      statusCounts,
      items: records.slice(0, limit).map((record) => ({
        downloadId: record.id,
        filename: record.filename,
        status: record.status,
        source: record.source,
        url: record.finalUrl || record.url,
        directory: record.directory,
        receivedBytes: record.receivedBytes,
        totalBytes: record.totalBytes,
        fileExists: record.fileExists,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        completedAt: record.completedAt ?? null,
        error: record.error ?? null,
      })),
      itemsTruncated: records.length > limit,
    };
  }

  function buildHistorySearchPayload(input: Record<string, unknown>, session: AgentSessionState) {
    const profileId = options.getProfileIdForWorkspace?.(session.originWorkspaceId) ?? session.originWorkspaceId;
    const query = readString(input.query)?.toLowerCase();
    const limitValue = readNumber(input.limit);
    const normalizedLimit = limitValue !== undefined
      ? Math.max(1, Math.min(300, Math.floor(limitValue)))
      : 120;
    const sinceDaysValue = readNumber(input.sinceDays);
    const sinceTimestamp = sinceDaysValue !== undefined
      ? Date.now() - Math.max(0, sinceDaysValue) * 24 * 60 * 60 * 1000
      : undefined;
    const includeMetadata = input.includeMetadata !== false;
    const queryTokens = query?.split(/\s+/).filter(Boolean) ?? [];
    const records = (options.getHistoryRecords?.(profileId) ?? [])
      .slice()
      .sort((left, right) => {
        if (right.lastVisitedAt !== left.lastVisitedAt) {
          return right.lastVisitedAt - left.lastVisitedAt;
        }
        return right.updatedAt - left.updatedAt;
      });

    const matchesQuery = (record: HistoryRecord) => {
      if (!query) {
        return true;
      }

      const openedFrom = record.metadata?.openedFrom ?? [];
      const searchable = [
        record.title,
        record.url,
        getDomainLabel(record.url),
        ...openedFrom.flatMap((source) => [
          source.title ?? "",
          source.url,
          source.lastTargetUrl ?? "",
          getDomainLabel(source.url),
        ]),
      ].join(" ").toLowerCase();

      return queryTokens.length > 1
        ? queryTokens.every((token) => searchable.includes(token))
        : searchable.includes(query);
    };

    const matches = records.filter((record) =>
      matchesQuery(record)
      && (sinceTimestamp === undefined || record.lastVisitedAt >= sinceTimestamp));

    return {
      ok: true,
      profileId,
      query: query ?? null,
      totalHistoryCount: records.length,
      matchedCount: matches.length,
      itemsTruncated: matches.length > normalizedLimit,
      items: matches.slice(0, normalizedLimit).map((record) => ({
        historyId: record.id,
        title: record.title,
        url: record.url,
        domain: getDomainLabel(record.url),
        favicon: record.favicon ?? null,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        lastVisitedAt: record.lastVisitedAt,
        visitCount: record.visitCount,
        ...(includeMetadata
          ? {
              openedFrom: (record.metadata?.openedFrom ?? []).map((source) => ({
                url: source.url,
                title: source.title ?? null,
                domain: getDomainLabel(source.url),
                firstOpenedAt: source.firstOpenedAt,
                lastOpenedAt: source.lastOpenedAt,
                openCount: source.openCount,
                lastTargetUrl: source.lastTargetUrl ?? null,
              })),
            }
          : {}),
      })),
    };
  }

  function buildOrganizerSnapshot(input: Record<string, unknown>, session: AgentSessionState) {
    const target = getOrganizerTargetContext(session);
    const requestedScopes = new Set(readStringArray(input.scopes));
    const tabsRequested = requestedScopes.size === 0 || requestedScopes.has("tabs");
    if (requestedScopes.has("tabs") && session.agentId !== ORGANIZER_BROWSER_AGENT_ID) {
      throw new Error(`${ORGANIZER_SNAPSHOT_TOOL_NAME} tabs scope is only available in organizer sessions.`);
    }
    const includeTabs = session.agentId === ORGANIZER_BROWSER_AGENT_ID && tabsRequested;
    const includeBookmarks = requestedScopes.size === 0 || requestedScopes.has("bookmarks");
    const includeDownloads = requestedScopes.size === 0 || requestedScopes.has("downloads");
    const limitValue = readNumber(input.limit);
    const normalizedLimit = limitValue !== undefined
      ? Math.max(1, Math.min(400, Math.floor(limitValue)))
      : 120;

    return {
      ok: true,
      sourceWindowId: target.windowId,
      sourceWorkspaceId: target.workspaceId,
      profileId: target.profileId,
      ...(includeTabs ? { tabs: buildOrganizerTabsPayload(target) } : {}),
      ...(includeBookmarks ? { bookmarks: buildOrganizerBookmarksPayload(target.profileId, normalizedLimit) } : {}),
      ...(includeDownloads ? { downloads: buildOrganizerDownloadsPayload(normalizedLimit) } : {}),
    };
  }

  function applyOrganizerTabsState(
    session: AgentSessionState,
    nextState: OrganizerSidebarState,
  ) {
    if (!options.applySidebarOrganizationState) {
      throw new Error("Sidebar organization management is not available.");
    }
    return options.applySidebarOrganizationState({
      windowId: session.originWindowId,
      workspaceId: session.originWorkspaceId,
      state: nextState,
    });
  }

  function ensureTabsAreNotSplitLocked(
    state: OrganizerSidebarState,
    tabIds: string[],
  ) {
    const splitTabIds = collectOrganizerSplitTabIds(state);
    const lockedTabIds = tabIds.filter((tabId) => splitTabIds.has(tabId));
    if (lockedTabIds.length > 0) {
      throw new Error(
        `Tabs ${lockedTabIds.join(", ")} are currently part of a split view and cannot be regrouped until the split is separated.`,
      );
    }
  }

  function runOrganizerTabsTool(input: Record<string, unknown>, session: AgentSessionState) {
    if (session.agentId !== ORGANIZER_BROWSER_AGENT_ID) {
      throw new Error(`${ORGANIZER_TABS_TOOL_NAME} is only available in organizer sessions.`);
    }

    const action = readString(input.action);
    if (!action) {
      throw new Error(`${ORGANIZER_TABS_TOOL_NAME} requires a non-empty action.`);
    }

    const target = getOrganizerTargetContext(session);
    const nextStateBase = cloneOrganizerSidebarState(target.sidebarState);
    let nextState = nextStateBase;

    if (action === "sort_root_tabs") {
      nextState = sortOrganizerRootTabs(
        nextStateBase,
        target.windowContext.tabs,
        normalizeOrganizerSortStrategy(input.strategy),
        normalizeOrganizerSortDirection(input.direction),
      );
    } else if (action === "create_group") {
      const name = readString(input.name);
      const tabIds = readStringArray(input.tabIds);
      if (!name) {
        throw new Error(`${ORGANIZER_TABS_TOOL_NAME} create_group requires name.`);
      }
      if (tabIds.length < 2) {
        throw new Error(`${ORGANIZER_TABS_TOOL_NAME} create_group requires at least two tabIds.`);
      }
      ensureTabsAreNotSplitLocked(nextStateBase, tabIds);
      nextState = createOrganizerFolderGroup(nextStateBase, {
        folderId: randomUUID(),
        name,
        icon: readString(input.icon),
        backgroundColor: readString(input.backgroundColor),
        tabIds,
      });
    } else if (action === "group_root_tabs_by_domain") {
      nextState = groupOrganizerRootTabsByDomain(nextStateBase, target.windowContext.tabs, {
        createFolderId: () => randomUUID(),
        ...(readNumber(input.minGroupSize) !== undefined
          ? { minGroupSize: Math.max(2, Math.floor(readNumber(input.minGroupSize)!)) }
          : {}),
      });
    } else if (action === "move_tabs_to_group") {
      const folderId = readString(input.folderId);
      const tabIds = readStringArray(input.tabIds);
      if (!folderId) {
        throw new Error(`${ORGANIZER_TABS_TOOL_NAME} move_tabs_to_group requires folderId.`);
      }
      if (!nextStateBase.folders[folderId]) {
        throw new Error(`Tab group ${folderId} was not found.`);
      }
      if (tabIds.length === 0) {
        throw new Error(`${ORGANIZER_TABS_TOOL_NAME} move_tabs_to_group requires tabIds.`);
      }
      ensureTabsAreNotSplitLocked(nextStateBase, tabIds);
      nextState = moveOrganizerTabsToFolder(nextStateBase, folderId, tabIds);
    } else if (action === "ungroup") {
      nextState = ungroupOrganizerFolders(nextStateBase, readStringArray(input.folderIds));
    } else if (action === "rename_group") {
      const folderId = readString(input.folderId);
      if (!folderId) {
        throw new Error(`${ORGANIZER_TABS_TOOL_NAME} rename_group requires folderId.`);
      }
      nextState = renameOrganizerFolder(nextStateBase, folderId, {
        ...(input.name !== undefined ? { name: String(input.name) } : {}),
        ...(input.icon !== undefined ? { icon: input.icon === null ? null : String(input.icon) } : {}),
        ...(input.backgroundColor !== undefined
          ? { backgroundColor: input.backgroundColor === null ? null : String(input.backgroundColor) }
          : {}),
      });
    } else {
      throw new Error(
        `${ORGANIZER_TABS_TOOL_NAME} action must be one of sort_root_tabs, create_group, group_root_tabs_by_domain, move_tabs_to_group, ungroup, or rename_group.`,
      );
    }

    const appliedState = applyOrganizerTabsState(session, nextState);
    const appliedTarget = {
      ...target,
      sidebarState: appliedState,
    };
    return {
      ok: true,
      action,
      sourceWindowId: target.windowId,
      sourceWorkspaceId: target.workspaceId,
      tabs: buildOrganizerTabsPayload(appliedTarget),
    };
  }

  function persistOrganizerBookmarks(
    profileId: string,
    bookmarks: BookmarkRecord[],
    folders: BookmarkFolderRecord[],
  ) {
    if (!options.persistBookmarksState) {
      throw new Error("Bookmark organization is not available.");
    }
    return options.persistBookmarksState({
      profileId,
      bookmarks,
      folders,
    });
  }

  function runOrganizerBookmarksTool(input: Record<string, unknown>, session: AgentSessionState) {
    const action = readString(input.action);
    if (!action) {
      throw new Error(`${ORGANIZER_BOOKMARKS_TOOL_NAME} requires a non-empty action.`);
    }

    const profileId = options.getProfileIdForWorkspace?.(session.originWorkspaceId) ?? session.originWorkspaceId;
    const currentBookmarks = [...(options.getBookmarks?.(profileId) ?? [])];
    const currentFolders = [...(options.getBookmarkFolders?.(profileId) ?? [])];

    if (action === "create_folder") {
      const name = readString(input.name);
      if (!name) {
        throw new Error(`${ORGANIZER_BOOKMARKS_TOOL_NAME} create_folder requires name.`);
      }
      const parentId = readString(input.parentId) ?? null;
      if (parentId && !currentFolders.some((folder) => folder.id === parentId)) {
        throw new Error(`Parent bookmark folder ${parentId} was not found.`);
      }
      const nextFolders = [
        ...currentFolders,
        {
          id: randomUUID(),
          name,
          parentId,
          createdAt: Date.now(),
        },
      ];
      const result = persistOrganizerBookmarks(profileId, currentBookmarks, nextFolders);
      return {
        ok: true,
        action,
        profileId,
        bookmarks: buildOrganizerBookmarksPayload(profileId),
        createdFolderId: result.folders[result.folders.length - 1]?.id ?? null,
      };
    }

    if (action === "update_folder") {
      const folderId = readString(input.folderId);
      if (!folderId) {
        throw new Error(`${ORGANIZER_BOOKMARKS_TOOL_NAME} update_folder requires folderId.`);
      }
      const folder = currentFolders.find((entry) => entry.id === folderId);
      if (!folder) {
        throw new Error(`Bookmark folder ${folderId} was not found.`);
      }

      const nextParentId = input.parentId === undefined
        ? folder.parentId ?? null
        : readString(input.parentId) ?? null;
      if (nextParentId === folderId) {
        throw new Error("Bookmark folder cannot be its own parent.");
      }
      if (nextParentId) {
        const descendants = collectDescendantBookmarkFolderIds(currentFolders, folderId);
        if (descendants.has(nextParentId)) {
          throw new Error("Bookmark folder cannot be moved into one of its descendants.");
        }
      }

      const nextFolders = currentFolders.map((entry) => {
        if (entry.id !== folderId) {
          return entry;
        }
        return {
          ...entry,
          ...(readString(input.name) ? { name: readString(input.name)! } : {}),
          parentId: nextParentId,
        };
      });
      persistOrganizerBookmarks(profileId, currentBookmarks, nextFolders);
      return {
        ok: true,
        action,
        profileId,
        bookmarks: buildOrganizerBookmarksPayload(profileId),
      };
    }

    if (action === "move_bookmarks") {
      const bookmarkIds = new Set(readStringArray(input.bookmarkIds));
      if (bookmarkIds.size === 0) {
        throw new Error(`${ORGANIZER_BOOKMARKS_TOOL_NAME} move_bookmarks requires bookmarkIds.`);
      }
      const folderId = input.folderId === null ? null : readString(input.folderId) ?? null;
      if (folderId && !currentFolders.some((folder) => folder.id === folderId)) {
        throw new Error(`Bookmark folder ${folderId} was not found.`);
      }
      const nextBookmarks = currentBookmarks.map((bookmark) =>
        bookmarkIds.has(bookmark.id)
          ? {
              ...bookmark,
              folderId,
            }
          : bookmark);
      persistOrganizerBookmarks(profileId, nextBookmarks, currentFolders);
      return {
        ok: true,
        action,
        profileId,
        bookmarks: buildOrganizerBookmarksPayload(profileId),
        movedCount: bookmarkIds.size,
      };
    }

    if (action === "group_root_bookmarks_by_domain") {
      const minGroupSize = Math.max(2, Math.floor(readNumber(input.minGroupSize) ?? 2));
      const nextFolders = [...currentFolders];
      const rootFoldersByName = new Map(
        nextFolders
          .filter((folder) => !folder.parentId)
          .map((folder) => [folder.name.trim().toLowerCase(), folder.id] as const),
      );
      const groupedBookmarkIds = new Map<string, string[]>();
      for (const bookmark of currentBookmarks) {
        if (bookmark.folderId) {
          continue;
        }
        const domain = getDomainLabel(bookmark.url);
        const current = groupedBookmarkIds.get(domain) ?? [];
        current.push(bookmark.id);
        groupedBookmarkIds.set(domain, current);
      }

      const folderIdByDomain = new Map<string, string>();
      for (const [domain, bookmarkIds] of groupedBookmarkIds.entries()) {
        if (bookmarkIds.length < minGroupSize || domain === "other") {
          continue;
        }
        const existingFolderId = rootFoldersByName.get(domain);
        if (existingFolderId) {
          folderIdByDomain.set(domain, existingFolderId);
          continue;
        }
        const folderId = randomUUID();
        nextFolders.push({
          id: folderId,
          name: domain,
          parentId: null,
          createdAt: Date.now(),
        });
        rootFoldersByName.set(domain, folderId);
        folderIdByDomain.set(domain, folderId);
      }

      const nextBookmarks = currentBookmarks.map((bookmark) => {
        if (bookmark.folderId) {
          return bookmark;
        }
        const folderId = folderIdByDomain.get(getDomainLabel(bookmark.url));
        return folderId
          ? {
              ...bookmark,
              folderId,
            }
          : bookmark;
      });

      persistOrganizerBookmarks(profileId, nextBookmarks, nextFolders);
      return {
        ok: true,
        action,
        profileId,
        bookmarks: buildOrganizerBookmarksPayload(profileId),
      };
    }

    throw new Error(
      `${ORGANIZER_BOOKMARKS_TOOL_NAME} action must be one of create_folder, update_folder, move_bookmarks, or group_root_bookmarks_by_domain.`,
    );
  }

  function buildBookmarkOrganizerSubAgentSystemPrompt() {
    return [
      "You are Milo's bookmark organization sub-agent.",
      "Your only job is to turn the user's bookmark organization request into a safe structured plan.",
      "Use only bookmarkIds and folderIds from the supplied snapshot, plus folderKey values for folders you create in this plan.",
      "Respect the scope exactly. If a specific folder scope is provided, only move bookmarks already inside that folder or its descendants, and only create or move folders inside that scope.",
      "Never delete bookmarks or folders. Never invent URLs, bookmark ids, or existing folder ids.",
      "Prefer clear folder names that match the user's language and request. Do not over-organize tiny collections.",
      `Finish by calling ${BOOKMARK_ORGANIZER_FINISH_TOOL_NAME} exactly once with the full plan.`,
      "If your backend cannot emit tool calls, return exactly one raw JSON object with summary and operations. Do not wrap it in Markdown.",
      "Use null folderId only when the snapshot scope includes all bookmarks. For a limited folder scope, keep items under the scoped folder or one of its descendants.",
      "If no change is needed, call the finish tool with an empty operations array and explain that in summary.",
    ].join("\n");
  }

  const bookmarkOrganizerFinishTool: AgentBackendToolDefinition = {
    name: BOOKMARK_ORGANIZER_FINISH_TOOL_NAME,
    description:
      "Finish the bookmark organization sub-agent run with the structured bookmark organization plan.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Short user-facing summary of the intended bookmark organization.",
        },
        operations: {
          type: "array",
          description: "Ordered operations to apply to the bookmark store.",
          items: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: ["create_folder", "update_folder", "move_bookmarks"],
              },
              folderKey: {
                type: "string",
                description: "Temporary key for a newly-created folder, such as new:work.",
              },
              name: { type: "string" },
              parentFolderId: { type: ["string", "null"] },
              parentFolderKey: { type: "string" },
              folderId: { type: ["string", "null"] },
              bookmarkIds: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["action"],
            additionalProperties: false,
          },
        },
      },
      required: ["summary", "operations"],
      additionalProperties: false,
    },
  };

  const bookmarkOrganizerSubAgent = defineAgent<undefined>({
    id: "browser-bookmark-organizer-sub-agent",
    systemPrompt: buildBookmarkOrganizerSubAgentSystemPrompt(),
    tools: [bookmarkOrganizerFinishTool],
    toolChoice: {
      type: "function",
      function: {
        name: BOOKMARK_ORGANIZER_FINISH_TOOL_NAME,
      },
    },
  });

  function readBookmarkOrganizerOperations(value: unknown) {
    if (!isRecord(value)) {
      throw new Error("Bookmark organizer sub-agent returned invalid JSON.");
    }
    const summary = readString(value.summary) ?? "Bookmark organization plan completed.";
    const operations = Array.isArray(value.operations) ? value.operations.filter(isRecord) : [];
    return {
      summary,
      operations,
    };
  }

  function parseBookmarkOrganizerJsonContent(content: string | null) {
    if (!content) {
      return null;
    }

    const direct = tryParseJson(content);
    if (isRecord(direct)) {
      return direct;
    }

    const fencedMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
      const fenced = tryParseJson(fencedMatch[1]);
      if (isRecord(fenced)) {
        return fenced;
      }
    }

    const firstBrace = content.indexOf("{");
    const lastBrace = content.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const embedded = tryParseJson(content.slice(firstBrace, lastBrace + 1));
      if (isRecord(embedded)) {
        return embedded;
      }
    }

    return null;
  }

  function readBookmarkOrganizerPlanFromAssistant(
    assistant: {
      content: string;
      toolCalls: Array<{ name: string; argumentsText: string }>;
    },
  ) {
    const finishToolCall = assistant.toolCalls.find((toolCall) =>
      toolCall.name === BOOKMARK_ORGANIZER_FINISH_TOOL_NAME);
    if (finishToolCall) {
      const parsedArguments = parseToolCallArguments(finishToolCall);
      if (!parsedArguments.ok) {
        throw new Error(parsedArguments.error);
      }
      return parsedArguments.arguments;
    }

    return parseBookmarkOrganizerJsonContent(assistant.content);
  }

  function resolveBookmarkOrganizerParentId(
    operation: Record<string, unknown>,
    folderIdByKey: Map<string, string>,
  ) {
    const parentFolderKey = readString(operation.parentFolderKey);
    if (parentFolderKey) {
      const parentId = folderIdByKey.get(parentFolderKey);
      if (!parentId) {
        throw new Error(`Created folder key ${parentFolderKey} is not available yet.`);
      }
      return parentId;
    }
    return operation.parentFolderId === null ? null : readString(operation.parentFolderId) ?? null;
  }

  function resolveBookmarkOrganizerMoveTargetId(
    operation: Record<string, unknown>,
    folderIdByKey: Map<string, string>,
  ) {
    const folderKey = readString(operation.folderKey);
    if (folderKey) {
      const folderId = folderIdByKey.get(folderKey);
      if (!folderId) {
        throw new Error(`Created folder key ${folderKey} is not available yet.`);
      }
      return folderId;
    }
    return operation.folderId === null ? null : readString(operation.folderId) ?? null;
  }

  function ensureBookmarkOrganizerFolderTargetAllowed(input: {
    folderId: string | null;
    scopeFolderId: string | null;
    allowedFolderIds: Set<string>;
    allowRoot: boolean;
    operationName: string;
  }) {
    if (input.folderId === null) {
      if (!input.allowRoot) {
        throw new Error(`${input.operationName} cannot target root outside the requested bookmark folder scope.`);
      }
      return;
    }
    if (!input.allowedFolderIds.has(input.folderId)) {
      throw new Error(`${input.operationName} target folder ${input.folderId} is outside the requested bookmark scope.`);
    }
  }

  async function runBookmarkOrganizerSubAgent(
    input: Record<string, unknown>,
    session: AgentSessionState,
  ) {
    const backend = resolveBackendConfig();
    if (!backend) {
      throw new Error(
        options.resolveUiLocale() === "zh-CN"
          ? "书签整理 Agent 后端未配置。请先在 设置 > Agent 中创建并配置一个 LLM Provider，然后为 Agent 选择 provider 和 model；也可以用 `MILO_AGENT_ENDPOINT`、`MILO_AGENT_API_KEY`、`MILO_AGENT_MODEL` 环境变量覆盖。"
          : "Bookmark organizer backend is not configured. Create and configure an LLM provider in Settings > Agent, then choose the provider and model, or override it with `MILO_AGENT_ENDPOINT`, `MILO_AGENT_API_KEY`, and `MILO_AGENT_MODEL`.",
      );
    }

    const instruction = readString(input.instruction) ?? getLatestUserTaskText(session);
    if (!instruction) {
      throw new Error(`${BOOKMARK_ORGANIZER_TOOL_NAME} requires a non-empty instruction.`);
    }

    const profileId = options.getProfileIdForWorkspace?.(session.originWorkspaceId) ?? session.originWorkspaceId;
    const currentFolders = [...(options.getBookmarkFolders?.(profileId) ?? [])];
    const currentBookmarks = [...(options.getBookmarks?.(profileId) ?? [])];
    if (!options.getBookmarks || !options.getBookmarkFolders || !options.persistBookmarksState) {
      throw new Error("Bookmark organization is not available.");
    }

    const scope = resolveBookmarkFolderScope(input, currentFolders);
    const scopeFolderId = scope.folderId;
    const scopedFolderIds = scopeFolderId
      ? collectDescendantBookmarkFolderIds(currentFolders, scopeFolderId)
      : new Set(currentFolders.map((folder) => folder.id));
    const scopedBookmarkIds = new Set(
      currentBookmarks
        .filter((bookmark) =>
          scopeFolderId
            ? Boolean(bookmark.folderId && scopedFolderIds.has(bookmark.folderId))
            : true)
        .map((bookmark) => bookmark.id),
    );
    const snapshot = buildBookmarkOrganizerSnapshot(profileId, scopeFolderId);
    if (snapshot.truncated) {
      throw new Error("Bookmark scope is too large to organize safely in one sub-agent run.");
    }

    const organizerMessages: OpenAICompatibleChatMessage[] = [
      {
        role: "user",
        content: [
          `User instruction: ${instruction}`,
          `Requested scope: ${scope.label}`,
          "Bookmark snapshot JSON:",
          JSON.stringify(snapshot),
        ].join("\n"),
      },
    ];

    const assistant = await requestDefinedAgentTurn({
      agent: bookmarkOrganizerSubAgent,
      context: undefined,
      backend,
      messages: organizerMessages,
      requestHeaders: buildAgentRequestHeaders(session.sessionId),
      signal: session.activeAbortController?.signal,
    });

    let parsed = readBookmarkOrganizerPlanFromAssistant(assistant);
    if (!parsed) {
      const repairAssistant = await requestDefinedAgentTurn({
        agent: bookmarkOrganizerSubAgent,
        context: undefined,
        backend,
        messages: [
          ...organizerMessages,
          ...(assistant.content.trim()
            ? [{
                role: "assistant" as const,
                content: assistant.content,
              }]
            : []),
          {
            role: "user",
            content:
              `Your previous response did not call ${BOOKMARK_ORGANIZER_FINISH_TOOL_NAME} and did not contain a valid plan. `
              + `Call ${BOOKMARK_ORGANIZER_FINISH_TOOL_NAME} now with summary and operations. `
              + "If tool calls are unavailable in this backend, return exactly one raw JSON object with summary and operations, with no Markdown or extra text.",
          },
        ],
        requestHeaders: buildAgentRequestHeaders(session.sessionId),
        signal: session.activeAbortController?.signal,
      });
      parsed = readBookmarkOrganizerPlanFromAssistant(repairAssistant);
    }
    if (!parsed) {
      throw new Error(
        `Bookmark organizer sub-agent did not call ${BOOKMARK_ORGANIZER_FINISH_TOOL_NAME} or return a valid JSON plan.`,
      );
    }
    const plan = readBookmarkOrganizerOperations(parsed);
    const folderIdByKey = new Map<string, string>();
    let nextFolders = [...currentFolders];
    let nextBookmarks = [...currentBookmarks];
    const allowedFolderIds = new Set(scopedFolderIds);
    let createdFolderCount = 0;
    let updatedFolderCount = 0;
    let movedBookmarkCount = 0;
    const skippedBookmarkIds = new Set<string>();
    let skippedMoveOperationCount = 0;

    for (const operation of plan.operations) {
      const action = readString(operation.action);
      if (action === "create_folder") {
        const folderKey = readString(operation.folderKey);
        const name = readString(operation.name);
        if (!folderKey || !name) {
          throw new Error("create_folder requires folderKey and name.");
        }
        if (folderIdByKey.has(folderKey)) {
          throw new Error(`Duplicate created folder key ${folderKey}.`);
        }
        const explicitParentProvided = operation.parentFolderId !== undefined || operation.parentFolderKey !== undefined;
        const parentId = explicitParentProvided
          ? resolveBookmarkOrganizerParentId(operation, folderIdByKey)
          : scopeFolderId;
        ensureBookmarkOrganizerFolderTargetAllowed({
          folderId: parentId,
          scopeFolderId,
          allowedFolderIds,
          allowRoot: scopeFolderId === null,
          operationName: "create_folder",
        });
        const folderId = randomUUID();
        nextFolders = [
          ...nextFolders,
          {
            id: folderId,
            name,
            parentId,
            createdAt: Date.now(),
          },
        ];
        folderIdByKey.set(folderKey, folderId);
        allowedFolderIds.add(folderId);
        createdFolderCount += 1;
        continue;
      }

      if (action === "update_folder") {
        const folderId = readString(operation.folderId);
        if (!folderId || !allowedFolderIds.has(folderId)) {
          throw new Error("update_folder requires a folderId inside the requested bookmark scope.");
        }
        const existingFolder = nextFolders.find((folder) => folder.id === folderId);
        if (!existingFolder) {
          throw new Error(`Bookmark folder ${folderId} was not found.`);
        }
        const explicitParentProvided = operation.parentFolderId !== undefined || operation.parentFolderKey !== undefined;
        const parentId = explicitParentProvided
          ? resolveBookmarkOrganizerParentId(operation, folderIdByKey)
          : existingFolder.parentId ?? null;
        if (explicitParentProvided) {
          if (parentId === folderId) {
            throw new Error("Bookmark folder cannot be its own parent.");
          }
          ensureBookmarkOrganizerFolderTargetAllowed({
            folderId: parentId,
            scopeFolderId,
            allowedFolderIds,
            allowRoot: scopeFolderId === null,
            operationName: "update_folder",
          });
          const descendants = collectDescendantBookmarkFolderIds(nextFolders, folderId);
          if (parentId && descendants.has(parentId)) {
            throw new Error("Bookmark folder cannot be moved into one of its descendants.");
          }
        }
        const name = readString(operation.name);
        nextFolders = nextFolders.map((folder) =>
          folder.id === folderId
            ? {
                ...folder,
                ...(name ? { name } : {}),
                parentId,
              }
            : folder);
        updatedFolderCount += 1;
        continue;
      }

      if (action === "move_bookmarks") {
        const bookmarkIds = readStringArray(operation.bookmarkIds);
        if (bookmarkIds.length === 0) {
          throw new Error("move_bookmarks requires bookmarkIds.");
        }
        const validBookmarkIds = bookmarkIds.filter((bookmarkId) => scopedBookmarkIds.has(bookmarkId));
        for (const bookmarkId of bookmarkIds) {
          if (!scopedBookmarkIds.has(bookmarkId)) {
            skippedBookmarkIds.add(bookmarkId);
          }
        }
        if (validBookmarkIds.length === 0) {
          skippedMoveOperationCount += 1;
          continue;
        }
        const folderId = resolveBookmarkOrganizerMoveTargetId(operation, folderIdByKey);
        ensureBookmarkOrganizerFolderTargetAllowed({
          folderId,
          scopeFolderId,
          allowedFolderIds,
          allowRoot: scopeFolderId === null,
          operationName: "move_bookmarks",
        });
        const bookmarkIdSet = new Set(validBookmarkIds);
        nextBookmarks = nextBookmarks.map((bookmark) =>
          bookmarkIdSet.has(bookmark.id)
            ? {
                ...bookmark,
                folderId,
              }
            : bookmark);
        movedBookmarkCount += bookmarkIdSet.size;
        continue;
      }

      throw new Error(`Unsupported bookmark organizer operation "${action ?? ""}".`);
    }

    if (createdFolderCount > 0 || updatedFolderCount > 0 || movedBookmarkCount > 0) {
      persistOrganizerBookmarks(profileId, nextBookmarks, nextFolders);
    }

    return {
      ok: true,
      status: "completed",
      profileId,
      scope: {
        folderId: scopeFolderId,
        label: scope.label,
      },
      summary: plan.summary,
      operationCount: plan.operations.length,
      createdFolderCount,
      updatedFolderCount,
      movedBookmarkCount,
      skippedBookmarkReferenceCount: skippedBookmarkIds.size,
      skippedMoveOperationCount,
      ...(skippedBookmarkIds.size > 0 ? { skippedBookmarkIds: Array.from(skippedBookmarkIds).slice(0, 20) } : {}),
      bookmarks: buildOrganizerBookmarksPayload(profileId),
    };
  }

  function matchesOrganizerDownloadFilters(
    record: DownloadRecord,
    input: Record<string, unknown>,
    explicitIds: Set<string>,
  ) {
    if (explicitIds.size > 0) {
      return explicitIds.has(record.id);
    }

    const statuses = new Set(readStringArray(input.statuses));
    if (statuses.size > 0 && !statuses.has(record.status)) {
      return false;
    }

    const olderThanDays = readNumber(input.olderThanDays);
    if (olderThanDays !== undefined) {
      const ageMs = olderThanDays * 24 * 60 * 60 * 1000;
      if (Date.now() - record.createdAt < ageMs) {
        return false;
      }
    }

    return statuses.size > 0 || olderThanDays !== undefined;
  }

  async function runOrganizerDownloadsTool(input: Record<string, unknown>) {
    const action = readString(input.action);
    if (!action) {
      throw new Error(`${ORGANIZER_DOWNLOADS_TOOL_NAME} requires a non-empty action.`);
    }

    const currentRecords = options.getDownloads?.() ?? [];
    const explicitIds = new Set(readStringArray(input.downloadIds));
    const matchingRecords = currentRecords.filter((record) =>
      matchesOrganizerDownloadFilters(record, input, explicitIds));

    if (matchingRecords.length === 0) {
      return {
        ok: true,
        action,
        affectedCount: 0,
        downloads: buildOrganizerDownloadsPayload(),
      };
    }

    if (action === "remove_records") {
      if (!options.removeDownloadRecord) {
        throw new Error("Download cleanup is not available.");
      }
      for (const record of matchingRecords) {
        await options.removeDownloadRecord(record.id, {
          deleteFile: readBoolean(input.deleteFile) ?? false,
        });
      }
    } else if (action === "delete_files") {
      if (!options.deleteDownloadFile) {
        throw new Error("Download file deletion is not available.");
      }
      for (const record of matchingRecords) {
        await options.deleteDownloadFile(record.id);
      }
    } else if (action === "pause") {
      if (!options.pauseDownload) {
        throw new Error("Download pause is not available.");
      }
      for (const record of matchingRecords) {
        await options.pauseDownload(record.id);
      }
    } else if (action === "resume") {
      if (!options.resumeDownload) {
        throw new Error("Download resume is not available.");
      }
      for (const record of matchingRecords) {
        await options.resumeDownload(record.id);
      }
    } else if (action === "cancel") {
      if (!options.cancelDownload) {
        throw new Error("Download cancel is not available.");
      }
      for (const record of matchingRecords) {
        await options.cancelDownload(record.id);
      }
    } else if (action === "retry") {
      if (!options.retryDownload) {
        throw new Error("Download retry is not available.");
      }
      for (const record of matchingRecords) {
        await options.retryDownload(record.id);
      }
    } else {
      throw new Error(
        `${ORGANIZER_DOWNLOADS_TOOL_NAME} action must be one of remove_records, delete_files, pause, resume, cancel, or retry.`,
      );
    }

    return {
      ok: true,
      action,
      affectedCount: matchingRecords.length,
      downloads: buildOrganizerDownloadsPayload(),
    };
  }

  function buildImageRecognitionSubAgentSystemPrompt() {
    return [
      "You are Milo's image recognition sub-agent.",
      "Analyze only the provided screenshot or image.",
      "Use visible pixel evidence only. If text is blurry, clipped, or unreadable, say so explicitly.",
      "Do not invent UI labels, values, or states that are not visible in the image.",
      "When the image contains text, perform OCR as part of the answer when relevant to the task.",
      "Answer concisely but include the specific visual evidence needed to support the conclusion.",
      "If no image content is available to you, reply exactly: IMAGE_NOT_RECEIVED",
    ].join("\n");
  }

  const imageRecognitionSubAgent = defineAgent<undefined>({
    id: "browser-image-recognition-sub-agent",
    systemPrompt: buildImageRecognitionSubAgentSystemPrompt(),
  });

  async function runImageRecognitionSubAgent(
    input: Record<string, unknown>,
    session: AgentSessionState,
  ) {
    const backend = resolveImageRecognitionBackendConfig();
    if (!backend) {
      throw new Error(
        options.resolveUiLocale() === "zh-CN"
          ? "图片识别 Agent 后端未配置。请先在 设置 > Agent 中创建并配置一个 LLM Provider，然后为图片识别 Agent 选择 provider 和 model；也可以用 `MILO_IMAGE_AGENT_ENDPOINT`、`MILO_IMAGE_AGENT_API_KEY`、`MILO_IMAGE_AGENT_MODEL` 环境变量覆盖。"
          : "Image recognition backend is not configured. Create and configure an LLM provider in Settings > Agent, then choose the provider and model for the image agent, or override them with `MILO_IMAGE_AGENT_ENDPOINT`, `MILO_IMAGE_AGENT_API_KEY`, and `MILO_IMAGE_AGENT_MODEL`.",
      );
    }

    const imageRef = readString(input.imageRef);
    if (!imageRef) {
      throw new Error(`${IMAGE_RECOGNITION_TOOL_NAME} requires imageRef.`);
    }

    const task = readString(input.task);
    if (!task) {
      throw new Error(`${IMAGE_RECOGNITION_TOOL_NAME} requires a non-empty task.`);
    }

    const storedImage = getStoredImageReference(imageRef);
    if (!storedImage) {
      throw new Error(`Image reference ${imageRef} was not found. Capture a fresh screenshot first.`);
    }

    const imageInput = prepareImageRecognitionInput(storedImage);
    const content: OpenAICompatibleContentPart[] = [
      {
        type: "image_url",
        image_url: {
          url: imageInput.dataUrl,
          detail: "auto",
        },
      },
      {
        type: "text",
        text: [
          "The attached image is the actual screenshot to analyze.",
          `Image task: ${task}`,
          ...(storedImage.url ? [`Captured page URL: ${storedImage.url}`] : []),
          ...(storedImage.title ? [`Captured page title: ${storedImage.title}`] : []),
          `Captured selector: ${storedImage.selector}`,
          `Capture size: ${storedImage.width}x${storedImage.height}`,
          ...(imageInput.resized
            ? [`Model input image was resized to ${imageInput.width}x${imageInput.height} to fit the vision model context window.`]
            : []),
        ].join("\n"),
      },
    ];

    const assistant = await requestDefinedAgentTurn({
      agent: imageRecognitionSubAgent,
      context: undefined,
      backend,
      messages: [
        {
          role: "user",
          content,
        },
      ],
      requestHeaders: buildAgentRequestHeaders(session.sessionId),
      signal: session.activeAbortController?.signal,
    });

    const summary = assistant.content.trim();
    if (!summary) {
      throw new Error("Image recognition sub-agent returned no final text response.");
    }
    if (/\bIMAGE_NOT_RECEIVED\b/.test(summary)) {
      throw new Error(
        "Image recognition backend did not receive the screenshot image. Confirm the configured image agent model supports vision and accepts OpenAI-compatible image_url data URLs.",
      );
    }

    return {
      ok: true,
      status: "completed",
      imageRef: storedImage.ref,
      mimeType: storedImage.mimeType,
      width: storedImage.width,
      height: storedImage.height,
      selector: storedImage.selector,
      summary,
      backend: {
        endpoint: sanitizeEndpoint(backend.endpoint),
        model: backend.model,
      },
      modelInput: {
        width: imageInput.width,
        height: imageInput.height,
        resized: imageInput.resized,
      },
      ...(storedImage.url ? { url: storedImage.url } : {}),
      ...(storedImage.title ? { title: storedImage.title } : {}),
    };
  }

  function readUserScriptExistingScript(value: unknown): UserScriptAgentExistingScript | undefined {
    if (!isRecord(value)) {
      return undefined;
    }

    const existingScript: UserScriptAgentExistingScript = {
      ...(readString(value.name) ? { name: readString(value.name)! } : {}),
      ...(readString(value.description) ? { description: readString(value.description)! } : {}),
      ...(readStringArray(value.matches).length ? { matches: readStringArray(value.matches) } : {}),
      ...(readStringArray(value.excludes).length ? { excludes: readStringArray(value.excludes) } : {}),
      ...(readString(value.code) ? { code: readString(value.code)! } : {}),
      ...(readString(value.testCode) ? { testCode: readString(value.testCode)! } : {}),
    };

    return Object.keys(existingScript).length > 0 ? existingScript : undefined;
  }

  function readRawString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
  }

  function getSessionUserScriptProfileId(session: AgentSessionState) {
    return options.getProfileIdForWorkspace?.(session.originWorkspaceId) ?? session.originWorkspaceId;
  }

  function getCurrentSessionTabWebContents(session: AgentSessionState) {
    const { activeTab } = resolveSessionTabContext(session);
    if (!activeTab?.id) {
      throw new Error("No current page tab is available for user-script execution.");
    }
    const contents = options.getTabWebContents(activeTab.id);
    if (!contents || contents.isDestroyed()) {
      throw new Error("Current page tab is no longer available for user-script execution.");
    }
    return contents;
  }

  function summarizeUserScriptRecord(script: UserScriptRecord) {
    return {
      id: script.id,
      profileId: script.profileId,
      name: script.name,
      ...(script.description ? { description: script.description } : {}),
      enabled: script.enabled,
      matches: [...script.matches],
      excludes: [...script.excludes],
      runAt: script.runAt,
      hasCode: script.code.trim().length > 0,
      hasTestCode: Boolean(script.testCode?.trim()),
      createdAt: script.createdAt,
      updatedAt: script.updatedAt,
      ...(script.lastRunAt ? { lastRunAt: script.lastRunAt } : {}),
      ...(script.lastMatchedUrl ? { lastMatchedUrl: script.lastMatchedUrl } : {}),
      ...(script.lastError ? { lastError: script.lastError } : {}),
    };
  }

  async function installOrUpdateUserScript(
    session: AgentSessionState,
    input: {
      code?: string;
      description?: string;
      enabled?: boolean;
      excludes?: string[];
      matches?: string[];
      name?: string;
      runNow?: boolean;
      runTest?: boolean;
      scriptId?: string;
      testCode?: string;
    },
  ) {
    if (!options.createUserScript || !options.updateUserScript) {
      throw new Error("User-script installation is not available.");
    }

    const profileId = getSessionUserScriptProfileId(session);
    const payload: UserScriptCreateInput & UserScriptUpdateInput = {
      ...(input.name ? { name: input.name } : {}),
      ...(input.description ? { description: input.description } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.matches?.length ? { matches: input.matches } : {}),
      ...(input.excludes ? { excludes: input.excludes } : {}),
      ...(input.code !== undefined ? { code: input.code } : {}),
      ...(input.testCode !== undefined ? { testCode: input.testCode } : {}),
      runAt: "document-idle",
    };

    if (!input.scriptId && !payload.code?.trim()) {
      throw new Error("Installing a new user script requires non-empty code.");
    }

    const script = input.scriptId
      ? options.updateUserScript(profileId, input.scriptId, payload)
      : options.createUserScript(profileId, {
          enabled: true,
          ...payload,
        });

    let runResult: UserScriptRunResult | undefined;
    let testResult: UserScriptTestResult | undefined;
    if (input.runNow || input.runTest) {
      const contents = getCurrentSessionTabWebContents(session);
      if (input.runNow) {
        if (!options.runUserScriptNow) {
          throw new Error("Running user scripts is not available.");
        }
        runResult = await options.runUserScriptNow(profileId, contents, script.id);
      }
      if (input.runTest) {
        if (!options.runUserScriptTest) {
          throw new Error("Running user-script tests is not available.");
        }
        testResult = await options.runUserScriptTest(profileId, contents, script.id);
      }
    }

    return {
      action: input.scriptId ? "updated" : "created",
      profileId,
      script: summarizeUserScriptRecord(script),
      ...(runResult ? { runResult } : {}),
      ...(testResult ? { testResult } : {}),
    };
  }

  async function runUserScriptDraftSubAgent(
    input: Record<string, unknown>,
    session: AgentSessionState,
  ) {
    const backend = resolveBackendConfig();
    if (!backend) {
      throw new Error(
        options.resolveUiLocale() === "zh-CN"
          ? "User Script Agent 后端未配置。请先在 设置 > Agent 中创建并配置一个 LLM Provider，然后为 Agent 选择 provider 和 model；也可以用 `MILO_AGENT_ENDPOINT`、`MILO_AGENT_API_KEY`、`MILO_AGENT_MODEL` 环境变量覆盖。"
          : "User script agent backend is not configured. Create and configure an LLM provider in Settings > Agent, then choose the provider and model, or override it with `MILO_AGENT_ENDPOINT`, `MILO_AGENT_API_KEY`, and `MILO_AGENT_MODEL`.",
      );
    }

    const instruction = readString(input.instruction) ?? getLatestUserTaskText(session);
    if (!instruction) {
      throw new Error(`${USER_SCRIPT_DRAFT_TOOL_NAME} requires a non-empty instruction.`);
    }

    const mode = readUserScriptAgentMode(input.mode) ?? "script-and-test";
    const { windowContext, activeTab } = resolveSessionTabContext(session);
    const targetUrl = readString(input.targetUrl) ?? activeTab?.url ?? windowContext.activeUrl;
    const pageTitle = readString(input.pageTitle) ?? activeTab?.title ?? windowContext.activeTitle;
    const existingScript = readUserScriptExistingScript(input.existingScript);
    const shouldInstall = readBoolean(input.install) === true;
    const draft = await generateUserScriptAgentDraft({
      backend,
      input: {
        mode,
        instruction,
        ...(targetUrl ? { targetUrl } : {}),
        ...(pageTitle ? { pageTitle } : {}),
        ...(existingScript ? { existingScript } : {}),
      },
      requestHeaders: buildAgentRequestHeaders(session.sessionId),
      signal: session.activeAbortController?.signal,
    });
    const installation = shouldInstall
      ? await installOrUpdateUserScript(session, {
          scriptId: readString(input.scriptId),
          name: draft.name,
          ...(draft.description ? { description: draft.description } : {}),
          enabled: readBoolean(input.enabled) ?? true,
          matches: draft.matches,
          excludes: draft.excludes,
          code: draft.code,
          testCode: draft.testCode,
          runNow: readBoolean(input.runNow) === true,
          runTest: readBoolean(input.runTest) === true,
        })
      : undefined;

    return {
      ok: true,
      status: "completed",
      mode,
      ...(targetUrl ? { targetUrl } : {}),
      ...(pageTitle ? { pageTitle } : {}),
      draft,
      ...(installation ? { installation } : {}),
      backend: {
        endpoint: sanitizeEndpoint(backend.endpoint),
        model: backend.model,
      },
    };
  }

  function getLatestAssistantText(session: AgentSessionState) {
    for (let index = session.uiMessages.length - 1; index >= 0; index -= 1) {
      const message = session.uiMessages[index];
      if (message?.role === "assistant" && message.kind === "message" && message.content.trim()) {
        return message.content.trim();
      }
    }
    return undefined;
  }

  async function runStartPageWidgetBuilderSubAgent(
    input: Record<string, unknown>,
    session: AgentSessionState,
  ) {
    const instruction = readString(input.instruction) ?? getLatestUserTaskText(session);
    if (!instruction) {
      throw new Error(`${START_PAGE_WIDGET_BUILDER_TOOL_NAME} requires a non-empty instruction.`);
    }

    const initialSnapshot = await createSession({
      workspaceId: session.originWorkspaceId,
      windowId: session.originWindowId,
      privacyMode: session.privacyMode,
      profile: "widget-builder",
      content: instruction,
    });

    const childSession = sessions.get(initialSnapshot.sessionId);
    if (!childSession || childSession.deleted) {
      throw new Error("Widget-builder agent session was not created.");
    }

    if (childSession.runningPromise) {
      await childSession.runningPromise;
    }

    const finalSnapshot = buildSnapshot(childSession);
    const terminalResult = childSession.terminalResult;
    const status: AgentFinishStatus = terminalResult?.status
      ?? (finalSnapshot.status === "error" || finalSnapshot.status === "interrupted" ? "failed" : "completed");
    const summary = terminalResult?.summary
      ?? getLatestAssistantText(childSession)
      ?? childSession.lastError
      ?? finalSnapshot.preview
      ?? "Widget-builder agent finished.";
    const nextStep = terminalResult?.nextStep;

    return {
      ok: status === "completed",
      status,
      summary,
      ...(nextStep ? { nextStep } : {}),
      profile: "widget-builder",
      sessionId: finalSnapshot.sessionId,
      title: finalSnapshot.title,
      preview: finalSnapshot.preview,
      messageCount: finalSnapshot.messages.length,
      ...(childSession.lastError ? { error: childSession.lastError } : {}),
      result: {
        sessionId: finalSnapshot.sessionId,
        title: finalSnapshot.title,
        preview: finalSnapshot.preview,
        messageCount: finalSnapshot.messages.length,
        status: finalSnapshot.status,
        ...(terminalResult ? { terminalResult } : {}),
        ...(childSession.lastError ? { error: childSession.lastError } : {}),
      },
    };
  }

  async function runUserScriptInstallTool(
    input: Record<string, unknown>,
    session: AgentSessionState,
  ) {
    const code = readRawString(input.code);
    const testCode = readRawString(input.testCode);
    const installation = await installOrUpdateUserScript(session, {
      scriptId: readString(input.scriptId),
      name: readString(input.name),
      description: readString(input.description),
      enabled: readBoolean(input.enabled) ?? true,
      matches: readStringArray(input.matches),
      excludes: readStringArray(input.excludes),
      ...(code !== undefined ? { code } : {}),
      ...(testCode !== undefined ? { testCode } : {}),
      runNow: readBoolean(input.runNow) === true,
      runTest: readBoolean(input.runTest) === true,
    });
    return {
      ok: true,
      status: "completed",
      ...installation,
    };
  }

  function runCurrentPageUserScriptsListTool(
    input: Record<string, unknown>,
    session: AgentSessionState,
  ) {
    const { windowContext, activeTab } = resolveSessionTabContext(session);
    const targetUrl = readString(input.url) ?? activeTab?.url ?? windowContext.activeUrl;
    if (!targetUrl) {
      throw new Error("No current page URL is available for user-script lookup.");
    }

    const profileId = getSessionUserScriptProfileId(session);
    if (!options.listMatchingUserScripts) {
      throw new Error("User-script lookup is not available.");
    }
    const scripts = options.listMatchingUserScripts(profileId, targetUrl);

    return {
      ok: true,
      status: "completed",
      profileId,
      url: targetUrl,
      scriptCount: scripts.length,
      scripts: scripts.map((script) => summarizeUserScriptRecord(script)),
    };
  }

  localTools.push({
    name: BROWSER_CONTEXT_TOOL_NAME,
    description:
      "Read browser window context for the isolated automation workspace plus a read-only summary of the user's source window. "
      + "Use this when current automation state matters and has not been provided in the conversation. "
      + `For source workspace tabs or tab folders, prefer ${SOURCE_WORKSPACE_CONTEXT_TOOL_NAME}; source tabs are exposed only as sourceTabRef values and must be read through source_* tools.`,
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    execute: (_input, session) => buildWindowContextPayload(session),
  });
  localTools.push({
    name: SOURCE_WORKSPACE_CONTEXT_TOOL_NAME,
    description:
      "Read the user's source workspace/window context without granting browser automation control over it. "
      + "Use this for currently open tabs, tab folders/directories/groups, split tabs, and named containers in the source workspace. "
      + `It returns sourceTabRef handles that can only be used with ${SOURCE_TAB_SNAPSHOT_TOOL_NAME}, ${SOURCE_TAB_EXTRACT_TOOL_NAME}, or ${SOURCE_TAB_CLONE_TOOL_NAME}.`,
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    execute: (_input, session) => buildSourceWorkspaceContextPayload(session),
  });
  localTools.push({
    name: SOURCE_TAB_SNAPSHOT_TOOL_NAME,
    description:
      "Read a source workspace tab through a read-only semantic snapshot. "
      + "This cannot click, type, navigate, execute arbitrary page scripts, or expose a reusable browser session/page reference.",
    parameters: {
      type: "object",
      properties: {
        sourceTabRef: {
          type: "string",
          description: `A source tab handle returned by ${SOURCE_WORKSPACE_CONTEXT_TOOL_NAME}.`,
        },
        task: {
          type: "string",
          description: "Optional task used to prioritize relevant page regions.",
        },
        maxInformation: {
          type: "number",
          description: "Maximum information blocks to return.",
        },
        maxRegions: {
          type: "number",
          description: "Maximum semantic regions to return.",
        },
        maxCapabilities: {
          type: "number",
          description: "Maximum capability summaries to return. Capabilities are descriptive only for source tabs.",
        },
      },
      required: ["sourceTabRef"],
      additionalProperties: false,
    },
    execute: async (input, session) => {
      await ensureAutomationWorkspaceBinding(session);
      const sourceTab = resolveSourceTabRef(session, readString(input.sourceTabRef));
      const result = await withSourcePage(session, sourceTab, async (page) =>
        options.automationService.callAgentTool(
          "page.snapshot",
          {
            page,
            ...(readString(input.task) ? { task: readString(input.task) } : {}),
            ...(readNumber(input.maxInformation) !== undefined ? { maxInformation: readNumber(input.maxInformation) } : {}),
            ...(readNumber(input.maxRegions) !== undefined ? { maxRegions: readNumber(input.maxRegions) } : {}),
            ...(readNumber(input.maxCapabilities) !== undefined ? { maxCapabilities: readNumber(input.maxCapabilities) } : {}),
          },
          {
            signal: session.activeAbortController?.signal,
            boundWorkspaceId: sourceTab.workspaceId,
            boundScope: "tab",
            boundTabId: sourceTab.tabId,
          },
        ));
      return {
        ok: true,
        sourceTab: {
          sourceTabRef: sourceTab.sourceTabRef,
          title: sourceTab.title,
          url: sourceTab.url,
          displayUrl: sourceTab.displayUrl,
        },
        snapshot: stripPageRefFromRecord(result),
      };
    },
  });
  localTools.push({
    name: SOURCE_TAB_EXTRACT_TOOL_NAME,
    description:
      "Extract text, records, or images from a source workspace tab through a read-only extractor. "
      + "This is the only supported way to read source tab content for data extraction without cloning it into the isolated automation workspace.",
    parameters: {
      type: "object",
      properties: {
        sourceTabRef: {
          type: "string",
          description: `A source tab handle returned by ${SOURCE_WORKSPACE_CONTEXT_TOOL_NAME}.`,
        },
        mode: {
          type: "string",
          enum: ["auto", "records", "text", "images"],
          description: "Extraction mode.",
        },
        task: {
          type: "string",
          description: "Optional task used to prioritize the page snapshot before extraction.",
        },
        sourceRole: {
          type: "string",
          enum: ["auto", "table", "list", "panel", "main", "form"],
          description: "Preferred structured source role.",
        },
        maxItems: {
          type: "number",
          description: "Maximum records or images to return.",
        },
        recordSchema: {
          type: "object",
          description: "Optional JSON Schema-like object used to validate extracted records.",
          additionalProperties: true,
        },
      },
      required: ["sourceTabRef"],
      additionalProperties: false,
    },
    execute: async (input, session) => {
      await ensureAutomationWorkspaceBinding(session);
      const sourceTab = resolveSourceTabRef(session, readString(input.sourceTabRef));
      const result = await withSourcePage(session, sourceTab, async (page) => {
        if (readString(input.task)) {
          await options.automationService.callAgentTool(
            "page.snapshot",
            {
              page,
              task: readString(input.task),
            },
            {
              signal: session.activeAbortController?.signal,
              boundWorkspaceId: sourceTab.workspaceId,
              boundScope: "tab",
              boundTabId: sourceTab.tabId,
            },
          );
        }
        return options.automationService.callAgentTool(
          "page.extract",
          {
            page,
            ...(readString(input.mode) ? { mode: readString(input.mode) } : {}),
            ...(readString(input.sourceRole) ? { sourceRole: readString(input.sourceRole) } : {}),
            ...(readNumber(input.maxItems) !== undefined ? { maxItems: readNumber(input.maxItems) } : {}),
            ...(isRecord(input.recordSchema) ? { recordSchema: input.recordSchema } : {}),
          },
          {
            signal: session.activeAbortController?.signal,
            boundWorkspaceId: sourceTab.workspaceId,
            boundScope: "tab",
            boundTabId: sourceTab.tabId,
          },
        );
      });
      return {
        ok: true,
        sourceTab: {
          sourceTabRef: sourceTab.sourceTabRef,
          title: sourceTab.title,
          url: sourceTab.url,
          displayUrl: sourceTab.displayUrl,
        },
        extraction: stripPageRefFromRecord(result),
      };
    },
  });
  localTools.push({
    name: SOURCE_TAB_CLONE_TOOL_NAME,
    description:
      "Open a source tab's URL inside the isolated automation workspace and return the automation browser session. "
      + "Use this before any action that would require clicking, typing, navigation, or other mutable browser automation.",
    parameters: {
      type: "object",
      properties: {
        sourceTabRef: {
          type: "string",
          description: `A source tab handle returned by ${SOURCE_WORKSPACE_CONTEXT_TOOL_NAME}.`,
        },
        waitUntil: {
          type: "string",
          enum: ["none", "domcontentloaded", "load", "network_idle"],
          description: "Navigation readiness condition in the isolated automation workspace.",
        },
      },
      required: ["sourceTabRef"],
      additionalProperties: false,
    },
    execute: async (input, session) => {
      const sourceTab = resolveSourceTabRef(session, readString(input.sourceTabRef));
      const url = sourceTab.url?.trim();
      if (!url) {
        throw new Error("The source tab has no URL to clone into the automation workspace.");
      }
      await ensureAutomationWorkspaceBinding(session);
      const openResult = await options.automationService.callTool(
        "browser_session_open",
        {
          url,
          waitUntil: readString(input.waitUntil) ?? "load",
        },
        buildSessionAutomationToolOptions(session, session.activeAbortController?.signal),
      );
      reconcileRuntimeContextFromTool(
        session.runtimeContext,
        "browser_session_open",
        { url },
        openResult,
        {
          onControlledTabsChanged: () => notifyControlledTabsChanged(session),
        },
      );
      return {
        ok: true,
        sourceTab: {
          sourceTabRef: sourceTab.sourceTabRef,
          title: sourceTab.title,
          url,
        },
        automation: openResult,
      };
    },
  });
  localTools.push({
    name: BROWSER_RUNTIME_TOOL_NAME,
    description:
      "Read the current agent runtime state, including known automation sessions, event subscriptions, and recent observed browser events. "
      + "Use this when you need live runtime state that is not already in the conversation.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    execute: (_input, session) => buildRuntimeContextPayload(session),
  });
  localTools.push({
    name: TIME_TOOL_NAME,
    description:
      "Read the current local and UTC date/time. "
      + "Use this before resolving relative dates such as today, tomorrow, and yesterday when the user did not provide an explicit date/timezone.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    execute: () => buildTimePayload(),
  });
  localTools.push({
    name: AGENT_PLAN_TOOL_NAME,
    description:
      "Create, read, update, revise, or clear the current task plan as a todo list. "
      + "Use this to decompose complex tasks before execution, read the existing plan when needed, mark progress as steps start or finish, and revise the plan when execution proves the original plan is incomplete or impossible.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["get", "set", "update", "revise", "clear"],
          description:
            "Plan operation. set creates a new plan, update changes item status/notes, revise replaces the plan when new information makes the old plan unsuitable, get reads it, and clear removes it.",
        },
        objective: {
          type: "string",
          description: "Overall objective for the plan. Required for set; reused from the current plan for revise when omitted.",
        },
        reason: {
          type: "string",
          description: "Reason for revising the plan, especially when the previous plan cannot be completed.",
        },
        items: {
          type: "array",
          description:
            "Todo items for set or revise. Entries may be strings or objects with id/title/status/notes. Keep items concrete and ordered.",
          items: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  status: {
                    type: "string",
                    enum: ["pending", "in_progress", "completed", "blocked", "skipped"],
                  },
                  notes: { type: "string" },
                },
                additionalProperties: false,
              },
            ],
          },
        },
        itemId: {
          type: "string",
          description: "Plan item id to update when action is update.",
        },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed", "blocked", "skipped"],
          description: "New status for itemId when action is update.",
        },
        title: {
          type: "string",
          description: "Optional replacement title for itemId when action is update.",
        },
        notes: {
          type: "string",
          description: "Optional item notes when action is update.",
        },
        updates: {
          type: "array",
          description: "Batch item updates for action=update.",
          items: {
            type: "object",
            properties: {
              itemId: { type: "string" },
              id: { type: "string" },
              title: { type: "string" },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed", "blocked", "skipped"],
              },
              notes: { type: "string" },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    execute: (input, session) => applyAgentPlanTool(input, session),
  });
  localTools.push({
    name: AGENT_PROFILE_TOOL_NAME,
    description:
      "Read, replace, or clear Milo's persistent user-editable main-agent profile. "
      + "Use this when the user asks Milo to remember or change its response language, response style, tone, collaboration preferences, or decision-making style across conversations. "
      + "The profile is not for one-off task instructions, browser capabilities, tool policies, safety rules, or other functional behavior. "
      + "When setting or updating, pass the full revised profileInstructions, not just a delta.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["get", "set", "update", "clear"],
          description:
            "Profile operation. Defaults to update when profileInstructions is provided, otherwise get. set and update both replace the whole user-editable profile.",
        },
        profileInstructions: {
          type: "string",
          maxLength: MAX_AGENT_PROFILE_INSTRUCTIONS_LENGTH,
          description:
            "Full replacement profile instructions. Keep this limited to user-facing response language, style, tone, collaboration, and decision-making presentation preferences.",
        },
        instructions: {
          type: "string",
          maxLength: MAX_AGENT_PROFILE_INSTRUCTIONS_LENGTH,
          description: "Alias for profileInstructions for compatibility.",
        },
        reason: {
          type: "string",
          description: "Brief reason for the profile change.",
        },
      },
      additionalProperties: false,
    },
    execute: (input) => applyAgentProfileTool(input),
  });
  localTools.push({
    name: USER_MEMORY_TOOL_NAME,
    description:
      "Read, add, update, delete, or reject Milo's persistent user memory about the user's topics, stable preferences, negative preferences, and workflow preferences. "
      + "Use this when the user asks Milo to remember a topic/preference, correct a remembered preference, forget a memory item, or avoid an inferred preference. "
      + "Do not use this for one-off task instructions. Use agent_profile_manage instead for response language, tone, and collaboration presentation preferences.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["get", "upsert", "delete", "reject"],
          description: "Memory operation. Defaults to upsert when key and value are provided, otherwise get.",
        },
        profileId: { type: "string" },
        signalId: {
          type: "string",
          description: "Existing memory signal ID for update, delete, or reject.",
        },
        key: {
          type: "string",
          description: "Short stable memory key, such as preferred_topics, default_report_format, avoid_recommendation, or site_workflow.",
        },
        value: {
          type: "string",
          description: "Concise memory value grounded in what the user said or did.",
        },
        category: {
          type: "string",
          enum: ["recent_focus", "stable_preference", "negative_preference", "workflow_preference"],
        },
        source: {
          type: "string",
          enum: ["manual", "agent_interaction", "browsing_history", "workflow_learning", "writing_style", "explicit", "observed"],
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        strength: { type: "number", minimum: 0, maximum: 1 },
        evidenceRefs: {
          type: "array",
          items: { type: "string" },
          description: "Short evidence labels, not raw private page content.",
        },
        scope: {
          type: "string",
          enum: ["global", "workspace", "domain"],
        },
        domain: {
          type: "string",
          description: "Domain when scope=domain. Defaults to current tab domain when available.",
        },
        status: {
          type: "string",
          enum: ["active", "stale", "rejected"],
        },
      },
      additionalProperties: false,
    },
    execute: (input, session) => applyUserMemoryTool(input, session),
  });
  localTools.push({
    name: SESSION_SCHEDULE_TOOL_NAME,
    description:
      "Read, configure, or clear the schedule attached to the current agent task/session. "
      + "Use this only when the user explicitly wants this task to run later or on a recurring schedule. "
      + "Cron expressions use 5 fields (minute hour day month weekday) in the runtime's local timezone. "
      + "When setting a schedule, provide a self-contained prompt for the future run when possible.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["get", "set", "clear"],
          description:
            "Schedule operation. Defaults to set when cronExpression or prompt is provided, otherwise get.",
        },
        cronExpression: {
          type: "string",
          description: "Five-field cron expression in the runtime's local timezone. Required when action is set.",
        },
        prompt: {
          type: "string",
          description:
            "Self-contained instruction that should run on every trigger. "
            + "Strongly recommended when action is set; otherwise the latest runnable user task in this session is reused.",
        },
      },
      additionalProperties: false,
    },
    execute: (input, session) => {
      const explicitAction = readSessionScheduleToolAction(input.action);
      if (input.action !== undefined && !explicitAction) {
        throw new Error(`${SESSION_SCHEDULE_TOOL_NAME} action must be one of get, set, or clear.`);
      }

      const action = explicitAction
        ?? (readString(input.cronExpression) || readString(input.prompt) ? "set" : "get");

      if (action === "get") {
        return buildSessionScheduleToolResult(session, action);
      }

      if (action === "clear") {
        clearSessionSchedule(session.sessionId);
        return buildSessionScheduleToolResult(session, action);
      }

      const cronExpression = readString(input.cronExpression);
      if (!cronExpression) {
        throw new Error(`${SESSION_SCHEDULE_TOOL_NAME} requires cronExpression when action is set.`);
      }

      const prompt = readString(input.prompt);
      setSessionSchedule({
        sessionId: session.sessionId,
        cronExpression,
        ...(prompt ? { prompt } : {}),
      });
      return buildSessionScheduleToolResult(session, action);
    },
  });
  localTools.push({
    name: AGENT_LAUNCH_SCHEDULE_TOOL_NAME,
    description:
      "Read, configure, or clear schedules that launch a fresh new agent session and send it a configured message. "
      + "Use this when the user wants a recurring task to start as a new independent agent run instead of continuing the current task/session. "
      + "Cron expressions use 5 fields (minute hour day month weekday) in the runtime's local timezone.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "get", "set", "clear"],
          description:
            "Operation. Defaults to set when cronExpression or prompt is provided, get when triggerId is provided, otherwise list.",
        },
        triggerId: {
          type: "string",
          description: "Existing launch schedule id for get, update, or clear. Omit on set to create a new schedule.",
        },
        cronExpression: {
          type: "string",
          description: "Five-field cron expression in the runtime's local timezone. Required when action is set.",
        },
        prompt: {
          type: "string",
          description: "Self-contained message to send to each newly-created agent session. Required when action is set.",
        },
        title: {
          type: "string",
          description: "Optional human-readable schedule title.",
        },
        scope: {
          type: "string",
          enum: ["default", "current-tab"],
          description:
            "New agent scope. Use default for independent automation workspace runs; current-tab binds to the current tab if it is still available.",
        },
        tabId: {
          type: "string",
          description: "Optional current-tab id when scope is current-tab. Defaults to the current session tab if available.",
        },
        privacyMode: {
          type: "boolean",
          description: "Whether launched agent sessions should use privacy mode. Defaults to true.",
        },
        profile: {
          type: "string",
          enum: ["default", "organizer", "widget-builder"],
          description: "Agent profile for newly-created sessions. Defaults to default.",
        },
      },
      additionalProperties: false,
    },
    execute: (input, session) => {
      const explicitAction = readAgentLaunchScheduleToolAction(input.action);
      if (input.action !== undefined && !explicitAction) {
        throw new Error(`${AGENT_LAUNCH_SCHEDULE_TOOL_NAME} action must be one of list, get, set, or clear.`);
      }

      const triggerId = readString(input.triggerId);
      const action = explicitAction
        ?? (readString(input.cronExpression) || readString(input.prompt)
          ? "set"
          : triggerId
            ? "get"
            : "list");

      if (action === "list") {
        return {
          ok: true,
          action,
          schedules: listAgentLaunchSchedules(),
        };
      }

      if (action === "get") {
        if (!triggerId) {
          throw new Error(`${AGENT_LAUNCH_SCHEDULE_TOOL_NAME} requires triggerId when action is get.`);
        }
        const schedule = getAgentLaunchSchedule(triggerId);
        return {
          ok: true,
          action,
          hasSchedule: Boolean(schedule),
          ...(schedule ? { schedule } : {}),
        };
      }

      if (action === "clear") {
        if (!triggerId) {
          throw new Error(`${AGENT_LAUNCH_SCHEDULE_TOOL_NAME} requires triggerId when action is clear.`);
        }
        const cleared = clearAgentLaunchSchedule(triggerId);
        return {
          ok: true,
          action,
          cleared: Boolean(cleared),
          ...(cleared ? { schedule: cleared } : {}),
        };
      }

      const cronExpression = readString(input.cronExpression);
      if (!cronExpression) {
        throw new Error(`${AGENT_LAUNCH_SCHEDULE_TOOL_NAME} requires cronExpression when action is set.`);
      }
      const prompt = readString(input.prompt);
      if (!prompt) {
        throw new Error(`${AGENT_LAUNCH_SCHEDULE_TOOL_NAME} requires prompt when action is set.`);
      }

      const scope = input.scope === "current-tab" ? "current-tab" : "default";
      const tabId = scope === "current-tab"
        ? readString(input.tabId) ?? session.automationTabId
        : undefined;
      const profile: AgentSessionProfile =
        input.profile === "organizer" || input.profile === "widget-builder" ? input.profile : "default";
      const schedule = setAgentLaunchSchedule({
        workspaceId: session.originWorkspaceId,
        windowId: session.originWindowId,
        ...(triggerId ? { triggerId } : {}),
        cronExpression,
        prompt,
        scope,
        ...(tabId ? { tabId } : {}),
        privacyMode: readBoolean(input.privacyMode) ?? true,
        profile,
        ...(readString(input.title) ? { title: readString(input.title) } : {}),
      });
      return {
        ok: true,
        action,
        schedule,
      };
    },
  });
  localTools.push({
    name: EVENT_TRIGGER_TOOL_NAME,
    description:
      "Read, configure, or clear the event-driven trigger attached to the current agent task/session. "
      + "Use this when the user wants the task to stay armed in the background and automatically run again after matching page/browser events.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["get", "set", "clear"],
          description:
            "Trigger operation. Defaults to set when prompt, channels, or match is provided, otherwise get.",
        },
        prompt: {
          type: "string",
          description:
            "Self-contained instruction to run after a matching event is observed. "
            + "When omitted on set, the latest runnable user instruction from this task thread is reused.",
        },
        channels: {
          type: "array",
          description: "Browser event channels to observe while the trigger is armed.",
          items: {
            type: "string",
            enum: [...EVENT_TRIGGER_CHANNEL_VALUES],
          },
        },
        match: {
          type: "object",
          description: "Optional event matcher. When omitted, any event from the selected channels can trigger the task.",
          properties: {
            kinds: {
              type: "array",
              items: { type: "string" },
            },
            source: { type: "string" },
            urlMatches: { type: "string" },
            titleMatches: { type: "string" },
            summaryMatches: { type: "string" },
          },
          additionalProperties: false,
        },
        awaitTimeoutMs: {
          type: "integer",
          description: `Long-poll wait timeout in milliseconds before the watcher renews the event await. Max ${DEFAULT_EVENT_TRIGGER_AWAIT_TIMEOUT_MS}.`,
        },
        cooldownMs: {
          type: "integer",
          description: "Minimum quiet period after one trigger before another matching event can start a new run.",
        },
      },
      additionalProperties: false,
    },
    execute: async (input, session) => {
      const explicitAction = readSessionScheduleToolAction(input.action);
      if (input.action !== undefined && !explicitAction) {
        throw new Error(`${EVENT_TRIGGER_TOOL_NAME} action must be one of get, set, or clear.`);
      }

      const action = explicitAction
        ?? (readString(input.prompt) || Array.isArray(input.channels) || isRecord(input.match) ? "set" : "get");

      if (action === "get") {
        return buildSessionEventTriggerToolResult(session, action);
      }

      if (action === "clear") {
        await clearSessionEventTrigger(session.sessionId);
        return buildSessionEventTriggerToolResult(session, action);
      }

      const prompt = resolveSchedulePrompt(session, readString(input.prompt));
      const channels = readStringArray(input.channels)
        .filter((entry) => (EVENT_TRIGGER_CHANNEL_VALUES as readonly string[]).includes(entry));
      if (Array.isArray(input.channels) && channels.length === 0) {
        throw new Error(`${EVENT_TRIGGER_TOOL_NAME} requires at least one valid channel when channels is provided.`);
      }

      const awaitTimeoutMs = readNumber(input.awaitTimeoutMs);
      if (awaitTimeoutMs !== undefined && (!Number.isFinite(awaitTimeoutMs) || awaitTimeoutMs < 1)) {
        throw new Error(`${EVENT_TRIGGER_TOOL_NAME} awaitTimeoutMs must be a positive integer.`);
      }

      const cooldownMs = readNumber(input.cooldownMs);
      if (cooldownMs !== undefined && (!Number.isFinite(cooldownMs) || cooldownMs < 0)) {
        throw new Error(`${EVENT_TRIGGER_TOOL_NAME} cooldownMs must be zero or a positive integer.`);
      }

      await setSessionEventTrigger({
        sessionId: session.sessionId,
        prompt,
        channels,
        match: readAgentSessionEventMatch(input.match) ?? undefined,
        ...(awaitTimeoutMs !== undefined ? { awaitTimeoutMs: Math.floor(awaitTimeoutMs) } : {}),
        ...(cooldownMs !== undefined ? { cooldownMs: Math.floor(cooldownMs) } : {}),
      });
      return buildSessionEventTriggerToolResult(session, action);
    },
  });
  localTools.push({
    name: ELEMENT_SCREENSHOT_TOOL_NAME,
    description:
      "Capture a screenshot of a specific visible page element and return an image reference instead of inline image data. "
      + "Provide selector/locator directly, or resolve the target semantically with role/name/text/label before capture.",
    parameters: {
      type: "object",
      properties: {
        browserSessionId: {
          type: "string",
          description: "Optional attached browser session to target.",
        },
        tabId: {
          type: "string",
          description: "Optional tab id fallback when no browser session is attached yet.",
        },
        selector: {
          type: "string",
          description: "Direct CSS selector for the target element.",
        },
        locator: {
          type: "string",
          description: "Reusable locator/selector from an earlier semantic lookup.",
        },
        kind: {
          type: "string",
          enum: ["element", "form", "region"],
          description: "Semantic target kind when resolving the target automatically.",
        },
        role: {
          type: "string",
          description: "Accessibility/semantic role filter for semantic target lookup.",
        },
        name: {
          type: "string",
          description: "Accessible name filter for semantic target lookup.",
        },
        text: {
          type: "string",
          description: "Visible text filter for semantic target lookup.",
        },
        label: {
          type: "string",
          description: "Associated label filter for semantic target lookup.",
        },
        regionId: {
          type: "string",
          description: "Optional scoped region id for semantic target lookup.",
        },
        formId: {
          type: "string",
          description: "Optional scoped form id for semantic target lookup.",
        },
        includeHidden: {
          type: "boolean",
          description: "Whether hidden elements can be considered during semantic lookup.",
        },
        padding: {
          type: "number",
          description: "Extra padding in CSS pixels around the captured element. Defaults to 12.",
        },
      },
      additionalProperties: false,
    },
    execute: (input, session) => captureElementScreenshot(input, session),
  });
  localTools.push({
    name: IMAGE_RECOGNITION_TOOL_NAME,
    description:
      "Send a previously captured screenshot reference to the image recognition sub-agent. "
      + "The referenced image is converted to base64 automatically before the sub-agent request.",
    parameters: {
      type: "object",
      properties: {
        imageRef: {
          type: "string",
          description: "Screenshot image reference returned by browser_capture_element_screenshot.",
        },
        task: {
          type: "string",
          description: "What the image recognition sub-agent should identify, read, or explain from the screenshot.",
        },
      },
      required: ["imageRef", "task"],
      additionalProperties: false,
    },
    execute: (input, session) => runImageRecognitionSubAgent(input, session),
  });
  if (hasStartPageWidgetPackageTools) {
    localTools.push({
      name: START_PAGE_WIDGET_BUILDER_TOOL_NAME,
      description:
        "Delegate Milo start page widget creation or updates to the dedicated widget-builder agent. "
        + "Use this when the user asks to create, generate, build, update, install, or add a Milo start page/home page widget, including requests written as 起始页小组件 or 首页小组件. "
        + "The widget-builder agent can create package widgets, add them to the Milo start page, and wire scheduled refreshes to widget-side browser automation APIs.",
      parameters: {
        type: "object",
        properties: {
          instruction: {
            type: "string",
            description:
              "The full start-page widget request. Include desired UI, webpage automation target, extraction target, refresh cadence, and whether to add the widget to the start page immediately.",
          },
        },
        required: ["instruction"],
        additionalProperties: false,
      },
      execute: (input, session) => runStartPageWidgetBuilderSubAgent(input, session),
    });
  }
  localTools.push({
    name: USER_SCRIPT_DRAFT_TOOL_NAME,
    description:
      "Delegate user-script authoring, revision, and test-writing to the dedicated user-script sub-agent. "
      + "Use this when the user asks to write, modify, review, or test a reusable user script for the current page. "
      + "User scripts are only allowed for normal http/https web pages, not Milo internal pages such as milo://home or milo://settings, and not Milo start page widgets or widget://package UI. "
      + "For layout, redesign, component replacement, or full-page replacement tasks, the sub-agent can author MiloUserScript WebComponents with built-in Tailwind utility styling. "
      + "The sub-agent returns JavaScript code, match patterns, optional excludes, testCode, and notes.",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["script", "test", "script-and-test"],
          description: "What the sub-agent should produce. Defaults to script-and-test.",
        },
        instruction: {
          type: "string",
          description:
            "The concrete user-script requirement. Include DOM behavior, expected UI/layout changes, replacement target selectors, whether to replace a component or the whole page, and any constraints.",
        },
        targetUrl: {
          type: "string",
          description:
            "Optional page URL. Defaults to the current active tab URL in this agent session.",
        },
        pageTitle: {
          type: "string",
          description:
            "Optional page title. Defaults to the current active tab title in this agent session.",
        },
        existingScript: {
          type: "object",
          description: "Optional existing script to revise or write tests for.",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            matches: {
              type: "array",
              items: { type: "string" },
            },
            excludes: {
              type: "array",
              items: { type: "string" },
            },
            code: { type: "string" },
            testCode: { type: "string" },
          },
          additionalProperties: false,
        },
        install: {
          type: "boolean",
          description:
            "When true, save the generated draft into the current workspace profile's user-script library.",
        },
        scriptId: {
          type: "string",
          description: "Optional existing user-script id to update when install is true.",
        },
        enabled: {
          type: "boolean",
          description: "Whether the installed script should be enabled. Defaults to true.",
        },
        runNow: {
          type: "boolean",
          description:
            "When true with install, run the installed script immediately on the current page tab.",
        },
        runTest: {
          type: "boolean",
          description:
            "When true with install, run the installed script's test code immediately on the current page tab.",
        },
      },
      required: ["instruction"],
      additionalProperties: false,
    },
    execute: (input, session) => runUserScriptDraftSubAgent(input, session),
  });
  localTools.push({
    name: USER_SCRIPT_INSTALL_TOOL_NAME,
    description:
      "Install or update a user script in the current workspace profile and optionally run it on the current page. "
      + "Use this instead of browser automation when the user asks to install, save, enable, apply, or immediately run a generated user script.",
    parameters: {
      type: "object",
      properties: {
        scriptId: {
          type: "string",
          description: "Existing user-script id to update. Omit to create a new script.",
        },
        name: { type: "string" },
        description: { type: "string" },
        enabled: {
          type: "boolean",
          description: "Whether the script should be enabled. Defaults to true.",
        },
        matches: {
          type: "array",
          items: { type: "string" },
          description: "URL match patterns, for example https://news.ycombinator.com/*.",
        },
        excludes: {
          type: "array",
          items: { type: "string" },
        },
        code: {
          type: "string",
          description: "JavaScript user-script code. Required when creating a new script.",
        },
        testCode: {
          type: "string",
          description: "Optional JavaScript test code for the script.",
        },
        runNow: {
          type: "boolean",
          description: "Run the script immediately on the current page after saving.",
        },
        runTest: {
          type: "boolean",
          description: "Run the script's test code immediately on the current page after saving.",
        },
      },
      additionalProperties: false,
    },
    execute: (input, session) => runUserScriptInstallTool(input, session),
  });
  localTools.push({
    name: USER_SCRIPT_CURRENT_PAGE_LIST_TOOL_NAME,
    description:
      "List enabled user scripts in the current workspace profile that match the current page URL. "
      + "Use this when the user asks which user scripts are active, enabled, applicable, or will automatically run on the current page.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Optional URL to check. Defaults to the current active tab URL in this agent session.",
        },
      },
      additionalProperties: false,
    },
    execute: (input, session) => runCurrentPageUserScriptsListTool(input, session),
  });
  localTools.push({
    name: BOOKMARK_ORGANIZER_TOOL_NAME,
    description:
      "Delegate bookmark cleanup and organization to the dedicated bookmark organizer sub-agent. "
      + "Use this when the user asks to organize, classify, regroup, tidy, or sort bookmarks. "
      + "If folderId, folderPath, or folderName is provided, only that bookmark folder and its descendants are reorganized; otherwise all bookmarks are in scope.",
    parameters: {
      type: "object",
      properties: {
        instruction: {
          type: "string",
          description: "Bookmark organization request. Defaults to the latest user message.",
        },
        folderId: {
          type: "string",
          description: "Optional exact bookmark folder id to limit organization to.",
        },
        folderPath: {
          type: "string",
          description: "Optional exact bookmark folder path, such as Work / Research, to limit organization to.",
        },
        folderName: {
          type: "string",
          description: "Optional bookmark folder name to limit organization to. Use folderPath or folderId if names may be duplicated.",
        },
      },
      additionalProperties: false,
    },
    execute: (input, session) => runBookmarkOrganizerSubAgent(input, session),
  });
  localTools.push({
    name: HISTORY_SEARCH_TOOL_NAME,
    description:
      "Search or read the user's local browsing history for this workspace profile. "
      + "Results include hidden navigation metadata showing when a page was opened from another page, so use this for questions about recent research, browsing trails, source pages, or what the user has been studying. "
      + "Do not use this to discover currently open tabs or the contents of a tab folder/directory/group; use browser_context_get for that.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Optional keyword, product name, domain, or topic. Matches page title, URL, domain, and hidden opened-from metadata.",
        },
        sinceDays: {
          type: "number",
          description: "Optional recent-time filter in days, for example 7 for the last week.",
          minimum: 0,
        },
        limit: {
          type: "number",
          description: "Maximum number of history records to return.",
          minimum: 1,
          maximum: 300,
        },
        includeMetadata: {
          type: "boolean",
          description: "Whether to include openedFrom metadata. Defaults to true.",
        },
      },
      additionalProperties: false,
    },
    execute: (input, session) => buildHistorySearchPayload(input, session),
  });
  localTools.push({
    name: ORGANIZER_SNAPSHOT_TOOL_NAME,
    description:
      "Read the current source browser window organization state, including tab sidebar groups, bookmarks, and downloads. "
      + "Use this at the start of local browser cleanup or organization tasks.",
    parameters: {
      type: "object",
      properties: {
        scopes: {
          type: "array",
          items: {
            type: "string",
            enum: ["tabs", "bookmarks", "downloads"],
          },
          description: "Optional subset of sections to return.",
        },
        limit: {
          type: "number",
          description: "Maximum number of items to include per section.",
        },
      },
      additionalProperties: false,
    },
    execute: (input, session) => buildOrganizerSnapshot(input, session),
  });
  localTools.push({
    name: ORGANIZER_TABS_TOOL_NAME,
    description:
      "Organize the source browser window's tab sidebar state by sorting root tabs, creating tab groups, moving tabs into groups, renaming groups, or ungrouping them.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "sort_root_tabs",
            "create_group",
            "group_root_tabs_by_domain",
            "move_tabs_to_group",
            "ungroup",
            "rename_group",
          ],
        },
        strategy: {
          type: "string",
          enum: ["title", "domain", "url"],
          description: "Sorting strategy for sort_root_tabs.",
        },
        direction: {
          type: "string",
          enum: ["asc", "desc"],
          description: "Sorting direction for sort_root_tabs.",
        },
        name: {
          type: "string",
          description: "Group name for create_group or rename_group.",
        },
        icon: {
          type: ["string", "null"],
          description: "Optional group icon for create_group or rename_group.",
        },
        backgroundColor: {
          type: ["string", "null"],
          description: "Optional hex background color for create_group or rename_group, such as #2563eb.",
        },
        tabIds: {
          type: "array",
          items: {
            type: "string",
          },
          description: "Target tab ids for create_group or move_tabs_to_group.",
        },
        folderId: {
          type: "string",
          description: "Target group id for move_tabs_to_group or rename_group.",
        },
        folderIds: {
          type: "array",
          items: {
            type: "string",
          },
          description: "Optional explicit groups to ungroup. Omit to ungroup all groups.",
        },
        minGroupSize: {
          type: "number",
          description: "Minimum root-tab count required before group_root_tabs_by_domain creates a group.",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    execute: (input, session) => runOrganizerTabsTool(input, session),
  });
  localTools.push({
    name: ORGANIZER_BOOKMARKS_TOOL_NAME,
    description:
      "Organize bookmark folders and bookmark placement in the source profile. "
      + "Use this to create folders, rename or move folders, move bookmarks, or group root bookmarks by domain.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "create_folder",
            "update_folder",
            "move_bookmarks",
            "group_root_bookmarks_by_domain",
          ],
        },
        name: {
          type: "string",
          description: "Folder name for create_folder or update_folder.",
        },
        parentId: {
          type: ["string", "null"],
          description: "Optional parent folder id for create_folder or update_folder.",
        },
        folderId: {
          type: ["string", "null"],
          description: "Target folder id for update_folder or move_bookmarks. Use null to move bookmarks to the root.",
        },
        bookmarkIds: {
          type: "array",
          items: {
            type: "string",
          },
          description: "Bookmark ids for move_bookmarks.",
        },
        minGroupSize: {
          type: "number",
          description: "Minimum root-bookmark count required before group_root_bookmarks_by_domain creates a domain folder.",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    execute: (input, session) => runOrganizerBookmarksTool(input, session),
  });
  localTools.push({
    name: ORGANIZER_DOWNLOADS_TOOL_NAME,
    description:
      "Organize download records by cleanup status or operational state. "
      + "Use this to bulk remove, delete files, pause, resume, cancel, or retry downloads.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["remove_records", "delete_files", "pause", "resume", "cancel", "retry"],
        },
        downloadIds: {
          type: "array",
          items: {
            type: "string",
          },
          description: "Explicit download ids to target.",
        },
        statuses: {
          type: "array",
          items: {
            type: "string",
            enum: ["pending", "running", "paused", "completed", "failed", "canceled"],
          },
          description: "Optional status filter when downloadIds are not provided.",
        },
        olderThanDays: {
          type: "number",
          description: "Optional minimum age filter in days when downloadIds are not provided.",
        },
        deleteFile: {
          type: "boolean",
          description: "When removing records, also delete the file from disk.",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    execute: (input) => runOrganizerDownloadsTool(input),
  });
  if (hasStartPageWidgetPackageTools) {
    localTools.push({
      name: START_PAGE_WIDGET_DOCS_READ_TOOL_NAME,
      description:
        "Read the current Milo start page widget authoring documentation. "
        + "Use this before creating or updating package widget files, especially for refresh scheduling and exact window.milo.browser automation API schemas.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: () => ({
        ok: true,
        docs: readStartPageWidgetDocs(),
      }),
    });
    localTools.push({
      name: START_PAGE_WIDGETS_LIST_TOOL_NAME,
      description:
        "List the local Milo start page widget registry root and installed widget packages. "
        + "Use this before creating a new widget package to avoid id collisions or to choose an existing package to update.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: () => {
        const packages = options.listWidgetPackages!();
        return {
          ok: true,
          rootPath: options.getWidgetRegistryRootDirectory!(),
          packageCount: packages.length,
          packages: packages.map((widgetPackage) => buildWidgetPackageSummaryPayload(widgetPackage)),
        };
      },
    });
    localTools.push({
      name: START_PAGE_WIDGET_PACKAGE_READ_TOOL_NAME,
      description:
        "Read an installed start page widget package, including its manifest and text files such as HTML, CSS, JS, JSON, and SVG. "
        + "Use this before updating an existing package.",
      parameters: {
        type: "object",
        properties: {
          packageId: {
            type: "string",
            description: "Installed widget package id to read.",
          },
        },
        required: ["packageId"],
        additionalProperties: false,
      },
      execute: (input) => {
        const packageId = readString(input.packageId);
        if (!packageId) {
          throw new Error(`${START_PAGE_WIDGET_PACKAGE_READ_TOOL_NAME} requires a non-empty packageId.`);
        }

        const widgetPackageSource = options.getWidgetPackageSource!(packageId);
        if (!widgetPackageSource) {
          throw new Error(`Widget package "${packageId}" was not found.`);
        }

        return {
          ok: true,
          rootPath: options.getWidgetRegistryRootDirectory!(),
          source: `widget://package/${widgetPackageSource.package.id}`,
          widgetPackage: buildWidgetPackageSourcePayload(widgetPackageSource),
        };
      },
    });
    localTools.push({
      name: START_PAGE_WIDGET_PACKAGE_FILES_LIST_TOOL_NAME,
      description:
        "List readable text files inside an installed start page widget package. "
        + "Use this before editing an existing package so you can inspect its structure without reading every file body.",
      parameters: {
        type: "object",
        properties: {
          packageId: {
            type: "string",
            description: "Installed widget package id to inspect.",
          },
        },
        required: ["packageId"],
        additionalProperties: false,
      },
      execute: (input) => {
        const widgetPackageSource = getWidgetPackageSourceForTool(
          input.packageId,
          START_PAGE_WIDGET_PACKAGE_FILES_LIST_TOOL_NAME,
        );
        const files = listWidgetPackageToolFiles(widgetPackageSource);
        return {
          ok: true,
          rootPath: options.getWidgetRegistryRootDirectory!(),
          source: `widget://package/${widgetPackageSource.package.id}`,
          package: buildWidgetPackageSummaryPayload(widgetPackageSource.package),
          fileCount: files.length,
          files: files.map((file) => buildWidgetPackageFileMetadata(file)),
        };
      },
    });
    localTools.push({
      name: START_PAGE_WIDGET_PACKAGE_FILES_READ_TOOL_NAME,
      description:
        "Read selected text files from an installed start page widget package. "
        + "Paths are package-relative, for example index.html, widget.css, widget.js, or widget.json. "
        + "Omit paths only when you intentionally need every readable text file.",
      parameters: {
        type: "object",
        properties: {
          packageId: {
            type: "string",
            description: "Installed widget package id to read.",
          },
          paths: {
            type: "array",
            items: { type: "string" },
            description: "Optional package-relative text file paths. Omit to read all readable text files.",
          },
        },
        required: ["packageId"],
        additionalProperties: false,
      },
      execute: (input) => {
        const widgetPackageSource = getWidgetPackageSourceForTool(
          input.packageId,
          START_PAGE_WIDGET_PACKAGE_FILES_READ_TOOL_NAME,
        );
        const requestedPaths = readWidgetPackageToolFilePaths(input.paths);
        const { files, missingPaths } = findWidgetPackageToolFiles(widgetPackageSource, requestedPaths);
        return {
          ok: true,
          rootPath: options.getWidgetRegistryRootDirectory!(),
          source: `widget://package/${widgetPackageSource.package.id}`,
          package: buildWidgetPackageSummaryPayload(widgetPackageSource.package),
          requestedPaths,
          missingPaths,
          fileCount: files.length,
          files: files.map((file) => ({
            path: file.path,
            content: file.content,
          })),
        };
      },
    });
    localTools.push({
      name: START_PAGE_WIDGET_PACKAGE_FILES_SEARCH_TOOL_NAME,
      description:
        "Search readable text files inside an installed start page widget package. "
        + "Use this to locate code, selectors, labels, API calls, or styles before making targeted edits.",
      parameters: {
        type: "object",
        properties: {
          packageId: {
            type: "string",
            description: "Installed widget package id to search.",
          },
          query: {
            type: "string",
            description: "Plain text to search for.",
          },
          paths: {
            type: "array",
            items: { type: "string" },
            description: "Optional package-relative paths to limit the search.",
          },
          caseSensitive: {
            type: "boolean",
            description: "Whether matching should be case-sensitive. Defaults to false.",
          },
          maxMatches: {
            type: "number",
            description: "Maximum matches to return. Defaults to 50 and caps at 200.",
          },
        },
        required: ["packageId", "query"],
        additionalProperties: false,
      },
      execute: (input) => {
        const widgetPackageSource = getWidgetPackageSourceForTool(
          input.packageId,
          START_PAGE_WIDGET_PACKAGE_FILES_SEARCH_TOOL_NAME,
        );
        const query = readString(input.query);
        if (!query) {
          throw new Error(`${START_PAGE_WIDGET_PACKAGE_FILES_SEARCH_TOOL_NAME} requires a non-empty query.`);
        }
        const requestedPaths = readWidgetPackageToolFilePaths(input.paths);
        const { files, missingPaths } = findWidgetPackageToolFiles(widgetPackageSource, requestedPaths);
        const caseSensitive = readBoolean(input.caseSensitive) === true;
        const maxMatches = Math.min(
          WIDGET_PACKAGE_SEARCH_MAX_LIMIT,
          Math.max(1, Math.floor(readNumber(input.maxMatches) ?? WIDGET_PACKAGE_SEARCH_DEFAULT_LIMIT)),
        );
        const needle = caseSensitive ? query : query.toLowerCase();
        const matches: Array<{
          column: number;
          line: number;
          path: string;
          preview: string;
        }> = [];

        for (const file of files) {
          const lines = file.content.split(/\r\n|\r|\n/);
          for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index] ?? "";
            const haystack = caseSensitive ? line : line.toLowerCase();
            const column = haystack.indexOf(needle);
            if (column === -1) {
              continue;
            }
            matches.push({
              path: file.path,
              line: index + 1,
              column: column + 1,
              preview: line.trim().slice(0, 300),
            });
            if (matches.length >= maxMatches) {
              break;
            }
          }
          if (matches.length >= maxMatches) {
            break;
          }
        }

        return {
          ok: true,
          source: `widget://package/${widgetPackageSource.package.id}`,
          package: buildWidgetPackageSummaryPayload(widgetPackageSource.package),
          query,
          caseSensitive,
          searchedFileCount: files.length,
          missingPaths,
          matchCount: matches.length,
          truncated: matches.length >= maxMatches,
          matches,
        };
      },
    });
    localTools.push({
      name: START_PAGE_WIDGET_PACKAGE_FILES_EDIT_TOOL_NAME,
      description:
        "Edit an existing start page widget package without recreating it. "
        + "Supports exact text replacements, full file writes, file deletes, and manifest updates. "
        + "Read or search the relevant files first, then use this for targeted fixes.",
      parameters: {
        type: "object",
        properties: {
          packageId: {
            type: "string",
            description: "Installed widget package id to edit.",
          },
          manifest: {
            type: "object",
            description: "Optional full replacement widget manifest. Omit to keep the current manifest.",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              version: { type: "string" },
              entry: { type: "string" },
              description: { type: "string" },
              defaultTitle: { type: "string" },
              defaultSize: {
                type: "object",
                properties: {
                  w: { type: "number" },
                  h: { type: "number" },
                },
                additionalProperties: false,
              },
              permissions: {
                type: "object",
                properties: {
                  network: { type: "boolean" },
                  openExternal: { type: "boolean" },
                },
                additionalProperties: false,
              },
            },
            required: ["id", "name", "version", "entry"],
            additionalProperties: false,
          },
          replacements: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                oldText: { type: "string" },
                newText: { type: "string" },
                replaceAll: { type: "boolean" },
              },
              required: ["path", "oldText", "newText"],
              additionalProperties: false,
            },
            description: "Exact text replacements to apply to existing package files.",
          },
          writes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                content: { type: "string" },
              },
              required: ["path", "content"],
              additionalProperties: false,
            },
            description: "Full text file contents to create or overwrite.",
          },
          deletePaths: {
            type: "array",
            items: { type: "string" },
            description: "Package-relative file paths to delete. Do not include widget.json.",
          },
        },
        required: ["packageId"],
        additionalProperties: false,
      },
      execute: (input) => {
        const widgetPackageSource = getWidgetPackageSourceForTool(
          input.packageId,
          START_PAGE_WIDGET_PACKAGE_FILES_EDIT_TOOL_NAME,
        );
        const nextManifest = input.manifest === undefined
          ? widgetPackageSource.manifest
          : readWidgetPackageManifestInput(input.manifest);
        if (!nextManifest) {
          throw new Error(`${START_PAGE_WIDGET_PACKAGE_FILES_EDIT_TOOL_NAME} requires a valid manifest when manifest is provided.`);
        }
        if (nextManifest.id !== widgetPackageSource.package.id) {
          throw new Error("Widget file edits cannot rename a package id. Create a new package instead.");
        }

        const replacements = readWidgetPackageReplacementInputs(input.replacements);
        const writes = readWidgetPackageFileInputs(input.writes);
        const deletePaths = readWidgetPackageToolFilePaths(input.deletePaths);
        const manifestUpdated = input.manifest !== undefined;
        if (!manifestUpdated && replacements.length === 0 && writes.length === 0 && deletePaths.length === 0) {
          throw new Error(`${START_PAGE_WIDGET_PACKAGE_FILES_EDIT_TOOL_NAME} requires manifest, replacements, writes, or deletePaths.`);
        }

        const existingTextFiles = new Map(widgetPackageSource.files.map((file) => [file.path, file.content]));
        const finalFileContents = new Map(existingTextFiles);
        for (const deletePath of deletePaths) {
          finalFileContents.delete(deletePath);
        }
        const nextFileContents = new Map<string, string>();
        for (const replacement of replacements) {
          const currentContent = finalFileContents.get(replacement.path);
          if (currentContent === undefined) {
            throw new Error(`Widget file "${replacement.path}" was not found.`);
          }
          const nextContent = replacement.replaceAll
            ? currentContent.split(replacement.oldText).join(replacement.newText)
            : currentContent.replace(replacement.oldText, replacement.newText);
          if (nextContent === currentContent) {
            throw new Error(`Text to replace was not found in "${replacement.path}".`);
          }
          nextFileContents.set(replacement.path, nextContent);
          finalFileContents.set(replacement.path, nextContent);
        }

        for (const file of writes) {
          if (file.path === "widget.json") {
            throw new Error("Widget file writes must not include widget.json. Pass manifest updates through manifest instead.");
          }
          nextFileContents.set(file.path, file.content);
          finalFileContents.set(file.path, file.content);
        }

        const files = Array.from(nextFileContents.entries()).map(([path, content]) => ({
          path,
          content,
        } satisfies WidgetPackageFileRecord));
        const validation = validateWidgetPackageAutomationUsage(
          Array.from(finalFileContents.entries()).map(([path, content]) => ({
            path,
            content,
          } satisfies WidgetPackageFileRecord)),
        );
        if (!validation.ok) {
          throw new Error(`Widget package validation failed before save:\n${formatWidgetPackageValidationErrors(validation)}`);
        }
        const savedWidgetPackage = options.saveWidgetPackageSource!({
          deletePaths,
          files,
          manifest: nextManifest,
          replace: false,
        });

        return {
          ok: true,
          action: "updated",
          rootPath: options.getWidgetRegistryRootDirectory!(),
          source: `widget://package/${savedWidgetPackage.package.id}`,
          package: buildWidgetPackageSummaryPayload(savedWidgetPackage.package),
          manifestUpdated,
          changedPaths: files.map((file) => file.path),
          deletedPaths: deletePaths,
          validation,
        };
      },
    });
    localTools.push({
      name: START_PAGE_WIDGET_PACKAGE_SAVE_TOOL_NAME,
      description:
        "Create or update a local Milo start page widget package from manifest and file contents. "
        + "Return the installed package summary plus widget://package/<id> source. "
        + "Do not include widget.json in files; pass it through manifest instead. "
        + "Set manifest.defaultSize thoughtfully because Milo uses it as the initial widget size when adding widget://package/<id> to the start page.",
      parameters: {
        type: "object",
        properties: {
          manifest: {
            type: "object",
            properties: {
              id: {
                type: "string",
              },
              name: {
                type: "string",
              },
              version: {
                type: "string",
              },
              entry: {
                type: "string",
              },
              description: {
                type: "string",
              },
              defaultTitle: {
                type: "string",
              },
              defaultSize: {
                type: "object",
                description:
                  "Preferred initial widget footprint on the start page grid. Choose a size that matches the widget's density and layout.",
                properties: {
                  w: {
                    type: "number",
                    description: "Preferred widget width in grid columns, typically between 2 and 12.",
                  },
                  h: {
                    type: "number",
                    description: "Preferred widget height in grid rows, typically between 2 and 12.",
                  },
                },
                additionalProperties: false,
              },
              permissions: {
                type: "object",
                properties: {
                  network: {
                    type: "boolean",
                  },
                  openExternal: {
                    type: "boolean",
                  },
                },
                additionalProperties: false,
              },
            },
            required: ["id", "name", "version", "entry"],
            additionalProperties: false,
          },
          files: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: {
                  type: "string",
                },
                content: {
                  type: "string",
                },
              },
              required: ["path", "content"],
              additionalProperties: false,
            },
            minItems: 1,
          },
          replace: {
            type: "boolean",
            description:
              "When true, replace the existing package directory contents with only the provided files. "
              + "Use this for a clean rewrite when you are providing the full package.",
          },
        },
        required: ["manifest", "files"],
        additionalProperties: false,
      },
      execute: (input) => {
        const manifest = readWidgetPackageManifestInput(input.manifest);
        if (!manifest) {
          throw new Error(`${START_PAGE_WIDGET_PACKAGE_SAVE_TOOL_NAME} requires a valid manifest object.`);
        }

        const files = readWidgetPackageFileInputs(input.files);
        if (files.length === 0) {
          throw new Error(`${START_PAGE_WIDGET_PACKAGE_SAVE_TOOL_NAME} requires at least one file.`);
        }

        const replace = readBoolean(input.replace) === true;
        const existingPackage = options.getWidgetPackageSource!(manifest.id);
        const finalFileContents = new Map<string, string>();
        if (!replace && existingPackage) {
          for (const file of existingPackage.files) {
            finalFileContents.set(file.path, file.content);
          }
        }
        for (const file of files) {
          finalFileContents.set(file.path, file.content);
        }
        const validation = validateWidgetPackageAutomationUsage(
          Array.from(finalFileContents.entries()).map(([path, content]) => ({
            path,
            content,
          } satisfies WidgetPackageFileRecord)),
        );
        if (!validation.ok) {
          throw new Error(`Widget package validation failed before save:\n${formatWidgetPackageValidationErrors(validation)}`);
        }
        const savedWidgetPackage = options.saveWidgetPackageSource!({
          manifest,
          files,
          replace,
        });

        return {
          ok: true,
          action: existingPackage ? "updated" : "created",
          rootPath: options.getWidgetRegistryRootDirectory!(),
          source: `widget://package/${savedWidgetPackage.package.id}`,
          widgetPackage: buildWidgetPackageSourcePayload(savedWidgetPackage),
          validation,
        };
      },
    });
  }
  if (options.getStartPageWidgetsState) {
    localTools.push({
      name: START_PAGE_CURRENT_WIDGETS_LIST_TOOL_NAME,
      description:
        "List the widgets currently placed on the Milo start page for the source browser window workspace. "
        + "Use this to inspect the current start page layout, find existing protocol widget sources, or avoid duplicates before adding another widget.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: (_input, session) => {
        const widgetsState = options.getStartPageWidgetsState!(session.originWorkspaceId);
        const items = widgetsState.items.map((widget) => buildStartPageWidgetPayload(widget));
        return {
          ok: true,
          workspaceId: session.originWorkspaceId,
          executionWorkspaceId: session.workspaceId,
          migrated: widgetsState.migrated,
          widgetCount: items.length,
          countsByType: items.reduce<Record<string, number>>((counts, widget) => {
            counts[widget.type] = (counts[widget.type] ?? 0) + 1;
            return counts;
          }, {}),
          items,
        };
      },
    });
  }
  localTools.push({
    name: START_PAGE_WIDGET_ADD_TOOL_NAME,
    description:
      "Add a protocol widget source such as widget://package/<id> to the Milo start page in the source browser window. "
      + "Use this after creating or updating a widget package when the user wants it placed on the start page immediately.",
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Protocol widget source to add to the start page, usually widget://package/<id>.",
        },
        title: {
          type: "string",
          description: "Optional custom widget title to show on the start page card.",
        },
        skipIfExists: {
          type: "boolean",
          description:
            "When true, skip inserting a duplicate when the same protocol source already exists on the start page. Defaults to true.",
        },
      },
      required: ["source"],
      additionalProperties: false,
    },
    execute: (input, session) => {
      const source = readString(input.source);
      if (!source) {
        throw new Error(`${START_PAGE_WIDGET_ADD_TOOL_NAME} requires a non-empty source.`);
      }
      if (!source.toLowerCase().startsWith("widget://")) {
        throw new Error(`${START_PAGE_WIDGET_ADD_TOOL_NAME} requires a widget:// protocol source.`);
      }

      const title = readString(input.title)?.trim() || undefined;
      const skipIfExists = readBoolean(input.skipIfExists) !== false;
      if (options.addStartPageProtocolWidget) {
        const result = options.addStartPageProtocolWidget({
          workspaceId: session.originWorkspaceId,
          source,
          ...(title ? { title } : {}),
          skipIfExists,
        });

        return {
          ok: true,
          added: result.added,
          requested: false,
          source,
          widgetId: result.widgetId,
          workspaceId: session.originWorkspaceId,
          executionWorkspaceId: session.workspaceId,
          windowId: session.originWindowId,
          migrated: result.widgetsState.migrated,
          skipIfExists,
          ...(title ? { title } : {}),
        };
      }

      const target = resolveStartPageTargetContext(session);

      target.targetContents.send("start-page:add-protocol-widget-requested", {
        source,
        ...(title ? { title } : {}),
        skipIfExists,
      });

      return {
        ok: true,
        requested: true,
        source,
        startPageUrl: target.startPageUrl,
        tabId: target.tabId,
        windowId: target.windowId,
        skipIfExists,
        ...(title ? { title } : {}),
      };
    },
  });
  localTools.push({
    name: ASK_HUMAN_HELP_TOOL_NAME,
    description: ASK_HUMAN_HELP_TOOL_DESCRIPTION,
    parameters: ASK_HUMAN_HELP_TOOL_PARAMETERS,
    execute: (input, session) => requestManualInterventionForSession(session, input),
  });
  localTools.push({
    name: DATA_EXTRACTION_TOOL_NAME,
    description:
      "Delegate complex page reading and data extraction to a specialized extraction sub-agent. "
      + "Prefer using this after you have confirmed the current page likely contains the target data, but it can also inspect the page and return a blocked result with recovery guidance when extraction cannot proceed.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "What data to extract from the current page.",
        },
        pageConfirmation: {
          type: "object",
          description:
            "Optional current-page hint from the main agent. "
            + "Quote short visible snippets when available to help the extraction sub-agent start faster.",
          properties: {
            summary: {
              type: "string",
              description: "Why the current page likely contains the target data needed for extraction.",
            },
            observedTexts: {
              type: "array",
              description: "One to three short visible text snippets from the current page that likely prove the data is present.",
              items: {
                type: "string",
              },
              minItems: 1,
              maxItems: EXTRACTION_CONFIRMATION_MAX_OBSERVED_TEXTS,
            },
          },
          required: ["summary", "observedTexts"],
          additionalProperties: false,
        },
        browserSessionId: {
          type: "string",
          description: "Optional previously attached browser session to target.",
        },
        tabId: {
          type: "string",
          description: "Optional tab id fallback when no browser session is attached yet.",
        },
        mode: {
          type: "string",
          enum: ["auto", "records", "text", "images"],
          description: "Preferred extraction mode.",
        },
        minRecords: {
          type: "number",
          description: "Minimum desired record count when extracting repeated records.",
        },
        maxRecords: {
          type: "number",
          description: "Maximum desired record count when extracting repeated records.",
        },
        recordSchema: {
          type: "object",
          additionalProperties: true,
          description: "Optional object schema describing desired record fields.",
        },
        allowInteraction: {
          type: "boolean",
          description: "Whether the extraction sub-agent may use limited reveal interactions like load more, pagination, or scroll.",
          default: true,
        },
      },
      required: ["task"],
      additionalProperties: false,
    },
    execute: (input, session) => runExtractionSubAgent(input, session),
  });
  localTools.push({
    name: TASK_TOOL_NAME,
    description:
      "Run one or more delegated browser subtasks on isolated automation tabs inside the current automation workspace. "
      + "Use this for any bounded delegated browser work that should not disturb the main agent's working tab, including a single side quest or multiple independent branches. "
      + "This tool does not return until every delegated subtask from the call has finished. "
      + "Choose conflictPolicy carefully: host_serialized is the safe default for same-site flows, independent is for truly separate branches, and exclusive blocks every other delegated task in the session.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Single bounded delegated task for one child agent.",
        },
        tasks: {
          type: "array",
          description: "Optional batch of bounded delegated tasks to run before the main agent continues. Use this for parallel independent branches.",
          items: {
            type: "object",
            properties: {
              task: {
                type: "string",
                description: "Bounded delegated task for one child agent.",
              },
              startUrl: {
                type: "string",
                description: "Optional URL to open in the delegated task tab before it starts reasoning.",
              },
              conflictPolicy: {
                type: "string",
                enum: ["independent", "host_serialized", "exclusive"],
                description: "How this task should be scheduled relative to other delegated tasks.",
              },
              resourceKey: {
                type: "string",
                description: "Optional scheduler scope key. Use this to serialize tasks that act on the same site, account, or workflow branch.",
              },
            },
            required: ["task"],
            additionalProperties: false,
          },
        },
        startUrl: {
          type: "string",
          description: "Optional URL to open in the delegated task tab before it starts reasoning.",
        },
        conflictPolicy: {
          type: "string",
          enum: ["independent", "host_serialized", "exclusive"],
          description: "How this task should be scheduled relative to other delegated tasks.",
        },
        resourceKey: {
          type: "string",
          description: "Optional scheduler scope key. Use this to serialize tasks that act on the same site, account, or workflow branch.",
        },
      },
      additionalProperties: false,
    },
    execute: async (input, session, context) => {
      const taskInputs = parseDelegatedTaskBatch(input);
      const tasks = taskInputs.map((taskInput) => createDelegatedTaskState(session, taskInput));

      for (const task of tasks) {
        if (context?.uiMessageId) {
          task.uiMessageId = context.uiMessageId;
        }
        session.delegatedTasks.set(task.taskId, task);
      }
      emitDelegatedTaskUpdate(session);
      scheduleDelegatedTasks(session);
      return waitForDelegatedTasks(
        session,
        tasks,
        session.activeAbortController?.signal,
      );
    },
  });
  if (options.searchLearningGuidance && options.getLearningGuidanceDetail) {
    localTools.push({
      name: LEARNING_GUIDANCE_TOOL_NAME,
      description:
        "Search previously learned browser workflow strategies for the current workspace, "
        + "including layered action strategies, site skills, history-based browsing patterns, "
        + "and any available style/preference profiles, "
        + "or load full details for a specific guidanceId. "
        + "If guidanceId is provided, it returns the full learned action strategy plus related site skills and feedback. "
        + "If omitted, it searches by query, domain, and page context. "
        + "You can call it with an empty object to retrieve the most relevant learned assets for the current tab and task. "
        + "Prefer using this as an early step when working on a real site workflow that may have been seen before.",
      parameters: {
        type: "object",
        properties: {
          guidanceId: {
            type: "string",
            description: "Exact guidance ID to open in full detail.",
          },
          query: {
            type: "string",
            description: "Task description or keywords used to search learned guidance.",
          },
          domain: {
            type: "string",
            description: "Optional site/domain filter such as example.com.",
          },
          activeUrl: {
            type: "string",
            description: "Optional page URL to match page-specific learned guidance. Defaults to the active tab URL.",
          },
          limit: {
            type: "number",
            description: "Maximum number of search matches to return when guidanceId is omitted.",
            minimum: 1,
            maximum: 10,
          },
        },
        additionalProperties: false,
      },
      execute: (input, session) => {
        const { windowContext, activeTab } = resolveSessionTabContext(session);
        const guidanceId = readString(input.guidanceId);
        if (guidanceId) {
          const guidance = options.getLearningGuidanceDetail?.({
            workspaceId: session.originWorkspaceId,
            guidanceId,
          }) ?? null;
          return guidance
            ? {
                ok: true,
                mode: "view",
                guidance,
              }
            : {
                ok: false,
                mode: "view",
                error: `No learned guidance with id "${guidanceId}" exists in source workspace ${session.originWorkspaceId}.`,
              };
        }

        const limitValue = readNumber(input.limit);
        const normalizedLimit = limitValue !== undefined
          ? Math.max(1, Math.min(10, Math.floor(limitValue)))
          : undefined;
        const query = readString(input.query) ?? getLatestUserTaskText(session);
        const domain = readString(input.domain);
        const activeUrl = readString(input.activeUrl) ?? activeTab?.url ?? windowContext.activeUrl;
        const result = options.searchLearningGuidance?.({
          workspaceId: session.originWorkspaceId,
          ...(activeUrl ? { activeUrl } : {}),
          ...(query ? { query } : {}),
          ...(domain ? { domain } : {}),
          ...(normalizedLimit !== undefined ? { limit: normalizedLimit } : {}),
        }) ?? {
          guidanceCount: 0,
          matches: [],
          actionStrategyCount: 0,
          siteSkillCount: 0,
          feedbackCount: 0,
          actionStrategies: [],
          siteSkills: [],
        };

        return {
          ok: true,
          mode: "search",
          workspaceId: session.originWorkspaceId,
          executionWorkspaceId: session.workspaceId,
          ...(activeUrl ? { activeUrl } : {}),
          ...(query ? { query } : {}),
          ...(domain ? { domain } : {}),
          ...result,
        };
      },
    });
  }
  const localToolsByName = new Map(localTools.map((tool) => [tool.name, tool]));

  function resolveLocalToolNamesForAgent(agentId: SessionAgentId) {
    const names = new Set<string>([
      BROWSER_CONTEXT_TOOL_NAME,
      BROWSER_RUNTIME_TOOL_NAME,
      SOURCE_WORKSPACE_CONTEXT_TOOL_NAME,
      SOURCE_TAB_SNAPSHOT_TOOL_NAME,
      SOURCE_TAB_EXTRACT_TOOL_NAME,
      SOURCE_TAB_CLONE_TOOL_NAME,
      TIME_TOOL_NAME,
      AGENT_PLAN_TOOL_NAME,
      SESSION_SCHEDULE_TOOL_NAME,
      AGENT_LAUNCH_SCHEDULE_TOOL_NAME,
      EVENT_TRIGGER_TOOL_NAME,
      ASK_HUMAN_HELP_TOOL_NAME,
      LEARNING_GUIDANCE_TOOL_NAME,
    ]);

    if (agentId === ORGANIZER_BROWSER_AGENT_ID) {
      [
        ORGANIZER_SNAPSHOT_TOOL_NAME,
        ORGANIZER_TABS_TOOL_NAME,
        ORGANIZER_BOOKMARKS_TOOL_NAME,
        ORGANIZER_DOWNLOADS_TOOL_NAME,
      ].forEach((name) => names.add(name));
      return names;
    }

    if (agentId === WIDGET_BUILDER_BROWSER_AGENT_ID) {
      [
        ELEMENT_SCREENSHOT_TOOL_NAME,
        IMAGE_RECOGNITION_TOOL_NAME,
        START_PAGE_WIDGET_DOCS_READ_TOOL_NAME,
        START_PAGE_WIDGETS_LIST_TOOL_NAME,
        START_PAGE_WIDGET_PACKAGE_READ_TOOL_NAME,
        START_PAGE_WIDGET_PACKAGE_FILES_LIST_TOOL_NAME,
        START_PAGE_WIDGET_PACKAGE_FILES_READ_TOOL_NAME,
        START_PAGE_WIDGET_PACKAGE_FILES_SEARCH_TOOL_NAME,
        START_PAGE_WIDGET_PACKAGE_FILES_EDIT_TOOL_NAME,
        START_PAGE_WIDGET_PACKAGE_SAVE_TOOL_NAME,
        START_PAGE_CURRENT_WIDGETS_LIST_TOOL_NAME,
        START_PAGE_WIDGET_ADD_TOOL_NAME,
      ].forEach((name) => names.add(name));
      return names;
    }

    [
      AGENT_PROFILE_TOOL_NAME,
      ELEMENT_SCREENSHOT_TOOL_NAME,
      IMAGE_RECOGNITION_TOOL_NAME,
      START_PAGE_WIDGET_BUILDER_TOOL_NAME,
      USER_SCRIPT_DRAFT_TOOL_NAME,
      USER_SCRIPT_INSTALL_TOOL_NAME,
      USER_SCRIPT_CURRENT_PAGE_LIST_TOOL_NAME,
      BOOKMARK_ORGANIZER_TOOL_NAME,
      HISTORY_SEARCH_TOOL_NAME,
      DATA_EXTRACTION_TOOL_NAME,
      TASK_TOOL_NAME,
    ].forEach((name) => names.add(name));
    return names;
  }

  function buildToolsForAgent(agentId: SessionAgentId): AgentBackendToolDefinition[] {
    const localToolNames = resolveLocalToolNamesForAgent(agentId);
    return [
      ...options.automationService.listTools().map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      })),
      ...localTools
        .filter((tool) => localToolNames.has(tool.name))
        .map(({ execute: _execute, ...tool }) => tool),
    ];
  }

  function buildStartPageSystemMessage(): TransportMessage {
    return {
      role: "system",
      content: `The Milo start page URL is ${options.getStartPageUrl()}.`,
    };
  }

  function buildSessionDateAnchorMessage(anchorTimestampMs: number): TransportMessage {
    const anchorDate = new Date(anchorTimestampMs);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone?.trim() || "local";
    return {
      role: "system",
      content:
        `${SESSION_DATE_ANCHOR_PREFIX}${formatLocalDateOnly(anchorDate)} `
        + `(${timeZone}, ${formatUtcOffsetLabel(anchorDate)}). `
        + `Use this as the default date context for this session. `
        + `Call ${TIME_TOOL_NAME} if the exact current date/time matters or the task may have crossed midnight.`,
    };
  }

  function buildCurrentTabScopeSystemMessage(tabId: string): TransportMessage {
    return {
      role: "system",
      content:
        `${CURRENT_TAB_SCOPE_SYSTEM_PREFIX} this session started from a source browser tab, but browser automation still runs in an isolated automation workspace. `
        + `Use ${SOURCE_WORKSPACE_CONTEXT_TOOL_NAME} to find source workspace tabs and use source_* tools to read them. `
        + `If interaction is required, clone the source tab with ${SOURCE_TAB_CLONE_TOOL_NAME} and continue in the isolated automation workspace. `
        + "Do not pass source tab ids to browser automation tools. "
        + `If a task-relevant source or cloned page is an auth/access wall, your next assistant response must include a ${ASK_HUMAN_HELP_TOOL_NAME} tool call with kind=login_required before any further page analysis.`,
    };
  }

  function ensureCurrentTabScopeTransportMessage(
    messages: TransportMessage[],
    scope: AgentSessionScope,
    tabId?: string,
  ): TransportMessage[] {
    if (scope !== "current-tab" || !tabId) {
      return messages;
    }
    if (messages.some((message) =>
      message.role === "system" && message.content.startsWith(CURRENT_TAB_SCOPE_SYSTEM_PREFIX))) {
      return messages;
    }
    return [
      ...messages,
      buildCurrentTabScopeSystemMessage(tabId),
    ];
  }

  function refreshCurrentTabScopeTransportMessage(
    messages: TransportMessage[],
    scope: AgentSessionScope,
    tabId?: string,
  ): TransportMessage[] {
    if (scope !== "current-tab" || !tabId) {
      return messages;
    }

    const nextMessage = buildCurrentTabScopeSystemMessage(tabId);
    let replaced = false;
    const nextMessages = messages.map((message) => {
      if (message.role !== "system" || !message.content.startsWith(CURRENT_TAB_SCOPE_SYSTEM_PREFIX)) {
        return message;
      }
      replaced = true;
      return nextMessage;
    });
    return replaced ? nextMessages : [...nextMessages, nextMessage];
  }

  function ensureInitialTransportMessages(
    messages: TransportMessage[],
    anchorTimestampMs: number,
  ): TransportMessage[] {
    const hasStartPageMessage = messages.some((message) =>
      message.role === "system" && message.content.startsWith(START_PAGE_SYSTEM_MESSAGE_PREFIX));
    const hasSessionDateAnchorMessage = messages.some((message) =>
      message.role === "system" && message.content.startsWith(SESSION_DATE_ANCHOR_PREFIX));

    const initialMessages: TransportMessage[] = [];
    if (!hasStartPageMessage) {
      initialMessages.push(buildStartPageSystemMessage());
    }
    if (!hasSessionDateAnchorMessage) {
      initialMessages.push(buildSessionDateAnchorMessage(anchorTimestampMs));
    }

    return initialMessages.length > 0
      ? [...initialMessages, ...messages]
      : messages;
  }

  function createInitialTransportMessages(anchorTimestampMs = Date.now()): TransportMessage[] {
    return ensureInitialTransportMessages([], anchorTimestampMs);
  }

  function getRestoreInterruptionMessage() {
    return options.resolveUiLocale() === "zh-CN"
      ? "上一次运行在应用退出前被中断，任务快照已恢复。"
      : "The previous run was interrupted before Milo quit. The task snapshot has been restored.";
  }

  function rebuildUiMessagesFromTransportMessages(
    transportMessages: TransportMessage[],
    createdAt: number,
  ): AgentUiMessage[] {
    const messages: AgentUiMessage[] = [];
    let offset = 0;
    const nextCreatedAt = () => createdAt + offset++;

    for (const message of transportMessages) {
      if (message.role === "system") {
        if (
          message.content.startsWith(START_PAGE_SYSTEM_MESSAGE_PREFIX)
          || message.content.startsWith(SESSION_DATE_ANCHOR_PREFIX)
          || message.content.startsWith(ORGANIZER_PROFILE_SYSTEM_PREFIX)
        ) {
          continue;
        }
        messages.push(createUiMessage({
          role: "system",
          kind: "message",
          content: message.content,
          state: "completed",
          createdAt: nextCreatedAt(),
        }));
        continue;
      }

      if (message.role === "user") {
        messages.push(createUiMessage({
          role: "user",
          kind: "message",
          content: message.content,
          state: "completed",
          createdAt: nextCreatedAt(),
        }));
        continue;
      }

      if (message.role === "assistant") {
        if (message.content?.trim() || message.thinkingContent?.trim()) {
          messages.push(createUiMessage({
            role: "assistant",
            kind: "message",
            content: message.content ?? "",
            ...(message.thinkingContent ? { thinkingContent: message.thinkingContent } : {}),
            state: "completed",
            createdAt: nextCreatedAt(),
          }));
        }
        continue;
      }

      if (message.role !== "tool") {
        continue;
      }

      const parsedResult = tryParseJson(message.content);
      const summary = parsedResult !== undefined
        ? summarizeToolResult(message.name, parsedResult)
        : `${message.name} completed.`;
      const subAgentDetails = buildSubAgentDetailsFromToolResult(message.name, parsedResult);
      messages.push(createUiMessage({
        role: "system",
        kind: "tool",
        content: summary,
        state: "completed",
        toolName: message.name,
        ...(subAgentDetails ? { subAgentDetails } : {}),
        createdAt: nextCreatedAt(),
      }));

      if (canonicalizeToolName(message.name) !== AGENT_FINISH_TOOL_NAME || !isRecord(parsedResult)) {
        continue;
      }

      const summaryText = readString(parsedResult.summary);
      const nextStepText = readString(parsedResult.nextStep);
      const finalContent = [summaryText, nextStepText]
        .filter((entry): entry is string => Boolean(entry))
        .join("\n\n");
      if (!finalContent) {
        continue;
      }

      messages.push(createUiMessage({
        role: "assistant",
        kind: "message",
        content: finalContent,
        state: "completed",
        createdAt: nextCreatedAt(),
      }));
    }

    return messages;
  }

  function recoverLegacyClippedUiMessages(
    sessionId: string,
    uiMessages: AgentUiMessage[],
    transportMessages: TransportMessage[],
    createdAt: number,
  ) {
    if (
      uiMessages.length !== LEGACY_CLIPPED_UI_MESSAGE_COUNT
      || transportMessages.length <= uiMessages.length + 8
    ) {
      return uiMessages;
    }

    const rebuiltMessages = rebuildUiMessagesFromTransportMessages(transportMessages, createdAt);
    if (rebuiltMessages.length <= uiMessages.length) {
      return uiMessages;
    }

    const latestPersistedMessage = uiMessages.at(-1);
    if (
      latestPersistedMessage
      && (
        latestPersistedMessage.kind === "error"
        || (
          latestPersistedMessage.role === "system"
          && latestPersistedMessage.kind === "message"
          && (
            latestPersistedMessage.content === getInterruptionMessage()
            || latestPersistedMessage.content === getRestoreInterruptionMessage()
          )
        )
      )
      && !rebuiltMessages.some((message) =>
        message.role === latestPersistedMessage.role
        && message.kind === latestPersistedMessage.kind
        && message.content.trim() === latestPersistedMessage.content.trim())
    ) {
      rebuiltMessages.push({ ...latestPersistedMessage });
    }

    console.info(
      `[Agent] Recovered legacy clipped UI history for session ${sessionId}: `
      + `${uiMessages.length} -> ${rebuiltMessages.length} messages.`,
    );
    return rebuiltMessages;
  }

  function buildPersistedSessionRecord(session: AgentSessionState): PersistedAgentSessionRecord {
    const schedule = cloneSessionSchedule(session.schedule);
    const eventTrigger = cloneSessionEventTrigger(session.eventTrigger);
    const plan = cloneAgentPlan(session.plan);
    return {
      sessionId: session.sessionId,
      agentId: session.agentId,
      workspaceId: session.workspaceId,
      windowId: session.windowId,
      scope: session.scope,
      ...(session.automationTabId ? { automationTabId: session.automationTabId } : {}),
      ...(session.originTabId ? { originTabId: session.originTabId } : {}),
      ...(session.originUrl ? { originUrl: session.originUrl } : {}),
      ...(session.originTitle ? { originTitle: session.originTitle } : {}),
      originWorkspaceId: session.originWorkspaceId,
      originWindowId: session.originWindowId,
      privacyMode: session.privacyMode,
      automationWorkspaceBound: session.automationWorkspaceBound,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      status: session.status,
      ...(schedule ? { schedule } : {}),
      ...(eventTrigger ? { eventTrigger } : {}),
      ...(plan ? { plan } : {}),
      ...(session.lastError ? { lastError: session.lastError } : {}),
      ...(session.terminalResult ? { terminalResult: { ...session.terminalResult } } : {}),
      transportMessages: session.transportMessages.map((message) => {
        if (message.role === "assistant") {
          return {
            role: "assistant",
            content: message.content,
            ...(message.thinkingContent ? { thinkingContent: message.thinkingContent } : {}),
            ...(message.toolCalls
              ? {
                  toolCalls: message.toolCalls.map((toolCall) => ({ ...toolCall })),
                }
              : {}),
          };
        }

        if (message.role === "tool") {
          return {
            role: "tool",
            content: message.content,
            toolCallId: message.toolCallId,
            name: message.name,
          };
        }

        return {
          role: message.role,
          content: message.content,
        };
      }),
      uiMessages: session.uiMessages.map((message) => ({
        ...message,
        ...(message.subAgentDetails ? { subAgentDetails: cloneAgentSubAgentDetails(message.subAgentDetails) } : {}),
      })),
    };
  }

  function writeSessionStateFile(session: AgentSessionState) {
    const targetPath = getSessionStateFilePath(
      options.agentTasksDirectoryPath,
      session.sessionId,
    );
    const tempPath = getSessionStateTempFilePath(
      options.agentTasksDirectoryPath,
      session.sessionId,
    );

    try {
      const serialized = JSON.stringify({
        version: AGENT_STATE_VERSION,
        ...buildPersistedSessionRecord(session),
      } satisfies PersistedAgentSessionFileRecord, null, 2);
      writeFileSync(tempPath, serialized, "utf-8");
      renameSync(tempPath, targetPath);
      return targetPath;
    } catch (error) {
      try {
        if (existsSync(tempPath)) {
          unlinkSync(tempPath);
        }
      } catch {
        // Ignore temp cleanup failures.
      }
      console.error(`[Agent] Failed to save task snapshot ${session.sessionId}.`, error);
      return null;
    }
  }

  function removeDeletedSessionFiles(activeSessionPaths: ReadonlySet<string>) {
    if (!existsSync(options.agentTasksDirectoryPath)) {
      return;
    }

    for (const entry of readdirSync(options.agentTasksDirectoryPath, { withFileTypes: true })) {
      if (!entry.isFile() || !isPersistedSessionFilename(entry.name)) {
        continue;
      }

      const filePath = join(options.agentTasksDirectoryPath, entry.name);
      if (activeSessionPaths.has(filePath)) {
        continue;
      }

      try {
        unlinkSync(filePath);
      } catch (error) {
        console.error(`[Agent] Failed to remove stale task snapshot ${filePath}.`, error);
      }
    }
  }

  function saveStateNow() {
    try {
      mkdirSync(options.agentTasksDirectoryPath, { recursive: true });

      const activeSessionPaths = new Set<string>();
      const activeSessions = Array.from(sessions.values())
        .filter((session) => !session.deleted)
        .sort((left, right) => right.updatedAt - left.updatedAt);

      for (const session of activeSessions) {
        activeSessionPaths.add(getSessionStateFilePath(
          options.agentTasksDirectoryPath,
          session.sessionId,
        ));
        writeSessionStateFile(session);
      }

      removeDeletedSessionFiles(activeSessionPaths);
    } catch (error) {
      console.error("[Agent] Failed to save task snapshots.", error);
    }
  }

  function scheduleSaveState() {
    if (stateSaveTimer) {
      return;
    }

    stateSaveTimer = setTimeout(() => {
      stateSaveTimer = null;
      saveStateNow();
    }, AGENT_STATE_SAVE_DELAY_MS);
  }

  function flushState() {
    if (stateSaveTimer) {
      clearTimeout(stateSaveTimer);
      stateSaveTimer = null;
    }
    saveStateNow();
  }

  function subscribe(listener: (update: AgentSessionUpdate) => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function resolveBackendConfig(): OpenAICompatibleBackendConfig | null {
    return resolveOpenAICompatibleBackendConfig({
      getAgentPreferences: options.getAgentPreferences,
      getLlmProviders: options.getLlmProviders,
      getTranslationPreferences: options.getTranslationPreferences,
      env: process.env,
    });
  }

  function resolveLlmProviderModelSettings(provider: LlmProvider, model: string) {
    const normalizedModel = model.trim();
    return normalizedModel && provider.modelSettings[normalizedModel]
      ? provider.modelSettings[normalizedModel]
      : {
          extraBodyEnabled: provider.extraBodyEnabled,
          extraBody: provider.extraBody,
          extraHeadersEnabled: provider.extraHeadersEnabled,
          extraHeaders: provider.extraHeaders,
          extractThinkingContent: provider.extractThinkingContent,
          thinkingContentTagName: provider.thinkingContentTagName,
          interleavedThinkingEnabled: provider.interleavedThinkingEnabled,
          interleavedThinkingFieldName: provider.interleavedThinkingFieldName,
        };
  }

  function resolveImageRecognitionBackendConfig(): OpenAICompatibleBackendConfig | null {
    const envEndpoint =
      process.env.MILO_IMAGE_AGENT_ENDPOINT?.trim()
      || process.env.MILO_IMAGE_RECOGNITION_ENDPOINT?.trim()
      || process.env.MILO_VISION_AGENT_ENDPOINT?.trim();
    const envApiKey =
      process.env.MILO_IMAGE_AGENT_API_KEY?.trim()
      || process.env.MILO_IMAGE_RECOGNITION_API_KEY?.trim()
      || process.env.MILO_VISION_AGENT_API_KEY?.trim();
    const envModel =
      process.env.MILO_IMAGE_AGENT_MODEL?.trim()
      || process.env.MILO_IMAGE_RECOGNITION_MODEL?.trim()
      || process.env.MILO_VISION_AGENT_MODEL?.trim();
    if (envEndpoint && envApiKey && envModel) {
      return {
        endpoint: envEndpoint,
        apiKey: envApiKey,
        model: envModel,
        providerName: "env",
        source: "env",
      };
    }

    const imageAgent = options.getImageAgentPreferences?.();
    const provider = imageAgent
      ? options.getLlmProviders().find((entry) => entry.id === imageAgent.providerId)
      : null;
    if (provider?.baseUrl.trim() && provider.apiKey.trim() && imageAgent?.model.trim()) {
      const modelSettings = resolveLlmProviderModelSettings(provider, imageAgent.model.trim());
      return {
        endpoint: provider.baseUrl.trim(),
        apiKey: provider.apiKey.trim(),
        model: imageAgent.model.trim(),
        providerId: provider.id,
        providerName: provider.name,
        extraBodyEnabled: modelSettings.extraBodyEnabled,
        extraBody: modelSettings.extraBody,
        extraHeadersEnabled: modelSettings.extraHeadersEnabled,
        extraHeaders: modelSettings.extraHeaders,
        extractThinkingContent: modelSettings.extractThinkingContent,
        thinkingContentTagName: modelSettings.thinkingContentTagName,
        interleavedThinkingEnabled: modelSettings.interleavedThinkingEnabled,
        interleavedThinkingFieldName: modelSettings.interleavedThinkingFieldName,
        source: "image-agent-settings",
      };
    }

    return null;
  }

  function getBackendSnapshot(): AgentBackendSnapshot {
    const backend = resolveBackendConfig();
    if (!backend) {
      return {
        configured: false,
        provider: "openai-compatible",
        providerId: null,
        providerName: null,
        endpoint: null,
        model: null,
        source: "missing",
      };
    }

    return {
      configured: true,
      provider: "openai-compatible",
      providerId: backend.providerId ?? null,
      providerName: backend.providerName ?? null,
      endpoint: sanitizeEndpoint(backend.endpoint),
      model: backend.model,
      source: backend.source,
    };
  }

  function normalizePersistedSessionStatus(status: unknown) {
    if (status === "error" || status === "interrupted" || status === "idle") {
      return status;
    }
    if (status === "running" || status === "queued" || status === "waiting_event") {
      return "interrupted" as const;
    }
    return "idle" as const;
  }

  function restorePersistedSession(record: unknown): AgentSessionState | null {
    if (!isRecord(record)) {
      return null;
    }

    const sessionId = readString(record.sessionId);
    const workspaceId = readString(record.workspaceId);
    const persistedWindowId = readNumber(record.windowId);
    if (!sessionId || !workspaceId || persistedWindowId === undefined) {
      return null;
    }

    const createdAt = readNumber(record.createdAt) ?? Date.now();
    const updatedAt = readNumber(record.updatedAt) ?? createdAt;
    const persistedStatus = record.status;
    const status = normalizePersistedSessionStatus(persistedStatus);
    const transportMessages = Array.isArray(record.transportMessages)
      ? record.transportMessages
        .map((message) => sanitizeTransportMessageRecord(message))
        .filter((message): message is TransportMessage => message !== null)
      : [];
    const normalizedTransportMessages = normalizeTransportMessageSequence(transportMessages).messages;
    const agentId = readSessionAgentId(record.agentId)
      ?? inferSessionAgentIdFromTransportMessages(normalizedTransportMessages);
    const sessionTransportMessages = stripLegacySessionAgentMessages(normalizedTransportMessages);
    const scope = readAgentSessionScope(record.scope);
    const automationTabId = readString(record.automationTabId);
    const originTabId = readString(record.originTabId)
      ?? (record.automationWorkspaceBound === true ? undefined : automationTabId);
    const originUrl = readString(record.originUrl);
    const originTitle = readString(record.originTitle);

    const uiMessages = Array.isArray(record.uiMessages)
      ? record.uiMessages
        .map((message) => sanitizeUiMessageRecord(message))
        .filter((message): message is AgentUiMessage => message !== null)
      : [];

    const recoveredUiMessages = recoverLegacyClippedUiMessages(
      sessionId,
      uiMessages,
      normalizedTransportMessages,
      createdAt,
    );

    const restoredMessages = recoveredUiMessages.map((message) =>
      persistedStatus === "running" || persistedStatus === "queued"
        ? {
            ...message,
            ...(message.state === "running" ? { state: "failed" as const } : {}),
          }
        : message);

    if (
      (persistedStatus === "running" || persistedStatus === "queued")
      && restoredMessages.at(-1)?.content !== getRestoreInterruptionMessage()
    ) {
      restoredMessages.push(createUiMessage({
        role: "system",
        kind: "message",
        content: getRestoreInterruptionMessage(),
        state: "completed",
      }));
    }

    const terminalResult = readAgentFinishResult(record.terminalResult);
    const schedule = readAgentSessionSchedule(record.schedule);
    const eventTrigger = readAgentSessionEventTrigger(record.eventTrigger);
    const plan = readAgentPlan(record.plan);

    return {
      sessionId,
      agentId,
      workspaceId,
      windowId: Math.floor(persistedWindowId),
      scope,
      ...(automationTabId ? { automationTabId } : {}),
      ...(originTabId ? { originTabId } : {}),
      ...(originUrl ? { originUrl } : {}),
      ...(originTitle ? { originTitle } : {}),
      originWorkspaceId: readString(record.originWorkspaceId) ?? workspaceId,
      originWindowId: Math.floor(readNumber(record.originWindowId) ?? persistedWindowId),
      privacyMode: readBoolean(record.privacyMode) ?? true,
      automationWorkspaceBound: record.automationWorkspaceBound === true,
      schedule,
      eventTrigger,
      plan,
      createdAt,
      updatedAt,
      status,
      lastError: status === "interrupted" ? undefined : readString(record.lastError),
      transportMessages: ensureCurrentTabScopeTransportMessage(
        ensureInitialTransportMessages(
          sessionTransportMessages.length > 0 ? sessionTransportMessages : [],
          createdAt,
        ),
        scope,
        automationTabId,
      ),
      uiMessages: restoredMessages,
      runtimeContext: createRuntimeContext(),
      delegatedTasks: new Map(),
      delegatedTaskWaiters: new Map(),
      queuedTurn: false,
      runningPromise: null,
      activeAbortController: null,
      terminalResult,
      manualInterventionPending: false,
      interruptRequested: false,
      deleted: false,
    };
  }

  function parsePersistedState(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new Error("Agent state file is empty.");
    }

    const parsed = JSON.parse(trimmed) as unknown;
    const payload = isRecord(parsed) ? parsed as Partial<AgentSessionStoragePayload> : null;
    if (!payload || !Array.isArray(payload.sessions)) {
      throw new Error("Agent state payload is missing a sessions array.");
    }

    const restoredSessions = payload.sessions
      .map((record) => restorePersistedSession(record))
      .filter((record): record is AgentSessionState => record !== null);

    return restoredSessions;
  }

  function tryLoadLegacyStateFile(filePath: string) {
    if (!existsSync(filePath)) {
      return {
        ok: false as const,
        reason: "missing" as const,
      };
    }

    try {
      return {
        ok: true as const,
        sessions: parsePersistedState(readFileSync(filePath, "utf-8")),
      };
    } catch (error) {
      return {
        ok: false as const,
        reason: "invalid" as const,
        error,
      };
    }
  }

  function archiveStateFile(filePath: string, label: string) {
    if (!existsSync(filePath)) {
      return;
    }

    const archivePath = `${filePath}.${label}-${Date.now()}`;
    try {
      copyFileSync(filePath, archivePath);
      console.warn(`[Agent] Archived ${label} task snapshot file to ${archivePath}.`);
    } catch (error) {
      console.error(`[Agent] Failed to archive ${label} task snapshot file from ${filePath}.`, error);
    }
  }

  function archiveLegacyStateAfterMigration(filePath: string) {
    if (!existsSync(filePath)) {
      return;
    }

    const archivePath = `${filePath}.migrated-${Date.now()}`;
    try {
      renameSync(filePath, archivePath);
      console.info(`[Agent] Archived migrated legacy task snapshot file to ${archivePath}.`);
    } catch (error) {
      console.error(`[Agent] Failed to archive migrated legacy task snapshot file from ${filePath}.`, error);
    }
  }

  function loadSessionFromFile(filePath: string) {
    const trimmed = readFileSync(filePath, "utf-8").trim();
    if (!trimmed) {
      throw new Error("Agent task file is empty.");
    }

    const parsed = JSON.parse(trimmed) as unknown;
    const restoredSession = restorePersistedSession(parsed);
    if (!restoredSession) {
      throw new Error("Agent task file is missing required session fields.");
    }
    return restoredSession;
  }

  function loadSessionsFromDirectory() {
    if (!existsSync(options.agentTasksDirectoryPath)) {
      return {
        ok: false as const,
        reason: "missing" as const,
      };
    }

    const restoredSessions: AgentSessionState[] = [];
    for (const entry of readdirSync(options.agentTasksDirectoryPath, { withFileTypes: true })) {
      if (!entry.isFile() || !isPersistedSessionFilename(entry.name)) {
        continue;
      }

      const filePath = join(options.agentTasksDirectoryPath, entry.name);
      try {
        restoredSessions.push(loadSessionFromFile(filePath));
      } catch (error) {
        console.error(`[Agent] Failed to load task snapshot ${filePath}.`, error);
        archiveStateFile(filePath, "corrupt");
      }
    }

    return {
      ok: true as const,
      sessions: restoredSessions,
    };
  }

  function registerRestoredSessions(restoredSessions: AgentSessionState[]) {
    for (const session of restoredSessions.sort((left, right) => left.updatedAt - right.updatedAt)) {
      sessions.set(session.sessionId, session);
      const key = getWindowKey(session.originWorkspaceId, session.originWindowId);
      sessionIdsByWindowKey.set(key, [
        session.sessionId,
        ...getWindowSessionIds(session.originWorkspaceId, session.originWindowId),
      ]);
    }
  }

  function loadState() {
    const directoryState = loadSessionsFromDirectory();
    if (directoryState.ok) {
      registerRestoredSessions(directoryState.sessions);
      return;
    }

    const primaryState = tryLoadLegacyStateFile(options.legacyAgentStatePath);
    if (primaryState.ok) {
      registerRestoredSessions(primaryState.sessions);
      flushState();
      archiveLegacyStateAfterMigration(options.legacyAgentStatePath);
      archiveLegacyStateAfterMigration(options.legacyAgentStateBackupPath);
      console.info("[Agent] Migrated legacy task snapshots into tasks/.");
      return;
    }

    const backupState = tryLoadLegacyStateFile(options.legacyAgentStateBackupPath);
    if (backupState.ok) {
      if (primaryState.reason === "invalid") {
        console.error("[Agent] Failed to load primary task snapshots.", primaryState.error);
        archiveStateFile(options.legacyAgentStatePath, "corrupt");
        console.warn("[Agent] Recovered task snapshots from backup.");
      }

      registerRestoredSessions(backupState.sessions);
      flushState();
      archiveLegacyStateAfterMigration(options.legacyAgentStatePath);
      archiveLegacyStateAfterMigration(options.legacyAgentStateBackupPath);
      console.info("[Agent] Migrated legacy backup task snapshots into tasks/.");
      return;
    }

    if (primaryState.reason === "invalid") {
      console.error("[Agent] Failed to load task snapshots.", primaryState.error);
      archiveStateFile(options.legacyAgentStatePath, "corrupt");
    }
  }

  function getAgentLaunchSchedulesFilePath() {
    return join(options.agentTasksDirectoryPath, AGENT_LAUNCH_SCHEDULES_FILE_NAME);
  }

  function getAgentLaunchSchedulesTempFilePath() {
    return `${getAgentLaunchSchedulesFilePath()}.tmp`;
  }

  function saveAgentLaunchSchedules() {
    mkdirSync(options.agentTasksDirectoryPath, { recursive: true });
    const schedules = Array.from(agentLaunchSchedules.values())
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((schedule) => cloneAgentLaunchSchedule(schedule)!);
    const payload = {
      version: AGENT_LAUNCH_SCHEDULES_STATE_VERSION,
      schedules,
    };
    const tempPath = getAgentLaunchSchedulesTempFilePath();
    writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
    renameSync(tempPath, getAgentLaunchSchedulesFilePath());
  }

  function loadAgentLaunchSchedules() {
    const filePath = getAgentLaunchSchedulesFilePath();
    if (!existsSync(filePath)) {
      return;
    }

    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
      const rawSchedules = isRecord(parsed) && Array.isArray(parsed.schedules)
        ? parsed.schedules
        : [];
      agentLaunchSchedules.clear();
      for (const entry of rawSchedules) {
        const schedule = readAgentLaunchSchedule(entry);
        if (schedule) {
          agentLaunchSchedules.set(schedule.triggerId, schedule);
        }
      }
    } catch (error) {
      console.error("[Agent] Failed to load agent launch schedules.", error);
      archiveStateFile(filePath, "corrupt");
    }
  }

  function getWindowKey(workspaceId: string, windowId: number) {
    return `${workspaceId}::${windowId}`;
  }

  function getWindowSessionIds(workspaceId: string, windowId: number) {
    return sessionIdsByWindowKey.get(getWindowKey(workspaceId, windowId)) ?? [];
  }

  function adoptStaleSessionsForWindow(workspaceId: string, windowId: number) {
    let changed = false;

    for (const session of sessions.values()) {
      if (
        session.deleted
        || session.originWorkspaceId !== workspaceId
        || session.originWindowId === windowId
        || options.isWindowOpen(session.originWindowId)
      ) {
        continue;
      }

      removeSessionFromWindow(session);
      session.originWindowId = windowId;
      const key = getWindowKey(workspaceId, windowId);
      sessionIdsByWindowKey.set(key, [
        session.sessionId,
        ...getWindowSessionIds(workspaceId, windowId).filter((sessionId) => sessionId !== session.sessionId),
      ]);
      changed = true;
    }

    if (changed) {
      scheduleSaveState();
    }
  }

  function getDefaultSessionTitle() {
    return options.resolveUiLocale() === "zh-CN" ? "新任务" : "New Task";
  }

  function getDefaultSessionPreview() {
    return options.resolveUiLocale() === "zh-CN" ? "等待用户输入。" : "Waiting for input.";
  }

  function getInterruptionMessage() {
    return options.resolveUiLocale() === "zh-CN"
      ? "任务已被用户中断。"
      : "Task interrupted by the user.";
  }

  function getScheduleBusySkipMessage() {
    return options.resolveUiLocale() === "zh-CN"
      ? "已跳过本次定时触发：上一轮任务仍在执行。"
      : "Skipped this scheduled run because the previous run is still active.";
  }

  function getEventTriggerBusySkipMessage() {
    return options.resolveUiLocale() === "zh-CN"
      ? "已跳过本次事件触发：当前任务仍在执行。"
      : "Skipped this event trigger because the current run is still active.";
  }

  function getEventTriggerCooldownSkipMessage(cooldownMs: number) {
    const seconds = Math.max(1, Math.ceil(cooldownMs / 1_000));
    return options.resolveUiLocale() === "zh-CN"
      ? `已跳过本次事件触发：仍处于冷却时间（约 ${seconds} 秒）。`
      : `Skipped this event trigger because the cooldown window is still active (${seconds}s).`;
  }

  function compactSessionText(value: string, maxChars: number) {
    return compactText(value, maxChars);
  }

  function getSessionTitle(session: AgentSessionState) {
    const firstUserMessage = session.uiMessages.find((message) =>
      message.role === "user" && message.kind === "message" && message.content.trim().length > 0);
    if (!firstUserMessage) {
      if (session.schedule?.prompt) {
        return compactSessionText(session.schedule.prompt, MAX_TASK_TITLE_CHARS);
      }
      if (session.eventTrigger?.prompt) {
        return compactSessionText(session.eventTrigger.prompt, MAX_TASK_TITLE_CHARS);
      }
      return getDefaultSessionTitle();
    }
    return compactSessionText(firstUserMessage.content, MAX_TASK_TITLE_CHARS);
  }

  function getSessionPreview(session: AgentSessionState) {
    const latestMessage = [...session.uiMessages]
      .reverse()
      .find((message) => message.kind !== "tool" && message.content.trim().length > 0);
    if (!latestMessage) {
      if (session.schedule?.prompt) {
        return compactSessionText(session.schedule.prompt, MAX_TASK_PREVIEW_CHARS);
      }
      if (session.eventTrigger?.prompt) {
        return compactSessionText(session.eventTrigger.prompt, MAX_TASK_PREVIEW_CHARS);
      }
      return getDefaultSessionPreview();
    }
    return compactSessionText(latestMessage.content, MAX_TASK_PREVIEW_CHARS);
  }

  function getSessionContextSnapshot(session: AgentSessionState): AgentSessionContextSnapshot {
    const { windowContext, activeTab } = resolveSessionTabContext(session);
    const latestBrowserSession = Array.from(session.runtimeContext.browserSessions.values()).at(-1);
    const activeUrl = latestBrowserSession?.url ?? activeTab?.url ?? windowContext.activeUrl ?? session.originUrl;
    const activeTitle = latestBrowserSession?.title ?? activeTab?.title ?? windowContext.activeTitle ?? session.originTitle;

    return {
      ...(activeTab?.id ?? session.automationTabId ? { activeTabId: activeTab?.id ?? session.automationTabId } : {}),
      ...(activeUrl ? { activeUrl } : {}),
      ...(activeTitle ? { activeTitle } : {}),
      ...(session.originTabId ? { originTabId: session.originTabId } : {}),
      ...(session.originUrl ? { originUrl: session.originUrl } : {}),
      ...(session.originTitle ? { originTitle: session.originTitle } : {}),
      browserSessionCount: session.runtimeContext.browserSessions.size,
      subscriptionCount: session.runtimeContext.subscriptions.size,
      recentEventCount: session.runtimeContext.recentEvents.length,
    };
  }

  function buildSnapshot(session: AgentSessionState): AgentSessionSnapshot {
    const schedule = cloneSessionSchedule(session.schedule);
    const eventTrigger = cloneSessionEventTrigger(session.eventTrigger);
    const plan = cloneAgentPlan(session.plan);
    return {
      sessionId: session.sessionId,
      workspaceId: session.workspaceId,
      windowId: session.windowId,
      privacyMode: session.privacyMode,
      automationWorkspaceBound: session.automationWorkspaceBound,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      title: getSessionTitle(session),
      preview: getSessionPreview(session),
      status: session.status,
      messages: session.uiMessages.map((message) => ({
        ...message,
        ...(message.subAgentDetails ? { subAgentDetails: cloneAgentSubAgentDetails(message.subAgentDetails) } : {}),
      })),
      context: getSessionContextSnapshot(session),
      backend: getBackendSnapshot(),
      ...(schedule ? { schedule } : {}),
      ...(eventTrigger ? { eventTrigger } : {}),
      ...(plan ? { plan } : {}),
      ...(session.lastError ? { lastError: session.lastError } : {}),
    };
  }

  function buildListItem(session: AgentSessionState): AgentSessionListItem {
    const snapshot = buildSnapshot(session);
    return {
      sessionId: snapshot.sessionId,
      workspaceId: snapshot.workspaceId,
      windowId: snapshot.windowId,
      privacyMode: snapshot.privacyMode,
      automationWorkspaceBound: snapshot.automationWorkspaceBound,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      title: snapshot.title,
      preview: snapshot.preview,
      status: snapshot.status,
      messageCount: snapshot.messages.length,
      context: { ...snapshot.context },
      ...(snapshot.schedule ? { schedule: { ...snapshot.schedule } } : {}),
      ...(snapshot.eventTrigger ? { eventTrigger: { ...snapshot.eventTrigger } } : {}),
      ...(snapshot.plan ? { plan: cloneAgentPlan(snapshot.plan) } : {}),
      ...(snapshot.lastError ? { lastError: snapshot.lastError } : {}),
    };
  }

  function emitUpdate(session: AgentSessionState, reason: AgentSessionUpdate["reason"]) {
    if (session.deleted && reason !== "deleted") {
      return;
    }
    if (reason !== "deleted") {
      session.updatedAt = Date.now();
    }
    scheduleSaveState();
    const update: AgentSessionUpdate = {
      sessionId: session.sessionId,
      reason,
      snapshot: reason === "deleted" ? null : buildSnapshot(session),
    };
    for (const listener of listeners) {
      listener(update);
    }
  }

  function getSessionScheduleTimeSourceId(sessionId: string) {
    return `${AGENT_SESSION_SCHEDULE_TIME_SOURCE_PREFIX}${sessionId}`;
  }

  function getAgentLaunchScheduleTimeSourceId(triggerId: string) {
    return `${AGENT_LAUNCH_SCHEDULE_TIME_SOURCE_PREFIX}${triggerId}`;
  }

  function readAgentLaunchTriggerIdFromTimeSourceEvent(event: TimeSourceEvent) {
    if (event.type !== "time.cron.due") {
      return undefined;
    }
    const payloadTriggerId = isRecord(event.payload) ? readString(event.payload.triggerId) : undefined;
    if (payloadTriggerId) {
      return payloadTriggerId;
    }
    if (event.sourceId.startsWith(AGENT_LAUNCH_SCHEDULE_TIME_SOURCE_PREFIX)) {
      return event.sourceId.slice(AGENT_LAUNCH_SCHEDULE_TIME_SOURCE_PREFIX.length);
    }
    return undefined;
  }

  function readSessionIdFromScheduleTimeSourceEvent(event: TimeSourceEvent) {
    if (event.type !== "time.cron.due") {
      return undefined;
    }
    const payloadSessionId = isRecord(event.payload) ? readString(event.payload.sessionId) : undefined;
    if (payloadSessionId) {
      return payloadSessionId;
    }
    if (event.sourceId.startsWith(AGENT_SESSION_SCHEDULE_TIME_SOURCE_PREFIX)) {
      return event.sourceId.slice(AGENT_SESSION_SCHEDULE_TIME_SOURCE_PREFIX.length);
    }
    return undefined;
  }

  function clearSessionScheduleTimeSource(sessionId: string) {
    sessionScheduleTimeSource.remove(getSessionScheduleTimeSourceId(sessionId));
  }

  function clearAgentLaunchScheduleTimeSource(triggerId: string) {
    sessionScheduleTimeSource.remove(getAgentLaunchScheduleTimeSourceId(triggerId));
  }

  function armSessionScheduleTimeSource(session: AgentSessionState) {
    clearSessionScheduleTimeSource(session.sessionId);
    if (session.deleted || !session.schedule) {
      return;
    }

    const nextRunAt = session.schedule.nextRunAt > Date.now()
      ? session.schedule.nextRunAt
      : computeNextScheduleRunAt(session.schedule.cronExpression, Date.now());
    if (nextRunAt === null) {
      session.schedule = null;
      emitUpdate(session, "schedule");
      return;
    }

    if (nextRunAt !== session.schedule.nextRunAt) {
      session.schedule.nextRunAt = nextRunAt;
      scheduleSaveState();
    }

    sessionScheduleTimeSource.upsert({
      sourceId: getSessionScheduleTimeSourceId(session.sessionId),
      type: "time.cron.due",
      scheduledAt: nextRunAt,
      payload: {
        sessionId: session.sessionId,
        cronExpression: session.schedule.cronExpression,
      },
    });
  }

  function handleAgentTimeSourceEvent(event: TimeSourceEvent) {
    const sessionId = readSessionIdFromScheduleTimeSourceEvent(event);
    if (sessionId) {
      triggerEventBus.emit({
        type: "timer.fired",
        triggerId: getSessionScheduleTimeSourceId(sessionId),
        occurredAt: event.occurredAt,
        sourceEventId: event.id,
        sourceType: event.type,
        dedupeKey: `${event.sourceId}:${event.sequence}`,
        payload: {
          sessionId,
          scheduledAt: event.scheduledAt,
          driftMs: event.driftMs,
        },
      });
      return;
    }

    const launchTriggerId = readAgentLaunchTriggerIdFromTimeSourceEvent(event);
    if (!launchTriggerId) {
      return;
    }
    triggerEventBus.emit({
      type: "agent.launch",
      triggerId: getAgentLaunchScheduleTimeSourceId(launchTriggerId),
      occurredAt: event.occurredAt,
      sourceEventId: event.id,
      sourceType: event.type,
      dedupeKey: `${event.sourceId}:${event.sequence}`,
      payload: {
        triggerId: launchTriggerId,
        scheduledAt: event.scheduledAt,
        driftMs: event.driftMs,
      },
    });
  }

  function handleSessionScheduleTriggerEvent(event: TriggerEvent) {
    const sessionId = isRecord(event.payload) ? readString(event.payload.sessionId) : undefined;
    if (!sessionId) {
      return;
    }
    void triggerSessionSchedule(sessionId);
  }

  async function triggerSessionSchedule(sessionId: string) {
    const session = sessions.get(sessionId);
    if (!session || session.deleted || !session.schedule) {
      clearSessionScheduleTimeSource(sessionId);
      return;
    }

    const triggeredAt = Date.now();
    session.schedule.lastTriggeredAt = triggeredAt;
    session.schedule.nextRunAt = computeNextScheduleRunAt(session.schedule.cronExpression, triggeredAt)
      ?? session.schedule.nextRunAt;
    armSessionScheduleTimeSource(session);

    if (session.runningPromise) {
      session.schedule.lastTriggerStatus = "skipped";
      session.schedule.lastTriggerError = getScheduleBusySkipMessage();
      emitUpdate(session, "schedule");
      return;
    }

    try {
      await sendUserMessage({
        sessionId: session.sessionId,
        content: session.schedule.prompt,
      });
      session.schedule.lastTriggerStatus = "triggered";
      session.schedule.lastTriggerError = undefined;
      emitUpdate(session, "schedule");
    } catch (error) {
      session.schedule.lastTriggerStatus = "failed";
      session.schedule.lastTriggerError = error instanceof Error ? error.message : String(error);
      emitUpdate(session, "schedule");
    }
  }

  function armAgentLaunchSchedule(schedule: AgentLaunchScheduleSnapshot) {
    clearAgentLaunchScheduleTimeSource(schedule.triggerId);
    const nextRunAt = schedule.nextRunAt > Date.now()
      ? schedule.nextRunAt
      : computeNextScheduleRunAt(schedule.cronExpression, Date.now());
    if (nextRunAt === null) {
      agentLaunchSchedules.delete(schedule.triggerId);
      saveAgentLaunchSchedules();
      return;
    }

    if (nextRunAt !== schedule.nextRunAt) {
      schedule.nextRunAt = nextRunAt;
      schedule.updatedAt = Date.now();
      saveAgentLaunchSchedules();
    }

    sessionScheduleTimeSource.upsert({
      sourceId: getAgentLaunchScheduleTimeSourceId(schedule.triggerId),
      type: "time.cron.due",
      scheduledAt: nextRunAt,
      payload: {
        triggerId: schedule.triggerId,
        cronExpression: schedule.cronExpression,
      },
    });
  }

  function resolveAgentLaunchTarget(schedule: AgentLaunchScheduleSnapshot): {
    workspaceId: string;
    windowId: number;
    tabId?: string;
  } {
    if (options.isWindowOpen(schedule.windowId)) {
      return {
        workspaceId: schedule.workspaceId,
        windowId: schedule.windowId,
        ...(schedule.tabId ? { tabId: schedule.tabId } : {}),
      };
    }

    const fallback = options.resolveDefaultMcpTarget?.();
    if (!fallback || !options.isWindowOpen(fallback.windowId)) {
      throw new Error("No open browser window is available for the scheduled agent launch.");
    }
    return fallback;
  }

  async function triggerAgentLaunchSchedule(triggerId: string) {
    const schedule = agentLaunchSchedules.get(triggerId);
    if (!schedule) {
      clearAgentLaunchScheduleTimeSource(triggerId);
      return;
    }

    const triggeredAt = Date.now();
    schedule.lastTriggeredAt = triggeredAt;
    schedule.nextRunAt = computeNextScheduleRunAt(schedule.cronExpression, triggeredAt) ?? schedule.nextRunAt;
    schedule.updatedAt = triggeredAt;
    armAgentLaunchSchedule(schedule);

    const previousSession = schedule.lastSessionId ? sessions.get(schedule.lastSessionId) : undefined;
    if (previousSession?.runningPromise) {
      schedule.lastTriggerStatus = "skipped";
      schedule.lastTriggerError = options.resolveUiLocale() === "zh-CN"
        ? "已跳过本次新 Agent 触发：上一轮 Agent 仍在执行。"
        : "Skipped this agent launch because the previous launched agent is still running.";
      saveAgentLaunchSchedules();
      return;
    }
    if (runningAgentLaunchSchedules.has(triggerId)) {
      schedule.lastTriggerStatus = "skipped";
      schedule.lastTriggerError = options.resolveUiLocale() === "zh-CN"
        ? "已跳过本次新 Agent 触发：同一个触发器正在启动。"
        : "Skipped this agent launch because the same trigger is already starting.";
      saveAgentLaunchSchedules();
      return;
    }

    runningAgentLaunchSchedules.add(triggerId);
    try {
      const target = resolveAgentLaunchTarget(schedule);
      const snapshot = await createSession({
        workspaceId: target.workspaceId,
        windowId: target.windowId,
        scope: schedule.scope,
        ...(target.tabId ? { tabId: target.tabId } : {}),
        privacyMode: schedule.privacyMode,
        profile: schedule.profile,
        content: schedule.prompt,
      });
      schedule.lastSessionId = snapshot.sessionId;
      schedule.lastTriggerStatus = "triggered";
      schedule.lastTriggerError = undefined;
      schedule.updatedAt = Date.now();
      saveAgentLaunchSchedules();
    } catch (error) {
      schedule.lastTriggerStatus = "failed";
      schedule.lastTriggerError = error instanceof Error ? error.message : String(error);
      schedule.updatedAt = Date.now();
      saveAgentLaunchSchedules();
    } finally {
      runningAgentLaunchSchedules.delete(triggerId);
    }
  }

  function handleAgentLaunchTriggerEvent(event: TriggerEvent) {
    const triggerId = isRecord(event.payload) ? readString(event.payload.triggerId) : undefined;
    if (!triggerId) {
      return;
    }
    void triggerAgentLaunchSchedule(triggerId);
  }

  function normalizeObservedEventForTrigger(value: unknown): AgentSessionEventSnapshot | null {
    if (!isRecord(value)) {
      return null;
    }

    const kind = readString(value.kind);
    if (!kind) {
      return null;
    }

    return {
      kind,
      ts: readNumber(value.ts) ?? Date.now(),
      ...(readString(value.url) ? { url: readString(value.url) } : {}),
      ...(readString(value.title) ? { title: readString(value.title) } : {}),
      ...(readString(value.summary) ? { summary: readString(value.summary) } : {}),
      ...(readString(value.source) ? { source: readString(value.source) } : {}),
    };
  }

  function buildEventTriggerRunPrompt(
    trigger: AgentSessionEventTriggerSnapshot,
    event: AgentSessionEventSnapshot,
  ) {
    return [
      "Event trigger fired for this task. Re-check the current page state before acting.",
      "",
      "Configured task:",
      trigger.prompt,
      "",
      "Observed event:",
      `- kind: ${event.kind}`,
      `- time: ${formatLocalDateTime(new Date(event.ts))}`,
      ...(event.url ? [`- url: ${event.url}`] : []),
      ...(event.title ? [`- title: ${event.title}`] : []),
      ...(event.source ? [`- source: ${event.source}`] : []),
      ...(event.summary ? [`- summary: ${event.summary}`] : []),
    ].join("\n");
  }

  function shouldArmSessionEventTrigger(session: AgentSessionState) {
    return !session.deleted
      && session.status === "idle"
      && !session.runningPromise
      && !session.queuedTurn
      && Boolean(session.eventTrigger);
  }

  async function releaseSessionEventWatcherResources(
    session: AgentSessionState,
    watcher: SessionEventWatcherState,
  ) {
    let changed = false;
    const subscriptionId = watcher.subscriptionId;
    watcher.subscriptionId = undefined;
    if (subscriptionId) {
      try {
        const result = await options.automationService.callTool(
          "browser_events_unsubscribe",
          { subscriptionId },
          buildSessionAutomationToolOptions(session),
        );
        reconcileRuntimeContextFromTool(
          session.runtimeContext,
          "browser_events_unsubscribe",
          { subscriptionId },
          result,
        );
        changed = true;
      } catch {
        session.runtimeContext.subscriptions.delete(subscriptionId);
        changed = true;
      }
    }

    const browserSession = watcher.browserSession;
    watcher.browserSession = undefined;
    if (browserSession) {
      try {
        const result = await options.automationService.callTool(
          "browser_session_close",
          {
            session: {
              sessionId: browserSession.sessionId,
              tabId: browserSession.tabId,
            },
          },
          buildSessionAutomationToolOptions(session),
        );
        reconcileRuntimeContextFromTool(
          session.runtimeContext,
          "browser_session_close",
          {
            session: {
              sessionId: browserSession.sessionId,
              tabId: browserSession.tabId,
            },
          },
          result,
          {
            onControlledTabsChanged: () => notifyControlledTabsChanged(session),
          },
        );
        changed = true;
      } catch {
        session.runtimeContext.browserSessions.delete(browserSession.sessionId);
        changed = true;
      }
    }

    if (changed) {
      emitUpdate(session, "context");
    }
  }

  async function stopSessionEventWatcher(sessionId: string) {
    const watcher = sessionEventWatchers.get(sessionId);
    if (!watcher) {
      return;
    }

    watcher.stopRequested = true;
    const session = sessions.get(sessionId);
    if (session) {
      await releaseSessionEventWatcherResources(session, watcher);
    }
  }

  async function triggerSessionEventRun(
    session: AgentSessionState,
    event: AgentSessionEventSnapshot,
  ) {
    const trigger = session.eventTrigger;
    if (!trigger) {
      return;
    }

    try {
      await sendUserMessage({
        sessionId: session.sessionId,
        content: buildEventTriggerRunPrompt(trigger, event),
      });
      if (session.eventTrigger) {
        session.eventTrigger.lastTriggerStatus = "triggered";
        session.eventTrigger.lastTriggerError = undefined;
        session.eventTrigger.lastEvent = event;
      }
      emitUpdate(session, "context");
    } catch (error) {
      if (session.eventTrigger) {
        session.eventTrigger.lastTriggerStatus = "failed";
        session.eventTrigger.lastTriggerError = error instanceof Error ? error.message : String(error);
        session.eventTrigger.lastEvent = event;
      }
      emitUpdate(session, "context");
    }
  }

  async function armSessionEventWatcher(session: AgentSessionState) {
    if (!shouldArmSessionEventTrigger(session)) {
      return;
    }

    const existing = sessionEventWatchers.get(session.sessionId);
    if (existing && !existing.stopRequested && existing.loopPromise) {
      return;
    }
    if (existing) {
      await stopSessionEventWatcher(session.sessionId);
      sessionEventWatchers.delete(session.sessionId);
    }

    const watcher: SessionEventWatcherState = {
      sessionId: session.sessionId,
      loopPromise: null,
      stopRequested: false,
    };
    sessionEventWatchers.set(session.sessionId, watcher);

    watcher.loopPromise = (async () => {
      try {
        while (!watcher.stopRequested && shouldArmSessionEventTrigger(session)) {
          let matchedEvent: AgentSessionEventSnapshot | null = null;

          try {
            await ensureAutomationWorkspaceBinding(session);
            if (watcher.stopRequested || !session.automationTabId || !session.eventTrigger) {
              return;
            }

            const openInput = {
              tabId: session.automationTabId,
              observeOnly: true,
            };
            const openResult = await options.automationService.callTool(
              "browser_session_open",
              openInput,
              buildSessionAutomationToolOptions(session),
            );
            reconcileRuntimeContextFromTool(
              session.runtimeContext,
              "browser_session_open",
              openInput,
              openResult,
              {
                onControlledTabsChanged: () => notifyControlledTabsChanged(session),
              },
            );
            emitUpdate(session, "context");

            const openSessionRecord = isRecord(openResult)
              && isRecord(openResult.session)
              ? openResult.session
              : null;
            const watcherSessionId = openSessionRecord ? readString(openSessionRecord.sessionId) : undefined;
            const watcherTabId = openSessionRecord ? readString(openSessionRecord.tabId) : undefined;
            if (!watcherSessionId || !watcherTabId) {
              throw new Error("Event trigger failed to open an observe-only browser session.");
            }
            watcher.browserSession = {
              sessionId: watcherSessionId,
              tabId: watcherTabId,
            };

            const subscribeInput = {
              session: {
                sessionId: watcherSessionId,
                tabId: watcherTabId,
              },
              channels: [...session.eventTrigger.channels],
            };
            const subscribeResult = await options.automationService.callTool(
              "browser_events_subscribe",
              subscribeInput,
              buildSessionAutomationToolOptions(session),
            );
            reconcileRuntimeContextFromTool(
              session.runtimeContext,
              "browser_events_subscribe",
              subscribeInput,
              subscribeResult,
            );
            emitUpdate(session, "context");

            const subscription = isRecord(subscribeResult)
              && isRecord(subscribeResult.subscription)
              ? subscribeResult.subscription
              : null;
            const subscriptionId = subscription ? readString(subscription.subscriptionId) : undefined;
            if (!subscriptionId) {
              throw new Error("Event trigger failed to subscribe to browser events.");
            }
            watcher.subscriptionId = subscriptionId;

            let cursor = subscription && isRecord(subscription.cursor) ? subscription.cursor : undefined;

            while (!watcher.stopRequested && shouldArmSessionEventTrigger(session) && session.eventTrigger) {
              const currentTrigger = session.eventTrigger;
              const awaitInput: Record<string, unknown> = {
                subscriptionId,
                timeoutMs: currentTrigger.awaitTimeoutMs,
                maxEvents: 1,
                ...(currentTrigger.match ? { match: cloneSessionEventMatch(currentTrigger.match) } : {}),
                ...(cursor ? { cursor } : {}),
              };
              const awaitResult = await options.automationService.callTool(
                "browser_events_await",
                awaitInput,
                buildSessionAutomationToolOptions(session),
              );
              reconcileRuntimeContextFromTool(
                session.runtimeContext,
                "browser_events_await",
                awaitInput,
                awaitResult,
              );

              cursor = isRecord(awaitResult) && isRecord(awaitResult.nextCursor)
                ? awaitResult.nextCursor
                : cursor;

              if (watcher.stopRequested) {
                break;
              }

              const timedOut = isRecord(awaitResult) && awaitResult.timedOut === true;
              if (timedOut) {
                continue;
              }

              matchedEvent = normalizeObservedEventForTrigger(
                isRecord(awaitResult) && isRecord(awaitResult.event)
                  ? awaitResult.event
                  : isRecord(awaitResult) && Array.isArray(awaitResult.events)
                    ? awaitResult.events.find((entry) => isRecord(entry))
                    : undefined,
              );
              if (!matchedEvent || !session.eventTrigger) {
                continue;
              }

              if (!shouldArmSessionEventTrigger(session)) {
                session.eventTrigger.lastTriggerStatus = "skipped";
                session.eventTrigger.lastTriggerError = getEventTriggerBusySkipMessage();
                session.eventTrigger.lastEvent = matchedEvent;
                emitUpdate(session, "context");
                matchedEvent = null;
                break;
              }

              if (
                session.eventTrigger.cooldownMs > 0
                && session.eventTrigger.lastTriggeredAt !== undefined
                && (Date.now() - session.eventTrigger.lastTriggeredAt) < session.eventTrigger.cooldownMs
              ) {
                session.eventTrigger.lastTriggerStatus = "skipped";
                session.eventTrigger.lastTriggerError = getEventTriggerCooldownSkipMessage(session.eventTrigger.cooldownMs);
                session.eventTrigger.lastEvent = matchedEvent;
                emitUpdate(session, "context");
                matchedEvent = null;
                continue;
              }

              session.eventTrigger.lastTriggeredAt = Date.now();
              session.eventTrigger.lastTriggerStatus = "triggered";
              session.eventTrigger.lastTriggerError = undefined;
              session.eventTrigger.lastEvent = matchedEvent;
              emitUpdate(session, "context");
              watcher.stopRequested = true;
              break;
            }
          } catch (error) {
            if (!watcher.stopRequested && session.eventTrigger) {
              session.eventTrigger.lastTriggerStatus = "failed";
              session.eventTrigger.lastTriggerError = error instanceof Error ? error.message : String(error);
              emitUpdate(session, "context");
              await waitForDelay(EVENT_TRIGGER_RETRY_DELAY_MS);
            }
          } finally {
            await releaseSessionEventWatcherResources(session, watcher);
          }

          if (matchedEvent) {
            await triggerSessionEventRun(session, matchedEvent);
            return;
          }
        }
      } finally {
        const current = sessionEventWatchers.get(session.sessionId);
        if (current === watcher) {
          sessionEventWatchers.delete(session.sessionId);
        }
      }
    })();
  }

  function syncSessionEventWatcher(session: AgentSessionState) {
    if (shouldArmSessionEventTrigger(session)) {
      void armSessionEventWatcher(session);
      return;
    }
    void stopSessionEventWatcher(session.sessionId);
  }

  async function setSessionEventTrigger(input: {
    sessionId: string;
    prompt: string;
    channels?: string[];
    match?: AgentSessionEventMatchSnapshot;
    awaitTimeoutMs?: number;
    cooldownMs?: number;
  }): Promise<AgentSessionSnapshot> {
    const session = sessions.get(input.sessionId);
    if (!session || session.deleted) {
      throw new Error(`Agent session ${input.sessionId} was not found.`);
    }

    await stopSessionEventWatcher(input.sessionId);
    sessionEventWatchers.delete(input.sessionId);

    const channels = (input.channels?.filter((entry) =>
      (EVENT_TRIGGER_CHANNEL_VALUES as readonly string[]).includes(entry)) ?? []);
    session.eventTrigger = {
      prompt: input.prompt,
      channels: channels.length > 0 ? channels : [...DEFAULT_EVENT_TRIGGER_CHANNELS],
      awaitTimeoutMs: Math.min(
        DEFAULT_EVENT_TRIGGER_AWAIT_TIMEOUT_MS,
        Math.max(1_000, Math.floor(input.awaitTimeoutMs ?? DEFAULT_EVENT_TRIGGER_AWAIT_TIMEOUT_MS)),
      ),
      cooldownMs: Math.max(0, Math.floor(input.cooldownMs ?? DEFAULT_EVENT_TRIGGER_COOLDOWN_MS)),
      ...(input.match ? { match: cloneSessionEventMatch(input.match) } : {}),
      ...(session.eventTrigger?.lastTriggeredAt !== undefined ? { lastTriggeredAt: session.eventTrigger.lastTriggeredAt } : {}),
      ...(session.eventTrigger?.lastTriggerStatus ? { lastTriggerStatus: session.eventTrigger.lastTriggerStatus } : {}),
      ...(session.eventTrigger?.lastTriggerError ? { lastTriggerError: session.eventTrigger.lastTriggerError } : {}),
      ...(session.eventTrigger?.lastEvent ? { lastEvent: cloneSessionEventSnapshot(session.eventTrigger.lastEvent) } : {}),
    };
    emitUpdate(session, "context");
    syncSessionEventWatcher(session);
    return buildSnapshot(session);
  }

  async function clearSessionEventTrigger(sessionId: string): Promise<AgentSessionSnapshot> {
    const session = sessions.get(sessionId);
    if (!session || session.deleted) {
      throw new Error(`Agent session ${sessionId} was not found.`);
    }

    session.eventTrigger = null;
    await stopSessionEventWatcher(sessionId);
    sessionEventWatchers.delete(sessionId);
    emitUpdate(session, "context");
    return buildSnapshot(session);
  }

  function pushUiMessage(session: AgentSessionState, message: AgentUiMessage) {
    session.uiMessages.push(message);
  }

  function repairSessionTransportMessages(session: AgentSessionState) {
    const strippedMessages = stripLegacySessionAgentMessages(session.transportMessages);
    const normalized = normalizeTransportMessageSequence(strippedMessages);
    if (!normalized.changed && strippedMessages.length === session.transportMessages.length) {
      return false;
    }

    session.transportMessages = ensureInitialTransportMessages(normalized.messages, session.createdAt);
    scheduleSaveState();
    return true;
  }

  function ensureVisibleErrorMessage(session: AgentSessionState, content: string) {
    const latest = session.uiMessages.at(-1);
    if (
      latest
      && latest.kind === "error"
      && latest.content.trim() === content.trim()
    ) {
      return;
    }

    pushUiMessage(session, createUiMessage({
      role: "system",
      kind: "error",
      content,
      state: "failed",
    }));
  }

  function failRunningToolUiMessages(session: AgentSessionState, reason: string) {
    let changed = false;
    for (const message of session.uiMessages) {
      if (message.kind !== "tool" || message.state !== "running") {
        continue;
      }

      message.state = "failed";
      message.content = message.toolName
        ? `${message.toolName} failed: ${reason}`
        : reason;
      changed = true;
    }
    return changed;
  }

  function updateUiMessage(
    session: AgentSessionState,
    messageId: string,
    patch: Partial<Pick<AgentUiMessage, "content" | "state" | "subAgentDetails">>,
  ) {
    const target = session.uiMessages.find((message) => message.id === messageId);
    if (!target) {
      return;
    }
    if (typeof patch.content === "string") {
      target.content = patch.content;
    }
    if (patch.state) {
      target.state = patch.state;
    }
    if (patch.subAgentDetails) {
      target.subAgentDetails = cloneAgentSubAgentDetails(patch.subAgentDetails);
    }
  }

  function getLatestUserTaskText(session: AgentSessionState) {
    const latestUserMessage = [...session.transportMessages]
      .reverse()
      .find((message) =>
        message.role === "user"
        && typeof message.content === "string"
        && message.content.trim().length > 0);
    return latestUserMessage && typeof latestUserMessage.content === "string"
      ? latestUserMessage.content.trim()
      : undefined;
  }

  function resolveSchedulePrompt(session: AgentSessionState, explicitPrompt?: string) {
    const resolvedPrompt = explicitPrompt?.trim() || getLatestUserTaskText(session);
    if (!resolvedPrompt) {
      throw new Error(
        options.resolveUiLocale() === "zh-CN"
          ? "请先为该任务提供一条可执行的指令，或在自动触发配置里填写执行内容。"
          : "Provide a runnable instruction for this task, or fill in the automation prompt explicitly.",
      );
    }
    return resolvedPrompt;
  }

  function buildSubAgentDetailsFromToolResult(
    name: string,
    result: unknown,
    input?: Record<string, unknown>,
    timing?: {
      startedAt?: number;
      finishedAt?: number;
    },
  ): AgentSubAgentDetails | undefined {
    if (!isRecord(result)) {
      return undefined;
    }

    const normalizedName = canonicalizeToolName(name);
    if (normalizedName === TASK_TOOL_NAME && Array.isArray(result.tasks)) {
      const runs = result.tasks
        .map((entry, index) => sanitizeAgentSubAgentRunDetail(entry, index))
        .filter((entry): entry is AgentSubAgentRunDetail => entry !== null);
      if (runs.length === 0) {
        return undefined;
      }
      return {
        kind: "sub_agents",
        updatedAt: Date.now(),
        runs,
      };
    }

    const specializedDetails = buildSpecializedSubAgentDetails(name, input, {
      result,
      startedAt: timing?.startedAt,
      finishedAt: timing?.finishedAt,
    });
    if (specializedDetails) {
      return specializedDetails;
    }

    if (normalizedName !== DATA_EXTRACTION_TOOL_NAME) {
      return undefined;
    }

    const status = readAgentSubAgentRunStatus(result.status) ?? "completed";
    const task = readString(result.task) ?? readString(input?.task);
    const target = isRecord(result.target) ? result.target : null;
    const steps = readStringArray(result.steps);
    const extractionResult = isRecord(result.result) ? result.result : undefined;
    const tabId = target ? readString(target.tabId) : readString(result.tabId);
    const windowId = target ? readWindowIdNumber(target.windowId) : readWindowIdNumber(result.windowId);
    const title = task ? compactText(task, 120) : "Extraction sub-agent";
    const run: AgentSubAgentRunDetail = {
      id: readString(result.id) ?? `extraction:${tabId ?? Date.now()}`,
      kind: "extraction",
      title,
      status,
      ...(task ? { task } : {}),
      ...(tabId ? { tabId } : {}),
      ...(windowId !== undefined ? { windowId } : {}),
      ...(timing?.startedAt !== undefined ? { startedAt: timing.startedAt } : {}),
      ...(timing?.finishedAt !== undefined ? { finishedAt: timing.finishedAt } : {}),
      ...(readString(result.summary) ? { summary: readString(result.summary) } : {}),
      ...(readString(result.nextStep) ? { nextStep: readString(result.nextStep) } : {}),
      ...(extractionResult ? { result: extractionResult } : {}),
      ...(steps.length > 0 ? { steps } : {}),
    };

    return {
      kind: "sub_agents",
      updatedAt: Date.now(),
      runs: [run],
    };
  }

  function getSpecializedSubAgentRunKind(toolName: string): AgentSubAgentRunKind | null {
    const normalizedName = canonicalizeToolName(toolName);
    if (normalizedName === canonicalizeToolName(BOOKMARK_ORGANIZER_TOOL_NAME)) {
      return "bookmark_organizer";
    }
    if (normalizedName === canonicalizeToolName(IMAGE_RECOGNITION_TOOL_NAME)) {
      return "image_recognition";
    }
    if (normalizedName === canonicalizeToolName(USER_SCRIPT_DRAFT_TOOL_NAME)) {
      return "user_script";
    }
    if (normalizedName === canonicalizeToolName(START_PAGE_WIDGET_BUILDER_TOOL_NAME)) {
      return "widget_builder";
    }
    return null;
  }

  function getSpecializedSubAgentFallbackTitle(kind: AgentSubAgentRunKind) {
    switch (kind) {
      case "bookmark_organizer":
        return "Bookmark organizer sub-agent";
      case "image_recognition":
        return "Image recognition sub-agent";
      case "user_script":
        return "User-script authoring sub-agent";
      case "widget_builder":
        return "Start page widget-builder sub-agent";
      default:
        return "Sub-agent";
    }
  }

  function getSpecializedSubAgentTaskText(
    kind: AgentSubAgentRunKind,
    input?: Record<string, unknown>,
    result?: Record<string, unknown>,
  ) {
    if (kind === "image_recognition") {
      return readString(input?.task);
    }
    if (kind === "user_script") {
      return readString(input?.instruction);
    }
    if (kind === "widget_builder") {
      return readString(input?.instruction);
    }
    return readString(input?.instruction) ?? readString(result?.summary);
  }

  function buildSpecializedSubAgentDetails(
    toolName: string,
    input: Record<string, unknown> | undefined,
    options?: {
      result?: unknown;
      status?: AgentSubAgentRunStatus;
      startedAt?: number;
      finishedAt?: number;
      error?: string;
    },
  ): AgentSubAgentDetails | undefined {
    if (canonicalizeToolName(toolName) === DATA_EXTRACTION_TOOL_NAME) {
      const result = isRecord(options?.result) ? options.result : undefined;
      const task = readString(result?.task) ?? readString(input?.task);
      const target = isRecord(result?.target) ? result.target : null;
      const tabId = target ? readString(target.tabId) : readString(result?.tabId) ?? readString(input?.tabId);
      const windowId = target
        ? readWindowIdNumber(target.windowId)
        : readWindowIdNumber(result?.windowId);
      const steps = readStringArray(result?.steps);
      const extractionResult = isRecord(result?.result) ? result.result : undefined;
      const summary = readString(result?.summary);
      const nextStep = readString(result?.nextStep);
      const status = options?.status
        ?? readAgentSubAgentRunStatus(result?.status)
        ?? (options?.finishedAt !== undefined ? "completed" : "running");
      const run: AgentSubAgentRunDetail = {
        id: `${DATA_EXTRACTION_TOOL_NAME}:${tabId ?? readString(input?.browserSessionId) ?? "run"}`,
        kind: "extraction",
        title: task ? compactText(task, 120) : "Extraction sub-agent",
        status,
        ...(task ? { task } : {}),
        ...(tabId ? { tabId } : {}),
        ...(windowId !== undefined ? { windowId } : {}),
        ...(target && readString(target.url) ? { startUrl: readString(target.url) } : {}),
        ...(options?.startedAt !== undefined ? { startedAt: options.startedAt } : {}),
        ...(options?.finishedAt !== undefined ? { finishedAt: options.finishedAt } : {}),
        ...(summary ? { summary } : {}),
        ...(nextStep ? { nextStep } : {}),
        ...(options?.error ? { lastError: options.error } : {}),
        ...(extractionResult ? { result: extractionResult } : {}),
        ...(steps.length > 0 ? { steps } : {}),
      };

      return {
        kind: "sub_agents",
        updatedAt: Date.now(),
        runs: [run],
      };
    }

    const kind = getSpecializedSubAgentRunKind(toolName);
    if (!kind) {
      return undefined;
    }

    const result = isRecord(options?.result) ? options.result : undefined;
    const task = getSpecializedSubAgentTaskText(kind, input, result);
    const summary = readString(result?.summary);
    const nextStep = readString(result?.nextStep);
    const status = options?.status
      ?? readAgentSubAgentRunStatus(result?.status)
      ?? "running";
    const title = task
      ? compactText(task, 120)
      : summary
        ? compactText(summary, 120)
        : getSpecializedSubAgentFallbackTitle(kind);
    const run: AgentSubAgentRunDetail = {
      id: `${canonicalizeToolName(toolName)}:${readString(result?.sessionId) ?? readString(result?.imageRef) ?? readString(result?.profileId) ?? "run"}`,
      kind,
      title,
      status,
      ...(task ? { task } : {}),
      ...(readString(result?.targetUrl) ? { startUrl: readString(result?.targetUrl) } : {}),
      ...(readString(result?.url) ? { startUrl: readString(result?.url) } : {}),
      ...(options?.startedAt !== undefined ? { startedAt: options.startedAt } : {}),
      ...(options?.finishedAt !== undefined ? { finishedAt: options.finishedAt } : {}),
      ...(summary ? { summary } : {}),
      ...(nextStep ? { nextStep } : {}),
      ...(options?.error ? { lastError: options.error } : {}),
      ...(result ? { result } : {}),
    };

    return {
      kind: "sub_agents",
      updatedAt: Date.now(),
      runs: [run],
    };
  }

  function buildSharedBrowserAgentSystemPrompt(agentId: SessionAgentId) {
    const availableLocalToolNames = resolveLocalToolNamesForAgent(agentId);
    const hasLocalTool = (name: string) => availableLocalToolNames.has(name) && localToolsByName.has(name);
    return [
      ...buildWorkspaceIsolationSystemPromptLines(),
      "Use the provided function tools for every browser action. Do not claim to click, type, inspect, subscribe, or handle dialogs unless a tool call actually succeeded.",
      ...(hasLocalTool(AGENT_PLAN_TOOL_NAME)
        ? [
            `For complex tasks, call ${AGENT_PLAN_TOOL_NAME} with action=set before execution to create an explicit plan. Complex tasks include multi-step workflows, unclear sequences, cross-page work, data extraction, comparisons, scheduling, or tasks with meaningful risk of needing revision.`,
            `Keep the plan concise and actionable. Mark a step in_progress before working on it, completed after verification, and revise the plan instead of improvising when new evidence changes the path.`,
          ]
        : []),
      "The runtime is event-driven. When a task depends on DOM changes, new tabs, dialogs, downloads, or async browser state, prefer browser_events_subscribe followed by browser_events_await. Use browser_events_read for backlog inspection and debugging.",
      "Use browser_ax_snapshot or browser_ax_query to inspect pages through the accessibility tree before interacting.",
      ...(hasLocalTool(ELEMENT_SCREENSHOT_TOOL_NAME) && hasLocalTool(IMAGE_RECOGNITION_TOOL_NAME)
        ? [
            `Accessibility tools do not include pixel-level image understanding. When the task depends on charts, canvases, screenshots, icons, visual styling, or OCR, use ${ELEMENT_SCREENSHOT_TOOL_NAME} and then ${IMAGE_RECOGNITION_TOOL_NAME}.`,
            `${ELEMENT_SCREENSHOT_TOOL_NAME} returns an image reference only. Pass that imageRef into ${IMAGE_RECOGNITION_TOOL_NAME}; the runtime will convert the referenced image to base64 automatically for the image sub-agent.`,
          ]
        : []),
      ...(hasLocalTool(START_PAGE_WIDGET_BUILDER_TOOL_NAME)
        ? [
            `When the user asks to create, generate, build, update, install, or add a Milo start page/home page widget, including 起始页小组件 or 首页小组件, call ${START_PAGE_WIDGET_BUILDER_TOOL_NAME} with the full request.`,
            `Do not use user-script tools for Milo start page widgets, widget://package UI, or milo://home customization. Use user scripts only for normal http/https page augmentation.`,
          ]
        : []),
      ...(hasLocalTool(BROWSER_CONTEXT_TOOL_NAME)
        ? [
            `When the user asks about currently open tabs, tab pages, tab directories/folders/groups in the sidebar, split tabs, or tabs under a named container such as "Token Plan", call ${SOURCE_WORKSPACE_CONTEXT_TOOL_NAME} and treat its tabOrganization as the source of truth for the user's visible browser window.`,
            `If you need to read a source tab, use ${SOURCE_TAB_SNAPSHOT_TOOL_NAME} or ${SOURCE_TAB_EXTRACT_TOOL_NAME}; if you need to interact with it, first use ${SOURCE_TAB_CLONE_TOOL_NAME} and continue in the isolated automation workspace.`,
          ]
        : []),
      ...(hasLocalTool(USER_SCRIPT_DRAFT_TOOL_NAME) && hasLocalTool(USER_SCRIPT_INSTALL_TOOL_NAME)
        ? [
            `When the user asks which user scripts are active, enabled, applicable, or will run on the current page, use ${USER_SCRIPT_CURRENT_PAGE_LIST_TOOL_NAME}.`,
            `When the user asks to write, revise, or test a user script for a normal http/https page, use ${USER_SCRIPT_DRAFT_TOOL_NAME}; it delegates to the dedicated user-script authoring sub-agent and returns match patterns, code, testCode, and notes. If the request involves layout changes, redesigns, replacing UI components, or replacing the whole page, explicitly ask for a MiloUserScript WebComponent implementation using built-in Tailwind utility classes.`,
            `When the user asks to install, save, enable, apply, or run a user script, use ${USER_SCRIPT_INSTALL_TOOL_NAME} or call ${USER_SCRIPT_DRAFT_TOOL_NAME} with install=true and runNow=true. Do not use page navigation or DOM automation as a substitute for installing a user script.`,
          ]
        : []),
      ...(hasLocalTool(BOOKMARK_ORGANIZER_TOOL_NAME)
        ? [
            `When the user asks to organize, classify, regroup, tidy, or sort bookmarks, use ${BOOKMARK_ORGANIZER_TOOL_NAME}; it delegates planning to the dedicated bookmark organizer sub-agent and applies the validated result to local bookmark state.`,
            `If the user limits bookmark organization to a directory, pass folderId, folderPath, or folderName to ${BOOKMARK_ORGANIZER_TOOL_NAME}. If no directory is specified, leave those fields empty so all bookmarks are in scope.`,
          ]
        : []),
      ...(hasLocalTool(HISTORY_SEARCH_TOOL_NAME)
        ? [
            `When the user asks about recent browsing, research history, studied topics/products, source pages, or how they reached a page, use ${HISTORY_SEARCH_TOOL_NAME}.`,
            `${HISTORY_SEARCH_TOOL_NAME} returns hidden openedFrom metadata; use it to reconstruct page-to-page relationships instead of relying only on the active tab.`,
            ...(hasLocalTool(BROWSER_CONTEXT_TOOL_NAME)
              ? [`Do not use ${HISTORY_SEARCH_TOOL_NAME} to find the current tabs inside a tab directory/folder/group. Use ${SOURCE_WORKSPACE_CONTEXT_TOOL_NAME} for source tab/sidebar state, then inspect those live pages through source_* tools as needed.`]
              : []),
          ]
        : []),
      ...(hasLocalTool(DATA_EXTRACTION_TOOL_NAME)
        ? [
            `Keep general browsing, navigation, and workflow control in the main agent. Use ${DATA_EXTRACTION_TOOL_NAME} when the task is to read, collect, extract, scrape, or structure data from a complex page after you have reached the right page.`,
            `Prefer confirming the current page with browser_ax_snapshot or browser_ax_query before calling ${DATA_EXTRACTION_TOOL_NAME}, and include pageConfirmation when you have direct visible evidence.`,
            `${DATA_EXTRACTION_TOOL_NAME} may inspect the current page for itself. If the data is missing, stale, or the page is not ready, it should return blocked or failed details explaining what the main agent must do next.`,
            `When available, pageConfirmation should include a short reason plus 1-3 exact visible text snippets from the current page that help the extraction sub-agent verify the target quickly.`,
            `${DATA_EXTRACTION_TOOL_NAME} is the specialized extraction sub-agent. Prefer delegating complex lists, tables, card grids, text blocks, and repeated records to it instead of manually reasoning over browser_ax_snapshot results.`,
            `When delegating to ${DATA_EXTRACTION_TOOL_NAME}, provide a clear extraction task and include recordSchema/minRecords/maxRecords when you know the desired output shape.`,
          ]
        : []),
      ...(hasLocalTool(TASK_TOOL_NAME)
        ? [
            `When the user request contains a bounded side quest, alternate page branch, comparison, URL lookup, or multiple independent branches, prefer ${TASK_TOOL_NAME} instead of exploring them sequentially in the main agent.`,
            `${TASK_TOOL_NAME} creates isolated child-agent tabs inside the same automation workspace, so automation does not need the current visible active tab to keep working.`,
            `${TASK_TOOL_NAME} does not return until every delegated child task from that call has finished, so the main agent resumes only after all of those subagents are done.`,
            `Use the single top-level task field for one delegated branch. Use ${TASK_TOOL_NAME}.tasks when you need multiple delegated child agents in one call.`,
            `Choose ${TASK_TOOL_NAME}.conflictPolicy deliberately: host_serialized is the safe default for same-site or same-account flows, independent is only for truly separate branches, and exclusive is for destructive or globally stateful work.`,
            "Do not end the run with a final plain-text reply while delegated child tasks are still pending or running.",
          ]
        : []),
      "Treat web interactions as stateful. After a submit or primary click, verify whether the flow actually progressed instead of assuming success from the dispatch alone.",
      "Do not end a non-final turn with plain text only. Every non-final turn must include one or more tool calls.",
      "When the task is complete, blocked, failed, or needs user input, stop calling tools and send a final plain-text reply to the user.",
      "State the outcome clearly in the first sentence and include any next required step when helpful.",
      "If a click result reports openedTabs or you observe tab.created, attach to the new tab with browser_session_open and continue there.",
      "browser_element_click returns short post-click side-effect fields such as errorObserved, errorMessages, dialogOpened, dialogRegionObserved, downloadStarted, observedEventKinds, and observedEvents, including stateful style or color changes. Inspect them before assuming the page stayed unchanged.",
      "browser_element_input also returns short post-input side-effect fields such as errorObserved, errorMessages, dialogOpened, dialogRegionObserved, downloadStarted, observedEventKinds, and observedEvents, including stateful style or color changes. Inspect them before assuming the page only changed the field value.",
      "If browser_element_input reports requiresSelection=true or exposes availableOptions, typing only filtered choices. Use browser_element_select or query/click an explicit option before continuing.",
      "If a submit or click does not progress, inspect for invalid or required fields, validation messages, combobox choices, dialogs, or newly opened tabs before retrying.",
      ...(hasLocalTool(ASK_HUMAN_HELP_TOOL_NAME)
        ? [
            `If a task-relevant page shows login, sign-up, registration, account picker, account access, CAPTCHA, human verification, verification code, paywall/manual approval, or another manual-only step, your next assistant response must include a ${ASK_HUMAN_HELP_TOOL_NAME} tool call. Do not respond with explanatory text first.`,
            `If you would say "this is a login page", "I need to log in", "login is required", "需要登录", or similar, convert that into a ${ASK_HUMAN_HELP_TOOL_NAME} call with kind=login_required in the same response.`,
          ]
        : []),
      "Do not continue by screenshotting, analyzing, scraping, or using a visible auth/access wall as a substitute for the underlying requested page unless the user explicitly asked to inspect or modify that auth page itself.",
      ...(hasLocalTool(ASK_HUMAN_HELP_TOOL_NAME)
        ? [
            `If you cannot complete the task by yourself after reasonable inspection and available browser actions because required information, permission, credentials, or page state is unavailable to automation, call ${ASK_HUMAN_HELP_TOOL_NAME} with kind=blocked instead of silently failing or pretending completion.`,
            `Use ${ASK_HUMAN_HELP_TOOL_NAME} kind=login_required for sign-in/account access, kind=verification_code for OTP/2FA, kind=human_verification for CAPTCHA or anti-bot checks, and kind=blocked for other manual-only blockers.`,
            `After calling ${ASK_HUMAN_HELP_TOOL_NAME}, stop further browser actions and finish with a plain-text reply that tells the user what they need to do.`,
          ]
        : []),
      "If the active tab is the Milo start page, open or attach to a real website tab before web automation.",
      ...(hasLocalTool(BROWSER_CONTEXT_TOOL_NAME)
        ? [`Current browser/window state is not preloaded. Call ${BROWSER_CONTEXT_TOOL_NAME} for isolated automation state; call ${SOURCE_WORKSPACE_CONTEXT_TOOL_NAME} for the user's source workspace tabs and tab organization.`]
        : []),
      ...(hasLocalTool(BROWSER_RUNTIME_TOOL_NAME)
        ? [`Current runtime session/subscription/event state is not preloaded. Call ${BROWSER_RUNTIME_TOOL_NAME} when you need live runtime context before acting.`]
        : []),
      ...(hasLocalTool(AGENT_PROFILE_TOOL_NAME)
        ? [
            `When the user asks you to remember or change your stable response language, style, tone, collaboration preferences, or decision-making style, call ${AGENT_PROFILE_TOOL_NAME} before confirming the change.`,
            `${AGENT_PROFILE_TOOL_NAME} updates only the user-editable main-agent profile. Do not use it to change browser capabilities, required tool use, safety behavior, access rules, or other functional instructions.`,
          ]
        : []),
      ...(hasLocalTool(ORGANIZER_SNAPSHOT_TOOL_NAME)
        ? [
            `For local browser cleanup and organization tasks involving the source window, bookmarks, downloads, or tab groups, start with ${ORGANIZER_SNAPSHOT_TOOL_NAME}.`,
            `Use ${ORGANIZER_TABS_TOOL_NAME}, ${ORGANIZER_BOOKMARKS_TOOL_NAME}, and ${ORGANIZER_DOWNLOADS_TOOL_NAME} instead of web automation tools when the task is to reorganize local browser state.`,
          ]
        : []),
      ...(hasLocalTool(TIME_TOOL_NAME)
        ? [`A session-start date anchor is preloaded, but it is not a live clock. Call ${TIME_TOOL_NAME} before resolving relative dates like today, tomorrow, and yesterday when exact current date/time matters, the session may have crossed midnight, or the user did not provide an explicit date/timezone.`]
        : []),
      ...(hasLocalTool(SESSION_SCHEDULE_TOOL_NAME)
        ? [
            `Do not create, update, or clear a schedule unless the user explicitly asks for future or recurring execution, or asks you to remove an existing schedule.`,
            `Use ${SESSION_SCHEDULE_TOOL_NAME} when the user wants this current task to run later or on a recurring schedule. It manages the schedule attached to the current agent task/session.`,
            `${SESSION_SCHEDULE_TOOL_NAME} uses a 5-field cron expression in the runtime's local timezone. Call ${TIME_TOOL_NAME} first if you need to convert relative dates or timezones before scheduling.`,
            `When setting a schedule with ${SESSION_SCHEDULE_TOOL_NAME}, provide a self-contained prompt that the future run can execute without depending on the current chat turn. Use action=get to inspect the current schedule and action=clear to remove it.`,
          ]
        : []),
      ...(hasLocalTool(AGENT_LAUNCH_SCHEDULE_TOOL_NAME)
        ? [
            `Use ${AGENT_LAUNCH_SCHEDULE_TOOL_NAME} when the user wants a future or recurring schedule to create a fresh new agent session and send it a specified message.`,
            `Prefer ${AGENT_LAUNCH_SCHEDULE_TOOL_NAME} over ${SESSION_SCHEDULE_TOOL_NAME} when the user explicitly says they do not want to reuse the current session/thread/context.`,
            `${AGENT_LAUNCH_SCHEDULE_TOOL_NAME} uses a 5-field cron expression in the runtime's local timezone and requires a self-contained prompt for the new agent.`,
          ]
        : []),
      ...(hasLocalTool(EVENT_TRIGGER_TOOL_NAME)
        ? [
            `Use ${EVENT_TRIGGER_TOOL_NAME} when the user wants this task to stay armed in the background and automatically run after matching browser/page events.`,
            `${EVENT_TRIGGER_TOOL_NAME} watches the session's automation tab while the session is idle. Provide a self-contained prompt, select relevant channels, and narrow the match filter when the user cares about specific DOM, navigation, dialog, download, or tab events.`,
            `Prefer ${EVENT_TRIGGER_TOOL_NAME} over ${SESSION_SCHEDULE_TOOL_NAME} when the task should react to page changes instead of running on a clock.`,
          ]
        : []),
      ...(hasLocalTool(LEARNING_GUIDANCE_TOOL_NAME)
        ? [
            "Layered learning assets are available through a dedicated tool, not preloaded context.",
            `Use ${LEARNING_GUIDANCE_TOOL_NAME} to search learned action strategies, site skills, and user profiles by task/domain/page context or open the full detail for a guidanceId when that strategy is likely to help.`,
            `On a real website task, before the first non-trivial page interaction in each user turn, call ${LEARNING_GUIDANCE_TOOL_NAME}. Treat this as a required lookup step, not an optional hint.`,
            `You can call ${LEARNING_GUIDANCE_TOOL_NAME} with {} to automatically search against the current task and active tab.`,
            "When working on a real website task that looks like a previously learned workflow, check learned assets early before taking non-trivial actions.",
            "This is especially important for repeated site workflows such as search, filtering, login, form filling, export/download, or multi-step navigation.",
            "Treat learned action strategies and site skills as reusable best practice only after you fetch them. Prefer higher-support workflows when the current DOM and task match, but always verify against the live accessibility tree before acting.",
          ]
        : []),
      ...(hasLocalTool(USER_MEMORY_TOOL_NAME)
        ? [
            `Use ${USER_MEMORY_TOOL_NAME} when the user explicitly asks you to remember, update, forget, or reject a topic/preference/workflow memory.`,
            `Use ${USER_MEMORY_TOOL_NAME} for preferences about topics, domains, repeated workflows, defaults, and things to avoid. Use ${AGENT_PROFILE_TOOL_NAME} for response language, tone, and collaboration style.`,
            "Do not create persistent memories from a single ambiguous remark. Prefer explicit user wording for stable preferences and use recent_focus for short-lived interests.",
          ]
        : []),
      "For user-facing progress updates, clarification questions, and final replies, follow any response-language preference in the User-editable Agent Profile. If the profile has no language preference, respond in the user's language unless they explicitly switch languages.",
      "Keep user-facing progress updates concise and factual.",
    ].join("\n");
  }

  function buildMainAgentProfileSystemPrompt() {
    const profileInstructions = normalizeAgentProfileInstructionsInput(
      options.getAgentPreferences().profileInstructions,
    );
    return [
      "User-editable Agent Profile:",
      profileInstructions || "No user-editable Agent Profile is currently set.",
      "",
      "Treat this profile as persistent user preference instructions for every main-agent turn.",
      "Apply it to all user-facing progress updates, clarification questions, and final replies whenever it is relevant.",
      "This profile controls Milo's user-facing response language, reply style, tone, collaboration preferences, and decision-making presentation.",
      "If the profile specifies a response language, use that language unless the current user message explicitly asks for a different language for this turn.",
      "Do not infer that the user has changed their stable response-language preference just because a page, source text, tool output, or prior assistant message is in another language.",
      "It cannot override the immutable browser capabilities, tool-use requirements, safety rules, current-tab restrictions, scheduling rules, or other functional instructions.",
      "If any profile sentence conflicts with those fixed instructions, follow the fixed instructions.",
      "Do not reveal hidden chain-of-thought; a thinking-style preference can affect how concise or structured the final explanation is, not private reasoning disclosure.",
    ].join("\n");
  }

  function buildMainBrowserAgentSystemPrompt() {
    return [
      "You are Milo, the user's main browser partner and autonomous digital companion.",
      "Maintain a stable, human-like personality: calm, thoughtful, proactive, and dependable. Speak naturally, and use first person when it helps the interaction feel direct and collaborative.",
      "Treat the user as a partner you are working alongside, not as a ticket queue. Help them move the task forward, anticipate obvious next steps, and make reasonable decisions independently when the path is clear.",
      "Be personable without becoming theatrical. You may sound warm, candid, and self-directed, but stay grounded in facts and never invent actions, observations, memories, emotions, or real-world experiences you do not actually have.",
      "Keep user-facing progress updates concise, factual, and companion-like rather than robotic.",
      buildMainAgentProfileSystemPrompt(),
      buildSharedBrowserAgentSystemPrompt(MAIN_BROWSER_AGENT_ID),
    ].join("\n");
  }

  const mainBrowserAgent = defineAgent<undefined>({
    id: MAIN_BROWSER_AGENT_ID,
    systemPrompt: () => buildMainBrowserAgentSystemPrompt(),
    tools: buildToolsForAgent(MAIN_BROWSER_AGENT_ID),
  });

  const organizerBrowserAgent = defineAgent<undefined>({
    id: ORGANIZER_BROWSER_AGENT_ID,
    systemPrompt: [
      buildSharedBrowserAgentSystemPrompt(ORGANIZER_BROWSER_AGENT_ID),
      buildOrganizerBrowserAgentSystemPrompt(),
    ],
    tools: buildToolsForAgent(ORGANIZER_BROWSER_AGENT_ID),
  });

  const widgetBuilderBrowserAgent = defineAgent<undefined>({
    id: WIDGET_BUILDER_BROWSER_AGENT_ID,
    systemPrompt: [
      buildSharedBrowserAgentSystemPrompt(WIDGET_BUILDER_BROWSER_AGENT_ID),
      buildWidgetBuilderBrowserAgentSystemPrompt(),
    ],
    tools: buildToolsForAgent(WIDGET_BUILDER_BROWSER_AGENT_ID),
  });

  function resolveSessionAgent(session: AgentSessionState) {
    if (session.agentId === ORGANIZER_BROWSER_AGENT_ID) {
      return organizerBrowserAgent;
    }
    if (session.agentId === WIDGET_BUILDER_BROWSER_AGENT_ID) {
      return widgetBuilderBrowserAgent;
    }
    return mainBrowserAgent;
  }

  function buildTransportMessagesForBackend(session: AgentSessionState): OpenAICompatibleChatMessage[] {
    const systemContents: string[] = [];
    repairSessionTransportMessages(session);
    const messages: OpenAICompatibleChatMessage[] = [];

    for (const message of session.transportMessages) {
      if (message.role === "system") {
        if (message.content.trim()) {
          systemContents.push(message.content);
        }
        continue;
      }

      if (message.role === "user") {
        messages.push({
          role: "user",
          content: message.content,
        });
        continue;
      }

      if (message.role === "assistant") {
        messages.push({
          role: "assistant",
          content: message.content,
          ...(message.thinkingContent ? { thinkingContent: message.thinkingContent } : {}),
          ...(message.toolCalls
            ? {
                tool_calls: message.toolCalls.map((toolCall) => ({
                  id: toolCall.id,
                  type: "function" as const,
                  function: {
                    name: toolCall.name,
                    arguments: toolCall.argumentsText,
                  },
                })),
              }
            : {}),
        });
        continue;
      }

      if (message.role === "tool") {
        messages.push({
          role: "tool",
          content: message.content,
          tool_call_id: message.toolCallId,
        });
      }
    }

    return systemContents.length > 0
      ? [
          {
            role: "system",
            content: systemContents.join("\n\n"),
          },
          ...messages,
        ]
      : messages;
  }

  function summarizeToolResult(name: string, result: unknown): string {
    const normalizedName = canonicalizeToolName(name);

    if (!isRecord(result)) {
      return `${name} completed.`;
    }

    if (normalizedName === BROWSER_CONTEXT_TOOL_NAME) {
      return `Read current browser context for window ${readNumber(result.windowId) ?? "-"}.`;
    }
    if (normalizedName === SOURCE_WORKSPACE_CONTEXT_TOOL_NAME) {
      return `Read source workspace context with ${readNumber(result.totalTabCount) ?? 0} tab${readNumber(result.totalTabCount) === 1 ? "" : "s"}.`;
    }
    if (normalizedName === SOURCE_TAB_SNAPSHOT_TOOL_NAME) {
      const sourceTab = isRecord(result.sourceTab) ? result.sourceTab : null;
      return `Read source tab snapshot${readString(sourceTab?.title) ? ` for ${readString(sourceTab?.title)}` : ""}.`;
    }
    if (normalizedName === SOURCE_TAB_EXTRACT_TOOL_NAME) {
      const extraction = isRecord(result.extraction) ? result.extraction : null;
      const recordCount = typeof extraction?.recordCount === "number" ? extraction.recordCount : undefined;
      return `Extracted source tab data${recordCount !== undefined ? ` (${recordCount} records)` : ""}.`;
    }
    if (normalizedName === SOURCE_TAB_CLONE_TOOL_NAME) {
      return `Cloned source tab into the isolated automation workspace.`;
    }
    if (normalizedName === BROWSER_RUNTIME_TOOL_NAME) {
      return `Read current runtime context.`;
    }
    if (normalizedName === TIME_TOOL_NAME) {
      return `Read current date/time context.`;
    }
    if (normalizedName === AGENT_PLAN_TOOL_NAME) {
      const action = readAgentPlanToolAction(result.action) ?? "get";
      const plan = readAgentPlan(result.plan);
      if (!plan) {
        return action === "clear" ? "Cleared the task plan." : "No task plan is currently set.";
      }
      const counts = plan.items.reduce<Record<AgentPlanItemStatus, number>>((accumulator, item) => {
        accumulator[item.status] += 1;
        return accumulator;
      }, {
        pending: 0,
        in_progress: 0,
        completed: 0,
        blocked: 0,
        skipped: 0,
      });
      return [
        action === "set"
          ? `Created task plan revision ${plan.revision}.`
          : action === "revise"
            ? `Revised task plan to revision ${plan.revision}.`
            : action === "update"
              ? `Updated task plan revision ${plan.revision}.`
              : `Read task plan revision ${plan.revision}.`,
        `Items: ${plan.items.length}; completed ${counts.completed}, in progress ${counts.in_progress}, blocked ${counts.blocked}.`,
      ].join(" ");
    }
    if (normalizedName === AGENT_PROFILE_TOOL_NAME) {
      const action = readAgentProfileToolAction(result.action) ?? "get";
      const profileSet = readBoolean(result.profileSet) === true;
      if (action === "clear") {
        return "Cleared the main agent profile.";
      }
      if (action === "set" || action === "update") {
        return profileSet
          ? `Updated the main agent profile (${readNumber(result.profileCharCount) ?? 0} chars).`
          : "Cleared the main agent profile.";
      }
      return profileSet
        ? `Read the main agent profile (${readNumber(result.profileCharCount) ?? 0} chars).`
        : "No main agent profile is currently set.";
    }
    if (normalizedName === SESSION_SCHEDULE_TOOL_NAME) {
      const action = readSessionScheduleToolAction(result.action) ?? "get";
      const schedule = readAgentSessionSchedule(result.schedule);
      if (!schedule) {
        return action === "clear"
          ? "Cleared the scheduled run for this task."
          : "No scheduled run is configured for this task.";
      }
      return [
        action === "set"
          ? `Scheduled this task with ${schedule.cronExpression}.`
          : "Read the scheduled run for this task.",
        `Next run: ${formatLocalDateTime(new Date(schedule.nextRunAt))} (${schedule.timezone}).`,
        `Prompt: ${compactText(schedule.prompt, 120)}.`,
      ].join(" ");
    }
    if (normalizedName === AGENT_LAUNCH_SCHEDULE_TOOL_NAME) {
      const action = readAgentLaunchScheduleToolAction(result.action) ?? "list";
      if (action === "list") {
        const count = Array.isArray(result.schedules) ? result.schedules.length : 0;
        return count > 0
          ? `Read ${count} scheduled new-agent trigger${count === 1 ? "" : "s"}.`
          : "No scheduled new-agent triggers are configured.";
      }
      const schedule = readAgentLaunchSchedule(result.schedule);
      if (!schedule) {
        return action === "clear"
          ? "No scheduled new-agent trigger matched that id."
          : "No scheduled new-agent trigger is configured for that id.";
      }
      return [
        action === "set"
          ? `Scheduled a new agent trigger with ${schedule.cronExpression}.`
          : action === "clear"
            ? `Cleared scheduled new-agent trigger ${schedule.triggerId}.`
            : `Read scheduled new-agent trigger ${schedule.triggerId}.`,
        `Next run: ${formatLocalDateTime(new Date(schedule.nextRunAt))} (${schedule.timezone}).`,
        `Prompt: ${compactText(schedule.prompt, 120)}.`,
      ].join(" ");
    }
    if (normalizedName === EVENT_TRIGGER_TOOL_NAME) {
      const action = readSessionScheduleToolAction(result.action) ?? "get";
      const eventTrigger = readAgentSessionEventTrigger(result.eventTrigger);
      if (!eventTrigger) {
        return action === "clear"
          ? "Cleared the event trigger for this task."
          : "No event trigger is configured for this task.";
      }
      const matcherSummary = eventTrigger.match
        ? [
            ...(eventTrigger.match.kinds?.length ? [`Kinds: ${eventTrigger.match.kinds.join(", ")}.`] : []),
            ...(eventTrigger.match.source ? [`Source: ${eventTrigger.match.source}.`] : []),
            ...(eventTrigger.match.urlMatches ? [`URL match: ${compactText(eventTrigger.match.urlMatches, 80)}.`] : []),
            ...(eventTrigger.match.summaryMatches ? [`Summary match: ${compactText(eventTrigger.match.summaryMatches, 80)}.`] : []),
          ].join(" ")
        : "Matcher: any observed event.";
      return [
        action === "set"
          ? `Armed this task with an event trigger on channels ${eventTrigger.channels.join(", ")}.`
          : "Read the event trigger for this task.",
        matcherSummary,
        `Prompt: ${compactText(eventTrigger.prompt, 120)}.`,
      ].join(" ");
    }
    if (normalizedName === canonicalizeToolName(ELEMENT_SCREENSHOT_TOOL_NAME)) {
      const imageRef = readString(result.imageRef);
      const size =
        typeof result.width === "number" && typeof result.height === "number"
          ? `${result.width}x${result.height}`
          : undefined;
      return [
        `Captured an element screenshot${imageRef ? ` as ${imageRef}` : ""}.`,
        ...(size ? [`Size: ${size}.`] : []),
        ...(readString(result.selector) ? [`Selector: ${compactText(readString(result.selector)!, 96)}.`] : []),
      ].join(" ");
    }
    if (normalizedName === canonicalizeToolName(IMAGE_RECOGNITION_TOOL_NAME)) {
      const summary = readString(result.summary);
      return [
        "Image recognition sub-agent completed.",
        ...(summary ? [compactText(summary, 160)] : []),
      ].join(" ");
    }
    if (normalizedName === canonicalizeToolName(START_PAGE_WIDGET_BUILDER_TOOL_NAME)) {
      const status = readString(result.status) ?? "completed";
      const summary = readString(result.summary);
      const sessionId = readString(result.sessionId);
      return [
        `Start page widget-builder sub-agent finished as ${status}.`,
        ...(summary ? [compactText(summary, 160)] : []),
        ...(sessionId ? [`Session: ${sessionId}.`] : []),
      ].join(" ");
    }
    if (normalizedName === canonicalizeToolName(USER_SCRIPT_DRAFT_TOOL_NAME)) {
      const draft = isRecord(result.draft) ? result.draft : null;
      const name = draft ? readString(draft.name) : undefined;
      const matches = draft && Array.isArray(draft.matches) ? draft.matches.length : undefined;
      const installation = isRecord(result.installation) ? result.installation : null;
      const script = installation && isRecord(installation.script) ? installation.script : null;
      return [
        "User-script authoring sub-agent completed.",
        ...(name ? [`Draft: ${compactText(name, 80)}.`] : []),
        ...(matches !== undefined ? [`Match patterns: ${matches}.`] : []),
        ...(script ? [`Installed script id: ${readString(script.id) ?? "-"}.`] : []),
      ].join(" ");
    }
    if (normalizedName === canonicalizeToolName(USER_SCRIPT_INSTALL_TOOL_NAME)) {
      const script = isRecord(result.script) ? result.script : null;
      const runResult = isRecord(result.runResult) ? result.runResult : null;
      const testResult = isRecord(result.testResult) ? result.testResult : null;
      return [
        `User script ${readString(result.action) ?? "saved"}.`,
        ...(script ? [`Script: ${compactText(readString(script.name) ?? readString(script.id) ?? "unknown", 80)}.`] : []),
        ...(runResult ? [`Run: ${runResult.success === true ? "success" : "failed"}.`] : []),
        ...(testResult ? [`Test: ${testResult.success === true ? "success" : "failed"}.`] : []),
      ].join(" ");
    }
    if (normalizedName === canonicalizeToolName(USER_SCRIPT_CURRENT_PAGE_LIST_TOOL_NAME)) {
      const scriptCount = typeof result.scriptCount === "number" ? result.scriptCount : undefined;
      return `Found ${scriptCount ?? 0} enabled user script${scriptCount === 1 ? "" : "s"} matching the current page.`;
    }
    if (normalizedName === canonicalizeToolName(BOOKMARK_ORGANIZER_TOOL_NAME)) {
      const summary = readString(result.summary);
      const createdFolderCount = typeof result.createdFolderCount === "number" ? result.createdFolderCount : 0;
      const updatedFolderCount = typeof result.updatedFolderCount === "number" ? result.updatedFolderCount : 0;
      const movedBookmarkCount = typeof result.movedBookmarkCount === "number" ? result.movedBookmarkCount : 0;
      const skippedBookmarkReferenceCount = typeof result.skippedBookmarkReferenceCount === "number"
        ? result.skippedBookmarkReferenceCount
        : 0;
      return [
        "Bookmark organizer sub-agent completed.",
        `Created folders: ${createdFolderCount}; updated folders: ${updatedFolderCount}; moved bookmarks: ${movedBookmarkCount}.`,
        ...(skippedBookmarkReferenceCount > 0
          ? [`Skipped invalid bookmark references: ${skippedBookmarkReferenceCount}.`]
          : []),
        ...(summary ? [compactText(summary, 160)] : []),
      ].join(" ");
    }
    if (normalizedName === canonicalizeToolName(HISTORY_SEARCH_TOOL_NAME)) {
      const matchedCount = typeof result.matchedCount === "number" ? result.matchedCount : 0;
      const items = Array.isArray(result.items) ? result.items.length : 0;
      return `Read browsing history: ${items} returned from ${matchedCount} matching record${matchedCount === 1 ? "" : "s"}.`;
    }
    if (normalizedName === canonicalizeToolName(ORGANIZER_SNAPSHOT_TOOL_NAME)) {
      const sectionCount = [
        result.tabs ? "tabs" : null,
        result.bookmarks ? "bookmarks" : null,
        result.downloads ? "downloads" : null,
      ].filter(Boolean).length;
      return `Read organizer snapshot${sectionCount > 0 ? ` with ${sectionCount} section${sectionCount === 1 ? "" : "s"}` : ""}.`;
    }
    if (normalizedName === canonicalizeToolName(ORGANIZER_TABS_TOOL_NAME)) {
      const action = readString(result.action) ?? "update";
      const tabs = isRecord(result.tabs) ? result.tabs : null;
      return `Updated tab organization via ${action}${tabs && typeof tabs.groupCount === "number" ? ` (${tabs.groupCount} groups)` : ""}.`;
    }
    if (normalizedName === canonicalizeToolName(ORGANIZER_BOOKMARKS_TOOL_NAME)) {
      const action = readString(result.action) ?? "update";
      const bookmarks = isRecord(result.bookmarks) ? result.bookmarks : null;
      return `Updated bookmarks via ${action}${bookmarks && typeof bookmarks.folderCount === "number" ? ` (${bookmarks.folderCount} folders)` : ""}.`;
    }
    if (normalizedName === canonicalizeToolName(ORGANIZER_DOWNLOADS_TOOL_NAME)) {
      const action = readString(result.action) ?? "update";
      const affectedCount = typeof result.affectedCount === "number" ? result.affectedCount : undefined;
      return `Updated downloads via ${action}${affectedCount !== undefined ? ` (${affectedCount} affected)` : ""}.`;
    }
    if (normalizedName === canonicalizeToolName(START_PAGE_CURRENT_WIDGETS_LIST_TOOL_NAME)) {
      const widgetCount = typeof result.widgetCount === "number" ? result.widgetCount : 0;
      return `Listed ${widgetCount} current start page widget${widgetCount === 1 ? "" : "s"}.`;
    }
    if (normalizedName === canonicalizeToolName(START_PAGE_WIDGETS_LIST_TOOL_NAME)) {
      const packageCount = typeof result.packageCount === "number" ? result.packageCount : 0;
      return `Listed ${packageCount} start page widget package${packageCount === 1 ? "" : "s"}.`;
    }
    if (normalizedName === canonicalizeToolName(START_PAGE_WIDGET_DOCS_READ_TOOL_NAME)) {
      const docs = isRecord(result.docs) ? result.docs : null;
      const source = docs ? readString(docs.source) : undefined;
      const content = docs ? readString(docs.content) : undefined;
      return `Read start page widget authoring docs${source ? ` from ${source}` : ""}${content ? ` (${content.length} chars)` : ""}.`;
    }
    if (normalizedName === canonicalizeToolName(START_PAGE_WIDGET_PACKAGE_READ_TOOL_NAME)) {
      const source = readString(result.source);
      const widgetPackage = isRecord(result.widgetPackage) && isRecord(result.widgetPackage.package)
        ? result.widgetPackage.package
        : null;
      const packageId = widgetPackage ? readString(widgetPackage.id) : undefined;
      const fileCount =
        isRecord(result.widgetPackage) && Array.isArray(result.widgetPackage.files)
          ? result.widgetPackage.files.length
          : undefined;
      return [
        `Read start page widget package${packageId ? ` ${packageId}` : ""}.`,
        ...(fileCount !== undefined ? [`Files: ${fileCount}.`] : []),
        ...(source ? [`Source: ${source}.`] : []),
      ].join(" ");
    }
    if (normalizedName === canonicalizeToolName(START_PAGE_WIDGET_PACKAGE_FILES_LIST_TOOL_NAME)) {
      const fileCount = typeof result.fileCount === "number" ? result.fileCount : 0;
      const widgetPackage = isRecord(result.package) ? result.package : null;
      const packageId = widgetPackage ? readString(widgetPackage.id) : undefined;
      return `Listed ${fileCount} text file${fileCount === 1 ? "" : "s"} in start page widget package${packageId ? ` ${packageId}` : ""}.`;
    }
    if (normalizedName === canonicalizeToolName(START_PAGE_WIDGET_PACKAGE_FILES_READ_TOOL_NAME)) {
      const fileCount = typeof result.fileCount === "number" ? result.fileCount : 0;
      const missingCount = Array.isArray(result.missingPaths) ? result.missingPaths.length : 0;
      return [
        `Read ${fileCount} widget package file${fileCount === 1 ? "" : "s"}.`,
        ...(missingCount > 0 ? [`Missing: ${missingCount}.`] : []),
      ].join(" ");
    }
    if (normalizedName === canonicalizeToolName(START_PAGE_WIDGET_PACKAGE_FILES_SEARCH_TOOL_NAME)) {
      const matchCount = typeof result.matchCount === "number" ? result.matchCount : 0;
      const searchedFileCount = typeof result.searchedFileCount === "number" ? result.searchedFileCount : 0;
      return `Found ${matchCount} match${matchCount === 1 ? "" : "es"} across ${searchedFileCount} widget package file${searchedFileCount === 1 ? "" : "s"}.`;
    }
    if (normalizedName === canonicalizeToolName(START_PAGE_WIDGET_PACKAGE_FILES_EDIT_TOOL_NAME)) {
      const changedCount = Array.isArray(result.changedPaths) ? result.changedPaths.length : 0;
      const deletedCount = Array.isArray(result.deletedPaths) ? result.deletedPaths.length : 0;
      const source = readString(result.source);
      return [
        `Edited widget package files (${changedCount} changed, ${deletedCount} deleted).`,
        ...(source ? [`Source: ${source}.`] : []),
      ].join(" ");
    }
    if (normalizedName === canonicalizeToolName(START_PAGE_WIDGET_PACKAGE_SAVE_TOOL_NAME)) {
      const action = readString(result.action) ?? "saved";
      const source = readString(result.source);
      const widgetPackage = isRecord(result.widgetPackage) && isRecord(result.widgetPackage.package)
        ? result.widgetPackage.package
        : null;
      const packageId = widgetPackage ? readString(widgetPackage.id) : undefined;
      return [
        `${action === "created" ? "Created" : action === "updated" ? "Updated" : "Saved"} start page widget package${packageId ? ` ${packageId}` : ""}.`,
        ...(source ? [`Source: ${source}.`] : []),
      ].join(" ");
    }
    if (normalizedName === canonicalizeToolName(START_PAGE_WIDGET_ADD_TOOL_NAME)) {
      const source = readString(result.source);
      const tabId = readString(result.tabId);
      const skipIfExists = readBoolean(result.skipIfExists);
      const added = readBoolean(result.added);
      const requested = readBoolean(result.requested);
      return [
        `${added === false
          ? "Skipped adding a duplicate start page widget"
          : requested === false
            ? "Added a start page widget"
            : "Requested adding a start page widget"}${source ? ` from ${source}` : ""}.`,
        ...(tabId ? [`Tab: ${tabId}.`] : []),
        ...(skipIfExists === true ? ["Duplicate sources will be skipped."] : []),
      ].join(" ");
    }
    if (normalizedName === canonicalizeToolName(ASK_HUMAN_HELP_TOOL_NAME)) {
      return [
        `Requested human help for tab ${readString(result.tabId) ?? "-"}.`,
        ...(readString(result.message) ? [compactText(readString(result.message)!, 120)] : []),
      ].join(" ");
    }
    if (normalizedName === AGENT_FINISH_TOOL_NAME) {
      const status = readAgentFinishStatus(result.status) ?? "completed";
      const summary = readString(result.summary);
      const nextStep = readString(result.nextStep);
      return [
        `Finished task as ${status}.`,
        ...(summary ? [compactText(summary, 160)] : []),
        ...(nextStep ? [`Next step: ${compactText(nextStep, 120)}`] : []),
      ].join(" ");
    }
    if (normalizedName === DATA_EXTRACTION_TOOL_NAME) {
      const status = readString(result.status) ?? "completed";
      const summary = readString(result.summary);
      const nextStep = readString(result.nextStep);
      const extractionResult = isRecord(result.result) ? result.result : undefined;
      const recordCount = extractionResult && typeof extractionResult.recordCount === "number"
        ? extractionResult.recordCount
        : Array.isArray(extractionResult?.records)
          ? extractionResult.records.length
          : undefined;
      return [
        `Extraction sub-agent finished as ${status}.`,
        ...(summary ? [compactText(summary, 160)] : []),
        ...(nextStep ? [`Next step: ${compactText(nextStep, 120)}`] : []),
        ...(recordCount !== undefined ? [`Records: ${recordCount}.`] : []),
      ].join(" ");
    }
    if (normalizedName === TASK_TOOL_NAME && Array.isArray(result.tasks)) {
      const taskCount = typeof result.taskCount === "number" ? result.taskCount : result.tasks.length;
      const failedTaskCount = typeof result.failedTaskCount === "number" ? result.failedTaskCount : 0;
      const blockedTaskCount = typeof result.blockedTaskCount === "number" ? result.blockedTaskCount : 0;
      const needsUserTaskCount = typeof result.needsUserTaskCount === "number" ? result.needsUserTaskCount : 0;
      const cancelledTaskCount = typeof result.cancelledTaskCount === "number" ? result.cancelledTaskCount : 0;
      return [
        `Delegated ${taskCount} task${taskCount === 1 ? "" : "s"} and waited for all to finish.`,
        ...(failedTaskCount > 0 ? [`Failed: ${failedTaskCount}.`] : []),
        ...(blockedTaskCount > 0 ? [`Blocked: ${blockedTaskCount}.`] : []),
        ...(needsUserTaskCount > 0 ? [`Needs user: ${needsUserTaskCount}.`] : []),
        ...(cancelledTaskCount > 0 ? [`Cancelled: ${cancelledTaskCount}.`] : []),
      ].join(" ");
    }
    if (normalizedName === LEARNING_GUIDANCE_TOOL_NAME) {
      if (result.mode === "view") {
        const guidance = isRecord(result.guidance) ? result.guidance : null;
        if (guidance) {
          return `Loaded learned guidance ${readString(guidance.guidanceId) ?? "-"}${readString(guidance.domain) ? ` for ${readString(guidance.domain)}` : ""}.`;
        }
        return `No learned guidance matched that guidanceId.`;
      }
      if (result.mode === "search" && Array.isArray(result.matches)) {
        return `Found ${result.matches.length} learned guidance match${result.matches.length === 1 ? "" : "es"}.`;
      }
    }
    if (normalizedName === "browser_session_open") {
      return `Connected to tab ${readString(result.tabId) ?? "-"}${readString(result.title) ? `: ${readString(result.title)}` : ""}${readString(result.url) ? ` (${readString(result.url)})` : ""}.`;
    }
    if (normalizedName === "browser_tab_create") {
      return `Created tab ${readString(result.tabId) ?? "-"}${readString(result.title) ? `: ${readString(result.title)}` : ""}${readString(result.url) ? ` (${readString(result.url)})` : ""}.`;
    }
    if (normalizedName === "browser_ax_snapshot" && Array.isArray(result.nodes)) {
      return `Captured accessibility ${readString(result.scope) ?? "outline"} with ${result.nodes.length} nodes.`;
    }
    if (normalizedName === "browser_ax_query" && Array.isArray(result.matches)) {
      return `Matched ${result.matches.length} accessibility nodes.`;
    }
    if (normalizedName === "browser_events_subscribe" && isRecord(result.subscription)) {
      const channels = Array.isArray(result.subscription.channels)
        ? result.subscription.channels.filter((entry): entry is string => typeof entry === "string")
        : [];
      return `Subscribed to browser events: ${channels.join(", ") || "none"}.`;
    }
    if (normalizedName === "browser_events_read" && Array.isArray(result.events)) {
      const kinds = result.events
        .map((entry) => (isRecord(entry) && typeof entry.kind === "string" ? entry.kind : "event"))
        .slice(0, 4)
        .join(", ");
      return `Read ${result.events.length} browser events${kinds ? `: ${kinds}` : ""}.`;
    }
    if (normalizedName === "browser_events_await" && Array.isArray(result.events)) {
      const kinds = result.events
        .map((entry) => (isRecord(entry) && typeof entry.kind === "string" ? entry.kind : "event"))
        .slice(0, 4)
        .join(", ");
      if (result.timedOut === true) {
        return `Timed out waiting for browser events.`;
      }
      return `Observed ${result.events.length} matching browser event${result.events.length === 1 ? "" : "s"}${kinds ? `: ${kinds}` : ""}.`;
    }
    if (normalizedName === "browser_events_unsubscribe") {
      return `Stopped event subscription ${readString(result.subscriptionId) ?? ""}.`;
    }
    if (normalizedName === "browser_dialog_handle") {
      return readString(result.promptText)
        ? `Handled dialog with submitted prompt text.`
        : `Handled browser dialog.`;
    }
    if (normalizedName === "browser_element_press") {
      const key = readString(result.key);
      return typeof result.ok === "boolean" && !result.ok
        ? `Key press${key ? ` ${key}` : ""} was not successful.`
        : `Pressed${key ? ` ${key}` : " a key"}.`;
    }
    if (normalizedName === "browser_element_select") {
      return typeof result.ok === "boolean" && !result.ok
        ? `No matching option was selected.`
        : `Selected an option.`;
    }
    if (normalizedName.startsWith("browser_element_")) {
      return `${name} completed${typeof result.ok === "boolean" && !result.ok ? " without success" : ""}.`;
    }

    return `${name} completed.`;
  }

  function recordRecentEvents(session: AgentSessionState, events: KnownBrowserEvent[]) {
    if (!events.length) {
      return;
    }
    session.runtimeContext.recentEvents.push(...events);
    if (session.runtimeContext.recentEvents.length > MAX_RECENT_EVENTS) {
      session.runtimeContext.recentEvents.splice(
        0,
        session.runtimeContext.recentEvents.length - MAX_RECENT_EVENTS,
      );
    }
  }

  function updateKnownSubscriptionCursor(
    runtimeContext: AgentRuntimeContext,
    subscriptionId: string | undefined,
    nextCursor: unknown,
  ) {
    if (!subscriptionId || !runtimeContext.subscriptions.has(subscriptionId)) {
      return;
    }

    const current = runtimeContext.subscriptions.get(subscriptionId);
    if (!current) {
      return;
    }

    const nextCursorSeq =
      isRecord(nextCursor) && typeof nextCursor.seq === "number"
        ? Math.floor(nextCursor.seq)
        : current.cursorSeq;

    runtimeContext.subscriptions.set(subscriptionId, {
      ...current,
      ...(nextCursorSeq !== undefined ? { cursorSeq: nextCursorSeq } : {}),
      lastReadAt: Date.now(),
    });
  }

  function reconcileRuntimeContextFromTool(
    runtimeContext: AgentRuntimeContext,
    name: string,
    input: Record<string, unknown>,
    result: unknown,
    options?: {
      onControlledTabsChanged?: () => void;
    },
  ) {
    if (!isRecord(result)) {
      return;
    }

    if (name === "browser_session_open" && isRecord(result.session)) {
      const sessionId = readString(result.session.sessionId);
      const tabId = readString(result.session.tabId);
      if (sessionId && tabId) {
        runtimeContext.browserSessions.set(sessionId, {
          sessionId,
          tabId,
          attachedAt: typeof result.attachedAt === "number" ? result.attachedAt : Date.now(),
          ...(readString(result.windowId) ? { windowId: readString(result.windowId) } : {}),
          ...(readString(result.url) ? { url: readString(result.url) } : {}),
          ...(readString(result.title) ? { title: readString(result.title) } : {}),
        });
        options?.onControlledTabsChanged?.();
      }
      return;
    }

    if (name === "browser_session_close" && isRecord(input.session)) {
      const sessionId = readString(input.session.sessionId);
      if (!sessionId) {
        return;
      }
      runtimeContext.browserSessions.delete(sessionId);
      for (const [subscriptionId, subscription] of runtimeContext.subscriptions.entries()) {
        if (subscription.sessionId === sessionId) {
          runtimeContext.subscriptions.delete(subscriptionId);
        }
      }
      options?.onControlledTabsChanged?.();
      return;
    }

    if (name === "browser_events_subscribe" && isRecord(result.subscription)) {
      const subscriptionId = readString(result.subscription.subscriptionId);
      const toolSessionId = isRecord(result.subscription.session)
        ? readString(result.subscription.session.sessionId)
        : undefined;
      if (subscriptionId && toolSessionId) {
        const channels = Array.isArray(result.subscription.channels)
          ? result.subscription.channels.filter((entry): entry is string => typeof entry === "string")
          : [];
        const cursorSeq =
          isRecord(result.subscription.cursor) && typeof result.subscription.cursor.seq === "number"
            ? Math.floor(result.subscription.cursor.seq)
            : undefined;
        runtimeContext.subscriptions.set(subscriptionId, {
          subscriptionId,
          sessionId: toolSessionId,
          startedAt: typeof result.subscription.startedAt === "number"
            ? result.subscription.startedAt
            : Date.now(),
          channels,
          ...(cursorSeq !== undefined ? { cursorSeq } : {}),
        });
      }
      return;
    }

    if (name === "browser_events_read" || name === "browser_events_await") {
      const subscriptionId = readString(result.subscriptionId);
      updateKnownSubscriptionCursor(runtimeContext, subscriptionId, result.nextCursor);
      const events = Array.isArray(result.events)
        ? result.events.flatMap((entry) => {
          if (!isRecord(entry) || typeof entry.kind !== "string") {
            return [];
          }
          return [{
            kind: entry.kind,
            ...(typeof entry.ts === "number" ? { ts: entry.ts } : {}),
            ...(readString(entry.summary) ? { summary: readString(entry.summary) } : {}),
            ...(readString(entry.windowId) ? { windowId: readString(entry.windowId) } : {}),
            ...(readString(entry.tabId) ? { tabId: readString(entry.tabId) } : {}),
            ...(readString(entry.openerTabId) ? { openerTabId: readString(entry.openerTabId) } : {}),
            ...(readString(entry.url) ? { url: readString(entry.url) } : {}),
            ...(readString(entry.title) ? { title: readString(entry.title) } : {}),
            ...(readString(entry.source) ? { source: readString(entry.source) } : {}),
            ...(readString(entry.state) ? { state: readString(entry.state) } : {}),
            ...(readString(entry.filename) ? { filename: readString(entry.filename) } : {}),
            ...(readString(entry.message) ? { message: readString(entry.message) } : {}),
            ...(readString(entry.selector) ? { selector: readString(entry.selector) } : {}),
            ...(typeof entry.backendNodeId === "number" ? { backendNodeId: Math.floor(entry.backendNodeId) } : {}),
            ...(readString(entry.axNodeId) ? { axNodeId: readString(entry.axNodeId) } : {}),
            ...(readString(entry.axRole) ? { axRole: readString(entry.axRole) } : {}),
            ...(readString(entry.axName) ? { axName: readString(entry.axName) } : {}),
            ...(typeof entry.axResolvedDepth === "number" ? { axResolvedDepth: Math.floor(entry.axResolvedDepth) } : {}),
            ...(readString(entry.axResolvedSelector) ? { axResolvedSelector: readString(entry.axResolvedSelector) } : {}),
            ...(readString(entry.axDiffSummary) ? { axDiffSummary: readString(entry.axDiffSummary) } : {}),
          } satisfies KnownBrowserEvent];
        })
        : [];
      runtimeContext.recentEvents.push(...events);
      if (runtimeContext.recentEvents.length > MAX_RECENT_EVENTS) {
        runtimeContext.recentEvents.splice(
          0,
          runtimeContext.recentEvents.length - MAX_RECENT_EVENTS,
        );
      }
      return;
    }

    if (name === "browser_events_unsubscribe") {
      const subscriptionId = readString(result.subscriptionId) ?? readString(input.subscriptionId);
      if (subscriptionId) {
        runtimeContext.subscriptions.delete(subscriptionId);
      }
    }
  }

  async function executeToolCall(
    session: AgentSessionState,
    toolCall: { id: string; name: string; argumentsText: string },
  ): Promise<unknown> {
    if (toolCall.name === AGENT_FINISH_TOOL_NAME) {
      throw new Error(
        `${AGENT_FINISH_TOOL_NAME} has been removed. End the run with a plain-text reply and no tool calls.`,
      );
    }

    if (session.manualInterventionPending) {
      throw new Error(
        `${ASK_HUMAN_HELP_TOOL_NAME} was already called. End the run with a plain-text reply before any further tool calls.`,
      );
    }

    const isEventAwaitTool = toolCall.name === "browser_events_await";
    const uiMessageId = randomUUID();
    pushUiMessage(session, createUiMessage({
      id: uiMessageId,
      role: "system",
      kind: "tool",
      content: isEventAwaitTool ? `Waiting in ${toolCall.name}...` : `Running ${toolCall.name}...`,
      state: "running",
      toolName: toolCall.name,
    }));
    emitUpdate(session, "tool");

    const parsed = parseToolCallArguments(toolCall);
    if (!parsed.ok) {
      session.transportMessages.push({
        role: "tool",
        toolCallId: toolCall.id,
        name: toolCall.name,
        content: normalizeToolResultForContext({
          ok: false,
          error: parsed.error,
        }),
      });
      updateUiMessage(session, uiMessageId, {
        content: `${toolCall.name} failed: ${parsed.error}`,
        state: "failed",
      });
      emitUpdate(session, "error");
      return {
        ok: false,
        error: parsed.error,
      };
    }
    const parsedArguments = parsed.arguments;
    const subAgentStartedAt = Date.now();
    const runningSubAgentDetails = buildSpecializedSubAgentDetails(toolCall.name, parsedArguments, {
      status: "running",
      startedAt: subAgentStartedAt,
    });
    if (runningSubAgentDetails) {
      updateUiMessage(session, uiMessageId, {
        subAgentDetails: runningSubAgentDetails,
      });
      emitUpdate(session, "tool");
    }

    try {
      if (isEventAwaitTool) {
        session.status = "waiting_event";
        emitUpdate(session, "status");
      }

      if (shouldRequireLearningLookupBeforeTool(session, toolCall.name)) {
        const blockedResult = buildLearningLookupRequiredResult(session, toolCall.name);
        session.transportMessages.push({
          role: "tool",
          toolCallId: toolCall.id,
          name: toolCall.name,
          content: normalizeToolResultForContext(blockedResult),
        });
        updateUiMessage(session, uiMessageId, {
          content: `${toolCall.name} blocked: call ${LEARNING_GUIDANCE_TOOL_NAME} first.`,
          state: "failed",
        });
        emitUpdate(session, "context");
        return;
      }

      const localTool = localToolsByName.get(toolCall.name);
      if (!localTool) {
        await ensureAutomationWorkspaceBinding(session);
      }
      const result = localTool
        ? await localTool.execute(parsedArguments, session, { uiMessageId })
        : await options.automationService.callTool(
          toolCall.name,
          parsedArguments,
          buildSessionAutomationToolOptions(session, session.activeAbortController?.signal),
        );
      if (isEventAwaitTool && session.status === "waiting_event") {
        session.status = "running";
        emitUpdate(session, "status");
      }
      if (!localTool) {
        reconcileRuntimeContextFromTool(
          session.runtimeContext,
          toolCall.name,
          parsedArguments,
          result,
          {
            onControlledTabsChanged: () => notifyControlledTabsChanged(session),
          },
        );
      }
      const contextPayload = normalizeToolResultForContext(result);
      session.transportMessages.push({
        role: "tool",
        toolCallId: toolCall.id,
        name: toolCall.name,
        content: contextPayload,
      });
      const subAgentDetails = buildSubAgentDetailsFromToolResult(toolCall.name, result, parsedArguments, {
        startedAt: subAgentStartedAt,
        finishedAt: Date.now(),
      });
      updateUiMessage(session, uiMessageId, {
        content: summarizeToolResult(toolCall.name, result),
        state: "completed",
        ...(subAgentDetails ? { subAgentDetails } : {}),
      });
      emitUpdate(session, "context");
      return result;
    } catch (error) {
      if (isEventAwaitTool && session.status === "waiting_event") {
        session.status = "running";
        emitUpdate(session, "status");
      }
      if (session.activeAbortController?.signal.aborted) {
        throw (
          session.activeAbortController.signal.reason instanceof Error
            ? session.activeAbortController.signal.reason
            : new Error("Task interrupted.")
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      session.transportMessages.push({
        role: "tool",
        toolCallId: toolCall.id,
        name: toolCall.name,
        content: normalizeToolResultForContext({
          ok: false,
          error: message,
        }),
      });
      const failedSubAgentDetails = buildSpecializedSubAgentDetails(toolCall.name, parsedArguments, {
        status: "failed",
        startedAt: subAgentStartedAt,
        finishedAt: Date.now(),
        error: message,
      });
      updateUiMessage(session, uiMessageId, {
        content: `${toolCall.name} failed: ${message}`,
        state: "failed",
        ...(failedSubAgentDetails ? { subAgentDetails: failedSubAgentDetails } : {}),
      });
      emitUpdate(session, "error");
      return {
        ok: false,
        error: message,
      };
    }
  }

  function buildManualInterventionFinalSummary(result: unknown) {
    const payload = isRecord(result) ? result : {};
    const message = readString(payload.message);
    const reason = readString(payload.reason);
    const kind = readManualInterventionKind(payload.kind);
    const fallback = options.resolveUiLocale() === "zh-CN"
      ? "需要你先在浏览器页面中完成手动操作，然后再继续。"
      : "Please complete the requested manual step in the browser, then continue.";
    return [
      message ?? (kind ? buildManualInterventionMessage(kind) : fallback),
      ...(reason ? [reason] : []),
    ].join(" ");
  }

  async function executeSingleTurn(session: AgentSessionState) {
    const backend = resolveBackendConfig();
    if (!backend) {
      const missingConfigMessage = options.resolveUiLocale() === "zh-CN"
        ? "Agent 后端未配置。请先在 设置 > Agent 中创建并配置一个 LLM Provider，然后为 Agent 选择 provider 和 model；也可以用 `MILO_AGENT_ENDPOINT`、`MILO_AGENT_API_KEY`、`MILO_AGENT_MODEL` 环境变量覆盖。"
        : "Agent backend is not configured. Create and configure an LLM provider in Settings > Agent, then choose the provider and model for the agent, or override them with `MILO_AGENT_ENDPOINT`, `MILO_AGENT_API_KEY`, and `MILO_AGENT_MODEL`.";
      session.lastError = missingConfigMessage;
      pushUiMessage(session, createUiMessage({
        role: "system",
        kind: "error",
        content: missingConfigMessage,
        state: "failed",
      }));
      throw new Error(missingConfigMessage);
    }

    session.terminalResult = null;
    await ensureAutomationWorkspaceBinding(session);
    while (true) {
      if (session.activeAbortController?.signal.aborted) {
        throw new Error(
          session.activeAbortController.signal.reason instanceof Error
            ? session.activeAbortController.signal.reason.message
            : "Task interrupted.",
        );
      }
      const assistant = await requestDefinedAgentTurn({
        agent: resolveSessionAgent(session),
        context: undefined,
        backend,
        messages: buildTransportMessagesForBackend(session),
        requestHeaders: buildAgentRequestHeaders(session.sessionId),
        signal: session.activeAbortController?.signal,
      });

      session.transportMessages.push({
        role: "assistant",
        content: assistant.content || null,
        ...(assistant.thinkingContent ? { thinkingContent: assistant.thinkingContent } : {}),
        ...(assistant.toolCalls.length ? { toolCalls: assistant.toolCalls } : {}),
      });

      if (assistant.content || assistant.thinkingContent) {
        pushUiMessage(session, createUiMessage({
          role: "assistant",
          kind: "message",
          content: assistant.content,
          ...(assistant.thinkingContent ? { thinkingContent: assistant.thinkingContent } : {}),
          state: "completed",
        }));
        emitUpdate(session, "message");
      }

      if (!assistant.toolCalls.length) {
        if (!assistant.content?.trim()) {
          throw new Error("Agent backend returned no tool calls and no final response.");
        }
        finalizeMainAgentRun(session, {
          summary: assistant.content,
        });
        return;
      }

      for (const toolCall of assistant.toolCalls) {
        if (session.activeAbortController?.signal.aborted) {
          throw new Error(
            session.activeAbortController.signal.reason instanceof Error
              ? session.activeAbortController.signal.reason.message
              : "Task interrupted.",
          );
        }
        const result = await executeToolCall(session, toolCall);
        if (session.manualInterventionPending) {
          finalizeMainAgentRun(session, {
            status: "needs_user",
            summary: buildManualInterventionFinalSummary(result),
          });
          return;
        }
      }
    }
  }

  function cleanupDeletedSession(session: AgentSessionState) {
    clearSessionScheduleTimeSource(session.sessionId);
    deleteSessionImageReferences(session.sessionId);
    sessionEventWatchers.delete(session.sessionId);
    sessions.delete(session.sessionId);
  }

  async function runSessionLoop(session: AgentSessionState) {
    try {
      do {
        session.queuedTurn = false;
        session.status = "running";
        session.lastError = undefined;
        session.activeAbortController = new AbortController();
        if (session.interruptRequested && !session.activeAbortController.signal.aborted) {
          session.activeAbortController.abort(new Error(getInterruptionMessage()));
        }
        emitUpdate(session, "status");
        await executeSingleTurn(session);
        session.activeAbortController = null;
      } while (session.queuedTurn);

      session.status = "idle";
      emitUpdate(session, "status");
      if (session.terminalResult?.status === "completed") {
        options.onSessionRunFinished?.(buildSnapshot(session));
      }
    } catch (error) {
      session.activeAbortController = null;
      if (session.interruptRequested) {
        session.status = "interrupted";
        session.lastError = undefined;
        failRunningToolUiMessages(session, getInterruptionMessage());
        repairSessionTransportMessages(session);
        pushUiMessage(session, createUiMessage({
          role: "system",
          kind: "message",
          content: getInterruptionMessage(),
          state: "completed",
        }));
        session.interruptRequested = false;
        emitUpdate(session, "status");
      } else {
        session.status = "error";
        session.lastError = error instanceof Error ? error.message : String(error);
        failRunningToolUiMessages(session, session.lastError);
        repairSessionTransportMessages(session);
        ensureVisibleErrorMessage(session, session.lastError);
        emitUpdate(session, "error");
      }
    } finally {
      const shouldStartQueuedTurnAfterInterrupt =
        session.queuedTurn
        && !session.deleted
        && session.status === "interrupted";
      session.activeAbortController = null;
      session.runningPromise = null;
      syncSessionEventWatcher(session);
      if (session.deleted) {
        cleanupDeletedSession(session);
      } else if (shouldStartQueuedTurnAfterInterrupt) {
        session.interruptRequested = false;
        startRunIfNeeded(session);
      }
    }
  }

  function startRunIfNeeded(session: AgentSessionState) {
    if (session.deleted) {
      return;
    }
    if (session.runningPromise) {
      session.queuedTurn = true;
      session.status = "queued";
      emitUpdate(session, "status");
      return;
    }

    void stopSessionEventWatcher(session.sessionId);
    session.status = "running";
    session.interruptRequested = false;
    const promise = runSessionLoop(session);
    session.runningPromise = promise;
  }

  async function ensureAutomationWorkspaceBinding(session: AgentSessionState) {
    const windowStillOpen = session.automationWorkspaceBound && options.isWindowOpen(session.windowId);
    const boundTabStillAvailable = windowStillOpen
      && session.automationTabId
      && options.getWindowContext(session.windowId).tabs.some((tab) => tab.id === session.automationTabId);
    if (windowStillOpen && boundTabStillAvailable) {
      return;
    }

    const binding = await options.ensureAutomationWorkspaceBinding({
      sessionId: session.sessionId,
      ...(session.automationWorkspaceBound ? { workspaceId: session.workspaceId } : {}),
      ...(session.automationWorkspaceBound ? { windowId: session.windowId } : {}),
      ...(session.automationTabId ? { tabId: session.automationTabId } : {}),
      originWorkspaceId: session.originWorkspaceId,
      privacyMode: session.privacyMode,
      title: getSessionTitle(session),
    });

    if (
      session.automationWorkspaceBound
      && session.workspaceId === binding.workspaceId
      && session.windowId === binding.windowId
      && session.automationTabId === binding.tabId
    ) {
      return;
    }

    session.workspaceId = binding.workspaceId;
    session.windowId = binding.windowId;
    session.automationTabId = binding.tabId;
    session.automationWorkspaceBound = true;
    emitUpdate(session, "context");
  }

  function createSessionState(input: {
    workspaceId: string;
    windowId: number;
    scope?: AgentSessionScope;
    tabId?: string;
    privacyMode?: boolean;
    profile?: AgentSessionProfile;
  }) {
    const now = Date.now();
    const scope = input.scope === "current-tab" ? "current-tab" : "default";
    let automationTabId: string | undefined;
    let originTabId: string | undefined;
    let originUrl: string | undefined;
    let originTitle: string | undefined;
    if (scope === "current-tab") {
      const windowContext = options.getWindowContext(input.windowId);
      const requestedTabId = input.tabId?.trim();
      if (requestedTabId && !windowContext.tabs.some((tab) => tab.id === requestedTabId)) {
        throw new Error(`Current-tab agent session cannot bind to tab ${requestedTabId} in window ${input.windowId}.`);
      }
      automationTabId = requestedTabId ?? windowContext.activeTabId ?? windowContext.tabs[0]?.id;
      if (!automationTabId) {
        throw new Error("Current-tab agent session requires an available browser tab.");
      }
      originTabId = automationTabId;
      const originTab = windowContext.tabs.find((tab) => tab.id === automationTabId);
      originUrl = originTab?.url ?? windowContext.activeUrl;
      originTitle = originTab?.title ?? windowContext.activeTitle;
    }
    const baseTransportMessages = ensureCurrentTabScopeTransportMessage(
      createInitialTransportMessages(now),
      scope,
      automationTabId,
    );
    const session: AgentSessionState = {
      sessionId: randomUUID(),
      agentId: resolveSessionAgentIdFromProfile(input.profile),
      workspaceId: input.workspaceId,
      windowId: input.windowId,
      scope,
      ...(automationTabId ? { automationTabId } : {}),
      ...(originTabId ? { originTabId } : {}),
      ...(originUrl ? { originUrl } : {}),
      ...(originTitle ? { originTitle } : {}),
      originWorkspaceId: input.workspaceId,
      originWindowId: input.windowId,
      privacyMode: input.privacyMode !== false,
      automationWorkspaceBound: false,
      schedule: null,
      plan: null,
      eventTrigger: null,
      createdAt: now,
      updatedAt: now,
      status: "idle",
      transportMessages: baseTransportMessages,
      uiMessages: [],
      runtimeContext: createRuntimeContext(),
      delegatedTasks: new Map(),
      delegatedTaskWaiters: new Map(),
      queuedTurn: false,
      runningPromise: null,
      activeAbortController: null,
      terminalResult: null,
      manualInterventionPending: false,
      interruptRequested: false,
      deleted: false,
    };

    sessions.set(session.sessionId, session);
    const key = getWindowKey(session.originWorkspaceId, session.originWindowId);
    const nextIds = [
      session.sessionId,
      ...getWindowSessionIds(session.originWorkspaceId, session.originWindowId),
    ];
    sessionIdsByWindowKey.set(key, nextIds);
    emitUpdate(session, "created");
    return session;
  }

  function removeSessionFromWindow(session: AgentSessionState) {
    const key = getWindowKey(session.originWorkspaceId, session.originWindowId);
    const remaining = getWindowSessionIds(session.originWorkspaceId, session.originWindowId)
      .filter((sessionId) => sessionId !== session.sessionId);
    if (remaining.length > 0) {
      sessionIdsByWindowKey.set(key, remaining);
      return;
    }
    sessionIdsByWindowKey.delete(key);
  }

  function listSessions(input: { workspaceId: string; windowId: number }) {
    adoptStaleSessionsForWindow(input.workspaceId, input.windowId);
    return getWindowSessionIds(input.workspaceId, input.windowId)
      .map((sessionId) => sessions.get(sessionId))
      .filter((session): session is AgentSessionState => session !== undefined && !session.deleted)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((session) => buildListItem(session));
  }

  async function createSession(
    input: {
      workspaceId: string;
      windowId: number;
      scope?: AgentSessionScope;
      tabId?: string;
      content?: string;
      privacyMode?: boolean;
      profile?: AgentSessionProfile;
    },
  ): Promise<AgentSessionSnapshot> {
    const session = createSessionState(input);
    const content = input.content?.trim();
    if (!content) {
      return buildSnapshot(session);
    }
    return sendUserMessage({
      sessionId: session.sessionId,
      content,
    });
  }

  function ensureSession(input: { workspaceId: string; windowId: number }) {
    adoptStaleSessionsForWindow(input.workspaceId, input.windowId);
    const existingSession = getWindowSessionIds(input.workspaceId, input.windowId)
      .map((sessionId) => sessions.get(sessionId))
      .find((session): session is AgentSessionState => session !== undefined && !session.deleted);
    if (existingSession) {
      return buildSnapshot(existingSession);
    }

    return buildSnapshot(createSessionState(input));
  }

  function getSession(sessionId: string) {
    const session = sessions.get(sessionId);
    if (!session || session.deleted) {
      return null;
    }
    return buildSnapshot(session);
  }

  function sessionOwnsTab(session: AgentSessionState, tabId: string) {
    if (session.automationTabId === tabId) {
      return true;
    }
    if (session.originTabId === tabId) {
      return true;
    }
    if (agentOpenedTabSessionIds.get(tabId) === session.sessionId) {
      return true;
    }
    for (const task of session.delegatedTasks.values()) {
      if (task.tabId === tabId) {
        return true;
      }
    }
    for (const browserSession of session.runtimeContext.browserSessions.values()) {
      if (browserSession.tabId === tabId) {
        return true;
      }
    }
    return false;
  }

  function recordAgentOpenedTab(input: { tabId: string; openerTabId?: string }) {
    const tabId = input.tabId.trim();
    const openerTabId = input.openerTabId?.trim();
    if (!tabId || !openerTabId) {
      return;
    }

    const openerSessionId = agentOpenedTabSessionIds.get(openerTabId);
    const openerSession = openerSessionId ? sessions.get(openerSessionId) : undefined;
    const session = openerSession && !openerSession.deleted
      ? openerSession
      : Array.from(sessions.values())
        .filter((candidate) => !candidate.deleted)
        .find((candidate) => sessionOwnsTab(candidate, openerTabId));
    if (session) {
      agentOpenedTabSessionIds.set(tabId, session.sessionId);
    }
  }

  function getSessionForTab(input: { windowId?: number; tabId: string }) {
    const tabId = input.tabId.trim();
    if (!tabId) {
      return null;
    }

    const candidates = Array.from(sessions.values())
      .filter((session) => !session.deleted)
      .filter((session) => {
        if (input.windowId !== undefined && session.windowId !== input.windowId && session.originWindowId !== input.windowId) {
          return false;
        }
        return session.automationTabId === tabId || session.originTabId === tabId;
      })
      .sort((left, right) => right.updatedAt - left.updatedAt);

    return candidates[0] ? buildSnapshot(candidates[0]) : null;
  }

  function rebindSessionToTab(input: {
    sessionId: string;
    workspaceId: string;
    windowId: number;
    tabId: string;
  }) {
    const session = sessions.get(input.sessionId);
    if (!session || session.deleted) {
      throw new Error(`Agent session ${input.sessionId} was not found.`);
    }

    const tabId = input.tabId.trim();
    if (!tabId) {
      throw new Error("Agent session rebind requires a tab id.");
    }

    const windowContext = options.getWindowContext(input.windowId);
    const targetTab = windowContext.tabs.find((tab) => tab.id === tabId);
    if (!targetTab) {
      throw new Error(`Agent session cannot bind to tab ${tabId} in window ${input.windowId}.`);
    }

    session.scope = "current-tab";
    session.workspaceId = input.workspaceId;
    session.windowId = input.windowId;
    session.originWorkspaceId = input.workspaceId;
    session.originWindowId = input.windowId;
    session.automationTabId = tabId;
    session.originTabId = tabId;
    if (!session.originUrl) {
      session.originUrl = targetTab.url;
    }
    if (!session.originTitle) {
      session.originTitle = targetTab.title;
    }
    session.automationWorkspaceBound = false;
    session.transportMessages = refreshCurrentTabScopeTransportMessage(
      session.transportMessages,
      session.scope,
      tabId,
    );
    emitUpdate(session, "context");
    return buildSnapshot(session);
  }

  async function sendUserMessage(input: { sessionId: string; content: string }): Promise<AgentSessionSnapshot> {
    const session = sessions.get(input.sessionId);
    if (!session || session.deleted) {
      throw new Error(`Agent session ${input.sessionId} was not found.`);
    }

    const content = input.content.trim();
    if (!content) {
      return buildSnapshot(session);
    }

    session.lastError = undefined;
    session.terminalResult = null;
    if (
      session.status === "interrupted"
      || session.status === "error"
      || !session.runningPromise
      || session.activeAbortController?.signal.aborted
    ) {
      repairSessionTransportMessages(session);
    }
    if (session.status === "interrupted" || session.status === "error") {
      session.status = "idle";
    }
    session.transportMessages.push({
      role: "user",
      content,
    });
    pushUiMessage(session, createUiMessage({
      role: "user",
      kind: "message",
      content,
      state: "completed",
    }));
    emitUpdate(session, "message");
    startRunIfNeeded(session);
    return buildSnapshot(session);
  }

  function setSessionSchedule(input: AgentSessionScheduleInput): AgentSessionSnapshot {
    const session = sessions.get(input.sessionId);
    if (!session || session.deleted) {
      throw new Error(`Agent session ${input.sessionId} was not found.`);
    }

    const cronExpression = normalizeCronExpression(input.cronExpression);
    if (!cronExpression) {
      throw new Error(
        options.resolveUiLocale() === "zh-CN"
          ? "请输入 cron 表达式。"
          : "Enter a cron expression.",
      );
    }
    const prompt = resolveSchedulePrompt(session, input.prompt);
    let nextRunAt: number | null;
    try {
      nextRunAt = computeNextScheduleRunAt(cronExpression);
    } catch (error) {
      throw new Error(
        options.resolveUiLocale() === "zh-CN"
          ? `Cron 表达式无效：${error instanceof Error ? error.message : String(error)}`
          : `Invalid cron expression: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (nextRunAt === null) {
      throw new Error(
        options.resolveUiLocale() === "zh-CN"
          ? "无法在允许的时间范围内计算下一次执行时间。"
          : "Failed to compute the next scheduled run within the supported lookahead window.",
      );
    }

    session.schedule = {
      prompt,
      cronExpression,
      timezone: getLocalTimeZone(),
      nextRunAt,
      ...(session.schedule?.lastTriggeredAt !== undefined
        ? { lastTriggeredAt: session.schedule.lastTriggeredAt }
        : {}),
      ...(session.schedule?.lastTriggerStatus
        ? { lastTriggerStatus: session.schedule.lastTriggerStatus }
        : {}),
      ...(session.schedule?.lastTriggerError
        ? { lastTriggerError: session.schedule.lastTriggerError }
        : {}),
    };
    armSessionScheduleTimeSource(session);
    emitUpdate(session, "schedule");
    return buildSnapshot(session);
  }

  function clearSessionSchedule(sessionId: string): AgentSessionSnapshot {
    const session = sessions.get(sessionId);
    if (!session || session.deleted) {
      throw new Error(`Agent session ${sessionId} was not found.`);
    }

    clearSessionScheduleTimeSource(sessionId);
    session.schedule = null;
    emitUpdate(session, "schedule");
    return buildSnapshot(session);
  }

  function listAgentLaunchSchedules() {
    return Array.from(agentLaunchSchedules.values())
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((schedule) => cloneAgentLaunchSchedule(schedule)!);
  }

  function getAgentLaunchSchedule(triggerId: string) {
    return cloneAgentLaunchSchedule(agentLaunchSchedules.get(triggerId));
  }

  function setAgentLaunchSchedule(input: AgentLaunchScheduleInput) {
    const cronExpression = normalizeCronExpression(input.cronExpression);
    if (!cronExpression) {
      throw new Error(
        options.resolveUiLocale() === "zh-CN"
          ? "请输入 cron 表达式。"
          : "Enter a cron expression.",
      );
    }
    const prompt = input.prompt.trim();
    if (!prompt) {
      throw new Error(
        options.resolveUiLocale() === "zh-CN"
          ? "请输入新 Agent 要执行的消息。"
          : "Enter the message the new agent should run.",
      );
    }

    let nextRunAt: number | null;
    try {
      nextRunAt = computeNextScheduleRunAt(cronExpression);
    } catch (error) {
      throw new Error(
        options.resolveUiLocale() === "zh-CN"
          ? `Cron 表达式无效：${error instanceof Error ? error.message : String(error)}`
          : `Invalid cron expression: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (nextRunAt === null) {
      throw new Error(
        options.resolveUiLocale() === "zh-CN"
          ? "无法在允许的时间范围内计算下一次执行时间。"
          : "Failed to compute the next scheduled run within the supported lookahead window.",
      );
    }

    const now = Date.now();
    const existing = input.triggerId ? agentLaunchSchedules.get(input.triggerId) : undefined;
    const requestedTriggerId = input.triggerId?.trim();
    const triggerId = existing?.triggerId ?? (requestedTriggerId || randomUUID());
    const scope = input.scope === "current-tab" ? "current-tab" : "default";
    const profile: AgentSessionProfile =
      input.profile === "organizer" || input.profile === "widget-builder" ? input.profile : "default";
    const schedule: AgentLaunchScheduleSnapshot = {
      triggerId,
      workspaceId: input.workspaceId,
      windowId: input.windowId,
      scope,
      privacyMode: input.privacyMode !== false,
      profile,
      prompt,
      cronExpression,
      timezone: getLocalTimeZone(),
      nextRunAt,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(scope === "current-tab" && input.tabId?.trim() ? { tabId: input.tabId.trim() } : {}),
      ...(input.title?.trim() ? { title: input.title.trim() } : {}),
      ...(existing?.lastTriggeredAt !== undefined ? { lastTriggeredAt: existing.lastTriggeredAt } : {}),
      ...(existing?.lastTriggerStatus ? { lastTriggerStatus: existing.lastTriggerStatus } : {}),
      ...(existing?.lastTriggerError ? { lastTriggerError: existing.lastTriggerError } : {}),
      ...(existing?.lastSessionId ? { lastSessionId: existing.lastSessionId } : {}),
    };
    agentLaunchSchedules.set(triggerId, schedule);
    armAgentLaunchSchedule(schedule);
    saveAgentLaunchSchedules();
    return cloneAgentLaunchSchedule(schedule)!;
  }

  function clearAgentLaunchSchedule(triggerId: string) {
    const normalizedTriggerId = triggerId.trim();
    if (!normalizedTriggerId) {
      return null;
    }
    clearAgentLaunchScheduleTimeSource(normalizedTriggerId);
    const existing = agentLaunchSchedules.get(normalizedTriggerId);
    agentLaunchSchedules.delete(normalizedTriggerId);
    saveAgentLaunchSchedules();
    return cloneAgentLaunchSchedule(existing);
  }

  function interruptSession(sessionId: string) {
    const session = sessions.get(sessionId);
    if (!session || session.deleted) {
      throw new Error(`Agent session ${sessionId} was not found.`);
    }

    session.queuedTurn = false;
    session.lastError = undefined;
    session.interruptRequested = true;
    session.status = "interrupted";

    if (session.activeAbortController && !session.activeAbortController.signal.aborted) {
      session.activeAbortController.abort(new Error(getInterruptionMessage()));
    } else if (!session.runningPromise) {
      session.interruptRequested = false;
    }
    cancelAllDelegatedTasks(session, "Delegated task cancelled because the parent session was interrupted.");
    void stopSessionEventWatcher(sessionId);

    emitUpdate(session, "status");
    return buildSnapshot(session);
  }

  function resumeSession(sessionId: string) {
    const session = sessions.get(sessionId);
    if (!session || session.deleted) {
      throw new Error(`Agent session ${sessionId} was not found.`);
    }

    session.interruptRequested = false;
    session.lastError = undefined;
    if (session.status === "interrupted" || session.status === "error") {
      session.status = "idle";
      emitUpdate(session, "status");
    }
    syncSessionEventWatcher(session);
    return buildSnapshot(session);
  }

  function listBoundSessionsForWorkspace(
    workspaceId: string,
    options?: { excludeSessionId?: string },
  ): AgentWorkspaceBindingSummary[] {
    return Array.from(sessions.values())
      .filter((session) =>
        !session.deleted
        && session.automationWorkspaceBound
        && session.workspaceId === workspaceId
        && session.sessionId !== options?.excludeSessionId)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((session) => ({
        sessionId: session.sessionId,
        title: getSessionTitle(session),
      }));
  }

  function requireMainAgentMcpSession(sessionId: string) {
    const session = sessions.get(sessionId);
    if (!session || session.deleted) {
      throw new Error(`Agent session ${sessionId} was not found.`);
    }
    if (session.agentId !== MAIN_BROWSER_AGENT_ID) {
      throw new Error(`Agent session ${sessionId} does not support MCP tool export.`);
    }
    if (!options.getAgentPreferences().mcpToolExportEnabled) {
      throw new Error("Main agent MCP tool export is disabled in settings.");
    }
    return session;
  }

  function buildMainAgentMcpToolExport(): AgentMcpToolExport {
    return {
      name: MAIN_AGENT_MCP_TOOL_NAME,
      description:
        "Send a task to Milo's main browser agent. "
        + "The export auto-targets the bound session or the active Milo window and returns a final summary when the run finishes.",
      inputSchema: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "Instruction for Milo's main browser agent.",
          },
        },
        required: ["task"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: {
          ok: {
            type: "boolean",
          },
          status: {
            type: "string",
            enum: ["completed", "needs_user", "blocked", "failed"],
          },
          sessionId: {
            type: "string",
          },
          title: {
            type: "string",
          },
          workspaceId: {
            type: "string",
          },
          windowId: {
            type: "number",
          },
          automationWorkspaceBound: {
            type: "boolean",
          },
          createdSession: {
            type: "boolean",
          },
          summary: {
            type: "string",
          },
          nextStep: {
            type: "string",
          },
          error: {
            type: "string",
          },
        },
        required: [
          "ok",
          "status",
          "sessionId",
          "title",
          "workspaceId",
          "windowId",
          "automationWorkspaceBound",
          "createdSession",
        ],
        additionalProperties: false,
      },
      risk: "medium",
      tags: ["agent", "browser", "mcp"],
    };
  }

  function buildMainAgentMcpServerExport(): McpServerExport {
    return {
      server: {
        name: MAIN_AGENT_MCP_SERVER_NAME,
        version: "0.1.0",
      },
      tools: [buildMainAgentMcpToolExport()],
    };
  }

  function getMostRecentMainAgentSessionForWindow(workspaceId: string, windowId: number) {
    return Array.from(sessions.values())
      .filter((session) =>
        !session.deleted
        && session.agentId === MAIN_BROWSER_AGENT_ID
        && session.originWorkspaceId === workspaceId
        && session.originWindowId === windowId)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
  }

  function resolveMainAgentMcpTargetWindow(input: Record<string, unknown>) {
    const explicitWindowId = readWindowIdNumber(input.windowId);
    if (explicitWindowId !== undefined) {
      if (!options.isWindowOpen(explicitWindowId)) {
        throw new Error(`Window ${explicitWindowId} is not available.`);
      }
      const workspaceId = options.resolveWorkspaceIdForWindow?.(explicitWindowId);
      if (!workspaceId) {
        throw new Error(`Window ${explicitWindowId} is not attached to a Milo workspace.`);
      }
      adoptStaleSessionsForWindow(workspaceId, explicitWindowId);
      return {
        workspaceId,
        windowId: explicitWindowId,
      };
    }

    const fallbackTarget = options.resolveDefaultMcpTarget?.();
    if (!fallbackTarget || !options.isWindowOpen(fallbackTarget.windowId)) {
      throw new Error("No open Milo workspace window is available for MCP main-agent requests.");
    }
    adoptStaleSessionsForWindow(fallbackTarget.workspaceId, fallbackTarget.windowId);
    return fallbackTarget;
  }

  function resolveMainAgentMcpSession(
    input: Record<string, unknown>,
    config?: { boundSessionId?: string },
  ) {
    const explicitSessionId = readString(input.sessionId);
    if (config?.boundSessionId) {
      if (explicitSessionId && explicitSessionId !== config.boundSessionId) {
        throw new Error(
          `${MAIN_AGENT_MCP_TOOL_NAME} is already bound to session ${config.boundSessionId} and cannot target session ${explicitSessionId}.`,
        );
      }
      return {
        session: requireMainAgentMcpSession(config.boundSessionId),
        createdSession: false,
      };
    }

    if (!options.getAgentPreferences().mcpToolExportEnabled) {
      throw new Error("Main agent MCP tool export is disabled in settings.");
    }

    const createNewSession = readBoolean(input.createNewSession) === true;
    if (explicitSessionId) {
      if (createNewSession) {
        throw new Error(`${MAIN_AGENT_MCP_TOOL_NAME} cannot combine sessionId with createNewSession=true.`);
      }
      return {
        session: requireMainAgentMcpSession(explicitSessionId),
        createdSession: false,
      };
    }

    const target = resolveMainAgentMcpTargetWindow(input);
    const reusableSession = createNewSession
      ? null
      : getMostRecentMainAgentSessionForWindow(target.workspaceId, target.windowId);
    if (reusableSession && !reusableSession.runningPromise) {
      return {
        session: reusableSession,
        createdSession: false,
      };
    }

    return {
      session: createSessionState({
        workspaceId: target.workspaceId,
        windowId: target.windowId,
        privacyMode: readBoolean(input.privacyMode) !== false,
      }),
      createdSession: true,
    };
  }

  function buildMainAgentMcpCallBaseResult(session: AgentSessionState, createdSession: boolean) {
    return {
      sessionId: session.sessionId,
      title: getSessionTitle(session),
      workspaceId: session.workspaceId,
      windowId: session.windowId,
      automationWorkspaceBound: session.automationWorkspaceBound,
      createdSession,
    };
  }

  function buildMainAgentMcpFailureResult(
    session: AgentSessionState,
    createdSession: boolean,
    error: string,
  ) {
    return {
      ok: false,
      status: "failed" as const,
      ...buildMainAgentMcpCallBaseResult(session, createdSession),
      error,
    };
  }

  function buildMainAgentMcpSuccessResult(
    session: AgentSessionState,
    createdSession: boolean,
    result: AgentFinishResult,
  ) {
    return {
      ok: true,
      status: result.status,
      ...buildMainAgentMcpCallBaseResult(session, createdSession),
      summary: result.summary,
      ...(result.nextStep ? { nextStep: result.nextStep } : {}),
    };
  }

  async function waitForMainAgentMcpRun(
    session: AgentSessionState,
    createdSession: boolean,
  ) {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      let settled = false;
      let unsubscribe: (() => void) | null = null;

      const cleanup = () => {
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      };

      const maybeResolve = () => {
        if (settled) {
          return true;
        }

        if (session.deleted) {
          settled = true;
          cleanup();
          reject(new Error(`Agent session ${session.sessionId} was deleted before the MCP call completed.`));
          return true;
        }

        if (session.runningPromise) {
          return false;
        }

        if (session.terminalResult) {
          settled = true;
          cleanup();
          resolve(buildMainAgentMcpSuccessResult(session, createdSession, session.terminalResult));
          return true;
        }

        if (session.status === "error") {
          settled = true;
          cleanup();
          resolve(buildMainAgentMcpFailureResult(
            session,
            createdSession,
            session.lastError ?? "Main agent run failed.",
          ));
          return true;
        }

        if (session.status === "interrupted") {
          settled = true;
          cleanup();
          resolve(buildMainAgentMcpFailureResult(session, createdSession, getInterruptionMessage()));
          return true;
        }

        return false;
      };

      if (maybeResolve()) {
        return;
      }

      unsubscribe = subscribe((update) => {
        if (update.sessionId === session.sessionId) {
          maybeResolve();
        }
      });
      maybeResolve();
    });
  }

  async function callMainAgentMcpTool(
    name: string,
    input: Record<string, unknown>,
    config?: { boundSessionId?: string },
  ) {
    if (name !== MAIN_AGENT_MCP_TOOL_NAME) {
      throw new Error(`Tool ${name} is no longer part of the public MCP surface.`);
    }

    const task = readString(input.task);
    if (!task) {
      throw new Error(`${MAIN_AGENT_MCP_TOOL_NAME} requires a non-empty task.`);
    }

    const { session, createdSession } = resolveMainAgentMcpSession(input, config);
    if (session.runningPromise) {
      throw new Error("Main agent session is busy. Wait for it to finish or interrupt it before retrying.");
    }

    await sendUserMessage({
      sessionId: session.sessionId,
      content: task,
    });
    return waitForMainAgentMcpRun(session, createdSession);
  }

  async function exportSessionMcp(sessionId: string): Promise<AgentMcpServerExport> {
    const session = requireMainAgentMcpSession(sessionId);
    const exported = buildMainAgentMcpServerExport();

    return {
      sessionId: session.sessionId,
      title: getSessionTitle(session),
      workspaceId: session.workspaceId,
      windowId: session.windowId,
      ...(session.automationTabId ? { tabId: session.automationTabId } : {}),
      automationWorkspaceBound: session.automationWorkspaceBound,
      server: exported.server,
      tools: exported.tools,
    };
  }

  async function callSessionMcpTool(input: AgentMcpToolCallInput): Promise<McpToolResultEnvelope> {
    try {
      const result = await callMainAgentMcpTool(
        input.name,
        isRecord(input.input) ? input.input : {},
        { boundSessionId: input.sessionId },
      );
      return wrapMcpToolResult(result);
    } catch (error) {
      return wrapMcpToolError(input.name, error);
    }
  }

  function exportHttpMcp(): McpServerExport {
    return buildMainAgentMcpServerExport();
  }

  async function callHttpMcpTool(input: {
    name: string;
    input?: Record<string, unknown> | null;
  }) {
    return callMainAgentMcpTool(
      input.name,
      isRecord(input.input) ? input.input : {},
    );
  }

  function deleteSession(sessionId: string): AgentSessionDeleteResult {
    const session = sessions.get(sessionId);
    if (!session || session.deleted) {
      return {
        sessionId,
        deleted: false,
      };
    }

    const boundWorkspaceId = session.automationWorkspaceBound ? session.workspaceId : undefined;
    session.deleted = true;
    clearSessionScheduleTimeSource(sessionId);
    void stopSessionEventWatcher(sessionId);
    session.queuedTurn = false;
    cancelAllDelegatedTasks(session, "Delegated task cancelled because the parent session was deleted.");
    removeSessionFromWindow(session);
    if (session.runtimeContext.browserSessions.size > 0) {
      notifyControlledTabsChanged(session);
    }
    if (session.activeAbortController && !session.activeAbortController.signal.aborted) {
      session.interruptRequested = true;
      session.activeAbortController.abort(new Error(getInterruptionMessage()));
    }
    emitUpdate(session, "deleted");
    if (!session.runningPromise) {
      cleanupDeletedSession(session);
    }
    if (
      boundWorkspaceId
      && listBoundSessionsForWorkspace(boundWorkspaceId, { excludeSessionId: session.sessionId }).length === 0
    ) {
      try {
        options.onAutomationWorkspaceReleased?.({
          sessionId: session.sessionId,
          workspaceId: boundWorkspaceId,
        });
      } catch (error) {
        console.error(
          `[Agent] Failed to release automation workspace ${boundWorkspaceId} for session ${session.sessionId}.`,
          error,
        );
      }
    }

    return {
      sessionId,
      deleted: true,
    };
  }

  loadState();
  loadAgentLaunchSchedules();
  for (const session of sessions.values()) {
    armSessionScheduleTimeSource(session);
    syncSessionEventWatcher(session);
  }
  for (const schedule of agentLaunchSchedules.values()) {
    armAgentLaunchSchedule(schedule);
  }

  function isTabControlled(tabId: string) {
    for (const session of sessions.values()) {
      if (session.deleted || !options.isWindowOpen(session.windowId)) {
        continue;
      }
      for (const task of session.delegatedTasks.values()) {
        if (!isDelegatedTaskTerminalStatus(task.status) && task.tabId === tabId) {
          return true;
        }
      }
      for (const browserSession of session.runtimeContext.browserSessions.values()) {
        if (browserSession.tabId === tabId) {
          return true;
        }
      }
    }
    return false;
  }

  return {
    ensureSession,
    listSessions,
    listBoundSessionsForWorkspace,
    createSession,
    getSession,
    recordAgentOpenedTab,
    getSessionForTab,
    rebindSessionToTab,
    sendUserMessage,
    setSessionSchedule,
    clearSessionSchedule,
    listAgentLaunchSchedules,
    getAgentLaunchSchedule,
    setAgentLaunchSchedule,
    clearAgentLaunchSchedule,
    interruptSession,
    resumeSession,
    deleteSession,
    exportSessionMcp,
    callSessionMcpTool,
    exportHttpMcp,
    callHttpMcpTool,
    isTabControlled,
    flushState,
    subscribe,
  };
}
