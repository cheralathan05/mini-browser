export type OrganizerSidebarEntry =
  | { id: string; kind: "tab"; tabId: string }
  | { id: string; kind: "folder"; folderId: string }
  | { id: string; kind: "split"; splitId: string };

export interface OrganizerSidebarFolderState {
  id: string;
  title: string;
  icon?: string;
  backgroundColor?: string;
  tabIds: string[];
  isExpanded: boolean;
}

export interface OrganizerSidebarSplitState {
  id: string;
  mode: "horizontal" | "vertical" | "bento";
  tabIds: string[];
  focusedTabId: string;
  syncScroll: boolean;
}

export interface OrganizerSidebarState {
  activeEntryId: string | null;
  entries: OrganizerSidebarEntry[];
  folders: Record<string, OrganizerSidebarFolderState>;
  splits: Record<string, OrganizerSidebarSplitState>;
}

export interface OrganizerTabLike {
  id: string;
  title: string;
  url: string;
  displayUrl: string;
  isActive?: boolean;
}

export type OrganizerSortStrategy = "title" | "domain" | "url";
export type OrganizerSortDirection = "asc" | "desc";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function readFolderBackgroundColor(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
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

function createSidebarTabEntry(tabId: string): OrganizerSidebarEntry {
  return {
    id: `tab:${tabId}`,
    kind: "tab",
    tabId,
  };
}

function createSidebarFolderEntry(folderId: string): OrganizerSidebarEntry {
  return {
    id: `folder:${folderId}`,
    kind: "folder",
    folderId,
  };
}

function createSidebarSplitEntry(splitId: string): OrganizerSidebarEntry {
  return {
    id: `split:${splitId}`,
    kind: "split",
    splitId,
  };
}

function createDefaultFolderTitle() {
  return "Folder";
}

function dedupeTabIds(tabIds: string[], liveTabIds: Set<string>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tabId of tabIds) {
    if (!tabId || seen.has(tabId) || !liveTabIds.has(tabId)) {
      continue;
    }
    seen.add(tabId);
    result.push(tabId);
  }
  return result;
}

function getEntryIdForTab(state: OrganizerSidebarState, tabId?: string) {
  if (!tabId) {
    return null;
  }

  const splitEntry = state.entries.find(
    (entry) => entry.kind === "split" && state.splits[entry.splitId]?.tabIds.includes(tabId),
  );
  if (splitEntry) {
    return splitEntry.id;
  }

  if (
    state.entries.some((entry) => entry.kind === "tab" && entry.tabId === tabId)
    || Object.values(state.folders).some((folder) => folder.tabIds.includes(tabId))
  ) {
    return createSidebarTabEntry(tabId).id;
  }

  return null;
}

function getActiveEntryId(state: OrganizerSidebarState, activeTabId?: string) {
  const activeTabEntryId = getEntryIdForTab(state, activeTabId);
  if (activeTabEntryId) {
    return activeTabEntryId;
  }

  if (!state.activeEntryId) {
    return null;
  }

  const entry = state.entries.find((candidate) => candidate.id === state.activeEntryId);
  if (!entry) {
    const tabId = state.activeEntryId.startsWith("tab:")
      ? state.activeEntryId.slice("tab:".length)
      : undefined;
    return getEntryIdForTab(state, tabId);
  }

  if (entry.kind === "folder") {
    const firstTabId = state.folders[entry.folderId]?.tabIds[0];
    return firstTabId ? createSidebarTabEntry(firstTabId).id : null;
  }

  if (entry.kind === "split") {
    const split = state.splits[entry.splitId];
    if (!split) {
      return null;
    }
    return entry.id;
  }

  return entry.id;
}

export function createDefaultOrganizerSidebarState(
  tabs: OrganizerTabLike[],
  activeTabId?: string,
): OrganizerSidebarState {
  const resolvedActiveTabId = activeTabId ?? tabs.find((tab) => tab.isActive)?.id ?? tabs[0]?.id ?? null;
  return {
    activeEntryId: resolvedActiveTabId ? createSidebarTabEntry(resolvedActiveTabId).id : null,
    entries: tabs.map((tab) => createSidebarTabEntry(tab.id)),
    folders: {},
    splits: {},
  };
}

