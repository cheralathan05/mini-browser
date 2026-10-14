import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronRight,
  FlaskConical,
  Globe,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  Save,
  ToggleLeft,
  ToggleRight,
  Trash2,
  X,
} from "lucide-react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js";
import "monaco-editor/esm/vs/language/typescript/monaco.contribution.js";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { usePageLocale } from "@/lib/use-page-locale";
import type { SupportedLocale } from "@/lib/i18n";
import type {
  UserScriptCreateInput,
  UserScriptAgentMode,
  UserScriptRecord,
  UserScriptUpdateInput,
} from "@/types/user-scripts";
import type { BrowserBootstrapData } from "@/types/workspace";

type StatusTone = "ok" | "err";
type MonacoTheme = "vs" | "vs-dark";
type DialogMode = "view" | "edit" | null;

interface ScriptFormState {
  name: string;
  description: string;
  enabled: boolean;
  matchesText: string;
  excludesText: string;
  code: string;
  testCode: string;
}

const SETTINGS_STORAGE_KEY = "milo.settings.v1";
const DEFAULT_MATCH_PATTERN = "https://example.com/*";
const DEFAULT_CODE = `const tagName = MiloUserScript.defineWebComponent("milo-floating-card", {
  render: ({ html }) => html\`
    <div class="fixed bottom-6 right-6 z-[2147483647] max-w-sm rounded-2xl bg-slate-950/95 p-4 text-white shadow-2xl">
      <div class="text-sm font-semibold">Milo User Script</div>
      <p class="mt-2 text-xs leading-relaxed text-slate-300">
        This WebComponent uses Shadow DOM and Tailwind-style utility classes by default.
      </p>
      <button class="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
        Action
      </button>
    </div>
  \`,
});

MiloUserScript.mount(document.body, tagName);
`;
const DEFAULT_TEST_CODE = `assert(document.documentElement, "Page document is available");
`;

let isMonacoConfigured = false;

interface MonacoTypeScriptLanguage {
  javascriptDefaults?: {
    addExtraLib: (content: string, filePath?: string) => void;
    setCompilerOptions: (options: Record<string, unknown>) => void;
    setDiagnosticsOptions: (options: Record<string, unknown>) => void;
  };
}

function configureMonaco() {
  const monacoGlobal = globalThis as typeof globalThis & {
    MonacoEnvironment?: monaco.Environment;
  };

  monacoGlobal.MonacoEnvironment = {
    getWorker: (_workerId: string, label: string) => {
      if (label === "javascript" || label === "typescript") {
        return new TsWorker();
      }

      return new EditorWorker();
    },
  };

  if (isMonacoConfigured) {
    return;
  }

  isMonacoConfigured = true;
  const typescriptLanguage = (monaco.languages as typeof monaco.languages & {
    typescript?: MonacoTypeScriptLanguage;
  }).typescript;
  const javascriptDefaults = typescriptLanguage?.javascriptDefaults;
  if (!javascriptDefaults) {
    return;
  }

  javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });
  javascriptDefaults.setCompilerOptions({
    allowNonTsExtensions: true,
    checkJs: true,
    lib: ["es2022", "dom"],
  });
  javascriptDefaults.addExtraLib(
    `declare function assert(condition: unknown, message?: string): void;
interface MiloWebComponentContext<Props = Record<string, unknown>> {
  api: typeof MiloUserScript;
  host: HTMLElement;
  html: (strings: TemplateStringsArray, ...values: unknown[]) => string;
  props: Props;
  root: ShadowRoot | HTMLElement;
  tailwindCss: string;
}
interface MiloDefineWebComponentOptions<Props = Record<string, unknown>> {
  connected?: (context: MiloWebComponentContext<Props>) => void;
  disconnected?: (context: { host: HTMLElement; props: Props }) => void;
  render?: string | ((context: MiloWebComponentContext<Props>) => string | Node | Array<string | Node>);
  shadow?: boolean;
  styles?: string;
  tailwind?: boolean;
  tailwindCss?: string;
}
declare const MiloUserScript: {
  version: string;
  tailwindCss: string;
  css(root: Document | ShadowRoot | HTMLElement, cssText: string, marker?: string): HTMLStyleElement;
  createElement(component: string | Node | ((props?: Record<string, unknown>) => string | Node), props?: Record<string, unknown>): Node;
  defineElement<Props = Record<string, unknown>>(tagName: string, options: MiloDefineWebComponentOptions<Props> | ((context: MiloWebComponentContext<Props>) => string | Node | Array<string | Node>)): string;
  defineWebComponent<Props = Record<string, unknown>>(tagName: string, options: MiloDefineWebComponentOptions<Props> | ((context: MiloWebComponentContext<Props>) => string | Node | Array<string | Node>)): string;
  html(strings: TemplateStringsArray, ...values: unknown[]): string;
  injectTailwind(root: Document | ShadowRoot | HTMLElement, extraCss?: string): HTMLStyleElement;
  mount(target: string | Element, component: string | Node | ((props?: Record<string, unknown>) => string | Node), props?: Record<string, unknown>): Node;
  replace(target: string | Element, component: string | Node | ((props?: Record<string, unknown>) => string | Node), props?: Record<string, unknown>): Node;
  replacePage(component: string | Node | ((props?: Record<string, unknown>) => string | Node), props?: Record<string, unknown>): Node;
  waitForElement(selector: string, options?: { timeoutMs?: number; intervalMs?: number; message?: string }): Promise<Element>;
};
`,
    "file:///milo-user-script-test-globals.d.ts",
  );
}

