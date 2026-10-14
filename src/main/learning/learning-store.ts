import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { URL } from "node:url";
import type {
  LearningCatalog,
  LearningEpisodeAnalysis,
  LearningEpisodeFeedbackDraft,
  LearningEpisodeGuidanceDraft,
  LearningEpisodeLearningContext,
  LearningEpisodeLearningResult,
  LearningEpisodeSiteSkillDraft,
  LearningExtractionMode,
  LearningExtractionObservationInput,
  LearningExtractionRecipe,
  LearningExtractionRecipeSearchInput,
  LearningExtractionRecipeSearchResult,
  LearningFeedbackRecord,
  LearningFeedbackOutcome,
  LearningFeedbackRecordSummary,
  LearningGuidanceDetail,
  LearningGuidanceSearchInput,
  LearningGuidanceSearchResult,
  LearningHistoryActivityLevel,
  LearningHistoryProfile,
  LearningHistoryProfileContext,
  LearningHistoryProfileDraft,
  LearningHistoryPageSummary,
  LearningHistoryRevisitPattern,
  LearningHistorySiteSummary,
  LearningInputAssistActionInput,
  LearningInputAssistContext,
  LearningInputAssistContextInput,
  LearningEpisode,
  LearningFlushResult,
  LearningGuidance,
  LearningGuidanceRefinement,
  LearningPageSnapshot,
  LearningPageSnapshotCapability,
  LearningPageSnapshotForm,
  LearningPageSnapshotInformationBlock,
  LearningPageSnapshotInput,
  LearningPageSnapshotRegion,
  LearningPreferences,
  LearningPreferenceProfile,
  LearningPreferenceProfileSummary,
  LearningPreferenceCategory,
  LearningPreferenceScope,
  LearningPreferenceSignal,
  LearningPreferenceSignalSource,
  LearningPreferenceStatus,
  LearningProgressItem,
  LearningProgressMethod,
  LearningTaskStatus,
  LearningPromptContextInput,
  LearningPurposeKey,
  LearningRawEvent,
  LearningSiteSkill,
  LearningSiteSkillPatternKey,
  LearningSiteSkillSummary,
  LearningStyleProfile,
  LearningStyleProfileSummary,
  LearningSummary,
  LearningSummaryInput,
  LearningUserMemoryMutationResult,
  LearningUserMemorySignalInput,
  LearningUserMemoryUpsertInput,
  LearningWritingContextType,
  LearningWritingSample,
  LearningWritingSlot,
} from "./types.js";

interface CreateLearningStoreOptions {
  statePath: string;
  backupPath: string;
  tempPath: string;
  getPreferences: () => LearningPreferences;
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
  onGuidanceDerived?: (guidanceId: string) => void;
}

interface LearningHistoryRecordLike {
  title: string;
  url: string;
  createdAt: number;
  updatedAt: number;
  lastVisitedAt: number;
  visitCount: number;
}

export interface LearningStatePayload {
  version: number;
  rawEvents: LearningRawEvent[];
  pageSnapshots: LearningPageSnapshot[];
  learnedEventIds: string[];
  llmLearnedEpisodeIds: string[];
  deferredEpisodeLearningIds: string[];
  deferredHistoryProfileKeys: string[];
  deferredStyleProfileIds: string[];
  episodes: LearningEpisode[];
  deletedHistoryDomains: Array<{
    domain: string;
    deletedAt: number;
  }>;
  historyProfiles: LearningHistoryProfile[];
  guidances: LearningGuidance[];
  siteSkills: LearningSiteSkill[];
  feedbackRecords: LearningFeedbackRecord[];
  writingSamples: LearningWritingSample[];
  deletedStyleProfileGroups: Array<{
    profileId: string;
    deletedAt: number;
  }>;
  styleProfiles: LearningStyleProfile[];
  preferenceProfiles: LearningPreferenceProfile[];
  extractionRecipes: LearningExtractionRecipe[];
}

interface LearningDeletedHistoryDomain {
  domain: string;
  deletedAt: number;
}

interface LearningDeletedStyleProfileGroup {
  profileId: string;
  deletedAt: number;
}

interface EpisodeAccumulator {
  episodeId: string;
  workspaceId: string;
  domain: string;
  startedAt: number;
  lastTs: number;
  events: LearningRawEvent[];
}

interface IntentInferenceInput {
  domain: string;
  url?: string;
  pageTitle?: string;
  pageType?: string;
  keywords: string[];
  inputTargets: string[];
  clickTargets: string[];
  sequence: string[];
  hasDownload: boolean;
}

interface IntentInferenceResult {
  key: string;
  label: string;
  keywords: string[];
}

interface PurposeInferenceResult {
  key: LearningPurposeKey;
  label: string;
}

const LEARNING_STATE_VERSION = 10;
const MAX_EPISODE_EVENTS = 40;
const MAX_IDLE_GAP_MS = 45_000;
const SAVE_DELAY_MS = 2_500;
const DEFERRED_LEARNING_EVENT_BATCH_SIZE = 1_000;
const MAX_PAGE_SNAPSHOT_DOM_CHARS = 200_000;
const MAX_STYLE_COMMON_PHRASES = 8;
const MAX_STYLE_EXEMPLAR_SNIPPETS = 3;
const DEFAULT_USER_MEMORY_WORKSPACE_ID = "default";
const RECENT_FOCUS_TTL_MS = 14 * 24 * 60 * 60 * 1_000;
const HISTORY_PROFILE_GLOBAL_SCOPE = "__global__";
const OUTCOME_ERROR_TEXT_MARKERS = [
  "error",
  "失败",
  "登录失败",
  "失败",
  "超时",
  "timeout",
  "denied",
  "无响应",
  "not found",
  "403",
  "404",
  "captcha",
  "验证码",
  "unauthorized",
  "permission",
  "forbidden",
];
const OUTCOME_SUCCESS_TEXT_MARKERS = [
  "completed",
  "success",
  "succeed",
  "完成",
  "成功",
  "saved",
  "save",
  "提交成功",
  "导出成功",
  "下载完成",
  "下载成功",
];

function extractEventText(event: LearningRawEvent) {
  return [
    event.summary,
    event.text,
    event.targetHint,
    event.targetRole,
    event.targetName,
    event.targetLabel,
    event.targetText,
    event.title,
    event.url,
  ]
    .map((value) => value?.trim().toLowerCase())
    .filter((entry): entry is string => Boolean(entry))
    .join(" ");
}

function hasFailureTextSignals(events: LearningRawEvent[]) {
  const corpus = events
    .map((event) => extractEventText(event))
    .join(" ");
  return OUTCOME_ERROR_TEXT_MARKERS.some((marker) => corpus.includes(marker));
}

