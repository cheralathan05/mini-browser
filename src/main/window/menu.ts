import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  type MenuItemConstructorOptions,
  type WebContents,
  type WebFrameMain,
} from "electron";
import { APP_MENU_PAGE_DEFINITIONS, APP_MENU_PAGE_GROUPS } from "../shared/app-menu-pages.js";

type DevToolsDockMode = "detach" | "left" | "right" | "bottom" | "undocked";
type RenderableSelectionFormat = "html" | "markdown";

interface MenuManagerContext {
  searchBaseUrl: string;
  handleTabCreate: (targetWindow: BrowserWindow, url: string) => unknown;
  handleAddPageToDock: (webContents: WebContents) => unknown;
  isStartPageUrl?: (url: string) => boolean;
  openNewWindow: () => void;
  openMenuPage: (pageEntry: string, pageUrl: string) => void;
  openSettings: () => void;
  openDownloads: () => void;
  openExtensions: () => void;
  defaultDevToolsDockMode?: DevToolsDockMode;
  getLanguage?: () => string;
  getPageTranslationState?: (webContents: WebContents) => {
    supported: boolean;
    busy: boolean;
    translated: boolean;
  };
  handlePageTranslationToggle?: (
    targetWindow: BrowserWindow,
    webContents: WebContents,
  ) => unknown;
  handleSelectedTextTranslation?: (
    targetWindow: BrowserWindow,
    webContents: WebContents,
    selectedText: string,
    anchor?: { x: number; y: number },
  ) => unknown;
  handleSelectionRender?: (
    targetWindow: BrowserWindow,
    webContents: WebContents,
    input: {
      anchor: { x: number; y: number };
      content: string;
      destination: "preview" | "window";
      format: RenderableSelectionFormat;
    },
  ) => unknown;
  getDefaultDownloadDirectory: () => string;
  handleImageSave: (
    targetWindow: BrowserWindow,
    webContents: WebContents,
    imageUrl: string,
    directory: string,
    point: { x: number; y: number },
    frame?: WebFrameMain | null,
  ) => Promise<unknown> | unknown;
  getAgentInteractionBlacklistDomains?: () => string[];
  setAgentInteractionBlacklistDomains?: (domains: string[]) => unknown;
}

type MenuLocale = "en-US" | "zh-CN";

const menuLocaleText: Record<
  MenuLocale,
  {
    addToDictionary: string;
    aboutApp: (appName: string) => string;
    services: string;
    hideApp: (appName: string) => string;
    hideOthers: string;
    showAll: string;
    quitApp: (appName: string) => string;
    file: string;
    newWindow: string;
    closeWindow: string;
    edit: string;
    undo: string;
    redo: string;
    cut: string;
    copy: string;
    paste: string;
    pasteAndMatchStyle: string;
    delete: string;
    selectAll: string;
    speech: string;
    startSpeaking: string;
    stopSpeaking: string;
    view: string;
    openDownloads: string;
    openExtensions: string;
    openSettings: string;
    forceReload: string;
    actualSize: string;
    zoomIn: string;
    zoomOut: string;
    toggleFullscreen: string;
    toggleDeveloperTools: string;
    window: string;
    minimize: string;
    zoom: string;
    bringAllToFront: string;
    openLinkInNewTab: string;
    saveImage: string;
    copyImage: string;
    addToDock: string;
    back: string;
    forward: string;
    reload: string;
    captureFullPageScreenshot: string;
    captureFullPageScreenshotFailed: string;
    chooseImageDownloadDirectory: string;
    selectFolder: string;
    saveImageFailed: string;
    translatePage: string;
    translateSelection: string;
    renderSelectionInPreview: (format: RenderableSelectionFormat) => string;
    renderSelectionInNewWindow: (format: RenderableSelectionFormat) => string;
    showOriginal: string;
    translating: string;
    disableAiInteractionForDomain: (domain: string) => string;
    enableAiInteractionForDomain: (domain: string) => string;
    searchFor: (text: string) => string;
    inspect: string;
  }
