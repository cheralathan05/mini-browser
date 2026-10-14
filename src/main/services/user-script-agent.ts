import type {
  OpenAICompatibleBackendConfig,
  OpenAICompatibleRequestHeaders,
} from "../agent/openai-compatible-backend.js";
import {
  defineAgent,
  requestDefinedAgentTurn,
} from "../agent/define-agent.js";

export type UserScriptAgentMode = "script" | "test" | "script-and-test";

export interface UserScriptAgentExistingScript {
  name?: string;
  description?: string;
  matches?: string[];
  excludes?: string[];
  code?: string;
  testCode?: string;
}

export interface UserScriptAgentGenerateInput {
  mode: UserScriptAgentMode;
  instruction: string;
  targetUrl?: string;
  pageTitle?: string;
  existingScript?: UserScriptAgentExistingScript;
}

export interface UserScriptAgentGenerateResult {
  name: string;
  description?: string;
  matches: string[];
  excludes: string[];
  code: string;
  testCode: string;
  notes?: string;
}

interface GenerateUserScriptAgentDraftInput {
  backend: OpenAICompatibleBackendConfig;
  input: UserScriptAgentGenerateInput;
  requestHeaders?: OpenAICompatibleRequestHeaders;
  signal?: AbortSignal;
}

const userScriptAuthorAgent = defineAgent<undefined>({
  id: "user-script-author",
  systemPrompt: [
    "You are Milo's user-script authoring agent.",
    "Write browser userscripts that run directly in a web page after page load.",
    "The runtime supports normal page JavaScript, DOM APIs, async/await, fetch, MutationObserver, localStorage, CSS injection, and a global MiloUserScript helper.",
    "MiloUserScript.defineWebComponent(tagName, options) defines a custom element with Shadow DOM and Tailwind-style default utilities unless options.tailwind=false.",
    "MiloUserScript.mount(target, component), MiloUserScript.replace(target, component), and MiloUserScript.replacePage(component) can mount a WebComponent, replace one page component, or replace the whole page.",
    "When the task changes visual layout, page structure, feed/card/list rendering, navigation, sidebars, panels, modals, or replaces an existing UI region, you must implement the new UI as a WebComponent and style it with Tailwind utility classes.",
    "Use direct DOM mutation only for small non-visual tweaks such as clicking, filling, extracting text, adding attributes, or hiding/removing a single element.",
    "For UI, prefer Tailwind utility classes in markup. Use options.styles only for custom CSS that Tailwind utilities do not cover.",
    "Do not use browser extension APIs, Node.js APIs, Electron APIs, imports, require, chrome.*, browser.*, GM_* APIs, or external packages.",
    "Never write or scope user scripts for Milo internal pages such as milo://home, milo://settings, milo://agent, milo://user-scripts, or any other milo:// URL.",
    "Prefer robust selectors, idempotent DOM changes, and small helper functions.",
    "Avoid network requests, credential collection, form submission, destructive actions, or exfiltration unless the user explicitly asks and the behavior is necessary.",
    "Tests run after the script has been executed in the page. Test code can use assert(condition, message) and await waitFor(predicate, { timeoutMs, intervalMs, message }).",
    "Return strict JSON only. Do not wrap it in markdown.",
  ],
});
const MILO_INTERNAL_SCHEME = "milo";

function truncateText(value: string | undefined, maxLength: number) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
    : normalized;
}

function normalizeMode(value: unknown): UserScriptAgentMode {
  return value === "script" || value === "test" || value === "script-and-test"
    ? value
    : "script-and-test";
}

function normalizeStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const entries = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.length > 0 ? entries : fallback;
}

function isMiloUrlPattern(value: string) {
  return value.trim().toLowerCase().startsWith(`${MILO_INTERNAL_SCHEME}:`);
}

