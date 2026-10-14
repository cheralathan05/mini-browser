import {
  normalizeLanguageSetting,
  type LanguageSetting,
  type SupportedLocale,
} from "@/lib/i18n";

export const SETTINGS_STORAGE_KEY = "milo.settings.v1";

export type ThemeSetting = "system" | "light" | "dark";
export type SearchEngineSetting = "google" | "bing" | "duckduckgo";
export type TranslationProvider = "openai-compatible" | "google-basic" | "google-system" | "baidu-standard";
export type TranslationTargetLanguage = "system" | SupportedLocale;
export type LearningMode = "off" | "on";
const DEFAULT_AGENT_BASE_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_INTERLEAVED_THINKING_FIELD_NAME = "reasoning_content";
const DEFAULT_TRANSLATION_SYSTEM_ENDPOINT = "https://translate.googleapis.com/translate_a/single";
const DEFAULT_LLM_PROVIDER_ID = "default-provider";
const DEFAULT_LLM_PROVIDER_NAME = "Default Provider";
const LEGACY_IMAGE_AGENT_PROVIDER_ID = "image-agent-provider";
const MIN_TRANSLATION_REQUEST_CONCURRENCY = 1;
const MAX_TRANSLATION_REQUEST_CONCURRENCY = 8;

export interface LlmProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  modelsText: string;
  extraBodyEnabled: boolean;
  extraBodyText: string;
  extraHeadersEnabled: boolean;
  extraHeadersText: string;
  extractThinkingContent: boolean;
  thinkingContentTagName: string;
  interleavedThinkingEnabled: boolean;
  interleavedThinkingFieldName: string;
  modelSettings: Record<string, LlmProviderModelSettings>;
}

export interface LlmProviderModelSettings {
  extraBodyEnabled: boolean;
  extraBodyText: string;
  extraHeadersEnabled: boolean;
  extraHeadersText: string;
  extractThinkingContent: boolean;
  thinkingContentTagName: string;
  interleavedThinkingEnabled: boolean;
  interleavedThinkingFieldName: string;
}

export interface AgentModelPreferences {
  providerId: string;
  model: string;
}

export interface AgentPreferences extends AgentModelPreferences {
  mcpToolExportEnabled: boolean;
  profileInstructions: string;
  interactionBlacklistDomains: string[];
}

export interface LearningPreferences extends AgentModelPreferences {
  mode: LearningMode;
  redactTextInput: boolean;
  retentionDays: number;
  blacklistDomains: string[];
}

export interface SettingsState {
  restoreSession: boolean;
  searchEngine: SearchEngineSetting;
  newTabUrl: string;
  downloadDefaultDirectory: string;
  downloadThreadCount: number;
  downloadHeadersText: string;
  llmProviders: LlmProvider[];
  agentProviderId: string;
  agentModel: string;
  agentMcpToolExportEnabled: boolean;
  agentProfileInstructions: string;
  agentInteractionBlacklistDomainsText: string;
  imageAgentProviderId: string;
  imageAgentModel: string;
  learningMode: LearningMode;
  learningProviderId: string;
  learningModel: string;
  learningRedactTextInput: boolean;
  learningRetentionDays: number;
  learningBlacklistDomainsText: string;
  translationProvider: TranslationProvider;
  translationOpenAIProviderId: string;
  translationOpenAIModel: string;
  translationGoogleEndpoint: string;
  translationGoogleApiKey: string;
  translationBaiduEndpoint: string;
  translationBaiduAppId: string;
  translationBaiduApiKey: string;
  translationTargetLanguage: TranslationTargetLanguage;
  translationRequestConcurrency: number;
  doNotTrack: boolean;
  blockThirdPartyCookies: boolean;
  theme: ThemeSetting;
  language: LanguageSetting;
  compactTabs: boolean;
  showBookmarksSection: boolean;
  debugHints: boolean;
  allowInsecureCerts: boolean;
}

export type SettingsKey = keyof SettingsState;

type BrowserShellAPI = NonNullable<Window["browserShell"]>;

export type DownloadPreferences = Awaited<
  ReturnType<BrowserShellAPI["downloadsGetPreferences"]>
>;

export type TranslationPreferences = Awaited<
  ReturnType<BrowserShellAPI["translationGetPreferences"]>
>;

export type PersistedLlmProviders = Awaited<
  ReturnType<BrowserShellAPI["llmGetProviders"]>
>;

export type PersistedAgentPreferences = Awaited<
  ReturnType<BrowserShellAPI["agentGetPreferences"]>
>;

export type PersistedImageAgentPreferences = Awaited<
  ReturnType<BrowserShellAPI["imageAgentGetPreferences"]>
>;

export type PersistedLearningPreferences = Awaited<
  ReturnType<BrowserShellAPI["learningGetPreferences"]>
>;

export type LearningSummary = Awaited<
  ReturnType<BrowserShellAPI["learningGetSummary"]>
>;

export type LearningCatalog = Awaited<
  ReturnType<BrowserShellAPI["learningGetCatalog"]>
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readFiniteNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readOptionalFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNonEmptyString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => entry.trim())
    : [];
}

function normalizeLearningHistoryPage(
  value: unknown,
): LearningSummary["topHistorySites"][number]["topPages"][number] | null {
  if (!isRecord(value)) {
    return null;
  }

  const url = readNonEmptyString(value.url);
  const title = readNonEmptyString(value.title, url);
  const lastVisitedAt = readFiniteNumber(value.lastVisitedAt);
  if (!url || !title || !Number.isFinite(lastVisitedAt)) {
    return null;
  }

  return {
    url,
    title,
    visitCount: readFiniteNumber(value.visitCount, 1),
    lastVisitedAt,
  };
}

function normalizeLearningHistorySite(
  value: unknown,
): LearningSummary["topHistorySites"][number] | null {
  if (!isRecord(value)) {
    return null;
  }

  const siteId = readNonEmptyString(value.siteId);
  const domain = readNonEmptyString(value.domain);
  const lastVisitedAt = readFiniteNumber(value.lastVisitedAt);
  if (!siteId || !domain || !Number.isFinite(lastVisitedAt)) {
    return null;
  }

  return {
    siteId,
    domain,
    visitCount: readFiniteNumber(value.visitCount),
    uniquePageCount: readFiniteNumber(value.uniquePageCount),
    observedDayCount: readFiniteNumber(value.observedDayCount),
    firstSeenAt: readFiniteNumber(value.firstSeenAt, lastVisitedAt),
    lastVisitedAt,
    ...(readNonEmptyString(value.activityLevel)
      ? { activityLevel: readNonEmptyString(value.activityLevel) as LearningSummary["topHistorySites"][number]["activityLevel"] }
      : {}),
    ...(readNonEmptyString(value.revisitPattern)
      ? { revisitPattern: readNonEmptyString(value.revisitPattern) as LearningSummary["topHistorySites"][number]["revisitPattern"] }
      : {}),
    topPages: Array.isArray(value.topPages)
      ? value.topPages
        .map((entry) => normalizeLearningHistoryPage(entry))
        .filter((entry): entry is LearningSummary["topHistorySites"][number]["topPages"][number] => entry !== null)
      : [],
    ...(readNonEmptyString(value.profileSummary)
      ? { profileSummary: readNonEmptyString(value.profileSummary) }
      : {}),
    commonIntents: readStringArray(value.commonIntents),
    revisitDrivers: readStringArray(value.revisitDrivers),
    ...(readOptionalFiniteNumber(value.confidence) !== undefined
      ? { confidence: readOptionalFiniteNumber(value.confidence) }
      : {}),
  };
}

function normalizeLearningProgressItem(
  value: unknown,
): LearningCatalog["activeProgress"][number] | null {
  if (!isRecord(value)) {
    return null;
  }

  const progressId = readNonEmptyString(value.progressId);
  const workspaceId = readNonEmptyString(value.workspaceId);
  const domain = readNonEmptyString(value.domain);
  const updatedAt = readFiniteNumber(value.updatedAt);
  const mode = readNonEmptyString(value.mode);
  if (!progressId || !workspaceId || !domain || !Number.isFinite(updatedAt)) {
    return null;
  }
  if (mode !== "observe_workflow" && mode !== "learn_writing_style") {
    return null;
  }

  const methods = Array.isArray(value.methods)
    ? value.methods
      .filter((entry): entry is LearningCatalog["activeProgress"][number]["methods"][number] =>
        entry === "input"
        || entry === "click"
        || entry === "scroll"
        || entry === "navigation"
        || entry === "dialog"
        || entry === "download"
        || entry === "typing")
    : [];

  const contextType = readNonEmptyString(value.contextType);
  const slot = readNonEmptyString(value.slot);

  return {
    progressId,
    mode,
    workspaceId,
    domain,
    ...(readNonEmptyString(value.url) ? { url: readNonEmptyString(value.url) } : {}),
    ...(readNonEmptyString(value.pageTitle) ? { pageTitle: readNonEmptyString(value.pageTitle) } : {}),
    ...(readNonEmptyString(value.pageType) ? { pageType: readNonEmptyString(value.pageType) } : {}),
    updatedAt,
    eventCount: readFiniteNumber(value.eventCount, 0),
    methods,
    ...(readNonEmptyString(value.latestEventKind) ? { latestEventKind: readNonEmptyString(value.latestEventKind) } : {}),
    ...(readNonEmptyString(value.latestEventSummary)
      ? { latestEventSummary: readNonEmptyString(value.latestEventSummary) }
      : {}),
    ...(readNonEmptyString(value.targetSummary) ? { targetSummary: readNonEmptyString(value.targetSummary) } : {}),
    ...(readNonEmptyString(value.contentPreview) ? { contentPreview: readNonEmptyString(value.contentPreview) } : {}),
    ...(contextType ? { contextType: contextType as LearningCatalog["activeProgress"][number]["contextType"] } : {}),
    ...(slot ? { slot: slot as LearningCatalog["activeProgress"][number]["slot"] } : {}),
    ...(readNonEmptyString(value.fieldHint) ? { fieldHint: readNonEmptyString(value.fieldHint) } : {}),
    ...(readNonEmptyString(value.recipientLabel) ? { recipientLabel: readNonEmptyString(value.recipientLabel) } : {}),
    ...(readOptionalFiniteNumber(value.charCount) !== undefined
      ? { charCount: readOptionalFiniteNumber(value.charCount) }
      : {}),
    ...(readOptionalFiniteNumber(value.wordCount) !== undefined
      ? { wordCount: readOptionalFiniteNumber(value.wordCount) }
      : {}),
  };
}

