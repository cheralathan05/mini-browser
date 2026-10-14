import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { app, nativeTheme, safeStorage } from "electron";
import {
  normalizeTranslationPreferences,
  type TranslationPreferences,
  type TranslationUiLocale,
} from "../shared/translation.js";

export type AppTheme = "system" | "light" | "dark";
export type AppLanguage = "system" | "en-US" | "zh-CN";
export type ResolvedColorScheme = Exclude<AppTheme, "system">;

const SECURE_SETTING_PREFIX = "milo-secure-setting:v1:";
let warnedAboutUnavailableSecureStorage = false;

function warnAboutUnavailableSecureStorage() {
  if (warnedAboutUnavailableSecureStorage) return;
  warnedAboutUnavailableSecureStorage = true;
  console.warn(
    "[Settings] OS credential encryption is unavailable; sensitive values will not be persisted.",
  );
}

function isSensitiveSettingKey(key: string) {
  const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return normalizedKey.endsWith("apikey")
    || normalizedKey.endsWith("password")
    || normalizedKey.endsWith("secret")
    || normalizedKey.endsWith("token")
    || normalizedKey === "authorization"
    || normalizedKey === "cookie"
    || normalizedKey === "cookies"
    || normalizedKey === "credential"
    || normalizedKey === "credentials"
    || normalizedKey === "extraheaders"
    || normalizedKey === "extraheaderstext"
    || normalizedKey === "defaultheaderstext"
    || normalizedKey === "downloadheaderstext";
}

function emptySecretValue(value: unknown): unknown {
  if (Array.isArray(value)) return [];
  if (value && typeof value === "object") return {};
  if (typeof value === "string") return "";
  return null;
}