export function normalizeOrganizerSidebarState(
  rawState: unknown,
  tabs: OrganizerTabLike[],
  activeTabId?: string,
): OrganizerSidebarState {
  const liveTabIds = new Set(tabs.map((tab) => tab.id));
  if (liveTabIds.size === 0) {
    return createDefaultOrganizerSidebarState([], activeTabId);
  }

  const fallback = createDefaultOrganizerSidebarState(tabs, activeTabId);
  if (!isRecord(rawState)) {
    return fallback;
  }

  const nextFolders: Record<string, OrganizerSidebarFolderState> = {};
  const usedFolderTabIds = new Set<string>();
  const rawFolders = isRecord(rawState.folders) ? rawState.folders : {};
  for (const [folderId, value] of Object.entries(rawFolders)) {
    if (!folderId || !isRecord(value)) {
      continue;
    }

    const sanitizedTabIds = dedupeTabIds(
      Array.isArray(value.tabIds)
        ? value.tabIds.flatMap((entry) => readString(entry) ?? [])
        : [],
      liveTabIds,
    ).filter((tabId) => !usedFolderTabIds.has(tabId));

    sanitizedTabIds.forEach((tabId) => usedFolderTabIds.add(tabId));
    const backgroundColor = readFolderBackgroundColor(value.backgroundColor);
    nextFolders[folderId] = {
      id: folderId,
      title: readString(value.title) ?? createDefaultFolderTitle(),
      ...(readString(value.icon) ? { icon: readString(value.icon) } : {}),
      ...(backgroundColor ? { backgroundColor } : {}),
      tabIds: sanitizedTabIds,
      isExpanded: readBoolean(value.isExpanded) ?? true,
    };
  }

  const usedSplitTabIds = new Set<string>();
  const nextSplits: Record<string, OrganizerSidebarSplitState> = {};
  const rawSplits = isRecord(rawState.splits) ? rawState.splits : {};
  for (const [splitId, value] of Object.entries(rawSplits)) {
    if (!splitId || !isRecord(value)) {
      continue;
    }

    const sanitizedTabIds = dedupeTabIds(
      Array.isArray(value.tabIds)
        ? value.tabIds.flatMap((entry) => readString(entry) ?? [])
        : [],
      liveTabIds,
    ).filter((tabId) => !usedSplitTabIds.has(tabId) && !usedFolderTabIds.has(tabId));

    if (sanitizedTabIds.length < 2) {
      continue;
    }

    sanitizedTabIds.forEach((tabId) => usedSplitTabIds.add(tabId));
    const mode = value.mode === "vertical" || value.mode === "bento" ? value.mode : "horizontal";
    const focusedTabId = readString(value.focusedTabId);
    nextSplits[splitId] = {
      id: splitId,
      mode,
      tabIds: sanitizedTabIds,
      focusedTabId: focusedTabId && sanitizedTabIds.includes(focusedTabId)
        ? focusedTabId
        : sanitizedTabIds[0]!,
      syncScroll: readBoolean(value.syncScroll) ?? false,
    };
  }

  const claimedRootTabIds = new Set<string>();
  const nextEntries: OrganizerSidebarEntry[] = [];
  const rawEntries = Array.isArray(rawState.entries) ? rawState.entries : [];
  for (const entry of rawEntries) {
    if (!isRecord(entry)) {
      continue;
    }

    if (entry.kind === "folder") {
      const folderId = readString(entry.folderId);
      if (!folderId || !nextFolders[folderId]) {
        continue;
      }
      if (nextEntries.some((candidate) => candidate.kind === "folder" && candidate.folderId === folderId)) {
        continue;
      }
      nextEntries.push(createSidebarFolderEntry(folderId));
      continue;
    }

    if (entry.kind === "split") {
      const splitId = readString(entry.splitId);
      if (!splitId || !nextSplits[splitId]) {
        continue;
      }
      if (nextEntries.some((candidate) => candidate.kind === "split" && candidate.splitId === splitId)) {
        continue;
      }
      nextEntries.push(createSidebarSplitEntry(splitId));
      nextSplits[splitId]!.tabIds.forEach((tabId) => claimedRootTabIds.add(tabId));
      continue;
    }

    if (entry.kind === "tab") {
      const tabId = readString(entry.tabId);
      if (!tabId || !liveTabIds.has(tabId) || usedFolderTabIds.has(tabId) || usedSplitTabIds.has(tabId) || claimedRootTabIds.has(tabId)) {
        continue;
      }
      nextEntries.push(createSidebarTabEntry(tabId));
      claimedRootTabIds.add(tabId);
    }
  }

  for (const tab of tabs) {
    if (usedFolderTabIds.has(tab.id) || usedSplitTabIds.has(tab.id) || claimedRootTabIds.has(tab.id)) {
      continue;
    }
    nextEntries.push(createSidebarTabEntry(tab.id));
    claimedRootTabIds.add(tab.id);
  }

  const normalizedState: OrganizerSidebarState = {
    activeEntryId: readString(rawState.activeEntryId) ?? fallback.activeEntryId,
    entries: nextEntries.length > 0 ? nextEntries : fallback.entries,
    folders: nextFolders,
    splits: nextSplits,
  };

  return {
    ...normalizedState,
    activeEntryId: getActiveEntryId(normalizedState, activeTabId),
  };
}

