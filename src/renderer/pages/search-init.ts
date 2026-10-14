// @ts-nocheck
export function initSearchPage() {
  var SETTINGS_STORAGE_KEY = "milo.settings.v1";
  var LOCALES = {
    "en-US": {
      title: "Search",
      searchPlaceholder: "Search tabs, bookmarks, or history...",
      empty: "No results",
      tabsGroup: "Tabs",
      bookmarksGroup: "Bookmarks",
      historyGroup: "History",
      current: "Current",
      removeBookmark: "Remove",
    },
    "zh-CN": {
      title: "搜索",
      searchPlaceholder: "搜索标签页、书签或历史记录...",
      empty: "无搜索结果",
      tabsGroup: "标签页",
      bookmarksGroup: "书签",
      historyGroup: "历史记录",
      current: "当前",
      removeBookmark: "删除",
    },
  };

  function normalizeLanguage(value) {
    var normalized = String(value || "system").trim().toLowerCase();
    if (normalized === "zh" || normalized === "zh-cn" || normalized === "zh-hans") return "zh-CN";
    if (normalized === "en" || normalized === "en-us") return "en-US";
    if (normalized === "system") return "system";
    return "system";
  }

  function resolveLocale(languageSetting) {
    var normalized = normalizeLanguage(languageSetting);
    if (normalized !== "system") return normalized;
    var systemLanguage = String(navigator.language || "en-US").toLowerCase();
    if (systemLanguage.indexOf("zh") === 0) return "zh-CN";
    return "en-US";
  }

  function readStoredSettings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
    } catch (error) {
      return {};
    }
  }

  function saveLanguageSetting(nextLanguage) {
    try {
      var settings = readStoredSettings();
      settings.language = normalizeLanguage(nextLanguage);
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      // Ignore storage failures.
    }
  }

  var languageSetting = normalizeLanguage(readStoredSettings().language);
  var locale = resolveLocale(languageSetting);
  function translate(key) {
    var pack = LOCALES[locale] || LOCALES["en-US"];
    return pack[key] || key;
  }

  var TABS = [];
  var BOOKMARKS = [];
  var HISTORY = [];
  var ACTIVE_TAB_ID = "";
  var input = document.getElementById("q");
  var resultsEl = document.getElementById("results");
  var activeIndex = -1;
  var flatItems = [];
  var queryRequestId = 0;

  function applyI18n() {
    document.documentElement.lang = locale;
    document.title = translate("title");
    input.placeholder = translate("searchPlaceholder");
  }

  function normalizeQuery(value) {
    return String(value || "").trim().toLowerCase();
  }

  function matchesQuery(query) {
    if (!query) {
      return true;
    }

    for (var i = 1; i < arguments.length; i += 1) {
      var value = arguments[i];
      if (typeof value === "string" && value.toLowerCase().indexOf(query) !== -1) {
        return true;
      }
    }

    return false;
  }

  function faviconUrl(displayUrl) {
    try {
      if (!displayUrl || displayUrl === "home://start") return "";
      if (displayUrl.indexOf("milo://") === 0) return "";
      var hostname = new URL(displayUrl).hostname;
      if (!hostname) return "";
      return "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(hostname) + "&sz=32";
    } catch (error) {
      return "";
    }
  }

  function escHtml(value) {
    var text = String(value ?? "");
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function escAttr(value) {
    return escHtml(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function applySearchPayload(data, rawQuery) {
    var query = normalizeQuery(rawQuery);
    var tabs = data && Array.isArray(data.tabs) ? data.tabs : [];
    var bookmarks = data && Array.isArray(data.bookmarks) ? data.bookmarks : [];
    var history = data && Array.isArray(data.history) ? data.history : [];

    if (!(window.browserShell && window.browserShell.searchQuery) && query) {
      tabs = tabs.filter(function(tab) {
        return matchesQuery(query, tab.title, tab.displayUrl);
      });
      bookmarks = bookmarks.filter(function(bookmark) {
        return matchesQuery(query, bookmark.title, bookmark.url);
      });
      history = history.filter(function(record) {
        return matchesQuery(query, record.title, record.url);
      });
    }

    TABS = tabs;
    BOOKMARKS = bookmarks;
    HISTORY = history;
    ACTIVE_TAB_ID = data && typeof data.activeTabId === "string" ? data.activeTabId : "";
    render();
  }

  function render() {
    flatItems = [];
    var html = "";

    if (!TABS.length && !BOOKMARKS.length && !HISTORY.length) {
      activeIndex = -1;
      resultsEl.innerHTML = '<div class="empty">' + escHtml(translate("empty")) + "</div>";
      return;
    }

    if (TABS.length) {
      html += '<div class="group-label">' + escHtml(translate("tabsGroup")) + "</div>";
      TABS.forEach(function(tab) {
        var idx = flatItems.length;
        var iconUrl = tab.favicon || faviconUrl(tab.displayUrl);
        flatItems.push({ type: "tab", data: tab });
        html += '<div class="item" data-idx="' + idx + '">';
        html += '<img src="' + escAttr(iconUrl) + '" onerror="this.style.display=\'none\'" />';
        html += '<div class="item-info"><div class="item-title">' + escHtml(tab.title) + "</div><div class=\"item-url\">" + escHtml(tab.displayUrl) + "</div></div>";
        if (tab.id === ACTIVE_TAB_ID) html += '<span class="item-badge">' + escHtml(translate("current")) + "</span>";
        html += "</div>";
      });
    }

    if (BOOKMARKS.length) {
      html += '<div class="group-label">' + escHtml(translate("bookmarksGroup")) + "</div>";
      BOOKMARKS.forEach(function(bookmark) {
        var idx = flatItems.length;
        var iconUrl = bookmark.favicon || faviconUrl(bookmark.url);
        flatItems.push({ type: "bookmark", data: bookmark });
        html += '<div class="item" data-idx="' + idx + '">';
        html += '<img src="' + escAttr(iconUrl) + '" onerror="this.style.display=\'none\'" />';
        html += '<div class="item-info"><div class="item-title">' + escHtml(bookmark.title) + "</div><div class=\"item-url\">" + escHtml(bookmark.url) + "</div></div>";
        html += '<button class="item-delete" data-bm-id="' + escAttr(bookmark.id) + '" title="' + escAttr(translate("removeBookmark")) + '">&#x2715;</button>';
        html += "</div>";
      });
    }

    if (HISTORY.length) {
      html += '<div class="group-label">' + escHtml(translate("historyGroup")) + "</div>";
      HISTORY.forEach(function(record) {
        var idx = flatItems.length;
        var iconUrl = record.favicon || faviconUrl(record.url);
        flatItems.push({ type: "history", data: record });
        html += '<div class="item" data-idx="' + idx + '">';
        html += '<img src="' + escAttr(iconUrl) + '" onerror="this.style.display=\'none\'" />';
        html += '<div class="item-info"><div class="item-title">' + escHtml(record.title) + "</div><div class=\"item-url\">" + escHtml(record.url) + "</div></div>";
        html += "</div>";
      });
    }

    if (activeIndex >= flatItems.length) {
      activeIndex = flatItems.length - 1;
    }
    if (activeIndex < -1) {
      activeIndex = -1;
    }

    resultsEl.innerHTML = html;
    updateActive();
  }

  function updateActive() {
    var items = resultsEl.querySelectorAll(".item");
    items.forEach(function(el, i) {
      el.classList.toggle("active", i === activeIndex);
    });
  }

  function selectItem(idx) {
    if (idx < 0 || idx >= flatItems.length) return;
    var item = flatItems[idx];
    if (item.type === "tab") {
      if (window.browserShell) {
        window.browserShell.searchSelectTab(item.data.id);
      }
    } else if (window.browserShell) {
      window.browserShell.searchNavigate(item.data.url);
    } else {
      window.location.href = item.data.url;
    }
  }

  async function refreshResults(rawQuery) {
    var query = typeof rawQuery === "string" ? rawQuery : input.value;
    var requestId = ++queryRequestId;

    try {
      if (window.browserShell && window.browserShell.searchQuery) {
        var queryData = await window.browserShell.searchQuery(query);
        if (requestId !== queryRequestId) return;
        applySearchPayload(queryData, query);
        return;
      }

      if (window.browserShell && window.browserShell.searchGetOverlayData) {
        var fallbackData = await window.browserShell.searchGetOverlayData();
        if (requestId !== queryRequestId) return;
        applySearchPayload(fallbackData, query);
        return;
      }
    } catch (error) {
      if (requestId !== queryRequestId) return;
      console.error("Failed to refresh search overlay data:", error);
    }

    if (requestId === queryRequestId) {
      render();
    }
  }

  input.addEventListener("input", function() {
    activeIndex = 0;
    void refreshResults(input.value);
  });

  window.addEventListener("keydown", function(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (window.browserShell) {
        window.browserShell.searchClose();
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = Math.min(activeIndex + 1, flatItems.length - 1);
      updateActive();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = activeIndex <= 0 ? -1 : activeIndex - 1;
      updateActive();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0) selectItem(activeIndex);
      return;
    }
  });

  resultsEl.addEventListener("click", function(event) {
    var deleteBtn = event.target.closest(".item-delete");
    if (deleteBtn) {
      event.stopPropagation();
      var bmId = deleteBtn.getAttribute("data-bm-id");
      if (bmId) {
        if (window.browserShell && window.browserShell.searchRemoveBookmark) {
          void window.browserShell.searchRemoveBookmark(bmId).then(function() {
            return refreshResults(input.value);
          }).catch(function(error) {
            console.error("Failed to remove bookmark from search overlay:", error);
          });
        } else {
          BOOKMARKS = BOOKMARKS.filter(function(bookmark) {
            return bookmark.id !== bmId;
          });
          render();
        }
      }
      return;
    }

    var itemEl = event.target.closest(".item");
    if (itemEl) {
      var idx = parseInt(itemEl.getAttribute("data-idx"), 10);
      selectItem(idx);
    }
  });

  var closeOnBlurTimer = 0;
  window.addEventListener("blur", function() {
    window.clearTimeout(closeOnBlurTimer);
    closeOnBlurTimer = window.setTimeout(function() {
      if (document.hasFocus()) return;
      if (window.browserShell) {
        window.browserShell.searchClose();
      }
    }, 30);
  });
  window.addEventListener("focus", function() {
    window.clearTimeout(closeOnBlurTimer);
  });

  async function bootstrap() {
    applyI18n();

    if (window.browserShell && window.browserShell.settingsGetLanguage) {
      try {
        languageSetting = normalizeLanguage(await window.browserShell.settingsGetLanguage());
        locale = resolveLocale(languageSetting);
        saveLanguageSetting(languageSetting);
        applyI18n();
      } catch (error) {
        console.error("Failed to read app language setting:", error);
      }
    }

    if (window.browserShell && window.browserShell.onLanguageChanged) {
      window.browserShell.onLanguageChanged(function(nextLanguage) {
        languageSetting = normalizeLanguage(nextLanguage);
        locale = resolveLocale(languageSetting);
        saveLanguageSetting(languageSetting);
        applyI18n();
        render();
      });
    }

    await refreshResults("");
    activeIndex = flatItems.length ? 0 : -1;
    updateActive();
    input.focus();
  }

  void bootstrap();
}
