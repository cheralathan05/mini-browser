import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { WebContents } from "electron";

export type UserScriptRunAt = "document-idle";

export interface UserScriptRecord {
  id: string;
  profileId: string;
  name: string;
  description?: string;
  enabled: boolean;
  matches: string[];
  excludes: string[];
  runAt: UserScriptRunAt;
  code: string;
  testCode?: string;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastMatchedUrl?: string;
  lastError?: string;
}

export interface UserScriptCreateInput {
  name?: string;
  description?: string;
  enabled?: boolean;
  matches?: string[];
  excludes?: string[];
  runAt?: UserScriptRunAt;
  code?: string;
  testCode?: string;
}

export interface UserScriptUpdateInput {
  name?: string;
  description?: string | null;
  enabled?: boolean;
  matches?: string[];
  excludes?: string[];
  runAt?: UserScriptRunAt;
  code?: string;
  testCode?: string | null;
}

export interface UserScriptRunResult {
  scriptId: string;
  name: string;
  url: string;
  success: boolean;
  ranAt: number;
  error?: string;
}

export interface UserScriptTestAssertion {
  ok: boolean;
  message: string;
}

export interface UserScriptTestResult {
  scriptId: string;
  name: string;
  url: string;
  success: boolean;
  ranAt: number;
  assertions: UserScriptTestAssertion[];
  error?: string;
}

interface UserScriptStoragePayload {
  version: number;
  scripts: UserScriptRecord[];
}

interface UserScriptManagerOptions {
  storagePath: string;
  onChanged?: (profileId: string) => void;
}

interface UserScriptRuntimeContext {
  scriptId?: string;
  scriptName?: string;
  url?: string;
}

const USER_SCRIPT_STORAGE_VERSION = 1;
const DEFAULT_MATCHES = ["<all_urls>"];
const SUPPORTED_RUN_AT: UserScriptRunAt = "document-idle";