function normalizeLearningStyleProfile(
  value: unknown,
): LearningCatalog["styleProfiles"][number] | null {
  if (!isRecord(value)) {
    return null;
  }

  const profileId = readNonEmptyString(value.profileId);
  const lastUpdatedAt = readFiniteNumber(value.lastUpdatedAt);
  if (!profileId || !Number.isFinite(lastUpdatedAt)) {
    return null;
  }

  const contextType = readNonEmptyString(value.contextType);
  const slot = readNonEmptyString(value.slot);

  return {
    profileId,
    ...(readNonEmptyString(value.domain) ? { domain: readNonEmptyString(value.domain) } : {}),
    ...(readNonEmptyString(value.scheme) ? { scheme: readNonEmptyString(value.scheme) } : {}),
    ...(readNonEmptyString(value.pageType) ? { pageType: readNonEmptyString(value.pageType) } : {}),
    ...(contextType ? { contextType: contextType as LearningCatalog["styleProfiles"][number]["contextType"] } : {}),
    ...(readNonEmptyString(value.contextLabel) ? { contextLabel: readNonEmptyString(value.contextLabel) } : {}),
    ...(slot ? { slot: slot as LearningCatalog["styleProfiles"][number]["slot"] } : {}),
    ...(readNonEmptyString(value.slotLabel) ? { slotLabel: readNonEmptyString(value.slotLabel) } : {}),
    ...(readNonEmptyString(value.fieldHint) ? { fieldHint: readNonEmptyString(value.fieldHint) } : {}),
    ...(readNonEmptyString(value.recipientKey) ? { recipientKey: readNonEmptyString(value.recipientKey) } : {}),
    ...(readNonEmptyString(value.recipientLabel) ? { recipientLabel: readNonEmptyString(value.recipientLabel) } : {}),
    ...(readNonEmptyString(value.tone) ? { tone: readNonEmptyString(value.tone) } : {}),
    ...(readNonEmptyString(value.formality) ? { formality: readNonEmptyString(value.formality) } : {}),
    ...(readNonEmptyString(value.searchStyle) ? { searchStyle: readNonEmptyString(value.searchStyle) } : {}),
    ...(readNonEmptyString(value.emailStyle) ? { emailStyle: readNonEmptyString(value.emailStyle) } : {}),
    ...(readNonEmptyString(value.forumStyle) ? { forumStyle: readNonEmptyString(value.forumStyle) } : {}),
    ...(readNonEmptyString(value.articleStyle) ? { articleStyle: readNonEmptyString(value.articleStyle) } : {}),
    ...(readNonEmptyString(value.notesStyle) ? { notesStyle: readNonEmptyString(value.notesStyle) } : {}),
    ...(readNonEmptyString(value.styleSummary) ? { styleSummary: readNonEmptyString(value.styleSummary) } : {}),
    commonPhrases: readStringArray(value.commonPhrases),
    exemplarSnippets: readStringArray(value.exemplarSnippets),
    exemplarCount: readFiniteNumber(value.exemplarCount),
    averageLength: readFiniteNumber(value.averageLength),
    confidence: readFiniteNumber(value.confidence),
    lastUpdatedAt,
  };
}

function normalizeLearningPreferenceProfile(
  value: unknown,
): LearningCatalog["preferenceProfiles"][number] | null {
  if (!isRecord(value)) {
    return null;
  }

  const profileId = readNonEmptyString(value.profileId);
  const lastUpdatedAt = readFiniteNumber(value.lastUpdatedAt);
  if (!profileId || !Number.isFinite(lastUpdatedAt)) {
    return null;
  }

  const signals = Array.isArray(value.signals)
    ? value.signals.flatMap((entry) => {
      if (!isRecord(entry)) {
        return [];
      }
      const key = readNonEmptyString(entry.key);
      const valueText = readNonEmptyString(entry.value);
      const source = readNonEmptyString(entry.source);
      const updatedAt = readFiniteNumber(entry.updatedAt, lastUpdatedAt);
      if (!key || !valueText || !updatedAt) {
        return [];
      }
      if (
        source !== "explicit"
        && source !== "observed"
        && source !== "manual"
        && source !== "agent_interaction"
        && source !== "browsing_history"
        && source !== "workflow_learning"
        && source !== "writing_style"
      ) {
        return [];
      }

      return [{
        ...(readNonEmptyString(entry.id) ? { id: readNonEmptyString(entry.id) } : {}),
        key,
        value: valueText,
        ...(readNonEmptyString(entry.category) ? {
          category: readNonEmptyString(entry.category) as LearningCatalog["preferenceProfiles"][number]["signals"][number]["category"],
        } : {}),
        confidence: readFiniteNumber(entry.confidence),
        source: source as LearningCatalog["preferenceProfiles"][number]["signals"][number]["source"],
        ...(readOptionalFiniteNumber(entry.strength) !== undefined ? { strength: readOptionalFiniteNumber(entry.strength) } : {}),
        evidenceRefs: readStringArray(entry.evidenceRefs),
        ...(readNonEmptyString(entry.scope) ? {
          scope: readNonEmptyString(entry.scope) as LearningCatalog["preferenceProfiles"][number]["signals"][number]["scope"],
        } : {}),
        ...(readNonEmptyString(entry.domain) ? { domain: readNonEmptyString(entry.domain) } : {}),
        ...(readOptionalFiniteNumber(entry.createdAt) !== undefined ? { createdAt: readOptionalFiniteNumber(entry.createdAt) } : {}),
        ...(readOptionalFiniteNumber(entry.lastSeenAt) !== undefined ? { lastSeenAt: readOptionalFiniteNumber(entry.lastSeenAt) } : {}),
        ...(readOptionalFiniteNumber(entry.expiresAt) !== undefined ? { expiresAt: readOptionalFiniteNumber(entry.expiresAt) } : {}),
        ...(readNonEmptyString(entry.status) ? {
          status: readNonEmptyString(entry.status) as LearningCatalog["preferenceProfiles"][number]["signals"][number]["status"],
        } : {}),
        updatedAt,
      }];
    })
    : [];

  return {
    profileId,
    signals,
    lastUpdatedAt,
  };
}

function normalizeLearningTaskStatus(
  value: unknown,
  fallbackMode: "off" | "on",
): LearningCatalog["taskStatus"] {
  if (!isRecord(value)) {
    return {
      state: fallbackMode === "on" ? "idle" : "paused",
      mode: fallbackMode,
      ...(fallbackMode === "off" ? { pauseReason: "manual" as const } : {}),
      observerCount: 0,
      activeWorkflowCount: 0,
      activeWritingCount: 0,
      queuedGuidanceRefinementCount: 0,
      runningGuidanceRefinementCount: 0,
      queuedHistoryProfileRefinementCount: 0,
      runningHistoryProfileRefinementCount: 0,
      queuedStyleProfileRefinementCount: 0,
      runningStyleProfileRefinementCount: 0,
      activeDomains: [],
    };
  }

  const state = readNonEmptyString(value.state, fallbackMode === "on" ? "idle" : "paused");
  const mode = readNonEmptyString(value.mode, fallbackMode);
  const pauseReason = readNonEmptyString(value.pauseReason);
  const pauseStage = readNonEmptyString(value.pauseStage);

  return {
    state: (state === "idle" || state === "running" || state === "paused" || state === "error_paused"
      ? state
      : (fallbackMode === "on" ? "idle" : "paused")) as LearningCatalog["taskStatus"]["state"],
    mode: (mode === "off" ? "off" : "on") as LearningCatalog["taskStatus"]["mode"],
    ...(pauseReason === "manual" || pauseReason === "llm_error"
      ? { pauseReason: pauseReason as LearningCatalog["taskStatus"]["pauseReason"] }
      : {}),
    ...(pauseStage === "episode_learning"
      || pauseStage === "history_profile_refinement"
      || pauseStage === "guidance_refinement"
      || pauseStage === "style_profile_refinement"
      ? { pauseStage: pauseStage as LearningCatalog["taskStatus"]["pauseStage"] }
      : {}),
    ...(readNonEmptyString(value.pauseMessage) ? { pauseMessage: readNonEmptyString(value.pauseMessage) } : {}),
    ...(readOptionalFiniteNumber(value.pauseAt) !== undefined
      ? { pauseAt: readOptionalFiniteNumber(value.pauseAt) }
      : {}),
    observerCount: readFiniteNumber(value.observerCount),
    activeWorkflowCount: readFiniteNumber(value.activeWorkflowCount),
    activeWritingCount: readFiniteNumber(value.activeWritingCount),
    queuedGuidanceRefinementCount: readFiniteNumber(value.queuedGuidanceRefinementCount),
    runningGuidanceRefinementCount: readFiniteNumber(value.runningGuidanceRefinementCount),
    queuedHistoryProfileRefinementCount: readFiniteNumber(value.queuedHistoryProfileRefinementCount),
    runningHistoryProfileRefinementCount: readFiniteNumber(value.runningHistoryProfileRefinementCount),
    queuedStyleProfileRefinementCount: readFiniteNumber(value.queuedStyleProfileRefinementCount),
    runningStyleProfileRefinementCount: readFiniteNumber(value.runningStyleProfileRefinementCount),
    activeDomains: readStringArray(value.activeDomains),
  };
}

