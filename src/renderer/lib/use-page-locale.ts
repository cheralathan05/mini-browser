import { useEffect, useState } from "react";
import {
  normalizeLanguageSetting,
  resolveLocale,
  type SupportedLocale,
} from "@/lib/i18n";

const SETTINGS_STORAGE_KEY = "milo.settings.v1";

function readStoredLanguageSetting() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return "system";
    }

    const parsed = JSON.parse(raw);
    return parsed?.language;
  } catch {
    return "system";
  }
}

export function usePageLocale(): SupportedLocale {
  const [locale, setLocale] = useState<SupportedLocale>(() =>
    resolveLocale(
      normalizeLanguageSetting(readStoredLanguageSetting()),
      typeof navigator !== "undefined" ? navigator.language : "en-US",
    ),
  );

  useEffect(() => {
    const browserShell = window.browserShell;
    if (!browserShell) {
      return;
    }

    let disposed = false;

    void browserShell.settingsGetLanguage()
      .then((language) => {
        if (!disposed) {
          setLocale(
            resolveLocale(
              normalizeLanguageSetting(language),
              navigator.language,
            ),
          );
        }
      })
      .catch(() => {
        // Ignore locale sync failures.
      });

    const disposeLanguage = browserShell.onLanguageChanged((language) => {
      if (!disposed) {
        setLocale(
          resolveLocale(
            normalizeLanguageSetting(language),
            navigator.language,
          ),
        );
      }
    });

    return () => {
      disposed = true;
      disposeLanguage?.();
    };
  }, []);

  return locale;
}
