import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type {
  BookmarkFolderRecord,
  BookmarkRecord,
  HistoryMetadata,
  HistoryOpenSourceMetadata,
  HistoryImportSourceStat,
  HistoryRecord,
} from "../bridge/ipc.js";
import type { StartPageUrlOptions } from "../shared/utils.js";

interface BookmarkStoragePayload {
  version: number;
  bookmarks?: BookmarkRecord[];
  folders?: BookmarkFolderRecord[];
  profiles?: Record<string, {
    bookmarks?: BookmarkRecord[];
    folders?: BookmarkFolderRecord[];
  }>;
}

interface HistoryStoragePayload {
  version: number;
  records?: HistoryRecord[];
  profiles?: Record<string, {
    records?: HistoryRecord[];
  }>;
}

interface CreateLibraryStateManagerOptions {
  defaultProfileId: string;
  bookmarksPath: string;
  historyPath: string;
  inferTitleFromUrl: (url: string, options: StartPageUrlOptions) => string;
  startPageUrlOptions: StartPageUrlOptions;
  onBookmarksChanged?: () => void;
  onHistoryChanged?: () => void;
}

interface HistoryOpenSourceInput {
  url: string;
  title?: string;
  linkUrl?: string;
  openedAt?: number;
}

const MAX_HISTORY_OPENED_FROM_RECORDS = 20;

function sanitizeBookmarkFolderRecords(input: unknown) {
  if (!Array.isArray(input)) {
    return [] as BookmarkFolderRecord[];
  }

  const sanitized: BookmarkFolderRecord[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const maybeFolder = entry as Partial<BookmarkFolderRecord>;
    if (typeof maybeFolder.id !== "string" || typeof maybeFolder.name !== "string") {
      continue;
    }

    sanitized.push({
      id: maybeFolder.id,
      name: maybeFolder.name.trim() || "Untitled",
      parentId: typeof maybeFolder.parentId === "string"
        ? maybeFolder.parentId
        : null,
      importSourceId: typeof maybeFolder.importSourceId === "string"
        ? maybeFolder.importSourceId
        : undefined,
      createdAt: Number.isFinite(maybeFolder.createdAt)
        ? Number(maybeFolder.createdAt)
        : Date.now(),
    });
  }

  return sanitized;
}

function normalizeFolderHierarchy(folders: BookmarkFolderRecord[]) {
  const normalized = [...folders];
  let idSet = new Set(normalized.map((folder) => folder.id));
  let changed = true;

  while (changed) {
    changed = false;
    for (let index = normalized.length - 1; index >= 0; index -= 1) {
      const folder = normalized[index];
      if (folder.parentId && !idSet.has(folder.parentId)) {
        idSet.delete(folder.id);
        normalized.splice(index, 1);
        changed = true;
      }
    }
  }

  return normalized;
}

function sanitizeBookmarkRecords(input: unknown, folderIds: Set<string>) {
  if (!Array.isArray(input)) {
    return [] as BookmarkRecord[];
  }

  const sanitized: BookmarkRecord[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const maybeBookmark = entry as Partial<BookmarkRecord>;
    if (
      typeof maybeBookmark.id !== "string"
      || typeof maybeBookmark.url !== "string"
      || typeof maybeBookmark.title !== "string"
    ) {
      continue;
    }

    const normalizedFolderId = typeof maybeBookmark.folderId === "string"
      && folderIds.has(maybeBookmark.folderId)
      ? maybeBookmark.folderId
      : null;

    sanitized.push({
      id: maybeBookmark.id,
      title: maybeBookmark.title,
      url: maybeBookmark.url,
      favicon: typeof maybeBookmark.favicon === "string" ? maybeBookmark.favicon : undefined,
      folderId: normalizedFolderId,
      createdAt: Number.isFinite(maybeBookmark.createdAt)
        ? Number(maybeBookmark.createdAt)
        : Date.now(),
    });
  }

  return sanitized;
}