function hasSuccessTextSignals(events: LearningRawEvent[]) {
  const corpus = events
    .map((event) => extractEventText(event))
    .join(" ");
  return OUTCOME_SUCCESS_TEXT_MARKERS.some((marker) => corpus.includes(marker));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Number(value) : undefined;
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function safeParseUrl(value: string | undefined) {
  if (!value) {
    return null;
  }
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function inferDomain(url: string | undefined) {
  const parsed = safeParseUrl(url);
  if (!parsed) {
    return "unknown";
  }
  return parsed.hostname || parsed.protocol.replace(":", "") || "unknown";
}

function inferPageType(url: string | undefined) {
  const parsed = safeParseUrl(url);
  if (!parsed) {
    return undefined;
  }
  const path = parsed.pathname.trim().replace(/\/+/g, "/");
  if (!path || path === "/") {
    return "home";
  }
  const segment = path.split("/").filter(Boolean)[0];
  return segment || "home";
}

function inferScheme(url: string | undefined) {
  const parsed = safeParseUrl(url);
  if (!parsed) {
    return undefined;
  }
  return parsed.protocol.trim().toLowerCase() || undefined;
}

function normalizeBlacklistDomain(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  let normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (normalized.startsWith("*.")) {
    normalized = normalized.slice(2);
  }

  if (normalized.includes("://")) {
    const parsed = safeParseUrl(normalized);
    if (parsed?.hostname) {
      normalized = parsed.hostname.toLowerCase();
    }
  }

  normalized = normalized.split(/[/?#]/, 1)[0] ?? normalized;
  normalized = normalized.replace(/:\d+$/, "");
  normalized = normalized.replace(/^\.+|\.+$/g, "");
  return normalized || undefined;
}

function matchesBlacklistedDomain(domain: string | undefined, blacklistDomains: string[]) {
  const normalizedDomain = normalizeBlacklistDomain(domain);
  if (!normalizedDomain) {
    return false;
  }

  return blacklistDomains.some((entry) =>
    normalizedDomain === entry || normalizedDomain.endsWith(`.${entry}`));
}

function truncateText(value: string, maxLength = 96) {
  void maxLength;
  return value;
}

function hashText(value: string) {
  return createHash("sha1")
    .update(value)
    .digest("hex");
}

function startOfLocalDay(ts: number) {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function toLocalDayKey(ts: number) {
  const date = new Date(ts);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolveSummaryScope(input?: LearningSummaryInput) {
  const workspaceId = input?.workspaceId?.trim() || undefined;
  const domain = inferDomain(input?.activeUrl);
  return {
    workspaceId,
    domain: domain !== "unknown" ? domain : undefined,
  };
}

function normalizeHistoryVisitCount(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(Number(value)));
}

function resolveHistoryTimestamp(record: LearningHistoryRecordLike) {
  return Math.max(
    Number.isFinite(record.lastVisitedAt) ? record.lastVisitedAt : 0,
    Number.isFinite(record.updatedAt) ? record.updatedAt : 0,
    Number.isFinite(record.createdAt) ? record.createdAt : 0,
  );
}

function buildHistoryProfileScopeKey(workspaceId?: string) {
  const normalized = workspaceId?.trim();
  return normalized || HISTORY_PROFILE_GLOBAL_SCOPE;
}

function buildHistoryProfileKey(input: {
  workspaceId?: string;
  scopeKey?: string;
  domain: string;
}) {
  return `${input.scopeKey ?? buildHistoryProfileScopeKey(input.workspaceId)}|${input.domain}`;
}

function buildHistoryProfileRecordHash(summary: Pick<
  LearningHistorySiteSummary,
  "domain" | "visitCount" | "uniquePageCount" | "observedDayCount" | "firstSeenAt" | "lastVisitedAt" | "topPages"
>) {
  return hashText(JSON.stringify({
    domain: summary.domain,
    visitCount: summary.visitCount,
    uniquePageCount: summary.uniquePageCount,
    observedDayCount: summary.observedDayCount,
    firstSeenAt: summary.firstSeenAt,
    lastVisitedAt: summary.lastVisitedAt,
    topPages: summary.topPages.map((page) => ({
      url: page.url,
      title: page.title,
      visitCount: page.visitCount,
      lastVisitedAt: page.lastVisitedAt,
    })),
  }));
}

function toHistoryPageSummary(record: LearningHistoryRecordLike): LearningHistoryPageSummary {
  return {
    url: record.url,
    title: truncateText(record.title || record.url, 96),
    visitCount: normalizeHistoryVisitCount(record.visitCount),
    lastVisitedAt: resolveHistoryTimestamp(record),
  };
}

function summarizeHistorySites(records: LearningHistoryRecordLike[]): LearningHistorySiteSummary[] {
  const sitesByDomain = new Map<string, {
    domain: string;
    visitCount: number;
    firstSeenAt: number;
    lastVisitedAt: number;
    observedDayKeys: Set<string>;
    pages: Map<string, LearningHistoryRecordLike>;
  }>();

  for (const record of records) {
    const domain = inferDomain(record.url);
    if (domain === "unknown") {
      continue;
    }

    const visitCount = normalizeHistoryVisitCount(record.visitCount);
    const lastVisitedAt = resolveHistoryTimestamp(record);
    const firstSeenAt = Math.max(
      0,
      Number.isFinite(record.createdAt) ? record.createdAt : lastVisitedAt,
    );
    const existing = sitesByDomain.get(domain);
    const nextPageRecord: LearningHistoryRecordLike = {
      ...record,
      title: record.title || record.url,
      visitCount,
      createdAt: firstSeenAt || lastVisitedAt,
      updatedAt: lastVisitedAt,
      lastVisitedAt,
    };

    if (!existing) {
      const observedDayKeys = new Set<string>();
      if (lastVisitedAt > 0) {
        observedDayKeys.add(toLocalDayKey(lastVisitedAt));
      }

      sitesByDomain.set(domain, {
        domain,
        visitCount,
        firstSeenAt: firstSeenAt || lastVisitedAt,
        lastVisitedAt,
        observedDayKeys,
        pages: new Map([[record.url, nextPageRecord]]),
      });
      continue;
    }

    existing.visitCount += visitCount;
    existing.firstSeenAt = Math.min(existing.firstSeenAt || firstSeenAt, firstSeenAt || existing.firstSeenAt);
    existing.lastVisitedAt = Math.max(existing.lastVisitedAt, lastVisitedAt);
    if (lastVisitedAt > 0) {
      existing.observedDayKeys.add(toLocalDayKey(lastVisitedAt));
    }

    const previousPage = existing.pages.get(record.url);
    if (!previousPage) {
      existing.pages.set(record.url, nextPageRecord);
      continue;
    }

    existing.pages.set(record.url, {
      ...previousPage,
      title: nextPageRecord.title || previousPage.title,
      createdAt: Math.min(previousPage.createdAt || nextPageRecord.createdAt, nextPageRecord.createdAt),
      updatedAt: Math.max(previousPage.updatedAt, nextPageRecord.updatedAt),
      lastVisitedAt: Math.max(previousPage.lastVisitedAt, nextPageRecord.lastVisitedAt),
      visitCount: previousPage.visitCount + nextPageRecord.visitCount,
    });
  }

  return Array.from(sitesByDomain.values())
    .map((site) => {
      const pages = Array.from(site.pages.values())
        .sort((left, right) =>
          normalizeHistoryVisitCount(right.visitCount) - normalizeHistoryVisitCount(left.visitCount)
          || resolveHistoryTimestamp(right) - resolveHistoryTimestamp(left)
          || left.url.localeCompare(right.url));
      const uniquePageCount = pages.length;
      const observedDayCount = site.observedDayKeys.size;

      return {
        siteId: site.domain,
        domain: site.domain,
        visitCount: site.visitCount,
        uniquePageCount,
        observedDayCount,
        firstSeenAt: site.firstSeenAt || site.lastVisitedAt,
        lastVisitedAt: site.lastVisitedAt,
        topPages: pages.map((page) => toHistoryPageSummary(page)),
        commonIntents: [],
        revisitDrivers: [],
      } satisfies LearningHistorySiteSummary;
    })
    .sort((left, right) =>
      right.visitCount - left.visitCount
      || right.lastVisitedAt - left.lastVisitedAt
      || left.domain.localeCompare(right.domain));
}

function normalizeGuidanceSearchDomain(value: string | undefined) {
  const normalized = normalizeBlacklistDomain(value);
  if (normalized) {
    return normalized;
  }
  const inferred = inferDomain(value);
  return inferred !== "unknown" ? inferred : undefined;
}

function matchesGuidanceDomain(domain: string, filterDomain: string | undefined) {
  if (!filterDomain) {
    return true;
  }
  return domain === filterDomain || domain.endsWith(`.${filterDomain}`);
}

function mapObservedEventToTool(kind: string) {
  if (kind === "input.input") {
    return "browser_element_input";
  }
  if (kind === "input.click") {
    return "browser_element_click";
  }
  if (kind === "input.scroll") {
    return "browser_element_scroll";
  }
  if (
    kind === "page.navigation"
    || kind === "tab.created"
    || kind === "download.completed"
    || kind === "dialog.opened"
    || kind === "dom.mutation"
  ) {
    return "browser_events_await";
  }
  return undefined;
}

function compactToolSequence(sequence: string[]) {
  const tools: string[] = [];
  for (const step of sequence) {
    const tool = mapObservedEventToTool(step);
    if (!tool || tools.at(-1) === tool) {
      continue;
    }
    tools.push(tool);
  }
  return tools;
}

function sanitizeToolOrder(values: Array<string | undefined>) {
  const allowedTools = new Set([
    "browser_element_input",
    "browser_element_click",
    "browser_element_scroll",
    "browser_events_await",
  ]);
  return uniqueStrings(
    values.map((entry) => {
      const value = typeof entry === "string" ? entry.trim() : "";
      return allowedTools.has(value) ? value : undefined;
    }),
    5,
  );
}

function normalizeExtractionMode(value: string | undefined): LearningExtractionMode | undefined {
  switch (value) {
    case "records":
    case "text":
    case "images":
      return value;
    default:
      return undefined;
  }
}

function compactSequence(events: LearningRawEvent[]) {
  const result: string[] = [];
  for (const event of events) {
    const key = event.kind.trim();
    if (!key) {
      continue;
    }
    if (result.at(-1) === key) {
      continue;
    }
    result.push(key);
  }
  return result;
}

function uniqueStrings(values: Array<string | undefined>, limit?: number) {
  const result: string[] = [];
  const seen = new Set<string>();
  const maxCount = typeof limit === "number" && Number.isFinite(limit) && limit > 0
    ? Math.floor(limit)
    : undefined;
  for (const entry of values) {
    const value = typeof entry === "string" ? entry.trim() : "";
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
    if (maxCount !== undefined && result.length >= maxCount) {
      break;
    }
  }
  return result;
}

function sanitizeGuidanceTextList(values: Array<string | undefined>, limit: number, maxLength: number) {
  void maxLength;
  return uniqueStrings(
    values.map((entry) => {
      const value = typeof entry === "string" ? entry.trim() : "";
      if (!value) {
        return undefined;
      }
      return value;
    }),
    limit,
  );
}

function normalizeKeyword(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }
  const normalized = trimmed.replace(/[\s"'`~!@#$%^&*()+={}\[\]|\\:;<>?,./-]+/g, " ").trim();
  return normalized || undefined;
}

function tokenizeKeywordSource(value: string | undefined) {
  if (!value) {
    return [];
  }

  const englishTokens = Array.from(new Set(value.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []));
  const chineseTokens = Array.from(new Set(value.match(/[\u4e00-\u9fff]{2,}/g) ?? []));

  return uniqueStrings([
    ...englishTokens,
    ...chineseTokens,
    normalizeKeyword(value),
  ], 16);
}

function collectKeywords(values: Array<string | undefined>, limit = 18) {
  return uniqueStrings(values.flatMap((entry) => tokenizeKeywordSource(entry)), limit);
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

function describeWritingContextType(value: LearningWritingContextType | undefined) {
  switch (value) {
    case "email":
      return "Email";
    case "forum":
      return "Forum";
    case "article_editor":
      return "Article editor";
    case "general_editor":
      return "Editor";
    default:
      return undefined;
  }
}

function describeWritingSlot(value: LearningWritingSlot | undefined) {
  switch (value) {
    case "subject":
      return "Subject";
    case "body":
      return "Body";
    case "title":
      return "Title";
    case "comment":
      return "Comment";
    case "message":
      return "Message";
    case "recipient":
      return "Recipient";
    default:
      return "Field";
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
  const normalized = normalizeWritingRecipient(value, 160)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return normalized
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countWritingWords(text: string) {
  const matches = text.match(/[\u4e00-\u9fff]|[a-z0-9]+(?:['’-][a-z0-9]+)*/gi);
  return matches?.length ?? 0;
}

function isWritingContextSupported(
  contextType: LearningWritingContextType | undefined,
  slot: LearningWritingSlot | undefined,
) {
  if (!contextType) {
    return false;
  }
  return slot !== "recipient";
}

function buildWritingSampleHash(input: {
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

function buildStyleProfileGroupKey(input: {
  workspaceId: string;
  domain?: string;
  contextType?: LearningWritingContextType;
  slot?: LearningWritingSlot;
  recipientKey?: string;
}) {
  return [
    input.workspaceId,
    input.domain ?? "unknown",
    input.contextType ?? "unknown",
    input.slot ?? "unknown",
    input.contextType === "email" ? (input.recipientKey ?? "generic") : "shared",
  ].join("|");
}

function pickMostFrequentValue(values: Array<string | undefined>) {
  const counts = new Map<string, number>();
  for (const entry of values) {
    const value = typeof entry === "string" ? entry.trim() : "";
    if (!value) {
      continue;
    }
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)[0]?.[0];
}

function extractRepresentativeSnippet(text: string) {
  const normalized = normalizeWritingText(text, 240);
  if (!normalized) {
    return undefined;
  }
  const lines = normalized
    .split(/\n+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const preferred = lines.find((entry) => entry.length >= 12) ?? lines[0] ?? normalized;
  return truncateText(preferred, 140);
}

function pickBestStyleDescriptor(profile: Pick<
  LearningStyleProfile,
  "styleSummary" | "emailStyle" | "forumStyle" | "articleStyle" | "notesStyle"
>) {
  return [
    profile.styleSummary,
    profile.emailStyle,
    profile.forumStyle,
    profile.articleStyle,
    profile.notesStyle,
  ].find((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function buildStyleProfileGroupKeyFromProfile(profile: Pick<
  LearningStyleProfile,
  "workspaceId" | "domain" | "contextType" | "slot" | "recipientKey"
>) {
  return buildStyleProfileGroupKey({
    workspaceId: profile.workspaceId,
    domain: profile.domain,
    contextType: profile.contextType,
    slot: profile.slot,
    recipientKey: profile.recipientKey,
  });
}

function calculateFieldKeywordOverlap(
  left: Array<string | undefined>,
  right: Array<string | undefined>,
) {
  const leftKeywords = new Set(collectKeywords(left, 12));
  const rightKeywords = new Set(collectKeywords(right, 12));
  let count = 0;
  for (const keyword of leftKeywords) {
    if (rightKeywords.has(keyword)) {
      count += 1;
    }
  }
  return count;
}

function describePurposeKey(key: LearningPurposeKey): PurposeInferenceResult {
  switch (key) {
    case "retrieve_data":
      return { key, label: "Retrieve data" };
    case "submit_data":
      return { key, label: "Submit data" };
    case "authenticate":
      return { key, label: "Authenticate" };
    case "download_export":
      return { key, label: "Download or export" };
    case "navigate_workflow":
      return { key, label: "Navigate workflow" };
    default:
      return { key: "other", label: "Other purpose" };
  }
}

function defaultPurposeForIntent(intentKey: string): PurposeInferenceResult {
  switch (intentKey) {
    case "structured_query":
    case "search_or_filter":
      return describePurposeKey("retrieve_data");
    case "fill_form":
      return describePurposeKey("submit_data");
    case "sign_in":
      return describePurposeKey("authenticate");
    case "download_result":
      return describePurposeKey("download_export");
    case "navigate_site":
    case "repeat_page_workflow":
      return describePurposeKey("navigate_workflow");
    default:
      return describePurposeKey("other");
  }
}

function defaultIntentLabel(intentKey: string) {
  switch (intentKey) {
    case "sign_in":
      return "Sign in";
    case "download_result":
      return "Download or export results";
    case "structured_query":
      return "Run a structured query";
    case "search_or_filter":
      return "Search or filter results";
    case "fill_form":
      return "Fill a form";
    case "navigate_site":
      return "Navigate a site workflow";
    case "repeat_page_workflow":
      return "Repeat a known page workflow";
    default:
      return undefined;
  }
}

function normalizeStoredIntentFields(intentKeyValue?: string, intentLabelValue?: string) {
  const rawIntentKey = intentKeyValue?.trim();
  const rawIntentLabel = intentLabelValue?.trim();
  let intentKey = rawIntentKey || "repeat_page_workflow";
  let wasLegacySpecialization = false;

  switch (intentKey) {
    case "query_train_tickets":
    case "search_flights":
    case "search_hotels":
      intentKey = "structured_query";
      wasLegacySpecialization = true;
      break;
    default:
      break;
  }

  const normalizedLabel = defaultIntentLabel(intentKey) ?? "Repeat a known page workflow";
  return {
    intentKey,
    intentLabel: wasLegacySpecialization ? normalizedLabel : (rawIntentLabel || normalizedLabel),
    wasLegacySpecialization,
  };
}

function buildExtractionGoalSummary(input: {
  taskSummary: string;
  extractionMode: LearningExtractionMode;
  fieldKeys: string[];
  regionName?: string;
  sourceRole?: string;
}) {
  const targetLabel = input.regionName?.trim() || input.sourceRole?.trim() || "target region";
  if (input.extractionMode === "records" && input.fieldKeys.length > 0) {
    return `Extract ${input.fieldKeys.join(", ")} from the learned ${targetLabel}.`;
  }
  if (input.extractionMode === "text") {
    return `Extract the requested text content from the learned ${targetLabel}.`;
  }
  if (input.extractionMode === "images") {
    return `Extract the requested images from the learned ${targetLabel}.`;
  }
  return `Extract the requested data from the learned ${targetLabel}: ${truncateText(input.taskSummary, 120)}`;
}

function buildExtractionPathSignature(url: string | undefined, pageType: string | undefined) {
  const parsed = safeParseUrl(url);
  if (!parsed) {
    return pageType ?? "home";
  }
  const pathSegments = parsed.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => normalizeKeyword(segment))
    .filter((segment): segment is string => typeof segment === "string" && segment.length > 0);
  return pathSegments.join("/") || pageType || "home";
}

function buildExtractionPageSignature(input: {
  domain: string;
  url?: string;
  pageTitle?: string;
  pageType?: string;
  sourceRole?: string;
  regionRole?: string;
  regionName?: string;
  fieldKeys: string[];
}) {
  const titleTokens = collectKeywords([
    input.pageTitle,
    input.pageType,
    input.sourceRole,
    input.regionRole,
  ], 6)
    .sort()
    .join(",");
  const fieldSignature = input.fieldKeys
    .map((entry) => normalizeKeyword(entry))
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .sort()
    .join(",");
  return [
    input.domain,
    buildExtractionPathSignature(input.url, input.pageType),
    input.sourceRole ?? "unknown",
    input.regionRole ?? "unknown",
    normalizeKeyword(input.regionName ?? "") ?? "unknown",
    fieldSignature || "none",
    titleTokens || "none",
  ].join("|");
}

function buildExtractionRecipeKey(input: {
  workspaceId: string;
  domain: string;
  scheme?: string;
  pageType?: string;
  extractionMode: LearningExtractionMode;
  pageSignature: string;
  sourceRole?: string;
  regionRole?: string;
  regionName?: string;
  fieldKeys: string[];
  taskSummary: string;
}) {
  return [
    input.workspaceId,
    input.domain,
    input.scheme ?? "unknown",
    input.pageType ?? "unknown",
    input.extractionMode,
    input.pageSignature,
    input.sourceRole ?? "unknown",
    input.regionRole ?? "unknown",
    normalizeKeyword(input.regionName ?? "") ?? "unknown",
    input.fieldKeys
      .map((entry) => normalizeKeyword(entry))
      .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      .sort()
      .join(",") || "none",
  ].join("|");
}

function buildExtractionRecipeSearchCorpus(recipe: LearningExtractionRecipe) {
  return [
    recipe.domain,
    recipe.scheme,
    recipe.pageType,
    recipe.pageSignature,
    recipe.taskSummary,
    recipe.goalSummary,
    recipe.extractionMode,
    recipe.sourceRole,
    recipe.regionRole,
    recipe.regionName,
    recipe.regionHint,
    ...recipe.fieldKeys,
    ...recipe.keywords,
  ]
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

function normalizeExtractionRecipe(value: unknown): LearningExtractionRecipe | null {
  if (!isRecord(value)) {
    return null;
  }

  const recipeId = readString(value.recipeId);
  const workspaceId = readString(value.workspaceId);
  const domain = readString(value.domain);
  const extractionMode = normalizeExtractionMode(readString(value.extractionMode));
  const taskSummary = readString(value.taskSummary);
  const support = readNumber(value.support);
  const confidence = readNumber(value.confidence);
  const lastSeenAt = readNumber(value.lastSeenAt);
  if (
    !recipeId
    || !workspaceId
    || !domain
    || !extractionMode
    || !taskSummary
    || support === undefined
    || confidence === undefined
    || lastSeenAt === undefined
  ) {
    return null;
  }

  const fieldKeys = Array.isArray(value.fieldKeys)
    ? value.fieldKeys
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  const regionName = readString(value.regionName);
  const sourceRole = readString(value.sourceRole);
  const pageType = readString(value.pageType);
  const pageSignature = readString(value.pageSignature)
    ?? buildExtractionPageSignature({
      domain,
      pageType,
      sourceRole,
      regionRole: readString(value.regionRole),
      regionName,
      fieldKeys,
    });

  return {
    recipeId,
    workspaceId,
    domain,
    ...(readString(value.scheme) ? { scheme: readString(value.scheme)?.toLowerCase() } : {}),
    ...(pageType ? { pageType } : {}),
    pageSignature,
    taskSummary,
    goalSummary: readString(value.goalSummary)
      ?? buildExtractionGoalSummary({
        taskSummary,
        extractionMode,
        fieldKeys,
        regionName,
        sourceRole,
      }),
    extractionMode,
    ...(sourceRole ? { sourceRole } : {}),
    ...(readString(value.regionRole) ? { regionRole: readString(value.regionRole) } : {}),
    ...(regionName ? { regionName } : {}),
    ...(readString(value.regionHint) ? { regionHint: readString(value.regionHint) } : {}),
    fieldKeys,
    keywords: Array.isArray(value.keywords)
      ? value.keywords
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : collectKeywords([taskSummary, regionName, sourceRole, ...fieldKeys]),
    support: Math.max(0, Math.floor(support)),
    confidence: Math.max(0, Math.min(1, Number(confidence))),
    lastSeenAt,
  };
}

function buildInferenceCorpus(input: IntentInferenceInput) {
  return [
    input.domain,
    input.url,
    input.pageTitle,
    input.pageType,
    ...input.keywords,
    ...input.inputTargets,
    ...input.clickTargets,
    ...input.sequence,
  ]
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

function describeEventTarget(event: Pick<
  LearningRawEvent,
  "targetHint" | "targetRole" | "targetName" | "targetLabel" | "targetText"
>) {
  const directHint = truncateText(event.targetHint ?? "", 80).trim();
  if (directHint) {
    return directHint;
  }

  const semanticParts = [
    event.targetRole ? `role=${truncateText(event.targetRole, 24)}` : undefined,
    event.targetName ? `name=${truncateText(event.targetName, 40)}` : undefined,
    event.targetLabel ? `label=${truncateText(event.targetLabel, 40)}` : undefined,
    event.targetText ? `text=${truncateText(event.targetText, 40)}` : undefined,
  ]
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  if (semanticParts.length === 0) {
    return undefined;
  }
  return truncateText(semanticParts.join(" "), 80);
}

function topTargets(events: LearningRawEvent[], kind?: string) {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (kind && event.kind !== kind) {
      continue;
    }
    const target = describeEventTarget(event);
    if (!target) {
      continue;
    }
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([target]) => target);
}

function inferOutcome(events: LearningRawEvent[]): LearningEpisode["outcome"] {
  const hasFailureText = hasFailureTextSignals(events);
  const hasSuccessText = hasSuccessTextSignals(events);

  if (events.some((event) => event.kind === "download.completed")) {
    return "success";
  }

  const hasDirectInput = events.some((event) =>
    event.kind === "input.click" || event.kind === "input.input" || event.kind === "input.keydown");
  const hasNavigation = events.some((event) => event.kind === "page.navigation" || event.kind === "tab.created");
  const hasDomMutation = events.some((event) => event.kind === "dom.mutation");
  const hasInput = events.some((event) => event.kind === "input.input" || event.kind === "input.keydown");
  const hasClick = events.some((event) => event.kind === "input.click");

  if (hasFailureText && !hasSuccessText) {
    return "failure";
  }
  if (events.some((event) => event.kind === "dialog.opened") && !hasNavigation && !hasSuccessText) {
    return "failure";
  }
  if (hasSuccessText && !hasFailureText) {
    return "success";
  }

  if (hasDirectInput && hasNavigation) {
    return "success";
  }
  if (hasInput && hasNavigation && !hasFailureText) {
    return "success";
  }
  if (hasInput && hasClick && hasDomMutation && !hasFailureText) {
    return "success";
  }

  return "unknown";
}

function containsAny(text: string, candidates: string[]) {
  return candidates.some((candidate) => text.includes(candidate.toLowerCase()));
}

function inferIntent(input: IntentInferenceInput): IntentInferenceResult {
  const corpus = buildInferenceCorpus(input);

  const hasMultipleInputs = input.inputTargets.length >= 2;
  const hasSearchTerms = containsAny(corpus, ["search", "find", "query", "filter", "搜索", "查询", "筛选", "查找"]);
  const hasLoginTerms = containsAny(corpus, ["login", "sign in", "signin", "登录", "账号", "用户名", "密码", "验证码"]);

  if (hasLoginTerms) {
    return {
      key: "sign_in",
      label: "Sign in",
      keywords: ["login", "sign in", "signin", "登录", "账号", "密码"],
    };
  }

  if (
    input.hasDownload
    || containsAny(corpus, ["download", "export", "pdf", "csv", "导出", "下载", "报表"])
  ) {
    return {
      key: "download_result",
      label: "Download or export results",
      keywords: ["download", "export", "pdf", "csv", "下载", "导出"],
    };
  }

  if (hasMultipleInputs && hasSearchTerms) {
    return {
      key: "structured_query",
      label: "Run a structured query",
      keywords: ["search", "query", "filter", "查询", "筛选", "表单"],
    };
  }

  if (input.inputTargets.length > 0 && input.clickTargets.length > 0) {
    return {
      key: "search_or_filter",
      label: "Search or filter results",
      keywords: ["search", "filter", "query", "搜索", "筛选", "查找"],
    };
  }

  if (input.inputTargets.length >= 2) {
    return {
      key: "fill_form",
      label: "Fill a form",
      keywords: ["form", "submit", "填写", "表单"],
    };
  }

  if (input.clickTargets.length > 0 && input.sequence.includes("page.navigation")) {
    return {
      key: "navigate_site",
      label: "Navigate a site workflow",
      keywords: ["navigate", "menu", "page", "导航", "跳转"],
    };
  }

  return {
    key: "repeat_page_workflow",
    label: "Repeat a known page workflow",
    keywords: ["workflow", "page", "流程", "页面"],
  };
}

function inferPurpose(
  input: IntentInferenceInput,
  intent: IntentInferenceResult,
): PurposeInferenceResult {
  const corpus = buildInferenceCorpus(input);
  const hasResultTerms = containsAny(corpus, [
    "result",
    "results",
    "record",
    "records",
    "list",
    "table",
    "availability",
    "schedule",
    "price",
    "查询结果",
    "结果",
    "列表",
    "余票",
    "班次",
    "价格",
  ]);
  const hasSubmitTerms = containsAny(corpus, [
    "submit",
    "save",
    "apply",
    "confirm",
    "continue",
    "create",
    "send",
    "book",
    "reserve",
    "提交",
    "保存",
    "确认",
    "继续",
    "创建",
    "发送",
    "预订",
  ]);
  const hasAuthenticationTerms = containsAny(corpus, [
    "login",
    "sign in",
    "signin",
    "verify",
    "verification",
    "otp",
    "password",
    "登录",
    "认证",
    "验证",
    "验证码",
  ]);
  const hasNavigationTerms = containsAny(corpus, [
    "navigate",
    "menu",
    "open",
    "enter",
    "section",
    "page",
    "导航",
    "打开",
    "进入",
    "页面",
  ]);

  if (input.hasDownload || intent.key === "download_result") {
    return describePurposeKey("download_export");
  }
  if (intent.key === "sign_in" || hasAuthenticationTerms) {
    return describePurposeKey("authenticate");
  }
  if (intent.key === "fill_form") {
    return describePurposeKey("submit_data");
  }
  if (
    intent.key === "structured_query"
    || intent.key === "search_or_filter"
    || hasResultTerms
  ) {
    return describePurposeKey("retrieve_data");
  }
  if (hasSubmitTerms && input.inputTargets.length > 0) {
    return describePurposeKey("submit_data");
  }
  if (intent.key === "navigate_site" || hasNavigationTerms) {
    return describePurposeKey("navigate_workflow");
  }
  return defaultPurposeForIntent(intent.key);
}

function buildGoalSummary(
  input: IntentInferenceInput,
  intent: IntentInferenceResult,
  purpose: PurposeInferenceResult,
) {
  switch (intent.key) {
    case "sign_in":
      return "Authenticate successfully and wait for the account state or page transition.";
    case "download_result":
      return "Trigger export only when the page is ready, then wait for the file artifact.";
    case "structured_query":
      return "Submit the structured query controls and retrieve refreshed results.";
    case "search_or_filter":
      return "Apply search or filter controls and retrieve updated results.";
    case "fill_form":
      return "Fill the required fields and submit the form without extra detours.";
    case "navigate_site":
      return "Open the intended workflow entry point or destination page.";
    default:
      break;
  }

  switch (purpose.key) {
    case "retrieve_data":
      return "Use the learned controls to retrieve the requested data or result list.";
    case "submit_data":
      return "Use the learned field order to submit data and reach the next state.";
    case "authenticate":
      return "Complete authentication and confirm the signed-in state before continuing.";
    case "download_export":
      return "Reach the export action and wait for the download or generated document.";
    case "navigate_workflow":
      return "Navigate to the intended page or workflow state with minimal extra actions.";
    default:
      return input.hasDownload
        ? "Reach the intended result and confirm the page changed as expected."
        : "Reuse the learned workflow only after confirming the live page still matches it.";
  }
}

function normalizePurposeKey(value: string | undefined): LearningPurposeKey | undefined {
  switch (value) {
    case "retrieve_data":
    case "submit_data":
    case "authenticate":
    case "download_export":
    case "navigate_workflow":
    case "other":
      return value;
    default:
      return undefined;
  }
}

function resolvePurposeFields(
  intentKey: string,
  purposeKeyValue?: string,
  purposeLabelValue?: string,
) {
  const normalizedPurposeKey = normalizePurposeKey(purposeKeyValue);
  const fallbackPurpose = normalizedPurposeKey
    ? describePurposeKey(normalizedPurposeKey)
    : defaultPurposeForIntent(intentKey);
  return {
    purposeKey: fallbackPurpose.key,
    purposeLabel: purposeLabelValue?.trim() || fallbackPurpose.label,
  };
}

function buildStoredGoalSummary(input: {
  domain: string;
  url?: string;
  pageTitle?: string;
  pageType?: string;
  keywords: string[];
  inputTargets: string[];
  clickTargets: string[];
  sequence: string[];
  hasDownload: boolean;
  intentKey: string;
  intentLabel: string;
  purposeKey?: string;
  purposeLabel?: string;
  goalSummary?: string;
}) {
  const goalSummary = input.goalSummary?.trim();
  if (goalSummary) {
    return goalSummary;
  }
  const purpose = resolvePurposeFields(input.intentKey, input.purposeKey, input.purposeLabel);
  return buildGoalSummary(
    {
      domain: input.domain,
      url: input.url,
      pageTitle: input.pageTitle,
      pageType: input.pageType,
      keywords: input.keywords,
      inputTargets: input.inputTargets,
      clickTargets: input.clickTargets,
      sequence: input.sequence,
      hasDownload: input.hasDownload,
    },
    {
      key: input.intentKey,
      label: input.intentLabel,
      keywords: input.keywords,
    },
    {
      key: purpose.purposeKey,
      label: purpose.purposeLabel,
    },
  );
}

function buildGuidanceKey(episode: LearningEpisode) {
  const workflowSignature = buildWorkflowSignature({
    purposeKey: episode.purposeKey,
    toolOrder: compactToolSequence(episode.sequence),
    inputTargets: episode.inputTargets,
    clickTargets: episode.clickTargets,
    topTargets: episode.topTargets,
  });
  return [
    episode.workspaceId,
    episode.domain,
    episode.scheme ?? "unknown",
    episode.pageType ?? "unknown",
    episode.intentKey,
    episode.purposeKey,
    workflowSignature,
  ].join("|");
}

function buildWorkflowSignature(input: {
  purposeKey?: LearningPurposeKey;
  toolOrder: string[];
  inputTargets: string[];
  clickTargets: string[];
  topTargets: string[];
}) {
  const targetSignature = collectKeywords([
    ...input.inputTargets,
    ...input.clickTargets,
    ...input.topTargets,
  ], 10)
    .sort()
    .join(",");
  return [
    input.purposeKey ?? "other",
    sanitizeToolOrder(input.toolOrder).join(">") || "none",
    `${Math.min(input.inputTargets.length, 3)}:${Math.min(input.clickTargets.length, 3)}`,
    targetSignature || "none",
  ].join("|");
}

function buildWorkflowSignatureFromGuidance(guidance: Pick<
  LearningGuidance,
  "purposeKey" | "toolOrder" | "inputTargets" | "clickTargets" | "preferredTargets"
>) {
  return buildWorkflowSignature({
    purposeKey: guidance.purposeKey,
    toolOrder: guidance.toolOrder,
    inputTargets: guidance.inputTargets,
    clickTargets: guidance.clickTargets,
    topTargets: guidance.preferredTargets,
  });
}

function buildGuidanceKeyFromGuidance(guidance: Pick<
  LearningGuidance,
  "workspaceId" | "domain" | "scheme" | "pageType" | "intentKey" | "purposeKey" | "toolOrder"
  | "inputTargets" | "clickTargets" | "preferredTargets" | "workflowSignature"
>) {
  return [
    guidance.workspaceId,
    guidance.domain,
    guidance.scheme ?? "unknown",
    guidance.pageType ?? "unknown",
    guidance.intentKey,
    guidance.purposeKey,
    guidance.workflowSignature?.trim() || buildWorkflowSignatureFromGuidance(guidance),
  ].join("|");
}

function chooseBestSequence(
  existing: string[],
  candidate: string[],
  outcome: LearningEpisode["outcome"],
) {
  if (candidate.length === 0) {
    return existing;
  }
  if (existing.length === 0) {
    return [...candidate];
  }
  if (outcome === "success" && candidate.length >= existing.length) {
    return [...candidate];
  }
  return existing;
}

function formatTargets(targets: string[], joiner = " | ") {
  return targets
    .map((target) => truncateText(target, 48))
    .join(joiner);
}

function buildRecommendedSteps(guidance: Pick<
  LearningGuidance,
  | "intentKey"
  | "domain"
  | "goalSummary"
  | "inputTargets"
  | "clickTargets"
  | "preferredTargets"
  | "toolOrder"
>) {
  const steps: string[] = guidance.goalSummary
    ? [`Goal: ${guidance.goalSummary}`]
    : [];

  switch (guidance.intentKey) {
    case "structured_query":
      steps.push("Inspect the main query form and confirm the requested fields are present.");
      if (guidance.inputTargets.length > 0) {
        steps.push(`Populate the observed query fields in order: ${formatTargets(guidance.inputTargets, " -> ")}.`);
      }
      if (guidance.clickTargets.length > 0) {
        steps.push(`Trigger the search with the primary action: ${formatTargets(guidance.clickTargets)}.`);
      }
      steps.push("Wait for the result region to refresh before making further selections.");
      break;
    case "search_or_filter":
      steps.push("Locate the active search or filter controls before interacting.");
      if (guidance.inputTargets.length > 0) {
        steps.push(`Prefer the familiar input targets: ${formatTargets(guidance.inputTargets)}.`);
      }
      if (guidance.clickTargets.length > 0) {
        steps.push(`Use the known apply/search control after input: ${formatTargets(guidance.clickTargets)}.`);
      }
      steps.push("Confirm the results area changed instead of assuming the action completed.");
      break;
    case "sign_in":
      steps.push("Verify the login form is active and not a secondary modal or widget.");
      if (guidance.inputTargets.length > 0) {
        steps.push(`Fill credential fields in the learned structure: ${formatTargets(guidance.inputTargets, " -> ")}.`);
      }
      if (guidance.clickTargets.length > 0) {
        steps.push(`Submit with the primary sign-in control: ${formatTargets(guidance.clickTargets)}.`);
      }
      steps.push("Wait for navigation or account-state changes before continuing.");
      break;
    case "download_result":
      steps.push("Reach the export or download trigger only after the page is in the expected state.");
      if (guidance.clickTargets.length > 0) {
        steps.push(`Prefer the learned download trigger: ${formatTargets(guidance.clickTargets)}.`);
      }
      steps.push("Keep an event subscription active and wait for download.completed or a new tab.");
      break;
    case "fill_form":
      steps.push("Inspect the active form and verify required fields before typing.");
      if (guidance.inputTargets.length > 0) {
        steps.push(`Use the familiar field order: ${formatTargets(guidance.inputTargets, " -> ")}.`);
      }
      if (guidance.clickTargets.length > 0) {
        steps.push(`Submit through the learned primary action: ${formatTargets(guidance.clickTargets)}.`);
      }
      break;
    default:
      steps.push(`Reuse the learned ${guidance.domain} page workflow only after confirming the live DOM matches.`);
      if (guidance.preferredTargets.length > 0) {
        steps.push(`Bias toward previously successful targets: ${formatTargets(guidance.preferredTargets)}.`);
      }
      if (guidance.toolOrder.length > 0) {
        steps.push(`Follow the learned tool order: ${guidance.toolOrder.join(" -> ")}.`);
      }
      break;
  }

  if (steps.length < 4 && guidance.toolOrder.length > 0) {
    steps.push(`Preferred tool order: ${guidance.toolOrder.join(" -> ")}.`);
  }

  return uniqueStrings(steps, 5);
}

function buildCautionNotes(guidance: Pick<
  LearningGuidance,
  "intentKey" | "preferredTargets" | "toolOrder"
>) {
  const notes = [
    "Reuse learned targets as hints only and verify them against the live accessibility tree.",
  ];

  switch (guidance.intentKey) {
    case "structured_query":
    case "search_or_filter":
      notes.push("Avoid unrelated banner, menu, or account actions before the main query is complete.");
      notes.push("Do not continue until the results region visibly updates.");
      break;
    case "sign_in":
      notes.push("Typed values are not reusable memory. Only the field structure is learned.");
      break;
    case "download_result":
      notes.push("Do not assume an export succeeded until a browser event confirms it.");
      break;
    default:
      if (guidance.toolOrder.length > 0) {
        notes.push("If the page structure drifted, re-discover elements before replaying the stored order.");
      }
      break;
  }

  if (guidance.preferredTargets.length === 0) {
    notes.push("No stable targets were learned yet, so rely more on live inspection.");
  }

  return uniqueStrings(notes, 3);
}

function buildRecoveryHints(guidance: Pick<
  LearningGuidance,
  "intentKey" | "inputTargets" | "clickTargets" | "toolOrder"
>) {
  const hints: string[] = [];

  switch (guidance.intentKey) {
    case "structured_query":
    case "search_or_filter":
      hints.push("If typing does not refresh results, check for an apply button or option list and confirm the value explicitly.");
      hints.push("If the page stays unchanged, re-open the main filter or search controls before retrying.");
      break;
    case "sign_in":
      hints.push("If sign-in does not progress, inspect for validation errors, secondary verification, or a blocking dialog before retrying.");
      break;
    case "download_result":
      hints.push("If no download event appears, verify the page is ready, then retry the export from the primary trigger.");
      break;
    case "fill_form":
      hints.push("If submit stays disabled or nothing happens, inspect missing required fields and field-level validation first.");
      break;
    default:
      hints.push("If the flow stalls, re-check the live page state before replaying the stored sequence.");
      break;
  }

  if (guidance.clickTargets.length > 0) {
    hints.push(`If the primary action fails, re-locate the click target near ${formatTargets(guidance.clickTargets)}.`);
  }
  if (guidance.inputTargets.length > 0) {
    hints.push(`If a typed value does not stick, revisit the field order: ${formatTargets(guidance.inputTargets, " -> ")}.`);
  }
  if (guidance.toolOrder.length > 0) {
    hints.push(`When recovering, preserve the learned action order: ${guidance.toolOrder.join(" -> ")}.`);
  }

  return uniqueStrings(hints, 3);
}

function buildObservationSignals(events: LearningRawEvent[]) {
  const successSignals = uniqueStrings([
    events.some((event) => event.kind === "page.navigation") ? "navigation_observed" : undefined,
    events.some((event) => event.kind === "tab.created") ? "tab_opened" : undefined,
    events.some((event) => event.kind === "download.completed") ? "download_completed" : undefined,
    events.some((event) => event.kind === "dom.mutation") ? "dom_changed" : undefined,
    hasSuccessTextSignals(events) ? "success_text_signal" : undefined,
  ], 6);

  const failureSignals = uniqueStrings([
    events.some((event) => event.kind === "dialog.opened") ? "dialog_interruption" : undefined,
    hasFailureTextSignals(events) ? "failure_text_signal" : undefined,
    successSignals.length === 0 ? "no_explicit_progress_signal" : undefined,
  ], 6);

  return {
    successSignals,
    failureSignals,
  };
}

interface DerivedSiteSkillDescriptor {
  patternKey: LearningSiteSkillPatternKey;
  patternLabel: string;
  rule: string;
  evidence: string[];
}

function buildSiteSkillDescriptors(episode: LearningEpisode): DerivedSiteSkillDescriptor[] {
  const descriptors: DerivedSiteSkillDescriptor[] = [];
  const sequence = episode.sequence;
  const inputIndex = sequence.indexOf("input.input");
  const clickIndex = sequence.indexOf("input.click");
  const scrollIndex = sequence.indexOf("input.scroll");
  const dialogIndex = sequence.indexOf("dialog.opened");
  const navigationIndex = Math.max(sequence.indexOf("page.navigation"), sequence.indexOf("tab.created"));
  const downloadIndex = sequence.indexOf("download.completed");

  if (inputIndex >= 0 && clickIndex > inputIndex) {
    descriptors.push({
      patternKey: "confirm_after_typing",
      patternLabel: "Confirm typed values explicitly",
      rule: "Typing alone may be insufficient on this page; confirm the value through an explicit click or option selection.",
      evidence: uniqueStrings([
        episode.inputTargets[0],
        episode.clickTargets[0],
        episode.sequence.join(" -> "),
      ], 3),
    });
  }

  if (scrollIndex >= 0 && clickIndex > scrollIndex) {
    descriptors.push({
      patternKey: "scroll_before_primary_action",
      patternLabel: "Scroll before the primary action",
      rule: "Important controls may require scrolling into view before the next primary click succeeds.",
      evidence: uniqueStrings([
        episode.clickTargets[0],
        episode.sequence.join(" -> "),
      ], 3),
    });
  }

  if (dialogIndex >= 0) {
    descriptors.push({
      patternKey: "dialog_interruption",
      patternLabel: "Dialogs can interrupt this workflow",
      rule: "A modal or dialog may block progress; resolve it before continuing with the main flow.",
      evidence: uniqueStrings([
        episode.clickTargets[0],
        episode.sequence.join(" -> "),
      ], 3),
    });
  }

  if (clickIndex >= 0 && navigationIndex > clickIndex) {
    descriptors.push({
      patternKey: "navigation_after_click",
      patternLabel: "Primary clicks often navigate",
      rule: "After the primary click, verify the new page or tab instead of assuming the current page remains active.",
      evidence: uniqueStrings([
        episode.clickTargets[0],
        episode.pageType,
        episode.sequence.join(" -> "),
      ], 3),
    });
  }

  if (downloadIndex >= 0) {
    descriptors.push({
      patternKey: "download_requires_verification",
      patternLabel: "Downloads require explicit verification",
      rule: "Treat the workflow as complete only after a browser download event confirms success.",
      evidence: uniqueStrings([
        episode.clickTargets[0],
        episode.sequence.join(" -> "),
      ], 3),
    });
  }

  return descriptors;
}

function summarizeFeedbackOutcome(outcome: LearningFeedbackOutcome) {
  switch (outcome) {
    case "success":
      return "completed successfully";
    case "failure":
      return "failed to complete";
    case "partial":
      return "partially progressed";
    default:
      return "produced an inconclusive result";
  }
}

function buildEpisodeFeedbackSummary(episode: LearningEpisode) {
  return `${episode.intentLabel} on ${episode.domain} ${summarizeFeedbackOutcome(episode.outcome)}.`;
}

function buildEpisodeFeedbackReasonCodes(episode: LearningEpisode) {
  return uniqueStrings([
    episode.intentKey,
    episode.purposeKey,
    episode.outcome === "success" ? "progress_confirmed" : undefined,
    episode.outcome === "failure" ? "progress_failed" : undefined,
    episode.outcome === "unknown" ? "progress_unknown" : undefined,
    episode.sequence.includes("dialog.opened") ? "dialog_interruption" : undefined,
    episode.sequence.includes("download.completed") ? "download_completed" : undefined,
    episode.sequence.includes("page.navigation") ? "navigation_observed" : undefined,
  ], 8);
}

function countUserActionEvents(events: LearningRawEvent[]) {
  return events.filter((event) => event.kind === "input.input" || event.kind === "input.click").length;
}

function eventMatchesEpisodeTargets(current: EpisodeAccumulator, event: LearningRawEvent) {
  const target = describeEventTarget(event);
  if (!target) {
    return false;
  }
  const currentKeywords = collectKeywords([
    ...topTargets(current.events),
    ...topTargets(current.events, "input.input"),
    ...topTargets(current.events, "input.click"),
  ], 18);
  const targetKeywords = collectKeywords([target], 8);
  return targetKeywords.some((keyword) =>
    currentKeywords.some((entry) => entry.includes(keyword) || keyword.includes(entry)));
}

function shouldRotateForTaskBoundary(current: EpisodeAccumulator, event: LearningRawEvent) {
  if (event.kind !== "input.input" && event.kind !== "input.click") {
    return false;
  }

  const hasHardTerminal =
    current.events.some((entry) => entry.kind === "download.completed")
    || hasSuccessTextSignals(current.events)
    || hasFailureTextSignals(current.events);
  const hasDialogInterruption = current.events.some((entry) => entry.kind === "dialog.opened");
  let lastNavigationIndex = -1;
  for (let index = current.events.length - 1; index >= 0; index -= 1) {
    const kind = current.events[index]?.kind;
    if (kind === "page.navigation" || kind === "tab.created") {
      lastNavigationIndex = index;
      break;
    }
  }
  const actionsAfterNavigation = lastNavigationIndex >= 0
    ? countUserActionEvents(current.events.slice(lastNavigationIndex + 1))
    : 0;
  const lastUrl = [...current.events]
    .reverse()
    .find((entry) => typeof entry.url === "string" && entry.url.trim().length > 0)?.url;
  const pageShifted = buildExtractionPathSignature(lastUrl, inferPageType(lastUrl))
    !== buildExtractionPathSignature(event.url, inferPageType(event.url));
  const targetShifted = !eventMatchesEpisodeTargets(current, event);

  if (hasHardTerminal) {
    return pageShifted || targetShifted;
  }
  if (hasDialogInterruption && targetShifted) {
    return true;
  }
  return lastNavigationIndex >= 0 && actionsAfterNavigation >= 2 && pageShifted && targetShifted;
}

function buildEpisodeFromAccumulator(current: EpisodeAccumulator): LearningEpisode | null {
  if (current.events.length === 0) {
    return null;
  }

  const url = current.events.find((event) => event.url)?.url;
  const scheme = current.events.find((event) => event.scheme)?.scheme ?? inferScheme(url);
  const pageTitle = current.events.find((event) => event.title)?.title;
  const pageType = inferPageType(url);
  const inputTargets = topTargets(current.events, "input.input");
  const clickTargets = topTargets(current.events, "input.click");
  const sequence = compactSequence(current.events);
  const keywordSources = [
    current.domain,
    url,
    pageTitle,
    pageType,
    ...current.events.flatMap((event) => [
      event.title,
      event.summary,
      event.targetHint,
      event.targetRole,
      event.targetName,
      event.targetLabel,
      event.targetText,
      event.text,
    ]),
    ...inputTargets,
    ...clickTargets,
  ];
  const keywords = collectKeywords(keywordSources);
  const hasDownload = current.events.some((event) => event.kind === "download.completed");
  const intent = inferIntent({
    domain: current.domain,
    url,
    pageTitle,
    pageType,
    keywords,
    inputTargets,
    clickTargets,
    sequence,
    hasDownload,
  });
  const purpose = inferPurpose({
    domain: current.domain,
    url,
    pageTitle,
    pageType,
    keywords,
    inputTargets,
    clickTargets,
    sequence,
    hasDownload,
  }, intent);
  const goalSummary = buildGoalSummary({
    domain: current.domain,
    url,
    pageTitle,
    pageType,
    keywords,
    inputTargets,
    clickTargets,
    sequence,
    hasDownload,
  }, intent, purpose);
  const observationSignals = buildObservationSignals(current.events);

  return {
    episodeId: current.episodeId,
    workspaceId: current.workspaceId,
    domain: current.domain,
    startedAt: current.startedAt,
    endedAt: current.lastTs,
    eventCount: current.events.length,
    ...(scheme ? { scheme } : {}),
    ...(url ? { url } : {}),
    ...(pageTitle ? { pageTitle } : {}),
    ...(pageType ? { pageType } : {}),
    source: "human_demo",
    sourceEventIds: current.events.map((event) => event.id),
    topTargets: topTargets(current.events),
    inputTargets,
    clickTargets,
    sequence,
    keywords: collectKeywords([
      ...keywordSources,
      ...intent.keywords,
    ]),
    intentKey: intent.key,
    intentLabel: intent.label,
    purposeKey: purpose.key,
    purposeLabel: purpose.label,
    goalSummary,
    ...(observationSignals.successSignals.length > 0 ? { successSignals: observationSignals.successSignals } : {}),
    ...(observationSignals.failureSignals.length > 0 ? { failureSignals: observationSignals.failureSignals } : {}),
    outcome: inferOutcome(current.events),
  };
}

function groupEventsIntoEpisodeAccumulators(events: LearningRawEvent[]) {
  if (events.length === 0) {
    return [];
  }

  const sortedEvents = [...events].sort((left, right) =>
    left.ts - right.ts
    || left.workspaceId.localeCompare(right.workspaceId)
    || left.id.localeCompare(right.id));
  const accumulators = new Map<string, EpisodeAccumulator>();
  const builtEpisodes: EpisodeAccumulator[] = [];

  function finalizeWorkspaceEpisode(workspaceId: string) {
    const current = accumulators.get(workspaceId);
    if (!current) {
      return;
    }
    builtEpisodes.push({
      ...current,
      events: [...current.events],
    });
    accumulators.delete(workspaceId);
  }

  for (const event of sortedEvents) {
    const current = accumulators.get(event.workspaceId);
    const shouldRotate =
      !current
      || current.domain !== event.domain
      || event.ts - current.lastTs > MAX_IDLE_GAP_MS
      || current.events.length >= MAX_EPISODE_EVENTS
      || (current ? shouldRotateForTaskBoundary(current, event) : false);

    if (shouldRotate) {
      finalizeWorkspaceEpisode(event.workspaceId);
      accumulators.set(event.workspaceId, {
        episodeId: randomUUID(),
        workspaceId: event.workspaceId,
        domain: event.domain,
        startedAt: event.ts,
        lastTs: event.ts,
        events: [event],
      });
      continue;
    }

    current.events.push(event);
    current.lastTs = event.ts;
  }

  for (const workspaceId of accumulators.keys()) {
    finalizeWorkspaceEpisode(workspaceId);
  }

  return builtEpisodes;
}

function buildEpisodesFromEvents(events: LearningRawEvent[]) {
  return groupEventsIntoEpisodeAccumulators(events)
    .flatMap((accumulator) => {
      const episode = buildEpisodeFromAccumulator(accumulator);
      return episode ? [episode] : [];
    });
}

function mapEventKindToProgressMethod(kind: string): LearningProgressMethod | undefined {
  switch (kind) {
    case "input.input":
      return "input";
    case "input.click":
      return "click";
    case "input.scroll":
      return "scroll";
    case "page.navigation":
    case "tab.created":
      return "navigation";
    case "dialog.opened":
      return "dialog";
    case "download.completed":
      return "download";
    default:
      return undefined;
  }
}

function buildActiveProgressFromAccumulator(current: EpisodeAccumulator): LearningProgressItem | null {
  const episode = buildEpisodeFromAccumulator(current);
  if (!episode) {
    return null;
  }

  const latestEvent = current.events.at(-1);
  const latestMeaningfulEvent = [...current.events]
    .reverse()
    .find((event) =>
      Boolean(
        event.summary
        || event.text
        || event.targetHint
        || event.targetLabel
        || event.targetName
        || event.targetText
        || event.title,
      )) ?? latestEvent;
  const targetSummary = uniqueStrings(
    [...current.events].reverse().map((event) => describeEventTarget(event)),
    3,
  ).join(" · ");
  const contentPreview = uniqueStrings([
    latestMeaningfulEvent?.summary,
    latestMeaningfulEvent?.text,
    latestMeaningfulEvent?.targetText,
    latestMeaningfulEvent?.targetLabel,
    latestMeaningfulEvent?.targetName,
    latestMeaningfulEvent?.title,
    episode.goalSummary,
  ], 2).join(" · ");
  const methods = uniqueStrings(
    current.events.map((event) => mapEventKindToProgressMethod(event.kind)),
    6,
  ) as LearningProgressMethod[];

  return {
    progressId: episode.episodeId,
    mode: "observe_workflow",
    workspaceId: episode.workspaceId,
    domain: episode.domain,
    ...(episode.url ? { url: episode.url } : {}),
    ...(episode.pageTitle ? { pageTitle: episode.pageTitle } : {}),
    ...(episode.pageType ? { pageType: episode.pageType } : {}),
    updatedAt: episode.endedAt,
    eventCount: episode.eventCount,
    methods,
    ...(latestEvent?.kind ? { latestEventKind: latestEvent.kind } : {}),
    ...(latestEvent?.summary ? { latestEventSummary: truncateText(latestEvent.summary, 160) } : {}),
    ...(targetSummary ? { targetSummary: truncateText(targetSummary, 160) } : {}),
    ...(contentPreview ? { contentPreview: truncateText(contentPreview, 180) } : {}),
  };
}

function buildEpisodeSimilarityKey(episode: LearningEpisode) {
  const semanticTokens = collectKeywords([
    episode.goalSummary,
    ...episode.inputTargets,
    ...episode.clickTargets,
    ...episode.topTargets,
  ], 10)
    .sort()
    .join(",");
  const toolOrder = compactToolSequence(episode.sequence).join(">");
  const targetShape = `${episode.inputTargets.length}:${episode.clickTargets.length}:${episode.topTargets.length}`;
  return [
    episode.workspaceId,
    episode.domain,
    episode.scheme ?? "unknown",
    episode.pageType ?? "unknown",
    episode.intentKey,
    episode.purposeKey,
    toolOrder || "none",
    targetShape,
    semanticTokens || "none",
  ].join("|");
}

function compareEpisodeQuality(left: LearningEpisode, right: LearningEpisode) {
  const outcomeScore = (outcome: LearningEpisode["outcome"]) => {
    switch (outcome) {
      case "success":
        return 2;
      case "unknown":
        return 1;
      default:
        return 0;
    }
  };

  return outcomeScore(left.outcome) - outcomeScore(right.outcome)
    || (left.inputTargets.length + left.clickTargets.length + left.topTargets.length)
      - (right.inputTargets.length + right.clickTargets.length + right.topTargets.length)
    || left.sequence.length - right.sequence.length
    || left.eventCount - right.eventCount
    || left.endedAt - right.endedAt;
}

function dedupeEpisodesForLearning(episodes: LearningEpisode[]) {
  const bestByKey = new Map<string, LearningEpisode>();

  for (const episode of episodes) {
    const key = buildEpisodeSimilarityKey(episode);
    const existing = bestByKey.get(key);
    if (!existing || compareEpisodeQuality(episode, existing) > 0) {
      bestByKey.set(key, episode);
    }
  }

  return Array.from(bestByKey.values())
    .sort((left, right) => left.endedAt - right.endedAt || left.startedAt - right.startedAt);
}

function normalizeRawEvent(value: unknown): LearningRawEvent | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  const workspaceId = readString(value.workspaceId);
  const domain = readString(value.domain);
  const ts = readNumber(value.ts);
  const kind = readString(value.kind);
  if (!id || !workspaceId || !domain || ts === undefined || !kind) {
    return null;
  }

  return {
    id,
    workspaceId,
    domain,
    ts,
    kind,
    ...(readString(value.scheme) ? { scheme: readString(value.scheme)?.toLowerCase() } : {}),
    ...(readString(value.tabId) ? { tabId: readString(value.tabId) } : {}),
    ...(readString(value.url) ? { url: readString(value.url) } : {}),
    ...(readString(value.title) ? { title: readString(value.title) } : {}),
    ...(readString(value.source) ? { source: readString(value.source) } : {}),
    ...(readString(value.summary) ? { summary: readString(value.summary) } : {}),
    ...(readString(value.targetHint) ? { targetHint: readString(value.targetHint) } : {}),
    ...(readString(value.targetRole) ? { targetRole: readString(value.targetRole) } : {}),
    ...(readString(value.targetName) ? { targetName: readString(value.targetName) } : {}),
    ...(readString(value.targetLabel) ? { targetLabel: readString(value.targetLabel) } : {}),
    ...(readString(value.targetText) ? { targetText: readString(value.targetText) } : {}),
    ...(readString(value.text) ? { text: readString(value.text) } : {}),
    ...(readString(value.pageSnapshotId) ? { pageSnapshotId: readString(value.pageSnapshotId) } : {}),
  };
}

function normalizePageSnapshotRegion(value: unknown): LearningPageSnapshotRegion | null {
  if (!isRecord(value)) {
    return null;
  }
  const role = readString(value.role);
  const name = readString(value.name);
  const textSummary = readString(value.textSummary);
  const regionId = readString(value.regionId);
  if (!role && !name && !textSummary && !regionId) {
    return null;
  }
  return {
    ...(regionId ? { regionId } : {}),
    ...(role ? { role } : {}),
    ...(name ? { name: truncateText(name, 96) } : {}),
    ...(textSummary ? { textSummary: truncateText(textSummary, 180) } : {}),
  };
}

function normalizePageSnapshotForm(value: unknown): LearningPageSnapshotForm | null {
  if (!isRecord(value)) {
    return null;
  }
  const formId = readString(value.formId);
  const name = readString(value.name);
  const description = readString(value.description);
  const textSummary = readString(value.textSummary);
  if (!formId && !name && !description && !textSummary) {
    return null;
  }
  return {
    ...(formId ? { formId } : {}),
    ...(name ? { name: truncateText(name, 96) } : {}),
    ...(description ? { description: truncateText(description, 160) } : {}),
    ...(textSummary ? { textSummary: truncateText(textSummary, 180) } : {}),
  };
}

function normalizePageSnapshotInformationBlock(value: unknown): LearningPageSnapshotInformationBlock | null {
  if (!isRecord(value)) {
    return null;
  }
  const type = readString(value.type);
  if (!type) {
    return null;
  }
  const blockId = readString(value.blockId);
  const regionId = readString(value.regionId);
  const title = readString(value.title);
  const summary = readString(value.summary);
  const itemCount = readNumber(value.itemCount);
  const extractable = readBoolean(value.extractable);
  return {
    type,
    ...(blockId ? { blockId } : {}),
    ...(regionId ? { regionId } : {}),
    ...(title ? { title: truncateText(title, 96) } : {}),
    ...(summary ? { summary: truncateText(summary, 180) } : {}),
    ...(itemCount !== undefined ? { itemCount: Math.max(0, Math.floor(itemCount)) } : {}),
    ...(extractable !== undefined ? { extractable } : {}),
  };
}

function normalizePageSnapshotCapability(value: unknown): LearningPageSnapshotCapability | null {
  if (!isRecord(value)) {
    return null;
  }
  const type = readString(value.type);
  if (!type) {
    return null;
  }
  const actions = Array.isArray(value.actions)
    ? value.actions
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  return {
    type,
    ...(readString(value.capabilityId) ? { capabilityId: readString(value.capabilityId) } : {}),
    ...(readString(value.regionId) ? { regionId: readString(value.regionId) } : {}),
    ...(readString(value.formId) ? { formId: readString(value.formId) } : {}),
    ...(readString(value.title) ? { title: truncateText(readString(value.title) as string, 96) } : {}),
    ...(readString(value.label) ? { label: truncateText(readString(value.label) as string, 96) } : {}),
    ...(readString(value.description)
      ? { description: truncateText(readString(value.description) as string, 160) }
      : {}),
    actions,
  };
}

function buildPageSnapshotHash(input: {
  workspaceId: string;
  domain: string;
  tabId?: string;
  url?: string;
  title?: string;
  semanticSnapshotId?: string;
  domHash: string;
  redacted: boolean;
  regions: LearningPageSnapshotRegion[];
  forms: LearningPageSnapshotForm[];
  information: LearningPageSnapshotInformationBlock[];
  capabilities: LearningPageSnapshotCapability[];
  dataKeys: string[];
}) {
  return hashText(JSON.stringify({
    workspaceId: input.workspaceId,
    domain: input.domain,
    tabId: input.tabId,
    url: input.url,
    title: input.title,
    semanticSnapshotId: input.semanticSnapshotId,
    domHash: input.domHash,
    redacted: input.redacted,
    regions: input.regions,
    forms: input.forms,
    information: input.information,
    capabilities: input.capabilities,
    dataKeys: input.dataKeys,
  }));
}

function normalizePageSnapshot(value: unknown): LearningPageSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }
  const pageSnapshotId = readString(value.pageSnapshotId);
  const workspaceId = readString(value.workspaceId);
  const domain = readString(value.domain);
  const ts = readNumber(value.ts);
  if (!pageSnapshotId || !workspaceId || !domain || ts === undefined) {
    return null;
  }

  const legacyDomHtml = readString(value.domHtml);
  const domLength = readNumber(value.domLength);
  const domTruncated = readBoolean(value.domTruncated)
    ?? (legacyDomHtml ? legacyDomHtml.length > MAX_PAGE_SNAPSHOT_DOM_CHARS : undefined);
  const redacted = readBoolean(value.redacted) ?? false;
  const bodyText = readString(value.bodyText);
  const regions = Array.isArray(value.regions)
    ? value.regions
      .map((entry) => normalizePageSnapshotRegion(entry))
      .filter((entry): entry is LearningPageSnapshotRegion => entry !== null)
    : [];
  const forms = Array.isArray(value.forms)
    ? value.forms
      .map((entry) => normalizePageSnapshotForm(entry))
      .filter((entry): entry is LearningPageSnapshotForm => entry !== null)
    : [];
  const information = Array.isArray(value.information)
    ? value.information
      .map((entry) => normalizePageSnapshotInformationBlock(entry))
      .filter((entry): entry is LearningPageSnapshotInformationBlock => entry !== null)
    : [];
  const capabilities = Array.isArray(value.capabilities)
    ? value.capabilities
      .map((entry) => normalizePageSnapshotCapability(entry))
      .filter((entry): entry is LearningPageSnapshotCapability => entry !== null)
    : [];
  const dataKeys = sanitizeGuidanceTextList(
    Array.isArray(value.dataKeys)
      ? value.dataKeys.filter((entry): entry is string => typeof entry === "string")
      : [],
    20,
    64,
  );
  const domHash = readString(value.domHash)
    ?? hashText(legacyDomHtml ?? "");
  const snapshotHash = readString(value.snapshotHash)
    ?? buildPageSnapshotHash({
      workspaceId,
      domain,
      ...(readString(value.tabId) ? { tabId: readString(value.tabId) } : {}),
      ...(readString(value.url) ? { url: readString(value.url) } : {}),
      ...(readString(value.title) ? { title: readString(value.title) } : {}),
      ...(readString(value.semanticSnapshotId) ? { semanticSnapshotId: readString(value.semanticSnapshotId) } : {}),
      domHash,
      redacted,
      regions,
      forms,
      information,
      capabilities,
      dataKeys,
    });

  return {
    pageSnapshotId,
    workspaceId,
    domain,
    ts,
    snapshotHash,
    domHash,
    redacted,
    ...(readString(value.scheme) ? { scheme: readString(value.scheme)?.toLowerCase() } : {}),
    ...(readString(value.tabId) ? { tabId: readString(value.tabId) } : {}),
    ...(readString(value.url) ? { url: readString(value.url) } : {}),
    ...(readString(value.title) ? { title: readString(value.title) } : {}),
    ...(readString(value.semanticSnapshotId) ? { semanticSnapshotId: readString(value.semanticSnapshotId) } : {}),
    ...(bodyText ? { bodyText: truncateText(bodyText, 4_000) } : {}),
    ...(domLength !== undefined ? { domLength: Math.max(0, Math.floor(domLength)) } : {}),
    ...(domTruncated !== undefined ? { domTruncated } : {}),
    regions,
    forms,
    information,
    capabilities,
    dataKeys,
  };
}

function normalizeEpisode(value: unknown): LearningEpisode | null {
  if (!isRecord(value)) {
    return null;
  }

  const episodeId = readString(value.episodeId);
  const workspaceId = readString(value.workspaceId);
  const domain = readString(value.domain);
  const startedAt = readNumber(value.startedAt);
  const endedAt = readNumber(value.endedAt);
  const eventCount = readNumber(value.eventCount);
  const outcome = readString(value.outcome);
  if (
    !episodeId
    || !workspaceId
    || !domain
    || startedAt === undefined
    || endedAt === undefined
    || eventCount === undefined
    || (outcome !== "success" && outcome !== "failure" && outcome !== "unknown")
  ) {
    return null;
  }

  const normalizedIntent = normalizeStoredIntentFields(
    readString(value.intentKey),
    readString(value.intentLabel),
  );

  return {
    episodeId,
    workspaceId,
    domain,
    startedAt,
    endedAt,
    eventCount: Math.max(0, Math.floor(eventCount)),
    ...(readString(value.scheme) ? { scheme: readString(value.scheme)?.toLowerCase() } : {}),
    ...(readString(value.url) ? { url: readString(value.url) } : {}),
    ...(readString(value.pageTitle) ? { pageTitle: readString(value.pageTitle) } : {}),
    ...(readString(value.pageType) ? { pageType: readString(value.pageType) } : {}),
    ...(readString(value.source) ? { source: readString(value.source) as LearningEpisode["source"] } : {}),
    sourceEventIds: Array.isArray(value.sourceEventIds)
      ? value.sourceEventIds
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : undefined,
    topTargets: Array.isArray(value.topTargets)
      ? value.topTargets
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
    inputTargets: Array.isArray(value.inputTargets)
      ? value.inputTargets
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
    clickTargets: Array.isArray(value.clickTargets)
      ? value.clickTargets
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
    sequence: Array.isArray(value.sequence)
      ? value.sequence
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
    keywords: Array.isArray(value.keywords)
      ? value.keywords
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
    intentKey: normalizedIntent.intentKey,
    intentLabel: normalizedIntent.intentLabel,
    ...resolvePurposeFields(
      normalizedIntent.intentKey,
      readString(value.purposeKey),
      readString(value.purposeLabel),
    ),
    goalSummary: buildStoredGoalSummary({
      domain,
      url: readString(value.url),
      pageTitle: readString(value.pageTitle),
      pageType: readString(value.pageType),
      keywords: Array.isArray(value.keywords)
        ? value.keywords
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        : [],
      inputTargets: Array.isArray(value.inputTargets)
        ? value.inputTargets
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        : [],
      clickTargets: Array.isArray(value.clickTargets)
        ? value.clickTargets
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        : [],
      sequence: Array.isArray(value.sequence)
        ? value.sequence
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        : [],
      hasDownload:
        normalizedIntent.intentKey === "download_result"
        || (Array.isArray(value.sequence)
          && value.sequence.some((entry) => entry === "download.completed")),
      intentKey: normalizedIntent.intentKey,
      intentLabel: normalizedIntent.intentLabel,
      purposeKey: readString(value.purposeKey),
      purposeLabel: readString(value.purposeLabel),
      goalSummary: normalizedIntent.wasLegacySpecialization
        ? undefined
        : readString(value.goalSummary),
    }),
    successSignals: Array.isArray(value.successSignals)
      ? value.successSignals
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : undefined,
    failureSignals: Array.isArray(value.failureSignals)
      ? value.failureSignals
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : undefined,
    outcome,
  };
}

function normalizeGuidance(value: unknown): LearningGuidance | null {
  if (!isRecord(value)) {
    return null;
  }

  const guidanceId = readString(value.guidanceId);
  const workspaceId = readString(value.workspaceId);
  const domain = readString(value.domain);
  const intentKey = readString(value.intentKey);
  const intentLabel = readString(value.intentLabel);
  const support = readNumber(value.support);
  const successRate = readNumber(value.successRate);
  const confidence = readNumber(value.confidence);
  const lastSeenAt = readNumber(value.lastSeenAt);
  if (
    !guidanceId
    || !workspaceId
    || !domain
    || !intentKey
    || !intentLabel
    || support === undefined
    || successRate === undefined
    || confidence === undefined
    || lastSeenAt === undefined
  ) {
    return null;
  }

  const normalizedIntent = normalizeStoredIntentFields(intentKey, intentLabel);
  const normalizedGuidance: LearningGuidance = {
    assetKind: "action_strategy",
    guidanceId,
    workspaceId,
    domain,
    ...(readString(value.scheme) ? { scheme: readString(value.scheme)?.toLowerCase() } : {}),
    ...(readString(value.pageType) ? { pageType: readString(value.pageType) } : {}),
    intentKey: normalizedIntent.intentKey,
    intentLabel: normalizedIntent.intentLabel,
    ...resolvePurposeFields(
      normalizedIntent.intentKey,
      readString(value.purposeKey),
      readString(value.purposeLabel),
    ),
    goalSummary: buildStoredGoalSummary({
      domain,
      url: undefined,
      pageTitle: undefined,
      pageType: readString(value.pageType),
      keywords: Array.isArray(value.keywords)
        ? value.keywords
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        : [],
      inputTargets: Array.isArray(value.inputTargets)
        ? value.inputTargets
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        : [],
      clickTargets: Array.isArray(value.clickTargets)
        ? value.clickTargets
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        : [],
      sequence: Array.isArray(value.sampleSequence)
        ? value.sampleSequence
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        : [],
      hasDownload: normalizedIntent.intentKey === "download_result",
      intentKey: normalizedIntent.intentKey,
      intentLabel: normalizedIntent.intentLabel,
      purposeKey: readString(value.purposeKey),
      purposeLabel: readString(value.purposeLabel),
      goalSummary: normalizedIntent.wasLegacySpecialization
        ? undefined
        : readString(value.goalSummary),
    }),
    keywords: Array.isArray(value.keywords)
      ? value.keywords
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
    inputTargets: Array.isArray(value.inputTargets)
      ? value.inputTargets
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
    clickTargets: Array.isArray(value.clickTargets)
      ? value.clickTargets
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
    preferredTargets: Array.isArray(value.preferredTargets)
      ? value.preferredTargets
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
    recommendedSteps: Array.isArray(value.recommendedSteps)
      ? value.recommendedSteps
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
    toolOrder: Array.isArray(value.toolOrder)
      ? value.toolOrder
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
    recoveryHints: Array.isArray(value.recoveryHints)
      ? value.recoveryHints
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
    cautionNotes: Array.isArray(value.cautionNotes)
      ? value.cautionNotes
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
    support: Math.max(0, Math.floor(support)),
    successRate: Math.max(0, Math.min(1, Number(successRate))),
    confidence: Math.max(0, Math.min(1, Number(confidence))),
    lastSeenAt,
    sampleSequence: Array.isArray(value.sampleSequence)
      ? value.sampleSequence
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
  };

  if (normalizedIntent.wasLegacySpecialization) {
    normalizedGuidance.recommendedSteps = buildRecommendedSteps(normalizedGuidance);
    normalizedGuidance.recoveryHints = buildRecoveryHints(normalizedGuidance);
    normalizedGuidance.cautionNotes = buildCautionNotes(normalizedGuidance);
  }

  if (normalizedGuidance.recoveryHints.length === 0) {
    normalizedGuidance.recoveryHints = buildRecoveryHints(normalizedGuidance);
  }

  return normalizedGuidance;
}

function normalizeSiteSkill(value: unknown): LearningSiteSkill | null {
  if (!isRecord(value)) {
    return null;
  }

  const skillId = readString(value.skillId);
  const workspaceId = readString(value.workspaceId);
  const domain = readString(value.domain);
  const patternKey = readString(value.patternKey) as LearningSiteSkillPatternKey | undefined;
  const patternLabel = readString(value.patternLabel);
  const rule = readString(value.rule);
  const support = readNumber(value.support);
  const successRate = readNumber(value.successRate);
  const confidence = readNumber(value.confidence);
  const lastSeenAt = readNumber(value.lastSeenAt);
  if (
    !skillId
    || !workspaceId
    || !domain
    || !patternKey
    || !patternLabel
    || !rule
    || support === undefined
    || successRate === undefined
    || confidence === undefined
    || lastSeenAt === undefined
  ) {
    return null;
  }

  return {
    assetKind: "site_skill",
    skillId,
    workspaceId,
    domain,
    ...(readString(value.scheme) ? { scheme: readString(value.scheme)?.toLowerCase() } : {}),
    ...(readString(value.pageType) ? { pageType: readString(value.pageType) } : {}),
    patternKey,
    patternLabel,
    rule: truncateText(rule, 220),
    evidence: Array.isArray(value.evidence)
      ? value.evidence
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
    support: Math.max(0, Math.floor(support)),
    successRate: Math.max(0, Math.min(1, Number(successRate))),
    confidence: Math.max(0, Math.min(1, Number(confidence))),
    lastSeenAt,
    sourceGuidanceIds: Array.isArray(value.sourceGuidanceIds)
      ? value.sourceGuidanceIds
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
  };
}

function normalizeFeedbackOutcome(value: unknown): LearningFeedbackOutcome | undefined {
  switch (value) {
    case "success":
    case "failure":
    case "partial":
    case "unknown":
      return value;
    default:
      return undefined;
  }
}

function normalizeFeedbackRecord(value: unknown): LearningFeedbackRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const feedbackId = readString(value.feedbackId);
  const workspaceId = readString(value.workspaceId);
  const domain = readString(value.domain);
  const ts = readNumber(value.ts);
  const outcome = normalizeFeedbackOutcome(value.outcome);
  const source = readString(value.source) as LearningFeedbackRecord["source"] | undefined;
  const summary = readString(value.summary);
  if (!feedbackId || !workspaceId || !domain || ts === undefined || !outcome || !source || !summary) {
    return null;
  }

  return {
    assetKind: "feedback_record",
    feedbackId,
    workspaceId,
    domain,
    ts,
    outcome,
    source,
    summary: truncateText(summary, 220),
    reasonCodes: Array.isArray(value.reasonCodes)
      ? value.reasonCodes
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
    verifierSignals: Array.isArray(value.verifierSignals)
      ? value.verifierSignals
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
    ...(readString(value.scheme) ? { scheme: readString(value.scheme)?.toLowerCase() } : {}),
    ...(readString(value.pageType) ? { pageType: readString(value.pageType) } : {}),
    ...(readString(value.episodeId) ? { episodeId: readString(value.episodeId) } : {}),
    ...(readString(value.guidanceId) ? { guidanceId: readString(value.guidanceId) } : {}),
    ...(readString(value.skillId) ? { skillId: readString(value.skillId) } : {}),
    ...(readString(value.recipeId) ? { recipeId: readString(value.recipeId) } : {}),
  };
}

function normalizeHistoryProfile(value: unknown): LearningHistoryProfile | null {
  if (!isRecord(value)) {
    return null;
  }

  const profileId = readString(value.profileId);
  const scopeKey = readString(value.scopeKey);
  const domain = readString(value.domain);
  const activityLevel = readString(value.activityLevel) as LearningHistoryProfile["activityLevel"] | undefined;
  const revisitPattern = readString(value.revisitPattern) as LearningHistoryProfile["revisitPattern"] | undefined;
  const confidence = readNumber(value.confidence);
  const recordHash = readString(value.recordHash);
  const lastUpdatedAt = readNumber(value.lastUpdatedAt);
  if (
    !profileId
    || !scopeKey
    || !domain
    || (activityLevel !== "high" && activityLevel !== "medium" && activityLevel !== "low")
    || (revisitPattern !== "habitual" && revisitPattern !== "balanced" && revisitPattern !== "exploratory")
    || confidence === undefined
    || !recordHash
    || lastUpdatedAt === undefined
  ) {
    return null;
  }

  return {
    assetKind: "history_profile",
    profileId,
    scopeKey,
    ...(readString(value.workspaceId) ? { workspaceId: readString(value.workspaceId) } : {}),
    domain,
    activityLevel,
    revisitPattern,
    ...(readString(value.profileSummary) ? { profileSummary: truncateText(readString(value.profileSummary) as string, 220) } : {}),
    commonIntents: Array.isArray(value.commonIntents)
      ? value.commonIntents
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
    revisitDrivers: Array.isArray(value.revisitDrivers)
      ? value.revisitDrivers
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
    confidence: Math.max(0, Math.min(1, Number(confidence))),
    recordHash,
    lastUpdatedAt,
  };
}

function normalizeWritingSample(value: unknown): LearningWritingSample | null {
  if (!isRecord(value)) {
    return null;
  }

  const sampleId = readString(value.sampleId);
  const workspaceId = readString(value.workspaceId);
  const domain = readString(value.domain);
  const ts = readNumber(value.ts);
  const text = normalizeWritingText(value.text);
  const charCount = readNumber(value.charCount);
  const wordCount = readNumber(value.wordCount);
  const contextType = normalizeWritingContextType(value.contextType);
  const slot = normalizeWritingSlot(value.slot);
  if (
    !sampleId
    || !workspaceId
    || !domain
    || ts === undefined
    || !text
    || charCount === undefined
    || wordCount === undefined
    || !contextType
    || !slot
  ) {
    return null;
  }

  return {
    sampleId,
    workspaceId,
    domain,
    ts,
    text,
    charCount: Math.max(0, Math.floor(charCount)),
    wordCount: Math.max(0, Math.floor(wordCount)),
    contextType,
    slot,
    ...(readString(value.scheme) ? { scheme: readString(value.scheme)?.toLowerCase() } : {}),
    ...(readString(value.pageType) ? { pageType: readString(value.pageType) } : {}),
    ...(readString(value.url) ? { url: readString(value.url) } : {}),
    ...(readString(value.pageTitle) ? { pageTitle: readString(value.pageTitle) } : {}),
    ...(normalizeWritingHint(value.fieldHint) ? { fieldHint: normalizeWritingHint(value.fieldHint) } : {}),
    ...(normalizeWritingRecipientKey(value.recipientKey) ? { recipientKey: normalizeWritingRecipientKey(value.recipientKey) } : {}),
    ...(normalizeWritingRecipient(value.recipientLabel) ? { recipientLabel: normalizeWritingRecipient(value.recipientLabel) } : {}),
  };
}

function normalizeStyleProfile(value: unknown): LearningStyleProfile | null {
  if (!isRecord(value)) {
    return null;
  }

  const profileId = readString(value.profileId);
  const workspaceId = readString(value.workspaceId);
  const exemplarCount = readNumber(value.exemplarCount);
  const averageLength = readNumber(value.averageLength);
  const confidence = readNumber(value.confidence);
  const lastUpdatedAt = readNumber(value.lastUpdatedAt);
  if (
    !profileId
    || !workspaceId
    || exemplarCount === undefined
    || confidence === undefined
    || lastUpdatedAt === undefined
  ) {
    return null;
  }

  return {
    assetKind: "style_profile",
    profileId,
    workspaceId,
    ...(readString(value.domain) ? { domain: readString(value.domain) } : {}),
    ...(readString(value.scheme) ? { scheme: readString(value.scheme)?.toLowerCase() } : {}),
    ...(readString(value.pageType) ? { pageType: readString(value.pageType) } : {}),
    ...(normalizeWritingContextType(value.contextType) ? { contextType: normalizeWritingContextType(value.contextType) } : {}),
    ...(readString(value.contextLabel) ? { contextLabel: readString(value.contextLabel) } : {}),
    ...(normalizeWritingSlot(value.slot) ? { slot: normalizeWritingSlot(value.slot) } : {}),
    ...(readString(value.slotLabel) ? { slotLabel: readString(value.slotLabel) } : {}),
    ...(normalizeWritingHint(value.fieldHint) ? { fieldHint: normalizeWritingHint(value.fieldHint) } : {}),
    ...(normalizeWritingRecipientKey(value.recipientKey) ? { recipientKey: normalizeWritingRecipientKey(value.recipientKey) } : {}),
    ...(normalizeWritingRecipient(value.recipientLabel) ? { recipientLabel: normalizeWritingRecipient(value.recipientLabel) } : {}),
    ...(readString(value.tone) ? { tone: readString(value.tone) } : {}),
    ...(readString(value.formality) ? { formality: readString(value.formality) } : {}),
    ...(readString(value.searchStyle) ? { searchStyle: readString(value.searchStyle) } : {}),
    ...(readString(value.emailStyle) ? { emailStyle: readString(value.emailStyle) } : {}),
    ...(readString(value.forumStyle) ? { forumStyle: readString(value.forumStyle) } : {}),
    ...(readString(value.articleStyle) ? { articleStyle: readString(value.articleStyle) } : {}),
    ...(readString(value.notesStyle) ? { notesStyle: readString(value.notesStyle) } : {}),
    ...(readString(value.styleSummary) ? { styleSummary: readString(value.styleSummary) } : {}),
    commonPhrases: Array.isArray(value.commonPhrases)
      ? value.commonPhrases
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
    exemplarSnippets: Array.isArray(value.exemplarSnippets)
      ? value.exemplarSnippets
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
    exemplarCount: Math.max(0, Math.floor(exemplarCount)),
    averageLength: Math.max(0, Math.floor(averageLength ?? 0)),
    confidence: Math.max(0, Math.min(1, Number(confidence))),
    lastUpdatedAt,
  };
}

function normalizePreferenceCategory(value: unknown): LearningPreferenceCategory | undefined {
  switch (value) {
    case "recent_focus":
    case "stable_preference":
    case "negative_preference":
    case "workflow_preference":
      return value;
    default:
      return undefined;
  }
}

function normalizePreferenceSource(value: unknown): LearningPreferenceSignalSource | undefined {
  switch (value) {
    case "explicit":
    case "observed":
    case "manual":
    case "agent_interaction":
    case "browsing_history":
    case "workflow_learning":
    case "writing_style":
      return value;
    default:
      return undefined;
  }
}

function normalizePreferenceScope(value: unknown): LearningPreferenceScope | undefined {
  switch (value) {
    case "global":
    case "workspace":
    case "domain":
      return value;
    default:
      return undefined;
  }
}

function normalizePreferenceStatus(value: unknown): LearningPreferenceStatus | undefined {
  switch (value) {
    case "active":
    case "stale":
    case "rejected":
      return value;
    default:
      return undefined;
  }
}

function normalizePreferenceDomain(value: unknown) {
  const normalized = normalizeBlacklistDomain(readString(value));
  return normalized && normalized !== "unknown" ? normalized : undefined;
}

function buildPreferenceProfileId(workspaceId: string) {
  return `user-memory:${workspaceId}`;
}

function buildPreferenceSignalId(input: {
  profileId: string;
  key: string;
  category?: LearningPreferenceCategory;
  scope?: LearningPreferenceScope;
  domain?: string;
}) {
  return hashText([
    input.profileId,
    input.category ?? "stable_preference",
    input.scope ?? "global",
    input.domain ?? "",
    input.key.trim().toLowerCase(),
  ].join("\u0000"));
}

function normalizePreferenceEvidenceRefs(value: unknown) {
  return sanitizeGuidanceTextList(
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [],
    8,
    160,
  );
}

function normalizePreferenceSignal(
  value: unknown,
  profileId = "preference_profile",
): LearningPreferenceProfile["signals"][number] | null {
  if (!isRecord(value)) {
    return null;
  }
  const key = readString(value.key);
  const valueText = readString(value.value);
  const confidence = readNumber(value.confidence);
  const source = normalizePreferenceSource(value.source);
  const updatedAt = readNumber(value.updatedAt);
  if (
    !key
    || !valueText
    || confidence === undefined
    || updatedAt === undefined
    || !source
  ) {
    return null;
  }
  const category = normalizePreferenceCategory(value.category) ?? "stable_preference";
  const scope = normalizePreferenceScope(value.scope) ?? "global";
  const domain = normalizePreferenceDomain(value.domain);
  const createdAt = readNumber(value.createdAt) ?? updatedAt;
  const lastSeenAt = readNumber(value.lastSeenAt) ?? updatedAt;
  const expiresAt = readNumber(value.expiresAt);
  const status = normalizePreferenceStatus(value.status) ?? "active";
  return {
    id: readString(value.id) ?? buildPreferenceSignalId({
      profileId,
      key,
      category,
      scope,
      domain,
    }),
    key,
    value: valueText,
    category,
    confidence: Math.max(0, Math.min(1, Number(confidence))),
    source,
    strength: Math.max(0, Math.min(1, readNumber(value.strength) ?? Number(confidence))),
    evidenceRefs: normalizePreferenceEvidenceRefs(value.evidenceRefs),
    scope,
    ...(domain ? { domain } : {}),
    createdAt,
    lastSeenAt,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    status,
    updatedAt,
  };
}

function normalizePreferenceProfile(value: unknown): LearningPreferenceProfile | null {
  if (!isRecord(value)) {
    return null;
  }

  const profileId = readString(value.profileId);
  const workspaceId = readString(value.workspaceId);
  const lastUpdatedAt = readNumber(value.lastUpdatedAt);
  if (!profileId || !workspaceId || lastUpdatedAt === undefined) {
    return null;
  }

  return {
    assetKind: "preference_profile",
    profileId,
    workspaceId,
    signals: Array.isArray(value.signals)
      ? value.signals
        .map((entry) => normalizePreferenceSignal(entry, profileId))
        .filter((entry): entry is LearningPreferenceProfile["signals"][number] => entry !== null)
      : [],
    lastUpdatedAt,
  };
}

function normalizeDeletedHistoryDomain(value: unknown): LearningDeletedHistoryDomain | null {
  if (!isRecord(value)) {
    return null;
  }
  const domain = normalizeBlacklistDomain(readString(value.domain));
  const deletedAt = readNumber(value.deletedAt);
  if (!domain || deletedAt === undefined) {
    return null;
  }
  return {
    domain,
    deletedAt,
  };
}

function normalizeDeletedStyleProfileGroup(value: unknown): LearningDeletedStyleProfileGroup | null {
  if (!isRecord(value)) {
    return null;
  }
  const profileId = readString(value.profileId)?.trim();
  const deletedAt = readNumber(value.deletedAt);
  if (!profileId || deletedAt === undefined) {
    return null;
  }
  return {
    profileId,
    deletedAt,
  };
}

export function createLearningStore(options: CreateLearningStoreOptions) {
  let rawEvents: LearningRawEvent[] = [];
  let pageSnapshots: LearningPageSnapshot[] = [];
  let learnedEventIds: string[] = [];
  let llmLearnedEpisodeIds: string[] = [];
  let deferredEpisodeLearningIds: string[] = [];
  let deferredHistoryProfileKeys: string[] = [];
  let deferredStyleProfileIds: string[] = [];
  let episodes: LearningEpisode[] = [];
  let deletedHistoryDomains: LearningDeletedHistoryDomain[] = [];
  let historyProfiles: LearningHistoryProfile[] = [];
  let guidances: LearningGuidance[] = [];
  let siteSkills: LearningSiteSkill[] = [];
  let feedbackRecords: LearningFeedbackRecord[] = [];
  let writingSamples: LearningWritingSample[] = [];
  let deletedStyleProfileGroups: LearningDeletedStyleProfileGroup[] = [];
  let styleProfiles: LearningStyleProfile[] = [];
  let preferenceProfiles: LearningPreferenceProfile[] = [];
  let extractionRecipes: LearningExtractionRecipe[] = [];
  let saveTimer: NodeJS.Timeout | null = null;

  function getUserBlacklistDomains() {
    return options.getPreferences().blacklistDomains;
  }

  function isBlacklistedRecord(
    record: { domain: string; url?: string; scheme?: string },
    blacklistDomains: string[],
  ) {
    const scheme = record.scheme ?? inferScheme(record.url);
    if (scheme === "milo:") {
      return true;
    }
    return matchesBlacklistedDomain(record.domain, blacklistDomains);
  }

  function getPendingEventCount(
    scope: {
      workspaceId?: string;
      domain?: string;
    } | undefined,
    blacklistDomains: string[],
  ) {
    const cutoff = startOfLocalDay(Date.now());
    const learnedIds = new Set(learnedEventIds);
    return rawEvents.filter((event: LearningRawEvent) =>
      event.ts < cutoff
      && !learnedIds.has(event.id)
      && !isBlacklistedRecord(event, blacklistDomains)
      && (!scope?.workspaceId || event.workspaceId === scope.workspaceId)
      && (!scope?.domain || event.domain === scope.domain))
      .length;
  }

  function ensureStateDirectory() {
    mkdirSync(dirname(options.statePath), { recursive: true });
  }

  function buildStatePayload(): LearningStatePayload {
    return {
      version: LEARNING_STATE_VERSION,
      rawEvents,
      pageSnapshots,
      learnedEventIds,
      llmLearnedEpisodeIds,
      deferredEpisodeLearningIds,
      deferredHistoryProfileKeys,
      deferredStyleProfileIds,
      episodes,
      deletedHistoryDomains,
      historyProfiles,
      guidances,
      siteSkills,
      feedbackRecords,
      writingSamples,
      deletedStyleProfileGroups,
      styleProfiles,
      preferenceProfiles,
      extractionRecipes,
    };
  }

  function scheduleSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
      saveTimer = null;
      flush();
    }, SAVE_DELAY_MS);
  }

  function persistGuidance(episode: LearningEpisode) {
    if (episode.sequence.length === 0 && episode.topTargets.length === 0) {
      return undefined;
    }

    const key = buildGuidanceKey(episode);
    const existing = guidances.find((guidance) =>
      buildGuidanceKeyFromGuidance(guidance) === key);

    const nextSupport = (existing?.support ?? 0) + 1;
    const previousSuccesses = existing
      ? Math.round(existing.successRate * existing.support)
      : 0;
    const nextSuccessCount = previousSuccesses + (episode.outcome === "success" ? 1 : 0);
    const nextSuccessRate = Number((nextSuccessCount / Math.max(1, nextSupport)).toFixed(3));
    const nextKeywords = collectKeywords([
      ...(existing?.keywords ?? []),
      ...episode.keywords,
      episode.intentKey,
      episode.intentLabel,
      episode.purposeKey,
      episode.purposeLabel,
      episode.goalSummary,
      episode.domain,
      episode.pageType,
      episode.pageTitle,
      episode.url,
    ]);
    const nextInputTargets = uniqueStrings([
      ...episode.inputTargets,
      ...(existing?.inputTargets ?? []),
    ], 6);
    const nextClickTargets = uniqueStrings([
      ...episode.clickTargets,
      ...(existing?.clickTargets ?? []),
    ], 6);
    const nextPreferredTargets = uniqueStrings([
      ...episode.inputTargets,
      ...episode.clickTargets,
      ...episode.topTargets,
      ...(existing?.preferredTargets ?? []),
    ], 6);
    const nextToolOrder = chooseBestSequence(
      existing?.toolOrder ?? [],
      compactToolSequence(episode.sequence),
      episode.outcome,
    );
    const nextSampleSequence = chooseBestSequence(
      existing?.sampleSequence ?? [],
      episode.sequence,
      episode.outcome,
    );
    const nextConfidence = Number(Math.min(
      0.94,
      Math.max(
        0.18,
        0.22
          + Math.min(nextSupport, 5) * 0.05
          + nextSuccessRate * 0.42
          - (1 - nextSuccessRate) * 0.18
          + (nextPreferredTargets.length > 0 ? 0.05 : 0)
          + (nextToolOrder.length > 0 ? 0.04 : 0)
          - (episode.outcome === "failure" ? 0.12 : 0)
          - (episode.outcome === "unknown" ? 0.05 : 0),
      ),
    ).toFixed(3));

    const nextGuidanceBase: LearningGuidance = {
      assetKind: "action_strategy",
      guidanceId: existing?.guidanceId ?? randomUUID(),
      workspaceId: episode.workspaceId,
      domain: episode.domain,
      ...(episode.scheme || existing?.scheme
        ? { scheme: episode.scheme ?? existing?.scheme }
        : {}),
      ...(episode.pageType || existing?.pageType
        ? { pageType: episode.pageType ?? existing?.pageType }
        : {}),
      intentKey: episode.intentKey,
      intentLabel: episode.intentLabel,
      purposeKey: episode.purposeKey,
      purposeLabel: episode.purposeLabel,
      workflowSignature: buildWorkflowSignature({
        purposeKey: episode.purposeKey,
        toolOrder: nextToolOrder,
        inputTargets: nextInputTargets,
        clickTargets: nextClickTargets,
        topTargets: nextPreferredTargets,
      }),
      goalSummary: episode.goalSummary,
      keywords: nextKeywords,
      inputTargets: nextInputTargets,
      clickTargets: nextClickTargets,
      preferredTargets: nextPreferredTargets,
      recommendedSteps: [],
      toolOrder: nextToolOrder,
      recoveryHints: [],
      cautionNotes: [],
      support: nextSupport,
      successRate: nextSuccessRate,
      confidence: nextConfidence,
      lastSeenAt: episode.endedAt,
      sampleSequence: nextSampleSequence,
    };
    nextGuidanceBase.recommendedSteps = buildRecommendedSteps(nextGuidanceBase);
    nextGuidanceBase.recoveryHints = buildRecoveryHints(nextGuidanceBase);
    nextGuidanceBase.cautionNotes = buildCautionNotes(nextGuidanceBase);

    if (!existing) {
      guidances.unshift(nextGuidanceBase);
      return nextGuidanceBase.guidanceId;
    }

    existing.scheme = nextGuidanceBase.scheme;
    existing.pageType = nextGuidanceBase.pageType;
    existing.intentLabel = nextGuidanceBase.intentLabel;
    existing.purposeKey = nextGuidanceBase.purposeKey;
    existing.purposeLabel = nextGuidanceBase.purposeLabel;
    existing.workflowSignature = nextGuidanceBase.workflowSignature;
    existing.goalSummary = nextGuidanceBase.goalSummary;
    existing.keywords = nextGuidanceBase.keywords;
    existing.inputTargets = nextGuidanceBase.inputTargets;
    existing.clickTargets = nextGuidanceBase.clickTargets;
    existing.preferredTargets = nextGuidanceBase.preferredTargets;
    existing.recommendedSteps = nextGuidanceBase.recommendedSteps;
    existing.toolOrder = nextGuidanceBase.toolOrder;
    existing.recoveryHints = nextGuidanceBase.recoveryHints;
    existing.cautionNotes = nextGuidanceBase.cautionNotes;
    existing.support = nextGuidanceBase.support;
    existing.successRate = nextGuidanceBase.successRate;
    existing.confidence = nextGuidanceBase.confidence;
    existing.lastSeenAt = nextGuidanceBase.lastSeenAt;
    existing.sampleSequence = nextGuidanceBase.sampleSequence;
    return existing.guidanceId;
  }

  function rebuildGuidancesFromEpisodes() {
    guidances = [];
    [...episodes]
      .reverse()
      .forEach((episode) => {
        persistGuidance(episode);
      });
  }

  function persistSiteSkill(input: {
    episode: LearningEpisode;
    guidanceId?: string;
    patternKey: LearningSiteSkillPatternKey;
    patternLabel: string;
    rule: string;
    evidence: string[];
  }) {
    const { episode } = input;
    const existing = siteSkills.find((skill) =>
      skill.workspaceId === episode.workspaceId
      && skill.domain === episode.domain
      && (skill.scheme ?? "unknown") === (episode.scheme ?? "unknown")
      && (skill.pageType ?? "unknown") === (episode.pageType ?? "unknown")
      && skill.patternKey === input.patternKey);

    const nextSupport = (existing?.support ?? 0) + 1;
    const previousSuccesses = existing
      ? Math.round(existing.successRate * existing.support)
      : 0;
    const nextSuccessCount = previousSuccesses + (episode.outcome === "success" ? 1 : 0);
    const nextSuccessRate = Number((nextSuccessCount / Math.max(1, nextSupport)).toFixed(3));
    const nextEvidence = uniqueStrings([
      ...input.evidence,
      ...(existing?.evidence ?? []),
    ], 6);
    const nextConfidence = Number(Math.min(
      0.98,
      0.42
        + Math.min(nextSupport, 5) * 0.08
        + nextSuccessRate * 0.24
        + (nextEvidence.length > 0 ? 0.08 : 0),
    ).toFixed(3));

    if (!existing) {
      siteSkills.unshift({
        assetKind: "site_skill",
        skillId: randomUUID(),
        workspaceId: episode.workspaceId,
        domain: episode.domain,
        ...(episode.scheme ? { scheme: episode.scheme } : {}),
        ...(episode.pageType ? { pageType: episode.pageType } : {}),
        patternKey: input.patternKey,
        patternLabel: input.patternLabel,
        rule: input.rule,
        evidence: nextEvidence,
        support: nextSupport,
        successRate: nextSuccessRate,
        confidence: nextConfidence,
        lastSeenAt: episode.endedAt,
        sourceGuidanceIds: input.guidanceId ? [input.guidanceId] : [],
      });
      return;
    }

    existing.patternLabel = input.patternLabel;
    existing.rule = input.rule;
    existing.evidence = nextEvidence;
    existing.support = nextSupport;
    existing.successRate = nextSuccessRate;
    existing.confidence = nextConfidence;
    existing.lastSeenAt = episode.endedAt;
    existing.sourceGuidanceIds = uniqueStrings([
      ...(input.guidanceId ? [input.guidanceId] : []),
      ...existing.sourceGuidanceIds,
    ], 16);
  }

  function appendEpisodeFeedback(episode: LearningEpisode, guidanceId?: string, recipeId?: string) {
    const relatedSkills = buildSiteSkillDescriptors(episode);
    const latestSkill = relatedSkills[0];
    const resolvedSkillId = latestSkill?.patternKey
      ? siteSkills.find((skill) =>
        skill.workspaceId === episode.workspaceId
        && skill.domain === episode.domain
        && (skill.pageType ?? "unknown") === (episode.pageType ?? "unknown")
        && skill.patternKey === latestSkill.patternKey)?.skillId
      : undefined;
    feedbackRecords.unshift({
      assetKind: "feedback_record",
      feedbackId: randomUUID(),
      workspaceId: episode.workspaceId,
      domain: episode.domain,
      ts: episode.endedAt,
      outcome: episode.outcome,
      source: recipeId ? "extraction_recipe" : "observer_episode",
      summary: buildEpisodeFeedbackSummary(episode),
      reasonCodes: buildEpisodeFeedbackReasonCodes(episode),
      verifierSignals: uniqueStrings([
        ...(episode.successSignals ?? []),
        ...(episode.failureSignals ?? []),
      ], 10),
      ...(episode.scheme ? { scheme: episode.scheme } : {}),
      ...(episode.pageType ? { pageType: episode.pageType } : {}),
      episodeId: episode.episodeId,
      ...(guidanceId ? { guidanceId } : {}),
      ...(recipeId ? { recipeId } : {}),
      ...(resolvedSkillId ? { skillId: resolvedSkillId } : {}),
    });
  }

  function persistDerivedAssetsForEpisode(episode: LearningEpisode, guidanceId?: string) {
    for (const descriptor of buildSiteSkillDescriptors(episode)) {
      persistSiteSkill({
        episode,
        guidanceId,
        ...descriptor,
      });
    }
    appendEpisodeFeedback(episode, guidanceId);
  }

  function feedbackOutcomeToEpisodeOutcome(outcome: LearningFeedbackOutcome): LearningEpisode["outcome"] {
    switch (outcome) {
      case "success":
        return "success";
      case "failure":
        return "failure";
      default:
        return "unknown";
    }
  }

  function outcomeSuccessContribution(outcome: LearningFeedbackOutcome) {
    switch (outcome) {
      case "success":
        return 1;
      case "partial":
        return 0.45;
      case "unknown":
        return 0.2;
      default:
        return 0;
    }
  }

  function applyEpisodeAnalysis(episode: LearningEpisode, analysis: LearningEpisodeAnalysis) {
    const normalizedIntent = normalizeStoredIntentFields(analysis.intentKey, analysis.intentLabel);
    const purpose = resolvePurposeFields(
      normalizedIntent.intentKey,
      analysis.purposeKey,
      analysis.purposeLabel,
    );
    const nextKeywords = sanitizeGuidanceTextList(analysis.keywords, 18, 48);
    const nextInputTargets = sanitizeGuidanceTextList(analysis.inputTargets, 6, 80);
    const nextClickTargets = sanitizeGuidanceTextList(analysis.clickTargets, 6, 80);
    const nextTopTargets = sanitizeGuidanceTextList(analysis.topTargets, 6, 80);
    const nextSuccessSignals = sanitizeGuidanceTextList(analysis.successSignals, 8, 64);
    const nextFailureSignals = sanitizeGuidanceTextList(analysis.failureSignals, 8, 64);
    const nextPageType = truncateText(analysis.pageType ?? episode.pageType ?? "", 80).trim() || undefined;

    episode.pageType = nextPageType;
    episode.intentKey = normalizedIntent.intentKey;
    episode.intentLabel = normalizedIntent.intentLabel;
    episode.purposeKey = purpose.purposeKey;
    episode.purposeLabel = purpose.purposeLabel;
    episode.goalSummary = buildStoredGoalSummary({
      domain: episode.domain,
      url: episode.url,
      pageTitle: episode.pageTitle,
      pageType: nextPageType,
      keywords: nextKeywords,
      inputTargets: nextInputTargets,
      clickTargets: nextClickTargets,
      sequence: episode.sequence,
      hasDownload: episode.sequence.includes("download.completed"),
      intentKey: normalizedIntent.intentKey,
      intentLabel: normalizedIntent.intentLabel,
      purposeKey: purpose.purposeKey,
      purposeLabel: purpose.purposeLabel,
      goalSummary: analysis.goalSummary,
    });
    episode.keywords = nextKeywords;
    episode.inputTargets = nextInputTargets;
    episode.clickTargets = nextClickTargets;
    episode.topTargets = nextTopTargets;
    episode.successSignals = nextSuccessSignals.length > 0 ? nextSuccessSignals : undefined;
    episode.failureSignals = nextFailureSignals.length > 0 ? nextFailureSignals : undefined;
    episode.outcome = analysis.outcome;
  }

  function upsertGuidanceFromLlm(input: {
    episode: LearningEpisode;
    guidance: LearningEpisodeGuidanceDraft;
    feedbackOutcome: LearningFeedbackOutcome;
  }) {
    const { episode } = input;
    const normalizedIntent = normalizeStoredIntentFields(
      input.guidance.intentKey,
      input.guidance.intentLabel,
    );
    const purpose = resolvePurposeFields(
      normalizedIntent.intentKey,
      input.guidance.purposeKey,
      input.guidance.purposeLabel,
    );
    const pageType = truncateText(input.guidance.pageType ?? episode.pageType ?? "", 80).trim() || undefined;
    const keywords = sanitizeGuidanceTextList(input.guidance.keywords, 18, 48);
    const inputTargets = sanitizeGuidanceTextList(
      input.guidance.inputTargets.length > 0 ? input.guidance.inputTargets : episode.inputTargets,
      6,
      80,
    );
    const clickTargets = sanitizeGuidanceTextList(
      input.guidance.clickTargets.length > 0 ? input.guidance.clickTargets : episode.clickTargets,
      6,
      80,
    );
    const preferredTargets = sanitizeGuidanceTextList(
      input.guidance.preferredTargets.length > 0 ? input.guidance.preferredTargets : episode.topTargets,
      6,
      80,
    );
    const recommendedSteps = sanitizeGuidanceTextList(input.guidance.recommendedSteps, 5, 180);
    const toolOrder = sanitizeToolOrder(input.guidance.toolOrder);
    const recoveryHints = sanitizeGuidanceTextList(input.guidance.recoveryHints, 3, 180);
    const cautionNotes = sanitizeGuidanceTextList(input.guidance.cautionNotes, 3, 180);

    if (
      preferredTargets.length === 0
      && recommendedSteps.length === 0
      && toolOrder.length === 0
      && recoveryHints.length === 0
    ) {
      return { created: false } as const;
    }

    const workflowSignature = buildWorkflowSignature({
      purposeKey: purpose.purposeKey,
      toolOrder,
      inputTargets,
      clickTargets,
      topTargets: preferredTargets,
    });
    const lookup: LearningGuidance = {
      assetKind: "action_strategy",
      guidanceId: "",
      workspaceId: episode.workspaceId,
      domain: episode.domain,
      ...(episode.scheme ? { scheme: episode.scheme } : {}),
      ...(pageType ? { pageType } : {}),
      intentKey: normalizedIntent.intentKey,
      intentLabel: normalizedIntent.intentLabel,
      purposeKey: purpose.purposeKey,
      purposeLabel: purpose.purposeLabel,
      workflowSignature,
      goalSummary: "",
      keywords: [],
      inputTargets,
      clickTargets,
      preferredTargets,
      recommendedSteps: [],
      toolOrder,
      recoveryHints: [],
      cautionNotes: [],
      support: 0,
      successRate: 0,
      confidence: 0,
      lastSeenAt: episode.endedAt,
      sampleSequence: [],
    };
    const key = buildGuidanceKeyFromGuidance(lookup);
    const existing = guidances.find((guidance) => buildGuidanceKeyFromGuidance(guidance) === key);
    const nextSupport = (existing?.support ?? 0) + 1;
    const previousSuccessWeight = (existing?.successRate ?? 0) * (existing?.support ?? 0);
    const nextSuccessWeight = previousSuccessWeight + outcomeSuccessContribution(input.feedbackOutcome);
    const nextSuccessRate = Number((nextSuccessWeight / Math.max(1, nextSupport)).toFixed(3));
    const llmConfidence = typeof input.guidance.confidence === "number"
      ? Math.max(0, Math.min(1, input.guidance.confidence))
      : undefined;
    const nextConfidence = Number(Math.max(
      0.12,
      Math.min(
        0.99,
        (
          ((existing?.confidence ?? llmConfidence ?? 0.58) * (nextSupport - 1))
          + (llmConfidence ?? existing?.confidence ?? 0.58)
          + nextSuccessRate * 0.2
        ) / Math.max(1, nextSupport),
      ),
    ).toFixed(3));
    const nextGuidance: LearningGuidance = {
      assetKind: "action_strategy",
      guidanceId: existing?.guidanceId ?? randomUUID(),
      workspaceId: episode.workspaceId,
      domain: episode.domain,
      ...(episode.scheme ? { scheme: episode.scheme } : {}),
      ...(pageType ? { pageType } : {}),
      intentKey: normalizedIntent.intentKey,
      intentLabel: normalizedIntent.intentLabel,
      purposeKey: purpose.purposeKey,
      purposeLabel: purpose.purposeLabel,
      workflowSignature,
      goalSummary: buildStoredGoalSummary({
        domain: episode.domain,
        url: episode.url,
        pageTitle: episode.pageTitle,
        pageType,
        keywords,
        inputTargets,
        clickTargets,
        sequence: episode.sequence,
        hasDownload: episode.sequence.includes("download.completed"),
        intentKey: normalizedIntent.intentKey,
        intentLabel: normalizedIntent.intentLabel,
        purposeKey: purpose.purposeKey,
        purposeLabel: purpose.purposeLabel,
        goalSummary: input.guidance.goalSummary,
      }),
      keywords,
      inputTargets,
      clickTargets,
      preferredTargets,
      recommendedSteps,
      toolOrder,
      recoveryHints,
      cautionNotes,
      support: nextSupport,
      successRate: nextSuccessRate,
      confidence: nextConfidence,
      lastSeenAt: episode.endedAt,
      sampleSequence: chooseBestSequence(existing?.sampleSequence ?? [], episode.sequence, episode.outcome),
    };

    if (!existing) {
      guidances.unshift(nextGuidance);
      return {
        created: true,
        guidanceId: nextGuidance.guidanceId,
      } as const;
    }

    existing.scheme = nextGuidance.scheme;
    existing.pageType = nextGuidance.pageType;
    existing.intentKey = nextGuidance.intentKey;
    existing.intentLabel = nextGuidance.intentLabel;
    existing.purposeKey = nextGuidance.purposeKey;
    existing.purposeLabel = nextGuidance.purposeLabel;
    existing.workflowSignature = nextGuidance.workflowSignature;
    existing.goalSummary = nextGuidance.goalSummary;
    existing.keywords = nextGuidance.keywords;
    existing.inputTargets = nextGuidance.inputTargets;
    existing.clickTargets = nextGuidance.clickTargets;
    existing.preferredTargets = nextGuidance.preferredTargets;
    existing.recommendedSteps = nextGuidance.recommendedSteps;
    existing.toolOrder = nextGuidance.toolOrder;
    existing.recoveryHints = nextGuidance.recoveryHints;
    existing.cautionNotes = nextGuidance.cautionNotes;
    existing.support = nextGuidance.support;
    existing.successRate = nextGuidance.successRate;
    existing.confidence = nextGuidance.confidence;
    existing.lastSeenAt = nextGuidance.lastSeenAt;
    existing.sampleSequence = nextGuidance.sampleSequence;
    return {
      created: false,
      guidanceId: existing.guidanceId,
    } as const;
  }

  function upsertSiteSkillFromLlm(input: {
    episode: LearningEpisode;
    guidanceId?: string;
    skill: LearningEpisodeSiteSkillDraft;
    feedbackOutcome: LearningFeedbackOutcome;
  }) {
    const pageType = truncateText(input.episode.pageType ?? "", 80).trim() || undefined;
    const rule = truncateText(input.skill.rule, 220).trim();
    if (!rule) {
      return;
    }
    const existing = siteSkills.find((skill) =>
      skill.workspaceId === input.episode.workspaceId
      && skill.domain === input.episode.domain
      && (skill.scheme ?? "unknown") === (input.episode.scheme ?? "unknown")
      && (skill.pageType ?? "unknown") === (pageType ?? "unknown")
      && skill.patternKey === input.skill.patternKey
      && skill.rule === rule);
    const nextSupport = (existing?.support ?? 0) + 1;
    const previousSuccessWeight = (existing?.successRate ?? 0) * (existing?.support ?? 0);
    const nextSuccessWeight = previousSuccessWeight + outcomeSuccessContribution(input.feedbackOutcome);
    const nextSuccessRate = Number((nextSuccessWeight / Math.max(1, nextSupport)).toFixed(3));
    const evidence = sanitizeGuidanceTextList(input.skill.evidence, 6, 160);
    const llmConfidence = typeof input.skill.confidence === "number"
      ? Math.max(0, Math.min(1, input.skill.confidence))
      : undefined;
    const nextConfidence = Number(Math.max(
      0.12,
      Math.min(
        0.99,
        (
          ((existing?.confidence ?? llmConfidence ?? 0.56) * (nextSupport - 1))
          + (llmConfidence ?? existing?.confidence ?? 0.56)
          + nextSuccessRate * 0.16
        ) / Math.max(1, nextSupport),
      ),
    ).toFixed(3));
    const patternLabel = truncateText(input.skill.patternLabel, 120).trim();
    if (!patternLabel) {
      return;
    }

    if (!existing) {
      siteSkills.unshift({
        assetKind: "site_skill",
        skillId: randomUUID(),
        workspaceId: input.episode.workspaceId,
        domain: input.episode.domain,
        ...(input.episode.scheme ? { scheme: input.episode.scheme } : {}),
        ...(pageType ? { pageType } : {}),
        patternKey: input.skill.patternKey,
        patternLabel,
        rule,
        evidence,
        support: nextSupport,
        successRate: nextSuccessRate,
        confidence: nextConfidence,
        lastSeenAt: input.episode.endedAt,
        sourceGuidanceIds: input.guidanceId ? [input.guidanceId] : [],
      });
      return;
    }

    existing.patternLabel = patternLabel;
    existing.rule = rule;
    existing.evidence = uniqueStrings([...evidence, ...existing.evidence], 6);
    existing.support = nextSupport;
    existing.successRate = nextSuccessRate;
    existing.confidence = nextConfidence;
    existing.lastSeenAt = input.episode.endedAt;
    existing.sourceGuidanceIds = uniqueStrings([
      ...(input.guidanceId ? [input.guidanceId] : []),
      ...existing.sourceGuidanceIds,
    ], 16);
  }

  function appendLlmEpisodeFeedback(input: {
    episode: LearningEpisode;
    feedback: LearningEpisodeFeedbackDraft;
    guidanceId?: string;
  }) {
    feedbackRecords = feedbackRecords.filter((record) =>
      !(record.episodeId === input.episode.episodeId && record.source === "llm_episode_learning"));
    feedbackRecords.unshift({
      assetKind: "feedback_record",
      feedbackId: randomUUID(),
      workspaceId: input.episode.workspaceId,
      domain: input.episode.domain,
      ts: input.episode.endedAt,
      outcome: input.feedback.outcome,
      source: "llm_episode_learning",
      summary: truncateText(input.feedback.summary, 220),
      reasonCodes: sanitizeGuidanceTextList(input.feedback.reasonCodes, 10, 64),
      verifierSignals: sanitizeGuidanceTextList(input.feedback.verifierSignals, 10, 80),
      ...(input.episode.scheme ? { scheme: input.episode.scheme } : {}),
      ...(input.episode.pageType ? { pageType: input.episode.pageType } : {}),
      episodeId: input.episode.episodeId,
      ...(input.guidanceId ? { guidanceId: input.guidanceId } : {}),
    });
  }

  function getPendingEpisodeLearningIds(input?: { limit?: number }) {
    const learnedIds = new Set(llmLearnedEpisodeIds);
    const activeEpisodeIds = new Set(episodes.map((episode) => episode.episodeId));
    const deferredIds = deferredEpisodeLearningIds.filter((episodeId) =>
      !learnedIds.has(episodeId)
      && activeEpisodeIds.has(episodeId));
    const pendingIds = episodes
      .filter((episode) => !learnedIds.has(episode.episodeId))
      .map((episode) => episode.episodeId);
    return uniqueStrings([...deferredIds, ...pendingIds], input?.limit);
  }

  function getEpisodeLearningContext(episodeId: string): LearningEpisodeLearningContext | null {
    const normalizedEpisodeId = episodeId.trim();
    if (!normalizedEpisodeId) {
      return null;
    }
    const episode = episodes.find((entry) => entry.episodeId === normalizedEpisodeId);
    if (!episode) {
      return null;
    }

    const sourceEventIds = new Set(episode.sourceEventIds ?? []);
    const events = sourceEventIds.size > 0
      ? rawEvents.filter((event) => sourceEventIds.has(event.id))
      : [];
    const snapshotIds = uniqueStrings(
      events.map((event) => event.pageSnapshotId),
      16,
    );
    const pageSnapshotsForEpisode = pageSnapshots.filter((snapshot) => snapshotIds.includes(snapshot.pageSnapshotId));

    return {
      episode: {
        ...episode,
        topTargets: [...episode.topTargets],
        inputTargets: [...episode.inputTargets],
        clickTargets: [...episode.clickTargets],
        sequence: [...episode.sequence],
        keywords: [...episode.keywords],
        ...(episode.sourceEventIds ? { sourceEventIds: [...episode.sourceEventIds] } : {}),
      },
      events: events.map((event) => ({ ...event })),
      pageSnapshots: pageSnapshotsForEpisode.map((snapshot) => ({
        ...snapshot,
        regions: snapshot.regions.map((region) => ({ ...region })),
        forms: snapshot.forms.map((form) => ({ ...form })),
        information: snapshot.information.map((block) => ({ ...block })),
        capabilities: snapshot.capabilities.map((capability) => ({ ...capability, actions: [...capability.actions] })),
        dataKeys: [...snapshot.dataKeys],
      })),
    };
  }

  function applyEpisodeLearningResult(input: LearningEpisodeLearningResult) {
    const normalizedEpisodeId = input.episodeId.trim();
    if (!normalizedEpisodeId) {
      return { success: false };
    }
    const episode = episodes.find((entry) => entry.episodeId === normalizedEpisodeId);
    if (!episode) {
      return { success: false };
    }

    applyEpisodeAnalysis(episode, input.analysis);
    episode.outcome = feedbackOutcomeToEpisodeOutcome(input.feedback.outcome);
    const guidanceResult = input.guidance
      ? upsertGuidanceFromLlm({
          episode,
          guidance: input.guidance,
          feedbackOutcome: input.feedback.outcome,
        })
      : { created: false } as const;

    for (const skill of input.siteSkills) {
      upsertSiteSkillFromLlm({
        episode,
        ...(guidanceResult.guidanceId ? { guidanceId: guidanceResult.guidanceId } : {}),
        skill,
        feedbackOutcome: input.feedback.outcome,
      });
    }

    appendLlmEpisodeFeedback({
      episode,
      feedback: input.feedback,
      ...(guidanceResult.guidanceId ? { guidanceId: guidanceResult.guidanceId } : {}),
    });

    llmLearnedEpisodeIds = uniqueStrings([normalizedEpisodeId, ...llmLearnedEpisodeIds]);
    deferredEpisodeLearningIds = deferredEpisodeLearningIds.filter((episodeId) => episodeId !== normalizedEpisodeId);
    scheduleSave();
    return {
      success: true,
      guidanceId: guidanceResult.guidanceId,
      createdGuidance: guidanceResult.created,
    };
  }

  function countFeedbackForGuidance(guidanceId: string) {
    return feedbackRecords.filter((record) => record.guidanceId === guidanceId).length;
  }

  function buildFeedbackStats(records: LearningFeedbackRecord[]) {
    let successCount = 0;
    let failureCount = 0;
    let partialCount = 0;
    let unknownCount = 0;
    for (const record of records) {
      switch (record.outcome) {
        case "success":
          successCount += 1;
          break;
        case "failure":
          failureCount += 1;
          break;
        case "partial":
          partialCount += 1;
          break;
        default:
          unknownCount += 1;
          break;
      }
    }
    const total = records.length;
    const quality = total > 0
      ? (successCount + partialCount * 0.45 + unknownCount * 0.2) / total
      : 0.5;
    const penalty = failureCount * 1.35 + partialCount * 0.55 + unknownCount * 0.25;
    return {
      total,
      successCount,
      failureCount,
      partialCount,
      unknownCount,
      quality: Number(quality.toFixed(3)),
      penalty: Number(penalty.toFixed(3)),
    };
  }

  function getGuidanceFeedbackStats(guidanceId: string) {
    return buildFeedbackStats(
      feedbackRecords.filter((record) => record.guidanceId === guidanceId),
    );
  }

  function getRecipeFeedbackStats(recipeId: string) {
    return buildFeedbackStats(
      feedbackRecords.filter((record) => record.recipeId === recipeId),
    );
  }

  function listRelatedSiteSkills(guidanceId: string) {
    return siteSkills.filter((skill) => skill.sourceGuidanceIds.includes(guidanceId));
  }

  function toSiteSkillSummary(skill: LearningSiteSkill): LearningSiteSkillSummary {
    return {
      skillId: skill.skillId,
      domain: skill.domain,
      ...(skill.pageType ? { pageType: skill.pageType } : {}),
      patternKey: skill.patternKey,
      patternLabel: skill.patternLabel,
      rule: skill.rule,
      evidence: [...skill.evidence],
      support: skill.support,
      successRate: skill.successRate,
      confidence: skill.confidence,
      lastSeenAt: skill.lastSeenAt,
    };
  }

  function toStyleProfileSummary(profile: LearningStyleProfile): LearningStyleProfileSummary {
    return {
      profileId: profile.profileId,
      ...(profile.domain ? { domain: profile.domain } : {}),
      ...(profile.scheme ? { scheme: profile.scheme } : {}),
      ...(profile.pageType ? { pageType: profile.pageType } : {}),
      ...(profile.contextType ? { contextType: profile.contextType } : {}),
      ...(profile.contextLabel ? { contextLabel: profile.contextLabel } : {}),
      ...(profile.slot ? { slot: profile.slot } : {}),
      ...(profile.slotLabel ? { slotLabel: profile.slotLabel } : {}),
      ...(profile.fieldHint ? { fieldHint: profile.fieldHint } : {}),
      ...(profile.recipientKey ? { recipientKey: profile.recipientKey } : {}),
      ...(profile.recipientLabel ? { recipientLabel: profile.recipientLabel } : {}),
      ...(profile.tone ? { tone: profile.tone } : {}),
      ...(profile.formality ? { formality: profile.formality } : {}),
      ...(profile.searchStyle ? { searchStyle: profile.searchStyle } : {}),
      ...(profile.emailStyle ? { emailStyle: profile.emailStyle } : {}),
      ...(profile.forumStyle ? { forumStyle: profile.forumStyle } : {}),
      ...(profile.articleStyle ? { articleStyle: profile.articleStyle } : {}),
      ...(profile.notesStyle ? { notesStyle: profile.notesStyle } : {}),
      ...(profile.styleSummary ? { styleSummary: profile.styleSummary } : {}),
      commonPhrases: [...profile.commonPhrases],
      exemplarSnippets: [...profile.exemplarSnippets],
      exemplarCount: profile.exemplarCount,
      averageLength: profile.averageLength,
      confidence: profile.confidence,
      lastUpdatedAt: profile.lastUpdatedAt,
    };
  }

  function toPreferenceProfileSummary(profile: LearningPreferenceProfile): LearningPreferenceProfileSummary {
    return {
      profileId: profile.profileId,
      signals: profile.signals.map((signal) => ({
        ...signal,
        ...(signal.evidenceRefs ? { evidenceRefs: [...signal.evidenceRefs] } : {}),
      })),
      lastUpdatedAt: profile.lastUpdatedAt,
    };
  }

  function toFeedbackRecordSummary(record: LearningFeedbackRecord): LearningFeedbackRecordSummary {
    return {
      feedbackId: record.feedbackId,
      ts: record.ts,
      outcome: record.outcome,
      source: record.source,
      summary: record.summary,
      reasonCodes: [...record.reasonCodes],
      verifierSignals: [...record.verifierSignals],
    };
  }

  function getScopedHistoryRecords(scope?: {
    workspaceId?: string;
    domain?: string;
  }) {
    const historyRecords = scope?.workspaceId
      ? (options.getHistoryRecordsForWorkspace?.(scope.workspaceId) ?? [])
      : (options.getAllHistoryRecords?.() ?? []);
    const blacklistDomains = getUserBlacklistDomains();

    return historyRecords.filter((record) => {
      const domain = inferDomain(record.url);
      if (domain === "unknown" || matchesBlacklistedDomain(domain, blacklistDomains)) {
        return false;
      }
      if (scope?.domain && domain !== scope.domain) {
        return false;
      }
      return true;
    });
  }

  function findHistoryProfile(scope: {
    workspaceId?: string;
    domain: string;
  }) {
    const primaryScopeKey = buildHistoryProfileScopeKey(scope.workspaceId);
    const primary = historyProfiles.find((profile) =>
      profile.scopeKey === primaryScopeKey
      && profile.domain === scope.domain);
    if (primary) {
      return primary;
    }
    if (primaryScopeKey !== HISTORY_PROFILE_GLOBAL_SCOPE) {
      return historyProfiles.find((profile) =>
        profile.scopeKey === HISTORY_PROFILE_GLOBAL_SCOPE
        && profile.domain === scope.domain) ?? null;
    }
    return null;
  }

  function isHistoryDomainDeleted(domain: string, lastVisitedAt: number) {
    const deleted = deletedHistoryDomains.find((entry) => entry.domain === domain);
    return Boolean(deleted && lastVisitedAt <= deleted.deletedAt);
  }

  function markHistoryDomainDeleted(domain: string, deletedAt = Date.now()) {
    deletedHistoryDomains = [
      {
        domain,
        deletedAt,
      },
      ...deletedHistoryDomains.filter((entry) => entry.domain !== domain),
    ];
  }

  function getStyleProfileDeletionCutoff(profileId: string) {
    return deletedStyleProfileGroups.find((entry) => entry.profileId === profileId)?.deletedAt;
  }

  function isStyleProfileGroupDeleted(profileId: string, latestTs: number) {
    const deletedAt = getStyleProfileDeletionCutoff(profileId);
    return typeof deletedAt === "number" && latestTs <= deletedAt;
  }

  function markStyleProfileGroupDeleted(profileId: string, deletedAt = Date.now()) {
    deletedStyleProfileGroups = [
      {
        profileId,
        deletedAt,
      },
      ...deletedStyleProfileGroups.filter((entry) => entry.profileId !== profileId),
    ];
  }

  function mergeHistorySummaryWithProfile(
    summary: LearningHistorySiteSummary,
    profile: LearningHistoryProfile | null,
  ): LearningHistorySiteSummary {
    if (!profile) {
      return {
        ...summary,
        commonIntents: [...summary.commonIntents],
        revisitDrivers: [...summary.revisitDrivers],
        topPages: summary.topPages.map((page) => ({ ...page })),
      };
    }

    return {
      ...summary,
      activityLevel: profile.activityLevel,
      revisitPattern: profile.revisitPattern,
      ...(profile.profileSummary ? { profileSummary: profile.profileSummary } : {}),
      commonIntents: [...profile.commonIntents],
      revisitDrivers: [...profile.revisitDrivers],
      ...(typeof profile.confidence === "number" ? { confidence: profile.confidence } : {}),
      topPages: summary.topPages.map((page) => ({ ...page })),
    };
  }

  function getHistorySiteSummaries(scope?: {
    workspaceId?: string;
    domain?: string;
  }) {
    return summarizeHistorySites(getScopedHistoryRecords(scope))
      .filter((summary) => !isHistoryDomainDeleted(summary.domain, summary.lastVisitedAt))
      .map((summary) => mergeHistorySummaryWithProfile(summary, findHistoryProfile({
        ...(scope?.workspaceId ? { workspaceId: scope.workspaceId } : {}),
        domain: summary.domain,
      })));
  }

  function parseHistoryProfileKey(profileKey: string) {
    const separatorIndex = profileKey.indexOf("|");
    if (separatorIndex <= 0) {
      return null;
    }
    const scopeKey = profileKey.slice(0, separatorIndex).trim();
    const domain = profileKey.slice(separatorIndex + 1).trim();
    if (!scopeKey || !domain) {
      return null;
    }
    return { scopeKey, domain };
  }

  function getPendingHistoryProfileKeys(input?: {
    workspaceId?: string;
    domain?: string;
    limit?: number;
  }) {
    pruneState();
    const scopeKey = buildHistoryProfileScopeKey(input?.workspaceId);
    const summaries = summarizeHistorySites(getScopedHistoryRecords({
      ...(input?.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input?.domain ? { domain: input.domain } : {}),
    }));
    const historyProfilesByKey = new Map(
      historyProfiles.map((profile) => [
        buildHistoryProfileKey({
          scopeKey: profile.scopeKey,
          domain: profile.domain,
        }),
        profile,
      ] as const),
    );

    const inferredKeys = summaries
      .filter((summary) => {
        if (isHistoryDomainDeleted(summary.domain, summary.lastVisitedAt)) {
          return false;
        }
        const existing = historyProfilesByKey.get(buildHistoryProfileKey({
          scopeKey,
          domain: summary.domain,
        }));
        const recordHash = buildHistoryProfileRecordHash(summary);
        return !existing || existing.recordHash !== recordHash;
      })
      .map((summary) => buildHistoryProfileKey({
        scopeKey,
        domain: summary.domain,
      }));
    const summariesByDomain = new Map(summaries.map((summary) => [summary.domain, summary] as const));
    const deferredKeys = deferredHistoryProfileKeys.filter((profileKey) => {
      const parsed = parseHistoryProfileKey(profileKey);
      if (!parsed) {
        return false;
      }
      if (parsed.scopeKey !== scopeKey) {
        return false;
      }
      if (input?.domain && parsed.domain !== input.domain) {
        return false;
      }
      const summary = summariesByDomain.get(parsed.domain);
      return Boolean(summary && !isHistoryDomainDeleted(summary.domain, summary.lastVisitedAt));
    });
    return uniqueStrings([...deferredKeys, ...inferredKeys], input?.limit);
  }

  function getHistoryProfileLearningContext(profileKey: string): LearningHistoryProfileContext | null {
    pruneState();
    const parsedKey = parseHistoryProfileKey(profileKey);
    if (!parsedKey) {
      return null;
    }
    const { scopeKey, domain } = parsedKey;

    const workspaceId = scopeKey === HISTORY_PROFILE_GLOBAL_SCOPE ? undefined : scopeKey;
    const summary = summarizeHistorySites(getScopedHistoryRecords({
      ...(workspaceId ? { workspaceId } : {}),
      domain,
    }))[0];
    if (!summary) {
      return null;
    }
    if (isHistoryDomainDeleted(summary.domain, summary.lastVisitedAt)) {
      return null;
    }

    const existingProfile = historyProfiles.find((profile) =>
      profile.scopeKey === scopeKey
      && profile.domain === domain) ?? null;

    return {
      profileId: buildHistoryProfileKey({ scopeKey, domain }),
      scopeKey,
      ...(workspaceId ? { workspaceId } : {}),
      summary,
      recordHash: buildHistoryProfileRecordHash(summary),
      ...(existingProfile ? {
        existingProfile: {
          ...existingProfile,
          commonIntents: [...existingProfile.commonIntents],
          revisitDrivers: [...existingProfile.revisitDrivers],
        },
      } : {}),
    };
  }

  function applyHistoryProfile(profile: LearningHistoryProfile) {
    const normalizedScopeKey = buildHistoryProfileScopeKey(profile.workspaceId ?? profile.scopeKey);
    const normalizedDomain = profile.domain.trim();
    if (!normalizedDomain) {
      return { success: false };
    }

    const normalizedProfile: LearningHistoryProfile = {
      assetKind: "history_profile",
      profileId: profile.profileId.trim() || buildHistoryProfileKey({
        scopeKey: normalizedScopeKey,
        domain: normalizedDomain,
      }),
      scopeKey: normalizedScopeKey,
      ...(profile.workspaceId ? { workspaceId: profile.workspaceId.trim() } : {}),
      domain: normalizedDomain,
      activityLevel: profile.activityLevel,
      revisitPattern: profile.revisitPattern,
      ...(profile.profileSummary ? { profileSummary: truncateText(profile.profileSummary, 220) } : {}),
      commonIntents: sanitizeGuidanceTextList(profile.commonIntents ?? [], 5, 80),
      revisitDrivers: sanitizeGuidanceTextList(profile.revisitDrivers ?? [], 5, 100),
      confidence: Math.max(0, Math.min(1, Number(profile.confidence))),
      recordHash: profile.recordHash.trim(),
      lastUpdatedAt: profile.lastUpdatedAt,
    };
    if (!normalizedProfile.recordHash) {
      return { success: false };
    }

    const existingIndex = historyProfiles.findIndex((entry) =>
      entry.profileId === normalizedProfile.profileId
      || (entry.scopeKey === normalizedProfile.scopeKey && entry.domain === normalizedProfile.domain));
    if (existingIndex >= 0) {
      historyProfiles[existingIndex] = normalizedProfile;
    } else {
      historyProfiles.unshift(normalizedProfile);
    }
    if (normalizedProfile.workspaceId && normalizedProfile.profileSummary) {
      upsertUserMemory({
        workspaceId: normalizedProfile.workspaceId,
        key: "recent_focus",
        value: [
          normalizedProfile.profileSummary,
          normalizedProfile.commonIntents.length > 0
            ? `Common intents: ${normalizedProfile.commonIntents.join(" | ")}`
            : undefined,
        ].filter((entry): entry is string => Boolean(entry)).join(" "),
        category: "recent_focus",
        source: "browsing_history",
        confidence: normalizedProfile.confidence,
        strength: normalizedProfile.activityLevel === "high" ? 0.9 : normalizedProfile.activityLevel === "medium" ? 0.7 : 0.5,
        evidenceRefs: [`history_profile:${normalizedProfile.domain}`],
        scope: "domain",
        domain: normalizedProfile.domain,
        lastSeenAt: normalizedProfile.lastUpdatedAt,
      });
    }
    const profileKey = buildHistoryProfileKey({
      scopeKey: normalizedProfile.scopeKey,
      domain: normalizedProfile.domain,
    });
    deferredHistoryProfileKeys = deferredHistoryProfileKeys.filter((entry) => entry !== profileKey);
    pruneState();
    scheduleSave();
    return { success: true };
  }

  function pruneState() {
    let changed = false;
    const preferences = options.getPreferences();
    const blacklistDomains = getUserBlacklistDomains();
    const retentionMs = Math.max(1, preferences.retentionDays) * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - retentionMs;

    function replaceArray<T>(current: T[], next: T[]) {
      if (current.length !== next.length) {
        changed = true;
        return next;
      }
      for (let index = 0; index < current.length; index += 1) {
        if (current[index] !== next[index]) {
          changed = true;
          return next;
        }
      }
      return current;
    }

    rawEvents = replaceArray(rawEvents, rawEvents.filter((event) =>
      event.ts >= cutoff
      && !isBlacklistedRecord(event, blacklistDomains)));
    pageSnapshots = replaceArray(pageSnapshots, pageSnapshots.filter((snapshot) =>
      snapshot.ts >= cutoff
      && !isBlacklistedRecord(snapshot, blacklistDomains)));
    episodes = replaceArray(episodes, episodes.filter((episode) =>
      episode.endedAt >= cutoff
      && !isBlacklistedRecord(episode, blacklistDomains)));
    deletedHistoryDomains = replaceArray(deletedHistoryDomains, deletedHistoryDomains.filter((entry) =>
      entry.deletedAt >= cutoff
      && !matchesBlacklistedDomain(entry.domain, blacklistDomains)));
    historyProfiles = replaceArray(historyProfiles, historyProfiles.filter((profile) =>
      profile.lastUpdatedAt >= cutoff
      && !matchesBlacklistedDomain(profile.domain, blacklistDomains)));
    guidances = replaceArray(guidances, guidances.filter((guidance) =>
      guidance.lastSeenAt >= cutoff
      && !isBlacklistedRecord(guidance, blacklistDomains)));
    siteSkills = replaceArray(siteSkills, siteSkills.filter((skill) =>
      skill.lastSeenAt >= cutoff
      && !isBlacklistedRecord(skill, blacklistDomains)));
    feedbackRecords = replaceArray(feedbackRecords, feedbackRecords.filter((record) =>
      record.ts >= cutoff
      && !isBlacklistedRecord(record, blacklistDomains)));
    writingSamples = replaceArray(writingSamples, writingSamples.filter((sample) =>
      sample.ts >= cutoff
      && !matchesBlacklistedDomain(sample.domain, blacklistDomains)));
    deletedStyleProfileGroups = replaceArray(deletedStyleProfileGroups, deletedStyleProfileGroups.filter((entry) =>
      entry.deletedAt >= cutoff));
    styleProfiles = replaceArray(styleProfiles, styleProfiles.filter((profile) =>
      profile.lastUpdatedAt >= cutoff
      && (!profile.domain || !matchesBlacklistedDomain(profile.domain, blacklistDomains))));
    preferenceProfiles = replaceArray(preferenceProfiles, preferenceProfiles.filter((profile) =>
      profile.lastUpdatedAt >= cutoff));
    extractionRecipes = replaceArray(extractionRecipes, extractionRecipes.filter((recipe) =>
      recipe.lastSeenAt >= cutoff
      && !isBlacklistedRecord(recipe, blacklistDomains)));

    const activeSnapshotIds = new Set(pageSnapshots.map((snapshot) => snapshot.pageSnapshotId));
    rawEvents = replaceArray(rawEvents, rawEvents.map((event) => {
      if (!event.pageSnapshotId || activeSnapshotIds.has(event.pageSnapshotId)) {
        return event;
      }
      const { pageSnapshotId: _pageSnapshotId, ...nextEvent } = event;
      return nextEvent;
    }));

    const activeEpisodeIds = new Set(episodes.map((episode) => episode.episodeId));
    llmLearnedEpisodeIds = replaceArray(llmLearnedEpisodeIds, llmLearnedEpisodeIds.filter((episodeId) =>
      activeEpisodeIds.has(episodeId)));
    deferredEpisodeLearningIds = replaceArray(
      deferredEpisodeLearningIds,
      deferredEpisodeLearningIds.filter((episodeId) =>
        activeEpisodeIds.has(episodeId) && !llmLearnedEpisodeIds.includes(episodeId)),
    );
    deferredHistoryProfileKeys = replaceArray(deferredHistoryProfileKeys, deferredHistoryProfileKeys.filter((profileKey) => {
      const parsed = parseHistoryProfileKey(profileKey);
      if (!parsed) {
        return false;
      }
      return getScopedHistoryRecords({
        ...(parsed.scopeKey !== HISTORY_PROFILE_GLOBAL_SCOPE ? { workspaceId: parsed.scopeKey } : {}),
        domain: parsed.domain,
      }).length > 0;
    }));
    deferredStyleProfileIds = replaceArray(deferredStyleProfileIds, deferredStyleProfileIds.filter((profileId) =>
      writingSamples.some((sample) =>
        buildStyleProfileGroupKey({
          workspaceId: sample.workspaceId,
          domain: sample.domain,
          contextType: sample.contextType,
          slot: sample.slot,
          recipientKey: sample.recipientKey,
        }) === profileId)));
    const activeRawEventIds = new Set(rawEvents.map((event) => event.id));
    learnedEventIds = replaceArray(learnedEventIds, learnedEventIds.filter((eventId) => activeRawEventIds.has(eventId)));
    return changed;
  }

  function appendObservedEpisodes(nextEpisodes: LearningEpisode[]) {
    if (nextEpisodes.length === 0) {
      return [];
    }

    const orderedEpisodes = [...nextEpisodes].sort((left, right) =>
      left.endedAt - right.endedAt
      || left.startedAt - right.startedAt);

    episodes = [...orderedEpisodes, ...episodes]
      .sort((left, right) => right.endedAt - left.endedAt || right.startedAt - left.startedAt);

    return orderedEpisodes.map((episode) => episode.episodeId);
  }

  function processDeferredLearning(input?: {
    now?: number;
    scheduleSave?: boolean;
    includeCurrentDay?: boolean;
    maxEventCount?: number;
  }) {
    pruneState();

    const now = input?.now ?? Date.now();
    const shouldScheduleSave = input?.scheduleSave ?? true;
    const includeCurrentDay = input?.includeCurrentDay ?? false;
    const maxEventCount = typeof input?.maxEventCount === "number" && Number.isFinite(input.maxEventCount)
      ? Math.max(0, Math.floor(input.maxEventCount))
      : undefined;
    const cutoff = includeCurrentDay ? now + 1 : startOfLocalDay(now);
    const learnedIds = new Set(learnedEventIds);
    const allPendingEvents = rawEvents.filter((event) =>
      event.ts < cutoff && !learnedIds.has(event.id));
    const pendingEvents = maxEventCount === undefined || maxEventCount === 0
      ? allPendingEvents
      : allPendingEvents.slice(0, maxEventCount);

    if (pendingEvents.length === 0) {
      return {
        changed: false,
        episodeIds: [] as string[],
        learnedEventCount: 0,
        learnedEpisodeCount: 0,
        hasMore: false,
      };
    }

    const eventsByDay = new Map<string, LearningRawEvent[]>();
    for (const event of pendingEvents) {
      const dayKey = toLocalDayKey(event.ts);
      const bucket = eventsByDay.get(dayKey);
      if (bucket) {
        bucket.push(event);
      } else {
        eventsByDay.set(dayKey, [event]);
      }
    }

    const nextEpisodes: LearningEpisode[] = [];
    const nextLearnedEventIds: string[] = [];
    for (const dayKey of Array.from(eventsByDay.keys()).sort()) {
      const dayEvents = eventsByDay.get(dayKey) ?? [];
      if (dayEvents.length === 0) {
        continue;
      }
      nextEpisodes.push(...dedupeEpisodesForLearning(buildEpisodesFromEvents(dayEvents)));
      nextLearnedEventIds.push(...dayEvents.map((event) => event.id));
    }

    const episodeIds = appendObservedEpisodes(nextEpisodes);
    if (nextLearnedEventIds.length > 0) {
      learnedEventIds = Array.from(new Set([...learnedEventIds, ...nextLearnedEventIds]));
    }
    pruneState();

    const changed = nextLearnedEventIds.length > 0 || nextEpisodes.length > 0;
    if (changed && shouldScheduleSave) {
      scheduleSave();
    }

    return {
      changed,
      episodeIds,
      learnedEventCount: nextLearnedEventIds.length,
      learnedEpisodeCount: nextEpisodes.length,
      hasMore: pendingEvents.length < allPendingEvents.length,
    };
  }

  function flushOpenEpisodes(input?: { maxEventCount?: number }) {
    return processDeferredLearning({
      ...(typeof input?.maxEventCount === "number" ? { maxEventCount: input.maxEventCount } : {}),
    });
  }

  function getActiveProgress() {
    const blacklistDomains = getUserBlacklistDomains();
    const learnedIds = new Set(learnedEventIds);
    const activeCutoff = startOfLocalDay(Date.now());
    return groupEventsIntoEpisodeAccumulators(
      rawEvents.filter((event) =>
        event.ts >= activeCutoff
        && !learnedIds.has(event.id)
        && !isBlacklistedRecord(event, blacklistDomains)),
    )
      .map((accumulator) => buildActiveProgressFromAccumulator(accumulator))
      .filter((entry): entry is LearningProgressItem => entry !== null)
      .sort((left, right) =>
        right.updatedAt - left.updatedAt
        || right.eventCount - left.eventCount
        || left.domain.localeCompare(right.domain));
  }

  function ingestEvents(input: { workspaceId: string; events: LearningRawEvent[] }) {
    if (!input.events.length) {
      return;
    }
    const blacklistDomains = getUserBlacklistDomains();
    const nextEvents = input.events.filter((event) => !isBlacklistedRecord(event, blacklistDomains));
    if (!nextEvents.length) {
      return;
    }

    for (const event of nextEvents) {
      rawEvents.unshift(event);
    }

    scheduleSave();
  }

  function recordPageSnapshot(input: LearningPageSnapshotInput) {
    const url = readString(input.url);
    const domain = inferDomain(url);
    if (domain === "unknown") {
      return { success: false };
    }

    const scheme = inferScheme(url);
    if (isBlacklistedRecord({ domain, ...(url ? { url } : {}), ...(scheme ? { scheme } : {}) }, getUserBlacklistDomains())) {
      return { success: false };
    }
    const tabId = readString(input.tabId);
    const title = readString(input.title);
    const semanticSnapshotId = readString(input.semanticSnapshotId);
    const bodyText = truncateText(readString(input.bodyText) ?? "", 4_000).trim() || undefined;
    const domHash = readString(input.domHash) ?? hashText("");
    const domLength = input.domLength !== undefined
      ? Math.max(0, Math.floor(input.domLength))
      : undefined;
    const domTruncated = input.domTruncated;
    const redacted = input.redacted ?? false;
    const regions = (input.regions ?? [])
      .map((entry) => normalizePageSnapshotRegion(entry))
      .filter((entry): entry is LearningPageSnapshotRegion => entry !== null);
    const forms = (input.forms ?? [])
      .map((entry) => normalizePageSnapshotForm(entry))
      .filter((entry): entry is LearningPageSnapshotForm => entry !== null);
    const information = (input.information ?? [])
      .map((entry) => normalizePageSnapshotInformationBlock(entry))
      .filter((entry): entry is LearningPageSnapshotInformationBlock => entry !== null);
    const capabilities = (input.capabilities ?? [])
      .map((entry) => normalizePageSnapshotCapability(entry))
      .filter((entry): entry is LearningPageSnapshotCapability => entry !== null);
    const dataKeys = sanitizeGuidanceTextList([
      ...(input.dataKeys ?? []),
      ...information.flatMap((block) => [block.title, block.summary, block.type]),
      ...capabilities.flatMap((capability) => [capability.title, capability.label, capability.type]),
      ...regions.flatMap((region) => [region.name, region.role]),
      ...forms.flatMap((form) => [form.name, form.description]),
    ], 20, 64);
    const snapshotHash = buildPageSnapshotHash({
      workspaceId: input.workspaceId,
      domain,
      ...(tabId ? { tabId } : {}),
      ...(url ? { url } : {}),
      ...(title ? { title } : {}),
      ...(semanticSnapshotId ? { semanticSnapshotId } : {}),
      domHash,
      redacted,
      regions,
      forms,
      information,
      capabilities,
      dataKeys,
    });
    const ts = input.ts ?? Date.now();
    const existing = pageSnapshots.find((snapshot) =>
      snapshot.workspaceId === input.workspaceId
      && snapshot.snapshotHash === snapshotHash);

    if (existing) {
      existing.ts = ts;
      if (title) {
        existing.title = title;
      }
      if (bodyText) {
        existing.bodyText = bodyText;
      }
      if (domLength !== undefined) {
        existing.domLength = domLength;
      }
      if (domTruncated !== undefined) {
        existing.domTruncated = domTruncated;
      }
      existing.redacted = redacted;
      scheduleSave();
      return {
        success: true,
        pageSnapshotId: existing.pageSnapshotId,
      };
    }

    const record: LearningPageSnapshot = {
      pageSnapshotId: randomUUID(),
      workspaceId: input.workspaceId,
      domain,
      ts,
      snapshotHash,
      domHash,
      redacted,
      ...(scheme ? { scheme } : {}),
      ...(tabId ? { tabId } : {}),
      ...(url ? { url } : {}),
      ...(title ? { title } : {}),
      ...(semanticSnapshotId ? { semanticSnapshotId } : {}),
      ...(bodyText ? { bodyText } : {}),
      ...(domLength !== undefined ? { domLength } : {}),
      ...(domTruncated !== undefined ? { domTruncated } : {}),
      regions,
      forms,
      information,
      capabilities,
      dataKeys,
    };
    pageSnapshots.unshift(record);
    scheduleSave();
    return {
      success: true,
      pageSnapshotId: record.pageSnapshotId,
    };
  }

  function recordWritingSamples(input: {
    samples: LearningWritingSample[];
  }) {
    if (!input.samples.length) {
      return {
        success: false,
        sampleCount: 0,
        groupKeys: [] as string[],
      };
    }

    const blacklistDomains = getUserBlacklistDomains();
    const existingSampleIds = new Set(writingSamples.map((sample) => sample.sampleId));
    const nextSamples: LearningWritingSample[] = [];
    const groupKeys = new Set<string>();

    for (const rawSample of input.samples) {
      if (
        rawSample.domain === "unknown"
        || matchesBlacklistedDomain(rawSample.domain, blacklistDomains)
        || !isWritingContextSupported(rawSample.contextType, rawSample.slot)
      ) {
        continue;
      }

      const text = normalizeWritingText(rawSample.text);
      if (!text || /^\[redacted\]$/i.test(text)) {
        continue;
      }

      const recipientKey = normalizeWritingRecipientKey(rawSample.recipientKey ?? rawSample.recipientLabel);
      const sampleId = rawSample.sampleId.trim() || buildWritingSampleHash({
        workspaceId: rawSample.workspaceId,
        domain: rawSample.domain,
        contextType: rawSample.contextType,
        slot: rawSample.slot,
        ...(recipientKey ? { recipientKey } : {}),
        text,
      });
      if (existingSampleIds.has(sampleId)) {
        continue;
      }

      const normalized: LearningWritingSample = {
        sampleId,
        workspaceId: rawSample.workspaceId,
        domain: rawSample.domain,
        ts: rawSample.ts,
        text,
        charCount: Math.max(0, rawSample.charCount || text.length),
        wordCount: Math.max(0, rawSample.wordCount || countWritingWords(text)),
        contextType: rawSample.contextType,
        slot: rawSample.slot,
        ...(rawSample.scheme ? { scheme: rawSample.scheme } : {}),
        ...(rawSample.pageType ? { pageType: rawSample.pageType } : {}),
        ...(rawSample.url ? { url: rawSample.url } : {}),
        ...(rawSample.pageTitle ? { pageTitle: rawSample.pageTitle } : {}),
        ...(normalizeWritingHint(rawSample.fieldHint) ? { fieldHint: normalizeWritingHint(rawSample.fieldHint) } : {}),
        ...(recipientKey ? { recipientKey } : {}),
        ...(normalizeWritingRecipient(rawSample.recipientLabel) ? { recipientLabel: normalizeWritingRecipient(rawSample.recipientLabel) } : {}),
      };
      existingSampleIds.add(sampleId);
      nextSamples.push(normalized);
      groupKeys.add(buildStyleProfileGroupKey({
        workspaceId: normalized.workspaceId,
        domain: normalized.domain,
        contextType: normalized.contextType,
        slot: normalized.slot,
        recipientKey: normalized.recipientKey,
      }));
    }

    if (nextSamples.length === 0) {
      return {
        success: false,
        sampleCount: 0,
        groupKeys: [] as string[],
      };
    }

    writingSamples = [...nextSamples, ...writingSamples]
      .sort((left, right) => right.ts - left.ts || left.sampleId.localeCompare(right.sampleId));
    pruneState();
    scheduleSave();
    return {
      success: true,
      sampleCount: nextSamples.length,
      groupKeys: Array.from(groupKeys),
    };
  }

  function getStyleProfileRefinementContext(groupKey: string) {
    const normalizedGroupKey = groupKey.trim();
    if (!normalizedGroupKey) {
      return null;
    }

    const samples = writingSamples
      .filter((sample) =>
        buildStyleProfileGroupKey({
          workspaceId: sample.workspaceId,
          domain: sample.domain,
          contextType: sample.contextType,
          slot: sample.slot,
          recipientKey: sample.recipientKey,
        }) === normalizedGroupKey)
      .sort((left, right) => right.ts - left.ts);
    if (samples.length === 0) {
      return null;
    }
    if (isStyleProfileGroupDeleted(normalizedGroupKey, samples[0]!.ts)) {
      return null;
    }

    const latest = samples[0]!;
    const existingProfile = styleProfiles.find((profile) =>
      profile.profileId === normalizedGroupKey
      || buildStyleProfileGroupKeyFromProfile(profile) === normalizedGroupKey);

    return {
      profileId: normalizedGroupKey,
      workspaceId: latest.workspaceId,
      domain: latest.domain,
      ...(latest.scheme ? { scheme: latest.scheme } : {}),
      ...(latest.pageType ? { pageType: latest.pageType } : {}),
      contextType: latest.contextType,
      contextLabel: describeWritingContextType(latest.contextType),
      slot: latest.slot,
      slotLabel: describeWritingSlot(latest.slot),
      ...(pickMostFrequentValue(samples.map((sample) => sample.fieldHint)) ? { fieldHint: pickMostFrequentValue(samples.map((sample) => sample.fieldHint)) } : {}),
      ...(latest.recipientKey ? { recipientKey: latest.recipientKey } : {}),
      ...(latest.recipientLabel ? { recipientLabel: latest.recipientLabel } : {}),
      averageLength: Math.max(
        0,
        Math.round(samples.reduce((total, sample) => total + sample.charCount, 0) / samples.length),
      ),
      samples: samples.map((sample) => ({
        ...sample,
      })),
      existingProfile: existingProfile
        ? {
            ...existingProfile,
            commonPhrases: [...existingProfile.commonPhrases],
            exemplarSnippets: [...existingProfile.exemplarSnippets],
          }
        : null,
    };
  }

  function applyStyleProfile(profile: LearningStyleProfile) {
    const normalizedProfile: LearningStyleProfile = {
      assetKind: "style_profile",
      profileId: profile.profileId.trim() || buildStyleProfileGroupKeyFromProfile(profile),
      workspaceId: profile.workspaceId,
      ...(profile.domain ? { domain: profile.domain } : {}),
      ...(profile.scheme ? { scheme: profile.scheme } : {}),
      ...(profile.pageType ? { pageType: profile.pageType } : {}),
      ...(profile.contextType ? { contextType: profile.contextType } : {}),
      ...(profile.contextLabel ? { contextLabel: truncateText(profile.contextLabel, 80) } : {}),
      ...(profile.slot ? { slot: profile.slot } : {}),
      ...(profile.slotLabel ? { slotLabel: truncateText(profile.slotLabel, 80) } : {}),
      ...(normalizeWritingHint(profile.fieldHint) ? { fieldHint: normalizeWritingHint(profile.fieldHint) } : {}),
      ...(normalizeWritingRecipientKey(profile.recipientKey ?? profile.recipientLabel)
        ? { recipientKey: normalizeWritingRecipientKey(profile.recipientKey ?? profile.recipientLabel) }
        : {}),
      ...(normalizeWritingRecipient(profile.recipientLabel) ? { recipientLabel: normalizeWritingRecipient(profile.recipientLabel) } : {}),
      ...(profile.tone ? { tone: truncateText(profile.tone, 80) } : {}),
      ...(profile.formality ? { formality: truncateText(profile.formality, 80) } : {}),
      ...(profile.searchStyle ? { searchStyle: truncateText(profile.searchStyle, 220) } : {}),
      ...(profile.emailStyle ? { emailStyle: truncateText(profile.emailStyle, 220) } : {}),
      ...(profile.forumStyle ? { forumStyle: truncateText(profile.forumStyle, 220) } : {}),
      ...(profile.articleStyle ? { articleStyle: truncateText(profile.articleStyle, 220) } : {}),
      ...(profile.notesStyle ? { notesStyle: truncateText(profile.notesStyle, 220) } : {}),
      ...(profile.styleSummary ? { styleSummary: truncateText(profile.styleSummary, 220) } : {}),
      commonPhrases: sanitizeGuidanceTextList(profile.commonPhrases ?? [], MAX_STYLE_COMMON_PHRASES, 48),
      exemplarSnippets: sanitizeGuidanceTextList(profile.exemplarSnippets ?? [], MAX_STYLE_EXEMPLAR_SNIPPETS, 140),
      exemplarCount: Math.max(0, Math.floor(profile.exemplarCount)),
      averageLength: Math.max(0, Math.floor(profile.averageLength)),
      confidence: Math.max(0, Math.min(1, Number(profile.confidence))),
      lastUpdatedAt: profile.lastUpdatedAt,
    };

    const profileGroupKey = buildStyleProfileGroupKeyFromProfile(normalizedProfile);
    const existingIndex = styleProfiles.findIndex((entry) =>
      entry.profileId === normalizedProfile.profileId
      || buildStyleProfileGroupKeyFromProfile(entry) === profileGroupKey);
    if (existingIndex >= 0) {
      styleProfiles[existingIndex] = normalizedProfile;
    } else {
      styleProfiles.unshift(normalizedProfile);
    }
    deferredStyleProfileIds = deferredStyleProfileIds.filter((profileId) => profileId !== profileGroupKey);
    pruneState();
    scheduleSave();
    return { success: true };
  }

  function resolveInputAssistContext(input: LearningInputAssistContextInput): LearningInputAssistContext {
    const contextType = normalizeWritingContextType(input.contextType);
    const slot = normalizeWritingSlot(input.slot);
    const supported = isWritingContextSupported(contextType, slot);
    const domain = inferDomain(input.url);
    if (!supported || !contextType || !slot) {
      return {
        showMenu: false,
        supported: false,
        recentExamples: [],
        ...(domain !== "unknown" ? { domain } : {}),
      };
    }

    const recipientKey = normalizeWritingRecipientKey(input.recipient);
    const candidates = styleProfiles
      .filter((profile) =>
        profile.workspaceId === input.workspaceId
        && profile.contextType === contextType
        && profile.slot === slot)
      .map((profile) => {
        let score =
          Math.min(profile.exemplarCount, 6)
          + profile.confidence * 4;
        const reasons: string[] = [];
        if (profile.domain && domain !== "unknown" && profile.domain === domain) {
          score += 12;
          reasons.push(`domain:${domain}`);
        }
        if (profile.contextType === contextType) {
          score += 8;
          reasons.push(`context:${contextType}`);
        }
        if (profile.slot === slot) {
          score += 5;
          reasons.push(`slot:${slot}`);
        }
        if (contextType === "email" && recipientKey) {
          if (profile.recipientKey === recipientKey) {
            score += 16;
            reasons.push("recipient:exact");
          } else if (!profile.recipientKey) {
            score += 2;
            reasons.push("recipient:fallback");
          }
        }
        const fieldOverlap = calculateFieldKeywordOverlap(
          [profile.fieldHint],
          [input.fieldHint, input.placeholder, input.targetHint, input.targetLabel, input.targetName],
        );
        if (fieldOverlap > 0) {
          score += Math.min(fieldOverlap * 2, 6);
          reasons.push(`field:${fieldOverlap}`);
        }
        return {
          profile,
          score,
          reasons,
        };
      })
      .sort((left, right) =>
        right.score - left.score
        || right.profile.lastUpdatedAt - left.profile.lastUpdatedAt
        || right.profile.confidence - left.profile.confidence);

    const matchedProfile = candidates[0]?.profile;
    return {
      showMenu: true,
      supported: true,
      ...(domain !== "unknown" ? { domain } : {}),
      contextType,
      ...(describeWritingContextType(contextType) ? { contextLabel: describeWritingContextType(contextType) } : {}),
      slot,
      ...(describeWritingSlot(slot) ? { slotLabel: describeWritingSlot(slot) } : {}),
      ...(matchedProfile?.recipientLabel
        ? { recipientLabel: matchedProfile.recipientLabel }
        : (normalizeWritingRecipient(input.recipient) ? { recipientLabel: normalizeWritingRecipient(input.recipient) } : {})),
      ...(candidates[0]?.reasons.length ? { matchReason: candidates[0].reasons.join(", ") } : {}),
      ...(matchedProfile ? { styleProfile: toStyleProfileSummary(matchedProfile) } : {}),
      recentExamples: matchedProfile?.exemplarSnippets ? [...matchedProfile.exemplarSnippets] : [],
    };
  }

  function getPendingStyleProfileGroupKeys(input?: {
    workspaceIds?: string[];
    limit?: number;
  }) {
    pruneState();
    const workspaceIds = new Set(
      (input?.workspaceIds ?? [])
        .map((workspaceId) => workspaceId.trim())
        .filter((workspaceId) => workspaceId.length > 0),
    );
    const groups = new Map<string, number>();
    for (const sample of writingSamples) {
      if (workspaceIds.size > 0 && !workspaceIds.has(sample.workspaceId)) {
        continue;
      }
      const profileId = buildStyleProfileGroupKey({
        workspaceId: sample.workspaceId,
        domain: sample.domain,
        contextType: sample.contextType,
        slot: sample.slot,
        recipientKey: sample.recipientKey,
      });
      const existingTs = groups.get(profileId) ?? 0;
      groups.set(profileId, Math.max(existingTs, sample.ts));
    }
    const styleProfilesByGroupKey = new Map(
      styleProfiles.map((profile) => [
        buildStyleProfileGroupKeyFromProfile(profile),
        profile,
      ] as const),
    );
    const styleProfilesByProfileId = new Map(
      styleProfiles.map((profile) => [profile.profileId, profile] as const),
    );
    const inferredKeys = Array.from(groups.entries())
      .filter(([profileId, latestTs]) => {
        if (isStyleProfileGroupDeleted(profileId, latestTs)) {
          return false;
        }
        const existingProfile = styleProfilesByGroupKey.get(profileId)
          ?? styleProfilesByProfileId.get(profileId);
        return !existingProfile || existingProfile.lastUpdatedAt < latestTs;
      })
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([profileId]) => profileId);
    const deferredKeys = deferredStyleProfileIds.filter((profileId) => {
      const latestTs = groups.get(profileId);
      return typeof latestTs === "number" && !isStyleProfileGroupDeleted(profileId, latestTs);
    });
    return uniqueStrings([...deferredKeys, ...inferredKeys], input?.limit);
  }

  function getAllStyleProfileGroupKeys() {
    return getPendingStyleProfileGroupKeys();
  }

  function buildPromptContext(input: LearningPromptContextInput) {
    pruneState();
    flushOpenEpisodes({ maxEventCount: DEFERRED_LEARNING_EVENT_BATCH_SIZE });

    const now = Date.now();
    const activeDomain = inferDomain(input.activeUrl);
    const activePageType = inferPageType(input.activeUrl);
    const blacklistDomains = getUserBlacklistDomains();
    const taskKeywords = collectKeywords([input.task, input.activeUrl]);
    const taskIntent = inferIntent({
      domain: activeDomain,
      url: input.activeUrl,
      pageType: activePageType,
      pageTitle: undefined,
      keywords: taskKeywords,
      inputTargets: [],
      clickTargets: [],
      sequence: [],
      hasDownload: (input.task ?? "").toLowerCase().includes("download")
        || (input.task ?? "").includes("下载")
        || (input.task ?? "").includes("导出"),
    });
    const taskPurpose = inferPurpose({
      domain: activeDomain,
      url: input.activeUrl,
      pageType: activePageType,
      pageTitle: undefined,
      keywords: taskKeywords,
      inputTargets: [],
      clickTargets: [],
      sequence: [],
      hasDownload: (input.task ?? "").toLowerCase().includes("download")
        || (input.task ?? "").includes("下载")
        || (input.task ?? "").includes("导出"),
    }, taskIntent);

    const relatedGuidances = guidances
      .filter((guidance) =>
        guidance.workspaceId === input.workspaceId
        && !isBlacklistedRecord(guidance, blacklistDomains))
      .map((guidance) => {
        const feedbackStats = getGuidanceFeedbackStats(guidance.guidanceId);
        const keywordOverlap = guidance.keywords.filter((keyword) =>
          taskKeywords.some((taskKeyword) => taskKeyword.includes(keyword) || keyword.includes(taskKeyword))).length;
        return {
          guidance,
          score:
            (guidance.domain === activeDomain ? 6 : 0)
            + (guidance.pageType && guidance.pageType === activePageType ? 2 : 0)
            + (guidance.intentKey === taskIntent.key ? 6 : 0)
            + (guidance.purposeKey === taskPurpose.key ? 3 : 0)
            + Math.min(guidance.support, 4)
            + guidance.successRate * 2.5
            + guidance.confidence * 1.5
            + feedbackStats.quality * 3
            - feedbackStats.penalty
            + Math.min(keywordOverlap, 4),
        };
      })
      .sort((left, right) =>
        right.score - left.score
        || right.guidance.lastSeenAt - left.guidance.lastSeenAt
        || right.guidance.support - left.guidance.support
        || right.guidance.confidence - left.guidance.confidence)
      .map(({ guidance }) => guidance);

    const recentEpisodes = episodes
      .filter((episode) =>
        episode.workspaceId === input.workspaceId
        && !isBlacklistedRecord(episode, blacklistDomains)
        && (activeDomain === "unknown" || episode.domain === activeDomain));
    const relatedSiteSkills = siteSkills
      .filter((skill) =>
        skill.workspaceId === input.workspaceId
        && !isBlacklistedRecord(skill, blacklistDomains)
        && (activeDomain === "unknown" || skill.domain === activeDomain))
      .map((skill) => {
        const corpus = buildSiteSkillSearchCorpus(skill);
        const keywordOverlap = taskKeywords.filter((keyword) => corpus.includes(keyword)).length;
        return {
          skill,
          score:
            (skill.domain === activeDomain ? 6 : 0)
            + (skill.pageType && skill.pageType === activePageType ? 2 : 0)
            + Math.min(skill.support, 5)
            + skill.successRate * 3
            + Math.min(keywordOverlap, 4),
        };
      })
      .sort((left, right) =>
        right.score - left.score
        || right.skill.lastSeenAt - left.skill.lastSeenAt
        || right.skill.support - left.skill.support)
      .map(({ skill }) => skill);
    const styleProfile = styleProfiles
      .filter((profile) =>
        profile.workspaceId === input.workspaceId
        && (activeDomain === "unknown" || !profile.domain || profile.domain === activeDomain))
      .sort((left, right) =>
        Number(right.domain === activeDomain) - Number(left.domain === activeDomain)
        || right.lastUpdatedAt - left.lastUpdatedAt
        || right.confidence - left.confidence)[0];
    const preferenceProfile = preferenceProfiles
      .filter((profile) =>
        profile.workspaceId === input.workspaceId
        && profile.signals.some((signal) => isPromptEligiblePreferenceSignal(signal, now)))
      .sort((left, right) =>
        right.signals.filter((signal) => isPromptEligiblePreferenceSignal(signal, now)).length
          - left.signals.filter((signal) => isPromptEligiblePreferenceSignal(signal, now)).length
        || right.lastUpdatedAt - left.lastUpdatedAt)[0];
    const historyProfile = getHistorySiteSummaries({
      workspaceId: input.workspaceId,
      ...(activeDomain !== "unknown" ? { domain: activeDomain } : {}),
    })[0];

    const lines: string[] = [];
    const resolvedDomain = activeDomain !== "unknown"
      ? activeDomain
      : relatedGuidances[0]?.domain ?? recentEpisodes[0]?.domain;
    if (resolvedDomain) {
      lines.push(`Learned behavior guidance for ${resolvedDomain}:`);
    } else {
      lines.push("Learned behavior guidance:");
    }

    if (input.task?.trim()) {
      lines.push(`- Current task: ${truncateText(input.task.trim(), 140)}`);
    }

    for (const guidance of relatedGuidances) {
      lines.push(
        `- Guidance: ${guidance.intentLabel} on ${guidance.domain} `
        + `(${guidance.support} traces, success ${Math.round(guidance.successRate * 100)}%, confidence ${guidance.confidence.toFixed(2)})`,
      );
      lines.push(`  Purpose: ${guidance.purposeLabel}`);
      lines.push(`  Goal: ${guidance.goalSummary}`);
      if (guidance.keywords.length > 0) {
        lines.push(`  Keywords: ${guidance.keywords.join(" | ")}`);
      }
      if (guidance.inputTargets.length > 0) {
        lines.push(`  Input targets: ${guidance.inputTargets.join(" | ")}`);
      }
      if (guidance.clickTargets.length > 0) {
        lines.push(`  Click targets: ${guidance.clickTargets.join(" | ")}`);
      }
      if (guidance.recommendedSteps.length > 0) {
        lines.push(`  Best practice: ${guidance.recommendedSteps.join(" | ")}`);
      }
      if (guidance.toolOrder.length > 0) {
        lines.push(`  Tool order: ${guidance.toolOrder.join(" -> ")}`);
      }
      if (guidance.recoveryHints.length > 0) {
        lines.push(`  Recovery: ${guidance.recoveryHints.join(" | ")}`);
      }
      if (guidance.cautionNotes.length > 0) {
        lines.push(`  Cautions: ${guidance.cautionNotes.join(" | ")}`);
      }
    }

    for (const skill of relatedSiteSkills) {
      lines.push(
        `- Site skill: ${skill.patternLabel} on ${skill.domain} `
        + `(${skill.support} traces, success ${Math.round(skill.successRate * 100)}%, confidence ${skill.confidence.toFixed(2)})`,
      );
      lines.push(`  Rule: ${skill.rule}`);
      if (skill.evidence.length > 0) {
        lines.push(`  Evidence: ${skill.evidence.join(" | ")}`);
      }
    }

    for (const episode of recentEpisodes) {
      lines.push(
        `- Recent observed sequence (${episode.intentLabel}; ${episode.purposeLabel}): ${episode.sequence.join(" -> ")}`,
      );
    }

    if (historyProfile) {
      const historySummarySegments = [
        `${historyProfile.domain} was visited ${historyProfile.visitCount} times`,
        `across ${historyProfile.uniquePageCount} pages`,
      ];
      if (historyProfile.revisitPattern && historyProfile.activityLevel) {
        historySummarySegments.push(
          `(${historyProfile.revisitPattern}, activity ${historyProfile.activityLevel})`,
        );
      }
      lines.push(`- Browsing history: ${historySummarySegments.join(" ")}.`);
      if (historyProfile.profileSummary) {
        lines.push(`  Summary: ${historyProfile.profileSummary}`);
      }
      if (historyProfile.commonIntents.length > 0) {
        lines.push(`  Common intents: ${historyProfile.commonIntents.join(" | ")}`);
      }
      if (historyProfile.revisitDrivers.length > 0) {
        lines.push(`  Revisit drivers: ${historyProfile.revisitDrivers.join(" | ")}`);
      }
      if (historyProfile.topPages.length > 0) {
        lines.push(
          `  Top pages: ${historyProfile.topPages.map((page) =>
            `${page.title} (${page.visitCount})`).join(" | ")}`,
        );
      }
    }

    if (styleProfile) {
      lines.push("- Style profile:");
      if (styleProfile.contextLabel || styleProfile.slotLabel) {
        lines.push(
          `  Surface: ${[styleProfile.contextLabel, styleProfile.slotLabel].filter(Boolean).join(" / ")}`,
        );
      }
      if (styleProfile.recipientLabel) {
        lines.push(`  Recipient: ${styleProfile.recipientLabel}`);
      }
      if (styleProfile.tone) {
        lines.push(`  Tone: ${styleProfile.tone}`);
      }
      if (styleProfile.formality) {
        lines.push(`  Formality: ${styleProfile.formality}`);
      }
      if (pickBestStyleDescriptor(styleProfile)) {
        lines.push(`  Summary: ${pickBestStyleDescriptor(styleProfile)}`);
      }
      if (styleProfile.commonPhrases.length > 0) {
        lines.push(`  Common phrases: ${styleProfile.commonPhrases.join(" | ")}`);
      }
      if (styleProfile.exemplarSnippets.length > 0) {
        lines.push(`  Examples: ${styleProfile.exemplarSnippets.join(" | ")}`);
      }
    }

    const promptPreferenceSignals = preferenceProfile?.signals
      .filter((signal) => isPromptEligiblePreferenceSignal(signal, now)) ?? [];
    if (promptPreferenceSignals.length > 0) {
      lines.push("- Preference profile:");
      for (const signal of promptPreferenceSignals) {
        const metadata = [
          signal.category,
          signal.scope === "domain" && signal.domain ? signal.domain : undefined,
          `confidence ${signal.confidence.toFixed(2)}`,
        ].filter(Boolean).join(", ");
        lines.push(`  ${signal.key}: ${signal.value} (${metadata})`);
      }
    }

    if (lines.length <= 1) {
      return undefined;
    }

    return lines.join("\n");
  }

  function buildGuidanceSearchCorpus(guidance: LearningGuidance) {
    return [
      guidance.domain,
      guidance.scheme,
      guidance.pageType,
      guidance.intentKey,
      guidance.intentLabel,
      guidance.purposeKey,
      guidance.purposeLabel,
      guidance.goalSummary,
      ...guidance.keywords,
      ...guidance.inputTargets,
      ...guidance.clickTargets,
      ...guidance.preferredTargets,
      ...guidance.recommendedSteps,
      ...guidance.toolOrder,
      ...guidance.recoveryHints,
      ...guidance.cautionNotes,
      ...guidance.sampleSequence,
    ]
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .join(" ")
      .toLowerCase();
  }

  function buildSiteSkillSearchCorpus(skill: LearningSiteSkill) {
    return [
      skill.domain,
      skill.scheme,
      skill.pageType,
      skill.patternKey,
      skill.patternLabel,
      skill.rule,
      ...skill.evidence,
    ]
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .join(" ")
      .toLowerCase();
  }

  function searchGuidance(input: LearningGuidanceSearchInput): LearningGuidanceSearchResult {
    pruneState();
    flushOpenEpisodes({ maxEventCount: DEFERRED_LEARNING_EVENT_BATCH_SIZE });

    const blacklistDomains = getUserBlacklistDomains();
    const activeDomain = inferDomain(input.activeUrl);
    const activePageType = inferPageType(input.activeUrl);
    const domainFilter = normalizeGuidanceSearchDomain(input.domain);
    const query = input.query?.trim() || undefined;
    const queryLower = query?.toLowerCase();
    const queryKeywords = collectKeywords([query, input.activeUrl, input.domain]);
    const inferredIntent = inferIntent({
      domain: activeDomain,
      url: input.activeUrl,
      pageType: activePageType,
      pageTitle: undefined,
      keywords: queryKeywords,
      inputTargets: [],
      clickTargets: [],
      sequence: [],
      hasDownload: Boolean(
        query && (/download|export/i.test(query) || query.includes("下载") || query.includes("导出")),
      ),
    });
    const inferredPurpose = inferPurpose({
      domain: activeDomain,
      url: input.activeUrl,
      pageType: activePageType,
      pageTitle: undefined,
      keywords: queryKeywords,
      inputTargets: [],
      clickTargets: [],
      sequence: [],
      hasDownload: Boolean(
        query && (/download|export/i.test(query) || query.includes("下载") || query.includes("导出")),
      ),
    }, inferredIntent);

    const scopedGuidances = guidances.filter((guidance) =>
      guidance.workspaceId === input.workspaceId
      && !isBlacklistedRecord(guidance, blacklistDomains)
      && matchesGuidanceDomain(guidance.domain, domainFilter));
    const scopedSiteSkills = siteSkills.filter((skill) =>
      skill.workspaceId === input.workspaceId
      && !isBlacklistedRecord(skill, blacklistDomains)
      && matchesGuidanceDomain(skill.domain, domainFilter));
    const scopedFeedback = feedbackRecords.filter((record) =>
      record.workspaceId === input.workspaceId
      && !isBlacklistedRecord(record, blacklistDomains)
      && (!domainFilter || matchesGuidanceDomain(record.domain, domainFilter))
      && (activeDomain === "unknown" || record.domain === activeDomain));

    const actionStrategies = scopedGuidances
      .map((guidance) => {
        const corpus = buildGuidanceSearchCorpus(guidance);
        const matchedKeywords = uniqueStrings(
          queryKeywords.filter((keyword) =>
            corpus.includes(keyword)
            || guidance.keywords.some((entry) => entry.includes(keyword) || keyword.includes(entry))),
          4,
        );
        const feedbackStats = getGuidanceFeedbackStats(guidance.guidanceId);
        const domainMatched = activeDomain !== "unknown" && guidance.domain === activeDomain;
        const pageTypeMatched = Boolean(activePageType && guidance.pageType === activePageType);
        const explicitDomainMatched = Boolean(domainFilter && matchesGuidanceDomain(guidance.domain, domainFilter));
        const intentMatched = Boolean(query && guidance.intentKey === inferredIntent.key);
        const purposeMatched = Boolean(query && guidance.purposeKey === inferredPurpose.key);
        const textMatched = Boolean(queryLower && corpus.includes(queryLower));

        const matchReasons: string[] = [];
        let matchScore =
          Math.min(guidance.support, 5)
          + guidance.successRate * 3
          + guidance.confidence * 2
          + feedbackStats.quality * 3
          - feedbackStats.penalty;

        if (explicitDomainMatched) {
          matchScore += 10;
          matchReasons.push(`domain:${guidance.domain}`);
        }
        if (domainMatched) {
          matchScore += 8;
          matchReasons.push(`active-domain:${guidance.domain}`);
        }
        if (pageTypeMatched && guidance.pageType) {
          matchScore += 3;
          matchReasons.push(`page-type:${guidance.pageType}`);
        }
        if (intentMatched) {
          matchScore += 6;
          matchReasons.push(`intent:${guidance.intentLabel}`);
        }
        if (purposeMatched) {
          matchScore += 3;
          matchReasons.push(`purpose:${guidance.purposeLabel}`);
        }
        if (textMatched) {
          matchScore += 5;
          matchReasons.push("query-text");
        }
        if (matchedKeywords.length > 0) {
          matchScore += Math.min(8, matchedKeywords.length * 2);
          matchReasons.push(`keywords:${matchedKeywords.join(", ")}`);
        }

        const hasExplicitSignal =
          explicitDomainMatched
          || domainMatched
          || pageTypeMatched
          || intentMatched
          || purposeMatched
          || textMatched
          || matchedKeywords.length > 0;

        return {
          guidance,
          matchScore: Number(matchScore.toFixed(2)),
          matchReasons,
          hasExplicitSignal,
        };
      })
      .filter((entry) => {
        if (!query && !domainFilter && activeDomain === "unknown") {
          return true;
        }
        if (!query && !domainFilter) {
          return entry.hasExplicitSignal;
        }
        if (domainFilter && !query) {
          return true;
        }
        return entry.hasExplicitSignal;
      })
      .sort((left, right) =>
        right.matchScore - left.matchScore
        || right.guidance.lastSeenAt - left.guidance.lastSeenAt
        || right.guidance.support - left.guidance.support
        || right.guidance.confidence - left.guidance.confidence)
      .map(({ guidance, matchScore, matchReasons }) => ({
        guidanceId: guidance.guidanceId,
        domain: guidance.domain,
        ...(guidance.scheme ? { scheme: guidance.scheme } : {}),
        ...(guidance.pageType ? { pageType: guidance.pageType } : {}),
        intentKey: guidance.intentKey,
        intentLabel: guidance.intentLabel,
        purposeKey: guidance.purposeKey,
        purposeLabel: guidance.purposeLabel,
        goalSummary: guidance.goalSummary,
        keywords: [...guidance.keywords],
        preferredTargets: [...guidance.preferredTargets],
        recommendedSteps: [...guidance.recommendedSteps],
        recoveryHints: [...guidance.recoveryHints],
        support: guidance.support,
        successRate: guidance.successRate,
        confidence: guidance.confidence,
        feedbackCount: countFeedbackForGuidance(guidance.guidanceId),
        lastSeenAt: guidance.lastSeenAt,
        matchScore,
        matchReasons,
      }));

    const siteSkillMatches = scopedSiteSkills
      .map((skill) => {
        const corpus = buildSiteSkillSearchCorpus(skill);
        const matchedKeywords = uniqueStrings(
          queryKeywords.filter((keyword) =>
            corpus.includes(keyword)
            || skill.evidence.some((entry) => entry.includes(keyword) || keyword.includes(entry))),
          4,
        );
        const domainMatched = activeDomain !== "unknown" && skill.domain === activeDomain;
        const pageTypeMatched = Boolean(activePageType && skill.pageType === activePageType);
        const explicitDomainMatched = Boolean(domainFilter && matchesGuidanceDomain(skill.domain, domainFilter));
        const textMatched = Boolean(queryLower && corpus.includes(queryLower));

        const matchReasons: string[] = [];
        let matchScore =
          Math.min(skill.support, 6)
          + skill.successRate * 4
          + skill.confidence * 2;

        if (explicitDomainMatched) {
          matchScore += 10;
          matchReasons.push(`domain:${skill.domain}`);
        }
        if (domainMatched) {
          matchScore += 8;
          matchReasons.push(`active-domain:${skill.domain}`);
        }
        if (pageTypeMatched && skill.pageType) {
          matchScore += 3;
          matchReasons.push(`page-type:${skill.pageType}`);
        }
        if (textMatched) {
          matchScore += 5;
          matchReasons.push("query-text");
        }
        if (matchedKeywords.length > 0) {
          matchScore += Math.min(8, matchedKeywords.length * 2);
          matchReasons.push(`keywords:${matchedKeywords.join(", ")}`);
        }

        const hasExplicitSignal =
          explicitDomainMatched
          || domainMatched
          || pageTypeMatched
          || textMatched
          || matchedKeywords.length > 0;

        return {
          skill,
          matchScore: Number(matchScore.toFixed(2)),
          matchReasons,
          hasExplicitSignal,
        };
      })
      .filter((entry) => {
        if (!query && !domainFilter && activeDomain === "unknown") {
          return true;
        }
        if (!query && !domainFilter) {
          return entry.hasExplicitSignal;
        }
        if (domainFilter && !query) {
          return true;
        }
        return entry.hasExplicitSignal;
      })
      .sort((left, right) =>
        right.matchScore - left.matchScore
        || right.skill.lastSeenAt - left.skill.lastSeenAt
        || right.skill.support - left.skill.support
        || right.skill.confidence - left.skill.confidence)
      .map(({ skill, matchScore, matchReasons }) => ({
        skillId: skill.skillId,
        domain: skill.domain,
        ...(skill.scheme ? { scheme: skill.scheme } : {}),
        ...(skill.pageType ? { pageType: skill.pageType } : {}),
        patternKey: skill.patternKey,
        patternLabel: skill.patternLabel,
        rule: skill.rule,
        evidence: [...skill.evidence],
        support: skill.support,
        successRate: skill.successRate,
        confidence: skill.confidence,
        lastSeenAt: skill.lastSeenAt,
        matchScore,
        matchReasons,
      }));

    const styleProfile = styleProfiles
      .filter((profile) =>
        profile.workspaceId === input.workspaceId
        && (
          activeDomain === "unknown"
          || !profile.domain
          || profile.domain === activeDomain
          || (domainFilter ? matchesGuidanceDomain(profile.domain, domainFilter) : false)
        ))
      .sort((left, right) =>
        Number(right.domain === activeDomain) - Number(left.domain === activeDomain)
        || right.lastUpdatedAt - left.lastUpdatedAt
        || right.confidence - left.confidence)[0];
    const preferenceProfile = preferenceProfiles
      .filter((profile) => profile.workspaceId === input.workspaceId)
      .sort((left, right) => right.lastUpdatedAt - left.lastUpdatedAt)[0];
    const historyProfile = (() => {
      const historySites = getHistorySiteSummaries({
        workspaceId: input.workspaceId,
      });
      if (activeDomain !== "unknown") {
        return historySites.find((site) => site.domain === activeDomain) ?? null;
      }
      if (domainFilter) {
        return historySites.find((site) => matchesGuidanceDomain(site.domain, domainFilter)) ?? null;
      }
      if (queryLower) {
        return historySites.find((site) =>
          site.domain.includes(queryLower)
          || site.topPages.some((page) =>
            page.title.toLowerCase().includes(queryLower)
            || page.url.toLowerCase().includes(queryLower))) ?? null;
      }
      return null;
    })();

    return {
      guidanceCount: scopedGuidances.length,
      actionStrategyCount: scopedGuidances.length,
      siteSkillCount: scopedSiteSkills.length,
      feedbackCount: scopedFeedback.length,
      ...(activeDomain !== "unknown" ? { activeDomain } : {}),
      matches: actionStrategies,
      actionStrategies,
      siteSkills: siteSkillMatches,
      ...(styleProfile ? { styleProfile: toStyleProfileSummary(styleProfile) } : {}),
      ...(preferenceProfile ? { preferenceProfile: toPreferenceProfileSummary(preferenceProfile) } : {}),
      ...(historyProfile ? { historyProfile } : {}),
    };
  }

  function recordExtractionObservation(input: LearningExtractionObservationInput) {
    const taskSummary = input.task.trim();
    if (!taskSummary) {
      return { success: false };
    }

    const domain = inferDomain(input.url);
    if (domain === "unknown") {
      return { success: false };
    }
    if (matchesBlacklistedDomain(domain, getUserBlacklistDomains())) {
      return { success: false };
    }

    const outcome = input.outcome ?? "success";
    const scheme = inferScheme(input.url);
    const pageType = inferPageType(input.url);
    const fieldKeys = sanitizeGuidanceTextList(input.fieldKeys ?? [], 12, 48);
    const sourceRole = readString(input.sourceRole);
    const regionRole = readString(input.regionRole);
    const regionName = truncateText(readString(input.regionName) ?? "", 80).trim() || undefined;
    const regionHint = truncateText(readString(input.regionHint) ?? "", 120).trim() || undefined;
    const pageSignature = readString(input.pageSignature)
      ?? buildExtractionPageSignature({
        domain,
        url: input.url,
        pageTitle: input.pageTitle,
        pageType,
        sourceRole,
        regionRole,
        regionName,
        fieldKeys,
      });
    const keywords = collectKeywords([
      taskSummary,
      input.url,
      input.pageTitle,
      pageType,
      sourceRole,
      regionRole,
      regionName,
      regionHint,
      ...(input.keywords ?? []),
      ...fieldKeys,
    ]);
    const goalSummary = buildExtractionGoalSummary({
      taskSummary,
      extractionMode: input.extractionMode,
      fieldKeys,
      regionName,
      sourceRole,
    });
    const recipeKey = buildExtractionRecipeKey({
      workspaceId: input.workspaceId,
      domain,
      scheme,
      pageType,
      extractionMode: input.extractionMode,
      pageSignature,
      sourceRole,
      regionRole,
      regionName,
      fieldKeys,
      taskSummary,
    });
    const lastSeenAt = input.ts ?? Date.now();

    const existing = extractionRecipes.find((recipe) =>
      buildExtractionRecipeKey({
        workspaceId: recipe.workspaceId,
        domain: recipe.domain,
        scheme: recipe.scheme,
        pageType: recipe.pageType,
        extractionMode: recipe.extractionMode,
        pageSignature: recipe.pageSignature,
        sourceRole: recipe.sourceRole,
        regionRole: recipe.regionRole,
        regionName: recipe.regionName,
        fieldKeys: recipe.fieldKeys,
        taskSummary: recipe.taskSummary,
      }) === recipeKey);

    if (outcome !== "success") {
      const outcomeSummary = outcome === "partial"
        ? `Extraction partially progressed for ${domain}.`
        : `Extraction failed for ${domain}.`;
      const outcomeTag = outcome === "partial"
        ? "extraction_recipe_partial"
        : "extraction_recipe_failed";
      const blockedTag = outcome === "partial"
        ? "extraction_blocked"
        : "extraction_failed";
      feedbackRecords.unshift({
        assetKind: "feedback_record",
        feedbackId: randomUUID(),
        workspaceId: input.workspaceId,
        domain,
        ts: lastSeenAt,
        outcome,
        source: "extraction_recipe",
        summary: outcomeSummary,
        reasonCodes: uniqueStrings([
          outcomeTag,
          blockedTag,
          input.extractionMode,
          pageType,
        ], 8),
        verifierSignals: uniqueStrings([
          regionRole,
          regionName,
          sourceRole,
          ...fieldKeys,
        ], 10),
        ...(scheme ? { scheme } : {}),
        ...(pageType ? { pageType } : {}),
        ...(existing?.recipeId ? { recipeId: existing.recipeId } : {}),
      });
      if (existing) {
        existing.lastSeenAt = lastSeenAt;
        existing.confidence = Number(Math.max(
          0.2,
          existing.confidence - (outcome === "failure" ? 0.12 : 0.06),
        ).toFixed(3));
      }
      scheduleSave();
      return { success: true };
    }

    if (!existing) {
      const recipeId = randomUUID();
      extractionRecipes.unshift({
        recipeId,
        workspaceId: input.workspaceId,
        domain,
        ...(scheme ? { scheme } : {}),
        ...(pageType ? { pageType } : {}),
        pageSignature,
        taskSummary: truncateText(taskSummary, 180),
        goalSummary,
        extractionMode: input.extractionMode,
        ...(sourceRole ? { sourceRole } : {}),
        ...(regionRole ? { regionRole } : {}),
        ...(regionName ? { regionName } : {}),
        ...(regionHint ? { regionHint } : {}),
        fieldKeys,
        keywords,
        support: 1,
        confidence: Number(Math.min(
          0.92,
          0.48
            + (fieldKeys.length > 0 ? 0.16 : 0)
            + (regionName || regionHint ? 0.1 : 0)
            + (sourceRole ? 0.08 : 0),
        ).toFixed(3)),
        lastSeenAt,
      });
      feedbackRecords.unshift({
        assetKind: "feedback_record",
        feedbackId: randomUUID(),
        workspaceId: input.workspaceId,
        domain,
        ts: lastSeenAt,
        outcome: "success",
        source: "extraction_recipe",
        summary: `Extraction recipe captured successfully for ${domain}.`,
        reasonCodes: uniqueStrings([
          "extraction_recipe_captured",
          input.extractionMode,
          pageType,
        ], 8),
        verifierSignals: uniqueStrings([
          regionRole,
          regionName,
          sourceRole,
          ...fieldKeys,
        ], 10),
        ...(scheme ? { scheme } : {}),
        ...(pageType ? { pageType } : {}),
        recipeId,
      });
      scheduleSave();
      return { success: true };
    }

    existing.lastSeenAt = lastSeenAt;
    existing.support += 1;
    existing.pageSignature = pageSignature;
    existing.goalSummary = goalSummary;
    existing.fieldKeys = uniqueStrings([...fieldKeys, ...existing.fieldKeys], 12);
    existing.keywords = collectKeywords([...keywords, ...existing.keywords], 18);
    if (sourceRole) {
      existing.sourceRole = sourceRole;
    }
    if (regionRole) {
      existing.regionRole = regionRole;
    }
    if (regionName) {
      existing.regionName = regionName;
    }
    if (regionHint) {
      existing.regionHint = regionHint;
    }
    existing.confidence = Number(Math.min(
      0.98,
      0.44
        + Math.min(existing.support, 5) * 0.08
        + (existing.fieldKeys.length > 0 ? 0.14 : 0)
        + (existing.regionName || existing.regionHint ? 0.08 : 0)
        + (existing.sourceRole ? 0.06 : 0),
    ).toFixed(3));
    feedbackRecords.unshift({
      assetKind: "feedback_record",
      feedbackId: randomUUID(),
      workspaceId: input.workspaceId,
      domain,
      ts: lastSeenAt,
      outcome: "success",
      source: "extraction_recipe",
      summary: `Extraction recipe reused successfully for ${domain}.`,
      reasonCodes: uniqueStrings([
        "extraction_recipe_reused",
        input.extractionMode,
        pageType,
      ], 8),
      verifierSignals: uniqueStrings([
        regionRole,
        regionName,
        sourceRole,
        ...fieldKeys,
      ], 10),
      ...(scheme ? { scheme } : {}),
      ...(pageType ? { pageType } : {}),
      recipeId: existing.recipeId,
    });
    scheduleSave();
    return { success: true };
  }

  function searchExtractionRecipes(input: LearningExtractionRecipeSearchInput): LearningExtractionRecipeSearchResult {
    pruneState();

    const blacklistDomains = getUserBlacklistDomains();
    const activeDomain = inferDomain(input.activeUrl);
    const activePageType = inferPageType(input.activeUrl);
    const activePathSignature = buildExtractionPathSignature(input.activeUrl, activePageType);
    const domainFilter = normalizeGuidanceSearchDomain(input.domain);
    const query = input.query?.trim() || undefined;
    const queryLower = query?.toLowerCase();
    const queryKeywords = collectKeywords([query, input.activeUrl, input.domain]);

    const scopedRecipes = extractionRecipes.filter((recipe) =>
      recipe.workspaceId === input.workspaceId
      && !isBlacklistedRecord(recipe, blacklistDomains)
      && matchesGuidanceDomain(recipe.domain, domainFilter));

    const matches = scopedRecipes
      .map((recipe) => {
        const corpus = buildExtractionRecipeSearchCorpus(recipe);
        const matchedKeywords = uniqueStrings(
          queryKeywords.filter((keyword) =>
            corpus.includes(keyword)
            || recipe.keywords.some((entry) => entry.includes(keyword) || keyword.includes(entry))
            || recipe.fieldKeys.some((entry) => entry.includes(keyword) || keyword.includes(entry))),
          5,
        );
        const feedbackStats = getRecipeFeedbackStats(recipe.recipeId);
        const domainMatched = activeDomain !== "unknown" && recipe.domain === activeDomain;
        const pageTypeMatched = Boolean(activePageType && recipe.pageType === activePageType);
        const explicitDomainMatched = Boolean(domainFilter && matchesGuidanceDomain(recipe.domain, domainFilter));
        const textMatched = Boolean(queryLower && corpus.includes(queryLower));
        const pageSignatureMatched = Boolean(
          activePathSignature
          && recipe.pageSignature.includes(activePathSignature),
        );

        const matchReasons: string[] = [];
        let matchScore =
          Math.min(recipe.support, 5)
          + recipe.confidence * 3
          + feedbackStats.quality * 3
          - feedbackStats.penalty;

        if (explicitDomainMatched) {
          matchScore += 10;
          matchReasons.push(`domain:${recipe.domain}`);
        }
        if (domainMatched) {
          matchScore += 8;
          matchReasons.push(`active-domain:${recipe.domain}`);
        }
        if (pageTypeMatched && recipe.pageType) {
          matchScore += 3;
          matchReasons.push(`page-type:${recipe.pageType}`);
        }
        if (pageSignatureMatched) {
          matchScore += 4;
          matchReasons.push("page-signature");
        }
        if (textMatched) {
          matchScore += 5;
          matchReasons.push("query-text");
        }
        if (matchedKeywords.length > 0) {
          matchScore += Math.min(10, matchedKeywords.length * 2);
          matchReasons.push(`keywords:${matchedKeywords.join(", ")}`);
        }

        const hasExplicitSignal =
          explicitDomainMatched
          || domainMatched
          || pageTypeMatched
          || pageSignatureMatched
          || textMatched
          || matchedKeywords.length > 0;

        return {
          recipe,
          matchScore: Number(matchScore.toFixed(2)),
          matchReasons,
          hasExplicitSignal,
        };
      })
      .filter((entry) => {
        if (!query && !domainFilter && activeDomain === "unknown") {
          return true;
        }
        if (!query && !domainFilter) {
          return entry.hasExplicitSignal;
        }
        if (domainFilter && !query) {
          return true;
        }
        return entry.hasExplicitSignal;
      })
      .sort((left, right) =>
        right.matchScore - left.matchScore
        || right.recipe.lastSeenAt - left.recipe.lastSeenAt
        || right.recipe.support - left.recipe.support
        || right.recipe.confidence - left.recipe.confidence)
      .map(({ recipe, matchScore, matchReasons }) => ({
        recipeId: recipe.recipeId,
        domain: recipe.domain,
        ...(recipe.scheme ? { scheme: recipe.scheme } : {}),
        ...(recipe.pageType ? { pageType: recipe.pageType } : {}),
        taskSummary: recipe.taskSummary,
        goalSummary: recipe.goalSummary,
        extractionMode: recipe.extractionMode,
        ...(recipe.sourceRole ? { sourceRole: recipe.sourceRole } : {}),
        ...(recipe.regionRole ? { regionRole: recipe.regionRole } : {}),
        ...(recipe.regionName ? { regionName: recipe.regionName } : {}),
        ...(recipe.regionHint ? { regionHint: recipe.regionHint } : {}),
        fieldKeys: [...recipe.fieldKeys],
        keywords: [...recipe.keywords],
        support: recipe.support,
        confidence: recipe.confidence,
        lastSeenAt: recipe.lastSeenAt,
        matchScore,
        matchReasons,
      }));

    return {
      recipeCount: scopedRecipes.length,
      ...(activeDomain !== "unknown" ? { activeDomain } : {}),
      matches,
    };
  }

  function getGuidanceDetail(input: { workspaceId: string; guidanceId: string }): LearningGuidanceDetail | null {
    pruneState();
    flushOpenEpisodes({ maxEventCount: DEFERRED_LEARNING_EVENT_BATCH_SIZE });

    const normalizedGuidanceId = input.guidanceId.trim();
    if (!normalizedGuidanceId) {
      return null;
    }

    const blacklistDomains = getUserBlacklistDomains();
    const guidance = guidances.find((entry) =>
      entry.guidanceId === normalizedGuidanceId
      && entry.workspaceId === input.workspaceId
      && !isBlacklistedRecord(entry, blacklistDomains));
    if (!guidance) {
      return null;
    }

    const relatedEpisodes = episodes
      .filter((episode) =>
        buildGuidanceKey(episode) === buildGuidanceKeyFromGuidance(guidance)
        && !isBlacklistedRecord(episode, blacklistDomains))
      .sort((left, right) => right.endedAt - left.endedAt)
      .map((episode) => ({
        episodeId: episode.episodeId,
        endedAt: episode.endedAt,
        ...(episode.url ? { url: episode.url } : {}),
        ...(episode.pageTitle ? { pageTitle: episode.pageTitle } : {}),
        ...(episode.pageType ? { pageType: episode.pageType } : {}),
        outcome: episode.outcome,
        topTargets: [...episode.topTargets],
        inputTargets: [...episode.inputTargets],
        clickTargets: [...episode.clickTargets],
        sequence: [...episode.sequence],
        keywords: [...episode.keywords],
      }));
    const relatedSiteSkills = listRelatedSiteSkills(guidance.guidanceId)
      .filter((skill) => !isBlacklistedRecord(skill, blacklistDomains))
      .sort((left, right) =>
        right.lastSeenAt - left.lastSeenAt
        || right.support - left.support
        || right.confidence - left.confidence)
      .map((skill) => toSiteSkillSummary(skill));
    const recentFeedback = feedbackRecords
      .filter((record) =>
        record.guidanceId === guidance.guidanceId
        && !isBlacklistedRecord(record, blacklistDomains))
      .sort((left, right) => right.ts - left.ts)
      .map((record) => toFeedbackRecordSummary(record));

    return {
      ...guidance,
      keywords: [...guidance.keywords],
      inputTargets: [...guidance.inputTargets],
      clickTargets: [...guidance.clickTargets],
      preferredTargets: [...guidance.preferredTargets],
      recommendedSteps: [...guidance.recommendedSteps],
      toolOrder: [...guidance.toolOrder],
      recoveryHints: [...guidance.recoveryHints],
      cautionNotes: [...guidance.cautionNotes],
      sampleSequence: [...guidance.sampleSequence],
      relatedEpisodeCount: relatedEpisodes.length,
      feedbackCount: countFeedbackForGuidance(guidance.guidanceId),
      recentEpisodes: relatedEpisodes,
      relatedSiteSkills,
      recentFeedback,
    };
  }

  function load() {
    try {
      if (!existsSync(options.statePath)) {
        return;
      }
      const raw = readFileSync(options.statePath, "utf-8").trim();
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!isRecord(parsed)) {
        return;
      }
      const parsedVersion = readNumber(parsed.version) ?? 0;
      rawEvents = Array.isArray(parsed.rawEvents)
        ? parsed.rawEvents
          .map((entry) => normalizeRawEvent(entry))
          .filter((entry): entry is LearningRawEvent => entry !== null)
        : [];
      pageSnapshots = Array.isArray(parsed.pageSnapshots)
        ? parsed.pageSnapshots
          .map((entry) => normalizePageSnapshot(entry))
          .filter((entry): entry is LearningPageSnapshot => entry !== null)
        : [];
      const parsedLearnedEventIds = Array.isArray(parsed.learnedEventIds)
        ? parsed.learnedEventIds
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        : null;
      const parsedLlmLearnedEpisodeIds = Array.isArray(parsed.llmLearnedEpisodeIds)
        ? parsed.llmLearnedEpisodeIds
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        : null;
      const parsedDeferredEpisodeLearningIds = Array.isArray(parsed.deferredEpisodeLearningIds)
        ? parsed.deferredEpisodeLearningIds
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        : null;
      const parsedDeferredHistoryProfileKeys = Array.isArray(parsed.deferredHistoryProfileKeys)
        ? parsed.deferredHistoryProfileKeys
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        : null;
      const parsedDeferredStyleProfileIds = Array.isArray(parsed.deferredStyleProfileIds)
        ? parsed.deferredStyleProfileIds
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        : null;
      episodes = Array.isArray(parsed.episodes)
        ? parsed.episodes
          .map((entry) => normalizeEpisode(entry))
          .filter((entry): entry is LearningEpisode => entry !== null)
        : [];
      deletedHistoryDomains = Array.isArray(parsed.deletedHistoryDomains)
        ? parsed.deletedHistoryDomains
          .map((entry) => normalizeDeletedHistoryDomain(entry))
          .filter((entry): entry is LearningDeletedHistoryDomain => entry !== null)
        : [];
      historyProfiles = Array.isArray(parsed.historyProfiles)
        ? parsed.historyProfiles
          .map((entry) => normalizeHistoryProfile(entry))
          .filter((entry): entry is LearningHistoryProfile => entry !== null)
        : [];
      guidances = Array.isArray(parsed.guidances)
        ? parsed.guidances
          .map((entry) => normalizeGuidance(entry))
          .filter((entry): entry is LearningGuidance => entry !== null)
        : [];
      siteSkills = Array.isArray(parsed.siteSkills)
        ? parsed.siteSkills
          .map((entry) => normalizeSiteSkill(entry))
          .filter((entry): entry is LearningSiteSkill => entry !== null)
        : [];
      feedbackRecords = Array.isArray(parsed.feedbackRecords)
        ? parsed.feedbackRecords
          .map((entry) => normalizeFeedbackRecord(entry))
          .filter((entry): entry is LearningFeedbackRecord => entry !== null)
        : [];
      writingSamples = Array.isArray(parsed.writingSamples)
        ? parsed.writingSamples
          .map((entry) => normalizeWritingSample(entry))
          .filter((entry): entry is LearningWritingSample => entry !== null)
        : [];
      deletedStyleProfileGroups = Array.isArray(parsed.deletedStyleProfileGroups)
        ? parsed.deletedStyleProfileGroups
          .map((entry) => normalizeDeletedStyleProfileGroup(entry))
          .filter((entry): entry is LearningDeletedStyleProfileGroup => entry !== null)
        : [];
      styleProfiles = Array.isArray(parsed.styleProfiles)
        ? parsed.styleProfiles
          .map((entry) => normalizeStyleProfile(entry))
          .filter((entry): entry is LearningStyleProfile => entry !== null)
        : [];
      preferenceProfiles = Array.isArray(parsed.preferenceProfiles)
        ? parsed.preferenceProfiles
          .map((entry) => normalizePreferenceProfile(entry))
          .filter((entry): entry is LearningPreferenceProfile => entry !== null)
        : [];
      extractionRecipes = Array.isArray(parsed.extractionRecipes)
        ? parsed.extractionRecipes
          .map((entry) => normalizeExtractionRecipe(entry))
          .filter((entry): entry is LearningExtractionRecipe => entry !== null)
        : [];
      llmLearnedEpisodeIds = parsedLlmLearnedEpisodeIds ?? [];
      deferredEpisodeLearningIds = parsedDeferredEpisodeLearningIds ?? [];
      deferredHistoryProfileKeys = parsedDeferredHistoryProfileKeys ?? [];
      deferredStyleProfileIds = parsedDeferredStyleProfileIds ?? [];
      learnedEventIds = parsedLearnedEventIds
        ?? (episodes.length > 0 || guidances.length > 0
          ? rawEvents.map((event) => event.id)
          : []);
      if (parsedVersion < LEARNING_STATE_VERSION) {
        learnedEventIds = [];
        episodes = [];
        deferredEpisodeLearningIds = [];
        deferredHistoryProfileKeys = [];
        deferredStyleProfileIds = [];
        historyProfiles = [];
        guidances = [];
        siteSkills = [];
        feedbackRecords = [];
        llmLearnedEpisodeIds = [];
      }
      const pruned = pruneState();
      const deferredLearning = processDeferredLearning({
        now: Date.now(),
        scheduleSave: false,
        maxEventCount: DEFERRED_LEARNING_EVENT_BATCH_SIZE,
      });
      if (pruned || deferredLearning.changed || deferredLearning.hasMore) {
        scheduleSave();
      }
    } catch {
      rawEvents = [];
      pageSnapshots = [];
      learnedEventIds = [];
      llmLearnedEpisodeIds = [];
      deferredEpisodeLearningIds = [];
      deferredHistoryProfileKeys = [];
      deferredStyleProfileIds = [];
      episodes = [];
      deletedHistoryDomains = [];
      historyProfiles = [];
      guidances = [];
      siteSkills = [];
      feedbackRecords = [];
      writingSamples = [];
      deletedStyleProfileGroups = [];
      styleProfiles = [];
      preferenceProfiles = [];
      extractionRecipes = [];
    }
  }

  function flush(input?: { reschedule?: boolean }) {
    const deferredLearning = processDeferredLearning({
      now: Date.now(),
      scheduleSave: false,
      maxEventCount: DEFERRED_LEARNING_EVENT_BATCH_SIZE,
    });
    pruneState();

    try {
      ensureStateDirectory();
      if (existsSync(options.statePath)) {
        copyFileSync(options.statePath, options.backupPath);
      }
      writeFileSync(options.tempPath, JSON.stringify(buildStatePayload()), "utf-8");
      renameSync(options.tempPath, options.statePath);
    } catch {
      try {
        if (existsSync(options.tempPath)) {
          unlinkSync(options.tempPath);
        }
      } catch {
        // Ignore cleanup failures.
      }
    }
    if (input?.reschedule !== false && deferredLearning.hasMore) {
      scheduleSave();
    }
  }

  function learnNow(): LearningFlushResult {
    const result = processDeferredLearning({
      now: Date.now(),
      scheduleSave: false,
      includeCurrentDay: true,
    });
    flush();
    return {
      success: true,
      processedEventCount: result.learnedEventCount,
      learnedEpisodeCount: result.learnedEpisodeCount,
      learnedGuidanceCount: 0,
      writingSampleCount: 0,
    };
  }

  function applyPreferencesChanged() {
    if (pruneState()) {
      scheduleSave();
    }
  }

  function clear() {
    rawEvents = [];
    pageSnapshots = [];
    learnedEventIds = [];
    llmLearnedEpisodeIds = [];
    deferredEpisodeLearningIds = [];
    deferredHistoryProfileKeys = [];
    deferredStyleProfileIds = [];
    episodes = [];
    deletedHistoryDomains = [];
    historyProfiles = [];
    guidances = [];
    siteSkills = [];
    feedbackRecords = [];
    writingSamples = [];
    deletedStyleProfileGroups = [];
    styleProfiles = [];
    preferenceProfiles = [];
    extractionRecipes = [];
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    flush();
  }

  function exportState(): LearningStatePayload {
    pruneState();
    return JSON.parse(JSON.stringify(buildStatePayload())) as LearningStatePayload;
  }

  function deleteSite(siteId: string) {
    flushOpenEpisodes({ maxEventCount: DEFERRED_LEARNING_EVENT_BATCH_SIZE });

    const normalizedSiteId = normalizeBlacklistDomain(siteId);
    if (!normalizedSiteId) {
      return { success: false };
    }

    const hadMatch =
      rawEvents.some((event) => event.domain === normalizedSiteId)
      || pageSnapshots.some((snapshot) => snapshot.domain === normalizedSiteId)
      || episodes.some((episode) => episode.domain === normalizedSiteId)
      || historyProfiles.some((profile) => profile.domain === normalizedSiteId)
      || guidances.some((guidance) => guidance.domain === normalizedSiteId)
      || siteSkills.some((skill) => skill.domain === normalizedSiteId)
      || feedbackRecords.some((record) => record.domain === normalizedSiteId)
      || writingSamples.some((sample) => sample.domain === normalizedSiteId)
      || styleProfiles.some((profile) => profile.domain === normalizedSiteId)
      || extractionRecipes.some((recipe) => recipe.domain === normalizedSiteId);

    if (!hadMatch) {
      return { success: false };
    }

    rawEvents = rawEvents.filter((event) => event.domain !== normalizedSiteId);
    pageSnapshots = pageSnapshots.filter((snapshot) => snapshot.domain !== normalizedSiteId);
    episodes = episodes.filter((episode) => episode.domain !== normalizedSiteId);
    deferredEpisodeLearningIds = deferredEpisodeLearningIds.filter((episodeId) =>
      episodes.some((episode) => episode.episodeId === episodeId));
    deferredHistoryProfileKeys = deferredHistoryProfileKeys.filter((profileKey) => {
      const parsed = parseHistoryProfileKey(profileKey);
      return parsed ? parsed.domain !== normalizedSiteId : false;
    });
    historyProfiles = historyProfiles.filter((profile) => profile.domain !== normalizedSiteId);
    guidances = guidances.filter((guidance) => guidance.domain !== normalizedSiteId);
    siteSkills = siteSkills.filter((skill) => skill.domain !== normalizedSiteId);
    feedbackRecords = feedbackRecords.filter((record) => record.domain !== normalizedSiteId);
    writingSamples = writingSamples.filter((sample) => sample.domain !== normalizedSiteId);
    deferredStyleProfileIds = deferredStyleProfileIds.filter((profileId) =>
      writingSamples.some((sample) =>
        buildStyleProfileGroupKey({
          workspaceId: sample.workspaceId,
          domain: sample.domain,
          contextType: sample.contextType,
          slot: sample.slot,
          recipientKey: sample.recipientKey,
        }) === profileId));
    styleProfiles = styleProfiles.filter((profile) => profile.domain !== normalizedSiteId);
    extractionRecipes = extractionRecipes.filter((recipe) => recipe.domain !== normalizedSiteId);
    markHistoryDomainDeleted(normalizedSiteId);
    pruneState();
    flush();
    return { success: true };
  }

  function deleteGuidance(guidanceId: string) {
    flushOpenEpisodes({ maxEventCount: DEFERRED_LEARNING_EVENT_BATCH_SIZE });

    const normalizedGuidanceId = guidanceId.trim();
    if (!normalizedGuidanceId) {
      return { success: false };
    }

    const targetGuidance = guidances.find((guidance) => guidance.guidanceId === normalizedGuidanceId);
    if (!targetGuidance) {
      return { success: false };
    }

    guidances = guidances.filter((guidance) => guidance.guidanceId !== normalizedGuidanceId);
    feedbackRecords = feedbackRecords.filter((record) => record.guidanceId !== normalizedGuidanceId);
    siteSkills = siteSkills.map((skill) => ({
      ...skill,
      sourceGuidanceIds: skill.sourceGuidanceIds.filter((id) => id !== normalizedGuidanceId),
    }));
    flush();
    return { success: true };
  }

  function deleteSiteSkill(skillId: string) {
    flushOpenEpisodes({ maxEventCount: DEFERRED_LEARNING_EVENT_BATCH_SIZE });

    const normalizedSkillId = skillId.trim();
    if (!normalizedSkillId) {
      return { success: false };
    }

    const targetSkill = siteSkills.find((skill) => skill.skillId === normalizedSkillId);
    if (!targetSkill) {
      return { success: false };
    }

    siteSkills = siteSkills.filter((skill) => skill.skillId !== normalizedSkillId);
    feedbackRecords = feedbackRecords.filter((record) => record.skillId !== normalizedSkillId);
    flush();
    return { success: true };
  }

  function deleteHistorySite(domain: string) {
    flushOpenEpisodes({ maxEventCount: DEFERRED_LEARNING_EVENT_BATCH_SIZE });

    const normalizedDomain = normalizeBlacklistDomain(domain);
    if (!normalizedDomain) {
      return { success: false };
    }

    const hasObservedHistory = getScopedHistoryRecords({ domain: normalizedDomain }).length > 0;
    const hasProfile = historyProfiles.some((profile) => profile.domain === normalizedDomain);
    if (!hasObservedHistory && !hasProfile) {
      return { success: false };
    }

    historyProfiles = historyProfiles.filter((profile) => profile.domain !== normalizedDomain);
    deferredHistoryProfileKeys = deferredHistoryProfileKeys.filter((profileKey) => {
      const parsed = parseHistoryProfileKey(profileKey);
      return parsed ? parsed.domain !== normalizedDomain : false;
    });
    markHistoryDomainDeleted(normalizedDomain);
    pruneState();
    flush();
    return { success: true };
  }

  function deleteStyleProfile(profileId: string) {
    flushOpenEpisodes({ maxEventCount: DEFERRED_LEARNING_EVENT_BATCH_SIZE });

    const normalizedProfileId = profileId.trim();
    if (!normalizedProfileId) {
      return { success: false };
    }

    const targetProfile = styleProfiles.find((profile) =>
      profile.profileId === normalizedProfileId
      || buildStyleProfileGroupKeyFromProfile(profile) === normalizedProfileId);
    if (!targetProfile) {
      return { success: false };
    }

    const profileGroupKey = buildStyleProfileGroupKeyFromProfile(targetProfile);
    styleProfiles = styleProfiles.filter((profile) =>
      profile.profileId !== normalizedProfileId
      && buildStyleProfileGroupKeyFromProfile(profile) !== profileGroupKey);
    deferredStyleProfileIds = deferredStyleProfileIds.filter((profileId) => profileId !== profileGroupKey);
    markStyleProfileGroupDeleted(profileGroupKey);
    pruneState();
    flush();
    return { success: true };
  }

  function deletePreferenceProfile(profileId: string) {
    flushOpenEpisodes({ maxEventCount: DEFERRED_LEARNING_EVENT_BATCH_SIZE });

    const normalizedProfileId = profileId.trim();
    if (!normalizedProfileId) {
      return { success: false };
    }

    const hasProfile = preferenceProfiles.some((profile) => profile.profileId === normalizedProfileId);
    if (!hasProfile) {
      return { success: false };
    }

    preferenceProfiles = preferenceProfiles.filter((profile) => profile.profileId !== normalizedProfileId);
    flush();
    return { success: true };
  }

  function resolvePreferenceProfileIndex(input: {
    profileId?: string;
    workspaceId?: string;
  }) {
    const explicitProfileId = readString(input.profileId);
    if (explicitProfileId) {
      const explicitIndex = preferenceProfiles.findIndex((profile) => profile.profileId === explicitProfileId);
      if (explicitIndex >= 0) {
        return explicitIndex;
      }
    }

    const workspaceId = readString(input.workspaceId) ?? DEFAULT_USER_MEMORY_WORKSPACE_ID;
    const workspaceIndex = preferenceProfiles.findIndex((profile) => profile.workspaceId === workspaceId);
    return workspaceIndex >= 0 ? workspaceIndex : -1;
  }

  function getPreferenceProfile(input?: {
    profileId?: string;
    workspaceId?: string;
  }) {
    const index = resolvePreferenceProfileIndex(input ?? {});
    if (index < 0) {
      return null;
    }
    return toPreferenceProfileSummary(preferenceProfiles[index]);
  }

  function findPreferenceSignalIndex(
    profile: LearningPreferenceProfile,
    input: LearningUserMemorySignalInput,
  ) {
    const signalId = readString(input.signalId);
    if (signalId) {
      const signalIndex = profile.signals.findIndex((signal) => signal.id === signalId);
      if (signalIndex >= 0) {
        return signalIndex;
      }
    }

    const key = readString(input.key)?.toLowerCase();
    if (!key) {
      return -1;
    }
    const category = normalizePreferenceCategory(input.category);
    const scope = normalizePreferenceScope(input.scope);
    const domain = normalizePreferenceDomain(input.domain);
    return profile.signals.findIndex((signal) =>
      signal.key.trim().toLowerCase() === key
      && (!category || (signal.category ?? "stable_preference") === category)
      && (!scope || (signal.scope ?? "global") === scope)
      && (!domain || signal.domain === domain));
  }

  function sortPreferenceSignals(signals: LearningPreferenceSignal[]) {
    const statusRank: Record<LearningPreferenceStatus, number> = {
      active: 0,
      stale: 1,
      rejected: 2,
    };
    return [...signals].sort((left, right) =>
      (statusRank[left.status ?? "active"] ?? 0) - (statusRank[right.status ?? "active"] ?? 0)
      || (right.lastSeenAt ?? right.updatedAt) - (left.lastSeenAt ?? left.updatedAt)
      || (right.strength ?? right.confidence) - (left.strength ?? left.confidence)
      || right.confidence - left.confidence
      || left.key.localeCompare(right.key));
  }

  function isPromptEligiblePreferenceSignal(signal: LearningPreferenceSignal, now = Date.now()) {
    return (signal.status ?? "active") === "active"
      && (!signal.expiresAt || signal.expiresAt > now)
      && signal.confidence >= 0.2;
  }

  function upsertUserMemory(input: LearningUserMemoryUpsertInput): LearningUserMemoryMutationResult {
    flushOpenEpisodes({ maxEventCount: DEFERRED_LEARNING_EVENT_BATCH_SIZE });

    const workspaceId = readString(input.workspaceId) ?? DEFAULT_USER_MEMORY_WORKSPACE_ID;
    const key = readString(input.key);
    const valueText = readString(input.value);
    if (!key || !valueText) {
      return { success: false };
    }

    const category = normalizePreferenceCategory(input.category) ?? "stable_preference";
    const source = normalizePreferenceSource(input.source) ?? "manual";
    const scope = normalizePreferenceScope(input.scope) ?? "global";
    const domain = normalizePreferenceDomain(input.domain);
    if (scope === "domain" && !domain) {
      return { success: false };
    }

    const now = Date.now();
    const confidence = Math.max(0, Math.min(1, readNumber(input.confidence) ?? (
      source === "manual" || source === "explicit" ? 0.95 : 0.72
    )));
    const strength = Math.max(0, Math.min(1, readNumber(input.strength) ?? confidence));
    const status = normalizePreferenceStatus(input.status) ?? "active";
    const profileId = readString(input.profileId)
      ?? preferenceProfiles.find((profile) => profile.workspaceId === workspaceId)?.profileId
      ?? buildPreferenceProfileId(workspaceId);
    let profileIndex = preferenceProfiles.findIndex((profile) => profile.profileId === profileId);

    if (profileIndex < 0) {
      preferenceProfiles.unshift({
        assetKind: "preference_profile",
        profileId,
        workspaceId,
        signals: [],
        lastUpdatedAt: now,
      });
      profileIndex = 0;
    }

    const profile = preferenceProfiles[profileIndex];
    const signalIndex = findPreferenceSignalIndex(profile, {
      profileId,
      workspaceId,
      signalId: input.signalId,
      key,
      category,
      scope,
      ...(domain ? { domain } : {}),
    });
    const existingSignal = signalIndex >= 0 ? profile.signals[signalIndex] : undefined;
    if (
      existingSignal?.status === "rejected"
      && source !== "manual"
      && source !== "explicit"
      && source !== "agent_interaction"
    ) {
      return {
        success: false,
        profile: toPreferenceProfileSummary(profile),
        signal: { ...existingSignal, evidenceRefs: [...(existingSignal.evidenceRefs ?? [])] },
      };
    }
    const expiresAt = readNumber(input.expiresAt)
      ?? existingSignal?.expiresAt
      ?? (category === "recent_focus" ? now + RECENT_FOCUS_TTL_MS : undefined);
    const nextSignal: LearningPreferenceSignal = {
      id: readString(input.signalId)
        ?? existingSignal?.id
        ?? buildPreferenceSignalId({
          profileId,
          key,
          category,
          scope,
          domain,
        }),
      key: truncateText(key, 80),
      value: valueText,
      category,
      confidence,
      source,
      strength,
      evidenceRefs: normalizePreferenceEvidenceRefs(input.evidenceRefs),
      scope,
      ...(domain ? { domain } : {}),
      createdAt: readNumber(input.createdAt) ?? existingSignal?.createdAt ?? now,
      lastSeenAt: readNumber(input.lastSeenAt) ?? now,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      status,
      updatedAt: now,
    };

    const nextSignals = signalIndex >= 0
      ? profile.signals.map((signal, index) => index === signalIndex ? nextSignal : signal)
      : [nextSignal, ...profile.signals];
    preferenceProfiles[profileIndex] = {
      ...profile,
      workspaceId,
      signals: sortPreferenceSignals(nextSignals),
      lastUpdatedAt: now,
    };
    preferenceProfiles = [...preferenceProfiles].sort((left, right) =>
      right.lastUpdatedAt - left.lastUpdatedAt
      || right.signals.length - left.signals.length);
    pruneState();
    flush();
    const updatedProfile = preferenceProfiles.find((profileEntry) => profileEntry.profileId === profileId);
    if (!updatedProfile) {
      return { success: false };
    }
    return {
      success: true,
      profile: toPreferenceProfileSummary(updatedProfile),
      signal: { ...nextSignal, evidenceRefs: [...(nextSignal.evidenceRefs ?? [])] },
    };
  }

  function deleteUserMemory(input: LearningUserMemorySignalInput): LearningUserMemoryMutationResult {
    flushOpenEpisodes({ maxEventCount: DEFERRED_LEARNING_EVENT_BATCH_SIZE });

    const profileIndex = resolvePreferenceProfileIndex(input);
    if (profileIndex < 0) {
      return { success: false };
    }
    const profile = preferenceProfiles[profileIndex];
    const signalIndex = findPreferenceSignalIndex(profile, input);
    if (signalIndex < 0) {
      return { success: false };
    }

    const nextSignals = profile.signals.filter((_signal, index) => index !== signalIndex);
    const now = Date.now();
    if (nextSignals.length === 0) {
      preferenceProfiles.splice(profileIndex, 1);
      flush();
      return { success: true };
    }

    preferenceProfiles[profileIndex] = {
      ...profile,
      signals: nextSignals,
      lastUpdatedAt: now,
    };
    flush();
    return {
      success: true,
      profile: toPreferenceProfileSummary(preferenceProfiles[profileIndex]),
    };
  }

  function rejectUserMemory(input: LearningUserMemorySignalInput): LearningUserMemoryMutationResult {
    flushOpenEpisodes({ maxEventCount: DEFERRED_LEARNING_EVENT_BATCH_SIZE });

    const profileIndex = resolvePreferenceProfileIndex(input);
    if (profileIndex < 0) {
      return { success: false };
    }
    const profile = preferenceProfiles[profileIndex];
    const signalIndex = findPreferenceSignalIndex(profile, input);
    if (signalIndex < 0) {
      return { success: false };
    }

    const now = Date.now();
    const rejectedSignal: LearningPreferenceSignal = {
      ...profile.signals[signalIndex],
      status: "rejected",
      confidence: Math.min(profile.signals[signalIndex].confidence, 0.1),
      strength: 0,
      lastSeenAt: now,
      updatedAt: now,
    };
    const nextSignals = profile.signals.map((signal, index) =>
      index === signalIndex ? rejectedSignal : signal);
    preferenceProfiles[profileIndex] = {
      ...profile,
      signals: sortPreferenceSignals(nextSignals),
      lastUpdatedAt: now,
    };
    flush();
    return {
      success: true,
      profile: toPreferenceProfileSummary(preferenceProfiles[profileIndex]),
      signal: { ...rejectedSignal, evidenceRefs: [...(rejectedSignal.evidenceRefs ?? [])] },
    };
  }

  function markEpisodeLearningDeferred(episodeId: string) {
    const normalizedEpisodeId = episodeId.trim();
    if (!normalizedEpisodeId) {
      return { success: false };
    }
    if (!episodes.some((episode) => episode.episodeId === normalizedEpisodeId)) {
      return { success: false };
    }
    deferredEpisodeLearningIds = uniqueStrings([normalizedEpisodeId, ...deferredEpisodeLearningIds]);
    scheduleSave();
    return { success: true };
  }

  function markHistoryProfileLearningDeferred(profileKey: string) {
    const normalizedProfileKey = profileKey.trim();
    if (!normalizedProfileKey) {
      return { success: false };
    }
    const parsed = parseHistoryProfileKey(normalizedProfileKey);
    if (!parsed) {
      return { success: false };
    }
    const hasHistory = getScopedHistoryRecords({
      ...(parsed.scopeKey !== HISTORY_PROFILE_GLOBAL_SCOPE ? { workspaceId: parsed.scopeKey } : {}),
      domain: parsed.domain,
    }).length > 0;
    if (!hasHistory) {
      return { success: false };
    }
    deferredHistoryProfileKeys = uniqueStrings([normalizedProfileKey, ...deferredHistoryProfileKeys]);
    scheduleSave();
    return { success: true };
  }

  function markStyleProfileLearningDeferred(profileId: string) {
    const normalizedProfileId = profileId.trim();
    if (!normalizedProfileId) {
      return { success: false };
    }
    const hasSamples = writingSamples.some((sample) =>
      buildStyleProfileGroupKey({
        workspaceId: sample.workspaceId,
        domain: sample.domain,
        contextType: sample.contextType,
        slot: sample.slot,
        recipientKey: sample.recipientKey,
      }) === normalizedProfileId);
    if (!hasSamples) {
      return { success: false };
    }
    deferredStyleProfileIds = uniqueStrings([normalizedProfileId, ...deferredStyleProfileIds]);
    scheduleSave();
    return { success: true };
  }

  function getSummary(input?: LearningSummaryInput): LearningSummary {
    const scope = resolveSummaryScope(input);
    const blacklistDomains = getUserBlacklistDomains();
    const scopedEvents = rawEvents.filter((event) =>
      !isBlacklistedRecord(event, blacklistDomains)
      && (!scope.workspaceId || event.workspaceId === scope.workspaceId)
      && (!scope.domain || event.domain === scope.domain));
    const scopedPageSnapshots = pageSnapshots.filter((snapshot) =>
      !isBlacklistedRecord(snapshot, blacklistDomains)
      && (!scope.workspaceId || snapshot.workspaceId === scope.workspaceId)
      && (!scope.domain || snapshot.domain === scope.domain));
    const scopedEpisodes = episodes.filter((episode) =>
      !isBlacklistedRecord(episode, blacklistDomains)
      && (!scope.workspaceId || episode.workspaceId === scope.workspaceId)
      && (!scope.domain || episode.domain === scope.domain));
    const scopedGuidances = guidances.filter((guidance) =>
      !isBlacklistedRecord(guidance, blacklistDomains)
      && (!scope.workspaceId || guidance.workspaceId === scope.workspaceId)
      && (!scope.domain || guidance.domain === scope.domain));
    const scopedSiteSkills = siteSkills.filter((skill) =>
      !isBlacklistedRecord(skill, blacklistDomains)
      && (!scope.workspaceId || skill.workspaceId === scope.workspaceId)
      && (!scope.domain || skill.domain === scope.domain));
    const scopedFeedbackRecords = feedbackRecords.filter((record) =>
      !isBlacklistedRecord(record, blacklistDomains)
      && (!scope.workspaceId || record.workspaceId === scope.workspaceId)
      && (!scope.domain || record.domain === scope.domain));
    const scopedStyleProfiles = styleProfiles.filter((profile) =>
      !scope.workspaceId || profile.workspaceId === scope.workspaceId);
    const scopedPreferenceProfiles = preferenceProfiles.filter((profile) =>
      !scope.workspaceId || profile.workspaceId === scope.workspaceId);
    const historySites = getHistorySiteSummaries(scope);
    const historyRecords = getScopedHistoryRecords(scope);
    const historyVisitCount = historySites.reduce((total, site) => total + site.visitCount, 0);

    const lastUpdatedAt = [
      ...scopedEvents.map((event) => event.ts),
      ...scopedPageSnapshots.map((snapshot) => snapshot.ts),
      ...scopedEpisodes.map((episode) => episode.endedAt),
      ...scopedGuidances.map((guidance) => guidance.lastSeenAt),
      ...scopedSiteSkills.map((skill) => skill.lastSeenAt),
      ...scopedFeedbackRecords.map((record) => record.ts),
      ...historyProfiles
        .filter((profile) =>
          (!scope.workspaceId || profile.workspaceId === scope.workspaceId || profile.scopeKey === HISTORY_PROFILE_GLOBAL_SCOPE)
          && (!scope.domain || profile.domain === scope.domain))
        .map((profile) => profile.lastUpdatedAt),
      ...writingSamples
        .filter((sample) =>
          (!scope.workspaceId || sample.workspaceId === scope.workspaceId)
          && (!scope.domain || sample.domain === scope.domain))
        .map((sample) => sample.ts),
      ...scopedStyleProfiles.map((profile) => profile.lastUpdatedAt),
      ...scopedPreferenceProfiles.map((profile) => profile.lastUpdatedAt),
      ...historySites.map((site) => site.lastVisitedAt),
      ...extractionRecipes
        .filter((recipe) =>
          !isBlacklistedRecord(recipe, blacklistDomains)
          && (!scope.workspaceId || recipe.workspaceId === scope.workspaceId)
          && (!scope.domain || recipe.domain === scope.domain))
        .map((recipe) => recipe.lastSeenAt),
    ]
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      .sort((left, right) => right - left)[0];

    return {
      rawEventCount: scopedEvents.length,
      pendingEventCount: getPendingEventCount(scope, blacklistDomains),
      pageSnapshotCount: scopedPageSnapshots.length,
      observationCount: scopedEpisodes.length,
      episodeCount: scopedEpisodes.length,
      actionStrategyCount: scopedGuidances.length,
      guidanceCount: scopedGuidances.length,
      siteSkillCount: scopedSiteSkills.length,
      feedbackCount: scopedFeedbackRecords.length,
      styleProfileCount: scopedStyleProfiles.length,
      preferenceProfileCount: scopedPreferenceProfiles.length,
      historyRecordCount: historyRecords.length,
      historySiteCount: historySites.length,
      historyVisitCount,
      topHistorySites: historySites,
      recentActionStrategies: [...scopedGuidances]
        .sort((left, right) => right.lastSeenAt - left.lastSeenAt || right.support - left.support)
        .map((guidance) => ({
          guidanceId: guidance.guidanceId,
          domain: guidance.domain,
          ...(guidance.pageType ? { pageType: guidance.pageType } : {}),
          intentKey: guidance.intentKey,
          intentLabel: guidance.intentLabel,
          purposeKey: guidance.purposeKey,
          purposeLabel: guidance.purposeLabel,
          goalSummary: guidance.goalSummary,
          keywords: [...guidance.keywords],
          preferredTargets: [...guidance.preferredTargets],
          recommendedSteps: [...guidance.recommendedSteps],
          recoveryHints: [...guidance.recoveryHints],
          support: guidance.support,
          successRate: guidance.successRate,
          confidence: guidance.confidence,
          feedbackCount: countFeedbackForGuidance(guidance.guidanceId),
          lastSeenAt: guidance.lastSeenAt,
        })),
      recentGuidance: [...scopedGuidances]
        .sort((left, right) => right.lastSeenAt - left.lastSeenAt || right.support - left.support)
        .map((guidance) => ({
          guidanceId: guidance.guidanceId,
          domain: guidance.domain,
          ...(guidance.pageType ? { pageType: guidance.pageType } : {}),
          intentKey: guidance.intentKey,
          intentLabel: guidance.intentLabel,
          purposeKey: guidance.purposeKey,
          purposeLabel: guidance.purposeLabel,
          goalSummary: guidance.goalSummary,
          keywords: [...guidance.keywords],
          preferredTargets: [...guidance.preferredTargets],
          recommendedSteps: [...guidance.recommendedSteps],
          recoveryHints: [...guidance.recoveryHints],
          support: guidance.support,
          successRate: guidance.successRate,
          confidence: guidance.confidence,
          feedbackCount: countFeedbackForGuidance(guidance.guidanceId),
          lastSeenAt: guidance.lastSeenAt,
        })),
      ...(lastUpdatedAt !== undefined ? { lastUpdatedAt } : {}),
    };
  }

  function getCatalog(): LearningCatalog {
    const blacklistDomains = getUserBlacklistDomains();
    const activeProgress = getActiveProgress();
    const preferences = options.getPreferences();
    const scopedEvents = rawEvents.filter((event) =>
      !isBlacklistedRecord(event, blacklistDomains));
    const scopedPageSnapshots = pageSnapshots.filter((snapshot) =>
      !isBlacklistedRecord(snapshot, blacklistDomains));
    const scopedEpisodes = episodes.filter((episode) =>
      !isBlacklistedRecord(episode, blacklistDomains));
    const scopedGuidances = guidances.filter((guidance) =>
      !isBlacklistedRecord(guidance, blacklistDomains));
    const scopedSiteSkills = siteSkills.filter((skill) =>
      !isBlacklistedRecord(skill, blacklistDomains));
    const scopedFeedbackRecords = feedbackRecords.filter((record) =>
      !isBlacklistedRecord(record, blacklistDomains));
    const scopedStyleProfiles = styleProfiles.filter((profile) =>
      !profile.domain || !matchesBlacklistedDomain(profile.domain, blacklistDomains));
    const historySites = getHistorySiteSummaries();
    const historyByDomain = new Map(historySites.map((site) => [site.domain, site]));
    const historyRecordCount = getScopedHistoryRecords().length;
    const historyVisitCount = historySites.reduce((total, site) => total + site.visitCount, 0);

    const sitesByDomain = new Map<string, LearningCatalog["sites"][number]>();
    for (const guidance of scopedGuidances) {
      const key = guidance.domain;
      const existing = sitesByDomain.get(key);
      const behavior = {
        guidanceId: guidance.guidanceId,
        domain: guidance.domain,
        ...(guidance.pageType ? { pageType: guidance.pageType } : {}),
        intentKey: guidance.intentKey,
        intentLabel: guidance.intentLabel,
        purposeKey: guidance.purposeKey,
        purposeLabel: guidance.purposeLabel,
        goalSummary: guidance.goalSummary,
        keywords: [...guidance.keywords],
        preferredTargets: [...guidance.preferredTargets],
        recommendedSteps: [...guidance.recommendedSteps],
        recoveryHints: [...guidance.recoveryHints],
        support: guidance.support,
        successRate: guidance.successRate,
        confidence: guidance.confidence,
        feedbackCount: countFeedbackForGuidance(guidance.guidanceId),
        lastSeenAt: guidance.lastSeenAt,
      };

      if (!existing) {
        sitesByDomain.set(key, {
          siteId: key,
          domain: guidance.domain,
          ...(guidance.scheme ? { scheme: guidance.scheme } : {}),
          actionStrategyCount: 1,
          guidanceCount: 1,
          siteSkillCount: 0,
          feedbackCount: 0,
          totalSupport: guidance.support,
          lastSeenAt: guidance.lastSeenAt,
          ...(historyByDomain.get(key) ? { history: historyByDomain.get(key) } : {}),
          actionStrategies: [behavior],
          behaviors: [behavior],
          siteSkills: [],
        });
        continue;
      }

      existing.actionStrategyCount += 1;
      existing.guidanceCount += 1;
      existing.totalSupport += guidance.support;
      existing.lastSeenAt = Math.max(existing.lastSeenAt, guidance.lastSeenAt);
      if (!existing.scheme && guidance.scheme) {
        existing.scheme = guidance.scheme;
      }
      existing.actionStrategies.push(behavior);
      existing.behaviors.push(behavior);
    }

    for (const skill of scopedSiteSkills) {
      const existing = sitesByDomain.get(skill.domain);
      const summary = toSiteSkillSummary(skill);
      if (!existing) {
        sitesByDomain.set(skill.domain, {
          siteId: skill.domain,
          domain: skill.domain,
          ...(skill.scheme ? { scheme: skill.scheme } : {}),
          actionStrategyCount: 0,
          guidanceCount: 0,
          siteSkillCount: 1,
          feedbackCount: scopedFeedbackRecords.filter((record) => record.domain === skill.domain).length,
          totalSupport: 0,
          lastSeenAt: skill.lastSeenAt,
          ...(historyByDomain.get(skill.domain) ? { history: historyByDomain.get(skill.domain) } : {}),
          actionStrategies: [],
          behaviors: [],
          siteSkills: [summary],
        });
        continue;
      }

      existing.siteSkillCount += 1;
      existing.lastSeenAt = Math.max(existing.lastSeenAt, skill.lastSeenAt);
      if (!existing.scheme && skill.scheme) {
        existing.scheme = skill.scheme;
      }
      existing.siteSkills.push(summary);
    }

    for (const site of sitesByDomain.values()) {
      site.feedbackCount = scopedFeedbackRecords.filter((record) => record.domain === site.domain).length;
    }

    const sites = Array.from(sitesByDomain.values())
      .map((site) => ({
        ...site,
        ...(historyByDomain.get(site.domain) ? { history: historyByDomain.get(site.domain) } : {}),
        actionStrategies: [...site.actionStrategies].sort((left, right) =>
          right.lastSeenAt - left.lastSeenAt
          || right.support - left.support
          || right.confidence - left.confidence),
        behaviors: [...site.behaviors].sort((left, right) =>
          right.lastSeenAt - left.lastSeenAt
          || right.support - left.support
          || right.confidence - left.confidence),
        siteSkills: [...site.siteSkills].sort((left, right) =>
          right.lastSeenAt - left.lastSeenAt
          || right.support - left.support
          || right.confidence - left.confidence),
      }))
      .sort((left, right) =>
        right.lastSeenAt - left.lastSeenAt
        || right.totalSupport - left.totalSupport
        || left.domain.localeCompare(right.domain));
    const catalogStyleProfiles = scopedStyleProfiles
      .map((profile) => toStyleProfileSummary(profile))
      .sort((left, right) =>
        right.lastUpdatedAt - left.lastUpdatedAt
        || right.confidence - left.confidence
        || right.exemplarCount - left.exemplarCount);
    const catalogPreferenceProfiles = preferenceProfiles
      .map((profile) => toPreferenceProfileSummary(profile))
      .sort((left, right) =>
        right.lastUpdatedAt - left.lastUpdatedAt
        || right.signals.length - left.signals.length);

    const lastUpdatedAt = [
      ...scopedEvents.map((event) => event.ts),
      ...scopedPageSnapshots.map((snapshot) => snapshot.ts),
      ...scopedEpisodes.map((episode) => episode.endedAt),
      ...scopedGuidances.map((guidance) => guidance.lastSeenAt),
      ...scopedSiteSkills.map((skill) => skill.lastSeenAt),
      ...scopedFeedbackRecords.map((record) => record.ts),
      ...historyProfiles.map((profile) => profile.lastUpdatedAt),
      ...writingSamples.map((sample) => sample.ts),
      ...styleProfiles.map((profile) => profile.lastUpdatedAt),
      ...preferenceProfiles.map((profile) => profile.lastUpdatedAt),
      ...historySites.map((site) => site.lastVisitedAt),
      ...extractionRecipes
        .filter((recipe) => !isBlacklistedRecord(recipe, blacklistDomains))
        .map((recipe) => recipe.lastSeenAt),
    ]
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      .sort((left, right) => right - left)[0];

    const defaultTaskStatus: LearningTaskStatus = {
      state: preferences.mode === "on" ? "idle" : "paused",
      mode: preferences.mode,
      ...(preferences.mode === "off" ? { pauseReason: "manual" as const } : {}),
      observerCount: 0,
      activeWorkflowCount: activeProgress.filter((entry) => entry.mode === "observe_workflow").length,
      activeWritingCount: activeProgress.filter((entry) => entry.mode === "learn_writing_style").length,
      queuedGuidanceRefinementCount: 0,
      runningGuidanceRefinementCount: 0,
      queuedHistoryProfileRefinementCount: 0,
      runningHistoryProfileRefinementCount: 0,
      queuedStyleProfileRefinementCount: 0,
      runningStyleProfileRefinementCount: 0,
      activeDomains: uniqueStrings(activeProgress.map((entry) => entry.domain), 8),
    };

    return {
      rawEventCount: scopedEvents.length,
      pendingEventCount: getPendingEventCount(undefined, blacklistDomains),
      pageSnapshotCount: scopedPageSnapshots.length,
      observationCount: scopedEpisodes.length,
      episodeCount: scopedEpisodes.length,
      actionStrategyCount: scopedGuidances.length,
      guidanceCount: scopedGuidances.length,
      siteSkillCount: scopedSiteSkills.length,
      feedbackCount: scopedFeedbackRecords.length,
      styleProfileCount: scopedStyleProfiles.length,
      preferenceProfileCount: preferenceProfiles.length,
      historyRecordCount,
      historySiteCount: historySites.length,
      historyVisitCount,
      historyTopSites: historySites,
      styleProfiles: catalogStyleProfiles,
      preferenceProfiles: catalogPreferenceProfiles,
      siteCount: sites.length,
      sites,
      activeProgress,
      taskStatus: defaultTaskStatus,
      ...(lastUpdatedAt !== undefined ? { lastUpdatedAt } : {}),
    };
  }

  function getAllGuidanceIds() {
    flushOpenEpisodes({ maxEventCount: DEFERRED_LEARNING_EVENT_BATCH_SIZE });
    pruneState();
    return guidances.map((guidance) => guidance.guidanceId);
  }

  function getGuidanceRefinementContext(guidanceId: string) {
    flushOpenEpisodes({ maxEventCount: DEFERRED_LEARNING_EVENT_BATCH_SIZE });
    pruneState();

    const normalizedGuidanceId = guidanceId.trim();
    if (!normalizedGuidanceId) {
      return null;
    }

    const guidance = guidances.find((entry) => entry.guidanceId === normalizedGuidanceId);
    if (!guidance) {
      return null;
    }

    const relatedEpisodes = episodes
      .filter((episode) =>
        buildGuidanceKey(episode) === buildGuidanceKeyFromGuidance(guidance))
      .map((episode) => ({
        ...episode,
        topTargets: [...episode.topTargets],
        inputTargets: [...episode.inputTargets],
        clickTargets: [...episode.clickTargets],
        sequence: [...episode.sequence],
        keywords: [...episode.keywords],
      }));

    return {
      guidance: {
        ...guidance,
        keywords: [...guidance.keywords],
        inputTargets: [...guidance.inputTargets],
        clickTargets: [...guidance.clickTargets],
        preferredTargets: [...guidance.preferredTargets],
        recommendedSteps: [...guidance.recommendedSteps],
        toolOrder: [...guidance.toolOrder],
        recoveryHints: [...guidance.recoveryHints],
        cautionNotes: [...guidance.cautionNotes],
        sampleSequence: [...guidance.sampleSequence],
      },
      episodes: relatedEpisodes,
    };
  }

  function applyGuidanceRefinement(input: {
    guidanceId: string;
    refinement: LearningGuidanceRefinement;
  }) {
    const normalizedGuidanceId = input.guidanceId.trim();
    if (!normalizedGuidanceId) {
      return { success: false };
    }

    const guidance = guidances.find((entry) => entry.guidanceId === normalizedGuidanceId);
    if (!guidance) {
      return { success: false };
    }

    let changed = false;
    const nextGoalSummary = input.refinement.goalSummary?.trim();
    if (nextGoalSummary && nextGoalSummary !== guidance.goalSummary) {
      guidance.goalSummary = truncateText(nextGoalSummary, 200);
      changed = true;
    }

    const nextKeywords = sanitizeGuidanceTextList(input.refinement.keywords ?? [], 12, 48);
    if (nextKeywords.length > 0 && nextKeywords.join("\u0000") !== guidance.keywords.join("\u0000")) {
      guidance.keywords = nextKeywords;
      changed = true;
    }

    const nextInputTargets = sanitizeGuidanceTextList(input.refinement.inputTargets ?? [], 6, 80);
    if (nextInputTargets.length > 0 && nextInputTargets.join("\u0000") !== guidance.inputTargets.join("\u0000")) {
      guidance.inputTargets = nextInputTargets;
      changed = true;
    }

    const nextClickTargets = sanitizeGuidanceTextList(input.refinement.clickTargets ?? [], 6, 80);
    if (nextClickTargets.length > 0 && nextClickTargets.join("\u0000") !== guidance.clickTargets.join("\u0000")) {
      guidance.clickTargets = nextClickTargets;
      changed = true;
    }

    const nextPreferredTargets = sanitizeGuidanceTextList(input.refinement.preferredTargets ?? [], 6, 80);
    if (
      nextPreferredTargets.length > 0
      && nextPreferredTargets.join("\u0000") !== guidance.preferredTargets.join("\u0000")
    ) {
      guidance.preferredTargets = nextPreferredTargets;
      changed = true;
    }

    const nextRecommendedSteps = sanitizeGuidanceTextList(input.refinement.recommendedSteps ?? [], 5, 180);
    if (
      nextRecommendedSteps.length > 0
      && nextRecommendedSteps.join("\u0000") !== guidance.recommendedSteps.join("\u0000")
    ) {
      guidance.recommendedSteps = nextRecommendedSteps;
      changed = true;
    }

    const nextToolOrder = sanitizeToolOrder(input.refinement.toolOrder ?? []);
    if (nextToolOrder.length > 0 && nextToolOrder.join("\u0000") !== guidance.toolOrder.join("\u0000")) {
      guidance.toolOrder = nextToolOrder;
      changed = true;
    }

    const nextRecoveryHints = sanitizeGuidanceTextList(input.refinement.recoveryHints ?? [], 3, 180);
    if (nextRecoveryHints.length > 0 && nextRecoveryHints.join("\u0000") !== guidance.recoveryHints.join("\u0000")) {
      guidance.recoveryHints = nextRecoveryHints;
      changed = true;
    }

    const nextCautionNotes = sanitizeGuidanceTextList(input.refinement.cautionNotes ?? [], 3, 180);
    if (nextCautionNotes.length > 0 && nextCautionNotes.join("\u0000") !== guidance.cautionNotes.join("\u0000")) {
      guidance.cautionNotes = nextCautionNotes;
      changed = true;
    }

    if (changed) {
      flush();
      return { success: true };
    }

    return { success: false };
  }

  function shutdown() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    flush({ reschedule: false });
  }

  load();

  return {
    ingestEvents,
    recordPageSnapshot,
    recordWritingSamples,
    recordExtractionObservation,
    applyPreferencesChanged,
    resolveInputAssistContext,
    buildPromptContext,
    flushOpenEpisodes,
    clear,
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
    exportState,
    getSummary,
    getCatalog,
    searchGuidance,
    searchExtractionRecipes,
    getGuidanceDetail,
    getPendingEpisodeLearningIds,
    markEpisodeLearningDeferred,
    getEpisodeLearningContext,
    applyEpisodeLearningResult,
    getPendingHistoryProfileKeys,
    markHistoryProfileLearningDeferred,
    getHistoryProfileLearningContext,
    applyHistoryProfile,
    getAllGuidanceIds,
    getPendingStyleProfileGroupKeys,
    getAllStyleProfileGroupKeys,
    markStyleProfileLearningDeferred,
    getGuidanceRefinementContext,
    applyGuidanceRefinement,
    getStyleProfileRefinementContext,
    applyStyleProfile,
    learnNow,
    flush,
    shutdown,
  };
}
