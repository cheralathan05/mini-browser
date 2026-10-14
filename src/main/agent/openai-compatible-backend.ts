import OpenAI, { APIError } from "openai";

const AGENT_REQUEST_MAX_RETRY_COUNT = 10;
const AGENT_REQUEST_INITIAL_RETRY_DELAY_MS = 1_000;
const AGENT_REQUEST_MAX_RETRY_DELAY_MS = 30_000;
const AGENT_DEFAULT_MAX_TOKENS = 16_384;
const AGENT_OPENAI_SDK_TIMEOUT_MS = 2_147_483_647;
const DEFAULT_INTERLEAVED_THINKING_FIELD_NAME = "reasoning_content";

export interface OpenAICompatibleBackendConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  providerId?: string;
  providerName?: string;
  extraBodyEnabled?: boolean;
  extraBody?: Record<string, unknown>;
  extraHeadersEnabled?: boolean;
  extraHeaders?: OpenAICompatibleRequestHeaders;
  extractThinkingContent?: boolean;
  thinkingContentTagName?: string;
  interleavedThinkingEnabled?: boolean;
  interleavedThinkingFieldName?: string;
  source: "env" | "agent-settings" | "image-agent-settings" | "translation-settings";
}

export interface OpenAICompatibleRequestHeaders {
  [headerName: string]: string;
}

export interface AgentBackendToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type OpenAICompatibleContentPart =
  | {
    type: "text";
    text: string;
  }
  | {
    type: "image_url";
    image_url: {
      url: string;
      detail?: "auto" | "low" | "high";
    };
  };

export type OpenAICompatibleToolChoice =
  | "auto"
  | "none"
  | {
    type: "function";
    function: {
      name: string;
    };
  };

export type OpenAICompatibleChatMessage =
  | {
    role: "system" | "user";
    content: string | OpenAICompatibleContentPart[];
  }
  | {
    role: "assistant";
    content: string | null;
    thinkingContent?: string;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: {
        name: string;
        arguments: string;
      };
    }>;
  }
  | {
    role: "tool";
    content: string;
    tool_call_id: string;
  };

export interface OpenAICompatibleAssistantToolCall {
  id: string;
  name: string;
  argumentsText: string;
}

export interface OpenAICompatibleAssistantResponse {
  content: string;
  thinkingContent: string;
  toolCalls: OpenAICompatibleAssistantToolCall[];
}

interface StreamingToolCallAccumulator {
  id: string;
  name: string;
  argumentsText: string;
}

class AgentBackendRequestError extends Error {
  status?: number;
  retryable: boolean;

  constructor(message: string, options?: { status?: number; retryable?: boolean }) {
    super(message);
    this.name = "AgentBackendRequestError";
    this.status = options?.status;
    this.retryable = options?.retryable ?? true;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createAbortError(reason?: unknown): Error {
  return reason instanceof Error ? reason : new Error("Agent request aborted.");
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createAbortError(signal.reason);
  }
}

function calculateRetryDelayMs(retryIndex: number) {
  return Math.min(
    AGENT_REQUEST_INITIAL_RETRY_DELAY_MS * (2 ** retryIndex),
    AGENT_REQUEST_MAX_RETRY_DELAY_MS,
  );
}

function normalizeRequestHeaders(headers?: OpenAICompatibleRequestHeaders) {
  if (!headers) {
    return {};
  }

  const normalizedHeaders: Record<string, string> = {};
  for (const [headerName, headerValue] of Object.entries(headers)) {
    const normalizedName = headerName.trim();
    const normalizedValue = headerValue.trim();
    if (!normalizedName || !normalizedValue) {
      continue;
    }
    normalizedHeaders[normalizedName] = normalizedValue;
  }
  return normalizedHeaders;
}

function normalizeExtraBody(value?: Record<string, unknown>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key.trim().length > 0),
  );
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractThinkingContentFromText(
  content: string,
  options: {
    enabled?: boolean;
    tagName?: string;
  },
) {
  if (!options.enabled || !content) {
    return {
      content: content.trim(),
      thinkingContent: "",
    };
  }

  const tagName = normalizeThinkingContentTagName(options.tagName);
  const thinkingParts: string[] = [];
  const pattern = new RegExp(
    `<\\s*${escapeRegExp(tagName)}(?:\\s[^>]*)?>` +
      `([\\s\\S]*?)` +
      `<\\s*\\/\\s*${escapeRegExp(tagName)}\\s*>`,
    "gi",
  );
  const strippedContent = content
    .replace(pattern, (_match, thinkingText: string) => {
      const normalizedThinkingText = thinkingText.trim();
      if (normalizedThinkingText) {
        thinkingParts.push(normalizedThinkingText);
      }
      return "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    content: strippedContent,
    thinkingContent: thinkingParts.join("\n\n"),
  };
}

function resolveOpenAIClientBaseURL(endpoint: string) {
  const trimmedEndpoint = endpoint.trim().replace(/\/+$/, "");
  return trimmedEndpoint.endsWith("/chat/completions")
    ? trimmedEndpoint.slice(0, -"/chat/completions".length)
    : trimmedEndpoint;
}

async function waitForRetryDelay(delayMs: number, signal?: AbortSignal) {
  if (delayMs <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abortDelay);
      resolve();
    }, delayMs);

    const abortDelay = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortDelay);
      reject(createAbortError(signal?.reason));
    };

    if (signal) {
      if (signal.aborted) {
        abortDelay();
        return;
      }
      signal.addEventListener("abort", abortDelay, { once: true });
    }
  });
}

