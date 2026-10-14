// @ts-nocheck
export function initHistoryPage() {
  (function () {
    var SETTINGS_STORAGE_KEY = "milo.settings.v1";
    var I18N = {
      "en-US": {
        pageTitle: "History",
        heroTitle: "History",
        queryPlaceholder: "Search history (title, URL)",
        importHistory: "Import",
        clearAll: "Clear all",
        noRecords: "No history yet",
        save: "Save",
        cancel: "Cancel",
        edit: "Edit",
        remove: "Delete",
        open: "Open",
        untitled: "(Untitled)",
        today: "Today",
        yesterday: "Yesterday",
        importPanelTitle: "Import from other browsers",
        importPanelDescription: "Auto-detect Chromium-based browser profiles and merge their history into Milo.",
        importDetectedSources: "Detected browser profiles",
        importNoSources: "No compatible browser profiles were found on this device.",
        importRefreshSources: "Refresh",
        importLoadingSources: "Scanning local browser profiles...",
        importHint: "Chrome, Edge, Brave, Chromium, Vivaldi, and Arc can be detected automatically. Re-importing merges only newly discovered history metadata.",
        importAction: "Import",
        importReimportAction: "Import Again",
        importAlreadyImported: "Imported",
        importSuccess: "Imported {imported} new record(s) from {source}, merged {merged} existing item(s), skipped {skipped} unchanged item(s).",
        importNothing: "No new history was imported from {source}. Skipped {skipped} unchanged item(s).",
        importFailed: "Failed to import history.",
        shellMissing: "browserShell API is unavailable on this page. Please restart the app.",
        historyUrlRequired: "URL cannot be empty.",
        historyUpdateSuccess: "History record updated.",
        historyUpdateFailed: "Failed to update history record.",
        historyMenuFailed: "Failed to open history menu.",
        historyDeleteSuccess: "History record deleted.",
        historyDeleteFailed: "Failed to delete history record.",
        clearAllConfirm: "Clear all browsing history?",
        clearAllSuccess: "All browsing history cleared.",
        clearAllFailed: "Failed to clear browsing history.",
        initFailed: "Initialization failed.",
      },
      "zh-CN": {
        pageTitle: "历史记录",
        heroTitle: "历史记录",
        queryPlaceholder: "搜索历史记录（标题、URL）",
        importHistory: "导入",
        clearAll: "清空全部",
        noRecords: "暂无历史记录",
        save: "保存",
        cancel: "取消",
        edit: "编辑",
        remove: "删除",
        open: "打开",
        untitled: "(无标题)",
        today: "今天",
        yesterday: "昨天",
        importPanelTitle: "从其他浏览器导入",
        importPanelDescription: "自动发现 Chromium 系浏览器配置，并把历史记录合并到 Milo。",
        importDetectedSources: "已发现的浏览器配置",
        importNoSources: "当前设备上没有发现可直接导入的浏览器配置。",
        importRefreshSources: "刷新",
        importLoadingSources: "正在扫描本地浏览器配置...",
        importHint: "支持自动发现 Chrome、Edge、Brave、Chromium、Vivaldi、Arc。重复导入只会合并新的历史元数据，不会重复叠加未变化的来源。",
        importAction: "导入",
        importReimportAction: "重新导入",
        importAlreadyImported: "已导入",
        importSuccess: "已从 {source} 导入 {imported} 条新记录，合并 {merged} 条已有记录，跳过 {skipped} 条未变化记录。",
        importNothing: "{source} 没有新的历史记录可导入，已跳过 {skipped} 条未变化记录。",
        importFailed: "导入历史记录失败。",
        shellMissing: "当前页面缺少 browserShell API，请重启应用后重试。",
        historyUrlRequired: "URL 不能为空。",
        historyUpdateSuccess: "历史记录更新成功。",
        historyUpdateFailed: "更新历史记录失败。",
        historyMenuFailed: "打开历史记录菜单失败。",
        historyDeleteSuccess: "历史记录删除成功。",
        historyDeleteFailed: "删除历史记录失败。",
        clearAllConfirm: "确定清空全部浏览历史吗？",
        clearAllSuccess: "已清空全部浏览历史。",
        clearAllFailed: "清空浏览历史失败。",
        initFailed: "初始化失败。",
      },
    };

    function normalizeLanguage(value) {
      var normalized = String(value || "system").trim().toLowerCase();
      if (normalized === "zh" || normalized === "zh-cn" || normalized === "zh-hans") return "zh-CN";
      if (normalized === "en" || normalized === "en-us") return "en-US";
      return "system";
    }

    function resolveLocale(languageSetting) {
      var normalized = normalizeLanguage(languageSetting);
      if (normalized === "zh-CN" || normalized === "en-US") return normalized;
      var systemLanguage = String(navigator.language || "en-US").toLowerCase();
      return systemLanguage.indexOf("zh") === 0 ? "zh-CN" : "en-US";
    }

    function readGlobalSettings() {
      try {
        return JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
      } catch {
        return {};
      }
    }

    function saveLanguageSetting(nextLanguage) {
      try {
        var settings = readGlobalSettings();
        settings.language = normalizeLanguage(nextLanguage);
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
      } catch {
        // Ignore local storage failures.
      }
    }

    var languageSetting = normalizeLanguage(readGlobalSettings().language);
    var locale = resolveLocale(languageSetting);

    function tr(key, vars) {
      var pack = I18N[locale] || I18N["en-US"];
      var template = pack[key] || key;
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, function (_, name) {
        return vars[name] == null ? "" : String(vars[name]);
      });
    }

    var queryEl = document.getElementById("query");
    var toggleImportBtn = document.getElementById("toggle-import");
    var clearAllBtn = document.getElementById("clear-all");
    var statusEl = document.getElementById("status");
    var historyImportPanelEl = document.getElementById("history-import-panel");
    var historyImportTitleEl = document.getElementById("history-import-title");
    var historyImportDescriptionEl = document.getElementById("history-import-description");
    var historyImportHintEl = document.getElementById("history-import-hint");
    var historyImportSourcesLabelEl = document.getElementById("history-import-sources-label");
    var historyImportSourcesEl = document.getElementById("history-import-sources");
    var refreshImportSourcesBtn = document.getElementById("refresh-import-sources");
    var closeImportPanelBtn = document.getElementById("close-import-panel");
    var historyListEl = document.getElementById("history-list");
    var toastHostEl = document.getElementById("toast-host");
    var toastEl = document.getElementById("toast");

    var state = {
      records: [],
      query: "",
      showImportPanel: false,
      importSources: [],
      hasLoadedImportSources: false,
      isLoadingImportSources: false,
      isMutating: false,
      selectedRecordIds: new Set(),
    };

    function esc(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    function escAttr(value) {
      return esc(value).replace(/"/g, "&quot;");
    }

    function requireShell() {
      if (!window.browserShell) {
        throw new Error(tr("shellMissing"));
      }
      return window.browserShell;
    }

    function setStatus(message, type) {
      statusEl.textContent = message || "";
      statusEl.className = "status";
      if (!message) return;
      if (type === "err") statusEl.classList.add("err");
      if (type === "ok") statusEl.classList.add("ok");
    }

    function showToast(message, type) {
      if (!toastHostEl || !toastEl || !message) {
        return;
      }
      setStatus("", null);
      toastEl.textContent = message;
      toastEl.className = "page-toast";
      toastEl.classList.add(type === "err" ? "err" : "ok");
      toastHostEl.hidden = false;
      window.clearTimeout(showToast._timer);
      showToast._timer = window.setTimeout(function () {
        toastHostEl.hidden = true;
        toastEl.textContent = "";
        toastEl.className = "page-toast";
      }, 4200);
    }

    function applyStaticI18n() {
      document.documentElement.lang = locale;
      document.title = tr("pageTitle");
      document.getElementById("hero-title").textContent = tr("heroTitle");
      queryEl.placeholder = tr("queryPlaceholder");
      toggleImportBtn.textContent = tr("importHistory");
      clearAllBtn.textContent = tr("clearAll");
      historyImportTitleEl.textContent = tr("importPanelTitle");
      historyImportDescriptionEl.textContent = tr("importPanelDescription");
      historyImportHintEl.textContent = tr("importHint");
      historyImportSourcesLabelEl.textContent = tr("importDetectedSources");
      refreshImportSourcesBtn.textContent = tr("importRefreshSources");
      closeImportPanelBtn.textContent = tr("cancel");
    }

    function formatLastVisited(timestamp) {
      if (!Number.isFinite(timestamp)) {
        return "";
      }
      try {
        return new Intl.DateTimeFormat(locale, {
          timeStyle: "short",
        }).format(new Date(timestamp));
      } catch {
        return new Date(timestamp).toLocaleTimeString(locale);
      }
    }

    function formatGroupLabel(timestamp) {
      var target = new Date(timestamp);
      var today = new Date();
      var startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
      var startTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
      var oneDay = 24 * 60 * 60 * 1000;
      if (startTarget === startToday) return tr("today");
      if (startTarget === startToday - oneDay) return tr("yesterday");
      try {
        return new Intl.DateTimeFormat(locale, {
          weekday: "long",
          month: "short",
          day: "numeric",
          year: target.getFullYear() === today.getFullYear() ? undefined : "numeric",
        }).format(target);
      } catch {
        return target.toLocaleDateString(locale);
      }
    }

    function faviconUrl(record) {
      if (record.favicon) return record.favicon;
      try {
        var hostname = new URL(record.url).hostname;
        if (!hostname) return "";
        return "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(hostname) + "&sz=32";
      } catch {
        return "";
      }
    }

    function faviconMarkup(record) {
      var src = faviconUrl(record);
      var fallback = esc(String(record.title || record.url || "?").trim().slice(0, 1) || "?");
      if (src) {
        return '<img class="history-favicon" src="' + escAttr(src) + '" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';" /><span class="history-fallback" style="display:none">' + fallback + "</span>";
      }
      return '<span class="history-fallback">' + fallback + "</span>";
    }

    function groupRecords(rows) {
      var groups = [];
      var currentKey = "";
      rows.forEach(function (record) {
        var date = new Date(record.lastVisitedAt || 0);
        var groupKey = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
        if (groupKey !== currentKey) {
          currentKey = groupKey;
          groups.push({
            key: groupKey,
            label: formatGroupLabel(record.lastVisitedAt),
            records: [],
          });
        }
        groups[groups.length - 1].records.push(record);
      });
      return groups;
    }

    function sortedRecords() {
      return state.records.slice().sort(function (a, b) {
        return (b.lastVisitedAt || 0) - (a.lastVisitedAt || 0);
      });
    }

    function filteredRecords() {
      var q = state.query.trim().toLowerCase();
      var rows = sortedRecords();
      if (!q) return rows;
      return rows.filter(function (record) {
        return String(record.title || "").toLowerCase().indexOf(q) !== -1
          || String(record.url || "").toLowerCase().indexOf(q) !== -1;
      });
    }

    function collectedImportedSourceIds() {
      var ids = new Set();
      state.records.forEach(function (record) {
        if (!Array.isArray(record.importSourceStats)) {
          return;
        }
        record.importSourceStats.forEach(function (stat) {
          if (stat && typeof stat.sourceId === "string" && stat.sourceId) {
            ids.add(stat.sourceId);
          }
        });
      });
      return ids;
    }

    function formatImportStatus(result) {
      if (result.importedRecords === 0 && result.mergedRecords === 0) {
        return tr("importNothing", {
          source: result.sourceLabel,
          skipped: result.skippedRecords,
        });
      }

      return tr("importSuccess", {
        source: result.sourceLabel,
        imported: result.importedRecords,
        merged: result.mergedRecords,
        skipped: result.skippedRecords,
      });
    }

    function closeImportPanel() {
      if (state.isMutating) {
        return;
      }

      state.showImportPanel = false;
      renderImportPanel();
    }

    function openImportPanel() {
      if (!window.browserShell || state.isMutating) {
        return;
      }

      var shouldLoadSources = !state.hasLoadedImportSources;
      state.showImportPanel = true;
      renderImportPanel();
      window.setTimeout(function () {
        if (!state.showImportPanel) {
          return;
        }

        if (refreshImportSourcesBtn && !refreshImportSourcesBtn.disabled) {
          refreshImportSourcesBtn.focus();
          return;
        }

        closeImportPanelBtn && closeImportPanelBtn.focus();
      }, 0);

      if (shouldLoadSources) {
        void loadImportSources().catch(function (error) {
          showToast(error && error.message ? error.message : tr("importFailed"), "err");
        });
      }
    }

    function renderImportPanel() {
      historyImportPanelEl.hidden = !state.showImportPanel;
      toggleImportBtn.textContent = tr("importHistory");
      toggleImportBtn.disabled = !window.browserShell || state.isMutating;
      clearAllBtn.disabled = !window.browserShell || state.isMutating || state.records.length === 0;
      refreshImportSourcesBtn.disabled = !window.browserShell || state.isMutating || state.isLoadingImportSources;
      closeImportPanelBtn.disabled = state.isMutating;

      if (!state.showImportPanel) {
        return;
      }

      var importedSourceIds = collectedImportedSourceIds();

      if (state.isLoadingImportSources) {
        historyImportSourcesEl.innerHTML = '<div class="history-import-empty">' + esc(tr("importLoadingSources")) + "</div>";
        return;
      }

      if (state.importSources.length === 0) {
        historyImportSourcesEl.innerHTML = '<div class="history-import-empty">' + esc(tr("importNoSources")) + "</div>";
        return;
      }

      historyImportSourcesEl.innerHTML = state.importSources.map(function (source) {
        var isImported = importedSourceIds.has(source.id);
        var encodedSourceId = encodeURIComponent(source.id);

        return ''
          + '<div class="history-import-item">'
          + '  <div class="history-import-meta">'
          + '    <div class="history-import-browser-row">'
          + '      <div class="history-import-browser">' + esc(source.browserName) + '</div>'
          + (isImported ? '<span class="history-import-badge">' + esc(tr("importAlreadyImported")) + '</span>' : '')
          + '    </div>'
          + '    <div class="history-import-profile">' + esc(source.profileName) + '</div>'
          + '  </div>'
          + '  <button class="row-btn"'
          + '    data-history-import-action="import-source"'
          + '    data-source-id="' + encodedSourceId + '"'
          + '    type="button"'
          + (state.isMutating ? ' disabled' : '')
          + '>'
          + esc(isImported ? tr("importReimportAction") : tr("importAction"))
          + '  </button>'
          + '</div>';
      }).join("");
    }

    function renderRows() {
      var rows = filteredRecords();

      if (rows.length === 0) {
        historyListEl.innerHTML = '<div class="history-empty">' + esc(tr("noRecords")) + "</div>";
        return;
      }

      var groups = groupRecords(rows);
      var html = "";
      groups.forEach(function (group) {
        html += '<section class="history-group">';
        html += '<div class="history-group-title">' + esc(group.label) + "</div>";
        group.records.forEach(function (record) {
          var lastVisited = formatLastVisited(record.lastVisitedAt);
          var isSelected = state.selectedRecordIds.has(record.id);

          html += '<div class="history-row' + (isSelected ? " selected" : "") + '" data-history-open-id="' + record.id + '" role="link" tabindex="0">';
          html += '<div class="history-select">';
          html += '<input class="history-checkbox" data-history-select="toggle" data-id="' + record.id + '" type="checkbox"' + (isSelected ? " checked" : "") + ' />';
          html += "</div>";
          html += faviconMarkup(record);
          html += '<div class="history-main">';
          html += '<div class="history-title">' + esc(record.title || tr("untitled")) + "</div>";
          html += '<div class="history-secondary">';
          html += '<div class="history-time">' + esc(lastVisited) + "</div>";
          html += '<div class="history-meta">' + esc(record.url || "") + "</div>";
          html += "</div>";
          html += "</div>";
          html += '<div class="history-actions">';
          html += '<button class="history-delete-btn" aria-label="' + escAttr(tr("remove")) + '" data-history-action="remove" data-id="' + record.id + '" title="' + escAttr(tr("remove")) + '" type="button"' + (state.isMutating ? " disabled" : "") + '>&#x2715;</button>';
          html += "</div>";
          html += "</div>";
        });
        html += "</section>";
      });

      historyListEl.innerHTML = html;
    }

    function render() {
      renderImportPanel();
      renderRows();
    }

    function applyState(payload) {
      state.records = Array.isArray(payload.records) ? payload.records : [];
      var visibleIds = new Set(state.records.map(function (record) {
        return record.id;
      }));
      state.selectedRecordIds.forEach(function (id) {
        if (!visibleIds.has(id)) {
          state.selectedRecordIds.delete(id);
        }
      });
      render();
    }

    async function reloadState() {
      var shell = requireShell();
      var payload = await shell.historyGetState();
      applyState(payload);
    }

    async function loadImportSources() {
      var shell = requireShell();
      state.isLoadingImportSources = true;
      renderImportPanel();
      try {
        var sources = await shell.historyImportListSources();
        state.importSources = Array.isArray(sources) ? sources : [];
        state.hasLoadedImportSources = true;
      } finally {
        state.isLoadingImportSources = false;
        renderImportPanel();
      }
    }

    async function runMutation(operation, errorMessage) {
      if (state.isMutating) {
        return;
      }
      state.isMutating = true;
      render();
      try {
        await operation();
      } catch (error) {
        showToast(error && error.message ? error.message : errorMessage, "err");
      } finally {
        state.isMutating = false;
        render();
      }
    }

    async function removeHistory(id) {
      await runMutation(async function () {
        var shell = requireShell();
        var records = await shell.historyRemove(id);
        applyState({ records: records });
        showToast(tr("historyDeleteSuccess"), "ok");
      }, tr("historyDeleteFailed"));
    }

    async function clearAll() {
      if (state.records.length === 0) {
        return;
      }
      if (!window.confirm(tr("clearAllConfirm"))) {
        return;
      }

      await runMutation(async function () {
        var shell = requireShell();
        var records = await shell.historyClear();
        applyState({ records: records });
        showToast(tr("clearAllSuccess"), "ok");
      }, tr("clearAllFailed"));
    }

    async function importFromSource(sourceId) {
      await runMutation(async function () {
        var shell = requireShell();
        var result = await shell.historyImportSource(sourceId);
        applyState({ records: result.records });
        state.showImportPanel = false;
        renderImportPanel();
        showToast(formatImportStatus(result), "ok");
      }, tr("importFailed"));
    }

    function findRecord(id) {
      return state.records.find(function (record) {
        return record.id === id;
      });
    }

    function openHistoryRecord(id) {
      var target = findRecord(id);
      if (target && target.url) {
        window.open(target.url, "_blank");
      }
    }

    queryEl.addEventListener("input", function () {
      state.query = queryEl.value || "";
      renderRows();
    });

    toggleImportBtn.addEventListener("click", function () {
      openImportPanel();
    });

    refreshImportSourcesBtn.addEventListener("click", function () {
      if (state.isMutating || state.isLoadingImportSources) {
        return;
      }
      void loadImportSources().catch(function (error) {
        showToast(error && error.message ? error.message : tr("importFailed"), "err");
      });
    });

    closeImportPanelBtn.addEventListener("click", function () {
      closeImportPanel();
    });

    historyImportPanelEl.addEventListener("click", function (event) {
      if (event.target !== historyImportPanelEl) {
        return;
      }

      closeImportPanel();
    });

    clearAllBtn.addEventListener("click", function () {
      void clearAll();
    });

    historyImportSourcesEl.addEventListener("click", function (event) {
      var btn = event.target.closest("button[data-history-import-action]");
      if (!btn) return;
      var action = btn.getAttribute("data-history-import-action");
      if (action !== "import-source") return;
      var encodedSourceId = btn.getAttribute("data-source-id");
      if (!encodedSourceId) return;
      void importFromSource(decodeURIComponent(encodedSourceId));
    });

    historyListEl.addEventListener("change", function (event) {
      var checkbox = event.target.closest("input[data-history-select]");
      if (!checkbox) return;
      var id = checkbox.getAttribute("data-id");
      if (!id) return;

      if (checkbox.checked) {
        state.selectedRecordIds.add(id);
      } else {
        state.selectedRecordIds.delete(id);
      }

      renderRows();
    });

    historyListEl.addEventListener("click", function (event) {
      if (event.target.closest("input[data-history-select]")) {
        return;
      }

      var btn = event.target.closest("button[data-history-action]");
      if (btn) {
        var action = btn.getAttribute("data-history-action");
        var id = btn.getAttribute("data-id");
        if (!id) return;
        if (action === "remove") {
          void removeHistory(id);
        }
        return;
      }

      var row = event.target.closest("[data-history-open-id]");
      if (!row) {
        return;
      }

      var rowId = row.getAttribute("data-history-open-id");
      if (!rowId) {
        return;
      }

      openHistoryRecord(rowId);
    });

    historyListEl.addEventListener("contextmenu", function (event) {
      var row = event.target.closest("[data-history-open-id]");
      if (!row || !window.browserShell || !window.browserShell.historyShowItemMenu) {
        return;
      }

      var rowId = row.getAttribute("data-history-open-id");
      if (!rowId) {
        return;
      }

      var target = findRecord(rowId);
      if (!target || !target.url) {
        return;
      }

      event.preventDefault();
      void window.browserShell.historyShowItemMenu(target.url).catch(function (error) {
        showToast(error && error.message ? error.message : tr("historyMenuFailed"), "err");
      });
    });

    historyListEl.addEventListener("keydown", function (event) {
      if (event.target.matches("input, button")) {
        return;
      }

      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      var row = event.target.closest("[data-history-open-id]");
      if (!row) {
        return;
      }

      var id = row.getAttribute("data-history-open-id");
      if (!id) {
        return;
      }

      event.preventDefault();
      openHistoryRecord(id);
    });

    window.addEventListener("history:changed", function () {
      void reloadState().catch(function () {
        // Ignore event-driven refresh failures; explicit actions already surface errors.
      });
    });

    window.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || !state.showImportPanel) {
        return;
      }

      event.preventDefault();
      closeImportPanel();
    });

    applyStaticI18n();
    render();

    if (window.browserShell && window.browserShell.settingsGetLanguage) {
      void window.browserShell.settingsGetLanguage().then(function (nextLanguage) {
        languageSetting = normalizeLanguage(nextLanguage);
        locale = resolveLocale(languageSetting);
        saveLanguageSetting(languageSetting);
        applyStaticI18n();
        render();
      }).catch(function (error) {
        console.error("Failed to read app language setting:", error);
      });
    }

    if (window.browserShell && window.browserShell.onLanguageChanged) {
      window.browserShell.onLanguageChanged(function (nextLanguage) {
        languageSetting = normalizeLanguage(nextLanguage);
        locale = resolveLocale(languageSetting);
        saveLanguageSetting(languageSetting);
        applyStaticI18n();
        render();
      });
    }

    void reloadState().catch(function (error) {
      setStatus(error && error.message ? error.message : tr("initFailed"), "err");
    });
  })();
}
