import { useEffect, useRef } from "react";
import type { WebviewTag } from "electron";
import { cn } from "@/lib/utils";
import type { BrowserTabPatch, BrowserTabState } from "@/types/browser";

type NavigationEvent = Event & { url?: string };
type TitleEvent = Event & { title?: string };
type FaviconEvent = Event & { favicons?: string[] };
type NewWindowEvent = Event & {
  preventDefault?: () => void;
  url?: string;
};

interface BrowserWebviewProps {
  active: boolean;
  onActiveContentsChange?: (targetContentsId: number) => void;
  partition: string;
  tab: BrowserTabState;
  onAttach: (id: string, view: WebviewTag | null) => void;
  onLoadingChange: (id: string, isLoading: boolean) => void;
  onMetaChange: (id: string, patch: BrowserTabPatch) => void;
  onRequestNewTab: (url: string) => void;
}

function isWebviewTag(value: unknown): value is WebviewTag {
  return Boolean(
    value &&
      typeof value === "object" &&
      "loadURL" in value &&
      typeof (value as WebviewTag).loadURL === "function",
  );
}

export function BrowserWebview({
  active,
  onActiveContentsChange,
  partition,
  tab,
  onAttach,
  onLoadingChange,
  onMetaChange,
  onRequestNewTab,
}: BrowserWebviewProps) {
  const webviewRef = useRef<WebviewTag | null>(null);
  const domReadyRef = useRef(false);
  const handlersRef = useRef({
    onActiveContentsChange,
    onLoadingChange,
    onMetaChange,
    onRequestNewTab,
  });

  handlersRef.current = {
    onActiveContentsChange,
    onLoadingChange,
    onMetaChange,
    onRequestNewTab,
  };

  useEffect(() => {
    const view = webviewRef.current;
    if (!view) {
      return;
    }

    const emitActiveContentsChange = () => {
      if (!domReadyRef.current) {
        return;
      }

      try {
        handlersRef.current.onActiveContentsChange?.(view.getWebContentsId());
      } catch {
        // The view can be detached during StrictMode remounts; ignore transient failures.
      }
    };

    const syncNavigationState = () => {
      handlersRef.current.onMetaChange(tab.id, {
        canGoBack: view.canGoBack(),
        canGoForward: view.canGoForward(),
        title: view.getTitle() || tab.title,
        url: view.getURL() || tab.url,
      });

      if (active) {
        emitActiveContentsChange();
      }
    };

    const handleDidStartLoading = () => {
      handlersRef.current.onLoadingChange(tab.id, true);
      syncNavigationState();
    };

    const handleDidStopLoading = () => {
      handlersRef.current.onLoadingChange(tab.id, false);
      syncNavigationState();
    };

    const handleNavigate = (event: NavigationEvent) => {
      handlersRef.current.onMetaChange(tab.id, {
        canGoBack: view.canGoBack(),
        canGoForward: view.canGoForward(),
        url: event.url ?? view.getURL(),
      });
    };

    const handleTitleUpdate = (event: TitleEvent) => {
      handlersRef.current.onMetaChange(tab.id, {
        title: event.title ?? view.getTitle(),
      });
    };

    const handleFaviconUpdate = (event: FaviconEvent) => {
      handlersRef.current.onMetaChange(tab.id, {
        favicon: event.favicons?.[0],
      });
    };

    const handleOpenInNewWindow = (event: NewWindowEvent) => {
      event.preventDefault?.();
      if (event.url) {
        handlersRef.current.onRequestNewTab(event.url);
      }
    };

    const handleDomReady = () => {
      domReadyRef.current = true;
      syncNavigationState();
    };

    view.addEventListener("did-start-loading", handleDidStartLoading);
    view.addEventListener("did-stop-loading", handleDidStopLoading);
    view.addEventListener("did-navigate", handleNavigate);
    view.addEventListener("did-navigate-in-page", handleNavigate);
    view.addEventListener("page-title-updated", handleTitleUpdate);
    view.addEventListener("page-favicon-updated", handleFaviconUpdate);
    view.addEventListener("new-window", handleOpenInNewWindow);
    view.addEventListener("dom-ready", handleDomReady);

    return () => {
      view.removeEventListener("did-start-loading", handleDidStartLoading);
      view.removeEventListener("did-stop-loading", handleDidStopLoading);
      view.removeEventListener("did-navigate", handleNavigate);
      view.removeEventListener("did-navigate-in-page", handleNavigate);
      view.removeEventListener("page-title-updated", handleTitleUpdate);
      view.removeEventListener("page-favicon-updated", handleFaviconUpdate);
      view.removeEventListener("new-window", handleOpenInNewWindow);
      view.removeEventListener("dom-ready", handleDomReady);
    };
  }, [active, tab.id, tab.title, tab.url]);

  useEffect(() => {
    const view = webviewRef.current;
    if (!view || !active || !domReadyRef.current) {
      return;
    }

    try {
      handlersRef.current.onActiveContentsChange?.(view.getWebContentsId());
    } catch {
      // Ignore transient detach timing while the webview remounts.
    }
  }, [active, tab.id]);

  return (
    <div className={cn("absolute inset-0", active ? "block" : "hidden")}>
      <webview
        ref={(node) => {
          const view = isWebviewTag(node) ? node : null;
          if (webviewRef.current !== view) {
            domReadyRef.current = false;
          }
          if (view) {
            view.setAttribute("allowpopups", "true");
          }
          webviewRef.current = view;
          onAttach(tab.id, view);
        }}
        className="h-full w-full"
        partition={partition}
        src={tab.url}
      />
    </div>
  );
}