export const DEFAULT_SETTINGS: SettingsState = {
  restoreSession: true,
  searchEngine: "google",
  newTabUrl: "milo://home",
  downloadDefaultDirectory: "",
  downloadThreadCount: 4,
  downloadHeadersText: "",
  llmProviders: [{
    id: DEFAULT_LLM_PROVIDER_ID,
    name: DEFAULT_LLM_PROVIDER_NAME,
    baseUrl: DEFAULT_AGENT_BASE_URL,
    apiKey: "",
    modelsText: "",
    extraBodyEnabled: false,
    extraBodyText: "",
    extraHeadersEnabled: false,
    extraHeadersText: "",
    extractThinkingContent: false,
    thinkingContentTagName: "think",
    interleavedThinkingEnabled: false,
    interleavedThinkingFieldName: DEFAULT_INTERLEAVED_THINKING_FIELD_NAME,
    modelSettings: {},
  }],
  agentProviderId: DEFAULT_LLM_PROVIDER_ID,
  agentModel: "",
  agentMcpToolExportEnabled: false,
  agentProfileInstructions: "",
  agentInteractionBlacklistDomainsText: "",
  imageAgentProviderId: DEFAULT_LLM_PROVIDER_ID,
  imageAgentModel: "",
  learningMode: "on",
  learningProviderId: DEFAULT_LLM_PROVIDER_ID,
  learningModel: "",
  learningRedactTextInput: true,
  learningRetentionDays: 30,
  learningBlacklistDomainsText: "",
  translationProvider: "google-system",
  translationOpenAIProviderId: DEFAULT_LLM_PROVIDER_ID,
  translationOpenAIModel: "",
  translationGoogleEndpoint: "https://translation.googleapis.com/language/translate/v2",
  translationGoogleApiKey: "",
  translationBaiduEndpoint: "https://fanyi-api.baidu.com/api/trans/vip/translate",
  translationBaiduAppId: "",
  translationBaiduApiKey: "",
  translationTargetLanguage: "system",
  translationRequestConcurrency: 6,
  doNotTrack: false,
  blockThirdPartyCookies: true,
  theme: "system",
  language: "system",
  compactTabs: false,
  showBookmarksSection: true,
  debugHints: false,
  allowInsecureCerts: false,
};

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeSearchEngineSetting(value: unknown): SearchEngineSetting {
  return value === "bing" || value === "duckduckgo" || value === "google"
    ? value
    : DEFAULT_SETTINGS.searchEngine;
}

export function normalizeThemeSetting(value: unknown): ThemeSetting {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : DEFAULT_SETTINGS.theme;
}

function normalizeLanguage(value: unknown): LanguageSetting {
  return normalizeLanguageSetting(value);
}

function normalizeDownloadThreadCount(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SETTINGS.downloadThreadCount;
  }
  return Math.min(16, Math.max(1, parsed));
}

function normalizeDownloadHeadersText(value: unknown) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function normalizeTranslationProvider(value: unknown): TranslationProvider {
  return (
    value === "google-basic"
    || value === "google-system"
    || value === "baidu-standard"
    || value === "openai-compatible"
  )
    ? value
    : DEFAULT_SETTINGS.translationProvider;
}

function normalizeTranslationTargetLanguage(value: unknown): TranslationTargetLanguage {
  const normalized = normalizeLanguageSetting(value);
  return normalized === "en-US" || normalized === "zh-CN" ? normalized : "system";
}

function normalizeTranslationRequestConcurrency(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SETTINGS.translationRequestConcurrency;
  }

  return Math.min(MAX_TRANSLATION_REQUEST_CONCURRENCY, Math.max(MIN_TRANSLATION_REQUEST_CONCURRENCY, parsed));
}

function normalizeLearningMode(value: unknown): LearningMode {
  if (value === "off") {
    return "off";
  }
  if (value === "on" || value === "observe" || value === "observe_and_adapt") {
    return "on";
  }
  return DEFAULT_SETTINGS.learningMode;
}

function normalizeLearningRetentionDays(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SETTINGS.learningRetentionDays;
  }
  return Math.min(365, Math.max(1, parsed));
}

function normalizeLearningBlacklistDomain(value: string) {
  let normalized = value.trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  if (normalized.startsWith("*.")) {
    normalized = normalized.slice(2);
  }

  if (normalized.includes("://")) {
    try {
      normalized = new URL(normalized).hostname.toLowerCase();
    } catch {
      // Keep the original value and continue best-effort cleanup below.
    }
  }

  normalized = normalized.split(/[/?#]/, 1)[0] ?? normalized;
  normalized = normalized.replace(/:\d+$/, "");
  normalized = normalized.replace(/^\.+|\.+$/g, "");
  return normalized;
}

function normalizeLearningBlacklistDomainsText(value: unknown) {
  const normalizedDomains = String(value ?? "")
    .split(/[\n,，;]/)
    .map((entry) => normalizeLearningBlacklistDomain(entry))
    .filter(Boolean);

  return Array.from(new Set(normalizedDomains)).join("\n");
}

function normalizeLearningAssignment(
  providerId: unknown,
  model: unknown,
  providers: LlmProvider[],
  fallback: AgentModelPreferences,
): AgentModelPreferences {
  const preferredProviderId = normalizeTrimmedString(providerId);
  const resolvedProviderId = preferredProviderId && providers.some((provider) => provider.id === preferredProviderId)
    ? preferredProviderId
    : fallback.providerId;
  const normalizedModel = normalizeTrimmedString(model);

  return {
    providerId: resolvedProviderId,
    model: normalizedModel || (resolvedProviderId === fallback.providerId ? fallback.model : ""),
  };
}

function parseDomainBlacklistText(value: string) {
  const normalized = normalizeLearningBlacklistDomainsText(value);
  return normalized ? normalized.split("\n") : [];
}

function normalizeNonEmptyString(value: unknown, fallback: string) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function normalizeTrimmedString(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeLlmProviderModelsText(value: unknown) {
  const entries = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,，;]/)
      : [];

  const normalizedModels: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") {
      continue;
    }

    const normalized = normalizeTrimmedString(entry);
    if (!normalized || normalizedModels.includes(normalized)) {
      continue;
    }

    normalizedModels.push(normalized);
  }

  return normalizedModels.join("\n");
}

function normalizeJsonConfigValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeJsonConfigValue(entry))
      .filter((entry) => entry !== undefined);
  }

  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const normalizedKey = key.trim();
      const normalizedValue = normalizeJsonConfigValue(entry);
      if (!normalizedKey || normalizedValue === undefined) {
        continue;
      }
      result[normalizedKey] = normalizedValue;
    }
    return result;
  }

  return undefined;
}

function normalizeJsonConfigObject(value: unknown) {
  const source = typeof value === "string" ? parseLlmProviderExtraBodyText(value) : value;
  const normalized = normalizeJsonConfigValue(source);
  return isRecord(normalized) ? normalized : {};
}

export function isValidLlmProviderExtraBodyText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isRecord(parsed);
  } catch {
    return false;
  }
}

function normalizeLlmProviderExtraBodyText(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return isRecord(parsed)
        ? JSON.stringify(normalizeJsonConfigObject(parsed), null, 2)
        : "";
    } catch {
      return "";
    }
  }

  if (!isRecord(value)) {
    return "";
  }

  const normalized = normalizeJsonConfigObject(value);
  return Object.keys(normalized).length > 0 ? JSON.stringify(normalized, null, 2) : "";
}

