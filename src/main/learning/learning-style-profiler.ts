import type {
  AgentBackendToolDefinition,
  OpenAICompatibleBackendConfig,
} from "../agent/openai-compatible-backend.js";
import {
  defineAgent,
  requestDefinedAgentTurn,
} from "../agent/define-agent.js";
import type {
  LearningStyleProfile,
  LearningWritingSample,
} from "./types.js";

interface RefineLearningStyleProfileInput {
  backend: OpenAICompatibleBackendConfig;
  context: {
    profileId: string;
    workspaceId: string;
    domain: string;
    scheme?: string;
    pageType?: string;
    contextType: NonNullable<LearningStyleProfile["contextType"]>;
    contextLabel?: string;
    slot: NonNullable<LearningStyleProfile["slot"]>;
    slotLabel?: string;
    fieldHint?: string;
    recipientKey?: string;
    recipientLabel?: string;
    averageLength: number;
    existingProfile?: LearningStyleProfile | null;
    samples: LearningWritingSample[];
  };
  signal?: AbortSignal;
}

const STYLE_PROFILE_TOOL_NAME = "submit_style_profile";
const STYLE_PROFILE_TOOL: AgentBackendToolDefinition = {
  name: STYLE_PROFILE_TOOL_NAME,
  description: "Return the learned writing style profile for this browser writing surface.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      contextType: {
        type: "string",
        enum: ["email", "forum", "article_editor", "general_editor"],
      },
      contextLabel: {
        type: "string",
        description: "Short label for the writing context, such as Email or Forum reply.",
      },
      slot: {
        type: "string",
        enum: ["subject", "body", "title", "comment", "message", "recipient", "unknown"],
      },
      slotLabel: {
        type: "string",
        description: "Short label for the field role, such as Body, Comment, or Title.",
      },
      tone: {
        type: "string",
        description: "Short tone description grounded in the samples.",
      },
      formality: {
        type: "string",
        description: "Short register/formality description grounded in the samples.",
      },
      styleSummary: {
        type: "string",
        description: "Concise summary of the user's writing style for this surface.",
      },
      emailStyle: {
        type: "string",
        description: "Email-specific style summary when the context is email.",
      },
      forumStyle: {
        type: "string",
        description: "Forum-specific style summary when the context is forum.",
      },
      articleStyle: {
        type: "string",
        description: "Article-editor style summary when the context is article_editor.",
      },
      notesStyle: {
        type: "string",
        description: "Generic editor style summary when the context is general_editor.",
      },
      commonPhrases: {
        type: "array",
        items: { type: "string" },
        description: "Three to eight short recurring phrases or verbal habits grounded in the samples.",
      },
      exemplarSnippets: {
        type: "array",
        items: { type: "string" },
        description: "One to three short representative snippets copied or minimally trimmed from the samples.",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Confidence from 0 to 1 based on consistency and sample coverage.",
      },
    },
    required: [
      "contextType",
      "contextLabel",
      "slot",
      "slotLabel",
      "styleSummary",
      "commonPhrases",
      "exemplarSnippets",
      "confidence",
    ],
  },
};