function readContentText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }
      if (!isRecord(entry)) {
        return "";
      }
      if (typeof entry.text === "string") {
        return entry.text;
      }
      if (typeof entry.content === "string") {
        return entry.content;
      }
      return "";
    })
    .join("");
}

function appendStreamingToolCallDelta(
  toolCallsByIndex: Map<number, StreamingToolCallAccumulator>,
  value: unknown,
) {
  if (!Array.isArray(value)) {
    return;
  }

  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    const rawIndex = typeof entry.index === "number" && Number.isFinite(entry.index)
      ? Math.floor(entry.index)
      : toolCallsByIndex.size;
    const current = toolCallsByIndex.get(rawIndex) ?? {
      id: "",
      name: "",
      argumentsText: "",
    };

    if (typeof entry.id === "string" && entry.id.trim()) {
      current.id = entry.id.trim();
    }

    if (isRecord(entry.function)) {
      if (typeof entry.function.name === "string" && entry.function.name.trim()) {
        current.name = entry.function.name.trim();
      }
      if (typeof entry.function.arguments === "string") {
        current.argumentsText += entry.function.arguments;
      }
    }

    toolCallsByIndex.set(rawIndex, current);
  }
}

function normalizeSystemMessages(
  messages: OpenAICompatibleChatMessage[],
): OpenAICompatibleChatMessage[] {
  const systemContents: string[] = [];
  let firstSystemIndex = -1;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== "system") {
      continue;
    }

    if (firstSystemIndex === -1) {
      firstSystemIndex = index;
    }

    const content = typeof message.content === "string"
      ? message.content
      : readContentText(message.content);
    if (content.trim()) {
      systemContents.push(content);
    }
  }

  if (firstSystemIndex === -1) {
    return messages;
  }

  const mergedSystemMessage: OpenAICompatibleChatMessage = {
    role: "system",
    content: systemContents.join("\n\n"),
  };

  return messages.flatMap((message, index) => {
    if (message.role !== "system") {
      return [message];
    }
    if (index === firstSystemIndex) {
      return [mergedSystemMessage];
    }
    return [];
  });
}

function buildOpenAICompatibleRequestMessages(
  messages: OpenAICompatibleChatMessage[],
  backend: OpenAICompatibleBackendConfig,
): Array<Record<string, unknown> | OpenAICompatibleChatMessage> {
  const thinkingFieldName = normalizeInterleavedThinkingFieldName(backend.interleavedThinkingFieldName);

  return messages.map((message) => {
    if (message.role !== "assistant") {
      return message;
    }

    const { thinkingContent, ...requestMessage } = message;
    const normalizedThinkingContent = typeof thinkingContent === "string"
      ? thinkingContent.trim()
      : "";
    if (!backend.interleavedThinkingEnabled || !normalizedThinkingContent) {
      return requestMessage;
    }

    return {
      ...requestMessage,
      [thinkingFieldName]: normalizedThinkingContent,
    };
  });
}

export function stripToolSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stripToolSchema(entry));
  }

  if (!isRecord(value)) {
    return value;
  }

  const result: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (key === "$schema" || key === "$id" || key === "title") {
      continue;
    }
    result[key] = stripToolSchema(entry);
  }

  return result;
}