export function cloneOrganizerSidebarState(state: OrganizerSidebarState): OrganizerSidebarState {
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

export function collectOrganizerSplitTabIds(state: OrganizerSidebarState) {
  const tabIds = new Set<string>();
  for (const split of Object.values(state.splits)) {
    for (const tabId of split.tabIds) {
      tabIds.add(tabId);
    }
  }
  return tabIds;
}

export function findOrganizerFolderForTabId(state: OrganizerSidebarState, tabId: string) {
  return Object.values(state.folders).find((folder) => folder.tabIds.includes(tabId)) ?? null;
}

function detachTabFromEntries(entries: OrganizerSidebarEntry[], tabId: string) {
  return entries.filter((entry) => entry.kind !== "tab" || entry.tabId !== tabId);
}

function cleanupEmptyFolders(state: OrganizerSidebarState) {
  const nextState = cloneOrganizerSidebarState(state);
  for (const [folderId, folder] of Object.entries(nextState.folders)) {
    if (folder.tabIds.length > 0) {
      continue;
    }
    delete nextState.folders[folderId];
    nextState.entries = nextState.entries.filter((entry) => entry.kind !== "folder" || entry.folderId !== folderId);
  }
  nextState.activeEntryId = getActiveEntryId(nextState);
  return nextState;
}

function removeTabsFromFolders(state: OrganizerSidebarState, tabIds: Set<string>) {
  const nextState = cloneOrganizerSidebarState(state);
  for (const folder of Object.values(nextState.folders)) {
    folder.tabIds = folder.tabIds.filter((tabId) => !tabIds.has(tabId));
  }
  return cleanupEmptyFolders(nextState);
}

function compareString(left: string, right: string, direction: OrganizerSortDirection) {
  const comparison = left.localeCompare(right, undefined, { sensitivity: "base" });
  return direction === "desc" ? -comparison : comparison;
}

function normalizeUrlDomain(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, "").trim().toLowerCase();
  } catch {
    return "";
  }
}

function getTabSortValue(tab: OrganizerTabLike, strategy: OrganizerSortStrategy) {
  switch (strategy) {
    case "domain":
      return normalizeUrlDomain(tab.url);
    case "url":
      return tab.url.trim().toLowerCase();
    case "title":
    default:
      return tab.title.trim().toLowerCase();
  }
}

