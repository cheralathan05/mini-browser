export type SupportedLocale = "en-US" | "zh-CN";
export type LanguageSetting = "system" | SupportedLocale;

const languageAliases: Record<string, SupportedLocale> = {
  en: "en-US",
  "en-us": "en-US",
  zh: "zh-CN",
  "zh-cn": "zh-CN",
  "zh-hans": "zh-CN",
};

export function normalizeLanguageSetting(value: unknown): LanguageSetting {
  if (typeof value !== "string") {
    return "system";
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "system") {
    return "system";
  }

  return languageAliases[normalized] ?? "system";
}

export function resolveLocale(
  languageSetting: LanguageSetting,
  systemLanguage?: string,
): SupportedLocale {
  if (languageSetting !== "system") {
    return languageSetting;
  }

  const locale = (systemLanguage ?? "").trim().toLowerCase();
  if (locale.startsWith("zh")) {
    return "zh-CN";
  }
  return "en-US";
}
