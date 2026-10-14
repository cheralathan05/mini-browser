import {
  requestOpenAICompatibleAssistantTurn,
  type AgentBackendToolDefinition,
  type OpenAICompatibleAssistantResponse,
  type OpenAICompatibleBackendConfig,
  type OpenAICompatibleChatMessage,
  type OpenAICompatibleRequestHeaders,
  type OpenAICompatibleToolChoice,
} from "./openai-compatible-backend.js";

type AgentDefinitionValue<TContext, TValue> =
  | TValue
  | ((context: TContext) => TValue);

export interface AgentDefinition<
  TContext,
  TTool extends AgentBackendToolDefinition = AgentBackendToolDefinition,
> {
  id: string;
  systemPrompt?: AgentDefinitionValue<TContext, string | string[]>;
  tools?: AgentDefinitionValue<TContext, readonly TTool[]>;
  model?: AgentDefinitionValue<TContext, string | undefined>;
  toolChoice?: AgentDefinitionValue<TContext, OpenAICompatibleToolChoice | undefined>;
}

export function defineAgent<
  TContext,
  TTool extends AgentBackendToolDefinition = AgentBackendToolDefinition,
>(definition: AgentDefinition<TContext, TTool>) {
  return definition;
}

function resolveAgentDefinitionValue<TContext, TValue>(
  value: AgentDefinitionValue<TContext, TValue>,
  context: TContext,
) {
  return typeof value === "function"
    ? (value as (input: TContext) => TValue)(context)
    : value;
}

export function resolveAgentSystemMessages<TContext>(
  agent: AgentDefinition<TContext>,
  context: TContext,
): OpenAICompatibleChatMessage[] {
  if (!agent.systemPrompt) {
    return [];
  }

  const prompt = resolveAgentDefinitionValue(agent.systemPrompt, context);
  const parts = Array.isArray(prompt) ? prompt : [prompt];
  return parts
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((content) => ({
      role: "system" as const,
      content,
    }));
}

export function resolveAgentTools<
  TContext,
  TTool extends AgentBackendToolDefinition = AgentBackendToolDefinition,
>(
  agent: AgentDefinition<TContext, TTool>,
  context: TContext,
): TTool[] {
  if (!agent.tools) {
    return [];
  }

  return [...resolveAgentDefinitionValue(agent.tools, context)];
}

export function resolveAgentModel<TContext>(
  agent: AgentDefinition<TContext>,
  context: TContext,
) {
  if (!agent.model) {
    return undefined;
  }

  const resolved = resolveAgentDefinitionValue(agent.model, context);
  return resolved?.trim() ? resolved.trim() : undefined;
}

export function resolveAgentToolChoice<TContext>(
  agent: AgentDefinition<TContext>,
  context: TContext,
) {
  if (!agent.toolChoice) {
    return undefined;
  }

  return resolveAgentDefinitionValue(agent.toolChoice, context);
}

export function resolveAgentBackendConfig<TContext>(
  agent: AgentDefinition<TContext>,
  context: TContext,
  backend: OpenAICompatibleBackendConfig,
): OpenAICompatibleBackendConfig {
  const model = resolveAgentModel(agent, context);
  return model
    ? {
        ...backend,
        model,
      }
    : backend;
}

export async function requestDefinedAgentTurn<
  TContext,
  TTool extends AgentBackendToolDefinition = AgentBackendToolDefinition,
>(input: {
  agent: AgentDefinition<TContext, TTool>;
  context: TContext;
  backend: OpenAICompatibleBackendConfig;
  messages: OpenAICompatibleChatMessage[];
  toolChoice?: OpenAICompatibleToolChoice;
  requestHeaders?: OpenAICompatibleRequestHeaders;
  signal?: AbortSignal;
}): Promise<OpenAICompatibleAssistantResponse> {
  return requestOpenAICompatibleAssistantTurn({
    backend: resolveAgentBackendConfig(input.agent, input.context, input.backend),
    messages: [
      ...resolveAgentSystemMessages(input.agent, input.context),
      ...input.messages,
    ],
    tools: resolveAgentTools(input.agent, input.context),
    toolChoice: input.toolChoice ?? resolveAgentToolChoice(input.agent, input.context),
    requestHeaders: input.requestHeaders,
    signal: input.signal,
  });
}
