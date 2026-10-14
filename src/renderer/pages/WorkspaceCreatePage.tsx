import { useEffect, useMemo, useState } from "react";
import { Monitor, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogShell } from "@/components/ui/dialog-shell";
import { Input } from "@/components/ui/input";
import { normalizeLanguageSetting, resolveLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { CreateWorkspaceInput } from "@/types/workspace";

const messages = {
  "en-US": {
    title: "Create workspace",
    nameLabel: "Workspace name",
    namePlaceholder: "Leave blank to auto-generate a name",
    inheritLabel: "Inherit current window session",
    inheritUnavailable: "The current window session is unavailable in this dialog.",
    cancel: "Cancel",
    confirm: "Create workspace",
    creating: "Creating...",
    createFailed: "Failed to create workspace.",
    electronRequired: "This dialog can only run inside Electron.",
  },
  "zh-CN": {
    title: "创建 workspace",
    nameLabel: "Workspace 名称",
    namePlaceholder: "留空则自动生成名称",
    inheritLabel: "继承当前窗口的 session",
    inheritUnavailable: "当前对话窗口无法获取可继承的 session。",
    cancel: "取消",
    confirm: "创建 workspace",
    creating: "创建中...",
    createFailed: "创建 workspace 失败。",
    electronRequired: "这个对话窗口只能在 Electron 中运行。",
  },
} as const;

type MessageKey = keyof (typeof messages)["en-US"];

type OptionItemProps = {
  icon: React.ReactNode;
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  isLight: boolean;
  onChange: (val: boolean) => void;
};

function OptionItem({ icon, label, description, checked, disabled, isLight, onChange }: OptionItemProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-[8px] p-2 -mx-2 transition-colors cursor-pointer group",
        disabled && "cursor-not-allowed opacity-60",
        isLight ? "hover:bg-black/[0.03]" : "hover:bg-white/[0.04]",
      )}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
    >
      <div
        className={cn(
          "mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-all",
          checked
            ? isLight
              ? "border-[#1a73e8] bg-[#1a73e8] shadow-[0_0_8px_rgba(26,115,232,0.3)]"
              : "border-[#8ab4f8] bg-[#8ab4f8] shadow-[0_0_8px_rgba(138,180,248,0.35)]"
            : isLight
              ? "border-[#dadce0] bg-white group-hover:border-[#9aa0a6]"
              : "border-[#5f6368] bg-transparent group-hover:border-[#9aa0a6]",
        )}
      >
        {checked && (
          <div className="h-1.5 w-1.5 animate-[scale-in_150ms_ease-out] rounded-full bg-white" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "transition-colors",
              isLight ? "text-[#5f6368] group-hover:text-[#1a73e8]" : "text-[#9aa0a6] group-hover:text-[#8ab4f8]",
              checked && (isLight ? "text-[#1a73e8]" : "text-[#8ab4f8]"),
            )}
          >
            {icon}
          </span>
          <span className="text-sm">{label}</span>
        </div>
        {description && (
          <p
            className={cn(
              "mt-1 text-xs leading-5",
              isLight ? "text-neutral-500" : "text-neutral-400",
            )}
          >
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

export function WorkspaceCreatePage() {
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const sourceWorkspaceId = query.get("sourceWorkspaceId")?.trim() ?? "";
  const sourceWorkspaceName = query.get("sourceWorkspaceName")?.trim() ?? "";
  const canInheritSession = sourceWorkspaceId.length > 0;

  const [workspaceName, setWorkspaceName] = useState("");
  const [inheritSession, setInheritSession] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastTone, setToastTone] = useState<"ok" | "err" | null>(null);
  const [theme, setTheme] = useState<string>("system");
  const [language, setLanguage] = useState<string>("system");
  const [systemPrefersLight, setSystemPrefersLight] = useState(
    window.matchMedia("(prefers-color-scheme: light)").matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
    const handleChange = (event: MediaQueryListEvent) => setSystemPrefersLight(event.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (!window.browserShell) {
      return;
    }

    void window.browserShell.settingsGetTheme().then(setTheme).catch(() => undefined);
    void window.browserShell.settingsGetLanguage().then(setLanguage).catch(() => undefined);

    const disposeTheme = window.browserShell.onThemeChanged(setTheme);
    const disposeLanguage = window.browserShell.onLanguageChanged(setLanguage);

    return () => {
      disposeTheme?.();
      disposeLanguage?.();
    };
  }, []);

  const resolvedTheme = theme === "system"
    ? (systemPrefersLight ? "light" : "dark")
    : theme;
  const isLight = resolvedTheme === "light";
  const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
  const locale = resolveLocale(
    normalizeLanguageSetting(language),
    typeof navigator !== "undefined" ? navigator.language : "en-US",
  );
  const t = (key: MessageKey) => messages[locale][key];
  const statusMessage = !window.browserShell
    ? t("electronRequired")
    : (!canInheritSession ? t("inheritUnavailable") : null);

  function showToast(message: string, tone: "ok" | "err") {
    setToastMessage(message);
    setToastTone(tone);
  }

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t("title");
  }, [locale]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isSubmitting) {
        return;
      }

      event.preventDefault();
      if (window.browserShell) {
        void window.browserShell.closeCurrentWindow();
      } else {
        window.close();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSubmitting]);

  useEffect(() => {
    if (!toastMessage) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setToastMessage("");
      setToastTone(null);
    }, 4200);
    return () => window.clearTimeout(timeoutId);
  }, [toastMessage]);

  async function closeDialog() {
    if (isSubmitting) {
      return;
    }

    if (window.browserShell) {
      await window.browserShell.closeCurrentWindow();
      return;
    }

    window.close();
  }

  async function handleSubmit() {
    if (!window.browserShell) {
      return;
    }

    const input: CreateWorkspaceInput = {
      name: workspaceName.trim() || undefined,
      profileMode: inheritSession && canInheritSession ? "attached" : "new",
      profileSourceWorkspaceId: inheritSession && canInheritSession
        ? sourceWorkspaceId
        : undefined,
      appearanceSourceWorkspaceId: sourceWorkspaceId,
      showWindow: false,
    };

    setIsSubmitting(true);

    try {
      await window.browserShell.createWorkspace(input);
      await window.browserShell.closeCurrentWindow();
    } catch (submitError) {
      showToast(submitError instanceof Error ? submitError.message : t("createFailed"), "err");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <DialogShell
      data-theme={isLight ? "light" : "dark"}
      className={cn(
        "overflow-hidden",
        isLight ? "bg-[#f8f9fa] text-[#202124]" : "bg-[#202124] text-[#e8eaed]",
      )}
      contentProps={{
        className: "flex h-full min-h-0 flex-col gap-4 px-6 py-4",
      }}
      contentScrollable={false}
      footer={(
        <div className="flex justify-end gap-3">
          <Button
            className={cn(
              "h-8 rounded-full px-4 text-sm font-medium",
              isLight
                ? "border border-[#dadce0] bg-transparent text-[#1a73e8] hover:bg-[rgba(26,115,232,0.08)]"
                : "border border-[#5f6368] bg-transparent text-[#8ab4f8] hover:bg-[rgba(138,180,248,0.1)]",
            )}
            disabled={isSubmitting}
            onClick={() => void closeDialog()}
            type="button"
            variant="ghost"
          >
            {t("cancel")}
          </Button>
          <Button
            className={cn(
              "h-8 rounded-full px-4 text-sm font-medium",
              isLight
                ? "border border-[#1a73e8] bg-[#1a73e8] text-white hover:bg-[#1765cc]"
                : "border border-[#8ab4f8] bg-[#8ab4f8] text-[#202124] hover:bg-[#aecbfa]",
            )}
            disabled={!window.browserShell || isSubmitting}
            onClick={() => void handleSubmit()}
            type="button"
          >
            {isSubmitting ? t("creating") : t("confirm")}
          </Button>
        </div>
      )}
      footerProps={{
        className: "px-6 py-4",
      }}
      headerProps={{
        className: cn("px-6", isMac ? "pt-6 pb-3" : "pt-3 pb-2"),
      }}
      surfaceProps={{
        className: cn(
          "overflow-hidden rounded-[16px]",
          isLight ? "bg-white shadow-[0_24px_80px_rgba(0,0,0,0.12)]" : "bg-[#292a2d] shadow-[0_24px_80px_rgba(0,0,0,0.45)]",
        ),
      }}
      header={(
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-[8px] border",
                isLight
                  ? "bg-[#e8f0fe] border-[#1a73e8]/20 text-[#1a73e8]"
                  : "bg-[#8ab4f8]/10 border-[#8ab4f8]/20 text-[#8ab4f8]",
              )}
            >
              <Settings2 className="h-4 w-4" />
            </div>
            <h1 className="text-[15px] font-semibold">
              {t("title")}
            </h1>
          </div>
          <button
            className={cn(
              "p-1.5 rounded-[6px] transition-colors",
              isLight
                ? "text-[#5f6368] hover:bg-black/5 hover:text-[#202124]"
                : "text-[#9aa0a6] hover:bg-white/5 hover:text-[#e8eaed]",
            )}
            onClick={() => void closeDialog()}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    >
      <div>
        <label className="block text-sm font-medium" htmlFor="workspace-name-input">
          {t("nameLabel")}
        </label>
        <Input
          autoFocus
          className={cn(
            "mt-2 h-8 rounded-[8px] border px-3 text-sm outline-none transition",
            isLight
              ? "border-[#dadce0] bg-white text-[#202124] placeholder:text-[#5f6368] focus:border-[#1a73e8] focus:shadow-[0_0_0_1px_#1a73e8]"
              : "border-[#5f6368] bg-[#202124] text-[#e8eaed] placeholder:text-[#9aa0a6] focus:border-[#8ab4f8] focus:shadow-[0_0_0_1px_#8ab4f8]",
          )}
          disabled={isSubmitting}
          id="workspace-name-input"
          onChange={(event) => setWorkspaceName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") {
              return;
            }

            event.preventDefault();
            void handleSubmit();
          }}
          placeholder={sourceWorkspaceName || t("namePlaceholder")}
          type="text"
          value={workspaceName}
        />
      </div>

      <div className="space-y-3">
        <OptionItem
          checked={inheritSession}
          disabled={!canInheritSession || isSubmitting}
          icon={<Monitor className="h-3.5 w-3.5" />}
          isLight={isLight}
          label={t("inheritLabel")}
          onChange={setInheritSession}
        />
      </div>

      <div className="min-h-[20px]">
        {statusMessage ? (
          <p
            className={cn(
              "text-sm",
              isLight ? "text-[#5f6368]" : "text-[#9aa0a6]",
            )}
          >
            {statusMessage}
          </p>
        ) : null}
      </div>

      {toastMessage ? (
        <div className="pointer-events-none fixed bottom-6 right-6 z-50 max-w-[min(420px,calc(100vw-32px))]">
          <div
            className={cn(
              "rounded-2xl border px-4 py-3 text-sm shadow-lg backdrop-blur",
              toastTone === "err"
                ? (isLight
                    ? "border-rose-200 bg-white/95 text-rose-700"
                    : "border-rose-400/30 bg-[#202124]/95 text-rose-300")
                : (isLight
                    ? "border-emerald-200 bg-white/95 text-emerald-700"
                    : "border-emerald-400/30 bg-[#202124]/95 text-emerald-300"),
            )}
          >
            {toastMessage}
          </div>
        </div>
      ) : null}
    </DialogShell>
  );
}