function truncateString(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function normalizeName(value: unknown, fallback = "Untitled Script") {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = truncateString(value.trim(), 120);
  return normalized || fallback;
}

function normalizeDescription(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = truncateString(value.trim(), 1000);
  return normalized || undefined;
}

function normalizeCode(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeRunAt(value: unknown): UserScriptRunAt {
  return value === SUPPORTED_RUN_AT ? SUPPORTED_RUN_AT : SUPPORTED_RUN_AT;
}

function normalizePatterns(input: unknown, fallback: string[] = []) {
  if (!Array.isArray(input)) {
    return [...fallback];
  }

  const patterns: string[] = [];
  const seen = new Set<string>();
  for (const entry of input) {
    if (typeof entry !== "string") {
      continue;
    }

    const normalized = entry.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    patterns.push(normalized);
  }

  return patterns.length > 0 ? patterns : [...fallback];
}

function numberOrNow(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Date.now();
}

function numberOrUndefined(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sanitizeScriptRecord(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const record = input as Partial<UserScriptRecord>;
  const id = typeof record.id === "string" && record.id.trim()
    ? record.id.trim()
    : randomUUID();
  const profileId = typeof record.profileId === "string" && record.profileId.trim()
    ? record.profileId.trim()
    : "";

  if (!profileId) {
    return null;
  }

  const createdAt = numberOrNow(record.createdAt);
  const updatedAt = numberOrNow(record.updatedAt);

  return {
    id,
    profileId,
    name: normalizeName(record.name, id),
    description: normalizeDescription(record.description),
    enabled: Boolean(record.enabled),
    matches: normalizePatterns(record.matches, DEFAULT_MATCHES),
    excludes: normalizePatterns(record.excludes),
    runAt: normalizeRunAt(record.runAt),
    code: normalizeCode(record.code),
    testCode: optionalString(record.testCode),
    createdAt,
    updatedAt,
    lastRunAt: numberOrUndefined(record.lastRunAt),
    lastMatchedUrl: optionalString(record.lastMatchedUrl),
    lastError: optionalString(record.lastError),
  } satisfies UserScriptRecord;
}

function escapeRegex(value: string) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegex(pattern: string) {
  const source = pattern
    .split("*")
    .map(escapeRegex)
    .join(".*");
  return new RegExp(`^${source}$`);
}

function parseWebUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

function isInjectablePageUrl(url: string) {
  return Boolean(parseWebUrl(url));
}

function matchesHostPattern(hostname: string, hostPattern: string) {
  const normalizedHostname = hostname.toLowerCase();
  const normalizedPattern = hostPattern.trim().toLowerCase();

  if (!normalizedPattern || normalizedPattern === "*") {
    return true;
  }

  if (normalizedPattern.startsWith("*.")) {
    const suffix = normalizedPattern.slice(2);
    return normalizedHostname === suffix || normalizedHostname.endsWith(`.${suffix}`);
  }

  if (normalizedPattern.includes("*")) {
    return globToRegex(normalizedPattern).test(normalizedHostname);
  }

  return normalizedHostname === normalizedPattern;
}

function matchesUrlPattern(url: string, pattern: string) {
  const parsedUrl = parseWebUrl(url);
  if (!parsedUrl) {
    return false;
  }

  const trimmed = pattern.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed === "<all_urls>" || trimmed === "*") {
    return true;
  }

  const chromePattern = trimmed.match(/^(\*|http|https):\/\/([^/]*)(\/.*)?$/i);
  if (chromePattern) {
    const schemePattern = chromePattern[1].toLowerCase();
    const hostPattern = chromePattern[2];
    const pathPattern = chromePattern[3] ?? "/*";
    const targetScheme = parsedUrl.protocol.slice(0, -1);

    if (schemePattern !== "*" && schemePattern !== targetScheme) {
      return false;
    }

    if (!matchesHostPattern(parsedUrl.hostname, hostPattern)) {
      return false;
    }

    const targetPath = `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
    return globToRegex(pathPattern).test(targetPath);
  }

  return globToRegex(trimmed).test(url);
}

function matchesScriptUrl(script: UserScriptRecord, url: string) {
  if (!script.enabled || !isInjectablePageUrl(url)) {
    return false;
  }

  const hasMatch = script.matches.some((pattern) => matchesUrlPattern(url, pattern));
  if (!hasMatch) {
    return false;
  }

  return !script.excludes.some((pattern) => matchesUrlPattern(url, pattern));
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error || "Unknown error");
}

const DEFAULT_USER_SCRIPT_TAILWIND_CSS = String.raw`
:host {
  --milo-font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --milo-font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-family: var(--milo-font-sans);
  color: #0f172a;
}
*, ::before, ::after { box-sizing: border-box; border: 0 solid #e5e7eb; }
button, input, textarea, select { font: inherit; }
button { cursor: pointer; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border-width: 0; }
.pointer-events-none { pointer-events: none; } .pointer-events-auto { pointer-events: auto; }
.visible { visibility: visible; } .invisible { visibility: hidden; }
.fixed { position: fixed; } .absolute { position: absolute; } .relative { position: relative; } .sticky { position: sticky; }
.inset-0 { inset: 0; } .inset-x-0 { left: 0; right: 0; } .inset-y-0 { top: 0; bottom: 0; }
.top-0 { top: 0; } .right-0 { right: 0; } .bottom-0 { bottom: 0; } .left-0 { left: 0; }
.top-2 { top: .5rem; } .right-2 { right: .5rem; } .bottom-2 { bottom: .5rem; } .left-2 { left: .5rem; }
.top-4 { top: 1rem; } .right-4 { right: 1rem; } .bottom-4 { bottom: 1rem; } .left-4 { left: 1rem; }
.top-6 { top: 1.5rem; } .right-6 { right: 1.5rem; } .bottom-6 { bottom: 1.5rem; } .left-6 { left: 1.5rem; }
.z-0 { z-index: 0; } .z-10 { z-index: 10; } .z-20 { z-index: 20; } .z-30 { z-index: 30; } .z-40 { z-index: 40; } .z-50 { z-index: 50; } .z-\[2147483647\] { z-index: 2147483647; }
.block { display: block; } .inline-block { display: inline-block; } .inline { display: inline; } .flex { display: flex; } .inline-flex { display: inline-flex; } .grid { display: grid; } .hidden { display: none; }
.contents { display: contents; } .flow-root { display: flow-root; }
.h-0 { height: 0; } .h-1 { height: .25rem; } .h-2 { height: .5rem; } .h-3 { height: .75rem; } .h-4 { height: 1rem; } .h-5 { height: 1.25rem; } .h-6 { height: 1.5rem; } .h-8 { height: 2rem; } .h-10 { height: 2.5rem; } .h-12 { height: 3rem; } .h-16 { height: 4rem; } .h-full { height: 100%; } .h-screen { height: 100vh; } .min-h-screen { min-height: 100vh; }
.w-0 { width: 0; } .w-1 { width: .25rem; } .w-2 { width: .5rem; } .w-3 { width: .75rem; } .w-4 { width: 1rem; } .w-5 { width: 1.25rem; } .w-6 { width: 1.5rem; } .w-8 { width: 2rem; } .w-10 { width: 2.5rem; } .w-12 { width: 3rem; } .w-16 { width: 4rem; } .w-full { width: 100%; } .w-screen { width: 100vw; } .max-w-xs { max-width: 20rem; } .max-w-sm { max-width: 24rem; } .max-w-md { max-width: 28rem; } .max-w-lg { max-width: 32rem; } .max-w-xl { max-width: 36rem; } .max-w-2xl { max-width: 42rem; } .max-w-4xl { max-width: 56rem; } .max-w-none { max-width: none; }
.flex-1 { flex: 1 1 0%; } .shrink-0 { flex-shrink: 0; } .grow { flex-grow: 1; }
.grid-cols-1 { grid-template-columns: repeat(1, minmax(0, 1fr)); } .grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); } .grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.flex-row { flex-direction: row; } .flex-col { flex-direction: column; } .flex-wrap { flex-wrap: wrap; }
.items-start { align-items: flex-start; } .items-center { align-items: center; } .items-end { align-items: flex-end; } .items-stretch { align-items: stretch; }
.justify-start { justify-content: flex-start; } .justify-center { justify-content: center; } .justify-end { justify-content: flex-end; } .justify-between { justify-content: space-between; }
.gap-0 { gap: 0; } .gap-1 { gap: .25rem; } .gap-2 { gap: .5rem; } .gap-3 { gap: .75rem; } .gap-4 { gap: 1rem; } .gap-5 { gap: 1.25rem; } .gap-6 { gap: 1.5rem; } .gap-8 { gap: 2rem; }
.overflow-hidden { overflow: hidden; } .overflow-auto { overflow: auto; } .overflow-y-auto { overflow-y: auto; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .whitespace-nowrap { white-space: nowrap; } .break-words { overflow-wrap: break-word; }
.m-0 { margin: 0; } .mx-auto { margin-left: auto; margin-right: auto; }
.mt-1 { margin-top: .25rem; } .mt-2 { margin-top: .5rem; } .mt-3 { margin-top: .75rem; } .mt-4 { margin-top: 1rem; } .mt-6 { margin-top: 1.5rem; } .mt-8 { margin-top: 2rem; }
.mb-1 { margin-bottom: .25rem; } .mb-2 { margin-bottom: .5rem; } .mb-3 { margin-bottom: .75rem; } .mb-4 { margin-bottom: 1rem; } .mb-6 { margin-bottom: 1.5rem; } .mb-8 { margin-bottom: 2rem; }
.p-0 { padding: 0; } .p-1 { padding: .25rem; } .p-2 { padding: .5rem; } .p-3 { padding: .75rem; } .p-4 { padding: 1rem; } .p-5 { padding: 1.25rem; } .p-6 { padding: 1.5rem; } .p-8 { padding: 2rem; } .p-10 { padding: 2.5rem; } .p-12 { padding: 3rem; }
.px-2 { padding-left: .5rem; padding-right: .5rem; } .px-3 { padding-left: .75rem; padding-right: .75rem; } .px-4 { padding-left: 1rem; padding-right: 1rem; } .px-5 { padding-left: 1.25rem; padding-right: 1.25rem; } .px-6 { padding-left: 1.5rem; padding-right: 1.5rem; } .px-8 { padding-left: 2rem; padding-right: 2rem; }
.py-1 { padding-top: .25rem; padding-bottom: .25rem; } .py-1\.5 { padding-top: .375rem; padding-bottom: .375rem; } .py-2 { padding-top: .5rem; padding-bottom: .5rem; } .py-3 { padding-top: .75rem; padding-bottom: .75rem; } .py-4 { padding-top: 1rem; padding-bottom: 1rem; } .py-6 { padding-top: 1.5rem; padding-bottom: 1.5rem; } .py-8 { padding-top: 2rem; padding-bottom: 2rem; }
.rounded-none { border-radius: 0; } .rounded-sm { border-radius: .125rem; } .rounded { border-radius: .25rem; } .rounded-md { border-radius: .375rem; } .rounded-lg { border-radius: .5rem; } .rounded-xl { border-radius: .75rem; } .rounded-2xl { border-radius: 1rem; } .rounded-3xl { border-radius: 1.5rem; } .rounded-full { border-radius: 9999px; }
.border { border-width: 1px; } .border-0 { border-width: 0; } .border-2 { border-width: 2px; } .border-t { border-top-width: 1px; } .border-b { border-bottom-width: 1px; }
.border-white { border-color: #fff; } .border-black { border-color: #000; } .border-transparent { border-color: transparent; } .border-slate-200 { border-color: #e2e8f0; } .border-slate-700 { border-color: #334155; } .border-zinc-200 { border-color: #e4e4e7; } .border-zinc-700 { border-color: #3f3f46; } .border-blue-500 { border-color: #3b82f6; } .border-emerald-500 { border-color: #10b981; } .border-rose-500 { border-color: #f43f5e; }
.bg-transparent { background-color: transparent; } .bg-white { background-color: #fff; } .bg-black { background-color: #000; } .bg-white\/60 { background-color: rgb(255 255 255 / .6); } .bg-white\/80 { background-color: rgb(255 255 255 / .8); } .bg-white\/90 { background-color: rgb(255 255 255 / .9); } .bg-black\/50 { background-color: rgb(0 0 0 / .5); } .bg-black\/70 { background-color: rgb(0 0 0 / .7); } .bg-black\/90 { background-color: rgb(0 0 0 / .9); }
.bg-slate-50 { background-color: #f8fafc; } .bg-slate-100 { background-color: #f1f5f9; } .bg-slate-900 { background-color: #0f172a; } .bg-slate-950 { background-color: #020617; } .bg-slate-950\/90 { background-color: rgb(2 6 23 / .9); } .bg-slate-950\/95 { background-color: rgb(2 6 23 / .95); }
.bg-zinc-50 { background-color: #fafafa; } .bg-zinc-100 { background-color: #f4f4f5; } .bg-zinc-900 { background-color: #18181b; } .bg-zinc-950 { background-color: #09090b; } .bg-zinc-950\/95 { background-color: rgb(9 9 11 / .95); }
.bg-red-500 { background-color: #ef4444; } .bg-orange-500 { background-color: #f97316; } .bg-amber-400 { background-color: #fbbf24; } .bg-yellow-400 { background-color: #facc15; } .bg-green-500 { background-color: #22c55e; } .bg-emerald-500 { background-color: #10b981; } .bg-teal-500 { background-color: #14b8a6; } .bg-cyan-500 { background-color: #06b6d4; } .bg-sky-500 { background-color: #0ea5e9; } .bg-blue-500 { background-color: #3b82f6; } .bg-indigo-500 { background-color: #6366f1; } .bg-violet-500 { background-color: #8b5cf6; } .bg-purple-500 { background-color: #a855f7; } .bg-pink-500 { background-color: #ec4899; } .bg-rose-500 { background-color: #f43f5e; }
.bg-blue-50 { background-color: #eff6ff; } .bg-blue-100 { background-color: #dbeafe; } .bg-blue-600 { background-color: #2563eb; } .bg-blue-700 { background-color: #1d4ed8; } .bg-emerald-50 { background-color: #ecfdf5; } .bg-emerald-100 { background-color: #d1fae5; } .bg-emerald-600 { background-color: #059669; } .bg-rose-50 { background-color: #fff1f2; } .bg-rose-100 { background-color: #ffe4e6; } .bg-rose-600 { background-color: #e11d48; }
.bg-gradient-to-br { background-image: linear-gradient(to bottom right, var(--tw-gradient-stops)); } .from-slate-950 { --tw-gradient-from: #020617; --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to, rgb(2 6 23 / 0)); } .from-blue-600 { --tw-gradient-from: #2563eb; --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to, rgb(37 99 235 / 0)); } .via-indigo-600 { --tw-gradient-stops: var(--tw-gradient-from), #4f46e5, var(--tw-gradient-to, rgb(79 70 229 / 0)); } .to-slate-900 { --tw-gradient-to: #0f172a; } .to-cyan-500 { --tw-gradient-to: #06b6d4; }
.text-left { text-align: left; } .text-center { text-align: center; } .text-right { text-align: right; }
.text-xs { font-size: .75rem; line-height: 1rem; } .text-sm { font-size: .875rem; line-height: 1.25rem; } .text-base { font-size: 1rem; line-height: 1.5rem; } .text-lg { font-size: 1.125rem; line-height: 1.75rem; } .text-xl { font-size: 1.25rem; line-height: 1.75rem; } .text-2xl { font-size: 1.5rem; line-height: 2rem; } .text-3xl { font-size: 1.875rem; line-height: 2.25rem; } .text-4xl { font-size: 2.25rem; line-height: 2.5rem; }
.font-normal { font-weight: 400; } .font-medium { font-weight: 500; } .font-semibold { font-weight: 600; } .font-bold { font-weight: 700; } .font-extrabold { font-weight: 800; } .font-mono { font-family: var(--milo-font-mono); }
.leading-none { line-height: 1; } .leading-tight { line-height: 1.25; } .leading-snug { line-height: 1.375; } .leading-relaxed { line-height: 1.625; } .tracking-tight { letter-spacing: -.025em; } .tracking-wide { letter-spacing: .025em; }
.text-white { color: #fff; } .text-black { color: #000; } .text-slate-50 { color: #f8fafc; } .text-slate-100 { color: #f1f5f9; } .text-slate-300 { color: #cbd5e1; } .text-slate-500 { color: #64748b; } .text-slate-600 { color: #475569; } .text-slate-700 { color: #334155; } .text-slate-900 { color: #0f172a; } .text-zinc-400 { color: #a1a1aa; } .text-zinc-500 { color: #71717a; } .text-zinc-700 { color: #3f3f46; } .text-zinc-900 { color: #18181b; }
.text-red-500 { color: #ef4444; } .text-amber-300 { color: #fcd34d; } .text-amber-500 { color: #f59e0b; } .text-yellow-500 { color: #eab308; } .text-green-500 { color: #22c55e; } .text-emerald-300 { color: #6ee7b7; } .text-emerald-500 { color: #10b981; } .text-cyan-300 { color: #67e8f9; } .text-cyan-500 { color: #06b6d4; } .text-sky-500 { color: #0ea5e9; } .text-blue-500 { color: #3b82f6; } .text-blue-600 { color: #2563eb; } .text-indigo-500 { color: #6366f1; } .text-violet-500 { color: #8b5cf6; } .text-purple-500 { color: #a855f7; } .text-pink-500 { color: #ec4899; } .text-rose-500 { color: #f43f5e; }
.opacity-0 { opacity: 0; } .opacity-50 { opacity: .5; } .opacity-60 { opacity: .6; } .opacity-70 { opacity: .7; } .opacity-80 { opacity: .8; } .opacity-90 { opacity: .9; } .opacity-100 { opacity: 1; }
.shadow-sm { box-shadow: 0 1px 2px 0 rgb(0 0 0 / .05); } .shadow { box-shadow: 0 1px 3px 0 rgb(0 0 0 / .1), 0 1px 2px -1px rgb(0 0 0 / .1); } .shadow-lg { box-shadow: 0 10px 15px -3px rgb(0 0 0 / .1), 0 4px 6px -4px rgb(0 0 0 / .1); } .shadow-xl { box-shadow: 0 20px 25px -5px rgb(0 0 0 / .1), 0 8px 10px -6px rgb(0 0 0 / .1); } .shadow-2xl { box-shadow: 0 25px 50px -12px rgb(0 0 0 / .25); }
.ring-1 { box-shadow: 0 0 0 1px var(--tw-ring-color, rgb(59 130 246 / .5)); } .ring-2 { box-shadow: 0 0 0 2px var(--tw-ring-color, rgb(59 130 246 / .5)); } .ring-white\/10 { --tw-ring-color: rgb(255 255 255 / .1); } .ring-black\/10 { --tw-ring-color: rgb(0 0 0 / .1); } .ring-blue-500\/30 { --tw-ring-color: rgb(59 130 246 / .3); }
.backdrop-blur { backdrop-filter: blur(8px); } .backdrop-blur-md { backdrop-filter: blur(12px); } .backdrop-blur-xl { backdrop-filter: blur(24px); }
.transition { transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter; transition-timing-function: cubic-bezier(.4,0,.2,1); transition-duration: 150ms; }
.duration-150 { transition-duration: 150ms; } .duration-200 { transition-duration: 200ms; } .duration-300 { transition-duration: 300ms; }
.ease-out { transition-timing-function: cubic-bezier(0, 0, .2, 1); } .hover\:bg-blue-700:hover { background-color: #1d4ed8; } .hover\:bg-slate-100:hover { background-color: #f1f5f9; } .hover\:bg-white\/10:hover { background-color: rgb(255 255 255 / .1); } .hover\:opacity-90:hover { opacity: .9; } .hover\:shadow-xl:hover { box-shadow: 0 20px 25px -5px rgb(0 0 0 / .1), 0 8px 10px -6px rgb(0 0 0 / .1); }
.scale-95 { transform: scale(.95); } .scale-100 { transform: scale(1); } .translate-y-0 { transform: translateY(0); } .-translate-y-1 { transform: translateY(-.25rem); }
@media (min-width: 640px) { .sm\:grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); } .sm\:flex-row { flex-direction: row; } }
@media (min-width: 768px) { .md\:grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); } .md\:grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); } .md\:p-8 { padding: 2rem; } .md\:text-4xl { font-size: 2.25rem; line-height: 2.5rem; } }
`;

function buildUserScriptRuntimeSource(context: UserScriptRuntimeContext = {}) {
  const runtimeContext = {
    scriptId: context.scriptId ?? "",
    scriptName: context.scriptName ?? "",
    url: context.url ?? "",
  };

  return `
(() => {
  const globalTarget = window;
  const componentRegistry = globalTarget.__MiloUserScriptComponentRegistry instanceof Map
    ? globalTarget.__MiloUserScriptComponentRegistry
    : new Map();
  globalTarget.__MiloUserScriptComponentRegistry = componentRegistry;
  const managedElements = globalTarget.__MiloUserScriptManagedElements instanceof Set
    ? globalTarget.__MiloUserScriptManagedElements
    : new Set();
  globalTarget.__MiloUserScriptManagedElements = managedElements;

  const defaultTailwindCss = ${JSON.stringify(DEFAULT_USER_SCRIPT_TAILWIND_CSS)};
  const currentRun = ${JSON.stringify(runtimeContext)};

  const toArray = (value) => Array.isArray(value) ? value : [value];
  const isNode = (value) => value && typeof value === "object" && typeof value.nodeType === "number";
  const isElement = (value) => isNode(value) && value.nodeType === 1;
  const resolveTarget = (target) => {
    if (typeof target === "string") {
      return document.querySelector(target);
    }
    return target || null;
  };
  const html = (strings, ...values) => {
    if (!Array.isArray(strings) || !("raw" in strings)) {
      return String(strings ?? "");
    }
    return strings.reduce((output, part, index) => output + part + (index < values.length ? String(values[index] ?? "") : ""), "");
  };
  const injectCss = (root, cssText, marker = "custom") => {
    const targetRoot = root && typeof root.appendChild === "function"
      ? root
      : document.head || document.documentElement;
    const style = document.createElement("style");
    style.setAttribute("data-milo-userscript-style", marker);
    style.textContent = String(cssText || "");
    targetRoot.prepend(style);
    return style;
  };
  const injectTailwind = (root, extraCss = "") => {
    return injectCss(root, defaultTailwindCss + "\\n" + String(extraCss || ""), "tailwind");
  };
  const normalizeOptions = (options) => {
    if (typeof options === "function") {
      return { render: options };
    }
    return options && typeof options === "object" ? options : {};
  };
  const renderContent = (root, content) => {
    for (const entry of toArray(content ?? [])) {
      if (entry == null || entry === false) {
        continue;
      }
      if (isNode(entry)) {
        root.appendChild(entry);
      } else {
        const template = document.createElement("template");
        template.innerHTML = String(entry);
        root.appendChild(template.content.cloneNode(true));
      }
    }
  };
  const markManagedElement = (element, kind) => {
    if (!isElement(element)) {
      return element;
    }
    element.setAttribute("data-milo-userscript-managed", "true");
    element.setAttribute("data-milo-userscript-kind", String(kind || "element"));
    if (currentRun.scriptId) {
      element.setAttribute("data-milo-userscript-id", currentRun.scriptId);
    }
    if (currentRun.url) {
      element.setAttribute("data-milo-userscript-url", currentRun.url);
    }
    managedElements.add(element);
    return element;
  };
  const cleanupManagedElements = (options = {}) => {
    const normalizedOptions = options && typeof options === "object" ? options : {};
    const keepScriptIds = new Set(
      Array.isArray(normalizedOptions.keepScriptIds)
        ? normalizedOptions.keepScriptIds.map((entry) => String(entry || "")).filter(Boolean)
        : [],
    );
    let removed = 0;
    const removeElement = (element) => {
      if (!isElement(element)) {
        return;
      }
      const scriptId = element.getAttribute("data-milo-userscript-id") || "";
      if (scriptId && keepScriptIds.has(scriptId)) {
        return;
      }
      if (typeof element.remove === "function" && element.isConnected) {
        element.remove();
        removed += 1;
      }
      managedElements.delete(element);
    };

    for (const element of Array.from(managedElements)) {
      if (!isElement(element) || !element.isConnected) {
        managedElements.delete(element);
        continue;
      }
      removeElement(element);
    }

    for (const element of Array.from(document.querySelectorAll("[data-milo-userscript-managed='true']"))) {
      if (!managedElements.has(element)) {
        removeElement(element);
      }
    }

    return { removed };
  };
  const defineWebComponent = (tagName, options) => {
    const normalizedTagName = String(tagName || "").trim().toLowerCase();
    if (!normalizedTagName || !normalizedTagName.includes("-")) {
      throw new Error("WebComponent tagName must include a dash, for example: milo-card");
    }
    componentRegistry.set(normalizedTagName, normalizeOptions(options));
    if (!customElements.get(normalizedTagName)) {
      customElements.define(normalizedTagName, class extends HTMLElement {
        connectedCallback() {
          const definition = componentRegistry.get(normalizedTagName) || {};
          const useShadow = definition.shadow !== false;
          const root = useShadow
            ? (this.shadowRoot || this.attachShadow({ mode: "open" }))
            : this;
          while (root.firstChild) {
            root.removeChild(root.firstChild);
          }
          if (definition.tailwind !== false) {
            injectTailwind(root, definition.tailwindCss || "");
          }
          if (definition.styles) {
            injectCss(root, definition.styles, "component");
          }
          const ctx = {
            api: globalTarget.MiloUserScript,
            host: this,
            html,
            props: this.__miloProps || {},
            root,
            tailwindCss: defaultTailwindCss,
          };
          const rendered = typeof definition.render === "function"
            ? definition.render(ctx)
            : definition.render ?? "";
          renderContent(root, rendered);
          if (typeof definition.connected === "function") {
            definition.connected(ctx);
          }
        }
        disconnectedCallback() {
          const definition = componentRegistry.get(normalizedTagName) || {};
          if (typeof definition.disconnected === "function") {
            definition.disconnected({ host: this, props: this.__miloProps || {} });
          }
        }
      });
    }
    return normalizedTagName;
  };
  const createElement = (component, props = {}) => {
    if (typeof component === "string") {
      const element = document.createElement(component);
      element.__miloProps = props || {};
      return element;
    }
    if (typeof component === "function") {
      const result = component(props || {});
      if (isNode(result)) {
        return result;
      }
      const wrapper = document.createElement("div");
      renderContent(wrapper, result);
      return wrapper;
    }
    if (isNode(component)) {
      return component;
    }
    throw new Error("Expected a WebComponent tag name, DOM Node, or renderer function.");
  };
  const mount = (target, component, props = {}) => {
    const parent = resolveTarget(target);
    if (!parent) {
      throw new Error("Mount target was not found.");
    }
    const element = createElement(component, props);
    markManagedElement(element, "mount");
    parent.appendChild(element);
    return element;
  };
  const replace = (target, component, props = {}) => {
    const targetElement = resolveTarget(target);
    if (!targetElement) {
      throw new Error("Replace target was not found.");
    }
    const element = createElement(component, props);
    markManagedElement(element, "replace");
    targetElement.replaceWith(element);
    return element;
  };
  const replacePage = (component, props = {}) => {
    const element = createElement(component, props);
    markManagedElement(element, "replace-page");
    if (!document.body) {
      document.documentElement.appendChild(document.createElement("body"));
    }
    document.body.replaceChildren(element);
    return element;
  };
  const waitForElement = async (selector, options = {}) => {
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(0, Number(options.timeoutMs)) : 5000;
    const intervalMs = Number.isFinite(options.intervalMs) ? Math.max(16, Number(options.intervalMs)) : 50;
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
      const element = document.querySelector(selector);
      if (element) {
        return element;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(String(options.message || "Timed out waiting for element: " + selector));
  };
  globalTarget.__MiloUserScriptCleanupPage = cleanupManagedElements;
  globalTarget.MiloUserScript = {
    version: "1.0.0",
    currentScript: { ...currentRun },
    tailwindCss: defaultTailwindCss,
    cleanupPage: cleanupManagedElements,
    css: injectCss,
    createElement,
    defineElement: defineWebComponent,
    defineWebComponent,
    html,
    injectTailwind,
    mount,
    replace,
    replacePage,
    waitForElement,
  };
})();
`;
}

function buildScriptSource(script: UserScriptRecord, url?: string) {
  const sourceId = script.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${buildUserScriptRuntimeSource({
    scriptId: script.id,
    scriptName: script.name,
    url: url ?? script.lastMatchedUrl,
  })}\n(async () => {\n${script.code}\n})()\n//# sourceURL=milo-userscript-${sourceId}.user.js`;
}

function buildTestSource(script: UserScriptRecord, url?: string) {
  const sourceId = script.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const testCode = script.testCode ?? "";
  return `${buildUserScriptRuntimeSource({
    scriptId: script.id,
    scriptName: script.name,
    url: url ?? script.lastMatchedUrl,
  })}\n(() => {
  const __miloAssertions = [];
  const assert = (condition, message = "Assertion failed") => {
    const ok = Boolean(condition);
    __miloAssertions.push({ ok, message: String(message) });
    if (!ok) {
      throw new Error(String(message));
    }
  };
  const waitFor = async (predicate, options = {}) => {
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(0, Number(options.timeoutMs)) : 3000;
    const intervalMs = Number.isFinite(options.intervalMs) ? Math.max(16, Number(options.intervalMs)) : 50;
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
      if (await predicate()) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(String(options.message || "Timed out waiting for condition"));
  };
  return (async () => {
    try {
${testCode}
      return { success: true, assertions: __miloAssertions };
    } catch (error) {
      return {
        success: false,
        assertions: __miloAssertions,
        error: error && typeof error.message === "string" ? error.message : String(error || "Unknown error"),
      };
    }
  })();
})()
//# sourceURL=milo-userscript-test-${sourceId}.user.js`;
}

function buildManagedUiCleanupSource() {
  return `(() => {
  const cleanup = window.__MiloUserScriptCleanupPage || window.MiloUserScript?.cleanupPage;
  if (typeof cleanup === "function") {
    return cleanup();
  }

  let removed = 0;
  for (const element of Array.from(document.querySelectorAll("[data-milo-userscript-managed='true']"))) {
    if (element && typeof element.remove === "function") {
      element.remove();
      removed += 1;
    }
  }
  return { removed };
})()
//# sourceURL=milo-userscript-cleanup.js`;
}

function normalizeTestExecutionPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      success: false,
      assertions: [] as UserScriptTestAssertion[],
      error: "Test returned an invalid result.",
    };
  }

  const payload = value as {
    success?: unknown;
    assertions?: unknown;
    error?: unknown;
  };
  return {
    success: Boolean(payload.success),
    assertions: Array.isArray(payload.assertions)
      ? payload.assertions.flatMap((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return [];
          }
          const assertion = entry as Partial<UserScriptTestAssertion>;
          return [{
            ok: Boolean(assertion.ok),
            message: typeof assertion.message === "string" ? assertion.message : "",
          }];
        })
      : [],
    error: optionalString(payload.error),
  };
}

export function createUserScriptManager(options: UserScriptManagerOptions) {
  const scriptsByProfileId = new Map<string, UserScriptRecord[]>();
  const automaticRunKeys = new Set<string>();

  function getProfileScripts(profileId: string) {
    const existingScripts = scriptsByProfileId.get(profileId);
    if (existingScripts) {
      return existingScripts;
    }

    const nextScripts: UserScriptRecord[] = [];
    scriptsByProfileId.set(profileId, nextScripts);
    return nextScripts;
  }

  function sortProfileScripts(profileId: string) {
    getProfileScripts(profileId).sort((left, right) => {
      const nameOrder = left.name.localeCompare(right.name);
      if (nameOrder !== 0) {
        return nameOrder;
      }
      return left.createdAt - right.createdAt;
    });
  }

  function saveState() {
    mkdirSync(path.dirname(options.storagePath), { recursive: true });
    const payload: UserScriptStoragePayload = {
      version: USER_SCRIPT_STORAGE_VERSION,
      scripts: Array.from(scriptsByProfileId.values())
        .flatMap((scripts) => scripts.map((script) => ({ ...script })))
        .sort((left, right) => {
          const profileOrder = left.profileId.localeCompare(right.profileId);
          if (profileOrder !== 0) {
            return profileOrder;
          }
          return left.name.localeCompare(right.name);
        }),
    };

    writeFileSync(options.storagePath, JSON.stringify(payload, null, 2), "utf-8");
  }

  function notifyChanged(profileId: string) {
    sortProfileScripts(profileId);
    options.onChanged?.(profileId);
  }

  function persistAndNotify(profileId: string) {
    saveState();
    notifyChanged(profileId);
  }

  function load() {
    mkdirSync(path.dirname(options.storagePath), { recursive: true });
    if (!existsSync(options.storagePath)) {
      return;
    }

    try {
      const raw = readFileSync(options.storagePath, "utf-8").trim();
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as Partial<UserScriptStoragePayload> | unknown;
      const payload = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Partial<UserScriptStoragePayload>
        : { scripts: [] };
      const seen = new Set<string>();
      scriptsByProfileId.clear();
      for (const candidate of Array.isArray(payload.scripts) ? payload.scripts : []) {
        const script = sanitizeScriptRecord(candidate);
        if (!script) {
          continue;
        }

        const dedupeKey = `${script.profileId}:${script.id}`;
        if (seen.has(dedupeKey)) {
          continue;
        }

        seen.add(dedupeKey);
        getProfileScripts(script.profileId).push(script);
      }

      for (const profileId of scriptsByProfileId.keys()) {
        sortProfileScripts(profileId);
      }
    } catch (error) {
      console.error("[UserScripts] Failed to load user script state.", error);
    }
  }

  function findScript(profileId: string, scriptId: string) {
    return getProfileScripts(profileId).find((script) => script.id === scriptId) ?? null;
  }

  function requireScript(profileId: string, scriptId: string) {
    const script = findScript(profileId, scriptId);
    if (!script) {
      throw new Error("User script not found.");
    }

    return script;
  }

  function list(profileId: string) {
    return getProfileScripts(profileId).map((script) => ({ ...script }));
  }

  function listMatching(profileId: string, url: string) {
    return getProfileScripts(profileId)
      .filter((script) => matchesScriptUrl(script, url))
      .map((script) => ({ ...script }));
  }

  function create(profileId: string, input: UserScriptCreateInput) {
    const now = Date.now();
    const script: UserScriptRecord = {
      id: randomUUID(),
      profileId,
      name: normalizeName(input.name),
      description: normalizeDescription(input.description),
      enabled: input.enabled !== false,
      matches: normalizePatterns(input.matches, DEFAULT_MATCHES),
      excludes: normalizePatterns(input.excludes),
      runAt: normalizeRunAt(input.runAt),
      code: normalizeCode(input.code),
      testCode: optionalString(input.testCode),
      createdAt: now,
      updatedAt: now,
    };

    getProfileScripts(profileId).push(script);
    persistAndNotify(profileId);
    return { ...script };
  }

  function update(profileId: string, scriptId: string, input: UserScriptUpdateInput) {
    const script = requireScript(profileId, scriptId);

    if ("name" in input) {
      script.name = normalizeName(input.name);
    }
    if ("description" in input) {
      script.description = normalizeDescription(input.description);
    }
    if ("enabled" in input) {
      script.enabled = Boolean(input.enabled);
    }
    if ("matches" in input) {
      script.matches = normalizePatterns(input.matches, DEFAULT_MATCHES);
    }
    if ("excludes" in input) {
      script.excludes = normalizePatterns(input.excludes);
    }
    if ("runAt" in input) {
      script.runAt = normalizeRunAt(input.runAt);
    }
    if ("code" in input) {
      script.code = normalizeCode(input.code);
    }
    if ("testCode" in input) {
      script.testCode = optionalString(input.testCode);
    }

    script.updatedAt = Date.now();
    script.lastError = undefined;
    persistAndNotify(profileId);
    return { ...script };
  }

  function remove(profileId: string, scriptId: string) {
    const scripts = getProfileScripts(profileId);
    const nextScripts = scripts.filter((script) => script.id !== scriptId);
    if (nextScripts.length === scripts.length) {
      throw new Error("User script not found.");
    }

    scriptsByProfileId.set(profileId, nextScripts);
    for (const key of Array.from(automaticRunKeys)) {
      if (key.includes(`:${scriptId}:`)) {
        automaticRunKeys.delete(key);
      }
    }
    persistAndNotify(profileId);
  }

  function setEnabled(profileId: string, scriptId: string, enabled: boolean) {
    return update(profileId, scriptId, { enabled });
  }

  async function executeScript(
    profileId: string,
    webContents: WebContents,
    script: UserScriptRecord,
    url: string,
  ): Promise<UserScriptRunResult> {
    const ranAt = Date.now();
    try {
      await webContents.executeJavaScript(buildScriptSource(script, url), true);
      script.lastRunAt = ranAt;
      script.lastMatchedUrl = url;
      script.lastError = undefined;
      saveState();
      notifyChanged(profileId);
      return {
        scriptId: script.id,
        name: script.name,
        url,
        success: true,
        ranAt,
      };
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      script.lastRunAt = ranAt;
      script.lastMatchedUrl = url;
      script.lastError = errorMessage;
      saveState();
      notifyChanged(profileId);
      return {
        scriptId: script.id,
        name: script.name,
        url,
        success: false,
        ranAt,
        error: errorMessage,
      };
    }
  }

  async function runNow(profileId: string, webContents: WebContents, scriptId: string) {
    if (webContents.isDestroyed()) {
      throw new Error("Target page is no longer available.");
    }

    const url = webContents.getURL();
    if (!isInjectablePageUrl(url)) {
      throw new Error("User scripts can only run on http/https pages.");
    }

    const script = requireScript(profileId, scriptId);
    return executeScript(profileId, webContents, script, url);
  }

  async function runTest(profileId: string, webContents: WebContents, scriptId: string) {
    if (webContents.isDestroyed()) {
      throw new Error("Target page is no longer available.");
    }

    const url = webContents.getURL();
    if (!isInjectablePageUrl(url)) {
      throw new Error("User script tests can only run on http/https pages.");
    }

    const script = requireScript(profileId, scriptId);
    if (!script.testCode?.trim()) {
      throw new Error("This user script does not have test code.");
    }

    const ranAt = Date.now();
    try {
      if (script.code.trim()) {
        await webContents.executeJavaScript(buildScriptSource(script, url), true);
      }

      const payload = normalizeTestExecutionPayload(
        await webContents.executeJavaScript(buildTestSource(script, url), true),
      );
      script.lastRunAt = ranAt;
      script.lastMatchedUrl = url;
      script.lastError = payload.success ? undefined : payload.error ?? "Test failed.";
      saveState();
      notifyChanged(profileId);
      return {
        scriptId: script.id,
        name: script.name,
        url,
        success: payload.success,
        ranAt,
        assertions: payload.assertions,
        ...(payload.error ? { error: payload.error } : {}),
      } satisfies UserScriptTestResult;
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      script.lastRunAt = ranAt;
      script.lastMatchedUrl = url;
      script.lastError = errorMessage;
      saveState();
      notifyChanged(profileId);
      return {
        scriptId: script.id,
        name: script.name,
        url,
        success: false,
        ranAt,
        assertions: [],
        error: errorMessage,
      } satisfies UserScriptTestResult;
    }
  }

  async function cleanupPageUi(webContents: WebContents) {
    if (webContents.isDestroyed()) {
      return { removed: 0 };
    }

    return webContents.executeJavaScript(
      buildManagedUiCleanupSource(),
      true,
    ) as Promise<{ removed: number }>;
  }

  async function injectMatching(profileId: string, webContents: WebContents, url: string) {
    if (webContents.isDestroyed() || !isInjectablePageUrl(url)) {
      return [] as UserScriptRunResult[];
    }

    const scripts = getProfileScripts(profileId).filter((script) => matchesScriptUrl(script, url));
    const results: UserScriptRunResult[] = [];

    for (const script of scripts) {
      const runKey = `${webContents.id}:${script.id}:${script.updatedAt}:${url}`;
      if (automaticRunKeys.has(runKey)) {
        continue;
      }

      automaticRunKeys.add(runKey);
      results.push(await executeScript(profileId, webContents, script, url));
    }

    return results;
  }

  function clearContents(contentsId: number) {
    const prefix = `${contentsId}:`;
    for (const key of Array.from(automaticRunKeys)) {
      if (key.startsWith(prefix)) {
        automaticRunKeys.delete(key);
      }
    }
  }

  return {
    clearContents,
    cleanupPageUi,
    create,
    injectMatching,
    list,
    listMatching,
    load,
    remove,
    runNow,
    runTest,
    setEnabled,
    update,
  };
}
