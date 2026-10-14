import { createHash } from "node:crypto";
import * as http from "node:http";
import * as https from "node:https";
import { session, type WebContents } from "electron";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

export type TranslationProvider = "openai-compatible" | "google-basic" | "google-system" | "baidu-standard";
export type TranslationTargetLanguage = "system" | "en-US" | "zh-CN";
export type TranslationUiLocale = "en-US" | "zh-CN";

export interface OpenAICompatibleTranslationSource {
  providerId: string;
  endpoint: string;
  apiKey: string;
  model: string;
  extraBodyEnabled: boolean;
  extraBody: Record<string, unknown>;
  extraHeadersEnabled: boolean;
  extraHeaders: Record<string, string>;
  extractThinkingContent: boolean;
  thinkingContentTagName: string;
  interleavedThinkingEnabled: boolean;
  interleavedThinkingFieldName: string;
}

export interface GoogleBasicTranslationSource {
  endpoint: string;
  apiKey: string;
}

export interface GoogleSystemTranslationSource {
  endpoint: string;
}

export interface BaiduTranslationSource {
  endpoint: string;
  appId: string;
  apiKey: string;
}

export interface TranslationPreferences {
  provider: TranslationProvider;
  targetLanguage: TranslationTargetLanguage;
  requestConcurrency: number;
  autoTranslateDomains: string[];
  sources: {
    "openai-compatible": OpenAICompatibleTranslationSource;
    "google-basic": GoogleBasicTranslationSource;
    "google-system": GoogleSystemTranslationSource;
    "baidu-standard": BaiduTranslationSource;
  };
}

export interface LegacyTranslationPreferencesInput {
  provider?: TranslationProvider;
  endpoint?: string;
  apiKey?: string;
  model?: string;
  appId?: string;
  targetLanguage?: TranslationTargetLanguage;
  requestConcurrency?: number;
  autoTranslateDomains?: unknown;
  sources?: Partial<{
    "openai-compatible": Partial<OpenAICompatibleTranslationSource>;
    "google-basic": Partial<GoogleBasicTranslationSource>;
    "google-system": Partial<GoogleSystemTranslationSource>;
    "baidu-standard": Partial<BaiduTranslationSource>;
  }>;
}

export interface ResolvedTranslationLanguage {
  code: string;
  name: string;
}

export interface PageTranslationSuccessResult {
  status: "translated";
  sourceLanguage: ResolvedTranslationLanguage;
  targetLanguage: ResolvedTranslationLanguage;
  blockCount: number;
  truncated: boolean;
}

export interface PageTranslationSkippedResult {
  status: "skipped";
  reason: "no-content" | "same-language";
  message: string;
  sourceLanguage?: ResolvedTranslationLanguage;
  targetLanguage?: ResolvedTranslationLanguage;
}

interface ExtractedTranslationBlock {
  id: string;
  text: string;
  runCount: number;
}

interface ExtractedTranslationRun {
  id: string;
  blockId: string;
  text: string;
  target: "text" | "attribute";
  attributeName?: string;
}

interface ExtractedPageTranslationContent {
  title: string;
  langHint: string | null;
  blocks: ExtractedTranslationBlock[];
  runs: ExtractedTranslationRun[];
  excerpt: string;
  truncated: boolean;
}

interface TranslationSegment {
  id: string;
  itemId: string;
  text: string;
}

interface TranslationBatchItem {
  id: string;
  text: string;
}

interface TranslationBatchResult {
  items: TranslationBatchItem[];
  detectedSourceLanguage?: ResolvedTranslationLanguage;
}

interface TranslationBannerPayload {
  tone: "info" | "success" | "error";
  title: string;
  detail?: string;
  progress?: string;
  dismissAfterMs?: number;
  controls?: TranslationBannerControls;
}

interface TranslationBannerControls {
  mode: "busy" | "translated" | "ready";
  sourceLanguageCode: string;
  targetLanguageCode: string;
  sourceLanguageName?: string;
  targetLanguageName?: string;
  sourceLanguageOptions: Array<{ code: string; name: string }>;
  targetLanguageOptions: Array<{ code: string; name: string }>;
  labels: {
    source: string;
    target: string;
    translate: string;
    cancel: string;
    showOriginal: string;
    swap: string;
  };
}

const DEFAULT_OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_INTERLEAVED_THINKING_FIELD_NAME = "reasoning_content";
const DEFAULT_GOOGLE_ENDPOINT = "https://translation.googleapis.com/language/translate/v2";
const DEFAULT_GOOGLE_SYSTEM_ENDPOINT = "https://translate.googleapis.com/translate_a/single";
const DEFAULT_BAIDU_ENDPOINT = "https://fanyi-api.baidu.com/api/trans/vip/translate";
const DEFAULT_TARGET_LANGUAGE: TranslationTargetLanguage = "system";
const DEFAULT_REQUEST_CONCURRENCY = 6;
const MIN_REQUEST_CONCURRENCY = 1;
const MAX_REQUEST_CONCURRENCY = 8;
const EXTRACTION_MAX_BLOCKS = 500;
const EXTRACTION_MAX_CHARS = 200_000;
const LAZY_TRANSLATION_VIEWPORT_PAGES = 2;
const SEGMENT_MAX_CHARS = 1_800;
const GOOGLE_SYSTEM_SEGMENT_MAX_CHARS = 500;
const OPENAI_BATCH_MAX_ITEMS = 40;
const OPENAI_BATCH_MAX_CHARS = 20_000;
const GOOGLE_BATCH_MAX_ITEMS = 48;
const GOOGLE_BATCH_MAX_CHARS = 20_000;
const GOOGLE_SYSTEM_BATCH_MAX_ITEMS = 1;
const GOOGLE_SYSTEM_BATCH_MAX_CHARS = GOOGLE_SYSTEM_SEGMENT_MAX_CHARS;
const BAIDU_BATCH_MAX_ITEMS = 48;
const BAIDU_BATCH_MAX_CHARS = 20_000;
const REQUEST_TIMEOUT_MS = 90_000;
const REQUEST_RETRY_MAX_ATTEMPTS = 3;
const REQUEST_RETRY_BASE_DELAY_MS = 750;
const REQUEST_RETRY_MAX_DELAY_MS = 6_000;
const MILO_TRANSLATION_ID_ATTR = "data-milo-translate-id";
const MILO_TRANSLATION_ROOT_ATTR = "data-milo-translation-root";
const MILO_TRANSLATION_APPLIED_ATTR = "data-milo-translation-applied";
const MILO_TRANSLATION_BLOCK_ATTR = "data-milo-translation-block";
const MILO_TRANSLATION_HIDDEN_ATTR = "data-milo-translation-hidden";
const OPENAI_TRANSLATION_REQUEST_MODES = [
  "thinking-disabled",
  "reasoning-effort-none",
  "reasoning-effort-low",
  "plain",
] as const;
type OpenAITranslationRequestMode = (typeof OPENAI_TRANSLATION_REQUEST_MODES)[number];
type TranslationProxyAgent = http.Agent | https.Agent;

const translationProxyAgentsByKey = new Map<string, TranslationProxyAgent>();

const LANGUAGE_NAME_MAP: Record<string, string> = {
  ar: "Arabic",
  de: "German",
  en: "English",
  es: "Spanish",
  fr: "French",
  hi: "Hindi",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  pt: "Portuguese",
  ru: "Russian",
  zh: "Chinese",
  "zh-cn": "Simplified Chinese",
  "zh-hans": "Simplified Chinese",
  "zh-hant": "Traditional Chinese",
  "zh-tw": "Traditional Chinese",
};

const uiText: Record<
  TranslationUiLocale,
  {
    preparing: string;
    detecting: string;
    translating: string;
    translatedTitle: string;
    sameLanguage: (language: string) => string;
    noContent: string;
    source: string;
    target: string;
    translate: string;
    cancel: string;
    showOriginal: string;
    swap: string;
  }
> = {
  "en-US": {
    preparing: "Preparing page translation...",
    detecting: "Detecting page language...",
    translating: "Translating page...",
    translatedTitle: "Page translated",
    sameLanguage: (language) => `This page already appears to be in ${language}.`,
    noContent: "No readable article text was found on this page.",
    source: "Source",
    target: "Target",
    translate: "Translate",
    cancel: "Cancel",
    showOriginal: "Show original",
    swap: "Swap languages",
  },
  "zh-CN": {
    preparing: "正在准备整页翻译...",
    detecting: "正在识别页面语言...",
    translating: "正在翻译整页内容...",
    translatedTitle: "网页已翻译",
    sameLanguage: (language) => `当前页面看起来已经是 ${language}。`,
    noContent: "当前页面没有识别到可翻译的正文内容。",
    source: "源语言",
    target: "目标语言",
    translate: "翻译",
    cancel: "取消",
    showOriginal: "显示原文",
    swap: "互换语言",
  },
};

const TRANSLATION_SOURCE_LANGUAGE_OPTIONS = [
  { code: "auto", name: "Detect language" },
  { code: "en-US", name: "English" },
  { code: "zh-CN", name: "Simplified Chinese" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "es", name: "Spanish" },
  { code: "pt", name: "Portuguese" },
  { code: "ru", name: "Russian" },
];

const TRANSLATION_TARGET_LANGUAGE_OPTIONS = TRANSLATION_SOURCE_LANGUAGE_OPTIONS
  .filter((item) => item.code !== "auto");

function ensureTranslationLanguageOption(
  options: Array<{ code: string; name: string }>,
  languageCode: string,
  languageName?: string,
) {
  if (!languageCode || options.some((option) => option.code === languageCode)) {
    return options;
  }

  return [
    ...options,
    {
      code: languageCode,
      name: languageName || describeLanguage(languageCode).name,
    },
  ];
}

const openAITranslationRequestModesByEndpoint = new Map<string, OpenAITranslationRequestMode>();

function createTranslationAbortError(message = "Page translation cancelled.") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function createTranslationSameLanguageError(
  message: string,
  sourceLanguage: ResolvedTranslationLanguage,
  targetLanguage: ResolvedTranslationLanguage,
) {
  const error = new Error(message) as Error & {
    name: "TranslationSameLanguageError";
    sourceLanguage: ResolvedTranslationLanguage;
    targetLanguage: ResolvedTranslationLanguage;
  };
  error.name = "TranslationSameLanguageError";
  error.sourceLanguage = sourceLanguage;
  error.targetLanguage = targetLanguage;
  return error;
}

function isTranslationSameLanguageError(
  error: unknown,
): error is Error & {
  name: "TranslationSameLanguageError";
  sourceLanguage: ResolvedTranslationLanguage;
  targetLanguage: ResolvedTranslationLanguage;
} {
  return error instanceof Error && error.name === "TranslationSameLanguageError";
}

function normalizeTranslationAbortReason(reason: unknown) {
  if (reason instanceof Error) {
    return reason;
  }

  if (typeof reason === "string" && reason.trim()) {
    return createTranslationAbortError(reason.trim());
  }

  return createTranslationAbortError();
}

function throwIfTranslationAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw normalizeTranslationAbortReason(signal.reason);
  }
}

function isDestroyedObjectError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /object has been destroyed|webcontents.*destroyed|target.*destroyed/i.test(message);
}

export function isTranslationLifecycleError(error: unknown) {
  return (
    (error instanceof Error && error.name === "AbortError")
    || isDestroyedObjectError(error)
  );
}

export const DEFAULT_TRANSLATION_PREFERENCES: TranslationPreferences = Object.freeze({
  provider: "openai-compatible",
  targetLanguage: DEFAULT_TARGET_LANGUAGE,
  requestConcurrency: DEFAULT_REQUEST_CONCURRENCY,
  autoTranslateDomains: [],
  sources: {
    "openai-compatible": {
      providerId: "",
      endpoint: DEFAULT_OPENAI_ENDPOINT,
      apiKey: "",
      model: "",
      extraBodyEnabled: false,
      extraBody: {},
      extraHeadersEnabled: false,
      extraHeaders: {},
      extractThinkingContent: false,
      thinkingContentTagName: "think",
      interleavedThinkingEnabled: false,
      interleavedThinkingFieldName: DEFAULT_INTERLEAVED_THINKING_FIELD_NAME,
    },
    "google-basic": {
      endpoint: DEFAULT_GOOGLE_ENDPOINT,
      apiKey: "",
    },
    "google-system": {
      endpoint: DEFAULT_GOOGLE_SYSTEM_ENDPOINT,
    },
    "baidu-standard": {
      endpoint: DEFAULT_BAIDU_ENDPOINT,
      appId: "",
      apiKey: "",
    },
  },
});

export function normalizeTranslationProvider(value: unknown): TranslationProvider {
  if (
    value === "google-basic"
    || value === "google-system"
    || value === "baidu-standard"
    || value === "openai-compatible"
  ) {
    return value;
  }
  return "openai-compatible";
}

export function normalizeTranslationTargetLanguage(
  value: unknown,
): TranslationTargetLanguage {
  const normalized = String(value ?? DEFAULT_TARGET_LANGUAGE).trim().toLowerCase();
  if (normalized === "en" || normalized === "en-us") {
    return "en-US";
  }
  if (normalized === "zh" || normalized === "zh-cn" || normalized === "zh-hans") {
    return "zh-CN";
  }
  return "system";
}

export function normalizeTranslationRequestConcurrency(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_REQUEST_CONCURRENCY;
  }

  return Math.min(MAX_REQUEST_CONCURRENCY, Math.max(MIN_REQUEST_CONCURRENCY, parsed));
}

export function normalizeTranslationDomain(value: unknown) {
  const rawValue = String(value ?? "").trim().toLowerCase();
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = new URL(rawValue.includes("://") ? rawValue : `https://${rawValue}`);
    const hostname = parsed.hostname.replace(/^www\./i, "").trim().toLowerCase();
    return hostname || null;
  } catch {
    const hostname = rawValue.replace(/^www\./i, "");
    return /^[a-z0-9.-]+$/i.test(hostname) && hostname.includes(".") ? hostname : null;
  }
}

export function getTranslationDomainForUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return normalizeTranslationDomain(parsed.hostname);
  } catch {
    return null;
  }
}

function normalizeAutoTranslateDomains(value: unknown) {
  const values = Array.isArray(value) ? value : [];
  const domains = new Set<string>();
  for (const entry of values) {
    const domain = normalizeTranslationDomain(entry);
    if (domain) {
      domains.add(domain);
    }
  }
  return [...domains].sort((left, right) => left.localeCompare(right));
}

