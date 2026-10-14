import {
  type AgentBackendToolDefinition,
  type OpenAICompatibleBackendConfig,
} from "../agent/openai-compatible-backend.js";
import {
  defineAgent,
  requestDefinedAgentTurn,
} from "../agent/define-agent.js";
import type {
  LearningEpisode,
  LearningGuidance,
  LearningGuidanceRefinement,
} from "./types.js";

interface RefineLearningGuidanceInput {
  backend: OpenAICompatibleBackendConfig;
  guidance: LearningGuidance;
  episodes: LearningEpisode[];
  signal?: AbortSignal;
}

const REFINEMENT_TOOL_NAME = "submit_learning_refinement";
const REFINEMENT_TOOL: AgentBackendToolDefinition = {
  name: REFINEMENT_TOOL_NAME,
  description: "Return the denoised, evidence-backed browser workflow guidance.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      goalSummary: {
        type: "string",
        description: "One concise sentence describing the workflow goal.",
      },
      keywords: {
        type: "array",
        description: "Short evidence-backed keywords for matching similar tasks later.",
        items: { type: "string" },
      },
      inputTargets: {
        type: "array",
        description: "The stable input-like targets that are actually relevant to the workflow.",
        items: { type: "string" },
      },
      clickTargets: {
        type: "array",
        description: "The stable click-like targets that are actually relevant to the workflow.",
        items: { type: "string" },
      },
      preferredTargets: {
        type: "array",
        description: "The most trustworthy targets overall, mixing input and click targets when useful.",
        items: { type: "string" },
      },
      recommendedSteps: {
        type: "array",
        description: "Three to five concise best-practice steps for replaying the workflow safely.",
        items: { type: "string" },
      },
      toolOrder: {
        type: "array",
        description: "The optimal high-level tool order, using only the allowed tool names.",
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
        description: "One to three concise failure-recovery hints grounded in the observed evidence.",
        items: { type: "string" },
      },
      cautionNotes: {
        type: "array",
        description: "One to three concise cautions about replaying this workflow.",
        items: { type: "string" },
      },
    },
    required: [
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
};

const learningGuidanceRefinerAgent = defineAgent<undefined>({
  id: "learning-guidance-refiner",
  systemPrompt: [
    "You refine browser workflow guidance from observed interaction traces.",
    "Your job is to remove noise, discard one-off detours, and preserve only the shortest reliable path supported by the evidence.",
    "Prefer repeated and successful behavior over rare actions.",
    "Never invent targets, selectors, credentials, or page states that are not grounded in the evidence.",
    "If the evidence is mixed, stay conservative and keep only the stable core workflow.",
    "toolOrder must use only these values: browser_element_input, browser_element_click, browser_element_scroll, browser_events_await.",
    "recommendedSteps must be concise imperative instructions.",
    "recoveryHints must describe how to recover when the page does not progress as expected.",
    "cautionNotes must be concise guardrails, not generic filler.",
    `Call ${REFINEMENT_TOOL_NAME} exactly once with the final refinement.`,
  ],
  tools: [REFINEMENT_TOOL],
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readTrimmedString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readTrimmedStringArray(value: unknown, limit: number) {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const normalized = readTrimmedString(entry);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  void limit;
  return result;
}

function parseRefinementArguments(argumentsText: string): LearningGuidanceRefinement | null {
  try {
    const parsed = JSON.parse(argumentsText) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    const goalSummary = readTrimmedString(parsed.goalSummary);
    const keywords = readTrimmedStringArray(parsed.keywords, 12);
    const inputTargets = readTrimmedStringArray(parsed.inputTargets, 6);
    const clickTargets = readTrimmedStringArray(parsed.clickTargets, 6);
    const preferredTargets = readTrimmedStringArray(parsed.preferredTargets, 6);
    const recommendedSteps = readTrimmedStringArray(parsed.recommendedSteps, 5);
    const toolOrder = readTrimmedStringArray(parsed.toolOrder, 5);
    const recoveryHints = readTrimmedStringArray(parsed.recoveryHints, 3);
    const cautionNotes = readTrimmedStringArray(parsed.cautionNotes, 3);

    if (
      !goalSummary
      && keywords.length === 0
      && inputTargets.length === 0
      && clickTargets.length === 0
      && preferredTargets.length === 0
      && recommendedSteps.length === 0
      && toolOrder.length === 0
      && recoveryHints.length === 0
      && cautionNotes.length === 0
    ) {
      return null;
    }

    return {
      ...(goalSummary ? { goalSummary } : {}),
      ...(keywords.length > 0 ? { keywords } : {}),
      ...(inputTargets.length > 0 ? { inputTargets } : {}),
      ...(clickTargets.length > 0 ? { clickTargets } : {}),
      ...(preferredTargets.length > 0 ? { preferredTargets } : {}),
      ...(recommendedSteps.length > 0 ? { recommendedSteps } : {}),
      ...(toolOrder.length > 0 ? { toolOrder } : {}),
      ...(recoveryHints.length > 0 ? { recoveryHints } : {}),
      ...(cautionNotes.length > 0 ? { cautionNotes } : {}),
    };
  } catch {
    return null;
  }
}

function buildEvidencePayload(input: RefineLearningGuidanceInput) {
  return {
    currentGuidance: {
      domain: input.guidance.domain,
      scheme: input.guidance.scheme,
      pageType: input.guidance.pageType,
      intentKey: input.guidance.intentKey,
      intentLabel: input.guidance.intentLabel,
      purposeKey: input.guidance.purposeKey,
      purposeLabel: input.guidance.purposeLabel,
      goalSummary: input.guidance.goalSummary,
      support: input.guidance.support,
      successRate: input.guidance.successRate,
      confidence: input.guidance.confidence,
      keywords: input.guidance.keywords,
      inputTargets: input.guidance.inputTargets,
      clickTargets: input.guidance.clickTargets,
      preferredTargets: input.guidance.preferredTargets,
      recommendedSteps: input.guidance.recommendedSteps,
      toolOrder: input.guidance.toolOrder,
      recoveryHints: input.guidance.recoveryHints,
      cautionNotes: input.guidance.cautionNotes,
      sampleSequence: input.guidance.sampleSequence,
    },
    recentEpisodes: input.episodes.map((episode) => ({
      endedAt: episode.endedAt,
      eventCount: episode.eventCount,
      pageType: episode.pageType,
      goalSummary: episode.goalSummary,
      outcome: episode.outcome,
      keywords: episode.keywords,
      inputTargets: episode.inputTargets,
      clickTargets: episode.clickTargets,
      topTargets: episode.topTargets,
      sequence: episode.sequence,
    })),
  };
}

export async function refineLearningGuidanceWithLlm(input: RefineLearningGuidanceInput) {
  const assistant = await requestDefinedAgentTurn({
    agent: learningGuidanceRefinerAgent,
    context: undefined,
    backend: input.backend,
    messages: [
      {
        role: "user",
        content: [
          "Denoise the current guidance and choose the optimal evidence-backed workflow path.",
          "The evidence payload is JSON.",
          JSON.stringify(buildEvidencePayload(input), null, 2),
        ].join("\n\n"),
      },
    ],
    signal: input.signal,
  });

  const toolCall = assistant.toolCalls.find((entry) => entry.name === REFINEMENT_TOOL_NAME);
  if (toolCall) {
    return parseRefinementArguments(toolCall.argumentsText);
  }

  return parseRefinementArguments(assistant.content);
}
