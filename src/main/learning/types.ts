export type LearningMode = "off" | "on";
export type LearningPurposeKey =
  | "retrieve_data"
  | "submit_data"
  | "authenticate"
  | "download_export"
  | "navigate_workflow"
  | "other";
export type LearningExtractionMode = "records" | "text" | "images";
export type LearningAssetLayer = "observation" | "abstraction" | "decision" | "feedback";
export type LearningTraceSource = "human_demo" | "agent_run" | "human_takeover" | "synthetic";
export type LearningFeedbackOutcome = "success" | "failure" | "partial" | "unknown";
export type LearningFeedbackSource =
  | "observer_episode"
  | "strategy_rollup"
  | "extraction_recipe"
  | "verifier"
  | "llm_episode_learning";
export type LearningWritingContextType =
  | "email"
  | "forum"
  | "article_editor"
  | "general_editor";
export type LearningWritingSlot =
  | "subject"
  | "body"
  | "title"
  | "comment"
  | "message"
  | "recipient"
  | "unknown";
export type LearningSiteSkillPatternKey =
  | "confirm_after_typing"
  | "scroll_before_primary_action"
  | "dialog_interruption"
  | "navigation_after_click"
  | "download_requires_verification"
  | "llm_inferred";

export interface LearningPreferences {
  mode: LearningMode;
  providerId: string;
  model: string;
  redactTextInput: boolean;
  retentionDays: number;
  blacklistDomains: string[];
}

export interface LearningRawEvent {
  id: string;
  workspaceId: string;
  domain: string;
  ts: number;
  kind: string;
  scheme?: string;
  tabId?: string;
  url?: string;
  title?: string;
  source?: string;
  summary?: string;
  targetHint?: string;
  targetRole?: string;
  targetName?: string;
  targetLabel?: string;
  targetText?: string;
  text?: string;
  pageSnapshotId?: string;
}

export interface LearningPageSnapshotRegion {
  regionId?: string;
  role?: string;
  name?: string;
  textSummary?: string;
}

export interface LearningPageSnapshotForm {
  formId?: string;
  name?: string;
  description?: string;
  textSummary?: string;
}

export interface LearningPageSnapshotInformationBlock {
  blockId?: string;
  regionId?: string;
  type: string;
  title?: string;
  summary?: string;
  itemCount?: number;
  extractable?: boolean;
}

export interface LearningPageSnapshotCapability {
  capabilityId?: string;
  regionId?: string;
  formId?: string;
  type: string;
  title?: string;
  label?: string;
  description?: string;
  actions: string[];
}

export interface LearningPageSnapshot {
  pageSnapshotId: string;
  workspaceId: string;
  domain: string;
  ts: number;
  snapshotHash: string;
  domHash: string;
  redacted: boolean;
  scheme?: string;
  tabId?: string;
  url?: string;
  title?: string;
  semanticSnapshotId?: string;
  bodyText?: string;
  domLength?: number;
  domTruncated?: boolean;
  regions: LearningPageSnapshotRegion[];
  forms: LearningPageSnapshotForm[];
  information: LearningPageSnapshotInformationBlock[];
  capabilities: LearningPageSnapshotCapability[];
  dataKeys: string[];
}

export interface LearningPageSnapshotInput {
  workspaceId: string;
  ts?: number;
  tabId?: string;
  url?: string;
  title?: string;
  semanticSnapshotId?: string;
  bodyText?: string;
  domHash?: string;
  domLength?: number;
  domTruncated?: boolean;
  redacted?: boolean;
  regions?: LearningPageSnapshotRegion[];
  forms?: LearningPageSnapshotForm[];
  information?: LearningPageSnapshotInformationBlock[];
  capabilities?: LearningPageSnapshotCapability[];
  dataKeys?: string[];
}

export interface LearningEpisode {
  episodeId: string;
  workspaceId: string;
  domain: string;
  startedAt: number;
  endedAt: number;
  eventCount: number;
  scheme?: string;
  url?: string;
  pageTitle?: string;
  pageType?: string;
  source?: LearningTraceSource;
  sourceEventIds?: string[];
  topTargets: string[];
  inputTargets: string[];
  clickTargets: string[];
  sequence: string[];
  keywords: string[];
  intentKey: string;
  intentLabel: string;
  purposeKey: LearningPurposeKey;
  purposeLabel: string;
  goalSummary: string;
  successSignals?: string[];
  failureSignals?: string[];
  outcome: "success" | "failure" | "unknown";
}