function normalizeProviderId(value: unknown) {
  return String(value ?? "").trim();
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

function normalizeExtraBody(value: unknown) {
  const source = typeof value === "string" ? parseJsonConfigObject(value) : value;
  const normalized = normalizeJsonConfigValue(source);
  return normalized && typeof normalized === "object" && !Array.isArray(normalized)
    ? normalized as Record<string, unknown>
    : {};
}

function normalizeExtraHeaders(value: unknown) {
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

function normalizeExtractThinkingContent(value: unknown) {
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractThinkingContentFromText(
  content: string,
  options: {
    enabled: boolean;
    tagName: string;
  },
) {
  if (!options.enabled || !content) {
    return content;
  }

  const tagName = normalizeThinkingContentTagName(options.tagName);
  const pattern = new RegExp(
    `<\\s*${escapeRegExp(tagName)}(?:\\s[^>]*)?>` +
      `([\\s\\S]*?)` +
      `<\\s*\\/\\s*${escapeRegExp(tagName)}\\s*>`,
    "gi",
  );
  return content
    .replace(pattern, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeTranslationPreferences(
  input?: LegacyTranslationPreferencesInput | null,
): TranslationPreferences {
  const provider = normalizeTranslationProvider(input?.provider);
  const legacyEndpoint = String(input?.endpoint ?? "").trim();
  const legacyApiKey = String(input?.apiKey ?? "").trim();
  const legacyModel = String(input?.model ?? "").trim();
  const legacyAppId = String(input?.appId ?? "").trim();
  const normalizedOpenAIExtraBody = normalizeExtraBody(
    input?.sources?.["openai-compatible"]?.extraBody
    ?? (input?.sources?.["openai-compatible"] as { extra_body?: unknown } | undefined)?.extra_body,
  );
  const normalizedOpenAIExtraHeaders = normalizeExtraHeaders(
    input?.sources?.["openai-compatible"]?.extraHeaders
    ?? (input?.sources?.["openai-compatible"] as { extraHeader?: unknown } | undefined)?.extraHeader
    ?? (input?.sources?.["openai-compatible"] as { extra_headers?: unknown } | undefined)?.extra_headers
    ?? (input?.sources?.["openai-compatible"] as { extra_header?: unknown } | undefined)?.extra_header,
  );

  return {
    provider,
    targetLanguage: normalizeTranslationTargetLanguage(input?.targetLanguage),
    requestConcurrency: normalizeTranslationRequestConcurrency(input?.requestConcurrency),
    autoTranslateDomains: normalizeAutoTranslateDomains(input?.autoTranslateDomains),
    sources: {
      "openai-compatible": {
        providerId: normalizeProviderId(input?.sources?.["openai-compatible"]?.providerId),
        endpoint: normalizeEndpoint(
          input?.sources?.["openai-compatible"]?.endpoint ?? legacyEndpoint,
          DEFAULT_OPENAI_ENDPOINT,
        ),
        apiKey: normalizeSecret(input?.sources?.["openai-compatible"]?.apiKey ?? legacyApiKey),
        model: normalizeSecret(input?.sources?.["openai-compatible"]?.model ?? legacyModel),
        extraBodyEnabled: normalizeExtraConfigEnabled(
          input?.sources?.["openai-compatible"]?.extraBodyEnabled
          ?? (input?.sources?.["openai-compatible"] as { extra_body_enabled?: unknown } | undefined)?.extra_body_enabled,
          normalizedOpenAIExtraBody,
        ),
        extraBody: normalizedOpenAIExtraBody,
        extraHeadersEnabled: normalizeExtraConfigEnabled(
          input?.sources?.["openai-compatible"]?.extraHeadersEnabled
          ?? (input?.sources?.["openai-compatible"] as { extraHeaderEnabled?: unknown } | undefined)?.extraHeaderEnabled
          ?? (input?.sources?.["openai-compatible"] as { extra_headers_enabled?: unknown } | undefined)?.extra_headers_enabled
          ?? (input?.sources?.["openai-compatible"] as { extra_header_enabled?: unknown } | undefined)?.extra_header_enabled,
          normalizedOpenAIExtraHeaders,
        ),
        extraHeaders: normalizedOpenAIExtraHeaders,
        extractThinkingContent: normalizeExtractThinkingContent(
          input?.sources?.["openai-compatible"]?.extractThinkingContent
          ?? (input?.sources?.["openai-compatible"] as { extract_thinking_content?: unknown } | undefined)?.extract_thinking_content,
        ),
        thinkingContentTagName: normalizeThinkingContentTagName(
          input?.sources?.["openai-compatible"]?.thinkingContentTagName
          ?? (input?.sources?.["openai-compatible"] as { thinking_content_tag_name?: unknown } | undefined)?.thinking_content_tag_name
          ?? (input?.sources?.["openai-compatible"] as { thinkingTagName?: unknown } | undefined)?.thinkingTagName
          ?? (input?.sources?.["openai-compatible"] as { thinking_tag_name?: unknown } | undefined)?.thinking_tag_name,
        ),
        interleavedThinkingEnabled: normalizeInterleavedThinkingEnabled(
          input?.sources?.["openai-compatible"]?.interleavedThinkingEnabled
          ?? (input?.sources?.["openai-compatible"] as { interleaved_thinking_enabled?: unknown } | undefined)?.interleaved_thinking_enabled,
        ),
        interleavedThinkingFieldName: normalizeInterleavedThinkingFieldName(
          input?.sources?.["openai-compatible"]?.interleavedThinkingFieldName
          ?? (input?.sources?.["openai-compatible"] as { interleaved_thinking_field_name?: unknown } | undefined)?.interleaved_thinking_field_name
          ?? (input?.sources?.["openai-compatible"] as { thinkingFieldName?: unknown } | undefined)?.thinkingFieldName
          ?? (input?.sources?.["openai-compatible"] as { thinking_field_name?: unknown } | undefined)?.thinking_field_name,
        ),
      },
      "google-basic": {
        endpoint: normalizeEndpoint(
          input?.sources?.["google-basic"]?.endpoint,
          DEFAULT_GOOGLE_ENDPOINT,
        ),
        apiKey: normalizeSecret(input?.sources?.["google-basic"]?.apiKey),
      },
      "google-system": {
        endpoint: normalizeEndpoint(
          input?.sources?.["google-system"]?.endpoint,
          DEFAULT_GOOGLE_SYSTEM_ENDPOINT,
        ),
      },
      "baidu-standard": {
        endpoint: normalizeEndpoint(
          input?.sources?.["baidu-standard"]?.endpoint,
          DEFAULT_BAIDU_ENDPOINT,
        ),
        appId: normalizeSecret(input?.sources?.["baidu-standard"]?.appId ?? legacyAppId),
        apiKey: normalizeSecret(input?.sources?.["baidu-standard"]?.apiKey),
      },
    },
  };
}

export function isTranslationConfigured(preferences: TranslationPreferences) {
  switch (preferences.provider) {
    case "google-basic":
      return Boolean(preferences.sources["google-basic"].endpoint && preferences.sources["google-basic"].apiKey);
    case "google-system":
      return Boolean(preferences.sources["google-system"].endpoint);
    case "baidu-standard":
      return Boolean(
        preferences.sources["baidu-standard"].endpoint
        && preferences.sources["baidu-standard"].appId
        && preferences.sources["baidu-standard"].apiKey
      );
    case "openai-compatible":
    default:
      return Boolean(
        preferences.sources["openai-compatible"].endpoint
        && preferences.sources["openai-compatible"].apiKey
        && preferences.sources["openai-compatible"].model,
      );
  }
}

export function isTranslatablePageUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "file:";
  } catch {
    return false;
  }
}

export function resolveTranslationTargetLanguage(
  targetLanguage: TranslationTargetLanguage,
  browserLocale: string,
): ResolvedTranslationLanguage {
  const normalizedCode = normalizeLanguageCode(
    targetLanguage === "system" ? browserLocale : targetLanguage,
  ) || "en-US";
  return describeLanguage(normalizedCode);
}

export function resolveTranslationSourceLanguage(languageCode: string | null | undefined) {
  const normalizedCode = normalizeLanguageCode(languageCode);
  return normalizedCode && normalizedCode !== "auto"
    ? describeLanguage(normalizedCode)
    : null;
}

export async function translatePageInWebContents(input: {
  webContents: WebContents;
  preferences: TranslationPreferences;
  sourceLanguage?: ResolvedTranslationLanguage | null;
  targetLanguage: ResolvedTranslationLanguage;
  uiLocale: TranslationUiLocale;
  incremental?: boolean;
  signal?: AbortSignal;
}) {
  const {
    webContents,
    preferences,
    sourceLanguage = null,
    targetLanguage,
    uiLocale,
    incremental = false,
    signal,
  } = input;
  const text = uiText[uiLocale];
  const selectedSourceLanguageCode = normalizeLanguageCode(sourceLanguage?.code) || "auto";
  const selectedTargetLanguageCode = normalizeLanguageCode(targetLanguage.code) || "en-US";
  const buildControls = (
    mode: TranslationBannerControls["mode"],
    source = sourceLanguage,
    target = targetLanguage,
  ): TranslationBannerControls => ({
    mode,
    sourceLanguageCode: normalizeLanguageCode(source?.code) || selectedSourceLanguageCode,
    targetLanguageCode: normalizeLanguageCode(target.code) || selectedTargetLanguageCode,
    sourceLanguageName: source?.name,
    targetLanguageName: target.name,
    sourceLanguageOptions: ensureTranslationLanguageOption(
      TRANSLATION_SOURCE_LANGUAGE_OPTIONS,
      normalizeLanguageCode(source?.code) || selectedSourceLanguageCode,
      source?.name,
    ),
    targetLanguageOptions: ensureTranslationLanguageOption(
      TRANSLATION_TARGET_LANGUAGE_OPTIONS,
      normalizeLanguageCode(target.code) || selectedTargetLanguageCode,
      target.name,
    ),
    labels: {
      source: text.source,
      target: text.target,
      translate: text.translate,
      cancel: text.cancel,
      showOriginal: text.showOriginal,
      swap: text.swap,
    },
  });

  throwIfTranslationAborted(signal);
  if (!incremental) {
    await updateTranslationBanner(webContents, {
      tone: "info",
      title: text.preparing,
      controls: buildControls("busy"),
    }, signal);
  }

  const extracted = await extractPageTranslationContent(webContents, signal);
  if (extracted.blocks.length === 0 || extracted.runs.length === 0) {
    if (!incremental) {
      await updateTranslationBanner(webContents, {
        tone: "error",
        title: text.noContent,
        controls: buildControls("ready"),
      }, signal);
    }
    return {
      status: "skipped",
      reason: "no-content",
      message: text.noContent,
    } satisfies PageTranslationSkippedResult;
  }

  const hintedSourceLanguage = extracted.langHint ? describeLanguage(extracted.langHint) : null;
  if (!sourceLanguage && hintedSourceLanguage && haveSamePrimaryLanguage(hintedSourceLanguage.code, targetLanguage.code)) {
    const message = text.sameLanguage(targetLanguage.name);
    await updateTranslationBanner(webContents, {
      tone: "info",
      title: message,
      controls: buildControls("ready", hintedSourceLanguage),
    }, signal);
    return {
      status: "skipped",
      reason: "same-language",
      message,
      sourceLanguage: hintedSourceLanguage,
      targetLanguage,
    } satisfies PageTranslationSkippedResult;
  }

  const segments = buildTranslationSegments(
    extracted.runs,
    getTranslationSegmentMaxChars(preferences.provider),
  );
  const batches = createTranslationBatches(preferences.provider, segments);
  const translationsBySegmentId = new Map<string, string>();
  const appliedRunIds = new Set<string>();
  const progressStep = getTranslationProgressUpdateStep(batches.length);
  let resolvedSourceLanguage = sourceLanguage ?? hintedSourceLanguage;
  let completedBatchCount = 0;
  let applyTranslatedContentQueue = Promise.resolve();
  let applyTranslatedContentError: unknown = null;

  const queueTranslatedRunsApplication = (
    runsToApply: ExtractedTranslationRun[],
    banner?: TranslationBannerPayload,
    applySignal?: AbortSignal,
  ) => {
    if (runsToApply.length === 0) {
      return applyTranslatedContentQueue;
    }

    const blockIds = [...new Set(runsToApply.map((run) => run.blockId))];
    applyTranslatedContentQueue = applyTranslatedContentQueue
      .then(() => (
        applyTranslatedContentInPlace(webContents, {
          blockIds,
          runs: runsToApply,
          banner,
        }, applySignal)
      ))
      .catch((error) => {
        applyTranslatedContentError ??= error;
      });
    return applyTranslatedContentQueue;
  };

  const enqueueTranslatedRunsApplication = (
    runsToApply: ExtractedTranslationRun[],
    banner: TranslationBannerPayload | undefined,
    applySignal?: AbortSignal,
  ) => {
    void queueTranslatedRunsApplication(runsToApply, banner, applySignal);
  };

  if (!incremental) {
    await updateTranslationBanner(webContents, {
      tone: "info",
      title: text.translating,
      progress: `0/${batches.length}`,
      controls: buildControls("busy", resolvedSourceLanguage),
    }, signal);
  }

  try {
    await mapWithConcurrency(
      batches,
      getTranslationExecutionConcurrency(preferences),
      async (batch, _batchIndex, batchSignal) => {
        const translated = await translateProviderBatch(preferences, {
          sourceLanguage: resolvedSourceLanguage,
          targetLanguage,
          items: batch.map((segment) => ({
            id: segment.id,
            text: segment.text,
          })),
        }, batchSignal);

        if (!resolvedSourceLanguage && translated.detectedSourceLanguage) {
          resolvedSourceLanguage = translated.detectedSourceLanguage;
          if (haveSamePrimaryLanguage(resolvedSourceLanguage.code, targetLanguage.code)) {
            throw createTranslationSameLanguageError(
              text.sameLanguage(targetLanguage.name),
              resolvedSourceLanguage,
              targetLanguage,
            );
          }
        }

        completedBatchCount += 1;
        for (const item of translated.items) {
          translationsBySegmentId.set(item.id, item.text);
        }

        const progress = `${completedBatchCount}/${batches.length}`;
        if (
          !incremental
          && (
            completedBatchCount === batches.length
            || completedBatchCount === 1
            || completedBatchCount % progressStep === 0
          )
        ) {
          await updateTranslationBanner(webContents, {
            tone: "info",
            title: text.translating,
            progress,
            controls: buildControls("busy", resolvedSourceLanguage),
          }, batchSignal);
        }

        const completedRuns = combineCompletedTranslatedItems(
          extracted.runs,
          segments,
          translationsBySegmentId,
          appliedRunIds,
        );
        for (const run of completedRuns) {
          appliedRunIds.add(run.id);
        }

        enqueueTranslatedRunsApplication(completedRuns, incremental
          ? undefined
          : {
              tone: "info",
              title: text.translating,
              progress,
              controls: buildControls("busy", resolvedSourceLanguage),
            }, batchSignal);

        return translated;
      },
      signal,
    );
  } catch (error) {
    if (isTranslationSameLanguageError(error)) {
      await updateTranslationBanner(webContents, {
        tone: "info",
        title: error.message,
        controls: buildControls("ready", error.sourceLanguage, error.targetLanguage),
      }, signal);
      return {
        status: "skipped",
        reason: "same-language",
        message: error.message,
        sourceLanguage: error.sourceLanguage,
        targetLanguage: error.targetLanguage,
      } satisfies PageTranslationSkippedResult;
    }

    throw error;
  }

  const finalSourceLanguage = resolvedSourceLanguage ?? describeLanguage(extracted.langHint || "en-US");
  const translatedRuns = combineCompletedTranslatedItems(
    extracted.runs,
    segments,
    translationsBySegmentId,
    appliedRunIds,
  );
  for (const run of translatedRuns) {
    appliedRunIds.add(run.id);
  }
  throwIfTranslationAborted(signal);
  await queueTranslatedRunsApplication(translatedRuns, incremental
    ? undefined
    : {
        tone: "success",
        title: text.translatedTitle,
        controls: buildControls("translated", finalSourceLanguage, targetLanguage),
        dismissAfterMs: 5_000,
      }, signal);
  await applyTranslatedContentQueue;
  if (applyTranslatedContentError) {
    throw applyTranslatedContentError;
  }
  if (!incremental) {
    await updateTranslationBanner(webContents, {
      tone: "success",
      title: text.translatedTitle,
      controls: buildControls("translated", finalSourceLanguage, targetLanguage),
      dismissAfterMs: 5_000,
    }, signal);
  }

  return {
    status: "translated",
    sourceLanguage: finalSourceLanguage,
    targetLanguage,
    blockCount: extracted.blocks.length,
    truncated: extracted.truncated,
  } satisfies PageTranslationSuccessResult;
}

export async function translateSelectedTextInWebContents(input: {
  webContents: WebContents;
  preferences: TranslationPreferences;
  selectedText: string;
  targetLanguage: ResolvedTranslationLanguage;
  uiLocale: TranslationUiLocale;
  anchor?: { x: number; y: number };
  signal?: AbortSignal;
}) {
  const { webContents, preferences, selectedText, targetLanguage, uiLocale, anchor, signal } = input;
  const text = uiText[uiLocale];
  const normalizedText = selectedText.trim();
  if (!normalizedText) {
    return;
  }

  await updateSelectionTranslationPopover(webContents, {
    tone: "info",
    title: text.translating,
    detail: "",
    anchor,
  }, signal);

  const translated = await translateProviderBatch(preferences, {
    sourceLanguage: null,
    targetLanguage,
    items: [
      {
        id: "selection",
        text: normalizedText.slice(0, 8_000),
      },
    ],
  }, signal);

  const translatedText = translated.items.find((item) => item.id === "selection")?.text.trim();
  await updateSelectionTranslationPopover(webContents, {
    tone: "success",
    title: targetLanguage.name,
    detail: translatedText || normalizedText,
    anchor,
  }, signal);
}

export async function restoreTranslatedPageInWebContents(webContents: WebContents) {
  await executeTranslationJavaScript(webContents, `
    (() => {
      const rootAttr = '${MILO_TRANSLATION_ROOT_ATTR}';
      const appliedAttr = '${MILO_TRANSLATION_APPLIED_ATTR}';
      const skipTags = new Set([
        'AUDIO',
        'CANVAS',
        'IFRAME',
        'IMG',
        'LINK',
        'META',
        'NOSCRIPT',
        'SCRIPT',
        'SOURCE',
        'STYLE',
        'SVG',
        'VIDEO',
      ]);
      const standaloneTags = new Set([
        'BUTTON',
        'CAPTION',
        'INPUT',
        'LABEL',
        'LEGEND',
        'OPTION',
        'SELECT',
        'SUMMARY',
        'TEXTAREA',
      ]);
      const standaloneRoles = new Set([
        'button',
        'menuitem',
        'menuitemcheckbox',
        'menuitemradio',
        'option',
        'switch',
        'tab',
      ]);

      function normalizeText(text) {
        return String(text || '')
          .replace(/\\u00a0/g, ' ')
          .replace(/\\s+/g, ' ')
          .trim();
      }

      function isInlineDisplay(display) {
        return display === 'inline'
          || display === 'inline-block'
          || display === 'inline-flex'
          || display === 'inline-grid'
          || display === 'contents';
      }

      function isVisible(element) {
        if (!(element instanceof Element)) {
          return false;
        }

        const style = window.getComputedStyle(element);
        if (!style || style.display === 'none' || style.visibility === 'hidden') {
          return false;
        }

        if (element instanceof HTMLElement && element.hidden) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }

      function normalizeRole(element) {
        return normalizeText(element.getAttribute('role') || '').toLowerCase();
      }

      function isStandaloneTranslationElement(element) {
        if (!(element instanceof Element)) {
          return false;
        }

        return standaloneTags.has(element.tagName) || standaloneRoles.has(normalizeRole(element));
      }

      function applyAttributeValue(element, attributeName, value) {
        if (attributeName === 'value' && element instanceof HTMLInputElement) {
          element.value = String(value || '');
          if (value === null || value === undefined) {
            element.removeAttribute('value');
          } else {
            element.setAttribute('value', String(value));
          }
          return;
        }

        if (value === null || value === undefined) {
          element.removeAttribute(attributeName);
          return;
        }

        element.setAttribute(attributeName, String(value));
      }

      function collectInlineTextNodes(node) {
        if (!node || !(node instanceof Element)) {
          return [];
        }

        if (skipTags.has(node.tagName) || node.closest('[' + rootAttr + '="true"]')) {
          return [];
        }

        const textNodes = [];
        for (const child of node.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            if (normalizeText(child.textContent || '')) {
              textNodes.push(child);
            }
            continue;
          }

          if (!(child instanceof Element)) {
            continue;
          }

          if (skipTags.has(child.tagName) || child.tagName === 'BR') {
            continue;
          }

          if (isStandaloneTranslationElement(child)) {
            continue;
          }

          const childStyle = window.getComputedStyle(child);
          if (isInlineDisplay(childStyle.display)) {
            textNodes.push(...collectInlineTextNodes(child));
          }
        }

        return textNodes;
      }

      const rootNodes = document.querySelectorAll('[${MILO_TRANSLATION_ROOT_ATTR}="true"]');
      for (const node of rootNodes) {
        node.remove();
      }

      const translatedNodes = document.querySelectorAll('[${MILO_TRANSLATION_BLOCK_ATTR}="true"]');
      for (const node of translatedNodes) {
        node.remove();
      }

      const hiddenNodes = document.querySelectorAll('[${MILO_TRANSLATION_HIDDEN_ATTR}="true"]');
      for (const node of hiddenNodes) {
        node.removeAttribute('${MILO_TRANSLATION_HIDDEN_ATTR}');
      }

      const appliedNodes = document.querySelectorAll('[' + appliedAttr + '="true"]');
      for (const node of appliedNodes) {
        if (!(node instanceof Element)) {
          continue;
        }

        const originalTexts = Array.isArray(node.__miloTranslationOriginalTexts)
          ? node.__miloTranslationOriginalTexts
          : null;
        if (originalTexts) {
          const textNodes = collectInlineTextNodes(node);
          for (let index = 0; index < textNodes.length && index < originalTexts.length; index += 1) {
            textNodes[index].textContent = String(originalTexts[index] ?? '');
            try {
              delete textNodes[index].__miloTranslationApplied;
            } catch {
              textNodes[index].__miloTranslationApplied = undefined;
            }
          }
        }

        const originalAttributes = node.__miloTranslationOriginalAttributes
          && typeof node.__miloTranslationOriginalAttributes === 'object'
          ? node.__miloTranslationOriginalAttributes
          : null;
        if (originalAttributes) {
          for (const [attributeName, originalValue] of Object.entries(originalAttributes)) {
            applyAttributeValue(node, attributeName, originalValue);
          }
        }

        node.removeAttribute(appliedAttr);
        try {
          delete node.__miloTranslationOriginalTexts;
        } catch {
          node.__miloTranslationOriginalTexts = undefined;
        }
        try {
          delete node.__miloTranslationOriginalAttributes;
        } catch {
          node.__miloTranslationOriginalAttributes = undefined;
        }
        try {
          delete node.__miloTranslationAppliedAttributes;
        } catch {
          node.__miloTranslationAppliedAttributes = undefined;
        }
      }
    })();
  `);
}

function normalizeEndpoint(value: unknown, fallback: string) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function normalizeSecret(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeLanguageCode(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().replace(/_/g, "-");
  if (!normalized) {
    return "";
  }

  if (normalized.length <= 3) {
    return normalized.toLowerCase();
  }

  const [language, region] = normalized.split("-", 2);
  if (!language) {
    return normalized.toLowerCase();
  }

  if (!region) {
    return language.toLowerCase();
  }

  const lowerLanguage = language.toLowerCase();
  if (region.length === 2) {
    return `${lowerLanguage}-${region.toUpperCase()}`;
  }

  return `${lowerLanguage}-${region.toLowerCase()}`;
}

function describeLanguage(languageCode: string): ResolvedTranslationLanguage {
  const normalizedCode = normalizeLanguageCode(languageCode) || "en-US";
  const key = normalizedCode.toLowerCase();
  const primaryKey = normalizedCode.split("-")[0]?.toLowerCase() ?? key;

  return {
    code: normalizedCode,
    name: LANGUAGE_NAME_MAP[key] || LANGUAGE_NAME_MAP[primaryKey] || normalizedCode,
  };
}

function haveSamePrimaryLanguage(left: string, right: string) {
  const normalizedLeft = normalizeLanguageCode(left);
  const normalizedRight = normalizeLanguageCode(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  return normalizedLeft.split("-")[0] === normalizedRight.split("-")[0];
}

async function detectPageLanguage(
  preferences: TranslationPreferences,
  extracted: ExtractedPageTranslationContent,
  signal?: AbortSignal,
) {
  throwIfTranslationAborted(signal);
  const hint = normalizeLanguageCode(extracted.langHint);
  if (hint) {
    return describeLanguage(hint);
  }

  switch (preferences.provider) {
    case "google-basic":
      return detectPageLanguageWithGoogle(preferences.sources["google-basic"], extracted, signal);
    case "google-system":
      return detectPageLanguageWithGoogleSystem(preferences.sources["google-system"], extracted, signal);
    case "baidu-standard":
      return null;
    case "openai-compatible":
    default:
      return detectPageLanguageWithOpenAI(preferences.sources["openai-compatible"], extracted, signal);
  }
}

async function detectPageLanguageWithOpenAI(
  source: OpenAICompatibleTranslationSource,
  extracted: ExtractedPageTranslationContent,
  signal?: AbortSignal,
) {
  const content = await requestOpenAIChatCompletion(source, [
    {
      role: "system",
      content:
        "Detect the primary language of the provided webpage text. Return strict JSON only with keys languageCode and languageName.",
    },
    {
      role: "user",
      content: JSON.stringify({
        title: extracted.title,
        excerpt: extracted.excerpt,
      }),
    },
  ], signal);

  const parsed = parseJsonContent<{ languageCode?: string; languageName?: string }>(content);
  const detected = describeLanguage(parsed.languageCode || extracted.langHint || "en-US");
  return {
    code: detected.code,
    name: parsed.languageName?.trim() || detected.name,
  } satisfies ResolvedTranslationLanguage;
}

async function detectPageLanguageWithGoogle(
  source: GoogleBasicTranslationSource,
  extracted: ExtractedPageTranslationContent,
  signal?: AbortSignal,
) {
  const endpoint = buildGoogleDetectEndpoint(source.endpoint);
  const payload = await requestJson<{
    data?: {
      detections?: Array<Array<{ language?: string }>>;
    };
  }>({
    url: appendSearchParams(endpoint, { key: source.apiKey }),
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      q: extracted.excerpt || extracted.title,
    }),
    signal,
  });

  const detectedCode =
    payload.data?.detections?.[0]?.[0]?.language
    || extracted.langHint
    || "en-US";
  return describeLanguage(detectedCode);
}

async function detectPageLanguageWithGoogleSystem(
  source: GoogleSystemTranslationSource,
  extracted: ExtractedPageTranslationContent,
  signal?: AbortSignal,
) {
  const textSample =
    splitTextForTranslation(
      extracted.excerpt || extracted.title,
      GOOGLE_SYSTEM_SEGMENT_MAX_CHARS,
    )[0]
    || extracted.title;
  const payload = await requestJson<unknown>({
    url: buildGoogleSystemTranslateUrl(source.endpoint, {
      sourceLanguageCode: "auto",
      targetLanguageCode: "en",
      text: textSample,
    }),
    method: "GET",
    signal,
  });

  const detectedCode =
    parseGoogleSystemTranslationPayload(payload).detectedSourceLanguageCode
    || extracted.langHint
    || "en-US";
  return describeLanguage(detectedCode);
}

function buildTranslationSegments(
  items: Array<{ id: string; text: string }>,
  maxChars = SEGMENT_MAX_CHARS,
) {
  const segments: TranslationSegment[] = [];

  for (const item of items) {
    const pieces = splitTextForTranslation(item.text, maxChars);
    for (const [index, text] of pieces.entries()) {
      segments.push({
        id: pieces.length === 1 ? item.id : `${item.id}::${index + 1}`,
        itemId: item.id,
        text,
      });
    }
  }

  return segments;
}

function splitTextForTranslation(text: string, maxChars = SEGMENT_MAX_CHARS) {
  const normalized = String(text).trim();
  if (normalized.length <= maxChars) {
    return [normalized];
  }

  const parts = normalized
    .split(/\n{2,}|(?<=[。！？!?])\s+|(?<=\.)\s+(?=[A-Z0-9])/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    return hardSplitText(normalized, SEGMENT_MAX_CHARS);
  }

  const segments: string[] = [];
  let current = "";

  for (const part of parts) {
    if (part.length > maxChars) {
      if (current) {
        segments.push(current);
        current = "";
      }
      segments.push(...hardSplitText(part, maxChars));
      continue;
    }

    const next = current ? `${current}\n\n${part}` : part;
    if (next.length > maxChars) {
      if (current) {
        segments.push(current);
      }
      current = part;
      continue;
    }

    current = next;
  }

  if (current) {
    segments.push(current);
  }

  return segments.length > 0 ? segments : hardSplitText(normalized, maxChars);
}

function getTranslationSegmentMaxChars(provider: TranslationProvider) {
  return provider === "google-system"
    ? GOOGLE_SYSTEM_SEGMENT_MAX_CHARS
    : SEGMENT_MAX_CHARS;
}

function hardSplitText(text: string, maxChars: number) {
  const segments: string[] = [];
  let remaining = text.trim();

  while (remaining.length > maxChars) {
    let boundary = remaining.lastIndexOf(" ", maxChars);
    if (boundary < Math.floor(maxChars * 0.6)) {
      boundary = maxChars;
    }
    segments.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trim();
  }

  if (remaining) {
    segments.push(remaining);
  }

  return segments.filter(Boolean);
}

function createTranslationBatches(
  provider: TranslationProvider,
  segments: TranslationSegment[],
) {
  const { maxItems, maxChars } = getTranslationBatchLimits(provider);
  const batches: TranslationSegment[][] = [];
  let currentBatch: TranslationSegment[] = [];
  let currentChars = 0;

  for (const segment of segments) {
    const segmentChars = segment.text.length;
    if (
      currentBatch.length > 0
      && (currentBatch.length >= maxItems || currentChars + segmentChars > maxChars)
    ) {
      batches.push(currentBatch);
      currentBatch = [];
      currentChars = 0;
    }

    currentBatch.push(segment);
    currentChars += segmentChars;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

function getTranslationBatchLimits(provider: TranslationProvider) {
  switch (provider) {
    case "google-basic":
      return {
        maxItems: GOOGLE_BATCH_MAX_ITEMS,
        maxChars: GOOGLE_BATCH_MAX_CHARS,
      };
    case "google-system":
      return {
        maxItems: GOOGLE_SYSTEM_BATCH_MAX_ITEMS,
        maxChars: GOOGLE_SYSTEM_BATCH_MAX_CHARS,
      };
    case "baidu-standard":
      return {
        maxItems: BAIDU_BATCH_MAX_ITEMS,
        maxChars: BAIDU_BATCH_MAX_CHARS,
      };
    case "openai-compatible":
    default:
      return {
        maxItems: OPENAI_BATCH_MAX_ITEMS,
        maxChars: OPENAI_BATCH_MAX_CHARS,
      };
  }
}

function getTranslationExecutionConcurrency(preferences: TranslationPreferences) {
  return preferences.provider === "baidu-standard"
    ? 1
    : normalizeTranslationRequestConcurrency(preferences.requestConcurrency);
}

function getTranslationProgressUpdateStep(batchCount: number) {
  if (batchCount <= 6) {
    return 1;
  }

  return Math.max(2, Math.floor(batchCount / 6));
}

async function mapWithConcurrency<T, TResult>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number, signal?: AbortSignal) => Promise<TResult>,
  signal?: AbortSignal,
) {
  if (items.length === 0) {
    return [] as TResult[];
  }

  const limit = Math.min(items.length, Math.max(1, Math.floor(concurrency)));
  const results = new Array<TResult>(items.length);
  const { controller, signal: combinedSignal, dispose } = createChildAbortController(signal);
  let nextIndex = 0;
  let firstError: unknown = null;

  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      if (firstError) {
        return;
      }

      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }

      try {
        results[currentIndex] = await mapper(items[currentIndex]!, currentIndex, combinedSignal);
      } catch (error) {
        if (!firstError) {
          firstError = error;
          controller.abort(createTranslationAbortError("Page translation cancelled."));
        }
        return;
      }
    }
  });

  try {
    await Promise.all(workers);
  } finally {
    dispose();
  }

  if (firstError) {
    throw firstError;
  }

  return results;
}

