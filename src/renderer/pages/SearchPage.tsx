import { useEffect } from "react";
import { usePageLocale } from "@/lib/use-page-locale";
import { initSearchPage } from "./search-init";

const messages = {
  "en-US": {
    pageTitle: "Search",
    searchPlaceholder: "Search tabs, bookmarks, or history...",
  },
  "zh-CN": {
    pageTitle: "搜索",
    searchPlaceholder: "搜索标签页、书签或历史记录...",
  },
} as const;

type MessageKey = keyof (typeof messages)["en-US"];

export function SearchPage() {
  const locale = usePageLocale();
  const t = (key: MessageKey) => messages[locale][key];

  useEffect(() => {
    initSearchPage();
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t("pageTitle");
  }, [locale]);

  return (
    <div className="card">
      <div className="search-row">
        <svg
          className="search-icon"
          fill="none"
          height="16"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width="16"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" x2="16.65" y1="21" y2="16.65" />
        </svg>
        <input
          autoFocus
          className="search-input"
          id="q"
          placeholder={t("searchPlaceholder")}
          type="text"
        />
        <span className="kbd">ESC</span>
      </div>
      <div className="results" id="results" />
    </div>
  );
}