export interface LearningActionStrategy {
  assetKind: "action_strategy";
  guidanceId: string;
  workspaceId: string;
  domain: string;
  scheme?: string;
  pageType?: string;
  intentKey: string;
  intentLabel: string;
  purposeKey: LearningPurposeKey;
  purposeLabel: string;
  workflowSignature?: string;
  goalSummary: string;
  keywords: string[];
  inputTargets: string[];
  clickTargets: string[];
  preferredTargets: string[];
  recommendedSteps: string[];
  toolOrder: string[];
  recoveryHints: string[];
  cautionNotes: string[];
  support: number;
  successRate: number;
  confidence: number;
  lastSeenAt: number;
  sampleSequence: string[];
}

export type LearningGuidance = LearningActionStrategy;

export interface LearningGuidanceRefinement {
  goalSummary?: string;
  keywords?: string[];
  inputTargets?: string[];
  clickTargets?: string[];
  preferredTargets?: string[];
  recommendedSteps?: string[];
  toolOrder?: string[];
  recoveryHints?: string[];
  cautionNotes?: string[];
}

export interface LearningSiteSkill {
  assetKind: "site_skill";
  skillId: string;
  workspaceId: string;
  domain: string;
  scheme?: string;
  pageType?: string;
  patternKey: LearningSiteSkillPatternKey;
  patternLabel: string;
  rule: string;
  evidence: string[];
  support: number;
  successRate: number;
  confidence: number;
  lastSeenAt: number;
  sourceGuidanceIds: string[];
}

export interface LearningSiteSkillSummary {
  skillId: string;
  domain: string;
  pageType?: string;
  patternKey: LearningSiteSkillPatternKey;
  patternLabel: string;
  rule: string;
  evidence: string[];
  support: number;
  successRate: number;
  confidence: number;
  lastSeenAt: number;
}

export interface LearningSiteSkillSearchMatch extends LearningSiteSkillSummary {
  scheme?: string;
  matchScore: number;
  matchReasons: string[];
}

export interface LearningFeedbackRecord {
  assetKind: "feedback_record";
  feedbackId: string;
  workspaceId: string;
  domain: string;
  ts: number;
  outcome: LearningFeedbackOutcome;
  source: LearningFeedbackSource;
  summary: string;
  reasonCodes: string[];
  verifierSignals: string[];
  scheme?: string;
  pageType?: string;
  episodeId?: string;
  guidanceId?: string;
  skillId?: string;
  recipeId?: string;
}

export interface LearningFeedbackRecordSummary {
  feedbackId: string;
  ts: number;
  outcome: LearningFeedbackOutcome;
  source: LearningFeedbackSource;
  summary: string;
  reasonCodes: string[];
  verifierSignals: string[];
}

export interface LearningEpisodeAnalysis {
  pageType?: string;
  intentKey: string;
  intentLabel: string;
  purposeKey: LearningPurposeKey;
  purposeLabel: string;
  goalSummary: string;
  keywords: string[];
  inputTargets: string[];
  clickTargets: string[];
  topTargets: string[];
  outcome: LearningEpisode["outcome"];
  successSignals: string[];
  failureSignals: string[];
}

export interface LearningEpisodeGuidanceDraft {
  pageType?: string;
  intentKey: string;
  intentLabel: string;
  purposeKey: LearningPurposeKey;
  purposeLabel: string;
  goalSummary: string;
  keywords: string[];
  inputTargets: string[];
  clickTargets: string[];
  preferredTargets: string[];
  recommendedSteps: string[];
  toolOrder: string[];
  recoveryHints: string[];
  cautionNotes: string[];
  confidence?: number;
}

export interface LearningEpisodeSiteSkillDraft {
  patternKey: LearningSiteSkillPatternKey;
  patternLabel: string;
  rule: string;
  evidence: string[];
  confidence?: number;
}

export interface LearningEpisodeFeedbackDraft {
  outcome: LearningFeedbackOutcome;
  summary: string;
  reasonCodes: string[];
  verifierSignals: string[];
}

