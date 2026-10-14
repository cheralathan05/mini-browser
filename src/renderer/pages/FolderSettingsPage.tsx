import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogShell } from "@/components/ui/dialog-shell";
import { Input } from "@/components/ui/input";
import {
  buildLucideFolderIconValue,
  getLucideFolderIconComponent,
  getLucideFolderIconName,
  lucideFolderIconOptions,
} from "@/components/workspace/folder-icon";
import { normalizeLanguageSetting, resolveLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { FolderSettingsUpdateInput } from "@/types/workspace";

const FOLDER_BACKGROUND_COLOR_SWATCHES = [
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#0891b2",
  "#475569",
] as const;
const DEFAULT_CUSTOM_FOLDER_BACKGROUND_COLOR = FOLDER_BACKGROUND_COLOR_SWATCHES[0];
const INITIAL_VISIBLE_LUCIDE_ICON_COUNT = 32;
const LUCIDE_ICON_RENDER_BATCH_SIZE = 32;
const SETTINGS_STORAGE_KEY = "milo.settings.v1";

const messages = {
  "en-US": {
    title: "Folder Settings",
    nameLabel: "Folder name",
    namePlaceholder: "Enter folder name",
    iconLabel: "Folder icon",
    iconPlaceholder: "Emoji, image URL, base64, or lucide:name",
    noLucideIcons: "No matching icons",
    backgroundColorLabel: "Folder color",
    defaultColor: "Default",
    customColor: "Custom",
    cancel: "Cancel",
    save: "Save",
    saving: "Saving...",
    saveFailed: "Failed to save folder settings.",
    folderUnavailable: "This folder is unavailable in the current dialog.",
    electronRequired: "This dialog can only run inside Electron.",
  },
  "zh-CN": {
    title: "目录设置",
    nameLabel: "目录名称",
    namePlaceholder: "输入目录名称",
    iconLabel: "目录图标",
    iconPlaceholder: "Emoji、图片 URL、base64 或 lucide:name",
    noLucideIcons: "没有匹配的图标",
    backgroundColorLabel: "目录颜色",
    defaultColor: "默认",
    customColor: "自定义",
    cancel: "取消",
    save: "保存",
    saving: "保存中...",
    saveFailed: "保存目录设置失败。",
    folderUnavailable: "当前对话窗口无法获取目录信息。",
    electronRequired: "这个对话窗口只能在 Electron 中运行。",
  },
} as const;

type MessageKey = keyof (typeof messages)["en-US"];

function readStoredSettingsValue(key: string) {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return undefined;
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed?.[key];
  } catch {
    return undefined;
  }
}

function readInitialLanguageSetting(query: URLSearchParams) {
  if (query.has("language")) {
    return normalizeLanguageSetting(query.get("language"));
  }

  return normalizeLanguageSetting(readStoredSettingsValue("language"));
}

function readInitialThemeSetting() {
  const theme = readStoredSettingsValue("theme");
  return theme === "light" || theme === "dark" || theme === "system" ? theme : "system";
}

function readInitialSystemLanguage(query: URLSearchParams) {
  const querySystemLanguage = query.get("systemLanguage")?.trim();
  if (querySystemLanguage) {
    return querySystemLanguage;
  }

  return typeof navigator !== "undefined" ? navigator.language : "en-US";
}

function normalizeFolderBackgroundColor(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const shortHexMatch = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (shortHexMatch) {
    const [, hex] = shortHexMatch;
    return `#${hex.split("").map((char) => `${char}${char}`).join("")}`.toLowerCase();
  }

  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toLowerCase() : undefined;
}

