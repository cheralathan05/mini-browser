import type {
  AgentBackendToolDefinition,
  OpenAICompatibleBackendConfig,
} from "../agent/openai-compatible-backend.js";
import {
  defineAgent,
  requestDefinedAgentTurn,
} from "../agent/define-agent.js";
import type {
  LearningHistoryProfile,
  LearningHistoryProfileContext,
  LearningHistorySiteSummary,
} from "./types.js";

interface RefineLearningHistoryProfileInput {
  backend: OpenAICompatibleBackendConfig;
  context: LearningHistoryProfileContext;
  signal?: AbortSignal;
}

const HISTORY_PROFILE_TOOL_NAME = "submit_history_profile";
const HISTORY_PROFILE_TOOL: AgentBackendToolDefinition = {
  name: HISTORY_PROFILE_TOOL_NAME,
  description: "Return the learned browsing-history profile for one site.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      activityLevel: {
        type: "string",
        enum: ["high", "medium", "low"],
      },
      revisitPattern: {
        type: "string",
        enum: ["habitual", "balanced", "exploratory"],
      },
      profileSummary: {
        type: "string",
        description: "A concise summary of how this site is typically used based on the browsing history evidence.",
      },
      commonIntents: {
        type: "array",
        items: { type: "string" },
        description: "Two to five recurring intents or tasks this browsing history suggests for the site.",
      },
      revisitDrivers: {
        type: "array",
        items: { type: "string" },
        description: "One to five likely reasons the site gets revisited, grounded in the observed pages and frequency.",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
      },
    },
    required: [
      "activityLevel",
      "revisitPattern",
      "profileSummary",
      "commonIntents",
      "revisitDrivers",
      "confidence",
    ],
  },
};

const learningHistoryProfilerAgent = defineAgent<undefined>({
  id: "learning-history-profiler",
  systemPrompt: [
    "You learn a browsing-history profile for one site from observed visit records.",
    "You must ground every conclusion in the provided counts, timestamps, and top pages.",
    "Do not use local heuristics. Infer the profile directly from the evidence.",
    "Common intents should describe what the user appears to do on the site, not generic site categories.",
    "Revisit drivers should describe why the site is repeatedly revisited, grounded in the top pages and recency pattern.",
    "Keep the output concise and specific.",
    `Call ${HISTORY_PROFILE_TOOL_NAME} exactly once with the final history profile.`,
  ],
  tools: [HISTORY_PROFILE_TOOL],
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

function readStringArray(value: unknown, limit: number, maxLength: number) {
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

function parseActivityLevel(value: unknown): LearningHistorySiteSummary["activityLevel"] | undefined {
  switch (value) {
    case "high":
    case "medium":
    case "low":
      return value;
    default:
      return undefined;
  }
}

function parseRevisitPattern(value: unknown): LearningHistorySiteSummary["revisitPattern"] | undefined {
  switch (value) {
    case "habitual":
    case "balanced":
    case "exploratory":
      return value;
    default:
      return undefined;
  }
}

function parseHistoryProfileArguments(
  argumentsText: string,
  input: RefineLearningHistoryProfileInput,
): LearningHistoryProfile | null {
  try {
    const parsed = JSON.parse(argumentsText) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    const activityLevel = parseActivityLevel(parsed.activityLevel)
      ?? input.context.existingProfile?.activityLevel;
    const revisitPattern = parseRevisitPattern(parsed.revisitPattern)
      ?? input.context.existingProfile?.revisitPattern;
    const profileSummary = readTrimmedString(parsed.profileSummary, 220);
    const confidence = readNumber(parsed.confidence);
    if (!activityLevel || !revisitPattern || !profileSummary || confidence === undefined) {
      return null;
    }

    return {
      assetKind: "history_profile",
      profileId: input.context.profileId,
      scopeKey: input.context.scopeKey,
      ...(input.context.workspaceId ? { workspaceId: input.context.workspaceId } : {}),
      domain: input.context.summary.domain,
      activityLevel,
      revisitPattern,
      profileSummary,
      commonIntents: readStringArray(parsed.commonIntents, 5, 80),
      revisitDrivers: readStringArray(parsed.revisitDrivers, 5, 100),
      confidence: Math.max(0, Math.min(1, confidence)),
      recordHash: input.context.recordHash,
      lastUpdatedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

function buildEvidencePayload(input: RefineLearningHistoryProfileInput) {
  return {
    site: {
      profileId: input.context.profileId,
      scopeKey: input.context.scopeKey,
      workspaceId: input.context.workspaceId,
      domain: input.context.summary.domain,
      visitCount: input.context.summary.visitCount,
      uniquePageCount: input.context.summary.uniquePageCount,
      observedDayCount: input.context.summary.observedDayCount,
      firstSeenAt: input.context.summary.firstSeenAt,
      lastVisitedAt: input.context.summary.lastVisitedAt,
    },
    existingProfile: input.context.existingProfile
      ? {
          activityLevel: input.context.existingProfile.activityLevel,
          revisitPattern: input.context.existingProfile.revisitPattern,
          profileSummary: input.context.existingProfile.profileSummary,
          commonIntents: input.context.existingProfile.commonIntents,
          revisitDrivers: input.context.existingProfile.revisitDrivers,
          confidence: input.context.existingProfile.confidence,
        }
      : null,
    topPages: input.context.summary.topPages.map((page) => ({
      title: page.title,
      url: page.url,
      visitCount: page.visitCount,
      lastVisitedAt: page.lastVisitedAt,
    })),
  };
}

export async function refineLearningHistoryProfileWithLlm(input: RefineLearningHistoryProfileInput) {
  const assistant = await requestDefinedAgentTurn({
    agent: learningHistoryProfilerAgent,
    context: undefined,
    backend: input.backend,
    messages: [
      {
        role: "user",
        content: [
          "Learn a browsing-history profile for this site from the evidence JSON below.",
          "The result must stay grounded in the observed visit pattern and top pages.",
          JSON.stringify(buildEvidencePayload(input), null, 2),
        ].join("\n\n"),
      },
    ],
    signal: input.signal,
  });

  const toolCall = assistant.toolCalls.find((entry) => entry.name === HISTORY_PROFILE_TOOL_NAME);
  if (toolCall) {
    return parseHistoryProfileArguments(toolCall.argumentsText, input);
  }

  return parseHistoryProfileArguments(assistant.content, input);
}