export interface LearningEpisodeLearningContext {
  episode: LearningEpisode;
  events: LearningRawEvent[];
  pageSnapshots: LearningPageSnapshot[];
}

export interface LearningEpisodeLearningResult {
  episodeId: string;
  analysis: LearningEpisodeAnalysis;
  guidance?: LearningEpisodeGuidanceDraft | null;
  siteSkills: LearningEpisodeSiteSkillDraft[];
  feedback: LearningEpisodeFeedbackDraft;
}

export interface LearningWritingSample {
  sampleId: string;
  workspaceId: string;
  domain: string;
  ts: number;
  text: string;
  charCount: number;
  wordCount: number;
  contextType: LearningWritingContextType;
  slot: LearningWritingSlot;
  scheme?: string;
  pageType?: string;
  url?: string;
  pageTitle?: string;
  fieldHint?: string;
  recipientKey?: string;
  recipientLabel?: string;
}

export interface LearningStyleProfile {
  assetKind: "style_profile";
  profileId: string;
  workspaceId: string;
  domain?: string;
  scheme?: string;
  pageType?: string;
  contextType?: LearningWritingContextType;
  contextLabel?: string;
  slot?: LearningWritingSlot;
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

export interface LearningStyleProfileSummary {
  profileId: string;
  domain?: string;
  scheme?: string;
  pageType?: string;
  contextType?: LearningWritingContextType;
  contextLabel?: string;
  slot?: LearningWritingSlot;
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

export type LearningPreferenceCategory =
  | "recent_focus"
  | "stable_preference"
  | "negative_preference"
  | "workflow_preference";
export type LearningPreferenceSignalSource =
  | "explicit"
  | "observed"
  | "manual"
  | "agent_interaction"
  | "browsing_history"
  | "workflow_learning"
  | "writing_style";
export type LearningPreferenceScope = "global" | "workspace" | "domain";
export type LearningPreferenceStatus = "active" | "stale" | "rejected";

export interface LearningPreferenceSignal {
  id?: string;
  key: string;
  value: string;
  category?: LearningPreferenceCategory;
  confidence: number;
  source: LearningPreferenceSignalSource;
  strength?: number;
  evidenceRefs?: string[];
  scope?: LearningPreferenceScope;
  domain?: string;
  createdAt?: number;
  lastSeenAt?: number;
  expiresAt?: number;
  status?: LearningPreferenceStatus;
  updatedAt: number;
}

export interface LearningPreferenceProfile {
  assetKind: "preference_profile";
  profileId: string;
  workspaceId: string;
  signals: LearningPreferenceSignal[];
  lastUpdatedAt: number;
}

export interface LearningPreferenceProfileSummary {
  profileId: string;
  signals: LearningPreferenceSignal[];
  lastUpdatedAt: number;
}

export interface LearningUserMemoryUpsertInput {
  profileId?: string;
  workspaceId?: string;
  signalId?: string;
  key: string;
  value: string;
  category?: LearningPreferenceCategory;
  source?: LearningPreferenceSignalSource;
  confidence?: number;
  strength?: number;
  evidenceRefs?: string[];
  scope?: LearningPreferenceScope;
  domain?: string;
  createdAt?: number;
  lastSeenAt?: number;
  expiresAt?: number;
  status?: LearningPreferenceStatus;
}

export interface LearningUserMemorySignalInput {
  profileId?: string;
  workspaceId?: string;
  signalId?: string;
  key?: string;
  category?: LearningPreferenceCategory;
  scope?: LearningPreferenceScope;
  domain?: string;
}

export interface LearningUserMemoryMutationResult {
  success: boolean;
  profile?: LearningPreferenceProfileSummary;
  signal?: LearningPreferenceSignal;
}

export type LearningHistoryActivityLevel = "high" | "medium" | "low";
export type LearningHistoryRevisitPattern = "habitual" | "balanced" | "exploratory";

export interface LearningHistoryPageSummary {
  url: string;
  title: string;
  visitCount: number;
  lastVisitedAt: number;
}

export interface LearningHistorySiteSummary {
  siteId: string;
  domain: string;
  visitCount: number;
  uniquePageCount: number;
  observedDayCount: number;
  firstSeenAt: number;
  lastVisitedAt: number;
  activityLevel?: LearningHistoryActivityLevel;
  revisitPattern?: LearningHistoryRevisitPattern;
  topPages: LearningHistoryPageSummary[];
  profileSummary?: string;
  commonIntents: string[];
  revisitDrivers: string[];
  confidence?: number;
}

export interface LearningHistoryProfile {
  assetKind: "history_profile";
  profileId: string;
  scopeKey: string;
  workspaceId?: string;
  domain: string;
  activityLevel: LearningHistoryActivityLevel;
  revisitPattern: LearningHistoryRevisitPattern;
  profileSummary?: string;
  commonIntents: string[];
  revisitDrivers: string[];
  confidence: number;
  recordHash: string;
  lastUpdatedAt: number;
}

export interface LearningHistoryProfileContext {
  profileId: string;
  scopeKey: string;
  workspaceId?: string;
  summary: LearningHistorySiteSummary;
  recordHash: string;
  existingProfile?: LearningHistoryProfile | null;
}

export interface LearningHistoryProfileDraft {
  activityLevel: LearningHistoryActivityLevel;
  revisitPattern: LearningHistoryRevisitPattern;
  profileSummary?: string;
  commonIntents: string[];
  revisitDrivers: string[];
  confidence: number;
}

export interface LearningExtractionRecipe {
  recipeId: string;
  workspaceId: string;
  domain: string;
  scheme?: string;
  pageType?: string;
  pageSignature: string;
  taskSummary: string;
  goalSummary: string;
  extractionMode: LearningExtractionMode;
  sourceRole?: string;
  regionRole?: string;
  regionName?: string;
  regionHint?: string;
  fieldKeys: string[];
  keywords: string[];
  support: number;
  confidence: number;
  lastSeenAt: number;
}

export interface LearningExtractionRecipeSummary {
  recipeId: string;
  domain: string;
  pageType?: string;
  taskSummary: string;
  goalSummary: string;
  extractionMode: LearningExtractionMode;
  sourceRole?: string;
  regionRole?: string;
  regionName?: string;
  regionHint?: string;
  fieldKeys: string[];
  keywords: string[];
  support: number;
  confidence: number;
  lastSeenAt: number;
}

export interface LearningExtractionRecipeSearchInput {
  workspaceId: string;
  activeUrl?: string;
  query?: string;
  domain?: string;
  limit?: number;
}

export interface LearningExtractionRecipeSearchMatch extends LearningExtractionRecipeSummary {
  scheme?: string;
  matchScore: number;
  matchReasons: string[];
}

export interface LearningExtractionRecipeSearchResult {
  recipeCount: number;
  activeDomain?: string;
  matches: LearningExtractionRecipeSearchMatch[];
}

export interface LearningExtractionObservationInput {
  workspaceId: string;
  url?: string;
  pageTitle?: string;
  task: string;
  extractionMode: LearningExtractionMode;
  outcome?: LearningFeedbackOutcome;
  pageSignature?: string;
  sourceRole?: string;
  regionRole?: string;
  regionName?: string;
  regionHint?: string;
  fieldKeys?: string[];
  keywords?: string[];
  ts?: number;
}

export interface LearningPromptContextInput {
  workspaceId: string;
  activeUrl?: string;
  task?: string;
}

export interface LearningInputAssistContextInput {
  workspaceId: string;
  url?: string;
  pageTitle?: string;
  targetHint?: string;
  targetRole?: string;
  targetName?: string;
  targetLabel?: string;
  placeholder?: string;
  fieldHint?: string;
  contextType?: LearningWritingContextType;
  slot?: LearningWritingSlot;
  recipient?: string;
}

export interface LearningInputAssistContext {
  showMenu: boolean;
  supported: boolean;
  domain?: string;
  contextType?: LearningWritingContextType;
  contextLabel?: string;
  slot?: LearningWritingSlot;
  slotLabel?: string;
  recipientLabel?: string;
  matchReason?: string;
  styleProfile?: LearningStyleProfileSummary | null;
  recentExamples: string[];
}

export interface LearningInputAssistActionInput extends LearningInputAssistContextInput {
  mode: "polish" | "draft";
  currentText?: string;
  instruction?: string;
}

export interface LearningInputAssistActionResult {
  success: boolean;
  text?: string;
  error?: string;
  styleProfile?: LearningStyleProfileSummary | null;
}

export interface LearningGuidanceSearchInput {
  workspaceId: string;
  activeUrl?: string;
  query?: string;
  domain?: string;
  limit?: number;
}

export interface LearningActionStrategySummary {
  guidanceId: string;
  domain: string;
  pageType?: string;
  intentKey: string;
  intentLabel: string;
  purposeKey: LearningPurposeKey;
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
}

export type LearningGuidanceSummary = LearningActionStrategySummary;

export interface LearningGuidanceSearchMatch extends LearningGuidanceSummary {
  scheme?: string;
  matchScore: number;
  matchReasons: string[];
}

export interface LearningGuidanceSearchResult {
  guidanceCount: number;
  actionStrategyCount: number;
  siteSkillCount: number;
  feedbackCount: number;
  activeDomain?: string;
  matches: LearningGuidanceSearchMatch[];
  actionStrategies: LearningGuidanceSearchMatch[];
  siteSkills: LearningSiteSkillSearchMatch[];
  styleProfile?: LearningStyleProfileSummary | null;
  preferenceProfile?: LearningPreferenceProfileSummary | null;
  historyProfile?: LearningHistorySiteSummary | null;
}

export interface LearningGuidanceDetailEpisode {
  episodeId: string;
  endedAt: number;
  url?: string;
  pageTitle?: string;
  pageType?: string;
  outcome: LearningEpisode["outcome"];
  topTargets: string[];
  inputTargets: string[];
  clickTargets: string[];
  sequence: string[];
  keywords: string[];
}

export interface LearningGuidanceDetail extends LearningGuidance {
  relatedEpisodeCount: number;
  feedbackCount: number;
  recentEpisodes: LearningGuidanceDetailEpisode[];
  relatedSiteSkills: LearningSiteSkillSummary[];
  recentFeedback: LearningFeedbackRecordSummary[];
}

export interface LearningSummaryInput {
  workspaceId?: string;
  activeUrl?: string;
}

export interface LearningSummary {
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
  recentActionStrategies: LearningActionStrategySummary[];
  recentGuidance: LearningGuidanceSummary[];
  lastUpdatedAt?: number;
}

export type LearningProgressMode = "observe_workflow" | "learn_writing_style";
export type LearningProgressMethod =
  | "input"
  | "click"
  | "scroll"
  | "navigation"
  | "dialog"
  | "download"
  | "typing";

export interface LearningProgressItem {
  progressId: string;
  mode: LearningProgressMode;
  workspaceId: string;
  domain: string;
  url?: string;
  pageTitle?: string;
  pageType?: string;
  updatedAt: number;
  eventCount: number;
  methods: LearningProgressMethod[];
  latestEventKind?: string;
  latestEventSummary?: string;
  targetSummary?: string;
  contentPreview?: string;
  contextType?: LearningWritingContextType;
  slot?: LearningWritingSlot;
  fieldHint?: string;
  recipientLabel?: string;
  charCount?: number;
  wordCount?: number;
}

export type LearningTaskState = "idle" | "running" | "paused" | "error_paused";
export type LearningTaskPauseReason = "manual" | "llm_error";
export type LearningTaskPauseStage =
  | "episode_learning"
  | "history_profile_refinement"
  | "guidance_refinement"
  | "style_profile_refinement";

export interface LearningTaskStatus {
  state: LearningTaskState;
  mode: LearningMode;
  pauseReason?: LearningTaskPauseReason;
  pauseStage?: LearningTaskPauseStage;
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

export interface LearningCatalogBehavior extends LearningActionStrategySummary {}

export interface LearningCatalogSite {
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
  actionStrategies: LearningCatalogBehavior[];
  behaviors: LearningCatalogBehavior[];
  siteSkills: LearningSiteSkillSummary[];
}

export interface LearningCatalog {
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
  sites: LearningCatalogSite[];
  activeProgress: LearningProgressItem[];
  taskStatus: LearningTaskStatus;
  lastUpdatedAt?: number;
}

export interface LearningFlushResult {
  success: boolean;
  processedEventCount: number;
  learnedEpisodeCount: number;
  learnedGuidanceCount: number;
  writingSampleCount: number;
}