function normalizeLlmProviderExtraHeadersText(value: unknown) {
  const entries = typeof value === "string"
    ? value
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .flatMap((line): Array<[string, unknown]> => {
          const delimiter = line.indexOf(":");
          return delimiter > 0 ? [[line.slice(0, delimiter), line.slice(delimiter + 1)]] : [];
        })
    : isRecord(value)
      ? Object.entries(value)
      : [];

  const headers: string[] = [];
  const seenHeaders = new Set<string>();
  for (const [key, rawValue] of entries) {
    const normalizedKey = key.trim();
    const normalizedValue = String(rawValue ?? "").trim();
    const headerKey = normalizedKey.toLowerCase();
    if (!normalizedKey || !normalizedValue || seenHeaders.has(headerKey)) {
      continue;
    }

    seenHeaders.add(headerKey);
    headers.push(`${normalizedKey}: ${normalizedValue}`);
  }

  return headers.join("\n");
}

function normalizeExtraConfigEnabled(value: unknown, normalizedText: string) {
  return typeof value === "boolean" ? value : normalizedText.trim().length > 0;
}

function normalizeExtractThinkingContent(value: unknown) {
  return value === true;
}

function normalizeThinkingContentTagName(value: unknown) {
  const rawValue = typeof value === "string" ? value.trim() : "";
  if (!rawValue) {
    return "think";
  }

  const tagMatch = rawValue.match(/^<\s*\/?\s*([A-Za-z][A-Za-z0-9:_-]*)\b[^>]*>$/);
  const normalized = (tagMatch?.[1] ?? rawValue)
    .replace(/^<+|>+$/g, "")
    .replace(/^\/+/, "")
    .trim();
  const bareTagMatch = normalized.match(/^[A-Za-z][A-Za-z0-9:_-]*$/);
  return bareTagMatch ? normalized : "think";
}

function normalizeInterleavedThinkingEnabled(value: unknown) {
  return value === true;
}

function normalizeInterleavedThinkingFieldName(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || !/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(normalized)) {
    return DEFAULT_INTERLEAVED_THINKING_FIELD_NAME;
  }

  const reservedFields = new Set([
    "content",
    "role",
    "tool_calls",
    "tool_call_id",
    "toolCalls",
  ]);
  return reservedFields.has(normalized)
    ? DEFAULT_INTERLEAVED_THINKING_FIELD_NAME
    : normalized;
}

function parseLlmProviderModelsText(value: string) {
  const normalized = normalizeLlmProviderModelsText(value);
  return normalized ? normalized.split("\n") : [];
}

function parseLlmProviderExtraBodyText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return normalizeJsonConfigObject(parsed);
  } catch {
    return {};
  }
}

function parseLlmProviderExtraHeadersText(value: string) {
  const normalized = normalizeLlmProviderExtraHeadersText(value);
  const headers: Record<string, string> = {};

  for (const line of normalized.split("\n")) {
    const delimiter = line.indexOf(":");
    if (delimiter <= 0) {
      continue;
    }

    const key = line.slice(0, delimiter).trim();
    const headerValue = line.slice(delimiter + 1).trim();
    if (!key || !headerValue) {
      continue;
    }
    headers[key] = headerValue;
  }

  return headers;
}

function buildLlmProviderModelSettingsInput(provider: LlmProvider) {
  const models = parseLlmProviderModelsText(provider.modelsText);
  const result: Record<string, {
    extraBodyEnabled: boolean;
    extraBody: Record<string, unknown>;
    extraHeadersEnabled: boolean;
    extraHeaders: Record<string, string>;
    extractThinkingContent: boolean;
    thinkingContentTagName: string;
    interleavedThinkingEnabled: boolean;
    interleavedThinkingFieldName: string;
  }> = {};

  for (const model of models) {
    const settings = provider.modelSettings[model];
    if (!settings) {
      continue;
    }
    result[model] = {
      extraBodyEnabled: settings.extraBodyEnabled,
      extraBody: parseLlmProviderExtraBodyText(settings.extraBodyText),
      extraHeadersEnabled: settings.extraHeadersEnabled,
      extraHeaders: parseLlmProviderExtraHeadersText(settings.extraHeadersText),
      extractThinkingContent: settings.extractThinkingContent,
      thinkingContentTagName: settings.thinkingContentTagName,
      interleavedThinkingEnabled: settings.interleavedThinkingEnabled,
      interleavedThinkingFieldName: settings.interleavedThinkingFieldName,
    };
  }

  return result;
}

function normalizeLlmProviderModelSettings(value: unknown): LlmProviderModelSettings {
  const source = isRecord(value) ? value : {};
  const extraBodyText = normalizeLlmProviderExtraBodyText(source.extraBodyText ?? source.extraBody ?? source.extra_body);
  const extraHeadersText = normalizeLlmProviderExtraHeadersText(
    source.extraHeadersText
    ?? source.extraHeaders
    ?? source.extraHeader
    ?? source.extra_headers
    ?? source.extra_header,
  );

  return {
    extraBodyEnabled: normalizeExtraConfigEnabled(
      source.extraBodyEnabled ?? source.extra_body_enabled,
      extraBodyText,
    ),
    extraBodyText,
    extraHeadersEnabled: normalizeExtraConfigEnabled(
      source.extraHeadersEnabled
      ?? source.extraHeaderEnabled
      ?? source.extra_headers_enabled
      ?? source.extra_header_enabled,
      extraHeadersText,
    ),
    extraHeadersText,
    extractThinkingContent: normalizeExtractThinkingContent(
      source.extractThinkingContent ?? source.extract_thinking_content,
    ),
    thinkingContentTagName: normalizeThinkingContentTagName(
      source.thinkingContentTagName
      ?? source.thinking_content_tag_name
      ?? source.thinkingTagName
      ?? source.thinking_tag_name,
    ),
    interleavedThinkingEnabled: normalizeInterleavedThinkingEnabled(
      source.interleavedThinkingEnabled ?? source.interleaved_thinking_enabled,
    ),
    interleavedThinkingFieldName: normalizeInterleavedThinkingFieldName(
      source.interleavedThinkingFieldName
      ?? source.interleaved_thinking_field_name
      ?? source.thinkingFieldName
      ?? source.thinking_field_name,
    ),
  };
}

function normalizeLlmProviderModelSettingsMap(value: unknown, modelsText: string) {
  const source = isRecord(value) ? value : {};
  const configuredModels = new Set(parseLlmProviderModelsText(modelsText));
  const result: Record<string, LlmProviderModelSettings> = {};

  for (const [model, settings] of Object.entries(source)) {
    const normalizedModel = normalizeTrimmedString(model);
    if (!normalizedModel || !configuredModels.has(normalizedModel)) {
      continue;
    }
    result[normalizedModel] = normalizeLlmProviderModelSettings(settings);
  }

  return result;
}

function normalizeLlmProvider(value: unknown, fallbackName = DEFAULT_LLM_PROVIDER_NAME): LlmProvider | null {
  if (!isRecord(value)) {
    return null;
  }

  const modelsText = normalizeLlmProviderModelsText(value.modelsText ?? value.models);
  const extraBodyText = normalizeLlmProviderExtraBodyText(value.extraBodyText ?? value.extraBody ?? value.extra_body);
  const extraHeadersText = normalizeLlmProviderExtraHeadersText(
    value.extraHeadersText
    ?? value.extraHeaders
    ?? value.extraHeader
    ?? value.extra_headers
    ?? value.extra_header,
  );

  return {
    id: normalizeTrimmedString(value.id) || `provider-${Math.random().toString(36).slice(2, 10)}`,
    name: normalizeNonEmptyString(value.name, fallbackName),
    baseUrl: normalizeNonEmptyString(value.baseUrl, DEFAULT_AGENT_BASE_URL),
    apiKey: normalizeTrimmedString(value.apiKey),
    modelsText,
    extraBodyEnabled: normalizeExtraConfigEnabled(
      value.extraBodyEnabled ?? value.extra_body_enabled,
      extraBodyText,
    ),
    extraBodyText,
    extraHeadersEnabled: normalizeExtraConfigEnabled(
      value.extraHeadersEnabled
      ?? value.extraHeaderEnabled
      ?? value.extra_headers_enabled
      ?? value.extra_header_enabled,
      extraHeadersText,
    ),
    extraHeadersText,
    extractThinkingContent: normalizeExtractThinkingContent(
      value.extractThinkingContent ?? value.extract_thinking_content,
    ),
    thinkingContentTagName: normalizeThinkingContentTagName(
      value.thinkingContentTagName
      ?? value.thinking_content_tag_name
      ?? value.thinkingTagName
      ?? value.thinking_tag_name,
    ),
    interleavedThinkingEnabled: normalizeInterleavedThinkingEnabled(
      value.interleavedThinkingEnabled ?? value.interleaved_thinking_enabled,
    ),
    interleavedThinkingFieldName: normalizeInterleavedThinkingFieldName(
      value.interleavedThinkingFieldName
      ?? value.interleaved_thinking_field_name
      ?? value.thinkingFieldName
      ?? value.thinking_field_name,
    ),
    modelSettings: normalizeLlmProviderModelSettingsMap(
      value.modelSettings
      ?? value.model_configs
      ?? value.modelConfigs
      ?? value.model_settings,
      modelsText,
    ),
  };
}