async function requestOpenAICompatibleAssistantTurnOnce(input: {
  backend: OpenAICompatibleBackendConfig;
  messages: OpenAICompatibleChatMessage[];
  tools: AgentBackendToolDefinition[];
  toolChoice?: OpenAICompatibleToolChoice;
  requestHeaders?: OpenAICompatibleRequestHeaders;
  signal?: AbortSignal;
}): Promise<OpenAICompatibleAssistantResponse> {
  const endpointLabel = input.backend.endpoint;
  const modelLabel = input.backend.model;
  const normalizedMessages = normalizeSystemMessages(input.messages);
  const requestMessages = buildOpenAICompatibleRequestMessages(normalizedMessages, input.backend);
  const requestHeaders = normalizeRequestHeaders(input.requestHeaders);
  const providerExtraHeaders = input.backend.extraHeadersEnabled
    ? normalizeRequestHeaders(input.backend.extraHeaders)
    : {};
  const providerExtraBody = input.backend.extraBodyEnabled
    ? normalizeExtraBody(input.backend.extraBody)
    : {};
  const interleavedThinkingFieldName = normalizeInterleavedThinkingFieldName(
    input.backend.interleavedThinkingFieldName,
  );

  if (input.signal?.aborted) {
    throw createAbortError(input.signal.reason);
  }

  try {
    const client = new OpenAI({
      apiKey: input.backend.apiKey || "ollama",
      baseURL: resolveOpenAIClientBaseURL(endpointLabel),
      maxRetries: 0,
      timeout: AGENT_OPENAI_SDK_TIMEOUT_MS,
    });
    const body: Record<string, unknown> = {
      model: input.backend.model,
      max_tokens: AGENT_DEFAULT_MAX_TOKENS,
      messages: requestMessages,
      stream: true,
    };

    if (input.tools.length > 0) {
      body.tools = input.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: stripToolSchema(tool.parameters),
        },
      }));
      if (input.toolChoice !== undefined) {
        body.tool_choice = input.toolChoice;
      }
    }

    const stream = await client.chat.completions.create({
      ...body,
      ...providerExtraBody,
    } as unknown as OpenAI.Chat.ChatCompletionCreateParamsStreaming, {
      headers: {
        accept: "text/event-stream",
        ...providerExtraHeaders,
        ...requestHeaders,
      },
      signal: input.signal,
    });

    const contentParts: string[] = [];
    const fieldThinkingParts: string[] = [];
    const toolCallsByIndex = new Map<number, StreamingToolCallAccumulator>();
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) {
        continue;
      }
      if (input.backend.interleavedThinkingEnabled && isRecord(delta)) {
        const fieldThinkingDelta = readContentText(delta[interleavedThinkingFieldName]);
        if (fieldThinkingDelta) {
          fieldThinkingParts.push(fieldThinkingDelta);
        }
      }
      if (typeof delta.content === "string") {
        contentParts.push(delta.content);
      } else if (Array.isArray(delta.content)) {
        contentParts.push(readContentText(delta.content));
      }
      appendStreamingToolCallDelta(toolCallsByIndex, delta.tool_calls);
    }

    const toolCalls = Array.from(toolCallsByIndex.entries())
      .sort(([left], [right]) => left - right)
      .flatMap(([, entry]) => {
        if (!entry.id || !entry.name) {
          return [];
        }
        return [{
          id: entry.id,
          name: entry.name,
          argumentsText: entry.argumentsText || "{}",
        }];
      });

    const extractedContent = extractThinkingContentFromText(contentParts.join(""), {
      enabled: input.backend.extractThinkingContent,
      tagName: input.backend.thinkingContentTagName,
    });
    const fieldThinkingContent = fieldThinkingParts.join("").trim();

    return {
      content: extractedContent.content,
      thinkingContent: [fieldThinkingContent, extractedContent.thinkingContent]
        .filter((entry) => entry.length > 0)
        .join("\n\n"),
      toolCalls,
    };
  } catch (error) {
    if (input.signal?.aborted) {
      throw createAbortError(input.signal.reason);
    }
    if (error instanceof AgentBackendRequestError) {
      throw error;
    }
    if (error instanceof APIError) {
      const status = error.status;
      throw new AgentBackendRequestError(
        `Agent backend request failed (${status ?? "unknown"}) for model "${modelLabel}" at ${endpointLabel}: ${error.message}`,
        {
          status,
          retryable: status !== 400,
        },
      );
    }
    if (error instanceof Error) {
      throw new AgentBackendRequestError(error.message);
    }
    throw new AgentBackendRequestError(`Agent backend request failed for model "${modelLabel}" at ${endpointLabel}.`);
  }
}

export async function requestOpenAICompatibleAssistantTurn(input: {
  backend: OpenAICompatibleBackendConfig;
  messages: OpenAICompatibleChatMessage[];
  tools: AgentBackendToolDefinition[];
  toolChoice?: OpenAICompatibleToolChoice;
  requestHeaders?: OpenAICompatibleRequestHeaders;
  signal?: AbortSignal;
}): Promise<OpenAICompatibleAssistantResponse> {
  const endpointLabel = input.backend.endpoint;

  for (let retryIndex = 0; retryIndex <= AGENT_REQUEST_MAX_RETRY_COUNT; retryIndex += 1) {
    throwIfAborted(input.signal);

    try {
      return await requestOpenAICompatibleAssistantTurnOnce(input);
    } catch (error) {
      if (input.signal?.aborted) {
        throw createAbortError(input.signal.reason);
      }

      const requestError =
        error instanceof AgentBackendRequestError
          ? error
          : new AgentBackendRequestError(error instanceof Error ? error.message : "Agent backend request failed.");

      if (!requestError.retryable || retryIndex >= AGENT_REQUEST_MAX_RETRY_COUNT) {
        throw new Error(`Agent request via ${endpointLabel} failed: ${requestError.message}`);
      }

      const delayMs = calculateRetryDelayMs(retryIndex);
      console.warn(
        `[Agent] LLM request attempt ${retryIndex + 1} failed for ${endpointLabel}. Retrying in ${delayMs}ms.`,
        requestError,
      );
      await waitForRetryDelay(delayMs, input.signal);
    }
  }

  throw new Error(`Agent request via ${endpointLabel} failed after ${AGENT_REQUEST_MAX_RETRY_COUNT + 1} attempts.`);
}