function createChildAbortController(parentSignal?: AbortSignal) {
  const controller = new AbortController();
  const abortFromParent = () => {
    controller.abort(normalizeTranslationAbortReason(parentSignal?.reason));
  };

  if (parentSignal?.aborted) {
    controller.abort(normalizeTranslationAbortReason(parentSignal.reason));
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  return {
    controller,
    signal: controller.signal,
    dispose: () => {
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

async function translateProviderBatch(
  preferences: TranslationPreferences,
  input: {
    sourceLanguage: ResolvedTranslationLanguage | null;
    targetLanguage: ResolvedTranslationLanguage;
    items: TranslationBatchItem[];
  },
  signal?: AbortSignal,
): Promise<TranslationBatchResult> {
  try {
    let lastError: unknown;
    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        return await translateProviderBatchOnce(preferences, input, signal);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if ((/unexpected translation item/i.test(message) || /Translation API request failed \(429\)/i.test(message)) && attempt < 3) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  } catch (error) {
    if (input.items.length <= 1 || !shouldSplitTranslationBatch(error)) {
      throw error;
    }

    const [leftItems, rightItems] = splitTranslationItems(input.items);
    if (leftItems.length === 0 || rightItems.length === 0) {
      throw error;
    }

    const leftResult = await translateProviderBatch(preferences, {
      ...input,
      items: leftItems,
    }, signal);
    const rightResult = await translateProviderBatch(preferences, {
      ...input,
      sourceLanguage: input.sourceLanguage ?? leftResult.detectedSourceLanguage ?? null,
      items: rightItems,
    }, signal);

    return {
      items: [...leftResult.items, ...rightResult.items],
      detectedSourceLanguage:
        leftResult.detectedSourceLanguage
        ?? rightResult.detectedSourceLanguage,
    };
  }
}

async function translateProviderBatchOnce(
  preferences: TranslationPreferences,
  input: {
    sourceLanguage: ResolvedTranslationLanguage | null;
    targetLanguage: ResolvedTranslationLanguage;
    items: TranslationBatchItem[];
  },
  signal?: AbortSignal,
): Promise<TranslationBatchResult> {
  switch (preferences.provider) {
    case "google-basic":
      return translateBatchWithGoogle(preferences.sources["google-basic"], input, signal);
    case "google-system":
      return translateBatchWithGoogleSystem(preferences.sources["google-system"], input, signal);
    case "baidu-standard":
      return translateBatchWithBaidu(preferences.sources["baidu-standard"], {
        ...input,
        requestConcurrency: normalizeTranslationRequestConcurrency(preferences.requestConcurrency),
      }, signal);
    case "openai-compatible":
    default:
      return translateBatchWithOpenAI(preferences.sources["openai-compatible"], input, signal);
  }
}

function shouldSplitTranslationBatch(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Translation API request failed \((401|403|404|405)\)/i.test(message)) {
    return false;
  }

  return (
    /timed out/i.test(message)
    || /invalid json/i.test(message)
    || /incomplete translation batch/i.test(message)
    || /mismatched translation batch/i.test(message)
    || /unexpected translation item/i.test(message)
    || /duplicate translation item/i.test(message)
    || /Translation API request failed \((408|409|413|429|500|502|503|504)\)/i.test(message)
    || /(context|token|payload|request|content).*(too large|too long|length|size)/i.test(message)
  );
}

function splitTranslationItems(items: TranslationBatchItem[]): [TranslationBatchItem[], TranslationBatchItem[]] {
  if (items.length <= 1) {
    return [items.slice(), []];
  }

  let leftChars = 0;
  let bestIndex = 1;
  const totalChars = items.reduce((sum, item) => sum + item.text.length, 0);
  const targetChars = totalChars / 2;

  for (let index = 0; index < items.length - 1; index += 1) {
    leftChars += items[index]?.text.length ?? 0;
    bestIndex = index + 1;
    if (leftChars >= targetChars) {
      break;
    }
  }

  return [
    items.slice(0, bestIndex),
    items.slice(bestIndex),
  ];
}

async function translateBatchWithOpenAI(
  source: OpenAICompatibleTranslationSource,
  input: {
    sourceLanguage: ResolvedTranslationLanguage | null;
    targetLanguage: ResolvedTranslationLanguage;
    items: TranslationBatchItem[];
  },
  signal?: AbortSignal,
): Promise<TranslationBatchResult> {
  const content = await requestOpenAIChatCompletion(source, [
    {
      role: "system",
      content:
        "Translate webpage text and return strict JSON only with the shape {\"translations\":[{\"id\":\"...\",\"text\":\"...\"}],\"sourceLanguage\":{\"code\":\"...\",\"name\":\"...\"}}. Keep ids unchanged, keep the same number of items, and do not add commentary. sourceLanguage is optional but should be included when you can infer it confidently.",
    },
    {
      role: "user",
      content: JSON.stringify({
        sourceLanguageCode: input.sourceLanguage?.code ?? null,
        targetLanguageCode: input.targetLanguage.code,
        targetLanguageName: input.targetLanguage.name,
        items: input.items,
      }),
    },
  ], signal);

  const parsed = parseJsonContent<{
    translations?: Array<{ id?: string; text?: string }>;
    sourceLanguage?: {
      code?: string;
      name?: string;
    };
  }>(content);

  const translatedItems = Array.isArray(parsed.translations)
    ? parsed.translations
        .filter((item) => typeof item?.id === "string")
        .map((item) => ({
          id: String(item.id),
          text: String(item.text ?? "").trim(),
        }))
    : [];

  validateTranslatedItems(input.items, translatedItems);

  const sourceLanguageCode = normalizeLanguageCode(parsed.sourceLanguage?.code);
  const detectedSourceLanguage = sourceLanguageCode
    ? {
      code: describeLanguage(sourceLanguageCode).code,
      name: parsed.sourceLanguage?.name?.trim() || describeLanguage(sourceLanguageCode).name,
    } satisfies ResolvedTranslationLanguage
    : undefined;

  return {
    items: translatedItems,
    detectedSourceLanguage,
  };
}

async function translateBatchWithGoogle(
  source: GoogleBasicTranslationSource,
  input: {
    sourceLanguage: ResolvedTranslationLanguage | null;
    targetLanguage: ResolvedTranslationLanguage;
    items: TranslationBatchItem[];
  },
  signal?: AbortSignal,
): Promise<TranslationBatchResult> {
  const payload = await requestJson<{
    data?: {
      translations?: Array<{
        translatedText?: string;
        detectedSourceLanguage?: string;
      }>;
    };
  }>({
    url: appendSearchParams(source.endpoint, { key: source.apiKey }),
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      q: input.items.map((item) => item.text),
      target: toGoogleLanguageCode(input.targetLanguage.code),
      source: input.sourceLanguage ? toGoogleLanguageCode(input.sourceLanguage.code) : undefined,
      format: "text",
    }),
    signal,
  });

  const translations = payload.data?.translations ?? [];
  const translatedItems = input.items.map((item, index) => ({
    id: item.id,
    text: decodeHtmlEntities(String(translations[index]?.translatedText ?? "")).trim(),
  }));

  validateTranslatedItems(input.items, translatedItems);

  const detectedSourceLanguage = translations.find((item) => item.detectedSourceLanguage)?.detectedSourceLanguage;
  return {
    items: translatedItems,
    detectedSourceLanguage: detectedSourceLanguage
      ? describeLanguage(detectedSourceLanguage)
      : undefined,
  };
}

async function translateBatchWithGoogleSystem(
  source: GoogleSystemTranslationSource,
  input: {
    sourceLanguage: ResolvedTranslationLanguage | null;
    targetLanguage: ResolvedTranslationLanguage;
    items: TranslationBatchItem[];
  },
  signal?: AbortSignal,
): Promise<TranslationBatchResult> {
  const translatedItems: TranslationBatchItem[] = [];
  let detectedSourceLanguage: ResolvedTranslationLanguage | undefined;

  for (const item of input.items) {
    const payload = await requestJson<unknown>({
      url: buildGoogleSystemTranslateUrl(source.endpoint, {
        sourceLanguageCode: input.sourceLanguage
          ? toGoogleSystemLanguageCode(input.sourceLanguage.code)
          : "auto",
        targetLanguageCode: toGoogleSystemLanguageCode(input.targetLanguage.code),
        text: item.text,
      }),
      method: "GET",
      signal,
    });

    const parsed = parseGoogleSystemTranslationPayload(payload);
    translatedItems.push({
      id: item.id,
      text: parsed.text,
    });

    if (!detectedSourceLanguage && parsed.detectedSourceLanguageCode) {
      detectedSourceLanguage = describeLanguage(parsed.detectedSourceLanguageCode);
    }
  }

  validateTranslatedItems(input.items, translatedItems);

  return {
    items: translatedItems,
    detectedSourceLanguage,
  };
}

async function translateBatchWithBaidu(
  source: BaiduTranslationSource,
  input: {
    sourceLanguage: ResolvedTranslationLanguage | null;
    targetLanguage: ResolvedTranslationLanguage;
    items: TranslationBatchItem[];
    requestConcurrency: number;
  },
  signal?: AbortSignal,
): Promise<TranslationBatchResult> {
  const sourceCode = input.sourceLanguage
    ? toBaiduLanguageCode(input.sourceLanguage.code)
    : "auto";
  const targetCode = toBaiduLanguageCode(input.targetLanguage.code);

  const responses = await mapWithConcurrency(
    input.items,
    input.requestConcurrency,
    async (item, _index, itemSignal) => {
      const salt = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const sign = createHash("md5")
        .update(`${source.appId}${item.text}${salt}${source.apiKey}`)
        .digest("hex");

      const payload = await requestJson<{
        from?: string;
        to?: string;
        error_code?: string;
        error_msg?: string;
        trans_result?: Array<{ dst?: string }>;
      }>({
        url: source.endpoint,
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: new URLSearchParams({
          q: item.text,
          from: sourceCode,
          to: targetCode,
          appid: source.appId,
          salt,
          sign,
        }).toString(),
        signal: itemSignal,
      });

      if (payload.error_code) {
        throw new Error(`Baidu translation failed (${payload.error_code}): ${payload.error_msg || "Unknown error"}`);
      }

      return {
        id: item.id,
        text: String(payload.trans_result?.[0]?.dst ?? "").trim(),
        detectedSourceLanguage: payload.from ? describeLanguage(payload.from) : undefined,
      };
    },
    signal,
  );

  const translatedItems = responses.map((item) => ({
    id: item.id,
    text: item.text,
  }));
  validateTranslatedItems(input.items, translatedItems);

  return {
    items: translatedItems,
    detectedSourceLanguage: responses.find((item) => item.detectedSourceLanguage)?.detectedSourceLanguage,
  };
}

function parseGoogleSystemTranslationPayload(payload: unknown) {
  if (!Array.isArray(payload)) {
    throw new Error("Google system translation returned an unexpected response format.");
  }

  const translatedText = Array.isArray(payload[0])
    ? payload[0]
        .map((entry) => (Array.isArray(entry) && typeof entry[0] === "string" ? entry[0] : ""))
        .join("")
    : "";

  return {
    text: decodeHtmlEntities(translatedText).trim(),
    detectedSourceLanguageCode:
      typeof payload[2] === "string"
        ? normalizeLanguageCode(payload[2])
        : "",
  };
}

function validateTranslatedItems(
  sourceItems: TranslationBatchItem[],
  translatedItems: TranslationBatchItem[],
) {
  if (translatedItems.length !== sourceItems.length) {
    throw new Error("Translation provider returned an incomplete translation batch.");
  }

  const inputIds = new Set(sourceItems.map((item) => item.id));
  const translatedIds = new Set<string>();
  for (const item of translatedItems) {
    if (!inputIds.has(item.id)) {
      throw new Error("Translation provider returned an unexpected translation item.");
    }

    if (translatedIds.has(item.id)) {
      throw new Error("Translation provider returned a duplicate translation item.");
    }
    translatedIds.add(item.id);
  }

  if (translatedIds.size !== sourceItems.length) {
    throw new Error("Translation provider returned a mismatched translation batch.");
  }
}

function combineTranslatedItems(
  sourceRuns: ExtractedTranslationRun[],
  segments: TranslationSegment[],
  translationsBySegmentId: Map<string, string>,
) {
  const combined = new Map<string, string[]>();

  for (const segment of segments) {
    const translatedText = translationsBySegmentId.get(segment.id)?.trim();
    if (!translatedText) {
      continue;
    }

    const current = combined.get(segment.itemId) ?? [];
    current.push(translatedText);
    combined.set(segment.itemId, current);
  }

  return sourceRuns.map((run) => ({
    ...run,
    text: (combined.get(run.id) ?? []).join("\n\n").trim(),
  }));
}

function combineCompletedTranslatedItems(
  sourceRuns: ExtractedTranslationRun[],
  segments: TranslationSegment[],
  translationsBySegmentId: Map<string, string>,
  appliedRunIds: Set<string>,
) {
  const segmentsByRunId = new Map<string, TranslationSegment[]>();
  for (const segment of segments) {
    const current = segmentsByRunId.get(segment.itemId) ?? [];
    current.push(segment);
    segmentsByRunId.set(segment.itemId, current);
  }

  const completedRuns: ExtractedTranslationRun[] = [];
  for (const run of sourceRuns) {
    if (appliedRunIds.has(run.id)) {
      continue;
    }

    const runSegments = segmentsByRunId.get(run.id) ?? [];
    if (runSegments.length === 0) {
      continue;
    }

    const translatedParts: string[] = [];
    let complete = true;
    for (const segment of runSegments) {
      const translatedText = translationsBySegmentId.get(segment.id)?.trim();
      if (!translatedText) {
        complete = false;
        break;
      }
      translatedParts.push(translatedText);
    }

    if (!complete) {
      continue;
    }

    completedRuns.push({
      ...run,
      text: translatedParts.join("\n\n").trim(),
    });
  }

  return completedRuns;
}

async function requestOpenAIChatCompletion(
  source: OpenAICompatibleTranslationSource,
  messages: Array<{ role: "system" | "user"; content: string }>,
  signal?: AbortSignal,
) {
  const headers = {
    ...(source.extraHeadersEnabled ? source.extraHeaders : {}),
    "content-type": "application/json",
    authorization: `Bearer ${source.apiKey}`,
  };
  const baseBody = {
    model: source.model,
    temperature: 0.1,
    messages,
  };
  const preferredMode = openAITranslationRequestModesByEndpoint.get(source.endpoint)
    ?? OPENAI_TRANSLATION_REQUEST_MODES[0];
  const preferredIndex = OPENAI_TRANSLATION_REQUEST_MODES.indexOf(preferredMode);
  const orderedModes = [
    ...OPENAI_TRANSLATION_REQUEST_MODES.slice(preferredIndex),
    ...OPENAI_TRANSLATION_REQUEST_MODES.slice(0, preferredIndex),
  ];

  let payload: {
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; text?: string }>;
      };
    }>;
  } | null = null;
  let lastError: unknown = null;

  for (const mode of orderedModes) {
    try {
      payload = await requestJson({
        url: source.endpoint,
        method: "POST",
        headers,
        body: JSON.stringify({
          ...buildOpenAIChatCompletionBody(baseBody, mode),
          ...(source.extraBodyEnabled ? source.extraBody : {}),
        }),
        signal,
      });
      openAITranslationRequestModesByEndpoint.set(source.endpoint, mode);
      break;
    } catch (error) {
      lastError = error;
      if (!shouldRetryOpenAIWithNextMode(error)) {
        throw error;
      }
    }
  }

  if (!payload) {
    throw (lastError instanceof Error ? lastError : new Error(String(lastError ?? "Translation request failed.")));
  }

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return extractThinkingContentFromText(content, {
      enabled: source.extractThinkingContent,
      tagName: source.thinkingContentTagName,
    }).trim();
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
    return extractThinkingContentFromText(text, {
      enabled: source.extractThinkingContent,
      tagName: source.thinkingContentTagName,
    }).trim();
  }

  throw new Error("Translation API response did not include message content.");
}

