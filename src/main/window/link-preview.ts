import {
  BrowserWindow,
  View,
  WebContentsView,
  screen,
  type WebContents,
} from "electron";
import type {
  CreateTabOptions,
  TabRecord,
  ViewBounds,
  WorkspaceRecord,
} from "../shared/contracts.js";

export interface LinkPreviewHoverPayload {
  url: string;
  bounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

interface LinkPreviewState {
  hostView: View | null;
  frameView: WebContentsView | null;
  view: WebContentsView | null;
  sourceTabId: string | null;
  sourceContentsId: number | null;
  hoveredUrl: string | null;
  targetPreviewUrl: string | null;
  previewUrl: string | null;
  hoveredBounds: LinkPreviewHoverPayload["bounds"] | null;
  hoveredTitle: string | null;
  previewMode: "hover" | "manual";
  isVisible: boolean;
  isPointerOverLink: boolean;
  isPointerOverPreview: boolean;
  isMaximizing: boolean;
  isLoadingPreview: boolean;
  loadProgress: number;
  hoveredPreviewContentsIds: Set<number>;
  hideTimer: ReturnType<typeof setTimeout> | null;
  animationTimer: ReturnType<typeof setTimeout> | null;
}

interface LinkPreviewShellStatePayload {
  url: string;
  loading: boolean;
  progress: number;
}

interface LinkPreviewBackdropStatePayload {
  visible: boolean;
}

interface CreateLinkPreviewManagerContext {
  defaultWorkspaceId: string;
  preloadPath: string;
  workspaces: Map<string, WorkspaceRecord>;
  windowToWorkspace: Map<number, string>;
  browserViews: Map<string, WebContentsView>;
  tabRecords: Map<number, Map<string, TabRecord>>;
  windowActiveTabs: Map<number, string>;
  windowSidebarWidths: Map<number, number>;
  windowUrlBarHeights: Map<number, number>;
  buildWorkspacePartition: (profileId: string) => string;
  ensureMiloProtocolForPartition: (partition: string) => void;
  ensureDownloadHandlingForPartition: (partition: string) => void;
  applyResolvedUserAgentToContents: (
    targetContents: WebContents,
    targetUrl?: string,
  ) => void;
  cleanupManagedContents: (contentsId: number) => void;
  clearPageTranslationState: (contentsId: number) => void;
  setupBrowserViewContextMenu: (
    targetWindow: BrowserWindow,
    webContents: WebContents,
  ) => void;
  handleTabCreate: (
    targetWindow: BrowserWindow,
    url?: string,
    options?: CreateTabOptions,
  ) => TabRecord;
  focusActiveTabContents: (targetWindow: BrowserWindow) => void;
  getWindowMainContentBounds: (
    targetWindow: BrowserWindow,
    sidebarWidth: number,
    urlBarHeight: number,
    devToolsHeight?: number,
  ) => ViewBounds | null;
  ensureContentsOverrides: (
    targetContents: WebContents,
    options?: { targetUrl?: string },
  ) => Promise<unknown>;
  getSearchOverlayBounds: (windowId: number) => ViewBounds;
  isSearchOverlayVisible: () => boolean;
  getSearchOverlayView: () => WebContentsView | null;
}

const LINK_PREVIEW_HIDE_DELAY_MS = 2000;
const LINK_PREVIEW_ANIMATION_MS = 220;
const LINK_PREVIEW_MIN_WIDTH = 480;
const LINK_PREVIEW_MIN_HEIGHT = 300;
const LINK_PREVIEW_MARGIN = 16;
const LINK_PREVIEW_GAP = 14;
const LINK_PREVIEW_RADIUS = 18;
const LINK_PREVIEW_GLOW_INSET = 14;
const LINK_PREVIEW_CONTENT_INSET = 4;
const LINK_PREVIEW_TOP_BAR_HEIGHT = 28;
const LINK_PREVIEW_TOP_BAR_TOP_INSET = 8;
const LINK_PREVIEW_TOP_BAR_HORIZONTAL_INSET = 10;
const LINK_PREVIEW_PROGRESS_BAR_HEIGHT = 3;
const LINK_PREVIEW_PROGRESS_BAR_GAP = 6;
const LINK_PREVIEW_CONTENT_TOP_INSET =
  LINK_PREVIEW_TOP_BAR_TOP_INSET
  + LINK_PREVIEW_TOP_BAR_HEIGHT
  + LINK_PREVIEW_PROGRESS_BAR_GAP
  + LINK_PREVIEW_PROGRESS_BAR_HEIGHT
  + 10;
const LINK_PREVIEW_WINDOW_RATIO = 0.58;

function buildLinkPreviewShellMarkup() {
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <style>
        :root {
          color-scheme: light dark;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        * {
          box-sizing: border-box;
        }

        html, body {
          margin: 0;
          width: 100%;
          height: 100%;
          overflow: hidden;
          background: transparent;
        }

        body {
          padding: ${LINK_PREVIEW_GLOW_INSET}px;
        }

        .shell {
          position: relative;
          width: 100%;
          height: 100%;
          border-radius: ${LINK_PREVIEW_RADIUS}px;
          border: 0;
          background: rgba(15, 23, 42, 0.5);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
          box-shadow:
            0 0 30px 8px rgba(56, 189, 248, 0.22),
            0 0 72px 16px rgba(59, 130, 246, 0.14),
            0 24px 58px rgba(2, 6, 23, 0.32);
          overflow: hidden;
        }

        .topbar {
          position: absolute;
          top: ${LINK_PREVIEW_TOP_BAR_TOP_INSET}px;
          left: ${LINK_PREVIEW_TOP_BAR_HORIZONTAL_INSET}px;
          right: ${LINK_PREVIEW_TOP_BAR_HORIZONTAL_INSET}px;
          height: ${LINK_PREVIEW_TOP_BAR_HEIGHT}px;
          display: flex;
          gap: 8px;
          z-index: 2;
        }

        .urlbar {
          flex: 1;
          display: flex;
          align-items: center;
          min-width: 0;
          border-radius: 999px;
          background: rgba(15, 23, 42, 0.42);
          border: 1px solid rgba(255, 255, 255, 0.14);
          overflow: hidden;
        }

        .urlbar input {
          flex: 1;
          min-width: 0;
          height: 100%;
          padding: 0 12px;
          border: 0;
          background: transparent;
          color: rgba(248, 250, 252, 0.92);
          font: 500 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          outline: none;
        }

        .urlbar button,
        .action-button {
          all: unset;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          cursor: pointer;
          color: rgba(248, 250, 252, 0.9);
          transition:
            background-color 140ms ease,
            border-color 140ms ease,
            color 140ms ease,
            opacity 140ms ease;
        }

        .action-button {
          border-radius: 999px;
          background: rgba(15, 23, 42, 0.42);
          border: 1px solid rgba(255, 255, 255, 0.14);
        }

        .urlbar button:disabled,
        .action-button:disabled {
          cursor: default;
          opacity: 0.45;
        }

        #preview-shell-copy[data-copy-state="ok"] {
          color: rgba(220, 252, 231, 0.98);
          background: rgba(34, 197, 94, 0.22);
        }

        #preview-shell-copy[data-copy-state="err"] {
          color: rgba(254, 226, 226, 0.98);
          background: rgba(239, 68, 68, 0.22);
        }

