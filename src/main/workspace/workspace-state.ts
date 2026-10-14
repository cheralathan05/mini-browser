import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import type { NavigationEntry, WebContentsView } from "electron";
import { normalizeOrganizerSidebarState } from "../agent/browser-organizer.js";
import type {
  SidebarOrganizationState,
  TabRecord,
  WindowWorkspaceCacheRecord,
  WorkspaceRecord,
  WorkspaceSessionTabRecord,
  WorkspaceSessionRecord,
} from "../shared/contracts.js";

interface WorkspaceStateStoragePayload {
  version: number;
  workspaces: WorkspaceRecord[];
  sessions: WorkspaceSessionRecord[];
}

const WORKSPACE_STATE_VERSION = 3;

interface ParsedWorkspaceState {
  workspaces: WorkspaceRecord[];
  sessions: WorkspaceSessionRecord[];
}

interface StartPageUrlOptions {
  startPageUrl: string;
  miloScheme: string;
  miloHomeHost: string;
}

interface CreateWorkspaceStateManagerOptions {
  defaultWorkspaceId: string;
  workspaceStatePath: string;
  workspaceStateBackupPath: string;
  workspaceStateTempPath: string;
  workspaces: Map<string, WorkspaceRecord>;
  workspaceSessions: Map<string, WorkspaceSessionRecord>;
  windowToWorkspace: Map<number, string>;
  tabRecords: Map<number, Map<string, TabRecord>>;
  browserViews: Map<string, WebContentsView>;
  windowActiveTabs: Map<number, string>;
  getWindowWorkspaceCacheMap: (
    windowId: number,
  ) => Map<string, WindowWorkspaceCacheRecord> | undefined;
  resolveWorkspaceActiveTabId: (
    record: WindowWorkspaceCacheRecord,
  ) => string | undefined;
  compareWorkspacesByCreatedAt: (
    left: WorkspaceRecord,
    right: WorkspaceRecord,
    defaultWorkspaceId: string,
  ) => number;
  shouldDeferWorkspaceSessionPersistence?: (input: {
    windowId?: number;
    workspaceId: string;
    tabIds: string[];
  }) => boolean;
  getSidebarOrganizationStateForSession?: (input: {
    windowId: number;
    workspaceId: string;
    tabs: TabRecord[];
    activeTabId?: string;
  }) => SidebarOrganizationState | undefined;
  inferTitleFromUrl: (url: string, options: StartPageUrlOptions) => string;
  startPageUrlOptions: StartPageUrlOptions;
}

function sanitizeWorkspaceTags(input: unknown) {
  if (!Array.isArray(input)) {
    return undefined;
  }

  const tags = Array.from(
    new Set(
      input.flatMap((entry) => {
        if (typeof entry !== "string") {
          return [];
        }

        const normalized = entry.trim();
        return normalized ? [normalized] : [];
      }),
    ),
  );

  return tags.length > 0 ? tags : undefined;
}

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cloneSidebarOrganizationState(
  state?: SidebarOrganizationState,
): SidebarOrganizationState | undefined {
  if (!state) {
    return undefined;
  }

  return {
    activeEntryId: state.activeEntryId,
    entries: state.entries.map((entry) => ({ ...entry })),
    folders: Object.fromEntries(
      Object.entries(state.folders).map(([folderId, folder]) => [folderId, {
        ...folder,
        tabIds: [...folder.tabIds],
      }]),
    ),
    splits: Object.fromEntries(
      Object.entries(state.splits).map(([splitId, split]) => [splitId, {
        ...split,
        tabIds: [...split.tabIds],
      }]),
    ),
  };
}

