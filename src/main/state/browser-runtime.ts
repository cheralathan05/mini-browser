import {
  session,
  type WebContents,
  type WebContentsView,
} from "electron";
import type {
  BrowserDownloadCreateInput,
  DownloadRecord,
} from "../services/downloads.js";

interface DownloadManagerLike {
  createFromBrowserDownload: (input: BrowserDownloadCreateInput) => Promise<unknown>;
}

interface CreateBrowserRuntimeManagerOptions {
  defaultSessionKey: string;
  chromeUserAgent: string;
  colorSchemeCommandTimeoutMs: number;
  colorSchemeMediaSyncStateKey: string;
  isGoogleRelatedUrl: (url: string) => boolean;
  getResolvedColorScheme: () => "light" | "dark";
  resolveDownloadDirectory: () => string;
  parseDownloadHeadersText: (input: string) => Record<string, string>;
  getDownloadSettings: () => {
    defaultDirectory?: string;
    defaultThreadCount: number;
    defaultHeadersText: string;
  };
  downloadManager: DownloadManagerLike;
  browserViews: Map<string, WebContentsView>;
  getAuxiliaryWebContents: () => WebContents[];
  clearPageTranslationState: (contentsId: number) => void;
  onBrowserDownloadCreated?: (payload: {
    record: DownloadRecord;
    sourceContentsId?: number;
    sourceTabId?: string;
    sourcePageUrl?: string;
  }) => void;
}

const USER_AGENT_CLIENT_HINT_HEADER_NAMES = [
  "Sec-CH-UA",
  "Sec-CH-UA-Arch",
  "Sec-CH-UA-Bitness",
  "Sec-CH-UA-Full-Version",
  "Sec-CH-UA-Full-Version-List",
  "Sec-CH-UA-Mobile",
  "Sec-CH-UA-Model",
  "Sec-CH-UA-Platform",
  "Sec-CH-UA-Platform-Version",
  "Sec-CH-UA-WoW64",
] as const;