const I18N = {
  "en-US": {
    pageTitle: "User Scripts",
    heroTitle: "User Scripts",
    heroBody:
      "Write small scripts for specific pages. Matching scripts run after page load and can also be run manually.",
    shellMissing: "browserShell API is unavailable on this page. Please restart the app.",
    loading: "Loading user scripts...",
    loadFailed: "Failed to load user scripts.",
    newScript: "New Script",
    save: "Save",
    runNow: "Run Now",
    runTest: "Run Test",
    remove: "Delete",
    enable: "Enable",
    disable: "Disable",
    enabled: "Enabled",
    disabled: "Disabled",
    noScriptsTitle: "No scripts yet",
    noScriptsBody: "Create one and set URL match patterns such as https://example.com/*.",
    name: "Name",
    description: "Description",
    matches: "Matches",
    excludes: "Excludes",
    code: "Code",
    testCode: "Test Code",
    optional: "optional",
    onePerLine: "one per line",
    saveFailed: "Failed to save the script.",
    saved: "Script saved.",
    runSucceeded: "Script ran on {url}.",
    runFailed: "Script failed: {error}",
    testSucceeded: "Test passed on {url}. Assertions: {count}.",
    testFailed: "Test failed: {error}",
    removeConfirm: "Delete user script \"{name}\"?",
    removeFailed: "Failed to delete the script.",
    removed: "Script deleted.",
    toggleFailed: "Failed to update script state.",
    updated: "Script state updated.",
    profile: "Profile",
    lastRun: "Last run",
    lastMatch: "Last matched URL",
    lastError: "Last error",
    never: "Never",
    namePlaceholder: "e.g. Auto expand comments",
    descriptionPlaceholder: "What this script does",
    matchesPlaceholder: "https://example.com/*\n*://*.example.com/*\n<all_urls>",
    excludesPlaceholder: "https://example.com/admin/*",
    runHint:
      "Run Now targets the nearest http/https tab in the current window and skips this manager page.",
    emptyCode: "Code is empty.",
    agentTitle: "Script Agent",
    agentBody:
      "Describe the page behavior you want. The agent can write the script, write DOM assertions, or update both.",
    agentInstruction: "Agent instruction",
    targetUrl: "Target URL",
    targetUrlPlaceholder: "https://example.com/page",
    agentInstructionPlaceholder:
      "Example: On product pages, add a floating button that extracts price and title into a JSON block.",
    generateScript: "Write Script",
    generateTest: "Write Test",
    generateBoth: "Write Both",
    agentFailed: "Agent generation failed.",
    agentApplied: "Agent draft applied. Review before saving.",
    agentNotes: "Agent notes",
    groupGlobal: "Global Scripts",
    groupOther: "Other",
    editScript: "Edit",
    close: "Close",
    viewDetails: "View Details",
    scriptCount: "{count} scripts",
    domainScripts: "Scripts for {domain}",
    runtime: "Runtime Info",
  },
  "zh-CN": {
    pageTitle: "用户脚本",
    heroTitle: "用户脚本",
    heroBody:
      "为特定页面编写小脚本。命中匹配规则后会在页面加载完成后自动执行，也可以手动运行。",
    shellMissing: "当前页面缺少 browserShell API，请重启应用后重试。",
    loading: "正在加载用户脚本...",
    loadFailed: "加载用户脚本失败。",
    newScript: "新建脚本",
    save: "保存",
    runNow: "立即运行",
    runTest: "运行测试",
    remove: "删除",
    enable: "启用",
    disable: "停用",
    enabled: "已启用",
    disabled: "已停用",
    noScriptsTitle: "还没有脚本",
    noScriptsBody: "创建一个脚本，并设置类似 https://example.com/* 的 URL 匹配规则。",
    name: "名称",
    description: "描述",
    matches: "匹配页面",
    excludes: "排除页面",
    code: "代码",
    testCode: "测试代码",
    optional: "可选",
    onePerLine: "每行一条",
    saveFailed: "保存脚本失败。",
    saved: "脚本已保存。",
    runSucceeded: "脚本已在 {url} 执行。",
    runFailed: "脚本执行失败：{error}",
    testSucceeded: "测试已在 {url} 通过。断言数：{count}。",
    testFailed: "测试失败：{error}",
    removeConfirm: "确定删除用户脚本\u201c{name}\u201d吗？",
    removeFailed: "删除脚本失败。",
    removed: "脚本已删除。",
    toggleFailed: "更新脚本状态失败。",
    updated: "脚本状态已更新。",
    profile: "Profile",
    lastRun: "上次运行",
    lastMatch: "上次命中 URL",
    lastError: "上次错误",
    never: "从未",
    namePlaceholder: "例如：自动展开评论",
    descriptionPlaceholder: "这个脚本做什么",
    matchesPlaceholder: "https://example.com/*\n*://*.example.com/*\n<all_urls>",
    excludesPlaceholder: "https://example.com/admin/*",
    runHint:
      "立即运行会在当前窗口最近的 http/https 网页 tab 执行，并跳过这个管理页。",
    emptyCode: "代码为空。",
    agentTitle: "脚本 Agent",
    agentBody:
      "描述你希望页面具备的行为。Agent 可以编写脚本、编写 DOM 断言测试，或同时更新两者。",
    agentInstruction: "Agent 指令",
    targetUrl: "目标 URL",
    targetUrlPlaceholder: "https://example.com/page",
    agentInstructionPlaceholder:
      "例如：在商品页添加一个浮动按钮，把价格和标题提取成 JSON 展示。",
    generateScript: "编写脚本",
    generateTest: "编写测试",
    generateBoth: "脚本+测试",
    agentFailed: "Agent 生成失败。",
    agentApplied: "Agent 草稿已填入，请检查后保存。",
    agentNotes: "Agent 说明",
    groupGlobal: "全局脚本",
    groupOther: "其他",
    editScript: "编辑",
    close: "关闭",
    viewDetails: "查看详情",
    scriptCount: "{count} 个脚本",
    domainScripts: "{domain} 的脚本",
    runtime: "运行时信息",
  },
} as const;

function readStoredSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function applyTheme(themeSetting: unknown) {
  const normalizedTheme = String(themeSetting ?? "system").trim().toLowerCase();
  const theme: "dark" | "light" =
    normalizedTheme === "dark" || normalizedTheme === "light"
      ? normalizedTheme
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  document.documentElement.setAttribute("data-theme", theme);
  return theme;
}

function resolveMonacoTheme(theme: "dark" | "light"): MonacoTheme {
  return theme === "light" ? "vs" : "vs-dark";
}

function formatMessage(
  locale: SupportedLocale,
  key: keyof (typeof I18N)["en-US"],
  vars?: Record<string, string | number>,
) {
  const template = I18N[locale][key] ?? key;
  if (!vars) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_match, name) => String(vars[name] ?? ""));
}

function formatDate(locale: SupportedLocale, value?: number) {
  if (!value) {
    return "";
  }

  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString();
  }
}

function buildNewForm(): ScriptFormState {
  return {
    name: "",
    description: "",
    enabled: true,
    matchesText: DEFAULT_MATCH_PATTERN,
    excludesText: "",
    code: DEFAULT_CODE,
    testCode: DEFAULT_TEST_CODE,
  };
}

function scriptToForm(script: UserScriptRecord): ScriptFormState {
  return {
    name: script.name,
    description: script.description ?? "",
    enabled: script.enabled,
    matchesText: script.matches.join("\n"),
    excludesText: script.excludes.join("\n"),
    code: script.code,
    testCode: script.testCode ?? "",
  };
}

function splitPatterns(value: string, fallback: string[] = []) {
  const patterns = value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return patterns.length > 0 ? patterns : fallback;
}

