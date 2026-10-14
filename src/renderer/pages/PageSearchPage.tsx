import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePageLocale } from "@/lib/use-page-locale";

const messages = {
  "en-US": {
    pageTitle: "Find in Page",
    placeholder: "Find in page",
    noMatches: "No matches",
    previous: "Previous match",
    next: "Next match",
    close: "Close find bar",
  },
  "zh-CN": {
    pageTitle: "页内查找",
    placeholder: "在页面中查找",
    noMatches: "无匹配结果",
    previous: "上一个匹配",
    next: "下一个匹配",
    close: "关闭查找栏",
  },
} as const;

type ThemeSetting = "light" | "dark" | "system";
type SupportedLocale = keyof typeof messages;

function resolveThemeValue(theme: ThemeSetting) {
  if (theme === "light" || theme === "dark") {
    return theme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function PageSearchPage() {
  const locale = usePageLocale() as SupportedLocale;
  const t = (key: keyof (typeof messages)["en-US"]) => messages[locale][key];
  const [theme, setTheme] = useState<ThemeSetting>("system");
  const [tabId, setTabId] = useState("");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<PageSearchResultPayload | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const tabIdRef = useRef("");
  const queryRef = useRef("");
  const replaySearchRef = useRef(false);

  const pageSearchHasNoMatches = Boolean(
    query && result?.finalUpdate && result.matches === 0,
  );
  const pageSearchCanStepThroughMatches = Boolean(
    query && (result?.matches ?? 0) > 0,
  );
  const pageSearchCountLabel = !query
    ? ""
    : result
      ? result.matches > 0
        ? `${Math.max(1, result.activeMatchOrdinal)}/${result.matches}`
        : t("noMatches")
      : "\u00A0";

  const applyOverlayState = useCallback((payload: {
    visible: boolean;
    tabId: string;
    query: string;
    result: PageSearchResultPayload | null;
    focusInput: boolean;
  }) => {
    tabIdRef.current = payload.tabId;
    queryRef.current = payload.query;
    setTabId(payload.tabId);
    setQuery(payload.query);
    setResult(payload.result);
    replaySearchRef.current = Boolean(payload.visible && payload.tabId && payload.query && !payload.result);
    if (payload.focusInput) {
      setFocusToken((current) => current + 1);
    }
  }, []);

  const performSearch = useCallback((nextQuery: string, options?: {
    findNext?: boolean;
    forward?: boolean;
  }) => {
    const currentTabId = tabIdRef.current;
    if (!currentTabId || !window.browserShell) {
      return;
    }

    void window.browserShell.pageSearchFind({
      tabId: currentTabId,
      query: nextQuery,
      findNext: options?.findNext ?? true,
      forward: options?.forward ?? true,
    }).catch(() => undefined);
  }, []);

  const closeOverlay = useCallback(() => {
    if (!window.browserShell) {
      return;
    }

    void window.browserShell.pageSearchOverlayClose().catch(() => undefined);
  }, []);

  const stepMatch = useCallback((forward: boolean) => {
    const currentTabId = tabIdRef.current;
    const currentQuery = queryRef.current;
    if (!currentTabId || !currentQuery || !window.browserShell) {
      return;
    }

    void window.browserShell.pageSearchFind({
      tabId: currentTabId,
      query: currentQuery,
      findNext: false,
      forward,
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t("pageTitle");
  }, [locale, t]);

  useEffect(() => {
    const browserShell = window.browserShell;
    if (!browserShell) {
      return;
    }

    let disposed = false;

    void browserShell.settingsGetTheme()
      .then((value) => {
        if (!disposed) {
          setTheme((value === "light" || value === "dark") ? value : "system");
        }
      })
      .catch(() => undefined);

    const disposeTheme = browserShell.onThemeChanged((value) => {
      if (!disposed) {
        setTheme((value === "light" || value === "dark") ? value : "system");
      }
    });

    return () => {
      disposed = true;
      disposeTheme?.();
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolveThemeValue(theme));
  }, [theme]);

  useEffect(() => {
    const browserShell = window.browserShell;
    if (!browserShell) {
      return;
    }

    let disposed = false;

    void browserShell.pageSearchOverlayGetState()
      .then((payload) => {
        if (!disposed) {
          applyOverlayState(payload);
        }
      })
      .catch(() => undefined);

    const disposeOverlayState = browserShell.onPageSearchOverlayState((payload) => {
      if (!disposed) {
        applyOverlayState(payload);
      }
    });

    return () => {
      disposed = true;
      disposeOverlayState?.();
    };
  }, [applyOverlayState]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) {
        return;
      }

      input.focus({ preventScroll: true });
      input.select();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [focusToken]);

  useEffect(() => {
    if (!replaySearchRef.current) {
      return;
    }

    replaySearchRef.current = false;
    performSearch(queryRef.current, {
      findNext: true,
      forward: true,
    });
  }, [performSearch, query, tabId]);

  return (
    <div className="page-search-shell">
      <div className="page-search-bar">
        <input
          ref={inputRef}
          className={`page-search-input${pageSearchHasNoMatches ? " no-match" : ""}`}
          onChange={(event) => {
            const nextQuery = event.target.value;
            queryRef.current = nextQuery;
            setQuery(nextQuery);
            setResult(null);
            performSearch(nextQuery, {
              findNext: true,
              forward: true,
            });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              stepMatch(!event.shiftKey);
              return;
            }

            if (event.key === "Escape") {
              event.preventDefault();
              closeOverlay();
            }
          }}
          placeholder={t("placeholder")}
          spellCheck={false}
          type="search"
          value={query}
        />
        <div className={`page-search-count${pageSearchHasNoMatches ? " no-match" : ""}`}>
          {pageSearchCountLabel}
        </div>
        <div className="page-search-divider">
          <button
            aria-label={t("previous")}
            className="page-search-button"
            disabled={!pageSearchCanStepThroughMatches}
            onClick={() => {
              stepMatch(false);
            }}
            title={t("previous")}
            type="button"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            aria-label={t("next")}
            className="page-search-button"
            disabled={!pageSearchCanStepThroughMatches}
            onClick={() => {
              stepMatch(true);
            }}
            title={t("next")}
            type="button"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
        <button
          aria-label={t("close")}
          className="page-search-button"
          onClick={() => {
            closeOverlay();
          }}
          title={t("close")}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
