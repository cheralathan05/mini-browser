import { BrowserWindow, dialog, type WebContents } from "electron";
import {
  getTranslationDomainForUrl,
  isTranslatablePageUrl,
  isTranslationLifecycleError,
  isTranslationConfigured,
  removeTranslationBanner,
  restoreTranslatedPageInWebContents,
  resolveTranslationSourceLanguage,
  resolveTranslationTargetLanguage,
  translatePageInWebContents,
  translateSelectedTextInWebContents,
  type TranslationPreferences,
  type TranslationUiLocale,
} from "../shared/translation.js";

interface CreatePageTranslationManagerOptions {
  getTranslationPreferences: () => TranslationPreferences;
  setTranslationPreferences: (input?: Partial<TranslationPreferences> | null) => TranslationPreferences;
  resolveBrowserLocale: () => string;
  resolveUiLocale: () => TranslationUiLocale;
  openSettings: () => void;
}

export function createPageTranslationManager(options: CreatePageTranslationManagerOptions) {
  const {
    getTranslationPreferences,
    setTranslationPreferences,
    resolveBrowserLocale,
    resolveUiLocale,
    openSettings,
  } = options;

  const pageTranslationStates = new Map<number, {
    busy: boolean;
    translated: boolean;
    sourceLanguageCode?: string;
    sourceLanguageName?: string;
    targetLanguageCode?: string;
    targetLanguageName?: string;
  }>();
  const pageTranslationAbortControllers = new Map<number, AbortController>();
  const pageTranslationPendingIncremental = new Set<number>();

  function clearPageTranslationState(contentsId: number) {
    cancelPageTranslation(contentsId);
    pageTranslationStates.delete(contentsId);
    pageTranslationPendingIncremental.delete(contentsId);
  }

  function cancelPageTranslation(contentsId: number, message = "Page translation cancelled.") {
    const controller = pageTranslationAbortControllers.get(contentsId);
    pageTranslationAbortControllers.delete(contentsId);
    if (!controller || controller.signal.aborted) {
      return;
    }

    const error = new Error(message);
    error.name = "AbortError";
    controller.abort(error);
  }

  function isCurrentPageTranslationRequest(contentsId: number, controller: AbortController) {
    return pageTranslationAbortControllers.get(contentsId) === controller;
  }

  function getPageTranslationMenuState(webContents: WebContents) {
    if (webContents.isDestroyed()) {
      return {
        supported: false,
        busy: false,
        translated: false,
      };
    }

    const state = pageTranslationStates.get(webContents.id);
    return {
      supported: isTranslatablePageUrl(webContents.getURL()),
      busy: state?.busy ?? false,
      translated: state?.translated ?? false,
    };
  }

  async function promptTranslationConfiguration(targetWindow: BrowserWindow) {
    const uiLocale = resolveUiLocale();
    const localized = uiLocale === "zh-CN"
      ? {
          buttons: ["打开设置", "取消"],
          message: "翻译源尚未配置",
          detail:
            "请先在设置页选择翻译源，并完成共享 Provider 或厂商凭证配置。OpenAI 兼容翻译会复用 Provider 管理里的连接信息。",
        }
      : {
          buttons: ["Open Settings", "Cancel"],
          message: "Translation source is not configured",
          detail:
            "Choose a translation source in Settings and configure the shared provider or vendor credentials it uses. OpenAI-compatible translation reuses the Provider connection.",
        };

    const result = await dialog.showMessageBox(targetWindow, {
      type: "info",
      buttons: localized.buttons,
      defaultId: 0,
      cancelId: 1,
      message: localized.message,
      detail: localized.detail,
    });

    if (result.response === 0) {
      openSettings();
    }
  }

  async function showPageTranslationError(targetWindow: BrowserWindow, error: unknown) {
    if (targetWindow.isDestroyed() || isTranslationLifecycleError(error)) {
      return;
    }

    const uiLocale = resolveUiLocale();
    const localized = uiLocale === "zh-CN"
      ? {
          message: "网页翻译失败",
        }
      : {
          message: "Page translation failed",
        };

    await dialog.showMessageBox(targetWindow, {
      type: "error",
      message: localized.message,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  function rememberAutoTranslateDomain(url: string, preferences: TranslationPreferences) {
    const domain = getTranslationDomainForUrl(url);
    if (!domain || preferences.autoTranslateDomains.includes(domain)) {
      return;
    }

    setTranslationPreferences({
      autoTranslateDomains: [...preferences.autoTranslateDomains, domain],
    });
  }

  function forgetAutoTranslateDomain(url: string) {
    const domain = getTranslationDomainForUrl(url);
    if (!domain) {
      return;
    }

    const preferences = getTranslationPreferences();
    if (!preferences.autoTranslateDomains.includes(domain)) {
      return;
    }

    setTranslationPreferences({
      autoTranslateDomains: preferences.autoTranslateDomains.filter((entry) => entry !== domain),
    });
  }

  async function translateCurrentPage(
    targetWindow: BrowserWindow,
    webContents: WebContents,
    options: {
      rememberDomain: boolean;
      promptConfiguration: boolean;
      sourceLanguage?: string | null;
      targetLanguage?: string | null;
      incremental?: boolean;
    },
  ) {
    if (webContents.isDestroyed()) {
      return;
    }

    const currentState = pageTranslationStates.get(webContents.id);
    if (currentState?.busy || !isTranslatablePageUrl(webContents.getURL())) {
      return;
    }

    if (currentState?.translated && !options.incremental) {
      return;
    }

    const preferences = getTranslationPreferences();
    if (!isTranslationConfigured(preferences)) {
      if (options.promptConfiguration) {
        await promptTranslationConfiguration(targetWindow);
      }
      return;
    }

    const pageUrl = webContents.getURL();
    pageTranslationStates.set(webContents.id, {
      busy: true,
      translated: options.incremental ? currentState?.translated ?? false : false,
      sourceLanguageCode: currentState?.sourceLanguageCode,
      sourceLanguageName: currentState?.sourceLanguageName,
      targetLanguageCode: currentState?.targetLanguageCode,
      targetLanguageName: currentState?.targetLanguageName,
    });
    const translationController = new AbortController();
    pageTranslationAbortControllers.set(webContents.id, translationController);

    try {
      const result = await translatePageInWebContents({
        webContents,
        preferences,
        sourceLanguage: resolveTranslationSourceLanguage(options.sourceLanguage),
        targetLanguage: resolveTranslationSourceLanguage(options.targetLanguage)
          ?? resolveTranslationTargetLanguage(preferences.targetLanguage, resolveBrowserLocale()),
        uiLocale: resolveUiLocale(),
        incremental: options.incremental,
        signal: translationController.signal,
      });

      if (!isCurrentPageTranslationRequest(webContents.id, translationController) || webContents.isDestroyed()) {
        return;
      }

      if (result.status === "translated") {
        if (options.rememberDomain) {
          rememberAutoTranslateDomain(pageUrl, preferences);
        }
        pageTranslationStates.set(webContents.id, {
          busy: false,
          translated: true,
          sourceLanguageCode: result.sourceLanguage.code,
          sourceLanguageName: result.sourceLanguage.name,
          targetLanguageCode: result.targetLanguage.code,
          targetLanguageName: result.targetLanguage.name,
        });
        return;
      }

      pageTranslationStates.set(webContents.id, {
        busy: false,
        translated: options.incremental ? currentState?.translated ?? false : false,
        sourceLanguageCode: currentState?.sourceLanguageCode,
        sourceLanguageName: currentState?.sourceLanguageName,
        targetLanguageCode: currentState?.targetLanguageCode,
        targetLanguageName: currentState?.targetLanguageName,
      });
    } catch (error) {
      if (!isCurrentPageTranslationRequest(webContents.id, translationController)) {
        return;
      }

      if (isTranslationLifecycleError(error) || webContents.isDestroyed()) {
        pageTranslationStates.delete(webContents.id);
        return;
      }

      if (!options.incremental) {
        await removeTranslationBanner(webContents);
      }
      pageTranslationStates.set(webContents.id, {
        busy: false,
        translated: options.incremental ? currentState?.translated ?? false : false,
        sourceLanguageCode: currentState?.sourceLanguageCode,
        sourceLanguageName: currentState?.sourceLanguageName,
        targetLanguageCode: currentState?.targetLanguageCode,
        targetLanguageName: currentState?.targetLanguageName,
      });
    } finally {
      if (isCurrentPageTranslationRequest(webContents.id, translationController)) {
        pageTranslationAbortControllers.delete(webContents.id);
      }

      if (
        pageTranslationPendingIncremental.has(webContents.id)
        && !webContents.isDestroyed()
        && pageTranslationStates.get(webContents.id)?.translated
        && !pageTranslationStates.get(webContents.id)?.busy
      ) {
        pageTranslationPendingIncremental.delete(webContents.id);
        void translateCurrentPage(targetWindow, webContents, {
          rememberDomain: false,
          promptConfiguration: false,
          sourceLanguage: pageTranslationStates.get(webContents.id)?.sourceLanguageCode,
          targetLanguage: pageTranslationStates.get(webContents.id)?.targetLanguageCode,
          incremental: true,
        }).catch((error) => {
          if (!isTranslationLifecycleError(error)) {
            void showPageTranslationError(targetWindow, error);
          }
        });
      }
    }
  }

  async function handlePageTranslationToggle(targetWindow: BrowserWindow, webContents: WebContents) {
    if (webContents.isDestroyed()) {
      return;
    }

    const currentState = pageTranslationStates.get(webContents.id);
    if (currentState?.busy || !isTranslatablePageUrl(webContents.getURL())) {
      return;
    }

    if (currentState?.translated) {
      pageTranslationStates.set(webContents.id, {
        ...currentState,
        busy: true,
      });

      try {
        await restoreTranslatedPageInWebContents(webContents);
        if (webContents.isDestroyed()) {
          return;
        }
        pageTranslationStates.set(webContents.id, {
          busy: false,
          translated: false,
        });
        forgetAutoTranslateDomain(webContents.getURL());
      } catch (error) {
        if (isTranslationLifecycleError(error) || webContents.isDestroyed()) {
          return;
        }
        pageTranslationStates.set(webContents.id, {
          ...currentState,
          busy: false,
        });
        await showPageTranslationError(targetWindow, error);
      }

      return;
    }

    await translateCurrentPage(targetWindow, webContents, {
      rememberDomain: true,
      promptConfiguration: true,
    });
  }

  async function restoreCurrentPageTranslation(targetWindow: BrowserWindow, webContents: WebContents) {
    if (webContents.isDestroyed() || !isTranslatablePageUrl(webContents.getURL())) {
      return;
    }

    const currentState = pageTranslationStates.get(webContents.id);
    if (currentState?.busy) {
      cancelPageTranslation(webContents.id);
    }

    pageTranslationStates.set(webContents.id, {
      ...(currentState ?? {}),
      busy: true,
      translated: currentState?.translated ?? true,
    });

    try {
      await restoreTranslatedPageInWebContents(webContents);
      if (webContents.isDestroyed()) {
        return;
      }

      pageTranslationStates.set(webContents.id, {
        busy: false,
        translated: false,
      });
      forgetAutoTranslateDomain(webContents.getURL());
    } catch (error) {
      if (isTranslationLifecycleError(error) || webContents.isDestroyed()) {
        return;
      }

      pageTranslationStates.set(webContents.id, {
        ...(currentState ?? {}),
        busy: false,
        translated: currentState?.translated ?? false,
      });
      await showPageTranslationError(targetWindow, error);
    }
  }

  async function handlePageTranslationNavigation(targetWindow: BrowserWindow, webContents: WebContents) {
    if (webContents.isDestroyed()) {
      return;
    }

    const pageUrl = webContents.getURL();
    const domain = getTranslationDomainForUrl(pageUrl);
    const preferences = getTranslationPreferences();
    if (!domain || !preferences.autoTranslateDomains.includes(domain)) {
      return;
    }

    await translateCurrentPage(targetWindow, webContents, {
      rememberDomain: false,
      promptConfiguration: false,
    });
  }

  async function handleSelectedTextTranslation(
    targetWindow: BrowserWindow,
    webContents: WebContents,
    selectedText: string,
    anchor?: { x: number; y: number },
  ) {
    if (webContents.isDestroyed() || !isTranslatablePageUrl(webContents.getURL())) {
      return;
    }

    const normalizedText = selectedText.trim();
    if (!normalizedText) {
      return;
    }

    const preferences = getTranslationPreferences();
    if (!isTranslationConfigured(preferences)) {
      await promptTranslationConfiguration(targetWindow);
      return;
    }

    try {
      await translateSelectedTextInWebContents({
        webContents,
        preferences,
        selectedText: normalizedText,
        targetLanguage: resolveTranslationTargetLanguage(preferences.targetLanguage, resolveBrowserLocale()),
        uiLocale: resolveUiLocale(),
        anchor,
      });
    } catch (error) {
      await showPageTranslationError(targetWindow, error);
    }
  }

  function handlePageTranslationCommandUrl(targetWindow: BrowserWindow, webContents: WebContents, url: string) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }

    if (parsed.protocol !== "milo-translation:") {
      return false;
    }

    const action = parsed.searchParams.get("action");
    const sourceLanguage = parsed.searchParams.get("source");
    const targetLanguage = parsed.searchParams.get("target");

    if (action === "cancel") {
      void (async () => {
        cancelPageTranslation(webContents.id);
        pageTranslationPendingIncremental.delete(webContents.id);
        pageTranslationStates.set(webContents.id, {
          busy: true,
          translated: true,
        });

        try {
          await restoreTranslatedPageInWebContents(webContents);
        } finally {
          if (!webContents.isDestroyed()) {
            pageTranslationStates.set(webContents.id, {
              busy: false,
              translated: false,
            });
            await removeTranslationBanner(webContents).catch(() => undefined);
          }
        }
      })().catch((error) => {
        if (!isTranslationLifecycleError(error)) {
          void showPageTranslationError(targetWindow, error);
        }
      });
      return true;
    }

    if (action === "restore") {
      void restoreCurrentPageTranslation(targetWindow, webContents);
      return true;
    }

    if (action === "translate-more") {
      void (async () => {
        const currentState = pageTranslationStates.get(webContents.id);
        if (currentState?.busy) {
          pageTranslationPendingIncremental.add(webContents.id);
          return;
        }

        if (!currentState?.translated) {
          return;
        }

        await translateCurrentPage(targetWindow, webContents, {
          rememberDomain: false,
          promptConfiguration: false,
          sourceLanguage: currentState.sourceLanguageCode,
          targetLanguage: currentState.targetLanguageCode,
          incremental: true,
        });
      })().catch((error) => {
        if (!isTranslationLifecycleError(error)) {
          void showPageTranslationError(targetWindow, error);
        }
      });
      return true;
    }

    if (action === "translate") {
      void (async () => {
        const currentState = pageTranslationStates.get(webContents.id);
        if (currentState?.busy) {
          cancelPageTranslation(webContents.id);
          pageTranslationStates.set(webContents.id, {
            busy: false,
            translated: false,
          });
        }
        if (currentState?.translated) {
          await restoreTranslatedPageInWebContents(webContents);
          pageTranslationStates.set(webContents.id, {
            busy: false,
            translated: false,
          });
        }
        await translateCurrentPage(targetWindow, webContents, {
          rememberDomain: true,
          promptConfiguration: true,
          sourceLanguage,
          targetLanguage,
        });
      })().catch((error) => {
        if (!isTranslationLifecycleError(error)) {
          void showPageTranslationError(targetWindow, error);
        }
      });
      return true;
    }

    return true;
  }

  return {
    clearPageTranslationState,
    getPageTranslationMenuState,
    handlePageTranslationCommandUrl,
    handlePageTranslationNavigation,
    handleSelectedTextTranslation,
    handlePageTranslationToggle,
  };
}