const learningStyleProfilerAgent = defineAgent<undefined>({
  id: "learning-style-profiler",
  systemPrompt: [
    "You learn a user's writing style for browser input surfaces from observed writing samples.",
    "You must ground every conclusion in the provided samples and metadata.",
    "Do not use local heuristics. Infer the style directly from the writing examples.",
    "Keep output concise, structured, and useful for later drafting and polishing.",
    "If the samples are mixed, summarize only the stable shared characteristics and lower confidence.",
    "commonPhrases must be short phrases actually evidenced by the samples, not invented abstractions.",
    "exemplarSnippets must be short representative snippets from the samples, trimmed only when needed.",
    "If the context is email, distinguish the style for the observed recipient when recipient metadata is provided.",
    `Call ${STYLE_PROFILE_TOOL_NAME} exactly once with the final profile.`,
  ],
  tools: [STYLE_PROFILE_TOOL],
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

function parseContextType(value: unknown): LearningStyleProfile["contextType"] | undefined {
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

function parseSlot(value: unknown): LearningStyleProfile["slot"] | undefined {
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

function parseStyleProfileArguments(
  argumentsText: string,
  input: RefineLearningStyleProfileInput,
): LearningStyleProfile | null {
  try {
    const parsed = JSON.parse(argumentsText) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    const contextType = parseContextType(parsed.contextType) ?? input.context.contextType;
    const slot = parseSlot(parsed.slot) ?? input.context.slot;
    const commonPhrases = readStringArray(parsed.commonPhrases, 8, 48);
    const exemplarSnippets = readStringArray(parsed.exemplarSnippets, 3, 140);
    const confidence = readNumber(parsed.confidence);
    const styleSummary = readTrimmedString(parsed.styleSummary, 220);
    if (!contextType || !slot || !styleSummary || confidence === undefined) {
      return null;
    }

    return {
      assetKind: "style_profile",
      profileId: input.context.profileId,
      workspaceId: input.context.workspaceId,
      domain: input.context.domain,
      ...(input.context.scheme ? { scheme: input.context.scheme } : {}),
      ...(input.context.pageType ? { pageType: input.context.pageType } : {}),
      contextType,
      ...(readTrimmedString(parsed.contextLabel, 80) ?? input.context.contextLabel
        ? { contextLabel: readTrimmedString(parsed.contextLabel, 80) ?? input.context.contextLabel }
        : {}),
      slot,
      ...(readTrimmedString(parsed.slotLabel, 80) ?? input.context.slotLabel
        ? { slotLabel: readTrimmedString(parsed.slotLabel, 80) ?? input.context.slotLabel }
        : {}),
      ...(input.context.fieldHint ? { fieldHint: input.context.fieldHint } : {}),
      ...(input.context.recipientKey ? { recipientKey: input.context.recipientKey } : {}),
      ...(input.context.recipientLabel ? { recipientLabel: input.context.recipientLabel } : {}),
      ...(readTrimmedString(parsed.tone, 80) ? { tone: readTrimmedString(parsed.tone, 80) } : {}),
      ...(readTrimmedString(parsed.formality, 80) ? { formality: readTrimmedString(parsed.formality, 80) } : {}),
      ...(readTrimmedString(parsed.emailStyle, 220) ? { emailStyle: readTrimmedString(parsed.emailStyle, 220) } : {}),
      ...(readTrimmedString(parsed.forumStyle, 220) ? { forumStyle: readTrimmedString(parsed.forumStyle, 220) } : {}),
      ...(readTrimmedString(parsed.articleStyle, 220) ? { articleStyle: readTrimmedString(parsed.articleStyle, 220) } : {}),
      ...(readTrimmedString(parsed.notesStyle, 220) ? { notesStyle: readTrimmedString(parsed.notesStyle, 220) } : {}),
      styleSummary,
      commonPhrases,
      exemplarSnippets,
      exemplarCount: input.context.samples.length,
      averageLength: Math.max(0, Math.floor(input.context.averageLength)),
      confidence: Math.max(0, Math.min(1, confidence)),
      lastUpdatedAt: input.context.samples[0]?.ts ?? Date.now(),
    };
  } catch {
    return null;
  }
}

function buildEvidencePayload(input: RefineLearningStyleProfileInput) {
  return {
    surface: {
      profileId: input.context.profileId,
      domain: input.context.domain,
      scheme: input.context.scheme,
      pageType: input.context.pageType,
      contextType: input.context.contextType,
      contextLabel: input.context.contextLabel,
      slot: input.context.slot,
      slotLabel: input.context.slotLabel,
      fieldHint: input.context.fieldHint,
      recipientKey: input.context.recipientKey,
      recipientLabel: input.context.recipientLabel,
      averageLength: input.context.averageLength,
      sampleCount: input.context.samples.length,
    },
    existingProfile: input.context.existingProfile
      ? {
          tone: input.context.existingProfile.tone,
          formality: input.context.existingProfile.formality,
          styleSummary: input.context.existingProfile.styleSummary,
          emailStyle: input.context.existingProfile.emailStyle,
          forumStyle: input.context.existingProfile.forumStyle,
          articleStyle: input.context.existingProfile.articleStyle,
          notesStyle: input.context.existingProfile.notesStyle,
          commonPhrases: input.context.existingProfile.commonPhrases,
          exemplarSnippets: input.context.existingProfile.exemplarSnippets,
          confidence: input.context.existingProfile.confidence,
        }
      : null,
    samples: input.context.samples.map((sample) => ({
      ts: sample.ts,
      url: sample.url,
      pageTitle: sample.pageTitle,
      fieldHint: sample.fieldHint,
      recipientLabel: sample.recipientLabel,
      charCount: sample.charCount,
      wordCount: sample.wordCount,
      text: sample.text,
    })),
  };
}

export async function refineLearningStyleProfileWithLlm(input: RefineLearningStyleProfileInput) {
  const assistant = await requestDefinedAgentTurn({
    agent: learningStyleProfilerAgent,
    context: undefined,
    backend: input.backend,
    messages: [
      {
        role: "user",
        content: [
          "Learn a writing style profile for this browser input surface from the evidence JSON below.",
          "The output must stay grounded in the observed samples.",
          JSON.stringify(buildEvidencePayload(input), null, 2),
        ].join("\n\n"),
      },
    ],
    signal: input.signal,
  });

  const toolCall = assistant.toolCalls.find((entry) => entry.name === STYLE_PROFILE_TOOL_NAME);
  if (toolCall) {
    return parseStyleProfileArguments(toolCall.argumentsText, input);
  }

  return parseStyleProfileArguments(assistant.content, input);
}
