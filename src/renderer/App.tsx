import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  FileCode2,
  Globe,
  LayoutGrid,
  ListTodo,
  PanelLeftClose,
  PanelRight,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Settings2,
  TriangleAlert,
  X,
} from "lucide-react";
import { BrowserTabButton } from "@/components/browser/browser-tab-button";
import { FolderIconContent } from "@/components/workspace/folder-icon";
import { normalizeLanguageSetting, resolveLocale } from "@/lib/i18n";
import {
  buildStartPageSurfaceBackgroundStyle,
  loadStartPageBackgroundImageMetrics,
  type StartPageBackgroundImageMetrics,
} from "@/lib/start-page-background";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { BrowserTabState } from "@/types/browser";
import type { BookmarkItem } from "@/types/bookmark";
import type { BrowserExtensionSummary } from "@/types/extensions";
import type { UserScriptRecord } from "@/types/user-scripts";
import type {
  BrowserBootstrapData,
  SidebarOrganizationState,
  WindowSummary,
  WorkspaceSummary,
} from "@/types/workspace";

const previewWorkspace: WorkspaceSummary = {
  id: "default",
  name: "default",
  profileId: "default",
  profileMode: "new",
  automationEnabled: true,
  automationAttached: false,
  hasWindow: true,
  windowVisible: true,
  windowCount: 1,
};

const previewWindow: WindowSummary = {
  id: 1,
  workspaceId: "default",
  workspaceName: "default",
  profileId: "default",
  visible: true,
  focused: true,
  title: "Nexus Browser · default",
  activeTabId: "preview-1",
  tabCount: 1,
  tabs: [
    {
      id: "preview-1",
      title: "Start",
      url: "home://start",
      displayUrl: "home://start",
      isLoading: false,
    },
  ],
};

const SIDEBAR_EXPANDED_WIDTH = 240;
const SIDEBAR_COLLAPSED_WIDTH = 72;
const URL_BAR_HEIGHT = 44;
const URL_BAR_HOVER_TRIGGER_HEIGHT = 4;
const AI_SIDEBAR_OPEN_AFTER_URL_BAR_HIDE_MS = 80;
const PAGE_SEARCH_BAR_HEIGHT = 52;
const WORKSPACE_SWIPE_THRESHOLD = 36;
const WORKSPACE_WHEEL_GESTURE_IDLE_MS = 260;
// Keep these in sync with the BrowserView bounds in src/main/main.ts.
const BROWSER_SURFACE_HORIZONTAL_INSET = 4;
const BROWSER_SURFACE_TOP_INSET = 4;
const BROWSER_SURFACE_BOTTOM_INSET = 4;
const BROWSER_SURFACE_RADIUS = 12;
const TOP_LOADING_BAR_HEIGHT = 3;
const TASKS_PAGE_URL = "milo://tasks/";
const BROWSER_CHROME_TOGGLE_EVENT = "browser:toggle-shell-chrome-requested";
const FOCUS_ADDRESS_BAR_EVENT = "browser:focus-address-bar-requested";

function isTasksPageUrl(url: string) {
  if (!url) {
    return false;
  }

  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === "milo:"
      && parsedUrl.hostname.toLowerCase() === "tasks"
      && (parsedUrl.pathname === "" || parsedUrl.pathname === "/");
  } catch {
    return false;
  }
}

function isMiloInternalPageUrl(url?: string) {
  if (!url) {
    return false;
  }

  try {
    return new URL(url).protocol === "milo:";
  } catch {
    return url.trim().toLowerCase().startsWith("milo://");
  }
}

function isMiloInternalPageTab(tab?: Pick<BrowserTabState, "url" | "displayUrl">) {
  return isMiloInternalPageUrl(tab?.url) || isMiloInternalPageUrl(tab?.displayUrl);
}

function escapeUserScriptRegex(value: string) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function userScriptGlobToRegex(pattern: string) {
  const source = pattern
    .split("*")
    .map(escapeUserScriptRegex)
    .join(".*");
  return new RegExp(`^${source}$`);
}

function parseUserScriptWebUrl(url: string) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:"
      ? parsedUrl
      : null;
  } catch {
    return null;
  }
}

function matchesUserScriptHostPattern(hostname: string, hostPattern: string) {
  const normalizedHostname = hostname.toLowerCase();
  const normalizedPattern = hostPattern.trim().toLowerCase();

  if (!normalizedPattern || normalizedPattern === "*") {
    return true;
  }

  if (normalizedPattern.startsWith("*.")) {
    const suffix = normalizedPattern.slice(2);
    return normalizedHostname === suffix || normalizedHostname.endsWith(`.${suffix}`);
  }

  if (normalizedPattern.includes("*")) {
    return userScriptGlobToRegex(normalizedPattern).test(normalizedHostname);
  }

  return normalizedHostname === normalizedPattern;
}

function matchesUserScriptUrlPattern(url: string, pattern: string) {
  const parsedUrl = parseUserScriptWebUrl(url);
  if (!parsedUrl) {
    return false;
  }

  const trimmed = pattern.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed === "<all_urls>" || trimmed === "*") {
    return true;
  }

  const chromePattern = trimmed.match(/^(\*|http|https):\/\/([^/]*)(\/.*)?$/i);
  if (chromePattern) {
    const schemePattern = chromePattern[1].toLowerCase();
    const hostPattern = chromePattern[2];
    const pathPattern = chromePattern[3] ?? "/*";
    const targetScheme = parsedUrl.protocol.slice(0, -1);

    if (schemePattern !== "*" && schemePattern !== targetScheme) {
      return false;
    }

    if (!matchesUserScriptHostPattern(parsedUrl.hostname, hostPattern)) {
      return false;
    }

    const targetPath = `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
    return userScriptGlobToRegex(pathPattern).test(targetPath);
  }

  return userScriptGlobToRegex(trimmed).test(url);
}

function userScriptMatchesUrl(script: UserScriptRecord, url: string) {
  if (!parseUserScriptWebUrl(url)) {
    return false;
  }

  const hasMatch = script.matches.some((pattern) => matchesUserScriptUrlPattern(url, pattern));
  if (!hasMatch) {
    return false;
  }

  return !script.excludes.some((pattern) => matchesUserScriptUrlPattern(url, pattern));
}

function isAutomationWorkspace(workspace: WorkspaceSummary) {
  return workspace.tags?.includes("automation") ?? false;
}

const messages = {
  "en-US": {
    bookmarkInputRequired: "Please enter a URL or keyword.",
    bookmarkAddFailed: "Failed to add bookmark.",
    bookmarkUrlRequired: "URL cannot be empty.",
    bookmarkUpdateFailed: "Failed to update bookmark.",
    bookmarkClearConfirm: "Clear all bookmarks?",
    bookmarkClearFailed: "Failed to clear bookmarks.",
    workspaceCreateFailed: "Failed to create workspace.",
    workspaceSwitchFailed: "Failed to switch workspace.",
    workspaceRenameFailed: "Failed to rename workspace.",
    workspaceNameRequired: "Workspace name cannot be empty.",
    workspaceRenamePlaceholder: "Rename current workspace",
    workspaceRenameAction: "Rename workspace",
    newTab: "New Tab",
    newFolder: "New Folder",
    folderLabel: "Folder",
    folderEmptyHint: "Drag tabs here",
    folderCloseAll: "Delete Folder",
    folderDeleteConfirm: "Deleting this folder will also close all tabs inside it. Continue?",
    folderSettings: "Folder Settings",
    folderSettingsTitle: "Edit Folder",
    folderNameLabel: "Folder name",
    folderNamePlaceholder: "Enter folder name",
    folderIconLabel: "Folder icon",
    folderIconPlaceholder: "Emoji or short icon",
    cancel: "Cancel",
    save: "Save",
    workspaceCreate: "+ Create",
    addressPlaceholder: "Search or enter address",
    findInPagePlaceholder: "Find in page",
    findInPageNoMatches: "No matches",
    findInPagePrevious: "Previous match",
    findInPageNext: "Next match",
    findInPageClose: "Close find bar",
    reloadPage: "Reload page",
    stopLoading: "Stop loading",
    goBack: "Go back",
    goForward: "Go forward",
    addBookmark: "Add bookmark",
    removeBookmark: "Remove bookmark",
    copyLinkAction: "Copy link",
    copyLinkCopied: "Link copied",
    copyLinkFailed: "Copy failed",
    extensionsToolbar: "Extensions",
    extensionPopupFailed: "Failed to open extension popup.",
    automationControlledBadge: "Auto",
    taskManager: "Task Manager",
    runInElectronTitle: "Run in Electron",
    runInElectronPrefix:
      "This page is only a renderer preview. Full browser capability and workspace profile isolation depend on the Electron main process and the",
    runInElectronSuffix: "container.",
    splitHorizontal: "Side by side",
    splitVertical: "Stacked",
    splitBento: "Bento",
    splitSeparate: "Separate",
    splitSeparateAll: "Separate All Tabs",
    splitSyncOn: "Sync Scroll On",
    splitSyncOff: "Sync Scroll Off",
    splitViewLabel: "Split View",
    splitCloseView: "Close Focused View",
    splitDropLeft: "Drop to split left",
    splitDropRight: "Drop to split right",
    splitDropTop: "Drop to split top",
    splitDropBottom: "Drop to split bottom",
    aiAssistant: "Nexus AI",
    userScripts: "User Scripts",
    userScriptsCurrentPage: "Current page",
    userScriptsAll: "All scripts",
    userScriptsNoScripts: "No user scripts yet.",
    userScriptsOpenManager: "Open manager",
    userScriptsNewScript: "New script",
    userScriptsEnable: "Enable",
    userScriptsDisable: "Disable",
    userScriptsRunNow: "Run now",
    userScriptsEdit: "Edit",
    userScriptsDelete: "Delete",
    userScriptsEnabled: "Enabled",
    userScriptsDisabled: "Disabled",
    userScriptsMatchesCurrentPage: "Matches current page",
    userScriptsNotMatching: "Not matching current page",
    userScriptsDeleteConfirm: "Delete user script",
    userScriptsToggleFailed: "Failed to update user script.",
    userScriptsRunFailed: "Failed to run user script.",
    userScriptsDeleteFailed: "Failed to delete user script.",
  },
  "zh-CN": {
    bookmarkInputRequired: "请输入 URL 或关键词。",
    bookmarkAddFailed: "添加书签失败。",
    bookmarkUrlRequired: "URL 不能为空。",
    bookmarkUpdateFailed: "更新书签失败。",
    bookmarkClearConfirm: "确定清空全部书签吗？",
    bookmarkClearFailed: "清空书签失败。",
    workspaceCreateFailed: "创建 workspace 失败。",
    workspaceSwitchFailed: "切换 workspace 失败。",
    workspaceRenameFailed: "重命名 workspace 失败。",
    workspaceNameRequired: "Workspace 名称不能为空。",
    workspaceRenamePlaceholder: "修改当前 workspace 名称",
    workspaceRenameAction: "重命名 workspace",
    newTab: "新标签页",
    newFolder: "新建文件夹",
    folderLabel: "文件夹",
    folderEmptyHint: "拖拽标签页到这里",
    folderCloseAll: "删除目录",
    folderDeleteConfirm: "删除目录会同时关闭目录下的所有标签页，是否继续？",
    folderSettings: "目录设置",
    folderSettingsTitle: "编辑目录",
    folderNameLabel: "目录名称",
    folderNamePlaceholder: "输入目录名称",
    folderIconLabel: "目录图标",
    folderIconPlaceholder: "Emoji 或短图标",
    cancel: "取消",
    save: "保存",
    workspaceCreate: "+ 新建",
    addressPlaceholder: "搜索或输入地址",
    findInPagePlaceholder: "在页面中查找",
    findInPageNoMatches: "无匹配结果",
    findInPagePrevious: "上一个匹配",
    findInPageNext: "下一个匹配",
    findInPageClose: "关闭查找栏",
    reloadPage: "刷新页面",
    stopLoading: "停止加载",
    goBack: "后退",
    goForward: "前进",
    addBookmark: "添加书签",
    removeBookmark: "移除书签",
    copyLinkAction: "复制链接",
    copyLinkCopied: "链接已复制",
    copyLinkFailed: "复制失败",
    extensionsToolbar: "扩展程序",
    extensionPopupFailed: "打开扩展弹窗失败。",
    automationControlledBadge: "接管中",
    taskManager: "任务管理",
    runInElectronTitle: "请在 Electron 中运行",
    runInElectronPrefix:
      "当前页面只是渲染层预览。真正的浏览器能力和 workspace profile 隔离依赖 Electron 的主进程和",
    runInElectronSuffix: "容器。",
    splitHorizontal: "并排",
    splitVertical: "上下",
    splitBento: "Bento",
    splitSeparate: "分离",
    splitSeparateAll: "分离全部标签页",
    splitSyncOn: "联动滚动开",
    splitSyncOff: "联动滚动关",
    splitViewLabel: "分屏视图",
    splitCloseView: "关闭当前视图",
    splitDropLeft: "释放后拆分到左侧",
    splitDropRight: "释放后拆分到右侧",
    splitDropTop: "释放后拆分到上方",
    splitDropBottom: "释放后拆分到下方",
    aiAssistant: "Milo AI",
    userScripts: "用户脚本",
    userScriptsCurrentPage: "当前页面",
    userScriptsAll: "全部脚本",
    userScriptsNoScripts: "还没有用户脚本。",
    userScriptsOpenManager: "打开管理页",
    userScriptsNewScript: "新建脚本",
    userScriptsEnable: "启用",
    userScriptsDisable: "停用",
    userScriptsRunNow: "立即应用",
    userScriptsEdit: "编辑",
    userScriptsDelete: "删除",
    userScriptsEnabled: "已启用",
    userScriptsDisabled: "已停用",
    userScriptsMatchesCurrentPage: "命中当前页",
    userScriptsNotMatching: "未命中当前页",
    userScriptsDeleteConfirm: "删除用户脚本",
    userScriptsToggleFailed: "更新用户脚本状态失败。",
    userScriptsRunFailed: "运行用户脚本失败。",
    userScriptsDeleteFailed: "删除用户脚本失败。",
  },
} as const;

type MessageKey = keyof (typeof messages)["en-US"];

type TabDropPosition = "before" | "after";
type TabDropIntent =
  | { kind: "group" }
  | { kind: "reorder"; position: TabDropPosition };

interface TabDropTarget {
  tabId: string;
  position: TabDropPosition;
}

interface SidebarEntryDropTarget {
  entryId: string;
  position: TabDropPosition;
}

type SplitViewMode = "horizontal" | "vertical" | "bento";
type SplitDropSide = "left" | "right" | "top" | "bottom";

type SidebarEntry =
  | { id: string; kind: "tab"; tabId: string }
  | { id: string; kind: "split"; splitId: string }
  | { id: string; kind: "folder"; folderId: string };

interface SidebarFolderState {
  id: string;
  title: string;
  icon?: string;
  backgroundColor?: string;
  tabIds: string[];
  isExpanded: boolean;
}

interface SplitTabState {
  id: string;
  mode: SplitViewMode;
  tabIds: string[];
  focusedTabId: string;
  syncScroll: boolean;
}

interface WorkspaceSplitState {
  activeEntryId: string | null;
  entries: SidebarEntry[];
  splits: Record<string, SplitTabState>;
  folders: Record<string, SidebarFolderState>;
}

interface SplitPanelMetrics {
  tabId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  contentX: number;
  contentY: number;
  contentWidth: number;
  contentHeight: number;
}

interface SplitDragPreview {
  mode: "horizontal" | "vertical";
  side: SplitDropSide;
}

interface SidebarActiveIndicatorMetrics {
  height: number;
  left: number;
  top: number;
  width: number;
}

const SPLIT_PANEL_GAP = 6;
const SPLIT_PANEL_INSET = 4;

function createSidebarTabEntry(tabId: string): SidebarEntry {
  return {
    id: `tab:${tabId}`,
    kind: "tab",
    tabId,
  };
}

function createSidebarSplitEntry(splitId: string): SidebarEntry {
  return {
    id: `split:${splitId}`,
    kind: "split",
    splitId,
  };
}

function createSidebarFolderEntry(folderId: string): SidebarEntry {
  return {
    id: `folder:${folderId}`,
    kind: "folder",
    folderId,
  };
}

function createClientGeneratedId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${prefix}-${Math.random().toString(36).slice(2, 11)}`;
}

function createSplitId() {
  return createClientGeneratedId("split");
}

function createFolderId() {
  return createClientGeneratedId("folder");
}

function getSidebarEntryOwnerId(entry: SidebarEntry) {
  switch (entry.kind) {
    case "tab":
      return entry.tabId;
    case "split":
      return entry.splitId;
    case "folder":
      return entry.folderId;
    default:
      return "";
  }
}

function getStandaloneSidebarTabIds(state: WorkspaceSplitState) {
  return state.entries.flatMap((entry) => (entry.kind === "tab" ? [entry.tabId] : []));
}

function collectWorkspaceSplitStateTabIds(state: WorkspaceSplitState) {
  const tabIds = new Set<string>();

  for (const entry of state.entries) {
    if (entry.kind === "tab") {
      tabIds.add(entry.tabId);
      continue;
    }

    if (entry.kind === "folder") {
      state.folders[entry.folderId]?.tabIds.forEach((tabId) => tabIds.add(tabId));
      continue;
    }

    state.splits[entry.splitId]?.tabIds.forEach((tabId) => tabIds.add(tabId));
  }

  for (const folder of Object.values(state.folders)) {
    folder.tabIds.forEach((tabId) => tabIds.add(tabId));
  }

  for (const split of Object.values(state.splits)) {
    split.tabIds.forEach((tabId) => tabIds.add(tabId));
  }

  return tabIds;
}

function hasWorkspaceSplitStateMissingTabs(
  state: WorkspaceSplitState,
  tabList: BrowserTabState[],
) {
  const liveTabIds = new Set(tabList.map((tab) => tab.id));
  return Array.from(collectWorkspaceSplitStateTabIds(state)).some((tabId) => !liveTabIds.has(tabId));
}

function findSidebarFolderForTabId(
  state: WorkspaceSplitState,
  tabId: string,
): SidebarFolderState | null {
  for (const folder of Object.values(state.folders)) {
    if (folder.tabIds.includes(tabId)) {
      return folder;
    }
  }

  return null;
}

function findSidebarEntryById(
  state: WorkspaceSplitState,
  entryId: string | null | undefined,
): SidebarEntry | null {
  if (!entryId) {
    return null;
  }

  if (entryId.startsWith("split:")) {
    const splitId = entryId.slice("split:".length);
    return state.entries.some((entry) => entry.kind === "split" && entry.splitId === splitId)
      ? createSidebarSplitEntry(splitId)
      : null;
  }

  if (entryId.startsWith("folder:")) {
    const folderId = entryId.slice("folder:".length);
    return state.entries.some((entry) => entry.kind === "folder" && entry.folderId === folderId)
      ? createSidebarFolderEntry(folderId)
      : null;
  }

  if (!entryId.startsWith("tab:")) {
    return null;
  }

  const tabId = entryId.slice("tab:".length);
  return state.entries.some((entry) => entry.kind === "tab" && entry.tabId === tabId)
    || Boolean(findSidebarFolderForTabId(state, tabId))
    ? createSidebarTabEntry(tabId)
    : null;
}

function resolveFirstFocusableSidebarEntryId(state: WorkspaceSplitState) {
  for (const entry of state.entries) {
    if (entry.kind === "tab" || entry.kind === "split") {
      return entry.id;
    }

    const firstTabId = state.folders[entry.folderId]?.tabIds[0];
    if (firstTabId) {
      return createSidebarTabEntry(firstTabId).id;
    }
  }

  return null;
}

function createDefaultWorkspaceSplitState(
  tabList: BrowserTabState[],
  activeTabId?: string,
): WorkspaceSplitState {
  return {
    activeEntryId: activeTabId ? createSidebarTabEntry(activeTabId).id : tabList[0]?.id ? createSidebarTabEntry(tabList[0].id).id : null,
    entries: tabList.map((tab) => createSidebarTabEntry(tab.id)),
    splits: {},
    folders: {},
  };
}

function areWorkspaceSplitStatesEqual(left: WorkspaceSplitState, right: WorkspaceSplitState) {
  if (left.activeEntryId !== right.activeEntryId || left.entries.length !== right.entries.length) {
    return false;
  }

  for (let index = 0; index < left.entries.length; index += 1) {
    const leftEntry = left.entries[index];
    const rightEntry = right.entries[index];
    if (
      leftEntry?.id !== rightEntry?.id
      || leftEntry?.kind !== rightEntry?.kind
      || getSidebarEntryOwnerId(leftEntry) !== getSidebarEntryOwnerId(rightEntry)
    ) {
      return false;
    }
  }

  const leftSplitIds = Object.keys(left.splits).sort();
  const rightSplitIds = Object.keys(right.splits).sort();
  if (leftSplitIds.length !== rightSplitIds.length) {
    return false;
  }

  if (!leftSplitIds.every((splitId, index) => {
    const rightSplitId = rightSplitIds[index];
    if (splitId !== rightSplitId) {
      return false;
    }

    const leftSplit = left.splits[splitId];
    const rightSplit = right.splits[rightSplitId];
    return Boolean(
      leftSplit
      && rightSplit
      && leftSplit.mode === rightSplit.mode
      && leftSplit.focusedTabId === rightSplit.focusedTabId
      && leftSplit.syncScroll === rightSplit.syncScroll
      && leftSplit.tabIds.length === rightSplit.tabIds.length
      && leftSplit.tabIds.every((tabId, tabIndex) => tabId === rightSplit.tabIds[tabIndex]),
    );
  })) {
    return false;
  }

  const leftFolderIds = Object.keys(left.folders).sort();
  const rightFolderIds = Object.keys(right.folders).sort();
  if (leftFolderIds.length !== rightFolderIds.length) {
    return false;
  }

  return leftFolderIds.every((folderId, index) => {
    const rightFolderId = rightFolderIds[index];
    if (folderId !== rightFolderId) {
      return false;
    }

    const leftFolder = left.folders[folderId];
    const rightFolder = right.folders[rightFolderId];
    return Boolean(
      leftFolder
      && rightFolder
      && leftFolder.title === rightFolder.title
      && leftFolder.icon === rightFolder.icon
      && leftFolder.backgroundColor === rightFolder.backgroundColor
      && leftFolder.isExpanded === rightFolder.isExpanded
      && leftFolder.tabIds.length === rightFolder.tabIds.length
      && leftFolder.tabIds.every((tabId, tabIndex) => tabId === rightFolder.tabIds[tabIndex]),
    );
  });
}