function sanitizeWorkspaceSidebarState(
  input: unknown,
  tabs: WorkspaceSessionTabRecord[],
  activeTabIndex: number,
) {
  if (!input || typeof input !== "object" || Array.isArray(input) || tabs.length === 0) {
    return undefined;
  }

  const activeTabId = tabs[activeTabIndex]?.id ?? tabs[0]?.id;
  return cloneSidebarOrganizationState(normalizeOrganizerSidebarState(
    input,
    tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      url: tab.url,
      displayUrl: tab.url,
      isActive: tab.id === activeTabId,
    })),
    activeTabId,
  ));
}

function sanitizeWorkspaceRecords(
  input: unknown,
  options: {
    defaultWorkspaceId: string;
    payloadVersion: number;
  },
) {
  if (!Array.isArray(input)) {
    return [] as WorkspaceRecord[];
  }

  const sanitized: WorkspaceRecord[] = [];
  const seenWorkspaceIds = new Set<string>();

  for (const entry of input) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const maybeWorkspace = entry as Partial<WorkspaceRecord>;
    const workspaceId = typeof maybeWorkspace.id === "string"
      ? maybeWorkspace.id.trim()
      : "";
    if (!workspaceId || seenWorkspaceIds.has(workspaceId)) {
      continue;
    }

    const profileId = typeof maybeWorkspace.profileId === "string"
      && maybeWorkspace.profileId.trim()
      ? maybeWorkspace.profileId.trim()
      : workspaceId;

    sanitized.push({
      id: workspaceId,
      name: typeof maybeWorkspace.name === "string" && maybeWorkspace.name.trim()
        ? maybeWorkspace.name.trim()
        : workspaceId,
      createdAt: Number.isFinite(maybeWorkspace.createdAt)
        ? Number(maybeWorkspace.createdAt)
        : workspaceId === options.defaultWorkspaceId
          ? 0
          : sanitized.length + 1,
      profileId,
      profileMode: maybeWorkspace.profileMode === "attached" ? "attached" : "new",
      profileSourceWorkspaceId: typeof maybeWorkspace.profileSourceWorkspaceId === "string"
        && maybeWorkspace.profileSourceWorkspaceId.trim()
        ? maybeWorkspace.profileSourceWorkspaceId.trim()
        : undefined,
      automationEnabled: true,
      tags: sanitizeWorkspaceTags((maybeWorkspace as { tags?: unknown }).tags),
    });
    seenWorkspaceIds.add(workspaceId);
  }

  const workspaceIds = new Set(sanitized.map((workspace) => workspace.id));
  return sanitized.map((workspace) => ({
    ...workspace,
    profileSourceWorkspaceId:
      workspace.profileSourceWorkspaceId && workspaceIds.has(workspace.profileSourceWorkspaceId)
        ? workspace.profileSourceWorkspaceId
        : undefined,
  }));
}