function buildOpenAIChatCompletionBody(
  baseBody: {
    model: string;
    temperature: number;
    messages: Array<{ role: "system" | "user"; content: string }>;
  },
  mode: OpenAITranslationRequestMode,
) {
  switch (mode) {
    case "thinking-disabled":
      return {
        ...baseBody,
        thinking: {
          type: "disabled",
        },
      };
    case "reasoning-effort-none":
      return {
        ...baseBody,
        reasoning_effort: "none",
      };
    case "reasoning-effort-low":
      return {
        ...baseBody,
        reasoning_effort: "low",
      };
    case "plain":
    default:
      return baseBody;
  }
}

function shouldRetryOpenAIWithNextMode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /Translation API request failed \(400\)/i.test(message)
    && /(thinking|reasoning[_-]?effort|unsupported|unknown|invalid|extra inputs? are not permitted|required to be omitted|not allowed|unrecognized)/i.test(message)
  );
}

async function requestJson<T>(input: {
  url: string;
  method: "POST" | "GET";
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}) {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= REQUEST_RETRY_MAX_ATTEMPTS; attempt += 1) {
    throwIfTranslationAborted(input.signal);
    const requestUrl = new URL(input.url);
    const proxyUrl = await resolveTranslationProxyUrl(requestUrl);
    const controller = new AbortController();
    const abortFromInputSignal = () => {
      controller.abort(normalizeTranslationAbortReason(input.signal?.reason));
    };
    const timeout = setTimeout(() => {
      controller.abort(new Error("Translation request timed out."));
    }, REQUEST_TIMEOUT_MS);

    if (input.signal) {
      if (input.signal.aborted) {
        clearTimeout(timeout);
        throw normalizeTranslationAbortReason(input.signal.reason);
      }
      input.signal.addEventListener("abort", abortFromInputSignal, { once: true });
    }

    try {
      const response = proxyUrl
        ? await requestTextWithProxy(input, requestUrl, proxyUrl, controller.signal)
        : await requestTextWithFetch(input, controller.signal);

      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `Translation API request failed (${response.status}): ${response.text || response.statusText}`,
        );
      }

      try {
        return JSON.parse(response.text) as T;
      } catch {
        throw new Error("Translation API returned invalid JSON response.");
      }
    } catch (error) {
      lastError = error;
      if (attempt >= REQUEST_RETRY_MAX_ATTEMPTS || !shouldRetryTranslationRequest(error)) {
        throw error;
      }

      await sleepForTranslationRetry(getTranslationRetryDelayMs(attempt), input.signal);
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abortFromInputSignal);
    }
  }

  throw (lastError instanceof Error ? lastError : new Error(String(lastError ?? "Translation request failed.")));
}

