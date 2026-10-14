import { randomUUID } from "node:crypto";
import { BrowserWindow, type WebContentsView } from "electron";
import type { CdpEventHandler, CdpEventSubscriptionOptions } from "../shared/cdp-session.js";
import {
  ToolRegistry,
  ToolSchemas,
  validateToolExists,
  type JSONSchema,
  type ToolDefinition,
  type ToolName as InternalToolName,
} from "./tool-schemas.js";
import {
  PUBLIC_PRESS_KEY_VALUES,
  PublicToolRegistry,
  PublicToolSchemas,
  validatePublicToolExists,
  type PublicPressKey,
  type PublicToolName,
} from "./public-tool-schemas.js";
import type {
  BrowserAutomationEvent,
  BrowserAutomationEventSubscribeOptions,
} from "./browser-event-bus.js";
import type { CreateTabOptions } from "../shared/contracts.js";
import type { OrganizerSidebarState } from "../agent/browser-organizer.js";

interface TabRecordLike {
  id: string;
  url: string;
  title: string;
  displayUrl: string;
  favicon?: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

interface TabListSummary {
  tabId: string;
  windowId: string;
  workspaceId: string;
  title: string;
  url: string;
  displayUrl: string;
  favicon?: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isActive: boolean;
}

interface TabOrganizationTabSummary {
  tabId: string;
  title: string;
  url: string;
  displayUrl: string;
  favicon?: string;
  isActive: boolean;
}

interface TabOrganizationGroupSummary {
  folderId: string;
  title: string;
  icon?: string;
  backgroundColor?: string;
  isExpanded: boolean;
  tabCount: number;
  tabs: TabOrganizationTabSummary[];
}

interface TabOrganizationSplitSummary {
  splitId: string;
  mode: "horizontal" | "vertical" | "bento";
  tabCount: number;
  focusedTabId: string;
  syncScroll: boolean;
  tabs: TabOrganizationTabSummary[];
}

interface TabOrganizationSummary {
  windowId: string;
  workspaceId: string;
  activeTabId?: string;
  totalTabCount: number;
  rootTabCount: number;
  groupCount: number;
  splitCount: number;
  groupedTabCount: number;
  splitTabCount: number;
  rootTabs: TabOrganizationTabSummary[];
  groups: TabOrganizationGroupSummary[];
  splits: TabOrganizationSplitSummary[];
}

interface BrowserSessionRef {
  sessionId: string;
  tabId: string;
  frameId?: string;
  userId?: string;
}

interface AttachedSession {
  ref: BrowserSessionRef;
  workspaceId: string;
  contentsId: number;
  attachedAt: number;
  leaseId: string;
  observeOnly: boolean;
  latestSnapshotId?: string;
}

interface PublicPressStateSnapshot {
  url?: string;
  bodyText?: string;
  activeSelector?: string;
  selector?: string;
  value?: string;
  text?: string;
  selectedIndex?: number;
  ariaSelected?: string;
  ariaExpanded?: string;
  activeDescendant?: string;
  selectionText?: string;
  isFocused?: boolean;
}

interface PageRefLike {
  sessionId: string;
  tabId: string;
  frameId?: string;
  userId?: string;
  documentId: string;
  leaseId: string;
  observeOnly: boolean;
}

type RawEvent = Record<string, unknown> & {
  kind: string;
  ts: number;
  seq?: number;
};

interface EventCaptureState {
  captureId: string;
  sessionId: string;
  ref: BrowserSessionRef;
  contentsId: number;
  startedAt: number;
  stoppedAt?: number;
  channels: Set<string>;
  sampleMouseMove: boolean;
  redactTextInput: boolean;
  events: RawEvent[];
  lastSeq: number;
  droppedEvents: number;
  waiters: Map<string, EventAwaitWaiter>;
  mutationAxSnapshots: Map<string, MutationAxSnapshot>;
  stopListening: () => void;
}

interface EventAwaitMatchConfig {
  kinds?: Set<string>;
  tabId?: string;
  openerTabId?: string;
  windowId?: string;
  source?: string;
  urlPattern?: RegExp;
  titlePattern?: RegExp;
  summaryPattern?: RegExp;
}

interface EventAwaitResult {
  subscriptionId: string;
  events: RawEvent[];
  matched: boolean;
  timedOut: boolean;
  dropped: boolean;
  nextCursor?: Record<string, unknown>;
  event?: RawEvent;
}

interface EventAwaitWaiter {
  waiterId: string;
  cursor?: {
    ts: number;
    seq: number;
    dropped: boolean;
  };
  matcher: EventAwaitMatchConfig;
  maxEvents: number;
  coalesceMs: number;
  matchedEvents: RawEvent[];
  dropped: boolean;
  timeoutTimer?: NodeJS.Timeout;
  settleTimer?: NodeJS.Timeout;
  abortSignal?: AbortSignal;
  abortListener?: () => void;
  resolve: (result: EventAwaitResult) => void;
  reject: (error: Error) => void;
}

interface AccessibilityNodeRecord {
  nodeId: string;
  backendDOMNodeId?: number;
  parentId?: string;
  childIds: string[];
  ignored: boolean;
  role?: string;
  name?: string;
  description?: string;
  value?: string;
  disabled?: boolean;
  focused?: boolean;
  expanded?: boolean;
  selected?: boolean;
  invalid?: boolean;
  required?: boolean;
  level?: number;
  url?: string;
}

interface MutationAxNodeSummary {
  axNodeId: string;
  role?: string;
  name?: string;
  ignored: boolean;
}

interface MutationAxSnapshot {
  node: MutationAxNodeSummary & {
    description?: string;
    value?: string;
  };
  path: MutationAxNodeSummary[];
  children: MutationAxNodeSummary[];
  diffChildren: MutationAxNodeSummary[];
  childCount: number;
}

interface PublicTargetInput {
  axNodeId?: string;
  backendNodeId?: number;
  selector?: string;
}

type HandleKind = "element" | "form" | "region";

interface LiveHandleState {
  handleId: string;
  sessionId: string;
  kind: HandleKind;
  fingerprint: string;
  snapshotId: string;
  generation: number;
  stale: boolean;
  role?: string;
  name?: string;
  description?: string;
  locator?: string;
  targetElementId?: string;
  targetFormId?: string;
  targetRegionId?: string;
}

const REGION_ROLES = [
  "header",
  "nav",
  "sidebar",
  "main",
  "panel",
  "list",
  "table",
  "form",
  "dialog",
  "footer",
  "unknown",
] as const;

type RegionRole = (typeof REGION_ROLES)[number];

const ELEMENT_ROLES = [
  "button",
  "link",
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "combobox",
  "slider",
  "tab",
  "menuitem",
  "row",
  "cell",
  "heading",
  "text",
  "image",
  "unknown",
] as const;

type ElementRole = (typeof ELEMENT_ROLES)[number];

const INFORMATION_TYPES = [
  "text",
  "image",
  "table",
  "list",
  "card_group",
  "article",
  "metric_group",
] as const;

type InformationType = (typeof INFORMATION_TYPES)[number];

const CAPABILITY_TYPES = [
  "button",
  "input_text",
  "select",
  "checkbox",
  "radio",
  "slider",
  "tab_switcher",
  "pagination",
  "submit",
] as const;

type CapabilityType = (typeof CAPABILITY_TYPES)[number];

const CAPABILITY_ACTION_TYPES = [
  "click",
  "type",
  "select",
  "drag",
  "submit_form",
  "press",
  "scroll",
] as const;

type CapabilityActionType = (typeof CAPABILITY_ACTION_TYPES)[number];

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PageRegion {
  regionId: string;
  role: RegionRole;
  name?: string;
  bbox: Rect;
  inViewport: boolean;
  textSummary?: string;
  childElementIds: string[];
}

interface PageForm {
  formId: string;
  regionId: string;
  name?: string;
  description?: string;
  method?: string;
  action?: string;
  bbox: Rect;
  inViewport: boolean;
  textSummary?: string;
  controlElementIds: string[];
  submitActionElementIds: string[];
  locatorHints: string[];
}

interface PageInformationBlock {
  blockId: string;
  regionId: string;
  type: InformationType;
  title?: string;
  summary?: string;
  bbox: Rect;
  inViewport: boolean;
  confidence: number;
  itemCount?: number;
  extractable: boolean;
  sourceElementIds: string[];
  relatedCapabilityIds: string[];
  regionHandleId?: string;
}

interface PageCapability {
  capabilityId: string;
  regionId: string;
  formId?: string;
  elementId?: string;
  type: CapabilityType;
  title?: string;
  label?: string;
  description?: string;
  bbox?: Rect;
  visible: boolean;
  enabled: boolean;
  confidence: number;
  actions: CapabilityActionType[];
  evidence: string[];
  relatedBlockIds: string[];
  handleId?: string;
}

interface ElementCapabilityProfile {
  type?: CapabilityType;
  actions: CapabilityActionType[];
  confidence: number;
  evidence: string[];
}

interface RegionInformationProfile {
  type: InformationType;
  confidence: number;
  itemCount?: number;
  extractable: boolean;
  sourceElementIds: string[];
  title?: string;
  summary?: string;
}

interface SemanticElement {
  elementId: string;
  regionId: string;
  formId?: string;
  role: ElementRole;
  name?: string;
  description?: string;
  associatedLabel?: string;
  text?: string;
  value?: string;
  tagName?: string;
  htmlType?: string;
  bbox?: Rect;
  visible: boolean;
  enabled?: boolean;
  isHitTestable: boolean;
  focusable: boolean;
  editable?: boolean;
  pointerCursor?: boolean;
  clickableHint?: boolean;
  keyboardHint?: boolean;
  draggable?: boolean;
  isLeaf: boolean;
  isContainer: boolean;
  isPrimaryActionCandidate: boolean;
  interactivityScore: number;
  selected?: boolean;
  checked?: boolean;
  pressed?: boolean;
  expanded?: boolean;
  primaryCapabilityType?: CapabilityType;
  supportedActions?: CapabilityActionType[];
  capabilityConfidence?: number;
  capabilityEvidence?: string[];
  backendNodeId?: number;
  axNodeId?: string;
  locatorHints?: string[];
  visualSignature?: string;
}

interface StoredSnapshot {
  snapshotId: string;
  sessionId: string;
  capturedAt: number;
  url: string;
  regions: PageRegion[];
  forms: PageForm[];
  elements: SemanticElement[];
  information: PageInformationBlock[];
  capabilities: PageCapability[];
  elementLocatorById: Map<string, string>;
  regionLocatorById: Map<string, string>;
  formLocatorById: Map<string, string>;
}

interface ExecutedAction {
  actionId: string;
  sessionId: string;
  performedAt: number;
  actionType: "click" | "hover" | "type" | "select" | "scroll" | "press" | "drag" | "submit_form";
  preUrl: string;
  preTitle: string;
  accepted: boolean;
  effective: boolean;
  emittedEvents: string[];
  urlChanged: boolean;
  domChanged: boolean;
  networkTriggered: boolean;
  focusedElementChanged: boolean;
  visibleTextChanged: boolean;
  stateChanged: boolean;
  errorObserved: boolean;
  errorMessages: string[];
  reason?: string;
  preSnapshotId?: string;
  postSnapshotId?: string;
  targetElementId?: string;
  targetFormId?: string;
}

interface SnapshotDiff {
  beforeSnapshotId: string;
  afterSnapshotId: string;
  urlChanged: boolean;
  domChanged: boolean;
  visibleTextChanged: boolean;
  stateChanged: boolean;
  changedRegionIds: string[];
  mainRegionChangeRatio: number;
  significance: "none" | "minor" | "major";
  summary: string;
}

interface RecordExtractionResult {
  sourceRegionId?: string;
  sourceRole?: string;
  recordCount: number;
  records: Array<Record<string, unknown>>;
  schemaValid?: boolean;
  validationErrors?: string[];
}

type PrincipalActionType = "click" | "type" | "select";
type ContextScopeType = "page" | "region" | "form";

interface AutomationMcpContext {
  defaultWorkspaceId: string;
  windowToWorkspace: Map<number, string>;
  tabRecords: Map<number, Map<string, TabRecordLike>>;
  windowActiveTabs: Map<number, string>;
  browserViews: Map<string, WebContentsView>;
  findTabWindowContext: (
    tabId: string,
  ) => {
    windowId: number;
    workspaceId: string;
    isCurrentWorkspace: boolean;
  } | null;
  getSidebarOrganizationState?: (input: {
    windowId: number;
    workspaceId: string;
  }) => OrganizerSidebarState;
  requestWindowClose: (targetWindow: BrowserWindow) => void;
  createWindowForWorkspace: (
    workspaceId: string,
    options: {
      show: boolean;
      focus: boolean;
    },
  ) => BrowserWindow;
  focusWindowById: (windowId: number) => BrowserWindow;
  createTabInWindow: (
    windowId: number,
    url?: string,
    options?: Pick<CreateTabOptions, "activate" | "openerTabId" | "sidebarGroupWithTabId">,
  ) => TabRecordLike;
  closeTabInWindow: (
    windowId: number,
    tabId: string,
  ) => {
    activeTabId: string;
  };
  activateTabInWindow: (windowId: number, tabId: string) => void;
  goBackInTab: (windowId: number, tabId: string) => Promise<boolean>;
  goForwardInTab: (windowId: number, tabId: string) => Promise<boolean>;
  reloadTabInWindow: (
    windowId: number,
    tabId: string,
  ) => Promise<{
    reloading: boolean;
  }>;
  sendContentsCdpCommand: <TResult = unknown>(
    contentsId: number,
    method: string,
    params?: Record<string, unknown>,
  ) => Promise<TResult>;
  subscribeContentsCdpEvents: (
    contentsId: number,
    listener: CdpEventHandler,
    options?: CdpEventSubscriptionOptions,
  ) => Promise<() => void>;
  subscribeBrowserEvents: (
    listener: (event: BrowserAutomationEvent) => void,
    options?: BrowserAutomationEventSubscribeOptions,
  ) => () => void;
}

export interface McpToolExport {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  risk: ToolDefinition["risk"];
  tags: string[];
}

export interface McpServerExport {
  server: {
    name: string;
    version: string;
  };
  tools: McpToolExport[];
}

export interface McpToolResultEnvelope {
  content: Array<Record<string, unknown>>;
  structuredContent: unknown;
  isError?: boolean;
}

export type ToolErrorCategory =
  | "validation"
  | "session"
  | "tool"
  | "execution"
  | "internal";

export interface ToolErrorDetails {
  errorCode: string;
  category: ToolErrorCategory;
  message: string;
  retryable: boolean;
  fieldPath?: string;
  expected?: string;
  provided?: unknown;
  suggestion?: string;
  details?: Record<string, unknown>;
}

type ToolHandler = (input: Record<string, unknown>, options?: ToolCallOptions) => Promise<unknown>;

interface ToolCallOptions {
  signal?: AbortSignal;
  boundWorkspaceId?: string;
  boundTabId?: string;
  boundScope?: "workspace" | "tab";
}

export class AutomationToolError extends Error {
  readonly errorCode: string;
  readonly category: ToolErrorCategory;
  readonly retryable: boolean;
  readonly fieldPath?: string;
  readonly expected?: string;
  readonly provided?: unknown;
  readonly suggestion?: string;
  readonly details?: Record<string, unknown>;

  constructor(payload: ToolErrorDetails) {
    super(payload.message);
    this.name = "AutomationToolError";
    this.errorCode = payload.errorCode;
    this.category = payload.category;
    this.retryable = payload.retryable;
    this.fieldPath = payload.fieldPath;
    this.expected = payload.expected;
    this.provided = payload.provided;
    this.suggestion = payload.suggestion;
    this.details = payload.details;
  }

  toJSON(): ToolErrorDetails {
    return {
      errorCode: this.errorCode,
      category: this.category,
      message: this.message,
      retryable: this.retryable,
      ...(this.fieldPath ? { fieldPath: this.fieldPath } : {}),
      ...(this.expected ? { expected: this.expected } : {}),
      ...(this.provided !== undefined ? { provided: this.provided } : {}),
      ...(this.suggestion ? { suggestion: this.suggestion } : {}),
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

const INTERACTIVE_ROLES = new Set<ElementRole>([
  "button",
  "link",
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "combobox",
  "tab",
  "menuitem",
]);

const INPUT_BRIDGE_PREFIX = "__milo_input_event__:";
const MAX_CAPTURE_EVENTS = 5_000;
const EVENT_SUBSCRIPTION_REPLAY_WINDOW_MS = 3_000;
const DEFAULT_EVENT_AWAIT_TIMEOUT_MS = 10_000;
const MAX_EVENT_AWAIT_TIMEOUT_MS = 120_000;
const DEFAULT_EVENT_AWAIT_COALESCE_MS = 150;
const MAX_EVENT_AWAIT_BATCH = 25;
const MAX_ACTIONS = 500;
const MAX_SNAPSHOTS = 500;
const MAX_ENDED_CAPTURES = 200;
const MAX_HANDLES = 1_000;
const TASK_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "be",
  "by",
  "for",
  "from",
  "go",
  "how",
  "i",
  "in",
  "into",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "please",
  "show",
  "that",
  "the",
  "this",
  "to",
  "up",
  "with",
  "我要",
  "我想",
  "帮我",
  "一下",
  "当前",
  "页面",
  "网页",
  "完成",
  "查看",
  "找到",
  "进行",
  "继续",
]);

const TOOL_ALIASES: Record<string, PublicToolName> = {
  "browser.open_url": "browser_session_open",
  "browser.attach_session": "browser_session_open",
  "context.attach": "browser_session_open",
  "page.open": "browser_session_open",
  "browser.detach_session": "browser_session_close",
  "tab.create": "browser_tab_create",
  "browser.snapshot": "browser_ax_snapshot",
  "browser.page_snapshot": "browser_ax_snapshot",
  "page.snapshot": "browser_ax_snapshot",
  "context.get": "browser_ax_snapshot",
  "context.describe": "browser_ax_snapshot",
  "semantic.capture_page_snapshot": "browser_ax_snapshot",
  "locate.find": "browser_ax_query",
  "context.subscribe": "browser_events_subscribe",
  "observe.start_event_capture": "browser_events_subscribe",
  "context.read": "browser_events_read",
  "observe.read_events": "browser_events_read",
  "context.unsubscribe": "browser_events_unsubscribe",
  "observe.stop_event_capture": "browser_events_unsubscribe",
};

const LEGACY_TOOL_REDIRECTS: Record<string, string> = {
  "context.attach": "browser_session_open",
  "browser.open_url": "browser_session_open",
  "browser.attach_session": "browser_session_open",
  "browser.detach_session": "browser_session_close",
  "tab.create": "browser_tab_create",
  "context.get": "browser_ax_snapshot",
  "context.describe": "browser_ax_snapshot",
  "browser.get_page_context": "browser_ax_snapshot",
  "browser.snapshot": "browser_ax_snapshot",
  "browser.page_snapshot": "browser_ax_snapshot",
  "semantic.capture_page_snapshot": "browser_ax_snapshot",
  "locate.find": "browser_ax_query",
  "context.subscribe": "browser_events_subscribe",
  "observe.start_event_capture": "browser_events_subscribe",
  "context.read": "browser_events_read",
  "observe.read_events": "browser_events_read",
  "context.unsubscribe": "browser_events_unsubscribe",
  "observe.stop_event_capture": "browser_events_unsubscribe",
};

const TOOL_ALIASES_BY_CANONICAL = new Map<PublicToolName, string[]>();
for (const [alias, canonical] of Object.entries(TOOL_ALIASES)) {
  const bucket = TOOL_ALIASES_BY_CANONICAL.get(canonical) ?? [];
  bucket.push(alias);
  TOOL_ALIASES_BY_CANONICAL.set(canonical, bucket);
}

const PUBLIC_PRESS_KEY_TO_ACCELERATOR: Record<PublicPressKey, string> = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Enter: "Enter",
};

const REGION_ROLE_SET = new Set<string>(REGION_ROLES);
const ELEMENT_ROLE_SET = new Set<string>(ELEMENT_ROLES);

function normalizeRegionRole(value: string | undefined): RegionRole {
  const role = value?.trim().toLowerCase();
  if (!role) {
    return "unknown";
  }

  if (REGION_ROLE_SET.has(role)) {
    return role as RegionRole;
  }

  switch (role) {
    case "banner":
      return "header";
    case "navigation":
      return "nav";
    case "complementary":
      return "sidebar";
    case "contentinfo":
      return "footer";
    case "article":
    case "region":
      return "panel";
    default:
      return "unknown";
  }
}

function normalizeElementRole(value: string | undefined): ElementRole {
  const role = value?.trim().toLowerCase();
  if (!role) {
    return "unknown";
  }

  if (ELEMENT_ROLE_SET.has(role)) {
    return role as ElementRole;
  }

  switch (role) {
    case "switch":
      return "checkbox";
    case "listbox":
      return "combobox";
    case "menuitemcheckbox":
    case "menuitemradio":
      return "menuitem";
    case "gridcell":
    case "columnheader":
    case "rowheader":
      return "cell";
    case "heading":
      return "heading";
    case "img":
      return "image";
    case "listitem":
    case "option":
    case "statictext":
    case "paragraph":
      return "text";
    default:
      return "unknown";
  }
}

function assertObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }

  return value as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isMcpToolResultEnvelope(value: unknown): value is McpToolResultEnvelope {
  return (
    isRecord(value) &&
    Array.isArray(value.content) &&
    "structuredContent" in value &&
    value.content.every((entry) => isRecord(entry) && typeof entry.type === "string")
  );
}

function looksLikeStepResult(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    typeof value.status === "string" &&
    typeof value.retryable === "boolean" &&
    Array.isArray(value.evidence) &&
    isRecord(value.page) &&
    !("result" in value)
  );
}

function readString(
  value: Record<string, unknown>,
  key: string,
  required = true,
): string | undefined {
  const incoming = value[key];
  if (incoming === undefined || incoming === null) {
    if (required) {
      throw new Error(`Missing required string field: ${key}`);
    }
    return undefined;
  }

  if (typeof incoming !== "string") {
    throw new Error(`Expected field ${key} to be a string.`);
  }

  return incoming;
}

function readNumber(
  value: Record<string, unknown>,
  key: string,
  required = true,
): number | undefined {
  const incoming = value[key];
  if (incoming === undefined || incoming === null) {
    if (required) {
      throw new Error(`Missing required numeric field: ${key}`);
    }
    return undefined;
  }

  if (typeof incoming !== "number" || Number.isNaN(incoming)) {
    throw new Error(`Expected field ${key} to be a number.`);
  }

  return incoming;
}

function readWindowId(
  value: Record<string, unknown>,
  key: string,
  required = true,
): number | undefined {
  const incoming = value[key];
  if (incoming === undefined || incoming === null) {
    if (required) {
      throw new Error(`Missing required string field: ${key}`);
    }
    return undefined;
  }

  if (typeof incoming === "number" && Number.isFinite(incoming)) {
    return Math.floor(incoming);
  }

  if (typeof incoming !== "string") {
    throw new Error(`Expected field ${key} to be a string windowId.`);
  }

  const trimmed = incoming.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Invalid windowId format for field ${key}: ${incoming}`);
  }

  return Number.parseInt(trimmed, 10);
}

function readBoolean(
  value: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const incoming = value[key];
  if (incoming === undefined || incoming === null) {
    return fallback;
  }

  if (typeof incoming !== "boolean") {
    throw new Error(`Expected field ${key} to be a boolean.`);
  }

  return incoming;
}

function readArray(
  value: Record<string, unknown>,
  key: string,
  required = true,
): unknown[] {
  const incoming = value[key];
  if (incoming === undefined || incoming === null) {
    if (required) {
      throw new Error(`Missing required array field: ${key}`);
    }
    return [];
  }

  if (!Array.isArray(incoming)) {
    throw new Error(`Expected field ${key} to be an array.`);
  }

  return incoming;
}

function toTimestampMs(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return Date.now();
  }

  if (value > 1e12) {
    return value;
  }

  if (value >= 1e9) {
    return Math.round(value * 1000);
  }

  return Date.now();
}

function truncate(value: string | undefined, max = 180): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function clampNumber(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeComparableText(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeTaskText(value: string | undefined): string[] {
  const normalized = normalizeComparableText(value);
  if (!normalized) {
    return [];
  }

  const tokens = new Set<string>();
  const segments = normalized.match(/[\p{Script=Han}]+|[a-z0-9]+/gu) ?? [];
  for (const segment of segments) {
    if (/^[a-z0-9]+$/i.test(segment)) {
      if (segment.length < 2 || TASK_STOP_WORDS.has(segment)) {
        continue;
      }
      tokens.add(segment);
      continue;
    }

    const chars = Array.from(segment);
    if (chars.length <= 2) {
      tokens.add(segment);
      continue;
    }

    for (let size = 2; size <= Math.min(4, chars.length); size += 1) {
      for (let index = 0; index <= chars.length - size; index += 1) {
        tokens.add(chars.slice(index, index + size).join(""));
      }
    }
  }

  return Array.from(tokens).slice(0, 48);
}

function scoreTaskRelevance(
  taskTokens: string[],
  fullTask: string | undefined,
  ...values: Array<string | undefined>
): number {
  const haystack = normalizeComparableText(values.filter((value): value is string => Boolean(value)).join(" "));
  if (!haystack) {
    return 0;
  }

  let score = 0;
  const normalizedTask = normalizeComparableText(fullTask);
  if (normalizedTask && normalizedTask.length >= 2 && (haystack.includes(normalizedTask) || normalizedTask.includes(haystack))) {
    score += 0.9;
  }

  for (const token of taskTokens) {
    if (!haystack.includes(token)) {
      continue;
    }

    if (/^[a-z0-9]+$/i.test(token)) {
      score += Math.min(0.28, 0.05 * token.length);
      continue;
    }

    score += token.length >= 3 ? 0.22 : 0.14;
  }

  return Math.min(score, 1.6);
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim())));
}

function arrayContainsRole(value: unknown, role: string): boolean {
  const normalizedRole = normalizeComparableText(role);
  if (!Array.isArray(value) || !normalizedRole) {
    return false;
  }

  return value.some((entry) =>
    isRecord(entry) && normalizeComparableText(readString(entry, "role", false)) === normalizedRole,
  );
}

function eventSuggestsDialogRegion(event: RawEvent): boolean {
  if (event.kind !== "dom.mutation") {
    return false;
  }

  if (normalizeComparableText(readString(event, "axRole", false)) === "dialog") {
    return true;
  }
  if (normalizeComparableText(readString(event, "axResolvedTargetRole", false)) === "dialog") {
    return true;
  }
  if (normalizeComparableText(readString(event, "targetRole", false)) === "dialog") {
    return true;
  }
  if (arrayContainsRole(event.axPath, "dialog")) {
    return true;
  }
  if (arrayContainsRole(event.axChildren, "dialog")) {
    return true;
  }
  if (arrayContainsRole(event.axAddedChildren, "dialog")) {
    return true;
  }

  return normalizeComparableText(readString(event, "summary", false)).includes("dialog");
}

function eventSignalsError(event: RawEvent): boolean {
  return event.kind === "dom.error" || normalizeComparableText(readString(event, "state", false)) === "error";
}

function extractObservedErrorMessage(event: RawEvent): string | undefined {
  return truncate(
    readString(event, "message", false)
      ?? readString(event, "text", false)
      ?? (eventSignalsError(event) ? readString(event, "targetText", false) : undefined),
    200,
  );
}

function collectObservedErrorMessages(events: RawEvent[]): string[] {
  return uniqueStrings(events.map((event) => extractObservedErrorMessage(event)));
}

function isVisualDomEvent(event: Pick<RawEvent, "kind">): boolean {
  return event.kind === "dom.mutation" || event.kind === "dom.style";
}

function scoreObservedActionEvent(event: RawEvent): number {
  if (event.kind === "dialog.opened") {
    return 100;
  }
  if (event.kind === "tab.created") {
    return 95;
  }
  if (event.kind === "download.created") {
    return 92;
  }
  if (event.kind === "download.completed" || event.kind === "download.failed" || event.kind === "download.canceled") {
    return 88;
  }
  if (event.kind === "page.navigation") {
    return 82;
  }
  if (event.kind === "dialog.closed") {
    return 74;
  }
  if (eventSuggestsDialogRegion(event)) {
    return 72;
  }
  if (eventSignalsError(event)) {
    return 70;
  }
  if (event.kind === "dom.style") {
    return 64;
  }
  if (event.kind === "dom.mutation") {
    return 60;
  }
  if (event.kind === "page.lifecycle") {
    return 24;
  }
  return 40;
}

function fingerprintObservedActionEvent(event: RawEvent): string {
  return [
    event.kind,
    readString(event, "url", false),
    readString(event, "title", false),
    readString(event, "summary", false),
    readString(event, "state", false),
    readString(event, "message", false),
    readString(event, "text", false),
    readString(event, "downloadId", false),
    readString(event, "filename", false),
    readString(event, "selector", false),
    readString(event, "axNodeId", false),
    readString(event, "tabId", false),
  ]
    .filter((value): value is string => Boolean(value))
    .join("|");
}

function selectObservedActionEvents(events: RawEvent[], maxEvents = 8): RawEvent[] {
  if (events.length <= maxEvents) {
    return [...events];
  }

  const ranked = events
    .map((event, index) => ({
      event,
      index,
      fingerprint: fingerprintObservedActionEvent(event),
      priority: scoreObservedActionEvent(event),
    }))
    .sort((left, right) =>
      right.priority - left.priority
      || left.index - right.index
      || left.event.ts - right.event.ts,
    );

  const selected: Array<{ event: RawEvent; index: number }> = [];
  const seenFingerprints = new Set<string>();
  for (const candidate of ranked) {
    if (selected.length >= maxEvents) {
      break;
    }
    const fingerprint = candidate.fingerprint || `${candidate.event.kind}|${candidate.index}`;
    if (seenFingerprints.has(fingerprint)) {
      continue;
    }
    seenFingerprints.add(fingerprint);
    selected.push({ event: candidate.event, index: candidate.index });
  }

  return selected
    .sort((left, right) =>
      left.event.ts - right.event.ts
      || left.index - right.index,
    )
    .map((entry) => entry.event);
}

function looksLikeSelectorHint(value: string | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed) {
    return false;
  }

  return /^[#.\[]/.test(trimmed) || trimmed.includes(">") || /^[a-z][a-z0-9_-]*(?:[.#:[\s>]|$)/i.test(trimmed);
}

function jaccardSimilarity(left: string, right: string): number {
  const leftTokens = new Set(normalizeComparableText(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizeComparableText(right).split(" ").filter(Boolean));
  if (!leftTokens.size && !rightTokens.size) {
    return 1;
  }

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }

  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union > 0 ? intersection / union : 1;
}

function scopedIdTail(value: string | undefined): string | undefined {
  return value?.split(":").pop();
}

function matchesScopedId(actual: string | undefined, expected: string | undefined): boolean {
  if (!actual || !expected) {
    return false;
  }
  return actual === expected || scopedIdTail(actual) === scopedIdTail(expected);
}

function describeRegionLabel(region: Pick<PageRegion, "regionId" | "role" | "name">): string {
  return truncate(region.name, 60) ?? `${region.role} (${scopedIdTail(region.regionId) ?? region.regionId})`;
}

function describeElementLabel(element: Pick<SemanticElement, "elementId" | "name" | "associatedLabel" | "text" | "role">): string {
  return truncate(element.name ?? element.associatedLabel ?? element.text, 60)
    ?? `${element.role} (${scopedIdTail(element.elementId) ?? element.elementId})`;
}

function inferPrincipalActionType(element: SemanticElement): PrincipalActionType | undefined {
  if (element.primaryCapabilityType === "input_text") {
    return "type";
  }
  if (element.primaryCapabilityType === "select") {
    return "select";
  }
  if (
    element.primaryCapabilityType === "button"
    || element.primaryCapabilityType === "checkbox"
    || element.primaryCapabilityType === "radio"
    || element.primaryCapabilityType === "tab_switcher"
    || element.primaryCapabilityType === "pagination"
    || element.primaryCapabilityType === "submit"
  ) {
    return "click";
  }

  if (element.role === "textbox" || element.role === "searchbox") {
    return "type";
  }
  if (element.role === "combobox") {
    return "select";
  }
  if (INTERACTIVE_ROLES.has(element.role)) {
    return "click";
  }

  const tagName = normalizeComparableText(element.tagName);
  const htmlType = normalizeComparableText(element.htmlType);
  if (tagName === "button" || tagName === "a") {
    return "click";
  }
  if (tagName === "select") {
    return "select";
  }
  if (tagName === "textarea") {
    return "type";
  }
  if (tagName === "input") {
    if (["checkbox", "radio", "button", "submit"].includes(htmlType)) {
      return "click";
    }
    if (htmlType === "hidden") {
      return undefined;
    }
    return "type";
  }

  return undefined;
}

function inferRecordSourceRole(region: PageRegion): "table" | "list" | "panel" | "main" | "form" | undefined {
  if (region.role === "table" || region.role === "list" || region.role === "panel" || region.role === "main" || region.role === "form") {
    return region.role;
  }
  return undefined;
}

function looksLikePaginationLabel(value: string | undefined): boolean {
  const normalized = normalizeComparableText(value);
  if (!normalized) {
    return false;
  }

  return /^(page|next|prev|previous|more|load more|\d+)$/.test(normalized);
}

function looksLikeMetricValue(value: string | undefined): boolean {
  const normalized = normalizeComparableText(value);
  if (!normalized) {
    return false;
  }

  return /(^[\d.,]+(%|[kmb])?$)|(^\$[\d.,]+)|(^[\d.,]+\s?(users|views|items|orders|sales|results|mins|hours|days)$)/.test(normalized);
}

function inferElementCapabilityProfile(
  element: SemanticElement,
  form: PageForm | undefined,
  region: PageRegion | undefined,
  isSubmitAction: boolean,
): ElementCapabilityProfile {
  const textBag = uniqueStrings([
    element.name,
    element.associatedLabel,
    element.text,
    element.description,
    form?.name,
    form?.description,
    region?.name,
  ]).join(" ");
  const normalizedText = normalizeComparableText(textBag);
  const tagName = normalizeComparableText(element.tagName);
  const htmlType = normalizeComparableText(element.htmlType);
  const evidence = uniqueStrings([
    element.isHitTestable ? "Receives pointer hit-testing." : undefined,
    element.pointerCursor ? "Uses a pointer cursor." : undefined,
    element.focusable ? "Can receive keyboard focus." : undefined,
    element.clickableHint ? "Exposes click-like behavior hints." : undefined,
    element.keyboardHint ? "Supports keyboard interaction hints." : undefined,
  ]);

  let confidence = element.interactivityScore * 0.45;
  if (element.visible) {
    confidence += 0.06;
  }
  if (element.enabled !== false) {
    confidence += 0.04;
  }
  if (element.pointerCursor) {
    confidence += 0.07;
  }
  if (element.focusable) {
    confidence += 0.06;
  }
  if (element.clickableHint) {
    confidence += 0.07;
  }
  if (element.keyboardHint) {
    confidence += 0.05;
  }

  if (element.role === "slider" || htmlType === "range") {
    return {
      type: "slider",
      actions: ["drag"],
      confidence: Number(clampNumber(Math.max(confidence + 0.18, 0.78)).toFixed(3)),
      evidence: uniqueStrings([
        ...evidence,
        "Exposes slider semantics.",
      ]).slice(0, 4),
    };
  }

  if (element.role === "textbox" || element.role === "searchbox" || element.editable) {
    return {
      type: "input_text",
      actions: ["type", "click"],
      confidence: Number(clampNumber(Math.max(confidence + 0.16, 0.74)).toFixed(3)),
      evidence: uniqueStrings([
        ...evidence,
        element.editable ? "Uses contenteditable or editable semantics." : "Recognized as a text-entry control.",
      ]).slice(0, 4),
    };
  }

  if (element.role === "combobox" || tagName === "select") {
    return {
      type: "select",
      actions: ["select", "click"],
      confidence: Number(clampNumber(Math.max(confidence + 0.16, 0.76)).toFixed(3)),
      evidence: uniqueStrings([
        ...evidence,
        "Recognized as an option selection control.",
      ]).slice(0, 4),
    };
  }

  if (element.role === "checkbox") {
    return {
      type: "checkbox",
      actions: ["click"],
      confidence: Number(clampNumber(Math.max(confidence + 0.14, 0.74)).toFixed(3)),
      evidence: uniqueStrings([
        ...evidence,
        "Recognized as a checkbox-like toggle.",
      ]).slice(0, 4),
    };
  }

  if (element.role === "radio") {
    return {
      type: "radio",
      actions: ["click"],
      confidence: Number(clampNumber(Math.max(confidence + 0.14, 0.74)).toFixed(3)),
      evidence: uniqueStrings([
        ...evidence,
        "Recognized as a radio selection control.",
      ]).slice(0, 4),
    };
  }

  if (element.role === "tab" || (element.selected && region && ["nav", "panel", "list"].includes(region.role))) {
    return {
      type: "tab_switcher",
      actions: ["click"],
      confidence: Number(clampNumber(Math.max(confidence + 0.16, 0.72)).toFixed(3)),
      evidence: uniqueStrings([
        ...evidence,
        "Behaves like a view or tab switcher.",
      ]).slice(0, 4),
    };
  }

  if (isSubmitAction) {
    return {
      type: "submit",
      actions: ["submit_form", "click"],
      confidence: Number(clampNumber(Math.max(confidence + 0.18, 0.76)).toFixed(3)),
      evidence: uniqueStrings([
        ...evidence,
        "Acts as a form submit trigger.",
      ]).slice(0, 4),
    };
  }

  if (
    looksLikePaginationLabel(textBag)
    && region
    && ["list", "table", "panel", "main", "nav"].includes(region.role)
  ) {
    return {
      type: "pagination",
      actions: ["click"],
      confidence: Number(clampNumber(Math.max(confidence + 0.12, 0.68)).toFixed(3)),
      evidence: uniqueStrings([
        ...evidence,
        "Looks like pagination or incremental navigation.",
      ]).slice(0, 4),
    };
  }

  const buttonLike =
    element.role === "button"
    || element.role === "link"
    || tagName === "button"
    || tagName === "a"
    || (
      Boolean(normalizedText)
      && element.isHitTestable
      && !element.editable
      && (element.pointerCursor || element.clickableHint || element.focusable)
    );

  if (buttonLike) {
    return {
      type: "button",
      actions: ["click"],
      confidence: Number(clampNumber(Math.max(confidence + 0.1, normalizedText ? 0.64 : 0.58)).toFixed(3)),
      evidence: uniqueStrings([
        ...evidence,
        element.role === "button" || tagName === "button"
          ? "Exposes native or semantic button semantics."
          : "Shows custom clickable control behavior.",
      ]).slice(0, 4),
    };
  }

  return {
    actions: [],
    confidence: Number(clampNumber(confidence).toFixed(3)),
    evidence,
  };
}

function inferRegionInformationProfile(
  region: PageRegion,
  elements: SemanticElement[],
  forms: PageForm[],
): RegionInformationProfile {
  const textElements = elements.filter((element) => element.role === "text" || element.role === "heading");
  const headingElements = elements.filter((element) => element.role === "heading");
  const imageElements = elements.filter((element) => element.role === "image");
  const rowElements = elements.filter((element) => element.role === "row");
  const cellElements = elements.filter((element) => element.role === "cell");
  const metricElements = elements.filter((element) =>
    looksLikeMetricValue(element.text) || looksLikeMetricValue(element.name),
  );
  const capabilityElements = elements.filter((element) => Boolean(element.primaryCapabilityType));
  const textLength = textElements.reduce((total, element) => total + (element.text?.length ?? element.name?.length ?? 0), 0);
  const repeatedChildCount = Math.max(rowElements.length, Math.floor(region.childElementIds.length / 3));
  const summary = truncate(
    uniqueStrings([
      region.textSummary,
      ...headingElements.slice(0, 2).map((element) => element.text ?? element.name),
      ...textElements.slice(0, 2).map((element) => element.text),
    ]).join(" "),
    220,
  );
  const title = truncate(region.name ?? headingElements[0]?.text ?? headingElements[0]?.name, 120);

  if (region.role === "table" || (rowElements.length >= 2 && cellElements.length >= 4)) {
    return {
      type: "table",
      confidence: 0.86,
      itemCount: rowElements.length || undefined,
      extractable: true,
      sourceElementIds: rowElements.map((element) => element.elementId).slice(0, 12),
      ...(title ? { title } : {}),
      ...(summary ? { summary } : {}),
    };
  }

  if (region.role === "list" || repeatedChildCount >= 3) {
    return {
      type: region.role === "list" ? "list" : "card_group",
      confidence: region.role === "list" ? 0.8 : 0.68,
      itemCount: repeatedChildCount || undefined,
      extractable: true,
      sourceElementIds: elements.map((element) => element.elementId).slice(0, 16),
      ...(title ? { title } : {}),
      ...(summary ? { summary } : {}),
    };
  }

  if (metricElements.length >= 3 && elements.length <= 16) {
    return {
      type: "metric_group",
      confidence: 0.74,
      itemCount: metricElements.length,
      extractable: false,
      sourceElementIds: metricElements.map((element) => element.elementId).slice(0, 12),
      ...(title ? { title } : {}),
      ...(summary ? { summary } : {}),
    };
  }

  if (imageElements.length >= 1 && textElements.length <= 3 && capabilityElements.length <= 4) {
    return {
      type: imageElements.length > 1 ? "card_group" : "image",
      confidence: imageElements.length > 1 ? 0.68 : 0.72,
      itemCount: imageElements.length > 1 ? imageElements.length : undefined,
      extractable: imageElements.length > 1,
      sourceElementIds: imageElements.map((element) => element.elementId).slice(0, 12),
      ...(title ? { title } : {}),
      ...(summary ? { summary } : {}),
    };
  }

  if ((region.role === "main" || region.role === "panel") && textLength >= 260 && headingElements.length > 0) {
    return {
      type: region.role === "main" ? "article" : "text",
      confidence: region.role === "main" ? 0.78 : 0.64,
      extractable: false,
      sourceElementIds: textElements.map((element) => element.elementId).slice(0, 18),
      ...(title ? { title } : {}),
      ...(summary ? { summary } : {}),
    };
  }

  return {
    type: "text",
    confidence: region.textSummary || textElements.length > 0 || forms.length > 0 ? 0.56 : 0.34,
    extractable: false,
    sourceElementIds: textElements.map((element) => element.elementId).slice(0, 12),
    ...(title ? { title } : {}),
    ...(summary ? { summary } : {}),
  };
}

function indentMultiline(value: string, prefix = "  "): string {
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function matchesSchemaType(value: unknown, type: string): boolean {
  if (type === "string") {
    return typeof value === "string";
  }
  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (type === "integer") {
    return typeof value === "number" && Number.isInteger(value);
  }
  if (type === "boolean") {
    return typeof value === "boolean";
  }
  if (type === "null") {
    return value === null;
  }
  if (type === "array") {
    return Array.isArray(value);
  }
  if (type === "object") {
    return isRecord(value);
  }

  return true;
}

function resolveSchemaRef(schema: JSONSchema, root: JSONSchema): JSONSchema {
  const ref = schema.$ref;
  if (!ref) {
    return schema;
  }

  if (!ref.startsWith("#/$defs/")) {
    return schema;
  }

  const key = ref.slice("#/$defs/".length);
  const target = root.$defs?.[key];
  return target ?? schema;
}

function isSchemaValid(value: unknown, schema: JSONSchema, root: JSONSchema): boolean {
  const errors: string[] = [];
  validateSchemaValue(value, schema, root, "$", errors);
  return errors.length === 0;
}

function validateSchemaValue(
  value: unknown,
  schema: JSONSchema,
  root: JSONSchema,
  path: string,
  errors: string[],
) {
  if (errors.length >= 16) {
    return;
  }

  const resolved = resolveSchemaRef(schema, root);
  if (resolved !== schema) {
    validateSchemaValue(value, resolved, root, path, errors);
    return;
  }

  if (resolved.const !== undefined && !Object.is(value, resolved.const)) {
    errors.push(`${path}: expected const value ${String(resolved.const)}.`);
    return;
  }

  if (resolved.enum && !resolved.enum.some((candidate) => Object.is(candidate, value))) {
    errors.push(`${path}: value is not in enum.`);
    return;
  }

  if (resolved.oneOf?.length) {
    const validCount = resolved.oneOf.filter((candidate) =>
      isSchemaValid(value, candidate, root),
    ).length;
    if (validCount !== 1) {
      errors.push(`${path}: value does not match exactly one schema variant.`);
    }
    return;
  }

  if (resolved.anyOf?.length) {
    const valid = resolved.anyOf.some((candidate) => isSchemaValid(value, candidate, root));
    if (!valid) {
      errors.push(`${path}: value does not match any schema variant.`);
    }
    return;
  }

  if (resolved.allOf?.length) {
    for (const candidate of resolved.allOf) {
      validateSchemaValue(value, candidate, root, path, errors);
      if (errors.length >= 16) {
        return;
      }
    }
    return;
  }

  const expectedTypes = Array.isArray(resolved.type)
    ? resolved.type
    : resolved.type
      ? [resolved.type]
      : [];
  if (expectedTypes.length) {
    const validType = expectedTypes.some((type) => matchesSchemaType(value, type));
    if (!validType) {
      errors.push(`${path}: expected type ${expectedTypes.join("|")}.`);
      return;
    }
  }

  if (typeof value === "string") {
    if (typeof resolved.minLength === "number" && value.length < resolved.minLength) {
      errors.push(`${path}: string is shorter than minLength ${resolved.minLength}.`);
    }
    if (typeof resolved.maxLength === "number" && value.length > resolved.maxLength) {
      errors.push(`${path}: string is longer than maxLength ${resolved.maxLength}.`);
    }
    if (resolved.pattern) {
      try {
        const pattern = new RegExp(resolved.pattern);
        if (!pattern.test(value)) {
          errors.push(`${path}: string does not match pattern ${resolved.pattern}.`);
        }
      } catch {
        // Ignore invalid schema pattern at runtime and continue.
      }
    }
    return;
  }

  if (typeof value === "number") {
    if (typeof resolved.minimum === "number" && value < resolved.minimum) {
      errors.push(`${path}: number is smaller than minimum ${resolved.minimum}.`);
    }
    if (typeof resolved.maximum === "number" && value > resolved.maximum) {
      errors.push(`${path}: number is larger than maximum ${resolved.maximum}.`);
    }
    if (typeof resolved.exclusiveMinimum === "number" && value <= resolved.exclusiveMinimum) {
      errors.push(`${path}: number is not greater than exclusiveMinimum ${resolved.exclusiveMinimum}.`);
    }
    if (typeof resolved.exclusiveMaximum === "number" && value >= resolved.exclusiveMaximum) {
      errors.push(`${path}: number is not smaller than exclusiveMaximum ${resolved.exclusiveMaximum}.`);
    }
    return;
  }

  if (Array.isArray(value)) {
    if (typeof resolved.minItems === "number" && value.length < resolved.minItems) {
      errors.push(`${path}: array has fewer items than minItems ${resolved.minItems}.`);
    }
    if (typeof resolved.maxItems === "number" && value.length > resolved.maxItems) {
      errors.push(`${path}: array has more items than maxItems ${resolved.maxItems}.`);
    }

    if (resolved.items) {
      value.forEach((entry, index) => {
        validateSchemaValue(entry, resolved.items as JSONSchema, root, `${path}[${index}]`, errors);
      });
    } else if (resolved.prefixItems?.length) {
      resolved.prefixItems.forEach((entry, index) => {
        if (index < value.length) {
          validateSchemaValue(value[index], entry, root, `${path}[${index}]`, errors);
        }
      });
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const required = resolved.required ?? [];
  for (const key of required) {
    if (!(key in value) || value[key] === undefined) {
      errors.push(`${path}: missing required property "${key}".`);
    }
  }

  const properties = resolved.properties ?? {};
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!(key in value) || value[key] === undefined) {
      continue;
    }
    validateSchemaValue(value[key], propertySchema, root, `${path}.${key}`, errors);
  }

  const additionalProperties = resolved.additionalProperties;
  if (additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!(key in properties)) {
        errors.push(`${path}: unexpected property "${key}".`);
      }
    }
    return;
  }

  if (isRecord(additionalProperties)) {
    for (const key of Object.keys(value)) {
      if (key in properties) {
        continue;
      }
      validateSchemaValue(value[key], additionalProperties, root, `${path}.${key}`, errors);
    }
  }
}

interface ParsedSchemaIssue {
  fieldPath?: string;
  expected?: string;
}

function parseSchemaIssue(issue: string): ParsedSchemaIssue {
  const missingMatch = issue.match(/^(.+): missing required property "([^"]+)"\.$/);
  if (missingMatch) {
    const parentPath = missingMatch[1];
    const key = missingMatch[2];
    return {
      fieldPath: parentPath === "$" ? `$.${key}` : `${parentPath}.${key}`,
      expected: "required property",
    };
  }

  const typeMatch = issue.match(/^(.+): expected type ([^\.]+)\.$/);
  if (typeMatch) {
    return {
      fieldPath: typeMatch[1],
      expected: `type ${typeMatch[2]}`,
    };
  }

  const unexpectedMatch = issue.match(/^(.+): unexpected property "([^"]+)"\.$/);
  if (unexpectedMatch) {
    const parentPath = unexpectedMatch[1];
    const key = unexpectedMatch[2];
    return {
      fieldPath: parentPath === "$" ? `$.${key}` : `${parentPath}.${key}`,
      expected: "known property",
    };
  }

  const genericPathMatch = issue.match(/^(.+): /);
  if (genericPathMatch) {
    return {
      fieldPath: genericPathMatch[1],
    };
  }

  return {};
}

const INPUT_OBSERVATION_BRIDGE_EXPRESSION = `(() => {
  const bridgeFlag = "__miloInputBridgeInstalled";
  const cleanupKey = "__miloInputBridgeCleanup";
  const bridgeConfig = window.__miloInputBridgeConfig && typeof window.__miloInputBridgeConfig === "object"
    ? window.__miloInputBridgeConfig
    : {};
  const previousConfigKey = typeof window[bridgeFlag] === "string" ? window[bridgeFlag] : "";
  const previousParts = new Set(previousConfigKey.split("|").filter(Boolean));
  const wantsInput = bridgeConfig.input !== false || previousParts.has("input");
  const wantsFocus = bridgeConfig.focus !== false || previousParts.has("focus");
  const wantsSelection = bridgeConfig.selection !== false || previousParts.has("selection");
  const wantsDom = bridgeConfig.dom !== false || previousParts.has("dom");
  const wantsMouseMove = bridgeConfig.mousemove === true || previousParts.has("mousemove");
  const configKey = [
    wantsInput ? "input" : "",
    wantsFocus ? "focus" : "",
    wantsSelection ? "selection" : "",
    wantsDom ? "dom" : "",
    wantsMouseMove ? "mousemove" : "",
  ].filter(Boolean).join("|") || "none";
  const requestedParts = configKey.split("|").filter(Boolean);
  const previousCoversRequested = requestedParts.length > 0
    && requestedParts.every((part) => previousParts.has(part));
  if (previousConfigKey === configKey || previousCoversRequested) {
    return { installed: true, reused: true };
  }
  if (Array.isArray(window[cleanupKey])) {
    for (const cleanup of window[cleanupKey]) {
      try {
        cleanup();
      } catch {
        // noop
      }
    }
  }
  const cleanupCallbacks = [];
  window[cleanupKey] = cleanupCallbacks;
  const addListener = (target, type, listener, options) => {
    target.addEventListener(type, listener, options);
    cleanupCallbacks.push(() => target.removeEventListener(type, listener, options));
  };
  const mouseMoveIntervalMs = 120;
  let lastMouseMoveAt = 0;

  const clip = (value, limit = 160) => {
    if (typeof value !== "string") return undefined;
    const normalized = value.replace(/\\s+/g, " ").trim();
    if (!normalized) return undefined;
    return normalized.length > limit ? normalized.slice(0, limit - 1) + "…" : normalized;
  };

  const sanitize = (value) => typeof value === "string" ? value.replace(/\\s+/g, " ").trim() : "";

  const esc = (value) => {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
  };

  const textFromRefs = (value) => clip(
    sanitize(String(value || "")
      .split(/\\s+/)
      .map((id) => {
        const target = document.getElementById(id);
        return target ? sanitize(target.innerText || target.textContent || "") : "";
      })
      .join(" ")),
    120,
  );

  const quoteAttr = (value, limit = 80) => JSON.stringify(String(value).slice(0, limit));

  const selectorFor = (target) => {
    if (!target || target.nodeType !== Node.ELEMENT_NODE) {
      return undefined;
    }
    const el = target;
    if (el.id) {
      return "#" + esc(el.id);
    }

    const segments = [];
    let current = el;
    let depth = 0;
    while (current && depth < 5 && current.nodeType === Node.ELEMENT_NODE) {
      const currentTag = current.tagName ? current.tagName.toLowerCase() : "unknown";
      const testId = current.getAttribute("data-testid") || current.getAttribute("data-test") || current.getAttribute("data-qa");
      const name = current.getAttribute && current.getAttribute("name");
      let segment;
      if (testId) {
        segment = currentTag + "[data-testid=" + quoteAttr(testId) + "]";
      } else if (name) {
        segment = currentTag + "[name=" + quoteAttr(name) + "]";
      } else {
        let index = 1;
        let sibling = current.previousElementSibling;
        while (sibling) {
          if (sibling.tagName === current.tagName) {
            index += 1;
          }
          sibling = sibling.previousElementSibling;
        }
        segment = currentTag + ":nth-of-type(" + index + ")";
      }
      segments.unshift(segment);
      if (current.id || testId) {
        break;
      }
      current = current.parentElement;
      depth += 1;
    }

    return segments.join(" > ") || undefined;
  };

  const elementForNode = (node) => {
    if (!node) return undefined;
    if (node.nodeType === Node.ELEMENT_NODE) {
      return node;
    }
    return node.parentElement || undefined;
  };

  const textFor = (target) => {
    const el = elementForNode(target);
    if (!el) {
      return undefined;
    }
    return clip(sanitize(el.innerText || el.textContent || ""), 80);
  };

  const nameFor = (target) => {
    const el = elementForNode(target);
    if (!el) {
      return undefined;
    }
    return clip(
      sanitize(
        el.getAttribute("aria-label")
        || textFromRefs(el.getAttribute("aria-labelledby"))
        || el.getAttribute("title")
        || el.getAttribute("placeholder")
        || el.getAttribute("alt")
        || el.getAttribute("name")
        || "",
      ),
      120,
    );
  };

  const labelFor = (target) => {
    const el = elementForNode(target);
    if (!el) {
      return undefined;
    }
    if (el.labels && el.labels.length) {
      const labels = clip(
        Array.from(el.labels)
          .map((label) => sanitize(label.innerText || label.textContent || ""))
          .filter(Boolean)
          .join(" "),
        120,
      );
      if (labels) {
        return labels;
      }
    }
    const explicitName = nameFor(el);
    if (explicitName) {
      return explicitName;
    }
    const wrapped = el.closest ? el.closest("label") : null;
    if (wrapped) {
      const wrappedText = clip(sanitize(wrapped.innerText || wrapped.textContent || ""), 120);
      if (wrappedText) {
        return wrappedText;
      }
    }
    return undefined;
  };

  const roleFor = (target) => {
    const el = elementForNode(target);
    if (!el) {
      return undefined;
    }
    const explicitRole = sanitize(el.getAttribute("role")).toLowerCase();
    const tag = el.tagName ? el.tagName.toLowerCase() : "";
    const type = sanitize(el.getAttribute("type")).toLowerCase();
    const searchHintSource = sanitize([
      el.getAttribute("aria-label"),
      textFromRefs(el.getAttribute("aria-labelledby")),
      el.getAttribute("placeholder"),
      el.getAttribute("name"),
      el.getAttribute("id"),
      el.getAttribute("title"),
      el.closest && el.closest('form[role="search"],[role="search"]') ? "search" : "",
    ].filter(Boolean).join(" "));
    const looksLikeSearchInput = tag === "input"
      && (!type || type === "text" || type === "search")
      && /(^|\\b)(search|query|keyword|keywords)(\\b|$)|搜索|查找|查询|检索|关键词/i.test(searchHintSource);
    if (explicitRole === "button" || tag === "button") return "button";
    if (explicitRole === "link" || tag === "a") return "link";
    if (explicitRole === "searchbox" || (tag === "input" && type === "search") || looksLikeSearchInput) return "searchbox";
    if (explicitRole === "textbox" || tag === "textarea" || (tag === "input" && ["text", "email", "url", "password", "tel", "number"].includes(type))) return "textbox";
    if (explicitRole === "checkbox" || (tag === "input" && type === "checkbox")) return "checkbox";
    if (explicitRole === "radio" || (tag === "input" && type === "radio")) return "radio";
    if (explicitRole === "combobox" || tag === "select") return "combobox";
    if (explicitRole === "slider" || (tag === "input" && type === "range")) return "slider";
    if (explicitRole === "tab") return "tab";
    if (explicitRole === "menuitem") return "menuitem";
    if (explicitRole === "row" || tag === "tr") return "row";
    if (explicitRole === "cell" || tag === "td" || tag === "th") return "cell";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "img") return "image";
    if (tag === "label" || tag === "li" || tag === "p" || tag === "span") return "text";
    return explicitRole || "unknown";
  };

  const visualStyleProps = [
    "color",
    "backgroundColor",
    "borderTopColor",
    "borderRightColor",
    "borderBottomColor",
    "borderLeftColor",
    "outlineColor",
    "textDecorationColor",
    "accentColor",
    "caretColor",
    "boxShadow",
    "opacity",
  ];
  const styleSensitiveAttributes = new Set([
    "class",
    "style",
    "disabled",
    "readonly",
    "hidden",
    "open",
    "aria-disabled",
    "aria-expanded",
    "aria-invalid",
    "aria-pressed",
    "aria-selected",
    "aria-checked",
    "data-state",
    "data-status",
    "data-disabled",
    "data-invalid",
    "data-selected",
    "data-open",
  ]);
  const normalizeVisualToken = (value) => String(value ?? "").replace(/\\s+/g, "").toLowerCase();
  const collectVisualTargets = (target) => {
    const el = elementForNode(target);
    if (!el) {
      return [];
    }
    const related = [el];
    if (el.parentElement) {
      related.push(el.parentElement);
    }
    if (el.labels && el.labels.length) {
      Array.from(el.labels).slice(0, 2).forEach((label) => related.push(label));
    }
    const wrapped = el.closest ? el.closest("label") : null;
    if (wrapped) {
      related.push(wrapped);
    }
    return Array.from(new Set(related.filter((entry) => entry instanceof Element)));
  };
  const visualSignatureFor = (target) =>
    collectVisualTargets(target)
      .flatMap((node, index) => {
        const style = window.getComputedStyle(node);
        if (!style) {
          return [];
        }
        const prefix = index === 0 ? "self" : "related" + index;
        const parts = visualStyleProps.map((prop) => {
          const normalized = normalizeVisualToken(style[prop]);
          return normalized ? prefix + ":" + prop + "=" + normalized : undefined;
        }).filter(Boolean);
        const ariaInvalid = sanitize(node.getAttribute("aria-invalid")).toLowerCase();
        if (ariaInvalid) {
          parts.push(prefix + ":aria-invalid=" + ariaInvalid);
        }
        if ("disabled" in node && node.disabled === true) {
          parts.push(prefix + ":disabled=true");
        }
        if ("checked" in node && node.checked === true) {
          parts.push(prefix + ":checked=true");
        }
        if ("selected" in node && node.selected === true) {
          parts.push(prefix + ":selected=true");
        }
        if (typeof node.matches === "function" && node.matches(":focus")) {
          parts.push(prefix + ":focus=true");
        }
        if (typeof node.matches === "function" && node.matches(":hover")) {
          parts.push(prefix + ":hover=true");
        }
        if (typeof node.matches === "function" && node.matches(":active")) {
          parts.push(prefix + ":active=true");
        }
        if (typeof node.checkValidity === "function") {
          try {
            parts.push(prefix + ":valid=" + String(node.checkValidity()));
          } catch {
            // Ignore validity checks that throw on non-form elements.
          }
        }
        return parts;
      })
      .join("|");
  const lastVisualSignatureByElement = new WeakMap();
  const diffVisualSignature = (beforeValue, afterValue) => {
    const beforeParts = new Set(String(beforeValue || "").split("|").filter(Boolean));
    const afterParts = new Set(String(afterValue || "").split("|").filter(Boolean));
    const changes = [
      ...Array.from(afterParts).filter((entry) => !beforeParts.has(entry)).slice(0, 3).map((entry) => "+" + entry),
      ...Array.from(beforeParts).filter((entry) => !afterParts.has(entry)).slice(0, 3).map((entry) => "-" + entry),
    ];
    return clip(changes.join(", ") || "visual state changed", 200);
  };
  const emitVisualChangeIfNeeded = (target, reason, force = false) => {
    const el = elementForNode(target);
    if (!el) {
      return false;
    }
    const nextSignature = visualSignatureFor(el);
    const previousSignature = lastVisualSignatureByElement.get(el);
    lastVisualSignatureByElement.set(el, nextSignature);
    if (!force && (previousSignature === undefined || previousSignature === nextSignature)) {
      return false;
    }
    emit({
      kind: "dom.style",
      ts: Date.now(),
      summary: clip(reason + ": " + diffVisualSignature(previousSignature, nextSignature), 220),
      ...semanticTargetFor(el),
      ...(selectorFor(el) ? { selector: selectorFor(el) } : {}),
      state: "visual",
    });
    return true;
  };
  const queueVisualCheck = (target, reason, force = false) => {
    const el = elementForNode(target);
    if (!el) {
      return;
    }
    window.setTimeout(() => {
      emitVisualChangeIfNeeded(el, reason, force);
    }, 0);
  };
  const errorHintPattern = /(^|[^a-z])(error|invalid|warning|warn|danger|failed|failure|tooltip-error|tooltip_error|field-error|field_error|alert)([^a-z]|$)/i;
  const errorTextPattern = /(不能为空|必填|请选择|请填写|错误|失败|无效|不合法|required|invalid|incorrect|failed|error|please\\s+(select|choose|enter|fill)|must\\s+(select|choose|enter|fill))/i;
  const messageFor = (target) => {
    const el = elementForNode(target);
    if (!el) {
      return undefined;
    }
    return clip(
      sanitize(
        el.innerText
        || el.textContent
        || el.getAttribute("aria-label")
        || el.getAttribute("title")
        || "",
      ),
      200,
    );
  };
  const errorSignalFor = (target) => {
    const el = elementForNode(target);
    if (!(el instanceof Element)) {
      return undefined;
    }
    const style = window.getComputedStyle(el);
    if (!style || style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) {
      return undefined;
    }
    const role = sanitize(el.getAttribute("role")).toLowerCase();
    const ariaLive = sanitize(el.getAttribute("aria-live")).toLowerCase();
    const ariaInvalid = sanitize(el.getAttribute("aria-invalid")).toLowerCase();
    const dataState = sanitize(el.getAttribute("data-state")).toLowerCase();
    const dataStatus = sanitize(el.getAttribute("data-status")).toLowerCase();
    const dataInvalid = sanitize(el.getAttribute("data-invalid")).toLowerCase();
    const text = messageFor(el);
    const errorHintSource = [
      el.id,
      el.className,
      el.getAttribute("data-testid"),
      el.getAttribute("data-test"),
      el.getAttribute("data-qa"),
      el.getAttribute("data-id"),
      dataState,
      dataStatus,
    ].filter(Boolean).join(" ");
    const roleError = role === "alert" || role === "alertdialog";
    const invalidState = ariaInvalid === "true" || dataInvalid === "true";
    const attributeError =
      errorHintPattern.test(errorHintSource)
      || ["error", "invalid", "danger", "warning", "warn", "failed"].includes(dataState)
      || ["error", "invalid", "danger", "warning", "warn", "failed"].includes(dataStatus);
    const liveRegionError = ["assertive", "polite"].includes(ariaLive) && Boolean(text && errorTextPattern.test(text));
    const browserValidationError = typeof el.checkValidity === "function" && (() => {
      try {
        return !el.checkValidity();
      } catch {
        return false;
      }
    })();
    if (!(roleError || invalidState || attributeError || liveRegionError || browserValidationError)) {
      return undefined;
    }
    return {
      element: el,
      message: text || undefined,
      reason:
        roleError ? "role"
        : invalidState ? "invalid-state"
        : browserValidationError ? "validation"
        : liveRegionError ? "live-region"
        : "attribute",
    };
  };
  const candidateErrorNodesForRecord = (record) => {
    const nodes = [elementForNode(record.target)];
    if (record.type === "childList") {
      Array.from(record.addedNodes || [])
        .slice(0, 8)
        .forEach((node) => {
          const el = elementForNode(node);
          if (el) {
            nodes.push(el);
            Array.from(el.querySelectorAll ? el.querySelectorAll('*') : [])
              .slice(0, 8)
              .forEach((child) => nodes.push(child));
          }
        });
    }
    return Array.from(new Set(nodes.filter((entry) => entry instanceof Element)));
  };

  const semanticTargetFor = (target) => {
    const el = elementForNode(target);
    if (!el) {
      return {};
    }
    const targetRole = roleFor(el);
    const targetName = nameFor(el);
    const targetLabel = labelFor(el);
    const targetText = textFor(el);
    const editableTarget = isEditableTarget(el);
    const semanticParts = [
      targetRole && targetRole !== "unknown" ? "role=" + targetRole : undefined,
      targetName ? "name=\\"" + targetName.replace(/"/g, "\\\\\\"") + "\\"" : undefined,
      !targetName && targetLabel ? "label=\\"" + targetLabel.replace(/"/g, "\\\\\\"") + "\\"" : undefined,
      !targetName && !targetLabel && targetText ? "text=\\"" + targetText.replace(/"/g, "\\\\\\"") + "\\"" : undefined,
    ].filter(Boolean);
    const targetHint = semanticParts.join(" ") || selectorFor(el);
    return {
      ...(targetHint ? { targetHint } : {}),
      ...(targetRole ? { targetRole } : {}),
      ...(targetName ? { targetName } : {}),
      ...(targetLabel && targetLabel !== targetName ? { targetLabel } : {}),
      ...(targetText ? { targetText } : {}),
      ...(editableTarget ? { editableTarget: true } : {}),
    };
  };

  const isEditableTarget = (target) => {
    const el = elementForNode(target);
    if (!el) {
      return false;
    }
    if (el instanceof HTMLTextAreaElement) {
      return true;
    }
    if (el instanceof HTMLInputElement) {
      const type = sanitize(el.type).toLowerCase();
      return !type || ["text", "email", "search", "url"].includes(type);
    }
    const explicitRole = sanitize(el.getAttribute("role")).toLowerCase();
    return el.isContentEditable || explicitRole === "textbox";
  };

  const editableTextFor = (target) => {
    const el = elementForNode(target);
    if (!el) {
      return undefined;
    }
    if (typeof el.value === "string") {
      return clip(el.value, 4000);
    }
    if (el.isContentEditable) {
      return clip(sanitize(el.innerText || el.textContent || ""), 4000);
    }
    return undefined;
  };

  const fieldHintFor = (target) => {
    const el = elementForNode(target);
    if (!el) {
      return undefined;
    }
    return clip([
      nameFor(el),
      labelFor(el),
      sanitize(el.getAttribute("placeholder")),
      sanitize(el.getAttribute("aria-label")),
      sanitize(el.getAttribute("title")),
      sanitize(el.getAttribute("name")),
      sanitize(el.id),
    ].filter(Boolean).join(" | "), 160);
  };

  const richTextLike = (target) => {
    const el = elementForNode(target);
    if (!el) {
      return false;
    }
    return el.isContentEditable
      || sanitize(el.getAttribute("contenteditable")).toLowerCase() === "true"
      || sanitize(el.getAttribute("data-lexical-editor")).toLowerCase() === "true"
      || sanitize(el.getAttribute("data-slate-editor")).toLowerCase() === "true"
      || sanitize(el.getAttribute("data-editor")).length > 0;
  };

  const nearestWritingContainer = (target) => {
    const el = elementForNode(target);
    if (!el || typeof el.closest !== "function") {
      return document.body || document.documentElement;
    }
    return el.closest('form,[role="dialog"],main,section,article,[data-compose],[data-editor],[data-testid],[contenteditable="true"]')
      || document.body
      || document.documentElement;
  };

  const extractEmailRecipient = (target) => {
    const container = nearestWritingContainer(target);
    if (!(container instanceof Element)) {
      return undefined;
    }
    const recipientHints = /(to|cc|bcc|recipient|recipients|收件人|抄送|密送)/i;
    const values = new Set();
    const candidates = Array.from(container.querySelectorAll('input,textarea,[contenteditable="true"],[role="textbox"],[data-email],[email],[aria-label],[title]')).slice(0, 80);
    for (const node of candidates) {
      if (!(node instanceof Element)) {
        continue;
      }
      const hint = [
        fieldHintFor(node),
        sanitize(node.getAttribute("data-testid")),
        sanitize(node.getAttribute("data-field")),
        sanitize(node.className),
      ].filter(Boolean).join(" ");
      if (!recipientHints.test(hint)) {
        continue;
      }
      const value = editableTextFor(node)
        || sanitize(node.getAttribute("data-email"))
        || sanitize(node.getAttribute("email"))
        || sanitize(node.getAttribute("aria-label"))
        || sanitize(node.getAttribute("title"))
        || sanitize(node.textContent);
      if (!value) {
        continue;
      }
      values.add(clip(value, 80));
      if (values.size >= 3) {
        break;
      }
    }
    return values.size > 0 ? Array.from(values).join(", ") : undefined;
  };

  const writingContextFor = (target) => {
    if (!isEditableTarget(target)) {
      return {};
    }
    const el = elementForNode(target);
    if (!el) {
      return {};
    }
    const fieldHint = fieldHintFor(el);
    const container = nearestWritingContainer(el);
    const localText = container instanceof Element
      ? clip(sanitize(container.innerText || container.textContent || ""), 600)
      : "";
    const pageSignals = [
      window.location.hostname,
      window.location.pathname,
      document.title || "",
      fieldHint || "",
      localText,
    ].join(" ").toLowerCase();
    let writingContextType;
    if (/(mail|email|compose|inbox|outlook|gmail|邮件|邮箱|收件人|抄送|密送|主题)/i.test(pageSignals)) {
      writingContextType = "email";
    } else if (/(forum|thread|reply|discussion|community|comment|帖子|论坛|回复|评论|发帖)/i.test(pageSignals)) {
      writingContextType = "forum";
    } else if (/(article|editor|publish|draft|story|blog|markdown|document|文章|编辑器|发布|草稿|标题)/i.test(pageSignals) || richTextLike(el)) {
      writingContextType = "article_editor";
    } else {
      writingContextType = "general_editor";
    }

    let writingSlot = "unknown";
    if (/(to|cc|bcc|recipient|收件人|抄送|密送)/i.test(fieldHint || "")) {
      writingSlot = "recipient";
    } else if (/(subject|topic|主题)/i.test(fieldHint || "")) {
      writingSlot = "subject";
    } else if (/(title|headline|标题)/i.test(fieldHint || "")) {
      writingSlot = "title";
    } else if (/(comment|reply|回复|评论)/i.test(pageSignals)) {
      writingSlot = "comment";
    } else if (/(message|content|body|正文|内容)/i.test(fieldHint || "")) {
      writingSlot = "body";
    } else if (writingContextType === "email") {
      writingSlot = "body";
    } else if (writingContextType === "forum") {
      writingSlot = "comment";
    } else if (writingContextType === "article_editor") {
      writingSlot = richTextLike(el) ? "body" : "title";
    } else {
      writingSlot = "message";
    }

    const writingRecipient = writingContextType === "email"
      ? extractEmailRecipient(el)
      : undefined;
    const writingSurfaceKey = [
      writingContextType,
      writingSlot,
      fieldHint || "",
      writingRecipient || "",
      selectorFor(el) || "",
    ]
      .map((part) => String(part || "").trim().toLowerCase())
      .filter(Boolean)
      .join("|");
    return {
      writingContextType,
      writingSlot,
      ...(fieldHint ? { writingFieldHint: fieldHint } : {}),
      ...(writingRecipient ? { writingRecipient } : {}),
      ...(writingSurfaceKey ? { writingSurfaceKey } : {}),
    };
  };

  const emit = (payload) => {
    try {
      console.debug("${INPUT_BRIDGE_PREFIX}" + JSON.stringify({
        ...payload,
        url: window.location.href,
        title: document.title || undefined,
      }));
    } catch {
      // noop
    }
  };

  if (wantsInput) {
    addListener(document, "click", (event) => {
      emit({
        kind: "input.click",
        ts: Date.now(),
        x: Number(event.clientX) || 0,
        y: Number(event.clientY) || 0,
        ...semanticTargetFor(event.target),
      });
    }, true);

    addListener(document, "input", (event) => {
      const target = event.target;
      const styleText = editableTextFor(target);
      const text = styleText ? clip(styleText, 200) : undefined;
      emit({
        kind: "input.input",
        ts: Date.now(),
        text,
        ...(styleText ? { styleText } : {}),
        ...semanticTargetFor(target),
        ...writingContextFor(target),
      });
    }, true);

    addListener(document, "keydown", (event) => {
      emit({
        kind: "input.keydown",
        ts: Date.now(),
        key: typeof event.key === "string" ? event.key : undefined,
        ...semanticTargetFor(event.target),
      });
    }, true);

    addListener(document, "wheel", (event) => {
      emit({
        kind: "input.scroll",
        ts: Date.now(),
        x: Number(event.clientX) || 0,
        y: Number(event.clientY) || 0,
        ...semanticTargetFor(event.target),
      });
    }, { passive: true, capture: true });

    if (wantsMouseMove) {
      addListener(document, "mousemove", (event) => {
        const now = Date.now();
        if (now - lastMouseMoveAt < mouseMoveIntervalMs) {
          return;
        }
        lastMouseMoveAt = now;
        emit({
          kind: "input.mousemove",
          ts: now,
          x: Number(event.clientX) || 0,
          y: Number(event.clientY) || 0,
          ...semanticTargetFor(event.target),
        });
      }, { passive: true, capture: true });
    }
  }

  if (wantsFocus || wantsDom) {
    addListener(document, "focusin", (event) => {
      if (wantsFocus) {
        emit({
          kind: "focus.changed",
          ts: Date.now(),
          ...semanticTargetFor(event.target),
          ...writingContextFor(event.target),
        });
      }
      if (wantsDom) {
        queueVisualCheck(event.target, "focusin");
      }
    }, true);
  }

  if (wantsDom) {
    addListener(document, "focusout", (event) => {
      queueVisualCheck(event.target, "focusout");
    }, true);
  }

  if (wantsSelection) {
    addListener(document, "selectionchange", () => {
      const selection = document.getSelection ? document.getSelection() : null;
      const anchorElement = elementForNode(selection ? selection.anchorNode : null);
      const text = selection ? clip(selection.toString(), 200) : undefined;
      emit({
        kind: "selection.changed",
        ts: Date.now(),
        ...semanticTargetFor(anchorElement),
        text,
      });
    }, true);
  }

  if (wantsDom) {
    const mutationObserver = new MutationObserver((records) => {
      const visibleRecords = records.filter(Boolean).slice(0, 4);
      const primaryTarget = visibleRecords.length > 0
        ? semanticTargetFor(visibleRecords[0].target)
        : {};
      const primarySelector = visibleRecords.length > 0
        ? selectorFor(elementForNode(visibleRecords[0].target))
        : undefined;
      const summary = visibleRecords.map((record) => {
        const target = semanticTargetFor(record.target).targetHint;
        if (record.type === "childList") {
          return "childList" + (target ? "@" + target : "");
        }
        if (record.type === "attributes") {
          if (styleSensitiveAttributes.has(String(record.attributeName || "").toLowerCase())) {
            queueVisualCheck(record.target, "attribute(" + String(record.attributeName || "") + ")", true);
          }
          return "attributes(" + String(record.attributeName || "") + ")" + (target ? "@" + target : "");
        }
        return "characterData" + (target ? "@" + target : "");
      }).join(", ");
      const errorSignal = visibleRecords
        .flatMap((record) => candidateErrorNodesForRecord(record))
        .map((node) => errorSignalFor(node))
        .find(Boolean);
      if (errorSignal) {
        emit({
          kind: "dom.error",
          ts: Date.now(),
          summary: clip("error observed: " + (errorSignal.message || errorSignal.reason), 220),
          ...(errorSignal.message ? { text: errorSignal.message, message: errorSignal.message } : {}),
          state: "error",
          ...semanticTargetFor(errorSignal.element),
          ...(selectorFor(errorSignal.element) ? { selector: selectorFor(errorSignal.element) } : {}),
        });
      }
      emit({
        kind: "dom.mutation",
        ts: Date.now(),
        summary: summary || (records.length + " mutations"),
        ...primaryTarget,
        ...(primarySelector ? { selector: primarySelector } : {}),
      });
    });

    const mutationRoot = document.documentElement || document.body || document;
    if (mutationRoot) {
      mutationObserver.observe(mutationRoot, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      cleanupCallbacks.push(() => mutationObserver.disconnect());
    }
  }

  window[bridgeFlag] = configKey;
  return { installed: true, reused: false };
})()`;

function parseEventCursor(value: string | undefined): { ts: number; seq: number } | undefined {
  if (!value) {
    return undefined;
  }

  const [tsPart, seqPart] = value.split(":");
  if (!tsPart) {
    return undefined;
  }

  const ts = Number.parseInt(tsPart, 10);
  if (!Number.isFinite(ts)) {
    return undefined;
  }

  const seq = seqPart ? Number.parseInt(seqPart, 10) : 0;
  return {
    ts,
    seq: Number.isFinite(seq) ? seq : 0,
  };
}

function toEventCursor(event: RawEvent): string {
  return `${Math.floor(event.ts)}:${Math.floor(event.seq ?? 0)}`;
}

function toStructuredCursor(
  subscriptionId: string,
  event: RawEvent | undefined,
  dropped = false,
): Record<string, unknown> {
  return {
    subscriptionId,
    seq: Math.floor(event?.seq ?? 0),
    ...(typeof event?.ts === "number" ? { ts: Math.floor(event.ts) } : {}),
    ...(dropped ? { dropped: true } : {}),
  };
}

function toSubscriptionStartCursor(
  subscriptionId: string,
  firstEvent: RawEvent | undefined,
  dropped = false,
): Record<string, unknown> {
  if (!firstEvent || typeof firstEvent.ts !== "number") {
    return toStructuredCursor(subscriptionId, undefined, dropped);
  }

  return {
    subscriptionId,
    seq: 0,
    ts: Math.floor(firstEvent.ts),
    ...(dropped ? { dropped: true } : {}),
  };
}

function parseStructuredCursor(
  value: unknown,
  subscriptionId: string,
): { ts: number; seq: number; dropped: boolean } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const cursorSubscriptionId = readString(value, "subscriptionId", false);
  if (cursorSubscriptionId && cursorSubscriptionId !== subscriptionId) {
    throw new Error(
      `Cursor subscription mismatch: expected ${subscriptionId}, received ${cursorSubscriptionId}.`,
    );
  }

  const seq = readNumber(value, "seq", false);
  const ts = readNumber(value, "ts", false);
  if (seq === undefined && ts === undefined) {
    return undefined;
  }

  return {
    ts: ts ?? Number.NEGATIVE_INFINITY,
    seq: seq ?? 0,
    dropped: readBoolean(value, "dropped", false),
  };
}

function toPublicRawEvent(event: RawEvent): RawEvent {
  const { seq, ...rest } = event;
  return rest;
}

function isEventAfterCursor(
  event: RawEvent,
  cursor: {
    ts: number;
    seq: number;
  } | undefined,
) {
  if (!cursor) {
    return true;
  }

  if (event.ts > cursor.ts) {
    return true;
  }

  if (event.ts < cursor.ts) {
    return false;
  }

  return (event.seq ?? 0) > cursor.seq;
}

function buildHandleFingerprint(parts: Array<string | undefined | number | boolean>): string {
  return parts
    .map((part) => String(part ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join("|");
}

function parseInputBridgeEvent(params: Record<string, unknown>): RawEvent | undefined {
  const args = Array.isArray(params.args)
    ? (params.args as Array<Record<string, unknown>>)
    : [];

  const payloadText = args
    .map((arg) => (typeof arg.value === "string" ? arg.value : undefined))
    .find((entry): entry is string => Boolean(entry?.startsWith(INPUT_BRIDGE_PREFIX)));

  if (!payloadText) {
    return undefined;
  }

  const jsonText = payloadText.slice(INPUT_BRIDGE_PREFIX.length);
  let payload: unknown;
  try {
    payload = JSON.parse(jsonText);
  } catch {
    return undefined;
  }

  if (!isRecord(payload)) {
    return undefined;
  }

  const kind = typeof payload.kind === "string" ? payload.kind : undefined;
  if (!kind) {
    return undefined;
  }

  const event: RawEvent = {
    kind,
    ts: toTimestampMs(payload.ts),
  };

  if (typeof payload.x === "number" && Number.isFinite(payload.x)) {
    event.x = payload.x;
  }
  if (typeof payload.y === "number" && Number.isFinite(payload.y)) {
    event.y = payload.y;
  }
  if (typeof payload.key === "string") {
    event.key = payload.key;
  }
  if (typeof payload.url === "string") {
    event.url = payload.url;
  }
  if (typeof payload.title === "string") {
    event.title = payload.title;
  }
  if (typeof payload.text === "string") {
    event.text = payload.text;
  }
  if (typeof payload.message === "string") {
    event.message = payload.message;
  }
  if (typeof payload.targetHint === "string") {
    event.targetHint = payload.targetHint;
  }
  if (typeof payload.targetRole === "string") {
    event.targetRole = payload.targetRole;
  }
  if (typeof payload.targetName === "string") {
    event.targetName = payload.targetName;
  }
  if (typeof payload.targetLabel === "string") {
    event.targetLabel = payload.targetLabel;
  }
  if (typeof payload.targetText === "string") {
    event.targetText = payload.targetText;
  }
  if (typeof payload.styleText === "string") {
    event.styleText = payload.styleText;
  }
  if (typeof payload.writingContextType === "string") {
    event.writingContextType = payload.writingContextType;
  }
  if (typeof payload.writingSlot === "string") {
    event.writingSlot = payload.writingSlot;
  }
  if (typeof payload.writingFieldHint === "string") {
    event.writingFieldHint = payload.writingFieldHint;
  }
  if (typeof payload.writingRecipient === "string") {
    event.writingRecipient = payload.writingRecipient;
  }
  if (typeof payload.writingSurfaceKey === "string") {
    event.writingSurfaceKey = payload.writingSurfaceKey;
  }
  if (typeof payload.selector === "string") {
    event.selector = payload.selector;
  }
  if (typeof payload.editableTarget === "boolean") {
    event.editableTarget = payload.editableTarget;
  }
  if (typeof payload.summary === "string") {
    event.summary = payload.summary;
  }
  if (typeof payload.state === "string") {
    event.state = payload.state;
  }

  return event;
}

function buildRedactedEditableTargetHint(event: RawEvent) {
  const targetRole = readString(event, "targetRole", false);
  const targetName = readString(event, "targetName", false);
  const targetLabel = readString(event, "targetLabel", false);
  const selector = readString(event, "selector", false);
  const semanticParts = [
    targetRole && targetRole !== "unknown" ? `role=${targetRole}` : undefined,
    targetName ? `name="${targetName.replace(/"/g, "\\\"")}"` : undefined,
    !targetName && targetLabel ? `label="${targetLabel.replace(/"/g, "\\\"")}"` : undefined,
  ].filter((entry): entry is string => Boolean(entry));
  return semanticParts.join(" ") || selector;
}

function sanitizeBridgeEventForCapture(event: RawEvent, redactTextInput: boolean): RawEvent {
  const baseEvent: RawEvent = { ...event };
  delete baseEvent.editableTarget;
  if (!redactTextInput || event.editableTarget !== true) {
    return baseEvent;
  }

  delete baseEvent.styleText;
  delete baseEvent.targetText;
  const next: RawEvent = { ...baseEvent };
  const nextTargetHint = buildRedactedEditableTargetHint(next);
  if (nextTargetHint) {
    next.targetHint = nextTargetHint;
  } else {
    delete next.targetHint;
  }
  if (next.kind === "selection.changed" && typeof next.text === "string" && next.text.trim().length > 0) {
    next.text = "[redacted]";
  }
  return next;
}

const SEMANTIC_SCAN_EXPRESSION = `(() => {
  const sanitize = (value) => typeof value === 'string' ? value.trim() : '';
  const clip = (value, limit = 180) => {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized.length > limit ? normalized.slice(0, limit - 1) + '…' : normalized;
  };
  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
  const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
  const interactiveRoles = new Set(['button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'slider', 'tab', 'menuitem']);
  const containerTags = new Set(['html', 'body', 'main', 'section', 'article', 'nav', 'aside', 'form', 'div', 'ul', 'ol', 'table', 'tbody', 'thead', 'tfoot', 'tr']);
  const submitPattern = /(submit|save|apply|create|search|continue|next|send|login|sign in|sign up|place order)/i;
  const contentSelector = 'a,button,input,textarea,select,option,[role],h1,h2,h3,h4,h5,h6,p,span,img,li,tr,td,th,label,[tabindex],[contenteditable],[draggable="true"],summary,[onclick]';

  const normalizeRegionRole = (value) => {
    const role = sanitize(value).toLowerCase();
    if (!role) return 'unknown';
    if (['header', 'nav', 'sidebar', 'main', 'panel', 'list', 'table', 'form', 'dialog', 'footer', 'unknown'].includes(role)) return role;
    if (role === 'banner') return 'header';
    if (role === 'navigation') return 'nav';
    if (role === 'complementary') return 'sidebar';
    if (role === 'contentinfo') return 'footer';
    if (role === 'article' || role === 'region') return 'panel';
    return 'unknown';
  };
  const normalizeElementRole = (value) => {
    const role = sanitize(value).toLowerCase();
    if (!role) return 'unknown';
    if (['button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'slider', 'tab', 'menuitem', 'row', 'cell', 'heading', 'text', 'image', 'unknown'].includes(role)) return role;
    if (role === 'switch') return 'checkbox';
    if (role === 'listbox') return 'combobox';
    if (role === 'menuitemcheckbox' || role === 'menuitemradio') return 'menuitem';
    if (role === 'gridcell' || role === 'columnheader' || role === 'rowheader') return 'cell';
    if (role === 'img') return 'image';
    if (role === 'listitem' || role === 'option' || role === 'statictext' || role === 'paragraph') return 'text';
    return 'unknown';
  };
  const normalizeVisualToken = (value) => String(value ?? '').replace(/\\s+/g, '').toLowerCase();
  const visualStyleProps = [
    'color',
    'backgroundColor',
    'borderTopColor',
    'borderRightColor',
    'borderBottomColor',
    'borderLeftColor',
    'outlineColor',
    'textDecorationColor',
    'accentColor',
    'caretColor',
    'boxShadow',
    'opacity',
  ];
  const textFromRefs = (value) => clip(
    sanitize(String(value || '')
      .split(/\\s+/)
      .map((id) => {
        const target = document.getElementById(id);
        return target ? sanitize(target.innerText || target.textContent || '') : '';
      })
      .join(' ')),
    200,
  );
  const semanticNameFor = (el) => clip(
    sanitize(
      el.getAttribute('aria-label')
      || textFromRefs(el.getAttribute('aria-labelledby'))
      || el.getAttribute('name')
      || el.getAttribute('title')
      || el.getAttribute('placeholder')
      || el.getAttribute('alt')
      || '',
    ),
    120,
  );
  const semanticDescriptionFor = (el) => clip(
    sanitize(el.getAttribute('aria-description') || textFromRefs(el.getAttribute('aria-describedby')) || ''),
    160,
  );
  const asRect = (el) => {
    const r = el.getBoundingClientRect();
    return {
      x: Number.isFinite(r.left) ? r.left : 0,
      y: Number.isFinite(r.top) ? r.top : 0,
      width: Number.isFinite(r.width) ? r.width : 0,
      height: Number.isFinite(r.height) ? r.height : 0,
    };
  };
  const intersectsViewport = (bbox) => bbox.y < window.innerHeight && (bbox.y + bbox.height) > 0 && bbox.x < window.innerWidth && (bbox.x + bbox.width) > 0;
  const isVisible = (el) => {
    const style = window.getComputedStyle(el);
    if (!style || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) {
      return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const visualSignatureFor = (el) => {
    const style = window.getComputedStyle(el);
    if (!style) return undefined;
    const parts = visualStyleProps.map((prop) => {
      const normalized = normalizeVisualToken(style[prop]);
      return normalized ? prop + '=' + normalized : undefined;
    }).filter(Boolean);
    const ariaInvalid = sanitize(el.getAttribute('aria-invalid')).toLowerCase();
    if (ariaInvalid) parts.push('aria-invalid=' + ariaInvalid);
    if (el.disabled === true) parts.push('disabled=true');
    if (el.checked === true) parts.push('checked=true');
    if (el.selected === true) parts.push('selected=true');
    if (typeof el.matches === 'function' && el.matches(':focus')) parts.push('focus=true');
    if (typeof el.matches === 'function' && el.matches(':hover')) parts.push('hover=true');
    if (typeof el.matches === 'function' && el.matches(':active')) parts.push('active=true');
    if (typeof el.checkValidity === 'function') {
      try {
        parts.push('valid=' + String(el.checkValidity()));
      } catch {
        // Ignore validity checks that throw on unsupported elements.
      }
    }
    return parts.join('|') || undefined;
  };
  const textOf = (el) => clip(sanitize(el.innerText || el.textContent || ''), 200);
  const esc = (value) => {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
  };
  const selectorFor = (el) => {
    if (el.id) return '#' + esc(el.id);
    const testId = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-qa');
    if (testId) return '[data-testid="' + String(testId).replace(/"/g, '\\\\\\"') + '"]';
    const parts = [];
    let current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
      const tag = current.tagName.toLowerCase();
      let part = tag;
      const name = current.getAttribute('name');
      if (name) {
        part += '[name="' + String(name).replace(/"/g, '\\\\\\"') + '"]';
      } else {
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
          if (siblings.length > 1) {
            part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
          }
        }
      }
      parts.unshift(part);
      if (current.parentElement && current.parentElement.id) {
        parts.unshift('#' + esc(current.parentElement.id));
        break;
      }
      current = current.parentElement;
    }
    return parts.join(' > ');
  };
  const regionRole = (el) => {
    const role = sanitize(el.getAttribute('role')).toLowerCase();
    const tag = el.tagName.toLowerCase();
    if (role === 'banner' || tag === 'header') return 'header';
    if (role === 'navigation' || tag === 'nav') return 'nav';
    if (role === 'complementary' || tag === 'aside') return 'sidebar';
    if (role === 'main' || tag === 'main') return 'main';
    if (role === 'form' || tag === 'form') return 'form';
    if (role === 'dialog' || tag === 'dialog') return 'dialog';
    if (role === 'contentinfo' || tag === 'footer') return 'footer';
    if (role === 'table' || tag === 'table') return 'table';
    if (role === 'list' || tag === 'ul' || tag === 'ol') return 'list';
    if (tag === 'section' || tag === 'article') return 'panel';
    return normalizeRegionRole(role);
  };
  const elementRole = (el) => {
    const explicitRole = sanitize(el.getAttribute('role')).toLowerCase();
    const tag = el.tagName.toLowerCase();
    const type = sanitize(el.getAttribute('type')).toLowerCase();
    const searchHintSource = sanitize([
      el.getAttribute('aria-label'),
      el.getAttribute('placeholder'),
      el.getAttribute('name'),
      el.getAttribute('id'),
      el.getAttribute('title'),
      el.closest && el.closest('form[role="search"],[role="search"]') ? 'search' : '',
    ].filter(Boolean).join(' '));
    const looksLikeSearchInput = tag === 'input'
      && (!type || type === 'text' || type === 'search')
      && /(^|\\b)(search|query|keyword|keywords)(\\b|$)|搜索|查找|查询|检索|关键词/i.test(searchHintSource);
    if (explicitRole === 'button' || tag === 'button') return 'button';
    if (explicitRole === 'link' || tag === 'a') return 'link';
    if (explicitRole === 'searchbox' || (tag === 'input' && type === 'search') || looksLikeSearchInput) return 'searchbox';
    if (explicitRole === 'textbox' || tag === 'textarea' || (tag === 'input' && ['text', 'email', 'url', 'password', 'tel', 'number'].includes(type))) return 'textbox';
    if (explicitRole === 'checkbox' || (tag === 'input' && type === 'checkbox')) return 'checkbox';
    if (explicitRole === 'radio' || (tag === 'input' && type === 'radio')) return 'radio';
    if (explicitRole === 'combobox' || tag === 'select') return 'combobox';
    if (explicitRole === 'slider' || (tag === 'input' && type === 'range')) return 'slider';
    if (explicitRole === 'tab') return 'tab';
    if (explicitRole === 'menuitem') return 'menuitem';
    if (el.isContentEditable) return 'textbox';
    if (explicitRole === 'row' || tag === 'tr') return 'row';
    if (explicitRole === 'cell' || tag === 'td' || tag === 'th') return 'cell';
    if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') return 'heading';
    if (tag === 'img') return 'image';
    if (tag === 'p' || tag === 'span' || tag === 'label' || tag === 'li') return 'text';
    return normalizeElementRole(explicitRole);
  };
  const associatedLabelFor = (el) => {
    const ariaLabel = semanticNameFor(el);
    if (ariaLabel) return ariaLabel;
    if (el.labels && el.labels.length) {
      const text = clip(Array.from(el.labels).map((label) => textOf(label)).filter(Boolean).join(' '), 120);
      if (text) return text;
    }
    const id = el.getAttribute('id');
    if (id) {
      const explicit = document.querySelector('label[for="' + String(id).replace(/"/g, '\\\\\\"') + '"]');
      if (explicit) {
        const text = textOf(explicit);
        if (text) return text;
      }
    }
    const wrapped = el.closest('label');
    if (wrapped) {
      const text = textOf(wrapped);
      if (text) return text;
    }
    return undefined;
  };
  const describeSemanticTarget = (el) => {
    const role = elementRole(el);
    const name = semanticNameFor(el);
    const label = associatedLabelFor(el);
    const text = clip(textOf(el), 80);
    return [
      role && role !== 'unknown' ? 'role=' + role : undefined,
      name ? 'name="' + String(name).replace(/"/g, '\\\\\\"') + '"' : undefined,
      !name && label ? 'label="' + String(label).replace(/"/g, '\\\\\\"') + '"' : undefined,
      !name && !label && text ? 'text="' + String(text).replace(/"/g, '\\\\\\"') + '"' : undefined,
    ].filter(Boolean).join(' ');
  };
  const buildLocatorHints = (el, extras = []) => {
    const semanticHint = describeSemanticTarget(el);
    const hints = [semanticHint, selectorFor(el)];
    if (el.id) hints.push('#' + esc(el.id));
    const testId = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-qa');
    if (testId) hints.push('[data-testid="' + String(testId).replace(/"/g, '\\\\\\"') + '"]');
    const role = elementRole(el);
    if (role && role !== 'unknown') hints.push('role=' + role);
    const name = semanticNameFor(el);
    if (name) hints.push('name="' + String(name).replace(/"/g, '\\\\\\"') + '"');
    const label = associatedLabelFor(el);
    if (label && label !== name) hints.push('label="' + String(label).replace(/"/g, '\\\\\\"') + '"');
    for (const entry of extras) {
      if (entry) hints.push(clip(entry, 120));
    }
    return Array.from(new Set(hints.filter(Boolean)));
  };
  const hasInlineHandler = (el) =>
    ['onclick', 'onmousedown', 'onmouseup', 'onkeydown', 'onkeyup', 'onkeypress', 'oninput', 'onchange']
      .some((attr) => el.hasAttribute(attr));
  const hasStateHint = (el) =>
    ['aria-pressed', 'aria-expanded', 'aria-selected', 'aria-controls', 'aria-haspopup', 'aria-valuenow']
      .some((attr) => el.hasAttribute(attr));
  const isFocusable = (el) => {
    const tag = el.tagName.toLowerCase();
    if (el.tabIndex >= 0) return true;
    if (el.isContentEditable) return true;
    if (tag === 'a' && el.hasAttribute('href')) return true;
    return ['input', 'textarea', 'select', 'button', 'summary'].includes(tag);
  };
  const hasKeyboardHint = (el) =>
    isFocusable(el)
    || ['onkeydown', 'onkeyup', 'onkeypress'].some((attr) => el.hasAttribute(attr))
    || ['button', 'link', 'tab', 'menuitem', 'slider'].includes(sanitize(el.getAttribute('role')).toLowerCase());
  const isHitTestable = (el, visible, enabled) => {
    if (!visible || !enabled) return false;
    const style = window.getComputedStyle(el);
    if (!style || style.pointerEvents === 'none') return false;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const cx = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
    const cy = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
    const hit = document.elementFromPoint(cx, cy);
    if (!hit) return false;
    return hit === el || el.contains(hit) || hit.contains(el);
  };
  const isCustomInteractiveCandidate = (el) => {
    const tag = el.tagName.toLowerCase();
    const isCustomTag = tag.includes('-');
    if (!['div', 'span', 'li', 'p', 'img', 'svg'].includes(tag) && !isCustomTag) {
      return false;
    }
    if (!isVisible(el)) {
      return false;
    }
    const style = window.getComputedStyle(el);
    const pointerCursor = Boolean(style && style.cursor === 'pointer');
    const focusable = isFocusable(el);
    const editable = Boolean(el.isContentEditable);
    const hasInteractiveHint = pointerCursor || focusable || editable || hasInlineHandler(el) || hasStateHint(el);
    if (!hasInteractiveHint) {
      return false;
    }
    const bbox = asRect(el);
    if (bbox.width < 10 || bbox.height < 10) {
      return false;
    }
    if (bbox.width > window.innerWidth * 0.96 && bbox.height > window.innerHeight * 0.45) {
      return false;
    }
    const text = textOf(el);
    if (!text && !hasStateHint(el) && el.children.length > 10) {
      return false;
    }
    return true;
  };

  const regionNodes = Array.from(new Set(Array.from(document.querySelectorAll('header,nav,aside,main,section,article,form,footer,dialog,[role="banner"],[role="navigation"],[role="complementary"],[role="main"],[role="form"],[role="dialog"],[role="contentinfo"],[role="table"],[role="list"]')))).slice(0, 80);
  const regionRecords = regionNodes.map((el, index) => {
    const bbox = asRect(el);
    const name = semanticNameFor(el) || undefined;
    return {
      el,
      regionId: 'region-' + (index + 1),
      role: regionRole(el),
      name,
      bbox,
      inViewport: intersectsViewport(bbox),
      textSummary: textOf(el) || undefined,
      childElementIds: [],
      _selector: selectorFor(el),
      _locatorHints: buildLocatorHints(el, [name, textOf(el)]),
    };
  });

  if (!regionRecords.length) {
    const bbox = asRect(document.body);
    regionRecords.push({
      el: document.body,
      regionId: 'region-1',
      role: 'main',
      name: undefined,
      bbox,
      inViewport: true,
      textSummary: textOf(document.body) || undefined,
      childElementIds: [],
      _selector: 'body',
      _locatorHints: ['body'],
    });
  }

  const resolveRegionRecord = (el) => {
    let current = el;
    while (current) {
      const found = regionRecords.find((region) => region.el === current);
      if (found) return found;
      current = current.parentElement;
    }
    return regionRecords[0];
  };

  const formRoots = [];
  const seenForms = new Set();
  const addFormRoot = (el) => {
    if (!el || seenForms.has(el)) return;
    seenForms.add(el);
    formRoots.push(el);
  };
  Array.from(document.querySelectorAll('form,[role="form"]')).slice(0, 60).forEach(addFormRoot);
  for (const region of regionRecords) {
    if (region.role === 'form') addFormRoot(region.el);
  }
  if (!formRoots.length) {
    const controlNodes = Array.from(document.querySelectorAll('input,textarea,select,[role="textbox"],[role="combobox"],[role="checkbox"],[role="radio"]')).filter((el) => isVisible(el)).slice(0, 120);
    const grouped = new Map();
    for (const control of controlNodes) {
      const container = control.closest('section,article,main,dialog,fieldset,div');
      if (!container) continue;
      const current = grouped.get(container) || { count: 0 };
      current.count += 1;
      grouped.set(container, current);
    }
    Array.from(grouped.entries())
      .filter(([, value]) => value.count >= 2)
      .sort((left, right) => right[1].count - left[1].count)
      .slice(0, 5)
      .forEach(([el]) => addFormRoot(el));
  }

  const formRecords = formRoots.slice(0, 40).map((el, index) => {
    const bbox = asRect(el);
    const region = resolveRegionRecord(el);
    const heading = el.querySelector('legend,h1,h2,h3,h4,h5,h6');
    const name = semanticNameFor(el) || (heading ? textOf(heading) : '') || undefined;
    return {
      el,
      formId: 'form-' + (index + 1),
      regionId: region.regionId,
      name,
      description: semanticDescriptionFor(el) || undefined,
      method: sanitize(el.getAttribute('method')).toLowerCase() || undefined,
      action: sanitize(el.getAttribute('action')) || undefined,
      bbox,
      inViewport: intersectsViewport(bbox),
      textSummary: textOf(el) || undefined,
      controlElementIds: [],
      submitActionElementIds: [],
      locatorHints: buildLocatorHints(el, [name, textOf(el), region.name]),
      _selector: selectorFor(el),
    };
  });

  const resolveFormRecord = (el) => {
    let current = el;
    while (current) {
      const found = formRecords.find((form) => form.el === current);
      if (found) return found;
      current = current.parentElement;
    }
    return undefined;
  };

  const baseElementNodes = Array.from(document.querySelectorAll(contentSelector));
  const baseElementSet = new Set(baseElementNodes);
  const supplementalNodes = Array.from(document.querySelectorAll('div,span,li,p,img,svg,[aria-pressed],[aria-expanded],[aria-selected],[aria-controls],[aria-haspopup],[aria-valuenow]'))
    .filter((el) => !baseElementSet.has(el) && isCustomInteractiveCandidate(el))
    .slice(0, 420);
  const elementNodes = Array.from(new Set([...baseElementNodes, ...supplementalNodes])).slice(0, 1100);
  const elements = elementNodes.map((el, index) => {
    const bbox = asRect(el);
    const role = elementRole(el);
    const tagName = el.tagName.toLowerCase();
    const htmlType = sanitize(el.getAttribute('type')).toLowerCase() || undefined;
    const region = resolveRegionRecord(el);
    const form = resolveFormRecord(el);
    const name = semanticNameFor(el) || undefined;
    const description = semanticDescriptionFor(el) || undefined;
    const associatedLabel = associatedLabelFor(el) || undefined;
    const text = textOf(el) || undefined;
    const value = typeof el.value === 'string' ? clip(sanitize(el.value), 200) || undefined : undefined;
    const enabled = !(el.disabled === true || el.getAttribute('aria-disabled') === 'true');
    const visible = isVisible(el);
    const style = window.getComputedStyle(el);
    const focusable = isFocusable(el);
    const editable = Boolean(el.isContentEditable);
    const pointerCursor = Boolean(style && style.cursor === 'pointer');
    const clickableHint = hasInlineHandler(el) || pointerCursor || hasStateHint(el) || role === 'button' || role === 'link';
    const keyboardHint = hasKeyboardHint(el);
    const isHit = isHitTestable(el, visible, enabled);
    const selected = el.getAttribute('aria-selected') === 'true' || el.selected === true;
    const checked = el.getAttribute('aria-checked') === 'true' || el.checked === true;
    const pressed = el.getAttribute('aria-pressed') === 'true';
    const expanded = el.getAttribute('aria-expanded') === 'true';
    const childInterest = Array.from(el.children).filter((child) => child.matches && child.matches(contentSelector)).length;
    const areaRatio = (Math.max(0, bbox.width) * Math.max(0, bbox.height)) / viewportArea;
    const isRootNode = el === document.body || el === document.documentElement || !el.parentElement;
    const explicitInteractive = interactiveRoles.has(role) || ['button', 'a', 'input', 'textarea', 'select', 'option'].includes(tagName);
    const behaviorInteractive = explicitInteractive || focusable || editable || pointerCursor || clickableHint || keyboardHint;
    const isContainer = (containerTags.has(tagName) && !behaviorInteractive) || role === 'row' || (childInterest > 1 && !behaviorInteractive) || areaRatio > 0.35;
    const isLeaf = !isContainer || childInterest === 0;
    let interactivityScore = 0.05;
    if (explicitInteractive) interactivityScore += 0.45;
    else if (behaviorInteractive) interactivityScore += 0.28;
    if (visible) interactivityScore += 0.08;
    if (enabled) interactivityScore += 0.08;
    if (isHit) interactivityScore += 0.12;
    if (focusable) interactivityScore += 0.08;
    if (editable) interactivityScore += 0.18;
    if (pointerCursor) interactivityScore += 0.08;
    if (clickableHint) interactivityScore += 0.06;
    if (keyboardHint) interactivityScore += 0.05;
    if (name || text || associatedLabel) interactivityScore += 0.05;
    if (form) interactivityScore += 0.04;
    if (role === 'unknown') interactivityScore -= 0.12;
    if (isContainer) interactivityScore -= 0.2;
    if (isRootNode) interactivityScore -= 0.8;
    if (areaRatio > 0.4) interactivityScore -= 0.2;
    if (bbox.width < 6 || bbox.height < 6) interactivityScore -= 0.2;
    interactivityScore = clamp(interactivityScore, 0, 1);
    const isPrimaryActionCandidate = visible
      && enabled
      && isHit
      && !isRootNode
      && interactivityScore >= 0.55
      && !(isContainer && !behaviorInteractive)
      && !(role === 'unknown' && !isHit);
    const locatorHints = buildLocatorHints(el, [name, text, associatedLabel, form ? form.name : undefined, region ? region.name : undefined]);

    return {
      elementId: 'element-' + (index + 1),
      regionId: region.regionId,
      formId: form ? form.formId : undefined,
      role,
      name,
      description,
      associatedLabel,
      text,
      value,
      tagName,
      htmlType,
      bbox,
      visible,
      enabled,
      isHitTestable: isHit,
      focusable,
      editable,
      pointerCursor,
      clickableHint,
      keyboardHint,
      draggable: el.draggable === true || el.getAttribute('draggable') === 'true',
      isLeaf,
      isContainer,
      isPrimaryActionCandidate,
      interactivityScore: Number(interactivityScore.toFixed(3)),
      selected,
      checked,
      pressed,
      expanded,
      visualSignature: visualSignatureFor(el),
      locatorHints,
      _selector: selectorFor(el),
    };
  });

  const regionById = new Map(regionRecords.map((region) => [region.regionId, region]));
  const formById = new Map(formRecords.map((form) => [form.formId, form]));
  for (const element of elements) {
    const region = regionById.get(element.regionId);
    if (region) {
      region.childElementIds.push(element.elementId);
    }
    if (element.formId) {
      const form = formById.get(element.formId);
      if (form) {
        form.controlElementIds.push(element.elementId);
        const mergedText = [element.name, element.associatedLabel, element.text, element.htmlType].filter(Boolean).join(' ');
        if (
          element.isPrimaryActionCandidate &&
          (element.htmlType === 'submit'
            || element.role === 'button'
            || element.role === 'link'
            || submitPattern.test(mergedText))
        ) {
          form.submitActionElementIds.push(element.elementId);
        }
      }
    }
  }

  return {
    regions: regionRecords.map(({ el, _selector, _locatorHints, ...region }) => region),
    forms: formRecords.map(({ el, _selector, ...form }) => ({
      ...form,
      controlElementIds: Array.from(new Set(form.controlElementIds)),
      submitActionElementIds: Array.from(new Set(form.submitActionElementIds)),
    })),
    elements: elements.map(({ _selector, ...element }) => element),
    elementLocators: elements.map((element) => ({ elementId: element.elementId, selector: element._selector })),
    regionLocators: regionRecords.map((region) => ({ regionId: region.regionId, selector: region._selector })),
    formLocators: formRecords.map((form) => ({ formId: form.formId, selector: form._selector })),
  };
})()`;

export class AutomationMcpService {
  private readonly sessions = new Map<string, AttachedSession>();
  private readonly captures = new Map<string, EventCaptureState>();
  private readonly snapshots = new Map<string, StoredSnapshot>();
  private readonly actions = new Map<string, ExecutedAction>();
  private readonly handles = new Map<string, LiveHandleState>();
  private readonly handleIdsByFingerprint = new Map<string, string>();
  private readonly inputBridgeInstallInFlight = new Map<number, Promise<void>>();
  private readonly toolHandlers: Record<InternalToolName, ToolHandler> = {
    "browser.list_windows": (input, options) => this.listWindows(input, options),
    "browser.list_tabs": (input, options) => this.listTabs(input, options),
    "window.create": (input) => this.windowCreate(input),
    "window.focus": (input) => this.windowFocus(input),
    "window.close": (input) => this.windowClose(input),
    "tab.create": (input, options) => this.tabCreate(input, options),
    "tab.close": (input) => this.tabClose(input),
    "tab.activate": (input) => this.tabActivate(input),
    "tab.go_back": (input) => this.tabGoBack(input),
    "tab.go_forward": (input) => this.tabGoForward(input),
    "tab.reload": (input) => this.tabReload(input),
    "page.open": (input) => this.pageOpen(input),
    "page.snapshot": (input) => this.pageSnapshot(input),
    "page.extract": (input) => this.pageExtract(input),
    "page.interact": (input) => this.pageInteract(input),
    "context.attach": (input) => this.contextAttach(input),
    "context.get": (input) => this.contextGet(input),
    "context.describe": (input) => this.contextDescribe(input),
    "context.subscribe": (input) => this.contextSubscribe(input),
    "context.read": (input) => this.contextRead(input),
    "context.unsubscribe": (input) => this.contextUnsubscribe(input),
    "locate.find": (input) => this.locateFind(input),
    "extract.records": (input) => this.extractRecords(input),
    "act.step": (input) => this.actStep(input),
    "browser.open_url": (input) => this.openUrl(input),
    "browser.attach_session": (input) => this.attachSession(input),
    "browser.get_page_context": (input) => this.getPageContext(input),
    "browser.extract_data": (input) => this.extractData(input),
    "browser.navigate": (input) => this.navigate(input),
    "browser.send_cdp_command": (input) => this.sendCdpCommand(input),
    "browser.detach_session": (input) => this.detachSession(input),
    "observe.start_event_capture": (input) => this.startEventCapture(input),
    "observe.stop_event_capture": (input) => this.stopEventCapture(input),
    "observe.read_events": (input) => this.readEvents(input),
    "semantic.capture_page_snapshot": (input) => this.capturePageSnapshot(input),
    "semantic.resolve_event_targets": (input) => this.resolveEventTargets(input),
    "execute.perform_action": (input) => this.performAction(input),
    "execute.submit_form": (input) => this.submitForm(input),
    "execute.observe_outcome": (input) => this.observeOutcome(input),
  };
  private readonly publicToolHandlers: Record<PublicToolName, ToolHandler> = {
    "browser_session_open": (input) => this.publicSessionOpen(input),
    "browser_session_close": (input) => this.publicSessionClose(input),
    "browser_tab_create": (input, options) => this.publicTabCreate(input, options),
    "browser_ax_snapshot": (input) => this.publicAxSnapshot(input),
    "browser_ax_query": (input) => this.publicAxQuery(input),
    "browser_element_click": (input) => this.publicElementClick(input),
    "browser_element_input": (input) => this.publicElementInput(input),
    "browser_element_select": (input) => this.publicElementSelect(input),
    "browser_element_press": (input) => this.publicElementPress(input),
    "browser_element_scroll": (input) => this.publicElementScroll(input),
    "browser_events_subscribe": (input) => this.publicEventsSubscribe(input),
    "browser_events_read": (input) => this.publicEventsRead(input),
    "browser_events_await": (input, options) => this.publicEventsAwait(input, options),
    "browser_events_unsubscribe": (input) => this.publicEventsUnsubscribe(input),
    "browser_dialog_handle": (input) => this.publicDialogHandle(input),
  };

  constructor(private readonly context: AutomationMcpContext) {}

  listTools(): McpToolExport[] {
    return PublicToolRegistry
      .map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      risk: tool.risk,
      tags: [...tool.tags],
      }));
  }

  listAgentTools(names?: InternalToolName[]): McpToolExport[] {
    const tools = Array.isArray(names) && names.length > 0
      ? names.map((name) => ToolSchemas[name])
      : ToolRegistry;

    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      risk: tool.risk,
      tags: [...tool.tags],
    }));
  }

  listAliasesForTool(name: string): string[] {
    if (!validatePublicToolExists(name)) {
      return [];
    }
    return [...(TOOL_ALIASES_BY_CANONICAL.get(name) ?? [])];
  }

  exportMcp(): McpServerExport {
    return {
      server: {
        name: "milo-automation-mcp",
        version: "0.1.0",
      },
      tools: this.listTools(),
    };
  }

  private normalizePublicToolOutput(_name: PublicToolName, output: unknown): unknown {
    return output;
  }

  private getWindowWorkspaceId(windowId: number) {
    return this.context.windowToWorkspace.get(windowId) ?? this.context.defaultWorkspaceId;
  }

  private tryFindTabContext(tabId: string) {
    try {
      return this.findTabContext(tabId);
    } catch {
      return null;
    }
  }

  private throwBoundWorkspaceConflict(payload: {
    toolName: string;
    boundWorkspaceId: string;
    fieldPath: string;
    provided: string;
  }): never {
    throw new AutomationToolError({
      errorCode: "BOUND_WORKSPACE_CONFLICT",
      category: "execution",
      message: `Tool ${payload.toolName} is bound to workspace ${payload.boundWorkspaceId} and cannot use ${payload.fieldPath}=${payload.provided}.`,
      retryable: true,
      fieldPath: payload.fieldPath,
      provided: payload.provided,
      suggestion: "Drop explicit workspace/window/tab references and let the agent use its bound automation workspace.",
    });
  }

  private applyBoundWorkspaceToPayload(
    name: string,
    input: Record<string, unknown>,
    boundWorkspaceId?: string,
    boundTabId?: string,
    boundScope: "workspace" | "tab" = "workspace",
  ) {
    if (!boundWorkspaceId) {
      return input;
    }

    const payload = { ...input };
    const boundTabContext = boundTabId ? this.tryFindTabContext(boundTabId) : null;
    const isTabScoped = boundScope === "tab";
    if (isTabScoped && (!boundTabId || !boundTabContext)) {
      this.throwBoundWorkspaceConflict({
        toolName: name,
        boundWorkspaceId,
        fieldPath: "tabId",
        provided: boundTabId ?? "missing",
      });
    }
    const requestedWorkspaceId = readString(payload, "workspaceId", false);
    const sessionInput = payload.session;
    if (sessionInput !== undefined) {
      const session = this.resolveSessionRef(payload);
      if (session.workspaceId !== boundWorkspaceId) {
        this.throwBoundWorkspaceConflict({
          toolName: name,
          boundWorkspaceId,
          fieldPath: "session.sessionId",
          provided: session.ref.sessionId,
        });
      }
      if (isTabScoped && session.ref.tabId !== boundTabId) {
        this.throwBoundWorkspaceConflict({
          toolName: name,
          boundWorkspaceId,
          fieldPath: "session.tabId",
          provided: session.ref.tabId,
        });
      }
    }

    const pageInput = payload.page;
    if (pageInput !== undefined) {
      const page = assertObject(pageInput, "page must be an object.");
      const session = this.resolveSessionRef({
        session: {
          sessionId: readString(page, "sessionId") as string,
          tabId: readString(page, "tabId") as string,
        },
      });
      if (session.workspaceId !== boundWorkspaceId) {
        this.throwBoundWorkspaceConflict({
          toolName: name,
          boundWorkspaceId,
          fieldPath: "page.sessionId",
          provided: session.ref.sessionId,
        });
      }
      if (isTabScoped && session.ref.tabId !== boundTabId) {
        this.throwBoundWorkspaceConflict({
          toolName: name,
          boundWorkspaceId,
          fieldPath: "page.tabId",
          provided: session.ref.tabId,
        });
      }
    }

    if (requestedWorkspaceId && requestedWorkspaceId !== boundWorkspaceId) {
      this.throwBoundWorkspaceConflict({
        toolName: name,
        boundWorkspaceId,
        fieldPath: "workspaceId",
        provided: requestedWorkspaceId,
      });
    }

    const tabId = readString(payload, "tabId", false);
    if (tabId) {
      const tabContext = this.tryFindTabContext(tabId);
      if (isTabScoped && tabId !== boundTabId) {
        this.throwBoundWorkspaceConflict({
          toolName: name,
          boundWorkspaceId,
          fieldPath: "tabId",
          provided: tabId,
        });
      }
      if (tabContext && tabContext.workspaceId !== boundWorkspaceId) {
        this.throwBoundWorkspaceConflict({
          toolName: name,
          boundWorkspaceId,
          fieldPath: "tabId",
          provided: tabId,
        });
      }
    }

    const windowId = readWindowId(payload, "windowId", false);
    if (
      isTabScoped
      && boundTabContext
      && typeof windowId === "number"
      && windowId !== boundTabContext.windowId
    ) {
      this.throwBoundWorkspaceConflict({
        toolName: name,
        boundWorkspaceId,
        fieldPath: "windowId",
        provided: String(windowId),
      });
    }
    if (typeof windowId === "number" && this.getWindowWorkspaceId(windowId) !== boundWorkspaceId) {
      if (name === "browser_session_open" && readString(payload, "url", false)) {
        delete payload.windowId;
      } else {
        this.throwBoundWorkspaceConflict({
          toolName: name,
          boundWorkspaceId,
          fieldPath: "windowId",
          provided: String(windowId),
        });
      }
    }

    if (
      isTabScoped
      && (
        name === "window.create"
        || name === "window.focus"
        || name === "window.close"
        || name === "tab.close"
        || name === "tab.activate"
      )
    ) {
      this.throwBoundWorkspaceConflict({
        toolName: name,
        boundWorkspaceId,
        fieldPath: "scope",
        provided: "current-tab",
      });
    }

    const shouldBindDefaultWorkspace = name === "browser.list_windows"
      || name === "browser.list_tabs"
      || name === "window.create";
    if (shouldBindDefaultWorkspace && !requestedWorkspaceId) {
      payload.workspaceId = boundWorkspaceId;
    }

    if (name === "browser_session_open") {
      payload.workspaceId = boundWorkspaceId;
    }

    const shouldBindDefaultTab = name === "browser_session_open"
      || name === "browser.open_url"
      || name === "page.open";
    if (shouldBindDefaultTab && !readString(payload, "tabId", false) && readString(payload, "url", false) && boundTabId) {
      payload.tabId = boundTabId;
    }

    const shouldBindDefaultWindow = name === "browser_tab_create" || name === "tab.create";
    if (shouldBindDefaultWindow && readWindowId(payload, "windowId", false) === undefined && boundTabContext) {
      payload.windowId = String(boundTabContext.windowId);
    }

    return payload;
  }

  async callAgentTool(name: string, input: unknown, options?: ToolCallOptions): Promise<unknown> {
    const canonicalName = this.resolveAgentToolName(name);

    if (!isRecord(input)) {
      throw new AutomationToolError({
        errorCode: "INPUT_VALIDATION_ERROR",
        category: "validation",
        message: `Tool ${name} expects an object payload.`,
        retryable: true,
        expected: "object",
        provided: input,
      });
    }

    const schema = ToolSchemas[canonicalName];
    const payload = this.applyBoundWorkspaceToPayload(
      canonicalName,
      { ...input },
      options?.boundWorkspaceId,
      options?.boundTabId,
      options?.boundScope,
    );
    this.validateToolInputPayload(canonicalName, payload, schema);

    try {
      const handler = this.toolHandlers[canonicalName];
      const output = await handler(payload, options);
      const normalizedOutput = this.normalizeAgentToolOutput(output);
      this.validateToolOutputPayload(canonicalName, normalizedOutput, schema);
      return normalizedOutput;
    } catch (error) {
      throw this.normalizeToolError(canonicalName, error);
    }
  }

  async callTool(name: string, input: unknown, options?: ToolCallOptions): Promise<unknown> {
    const canonicalName = this.resolveToolName(name);

    if (!isRecord(input)) {
      throw new AutomationToolError({
        errorCode: "INPUT_VALIDATION_ERROR",
        category: "validation",
        message: `Tool ${name} expects an object payload.`,
        retryable: true,
        expected: "object",
        provided: input,
      });
    }

    const schema = this.getToolSchema(canonicalName);
    const normalizedPayload = this.normalizeToolPayload(canonicalName, input);
    const payload = this.applyBoundWorkspaceToPayload(
      canonicalName,
      normalizedPayload,
      options?.boundWorkspaceId,
      options?.boundTabId,
      options?.boundScope,
    );
    this.validateToolInputPayload(canonicalName, payload, schema);

    try {
      const handler = this.publicToolHandlers[canonicalName];
      const output = await handler(payload, options);
      const normalizedOutput = this.normalizePublicToolOutput(canonicalName, output);
      this.validateToolOutputPayload(canonicalName, normalizedOutput, schema);
      return normalizedOutput;
    } catch (error) {
      throw this.normalizeToolError(canonicalName, error);
    }
  }

  releaseSessionsForTab(tabId: string) {
    const normalizedTabId = tabId.trim();
    if (!normalizedTabId) {
      return;
    }

    const releasedSessionIds = new Set<string>();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.ref.tabId === normalizedTabId) {
        releasedSessionIds.add(sessionId);
        this.sessions.delete(sessionId);
      }
    }

    for (const [captureId, capture] of this.captures.entries()) {
      if (capture.ref.tabId !== normalizedTabId && !releasedSessionIds.has(capture.sessionId)) {
        continue;
      }

      try {
        capture.stopListening();
      } catch {
        // Ignore capture cleanup failures while closing an ephemeral tab.
      }
      this.captures.delete(captureId);
    }

    for (const [snapshotId, snapshot] of this.snapshots.entries()) {
      if (releasedSessionIds.has(snapshot.sessionId)) {
        this.snapshots.delete(snapshotId);
      }
    }

    for (const [actionId, action] of this.actions.entries()) {
      if (releasedSessionIds.has(action.sessionId)) {
        this.actions.delete(actionId);
      }
    }

    for (const [handleId, handle] of this.handles.entries()) {
      if (!releasedSessionIds.has(handle.sessionId)) {
        continue;
      }
      this.handles.delete(handleId);
      this.handleIdsByFingerprint.delete(handle.fingerprint);
    }
  }

  getToolSchema(name: PublicToolName): ToolDefinition {
    return PublicToolSchemas[name];
  }

  private resolveAgentToolName(name: string): InternalToolName {
    const normalized = name.trim();
    const normalizedLower = normalized.toLowerCase();

    if (validateToolExists(normalized)) {
      return normalized;
    }

    if (validateToolExists(normalizedLower)) {
      return normalizedLower;
    }

    const suggestions = Object.keys(ToolSchemas)
      .filter((candidate) =>
        candidate.includes(normalizedLower)
        || normalizedLower.includes(candidate)
        || candidate.split(".").some((segment) => segment.includes(normalizedLower)))
      .slice(0, 3);

    throw new AutomationToolError({
      errorCode: "UNKNOWN_TOOL",
      category: "tool",
      message: `Tool does not exist: ${name}`,
      retryable: false,
      ...(suggestions.length
        ? { suggestion: `Did you mean: ${suggestions.join(", ")}?` }
        : {}),
      details: {
        tool: name,
        suggestions,
      },
    });
  }

  private resolveToolName(name: string): PublicToolName {
    const normalized = name.trim();
    const normalizedLower = normalized.toLowerCase();

    if (validatePublicToolExists(normalized)) {
      return normalized;
    }

    if (validatePublicToolExists(normalizedLower)) {
      return normalizedLower;
    }

    const aliasTarget = TOOL_ALIASES[normalizedLower];
    if (aliasTarget) {
      return aliasTarget;
    }

    const redirect = LEGACY_TOOL_REDIRECTS[normalizedLower] ?? LEGACY_TOOL_REDIRECTS[normalized];
    if (redirect) {
      throw new AutomationToolError({
        errorCode: "TOOL_REPLACED",
        category: "tool",
        message: `Tool ${name} is no longer part of the public MCP surface.`,
        retryable: false,
        suggestion: `Use ${redirect} instead.`,
        details: {
          tool: name,
          replacement: redirect,
        },
      });
    }

    const suggestions = this.suggestToolNames(name);
    throw new AutomationToolError({
      errorCode: "UNKNOWN_TOOL",
      category: "tool",
      message: `Tool does not exist: ${name}`,
      retryable: false,
      ...(suggestions.length
        ? { suggestion: `Did you mean: ${suggestions.join(", ")}?` }
        : {}),
      details: {
        tool: name,
        suggestions,
      },
    });
  }

  private suggestToolNames(name: string): string[] {
    const normalized = name.toLowerCase();
    const segment = normalized.split(".").pop() ?? normalized;
    const canonicalNames = Object.keys(PublicToolSchemas);
    const names = [
      ...canonicalNames.map((candidate) => ({ surface: candidate, canonical: candidate })),
      ...Object.entries(TOOL_ALIASES).map(([alias, canonical]) => ({
        surface: alias,
        canonical,
      })),
    ];

    const ranked = names
      .map(({ surface, canonical }) => {
        const lower = surface.toLowerCase();
        let score = 0;
        if (lower === normalized) {
          score += 100;
        }
        if (lower.includes(normalized)) {
          score += 40;
        }
        if (normalized.includes(lower)) {
          score += 20;
        }
        if (segment && lower.includes(segment)) {
          score += 10;
        }
        return { candidate: canonical, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 12);

    return Array.from(new Set(ranked.map((entry) => entry.candidate))).slice(0, 3);
  }

  private toolRequiresSession(name: PublicToolName): boolean {
    const inputSchema = PublicToolSchemas[name].inputSchema;
    const required = Array.isArray(inputSchema.required) ? inputSchema.required : [];
    if (required.includes("session")) {
      return true;
    }

    const anyOf = Array.isArray(inputSchema.anyOf) ? inputSchema.anyOf : [];
    return anyOf.some((entry) => Array.isArray(entry.required) && entry.required.includes("session"));
  }

  private inferSessionRef(payload: Record<string, unknown>): BrowserSessionRef | undefined {
    const topSessionId = typeof payload.sessionId === "string" ? payload.sessionId : undefined;
    const topTabId = typeof payload.tabId === "string"
      ? payload.tabId
      : typeof payload.tab === "string"
        ? payload.tab
        : undefined;

    if (topSessionId) {
      const attached = this.sessions.get(topSessionId);
      if (attached) {
        return {
          sessionId: attached.ref.sessionId,
          tabId: topTabId ?? attached.ref.tabId,
        };
      }
      if (topTabId) {
        return {
          sessionId: topSessionId,
          tabId: topTabId,
        };
      }
    }

    if (topTabId) {
      const candidates = Array.from(this.sessions.values())
        .filter((entry) => entry.ref.tabId === topTabId)
        .map((entry) => entry.ref);
      if (candidates.length === 1) {
        return {
          sessionId: candidates[0].sessionId,
          tabId: candidates[0].tabId,
        };
      }
    }

    if (this.sessions.size === 1) {
      const only = this.sessions.values().next().value as AttachedSession | undefined;
      if (only) {
        return {
          sessionId: only.ref.sessionId,
          tabId: only.ref.tabId,
        };
      }
    }

    return undefined;
  }

  private normalizeAgentToolOutput(output: unknown): unknown {
    return isMcpToolResultEnvelope(output)
      ? output.structuredContent
      : output;
  }

  private normalizeToolPayload(name: PublicToolName, input: Record<string, unknown>): Record<string, unknown> {
    const payload: Record<string, unknown> = { ...input };

    if (payload.tabId === undefined && typeof payload.tab === "string") {
      payload.tabId = payload.tab;
    }
    if (payload.windowId === undefined && typeof payload.window === "string") {
      payload.windowId = payload.window;
    }

    if (isRecord(payload.session)) {
      const session = { ...payload.session } as Record<string, unknown>;
      if (session.sessionId === undefined && typeof session.id === "string") {
        session.sessionId = session.id;
      }
      if (session.tabId === undefined && typeof session.tab === "string") {
        session.tabId = session.tab;
      }
      payload.session = session;
    }

    const hasExplicitSessionHint = isRecord(payload.session)
      || typeof payload.sessionId === "string"
      || typeof payload.tabId === "string"
      || typeof payload.tab === "string";
    const shouldInferSession = !(
      name === "browser_tab_create"
      && payload.windowId === undefined
      && !hasExplicitSessionHint
    );
    if (shouldInferSession && this.toolRequiresSession(name) && !isRecord(payload.session)) {
      const inferred = this.inferSessionRef(payload);
      if (inferred) {
        payload.session = inferred;
      }
    }

    return payload;
  }

  private normalizeToolError(name: string, error: unknown): AutomationToolError {
    if (error instanceof AutomationToolError) {
      return error;
    }

    const message = error instanceof Error ? error.message : String(error);

    const inputValidationMatch = message.match(/^Input validation failed for [^:]+: (.+)$/);
    if (inputValidationMatch) {
      const issue = inputValidationMatch[1];
      const parsed = parseSchemaIssue(issue);
      return new AutomationToolError({
        errorCode: "INPUT_VALIDATION_ERROR",
        category: "validation",
        message,
        retryable: true,
        ...(parsed.fieldPath ? { fieldPath: parsed.fieldPath } : {}),
        ...(parsed.expected ? { expected: parsed.expected } : {}),
        suggestion: "Correct the input fields based on fieldPath/expected and retry.",
        details: { tool: name, issue },
      });
    }

    const missingFieldMatch = message.match(/^Missing required (?:string|numeric|array) field: ([A-Za-z0-9_]+)$/);
    if (missingFieldMatch) {
      const field = missingFieldMatch[1];
      return new AutomationToolError({
        errorCode: "MISSING_REQUIRED_FIELD",
        category: "validation",
        message,
        retryable: true,
        fieldPath: `$.${field}`,
        expected: "required field",
        suggestion: `Provide field ${field} and retry.`,
        details: { tool: name },
      });
    }

    const expectedFieldMatch = message.match(/^Expected field ([A-Za-z0-9_]+) to be (.+)\.$/);
    if (expectedFieldMatch) {
      const field = expectedFieldMatch[1];
      const expected = expectedFieldMatch[2];
      return new AutomationToolError({
        errorCode: "INVALID_FIELD_TYPE",
        category: "validation",
        message,
        retryable: true,
        fieldPath: `$.${field}`,
        expected,
        suggestion: `Set field ${field} as ${expected} and retry.`,
        details: { tool: name },
      });
    }

    if (
      /Missing session object|Session .* is not attached|Session mismatch|Could not resolve tab|Tab .* is not available/i
        .test(message)
    ) {
      return new AutomationToolError({
        errorCode: "SESSION_ERROR",
        category: "session",
        message,
        retryable: true,
        suggestion: "Re-run browser.attach_session, then retry with the returned session.",
        details: { tool: name },
      });
    }

    if (/Lease mismatch|Page document changed/i.test(message)) {
      return new AutomationToolError({
        errorCode: "PAGE_REF_STALE",
        category: "session",
        message,
        retryable: true,
        suggestion: "Refresh the page reference with context.get or context.attach, then retry.",
        details: { tool: name },
      });
    }

    if (/Unknown handleId|Handle .* does not belong to the provided page session/i.test(message)) {
      return new AutomationToolError({
        errorCode: "HANDLE_ERROR",
        category: "validation",
        message,
        retryable: true,
        suggestion: "Re-run locate.find on the current page and retry with a fresh handle.",
        details: { tool: name },
      });
    }

    if (/observeOnly/i.test(message)) {
      return new AutomationToolError({
        errorCode: "SESSION_OBSERVE_ONLY",
        category: "session",
        message,
        retryable: true,
        suggestion: "Re-attach with observeOnly=false or call with dryRun=true.",
        details: { tool: name },
      });
    }

    const outputValidationMatch = message.match(/^Output validation failed for [^:]+: (.+)$/);
    if (outputValidationMatch) {
      const issue = outputValidationMatch[1];
      const parsed = parseSchemaIssue(issue);
      return new AutomationToolError({
        errorCode: "OUTPUT_VALIDATION_ERROR",
        category: "internal",
        message,
        retryable: false,
        ...(parsed.fieldPath ? { fieldPath: parsed.fieldPath } : {}),
        ...(parsed.expected ? { expected: parsed.expected } : {}),
        details: { tool: name, issue },
      });
    }

    return new AutomationToolError({
      errorCode: "TOOL_EXECUTION_ERROR",
      category: "execution",
      message,
      retryable: false,
      details: { tool: name },
    });
  }

  private validateToolInputPayload(
    name: string,
    payload: Record<string, unknown>,
    schema: ToolDefinition,
  ) {
    const errors: string[] = [];
    validateSchemaValue(payload, schema.inputSchema, schema.inputSchema, "$", errors);
    if (errors.length) {
      const issue = errors[0];
      const parsed = parseSchemaIssue(issue);
      throw new AutomationToolError({
        errorCode: "INPUT_VALIDATION_ERROR",
        category: "validation",
        message: `Input validation failed for ${name}: ${issue}`,
        retryable: true,
        ...(parsed.fieldPath ? { fieldPath: parsed.fieldPath } : {}),
        ...(parsed.expected ? { expected: parsed.expected } : {}),
        suggestion: "Correct the input payload and retry.",
        details: { tool: name, issue },
      });
    }
  }

  private validateToolOutputPayload(
    name: string,
    output: unknown,
    schema: ToolDefinition,
  ) {
    const errors: string[] = [];
    validateSchemaValue(output, schema.outputSchema, schema.outputSchema, "$", errors);
    if (errors.length) {
      const issue = errors[0];
      const parsed = parseSchemaIssue(issue);
      throw new AutomationToolError({
        errorCode: "OUTPUT_VALIDATION_ERROR",
        category: "internal",
        message: `Output validation failed for ${name}: ${issue}`,
        retryable: false,
        ...(parsed.fieldPath ? { fieldPath: parsed.fieldPath } : {}),
        ...(parsed.expected ? { expected: parsed.expected } : {}),
        details: { tool: name, issue },
      });
    }
  }

  private buildPublicSessionRef(session: AttachedSession): BrowserSessionRef {
    return {
      sessionId: session.ref.sessionId,
      tabId: session.ref.tabId,
      ...(session.ref.frameId ? { frameId: session.ref.frameId } : {}),
      ...(session.ref.userId ? { userId: session.ref.userId } : {}),
    };
  }

  private async publicSessionOpen(input: Record<string, unknown>) {
    const url = readString(input, "url", false);

    if (url) {
      return this.openUrl({
        url,
        ...(readString(input, "tabId", false) ? { tabId: readString(input, "tabId", false) } : {}),
        ...(readString(input, "windowId", false) ? { windowId: readString(input, "windowId", false) } : {}),
        ...(readString(input, "workspaceId", false) ? { workspaceId: readString(input, "workspaceId", false) } : {}),
        ...(readString(input, "userId", false) ? { userId: readString(input, "userId", false) } : {}),
        observeOnly: readBoolean(input, "observeOnly", false),
        waitUntil: readString(input, "waitUntil", false) ?? "load",
        ...(readNumber(input, "timeoutMs", false) !== undefined
          ? { timeoutMs: Math.floor(readNumber(input, "timeoutMs", false) as number) }
          : {}),
      });
    }

    const attached = await this.attachSession({
      tabId: readString(input, "tabId") as string,
      ...(readString(input, "userId", false) ? { userId: readString(input, "userId", false) } : {}),
      observeOnly: readBoolean(input, "observeOnly", false),
    });
    const tabContext = this.findTabContext(attached.session.tabId);

    return {
      session: attached.session,
      attachedAt: attached.attachedAt,
      windowId: String(tabContext.windowId),
      tabId: attached.session.tabId,
      url: attached.url,
      title: attached.title ?? tabContext.webContents.getTitle(),
      waitUntil: "none",
      matched: true,
      timedOut: false,
      createdTab: false,
    };
  }

  private async publicSessionClose(input: Record<string, unknown>) {
    return this.detachSession(input);
  }

  private async publicTabCreate(input: Record<string, unknown>, options?: ToolCallOptions) {
    let windowId = readWindowId(input, "windowId", false);
    if (windowId === undefined) {
      const session = this.resolveSessionRef(input);
      const tabContext = this.findTabContext(session.ref.tabId);
      windowId = tabContext.windowId;
    }

    return this.tabCreate(
      {
        windowId: String(windowId),
        ...(readString(input, "url", false) ? { url: readString(input, "url", false) } : {}),
        ...(readBoolean(input, "activate", false) !== undefined
          ? { activate: readBoolean(input, "activate", false) }
          : {}),
      },
      options,
    );
  }

  private readAccessibilityValueText(value: unknown): string | undefined {
    if (typeof value === "string") {
      return value.trim() || undefined;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }

    if (!isRecord(value)) {
      return undefined;
    }

    if (typeof value.value === "string" || typeof value.value === "number" || typeof value.value === "boolean") {
      const text = String(value.value).trim();
      return text || undefined;
    }

    return undefined;
  }

  private readAccessibilityValueBoolean(value: unknown): boolean | undefined {
    if (typeof value === "boolean") {
      return value;
    }

    if (!isRecord(value)) {
      return undefined;
    }

    if (typeof value.value === "boolean") {
      return value.value;
    }

    if (typeof value.value === "string") {
      if (value.value === "true") {
        return true;
      }
      if (value.value === "false") {
        return false;
      }
    }

    return undefined;
  }

  private readAccessibilityValueInteger(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.floor(value);
    }

    if (!isRecord(value)) {
      return undefined;
    }

    if (typeof value.value === "number" && Number.isFinite(value.value)) {
      return Math.floor(value.value);
    }

    if (typeof value.value === "string" && /^\d+$/.test(value.value)) {
      return Number.parseInt(value.value, 10);
    }

    return undefined;
  }

  private normalizeAccessibilityNode(rawNode: Record<string, unknown>): AccessibilityNodeRecord {
    const role = this.readAccessibilityValueText(rawNode.role);
    const name = this.readAccessibilityValueText(rawNode.name);
    const description = this.readAccessibilityValueText(rawNode.description);
    const value = this.readAccessibilityValueText(rawNode.value);
    const childIds = Array.isArray(rawNode.childIds)
      ? rawNode.childIds.filter((entry): entry is string => typeof entry === "string")
      : [];
    const nodeId = readString(rawNode, "nodeId", false) ?? randomUUID();
    let disabled: boolean | undefined;
    let focused: boolean | undefined;
    let expanded: boolean | undefined;
    let selected: boolean | undefined;
    let invalid: boolean | undefined;
    let required: boolean | undefined;
    let level: number | undefined;
    let url: string | undefined;

    const properties = Array.isArray(rawNode.properties) ? rawNode.properties : [];
    for (const property of properties) {
      if (!isRecord(property)) {
        continue;
      }
      const propertyName = readString(property, "name", false);
      const propertyValue = property.value;
      if (!propertyName) {
        continue;
      }

      if (propertyName === "disabled") {
        disabled = this.readAccessibilityValueBoolean(propertyValue);
        continue;
      }
      if (propertyName === "focused") {
        focused = this.readAccessibilityValueBoolean(propertyValue);
        continue;
      }
      if (propertyName === "expanded") {
        expanded = this.readAccessibilityValueBoolean(propertyValue);
        continue;
      }
      if (propertyName === "selected") {
        selected = this.readAccessibilityValueBoolean(propertyValue);
        continue;
      }
      if (propertyName === "invalid") {
        invalid = this.readAccessibilityValueBoolean(propertyValue);
        continue;
      }
      if (propertyName === "required") {
        required = this.readAccessibilityValueBoolean(propertyValue);
        continue;
      }
      if (propertyName === "level") {
        level = this.readAccessibilityValueInteger(propertyValue);
        continue;
      }
      if (propertyName === "url") {
        url = this.readAccessibilityValueText(propertyValue);
      }
    }

    return {
      nodeId,
      ...(readNumber(rawNode, "backendDOMNodeId", false) !== undefined
        ? { backendDOMNodeId: Math.floor(readNumber(rawNode, "backendDOMNodeId", false) as number) }
        : {}),
      ...(readString(rawNode, "parentId", false) ? { parentId: readString(rawNode, "parentId", false) } : {}),
      childIds,
      ignored: readBoolean(rawNode, "ignored", false),
      ...(role ? { role } : {}),
      ...(name ? { name } : {}),
      ...(description ? { description } : {}),
      ...(value ? { value } : {}),
      ...(disabled !== undefined ? { disabled } : {}),
      ...(focused !== undefined ? { focused } : {}),
      ...(expanded !== undefined ? { expanded } : {}),
      ...(selected !== undefined ? { selected } : {}),
      ...(invalid !== undefined ? { invalid } : {}),
      ...(required !== undefined ? { required } : {}),
      ...(level !== undefined ? { level } : {}),
      ...(url ? { url } : {}),
    };
  }

  private buildAccessibilityNodeOutput(node: AccessibilityNodeRecord): Record<string, unknown> {
    return {
      axNodeId: node.nodeId,
      ...(node.backendDOMNodeId !== undefined ? { backendNodeId: node.backendDOMNodeId } : {}),
      ...(node.parentId ? { parentAxNodeId: node.parentId } : {}),
      childAxNodeIds: node.childIds,
      ...(node.role ? { role: node.role } : {}),
      ...(node.name ? { name: node.name } : {}),
      ...(node.description ? { description: node.description } : {}),
      ...(node.value ? { value: node.value } : {}),
      ignored: node.ignored,
      ...(node.disabled !== undefined ? { disabled: node.disabled } : {}),
      ...(node.focused !== undefined ? { focused: node.focused } : {}),
      ...(node.expanded !== undefined ? { expanded: node.expanded } : {}),
      ...(node.selected !== undefined ? { selected: node.selected } : {}),
      ...(node.invalid !== undefined ? { invalid: node.invalid } : {}),
      ...(node.required !== undefined ? { required: node.required } : {}),
      ...(node.level !== undefined ? { level: node.level } : {}),
      ...(node.url ? { url: node.url } : {}),
    };
  }

  private buildMutationAxNodeSummary(node: AccessibilityNodeRecord): MutationAxNodeSummary {
    return {
      axNodeId: node.nodeId,
      ...(node.role ? { role: node.role } : {}),
      ...(node.name ? { name: truncate(node.name, 120) } : {}),
      ignored: node.ignored,
    };
  }

  private describeMutationAxNodeSummary(node: MutationAxNodeSummary): string {
    const role = node.role ?? "node";
    const name = truncate(node.name, 48);
    return name ? `${role} "${name}"` : role;
  }

  private buildMutationAxSnapshot(
    node: AccessibilityNodeRecord,
    nodeById: Map<string, AccessibilityNodeRecord>,
  ): MutationAxSnapshot {
    const path: MutationAxNodeSummary[] = [];
    const lineage: AccessibilityNodeRecord[] = [];
    let current: AccessibilityNodeRecord | undefined = node;
    let depth = 0;
    while (current && depth < 6) {
      lineage.unshift(current);
      current = current.parentId ? nodeById.get(current.parentId) : undefined;
      depth += 1;
    }
    for (const entry of lineage) {
      path.push(this.buildMutationAxNodeSummary(entry));
    }

    const diffChildren = node.childIds
      .map((childId) => nodeById.get(childId))
      .filter((child): child is AccessibilityNodeRecord => Boolean(child))
      .slice(0, 20)
      .map((child) => this.buildMutationAxNodeSummary(child));

    return {
      node: {
        ...this.buildMutationAxNodeSummary(node),
        ...(node.description ? { description: truncate(node.description, 160) } : {}),
        ...(node.value ? { value: truncate(node.value, 160) } : {}),
      },
      path,
      children: diffChildren.slice(0, 6),
      diffChildren,
      childCount: node.childIds.length,
    };
  }

  private buildMutationAxDiff(
    previous: MutationAxSnapshot | undefined,
    current: MutationAxSnapshot,
  ): {
    summary?: string;
    changedFields: string[];
    addedChildren: MutationAxNodeSummary[];
    removedChildren: MutationAxNodeSummary[];
  } {
    if (!previous) {
      return {
        changedFields: [],
        addedChildren: [],
        removedChildren: [],
      };
    }

    const changedFields: string[] = [];
    for (const field of ["role", "name", "description", "value", "ignored"] as const) {
      if (previous.node[field] !== current.node[field]) {
        changedFields.push(field);
      }
    }

    const previousChildrenById = new Map(previous.diffChildren.map((child) => [child.axNodeId, child]));
    const currentChildrenById = new Map(current.diffChildren.map((child) => [child.axNodeId, child]));
    const addedChildren = current.diffChildren
      .filter((child) => !previousChildrenById.has(child.axNodeId))
      .slice(0, 6);
    const removedChildren = previous.diffChildren
      .filter((child) => !currentChildrenById.has(child.axNodeId))
      .slice(0, 6);

    const summaryParts: string[] = [];
    if (changedFields.length > 0) {
      summaryParts.push(`fields: ${changedFields.join(", ")}`);
    }
    if (addedChildren.length > 0) {
      summaryParts.push(`children+: ${addedChildren.map((child) => this.describeMutationAxNodeSummary(child)).join(", ")}`);
    }
    if (removedChildren.length > 0) {
      summaryParts.push(`children-: ${removedChildren.map((child) => this.describeMutationAxNodeSummary(child)).join(", ")}`);
    }
    if (previous.childCount !== current.childCount) {
      summaryParts.push(`childCount: ${previous.childCount} -> ${current.childCount}`);
    }

    return {
      ...(summaryParts.length > 0 ? { summary: truncate(summaryParts.join("; "), 220) } : {}),
      changedFields,
      addedChildren,
      removedChildren,
    };
  }

  private async fetchAccessibilityNodes(session: AttachedSession): Promise<AccessibilityNodeRecord[]> {
    return this.fetchAccessibilityNodesForContents(session.contentsId);
  }

  private async fetchAccessibilityNodesForContents(contentsId: number): Promise<AccessibilityNodeRecord[]> {
    await this.context.sendContentsCdpCommand(contentsId, "Accessibility.enable");
    const response = await this.context.sendContentsCdpCommand<{
      nodes?: Array<Record<string, unknown>>;
    }>(contentsId, "Accessibility.getFullAXTree");

    return Array.isArray(response.nodes)
      ? response.nodes
        .filter((entry): entry is Record<string, unknown> => isRecord(entry))
        .map((entry) => this.normalizeAccessibilityNode(entry))
      : [];
  }

  private filterAccessibilityNodes(
    nodes: AccessibilityNodeRecord[],
    options: {
      rootAxNodeId?: string;
      maxDepth?: number;
      includeIgnored?: boolean;
      outlineOnly?: boolean;
    },
  ): AccessibilityNodeRecord[] {
    const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));
    const roots = options.rootAxNodeId
      ? [options.rootAxNodeId]
      : nodes
        .filter((node) => !node.parentId || !nodeById.has(node.parentId))
        .map((node) => node.nodeId);

    const visited = new Set<string>();
    const depthById = new Map<string, number>();
    const queue = roots.map((nodeId) => ({ nodeId, depth: 0 }));
    while (queue.length) {
      const current = queue.shift();
      if (!current || visited.has(current.nodeId)) {
        continue;
      }
      visited.add(current.nodeId);
      depthById.set(current.nodeId, current.depth);

      if (typeof options.maxDepth === "number" && current.depth >= options.maxDepth) {
        continue;
      }

      const node = nodeById.get(current.nodeId);
      for (const childId of node?.childIds ?? []) {
        queue.push({ nodeId: childId, depth: current.depth + 1 });
      }
    }

    const outlineRoles = new Set([
      "banner",
      "navigation",
      "main",
      "contentinfo",
      "complementary",
      "dialog",
      "heading",
      "form",
      "table",
      "list",
      "button",
      "link",
      "textbox",
      "searchbox",
      "combobox",
    ]);

    return nodes.filter((node) => {
      if (!visited.has(node.nodeId)) {
        return false;
      }
      if (!options.includeIgnored && node.ignored) {
        return false;
      }
      if (options.outlineOnly && !outlineRoles.has((node.role ?? "").toLowerCase())) {
        return false;
      }
      return true;
    });
  }

  private async publicAxSnapshot(input: Record<string, unknown>) {
    const session = this.resolveSessionRef(input);
    const tabContext = this.findTabContext(session.ref.tabId);
    const nodes = await this.fetchAccessibilityNodes(session);
    const scope = (readString(input, "scope", false) ?? "outline") as "full" | "outline";
    const filtered = this.filterAccessibilityNodes(nodes, {
      ...(readString(input, "rootAxNodeId", false) ? { rootAxNodeId: readString(input, "rootAxNodeId", false) } : {}),
      ...(readNumber(input, "maxDepth", false) !== undefined
        ? { maxDepth: Math.max(0, Math.floor(readNumber(input, "maxDepth", false) as number)) }
        : {}),
      includeIgnored: readBoolean(input, "includeIgnored", false),
      outlineOnly: scope === "outline",
    });
    const limit = Math.max(1, Math.floor(readNumber(input, "limit", false) ?? 250));

    return {
      session: this.buildPublicSessionRef(session),
      url: tabContext.webContents.getURL(),
      title: tabContext.webContents.getTitle(),
      scope,
      nodes: filtered.slice(0, limit).map((node) => this.buildAccessibilityNodeOutput(node)),
    };
  }

  private async publicAxQuery(input: Record<string, unknown>) {
    const session = this.resolveSessionRef(input);
    const tabContext = this.findTabContext(session.ref.tabId);
    const roleFilter = normalizeComparableText(readString(input, "role", false));
    const nameFilter = normalizeComparableText(readString(input, "name", false));
    const textFilter = normalizeComparableText(readString(input, "text", false));
    const nodes = this.filterAccessibilityNodes(await this.fetchAccessibilityNodes(session), {
      ...(readString(input, "rootAxNodeId", false) ? { rootAxNodeId: readString(input, "rootAxNodeId", false) } : {}),
      includeIgnored: readBoolean(input, "includeIgnored", false),
      outlineOnly: false,
    });
    const limit = Math.max(1, Math.floor(readNumber(input, "limit", false) ?? 20));
    const matches = nodes.filter((node) => {
      if (roleFilter && !normalizeComparableText(node.role).includes(roleFilter)) {
        return false;
      }
      if (nameFilter && !normalizeComparableText(node.name).includes(nameFilter)) {
        return false;
      }
      if (textFilter) {
        const haystack = normalizeComparableText([node.name, node.description, node.value, node.url].filter(Boolean).join(" "));
        if (!haystack.includes(textFilter)) {
          return false;
        }
      }
      return true;
    });

    return {
      session: this.buildPublicSessionRef(session),
      url: tabContext.webContents.getURL(),
      title: tabContext.webContents.getTitle(),
      matches: matches.slice(0, limit).map((node) => this.buildAccessibilityNodeOutput(node)),
    };
  }

  private async resolveBackendNodeIdForSelector(session: AttachedSession, selector: string): Promise<number | undefined> {
    return this.resolveBackendNodeIdForSelectorInContents(session.contentsId, selector);
  }

  private async resolveBackendNodeIdForSelectorInContents(
    contentsId: number,
    selector: string,
  ): Promise<number | undefined> {
    await this.context.sendContentsCdpCommand(contentsId, "DOM.enable");
    const documentRoot = await this.context.sendContentsCdpCommand<{
      root?: Record<string, unknown>;
    }>(contentsId, "DOM.getDocument", {
      depth: -1,
      pierce: true,
    });
    const root = assertObject(documentRoot.root, "DOM.getDocument returned no root node.");
    const rootNodeId = readNumber(root, "nodeId", false);
    if (rootNodeId === undefined) {
      return undefined;
    }

    const queried = await this.context.sendContentsCdpCommand<{
      nodeId?: number;
    }>(contentsId, "DOM.querySelector", {
      nodeId: Math.floor(rootNodeId),
      selector,
    });
    if (!Number.isFinite(queried.nodeId) || !queried.nodeId) {
      return undefined;
    }

    const described = await this.context.sendContentsCdpCommand<{
      node?: Record<string, unknown>;
    }>(contentsId, "DOM.describeNode", {
      nodeId: Math.floor(queried.nodeId),
    });
    const node = assertObject(described.node, "DOM.describeNode returned no node.");
    const backendNodeId = readNumber(node, "backendNodeId", false);
    return backendNodeId !== undefined ? Math.floor(backendNodeId) : undefined;
  }

  private async resolveBackendNodeIdForAxNode(session: AttachedSession, axNodeId: string): Promise<number | undefined> {
    const nodes = await this.fetchAccessibilityNodes(session);
    return nodes.find((node) => node.nodeId === axNodeId)?.backendDOMNodeId;
  }

  private async resolvePublicTarget(
    session: AttachedSession,
    rawTarget: Record<string, unknown> | undefined,
    required = true,
  ): Promise<PublicTargetInput | undefined> {
    if (!rawTarget) {
      if (required) {
        throw new Error("Missing required object field: target");
      }
      return undefined;
    }

    const axNodeId = readString(rawTarget, "axNodeId", false);
    const selector = readString(rawTarget, "selector", false);
    const explicitBackendNodeId = readNumber(rawTarget, "backendNodeId", false);
    let backendNodeId = explicitBackendNodeId !== undefined
      ? Math.floor(explicitBackendNodeId)
      : undefined;

    if (backendNodeId === undefined && axNodeId) {
      backendNodeId = await this.resolveBackendNodeIdForAxNode(session, axNodeId);
    }

    if (backendNodeId === undefined && selector) {
      backendNodeId = await this.resolveBackendNodeIdForSelector(session, selector);
    }

    if (!axNodeId && !selector && backendNodeId === undefined) {
      throw new Error("target requires at least one of axNodeId, backendNodeId, or selector.");
    }

    if (required && backendNodeId === undefined) {
      throw new Error("Could not resolve target to a DOM node.");
    }

    return {
      ...(axNodeId ? { axNodeId } : {}),
      ...(selector ? { selector } : {}),
      ...(backendNodeId !== undefined ? { backendNodeId } : {}),
    };
  }

  private async callFunctionOnBackendNode<TResult>(
    session: AttachedSession,
    backendNodeId: number,
    functionDeclaration: string,
    values: unknown[] = [],
  ): Promise<TResult> {
    return this.callFunctionOnBackendNodeInContents(
      session.contentsId,
      backendNodeId,
      functionDeclaration,
      values,
    );
  }

  private async callFunctionOnBackendNodeInContents<TResult>(
    contentsId: number,
    backendNodeId: number,
    functionDeclaration: string,
    values: unknown[] = [],
  ): Promise<TResult> {
    await this.context.sendContentsCdpCommand(contentsId, "DOM.enable");
    await this.context.sendContentsCdpCommand(contentsId, "Runtime.enable");
    const resolved = await this.context.sendContentsCdpCommand<{
      object?: Record<string, unknown>;
    }>(contentsId, "DOM.resolveNode", {
      backendNodeId,
    });
    const object = assertObject(resolved.object, "Could not resolve DOM node.");
    const objectId = readString(object, "objectId", false);
    if (!objectId) {
      throw new Error("Resolved DOM node did not expose an objectId.");
    }

    try {
      const response = await this.context.sendContentsCdpCommand<{
        result?: {
          value?: TResult;
        };
        exceptionDetails?: {
          text?: string;
        };
      }>(contentsId, "Runtime.callFunctionOn", {
        objectId,
        functionDeclaration,
        arguments: values.map((value) => ({ value })),
        awaitPromise: true,
        returnByValue: true,
      });

      if (response.exceptionDetails) {
        throw new Error(response.exceptionDetails.text ?? "Runtime.callFunctionOn failed.");
      }

      return (response.result?.value as TResult) ?? (undefined as TResult);
    } finally {
      await this.context.sendContentsCdpCommand(contentsId, "Runtime.releaseObject", {
        objectId,
      }).catch(() => undefined);
    }
  }

  private async collectMutationTargetCandidatesForBackendNode(
    contentsId: number,
    backendNodeId: number,
    maxDepth = 6,
  ): Promise<Array<Record<string, unknown>>> {
    const result = await this.callFunctionOnBackendNodeInContents<Array<Record<string, unknown>>>(
      contentsId,
      backendNodeId,
      `function(maxDepth) {
        const clip = (value, limit = 160) => {
          if (typeof value !== 'string') return undefined;
          const normalized = value.replace(/\\s+/g, ' ').trim();
          if (!normalized) return undefined;
          return normalized.length > limit ? normalized.slice(0, limit - 1) + '…' : normalized;
        };
        const sanitize = (value) => typeof value === 'string' ? value.replace(/\\s+/g, ' ').trim() : '';
        const esc = (value) => {
          if (window.CSS && typeof window.CSS.escape === 'function') {
            return window.CSS.escape(value);
          }
          return String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
        };
        const quoteAttr = (value, limit = 80) => JSON.stringify(String(value).slice(0, limit));
        const textFromRefs = (value) => clip(
          sanitize(String(value || '')
            .split(/\\s+/)
            .map((id) => {
              const target = document.getElementById(id);
              return target ? sanitize(target.innerText || target.textContent || '') : '';
            })
            .join(' ')),
          120,
        );
        const elementForNode = (node) => {
          if (!node) return undefined;
          if (node.nodeType === Node.ELEMENT_NODE) return node;
          return node.parentElement || undefined;
        };
        const selectorFor = (target) => {
          if (!target || target.nodeType !== Node.ELEMENT_NODE) return undefined;
          const el = target;
          if (el.id) return '#' + esc(el.id);
          const segments = [];
          let current = el;
          let depth = 0;
          while (current && depth < 5 && current.nodeType === Node.ELEMENT_NODE) {
            const currentTag = current.tagName ? current.tagName.toLowerCase() : 'unknown';
            const testId = current.getAttribute('data-testid') || current.getAttribute('data-test') || current.getAttribute('data-qa');
            const name = current.getAttribute && current.getAttribute('name');
            let segment;
            if (testId) {
              segment = currentTag + '[data-testid=' + quoteAttr(testId) + ']';
            } else if (name) {
              segment = currentTag + '[name=' + quoteAttr(name) + ']';
            } else {
              let index = 1;
              let sibling = current.previousElementSibling;
              while (sibling) {
                if (sibling.tagName === current.tagName) index += 1;
                sibling = sibling.previousElementSibling;
              }
              segment = currentTag + ':nth-of-type(' + index + ')';
            }
            segments.unshift(segment);
            if (current.id || testId) break;
            current = current.parentElement;
            depth += 1;
          }
          return segments.join(' > ') || undefined;
        };
        const textFor = (target) => {
          const el = elementForNode(target);
          if (!el) return undefined;
          return clip(sanitize(el.innerText || el.textContent || ''), 80);
        };
        const nameFor = (target) => {
          const el = elementForNode(target);
          if (!el) return undefined;
          return clip(
            sanitize(
              el.getAttribute('aria-label')
              || textFromRefs(el.getAttribute('aria-labelledby'))
              || el.getAttribute('title')
              || el.getAttribute('placeholder')
              || el.getAttribute('alt')
              || el.getAttribute('name')
              || '',
            ),
            120,
          );
        };
        const labelFor = (target) => {
          const el = elementForNode(target);
          if (!el) return undefined;
          if (el.labels && el.labels.length) {
            const labels = clip(
              Array.from(el.labels)
                .map((label) => sanitize(label.innerText || label.textContent || ''))
                .filter(Boolean)
                .join(' '),
              120,
            );
            if (labels) return labels;
          }
          const explicitName = nameFor(el);
          if (explicitName) return explicitName;
          const wrapped = el.closest ? el.closest('label') : null;
          if (wrapped) {
            const wrappedText = clip(sanitize(wrapped.innerText || wrapped.textContent || ''), 120);
            if (wrappedText) return wrappedText;
          }
          return undefined;
        };
        const roleFor = (target) => {
          const el = elementForNode(target);
          if (!el) return undefined;
          const explicitRole = sanitize(el.getAttribute('role')).toLowerCase();
          const tag = el.tagName ? el.tagName.toLowerCase() : '';
          const type = sanitize(el.getAttribute('type')).toLowerCase();
          const searchHintSource = sanitize([
            el.getAttribute('aria-label'),
            el.getAttribute('placeholder'),
            el.getAttribute('name'),
            el.getAttribute('id'),
            el.getAttribute('title'),
            el.closest && el.closest('form[role="search"],[role="search"]') ? 'search' : '',
          ].filter(Boolean).join(' '));
          const looksLikeSearchInput = tag === 'input'
            && (!type || type === 'text' || type === 'search')
            && /(^|\\b)(search|query|keyword|keywords)(\\b|$)|搜索|查找|查询|检索|关键词/i.test(searchHintSource);
          if (explicitRole === 'button' || tag === 'button') return 'button';
          if (explicitRole === 'link' || tag === 'a') return 'link';
          if (explicitRole === 'searchbox' || (tag === 'input' && type === 'search') || looksLikeSearchInput) return 'searchbox';
          if (explicitRole === 'textbox' || tag === 'textarea' || (tag === 'input' && ['text', 'email', 'url', 'password', 'tel', 'number'].includes(type))) return 'textbox';
          if (explicitRole === 'checkbox' || (tag === 'input' && type === 'checkbox')) return 'checkbox';
          if (explicitRole === 'radio' || (tag === 'input' && type === 'radio')) return 'radio';
          if (explicitRole === 'combobox' || tag === 'select') return 'combobox';
          if (explicitRole === 'slider' || (tag === 'input' && type === 'range')) return 'slider';
          if (explicitRole === 'tab') return 'tab';
          if (explicitRole === 'menuitem') return 'menuitem';
          if (explicitRole === 'row' || tag === 'tr') return 'row';
          if (explicitRole === 'cell' || tag === 'td' || tag === 'th') return 'cell';
          if (/^h[1-6]$/.test(tag)) return 'heading';
          if (tag === 'img') return 'image';
          if (tag === 'label' || tag === 'li' || tag === 'p' || tag === 'span') return 'text';
          return explicitRole || 'unknown';
        };
        const semanticTargetFor = (target) => {
          const el = elementForNode(target);
          if (!el) return {};
          const targetRole = roleFor(el);
          const targetName = nameFor(el);
          const targetLabel = labelFor(el);
          const targetText = textFor(el);
          const editableTarget = isEditableTarget(el);
          const semanticParts = [
            targetRole && targetRole !== 'unknown' ? 'role=' + targetRole : undefined,
            targetName ? 'name="' + targetName.replace(/"/g, '\\\\"') + '"' : undefined,
            !targetName && targetLabel ? 'label="' + targetLabel.replace(/"/g, '\\\\"') + '"' : undefined,
            !targetName && !targetLabel && targetText ? 'text="' + targetText.replace(/"/g, '\\\\"') + '"' : undefined,
          ].filter(Boolean);
          const targetHint = semanticParts.join(' ') || selectorFor(el);
          return {
            ...(targetHint ? { targetHint } : {}),
            ...(targetRole ? { targetRole } : {}),
            ...(targetName ? { targetName } : {}),
            ...(targetLabel && targetLabel !== targetName ? { targetLabel } : {}),
            ...(targetText ? { targetText } : {}),
            ...(editableTarget ? { editableTarget: true } : {}),
          };
        };

        const candidates = [];
        let current = elementForNode(this);
        let depth = 0;
        const limit = Math.max(0, Math.floor(Number(maxDepth) || 0));
        while (current && depth <= limit) {
          candidates.push({
            depth,
            ...(selectorFor(current) ? { selector: selectorFor(current) } : {}),
            ...semanticTargetFor(current),
          });
          current = current.parentElement || undefined;
          depth += 1;
        }
        return candidates;
      }`,
      [maxDepth],
    );
    return Array.isArray(result)
      ? result.filter((entry): entry is Record<string, unknown> => isRecord(entry))
      : [];
  }

  private async resolveBackendNodeIdForTargetDescriptor(
    session: AttachedSession,
    targetDescriptor: Record<string, unknown> | undefined,
  ): Promise<number | undefined> {
    if (!targetDescriptor) {
      return undefined;
    }

    const selector = readString(targetDescriptor, "selector", false);
    const selectorHints = readArray(targetDescriptor, "selectorHints", false)
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);

    for (const candidate of uniqueStrings([selector, ...selectorHints])) {
      const backendNodeId = await this.resolveBackendNodeIdForSelector(session, candidate);
      if (backendNodeId !== undefined) {
        return backendNodeId;
      }
    }

    return undefined;
  }

  private async dispatchKeyboardTextOnBackendNode(
    session: AttachedSession,
    backendNodeId: number,
    text: string,
  ) {
    return this.callFunctionOnBackendNode<{
      ok?: boolean;
    }>(
      session,
      backendNodeId,
      `async function(nextText) {
        const el = this;
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const setNativeValue = (node, nextValue) => {
          if (node instanceof HTMLInputElement) {
            const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            if (descriptor && typeof descriptor.set === 'function') {
              descriptor.set.call(node, nextValue);
              return;
            }
          }
          if (node instanceof HTMLTextAreaElement) {
            const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
            if (descriptor && typeof descriptor.set === 'function') {
              descriptor.set.call(node, nextValue);
              return;
            }
          }
          if ('value' in node) {
            node.value = nextValue;
          }
        };
        const setEditableValue = (node, insertedText) => {
          if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
            const currentValue = typeof node.value === 'string' ? node.value : '';
            const selectionStart = typeof node.selectionStart === 'number' ? node.selectionStart : currentValue.length;
            const selectionEnd = typeof node.selectionEnd === 'number' ? node.selectionEnd : selectionStart;
            const nextValue = currentValue.slice(0, selectionStart) + insertedText + currentValue.slice(selectionEnd);
            setNativeValue(node, nextValue);
            const nextCursor = selectionStart + insertedText.length;
            if (typeof node.setSelectionRange === 'function') {
              try {
                node.setSelectionRange(nextCursor, nextCursor);
              } catch {
                // Ignore selection failures on unsupported inputs.
              }
            }
            return true;
          }
          if (node.isContentEditable) {
            const currentText = node.textContent || '';
            const selection = window.getSelection();
            const hasSelection = Boolean(selection && selection.rangeCount > 0 && node.contains(selection.anchorNode));
            if (hasSelection && selection) {
              const range = selection.getRangeAt(0);
              range.deleteContents();
              range.insertNode(document.createTextNode(insertedText));
              range.collapse(false);
              selection.removeAllRanges();
              selection.addRange(range);
            } else {
              node.textContent = currentText + insertedText;
            }
            return true;
          }
          return false;
        };
        const dispatchInputEvent = (node, type, options) => {
          const eventInit = {
            bubbles: true,
            cancelable: type === 'beforeinput',
            composed: true,
            ...options,
          };
          if (typeof InputEvent === 'function') {
            return node.dispatchEvent(new InputEvent(type, eventInit));
          }
          return node.dispatchEvent(new Event(type, eventInit));
        };
        if (!(el instanceof HTMLElement)) {
          return { ok: false };
        }
        if (typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        }
        if (typeof el.focus === 'function') {
          el.focus();
        }
        if (el instanceof HTMLSelectElement) {
          return { ok: false };
        }
        if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable)) {
          return { ok: false };
        }
        for (const char of Array.from(String(nextText))) {
          const insertedText = char === '\\r' ? '' : char;
          const key = char === '\\n' ? 'Enter' : insertedText;
          const keyInit = {
            key,
            code: char === '\\n' ? 'Enter' : undefined,
            bubbles: true,
            cancelable: true,
            composed: true,
          };
          const keyDownAccepted = el.dispatchEvent(new KeyboardEvent('keydown', keyInit));
          let applied = false;
          if (keyDownAccepted && (insertedText.length > 0 || char === '\\n')) {
            const inputType = char === '\\n' ? 'insertLineBreak' : 'insertText';
            const keyPressAccepted = el.dispatchEvent(new KeyboardEvent('keypress', keyInit));
            const beforeInputAccepted = keyPressAccepted
              ? dispatchInputEvent(el, 'beforeinput', {
                  data: char === '\\n' ? '\\n' : insertedText,
                  inputType,
                })
              : false;
            if (beforeInputAccepted) {
              applied = setEditableValue(el, char === '\\n' ? '\\n' : insertedText);
              if (applied) {
                dispatchInputEvent(el, 'input', {
                  data: char === '\\n' ? '\\n' : insertedText,
                  inputType,
                });
              }
            }
          }
          el.dispatchEvent(new KeyboardEvent('keyup', keyInit));
          if (!applied && insertedText.length > 0 && char !== '\\n') {
            await wait(8);
            continue;
          }
          await wait(16);
        }
        return { ok: true };
      }`,
      [text],
    );
  }

  private async finalizeTextInputOnBackendNode(
    session: AttachedSession,
    backendNodeId: number,
    expectedValue: string,
    dispatchChange: boolean,
  ) {
    return this.callFunctionOnBackendNode<{
      ok?: boolean;
      value?: string;
      committed?: boolean;
      requiresSelection?: boolean;
      availableOptions?: string[];
    }>(
      session,
      backendNodeId,
      `async function(expectedValue, dispatchChangeEvent) {
        const el = this;
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const sanitize = (incoming) => typeof incoming === 'string' ? incoming.replace(/\\s+/g, ' ').trim() : '';
        const clip = (incoming, limit = 120) => {
          const normalized = sanitize(incoming);
          return normalized.length > limit ? normalized.slice(0, limit - 1) + '…' : normalized;
        };
        const normalize = (incoming) => sanitize(incoming).toLowerCase();
        const isVisible = (node) => {
          if (!(node instanceof Element)) return false;
          const style = window.getComputedStyle(node);
          if (!style || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) {
            return false;
          }
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const rectDistance = (leftRect, rightRect) => {
          const leftCenterX = leftRect.left + leftRect.width / 2;
          const leftCenterY = leftRect.top + leftRect.height / 2;
          const rightCenterX = rightRect.left + rightRect.width / 2;
          const rightCenterY = rightRect.top + rightRect.height / 2;
          return Math.hypot(leftCenterX - rightCenterX, leftCenterY - rightCenterY);
        };
        const collectAssociatedOptionRoots = (node) => {
          if (!(node instanceof Element)) return [];
          const roots = [];
          const seen = new Set();
          const pushRoot = (candidate) => {
            if (!(candidate instanceof Element) || !isVisible(candidate) || seen.has(candidate)) {
              return;
            }
            seen.add(candidate);
            roots.push(candidate);
          };
          if (node instanceof HTMLInputElement && node.list instanceof HTMLDataListElement) {
            pushRoot(node.list);
          }
          const relatedCombobox = typeof node.closest === 'function' ? node.closest('[role="combobox"]') : null;
          const activeDescendantId = node.getAttribute('aria-activedescendant');
          if (activeDescendantId) {
            const activeDescendant = document.getElementById(activeDescendantId);
            if (activeDescendant) {
              pushRoot(activeDescendant.closest('[role="listbox"],datalist,[role="menu"]'));
              pushRoot(activeDescendant.parentElement);
            }
          }
          const ids = [
            node.getAttribute('aria-controls'),
            node.getAttribute('aria-owns'),
            relatedCombobox ? relatedCombobox.getAttribute('aria-controls') : null,
            relatedCombobox ? relatedCombobox.getAttribute('aria-owns') : null,
          ]
            .filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
            .flatMap((entry) => String(entry).split(/\\s+/g));
          ids.forEach((id) => {
            const candidate = document.getElementById(id);
            if (!candidate) {
              return;
            }
            pushRoot(candidate);
            pushRoot(candidate.closest('[role="listbox"],datalist,[role="menu"]'));
          });
          if (roots.length > 0) {
            return roots;
          }
          const shouldFallbackScan =
            normalize(node.getAttribute('role')) === 'combobox'
            || Boolean(node.getAttribute('aria-autocomplete'))
            || node.getAttribute('aria-haspopup') === 'listbox'
            || node.getAttribute('aria-expanded') === 'true'
            || Boolean(activeDescendantId)
            || Boolean(relatedCombobox);
          if (!shouldFallbackScan) {
            return roots;
          }
          const anchorRect = node.getBoundingClientRect();
          Array.from(document.querySelectorAll('[role="listbox"],datalist,[role="menu"]'))
            .filter((candidate) => candidate instanceof Element && isVisible(candidate))
            .map((candidate) => {
              const rect = candidate.getBoundingClientRect();
              const horizontalOverlap = Math.max(0, Math.min(anchorRect.right, rect.right) - Math.max(anchorRect.left, rect.left));
              const verticalGap = rect.top >= anchorRect.bottom
                ? rect.top - anchorRect.bottom
                : anchorRect.top >= rect.bottom
                  ? anchorRect.top - rect.bottom
                  : 0;
              let score = 0;
              if (relatedCombobox && (relatedCombobox.contains(candidate) || candidate.contains(relatedCombobox))) {
                score += 6;
              }
              if (horizontalOverlap > 0) {
                score += 3;
              }
              if (Math.abs(rect.left - anchorRect.left) <= 180) {
                score += 2;
              }
              if (verticalGap <= 260) {
                score += 2;
              }
              if (candidate.getAttribute('aria-labelledby')
                && node.id
                && candidate.getAttribute('aria-labelledby').split(/\\s+/g).includes(node.id)
              ) {
                score += 2;
              }
              return {
                candidate,
                score,
                distance: rectDistance(anchorRect, rect),
              };
            })
            .filter(({ score, distance }) => score > 0 || distance <= 220)
            .sort((left, right) => right.score - left.score || left.distance - right.distance)
            .slice(0, 2)
            .forEach(({ candidate }) => pushRoot(candidate));
          return roots;
        };
        const collectOptionLabelsFromRoot = (root) => {
          const explicitOptions = Array.from(root.querySelectorAll('option,[role="option"]'));
          const fallbackOptions = explicitOptions.length > 0
            ? explicitOptions
            : Array.from(root.querySelectorAll('li,button,div'))
              .filter((candidate) => candidate instanceof Element && candidate !== root && isVisible(candidate))
              .filter((candidate) => {
                if (candidate.querySelector('option,[role="option"]')) {
                  return false;
                }
                if (candidate.tagName.toLowerCase() === 'div' && candidate.children.length > 0 && !candidate.getAttribute('data-value')) {
                  return candidate.getAttribute('aria-selected') === 'true';
                }
                return true;
              });
          return fallbackOptions
            .map((option) => clip(
              option.getAttribute('label')
              || option.textContent
              || option.getAttribute('value')
              || '',
              120,
            ))
            .filter(Boolean);
        };
        const collectAssociatedOptionLabels = (node) => Array.from(new Set(
          collectAssociatedOptionRoots(node)
            .flatMap((root) => collectOptionLabelsFromRoot(root)),
        )).slice(0, 10);
        const readSelectionState = (node) => {
          const currentValue =
            'value' in node && typeof node.value === 'string'
              ? node.value
              : (node.textContent || '');
          const availableOptions = collectAssociatedOptionLabels(node);
          const requiresSelection =
            normalize(node.getAttribute('role')) === 'combobox'
            || Boolean(node.getAttribute('aria-autocomplete'))
            || node.getAttribute('aria-haspopup') === 'listbox'
            || node.getAttribute('aria-expanded') === 'true'
            || Boolean(node.getAttribute('aria-activedescendant'))
            || availableOptions.length > 0;
          return {
            currentValue,
            availableOptions,
            requiresSelection,
          };
        };
        if (!(el instanceof HTMLElement)) {
          return { ok: false, committed: false, requiresSelection: false, availableOptions: [] };
        }
        if (el instanceof HTMLSelectElement) {
          const availableOptions = Array.from(el.options)
            .map((option) => clip(option.label || option.text || option.value || '', 120))
            .filter(Boolean)
            .slice(0, 10);
          return {
            ok: false,
            value: el.value,
            committed: false,
            requiresSelection: true,
            availableOptions,
          };
        }
        await wait(120);
        let { currentValue, availableOptions, requiresSelection } = readSelectionState(el);
        if (
          dispatchChangeEvent
          && !requiresSelection
          && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
        ) {
          el.dispatchEvent(new Event("change", { bubbles: true }));
          await wait(40);
          ({ currentValue, availableOptions, requiresSelection } = readSelectionState(el));
        }
        const pollStartedAt = Date.now();
        let lastSignature = JSON.stringify({
          value: normalize(currentValue),
          availableOptions,
          requiresSelection,
        });
        let stableReads = 0;
        while (Date.now() - pollStartedAt < (requiresSelection ? 900 : 720)) {
          if (requiresSelection && availableOptions.length > 0) {
            break;
          }
          if (!requiresSelection && normalize(currentValue) === normalize(expectedValue) && stableReads >= 1) {
            break;
          }
          await wait(120);
          ({ currentValue, availableOptions, requiresSelection } = readSelectionState(el));
          const signature = JSON.stringify({
            value: normalize(currentValue),
            availableOptions,
            requiresSelection,
          });
          stableReads = signature === lastSignature ? stableReads + 1 : 0;
          lastSignature = signature;
        }
        return {
          ok: el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable,
          value: currentValue,
          committed: normalize(currentValue) === normalize(expectedValue) && !requiresSelection,
          requiresSelection,
          availableOptions,
        };
      }`,
      [expectedValue, dispatchChange],
    );
  }

  private async performTextInputOnBackendNode(
    session: AttachedSession,
    backendNodeId: number,
    text: string,
    replaceExisting: boolean,
  ) {
    await this.context.sendContentsCdpCommand(session.contentsId, "DOM.enable");
    await this.context.sendContentsCdpCommand(session.contentsId, "Runtime.enable");
    await this.context.sendContentsCdpCommand(session.contentsId, "DOM.scrollIntoViewIfNeeded", {
      backendNodeId,
    }).catch(() => undefined);
    await this.context.sendContentsCdpCommand(session.contentsId, "DOM.focus", {
      backendNodeId,
    }).catch(() => undefined);

    const prepared = await this.callFunctionOnBackendNode<{
      ok?: boolean;
      skipInsert?: boolean;
      value?: string;
      committed?: boolean;
      requiresSelection?: boolean;
      availableOptions?: string[];
    }>(
      session,
      backendNodeId,
      `async function(replaceExisting, nextText) {
        const el = this;
        const clip = (incoming, limit = 120) => {
          const normalized = typeof incoming === 'string' ? incoming.replace(/\\s+/g, ' ').trim() : '';
          return normalized.length > limit ? normalized.slice(0, limit - 1) + '…' : normalized;
        };
        const setNativeValue = (node, nextValue) => {
          if (node instanceof HTMLInputElement) {
            const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            if (descriptor && typeof descriptor.set === 'function') {
              descriptor.set.call(node, nextValue);
              return;
            }
          }
          if (node instanceof HTMLTextAreaElement) {
            const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
            if (descriptor && typeof descriptor.set === 'function') {
              descriptor.set.call(node, nextValue);
              return;
            }
          }
          if ('value' in node) {
            node.value = nextValue;
          }
        };
        const visibleOptionsForSelect = (node) => Array.from(node.options || [])
          .map((option) => clip(option.label || option.text || option.value || '', 120))
          .filter(Boolean)
          .slice(0, 10);
        if (!(el instanceof HTMLElement)) {
          return { ok: false, committed: false, requiresSelection: false, availableOptions: [] };
        }
        if (typeof el.focus === 'function') {
          el.focus();
        }
        if (el instanceof HTMLSelectElement) {
          return {
            ok: false,
            value: el.value,
            committed: false,
            requiresSelection: true,
            availableOptions: visibleOptionsForSelect(el),
          };
        }
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          if (replaceExisting) {
            let selected = false;
            if (typeof el.select === 'function') {
              try {
                el.select();
                selected = true;
              } catch {
                selected = false;
              }
            }
            if (!selected && typeof el.setSelectionRange === 'function' && typeof el.value === 'string') {
              try {
                el.setSelectionRange(0, el.value.length);
                selected = true;
              } catch {
                selected = false;
              }
            }
            if (!selected) {
              setNativeValue(el, '');
            }
            if (!nextText.length) {
              setNativeValue(el, '');
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return {
                ok: true,
                skipInsert: true,
              };
            }
          } else if (typeof el.setSelectionRange === 'function' && typeof el.value === 'string') {
            try {
              const end = el.value.length;
              el.setSelectionRange(end, end);
            } catch {
              // Ignore selection failures on controls like number/date inputs.
            }
          }
          return { ok: true, skipInsert: false };
        }
        if (el.isContentEditable) {
          const selection = window.getSelection();
          if (selection) {
            const range = document.createRange();
            range.selectNodeContents(el);
            if (!replaceExisting) {
              range.collapse(false);
            }
            selection.removeAllRanges();
            selection.addRange(range);
          }
          if (replaceExisting && !nextText.length) {
            el.textContent = '';
            el.dispatchEvent(new InputEvent('input', { bubbles: true, data: '', inputType: 'deleteContentBackward' }));
            return {
              ok: true,
              skipInsert: true,
            };
          }
          return { ok: true, skipInsert: false };
        }
        return { ok: false, committed: false, requiresSelection: false, availableOptions: [] };
      }`,
      [replaceExisting, text],
    );

    if (!prepared?.ok) {
      return {
        ok: Boolean(prepared?.ok),
        ...(typeof prepared?.value === "string" ? { value: prepared.value } : {}),
        committed: Boolean(prepared?.committed),
        requiresSelection: Boolean(prepared?.requiresSelection),
        availableOptions: Array.isArray(prepared?.availableOptions)
          ? prepared.availableOptions.filter((entry): entry is string => typeof entry === "string")
          : [],
      };
    }

    if (prepared.skipInsert) {
      return this.finalizeTextInputOnBackendNode(session, backendNodeId, text, false);
    }

    if (text.length > 0) {
      const typed = await this.dispatchKeyboardTextOnBackendNode(session, backendNodeId, text);
      if (!typed?.ok) {
        return {
          ok: false,
          committed: false,
          requiresSelection: false,
          availableOptions: [],
        };
      }
    }

    await sleep(40);
    return this.finalizeTextInputOnBackendNode(session, backendNodeId, text, true);
  }

  private buildOpenedTabsFromObservedEvents(
    session: AttachedSession,
    events: RawEvent[],
  ) {
    const tabContext = this.findTabContext(session.ref.tabId);
    return Array.from(new Map(
      events
        .filter((event) =>
          event.kind === "tab.created"
          && readString(event, "openerTabId", false) === session.ref.tabId
          && (!readString(event, "windowId", false) || readString(event, "windowId", false) === String(tabContext.windowId)),
        )
        .map((event) => {
          const tabId = readString(event, "tabId", false) ?? randomUUID();
          return [
            tabId,
            {
              tabId,
              ...(readString(event, "windowId", false) ? { windowId: readString(event, "windowId", false) } : {}),
              ...(readString(event, "openerTabId", false) ? { openerTabId: readString(event, "openerTabId", false) } : {}),
              ...(readString(event, "url", false) ? { url: readString(event, "url", false) } : {}),
              ...(readString(event, "title", false) ? { title: readString(event, "title", false) } : {}),
              ...(readString(event, "source", false) ? { source: readString(event, "source", false) } : {}),
            },
          ];
        }),
    ).values());
  }

  private buildObservedDialogEvents(events: RawEvent[]) {
    return events
      .filter((event) => event.kind.startsWith("dialog."))
      .slice(0, 4)
      .map((event) => ({
        kind: event.kind,
        ts: event.ts,
        ...(readString(event, "dialogType", false) ? { dialogType: readString(event, "dialogType", false) } : {}),
        ...(readString(event, "message", false) ? { message: readString(event, "message", false) } : {}),
        ...(readString(event, "defaultPrompt", false) ? { defaultPrompt: readString(event, "defaultPrompt", false) } : {}),
        ...(typeof event.accepted === "boolean" ? { accepted: Boolean(event.accepted) } : {}),
        ...(readString(event, "text", false) ? { text: readString(event, "text", false) } : {}),
      }));
  }

  private buildObservedDownloadEvents(events: RawEvent[]) {
    return events
      .filter((event) => event.kind.startsWith("download."))
      .slice(0, 6)
      .map((event) => ({
        kind: event.kind,
        ts: event.ts,
        ...(readString(event, "downloadId", false) ? { downloadId: readString(event, "downloadId", false) } : {}),
        ...(readString(event, "filename", false) ? { filename: readString(event, "filename", false) } : {}),
        ...(readString(event, "state", false) ? { state: readString(event, "state", false) } : {}),
        ...(readString(event, "url", false) ? { url: readString(event, "url", false) } : {}),
        ...(readString(event, "summary", false) ? { summary: readString(event, "summary", false) } : {}),
        ...(typeof event.bytes === "number" ? { bytes: event.bytes } : {}),
        ...(typeof event.totalBytes === "number" ? { totalBytes: event.totalBytes } : {}),
        ...(readString(event, "text", false) ? { text: readString(event, "text", false) } : {}),
      }));
  }

  private async observePublicActionEffects<TResult>(
    session: AttachedSession,
    run: () => Promise<TResult>,
    options?: {
      channels?: string[];
      settleMs?: number;
      maxEvents?: number;
    },
  ) {
    const subscription = await this.startEventCapture({
      session: this.buildPublicSessionRef(session),
      channels: options?.channels ?? ["dialog", "tab", "download", "navigation", "dom"],
      sampleMouseMove: false,
      redactTextInput: true,
    });
    const capture = this.captures.get(subscription.captureId);
    if (!capture) {
      throw new Error(`Subscription ${subscription.captureId} was not found after creation.`);
    }
    const actionStartedAt = Date.now();

    try {
      const result = await run();
      await sleep(Math.max(0, Math.floor(options?.settleMs ?? 280)));
      const actionEvents = capture.events
        .filter((event) => event.ts >= actionStartedAt)
        .sort((left, right) => {
          if (left.ts !== right.ts) {
            return left.ts - right.ts;
          }
          return (left.seq ?? 0) - (right.seq ?? 0);
        });
      const enrichedEvents = await this.enrichReturnedEvents(capture, actionEvents);
      const selectedEvents = selectObservedActionEvents(
        enrichedEvents,
        Math.max(1, Math.floor(options?.maxEvents ?? 8)),
      );
      return {
        result,
        actionEvents: enrichedEvents,
        observedEvents: selectedEvents.map((event) => toPublicRawEvent(event)),
        observedEventKinds: uniqueStrings(enrichedEvents.map((event) => event.kind)),
        openedTabs: this.buildOpenedTabsFromObservedEvents(session, enrichedEvents),
        dialogs: this.buildObservedDialogEvents(enrichedEvents),
        downloads: this.buildObservedDownloadEvents(enrichedEvents),
      };
    } finally {
      this.stopCapture(capture);
      this.captures.delete(capture.captureId);
    }
  }

  private async captureFocusedPressState(session: AttachedSession): Promise<PublicPressStateSnapshot> {
    const result = await this.evaluateInTab<PublicPressStateSnapshot>(
      session.contentsId,
      `(() => {
        const sanitize = (value) => typeof value === 'string' ? value.replace(/\\s+/g, ' ').trim() : '';
        const clip = (value, limit = 1200) => {
          const normalized = sanitize(value);
          return normalized.length > limit ? normalized.slice(0, limit - 1) + '…' : normalized;
        };
        const selectorFor = (node) => {
          if (!(node instanceof Element)) return undefined;
          if (node.id) return '#' + node.id.replace(/[^a-zA-Z0-9_-]/g, '_');
          const name = node.getAttribute('name');
          const tag = node.tagName.toLowerCase();
          return name ? tag + '[name="' + String(name).replace(/"/g, '\\\\\\"') + '"]' : tag;
        };
        const elementValue = (node) => ('value' in node && typeof node.value === 'string') ? node.value : undefined;
        const activeElement = document.activeElement instanceof Element
          ? document.activeElement
          : (document.body || document.documentElement || null);
        const selection = document.getSelection ? document.getSelection() : null;
        return {
          url: window.location.href,
          bodyText: clip(document.body ? document.body.innerText || document.body.textContent || '' : '', 1200),
          activeSelector: selectorFor(activeElement),
          selector: selectorFor(activeElement),
          ...(typeof elementValue(activeElement) === 'string' ? { value: elementValue(activeElement) } : {}),
          text: clip(activeElement instanceof Element ? (activeElement.innerText || activeElement.textContent || '') : '', 240),
          ...(activeElement instanceof HTMLSelectElement ? { selectedIndex: activeElement.selectedIndex } : {}),
          ...(activeElement instanceof Element && sanitize(activeElement.getAttribute('aria-selected'))
            ? { ariaSelected: sanitize(activeElement.getAttribute('aria-selected')).toLowerCase() }
            : {}),
          ...(activeElement instanceof Element && sanitize(activeElement.getAttribute('aria-expanded'))
            ? { ariaExpanded: sanitize(activeElement.getAttribute('aria-expanded')).toLowerCase() }
            : {}),
          ...(activeElement instanceof Element && sanitize(activeElement.getAttribute('aria-activedescendant'))
            ? { activeDescendant: sanitize(activeElement.getAttribute('aria-activedescendant')) }
            : {}),
          selectionText: clip(selection ? selection.toString() : '', 240),
          isFocused: Boolean(activeElement && document.activeElement === activeElement),
        };
      })()`,
    );

    return isRecord(result) ? result as PublicPressStateSnapshot : {};
  }

  private async capturePublicPressState(
    session: AttachedSession,
    targetBackendNodeId?: number,
  ): Promise<PublicPressStateSnapshot> {
    if (targetBackendNodeId === undefined) {
      return this.captureFocusedPressState(session);
    }

    try {
      const result = await this.callFunctionOnBackendNode<PublicPressStateSnapshot>(
        session,
        targetBackendNodeId,
        `function() {
          const el = this instanceof Element
            ? this
            : (document.activeElement instanceof Element ? document.activeElement : (document.body || document.documentElement || null));
          const sanitize = (value) => typeof value === 'string' ? value.replace(/\\s+/g, ' ').trim() : '';
          const clip = (value, limit = 1200) => {
            const normalized = sanitize(value);
            return normalized.length > limit ? normalized.slice(0, limit - 1) + '…' : normalized;
          };
          const selectorFor = (node) => {
            if (!(node instanceof Element)) return undefined;
            if (node.id) return '#' + node.id.replace(/[^a-zA-Z0-9_-]/g, '_');
            const name = node.getAttribute('name');
            const tag = node.tagName.toLowerCase();
            return name ? tag + '[name="' + String(name).replace(/"/g, '\\\\\\"') + '"]' : tag;
          };
          const elementValue = (node) => ('value' in node && typeof node.value === 'string') ? node.value : undefined;
          const selection = document.getSelection ? document.getSelection() : null;
          return {
            url: window.location.href,
            bodyText: clip(document.body ? document.body.innerText || document.body.textContent || '' : '', 1200),
            activeSelector: selectorFor(document.activeElement),
            selector: selectorFor(el),
            ...(typeof elementValue(el) === 'string' ? { value: elementValue(el) } : {}),
            text: clip(el instanceof Element ? (el.innerText || el.textContent || '') : '', 240),
            ...(el instanceof HTMLSelectElement ? { selectedIndex: el.selectedIndex } : {}),
            ...(el instanceof Element && sanitize(el.getAttribute('aria-selected'))
              ? { ariaSelected: sanitize(el.getAttribute('aria-selected')).toLowerCase() }
              : {}),
            ...(el instanceof Element && sanitize(el.getAttribute('aria-expanded'))
              ? { ariaExpanded: sanitize(el.getAttribute('aria-expanded')).toLowerCase() }
              : {}),
            ...(el instanceof Element && sanitize(el.getAttribute('aria-activedescendant'))
              ? { activeDescendant: sanitize(el.getAttribute('aria-activedescendant')) }
              : {}),
            selectionText: clip(selection ? selection.toString() : '', 240),
            isFocused: Boolean(el && document.activeElement === el),
          };
        }`,
      );

      return isRecord(result) ? result as PublicPressStateSnapshot : {};
    } catch {
      return this.captureFocusedPressState(session);
    }
  }

  private async dispatchPublicPressKey(
    session: AttachedSession,
    key: PublicPressKey,
    targetBackendNodeId?: number,
  ) {
    const tabContext = this.findTabContext(session.ref.tabId);
    const keyCode = PUBLIC_PRESS_KEY_TO_ACCELERATOR[key];

    if (!keyCode) {
      throw new Error(`Unsupported press key: ${key}`);
    }

    if (targetBackendNodeId !== undefined) {
      await this.context.sendContentsCdpCommand(session.contentsId, "DOM.enable");
      await this.context.sendContentsCdpCommand(session.contentsId, "DOM.scrollIntoViewIfNeeded", {
        backendNodeId: targetBackendNodeId,
      }).catch(() => undefined);
      await this.context.sendContentsCdpCommand(session.contentsId, "DOM.focus", {
        backendNodeId: targetBackendNodeId,
      }).catch(() => undefined);
    }

    tabContext.webContents.focus();
    await tabContext.webContents.sendInputEvent({
      type: "keyDown",
      keyCode,
    });
    await sleep(24);
    await tabContext.webContents.sendInputEvent({
      type: "keyUp",
      keyCode,
    });
  }

  private async publicElementClick(input: Record<string, unknown>) {
    const session = this.resolveSessionRef(input);
    const tabContext = this.findTabContext(session.ref.tabId);
    const target = await this.resolvePublicTarget(session, assertObject(input.target, "Missing target object."));
    const { result, actionEvents, observedEvents, observedEventKinds, openedTabs, dialogs, downloads } = await this.observePublicActionEffects(
      session,
      () => this.callFunctionOnBackendNode<{
        ok?: boolean;
        effective?: boolean;
        urlChanged?: boolean;
        visibleTextChanged?: boolean;
        focusedElementChanged?: boolean;
        formValidationFailed?: boolean;
        invalidControls?: Array<Record<string, unknown>>;
      }>(
        session,
        target?.backendNodeId as number,
        `async function(force) {
          const el = this;
          const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const sanitize = (value) => typeof value === 'string' ? value.replace(/\\s+/g, ' ').trim() : '';
          const clip = (value, limit = 160) => {
            const normalized = sanitize(value);
            return normalized.length > limit ? normalized.slice(0, limit - 1) + '…' : normalized;
          };
          const normalizeVisualToken = (value) => String(value ?? '').replace(/\\s+/g, '').toLowerCase();
          const visualStyleProps = [
            'color',
            'backgroundColor',
            'borderTopColor',
            'borderRightColor',
            'borderBottomColor',
            'borderLeftColor',
            'outlineColor',
            'textDecorationColor',
            'accentColor',
            'caretColor',
            'boxShadow',
            'opacity',
          ];
          const selectorFor = (node) => {
            if (!(node instanceof Element)) return undefined;
            if (node.id) return '#' + node.id.replace(/[^a-zA-Z0-9_-]/g, '_');
            const name = node.getAttribute('name');
            const tag = node.tagName.toLowerCase();
            return name ? tag + '[name="' + String(name).replace(/"/g, '\\\\\\"') + '"]' : tag;
          };
          const labelFor = (node) => {
            if (!(node instanceof Element)) return undefined;
            if ('labels' in node && node.labels && node.labels.length) {
              const labelText = clip(Array.from(node.labels).map((label) => label.innerText || label.textContent || '').join(' '), 120);
              if (labelText) return labelText;
            }
            const wrapped = typeof node.closest === 'function' ? node.closest('label') : null;
            if (wrapped) {
              const labelText = clip(wrapped.innerText || wrapped.textContent || '', 120);
              if (labelText) return labelText;
            }
            return clip(
              node.getAttribute('aria-label')
              || node.getAttribute('placeholder')
              || node.getAttribute('name')
              || '',
              120,
            ) || undefined;
          };
          const textFor = (node) => clip(node instanceof Element ? (node.innerText || node.textContent || '') : '', 120);
          const visualSignatureFor = (node) => {
            if (!(node instanceof Element)) return undefined;
            const style = window.getComputedStyle(node);
            if (!style) return undefined;
            const parts = visualStyleProps.map((prop) => {
              const normalized = normalizeVisualToken(style[prop]);
              return normalized ? prop + '=' + normalized : undefined;
            }).filter(Boolean);
            const ariaInvalid = sanitize(node.getAttribute('aria-invalid')).toLowerCase();
            if (ariaInvalid) parts.push('aria-invalid=' + ariaInvalid);
            if ('disabled' in node && node.disabled === true) parts.push('disabled=true');
            if ('checked' in node && node.checked === true) parts.push('checked=true');
            if ('selected' in node && node.selected === true) parts.push('selected=true');
            if (typeof node.matches === 'function' && node.matches(':focus')) parts.push('focus=true');
            if (typeof node.matches === 'function' && node.matches(':hover')) parts.push('hover=true');
            if (typeof node.matches === 'function' && node.matches(':active')) parts.push('active=true');
            if (typeof node.checkValidity === 'function') {
              try {
                parts.push('valid=' + String(node.checkValidity()));
              } catch {
                // Ignore validity checks that throw on unsupported elements.
              }
            }
            return parts.join('|') || undefined;
          };
          const readState = (node) => {
            if (!(node instanceof Element)) return null;
            return {
              value: 'value' in node && typeof node.value === 'string' ? node.value : undefined,
              text: textFor(node),
              checked: 'checked' in node ? Boolean(node.checked) : undefined,
              selectedIndex: node instanceof HTMLSelectElement ? node.selectedIndex : undefined,
              validationMessage:
                typeof node.validationMessage === 'string' && sanitize(node.validationMessage)
                  ? clip(node.validationMessage, 200)
                  : undefined,
              ariaInvalid: sanitize(node.getAttribute('aria-invalid')).toLowerCase() || undefined,
              visualSignature: visualSignatureFor(node),
            };
          };
          const collectInvalidControls = (form) => {
            if (!(form instanceof HTMLFormElement)) return [];
            return Array.from(form.querySelectorAll('input,textarea,select'))
              .filter((field) => typeof field.checkValidity === 'function' && !field.checkValidity())
              .slice(0, 5)
              .map((field) => ({
                ...(labelFor(field) ? { label: labelFor(field) } : {}),
                ...(sanitize(field.getAttribute('name')) ? { name: sanitize(field.getAttribute('name')) } : {}),
                ...(selectorFor(field) ? { selector: selectorFor(field) } : {}),
                tagName: field.tagName.toLowerCase(),
                ...(sanitize(field.getAttribute('type')) ? { htmlType: sanitize(field.getAttribute('type')).toLowerCase() } : {}),
                ...(typeof field.validationMessage === 'string' && sanitize(field.validationMessage)
                  ? { validationMessage: clip(field.validationMessage, 200) }
                  : {}),
              }));
          };
          if (!(el instanceof Element)) {
            return {
              ok: false,
              effective: false,
              urlChanged: false,
              visibleTextChanged: false,
              focusedElementChanged: false,
              formValidationFailed: false,
              invalidControls: [],
            };
          }
          if (!force && 'disabled' in el && Boolean(el.disabled)) {
            return {
              ok: false,
              effective: false,
              urlChanged: false,
              visibleTextChanged: false,
              focusedElementChanged: false,
              formValidationFailed: false,
              invalidControls: [],
            };
          }
          const preFocus = selectorFor(document.activeElement);
          const preText = clip(document.body ? document.body.innerText || document.body.textContent || '' : '', 1200);
          const preUrl = window.location.href;
          const preState = readState(el);
          if (typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
          }
          if (typeof el.focus === 'function') {
            el.focus();
          }
          if (typeof el.click === 'function') {
            el.click();
          } else {
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          }
          await wait(450);
          const relatedForm =
            ('form' in el && el.form instanceof HTMLFormElement)
              ? el.form
              : (typeof el.closest === 'function' ? el.closest('form') : null);
          const htmlType = sanitize(el.getAttribute('type')).toLowerCase();
          const actsAsSubmitter = Boolean(relatedForm) && (
            (el instanceof HTMLButtonElement && htmlType !== 'button')
            || (el instanceof HTMLInputElement && ['submit', 'image'].includes(htmlType))
            || /(submit|save|apply|create|search|continue|next|send|login|sign in|sign up|place order)/i.test(textFor(el))
          );
          const invalidControls = actsAsSubmitter ? collectInvalidControls(relatedForm) : [];
          const postFocus = selectorFor(document.activeElement);
          const postText = clip(document.body ? document.body.innerText || document.body.textContent || '' : '', 1200);
          const postUrl = window.location.href;
          const postState = readState(el);
          const urlChanged = preUrl !== postUrl;
          const visibleTextChanged = preText !== postText;
          const focusedElementChanged = preFocus !== postFocus;
          const stateChanged = JSON.stringify(preState) !== JSON.stringify(postState);
          return {
            ok: true,
            effective: urlChanged || visibleTextChanged || focusedElementChanged || stateChanged || invalidControls.length > 0,
            urlChanged,
            visibleTextChanged,
            focusedElementChanged,
            formValidationFailed: invalidControls.length > 0,
            invalidControls,
          };
        }`,
        [readBoolean(input, "force", false)],
      ),
      {
        settleMs: 320,
        maxEvents: 8,
      },
    );
    const dialogOpened = dialogs.some((event) => event.kind === "dialog.opened");
    const dialogRegionObserved = actionEvents.some((event) => eventSuggestsDialogRegion(event));
    const downloadStarted = downloads.some((event) => event.kind === "download.created");
    const navigationObserved = actionEvents.some((event) => event.kind === "page.navigation");
    const domMutationObserved = actionEvents.some((event) => isVisualDomEvent(event));
    const observedErrorMessages = collectObservedErrorMessages(actionEvents);
    const invalidControlMessages = Array.isArray(result?.invalidControls)
      ? uniqueStrings(
        result.invalidControls
          .filter((entry): entry is Record<string, unknown> => isRecord(entry))
          .map((entry) => typeof entry.validationMessage === "string" ? entry.validationMessage : undefined),
      )
      : [];
    const errorMessages = uniqueStrings([...observedErrorMessages, ...invalidControlMessages]);
    const errorObserved = errorMessages.length > 0 || Boolean(result?.formValidationFailed);

    return {
      ok: Boolean(result?.ok),
      action: "click",
      url: tabContext.webContents.getURL(),
      title: tabContext.webContents.getTitle(),
      target,
      effective:
        Boolean(result?.effective)
        || openedTabs.length > 0
        || dialogOpened
        || dialogRegionObserved
        || downloadStarted
        || navigationObserved
        || domMutationObserved,
      urlChanged: Boolean(result?.urlChanged),
      visibleTextChanged: Boolean(result?.visibleTextChanged),
      focusedElementChanged: Boolean(result?.focusedElementChanged),
      formValidationFailed: Boolean(result?.formValidationFailed),
      openedTabs,
      invalidControls: Array.isArray(result?.invalidControls)
        ? result.invalidControls
          .filter((entry): entry is Record<string, unknown> => isRecord(entry))
          .map((entry) => ({
            ...(typeof entry.label === "string" ? { label: entry.label } : {}),
            ...(typeof entry.name === "string" ? { name: entry.name } : {}),
            ...(typeof entry.selector === "string" ? { selector: entry.selector } : {}),
            ...(typeof entry.tagName === "string" ? { tagName: entry.tagName } : {}),
            ...(typeof entry.htmlType === "string" ? { htmlType: entry.htmlType } : {}),
            ...(typeof entry.validationMessage === "string" ? { validationMessage: entry.validationMessage } : {}),
          }))
        : [],
      errorObserved,
      errorMessages,
      dialogOpened,
      dialogRegionObserved,
      downloadStarted,
      navigationObserved,
      domMutationObserved,
      observedEventKinds,
      observedEvents,
      dialogs,
      downloads,
    };
  }

  private async publicElementPress(input: Record<string, unknown>) {
    const session = this.resolveSessionRef(input);
    const tabContext = this.findTabContext(session.ref.tabId);
    const rawTarget = input.target === undefined
      ? undefined
      : assertObject(input.target, "Missing target object.");
    const target = rawTarget
      ? await this.resolvePublicTarget(session, rawTarget)
      : undefined;
    const key = readString(input, "key") as PublicPressKey;

    if (!PUBLIC_PRESS_KEY_VALUES.includes(key)) {
      throw new Error(`Unsupported press key: ${key}`);
    }

    const { result, actionEvents, observedEvents, observedEventKinds, openedTabs, dialogs, downloads } = await this.observePublicActionEffects(
      session,
      async () => {
        const preState = await this.capturePublicPressState(session, target?.backendNodeId);
        await this.dispatchPublicPressKey(session, key, target?.backendNodeId);
        await sleep(80);
        const postState = await this.capturePublicPressState(session, target?.backendNodeId);

        const urlChanged = preState.url !== postState.url;
        const visibleTextChanged = preState.bodyText !== postState.bodyText;
        const focusedElementChanged = preState.activeSelector !== postState.activeSelector;
        const selectionChanged = preState.selectionText !== postState.selectionText;
        const stateChanged = [
          preState.selector !== postState.selector,
          preState.value !== postState.value,
          preState.text !== postState.text,
          preState.selectedIndex !== postState.selectedIndex,
          preState.ariaSelected !== postState.ariaSelected,
          preState.ariaExpanded !== postState.ariaExpanded,
          preState.activeDescendant !== postState.activeDescendant,
          preState.isFocused !== postState.isFocused,
        ].some(Boolean);

        return {
          ok: true,
          key,
          ...(typeof postState.value === "string" ? { value: postState.value } : {}),
          ...(typeof postState.selectedIndex === "number" ? { selectedIndex: postState.selectedIndex } : {}),
          effective:
            urlChanged
            || visibleTextChanged
            || focusedElementChanged
            || selectionChanged
            || stateChanged,
          urlChanged,
          visibleTextChanged,
          focusedElementChanged,
          selectionChanged,
          stateChanged,
        };
      },
      {
        channels: ["input", "navigation", "dom", "dialog", "download", "tab", "focus", "selection"],
        settleMs: 280,
        maxEvents: 8,
      },
    );

    const dialogOpened = dialogs.some((event) => event.kind === "dialog.opened");
    const dialogRegionObserved = actionEvents.some((event) => eventSuggestsDialogRegion(event));
    const downloadStarted = downloads.some((event) => event.kind === "download.created");
    const navigationObserved = actionEvents.some((event) => event.kind === "page.navigation");
    const domMutationObserved = actionEvents.some((event) => isVisualDomEvent(event));
    const focusObserved = actionEvents.some((event) => event.kind === "focus.changed");
    const selectionObserved = actionEvents.some((event) => event.kind === "selection.changed");
    const inputObserved = actionEvents.some((event) => event.kind === "input.input");
    const errorMessages = collectObservedErrorMessages(actionEvents);
    const errorObserved = errorMessages.length > 0;

    return {
      ok: Boolean(result?.ok),
      action: "press",
      key,
      url: tabContext.webContents.getURL(),
      title: tabContext.webContents.getTitle(),
      ...(target ? { target } : {}),
      ...(typeof result?.value === "string" ? { value: result.value } : {}),
      ...(typeof result?.selectedIndex === "number" ? { selectedIndex: Math.trunc(result.selectedIndex) } : {}),
      effective:
        Boolean(result?.effective)
        || openedTabs.length > 0
        || dialogOpened
        || dialogRegionObserved
        || downloadStarted
        || navigationObserved
        || domMutationObserved
        || focusObserved
        || selectionObserved
        || inputObserved,
      urlChanged: Boolean(result?.urlChanged),
      visibleTextChanged: Boolean(result?.visibleTextChanged),
      focusedElementChanged: Boolean(result?.focusedElementChanged) || focusObserved,
      selectionChanged: Boolean(result?.selectionChanged) || selectionObserved,
      stateChanged: Boolean(result?.stateChanged),
      openedTabs,
      errorObserved,
      errorMessages,
      dialogOpened,
      dialogRegionObserved,
      downloadStarted,
      navigationObserved,
      domMutationObserved,
      observedEventKinds,
      observedEvents,
      dialogs,
      downloads,
    };
  }

  private async publicElementInput(input: Record<string, unknown>) {
    const session = this.resolveSessionRef(input);
    const tabContext = this.findTabContext(session.ref.tabId);
    const target = await this.resolvePublicTarget(session, assertObject(input.target, "Missing target object."));
    const text = readString(input, "text") as string;
    const replace = readBoolean(input, "replace", true);
    const { result, actionEvents, observedEvents, observedEventKinds, openedTabs, dialogs, downloads } = await this.observePublicActionEffects(
      session,
      () => this.performTextInputOnBackendNode(
        session,
        target?.backendNodeId as number,
        text,
        replace,
      ),
      {
        settleMs: 280,
        maxEvents: 8,
      },
    );
    const dialogOpened = dialogs.some((event) => event.kind === "dialog.opened");
    const dialogRegionObserved = actionEvents.some((event) => eventSuggestsDialogRegion(event));
    const downloadStarted = downloads.some((event) => event.kind === "download.created");
    const navigationObserved = actionEvents.some((event) => event.kind === "page.navigation");
    const domMutationObserved = actionEvents.some((event) => isVisualDomEvent(event));
    const errorMessages = collectObservedErrorMessages(actionEvents);
    const errorObserved = errorMessages.length > 0;

    return {
      ok: Boolean(result?.ok),
      action: "input",
      url: tabContext.webContents.getURL(),
      title: tabContext.webContents.getTitle(),
      target,
      ...(typeof result?.value === "string" ? { value: result.value } : {}),
      committed: Boolean(result?.committed),
      requiresSelection: Boolean(result?.requiresSelection),
      availableOptions: Array.isArray(result?.availableOptions)
        ? result.availableOptions.filter((entry): entry is string => typeof entry === "string")
        : [],
      openedTabs,
      errorObserved,
      errorMessages,
      dialogOpened,
      dialogRegionObserved,
      downloadStarted,
      navigationObserved,
      domMutationObserved,
      observedEventKinds,
      observedEvents,
      dialogs,
      downloads,
    };
  }

  private async publicElementSelect(input: Record<string, unknown>) {
    const session = this.resolveSessionRef(input);
    const tabContext = this.findTabContext(session.ref.tabId);
    const target = await this.resolvePublicTarget(session, assertObject(input.target, "Missing target object."));
    const value = readString(input, "value") as string;
    const exact = readBoolean(input, "exact", false);
    const result = await this.callFunctionOnBackendNode<{
      ok?: boolean;
      value?: string;
      optionLabel?: string;
      availableOptions?: string[];
    }>(
      session,
      target?.backendNodeId as number,
      `async function(requested, exactMatch) {
        const el = this;
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const sanitize = (incoming) => typeof incoming === 'string' ? incoming.replace(/\\s+/g, ' ').trim() : '';
        const clip = (incoming, limit = 120) => {
          const normalized = sanitize(incoming);
          return normalized.length > limit ? normalized.slice(0, limit - 1) + '…' : normalized;
        };
        const normalize = (incoming) => sanitize(incoming).toLowerCase();
        const isVisible = (node) => {
          if (!(node instanceof Element)) return false;
          const style = window.getComputedStyle(node);
          if (!style || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) {
            return false;
          }
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const buildMatchScore = (label, optionValue) => {
          const normalizedRequested = normalize(requested);
          const normalizedLabel = normalize(label);
          const normalizedValue = normalize(optionValue);
          if (!normalizedRequested) return 0;
          if (exactMatch) {
            return normalizedRequested === normalizedValue || normalizedRequested === normalizedLabel ? 10 : 0;
          }
          if (normalizedRequested === normalizedValue || normalizedRequested === normalizedLabel) return 10;
          if (normalizedLabel.startsWith(normalizedRequested) || normalizedValue.startsWith(normalizedRequested)) return 8;
          if (normalizedLabel.includes(normalizedRequested) || normalizedValue.includes(normalizedRequested)) return 6;
          return 0;
        };
        const rectDistance = (leftRect, rightRect) => {
          const leftCenterX = leftRect.left + leftRect.width / 2;
          const leftCenterY = leftRect.top + leftRect.height / 2;
          const rightCenterX = rightRect.left + rightRect.width / 2;
          const rightCenterY = rightRect.top + rightRect.height / 2;
          return Math.hypot(leftCenterX - rightCenterX, leftCenterY - rightCenterY);
        };
        const collectAssociatedOptionRoots = (node) => {
          if (!(node instanceof Element)) return [];
          const roots = [];
          const seen = new Set();
          const pushRoot = (candidate) => {
            if (!(candidate instanceof Element) || !isVisible(candidate) || seen.has(candidate)) {
              return;
            }
            seen.add(candidate);
            roots.push(candidate);
          };
          if (node instanceof HTMLInputElement && node.list instanceof HTMLDataListElement) {
            pushRoot(node.list);
          }
          const relatedCombobox = typeof node.closest === 'function' ? node.closest('[role="combobox"]') : null;
          const activeDescendantId = node.getAttribute('aria-activedescendant');
          if (activeDescendantId) {
            const activeDescendant = document.getElementById(activeDescendantId);
            if (activeDescendant) {
              pushRoot(activeDescendant.closest('[role="listbox"],datalist,[role="menu"]'));
              pushRoot(activeDescendant.parentElement);
            }
          }
          const ids = [
            node.getAttribute('aria-controls'),
            node.getAttribute('aria-owns'),
            relatedCombobox ? relatedCombobox.getAttribute('aria-controls') : null,
            relatedCombobox ? relatedCombobox.getAttribute('aria-owns') : null,
          ]
            .filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
            .flatMap((entry) => String(entry).split(/\\s+/g));
          ids.forEach((id) => {
            const candidate = document.getElementById(id);
            if (!candidate) {
              return;
            }
            pushRoot(candidate);
            pushRoot(candidate.closest('[role="listbox"],datalist,[role="menu"]'));
          });
          if (roots.length > 0) {
            return roots;
          }
          const shouldFallbackScan =
            normalize(node.getAttribute('role')) === 'combobox'
            || Boolean(node.getAttribute('aria-autocomplete'))
            || node.getAttribute('aria-haspopup') === 'listbox'
            || node.getAttribute('aria-expanded') === 'true'
            || Boolean(activeDescendantId)
            || Boolean(relatedCombobox);
          if (!shouldFallbackScan) {
            return roots;
          }
          const anchorRect = node.getBoundingClientRect();
          Array.from(document.querySelectorAll('[role="listbox"],datalist,[role="menu"]'))
            .filter((candidate) => candidate instanceof Element && isVisible(candidate))
            .map((candidate) => {
              const rect = candidate.getBoundingClientRect();
              const horizontalOverlap = Math.max(0, Math.min(anchorRect.right, rect.right) - Math.max(anchorRect.left, rect.left));
              const verticalGap = rect.top >= anchorRect.bottom
                ? rect.top - anchorRect.bottom
                : anchorRect.top >= rect.bottom
                  ? anchorRect.top - rect.bottom
                  : 0;
              let score = 0;
              if (relatedCombobox && (relatedCombobox.contains(candidate) || candidate.contains(relatedCombobox))) {
                score += 6;
              }
              if (horizontalOverlap > 0) {
                score += 3;
              }
              if (Math.abs(rect.left - anchorRect.left) <= 180) {
                score += 2;
              }
              if (verticalGap <= 260) {
                score += 2;
              }
              if (candidate.getAttribute('aria-labelledby')
                && node.id
                && candidate.getAttribute('aria-labelledby').split(/\\s+/g).includes(node.id)
              ) {
                score += 2;
              }
              return {
                candidate,
                score,
                distance: rectDistance(anchorRect, rect),
              };
            })
            .filter(({ score, distance }) => score > 0 || distance <= 220)
            .sort((left, right) => right.score - left.score || left.distance - right.distance)
            .slice(0, 2)
            .forEach(({ candidate }) => pushRoot(candidate));
          return roots;
        };
        const collectOptionObjectsFromRoot = (root) => {
          const explicitOptions = Array.from(root.querySelectorAll('option,[role="option"]'));
          const fallbackOptions = explicitOptions.length > 0
            ? explicitOptions
            : Array.from(root.querySelectorAll('li,button,div'))
              .filter((candidate) => candidate instanceof Element && candidate !== root && isVisible(candidate))
              .filter((candidate) => {
                if (candidate.querySelector('option,[role="option"]')) {
                  return false;
                }
                if (candidate.tagName.toLowerCase() === 'div' && candidate.children.length > 0 && !candidate.getAttribute('data-value')) {
                  return candidate.getAttribute('aria-selected') === 'true';
                }
                return true;
              });
          return fallbackOptions.map((option) => ({
            element: option,
            label: clip(option.getAttribute('label') || option.textContent || option.getAttribute('value') || '', 120),
            value: clip(option.getAttribute('value') || option.textContent || option.getAttribute('label') || '', 120),
          }));
        };
        const collectAssociatedOptions = (node) => Array.from(new Map(
          collectAssociatedOptionRoots(node)
            .flatMap((root) => collectOptionObjectsFromRoot(root))
            .map((option) => [normalize(option.value) + '::' + normalize(option.label), option]),
        ).values());
        const pickBestOption = (options) => options
          .map((option) => ({
            ...option,
            score: buildMatchScore(option.label, option.value),
          }))
          .filter((option) => option.score > 0)
          .sort((left, right) => right.score - left.score)[0];
        if (!(el instanceof HTMLElement)) {
          return { ok: false, availableOptions: [] };
        }
        if (typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        }
        if (typeof el.focus === 'function') {
          el.focus();
        }
        if (el instanceof HTMLSelectElement) {
          const options = Array.from(el.options).map((option) => ({
            element: option,
            label: clip(option.label || option.text || option.value || '', 120),
            value: clip(option.value || option.text || option.label || '', 120),
          }));
          const match = pickBestOption(options);
          if (!match) {
            return {
              ok: false,
              value: el.value,
              availableOptions: options.map((option) => option.label).filter(Boolean).slice(0, 10),
            };
          }
          el.value = match.element.value;
          match.element.selected = true;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return {
            ok: true,
            value: el.value,
            optionLabel: match.label,
            availableOptions: options.map((option) => option.label).filter(Boolean).slice(0, 10),
          };
        }
        if ('value' in el && typeof el.value === 'string') {
          el.value = String(requested);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (el.isContentEditable) {
          el.textContent = String(requested);
          el.dispatchEvent(new InputEvent('input', { bubbles: true, data: String(requested), inputType: 'insertText' }));
        }
        await wait(120);
        let options = collectAssociatedOptions(el);
        const pollStartedAt = Date.now();
        let lastSignature = JSON.stringify(options.map((option) => [normalize(option.value), normalize(option.label)]));
        let stableReads = 0;
        while (Date.now() - pollStartedAt < 900) {
          if (options.length > 0 && stableReads >= 1) {
            break;
          }
          await wait(120);
          options = collectAssociatedOptions(el);
          const signature = JSON.stringify(options.map((option) => [normalize(option.value), normalize(option.label)]));
          stableReads = signature === lastSignature ? stableReads + 1 : 0;
          lastSignature = signature;
          if (options.length > 0 && stableReads >= 1) {
            break;
          }
        }
        const match = pickBestOption(options);
        if (match) {
          if (el instanceof HTMLInputElement && el.list instanceof HTMLDataListElement && match.element instanceof HTMLOptionElement) {
            el.value = match.element.value || match.label;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (typeof match.element.scrollIntoView === 'function') {
            match.element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
            if (typeof match.element.click === 'function') {
              match.element.click();
            } else {
              match.element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            }
          }
          await wait(120);
        }
        const currentValue =
          'value' in el && typeof el.value === 'string'
            ? el.value
            : (el.textContent || '');
        const normalizedRequested = normalize(requested);
        const normalizedCurrentValue = normalize(currentValue);
        return {
          ok: Boolean(match) || (options.length === 0 && normalizedCurrentValue === normalizedRequested),
          value: currentValue,
          ...(match?.label ? { optionLabel: match.label } : {}),
          availableOptions: options.map((option) => option.label).filter(Boolean).slice(0, 10),
        };
      }`,
      [value, exact],
    );

    return {
      ok: Boolean(result?.ok),
      action: "select",
      url: tabContext.webContents.getURL(),
      title: tabContext.webContents.getTitle(),
      target,
      ...(typeof result?.value === "string" ? { value: result.value } : {}),
      ...(typeof result?.optionLabel === "string" ? { optionLabel: result.optionLabel } : {}),
      availableOptions: Array.isArray(result?.availableOptions)
        ? result.availableOptions.filter((entry): entry is string => typeof entry === "string")
        : [],
    };
  }

  private async publicElementScroll(input: Record<string, unknown>) {
    const session = this.resolveSessionRef(input);
    const tabContext = this.findTabContext(session.ref.tabId);
    const target = isRecord(input.target)
      ? await this.resolvePublicTarget(session, input.target, false)
      : undefined;
    const direction = readString(input, "direction", false) ?? "down";
    const rawAmount = readNumber(input, "amount", false) ?? 640;
    const amount = direction === "up" ? -Math.abs(rawAmount) : Math.abs(rawAmount);

    if (target?.backendNodeId !== undefined) {
      const result = await this.callFunctionOnBackendNode<{ ok?: boolean; elementScrollTop?: number; pageScrollY?: number }>(
        session,
        target.backendNodeId,
        `function(delta) {
          const el = this;
          if (!(el instanceof Element)) {
            return { ok: false };
          }
          if (typeof el.scrollBy === "function") {
            el.scrollBy({ top: delta, left: 0, behavior: "instant" });
          } else {
            el.scrollTop = (el.scrollTop || 0) + delta;
          }
          return {
            ok: true,
            elementScrollTop: typeof el.scrollTop === "number" ? el.scrollTop : undefined,
            pageScrollY: typeof window.scrollY === "number" ? window.scrollY : undefined,
          };
        }`,
        [amount],
      );

      return {
        ok: Boolean(result?.ok),
        action: "scroll",
        url: tabContext.webContents.getURL(),
        title: tabContext.webContents.getTitle(),
        target,
        ...(typeof result?.pageScrollY === "number" ? { pageScrollY: result.pageScrollY } : {}),
        ...(typeof result?.elementScrollTop === "number" ? { elementScrollTop: result.elementScrollTop } : {}),
      };
    }

    const pageScroll = await this.evaluateInTab<{ ok?: boolean; pageScrollY?: number }>(
      session.contentsId,
      `(() => {
        window.scrollBy({ top: ${JSON.stringify(amount)}, left: 0, behavior: "instant" });
        return {
          ok: true,
          pageScrollY: typeof window.scrollY === "number" ? window.scrollY : undefined,
        };
      })()`,
    );

    return {
      ok: Boolean(pageScroll?.ok ?? true),
      action: "scroll",
      url: tabContext.webContents.getURL(),
      title: tabContext.webContents.getTitle(),
      ...(target ? { target } : {}),
      ...(typeof pageScroll?.pageScrollY === "number" ? { pageScrollY: pageScroll.pageScrollY } : {}),
    };
  }

  private async publicEventsSubscribe(input: Record<string, unknown>) {
    const session = this.resolveSessionRef(input);
    const subscription = await this.startEventCapture({
      session: this.buildPublicSessionRef(session),
      channels: readArray(input, "channels"),
      sampleMouseMove: readBoolean(input, "sampleMouseMove", false),
      redactTextInput: readBoolean(input, "redactTextInput", true),
    });
    const capture = this.captures.get(subscription.captureId);
    if (!capture) {
      throw new Error(`Subscription ${subscription.captureId} was not found after creation.`);
    }

    const firstEvent = capture.events[0];
    return {
      subscription: {
        subscriptionId: capture.captureId,
        session: this.buildPublicSessionRef(session),
        startedAt: capture.startedAt,
        channels: Array.from(capture.channels),
        sampleMouseMove: capture.sampleMouseMove,
        redactTextInput: capture.redactTextInput,
        cursor: toSubscriptionStartCursor(capture.captureId, firstEvent, capture.droppedEvents > 0),
      },
    };
  }

  private async publicEventsRead(input: Record<string, unknown>) {
    return this.contextRead(input);
  }

  private async publicEventsAwait(input: Record<string, unknown>, options?: ToolCallOptions) {
    const subscriptionId = readString(input, "subscriptionId") as string;
    const capture = this.captures.get(subscriptionId);
    if (!capture) {
      throw new Error(`Subscription ${subscriptionId} not found.`);
    }
    if (capture.stoppedAt) {
      throw new Error(`Subscription ${subscriptionId} has already been stopped.`);
    }

    const cursor = parseStructuredCursor(input.cursor, subscriptionId);
    const matcher = this.parseEventAwaitMatcher(input, capture);
    const timeoutMs = Math.max(
      1,
      Math.min(
        MAX_EVENT_AWAIT_TIMEOUT_MS,
        Math.floor(readNumber(input, "timeoutMs", false) ?? DEFAULT_EVENT_AWAIT_TIMEOUT_MS),
      ),
    );
    const coalesceMs = Math.max(
      0,
      Math.min(
        timeoutMs,
        Math.floor(readNumber(input, "coalesceMs", false) ?? DEFAULT_EVENT_AWAIT_COALESCE_MS),
      ),
    );
    const maxEvents = Math.max(
      1,
      Math.min(
        MAX_EVENT_AWAIT_BATCH,
        Math.floor(readNumber(input, "maxEvents", false) ?? 1),
      ),
    );

    const earliestAvailableSeq = capture.events[0]?.seq ?? (capture.lastSeq + 1);
    const dropped = Boolean(capture.droppedEvents > 0 && (!cursor || cursor.seq < earliestAvailableSeq));
    const bufferedMatches = this.collectCaptureEvents(
      capture,
      cursor,
      maxEvents,
      (event) => this.eventMatchesAwaitMatcher(event, matcher),
    );

    if (bufferedMatches.length > 0) {
      return this.enrichAwaitResult(
        capture,
        this.buildPublicAwaitResult(subscriptionId, bufferedMatches, false, dropped),
      );
    }

    const result = await this.awaitCaptureEvents(capture, {
      cursor,
      matcher,
      timeoutMs,
      coalesceMs,
      maxEvents,
      dropped,
      signal: options?.signal,
    });
    return this.enrichAwaitResult(capture, result);
  }

  private async publicEventsUnsubscribe(input: Record<string, unknown>) {
    return this.contextUnsubscribe(input);
  }

  private async publicDialogHandle(input: Record<string, unknown>) {
    const session = this.resolveSessionRef(input);
    await this.context.sendContentsCdpCommand(session.contentsId, "Page.enable");
    await this.context.sendContentsCdpCommand(session.contentsId, "Page.handleJavaScriptDialog", {
      accept: readBoolean(input, "accept", false),
      ...(readString(input, "promptText", false) ? { promptText: readString(input, "promptText", false) } : {}),
    });

    return {
      ok: true,
      accepted: readBoolean(input, "accept", false),
      ...(readString(input, "promptText", false) ? { promptText: readString(input, "promptText", false) } : {}),
    };
  }

  private tabListSummary(
    windowId: number,
    tab: TabRecordLike,
    workspaceId =
      this.context.windowToWorkspace.get(windowId) ?? this.context.defaultWorkspaceId,
    activeTabId = this.context.windowActiveTabs.get(windowId),
  ): TabListSummary {
    return {
      tabId: tab.id,
      windowId: String(windowId),
      workspaceId,
      title: tab.title,
      url: tab.url,
      displayUrl: tab.displayUrl,
      ...(tab.favicon ? { favicon: tab.favicon } : {}),
      isLoading: tab.isLoading,
      canGoBack: tab.canGoBack,
      canGoForward: tab.canGoForward,
      isActive: activeTabId === tab.id,
    };
  }

  private tabOrganizationTabSummary(tab: TabListSummary): TabOrganizationTabSummary {
    return {
      tabId: tab.tabId,
      title: tab.title,
      url: tab.url,
      displayUrl: tab.displayUrl,
      ...(tab.favicon ? { favicon: tab.favicon } : {}),
      isActive: tab.isActive,
    };
  }

  private buildTabOrganizationSummary(
    windowId: number,
    workspaceId: string,
    windowTabs: Map<string, TabRecordLike>,
    activeTabId?: string,
  ): TabOrganizationSummary | undefined {
    const sidebarState = this.context.getSidebarOrganizationState?.({ windowId, workspaceId });
    if (!sidebarState) {
      return undefined;
    }

    const tabsById = new Map(
      Array.from(windowTabs.values()).map((tab) => [
        tab.id,
        this.tabListSummary(windowId, tab, workspaceId, activeTabId),
      ]),
    );

    const readTab = (tabId: string) => {
      const tab = tabsById.get(tabId);
      return tab ? this.tabOrganizationTabSummary(tab) : undefined;
    };

    const groups = Object.values(sidebarState.folders).map((folder) => ({
      folderId: folder.id,
      title: folder.title,
      ...(folder.icon ? { icon: folder.icon } : {}),
      ...(folder.backgroundColor ? { backgroundColor: folder.backgroundColor } : {}),
      isExpanded: folder.isExpanded,
      tabCount: folder.tabIds.length,
      tabs: folder.tabIds.flatMap((tabId) => {
        const tab = readTab(tabId);
        return tab ? [tab] : [];
      }),
    }));

    const rootTabs = sidebarState.entries
      .filter((entry): entry is Extract<OrganizerSidebarState["entries"][number], { kind: "tab" }> =>
        entry.kind === "tab")
      .flatMap((entry) => {
        const tab = readTab(entry.tabId);
        return tab ? [tab] : [];
      });

    const splits = Object.values(sidebarState.splits).map((split) => ({
      splitId: split.id,
      mode: split.mode,
      tabCount: split.tabIds.length,
      focusedTabId: split.focusedTabId,
      syncScroll: split.syncScroll,
      tabs: split.tabIds.flatMap((tabId) => {
        const tab = readTab(tabId);
        return tab ? [tab] : [];
      }),
    }));

    const groupedTabIds = new Set(groups.flatMap((group) => group.tabs.map((tab) => tab.tabId)));
    const splitTabIds = new Set(splits.flatMap((split) => split.tabs.map((tab) => tab.tabId)));

    return {
      windowId: String(windowId),
      workspaceId,
      ...(activeTabId ? { activeTabId } : {}),
      totalTabCount: windowTabs.size,
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

  private async listWindows(input: Record<string, unknown>, options?: ToolCallOptions) {
    const workspaceFilter = readString(input, "workspaceId", false);
    if (options?.boundScope === "tab" && options.boundTabId) {
      const tabContext = this.tryFindTabContext(options.boundTabId);
      if (!tabContext) {
        return { windows: [] };
      }
      const targetWindow = BrowserWindow.fromId(tabContext.windowId);
      if (!targetWindow || targetWindow.isDestroyed()) {
        return { windows: [] };
      }
      const workspaceId =
        this.context.windowToWorkspace.get(tabContext.windowId) ?? this.context.defaultWorkspaceId;
      if (workspaceFilter && workspaceFilter !== workspaceId) {
        return { windows: [] };
      }
      const { tab } = this.requireWindowTab(tabContext.windowId, options.boundTabId);
      return {
        windows: [
          {
            windowId: String(tabContext.windowId),
            workspaceId,
            tabCount: 1,
            activeTabId: options.boundTabId,
            visible: targetWindow.isVisible(),
            focused: targetWindow.isFocused(),
            title: tab.title,
          },
        ],
      };
    }

    const windows = BrowserWindow.getAllWindows()
      .filter((targetWindow) => !targetWindow.isDestroyed())
      .map((targetWindow) => {
        const windowId = targetWindow.id;
        const tabs = this.context.tabRecords.get(windowId);
        const workspaceId =
          this.context.windowToWorkspace.get(windowId) ?? this.context.defaultWorkspaceId;
        const activeTabId = this.context.windowActiveTabs.get(windowId);

        return {
          windowId: String(windowId),
          workspaceId,
          tabCount: tabs?.size ?? 0,
          ...(activeTabId ? { activeTabId } : {}),
          visible: targetWindow.isVisible(),
          focused: targetWindow.isFocused(),
          title: targetWindow.getTitle(),
        };
      })
      .filter((entry) => {
        if (!workspaceFilter) {
          return true;
        }

        return entry.workspaceId === workspaceFilter;
      })
      .sort((left, right) => Number(left.windowId) - Number(right.windowId));

    return { windows };
  }

  private async listTabs(input: Record<string, unknown>, options?: ToolCallOptions) {
    const windowIdFilter = readWindowId(input, "windowId", false);
    const workspaceFilter = readString(input, "workspaceId", false);
    if (options?.boundScope === "tab" && options.boundTabId) {
      const tabContext = this.tryFindTabContext(options.boundTabId);
      if (!tabContext) {
        return { tabs: [] };
      }
      if (typeof windowIdFilter === "number" && windowIdFilter !== tabContext.windowId) {
        return { tabs: [] };
      }
      const workspaceId =
        this.context.windowToWorkspace.get(tabContext.windowId) ?? this.context.defaultWorkspaceId;
      if (workspaceFilter && workspaceFilter !== workspaceId) {
        return { tabs: [] };
      }
      const { tab } = this.requireWindowTab(tabContext.windowId, options.boundTabId);
      return { tabs: [this.tabSummary(tabContext.windowId, tab)] };
    }

    const tabOrganizations: TabOrganizationSummary[] = [];
    const tabs = Array.from(this.context.tabRecords.entries()).flatMap(([windowId, windowTabs]) => {
      if (typeof windowIdFilter === "number" && windowIdFilter !== windowId) {
        return [];
      }

      const workspaceId =
        this.context.windowToWorkspace.get(windowId) ?? this.context.defaultWorkspaceId;
      if (workspaceFilter && workspaceFilter !== workspaceId) {
        return [];
      }

      const activeTabId = this.context.windowActiveTabs.get(windowId);
      const tabOrganization = this.buildTabOrganizationSummary(windowId, workspaceId, windowTabs, activeTabId);
      if (tabOrganization) {
        tabOrganizations.push(tabOrganization);
      }

      return Array.from(windowTabs.values())
        .map((tab) => this.tabListSummary(windowId, tab, workspaceId, activeTabId))
        .sort((left, right) => {
          if (left.isActive && !right.isActive) {
            return -1;
          }
          if (!left.isActive && right.isActive) {
            return 1;
          }
          return left.title.localeCompare(right.title);
        });
    });

    return {
      tabs,
      ...(tabOrganizations.length > 0 ? { tabOrganizations } : {}),
    };
  }

  private requireWindow(windowId: number) {
    const targetWindow = BrowserWindow.fromId(windowId);
    if (!targetWindow || targetWindow.isDestroyed()) {
      throw new Error(`Window ${windowId} not found.`);
    }

    return targetWindow;
  }

  private requireWindowTab(windowId: number, tabId: string) {
    const tabs = this.context.tabRecords.get(windowId);
    const tab = tabs?.get(tabId);
    if (!tabs || !tab) {
      throw new Error(`Tab ${tabId} not found in window ${windowId}.`);
    }

    return { tabs, tab };
  }

  private tabSummary(windowId: number, tab: TabRecordLike) {
    return this.tabListSummary(windowId, tab);
  }

  private async windowCreate(input: Record<string, unknown>) {
    const workspaceId = readString(input, "workspaceId", false) ?? this.context.defaultWorkspaceId;
    const show = readBoolean(input, "show", true);
    const focus = readBoolean(input, "focus", true);
    const targetWindow = this.context.createWindowForWorkspace(workspaceId, {
      show,
      focus,
    });

    const tabs = this.context.tabRecords.get(targetWindow.id);

    return {
      windowId: String(targetWindow.id),
      workspaceId,
      visible: targetWindow.isVisible(),
      focused: targetWindow.isFocused(),
      tabCount: tabs?.size ?? 0,
      ...(this.context.windowActiveTabs.get(targetWindow.id)
        ? { activeTabId: this.context.windowActiveTabs.get(targetWindow.id) }
        : {}),
    };
  }

  private async windowFocus(input: Record<string, unknown>) {
    const windowId = readWindowId(input, "windowId") as number;
    const targetWindow = this.context.focusWindowById(windowId);

    return {
      windowId: String(targetWindow.id),
      visible: targetWindow.isVisible(),
      focused: targetWindow.isFocused(),
    };
  }

  private async windowClose(input: Record<string, unknown>) {
    const windowId = readWindowId(input, "windowId") as number;
    const targetWindow = this.requireWindow(windowId);
    this.context.requestWindowClose(targetWindow);

    return {
      windowId: String(windowId),
      success: true,
    };
  }

  private async tabCreate(input: Record<string, unknown>, options?: ToolCallOptions) {
    const windowId = readWindowId(input, "windowId") as number;
    const url = readString(input, "url", false);
    const activate = readBoolean(input, "activate", false) ?? true;
    const tab = this.context.createTabInWindow(windowId, url, {
      activate,
      ...(options?.boundScope === "tab" && options.boundTabId
        ? {
          openerTabId: options.boundTabId,
          sidebarGroupWithTabId: options.boundTabId,
        }
        : {}),
    });
    const activeTabId = this.context.windowActiveTabs.get(windowId);
    return {
      tabId: tab.id,
      windowId: String(windowId),
      title: tab.title,
      url: tab.url,
      displayUrl: tab.displayUrl,
      isLoading: tab.isLoading,
      isActive: activeTabId === tab.id,
    };
  }

  private async tabClose(input: Record<string, unknown>) {
    const windowId = readWindowId(input, "windowId") as number;
    const tabId = readString(input, "tabId") as string;
    const result = this.context.closeTabInWindow(windowId, tabId);

    return {
      windowId: String(windowId),
      activeTabId: result.activeTabId,
    };
  }

  private async tabActivate(input: Record<string, unknown>) {
    const windowId = readWindowId(input, "windowId") as number;
    const tabId = readString(input, "tabId") as string;
    this.context.activateTabInWindow(windowId, tabId);
    const activeTabId = this.context.windowActiveTabs.get(windowId);
    if (!activeTabId) {
      throw new Error(`Window ${windowId} has no active tab after activation.`);
    }

    return {
      windowId: String(windowId),
      activeTabId,
    };
  }

  private async tabGoBack(input: Record<string, unknown>) {
    const windowId = readWindowId(input, "windowId") as number;
    const tabId = readString(input, "tabId") as string;
    const navigated = await this.context.goBackInTab(windowId, tabId);
    const latest = this.requireWindowTab(windowId, tabId).tab;

    return {
      windowId: String(windowId),
      tabId: latest.id,
      url: latest.url,
      title: latest.title,
      displayUrl: latest.displayUrl,
      canGoBack: latest.canGoBack,
      canGoForward: latest.canGoForward,
      navigated,
    };
  }

  private async tabGoForward(input: Record<string, unknown>) {
    const windowId = readWindowId(input, "windowId") as number;
    const tabId = readString(input, "tabId") as string;
    const navigated = await this.context.goForwardInTab(windowId, tabId);
    const latest = this.requireWindowTab(windowId, tabId).tab;

    return {
      windowId: String(windowId),
      tabId: latest.id,
      url: latest.url,
      title: latest.title,
      displayUrl: latest.displayUrl,
      canGoBack: latest.canGoBack,
      canGoForward: latest.canGoForward,
      navigated,
    };
  }

  private async tabReload(input: Record<string, unknown>) {
    const windowId = readWindowId(input, "windowId") as number;
    const tabId = readString(input, "tabId") as string;
    const { reloading } = await this.context.reloadTabInWindow(windowId, tabId);
    const latest = this.requireWindowTab(windowId, tabId).tab;

    return {
      windowId: String(windowId),
      tabId: latest.id,
      url: latest.url,
      title: latest.title,
      displayUrl: latest.displayUrl,
      isLoading: latest.isLoading,
      reloading,
    };
  }

  private selectTabForOpenUrl(input: Record<string, unknown>): {
    tabId: string;
    createdTab: boolean;
  } {
    const tabId = readString(input, "tabId", false);
    if (tabId) {
      this.findTabContext(tabId);
      return { tabId, createdTab: false };
    }

    const windowIdFilter = readWindowId(input, "windowId", false);
    const workspaceFilter = readString(input, "workspaceId", false);
    const createIfMissing = readBoolean(input, "createIfMissing", true);

    const candidates: Array<{
      tabId: string;
      windowId: number;
      workspaceId: string;
      isActive: boolean;
    }> = [];

    for (const [windowId, tabs] of this.context.tabRecords.entries()) {
      if (typeof windowIdFilter === "number" && windowIdFilter !== windowId) {
        continue;
      }
      const workspaceId =
        this.context.windowToWorkspace.get(windowId) ?? this.context.defaultWorkspaceId;
      if (workspaceFilter && workspaceFilter !== workspaceId) {
        continue;
      }
      const activeTabId = this.context.windowActiveTabs.get(windowId);
      for (const currentTabId of tabs.keys()) {
        candidates.push({
          tabId: currentTabId,
          windowId,
          workspaceId,
          isActive: activeTabId === currentTabId,
        });
      }
    }

    if (candidates.length) {
      candidates.sort((left, right) => {
        if (left.isActive && !right.isActive) {
          return -1;
        }
        if (!left.isActive && right.isActive) {
          return 1;
        }
        return left.windowId - right.windowId;
      });
      return { tabId: candidates[0].tabId, createdTab: false };
    }

    if (!createIfMissing) {
      throw new AutomationToolError({
        errorCode: "NO_TAB_AVAILABLE",
        category: "execution",
        message: "No tab matched the requested filters, and createIfMissing=false.",
        retryable: true,
        suggestion: "Provide tabId/windowId/workspaceId that exists or set createIfMissing=true.",
      });
    }

    let targetWindowId: number | undefined;
    if (typeof windowIdFilter === "number") {
      this.requireWindow(windowIdFilter);
      targetWindowId = windowIdFilter;
    } else if (workspaceFilter) {
      const workspaceWindows = BrowserWindow.getAllWindows()
        .filter((window) => !window.isDestroyed())
        .filter((window) => {
          const workspaceId =
            this.context.windowToWorkspace.get(window.id) ?? this.context.defaultWorkspaceId;
          return workspaceId === workspaceFilter;
        });
      if (workspaceWindows.length) {
        const focused = workspaceWindows.find((window) => window.isFocused());
        targetWindowId = (focused ?? workspaceWindows[0]).id;
      } else {
        const createdWindow = this.context.createWindowForWorkspace(workspaceFilter, {
          show: true,
          focus: true,
        });
        targetWindowId = createdWindow.id;
      }
    } else {
      const allWindows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
      if (allWindows.length) {
        const focused = allWindows.find((window) => window.isFocused());
        targetWindowId = (focused ?? allWindows[0]).id;
      } else {
        const createdWindow = this.context.createWindowForWorkspace(
          this.context.defaultWorkspaceId,
          { show: true, focus: true },
        );
        targetWindowId = createdWindow.id;
      }
    }

    const createdTab = this.context.createTabInWindow(targetWindowId, "about:blank");
    return { tabId: createdTab.id, createdTab: true };
  }

  private async openUrl(input: Record<string, unknown>) {
    const url = readString(input, "url") as string;
    const userId = readString(input, "userId", false);
    const observeOnly = readBoolean(input, "observeOnly", false);
    const waitUntil = readString(input, "waitUntil", false) ?? "load";
    const timeoutMs = Math.max(200, Math.floor(readNumber(input, "timeoutMs", false) ?? 10_000));

    const { tabId, createdTab } = this.selectTabForOpenUrl(input);
    const attachResult = await this.attachSession({
      tabId,
      ...(userId ? { userId } : {}),
      observeOnly,
    });
    const navigationResult = await this.navigate({
      session: attachResult.session,
      url,
      waitUntil,
      timeoutMs,
    });
    const tabContext = this.findTabContext(tabId);

    return {
      session: attachResult.session,
      attachedAt: attachResult.attachedAt,
      windowId: String(tabContext.windowId),
      tabId,
      url: navigationResult.url,
      title: navigationResult.title,
      waitUntil: navigationResult.waitUntil,
      matched: navigationResult.matched,
      timedOut: navigationResult.timedOut,
      ...(navigationResult.matchedEvent ? { matchedEvent: navigationResult.matchedEvent } : {}),
      createdTab,
    };
  }

  private findTabContext(tabId: string) {
    const view = this.context.browserViews.get(tabId);
    if (!view || view.webContents.isDestroyed()) {
      throw new Error(`Tab ${tabId} is not available.`);
    }

    const runtime = this.context.findTabWindowContext(tabId);
    if (runtime) {
      return {
        workspaceId: runtime.workspaceId,
        windowId: runtime.windowId,
        contentsId: view.webContents.id,
        webContents: view.webContents,
      };
    }

    throw new Error(`Could not resolve tab ${tabId} to a browser window.`);
  }

  private resolveSessionRef(input: Record<string, unknown>): AttachedSession {
    const sessionInput = assertObject(input.session, "Missing session object.");
    const sessionId = readString(sessionInput, "sessionId") as string;
    const tabId = readString(sessionInput, "tabId") as string;

    const attached = this.sessions.get(sessionId);
    if (!attached) {
      throw new Error(`Session ${sessionId} is not attached.`);
    }

    if (attached.ref.tabId !== tabId) {
      throw new Error(
        `Session mismatch: expected tab ${attached.ref.tabId}, received ${tabId}.`,
      );
    }

    let tabContext;
    try {
      tabContext = this.findTabContext(tabId);
    } catch (error) {
      this.sessions.delete(sessionId);
      throw error;
    }
    attached.contentsId = tabContext.contentsId;
    attached.workspaceId = tabContext.workspaceId;

    return attached;
  }

  private async computeDocumentId(contentsId: number): Promise<string> {
    const payload = await this.evaluateInTab<{ href?: string; timeOrigin?: number }>(
      contentsId,
      "(() => ({ href: window.location.href, timeOrigin: Number(window.performance?.timeOrigin || 0) }))()",
    );

    const href = typeof payload?.href === "string" ? payload.href : "";
    const timeOrigin = typeof payload?.timeOrigin === "number" && Number.isFinite(payload.timeOrigin)
      ? Math.floor(payload.timeOrigin)
      : Date.now();

    return `${timeOrigin}:${href}`;
  }

  private async buildPageRef(session: AttachedSession): Promise<PageRefLike> {
    return {
      sessionId: session.ref.sessionId,
      tabId: session.ref.tabId,
      ...(session.ref.frameId ? { frameId: session.ref.frameId } : {}),
      ...(session.ref.userId ? { userId: session.ref.userId } : {}),
      documentId: await this.computeDocumentId(session.contentsId),
      leaseId: session.leaseId,
      observeOnly: session.observeOnly,
    };
  }

  private async resolvePageInput(
    input: Record<string, unknown>,
    field = "page",
    options?: { enforceDocumentId?: boolean },
  ): Promise<{ session: AttachedSession; page: PageRefLike; staleDocument: boolean }> {
    const pageInput = assertObject(input[field], `Missing ${field} object.`);
    const session = this.resolveSessionRef({
      session: {
        sessionId: readString(pageInput, "sessionId") as string,
        tabId: readString(pageInput, "tabId") as string,
      },
    });
    const leaseId = readString(pageInput, "leaseId", false);
    if (leaseId && leaseId !== session.leaseId) {
      throw new Error(
        `Lease mismatch: expected ${session.leaseId}, received ${leaseId}. Re-attach the page context and retry.`,
      );
    }

    const page = await this.buildPageRef(session);
    const suppliedDocumentId = readString(pageInput, "documentId", false);
    const staleDocument = Boolean(suppliedDocumentId && suppliedDocumentId !== page.documentId);
    if (options?.enforceDocumentId && staleDocument) {
      throw new Error(
        "Page document changed since the page ref was issued. Refresh the page context with context.get or context.attach and retry.",
      );
    }

    return {
      session,
      page,
      staleDocument,
    };
  }

  private buildSubscriptionState(
    capture: EventCaptureState,
    page: PageRefLike,
  ): Record<string, unknown> {
    const firstEvent = capture.events[0];
    return {
      subscriptionId: capture.captureId,
      page,
      startedAt: capture.startedAt,
      mode: "pull",
      channels: Array.from(capture.channels),
      cursor: toSubscriptionStartCursor(capture.captureId, firstEvent, capture.droppedEvents > 0),
      sampleMouseMove: capture.sampleMouseMove,
      redactTextInput: capture.redactTextInput,
    };
  }

  private getHandle(handleId: string): LiveHandleState {
    const handle = this.handles.get(handleId);
    if (!handle) {
      throw new Error(`Unknown handleId: ${handleId}`);
    }
    return handle;
  }

  private pruneHandles() {
    const handles = Array.from(this.handles.values()).sort(
      (left, right) => left.generation - right.generation,
    );
    const overflow = handles.length - MAX_HANDLES;
    if (overflow <= 0) {
      return;
    }

    for (const handle of handles.slice(0, overflow)) {
      this.handles.delete(handle.handleId);
      if (this.handleIdsByFingerprint.get(handle.fingerprint) === handle.handleId) {
        this.handleIdsByFingerprint.delete(handle.fingerprint);
      }
    }
  }

  private registerHandle(
    session: AttachedSession,
    snapshot: StoredSnapshot,
    config: Omit<LiveHandleState, "handleId" | "sessionId" | "snapshotId" | "generation" | "stale"> & {
      generationBase?: number;
    },
  ): LiveHandleState {
    const existingId = this.handleIdsByFingerprint.get(config.fingerprint);
    const previous = existingId ? this.handles.get(existingId) : undefined;
    const handleId = previous?.handleId ?? randomUUID();
    const nextGeneration = (previous?.generation ?? config.generationBase ?? 0) + 1;
    const next: LiveHandleState = {
      handleId,
      sessionId: session.ref.sessionId,
      kind: config.kind,
      fingerprint: config.fingerprint,
      snapshotId: snapshot.snapshotId,
      generation: nextGeneration,
      stale: false,
      role: config.role,
      name: config.name,
      description: config.description,
      locator: config.locator,
      targetElementId: config.targetElementId,
      targetFormId: config.targetFormId,
      targetRegionId: config.targetRegionId,
    };

    this.handles.set(handleId, next);
    this.handleIdsByFingerprint.set(config.fingerprint, handleId);
    this.pruneHandles();
    return next;
  }

  private buildLiveHandleOutput(
    handle: LiveHandleState,
    page: PageRefLike,
  ): Record<string, unknown> {
    return {
      handleId: handle.handleId,
      kind: handle.kind,
      page,
      snapshotId: handle.snapshotId,
      generation: handle.generation,
      stale: handle.stale,
      ...(handle.role ? { role: handle.role } : {}),
      ...(handle.name ? { name: handle.name } : {}),
      ...(handle.description ? { description: handle.description } : {}),
      ...(handle.locator ? { locator: handle.locator } : {}),
      ...(handle.targetElementId ? { targetElementId: handle.targetElementId } : {}),
      ...(handle.targetFormId ? { targetFormId: handle.targetFormId } : {}),
      ...(handle.targetRegionId ? { targetRegionId: handle.targetRegionId } : {}),
    };
  }

  private registerRegionHandleForSnapshot(
    session: AttachedSession,
    snapshot: StoredSnapshot,
    region: PageRegion,
  ): LiveHandleState {
    const locator = snapshot.regionLocatorById.get(region.regionId);
    return this.registerHandle(session, snapshot, {
      kind: "region",
      fingerprint: buildHandleFingerprint([
        "region",
        session.ref.tabId,
        region.role,
        region.name,
        region.textSummary,
        locator,
      ]),
      role: region.role,
      name: region.name,
      description: region.textSummary,
      locator,
      targetRegionId: region.regionId,
    });
  }

  private registerFormHandleForSnapshot(
    session: AttachedSession,
    snapshot: StoredSnapshot,
    form: PageForm,
  ): LiveHandleState {
    const locators = [
      snapshot.formLocatorById.get(form.formId),
      ...form.locatorHints,
    ];
    return this.registerHandle(session, snapshot, {
      kind: "form",
      fingerprint: buildHandleFingerprint([
        "form",
        session.ref.tabId,
        form.name,
        form.description,
        form.textSummary,
        locators[0],
        scopedIdTail(form.regionId),
      ]),
      role: "form",
      name: form.name,
      description: form.description ?? form.textSummary,
      locator: locators.find((entry) => Boolean(entry)),
      targetFormId: form.formId,
      targetRegionId: form.regionId,
    });
  }

  private registerElementHandleForSnapshot(
    session: AttachedSession,
    snapshot: StoredSnapshot,
    element: SemanticElement,
  ): LiveHandleState {
    const locators = [
      snapshot.elementLocatorById.get(element.elementId),
      ...(element.locatorHints ?? []),
    ];
    return this.registerHandle(session, snapshot, {
      kind: "element",
      fingerprint: buildHandleFingerprint([
        "element",
        session.ref.tabId,
        element.role,
        element.name,
        element.associatedLabel,
        element.text,
        locators[0],
        scopedIdTail(element.regionId),
        scopedIdTail(element.formId),
      ]),
      role: element.role,
      name: element.name,
      description: element.description ?? element.associatedLabel ?? element.text,
      locator: locators.find((entry) => Boolean(entry)),
      targetElementId: element.elementId,
      targetFormId: element.formId,
      targetRegionId: element.regionId,
    });
  }

  private buildProgressiveSnapshotModel(
    snapshotId: string,
    regions: PageRegion[],
    forms: PageForm[],
    elements: SemanticElement[],
  ): {
    elements: SemanticElement[];
    information: PageInformationBlock[];
    capabilities: PageCapability[];
  } {
    const formById = new Map(forms.map((form) => [form.formId, form]));
    const regionById = new Map(regions.map((region) => [region.regionId, region]));
    const submitElementIds = new Set(
      forms.flatMap((form) => form.submitActionElementIds.map((elementId) => elementId)),
    );

    const enrichedElements = elements.map((element) => {
      const profile = inferElementCapabilityProfile(
        element,
        element.formId ? formById.get(element.formId) : undefined,
        regionById.get(element.regionId),
        submitElementIds.has(element.elementId),
      );

      return {
        ...element,
        ...(profile.type ? { primaryCapabilityType: profile.type } : {}),
        ...(profile.actions.length ? { supportedActions: profile.actions } : {}),
        capabilityConfidence: profile.confidence,
        ...(profile.evidence.length ? { capabilityEvidence: profile.evidence } : {}),
      };
    });

    const elementsByRegion = new Map<string, SemanticElement[]>();
    const formsByRegion = new Map<string, PageForm[]>();
    for (const form of forms) {
      const bucket = formsByRegion.get(form.regionId) ?? [];
      bucket.push(form);
      formsByRegion.set(form.regionId, bucket);
    }
    for (const element of enrichedElements) {
      const bucket = elementsByRegion.get(element.regionId) ?? [];
      bucket.push(element);
      elementsByRegion.set(element.regionId, bucket);
    }

    const information = regions.map((region, index) => {
      const profile = inferRegionInformationProfile(
        region,
        elementsByRegion.get(region.regionId) ?? [],
        formsByRegion.get(region.regionId) ?? [],
      );

      return {
        blockId: `${snapshotId}:block-${index + 1}`,
        regionId: region.regionId,
        type: profile.type,
        bbox: region.bbox,
        inViewport: region.inViewport,
        confidence: Number(clampNumber(profile.confidence).toFixed(3)),
        ...(typeof profile.itemCount === "number" ? { itemCount: profile.itemCount } : {}),
        extractable: profile.extractable,
        sourceElementIds: Array.from(new Set(profile.sourceElementIds)).slice(0, 20),
        relatedCapabilityIds: [],
        ...(profile.title ? { title: profile.title } : {}),
        ...(profile.summary ? { summary: profile.summary } : {}),
      };
    });

    const blockIdsByRegion = new Map<string, string[]>();
    for (const block of information) {
      const bucket = blockIdsByRegion.get(block.regionId) ?? [];
      bucket.push(block.blockId);
      blockIdsByRegion.set(block.regionId, bucket);
    }

    const capabilities: PageCapability[] = [];
    for (const element of enrichedElements) {
      if (!element.primaryCapabilityType || (element.capabilityConfidence ?? 0) < 0.52) {
        continue;
      }
      capabilities.push({
        capabilityId: `${snapshotId}:capability-${capabilities.length + 1}`,
        regionId: element.regionId,
        ...(element.formId ? { formId: element.formId } : {}),
        elementId: element.elementId,
        type: element.primaryCapabilityType,
        ...(truncate(element.name ?? element.associatedLabel ?? element.text, 120)
          ? { title: truncate(element.name ?? element.associatedLabel ?? element.text, 120) }
          : {}),
        ...(element.associatedLabel ? { label: truncate(element.associatedLabel, 120) } : {}),
        ...(truncate(element.description ?? element.text, 160)
          ? { description: truncate(element.description ?? element.text, 160) }
          : {}),
        ...(element.bbox ? { bbox: element.bbox } : {}),
        visible: element.visible,
        enabled: element.enabled !== false,
        confidence: Number(clampNumber(element.capabilityConfidence ?? 0).toFixed(3)),
        actions: element.supportedActions ?? [],
        evidence: (element.capabilityEvidence ?? []).slice(0, 4),
        relatedBlockIds: blockIdsByRegion.get(element.regionId) ?? [],
      });
    }

    const capabilityIdsByRegion = new Map<string, string[]>();
    for (const capability of capabilities) {
      const bucket = capabilityIdsByRegion.get(capability.regionId) ?? [];
      bucket.push(capability.capabilityId);
      capabilityIdsByRegion.set(capability.regionId, bucket);
    }

    return {
      elements: enrichedElements,
      information: information.map((block) => ({
        ...block,
        relatedCapabilityIds: capabilityIdsByRegion.get(block.regionId) ?? [],
      })),
      capabilities,
    };
  }

  private resolveRegionLocator(sessionId: string, regionId: string): string | undefined {
    const snapshot = this.findSnapshotByRegionId(sessionId, regionId);
    if (!snapshot) {
      return undefined;
    }
    const region = snapshot.regions.find((entry) => matchesScopedId(entry.regionId, regionId));
    return region ? snapshot.regionLocatorById.get(region.regionId) : undefined;
  }

  private resolveFormLocator(sessionId: string, formId: string): string | undefined {
    const resolved = this.findSnapshotForm(sessionId, formId);
    return resolved ? resolved.snapshot.formLocatorById.get(resolved.form.formId) : undefined;
  }

  private resolveStepTargetBinding(
    sessionId: string,
    targetInput?: Record<string, unknown>,
    handle?: LiveHandleState,
  ): {
    targetElementId?: string;
    targetFormId?: string;
    targetDescriptor?: Record<string, unknown>;
  } {
    const explicitElementId = targetInput ? readString(targetInput, "elementId", false) : undefined;
    if (explicitElementId) {
      const context = this.buildElementActionContext(sessionId, explicitElementId);
      return {
        targetElementId: context.targetElementId,
        targetFormId: context.targetFormId,
        targetDescriptor: context.targetDescriptor,
      };
    }

    if (handle?.kind === "element" && handle.targetElementId) {
      const context = this.buildElementActionContext(sessionId, handle.targetElementId);
      return {
        targetElementId: context.targetElementId,
        targetFormId: context.targetFormId,
        targetDescriptor: context.targetDescriptor,
      };
    }

    const description = targetInput ? readString(targetInput, "description", false) : undefined;
    const selector = targetInput ? readString(targetInput, "selector", false) : undefined;
    const regionId = targetInput ? readString(targetInput, "regionId", false) : undefined;
    const formId = targetInput ? readString(targetInput, "formId", false) : undefined;

    const regionSelector = regionId
      ? this.resolveRegionLocator(sessionId, regionId)
      : handle?.kind === "region"
        ? handle.locator
        : undefined;
    const formSelector = formId
      ? this.resolveFormLocator(sessionId, formId)
      : handle?.kind === "form"
        ? handle.locator
        : undefined;
    const primarySelector = selector ?? handle?.locator ?? formSelector ?? regionSelector;
    const selectorHints = uniqueStrings([
      primarySelector,
      selector,
      handle?.locator,
      formSelector,
      regionSelector,
    ]);
    const textHints = uniqueStrings([
      description,
      handle?.name,
      handle?.description,
    ]);

    if (!primarySelector && !textHints.length && !regionSelector && !formSelector) {
      return {};
    }

    return {
      ...(handle?.kind === "form" && handle.targetFormId ? { targetFormId: handle.targetFormId } : {}),
      ...(formId ? { targetFormId: formId } : {}),
      targetDescriptor: {
        ...(primarySelector ? { selector: primarySelector } : {}),
        selectorHints,
        textHints,
        ...(handle?.name ? { name: handle.name } : {}),
        ...(handle?.description ? { text: handle.description } : {}),
        ...(handle?.role ? { role: handle.role } : {}),
        ...(regionSelector ? { regionSelector } : {}),
        ...(formSelector ? { formSelector } : {}),
      },
    };
  }

  private async evaluateInTab<T>(contentsId: number, expression: string): Promise<T> {
    await this.context.sendContentsCdpCommand(contentsId, "Runtime.enable");

    const response = await this.context.sendContentsCdpCommand<{
      result?: {
        value?: T;
      };
      exceptionDetails?: {
        text?: string;
      };
    }>(contentsId, "Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });

    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.text ?? "Runtime.evaluate failed.");
    }

    return (response.result?.value as T) ?? (undefined as T);
  }

  private async ensureLifecycleEventsEnabled(contentsId: number) {
    await this.context.sendContentsCdpCommand(contentsId, "Page.enable");
    try {
      await this.context.sendContentsCdpCommand(contentsId, "Page.setLifecycleEventsEnabled", {
        enabled: true,
      });
    } catch {
      // Some embedders may not expose lifecycle toggles; fallback to Page.enable only.
    }
  }

  private async ensureInputObservationBridge(
    contentsId: number,
    input?: {
      channels?: Set<string>;
      sampleMouseMove?: boolean;
    },
  ) {
    const inFlight = this.inputBridgeInstallInFlight.get(contentsId);
    if (inFlight) {
      await inFlight;
      return;
    }

    const channels = input?.channels;
    const bridgeConfig = {
      input: channels ? channels.has("input") : true,
      focus: channels ? channels.has("focus") : true,
      selection: channels ? channels.has("selection") : true,
      dom: channels ? channels.has("dom") : true,
      mousemove: Boolean(input?.sampleMouseMove && (!channels || channels.has("input"))),
    };
    const expression = `window.__miloInputBridgeConfig = ${JSON.stringify(bridgeConfig)};\n${INPUT_OBSERVATION_BRIDGE_EXPRESSION}`;

    const installPromise = (async () => {
      await this.context.sendContentsCdpCommand(contentsId, "Runtime.enable");
      await this.context.sendContentsCdpCommand(contentsId, "Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
    })()
      .catch(() => undefined)
      .finally(() => {
        this.inputBridgeInstallInFlight.delete(contentsId);
      });

    this.inputBridgeInstallInFlight.set(contentsId, installPromise);
    await installPromise;
  }

  private cleanupEndedCaptures() {
    const ended = Array.from(this.captures.values())
      .filter((capture) => Boolean(capture.stoppedAt))
      .sort((left, right) => (left.stoppedAt ?? 0) - (right.stoppedAt ?? 0));
    const overflow = ended.length - MAX_ENDED_CAPTURES;
    if (overflow <= 0) {
      return;
    }

    for (const capture of ended.slice(0, overflow)) {
      this.captures.delete(capture.captureId);
    }
  }

  private pruneActions() {
    const actions = Array.from(this.actions.values()).sort(
      (left, right) => left.performedAt - right.performedAt,
    );
    const overflow = actions.length - MAX_ACTIONS;
    if (overflow <= 0) {
      return;
    }

    for (const action of actions.slice(0, overflow)) {
      this.actions.delete(action.actionId);
    }
  }

  private pruneSnapshots() {
    const snapshots = Array.from(this.snapshots.values()).sort(
      (left, right) => left.capturedAt - right.capturedAt,
    );
    const overflow = snapshots.length - MAX_SNAPSHOTS;
    if (overflow <= 0) {
      return;
    }

    for (const snapshot of snapshots.slice(0, overflow)) {
      this.snapshots.delete(snapshot.snapshotId);
    }
  }

  private async attachSession(input: Record<string, unknown>) {
    const tabId = readString(input, "tabId") as string;
    const userId = readString(input, "userId", false);
    const observeOnly = readBoolean(input, "observeOnly", false);

    const tabContext = this.findTabContext(tabId);
    const sessionId = randomUUID();
    const attachedAt = Date.now();
    const leaseId = randomUUID();
    const ref: BrowserSessionRef = {
      sessionId,
      tabId,
      ...(userId ? { userId } : {}),
    };

    this.sessions.set(sessionId, {
      ref,
      workspaceId: tabContext.workspaceId,
      contentsId: tabContext.contentsId,
      attachedAt,
      leaseId,
      observeOnly,
    });

    return {
      session: ref,
      url: tabContext.webContents.getURL(),
      title: tabContext.webContents.getTitle(),
      attachedAt,
    };
  }

  private flattenFrameTree(
    node: Record<string, unknown> | undefined,
    output: Array<{ frameId: string; url: string }>,
  ) {
    if (!node) {
      return;
    }

    const frame = node.frame;
    if (frame && typeof frame === "object" && !Array.isArray(frame)) {
      const frameRecord = frame as Record<string, unknown>;
      const frameId = readString(frameRecord, "id", false);
      const url = readString(frameRecord, "url", false);

      if (frameId && url) {
        output.push({ frameId, url });
      }
    }

    const childFrames = node.childFrames;
    if (!Array.isArray(childFrames)) {
      return;
    }

    for (const child of childFrames) {
      if (!child || typeof child !== "object" || Array.isArray(child)) {
        continue;
      }
      this.flattenFrameTree(child as Record<string, unknown>, output);
    }
  }

  private async getPageContext(input: Record<string, unknown>) {
    const session = this.resolveSessionRef(input);
    const tabContext = this.findTabContext(session.ref.tabId);

    const metrics = await this.evaluateInTab<{
      width: number;
      height: number;
      scrollX: number;
      scrollY: number;
    }>(
      tabContext.contentsId,
      "(() => ({ width: window.innerWidth, height: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY }))()",
    );

    await this.context.sendContentsCdpCommand(tabContext.contentsId, "Page.enable");
    const frameTreeResponse = await this.context.sendContentsCdpCommand<{
      frameTree?: Record<string, unknown>;
    }>(tabContext.contentsId, "Page.getFrameTree");

    const frameTree: Array<{ frameId: string; url: string }> = [];
    this.flattenFrameTree(frameTreeResponse.frameTree, frameTree);

    return {
      url: tabContext.webContents.getURL(),
      title: tabContext.webContents.getTitle(),
      viewport: {
        width: Math.round(metrics.width),
        height: Math.round(metrics.height),
      },
      scroll: {
        x: metrics.scrollX,
        y: metrics.scrollY,
      },
      frameTree,
    };
  }

  private async contextAttach(input: Record<string, unknown>) {
    const tabId = readString(input, "tabId", false);

    if (!tabId) {
      const openResult = await this.openUrl(input);
      const session = this.resolveSessionRef({
        session: openResult.session as unknown as Record<string, unknown>,
      });
      const page = await this.buildPageRef(session);
      return {
        page,
        attachedAt: openResult.attachedAt,
        windowId: openResult.windowId,
        tabId: openResult.tabId,
        url: openResult.url,
        title: openResult.title,
        waitUntil: openResult.waitUntil,
        matched: openResult.matched,
        timedOut: openResult.timedOut,
        ...(typeof openResult.matchedEvent === "string" ? { matchedEvent: openResult.matchedEvent } : {}),
        createdTab: openResult.createdTab,
      };
    }

    const attachResult = await this.attachSession(input);
    let navigationResult: {
      url: string;
      title: string;
      waitUntil: "none" | "domcontentloaded" | "load" | "network_idle";
      matched: boolean;
      timedOut: boolean;
      matchedEvent?: string;
    };

    const url = readString(input, "url", false);
    if (url) {
      navigationResult = await this.navigate({
        session: attachResult.session,
        url,
        waitUntil: readString(input, "waitUntil", false) ?? "load",
        timeoutMs: Math.max(200, Math.floor(readNumber(input, "timeoutMs", false) ?? 10_000)),
      });
    } else {
      navigationResult = {
        url: attachResult.url,
        title: attachResult.title,
        waitUntil: "none",
        matched: true,
        timedOut: false,
      };
    }

    const session = this.resolveSessionRef({ session: attachResult.session });
    const page = await this.buildPageRef(session);
    const tabContext = this.findTabContext(tabId);

    return {
      page,
      attachedAt: attachResult.attachedAt,
      windowId: String(tabContext.windowId),
      tabId,
      url: navigationResult.url,
      title: navigationResult.title,
      waitUntil: navigationResult.waitUntil,
      matched: navigationResult.matched,
      timedOut: navigationResult.timedOut,
      ...(navigationResult.matchedEvent ? { matchedEvent: navigationResult.matchedEvent } : {}),
      createdTab: false,
    };
  }

  private async contextGet(input: Record<string, unknown>) {
    const { session, page } = await this.resolvePageInput(input, "page");
    const context = await this.getPageContext({ session: session.ref });
    return {
      page,
      ...context,
    };
  }

  private async pageOpen(input: Record<string, unknown>) {
    const attached = await this.contextAttach(input);
    const page = assertObject(attached.page, "page.open could not resolve the page reference.");
    const snapshot = await this.pageSnapshot({
      page,
      ...(readString(input, "task", false) ? { task: readString(input, "task", false) } : {}),
      ...(readNumber(input, "maxInformation", false) !== undefined
        ? { maxInformation: Math.floor(readNumber(input, "maxInformation", false) as number) }
        : {}),
      ...(readNumber(input, "maxCapabilities", false) !== undefined
        ? { maxCapabilities: Math.floor(readNumber(input, "maxCapabilities", false) as number) }
        : {}),
    });

    return {
      ...attached,
      snapshotId: snapshot.snapshotId,
      summary: snapshot.summary,
      information: snapshot.information,
      capabilities: snapshot.capabilities,
      drilldowns: snapshot.drilldowns,
    };
  }

  private async pageSnapshot(input: Record<string, unknown>) {
    const description = await this.contextDescribe(input);
    const page = assertObject(description.page, "page.snapshot could not resolve the page reference.");
    const context = await this.contextGet({ page });
    return {
      page: description.page,
      snapshotId: description.snapshotId,
      url: context.url,
      title: context.title,
      viewport: context.viewport,
      scroll: context.scroll,
      scope: description.scope,
      summary: description.summary,
      regions: description.regions,
      forms: description.forms,
      information: description.information,
      capabilities: description.capabilities,
      suggestedActions: description.suggestedActions,
      drilldowns: description.drilldowns,
    };
  }

  private async contextDescribe(input: Record<string, unknown>) {
    const { session, page } = await this.resolvePageInput(input, "page", {
      enforceDocumentId: true,
    });
    const snapshot = await this.captureStoredSnapshotForSession(session);
    const task = truncate(readString(input, "task", false), 200);
    const taskTokens = tokenizeTaskText(task);
    const maxRegions = Math.max(1, Math.min(8, Math.floor(readNumber(input, "maxRegions", false) ?? 5)));
    const maxForms = Math.max(0, Math.min(8, Math.floor(readNumber(input, "maxForms", false) ?? 4)));
    const maxActions = Math.max(1, Math.min(20, Math.floor(readNumber(input, "maxActions", false) ?? 8)));
    const maxInformation = Math.max(1, Math.min(12, Math.floor(readNumber(input, "maxInformation", false) ?? maxRegions)));
    const maxCapabilities = Math.max(1, Math.min(20, Math.floor(readNumber(input, "maxCapabilities", false) ?? maxActions)));
    const requestedRegionId = readString(input, "regionId", false);
    const requestedFormId = readString(input, "formId", false);
    const requestedBlockId = readString(input, "blockId", false);
    const requestedCapabilityId = readString(input, "capabilityId", false);

    const resolveRegion = (regionId: string) => snapshot.regions.find((entry) => matchesScopedId(entry.regionId, regionId));
    const resolveForm = (formId: string) => snapshot.forms.find((entry) => matchesScopedId(entry.formId, formId));
    const formById = new Map(snapshot.forms.map((form) => [form.formId, form]));
    const regionById = new Map(snapshot.regions.map((region) => [region.regionId, region]));
    const elementById = new Map(snapshot.elements.map((element) => [element.elementId, element]));
    const blockById = new Map(snapshot.information.map((block) => [block.blockId, block]));
    const capabilityById = new Map(snapshot.capabilities.map((capability) => [capability.capabilityId, capability]));
    const formsByRegion = new Map<string, PageForm[]>();
    const elementsByRegion = new Map<string, SemanticElement[]>();
    const submitFormIdByElementId = new Map<string, string>();

    for (const form of snapshot.forms) {
      const bucket = formsByRegion.get(form.regionId) ?? [];
      bucket.push(form);
      formsByRegion.set(form.regionId, bucket);
      for (const submitElementId of form.submitActionElementIds) {
        submitFormIdByElementId.set(submitElementId, form.formId);
      }
    }

    for (const element of snapshot.elements) {
      const regionBucket = elementsByRegion.get(element.regionId) ?? [];
      regionBucket.push(element);
      elementsByRegion.set(element.regionId, regionBucket);
    }

    let scopedRegion = requestedRegionId ? resolveRegion(requestedRegionId) : undefined;
    if (requestedRegionId && !scopedRegion) {
      throw new Error(`Region ${requestedRegionId} was not found in the current semantic snapshot.`);
    }

    let scopedForm = requestedFormId ? resolveForm(requestedFormId) : undefined;
    if (requestedFormId && !scopedForm) {
      throw new Error(`Form ${requestedFormId} was not found in the current semantic snapshot.`);
    }

    const scopedBlock = requestedBlockId ? blockById.get(requestedBlockId) : undefined;
    if (requestedBlockId && !scopedBlock) {
      throw new Error(`Information block ${requestedBlockId} was not found in the current semantic snapshot.`);
    }

    const scopedCapability = requestedCapabilityId ? capabilityById.get(requestedCapabilityId) : undefined;
    if (requestedCapabilityId && !scopedCapability) {
      throw new Error(`Capability ${requestedCapabilityId} was not found in the current semantic snapshot.`);
    }

    if (!scopedRegion && scopedBlock) {
      scopedRegion = resolveRegion(scopedBlock.regionId);
    }
    if (!scopedForm && scopedCapability?.formId) {
      scopedForm = resolveForm(scopedCapability.formId);
    }
    if (!scopedRegion && scopedCapability) {
      scopedRegion = resolveRegion(scopedCapability.regionId);
    }

    if (scopedForm) {
      const owningRegion = resolveRegion(scopedForm.regionId);
      if (!owningRegion) {
        throw new Error(`Region ${scopedForm.regionId} for form ${scopedForm.formId} was not found.`);
      }
      if (scopedRegion && !matchesScopedId(owningRegion.regionId, scopedRegion.regionId)) {
        throw new Error(`Form ${scopedForm.formId} does not belong to region ${scopedRegion.regionId}.`);
      }
      scopedRegion = owningRegion;
    }

    const scope: Record<string, unknown> = scopedForm
      ? {
          type: "form" as ContextScopeType,
          formId: scopedForm.formId,
          regionId: scopedForm.regionId,
          role: "form",
          ...(scopedForm.name ? { name: scopedForm.name } : {}),
        }
      : scopedRegion
        ? {
            type: "region" as ContextScopeType,
            regionId: scopedRegion.regionId,
            role: scopedRegion.role,
            ...(scopedRegion.name ? { name: scopedRegion.name } : {}),
          }
        : { type: "page" as ContextScopeType };

    const roleBaseScore = (role: RegionRole): number => {
      switch (role) {
        case "dialog":
          return 0.92;
        case "form":
          return 0.82;
        case "main":
          return 0.78;
        case "table":
        case "list":
          return 0.72;
        case "panel":
          return 0.56;
        case "sidebar":
        case "nav":
          return 0.32;
        case "header":
        case "footer":
          return 0.18;
        default:
          return 0.26;
      }
    };

    const isActionableElement = (element: SemanticElement): element is SemanticElement => {
      const actionType = inferPrincipalActionType(element);
      if (!actionType) {
        return false;
      }
      if (element.enabled === false) {
        return false;
      }
      if (!element.visible && !(scopedForm && matchesScopedId(element.formId, scopedForm.formId))) {
        return false;
      }
      if (
        element.isContainer
        && !(element.primaryCapabilityType && (element.capabilityConfidence ?? 0) >= 0.62)
        && element.tagName !== "button"
        && element.tagName !== "a"
        && element.tagName !== "input"
        && element.tagName !== "textarea"
        && element.tagName !== "select"
      ) {
        return false;
      }
      return true;
    };

    const rankActionElement = (element: SemanticElement, regionAttention = 0) => {
      const actionType = inferPrincipalActionType(element);
      if (!actionType) {
        return undefined;
      }

      const region = regionById.get(element.regionId);
      const form = element.formId ? formById.get(element.formId) : undefined;
      const taskScore = scoreTaskRelevance(
        taskTokens,
        task,
        element.name,
        element.associatedLabel,
        element.text,
        form?.name,
        form?.description,
        region?.name,
        region?.textSummary,
      );
      let score = element.interactivityScore + (element.capabilityConfidence ?? 0) * 0.3 + regionAttention * 0.18 + taskScore * 0.42;
      if (element.isPrimaryActionCandidate) {
        score += 0.18;
      }
      if (element.visible) {
        score += 0.05;
      }
      if (element.enabled !== false) {
        score += 0.05;
      }
      if (element.isHitTestable) {
        score += 0.08;
      }
      if (submitFormIdByElementId.has(element.elementId)) {
        score += 0.1;
      }

      const reasons = uniqueStrings([
        actionType === "type"
          ? "Accepts direct text input."
          : actionType === "select"
            ? "Supports option selection."
            : "Clickable immediate target.",
        element.isPrimaryActionCandidate ? "Marked as a primary action candidate." : undefined,
        taskScore >= 0.18 ? "Matches the current task hint." : undefined,
        submitFormIdByElementId.has(element.elementId)
          ? `Acts as a submit target for ${truncate(formById.get(submitFormIdByElementId.get(element.elementId) ?? "")?.name ?? "a form", 40)}.`
          : undefined,
        ...(element.capabilityEvidence ?? []).slice(0, 2),
        region ? `Located in ${describeRegionLabel(region)}.` : undefined,
      ]).slice(0, 3);

      return {
        element,
        actionType,
        score,
        confidence: Number(clampNumber(score / 1.65).toFixed(3)),
        reasons,
      };
    };

    const candidateRegions = scopedRegion
      ? [scopedRegion]
      : snapshot.regions.filter((region) => region.inViewport || region.role === "dialog" || region.role === "main");
    const fallbackRegions = candidateRegions.length ? candidateRegions : snapshot.regions.slice(0, maxRegions);

    const rankedRegions = fallbackRegions
      .map((region) => {
        const regionForms = (formsByRegion.get(region.regionId) ?? []).filter((form) =>
          !scopedForm || matchesScopedId(form.formId, scopedForm.formId),
        );
        const regionElements = (elementsByRegion.get(region.regionId) ?? []).filter((element) =>
          !scopedForm || matchesScopedId(element.formId, scopedForm.formId),
        );
        const actionableElements = regionElements.filter(isActionableElement);
        const taskScore = scoreTaskRelevance(
          taskTokens,
          task,
          region.name,
          region.textSummary,
          ...regionForms.flatMap((form) => [form.name, form.description, form.textSummary]),
          ...actionableElements.slice(0, 12).flatMap((element) => [element.name, element.associatedLabel, element.text]),
        );

        let attention = roleBaseScore(region.role) + taskScore * 0.4;
        if (region.inViewport) {
          attention += 0.08;
        }
        attention += Math.min(0.18, actionableElements.length * 0.03);
        attention += Math.min(0.16, regionForms.length * 0.06);
        if (scopedRegion && matchesScopedId(region.regionId, scopedRegion.regionId)) {
          attention += 0.32;
        }
        if (scopedForm && regionForms.some((form) => matchesScopedId(form.formId, scopedForm.formId))) {
          attention += 0.2;
        }

        const topActionElements = actionableElements
          .map((element) => rankActionElement(element, attention))
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
          .sort((left, right) => right.score - left.score)
          .slice(0, 3);

        return {
          region,
          regionForms,
          actionableElements,
          attention: Number(attention.toFixed(3)),
          topActionElements,
          canExtractRecords: Boolean(
            inferRecordSourceRole(region)
            && (region.childElementIds.length >= 3 || actionableElements.length >= 2 || regionForms.length > 0)
          ),
        };
      })
      .sort((left, right) => right.attention - left.attention);

    const selectedRegions = rankedRegions.slice(0, scopedRegion ? 1 : maxRegions);
    const selectedRegionIds = new Set(selectedRegions.map((entry) => entry.region.regionId));
    const regionAttentionById = new Map(selectedRegions.map((entry) => [entry.region.regionId, entry.attention]));

    const candidateForms = (scopedForm ? [scopedForm] : snapshot.forms)
      .filter((form) => {
        if (scopedRegion && !matchesScopedId(form.regionId, scopedRegion.regionId)) {
          return false;
        }
        if (!scopedRegion && selectedRegionIds.size > 0 && !selectedRegionIds.has(form.regionId)) {
          return false;
        }
        return form.inViewport || Boolean(scopedRegion) || Boolean(scopedForm);
      });

    const rankedForms = candidateForms
      .map((form) => {
        const region = regionById.get(form.regionId);
        const taskScore = scoreTaskRelevance(
          taskTokens,
          task,
          form.name,
          form.description,
          form.textSummary,
          region?.name,
          region?.textSummary,
        );
        let score = taskScore * 0.46 + (regionAttentionById.get(form.regionId) ?? 0) * 0.18;
        if (form.inViewport) {
          score += 0.14;
        }
        score += Math.min(0.18, form.controlElementIds.length * 0.03);
        score += Math.min(0.16, form.submitActionElementIds.length * 0.08);
        if (scopedForm && matchesScopedId(form.formId, scopedForm.formId)) {
          score += 0.4;
        }

        return {
          form,
          score,
        };
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, scopedForm ? 1 : maxForms);

    const selectedForms = rankedForms.map((entry) => entry.form);

    const actionScopeElements = snapshot.elements.filter((element) => {
      if (!isActionableElement(element)) {
        return false;
      }
      if (scopedForm) {
        return matchesScopedId(element.formId, scopedForm.formId);
      }
      if (scopedRegion) {
        return matchesScopedId(element.regionId, scopedRegion.regionId);
      }
      if (selectedRegionIds.size > 0 && !selectedRegionIds.has(element.regionId)) {
        return false;
      }
      return true;
    });

    const rankedActions = actionScopeElements
      .map((element) => rankActionElement(element, regionAttentionById.get(element.regionId) ?? 0))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .sort((left, right) => right.score - left.score)
      .slice(0, maxActions);

    const rankedInformation = snapshot.information
      .filter((block) => {
        if (scopedForm) {
          return matchesScopedId(block.regionId, scopedForm.regionId);
        }
        if (scopedRegion) {
          return matchesScopedId(block.regionId, scopedRegion.regionId);
        }
        if (selectedRegionIds.size > 0 && !selectedRegionIds.has(block.regionId)) {
          return false;
        }
        return true;
      })
      .map((block) => {
        const region = regionById.get(block.regionId);
        const taskScore = scoreTaskRelevance(
          taskTokens,
          task,
          block.title,
          block.summary,
          region?.name,
          region?.textSummary,
        );
        let score = block.confidence + (regionAttentionById.get(block.regionId) ?? 0) * 0.24 + taskScore * 0.44;
        if (scopedBlock && scopedBlock.blockId === block.blockId) {
          score += 0.35;
        }
        return { block, score };
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, maxInformation);

    const rankedCapabilities = snapshot.capabilities
      .filter((capability) => {
        if (scopedForm) {
          return matchesScopedId(capability.formId, scopedForm.formId);
        }
        if (scopedRegion) {
          return matchesScopedId(capability.regionId, scopedRegion.regionId);
        }
        if (selectedRegionIds.size > 0 && !selectedRegionIds.has(capability.regionId)) {
          return false;
        }
        return true;
      })
      .map((capability) => {
        const region = regionById.get(capability.regionId);
        const form = capability.formId ? formById.get(capability.formId) : undefined;
        const taskScore = scoreTaskRelevance(
          taskTokens,
          task,
          capability.title,
          capability.label,
          capability.description,
          form?.name,
          region?.name,
          region?.textSummary,
        );
        let score = capability.confidence + (regionAttentionById.get(capability.regionId) ?? 0) * 0.22 + taskScore * 0.46;
        if (scopedCapability && scopedCapability.capabilityId === capability.capabilityId) {
          score += 0.35;
        }
        return { capability, score };
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, maxCapabilities);

    const regionHandleById = new Map<string, LiveHandleState>();
    const regionOutputs = selectedRegions.map(({ region, regionForms, actionableElements, topActionElements, attention, canExtractRecords }) => {
      const regionHandle = this.registerRegionHandleForSnapshot(session, snapshot, region);
      regionHandleById.set(region.regionId, regionHandle);
      return {
        handleId: regionHandle.handleId,
        regionId: region.regionId,
        role: region.role,
        ...(region.name ? { name: region.name } : {}),
        bbox: region.bbox,
        inViewport: region.inViewport,
        ...(region.textSummary ? { textSummary: region.textSummary } : {}),
        attentionScore: attention,
        actionCount: actionableElements.length,
        formCount: regionForms.length,
        primaryActionElementIds: topActionElements.map((entry) => entry.element.elementId),
        primaryFormIds: regionForms.slice(0, 3).map((form) => form.formId),
        canExtractRecords,
      };
    });

    const formOutputs = selectedForms.map((form) => {
      const formHandle = this.registerFormHandleForSnapshot(session, snapshot, form);
      const submitElement = form.submitActionElementIds
        .map((elementId) => snapshot.elements.find((entry) => entry.elementId === elementId))
        .find((entry): entry is SemanticElement => Boolean(entry));
      const submitActionHandle = submitElement
        ? this.registerElementHandleForSnapshot(session, snapshot, submitElement)
        : undefined;

      return {
        handleId: formHandle.handleId,
        formId: form.formId,
        regionId: form.regionId,
        ...(form.name ? { name: form.name } : {}),
        ...(form.description ? { description: form.description } : {}),
        ...(form.method ? { method: form.method } : {}),
        ...(form.action ? { action: form.action } : {}),
        bbox: form.bbox,
        inViewport: form.inViewport,
        ...(form.textSummary ? { textSummary: form.textSummary } : {}),
        controlCount: form.controlElementIds.length,
        submitActionCount: form.submitActionElementIds.length,
        ...(submitActionHandle ? { submitActionHandleId: submitActionHandle.handleId } : {}),
      };
    });

    const informationOutputs = rankedInformation.map(({ block }) => ({
      ...block,
      ...(regionHandleById.get(block.regionId) ? { regionHandleId: regionHandleById.get(block.regionId)?.handleId } : {}),
    }));

    const capabilityOutputs = rankedCapabilities.map(({ capability }) => {
      let handleId: string | undefined;
      if (capability.elementId) {
        const element = elementById.get(capability.elementId);
        if (element) {
          handleId = this.registerElementHandleForSnapshot(session, snapshot, element).handleId;
        }
      } else if (capability.formId) {
        const form = formById.get(capability.formId);
        if (form) {
          handleId = this.registerFormHandleForSnapshot(session, snapshot, form).handleId;
        }
      }

      return {
        ...capability,
        ...(handleId ? { handleId } : {}),
      };
    });

    const actionOutputs = rankedActions.map(({ element, actionType, confidence, reasons }) => {
      const elementHandle = this.registerElementHandleForSnapshot(session, snapshot, element);
      const submitActionForFormId = submitFormIdByElementId.get(element.elementId);
      return {
        handleId: elementHandle.handleId,
        elementId: element.elementId,
        regionId: element.regionId,
        ...(element.formId ? { formId: element.formId } : {}),
        actionType,
        role: element.role,
        ...(element.name ? { name: element.name } : {}),
        ...(element.associatedLabel ? { label: element.associatedLabel } : {}),
        ...(element.text ? { text: element.text } : {}),
        ...(element.bbox ? { bbox: element.bbox } : {}),
        visible: element.visible,
        enabled: element.enabled !== false,
        confidence,
        reasons,
        ...(submitActionForFormId ? { submitActionForFormId } : {}),
      };
    });

    const suggestedActions = actionOutputs
      .slice(0, 4)
      .map((action) => ({
        actionType: action.actionType,
        targetRegionId: action.regionId,
        targetElementId: action.elementId,
        confidence: action.confidence,
        reasons: action.reasons,
        risk:
          action.actionType === "type"
            ? "low"
            : action.submitActionForFormId
              ? "medium"
              : "low",
      }));

    const drilldowns: Array<Record<string, unknown>> = [];
    const seenDrilldowns = new Set<string>();
    const pushDrilldown = (label: string, tool: string, reason: string, args: Record<string, unknown>) => {
      const key = `${tool}:${label}:${JSON.stringify(args)}`;
      if (seenDrilldowns.has(key)) {
        return;
      }
      seenDrilldowns.add(key);
      drilldowns.push({
        label,
        tool,
        reason,
        arguments: args,
      });
    };

    if (!scopedForm) {
      for (const region of regionOutputs.slice(0, 3)) {
        if (scopedRegion && matchesScopedId(region.regionId, scopedRegion.regionId)) {
          continue;
        }
        pushDrilldown(
          `Inspect ${describeRegionLabel({ regionId: region.regionId, role: region.role as RegionRole, name: typeof region.name === "string" ? region.name : undefined })}`,
          "page.snapshot",
          "Narrow the scene to this region and expose more local information and capabilities.",
          {
            page,
            regionId: region.regionId,
            ...(task ? { task } : {}),
            maxForms,
            maxActions,
            maxInformation,
            maxCapabilities,
          },
        );
      }
    }

    for (const form of formOutputs.slice(0, 2)) {
      if (scopedForm && matchesScopedId(form.formId, scopedForm.formId)) {
        continue;
      }
      pushDrilldown(
        `Inspect form ${truncate(typeof form.name === "string" ? form.name : scopedIdTail(form.formId) ?? form.formId, 40)}`,
        "page.snapshot",
        "Drill into this form to inspect its fields, information context, and submit path.",
        {
          page,
          formId: form.formId,
          ...(task ? { task } : {}),
          maxActions,
          maxCapabilities,
        },
      );
    }

    for (const region of regionOutputs.filter((entry) => entry.canExtractRecords).slice(0, 2)) {
      const resolvedRegion = regionById.get(region.regionId);
      const sourceRole = resolvedRegion ? inferRecordSourceRole(resolvedRegion) : undefined;
      if (!sourceRole) {
        continue;
      }
      pushDrilldown(
        `Extract records from ${describeRegionLabel({ regionId: region.regionId, role: region.role as RegionRole, name: typeof region.name === "string" ? region.name : undefined })}`,
        "page.extract",
        "This region looks structured enough for repeated-record extraction.",
        {
          page,
          regionId: region.regionId,
          mode: "records",
          sourceRole,
        },
      );
    }

    const locateScopeArgs = scopedForm
      ? { page, formId: scopedForm.formId, maxCapabilities: Math.max(8, maxCapabilities) }
      : scopedRegion
        ? { page, regionId: scopedRegion.regionId, maxCapabilities: Math.max(8, maxCapabilities) }
        : regionOutputs[0]
          ? { page, regionId: regionOutputs[0].regionId, maxCapabilities: Math.max(8, maxCapabilities) }
          : undefined;
    if (locateScopeArgs) {
      pushDrilldown(
        scopedForm
          ? "Reveal more form capabilities"
          : scopedRegion
            ? "Reveal more region capabilities"
            : "Reveal more precise capabilities",
        "page.snapshot",
        "Expand the scoped capability list without exposing the full page again.",
        locateScopeArgs,
      );
    }

    const topRegion = regionOutputs[0];
    const topInformation = informationOutputs[0];
    const topCapability = capabilityOutputs[0];
    const topAction = actionOutputs[0];
    const extractionRegion = regionOutputs.find((entry) => entry.canExtractRecords);
    const summaryParts = [
      scopedForm
        ? `Scoped to form ${truncate(scopedForm.name ?? scopedIdTail(scopedForm.formId) ?? scopedForm.formId, 48)}.`
        : scopedRegion
          ? `Scoped to region ${describeRegionLabel(scopedRegion)}.`
          : "Scoped to the current page.",
      `Found ${regionOutputs.length} salient regions, ${formOutputs.length} forms, ${informationOutputs.length} information blocks, and ${capabilityOutputs.length} capability blocks.`,
      topRegion ? `Primary focus appears to be ${describeRegionLabel({ regionId: topRegion.regionId, role: topRegion.role as RegionRole, name: typeof topRegion.name === "string" ? topRegion.name : undefined })}.` : undefined,
      topInformation ? `Primary information appears to be ${topInformation.type}${topInformation.title ? `: ${topInformation.title}` : ""}.` : undefined,
      topCapability ? `Top capability appears to be ${topCapability.type}${topCapability.title ? `: ${topCapability.title}` : ""}.` : undefined,
      topAction ? `Top immediate target: ${topAction.actionType} ${describeElementLabel({ elementId: topAction.elementId, role: topAction.role as ElementRole, name: typeof topAction.name === "string" ? topAction.name : undefined, associatedLabel: typeof topAction.label === "string" ? topAction.label : undefined, text: typeof topAction.text === "string" ? topAction.text : undefined })}.` : undefined,
      extractionRegion ? `Structured record extraction is likely from ${describeRegionLabel({ regionId: extractionRegion.regionId, role: extractionRegion.role as RegionRole, name: typeof extractionRegion.name === "string" ? extractionRegion.name : undefined })}.` : undefined,
    ];
    if (task) {
      summaryParts.unshift(`Task hint: ${truncate(task, 80)}.`);
    }

    return {
      page,
      snapshotId: snapshot.snapshotId,
      scope,
      summary: summaryParts.filter((part): part is string => Boolean(part)).join(" "),
      regions: regionOutputs,
      forms: formOutputs,
      information: informationOutputs,
      capabilities: capabilityOutputs,
      actions: actionOutputs,
      suggestedActions,
      drilldowns,
    };
  }

  private async contextSubscribe(input: Record<string, unknown>) {
    const { session, page } = await this.resolvePageInput(input, "page");
    const subscription = await this.startEventCapture({
      session: session.ref,
      channels: readArray(input, "channels"),
      sampleMouseMove: readBoolean(input, "sampleMouseMove", false),
      redactTextInput: readBoolean(input, "redactTextInput", true),
    });
    const capture = this.captures.get(subscription.captureId);
    if (!capture) {
      throw new Error(`Capture ${subscription.captureId} not found after subscribe.`);
    }

    return {
      subscription: this.buildSubscriptionState(capture, page),
    };
  }

  private async contextRead(input: Record<string, unknown>) {
    const subscriptionId = readString(input, "subscriptionId") as string;
    const capture = this.captures.get(subscriptionId);
    if (!capture) {
      throw new Error(`Subscription ${subscriptionId} not found.`);
    }

    const limit = Math.max(1, Math.floor(readNumber(input, "limit", false) ?? 200));
    const cursor = parseStructuredCursor(input.cursor, subscriptionId);
    const earliestAvailableSeq = capture.events[0]?.seq ?? (capture.lastSeq + 1);
    const dropped = Boolean(capture.droppedEvents > 0 && (!cursor || cursor.seq < earliestAvailableSeq));

    const filtered = capture.events
      .filter((event) => {
        if (cursor) {
          if (event.ts > cursor.ts) {
            return true;
          }
          if (event.ts < cursor.ts) {
            return false;
          }
          return (event.seq ?? 0) > cursor.seq;
        }
        return true;
      })
      .sort((left, right) => {
        if (left.ts !== right.ts) {
          return left.ts - right.ts;
        }
        return (left.seq ?? 0) - (right.seq ?? 0);
      })
      .slice(0, limit);

    const nextCursor = filtered.length
      ? toStructuredCursor(subscriptionId, filtered[filtered.length - 1], dropped)
      : undefined;
    const enrichedEvents = await this.enrichReturnedEvents(capture, filtered);

    return {
      subscriptionId,
      events: enrichedEvents.map((event) => toPublicRawEvent(event)),
      dropped,
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  private async contextUnsubscribe(input: Record<string, unknown>) {
    const subscriptionId = readString(input, "subscriptionId") as string;
    const stopped = await this.stopEventCapture({
      captureId: subscriptionId,
    });
    return {
      subscriptionId,
      stoppedAt: stopped.stoppedAt,
      eventCount: stopped.eventCount,
    };
  }

  private async locateFind(input: Record<string, unknown>) {
    const { session, page } = await this.resolvePageInput(input, "page", {
      enforceDocumentId: true,
    });
    const snapshot = await this.captureStoredSnapshotForSession(session);
    const kind = (readString(input, "kind", false) ?? "element") as HandleKind;
    const includeHidden = readBoolean(input, "includeHidden", false);
    const limit = Math.max(1, Math.floor(readNumber(input, "limit", false) ?? 5));
    const roleFilter = normalizeComparableText(readString(input, "role", false));
    const nameFilter = normalizeComparableText(readString(input, "name", false));
    const textFilter = normalizeComparableText(readString(input, "text", false));
    const labelFilter = normalizeComparableText(readString(input, "label", false));
    const selectorFilter = normalizeComparableText(readString(input, "selector", false));
    const regionId = readString(input, "regionId", false);
    const formId = readString(input, "formId", false);

    const scoreMatch = (...values: Array<string | undefined>) => {
      let score = 0;
      const normalized = values.map((value) => normalizeComparableText(value));
      if (nameFilter && normalized.some((value) => value.includes(nameFilter))) {
        score += 1.2;
      }
      if (textFilter && normalized.some((value) => value.includes(textFilter))) {
        score += 1;
      }
      if (labelFilter && normalized.some((value) => value.includes(labelFilter))) {
        score += 0.9;
      }
      return score;
    };

    const ranked: Array<{ score: number; handle: LiveHandleState }> = [];

    if (kind === "element") {
      for (const element of snapshot.elements) {
        if (!includeHidden && !element.visible) {
          continue;
        }
        if (roleFilter && normalizeComparableText(element.role) !== roleFilter) {
          continue;
        }
        if (regionId && !matchesScopedId(element.regionId, regionId)) {
          continue;
        }
        if (formId && !matchesScopedId(element.formId, formId)) {
          continue;
        }
        const locators = [
          snapshot.elementLocatorById.get(element.elementId),
          ...(element.locatorHints ?? []),
        ];
        if (
          selectorFilter
          && !locators.some((locator) => normalizeComparableText(locator).includes(selectorFilter))
        ) {
          continue;
        }

        const score = element.interactivityScore
          + scoreMatch(element.name, element.text, element.associatedLabel, element.description);
        const fingerprint = buildHandleFingerprint([
          "element",
          session.ref.tabId,
          element.role,
          element.name,
          element.associatedLabel,
          element.text,
          locators[0],
          scopedIdTail(element.regionId),
          scopedIdTail(element.formId),
        ]);
        ranked.push({
          score,
          handle: this.registerHandle(session, snapshot, {
            kind: "element",
            fingerprint,
            role: element.role,
            name: element.name,
            description: element.description ?? element.associatedLabel ?? element.text,
            locator: locators.find((entry) => Boolean(entry)),
            targetElementId: element.elementId,
            targetFormId: element.formId,
            targetRegionId: element.regionId,
          }),
        });
      }
    } else if (kind === "form") {
      for (const form of snapshot.forms) {
        if (!includeHidden && !form.inViewport) {
          continue;
        }
        if (regionId && !matchesScopedId(form.regionId, regionId)) {
          continue;
        }
        const locators = [
          snapshot.formLocatorById.get(form.formId),
          ...form.locatorHints,
        ];
        if (
          selectorFilter
          && !locators.some((locator) => normalizeComparableText(locator).includes(selectorFilter))
        ) {
          continue;
        }
        const score = 0.6 + scoreMatch(form.name, form.description, form.textSummary);
        const fingerprint = buildHandleFingerprint([
          "form",
          session.ref.tabId,
          form.name,
          form.description,
          form.textSummary,
          locators[0],
          scopedIdTail(form.regionId),
        ]);
        ranked.push({
          score,
          handle: this.registerHandle(session, snapshot, {
            kind: "form",
            fingerprint,
            role: "form",
            name: form.name,
            description: form.description ?? form.textSummary,
            locator: locators.find((entry) => Boolean(entry)),
            targetFormId: form.formId,
            targetRegionId: form.regionId,
          }),
        });
      }
    } else {
      for (const region of snapshot.regions) {
        if (!includeHidden && !region.inViewport) {
          continue;
        }
        if (roleFilter && normalizeComparableText(region.role) !== roleFilter) {
          continue;
        }
        const locator = snapshot.regionLocatorById.get(region.regionId);
        if (
          selectorFilter
          && !normalizeComparableText(locator).includes(selectorFilter)
        ) {
          continue;
        }
        const score = 0.4 + scoreMatch(region.name, region.textSummary);
        const fingerprint = buildHandleFingerprint([
          "region",
          session.ref.tabId,
          region.role,
          region.name,
          region.textSummary,
          locator,
        ]);
        ranked.push({
          score,
          handle: this.registerHandle(session, snapshot, {
            kind: "region",
            fingerprint,
            role: region.role,
            name: region.name,
            description: region.textSummary,
            locator,
            targetRegionId: region.regionId,
          }),
        });
      }
    }

    const sorted = ranked
      .sort((left, right) => right.score - left.score)
      .map((entry) => entry.handle);
    const selected = sorted.slice(0, limit);

    return {
      page,
      snapshotId: snapshot.snapshotId,
      handles: selected.map((handle) => this.buildLiveHandleOutput(handle, page)),
      truncated: sorted.length > selected.length,
    };
  }

  private async extractRecords(input: Record<string, unknown>) {
    const { session, page } = await this.resolvePageInput(input, "page", {
      enforceDocumentId: true,
    });
    const handleId = readString(input, "handleId", false);
    const handle = handleId ? this.getHandle(handleId) : undefined;
    if (handle && handle.sessionId !== session.ref.sessionId) {
      throw new Error(`Handle ${handleId} does not belong to the provided page session.`);
    }

    const sourceRole = readString(input, "sourceRole", false) ?? "auto";
    const regionId = readString(input, "regionId", false)
      ?? (handle?.kind === "region" ? handle.targetRegionId : handle?.targetRegionId);
    const formId = readString(input, "formId", false)
      ?? (handle?.kind === "form" ? handle.targetFormId : handle?.targetFormId);
    const extraction = await this.extractStructuredRecords(session, {
      snapshotId: handle?.snapshotId,
      extraction: {
        type: "records",
        ...(regionId ? { regionId } : {}),
        ...(formId ? { formId } : {}),
        sourceRole,
        ...(readNumber(input, "minRecords", false) !== undefined
          ? { minRecords: Math.floor(readNumber(input, "minRecords", false) as number) }
          : {}),
        ...(readNumber(input, "maxRecords", false) !== undefined
          ? { maxRecords: Math.floor(readNumber(input, "maxRecords", false) as number) }
          : {}),
        ...(isRecord(input.recordSchema) ? { recordSchema: input.recordSchema } : {}),
      },
    });

    return {
      page,
      snapshotId: session.latestSnapshotId ?? handle?.snapshotId ?? "",
      ...(extraction.sourceRegionId ? { sourceRegionId: extraction.sourceRegionId } : {}),
      ...(extraction.sourceRole ? { sourceRole: extraction.sourceRole } : {}),
      recordCount: extraction.recordCount,
      records: extraction.records,
      ...(typeof extraction.schemaValid === "boolean" ? { schemaValid: extraction.schemaValid } : {}),
      ...(extraction.validationErrors ? { validationErrors: extraction.validationErrors } : {}),
    };
  }

  private async pageExtract(input: Record<string, unknown>) {
    const { session, page } = await this.resolvePageInput(input, "page", {
      enforceDocumentId: true,
    });
    const blockId = readString(input, "blockId", false);
    const explicitRegionId = readString(input, "regionId", false);
    const explicitFormId = readString(input, "formId", false);
    const modeInput = readString(input, "mode", false) ?? "auto";
    const blockResolution = blockId
      ? this.findSnapshotInformationBlock(session.ref.sessionId, blockId)
      : undefined;
    if (blockId && !blockResolution) {
      throw new Error(`Information block ${blockId} was not found for the current page session.`);
    }

    const snapshot = blockResolution?.snapshot
      ?? (explicitRegionId ? this.findSnapshotByRegionId(session.ref.sessionId, explicitRegionId) : undefined)
      ?? (session.latestSnapshotId ? this.getSnapshot(session.latestSnapshotId) : undefined)
      ?? await this.captureStoredSnapshotForSession(session);

    if (snapshot.sessionId !== session.ref.sessionId) {
      throw new Error("Resolved snapshot does not belong to the provided page session.");
    }

    const block = blockResolution?.block;
    const regionId = explicitRegionId ?? block?.regionId;
    const formId = explicitFormId;
    const inferredSourceRole = readString(input, "sourceRole", false)
      ?? (block?.type === "table"
        ? "table"
        : block?.type === "list"
          ? "list"
          : block?.type === "card_group"
            ? "panel"
            : block?.type === "article"
              ? "main"
              : block?.type === "text"
                ? "panel"
                : block?.type === "metric_group"
                  ? "panel"
                  : block?.type === "image"
                    ? "panel"
                    : "auto");
    const appliedMode = modeInput === "auto"
      ? block?.extractable || inferredSourceRole === "table" || inferredSourceRole === "list"
        ? "records"
        : block?.type === "image"
          ? "images"
          : "text"
      : modeInput;

    if (appliedMode === "records") {
      const extraction = await this.extractStructuredRecords(session, {
        snapshotId: snapshot.snapshotId,
        extraction: {
          type: "records",
          ...(regionId ? { regionId } : {}),
          ...(formId ? { formId } : {}),
          sourceRole: inferredSourceRole,
          maxRecords: Math.max(1, Math.floor(readNumber(input, "maxItems", false) ?? 50)),
          ...(isRecord(input.recordSchema) ? { recordSchema: input.recordSchema } : {}),
        },
      });

      return {
        page,
        snapshotId: snapshot.snapshotId,
        source: {
          ...(block ? { blockId: block.blockId } : {}),
          ...(regionId ? { regionId } : {}),
          ...(formId ? { formId } : {}),
          ...(block?.type ? { type: block.type } : {}),
          mode: "records",
        },
        recordCount: extraction.recordCount,
        records: extraction.records,
        ...(typeof extraction.schemaValid === "boolean" ? { schemaValid: extraction.schemaValid } : {}),
        ...(extraction.validationErrors ? { validationErrors: extraction.validationErrors } : {}),
      };
    }

    const regionSelector = regionId ? snapshot.regionLocatorById.get(regionId) : undefined;
    const formSelector = formId ? snapshot.formLocatorById.get(formId) : undefined;
    const extracted = await this.evaluateInTab<{ text?: string; images?: Array<Record<string, unknown>> }>(
      session.contentsId,
      this.buildScopedContentExtractionExpression({
        mode: appliedMode,
        regionSelector,
        formSelector,
        maxItems: Math.max(1, Math.floor(readNumber(input, "maxItems", false) ?? 20)),
      }),
    );

    return {
      page,
      snapshotId: snapshot.snapshotId,
      source: {
        ...(block ? { blockId: block.blockId } : {}),
        ...(regionId ? { regionId } : {}),
        ...(formId ? { formId } : {}),
        ...(block?.type ? { type: block.type } : {}),
        mode: appliedMode,
      },
      ...(appliedMode === "images"
        ? {
            images: Array.isArray(extracted.images)
              ? extracted.images.filter((entry): entry is Record<string, unknown> => isRecord(entry))
              : [],
          }
        : {
            text: typeof extracted.text === "string" ? extracted.text : "",
          }),
    };
  }

  private async pageInteract(input: Record<string, unknown>) {
    const { session, page } = await this.resolvePageInput(input, "page", {
      enforceDocumentId: true,
    });
    const capabilityId = readString(input, "capabilityId", false);
    const handleId = readString(input, "handleId", false);
    const actionInput = isRecord(input.action) ? input.action : {};
    const waitInput = isRecord(input.wait) ? input.wait : undefined;

    const resolvedCapability = capabilityId
      ? this.findSnapshotCapability(session.ref.sessionId, capabilityId)
      : undefined;
    if (capabilityId && !resolvedCapability) {
      throw new Error(`Capability ${capabilityId} was not found for the current page session.`);
    }

    let target: Record<string, unknown> | undefined;
    if (handleId) {
      target = { handleId };
    } else if (resolvedCapability?.capability.elementId) {
      const element = resolvedCapability.snapshot.elements.find((entry) => entry.elementId === resolvedCapability.capability.elementId);
      if (element) {
        target = {
          handleId: this.registerElementHandleForSnapshot(session, resolvedCapability.snapshot, element).handleId,
        };
      }
    } else if (resolvedCapability?.capability.formId) {
      const form = resolvedCapability.snapshot.forms.find((entry) => entry.formId === resolvedCapability.capability.formId);
      if (form) {
        target = {
          handleId: this.registerFormHandleForSnapshot(session, resolvedCapability.snapshot, form).handleId,
        };
      }
    }

    let actionType = readString(actionInput, "type", false)
      ?? resolvedCapability?.capability.actions[0];

    if (!actionType) {
      throw new Error("page.interact requires action.type or a capabilityId with a default action.");
    }

    const action: Record<string, unknown> = {
      type: actionType,
      force: readBoolean(actionInput, "force", false),
    };

    if (actionType === "type") {
      const text = readString(actionInput, "text", false);
      if (!text) {
        throw new Error("type interactions require action.text.");
      }
      action.text = text;
    } else if (actionType === "select") {
      const value = readString(actionInput, "value", false);
      if (!value) {
        throw new Error("select interactions require action.value.");
      }
      action.value = value;
    } else if (actionType === "press") {
      const key = readString(actionInput, "key", false);
      if (!key) {
        throw new Error("press interactions require action.key.");
      }
      action.key = key;
      const code = readString(actionInput, "code", false);
      if (code) {
        action.code = code;
      }
      action.ctrlKey = readBoolean(actionInput, "ctrlKey", false);
      action.altKey = readBoolean(actionInput, "altKey", false);
      action.metaKey = readBoolean(actionInput, "metaKey", false);
      action.shiftKey = readBoolean(actionInput, "shiftKey", false);
    } else if (actionType === "scroll") {
      action.direction = readString(actionInput, "direction", false) ?? "down";
      if (readNumber(actionInput, "amount", false) !== undefined) {
        action.amount = readNumber(actionInput, "amount", false);
      }
    } else if (actionType === "drag") {
      const destinationHandleId = readString(actionInput, "destinationHandleId", false);
      const destinationCapabilityId = readString(actionInput, "destinationCapabilityId", false);
      if (destinationHandleId) {
        action.destination = { handleId: destinationHandleId };
      } else if (destinationCapabilityId) {
        const resolvedDestination = this.findSnapshotCapability(session.ref.sessionId, destinationCapabilityId);
        if (!resolvedDestination) {
          throw new Error(`Destination capability ${destinationCapabilityId} was not found for the current page session.`);
        }
        if (!resolvedDestination.capability.elementId) {
          throw new Error("Destination capability does not expose an element target for drag.");
        }
        const destinationElement = resolvedDestination.snapshot.elements.find(
          (entry) => entry.elementId === resolvedDestination.capability.elementId,
        );
        if (!destinationElement) {
          throw new Error("Destination capability element could not be resolved.");
        }
        action.destination = {
          handleId: this.registerElementHandleForSnapshot(session, resolvedDestination.snapshot, destinationElement).handleId,
        };
      } else {
        throw new Error("drag interactions require action.destinationHandleId or action.destinationCapabilityId.");
      }
    }

    const result = await this.actStep({
      page,
      ...(target ? { target } : {}),
      action,
      ...(waitInput ? { wait: waitInput } : {}),
      dryRun: readBoolean(input, "dryRun", false),
    });

    const postPage = isRecord(result.page) ? result.page : page;
    const snapshot = await this.pageSnapshot({
      page: postPage,
      maxInformation: Math.max(1, Math.min(8, Math.floor(readNumber(input, "maxInformation", false) ?? 4))),
      maxCapabilities: Math.max(1, Math.min(12, Math.floor(readNumber(input, "maxCapabilities", false) ?? 6))),
    });

    const structuredContent = {
      result,
      summary: snapshot.summary,
      information: snapshot.information,
      capabilities: snapshot.capabilities,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(structuredContent),
        },
      ],
      structuredContent,
    };
  }

  private async actStep(input: Record<string, unknown>) {
    const action = assertObject(input.action, "Missing action object.");
    const actionType = readString(action, "type") as
      | "navigate"
      | "click"
      | "hover"
      | "type"
      | "select"
      | "scroll"
      | "press"
      | "drag"
      | "submit_form";
    const dryRun = readBoolean(input, "dryRun", false);

    if (actionType === "navigate") {
      const { session } = await this.resolvePageInput(input, "page");
      const navigation = await this.navigate({
        session: session.ref,
        url: readString(action, "url") as string,
        waitUntil: readString(action, "waitUntil", false) ?? "load",
        timeoutMs: Math.max(200, Math.floor(readNumber(input.wait && isRecord(input.wait) ? input.wait : action, "timeoutMs", false) ?? 10_000)),
      });
      const page = await this.buildPageRef(session);
      return {
        status: navigation.timedOut ? "timeout" : navigation.matched ? "success" : "failure",
        reasonCode: navigation.timedOut
          ? "NAVIGATION_TIMEOUT"
          : navigation.matched
            ? "NAVIGATION_COMPLETE"
            : "NAVIGATION_UNOBSERVED",
        retryable: navigation.timedOut,
        evidence: [
          navigation.timedOut
            ? `Navigation to ${navigation.url} timed out while waiting for ${navigation.waitUntil}.`
            : `Navigation reached ${navigation.url}.`,
        ],
        errorObserved: false,
        errorMessages: [],
        page,
        navigation,
      };
    }

    const { session, page } = await this.resolvePageInput(input, "page", {
      enforceDocumentId: true,
    });
    const targetInput = isRecord(input.target) ? input.target : undefined;
    const handleId = targetInput ? readString(targetInput, "handleId", false) : undefined;
    const handle = handleId ? this.getHandle(handleId) : undefined;
    if (handle && handle.sessionId !== session.ref.sessionId) {
      throw new Error(`Handle ${handleId} does not belong to the provided page session.`);
    }

    let stepTarget = handle ? this.buildLiveHandleOutput(handle, page) : undefined;
    let execution: Record<string, unknown>;
    const targetBinding = this.resolveStepTargetBinding(session.ref.sessionId, targetInput, handle);

    if (actionType === "submit_form") {
      const formId = targetInput
        ? readString(targetInput, "formId", false)
          ?? handle?.targetFormId
        : handle?.targetFormId;
      const submitterElementId = handle?.kind === "element"
        ? handle.targetElementId
        : (targetInput ? readString(targetInput, "elementId", false) : undefined);
      if (!formId) {
        throw new Error("submit_form requires target.formId or a handle bound to a form.");
      }
      execution = await this.submitForm({
        session: session.ref,
        formId,
        ...(submitterElementId ? { submitterElementId } : {}),
        force: readBoolean(action, "force", false),
        dryRun,
      }) as Record<string, unknown>;
    } else {
      if (!targetBinding.targetDescriptor && actionType !== "scroll" && actionType !== "press") {
        throw new Error(
          `${actionType} requires target.handleId, target.elementId, target.formId, target.regionId, or target.selector.`,
        );
      }

      if (actionType === "drag") {
        const destinationInput = assertObject(action.destination, "drag requires a destination object.");
        const destinationHandleId = readString(destinationInput, "handleId", false);
        const destinationHandle = destinationHandleId ? this.getHandle(destinationHandleId) : undefined;
        if (destinationHandle && destinationHandle.sessionId !== session.ref.sessionId) {
          throw new Error(
            `Handle ${destinationHandleId} does not belong to the provided page session.`,
          );
        }
        const destinationBinding = this.resolveStepTargetBinding(
          session.ref.sessionId,
          destinationInput,
          destinationHandle,
        );
        if (!destinationBinding.targetDescriptor) {
          throw new Error(
            "drag requires action.destination.handleId, action.destination.elementId, or action.destination.selector.",
          );
        }
        execution = await this.executePreparedAction(session, {
          actionType: "drag",
          emittedEvents: ["drag.start", "drag.drop"],
          dryRun,
          force: readBoolean(action, "force", false),
          targetElementId: targetBinding.targetElementId,
          targetFormId: targetBinding.targetFormId,
          targetDescriptor: targetBinding.targetDescriptor,
          destination: destinationBinding.targetDescriptor,
        }) as Record<string, unknown>;
      } else if (actionType === "hover") {
        execution = await this.executePreparedAction(session, {
          actionType: "hover",
          emittedEvents: ["input.hover"],
          dryRun,
          force: readBoolean(action, "force", false),
          targetElementId: targetBinding.targetElementId,
          targetFormId: targetBinding.targetFormId,
          targetDescriptor: targetBinding.targetDescriptor,
        }) as Record<string, unknown>;
      } else if (actionType === "click") {
        execution = await this.executePreparedAction(session, {
          actionType: "click",
          emittedEvents: ["input.click"],
          dryRun,
          force: readBoolean(action, "force", false),
          targetElementId: targetBinding.targetElementId,
          targetFormId: targetBinding.targetFormId,
          targetDescriptor: targetBinding.targetDescriptor,
        }) as Record<string, unknown>;
      } else if (actionType === "type") {
        execution = await this.executePreparedAction(session, {
          actionType: "type",
          emittedEvents: ["input.input", "input.keydown"],
          dryRun,
          force: readBoolean(action, "force", false),
          text: readString(action, "text") as string,
          targetElementId: targetBinding.targetElementId,
          targetFormId: targetBinding.targetFormId,
          targetDescriptor: targetBinding.targetDescriptor,
        }) as Record<string, unknown>;
      } else if (actionType === "select") {
        execution = await this.executePreparedAction(session, {
          actionType: "select",
          emittedEvents: ["input.input"],
          dryRun,
          force: readBoolean(action, "force", false),
          value: readString(action, "value") as string,
          targetElementId: targetBinding.targetElementId,
          targetFormId: targetBinding.targetFormId,
          targetDescriptor: targetBinding.targetDescriptor,
        }) as Record<string, unknown>;
      } else if (actionType === "press") {
        execution = await this.executePreparedAction(session, {
          actionType: "press",
          emittedEvents: ["input.keydown"],
          dryRun,
          force: false,
          key: readString(action, "key") as string,
          ...(readString(action, "code", false) ? { code: readString(action, "code", false) } : {}),
          ctrlKey: readBoolean(action, "ctrlKey", false),
          altKey: readBoolean(action, "altKey", false),
          metaKey: readBoolean(action, "metaKey", false),
          shiftKey: readBoolean(action, "shiftKey", false),
          targetElementId: targetBinding.targetElementId,
          targetFormId: targetBinding.targetFormId,
          targetDescriptor: targetBinding.targetDescriptor,
        }) as Record<string, unknown>;
      } else {
        execution = await this.executePreparedAction(session, {
          actionType: "scroll",
          emittedEvents: ["input.scroll"],
          dryRun,
          force: false,
          amount: (readString(action, "direction") as string) === "up"
            ? -Math.abs(readNumber(action, "amount", false) ?? 420)
            : Math.abs(readNumber(action, "amount", false) ?? 420),
        }) as Record<string, unknown>;
      }
    }

    if (!stepTarget) {
      const targetElementId = readString(execution, "targetElementId", false);
      const targetFormId = readString(execution, "targetFormId", false);
      const snapshotId = readString(execution, "postSnapshotId", false)
        ?? readString(execution, "preSnapshotId", false);
      if (snapshotId) {
        const snapshot = this.getSnapshot(snapshotId);
        if (targetElementId) {
          const element = snapshot.elements.find((entry) => entry.elementId === targetElementId);
          if (element) {
            const registered = this.registerHandle(session, snapshot, {
              kind: "element",
              fingerprint: buildHandleFingerprint([
                "element",
                session.ref.tabId,
                element.role,
                element.name,
                element.associatedLabel,
                element.text,
                snapshot.elementLocatorById.get(element.elementId),
              ]),
              role: element.role,
              name: element.name,
              description: element.description ?? element.associatedLabel ?? element.text,
              locator: snapshot.elementLocatorById.get(element.elementId),
              targetElementId: element.elementId,
              targetFormId: element.formId,
              targetRegionId: element.regionId,
            });
            stepTarget = this.buildLiveHandleOutput(registered, page);
          }
        } else if (targetFormId) {
          const form = snapshot.forms.find((entry) => entry.formId === targetFormId);
          if (form) {
            const registered = this.registerHandle(session, snapshot, {
              kind: "form",
              fingerprint: buildHandleFingerprint([
                "form",
                session.ref.tabId,
                form.name,
                form.textSummary,
                snapshot.formLocatorById.get(form.formId),
              ]),
              role: "form",
              name: form.name,
              description: form.description ?? form.textSummary,
              locator: snapshot.formLocatorById.get(form.formId),
              targetFormId: form.formId,
              targetRegionId: form.regionId,
            });
            stepTarget = this.buildLiveHandleOutput(registered, page);
          }
        }
      }
    }

    const waitInput = isRecord(input.wait) ? input.wait : undefined;
    let outcome: Record<string, unknown> | undefined;
    if (
      waitInput
      && (readArray(waitInput, "successSignals", false).length > 0
        || readArray(waitInput, "expectations", false).length > 0)
    ) {
      const subscriptionId = readString(waitInput, "subscriptionId", false);
      outcome = await this.observeOutcome({
        session: session.ref,
        actionId: readString(execution, "actionId") as string,
        ...(subscriptionId ? { captureId: subscriptionId } : {}),
        timeoutMs: Math.max(200, Math.floor(readNumber(waitInput, "timeoutMs", false) ?? 4_000)),
        successSignals: readArray(waitInput, "successSignals", false),
        expectations: readArray(waitInput, "expectations", false),
        expectationMode: readString(waitInput, "expectationMode", false) ?? "all",
      }) as Record<string, unknown>;
    }

    const currentPage = await this.buildPageRef(session);
    const errorObserved = readBoolean(execution, "errorObserved", false);
    const errorMessages = readArray(execution, "errorMessages", false)
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => entry.trim());
    if (outcome) {
      const status = readString(outcome, "status", false) ?? "unknown";
      return {
        actionId: readString(execution, "actionId", false),
        status,
        reasonCode: status === "success"
          ? "EXPECTATIONS_SATISFIED"
          : status === "failure"
            ? "EXPECTATIONS_FAILED"
            : "EXPECTATIONS_UNKNOWN",
        retryable: status !== "success",
        evidence: [
          ...readArray(outcome, "evidence", false).map((entry) => String(entry)),
          ...(errorMessages.length > 0 ? errorMessages.map((message) => `Error observed: ${message}`) : []),
        ],
        page: currentPage,
        ...(stepTarget ? { target: stepTarget } : {}),
        execution,
        errorObserved,
        errorMessages,
        ...(readString(outcome, "postSnapshotId", false)
          ? { postSnapshotId: readString(outcome, "postSnapshotId", false) }
          : readString(execution, "postSnapshotId", false)
            ? { postSnapshotId: readString(execution, "postSnapshotId", false) }
            : {}),
        ...(isRecord(outcome.snapshotDiff) ? { snapshotDiff: outcome.snapshotDiff } : isRecord(execution.snapshotDiff) ? { snapshotDiff: execution.snapshotDiff } : {}),
      };
    }

    const accepted = readBoolean(execution, "accepted", false);
    const effective = readBoolean(execution, "effective", false);
    const reason = readString(execution, "reason", false);
    const failedFromError = accepted && errorObserved;
    return {
      actionId: readString(execution, "actionId", false),
      status: !accepted ? "blocked" : failedFromError ? "failure" : effective ? "success" : "failure",
      reasonCode: !accepted
        ? (reason ?? "ACTION_REJECTED").replace(/[^a-z0-9]+/gi, "_").toUpperCase()
        : failedFromError
          ? "ACTION_ERROR_OBSERVED"
        : effective
          ? "ACTION_EFFECTIVE"
          : (reason ?? "ACTION_INEFFECTIVE").replace(/[^a-z0-9]+/gi, "_").toUpperCase(),
      retryable: !accepted || !effective || failedFromError,
      evidence: [
        !accepted
          ? `Action was not accepted${reason ? `: ${reason}` : "."}`
          : failedFromError
            ? `Action triggered an error state${errorMessages.length > 0 ? `: ${errorMessages.join(" | ")}` : "."}`
          : effective
            ? "Action produced an observable effect."
            : `Action completed without a material effect${reason ? `: ${reason}` : "."}`,
      ],
      page: currentPage,
      ...(stepTarget ? { target: stepTarget } : {}),
      execution,
      errorObserved,
      errorMessages,
      ...(readString(execution, "postSnapshotId", false)
        ? { postSnapshotId: readString(execution, "postSnapshotId", false) }
        : {}),
      ...(isRecord(execution.snapshotDiff) ? { snapshotDiff: execution.snapshotDiff } : {}),
    };
  }

  private buildStructuredRecordExtractionExpression(config: Record<string, unknown>): string {
    return `(() => {
      const config = ${JSON.stringify(config)};
      const sanitize = (value) => typeof value === 'string' ? value.replace(/\\s+/g, ' ').trim() : '';
      const clip = (value, limit = 240) => {
        const normalized = sanitize(value);
        return normalized.length > limit ? normalized.slice(0, limit - 1) + '…' : normalized;
      };
      const normalizeKey = (value) => sanitize(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const safeQuery = (root, selector) => {
        if (!root || !selector || typeof root.querySelector !== 'function') return null;
        try {
          return root.querySelector(selector);
        } catch {
          return null;
        }
      };
      const resolveRoot = () => {
        if (config.formSelector) {
          const found = safeQuery(document, config.formSelector);
          if (found) return found;
        }
        if (config.regionSelector) {
          const found = safeQuery(document, config.regionSelector);
          if (found) return found;
        }
        if (config.sourceRole === 'table') {
          return document.querySelector('table,[role="table"]');
        }
        if (config.sourceRole === 'list') {
          return document.querySelector('ul,ol,[role="list"]');
        }
        if (config.sourceRole === 'form') {
          return document.querySelector('form,[role="form"]');
        }
        if (config.sourceRole === 'main') {
          return document.querySelector('main,[role="main"]');
        }
        return document.querySelector('table,[role="table"],ul,ol,[role="list"],main,[role="main"],section,article,form,[role="form"]') || document.body;
      };
      const root = resolveRoot();
      if (!root) {
        return { sourceRole: config.sourceRole || 'unknown', recordCount: 0, records: [] };
      }
      const desiredKeys = Array.isArray(config.desiredKeys) ? config.desiredKeys : [];
      const assignDesiredKeys = (record) => {
        if (!desiredKeys.length || !record || typeof record !== 'object' || Array.isArray(record)) {
          return record;
        }
        const existingKeys = Object.keys(record);
        const hasDesiredKey = desiredKeys.some((key) => existingKeys.includes(key));
        if (hasDesiredKey) {
          return record;
        }
        const values = existingKeys.map((key) => record[key]).filter((value) => typeof value === 'string' && value);
        if (!values.length) {
          return record;
        }
        const mapped = {};
        desiredKeys.forEach((key, index) => {
          if (values[index] !== undefined) {
            mapped[key] = values[index];
          }
        });
        return Object.keys(mapped).length ? mapped : record;
      };
      const extractTableRecords = (tableRoot) => {
        const table = tableRoot.matches && tableRoot.matches('table,[role="table"]') ? tableRoot : tableRoot.querySelector('table,[role="table"]');
        if (!table) return [];
        const headerCells = Array.from(table.querySelectorAll('thead th')).map((cell) => clip(cell.innerText || cell.textContent || '', 120));
        const rows = Array.from(table.querySelectorAll('tbody tr,[role="row"],tr'))
          .filter((row) => sanitize(row.innerText || row.textContent || ''))
          .filter((row) => !row.querySelectorAll('th').length || row.querySelectorAll('td').length);
        return rows.map((row) => {
          const cells = Array.from(row.querySelectorAll('td,th,[role="cell"]'))
            .map((cell) => clip(cell.innerText || cell.textContent || '', 240))
            .filter(Boolean);
          const record = {};
          cells.forEach((value, index) => {
            const key = normalizeKey(headerCells[index] || '') || 'cell_' + (index + 1);
            record[key] = value;
          });
          if (!Object.keys(record).length) {
            record.text = clip(row.innerText || row.textContent || '', 240);
          }
          return assignDesiredKeys(record);
        });
      };
      const extractKeyValueRecord = (node) => {
        const record = {};
        const dtNodes = Array.from(node.querySelectorAll('dt'));
        if (dtNodes.length) {
          dtNodes.forEach((dt) => {
            const dd = dt.nextElementSibling;
            const key = normalizeKey(dt.innerText || dt.textContent || '');
            const value = dd ? clip(dd.innerText || dd.textContent || '', 240) : undefined;
            if (key && value) record[key] = value;
          });
        }
        Array.from(node.querySelectorAll('[data-label]')).forEach((el) => {
          const key = normalizeKey(el.getAttribute('data-label'));
          const value = clip(el.innerText || el.textContent || '', 240);
          if (key && value && !(key in record)) record[key] = value;
        });
        if (!Object.keys(record).length) {
          Array.from(node.querySelectorAll('strong,b,label')).slice(0, 8).forEach((label) => {
            const text = clip(label.innerText || label.textContent || '', 120);
            const key = normalizeKey(text);
            const sibling = label.nextElementSibling;
            const value = sibling ? clip(sibling.innerText || sibling.textContent || '', 240) : undefined;
            if (key && value && !(key in record)) record[key] = value;
          });
        }
        const link = node.querySelector('a[href]');
        if (link && !('href' in record)) {
          record.href = link.href;
          const linkText = clip(link.innerText || link.textContent || '', 240);
          if (linkText) record.link_text = linkText;
        }
        if (!Object.keys(record).length) {
          const text = clip(node.innerText || node.textContent || '', 240);
          if (text) record.text = text;
        }
        return assignDesiredKeys(record);
      };
      const extractListRecords = (listRoot) => {
        const list = listRoot.matches && listRoot.matches('ul,ol,[role="list"]') ? listRoot : listRoot.querySelector('ul,ol,[role="list"]');
        if (!list) return [];
        const items = Array.from(list.querySelectorAll('li,[role="listitem"]'))
          .filter((item) => sanitize(item.innerText || item.textContent || ''));
        return items.map((item) => extractKeyValueRecord(item));
      };
      const extractRepeatedChildRecords = (container) => {
        const directChildren = Array.from(container.children).filter((child) => sanitize(child.innerText || child.textContent || ''));
        const groups = new Map();
        for (const child of directChildren) {
          const signature = child.tagName.toLowerCase() + ':' + Array.from(child.classList || []).slice(0, 3).join('.');
          const group = groups.get(signature) || [];
          group.push(child);
          groups.set(signature, group);
        }
        const bestGroup = Array.from(groups.values())
          .filter((group) => group.length >= 2)
          .sort((left, right) => right.length - left.length)[0];
        return (bestGroup || directChildren.slice(0, Math.max(2, directChildren.length))).map((node) => extractKeyValueRecord(node));
      };
      const sourceRole = (() => {
        const tag = root.tagName ? root.tagName.toLowerCase() : 'unknown';
        if (tag === 'table' || root.querySelector('table,[role="table"]')) return 'table';
        if (tag === 'ul' || tag === 'ol' || root.querySelector('ul,ol,[role="list"]')) return 'list';
        if (tag === 'form' || root.getAttribute('role') === 'form') return 'form';
        if (tag === 'main' || root.getAttribute('role') === 'main') return 'main';
        return config.sourceRole || 'panel';
      })();
      let records = [];
      if (sourceRole === 'table') {
        records = extractTableRecords(root);
      } else if (sourceRole === 'list') {
        records = extractListRecords(root);
      } else {
        records = extractRepeatedChildRecords(root);
      }
      const maxRecords = Number.isFinite(config.maxRecords) ? Math.max(1, Math.floor(config.maxRecords)) : 50;
      return {
        sourceRole,
        recordCount: records.length,
        records: records.slice(0, maxRecords),
      };
    })()`;
  }

  private buildScopedContentExtractionExpression(config: Record<string, unknown>): string {
    return `(() => {
      const config = ${JSON.stringify(config)};
      const sanitize = (value) => typeof value === 'string' ? value.replace(/\\s+/g, ' ').trim() : '';
      const clip = (value, limit = 2000) => {
        const normalized = sanitize(value);
        return normalized.length > limit ? normalized.slice(0, limit - 1) + '…' : normalized;
      };
      const safeQuery = (root, selector) => {
        if (!root || !selector || typeof root.querySelector !== 'function') return null;
        try {
          return root.querySelector(selector);
        } catch {
          return null;
        }
      };
      const resolveRoot = () => {
        if (config.formSelector) {
          const found = safeQuery(document, config.formSelector);
          if (found) return found;
        }
        if (config.regionSelector) {
          const found = safeQuery(document, config.regionSelector);
          if (found) return found;
        }
        return document.body;
      };
      const root = resolveRoot();
      if (!root) {
        return config.mode === 'images' ? { images: [] } : { text: '' };
      }
      if (config.mode === 'images') {
        const images = [];
        const candidates = root.matches && root.matches('img') ? [root] : Array.from(root.querySelectorAll('img'));
        for (const img of candidates) {
          const src = typeof img.currentSrc === 'string' && img.currentSrc ? img.currentSrc : img.getAttribute('src');
          if (!src) continue;
          images.push({
            src,
            ...(sanitize(img.getAttribute('alt')) ? { alt: clip(img.getAttribute('alt'), 240) } : {}),
            ...(sanitize(img.getAttribute('title')) ? { title: clip(img.getAttribute('title'), 240) } : {}),
          });
        }
        const maxItems = Number.isFinite(config.maxItems) ? Math.max(1, Math.floor(config.maxItems)) : 20;
        return { images: images.slice(0, maxItems) };
      }
      return {
        text: clip(root.innerText || root.textContent || '', 4000),
      };
    })()`;
  }

  private async extractStructuredRecords(
    session: AttachedSession,
    input: Record<string, unknown>,
  ): Promise<RecordExtractionResult> {
    const extraction = assertObject(input.extraction, "Missing extraction object.");
    const regionId = readString(extraction, "regionId", false);
    const formId = readString(extraction, "formId", false);
    const inferredSnapshotId =
      readString(input, "snapshotId", false) ??
      (regionId ? this.findSnapshotByRegionId(session.ref.sessionId, regionId)?.snapshotId : undefined) ??
      session.latestSnapshotId;
    const snapshot = inferredSnapshotId
      ? this.getSnapshot(inferredSnapshotId)
      : await this.captureStoredSnapshotForSession(session);
    const sourceRole = readString(extraction, "sourceRole", false) ?? "auto";
    const maxRecords = Math.max(1, Math.floor(readNumber(extraction, "maxRecords", false) ?? 50));
    const recordSchemaRaw = extraction.recordSchema;
    const recordSchema = isRecord(recordSchemaRaw) ? (recordSchemaRaw as JSONSchema) : undefined;
    const desiredKeys = isRecord(recordSchema?.properties)
      ? Object.keys(recordSchema.properties ?? {})
      : [];

    if (snapshot.sessionId !== session.ref.sessionId) {
      throw new Error("snapshotId does not belong to the provided session.");
    }

    const regionSelector = regionId ? snapshot.regionLocatorById.get(regionId) : undefined;
    const formSelector = formId ? snapshot.formLocatorById.get(formId) : undefined;
    const extracted = await this.evaluateInTab<{
      sourceRole?: string;
      recordCount?: number;
      records?: Array<Record<string, unknown>>;
    }>(
      session.contentsId,
      this.buildStructuredRecordExtractionExpression({
        regionSelector,
        formSelector,
        sourceRole,
        maxRecords,
        desiredKeys,
      }),
    );

    const records = Array.isArray(extracted.records)
      ? extracted.records.filter((entry): entry is Record<string, unknown> => isRecord(entry))
      : [];
    const validationErrors: string[] = [];
    if (recordSchema) {
      records.forEach((record, index) => {
        const errors: string[] = [];
        validateSchemaValue(record, recordSchema, recordSchema, `$[${index}]`, errors);
        if (errors.length) {
          validationErrors.push(...errors.slice(0, 4));
        }
      });
    }

    return {
      ...(regionId ? { sourceRegionId: regionId } : {}),
      sourceRole: extracted.sourceRole ?? sourceRole,
      recordCount: records.length,
      records,
      ...(recordSchema ? { schemaValid: validationErrors.length === 0 } : {}),
      ...(validationErrors.length ? { validationErrors } : {}),
    };
  }

  private buildExtractDataExpression(script: string): string {
    return `(() => {
  const __miloExtract = async () => {
${indentMultiline(script, "    ")}
  };

  return (async () => {
    const __miloResult = await __miloExtract();
    try {
      const __miloJson = JSON.stringify(__miloResult);
      if (__miloJson === undefined) {
        return {
          ok: false,
          error: "Script returned undefined. Return a JSON-serializable value, or null when no data is available.",
        };
      }

      return {
        ok: true,
        json: __miloJson,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })();
})()
//# sourceURL=milo-mcp-extract-data.js`;
  }

  private buildExtractDataSoftError(reason: string, message: string) {
    return {
      error: {
        reason,
        message,
      },
    };
  }

  private normalizeExtractedData(data: unknown): unknown {
    if (!isRecord(data) || !("data" in data)) {
      return data;
    }

    const keys = Object.keys(data);
    const looksLikeToolEnvelope =
      keys.length > 0 &&
      keys.every((key) => key === "url" || key === "title" || key === "data") &&
      ("url" in data || "title" in data);

    if (!looksLikeToolEnvelope) {
      return data;
    }

    return data.data;
  }

  private async extractData(input: Record<string, unknown>) {
    const session = this.resolveSessionRef(input);
    const tabContext = this.findTabContext(session.ref.tabId);
    let data: unknown;

    if ("script" in input) {
      const script = readString(input, "script") as string;
      try {
        const envelope = await this.evaluateInTab<{
          ok?: boolean;
          json?: string;
          error?: string;
        }>(
          session.contentsId,
          this.buildExtractDataExpression(script),
        );

        if (!envelope?.ok) {
          data = this.buildExtractDataSoftError(
            "script_return_invalid",
            envelope?.error ?? "Unknown serialization error.",
          );
        } else if (typeof envelope.json !== "string") {
          data = this.buildExtractDataSoftError(
            "script_return_invalid",
            "Script did not produce a JSON-serializable result.",
          );
        } else {
          try {
            data = this.normalizeExtractedData(JSON.parse(envelope.json) as unknown);
          } catch (error) {
            data = this.buildExtractDataSoftError(
              "tool_parse_failed",
              error instanceof Error ? error.message : String(error),
            );
          }
        }
      } catch (error) {
        data = this.buildExtractDataSoftError(
          "script_execution_failed",
          error instanceof Error ? error.message : String(error),
        );
      }
    } else {
      try {
        const extracted = await this.extractStructuredRecords(session, input);
        data = {
          kind: "records",
          ...extracted,
        };
      } catch (error) {
        data = this.buildExtractDataSoftError(
          "structured_extraction_failed",
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    const structuredContent = {
      url: tabContext.webContents.getURL(),
      title: tabContext.webContents.getTitle(),
      data,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(structuredContent),
        },
      ],
      structuredContent,
    };
  }

  private lifecycleNamesFor(waitUntil: string): string[] {
    if (waitUntil === "domcontentloaded") {
      return ["DOMContentLoaded"];
    }

    if (waitUntil === "network_idle") {
      return ["networkIdle", "networkAlmostIdle"];
    }

    if (waitUntil === "load") {
      return ["load"];
    }

    return [];
  }

  private async waitForLifecycle(
    contentsId: number,
    waitUntil: string,
    timeoutMs: number,
    expected?: {
      frameId?: string;
      loaderId?: string;
    },
  ): Promise<{ matched: boolean; timedOut: boolean; matchedEvent?: string }> {
    const targetNames = this.lifecycleNamesFor(waitUntil);
    if (!targetNames.length || waitUntil === "none") {
      return { matched: true, timedOut: false };
    }

    await this.ensureLifecycleEventsEnabled(contentsId);

    const targetSet = new Set(targetNames);

    return new Promise(async (resolve, reject) => {
      let finished = false;
      const timer = setTimeout(() => {
        if (finished) {
          return;
        }

        finished = true;
        stop()
          .catch(() => undefined)
          .finally(() => {
            resolve({ matched: false, timedOut: true });
          });
      }, Math.max(100, timeoutMs));

      let dispose: (() => void) | undefined;

      const stop = async () => {
        if (dispose) {
          dispose();
          dispose = undefined;
        }
      };

      try {
        dispose = await this.context.subscribeContentsCdpEvents(contentsId, (method, params) => {
          if (finished || method !== "Page.lifecycleEvent") {
            return;
          }

          const frameId = readString(params, "frameId", false);
          if (expected?.frameId && frameId && frameId !== expected.frameId) {
            return;
          }

          const loaderId = readString(params, "loaderId", false);
          if (expected?.loaderId) {
            if (!loaderId) {
              return;
            }
            if (loaderId !== expected.loaderId) {
              return;
            }
          }

          const name = readString(params, "name", false);
          if (!name || !targetSet.has(name)) {
            return;
          }

          finished = true;
          clearTimeout(timer);
          void stop()
            .catch(() => undefined)
            .finally(() => {
              resolve({
                matched: true,
                timedOut: false,
                matchedEvent: name,
              });
            });
        });
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  private async navigate(input: Record<string, unknown>) {
    const session = this.resolveSessionRef(input);
    const url = readString(input, "url") as string;
    const waitUntil = readString(input, "waitUntil", false) ?? "load";
    const timeoutMs = Math.max(200, Math.floor(readNumber(input, "timeoutMs", false) ?? 10_000));
    const preTabContext = this.findTabContext(session.ref.tabId);
    const previousUrl = preTabContext.webContents.getURL();

    await this.ensureLifecycleEventsEnabled(session.contentsId);
    const navigationResult = await this.context.sendContentsCdpCommand<{
      frameId?: string;
      loaderId?: string;
      errorText?: string;
    }>(session.contentsId, "Page.navigate", { url });
    if (navigationResult.errorText) {
      throw new AutomationToolError({
        errorCode: "NAVIGATION_FAILED",
        category: "execution",
        message: `Page.navigate failed: ${navigationResult.errorText}`,
        retryable: true,
        details: {
          requestedUrl: url,
        },
      });
    }

    const waitResult =
      waitUntil === "none"
        ? { matched: true, timedOut: false }
        : await this.waitForLifecycle(session.contentsId, waitUntil, timeoutMs, {
            frameId: navigationResult.frameId,
            loaderId: navigationResult.loaderId,
          });

    let tabContext = this.findTabContext(session.ref.tabId);
    if (
      waitResult.matched &&
      url !== previousUrl &&
      tabContext.webContents.getURL() === previousUrl
    ) {
      const settleDeadline = Date.now() + Math.min(timeoutMs, 1_500);
      while (Date.now() < settleDeadline) {
        await sleep(120);
        tabContext = this.findTabContext(session.ref.tabId);
        if (tabContext.webContents.getURL() !== previousUrl) {
          break;
        }
      }
    }

    const finalUrl = tabContext.webContents.getURL();
    const staleNavigation =
      waitResult.matched && url !== previousUrl && finalUrl === previousUrl;
    const matched = staleNavigation ? false : waitResult.matched;
    const timedOut = staleNavigation ? true : waitResult.timedOut;

    return {
      url: finalUrl,
      title: tabContext.webContents.getTitle(),
      waitUntil: waitUntil as "none" | "domcontentloaded" | "load" | "network_idle",
      matched,
      timedOut,
      ...(matched && waitResult.matchedEvent ? { matchedEvent: waitResult.matchedEvent } : {}),
    };
  }

  private async sendCdpCommand(input: Record<string, unknown>) {
    const session = this.resolveSessionRef(input);
    const method = readString(input, "method") as string;
    const paramsValue = input.params;

    if (
      paramsValue !== undefined &&
      (typeof paramsValue !== "object" || paramsValue === null || Array.isArray(paramsValue))
    ) {
      throw new Error("params must be an object when provided.");
    }

    const result = await this.context.sendContentsCdpCommand(
      session.contentsId,
      method,
      (paramsValue as Record<string, unknown> | undefined) ?? {},
    );

    return {
      result: isRecord(result)
        ? result
        : {
            value: result,
          },
    };
  }

  private async detachSession(input: Record<string, unknown>) {
    const session = this.resolveSessionRef(input);
    this.sessions.delete(session.ref.sessionId);

    for (const [captureId, capture] of this.captures.entries()) {
      if (capture.sessionId !== session.ref.sessionId) {
        continue;
      }
      this.stopCapture(capture);
      this.captures.delete(captureId);
    }

    for (const [snapshotId, snapshot] of this.snapshots.entries()) {
      if (snapshot.sessionId === session.ref.sessionId) {
        this.snapshots.delete(snapshotId);
      }
    }

    for (const [actionId, action] of this.actions.entries()) {
      if (action.sessionId === session.ref.sessionId) {
        this.actions.delete(actionId);
      }
    }

    for (const [handleId, handle] of this.handles.entries()) {
      if (handle.sessionId !== session.ref.sessionId) {
        continue;
      }
      this.handles.delete(handleId);
      if (this.handleIdsByFingerprint.get(handle.fingerprint) === handleId) {
        this.handleIdsByFingerprint.delete(handle.fingerprint);
      }
    }

    return { success: true };
  }

  private parseEventAwaitMatcher(input: Record<string, unknown>, capture: EventCaptureState): EventAwaitMatchConfig {
    const rawMatch = input.match;
    if (rawMatch === undefined) {
      return {};
    }

    const match = assertObject(rawMatch, "match must be an object.");
    const kinds = readArray(match, "kinds", false)
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => entry.trim());
    const source = readString(match, "source", false);
    const tabId = readString(match, "tabId", false);
    const openerTabIdInput = readString(match, "openerTabId", false);
    const openerTabId = openerTabIdInput === "current" ? capture.ref.tabId : openerTabIdInput;
    const windowId = readString(match, "windowId", false);
    const urlMatches = readString(match, "urlMatches", false);
    const titleMatches = readString(match, "titleMatches", false);
    const summaryMatches = readString(match, "summaryMatches", false);

    return {
      ...(kinds.length > 0 ? { kinds: new Set(kinds) } : {}),
      ...(tabId ? { tabId } : {}),
      ...(openerTabId ? { openerTabId } : {}),
      ...(windowId ? { windowId } : {}),
      ...(source ? { source } : {}),
      ...(urlMatches ? { urlPattern: this.compileEventPattern(urlMatches, "match.urlMatches") } : {}),
      ...(titleMatches ? { titlePattern: this.compileEventPattern(titleMatches, "match.titleMatches") } : {}),
      ...(summaryMatches ? { summaryPattern: this.compileEventPattern(summaryMatches, "match.summaryMatches") } : {}),
    };
  }

  private compileEventPattern(pattern: string, fieldPath: string) {
    try {
      return new RegExp(pattern, "i");
    } catch (error) {
      throw new AutomationToolError({
        errorCode: "INPUT_VALIDATION_ERROR",
        category: "validation",
        message: `Invalid regular expression for ${fieldPath}.`,
        retryable: true,
        fieldPath,
        expected: "valid regular expression string",
        provided: pattern,
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private eventMatchesAwaitMatcher(event: RawEvent, matcher: EventAwaitMatchConfig) {
    if (matcher.kinds && !matcher.kinds.has(event.kind)) {
      return false;
    }

    if (matcher.tabId && event.tabId !== matcher.tabId) {
      return false;
    }

    if (matcher.openerTabId && event.openerTabId !== matcher.openerTabId) {
      return false;
    }

    if (matcher.windowId && event.windowId !== matcher.windowId) {
      return false;
    }

    if (matcher.source && event.source !== matcher.source) {
      return false;
    }

    if (matcher.urlPattern && !matcher.urlPattern.test(typeof event.url === "string" ? event.url : "")) {
      return false;
    }

    if (matcher.titlePattern && !matcher.titlePattern.test(typeof event.title === "string" ? event.title : "")) {
      return false;
    }

    if (matcher.summaryPattern && !matcher.summaryPattern.test(typeof event.summary === "string" ? event.summary : "")) {
      return false;
    }

    return true;
  }

  private collectCaptureEvents(
    capture: EventCaptureState,
    cursor: {
      ts: number;
      seq: number;
      dropped: boolean;
    } | undefined,
    limit: number,
    predicate?: (event: RawEvent) => boolean,
  ) {
    return capture.events
      .filter((event) => isEventAfterCursor(event, cursor))
      .filter((event) => (predicate ? predicate(event) : true))
      .sort((left, right) => {
        if (left.ts !== right.ts) {
          return left.ts - right.ts;
        }
        return (left.seq ?? 0) - (right.seq ?? 0);
      })
      .slice(0, Math.max(1, Math.floor(limit)));
  }

  private buildPublicAwaitResult(
    subscriptionId: string,
    events: RawEvent[],
    timedOut: boolean,
    dropped: boolean,
  ) {
    const lastEvent = events[events.length - 1];

    return {
      subscriptionId,
      matched: events.length > 0,
      timedOut,
      events: events.map((event) => toPublicRawEvent(event)),
      dropped,
      ...(lastEvent ? { event: toPublicRawEvent(lastEvent) } : {}),
      ...(lastEvent ? { nextCursor: toStructuredCursor(subscriptionId, lastEvent, dropped) } : {}),
    };
  }

  private async enrichReturnedEvents(
    capture: EventCaptureState,
    events: RawEvent[],
  ): Promise<RawEvent[]> {
    const domEvents = events.filter((event) =>
      event.kind.startsWith("dom.") && typeof event.selector === "string");
    if (domEvents.length === 0) {
      return events.map((event) => ({ ...event }));
    }

    const backendNodeIdBySelector = new Map<string, number | undefined>();
    for (const event of domEvents) {
      const selector = typeof event.selector === "string" ? event.selector : undefined;
      if (!selector || backendNodeIdBySelector.has(selector)) {
        continue;
      }
      try {
        backendNodeIdBySelector.set(
          selector,
          await this.resolveBackendNodeIdForSelectorInContents(capture.contentsId, selector),
        );
      } catch {
        backendNodeIdBySelector.set(selector, undefined);
      }
    }

    const resolvedBackendNodeIds = Array.from(backendNodeIdBySelector.values())
      .filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry));
    const axByBackendNodeId = new Map<number, AccessibilityNodeRecord>();
    const axNodeById = new Map<string, AccessibilityNodeRecord>();
    if (resolvedBackendNodeIds.length > 0) {
      try {
        for (const node of await this.fetchAccessibilityNodesForContents(capture.contentsId)) {
          axNodeById.set(node.nodeId, node);
          if (
            node.backendDOMNodeId !== undefined
            && !axByBackendNodeId.has(node.backendDOMNodeId)
          ) {
            axByBackendNodeId.set(node.backendDOMNodeId, node);
          }
        }
      } catch {
        // Best-effort enrichment only.
      }
    }

    const resolveSelectorBackendNodeId = async (selector: string | undefined) => {
      if (!selector) {
        return undefined;
      }
      if (backendNodeIdBySelector.has(selector)) {
        return backendNodeIdBySelector.get(selector);
      }
      try {
        const backendNodeId = await this.resolveBackendNodeIdForSelectorInContents(capture.contentsId, selector);
        backendNodeIdBySelector.set(selector, backendNodeId);
        return backendNodeId;
      } catch {
        backendNodeIdBySelector.set(selector, undefined);
        return undefined;
      }
    };

    const enrichedEvents: RawEvent[] = [];
    for (const event of events) {
      if (!event.kind.startsWith("dom.")) {
        enrichedEvents.push({ ...event });
        continue;
      }

      const selector = typeof event.selector === "string" ? event.selector : undefined;
      const directBackendNodeId = selector ? backendNodeIdBySelector.get(selector) : undefined;
      let resolvedBackendNodeId = directBackendNodeId;
      let resolvedAxNode = resolvedBackendNodeId !== undefined
        ? axByBackendNodeId.get(resolvedBackendNodeId)
        : undefined;
      let resolvedDepth = resolvedAxNode ? 0 : undefined;
      let resolvedSelector = selector;
      let resolvedHint = readString(event, "targetHint", false);
      let resolvedRole = readString(event, "targetRole", false);
      let resolvedName = readString(event, "targetName", false);
      let resolvedLabel = readString(event, "targetLabel", false);
      let resolvedText = readString(event, "targetText", false);
      let axSnapshot: MutationAxSnapshot | undefined;
      let axDiff:
        | {
          summary?: string;
          changedFields: string[];
          addedChildren: MutationAxNodeSummary[];
          removedChildren: MutationAxNodeSummary[];
        }
        | undefined;

      if (!resolvedAxNode && directBackendNodeId !== undefined) {
        const candidates = await this.collectMutationTargetCandidatesForBackendNode(
          capture.contentsId,
          directBackendNodeId,
          6,
        );
        for (const candidate of candidates) {
          const candidateDepth = readNumber(candidate, "depth", false);
          const candidateSelector = readString(candidate, "selector", false);
          const candidateBackendNodeId = typeof candidateDepth === "number" && Math.floor(candidateDepth) === 0
            ? directBackendNodeId
            : await resolveSelectorBackendNodeId(candidateSelector);
          const candidateAxNode = candidateBackendNodeId !== undefined
            ? axByBackendNodeId.get(candidateBackendNodeId)
            : undefined;
          if (!candidateAxNode) {
            continue;
          }
          resolvedBackendNodeId = candidateBackendNodeId;
          resolvedAxNode = candidateAxNode;
          resolvedDepth = candidateDepth !== undefined ? Math.max(0, Math.floor(candidateDepth)) : 0;
          resolvedSelector = candidateSelector ?? resolvedSelector;
          resolvedHint = readString(candidate, "targetHint", false) ?? resolvedHint;
          resolvedRole = readString(candidate, "targetRole", false) ?? resolvedRole;
          resolvedName = readString(candidate, "targetName", false) ?? resolvedName;
          resolvedLabel = readString(candidate, "targetLabel", false) ?? resolvedLabel;
          resolvedText = readString(candidate, "targetText", false) ?? resolvedText;
          break;
        }
      }

      if (resolvedAxNode) {
        axSnapshot = this.buildMutationAxSnapshot(resolvedAxNode, axNodeById);
        const snapshotKey = resolvedAxNode.nodeId;
        axDiff = this.buildMutationAxDiff(capture.mutationAxSnapshots.get(snapshotKey), axSnapshot);
        capture.mutationAxSnapshots.set(snapshotKey, axSnapshot);
      }

      enrichedEvents.push({
        ...event,
        ...(resolvedBackendNodeId !== undefined ? { backendNodeId: resolvedBackendNodeId } : {}),
        ...(resolvedAxNode?.nodeId ? { axNodeId: resolvedAxNode.nodeId } : {}),
        ...(resolvedAxNode?.role ? { axRole: resolvedAxNode.role } : {}),
        ...(resolvedAxNode?.name ? { axName: resolvedAxNode.name } : {}),
        ...(resolvedAxNode?.description ? { axDescription: resolvedAxNode.description } : {}),
        ...(resolvedAxNode?.value ? { axValue: resolvedAxNode.value } : {}),
        ...(resolvedAxNode ? { axIgnored: resolvedAxNode.ignored } : {}),
        ...(resolvedDepth !== undefined ? { axResolvedDepth: resolvedDepth } : {}),
        ...(resolvedSelector && resolvedSelector !== selector ? { axResolvedSelector: resolvedSelector } : {}),
        ...(resolvedHint && resolvedHint !== event.targetHint ? { axResolvedTargetHint: resolvedHint } : {}),
        ...(resolvedRole && resolvedRole !== event.targetRole ? { axResolvedTargetRole: resolvedRole } : {}),
        ...(resolvedName && resolvedName !== event.targetName ? { axResolvedTargetName: resolvedName } : {}),
        ...(resolvedLabel && resolvedLabel !== event.targetLabel ? { axResolvedTargetLabel: resolvedLabel } : {}),
        ...(resolvedText && resolvedText !== event.targetText ? { axResolvedTargetText: resolvedText } : {}),
        ...(axSnapshot ? { axPath: axSnapshot.path } : {}),
        ...(axSnapshot ? { axChildren: axSnapshot.children } : {}),
        ...(axSnapshot ? { axChildCount: axSnapshot.childCount } : {}),
        ...(axDiff?.summary ? { axDiffSummary: axDiff.summary } : {}),
        ...(axDiff && axDiff.changedFields.length > 0 ? { axChangedFields: axDiff.changedFields } : {}),
        ...(axDiff && axDiff.addedChildren.length > 0 ? { axAddedChildren: axDiff.addedChildren } : {}),
        ...(axDiff && axDiff.removedChildren.length > 0 ? { axRemovedChildren: axDiff.removedChildren } : {}),
      });
    }

    return enrichedEvents;
  }

  private async enrichAwaitResult(
    capture: EventCaptureState,
    result: EventAwaitResult,
  ): Promise<EventAwaitResult> {
    if (!Array.isArray(result.events) || result.events.length === 0) {
      return result;
    }

    const enrichedEvents = await this.enrichReturnedEvents(capture, result.events);
    const lastEvent = enrichedEvents[enrichedEvents.length - 1];
    return {
      ...result,
      events: enrichedEvents.map((event) => toPublicRawEvent(event)),
      ...(lastEvent ? { event: toPublicRawEvent(lastEvent) } : {}),
    };
  }

  private finalizeCaptureWaiter(
    capture: EventCaptureState,
    waiterId: string,
    result?: EventAwaitResult,
    error?: Error,
  ) {
    const waiter = capture.waiters.get(waiterId);
    if (!waiter) {
      return;
    }

    capture.waiters.delete(waiterId);
    if (waiter.timeoutTimer) {
      clearTimeout(waiter.timeoutTimer);
    }
    if (waiter.settleTimer) {
      clearTimeout(waiter.settleTimer);
    }
    if (waiter.abortSignal && waiter.abortListener) {
      waiter.abortSignal.removeEventListener("abort", waiter.abortListener);
    }

    if (error) {
      waiter.reject(error);
      return;
    }

    if (result) {
      waiter.resolve(result);
    }
  }

  private flushCaptureWaiter(capture: EventCaptureState, waiterId: string) {
    const waiter = capture.waiters.get(waiterId);
    if (!waiter) {
      return;
    }

    const result = this.buildPublicAwaitResult(
      capture.captureId,
      waiter.matchedEvents,
      false,
      waiter.dropped,
    );
    this.finalizeCaptureWaiter(capture, waiterId, result);
  }

  private notifyCaptureWaiters(capture: EventCaptureState, appendedEvents: RawEvent[]) {
    if (capture.waiters.size === 0 || appendedEvents.length === 0) {
      return;
    }

    for (const waiter of Array.from(capture.waiters.values())) {
      const matchingEvents = appendedEvents
        .filter((event) => isEventAfterCursor(event, waiter.cursor))
        .filter((event) => this.eventMatchesAwaitMatcher(event, waiter.matcher));

      if (matchingEvents.length === 0) {
        continue;
      }

      waiter.matchedEvents.push(...matchingEvents);
      if (waiter.timeoutTimer) {
        clearTimeout(waiter.timeoutTimer);
        waiter.timeoutTimer = undefined;
      }

      if (waiter.matchedEvents.length >= waiter.maxEvents || waiter.coalesceMs === 0) {
        waiter.matchedEvents = waiter.matchedEvents.slice(0, waiter.maxEvents);
        this.flushCaptureWaiter(capture, waiter.waiterId);
        continue;
      }

      if (waiter.settleTimer) {
        clearTimeout(waiter.settleTimer);
      }

      waiter.settleTimer = setTimeout(() => {
        this.flushCaptureWaiter(capture, waiter.waiterId);
      }, waiter.coalesceMs);
    }
  }

  private appendEventsToCapture(captureId: string, events: RawEvent[]) {
    const capture = this.captures.get(captureId);
    if (!capture || capture.stoppedAt || events.length === 0) {
      return;
    }

    const appendedEvents: RawEvent[] = [];
    for (const event of events) {
      capture.lastSeq += 1;
      event.seq = capture.lastSeq;
      capture.events.push(event);
      appendedEvents.push(event);
      if (capture.events.length > MAX_CAPTURE_EVENTS) {
        capture.droppedEvents += capture.events.length - MAX_CAPTURE_EVENTS;
        capture.events.splice(0, capture.events.length - MAX_CAPTURE_EVENTS);
      }
    }

    this.notifyCaptureWaiters(capture, appendedEvents);
  }

  private awaitCaptureEvents(
    capture: EventCaptureState,
    input: {
      cursor?: {
        ts: number;
        seq: number;
        dropped: boolean;
      };
      matcher: EventAwaitMatchConfig;
      timeoutMs: number;
      coalesceMs: number;
      maxEvents: number;
      dropped: boolean;
      signal?: AbortSignal;
    },
  ) {
    return new Promise<EventAwaitResult>((resolve, reject) => {
      const waiterId = randomUUID();
      const waiter: EventAwaitWaiter = {
        waiterId,
        cursor: input.cursor,
        matcher: input.matcher,
        maxEvents: input.maxEvents,
        coalesceMs: input.coalesceMs,
        matchedEvents: [],
        dropped: input.dropped,
        abortSignal: input.signal,
        resolve,
        reject,
      };

      if (input.signal?.aborted) {
        reject(input.signal.reason instanceof Error ? input.signal.reason : new Error("Tool call aborted."));
        return;
      }

      waiter.timeoutTimer = setTimeout(() => {
        const existing = capture.waiters.get(waiterId);
        if (!existing) {
          return;
        }

        if (existing.matchedEvents.length > 0) {
          this.flushCaptureWaiter(capture, waiterId);
          return;
        }

        const result = this.buildPublicAwaitResult(capture.captureId, [], true, existing.dropped);
        this.finalizeCaptureWaiter(capture, waiterId, result);
      }, input.timeoutMs);

      if (input.signal) {
        waiter.abortListener = () => {
          this.finalizeCaptureWaiter(
            capture,
            waiterId,
            undefined,
            input.signal?.reason instanceof Error ? input.signal.reason : new Error("Tool call aborted."),
          );
        };
        input.signal.addEventListener("abort", waiter.abortListener, { once: true });
      }

      capture.waiters.set(waiterId, waiter);
    });
  }

  private async startEventCapture(input: Record<string, unknown>) {
    const session = this.resolveSessionRef(input);
    const channels = readArray(input, "channels").map((entry) => {
      if (typeof entry !== "string") {
        throw new Error("channels entries must be strings.");
      }
      return entry;
    });

    const channelSet = new Set(channels);
    const sampleMouseMove = readBoolean(input, "sampleMouseMove", false);
    const redactTextInput = readBoolean(input, "redactTextInput", true);

    if (channelSet.has("navigation") || channelSet.has("dom") || channelSet.has("dialog")) {
      await this.ensureLifecycleEventsEnabled(session.contentsId);
    }

    if (channelSet.has("network")) {
      await this.context.sendContentsCdpCommand(session.contentsId, "Network.enable");
    }

    if (
      channelSet.has("runtime")
      || channelSet.has("input")
      || channelSet.has("focus")
      || channelSet.has("selection")
      || channelSet.has("dom")
    ) {
      await this.context.sendContentsCdpCommand(session.contentsId, "Runtime.enable");
    }

    if (channelSet.has("dom")) {
      await this.context.sendContentsCdpCommand(session.contentsId, "DOM.enable");
    }

    if (channelSet.has("input") || channelSet.has("focus") || channelSet.has("selection") || channelSet.has("dom")) {
      await this.ensureInputObservationBridge(session.contentsId, {
        channels: channelSet,
        sampleMouseMove,
      });
    }

    const captureId = randomUUID();
    const startedAt = Date.now();
    const stopFunctions: Array<() => void> = [];
    const stopListening = () => {
      while (stopFunctions.length) {
        const stop = stopFunctions.pop();
        stop?.();
      }
    };

    this.captures.set(captureId, {
      captureId,
      sessionId: session.ref.sessionId,
      ref: { ...session.ref },
      contentsId: session.contentsId,
      startedAt,
      channels: channelSet,
      sampleMouseMove,
      redactTextInput,
      events: [],
      lastSeq: 0,
      droppedEvents: 0,
      waiters: new Map(),
      mutationAxSnapshots: new Map(),
      stopListening,
    });

    try {
      const stopCdpListening = await this.context.subscribeContentsCdpEvents(
        session.contentsId,
        (method, params) => {
          if (
            method === "Page.frameNavigated" &&
            (channelSet.has("input") || channelSet.has("focus") || channelSet.has("selection") || channelSet.has("dom"))
          ) {
            void this.ensureInputObservationBridge(session.contentsId, {
              channels: channelSet,
              sampleMouseMove,
            });
          }

          const mapped = this.mapCdpEventToRawEvents(
            method,
            params,
            channelSet,
            redactTextInput,
            sampleMouseMove,
          );

          const capture = this.captures.get(captureId);
          if (!capture || capture.stoppedAt) {
            return;
          }
          this.appendEventsToCapture(captureId, mapped);
        },
        { replayRecentMs: EVENT_SUBSCRIPTION_REPLAY_WINDOW_MS },
      );
      stopFunctions.push(stopCdpListening);

      if (channelSet.has("tab") || channelSet.has("download")) {
        stopFunctions.push(this.context.subscribeBrowserEvents(
          (browserEvent) => {
            const capture = this.captures.get(captureId);
            if (!capture || capture.stoppedAt) {
              return;
            }

            const mapped = this.mapBrowserEventToRawEvents(session, browserEvent, channelSet);
            this.appendEventsToCapture(captureId, mapped);
          },
          { replayRecentMs: EVENT_SUBSCRIPTION_REPLAY_WINDOW_MS },
        ));
      }
    } catch (error) {
      const capture = this.captures.get(captureId);
      if (capture) {
        this.stopCapture(capture);
        this.captures.delete(captureId);
      }
      throw error;
    }

    return {
      captureId,
      startedAt,
    };
  }

  private mapCdpEventToRawEvents(
    method: string,
    params: Record<string, unknown>,
    channels: Set<string>,
    redactTextInput: boolean,
    sampleMouseMove: boolean,
  ): RawEvent[] {
    const events: RawEvent[] = [];
    const ts = toTimestampMs(params.timestamp);

    if (channels.has("navigation")) {
      if (method === "Page.frameNavigated") {
        const frame = assertObject(params.frame, "Invalid frame payload.");
        const url = readString(frame, "url", false);
        events.push({
          kind: "page.navigation",
          ts,
          ...(url ? { url } : {}),
        });
      }

      if (method === "Page.lifecycleEvent") {
        const name = readString(params, "name", false);
        events.push({
          kind: "page.lifecycle",
          ts,
          ...(name ? { name } : {}),
        });
      }
    }

    if (channels.has("dom") && method.startsWith("DOM.")) {
      events.push({
        kind: "dom.mutation",
        ts,
        summary: method,
      });
    }

    if (channels.has("network")) {
      if (method === "Network.requestWillBeSent") {
        const requestId = readString(params, "requestId", false);
        const request = assertObject(params.request, "Invalid request payload.");
        const url = readString(request, "url", false);
        const httpMethod = readString(request, "method", false);

        events.push({
          kind: "network.request",
          ts,
          ...(requestId ? { requestId } : {}),
          ...(url ? { url } : {}),
          ...(httpMethod ? { method: httpMethod } : {}),
        });
      }

      if (method === "Network.responseReceived") {
        const requestId = readString(params, "requestId", false);
        const response = assertObject(params.response, "Invalid response payload.");
        const url = readString(response, "url", false);
        const status = readNumber(response, "status", false);

        events.push({
          kind: "network.response",
          ts,
          ...(requestId ? { requestId } : {}),
          ...(url ? { url } : {}),
          ...(typeof status === "number" ? { status: Math.round(status) } : {}),
        });
      }
    }

    if (channels.has("dialog")) {
      if (method === "Page.javascriptDialogOpening") {
        events.push({
          kind: "dialog.opened",
          ts,
          ...(readString(params, "type", false) ? { dialogType: readString(params, "type", false) } : {}),
          ...(readString(params, "message", false) ? { message: truncate(readString(params, "message", false)) } : {}),
          ...(readString(params, "defaultPrompt", false) ? { defaultPrompt: truncate(readString(params, "defaultPrompt", false)) } : {}),
        });
      }

      if (method === "Page.javascriptDialogClosed") {
        events.push({
          kind: "dialog.closed",
          ts,
          accepted: readBoolean(params, "result", false),
          ...(readString(params, "userInput", false) ? { text: truncate(readString(params, "userInput", false)) } : {}),
        });
      }
    }

    if (channels.has("runtime") || channels.has("input") || channels.has("focus") || channels.has("selection") || channels.has("dom")) {
      if (method === "Runtime.consoleAPICalled") {
        const bridgeEvent = parseInputBridgeEvent(params);
        if (bridgeEvent) {
          const sanitizedBridgeEvent = sanitizeBridgeEventForCapture(bridgeEvent, redactTextInput);
          if (channels.has("input")) {
            if (bridgeEvent.kind === "input.input") {
              const inputText = typeof bridgeEvent.text === "string" ? bridgeEvent.text : undefined;
              const styleText = typeof bridgeEvent.styleText === "string" ? bridgeEvent.styleText : undefined;
              events.push({
                ...sanitizedBridgeEvent,
                ts: ts,
                text: redactTextInput ? "[redacted]" : truncate(inputText),
                ...(!redactTextInput && styleText ? { styleText: truncate(styleText, 4_000) } : {}),
              });
            } else if (
              bridgeEvent.kind === "input.click" ||
              bridgeEvent.kind === "input.keydown" ||
              bridgeEvent.kind === "input.scroll"
            ) {
              events.push({
                ...sanitizedBridgeEvent,
                ts: ts,
              });
            } else if (bridgeEvent.kind === "input.mousemove" && sampleMouseMove) {
              events.push({
                ...sanitizedBridgeEvent,
                ts: ts,
              });
            }
          }

          if (channels.has("focus") && bridgeEvent.kind === "focus.changed") {
            events.push({
              ...sanitizedBridgeEvent,
              ts: ts,
              text: truncate(typeof sanitizedBridgeEvent.text === "string" ? sanitizedBridgeEvent.text : "focus"),
            });
          }

          if (
            channels.has("selection") &&
            bridgeEvent.kind === "selection.changed"
          ) {
            events.push({
              ...sanitizedBridgeEvent,
              ts: ts,
              text: truncate(typeof sanitizedBridgeEvent.text === "string" ? sanitizedBridgeEvent.text : undefined),
            });
          }

          if (
            channels.has("dom")
            && (bridgeEvent.kind === "dom.mutation" || bridgeEvent.kind === "dom.style" || bridgeEvent.kind === "dom.error")
          ) {
            events.push({
              ...sanitizedBridgeEvent,
              ts,
              summary: truncate(
                typeof sanitizedBridgeEvent.summary === "string"
                  ? sanitizedBridgeEvent.summary
                  : bridgeEvent.kind === "dom.error"
                    ? "error observed"
                  : bridgeEvent.kind === "dom.style"
                    ? "visual state changed"
                  : "dom mutation",
              ),
            });
          }
        }

        const args = Array.isArray(params.args)
          ? (params.args as Array<Record<string, unknown>>)
          : [];
        const text = args
          .map((arg) => {
            if (typeof arg.value === "string") {
              return arg.value;
            }
            if (arg.value !== undefined) {
              return String(arg.value);
            }
            return undefined;
          })
          .filter((entry): entry is string => Boolean(entry))
          .join(" ");

        if (text.startsWith(INPUT_BRIDGE_PREFIX)) {
          return events;
        }

        events.push({
          kind: "runtime.console",
          ts,
          level: readString(params, "type", false) ?? "log",
          text: truncate(text) ?? "console",
        });
      }

      if (method === "Runtime.exceptionThrown") {
        const exceptionDetails = assertObject(
          params.exceptionDetails,
          "Invalid exception payload.",
        );
        const text = readString(exceptionDetails, "text", false);
        events.push({
          kind: "runtime.exception",
          ts,
          level: "error",
          text: truncate(text) ?? "exception",
        });
      }
    }

    return events;
  }

  private mapBrowserEventToRawEvents(
    session: AttachedSession,
    event: BrowserAutomationEvent,
    channels: Set<string>,
  ): RawEvent[] {
    if (event.kind.startsWith("tab.") && channels.has("tab")) {
      let tabContext: ReturnType<AutomationMcpService["findTabContext"]>;
      try {
        tabContext = this.findTabContext(session.ref.tabId);
      } catch {
        return [];
      }
      if (
        event.tabId !== session.ref.tabId
        && event.openerTabId !== session.ref.tabId
        && event.windowId !== String(tabContext.windowId)
      ) {
        return [];
      }

      return [{
        kind: event.kind,
        ts: event.ts,
        ...(event.windowId ? { windowId: event.windowId } : {}),
        ...(event.tabId ? { tabId: event.tabId } : {}),
        ...(event.openerTabId ? { openerTabId: event.openerTabId } : {}),
        ...(event.url ? { url: event.url } : {}),
        ...(event.title ? { title: event.title } : {}),
        ...(event.source ? { source: event.source } : {}),
      }];
    }

    if (event.kind.startsWith("download.") && channels.has("download")) {
      if (
        event.sourceTabId
        && event.sourceTabId !== session.ref.tabId
      ) {
        return [];
      }

      return [{
        kind: event.kind,
        ts: event.ts,
        ...(event.windowId ? { windowId: event.windowId } : {}),
        ...(event.tabId ? { tabId: event.tabId } : {}),
        ...(event.downloadId ? { downloadId: event.downloadId } : {}),
        ...(event.filename ? { filename: event.filename } : {}),
        ...(event.state ? { state: event.state } : {}),
        ...(event.url ? { url: event.url } : {}),
        ...(typeof event.bytes === "number" ? { bytes: event.bytes } : {}),
        ...(typeof event.totalBytes === "number" ? { totalBytes: event.totalBytes } : {}),
        ...(event.summary ? { summary: event.summary } : {}),
        ...(event.error ? { text: event.error } : {}),
      }];
    }

    return [];
  }

  private stopCapture(capture: EventCaptureState) {
    if (capture.stoppedAt) {
      return;
    }

    capture.stoppedAt = Date.now();
    for (const waiterId of Array.from(capture.waiters.keys())) {
      this.finalizeCaptureWaiter(
        capture,
        waiterId,
        undefined,
        new Error(`Subscription ${capture.captureId} stopped while waiting for events.`),
      );
    }
    capture.stopListening();
    this.cleanupEndedCaptures();
  }

  private async stopEventCapture(input: Record<string, unknown>) {
    const captureId = readString(input, "captureId") as string;
    const capture = this.captures.get(captureId);
    if (!capture) {
      throw new Error(`Capture ${captureId} not found.`);
    }

    this.stopCapture(capture);

    return {
      captureId,
      stoppedAt: capture.stoppedAt,
      eventCount: capture.events.length,
    };
  }

  private async readEvents(input: Record<string, unknown>) {
    const captureId = readString(input, "captureId") as string;
    const capture = this.captures.get(captureId);
    if (!capture) {
      throw new Error(`Capture ${captureId} not found.`);
    }

    const afterTs = readNumber(input, "afterTs", false) ?? Number.NEGATIVE_INFINITY;
    const afterCursor = parseEventCursor(readString(input, "afterCursor", false));
    const limit = readNumber(input, "limit", false) ?? 200;

    const filtered = capture.events
      .filter((event) => {
        if (afterCursor) {
          if (event.ts > afterCursor.ts) {
            return true;
          }
          if (event.ts < afterCursor.ts) {
            return false;
          }
          return (event.seq ?? 0) > afterCursor.seq;
        }
        return event.ts > afterTs;
      })
      .sort((left, right) => {
        if (left.ts !== right.ts) {
          return left.ts - right.ts;
        }
        return (left.seq ?? 0) - (right.seq ?? 0);
      })
      .slice(0, Math.max(1, Math.floor(limit)));

    const nextCursor = filtered.length
      ? toEventCursor(filtered[filtered.length - 1])
      : undefined;

    return {
      events: filtered.map((event) => toPublicRawEvent(event)),
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  private getSnapshot(snapshotId: string): StoredSnapshot {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot ${snapshotId} not found.`);
    }

    return snapshot;
  }

  private buildPublicSnapshot(snapshot: StoredSnapshot) {
    return {
      snapshotId: snapshot.snapshotId,
      capturedAt: snapshot.capturedAt,
      url: snapshot.url,
      regions: snapshot.regions,
      forms: snapshot.forms,
      elements: snapshot.elements,
      information: snapshot.information,
      capabilities: snapshot.capabilities,
    };
  }

  private async captureStoredSnapshotForSession(session: AttachedSession): Promise<StoredSnapshot> {
    const tabContext = this.findTabContext(session.ref.tabId);
    const semanticPayload = await this.evaluateInTab<{
      regions: PageRegion[];
      forms?: PageForm[];
      elements: SemanticElement[];
      elementLocators?: Array<{ elementId: string; selector: string }>;
      regionLocators?: Array<{ regionId: string; selector: string }>;
      formLocators?: Array<{ formId: string; selector: string }>;
    }>(tabContext.contentsId, SEMANTIC_SCAN_EXPRESSION);

    const snapshotId = randomUUID();
    const capturedAt = Date.now();
    const rawRegions = Array.isArray(semanticPayload.regions) ? semanticPayload.regions : [];
    const rawForms = Array.isArray(semanticPayload.forms) ? semanticPayload.forms : [];
    const rawElements = Array.isArray(semanticPayload.elements) ? semanticPayload.elements : [];

    const regionIdMap = new Map<string, string>();
    const regions: PageRegion[] = rawRegions.map((region, index) => {
      const nextRegionId = `${snapshotId}:region-${index + 1}`;
      regionIdMap.set(region.regionId, nextRegionId);
      return {
        ...region,
        regionId: nextRegionId,
        role: normalizeRegionRole(region.role),
        childElementIds: [],
      };
    });

    const formIdMap = new Map<string, string>();
    const forms: PageForm[] = rawForms.map((form, index) => {
      const nextFormId = `${snapshotId}:form-${index + 1}`;
      formIdMap.set(form.formId, nextFormId);
      return {
        ...form,
        formId: nextFormId,
        regionId: regionIdMap.get(form.regionId) ?? form.regionId,
        controlElementIds: [],
        submitActionElementIds: [],
      };
    });

    const elementIdMap = new Map<string, string>();
    const elements: SemanticElement[] = rawElements.map((element, index) => {
      const nextElementId = `${snapshotId}:element-${index + 1}`;
      elementIdMap.set(element.elementId, nextElementId);
      return {
        ...element,
        elementId: nextElementId,
        regionId: regionIdMap.get(element.regionId) ?? element.regionId,
        formId: element.formId ? (formIdMap.get(element.formId) ?? element.formId) : undefined,
        role: normalizeElementRole(element.role),
      };
    });

    const regionById = new Map(regions.map((region) => [region.regionId, region]));
    const formById = new Map(forms.map((form) => [form.formId, form]));
    for (const element of elements) {
      const region = regionById.get(element.regionId);
      if (region) {
        region.childElementIds.push(element.elementId);
      }
      if (element.formId) {
        const form = formById.get(element.formId);
        if (form) {
          form.controlElementIds.push(element.elementId);
          const hintText = `${element.name ?? ""} ${element.associatedLabel ?? ""} ${element.text ?? ""} ${element.htmlType ?? ""}`;
          if (
            element.isPrimaryActionCandidate &&
            (element.htmlType === "submit"
              || element.role === "button"
              || element.role === "link"
              || /(submit|save|apply|create|search|continue|next|send|login|sign in|sign up|place order)/i.test(hintText))
          ) {
            form.submitActionElementIds.push(element.elementId);
          }
        }
      }
    }

    const elementLocatorById = new Map<string, string>();
    for (const entry of semanticPayload.elementLocators ?? []) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const sourceElementId = readString(record, "elementId", false);
      const selector = readString(record, "selector", false);
      const elementId = sourceElementId
        ? (elementIdMap.get(sourceElementId) ?? sourceElementId)
        : undefined;
      if (elementId && selector) {
        elementLocatorById.set(elementId, selector);
      }
    }

    const regionLocatorById = new Map<string, string>();
    for (const entry of semanticPayload.regionLocators ?? []) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const sourceRegionId = readString(record, "regionId", false);
      const selector = readString(record, "selector", false);
      const regionId = sourceRegionId
        ? (regionIdMap.get(sourceRegionId) ?? sourceRegionId)
        : undefined;
      if (regionId && selector) {
        regionLocatorById.set(regionId, selector);
      }
    }

    const formLocatorById = new Map<string, string>();
    for (const entry of semanticPayload.formLocators ?? []) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const sourceFormId = readString(record, "formId", false);
      const selector = readString(record, "selector", false);
      const formId = sourceFormId
        ? (formIdMap.get(sourceFormId) ?? sourceFormId)
        : undefined;
      if (formId && selector) {
        formLocatorById.set(formId, selector);
      }
    }

    const progressiveModel = this.buildProgressiveSnapshotModel(
      snapshotId,
      regions,
      forms.map((form) => ({
        ...form,
        controlElementIds: Array.from(new Set(form.controlElementIds)),
        submitActionElementIds: Array.from(new Set(form.submitActionElementIds)),
      })),
      elements,
    );

    const snapshot: StoredSnapshot = {
      snapshotId,
      sessionId: session.ref.sessionId,
      capturedAt,
      url: tabContext.webContents.getURL(),
      regions,
      forms: forms.map((form) => ({
        ...form,
        controlElementIds: Array.from(new Set(form.controlElementIds)),
        submitActionElementIds: Array.from(new Set(form.submitActionElementIds)),
      })),
      elements: progressiveModel.elements,
      information: progressiveModel.information,
      capabilities: progressiveModel.capabilities,
      elementLocatorById,
      regionLocatorById,
      formLocatorById,
    };

    this.snapshots.set(snapshotId, snapshot);
    this.pruneSnapshots();
    session.latestSnapshotId = snapshotId;
    return snapshot;
  }

  private async capturePageSnapshot(input: Record<string, unknown>) {
    const session = this.resolveSessionRef(input);
    const includeStyles = readBoolean(input, "includeStyles", false);
    const includeDOM = readBoolean(input, "includeDOM", true);
    const includeLayout = readBoolean(input, "includeLayout", true);
    const includeAX = readBoolean(input, "includeAX", true);

    if (includeStyles) {
      throw new Error("includeStyles is not supported by this snapshot extractor.");
    }
    if (!includeDOM || !includeLayout || !includeAX) {
      throw new Error(
        "Current snapshot extractor requires includeDOM/includeLayout/includeAX to remain true.",
      );
    }
    const snapshot = await this.captureStoredSnapshotForSession(session);
    return this.buildPublicSnapshot(snapshot);
  }

  private computeSnapshotDiff(before: StoredSnapshot, after: StoredSnapshot): SnapshotDiff {
    const beforeMain = before.regions.find((region) => region.role === "main") ?? before.regions[0];
    const afterMain = after.regions.find((region) => region.role === "main") ?? after.regions[0];
    const beforeRegionById = new Map(before.regions.map((region) => [region.regionId.split(":").pop() ?? region.regionId, region]));
    const afterRegionById = new Map(after.regions.map((region) => [region.regionId.split(":").pop() ?? region.regionId, region]));

    const changedRegionIds = uniqueStrings(
      Array.from(
        new Set([...beforeRegionById.keys(), ...afterRegionById.keys()]),
      ).map((key) => {
        const left = beforeRegionById.get(key);
        const right = afterRegionById.get(key);
        const leftText = left?.textSummary ?? "";
        const rightText = right?.textSummary ?? "";
        if (!left && right) {
          return right.regionId;
        }
        if (left && !right) {
          return left.regionId;
        }
        if (!left || !right) {
          return undefined;
        }
        const similarity = jaccardSimilarity(leftText, rightText);
        return similarity < 0.75 ? right.regionId : undefined;
      }),
    );

    const mainRegionSimilarity = jaccardSimilarity(beforeMain?.textSummary ?? "", afterMain?.textSummary ?? "");
    const mainRegionChangeRatio = Number((1 - mainRegionSimilarity).toFixed(3));
    const beforeElementState = before.elements
      .map((element) =>
        `${element.role}|${element.name ?? ""}|${element.text ?? ""}|${element.value ?? ""}|${element.checked ?? ""}|${element.selected ?? ""}|${element.visualSignature ?? ""}`,
      )
      .join("\n");
    const afterElementState = after.elements
      .map((element) =>
        `${element.role}|${element.name ?? ""}|${element.text ?? ""}|${element.value ?? ""}|${element.checked ?? ""}|${element.selected ?? ""}|${element.visualSignature ?? ""}`,
      )
      .join("\n");
    const elementSimilarity = jaccardSimilarity(beforeElementState, afterElementState);
    const beforeVisualState = before.elements
      .map((element) =>
        `element=${scopedIdTail(element.elementId) ?? element.elementId} visual=${element.visualSignature ?? "none"}`,
      )
      .join(" ");
    const afterVisualState = after.elements
      .map((element) =>
        `element=${scopedIdTail(element.elementId) ?? element.elementId} visual=${element.visualSignature ?? "none"}`,
      )
      .join(" ");
    const visualSimilarity = jaccardSimilarity(beforeVisualState, afterVisualState);
    const visibleTextChanged = jaccardSimilarity(
      before.elements.filter((element) => element.visible).map((element) => element.text ?? "").join(" "),
      after.elements.filter((element) => element.visible).map((element) => element.text ?? "").join(" "),
    ) < 0.92;
    const visualStateChanged = visualSimilarity < 0.995;
    const stateChanged = elementSimilarity < 0.97 || visualStateChanged;
    const urlChanged = before.url !== after.url;
    const domChanged = urlChanged || mainRegionChangeRatio >= 0.06 || changedRegionIds.length > 0 || elementSimilarity < 0.94;
    const significance: SnapshotDiff["significance"] = domChanged
      ? (mainRegionChangeRatio >= 0.18 || changedRegionIds.length >= 3 || urlChanged ? "major" : "minor")
      : "none";

    return {
      beforeSnapshotId: before.snapshotId,
      afterSnapshotId: after.snapshotId,
      urlChanged,
      domChanged,
      visibleTextChanged,
      stateChanged,
      changedRegionIds,
      mainRegionChangeRatio,
      significance,
      summary: domChanged
        ? `mainChange=${mainRegionChangeRatio}, regionsChanged=${changedRegionIds.length}, urlChanged=${urlChanged}, visualChanged=${visualStateChanged}`
        : visualStateChanged
          ? "No material semantic change detected, but visual state changed."
          : "No material semantic change detected.",
    };
  }

  private async resolveEventTargets(input: Record<string, unknown>) {
    const snapshotId = readString(input, "snapshotId") as string;
    const snapshot = this.getSnapshot(snapshotId);
    const events = readArray(input, "events");

    const resolvedEvents = events
      .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
      .map((entry) => {
        const raw = entry as Record<string, unknown>;
        const targetHint = readString(raw, "targetHint", false)?.toLowerCase();
        const targetRole = readString(raw, "targetRole", false)?.toLowerCase();
        const targetName = readString(raw, "targetName", false)?.toLowerCase();
        const targetLabel = readString(raw, "targetLabel", false)?.toLowerCase();
        const targetText = readString(raw, "targetText", false)?.toLowerCase();
        const x = readNumber(raw, "x", false);
        const y = readNumber(raw, "y", false);

        let resolvedElement: SemanticElement | undefined;
        let confidence = 0.2;

        if (targetHint || targetRole || targetName || targetLabel || targetText) {
          const rankedBySemanticMatch = snapshot.elements
            .map((element) => {
              let score = 0;
              const hints = (element.locatorHints ?? []).map((hint) => hint.toLowerCase());
              const elementName = (element.name ?? "").toLowerCase();
              const elementLabel = (element.associatedLabel ?? "").toLowerCase();
              const elementText = (element.text ?? "").toLowerCase();
              const elementRole = (element.role ?? "").toLowerCase();

              if (targetHint && hints.some((hint) => hint.includes(targetHint) || targetHint.includes(hint))) {
                score += 2.4;
              }
              if (targetRole && elementRole === targetRole) {
                score += 1.2;
              }
              if (targetName && elementName && (elementName.includes(targetName) || targetName.includes(elementName))) {
                score += 1.5;
              }
              if (targetLabel && elementLabel && (elementLabel.includes(targetLabel) || targetLabel.includes(elementLabel))) {
                score += 1.3;
              }
              if (targetText && elementText && (elementText.includes(targetText) || targetText.includes(elementText))) {
                score += 1.1;
              }

              return { element, score };
            })
            .filter((entry) => entry.score >= 1.2)
            .sort((left, right) => right.score - left.score);

          if (rankedBySemanticMatch.length > 0) {
            resolvedElement = rankedBySemanticMatch[0].element;
            confidence = Math.min(0.95, 0.5 + rankedBySemanticMatch[0].score / 5);
          }
        }

        if (!resolvedElement && typeof x === "number" && typeof y === "number") {
          resolvedElement = snapshot.elements.find((element) => {
            if (!element.bbox) {
              return false;
            }
            return (
              x >= element.bbox.x &&
              x <= element.bbox.x + element.bbox.width &&
              y >= element.bbox.y &&
              y <= element.bbox.y + element.bbox.height
            );
          });

          if (resolvedElement) {
            confidence = 0.65;
          }
        }

        return {
          raw,
          ...(resolvedElement
            ? {
                resolvedRegionId: resolvedElement.regionId,
                resolvedElementId: resolvedElement.elementId,
              }
            : {}),
          confidence,
        };
      });

    return {
      events: resolvedEvents,
    };
  }

  private findSnapshotElement(sessionId: string, elementId: string):
    | { snapshot: StoredSnapshot; element: SemanticElement }
    | undefined {
    const snapshots = [...this.snapshots.values()]
      .filter((snapshot) => snapshot.sessionId === sessionId)
      .sort((left, right) => right.capturedAt - left.capturedAt);

    for (const snapshot of snapshots) {
      const element = snapshot.elements.find((entry) => entry.elementId === elementId);
      if (element) {
        return { snapshot, element };
      }
    }

    return undefined;
  }

  private findSnapshotForm(sessionId: string, formId: string):
    | { snapshot: StoredSnapshot; form: PageForm }
    | undefined {
    const snapshots = [...this.snapshots.values()]
      .filter((snapshot) => snapshot.sessionId === sessionId)
      .sort((left, right) => right.capturedAt - left.capturedAt);

    for (const snapshot of snapshots) {
      const form = snapshot.forms.find((entry) => entry.formId === formId);
      if (form) {
        return { snapshot, form };
      }
    }

    return undefined;
  }

  private findSnapshotByRegionId(sessionId: string, regionId: string): StoredSnapshot | undefined {
    return [...this.snapshots.values()]
      .filter((snapshot) => snapshot.sessionId === sessionId)
      .sort((left, right) => right.capturedAt - left.capturedAt)
      .find((snapshot) => snapshot.regions.some((region) => matchesScopedId(region.regionId, regionId)));
  }

  private findSnapshotInformationBlock(sessionId: string, blockId: string):
    | { snapshot: StoredSnapshot; block: PageInformationBlock }
    | undefined {
    const snapshots = [...this.snapshots.values()]
      .filter((snapshot) => snapshot.sessionId === sessionId)
      .sort((left, right) => right.capturedAt - left.capturedAt);

    for (const snapshot of snapshots) {
      const block = snapshot.information.find((entry) => matchesScopedId(entry.blockId, blockId));
      if (block) {
        return { snapshot, block };
      }
    }

    return undefined;
  }

  private findSnapshotCapability(sessionId: string, capabilityId: string):
    | { snapshot: StoredSnapshot; capability: PageCapability }
    | undefined {
    const snapshots = [...this.snapshots.values()]
      .filter((snapshot) => snapshot.sessionId === sessionId)
      .sort((left, right) => right.capturedAt - left.capturedAt);

    for (const snapshot of snapshots) {
      const capability = snapshot.capabilities.find((entry) => matchesScopedId(entry.capabilityId, capabilityId));
      if (capability) {
        return { snapshot, capability };
      }
    }

    return undefined;
  }

  private resolveSelectorForElement(sessionId: string, elementId: string): string {
    const resolved = this.findSnapshotElement(sessionId, elementId);
    if (resolved) {
      const selector = resolved.snapshot.elementLocatorById.get(elementId);
      if (selector) {
        return selector;
      }
    }

    throw new Error(
      `Could not resolve selector for element ${elementId}. Capture a fresh semantic snapshot first.`,
    );
  }

  private buildElementActionContext(sessionId: string, elementId: string) {
    const resolved = this.findSnapshotElement(sessionId, elementId);
    if (!resolved) {
      throw new Error(
        `Could not resolve metadata for element ${elementId}. Capture a fresh semantic snapshot first.`,
      );
    }

    const { snapshot, element } = resolved;
    const selector = snapshot.elementLocatorById.get(element.elementId);
    const selectorHints = uniqueStrings([
      selector,
      ...(element.locatorHints ?? []).filter((hint) => looksLikeSelectorHint(hint)),
    ]);
    const textHints = uniqueStrings([
      ...(element.locatorHints ?? []).filter((hint) => !looksLikeSelectorHint(hint)),
      element.name,
      element.text,
      element.associatedLabel,
    ]);

    return {
      snapshot,
      targetElementId: element.elementId,
      targetFormId: element.formId,
      targetDescriptor: {
        elementId: element.elementId,
        selector,
        selectorHints,
        textHints,
        name: element.name,
        text: element.text,
        associatedLabel: element.associatedLabel,
        role: element.role,
        tagName: element.tagName,
        bbox: element.bbox,
        regionSelector: snapshot.regionLocatorById.get(element.regionId),
        formSelector: element.formId ? snapshot.formLocatorById.get(element.formId) : undefined,
        isPrimaryActionCandidate: element.isPrimaryActionCandidate,
        isHitTestable: element.isHitTestable,
        isContainer: element.isContainer,
        interactivityScore: element.interactivityScore,
      },
    };
  }

  private buildFormActionContext(sessionId: string, formId: string, submitterElementId?: string) {
    const resolved = this.findSnapshotForm(sessionId, formId);
    if (!resolved) {
      throw new Error(`Could not resolve metadata for form ${formId}. Capture a fresh semantic snapshot first.`);
    }

    const { snapshot, form } = resolved;
    let targetElementId = submitterElementId;
    if (!targetElementId) {
      targetElementId = form.submitActionElementIds[0];
    }

    let targetDescriptor: Record<string, unknown> | undefined;
    if (targetElementId) {
      const elementContext = this.buildElementActionContext(sessionId, targetElementId);
      if (elementContext.targetFormId && elementContext.targetFormId !== form.formId) {
        throw new Error(`Submitter ${targetElementId} does not belong to form ${form.formId}.`);
      }
      targetDescriptor = elementContext.targetDescriptor;
      targetElementId = elementContext.targetElementId;
    }

    return {
      snapshot,
      targetElementId,
      targetFormId: form.formId,
      targetDescriptor,
      formDescriptor: {
        formId: form.formId,
        selector: snapshot.formLocatorById.get(form.formId),
        selectorHints: uniqueStrings([
          snapshot.formLocatorById.get(form.formId),
          ...form.locatorHints.filter((hint) => looksLikeSelectorHint(hint)),
        ]),
        textHints: uniqueStrings([
          ...form.locatorHints.filter((hint) => !looksLikeSelectorHint(hint)),
          form.name,
          form.textSummary,
        ]),
        name: form.name,
        regionSelector: snapshot.regionLocatorById.get(form.regionId),
      },
    };
  }

  private buildLiveActionExpression(config: Record<string, unknown>): string {
    return `(() => {
      const config = ${JSON.stringify(config)};
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const sanitize = (value) => typeof value === 'string' ? value.trim() : '';
      const clip = (value, limit = 240) => {
        const normalized = typeof value === 'string' ? value.replace(/\\s+/g, ' ').trim() : '';
        return normalized.length > limit ? normalized.slice(0, limit - 1) + '…' : normalized;
      };
      const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
      const interactiveRoles = new Set(['button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'tab', 'menuitem']);
      const containerTags = new Set(['html', 'body', 'main', 'section', 'article', 'nav', 'aside', 'form', 'div', 'ul', 'ol', 'table', 'tbody', 'thead', 'tfoot', 'tr']);
      const candidateSelector = 'a,button,input,textarea,select,option,[role],label';
      const submitPattern = /(submit|save|apply|create|search|continue|next|send|login|sign in|sign up|place order)/i;
      const esc = (value) => {
        if (window.CSS && typeof window.CSS.escape === 'function') {
          return window.CSS.escape(value);
        }
        return String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
      };
      const selectorFor = (el) => {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return undefined;
        if (el.id) return '#' + esc(el.id);
        const testId = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-qa');
        if (testId) return '[data-testid="' + String(testId).replace(/"/g, '\\\\\\"') + '"]';
        const tag = el.tagName ? el.tagName.toLowerCase() : 'unknown';
        const name = el.getAttribute && el.getAttribute('name');
        return name ? tag + '[name="' + String(name).replace(/"/g, '\\\\\\"') + '"]' : tag;
      };
      const nameFor = (el) => clip(
        sanitize(
          el.getAttribute('aria-label')
          || el.getAttribute('name')
          || el.getAttribute('title')
          || el.getAttribute('placeholder')
          || el.getAttribute('alt')
          || '',
        ),
        120,
      );
      const labelFor = (el) => {
        if (el.labels && el.labels.length) {
          const text = clip(Array.from(el.labels).map((label) => label.innerText || label.textContent || '').join(' '), 120);
          if (text) return text;
        }
        const aria = nameFor(el);
        if (aria) return aria;
        const wrapped = el.closest ? el.closest('label') : null;
        if (wrapped) {
          const text = clip(wrapped.innerText || wrapped.textContent || '', 120);
          if (text) return text;
        }
        return undefined;
      };
      const roleFor = (el) => {
          const explicitRole = sanitize(el.getAttribute('role')).toLowerCase();
          const tag = el.tagName.toLowerCase();
          const type = sanitize(el.getAttribute('type')).toLowerCase();
          const searchHintSource = sanitize([
            el.getAttribute('aria-label'),
            el.getAttribute('placeholder'),
            el.getAttribute('name'),
            el.getAttribute('id'),
            el.getAttribute('title'),
            el.closest && el.closest('form[role="search"],[role="search"]') ? 'search' : '',
          ].filter(Boolean).join(' '));
          const looksLikeSearchInput = tag === 'input'
            && (!type || type === 'text' || type === 'search')
            && /(^|\\b)(search|query|keyword|keywords)(\\b|$)|搜索|查找|查询|检索|关键词/i.test(searchHintSource);
          if (explicitRole === 'button' || tag === 'button') return 'button';
          if (explicitRole === 'link' || tag === 'a') return 'link';
          if (explicitRole === 'searchbox' || (tag === 'input' && type === 'search') || looksLikeSearchInput) return 'searchbox';
        if (explicitRole === 'textbox' || tag === 'textarea' || (tag === 'input' && ['text', 'email', 'url', 'password', 'tel', 'number'].includes(type))) return 'textbox';
        if (explicitRole === 'checkbox' || (tag === 'input' && type === 'checkbox')) return 'checkbox';
        if (explicitRole === 'radio' || (tag === 'input' && type === 'radio')) return 'radio';
        if (explicitRole === 'combobox' || tag === 'select') return 'combobox';
        if (explicitRole === 'tab') return 'tab';
        if (explicitRole === 'menuitem') return 'menuitem';
        if (explicitRole === 'row' || tag === 'tr') return 'row';
        if (explicitRole === 'cell' || tag === 'td' || tag === 'th') return 'cell';
        if (/^h[1-6]$/.test(tag)) return 'heading';
        if (tag === 'img') return 'image';
        if (tag === 'p' || tag === 'span' || tag === 'label' || tag === 'li') return 'text';
        return explicitRole || 'unknown';
      };
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (!style || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) {
          return false;
        }
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const isHitTestable = (el, visible, enabled) => {
        if (!visible || !enabled) return false;
        const style = window.getComputedStyle(el);
        if (!style || style.pointerEvents === 'none') return false;
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) return false;
        const x = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
        const y = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit && (hit === el || el.contains(hit) || hit.contains(el)));
      };
      const inspect = (el) => {
        const rect = el.getBoundingClientRect();
        const tagName = el.tagName.toLowerCase();
        const role = roleFor(el);
        const enabled = !(el.disabled === true || el.getAttribute('aria-disabled') === 'true');
        const visible = isVisible(el);
        const hit = isHitTestable(el, visible, enabled);
        const areaRatio = (Math.max(0, rect.width) * Math.max(0, rect.height)) / Math.max(1, window.innerWidth * window.innerHeight);
        const explicitInteractive = interactiveRoles.has(role) || ['button', 'a', 'input', 'textarea', 'select', 'option'].includes(tagName);
        const childInterest = Array.from(el.children || []).filter((child) => child.matches && child.matches(candidateSelector)).length;
        const isContainer = containerTags.has(tagName) || role === 'row' || (childInterest > 1 && !explicitInteractive) || areaRatio > 0.35;
        const isRootNode = el === document.body || el === document.documentElement || !el.parentElement;
        let score = 0.05;
        if (explicitInteractive) score += 0.45;
        if (visible) score += 0.08;
        if (enabled) score += 0.08;
        if (hit) score += 0.12;
        if (nameFor(el) || labelFor(el) || clip(el.innerText || el.textContent || '', 80)) score += 0.05;
        if (isContainer) score -= 0.2;
        if (isRootNode) score -= 0.8;
        if (role === 'unknown') score -= 0.12;
        if (areaRatio > 0.4) score -= 0.2;
        score = clamp(score, 0, 1);
        return {
          role,
          tagName,
          htmlType: sanitize(el.getAttribute('type')).toLowerCase() || undefined,
          visible,
          enabled,
          isHitTestable: hit,
          isContainer,
          isLeaf: !isContainer || childInterest === 0,
          isRootNode,
          interactivityScore: Number(score.toFixed(3)),
          isPrimaryActionCandidate: visible && enabled && hit && !isRootNode && score >= 0.55 && !(isContainer && !explicitInteractive),
          areaRatio,
        };
      };
      const safeQuery = (root, selector) => {
        if (!selector || !root || typeof root.querySelector !== 'function') return null;
        try {
          return root.querySelector(selector);
        } catch {
          return null;
        }
      };
      const rootsFor = (target) => {
        const roots = [];
        if (target && target.formSelector) {
          const root = safeQuery(document, target.formSelector);
          if (root) roots.push(root);
        }
        if (target && target.regionSelector) {
          const root = safeQuery(document, target.regionSelector);
          if (root) roots.push(root);
        }
        roots.push(document);
        return Array.from(new Set(roots));
      };
      const scoreCandidate = (candidate, target) => {
        const info = inspect(candidate);
        let score = 0;
        const candidateName = (nameFor(candidate) || '').toLowerCase();
        const candidateLabel = (labelFor(candidate) || '').toLowerCase();
        const candidateText = clip(candidate.innerText || candidate.textContent || '', 160).toLowerCase();
        if (target.role && info.role === target.role) score += 1.1;
        if (target.tagName && info.tagName === target.tagName) score += 0.6;
        if (target.name && candidateName.includes(String(target.name).toLowerCase())) score += 1;
        if (target.associatedLabel && candidateLabel.includes(String(target.associatedLabel).toLowerCase())) score += 0.9;
        if (target.text && candidateText.includes(String(target.text).toLowerCase())) score += 0.8;
        for (const hint of target.textHints || []) {
          const lowered = String(hint).toLowerCase();
          if (lowered && (candidateName.includes(lowered) || candidateLabel.includes(lowered) || candidateText.includes(lowered))) {
            score += 0.45;
          }
        }
        if (target.bbox && candidate.getBoundingClientRect) {
          const rect = candidate.getBoundingClientRect();
          const dx = Math.abs((rect.left + rect.width / 2) - (target.bbox.x + target.bbox.width / 2));
          const dy = Math.abs((rect.top + rect.height / 2) - (target.bbox.y + target.bbox.height / 2));
          const distancePenalty = Math.min(1, (dx + dy) / Math.max(window.innerWidth, window.innerHeight, 1));
          score += Math.max(0, 0.6 - distancePenalty);
        }
        if (info.isHitTestable) score += 0.2;
        if (info.visible) score += 0.1;
        return score;
      };
      const resolveTarget = (target) => {
        if (!target) return { element: null, matchedBy: 'none' };
        const roots = rootsFor(target);
        for (const selector of [target.selector, ...(target.selectorHints || [])]) {
          for (const root of roots) {
            const found = safeQuery(root, selector);
            if (found) return { element: found, matchedBy: 'selector:' + selector };
          }
        }
        const candidates = [];
        for (const root of roots) {
          for (const candidate of Array.from(root.querySelectorAll(candidateSelector)).slice(0, 300)) {
            candidates.push(candidate);
          }
        }
        const deduped = Array.from(new Set(candidates));
        const ranked = deduped
          .map((candidate) => ({ candidate, score: scoreCandidate(candidate, target) }))
          .filter((entry) => entry.score >= 0.75)
          .sort((left, right) => right.score - left.score);
        if (ranked.length) {
          return { element: ranked[0].candidate, matchedBy: 'rebind-score:' + ranked[0].score.toFixed(2) };
        }
        return { element: null, matchedBy: 'not-found' };
      };
      const resolveForm = (target) => {
        if (!target) return { element: null, matchedBy: 'none' };
        for (const selector of [target.selector, ...(target.selectorHints || [])]) {
          const found = safeQuery(document, selector);
          if (found) return { element: found, matchedBy: 'selector:' + selector };
        }
        const candidates = Array.from(document.querySelectorAll('form,[role="form"],section,article,main,dialog,fieldset,div')).slice(0, 200);
        const ranked = candidates
          .map((candidate) => {
            let score = 0;
            const text = clip(candidate.innerText || candidate.textContent || '', 240).toLowerCase();
            const name = nameFor(candidate).toLowerCase();
            if (target.name && name.includes(String(target.name).toLowerCase())) score += 1;
            for (const hint of target.textHints || []) {
              const lowered = String(hint).toLowerCase();
              if (lowered && (text.includes(lowered) || name.includes(lowered))) score += 0.4;
            }
            const controlCount = candidate.querySelectorAll('input,textarea,select,[role="textbox"],[role="combobox"],[role="checkbox"],[role="radio"]').length;
            if (controlCount >= 2) score += 0.3;
            return { candidate, score };
          })
          .filter((entry) => entry.score >= 0.6)
          .sort((left, right) => right.score - left.score);
        if (ranked.length) {
          return { element: ranked[0].candidate, matchedBy: 'rebind-score:' + ranked[0].score.toFixed(2) };
        }
        return { element: null, matchedBy: 'not-found' };
      };
      const normalizeVisualToken = (value) => String(value ?? '').replace(/\\s+/g, '').toLowerCase();
      const visualStyleProps = [
        'color',
        'backgroundColor',
        'borderTopColor',
        'borderRightColor',
        'borderBottomColor',
        'borderLeftColor',
        'outlineColor',
        'textDecorationColor',
        'accentColor',
        'caretColor',
        'boxShadow',
        'opacity',
      ];
      const visualSignatureFor = (el) => {
        if (!(el instanceof Element)) return undefined;
        const style = window.getComputedStyle(el);
        if (!style) return undefined;
        const parts = visualStyleProps.map((prop) => {
          const normalized = normalizeVisualToken(style[prop]);
          return normalized ? prop + '=' + normalized : undefined;
        }).filter(Boolean);
        const ariaInvalid = sanitize(el.getAttribute('aria-invalid')).toLowerCase();
        if (ariaInvalid) parts.push('aria-invalid=' + ariaInvalid);
        if ('disabled' in el && el.disabled === true) parts.push('disabled=true');
        if ('checked' in el && el.checked === true) parts.push('checked=true');
        if ('selected' in el && el.selected === true) parts.push('selected=true');
        if (typeof el.matches === 'function' && el.matches(':focus')) parts.push('focus=true');
        if (typeof el.matches === 'function' && el.matches(':hover')) parts.push('hover=true');
        if (typeof el.matches === 'function' && el.matches(':active')) parts.push('active=true');
        if (typeof el.checkValidity === 'function') {
          try {
            parts.push('valid=' + String(el.checkValidity()));
          } catch {
            // Ignore validity checks that throw on unsupported elements.
          }
        }
        return parts.join('|') || undefined;
      };
      const serializeState = (el) => {
        if (!el) return null;
        const value = 'value' in el && typeof el.value === 'string' ? el.value : undefined;
        return {
          value,
          text: clip(el.innerText || el.textContent || '', 240),
          checked: Boolean(el.checked),
          selected: Boolean(el.selected),
          ariaExpanded: el.getAttribute('aria-expanded') || undefined,
          ariaPressed: el.getAttribute('aria-pressed') || undefined,
          ariaInvalid: sanitize(el.getAttribute('aria-invalid')).toLowerCase() || undefined,
          disabled: Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true',
          validationMessage:
            typeof el.validationMessage === 'string' && sanitize(el.validationMessage)
              ? clip(el.validationMessage, 200)
              : undefined,
          visualSignature: visualSignatureFor(el),
        };
      };
      const isEditable = (el) => Boolean(
        el
        && (
          el.isContentEditable
          || (typeof el.matches === 'function' && el.matches('input,textarea,select,[contenteditable="true"],[contenteditable=""],[contenteditable]'))
        ),
      );
      const setNativeValue = (node, nextValue) => {
        if (node instanceof HTMLInputElement) {
          const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
          if (descriptor && typeof descriptor.set === 'function') {
            descriptor.set.call(node, nextValue);
            return;
          }
        }
        if (node instanceof HTMLTextAreaElement) {
          const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
          if (descriptor && typeof descriptor.set === 'function') {
            descriptor.set.call(node, nextValue);
            return;
          }
        }
        if ('value' in node) {
          node.value = nextValue;
        }
      };
      const dispatchInputEvent = (target, type, options = {}) => {
        const eventInit = {
          bubbles: true,
          cancelable: type === 'beforeinput',
          composed: true,
          ...options,
        };
        if (typeof InputEvent === 'function') {
          return target.dispatchEvent(new InputEvent(type, eventInit));
        }
        return target.dispatchEvent(new Event(type, eventInit));
      };
      const applyEditableMutation = (target, insertedText) => {
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          const currentValue = typeof target.value === 'string' ? target.value : '';
          const selectionStart = typeof target.selectionStart === 'number' ? target.selectionStart : currentValue.length;
          const selectionEnd = typeof target.selectionEnd === 'number' ? target.selectionEnd : selectionStart;
          const nextValue = currentValue.slice(0, selectionStart) + insertedText + currentValue.slice(selectionEnd);
          setNativeValue(target, nextValue);
          const nextCursor = selectionStart + insertedText.length;
          if (typeof target.setSelectionRange === 'function') {
            try {
              target.setSelectionRange(nextCursor, nextCursor);
            } catch {
              // Ignore selection failures on unsupported inputs.
            }
          }
          return true;
        }
        if (target.isContentEditable) {
          const selection = window.getSelection();
          const hasSelection = Boolean(selection && selection.rangeCount > 0 && target.contains(selection.anchorNode));
          if (hasSelection && selection) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            range.insertNode(document.createTextNode(insertedText));
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
          } else {
            target.textContent = (target.textContent || '') + insertedText;
          }
          return true;
        }
        return false;
      };
      const centerOf = (el) => {
        const rect = el.getBoundingClientRect();
        return {
          x: Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2)),
          y: Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2)),
        };
      };
      const dispatchHover = (el) => {
        if (!el) return;
        if (typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        }
        const point = centerOf(el);
        const baseInit = { bubbles: true, cancelable: true, composed: true, view: window, clientX: point.x, clientY: point.y };
        const dispatchMouse = (type) => el.dispatchEvent(new MouseEvent(type, baseInit));
        dispatchMouse('mouseover');
        dispatchMouse('mouseenter');
        dispatchMouse('mousemove');
      };
      const dispatchKeyboard = (el) => {
        const target = el || document.activeElement || document.body;
        if (!target) return false;
        if (typeof target.focus === 'function') {
          target.focus();
        }
        const key = typeof config.key === 'string' ? config.key : '';
        const keyInit = {
          key,
          code: typeof config.code === 'string' ? config.code : undefined,
          bubbles: true,
          cancelable: true,
          composed: true,
          ctrlKey: Boolean(config.ctrlKey),
          altKey: Boolean(config.altKey),
          metaKey: Boolean(config.metaKey),
          shiftKey: Boolean(config.shiftKey),
        };
        const keyDownAccepted = target.dispatchEvent(new KeyboardEvent('keydown', keyInit));
        if (!config.dryRun) {
          if (keyDownAccepted && isEditable(target) && !keyInit.ctrlKey && !keyInit.altKey && !keyInit.metaKey) {
            if ('value' in target && typeof target.value === 'string') {
              const currentValue = target.value;
              const selectionStart = typeof target.selectionStart === 'number' ? target.selectionStart : currentValue.length;
              const selectionEnd = typeof target.selectionEnd === 'number' ? target.selectionEnd : selectionStart;
              if (key === 'Backspace') {
                const deleteStart = selectionStart === selectionEnd
                  ? Math.max(0, selectionStart - 1)
                  : selectionStart;
                const beforeInputAccepted = dispatchInputEvent(target, 'beforeinput', {
                  data: null,
                  inputType: 'deleteContentBackward',
                });
                if (beforeInputAccepted) {
                  setNativeValue(
                    target,
                    currentValue.slice(0, deleteStart) + currentValue.slice(selectionEnd),
                  );
                  if (typeof target.setSelectionRange === 'function') {
                    try {
                      target.setSelectionRange(deleteStart, deleteStart);
                    } catch {
                      // Ignore selection failures on unsupported inputs.
                    }
                  }
                  dispatchInputEvent(target, 'input', {
                    data: null,
                    inputType: 'deleteContentBackward',
                  });
                }
              } else if (key.length === 1) {
                const beforeInputAccepted = dispatchInputEvent(target, 'beforeinput', {
                  data: key,
                  inputType: 'insertText',
                });
                if (beforeInputAccepted) {
                  applyEditableMutation(target, key);
                  dispatchInputEvent(target, 'input', {
                    data: key,
                    inputType: 'insertText',
                  });
                }
              } else if (key === 'Enter' && typeof target.matches === 'function' && target.matches('textarea,[contenteditable="true"],[contenteditable=""],[contenteditable]')) {
                const beforeInputAccepted = dispatchInputEvent(target, 'beforeinput', {
                  data: '\\n',
                  inputType: 'insertLineBreak',
                });
                if (beforeInputAccepted) {
                  applyEditableMutation(target, '\\n');
                  dispatchInputEvent(target, 'input', {
                    data: '\\n',
                    inputType: 'insertLineBreak',
                  });
                }
              }
            } else if (target.isContentEditable) {
              if (key === 'Backspace') {
                const beforeInputAccepted = dispatchInputEvent(target, 'beforeinput', {
                  data: null,
                  inputType: 'deleteContentBackward',
                });
                if (beforeInputAccepted) {
                  target.textContent = (target.textContent || '').slice(0, -1);
                  dispatchInputEvent(target, 'input', {
                    data: null,
                    inputType: 'deleteContentBackward',
                  });
                }
              } else if (key.length === 1) {
                const beforeInputAccepted = dispatchInputEvent(target, 'beforeinput', {
                  data: key,
                  inputType: 'insertText',
                });
                if (beforeInputAccepted) {
                  applyEditableMutation(target, key);
                  dispatchInputEvent(target, 'input', {
                    data: key,
                    inputType: 'insertText',
                  });
                }
              } else if (key === 'Enter') {
                const beforeInputAccepted = dispatchInputEvent(target, 'beforeinput', {
                  data: '\\n',
                  inputType: 'insertLineBreak',
                });
                if (beforeInputAccepted) {
                  applyEditableMutation(target, '\\n');
                  dispatchInputEvent(target, 'input', {
                    data: '\\n',
                    inputType: 'insertLineBreak',
                  });
                }
              }
            }
          } else if ((key === 'Enter' || key === ' ') && typeof target.click === 'function') {
            target.click();
          }
        }
        target.dispatchEvent(new KeyboardEvent('keyup', keyInit));
        return true;
      };
      const typeText = async (el, nextText) => {
        if (!el) return false;
        if (typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        }
        if (typeof el.focus === 'function') {
          el.focus();
        }
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          if (typeof el.select === 'function') {
            try {
              el.select();
            } catch {
              if (typeof el.setSelectionRange === 'function' && typeof el.value === 'string') {
                try {
                  el.setSelectionRange(0, el.value.length);
                } catch {
                  // Ignore selection failures on unsupported inputs.
                }
              }
            }
          } else if (typeof el.setSelectionRange === 'function' && typeof el.value === 'string') {
            try {
              el.setSelectionRange(0, el.value.length);
            } catch {
              // Ignore selection failures on unsupported inputs.
            }
          }
          if (!String(nextText || '').length) {
            setNativeValue(el, '');
            dispatchInputEvent(el, 'input', {
              data: '',
              inputType: 'deleteContentBackward',
            });
            return true;
          }
        } else if (el.isContentEditable) {
          const selection = window.getSelection();
          if (selection) {
            const range = document.createRange();
            range.selectNodeContents(el);
            selection.removeAllRanges();
            selection.addRange(range);
          }
          if (!String(nextText || '').length) {
            el.textContent = '';
            dispatchInputEvent(el, 'input', {
              data: '',
              inputType: 'deleteContentBackward',
            });
            return true;
          }
        } else {
          return false;
        }
        for (const char of Array.from(String(nextText || ''))) {
          const key = char === '\\n' ? 'Enter' : char;
          const keyInit = {
            key,
            code: char === '\\n' ? 'Enter' : undefined,
            bubbles: true,
            cancelable: true,
            composed: true,
          };
          const keyDownAccepted = el.dispatchEvent(new KeyboardEvent('keydown', keyInit));
          if (keyDownAccepted) {
            el.dispatchEvent(new KeyboardEvent('keypress', keyInit));
            const beforeInputAccepted = dispatchInputEvent(el, 'beforeinput', {
              data: char === '\\n' ? '\\n' : char,
              inputType: char === '\\n' ? 'insertLineBreak' : 'insertText',
            });
            if (beforeInputAccepted) {
              applyEditableMutation(el, char === '\\n' ? '\\n' : char);
              dispatchInputEvent(el, 'input', {
                data: char === '\\n' ? '\\n' : char,
                inputType: char === '\\n' ? 'insertLineBreak' : 'insertText',
              });
            }
          }
          el.dispatchEvent(new KeyboardEvent('keyup', keyInit));
          await wait(16);
        }
        await wait(140);
        const suggestsSelection =
          Boolean(el.getAttribute && (
            el.getAttribute('aria-autocomplete')
            || el.getAttribute('aria-haspopup') === 'listbox'
            || el.getAttribute('aria-expanded') === 'true'
          ));
        if (!suggestsSelection && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
      };
      const dispatchDrag = (source, destination) => {
        if (!source || !destination) return false;
        if (typeof source.scrollIntoView === 'function') {
          source.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        }
        if (typeof destination.scrollIntoView === 'function') {
          destination.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        }
        const sourcePoint = centerOf(source);
        const destinationPoint = centerOf(destination);
        let dataTransfer;
        try {
          dataTransfer = typeof DataTransfer === 'function' ? new DataTransfer() : undefined;
        } catch {
          dataTransfer = undefined;
        }
        const dragInit = (clientX, clientY) => ({
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX,
          clientY,
          dataTransfer,
        });
        source.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true, view: window, clientX: sourcePoint.x, clientY: sourcePoint.y }));
        if (typeof DragEvent === 'function') {
          source.dispatchEvent(new DragEvent('dragstart', dragInit(sourcePoint.x, sourcePoint.y)));
          destination.dispatchEvent(new DragEvent('dragenter', dragInit(destinationPoint.x, destinationPoint.y)));
          destination.dispatchEvent(new DragEvent('dragover', dragInit(destinationPoint.x, destinationPoint.y)));
          destination.dispatchEvent(new DragEvent('drop', dragInit(destinationPoint.x, destinationPoint.y)));
          source.dispatchEvent(new DragEvent('dragend', dragInit(destinationPoint.x, destinationPoint.y)));
        } else {
          source.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true }));
          destination.dispatchEvent(new Event('dragenter', { bubbles: true, cancelable: true }));
          destination.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
          destination.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
          source.dispatchEvent(new Event('dragend', { bubbles: true, cancelable: true }));
        }
        destination.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, composed: true, view: window, clientX: destinationPoint.x, clientY: destinationPoint.y }));
        return true;
      };
      const bodyText = () => clip(document.body ? document.body.innerText || document.body.textContent || '' : '', 4000);
      return (async () => {
        const preFocus = selectorFor(document.activeElement);
        const preText = bodyText();
        const preUrl = window.location.href;
        const resourceBefore = performance.getEntriesByType('resource').length;
        const resolvedForm = resolveForm(config.form);
        const resolvedTarget = resolveTarget(config.target);
        let formEl = resolvedForm.element;
        let targetEl = resolvedTarget.element;
        const resolvedDestination = resolveTarget(config.destination);
        const destinationEl = resolvedDestination.element;
        if (config.actionType === 'submit_form' && !targetEl && formEl) {
          targetEl = formEl.querySelector('button[type="submit"],input[type="submit"],button,[role="button"],a,[role="link"]');
        }
        if (!formEl && targetEl && targetEl.form) {
          formEl = targetEl.form;
        }
        const info = targetEl ? inspect(targetEl) : undefined;
        if ((config.actionType === 'click' || config.actionType === 'submit_form') && targetEl && !config.force) {
          const reasons = [];
          if (info && info.isRootNode) reasons.push('root-node');
          if (info && info.isContainer && !interactiveRoles.has(info.role) && info.tagName !== 'button' && info.tagName !== 'a') reasons.push('container-target');
          if (info && info.areaRatio > 0.35) reasons.push('large-container');
          if (info && info.role === 'unknown' && !info.isHitTestable) reasons.push('unknown-not-hit-testable');
          if (info && !info.isPrimaryActionCandidate) reasons.push('not-primary-action-candidate');
          if (reasons.length) {
            return {
              accepted: false,
              reason: reasons.join(','),
              targetMatchedBy: resolvedTarget.matchedBy,
              formMatchedBy: resolvedForm.matchedBy,
              focusedElementChanged: false,
              visibleTextChanged: false,
              networkTriggered: false,
              stateChanged: false,
              urlChanged: false,
            };
          }
        }
        if ((config.actionType === 'click' || config.actionType === 'hover' || config.actionType === 'drag') && !targetEl) {
          return {
            accepted: false,
            reason: 'element-not-found',
            targetMatchedBy: resolvedTarget.matchedBy,
            formMatchedBy: resolvedForm.matchedBy,
            focusedElementChanged: false,
            visibleTextChanged: false,
            networkTriggered: false,
            stateChanged: false,
            urlChanged: false,
          };
        }
        if (config.actionType === 'drag' && !destinationEl) {
          return {
            accepted: false,
            reason: 'destination-not-found',
            targetMatchedBy: resolvedTarget.matchedBy,
            formMatchedBy: resolvedForm.matchedBy,
            focusedElementChanged: false,
            visibleTextChanged: false,
            networkTriggered: false,
            stateChanged: false,
            urlChanged: false,
          };
        }
        if ((config.actionType === 'type' || config.actionType === 'select') && !targetEl) {
          return {
            accepted: false,
            reason: 'element-not-found',
            targetMatchedBy: resolvedTarget.matchedBy,
            formMatchedBy: resolvedForm.matchedBy,
            focusedElementChanged: false,
            visibleTextChanged: false,
            networkTriggered: false,
            stateChanged: false,
            urlChanged: false,
          };
        }
        if (config.actionType === 'press' && config.target && !targetEl) {
          return {
            accepted: false,
            reason: 'element-not-found',
            targetMatchedBy: resolvedTarget.matchedBy,
            formMatchedBy: resolvedForm.matchedBy,
            focusedElementChanged: false,
            visibleTextChanged: false,
            networkTriggered: false,
            stateChanged: false,
            urlChanged: false,
          };
        }
        if (config.actionType === 'submit_form' && !formEl && !targetEl) {
          return {
            accepted: false,
            reason: 'form-not-found',
            targetMatchedBy: resolvedTarget.matchedBy,
            formMatchedBy: resolvedForm.matchedBy,
            focusedElementChanged: false,
            visibleTextChanged: false,
            networkTriggered: false,
            stateChanged: false,
            urlChanged: false,
          };
        }
        const beforeState = targetEl ? serializeState(targetEl) : serializeState(formEl);
        if (!config.dryRun) {
          if (config.actionType === 'scroll') {
            window.scrollBy({ top: Number(config.amount) || 0, left: 0, behavior: 'instant' });
          } else if (config.actionType === 'click') {
            if (targetEl && typeof targetEl.scrollIntoView === 'function') {
              targetEl.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
            }
            if (targetEl && typeof targetEl.click === 'function') {
              targetEl.click();
            } else if (targetEl) {
              targetEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            }
          } else if (config.actionType === 'hover') {
            dispatchHover(targetEl);
          } else if (config.actionType === 'type') {
            await typeText(targetEl, String(config.text || ''));
          } else if (config.actionType === 'select') {
            if ('value' in targetEl) {
              targetEl.value = String(config.value || '');
            }
            targetEl.dispatchEvent(new Event('input', { bubbles: true }));
            targetEl.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (config.actionType === 'press') {
            dispatchKeyboard(targetEl);
          } else if (config.actionType === 'drag') {
            dispatchDrag(targetEl, destinationEl);
          } else if (config.actionType === 'submit_form') {
            if (formEl instanceof HTMLFormElement && typeof formEl.requestSubmit === 'function') {
              if (targetEl && (targetEl.tagName === 'BUTTON' || (targetEl.tagName === 'INPUT' && targetEl.getAttribute('type') === 'submit'))) {
                formEl.requestSubmit(targetEl);
              } else {
                formEl.requestSubmit();
              }
            } else if (targetEl && typeof targetEl.click === 'function') {
              targetEl.click();
            } else if (formEl) {
              formEl.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            }
          }
        }
        await wait(
          config.actionType === 'click' || config.actionType === 'submit_form'
            ? 450
            : config.actionType === 'drag'
              ? 350
              : config.actionType === 'hover'
                ? 180
                : 250,
        );
        const postFocus = selectorFor(document.activeElement);
        const postText = bodyText();
        const postUrl = window.location.href;
        const resourceAfter = performance.getEntriesByType('resource').length;
        const afterState = targetEl ? serializeState(targetEl) : serializeState(formEl);
        return {
          accepted: true,
          reason: config.dryRun ? 'dry-run' : undefined,
          targetMatchedBy: resolvedTarget.matchedBy,
          formMatchedBy: resolvedForm.matchedBy,
          focusedElementChanged: preFocus !== postFocus,
          visibleTextChanged: preText !== postText,
          networkTriggered: resourceAfter > resourceBefore,
          stateChanged: JSON.stringify(beforeState) !== JSON.stringify(afterState),
          urlChanged: preUrl !== postUrl,
        };
      })();
    })()`;
  }

  private buildPostActionErrorObservationExpression(config: Record<string, unknown>): string {
    return `(() => {
      const config = ${JSON.stringify(config)};
      const sanitize = (value) => typeof value === 'string' ? value.replace(/\\s+/g, ' ').trim() : '';
      const clip = (value, limit = 200) => {
        const normalized = sanitize(value);
        return normalized.length > limit ? normalized.slice(0, limit - 1) + '…' : normalized;
      };
      const safeQuery = (root, selector) => {
        if (!root || !selector || typeof root.querySelector !== 'function') return null;
        try {
          return root.querySelector(selector);
        } catch {
          return null;
        }
      };
      const errorHintPattern = /(^|[^a-z])(error|invalid|warning|warn|danger|failed|failure|tooltip-error|tooltip_error|field-error|field_error|alert)([^a-z]|$)/i;
      const errorTextPattern = /(不能为空|必填|请选择|请填写|错误|失败|无效|不合法|required|invalid|incorrect|failed|error|please\\s+(select|choose|enter|fill)|must\\s+(select|choose|enter|fill))/i;
      const selectorFor = (el) => {
        if (!(el instanceof Element)) return undefined;
        if (el.id) return '#' + String(el.id).replace(/[^a-zA-Z0-9_-]/g, '_');
        const tag = el.tagName.toLowerCase();
        const name = el.getAttribute('name');
        if (name) return tag + '[name="' + String(name).replace(/"/g, '\\\\\\"') + '"]';
        return tag;
      };
      const isVisible = (el) => {
        if (!(el instanceof Element)) return false;
        const style = window.getComputedStyle(el);
        if (!style || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) {
          return false;
        }
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const labelFor = (el) => {
        if (!(el instanceof Element)) return undefined;
        if ('labels' in el && el.labels && el.labels.length) {
          const text = clip(Array.from(el.labels).map((label) => label.innerText || label.textContent || '').join(' '), 120);
          if (text) return text;
        }
        const wrapped = typeof el.closest === 'function' ? el.closest('label') : null;
        if (wrapped) {
          const text = clip(wrapped.innerText || wrapped.textContent || '', 120);
          if (text) return text;
        }
        return clip(
          el.getAttribute('aria-label')
          || el.getAttribute('placeholder')
          || el.getAttribute('name')
          || '',
          120,
        ) || undefined;
      };
      const rootsFor = (target) => {
        if (!target || typeof target !== 'object') {
          return [document.body || document.documentElement || document];
        }
        const roots = [];
        if (target.formSelector) {
          const formRoot = safeQuery(document, target.formSelector);
          if (formRoot) roots.push(formRoot);
        }
        if (target.regionSelector) {
          const regionRoot = safeQuery(document, target.regionSelector);
          if (regionRoot) roots.push(regionRoot);
        }
        roots.push(document.body || document.documentElement || document);
        return Array.from(new Set(roots.filter(Boolean)));
      };
      const resolveTarget = (target) => {
        if (!target || typeof target !== 'object') return null;
        const roots = rootsFor(target);
        for (const selector of [target.selector, ...(target.selectorHints || [])]) {
          for (const root of roots) {
            const found = safeQuery(root, selector);
            if (found) return found;
          }
        }
        return null;
      };
      const resolveForm = (target) => {
        if (!target || typeof target !== 'object') return null;
        for (const selector of [target.selector, ...(target.selectorHints || [])]) {
          const found = safeQuery(document, selector);
          if (found) return found;
        }
        return null;
      };
      const targetEl = resolveTarget(config.target);
      const formEl = resolveForm(config.form) || (targetEl && 'form' in targetEl ? targetEl.form : null);
      const inspectErrorNode = (node) => {
        if (!(node instanceof Element) || !isVisible(node)) return undefined;
        const role = sanitize(node.getAttribute('role')).toLowerCase();
        const ariaLive = sanitize(node.getAttribute('aria-live')).toLowerCase();
        const ariaInvalid = sanitize(node.getAttribute('aria-invalid')).toLowerCase();
        const dataState = sanitize(node.getAttribute('data-state')).toLowerCase();
        const dataStatus = sanitize(node.getAttribute('data-status')).toLowerCase();
        const dataInvalid = sanitize(node.getAttribute('data-invalid')).toLowerCase();
        const validationMessage =
          typeof node.validationMessage === 'string' && sanitize(node.validationMessage)
            ? clip(node.validationMessage, 200)
            : undefined;
        const text = clip(
          node.innerText
          || node.textContent
          || node.getAttribute('aria-label')
          || node.getAttribute('title')
          || '',
          200,
        ) || undefined;
        const errorHintSource = [
          node.id,
          node.className,
          node.getAttribute('data-testid'),
          node.getAttribute('data-test'),
          node.getAttribute('data-qa'),
          node.getAttribute('data-id'),
          dataState,
          dataStatus,
        ].filter(Boolean).join(' ');
        const roleError = role === 'alert' || role === 'alertdialog';
        const invalidState = ariaInvalid === 'true' || dataInvalid === 'true';
        const browserValidationError = typeof node.checkValidity === 'function' && (() => {
          try {
            return !node.checkValidity();
          } catch {
            return false;
          }
        })();
        const attributeError =
          errorHintPattern.test(errorHintSource)
          || ['error', 'invalid', 'danger', 'warning', 'warn', 'failed'].includes(dataState)
          || ['error', 'invalid', 'danger', 'warning', 'warn', 'failed'].includes(dataStatus);
        const liveRegionError = ['assertive', 'polite'].includes(ariaLive) && Boolean(text && errorTextPattern.test(text));
        if (!(validationMessage || roleError || invalidState || browserValidationError || attributeError || liveRegionError)) {
          return undefined;
        }
        const message =
          validationMessage
          || text
          || (invalidState || browserValidationError ? labelFor(node) : undefined)
          || undefined;
        if (!message) {
          return undefined;
        }
        return {
          message,
          selector: selectorFor(node),
        };
      };
      const candidates = [];
      const pushCandidate = (node) => {
        if (node instanceof Element) {
          candidates.push(node);
        }
      };
      pushCandidate(targetEl);
      pushCandidate(formEl);
      pushCandidate(document.activeElement);
      if (targetEl && targetEl.parentElement) {
        pushCandidate(targetEl.parentElement);
      }
      if (targetEl && typeof targetEl.closest === 'function') {
        pushCandidate(targetEl.closest('label,[role="group"],fieldset,form,section,article,div'));
      }
      if (targetEl && 'labels' in targetEl && targetEl.labels) {
        Array.from(targetEl.labels).slice(0, 2).forEach((label) => pushCandidate(label));
      }
      const roots = Array.from(new Set([
        ...rootsFor(config.target),
        ...rootsFor(config.form),
      ]));
      for (const root of roots) {
        Array.from(root.querySelectorAll('[role="alert"],[role="alertdialog"],[aria-invalid="true"],[data-invalid="true"],[aria-live],[class*="error"],[class*="invalid"],[class*="warning"],[id*="error"],[id*="invalid"],[data-state],[data-status]'))
          .slice(0, 120)
          .forEach((node) => pushCandidate(node));
      }
      const messages = [];
      const seenMessages = new Set();
      for (const node of Array.from(new Set(candidates))) {
        const detail = inspectErrorNode(node);
        if (!detail || seenMessages.has(detail.message)) {
          continue;
        }
        seenMessages.add(detail.message);
        messages.push(detail.message);
        if (messages.length >= 6) {
          break;
        }
      }
      return {
        errorObserved: messages.length > 0,
        errorMessages: messages,
      };
    })()`;
  }

  private async collectActionErrorState(
    session: AttachedSession,
    config: {
      targetDescriptor?: Record<string, unknown>;
      formDescriptor?: Record<string, unknown>;
    },
  ) {
    const result = await this.evaluateInTab<{
      errorObserved?: boolean;
      errorMessages?: string[];
    }>(
      session.contentsId,
      this.buildPostActionErrorObservationExpression({
        ...(isRecord(config.targetDescriptor) ? { target: config.targetDescriptor } : {}),
        ...(isRecord(config.formDescriptor) ? { form: config.formDescriptor } : {}),
      }),
    );

    return {
      errorObserved: Boolean(result?.errorObserved),
      errorMessages: Array.isArray(result?.errorMessages)
        ? uniqueStrings(result.errorMessages.filter((entry): entry is string => typeof entry === "string"))
        : [],
    };
  }

  private async executePreparedAction(
    session: AttachedSession,
    config: {
      actionType: "click" | "hover" | "type" | "select" | "scroll" | "press" | "drag" | "submit_form";
      emittedEvents: string[];
      dryRun: boolean;
      force: boolean;
      text?: string;
      value?: string;
      amount?: number;
      key?: string;
      code?: string;
      ctrlKey?: boolean;
      altKey?: boolean;
      metaKey?: boolean;
      shiftKey?: boolean;
      targetElementId?: string;
      targetFormId?: string;
      targetDescriptor?: Record<string, unknown>;
      destination?: Record<string, unknown>;
      formDescriptor?: Record<string, unknown>;
    },
  ) {
    const tabContext = this.findTabContext(session.ref.tabId);
    const preUrl = tabContext.webContents.getURL();
    const preTitle = tabContext.webContents.getTitle();
    const preSnapshot = await this.captureStoredSnapshotForSession(session);
    const liveResult = config.actionType === "type"
      && !config.dryRun
      && isRecord(config.targetDescriptor)
      && typeof config.text === "string"
      ? await (async () => {
        const inputText = config.text as string;
        const backendNodeId = await this.resolveBackendNodeIdForTargetDescriptor(session, config.targetDescriptor);
        if (backendNodeId === undefined) {
          return this.evaluateInTab<{
            accepted?: boolean;
            reason?: string;
            focusedElementChanged?: boolean;
            visibleTextChanged?: boolean;
            networkTriggered?: boolean;
            stateChanged?: boolean;
            urlChanged?: boolean;
          }>(
            session.contentsId,
            this.buildLiveActionExpression(config),
          );
        }
        const result = await this.performTextInputOnBackendNode(
          session,
          backendNodeId,
          inputText,
          true,
        );
        return {
          accepted: Boolean(result.ok),
          ...(result.ok ? {} : { reason: result.requiresSelection ? "requires-selection" : "text-input-failed" }),
          focusedElementChanged: false,
          visibleTextChanged: false,
          networkTriggered: false,
          stateChanged: Boolean(result.ok),
          urlChanged: false,
        };
      })()
      : await this.evaluateInTab<{
        accepted?: boolean;
        reason?: string;
        focusedElementChanged?: boolean;
        visibleTextChanged?: boolean;
        networkTriggered?: boolean;
        stateChanged?: boolean;
        urlChanged?: boolean;
      }>(
        session.contentsId,
        this.buildLiveActionExpression(config),
      );

    let postSnapshot: StoredSnapshot | undefined;
    let snapshotDiff: SnapshotDiff | undefined;
    if (!config.dryRun && liveResult.accepted) {
      postSnapshot = await this.captureStoredSnapshotForSession(session);
      snapshotDiff = this.computeSnapshotDiff(preSnapshot, postSnapshot);
    }
    const errorState = !config.dryRun && liveResult.accepted
      ? await this.collectActionErrorState(session, {
        targetDescriptor: config.targetDescriptor,
        formDescriptor: config.formDescriptor,
      })
      : { errorObserved: false, errorMessages: [] as string[] };

    const urlChanged = snapshotDiff?.urlChanged ?? Boolean(liveResult.urlChanged);
    const domChanged = snapshotDiff?.domChanged ?? Boolean(liveResult.visibleTextChanged || liveResult.stateChanged);
    const visibleTextChanged = snapshotDiff?.visibleTextChanged ?? Boolean(liveResult.visibleTextChanged);
    const stateChanged = snapshotDiff?.stateChanged ?? Boolean(liveResult.stateChanged);
    const focusedElementChanged = Boolean(liveResult.focusedElementChanged);
    const networkTriggered = Boolean(liveResult.networkTriggered);
    let effective = Boolean(liveResult.accepted) && !config.dryRun && (
      urlChanged ||
      domChanged ||
      networkTriggered ||
      focusedElementChanged ||
      visibleTextChanged ||
      stateChanged ||
      errorState.errorObserved
    );
    let reason = liveResult.reason;
    if (
      config.actionType === "click" &&
      liveResult.accepted &&
      !config.dryRun &&
      snapshotDiff &&
      snapshotDiff.significance === "none" &&
      !networkTriggered &&
      !focusedElementChanged &&
      !visibleTextChanged &&
      !stateChanged
    ) {
      effective = false;
      reason = "accepted-but-no-material-change";
    }

    const actionId = randomUUID();
    const result = {
      actionId,
      accepted: Boolean(liveResult.accepted),
      effective,
      ...(reason ? { reason } : {}),
      emittedEvents: config.emittedEvents,
      urlChanged,
      domChanged,
      networkTriggered,
      focusedElementChanged,
      visibleTextChanged,
      stateChanged,
      errorObserved: errorState.errorObserved,
      errorMessages: errorState.errorMessages,
      ...(preSnapshot ? { preSnapshotId: preSnapshot.snapshotId } : {}),
      ...(postSnapshot ? { postSnapshotId: postSnapshot.snapshotId } : {}),
      ...(config.targetElementId ? { targetElementId: config.targetElementId } : {}),
      ...(config.targetFormId ? { targetFormId: config.targetFormId } : {}),
      ...(snapshotDiff ? { snapshotDiff } : {}),
    };

    this.actions.set(actionId, {
      actionId,
      sessionId: session.ref.sessionId,
      performedAt: Date.now(),
      actionType: config.actionType,
      preUrl,
      preTitle,
      accepted: result.accepted,
      effective: result.effective,
      emittedEvents: result.emittedEvents,
      urlChanged: result.urlChanged,
      domChanged: result.domChanged,
      networkTriggered: result.networkTriggered,
      focusedElementChanged: result.focusedElementChanged,
      visibleTextChanged: result.visibleTextChanged,
      stateChanged: result.stateChanged,
      errorObserved: result.errorObserved,
      errorMessages: result.errorMessages,
      reason: result.reason,
      preSnapshotId: preSnapshot.snapshotId,
      postSnapshotId: postSnapshot?.snapshotId,
      targetElementId: config.targetElementId,
      targetFormId: config.targetFormId,
    });
    this.pruneActions();

    return result;
  }

  private resolveActionSelector(
    sessionId: string,
    action: Record<string, unknown>,
  ): { selector: string; targetHint: string } {
    const selector = readString(action, "selector", false);
    if (selector) {
      return {
        selector,
        targetHint: selector,
      };
    }

    const elementId = readString(action, "elementId", false);
    if (!elementId) {
      throw new Error("Either selector or elementId is required for this action.");
    }

    return {
      selector: this.resolveSelectorForElement(sessionId, elementId),
      targetHint: elementId,
    };
  }

  private async performAction(input: Record<string, unknown>) {
    const session = this.resolveSessionRef(input);
    const action = assertObject(input.action, "Missing action object.");
    const actionType = readString(action, "type") as "click" | "type" | "select" | "scroll";
    const dryRun = readBoolean(input, "dryRun", false);
    const force = readBoolean(action, "force", false);

    if (session.observeOnly && !dryRun) {
      throw new Error(
        "This session is observeOnly. Re-attach with observeOnly=false or use dryRun=true.",
      );
    }

    if (actionType === "scroll") {
      const direction = readString(action, "direction") as "up" | "down";
      const amount = readNumber(action, "amount", false) ?? 420;
      return this.executePreparedAction(session, {
        actionType,
        emittedEvents: ["input.scroll"],
        dryRun,
        force,
        amount: direction === "up" ? -Math.abs(amount) : Math.abs(amount),
      });
    }

    const elementId = readString(action, "elementId", false);
    const selector = readString(action, "selector", false);
    const elementContext = elementId
      ? this.buildElementActionContext(session.ref.sessionId, elementId)
      : {
          targetElementId: undefined,
          targetFormId: undefined,
          targetDescriptor: {
            selector,
            selectorHints: uniqueStrings([selector]),
            textHints: [] as string[],
          },
        };

    if (actionType === "click") {
      return this.executePreparedAction(session, {
        actionType,
        emittedEvents: ["input.click"],
        dryRun,
        force,
        targetElementId: elementContext.targetElementId,
        targetFormId: elementContext.targetFormId,
        targetDescriptor: elementContext.targetDescriptor,
      });
    }

    if (actionType === "type") {
      const text = readString(action, "text") as string;
      return this.executePreparedAction(session, {
        actionType,
        emittedEvents: ["input.input", "input.keydown"],
        dryRun,
        force,
        text,
        targetElementId: elementContext.targetElementId,
        targetFormId: elementContext.targetFormId,
        targetDescriptor: elementContext.targetDescriptor,
      });
    }

    if (actionType === "select") {
      const value = readString(action, "value") as string;
      return this.executePreparedAction(session, {
        actionType,
        emittedEvents: ["input.input"],
        dryRun,
        force,
        value,
        targetElementId: elementContext.targetElementId,
        targetFormId: elementContext.targetFormId,
        targetDescriptor: elementContext.targetDescriptor,
      });
    }

    throw new Error(`Unsupported action type: ${actionType}`);
  }

  private async submitForm(input: Record<string, unknown>) {
    const session = this.resolveSessionRef(input);
    const formId = readString(input, "formId") as string;
    const submitterElementId = readString(input, "submitterElementId", false);
    const dryRun = readBoolean(input, "dryRun", false);
    const force = readBoolean(input, "force", false);

    if (session.observeOnly && !dryRun) {
      throw new Error(
        "This session is observeOnly. Re-attach with observeOnly=false or use dryRun=true.",
      );
    }

    const formContext = this.buildFormActionContext(
      session.ref.sessionId,
      formId,
      submitterElementId,
    );

    return this.executePreparedAction(session, {
      actionType: "submit_form",
      emittedEvents: ["form.submit", "input.click"],
      dryRun,
      force,
      targetElementId: formContext.targetElementId,
      targetFormId: formContext.targetFormId,
      targetDescriptor: formContext.targetDescriptor,
      formDescriptor: formContext.formDescriptor,
    });
  }

  private async signalUrlMatches(contentsId: number, pattern: string): Promise<boolean> {
    const current = await this.evaluateInTab<string>(
      contentsId,
      "(() => window.location.href)()",
    );

    try {
      const regex = new RegExp(pattern);
      return regex.test(current);
    } catch {
      return current.includes(pattern);
    }
  }

  private async signalTextVisible(contentsId: number, text: string): Promise<boolean> {
    const expression = `(() => {
      const bodyText = document.body ? document.body.innerText || '' : '';
      return bodyText.includes(${JSON.stringify(text)});
    })()`;
    return this.evaluateInTab<boolean>(contentsId, expression);
  }

  private async signalElementVisible(sessionId: string, contentsId: number, elementId: string) {
    const context = this.buildElementActionContext(sessionId, elementId);
    const expression = `(() => {
      const config = ${JSON.stringify(context.targetDescriptor)};
      const safeQuery = (root, selector) => {
        if (!root || !selector || typeof root.querySelector !== 'function') return null;
        try {
          return root.querySelector(selector);
        } catch {
          return null;
        }
      };
      const roots = [];
      if (config.formSelector) {
        const formRoot = safeQuery(document, config.formSelector);
        if (formRoot) roots.push(formRoot);
      }
      if (config.regionSelector) {
        const regionRoot = safeQuery(document, config.regionSelector);
        if (regionRoot) roots.push(regionRoot);
      }
      roots.push(document);
      let el = null;
      for (const selector of [config.selector, ...(config.selectorHints || [])]) {
        for (const root of roots) {
          const found = safeQuery(root, selector);
          if (found) {
            el = found;
            break;
          }
        }
        if (el) break;
      }
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })()`;
    return this.evaluateInTab<boolean>(contentsId, expression);
  }

  private async evaluateOutcomeExpectations(
    session: AttachedSession,
    action: ExecutedAction,
    expectations: Array<Record<string, unknown>>,
    expectationMode: "all" | "any",
  ) {
    const tabContext = this.findTabContext(session.ref.tabId);
    const postSnapshot = await this.captureStoredSnapshotForSession(session);
    const baseSnapshot = action.preSnapshotId ? this.getSnapshot(action.preSnapshotId) : undefined;
    const snapshotDiff = baseSnapshot ? this.computeSnapshotDiff(baseSnapshot, postSnapshot) : undefined;
    const matchedExpectations: string[] = [];
    const failedExpectations: string[] = [];
    const evidence: string[] = [];

    for (const expectation of expectations) {
      const type = readString(expectation, "type") as
        | "url_changed"
        | "url_matches"
        | "text_visible"
        | "element_visible"
        | "region_visible"
        | "records_visible";

      let matched = false;
      let detail: string = type;

      if (type === "url_changed") {
        const value = readString(expectation, "value", false);
        const currentUrl = tabContext.webContents.getURL();
        matched = currentUrl !== action.preUrl;
        if (matched && value) {
          matched = await this.signalUrlMatches(session.contentsId, value);
        }
        detail = value ? `url_changed(${value})` : "url_changed";
      } else if (type === "url_matches") {
        const value = readString(expectation, "value") as string;
        matched = await this.signalUrlMatches(session.contentsId, value);
        detail = `url_matches(${value})`;
      } else if (type === "text_visible") {
        const value = readString(expectation, "value") as string;
        matched = await this.signalTextVisible(session.contentsId, value);
        detail = `text_visible(${truncate(value, 50)})`;
      } else if (type === "element_visible") {
        const elementId = readString(expectation, "elementId") as string;
        matched = await this.signalElementVisible(session.ref.sessionId, session.contentsId, elementId);
        detail = `element_visible(${elementId})`;
      } else if (type === "region_visible") {
        const regionId = readString(expectation, "regionId", false);
        const regionRole = readString(expectation, "regionRole", false);
        const text = readString(expectation, "text", false)?.toLowerCase();
        matched = postSnapshot.regions.some((region) =>
          (!regionId || matchesScopedId(region.regionId, regionId)) &&
          (!regionRole || region.role === regionRole) &&
          region.inViewport &&
          (!text || (region.textSummary ?? "").toLowerCase().includes(text))
        );
        detail = `region_visible(${regionId ?? regionRole ?? "any"})`;
      } else if (type === "records_visible") {
        const regionId = readString(expectation, "regionId", false);
        const regionRole = readString(expectation, "regionRole", false);
        const minRecords = Math.max(1, Math.floor(readNumber(expectation, "minRecords", false) ?? 1));
        const recordSchema = isRecord(expectation.recordSchema)
          ? expectation.recordSchema as Record<string, unknown>
          : undefined;
        const regionSnapshot = regionId
          ? this.findSnapshotByRegionId(session.ref.sessionId, regionId)
          : postSnapshot;
        const extracted = await this.extractStructuredRecords(session, {
          snapshotId: regionSnapshot?.snapshotId,
          extraction: {
            type: "records",
            ...(regionId ? { regionId } : {}),
            ...(regionRole ? { sourceRole: regionRole } : {}),
            minRecords,
            maxRecords: Math.max(10, minRecords * 3),
            ...(recordSchema ? { recordSchema } : {}),
          },
        });
        matched = extracted.recordCount >= minRecords && (recordSchema ? extracted.schemaValid !== false : true);
        detail = `records_visible(min=${minRecords}, count=${extracted.recordCount})`;
      }

      if (matched) {
        matchedExpectations.push(detail);
        evidence.push(detail);
      } else {
        failedExpectations.push(detail);
      }
    }

    const satisfied = expectationMode === "any"
      ? matchedExpectations.length > 0
      : expectations.length > 0 && failedExpectations.length === 0;

    return {
      satisfied,
      matchedExpectations,
      failedExpectations,
      evidence,
      postSnapshot,
      snapshotDiff,
    };
  }

  private resolveNetworkCapturesForOutcome(
    sessionId: string,
    actionPerformedAt: number,
    captureId?: string,
  ): EventCaptureState[] {
    if (captureId) {
      const capture = this.captures.get(captureId);
      if (!capture) {
        throw new AutomationToolError({
          errorCode: "INVALID_CAPTURE_ID",
          category: "validation",
          message: `captureId ${captureId} was not found.`,
          retryable: true,
          fieldPath: "$.captureId",
          expected: "existing capture id",
          suggestion:
            "Pass a valid captureId from observe.start_event_capture, or omit captureId.",
          details: { captureId },
        });
      }

      if (capture.sessionId !== sessionId) {
        throw new AutomationToolError({
          errorCode: "CAPTURE_SESSION_MISMATCH",
          category: "validation",
          message: `captureId ${captureId} does not belong to the provided session.`,
          retryable: true,
          fieldPath: "$.captureId",
          expected: "capture id for the same session",
          suggestion: "Use a captureId created on the same session as the action.",
          details: { captureId, sessionId },
        });
      }

      if (!capture.channels.has("network")) {
        throw new AutomationToolError({
          errorCode: "CAPTURE_MISSING_NETWORK_CHANNEL",
          category: "validation",
          message: `captureId ${captureId} does not include the network channel required by response_ok.`,
          retryable: true,
          fieldPath: "$.captureId",
          expected: "network-enabled capture",
          suggestion:
            "Start observe.start_event_capture with channels including \"network\" and pass that captureId.",
          details: { captureId },
        });
      }

      if (
        capture.startedAt > actionPerformedAt ||
        (capture.stoppedAt !== undefined && capture.stoppedAt < actionPerformedAt)
      ) {
        throw new AutomationToolError({
          errorCode: "CAPTURE_OUT_OF_RANGE",
          category: "validation",
          message: `captureId ${captureId} does not cover the action timing required by response_ok.`,
          retryable: true,
          fieldPath: "$.captureId",
          expected: "capture that started before the action and remained active through it",
          suggestion:
            "Start the network capture before execute.perform_action and keep it active until the outcome is observed.",
          details: { captureId, actionPerformedAt },
        });
      }

      return [capture];
    }

    const relatedCaptures = Array.from(this.captures.values()).filter((capture) => {
      if (capture.sessionId !== sessionId || !capture.channels.has("network")) {
        return false;
      }

      if (capture.startedAt > actionPerformedAt) {
        return false;
      }

      if (capture.stoppedAt !== undefined && capture.stoppedAt < actionPerformedAt) {
        return false;
      }

      return true;
    });

    if (!relatedCaptures.length) {
      throw new AutomationToolError({
        errorCode: "NETWORK_CAPTURE_REQUIRED",
        category: "validation",
        message:
          "response_ok successSignals require a network event capture that started before the action.",
        retryable: true,
        suggestion:
          "Start observe.start_event_capture with channels including \"network\" before execute.perform_action, then pass the returned captureId to execute.observe_outcome.",
        details: { sessionId, actionPerformedAt },
      });
    }

    return relatedCaptures;
  }

  private signalResponseOk(
    captures: EventCaptureState[],
    actionPerformedAt: number,
    urlPattern: string,
  ): boolean {
    for (const capture of captures) {
      for (const event of capture.events) {
        if (event.ts < actionPerformedAt) {
          continue;
        }
        if (event.kind !== "network.response") {
          continue;
        }

        const url = typeof event.url === "string" ? event.url : "";
        const status = typeof event.status === "number" ? event.status : 0;
        if (status >= 200 && status < 400 && url.includes(urlPattern)) {
          return true;
        }
      }
    }

    return false;
  }

  private async observeOutcome(input: Record<string, unknown>) {
    const session = this.resolveSessionRef(input);
    const actionId = readString(input, "actionId") as string;
    const captureId = readString(input, "captureId", false);
    const action = this.actions.get(actionId);
    if (!action) {
      throw new Error(`Unknown actionId: ${actionId}`);
    }

    if (action.sessionId !== session.ref.sessionId) {
      throw new Error("actionId does not belong to the provided session.");
    }

    const tabContext = this.findTabContext(session.ref.tabId);
    const timeoutMs = Math.max(200, Math.floor(readNumber(input, "timeoutMs", false) ?? 4_000));
    const successSignals = readArray(input, "successSignals", false).filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
    );
    const expectations = readArray(input, "expectations", false).filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
    );
    const expectationMode = (readString(input, "expectationMode", false) ?? "all") as "all" | "any";
    const needsNetworkCapture = successSignals.some(
      (signal) => readString(signal, "type", false) === "response_ok",
    );
    const networkCaptures = needsNetworkCapture
      ? this.resolveNetworkCapturesForOutcome(
          session.ref.sessionId,
          action.performedAt,
          captureId,
        )
      : [];

    if (!action.accepted) {
      return {
        status: "failure",
        evidence: [action.reason ?? `Action ${actionId} was not accepted.`],
        matchedExpectations: [],
        failedExpectations: expectations.map((expectation) => readString(expectation, "type") as string),
      };
    }

    if (!successSignals.length && !expectations.length) {
      const currentUrl = tabContext.webContents.getURL();
      if (currentUrl !== action.preUrl || action.effective) {
        return {
          status: "success",
          evidence: [
            currentUrl !== action.preUrl
              ? `URL changed from ${action.preUrl} to ${currentUrl}`
              : `Action effect detected: urlChanged=${action.urlChanged}, domChanged=${action.domChanged}, networkTriggered=${action.networkTriggered}, stateChanged=${action.stateChanged}`,
          ],
          ...(action.postSnapshotId && action.preSnapshotId
            ? {
                postSnapshotId: action.postSnapshotId,
                snapshotDiff: this.computeSnapshotDiff(
                  this.getSnapshot(action.preSnapshotId),
                  this.getSnapshot(action.postSnapshotId),
                ),
              }
            : {}),
        };
      }

      return {
        status: "failure",
        evidence: [action.reason ?? "No expectations provided and no material effect detected."],
      };
    }

    const deadline = Date.now() + timeoutMs;
    let lastMatchedExpectations: string[] = [];
    let lastFailedExpectations: string[] = expectations.map((expectation) => readString(expectation, "type") as string);
    let lastEvidence: string[] = [];
    let lastPostSnapshotId: string | undefined;
    let lastSnapshotDiff: SnapshotDiff | undefined;
    while (Date.now() <= deadline) {
      const evidence: string[] = [];
      let legacySignalMatched = false;

      for (const signal of successSignals) {
        const type = readString(signal, "type") as
          | "url_matches"
          | "text_visible"
          | "response_ok"
          | "element_visible";

        if (type === "url_matches") {
          const value = readString(signal, "value") as string;
          if (await this.signalUrlMatches(session.contentsId, value)) {
            evidence.push(`url_matches(${value})`);
            legacySignalMatched = true;
          }
          continue;
        }

        if (type === "text_visible") {
          const value = readString(signal, "value") as string;
          if (await this.signalTextVisible(session.contentsId, value)) {
            evidence.push(`text_visible(${truncate(value, 50)})`);
            legacySignalMatched = true;
          }
          continue;
        }

        if (type === "response_ok") {
          const value = readString(signal, "value") as string;
          if (this.signalResponseOk(networkCaptures, action.performedAt, value)) {
            evidence.push(`response_ok(${value})`);
            legacySignalMatched = true;
          }
          continue;
        }

        if (type === "element_visible") {
          const elementId = readString(signal, "elementId") as string;
          if (await this.signalElementVisible(session.ref.sessionId, session.contentsId, elementId)) {
            evidence.push(`element_visible(${elementId})`);
            legacySignalMatched = true;
          }
        }
      }

      if (expectations.length) {
        const expectationResult = await this.evaluateOutcomeExpectations(
          session,
          action,
          expectations,
          expectationMode,
        );
        lastMatchedExpectations = expectationResult.matchedExpectations;
        lastFailedExpectations = expectationResult.failedExpectations;
        lastEvidence = expectationResult.evidence;
        lastPostSnapshotId = expectationResult.postSnapshot.snapshotId;
        lastSnapshotDiff = expectationResult.snapshotDiff;

        if (
          expectationResult.satisfied &&
          (!successSignals.length || legacySignalMatched)
        ) {
          return {
            status: "success",
            evidence: [...evidence, ...expectationResult.evidence],
            matchedExpectations: expectationResult.matchedExpectations,
            failedExpectations: expectationResult.failedExpectations,
            postSnapshotId: expectationResult.postSnapshot.snapshotId,
            ...(expectationResult.snapshotDiff ? { snapshotDiff: expectationResult.snapshotDiff } : {}),
          };
        }
      } else if (evidence.length) {
        return {
          status: "success",
          evidence,
        };
      }

      await sleep(200);
    }

    if (expectations.length) {
      return {
        status: lastFailedExpectations.length ? "failure" : "unknown",
        evidence: lastEvidence.length
          ? lastEvidence
          : [`Expectations were not satisfied within ${timeoutMs}ms after action ${actionId}.`],
        matchedExpectations: lastMatchedExpectations,
        failedExpectations: lastFailedExpectations,
        ...(lastPostSnapshotId ? { postSnapshotId: lastPostSnapshotId } : {}),
        ...(lastSnapshotDiff ? { snapshotDiff: lastSnapshotDiff } : {}),
      };
    }

    return {
      status: "timeout",
      evidence: [
        `No success signal matched within ${timeoutMs}ms after action ${actionId}.`,
      ],
    };
  }
}

export function createAutomationMcpService(context: AutomationMcpContext) {
  return new AutomationMcpService(context);
}