function sanitizeWorkspaceSessionRecords(
  input: unknown,
  workspaceIds: Set<string>,
  options: {
    inferTitleFromUrl: (url: string, startPageUrlOptions: StartPageUrlOptions) => string;
    startPageUrlOptions: StartPageUrlOptions;
  },
) {
  if (!Array.isArray(input)) {
    return [] as WorkspaceSessionRecord[];
  }

  const sanitized: WorkspaceSessionRecord[] = [];
  const seenWorkspaceIds = new Set<string>();

  for (const entry of input) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const maybeSession = entry as Partial<WorkspaceSessionRecord>;
    const workspaceId = typeof maybeSession.workspaceId === "string"
      ? maybeSession.workspaceId.trim()
      : "";
    if (!workspaceId || !workspaceIds.has(workspaceId) || seenWorkspaceIds.has(workspaceId)) {
      continue;
    }

    const seenTabIds = new Set<string>();
    const tabs = Array.isArray(maybeSession.tabs)
      ? maybeSession.tabs.flatMap((tab) => {
        if (!tab || typeof tab !== "object") {
          return [];
        }

        const maybeTab = tab as Partial<WorkspaceSessionTabRecord>;
        const historyEntries = Array.isArray(maybeTab.historyEntries)
          ? maybeTab.historyEntries.flatMap((entry) => {
            if (!entry || typeof entry !== "object") {
              return [];
            }

            const maybeEntry = entry as Partial<NavigationEntry>;
            const entryUrl = typeof maybeEntry.url === "string" ? maybeEntry.url.trim() : "";
            if (!entryUrl) {
              return [];
            }

            return [{
              url: entryUrl,
              title: typeof maybeEntry.title === "string" && maybeEntry.title.trim()
                ? maybeEntry.title.trim()
                : options.inferTitleFromUrl(entryUrl, options.startPageUrlOptions),
              pageState: typeof maybeEntry.pageState === "string" && maybeEntry.pageState.trim()
                ? maybeEntry.pageState
                : undefined,
            } satisfies NavigationEntry];
          })
          : [];
        const maxHistoryIndex = Math.max(0, historyEntries.length - 1);
        const historyIndex = historyEntries.length > 0
          ? Number.isFinite(maybeTab.historyIndex)
            ? Math.min(Math.max(0, Number(maybeTab.historyIndex)), maxHistoryIndex)
            : maxHistoryIndex
          : undefined;
        const historyEntry =
          historyIndex !== undefined
            ? historyEntries[historyIndex]
            : historyEntries[historyEntries.length - 1];
        const url = typeof maybeTab.url === "string" && maybeTab.url.trim()
          ? maybeTab.url.trim()
          : historyEntry?.url ?? "";
        if (!url) {
          return [];
        }
        let tabId = readNonEmptyString(maybeTab.id) ?? randomUUID();
        while (seenTabIds.has(tabId)) {
          tabId = randomUUID();
        }
        seenTabIds.add(tabId);

        return [{
          id: tabId,
          url,
          title: typeof maybeTab.title === "string" && maybeTab.title.trim()
            ? maybeTab.title.trim()
            : historyEntry?.title
              ? historyEntry.title
              : options.inferTitleFromUrl(url, options.startPageUrlOptions),
          favicon: typeof maybeTab.favicon === "string" ? maybeTab.favicon : undefined,
          historyEntries: historyEntries.length > 0 ? historyEntries : undefined,
          historyIndex,
        }];
      })
      : [];

    const maxActiveTabIndex = Math.max(0, tabs.length - 1);
    const activeTabIndex = Number.isFinite(maybeSession.activeTabIndex)
      ? Math.min(Math.max(0, Number(maybeSession.activeTabIndex)), maxActiveTabIndex)
      : maxActiveTabIndex;
    const sidebarState = sanitizeWorkspaceSidebarState(
      maybeSession.sidebarState,
      tabs,
      activeTabIndex,
    );

    sanitized.push({
      workspaceId,
      tabs,
      activeTabIndex,
      updatedAt: Number.isFinite(maybeSession.updatedAt)
        ? Number(maybeSession.updatedAt)
        : Date.now(),
      ...(sidebarState ? { sidebarState } : {}),
    });
    seenWorkspaceIds.add(workspaceId);
  }

  return sanitized;
}