async function requestTextWithFetch(
  input: {
    url: string;
    method: "POST" | "GET";
    headers?: Record<string, string>;
    body?: string;
  },
  signal: AbortSignal,
) {
  const response = await fetch(input.url, {
    method: input.method,
    headers: input.headers,
    body: input.body,
    signal,
  });

  return {
    status: response.status,
    statusText: response.statusText,
    text: await response.text(),
  };
}

async function requestTextWithProxy(
  input: {
    method: "POST" | "GET";
    headers?: Record<string, string>;
    body?: string;
  },
  requestUrl: URL,
  proxyUrl: string,
  signal: AbortSignal,
) {
  const agent = getTranslationProxyAgent(requestUrl, proxyUrl);
  const headers = {
    ...(input.headers ?? {}),
  };

  if (input.body !== undefined && !hasHeader(headers, "content-length")) {
    headers["content-length"] = String(Buffer.byteLength(input.body));
  }

  return new Promise<{
    status: number;
    statusText: string;
    text: string;
  }>((resolve, reject) => {
    const transport = requestUrl.protocol === "https:" ? https : http;
    const request = transport.request(requestUrl, {
      method: input.method,
      headers,
      agent,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on("end", () => {
        cleanup();
        resolve({
          status: response.statusCode ?? 0,
          statusText: response.statusMessage ?? "",
          text: Buffer.concat(chunks).toString("utf-8"),
        });
      });
    });

    const cleanup = () => {
      signal.removeEventListener("abort", abortRequest);
    };
    const abortRequest = () => {
      request.destroy(normalizeTranslationAbortReason(signal.reason));
    };

    request.on("error", (error) => {
      cleanup();
      reject(error);
    });

    if (signal.aborted) {
      abortRequest();
      return;
    }
    signal.addEventListener("abort", abortRequest, { once: true });

    if (input.body !== undefined) {
      request.write(input.body);
    }
    request.end();
  });
}

function hasHeader(headers: Record<string, string>, headerName: string) {
  const normalizedName = headerName.toLowerCase();
  return Object.keys(headers).some((name) => name.toLowerCase() === normalizedName);
}

async function resolveTranslationProxyUrl(requestUrl: URL) {
  if (shouldBypassTranslationProxy(requestUrl)) {
    return null;
  }

  return await resolveSystemTranslationProxyUrl(requestUrl)
    ?? resolveEnvironmentTranslationProxyUrl(requestUrl);
}

async function resolveSystemTranslationProxyUrl(requestUrl: URL) {
  try {
    const proxyRules = await session.defaultSession.resolveProxy(requestUrl.toString());
    return parseSystemTranslationProxyRules(proxyRules);
  } catch {
    return null;
  }
}

function parseSystemTranslationProxyRules(proxyRules: string) {
  const rules = proxyRules
    .split(";")
    .map((rule) => rule.trim())
    .filter(Boolean);

  for (const rule of rules) {
    const parsed = parseSystemTranslationProxyRule(rule);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function parseSystemTranslationProxyRule(rule: string) {
  if (/^direct$/i.test(rule)) {
    return null;
  }

  const match = /^(PROXY|HTTP|HTTPS|SOCKS|SOCKS4|SOCKS5)\s+(.+)$/i.exec(rule);
  if (!match) {
    return normalizeTranslationProxyValue(rule);
  }

  const [, scheme, host] = match;
  const proxyScheme = normalizeSystemTranslationProxyScheme(scheme);
  return proxyScheme ? normalizeTranslationProxyValue(`${proxyScheme}://${host.trim()}`) : null;
}

function normalizeSystemTranslationProxyScheme(scheme: string | undefined) {
  switch (scheme?.trim().toUpperCase()) {
    case "PROXY":
    case "HTTP":
      return "http";
    case "HTTPS":
      return "https";
    case "SOCKS":
      return "socks";
    case "SOCKS4":
      return "socks4";
    case "SOCKS5":
      return "socks5";
    default:
      return "";
  }
}

function resolveEnvironmentTranslationProxyUrl(requestUrl: URL) {
  const proxyValue = requestUrl.protocol === "https:"
    ? readFirstEnvironmentValue("https_proxy", "HTTPS_PROXY", "all_proxy", "ALL_PROXY")
    : readFirstEnvironmentValue("http_proxy", "HTTP_PROXY", "all_proxy", "ALL_PROXY");
  if (!proxyValue) {
    return null;
  }

  return normalizeTranslationProxyValue(proxyValue);
}

function normalizeTranslationProxyValue(proxyValue: string) {
  const trimmedProxyValue = proxyValue.trim();
  if (!trimmedProxyValue) {
    return null;
  }

  const normalizedProxyValue = trimmedProxyValue.includes("://")
    ? trimmedProxyValue
    : `http://${trimmedProxyValue}`;
  try {
    const proxyUrl = new URL(normalizedProxyValue);
    return isSupportedTranslationProxyProtocol(proxyUrl.protocol)
      ? proxyUrl.toString()
      : null;
  } catch {
    return null;
  }
}

function readFirstEnvironmentValue(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function isSupportedTranslationProxyProtocol(protocol: string) {
  return (
    protocol === "http:"
    || protocol === "https:"
    || protocol === "socks:"
    || protocol === "socks4:"
    || protocol === "socks4a:"
    || protocol === "socks5:"
    || protocol === "socks5h:"
  );
}

function getTranslationProxyAgent(requestUrl: URL, proxyUrl: string) {
  const cacheKey = `${requestUrl.protocol}\n${proxyUrl}`;
  const cached = translationProxyAgentsByKey.get(cacheKey);
  if (cached) {
    return cached;
  }

  const proxyProtocol = new URL(proxyUrl).protocol;
  const agent = proxyProtocol.startsWith("socks")
    ? new SocksProxyAgent(proxyUrl)
    : requestUrl.protocol === "https:"
      ? new HttpsProxyAgent(proxyUrl)
      : new HttpProxyAgent(proxyUrl);
  translationProxyAgentsByKey.set(cacheKey, agent as TranslationProxyAgent);
  return agent as TranslationProxyAgent;
}

function shouldBypassTranslationProxy(requestUrl: URL) {
  const hostname = normalizeProxyBypassHostname(requestUrl.hostname);
  if (isLocalTranslationProxyBypassHost(hostname)) {
    return true;
  }

  const noProxyValue = readFirstEnvironmentValue("no_proxy", "NO_PROXY");
  if (!noProxyValue) {
    return false;
  }

  const requestPort = requestUrl.port || (requestUrl.protocol === "https:" ? "443" : "80");
  return noProxyValue
    .split(",")
    .some((entry) => isNoProxyEntryMatch(entry, hostname, requestPort));
}

function normalizeProxyBypassHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
}

function isLocalTranslationProxyBypassHost(hostname: string) {
  if (
    hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "127.0.0.1"
    || hostname === "0.0.0.0"
    || hostname === "::1"
    || hostname === "host.docker.internal"
  ) {
    return true;
  }

  const ipv4Parts = hostname.split(".").map((part) => Number.parseInt(part, 10));
  if (ipv4Parts.length !== 4 || ipv4Parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [first = 0, second = 0] = ipv4Parts;
  return (
    first === 10
    || first === 127
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 169 && second === 254)
  );
}

function isNoProxyEntryMatch(entry: string, hostname: string, requestPort: string) {
  const normalizedEntry = entry.trim().toLowerCase();
  if (!normalizedEntry) {
    return false;
  }
  if (normalizedEntry === "*") {
    return true;
  }

  const parsedEntry = parseNoProxyEntry(normalizedEntry);
  if (!parsedEntry.host) {
    return false;
  }
  if (parsedEntry.port && parsedEntry.port !== requestPort) {
    return false;
  }

  const hostPattern = parsedEntry.host.replace(/^\*\./, "").replace(/^\./, "");
  return hostname === hostPattern || hostname.endsWith(`.${hostPattern}`);
}

function parseNoProxyEntry(entry: string) {
  let normalized = entry;
  try {
    if (normalized.includes("://")) {
      const parsed = new URL(normalized);
      return {
        host: normalizeProxyBypassHostname(parsed.hostname),
        port: parsed.port,
      };
    }
  } catch {
    // Fall back to best-effort host parsing below.
  }

  normalized = normalized.replace(/^\[/, "").replace(/\]$/, "");
  const lastColonIndex = normalized.lastIndexOf(":");
  if (lastColonIndex > -1 && normalized.indexOf(":") === lastColonIndex) {
    const possiblePort = normalized.slice(lastColonIndex + 1);
    if (/^\d+$/.test(possiblePort)) {
      return {
        host: normalized.slice(0, lastColonIndex),
        port: possiblePort,
      };
    }
  }

  return {
    host: normalized,
    port: "",
  };
}

function shouldRetryTranslationRequest(error: unknown) {
  if (isTranslationLifecycleError(error)) {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error);

  return (
    /timed out/i.test(message)
    || /invalid json response/i.test(message)
    || /fetch failed/i.test(message)
    || /network/i.test(message)
    || /socket/i.test(message)
    || /connect/i.test(message)
    || /econnreset|econnrefused|etimedout|eai_again|terminated/i.test(message)
    || /Translation API request failed \((408|409|425|429)\)/i.test(message)
    || /Translation API request failed \(5\d\d\)/i.test(message)
  );
}

function getTranslationRetryDelayMs(attempt: number) {
  const exponentialDelay = Math.min(
    REQUEST_RETRY_MAX_DELAY_MS,
    REQUEST_RETRY_BASE_DELAY_MS * (2 ** (attempt - 1)),
  );
  const jitter = Math.floor(Math.random() * 250);
  return exponentialDelay + jitter;
}

function sleepForTranslationRetry(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) {
    return Promise.reject(normalizeTranslationAbortReason(signal.reason));
  }

  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(normalizeTranslationAbortReason(signal?.reason));
    };

    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function executeTranslationJavaScript<T = unknown>(
  webContents: WebContents,
  script: string,
  signal?: AbortSignal,
) {
  throwIfTranslationAborted(signal);
  if (webContents.isDestroyed()) {
    throw createTranslationAbortError("Page translation target was destroyed.");
  }

  try {
    return await webContents.executeJavaScript(script, true) as T;
  } catch (error) {
    if (webContents.isDestroyed() || isDestroyedObjectError(error)) {
      throw createTranslationAbortError("Page translation target was destroyed.");
    }
    throwIfTranslationAborted(signal);
    throw error;
  }
}

function parseJsonContent<T>(content: string) {
  const normalized = content.trim();

  const direct = tryParseJsonValue(normalized);
  if (direct.ok) {
    return direct.value as T;
  }

  for (const candidate of extractFencedJsonCandidates(normalized)) {
    const parsed = tryParseJsonValue(candidate);
    if (parsed.ok) {
      return parsed.value as T;
    }
  }

  throw new Error("Translation API returned invalid JSON.");
}

function tryParseJsonValue(content: string) {
  if (!content) {
    return {
      ok: false,
    } as const;
  }

  try {
    return {
      ok: true,
      value: JSON.parse(content),
    } as const;
  } catch {
    // Fall through and try to recover the first valid JSON object or array.
  }

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character !== "{" && character !== "[") {
      continue;
    }

    const candidate = extractBalancedJsonCandidate(content, index);
    if (!candidate) {
      continue;
    }

    try {
      return {
        ok: true,
        value: JSON.parse(candidate),
      } as const;
    } catch {
      // Keep scanning in case a later JSON block is valid.
    }
  }

  return {
    ok: false,
  } as const;
}