export function FolderSettingsPage() {
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const systemLanguage = useMemo(() => readInitialSystemLanguage(query), [query]);
  const workspaceId = query.get("workspaceId")?.trim() ?? "";
  const folderId = query.get("folderId")?.trim() ?? "";
  const [name, setName] = useState(query.get("name") ?? "");
  const [icon, setIcon] = useState(query.get("icon") ?? "");
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);
  const [visibleIconOptionCount, setVisibleIconOptionCount] = useState(
    INITIAL_VISIBLE_LUCIDE_ICON_COUNT,
  );
  const [backgroundColor, setBackgroundColor] = useState(
    normalizeFolderBackgroundColor(query.get("backgroundColor")) ?? "",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [theme, setTheme] = useState<string>(() => readInitialThemeSetting());
  const [language, setLanguage] = useState<string>(() => readInitialLanguageSetting(query));
  const [systemPrefersLight, setSystemPrefersLight] = useState(
    window.matchMedia("(prefers-color-scheme: light)").matches,
  );
  const canSubmit = workspaceId.length > 0 && folderId.length > 0;

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
  const locale = resolveLocale(
    normalizeLanguageSetting(language),
    systemLanguage,
  );
  const t = (key: MessageKey) => messages[locale][key];
  const statusMessage = !window.browserShell
    ? t("electronRequired")
    : (!canSubmit ? t("folderUnavailable") : null);
  const normalizedBackgroundColor = normalizeFolderBackgroundColor(backgroundColor);
  const pickerColor = normalizedBackgroundColor ?? DEFAULT_CUSTOM_FOLDER_BACKGROUND_COLOR;
  const trimmedIcon = icon.trim();
  const selectedLucideIconName = getLucideFolderIconName(trimmedIcon);
  const SelectedLucideIcon = selectedLucideIconName
    ? getLucideFolderIconComponent(selectedLucideIconName)
    : null;
  const filteredLucideIconOptions = useMemo(() => {
    const normalizedQuery = trimmedIcon.toLowerCase().startsWith("lucide:")
      ? trimmedIcon.slice("lucide:".length)
      : trimmedIcon;
    const tokens = normalizedQuery
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    if (tokens.length === 0) {
      return lucideFolderIconOptions;
    }

    return lucideFolderIconOptions.filter((option) => {
      const searchable = `${option.name} ${option.label}`.toLowerCase();
      return tokens.every((token) => searchable.includes(token));
    });
  }, [trimmedIcon]);
  const visibleLucideIconOptions = useMemo(
    () => filteredLucideIconOptions.slice(0, visibleIconOptionCount),
    [filteredLucideIconOptions, visibleIconOptionCount],
  );

  useEffect(() => {
    setVisibleIconOptionCount(INITIAL_VISIBLE_LUCIDE_ICON_COUNT);
  }, [filteredLucideIconOptions, isIconPickerOpen]);

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
      void closeDialog();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSubmitting]);

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

  async function handleSubmit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!window.browserShell || !canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const input: FolderSettingsUpdateInput = {
      workspaceId,
      folderId,
      name,
      icon: icon.trim() || undefined,
      backgroundColor: normalizedBackgroundColor,
    };

    try {
      await window.browserShell.submitFolderSettingsDialog(input);
    } catch (submitError) {
      setErrorMessage(submitError instanceof Error ? submitError.message : t("saveFailed"));
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
      contentScrollable
      footerProps={{
        className: cn(
          "border-t px-6 py-4",
          isLight ? "border-black/8" : "border-white/8",
        ),
      }}
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
            onClick={() => {
              void closeDialog();
            }}
            type="button"
            variant="outline"
          >
            {t("cancel")}
          </Button>
          <Button
            className={cn(
              "h-8 rounded-full px-4 text-sm font-medium",
              isLight
                ? "bg-[#1a73e8] text-white hover:bg-[#1765cc]"
                : "bg-[#8ab4f8] text-[#202124] hover:bg-[#93bbfa]",
            )}
            disabled={!window.browserShell || !canSubmit || isSubmitting}
            form="folder-settings-form"
            type="submit"
          >
            {isSubmitting ? t("saving") : t("save")}
          </Button>
        </div>
      )}
      headerProps={{ className: "px-6 pt-5" }}
      title={t("title")}
      titleProps={{ className: "text-[16px] font-semibold" }}
      surfaceProps={{
        className: cn(
          "h-full rounded-none border-0 shadow-none",
          isLight ? "bg-[#f8f9fa] text-[#202124]" : "bg-[#202124] text-[#e8eaed]",
        ),
      }}
      content={(
        <form
          className="space-y-4"
          id="folder-settings-form"
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
        >
          <div className="space-y-2">
            <label
              className={cn("block text-sm font-medium", isLight ? "text-slate-800" : "text-white/85")}
              htmlFor="folder-settings-name"
            >
              {t("nameLabel")}
            </label>
            <Input
              autoFocus
              id="folder-settings-name"
              placeholder={t("namePlaceholder")}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label
              className={cn("block text-sm font-medium", isLight ? "text-slate-800" : "text-white/85")}
              htmlFor="folder-settings-icon"
            >
              {t("iconLabel")}
            </label>
            <div className="relative">
              <Input
                autoComplete="off"
                className={selectedLucideIconName ? "pl-10" : undefined}
                id="folder-settings-icon"
                placeholder={t("iconPlaceholder")}
                value={icon}
                onBlur={() => setIsIconPickerOpen(false)}
                onChange={(event) => setIcon(event.target.value)}
                onFocus={() => setIsIconPickerOpen(true)}
              />
              {SelectedLucideIcon ? (
                <span
                  className={cn(
                    "pointer-events-none absolute left-3 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center",
                    isLight ? "text-slate-500" : "text-white/55",
                  )}
                >
                  <SelectedLucideIcon aria-hidden="true" className="h-4 w-4" />
                </span>
              ) : null}
              {isIconPickerOpen ? (
                <div
                  className={cn(
                    "absolute left-0 right-0 top-[calc(100%+0.35rem)] z-50 rounded-lg border p-2 shadow-xl",
                    isLight
                      ? "border-black/10 bg-white text-slate-800 shadow-black/12"
                      : "border-white/10 bg-[#2b2d31] text-white/85 shadow-black/35",
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                >
                  {filteredLucideIconOptions.length > 0 ? (
                    <div
                      className="grid max-h-36 grid-cols-8 gap-1 overflow-y-auto pr-1"
                      onScroll={(event) => {
                        const target = event.currentTarget;
                        const remainingScroll = target.scrollHeight - target.scrollTop - target.clientHeight;
                        if (remainingScroll > 48) {
                          return;
                        }

                        setVisibleIconOptionCount((currentCount) =>
                          Math.min(
                            filteredLucideIconOptions.length,
                            currentCount + LUCIDE_ICON_RENDER_BATCH_SIZE,
                          )
                        );
                      }}
                    >
                      {visibleLucideIconOptions.map((option) => {
                        const isSelected = selectedLucideIconName === option.name;
                        const OptionIcon = option.Component;
                        return (
                          <button
                            aria-label={option.label}
                            aria-pressed={isSelected}
                            className={cn(
                              "relative flex h-8 w-full items-center justify-center rounded-md border transition-colors",
                              isSelected
                                ? isLight
                                  ? "border-[#1a73e8] bg-[rgba(26,115,232,0.1)] text-[#1a73e8]"
                                  : "border-[#8ab4f8] bg-[rgba(138,180,248,0.14)] text-[#8ab4f8]"
                                : isLight
                                  ? "border-black/8 text-slate-600 hover:bg-black/5 hover:text-slate-900"
                                  : "border-white/10 text-white/65 hover:bg-white/10 hover:text-white",
                            )}
                            key={option.name}
                            onClick={() => {
                              setIcon(buildLucideFolderIconValue(option.name));
                              setIsIconPickerOpen(false);
                            }}
                            title={option.label}
                            type="button"
                          >
                            {OptionIcon ? (
                              <OptionIcon aria-hidden="true" className="h-4 w-4" />
                            ) : null}
                            {isSelected ? (
                              <Check
                                aria-hidden="true"
                                className="absolute right-0.5 top-0.5 h-2.5 w-2.5"
                              />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className={cn("py-3 text-center text-xs", isLight ? "text-slate-500" : "text-white/45")}>
                      {t("noLucideIcons")}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
          <div className="space-y-2">
            <label
              className={cn("block text-sm font-medium", isLight ? "text-slate-800" : "text-white/85")}
              htmlFor="folder-settings-color"
            >
              {t("backgroundColorLabel")}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className={cn(
                  "h-8 rounded-full border px-3 text-xs font-medium transition-colors",
                  !normalizedBackgroundColor
                    ? isLight
                      ? "border-[#1a73e8] bg-[rgba(26,115,232,0.08)] text-[#1a73e8]"
                      : "border-[#8ab4f8] bg-[rgba(138,180,248,0.12)] text-[#8ab4f8]"
                    : isLight
                      ? "border-[#dadce0] text-[#3c4043] hover:bg-black/5"
                      : "border-[#5f6368] text-white/75 hover:bg-white/8",
                )}
                onClick={() => setBackgroundColor("")}
                type="button"
              >
                {t("defaultColor")}
              </button>
              {FOLDER_BACKGROUND_COLOR_SWATCHES.map((color) => (
                <button
                  aria-label={color}
                  className={cn(
                    "h-8 w-8 rounded-full border transition-transform hover:scale-105",
                    normalizedBackgroundColor === color
                      ? isLight
                        ? "border-[#202124] ring-2 ring-[#202124]/15"
                        : "border-white ring-2 ring-white/20"
                      : isLight
                        ? "border-black/10"
                        : "border-white/20",
                  )}
                  key={color}
                  onClick={() => setBackgroundColor(color)}
                  style={{ backgroundColor: color }}
                  type="button"
                />
              ))}
              <label
                className={cn(
                  "flex h-8 cursor-pointer items-center gap-2 rounded-full border px-2 text-xs font-medium transition-colors",
                  isLight
                    ? "border-[#dadce0] text-[#3c4043] hover:bg-black/5"
                    : "border-[#5f6368] text-white/75 hover:bg-white/8",
                )}
                htmlFor="folder-settings-color"
              >
                <span
                  className="h-4 w-4 rounded-full border border-black/10"
                  style={{ backgroundColor: pickerColor }}
                />
                {t("customColor")}
                <input
                  className="sr-only"
                  id="folder-settings-color"
                  onChange={(event) => setBackgroundColor(event.target.value)}
                  type="color"
                  value={pickerColor}
                />
              </label>
            </div>
          </div>
          {statusMessage ? (
            <p className={cn("text-xs", isLight ? "text-amber-700" : "text-amber-300")}>
              {statusMessage}
            </p>
          ) : null}
          {errorMessage ? (
            <p className={cn("text-xs", isLight ? "text-red-600" : "text-red-300")}>
              {errorMessage}
            </p>
          ) : null}
        </form>
      )}
    />
  );
}