export function sortOrganizerRootTabs(
  state: OrganizerSidebarState,
  tabs: OrganizerTabLike[],
  strategy: OrganizerSortStrategy,
  direction: OrganizerSortDirection = "asc",
) {
  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));
  const rootTabIds = state.entries
    .filter((entry): entry is Extract<OrganizerSidebarEntry, { kind: "tab" }> => entry.kind === "tab")
    .map((entry) => entry.tabId)
    .filter((tabId) => tabsById.has(tabId));

  const sortedTabIds = [...rootTabIds].sort((leftId, rightId) => {
    const left = tabsById.get(leftId)!;
    const right = tabsById.get(rightId)!;
    const leftValue = getTabSortValue(left, strategy);
    const rightValue = getTabSortValue(right, strategy);
    if (leftValue !== rightValue) {
      return compareString(leftValue, rightValue, direction);
    }
    return compareString(left.title.trim().toLowerCase(), right.title.trim().toLowerCase(), direction);
  });

  let nextIndex = 0;
  const nextState = cloneOrganizerSidebarState(state);
  nextState.entries = nextState.entries.map((entry) => {
    if (entry.kind !== "tab") {
      return entry;
    }
    const tabId = sortedTabIds[nextIndex];
    nextIndex += 1;
    return tabId ? createSidebarTabEntry(tabId) : entry;
  });
  nextState.activeEntryId = getActiveEntryId(nextState);
  return nextState;
}

function removeTabFromRootsAndFolders(state: OrganizerSidebarState, tabId: string) {
  const nextState = cloneOrganizerSidebarState(state);
  nextState.entries = detachTabFromEntries(nextState.entries, tabId);
  for (const folder of Object.values(nextState.folders)) {
    folder.tabIds = folder.tabIds.filter((currentTabId) => currentTabId !== tabId);
  }
  return cleanupEmptyFolders(nextState);
}

export function createOrganizerFolderGroup(
  state: OrganizerSidebarState,
  input: {
    folderId: string;
    name: string;
    tabIds: string[];
    icon?: string;
    backgroundColor?: string;
  },
) {
  const requestedTabIds = Array.from(new Set(input.tabIds.filter((tabId) => tabId.trim().length > 0)));
  if (requestedTabIds.length < 2) {
    return state;
  }

  let nextState = cloneOrganizerSidebarState(state);
  let insertionIndex = nextState.entries.length;

  for (const tabId of requestedTabIds) {
    const rootEntryIndex = nextState.entries.findIndex((entry) => entry.kind === "tab" && entry.tabId === tabId);
    if (rootEntryIndex >= 0) {
      insertionIndex = Math.min(insertionIndex, rootEntryIndex);
    } else {
      const folderEntryIndex = nextState.entries.findIndex((entry) => {
        if (entry.kind !== "folder") {
          return false;
        }
        return nextState.folders[entry.folderId]?.tabIds.includes(tabId) ?? false;
      });
      if (folderEntryIndex >= 0) {
        insertionIndex = Math.min(insertionIndex, folderEntryIndex);
      }
    }
    nextState = removeTabFromRootsAndFolders(nextState, tabId);
  }

  const entry = createSidebarFolderEntry(input.folderId);
  const backgroundColor = readFolderBackgroundColor(input.backgroundColor);
  nextState.entries.splice(Math.min(insertionIndex, nextState.entries.length), 0, entry);
  nextState.folders[input.folderId] = {
    id: input.folderId,
    title: input.name.trim() || createDefaultFolderTitle(),
    ...(input.icon?.trim() ? { icon: input.icon.trim() } : {}),
    ...(backgroundColor ? { backgroundColor } : {}),
    tabIds: requestedTabIds,
    isExpanded: true,
  };
  nextState.activeEntryId = getActiveEntryId(nextState, requestedTabIds[0]);
  return nextState;
}

