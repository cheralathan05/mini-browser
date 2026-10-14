import { createHash } from "node:crypto";
import {
  defineAgent,
  requestDefinedAgentTurn,
} from "../agent/define-agent.js";
import type { OpenAICompatibleBackendConfig } from "../agent/openai-compatible-backend.js";
import type {
  ContextOpportunity,
  ContextOpportunityKind,
  ContextOpportunitySurface,
  ContextPageObservation,
  ContextPageState,
} from "./types.js";

interface CreateContextIntelligenceServiceOptions {
  resolveBackend: () => OpenAICompatibleBackendConfig | null;
  getInteractionBlacklistDomains?: () => string[];
}

const OPPORTUNITY_COOLDOWN_MS = 10 * 60 * 1000;
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000;
const AGENT_RESULT_CACHE_MS = 90 * 1000;
const AGENT_TIMEOUT_MS = 12 * 1000;

const contextInteractionAgent = defineAgent<undefined>({
  id: "context-interaction-agent",
  systemPrompt: [
    "You decide whether an AI browser should offer a lightweight contextual interaction.",
    "The browser has already collected context. Do not assume a predefined page category.",
    "The trigger can be page_observation, selection_change, focus_change, or copy. Decide from the trigger and context what, if anything, should appear.",
    "Only suggest an interaction when it is clearly useful and tightly grounded in the supplied context.",
    "Do not suggest generic help, marketing copy, or interruptions. If no useful local action exists, return no opportunities.",
    "For passive page observations, be very conservative and return at most one low-noise opportunity.",
    "For user-triggered contexts such as selection_change or focus_change, you may return multiple concise actions if they are useful.",
    "The prompt must tell the downstream browser agent exactly what to do using the current tab context; do not ask the user to restate context.",
    "Return JSON only with this shape: {\"pageType\":\"short freeform description\",\"opportunities\":[{\"kind\":\"freeform_kind\",\"label\":\"short user-facing text\",\"actionLabel\":\"short button label\",\"confidence\":0.0,\"surface\":\"tiny_chip|selection_menu|field_popover|sidebar\",\"prompt\":\"downstream agent prompt\"}]}",
  ],
});

function hashText(value: string) {
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function safeHostname(url: string | undefined) {
  if (!url) {
    return "unknown";
  }
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "") || "unknown";
  } catch {
    return "unknown";
  }
}

