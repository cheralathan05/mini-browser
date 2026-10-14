import { createHash } from "node:crypto";
import { URL } from "node:url";
import type { OpenAICompatibleBackendConfig } from "../agent/openai-compatible-backend.js";
import type { AutomationMcpService } from "../mcp/automation-mcp.js";
import type { LearningPreferences } from "../state/app-settings.js";
import { refineLearningHistoryProfileWithLlm } from "./learning-history-profiler.js";
import { generateLearningInputAssistText } from "./learning-input-assistant.js";
import { learnEpisodeWithLlm } from "./learning-episode-learner.js";
import { refineLearningStyleProfileWithLlm } from "./learning-style-profiler.js";
import { createLearningStore } from "./learning-store.js";
import type {
  LearningCatalog,
  LearningExtractionObservationInput,
  LearningExtractionRecipeSearchInput,
  LearningExtractionRecipeSearchResult,
  LearningFlushResult,
  LearningGuidanceDetail,
  LearningGuidanceSearchInput,
  LearningGuidanceSearchResult,
  LearningInputAssistActionInput,
  LearningInputAssistActionResult,
  LearningInputAssistContext,
  LearningInputAssistContextInput,
  LearningPageSnapshotInput,
  LearningPromptContextInput,
  LearningRawEvent,
  LearningSummary,
  LearningSummaryInput,
  LearningTaskPauseStage,
  LearningTaskStatus,
  LearningUserMemorySignalInput,
  LearningUserMemoryUpsertInput,
  LearningWritingContextType,
  LearningWritingSample,
  LearningWritingSlot,
} from "./types.js";

interface CreateLearningServiceOptions {
  automationService: AutomationMcpService;
  getLearningPreferences: () => LearningPreferences;
  setLearningPreferences: (input?: Partial<LearningPreferences> | null) => LearningPreferences;
  resolveLearningBackend?: () => OpenAICompatibleBackendConfig | null;
  getTabIdForContentsId: (contentsId: number) => string | undefined;
  getHistoryRecordsForWorkspace?: (workspaceId: string) => Array<{
    title: string;
    url: string;
    createdAt: number;
    updatedAt: number;
    lastVisitedAt: number;
    visitCount: number;
  }>;
  getAllHistoryRecords?: () => Array<{
    title: string;
    url: string;
    createdAt: number;
    updatedAt: number;
    lastVisitedAt: number;
    visitCount: number;
  }>;
  statePath: string;
  backupPath: string;
  tempPath: string;
}

interface BrowserSessionRef {
  sessionId: string;
  tabId: string;
  frameId?: string;
  userId?: string;
}

interface ActiveObserver {
  workspaceId: string;
  targetContentsId: number;
  tabId: string;
  domain: string;
  session: BrowserSessionRef;
  subscriptionId: string;
  cursor?: Record<string, unknown>;
  timer: NodeJS.Timeout | null;
  pollInFlight: boolean;
  lastSnapshotAt: number;
  stopped: boolean;
}

interface ActiveWritingBuffer {
  key: string;
  workspaceId: string;
  domain: string;
  ts: number;
  lastUpdatedAt: number;
  contextType: LearningWritingContextType;
  slot: LearningWritingSlot;
  text: string;
  charCount: number;
  wordCount: number;
  scheme?: string;
  pageType?: string;
  url?: string;
  pageTitle?: string;
  fieldHint?: string;
  recipientKey?: string;
  recipientLabel?: string;
}

interface CapturedObserverPageSnapshot {
  pageSnapshotId: string;
  cleanup: () => void;
}

interface RuntimePauseState {
  reason: "llm_error";
  stage: LearningTaskPauseStage;
  message: string;
  at: number;
}

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const ERROR_RETRY_POLL_INTERVAL_MS = 5_000;
const OBSERVER_EVENT_READ_LIMIT = 80;
const OBSERVER_PAGE_SNAPSHOT_MIN_INTERVAL_MS = 60_000;
const EPISODE_LEARNING_DELAY_MS = 15_000;
const HISTORY_PROFILE_REFINEMENT_DELAY_MS = 30_000;
const STYLE_PROFILE_REFINEMENT_DELAY_MS = 30_000;
const LEARNING_MAINTENANCE_DELAY_MS = 5_000;
const LEARNING_MAINTENANCE_YIELD_MS = 16;
const LEARNING_MAINTENANCE_EPISODE_BATCH_SIZE = 1;
const LEARNING_MAINTENANCE_HISTORY_BATCH_SIZE = 1;
const LEARNING_MAINTENANCE_STYLE_BATCH_SIZE = 1;
const LEARNING_MAINTENANCE_RAW_EVENT_BATCH_SIZE = 1_000;
const WRITING_BUFFER_IDLE_MS = 4_000;
const LEARNING_OBSERVER_CHANNELS = ["input", "navigation", "focus", "tab", "download"];
const SENSITIVE_TEXT_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\b(?:\+?\d[\d\s\-()]{6,}\d)\b/g,
  /\b[A-Z0-9]{6,}(?:[-_][A-Z0-9]{2,})+\b/gi,
  /\b\d{8,}\b/g,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Number(value) : undefined;
}

function yieldLearningMaintenance() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, LEARNING_MAINTENANCE_YIELD_MS);
  });
}

function normalizeWritingContextType(value: unknown): LearningWritingContextType | undefined {
  switch (value) {
    case "email":
    case "forum":
    case "article_editor":
    case "general_editor":
      return value;
    default:
      return undefined;
  }
}

function normalizeWritingSlot(value: unknown): LearningWritingSlot | undefined {
  switch (value) {
    case "subject":
    case "body":
    case "title":
    case "comment":
    case "message":
    case "recipient":
    case "unknown":
      return value;
    default:
      return undefined;
  }
}

function normalizeWritingText(value: unknown, maxLength = 4_000) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim();
  if (!normalized) {
    return undefined;
  }
  void maxLength;
  return normalized;
}

function normalizeWritingHint(value: unknown, maxLength = 120) {
  const normalized = normalizeWritingText(value, maxLength);
  return normalized ? normalized.replace(/\s+/g, " ") : undefined;
}

function normalizeWritingRecipient(value: unknown, maxLength = 160) {
  const normalized = normalizeWritingHint(value, maxLength);
  return normalized ? normalized.replace(/\s*,\s*/g, ", ") : undefined;
}

function normalizeWritingRecipientKey(value: unknown) {
  const normalized = normalizeWritingRecipient(value)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return normalized
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateStatusMessage(value: string, maxLength = 220) {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }
  void maxLength;
  return normalized;
}

function inferPageType(url: string | undefined) {
  if (!url) {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.trim().replace(/\/+/g, "/");
    if (!path || path === "/") {
      return "home";
    }
    const segment = path.split("/").filter(Boolean)[0];
    return segment || "home";
  } catch {
    return undefined;
  }
}