function normalizeUserScriptPatterns(value: unknown, fallback: string[], defaultFallback: string[]) {
  const entries = normalizeStringArray(value, fallback)
    .filter((entry) => !isMiloUrlPattern(entry));
  if (entries.length > 0) {
    return entries;
  }

  const fallbackEntries = fallback.filter((entry) => !isMiloUrlPattern(entry));
  if (fallbackEntries.length > 0) {
    return fallbackEntries;
  }

  return defaultFallback;
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isMiloInternalUrl(value: string | undefined) {
  if (!value) {
    return false;
  }

  try {
    return new URL(value).protocol === `${MILO_INTERNAL_SCHEME}:`;
  } catch {
    return false;
  }
}

function assertAllowedUserScriptTargetUrl(value: string | undefined) {
  if (!isMiloInternalUrl(value)) {
    return;
  }

  throw new Error("User scripts cannot be generated for Milo internal pages.");
}

function inferTargetUrlMatchPattern(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }

    return `${parsed.protocol}//${parsed.host}${parsed.pathname || "/"}*`;
  } catch {
    return undefined;
  }
}

function extractJsonObject(content: string) {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("Agent returned an empty response.");
  }

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
    if (fenced) {
      return JSON.parse(fenced) as Record<string, unknown>;
    }

    const startIndex = trimmed.indexOf("{");
    const endIndex = trimmed.lastIndexOf("}");
    if (startIndex >= 0 && endIndex > startIndex) {
      return JSON.parse(trimmed.slice(startIndex, endIndex + 1)) as Record<string, unknown>;
    }

    throw new Error("Agent response was not valid JSON.");
  }
}

function buildPrompt(input: UserScriptAgentGenerateInput) {
  const existingScript = input.existingScript;
  const mode = normalizeMode(input.mode);
  const lines = [
    `Mode: ${mode}`,
    ...(input.targetUrl ? [`Target URL: ${truncateText(input.targetUrl, 1000)}`] : []),
    ...(input.pageTitle ? [`Page title: ${truncateText(input.pageTitle, 500)}`] : []),
    "User request:",
    truncateText(input.instruction, 4000),
    "",
    "Return a JSON object with exactly these keys:",
    "{",
    '  "name": "short script name",',
    '  "description": "one sentence summary",',
    '  "matches": ["https://example.com/*"],',
    '  "excludes": [],',
    '  "code": "JavaScript userscript code",',
    '  "testCode": "JavaScript test code using assert() and waitFor()",',
    '  "notes": "brief implementation/testing notes"',
    "}",
    "",
    "Rules:",
    "- User scripts are only for normal web pages. Do not generate scripts for Milo internal pages, including milo://home, milo://settings, milo://agent, milo://user-scripts, or any other milo:// URL.",
    "- Do not include milo:// patterns in matches or excludes.",
    "- Use <all_urls> only when the user explicitly wants broad scope.",
    "- If a target URL is provided, infer the narrowest safe match pattern for that origin/path.",
    "- For page-specific helpers, floating controls, operation panels, automation buttons, or DOM actions based on the current page structure, scope matches to the target page path by default, for example https://example.com/current/path*. Use an origin-wide pattern only when the user explicitly asks for all pages on the site.",
    "- Keep the generated code focused and concise; do not include explanations inside code comments unless they are necessary.",
    "- Layout/UI trigger: if the request says redesign, restyle, make it look like another app, convert to feed/card/grid/dashboard/sidebar/modal, replace a component, or replace the whole page, implement a WebComponent with MiloUserScript.defineWebComponent(...) and Tailwind utility classes.",
    "- Use MiloUserScript.replace(selector, tagName) when replacing one existing component/container. Use MiloUserScript.replacePage(tagName) when rebuilding the whole page. Use MiloUserScript.mount(target, tagName) only when adding a new overlay/widget without replacing existing layout.",
    "- WebComponent tag names must contain a dash, for example milo-feed-card or milo-page-shell.",
    "- WebComponents use Shadow DOM and Tailwind-style default styles automatically. Do not inject Tailwind from a CDN and do not paste a Tailwind compiler/runtime.",
    "- WebComponent skeleton: const tagName = MiloUserScript.defineWebComponent(\"milo-example\", { render: ({ html }) => html`<div class=\"rounded-2xl bg-slate-950/95 p-4 text-white shadow-2xl\">...</div>` }); MiloUserScript.replace(\"main\", tagName);",
    "- If replacing a page region that may load later, use await MiloUserScript.waitForElement(selector) before MiloUserScript.replace(...).",
    "- If the new component needs source page data, read it from the existing DOM before replacing the target and pass it as props to mount/replace/replacePage.",
    "- If mode is script, return code and set testCode to an empty string. Do not write tests in this pass.",
    "- If mode is test, return testCode and set code to an empty string. Do not repeat the existing script code in the output.",
    "- Test code must not include a top-level function wrapper; it will be inserted into an async function.",
    "- Test code should use assert(...) for each check and await waitFor(...) for async DOM updates.",
  ];

  if (existingScript) {
    lines.push(
      "",
      "Existing script:",
      JSON.stringify({
        name: truncateText(existingScript.name, 200),
        description: truncateText(existingScript.description, 500),
        matches: existingScript.matches ?? [],
        excludes: existingScript.excludes ?? [],
        code: truncateText(existingScript.code, 6000),
        testCode: truncateText(existingScript.testCode, 3000),
      }, null, 2),
    );
  }

  return lines.join("\n");
}

