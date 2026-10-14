import type {
  AgentBackendToolDefinition,
  OpenAICompatibleBackendConfig,
} from "../agent/openai-compatible-backend.js";
import {
  defineAgent,
  requestDefinedAgentTurn,
} from "../agent/define-agent.js";
import type {
  LearningEpisode,
  LearningEpisodeAnalysis,
  LearningEpisodeFeedbackDraft,
  LearningEpisodeGuidanceDraft,
  LearningEpisodeLearningContext,
  LearningEpisodeLearningResult,
  LearningEpisodeSiteSkillDraft,
  LearningFeedbackOutcome,
  LearningPurposeKey,
  LearningSiteSkillPatternKey,
} from "./types.js";

interface LearnEpisodeWithLlmInput {
  backend: OpenAICompatibleBackendConfig;
  context: LearningEpisodeLearningContext;
  signal?: AbortSignal;
}

const EPISODE_LEARNING_TOOL_NAME = "submit_episode_learning";
const ALLOWED_PURPOSE_KEYS = new Set<LearningPurposeKey>([
  "retrieve_data",
  "submit_data",
  "authenticate",
  "download_export",
  "navigate_workflow",
  "other",
]);
const ALLOWED_SITE_SKILL_KEYS = new Set<LearningSiteSkillPatternKey>([
  "confirm_after_typing",
  "scroll_before_primary_action",
  "dialog_interruption",
  "navigation_after_click",
  "download_requires_verification",
  "llm_inferred",
]);
const ALLOWED_TOOL_ORDER = new Set([
  "browser_element_input",
  "browser_element_click",
  "browser_element_scroll",
  "browser_events_await",
]);

const EPISODE_LEARNING_TOOL: AgentBackendToolDefinition = {
  name: EPISODE_LEARNING_TOOL_NAME,
  description: "Return the LLM-learned browser workflow assets for one observed episode.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      analysis: {
        type: "object",
        additionalProperties: false,
        properties: {
          pageType: { type: "string" },
          intentKey: { type: "string" },
          intentLabel: { type: "string" },
          purposeKey: {
            type: "string",
            enum: ["retrieve_data", "submit_data", "authenticate", "download_export", "navigate_workflow", "other"],
          },
          purposeLabel: { type: "string" },
          goalSummary: { type: "string" },
          keywords: {
            type: "array",
            items: { type: "string" },
          },
          inputTargets: {
            type: "array",
            items: { type: "string" },
          },
          clickTargets: {
            type: "array",
            items: { type: "string" },
          },
          topTargets: {
            type: "array",
            items: { type: "string" },
          },
          outcome: {
            type: "string",
            enum: ["success", "failure", "unknown"],
          },
          successSignals: {
            type: "array",
            items: { type: "string" },
          },
          failureSignals: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: [
          "intentKey",
          "intentLabel",
          "purposeKey",
          "purposeLabel",
          "goalSummary",
          "keywords",
          "inputTargets",
          "clickTargets",
          "topTargets",
          "outcome",
          "successSignals",
          "failureSignals",
        ],
      },
      guidance: {
        type: "object",
        additionalProperties: false,
        properties: {
          pageType: { type: "string" },
          intentKey: { type: "string" },
          intentLabel: { type: "string" },
          purposeKey: {
            type: "string",
            enum: ["retrieve_data", "submit_data", "authenticate", "download_export", "navigate_workflow", "other"],
          },
          purposeLabel: { type: "string" },
          goalSummary: { type: "string" },
          keywords: {
            type: "array",
            items: { type: "string" },
          },
          inputTargets: {
            type: "array",
            items: { type: "string" },
          },
          clickTargets: {
            type: "array",
            items: { type: "string" },
          },
          preferredTargets: {
            type: "array",
            items: { type: "string" },
          },
          recommendedSteps: {
            type: "array",
            items: { type: "string" },
          },
          toolOrder: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "browser_element_input",
                "browser_element_click",
                "browser_element_scroll",
                "browser_events_await",
              ],
            },
          },
          recoveryHints: {
            type: "array",
            items: { type: "string" },
          },
          cautionNotes: {
            type: "array",
            items: { type: "string" },
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
          },
        },
        required: [
          "intentKey",
          "intentLabel",
          "purposeKey",
          "purposeLabel",
          "goalSummary",
          "keywords",
          "inputTargets",
          "clickTargets",
          "preferredTargets",
          "recommendedSteps",
          "toolOrder",
          "recoveryHints",
          "cautionNotes",
        ],
      },
      siteSkills: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            patternKey: {
              type: "string",
              enum: [
                "confirm_after_typing",
                "scroll_before_primary_action",
                "dialog_interruption",
                "navigation_after_click",
                "download_requires_verification",
                "llm_inferred",
              ],
            },
            patternLabel: { type: "string" },
            rule: { type: "string" },
            evidence: {
              type: "array",
              items: { type: "string" },
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
          },
          required: ["patternKey", "patternLabel", "rule", "evidence"],
        },
      },
      feedback: {
        type: "object",
        additionalProperties: false,
        properties: {
          outcome: {
            type: "string",
            enum: ["success", "failure", "partial", "unknown"],
          },
          summary: { type: "string" },
          reasonCodes: {
            type: "array",
            items: { type: "string" },
          },
          verifierSignals: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["outcome", "summary", "reasonCodes", "verifierSignals"],
      },
    },
    required: ["analysis", "siteSkills", "feedback"],
  },
};