function buildLlmProvidersFromLegacySettings(input: Record<string, unknown>) {
  const hasLegacyValues =
    typeof input.agentBaseUrl === "string"
    || typeof input.agentApiKey === "string"
    || typeof input.agentModel === "string"
    || typeof input.imageAgentBaseUrl === "string"
    || typeof input.imageAgentApiKey === "string"
    || typeof input.imageAgentModel === "string"
    || typeof input.translationOpenAIEndpoint === "string"
    || typeof input.translationOpenAIApiKey === "string"
    || typeof input.translationOpenAIModel === "string";
  if (!hasLegacyValues) {
    return [{
      id: DEFAULT_LLM_PROVIDER_ID,
      name: DEFAULT_LLM_PROVIDER_NAME,
      baseUrl: DEFAULT_AGENT_BASE_URL,
      apiKey: "",
      modelsText: "",
      extraBodyEnabled: false,
      extraBodyText: "",
      extraHeadersEnabled: false,
      extraHeadersText: "",
      extractThinkingContent: false,
      thinkingContentTagName: "think",
      interleavedThinkingEnabled: false,
      interleavedThinkingFieldName: DEFAULT_INTERLEAVED_THINKING_FIELD_NAME,
      modelSettings: {},
    }];
  }

  const legacyProviders = [
    {
      id: DEFAULT_LLM_PROVIDER_ID,
      name: "Agent Provider",
      baseUrl: input.agentBaseUrl,
      apiKey: input.agentApiKey,
      modelsText: input.agentModel,
      extraBodyEnabled: false,
      extraBodyText: "",
      extraHeadersEnabled: false,
      extraHeadersText: "",
      extractThinkingContent: false,
      thinkingContentTagName: "think",
      interleavedThinkingEnabled: false,
      interleavedThinkingFieldName: DEFAULT_INTERLEAVED_THINKING_FIELD_NAME,
      modelSettings: {},
    },
    {
      id: LEGACY_IMAGE_AGENT_PROVIDER_ID,
      name: "Image Agent Provider",
      baseUrl: input.imageAgentBaseUrl,
      apiKey: input.imageAgentApiKey,
      modelsText: input.imageAgentModel,
      extraBodyEnabled: false,
      extraBodyText: "",
      extraHeadersEnabled: false,
      extraHeadersText: "",
      extractThinkingContent: false,
      thinkingContentTagName: "think",
      interleavedThinkingEnabled: false,
      interleavedThinkingFieldName: DEFAULT_INTERLEAVED_THINKING_FIELD_NAME,
      modelSettings: {},
    },
    {
      id: "translation-provider",
      name: "Translation Provider",
      baseUrl: input.translationOpenAIEndpoint,
      apiKey: input.translationOpenAIApiKey,
      modelsText: input.translationOpenAIModel,
      extraBodyEnabled: false,
      extraBodyText: "",
      extraHeadersEnabled: false,
      extraHeadersText: "",
      extractThinkingContent: false,
      thinkingContentTagName: "think",
      interleavedThinkingEnabled: false,
      interleavedThinkingFieldName: DEFAULT_INTERLEAVED_THINKING_FIELD_NAME,
      modelSettings: {},
    },
  ];

  const result: LlmProvider[] = [];
  const dedupeIndexByConnection = new Map<string, number>();

  for (const provider of legacyProviders) {
    const normalized = normalizeLlmProvider(provider, provider.name);
    if (!normalized) {
      continue;
    }

    const dedupeKey = `${normalized.baseUrl}\n${normalized.apiKey}`;
    const existingIndex = dedupeIndexByConnection.get(dedupeKey);
    if (existingIndex !== undefined) {
      const current = result[existingIndex];
      if (!current) {
        continue;
      }

      const mergedModels = new Set([
        ...parseLlmProviderModelsText(current.modelsText),
        ...parseLlmProviderModelsText(normalized.modelsText),
      ]);
      current.modelsText = Array.from(mergedModels).join("\n");
      continue;
    }

    result.push(normalized);
    dedupeIndexByConnection.set(dedupeKey, result.length - 1);
  }

  return result.length > 0
    ? result
    : [{
        id: DEFAULT_LLM_PROVIDER_ID,
        name: DEFAULT_LLM_PROVIDER_NAME,
        baseUrl: DEFAULT_AGENT_BASE_URL,
        apiKey: "",
        modelsText: "",
        extraBodyEnabled: false,
        extraBodyText: "",
        extraHeadersEnabled: false,
        extraHeadersText: "",
        extractThinkingContent: false,
        thinkingContentTagName: "think",
        interleavedThinkingEnabled: false,
        interleavedThinkingFieldName: DEFAULT_INTERLEAVED_THINKING_FIELD_NAME,
        modelSettings: {},
      }];
}

function normalizeLlmProviders(value: unknown, fallbackInput?: Record<string, unknown>) {
  const entries = Array.isArray(value) ? value : [];
  const providers: LlmProvider[] = [];
  const seenIds = new Set<string>();

  for (const [index, entry] of entries.entries()) {
    const normalized = normalizeLlmProvider(
      entry,
      index === 0 ? DEFAULT_LLM_PROVIDER_NAME : `Provider ${index + 1}`,
    );
    if (!normalized) {
      continue;
    }

    if (seenIds.has(normalized.id)) {
      normalized.id = `provider-${Math.random().toString(36).slice(2, 10)}`;
    }

    seenIds.add(normalized.id);
    providers.push(normalized);
  }

  return providers.length > 0 ? providers : buildLlmProvidersFromLegacySettings(fallbackInput ?? {});
}

function resolveLlmProviderModelSettings(provider: LlmProvider, model: string): LlmProviderModelSettings {
  const normalizedModel = normalizeTrimmedString(model);
  return normalizedModel && provider.modelSettings[normalizedModel]
    ? provider.modelSettings[normalizedModel]
    : {
        extraBodyEnabled: provider.extraBodyEnabled,
        extraBodyText: provider.extraBodyText,
        extraHeadersEnabled: provider.extraHeadersEnabled,
        extraHeadersText: provider.extraHeadersText,
        extractThinkingContent: provider.extractThinkingContent,
        thinkingContentTagName: provider.thinkingContentTagName,
        interleavedThinkingEnabled: provider.interleavedThinkingEnabled,
        interleavedThinkingFieldName: provider.interleavedThinkingFieldName,
      };
}

function normalizeProviderSelection(value: unknown, providers: LlmProvider[], fallbackBaseUrl?: unknown, fallbackApiKey?: unknown) {
  const preferredProviderId = normalizeTrimmedString(value);
  if (preferredProviderId && providers.some((provider) => provider.id === preferredProviderId)) {
    return preferredProviderId;
  }

  const normalizedBaseUrl = normalizeNonEmptyString(fallbackBaseUrl, DEFAULT_AGENT_BASE_URL);
  const normalizedApiKey = normalizeTrimmedString(fallbackApiKey);
  const matchedProvider = providers.find((provider) =>
    provider.baseUrl === normalizedBaseUrl && provider.apiKey === normalizedApiKey
  );
  return matchedProvider?.id ?? providers[0]?.id ?? DEFAULT_LLM_PROVIDER_ID;
}

function applyLegacyAliases(input: Record<string, unknown>) {
  const next = { ...input };
  if (next.translationEndpoint && !next.translationOpenAIEndpoint) {
    next.translationOpenAIEndpoint = next.translationEndpoint;
  }
  if (next.translationApiKey && !next.translationOpenAIApiKey) {
    next.translationOpenAIApiKey = next.translationApiKey;
  }
  if (next.translationModel && !next.translationOpenAIModel) {
    next.translationOpenAIModel = next.translationModel;
  }
  if (next.agentEndpoint && !next.agentProviderId) {
    next.agentBaseUrl = next.agentEndpoint;
  }
  if (next.imageAgentEndpoint && !next.imageAgentProviderId) {
    next.imageAgentBaseUrl = next.imageAgentEndpoint;
  }
  return next;
}