async function requestUserScriptAgentDraft(
  input: GenerateUserScriptAgentDraftInput,
  mode: UserScriptAgentMode,
) {
  const instruction = input.input.instruction.trim();
  const assistant = await requestDefinedAgentTurn({
    agent: userScriptAuthorAgent,
    context: undefined,
    backend: input.backend,
    messages: [
      {
        role: "user",
        content: buildPrompt({
          ...input.input,
          mode,
          instruction,
        }),
      },
    ],
    requestHeaders: input.requestHeaders,
    signal: input.signal,
  });

  const payload = extractJsonObject(assistant.content);
  const existing = input.input.existingScript;
  const inferredTargetMatch = inferTargetUrlMatchPattern(input.input.targetUrl);
  const defaultTargetMatches = existing?.matches?.length
    ? existing.matches
    : inferredTargetMatch
      ? [inferredTargetMatch]
      : ["<all_urls>"];
  return {
    name: normalizeString(payload.name) || existing?.name || "Untitled Script",
    description: normalizeString(payload.description) || existing?.description,
    matches: normalizeUserScriptPatterns(
      payload.matches,
      defaultTargetMatches,
      ["<all_urls>"],
    ),
    excludes: normalizeUserScriptPatterns(payload.excludes, existing?.excludes ?? [], []),
    code: mode === "test"
      ? existing?.code ?? ""
      : normalizeString(payload.code) || existing?.code || "",
    testCode: mode === "script"
      ? existing?.testCode ?? ""
      : normalizeString(payload.testCode) || existing?.testCode || "",
    notes: normalizeString(payload.notes) || undefined,
  } satisfies UserScriptAgentGenerateResult;
}

function mergeDraftNotes(...notes: Array<string | undefined>) {
  return notes
    .map((entry) => entry?.trim())
    .filter((entry): entry is string => Boolean(entry))
    .join("\n\n") || undefined;
}

export async function generateUserScriptAgentDraft(input: GenerateUserScriptAgentDraftInput) {
  const normalizedMode = normalizeMode(input.input.mode);
  const instruction = input.input.instruction.trim();
  if (!instruction) {
    throw new Error("Please describe what the user script should do.");
  }
  assertAllowedUserScriptTargetUrl(input.input.targetUrl);

  if (normalizedMode !== "script-and-test") {
    return requestUserScriptAgentDraft(input, normalizedMode);
  }

  const scriptDraft = await requestUserScriptAgentDraft(
    {
      ...input,
      input: {
        ...input.input,
        mode: "script",
        instruction,
      },
    },
    "script",
  );
  const testDraft = await requestUserScriptAgentDraft(
    {
      ...input,
      input: {
        ...input.input,
        mode: "test",
        instruction,
        existingScript: {
          name: scriptDraft.name,
          description: scriptDraft.description,
          matches: scriptDraft.matches,
          excludes: scriptDraft.excludes,
          code: scriptDraft.code,
          testCode: input.input.existingScript?.testCode,
        },
      },
    },
    "test",
  );

  return {
    ...scriptDraft,
    testCode: testDraft.testCode,
    notes: mergeDraftNotes(scriptDraft.notes, testDraft.notes),
  } satisfies UserScriptAgentGenerateResult;
}