const learningEpisodeAgent = defineAgent<undefined>({
  id: "learning-episode-learner",
  systemPrompt: [
    "You learn browser workflow knowledge entirely from observed browser evidence.",
    "Do not use local heuristics. Infer the workflow directly from the provided events and snapshot metadata.",
    "Keep only workflow targets that are actually relevant to completing the task.",
    "Exclude noisy content items, transient banners, unrelated navigation, and forum post titles unless they are the true task target.",
    "Only return a reusable guidance object when the evidence supports a stable workflow path worth replaying.",
    "When no predefined site-skill category fits, use patternKey=llm_inferred and provide a concrete patternLabel and rule.",
    "Never invent selectors, credentials, hidden states, or UI elements that are not grounded in the evidence.",
    "recommendedSteps must be concise imperative instructions.",
    "recoveryHints and cautionNotes must be concrete and evidence-backed.",
    `Call ${EPISODE_LEARNING_TOOL_NAME} exactly once with the final learning result.`,
  ],
  tools: [EPISODE_LEARNING_TOOL],
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readTrimmedString(value: unknown, maxLength = 220) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  void maxLength;
  return normalized;
}

function readTrimmedStringArray(value: unknown, limit: number, maxLength: number) {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const normalized = readTrimmedString(entry, maxLength);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  void limit;
  return result;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Number(value) : undefined;
}

function parsePurposeKey(value: unknown): LearningPurposeKey | undefined {
  return typeof value === "string" && ALLOWED_PURPOSE_KEYS.has(value as LearningPurposeKey)
    ? value as LearningPurposeKey
    : undefined;
}

function parseSiteSkillPatternKey(value: unknown): LearningSiteSkillPatternKey | undefined {
  return typeof value === "string" && ALLOWED_SITE_SKILL_KEYS.has(value as LearningSiteSkillPatternKey)
    ? value as LearningSiteSkillPatternKey
    : undefined;
}

function parseFeedbackOutcome(value: unknown): LearningFeedbackOutcome | undefined {
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

function parseEpisodeOutcome(value: unknown): LearningEpisode["outcome"] | undefined {
  switch (value) {
    case "success":
    case "failure":
    case "unknown":
      return value;
    default:
      return undefined;
  }
}

function readToolOrder(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: string[] = [];
  for (const entry of value) {
    const normalized = readTrimmedString(entry, 48);
    if (!normalized || !ALLOWED_TOOL_ORDER.has(normalized) || result.includes(normalized)) {
      continue;
    }
    result.push(normalized);
  }
  return result;
}

function parseAnalysis(value: unknown, fallback: LearningEpisode): LearningEpisodeAnalysis | null {
  if (!isRecord(value)) {
    return null;
  }
  const intentKey = readTrimmedString(value.intentKey, 80) ?? fallback.intentKey;
  const intentLabel = readTrimmedString(value.intentLabel, 120) ?? fallback.intentLabel;
  const purposeKey = parsePurposeKey(value.purposeKey) ?? fallback.purposeKey;
  const purposeLabel = readTrimmedString(value.purposeLabel, 120) ?? fallback.purposeLabel;
  const goalSummary = readTrimmedString(value.goalSummary, 200) ?? fallback.goalSummary;
  const outcome = parseEpisodeOutcome(value.outcome) ?? fallback.outcome;
  if (!intentKey || !intentLabel || !purposeKey || !purposeLabel || !goalSummary) {
    return null;
  }

  return {
    ...(readTrimmedString(value.pageType, 80) ?? fallback.pageType
      ? { pageType: readTrimmedString(value.pageType, 80) ?? fallback.pageType }
      : {}),
    intentKey,
    intentLabel,
    purposeKey,
    purposeLabel,
    goalSummary,
    keywords: readTrimmedStringArray(value.keywords, 12, 48),
    inputTargets: readTrimmedStringArray(value.inputTargets, 6, 80),
    clickTargets: readTrimmedStringArray(value.clickTargets, 6, 80),
    topTargets: readTrimmedStringArray(value.topTargets, 6, 80),
    outcome,
    successSignals: readTrimmedStringArray(value.successSignals, 8, 64),
    failureSignals: readTrimmedStringArray(value.failureSignals, 8, 64),
  };
}

function parseGuidance(value: unknown, analysis: LearningEpisodeAnalysis): LearningEpisodeGuidanceDraft | null {
  if (!isRecord(value)) {
    return null;
  }
  const intentKey = readTrimmedString(value.intentKey, 80) ?? analysis.intentKey;
  const intentLabel = readTrimmedString(value.intentLabel, 120) ?? analysis.intentLabel;
  const purposeKey = parsePurposeKey(value.purposeKey) ?? analysis.purposeKey;
  const purposeLabel = readTrimmedString(value.purposeLabel, 120) ?? analysis.purposeLabel;
  const goalSummary = readTrimmedString(value.goalSummary, 200) ?? analysis.goalSummary;
  if (!intentKey || !intentLabel || !purposeKey || !purposeLabel || !goalSummary) {
    return null;
  }

  const preferredTargets = readTrimmedStringArray(value.preferredTargets, 6, 80);
  const recommendedSteps = readTrimmedStringArray(value.recommendedSteps, 5, 180);
  const recoveryHints = readTrimmedStringArray(value.recoveryHints, 3, 180);
  const cautionNotes = readTrimmedStringArray(value.cautionNotes, 3, 180);
  if (
    preferredTargets.length === 0
    && recommendedSteps.length === 0
    && recoveryHints.length === 0
    && cautionNotes.length === 0
  ) {
    return null;
  }

  const confidence = readNumber(value.confidence);
  return {
    ...(readTrimmedString(value.pageType, 80) ?? analysis.pageType
      ? { pageType: readTrimmedString(value.pageType, 80) ?? analysis.pageType }
      : {}),
    intentKey,
    intentLabel,
    purposeKey,
    purposeLabel,
    goalSummary,
    keywords: readTrimmedStringArray(value.keywords, 12, 48),
    inputTargets: readTrimmedStringArray(value.inputTargets, 6, 80),
    clickTargets: readTrimmedStringArray(value.clickTargets, 6, 80),
    preferredTargets,
    recommendedSteps,
    toolOrder: readToolOrder(value.toolOrder),
    recoveryHints,
    cautionNotes,
    ...(confidence !== undefined ? { confidence: Math.max(0, Math.min(1, confidence)) } : {}),
  };
}

function parseSiteSkills(value: unknown): LearningEpisodeSiteSkillDraft[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: LearningEpisodeSiteSkillDraft[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const patternKey = parseSiteSkillPatternKey(entry.patternKey) ?? "llm_inferred";
    const patternLabel = readTrimmedString(entry.patternLabel, 120);
    const rule = readTrimmedString(entry.rule, 220);
    if (!patternLabel || !rule) {
      continue;
    }
    const confidence = readNumber(entry.confidence);
    result.push({
      patternKey,
      patternLabel,
      rule,
      evidence: readTrimmedStringArray(entry.evidence, 6, 160),
      ...(confidence !== undefined ? { confidence: Math.max(0, Math.min(1, confidence)) } : {}),
    });
  }
  return result;
}

function parseFeedback(value: unknown): LearningEpisodeFeedbackDraft | null {
  if (!isRecord(value)) {
    return null;
  }
  const outcome = parseFeedbackOutcome(value.outcome);
  const summary = readTrimmedString(value.summary, 220);
  if (!outcome || !summary) {
    return null;
  }
  return {
    outcome,
    summary,
    reasonCodes: readTrimmedStringArray(value.reasonCodes, 8, 64),
    verifierSignals: readTrimmedStringArray(value.verifierSignals, 10, 80),
  };
}

function parseEpisodeLearningArguments(
  argumentsText: string,
  input: LearnEpisodeWithLlmInput,
): LearningEpisodeLearningResult | null {
  try {
    const parsed = JSON.parse(argumentsText) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }
    const analysis = parseAnalysis(parsed.analysis, input.context.episode);
    const feedback = parseFeedback(parsed.feedback);
    if (!analysis || !feedback) {
      return null;
    }
    return {
      episodeId: input.context.episode.episodeId,
      analysis,
      guidance: parseGuidance(parsed.guidance, analysis),
      siteSkills: parseSiteSkills(parsed.siteSkills),
      feedback,
    };
  } catch {
    return null;
  }
}

function buildEvidencePayload(input: LearnEpisodeWithLlmInput) {
  const latestSnapshot = input.context.pageSnapshots
    .slice()
    .sort((left, right) => right.ts - left.ts)[0];

  return {
    episode: {
      episodeId: input.context.episode.episodeId,
      domain: input.context.episode.domain,
      scheme: input.context.episode.scheme,
      url: input.context.episode.url,
      pageTitle: input.context.episode.pageTitle,
      pageType: input.context.episode.pageType,
      startedAt: input.context.episode.startedAt,
      endedAt: input.context.episode.endedAt,
      eventCount: input.context.episode.eventCount,
      observationSummary: {
        intentKey: input.context.episode.intentKey,
        intentLabel: input.context.episode.intentLabel,
        purposeKey: input.context.episode.purposeKey,
        purposeLabel: input.context.episode.purposeLabel,
        goalSummary: input.context.episode.goalSummary,
        keywords: input.context.episode.keywords,
        inputTargets: input.context.episode.inputTargets,
        clickTargets: input.context.episode.clickTargets,
        topTargets: input.context.episode.topTargets,
        sequence: input.context.episode.sequence,
        outcome: input.context.episode.outcome,
        successSignals: input.context.episode.successSignals,
        failureSignals: input.context.episode.failureSignals,
      },
    },
    rawEvents: input.context.events.map((event) => ({
      ts: event.ts,
      kind: event.kind,
      url: event.url,
      title: event.title,
      summary: event.summary,
      targetHint: event.targetHint,
      targetRole: event.targetRole,
      targetName: event.targetName,
      targetLabel: event.targetLabel,
      targetText: event.targetText,
      text: event.text,
    })),
    latestPageSnapshot: latestSnapshot
      ? {
          ts: latestSnapshot.ts,
          url: latestSnapshot.url,
          title: latestSnapshot.title,
          bodyText: latestSnapshot.bodyText,
          regions: latestSnapshot.regions,
          forms: latestSnapshot.forms,
          information: latestSnapshot.information,
          capabilities: latestSnapshot.capabilities,
          dataKeys: latestSnapshot.dataKeys,
        }
      : null,
  };
}

export async function learnEpisodeWithLlm(input: LearnEpisodeWithLlmInput) {
  const assistant = await requestDefinedAgentTurn({
    agent: learningEpisodeAgent,
    context: undefined,
    backend: input.backend,
    messages: [
      {
        role: "user",
        content: [
          "Learn browser workflow assets for this observed episode from the evidence JSON below.",
          "The result must stay grounded in the provided evidence and must not rely on local heuristics.",
          JSON.stringify(buildEvidencePayload(input), null, 2),
        ].join("\n\n"),
      },
    ],
    signal: input.signal,
  });

  const toolCall = assistant.toolCalls.find((entry) => entry.name === EPISODE_LEARNING_TOOL_NAME);
  if (toolCall) {
    return parseEpisodeLearningArguments(toolCall.argumentsText, input);
  }

  return parseEpisodeLearningArguments(assistant.content, input);
}