function countWritingWords(text: string) {
  const matches = text.match(/[\u4e00-\u9fff]|[a-z0-9]+(?:['’-][a-z0-9]+)*/gi);
  return matches?.length ?? 0;
}

function buildWritingSampleId(input: {
  workspaceId: string;
  domain: string;
  contextType: LearningWritingContextType;
  slot: LearningWritingSlot;
  recipientKey?: string;
  text: string;
}) {
  return hashText([
    input.workspaceId,
    input.domain,
    input.contextType,
    input.slot,
    input.recipientKey ?? "",
    input.text,
  ].join("|"));
}

function buildWritingBufferKey(input: {
  workspaceId: string;
  domain: string;
  contextType: LearningWritingContextType;
  slot: LearningWritingSlot;
  fieldHint?: string;
  recipientKey?: string;
  surfaceKey?: string;
}) {
  return [
    input.workspaceId,
    input.domain,
    input.contextType,
    input.slot,
    input.recipientKey ?? "",
    input.fieldHint ?? "",
    input.surfaceKey ?? "",
  ].join("|");
}

function minWritingCharsForSlot(slot: LearningWritingSlot) {
  switch (slot) {
    case "subject":
    case "title":
      return 8;
    case "body":
    case "comment":
    case "message":
      return 24;
    default:
      return 12;
  }
}

function inferDomain(url: string | undefined) {
  if (!url) {
    return "unknown";
  }
  try {
    return new URL(url).hostname || "unknown";
  } catch {
    return "unknown";
  }
}

function inferScheme(url: string | undefined) {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).protocol.trim().toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

function matchesBlacklistedDomain(domain: string | undefined, blacklistDomains: string[]) {
  if (!domain) {
    return false;
  }
  const normalizedDomain = domain.trim().toLowerCase();
  if (!normalizedDomain) {
    return false;
  }
  return blacklistDomains.some((entry) =>
    normalizedDomain === entry || normalizedDomain.endsWith(`.${entry}`));
}

function isRedactedPlaceholder(value: string | undefined) {
  return typeof value === "string" && /^\[redacted\]$/i.test(value.trim());
}

function isLearnableUrl(url: string | undefined) {
  const scheme = inferScheme(url);
  if (scheme === "milo:") {
    return false;
  }
  return inferDomain(url) !== "unknown";
}

function normalizeSessionRef(result: unknown): BrowserSessionRef | null {
  if (!isRecord(result) || !isRecord(result.session)) {
    return null;
  }
  const sessionId = readString(result.session.sessionId);
  const tabId = readString(result.session.tabId);
  if (!sessionId || !tabId) {
    return null;
  }
  return {
    sessionId,
    tabId,
    ...(readString(result.session.frameId) ? { frameId: readString(result.session.frameId) } : {}),
    ...(readString(result.session.userId) ? { userId: readString(result.session.userId) } : {}),
  };
}

function normalizeSubscription(result: unknown) {
  if (!isRecord(result) || !isRecord(result.subscription)) {
    return null;
  }
  const subscriptionId = readString(result.subscription.subscriptionId);
  if (!subscriptionId) {
    return null;
  }
  return {
    subscriptionId,
    cursor: isRecord(result.subscription.cursor) ? result.subscription.cursor : undefined,
  };
}

function normalizeEvents(workspaceId: string, result: unknown): Array<LearningRawEvent> {
  if (!isRecord(result) || !Array.isArray(result.events)) {
    return [];
  }

  return result.events.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }
    const kind = readString(entry.kind);
    const ts = readNumber(entry.ts);
    if (!kind || ts === undefined) {
      return [];
    }
    const url = readString(entry.url);
    const scheme = inferScheme(url);
    return [{
      id: `${workspaceId}:${ts}:${kind}:${Math.random().toString(36).slice(2, 8)}`,
      workspaceId,
      domain: inferDomain(url),
      ts,
      kind,
      ...(scheme ? { scheme } : {}),
      ...(readString(entry.tabId) ? { tabId: readString(entry.tabId) } : {}),
      ...(url ? { url } : {}),
      ...(readString(entry.title) ? { title: readString(entry.title) } : {}),
      ...(readString(entry.source) ? { source: readString(entry.source) } : {}),
      ...(readString(entry.summary) ? { summary: readString(entry.summary) } : {}),
      ...(readString(entry.targetHint) ? { targetHint: readString(entry.targetHint) } : {}),
      ...(readString(entry.targetRole) ? { targetRole: readString(entry.targetRole) } : {}),
      ...(readString(entry.targetName) ? { targetName: readString(entry.targetName) } : {}),
      ...(readString(entry.targetLabel) ? { targetLabel: readString(entry.targetLabel) } : {}),
      ...(readString(entry.targetText) ? { targetText: readString(entry.targetText) } : {}),
      ...(readString(entry.text) ? { text: readString(entry.text) } : {}),
    } satisfies LearningRawEvent];
  });
}

function normalizeWritingBufferCandidate(
  workspaceId: string,
  entry: Record<string, unknown>,
): ActiveWritingBuffer | null {
  const contextType = normalizeWritingContextType(entry.writingContextType);
  const slot = normalizeWritingSlot(entry.writingSlot);
  if (!contextType || !slot || slot === "recipient") {
    return null;
  }

  const text = normalizeWritingText(entry.styleText ?? entry.text);
  if (!text || isRedactedPlaceholder(text) || text.length < minWritingCharsForSlot(slot)) {
    return null;
  }

  const url = readString(entry.url);
  const domain = inferDomain(url);
  if (domain === "unknown") {
    return null;
  }

  const recipientKey = normalizeWritingRecipientKey(entry.writingRecipient);
  const fieldHint = normalizeWritingHint(entry.writingFieldHint);
  const surfaceKey = readString(entry.writingSurfaceKey);
  const ts = readNumber(entry.ts) ?? Date.now();
  return {
    key: buildWritingBufferKey({
      workspaceId,
      domain,
      contextType,
      slot,
      ...(fieldHint ? { fieldHint } : {}),
      ...(recipientKey ? { recipientKey } : {}),
      ...(surfaceKey ? { surfaceKey } : {}),
    }),
    workspaceId,
    domain,
    ts,
    lastUpdatedAt: ts,
    contextType,
    slot,
    text,
    charCount: text.length,
    wordCount: countWritingWords(text),
    ...(inferScheme(url) ? { scheme: inferScheme(url) } : {}),
    ...(inferPageType(url) ? { pageType: inferPageType(url) } : {}),
    ...(url ? { url } : {}),
    ...(readString(entry.title) ? { pageTitle: readString(entry.title) } : {}),
    ...(fieldHint ? { fieldHint } : {}),
    ...(recipientKey ? { recipientKey } : {}),
    ...(normalizeWritingRecipient(entry.writingRecipient) ? { recipientLabel: normalizeWritingRecipient(entry.writingRecipient) } : {}),
  };
}

function readWritingFocusKey(entry: Record<string, unknown>, workspaceId: string) {
  const contextType = normalizeWritingContextType(entry.writingContextType);
  const slot = normalizeWritingSlot(entry.writingSlot);
  const surfaceKey = readString(entry.writingSurfaceKey);
  const url = readString(entry.url);
  const domain = inferDomain(url);
  if (!contextType || !slot || domain === "unknown") {
    return undefined;
  }
  return buildWritingBufferKey({
    workspaceId,
    domain,
    contextType,
    slot,
    ...(normalizeWritingHint(entry.writingFieldHint) ? { fieldHint: normalizeWritingHint(entry.writingFieldHint) } : {}),
    ...(normalizeWritingRecipientKey(entry.writingRecipient) ? { recipientKey: normalizeWritingRecipientKey(entry.writingRecipient) } : {}),
    ...(surfaceKey ? { surfaceKey } : {}),
  });
}

function normalizeTextList(values: unknown, limit: number, maxLength: number) {
  if (!Array.isArray(values)) {
    return [];
  }
  const result: string[] = [];
  const maxCount = Math.max(0, Math.floor(limit));
  const maxTextLength = Math.max(1, Math.floor(maxLength));
  for (const entry of values) {
    if (typeof entry !== "string") {
      continue;
    }
    const value = entry.trim().slice(0, maxTextLength).trim();
    if (!value || result.includes(value)) {
      continue;
    }
    result.push(value);
    if (maxCount > 0 && result.length >= maxCount) {
      break;
    }
  }
  return result;
}

function sanitizeSnapshotUrl(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = new URL(value);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return value;
  }
}

function scrubSensitiveText(value: string) {
  let next = value;
  for (const pattern of SENSITIVE_TEXT_PATTERNS) {
    next = next.replace(pattern, "[redacted]");
  }
  return next.replace(/\s+/g, " ").trim();
}