function sanitizeHistoryImportSourceStats(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const sanitizedStats: HistoryImportSourceStat[] = [];
  const statsBySourceId = new Map<string, { visitCount: number; lastVisitedAt: number }>();

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const maybeStat = entry as Partial<HistoryImportSourceStat>;
    if (typeof maybeStat.sourceId !== "string") {
      continue;
    }

    const visitCount = Number.isFinite(maybeStat.visitCount)
      ? Math.max(1, Number(maybeStat.visitCount))
      : 1;
    const lastVisitedAt = Number.isFinite(maybeStat.lastVisitedAt)
      ? Number(maybeStat.lastVisitedAt)
      : 0;
    const existing = statsBySourceId.get(maybeStat.sourceId);

    statsBySourceId.set(maybeStat.sourceId, {
      visitCount: Math.max(existing?.visitCount ?? 0, visitCount),
      lastVisitedAt: Math.max(existing?.lastVisitedAt ?? 0, lastVisitedAt),
    });
  }

  for (const [sourceId, stat] of [...statsBySourceId.entries()].sort((left, right) =>
    left[0].localeCompare(right[0]))) {
    sanitizedStats.push({
      sourceId,
      visitCount: stat.visitCount,
      lastVisitedAt: stat.lastVisitedAt,
    });
  }

  return sanitizedStats.length > 0 ? sanitizedStats : undefined;
}

function sanitizeHistoryOpenedFrom(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const recordsByUrl = new Map<string, HistoryOpenSourceMetadata>();

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const maybeRecord = entry as Partial<HistoryOpenSourceMetadata>;
    if (typeof maybeRecord.url !== "string" || !maybeRecord.url.trim()) {
      continue;
    }

    const url = maybeRecord.url.trim();
    const lastOpenedAt = Number.isFinite(maybeRecord.lastOpenedAt)
      ? Number(maybeRecord.lastOpenedAt)
      : Date.now();
    const firstOpenedAt = Number.isFinite(maybeRecord.firstOpenedAt)
      ? Number(maybeRecord.firstOpenedAt)
      : lastOpenedAt;
    const openCount = Number.isFinite(maybeRecord.openCount)
      ? Math.max(1, Number(maybeRecord.openCount))
      : 1;
    const existing = recordsByUrl.get(url);

    recordsByUrl.set(url, {
      url,
      title: typeof maybeRecord.title === "string" && maybeRecord.title.trim()
        ? maybeRecord.title.trim()
        : existing?.title,
      firstOpenedAt: Math.min(existing?.firstOpenedAt ?? firstOpenedAt, firstOpenedAt),
      lastOpenedAt: Math.max(existing?.lastOpenedAt ?? 0, lastOpenedAt),
      openCount: (existing?.openCount ?? 0) + openCount,
      lastTargetUrl: typeof maybeRecord.lastTargetUrl === "string" && maybeRecord.lastTargetUrl.trim()
        ? maybeRecord.lastTargetUrl.trim()
        : existing?.lastTargetUrl,
    });
  }

  const sanitized = [...recordsByUrl.values()]
    .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
    .slice(0, MAX_HISTORY_OPENED_FROM_RECORDS);

  return sanitized.length > 0 ? sanitized : undefined;
}

function sanitizeHistoryMetadata(value: unknown): HistoryMetadata | undefined {
  if (!isObjectRecord(value)) {
    return undefined;
  }

  const openedFrom = sanitizeHistoryOpenedFrom(value.openedFrom);
  return openedFrom ? { openedFrom } : undefined;
}

function normalizeHistoryOpenSource(
  targetUrl: string,
  source: HistoryOpenSourceInput | undefined,
  now: number,
): HistoryOpenSourceMetadata | undefined {
  if (!source || typeof source.url !== "string") {
    return undefined;
  }

  const sourceUrl = source.url.trim();
  if (!sourceUrl || sourceUrl === targetUrl) {
    return undefined;
  }

  const openedAt = Number.isFinite(source.openedAt) ? Number(source.openedAt) : now;
  return {
    url: sourceUrl,
    title: typeof source.title === "string" && source.title.trim()
      ? source.title.trim()
      : undefined,
    firstOpenedAt: openedAt,
    lastOpenedAt: openedAt,
    openCount: 1,
    lastTargetUrl: typeof source.linkUrl === "string" && source.linkUrl.trim()
      ? source.linkUrl.trim()
      : targetUrl,
  };
}

function mergeHistoryMetadata(
  currentMetadata: HistoryMetadata | undefined,
  targetUrl: string,
  source: HistoryOpenSourceInput | undefined,
  now: number,
) {
  const normalizedSource = normalizeHistoryOpenSource(targetUrl, source, now);
  if (!normalizedSource) {
    return currentMetadata;
  }

  const openedFrom = sanitizeHistoryOpenedFrom(currentMetadata?.openedFrom) ?? [];
  const sourceIndex = openedFrom.findIndex((entry) => entry.url === normalizedSource.url);
  if (sourceIndex >= 0) {
    const existing = openedFrom[sourceIndex];
    openedFrom[sourceIndex] = {
      ...existing,
      title: normalizedSource.title ?? existing.title,
      firstOpenedAt: Math.min(existing.firstOpenedAt, normalizedSource.firstOpenedAt),
      lastOpenedAt: Math.max(existing.lastOpenedAt, normalizedSource.lastOpenedAt),
      openCount: Math.max(1, Number(existing.openCount || 0)) + 1,
      lastTargetUrl: normalizedSource.lastTargetUrl ?? existing.lastTargetUrl,
    };
  } else {
    openedFrom.push(normalizedSource);
  }

  return {
    ...(currentMetadata ?? {}),
    openedFrom: openedFrom
      .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
      .slice(0, MAX_HISTORY_OPENED_FROM_RECORDS),
  };
}