function reconcileWorkspaceSplitState(
  previousState: WorkspaceSplitState,
  tabList: BrowserTabState[],
  activeTabId?: string,
): WorkspaceSplitState {
  const liveTabIds = new Set(tabList.map((tab) => tab.id));
  const orderedLiveTabIds = tabList.map((tab) => tab.id);
  const nextSplits: Record<string, SplitTabState> = {};
  const nextFolders: Record<string, SidebarFolderState> = {};
  const splitMembership = new Set<string>();
  const folderMembership = new Set<string>();
  const nextEntries: SidebarEntry[] = [];
  const addedRootTabIds = new Set<string>();

  for (const entry of previousState.entries) {
    if (entry.kind === "split") {
      const split = previousState.splits[entry.splitId];
      if (!split) {
        continue;
      }

      const nextTabIds = split.tabIds.filter(
        (tabId) =>
          liveTabIds.has(tabId)
          && !splitMembership.has(tabId)
          && !folderMembership.has(tabId)
          && !addedRootTabIds.has(tabId),
      );
      if (nextTabIds.length >= 2) {
        nextSplits[split.id] = {
          ...split,
          tabIds: nextTabIds,
          focusedTabId: nextTabIds.includes(split.focusedTabId) ? split.focusedTabId : nextTabIds[0],
        };
        nextEntries.push(createSidebarSplitEntry(split.id));
        nextTabIds.forEach((tabId) => splitMembership.add(tabId));
        continue;
      }

      nextTabIds.forEach((tabId) => {
        if (addedRootTabIds.has(tabId)) {
          return;
        }

        nextEntries.push(createSidebarTabEntry(tabId));
        addedRootTabIds.add(tabId);
      });
      continue;
    }

    if (entry.kind === "folder") {
      const folder = previousState.folders[entry.folderId];
      if (!folder) {
        continue;
      }

      const nextTabIds = folder.tabIds.filter(
        (tabId) =>
          liveTabIds.has(tabId)
          && !splitMembership.has(tabId)
          && !folderMembership.has(tabId)
          && !addedRootTabIds.has(tabId),
      );

      nextFolders[folder.id] = {
        ...folder,
        tabIds: nextTabIds,
      };
      nextEntries.push(createSidebarFolderEntry(folder.id));
      nextTabIds.forEach((tabId) => {
        folderMembership.add(tabId);
      });
      continue;
    }

    if (
      entry.kind === "tab"
      && liveTabIds.has(entry.tabId)
      && !splitMembership.has(entry.tabId)
      && !folderMembership.has(entry.tabId)
      && !addedRootTabIds.has(entry.tabId)
    ) {
      nextEntries.push(createSidebarTabEntry(entry.tabId));
      addedRootTabIds.add(entry.tabId);
    }
  }

  orderedLiveTabIds.forEach((tabId) => {
    if (splitMembership.has(tabId) || folderMembership.has(tabId) || addedRootTabIds.has(tabId)) {
      return;
    }

    nextEntries.push(createSidebarTabEntry(tabId));
    addedRootTabIds.add(tabId);
  });

  let nextActiveEntryId = previousState.activeEntryId;
  if (activeTabId) {
    const activeSplitEntry = nextEntries.find(
      (entry) => entry.kind === "split" && nextSplits[entry.splitId]?.tabIds.includes(activeTabId),
    );
    if (activeSplitEntry?.kind === "split") {
      const split = nextSplits[activeSplitEntry.splitId];
      if (split) {
        split.focusedTabId = activeTabId;
      }
      nextActiveEntryId = activeSplitEntry.id;
    } else {
      if (
        nextEntries.some((entry) => entry.kind === "tab" && entry.tabId === activeTabId)
        || folderMembership.has(activeTabId)
      ) {
        nextActiveEntryId = createSidebarTabEntry(activeTabId).id;
      }
    }
  }

  const nextState = {
    activeEntryId: nextActiveEntryId,
    entries: nextEntries,
    splits: nextSplits,
    folders: nextFolders,
  } satisfies WorkspaceSplitState;

  if (!findSidebarEntryById(nextState, nextActiveEntryId)) {
    nextActiveEntryId = resolveFirstFocusableSidebarEntryId(nextState);
  }

  return {
    activeEntryId: nextActiveEntryId,
    entries: nextEntries,
    splits: nextSplits,
    folders: nextFolders,
  };
}

function buildSplitTitle(
  split: SplitTabState,
  tabMap: Map<string, BrowserTabState>,
  label: string,
) {
  const tabTitles = split.tabIds
    .map((tabId) => tabMap.get(tabId)?.title?.trim())
    .filter((value): value is string => Boolean(value));

  if (tabTitles.length === 0) {
    return label;
  }

  return `${label} · ${tabTitles.slice(0, 3).join(" + ")}`;
}

function buildSplitPanels(
  split: SplitTabState,
  width: number,
  height: number,
): SplitPanelMetrics[] {
  const safeWidth = Math.max(0, width);
  const safeHeight = Math.max(0, height);
  const tabs = split.tabIds;

  const buildPanel = (tabId: string, x: number, y: number, panelWidth: number, panelHeight: number) => {
    const contentWidth = Math.max(0, panelWidth - SPLIT_PANEL_INSET * 2);
    const contentHeight = Math.max(0, panelHeight - SPLIT_PANEL_INSET * 2);

    return {
      tabId,
      x,
      y,
      width: panelWidth,
      height: panelHeight,
      contentX: x + SPLIT_PANEL_INSET,
      contentY: y + SPLIT_PANEL_INSET,
      contentWidth,
      contentHeight,
    } satisfies SplitPanelMetrics;
  };

  const buildLinearPanels = (axis: "horizontal" | "vertical") => {
    const totalPanels = tabs.length;
    if (totalPanels === 0) {
      return [];
    }

    const totalGap = SPLIT_PANEL_GAP * Math.max(0, totalPanels - 1);
    const availableSpan = Math.max(0, (axis === "horizontal" ? safeWidth : safeHeight) - totalGap);
    const baseSpan = Math.max(0, Math.floor(availableSpan / totalPanels));
    let cursor = 0;

    return tabs.map((tabId, index) => {
      const remainingPanels = totalPanels - index;
      const remainingGap = SPLIT_PANEL_GAP * Math.max(0, remainingPanels - 1);
      const totalSpan = axis === "horizontal" ? safeWidth : safeHeight;
      const remainingSpan = Math.max(0, totalSpan - cursor - remainingGap);
      const currentSpan = remainingPanels === 1 ? remainingSpan : Math.min(baseSpan, remainingSpan);
      const panel = axis === "horizontal"
        ? buildPanel(tabId, cursor, 0, currentSpan, safeHeight)
        : buildPanel(tabId, 0, cursor, safeWidth, currentSpan);

      cursor += currentSpan + SPLIT_PANEL_GAP;
      return panel;
    });
  };

  const buildGridPanels = () => {
    const totalPanels = tabs.length;
    if (totalPanels === 0) {
      return [];
    }

    const columnCount = Math.max(1, Math.ceil(Math.sqrt(totalPanels)));
    const rowCount = Math.max(1, Math.ceil(totalPanels / columnCount));
    const totalRowGap = SPLIT_PANEL_GAP * Math.max(0, rowCount - 1);
    const availableHeight = Math.max(0, safeHeight - totalRowGap);
    const baseRowHeight = Math.max(0, Math.floor(availableHeight / rowCount));
    const panels: SplitPanelMetrics[] = [];
    let tabIndex = 0;
    let cursorY = 0;

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const remainingRows = rowCount - rowIndex;
      const remainingRowGap = SPLIT_PANEL_GAP * Math.max(0, remainingRows - 1);
      const remainingHeight = Math.max(0, safeHeight - cursorY - remainingRowGap);
      const rowHeight = remainingRows === 1 ? remainingHeight : Math.min(baseRowHeight, remainingHeight);
      const remainingTabs = totalPanels - tabIndex;
      const rowItemCount = Math.min(columnCount, remainingTabs);
      const totalColumnGap = SPLIT_PANEL_GAP * Math.max(0, rowItemCount - 1);
      const availableWidth = Math.max(0, safeWidth - totalColumnGap);
      const baseColumnWidth = rowItemCount > 0 ? Math.max(0, Math.floor(availableWidth / rowItemCount)) : 0;
      let cursorX = 0;

      for (let columnIndex = 0; columnIndex < rowItemCount; columnIndex += 1) {
        const currentTabId = tabs[tabIndex];
        const remainingColumns = rowItemCount - columnIndex;
        const remainingColumnGap = SPLIT_PANEL_GAP * Math.max(0, remainingColumns - 1);
        const remainingWidth = Math.max(0, safeWidth - cursorX - remainingColumnGap);
        const columnWidth = remainingColumns === 1 ? remainingWidth : Math.min(baseColumnWidth, remainingWidth);

        panels.push(buildPanel(currentTabId, cursorX, cursorY, columnWidth, rowHeight));
        cursorX += columnWidth + SPLIT_PANEL_GAP;
        tabIndex += 1;
      }

      cursorY += rowHeight + SPLIT_PANEL_GAP;
    }

    return panels;
  };

  if (split.mode === "vertical") {
    return buildLinearPanels("vertical");
  }

  if (split.mode === "bento") {
    return buildGridPanels();
  }

  return buildLinearPanels("horizontal");
}

function addTabToSplitOrder(
  tabIds: string[],
  tabId: string,
  side: SplitDropSide,
) {
  const nextTabIds = tabIds.filter((existingTabId) => existingTabId !== tabId);
  if (side === "left" || side === "top") {
    return [tabId, ...nextTabIds];
  }

  return [...nextTabIds, tabId];
}

function getWorkspaceInitial(name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    return "W";
  }

  return Array.from(trimmed)[0]?.toUpperCase() ?? "W";
}

function getWorkspaceHue(name: string) {
  let hash = 0;
  for (const char of Array.from(name.trim() || "workspace")) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash % 360;
}

function getWorkspacePalette(name: string, isLight: boolean) {
  const hue = getWorkspaceHue(name);
  const accentSecondaryHue = (hue + 42) % 360;
  const surfaceHue = (hue + 12) % 360;
  const surfaceSecondaryHue = (hue + 30) % 360;
  const avatarStyle: React.CSSProperties = {
    background: `linear-gradient(135deg, hsla(${hue}, 78%, 62%, 0.94), hsla(${accentSecondaryHue}, 70%, 54%, 0.84))`,
    boxShadow: `0 10px 28px hsla(${hue}, 82%, 58%, 0.24)`,
  };

  return {
    avatarStyle,
    chromeSurfaceBackground: isLight
      ? `linear-gradient(180deg, hsla(${surfaceHue}, 56%, 96%, 0.78), hsla(${surfaceSecondaryHue}, 44%, 94%, 0.68))`
      : `linear-gradient(180deg, hsla(${surfaceHue}, 28%, 16%, 0.48), hsla(${surfaceSecondaryHue}, 24%, 10%, 0.56))`,
  };
}

function isStartPageTab(tab?: Pick<BrowserTabState, "url" | "displayUrl">) {
  const displayUrl = (tab?.displayUrl ?? "").trim().toLowerCase();
  const url = (tab?.url ?? "").trim().toLowerCase();
  return displayUrl === "home://start"
    || url === "home://start"
    || displayUrl === "milo://home"
    || url === "milo://home"
    || displayUrl.startsWith("milo://home?")
    || url.startsWith("milo://home?");
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error("Failed to copy text.");
  }
}

function toBrowserTabs(windowTabs: WindowSummary["tabs"]): BrowserTabState[] {
  return windowTabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    url: tab.displayUrl === "home://start" ? "home://start" : tab.displayUrl,
    displayUrl: tab.displayUrl,
    favicon: tab.favicon,
    isLoading: tab.isLoading,
    isAutomationControlled: Boolean(tab.isAutomationControlled),
    manualInterventionMessage: tab.manualInterventionMessage,
    canGoBack: false,
    canGoForward: false,
  }));
}