export function normalizeSettingValue<K extends SettingsKey>(
  key: K,
  value: SettingsState[K],
): SettingsState[K] {
  if (key === "restoreSession") {
    return normalizeBoolean(value, DEFAULT_SETTINGS.restoreSession) as SettingsState[K];
  }
  if (key === "searchEngine") {
    return normalizeSearchEngineSetting(value) as SettingsState[K];
  }
  if (key === "newTabUrl") {
    return String(value ?? "") as SettingsState[K];
  }
  if (key === "downloadDefaultDirectory") {
    return normalizeTrimmedString(value) as SettingsState[K];
  }
  if (key === "downloadThreadCount") {
    return normalizeDownloadThreadCount(value) as SettingsState[K];
  }
  if (key === "downloadHeadersText") {
    return normalizeDownloadHeadersText(value) as SettingsState[K];
  }
  if (key === "llmProviders") {
    return normalizeLlmProviders(value) as SettingsState[K];
  }
  if (key === "agentProviderId") {
    return normalizeTrimmedString(value) as SettingsState[K];
  }
  if (key === "agentModel") {
    return normalizeTrimmedString(value) as SettingsState[K];
  }
  if (key === "agentMcpToolExportEnabled") {
    return normalizeBoolean(value, DEFAULT_SETTINGS.agentMcpToolExportEnabled) as SettingsState[K];
  }
  if (key === "agentProfileInstructions") {
    return String(value ?? "")
      .replace(/\r\n?/g, "\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .slice(0, 4000) as SettingsState[K];
  }
  if (key === "agentInteractionBlacklistDomainsText") {
    return normalizeLearningBlacklistDomainsText(value) as SettingsState[K];
  }
  if (key === "imageAgentProviderId") {
    return normalizeTrimmedString(value) as SettingsState[K];
  }
  if (key === "imageAgentModel") {
    return normalizeTrimmedString(value) as SettingsState[K];
  }
  if (key === "learningMode") {
    return normalizeLearningMode(value) as SettingsState[K];
  }
  if (key === "learningProviderId") {
    return normalizeTrimmedString(value) as SettingsState[K];
  }
  if (key === "learningModel") {
    return normalizeTrimmedString(value) as SettingsState[K];
  }
  if (key === "learningRedactTextInput") {
    return normalizeBoolean(value, DEFAULT_SETTINGS.learningRedactTextInput) as SettingsState[K];
  }
  if (key === "learningRetentionDays") {
    return normalizeLearningRetentionDays(value) as SettingsState[K];
  }
  if (key === "learningBlacklistDomainsText") {
    return normalizeLearningBlacklistDomainsText(value) as SettingsState[K];
  }
  if (key === "translationProvider") {
    return normalizeTranslationProvider(value) as SettingsState[K];
  }
  if (key === "translationOpenAIProviderId") {
    return normalizeTrimmedString(value) as SettingsState[K];
  }
  if (key === "translationOpenAIModel") {
    return normalizeTrimmedString(value) as SettingsState[K];
  }
  if (key === "translationGoogleEndpoint") {
    return normalizeNonEmptyString(value, DEFAULT_SETTINGS.translationGoogleEndpoint) as SettingsState[K];
  }
  if (key === "translationGoogleApiKey") {
    return normalizeTrimmedString(value) as SettingsState[K];
  }
  if (key === "translationBaiduEndpoint") {
    return normalizeNonEmptyString(value, DEFAULT_SETTINGS.translationBaiduEndpoint) as SettingsState[K];
  }
  if (key === "translationBaiduAppId") {
    return normalizeTrimmedString(value) as SettingsState[K];
  }
  if (key === "translationBaiduApiKey") {
    return normalizeTrimmedString(value) as SettingsState[K];
  }
  if (key === "translationTargetLanguage") {
    return normalizeTranslationTargetLanguage(value) as SettingsState[K];
  }
  if (key === "translationRequestConcurrency") {
    return normalizeTranslationRequestConcurrency(value) as SettingsState[K];
  }
  if (key === "doNotTrack") {
    return normalizeBoolean(value, DEFAULT_SETTINGS.doNotTrack) as SettingsState[K];
  }
  if (key === "blockThirdPartyCookies") {
    return normalizeBoolean(value, DEFAULT_SETTINGS.blockThirdPartyCookies) as SettingsState[K];
  }
  if (key === "theme") {
    return normalizeThemeSetting(value) as SettingsState[K];
  }
  if (key === "language") {
    return normalizeLanguage(value) as SettingsState[K];
  }
  if (key === "compactTabs") {
    return normalizeBoolean(value, DEFAULT_SETTINGS.compactTabs) as SettingsState[K];
  }
  if (key === "showBookmarksSection") {
    return normalizeBoolean(value, DEFAULT_SETTINGS.showBookmarksSection) as SettingsState[K];
  }
  if (key === "debugHints") {
    return normalizeBoolean(value, DEFAULT_SETTINGS.debugHints) as SettingsState[K];
  }
  if (key === "allowInsecureCerts") {
    return normalizeBoolean(value, DEFAULT_SETTINGS.allowInsecureCerts) as SettingsState[K];
  }
  return value;
}

export function normalizeSettings(input?: Partial<Record<SettingsKey, unknown>> | null): SettingsState {
  const normalizedInput = applyLegacyAliases(
    input && typeof input === "object" ? input : {},
  );
  const llmProviders = normalizeLlmProviders(normalizedInput.llmProviders, normalizedInput);
  const merged = {
    ...DEFAULT_SETTINGS,
    ...normalizedInput,
    llmProviders,
    agentProviderId: normalizeProviderSelection(
      normalizedInput.agentProviderId,
      llmProviders,
      normalizedInput.agentBaseUrl,
      normalizedInput.agentApiKey,
    ),
    imageAgentProviderId: normalizeProviderSelection(
      normalizedInput.imageAgentProviderId,
      llmProviders,
      normalizedInput.imageAgentBaseUrl,
      normalizedInput.imageAgentApiKey,
    ),
    translationOpenAIProviderId: normalizeProviderSelection(
      normalizedInput.translationOpenAIProviderId,
      llmProviders,
      normalizedInput.translationOpenAIEndpoint,
      normalizedInput.translationOpenAIApiKey,
    ),
    learningProviderId: normalizeTrimmedString(normalizedInput.learningProviderId),
    learningModel: normalizeTrimmedString(normalizedInput.learningModel),
  } as SettingsState;

  const result = { ...merged } as SettingsState;

  (Object.keys(DEFAULT_SETTINGS) as SettingsKey[]).forEach((key) => {
    (result as Record<SettingsKey, SettingsState[SettingsKey]>)[key] =
      key === "llmProviders"
        ? llmProviders as SettingsState[typeof key]
        : normalizeSettingValue(key, merged[key]);
  });

  result.agentProviderId = normalizeProviderSelection(result.agentProviderId, llmProviders);
  result.imageAgentProviderId = normalizeProviderSelection(result.imageAgentProviderId, llmProviders);
  result.translationOpenAIProviderId = normalizeProviderSelection(
    result.translationOpenAIProviderId,
    llmProviders,
  );
  const learningAssignment = normalizeLearningAssignment(
    result.learningProviderId,
    result.learningModel,
    llmProviders,
    {
      providerId: result.agentProviderId,
      model: result.agentModel,
    },
  );
  result.learningProviderId = learningAssignment.providerId;
  result.learningModel = learningAssignment.model;
  return result;
}

export function readStoredSettings(): SettingsState {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return normalizeSettings(DEFAULT_SETTINGS);
    }
    const settings = normalizeSettings(JSON.parse(raw));
    writeStoredSettings(settings);
    return settings;
  } catch {
    return normalizeSettings(DEFAULT_SETTINGS);
  }
}

export function writeStoredSettings(settings: SettingsState) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
      ...settings,
      downloadHeadersText: "",
      translationGoogleApiKey: "",
      translationBaiduApiKey: "",
      llmProviders: settings.llmProviders.map((provider) => ({
        ...provider,
        apiKey: "",
        extraHeadersText: "",
        modelSettings: Object.fromEntries(Object.entries(provider.modelSettings).map(
          ([model, modelSettings]) => [model, { ...modelSettings, extraHeadersText: "" }],
        )),
      })),
    }));
  } catch {
    // Ignore storage write failures so the page remains interactive.
  }
}

export function applyThemeSetting(theme: ThemeSetting) {
  const nextTheme =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;

  document.documentElement.setAttribute("data-theme", nextTheme);
}

export function buildDownloadPreferencesInput(settings: SettingsState) {
  return {
    defaultDirectory: settings.downloadDefaultDirectory || null,
    defaultThreadCount: settings.downloadThreadCount,
    defaultHeadersText: settings.downloadHeadersText,
  };
}

export function mergeDownloadPreferences(
  settings: SettingsState,
  preferences: DownloadPreferences,
): SettingsState {
  return normalizeSettings({
    ...settings,
    downloadDefaultDirectory: preferences.defaultDirectory || "",
    downloadThreadCount: preferences.defaultThreadCount,
    downloadHeadersText: preferences.defaultHeadersText || "",
  });
}

export function buildTranslationPreferencesInput(settings: SettingsState) {
  const translationProvider = settings.llmProviders.find(
    (provider) => provider.id === settings.translationOpenAIProviderId,
  );
  const translationModelSettings = translationProvider
    ? resolveLlmProviderModelSettings(translationProvider, settings.translationOpenAIModel)
    : null;

  return {
    provider: settings.translationProvider,
    targetLanguage: settings.translationTargetLanguage,
    requestConcurrency: settings.translationRequestConcurrency,
    sources: {
      "openai-compatible": {
        providerId: settings.translationOpenAIProviderId,
        endpoint: translationProvider?.baseUrl ?? DEFAULT_AGENT_BASE_URL,
        apiKey: translationProvider?.apiKey ?? "",
        model: settings.translationOpenAIModel,
        extraBodyEnabled: translationModelSettings?.extraBodyEnabled ?? false,
        extraBody: translationModelSettings
          ? parseLlmProviderExtraBodyText(translationModelSettings.extraBodyText)
          : {},
        extraHeadersEnabled: translationModelSettings?.extraHeadersEnabled ?? false,
        extraHeaders: translationModelSettings
          ? parseLlmProviderExtraHeadersText(translationModelSettings.extraHeadersText)
          : {},
        extractThinkingContent: translationModelSettings?.extractThinkingContent ?? false,
        thinkingContentTagName: translationModelSettings?.thinkingContentTagName ?? "think",
        interleavedThinkingEnabled: translationModelSettings?.interleavedThinkingEnabled ?? false,
        interleavedThinkingFieldName: translationModelSettings?.interleavedThinkingFieldName
          ?? DEFAULT_INTERLEAVED_THINKING_FIELD_NAME,
      },
      "google-basic": {
        endpoint: settings.translationGoogleEndpoint,
        apiKey: settings.translationGoogleApiKey,
      },
      "google-system": {
        endpoint: DEFAULT_TRANSLATION_SYSTEM_ENDPOINT,
      },
      "baidu-standard": {
        endpoint: settings.translationBaiduEndpoint,
        appId: settings.translationBaiduAppId,
        apiKey: settings.translationBaiduApiKey,
      },
    },
  };
}