function sanitizeSnapshotText(
  value: unknown,
  input: {
    redact: boolean;
    maxLength: number;
    keywordFallback?: boolean;
  },
) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = scrubSensitiveText(value);
  if (!normalized) {
    return undefined;
  }
  if (input.redact) {
    if (!input.keywordFallback) {
      return undefined;
    }
    const keywords = normalizeTextList(normalized.split(/\s+/), 12, 24)
      .filter((entry) => !/\[redacted\]/i.test(entry));
    if (keywords.length === 0) {
      return undefined;
    }
    return keywords.join(" ");
  }
  return normalized.length > input.maxLength
    ? normalized.slice(0, input.maxLength).trim()
    : normalized;
}

function shouldCapturePageSnapshot(events: LearningRawEvent[]) {
  return events.some((event) =>
    event.kind === "page.navigation"
    || event.kind.startsWith("download.")
    || event.kind.startsWith("tab."));
}

function hashText(value: string) {
  return createHash("sha1")
    .update(value)
    .digest("hex");
}

export function createLearningService(options: CreateLearningServiceOptions) {
  const store = createLearningStore({
    statePath: options.statePath,
    backupPath: options.backupPath,
    tempPath: options.tempPath,
    getPreferences: options.getLearningPreferences,
    getHistoryRecordsForWorkspace: options.getHistoryRecordsForWorkspace,
    getAllHistoryRecords: options.getAllHistoryRecords,
  });
  const observers = new Map<string, ActiveObserver>();
  const syncVersions = new Map<string, number>();
  const workspaceTargets = new Map<string, number | undefined>();
  const episodeLearningTimers = new Map<string, NodeJS.Timeout>();
  const episodeLearningVersions = new Map<string, number>();
  const episodeLearningControllers = new Map<string, AbortController>();
  const historyProfileTimers = new Map<string, NodeJS.Timeout>();
  const historyProfileVersions = new Map<string, number>();
  const historyProfileControllers = new Map<string, AbortController>();
  const styleProfileTimers = new Map<string, NodeJS.Timeout>();
  const styleProfileVersions = new Map<string, number>();
  const styleProfileControllers = new Map<string, AbortController>();
  const writingBuffers = new Map<string, ActiveWritingBuffer>();
  let runtimePauseState: RuntimePauseState | null = null;
  let learningMaintenanceTimer: NodeJS.Timeout | null = null;
  let learningMaintenanceVersion = 0;

  function isBlacklistedLearningDomain(domain: string | undefined) {
    return matchesBlacklistedDomain(domain, options.getLearningPreferences().blacklistDomains);
  }

  function discardBlockedWritingBuffers(input?: { clearAll?: boolean }) {
    for (const [key, buffer] of writingBuffers.entries()) {
      if (input?.clearAll || isBlacklistedLearningDomain(buffer.domain)) {
        writingBuffers.delete(key);
      }
    }
  }

  function isAdaptiveLearningEnabled() {
    return options.getLearningPreferences().mode === "on";
  }

  function pauseLearningForLlmError(stage: LearningTaskPauseStage, error: unknown) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const message = truncateStatusMessage(rawMessage || "Unknown LLM error.");
    runtimePauseState = {
      reason: "llm_error",
      stage,
      message,
      at: Date.now(),
    };

    if (options.getLearningPreferences().mode !== "off") {
      options.setLearningPreferences({ mode: "off" });
    }
    applyPreferencesChanged();
  }

  function cancelEpisodeLearning(episodeId: string) {
    const timer = episodeLearningTimers.get(episodeId);
    if (timer) {
      clearTimeout(timer);
      episodeLearningTimers.delete(episodeId);
    }

    const controller = episodeLearningControllers.get(episodeId);
    if (controller) {
      controller.abort(new Error("Episode learning superseded."));
      episodeLearningControllers.delete(episodeId);
    }
  }

  function scheduleEpisodeLearning(episodeId: string, delayMs = EPISODE_LEARNING_DELAY_MS) {
    if (!isAdaptiveLearningEnabled()) {
      return;
    }

    const normalizedEpisodeId = episodeId.trim();
    if (!normalizedEpisodeId) {
      return;
    }

    cancelEpisodeLearning(normalizedEpisodeId);
    const nextVersion = (episodeLearningVersions.get(normalizedEpisodeId) ?? 0) + 1;
    episodeLearningVersions.set(normalizedEpisodeId, nextVersion);
    const timer = setTimeout(() => {
      episodeLearningTimers.delete(normalizedEpisodeId);
      void runEpisodeLearning(normalizedEpisodeId, nextVersion);
    }, delayMs);
    episodeLearningTimers.set(normalizedEpisodeId, timer);
  }

  async function runEpisodeLearning(episodeId: string, version: number) {
    if (!isAdaptiveLearningEnabled()) {
      return { success: false };
    }

    const backend = options.resolveLearningBackend?.();
    if (!backend) {
      return { success: false };
    }

    const context = store.getEpisodeLearningContext(episodeId);
    if (!context || context.events.length === 0) {
      return { success: false };
    }

    const controller = new AbortController();
    episodeLearningControllers.set(episodeId, controller);

    try {
      const learningResult = await learnEpisodeWithLlm({
        backend,
        context,
        signal: controller.signal,
      });
      if (!learningResult || episodeLearningVersions.get(episodeId) !== version) {
        return { success: false };
      }
      return store.applyEpisodeLearningResult(learningResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!controller.signal.aborted && !/aborted|superseded/i.test(message)) {
        store.markEpisodeLearningDeferred(episodeId);
        console.error("Failed to learn episode assets:", error);
        pauseLearningForLlmError("episode_learning", error);
      }
      return { success: false };
    } finally {
      const activeController = episodeLearningControllers.get(episodeId);
      if (activeController === controller) {
        episodeLearningControllers.delete(episodeId);
      }
      if (isAdaptiveLearningEnabled()) {
        scheduleLearningMaintenance();
      }
    }
  }

  function scheduleExistingEpisodeLearning(limit = LEARNING_MAINTENANCE_EPISODE_BATCH_SIZE) {
    if (!isAdaptiveLearningEnabled()) {
      return;
    }

    const activeCount = episodeLearningTimers.size + episodeLearningControllers.size;
    const availableSlots = Math.max(0, limit - activeCount);
    if (availableSlots === 0) {
      return;
    }

    const pendingLimit = availableSlots + activeCount;
    let scheduledCount = 0;
    for (const episodeId of store.getPendingEpisodeLearningIds({ limit: pendingLimit })) {
      if (episodeLearningTimers.has(episodeId) || episodeLearningControllers.has(episodeId)) {
        continue;
      }
      scheduleEpisodeLearning(episodeId);
      scheduledCount += 1;
      if (scheduledCount >= availableSlots) {
        break;
      }
    }
  }

  function cancelHistoryProfileLearning(profileKey: string) {
    const timer = historyProfileTimers.get(profileKey);
    if (timer) {
      clearTimeout(timer);
      historyProfileTimers.delete(profileKey);
    }

    const controller = historyProfileControllers.get(profileKey);
    if (controller) {
      controller.abort(new Error("History profile learning superseded."));
      historyProfileControllers.delete(profileKey);
    }
  }

  function scheduleHistoryProfileLearning(
    profileKey: string,
    delayMs = HISTORY_PROFILE_REFINEMENT_DELAY_MS,
  ) {
    if (!isAdaptiveLearningEnabled()) {
      return;
    }

    const normalizedProfileKey = profileKey.trim();
    if (!normalizedProfileKey) {
      return;
    }

    cancelHistoryProfileLearning(normalizedProfileKey);
    const nextVersion = (historyProfileVersions.get(normalizedProfileKey) ?? 0) + 1;
    historyProfileVersions.set(normalizedProfileKey, nextVersion);
    const timer = setTimeout(() => {
      historyProfileTimers.delete(normalizedProfileKey);
      void runHistoryProfileLearning(normalizedProfileKey, nextVersion);
    }, delayMs);
    historyProfileTimers.set(normalizedProfileKey, timer);
  }

  async function runHistoryProfileLearning(profileKey: string, version: number) {
    if (!isAdaptiveLearningEnabled()) {
      return { success: false };
    }

    const backend = options.resolveLearningBackend?.();
    if (!backend) {
      return { success: false };
    }

    const context = store.getHistoryProfileLearningContext(profileKey);
    if (!context) {
      return { success: false };
    }

    const controller = new AbortController();
    historyProfileControllers.set(profileKey, controller);

    try {
      const profile = await refineLearningHistoryProfileWithLlm({
        backend,
        context,
        signal: controller.signal,
      });
      if (!profile || historyProfileVersions.get(profileKey) !== version) {
        return { success: false };
      }
      return store.applyHistoryProfile(profile);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!controller.signal.aborted && !/aborted|superseded/i.test(message)) {
        store.markHistoryProfileLearningDeferred(profileKey);
        console.error("Failed to learn browsing history profile:", error);
        pauseLearningForLlmError("history_profile_refinement", error);
      }
      return { success: false };
    } finally {
      const activeController = historyProfileControllers.get(profileKey);
      if (activeController === controller) {
        historyProfileControllers.delete(profileKey);
      }
      if (isAdaptiveLearningEnabled()) {
        scheduleLearningMaintenance();
      }
    }
  }

  function scheduleRelevantHistoryProfileLearning(input?: {
    workspaceId?: string;
    domain?: string;
    limit?: number;
  }) {
    if (!isAdaptiveLearningEnabled()) {
      return;
    }

    const pendingLimit = (input?.limit ?? LEARNING_MAINTENANCE_HISTORY_BATCH_SIZE)
      + historyProfileTimers.size
      + historyProfileControllers.size;
    const activeCount = historyProfileTimers.size + historyProfileControllers.size;
    const availableSlots = Math.max(0, (input?.limit ?? LEARNING_MAINTENANCE_HISTORY_BATCH_SIZE) - activeCount);
    if (availableSlots === 0) {
      return;
    }

    let scheduledCount = 0;
    for (const profileKey of store.getPendingHistoryProfileKeys({
      ...input,
      limit: pendingLimit,
    })) {
      if (historyProfileTimers.has(profileKey) || historyProfileControllers.has(profileKey)) {
        continue;
      }
      scheduleHistoryProfileLearning(profileKey);
      scheduledCount += 1;
      if (scheduledCount >= availableSlots) {
        break;
      }
    }
  }

  async function flushPendingHistoryProfileLearning(input?: {
    workspaceIds?: string[];
  }) {
    const pendingKeys = new Set<string>();
    for (const key of store.getPendingHistoryProfileKeys({ limit: 6 })) {
      pendingKeys.add(key);
    }
    for (const workspaceId of input?.workspaceIds ?? []) {
      for (const key of store.getPendingHistoryProfileKeys({ workspaceId, limit: 4 })) {
        pendingKeys.add(key);
      }
    }

    for (const profileKey of pendingKeys) {
      cancelHistoryProfileLearning(profileKey);
      const nextVersion = (historyProfileVersions.get(profileKey) ?? 0) + 1;
      historyProfileVersions.set(profileKey, nextVersion);
      await runHistoryProfileLearning(profileKey, nextVersion);
    }
  }

  async function flushPendingEpisodeLearning() {
    const episodeIds = store.getPendingEpisodeLearningIds();
    const guidanceCountBefore = store.getSummary().guidanceCount;
    let learnedEpisodeCount = 0;

    for (const episodeId of episodeIds) {
      cancelEpisodeLearning(episodeId);
      const nextVersion = (episodeLearningVersions.get(episodeId) ?? 0) + 1;
      episodeLearningVersions.set(episodeId, nextVersion);
      const result = await runEpisodeLearning(episodeId, nextVersion);
      if (result.success) {
        learnedEpisodeCount += 1;
      }
    }

    const guidanceCountAfter = store.getSummary().guidanceCount;
    return {
      learnedEpisodeCount,
      learnedGuidanceCount: Math.max(0, guidanceCountAfter - guidanceCountBefore),
    };
  }

  function cancelStyleProfileRefinement(profileId: string) {
    const timer = styleProfileTimers.get(profileId);
    if (timer) {
      clearTimeout(timer);
      styleProfileTimers.delete(profileId);
    }

    const controller = styleProfileControllers.get(profileId);
    if (controller) {
      controller.abort(new Error("Learning style profile refinement superseded."));
      styleProfileControllers.delete(profileId);
    }
  }

  function scheduleStyleProfileRefinement(
    profileId: string,
    delayMs = STYLE_PROFILE_REFINEMENT_DELAY_MS,
  ) {
    if (!isAdaptiveLearningEnabled()) {
      return;
    }

    const normalizedProfileId = profileId.trim();
    if (!normalizedProfileId) {
      return;
    }

    cancelStyleProfileRefinement(normalizedProfileId);
    const nextVersion = (styleProfileVersions.get(normalizedProfileId) ?? 0) + 1;
    styleProfileVersions.set(normalizedProfileId, nextVersion);
    const timer = setTimeout(() => {
      styleProfileTimers.delete(normalizedProfileId);
      void runStyleProfileRefinement(normalizedProfileId, nextVersion);
    }, delayMs);
    styleProfileTimers.set(normalizedProfileId, timer);
  }

  async function runStyleProfileRefinement(profileId: string, version: number) {
    if (!isAdaptiveLearningEnabled()) {
      return;
    }

    const backend = options.resolveLearningBackend?.();
    if (!backend) {
      return;
    }

    const context = store.getStyleProfileRefinementContext(profileId);
    if (!context || context.samples.length === 0) {
      return;
    }

    const controller = new AbortController();
    styleProfileControllers.set(profileId, controller);

    try {
      const profile = await refineLearningStyleProfileWithLlm({
        backend,
        context,
        signal: controller.signal,
      });
      if (!profile || styleProfileVersions.get(profileId) !== version) {
        return;
      }
      store.applyStyleProfile(profile);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!controller.signal.aborted && !/aborted|superseded/i.test(message)) {
        store.markStyleProfileLearningDeferred(profileId);
        console.error("Failed to refine learning style profile:", error);
        pauseLearningForLlmError("style_profile_refinement", error);
      }
    } finally {
      const activeController = styleProfileControllers.get(profileId);
      if (activeController === controller) {
        styleProfileControllers.delete(profileId);
      }
      if (isAdaptiveLearningEnabled()) {
        scheduleLearningMaintenance();
      }
    }
  }

  function scheduleExistingStyleProfileRefinements(limit = LEARNING_MAINTENANCE_STYLE_BATCH_SIZE) {
    if (!isAdaptiveLearningEnabled()) {
      return;
    }

    const activeCount = styleProfileTimers.size + styleProfileControllers.size;
    const availableSlots = Math.max(0, limit - activeCount);
    if (availableSlots === 0) {
      return;
    }

    const pendingLimit = availableSlots + activeCount;
    let scheduledCount = 0;
    for (const profileId of store.getPendingStyleProfileGroupKeys({ limit: pendingLimit })) {
      if (styleProfileTimers.has(profileId) || styleProfileControllers.has(profileId)) {
        continue;
      }
      scheduleStyleProfileRefinement(profileId);
      scheduledCount += 1;
      if (scheduledCount >= availableSlots) {
        break;
      }
    }
  }

  async function flushPendingStyleProfileRefinements(input?: {
    workspaceIds?: string[];
  }) {
    const pendingIds = store.getPendingStyleProfileGroupKeys({
      ...(input?.workspaceIds ? { workspaceIds: input.workspaceIds } : {}),
      limit: 160,
    });

    for (const profileId of pendingIds) {
      cancelStyleProfileRefinement(profileId);
      const nextVersion = (styleProfileVersions.get(profileId) ?? 0) + 1;
      styleProfileVersions.set(profileId, nextVersion);
      await runStyleProfileRefinement(profileId, nextVersion);
    }
  }

  function cancelLearningMaintenanceTimer() {
    if (learningMaintenanceTimer) {
      clearTimeout(learningMaintenanceTimer);
      learningMaintenanceTimer = null;
    }
  }

  function scheduleLearningMaintenance(delayMs = LEARNING_MAINTENANCE_DELAY_MS) {
    cancelLearningMaintenanceTimer();
    const version = learningMaintenanceVersion + 1;
    learningMaintenanceVersion = version;
    learningMaintenanceTimer = setTimeout(() => {
      learningMaintenanceTimer = null;
      void runLearningMaintenance(version);
    }, delayMs);
  }

  async function runLearningMaintenance(version: number) {
    try {
      store.applyPreferencesChanged();
      if (learningMaintenanceVersion !== version || !isAdaptiveLearningEnabled()) {
        return;
      }

      await yieldLearningMaintenance();
      if (learningMaintenanceVersion !== version || !isAdaptiveLearningEnabled()) {
        return;
      }
      const deferredLearning = store.flushOpenEpisodes({
        maxEventCount: LEARNING_MAINTENANCE_RAW_EVENT_BATCH_SIZE,
      });

      await yieldLearningMaintenance();
      if (learningMaintenanceVersion !== version || !isAdaptiveLearningEnabled()) {
        return;
      }
      scheduleExistingEpisodeLearning(LEARNING_MAINTENANCE_EPISODE_BATCH_SIZE);

      await yieldLearningMaintenance();
      if (learningMaintenanceVersion !== version || !isAdaptiveLearningEnabled()) {
        return;
      }
      scheduleRelevantHistoryProfileLearning({
        limit: LEARNING_MAINTENANCE_HISTORY_BATCH_SIZE,
      });

      await yieldLearningMaintenance();
      if (learningMaintenanceVersion !== version || !isAdaptiveLearningEnabled()) {
        return;
      }
      scheduleExistingStyleProfileRefinements(LEARNING_MAINTENANCE_STYLE_BATCH_SIZE);
      if (deferredLearning.hasMore) {
        scheduleLearningMaintenance();
      }
    } catch (error) {
      console.error("Failed to run learning maintenance:", error);
    }
  }

  function finalizeWritingBuffer(buffer: ActiveWritingBuffer): LearningWritingSample | null {
    if (buffer.text.length < minWritingCharsForSlot(buffer.slot)) {
      return null;
    }
    return {
      sampleId: buildWritingSampleId({
        workspaceId: buffer.workspaceId,
        domain: buffer.domain,
        contextType: buffer.contextType,
        slot: buffer.slot,
        ...(buffer.recipientKey ? { recipientKey: buffer.recipientKey } : {}),
        text: buffer.text,
      }),
      workspaceId: buffer.workspaceId,
      domain: buffer.domain,
      ts: buffer.ts,
      text: buffer.text,
      charCount: buffer.charCount,
      wordCount: buffer.wordCount,
      contextType: buffer.contextType,
      slot: buffer.slot,
      ...(buffer.scheme ? { scheme: buffer.scheme } : {}),
      ...(buffer.pageType ? { pageType: buffer.pageType } : {}),
      ...(buffer.url ? { url: buffer.url } : {}),
      ...(buffer.pageTitle ? { pageTitle: buffer.pageTitle } : {}),
      ...(buffer.fieldHint ? { fieldHint: buffer.fieldHint } : {}),
      ...(buffer.recipientKey ? { recipientKey: buffer.recipientKey } : {}),
      ...(buffer.recipientLabel ? { recipientLabel: buffer.recipientLabel } : {}),
    };
  }

  function flushWritingBuffersForWorkspace(
    workspaceId: string,
    input?: {
      now?: number;
      exceptKey?: string;
      force?: boolean;
    },
  ) {
    const now = input?.now ?? Date.now();
    const samples: LearningWritingSample[] = [];
    for (const [key, buffer] of writingBuffers.entries()) {
      if (buffer.workspaceId !== workspaceId) {
        continue;
      }
      if (input?.exceptKey && key === input.exceptKey) {
        continue;
      }
      if (!input?.force && now - buffer.lastUpdatedAt < WRITING_BUFFER_IDLE_MS) {
        continue;
      }
      const sample = finalizeWritingBuffer(buffer);
      if (sample) {
        samples.push(sample);
      }
      writingBuffers.delete(key);
    }
    return samples;
  }

  function recordWritingSamplesForWorkspace(workspaceId: string, samples: LearningWritingSample[]) {
    if (samples.length === 0) {
      return;
    }
    const result = store.recordWritingSamples({ samples });
    if (!result.success) {
      return;
    }
    for (const profileId of result.groupKeys) {
      scheduleStyleProfileRefinement(profileId);
    }
  }

  function buildActiveWritingProgress(): LearningCatalog["activeProgress"] {
    return [...writingBuffers.values()]
      .filter((buffer) => !isBlacklistedLearningDomain(buffer.domain))
      .map((buffer): LearningCatalog["activeProgress"][number] => {
        const contentPreview = normalizeWritingHint(buffer.text, 180);
        const targetSummary = [
          buffer.fieldHint,
          buffer.recipientLabel,
        ]
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
          .join(" · ");

        return {
          progressId: `writing:${buffer.key}`,
          mode: "learn_writing_style",
          workspaceId: buffer.workspaceId,
          domain: buffer.domain,
          ...(buffer.url ? { url: buffer.url } : {}),
          ...(buffer.pageTitle ? { pageTitle: buffer.pageTitle } : {}),
          ...(buffer.pageType ? { pageType: buffer.pageType } : {}),
          updatedAt: buffer.lastUpdatedAt,
          eventCount: 1,
          methods: ["typing"],
          ...(targetSummary ? { targetSummary } : {}),
          ...(contentPreview ? { contentPreview } : {}),
          ...(buffer.contextType ? { contextType: buffer.contextType } : {}),
          ...(buffer.slot ? { slot: buffer.slot } : {}),
          ...(buffer.fieldHint ? { fieldHint: buffer.fieldHint } : {}),
          ...(buffer.recipientLabel ? { recipientLabel: buffer.recipientLabel } : {}),
          charCount: buffer.charCount,
          wordCount: buffer.wordCount,
        };
      })
      .sort((left, right) =>
        right.updatedAt - left.updatedAt
        || (right.charCount ?? 0) - (left.charCount ?? 0)
        || left.domain.localeCompare(right.domain));
  }

  function buildTaskStatus(activeProgress: LearningCatalog["activeProgress"]): LearningTaskStatus {
    const preferences = options.getLearningPreferences();
    const activeDomains = Array.from(new Set([
      ...[...observers.values()].map((observer) => observer.domain),
      ...activeProgress.map((progress) => progress.domain),
    ]))
      .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
      .sort((left, right) => left.localeCompare(right));
    const activeWorkflowCount = activeProgress.filter((entry) => entry.mode === "observe_workflow").length;
    const activeWritingCount = activeProgress.filter((entry) => entry.mode === "learn_writing_style").length;
    const hasRunningWork =
      observers.size > 0
      || activeWorkflowCount > 0
      || activeWritingCount > 0
      || episodeLearningTimers.size > 0
      || episodeLearningControllers.size > 0
      || historyProfileTimers.size > 0
      || historyProfileControllers.size > 0
      || styleProfileTimers.size > 0
      || styleProfileControllers.size > 0;

    return {
      state: preferences.mode === "off"
        ? (runtimePauseState?.reason === "llm_error" ? "error_paused" : "paused")
        : (hasRunningWork ? "running" : "idle"),
      mode: preferences.mode,
      ...(preferences.mode === "off"
        ? { pauseReason: runtimePauseState?.reason ?? "manual" as const }
        : {}),
      ...(runtimePauseState?.stage ? { pauseStage: runtimePauseState.stage } : {}),
      ...(runtimePauseState?.message ? { pauseMessage: runtimePauseState.message } : {}),
      ...(runtimePauseState?.at ? { pauseAt: runtimePauseState.at } : {}),
      observerCount: observers.size,
      activeWorkflowCount,
      activeWritingCount,
      queuedGuidanceRefinementCount: episodeLearningTimers.size,
      runningGuidanceRefinementCount: episodeLearningControllers.size,
      queuedHistoryProfileRefinementCount: historyProfileTimers.size,
      runningHistoryProfileRefinementCount: historyProfileControllers.size,
      queuedStyleProfileRefinementCount: styleProfileTimers.size,
      runningStyleProfileRefinementCount: styleProfileControllers.size,
      activeDomains,
    };
  }

  function updateWritingBuffersFromResult(workspaceId: string, result: unknown) {
    if (!isRecord(result) || !Array.isArray(result.events)) {
      return;
    }

    const finalizedSamples: LearningWritingSample[] = [];
    for (const entry of result.events) {
      if (!isRecord(entry)) {
        continue;
      }
      const kind = readString(entry.kind);
      if (!kind) {
        continue;
      }

      if (kind === "focus.changed") {
        const focusKey = readWritingFocusKey(entry, workspaceId);
        finalizedSamples.push(...flushWritingBuffersForWorkspace(workspaceId, {
          now: readNumber(entry.ts) ?? Date.now(),
          ...(focusKey ? { exceptKey: focusKey } : {}),
          force: true,
        }));
        continue;
      }

      if (kind === "page.navigation" || kind === "tab.created") {
        finalizedSamples.push(...flushWritingBuffersForWorkspace(workspaceId, {
          now: readNumber(entry.ts) ?? Date.now(),
          force: true,
        }));
        continue;
      }

      if (kind !== "input.input") {
        continue;
      }

      const candidate = normalizeWritingBufferCandidate(workspaceId, entry);
      if (!candidate || isBlacklistedLearningDomain(candidate.domain)) {
        continue;
      }

      const existing = writingBuffers.get(candidate.key);
      if (existing) {
        existing.text = candidate.text;
        existing.charCount = candidate.charCount;
        existing.wordCount = candidate.wordCount;
        existing.lastUpdatedAt = candidate.lastUpdatedAt;
        existing.ts = candidate.ts;
        existing.url = candidate.url ?? existing.url;
        existing.pageTitle = candidate.pageTitle ?? existing.pageTitle;
        existing.pageType = candidate.pageType ?? existing.pageType;
        existing.fieldHint = candidate.fieldHint ?? existing.fieldHint;
        existing.recipientKey = candidate.recipientKey ?? existing.recipientKey;
        existing.recipientLabel = candidate.recipientLabel ?? existing.recipientLabel;
      } else {
        writingBuffers.set(candidate.key, candidate);
      }
    }

    finalizedSamples.push(...flushWritingBuffersForWorkspace(workspaceId));
    recordWritingSamplesForWorkspace(workspaceId, finalizedSamples);
  }

  async function captureObserverPageSnapshot(
    observer: ActiveObserver,
    events: LearningRawEvent[],
  ): Promise<CapturedObserverPageSnapshot | undefined> {
    if (!events.length || !shouldCapturePageSnapshot(events) || isBlacklistedLearningDomain(observer.domain)) {
      return undefined;
    }

    const preferences = options.getLearningPreferences();
    const latestEventTs = events.reduce((maxTs, event) => Math.max(maxTs, event.ts), 0) || Date.now();
    if (observer.lastSnapshotAt > 0 && latestEventTs - observer.lastSnapshotAt < OBSERVER_PAGE_SNAPSHOT_MIN_INTERVAL_MS) {
      return undefined;
    }

    const snapshotEvent = [...events]
      .reverse()
      .find((event) => event.url || event.title || event.summary || event.targetHint)
      ?? events.at(-1);
    const snapshotUrl = sanitizeSnapshotUrl(snapshotEvent?.url);
    if (!snapshotUrl) {
      return undefined;
    }

    const eventTextSummary = normalizeTextList(
      [...events]
        .reverse()
        .flatMap((event) => [
          event.summary,
          event.targetHint,
          event.targetRole,
          event.targetName,
          event.targetLabel,
          event.targetText,
          event.title,
        ]),
      16,
      80,
    ).join(" · ");

    const snapshotInput: LearningPageSnapshotInput = {
      workspaceId: observer.workspaceId,
      tabId: observer.tabId,
      ts: latestEventTs,
      redacted: preferences.redactTextInput,
      url: snapshotUrl,
      title: sanitizeSnapshotText(snapshotEvent?.title, {
        redact: preferences.redactTextInput,
        maxLength: 120,
        keywordFallback: true,
      }),
      bodyText: sanitizeSnapshotText(eventTextSummary, {
        redact: preferences.redactTextInput,
        maxLength: 240,
        keywordFallback: true,
      }),
      regions: [],
      forms: [],
      information: [],
      capabilities: [],
      dataKeys: normalizeTextList([
        observer.domain,
        ...events.flatMap((event) => [
          event.summary,
          event.targetHint,
          event.targetRole,
          event.targetName,
          event.targetLabel,
          event.targetText,
          event.title,
        ]),
      ], 20, 64),
    };

    if (
      !snapshotInput.url
      && !snapshotInput.title
      && !snapshotInput.bodyText
      && (snapshotInput.regions?.length ?? 0) === 0
      && (snapshotInput.forms?.length ?? 0) === 0
      && (snapshotInput.information?.length ?? 0) === 0
      && (snapshotInput.capabilities?.length ?? 0) === 0
    ) {
      return undefined;
    }

    const pageSnapshotId = store.recordPageSnapshot(snapshotInput).pageSnapshotId;
    if (!pageSnapshotId) {
      return undefined;
    }
    observer.lastSnapshotAt = latestEventTs;

    return {
      pageSnapshotId,
      cleanup() {},
    };
  }

  function schedulePoll(workspaceId: string, delayMs = DEFAULT_POLL_INTERVAL_MS) {
    const observer = observers.get(workspaceId);
    if (!observer || observer.stopped) {
      return;
    }

    if (observer.timer) {
      clearTimeout(observer.timer);
    }
    observer.timer = setTimeout(() => {
      void pollObserver(workspaceId);
    }, delayMs);
  }

  async function pollObserver(workspaceId: string) {
    const observer = observers.get(workspaceId);
    if (!observer || observer.stopped || observer.pollInFlight) {
      return;
    }

    observer.pollInFlight = true;
    try {
      const result = await options.automationService.callTool("browser_events_read", {
        subscriptionId: observer.subscriptionId,
        ...(observer.cursor ? { cursor: observer.cursor } : {}),
        limit: OBSERVER_EVENT_READ_LIMIT,
      });
      const active = observers.get(workspaceId);
      if (!active || active !== observer || observer.stopped) {
        return;
      }

      if (isRecord(result) && isRecord(result.nextCursor)) {
        observer.cursor = result.nextCursor;
      }

      updateWritingBuffersFromResult(workspaceId, result);
      const events = normalizeEvents(workspaceId, result);
      const scopedEvents: LearningRawEvent[] = [];
      for (const event of events) {
        if (event.url) {
          if (!isLearnableUrl(event.url)) {
            continue;
          }
          observer.domain = event.domain;
        }
        if (event.domain === "unknown" && observer.domain !== "unknown") {
          event.domain = observer.domain;
        }
        if (isBlacklistedLearningDomain(event.domain)) {
          continue;
        }
        scopedEvents.push(event);
      }

      if (scopedEvents.length > 0) {
        let capturedSnapshot: CapturedObserverPageSnapshot | undefined;
        try {
          capturedSnapshot = await captureObserverPageSnapshot(observer, scopedEvents);
        } catch {
          capturedSnapshot = undefined;
        }
        try {
          store.ingestEvents({
            workspaceId,
            events: capturedSnapshot?.pageSnapshotId
              ? scopedEvents.map((event) => ({
                ...event,
                pageSnapshotId: capturedSnapshot.pageSnapshotId,
              }))
              : scopedEvents,
          });
          scheduleExistingEpisodeLearning();
        } finally {
          capturedSnapshot?.cleanup();
        }
      }
      schedulePoll(workspaceId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not found|stopped|no longer available/i.test(message)) {
        void stopObserver(workspaceId);
        return;
      }
      schedulePoll(workspaceId, ERROR_RETRY_POLL_INTERVAL_MS);
    } finally {
      const active = observers.get(workspaceId);
      if (active === observer) {
        observer.pollInFlight = false;
      }
    }
  }

  async function stopObserver(workspaceId: string) {
    const observer = observers.get(workspaceId);
    recordWritingSamplesForWorkspace(
      workspaceId,
      flushWritingBuffersForWorkspace(workspaceId, { force: true }),
    );
    if (!observer) {
      return;
    }

    observers.delete(workspaceId);
    observer.stopped = true;
    if (observer.timer) {
      clearTimeout(observer.timer);
      observer.timer = null;
    }

    try {
      await options.automationService.callTool("browser_events_unsubscribe", {
        subscriptionId: observer.subscriptionId,
      });
    } catch {
      // Ignore cleanup failures for stale observers.
    }

    try {
      await options.automationService.callTool("browser_session_close", {
        session: observer.session,
      });
    } catch {
      // Ignore cleanup failures for stale observers.
    }
  }

  async function startObserver(workspaceId: string, targetContentsId: number, tabId: string) {
    const preferences = options.getLearningPreferences();
    const opened = await options.automationService.callTool("browser_session_open", {
      tabId,
      observeOnly: true,
    });
    const session = normalizeSessionRef(opened);
    if (!session) {
      throw new Error(`Failed to create learning observer session for tab ${tabId}.`);
    }
    const openedUrl = isRecord(opened) ? readString(opened.url) : undefined;
    const observedDomain = inferDomain(openedUrl);
    if (!isLearnableUrl(openedUrl) || observedDomain === "unknown" || isBlacklistedLearningDomain(observedDomain)) {
      try {
        await options.automationService.callTool("browser_session_close", { session });
      } catch {
        // Ignore cleanup failure.
      }
      return;
    }

    const subscribed = await options.automationService.callTool("browser_events_subscribe", {
      session,
      channels: LEARNING_OBSERVER_CHANNELS,
      redactTextInput: preferences.redactTextInput,
      sampleMouseMove: false,
    });
    const subscription = normalizeSubscription(subscribed);
    if (!subscription) {
      try {
        await options.automationService.callTool("browser_session_close", { session });
      } catch {
        // Ignore cleanup failure.
      }
      throw new Error(`Failed to create learning observer subscription for tab ${tabId}.`);
    }

    observers.set(workspaceId, {
      workspaceId,
      targetContentsId,
      tabId,
      domain: observedDomain,
      session,
      subscriptionId: subscription.subscriptionId,
      cursor: subscription.cursor,
      timer: null,
      pollInFlight: false,
      lastSnapshotAt: 0,
      stopped: false,
    });
    schedulePoll(workspaceId, 300);
  }

  async function syncWorkspaceTarget(workspaceId: string, targetContentsId?: number) {
    workspaceTargets.set(workspaceId, targetContentsId);
    const nextVersion = (syncVersions.get(workspaceId) ?? 0) + 1;
    syncVersions.set(workspaceId, nextVersion);

    const preferences = options.getLearningPreferences();
    if (preferences.mode === "off" || !targetContentsId) {
      await stopObserver(workspaceId);
      return;
    }

    const tabId = options.getTabIdForContentsId(targetContentsId);
    if (!tabId) {
      await stopObserver(workspaceId);
      return;
    }

    const existing = observers.get(workspaceId);
    if (existing && existing.targetContentsId === targetContentsId && existing.tabId === tabId) {
      if (isBlacklistedLearningDomain(existing.domain)) {
        await stopObserver(workspaceId);
      } else {
        return;
      }
    }

    if (existing && syncVersions.get(workspaceId) !== nextVersion) {
      return;
    }

    await stopObserver(workspaceId);
    if (syncVersions.get(workspaceId) !== nextVersion) {
      return;
    }

    try {
      await startObserver(workspaceId, targetContentsId, tabId);
    } catch {
      // Keep the learning system best-effort and non-blocking.
    }
  }

  function buildPromptContext(input: LearningPromptContextInput) {
    store.flushOpenEpisodes({
      maxEventCount: LEARNING_MAINTENANCE_RAW_EVENT_BATCH_SIZE,
    });
    scheduleLearningMaintenance();
    return store.buildPromptContext(input);
  }

  function recordExtractionObservation(input: LearningExtractionObservationInput) {
    if (!isAdaptiveLearningEnabled() || isBlacklistedLearningDomain(inferDomain(input.url))) {
      return { success: false };
    }
    return store.recordExtractionObservation(input);
  }

  function getSummary(input?: LearningSummaryInput): LearningSummary {
    const summary = store.getSummary(input);
    scheduleLearningMaintenance();
    return summary;
  }

  function getCatalog(): LearningCatalog {
    const catalog = store.getCatalog();
    scheduleLearningMaintenance();
    const activeProgress = [
      ...buildActiveWritingProgress(),
      ...catalog.activeProgress,
    ].sort((left, right) =>
      right.updatedAt - left.updatedAt
      || right.eventCount - left.eventCount
      || left.domain.localeCompare(right.domain));
    const latestProgressUpdatedAt = activeProgress[0]?.updatedAt;
    const taskStatus = buildTaskStatus(activeProgress);

    return {
      ...catalog,
      activeProgress,
      taskStatus,
      ...(typeof latestProgressUpdatedAt === "number" && (catalog.lastUpdatedAt ?? 0) < latestProgressUpdatedAt
        ? { lastUpdatedAt: latestProgressUpdatedAt }
        : {}),
    };
  }

  function searchGuidance(input: LearningGuidanceSearchInput): LearningGuidanceSearchResult {
    const result = store.searchGuidance(input);
    scheduleExistingEpisodeLearning();
    scheduleRelevantHistoryProfileLearning({
      workspaceId: input.workspaceId,
      ...(inferDomain(input.activeUrl) !== "unknown" ? { domain: inferDomain(input.activeUrl) } : {}),
      limit: 2,
    });
    return result;
  }

  function searchExtractionRecipes(input: LearningExtractionRecipeSearchInput): LearningExtractionRecipeSearchResult {
    return store.searchExtractionRecipes(input);
  }

  function getGuidanceDetail(input: {
    workspaceId: string;
    guidanceId: string;
  }): LearningGuidanceDetail | null {
    return store.getGuidanceDetail(input);
  }

  function resolveInputAssistContext(input: LearningInputAssistContextInput): LearningInputAssistContext {
    store.flushOpenEpisodes({
      maxEventCount: LEARNING_MAINTENANCE_RAW_EVENT_BATCH_SIZE,
    });
    scheduleLearningMaintenance();
    return store.resolveInputAssistContext(input);
  }

  async function generateInputAssistText(
    input: LearningInputAssistActionInput,
  ): Promise<LearningInputAssistActionResult> {
    const backend = options.resolveLearningBackend?.();
    if (!backend) {
      return {
        success: false,
        error: "No learning backend is configured.",
      };
    }

    const context = resolveInputAssistContext(input);
    if (!context.supported) {
      return {
        success: false,
        error: "The current input surface is not supported yet.",
      };
    }

    if (input.mode === "polish" && !normalizeWritingText(input.currentText)) {
      return {
        success: false,
        error: "No existing text is available to polish.",
      };
    }

    if (
      input.mode === "draft"
      && !normalizeWritingText(input.instruction)
      && !normalizeWritingText(input.currentText)
    ) {
      return {
        success: false,
        error: "Drafting requires a brief or existing text context.",
      };
    }

    try {
      const text = await generateLearningInputAssistText({
        backend,
        context,
        request: input,
      });
      if (!text) {
        return {
          success: false,
          error: "The model returned no text.",
          ...(context.styleProfile ? { styleProfile: context.styleProfile } : {}),
        };
      }
      return {
        success: true,
        text,
        ...(context.styleProfile ? { styleProfile: context.styleProfile } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: message || "Failed to generate input assistance text.",
        ...(context.styleProfile ? { styleProfile: context.styleProfile } : {}),
      };
    }
  }

  function clearState() {
    runtimePauseState = null;
    for (const episodeId of episodeLearningVersions.keys()) {
      cancelEpisodeLearning(episodeId);
    }
    episodeLearningVersions.clear();
    for (const profileKey of historyProfileVersions.keys()) {
      cancelHistoryProfileLearning(profileKey);
    }
    historyProfileVersions.clear();
    for (const profileId of styleProfileVersions.keys()) {
      cancelStyleProfileRefinement(profileId);
    }
    styleProfileVersions.clear();
    writingBuffers.clear();
    store.clear();
  }

  function exportState() {
    const workspaceIds = new Set<string>([
      ...workspaceTargets.keys(),
      ...[...writingBuffers.values()].map((buffer) => buffer.workspaceId),
    ]);
    for (const workspaceId of workspaceIds) {
      recordWritingSamplesForWorkspace(
        workspaceId,
        flushWritingBuffersForWorkspace(workspaceId, { force: true }),
      );
    }
    return store.exportState();
  }

  function deleteSite(siteId: string) {
    const normalizedSiteId = siteId.trim().toLowerCase();
    for (const profileKey of historyProfileVersions.keys()) {
      if (profileKey.endsWith(`|${normalizedSiteId}`)) {
        cancelHistoryProfileLearning(profileKey);
        historyProfileVersions.delete(profileKey);
      }
    }
    return store.deleteSite(siteId);
  }

  function deleteGuidance(guidanceId: string) {
    return store.deleteGuidance(guidanceId);
  }

  function deleteSiteSkill(skillId: string) {
    return store.deleteSiteSkill(skillId);
  }

  function deleteHistorySite(domain: string) {
    const normalizedDomain = domain.trim().toLowerCase();
    for (const profileKey of historyProfileVersions.keys()) {
      if (profileKey.endsWith(`|${normalizedDomain}`)) {
        cancelHistoryProfileLearning(profileKey);
        historyProfileVersions.delete(profileKey);
      }
    }
    return store.deleteHistorySite(domain);
  }

  function deleteStyleProfile(profileId: string) {
    cancelStyleProfileRefinement(profileId);
    styleProfileVersions.delete(profileId);
    return store.deleteStyleProfile(profileId);
  }

  function deletePreferenceProfile(profileId: string) {
    return store.deletePreferenceProfile(profileId);
  }

  function getPreferenceProfile(input?: { profileId?: string; workspaceId?: string }) {
    return store.getPreferenceProfile(input);
  }

  function upsertUserMemory(input: LearningUserMemoryUpsertInput) {
    return store.upsertUserMemory(input);
  }

  function deleteUserMemory(input: LearningUserMemorySignalInput) {
    return store.deleteUserMemory(input);
  }

  function rejectUserMemory(input: LearningUserMemorySignalInput) {
    return store.rejectUserMemory(input);
  }

  function applyPreferencesChanged() {
    if (!isAdaptiveLearningEnabled()) {
      cancelLearningMaintenanceTimer();
      learningMaintenanceVersion += 1;
      discardBlockedWritingBuffers({ clearAll: true });
      for (const episodeId of episodeLearningVersions.keys()) {
        cancelEpisodeLearning(episodeId);
      }
      for (const profileKey of historyProfileVersions.keys()) {
        cancelHistoryProfileLearning(profileKey);
      }
      for (const profileId of styleProfileVersions.keys()) {
        cancelStyleProfileRefinement(profileId);
      }
      scheduleLearningMaintenance();
    } else {
      discardBlockedWritingBuffers();
      runtimePauseState = null;
      scheduleLearningMaintenance();
    }

    for (const [workspaceId, targetContentsId] of workspaceTargets.entries()) {
      void syncWorkspaceTarget(workspaceId, targetContentsId);
    }
  }

  async function flushState(): Promise<LearningFlushResult> {
    const workspaceIds = new Set<string>([
      ...workspaceTargets.keys(),
      ...[...writingBuffers.values()].map((buffer) => buffer.workspaceId),
    ]);
    let writingSampleCount = 0;
    for (const workspaceId of workspaceIds) {
      const samples = flushWritingBuffersForWorkspace(workspaceId, { force: true });
      writingSampleCount += samples.length;
      recordWritingSamplesForWorkspace(workspaceId, samples);
    }

    const result = store.learnNow();
    const learnedAssets = await flushPendingEpisodeLearning();
    await flushPendingHistoryProfileLearning({
      workspaceIds: Array.from(workspaceIds),
    });
    await flushPendingStyleProfileRefinements({
      workspaceIds: Array.from(workspaceIds),
    });
    return {
      ...result,
      learnedEpisodeCount: learnedAssets.learnedEpisodeCount,
      learnedGuidanceCount: learnedAssets.learnedGuidanceCount,
      writingSampleCount,
    };
  }

  function shutdown() {
    cancelLearningMaintenanceTimer();
    learningMaintenanceVersion += 1;
    for (const [workspaceId] of workspaceTargets.entries()) {
      recordWritingSamplesForWorkspace(
        workspaceId,
        flushWritingBuffersForWorkspace(workspaceId, { force: true }),
      );
    }
    for (const observer of observers.values()) {
      observer.stopped = true;
      if (observer.timer) {
        clearTimeout(observer.timer);
        observer.timer = null;
      }
    }
    observers.clear();
    for (const episodeId of episodeLearningVersions.keys()) {
      cancelEpisodeLearning(episodeId);
    }
    for (const profileKey of historyProfileVersions.keys()) {
      cancelHistoryProfileLearning(profileKey);
    }
    for (const profileId of styleProfileVersions.keys()) {
      cancelStyleProfileRefinement(profileId);
    }
    store.shutdown();
  }

  scheduleLearningMaintenance();

  return {
    syncWorkspaceTarget,
    buildPromptContext,
    recordExtractionObservation,
    getSummary,
    getCatalog,
    searchGuidance,
    searchExtractionRecipes,
    getGuidanceDetail,
    resolveInputAssistContext,
    generateInputAssistText,
    clearState,
    exportState,
    deleteSite,
    deleteGuidance,
    deleteSiteSkill,
    deleteHistorySite,
    deleteStyleProfile,
    deletePreferenceProfile,
    getPreferenceProfile,
    upsertUserMemory,
    deleteUserMemory,
    rejectUserMemory,
    applyPreferencesChanged,
    flushState,
    shutdown,
  };
}