> = {
  "en-US": {
    addToDictionary: "Add to Dictionary",
    aboutApp: (appName) => `About ${appName}`,
    services: "Services",
    hideApp: (appName) => `Hide ${appName}`,
    hideOthers: "Hide Others",
    showAll: "Show All",
    quitApp: (appName) => `Quit ${appName}`,
    file: "File",
    newWindow: "New Window",
    closeWindow: "Close Window",
    edit: "Edit",
    undo: "Undo",
    redo: "Redo",
    cut: "Cut",
    copy: "Copy",
    paste: "Paste",
    pasteAndMatchStyle: "Paste and Match Style",
    delete: "Delete",
    selectAll: "Select All",
    speech: "Speech",
    startSpeaking: "Start Speaking",
    stopSpeaking: "Stop Speaking",
    view: "View",
    openDownloads: "Downloads",
    openExtensions: "Extensions",
    openSettings: "Settings",
    forceReload: "Force Reload",
    actualSize: "Actual Size",
    zoomIn: "Zoom In",
    zoomOut: "Zoom Out",
    toggleFullscreen: "Toggle Full Screen",
    toggleDeveloperTools: "Developer Tools",
    window: "Window",
    minimize: "Minimize",
    zoom: "Zoom",
    bringAllToFront: "Bring All to Front",
    openLinkInNewTab: "Open Link in New Tab",
    saveImage: "Save Image",
    copyImage: "Copy Image",
    addToDock: "Add to Dock",
    back: "Back",
    forward: "Forward",
    reload: "Reload",
    captureFullPageScreenshot: "Capture Full Page Screenshot",
    captureFullPageScreenshotFailed: "Failed to capture full page screenshot",
    chooseImageDownloadDirectory: "Choose where to save the image",
    selectFolder: "Select Folder",
    saveImageFailed: "Failed to save image",
    translatePage: "Translate Page",
    translateSelection: "Translate Selected Text",
    renderSelectionInPreview: (format) => `Render ${format === "html" ? "HTML" : "Markdown"} in Preview`,
    renderSelectionInNewWindow: (format) => `Render ${format === "html" ? "HTML" : "Markdown"} in New Window`,
    showOriginal: "Show Original",
    translating: "Translating...",
    disableAiInteractionForDomain: (domain) => `Disable AI proactive interaction for ${domain}`,
    enableAiInteractionForDomain: (domain) => `Enable AI proactive interaction for ${domain}`,
    searchFor: (text) => `Search Google for "${text}"`,
    inspect: "Inspect",
  },
  "zh-CN": {
    addToDictionary: "添加到词典",
    aboutApp: (appName) => `关于 ${appName}`,
    services: "服务",
    hideApp: (appName) => `隐藏 ${appName}`,
    hideOthers: "隐藏其他",
    showAll: "显示全部",
    quitApp: (appName) => `退出 ${appName}`,
    file: "文件",
    newWindow: "新建窗口",
    closeWindow: "关闭窗口",
    edit: "编辑",
    undo: "撤销",
    redo: "重做",
    cut: "剪切",
    copy: "复制",
    paste: "粘贴",
    pasteAndMatchStyle: "粘贴并匹配样式",
    delete: "删除",
    selectAll: "全选",
    speech: "朗读",
    startSpeaking: "开始朗读",
    stopSpeaking: "停止朗读",
    view: "显示",
    openDownloads: "下载内容",
    openExtensions: "扩展程序",
    openSettings: "设置",
    forceReload: "强制重新加载",
    actualSize: "实际大小",
    zoomIn: "放大",
    zoomOut: "缩小",
    toggleFullscreen: "切换全屏",
    toggleDeveloperTools: "开发者工具",
    window: "窗口",
    minimize: "最小化",
    zoom: "缩放",
    bringAllToFront: "前置全部窗口",
    openLinkInNewTab: "在新标签页打开链接",
    saveImage: "保存图片",
    copyImage: "复制图片",
    addToDock: "添加到 Dock 栏",
    back: "后退",
    forward: "前进",
    reload: "重新加载",
    captureFullPageScreenshot: "截屏完整网页",
    captureFullPageScreenshotFailed: "完整网页截屏失败",
    chooseImageDownloadDirectory: "选择图片保存位置",
    selectFolder: "选择文件夹",
    saveImageFailed: "保存图片失败",
    translatePage: "翻译网页",
    translateSelection: "翻译所选文本",
    renderSelectionInPreview: (format) => `在预览窗口渲染${format === "html" ? " HTML" : " Markdown"}`,
    renderSelectionInNewWindow: (format) => `在新窗口渲染${format === "html" ? " HTML" : " Markdown"}`,
    showOriginal: "查看原文",
    translating: "翻译中...",
    disableAiInteractionForDomain: (domain) => `禁用 ${domain} 的 AI 主动交互`,
    enableAiInteractionForDomain: (domain) => `启用 ${domain} 的 AI 主动交互`,
    searchFor: (text) => `用 Google 搜索“${text}”`,
    inspect: "检查",
  },
};