function sanitizeHistoryRecords(
  input: unknown,
  inferTitleFromUrl: (url: string, options: StartPageUrlOptions) => string,
  startPageUrlOptions: StartPageUrlOptions,
) {
  if (!Array.isArray(input)) {
    return [] as HistoryRecord[];
  }

  const sanitized: HistoryRecord[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const maybeRecord = entry as Partial<HistoryRecord>;
    if (
      typeof maybeRecord.id !== "string"
      || typeof maybeRecord.url !== "string"
      || typeof maybeRecord.title !== "string"
    ) {
      continue;
    }

    const createdAt = Number.isFinite(maybeRecord.createdAt)
      ? Number(maybeRecord.createdAt)
      : Date.now();
    const updatedAt = Number.isFinite(maybeRecord.updatedAt)
      ? Number(maybeRecord.updatedAt)
      : createdAt;
    const lastVisitedAt = Number.isFinite(maybeRecord.lastVisitedAt)
      ? Number(maybeRecord.lastVisitedAt)
      : updatedAt;
    const visitCount = Number.isFinite(maybeRecord.visitCount)
      ? Math.max(1, Number(maybeRecord.visitCount))
      : 1;

    sanitized.push({
      id: maybeRecord.id,
      title: maybeRecord.title.trim() || inferTitleFromUrl(maybeRecord.url, startPageUrlOptions),
      url: maybeRecord.url,
      favicon: typeof maybeRecord.favicon === "string" ? maybeRecord.favicon : undefined,
      createdAt,
      updatedAt,
      lastVisitedAt,
      visitCount,
      importSourceStats: sanitizeHistoryImportSourceStats(maybeRecord.importSourceStats),
      metadata: sanitizeHistoryMetadata(maybeRecord.metadata),
    });
  }

  return sanitized;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeProfileId(profileId: string | undefined, defaultProfileId: string) {
  return typeof profileId === "string" && profileId.trim()
    ? profileId.trim()
    : defaultProfileId;
}

export function createLibraryStateManager(options: CreateLibraryStateManagerOptions) {
  const {
    defaultProfileId,
    bookmarksPath,
    historyPath,
    inferTitleFromUrl,
    startPageUrlOptions,
    onBookmarksChanged,
    onHistoryChanged,
  } = options;

  const bookmarksByProfileId = new Map<string, BookmarkRecord[]>();
  const bookmarkFoldersByProfileId = new Map<string, BookmarkFolderRecord[]>();
  const historyRecordsByProfileId = new Map<string, HistoryRecord[]>();

  function getBookmarks(profileId?: string) {
    return bookmarksByProfileId.get(normalizeProfileId(profileId, defaultProfileId)) ?? [];
  }

  function setBookmarks(profileId: string, nextBookmarks: BookmarkRecord[]) {
    const normalizedProfileId = normalizeProfileId(profileId, defaultProfileId);
    if (nextBookmarks.length === 0 && getBookmarkFolders(normalizedProfileId).length === 0) {
      bookmarksByProfileId.delete(normalizedProfileId);
      bookmarkFoldersByProfileId.delete(normalizedProfileId);
      return;
    }

    bookmarksByProfileId.set(normalizedProfileId, nextBookmarks);
  }

  function getBookmarkFolders(profileId?: string) {
    return bookmarkFoldersByProfileId.get(normalizeProfileId(profileId, defaultProfileId)) ?? [];
  }

  function setBookmarkFolders(profileId: string, nextFolders: BookmarkFolderRecord[]) {
    const normalizedProfileId = normalizeProfileId(profileId, defaultProfileId);
    if (nextFolders.length === 0 && getBookmarks(normalizedProfileId).length === 0) {
      bookmarkFoldersByProfileId.delete(normalizedProfileId);
      bookmarksByProfileId.delete(normalizedProfileId);
      return;
    }

    bookmarkFoldersByProfileId.set(normalizedProfileId, nextFolders);
  }

  function loadBookmarks() {
    bookmarksByProfileId.clear();
    bookmarkFoldersByProfileId.clear();

    try {
      const raw = readFileSync(bookmarksPath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;

      if (Array.isArray(parsed)) {
        const bookmarks = sanitizeBookmarkRecords(parsed, new Set<string>());
        if (bookmarks.length > 0) {
          setBookmarks(defaultProfileId, bookmarks);
        }
        return;
      }

      const payload = parsed as Partial<BookmarkStoragePayload>;
      if (isObjectRecord(payload.profiles)) {
        for (const [profileId, value] of Object.entries(payload.profiles)) {
          const normalizedProfileId = normalizeProfileId(profileId, defaultProfileId);
          const profilePayload = isObjectRecord(value) ? value : {};
          const folders = normalizeFolderHierarchy(
            sanitizeBookmarkFolderRecords(profilePayload.folders),
          );
          const folderIds = new Set(folders.map((folder) => folder.id));
          const bookmarks = sanitizeBookmarkRecords(profilePayload.bookmarks, folderIds);
          if (bookmarks.length === 0 && folders.length === 0) {
            continue;
          }
          setBookmarkFolders(normalizedProfileId, folders);
          setBookmarks(normalizedProfileId, bookmarks);
        }
        return;
      }

      const folders = normalizeFolderHierarchy(sanitizeBookmarkFolderRecords(payload.folders));
      const folderIds = new Set(folders.map((folder) => folder.id));
      const bookmarks = sanitizeBookmarkRecords(payload.bookmarks, folderIds);
      if (bookmarks.length > 0 || folders.length > 0) {
        setBookmarkFolders(defaultProfileId, folders);
        setBookmarks(defaultProfileId, bookmarks);
      }
    } catch {
      bookmarksByProfileId.clear();
      bookmarkFoldersByProfileId.clear();
    }
  }

  function saveBookmarks() {
    try {
      const payload: BookmarkStoragePayload = {
        version: 3,
        profiles: {},
      };
      const profileIds = Array.from(
        new Set([
          ...bookmarksByProfileId.keys(),
          ...bookmarkFoldersByProfileId.keys(),
        ]),
      ).sort((left, right) => left.localeCompare(right));

      for (const profileId of profileIds) {
        const bookmarks = getBookmarks(profileId);
        const folders = getBookmarkFolders(profileId);
        if (bookmarks.length === 0 && folders.length === 0) {
          continue;
        }
        payload.profiles![profileId] = {
          bookmarks,
          folders,
        };
      }

      writeFileSync(bookmarksPath, JSON.stringify(payload, null, 2), "utf-8");
    } catch {
      // Ignore bookmark persistence failures.
    }
  }

  function notifyBookmarksChanged() {
    onBookmarksChanged?.();
  }

  function getHistoryRecords(profileId?: string) {
    return historyRecordsByProfileId.get(normalizeProfileId(profileId, defaultProfileId)) ?? [];
  }

  function setHistoryRecords(profileId: string, nextRecords: HistoryRecord[]) {
    const normalizedProfileId = normalizeProfileId(profileId, defaultProfileId);
    if (nextRecords.length === 0) {
      historyRecordsByProfileId.delete(normalizedProfileId);
      return;
    }
    historyRecordsByProfileId.set(normalizedProfileId, nextRecords);
  }

  function loadHistory() {
    historyRecordsByProfileId.clear();

    try {
      const raw = readFileSync(historyPath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;

      if (Array.isArray(parsed)) {
        const records = sanitizeHistoryRecords(parsed, inferTitleFromUrl, startPageUrlOptions);
        if (records.length > 0) {
          setHistoryRecords(defaultProfileId, records);
        }
        return;
      }

      const payload = parsed as Partial<HistoryStoragePayload>;
      if (isObjectRecord(payload.profiles)) {
        for (const [profileId, value] of Object.entries(payload.profiles)) {
          const normalizedProfileId = normalizeProfileId(profileId, defaultProfileId);
          const profilePayload = isObjectRecord(value) ? value : {};
          const records = sanitizeHistoryRecords(
            profilePayload.records,
            inferTitleFromUrl,
            startPageUrlOptions,
          );
          if (records.length === 0) {
            continue;
          }
          setHistoryRecords(normalizedProfileId, records);
        }
        return;
      }

      const records = sanitizeHistoryRecords(
        payload.records,
        inferTitleFromUrl,
        startPageUrlOptions,
      );
      if (records.length > 0) {
        setHistoryRecords(defaultProfileId, records);
      }
    } catch {
      historyRecordsByProfileId.clear();
    }
  }

  function saveHistoryRecords() {
    try {
      const payload: HistoryStoragePayload = {
        version: 2,
        profiles: {},
      };
      const profileIds = Array.from(historyRecordsByProfileId.keys())
        .sort((left, right) => left.localeCompare(right));

      for (const profileId of profileIds) {
        const records = getHistoryRecords(profileId);
        if (records.length === 0) {
          continue;
        }
        payload.profiles![profileId] = { records };
      }

      writeFileSync(historyPath, JSON.stringify(payload, null, 2), "utf-8");
    } catch {
      // Ignore history persistence failures.
    }
  }

  function notifyHistoryChanged() {
    onHistoryChanged?.();
  }

  function isTrackableHistoryUrl(url: string) {
    if (!url) {
      return false;
    }

    try {
      const parsed = new URL(url);
      if (parsed.protocol === "milo:" || parsed.protocol === "data:" || parsed.protocol === "devtools:") {
        return false;
      }
      if (parsed.protocol === "about:" && parsed.pathname === "blank") {
        return false;
      }
      return true;
    } catch {
      return !/^about:blank$/i.test(url);
    }
  }

  function persistHistorySnapshot(profileId: string, nextRecords: HistoryRecord[]) {
    setHistoryRecords(profileId, nextRecords);
    saveHistoryRecords();
    notifyHistoryChanged();
  }

  function recordHistoryVisit(
    profileId: string,
    url: string,
    options?: { title?: string; favicon?: string; openedFrom?: HistoryOpenSourceInput },
  ) {
    if (!isTrackableHistoryUrl(url)) {
      return;
    }

    const now = Date.now();
    const normalizedTitle =
      typeof options?.title === "string" && options.title.trim()
        ? options.title.trim()
        : inferTitleFromUrl(url, startPageUrlOptions);
    const favicon = options?.favicon;
    let matched = false;
    const currentRecords = getHistoryRecords(profileId);

    const nextRecords = currentRecords.map((record) => {
      if (record.url !== url) {
        return record;
      }

      matched = true;
      return {
        ...record,
        title: normalizedTitle || record.title,
        favicon: favicon ?? record.favicon,
        updatedAt: now,
        lastVisitedAt: now,
        visitCount: Math.max(1, Number(record.visitCount || 0)) + 1,
        metadata: mergeHistoryMetadata(record.metadata, url, options?.openedFrom, now),
      };
    });

    if (matched) {
      persistHistorySnapshot(profileId, nextRecords);
      return;
    }

    persistHistorySnapshot(profileId, [
      ...currentRecords,
      {
        id: randomUUID(),
        title: normalizedTitle,
        url,
        favicon,
        createdAt: now,
        updatedAt: now,
        lastVisitedAt: now,
        visitCount: 1,
        metadata: mergeHistoryMetadata(undefined, url, options?.openedFrom, now),
      },
    ]);
  }

  function updateHistoryMetadata(
    profileId: string,
    url: string,
    options?: { title?: string; favicon?: string },
  ) {
    if (!isTrackableHistoryUrl(url)) {
      return;
    }

    const title = typeof options?.title === "string" && options.title.trim()
      ? options.title.trim()
      : undefined;
    const favicon = typeof options?.favicon === "string" && options.favicon
      ? options.favicon
      : undefined;
    let changed = false;
    const currentRecords = getHistoryRecords(profileId);

    const nextRecords = currentRecords.map((record) => {
      if (record.url !== url) {
        return record;
      }

      const nextTitle = title ?? record.title;
      const nextFavicon = favicon ?? record.favicon;
      if (nextTitle === record.title && nextFavicon === record.favicon) {
        return record;
      }

      changed = true;
      return {
        ...record,
        title: nextTitle,
        favicon: nextFavicon,
        updatedAt: Date.now(),
      };
    });

    if (changed) {
      persistHistorySnapshot(profileId, nextRecords);
    }
  }

  return {
    getBookmarks,
    setBookmarks,
    getBookmarkFolders,
    setBookmarkFolders,
    loadBookmarks,
    saveBookmarks,
    notifyBookmarksChanged,
    getHistoryRecords,
    setHistoryRecords,
    loadHistory,
    saveHistoryRecords,
    notifyHistoryChanged,
    isTrackableHistoryUrl,
    recordHistoryVisit,
    updateHistoryMetadata,
  };
}