export function createWorkspaceStateManager(options: CreateWorkspaceStateManagerOptions) {
  const {
    defaultWorkspaceId,
    workspaceStatePath,
    workspaceStateBackupPath,
    workspaceStateTempPath,
    workspaces,
    workspaceSessions,
    windowToWorkspace,
    tabRecords,
    browserViews,
    windowActiveTabs,
    getWindowWorkspaceCacheMap,
    resolveWorkspaceActiveTabId,
    compareWorkspacesByCreatedAt,
    shouldDeferWorkspaceSessionPersistence,
    getSidebarOrganizationStateForSession,
    inferTitleFromUrl,
    startPageUrlOptions,
  } = options;

  let workspaceStateSaveTimer: NodeJS.Timeout | null = null;

  function readTabNavigationHistory(tabId: string) {
    const contents = browserViews.get(tabId)?.webContents;
    if (!contents || contents.isDestroyed()) {
      return null;
    }

    try {
      return contents.navigationHistory;
    } catch {
      return null;
    }
  }

  function buildWorkspaceSessionRecord(
    workspaceId: string,
    tabs: TabRecord[],
    activeTabId?: string,
    windowId?: number,
  ) {
    if (tabs.length === 0) {
      return null;
    }

    const sessionTabs = tabs.map((tab) => {
      const history = readTabNavigationHistory(tab.id);
      const rawHistoryEntries = history?.getAllEntries() ?? tab.historyEntries ?? [];
      const historyEntries = rawHistoryEntries
        .flatMap((entry) => {
          const entryUrl = typeof entry.url === "string" ? entry.url.trim() : "";
          if (!entryUrl) {
            return [];
          }

          return [{
            url: entryUrl,
            title: typeof entry.title === "string" && entry.title.trim()
              ? entry.title.trim()
              : inferTitleFromUrl(entryUrl, startPageUrlOptions),
            pageState: typeof entry.pageState === "string" && entry.pageState.trim()
              ? entry.pageState
              : undefined,
          } satisfies NavigationEntry];
        });
      const maxHistoryIndex = Math.max(0, historyEntries.length - 1);
      const historyIndex = historyEntries.length > 0
        ? Math.min(Math.max(0, history?.getActiveIndex() ?? tab.historyIndex ?? maxHistoryIndex), maxHistoryIndex)
        : undefined;
      const activeEntry =
        historyIndex !== undefined
          ? historyEntries[historyIndex]
          : historyEntries[historyEntries.length - 1];

      return {
        id: tab.id,
        url: activeEntry?.url ?? tab.url,
        title:
          tab.title.trim()
          || activeEntry?.title
          || inferTitleFromUrl(activeEntry?.url ?? tab.url, startPageUrlOptions),
        favicon: tab.favicon,
        historyEntries: historyEntries.length > 0 ? historyEntries : undefined,
        historyIndex,
      } satisfies WorkspaceSessionTabRecord;
    });
    const resolvedActiveTabIndex = tabs.findIndex((tab) => tab.id === activeTabId);
    const sidebarState = typeof windowId === "number"
      ? cloneSidebarOrganizationState(getSidebarOrganizationStateForSession?.({
        windowId,
        workspaceId,
        tabs,
        activeTabId,
      }))
      : undefined;

    return {
      workspaceId,
      tabs: sessionTabs,
      activeTabIndex: resolvedActiveTabIndex >= 0 ? resolvedActiveTabIndex : Math.max(0, tabs.length - 1),
      updatedAt: Date.now(),
      ...(sidebarState ? { sidebarState } : {}),
    } satisfies WorkspaceSessionRecord;
  }

  function persistWorkspaceSessionSnapshot(
    workspaceId: string,
    tabs: TabRecord[],
    activeTabId?: string,
    windowId?: number,
  ) {
    if (!workspaces.has(workspaceId) || tabs.length === 0) {
      if (!workspaces.has(workspaceId)) {
        workspaceSessions.delete(workspaceId);
      }
      return;
    }

    if (shouldDeferWorkspaceSessionPersistence?.({
      windowId,
      workspaceId,
      tabIds: tabs.map((tab) => tab.id),
    })) {
      return;
    }

    const sessionRecord = buildWorkspaceSessionRecord(workspaceId, tabs, activeTabId, windowId);
    if (!sessionRecord) {
      return;
    }

    workspaceSessions.set(workspaceId, sessionRecord);
    scheduleSaveWorkspaceState();
  }

  function persistAllWorkspaceSessionsForWindow(windowId: number) {
    const workspaceId = windowToWorkspace.get(windowId);
    const tabs = tabRecords.get(windowId);
    if (workspaceId && tabs) {
      persistWorkspaceSessionSnapshot(
        workspaceId,
        Array.from(tabs.values()),
        windowActiveTabs.get(windowId),
        windowId,
      );
    } else if (workspaceId && !workspaces.has(workspaceId)) {
      workspaceSessions.delete(workspaceId);
    }

    const cacheMap = getWindowWorkspaceCacheMap(windowId);
    if (!cacheMap) {
      return;
    }

    for (const [cachedWorkspaceId, cachedRecord] of cacheMap.entries()) {
      persistWorkspaceSessionSnapshot(
        cachedWorkspaceId,
        Array.from(cachedRecord.tabs.values()),
        resolveWorkspaceActiveTabId(cachedRecord),
        windowId,
      );
    }
  }

  function persistWorkspaceSessionForWindow(windowId: number) {
    const workspaceId = windowToWorkspace.get(windowId);
    const tabs = tabRecords.get(windowId);
    if (!workspaceId || !workspaces.has(workspaceId) || !tabs || tabs.size === 0) {
      if (workspaceId && !workspaces.has(workspaceId)) {
        workspaceSessions.delete(workspaceId);
      }
      return;
    }

    persistWorkspaceSessionSnapshot(
      workspaceId,
      Array.from(tabs.values()),
      windowActiveTabs.get(windowId),
      windowId,
    );
  }

  function getWorkspaceSession(workspaceId: string) {
    return workspaceSessions.get(workspaceId);
  }

  function setWorkspaceStateSnapshot(snapshot: ParsedWorkspaceState) {
    workspaces.clear();
    for (const workspace of snapshot.workspaces) {
      workspaces.set(workspace.id, workspace);
    }

    workspaceSessions.clear();
    for (const sessionRecord of snapshot.sessions) {
      workspaceSessions.set(sessionRecord.workspaceId, sessionRecord);
    }
  }

  function clearWorkspaceStateSnapshot() {
    workspaces.clear();
    workspaceSessions.clear();
  }

  function parseWorkspaceState(raw: string): ParsedWorkspaceState {
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new Error("Workspace state file is empty.");
    }

    const parsed = JSON.parse(trimmed) as unknown;
    const payload = Array.isArray(parsed)
      ? { workspaces: parsed, sessions: [] as WorkspaceSessionRecord[] }
      : parsed as Partial<WorkspaceStateStoragePayload>;

    if (!Array.isArray(payload.workspaces)) {
      throw new Error("Workspace state payload is missing a workspaces array.");
    }

    const payloadVersion = "version" in payload && Number.isFinite(payload.version)
      ? Number(payload.version)
      : 0;

    const persistedWorkspaces = sanitizeWorkspaceRecords(payload.workspaces, {
      defaultWorkspaceId,
      payloadVersion,
    });
    if (payload.workspaces.length > 0 && persistedWorkspaces.length === 0) {
      throw new Error("Workspace state payload does not contain any valid workspace records.");
    }

    const workspaceIds = new Set(persistedWorkspaces.map((workspace) => workspace.id));
    const persistedSessions = sanitizeWorkspaceSessionRecords(payload.sessions, workspaceIds, {
      inferTitleFromUrl,
      startPageUrlOptions,
    });

    return {
      workspaces: persistedWorkspaces,
      sessions: persistedSessions,
    };
  }

  function tryLoadWorkspaceStateFile(filePath: string) {
    if (!existsSync(filePath)) {
      return {
        ok: false as const,
        reason: "missing" as const,
      };
    }

    try {
      return {
        ok: true as const,
        snapshot: parseWorkspaceState(readFileSync(filePath, "utf-8")),
      };
    } catch (error) {
      return {
        ok: false as const,
        reason: "invalid" as const,
        error,
      };
    }
  }

  function archiveWorkspaceStateFile(filePath: string, label: string) {
    if (!existsSync(filePath)) {
      return;
    }

    const archivePath = `${filePath}.${label}-${Date.now()}`;
    try {
      copyFileSync(filePath, archivePath);
      console.warn(`[Workspace] Archived ${label} workspace state to ${archivePath}.`);
    } catch (error) {
      console.error(`[Workspace] Failed to archive ${label} workspace state from ${filePath}.`, error);
    }
  }

  function saveWorkspaceStateNow() {
    try {
      const payload: WorkspaceStateStoragePayload = {
        version: WORKSPACE_STATE_VERSION,
        workspaces: Array.from(workspaces.values())
          .sort((left, right) => compareWorkspacesByCreatedAt(left, right, defaultWorkspaceId))
          .map((workspace) => ({ ...workspace })),
        sessions: Array.from(workspaceSessions.values())
          .filter((sessionRecord) => workspaces.has(sessionRecord.workspaceId))
          .sort((left, right) => left.workspaceId.localeCompare(right.workspaceId))
          .map((sessionRecord) => ({
            ...sessionRecord,
            tabs: sessionRecord.tabs.map((tab) => ({ ...tab })),
            ...(sessionRecord.sidebarState
              ? { sidebarState: cloneSidebarOrganizationState(sessionRecord.sidebarState) }
              : {}),
          })),
      };
      const serialized = JSON.stringify(payload, null, 2);

      writeFileSync(workspaceStateTempPath, serialized, "utf-8");
      renameSync(workspaceStateTempPath, workspaceStatePath);

      try {
        copyFileSync(workspaceStatePath, workspaceStateBackupPath);
      } catch (error) {
        console.error("[Workspace] Failed to refresh workspace state backup.", error);
      }
    } catch (error) {
      try {
        if (existsSync(workspaceStateTempPath)) {
          unlinkSync(workspaceStateTempPath);
        }
      } catch {
        // Ignore temp cleanup failures.
      }

      console.error("[Workspace] Failed to save workspace state.", error);
    }
  }

  function scheduleSaveWorkspaceState() {
    if (workspaceStateSaveTimer) {
      return;
    }

    workspaceStateSaveTimer = setTimeout(() => {
      workspaceStateSaveTimer = null;
      saveWorkspaceStateNow();
    }, 200);
  }

  function flushWorkspaceStateSave() {
    if (workspaceStateSaveTimer) {
      clearTimeout(workspaceStateSaveTimer);
      workspaceStateSaveTimer = null;
    }

    saveWorkspaceStateNow();
  }

  function loadWorkspaceState() {
    const primaryState = tryLoadWorkspaceStateFile(workspaceStatePath);
    if (primaryState.ok) {
      setWorkspaceStateSnapshot(primaryState.snapshot);
      return;
    }

    const backupState = tryLoadWorkspaceStateFile(workspaceStateBackupPath);
    if (backupState.ok) {
      if (primaryState.reason === "invalid") {
        console.error("[Workspace] Failed to load primary workspace state.", primaryState.error);
        archiveWorkspaceStateFile(workspaceStatePath, "corrupt");
        console.warn("[Workspace] Recovered workspace state from backup.");
      } else {
        console.warn("[Workspace] Primary workspace state file is missing. Recovered from backup.");
      }
      setWorkspaceStateSnapshot(backupState.snapshot);
      return;
    }

    if (primaryState.reason === "invalid") {
      console.error("[Workspace] Failed to load primary workspace state.", primaryState.error);
      archiveWorkspaceStateFile(workspaceStatePath, "corrupt");
    }

    if (backupState.reason === "invalid") {
      console.error("[Workspace] Failed to load backup workspace state.", backupState.error);
      archiveWorkspaceStateFile(workspaceStateBackupPath, "backup-corrupt");
    }

    clearWorkspaceStateSnapshot();
  }

  return {
    flushWorkspaceStateSave,
    getWorkspaceSession,
    loadWorkspaceState,
    persistAllWorkspaceSessionsForWindow,
    persistWorkspaceSessionForWindow,
  };
}