function resolveMenuLocale(languageSetting?: string): MenuLocale {
  const normalizedSetting = languageSetting?.trim().toLowerCase() ?? "system";
  if (normalizedSetting.startsWith("zh")) {
    return "zh-CN";
  }
  if (normalizedSetting.startsWith("en")) {
    return "en-US";
  }

  const systemLocale = app.getLocale().trim().toLowerCase();
  return systemLocale.startsWith("zh") ? "zh-CN" : "en-US";
}

function clampMenuLabelText(text: string, maxLength = 42) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}…`;
}

function countPatternMatches(text: string, pattern: RegExp) {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

function looksLikeHtmlSelection(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  if (/^<!doctype\s+html\b/i.test(trimmed) || /<html[\s>]/i.test(trimmed)) {
    return true;
  }

  const hasStructuralTag = /<\/?(body|head|main|article|section|nav|header|footer|div|p|br|hr|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|pre|code|blockquote|figure|figcaption|span|a|img|picture|source|video|audio|canvas|style|form|label|input|button|select|option|textarea)\b[^>]*>/i
    .test(trimmed);
  const hasPairedTag = /<([a-z][\w:-]*)(?:\s[^>]*)?>[\s\S]*<\/\1>/i.test(trimmed);
  const tagCount = countPatternMatches(trimmed, /<\/?[a-z][\w:-]*(?:\s+[^<>]*)?>/gi);

  return hasStructuralTag || (hasPairedTag && tagCount >= 2);
}

function looksLikeMarkdownSelection(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  if (/^(?:```|~~~)[\s\S]*(?:```|~~~)\s*$/m.test(trimmed)) {
    return true;
  }
  if (/^#{1,6}\s+\S/m.test(trimmed)) {
    return true;
  }
  if (/^\|.+\|\s*\n\|[\s:-]+\|/m.test(trimmed)) {
    return true;
  }
  if (/^\s*[-*+]\s+\[[ xX]\]\s+\S/m.test(trimmed)) {
    return true;
  }

  let score = 0;
  const listMatches = countPatternMatches(trimmed, /^\s*(?:[-*+]|\d+\.)\s+\S/gm);
  if (listMatches >= 2) {
    score += 2;
  } else if (listMatches === 1) {
    score += 1;
  }
  if (/^\s*>\s+\S/m.test(trimmed)) {
    score += 1;
  }
  if (/\[[^\]\n]+\]\((?:https?:\/\/|mailto:|\/|#)[^)]+\)/.test(trimmed)) {
    score += 2;
  }
  if (/!\[[^\]\n]*\]\([^)]+\)/.test(trimmed)) {
    score += 2;
  }
  if (/(^|\s)(?:\*\*|__)[^\n]+(?:\*\*|__)(\s|$)/.test(trimmed)) {
    score += 1;
  }
  if (/^\s*[-*_]{3,}\s*$/m.test(trimmed)) {
    score += 1;
  }

  return score >= 2;
}

function detectRenderableSelectionFormat(text: string): RenderableSelectionFormat | null {
  if (looksLikeHtmlSelection(text)) {
    return "html";
  }

  if (looksLikeMarkdownSelection(text)) {
    return "markdown";
  }

  return null;
}

function normalizeInteractionBlacklistDomain(value: string | undefined) {
  let normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!normalized) {
    return undefined;
  }

  if (normalized.startsWith("*.")) {
    normalized = normalized.slice(2);
  }

  if (normalized.includes("://")) {
    try {
      normalized = new URL(normalized).hostname.toLowerCase();
    } catch {
      // Continue best-effort cleanup for user-entered values.
    }
  }

  normalized = normalized.split(/[/?#]/, 1)[0] ?? normalized;
  normalized = normalized.replace(/:\d+$/, "");
  normalized = normalized.replace(/^\.+|\.+$/g, "");
  return normalized || undefined;
}

function getDomainForInteractionMenu(url: string | undefined) {
  if (!url) {
    return undefined;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return normalizeInteractionBlacklistDomain(parsed.hostname);
  } catch {
    return undefined;
  }
}

function findMatchingInteractionBlacklistDomain(domain: string, domains: string[]) {
  const normalizedDomain = normalizeInteractionBlacklistDomain(domain);
  if (!normalizedDomain) {
    return undefined;
  }

  return domains.find((entry) => {
    const normalizedEntry = normalizeInteractionBlacklistDomain(entry);
    return Boolean(
      normalizedEntry
      && (normalizedDomain === normalizedEntry || normalizedDomain.endsWith(`.${normalizedEntry}`)),
    );
  });
}

function sanitizeFilename(value: string) {
  const normalized = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "");
  return normalized || "page";
}

function buildFullPageScreenshotFilename(webContents: WebContents) {
  const pageUrl = webContents.getURL().trim();
  const pageTitle = webContents.getTitle().trim().replace(/\.png$/i, "");

  if (pageTitle) {
    return `${sanitizeFilename(pageTitle)}.png`;
  }

  try {
    const hostname = new URL(pageUrl).hostname.replace(/^www\./, "").trim();
    if (hostname) {
      return `${sanitizeFilename(hostname)}.png`;
    }
  } catch {
    // Fall back to a generic filename when the page URL is not a standard URL.
  }

  return "page.png";
}

function ensurePngExtension(filePath: string) {
  return path.extname(filePath).toLowerCase() === ".png" ? filePath : `${filePath}.png`;
}

async function captureFullPageScreenshot(
  targetWindow: BrowserWindow,
  webContents: WebContents,
  menuText: (typeof menuLocaleText)[MenuLocale],
) {
  if (targetWindow.isDestroyed() || webContents.isDestroyed()) {
    return;
  }

  const saveResult = await dialog.showSaveDialog(targetWindow, {
    defaultPath: path.join(
      app.getPath("downloads"),
      buildFullPageScreenshotFilename(webContents),
    ),
    filters: [
      { name: "PNG Image", extensions: ["png"] },
    ],
  });

  if (saveResult.canceled || !saveResult.filePath || webContents.isDestroyed()) {
    return;
  }

  const debuggerHandle = webContents.debugger;
  const wasAttached = debuggerHandle.isAttached();

  try {
    if (!wasAttached) {
      try {
        debuggerHandle.attach("1.3");
      } catch (error) {
        if (!debuggerHandle.isAttached()) {
          throw error;
        }
      }
    }

    const metrics = await debuggerHandle.sendCommand("Page.getLayoutMetrics") as {
      cssContentSize?: { width?: number; height?: number };
      contentSize?: { width?: number; height?: number };
    };
    const contentSize = metrics.cssContentSize ?? metrics.contentSize;
    const width = Math.max(1, Math.ceil(Number(contentSize?.width ?? 0)));
    const height = Math.max(1, Math.ceil(Number(contentSize?.height ?? 0)));

    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      throw new Error("Page dimensions are invalid.");
    }

    const screenshot = await debuggerHandle.sendCommand("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: {
        x: 0,
        y: 0,
        width,
        height,
        scale: 1,
      },
    }) as { data?: string };

    if (!screenshot.data) {
      throw new Error("The captured screenshot was empty.");
    }

    await writeFile(
      ensurePngExtension(saveResult.filePath),
      Buffer.from(screenshot.data, "base64"),
    );
  } catch (error) {
    if (!targetWindow.isDestroyed()) {
      await dialog.showMessageBox(targetWindow, {
        type: "error",
        message: menuText.captureFullPageScreenshotFailed,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    if (!wasAttached && debuggerHandle.isAttached()) {
      try {
        debuggerHandle.detach();
      } catch {
        // Ignore detach failures when the contents goes away during capture.
      }
    }
  }
}

function inspectElementWithDefaultDock(
  webContents: WebContents,
  x: number,
  y: number,
  defaultDevToolsDockMode: DevToolsDockMode,
) {
  if (!webContents.isDevToolsOpened()) {
    webContents.openDevTools({ mode: defaultDevToolsDockMode, activate: true });
  }
  webContents.inspectElement(x, y);
}

export function createMenuManager(context: MenuManagerContext) {
  const {
    searchBaseUrl,
    handleTabCreate,
    handleAddPageToDock,
    isStartPageUrl,
    openNewWindow,
    openMenuPage,
    openSettings,
    openDownloads,
    openExtensions,
    defaultDevToolsDockMode = "right",
    getLanguage,
    getPageTranslationState,
    handlePageTranslationToggle,
    handleSelectedTextTranslation,
    handleSelectionRender,
    getDefaultDownloadDirectory,
    handleImageSave,
    getAgentInteractionBlacklistDomains,
    setAgentInteractionBlacklistDomains,
  } = context;

  async function saveImageWithDirectoryPicker(
    targetWindow: BrowserWindow,
    webContents: WebContents,
    imageUrl: string,
    menuText: (typeof menuLocaleText)[MenuLocale],
    point: { x: number; y: number },
    frame?: WebFrameMain | null,
  ) {
    if (targetWindow.isDestroyed() || webContents.isDestroyed() || !imageUrl) {
      return;
    }

    const result = await dialog.showOpenDialog(targetWindow, {
      title: menuText.chooseImageDownloadDirectory,
      buttonLabel: menuText.selectFolder,
      defaultPath: getDefaultDownloadDirectory(),
      properties: ["openDirectory", "createDirectory"],
    });

    const directory = result.filePaths[0]?.trim();
    if (result.canceled || !directory || webContents.isDestroyed()) {
      return;
    }

    try {
      await Promise.resolve(
        handleImageSave(
          targetWindow,
          webContents,
          imageUrl,
          directory,
          point,
          frame && !frame.isDestroyed() ? frame : webContents.mainFrame,
        ),
      );
    } catch (error) {
      if (!targetWindow.isDestroyed()) {
        await dialog.showMessageBox(targetWindow, {
          type: "error",
          message: menuText.saveImageFailed,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  function createSelectionRenderActions(
    targetWindow: BrowserWindow,
    webContents: WebContents,
    menuText: (typeof menuLocaleText)[MenuLocale],
    selectedText: string,
    format: RenderableSelectionFormat | null,
    anchor: { x: number; y: number },
  ): MenuItemConstructorOptions[] {
    if (!format || !handleSelectionRender) {
      return [];
    }

    return [
      {
        label: menuText.renderSelectionInPreview(format),
        click: () => {
          handleSelectionRender(targetWindow, webContents, {
            anchor,
            content: selectedText,
            destination: "preview",
            format,
          });
        },
      },
      {
        label: menuText.renderSelectionInNewWindow(format),
        click: () => {
          handleSelectionRender(targetWindow, webContents, {
            anchor,
            content: selectedText,
            destination: "window",
            format,
          });
        },
      },
    ];
  }

  function createDarwinAppMenu(
    menuText: (typeof menuLocaleText)[MenuLocale],
  ): MenuItemConstructorOptions {
    return {
      label: app.name,
      submenu: [
        { role: "about", label: menuText.aboutApp(app.name) },
        { type: "separator" },
        { role: "services", label: menuText.services },
        { type: "separator" },
        { role: "hide", label: menuText.hideApp(app.name) },
        { role: "hideOthers", label: menuText.hideOthers },
        { role: "unhide", label: menuText.showAll },
        { type: "separator" },
        { role: "quit", label: menuText.quitApp(app.name) },
      ],
    };
  }

  function createFileMenu(
    menuText: (typeof menuLocaleText)[MenuLocale],
  ): MenuItemConstructorOptions {
    const newWindowItem: MenuItemConstructorOptions = {
      label: menuText.newWindow,
      accelerator: "CmdOrCtrl+N",
      click: () => {
        openNewWindow();
      },
    };

    if (process.platform === "darwin") {
      return {
        label: menuText.file,
        submenu: [
          newWindowItem,
          { type: "separator" },
          { role: "close", label: menuText.closeWindow },
        ],
      };
    }

    return {
      label: menuText.file,
      submenu: [
        newWindowItem,
        { type: "separator" },
        { role: "close", label: menuText.closeWindow },
        { role: "quit", label: menuText.quitApp(app.name) },
      ],
    };
  }

  function createEditMenu(menuText: (typeof menuLocaleText)[MenuLocale]): MenuItemConstructorOptions {
    const submenu: MenuItemConstructorOptions[] = [
      { role: "undo", label: menuText.undo },
      { role: "redo", label: menuText.redo },
      { type: "separator" },
      { role: "cut", label: menuText.cut },
      { role: "copy", label: menuText.copy },
      { role: "paste", label: menuText.paste },
    ];

    if (process.platform === "darwin") {
      submenu.push({ role: "pasteAndMatchStyle", label: menuText.pasteAndMatchStyle });
    }

    submenu.push(
      { role: "delete", label: menuText.delete },
      { role: "selectAll", label: menuText.selectAll },
    );

    if (process.platform === "darwin") {
      submenu.push(
        { type: "separator" },
        {
          label: menuText.speech,
          submenu: [
            { role: "startSpeaking", label: menuText.startSpeaking },
            { role: "stopSpeaking", label: menuText.stopSpeaking },
          ],
        },
      );
    }

    return {
      label: menuText.edit,
      submenu,
    };
  }

  function createViewMenu(menuText: (typeof menuLocaleText)[MenuLocale]): MenuItemConstructorOptions {
    return {
      label: menuText.view,
      submenu: [
        { role: "reload", label: menuText.reload },
        { role: "forceReload", label: menuText.forceReload },
        { type: "separator" },
        { role: "resetZoom", label: menuText.actualSize },
        { role: "zoomIn", label: menuText.zoomIn },
        { role: "zoomOut", label: menuText.zoomOut },
        { type: "separator" },
        { role: "togglefullscreen", label: menuText.toggleFullscreen },
        { type: "separator" },
        { role: "toggleDevTools", label: menuText.toggleDeveloperTools },
      ],
    };
  }

  function createWindowMenu(menuText: (typeof menuLocaleText)[MenuLocale]): MenuItemConstructorOptions {
    const submenu: MenuItemConstructorOptions[] = [
      { role: "minimize", label: menuText.minimize },
      { role: "zoom", label: menuText.zoom },
    ];

    if (process.platform === "darwin") {
      submenu.push(
        { type: "separator" },
        { role: "front", label: menuText.bringAllToFront },
      );
    } else {
      submenu.push(
        { type: "separator" },
        { role: "close", label: menuText.closeWindow },
      );
    }

    return {
      label: menuText.window,
      submenu,
    };
  }

  function createPageCategoryMenus(menuLocale: MenuLocale): MenuItemConstructorOptions[] {
    return APP_MENU_PAGE_GROUPS.map((group) => ({
      label: group.label[menuLocale],
      submenu: APP_MENU_PAGE_DEFINITIONS
        .filter((page) => page.groupId === group.id)
        .map((page) => ({
          label: page.label[menuLocale],
          accelerator: page.accelerator,
          click: () => {
            openMenuPage(page.pageEntry, page.url);
          },
        })),
    }));
  }

  function installApplicationMenu() {
    const menuLocale = resolveMenuLocale(getLanguage?.());
    const menuText = menuLocaleText[menuLocale];

    const template: MenuItemConstructorOptions[] = [];

    if (process.platform === "darwin") {
      template.push(createDarwinAppMenu(menuText));
    }

    template.push(
      createFileMenu(menuText),
      ...createPageCategoryMenus(menuLocale),
      createEditMenu(menuText),
      createViewMenu(menuText),
      createWindowMenu(menuText),
    );

    if (process.platform === "darwin") {
      Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    } else {
      Menu.setApplicationMenu(null);
    }
  }

  function setupBrowserViewContextMenu(targetWindow: BrowserWindow, webContents: WebContents) {
    const contextMenuBoundContents = webContents as WebContents & {
      __miloContextMenuBound?: boolean;
    };
    if (contextMenuBoundContents.__miloContextMenuBound) {
      return;
    }
    contextMenuBoundContents.__miloContextMenuBound = true;

    webContents.on("context-menu", (_event, params) => {
      const menuText = menuLocaleText[resolveMenuLocale(getLanguage?.())];
      const template: MenuItemConstructorOptions[] = [];
      const selectedText = params.selectionText.trim();
      const selectionRenderFormat = detectRenderableSelectionFormat(selectedText);
      const pageUrl = webContents.getURL().trim();
      const isImageContext = params.mediaType === "image" && params.hasImageContents;
      const imageSourceUrl = params.srcURL.trim();
      const selectionRenderActions = createSelectionRenderActions(
        targetWindow,
        webContents,
        menuText,
        selectedText,
        selectionRenderFormat,
        { x: params.x, y: params.y },
      );

      if (params.misspelledWord) {
        for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
          template.push({
            label: suggestion,
            click: () => {
              webContents.replaceMisspelling(suggestion);
            },
          });
        }

        if (params.dictionarySuggestions.length > 0) {
          template.push({ type: "separator" });
        }

        template.push({
          label: menuText.addToDictionary,
          click: () => {
            webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord);
          },
        });
        template.push({ type: "separator" });
      }

      const primaryActions: MenuItemConstructorOptions[] = [];
      const dockAction = pageUrl && !isStartPageUrl?.(pageUrl)
        ? {
          label: menuText.addToDock,
          click: () => {
            handleAddPageToDock(webContents);
          },
        } satisfies MenuItemConstructorOptions
        : null;
      const captureFullPageScreenshotAction = pageUrl && !isStartPageUrl?.(pageUrl)
        ? {
          label: menuText.captureFullPageScreenshot,
          click: () => {
            void captureFullPageScreenshot(targetWindow, webContents, menuText);
          },
        } satisfies MenuItemConstructorOptions
        : null;

      if (params.linkURL) {
        primaryActions.push({
          label: menuText.openLinkInNewTab,
          click: () => {
            handleTabCreate(targetWindow, params.linkURL);
          },
        });
      }

      if (isImageContext) {
        primaryActions.push(
          {
            label: menuText.saveImage,
            enabled: Boolean(imageSourceUrl),
            click: () => {
              void saveImageWithDirectoryPicker(
                targetWindow,
                webContents,
                imageSourceUrl,
                menuText,
                { x: params.x, y: params.y },
                params.frame,
              );
            },
          },
          {
            label: menuText.copyImage,
            click: () => {
              if (!webContents.isDestroyed()) {
                webContents.copyImageAt(params.x, params.y);
              }
            },
          },
        );
      }

      if (primaryActions.length > 0) {
        template.push(...primaryActions, { type: "separator" });
      }

      template.push(
        {
          label: menuText.back,
          enabled: webContents.canGoBack(),
          click: () => {
            webContents.goBack();
          },
        },
        {
          label: menuText.forward,
          enabled: webContents.canGoForward(),
          click: () => {
            webContents.goForward();
          },
        },
        {
          label: menuText.reload,
          click: () => {
            webContents.reload();
          },
        },
      );

      if (captureFullPageScreenshotAction) {
        template.push(captureFullPageScreenshotAction);
      }

      const interactionDomain = getDomainForInteractionMenu(pageUrl);
      if (
        interactionDomain
        && getAgentInteractionBlacklistDomains
        && setAgentInteractionBlacklistDomains
      ) {
        const blacklistDomains = getAgentInteractionBlacklistDomains();
        const matchingBlacklistDomain = findMatchingInteractionBlacklistDomain(
          interactionDomain,
          blacklistDomains,
        );
        template.push({
          label: matchingBlacklistDomain
            ? menuText.enableAiInteractionForDomain(interactionDomain)
            : menuText.disableAiInteractionForDomain(interactionDomain),
          click: () => {
            const latestDomains = getAgentInteractionBlacklistDomains();
            const normalizedTarget = normalizeInteractionBlacklistDomain(interactionDomain);
            if (!normalizedTarget) {
              return;
            }

            const nextDomains = findMatchingInteractionBlacklistDomain(normalizedTarget, latestDomains)
              ? latestDomains.filter((entry) => {
                  const normalizedEntry = normalizeInteractionBlacklistDomain(entry);
                  return !(
                    normalizedEntry
                    && (normalizedTarget === normalizedEntry || normalizedTarget.endsWith(`.${normalizedEntry}`))
                  );
                })
              : [...latestDomains, normalizedTarget];
            setAgentInteractionBlacklistDomains(nextDomains);
          },
        });
      }

      const translationState = getPageTranslationState?.(webContents);
      if (translationState?.supported && handlePageTranslationToggle) {
        template.push(
          { type: "separator" },
          {
            label: translationState.busy
              ? menuText.translating
              : translationState.translated
              ? menuText.showOriginal
              : menuText.translatePage,
            enabled: !translationState.busy,
            click: () => {
              handlePageTranslationToggle(targetWindow, webContents);
            },
          },
        );
      }

      if (params.isEditable) {
        template.push(
          { type: "separator" },
          { role: "undo", label: menuText.undo },
          { role: "redo", label: menuText.redo },
          { type: "separator" },
          { role: "cut", label: menuText.cut },
          { role: "copy", label: menuText.copy },
          { role: "paste", label: menuText.paste },
          { role: "selectAll", label: menuText.selectAll },
        );
        if (selectionRenderActions.length > 0) {
          template.push(
            { type: "separator" },
            ...selectionRenderActions,
          );
        }
      } else if (selectedText) {
        template.push(
          { type: "separator" },
          { role: "copy", label: menuText.copy },
          ...(handleSelectedTextTranslation
            ? [{
                label: menuText.translateSelection,
                click: () => {
                  handleSelectedTextTranslation(targetWindow, webContents, selectedText, {
                    x: params.x,
                    y: params.y,
                  });
                },
              } satisfies MenuItemConstructorOptions]
            : []),
          ...selectionRenderActions,
          {
            label: menuText.searchFor(clampMenuLabelText(selectedText)),
            click: () => {
              handleTabCreate(targetWindow, `${searchBaseUrl}${encodeURIComponent(selectedText)}`);
            },
          },
        );
      }

      template.push(
        { type: "separator" },
        {
          label: menuText.inspect,
          click: () => {
            inspectElementWithDefaultDock(
              webContents,
              params.x,
              params.y,
              defaultDevToolsDockMode,
            );
          },
        },
      );

      if (dockAction) {
        template.push(
          { type: "separator" },
          dockAction,
        );
      }

      Menu.buildFromTemplate(template).popup({ window: targetWindow });
    });
  }

  return {
    installApplicationMenu,
    setupBrowserViewContextMenu,
  };
}