export function moveOrganizerTabsToFolder(
  state: OrganizerSidebarState,
  folderId: string,
  tabIds: string[],
) {
  const targetFolder = state.folders[folderId];
  if (!targetFolder) {
    return state;
  }

  const requestedTabIds = Array.from(new Set(tabIds.filter((tabId) => tabId.trim().length > 0)));
  if (requestedTabIds.length === 0) {
    return state;
  }

  let nextState = cloneOrganizerSidebarState(state);
  for (const tabId of requestedTabIds) {
    nextState = removeTabFromRootsAndFolders(nextState, tabId);
  }

  const nextFolder = nextState.folders[folderId];
  if (!nextFolder) {
    return state;
  }
  nextFolder.tabIds = Array.from(new Set([...nextFolder.tabIds, ...requestedTabIds]));
  nextState.activeEntryId = getActiveEntryId(nextState, requestedTabIds[0]);
  return nextState;
}

export function ungroupOrganizerFolders(
  state: OrganizerSidebarState,
  folderIds?: string[],
) {
  const requestedFolderIds = folderIds && folderIds.length > 0
    ? new Set(folderIds.filter((folderId) => folderId.trim().length > 0))
    : new Set(Object.keys(state.folders));

  if (requestedFolderIds.size === 0) {
    return state;
  }

  const nextState = cloneOrganizerSidebarState(state);
  const nextEntries: OrganizerSidebarEntry[] = [];

  for (const entry of nextState.entries) {
    if (entry.kind !== "folder" || !requestedFolderIds.has(entry.folderId)) {
      nextEntries.push(entry);
      continue;
    }

    const folder = nextState.folders[entry.folderId];
    if (!folder) {
      continue;
    }

    for (const tabId of folder.tabIds) {
      nextEntries.push(createSidebarTabEntry(tabId));
    }
    delete nextState.folders[entry.folderId];
  }

  nextState.entries = nextEntries;
  nextState.activeEntryId = getActiveEntryId(nextState);
  return nextState;
}

export function renameOrganizerFolder(
  state: OrganizerSidebarState,
  folderId: string,
  input: { name?: string; icon?: string | null; backgroundColor?: string | null },
) {
  const folder = state.folders[folderId];
  if (!folder) {
    return state;
  }

  const nextState = cloneOrganizerSidebarState(state);
  const nextFolder = nextState.folders[folderId];
  if (!nextFolder) {
    return state;
  }

  if (input.name !== undefined) {
    nextFolder.title = input.name.trim() || nextFolder.title;
  }
  if (input.icon !== undefined) {
    const trimmedIcon = input.icon?.trim();
    if (trimmedIcon) {
      nextFolder.icon = trimmedIcon;
    } else {
      delete nextFolder.icon;
    }
  }
  if (input.backgroundColor !== undefined) {
    const nextBackgroundColor = readFolderBackgroundColor(input.backgroundColor);
    if (nextBackgroundColor) {
      nextFolder.backgroundColor = nextBackgroundColor;
    } else {
      delete nextFolder.backgroundColor;
    }
  }
  return nextState;
}

export function groupOrganizerRootTabsByDomain(
  state: OrganizerSidebarState,
  tabs: OrganizerTabLike[],
  input: { createFolderId: () => string; minGroupSize?: number },
) {
  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));
  const rootTabIds = state.entries
    .filter((entry): entry is Extract<OrganizerSidebarEntry, { kind: "tab" }> => entry.kind === "tab")
    .map((entry) => entry.tabId)
    .filter((tabId) => tabsById.has(tabId));

  const groups = new Map<string, string[]>();
  for (const tabId of rootTabIds) {
    const tab = tabsById.get(tabId);
    if (!tab) {
      continue;
    }
    const domain = normalizeUrlDomain(tab.url);
    if (!domain) {
      continue;
    }
    const current = groups.get(domain) ?? [];
    current.push(tabId);
    groups.set(domain, current);
  }

  const minGroupSize = Math.max(2, input.minGroupSize ?? 2);
  let nextState = cloneOrganizerSidebarState(state);
  const groupedDomains = [...groups.entries()]
    .filter(([, tabIds]) => tabIds.length >= minGroupSize)
    .sort((left, right) => left[0].localeCompare(right[0]));

  for (const [domain, tabIds] of groupedDomains) {
    nextState = createOrganizerFolderGroup(nextState, {
      folderId: input.createFolderId(),
      name: domain,
      tabIds,
    });
  }

  return nextState;
}
