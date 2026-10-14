import { useEffect } from "react";
import { usePageLocale } from "@/lib/use-page-locale";
import { initHistoryPage } from "./history-init";

const messages = {
  "en-US": {
    pageTitle: "History",
    heroTitle: "History",
    importHistory: "Import",
    clearAll: "Clear all",
    queryPlaceholder: "Search history (title, URL)",
    importPanelTitle: "Import from other browsers",
    importPanelDescription:
      "Auto-detect Chromium-based browser profiles and merge their history into Milo.",
    importRefreshSources: "Refresh",
    cancel: "Cancel",
  },
  "zh-CN": {
    pageTitle: "历史记录",
    heroTitle: "历史记录",
    importHistory: "导入",
    clearAll: "清空全部",
    queryPlaceholder: "搜索历史记录（标题、URL）",
    importPanelTitle: "从其他浏览器导入",
    importPanelDescription:
      "自动发现 Chromium 系浏览器配置，并把历史记录合并到 Milo。",
    importRefreshSources: "刷新",
    cancel: "取消",
  },
} as const;

type MessageKey = keyof (typeof messages)["en-US"];

export function HistoryPage() {
  const locale = usePageLocale();
  const t = (key: MessageKey) => messages[locale][key];

  useEffect(() => {
    initHistoryPage();
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t("pageTitle");
  }, [locale]);

  return (
    <div className="history-page">
      <header className="history-topbar">
        <div className="history-topline">
          <h1 id="hero-title">{t("heroTitle")}</h1>
          <div className="history-top-actions">
            <button className="action-btn" id="toggle-import" type="button">
              {t("importHistory")}
            </button>
            <button className="action-btn danger" id="clear-all" type="button">
              {t("clearAll")}
            </button>
          </div>
        </div>
        <div className="history-search-row">
          <label className="search-shell" htmlFor="query">
            <svg
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
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input id="query" placeholder={t("queryPlaceholder")} type="text" />
          </label>
          <span aria-live="polite" className="status" id="status" />
        </div>
      </header>

      <section
        aria-describedby="history-import-description"
        aria-labelledby="history-import-title"
        aria-modal="true"
        className="history-import-wrap"
        hidden
        id="history-import-panel"
        role="dialog"
      >
        <div className="history-import-card" role="document">
          <div className="history-import-head">
            <div className="history-import-copy">
              <h2 id="history-import-title">{t("importPanelTitle")}</h2>
              <p id="history-import-description">{t("importPanelDescription")}</p>
            </div>
            <div className="history-import-actions">
              <button className="action-btn" id="refresh-import-sources" type="button">
                {t("importRefreshSources")}
              </button>
              <button className="action-btn" id="close-import-panel" type="button">
                {t("cancel")}
              </button>
            </div>
          </div>
          <div className="history-import-hint" id="history-import-hint" />
          <div className="history-import-label" id="history-import-sources-label" />
          <div className="history-import-list" id="history-import-sources" />
        </div>
      </section>

      <section className="history-surface custom-scrollbar" style={{ margin: "16px auto" }}>
        <div id="history-list" />
      </section>

      <div aria-live="polite" className="page-toast-host" hidden id="toast-host">
        <div className="page-toast" id="toast" />
      </div>
    </div>
  );
}
