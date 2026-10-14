import { BrowserWindow } from "electron";
import type { TabRecord, WorkspaceRecord } from "../shared/contracts.js";

interface CreateSpecialPageManagerOptions {
  defaultWorkspaceId: string;
  settingsPageEntry: string;
  settingsUrl: string;
  downloadsPageEntry: string;
  downloadsUrl: string;
  extensionsPageEntry: string;
  extensionsUrl: string;
  workspaces: Map<string, WorkspaceRecord>;
  windowToWorkspace: Map<number, string>;
  tabRecords: Map<number, Map<string, TabRecord>>;
  resolvePageEntry: (url: URL) => string | null | undefined;
  createWorkspaceWindow: (
    workspace: WorkspaceRecord,
    options: { show: boolean; initialUrl?: string; forceInitialUrl?: boolean },
  ) => BrowserWindow;
  revealWorkspaceWindow: (targetWindow: BrowserWindow) => void;
  handleTabSetActive: (targetWindow: BrowserWindow, tabId: string) => void;
  handleTabCreate: (targetWindow: BrowserWindow, url?: string) => unknown;
}

export function createSpecialPageManager(options: CreateSpecialPageManagerOptions) {
  const {
    defaultWorkspaceId,
    settingsPageEntry,
    settingsUrl,
    downloadsPageEntry,
    downloadsUrl,
    extensionsPageEntry,
    extensionsUrl,
    workspaces,
    windowToWorkspace,
    tabRecords,
    resolvePageEntry,
    createWorkspaceWindow,
    revealWorkspaceWindow,
    handleTabSetActive,
    handleTabCreate,
  } = options;

  function isSpecialPageUrl(url: string, pageEntry: string) {
    if (!url) {
      return false;
    }

    try {
      const parsedUrl = new URL(url);
      if (resolvePageEntry(parsedUrl) === pageEntry) {
        return true;
      }

      return parsedUrl.pathname.toLowerCase().endsWith(`/${pageEntry}`);
    } catch {
      return false;
    }
  }

  function findSpecialTab(pageEntry: string) {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    const workspaceWindows = BrowserWindow.getAllWindows().filter(
      (candidate) => !candidate.isDestroyed() && windowToWorkspace.has(candidate.id),
    );

    const orderedWindows =
      focusedWindow && workspaceWindows.some((candidate) => candidate.id === focusedWindow.id)
        ? [
          focusedWindow,
          ...workspaceWindows.filter((candidate) => candidate.id !== focusedWindow.id),
        ]
        : workspaceWindows;

    for (const targetWindow of orderedWindows) {
      const tabs = tabRecords.get(targetWindow.id);
      if (!tabs) {
        continue;
      }

      const matchingTab = Array.from(tabs.values()).find((tab) =>
        isSpecialPageUrl(tab.url, pageEntry));
      if (matchingTab) {
        return { targetWindow, tabId: matchingTab.id };
      }
    }

    return null;
  }

  function findTargetWindow() {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    return (focusedWindow && windowToWorkspace.has(focusedWindow.id) ? focusedWindow : null)
      ?? BrowserWindow.getAllWindows().find(
        (candidate) => !candidate.isDestroyed() && windowToWorkspace.has(candidate.id),
      )
      ?? null;
  }

  function openSpecialPage(pageEntry: string, pageUrl: string) {
    const existingTab = findSpecialTab(pageEntry);
    if (existingTab) {
      revealWorkspaceWindow(existingTab.targetWindow);
      handleTabSetActive(existingTab.targetWindow, existingTab.tabId);
      return;
    }

    const targetWindow = findTargetWindow();
    if (targetWindow && !targetWindow.isDestroyed()) {
      revealWorkspaceWindow(targetWindow);
      handleTabCreate(targetWindow, pageUrl);
      return;
    }

    const defaultWorkspace = workspaces.get(defaultWorkspaceId);
    if (!defaultWorkspace) {
      return;
    }

    const nextWindow = createWorkspaceWindow(defaultWorkspace, {
      show: true,
      initialUrl: pageUrl,
      forceInitialUrl: true,
    });
    revealWorkspaceWindow(nextWindow);
  }

  return {
    openPageFromApplicationMenu: (pageEntry: string, pageUrl: string) => {
      openSpecialPage(pageEntry, pageUrl);
    },
    openSettingsFromApplicationMenu: () => {
      openSpecialPage(settingsPageEntry, settingsUrl);
    },
    openDownloadsFromApplicationMenu: () => {
      openSpecialPage(downloadsPageEntry, downloadsUrl);
    },
    openExtensionsFromApplicationMenu: () => {
      openSpecialPage(extensionsPageEntry, extensionsUrl);
    },
  };
}