export function buildLlmProvidersInput(settings: SettingsState) {
  return settings.llmProviders.map((provider) => ({
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    models: parseLlmProviderModelsText(provider.modelsText),
    extraBodyEnabled: provider.extraBodyEnabled,
    extraBody: parseLlmProviderExtraBodyText(provider.extraBodyText),
    extraHeadersEnabled: provider.extraHeadersEnabled,
    extraHeaders: parseLlmProviderExtraHeadersText(provider.extraHeadersText),
    extractThinkingContent: provider.extractThinkingContent,
    thinkingContentTagName: provider.thinkingContentTagName,
    interleavedThinkingEnabled: provider.interleavedThinkingEnabled,
    interleavedThinkingFieldName: provider.interleavedThinkingFieldName,
    modelSettings: buildLlmProviderModelSettingsInput(provider),
  }));
}

export function buildAgentPreferencesInput(settings: SettingsState): AgentPreferences {
  return {
    providerId: settings.agentProviderId,
    model: settings.agentModel,
    mcpToolExportEnabled: settings.agentMcpToolExportEnabled,
    profileInstructions: settings.agentProfileInstructions,
    interactionBlacklistDomains: parseDomainBlacklistText(settings.agentInteractionBlacklistDomainsText),
  };
}

export function buildImageAgentPreferencesInput(settings: SettingsState): AgentModelPreferences {
  return {
    providerId: settings.imageAgentProviderId,
    model: settings.imageAgentModel,
  };
}

export function buildLearningPreferencesInput(settings: SettingsState): LearningPreferences {
  return {
    mode: settings.learningMode,
    providerId: settings.learningProviderId,
    model: settings.learningModel,
    redactTextInput: settings.learningRedactTextInput,
    retentionDays: settings.learningRetentionDays,
    blacklistDomains: parseDomainBlacklistText(settings.learningBlacklistDomainsText),
  };
}

export function mergeAgentPreferences(
  settings: SettingsState,
  preferences: PersistedAgentPreferences,
): SettingsState {
  return normalizeSettings({
    ...settings,
    agentProviderId: preferences.providerId,
    agentModel: preferences.model,
    agentMcpToolExportEnabled: preferences.mcpToolExportEnabled,
    agentProfileInstructions: preferences.profileInstructions ?? "",
    agentInteractionBlacklistDomainsText: (preferences.interactionBlacklistDomains ?? []).join("\n"),
  });
}

export function mergeImageAgentPreferences(
  settings: SettingsState,
  preferences: PersistedImageAgentPreferences,
): SettingsState {
  return normalizeSettings({
    ...settings,
    imageAgentProviderId: preferences.providerId,
    imageAgentModel: preferences.model,
  });
}

export function mergeLlmProviders(
  settings: SettingsState,
  providers: PersistedLlmProviders,
): SettingsState {
  return normalizeSettings({
    ...settings,
    llmProviders: providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      modelsText: normalizeLlmProviderModelsText(provider.models),
      extraBodyEnabled: normalizeExtraConfigEnabled(provider.extraBodyEnabled, normalizeLlmProviderExtraBodyText(provider.extraBody)),
      extraBodyText: normalizeLlmProviderExtraBodyText(provider.extraBody),
      extraHeadersEnabled: normalizeExtraConfigEnabled(provider.extraHeadersEnabled, normalizeLlmProviderExtraHeadersText(provider.extraHeaders)),
      extraHeadersText: normalizeLlmProviderExtraHeadersText(provider.extraHeaders),
      extractThinkingContent: normalizeExtractThinkingContent(provider.extractThinkingContent),
      thinkingContentTagName: normalizeThinkingContentTagName(provider.thinkingContentTagName),
      interleavedThinkingEnabled: normalizeInterleavedThinkingEnabled(provider.interleavedThinkingEnabled),
      interleavedThinkingFieldName: normalizeInterleavedThinkingFieldName(provider.interleavedThinkingFieldName),
      modelSettings: normalizeLlmProviderModelSettingsMap(provider.modelSettings, normalizeLlmProviderModelsText(provider.models)),
    })),
  });
}

export function mergeLearningPreferences(
  settings: SettingsState,
  preferences: PersistedLearningPreferences,
): SettingsState {
  return normalizeSettings({
    ...settings,
    learningMode: preferences.mode,
    learningProviderId: preferences.providerId,
    learningModel: preferences.model,
    learningRedactTextInput: preferences.redactTextInput,
    learningRetentionDays: preferences.retentionDays,
    learningBlacklistDomainsText: preferences.blacklistDomains.join("\n"),
  });
}

export function normalizeLearningSummary(value: unknown): LearningSummary {
  const record = isRecord(value) ? value : {};
  const currentActionStrategies = Array.isArray(record.recentActionStrategies) ? record.recentActionStrategies : [];
  const currentGuidance = Array.isArray(record.recentGuidance) ? record.recentGuidance : [];
  const legacyPatterns = Array.isArray(record.recentPatterns) ? record.recentPatterns : [];
  const recentGuidanceSource = currentGuidance.length > 0 ? currentGuidance : legacyPatterns;
  const recentActionStrategySource = currentActionStrategies.length > 0 ? currentActionStrategies : recentGuidanceSource;

  const normalizeGuidanceEntry = (entry: unknown) => {
    if (!isRecord(entry)) {
      return null;
    }

    const guidanceId = readNonEmptyString(entry.guidanceId ?? entry.patternId);
    const domain = readNonEmptyString(entry.domain);
    const support = readFiniteNumber(entry.support);
    const confidence = readFiniteNumber(entry.confidence);
    const lastSeenAt = readFiniteNumber(entry.lastSeenAt);
    if (!guidanceId || !domain || !Number.isFinite(lastSeenAt)) {
      return null;
    }

    const sequence = readStringArray(entry.sequence);
    return {
      guidanceId,
      domain,
      ...(readNonEmptyString(entry.pageType) ? { pageType: readNonEmptyString(entry.pageType) } : {}),
      intentKey: readNonEmptyString(entry.intentKey, "repeat_page_workflow"),
      intentLabel: readNonEmptyString(entry.intentLabel, "Repeat a known page workflow"),
      purposeKey: readNonEmptyString(entry.purposeKey, "other") as LearningSummary["recentGuidance"][number]["purposeKey"],
      purposeLabel: readNonEmptyString(entry.purposeLabel, "Other purpose"),
      goalSummary: readNonEmptyString(entry.goalSummary, ""),
      keywords: readStringArray(entry.keywords),
      preferredTargets: readStringArray(entry.preferredTargets),
      recommendedSteps: (() => {
        const steps = readStringArray(entry.recommendedSteps);
        return steps.length > 0 ? steps : sequence;
      })(),
      recoveryHints: readStringArray(entry.recoveryHints),
      support,
      successRate: readFiniteNumber(entry.successRate),
      confidence,
      feedbackCount: readFiniteNumber(entry.feedbackCount),
      lastSeenAt,
    };
  };

  return {
    rawEventCount: readFiniteNumber(record.rawEventCount),
    pendingEventCount: readFiniteNumber(record.pendingEventCount),
    pageSnapshotCount: readFiniteNumber(record.pageSnapshotCount),
    observationCount: readFiniteNumber(record.observationCount ?? record.episodeCount),
    episodeCount: readFiniteNumber(record.episodeCount),
    actionStrategyCount: readFiniteNumber(record.actionStrategyCount ?? record.guidanceCount ?? record.patternCount),
    guidanceCount: readFiniteNumber(record.guidanceCount ?? record.patternCount),
    siteSkillCount: readFiniteNumber(record.siteSkillCount),
    feedbackCount: readFiniteNumber(record.feedbackCount),
    styleProfileCount: readFiniteNumber(record.styleProfileCount),
    preferenceProfileCount: readFiniteNumber(record.preferenceProfileCount),
    historyRecordCount: readFiniteNumber(record.historyRecordCount),
    historySiteCount: readFiniteNumber(record.historySiteCount),
    historyVisitCount: readFiniteNumber(record.historyVisitCount),
    topHistorySites: Array.isArray(record.topHistorySites)
      ? record.topHistorySites
        .map((entry) => normalizeLearningHistorySite(entry))
        .filter((entry): entry is LearningSummary["topHistorySites"][number] => entry !== null)
      : [],
    recentActionStrategies: recentActionStrategySource
      .map((entry) => normalizeGuidanceEntry(entry))
      .filter((entry): entry is LearningSummary["recentActionStrategies"][number] => entry !== null),
    recentGuidance: recentGuidanceSource
      .map((entry) => normalizeGuidanceEntry(entry))
      .filter((entry): entry is LearningSummary["recentGuidance"][number] => entry !== null),
    ...(readOptionalFiniteNumber(record.lastUpdatedAt) !== undefined
      ? { lastUpdatedAt: readOptionalFiniteNumber(record.lastUpdatedAt) }
      : {}),
  };
}

