import {
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Folder,
  FolderOpen,
  FolderPlus,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useDeferredValue, useEffect, useRef, useState, type ReactNode } from "react";
import { normalizeLanguageSetting, resolveLocale, type SupportedLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const SETTINGS_STORAGE_KEY = "milo.settings.v1";
const ROOT_FOLDER_KEY = "__root__";

type StatusTone = "ok" | "err";

type TreeDraft =
  | {
      kind: "new-folder";
      parentId: string | null;
      name: string;
    }
  | {
      kind: "edit-folder";
      folderId: string;
      name: string;
      parentId: string | null;
    }
  | {
      kind: "new-bookmark";
      parentId: string | null;
      title: string;
      url: string;
    }
  | {
      kind: "edit-bookmark";
      bookmarkId: string;
      title: string;
      url: string;
      folderId: string | null;
    };

const I18N = {
  "en-US": {
    pageTitle: "Bookmarks",
    heroTitle: "Bookmarks",
    searchPlaceholder: "Search folders and bookmarks",
    addFolder: "New Folder",
    addBookmark: "New Bookmark",
    importBookmarks: "Import",
    clearAll: "Clear all",
    treeTitle: "Bookmark Tree",
    treeDescription: "Manage folders and links together in a single file tree.",
    rootFolder: "Root",
    empty: "No bookmarks yet",
    emptySearch: "No matching bookmarks",
    untitled: "(Untitled)",
    folderNamePlaceholder: "Folder name",
    bookmarkTitlePlaceholder: "Title (optional)",
    bookmarkUrlPlaceholder: "URL or keyword",
    moveTo: "Move to",
    save: "Save",
    cancel: "Cancel",
    edit: "Edit",
    remove: "Delete",
    open: "Open",
    shellMissing: "browserShell API is unavailable on this page. Please restart the app.",
    initFailed: "Initialization failed.",
    folderNameRequired: "Folder name cannot be empty.",
    folderCreateSuccess: "Folder created.",
    folderCreateFailed: "Failed to create folder.",
    folderUpdateSuccess: "Folder updated.",
    folderUpdateFailed: "Failed to update folder.",
    folderDeleteConfirm: "Deleting a folder will remove its subfolders and bookmarks. Continue?",
    folderDeleteSuccess: "Folder deleted.",
    folderDeleteFailed: "Failed to delete folder.",
    bookmarkUrlRequired: "Please enter a URL or keyword.",
    bookmarkCreateSuccess: "Bookmark added.",
    bookmarkCreateFailed: "Failed to add bookmark.",
    bookmarkUpdateSuccess: "Bookmark updated.",
    bookmarkUpdateFailed: "Failed to update bookmark.",
    bookmarkDeleteSuccess: "Bookmark deleted.",
    bookmarkDeleteFailed: "Failed to delete bookmark.",
    clearAllConfirm: "Clear all bookmarks and folders?",
    clearAllSuccess: "All bookmarks and folders cleared.",
    clearAllFailed: "Failed to clear all items.",
    importPanelTitle: "Import from other browsers",
    importPanelDescription: "Auto-detect Chromium-based browsers, or import an exported bookmarks file.",
    importDetectedSources: "Detected browser profiles",
    importNoSources: "No compatible browser profiles were found on this device.",
    importFromFile: "Import File",
    importRefreshSources: "Refresh",
    importLoadingSources: "Scanning local browser profiles...",
    importHint: "Chrome, Edge, Brave, Chromium, Vivaldi, and Arc can be detected automatically. Firefox and Safari can import via exported HTML files.",
    importAction: "Import",
    importReimportAction: "Import Again",
    importAlreadyImported: "Imported",
    importSuccess: "Imported {count} bookmark(s) from {source}, skipped {skipped} duplicates, created {folders} folder(s).",
    importNothing: "No new bookmarks were imported from {source}. Skipped {skipped} duplicate bookmark(s).",
    importFailed: "Failed to import bookmarks.",
    childFolderCount: "{count} folder(s)",
    childBookmarkCount: "{count} bookmark(s)",
  },
  "zh-CN": {
    pageTitle: "书签",
    heroTitle: "书签",
    searchPlaceholder: "搜索目录和书签",
    addFolder: "新建目录",
    addBookmark: "新建书签",
    importBookmarks: "导入",
    clearAll: "清空全部",
    treeTitle: "书签文件树",
    treeDescription: "用单一文件树管理目录和书签，不再拆成两个独立面板。",
    rootFolder: "根目录",
    empty: "暂无书签",
    emptySearch: "没有匹配结果",
    untitled: "(无标题)",
    folderNamePlaceholder: "目录名称",
    bookmarkTitlePlaceholder: "标题（可选）",
    bookmarkUrlPlaceholder: "URL 或关键词",
    moveTo: "移动到",
    save: "保存",
    cancel: "取消",
    edit: "编辑",
    remove: "删除",
    open: "打开",
    shellMissing: "当前页面缺少 browserShell API，请重启应用后重试。",
    initFailed: "初始化失败。",
    folderNameRequired: "目录名称不能为空。",
    folderCreateSuccess: "目录创建成功。",
    folderCreateFailed: "创建目录失败。",
    folderUpdateSuccess: "目录更新成功。",
    folderUpdateFailed: "更新目录失败。",
    folderDeleteConfirm: "删除目录会同时删除其子目录和书签，确定继续吗？",
    folderDeleteSuccess: "目录删除成功。",
    folderDeleteFailed: "删除目录失败。",
    bookmarkUrlRequired: "请输入 URL 或关键词。",
    bookmarkCreateSuccess: "书签添加成功。",
    bookmarkCreateFailed: "添加书签失败。",
    bookmarkUpdateSuccess: "书签更新成功。",
    bookmarkUpdateFailed: "更新书签失败。",
    bookmarkDeleteSuccess: "书签删除成功。",
    bookmarkDeleteFailed: "删除书签失败。",
    clearAllConfirm: "确定清空全部书签和目录吗？",
    clearAllSuccess: "已清空全部书签和目录。",
    clearAllFailed: "清空失败。",
    importPanelTitle: "从其他浏览器导入",
    importPanelDescription: "自动发现 Chromium 系浏览器配置，或导入导出的书签文件。",
    importDetectedSources: "已发现的浏览器配置",
    importNoSources: "当前设备上没有发现可直接导入的浏览器配置。",
    importFromFile: "从文件导入",
    importRefreshSources: "刷新",
    importLoadingSources: "正在扫描本地浏览器配置...",
    importHint: "支持自动发现 Chrome、Edge、Brave、Chromium、Vivaldi、Arc。Firefox 和 Safari 可先导出为 HTML 再导入。",
    importAction: "导入",
    importReimportAction: "重新导入",
    importAlreadyImported: "已导入",
    importSuccess: "已从 {source} 导入 {count} 个书签，跳过 {skipped} 个重复项，创建 {folders} 个目录。",
    importNothing: "{source} 没有可导入的新书签，已跳过 {skipped} 个重复项。",
    importFailed: "导入书签失败。",
    childFolderCount: "{count} 个目录",
    childBookmarkCount: "{count} 个书签",
  },
} as const;

type MessageKey = keyof (typeof I18N)["en-US"];

function readStoredSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function resolveTheme(themeSetting: unknown, systemPrefersLight: boolean) {
  const normalized = String(themeSetting ?? "system").trim().toLowerCase();
  if (normalized === "light" || normalized === "dark") {
    return normalized;
  }
  return systemPrefersLight ? "light" : "dark";
}

function folderKey(folderId?: string | null) {
  return folderId ?? ROOT_FOLDER_KEY;
}

function importSourceLabel(source: BookmarkImportSource) {
  return source.profileName === "Default"
    ? source.browserName
    : `${source.browserName} (${source.profileName})`;
}

function legacyImportFolderName(source: BookmarkImportSource) {
  return `Imported from ${importSourceLabel(source)}`;
}

export function BookmarksPage() {
  const initialSettings = readStoredSettings();
  const [language, setLanguage] = useState(() => normalizeLanguageSetting(initialSettings.language));
  const [themeSetting, setThemeSetting] = useState<string>(
    typeof initialSettings.theme === "string" ? initialSettings.theme : "system",
  );
  const [systemPrefersLight, setSystemPrefersLight] = useState(
    window.matchMedia("(prefers-color-scheme: light)").matches,
  );
  const [folders, setFolders] = useState<BookmarkFolderRecord[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkRecord[]>([]);
  const [query, setQuery] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<StatusTone | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const [toastTone, setToastTone] = useState<StatusTone | null>(null);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<TreeDraft | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [importSources, setImportSources] = useState<BookmarkImportSource[]>([]);
  const [isLoadingImportSources, setIsLoadingImportSources] = useState(false);

  const hasInitializedExpansion = useRef(false);
  const deferredQuery = useDeferredValue(query);
  const locale: SupportedLocale = resolveLocale(
    language,
    typeof navigator !== "undefined" ? navigator.language : "en-US",
  );
  const isLight = resolveTheme(themeSetting, systemPrefersLight) === "light";
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const browserShell = window.browserShell;

  const t = (key: MessageKey, vars?: Record<string, string | number>) => {
    const template = I18N[locale][key] ?? key;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (_match, name) => String(vars[name] ?? ""));
  };

  const folderById = new Map<string, BookmarkFolderRecord>();
  folders.forEach((folder) => {
    folderById.set(folder.id, folder);
  });

  const childFoldersByParent = new Map<string, BookmarkFolderRecord[]>();
  folders.forEach((folder) => {
    const key = folderKey(folder.parentId);
    const siblings = childFoldersByParent.get(key) ?? [];
    siblings.push(folder);
    childFoldersByParent.set(key, siblings);
  });
  childFoldersByParent.forEach((items) => {
    items.sort((left, right) => left.name.localeCompare(right.name, locale));
  });

  const importedSourceIds = new Set<string>();
  folders.forEach((folder) => {
    if (folder.importSourceId) {
      importedSourceIds.add(folder.importSourceId);
    }
  });

  const bookmarksByFolder = new Map<string, BookmarkRecord[]>();
  bookmarks.forEach((bookmark) => {
    const key = folderKey(bookmark.folderId);
    const items = bookmarksByFolder.get(key) ?? [];
    items.push(bookmark);
    bookmarksByFolder.set(key, items);
  });
  bookmarksByFolder.forEach((items) => {
    items.sort((left, right) => {
      const leftLabel = (left.title || left.url || "").trim();
      const rightLabel = (right.title || right.url || "").trim();
      return leftLabel.localeCompare(rightLabel, locale);
    });
  });

  function setStatus(message: string, tone: StatusTone | null) {
    setStatusMessage(message);
    setStatusTone(tone);
  }

  function showToast(message: string, tone: StatusTone) {
    setStatusMessage("");
    setStatusTone(null);
    setToastMessage(message);
    setToastTone(tone);
  }

  function applyBookmarkState(nextBookmarks: BookmarkRecord[], nextFolders: BookmarkFolderRecord[]) {
    setFolders(nextFolders);
    setBookmarks(nextBookmarks);
    setExpandedFolderIds((current) => {
      if (!hasInitializedExpansion.current) {
        hasInitializedExpansion.current = true;
        return new Set(nextFolders.map((folder) => folder.id));
      }

      const existing = new Set(nextFolders.map((folder) => folder.id));
      return new Set([...current].filter((id) => existing.has(id)));
    });
  }

  function folderPathLabel(folderId?: string | null) {
    if (!folderId) return t("rootFolder");
    const names: string[] = [];
    let cursor = folderById.get(folderId) ?? null;
    let guard = 0;
    while (cursor && guard < 64) {
      names.unshift(cursor.name);
      cursor = cursor.parentId ? folderById.get(cursor.parentId) ?? null : null;
      guard += 1;
    }
    return names.length > 0 ? names.join(" / ") : t("rootFolder");
  }

  function bookmarkMatches(bookmark: BookmarkRecord) {
    if (!normalizedQuery) return true;
    const title = String(bookmark.title || "").toLowerCase();
    const url = String(bookmark.url || "").toLowerCase();
    const path = folderPathLabel(bookmark.folderId).toLowerCase();
    return title.includes(normalizedQuery) || url.includes(normalizedQuery) || path.includes(normalizedQuery);
  }

  const folderVisibilityCache = new Map<string, boolean>();

  function folderMatches(folder: BookmarkFolderRecord) {
    if (!normalizedQuery) return true;
    return (
      folder.name.toLowerCase().includes(normalizedQuery)
      || folderPathLabel(folder.id).toLowerCase().includes(normalizedQuery)
    );
  }

  function folderVisible(folder: BookmarkFolderRecord): boolean {
    if (!normalizedQuery) return true;
    const cached = folderVisibilityCache.get(folder.id);
    if (cached != null) return cached;

    const selfMatch = folderMatches(folder);
    const childBookmarks = bookmarksByFolder.get(folderKey(folder.id)) ?? [];
    const childFolders = childFoldersByParent.get(folderKey(folder.id)) ?? [];
    const visible = selfMatch
      || childBookmarks.some((bookmark) => bookmarkMatches(bookmark))
      || childFolders.some((child) => folderVisible(child));

    folderVisibilityCache.set(folder.id, visible);
    return visible;
  }

  function collectDescendantIds(folderId: string) {
    const visited = new Set<string>();
    const queue = [folderId];
    while (queue.length > 0) {
      const nextId = queue.shift();
      if (!nextId || visited.has(nextId)) continue;
      visited.add(nextId);
      const children = childFoldersByParent.get(folderKey(nextId)) ?? [];
      children.forEach((child) => queue.push(child.id));
    }
    return visited;
  }

  function folderOptions(excludeFolderId?: string | null) {
    const blocked = excludeFolderId ? collectDescendantIds(excludeFolderId) : new Set<string>();
    const options: Array<{ id: string | null; label: string }> = [
      { id: null, label: t("rootFolder") },
    ];

    folders
      .filter((folder) => !blocked.has(folder.id))
      .sort((left, right) => folderPathLabel(left.id).localeCompare(folderPathLabel(right.id), locale))
      .forEach((folder) => {
        options.push({ id: folder.id, label: folderPathLabel(folder.id) });
      });

    return options;
  }

  function sourceImported(source: BookmarkImportSource) {
    return importedSourceIds.has(source.id)
      || folders.some((folder) => (
        (folder.parentId ?? null) === null
        && folder.name === legacyImportFolderName(source)
      ));
  }

  async function reloadState() {
    if (!browserShell) {
      throw new Error(t("shellMissing"));
    }

    const payload = await browserShell.bookmarksGetState();
    const nextFolders = Array.isArray(payload.folders) ? payload.folders : [];
    const nextBookmarks = Array.isArray(payload.bookmarks) ? payload.bookmarks : [];
    applyBookmarkState(nextBookmarks, nextFolders);
  }

  async function runMutation(
    operation: () => Promise<void>,
    errorMessage: string,
  ) {
    if (isBusy) return;
    setIsBusy(true);
    try {
      await operation();
    } catch (error) {
      showToast(error instanceof Error ? error.message : errorMessage, "err");
    } finally {
      setIsBusy(false);
    }
  }

  async function loadImportSources() {
    if (!browserShell) {
      throw new Error(t("shellMissing"));
    }

    setIsLoadingImportSources(true);
    try {
      const sources = await browserShell.bookmarksImportListSources();
      setImportSources(Array.isArray(sources) ? sources : []);
    } finally {
      setIsLoadingImportSources(false);
    }
  }

  function formatImportStatus(result: BookmarkImportResult) {
    if (result.importedBookmarks === 0 && result.importedFolders === 0) {
      return t("importNothing", {
        source: result.sourceLabel,
        skipped: result.skippedBookmarks,
      });
    }

    return t("importSuccess", {
      source: result.sourceLabel,
      count: result.importedBookmarks,
      skipped: result.skippedBookmarks,
      folders: result.importedFolders,
    });
  }

  function applyImportResult(result: BookmarkImportResult) {
    applyBookmarkState(result.bookmarks, result.folders);
    setShowImportPanel(false);
    setDraft(null);
    showToast(formatImportStatus(result), "ok");
  }

  function closeImportPanel() {
    if (isBusy) return;
    setShowImportPanel(false);
  }

  function beginNewFolder(parentId: string | null) {
    if (parentId) {
      setExpandedFolderIds((current) => new Set(current).add(parentId));
    }
    setQuery("");
    setDraft({
      kind: "new-folder",
      parentId,
      name: "",
    });
  }

  function beginEditFolder(folder: BookmarkFolderRecord) {
    setDraft({
      kind: "edit-folder",
      folderId: folder.id,
      name: folder.name,
      parentId: folder.parentId ?? null,
    });
  }

  function beginNewBookmark(parentId: string | null) {
    if (parentId) {
      setExpandedFolderIds((current) => new Set(current).add(parentId));
    }
    setQuery("");
    setDraft({
      kind: "new-bookmark",
      parentId,
      title: "",
      url: "",
    });
  }

  function beginEditBookmark(bookmark: BookmarkRecord) {
    setDraft({
      kind: "edit-bookmark",
      bookmarkId: bookmark.id,
      title: bookmark.title || "",
      url: bookmark.url || "",
      folderId: bookmark.folderId ?? null,
    });
  }

  async function submitDraft() {
    if (!browserShell || !draft) return;

    await runMutation(async () => {
      if (draft.kind === "new-folder") {
        const name = draft.name.trim();
        if (!name) {
          showToast(t("folderNameRequired"), "err");
          return;
        }
        await browserShell.bookmarksFolderCreate(name, draft.parentId);
        await reloadState();
        setDraft(null);
        showToast(t("folderCreateSuccess"), "ok");
        return;
      }

      if (draft.kind === "edit-folder") {
        const name = draft.name.trim();
        if (!name) {
          showToast(t("folderNameRequired"), "err");
          return;
        }
        await browserShell.bookmarksFolderUpdate(draft.folderId, {
          name,
          parentId: draft.parentId,
        });
        await reloadState();
        setDraft(null);
        showToast(t("folderUpdateSuccess"), "ok");
        return;
      }

      const nextUrl = draft.url.trim();
      if (!nextUrl) {
        showToast(t("bookmarkUrlRequired"), "err");
        return;
      }

      if (draft.kind === "new-bookmark") {
        await browserShell.bookmarksAdd(draft.title.trim(), nextUrl, undefined, draft.parentId);
        await reloadState();
        setDraft(null);
        showToast(t("bookmarkCreateSuccess"), "ok");
        return;
      }

      await browserShell.bookmarksUpdate(draft.bookmarkId, {
        title: draft.title.trim(),
        url: nextUrl,
        folderId: draft.folderId,
      });
      await reloadState();
      setDraft(null);
      showToast(t("bookmarkUpdateSuccess"), "ok");
    }, draft.kind.includes("folder") ? t("folderCreateFailed") : t("bookmarkCreateFailed"));
  }

  async function removeFolder(folderId: string) {
    if (!browserShell) return;
    if (!window.confirm(t("folderDeleteConfirm"))) return;

    await runMutation(async () => {
      await browserShell.bookmarksFolderRemove(folderId);
      await reloadState();
      if (draft?.kind === "edit-folder" && draft.folderId === folderId) {
        setDraft(null);
      }
      showToast(t("folderDeleteSuccess"), "ok");
    }, t("folderDeleteFailed"));
  }

  async function removeBookmark(bookmarkId: string) {
    if (!browserShell) return;

    await runMutation(async () => {
      await browserShell.bookmarksRemove(bookmarkId);
      await reloadState();
      if (draft?.kind === "edit-bookmark" && draft.bookmarkId === bookmarkId) {
        setDraft(null);
      }
      showToast(t("bookmarkDeleteSuccess"), "ok");
    }, t("bookmarkDeleteFailed"));
  }

  async function clearAll() {
    if (!browserShell || (folders.length === 0 && bookmarks.length === 0)) return;
    if (!window.confirm(t("clearAllConfirm"))) return;

    await runMutation(async () => {
      await browserShell.bookmarksClear();
      await reloadState();
      setDraft(null);
      showToast(t("clearAllSuccess"), "ok");
    }, t("clearAllFailed"));
  }

  async function importFromSource(sourceId: string) {
    if (!browserShell) return;

    await runMutation(async () => {
      const result = await browserShell.bookmarksImportSource(sourceId);
      applyImportResult(result);
    }, t("importFailed"));
  }

  async function importFromFile() {
    if (!browserShell) return;

    await runMutation(async () => {
      const result = await browserShell.bookmarksImportFile();
      if (!result) {
        return;
      }
      applyImportResult(result);
    }, t("importFailed"));
  }

  function openBookmark(bookmark: BookmarkRecord) {
    if (!bookmark.url) return;
    window.open(bookmark.url, "_blank");
  }

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
    const handleMediaChange = (event: MediaQueryListEvent) => setSystemPrefersLight(event.matches);
    mediaQuery.addEventListener("change", handleMediaChange);
    return () => mediaQuery.removeEventListener("change", handleMediaChange);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.setAttribute("data-theme", isLight ? "light" : "dark");
    document.title = t("pageTitle");
  }, [isLight, locale]);

  useEffect(() => {
    if (!browserShell) {
      setStatus(t("shellMissing"), "err");
      return;
    }

    let disposed = false;

    void browserShell.settingsGetTheme()
      .then((nextTheme) => {
        if (!disposed) setThemeSetting(nextTheme);
      })
      .catch(() => undefined);

    void browserShell.settingsGetLanguage()
      .then((nextLanguage) => {
        if (!disposed) setLanguage(normalizeLanguageSetting(nextLanguage));
      })
      .catch(() => undefined);

    void reloadState().catch((error) => {
      if (!disposed) {
        setStatus(error instanceof Error ? error.message : t("initFailed"), "err");
      }
    });

    const handleBookmarkChange = () => {
      void reloadState().catch((error) => {
        if (!disposed) {
          setStatus(error instanceof Error ? error.message : t("initFailed"), "err");
        }
      });
    };

    const disposeTheme = browserShell.onThemeChanged((nextTheme) => {
      if (!disposed) setThemeSetting(nextTheme);
    });

    const disposeLanguage = browserShell.onLanguageChanged((nextLanguage) => {
      if (!disposed) setLanguage(normalizeLanguageSetting(nextLanguage));
    });

    window.addEventListener("bookmarks:changed", handleBookmarkChange);

    return () => {
      disposed = true;
      disposeTheme?.();
      disposeLanguage?.();
      window.removeEventListener("bookmarks:changed", handleBookmarkChange);
    };
  }, []);

  useEffect(() => {
    if (!showImportPanel || !browserShell) {
      return;
    }

    void loadImportSources().catch((error) => {
      showToast(error instanceof Error ? error.message : t("importFailed"), "err");
    });
  }, [showImportPanel, browserShell]);

  useEffect(() => {
    if (!showImportPanel) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isBusy) {
        return;
      }
      event.preventDefault();
      setShowImportPanel(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showImportPanel, isBusy]);

  useEffect(() => {
    if (!toastMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setToastMessage("");
      setToastTone(null);
    }, 4200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [toastMessage]);

  const shellMissing = !browserShell;
  const secondaryButtonClass = cn(
    "inline-flex items-center justify-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
    isLight
      ? "border-[#dadce0] text-[#1a73e8] hover:bg-[rgba(26,115,232,0.08)]"
      : "border-[#5f6368] text-[#8ab4f8] hover:bg-[rgba(138,180,248,0.1)]",
  );
  const primaryButtonClass = cn(
    "inline-flex items-center justify-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
    isLight
      ? "border-[#1a73e8] bg-[#1a73e8] text-white hover:bg-[#1765cc]"
      : "border-[#8ab4f8] bg-[#8ab4f8] text-[#202124] hover:bg-[#aecbfa]",
  );
  const dangerButtonClass = cn(
    "inline-flex items-center justify-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
    isLight
      ? "border-rose-300/70 text-rose-600 hover:bg-[rgba(244,63,94,0.08)]"
      : "border-rose-400/30 text-rose-300 hover:bg-[rgba(244,143,177,0.1)]",
  );
  const iconButtonClass = cn(
    "inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:pointer-events-none disabled:opacity-50",
    isLight
      ? "border-[#dadce0] text-[#5f6368] hover:bg-[#f1f3f4]"
      : "border-[#4b4f55] text-[#9aa0a6] hover:bg-[#3c4043]",
  );
  const inputClass = cn(
    "h-9 w-full rounded-[10px] border px-3 text-sm outline-none transition",
    isLight
      ? "border-[#dadce0] bg-white text-[#202124] placeholder:text-[#5f6368] focus:border-[#1a73e8] focus:shadow-[0_0_0_1px_#1a73e8]"
      : "border-[#5f6368] bg-[#202124] text-[#e8eaed] placeholder:text-[#9aa0a6] focus:border-[#8ab4f8] focus:shadow-[0_0_0_1px_#8ab4f8]",
  );
  const panelClass = cn(
    "overflow-hidden rounded-[18px] border",
    isLight ? "border-[#dadce0] bg-white" : "border-[#3c4043] bg-[#292a2d]",
  );
  const rowHoverClass = isLight ? "hover:bg-[#f1f3f4]" : "hover:bg-[#323438]";
  const branchClass = isLight ? "border-[#e0e3e7]" : "border-[#3c4043]";
  const mutedTextClass = isLight ? "text-[#5f6368]" : "text-[#9aa0a6]";
  const strongTextClass = isLight ? "text-[#202124]" : "text-[#e8eaed]";

  function childSummary(folderId: string | null) {
    const childFolders = childFoldersByParent.get(folderKey(folderId)) ?? [];
    const childBookmarks = bookmarksByFolder.get(folderKey(folderId)) ?? [];
    const segments: string[] = [];
    if (childFolders.length > 0) {
      segments.push(t("childFolderCount", { count: childFolders.length }));
    }
    if (childBookmarks.length > 0) {
      segments.push(t("childBookmarkCount", { count: childBookmarks.length }));
    }
    return segments.join(" · ");
  }

  function renderFolderEditor(folder: BookmarkFolderRecord, depth: number) {
    if (draft?.kind !== "edit-folder" || draft.folderId !== folder.id) return null;

    return (
      <form
        className={cn(
          "flex flex-col gap-2 rounded-xl border px-3 py-3",
          isLight ? "border-[#dadce0] bg-[#f8f9fa]" : "border-[#3c4043] bg-[#202124]",
        )}
        onSubmit={(event) => {
          event.preventDefault();
          void submitDraft();
        }}
        style={{ marginLeft: depth * 20 }}
      >
        <input
          autoFocus
          className={inputClass}
          onChange={(event) => {
            setDraft((current) => (
              current?.kind === "edit-folder" && current.folderId === folder.id
                ? { ...current, name: event.target.value }
                : current
            ));
          }}
          placeholder={t("folderNamePlaceholder")}
          type="text"
          value={draft.name}
        />
        <select
          className={inputClass}
          onChange={(event) => {
            const nextParentId = event.target.value || null;
            setDraft((current) => (
              current?.kind === "edit-folder" && current.folderId === folder.id
                ? { ...current, parentId: nextParentId }
                : current
            ));
          }}
          value={draft.parentId ?? ""}
        >
          {folderOptions(folder.id).map((option) => (
            <option key={option.id ?? ROOT_FOLDER_KEY} value={option.id ?? ""}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-2">
          <button className={primaryButtonClass} disabled={isBusy || shellMissing} type="submit">
            <Check className="h-4 w-4" />
            {t("save")}
          </button>
          <button
            className={secondaryButtonClass}
            onClick={() => setDraft(null)}
            type="button"
          >
            <X className="h-4 w-4" />
            {t("cancel")}
          </button>
        </div>
      </form>
    );
  }

  function renderBookmarkEditor(bookmark: BookmarkRecord, depth: number) {
    if (draft?.kind !== "edit-bookmark" || draft.bookmarkId !== bookmark.id) return null;

    return (
      <form
        className={cn(
          "flex flex-col gap-2 rounded-xl border px-3 py-3",
          isLight ? "border-[#dadce0] bg-[#f8f9fa]" : "border-[#3c4043] bg-[#202124]",
        )}
        onSubmit={(event) => {
          event.preventDefault();
          void submitDraft();
        }}
        style={{ marginLeft: depth * 20 }}
      >
        <input
          autoFocus
          className={inputClass}
          onChange={(event) => {
            setDraft((current) => (
              current?.kind === "edit-bookmark" && current.bookmarkId === bookmark.id
                ? { ...current, title: event.target.value }
                : current
            ));
          }}
          placeholder={t("bookmarkTitlePlaceholder")}
          type="text"
          value={draft.title}
        />
        <input
          className={inputClass}
          onChange={(event) => {
            setDraft((current) => (
              current?.kind === "edit-bookmark" && current.bookmarkId === bookmark.id
                ? { ...current, url: event.target.value }
                : current
            ));
          }}
          placeholder={t("bookmarkUrlPlaceholder")}
          type="text"
          value={draft.url}
        />
        <select
          className={inputClass}
          onChange={(event) => {
            const nextFolderId = event.target.value || null;
            setDraft((current) => (
              current?.kind === "edit-bookmark" && current.bookmarkId === bookmark.id
                ? { ...current, folderId: nextFolderId }
                : current
            ));
          }}
          value={draft.folderId ?? ""}
        >
          {folderOptions().map((option) => (
            <option key={option.id ?? ROOT_FOLDER_KEY} value={option.id ?? ""}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-2">
          <button className={primaryButtonClass} disabled={isBusy || shellMissing} type="submit">
            <Check className="h-4 w-4" />
            {t("save")}
          </button>
          <button
            className={secondaryButtonClass}
            onClick={() => setDraft(null)}
            type="button"
          >
            <X className="h-4 w-4" />
            {t("cancel")}
          </button>
        </div>
      </form>
    );
  }

  function renderPendingDraft(parentId: string | null, depth: number) {
    if (!draft) return null;

    if (draft.kind === "new-folder" && draft.parentId === parentId) {
      return (
        <form
          className={cn(
            "flex flex-col gap-2 rounded-xl border px-3 py-3",
            isLight ? "border-[#dadce0] bg-[#f8f9fa]" : "border-[#3c4043] bg-[#202124]",
          )}
          onSubmit={(event) => {
            event.preventDefault();
            void submitDraft();
          }}
          style={{ marginLeft: depth * 20 }}
        >
          <input
            autoFocus
            className={inputClass}
            onChange={(event) => {
              setDraft((current) => (
                current?.kind === "new-folder" && current.parentId === parentId
                  ? { ...current, name: event.target.value }
                  : current
              ));
            }}
            placeholder={t("folderNamePlaceholder")}
            type="text"
            value={draft.name}
          />
          <div className="flex flex-wrap gap-2">
            <button className={primaryButtonClass} disabled={isBusy || shellMissing} type="submit">
              <Check className="h-4 w-4" />
              {t("save")}
            </button>
            <button
              className={secondaryButtonClass}
              onClick={() => setDraft(null)}
              type="button"
            >
              <X className="h-4 w-4" />
              {t("cancel")}
            </button>
          </div>
        </form>
      );
    }

    if (draft.kind === "new-bookmark" && draft.parentId === parentId) {
      return (
        <form
          className={cn(
            "flex flex-col gap-2 rounded-xl border px-3 py-3",
            isLight ? "border-[#dadce0] bg-[#f8f9fa]" : "border-[#3c4043] bg-[#202124]",
          )}
          onSubmit={(event) => {
            event.preventDefault();
            void submitDraft();
          }}
          style={{ marginLeft: depth * 20 }}
        >
          <input
            autoFocus
            className={inputClass}
            onChange={(event) => {
              setDraft((current) => (
                current?.kind === "new-bookmark" && current.parentId === parentId
                  ? { ...current, title: event.target.value }
                  : current
              ));
            }}
            placeholder={t("bookmarkTitlePlaceholder")}
            type="text"
            value={draft.title}
          />
          <input
            className={inputClass}
            onChange={(event) => {
              setDraft((current) => (
                current?.kind === "new-bookmark" && current.parentId === parentId
                  ? { ...current, url: event.target.value }
                  : current
              ));
            }}
            placeholder={t("bookmarkUrlPlaceholder")}
            type="text"
            value={draft.url}
          />
          <div className="flex flex-wrap gap-2">
            <button className={primaryButtonClass} disabled={isBusy || shellMissing} type="submit">
              <Check className="h-4 w-4" />
              {t("save")}
            </button>
            <button
              className={secondaryButtonClass}
              onClick={() => setDraft(null)}
              type="button"
            >
              <X className="h-4 w-4" />
              {t("cancel")}
            </button>
          </div>
        </form>
      );
    }

    return null;
  }

  function renderBookmarkNode(bookmark: BookmarkRecord, depth: number): ReactNode {
    if (draft?.kind === "edit-bookmark" && draft.bookmarkId === bookmark.id) {
      return <div key={bookmark.id}>{renderBookmarkEditor(bookmark, depth)}</div>;
    }

    return (
      <div
        key={bookmark.id}
        className={cn("group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors", rowHoverClass)}
        style={{ marginLeft: depth * 20 }}
      >
        <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", isLight ? "bg-[#f1f3f4]" : "bg-[#202124]")}>
          <Link2 className={cn("h-4 w-4", mutedTextClass)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className={cn("truncate text-sm font-medium", strongTextClass)}>
            {bookmark.title || t("untitled")}
          </div>
          <div className={cn("truncate text-xs", mutedTextClass)}>{bookmark.url}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            className={iconButtonClass}
            onClick={() => openBookmark(bookmark)}
            title={t("open")}
            type="button"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
          <button
            className={iconButtonClass}
            onClick={() => beginEditBookmark(bookmark)}
            title={t("edit")}
            type="button"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            className={cn(iconButtonClass, isLight ? "text-rose-600" : "text-rose-300")}
            disabled={isBusy || shellMissing}
            onClick={() => void removeBookmark(bookmark.id)}
            title={t("remove")}
            type="button"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  function renderFolderNode(
    folder: BookmarkFolderRecord,
    depth: number,
    forceShowAll = false,
  ): ReactNode {
    const selfMatched = normalizedQuery ? folderMatches(folder) : true;
    const showAllDescendants = forceShowAll || !normalizedQuery || selfMatched;

    if (normalizedQuery && !showAllDescendants && !folderVisible(folder)) {
      return null;
    }

    const childFolders = childFoldersByParent.get(folderKey(folder.id)) ?? [];
    const childBookmarks = bookmarksByFolder.get(folderKey(folder.id)) ?? [];
    const visibleBookmarks = showAllDescendants
      ? childBookmarks
      : childBookmarks.filter((bookmark) => bookmarkMatches(bookmark));
    const expanded = normalizedQuery ? true : expandedFolderIds.has(folder.id);
    const summary = childSummary(folder.id);

    return (
      <div key={folder.id} className="space-y-1">
        {draft?.kind === "edit-folder" && draft.folderId === folder.id ? (
          renderFolderEditor(folder, depth)
        ) : (
          <div
            className={cn("group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors", rowHoverClass)}
            onClick={() => {
              if (childFolders.length === 0 && childBookmarks.length === 0) return;
              setExpandedFolderIds((current) => {
                const next = new Set(current);
                if (next.has(folder.id)) {
                  next.delete(folder.id);
                } else {
                  next.add(folder.id);
                }
                return next;
              });
            }}
            style={{ marginLeft: depth * 20 }}
          >
            <button
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-md",
                isLight ? "hover:bg-[#e8eaed]" : "hover:bg-[#3c4043]",
              )}
              onClick={(event) => {
                event.stopPropagation();
                setExpandedFolderIds((current) => {
                  const next = new Set(current);
                  if (next.has(folder.id)) {
                    next.delete(folder.id);
                  } else {
                    next.add(folder.id);
                  }
                  return next;
                });
              }}
              type="button"
            >
              {childFolders.length > 0 || childBookmarks.length > 0 ? (
                expanded ? (
                  <ChevronDown className={cn("h-4 w-4", mutedTextClass)} />
                ) : (
                  <ChevronRight className={cn("h-4 w-4", mutedTextClass)} />
                )
              ) : (
                <span className="h-4 w-4" />
              )}
            </button>
            <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", isLight ? "bg-[#f1f3f4]" : "bg-[#202124]")}>
              {expanded ? (
                <FolderOpen className={cn("h-4 w-4", strongTextClass)} />
              ) : (
                <Folder className={cn("h-4 w-4", strongTextClass)} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className={cn("truncate text-sm font-medium", strongTextClass)}>{folder.name}</div>
              <div className={cn("truncate text-xs", mutedTextClass)}>
                {summary || folderPathLabel(folder.parentId)}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                className={iconButtonClass}
                onClick={(event) => {
                  event.stopPropagation();
                  beginNewFolder(folder.id);
                }}
                title={t("addFolder")}
                type="button"
              >
                <FolderPlus className="h-4 w-4" />
              </button>
              <button
                className={iconButtonClass}
                onClick={(event) => {
                  event.stopPropagation();
                  beginNewBookmark(folder.id);
                }}
                title={t("addBookmark")}
                type="button"
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                className={iconButtonClass}
                onClick={(event) => {
                  event.stopPropagation();
                  beginEditFolder(folder);
                }}
                title={t("edit")}
                type="button"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                className={cn(iconButtonClass, isLight ? "text-rose-600" : "text-rose-300")}
                disabled={isBusy || shellMissing}
                onClick={(event) => {
                  event.stopPropagation();
                  void removeFolder(folder.id);
                }}
                title={t("remove")}
                type="button"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {expanded ? (
          <div className={cn("ml-5 space-y-1 border-l pl-3", branchClass)}>
            {renderPendingDraft(folder.id, depth + 1)}
            {childFolders.map((child) => renderFolderNode(child, depth + 1, showAllDescendants))}
            {visibleBookmarks.map((bookmark) => renderBookmarkNode(bookmark, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  }

  const rootFolders = childFoldersByParent.get(ROOT_FOLDER_KEY) ?? [];
  const rootBookmarks = bookmarksByFolder.get(ROOT_FOLDER_KEY) ?? [];
  const visibleRootFolders = normalizedQuery
    ? rootFolders.filter((folder) => folderVisible(folder))
    : rootFolders;
  const visibleRootBookmarks = normalizedQuery
    ? rootBookmarks.filter((bookmark) => bookmarkMatches(bookmark))
    : rootBookmarks;
  const hasVisibleTreeContent = visibleRootFolders.length > 0 || visibleRootBookmarks.length > 0;

  return (
    <div className={cn("flex h-screen flex-col overflow-hidden", strongTextClass)}>
      <header
        className={cn(
          "flex w-full flex-col gap-4 border-b px-6 py-4 lg:grid lg:grid-cols-[220px_minmax(0,1fr)_auto] lg:items-center lg:gap-6 lg:px-8",
          isLight ? "border-[#dadce0] bg-[#f8f9fa]" : "border-[#3c4043] bg-[#202124]",
        )}
      >
        <div className="flex shrink-0 items-center gap-4 lg:w-[220px]">
          <div className={cn("flex h-10 w-10 items-center justify-center rounded-2xl", isLight ? "bg-white" : "bg-[#292a2d]")}>
            <Bookmark className={cn("h-5 w-5", strongTextClass)} />
          </div>
          <div>
            <h1 className="text-[20px] font-normal leading-none">{t("heroTitle")}</h1>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3 lg:w-full lg:justify-self-stretch">
          <label
            className={cn(
              "flex min-w-0 flex-1 items-center gap-3 rounded-full border px-4 py-2.5 transition-shadow lg:mx-auto lg:w-full lg:max-w-[680px]",
              isLight
                ? "border-transparent bg-[#e8eaed] focus-within:border-[#1a73e8] focus-within:bg-white focus-within:shadow-[0_0_0_1px_#1a73e8]"
                : "border-transparent bg-[#28292c] focus-within:border-[#8ab4f8] focus-within:bg-[#202124] focus-within:shadow-[0_0_0_1px_#8ab4f8]",
            )}
          >
            <Search className={cn("h-4 w-4 shrink-0", mutedTextClass)} />
            <input
              className={cn(
                "min-w-0 flex-1 border-0 bg-transparent text-sm outline-none",
                isLight ? "text-[#202124] placeholder:text-[#5f6368]" : "text-[#e8eaed] placeholder:text-[#9aa0a6]",
              )}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("searchPlaceholder")}
              type="text"
              value={query}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <button
            className={secondaryButtonClass}
            disabled={shellMissing}
            onClick={() => setShowImportPanel(true)}
            type="button"
          >
            <Download className="h-4 w-4" />
            {t("importBookmarks")}
          </button>
          <button
            className={dangerButtonClass}
            disabled={isBusy || shellMissing || (folders.length === 0 && bookmarks.length === 0)}
            onClick={() => void clearAll()}
            type="button"
          >
            <Trash2 className="h-4 w-4" />
            {t("clearAll")}
          </button>
          {statusMessage && statusTone === "err" ? (
            <span
              className={cn(
                "text-sm",
                isLight ? "text-rose-600" : "text-rose-300",
              )}
            >
              {statusMessage}
            </span>
          ) : null}
        </div>
      </header>

      <main className="custom-scrollbar flex-1 overflow-y-auto px-6 py-6 lg:px-8 lg:py-8">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4">
          <section className={panelClass}>
            <div
              className={cn(
                "flex flex-col gap-3 border-b px-5 py-4 lg:flex-row lg:items-center lg:justify-between",
                isLight ? "border-[#dadce0]" : "border-[#3c4043]",
              )}
            >
              <div>
                <h2 className="text-[18px] font-medium">{t("treeTitle")}</h2>
                <p className={cn("mt-1 text-sm", mutedTextClass)}>{t("treeDescription")}</p>
              </div>
              <div className={cn("text-sm", mutedTextClass)}>
                {childSummary(null)}
              </div>
            </div>

            <div className="p-4">
              <div className="space-y-2">
                <div className={cn("flex items-center gap-3 rounded-xl px-3 py-3", isLight ? "bg-[#f8f9fa]" : "bg-[#202124]")}>
                  <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", isLight ? "bg-white" : "bg-[#292a2d]")}>
                    <Bookmark className={cn("h-4 w-4", strongTextClass)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{t("rootFolder")}</div>
                    <div className={cn("text-xs", mutedTextClass)}>
                      {childSummary(null) || t("treeDescription")}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      className={iconButtonClass}
                      disabled={isBusy || shellMissing}
                      onClick={() => beginNewFolder(null)}
                      title={t("addFolder")}
                      type="button"
                    >
                      <FolderPlus className="h-4 w-4" />
                    </button>
                    <button
                      className={iconButtonClass}
                      disabled={isBusy || shellMissing}
                      onClick={() => beginNewBookmark(null)}
                      title={t("addBookmark")}
                      type="button"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className={cn("space-y-1 border-l pl-3", branchClass)}>
                  {renderPendingDraft(null, 0)}
                  {visibleRootFolders.map((folder) => renderFolderNode(folder, 0))}
                  {visibleRootBookmarks.map((bookmark) => renderBookmarkNode(bookmark, 0))}

                  {!hasVisibleTreeContent && !draft ? (
                    <div className={cn("px-3 py-10 text-center text-sm", mutedTextClass)}>
                      {normalizedQuery ? t("emptySearch") : t("empty")}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      {showImportPanel ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeImportPanel();
            }
          }}
        >
          <div
            aria-describedby="bookmarks-import-dialog-description"
            aria-labelledby="bookmarks-import-dialog-title"
            aria-modal="true"
            className={cn(
              "flex w-full max-w-[760px] flex-col overflow-hidden rounded-[24px] border shadow-[0_24px_80px_rgba(0,0,0,0.45)]",
              isLight ? "border-[#dadce0] bg-white" : "border-[#3c4043] bg-[#292a2d]",
            )}
            role="dialog"
            style={{ maxHeight: "min(84vh, 760px)" }}
          >
            <div
              className={cn(
                "flex items-start justify-between gap-4 border-b px-5 py-5",
                isLight ? "border-[#dadce0]" : "border-[#3c4043]",
              )}
            >
              <div className="min-w-0">
                <h2 id="bookmarks-import-dialog-title" className="text-[20px] font-medium">
                  {t("importPanelTitle")}
                </h2>
                <p id="bookmarks-import-dialog-description" className={cn("mt-1 text-sm", mutedTextClass)}>
                  {t("importPanelDescription")}
                </p>
              </div>
              <button
                aria-label={t("cancel")}
                className={iconButtonClass}
                disabled={isBusy}
                onClick={closeImportPanel}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="custom-scrollbar space-y-4 overflow-y-auto px-5 py-5">
              <div className={cn("rounded-xl border px-4 py-3 text-sm", isLight ? "border-[#dadce0] bg-[#f8f9fa]" : "border-[#3c4043] bg-[#202124]", mutedTextClass)}>
                {t("importHint")}
              </div>

              <div className="space-y-2">
                <div className={cn("text-sm font-medium", strongTextClass)}>{t("importDetectedSources")}</div>

                {isLoadingImportSources ? (
                  <div className={cn("rounded-xl border px-4 py-3 text-sm", isLight ? "border-[#dadce0] bg-[#f8f9fa]" : "border-[#3c4043] bg-[#202124]", mutedTextClass)}>
                    {t("importLoadingSources")}
                  </div>
                ) : importSources.length === 0 ? (
                  <div className={cn("rounded-xl border px-4 py-3 text-sm", isLight ? "border-[#dadce0] bg-[#f8f9fa]" : "border-[#3c4043] bg-[#202124]", mutedTextClass)}>
                    {t("importNoSources")}
                  </div>
                ) : (
                  importSources.map((source) => {
                    const isImported = sourceImported(source);

                    return (
                      <div
                        key={source.id}
                        className={cn(
                          "flex flex-col gap-3 rounded-xl border px-4 py-3 lg:flex-row lg:items-center lg:justify-between",
                          isLight ? "border-[#dadce0] bg-[#f8f9fa]" : "border-[#3c4043] bg-[#202124]",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className={cn("truncate text-sm font-medium", strongTextClass)}>
                              {source.browserName}
                            </div>
                            {isImported ? (
                              <span
                                className={cn(
                                  "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none",
                                  isLight
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                    : "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
                                )}
                              >
                                {t("importAlreadyImported")}
                              </span>
                            ) : null}
                          </div>
                          <div className={cn("truncate text-xs", mutedTextClass)}>
                            {source.profileName}
                          </div>
                        </div>
                        <button
                          className={primaryButtonClass}
                          disabled={isBusy || shellMissing}
                          onClick={() => void importFromSource(source.id)}
                          type="button"
                        >
                          <Download className="h-4 w-4" />
                          {isImported ? t("importReimportAction") : t("importAction")}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div
              className={cn(
                "flex flex-wrap items-center justify-end gap-2 border-t px-5 py-4",
                isLight ? "border-[#dadce0]" : "border-[#3c4043]",
              )}
            >
              <button
                autoFocus
                className={secondaryButtonClass}
                disabled={isBusy || shellMissing || isLoadingImportSources}
                onClick={() => {
                  void loadImportSources().catch((error) => {
                    showToast(error instanceof Error ? error.message : t("importFailed"), "err");
                  });
                }}
                type="button"
              >
                <RefreshCw className={cn("h-4 w-4", isLoadingImportSources && "animate-spin")} />
                {t("importRefreshSources")}
              </button>
              <button
                className={primaryButtonClass}
                disabled={isBusy || shellMissing}
                onClick={() => void importFromFile()}
                type="button"
              >
                <Download className="h-4 w-4" />
                {t("importFromFile")}
              </button>
              <button
                className={secondaryButtonClass}
                disabled={isBusy}
                onClick={closeImportPanel}
                type="button"
              >
                <X className="h-4 w-4" />
                {t("cancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toastMessage ? (
        <div className="pointer-events-none fixed bottom-6 right-6 z-50 max-w-[min(420px,calc(100vw-32px))]">
          <div
            className={cn(
              "rounded-2xl border px-4 py-3 text-sm shadow-lg backdrop-blur",
              toastTone === "ok"
                ? (isLight
                    ? "border-emerald-200 bg-white/95 text-emerald-700"
                    : "border-emerald-400/30 bg-[#202124]/95 text-emerald-300")
                : (isLight
                    ? "border-rose-200 bg-white/95 text-rose-700"
                    : "border-rose-400/30 bg-[#202124]/95 text-rose-300"),
            )}
          >
            {toastMessage}
          </div>
        </div>
      ) : null}
    </div>
  );
}