function buildScriptInput(form: ScriptFormState): UserScriptCreateInput & UserScriptUpdateInput {
  return {
    name: form.name.trim() || "Untitled Script",
    description: form.description.trim() || undefined,
    enabled: form.enabled,
    matches: splitPatterns(form.matchesText, ["<all_urls>"]),
    excludes: splitPatterns(form.excludesText),
    runAt: "document-idle",
    code: form.code,
    testCode: form.testCode,
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

function extractDomain(pattern: string): string {
  if (pattern === "<all_urls>") return "__global__";
  const m = pattern.match(/(?:https?:\/\/)?(\*\.)?([^/*]+)/);
  return m ? m[2] : "__other__";
}

function groupScriptsByDomain(scripts: UserScriptRecord[]): [string, UserScriptRecord[]][] {
  const groups = new Map<string, UserScriptRecord[]>();
  for (const script of scripts) {
    const domain = extractDomain(script.matches[0] ?? "<all_urls>");
    const list = groups.get(domain) ?? [];
    list.push(script);
    groups.set(domain, list);
  }
  return [...groups.entries()];
}

function domainDisplayName(domain: string, t: (key: keyof (typeof I18N)["en-US"]) => string) {
  if (domain === "__global__") return t("groupGlobal");
  if (domain === "__other__") return t("groupOther");
  return domain;
}

interface MonacoScriptEditorProps {
  ariaLabel: string;
  minHeight: number;
  onChange: (value: string) => void;
  theme: MonacoTheme;
  value: string;
}

function MonacoScriptEditor({
  ariaLabel,
  minHeight,
  onChange,
  theme,
  value,
}: MonacoScriptEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    configureMonaco();
    const editor = monaco.editor.create(container, {
      ariaLabel,
      automaticLayout: true,
      fontFamily: "\"SFMono-Regular\", ui-monospace, Menlo, Consolas, monospace",
      fontSize: 13,
      language: "javascript",
      lineHeight: 20,
      minimap: { enabled: false },
      padding: { bottom: 12, top: 12 },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      tabSize: 2,
      theme,
      value,
      wordWrap: "on",
    });
    const disposable = editor.onDidChangeModelContent(() => {
      onChangeRef.current(editor.getValue());
    });

    editorRef.current = editor;
    return () => {
      disposable.dispose();
      editor.dispose();
      editorRef.current = null;
    };
  }, [ariaLabel]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.getValue() === value) {
      return;
    }

    editor.setValue(value);
  }, [value]);

  useEffect(() => {
    monaco.editor.setTheme(theme);
  }, [theme]);

  return (
    <div
      className="user-script-monaco-shell"
      ref={containerRef}
      style={{ minHeight }}
    />
  );
}

export function UserScriptsPage() {
  const locale = usePageLocale();
  const [bootstrap, setBootstrap] = useState<BrowserBootstrapData | null>(null);
  const [scripts, setScripts] = useState<UserScriptRecord[]>([]);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [dialogScriptId, setDialogScriptId] = useState<string | null>(null);
  const [domainListDomain, setDomainListDomain] = useState<string | null>(null);
  const [form, setForm] = useState<ScriptFormState>(() => buildNewForm());
  const [editorTheme, setEditorTheme] = useState<MonacoTheme>(() =>
    resolveMonacoTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [agentBusyMode, setAgentBusyMode] = useState<UserScriptAgentMode | null>(null);
  const [agentInstruction, setAgentInstruction] = useState("");
  const [agentTargetUrl, setAgentTargetUrl] = useState("");
  const [agentNotes, setAgentNotes] = useState("");
  const [busyScriptIds, setBusyScriptIds] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<StatusTone | null>(null);

  const t = useCallback(
    (
      key: keyof (typeof I18N)["en-US"],
      vars?: Record<string, string | number>,
    ) => formatMessage(locale, key, vars),
    [locale],
  );

  const dialogScript = useMemo(
    () => scripts.find((s) => s.id === dialogScriptId) ?? null,
    [scripts, dialogScriptId],
  );
  const currentProfileId = bootstrap?.currentWorkspace.profileId ?? "";

  const setStatus = useCallback((message: string, tone: StatusTone | null) => {
    setStatusMessage(message);
    setStatusTone(tone);
  }, []);

  const refreshScripts = useCallback(async (showLoading = false) => {
    const browserShell = window.browserShell;
    if (!browserShell) {
      setStatus(t("shellMissing"), "err");
      setLoading(false);
      return;
    }

    if (showLoading) {
      setLoading(true);
    }

    try {
      const [nextBootstrap, nextScripts] = await Promise.all([
        browserShell.getBootstrapData(),
        browserShell.userScriptsList(),
      ]);
      setBootstrap(nextBootstrap);
      setScripts(nextScripts);
      setStatus("", null);
    } catch (error) {
      setStatus(`${t("loadFailed")} ${getErrorMessage(error)}`, "err");
    } finally {
      setLoading(false);
    }
  }, [setStatus, t]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t("pageTitle");
  }, [locale, t]);

  useEffect(() => {
    const applyAndStoreTheme = (themeSetting: unknown) => {
      setEditorTheme(resolveMonacoTheme(applyTheme(themeSetting)));
    };

    applyAndStoreTheme(readStoredSettings().theme);

    const browserShell = window.browserShell;
    if (!browserShell) {
      return;
    }

    void browserShell.settingsGetTheme().then(applyAndStoreTheme).catch(() => undefined);
    return browserShell.onThemeChanged((theme) => {
      applyAndStoreTheme(theme);
    });
  }, []);

  useEffect(() => {
    void refreshScripts(true);
  }, [refreshScripts]);

  useEffect(() => {
    const browserShell = window.browserShell;
    if (!browserShell) {
      return;
    }

    const disposeWorkspace = browserShell.onWorkspaceContext((payload) => {
      setBootstrap((current) => current ? {
        ...current,
        currentWorkspace: payload.currentWorkspace,
        currentWindow: payload.currentWindow,
        windows: payload.windows,
        workspaces: payload.workspaces,
      } : current);
    });
    const disposeScripts = browserShell.onUserScriptsChanged((payload) => {
      if (!currentProfileId || payload.profileId === currentProfileId) {
        void refreshScripts(false);
      }
    });

    return () => {
      disposeWorkspace?.();
      disposeScripts?.();
    };
  }, [currentProfileId, refreshScripts]);

  const markBusy = useCallback((scriptId: string, busy: boolean) => {
    setBusyScriptIds((current) => {
      if (busy) {
        return current.includes(scriptId) ? current : [...current, scriptId];
      }
      return current.filter((id) => id !== scriptId);
    });
  }, []);

  const openViewDialog = useCallback((script: UserScriptRecord) => {
    setDialogScriptId(script.id);
    setDialogMode("view");
    setStatus("", null);
  }, [setStatus]);

  const openEditDialog = useCallback((script: UserScriptRecord) => {
    setDialogScriptId(script.id);
    setForm(scriptToForm(script));
    setDialogMode("edit");
    setStatus("", null);
  }, [setStatus]);

  const openNewDialog = useCallback(() => {
    setDialogScriptId(null);
    setForm(buildNewForm());
    setDialogMode("edit");
    setStatus("", null);
  }, [setStatus]);

  const closeDialog = useCallback(() => {
    setDialogMode(null);
    setDialogScriptId(null);
    setStatus("", null);
  }, [setStatus]);

  const openDomainList = useCallback((domain: string) => {
    setDomainListDomain(domain);
    setStatus("", null);
  }, [setStatus]);

  const closeDomainList = useCallback(() => {
    setDomainListDomain(null);
    setStatus("", null);
  }, [setStatus]);

  useEffect(() => {
    if (!dialogMode && !domainListDomain) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (dialogMode) closeDialog();
        else closeDomainList();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [dialogMode, domainListDomain, closeDialog, closeDomainList]);

  const saveScript = useCallback(async () => {
    const browserShell = window.browserShell;
    if (!browserShell) {
      setStatus(t("shellMissing"), "err");
      return;
    }
    if (!form.code.trim()) {
      setStatus(t("emptyCode"), "err");
      return;
    }

    setSaving(true);
    try {
      const input = buildScriptInput(form);
      const savedScript = dialogScriptId
        ? await browserShell.userScriptsUpdate(dialogScriptId, input)
        : await browserShell.userScriptsCreate(input);
      setDialogScriptId(savedScript.id);
      setForm(scriptToForm(savedScript));
      await refreshScripts(false);
      setStatus(t("saved"), "ok");
    } catch (error) {
      setStatus(`${t("saveFailed")} ${getErrorMessage(error)}`, "err");
    } finally {
      setSaving(false);
    }
  }, [form, refreshScripts, dialogScriptId, setStatus, t]);

  const toggleScript = useCallback(async (script: UserScriptRecord) => {
    const browserShell = window.browserShell;
    if (!browserShell) {
      setStatus(t("shellMissing"), "err");
      return;
    }

    markBusy(script.id, true);
    try {
      const updated = await browserShell.userScriptsSetEnabled(script.id, !script.enabled);
      if (dialogScriptId === script.id) {
        setForm(scriptToForm(updated));
      }
      await refreshScripts(false);
      setStatus(t("updated"), "ok");
    } catch (error) {
      setStatus(`${t("toggleFailed")} ${getErrorMessage(error)}`, "err");
    } finally {
      markBusy(script.id, false);
    }
  }, [markBusy, refreshScripts, dialogScriptId, setStatus, t]);

  const runScript = useCallback(async (script: UserScriptRecord) => {
    const browserShell = window.browserShell;
    if (!browserShell) {
      setStatus(t("shellMissing"), "err");
      return;
    }

    markBusy(script.id, true);
    try {
      const result = await browserShell.userScriptsRunNow(script.id);
      await refreshScripts(false);
      setStatus(
        result.success
          ? t("runSucceeded", { url: result.url })
          : t("runFailed", { error: result.error ?? "Unknown error" }),
        result.success ? "ok" : "err",
      );
    } catch (error) {
      setStatus(t("runFailed", { error: getErrorMessage(error) }), "err");
    } finally {
      markBusy(script.id, false);
    }
  }, [markBusy, refreshScripts, setStatus, t]);

  const runScriptTest = useCallback(async (script: UserScriptRecord) => {
    const browserShell = window.browserShell;
    if (!browserShell) {
      setStatus(t("shellMissing"), "err");
      return;
    }

    markBusy(script.id, true);
    try {
      const result = await browserShell.userScriptsRunTest(script.id);
      await refreshScripts(false);
      setStatus(
        result.success
          ? t("testSucceeded", { url: result.url, count: result.assertions.length })
          : t("testFailed", { error: result.error ?? "Unknown error" }),
        result.success ? "ok" : "err",
      );
    } catch (error) {
      setStatus(t("testFailed", { error: getErrorMessage(error) }), "err");
    } finally {
      markBusy(script.id, false);
    }
  }, [markBusy, refreshScripts, setStatus, t]);

  const generateWithAgent = useCallback(async (mode: UserScriptAgentMode) => {
    const browserShell = window.browserShell;
    if (!browserShell) {
      setStatus(t("shellMissing"), "err");
      return;
    }

    setAgentBusyMode(mode);
    setAgentNotes("");
    try {
      const result = await browserShell.userScriptsAgentGenerate({
        mode,
        instruction: agentInstruction,
        targetUrl: agentTargetUrl.trim() || undefined,
        existingScript: {
          name: form.name,
          description: form.description,
          matches: splitPatterns(form.matchesText, ["<all_urls>"]),
          excludes: splitPatterns(form.excludesText),
          code: form.code,
          testCode: form.testCode,
        },
      });

      setForm((current) => ({
        ...current,
        name: mode === "test" ? current.name : result.name,
        description: mode === "test" ? current.description : result.description ?? "",
        matchesText: mode === "test" ? current.matchesText : result.matches.join("\n"),
        excludesText: mode === "test" ? current.excludesText : result.excludes.join("\n"),
        code: mode === "test" ? current.code : result.code,
        testCode: result.testCode || current.testCode,
      }));
      setAgentNotes(result.notes ?? "");
      setStatus(t("agentApplied"), "ok");
    } catch (error) {
      setStatus(`${t("agentFailed")} ${getErrorMessage(error)}`, "err");
    } finally {
      setAgentBusyMode(null);
    }
  }, [agentInstruction, agentTargetUrl, form, setStatus, t]);

  const removeScript = useCallback(async (script: UserScriptRecord) => {
    const browserShell = window.browserShell;
    if (!browserShell) {
      setStatus(t("shellMissing"), "err");
      return;
    }
    if (!window.confirm(t("removeConfirm", { name: script.name }))) {
      return;
    }

    markBusy(script.id, true);
    try {
      await browserShell.userScriptsRemove(script.id);
      closeDialog();
      await refreshScripts(false);
      setStatus(t("removed"), "ok");
    } catch (error) {
      setStatus(`${t("removeFailed")} ${getErrorMessage(error)}`, "err");
    } finally {
      markBusy(script.id, false);
    }
  }, [markBusy, refreshScripts, closeDialog, setStatus, t]);

  const updateForm = useCallback(<Key extends keyof ScriptFormState>(
    key: Key,
    value: ScriptFormState[Key],
  ) => {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const grouped = useMemo(() => groupScriptsByDomain(scripts), [scripts]);

  return (
    <div className="page user-scripts-page">
      <header className="hero user-scripts-hero">
        <div>
          <h1>{t("heroTitle")}</h1>
          <p>
            {t("heroBody")}
            {currentProfileId ? ` ${t("profile")}: ${currentProfileId}` : ""}
          </p>
        </div>
        <div className="hero-actions">
          <button className="user-script-action primary" onClick={openNewDialog} type="button">
            <Plus size={16} />
            {t("newScript")}
          </button>
        </div>
      </header>

      <div className={`status ${statusTone ?? ""}`}>{statusMessage}</div>

      <main className="user-scripts-main">
        {loading ? (
          <div className="user-scripts-empty">
            <LoaderCircle size={20} className="animate-spin" />
            <p>{t("loading")}</p>
          </div>
        ) : scripts.length === 0 ? (
          <div className="user-scripts-empty">
            <h2>{t("noScriptsTitle")}</h2>
            <p>{t("noScriptsBody")}</p>
          </div>
        ) : (
          <div className="us-domain-list">
            {grouped.map(([domain, domainScripts]) => (
              <button
                className="us-domain-item"
                key={domain}
                onClick={() => openDomainList(domain)}
                type="button"
              >
                <div className="us-domain-icon">
                  <Globe size={18} />
                </div>
                <div className="us-domain-info">
                  <span className="us-domain-name">{domainDisplayName(domain, t)}</span>
                  <span className="us-domain-count">{t("scriptCount", { count: domainScripts.length })}</span>
                </div>
                <ChevronRight size={16} className="us-domain-chevron" />
              </button>
            ))}
          </div>
        )}
      </main>

      {/* Domain scripts list dialog */}
      {domainListDomain && !dialogMode ? (
        <div className="us-dialog-backdrop" onClick={(e) => {
          if (e.target === e.currentTarget) closeDomainList();
        }}>
          <div className="us-dialog us-domain-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="us-dialog-header">
              <div className="us-dialog-header-info">
                <h2 className="us-dialog-title">
                  {t("domainScripts", { domain: domainDisplayName(domainListDomain, t) })}
                </h2>
              </div>
              <div className="us-dialog-header-actions">
                <button
                  className="us-dialog-btn ghost"
                  onClick={closeDomainList}
                  type="button"
                  aria-label={t("close")}
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="us-dialog-body">
              <div className="us-domain-script-list">
                {(grouped.find(([d]) => d === domainListDomain)?.[1] ?? []).map((script) => {
                  const isBusy = busyScriptIds.includes(script.id);
                  return (
                    <article className="us-domain-script-item" key={script.id}>
                      <button
                        className="us-domain-script-main"
                        onClick={() => { closeDomainList(); openViewDialog(script); }}
                        type="button"
                      >
                        <div className="us-script-name-row">
                          <h4 className="us-card-name">{script.name}</h4>
                          <span className={`us-badge ${script.enabled ? "enabled" : "disabled"}`}>
                            {script.enabled ? t("enabled") : t("disabled")}
                          </span>
                        </div>
                        {script.description ? (
                          <p className="us-card-desc">{script.description}</p>
                        ) : null}
                      </button>
                      <div className="us-domain-script-actions">
                        <button
                          aria-label={script.enabled ? t("disable") : t("enable")}
                          className="us-card-btn"
                          disabled={isBusy}
                          onClick={() => void toggleScript(script)}
                          type="button"
                        >
                          {script.enabled ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
                        </button>
                        <button
                          aria-label={t("editScript")}
                          className="us-card-btn"
                          onClick={() => { closeDomainList(); openEditDialog(script); }}
                          type="button"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          aria-label={t("remove")}
                          className="us-card-btn danger"
                          disabled={isBusy}
                          onClick={() => void removeScript(script)}
                          type="button"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {dialogMode ? (
        <div className="us-dialog-backdrop" onClick={(e) => {
          if (e.target === e.currentTarget) closeDialog();
        }}>
          <div className="us-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="us-dialog-header">
              <div className="us-dialog-header-info">
                <h2 className="us-dialog-title">
                  {dialogScript ? dialogScript.name : t("newScript")}
                </h2>
                {dialogScript ? (
                  <span className={`us-badge ${dialogScript.enabled ? "enabled" : "disabled"}`}>
                    {dialogScript.enabled ? t("enabled") : t("disabled")}
                  </span>
                ) : null}
              </div>
              <div className="us-dialog-header-actions">
                {dialogMode === "view" && dialogScript ? (
                  <>
                    <button
                      className="us-dialog-btn"
                      disabled={busyScriptIds.includes(dialogScript.id)}
                      onClick={() => void toggleScript(dialogScript)}
                      type="button"
                    >
                      {dialogScript.enabled ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
                      {dialogScript.enabled ? t("disable") : t("enable")}
                    </button>
                    <button
                      className="us-dialog-btn"
                      disabled={busyScriptIds.includes(dialogScript.id)}
                      onClick={() => void runScript(dialogScript)}
                      type="button"
                    >
                      <Play size={14} />
                      {t("runNow")}
                    </button>
                    <button
                      className="us-dialog-btn primary"
                      onClick={() => openEditDialog(dialogScript)}
                      type="button"
                    >
                      <Pencil size={14} />
                      {t("editScript")}
                    </button>
                    <button
                      className="us-dialog-btn danger"
                      disabled={busyScriptIds.includes(dialogScript.id)}
                      onClick={() => void removeScript(dialogScript)}
                      type="button"
                    >
                      <Trash2 size={14} />
                      {t("remove")}
                    </button>
                  </>
                ) : null}
                <button
                  aria-label={t("close")}
                  className="us-dialog-btn ghost"
                  onClick={closeDialog}
                  type="button"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className={`us-dialog-status ${statusTone ?? ""}`}>{statusMessage}</div>

            <div className="us-dialog-body">
              {dialogMode === "view" && dialogScript ? (
                <div className="us-view">
                  {dialogScript.description ? (
                    <p className="us-view-desc">{dialogScript.description}</p>
                  ) : null}
                  <div className="us-view-section">
                    <h4>{t("matches")}</h4>
                    <div className="us-view-patterns">
                      {dialogScript.matches.map((p) => (
                        <code key={p}>{p}</code>
                      ))}
                    </div>
                  </div>
                  {dialogScript.excludes.length > 0 ? (
                    <div className="us-view-section">
                      <h4>{t("excludes")}</h4>
                      <div className="us-view-patterns">
                        {dialogScript.excludes.map((p) => (
                          <code key={p}>{p}</code>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="us-view-section">
                    <h4>{t("code")}</h4>
                    <div className="us-view-code">
                      <pre><code>{dialogScript.code}</code></pre>
                    </div>
                  </div>
                  <div className="us-view-section">
                    <h4>{t("runtime")}</h4>
                    <div className="us-view-runtime">
                      <div>
                        <span>{t("lastRun")}</span>
                        <strong>{formatDate(locale, dialogScript.lastRunAt) || t("never")}</strong>
                      </div>
                      <div>
                        <span>{t("lastMatch")}</span>
                        <strong>{dialogScript.lastMatchedUrl || t("never")}</strong>
                      </div>
                      {dialogScript.lastError ? (
                        <div className="error">
                          <span>{t("lastError")}</span>
                          <strong>{dialogScript.lastError}</strong>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              {dialogMode === "edit" ? (
                <div className="us-edit">
                  <div className="us-form-grid">
                    <label className="us-field">
                      <span>{t("name")}</span>
                      <input
                        onChange={(e) => updateForm("name", e.currentTarget.value)}
                        placeholder={t("namePlaceholder")}
                        value={form.name}
                      />
                    </label>
                    <label className="us-field">
                      <span>{`${t("description")} (${t("optional")})`}</span>
                      <input
                        onChange={(e) => updateForm("description", e.currentTarget.value)}
                        placeholder={t("descriptionPlaceholder")}
                        value={form.description}
                      />
                    </label>
                  </div>

                  <div className="us-form-grid">
                    <label className="us-field">
                      <span>{`${t("matches")} (${t("onePerLine")})`}</span>
                      <textarea
                        className="us-pattern-area"
                        onChange={(e) => updateForm("matchesText", e.currentTarget.value)}
                        placeholder={t("matchesPlaceholder")}
                        value={form.matchesText}
                      />
                    </label>
                    <label className="us-field">
                      <span>{`${t("excludes")} (${t("optional")})`}</span>
                      <textarea
                        className="us-pattern-area"
                        onChange={(e) => updateForm("excludesText", e.currentTarget.value)}
                        placeholder={t("excludesPlaceholder")}
                        value={form.excludesText}
                      />
                    </label>
                  </div>

                  <div className="us-field">
                    <span>{t("code")}</span>
                    <MonacoScriptEditor
                      ariaLabel={t("code")}
                      minHeight={300}
                      onChange={(value) => updateForm("code", value)}
                      theme={editorTheme}
                      value={form.code}
                    />
                  </div>

                  <div className="us-edit-footer">
                    <label className="us-toggle">
                      <input
                        checked={form.enabled}
                        onChange={(e) => updateForm("enabled", e.currentTarget.checked)}
                        type="checkbox"
                      />
                      <span className="us-toggle-track">
                        <span className="us-toggle-thumb" />
                      </span>
                      <span className="us-toggle-label">{form.enabled ? t("enabled") : t("disabled")}</span>
                    </label>
                    <div className="us-edit-actions">
                      {dialogScript ? (
                        <button
                          className="us-dialog-btn danger"
                          disabled={saving || busyScriptIds.includes(dialogScript.id)}
                          onClick={() => void removeScript(dialogScript)}
                          type="button"
                        >
                          <Trash2 size={14} />
                          {t("remove")}
                        </button>
                      ) : null}
                      <button
                        className="us-dialog-btn primary"
                        disabled={saving}
                        onClick={() => void saveScript()}
                        type="button"
                      >
                        {saving ? <LoaderCircle size={14} className="animate-spin" /> : <Save size={14} />}
                        {t("save")}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