function normalizeBlacklistDomain(value: string | undefined) {
  let normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
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
      // Continue best-effort cleanup for user-entered values.
    }
  }

  normalized = normalized.split(/[/?#]/, 1)[0] ?? normalized;
  normalized = normalized.replace(/:\d+$/, "");
  normalized = normalized.replace(/^\.+|\.+$/g, "");
  return normalized || undefined;
}

function hostnameFromUrl(url: string | undefined) {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function matchesBlacklistedDomain(domain: string | undefined, blacklistDomains: string[]) {
  const normalizedDomain = normalizeBlacklistDomain(domain);
  if (!normalizedDomain) {
    return false;
  }

  return blacklistDomains.some((entry) => {
    const normalizedEntry = normalizeBlacklistDomain(entry);
    return Boolean(
      normalizedEntry
      && (normalizedDomain === normalizedEntry || normalizedDomain.endsWith(`.${normalizedEntry}`)),
    );
  });
}

function clip(value: string | undefined, maxLength = 2_000) {
  const normalized = typeof value === "string"
    ? value.replace(/\s+/g, " ").trim()
    : "";
  if (!normalized) {
    return "";
  }
  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`
    : normalized;
}

function clampConfidence(value: unknown) {
  const numberValue = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(1, numberValue));
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown, maxLength = 1_000) {
  return typeof value === "string" ? clip(value, maxLength) : "";
}

function normalizeSurface(value: unknown, fallback: ContextOpportunitySurface): ContextOpportunitySurface {
  switch (value) {
    case "tiny_chip":
    case "selection_menu":
    case "field_popover":
    case "sidebar":
      return value;
    default:
      return fallback;
  }
}

function parseJsonObject(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return readRecord(JSON.parse(trimmed));
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }
    try {
      return readRecord(JSON.parse(match[0]));
    } catch {
      return null;
    }
  }
}

function buildObservationSignature(input: ContextPageObservation) {
  return hashText(JSON.stringify({
    trigger: input.trigger ?? input.surface ?? "page_observation",
    url: input.url,
    title: input.title,
    textSample: clip(input.textSample, 1_200),
    headings: input.headings?.slice(0, 10),
    formHints: input.formHints?.slice(0, 10),
    repeatedItemSamples: input.repeatedItemSamples?.slice(0, 8),
    selectedText: clip(input.selectedText, 1_200),
    focusedElement: input.focusedElement,
    bodyTextLength: input.bodyTextLength,
    articleTextLength: input.articleTextLength,
    inputCount: input.inputCount,
    repeatedItemCount: input.repeatedItemCount,
  }));
}

function buildAgentPrompt(input: ContextPageObservation) {
  const lines = [
    `Trigger: ${input.trigger ?? input.surface ?? "page_observation"}`,
    `Locale: ${input.locale ?? "en-US"}`,
    `URL: ${input.url}`,
    ...(input.title ? [`Title: ${input.title}`] : []),
    `Body text length: ${input.bodyTextLength ?? 0}`,
    `Main/article text length: ${input.articleTextLength ?? 0}`,
    `Heading count: ${input.headingCount ?? 0}`,
    `Link count: ${input.linkCount ?? 0}`,
    `Form count: ${input.formCount ?? 0}`,
    `Input count: ${input.inputCount ?? 0}`,
    `Repeated visible item estimate: ${input.repeatedItemCount ?? 0}`,
    `Selected text length: ${input.selectedText?.length ?? input.selectedTextLength ?? 0}`,
    `Copied text length: ${input.copiedTextLength ?? 0}`,
    `Dwell ms: ${input.dwellMs ?? 0}`,
  ];

  if (input.headings?.length) {
    lines.push(`Visible headings:\n${input.headings.slice(0, 16).map((entry) => `- ${clip(entry, 160)}`).join("\n")}`);
  }
  if (input.formHints?.length) {
    lines.push(`Visible form/field hints:\n${input.formHints.slice(0, 16).map((entry) => `- ${clip(entry, 160)}`).join("\n")}`);
  }
  if (input.repeatedItemSamples?.length) {
    lines.push(`Repeated item samples:\n${input.repeatedItemSamples.slice(0, 10).map((entry) => `- ${clip(entry, 260)}`).join("\n")}`);
  }
  if (input.focusedElement) {
    lines.push(`Focused element:\n${JSON.stringify(input.focusedElement).slice(0, 1_500)}`);
  }
  if (input.selectedText?.trim()) {
    lines.push(`Selected text:\n${clip(input.selectedText, 2_000)}`);
  }
  if (input.textSample?.trim()) {
    lines.push(`Page text sample:\n${clip(input.textSample, 3_000)}`);
  }

  lines.push("Decide the interaction from this context only. The browser code has no predefined scene list.");
  return lines.join("\n");
}

function normalizeAgentOpportunities(
  input: {
    parsed: Record<string, unknown>;
    observation: ContextPageObservation;
    fallbackSurface: ContextOpportunitySurface;
  },
) {
  const raw = Array.isArray(input.parsed.opportunities) ? input.parsed.opportunities : [];
  const host = safeHostname(input.observation.url);
  const opportunities: ContextOpportunity[] = [];

  for (const entry of raw.slice(0, input.fallbackSurface === "tiny_chip" ? 1 : 6)) {
    const record = readRecord(entry);
    if (!record) {
      continue;
    }
    const label = readString(record.label, 120);
    const prompt = readString(record.prompt, 4_000);
    if (!label || !prompt) {
      continue;
    }
    const kind = readString(record.kind, 80) || "agent_suggested";
    const surface = normalizeSurface(record.surface, input.fallbackSurface);
    const actionLabel = readString(record.actionLabel, 32) || undefined;
    const confidence = clampConfidence(record.confidence);
    if (confidence < 0.45) {
      continue;
    }
    const cooldownKey = `${host}:${surface}:${kind}:${hashText(label)}`;
    opportunities.push({
      id: `${kind}:${hashText(`${cooldownKey}:${input.observation.url}:${prompt}`)}`,
      kind,
      label,
      ...(actionLabel ? { actionLabel } : {}),
      confidence,
      surface,
      cooldownKey,
      prompt,
      payload: {
        url: input.observation.url,
        title: input.observation.title,
        host,
      },
    });
  }

  return opportunities;
}

export function createContextIntelligenceService(options: CreateContextIntelligenceServiceOptions) {
  const states = new Map<string, ContextPageState>();
  const dismissed = new Map<string, number>();
  const lastShown = new Map<string, number>();
  const cache = new Map<string, { state: ContextPageState; ts: number }>();
  const inFlight = new Map<string, Promise<ContextPageState>>();

  function prune(now = Date.now()) {
    for (const [key, ts] of dismissed.entries()) {
      if (now - ts > DISMISS_TTL_MS) {
        dismissed.delete(key);
      }
    }
    for (const [key, entry] of cache.entries()) {
      if (now - entry.ts > AGENT_RESULT_CACHE_MS) {
        cache.delete(key);
      }
    }
  }

  function stateKey(input: ContextPageObservation) {
    return input.tabId || input.url;
  }

  function isInteractionBlacklisted(input: ContextPageObservation) {
    return matchesBlacklistedDomain(
      hostnameFromUrl(input.url),
      options.getInteractionBlacklistDomains?.() ?? [],
    );
  }

  function filterVisibleOpportunities(input: {
    observation: ContextPageObservation;
    opportunities: ContextOpportunity[];
    now: number;
  }) {
    const host = safeHostname(input.observation.url);
    return input.opportunities.filter((opportunity) => {
      const dismissKey = `${host}:${opportunity.kind}`;
      if (dismissed.has(dismissKey) || dismissed.has(opportunity.id)) {
        return false;
      }
      if (opportunity.surface === "selection_menu" || opportunity.surface === "field_popover") {
        return true;
      }
      const lastShownAt = lastShown.get(opportunity.cooldownKey) ?? 0;
      return input.now - lastShownAt >= OPPORTUNITY_COOLDOWN_MS;
    });
  }

  async function evaluateWithAgent(input: ContextPageObservation): Promise<ContextPageState> {
    const now = Date.now();
    const backend = options.resolveBackend();
    if (!backend) {
      return {
        pageType: "unknown",
        opportunities: [],
        updatedAt: now,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("Context interaction timed out.")), AGENT_TIMEOUT_MS);
    try {
      const assistant = await requestDefinedAgentTurn({
        agent: contextInteractionAgent,
        context: undefined,
        backend,
        messages: [
          {
            role: "user",
            content: buildAgentPrompt(input),
          },
        ],
        signal: controller.signal,
      });
      const parsed = parseJsonObject(assistant.content);
      if (!parsed) {
        return {
          pageType: "unknown",
          opportunities: [],
          updatedAt: now,
        };
      }
      const fallbackSurface = input.trigger === "selection_change"
        ? "selection_menu"
        : input.trigger === "focus_change"
          ? "field_popover"
          : "tiny_chip";
      const opportunities = filterVisibleOpportunities({
        observation: input,
        opportunities: normalizeAgentOpportunities({
          parsed,
          observation: input,
          fallbackSurface,
        }),
        now,
      });
      for (const opportunity of opportunities) {
        if (opportunity.surface !== "selection_menu") {
          lastShown.set(opportunity.cooldownKey, now);
        }
      }
      return {
        pageType: readString(parsed.pageType, 80) || "agent_inferred",
        opportunities,
        updatedAt: now,
      };
    } catch {
      return {
        pageType: "unknown",
        opportunities: [],
        updatedAt: now,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function getPageState(input: ContextPageObservation): Promise<ContextPageState> {
    const now = Date.now();
    prune(now);
    const observation = {
      ...input,
      updatedAt: input.updatedAt ?? now,
    };
    if (isInteractionBlacklisted(observation)) {
      const state: ContextPageState = {
        pageType: "blacklisted",
        opportunities: [],
        updatedAt: now,
      };
      states.set(stateKey(observation), state);
      return state;
    }

    const signature = buildObservationSignature(observation);
    const cached = cache.get(signature);
    if (cached && now - cached.ts <= AGENT_RESULT_CACHE_MS) {
      return cached.state;
    }
    const existing = inFlight.get(signature);
    if (existing) {
      return existing;
    }

    const promise = evaluateWithAgent(observation)
      .then((state) => {
        states.set(stateKey(observation), state);
        cache.set(signature, { state, ts: Date.now() });
        return state;
      })
      .finally(() => {
        inFlight.delete(signature);
      });
    inFlight.set(signature, promise);
    return promise;
  }

  function dismissOpportunity(input: {
    opportunityId?: string;
    kind?: ContextOpportunityKind;
    url?: string;
  }) {
    const now = Date.now();
    if (input.opportunityId) {
      dismissed.set(input.opportunityId, now);
    }
    if (input.kind && input.url) {
      dismissed.set(`${safeHostname(input.url)}:${input.kind}`, now);
    }
    return { success: true };
  }

  return {
    getPageState,
    dismissOpportunity,
    clear() {
      states.clear();
      dismissed.clear();
      lastShown.clear();
      cache.clear();
      inFlight.clear();
    },
  };
}
