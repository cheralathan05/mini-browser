import type { AgentPreferences, LlmProvider } from "../state/app-settings.js";
import type { TranslationPreferences } from "../shared/translation.js";
import type { OpenAICompatibleBackendConfig } from "./openai-compatible-backend.js";

interface ResolveOpenAICompatibleBackendConfigInput {
  getAgentPreferences: () => AgentPreferences;
  getLlmProviders: () => LlmProvider[];
  getTranslationPreferences: () => TranslationPreferences;
  env?: NodeJS.ProcessEnv;
  providerIdOverride?: string | null;
  modelOverride?: string | null;
}

function resolveLlmProviderModelSettings(provider: LlmProvider, model: string) {
  const normalizedModel = model.trim();
  return normalizedModel && provider.modelSettings[normalizedModel]
    ? provider.modelSettings[normalizedModel]
    : {
        extraBodyEnabled: provider.extraBodyEnabled,
        extraBody: provider.extraBody,
        extraHeadersEnabled: provider.extraHeadersEnabled,
        extraHeaders: provider.extraHeaders,
        extractThinkingContent: provider.extractThinkingContent,
        thinkingContentTagName: provider.thinkingContentTagName,
        interleavedThinkingEnabled: provider.interleavedThinkingEnabled,
        interleavedThinkingFieldName: provider.interleavedThinkingFieldName,
      };
}

function isLocalEndpoint(url?: string) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower.includes("localhost") || lower.includes("127.0.0.1") || lower.includes("11434") || lower.includes(":8001");
}

export function resolveOpenAICompatibleBackendConfig(
  input: ResolveOpenAICompatibleBackendConfigInput,
): OpenAICompatibleBackendConfig | null {
  // 1. Explicit MILO_AGENT_* environment variables
  const envEndpoint = input.env?.MILO_AGENT_ENDPOINT?.trim();
  const envApiKey = input.env?.MILO_AGENT_API_KEY?.trim();
  const envModel = input.env?.MILO_AGENT_MODEL?.trim();
  if (envEndpoint && envApiKey && envModel) {
    return {
      endpoint: envEndpoint,
      apiKey: envApiKey,
      model: envModel,
      providerName: "env",
      source: "env",
    };
  }

  // 2. Explicit OPENAI_API_KEY environment variable
  const envOpenAiKey = input.env?.OPENAI_API_KEY?.trim();
  if (envOpenAiKey) {
    return {
      endpoint: input.env?.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1/chat/completions",
      apiKey: envOpenAiKey,
      model: input.env?.OPENAI_MODEL?.trim() || "gpt-4o-mini",
      providerName: "OpenAI",
      source: "env",
    };
  }

  // 3. User configured LLM provider from settings
  const agent = input.getAgentPreferences();
  const providerId = input.providerIdOverride?.trim() || agent.providerId;
  const provider = input.getLlmProviders().find((entry) => entry.id === providerId);
  const model = input.modelOverride?.trim() || agent.model.trim() || provider?.models?.[0];
  if (provider?.baseUrl.trim() && (provider.apiKey.trim() || isLocalEndpoint(provider.baseUrl)) && model) {
    const modelSettings = resolveLlmProviderModelSettings(provider, model);
    return {
      endpoint: provider.baseUrl.trim(),
      apiKey: provider.apiKey.trim() || "ollama",
      model,
      providerId: provider.id,
      providerName: provider.name,
      extraBodyEnabled: modelSettings.extraBodyEnabled,
      extraBody: modelSettings.extraBody,
      extraHeadersEnabled: modelSettings.extraHeadersEnabled,
      extraHeaders: modelSettings.extraHeaders,
      extractThinkingContent: modelSettings.extractThinkingContent,
      thinkingContentTagName: modelSettings.thinkingContentTagName,
      interleavedThinkingEnabled: modelSettings.interleavedThinkingEnabled,
      interleavedThinkingFieldName: modelSettings.interleavedThinkingFieldName,
      source: "agent-settings",
    };
  }

  // 4. Translation settings fallback
  const translation = input.getTranslationPreferences();
  const openAISettings = translation.sources["openai-compatible"];
  if (
    translation.provider === "openai-compatible"
    && openAISettings.endpoint.trim()
    && (openAISettings.apiKey.trim() || isLocalEndpoint(openAISettings.endpoint))
    && openAISettings.model.trim()
  ) {
    const translationProviderId = openAISettings.providerId.trim();
    const translationProvider = translationProviderId
      ? input.getLlmProviders().find((entry) => entry.id === translationProviderId)
      : null;
    return {
      endpoint: openAISettings.endpoint.trim(),
      apiKey: openAISettings.apiKey.trim() || "ollama",
      model: openAISettings.model.trim(),
      ...(translationProviderId ? { providerId: translationProviderId } : {}),
      ...(translationProvider?.name
        ? { providerName: translationProvider.name }
        : translationProviderId ? {} : { providerName: "translation" }),
      extraBodyEnabled: openAISettings.extraBodyEnabled,
      extraBody: openAISettings.extraBody,
      extraHeadersEnabled: openAISettings.extraHeadersEnabled,
      extraHeaders: openAISettings.extraHeaders,
      extractThinkingContent: openAISettings.extractThinkingContent,
      thinkingContentTagName: openAISettings.thinkingContentTagName,
      interleavedThinkingEnabled: openAISettings.interleavedThinkingEnabled,
      interleavedThinkingFieldName: openAISettings.interleavedThinkingFieldName,
      source: "translation-settings",
    };
  }

  // 5. Fallback to local Ollama (from OLLAMA_URL or default local 11434)
  const ollamaUrl = input.env?.OLLAMA_URL?.trim() || "http://localhost:11434";
  const ollamaModel = input.env?.OLLAMA_MODEL?.trim() || "qwen3:8b";
  return {
    endpoint: `${ollamaUrl.replace(/\/+$/, "")}/v1/chat/completions`,
    apiKey: "ollama",
    model: ollamaModel,
    providerName: "Ollama (Local)",
    source: "env",
  };
}
