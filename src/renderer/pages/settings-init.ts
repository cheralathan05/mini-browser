// @ts-nocheck
import {
  formatSettingsMessage,
  resolveSettingsLocale,
} from "./settings-i18n";

export function initSettingsPage() {
  (function () {
    var STORAGE_KEY = "milo.settings.v1";
    var DOWNLOAD_SETTING_KEYS = {
      downloadDefaultDirectory: true,
      downloadThreadCount: true,
      downloadHeadersText: true,
    };
    var AGENT_SETTING_KEYS = {
      agentBaseUrl: true,
      agentApiKey: true,
      agentModel: true,
    };
    var TRANSLATION_SETTING_KEYS = {
      translationProvider: true,
      translationOpenAIEndpoint: true,
      translationOpenAIApiKey: true,
      translationOpenAIModel: true,
      translationGoogleEndpoint: true,
      translationGoogleApiKey: true,
      translationBaiduEndpoint: true,
      translationBaiduAppId: true,
      translationBaiduApiKey: true,
      translationTargetLanguage: true,
    };
    var defaults = {
      restoreSession: true,
      searchEngine: "google",
      newTabUrl: "milo://home",
      downloadDefaultDirectory: "",
      downloadThreadCount: 4,
      downloadHeadersText: "",
      agentBaseUrl: "https://api.openai.com/v1/chat/completions",
      agentApiKey: "",
      agentModel: "",
      translationProvider: "openai-compatible",
      translationOpenAIEndpoint: "https://api.openai.com/v1/chat/completions",
      translationOpenAIApiKey: "",
      translationOpenAIModel: "",
      translationGoogleEndpoint: "https://translation.googleapis.com/language/translate/v2",
      translationGoogleApiKey: "",
      translationBaiduEndpoint: "https://fanyi-api.baidu.com/api/trans/vip/translate",
      translationBaiduAppId: "",
      translationBaiduApiKey: "",
      translationTargetLanguage: "system",
      doNotTrack: false,
      blockThirdPartyCookies: true,
      theme: "system",
      language: "system",
      compactTabs: false,
      showBookmarksSection: true,
      debugHints: false,
      allowInsecureCerts: false,
    };
    var resetBtn = document.getElementById("reset-defaults");
    var chooseDownloadDirectoryBtn = document.getElementById("choose-download-directory");
    var toastHostEl = document.getElementById("toast-host");
    var toastEl = document.getElementById("toast");
    var controls = Array.prototype.slice.call(document.querySelectorAll("[data-setting]"));
    var currentLocale = resolveSettingsLocale("system", navigator.language);

    function normalizeTheme(value) {
      if (value === "light" || value === "dark" || value === "system") return value;
      return "system";
    }

    function normalizeLanguage(value) {
      var normalized = String(value || "system").trim().toLowerCase();
      if (normalized === "en" || normalized === "en-us") return "en-US";
      if (normalized === "zh" || normalized === "zh-cn" || normalized === "zh-hans") return "zh-CN";
      return "system";
    }

    function normalizeDownloadThreadCount(value) {
      var parsed = Number.parseInt(String(value == null ? "" : value), 10);
      if (!Number.isFinite(parsed)) return defaults.downloadThreadCount;
      return Math.min(16, Math.max(1, parsed));
    }

    function normalizeDownloadHeadersText(value) {
      return String(value || "")
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map(function (line) { return line.trim(); })
        .filter(function (line) { return line.length > 0; })
        .join("\n");
    }

    function normalizeTranslationProvider(value) {
      return value === "google-basic" || value === "baidu-standard" || value === "openai-compatible"
        ? value
        : "openai-compatible";
    }

    function normalizeAgentBaseUrl(value) {
      var normalized = String(value || "").trim();
      return normalized || defaults.agentBaseUrl;
    }

    function normalizeAgentApiKey(value) {
      return String(value || "").trim();
    }

    function normalizeAgentModel(value) {
      return String(value || "").trim();
    }

    function normalizeTranslationOpenAIEndpoint(value) {
      var normalized = String(value || "").trim();
      return normalized || defaults.translationOpenAIEndpoint;
    }

    function normalizeTranslationOpenAIApiKey(value) {
      return String(value || "").trim();
    }

    function normalizeTranslationOpenAIModel(value) {
      return String(value || "").trim();
    }

    function normalizeTranslationGoogleEndpoint(value) {
      var normalized = String(value || "").trim();
      return normalized || defaults.translationGoogleEndpoint;
    }

    function normalizeTranslationGoogleApiKey(value) {
      return String(value || "").trim();
    }

    function normalizeTranslationBaiduEndpoint(value) {
      var normalized = String(value || "").trim();
      return normalized || defaults.translationBaiduEndpoint;
    }

    function normalizeTranslationBaiduAppId(value) {
      return String(value || "").trim();
    }

    function normalizeTranslationBaiduApiKey(value) {
      return String(value || "").trim();
    }

    function normalizeTranslationTargetLanguage(value) {
      var normalized = String(value || "system").trim().toLowerCase();
      if (normalized === "en" || normalized === "en-us") return "en-US";
      if (normalized === "zh" || normalized === "zh-cn" || normalized === "zh-hans") return "zh-CN";
      return "system";
    }

    function normalizeSettingValue(key, value) {
      if (key === "theme") return normalizeTheme(value);
      if (key === "language") return normalizeLanguage(value);
      if (key === "downloadThreadCount") return normalizeDownloadThreadCount(value);
      if (key === "downloadHeadersText") return normalizeDownloadHeadersText(value);
      if (key === "downloadDefaultDirectory") return String(value || "").trim();
      if (key === "agentBaseUrl") return normalizeAgentBaseUrl(value);
      if (key === "agentApiKey") return normalizeAgentApiKey(value);
      if (key === "agentModel") return normalizeAgentModel(value);
      if (key === "translationProvider") return normalizeTranslationProvider(value);
      if (key === "translationOpenAIEndpoint") return normalizeTranslationOpenAIEndpoint(value);
      if (key === "translationOpenAIApiKey") return normalizeTranslationOpenAIApiKey(value);
      if (key === "translationOpenAIModel") return normalizeTranslationOpenAIModel(value);
      if (key === "translationGoogleEndpoint") return normalizeTranslationGoogleEndpoint(value);
      if (key === "translationGoogleApiKey") return normalizeTranslationGoogleApiKey(value);
      if (key === "translationBaiduEndpoint") return normalizeTranslationBaiduEndpoint(value);
      if (key === "translationBaiduAppId") return normalizeTranslationBaiduAppId(value);
      if (key === "translationBaiduApiKey") return normalizeTranslationBaiduApiKey(value);
      if (key === "translationTargetLanguage") return normalizeTranslationTargetLanguage(value);
      return value;
    }

    function resolveLocale(languageSetting) {
      return resolveSettingsLocale(languageSetting, navigator.language);
    }

    function tr(key) {
      return formatSettingsMessage(currentLocale, key);
    }

    function readSettings() {
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return Object.assign({}, defaults);
        var parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return Object.assign({}, defaults);
        if (parsed.translationEndpoint && !parsed.translationOpenAIEndpoint) {
          parsed.translationOpenAIEndpoint = parsed.translationEndpoint;
        }
        if (parsed.translationApiKey && !parsed.translationOpenAIApiKey) {
          parsed.translationOpenAIApiKey = parsed.translationApiKey;
        }
        if (parsed.translationModel && !parsed.translationOpenAIModel) {
          parsed.translationOpenAIModel = parsed.translationModel;
        }
        if (parsed.agentEndpoint && !parsed.agentBaseUrl) {
          parsed.agentBaseUrl = parsed.agentEndpoint;
        }
        var merged = Object.assign({}, defaults, parsed);
        Object.keys(merged).forEach(function (key) {
          merged[key] = normalizeSettingValue(key, merged[key]);
        });
        return merged;
      } catch {
        return Object.assign({}, defaults);
      }
    }

    function writeSettings(settings) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }

    function showToast(text, type) {
      if (!toastHostEl || !toastEl || !text) {
        return;
      }
      toastEl.textContent = text;
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

    function bindValueToControl(control, value) {
      if (!control) return;
      if (control.type === "checkbox") {
        control.checked = Boolean(value);
        return;
      }
      control.value = String(value == null ? "" : value);
    }

    function extractControlValue(control) {
      if (control.type === "checkbox") {
        return Boolean(control.checked);
      }
      return control.value;
    }

    function applyTheme(theme) {
      var html = document.documentElement;
      if (theme === "system") {
        var isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        html.setAttribute("data-theme", isDark ? "dark" : "light");
      } else {
        html.setAttribute("data-theme", theme);
      }
    }

    function applyTranslationProviderVisibility(provider) {
      var activeProvider = normalizeTranslationProvider(provider);
      Array.prototype.slice.call(document.querySelectorAll("[data-translation-providers]")).forEach(function (row) {
        var providers = String(row.getAttribute("data-translation-providers") || "")
          .split(",")
          .map(function (entry) { return entry.trim(); })
          .filter(Boolean);
        row.hidden = providers.indexOf(activeProvider) === -1;
      });
    }

    function applyI18n(settings) {
      document.documentElement.lang = currentLocale;
      document.title = tr("pageTitle");
      if (!settings) return;
      bindValueToControl(document.querySelector('[data-setting="theme"]'), settings.theme);
      bindValueToControl(document.querySelector('[data-setting="language"]'), settings.language);
      bindValueToControl(document.querySelector('[data-setting="translationProvider"]'), settings.translationProvider);
      applyTranslationProviderVisibility(settings.translationProvider);
    }

    async function persistDownloadPreferences(settings) {
      if (!window.browserShell || !window.browserShell.downloadsSetPreferences) {
        return;
      }

      var prefs = await window.browserShell.downloadsSetPreferences({
        defaultDirectory: settings.downloadDefaultDirectory || null,
        defaultThreadCount: settings.downloadThreadCount,
        defaultHeadersText: settings.downloadHeadersText,
      });

      settings.downloadDefaultDirectory = prefs.defaultDirectory || "";
      settings.downloadThreadCount = prefs.defaultThreadCount;
      settings.downloadHeadersText = prefs.defaultHeadersText || "";
      writeSettings(settings);
      bindValueToControl(document.querySelector('[data-setting="downloadDefaultDirectory"]'), settings.downloadDefaultDirectory);
      bindValueToControl(document.querySelector('[data-setting="downloadThreadCount"]'), settings.downloadThreadCount);
      bindValueToControl(document.querySelector('[data-setting="downloadHeadersText"]'), settings.downloadHeadersText);
    }

    async function persistTranslationPreferences(settings) {
      if (!window.browserShell || !window.browserShell.translationSetPreferences) {
        return;
      }

      var prefs = await window.browserShell.translationSetPreferences({
        provider: settings.translationProvider,
        targetLanguage: settings.translationTargetLanguage,
        sources: {
          "openai-compatible": {
            endpoint: settings.translationOpenAIEndpoint,
            apiKey: settings.translationOpenAIApiKey,
            model: settings.translationOpenAIModel,
          },
          "google-basic": {
            endpoint: settings.translationGoogleEndpoint,
            apiKey: settings.translationGoogleApiKey,
          },
          "baidu-standard": {
            endpoint: settings.translationBaiduEndpoint,
            appId: settings.translationBaiduAppId,
            apiKey: settings.translationBaiduApiKey,
          },
        },
      });

      settings.translationProvider = normalizeTranslationProvider(prefs.provider);
      settings.translationOpenAIEndpoint = normalizeTranslationOpenAIEndpoint(prefs.sources["openai-compatible"].endpoint);
      settings.translationOpenAIApiKey = normalizeTranslationOpenAIApiKey(prefs.sources["openai-compatible"].apiKey);
      settings.translationOpenAIModel = normalizeTranslationOpenAIModel(prefs.sources["openai-compatible"].model);
      settings.translationGoogleEndpoint = normalizeTranslationGoogleEndpoint(prefs.sources["google-basic"].endpoint);
      settings.translationGoogleApiKey = normalizeTranslationGoogleApiKey(prefs.sources["google-basic"].apiKey);
      settings.translationBaiduEndpoint = normalizeTranslationBaiduEndpoint(prefs.sources["baidu-standard"].endpoint);
      settings.translationBaiduAppId = normalizeTranslationBaiduAppId(prefs.sources["baidu-standard"].appId);
      settings.translationBaiduApiKey = normalizeTranslationBaiduApiKey(prefs.sources["baidu-standard"].apiKey);
      settings.translationTargetLanguage = normalizeTranslationTargetLanguage(prefs.targetLanguage);
      writeSettings(settings);
      bindValueToControl(document.querySelector('[data-setting="translationProvider"]'), settings.translationProvider);
      bindValueToControl(document.querySelector('[data-setting="translationOpenAIEndpoint"]'), settings.translationOpenAIEndpoint);
      bindValueToControl(document.querySelector('[data-setting="translationOpenAIApiKey"]'), settings.translationOpenAIApiKey);
      bindValueToControl(document.querySelector('[data-setting="translationOpenAIModel"]'), settings.translationOpenAIModel);
      bindValueToControl(document.querySelector('[data-setting="translationGoogleEndpoint"]'), settings.translationGoogleEndpoint);
      bindValueToControl(document.querySelector('[data-setting="translationGoogleApiKey"]'), settings.translationGoogleApiKey);
      bindValueToControl(document.querySelector('[data-setting="translationBaiduEndpoint"]'), settings.translationBaiduEndpoint);
      bindValueToControl(document.querySelector('[data-setting="translationBaiduAppId"]'), settings.translationBaiduAppId);
      bindValueToControl(document.querySelector('[data-setting="translationBaiduApiKey"]'), settings.translationBaiduApiKey);
      bindValueToControl(document.querySelector('[data-setting="translationTargetLanguage"]'), settings.translationTargetLanguage);
      applyTranslationProviderVisibility(settings.translationProvider);
    }

    async function persistAgentPreferences(settings) {
      if (!window.browserShell || !window.browserShell.agentSetPreferences) {
        return;
      }

      var prefs = await window.browserShell.agentSetPreferences({
        baseUrl: settings.agentBaseUrl,
        apiKey: settings.agentApiKey,
        model: settings.agentModel,
      });

      settings.agentBaseUrl = normalizeAgentBaseUrl(prefs.baseUrl);
      settings.agentApiKey = normalizeAgentApiKey(prefs.apiKey);
      settings.agentModel = normalizeAgentModel(prefs.model);
      writeSettings(settings);
      bindValueToControl(document.querySelector('[data-setting="agentBaseUrl"]'), settings.agentBaseUrl);
      bindValueToControl(document.querySelector('[data-setting="agentApiKey"]'), settings.agentApiKey);
      bindValueToControl(document.querySelector('[data-setting="agentModel"]'), settings.agentModel);
    }

    async function persistSetting(key, value) {
      var next = readSettings();
      next[key] = normalizeSettingValue(key, value);

      if (key === "theme") {
        next.theme = normalizeTheme(next.theme);
      }
      if (key === "language") {
        next.language = normalizeLanguage(next.language);
      }

      writeSettings(next);

      if (key === "theme") {
        applyTheme(next.theme);
        if (window.browserShell && window.browserShell.settingsSetTheme) {
          await window.browserShell.settingsSetTheme(next.theme);
        }
      }

      if (key === "language") {
        currentLocale = resolveLocale(next.language);
        applyI18n(next);
        if (window.browserShell && window.browserShell.settingsSetLanguage) {
          await window.browserShell.settingsSetLanguage(next.language);
        }
      }

      if (key === "translationProvider") {
        applyTranslationProviderVisibility(next.translationProvider);
      }

      if (DOWNLOAD_SETTING_KEYS[key]) {
        await persistDownloadPreferences(next);
      }

      if (AGENT_SETTING_KEYS[key]) {
        await persistAgentPreferences(next);
      }

      if (TRANSLATION_SETTING_KEYS[key]) {
        await persistTranslationPreferences(next);
      }

      showToast(tr("saved"), "ok");
    }

    async function hydrate() {
      var settings = readSettings();
      if (window.browserShell && window.browserShell.settingsGetTheme) {
        try {
          settings.theme = normalizeTheme(await window.browserShell.settingsGetTheme());
        } catch (error) {
          console.error("Failed to read app theme setting:", error);
        }
      }
      if (window.browserShell && window.browserShell.settingsGetLanguage) {
        try {
          settings.language = normalizeLanguage(await window.browserShell.settingsGetLanguage());
        } catch (error) {
          console.error("Failed to read app language setting:", error);
        }
      }
      if (window.browserShell && window.browserShell.downloadsGetPreferences) {
        try {
          var downloadPrefs = await window.browserShell.downloadsGetPreferences();
          settings.downloadDefaultDirectory = downloadPrefs.defaultDirectory || "";
          settings.downloadThreadCount = normalizeDownloadThreadCount(downloadPrefs.defaultThreadCount);
          settings.downloadHeadersText = normalizeDownloadHeadersText(downloadPrefs.defaultHeadersText);
        } catch (error) {
          console.error("Failed to read download preferences:", error);
        }
      }
      if (window.browserShell && window.browserShell.agentGetPreferences) {
        try {
          var agentPrefs = await window.browserShell.agentGetPreferences();
          settings.agentBaseUrl = normalizeAgentBaseUrl(agentPrefs.baseUrl);
          settings.agentApiKey = normalizeAgentApiKey(agentPrefs.apiKey);
          settings.agentModel = normalizeAgentModel(agentPrefs.model);
        } catch (error) {
          console.error("Failed to read agent preferences:", error);
        }
      }
      if (window.browserShell && window.browserShell.translationGetPreferences) {
        try {
          var translationPrefs = await window.browserShell.translationGetPreferences();
          settings.translationProvider = normalizeTranslationProvider(translationPrefs.provider);
          settings.translationOpenAIEndpoint = normalizeTranslationOpenAIEndpoint(translationPrefs.sources["openai-compatible"].endpoint);
          settings.translationOpenAIApiKey = normalizeTranslationOpenAIApiKey(translationPrefs.sources["openai-compatible"].apiKey);
          settings.translationOpenAIModel = normalizeTranslationOpenAIModel(translationPrefs.sources["openai-compatible"].model);
          settings.translationGoogleEndpoint = normalizeTranslationGoogleEndpoint(translationPrefs.sources["google-basic"].endpoint);
          settings.translationGoogleApiKey = normalizeTranslationGoogleApiKey(translationPrefs.sources["google-basic"].apiKey);
          settings.translationBaiduEndpoint = normalizeTranslationBaiduEndpoint(translationPrefs.sources["baidu-standard"].endpoint);
          settings.translationBaiduAppId = normalizeTranslationBaiduAppId(translationPrefs.sources["baidu-standard"].appId);
          settings.translationBaiduApiKey = normalizeTranslationBaiduApiKey(translationPrefs.sources["baidu-standard"].apiKey);
          settings.translationTargetLanguage = normalizeTranslationTargetLanguage(translationPrefs.targetLanguage);
        } catch (error) {
          console.error("Failed to read translation preferences:", error);
        }
      }

      currentLocale = resolveLocale(settings.language);
      writeSettings(settings);
      applyI18n(settings);
      applyTheme(settings.theme);

      controls.forEach(function (control) {
        var key = control.getAttribute("data-setting");
        if (!key) return;
        bindValueToControl(control, settings[key]);
      });
      applyTranslationProviderVisibility(settings.translationProvider);

      controls.forEach(function (control) {
        if (control._settingsBound) return;
        control._settingsBound = true;
        control.addEventListener("change", function () {
          var key = control.getAttribute("data-setting");
          if (!key) return;
          void persistSetting(key, extractControlValue(control));
        });
      });
    }

    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
      var current = readSettings();
      if (current.theme === "system") applyTheme("system");
    });

    resetBtn.addEventListener("click", function () {
      var resetSettings = Object.assign({}, defaults);
      writeSettings(resetSettings);
      controls.forEach(function (control) {
        var key = control.getAttribute("data-setting");
        if (!key) return;
        bindValueToControl(control, resetSettings[key]);
      });
      applyTheme(resetSettings.theme);
      if (window.browserShell && window.browserShell.settingsSetTheme) {
        void window.browserShell.settingsSetTheme(resetSettings.theme);
      }
      currentLocale = resolveLocale(resetSettings.language);
      applyI18n(resetSettings);
      if (window.browserShell && window.browserShell.settingsSetLanguage) {
        void window.browserShell.settingsSetLanguage(resetSettings.language);
      }
      applyTranslationProviderVisibility(resetSettings.translationProvider);
      if (window.browserShell && window.browserShell.downloadsSetPreferences) {
        void window.browserShell.downloadsSetPreferences({
          defaultDirectory: null,
          defaultThreadCount: resetSettings.downloadThreadCount,
          defaultHeadersText: resetSettings.downloadHeadersText,
        }).then(function (prefs) {
          resetSettings.downloadDefaultDirectory = prefs.defaultDirectory || "";
          resetSettings.downloadThreadCount = prefs.defaultThreadCount;
          resetSettings.downloadHeadersText = prefs.defaultHeadersText || "";
          writeSettings(resetSettings);
          bindValueToControl(document.querySelector('[data-setting="downloadDefaultDirectory"]'), resetSettings.downloadDefaultDirectory);
          bindValueToControl(document.querySelector('[data-setting="downloadThreadCount"]'), resetSettings.downloadThreadCount);
          bindValueToControl(document.querySelector('[data-setting="downloadHeadersText"]'), resetSettings.downloadHeadersText);
        }).catch(function (error) {
          console.error("Failed to reset download preferences:", error);
        });
      }
      if (window.browserShell && window.browserShell.agentSetPreferences) {
        void window.browserShell.agentSetPreferences({
          baseUrl: resetSettings.agentBaseUrl,
          apiKey: resetSettings.agentApiKey,
          model: resetSettings.agentModel,
        }).then(function (prefs) {
          resetSettings.agentBaseUrl = normalizeAgentBaseUrl(prefs.baseUrl);
          resetSettings.agentApiKey = normalizeAgentApiKey(prefs.apiKey);
          resetSettings.agentModel = normalizeAgentModel(prefs.model);
          writeSettings(resetSettings);
          bindValueToControl(document.querySelector('[data-setting="agentBaseUrl"]'), resetSettings.agentBaseUrl);
          bindValueToControl(document.querySelector('[data-setting="agentApiKey"]'), resetSettings.agentApiKey);
          bindValueToControl(document.querySelector('[data-setting="agentModel"]'), resetSettings.agentModel);
        }).catch(function (error) {
          console.error("Failed to reset agent preferences:", error);
        });
      }
      if (window.browserShell && window.browserShell.translationSetPreferences) {
        void window.browserShell.translationSetPreferences({
          provider: resetSettings.translationProvider,
          targetLanguage: resetSettings.translationTargetLanguage,
          sources: {
            "openai-compatible": {
              endpoint: resetSettings.translationOpenAIEndpoint,
              apiKey: resetSettings.translationOpenAIApiKey,
              model: resetSettings.translationOpenAIModel,
            },
            "google-basic": {
              endpoint: resetSettings.translationGoogleEndpoint,
              apiKey: resetSettings.translationGoogleApiKey,
            },
            "baidu-standard": {
              endpoint: resetSettings.translationBaiduEndpoint,
              appId: resetSettings.translationBaiduAppId,
              apiKey: resetSettings.translationBaiduApiKey,
            },
          },
        }).then(function (prefs) {
          resetSettings.translationProvider = normalizeTranslationProvider(prefs.provider);
          resetSettings.translationOpenAIEndpoint = normalizeTranslationOpenAIEndpoint(prefs.sources["openai-compatible"].endpoint);
          resetSettings.translationOpenAIApiKey = normalizeTranslationOpenAIApiKey(prefs.sources["openai-compatible"].apiKey);
          resetSettings.translationOpenAIModel = normalizeTranslationOpenAIModel(prefs.sources["openai-compatible"].model);
          resetSettings.translationGoogleEndpoint = normalizeTranslationGoogleEndpoint(prefs.sources["google-basic"].endpoint);
          resetSettings.translationGoogleApiKey = normalizeTranslationGoogleApiKey(prefs.sources["google-basic"].apiKey);
          resetSettings.translationBaiduEndpoint = normalizeTranslationBaiduEndpoint(prefs.sources["baidu-standard"].endpoint);
          resetSettings.translationBaiduAppId = normalizeTranslationBaiduAppId(prefs.sources["baidu-standard"].appId);
          resetSettings.translationBaiduApiKey = normalizeTranslationBaiduApiKey(prefs.sources["baidu-standard"].apiKey);
          resetSettings.translationTargetLanguage = normalizeTranslationTargetLanguage(prefs.targetLanguage);
          writeSettings(resetSettings);
          bindValueToControl(document.querySelector('[data-setting="translationProvider"]'), resetSettings.translationProvider);
          bindValueToControl(document.querySelector('[data-setting="translationOpenAIEndpoint"]'), resetSettings.translationOpenAIEndpoint);
          bindValueToControl(document.querySelector('[data-setting="translationOpenAIApiKey"]'), resetSettings.translationOpenAIApiKey);
          bindValueToControl(document.querySelector('[data-setting="translationOpenAIModel"]'), resetSettings.translationOpenAIModel);
          bindValueToControl(document.querySelector('[data-setting="translationGoogleEndpoint"]'), resetSettings.translationGoogleEndpoint);
          bindValueToControl(document.querySelector('[data-setting="translationGoogleApiKey"]'), resetSettings.translationGoogleApiKey);
          bindValueToControl(document.querySelector('[data-setting="translationBaiduEndpoint"]'), resetSettings.translationBaiduEndpoint);
          bindValueToControl(document.querySelector('[data-setting="translationBaiduAppId"]'), resetSettings.translationBaiduAppId);
          bindValueToControl(document.querySelector('[data-setting="translationBaiduApiKey"]'), resetSettings.translationBaiduApiKey);
          bindValueToControl(document.querySelector('[data-setting="translationTargetLanguage"]'), resetSettings.translationTargetLanguage);
          applyTranslationProviderVisibility(resetSettings.translationProvider);
        }).catch(function (error) {
          console.error("Failed to reset translation preferences:", error);
        });
      }
      showToast(tr("defaultsRestored"), "ok");
    });

    chooseDownloadDirectoryBtn.addEventListener("click", function () {
      if (!window.browserShell || !window.browserShell.downloadsShowDirectoryDialog) {
        return;
      }
      var currentValue = document.querySelector('[data-setting="downloadDefaultDirectory"]').value || "";
      void window.browserShell.downloadsShowDirectoryDialog({
        defaultPath: String(currentValue || ""),
      }).then(function (selectedDirectory) {
        if (!selectedDirectory) {
          return;
        }
        var input = document.querySelector('[data-setting="downloadDefaultDirectory"]');
        bindValueToControl(input, selectedDirectory);
        void persistSetting("downloadDefaultDirectory", selectedDirectory);
      }).catch(function (error) {
        showToast(error && error.message ? error.message : tr("chooseDownloadDirectoryFailed"), "err");
      });
    });

    if (window.browserShell && window.browserShell.onThemeChanged) {
      window.browserShell.onThemeChanged(function (theme) {
        var next = readSettings();
        next.theme = normalizeTheme(theme);
        writeSettings(next);
        bindValueToControl(document.querySelector('[data-setting="theme"]'), next.theme);
        applyTheme(next.theme);
      });
    }

    if (window.browserShell && window.browserShell.onLanguageChanged) {
      window.browserShell.onLanguageChanged(function (language) {
        var next = readSettings();
        next.language = normalizeLanguage(language);
        writeSettings(next);
        currentLocale = resolveLocale(next.language);
        applyI18n(next);
      });
    }

    void hydrate();
  })();
}