function protectSettingsSecretsForStorage(value: unknown, key = ""): unknown {
  if (key && isSensitiveSettingKey(key)) {
    if (value === "" || value === null || value === undefined) {
      return value ?? "";
    }
    if (!safeStorage.isEncryptionAvailable()) {
      warnAboutUnavailableSecureStorage();
      return emptySecretValue(value);
    }
    try {
      const encrypted = safeStorage.encryptString(JSON.stringify(value));
      return `${SECURE_SETTING_PREFIX}${encrypted.toString("base64")}`;
    } catch {
      return emptySecretValue(value);
    }
  }
  if (Array.isArray(value)) {
    return value.map((entry) => protectSettingsSecretsForStorage(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(
      ([entryKey, entryValue]) => [entryKey, protectSettingsSecretsForStorage(entryValue, entryKey)],
    ));
  }
  return value;
}

function revealSettingsSecretsFromStorage(value: unknown): unknown {
  if (typeof value === "string" && value.startsWith(SECURE_SETTING_PREFIX)) {
    if (!safeStorage.isEncryptionAvailable()) {
      warnAboutUnavailableSecureStorage();
      return "";
    }
    try {
      const encrypted = Buffer.from(value.slice(SECURE_SETTING_PREFIX.length), "base64");
      return JSON.parse(safeStorage.decryptString(encrypted)) as unknown;
    } catch {
      return "";
    }
  }
  if (Array.isArray(value)) {
    return value.map((entry) => revealSettingsSecretsFromStorage(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(
      ([entryKey, entryValue]) => [entryKey, revealSettingsSecretsFromStorage(entryValue)],
    ));
  }
  return value;
}

export interface LlmProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  extraBodyEnabled: boolean;
  extraBody: Record<string, unknown>;
  extraHeadersEnabled: boolean;
  extraHeaders: Record<string, string>;
  extractThinkingContent: boolean;
  thinkingContentTagName: string;
  interleavedThinkingEnabled: boolean;
  interleavedThinkingFieldName: string;
  modelSettings: Record<string, LlmProviderModelSettings>;
}

export interface LlmProviderModelSettings {
  extraBodyEnabled: boolean;
  extraBody: Record<string, unknown>;
  extraHeadersEnabled: boolean;
  extraHeaders: Record<string, string>;
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

export type LearningMode = "off" | "on";

export interface LearningPreferences extends AgentModelPreferences {
  mode: LearningMode;
  redactTextInput: boolean;
  retentionDays: number;
  blacklistDomains: string[];
}

export interface StartPageDockItem {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  createdAt: number;
}

export interface StartPageAppearance {
  backgroundImage: string | null;
}

export interface StartPageWidgetBase {
  gridH: number;
  gridW: number;
  gridX: number;
  gridY: number;
  id: string;
  title: string;
}

export interface StartPageEmbedWidget extends StartPageWidgetBase {
  type: "embed";
  url: string;
}

export interface StartPageProtocolWidget extends StartPageWidgetBase {
  source: string;
  type: "protocol";
}

export interface StartPageNotesWidget extends StartPageWidgetBase {
  content: string;
  type: "notes";
}

export type StartPageWidget =
  | StartPageEmbedWidget
  | StartPageProtocolWidget
  | StartPageNotesWidget;

export interface StartPageWidgetsState {
  items: StartPageWidget[];
  migrated: boolean;
}

export interface StartPageProtocolWidgetAddResult {
  added: boolean;
  widgetId: string;
  widgetsState: StartPageWidgetsState;
}

export interface AppSettings {
  theme: AppTheme;
  language: AppLanguage;
  downloads: {
    defaultDirectory?: string;
      defaultThreadCount: number;
      defaultHeadersText: string;
  };
  llmProviders: LlmProvider[];
  agent: AgentPreferences;
  imageAgent: AgentModelPreferences;
  learning: LearningPreferences;
  startPage: {
    appearance: StartPageAppearance;
    workspaceAppearanceOverrides: Record<string, StartPageAppearance>;
    dockItems: StartPageDockItem[];
    workspaceDockItems: Record<string, StartPageDockItem[]>;
    widgets: StartPageWidget[];
    widgetsMigrated: boolean;
    workspaceWidgetStates: Record<string, StartPageWidgetsState>;
  };
  translation: TranslationPreferences;
}

interface CreateAppSettingsManagerOptions {
  settingsPath: string;
  defaultDownloadThreadCount: number;
  defaultTranslationPreferences: TranslationPreferences;
}

const DEFAULT_APP_THEME: AppTheme = "system";
const DEFAULT_APP_LANGUAGE: AppLanguage = "system";
const DEFAULT_AGENT_BASE_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_LLM_PROVIDER_ID = "default-provider";
const DEFAULT_LLM_PROVIDER_NAME = "Default Provider";
const DEFAULT_INTERLEAVED_THINKING_FIELD_NAME = "reasoning_content";
const LEGACY_IMAGE_AGENT_PROVIDER_ID = "image-agent-provider";
export const MAX_AGENT_PROFILE_INSTRUCTIONS_LENGTH = 4_000;
const DEFAULT_LEARNING_RETENTION_DAYS = 30;
const MAX_START_PAGE_BACKGROUND_IMAGE_LENGTH = 3_200_000;
const START_PAGE_WIDGET_GRID_COLUMNS = 12;
const START_PAGE_WIDGET_GRID_MIN_SPAN = 2;
const START_PAGE_WIDGET_GRID_SCAN_LIMIT = 96;
const START_PAGE_NOTES_WIDGET_DEFAULT_SIZE = {
  h: 6,
  w: 6,
} as const;
const START_PAGE_PROTOCOL_WIDGET_DEFAULT_SIZE = {
  h: 4,
  w: 4,
} as const;
const START_PAGE_EMBED_WIDGET_DEFAULT_SIZE = {
  h: 6,
  w: 6,
} as const;
const APP_LANGUAGE_MAP: Record<string, Exclude<AppLanguage, "system">> = {
  en: "en-US",
  "en-us": "en-US",
  zh: "zh-CN",
  "zh-cn": "zh-CN",
  "zh-hans": "zh-CN",
};

export function createAppSettingsManager(options: CreateAppSettingsManagerOptions) {
  const {
    settingsPath,
    defaultDownloadThreadCount,
    defaultTranslationPreferences,
  } = options;

  let appSettings: AppSettings = {
    theme: DEFAULT_APP_THEME,
    language: DEFAULT_APP_LANGUAGE,
    downloads: {
      defaultThreadCount: defaultDownloadThreadCount,
      defaultHeadersText: "",
    },
    llmProviders: [{
      id: DEFAULT_LLM_PROVIDER_ID,
      name: DEFAULT_LLM_PROVIDER_NAME,
      baseUrl: DEFAULT_AGENT_BASE_URL,
      apiKey: "",
      models: [],
      extraBodyEnabled: false,
      extraBody: {},
      extraHeadersEnabled: false,
      extraHeaders: {},
      extractThinkingContent: false,
      thinkingContentTagName: "think",
      interleavedThinkingEnabled: false,
      interleavedThinkingFieldName: DEFAULT_INTERLEAVED_THINKING_FIELD_NAME,
      modelSettings: {},
    }],
    agent: {
      providerId: DEFAULT_LLM_PROVIDER_ID,
      model: "",
      mcpToolExportEnabled: false,
      profileInstructions: "",
      interactionBlacklistDomains: [],
    },
    imageAgent: {
      providerId: DEFAULT_LLM_PROVIDER_ID,
      model: "",
    },
    learning: {
      mode: "on",
      providerId: DEFAULT_LLM_PROVIDER_ID,
      model: "",
      redactTextInput: true,
      retentionDays: DEFAULT_LEARNING_RETENTION_DAYS,
      blacklistDomains: [],
    },
    startPage: {
      appearance: {
        backgroundImage: null,
      },
      workspaceAppearanceOverrides: {},
      dockItems: [],
      workspaceDockItems: {},
      widgets: [],
      widgetsMigrated: false,
      workspaceWidgetStates: {},
    },
    translation: {
      ...defaultTranslationPreferences,
      sources: {
        ...defaultTranslationPreferences.sources,
        "openai-compatible": {
          ...defaultTranslationPreferences.sources["openai-compatible"],
          providerId: DEFAULT_LLM_PROVIDER_ID,
        },
        "google-basic": {
          ...defaultTranslationPreferences.sources["google-basic"],
        },
        "google-system": {
          ...defaultTranslationPreferences.sources["google-system"],
        },
        "baidu-standard": {
          ...defaultTranslationPreferences.sources["baidu-standard"],
        },
      },
    },
  };

  function normalizeTheme(value: unknown): AppTheme {
    if (value === "light" || value === "dark" || value === "system") {
      return value;
    }
    return DEFAULT_APP_THEME;
  }

  function normalizeLanguage(value: unknown): AppLanguage {
    if (typeof value !== "string") {
      return DEFAULT_APP_LANGUAGE;
    }

    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return DEFAULT_APP_LANGUAGE;
    }
    if (normalized === "system") {
      return "system";
    }

    return APP_LANGUAGE_MAP[normalized] ?? DEFAULT_APP_LANGUAGE;
  }

  function normalizeDownloadThreadCount(value: unknown) {
    if (!Number.isFinite(value)) {
      return defaultDownloadThreadCount;
    }

    return Math.min(16, Math.max(1, Math.floor(Number(value))));
  }

  function normalizeDownloadDirectory(value: unknown) {
    if (typeof value !== "string") {
      return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    return trimmed;
  }

  function normalizeDownloadHeadersText(value: unknown) {
    if (typeof value !== "string") {
      return "";
    }

    return value
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n");
  }

  function normalizeAgentBaseUrl(value: unknown) {
    if (typeof value !== "string") {
      return DEFAULT_AGENT_BASE_URL;
    }

    const trimmed = value.trim();
    return trimmed || DEFAULT_AGENT_BASE_URL;
  }

  function normalizeAgentSecret(value: unknown) {
    if (typeof value !== "string") {
      return "";
    }

    return value.trim();
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

    if (typeof value === "object" && value !== null) {
      const result: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
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

  function parseJsonConfigObject(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      return {};
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function normalizeLlmProviderExtraBody(value: unknown) {
    const source = typeof value === "string" ? parseJsonConfigObject(value) : value;
    const normalized = normalizeJsonConfigValue(source);
    return normalized && typeof normalized === "object" && !Array.isArray(normalized)
      ? normalized as Record<string, unknown>
      : {};
  }

  function normalizeLlmProviderExtraHeaders(value: unknown) {
    const headers: Record<string, string> = {};
    const entries = typeof value === "string"
      ? value
          .replace(/\r\n?/g, "\n")
          .split("\n")
          .flatMap((line): Array<[string, unknown]> => {
            const delimiter = line.indexOf(":");
            return delimiter > 0 ? [[line.slice(0, delimiter), line.slice(delimiter + 1)]] : [];
          })
      : typeof value === "object" && value !== null && !Array.isArray(value)
        ? Object.entries(value as Record<string, unknown>)
        : [];

    for (const [key, rawValue] of entries) {
      const normalizedKey = key.trim();
      const normalizedValue = String(rawValue ?? "").trim();
      if (!normalizedKey || !normalizedValue) {
        continue;
      }
      headers[normalizedKey] = normalizedValue;
    }

    return headers;
  }

  function normalizeExtraConfigEnabled(value: unknown, normalizedConfig: Record<string, unknown>) {
    return typeof value === "boolean" ? value : Object.keys(normalizedConfig).length > 0;
  }

  function normalizeLlmProviderExtractThinkingContent(value: unknown) {
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

  function normalizeAgentProfileInstructions(value: unknown) {
    if (typeof value !== "string") {
      return "";
    }

    return value
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, MAX_AGENT_PROFILE_INSTRUCTIONS_LENGTH);
  }

  function createProviderId() {
    return `provider-${randomUUID()}`;
  }

  function normalizeLlmProviderId(value: unknown) {
    if (typeof value !== "string") {
      return createProviderId();
    }

    const trimmed = value.trim();
    return trimmed || createProviderId();
  }

  function normalizeLlmProviderName(value: unknown, fallback = DEFAULT_LLM_PROVIDER_NAME) {
    if (typeof value !== "string") {
      return fallback;
    }

    const trimmed = value.trim();
    return trimmed || fallback;
  }

  function normalizeLlmProviderModels(value: unknown) {
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

      const normalized = normalizeAgentSecret(entry);
      if (!normalized || normalizedModels.includes(normalized)) {
        continue;
      }

      normalizedModels.push(normalized);
    }

    return normalizedModels;
  }

  function createDefaultLlmProvider(): LlmProvider {
    return {
      id: DEFAULT_LLM_PROVIDER_ID,
      name: DEFAULT_LLM_PROVIDER_NAME,
      baseUrl: DEFAULT_AGENT_BASE_URL,
      apiKey: "",
      models: [],
      extraBodyEnabled: false,
      extraBody: {},
      extraHeadersEnabled: false,
      extraHeaders: {},
      extractThinkingContent: false,
      thinkingContentTagName: "think",
      interleavedThinkingEnabled: false,
      interleavedThinkingFieldName: DEFAULT_INTERLEAVED_THINKING_FIELD_NAME,
      modelSettings: {},
    };
  }

  function normalizeLlmProviderModelSettings(value: unknown): LlmProviderModelSettings {
    const source = value && typeof value === "object" && !Array.isArray(value)
      ? value as {
        extraBodyEnabled?: unknown;
        extra_body_enabled?: unknown;
        extraBody?: unknown;
        extra_body?: unknown;
        extraHeadersEnabled?: unknown;
        extra_headers_enabled?: unknown;
        extraHeaderEnabled?: unknown;
        extra_header_enabled?: unknown;
        extraHeaders?: unknown;
        extraHeader?: unknown;
        extra_headers?: unknown;
        extra_header?: unknown;
        extractThinkingContent?: unknown;
        extract_thinking_content?: unknown;
        thinkingContentTagName?: unknown;
        thinking_content_tag_name?: unknown;
        thinkingTagName?: unknown;
        thinking_tag_name?: unknown;
        interleavedThinkingEnabled?: unknown;
        interleaved_thinking_enabled?: unknown;
        interleavedThinkingFieldName?: unknown;
        interleaved_thinking_field_name?: unknown;
        thinkingFieldName?: unknown;
        thinking_field_name?: unknown;
      }
      : {};
    const extraBody = normalizeLlmProviderExtraBody(source.extraBody ?? source.extra_body);
    const extraHeaders = normalizeLlmProviderExtraHeaders(
      source.extraHeaders
        ?? source.extraHeader
        ?? source.extra_headers
        ?? source.extra_header,
    );

    return {
      extraBodyEnabled: normalizeExtraConfigEnabled(
        source.extraBodyEnabled ?? source.extra_body_enabled,
        extraBody,
      ),
      extraBody,
      extraHeadersEnabled: normalizeExtraConfigEnabled(
        source.extraHeadersEnabled
          ?? source.extraHeaderEnabled
          ?? source.extra_headers_enabled
          ?? source.extra_header_enabled,
        extraHeaders,
      ),
      extraHeaders,
      extractThinkingContent: normalizeLlmProviderExtractThinkingContent(
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

  function normalizeLlmProviderModelSettingsMap(value: unknown, models: string[]) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }

    const configuredModels = new Set(models);
    const result: Record<string, LlmProviderModelSettings> = {};
    for (const [model, settings] of Object.entries(value)) {
      const normalizedModel = normalizeAgentSecret(model);
      if (!normalizedModel || !configuredModels.has(normalizedModel)) {
        continue;
      }
      result[normalizedModel] = normalizeLlmProviderModelSettings(settings);
    }

    return result;
  }

  function normalizeLlmProvider(
    value: unknown,
    fallbackName = DEFAULT_LLM_PROVIDER_NAME,
  ): LlmProvider | null {
    if (typeof value !== "object" || value === null) {
      return null;
    }

    const source = value as {
      id?: unknown;
      name?: unknown;
      baseUrl?: unknown;
      apiKey?: unknown;
      models?: unknown;
      extraBodyEnabled?: unknown;
      extra_body_enabled?: unknown;
      extraBody?: unknown;
      extra_body?: unknown;
      extraHeadersEnabled?: unknown;
      extra_headers_enabled?: unknown;
      extraHeaderEnabled?: unknown;
      extra_header_enabled?: unknown;
      extraHeaders?: unknown;
      extraHeader?: unknown;
      extra_headers?: unknown;
      extra_header?: unknown;
      extractThinkingContent?: unknown;
      extract_thinking_content?: unknown;
      thinkingContentTagName?: unknown;
      thinking_content_tag_name?: unknown;
      thinkingTagName?: unknown;
      thinking_tag_name?: unknown;
      interleavedThinkingEnabled?: unknown;
      interleaved_thinking_enabled?: unknown;
      interleavedThinkingFieldName?: unknown;
      interleaved_thinking_field_name?: unknown;
      thinkingFieldName?: unknown;
      thinking_field_name?: unknown;
      modelSettings?: unknown;
      model_settings?: unknown;
      modelConfigs?: unknown;
      model_configs?: unknown;
    };

    const thinkingContentTagName = normalizeThinkingContentTagName(
      source.thinkingContentTagName
        ?? source.thinking_content_tag_name
        ?? source.thinkingTagName
        ?? source.thinking_tag_name,
    );
    const extraBody = normalizeLlmProviderExtraBody(source.extraBody ?? source.extra_body);
    const extraHeaders = normalizeLlmProviderExtraHeaders(
      source.extraHeaders
        ?? source.extraHeader
        ?? source.extra_headers
        ?? source.extra_header,
    );
    const models = normalizeLlmProviderModels(source.models);

    return {
      id: normalizeLlmProviderId(source.id),
      name: normalizeLlmProviderName(source.name, fallbackName),
      baseUrl: normalizeAgentBaseUrl(source.baseUrl),
      apiKey: normalizeAgentSecret(source.apiKey),
      models,
      extraBodyEnabled: normalizeExtraConfigEnabled(
        source.extraBodyEnabled ?? source.extra_body_enabled,
        extraBody,
      ),
      extraBody,
      extraHeadersEnabled: normalizeExtraConfigEnabled(
        source.extraHeadersEnabled
          ?? source.extraHeaderEnabled
          ?? source.extra_headers_enabled
          ?? source.extra_header_enabled,
        extraHeaders,
      ),
      extraHeaders,
      extractThinkingContent: normalizeLlmProviderExtractThinkingContent(
        source.extractThinkingContent ?? source.extract_thinking_content,
      ),
      thinkingContentTagName,
      interleavedThinkingEnabled: normalizeInterleavedThinkingEnabled(
        source.interleavedThinkingEnabled ?? source.interleaved_thinking_enabled,
      ),
      interleavedThinkingFieldName: normalizeInterleavedThinkingFieldName(
        source.interleavedThinkingFieldName
          ?? source.interleaved_thinking_field_name
          ?? source.thinkingFieldName
          ?? source.thinking_field_name,
      ),
      modelSettings: normalizeLlmProviderModelSettingsMap(
        source.modelSettings
          ?? source.model_settings
          ?? source.modelConfigs
          ?? source.model_configs,
        models,
      ),
    };
  }

  function buildProvidersFromLegacySettings(
    legacyAgent?: { baseUrl?: unknown; apiKey?: unknown; model?: unknown },
    legacyImageAgent?: { baseUrl?: unknown; apiKey?: unknown; model?: unknown },
    legacyTranslation?: Partial<TranslationPreferences>,
  ) {
    const legacyTranslationOpenAI = {
      baseUrl:
        legacyTranslation?.sources?.["openai-compatible"]?.endpoint
        ?? (legacyTranslation as { endpoint?: unknown } | undefined)?.endpoint,
      apiKey:
        legacyTranslation?.sources?.["openai-compatible"]?.apiKey
        ?? (legacyTranslation as { apiKey?: unknown } | undefined)?.apiKey,
      model:
        legacyTranslation?.sources?.["openai-compatible"]?.model
        ?? (legacyTranslation as { model?: unknown } | undefined)?.model,
    };
    const hasLegacyValues = [legacyAgent, legacyImageAgent, legacyTranslationOpenAI].some((entry) =>
      typeof entry?.baseUrl === "string"
      || typeof entry?.apiKey === "string"
      || typeof entry?.model === "string"
    );
    if (!hasLegacyValues) {
      return [createDefaultLlmProvider()];
    }

    const legacyCandidates = [
      {
        id: DEFAULT_LLM_PROVIDER_ID,
        name: "Agent Provider",
        baseUrl: legacyAgent?.baseUrl,
        apiKey: legacyAgent?.apiKey,
        model: legacyAgent?.model,
      },
      {
        id: LEGACY_IMAGE_AGENT_PROVIDER_ID,
        name: "Image Agent Provider",
        baseUrl: legacyImageAgent?.baseUrl,
        apiKey: legacyImageAgent?.apiKey,
        model: legacyImageAgent?.model,
      },
      {
        id: "translation-provider",
        name: "Translation Provider",
        baseUrl: legacyTranslationOpenAI.baseUrl,
        apiKey: legacyTranslationOpenAI.apiKey,
        model: legacyTranslationOpenAI.model,
      },
    ];

    const result: LlmProvider[] = [];
    const dedupeIndexByConnection = new Map<string, number>();

    for (const candidate of legacyCandidates) {
      const baseUrl = normalizeAgentBaseUrl(candidate.baseUrl);
      const apiKey = normalizeAgentSecret(candidate.apiKey);
      const model = normalizeAgentSecret(candidate.model);
      const dedupeKey = `${baseUrl}\n${apiKey}`;
      const existingIndex = dedupeIndexByConnection.get(dedupeKey);

      if (existingIndex !== undefined) {
        const current = result[existingIndex];
        if (current && model && !current.models.includes(model)) {
          current.models = [...current.models, model];
        }
        continue;
      }

      result.push({
        id: candidate.id,
        name: candidate.name,
        baseUrl,
        apiKey,
        models: model ? [model] : [],
        extraBodyEnabled: false,
        extraBody: {},
        extraHeadersEnabled: false,
        extraHeaders: {},
        extractThinkingContent: false,
        thinkingContentTagName: "think",
        interleavedThinkingEnabled: false,
        interleavedThinkingFieldName: DEFAULT_INTERLEAVED_THINKING_FIELD_NAME,
        modelSettings: {},
      });
      dedupeIndexByConnection.set(dedupeKey, result.length - 1);
    }

    return result.length > 0 ? result : [createDefaultLlmProvider()];
  }

  function normalizeLlmProviders(
    value: unknown,
    legacy?: {
      agent?: { baseUrl?: unknown; apiKey?: unknown; model?: unknown };
      imageAgent?: { baseUrl?: unknown; apiKey?: unknown; model?: unknown };
      translation?: Partial<TranslationPreferences>;
    },
  ) {
    const entries = Array.isArray(value) ? value : [];
    const normalizedProviders: LlmProvider[] = [];
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
        normalized.id = createProviderId();
      }

      seenIds.add(normalized.id);
      normalizedProviders.push(normalized);
    }

    if (normalizedProviders.length > 0) {
      return normalizedProviders;
    }

    return buildProvidersFromLegacySettings(legacy?.agent, legacy?.imageAgent, legacy?.translation);
  }

  function resolveProviderIdForConnection(
    providers: LlmProvider[],
    baseUrl: unknown,
    apiKey: unknown,
  ) {
    const normalizedBaseUrl = normalizeAgentBaseUrl(baseUrl);
    const normalizedApiKey = normalizeAgentSecret(apiKey);
    return providers.find((provider) =>
      provider.baseUrl === normalizedBaseUrl && provider.apiKey === normalizedApiKey
    )?.id;
  }

  function normalizeAgentModelPreferences(
    value: unknown,
    providers: LlmProvider[],
  ): AgentModelPreferences {
    const source = value && typeof value === "object"
      ? value as {
        providerId?: unknown;
        model?: unknown;
        baseUrl?: unknown;
        apiKey?: unknown;
      }
      : {};
    const preferredProviderId = normalizeAgentSecret(source.providerId);
    const matchedProviderId = preferredProviderId
      && providers.some((provider) => provider.id === preferredProviderId)
      ? preferredProviderId
      : resolveProviderIdForConnection(providers, source.baseUrl, source.apiKey);

    return {
      providerId: matchedProviderId ?? providers[0]?.id ?? createDefaultLlmProvider().id,
      model: normalizeAgentSecret(source.model),
    };
  }

  function normalizeLearningModelPreferences(
    value: unknown,
    providers: LlmProvider[],
    fallback: AgentModelPreferences,
  ): AgentModelPreferences {
    const source = value && typeof value === "object"
      ? value as {
        providerId?: unknown;
        model?: unknown;
      }
      : {};
    const preferredProviderId = normalizeAgentSecret(source.providerId);
    const resolvedProviderId = preferredProviderId
      && providers.some((provider) => provider.id === preferredProviderId)
      ? preferredProviderId
      : fallback.providerId;
    const model = normalizeAgentSecret(source.model);

    return {
      providerId: resolvedProviderId,
      model: model || (resolvedProviderId === fallback.providerId ? fallback.model : ""),
    };
  }

  function normalizeAgentPreferences(
    value: unknown,
    providers: LlmProvider[],
  ): AgentPreferences {
    const source = value && typeof value === "object"
      ? value as {
        mcpToolExportEnabled?: unknown;
        profileInstructions?: unknown;
        interactionBlacklistDomains?: unknown;
      }
      : {};
    const base = normalizeAgentModelPreferences(value, providers);
    return {
      ...base,
      mcpToolExportEnabled: typeof source.mcpToolExportEnabled === "boolean"
        ? source.mcpToolExportEnabled
        : false,
      profileInstructions: normalizeAgentProfileInstructions(source.profileInstructions),
      interactionBlacklistDomains: normalizeLearningBlacklistDomains(source.interactionBlacklistDomains),
    };
  }

  function resolveLlmProviderModelSettings(provider: LlmProvider, model: string): LlmProviderModelSettings {
    const normalizedModel = normalizeAgentSecret(model);
    const modelSettings = normalizedModel ? provider.modelSettings[normalizedModel] : undefined;
    return modelSettings ?? {
      extraBodyEnabled: normalizeExtraConfigEnabled(provider.extraBodyEnabled, provider.extraBody),
      extraBody: normalizeLlmProviderExtraBody(provider.extraBody),
      extraHeadersEnabled: normalizeExtraConfigEnabled(provider.extraHeadersEnabled, provider.extraHeaders),
      extraHeaders: normalizeLlmProviderExtraHeaders(provider.extraHeaders),
      extractThinkingContent: normalizeLlmProviderExtractThinkingContent(provider.extractThinkingContent),
      thinkingContentTagName: normalizeThinkingContentTagName(provider.thinkingContentTagName),
      interleavedThinkingEnabled: normalizeInterleavedThinkingEnabled(provider.interleavedThinkingEnabled),
      interleavedThinkingFieldName: normalizeInterleavedThinkingFieldName(provider.interleavedThinkingFieldName),
    };
  }

  function normalizeTranslationPreferencesForProviders(
    value: unknown,
    providers: LlmProvider[],
  ): TranslationPreferences {
    const normalized = normalizeTranslationPreferences(value as Partial<TranslationPreferences> | null | undefined);
    const openAISettings = normalized.sources["openai-compatible"];
    const preferredProviderId = normalizeAgentSecret(openAISettings.providerId);
    const matchedProviderId = preferredProviderId
      && providers.some((provider) => provider.id === preferredProviderId)
      ? preferredProviderId
      : resolveProviderIdForConnection(providers, openAISettings.endpoint, openAISettings.apiKey);
    const provider = providers.find((entry) => entry.id === matchedProviderId);
    const model = normalizeAgentSecret(openAISettings.model);
    const providerModelSettings = provider
      ? resolveLlmProviderModelSettings(provider, model)
      : null;

    return {
      ...normalized,
      sources: {
        ...normalized.sources,
        "openai-compatible": {
          providerId: matchedProviderId ?? providers[0]?.id ?? createDefaultLlmProvider().id,
          endpoint: provider?.baseUrl.trim() || normalizeAgentBaseUrl(openAISettings.endpoint),
          apiKey: provider?.apiKey.trim() || normalizeAgentSecret(openAISettings.apiKey),
          model,
          extraBodyEnabled: provider
            ? providerModelSettings!.extraBodyEnabled
            : normalizeExtraConfigEnabled(openAISettings.extraBodyEnabled, normalizeLlmProviderExtraBody(openAISettings.extraBody)),
          extraBody: provider
            ? normalizeLlmProviderExtraBody(providerModelSettings!.extraBody)
            : normalizeLlmProviderExtraBody(openAISettings.extraBody),
          extraHeadersEnabled: provider
            ? providerModelSettings!.extraHeadersEnabled
            : normalizeExtraConfigEnabled(openAISettings.extraHeadersEnabled, normalizeLlmProviderExtraHeaders(openAISettings.extraHeaders)),
          extraHeaders: provider
            ? normalizeLlmProviderExtraHeaders(providerModelSettings!.extraHeaders)
            : normalizeLlmProviderExtraHeaders(openAISettings.extraHeaders),
          extractThinkingContent: provider
            ? providerModelSettings!.extractThinkingContent
            : normalizeLlmProviderExtractThinkingContent(openAISettings.extractThinkingContent),
          thinkingContentTagName: provider
            ? providerModelSettings!.thinkingContentTagName
            : normalizeThinkingContentTagName(openAISettings.thinkingContentTagName),
          interleavedThinkingEnabled: provider
            ? providerModelSettings!.interleavedThinkingEnabled
            : normalizeInterleavedThinkingEnabled(openAISettings.interleavedThinkingEnabled),
          interleavedThinkingFieldName: provider
            ? providerModelSettings!.interleavedThinkingFieldName
            : normalizeInterleavedThinkingFieldName(openAISettings.interleavedThinkingFieldName),
        },
      },
    };
  }

  function normalizeStartPageBackgroundImage(value: unknown) {
    if (typeof value !== "string") {
      return null;
    }

    const normalizedValue = value.trim();
    if (!normalizedValue.startsWith("data:image/")) {
      return null;
    }

    return normalizedValue.length <= MAX_START_PAGE_BACKGROUND_IMAGE_LENGTH
      ? normalizedValue
      : null;
  }

  function normalizeStartPageAppearance(value: unknown): StartPageAppearance {
    const source = typeof value === "object" && value !== null
      ? value as { backgroundImage?: unknown }
      : {};

    return {
      backgroundImage: normalizeStartPageBackgroundImage(source.backgroundImage),
    };
  }

  function normalizeStartPageAppearanceOverrides(value: unknown) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return {} as Record<string, StartPageAppearance>;
    }

    const overrides: Record<string, StartPageAppearance> = {};
    for (const [workspaceId, appearance] of Object.entries(value as Record<string, unknown>)) {
      const normalizedWorkspaceId = workspaceId.trim();
      if (!normalizedWorkspaceId) {
        continue;
      }

      overrides[normalizedWorkspaceId] = normalizeStartPageAppearance(appearance);
    }

    return overrides;
  }

  function normalizeStartPageWidgetsState(value: unknown): StartPageWidgetsState {
    const source = typeof value === "object" && value !== null
      ? value as { items?: unknown; migrated?: unknown }
      : {};

    return {
      items: normalizeStartPageWidgets(source.items),
      migrated: source.migrated === true,
    };
  }

  function normalizeStartPageWidgetStateOverrides(value: unknown) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return {} as Record<string, StartPageWidgetsState>;
    }

    const overrides: Record<string, StartPageWidgetsState> = {};
    for (const [workspaceId, widgetsState] of Object.entries(value as Record<string, unknown>)) {
      const normalizedWorkspaceId = workspaceId.trim();
      if (!normalizedWorkspaceId) {
        continue;
      }

      overrides[normalizedWorkspaceId] = normalizeStartPageWidgetsState(widgetsState);
    }

    return overrides;
  }

  function normalizeLearningMode(value: unknown): LearningMode {
    if (value === "off") {
      return "off";
    }
    if (value === "on" || value === "observe" || value === "observe_and_adapt") {
      return "on";
    }
    return "on";
  }

  function normalizeLearningRetentionDays(value: unknown) {
    if (!Number.isFinite(value)) {
      return DEFAULT_LEARNING_RETENTION_DAYS;
    }
    return Math.min(365, Math.max(1, Math.floor(Number(value))));
  }

  function normalizeLearningBlacklistDomain(value: string) {
    let normalized = value.trim().toLowerCase();
    if (!normalized) {
      return undefined;
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
    return normalized || undefined;
  }

  function normalizeLearningBlacklistDomains(value: unknown) {
    const entries = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(/[\n,，;]/)
        : [];

    const normalizedDomains: string[] = [];
    for (const entry of entries) {
      if (typeof entry !== "string") {
        continue;
      }

      const normalized = normalizeLearningBlacklistDomain(entry);
      if (!normalized || normalizedDomains.includes(normalized)) {
        continue;
      }

      normalizedDomains.push(normalized);
    }

    return normalizedDomains;
  }

  function normalizeLearningPreferences(
    value: unknown,
    providers: LlmProvider[],
    fallback: AgentModelPreferences,
  ): LearningPreferences {
    const record = value && typeof value === "object" ? value as {
      mode?: unknown;
      providerId?: unknown;
      model?: unknown;
      redactTextInput?: unknown;
      retentionDays?: unknown;
      blacklistDomains?: unknown;
    } : undefined;
    const assignment = normalizeLearningModelPreferences(record, providers, fallback);
    return {
      ...assignment,
      mode: normalizeLearningMode(record?.mode),
      redactTextInput: typeof record?.redactTextInput === "boolean"
        ? record.redactTextInput
        : true,
      retentionDays: normalizeLearningRetentionDays(record?.retentionDays),
      blacklistDomains: normalizeLearningBlacklistDomains(record?.blacklistDomains),
    };
  }

  function createStartPageDockItemId() {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return `dock-${globalThis.crypto.randomUUID()}`;
    }

    return `dock-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function createStartPageWidgetId(prefix: StartPageWidget["type"]) {
    return `${prefix}-${randomUUID()}`;
  }

  function clampStartPageWidgetSpan(value: unknown, max: number) {
    if (!Number.isFinite(value)) {
      return Math.min(max, 3);
    }

    return Math.min(max, Math.max(START_PAGE_WIDGET_GRID_MIN_SPAN, Math.round(Number(value))));
  }

  function clampStartPageWidgetCoordinate(value: unknown) {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.max(0, Math.round(Number(value)));
  }

  function getStartPageWidgetDefaultSize(type: StartPageWidget["type"]) {
    if (type === "notes") {
      return START_PAGE_NOTES_WIDGET_DEFAULT_SIZE;
    }
    if (type === "protocol") {
      return START_PAGE_PROTOCOL_WIDGET_DEFAULT_SIZE;
    }
    return START_PAGE_EMBED_WIDGET_DEFAULT_SIZE;
  }

  function normalizeStartPageWidget(
    value: unknown,
  ): StartPageWidget | null {
    const record = value && typeof value === "object"
      ? value as {
        content?: unknown;
        gridH?: unknown;
        gridW?: unknown;
        gridX?: unknown;
        gridY?: unknown;
        id?: unknown;
        source?: unknown;
        title?: unknown;
        type?: unknown;
        url?: unknown;
      }
      : undefined;

    const type = record?.type;
    if (type !== "embed" && type !== "notes" && type !== "protocol") {
      return null;
    }

    const defaultSize = getStartPageWidgetDefaultSize(type);
    const gridW = clampStartPageWidgetSpan(record?.gridW, START_PAGE_WIDGET_GRID_COLUMNS);
    const gridH = clampStartPageWidgetSpan(record?.gridH, START_PAGE_WIDGET_GRID_SCAN_LIMIT);
    const normalizedGridW = Number.isFinite(record?.gridW) ? gridW : defaultSize.w;
    const normalizedGridH = Number.isFinite(record?.gridH) ? gridH : defaultSize.h;
    const gridX = Math.min(
      START_PAGE_WIDGET_GRID_COLUMNS - normalizedGridW,
      clampStartPageWidgetCoordinate(record?.gridX),
    );
    const gridY = clampStartPageWidgetCoordinate(record?.gridY);
    const id =
      typeof record?.id === "string" && record.id.trim()
        ? record.id.trim()
        : createStartPageWidgetId(type);
    const title = typeof record?.title === "string" ? record.title.trim() : "";

    if (type === "embed") {
      return {
        gridH: normalizedGridH,
        gridW: normalizedGridW,
        gridX,
        gridY,
        id,
        title,
        type,
        url: typeof record?.url === "string" ? record.url.trim() : "",
      };
    }

    if (type === "protocol") {
      return {
        gridH: normalizedGridH,
        gridW: normalizedGridW,
        gridX,
        gridY,
        id,
        source: typeof record?.source === "string" ? record.source.trim() : "",
        title,
        type,
      };
    }

    return {
      content: typeof record?.content === "string" ? record.content : "",
      gridH: normalizedGridH,
      gridW: normalizedGridW,
      gridX,
      gridY,
      id,
      title,
      type,
    };
  }

  function normalizeStartPageWidgets(value: unknown): StartPageWidget[] {
    const items = Array.isArray(value) ? value : [];
    const nextItems: StartPageWidget[] = [];
    const seenIds = new Set<string>();

    for (const item of items) {
      const normalized = normalizeStartPageWidget(item);
      if (!normalized || seenIds.has(normalized.id)) {
        continue;
      }

      seenIds.add(normalized.id);
      nextItems.push(normalized);
    }

    return nextItems;
  }

  function cloneStartPageWidget(widget: StartPageWidget): StartPageWidget {
    if (widget.type === "embed") {
      return {
        gridH: widget.gridH,
        gridW: widget.gridW,
        gridX: widget.gridX,
        gridY: widget.gridY,
        id: widget.id,
        title: widget.title,
        type: widget.type,
        url: widget.url,
      };
    }

    if (widget.type === "protocol") {
      return {
        gridH: widget.gridH,
        gridW: widget.gridW,
        gridX: widget.gridX,
        gridY: widget.gridY,
        id: widget.id,
        source: widget.source,
        title: widget.title,
        type: widget.type,
      };
    }

    return {
      content: widget.content,
      gridH: widget.gridH,
      gridW: widget.gridW,
      gridX: widget.gridX,
      gridY: widget.gridY,
      id: widget.id,
      title: widget.title,
      type: widget.type,
    };
  }

  function normalizeStartPageDockTitle(value: unknown, url: string) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    try {
      const parsed = new URL(url);
      if (parsed.protocol === "milo:") {
        return parsed.hostname || "Milo";
      }

      return parsed.hostname.replace(/^www\./i, "") || url;
    } catch {
      return url;
    }
  }

  function normalizeStartPageDockItem(
    value: unknown,
  ): StartPageDockItem | null {
    const record = value && typeof value === "object"
      ? value as {
        id?: unknown;
        title?: unknown;
        url?: unknown;
        favicon?: unknown;
        createdAt?: unknown;
      }
      : undefined;

    if (typeof record?.url !== "string") {
      return null;
    }

    const url = record.url.trim();
    if (!url) {
      return null;
    }

    const title = normalizeStartPageDockTitle(record.title, url);
    const favicon =
      typeof record.favicon === "string" && record.favicon.trim()
        ? record.favicon.trim()
        : undefined;
    const createdAt = Number.isFinite(record.createdAt)
      ? Math.max(0, Math.floor(Number(record.createdAt)))
      : Date.now();

    return {
      createdAt,
      id:
        typeof record.id === "string" && record.id.trim()
          ? record.id.trim()
          : createStartPageDockItemId(),
      ...(favicon ? { favicon } : {}),
      title,
      url,
    };
  }

  function normalizeStartPageDockItems(value: unknown) {
    const items = Array.isArray(value) ? value : [];
    const nextItems: StartPageDockItem[] = [];
    const seenUrls = new Set<string>();

    for (const item of items) {
      const normalized = normalizeStartPageDockItem(item);
      if (!normalized) {
        continue;
      }

      const urlKey = normalized.url.trim().toLowerCase();
      if (!urlKey || seenUrls.has(urlKey)) {
        continue;
      }

      seenUrls.add(urlKey);
      nextItems.push(normalized);
    }

    return nextItems;
  }

  function normalizeStartPageDockItemOverrides(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {} as Record<string, StartPageDockItem[]>;
    }

    const overrides: Record<string, StartPageDockItem[]> = {};
    for (const [workspaceId, items] of Object.entries(value as Record<string, unknown>)) {
      const normalizedWorkspaceId = workspaceId.trim();
      if (!normalizedWorkspaceId) {
        continue;
      }

      overrides[normalizedWorkspaceId] = normalizeStartPageDockItems(items);
    }

    return overrides;
  }

  function cloneStartPageDockItem(item: StartPageDockItem): StartPageDockItem {
    return item.favicon ? { ...item } : {
      createdAt: item.createdAt,
      id: item.id,
      title: item.title,
      url: item.url,
    };
  }

  function saveAppSettings() {
    try {
      const temporaryPath = `${settingsPath}.tmp`;
      const protectedSettings = protectSettingsSecretsForStorage(appSettings);
      writeFileSync(temporaryPath, JSON.stringify(protectedSettings, null, 2), {
        encoding: "utf-8",
        mode: 0o600,
      });
      renameSync(temporaryPath, settingsPath);
      chmodSync(settingsPath, 0o600);
    } catch (error) {
      console.warn("[Settings] Failed to persist app settings.", error);
    }
  }

  function loadAppSettings() {
    try {
      if (!existsSync(settingsPath)) {
        return;
      }

      const raw = readFileSync(settingsPath, "utf-8");
      const parsed = revealSettingsSecretsFromStorage(JSON.parse(raw));
      if (parsed && typeof parsed === "object") {
        const downloads = (parsed as {
          downloads?: {
            defaultDirectory?: unknown;
            defaultThreadCount?: unknown;
            defaultHeadersText?: unknown;
          };
          llmProviders?: unknown;
          agent?: {
            providerId?: unknown;
            baseUrl?: unknown;
            apiKey?: unknown;
            model?: unknown;
          };
          imageAgent?: {
            providerId?: unknown;
            baseUrl?: unknown;
            apiKey?: unknown;
            model?: unknown;
          };
          translation?: Partial<TranslationPreferences>;
        }).downloads;
        const agent = (parsed as {
          agent?: {
            providerId?: unknown;
            baseUrl?: unknown;
            apiKey?: unknown;
            model?: unknown;
          };
        }).agent;
        const imageAgent = (parsed as {
          imageAgent?: {
            providerId?: unknown;
            baseUrl?: unknown;
            apiKey?: unknown;
            model?: unknown;
          };
        }).imageAgent;
        const llmProviders = normalizeLlmProviders((parsed as {
          llmProviders?: unknown;
        }).llmProviders, {
          agent,
          imageAgent,
          translation: (parsed as {
            translation?: Partial<TranslationPreferences>;
          }).translation,
        });
        const startPage = (parsed as {
          startPage?: {
            appearance?: unknown;
            workspaceAppearanceOverrides?: unknown;
            dockItems?: unknown;
            workspaceDockItems?: unknown;
            widgets?: unknown;
            widgetsMigrated?: unknown;
            workspaceWidgetStates?: unknown;
          };
        }).startPage;

        const normalizedAgent = normalizeAgentPreferences(agent, llmProviders);
        const normalizedImageAgent = normalizeAgentModelPreferences(imageAgent, llmProviders);
        const normalizedLearning = normalizeLearningPreferences((parsed as {
          learning?: Partial<LearningPreferences>;
        }).learning, llmProviders, normalizedAgent);
        const normalizedTranslation = normalizeTranslationPreferencesForProviders((parsed as {
          translation?: Partial<TranslationPreferences>;
        }).translation, llmProviders);

        appSettings = {
          theme: normalizeTheme((parsed as { theme?: unknown }).theme),
          language: normalizeLanguage((parsed as { language?: unknown }).language),
          downloads: {
            defaultDirectory: normalizeDownloadDirectory(downloads?.defaultDirectory),
            defaultThreadCount: normalizeDownloadThreadCount(downloads?.defaultThreadCount),
            defaultHeadersText: normalizeDownloadHeadersText(downloads?.defaultHeadersText),
          },
          llmProviders,
          agent: normalizedAgent,
          imageAgent: normalizedImageAgent,
          learning: normalizedLearning,
          startPage: {
            appearance: normalizeStartPageAppearance(startPage?.appearance),
            workspaceAppearanceOverrides: normalizeStartPageAppearanceOverrides(
              startPage?.workspaceAppearanceOverrides,
            ),
            dockItems: normalizeStartPageDockItems(startPage?.dockItems),
            workspaceDockItems: normalizeStartPageDockItemOverrides(
              startPage?.workspaceDockItems,
            ),
            widgets: normalizeStartPageWidgets(startPage?.widgets),
            widgetsMigrated: startPage?.widgetsMigrated === true,
            workspaceWidgetStates: normalizeStartPageWidgetStateOverrides(
              startPage?.workspaceWidgetStates,
            ),
          },
          translation: normalizedTranslation,
        };
        // Migrate legacy plaintext values and tighten file permissions.
        saveAppSettings();
      }
    } catch {
      // Keep defaults when the settings file is invalid.
    }
  }

  function getSettings() {
    return appSettings;
  }

  function getTheme() {
    return appSettings.theme;
  }

  function setTheme(value: unknown) {
    const normalizedTheme = normalizeTheme(value);
    appSettings.theme = normalizedTheme;
    saveAppSettings();
    return normalizedTheme;
  }

  function getLanguage() {
    return appSettings.language;
  }

  function setLanguage(value: unknown) {
    const normalizedLanguage = normalizeLanguage(value);
    appSettings.language = normalizedLanguage;
    saveAppSettings();
    return normalizedLanguage;
  }

  function parseDownloadHeadersText(input: string) {
    const headers: Record<string, string> = {};

    for (const line of normalizeDownloadHeadersText(input).split("\n")) {
      const delimiter = line.indexOf(":");
      if (delimiter <= 0) {
        continue;
      }

      const key = line.slice(0, delimiter).trim();
      const value = line.slice(delimiter + 1).trim();
      if (!key || !value) {
        continue;
      }

      headers[key] = value;
    }

    return headers;
  }

  function resolveDownloadDirectory() {
    return appSettings.downloads.defaultDirectory || app.getPath("downloads");
  }

  function getDownloadPreferences() {
    return {
      defaultDirectory: resolveDownloadDirectory(),
      hasCustomDirectory: Boolean(appSettings.downloads.defaultDirectory),
      defaultThreadCount: appSettings.downloads.defaultThreadCount,
      defaultHeadersText: appSettings.downloads.defaultHeadersText,
    };
  }

  function getDownloadSettings() {
    return {
      ...appSettings.downloads,
    };
  }

  function setDownloadPreferences(input?: {
    defaultDirectory?: string | null;
    defaultThreadCount?: number;
    defaultHeadersText?: string;
  }) {
    appSettings.downloads = {
      defaultDirectory: normalizeDownloadDirectory(input?.defaultDirectory),
      defaultThreadCount: normalizeDownloadThreadCount(input?.defaultThreadCount),
      defaultHeadersText: normalizeDownloadHeadersText(input?.defaultHeadersText),
    };
    saveAppSettings();
    return getDownloadPreferences();
  }

  function getTranslationPreferences() {
    const translation = normalizeTranslationPreferencesForProviders(
      appSettings.translation,
      appSettings.llmProviders,
    );

    return {
      ...translation,
      sources: {
        "openai-compatible": {
          ...translation.sources["openai-compatible"],
        },
        "google-basic": {
          ...translation.sources["google-basic"],
        },
        "google-system": {
          ...translation.sources["google-system"],
        },
        "baidu-standard": {
          ...translation.sources["baidu-standard"],
        },
      },
    };
  }

  function getLlmProviders() {
    return appSettings.llmProviders.map((provider) => ({
      ...provider,
      models: [...provider.models],
      extraBodyEnabled: normalizeExtraConfigEnabled(provider.extraBodyEnabled, provider.extraBody),
      extraBody: normalizeLlmProviderExtraBody(provider.extraBody),
      extraHeadersEnabled: normalizeExtraConfigEnabled(provider.extraHeadersEnabled, provider.extraHeaders),
      extraHeaders: normalizeLlmProviderExtraHeaders(provider.extraHeaders),
      extractThinkingContent: normalizeLlmProviderExtractThinkingContent(provider.extractThinkingContent),
      thinkingContentTagName: normalizeThinkingContentTagName(provider.thinkingContentTagName),
      interleavedThinkingEnabled: normalizeInterleavedThinkingEnabled(provider.interleavedThinkingEnabled),
      interleavedThinkingFieldName: normalizeInterleavedThinkingFieldName(provider.interleavedThinkingFieldName),
      modelSettings: normalizeLlmProviderModelSettingsMap(provider.modelSettings, provider.models),
    }));
  }

  function getAgentPreferences() {
    return {
      ...appSettings.agent,
      interactionBlacklistDomains: [...appSettings.agent.interactionBlacklistDomains],
    };
  }

  function getLearningPreferences() {
    return {
      ...appSettings.learning,
    };
  }

  function getImageAgentPreferences() {
    return {
      ...appSettings.imageAgent,
    };
  }

  function normalizeWorkspaceId(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
  }

  function getStartPageDockItemsForWorkspace(workspaceId?: string) {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    if (
      normalizedWorkspaceId
      && Object.prototype.hasOwnProperty.call(
        appSettings.startPage.workspaceDockItems,
        normalizedWorkspaceId,
      )
    ) {
      return appSettings.startPage.workspaceDockItems[normalizedWorkspaceId] ?? [];
    }

    return appSettings.startPage.dockItems;
  }

  function getStartPageDockItems(workspaceId?: string) {
    return getStartPageDockItemsForWorkspace(workspaceId).map(cloneStartPageDockItem);
  }

  function getStartPageAppearance(workspaceId?: string) {
    const normalizedWorkspaceId = typeof workspaceId === "string" ? workspaceId.trim() : "";
    const appearance = normalizedWorkspaceId
      ? appSettings.startPage.workspaceAppearanceOverrides[normalizedWorkspaceId]
        ?? appSettings.startPage.appearance
      : appSettings.startPage.appearance;

    return {
      ...appearance,
    };
  }

  function getStartPageWidgetsState(workspaceId?: string): StartPageWidgetsState {
    const normalizedWorkspaceId = typeof workspaceId === "string" ? workspaceId.trim() : "";
    const widgetsState = normalizedWorkspaceId
      ? appSettings.startPage.workspaceWidgetStates[normalizedWorkspaceId]
        ?? {
          items: appSettings.startPage.widgets,
          migrated: appSettings.startPage.widgetsMigrated,
        }
      : {
        items: appSettings.startPage.widgets,
        migrated: appSettings.startPage.widgetsMigrated,
      };

    return {
      items: widgetsState.items.map(cloneStartPageWidget),
      migrated: widgetsState.migrated,
    };
  }

  function setAgentPreferences(input?: Partial<AgentPreferences> | null) {
    const previousAgent = appSettings.agent;
    const learningFollowedAgent =
      appSettings.learning.providerId === previousAgent.providerId
      && appSettings.learning.model === previousAgent.model;
    appSettings.agent = normalizeAgentPreferences({
      ...appSettings.agent,
      ...input,
    }, appSettings.llmProviders);
    appSettings.learning = normalizeLearningPreferences(
      learningFollowedAgent
        ? {
          ...appSettings.learning,
          providerId: appSettings.agent.providerId,
          model: appSettings.agent.model,
        }
        : appSettings.learning,
      appSettings.llmProviders,
      appSettings.agent,
    );
    saveAppSettings();
    return getAgentPreferences();
  }

  function setImageAgentPreferences(input?: Partial<AgentModelPreferences> | null) {
    appSettings.imageAgent = normalizeAgentModelPreferences({
      ...appSettings.imageAgent,
      ...input,
    }, appSettings.llmProviders);
    saveAppSettings();
    return getImageAgentPreferences();
  }

  function setLlmProviders(input?: LlmProvider[] | null) {
    appSettings.llmProviders = normalizeLlmProviders(input);
    appSettings.agent = normalizeAgentPreferences(appSettings.agent, appSettings.llmProviders);
    appSettings.imageAgent = normalizeAgentModelPreferences(appSettings.imageAgent, appSettings.llmProviders);
    appSettings.learning = normalizeLearningPreferences(
      appSettings.learning,
      appSettings.llmProviders,
      appSettings.agent,
    );
    appSettings.translation = normalizeTranslationPreferencesForProviders(
      appSettings.translation,
      appSettings.llmProviders,
    );
    saveAppSettings();
    return getLlmProviders();
  }

  function setLearningPreferences(input?: Partial<LearningPreferences> | null) {
    appSettings.learning = normalizeLearningPreferences({
      ...appSettings.learning,
      ...input,
    }, appSettings.llmProviders, appSettings.agent);
    saveAppSettings();
    return getLearningPreferences();
  }

  function setStartPageDockItems(
    workspaceId?: string,
    input?: StartPageDockItem[] | null,
  ) {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const dockItems = normalizeStartPageDockItems(input);

    if (!normalizedWorkspaceId) {
      appSettings.startPage = {
        ...appSettings.startPage,
        dockItems,
      };
      saveAppSettings();
      return getStartPageDockItems();
    }

    appSettings.startPage = {
      ...appSettings.startPage,
      workspaceDockItems: {
        ...appSettings.startPage.workspaceDockItems,
        [normalizedWorkspaceId]: dockItems,
      },
    };
    saveAppSettings();
    return getStartPageDockItems(normalizedWorkspaceId);
  }

  function addToStartPageDock(
    workspaceId?: string,
    input?: Partial<StartPageDockItem> | null,
  ) {
    const nextItem = normalizeStartPageDockItem(input);
    if (!nextItem) {
      return getStartPageDockItems(workspaceId);
    }

    const dockItems = getStartPageDockItems(workspaceId);
    const urlKey = nextItem.url.toLowerCase();
    const existingIndex = dockItems.findIndex((item) => item.url.toLowerCase() === urlKey);

    if (existingIndex >= 0) {
      const current = dockItems[existingIndex]!;
      dockItems[existingIndex] = {
        createdAt: current.createdAt,
        id: current.id,
        ...(nextItem.favicon || current.favicon
          ? { favicon: nextItem.favicon ?? current.favicon }
          : {}),
        title: nextItem.title,
        url: nextItem.url,
      };
    } else {
      dockItems.push(nextItem);
    }

    return setStartPageDockItems(workspaceId, dockItems);
  }

  function setStartPageDockItemFavicon(
    workspaceId: string | undefined,
    id: unknown,
    favicon: unknown,
  ) {
    const normalizedId = typeof id === "string" ? id.trim() : "";
    const normalizedFavicon =
      typeof favicon === "string" && favicon.trim()
        ? favicon.trim()
        : "";
    if (!normalizedId || !normalizedFavicon) {
      return getStartPageDockItems(workspaceId);
    }

    const dockItems = getStartPageDockItems(workspaceId);
    const existingIndex = dockItems.findIndex((item) => item.id === normalizedId);
    if (existingIndex < 0) {
      return getStartPageDockItems(workspaceId);
    }

    const current = dockItems[existingIndex]!;
    if (current.favicon === normalizedFavicon) {
      return getStartPageDockItems(workspaceId);
    }

    dockItems[existingIndex] = {
      ...current,
      favicon: normalizedFavicon,
    };
    return setStartPageDockItems(workspaceId, dockItems);
  }

  function removeStartPageDockItem(workspaceId: string | undefined, id: unknown) {
    const normalizedId = typeof id === "string" ? id.trim() : "";
    if (!normalizedId) {
      return getStartPageDockItems(workspaceId);
    }

    const currentDockItems = getStartPageDockItems(workspaceId);
    const dockItems = currentDockItems.filter((item) => item.id !== normalizedId);
    if (dockItems.length === currentDockItems.length) {
      return getStartPageDockItems(workspaceId);
    }

    return setStartPageDockItems(workspaceId, dockItems);
  }

  function clearStartPageDockItems(workspaceId?: string) {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    if (!normalizedWorkspaceId && appSettings.startPage.dockItems.length === 0) {
      return [] as StartPageDockItem[];
    }

    return setStartPageDockItems(normalizedWorkspaceId, []);
  }

  function clearStartPageDockItemOverrides(workspaceIds: string[]) {
    const nextOverrides = {
      ...appSettings.startPage.workspaceDockItems,
    };
    let changed = false;

    for (const workspaceId of workspaceIds) {
      const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
      if (!normalizedWorkspaceId || !(normalizedWorkspaceId in nextOverrides)) {
        continue;
      }

      delete nextOverrides[normalizedWorkspaceId];
      changed = true;
    }

    if (!changed) {
      return false;
    }

    appSettings.startPage = {
      ...appSettings.startPage,
      workspaceDockItems: nextOverrides,
    };
    saveAppSettings();
    return true;
  }

  function setStartPageWidgets(
    workspaceId?: string,
    input?: StartPageWidget[] | null,
  ) {
    const normalizedWorkspaceId = typeof workspaceId === "string" ? workspaceId.trim() : "";
    const nextWidgets = normalizeStartPageWidgets(input);
    if (!normalizedWorkspaceId) {
      appSettings.startPage = {
        ...appSettings.startPage,
        widgets: nextWidgets,
        widgetsMigrated: true,
      };
      saveAppSettings();
      return getStartPageWidgetsState();
    }

    appSettings.startPage = {
      ...appSettings.startPage,
      workspaceWidgetStates: {
        ...appSettings.startPage.workspaceWidgetStates,
        [normalizedWorkspaceId]: {
          items: nextWidgets,
          migrated: true,
        },
      },
    };
    saveAppSettings();
    return getStartPageWidgetsState(normalizedWorkspaceId);
  }

  function clearStartPageWidgetStateOverrides(workspaceIds: string[]) {
    const nextOverrides = {
      ...appSettings.startPage.workspaceWidgetStates,
    };
    let changed = false;

    for (const workspaceId of workspaceIds) {
      const normalizedWorkspaceId = typeof workspaceId === "string" ? workspaceId.trim() : "";
      if (!normalizedWorkspaceId || !(normalizedWorkspaceId in nextOverrides)) {
        continue;
      }

      delete nextOverrides[normalizedWorkspaceId];
      changed = true;
    }

    if (!changed) {
      return false;
    }

    appSettings.startPage = {
      ...appSettings.startPage,
      workspaceWidgetStates: nextOverrides,
    };
    saveAppSettings();
    return true;
  }

  function addStartPageProtocolWidget(workspaceId?: string, input?: {
    gridH?: number | null;
    gridW?: number | null;
    source?: string | null;
    title?: string | null;
    skipIfExists?: boolean;
  }): StartPageProtocolWidgetAddResult {
    const normalizedWorkspaceId = typeof workspaceId === "string" ? workspaceId.trim() : "";
    const source = typeof input?.source === "string" ? input.source.trim() : "";
    if (!source || !source.toLowerCase().startsWith("widget://")) {
      return {
        added: false,
        widgetId: "",
        widgetsState: getStartPageWidgetsState(normalizedWorkspaceId),
      };
    }

    const skipIfExists = input?.skipIfExists !== false;
    const currentWidgetsState = getStartPageWidgetsState(normalizedWorkspaceId);
    const existingWidget = currentWidgetsState.items.find((widget) =>
      widget.type === "protocol" && widget.source === source);
    if (existingWidget && skipIfExists) {
      return {
        added: false,
        widgetId: existingWidget.id,
        widgetsState: currentWidgetsState,
      };
    }

    const gridH = Number.isFinite(input?.gridH)
      ? clampStartPageWidgetSpan(input?.gridH, START_PAGE_WIDGET_GRID_SCAN_LIMIT)
      : START_PAGE_PROTOCOL_WIDGET_DEFAULT_SIZE.h;
    const gridW = Number.isFinite(input?.gridW)
      ? clampStartPageWidgetSpan(input?.gridW, START_PAGE_WIDGET_GRID_COLUMNS)
      : START_PAGE_PROTOCOL_WIDGET_DEFAULT_SIZE.w;
    const widget = normalizeStartPageWidget({
      gridH,
      gridW,
      gridX: 0,
      gridY: 0,
      source,
      title: typeof input?.title === "string" ? input.title.trim() : "",
      type: "protocol",
    });
    if (!widget || widget.type !== "protocol") {
      return {
        added: false,
        widgetId: "",
        widgetsState: currentWidgetsState,
      };
    }
    const nextWidgets = [
      ...currentWidgetsState.items,
      widget,
    ];
    const widgetsState = setStartPageWidgets(normalizedWorkspaceId, nextWidgets);
    return {
      added: true,
      widgetId: widget.id,
      widgetsState,
    };
  }

  function setStartPageAppearance(
    workspaceId?: string,
    input?: Partial<StartPageAppearance> | null,
  ) {
    const normalizedWorkspaceId = typeof workspaceId === "string" ? workspaceId.trim() : "";
    if (!normalizedWorkspaceId) {
      appSettings.startPage = {
        ...appSettings.startPage,
        appearance: normalizeStartPageAppearance({
          ...appSettings.startPage.appearance,
          ...input,
        }),
      };
      saveAppSettings();
      return getStartPageAppearance();
    }

    appSettings.startPage = {
      ...appSettings.startPage,
      workspaceAppearanceOverrides: {
        ...appSettings.startPage.workspaceAppearanceOverrides,
        [normalizedWorkspaceId]: normalizeStartPageAppearance({
          ...getStartPageAppearance(normalizedWorkspaceId),
          ...input,
        }),
      },
    };
    saveAppSettings();
    return getStartPageAppearance(normalizedWorkspaceId);
  }

  function clearStartPageAppearanceOverrides(workspaceIds: string[]) {
    const nextOverrides = {
      ...appSettings.startPage.workspaceAppearanceOverrides,
    };
    let changed = false;

    for (const workspaceId of workspaceIds) {
      const normalizedWorkspaceId = typeof workspaceId === "string" ? workspaceId.trim() : "";
      if (!normalizedWorkspaceId || !(normalizedWorkspaceId in nextOverrides)) {
        continue;
      }

      delete nextOverrides[normalizedWorkspaceId];
      changed = true;
    }

    if (!changed) {
      return false;
    }

    appSettings.startPage = {
      ...appSettings.startPage,
      workspaceAppearanceOverrides: nextOverrides,
    };
    saveAppSettings();
    return true;
  }

  function setTranslationPreferences(input?: Partial<TranslationPreferences> | null) {
    appSettings.translation = normalizeTranslationPreferencesForProviders({
      ...appSettings.translation,
      ...input,
      sources: {
        ...appSettings.translation.sources,
        ...input?.sources,
        "openai-compatible": {
          ...appSettings.translation.sources["openai-compatible"],
          ...input?.sources?.["openai-compatible"],
        },
        "google-basic": {
          ...appSettings.translation.sources["google-basic"],
          ...input?.sources?.["google-basic"],
        },
        "google-system": {
          ...appSettings.translation.sources["google-system"],
          ...input?.sources?.["google-system"],
        },
        "baidu-standard": {
          ...appSettings.translation.sources["baidu-standard"],
          ...input?.sources?.["baidu-standard"],
        },
      },
    }, appSettings.llmProviders);
    saveAppSettings();
    return getTranslationPreferences();
  }

  function applyThemeToNativeTheme(theme: AppTheme) {
    if (theme === "light") {
      nativeTheme.themeSource = "light";
      return;
    }
    if (theme === "dark") {
      nativeTheme.themeSource = "dark";
      return;
    }
    nativeTheme.themeSource = "system";
  }

  function resolveBrowserLocale(language: AppLanguage = appSettings.language) {
    if (language !== "system") {
      return language;
    }

    const systemLocale = app.getLocale().trim().replace(/_/g, "-");
    return systemLocale || "en-US";
  }

  function resolveUiLocale(language: AppLanguage = appSettings.language): TranslationUiLocale {
    const locale = resolveBrowserLocale(language).trim().toLowerCase();
    return locale.startsWith("zh") ? "zh-CN" : "en-US";
  }

  function buildPreferredLanguages(locale: string) {
    const normalizedLocale = locale.trim().replace(/_/g, "-") || "en-US";
    const preferredLanguages: string[] = [];

    const appendLanguage = (value: string) => {
      const normalizedValue = value.trim();
      if (!normalizedValue) {
        return;
      }

      const valueKey = normalizedValue.toLowerCase();
      if (preferredLanguages.some((entry) => entry.toLowerCase() === valueKey)) {
        return;
      }

      preferredLanguages.push(normalizedValue);
    };

    appendLanguage(normalizedLocale);

    const primaryLanguage = normalizedLocale.split("-")[0];
    if (primaryLanguage && primaryLanguage.toLowerCase() !== normalizedLocale.toLowerCase()) {
      appendLanguage(primaryLanguage);
    }

    appendLanguage("en-US");
    appendLanguage("en");

    return preferredLanguages;
  }

  function buildAcceptLanguageHeader(locale: string) {
    return buildPreferredLanguages(locale)
      .slice(0, 4)
      .map((entry, index) => {
        if (index === 0) {
          return entry;
        }

        return `${entry};q=${(1 - index * 0.1).toFixed(1)}`;
      })
      .join(",");
  }

  function buildNavigatorLanguageOverrideScript(locale: string) {
    const preferredLanguage = JSON.stringify(locale);
    const preferredLanguages = JSON.stringify(buildPreferredLanguages(locale));

    return `
(() => {
  const language = ${preferredLanguage};
  const languages = Object.freeze(${preferredLanguages}.slice());

  const overrideProperty = (target, key, value) => {
    if (!target) {
      return false;
    }

    try {
      Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        get() {
          return value;
        },
      });
      return true;
    } catch {
      return false;
    }
  };

  overrideProperty(Navigator.prototype, "language", language)
    || overrideProperty(navigator, "language", language);
  overrideProperty(Navigator.prototype, "languages", languages)
    || overrideProperty(navigator, "languages", languages);
})();
    `.trim();
  }

  function resolveColorScheme(theme: AppTheme): ResolvedColorScheme {
    if (theme === "system") {
      return nativeTheme.shouldUseDarkColors ? "dark" : "light";
    }

    return theme;
  }

  function getResolvedColorScheme() {
    return resolveColorScheme(appSettings.theme);
  }

  return {
    applyThemeToNativeTheme,
    buildAcceptLanguageHeader,
    buildNavigatorLanguageOverrideScript,
    clearStartPageDockItems,
    clearStartPageDockItemOverrides,
    clearStartPageAppearanceOverrides,
    clearStartPageWidgetStateOverrides,
    getAgentPreferences,
    getDownloadPreferences,
    getDownloadSettings,
    getImageAgentPreferences,
    getLanguage,
    getLlmProviders,
    getLearningPreferences,
    getResolvedColorScheme,
    getSettings,
    getStartPageAppearance,
    getStartPageDockItems,
    getStartPageWidgetsState,
    getTheme,
    getTranslationPreferences,
    loadAppSettings,
    parseDownloadHeadersText,
    resolveBrowserLocale,
    resolveColorScheme,
    resolveDownloadDirectory,
    resolveUiLocale,
    setAgentPreferences,
    setDownloadPreferences,
    setImageAgentPreferences,
    setLanguage,
    setLlmProviders,
    setLearningPreferences,
    setStartPageAppearance,
    setStartPageDockItems,
    setStartPageWidgets,
    addStartPageProtocolWidget,
    addToStartPageDock,
    setStartPageDockItemFavicon,
    removeStartPageDockItem,
    setTheme,
    setTranslationPreferences,
  };
}