        .button-icon {
          display: block;
        }

        .button-icon-check {
          display: none;
        }

        #preview-shell-copy[data-copy-state="ok"] .button-icon-copy {
          display: none;
        }

        #preview-shell-copy[data-copy-state="ok"] .button-icon-check {
          display: block;
        }

        .actions {
          display: inline-flex;
          gap: 6px;
        }

        svg {
          width: 13px;
          height: 13px;
          stroke: currentColor;
          fill: none;
          stroke-width: 2;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        .progress {
          position: absolute;
          top: ${LINK_PREVIEW_TOP_BAR_TOP_INSET + LINK_PREVIEW_TOP_BAR_HEIGHT + LINK_PREVIEW_PROGRESS_BAR_GAP}px;
          left: ${LINK_PREVIEW_TOP_BAR_HORIZONTAL_INSET}px;
          right: ${LINK_PREVIEW_TOP_BAR_HORIZONTAL_INSET}px;
          height: ${LINK_PREVIEW_PROGRESS_BAR_HEIGHT}px;
          border-radius: 999px;
          overflow: hidden;
          opacity: 0;
          background: rgba(255, 255, 255, 0.12);
          transition: opacity 140ms ease;
          z-index: 2;
        }

        .progress.visible {
          opacity: 1;
        }

        .progress-bar {
          width: 100%;
          height: 100%;
          transform-origin: left center;
          transform: scaleX(0);
          background: linear-gradient(90deg, rgba(96, 165, 250, 0.95), rgba(34, 197, 94, 0.9));
          transition: transform 140ms ease;
        }

        .loader {
          position: absolute;
          inset: ${LINK_PREVIEW_CONTENT_TOP_INSET}px 0 0 0;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: opacity 140ms ease;
          z-index: 1;
        }

        .loader.hidden {
          opacity: 0;
        }

        .loader-card {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.16);
          background: rgba(15, 23, 42, 0.48);
          color: rgba(248, 250, 252, 0.92);
          font-size: 12px;
          letter-spacing: 0.02em;
        }

        .spinner {
          width: 12px;
          height: 12px;
          border-radius: 999px;
          border: 1.5px solid rgba(255, 255, 255, 0.18);
          border-top-color: rgba(255, 255, 255, 0.92);
          animation: milo-spin 0.85s linear infinite;
        }

        @keyframes milo-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      </style>
    </head>
    <body>
      <div class="shell">
        <div class="topbar">
          <div class="urlbar">
            <input id="preview-shell-url" type="text" readonly spellcheck="false" value="" />
            <button id="preview-shell-copy" type="button" aria-label="Copy URL">
              <svg class="button-icon button-icon-copy" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="9" y="9" width="10" height="10" rx="2" />
                <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" />
              </svg>
              <svg class="button-icon button-icon-check" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </button>
          </div>
          <div class="actions">
            <button class="action-button" id="preview-shell-maximize" type="button" aria-label="Maximize preview">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14 5h5v5" />
                <path d="M19 5l-6 6" />
                <path d="M10 19H5v-5" />
                <path d="M5 19l6-6" />
              </svg>
            </button>
            <button class="action-button" id="preview-shell-close" type="button" aria-label="Close preview">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12" />
                <path d="M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>
        <div class="progress visible" id="preview-shell-progress">
          <div class="progress-bar" id="preview-shell-progress-bar"></div>
        </div>
        <div class="loader" id="preview-shell-loader">
          <div class="loader-card">
            <div class="spinner"></div>
            <span class="loader-label">Loading preview…</span>
          </div>
        </div>
      </div>
    </body>
  </html>`;
}

const LINK_PREVIEW_SHELL_URL = `data:text/html;charset=UTF-8,${encodeURIComponent(
  buildLinkPreviewShellMarkup(),
)}`;

function createInitialLinkPreviewState(): LinkPreviewState {
  return {
    hostView: null,
    frameView: null,
    view: null,
    sourceTabId: null,
    sourceContentsId: null,
    hoveredUrl: null,
    targetPreviewUrl: null,
    previewUrl: null,
    hoveredBounds: null,
    hoveredTitle: null,
    previewMode: "hover",
    isVisible: false,
    isPointerOverLink: false,
    isPointerOverPreview: false,
    isMaximizing: false,
    isLoadingPreview: false,
    loadProgress: 0,
    hoveredPreviewContentsIds: new Set<number>(),
    hideTimer: null,
    animationTimer: null,
  };
}

function clampValue(value: number, min: number, max: number) {
  if (max < min) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function isPointInsideBounds(point: { x: number; y: number }, bounds: ViewBounds) {
  return (
    point.x >= bounds.x
    && point.y >= bounds.y
    && point.x <= bounds.x + bounds.width
    && point.y <= bounds.y + bounds.height
  );
}

function interpolateBounds(from: ViewBounds, to: ViewBounds, progress: number): ViewBounds {
  return {
    x: Math.round(from.x + (to.x - from.x) * progress),
    y: Math.round(from.y + (to.y - from.y) * progress),
    width: Math.round(from.width + (to.width - from.width) * progress),
    height: Math.round(from.height + (to.height - from.height) * progress),
  };
}

export function createLinkPreviewManager(context: CreateLinkPreviewManagerContext) {
  const {
    defaultWorkspaceId,
    preloadPath,
    workspaces,
    windowToWorkspace,
    browserViews,
    tabRecords,
    windowActiveTabs,
    windowSidebarWidths,
    windowUrlBarHeights,
    buildWorkspacePartition,
    ensureMiloProtocolForPartition,
    ensureDownloadHandlingForPartition,
    applyResolvedUserAgentToContents,
    cleanupManagedContents,
    clearPageTranslationState,
    setupBrowserViewContextMenu,
    handleTabCreate,
    focusActiveTabContents,
    getWindowMainContentBounds,
    ensureContentsOverrides,
    getSearchOverlayBounds,
    isSearchOverlayVisible,
    getSearchOverlayView,
  } = context;

  const linkPreviewStates = new Map<number, LinkPreviewState>();

  function getLinkPreviewState(windowId: number) {
    let state = linkPreviewStates.get(windowId);
    if (!state) {
      state = createInitialLinkPreviewState();
      linkPreviewStates.set(windowId, state);
    }

    return state;
  }

  function clearLinkPreviewHideTimer(state: LinkPreviewState) {
    if (state.hideTimer) {
      clearTimeout(state.hideTimer);
      state.hideTimer = null;
    }
  }

  function clearLinkPreviewAnimationTimer(state: LinkPreviewState) {
    if (state.animationTimer) {
      clearTimeout(state.animationTimer);
      state.animationTimer = null;
    }
  }

  function findWindowTabByContentsId(contentsId: number) {
    for (const [windowId, tabs] of tabRecords.entries()) {
      for (const [tabId, tab] of tabs.entries()) {
        const view = browserViews.get(tabId);
        if (view?.webContents.id !== contentsId) {
          continue;
        }

        const targetWindow = BrowserWindow.fromId(windowId);
        if (!targetWindow || targetWindow.isDestroyed()) {
          return null;
        }

        return {
          targetWindow,
          tabId,
          tab,
        };
      }
    }

    return null;
  }

  function findLinkPreviewStateByContentsId(contentsId: number) {
    for (const [windowId, state] of linkPreviewStates.entries()) {
      if (
        state.view?.webContents.id === contentsId
        || state.frameView?.webContents.id === contentsId
      ) {
        return {
          windowId,
          state,
        };
      }
    }

    return null;
  }

  function getCursorPointInContent(targetWindow: BrowserWindow) {
    const contentBounds = targetWindow.getContentBounds();
    const cursorPoint = screen.getCursorScreenPoint();
    const point = {
      x: cursorPoint.x - contentBounds.x,
      y: cursorPoint.y - contentBounds.y,
    };

    if (
      point.x < 0
      || point.y < 0
      || point.x > contentBounds.width
      || point.y > contentBounds.height
    ) {
      return null;
    }

    return point;
  }

  function getActiveTabContentBounds(targetWindow: BrowserWindow): ViewBounds | null {
    const activeTabId = windowActiveTabs.get(targetWindow.id);
    const activeView = activeTabId ? browserViews.get(activeTabId) : undefined;
    if (activeView) {
      return activeView.getBounds();
    }

    const sidebarWidth = windowSidebarWidths.get(targetWindow.id) ?? 0;
    const urlBarHeight = windowUrlBarHeights.get(targetWindow.id) ?? 88;
    return getWindowMainContentBounds(targetWindow, sidebarWidth, urlBarHeight);
  }

  function isCursorInsideLinkHoverBounds(targetWindow: BrowserWindow, state: LinkPreviewState) {
    if (!state.hoveredBounds || !state.sourceTabId) {
      return false;
    }

    if (windowActiveTabs.get(targetWindow.id) !== state.sourceTabId) {
      return false;
    }

    const pointer = getCursorPointInContent(targetWindow);
    const contentBounds = getActiveTabContentBounds(targetWindow);
    if (!pointer || !contentBounds) {
      return false;
    }

    return isPointInsideBounds(pointer, {
      x: contentBounds.x + state.hoveredBounds.left,
      y: contentBounds.y + state.hoveredBounds.top,
      width: state.hoveredBounds.width,
      height: state.hoveredBounds.height,
    });
  }

  function isCursorInsidePreviewBounds(targetWindow: BrowserWindow, state: LinkPreviewState) {
    const pointer = getCursorPointInContent(targetWindow);
    const hostBounds = state.hostView?.getBounds();
    if (!pointer || !hostBounds) {
      return false;
    }

    return isPointInsideBounds(pointer, hostBounds);
  }

  function computeLinkPreviewBounds(
    targetWindow: BrowserWindow,
    state: LinkPreviewState,
  ): ViewBounds | null {
    const contentBounds = getActiveTabContentBounds(targetWindow);
    const hoveredBounds = state.hoveredBounds;
    if (!contentBounds || !hoveredBounds) {
      return null;
    }

    const windowBounds = targetWindow.getContentBounds();
    const preferredWidth = Math.max(
      LINK_PREVIEW_MIN_WIDTH,
      Math.round(windowBounds.width * LINK_PREVIEW_WINDOW_RATIO),
    );
    const previewWidth = Math.min(
      Math.max(1, contentBounds.width - LINK_PREVIEW_MARGIN * 2),
      preferredWidth,
    );

    const preferredHeight = Math.max(
      LINK_PREVIEW_MIN_HEIGHT,
      Math.round(windowBounds.height * LINK_PREVIEW_WINDOW_RATIO),
    );
    const previewHeight = Math.min(
      Math.max(1, contentBounds.height - LINK_PREVIEW_MARGIN * 2),
      preferredHeight,
    );

    const hoveredLeft = contentBounds.x + hoveredBounds.left;
    const hoveredTop = contentBounds.y + hoveredBounds.top;
    const hoveredRight = hoveredLeft + hoveredBounds.width;
    const hoveredBottom = hoveredTop + hoveredBounds.height;
    const minX = contentBounds.x + LINK_PREVIEW_MARGIN;
    const maxX = contentBounds.x + contentBounds.width - previewWidth - LINK_PREVIEW_MARGIN;
    const minY = contentBounds.y + LINK_PREVIEW_MARGIN;
    const maxY = contentBounds.y + contentBounds.height - previewHeight - LINK_PREVIEW_MARGIN;

    let x = hoveredLeft + Math.min(hoveredBounds.width, 64);
    if (x > maxX) {
      x = hoveredRight - previewWidth;
    }

    let y = hoveredBottom + LINK_PREVIEW_GAP;
    if (y > maxY) {
      y = hoveredTop - previewHeight - LINK_PREVIEW_GAP;
    }

    return {
      x: Math.round(clampValue(x, minX, maxX)),
      y: Math.round(clampValue(y, minY, maxY)),
      width: previewWidth,
      height: previewHeight,
    };
  }

  function resolveLinkPreviewUrl(state: LinkPreviewState) {
    if (state.isLoadingPreview && state.targetPreviewUrl) {
      return state.targetPreviewUrl;
    }

    const currentUrl = state.view && !state.view.webContents.isDestroyed()
      ? state.view.webContents.getURL()
      : "";
    return currentUrl || state.previewUrl || state.targetPreviewUrl || state.hoveredUrl || "";
  }

  function buildLinkPreviewShellState(state: LinkPreviewState): LinkPreviewShellStatePayload {
    return {
      url: resolveLinkPreviewUrl(state),
      loading: state.isLoadingPreview,
      progress: clampValue(state.loadProgress, 0, 1),
    };
  }

  function syncLinkPreviewShellState(windowId: number) {
    const state = linkPreviewStates.get(windowId);
    const frameContents = state?.frameView?.webContents;
    if (!state || !frameContents || frameContents.isDestroyed()) {
      return;
    }

    try {
      frameContents.send("link-preview:shell-state", buildLinkPreviewShellState(state));
    } catch {
      // Ignore transient failures before the shell renderer is ready.
    }
  }

  function syncLinkPreviewBackdropState(state: LinkPreviewState, visible: boolean) {
    const sourceTabId = state.sourceTabId;
    if (!sourceTabId) {
      return;
    }

    const sourceContents = browserViews.get(sourceTabId)?.webContents;
    if (!sourceContents || sourceContents.isDestroyed()) {
      return;
    }

    if (state.sourceContentsId !== null && sourceContents.id !== state.sourceContentsId) {
      return;
    }

    const payload: LinkPreviewBackdropStatePayload = { visible };
    try {
      sourceContents.send("link-preview:backdrop-state", payload);
    } catch {
      // Ignore transient failures while the source tab is navigating or closing.
    }
  }

  function computeLinkPreviewContentBounds(shellBounds: ViewBounds): ViewBounds {
    const horizontalInset = Math.min(
      LINK_PREVIEW_CONTENT_INSET,
      Math.max(0, Math.floor(shellBounds.width / 4)),
    );
    const verticalInset = Math.min(
      LINK_PREVIEW_CONTENT_INSET,
      Math.max(0, Math.floor(shellBounds.height / 4)),
    );
    const topInset = Math.min(
      Math.max(verticalInset, LINK_PREVIEW_CONTENT_TOP_INSET),
      Math.max(verticalInset, shellBounds.height - verticalInset - 1),
    );

    return {
      x: horizontalInset,
      y: topInset,
      width: Math.max(1, shellBounds.width - horizontalInset * 2),
      height: Math.max(1, shellBounds.height - topInset - verticalInset),
    };
  }

  function expandLinkPreviewHostBounds(shellBounds: ViewBounds): ViewBounds {
    return {
      x: shellBounds.x - LINK_PREVIEW_GLOW_INSET,
      y: shellBounds.y - LINK_PREVIEW_GLOW_INSET,
      width: shellBounds.width + LINK_PREVIEW_GLOW_INSET * 2,
      height: shellBounds.height + LINK_PREVIEW_GLOW_INSET * 2,
    };
  }

  function contractLinkPreviewHostBounds(hostBounds: ViewBounds): ViewBounds {
    return {
      x: hostBounds.x + LINK_PREVIEW_GLOW_INSET,
      y: hostBounds.y + LINK_PREVIEW_GLOW_INSET,
      width: Math.max(1, hostBounds.width - LINK_PREVIEW_GLOW_INSET * 2),
      height: Math.max(1, hostBounds.height - LINK_PREVIEW_GLOW_INSET * 2),
    };
  }

  function applyLinkPreviewBounds(state: LinkPreviewState, shellBounds: ViewBounds) {
    const hostBounds = expandLinkPreviewHostBounds(shellBounds);
    state.hostView?.setBounds(hostBounds);
    state.hostView?.setBorderRadius(LINK_PREVIEW_RADIUS + LINK_PREVIEW_GLOW_INSET);

    const shellChildBounds: ViewBounds = {
      x: 0,
      y: 0,
      width: hostBounds.width,
      height: hostBounds.height,
    };

    const previewContentBounds = computeLinkPreviewContentBounds(shellBounds);
    state.frameView?.setBounds(shellChildBounds);
    state.frameView?.setBorderRadius(LINK_PREVIEW_RADIUS + LINK_PREVIEW_GLOW_INSET);
    state.view?.setBounds({
      x: LINK_PREVIEW_GLOW_INSET + previewContentBounds.x,
      y: LINK_PREVIEW_GLOW_INSET + previewContentBounds.y,
      width: previewContentBounds.width,
      height: previewContentBounds.height,
    });
    state.view?.setBorderRadius(Math.max(0, LINK_PREVIEW_RADIUS - 2));
  }

  function closeLinkPreviewView(view: WebContentsView | null) {
    if (!view) {
      return;
    }

    const { webContents } = view;
    if (!webContents.isDestroyed()) {
      cleanupManagedContents(webContents.id);
      webContents.close();
    }
  }

  function detachLinkPreviewContainerView(targetWindow: BrowserWindow | null, hostView: View | null) {
    if (!targetWindow || targetWindow.isDestroyed() || !hostView) {
      return;
    }

    try {
      targetWindow.contentView.removeChildView(hostView);
    } catch {
      // Ignore when the preview host view is already detached.
    }
  }

  function destroyLinkPreview(
    windowId: number,
    options?: {
      preserveHoverState?: boolean;
      focusActiveTab?: boolean;
    },
  ) {
    const state = linkPreviewStates.get(windowId);
    if (!state) {
      return;
    }

    clearLinkPreviewHideTimer(state);
    clearLinkPreviewAnimationTimer(state);

    const targetWindow = BrowserWindow.fromId(windowId);
    syncLinkPreviewBackdropState(state, false);

    if (state.hostView && state.frameView) {
      try {
        state.hostView.removeChildView(state.frameView);
      } catch {
        // Ignore when the preview shell view is already detached.
      }
    }

    if (state.hostView && state.view) {
      try {
        state.hostView.removeChildView(state.view);
      } catch {
        // Ignore when the preview content view is already detached.
      }
    }

    detachLinkPreviewContainerView(targetWindow, state.hostView);
    closeLinkPreviewView(state.view);
    closeLinkPreviewView(state.frameView);

    state.hostView = null;
    state.frameView = null;
    state.view = null;
    state.targetPreviewUrl = null;
    state.previewUrl = null;
    state.hoveredTitle = null;
    state.previewMode = "hover";
    state.isVisible = false;
    state.hoveredPreviewContentsIds.clear();
    state.isPointerOverPreview = false;
    state.isMaximizing = false;
    state.isLoadingPreview = false;
    state.loadProgress = 0;

    if (!options?.preserveHoverState) {
      state.sourceTabId = null;
      state.sourceContentsId = null;
      state.hoveredUrl = null;
      state.hoveredBounds = null;
      state.isPointerOverLink = false;
    }

    if (options?.focusActiveTab && targetWindow && !targetWindow.isDestroyed()) {
      focusActiveTabContents(targetWindow);
    }
  }

  function takeLinkPreviewViewForTab(windowId: number) {
    const state = linkPreviewStates.get(windowId);
    if (!state?.view) {
      return null;
    }

    clearLinkPreviewHideTimer(state);
    clearLinkPreviewAnimationTimer(state);

    const targetWindow = BrowserWindow.fromId(windowId);
    const previewView = state.view;
    const frameView = state.frameView;
    syncLinkPreviewBackdropState(state, false);

    if (state.hostView && frameView) {
      try {
        state.hostView.removeChildView(frameView);
      } catch {
        // Ignore when the preview shell view is already detached.
      }
    }

    if (state.hostView) {
      try {
        state.hostView.removeChildView(previewView);
      } catch {
        // Ignore when the preview content view is already detached.
      }
    }

    detachLinkPreviewContainerView(targetWindow, state.hostView);
    closeLinkPreviewView(frameView);

    state.hostView = null;
    state.frameView = null;
    state.view = null;
    state.sourceTabId = null;
    state.sourceContentsId = null;
    state.hoveredUrl = null;
    state.targetPreviewUrl = null;
    state.previewUrl = null;
    state.hoveredBounds = null;
    state.hoveredTitle = null;
    state.previewMode = "hover";
    state.isVisible = false;
    state.isPointerOverLink = false;
    state.isPointerOverPreview = false;
    state.isMaximizing = false;
    state.isLoadingPreview = false;
    state.loadProgress = 0;
    state.hoveredPreviewContentsIds.clear();

    return previewView;
  }

  function cleanupLinkPreviewState(windowId: number) {
    destroyLinkPreview(windowId);
    linkPreviewStates.delete(windowId);
  }

  function scheduleLinkPreviewHide(windowId: number) {
    const state = linkPreviewStates.get(windowId);
    if (state?.previewMode === "manual") {
      return;
    }
    if (!state || state.isMaximizing || state.isPointerOverLink || state.isPointerOverPreview) {
      return;
    }

    clearLinkPreviewHideTimer(state);
    state.hideTimer = setTimeout(() => {
      const latestState = linkPreviewStates.get(windowId);
      const targetWindow = BrowserWindow.fromId(windowId);
      if (!latestState || !targetWindow || targetWindow.isDestroyed()) {
        return;
      }

      if (isCursorInsideLinkHoverBounds(targetWindow, latestState)) {
        latestState.isPointerOverLink = true;
      }

      if (isCursorInsidePreviewBounds(targetWindow, latestState)) {
        latestState.isPointerOverPreview = true;
      }

      if (latestState.isPointerOverLink || latestState.isPointerOverPreview) {
        return;
      }

      destroyLinkPreview(windowId, { focusActiveTab: true });
    }, LINK_PREVIEW_HIDE_DELAY_MS);
  }

  function updateLinkPreviewBounds(targetWindow: BrowserWindow) {
    const state = linkPreviewStates.get(targetWindow.id);
    if (!state?.view || !state.frameView || !state.hostView || !state.isVisible || state.isMaximizing) {
      return;
    }

    const nextBounds = computeLinkPreviewBounds(targetWindow, state);
    if (!nextBounds) {
      return;
    }

    applyLinkPreviewBounds(state, nextBounds);
  }

  function revealLinkPreviewAfterLoad(windowId: number, contentsId: number) {
    const targetWindow = BrowserWindow.fromId(windowId);
    const state = linkPreviewStates.get(windowId);
    if (
      !targetWindow
      || targetWindow.isDestroyed()
      || !state
      || !state.view
      || !state.frameView
      || !state.hostView
      || state.view.webContents.id !== contentsId
      || !state.isVisible
      || state.isLoadingPreview
    ) {
      return;
    }

    if (!state.targetPreviewUrl || !state.sourceTabId) {
      return;
    }

    const isManualPreview = state.previewMode === "manual";
    if (windowActiveTabs.get(windowId) !== state.sourceTabId) {
      return;
    }

    if (!isManualPreview) {
      if (!state.isPointerOverLink && isCursorInsideLinkHoverBounds(targetWindow, state)) {
        state.isPointerOverLink = true;
      }

      if (!state.isPointerOverLink) {
        return;
      }
    }

    const nextBounds = computeLinkPreviewBounds(targetWindow, state);
    if (!nextBounds) {
      return;
    }

    applyLinkPreviewBounds(state, nextBounds);
    state.view.setVisible(true);
    clearLinkPreviewHideTimer(state);
  }

  function createLinkPreviewView(targetWindow: BrowserWindow, state: LinkPreviewState) {
    const workspaceId = windowToWorkspace.get(targetWindow.id) ?? defaultWorkspaceId;
    const workspace = workspaces.get(workspaceId);
    const partition = buildWorkspacePartition(workspace?.profileId ?? defaultWorkspaceId);

    ensureMiloProtocolForPartition(partition);
    ensureDownloadHandlingForPartition(partition);

    const hostView = new View();
    const frameView = new WebContentsView({
      webPreferences: {
        preload: preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        partition,
        additionalArguments: ["--milo-link-preview-shell=1"],
      },
    });
    const previewView = new WebContentsView({
      webPreferences: {
        preload: preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
        sandbox: true,
        webSecurity: true,
        partition,
        additionalArguments: [
          "--milo-tab-view=1",
          "--milo-link-preview=1",
        ],
      },
    });

    hostView.setBackgroundColor("#00000000");
    hostView.setBorderRadius(LINK_PREVIEW_RADIUS);
    frameView.setBackgroundColor("#00000000");
    frameView.setBorderRadius(LINK_PREVIEW_RADIUS);
    previewView.setBackgroundColor("#0b1120");
    previewView.setBorderRadius(Math.max(0, LINK_PREVIEW_RADIUS - 2));

    const contents = previewView.webContents;
    const contentsId = contents.id;
    const frameContents = frameView.webContents;

    applyResolvedUserAgentToContents(frameContents, LINK_PREVIEW_SHELL_URL);
    frameContents.once("destroyed", () => {
      cleanupManagedContents(frameContents.id);
    });
    frameContents.on("did-finish-load", () => {
      syncLinkPreviewShellState(targetWindow.id);
    });

    applyResolvedUserAgentToContents(contents);
    contents.once("destroyed", () => {
      cleanupManagedContents(contentsId);
    });

    setupBrowserViewContextMenu(targetWindow, contents);
    void frameContents.loadURL(LINK_PREVIEW_SHELL_URL).catch(() => undefined);

    contents.on("page-title-updated", (_event, title) => {
      const latestState = linkPreviewStates.get(targetWindow.id);
      if (latestState?.view?.webContents.id === contentsId) {
        latestState.hoveredTitle = title || latestState.hoveredTitle;
      }
    });

    const syncPreviewUrl = () => {
      const latestState = linkPreviewStates.get(targetWindow.id);
      if (latestState?.view?.webContents.id === contentsId) {
        latestState.previewUrl = contents.getURL() || latestState.previewUrl;
        latestState.hoveredTitle = contents.getTitle() || latestState.hoveredTitle;
        syncLinkPreviewShellState(targetWindow.id);
      }
    };

    const finishPreviewLoading = () => {
      const latestState = linkPreviewStates.get(targetWindow.id);
      if (latestState?.view?.webContents.id === contentsId) {
        latestState.isLoadingPreview = false;
        syncLinkPreviewShellState(targetWindow.id);
      }

      revealLinkPreviewAfterLoad(targetWindow.id, contentsId);
    };

    contents.on("did-start-loading", () => {
      const latestState = linkPreviewStates.get(targetWindow.id);
      if (latestState?.view?.webContents.id === contentsId) {
        latestState.loadProgress = Math.max(latestState.loadProgress, 0.12);
        syncLinkPreviewShellState(targetWindow.id);
      }
    });
    contents.on("did-start-navigation", (_event, url, isInPlace, isMainFrame) => {
      if (!isMainFrame || isInPlace) {
        return;
      }

      applyResolvedUserAgentToContents(contents, url);

      const latestState = linkPreviewStates.get(targetWindow.id);
      if (latestState?.view?.webContents.id === contentsId) {
        latestState.targetPreviewUrl = url;
        latestState.isLoadingPreview = true;
        latestState.loadProgress = Math.max(latestState.loadProgress, 0.18);
        latestState.view.setVisible(false);
        syncLinkPreviewShellState(targetWindow.id);
      }

      clearPageTranslationState(contentsId);
      void ensureContentsOverrides(contents, { targetUrl: url });
    });
    contents.on("did-navigate", syncPreviewUrl);
    contents.on("did-navigate-in-page", syncPreviewUrl);
    contents.on("dom-ready", () => {
      const latestState = linkPreviewStates.get(targetWindow.id);
      if (latestState?.view?.webContents.id === contentsId) {
        latestState.loadProgress = Math.max(latestState.loadProgress, 0.72);
        syncLinkPreviewShellState(targetWindow.id);
      }
      syncPreviewUrl();
      finishPreviewLoading();
    });
    contents.on("did-finish-load", () => {
      const latestState = linkPreviewStates.get(targetWindow.id);
      if (latestState?.view?.webContents.id === contentsId) {
        latestState.loadProgress = Math.max(latestState.loadProgress, 0.9);
        syncLinkPreviewShellState(targetWindow.id);
      }
      syncPreviewUrl();
    });
    contents.on("did-stop-loading", () => {
      const latestState = linkPreviewStates.get(targetWindow.id);
      if (latestState?.view?.webContents.id === contentsId) {
        latestState.loadProgress = 1;
        syncLinkPreviewShellState(targetWindow.id);
      }
      syncPreviewUrl();
      finishPreviewLoading();
    });
    contents.on("did-fail-load", (_event, _errorCode, _errorDescription, _validatedURL, isMainFrame) => {
      if (!isMainFrame) {
        return;
      }

      const latestState = linkPreviewStates.get(targetWindow.id);
      if (latestState?.view?.webContents.id === contentsId) {
        latestState.isLoadingPreview = false;
        latestState.loadProgress = 1;
        latestState.view.setVisible(true);
        syncLinkPreviewShellState(targetWindow.id);
      }
    });
    contents.setWindowOpenHandler(({ url }) => {
      handleTabCreate(targetWindow, url);
      return { action: "deny" };
    });

    hostView.addChildView(frameView, 0);
    hostView.addChildView(previewView, 1);
    state.hostView = hostView;
    state.frameView = frameView;
    state.view = previewView;
    return previewView;
  }

  function showLinkPreview(windowId: number) {
    const targetWindow = BrowserWindow.fromId(windowId);
    const state = linkPreviewStates.get(windowId);
    if (!targetWindow || targetWindow.isDestroyed() || !state) {
      return;
    }

    if (!state.hoveredUrl || !state.hoveredBounds || !state.sourceTabId || !state.isPointerOverLink) {
      return;
    }

    if (windowActiveTabs.get(windowId) !== state.sourceTabId) {
      return;
    }

    const requestedUrl = state.hoveredUrl;
    const nextBounds = computeLinkPreviewBounds(targetWindow, state);
    if (!nextBounds) {
      return;
    }

    if (!state.view || state.targetPreviewUrl !== requestedUrl) {
      destroyLinkPreview(windowId, { preserveHoverState: true });
      createLinkPreviewView(targetWindow, state);
    }

    if (!state.view || !state.frameView || !state.hostView) {
      return;
    }

    state.targetPreviewUrl = requestedUrl;
    state.loadProgress = 0.08;
    applyLinkPreviewBounds(state, nextBounds);
    clearLinkPreviewHideTimer(state);
    syncLinkPreviewBackdropState(state, true);

    if (state.isLoadingPreview) {
      return;
    }

    state.view.setVisible(false);
    try {
      targetWindow.contentView.addChildView(state.hostView);
    } catch {
      // Ignore duplicate attach attempts while showing the loading shell.
    }

    state.isVisible = true;
    state.isLoadingPreview = true;
    const loadingContentsId = state.view.webContents.id;
    syncLinkPreviewShellState(windowId);
    void state.view.webContents.loadURL(requestedUrl).catch(() => {
      const latestState = linkPreviewStates.get(windowId);
      if (latestState?.view?.webContents.id === loadingContentsId) {
        latestState.isLoadingPreview = false;
        latestState.loadProgress = 1;
        latestState.view?.setVisible(true);
        syncLinkPreviewShellState(windowId);
      }
    });
  }

  function showManualPreview(
    targetWindow: BrowserWindow,
    sourceContents: WebContents,
    url: string,
    anchor?: { x: number; y: number },
  ) {
    if (targetWindow.isDestroyed() || sourceContents.isDestroyed()) {
      return;
    }

    const activeTabId = windowActiveTabs.get(targetWindow.id);
    if (!activeTabId) {
      return;
    }

    const tab = tabRecords.get(targetWindow.id)?.get(activeTabId);
    const state = getLinkPreviewState(targetWindow.id);
    const sourceTabMatch = findWindowTabByContentsId(sourceContents.id);
    const sourceTabId = sourceTabMatch?.targetWindow.id === targetWindow.id
      ? sourceTabMatch.tabId
      : activeTabId;

    clearLinkPreviewHideTimer(state);
    state.sourceTabId = sourceTabId;
    state.sourceContentsId = sourceContents.id;
    state.hoveredUrl = url;
    state.hoveredBounds = {
      left: Math.max(0, Math.round(anchor?.x ?? 24)),
      top: Math.max(0, Math.round(anchor?.y ?? 24)),
      width: 1,
      height: 1,
    };
    state.hoveredTitle = tab?.title ?? sourceContents.getTitle();
    state.previewMode = "manual";
    state.isPointerOverLink = true;
    state.isPointerOverPreview = true;

    if (
      (state.isVisible || state.isLoadingPreview)
      && state.targetPreviewUrl !== url
    ) {
      destroyLinkPreview(targetWindow.id, { preserveHoverState: true });
      const nextState = getLinkPreviewState(targetWindow.id);
      nextState.sourceTabId = sourceTabId;
      nextState.sourceContentsId = sourceContents.id;
      nextState.hoveredUrl = url;
      nextState.hoveredBounds = state.hoveredBounds;
      nextState.hoveredTitle = state.hoveredTitle;
      nextState.previewMode = "manual";
      nextState.isPointerOverLink = true;
      nextState.isPointerOverPreview = true;
    }

    showLinkPreview(targetWindow.id);
  }

  function clearLinkPreviewForTab(windowId: number, tabId: string) {
    const state = linkPreviewStates.get(windowId);
    if (!state || state.sourceTabId !== tabId) {
      return;
    }

    destroyLinkPreview(windowId);
  }

  function handleLinkPreviewHover(senderContents: WebContents, payload: LinkPreviewHoverPayload) {
    const tabMatch = findWindowTabByContentsId(senderContents.id);
    if (!tabMatch) {
      return;
    }

    const { targetWindow, tabId, tab } = tabMatch;
    if (windowActiveTabs.get(targetWindow.id) !== tabId) {
      return;
    }

    const state = getLinkPreviewState(targetWindow.id);
    const isSameTarget = state.sourceTabId === tabId && state.hoveredUrl === payload.url;

    clearLinkPreviewHideTimer(state);
    state.sourceTabId = tabId;
    state.sourceContentsId = senderContents.id;
    state.hoveredUrl = payload.url;
    state.hoveredBounds = payload.bounds;
    state.hoveredTitle = tab.title;
    state.previewMode = "hover";
    state.isPointerOverLink = true;

    if (
      !isSameTarget
      && (state.isVisible || state.isLoadingPreview)
      && state.targetPreviewUrl !== payload.url
    ) {
      destroyLinkPreview(targetWindow.id, { preserveHoverState: true });
    }

    if (state.isVisible && state.targetPreviewUrl === payload.url) {
      updateLinkPreviewBounds(targetWindow);
      return;
    }

    showLinkPreview(targetWindow.id);
  }

  function handleLinkPreviewHoverLeave(senderContents: WebContents) {
    const tabMatch = findWindowTabByContentsId(senderContents.id);
    if (!tabMatch) {
      return;
    }

    const state = linkPreviewStates.get(tabMatch.targetWindow.id);
    if (!state || state.sourceContentsId !== senderContents.id) {
      return;
    }

    state.isPointerOverLink = false;
    scheduleLinkPreviewHide(tabMatch.targetWindow.id);
  }

  function handleLinkPreviewPointerState(senderContents: WebContents, isPointerInside: boolean) {
    const previewMatch = findLinkPreviewStateByContentsId(senderContents.id);
    if (!previewMatch) {
      return;
    }

    const { windowId, state } = previewMatch;
    if (isPointerInside) {
      state.hoveredPreviewContentsIds.add(senderContents.id);
    } else {
      state.hoveredPreviewContentsIds.delete(senderContents.id);
    }
    state.isPointerOverPreview = state.hoveredPreviewContentsIds.size > 0;

    if (isPointerInside) {
      clearLinkPreviewHideTimer(state);
      return;
    }

    scheduleLinkPreviewHide(windowId);
  }

  function handleLinkPreviewMaximize(senderContents: WebContents) {
    const previewMatch = findLinkPreviewStateByContentsId(senderContents.id);
    if (!previewMatch) {
      return;
    }

    const { windowId, state } = previewMatch;
    const targetWindow = BrowserWindow.fromId(windowId);
    if (
      !targetWindow
      || targetWindow.isDestroyed()
      || !state.view
      || !state.frameView
      || !state.hostView
      || state.isMaximizing
    ) {
      return;
    }

    const fromBounds = contractLinkPreviewHostBounds(state.hostView.getBounds());
    const toBounds = getActiveTabContentBounds(targetWindow);
    const targetUrl = resolveLinkPreviewUrl(state);
    if (!toBounds || !targetUrl) {
      destroyLinkPreview(windowId, { focusActiveTab: true });
      return;
    }

    clearLinkPreviewHideTimer(state);
    clearLinkPreviewAnimationTimer(state);
    state.isMaximizing = true;
    state.isPointerOverLink = false;
    state.isPointerOverPreview = true;

    const startTime = Date.now();
    const animate = () => {
      const latestState = linkPreviewStates.get(windowId);
      if (
        !latestState?.view
        || !latestState.frameView
        || (
          latestState.view.webContents.id !== senderContents.id
          && latestState.frameView.webContents.id !== senderContents.id
        )
      ) {
        return;
      }

      const elapsed = Date.now() - startTime;
      const progress = Math.min(1, elapsed / LINK_PREVIEW_ANIMATION_MS);
      const easedProgress = 1 - (1 - progress) ** 3;
      applyLinkPreviewBounds(
        latestState,
        interpolateBounds(fromBounds, toBounds, easedProgress),
      );

      if (progress >= 1) {
        latestState.animationTimer = null;
        const promotedView = takeLinkPreviewViewForTab(windowId);
        if (!promotedView) {
          destroyLinkPreview(windowId);
          return;
        }

        try {
          handleTabCreate(targetWindow, targetUrl, {
            existingView: promotedView,
            preserveRawUrl: true,
          });
        } catch (error) {
          console.warn("[LinkPreview] Failed to promote preview view into a tab.", error);
          closeLinkPreviewView(promotedView);
        }
        return;
      }

      latestState.animationTimer = setTimeout(animate, 16);
    };

    animate();
  }

  function handleLinkPreviewClose(senderContents: WebContents) {
    const previewMatch = findLinkPreviewStateByContentsId(senderContents.id);
    if (!previewMatch) {
      return;
    }

    destroyLinkPreview(previewMatch.windowId, { focusActiveTab: true });
  }

  function getManagedWebContents() {
    const managedContents: WebContents[] = [];

    for (const state of linkPreviewStates.values()) {
      const previewContents = state.view?.webContents;
      if (previewContents && !previewContents.isDestroyed()) {
        managedContents.push(previewContents);
      }

      const frameContents = state.frameView?.webContents;
      if (frameContents && !frameContents.isDestroyed()) {
        managedContents.push(frameContents);
      }
    }

    return managedContents;
  }

  function updateWindowOverlayBounds(targetWindow: BrowserWindow) {
    if (!isSearchOverlayVisible()) {
      return;
    }

    const searchOverlayView = getSearchOverlayView();
    if (searchOverlayView) {
      searchOverlayView.setBounds(getSearchOverlayBounds(targetWindow.id));
    }
  }

  return {
    clearLinkPreviewForTab,
    cleanupLinkPreviewState,
    destroyLinkPreview,
    getManagedWebContents,
    handleLinkPreviewClose,
    handleLinkPreviewHover,
    handleLinkPreviewHoverLeave,
    handleLinkPreviewMaximize,
    handleLinkPreviewPointerState,
    showManualPreview,
    updateLinkPreviewBounds,
    updateWindowOverlayBounds,
  };
}