function areBrowserTabsEqual(left: BrowserTabState[], right: BrowserTabState[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((leftTab, index) => {
    const rightTab = right[index];
    return Boolean(
      rightTab
      && leftTab.id === rightTab.id
      && leftTab.title === rightTab.title
      && leftTab.url === rightTab.url
      && leftTab.displayUrl === rightTab.displayUrl
      && leftTab.favicon === rightTab.favicon
      && leftTab.isLoading === rightTab.isLoading
      && leftTab.isAutomationControlled === rightTab.isAutomationControlled
      && leftTab.manualInterventionMessage === rightTab.manualInterventionMessage
      && leftTab.canGoBack === rightTab.canGoBack
      && leftTab.canGoForward === rightTab.canGoForward
    );
  });
}

function insertAtIndex<T>(items: T[], index: number, item: T) {
  const nextItems = [...items];
  const safeIndex = Math.max(0, Math.min(index, nextItems.length));
  nextItems.splice(safeIndex, 0, item);
  return nextItems;
}

function resolveTabDropIntent(
  bounds: DOMRect,
  clientY: number,
  allowGroup: boolean,
): TabDropIntent {
  if (!allowGroup || bounds.height <= 0) {
    return {
      kind: "reorder",
      position: clientY < bounds.top + bounds.height / 2 ? "before" : "after",
    };
  }

  const edgeThreshold = Math.min(14, Math.max(8, bounds.height * 0.24));
  if (clientY <= bounds.top + edgeThreshold) {
    return {
      kind: "reorder",
      position: "before",
    };
  }

  if (clientY >= bounds.bottom - edgeThreshold) {
    return {
      kind: "reorder",
      position: "after",
    };
  }

  return { kind: "group" };
}

function resolveSidebarEntryDropPosition(bounds: DOMRect, clientY: number): TabDropPosition {
  return clientY < bounds.top + bounds.height / 2 ? "before" : "after";
}

function buildNextFolderTitle(
  folders: Record<string, SidebarFolderState>,
  folderLabel: string,
) {
  let folderIndex = Object.keys(folders).length + 1;
  let folderTitle = `${folderLabel} ${folderIndex}`;

  while (Object.values(folders).some((folder) => folder.title === folderTitle)) {
    folderIndex += 1;
    folderTitle = `${folderLabel} ${folderIndex}`;
  }

  return folderTitle;
}

function normalizeFolderBackgroundColor(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const shortHexMatch = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (shortHexMatch) {
    const [, hex] = shortHexMatch;
    return `#${hex.split("").map((char) => `${char}${char}`).join("")}`.toLowerCase();
  }

  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toLowerCase() : undefined;
}

function parseHexColor(value?: string | null) {
  const normalized = normalizeFolderBackgroundColor(value);
  if (!normalized) {
    return null;
  }

  return {
    hex: normalized,
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function rgba(color: { r: number; g: number; b: number }, alpha: number) {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

function getFolderBackgroundColorTokens(value: string | undefined, isLight: boolean) {
  const color = parseHexColor(value);
  if (!color) {
    return null;
  }

  return {
    backgroundColor: rgba(color, isLight ? 0.28 : 0.38),
    borderColor: rgba(color, isLight ? 0.46 : 0.58),
    expandedBorderColor: rgba(color, isLight ? 0.7 : 0.78),
    chipBackgroundColor: rgba(color, isLight ? 0.34 : 0.46),
    iconBackgroundColor: rgba(color, isLight ? 0.4 : 0.52),
    textColor: isLight ? "rgba(15, 23, 42, 0.84)" : "rgba(248, 250, 252, 0.92)",
  };
}

function moveTabEntryInSidebar(
  state: WorkspaceSplitState,
  draggedTabId: string,
  targetTabId: string,
  position: TabDropPosition,
): WorkspaceSplitState {
  if (draggedTabId === targetTabId) {
    return state;
  }

  const sourceFolderId = findSidebarFolderForTabId(state, draggedTabId)?.id ?? null;
  const targetFolderId = findSidebarFolderForTabId(state, targetTabId)?.id ?? null;
  let nextEntries = [...state.entries];
  const nextFolders = { ...state.folders };

  if (sourceFolderId) {
    const sourceFolder = nextFolders[sourceFolderId];
    if (!sourceFolder) {
      return state;
    }

    nextFolders[sourceFolderId] = {
      ...sourceFolder,
      tabIds: sourceFolder.tabIds.filter((tabId) => tabId !== draggedTabId),
    };
  } else {
    nextEntries = nextEntries.filter(
      (entry) => entry.kind !== "tab" || entry.tabId !== draggedTabId,
    );
  }

  if (targetFolderId) {
    const targetFolder = nextFolders[targetFolderId];
    if (!targetFolder) {
      return state;
    }

    const nextTabIds = targetFolder.tabIds.filter((tabId) => tabId !== draggedTabId);
    const targetIndex = nextTabIds.indexOf(targetTabId);
    if (targetIndex === -1) {
      return state;
    }

    nextTabIds.splice(position === "before" ? targetIndex : targetIndex + 1, 0, draggedTabId);
    nextFolders[targetFolderId] = {
      ...targetFolder,
      isExpanded: true,
      tabIds: nextTabIds,
    };
  } else {
    const targetIndex = nextEntries.findIndex(
      (entry) => entry.kind === "tab" && entry.tabId === targetTabId,
    );
    if (targetIndex === -1) {
      return state;
    }

    nextEntries = insertAtIndex(
      nextEntries,
      position === "before" ? targetIndex : targetIndex + 1,
      createSidebarTabEntry(draggedTabId),
    );
  }

  return {
    ...state,
    entries: nextEntries,
    folders: nextFolders,
  };
}

function moveSidebarEntryInSidebar(
  state: WorkspaceSplitState,
  draggedEntryId: string,
  targetEntryId: string,
  position: TabDropPosition,
): WorkspaceSplitState {
  if (draggedEntryId === targetEntryId) {
    return state;
  }

  const draggedEntry = state.entries.find((entry) => entry.id === draggedEntryId);
  if (!draggedEntry || !state.entries.some((entry) => entry.id === targetEntryId)) {
    return state;
  }

  const nextEntries = state.entries.filter((entry) => entry.id !== draggedEntryId);
  const targetIndex = nextEntries.findIndex((entry) => entry.id === targetEntryId);
  if (targetIndex === -1) {
    return state;
  }

  return {
    ...state,
    entries: insertAtIndex(
      nextEntries,
      position === "before" ? targetIndex : targetIndex + 1,
      { ...draggedEntry },
    ),
  };
}

function moveTabToRootNearSidebarEntry(
  state: WorkspaceSplitState,
  draggedTabId: string,
  targetEntryId: string,
  position: TabDropPosition,
): WorkspaceSplitState {
  const draggedRootEntryId = createSidebarTabEntry(draggedTabId).id;
  if (draggedRootEntryId === targetEntryId) {
    return state;
  }

  const sourceFolderId = findSidebarFolderForTabId(state, draggedTabId)?.id ?? null;
  let nextEntries = state.entries.filter((entry) => entry.kind !== "tab" || entry.tabId !== draggedTabId);
  const nextFolders = { ...state.folders };

  if (sourceFolderId) {
    const sourceFolder = nextFolders[sourceFolderId];
    if (!sourceFolder) {
      return state;
    }

    nextFolders[sourceFolderId] = {
      ...sourceFolder,
      tabIds: sourceFolder.tabIds.filter((tabId) => tabId !== draggedTabId),
    };
  }

  const targetIndex = nextEntries.findIndex((entry) => entry.id === targetEntryId);
  if (targetIndex === -1) {
    return state;
  }

  nextEntries = insertAtIndex(
    nextEntries,
    position === "before" ? targetIndex : targetIndex + 1,
    createSidebarTabEntry(draggedTabId),
  );

  return {
    ...state,
    entries: nextEntries,
    folders: nextFolders,
  };
}

function groupTabsInSidebar(
  state: WorkspaceSplitState,
  draggedTabId: string,
  targetTabId: string,
  folderLabel: string,
): WorkspaceSplitState {
  if (draggedTabId === targetTabId) {
    return state;
  }

  const sourceFolderId = findSidebarFolderForTabId(state, draggedTabId)?.id ?? null;
  const targetFolderId = findSidebarFolderForTabId(state, targetTabId)?.id ?? null;

  if (targetFolderId) {
    if (targetFolderId === sourceFolderId) {
      return state;
    }

    return moveTabIntoFolder(state, draggedTabId, targetFolderId);
  }

  let nextEntries = [...state.entries];
  const nextFolders = { ...state.folders };

  if (sourceFolderId) {
    const sourceFolder = nextFolders[sourceFolderId];
    if (!sourceFolder) {
      return state;
    }

    nextFolders[sourceFolderId] = {
      ...sourceFolder,
      tabIds: sourceFolder.tabIds.filter((tabId) => tabId !== draggedTabId),
    };
  } else {
    nextEntries = nextEntries.filter(
      (entry) => entry.kind !== "tab" || entry.tabId !== draggedTabId,
    );
  }

  const targetIndex = nextEntries.findIndex(
    (entry) => entry.kind === "tab" && entry.tabId === targetTabId,
  );
  if (targetIndex === -1) {
    return state;
  }

  const folderId = createFolderId();
  nextEntries.splice(targetIndex, 1, createSidebarFolderEntry(folderId));
  nextFolders[folderId] = {
    id: folderId,
    title: buildNextFolderTitle(nextFolders, folderLabel),
    tabIds: [targetTabId, draggedTabId],
    isExpanded: true,
  };

  return {
    ...state,
    entries: nextEntries,
    folders: nextFolders,
  };
}

function moveTabIntoFolder(
  state: WorkspaceSplitState,
  tabId: string,
  folderId: string,
): WorkspaceSplitState {
  const targetFolder = state.folders[folderId];
  if (!targetFolder) {
    return state;
  }

  const sourceFolderId = findSidebarFolderForTabId(state, tabId)?.id ?? null;
  if (sourceFolderId === folderId) {
    return state;
  }

  let nextEntries = [...state.entries];
  const nextFolders = { ...state.folders };

  if (sourceFolderId) {
    const sourceFolder = nextFolders[sourceFolderId];
    if (!sourceFolder) {
      return state;
    }

    nextFolders[sourceFolderId] = {
      ...sourceFolder,
      tabIds: sourceFolder.tabIds.filter((currentTabId) => currentTabId !== tabId),
    };
  } else {
    nextEntries = nextEntries.filter(
      (entry) => entry.kind !== "tab" || entry.tabId !== tabId,
    );
  }

  nextFolders[folderId] = {
    ...targetFolder,
    isExpanded: true,
    tabIds: [...targetFolder.tabIds.filter((currentTabId) => currentTabId !== tabId), tabId],
  };

  return {
    ...state,
    entries: nextEntries,
    folders: nextFolders,
  };
}

function removeFolderFromSidebar(
  state: WorkspaceSplitState,
  folderId: string,
): WorkspaceSplitState {
  if (!state.folders[folderId]) {
    return state;
  }

  return {
    ...state,
    entries: state.entries.filter(
      (entry) => entry.kind !== "folder" || entry.folderId !== folderId,
    ),
    folders: Object.fromEntries(
      Object.entries(state.folders).filter(([existingFolderId]) => existingFolderId !== folderId),
    ),
  };
}

function resolveSplitDragPreview(bounds: DOMRect, clientX: number, clientY: number): SplitDragPreview {
  const relativeX = bounds.width > 0 ? (clientX - bounds.left) / bounds.width : 0.5;
  const relativeY = bounds.height > 0 ? (clientY - bounds.top) / bounds.height : 0.5;
  const deltaX = relativeX - 0.5;
  const deltaY = relativeY - 0.5;

  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    return {
      mode: "horizontal",
      side: deltaX < 0 ? "left" : "right",
    };
  }

  return {
    mode: "vertical",
    side: deltaY < 0 ? "top" : "bottom",
  };
}

function getSplitDragPanelStyles(preview: SplitDragPreview) {
  const gap = `${SPLIT_PANEL_GAP}px`;

  if (preview.mode === "horizontal") {
    const width = `calc((100% - ${gap}) / 2)`;
    return preview.side === "left"
      ? {
        primary: { left: 0, top: 0, width, height: "100%" } satisfies React.CSSProperties,
        secondary: { right: 0, top: 0, width, height: "100%" } satisfies React.CSSProperties,
      }
      : {
        primary: { right: 0, top: 0, width, height: "100%" } satisfies React.CSSProperties,
        secondary: { left: 0, top: 0, width, height: "100%" } satisfies React.CSSProperties,
      };
  }

  const height = `calc((100% - ${gap}) / 2)`;
  return preview.side === "top"
    ? {
      primary: { left: 0, top: 0, width: "100%", height } satisfies React.CSSProperties,
      secondary: { left: 0, bottom: 0, width: "100%", height } satisfies React.CSSProperties,
    }
    : {
      primary: { left: 0, bottom: 0, width: "100%", height } satisfies React.CSSProperties,
      secondary: { left: 0, top: 0, width: "100%", height } satisfies React.CSSProperties,
    };
}

function getSplitDragHintKey(preview: SplitDragPreview): MessageKey {
  switch (preview.side) {
    case "left":
      return "splitDropLeft";
    case "right":
      return "splitDropRight";
    case "top":
      return "splitDropTop";
    case "bottom":
      return "splitDropBottom";
    default:
      return "splitViewLabel";
  }
}

export default function App() {
  const [tabs, setTabs] = useState<BrowserTabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("");
  const [currentWorkspace, setCurrentWorkspace] =
    useState<WorkspaceSummary>(previewWorkspace);
  const [currentWindow, setCurrentWindow] = useState<WindowSummary>(previewWindow);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([
    previewWorkspace,
  ]);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [showUrlBar, setShowUrlBar] = useState(false);
  const [isUrlBarPinnedOpen, setIsUrlBarPinnedOpen] = useState(true);
  const [isUrlBarShortcutCollapsed, setIsUrlBarShortcutCollapsed] = useState(false);
  const [isUrlBarFocused, setIsUrlBarFocused] = useState(false);
  const [isAiSidebarOpen, setIsAiSidebarOpen] = useState(false);
  const [isUserScriptPanelOpen, setIsUserScriptPanelOpen] = useState(false);
  const [isPageSearchVisible, setIsPageSearchVisible] = useState(false);
  const [pageSearchQuery, setPageSearchQuery] = useState("");
  const [pageSearchTargetTabId, setPageSearchTargetTabId] = useState<string | null>(null);
  const [pageSearchResult, setPageSearchResult] = useState<PageSearchResultPayload | null>(null);
  const [pageSearchFocusToken, setPageSearchFocusToken] = useState(0);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [toolbarExtensions, setToolbarExtensions] = useState<BrowserExtensionSummary[]>([]);
  const [userScripts, setUserScripts] = useState<UserScriptRecord[]>([]);
  const [showBookmarkManager, setShowBookmarkManager] = useState(false);
  const [bookmarkQuery, setBookmarkQuery] = useState("");
  const [bookmarkTitleInput, setBookmarkTitleInput] = useState("");
  const [bookmarkUrlInput, setBookmarkUrlInput] = useState("");
  const [bookmarkError, setBookmarkError] = useState<string | null>(null);
  const [editingBookmarkId, setEditingBookmarkId] = useState<string | null>(null);
  const [editingBookmarkTitle, setEditingBookmarkTitle] = useState("");
  const [editingBookmarkUrl, setEditingBookmarkUrl] = useState("");
  const [isSavingBookmark, setIsSavingBookmark] = useState(false);
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null);
  const [tabDropTarget, setTabDropTarget] = useState<TabDropTarget | null>(null);
  const [sidebarEntryDropTarget, setSidebarEntryDropTarget] =
    useState<SidebarEntryDropTarget | null>(null);
  const [groupDropTargetTabId, setGroupDropTargetTabId] = useState<string | null>(null);
  const [folderDropTargetId, setFolderDropTargetId] = useState<string | null>(null);
  const [splitDragPreview, setSplitDragPreview] = useState<SplitDragPreview | null>(null);
  const [workspaceSplitStates, setWorkspaceSplitStates] = useState<Record<string, WorkspaceSplitState>>({});
  const workspaceSplitStatesRef = useRef<Record<string, WorkspaceSplitState>>({});
  const [splitSurfaceSize, setSplitSurfaceSize] = useState({ width: 0, height: 0 });
  const [theme, setTheme] = useState<string>("system");
  const [language, setLanguage] = useState<string>("system");
  const [startPageAppearance, setStartPageAppearance] = useState<StartPageAppearance>({
    backgroundImage: null,
  });
  const [startPageBackgroundImageMetrics, setStartPageBackgroundImageMetrics] =
    useState<StartPageBackgroundImageMetrics | null>(null);
  const [shellViewportSize, setShellViewportSize] = useState(() => ({
    height: typeof window !== "undefined" ? Math.max(0, Math.round(window.innerHeight)) : 0,
    width: typeof window !== "undefined" ? Math.max(0, Math.round(window.innerWidth)) : 0,
  }));
  const [copyLinkFeedback, setCopyLinkFeedback] = useState<"idle" | "ok" | "err">("idle");
  const workspaceSwitchInFlightRef = useRef(false);
  const workspaceWheelGestureRef = useRef<{
    hasSwitched: boolean;
    resetTimerId: number | null;
  }>({ hasSwitched: false, resetTimerId: null });
  const suppressTabSelectRef = useRef(false);
  const aiSidebarOpenTimerRef = useRef<number | null>(null);
  const tabDragResetTimerRef = useRef<number | null>(null);
  const workspaceSwipeStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    hasSwitched: boolean;
    captureTarget: HTMLElement | null;
  } | null>(null);
  const topLoadingIntervalRef = useRef<number | null>(null);
  const topLoadingResetTimerRef = useRef<number | null>(null);
  const copyLinkResetTimerRef = useRef<number | null>(null);
  const pageSearchInputRef = useRef<HTMLInputElement | null>(null);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const pageSearchTargetTabIdRef = useRef<string | null>(null);
  const pageSearchQueryRef = useRef("");
  const splitSurfaceRef = useRef<HTMLDivElement | null>(null);
  const currentWorkspaceIdRef = useRef(previewWorkspace.id);
  const sidebarTabListRef = useRef<HTMLDivElement | null>(null);
  const sidebarEntryRefs = useRef(new Map<string, HTMLDivElement>());
  const sidebarSyncRequestRef = useRef(0);
  const sidebarHydratedWorkspaceIdsRef = useRef(new Set<string>());
  const pendingSidebarOrganizationStatesRef = useRef<Record<string, WorkspaceSplitState>>({});
  const topLoadingProgressRef = useRef(0);
  const [systemPrefersLight, setSystemPrefersLight] = useState(
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches,
  );
  const [showTopLoadingBar, setShowTopLoadingBar] = useState(false);
  const [topLoadingProgress, setTopLoadingProgress] = useState(0);
  const [sidebarActiveIndicator, setSidebarActiveIndicator] =
    useState<SidebarActiveIndicatorMetrics | null>(null);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: light)");
    const handler = (e: MediaQueryListEvent) => setSystemPrefersLight(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  useLayoutEffect(() => {
    workspaceSplitStatesRef.current = workspaceSplitStates;
    currentWorkspaceIdRef.current = currentWorkspace.id;
  }, [currentWorkspace.id, workspaceSplitStates]);

  const resolvedTheme = theme === "system"
    ? (systemPrefersLight ? "light" : "dark")
    : theme;
  const resolvedLocale = resolveLocale(
    normalizeLanguageSetting(language),
    typeof navigator !== "undefined" ? navigator.language : "en-US",
  );
  const t = useCallback(
    (key: MessageKey) => messages[resolvedLocale][key],
    [resolvedLocale],
  );
  const isLight = resolvedTheme === "light";
  const chromeGlassBackdropFilter = "saturate(180%) blur(28px)";
  const chromeGlassSidebarInsetShadow = isLight
    ? "inset 0 1px 0 rgba(255, 255, 255, 0.45)"
    : "inset 0 1px 0 rgba(255, 255, 255, 0.14)";
  const chromeGlassMainInsetShadow = isLight
    ? "inset 0 -1px 0 rgba(255, 255, 255, 0.18)"
    : "inset 0 -1px 0 rgba(255, 255, 255, 0.08)";

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const isActiveTabLoading = Boolean(activeTab?.isLoading);
  const canShowAiSidebarButton = !isMiloInternalPageTab(activeTab);
  const currentUserScriptTargetUrl = (activeTab?.url ?? activeTab?.displayUrl ?? "").trim();
  const userScriptsForPanel = useMemo(
    () => userScripts
      .map((script) => ({
        script,
        matchesCurrentUrl: userScriptMatchesUrl(script, currentUserScriptTargetUrl),
      }))
      .sort((left, right) => {
        if (left.matchesCurrentUrl !== right.matchesCurrentUrl) {
          return left.matchesCurrentUrl ? -1 : 1;
        }

        if (left.script.enabled !== right.script.enabled) {
          return left.script.enabled ? -1 : 1;
        }

        return right.script.updatedAt - left.script.updatedAt;
      }),
    [currentUserScriptTargetUrl, userScripts],
  );
  const enabledCurrentPageUserScriptCount = userScriptsForPanel.filter(
    (entry) => entry.matchesCurrentUrl && entry.script.enabled,
  ).length;
  const extensionActionCount = toolbarExtensions.filter((extension) =>
    extension.enabled
    && extension.loaded
    && Boolean(extension.action?.popupUrl)
  ).length;
  const isElectronShell =
    typeof window !== "undefined" && typeof window.browserShell !== "undefined";
  const tabLookup = useMemo(
    () => new Map(tabs.map((tab) => [tab.id, tab])),
    [tabs],
  );
  const currentWorkspaceSplitState = workspaceSplitStates[currentWorkspace.id]
    ?? createDefaultWorkspaceSplitState(tabs, activeTabId);
  const hasStoredCurrentWorkspaceSplitState = Boolean(workspaceSplitStates[currentWorkspace.id]);
  const applySidebarOrganizationStateSnapshot = useCallback((
    workspaceId: string,
    state: WorkspaceSplitState,
    tabList: BrowserTabState[],
    nextActiveTabId?: string,
  ) => {
    const pendingState = pendingSidebarOrganizationStatesRef.current[workspaceId];
    const pendingTabCount = pendingState
      ? collectWorkspaceSplitStateTabIds(pendingState).size
      : 0;
    const incomingTabCount = collectWorkspaceSplitStateTabIds(state).size;
    const stateToApply = pendingState && pendingTabCount > incomingTabCount
      ? pendingState
      : state;

    if (tabList.length === 0) {
      pendingSidebarOrganizationStatesRef.current = {
        ...pendingSidebarOrganizationStatesRef.current,
        [workspaceId]: stateToApply,
      };
      return;
    }

    if (hasWorkspaceSplitStateMissingTabs(stateToApply, tabList)) {
      pendingSidebarOrganizationStatesRef.current = {
        ...pendingSidebarOrganizationStatesRef.current,
        [workspaceId]: stateToApply,
      };
      return;
    }

    const nextState = reconcileWorkspaceSplitState(stateToApply, tabList, nextActiveTabId);
    sidebarHydratedWorkspaceIdsRef.current.add(workspaceId);
    const remainingPendingStates = { ...pendingSidebarOrganizationStatesRef.current };
    delete remainingPendingStates[workspaceId];
    pendingSidebarOrganizationStatesRef.current = remainingPendingStates;
    workspaceSplitStatesRef.current = {
      ...workspaceSplitStatesRef.current,
      [workspaceId]: nextState,
    };
    setWorkspaceSplitStates((currentStates) => {
      const currentState = currentStates[workspaceId];
      if (currentState && areWorkspaceSplitStatesEqual(currentState, nextState)) {
        return currentStates;
      }

      return {
        ...currentStates,
        [workspaceId]: nextState,
      };
    });
  }, []);
  const visibleWorkspaces = workspaces.filter((workspace) => !isAutomationWorkspace(workspace));
  const isCurrentAutomationWorkspace = isAutomationWorkspace(currentWorkspace);
  const activeSidebarEntry = findSidebarEntryById(
    currentWorkspaceSplitState,
    currentWorkspaceSplitState.activeEntryId,
  ) ?? findSidebarEntryById(
    currentWorkspaceSplitState,
    resolveFirstFocusableSidebarEntryId(currentWorkspaceSplitState),
  );
  const activeSplit = activeSidebarEntry?.kind === "split"
    ? currentWorkspaceSplitState.splits[activeSidebarEntry.splitId] ?? null
    : null;
  const activeSidebarTabId = activeSidebarEntry?.kind === "tab"
    ? activeSidebarEntry.tabId
    : null;
  const activeSidebarFolder = activeSidebarEntry?.kind === "tab"
    ? findSidebarFolderForTabId(currentWorkspaceSplitState, activeSidebarEntry.tabId)
    : null;
  const sidebarWidth = isSidebarCollapsed
    ? SIDEBAR_COLLAPSED_WIDTH
    : SIDEBAR_EXPANDED_WIDTH;
  const isUrlBarVisible =
    (Boolean(activeSplit) && !isUrlBarShortcutCollapsed)
    || isUrlBarPinnedOpen
    || showUrlBar
    || isUrlBarFocused
    || isUserScriptPanelOpen;
  const browserTopChromeHeight = isUrlBarVisible
    ? URL_BAR_HEIGHT
    : URL_BAR_HOVER_TRIGGER_HEIGHT;
  const pageSearchReservedHeight = isPageSearchVisible
    ? PAGE_SEARCH_BAR_HEIGHT
    : 0;
  const browserContentTopOffset = browserTopChromeHeight + pageSearchReservedHeight;
  const orderedBookmarks = [...bookmarks].sort((a, b) => b.createdAt - a.createdAt);
  const managedBookmarks = orderedBookmarks.filter((bookmark) => {
    const query = bookmarkQuery.trim().toLowerCase();
    if (!query) return true;
    return (
      bookmark.title.toLowerCase().includes(query)
      || bookmark.url.toLowerCase().includes(query)
    );
  });
  const currentWorkspaceIndex = visibleWorkspaces.findIndex(
    (workspace) => workspace.id === currentWorkspace.id,
  );
  const currentWorkspaceIcon =
    (currentWorkspace as WorkspaceSummary & { icon?: string | undefined }).icon;
  const currentWorkspaceAvatar = getWorkspaceInitial(currentWorkspace.name);
  const currentWorkspacePalette = getWorkspacePalette(currentWorkspace.name, isLight);
  const currentWorkspaceAvatarStyle = currentWorkspacePalette.avatarStyle;
  const sharedChromeSurfaceBaseStyle: React.CSSProperties = {
    backdropFilter: chromeGlassBackdropFilter,
    WebkitBackdropFilter: chromeGlassBackdropFilter,
  };
  const sharedChromeSurfaceStyle: React.CSSProperties = {
    ...sharedChromeSurfaceBaseStyle,
    background: currentWorkspacePalette.chromeSurfaceBackground,
  };
  const sidebarChromeSurfaceStyle: React.CSSProperties =
    startPageAppearance.backgroundImage
      ? {
        ...sharedChromeSurfaceBaseStyle,
        ...buildStartPageSurfaceBackgroundStyle({
          backgroundImage: startPageAppearance.backgroundImage,
          fallbackBackground: currentWorkspacePalette.chromeSurfaceBackground,
          imageMetrics: startPageBackgroundImageMetrics,
          isLight,
          shellFrame:
            shellViewportSize.width > 0 && shellViewportSize.height > 0
              ? shellViewportSize
              : null,
          surfaceRect:
            sidebarWidth > 0 && shellViewportSize.height > 0
              ? {
                height: shellViewportSize.height,
                width: sidebarWidth,
                x: 0,
                y: 0,
              }
              : null,
        }),
      }
      : sharedChromeSurfaceStyle;
  const mainChromeSurfaceStyle: React.CSSProperties =
    startPageAppearance.backgroundImage
      ? {
        ...sharedChromeSurfaceBaseStyle,
        ...buildStartPageSurfaceBackgroundStyle({
          backgroundImage: startPageAppearance.backgroundImage,
          fallbackBackground: currentWorkspacePalette.chromeSurfaceBackground,
          imageMetrics: startPageBackgroundImageMetrics,
          isLight,
          shellFrame:
            shellViewportSize.width > 0 && shellViewportSize.height > 0
              ? shellViewportSize
              : null,
          surfaceRect:
            shellViewportSize.width > sidebarWidth && shellViewportSize.height > 0
              ? {
                height: shellViewportSize.height,
                width: shellViewportSize.width - sidebarWidth,
                x: sidebarWidth,
                y: 0,
              }
              : null,
        }),
      }
      : sharedChromeSurfaceStyle;
  const copyLinkTarget = (activeTab?.displayUrl ?? activeTab?.url ?? urlInput).trim();
  const copyLinkButtonLabel = copyLinkFeedback === "ok"
    ? t("copyLinkCopied")
    : copyLinkFeedback === "err"
      ? t("copyLinkFailed")
      : t("copyLinkAction");
  const layoutUrlBarHeight = browserContentTopOffset;
  const browserSurfaceTop = layoutUrlBarHeight + BROWSER_SURFACE_TOP_INSET;
  const browserSurfaceContentTop = browserSurfaceTop + TOP_LOADING_BAR_HEIGHT;
  const pageSearchTop = browserTopChromeHeight + 8;
  const toggleBrowserChrome = useCallback(() => {
    const shouldCollapse = !isSidebarCollapsed && isUrlBarVisible;

    if (shouldCollapse) {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement) {
        activeElement.blur();
      }

      setIsSidebarCollapsed(true);
      setIsUrlBarPinnedOpen(false);
      setIsUrlBarShortcutCollapsed(true);
      setIsUrlBarFocused(false);
      setIsUserScriptPanelOpen(false);
      setShowUrlBar(false);
      return;
    }

    setIsSidebarCollapsed(false);
    setIsUrlBarPinnedOpen(true);
    setIsUrlBarShortcutCollapsed(false);
    setShowUrlBar(true);
  }, [isSidebarCollapsed, isUrlBarVisible]);
  const standaloneSidebarTabIds = getStandaloneSidebarTabIds(currentWorkspaceSplitState);
  const canCreateSplitByDrag =
    !activeSplit
    && activeSidebarEntry?.kind === "tab"
    && !activeSidebarFolder
    && standaloneSidebarTabIds.length >= 2;
  const canAddTabToActiveSplit =
    Boolean(activeSplit)
    && standaloneSidebarTabIds.length >= 1;
  const canDragSidebarTabs = tabs.length > 1;
  const canDragSidebarEntries = currentWorkspaceSplitState.entries.length > 1;
  const canCreatePairSplit =
    activeSidebarEntry?.kind === "tab"
    && !activeSidebarFolder
    && standaloneSidebarTabIds.length >= 2;
  const canCreateBentoSplit =
    activeSidebarEntry?.kind === "tab"
    && !activeSidebarFolder
    && standaloneSidebarTabIds.length >= 2;
  const canOpenSplitToolbarMenu = Boolean(
    activeSplit || (activeSidebarEntry?.kind === "tab" && !activeSidebarFolder),
  );
  const sidebarActiveIndicatorEntryId = activeSidebarEntry?.kind === "tab" && activeSidebarFolder
    && (isSidebarCollapsed || !activeSidebarFolder.isExpanded)
    ? createSidebarFolderEntry(activeSidebarFolder.id).id
    : activeSidebarEntry?.id ?? null;
  const splitDragOverlayVisible =
    activeTabId.length > 0
    && draggedTabId !== null
    && (
      (activeSplit && !activeSplit.tabIds.includes(draggedTabId))
      || (
        !activeSplit
        && activeSidebarEntry?.kind === "tab"
        && !activeSidebarFolder
        && draggedTabId !== activeTabId
      )
    );
  const splitPanels = useMemo(
    () => (
      activeSplit
        ? buildSplitPanels(activeSplit, splitSurfaceSize.width, splitSurfaceSize.height)
        : []
    ),
    [activeSplit, splitSurfaceSize.height, splitSurfaceSize.width],
  );
  const surfacedTab = (activeSplit?.focusedTabId
    ? tabLookup.get(activeSplit.focusedTabId)
    : undefined) ?? activeTab;
  const surfacedManualInterventionMessage = surfacedTab?.manualInterventionMessage;
  const currentPageSearchFocusTabId = activeSplit?.focusedTabId ?? activeTabId;
  const pageSearchHasNoMatches = Boolean(
    pageSearchQuery
    && pageSearchResult?.finalUpdate
    && pageSearchResult.matches === 0,
  );
  const pageSearchCanStepThroughMatches = Boolean(
    pageSearchQuery && (pageSearchResult?.matches ?? 0) > 0,
  );
  const pageSearchCountLabel = !pageSearchQuery
    ? ""
    : pageSearchResult
      ? pageSearchResult.matches > 0
        ? `${Math.max(1, pageSearchResult.activeMatchOrdinal)}/${pageSearchResult.matches}`
        : t("findInPageNoMatches")
      : "\u00A0";

  const setSidebarEntryRef = useCallback((entryId: string, node: HTMLDivElement | null) => {
    if (node) {
      sidebarEntryRefs.current.set(entryId, node);
      return;
    }

    sidebarEntryRefs.current.delete(entryId);
  }, []);

  const updateSidebarActiveIndicator = useCallback(() => {
    const listElement = sidebarTabListRef.current;
    const activeEntryId = sidebarActiveIndicatorEntryId;
    const activeEntryElement = activeEntryId
      ? sidebarEntryRefs.current.get(activeEntryId)
      : null;

    if (!listElement || !activeEntryElement) {
      setSidebarActiveIndicator(null);
      return;
    }

    const listRect = listElement.getBoundingClientRect();
    const entryRect = activeEntryElement.getBoundingClientRect();
    const nextMetrics = {
      top: entryRect.top - listRect.top,
      left: entryRect.left - listRect.left,
      width: entryRect.width,
      height: entryRect.height,
    } satisfies SidebarActiveIndicatorMetrics;

    setSidebarActiveIndicator((currentMetrics) => {
      if (
        currentMetrics
        && Math.abs(currentMetrics.top - nextMetrics.top) < 0.5
        && Math.abs(currentMetrics.left - nextMetrics.left) < 0.5
        && Math.abs(currentMetrics.width - nextMetrics.width) < 0.5
        && Math.abs(currentMetrics.height - nextMetrics.height) < 0.5
      ) {
        return currentMetrics;
      }

      return nextMetrics;
    });
  }, [sidebarActiveIndicatorEntryId]);

  useLayoutEffect(() => {
    updateSidebarActiveIndicator();
  }, [
    currentWorkspaceSplitState.entries,
    currentWorkspaceSplitState.folders,
    isSidebarCollapsed,
    tabs,
    updateSidebarActiveIndicator,
  ]);

  useEffect(() => {
    const listElement = sidebarTabListRef.current;
    const activeEntryId = sidebarActiveIndicatorEntryId;
    const activeEntryElement = activeEntryId
      ? sidebarEntryRefs.current.get(activeEntryId)
      : null;

    if (!listElement || !activeEntryElement || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      updateSidebarActiveIndicator();
    });
    observer.observe(listElement);
    observer.observe(activeEntryElement);

    return () => {
      observer.disconnect();
    };
  }, [sidebarActiveIndicatorEntryId, updateSidebarActiveIndicator]);

  // Listen for tab state updates from main process
  useEffect(() => {
    if (!window.browserShell) return;

    const dispose = window.browserShell.onTabStateUpdate((payload) => {
      const payloadWorkspaceId = typeof payload.workspaceId === "string" && payload.workspaceId.trim()
        ? payload.workspaceId.trim()
        : currentWorkspaceIdRef.current;
      if (payloadWorkspaceId !== currentWorkspaceIdRef.current) {
        return;
      }

      const nextTabs = toBrowserTabs(payload.tabs);
      const workspaceId = payloadWorkspaceId;
      setTabs((currentTabs) => (areBrowserTabsEqual(currentTabs, nextTabs) ? currentTabs : nextTabs));
      const nextActiveTabId = payload.activeTabId;
      if (nextActiveTabId) {
        setActiveTabId((currentActiveTabId) => (
          currentActiveTabId === nextActiveTabId ? currentActiveTabId : nextActiveTabId
        ));
      }
      const pendingState = pendingSidebarOrganizationStatesRef.current[workspaceId];
      if (pendingState) {
        applySidebarOrganizationStateSnapshot(
          workspaceId,
          pendingState,
          nextTabs,
          payload.activeTabId ?? nextTabs[0]?.id,
        );
      }
    });

    return () => {
      dispose?.();
    };
  }, [applySidebarOrganizationStateSnapshot]);

  useEffect(() => {
    if (!window.browserShell) {
      return;
    }

    const dispose = window.browserShell.onFolderSettingsUpdated((payload) => {
      setWorkspaceSplitStates((currentStates) => {
        const workspaceState = currentStates[payload.workspaceId];
        if (!workspaceState) {
          return currentStates;
        }

        const folder = workspaceState.folders[payload.folderId];
        if (!folder) {
          return currentStates;
        }

        const nextTitle = payload.name.trim() || folder.title;
        const nextIcon = payload.icon?.trim() || undefined;
        const nextBackgroundColor = normalizeFolderBackgroundColor(payload.backgroundColor);
        if (
          folder.title === nextTitle
          && folder.icon === nextIcon
          && folder.backgroundColor === nextBackgroundColor
        ) {
          return currentStates;
        }

        const nextFolder: SidebarFolderState = {
          ...folder,
          title: nextTitle,
          icon: nextIcon,
        };
        if (nextBackgroundColor) {
          nextFolder.backgroundColor = nextBackgroundColor;
        } else {
          delete nextFolder.backgroundColor;
        }

        return {
          ...currentStates,
          [payload.workspaceId]: {
            ...workspaceState,
            folders: {
              ...workspaceState.folders,
              [folder.id]: nextFolder,
            },
          },
        };
      });
    });

    return () => {
      dispose?.();
    };
  }, []);

  useEffect(() => {
    if (!window.browserShell) {
      return;
    }

    const dispose = window.browserShell.onSidebarOrganizationStateApplied((payload) => {
      setWorkspaceSplitStates((currentStates) => {
        const nextState = payload.state as WorkspaceSplitState;
        const currentState = currentStates[payload.workspaceId];
        if (currentState && areWorkspaceSplitStatesEqual(currentState, nextState)) {
          return currentStates;
        }

        return {
          ...currentStates,
          [payload.workspaceId]: nextState,
        };
      });
    });

    return () => {
      dispose?.();
    };
  }, []);

  // Sync URL input with active tab
  useEffect(() => {
    setUrlInput(activeTab?.displayUrl ?? "");
  }, [activeTabId, activeTab?.displayUrl]);

  useEffect(() => {
    setWorkspaceSplitStates((current) => {
      const previousState = current[currentWorkspace.id]
        ?? createDefaultWorkspaceSplitState(tabs, activeTabId);
      const nextState = reconcileWorkspaceSplitState(previousState, tabs, activeTabId);
      if (areWorkspaceSplitStatesEqual(previousState, nextState)) {
        return current;
      }

      return {
        ...current,
        [currentWorkspace.id]: nextState,
      };
    });
  }, [activeTabId, currentWorkspace.id, tabs]);

  useEffect(() => {
    if (
      !window.browserShell
      || !currentWorkspace.id
      || tabs.length === 0
      || !hasStoredCurrentWorkspaceSplitState
    ) {
      return;
    }
    if (!sidebarHydratedWorkspaceIdsRef.current.has(currentWorkspace.id)) {
      return;
    }

    const workspaceId = currentWorkspace.id;
    const requestId = sidebarSyncRequestRef.current + 1;
    sidebarSyncRequestRef.current = requestId;
    void window.browserShell.sidebarSyncState({
      workspaceId,
      state: currentWorkspaceSplitState as SidebarOrganizationState,
      sequence: requestId,
    }).then((syncedState) => {
      if (sidebarSyncRequestRef.current !== requestId) {
        return;
      }

      setWorkspaceSplitStates((currentStates) => {
        const nextState = syncedState as WorkspaceSplitState;
        const currentState = currentStates[workspaceId];
        if (currentState && areWorkspaceSplitStatesEqual(currentState, nextState)) {
          return currentStates;
        }

        return {
          ...currentStates,
          [workspaceId]: nextState,
        };
      });
    }).catch(() => undefined);
  }, [currentWorkspace.id, currentWorkspaceSplitState, hasStoredCurrentWorkspaceSplitState, tabs.length]);

  useLayoutEffect(() => {
    if (!activeSplit || !splitSurfaceRef.current) {
      setSplitSurfaceSize((currentSize) => (
        currentSize.width === 0 && currentSize.height === 0
          ? currentSize
          : { width: 0, height: 0 }
      ));
      return;
    }

    const node = splitSurfaceRef.current;
    const syncSize = () => {
      const nextSize = {
        width: Math.max(0, Math.round(node.clientWidth)),
        height: Math.max(0, Math.round(node.clientHeight)),
      };
      setSplitSurfaceSize((currentSize) => (
        currentSize.width === nextSize.width && currentSize.height === nextSize.height
          ? currentSize
          : nextSize
      ));
    };

    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [activeSplit?.id]);

  useEffect(() => {
    if (!splitDragOverlayVisible && splitDragPreview) {
      setSplitDragPreview(null);
    }
  }, [splitDragOverlayVisible, splitDragPreview]);

  // Theme management
  useEffect(() => {
    if (!window.browserShell) return;
    void window.browserShell.settingsGetTheme().then(setTheme);
  }, []);

  useEffect(() => {
    if (!window.browserShell) return;
    return window.browserShell.onThemeChanged(setTheme);
  }, []);

  useEffect(() => {
    if (!window.browserShell) return;
    void window.browserShell.settingsGetLanguage().then(setLanguage).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!window.browserShell) return;
    return window.browserShell.onLanguageChanged(setLanguage);
  }, []);

  useLayoutEffect(() => {
    const syncShellViewport = () => {
      const nextViewportSize = {
        height: Math.max(0, Math.round(window.innerHeight)),
        width: Math.max(0, Math.round(window.innerWidth)),
      };

      setShellViewportSize((currentSize) => (
        currentSize.width === nextViewportSize.width
        && currentSize.height === nextViewportSize.height
          ? currentSize
          : nextViewportSize
      ));
    };

    syncShellViewport();
    window.addEventListener("resize", syncShellViewport);

    return () => {
      window.removeEventListener("resize", syncShellViewport);
    };
  }, []);

  useEffect(() => {
    if (!window.browserShell?.startPageGetAppearance) return;

    let disposed = false;

    void window.browserShell.startPageGetAppearance()
      .then((appearance) => {
        if (!disposed) {
          setStartPageAppearance(appearance);
        }
      })
      .catch(() => undefined);

    const dispose = window.browserShell.onStartPageAppearanceChanged?.((appearance) => {
      if (!disposed) {
        setStartPageAppearance(appearance);
      }
    });

    return () => {
      disposed = true;
      dispose?.();
    };
  }, [currentWorkspace.id]);

  useEffect(() => {
    const backgroundImage = startPageAppearance.backgroundImage?.trim();
    if (!backgroundImage) {
      setStartPageBackgroundImageMetrics(null);
      return;
    }

    let cancelled = false;

    void loadStartPageBackgroundImageMetrics(backgroundImage)
      .then((metrics) => {
        if (!cancelled) {
          setStartPageBackgroundImageMetrics(metrics);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStartPageBackgroundImageMetrics(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [startPageAppearance.backgroundImage]);

  useEffect(() => {
    document.documentElement.lang = resolvedLocale;
  }, [resolvedLocale]);

  function clearTopLoadingTimers() {
    if (topLoadingIntervalRef.current !== null) {
      window.clearInterval(topLoadingIntervalRef.current);
      topLoadingIntervalRef.current = null;
    }

    if (topLoadingResetTimerRef.current !== null) {
      window.clearTimeout(topLoadingResetTimerRef.current);
      topLoadingResetTimerRef.current = null;
    }
  }

  function updateTopLoadingProgress(next: number | ((current: number) => number)) {
    setTopLoadingProgress((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      topLoadingProgressRef.current = resolved;
      return resolved;
    });
  }

  useEffect(() => {
    clearTopLoadingTimers();

    if (isActiveTabLoading) {
      setShowTopLoadingBar(true);
      updateTopLoadingProgress((current) => (current > 12 ? current : 12));
      topLoadingIntervalRef.current = window.setInterval(() => {
        updateTopLoadingProgress((current) => {
          if (current >= 88) {
            return current;
          }

          const step = current < 28 ? 14 : current < 52 ? 8 : current < 72 ? 4 : 2;
          return Math.min(88, current + step);
        });
      }, 160);

      return () => {
        clearTopLoadingTimers();
      };
    }

    if (topLoadingProgressRef.current === 0) {
      return () => {
        clearTopLoadingTimers();
      };
    }

    updateTopLoadingProgress((current) => (current < 92 ? 92 : current));
    topLoadingResetTimerRef.current = window.setTimeout(() => {
      updateTopLoadingProgress(100);
      topLoadingResetTimerRef.current = window.setTimeout(() => {
        setShowTopLoadingBar(false);
        updateTopLoadingProgress(0);
        topLoadingResetTimerRef.current = null;
      }, 220);
    }, 60);

    return () => {
      clearTopLoadingTimers();
    };
  }, [activeTabId, isActiveTabLoading]);

  useEffect(() => {
    return () => {
      if (aiSidebarOpenTimerRef.current !== null) {
        window.clearTimeout(aiSidebarOpenTimerRef.current);
      }
      if (tabDragResetTimerRef.current !== null) {
        window.clearTimeout(tabDragResetTimerRef.current);
      }
      resetWorkspaceWheelGesture();
      clearTopLoadingTimers();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (copyLinkResetTimerRef.current !== null) {
        window.clearTimeout(copyLinkResetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    pageSearchTargetTabIdRef.current = pageSearchTargetTabId;
  }, [pageSearchTargetTabId]);

  useEffect(() => {
    pageSearchQueryRef.current = pageSearchQuery;
  }, [pageSearchQuery]);

  const retargetPageSearch = useCallback((nextTabId: string | null) => {
    const previousTabId = pageSearchTargetTabIdRef.current;
    if (previousTabId === nextTabId) {
      setPageSearchTargetTabId(nextTabId);
      return;
    }

    if (previousTabId && previousTabId !== nextTabId && window.browserShell) {
      void window.browserShell.pageSearchStop(previousTabId, "clearSelection").catch(() => undefined);
    }

    setPageSearchResult(null);
    pageSearchQueryRef.current = "";
    setPageSearchQuery("");
    setPageSearchTargetTabId(nextTabId);
  }, []);

  const closePageSearch = useCallback(() => {
    const activeTargetTabId = pageSearchTargetTabIdRef.current;
    if (activeTargetTabId && window.browserShell) {
      void window.browserShell.pageSearchStop(activeTargetTabId, "clearSelection").catch(() => undefined);
    }

    setIsPageSearchVisible(false);
    setPageSearchResult(null);
    setPageSearchTargetTabId(null);
  }, []);

  const stepPageSearchMatch = useCallback((forward: boolean) => {
    const activeTargetTabId = pageSearchTargetTabIdRef.current;
    const query = pageSearchQueryRef.current;
    if (!activeTargetTabId || !query || !window.browserShell) {
      return;
    }

    void window.browserShell.pageSearchFind({
      tabId: activeTargetTabId,
      query,
      findNext: false,
      forward,
    }).catch(() => undefined);
  }, []);

  const openPageSearch = useCallback(() => {
    if (!currentPageSearchFocusTabId) {
      return;
    }

    setShowUrlBar(true);
    retargetPageSearch(currentPageSearchFocusTabId);
    setIsPageSearchVisible(true);
    setPageSearchFocusToken((current) => current + 1);
  }, [currentPageSearchFocusTabId, retargetPageSearch]);

  useEffect(() => {
    if (!window.browserShell) {
      return;
    }

    return window.browserShell.onPageSearchRequested(() => {
      openPageSearch();
    });
  }, [openPageSearch]);

  useEffect(() => {
    if (!window.browserShell) {
      return;
    }

    return window.browserShell.onPageSearchResult((payload) => {
      if (payload.tabId !== pageSearchTargetTabIdRef.current) {
        return;
      }
      if (payload.query !== pageSearchQueryRef.current) {
        return;
      }

      setPageSearchResult(payload);
    });
  }, []);

  useEffect(() => {
    if (!isPageSearchVisible) {
      return;
    }

    if (!currentPageSearchFocusTabId) {
      closePageSearch();
      return;
    }

    if (pageSearchTargetTabId !== currentPageSearchFocusTabId) {
      retargetPageSearch(currentPageSearchFocusTabId);
    }
  }, [
    closePageSearch,
    currentPageSearchFocusTabId,
    isPageSearchVisible,
    pageSearchTargetTabId,
    retargetPageSearch,
  ]);

  useEffect(() => {
    if (!isPageSearchVisible) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const input = pageSearchInputRef.current;
      if (!input) {
        return;
      }

      input.focus({ preventScroll: true });
      input.select();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [isPageSearchVisible, pageSearchFocusToken]);

  useEffect(() => {
    if (!isPageSearchVisible || !window.browserShell || !pageSearchTargetTabId) {
      return;
    }

    if (!pageSearchQuery) {
      setPageSearchResult(null);
      void window.browserShell.pageSearchFind({
        tabId: pageSearchTargetTabId,
        query: "",
        findNext: true,
        forward: true,
      }).catch(() => undefined);
      return;
    }

    setPageSearchResult(null);
    void window.browserShell.pageSearchFind({
      tabId: pageSearchTargetTabId,
      query: pageSearchQuery,
      findNext: true,
      forward: true,
    }).catch(() => undefined);
  }, [isPageSearchVisible, pageSearchQuery, pageSearchTargetTabId]);

  useEffect(() => {
    if (!isPageSearchVisible) {
      return;
    }

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      closePageSearch();
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [closePageSearch, isPageSearchVisible]);

  useEffect(() => {
    return () => {
      const activeTargetTabId = pageSearchTargetTabIdRef.current;
      if (activeTargetTabId && window.browserShell) {
        void window.browserShell.pageSearchStop(activeTargetTabId, "clearSelection").catch(() => undefined);
      }
    };
  }, []);

  // Load bookmarks & listen for changes from search overlay
  useEffect(() => {
    if (!window.browserShell) return;
    void window.browserShell.bookmarksList().then(setBookmarks).catch(() => undefined);
  }, [currentWorkspace.profileId]);

  useEffect(() => {
    if (!window.browserShell) return;
    const refresh = () => {
      void window.browserShell?.bookmarksList().then(setBookmarks).catch(() => undefined);
    };
    // Refresh bookmarks when search overlay closes (main process sends bookmarks:changed)
    window.addEventListener("bookmarks:changed" as any, refresh);
    return () => {
      window.removeEventListener("bookmarks:changed" as any, refresh);
    };
  }, []);

  const isCurrentPageBookmarked = bookmarks.some(
    (b) => b.url === activeTab?.url || b.url === activeTab?.displayUrl,
  );

  const toggleBookmark = useCallback(async () => {
    if (!window.browserShell || !activeTab) return;
    const targetUrl = activeTab.url === "home://start" ? undefined : activeTab.url;
    if (!targetUrl) return;
    setBookmarkError(null);
    if (isCurrentPageBookmarked) {
      const bm = bookmarks.find((b) => b.url === targetUrl || b.url === activeTab.displayUrl);
      if (bm) {
        const updated = await window.browserShell.bookmarksRemove(bm.id);
        setBookmarks(updated);
      }
    } else {
      const updated = await window.browserShell.bookmarksAdd(
        activeTab.title,
        targetUrl,
      );
      setBookmarks(updated);
    }
  }, [activeTab, bookmarks, isCurrentPageBookmarked]);

  const removeBookmark = useCallback(async (id: string) => {
    if (!window.browserShell) return;
    setBookmarkError(null);
    const updated = await window.browserShell.bookmarksRemove(id);
    setBookmarks(updated);
    if (editingBookmarkId === id) {
      setEditingBookmarkId(null);
    }
  }, [editingBookmarkId]);

  const addBookmark = useCallback(async () => {
    if (!window.browserShell) return;
    setBookmarkError(null);

    const targetUrl = bookmarkUrlInput.trim();
    if (!targetUrl) {
      setBookmarkError(t("bookmarkInputRequired"));
      return;
    }

    setIsSavingBookmark(true);
    try {
      const updated = await window.browserShell.bookmarksAdd(
        bookmarkTitleInput.trim(),
        targetUrl,
      );
      setBookmarks(updated);
      setBookmarkTitleInput("");
      setBookmarkUrlInput("");
    } catch (error) {
      setBookmarkError(error instanceof Error ? error.message : t("bookmarkAddFailed"));
    } finally {
      setIsSavingBookmark(false);
    }
  }, [bookmarkTitleInput, bookmarkUrlInput, t]);

  const beginEditBookmark = useCallback((bookmark: BookmarkItem) => {
    setBookmarkError(null);
    setEditingBookmarkId(bookmark.id);
    setEditingBookmarkTitle(bookmark.title);
    setEditingBookmarkUrl(bookmark.url);
  }, []);

  const saveBookmarkEdit = useCallback(async () => {
    if (!window.browserShell || !editingBookmarkId) return;
    setBookmarkError(null);

    const nextUrl = editingBookmarkUrl.trim();
    if (!nextUrl) {
      setBookmarkError(t("bookmarkUrlRequired"));
      return;
    }

    setIsSavingBookmark(true);
    try {
      const updated = await window.browserShell.bookmarksUpdate(editingBookmarkId, {
        title: editingBookmarkTitle.trim(),
        url: nextUrl,
      });
      setBookmarks(updated);
      setEditingBookmarkId(null);
    } catch (error) {
      setBookmarkError(error instanceof Error ? error.message : t("bookmarkUpdateFailed"));
    } finally {
      setIsSavingBookmark(false);
    }
  }, [editingBookmarkId, editingBookmarkTitle, editingBookmarkUrl, t]);

  const clearAllBookmarks = useCallback(async () => {
    if (!window.browserShell || bookmarks.length === 0) return;
    const confirmed = window.confirm(t("bookmarkClearConfirm"));
    if (!confirmed) return;

    setBookmarkError(null);
    setIsSavingBookmark(true);
    try {
      const updated = await window.browserShell.bookmarksClear();
      setBookmarks(updated);
      setEditingBookmarkId(null);
      setBookmarkQuery("");
    } catch (error) {
      setBookmarkError(error instanceof Error ? error.message : t("bookmarkClearFailed"));
    } finally {
      setIsSavingBookmark(false);
    }
  }, [bookmarks.length, t]);

  const applyWorkspaceContext = useCallback((payload: BrowserBootstrapData) => {
    const nextTabs = toBrowserTabs(payload.currentWindow.tabs);
    const nextActiveTabId =
      payload.currentWindow.activeTabId
      ?? payload.currentWindow.tabs[0]?.id
      ?? "";
    currentWorkspaceIdRef.current = payload.currentWorkspace.id;
    setCurrentWorkspace(payload.currentWorkspace);
    setCurrentWindow(payload.currentWindow);
    setWorkspaces(payload.workspaces);
    setTabs(nextTabs);
    setActiveTabId(nextActiveTabId);
    if (payload.sidebarOrganizationState) {
      applySidebarOrganizationStateSnapshot(
        payload.currentWorkspace.id,
        payload.sidebarOrganizationState as WorkspaceSplitState,
        nextTabs,
        nextActiveTabId,
      );
    }
  }, [applySidebarOrganizationStateSnapshot]);

  // Update BrowserView bounds when sidebar or URL bar visibility changes
  useEffect(() => {
    if (!isElectronShell || !window.browserShell || activeSplit) return;
    const urlBarHeight = layoutUrlBarHeight;
    void window.browserShell.tabUpdateBounds(
      currentWindow.id,
      sidebarWidth,
      urlBarHeight,
    );
  }, [
    activeSplit,
    currentWindow.id,
    isElectronShell,
    layoutUrlBarHeight,
    sidebarWidth,
  ]);

  // Workspace context
  useEffect(() => {
    if (!window.browserShell) return;

    void window.browserShell
      .getBootstrapData()
      .then((payload) => {
        applyWorkspaceContext(payload);
      })
      .catch(() => undefined);

    const dispose = window.browserShell.onWorkspaceContext((payload) => {
      applyWorkspaceContext(payload);
    });

    return () => {
      dispose?.();
    };
  }, [applyWorkspaceContext]);

  useEffect(() => {
    const browserShell = window.browserShell;
    if (!browserShell) {
      setToolbarExtensions([]);
      return;
    }

    let disposed = false;
    const profileId = currentWorkspace.profileId;
    const refreshToolbarExtensions = async () => {
      try {
        const nextExtensions = await browserShell.extensionsList();
        if (disposed) {
          return;
        }

        setToolbarExtensions(nextExtensions.filter((extension) =>
          extension.profileId === profileId
        ));
      } catch {
        if (!disposed) {
          setToolbarExtensions([]);
        }
      }
    };

    void refreshToolbarExtensions();
    const dispose = browserShell.onExtensionsChanged((payload) => {
      if (payload.profileId === profileId) {
        void refreshToolbarExtensions();
      }
    });

    return () => {
      disposed = true;
      dispose?.();
    };
  }, [currentWorkspace.profileId]);

  useEffect(() => {
    const browserShell = window.browserShell;
    if (!browserShell) {
      setUserScripts([]);
      return;
    }

    let disposed = false;
    const profileId = currentWorkspace.profileId;
    const refreshUserScripts = async () => {
      try {
        const nextScripts = await browserShell.userScriptsList();
        if (!disposed) {
          setUserScripts(nextScripts.filter((script) => script.profileId === profileId));
        }
      } catch {
        if (!disposed) {
          setUserScripts([]);
        }
      }
    };

    void refreshUserScripts();
    const dispose = browserShell.onUserScriptsChanged((payload) => {
      if (payload.profileId === profileId) {
        void refreshUserScripts();
      }
    });

    return () => {
      disposed = true;
      dispose?.();
    };
  }, [currentWorkspace.profileId]);

  useEffect(() => {
    if (!isUserScriptPanelOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsUserScriptPanelOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isUserScriptPanelOpen]);

  useEffect(() => {
    const handleOpenSearchOverlayRequest = () => {
      if (window.browserShell) {
        void window.browserShell.searchOpen();
      }
    };

    window.addEventListener("browser:open-search-overlay-requested", handleOpenSearchOverlayRequest);

    return () => {
      window.removeEventListener("browser:open-search-overlay-requested", handleOpenSearchOverlayRequest);
    };
  }, []);

  useEffect(() => {
    const handleFocusAddressBarRequest = () => {
      setIsUrlBarShortcutCollapsed(false);
      setIsUrlBarPinnedOpen(true);
      setShowUrlBar(true);
      window.requestAnimationFrame(() => {
        urlInputRef.current?.focus();
        urlInputRef.current?.select();
      });
    };

    window.addEventListener(FOCUS_ADDRESS_BAR_EVENT, handleFocusAddressBarRequest);
    return () => {
      window.removeEventListener(FOCUS_ADDRESS_BAR_EVENT, handleFocusAddressBarRequest);
    };
  }, []);

  useEffect(() => {
    const handleBrowserChromeToggleRequest = () => {
      toggleBrowserChrome();
    };

    window.addEventListener(BROWSER_CHROME_TOGGLE_EVENT, handleBrowserChromeToggleRequest);
    return () => {
      window.removeEventListener(BROWSER_CHROME_TOGGLE_EVENT, handleBrowserChromeToggleRequest);
    };
  }, [toggleBrowserChrome]);

  useEffect(() => {
    const browserShell = window.browserShell;
    if (!browserShell?.aiSidebarGetState || !browserShell.onAiSidebarStateChanged) {
      return;
    }

    let disposed = false;
    const applyAiSidebarState = (state: { visible: boolean; windowId: number | null; tabId: string | null }) => {
      setIsAiSidebarOpen(
        state.visible
        && state.windowId === currentWindow.id
        && state.tabId === activeTabId,
      );
    };

    void browserShell.aiSidebarGetState()
      .then((state) => {
        if (!disposed) {
          applyAiSidebarState(state);
        }
      })
      .catch(() => undefined);

    const dispose = browserShell.onAiSidebarStateChanged(applyAiSidebarState);

    return () => {
      disposed = true;
      dispose?.();
    };
  }, [activeTabId, currentWindow.id]);

  const openTab = useCallback(
    (url?: string) => {
      if (!window.browserShell) return;
      void window.browserShell.tabCreate(currentWindow.id, url);
    },
    [currentWindow.id],
  );

  const closeTab = useCallback(
    (id: string) => {
      if (!window.browserShell) return;
      void window.browserShell.tabClose(currentWindow.id, id);
    },
    [currentWindow.id],
  );

  const switchTab = useCallback(
    (id: string) => {
      if (!window.browserShell) return;
      setActiveTabId(id);
      const urlBarHeight = layoutUrlBarHeight;
      void window.browserShell.tabSetActive(
        currentWindow.id,
        id,
        sidebarWidth,
        urlBarHeight,
      );
    },
    [currentWindow.id, layoutUrlBarHeight, sidebarWidth],
  );

  const openOrFocusTasksPage = useCallback(() => {
    const existingTaskTab = tabs.find((tab) =>
      isTasksPageUrl(tab.displayUrl) || isTasksPageUrl(tab.url));

    if (existingTaskTab) {
      switchTab(existingTaskTab.id);
      return;
    }

    openTab(TASKS_PAGE_URL);
  }, [openTab, switchTab, tabs]);

  const navigateTab = useCallback(
    (id: string, url: string) => {
      if (!window.browserShell) return;
      void window.browserShell.tabNavigate(currentWindow.id, id, url);
    },
    [currentWindow.id],
  );

  const handleOpenUserScriptsPopup = useCallback(
    async (anchorElement: HTMLElement | null) => {
      const browserShell = window.browserShell;
      if (!browserShell?.userScriptsShowToolbarPopup || !anchorElement) {
        return;
      }

      const rect = anchorElement.getBoundingClientRect();
      setShowUrlBar(true);
      setIsUserScriptPanelOpen(true);
      try {
        await browserShell.userScriptsShowToolbarPopup({
          anchor: {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          targetUrl: currentUserScriptTargetUrl,
        });
      } finally {
        setIsUserScriptPanelOpen(false);
      }
    },
    [currentUserScriptTargetUrl],
  );

  const toggleAiSidebarFromToolbar = useCallback(() => {
    const browserShell = window.browserShell;
    if (!browserShell?.aiSidebarToggle) {
      setIsAiSidebarOpen((current) => !current);
      return;
    }

    if (aiSidebarOpenTimerRef.current !== null) {
      window.clearTimeout(aiSidebarOpenTimerRef.current);
      aiSidebarOpenTimerRef.current = null;
    }

    if (isAiSidebarOpen) {
      void browserShell.aiSidebarToggle()
        .then((state) => {
          setIsAiSidebarOpen(
            state.visible
            && state.windowId === currentWindow.id
            && state.tabId === activeTabId,
          );
        })
        .catch(() => {
          setIsAiSidebarOpen(false);
        });
      return;
    }

    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      activeElement.blur();
    }
    setIsUserScriptPanelOpen(false);
    setIsUrlBarFocused(false);
    setIsUrlBarShortcutCollapsed(false);
    setIsUrlBarPinnedOpen(true);
    setShowUrlBar(true);

    void browserShell.tabUpdateBounds(
      currentWindow.id,
      sidebarWidth,
      layoutUrlBarHeight,
    );

    aiSidebarOpenTimerRef.current = window.setTimeout(() => {
      aiSidebarOpenTimerRef.current = null;
      void browserShell.aiSidebarToggle()
        .then((state) => {
          setIsAiSidebarOpen(
            state.visible
            && state.windowId === currentWindow.id
            && state.tabId === activeTabId,
          );
        })
        .catch(() => {
          setIsAiSidebarOpen(false);
        });
    }, AI_SIDEBAR_OPEN_AFTER_URL_BAR_HIDE_MS);
  }, [
    activeSplit,
    activeTabId,
    currentWindow.id,
    isAiSidebarOpen,
    layoutUrlBarHeight,
    pageSearchReservedHeight,
    sidebarWidth,
  ]);

  const openBookmark = useCallback(
    (url: string) => {
      if (activeTabId) {
        navigateTab(activeTabId, url);
        return;
      }
      openTab(url);
    },
    [activeTabId, navigateTab, openTab],
  );

  const goBack = useCallback(
    (id: string) => {
      if (!window.browserShell) return;
      void window.browserShell.tabGoBack(currentWindow.id, id);
    },
    [currentWindow.id],
  );

  const goForward = useCallback(
    (id: string) => {
      if (!window.browserShell) return;
      void window.browserShell.tabGoForward(currentWindow.id, id);
    },
    [currentWindow.id],
  );

  const reloadTab = useCallback(
    (id: string) => {
      if (!window.browserShell) return;
      void window.browserShell.tabReload(currentWindow.id, id);
    },
    [currentWindow.id],
  );

  const showTabItemMenu = useCallback((tabId: string, x: number, y: number) => {
    if (!window.browserShell) return;
    void window.browserShell.tabShowItemMenu(tabId, x, y);
  }, []);

  const clearTabDragState = useCallback(() => {
    if (window.browserShell) {
      void window.browserShell.tabSetSidebarDragState(currentWindow.id, null);
    }
    setDraggedTabId(null);
    setDraggedFolderId(null);
    setTabDropTarget(null);
    setSidebarEntryDropTarget(null);
    setGroupDropTargetTabId(null);
    setFolderDropTargetId(null);
    setSplitDragPreview(null);
  }, [currentWindow.id]);

  const finishTabDragInteraction = useCallback(() => {
    if (tabDragResetTimerRef.current !== null) {
      window.clearTimeout(tabDragResetTimerRef.current);
    }

    clearTabDragState();
    tabDragResetTimerRef.current = window.setTimeout(() => {
      suppressTabSelectRef.current = false;
      tabDragResetTimerRef.current = null;
    }, 160);
  }, [clearTabDragState]);

  useEffect(() => {
    if (!window.browserShell) {
      return;
    }

    const disposePreview = window.browserShell.onSplitViewDragPreview((payload) => {
      if (!splitDragOverlayVisible) {
        return;
      }

      setSplitDragPreview(payload);
    });
    const disposeClear = window.browserShell.onSplitViewDragClear(() => {
      setSplitDragPreview(null);
    });
    const disposeDrop = window.browserShell.onSplitViewDragDrop((payload) => {
      if (!activeTabId) {
        finishTabDragInteraction();
        return;
      }

      if (activeSplit) {
        if (!activeSplit.tabIds.includes(payload.tabId)) {
          addTabToSplit(activeSplit.id, payload.tabId, payload);
        }
        finishTabDragInteraction();
        return;
      }

      if (activeSidebarEntry?.kind !== "tab" || activeSidebarFolder) {
        finishTabDragInteraction();
        return;
      }

      const targetTabId = activeSidebarEntry.tabId;
      if (!targetTabId || targetTabId === payload.tabId) {
        finishTabDragInteraction();
        return;
      }

      const orderedTabIds = payload.side === "left" || payload.side === "top"
        ? [payload.tabId, targetTabId]
        : [targetTabId, payload.tabId];
      createSplitFromTabIds(payload.mode, orderedTabIds, payload.tabId);
      finishTabDragInteraction();
    });

    return () => {
      disposePreview?.();
      disposeClear?.();
      disposeDrop?.();
    };
  }, [
    activeSplit,
    activeSidebarEntry,
    activeSidebarFolder,
    activeTabId,
    addTabToSplit,
    finishTabDragInteraction,
    splitDragOverlayVisible,
  ]);

  const handleTabDragStart = useCallback((tabId: string, event: React.DragEvent<HTMLDivElement>) => {
    const canStartDrag = canDragSidebarTabs
      || (activeSplit ? standaloneSidebarTabIds.length >= 1 : standaloneSidebarTabIds.length >= 2);
    if (!canStartDrag) {
      event.preventDefault();
      return;
    }

    if (tabDragResetTimerRef.current !== null) {
      window.clearTimeout(tabDragResetTimerRef.current);
      tabDragResetTimerRef.current = null;
    }

    suppressTabSelectRef.current = true;
    setDraggedFolderId(null);
    setDraggedTabId(tabId);
    setTabDropTarget(null);
    setSidebarEntryDropTarget(null);
    setGroupDropTargetTabId(null);
    setFolderDropTargetId(null);
    if (window.browserShell) {
      void window.browserShell.tabSetSidebarDragState(currentWindow.id, tabId);
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", tabId);
    event.dataTransfer.setData("application/x-milo-tab-id", tabId);
    event.dataTransfer.setData("text/x-milo-tab-id", tabId);
  }, [activeSplit, canDragSidebarTabs, currentWindow.id, standaloneSidebarTabIds.length]);

  const handleTabDragOver = useCallback((tabId: string, event: React.DragEvent<HTMLDivElement>) => {
    if (!draggedTabId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setFolderDropTargetId(null);

    if (draggedTabId === tabId) {
      setTabDropTarget(null);
      setGroupDropTargetTabId(null);
      return;
    }

    const sourceFolderId = findSidebarFolderForTabId(currentWorkspaceSplitState, draggedTabId)?.id ?? null;
    const targetFolderId = findSidebarFolderForTabId(currentWorkspaceSplitState, tabId)?.id ?? null;
    const allowGroup = !(sourceFolderId && sourceFolderId === targetFolderId);
    const intent = resolveTabDropIntent(
      event.currentTarget.getBoundingClientRect(),
      event.clientY,
      allowGroup,
    );

    if (intent.kind === "reorder") {
      setGroupDropTargetTabId(null);
      setTabDropTarget((current) => {
        if (current?.tabId === tabId && current.position === intent.position) {
          return current;
        }
        return { tabId, position: intent.position };
      });
      return;
    }

    setTabDropTarget(null);
    setGroupDropTargetTabId((current) => (current === tabId ? current : tabId));
  }, [currentWorkspaceSplitState, draggedTabId]);

  const handleSidebarEntryDragOver = useCallback((
    targetEntryId: string,
    event: React.DragEvent<HTMLElement>,
  ) => {
    if (!draggedFolderId && !draggedTabId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    const draggedEntryId = draggedFolderId
      ? createSidebarFolderEntry(draggedFolderId).id
      : draggedTabId
        ? createSidebarTabEntry(draggedTabId).id
        : null;
    if (draggedEntryId === targetEntryId) {
      setSidebarEntryDropTarget(null);
      setTabDropTarget(null);
      setGroupDropTargetTabId(null);
      setFolderDropTargetId(null);
      return;
    }

    const position = resolveSidebarEntryDropPosition(
      event.currentTarget.getBoundingClientRect(),
      event.clientY,
    );
    setSidebarEntryDropTarget((current) => {
      if (current?.entryId === targetEntryId && current.position === position) {
        return current;
      }
      return { entryId: targetEntryId, position };
    });
    setTabDropTarget(null);
    setGroupDropTargetTabId(null);
    setFolderDropTargetId(null);
  }, [draggedFolderId, draggedTabId]);

  const handleSidebarEntryDrop = useCallback((
    targetEntryId: string,
    event: React.DragEvent<HTMLElement>,
  ) => {
    if (!draggedFolderId && !draggedTabId) {
      return;
    }

    event.preventDefault();
    const position = resolveSidebarEntryDropPosition(
      event.currentTarget.getBoundingClientRect(),
      event.clientY,
    );

    if (draggedFolderId) {
      const draggedEntryId = createSidebarFolderEntry(draggedFolderId).id;
      if (draggedEntryId !== targetEntryId) {
        updateCurrentWorkspaceSplitState((currentState) =>
          moveSidebarEntryInSidebar(currentState, draggedEntryId, targetEntryId, position));
      }
      finishTabDragInteraction();
      return;
    }

    if (draggedTabId) {
      updateCurrentWorkspaceSplitState((currentState) =>
        moveTabToRootNearSidebarEntry(currentState, draggedTabId, targetEntryId, position));
    }
    finishTabDragInteraction();
  }, [draggedFolderId, draggedTabId, finishTabDragInteraction]);

  const handleFolderDragOver = useCallback((
    folderId: string,
    event: React.DragEvent<HTMLElement>,
    options: { allowFolderReorder?: boolean } = {},
  ) => {
    if (draggedFolderId && options.allowFolderReorder !== false) {
      handleSidebarEntryDragOver(createSidebarFolderEntry(folderId).id, event);
      return;
    }

    if (!draggedTabId) {
      return;
    }

    const sourceFolderId = findSidebarFolderForTabId(currentWorkspaceSplitState, draggedTabId)?.id ?? null;
    if (options.allowFolderReorder === false && sourceFolderId === folderId) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setSidebarEntryDropTarget({
        entryId: createSidebarFolderEntry(folderId).id,
        position: "after",
      });
      setTabDropTarget(null);
      setGroupDropTargetTabId(null);
      setFolderDropTargetId(null);
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    if (options.allowFolderReorder !== false) {
      const intent = resolveTabDropIntent(
        event.currentTarget.getBoundingClientRect(),
        event.clientY,
        true,
      );

      if (intent.kind === "reorder") {
        setSidebarEntryDropTarget({
          entryId: createSidebarFolderEntry(folderId).id,
          position: intent.position,
        });
        setTabDropTarget(null);
        setGroupDropTargetTabId(null);
        setFolderDropTargetId(null);
        return;
      }
    }

    setTabDropTarget(null);
    setGroupDropTargetTabId(null);
    setFolderDropTargetId((current) => (current === folderId ? current : folderId));
    setSidebarEntryDropTarget(null);
  }, [currentWorkspaceSplitState, draggedFolderId, draggedTabId, handleSidebarEntryDragOver]);

  const handleTabDrop = useCallback((tabId: string, event: React.DragEvent<HTMLDivElement>) => {
    if (!draggedTabId) {
      return;
    }

    event.preventDefault();

    const sourceFolderId = findSidebarFolderForTabId(currentWorkspaceSplitState, draggedTabId)?.id ?? null;
    const targetFolderId = findSidebarFolderForTabId(currentWorkspaceSplitState, tabId)?.id ?? null;
    const allowGroup = !(sourceFolderId && sourceFolderId === targetFolderId);
    const intent = resolveTabDropIntent(
      event.currentTarget.getBoundingClientRect(),
      event.clientY,
      allowGroup,
    );

    if (intent.kind === "reorder") {
      updateCurrentWorkspaceSplitState((currentState) =>
        moveTabEntryInSidebar(currentState, draggedTabId, tabId, intent.position));
      finishTabDragInteraction();
      return;
    }

    updateCurrentWorkspaceSplitState((currentState) =>
      groupTabsInSidebar(currentState, draggedTabId, tabId, t("folderLabel")));
    finishTabDragInteraction();
  }, [currentWorkspaceSplitState, draggedTabId, finishTabDragInteraction, t]);

  const handleFolderDrop = useCallback((
    folderId: string,
    event: React.DragEvent<HTMLElement>,
    options: { allowFolderReorder?: boolean } = {},
  ) => {
    if (draggedFolderId && options.allowFolderReorder !== false) {
      handleSidebarEntryDrop(createSidebarFolderEntry(folderId).id, event);
      return;
    }

    if (!draggedTabId) {
      return;
    }

    event.preventDefault();
    const sourceFolderId = findSidebarFolderForTabId(currentWorkspaceSplitState, draggedTabId)?.id ?? null;
    if (options.allowFolderReorder === false && sourceFolderId === folderId) {
      updateCurrentWorkspaceSplitState((currentState) =>
        moveTabToRootNearSidebarEntry(
          currentState,
          draggedTabId,
          createSidebarFolderEntry(folderId).id,
          "after",
        ));
      finishTabDragInteraction();
      return;
    }

    if (options.allowFolderReorder !== false) {
      const intent = resolveTabDropIntent(
        event.currentTarget.getBoundingClientRect(),
        event.clientY,
        true,
      );

      if (intent.kind === "reorder") {
        updateCurrentWorkspaceSplitState((currentState) =>
          moveTabToRootNearSidebarEntry(
            currentState,
            draggedTabId,
            createSidebarFolderEntry(folderId).id,
            intent.position,
          ));
        finishTabDragInteraction();
        return;
      }
    }

    updateCurrentWorkspaceSplitState((currentState) => moveTabIntoFolder(currentState, draggedTabId, folderId));
    finishTabDragInteraction();
  }, [currentWorkspaceSplitState, draggedFolderId, draggedTabId, finishTabDragInteraction, handleSidebarEntryDrop]);

  const handleFolderDragStart = useCallback((folderId: string, event: React.DragEvent<HTMLElement>) => {
    if (!canDragSidebarEntries) {
      event.preventDefault();
      return;
    }

    if (tabDragResetTimerRef.current !== null) {
      window.clearTimeout(tabDragResetTimerRef.current);
      tabDragResetTimerRef.current = null;
    }

    suppressTabSelectRef.current = true;
    setDraggedTabId(null);
    setDraggedFolderId(folderId);
    setTabDropTarget(null);
    setSidebarEntryDropTarget(null);
    setGroupDropTargetTabId(null);
    setFolderDropTargetId(null);
    setSplitDragPreview(null);
    if (window.browserShell) {
      void window.browserShell.tabSetSidebarDragState(currentWindow.id, null);
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", folderId);
    event.dataTransfer.setData("application/x-milo-folder-id", folderId);
    event.dataTransfer.setData("text/x-milo-folder-id", folderId);
  }, [canDragSidebarEntries, currentWindow.id]);

  const handleTabDragEnd = useCallback(() => {
    finishTabDragInteraction();
  }, [finishTabDragInteraction]);

  const handleSplitDragSurfaceOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!draggedTabId || !splitDragOverlayVisible) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setSplitDragPreview(resolveSplitDragPreview(
      event.currentTarget.getBoundingClientRect(),
      event.clientX,
      event.clientY,
    ));
  }, [draggedTabId, splitDragOverlayVisible]);

  const handleSplitDragSurfaceLeave = useCallback(() => {
    setSplitDragPreview(null);
  }, []);

  const handleSplitDragSurfaceDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!draggedTabId || !splitDragOverlayVisible || !splitDragPreview || !activeTabId) {
      return;
    }

    event.preventDefault();

    if (activeSplit) {
      if (!activeSplit.tabIds.includes(draggedTabId)) {
        addTabToSplit(activeSplit.id, draggedTabId, splitDragPreview);
      }
      finishTabDragInteraction();
      return;
    }

    const targetTabId = activeSidebarEntry?.kind === "tab"
      ? activeSidebarEntry.tabId
      : activeTabId;
    if (!targetTabId || targetTabId === draggedTabId) {
      finishTabDragInteraction();
      return;
    }

    const orderedTabIds = splitDragPreview.side === "left" || splitDragPreview.side === "top"
      ? [draggedTabId, targetTabId]
      : [targetTabId, draggedTabId];
    createSplitFromTabIds(splitDragPreview.mode, orderedTabIds, draggedTabId);
    finishTabDragInteraction();
  }, [activeSidebarEntry, activeSplit, activeTabId, addTabToSplit, draggedTabId, finishTabDragInteraction, splitDragOverlayVisible, splitDragPreview]);

  const handleCopyCurrentLink = useCallback(async () => {
    if (!copyLinkTarget) {
      return;
    }

    try {
      await copyTextToClipboard(copyLinkTarget);
      setCopyLinkFeedback("ok");
    } catch {
      setCopyLinkFeedback("err");
    }

    if (copyLinkResetTimerRef.current !== null) {
      window.clearTimeout(copyLinkResetTimerRef.current);
    }

    copyLinkResetTimerRef.current = window.setTimeout(() => {
      setCopyLinkFeedback("idle");
      copyLinkResetTimerRef.current = null;
    }, 1600);
  }, [copyLinkTarget]);

  const handleShowExtensionsMenu = useCallback(async (anchorElement: HTMLElement) => {
    if (!window.browserShell?.extensionsShowToolbarMenu) {
      return;
    }

    const rect = anchorElement.getBoundingClientRect();
    setShowUrlBar(true);
    try {
      await window.browserShell.extensionsShowToolbarMenu({
        anchor: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      window.alert(`${t("extensionPopupFailed")}\n\n${detail}`);
    }
  }, [t]);

  async function handleCreateWorkspace() {
    if (!window.browserShell) return;

    setWorkspaceError(null);

    try {
      await window.browserShell.openCreateWorkspaceDialog({
        sourceWorkspaceId: currentWorkspace.id,
        sourceWorkspaceName: currentWorkspace.name,
      });
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : t("workspaceCreateFailed"),
      );
    }
  }

  async function handleOpenWorkspaceMenu(anchorElement: HTMLElement | null) {
    if (!window.browserShell || !anchorElement) {
      return;
    }

    const rect = anchorElement.getBoundingClientRect();

    try {
      await window.browserShell.showWorkspaceMenu({
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : t("workspaceSwitchFailed"),
      );
    }
  }

  async function handleSwitchWorkspace(workspaceId: string) {
    if (!window.browserShell || workspaceId === currentWorkspace.id || workspaceSwitchInFlightRef.current) {
      return;
    }

    setWorkspaceError(null);
    workspaceSwitchInFlightRef.current = true;

    try {
      const payload = await window.browserShell.switchWorkspace({
        workspaceId,
        sidebarWidth,
        urlBarHeight: layoutUrlBarHeight,
      });
      applyWorkspaceContext(payload);
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : t("workspaceSwitchFailed"),
      );
    } finally {
      workspaceSwitchInFlightRef.current = false;
    }
  }

  function cycleWorkspace(direction: -1 | 1) {
    if (visibleWorkspaces.length <= 1 || workspaceSwitchInFlightRef.current || currentWorkspaceIndex < 0) {
      return;
    }

    const nextIndex =
      (currentWorkspaceIndex + direction + visibleWorkspaces.length) % visibleWorkspaces.length;
    const nextWorkspace = visibleWorkspaces[nextIndex];
    if (!nextWorkspace) {
      return;
    }

    void handleSwitchWorkspace(nextWorkspace.id);
  }

  function isWorkspaceSwipeIgnoredTarget(target: EventTarget | null) {
    return target instanceof Element
      && Boolean(target.closest("button, input, select, textarea, a, [role='button']"));
  }

  function releaseWorkspaceSwipePointer(pointerId?: number) {
    const swipeStart = workspaceSwipeStartRef.current;
    if (!swipeStart || swipeStart.captureTarget === null) {
      return;
    }

    if (pointerId !== undefined && swipeStart.pointerId !== pointerId) {
      return;
    }

    try {
      if (swipeStart.captureTarget.hasPointerCapture(swipeStart.pointerId)) {
        swipeStart.captureTarget.releasePointerCapture(swipeStart.pointerId);
      }
    } catch {
      // Ignore stale pointer capture errors during rerenders/unmounts.
    }
  }

  function clearWorkspaceWheelGestureResetTimer() {
    const wheelGesture = workspaceWheelGestureRef.current;
    if (wheelGesture.resetTimerId !== null) {
      window.clearTimeout(wheelGesture.resetTimerId);
      wheelGesture.resetTimerId = null;
    }
  }

  function resetWorkspaceWheelGesture() {
    clearWorkspaceWheelGestureResetTimer();
    workspaceWheelGestureRef.current.hasSwitched = false;
  }

  function scheduleWorkspaceWheelGestureReset() {
    clearWorkspaceWheelGestureResetTimer();
    workspaceWheelGestureRef.current.resetTimerId = window.setTimeout(() => {
      workspaceWheelGestureRef.current.hasSwitched = false;
      workspaceWheelGestureRef.current.resetTimerId = null;
    }, WORKSPACE_WHEEL_GESTURE_IDLE_MS);
  }

  function tryHandleWorkspaceSwipe(clientX: number, clientY: number) {
    const swipeStart = workspaceSwipeStartRef.current;
    if (!swipeStart || swipeStart.hasSwitched) {
      return false;
    }

    const deltaX = clientX - swipeStart.x;
    const deltaY = clientY - swipeStart.y;
    if (Math.abs(deltaX) < WORKSPACE_SWIPE_THRESHOLD || Math.abs(deltaX) <= Math.abs(deltaY)) {
      return false;
    }

    swipeStart.hasSwitched = true;
    cycleWorkspace(deltaX < 0 ? 1 : -1);
    return true;
  }

  function handleWorkspaceSwipePointerDown(event: React.PointerEvent<HTMLElement>) {
    if (!event.isPrimary || event.button !== 0 || isWorkspaceSwipeIgnoredTarget(event.target)) {
      workspaceSwipeStartRef.current = null;
      return;
    }

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort for environments that support it.
    }

    workspaceSwipeStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      hasSwitched: false,
      captureTarget: event.currentTarget,
    };
  }

  function handleWorkspaceSwipePointerMove(event: React.PointerEvent<HTMLElement>) {
    const swipeStart = workspaceSwipeStartRef.current;
    if (!swipeStart || swipeStart.pointerId !== event.pointerId) {
      return;
    }

    if (tryHandleWorkspaceSwipe(event.clientX, event.clientY)) {
      releaseWorkspaceSwipePointer(event.pointerId);
      workspaceSwipeStartRef.current = null;
    }
  }

  function handleWorkspaceSwipePointerEnd(event: React.PointerEvent<HTMLElement>) {
    const swipeStart = workspaceSwipeStartRef.current;
    if (!swipeStart || swipeStart.pointerId !== event.pointerId) {
      return;
    }

    tryHandleWorkspaceSwipe(event.clientX, event.clientY);
    releaseWorkspaceSwipePointer(event.pointerId);
    workspaceSwipeStartRef.current = null;
  }

  function handleWorkspaceSwipeWheel(event: React.WheelEvent<HTMLElement>) {
    if (isWorkspaceSwipeIgnoredTarget(event.target)) {
      return;
    }

    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) {
      return;
    }

    scheduleWorkspaceWheelGestureReset();

    if (Math.abs(event.deltaX) < 20) {
      return;
    }

    event.preventDefault();
    if (workspaceWheelGestureRef.current.hasSwitched || workspaceSwitchInFlightRef.current) {
      return;
    }

    workspaceWheelGestureRef.current.hasSwitched = true;
    cycleWorkspace(event.deltaX > 0 ? 1 : -1);
  }

  function handleWorkspaceSwipePointerCancel(event: React.PointerEvent<HTMLElement>) {
    releaseWorkspaceSwipePointer(event.pointerId);
    workspaceSwipeStartRef.current = null;
  }

  function syncSidebarStateImmediately(workspaceId: string, state: WorkspaceSplitState) {
    const browserShell = window.browserShell;
    if (!browserShell || !workspaceId) {
      return state;
    }

    sidebarHydratedWorkspaceIdsRef.current.add(workspaceId);
    const requestId = sidebarSyncRequestRef.current + 1;
    sidebarSyncRequestRef.current = requestId;
    const input = {
      workspaceId,
      state: state as SidebarOrganizationState,
      sequence: requestId,
    };
    const applySyncedState = (syncedState: SidebarOrganizationState) => {
      if (sidebarSyncRequestRef.current !== requestId) {
        return;
      }

      const nextState = syncedState as WorkspaceSplitState;
      workspaceSplitStatesRef.current = {
        ...workspaceSplitStatesRef.current,
        [workspaceId]: nextState,
      };
      setWorkspaceSplitStates((currentStates) => {
        const currentState = currentStates[workspaceId];
        if (currentState && areWorkspaceSplitStatesEqual(currentState, nextState)) {
          return currentStates;
        }

        return {
          ...currentStates,
          [workspaceId]: nextState,
        };
      });
    };
    const syncAsync = () => {
      void browserShell.sidebarSyncState(input)
        .then(applySyncedState)
        .catch(() => undefined);
    };

    if (browserShell.sidebarSyncStateNow) {
      try {
        return browserShell.sidebarSyncStateNow(input) as WorkspaceSplitState;
      } catch {
        syncAsync();
        return state;
      }
    }

    syncAsync();
    return state;
  }

  function updateCurrentWorkspaceSplitState(
    updater: (current: WorkspaceSplitState) => WorkspaceSplitState,
  ) {
    const workspaceId = currentWorkspace.id;
    const existingState = workspaceSplitStatesRef.current[workspaceId]
      ?? createDefaultWorkspaceSplitState(tabs, activeTabId);
    const proposedState = updater(existingState);
    if (areWorkspaceSplitStatesEqual(existingState, proposedState)) {
      return;
    }

    const nextState = syncSidebarStateImmediately(workspaceId, proposedState);
    workspaceSplitStatesRef.current = {
      ...workspaceSplitStatesRef.current,
      [workspaceId]: nextState,
    };
    setWorkspaceSplitStates((currentStates) => {
      const currentState = currentStates[workspaceId];
      if (currentState && areWorkspaceSplitStatesEqual(currentState, nextState)) {
        return currentStates;
      }

      return {
        ...currentStates,
        [workspaceId]: nextState,
      };
    });
  }

  function collectSplitSourceTabIds(
    desiredCount: number,
    seedTabId: string,
  ) {
    const index = standaloneSidebarTabIds.indexOf(seedTabId);
    if (index === -1) {
      return standaloneSidebarTabIds.slice(0, desiredCount);
    }

    return [
      standaloneSidebarTabIds[index],
      ...standaloneSidebarTabIds.slice(index + 1),
      ...standaloneSidebarTabIds.slice(0, index),
    ].slice(0, desiredCount);
  }

  function activateSidebarEntry(entry: SidebarEntry) {
    updateCurrentWorkspaceSplitState((currentState) => ({
      ...currentState,
      activeEntryId: entry.id,
    }));

    if (entry.kind === "tab") {
      switchTab(entry.tabId);
    }
  }

  function toggleFolderExpanded(folderId: string) {
    updateCurrentWorkspaceSplitState((currentState) => {
      const folder = currentState.folders[folderId];
      if (!folder) {
        return currentState;
      }

      return {
        ...currentState,
        folders: {
          ...currentState.folders,
          [folderId]: {
            ...folder,
            isExpanded: !folder.isExpanded,
          },
        },
      };
    });
  }

  async function openFolderSettings(folderId: string) {
    const folder = currentWorkspaceSplitState.folders[folderId];
    if (!folder || !window.browserShell) {
      return;
    }

    await window.browserShell.openFolderSettingsDialog({
      workspaceId: currentWorkspace.id,
      folderId,
      name: folder.title,
      icon: folder.icon,
      backgroundColor: folder.backgroundColor,
    });
  }

  function deleteFolderWithTabs(folderId: string) {
    const folder = currentWorkspaceSplitState.folders[folderId];
    if (!folder) {
      return;
    }

    const confirmed = window.confirm(t("folderDeleteConfirm"));
    if (!confirmed) {
      return;
    }

    const tabIdsToClose = [...folder.tabIds];
    updateCurrentWorkspaceSplitState((currentState) => removeFolderFromSidebar(currentState, folderId));

    tabIdsToClose.forEach((tabId) => {
      closeTab(tabId);
    });
  }

  function createSplitFromTabIds(
    mode: SplitViewMode,
    requestedTabIds: string[],
    focusedTabId: string,
  ) {
    const tabIds = Array.from(new Set(requestedTabIds)).filter((tabId) => tabLookup.has(tabId));
    if (tabIds.length < 2 || !tabIds.includes(focusedTabId)) {
      return;
    }

    const splitId = createSplitId();
    updateCurrentWorkspaceSplitState((currentState) => {
      const firstIndex = currentState.entries.findIndex(
        (entry) => entry.kind === "tab" && tabIds.includes(entry.tabId),
      );
      const nextEntries = currentState.entries.filter(
        (entry) => entry.kind !== "tab" || !tabIds.includes(entry.tabId),
      );
      nextEntries.splice(Math.max(0, firstIndex), 0, createSidebarSplitEntry(splitId));

      return {
        activeEntryId: createSidebarSplitEntry(splitId).id,
        entries: nextEntries,
        splits: {
          ...currentState.splits,
          [splitId]: {
            id: splitId,
            mode,
            tabIds,
            focusedTabId,
            syncScroll: false,
          },
        },
        folders: currentState.folders,
      };
    });
  }

  function createSplitFromSelection(mode: SplitViewMode) {
    const desiredCount = mode === "bento"
      ? Math.min(4, standaloneSidebarTabIds.length)
      : 2;
    const seedTabId =
      activeSidebarEntry?.kind === "tab"
        ? activeSidebarEntry.tabId
        : activeSplit?.focusedTabId ?? activeTabId;
    if (!seedTabId) {
      return;
    }

    if (mode === "bento" && desiredCount < 2) {
      return;
    }

    const tabIds = collectSplitSourceTabIds(desiredCount, seedTabId);
    if (tabIds.length < desiredCount) {
      return;
    }

    createSplitFromTabIds(mode, tabIds, seedTabId);
  }

  function addTabToSplit(
    splitId: string,
    tabId: string,
    preview: SplitDragPreview,
  ) {
    if (!tabLookup.has(tabId)) {
      return;
    }

    updateCurrentWorkspaceSplitState((currentState) => {
      const currentSplit = currentState.splits[splitId];
      if (!currentSplit || currentSplit.tabIds.includes(tabId)) {
        return currentState;
      }

      const nextEntries = currentState.entries.filter(
        (entry) => entry.kind !== "tab" || entry.tabId !== tabId,
      );

      return {
        activeEntryId: createSidebarSplitEntry(splitId).id,
        entries: nextEntries,
        splits: {
          ...currentState.splits,
          [splitId]: {
            ...currentSplit,
            mode: currentSplit.mode === "bento" ? "bento" : preview.mode,
            tabIds: addTabToSplitOrder(currentSplit.tabIds, tabId, preview.side),
            focusedTabId: tabId,
          },
        },
        folders: currentState.folders,
      };
    });
  }

  function updateActiveSplit(
    updater: (currentSplit: SplitTabState) => SplitTabState | null,
    nextFocusedTabId?: string,
  ) {
    if (!activeSplit) {
      return;
    }

    const splitId = activeSplit.id;
    updateCurrentWorkspaceSplitState((currentState) => {
      const currentSplit = currentState.splits[splitId];
      if (!currentSplit) {
        return currentState;
      }

      const nextSplit = updater(currentSplit);
      if (!nextSplit || nextSplit.tabIds.length < 2) {
        const nextEntries: SidebarEntry[] = [];
        for (const entry of currentState.entries) {
          if (entry.kind === "split" && entry.splitId === splitId) {
            currentSplit.tabIds.forEach((tabId) => {
              nextEntries.push(createSidebarTabEntry(tabId));
            });
            continue;
          }

          nextEntries.push(entry);
        }

        const finalTabId = nextFocusedTabId ?? currentSplit.focusedTabId ?? currentSplit.tabIds[0];
        return {
          activeEntryId: createSidebarTabEntry(finalTabId).id,
          entries: nextEntries,
          splits: Object.fromEntries(
            Object.entries(currentState.splits).filter(([existingSplitId]) => existingSplitId !== splitId),
          ),
          folders: currentState.folders,
        };
      }

      return {
        ...currentState,
        splits: {
          ...currentState.splits,
          [splitId]: nextSplit,
        },
      };
    });
  }

  function separateSplit(splitId: string, nextTabId?: string) {
    const split = currentWorkspaceSplitState.splits[splitId];
    if (!split) {
      return;
    }

    updateCurrentWorkspaceSplitState((currentState) => {
      const nextEntries: SidebarEntry[] = [];
      for (const entry of currentState.entries) {
        if (entry.kind === "split" && entry.splitId === splitId) {
          split.tabIds.forEach((tabId) => {
            nextEntries.push(createSidebarTabEntry(tabId));
          });
          continue;
        }

        nextEntries.push(entry);
      }

      const targetTabId = nextTabId ?? split.focusedTabId ?? split.tabIds[0];
      return {
        activeEntryId: createSidebarTabEntry(targetTabId).id,
        entries: nextEntries,
        splits: Object.fromEntries(
          Object.entries(currentState.splits).filter(([existingSplitId]) => existingSplitId !== splitId),
        ),
        folders: currentState.folders,
      };
    });

    const targetTabId = nextTabId ?? split.focusedTabId ?? split.tabIds[0];
    if (targetTabId) {
      switchTab(targetTabId);
    }
  }

  function closeSplitPane(splitId: string, tabId: string) {
    const split = currentWorkspaceSplitState.splits[splitId];
    if (!split || !split.tabIds.includes(tabId)) {
      return;
    }

    const nextTabIds = split.tabIds.filter((existingTabId) => existingTabId !== tabId);
    const nextFocusedTabId = split.focusedTabId === tabId
      ? nextTabIds[0]
      : split.focusedTabId;

    updateCurrentWorkspaceSplitState((currentState) => {
      const currentSplit = currentState.splits[splitId];
      if (!currentSplit) {
        return currentState;
      }

      const remainingTabIds = currentSplit.tabIds.filter((existingTabId) => existingTabId !== tabId);
      if (remainingTabIds.length < 2) {
        const nextEntries: SidebarEntry[] = [];
        for (const entry of currentState.entries) {
          if (entry.kind === "split" && entry.splitId === splitId) {
            remainingTabIds.forEach((remainingTabId) => {
              nextEntries.push(createSidebarTabEntry(remainingTabId));
            });
            continue;
          }

          nextEntries.push(entry);
        }

        return {
          activeEntryId: remainingTabIds[0]
            ? createSidebarTabEntry(remainingTabIds[0]).id
            : currentState.activeEntryId,
          entries: nextEntries,
          splits: Object.fromEntries(
            Object.entries(currentState.splits).filter(([existingSplitId]) => existingSplitId !== splitId),
          ),
          folders: currentState.folders,
        };
      }

      return {
        ...currentState,
        splits: {
          ...currentState.splits,
          [splitId]: {
            ...currentSplit,
            tabIds: remainingTabIds,
            focusedTabId: remainingTabIds.includes(nextFocusedTabId ?? "")
              ? (nextFocusedTabId as string)
              : remainingTabIds[0],
          },
        },
      };
    });

    closeTab(tabId);
  }

  function closeFocusedSplitPane() {
    if (!activeSplit?.focusedTabId) {
      return;
    }

    closeSplitPane(activeSplit.id, activeSplit.focusedTabId);
  }

  async function handleOpenSplitToolbarMenu(anchorElement: HTMLElement | null) {
    if (!window.browserShell || !anchorElement || !canOpenSplitToolbarMenu) {
      return;
    }

    const rect = anchorElement.getBoundingClientRect();
    const action = await window.browserShell.splitViewShowMenu({
      kind: "toolbar",
      x: Math.round(rect.left),
      y: Math.round(rect.bottom + 6),
      isActiveSplit: Boolean(activeSplit),
      activeMode: activeSplit?.mode,
      canCreatePair: canCreatePairSplit,
      canCreateBento: canCreateBentoSplit,
      canUseBentoLayout: Boolean(activeSplit && activeSplit.tabIds.length >= 2),
      syncScroll: activeSplit?.syncScroll ?? false,
    });

    switch (action) {
      case "create-horizontal":
        createSplitFromSelection("horizontal");
        break;
      case "create-vertical":
        createSplitFromSelection("vertical");
        break;
      case "create-bento":
        createSplitFromSelection("bento");
        break;
      case "set-horizontal":
        updateActiveSplit((currentSplit) => ({
          ...currentSplit,
          mode: "horizontal",
        }));
        break;
      case "set-vertical":
        updateActiveSplit((currentSplit) => ({
          ...currentSplit,
          mode: "vertical",
        }));
        break;
      case "set-bento":
        updateActiveSplit((currentSplit) => ({
          ...currentSplit,
          mode: "bento",
        }));
        break;
      case "toggle-sync-scroll":
        updateActiveSplit((currentSplit) => ({
          ...currentSplit,
          syncScroll: !currentSplit.syncScroll,
        }));
        break;
      case "separate-all":
        if (activeSplit) {
          separateSplit(activeSplit.id);
        }
        break;
      default:
        break;
    }
  }

  async function handleOpenSplitSidebarMenu(splitId: string, x: number, y: number) {
    if (!window.browserShell) {
      return;
    }

    const action = await window.browserShell.splitViewShowMenu({
      kind: "sidebar",
      x,
      y,
    });

    if (action === "separate-all") {
      separateSplit(splitId);
    }
  }

  const splitPaneLayoutTiles = useMemo<TabLayoutTileInput[]>(
    () => splitPanels.map((panel) => ({
      tabId: panel.tabId,
      x: panel.contentX,
      y: panel.contentY,
      width: panel.contentWidth,
      height: panel.contentHeight,
    })),
    [splitPanels],
  );
  const splitDragPanelStyles = splitDragPreview
    ? getSplitDragPanelStyles(splitDragPreview)
    : null;
  const splitDragHintLabel = splitDragPreview
    ? t(getSplitDragHintKey(splitDragPreview))
    : t("splitViewLabel");

  useEffect(() => {
    if (!isElectronShell || !window.browserShell || !activeSplit || splitPaneLayoutTiles.length === 0) {
      return;
    }

    void window.browserShell.tabApplyLayout(
      currentWindow.id,
      {
        focusedTabId: activeSplit.focusedTabId,
        syncScroll: activeSplit.syncScroll,
        tiles: splitPaneLayoutTiles,
      },
      sidebarWidth,
      layoutUrlBarHeight,
    );
  }, [
    activeSplit,
    currentWindow.id,
    isElectronShell,
    layoutUrlBarHeight,
    sidebarWidth,
    splitPaneLayoutTiles,
  ]);

  return (
    <>
    {isLight && (
      <style>{`
        /* ── Light theme overrides for browser chrome ── */
        [data-theme="light"] aside button[class*="text-white"] { color: rgba(0,0,0,0.45) !important; }
        [data-theme="light"] aside button:hover { background: rgba(0,0,0,0.06) !important; color: rgba(0,0,0,0.8) !important; }
        [data-theme="light"] aside button.active { background: rgba(0,0,0,0.06) !important; color: rgba(0,0,0,0.8) !important; }
        [data-theme="light"] aside .sidebar-folder-button[data-folder-background-color="true"],
        [data-theme="light"] aside .sidebar-folder-button[data-folder-background-color="true"]:hover {
          background: var(--folder-background-color) !important;
          color: var(--folder-text-color) !important;
        }
        [data-theme="light"] aside [class*="text-white/30"] { color: rgba(0,0,0,0.35) !important; }
        [data-theme="light"] aside [class*="text-white/40"] { color: rgba(0,0,0,0.4) !important; }
        [data-theme="light"] aside [class*="text-white/50"] { color: rgba(0,0,0,0.45) !important; }
        [data-theme="light"] aside [class*="text-white/70"] { color: rgba(0,0,0,0.65) !important; }
        [data-theme="light"] aside [class*="text-white/80"] { color: rgba(0,0,0,0.7) !important; }
        [data-theme="light"] aside [class*="text-white/35"] { color: rgba(0,0,0,0.35) !important; }
        [data-theme="light"] aside [class*="hover:bg-white/5"]:hover { background: rgba(0,0,0,0.04) !important; }
        [data-theme="light"] aside [class*="hover:bg-white/10"]:hover { background: rgba(0,0,0,0.06) !important; }
        [data-theme="light"] aside [class*="hover:text-white"] { }
        [data-theme="light"] aside [class*="hover:text-white"]:hover { color: rgba(0,0,0,0.85) !important; }
        [data-theme="light"] aside [class*="hover:text-white/60"]:hover { color: rgba(0,0,0,0.6) !important; }
        [data-theme="light"] aside [class*="hover:text-white/80"]:hover { color: rgba(0,0,0,0.75) !important; }
        [data-theme="light"] aside [class*="border-white/10"] { border-color: rgba(0,0,0,0.1) !important; }
        [data-theme="light"] aside [class*="border-white/20"] { border-color: rgba(0,0,0,0.15) !important; }
        [data-theme="light"] aside [class*="bg-white/5"]:not([class*="hover:"]) { background: rgba(0,0,0,0.03) !important; }
        [data-theme="light"] aside [class*="bg-white/10"]:not([class*="hover:"]) { background: rgba(0,0,0,0.05) !important; }
        [data-theme="light"] aside [class*="bg-black/10"] { background: rgba(0,0,0,0.04) !important; }
        [data-theme="light"] aside [class*="bg-black/20"] { background: rgba(0,0,0,0.06) !important; }
        [data-theme="light"] aside input { border-color: rgba(0,0,0,0.1) !important; background: rgba(0,0,0,0.04) !important; color: rgba(0,0,0,0.7) !important; }
        [data-theme="light"] aside input::placeholder { color: rgba(0,0,0,0.35) !important; }
        [data-theme="light"] aside input:focus { border-color: rgba(59,130,246,0.5) !important; }
        [data-theme="light"] aside select { border-color: rgba(0,0,0,0.1) !important; background: rgba(0,0,0,0.03) !important; color: rgba(0,0,0,0.7) !important; }
        [data-theme="light"] aside select:hover { background: rgba(0,0,0,0.06) !important; }
        [data-theme="light"] aside select:focus { border-color: rgba(59,130,246,0.5) !important; }
        [data-theme="light"] aside select option { background: #fff; color: #000; }
        [data-theme="light"] aside [class*="group-hover:text-white"]:hover { color: rgba(0,0,0,0.8) !important; }
        [data-theme="light"] aside [class*="group-hover\:text-white"] { }
        [data-theme="light"] aside .group:hover span[class*="text-white"] { color: rgba(0,0,0,0.8) !important; }

        /* URL bar */
        [data-theme="light"] main > div[class*="border-b"] {
          border-color: rgba(0,0,0,0.08) !important;
          background: rgba(255,255,255,0.1) !important;
        }
        [data-theme="light"] main button[class*="text-white/40"] { color: rgba(0,0,0,0.4) !important; }
        [data-theme="light"] main button:hover { background: rgba(0,0,0,0.06) !important; color: rgba(0,0,0,0.8) !important; }
        [data-theme="light"] main input { border-color: rgba(0,0,0,0.06) !important; background: rgba(0,0,0,0.04) !important; color: rgba(0,0,0,0.8) !important; }
        [data-theme="light"] main input::placeholder { color: rgba(0,0,0,0.35) !important; }
        [data-theme="light"] main input:focus { border-color: rgba(59,130,246,0.5) !important; background: rgba(0,0,0,0.06) !important; }
        [data-theme="light"] main .page-findbar { border-color: rgba(0,0,0,0.12) !important; background: rgba(255,255,255,0.96) !important; }
        [data-theme="light"] main .page-findbar-input { border-color: rgba(0,0,0,0.12) !important; background: #fff !important; color: rgba(0,0,0,0.82) !important; }
        [data-theme="light"] main .page-findbar-input.page-findbar-input-no-match {
          border-color: rgba(244,63,94,0.35) !important;
          background: rgba(255,241,242,0.96) !important;
          color: rgba(159,18,57,0.92) !important;
        }
        [data-theme="light"] main .page-findbar-count { color: rgba(0,0,0,0.45) !important; }
        [data-theme="light"] main .page-findbar-count.page-findbar-count-no-match { color: rgba(190,24,93,0.85) !important; }
        [data-theme="light"] main .page-findbar button:hover { background: rgba(0,0,0,0.05) !important; color: rgba(0,0,0,0.8) !important; }
        [data-theme="light"] main [class*="text-white/30"] { color: rgba(0,0,0,0.35) !important; }

        /* Main content area */
        [data-theme="light"] main [class*="bg-slate-950"] { background: rgba(255,255,255,0.55) !important; }
        [data-theme="light"] main [class*="bg-\\[\\#1a1a1a\\]"] { background: rgba(255,255,255,0.8) !important; }
        [data-theme="light"] main [class*="border-white/10"] { border-color: rgba(0,0,0,0.1) !important; }
        [data-theme="light"] main [class*="text-white/50"] { color: rgba(0,0,0,0.5) !important; }
        [data-theme="light"] main [class*="text-white"] { color: rgba(0,0,0,0.8) !important; }

        /* Ambient glow - make subtle in light mode */
        [data-theme="light"] main [class*="bg-blue-500/5"] { background: rgba(59,130,246,0.03) !important; }
        [data-theme="light"] main [class*="bg-purple-500/5"] { background: rgba(168,85,247,0.03) !important; }

        /* Bookmark error */
        [data-theme="light"] [class*="border-rose-400"] { border-color: rgba(244,63,94,0.3) !important; }
        [data-theme="light"] [class*="bg-rose-500/10"] { background: rgba(244,63,94,0.06) !important; }
        [data-theme="light"] [class*="text-rose-200"] { color: rgba(185,28,28,0.8) !important; }
      `}</style>
    )}
    <div
      data-theme={isLight ? "light" : "dark"}
      className={cn(
      "relative flex h-screen w-screen overflow-hidden font-sans selection:bg-blue-500/30",
      isLight ? "bg-transparent text-slate-800" : "bg-transparent text-white",
    )}>
      <div
        className={cn(
          "pointer-events-none absolute inset-0",
          isLight
            ? "bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.18),transparent_34%),radial-gradient(circle_at_78%_12%,rgba(56,189,248,0.08),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.06),transparent_32%)]"
            : "bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_32%),radial-gradient(circle_at_78%_10%,rgba(56,189,248,0.10),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.07),transparent_28%)]",
        )}
      />
      <div
        className={cn(
          "pointer-events-none absolute inset-0",
          isLight
            ? "bg-[linear-gradient(135deg,rgba(255,255,255,0.06),rgba(232,239,247,0.03)_46%,rgba(220,231,242,0.02))]"
            : "bg-[linear-gradient(135deg,rgba(255,255,255,0.03),rgba(10,17,30,0.06)_48%,rgba(4,8,15,0.08))]",
        )}
      />
      <div
        className={cn(
          "pointer-events-none absolute inset-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]",
          isLight ? "opacity-0" : "opacity-80",
        )}
      />
      {/* Sidebar */}
      <aside
        className="relative z-20 flex shrink-0 flex-col overflow-hidden"
        style={{
          ...sidebarChromeSurfaceStyle,
          width: sidebarWidth,
          transition: "width 300ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        {/* Draggable title bar area — macOS traffic lights sit here */}
        {isSidebarCollapsed ? (
          <div
            className="shrink-0"
            style={{ WebkitAppRegion: "drag", height: 40 } as React.CSSProperties}
          />
        ) : (
          <div
            className="flex h-12 shrink-0 items-center px-2"
            style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
          >
            <div
              className="ml-auto flex items-center gap-1"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            >
              <button
                className="rounded-lg p-1.5 text-white/50 transition-all hover:bg-white/10 hover:text-white"
                onClick={() => { if (window.browserShell) void window.browserShell.searchOpen(); }}
                type="button"
              >
                <Search className="h-4 w-4" />
              </button>
              <button
                className="rounded-lg p-1.5 text-white/50 transition-all hover:bg-white/10 hover:text-white"
                onClick={openOrFocusTasksPage}
                title={t("taskManager")}
                type="button"
              >
                <ListTodo className="h-4 w-4" />
              </button>
              <button
                className="rounded-lg p-1.5 text-white/50 transition-all hover:bg-white/10 hover:text-white"
                onClick={() => setIsSidebarCollapsed(true)}
                type="button"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Collapsed: buttons below traffic lights */}
        {isSidebarCollapsed && (
          <div
            className="flex shrink-0 flex-col items-center gap-1 px-2 pb-1"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            <button
              className="flex w-full items-center justify-center rounded-xl p-2 text-white/50 transition-all duration-200 hover:bg-white/5 hover:text-white/80"
              onClick={() => { if (window.browserShell) void window.browserShell.searchOpen(); }}
              type="button"
            >
              <Search className="h-4 w-4" />
            </button>
            <button
              className="flex w-full items-center justify-center rounded-xl p-2 text-white/50 transition-all duration-200 hover:bg-white/5 hover:text-white/80"
              onClick={openOrFocusTasksPage}
              title={t("taskManager")}
              type="button"
            >
              <ListTodo className="h-4 w-4" />
            </button>
            <button
              className="flex w-full items-center justify-center rounded-xl p-2 text-white/50 transition-all duration-200 hover:bg-white/5 hover:text-white/80"
              onClick={() => setIsSidebarCollapsed(false)}
              type="button"
            >
              <PanelLeftClose className="h-4 w-4 rotate-180" />
            </button>
          </div>
        )}

        {/* Tabs List */}
        <ScrollArea
          className="min-h-0 flex-1 px-1.5 py-1.5"
          onPointerCancel={handleWorkspaceSwipePointerCancel}
          onPointerDown={handleWorkspaceSwipePointerDown}
          onPointerMove={handleWorkspaceSwipePointerMove}
          onPointerUp={handleWorkspaceSwipePointerEnd}
          onWheel={handleWorkspaceSwipeWheel}
          style={{ touchAction: "pan-y" }}
        >
          <div
            ref={sidebarTabListRef}
            className="relative flex w-full min-w-0 flex-col gap-0.5"
          >
            {sidebarActiveIndicator ? (
              <div
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute rounded-lg border transition-[transform,width,height,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                  isLight
                    ? "border-black/5 bg-black/[0.075]"
                    : "border-white/10 bg-white/[0.11]",
                )}
                style={{
                  width: sidebarActiveIndicator.width,
                  height: sidebarActiveIndicator.height,
                  transform: `translate3d(${sidebarActiveIndicator.left}px, ${sidebarActiveIndicator.top}px, 0)`,
                }}
              />
            ) : null}
            {currentWorkspaceSplitState.entries.map((entry) => {
              if (entry.kind === "split") {
                const split = currentWorkspaceSplitState.splits[entry.splitId];
                if (!split) {
                  return null;
                }

                const leadingTab = tabLookup.get(split.tabIds[0]);
                const isAutomationControlled = split.tabIds.some(
                  (tabId) => tabLookup.get(tabId)?.isAutomationControlled,
                );
                return (
                  <div
                    key={entry.id}
                    ref={(node) => {
                      setSidebarEntryRef(entry.id, node);
                    }}
                    className="relative z-10"
                  >
                    <BrowserTabButton
                      active={entry.id === currentWorkspaceSplitState.activeEntryId}
                      activeBackgroundMode="shared"
                      collapsed={isSidebarCollapsed}
                      dropIndicator={
                        sidebarEntryDropTarget?.entryId === entry.id
                          ? sidebarEntryDropTarget.position
                          : null
                      }
                      indicatorIcon={<LayoutGrid className="h-2 w-2" />}
                      isLight={isLight}
                      tab={{
                        id: split.id,
                        title: buildSplitTitle(split, tabLookup, t("splitViewLabel")),
                        url: "milo://split",
                        displayUrl: "milo://split",
                        favicon: leadingTab?.favicon,
                        isLoading: split.tabIds.some((tabId) => tabLookup.get(tabId)?.isLoading),
                        isAutomationControlled,
                        canGoBack: false,
                        canGoForward: false,
                      }}
                      automationLabel={t("automationControlledBadge")}
                      onClose={() => {
                        separateSplit(split.id);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        void handleOpenSplitSidebarMenu(split.id, event.clientX, event.clientY);
                      }}
                      onDragOver={canDragSidebarEntries
                        ? (event) => {
                          handleSidebarEntryDragOver(entry.id, event);
                        }
                        : undefined}
                      onDrop={canDragSidebarEntries
                        ? (event) => {
                          handleSidebarEntryDrop(entry.id, event);
                        }
                        : undefined}
                      onSelect={() => {
                        activateSidebarEntry(entry);
                      }}
                    />
                  </div>
                );
              }

              if (entry.kind === "folder") {
                const folder = currentWorkspaceSplitState.folders[entry.folderId];
                if (!folder) {
                  return null;
                }

                const folderHasActiveTab = Boolean(
                  activeSidebarTabId && folder.tabIds.includes(activeSidebarTabId),
                );
                const folderColorTokens = getFolderBackgroundColorTokens(
                  folder.backgroundColor,
                  isLight,
                );
                const shouldApplyFolderColor = Boolean(
                  folderColorTokens && folderDropTargetId !== folder.id,
                );
                const folderColorStyle = shouldApplyFolderColor && folderColorTokens
                  ? ({
                    "--folder-background-color": folderColorTokens.backgroundColor,
                    "--folder-text-color": folderColorTokens.textColor,
                    backgroundColor: folderColorTokens.backgroundColor,
                    boxShadow: `inset 0 0 0 1px ${folderColorTokens.borderColor}`,
                    color: folderColorTokens.textColor,
                  } as React.CSSProperties)
                  : undefined;
                const folderIconColorStyle = shouldApplyFolderColor && folderColorTokens
                  ? ({
                    backgroundColor: folderColorTokens.iconBackgroundColor,
                    color: folderColorTokens.textColor,
                  } as React.CSSProperties)
                  : undefined;
                const folderBadgeColorStyle = shouldApplyFolderColor && folderColorTokens
                  ? ({
                    backgroundColor: folderColorTokens.chipBackgroundColor,
                    color: folderColorTokens.textColor,
                  } as React.CSSProperties)
                  : undefined;

                return (
                  <div key={entry.id} className="relative z-10">
                    <div
                      ref={(node) => {
                        setSidebarEntryRef(entry.id, node);
                      }}
                      draggable={canDragSidebarEntries}
                      className="group relative"
                      onDragEnd={canDragSidebarEntries ? handleTabDragEnd : undefined}
                      onDragStart={canDragSidebarEntries
                        ? (event) => {
                          handleFolderDragStart(folder.id, event);
                        }
                        : undefined}
                    >
                      <button
                        data-folder-background-color={shouldApplyFolderColor ? "true" : undefined}
                        className={cn(
                          "sidebar-folder-button relative flex w-full min-w-0 items-center rounded-lg px-1.5 py-1 text-left transition-all",
                          isSidebarCollapsed ? "justify-center" : "gap-2",
                          draggedFolderId === folder.id ? "scale-[0.985] opacity-45" : "",
                          sidebarEntryDropTarget?.entryId === entry.id && sidebarEntryDropTarget.position === "before"
                            ? "before:pointer-events-none before:absolute before:left-2 before:right-2 before:top-0 before:h-0.5 before:rounded-full before:bg-sky-500/90"
                            : "",
                          sidebarEntryDropTarget?.entryId === entry.id && sidebarEntryDropTarget.position === "after"
                            ? "after:pointer-events-none after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:rounded-full after:bg-sky-500/90"
                            : "",
                          folderDropTargetId === folder.id
                            ? isLight
                              ? "bg-sky-500/10 text-sky-700 ring-1 ring-sky-500/25"
                              : "bg-sky-400/12 text-sky-200 ring-1 ring-sky-300/20"
                            : isLight
                              ? folderHasActiveTab && (isSidebarCollapsed || !folder.isExpanded)
                                ? "text-black/80"
                                : "text-black/55 hover:bg-black/5 hover:text-black/80"
                              : folderHasActiveTab && (isSidebarCollapsed || !folder.isExpanded)
                                ? "text-white/85"
                                : "text-white/55 hover:bg-white/5 hover:text-white/85",
                          !isSidebarCollapsed ? "pr-16" : "",
                        )}
                        style={folderColorStyle}
                        onClick={() => {
                          if (draggedFolderId) {
                            return;
                          }
                          if (isSidebarCollapsed) {
                            setIsSidebarCollapsed(false);
                            return;
                          }
                          toggleFolderExpanded(folder.id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") {
                            return;
                          }

                          event.preventDefault();
                          event.stopPropagation();
                          void openFolderSettings(folder.id);
                        }}
                        onDragOver={canDragSidebarTabs || canDragSidebarEntries
                          ? (event) => {
                            handleFolderDragOver(folder.id, event);
                          }
                          : undefined}
                        onDrop={canDragSidebarTabs || canDragSidebarEntries
                          ? (event) => {
                            handleFolderDrop(folder.id, event);
                          }
                          : undefined}
                        type="button"
                      >
                        {!isSidebarCollapsed && (
                          <ChevronRight
                            className={cn(
                              "h-3 w-3 shrink-0 transition-transform duration-200",
                              folder.isExpanded ? "rotate-90" : "",
                            )}
                          />
                        )}
                        <div
                          className={cn(
                            "flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md",
                            isLight ? "bg-black/5" : "bg-white/8",
                          )}
                          style={folderIconColorStyle}
                        >
                          <FolderIconContent icon={folder.icon} />
                        </div>
                        {!isSidebarCollapsed && (
                          <div className="min-w-0 flex-1 overflow-hidden">
                            <span className="block truncate text-[13px] font-medium leading-5">
                              {folder.title}
                            </span>
                          </div>
                        )}
                      </button>

                      {!isSidebarCollapsed && (
                        <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center gap-0.5">
                          <div className="relative h-6 w-6">
                            <span
                              className={cn(
                                "sidebar-folder-count pointer-events-none absolute inset-0 flex items-center justify-center rounded-md text-[10px] font-medium tabular-nums leading-none opacity-100 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0",
                                isLight ? "bg-black/5 text-black/45" : "bg-white/8 text-white/45",
                              )}
                              style={folderBadgeColorStyle}
                            >
                              {folder.tabIds.length}
                            </span>
                            <button
                              className={cn(
                                "pointer-events-auto absolute inset-0 flex items-center justify-center rounded-md opacity-0 transition-all group-hover:opacity-100 group-focus-within:opacity-100",
                                isLight
                                  ? "text-black/45 hover:bg-black/5 hover:text-black/75"
                                  : "text-white/45 hover:bg-white/8 hover:text-white/80",
                              )}
                              onClick={(event) => {
                                event.stopPropagation();
                                void openFolderSettings(folder.id);
                              }}
                              title={t("folderSettings")}
                              type="button"
                            >
                              <Settings2 className="h-3 w-3" />
                            </button>
                          </div>
                          <button
                            className={cn(
                              "pointer-events-auto flex h-6 w-6 items-center justify-center rounded-md transition-colors",
                              isLight
                                ? "text-black/45 hover:bg-black/5 hover:text-black/75"
                                : "text-white/45 hover:bg-white/8 hover:text-white/80",
                            )}
                            onClick={(event) => {
                              event.stopPropagation();
                              deleteFolderWithTabs(folder.id);
                            }}
                            title={t("folderCloseAll")}
                            type="button"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>

                    {!isSidebarCollapsed && folder.isExpanded ? (
                      <div
                        className={cn(
                          "ml-3 mt-1 flex flex-col gap-0.5 border-l pl-2",
                          isLight ? "border-black/8" : "border-white/10",
                        )}
                        style={shouldApplyFolderColor && folderColorTokens
                          ? { borderColor: folderColorTokens.expandedBorderColor }
                          : undefined}
                        onDragOver={canDragSidebarTabs
                          ? (event) => {
                            handleFolderDragOver(folder.id, event, { allowFolderReorder: false });
                          }
                          : undefined}
                        onDrop={canDragSidebarTabs
                          ? (event) => {
                            handleFolderDrop(folder.id, event, { allowFolderReorder: false });
                          }
                          : undefined}
                      >
                        {folder.tabIds.length === 0 ? (
                          <div
                            className={cn(
                              "rounded-lg border border-dashed px-2 py-2 text-[11px] leading-4",
                              folderDropTargetId === folder.id
                                ? isLight
                                  ? "border-sky-500/30 bg-sky-500/10 text-sky-700"
                                  : "border-sky-300/25 bg-sky-400/10 text-sky-200"
                                : isLight
                                  ? "border-black/10 text-black/40"
                                  : "border-white/10 text-white/35",
                            )}
                          >
                            {t("folderEmptyHint")}
                          </div>
                        ) : folder.tabIds.map((tabId) => {
                          const tab = tabLookup.get(tabId);
                          if (!tab) {
                            return null;
                          }

                          const tabEntry = createSidebarTabEntry(tab.id);
                          return (
                            <div
                              key={tabEntry.id}
                              ref={(node) => {
                                setSidebarEntryRef(tabEntry.id, node);
                              }}
                              className="relative z-10"
                            >
                              <BrowserTabButton
                                active={tabEntry.id === currentWorkspaceSplitState.activeEntryId}
                                activeBackgroundMode="shared"
                                className={groupDropTargetTabId === tab.id
                                  ? isLight
                                    ? "bg-sky-500/10 text-sky-700 ring-1 ring-sky-500/25"
                                    : "bg-sky-400/12 text-sky-200 ring-1 ring-sky-300/20"
                                  : undefined}
                                collapsed={false}
                                draggable={canDragSidebarTabs}
                                dropIndicator={
                                  canDragSidebarTabs && tabDropTarget?.tabId === tab.id
                                    ? tabDropTarget.position
                                    : null
                                }
                                isDragging={draggedTabId === tab.id}
                                isLight={isLight}
                                tab={tab}
                                automationLabel={t("automationControlledBadge")}
                                onClose={() => closeTab(tab.id)}
                                onContextMenu={(event) => {
                                  showTabItemMenu(tab.id, event.clientX, event.clientY);
                                }}
                                onDragEnd={canDragSidebarTabs ? handleTabDragEnd : undefined}
                                onDragOver={canDragSidebarTabs
                                  ? (event) => {
                                    handleTabDragOver(tab.id, event);
                                  }
                                  : undefined}
                                onDragStart={canDragSidebarTabs
                                  ? (event) => {
                                    handleTabDragStart(tab.id, event);
                                  }
                                  : undefined}
                                onDrop={canDragSidebarTabs
                                  ? (event) => {
                                    handleTabDrop(tab.id, event);
                                  }
                                  : undefined}
                                onSelect={() => {
                                  if (suppressTabSelectRef.current) {
                                    return;
                                  }
                                  activateSidebarEntry(tabEntry);
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              }

              const tab = tabLookup.get(entry.tabId);
              if (!tab) {
                return null;
              }

              return (
                <div
                  key={entry.id}
                  ref={(node) => {
                    setSidebarEntryRef(entry.id, node);
                  }}
                  className="relative z-10"
                >
                  <BrowserTabButton
                    active={entry.id === currentWorkspaceSplitState.activeEntryId}
                    activeBackgroundMode="shared"
                    className={groupDropTargetTabId === tab.id
                      ? isLight
                        ? "bg-sky-500/10 text-sky-700 ring-1 ring-sky-500/25"
                        : "bg-sky-400/12 text-sky-200 ring-1 ring-sky-300/20"
                      : undefined}
                    collapsed={isSidebarCollapsed}
                    draggable={canDragSidebarTabs}
                    dropIndicator={
                      sidebarEntryDropTarget?.entryId === entry.id
                        ? sidebarEntryDropTarget.position
                        : canDragSidebarTabs && tabDropTarget?.tabId === tab.id
                          ? tabDropTarget.position
                          : null
                    }
                    isDragging={draggedTabId === tab.id}
                    isLight={isLight}
                    tab={tab}
                    automationLabel={t("automationControlledBadge")}
                    onClose={() => closeTab(tab.id)}
                    onContextMenu={(event) => {
                      showTabItemMenu(tab.id, event.clientX, event.clientY);
                    }}
                    onDragEnd={canDragSidebarTabs ? handleTabDragEnd : undefined}
                    onDragOver={canDragSidebarTabs || canDragSidebarEntries
                      ? (event) => {
                        if (draggedFolderId) {
                          handleSidebarEntryDragOver(entry.id, event);
                          return;
                        }
                        handleTabDragOver(tab.id, event);
                      }
                      : undefined}
                    onDragStart={canDragSidebarTabs
                      ? (event) => {
                        handleTabDragStart(tab.id, event);
                      }
                      : undefined}
                    onDrop={canDragSidebarTabs || canDragSidebarEntries
                      ? (event) => {
                        if (draggedFolderId) {
                          handleSidebarEntryDrop(entry.id, event);
                          return;
                        }
                        handleTabDrop(tab.id, event);
                      }
                      : undefined}
                    onSelect={() => {
                      if (suppressTabSelectRef.current) {
                        return;
                      }
                      activateSidebarEntry(entry);
                    }}
                  />
                </div>
              );
            })}
          </div>

          <div className="mt-2 flex flex-col gap-1">
            <button
              className={cn(
                "flex w-full min-w-0 select-none items-center rounded-lg px-1.5 py-1 text-white/30 transition-all hover:bg-white/5 hover:text-white/60",
                isSidebarCollapsed ? "justify-center" : "gap-2",
              )}
              onClick={() => openTab()}
              type="button"
            >
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-dashed border-white/20">
                <Plus className="h-3.5 w-3.5" />
              </div>
              {!isSidebarCollapsed && (
                <span className="text-[13px] font-medium leading-5">{t("newTab")}</span>
              )}
            </button>
          </div>
        </ScrollArea>

        {!isCurrentAutomationWorkspace && (
          <div className="p-2">
            {isSidebarCollapsed ? (
              <div
                className={cn(
                  "flex h-12 w-full items-center justify-center rounded-[18px] transition-colors"
                )}
              >
                <button
                  className={cn(
                    "flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full text-[13px] font-semibold text-white transition-transform hover:scale-[1.03]",
                    !window.browserShell ? "cursor-default opacity-80" : "cursor-pointer",
                  )}
                  disabled={!window.browserShell}
                  onClick={(event) => {
                    void handleOpenWorkspaceMenu(event.currentTarget);
                  }}
                  title={currentWorkspace.name}
                  type="button"
                >
                  <span
                    className="flex h-full w-full items-center justify-center rounded-full"
                    style={currentWorkspaceAvatarStyle}
                  >
                    {currentWorkspaceIcon ? (
                      <img
                        alt=""
                        className="h-5 w-5 rounded-full object-cover"
                        src={currentWorkspaceIcon}
                      />
                    ) : (
                      currentWorkspaceAvatar
                    )}
                  </span>
                </button>
              </div>
            ) : (
              <div
                className={cn(
                  "flex w-full items-center rounded-[18px] border border-white/10 bg-white/[0.06] transition-colors",
                  "gap-2 px-2 py-2",
                  isLight ? "bg-black/[0.035] hover:bg-black/[0.05]" : "hover:bg-white/[0.08]",
                )}
                onPointerCancel={handleWorkspaceSwipePointerCancel}
                onPointerDown={handleWorkspaceSwipePointerDown}
                onPointerMove={handleWorkspaceSwipePointerMove}
                onPointerUp={handleWorkspaceSwipePointerEnd}
                onWheel={handleWorkspaceSwipeWheel}
                style={{ touchAction: "pan-y" }}
              >
                <button
                  className={cn(
                    "flex shrink-0 select-none items-center justify-center rounded-full text-[13px] font-semibold text-white transition-transform hover:scale-[1.03]",
                    "h-9 w-9",
                    !window.browserShell ? "cursor-default opacity-80" : "cursor-pointer",
                  )}
                  disabled={!window.browserShell}
                  onClick={(event) => {
                    void handleOpenWorkspaceMenu(event.currentTarget);
                  }}
                  title={currentWorkspace.name}
                  type="button"
                >
                  <span
                    className="flex h-full w-full items-center justify-center rounded-full"
                    style={currentWorkspaceAvatarStyle}
                  >
                    {currentWorkspaceIcon ? (
                      <img
                        alt=""
                        className="h-5 w-5 rounded-full object-cover"
                        src={currentWorkspaceIcon}
                      />
                    ) : (
                      currentWorkspaceAvatar
                    )}
                  </span>
                </button>

                <div className="min-w-0 flex-1 overflow-hidden">
                  <div className="flex min-w-0 items-center justify-center gap-1 overflow-hidden px-1">
                    {visibleWorkspaces.map((workspace) => {
                      const isActiveWorkspace = workspace.id === currentWorkspace.id;
                      return (
                        <span
                          key={workspace.id}
                          className={cn(
                            "h-1.5 shrink-0 rounded-full transition-all duration-200",
                            isActiveWorkspace
                              ? isLight
                                ? "w-4 bg-sky-600"
                                : "w-4 bg-sky-300"
                              : isLight
                                ? "w-1.5 bg-black/20"
                                : "w-1.5 bg-white/20",
                          )}
                          title={workspace.name}
                        />
                      );
                    })}
                  </div>
                </div>

                <button
                  className={cn(
                    "flex shrink-0 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                    "h-9 w-9",
                    isLight
                      ? "border-black/10 bg-white/60 text-black/65 hover:bg-white hover:text-black/80"
                      : "border-white/10 bg-white/10 text-white/70 hover:bg-white/15 hover:text-white",
                  )}
                  disabled={!window.browserShell}
                  onClick={() => {
                    void handleCreateWorkspace();
                  }}
                  title={t("workspaceCreate")}
                  type="button"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            )}

            {!isSidebarCollapsed && workspaceError && (
              <p className="mt-2 rounded-lg border border-rose-400/20 bg-rose-400/10 px-2 py-1.5 text-xs text-rose-100">
                {workspaceError}
              </p>
            )}
          </div>
        )}
      </aside>

      {/* Main Content — BrowserView occupies this area via main process */}
      <main
        className="relative flex flex-1 flex-col overflow-hidden"
        style={{
          ...mainChromeSurfaceStyle,
          boxShadow: chromeGlassMainInsetShadow,
        }}
      >
        <div
          className="pointer-events-none absolute inset-x-0 z-30 overflow-hidden"
          style={{
            top: browserSurfaceTop,
            left: BROWSER_SURFACE_HORIZONTAL_INSET,
            right: BROWSER_SURFACE_HORIZONTAL_INSET,
            height: TOP_LOADING_BAR_HEIGHT,
          }}
        >
          <div
            className={cn(
              "h-full rounded-r-full shadow-[0_0_18px_rgba(56,189,248,0.42)] transition-[width,opacity] ease-out",
              showTopLoadingBar ? "opacity-100" : "opacity-0",
            )}
            style={{
              width: `${topLoadingProgress}%`,
              background: isLight
                ? "linear-gradient(90deg, #38bdf8 0%, #2563eb 65%, #0ea5e9 100%)"
                : "linear-gradient(90deg, #67e8f9 0%, #3b82f6 65%, #38bdf8 100%)",
              transitionDuration: topLoadingProgress >= 100 ? "180ms" : "240ms",
            }}
          />
        </div>

        {/* 4px hover trigger zone — BrowserView starts below this */}
        {!isUrlBarVisible && (
          <div
            className="shrink-0 cursor-pointer"
            style={{ height: URL_BAR_HOVER_TRIGGER_HEIGHT }}
            onMouseEnter={() => setShowUrlBar(true)}
          />
        )}

        {/* Floating URL Bar — appears on hover and stays visible while focused */}
        {isUrlBarVisible && (
          <div
            className={cn(
              "relative z-10 flex shrink-0 items-center px-3"
            )}
            style={{ height: browserTopChromeHeight }}
            onBlur={(event) => {
              const nextFocused = event.relatedTarget;
              if (nextFocused instanceof Node && event.currentTarget.contains(nextFocused)) {
                return;
              }
              setIsUrlBarFocused(false);
              setShowUrlBar(false);
            }}
            onFocus={() => setIsUrlBarFocused(true)}
            onMouseLeave={() => {
              if (!isUrlBarFocused) {
                setShowUrlBar(false);
              }
            }}
          >
            <div className="flex w-full items-center gap-2">
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  aria-label={t("goBack")}
                  className="flex h-8 w-8 items-center justify-center rounded-xl text-white/40 transition-all hover:bg-white/10 hover:text-white"
                  disabled={!surfacedTab?.canGoBack}
                  onClick={() => surfacedTab?.id && goBack(surfacedTab.id)}
                  title={t("goBack")}
                  type="button"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <button
                  aria-label={t("goForward")}
                  className="flex h-8 w-8 items-center justify-center rounded-xl text-white/40 transition-all hover:bg-white/10 hover:text-white"
                  disabled={!surfacedTab?.canGoForward}
                  onClick={() => surfacedTab?.id && goForward(surfacedTab.id)}
                  title={t("goForward")}
                  type="button"
                >
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button
                  aria-label={isActiveTabLoading ? t("stopLoading") : t("reloadPage")}
                  className="flex h-8 w-8 items-center justify-center rounded-xl text-white/40 transition-all hover:bg-white/10 hover:text-white"
                  onClick={() => activeTabId && reloadTab(activeTabId)}
                  title={isActiveTabLoading ? t("stopLoading") : t("reloadPage")}
                  type="button"
                >
                  {isActiveTabLoading ? <X className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
                </button>
              </div>
              <div className="relative min-w-0 flex-1">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30">
                  <Search className="h-4 w-4" />
                </div>
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                  <button
                    aria-label={copyLinkButtonLabel}
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-lg transition-all",
                      copyLinkFeedback === "ok"
                        ? "text-emerald-400 hover:bg-white/10"
                        : copyLinkFeedback === "err"
                          ? "text-rose-400 hover:bg-white/10"
                          : "text-white/40 hover:bg-white/5 hover:text-white",
                      !copyLinkTarget && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-white/40",
                    )}
                    disabled={!copyLinkTarget}
                    onClick={() => {
                      void handleCopyCurrentLink();
                    }}
                    title={copyLinkButtonLabel}
                    type="button"
                  >
                    {copyLinkFeedback === "ok" ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    aria-label={isCurrentPageBookmarked ? t("removeBookmark") : t("addBookmark")}
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-lg transition-all",
                      isCurrentPageBookmarked
                        ? "text-blue-400 hover:bg-white/10"
                        : "text-white/40 hover:bg-white/5 hover:text-white",
                    )}
                    onClick={() => void toggleBookmark()}
                    title={isCurrentPageBookmarked ? t("removeBookmark") : t("addBookmark")}
                    type="button"
                  >
                    <Bookmark className="h-3.5 w-3.5" fill={isCurrentPageBookmarked ? "currentColor" : "none"} />
                  </button>
                </div>
                <input
                  ref={urlInputRef}
                  className="h-8 w-full rounded-2xl border border-white/10 bg-black/15 pl-10 pr-14 text-sm transition-all focus:border-blue-500/50 focus:bg-white/10 focus:outline-none"
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && urlInput.trim() && activeTabId) {
                      navigateTab(activeTabId, urlInput.trim());
                    }
                  }}
                  placeholder={t("addressPlaceholder")}
                  type="text"
                  value={urlInput}
                />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {toolbarExtensions.length > 0 ? (
                  <button
                    aria-haspopup="menu"
                    aria-label={t("extensionsToolbar")}
                    className={cn(
                      "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all",
                      "text-white/45 hover:bg-white/5 hover:text-white",
                    )}
                    onClick={(event) => {
                      void handleShowExtensionsMenu(event.currentTarget);
                    }}
                    title={t("extensionsToolbar")}
                    type="button"
                  >
                    <Puzzle className="h-4 w-4" />
                    {extensionActionCount > 0 ? (
                      <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-300 px-1 text-[10px] font-bold leading-none text-zinc-950">
                        {extensionActionCount}
                      </span>
                    ) : null}
                  </button>
                ) : null}
                {canShowAiSidebarButton ? (
                  <button
                    aria-expanded={isUserScriptPanelOpen}
                    aria-label={t("userScripts")}
                    className={cn(
                      "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all",
                      isUserScriptPanelOpen || enabledCurrentPageUserScriptCount > 0
                        ? "bg-amber-400/15 text-amber-200 shadow-[0_0_18px_rgba(251,191,36,0.12)]"
                        : "text-white/40 hover:bg-white/5 hover:text-white",
                    )}
                    onClick={(event) => {
                      void handleOpenUserScriptsPopup(event.currentTarget);
                    }}
                    title={t("userScripts")}
                    type="button"
                  >
                    <FileCode2 className="h-4 w-4" />
                    {enabledCurrentPageUserScriptCount > 0 ? (
                      <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-300 px-1 text-[10px] font-bold leading-none text-zinc-950">
                        {enabledCurrentPageUserScriptCount}
                      </span>
                    ) : null}
                  </button>
                ) : null}
                {activeSplit ? (
                  <button
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all",
                      "text-sky-300 hover:bg-white/10",
                      !canOpenSplitToolbarMenu && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-white/40",
                    )}
                    disabled={!canOpenSplitToolbarMenu}
                    onClick={(event) => {
                      void handleOpenSplitToolbarMenu(event.currentTarget);
                    }}
                    title={t("splitViewLabel")}
                    type="button"
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </button>
                ) : null}
                {activeSplit ? (
                  <button
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white/40 transition-all hover:bg-white/10 hover:text-white"
                    onClick={() => {
                      closeFocusedSplitPane();
                    }}
                    title={t("splitCloseView")}
                    type="button"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
                {canShowAiSidebarButton ? (
                  <button
                    aria-label={t("aiAssistant")}
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all",
                      isAiSidebarOpen
                        ? "bg-cyan-400/15 text-cyan-200 shadow-[0_0_18px_rgba(34,211,238,0.16)]"
                        : "text-white/45 hover:bg-white/5 hover:text-white",
                    )}
                    onClick={toggleAiSidebarFromToolbar}
                    title={t("aiAssistant")}
                    type="button"
                  >
                    <PanelRight className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {splitDragOverlayVisible ? (
          <div
            className="absolute z-20"
            style={{
              top: browserSurfaceContentTop,
              left: BROWSER_SURFACE_HORIZONTAL_INSET,
              right: BROWSER_SURFACE_HORIZONTAL_INSET,
              bottom: BROWSER_SURFACE_BOTTOM_INSET,
            }}
          >
            <div
              className={cn(
                "relative h-full w-full overflow-hidden rounded-[26px] border border-dashed transition-all duration-200 ease-out",
                isLight
                  ? "border-sky-500/45 bg-sky-500/[0.08]"
                  : "border-sky-300/40 bg-sky-400/[0.10]",
                splitDragPreview ? "scale-[1] opacity-100" : "scale-[0.995] opacity-85",
              )}
              onDragLeave={handleSplitDragSurfaceLeave}
              onDragOver={handleSplitDragSurfaceOver}
              onDrop={handleSplitDragSurfaceDrop}
            >
              <div
                className={cn(
                  "absolute inset-3 rounded-[22px] border transition-all duration-200",
                  isLight ? "border-black/8 bg-white/35" : "border-white/8 bg-black/12",
                  splitDragPreview ? "opacity-100" : "opacity-60",
                )}
              />
              {splitDragPanelStyles ? (
                <div className="pointer-events-none absolute inset-3">
                  <div
                    className={cn(
                      "absolute flex items-center justify-center rounded-[20px] border shadow-[0_22px_48px_rgba(56,189,248,0.16)] transition-all duration-200 ease-out animate-pulse",
                      isLight
                        ? "border-sky-500/50 bg-sky-500/[0.22] ring-2 ring-sky-500/20"
                        : "border-sky-300/50 bg-sky-400/[0.24] ring-2 ring-sky-300/20",
                    )}
                    style={{
                      ...splitDragPanelStyles.primary,
                      transform: "scale(1.015)",
                    }}
                  >
                    <div
                      className={cn(
                        "rounded-full px-3 py-1.5 text-xs font-semibold shadow-sm backdrop-blur-md transition-all duration-200",
                        isLight ? "bg-white/88 text-sky-700" : "bg-zinc-950/84 text-sky-200",
                      )}
                    >
                      {splitDragHintLabel}
                    </div>
                  </div>
                  <div
                    className={cn(
                      "absolute rounded-[20px] border transition-all duration-200 ease-out",
                      isLight ? "border-black/8 bg-white/45 opacity-75" : "border-white/8 bg-white/5 opacity-70",
                    )}
                    style={{
                      ...splitDragPanelStyles.secondary,
                      transform: "scale(0.99)",
                    }}
                  />
                  <div
                    className={cn(
                      "absolute transition-all duration-200 ease-out",
                      isLight ? "bg-sky-500/40" : "bg-sky-300/40",
                      splitDragPreview?.mode === "horizontal"
                        ? "bottom-0 top-0 w-[3px] -translate-x-1/2 rounded-full left-1/2"
                        : "left-0 right-0 h-[3px] -translate-y-1/2 rounded-full top-1/2",
                    )}
                  />
                </div>
              ) : null}
              <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center">
                <div
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-medium shadow-sm transition-all duration-200",
                    isLight ? "bg-white/88 text-black/70" : "bg-zinc-950/82 text-white/80",
                  )}
                >
                  {splitDragHintLabel}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {surfacedManualInterventionMessage ? (
          <div
            className="pointer-events-none absolute z-30 flex justify-center px-6"
            style={{
              top: browserSurfaceContentTop + 16,
              left: BROWSER_SURFACE_HORIZONTAL_INSET,
              right: BROWSER_SURFACE_HORIZONTAL_INSET,
            }}
          >
            <div
              className={cn(
                "inline-flex max-w-[min(720px,100%)] items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl",
                isLight
                  ? "border-amber-500/25 bg-white/88 text-amber-700"
                  : "border-amber-300/20 bg-zinc-950/82 text-amber-200",
              )}
            >
              <TriangleAlert className="h-4 w-4 shrink-0" />
              <span className="truncate">{surfacedManualInterventionMessage}</span>
            </div>
          </div>
        ) : null}

        {isPageSearchVisible ? (
          <div
            className="pointer-events-none absolute z-40 flex justify-end px-3"
            style={{
              top: pageSearchTop,
              left: BROWSER_SURFACE_HORIZONTAL_INSET,
              right: BROWSER_SURFACE_HORIZONTAL_INSET,
            }}
          >
            <div
              className={cn(
                "page-findbar pointer-events-auto flex items-center gap-1 rounded-xl border px-2 py-2 shadow-[0_16px_40px_rgba(15,23,42,0.24)]",
                isLight
                  ? "border-black/12 bg-white text-black/80"
                  : "border-white/10 bg-[#3a3b3f] text-white/85",
              )}
            >
              <input
                ref={pageSearchInputRef}
                className={cn(
                  "page-findbar-input h-8 w-56 rounded-md border px-3 text-sm outline-none transition-colors",
                  pageSearchHasNoMatches && "page-findbar-input-no-match",
                  pageSearchHasNoMatches
                    ? isLight
                      ? "border-rose-300 bg-rose-50 text-rose-700"
                      : "border-rose-400/40 bg-rose-500/10 text-rose-200"
                    : isLight
                      ? "border-black/10 bg-white text-black/80 focus:border-sky-500/55"
                      : "border-white/10 bg-black/15 text-white/90 focus:border-sky-300/55",
                )}
                onChange={(event) => {
                  setPageSearchQuery(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    stepPageSearchMatch(!event.shiftKey);
                    return;
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();
                    closePageSearch();
                  }
                }}
                placeholder={t("findInPagePlaceholder")}
                spellCheck={false}
                type="search"
                value={pageSearchQuery}
              />
              <div
                className={cn(
                  "page-findbar-count min-w-[72px] px-2 text-right text-xs font-medium",
                  pageSearchHasNoMatches && "page-findbar-count-no-match",
                  pageSearchHasNoMatches
                    ? isLight ? "text-rose-600" : "text-rose-200"
                    : isLight ? "text-black/45" : "text-white/45",
                )}
              >
                {pageSearchCountLabel}
              </div>
              <div
                className={cn(
                  "ml-1 flex items-center gap-0.5 border-l pl-1",
                  isLight ? "border-black/8" : "border-white/8",
                )}
              >
                <button
                  aria-label={t("findInPagePrevious")}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
                    pageSearchCanStepThroughMatches
                      ? isLight
                        ? "text-black/55 hover:bg-black/5 hover:text-black/80"
                        : "text-white/55 hover:bg-white/8 hover:text-white"
                      : isLight
                        ? "cursor-not-allowed text-black/20"
                        : "cursor-not-allowed text-white/20",
                  )}
                  disabled={!pageSearchCanStepThroughMatches}
                  onClick={() => {
                    stepPageSearchMatch(false);
                  }}
                  title={t("findInPagePrevious")}
                  type="button"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  aria-label={t("findInPageNext")}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
                    pageSearchCanStepThroughMatches
                      ? isLight
                        ? "text-black/55 hover:bg-black/5 hover:text-black/80"
                        : "text-white/55 hover:bg-white/8 hover:text-white"
                      : isLight
                        ? "cursor-not-allowed text-black/20"
                        : "cursor-not-allowed text-white/20",
                  )}
                  disabled={!pageSearchCanStepThroughMatches}
                  onClick={() => {
                    stepPageSearchMatch(true);
                  }}
                  title={t("findInPageNext")}
                  type="button"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
              <button
                aria-label={t("findInPageClose")}
                className={cn(
                  "ml-1 flex h-7 w-7 items-center justify-center rounded-md transition-colors",
                  isLight
                    ? "text-black/45 hover:bg-black/5 hover:text-black/80"
                    : "text-white/45 hover:bg-white/8 hover:text-white",
                )}
                onClick={() => {
                  closePageSearch();
                }}
                title={t("findInPageClose")}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : null}

        {activeSplit && (
          <div
            ref={splitSurfaceRef}
            className="pointer-events-none absolute z-10"
            style={{
              top: browserSurfaceContentTop,
              left: BROWSER_SURFACE_HORIZONTAL_INSET,
              right: BROWSER_SURFACE_HORIZONTAL_INSET,
              bottom: BROWSER_SURFACE_BOTTOM_INSET,
            }}
          >
            {splitPanels.map((panel) => {
              if (!tabLookup.has(panel.tabId)) {
                return null;
              }

              const isFocusedPane = activeSplit.focusedTabId === panel.tabId;
              return (
                <div
                  key={panel.tabId}
                  className={cn(
                    "pointer-events-none absolute overflow-hidden rounded-[22px]"
                  )}
                  style={{
                    left: panel.x,
                    top: panel.y,
                    width: panel.width,
                    height: panel.height,
                  }}
                />
              );
            })}
          </div>
        )}

        {/* BrowserView renders here — this area is managed by main process */}
        {/* Non-Electron fallback */}
        {!isElectronShell ? (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/20 backdrop-blur-md">
            <div className="max-w-md rounded-[28px] border border-white/10 bg-[#1a1a1a]/50 p-8 text-center shadow-2xl backdrop-blur-xl">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-500/70 to-purple-500/70">
                <Globe className="h-8 w-8 text-white" />
              </div>
              <h2 className="text-2xl font-bold text-white">
                {t("runInElectronTitle")}
              </h2>
              <p className="mt-3 text-sm leading-6 text-white/50">
                {`${t("runInElectronPrefix")} `}
                <code className="mx-1 rounded bg-white/10 px-1.5 py-0.5 text-xs">
                  BrowserView
                </code>
                {` ${t("runInElectronSuffix")}`}
              </p>
            </div>
          </div>
        ) : null}

        {/* Background Ambient Glow */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[800px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/6 blur-[120px]" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-[400px] w-[400px] rounded-full bg-cyan-400/6 blur-[100px]" />
      </main>
    </div>
    </>
  );
}