function buildColorSchemeMediaSyncBootstrapScript(stateKeyName: string) {
  const stateKey = JSON.stringify(stateKeyName);

  return `
(() => {
  const globalScope = window;
  const stateKey = ${stateKey};
  const existingState = globalScope[stateKey];
  if (existingState && typeof existingState.update === "function") {
    return;
  }

  if (typeof globalScope.matchMedia !== "function") {
    return;
  }

  const originalMatchMedia = globalScope.matchMedia.bind(globalScope);
  const trackedLists = new Set();
  const prefersColorSchemePattern = /prefers-color-scheme/i;

  const reportListenerError = (error) => {
    try {
      console.error("[Theme] matchMedia listener failed:", error);
    } catch {
      // Ignore console access failures in restricted pages.
    }
  };

  const createChangeEvent = (matches, media, target) => {
    const event = new Event("change");

    try {
      Object.defineProperty(event, "matches", {
        configurable: true,
        enumerable: true,
        value: matches,
      });
      Object.defineProperty(event, "media", {
        configurable: true,
        enumerable: true,
        value: media,
      });
      Object.defineProperty(event, "target", {
        configurable: true,
        enumerable: true,
        value: target,
      });
      Object.defineProperty(event, "currentTarget", {
        configurable: true,
        enumerable: true,
        value: target,
      });
    } catch {
      // Ignore if the runtime rejects extending the event object.
    }

    return event;
  };

  const callEventListener = (listener, event, thisArg) => {
    try {
      if (typeof listener === "function") {
        listener.call(thisArg, event);
        return;
      }

      if (listener && typeof listener.handleEvent === "function") {
        listener.handleEvent.call(listener, event);
      }
    } catch (error) {
      reportListenerError(error);
    }
  };

  const createWrappedMediaQueryList = (nativeList) => {
    let currentMatches = Boolean(nativeList.matches);
    let onchange = null;
    const legacyListeners = new Set();
    const eventListeners = [];

    const prototype = Object.getPrototypeOf(nativeList) ?? Object.prototype;
    const wrappedList = Object.create(prototype);

    const entry = {
      media: String(nativeList.media ?? ""),
      get matches() {
        return currentMatches;
      },
      setMatches(nextMatches) {
        currentMatches = Boolean(nextMatches);
      },
      get onchange() {
        return onchange;
      },
      set onchange(listener) {
        onchange = typeof listener === "function" ? listener : null;
      },
      dispatchChange() {
        const event = createChangeEvent(currentMatches, entry.media, wrappedList);

        for (const listener of [...eventListeners]) {
          callEventListener(listener.listener, event, wrappedList);
          if (listener.once) {
            const index = eventListeners.indexOf(listener);
            if (index >= 0) {
              eventListeners.splice(index, 1);
            }
          }
        }

        for (const listener of Array.from(legacyListeners)) {
          callEventListener(listener, event, wrappedList);
        }

        if (typeof onchange === "function") {
          callEventListener(onchange, event, wrappedList);
        }
      },
    };

    Object.defineProperty(wrappedList, "matches", {
      configurable: true,
      enumerable: true,
      get() {
        return entry.matches;
      },
    });

    Object.defineProperty(wrappedList, "media", {
      configurable: true,
      enumerable: true,
      get() {
        return entry.media;
      },
    });

    Object.defineProperty(wrappedList, "onchange", {
      configurable: true,
      enumerable: true,
      get() {
        return entry.onchange;
      },
      set(listener) {
        entry.onchange = listener;
      },
    });

    Object.defineProperty(wrappedList, Symbol.toStringTag, {
      configurable: true,
      value: "MediaQueryList",
    });

    wrappedList.addListener = (listener) => {
      if (typeof listener === "function") {
        legacyListeners.add(listener);
      }
    };

    wrappedList.removeListener = (listener) => {
      if (typeof listener === "function") {
        legacyListeners.delete(listener);
      }
    };

    wrappedList.addEventListener = (type, listener, options) => {
      if (type !== "change" || !listener) {
        return;
      }

      const once = typeof options === "boolean"
        ? false
        : Boolean(options && typeof options === "object" && "once" in options && options.once);
      const existingListener = eventListeners.find((entryRecord) => entryRecord.listener === listener);
      if (existingListener) {
        existingListener.once = once;
        return;
      }

      eventListeners.push({ listener, once });
    };

    wrappedList.removeEventListener = (type, listener) => {
      if (type !== "change" || !listener) {
        return;
      }

      const index = eventListeners.findIndex((entryRecord) => entryRecord.listener === listener);
      if (index >= 0) {
        eventListeners.splice(index, 1);
      }
    };

    wrappedList.dispatchEvent = (event) => {
      if (!event || String(event.type) !== "change") {
        return true;
      }

      for (const listener of [...eventListeners]) {
        callEventListener(listener.listener, event, wrappedList);
        if (listener.once) {
          const index = eventListeners.indexOf(listener);
          if (index >= 0) {
            eventListeners.splice(index, 1);
          }
        }
      }

      for (const listener of Array.from(legacyListeners)) {
        callEventListener(listener, event, wrappedList);
      }

      if (typeof onchange === "function") {
        callEventListener(onchange, event, wrappedList);
      }

      return !event.defaultPrevented;
    };

    trackedLists.add(entry);
    return wrappedList;
  };

  globalScope.matchMedia = (query) => {
    const nativeList = originalMatchMedia(query);
    const media = String(nativeList.media ?? query ?? "");
    if (!prefersColorSchemePattern.test(media)) {
      return nativeList;
    }

    return createWrappedMediaQueryList(nativeList);
  };

  Object.defineProperty(globalScope, stateKey, {
    configurable: true,
    enumerable: false,
    value: {
      update() {
        for (const entry of Array.from(trackedLists)) {
          const nextMatches = Boolean(originalMatchMedia(entry.media).matches);
          if (nextMatches === entry.matches) {
            continue;
          }

          entry.setMatches(nextMatches);
          entry.dispatchChange();
        }
      },
    },
  });
})();
  `.trim();
}

function buildColorSchemeMediaSyncUpdateScript(stateKeyName: string) {
  const stateKey = JSON.stringify(stateKeyName);

  return `
(() => {
  const themeState = window[${stateKey}];
  if (themeState && typeof themeState.update === "function") {
    themeState.update();
  }
})();
  `.trim();
}

