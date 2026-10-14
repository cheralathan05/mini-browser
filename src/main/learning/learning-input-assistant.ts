import type { OpenAICompatibleBackendConfig } from "../agent/openai-compatible-backend.js";
import {
  defineAgent,
  requestDefinedAgentTurn,
} from "../agent/define-agent.js";
import type {
  LearningInputAssistActionInput,
  LearningInputAssistContext,
} from "./types.js";

interface GenerateLearningInputAssistTextInput {
  backend: OpenAICompatibleBackendConfig;
  context: LearningInputAssistContext;
  request: LearningInputAssistActionInput;
  signal?: AbortSignal;
}

const learningInputAssistantAgent = defineAgent<undefined>({
  id: "learning-input-assistant",
  systemPrompt: [
    "You draft or polish text for a browser input field.",
    "Match the learned user style when a style profile is provided.",
    "Stay grounded in the user's existing text, explicit instructions, recipient context, and page surface.",
    "Do not invent facts, commitments, names, or dates that were not provided.",
    "If polishing, preserve the user's meaning while improving clarity and fit for the surface.",
    "If drafting, write only the requested content package and keep it ready to paste into the target field.",
    "Return plain text only. Do not wrap the answer in quotes, markdown, or commentary.",
  ],
});

function truncateText(value: string, maxLength = 4_000) {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }
  void maxLength;
  return normalized;
}

function buildPrompt(input: GenerateLearningInputAssistTextInput) {
  const styleProfile = input.context.styleProfile;
  const lines: string[] = [
    `Mode: ${input.request.mode}`,
    ...(input.request.url ? [`Page URL: ${input.request.url}`] : []),
    ...(input.request.pageTitle ? [`Page title: ${input.request.pageTitle}`] : []),
    ...(input.context.domain ? [`Domain: ${input.context.domain}`] : []),
    ...(input.context.contextLabel ? [`Surface: ${input.context.contextLabel}`] : []),
    ...(input.context.slotLabel ? [`Field role: ${input.context.slotLabel}`] : []),
    ...(input.context.recipientLabel ? [`Recipient: ${input.context.recipientLabel}`] : []),
    ...(input.request.fieldHint ? [`Field hint: ${input.request.fieldHint}`] : []),
    ...(input.request.placeholder ? [`Placeholder: ${input.request.placeholder}`] : []),
  ];

  if (styleProfile) {
    lines.push("Learned style profile:");
    if (styleProfile.styleSummary) {
      lines.push(`- Summary: ${styleProfile.styleSummary}`);
    }
    if (styleProfile.tone) {
      lines.push(`- Tone: ${styleProfile.tone}`);
    }
    if (styleProfile.formality) {
      lines.push(`- Formality: ${styleProfile.formality}`);
    }
    if (styleProfile.commonPhrases.length > 0) {
      lines.push(`- Common phrases: ${styleProfile.commonPhrases.join(" | ")}`);
    }
    if (styleProfile.exemplarSnippets.length > 0) {
      lines.push(`- Example snippets: ${styleProfile.exemplarSnippets.join(" | ")}`);
    }
    lines.push(`- Average length: ${styleProfile.averageLength}`);
  }

  if (input.request.mode === "polish") {
    lines.push("Task: polish the current field content for the same surface and learned style.");
    lines.push(`Current text:\n${truncateText(input.request.currentText || "")}`);
  } else {
    lines.push("Task: draft new content for this field.");
    if (input.request.currentText?.trim()) {
      lines.push(`Existing field text to incorporate if useful:\n${truncateText(input.request.currentText)}`);
    }
    lines.push(`Draft brief:\n${truncateText(input.request.instruction || "")}`);
  }

  return lines.join("\n");
}

export async function generateLearningInputAssistText(input: GenerateLearningInputAssistTextInput) {
  const timeoutSignal = AbortSignal.timeout(45_000);
  const signal = input.signal
    ? AbortSignal.any([input.signal, timeoutSignal])
    : timeoutSignal;

  const assistant = await requestDefinedAgentTurn({
    agent: learningInputAssistantAgent,
    context: undefined,
    backend: input.backend,
    messages: [
      {
        role: "user",
        content: buildPrompt(input),
      },
    ],
    signal,
  });

  const text = assistant.content.trim();
  return text || null;
}