function extractFencedJsonCandidates(content: string) {
  const candidates: string[] = [];
  const pattern = /```(?:json|javascript|js)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null = null;

  while ((match = pattern.exec(content)) !== null) {
    const candidate = match[1]?.trim();
    if (candidate) {
      candidates.push(candidate);
    }
  }

  return candidates;
}

function extractBalancedJsonCandidate(content: string, startIndex: number) {
  const opening = content[startIndex];
  if (opening !== "{" && opening !== "[") {
    return null;
  }

  const stack = [opening === "{" ? "}" : "]"];
  let inString = false;
  let stringQuote = "";
  let escaped = false;

  for (let index = startIndex + 1; index < content.length; index += 1) {
    const character = content[index]!;

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === stringQuote) {
        inString = false;
        stringQuote = "";
      }
      continue;
    }

    if (character === "\"" || character === "'") {
      inString = true;
      stringQuote = character;
      continue;
    }

    if (character === "{") {
      stack.push("}");
      continue;
    }
    if (character === "[") {
      stack.push("]");
      continue;
    }

    if (character === "}" || character === "]") {
      if (stack[stack.length - 1] !== character) {
        return null;
      }

      stack.pop();
      if (stack.length === 0) {
        return content.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function appendSearchParams(url: string, params: Record<string, string>) {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    parsed.searchParams.set(key, value);
  }
  return parsed.toString();
}

function buildGoogleDetectEndpoint(endpoint: string) {
  const trimmed = endpoint.replace(/\/+$/, "");
  return trimmed.endsWith("/detect") ? trimmed : `${trimmed}/detect`;
}

function buildGoogleSystemTranslateUrl(
  endpoint: string,
  input: {
    sourceLanguageCode: string;
    targetLanguageCode: string;
    text: string;
  },
) {
  return appendSearchParams(endpoint, {
    client: "gtx",
    sl: input.sourceLanguageCode || "auto",
    tl: input.targetLanguageCode || "en",
    dt: "t",
    q: input.text,
  });
}

function toGoogleLanguageCode(languageCode: string) {
  const normalized = normalizeLanguageCode(languageCode);
  const primary = normalized.split("-")[0];
  if (primary === "zh") {
    return "zh-CN";
  }
  return primary || "en";
}

function toGoogleSystemLanguageCode(languageCode: string) {
  const normalized = normalizeLanguageCode(languageCode);
  const primary = normalized.split("-")[0];
  return primary || "en";
}

function toBaiduLanguageCode(languageCode: string) {
  const normalized = normalizeLanguageCode(languageCode);
  const primary = normalized.split("-")[0];
  if (primary === "zh") {
    return "zh";
  }
  return primary || "en";
}

function decodeHtmlEntities(text: string) {
  const namedMap: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
  };

  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const normalizedEntity = String(entity).toLowerCase();
    if (normalizedEntity.startsWith("#x")) {
      const codePoint = Number.parseInt(normalizedEntity.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    if (normalizedEntity.startsWith("#")) {
      const codePoint = Number.parseInt(normalizedEntity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return namedMap[normalizedEntity] ?? match;
  });
}

async function extractPageTranslationContent(webContents: WebContents, signal?: AbortSignal) {
  const result = await executeTranslationJavaScript(webContents, `
    (() => {
      const idAttr = '${MILO_TRANSLATION_ID_ATTR}';
      const rootAttr = '${MILO_TRANSLATION_ROOT_ATTR}';
      const appliedAttr = '${MILO_TRANSLATION_APPLIED_ATTR}';
      const maxBlocks = ${EXTRACTION_MAX_BLOCKS};
      const maxChars = ${EXTRACTION_MAX_CHARS};
      const viewportPages = ${LAZY_TRANSLATION_VIEWPORT_PAGES};
      const skipTags = new Set([
        'AUDIO',
        'CANVAS',
        'IFRAME',
        'LINK',
        'META',
        'NOSCRIPT',
        'SCRIPT',
        'SOURCE',
        'STYLE',
        'SVG',
        'VIDEO',
      ]);
      const preferredTags = new Set([
        'ARTICLE',
        'ASIDE',
        'BLOCKQUOTE',
        'BUTTON',
        'CAPTION',
        'CODE',
        'DD',
        'DIV',
        'DT',
        'FIGCAPTION',
        'FIELDSET',
        'FOOTER',
        'FORM',
        'H1',
        'H2',
        'H3',
        'H4',
        'H5',
        'H6',
        'HEADER',
        'LEGEND',
        'LI',
        'MAIN',
        'NAV',
        'P',
        'PRE',
        'SECTION',
        'SUMMARY',
        'TD',
        'TH',
      ]);
      const forceIncludeTags = new Set([
        'BLOCKQUOTE',
        'BUTTON',
        'CAPTION',
        'CODE',
        'FIGCAPTION',
        'H1',
        'H2',
        'H3',
        'H4',
        'H5',
        'H6',
        'LABEL',
        'LEGEND',
        'LI',
        'P',
        'PRE',
        'SUMMARY',
        'TD',
        'TH',
      ]);
      const standaloneTags = new Set([
        'BUTTON',
        'CAPTION',
        'INPUT',
        'LABEL',
        'LEGEND',
        'OPTION',
        'SELECT',
        'SUMMARY',
        'TEXTAREA',
      ]);
      const standaloneRoles = new Set([
        'button',
        'menuitem',
        'menuitemcheckbox',
        'menuitemradio',
        'option',
        'switch',
        'tab',
      ]);

      function normalizeText(text) {
        return String(text || '')
          .replace(/\\u00a0/g, ' ')
          .replace(/\\s+/g, ' ')
          .trim();
      }

      function isInlineDisplay(display) {
        return display === 'inline'
          || display === 'inline-block'
          || display === 'inline-flex'
          || display === 'inline-grid'
          || display === 'contents';
      }

      function isVisible(element) {
        if (!(element instanceof Element)) {
          return false;
        }

        const style = window.getComputedStyle(element);
        if (!style || style.display === 'none' || style.visibility === 'hidden') {
          return false;
        }

        if (element instanceof HTMLElement && element.hidden) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }

      function isInLazyTranslationWindow(element) {
        const rect = element.getBoundingClientRect();
        const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
        const upperBound = viewportHeight * viewportPages;
        return rect.bottom >= 0 && rect.top <= upperBound;
      }

      function normalizeRole(element) {
        return normalizeText(element.getAttribute('role') || '').toLowerCase();
      }

      function isButtonLikeInput(element) {
        if (!(element instanceof HTMLInputElement)) {
          return false;
        }

        const type = String(element.getAttribute('type') || element.type || 'text').toLowerCase();
        return type === 'button' || type === 'submit' || type === 'reset';
      }

      function collectAttributeRuns(element) {
        if (!(element instanceof Element)) {
          return [];
        }

        const runs = [];
        const pushRun = (attributeName, value) => {
          if (
            element.__miloTranslationAppliedAttributes
            && element.__miloTranslationAppliedAttributes[attributeName] === true
          ) {
            return;
          }

          const normalized = normalizeText(value);
          if (!normalized) {
            return;
          }

          runs.push({
            attributeName,
            text: normalized,
          });
        };

        pushRun('title', element.getAttribute('title') || '');
        pushRun('aria-label', element.getAttribute('aria-label') || '');

        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          pushRun('placeholder', element.getAttribute('placeholder') || element.placeholder || '');
        }

        if (element instanceof HTMLImageElement) {
          pushRun('alt', element.getAttribute('alt') || element.alt || '');
        }

        if (isButtonLikeInput(element)) {
          pushRun('value', element.value || element.getAttribute('value') || '');
        }

        return runs;
      }

      function readAttributeValue(element, attributeName) {
        if (attributeName === 'value' && element instanceof HTMLInputElement) {
          return element.value || element.getAttribute('value');
        }

        return element.getAttribute(attributeName);
      }

      function isStandaloneTranslationElement(element) {
        if (!(element instanceof Element)) {
          return false;
        }

        if (standaloneTags.has(element.tagName)) {
          return true;
        }

        if (standaloneRoles.has(normalizeRole(element))) {
          return true;
        }

        return element instanceof HTMLImageElement || isButtonLikeInput(element);
      }

      function collectInlineText(node) {
        if (!node) {
          return '';
        }

        if (node.nodeType === Node.TEXT_NODE) {
          return node.textContent || '';
        }

        if (!(node instanceof Element)) {
          return '';
        }

        if (skipTags.has(node.tagName) || node.closest('[' + rootAttr + '="true"]')) {
          return '';
        }

        if (node instanceof HTMLElement && !isVisible(node)) {
          return '';
        }

        let text = '';
        for (const child of node.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            if (child.__miloTranslationApplied === true) {
              continue;
            }
            text += ' ' + (child.textContent || '');
            continue;
          }

          if (!(child instanceof Element)) {
            continue;
          }

          if (skipTags.has(child.tagName)) {
            continue;
          }

          if (child.tagName === 'BR') {
            text += '\\n';
            continue;
          }

          if (isStandaloneTranslationElement(child)) {
            continue;
          }

          const childStyle = window.getComputedStyle(child);
          if (isInlineDisplay(childStyle.display)) {
            text += ' ' + collectInlineText(child);
          }
        }

        return text;
      }

      function collectInlineTextRuns(node) {
        if (!node) {
          return [];
        }

        if (node.nodeType === Node.TEXT_NODE) {
          const normalized = normalizeText(node.textContent || '');
          return normalized ? [{ text: normalized }] : [];
        }

        if (!(node instanceof Element)) {
          return [];
        }

        if (skipTags.has(node.tagName) || node.closest('[' + rootAttr + '="true"]')) {
          return [];
        }

        if (node instanceof HTMLElement && !isVisible(node)) {
          return [];
        }

        const runs = [];
        for (const child of node.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            if (child.__miloTranslationApplied === true) {
              continue;
            }
            const normalized = normalizeText(child.textContent || '');
            if (normalized) {
              runs.push({ text: normalized });
            }
            continue;
          }

          if (!(child instanceof Element)) {
            continue;
          }

          if (skipTags.has(child.tagName) || child.tagName === 'BR') {
            continue;
          }

          if (isStandaloneTranslationElement(child)) {
            continue;
          }

          const childStyle = window.getComputedStyle(child);
          if (isInlineDisplay(childStyle.display)) {
            runs.push(...collectInlineTextRuns(child));
          }
        }

        return runs;
      }

      function collectInlineTextNodes(node) {
        if (!node || !(node instanceof Element)) {
          return [];
        }

        if (skipTags.has(node.tagName) || node.closest('[' + rootAttr + '="true"]')) {
          return [];
        }

        if (node instanceof HTMLElement && !isVisible(node)) {
          return [];
        }

        const textNodes = [];
        for (const child of node.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            if (child.__miloTranslationApplied === true) {
              continue;
            }
            if (normalizeText(child.textContent || '')) {
              textNodes.push(child);
            }
            continue;
          }

          if (!(child instanceof Element)) {
            continue;
          }

          if (skipTags.has(child.tagName) || child.tagName === 'BR') {
            continue;
          }

          if (isStandaloneTranslationElement(child)) {
            continue;
          }

          const childStyle = window.getComputedStyle(child);
          if (isInlineDisplay(childStyle.display)) {
            textNodes.push(...collectInlineTextNodes(child));
          }
        }

        return textNodes;
      }

      function saveOriginalContent(element, attributeRuns) {
        element.__miloTranslationOriginalTexts = collectInlineTextNodes(element)
          .map((node) => node.textContent || '');

        element.__miloTranslationOriginalAttributes = {};

        for (const run of attributeRuns) {
          element.__miloTranslationOriginalAttributes[run.attributeName] = readAttributeValue(element, run.attributeName);
        }
      }

      const blocks = [];
      const runs = [];
      let totalChars = 0;
      const candidates = document.body ? Array.from(document.body.querySelectorAll('*')) : [];

      function allocateTranslationId() {
        const current = Number.isFinite(window.__miloTranslationNextId)
          ? Math.max(1, Math.floor(window.__miloTranslationNextId))
          : 1;
        let nextId = current;
        let id = 'milo-translate-' + nextId;
        while (document.querySelector('[' + idAttr + '="' + id + '"]')) {
          nextId += 1;
          id = 'milo-translate-' + nextId;
        }
        window.__miloTranslationNextId = nextId + 1;
        return id;
      }

      for (const element of candidates) {
        if (!(element instanceof HTMLElement)) {
          continue;
        }

        if (element.closest('[' + rootAttr + '="true"]')) {
          continue;
        }

        if (element.getAttribute(appliedAttr) === 'true') {
          continue;
        }

        const attributeRuns = collectAttributeRuns(element);
        const isStandalone = isStandaloneTranslationElement(element);

        if (skipTags.has(element.tagName) && attributeRuns.length === 0) {
          continue;
        }

        if (!preferredTags.has(element.tagName) && !isStandalone) {
          const display = window.getComputedStyle(element).display;
          if (isInlineDisplay(display)) {
            continue;
          }
        }

        if (!isVisible(element)) {
          continue;
        }

        if (!isInLazyTranslationWindow(element)) {
          continue;
        }

        const rawText = normalizeText(collectInlineText(element));
        if (!rawText) {
          if (attributeRuns.length === 0) {
            continue;
          }
        }

        const rawRuns = collectInlineTextRuns(element);
        if (rawRuns.length === 0 && attributeRuns.length === 0) {
          continue;
        }

        const blockText = normalizeText([
          rawText,
          ...attributeRuns.map((run) => run.text),
        ].filter(Boolean).join(' '));
        const minChars = isStandalone ? 1 : forceIncludeTags.has(element.tagName) ? 4 : 16;
        if (blockText.length < minChars) {
          continue;
        }

        const existingId = element.getAttribute(idAttr);
        const id = existingId || allocateTranslationId();
        if (!existingId) {
          element.setAttribute(idAttr, id);
        }
        saveOriginalContent(element, attributeRuns);

        blocks.push({
          id,
          text: blockText,
          runCount: rawRuns.length + attributeRuns.length,
        });
        for (const [index, run] of rawRuns.entries()) {
          runs.push({
            id: id + '::run-' + (index + 1),
            blockId: id,
            text: run.text,
            target: 'text',
          });
        }
        for (const run of attributeRuns) {
          runs.push({
            id: id + '::attr-' + run.attributeName,
            blockId: id,
            text: run.text,
            target: 'attribute',
            attributeName: run.attributeName,
          });
        }
        totalChars += blockText.length;

        if (blocks.length >= maxBlocks || totalChars >= maxChars) {
          break;
        }
      }

      const excerpt = blocks
        .slice(0, 10)
        .map((block) => block.text)
        .join('\\n\\n')
        .slice(0, 3000);

      return {
        title: String(document.title || ''),
        langHint: normalizeText(document.documentElement.lang || document.body?.lang || ''),
        blocks,
        runs,
        excerpt,
        truncated: blocks.length >= maxBlocks || totalChars >= maxChars,
      };
    })();
  `, signal);

  return result as ExtractedPageTranslationContent;
}

async function updateTranslationBanner(
  webContents: WebContents,
  payload: TranslationBannerPayload,
  signal?: AbortSignal,
) {
  await executeTranslationJavaScript(webContents, buildBannerScript(payload), signal);
}

export async function removeTranslationBanner(webContents: WebContents, signal?: AbortSignal) {
  await executeTranslationJavaScript(webContents, `
    (() => {
      const bannerRoot = document.getElementById('milo-translation-banner-root');
      if (bannerRoot) bannerRoot.remove();
    })();
  `, signal);
}

async function updateSelectionTranslationPopover(
  webContents: WebContents,
  payload: {
    tone: "info" | "success" | "error";
    title: string;
    detail: string;
    anchor?: { x: number; y: number };
  },
  signal?: AbortSignal,
) {
  await executeTranslationJavaScript(webContents, `
    (() => {
      const payload = ${JSON.stringify(payload)};
      const rootAttr = '${MILO_TRANSLATION_ROOT_ATTR}';
      const styleId = 'milo-selection-translation-style';
      const rootId = 'milo-selection-translation-root';
      const cardId = 'milo-selection-translation-card';

      let style = document.getElementById(styleId);
      if (!style) {
        style = document.createElement('style');
        style.id = styleId;
        style.setAttribute(rootAttr, 'true');
        style.textContent = \`
          #\${rootId} {
            position: fixed;
            z-index: 2147483647;
            pointer-events: auto;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }

          #\${cardId} {
            width: min(420px, calc(100vw - 32px));
            max-height: min(360px, calc(100vh - 32px));
            overflow: auto;
            border-radius: 8px;
            border: 1px solid rgba(218, 220, 224, 0.95);
            background: #fff;
            color: #202124;
            box-shadow: 0 12px 32px rgba(60, 64, 67, 0.24);
            padding: 12px 14px 14px;
          }

          #\${cardId}[data-tone="error"] {
            border-color: rgba(244, 63, 94, 0.4);
          }

          #\${cardId} .milo-selection-translation-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
          }

          #\${cardId} .milo-selection-translation-title {
            font-size: 12px;
            font-weight: 600;
            line-height: 1.45;
            color: #5f6368;
          }

          #\${cardId} .milo-selection-translation-detail {
            margin-top: 8px;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
            font-size: 14px;
            line-height: 1.55;
            color: #202124;
          }

          #\${cardId} .milo-selection-translation-close {
            width: 24px;
            height: 24px;
            flex: 0 0 auto;
            border: 1px solid transparent;
            border-radius: 999px;
            background: transparent;
            color: #5f6368;
            cursor: pointer;
            font: inherit;
            font-size: 16px;
            line-height: 1;
            padding: 0;
          }

          #\${cardId} .milo-selection-translation-close:hover {
            background: rgba(60, 64, 67, 0.08);
          }
        \`;
        document.documentElement.appendChild(style);
      }

      let root = document.getElementById(rootId);
      if (!root) {
        root = document.createElement('div');
        root.id = rootId;
        root.setAttribute(rootAttr, 'true');
        document.documentElement.appendChild(root);
      }

      let card = document.getElementById(cardId);
      if (!card) {
        card = document.createElement('div');
        card.id = cardId;
        root.appendChild(card);
      }

      const getAnchorRect = () => {
        const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
        const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
        let left = Number(payload.anchor?.x);
        let top = Number(payload.anchor?.y);
        let bottom = Number(payload.anchor?.y);
        if (!Number.isFinite(left) || !Number.isFinite(top)) {
          const selection = window.getSelection();
          const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
          const rect = range ? range.getBoundingClientRect() : null;
          left = rect && Number.isFinite(rect.left) ? rect.left : viewportWidth - 440;
          top = rect && Number.isFinite(rect.top) ? rect.top : 24;
          bottom = rect && Number.isFinite(rect.bottom) ? rect.bottom : top;
        }
        return { left, top, bottom, viewportWidth, viewportHeight };
      };

      const positionPopover = () => {
        const margin = 16;
        const gap = 10;
        const anchorRect = getAnchorRect();
        const cardRect = card.getBoundingClientRect();
        const width = Math.min(cardRect.width || 420, Math.max(1, anchorRect.viewportWidth - margin * 2));
        const height = Math.min(cardRect.height || 120, Math.max(1, anchorRect.viewportHeight - margin * 2));
        const maxLeft = Math.max(margin, anchorRect.viewportWidth - width - margin);
        const maxTop = Math.max(margin, anchorRect.viewportHeight - height - margin);
        const preferredLeft = Number.isFinite(anchorRect.left) ? anchorRect.left : margin;
        const preferredTop = Number.isFinite(anchorRect.bottom) ? anchorRect.bottom + gap : margin;
        const flippedTop = Number.isFinite(anchorRect.top) ? anchorRect.top - height - gap : margin;
        const fitsBelow = preferredTop + height <= anchorRect.viewportHeight - margin;
        const rawTop = fitsBelow ? preferredTop : flippedTop;
        const left = Math.max(margin, Math.min(preferredLeft, maxLeft));
        const top = Math.max(margin, Math.min(rawTop, maxTop));
        root.style.left = Math.round(left) + 'px';
        root.style.top = Math.round(top) + 'px';
      };

      if (root.__miloSelectionTranslationReposition) {
        window.removeEventListener('resize', root.__miloSelectionTranslationReposition);
      }
      root.__miloSelectionTranslationReposition = () => {
        const currentRoot = document.getElementById(rootId);
        const currentCard = document.getElementById(cardId);
        if (!currentRoot || !currentCard) return;
        positionPopover();
      };
      window.addEventListener('resize', root.__miloSelectionTranslationReposition, { passive: true });

      root.style.visibility = 'hidden';
      root.style.left = '16px';
      root.style.top = '16px';

      card.setAttribute('data-tone', payload.tone || 'info');
      card.innerHTML = '';

      const header = document.createElement('div');
      header.className = 'milo-selection-translation-header';
      const title = document.createElement('div');
      title.className = 'milo-selection-translation-title';
      title.textContent = payload.title || '';
      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'milo-selection-translation-close';
      closeButton.setAttribute('aria-label', 'Close');
      closeButton.textContent = '×';
      closeButton.addEventListener('click', () => {
        const currentRoot = document.getElementById(rootId);
        if (currentRoot) {
          if (currentRoot.__miloSelectionTranslationReposition) {
            window.removeEventListener('resize', currentRoot.__miloSelectionTranslationReposition);
          }
          currentRoot.remove();
        }
      });
      header.append(title, closeButton);
      card.appendChild(header);

      const detail = document.createElement('div');
      detail.className = 'milo-selection-translation-detail';
      detail.textContent = payload.detail || '';
      card.appendChild(detail);

      positionPopover();
      root.style.visibility = 'visible';
    })();
  `, signal);
}

async function applyTranslatedContentInPlace(
  webContents: WebContents,
  input: {
    blockIds: string[];
    runs: ExtractedTranslationRun[];
    banner?: TranslationBannerPayload;
  },
  signal?: AbortSignal,
) {
  await executeTranslationJavaScript(webContents, `
    (() => {
      const payload = ${JSON.stringify(input)};
      const rootAttr = '${MILO_TRANSLATION_ROOT_ATTR}';
      const idAttr = '${MILO_TRANSLATION_ID_ATTR}';
      const appliedAttr = '${MILO_TRANSLATION_APPLIED_ATTR}';
      const blockAttr = '${MILO_TRANSLATION_BLOCK_ATTR}';
      const hiddenAttr = '${MILO_TRANSLATION_HIDDEN_ATTR}';
      const styleId = 'milo-translation-style';
      const bannerRootId = 'milo-translation-banner-root';
      const bannerCardId = 'milo-translation-banner-card';
      const skipTags = new Set([
        'AUDIO',
        'CANVAS',
        'IFRAME',
        'IMG',
        'LINK',
        'META',
        'NOSCRIPT',
        'SCRIPT',
        'SOURCE',
        'STYLE',
        'SVG',
        'VIDEO',
      ]);
      const standaloneTags = new Set([
        'BUTTON',
        'CAPTION',
        'INPUT',
        'LABEL',
        'LEGEND',
        'OPTION',
        'SELECT',
        'SUMMARY',
        'TEXTAREA',
      ]);
      const standaloneRoles = new Set([
        'button',
        'menuitem',
        'menuitemcheckbox',
        'menuitemradio',
        'option',
        'switch',
        'tab',
      ]);

      function normalizeText(text) {
        return String(text || '')
          .replace(/\\u00a0/g, ' ')
          .replace(/\\s+/g, ' ')
          .trim();
      }

      function isInlineDisplay(display) {
        return display === 'inline'
          || display === 'inline-block'
          || display === 'inline-flex'
          || display === 'inline-grid'
          || display === 'contents';
      }

      function isVisible(element) {
        if (!(element instanceof Element)) {
          return false;
        }

        const style = window.getComputedStyle(element);
        if (!style || style.display === 'none' || style.visibility === 'hidden') {
          return false;
        }

        if (element instanceof HTMLElement && element.hidden) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }

      function normalizeRole(element) {
        return normalizeText(element.getAttribute('role') || '').toLowerCase();
      }

      function isStandaloneTranslationElement(element) {
        if (!(element instanceof Element)) {
          return false;
        }

        return standaloneTags.has(element.tagName) || standaloneRoles.has(normalizeRole(element));
      }

      function applyAttributeValue(element, attributeName, value) {
        if (attributeName === 'value' && element instanceof HTMLInputElement) {
          element.value = String(value || '');
          if (value === null || value === undefined) {
            element.removeAttribute('value');
          } else {
            element.setAttribute('value', String(value));
          }
          return;
        }

        if (value === null || value === undefined) {
          element.removeAttribute(attributeName);
          return;
        }

        element.setAttribute(attributeName, String(value));
      }

      function readAttributeValue(element, attributeName) {
        if (attributeName === 'value' && element instanceof HTMLInputElement) {
          return element.value || element.getAttribute('value');
        }

        return element.getAttribute(attributeName);
      }

      function collectInlineTextNodes(node) {
        if (!node || !(node instanceof Element)) {
          return [];
        }

        if (skipTags.has(node.tagName) || node.closest('[' + rootAttr + '="true"]')) {
          return [];
        }

        if (node instanceof HTMLElement && !isVisible(node)) {
          return [];
        }

        const textNodes = [];
        for (const child of node.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            if (normalizeText(child.textContent || '')) {
              textNodes.push(child);
            }
            continue;
          }

          if (!(child instanceof Element)) {
            continue;
          }

          if (skipTags.has(child.tagName) || child.tagName === 'BR') {
            continue;
          }

          if (isStandaloneTranslationElement(child)) {
            continue;
          }

          const childStyle = window.getComputedStyle(child);
          if (isInlineDisplay(childStyle.display)) {
            textNodes.push(...collectInlineTextNodes(child));
          }
        }

        return textNodes;
      }

      function preserveWhitespace(originalText, translatedText) {
        const leading = (String(originalText || '').match(/^\\s*/) || [''])[0];
        const trailing = (String(originalText || '').match(/\\s*$/) || [''])[0];
        return leading + translatedText + trailing;
      }

      function ensureStyle() {
        let style = document.getElementById(styleId);
        if (!style) {
          style = document.createElement('style');
          style.id = styleId;
          style.setAttribute(rootAttr, 'true');
          document.documentElement.appendChild(style);
        }

        style.textContent = \`
          #\${bannerRootId} {
            position: fixed;
            top: 16px;
            right: 16px;
            z-index: 2147483647;
            pointer-events: auto;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }

          #\${bannerCardId} {
            max-width: 420px;
            min-width: 360px;
            border-radius: 8px;
            border: 1px solid rgba(218, 220, 224, 0.95);
            background: #fff;
            color: #202124;
            box-shadow: 0 12px 32px rgba(60, 64, 67, 0.24);
            padding: 14px 16px 12px;
          }

          #\${bannerCardId}[data-tone="success"] {
            border-color: rgba(16, 185, 129, 0.45);
          }

          #\${bannerCardId}[data-tone="error"] {
            border-color: rgba(244, 63, 94, 0.4);
          }

          #\${bannerCardId} .milo-translation-title {
            font-size: 13px;
            font-weight: 500;
            line-height: 1.4;
          }

          #\${bannerCardId} .milo-translation-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
          }

          #\${bannerCardId} .milo-translation-detail,
          #\${bannerCardId} .milo-translation-progress {
            margin-top: 4px;
            font-size: 12px;
            line-height: 1.5;
            color: #5f6368;
          }

          #\${bannerCardId} .milo-translation-controls {
            display: grid;
            grid-template-columns: 1fr 32px 1fr;
            gap: 8px;
            align-items: end;
            margin-top: 12px;
          }

          #\${bannerCardId} .milo-translation-field {
            display: grid;
            gap: 4px;
            min-width: 0;
          }

          #\${bannerCardId} .milo-translation-label {
            font-size: 11px;
            color: #5f6368;
          }

          #\${bannerCardId} select {
            width: 100%;
            min-width: 0;
            height: 32px;
            border: 1px solid #dadce0;
            border-radius: 6px;
            background: #fff;
            color: #202124;
            font: inherit;
            font-size: 12px;
            padding: 0 8px;
          }

          #\${bannerCardId} .milo-translation-actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            margin-top: 12px;
          }

          #\${bannerCardId} button {
            height: 32px;
            border-radius: 6px;
            border: 1px solid transparent;
            background: transparent;
            color: #1a73e8;
            cursor: pointer;
            font: inherit;
            font-size: 12px;
            font-weight: 500;
            padding: 0 10px;
          }

          #\${bannerCardId} button:hover {
            background: rgba(26, 115, 232, 0.08);
          }

          #\${bannerCardId} button[data-primary="true"] {
            background: #1a73e8;
            color: #fff;
          }

          #\${bannerCardId} button[data-primary="true"]:hover {
            background: #1765cc;
          }

          #\${bannerCardId} button:disabled,
          #\${bannerCardId} select:disabled {
            cursor: default;
            opacity: 0.58;
          }

          #\${bannerCardId} .milo-translation-close {
            width: 24px;
            height: 24px;
            flex: 0 0 auto;
            border-radius: 999px;
            color: #5f6368;
            font-size: 16px;
            line-height: 1;
            padding: 0;
          }
        \`;
      }

      function setupLazyTranslationWatcher() {
        if (window.__miloTranslationLazyWatcherInstalled) {
          if (typeof window.__miloTranslationRequestMore === 'function') {
            window.__miloTranslationRequestMore(true);
          }
          return;
        }

        window.__miloTranslationLazyWatcherInstalled = true;
        window.__miloTranslationLazyLastPage = Math.floor(
          (window.scrollY + window.innerHeight) / Math.max(1, window.innerHeight),
        );
        window.__miloTranslationLazyLastRequestScrollY = window.scrollY || 0;
        window.__miloTranslationLazyLastRequestAt = 0;
        window.__miloTranslationLazyPending = false;

        const requestMore = (force) => {
          const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
          const currentPage = Math.floor((window.scrollY + viewportHeight) / viewportHeight);
          const currentScrollY = window.scrollY || 0;
          const now = Date.now();
          const movedSinceLastRequest = Math.abs(
            currentScrollY - (window.__miloTranslationLazyLastRequestScrollY || 0),
          );
          if (
            !force
            && currentPage <= (window.__miloTranslationLazyLastPage || 0)
            && movedSinceLastRequest < viewportHeight * 0.25
          ) {
            return;
          }

          if (!force && now - (window.__miloTranslationLazyLastRequestAt || 0) < 400) {
            return;
          }

          window.__miloTranslationLazyLastPage = currentPage;
          window.__miloTranslationLazyLastRequestScrollY = currentScrollY;
          window.__miloTranslationLazyLastRequestAt = now;
          if (window.__miloTranslationLazyPending) {
            return;
          }

          window.__miloTranslationLazyPending = true;
          setTimeout(() => {
            window.__miloTranslationLazyPending = false;
            const params = new URLSearchParams();
            params.set('action', 'translate-more');
            params.set('nonce', String(Date.now()) + '-' + Math.random().toString(16).slice(2));
            window.location.href = 'milo-translation://command?' + params.toString();
          }, 160);
        };
        window.__miloTranslationRequestMore = requestMore;

        const scheduleViewportCheck = () => {
          requestMore(false);
        };

        window.addEventListener('scroll', scheduleViewportCheck, { passive: true });
        window.addEventListener('resize', scheduleViewportCheck, { passive: true });
        setTimeout(() => requestMore(true), 0);
      }

      function ensureBanner(payload) {
        let root = document.getElementById(bannerRootId);
        if (!root) {
          root = document.createElement('div');
          root.id = bannerRootId;
          root.setAttribute(rootAttr, 'true');
          document.documentElement.appendChild(root);
        }

        let card = document.getElementById(bannerCardId);
        if (!card) {
          card = document.createElement('div');
          card.id = bannerCardId;
          root.appendChild(card);
        }

        card.setAttribute('data-tone', payload.tone || 'info');
        card.innerHTML = '';

        const header = document.createElement('div');
        header.className = 'milo-translation-header';
        const title = document.createElement('div');
        title.className = 'milo-translation-title';
        title.textContent = payload.title || '';
        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'milo-translation-close';
        closeButton.setAttribute('aria-label', 'Close');
        closeButton.textContent = '×';
        closeButton.addEventListener('click', () => {
          const currentRoot = document.getElementById(bannerRootId);
          if (currentRoot) {
            currentRoot.remove();
          }
        });
        header.append(title, closeButton);
        card.appendChild(header);

        if (payload.detail) {
          const detail = document.createElement('div');
          detail.className = 'milo-translation-detail';
          detail.textContent = payload.detail;
          card.appendChild(detail);
        }

        if (payload.progress) {
          const progress = document.createElement('div');
          progress.className = 'milo-translation-progress';
          progress.textContent = payload.progress;
          card.appendChild(progress);
        }

        if (payload.controls) {
          const controls = payload.controls;
          const disabled = controls.mode === 'busy';
          const command = (action, sourceCode, targetCode) => {
            const params = new URLSearchParams();
            params.set('action', action);
            params.set('nonce', String(Date.now()) + '-' + Math.random().toString(16).slice(2));
            if (sourceCode) params.set('source', sourceCode);
            if (targetCode) params.set('target', targetCode);
            window.location.href = 'milo-translation://command?' + params.toString();
          };
          const makeOption = (option) => {
            const element = document.createElement('option');
            element.value = option.code;
            element.textContent = option.name;
            return element;
          };

          const controlsRow = document.createElement('div');
          controlsRow.className = 'milo-translation-controls';

          const sourceField = document.createElement('label');
          sourceField.className = 'milo-translation-field';
          const sourceLabel = document.createElement('span');
          sourceLabel.className = 'milo-translation-label';
          sourceLabel.textContent = controls.labels.source;
          const sourceSelect = document.createElement('select');
          sourceSelect.disabled = disabled;
          for (const option of controls.sourceLanguageOptions || []) {
            sourceSelect.appendChild(makeOption(option));
          }
          sourceSelect.value = controls.sourceLanguageCode || 'auto';
          sourceField.append(sourceLabel, sourceSelect);

          const swapButton = document.createElement('button');
          swapButton.type = 'button';
          swapButton.textContent = '⇄';
          swapButton.title = controls.labels.swap;
          swapButton.disabled = disabled || sourceSelect.value === 'auto';
          swapButton.addEventListener('click', () => {
            if (sourceSelect.value === 'auto') return;
            command('translate', targetSelect.value, sourceSelect.value);
          });

          const targetField = document.createElement('label');
          targetField.className = 'milo-translation-field';
          const targetLabel = document.createElement('span');
          targetLabel.className = 'milo-translation-label';
          targetLabel.textContent = controls.labels.target;
          const targetSelect = document.createElement('select');
          targetSelect.disabled = disabled;
          for (const option of controls.targetLanguageOptions || []) {
            targetSelect.appendChild(makeOption(option));
          }
          targetSelect.value = controls.targetLanguageCode || 'en-US';
          targetField.append(targetLabel, targetSelect);

          controlsRow.append(sourceField, swapButton, targetField);
          card.appendChild(controlsRow);

          const actions = document.createElement('div');
          actions.className = 'milo-translation-actions';
          const cancelButton = document.createElement('button');
          cancelButton.type = 'button';
          cancelButton.textContent = controls.mode === 'translated'
            ? controls.labels.showOriginal
            : controls.labels.cancel;
          cancelButton.addEventListener('click', () => {
            command(controls.mode === 'translated' ? 'restore' : 'cancel', sourceSelect.value, targetSelect.value);
          });
          actions.appendChild(cancelButton);

          if (controls.mode !== 'busy') {
            const translateButton = document.createElement('button');
            translateButton.type = 'button';
            translateButton.dataset.primary = 'true';
            translateButton.textContent = controls.labels.translate;
            translateButton.addEventListener('click', () => {
              command('translate', sourceSelect.value, targetSelect.value);
            });
            actions.appendChild(translateButton);
          }
          card.appendChild(actions);
        }

        if (root.__miloTranslationDismissTimer) {
          clearTimeout(root.__miloTranslationDismissTimer);
          root.__miloTranslationDismissTimer = null;
        }

        if (typeof payload.dismissAfterMs === 'number' && payload.dismissAfterMs > 0) {
          root.__miloTranslationDismissTimer = setTimeout(() => {
            const currentRoot = document.getElementById(bannerRootId);
            if (currentRoot) {
              currentRoot.remove();
            }
          }, payload.dismissAfterMs);
        }
      }

      ensureStyle();

      const staleBlocks = document.querySelectorAll('[' + blockAttr + '="true"]');
      for (const node of staleBlocks) {
        node.remove();
      }

      const hiddenNodes = document.querySelectorAll('[' + hiddenAttr + '="true"]');
      for (const node of hiddenNodes) {
        node.removeAttribute(hiddenAttr);
      }

      const translatedTextRunsById = new Map();
      const translatedAttributeRunsByBlockId = new Map();
      for (const item of payload.runs) {
        if (item.target === 'attribute' && item.attributeName) {
          const current = translatedAttributeRunsByBlockId.get(item.blockId) || new Map();
          current.set(item.attributeName, item.text);
          translatedAttributeRunsByBlockId.set(item.blockId, current);
          continue;
        }

        translatedTextRunsById.set(item.id, item.text);
      }

      for (const blockId of payload.blockIds) {
        const target = document.querySelector('[' + idAttr + '="' + blockId + '"]');
        if (!(target instanceof Element)) {
          continue;
        }

        const textNodes = collectInlineTextNodes(target);
        const attributeRuns = translatedAttributeRunsByBlockId.get(blockId) || new Map();
        const hasTextNodes = textNodes.length > 0;
        const hasAttributeRuns = attributeRuns.size > 0;
        if (!hasTextNodes && !hasAttributeRuns) {
          continue;
        }

        target.setAttribute(appliedAttr, 'true');

        if (hasTextNodes) {
          if (!Array.isArray(target.__miloTranslationOriginalTexts)) {
            target.__miloTranslationOriginalTexts = textNodes.map((node) => node.textContent || '');
          }

          const originalTexts = Array.isArray(target.__miloTranslationOriginalTexts)
            ? target.__miloTranslationOriginalTexts
            : textNodes.map((node) => node.textContent || '');

          for (const [index, node] of textNodes.entries()) {
            const translatedText = translatedTextRunsById.get(blockId + '::run-' + (index + 1));
            if (!translatedText) {
              continue;
            }

            const originalText = String(originalTexts[index] ?? node.textContent ?? '');
            node.textContent = preserveWhitespace(originalText, translatedText);
            node.__miloTranslationApplied = true;
          }
        }

        if (hasAttributeRuns) {
          if (!target.__miloTranslationOriginalAttributes || typeof target.__miloTranslationOriginalAttributes !== 'object') {
            target.__miloTranslationOriginalAttributes = {};
          }

          for (const [attributeName, translatedText] of attributeRuns.entries()) {
            if (!Object.prototype.hasOwnProperty.call(target.__miloTranslationOriginalAttributes, attributeName)) {
              target.__miloTranslationOriginalAttributes[attributeName] = readAttributeValue(target, attributeName);
            }

            applyAttributeValue(target, attributeName, translatedText);
            if (!target.__miloTranslationAppliedAttributes || typeof target.__miloTranslationAppliedAttributes !== 'object') {
              target.__miloTranslationAppliedAttributes = {};
            }
            target.__miloTranslationAppliedAttributes[attributeName] = true;
          }
        }
      }

      if (payload.banner) {
        ensureBanner(payload.banner);
      }
      setupLazyTranslationWatcher();
    })();
  `, signal);
}

function buildBannerScript(payload: TranslationBannerPayload) {
  return `
    (() => {
      const payload = ${JSON.stringify(payload)};
      const rootAttr = '${MILO_TRANSLATION_ROOT_ATTR}';
      const styleId = 'milo-translation-style';
      const bannerRootId = 'milo-translation-banner-root';
      const bannerCardId = 'milo-translation-banner-card';

      if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.setAttribute(rootAttr, 'true');
        style.textContent = \`
          #\${bannerRootId} {
            position: fixed;
            top: 16px;
            right: 16px;
            z-index: 2147483647;
            pointer-events: auto;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }

          #\${bannerCardId} {
            max-width: 420px;
            min-width: 360px;
            border-radius: 8px;
            border: 1px solid rgba(218, 220, 224, 0.95);
            background: #fff;
            color: #202124;
            box-shadow: 0 12px 32px rgba(60, 64, 67, 0.24);
            padding: 14px 16px 12px;
          }

          #\${bannerCardId}[data-tone="success"] {
            border-color: rgba(16, 185, 129, 0.45);
          }

          #\${bannerCardId}[data-tone="error"] {
            border-color: rgba(244, 63, 94, 0.4);
          }

          #\${bannerCardId} .milo-translation-title {
            font-size: 13px;
            font-weight: 500;
            line-height: 1.4;
          }

          #\${bannerCardId} .milo-translation-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
          }

          #\${bannerCardId} .milo-translation-detail,
          #\${bannerCardId} .milo-translation-progress {
            margin-top: 4px;
            font-size: 12px;
            line-height: 1.5;
            color: #5f6368;
          }

          #\${bannerCardId} .milo-translation-controls {
            display: grid;
            grid-template-columns: 1fr 32px 1fr;
            gap: 8px;
            align-items: end;
            margin-top: 12px;
          }

          #\${bannerCardId} .milo-translation-field {
            display: grid;
            gap: 4px;
            min-width: 0;
          }

          #\${bannerCardId} .milo-translation-label {
            font-size: 11px;
            color: #5f6368;
          }

          #\${bannerCardId} select {
            width: 100%;
            min-width: 0;
            height: 32px;
            border: 1px solid #dadce0;
            border-radius: 6px;
            background: #fff;
            color: #202124;
            font: inherit;
            font-size: 12px;
            padding: 0 8px;
          }

          #\${bannerCardId} .milo-translation-actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            margin-top: 12px;
          }

          #\${bannerCardId} button {
            height: 32px;
            border-radius: 6px;
            border: 1px solid transparent;
            background: transparent;
            color: #1a73e8;
            cursor: pointer;
            font: inherit;
            font-size: 12px;
            font-weight: 500;
            padding: 0 10px;
          }

          #\${bannerCardId} button:hover {
            background: rgba(26, 115, 232, 0.08);
          }

          #\${bannerCardId} button[data-primary="true"] {
            background: #1a73e8;
            color: #fff;
          }

          #\${bannerCardId} button[data-primary="true"]:hover {
            background: #1765cc;
          }

          #\${bannerCardId} button:disabled,
          #\${bannerCardId} select:disabled {
            cursor: default;
            opacity: 0.58;
          }

          #\${bannerCardId} .milo-translation-close {
            width: 24px;
            height: 24px;
            flex: 0 0 auto;
            border-radius: 999px;
            color: #5f6368;
            font-size: 16px;
            line-height: 1;
            padding: 0;
          }
        \`;
        document.documentElement.appendChild(style);
      }

      let root = document.getElementById(bannerRootId);
      if (!root) {
        root = document.createElement('div');
        root.id = bannerRootId;
        root.setAttribute(rootAttr, 'true');
        document.documentElement.appendChild(root);
      }

      let card = document.getElementById(bannerCardId);
      if (!card) {
        card = document.createElement('div');
        card.id = bannerCardId;
        root.appendChild(card);
      }

      card.setAttribute('data-tone', payload.tone || 'info');
      card.innerHTML = '';

      const header = document.createElement('div');
      header.className = 'milo-translation-header';
      const title = document.createElement('div');
      title.className = 'milo-translation-title';
      title.textContent = payload.title || '';
      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'milo-translation-close';
      closeButton.setAttribute('aria-label', 'Close');
      closeButton.textContent = '×';
      closeButton.addEventListener('click', () => {
        const currentRoot = document.getElementById(bannerRootId);
        if (currentRoot) {
          currentRoot.remove();
        }
      });
      header.append(title, closeButton);
      card.appendChild(header);

      if (payload.detail) {
        const detail = document.createElement('div');
        detail.className = 'milo-translation-detail';
        detail.textContent = payload.detail;
        card.appendChild(detail);
      }

      if (payload.progress) {
        const progress = document.createElement('div');
        progress.className = 'milo-translation-progress';
        progress.textContent = payload.progress;
        card.appendChild(progress);
      }

      if (payload.controls) {
        const controls = payload.controls;
        const disabled = controls.mode === 'busy';
        const command = (action, sourceCode, targetCode) => {
          const params = new URLSearchParams();
          params.set('action', action);
          params.set('nonce', String(Date.now()) + '-' + Math.random().toString(16).slice(2));
          if (sourceCode) params.set('source', sourceCode);
          if (targetCode) params.set('target', targetCode);
          window.location.href = 'milo-translation://command?' + params.toString();
        };
        const makeOption = (option) => {
          const element = document.createElement('option');
          element.value = option.code;
          element.textContent = option.name;
          return element;
        };

        const controlsRow = document.createElement('div');
        controlsRow.className = 'milo-translation-controls';

        const sourceField = document.createElement('label');
        sourceField.className = 'milo-translation-field';
        const sourceLabel = document.createElement('span');
        sourceLabel.className = 'milo-translation-label';
        sourceLabel.textContent = controls.labels.source;
        const sourceSelect = document.createElement('select');
        sourceSelect.disabled = disabled;
        for (const option of controls.sourceLanguageOptions || []) {
          sourceSelect.appendChild(makeOption(option));
        }
        sourceSelect.value = controls.sourceLanguageCode || 'auto';
        sourceField.append(sourceLabel, sourceSelect);

        const swapButton = document.createElement('button');
        swapButton.type = 'button';
        swapButton.textContent = '⇄';
        swapButton.title = controls.labels.swap;
        swapButton.disabled = disabled || sourceSelect.value === 'auto';
        swapButton.addEventListener('click', () => {
          if (sourceSelect.value === 'auto') return;
          command('translate', targetSelect.value, sourceSelect.value);
        });

        const targetField = document.createElement('label');
        targetField.className = 'milo-translation-field';
        const targetLabel = document.createElement('span');
        targetLabel.className = 'milo-translation-label';
        targetLabel.textContent = controls.labels.target;
        const targetSelect = document.createElement('select');
        targetSelect.disabled = disabled;
        for (const option of controls.targetLanguageOptions || []) {
          targetSelect.appendChild(makeOption(option));
        }
        targetSelect.value = controls.targetLanguageCode || 'en-US';
        targetField.append(targetLabel, targetSelect);

        controlsRow.append(sourceField, swapButton, targetField);
        card.appendChild(controlsRow);

        const actions = document.createElement('div');
        actions.className = 'milo-translation-actions';
        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.textContent = controls.mode === 'translated'
          ? controls.labels.showOriginal
          : controls.labels.cancel;
        cancelButton.addEventListener('click', () => {
          command(controls.mode === 'translated' ? 'restore' : 'cancel', sourceSelect.value, targetSelect.value);
        });
        actions.appendChild(cancelButton);

        if (controls.mode !== 'busy') {
          const translateButton = document.createElement('button');
          translateButton.type = 'button';
          translateButton.dataset.primary = 'true';
          translateButton.textContent = controls.labels.translate;
          translateButton.addEventListener('click', () => {
            command('translate', sourceSelect.value, targetSelect.value);
          });
          actions.appendChild(translateButton);
        }
        card.appendChild(actions);
      }

      if (root.__miloTranslationDismissTimer) {
        clearTimeout(root.__miloTranslationDismissTimer);
        root.__miloTranslationDismissTimer = null;
      }

      if (typeof payload.dismissAfterMs === 'number' && payload.dismissAfterMs > 0) {
        root.__miloTranslationDismissTimer = setTimeout(() => {
          const currentRoot = document.getElementById(bannerRootId);
          if (currentRoot) {
            currentRoot.remove();
          }
        }, payload.dismissAfterMs);
      }
    })();
  `;
}