function resolveHttpSourcePageUrl(value?: string) {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function createBrowserRuntimeManager(options: CreateBrowserRuntimeManagerOptions) {
  const {
    defaultSessionKey,
    chromeUserAgent,
    colorSchemeCommandTimeoutMs,
    colorSchemeMediaSyncStateKey,
    isGoogleRelatedUrl,
    getResolvedColorScheme,
    resolveDownloadDirectory,
    parseDownloadHeadersText,
    getDownloadSettings,
    downloadManager,
    browserViews,
    getAuxiliaryWebContents,
    clearPageTranslationState,
    onBrowserDownloadCreated,
  } = options;

  const downloadRegisteredSessions = new Set<string>();
  const requestUserAgentOverrideRegisteredSessions = new Set<string>();
  const browserColorSchemeScriptIds = new Map<number, string>();
  const pendingContentsOverrideTasks = new Map<number, Promise<void>>();
  const colorSchemeMediaSyncBootstrapScript =
    buildColorSchemeMediaSyncBootstrapScript(colorSchemeMediaSyncStateKey);
  const colorSchemeMediaSyncUpdateScript =
    buildColorSchemeMediaSyncUpdateScript(colorSchemeMediaSyncStateKey);
  let originalBrowserUserAgent = "";

  function setOriginalBrowserUserAgent(userAgent: string) {
    originalBrowserUserAgent = userAgent;
  }

  function resolveOriginalBrowserUserAgent() {
    return originalBrowserUserAgent || chromeUserAgent;
  }

  function resolveRequestUserAgent(requestUrl: string, fallbackUserAgent: string) {
    return isGoogleRelatedUrl(requestUrl)
      ? resolveOriginalBrowserUserAgent()
      : fallbackUserAgent;
  }

  function setRequestHeader(requestHeaders: Record<string, string>, headerName: string, value: string) {
    for (const existingHeaderName of Object.keys(requestHeaders)) {
      if (existingHeaderName.toLowerCase() === headerName.toLowerCase()) {
        delete requestHeaders[existingHeaderName];
      }
    }

    requestHeaders[headerName] = value;
  }

  function removeRequestHeader(requestHeaders: Record<string, string>, headerName: string) {
    for (const existingHeaderName of Object.keys(requestHeaders)) {
      if (existingHeaderName.toLowerCase() === headerName.toLowerCase()) {
        delete requestHeaders[existingHeaderName];
      }
    }
  }

  function getSessionForKey(sessionKey: string) {
    return sessionKey === defaultSessionKey
      ? session.defaultSession
      : session.fromPartition(sessionKey);
  }

  function applyResolvedUserAgentToContents(
    targetContents: WebContents,
    targetUrl?: string,
  ) {
    targetContents.setUserAgent(
      resolveRequestUserAgent(targetUrl ?? targetContents.getURL(), chromeUserAgent),
    );
  }

  function cleanupManagedContents(contentsId: number) {
    browserColorSchemeScriptIds.delete(contentsId);
    pendingContentsOverrideTasks.delete(contentsId);
    clearPageTranslationState(contentsId);
  }

  function registerRequestUserAgentOverrideForSession(sessionKey: string) {
    if (requestUserAgentOverrideRegisteredSessions.has(sessionKey)) {
      return;
    }

    const targetSession = getSessionForKey(sessionKey);
    targetSession.webRequest.onBeforeSendHeaders((details, callback) => {
      if (!isGoogleRelatedUrl(details.url)) {
        callback({});
        return;
      }

      const requestHeaders = { ...details.requestHeaders };
      for (const headerName of USER_AGENT_CLIENT_HINT_HEADER_NAMES) {
        removeRequestHeader(requestHeaders, headerName);
      }
      setRequestHeader(
        requestHeaders,
        "User-Agent",
        resolveRequestUserAgent(details.url, chromeUserAgent),
      );
      callback({ requestHeaders });
    });

    requestUserAgentOverrideRegisteredSessions.add(sessionKey);
  }

  function registerDownloadHandlingForSession(sessionKey: string) {
    registerRequestUserAgentOverrideForSession(sessionKey);

    if (downloadRegisteredSessions.has(sessionKey)) {
      return;
    }

    const targetSession = getSessionForKey(sessionKey);

    targetSession.on("will-download", (event, item, sourceContents) => {
      event.preventDefault();

      const sourcePageUrl = resolveHttpSourcePageUrl(sourceContents?.getURL());
      const sourceTabId = sourceContents
        ? Array.from(browserViews.entries()).find(([, view]) => view.webContents?.id === sourceContents.id)?.[0]
        : undefined;
      const sourceHeaders: Record<string, string> = {};
      const downloadUrl = item.getURL();
      const userAgent =
        sourceContents && !sourceContents.isDestroyed()
          ? resolveRequestUserAgent(downloadUrl, sourceContents.getUserAgent())
          : resolveRequestUserAgent(downloadUrl, chromeUserAgent);
      if (userAgent) {
        sourceHeaders["User-Agent"] = userAgent;
      }

      const downloadSettings = getDownloadSettings();

      void downloadManager.createFromBrowserDownload({
        item,
        partition: sessionKey === defaultSessionKey ? undefined : sessionKey,
        sourcePageUrl,
        headers: sourceHeaders,
        defaults: {
          directory: resolveDownloadDirectory(),
          threadCount: downloadSettings.defaultThreadCount,
          headers: parseDownloadHeadersText(downloadSettings.defaultHeadersText),
        },
      }).then((record) => {
        if (!record || typeof record !== "object") {
          return;
        }

        onBrowserDownloadCreated?.({
          record: record as DownloadRecord,
          ...(sourceContents ? { sourceContentsId: sourceContents.id } : {}),
          ...(sourceTabId ? { sourceTabId } : {}),
          ...(sourcePageUrl ? { sourcePageUrl } : {}),
        });
      }).catch((error) => {
        console.error("[Download] Failed to intercept browser download.", error);
      });
    });

    downloadRegisteredSessions.add(sessionKey);
  }

  function ensureDownloadHandlingForPartition(partition: string) {
    registerDownloadHandlingForSession(partition);
  }

  function shouldApplyImmediateOverride(targetContents?: WebContents | null) {
    if (!targetContents || targetContents.isDestroyed()) {
      return false;
    }

    try {
      const currentUrl = targetContents.getURL();
      return Boolean(currentUrl && currentUrl !== "about:blank");
    } catch {
      return false;
    }
  }

  function ensureContentsDebuggerAttached(targetContents: WebContents) {
    const debuggerHandle = targetContents.debugger;
    if (debuggerHandle.isAttached()) {
      return debuggerHandle;
    }

    try {
      debuggerHandle.attach("1.3");
    } catch (error) {
      if (!debuggerHandle.isAttached()) {
        throw error;
      }
    }

    return debuggerHandle;
  }

  async function runWithTimeout<T>(
    timeoutMs: number,
    task: () => Promise<T>,
    timeoutMessage: string,
  ) {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, timeoutMs);

      task().then(
        (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      );
    });
  }

  async function applyColorSchemeToContents(targetContents?: WebContents | null) {
    if (!targetContents || targetContents.isDestroyed()) {
      return;
    }

    const contentsId = targetContents.id;
    const colorScheme = getResolvedColorScheme();

    try {
      const debuggerHandle = ensureContentsDebuggerAttached(targetContents);
      await runWithTimeout(
        colorSchemeCommandTimeoutMs,
        async () => {
          await debuggerHandle.sendCommand("Emulation.setEmulatedMedia", {
            features: [
              {
                name: "prefers-color-scheme",
                value: colorScheme,
              },
            ],
          });

          if (targetContents.isDestroyed()) {
            return;
          }

          if (!browserColorSchemeScriptIds.has(contentsId)) {
            const result = await debuggerHandle.sendCommand("Page.addScriptToEvaluateOnNewDocument", {
              source: colorSchemeMediaSyncBootstrapScript,
            });
            const identifier =
              typeof result === "object" && result && "identifier" in result
                ? String((result as { identifier: unknown }).identifier)
                : "";
            if (identifier) {
              browserColorSchemeScriptIds.set(contentsId, identifier);
            }
          }
        },
        "Timed out applying emulated media.",
      );

      if (shouldApplyImmediateOverride(targetContents)) {
        void targetContents.executeJavaScript(colorSchemeMediaSyncBootstrapScript, true)
          .then(() => targetContents.executeJavaScript(colorSchemeMediaSyncUpdateScript, true))
          .catch(() => undefined);
        try {
          targetContents.invalidate();
        } catch {
          // Ignore repaint failures on transiently detached contents.
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[Theme] Failed to apply prefers-color-scheme=${colorScheme} for contents ${contentsId}: ${message}`,
      );
    }
  }

  function ensureContentsOverrides(
    targetContents?: WebContents | null,
    _options?: { targetUrl?: string },
  ) {
    if (!targetContents || targetContents.isDestroyed()) {
      return Promise.resolve();
    }

    const contentsId = targetContents.id;
    const existingTask = pendingContentsOverrideTasks.get(contentsId);
    if (existingTask) {
      return existingTask;
    }

    const task = (async () => {
      await applyColorSchemeToContents(targetContents);
    })().finally(() => {
      if (pendingContentsOverrideTasks.get(contentsId) === task) {
        pendingContentsOverrideTasks.delete(contentsId);
      }
    });

    pendingContentsOverrideTasks.set(contentsId, task);
    return task;
  }

  async function syncColorSchemeForAllTabs() {
    await Promise.all(
      [
        ...Array.from(browserViews.values(), (view) => applyColorSchemeToContents(view.webContents)),
        ...getAuxiliaryWebContents().map((targetContents) =>
          applyColorSchemeToContents(targetContents)),
      ],
    );
  }

  return {
    applyColorSchemeToContents,
    applyResolvedUserAgentToContents,
    cleanupManagedContents,
    ensureContentsOverrides,
    ensureDownloadHandlingForPartition,
    registerDownloadHandlingForSession,
    resolveRequestUserAgent,
    setOriginalBrowserUserAgent,
    syncColorSchemeForAllTabs,
  };
}