export function normalizeLearningCatalog(value: unknown): LearningCatalog {
  const record = isRecord(value) ? value : {};
  const sitesSource = Array.isArray(record.sites) ? record.sites : [];
  type LearningCatalogSite = LearningCatalog["sites"][number];
  type LearningCatalogBehavior = LearningCatalogSite["actionStrategies"][number];
  type LearningCatalogSiteSkill = LearningCatalogSite["siteSkills"][number];

  const normalizeBehavior = (
    entry: unknown,
  ): LearningCatalogBehavior | null => {
    if (!isRecord(entry)) {
      return null;
    }

    const guidanceId = readNonEmptyString(entry.guidanceId ?? entry.patternId);
    const lastSeenAt = readFiniteNumber(entry.lastSeenAt);
    if (!guidanceId || !Number.isFinite(lastSeenAt)) {
      return null;
    }

    const sequence = readStringArray(entry.sequence);
    return {
      guidanceId,
      ...(readNonEmptyString(entry.pageType) ? { pageType: readNonEmptyString(entry.pageType) } : {}),
      intentKey: readNonEmptyString(entry.intentKey, "repeat_page_workflow"),
      intentLabel: readNonEmptyString(entry.intentLabel, "Repeat a known page workflow"),
      purposeKey: readNonEmptyString(entry.purposeKey, "other") as LearningCatalogBehavior["purposeKey"],
      purposeLabel: readNonEmptyString(entry.purposeLabel, "Other purpose"),
      goalSummary: readNonEmptyString(entry.goalSummary, ""),
      keywords: readStringArray(entry.keywords),
      preferredTargets: readStringArray(entry.preferredTargets),
      recommendedSteps: (() => {
        const steps = readStringArray(entry.recommendedSteps);
        return steps.length > 0 ? steps : sequence;
      })(),
      recoveryHints: readStringArray(entry.recoveryHints),
      support: readFiniteNumber(entry.support),
      successRate: readFiniteNumber(entry.successRate),
      confidence: readFiniteNumber(entry.confidence),
      feedbackCount: readFiniteNumber(entry.feedbackCount),
      lastSeenAt,
    };
  };

  const normalizeSiteSkill = (
    entry: unknown,
  ): LearningCatalogSiteSkill | null => {
    if (!isRecord(entry)) {
      return null;
    }

    const skillId = readNonEmptyString(entry.skillId ?? entry.episodeId);
    const domain = readNonEmptyString(entry.domain);
    const patternKey = readNonEmptyString(entry.patternKey);
    const patternLabel = readNonEmptyString(entry.patternLabel, patternKey);
    const rule = readNonEmptyString(entry.rule);
    const lastSeenAt = readFiniteNumber(entry.lastSeenAt);
    if (!skillId || !domain || !patternKey || !patternLabel || !rule || !Number.isFinite(lastSeenAt)) {
      return null;
    }

    return {
      skillId,
      domain,
      ...(readNonEmptyString(entry.pageType) ? { pageType: readNonEmptyString(entry.pageType) } : {}),
      patternKey: patternKey as LearningCatalogSiteSkill["patternKey"],
      patternLabel,
      rule,
      evidence: readStringArray(entry.evidence),
      confidence: readFiniteNumber(entry.confidence),
      support: readFiniteNumber(entry.support),
      successRate: readFiniteNumber(entry.successRate),
      lastSeenAt,
    };
  };

  const sites: LearningCatalog["sites"] = sitesSource.flatMap((entry) => {
      if (!isRecord(entry)) {
        return [];
      }

      const siteId = readNonEmptyString(entry.siteId);
      const domain = readNonEmptyString(entry.domain);
      const lastSeenAt = readFiniteNumber(entry.lastSeenAt);
      if (!siteId || !domain || !Number.isFinite(lastSeenAt)) {
        return [];
      }

      const actionStrategiesSource = Array.isArray(entry.actionStrategies)
        ? entry.actionStrategies
        : Array.isArray(entry.behaviors)
          ? entry.behaviors
          : [];
      const actionStrategies = actionStrategiesSource
        .map((item) => normalizeBehavior(item))
        .filter((item): item is LearningCatalogBehavior => item !== null);
      const siteSkills = Array.isArray(entry.siteSkills)
        ? entry.siteSkills
          .map((item) => normalizeSiteSkill(item))
          .filter((item): item is LearningCatalogSiteSkill => item !== null)
        : [];
      const history = normalizeLearningHistorySite(entry.history);
      const scheme = readNonEmptyString(entry.scheme);
      const site: LearningCatalogSite = {
        siteId,
        domain,
        ...(scheme ? { scheme } : {}),
        actionStrategyCount: readFiniteNumber(entry.actionStrategyCount ?? entry.guidanceCount, actionStrategies.length),
        guidanceCount: readFiniteNumber(entry.guidanceCount ?? entry.actionStrategyCount, actionStrategies.length),
        siteSkillCount: readFiniteNumber(entry.siteSkillCount, siteSkills.length),
        feedbackCount: readFiniteNumber(entry.feedbackCount),
        totalSupport: readFiniteNumber(entry.totalSupport),
        lastSeenAt,
        ...(history ? { history } : {}),
        actionStrategies,
        behaviors: actionStrategies,
        siteSkills,
      };

      return [site];
    });

  return {
    rawEventCount: readFiniteNumber(record.rawEventCount),
    pendingEventCount: readFiniteNumber(record.pendingEventCount),
    pageSnapshotCount: readFiniteNumber(record.pageSnapshotCount),
    observationCount: readFiniteNumber(record.observationCount ?? record.episodeCount),
    episodeCount: readFiniteNumber(record.episodeCount),
    actionStrategyCount: readFiniteNumber(record.actionStrategyCount ?? record.guidanceCount ?? record.patternCount),
    guidanceCount: readFiniteNumber(record.guidanceCount ?? record.patternCount),
    siteSkillCount: readFiniteNumber(record.siteSkillCount),
    feedbackCount: readFiniteNumber(record.feedbackCount),
    styleProfileCount: readFiniteNumber(record.styleProfileCount),
    preferenceProfileCount: readFiniteNumber(record.preferenceProfileCount),
    historyRecordCount: readFiniteNumber(record.historyRecordCount),
    historySiteCount: readFiniteNumber(record.historySiteCount),
    historyVisitCount: readFiniteNumber(record.historyVisitCount),
    historyTopSites: Array.isArray(record.historyTopSites)
      ? record.historyTopSites
        .map((entry) => normalizeLearningHistorySite(entry))
        .filter((entry): entry is LearningCatalog["historyTopSites"][number] => entry !== null)
      : [],
    styleProfiles: Array.isArray(record.styleProfiles)
      ? record.styleProfiles
        .map((entry) => normalizeLearningStyleProfile(entry))
        .filter((entry): entry is LearningCatalog["styleProfiles"][number] => entry !== null)
      : [],
    preferenceProfiles: Array.isArray(record.preferenceProfiles)
      ? record.preferenceProfiles
        .map((entry) => normalizeLearningPreferenceProfile(entry))
        .filter((entry): entry is LearningCatalog["preferenceProfiles"][number] => entry !== null)
      : [],
    siteCount: readFiniteNumber(record.siteCount, sites.length),
    activeProgress: Array.isArray(record.activeProgress)
      ? record.activeProgress
        .map((entry) => normalizeLearningProgressItem(entry))
        .filter((entry): entry is LearningCatalog["activeProgress"][number] => entry !== null)
      : [],
    taskStatus: normalizeLearningTaskStatus(record.taskStatus, "on"),
    sites,
    ...(readOptionalFiniteNumber(record.lastUpdatedAt) !== undefined
      ? { lastUpdatedAt: readOptionalFiniteNumber(record.lastUpdatedAt) }
      : {}),
  };
}

export function mergeTranslationPreferences(
  settings: SettingsState,
  preferences: TranslationPreferences,
): SettingsState {
  return normalizeSettings({
    ...settings,
    translationProvider: preferences.provider,
    translationOpenAIProviderId: preferences.sources["openai-compatible"]?.providerId,
    translationOpenAIModel: preferences.sources["openai-compatible"]?.model,
    translationGoogleEndpoint: preferences.sources["google-basic"]?.endpoint,
    translationGoogleApiKey: preferences.sources["google-basic"]?.apiKey,
    translationBaiduEndpoint: preferences.sources["baidu-standard"]?.endpoint,
    translationBaiduAppId: preferences.sources["baidu-standard"]?.appId,
    translationBaiduApiKey: preferences.sources["baidu-standard"]?.apiKey,
    translationTargetLanguage: preferences.targetLanguage,
    translationRequestConcurrency: preferences.requestConcurrency,
  });
}
