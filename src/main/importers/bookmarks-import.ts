import { randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import type { BookmarkFolderRecord, BookmarkRecord } from "../bridge/ipc.js";
import {
  buildChromiumSourceLabel,
  listChromiumProfileFileSources,
} from "./chromium-import.js";

interface DecodedImportSourceId {
  kind: "chromium-json";
  bookmarkPath: string;
  browserId?: string;
  browserName: string;
  profileId?: string;
  profileName: string;
}

interface ChromiumBookmarkNode {
  type?: string;
  name?: string;
  url?: string;
  children?: ChromiumBookmarkNode[];
}

interface ImportedFolderNode {
  kind: "folder";
  name: string;
  children: ImportedBookmarkTreeNode[];
}

interface ImportedBookmarkNode {
  kind: "bookmark";
  title: string;
  url: string;
}

type ImportedBookmarkTreeNode = ImportedFolderNode | ImportedBookmarkNode;

export interface BookmarkImportSource {
  id: string;
  browserId: string;
  browserName: string;
  profileId: string;
  profileName: string;
  format: "chromium-json";
}

export interface BookmarkImportResult {
  bookmarks: BookmarkRecord[];
  folders: BookmarkFolderRecord[];
  importedBookmarks: number;
  skippedBookmarks: number;
  importedFolders: number;
  sourceLabel: string;
}

const CHROMIUM_ROOT_LABELS: Record<string, string | null> = {
  bookmark_bar: "Bookmarks Bar",
  other: "Other Bookmarks",
  synced: "Synced Bookmarks",
  account: "Account Bookmarks",
  mobile: "Mobile Bookmarks",
  toolbar: "Bookmarks Toolbar",
  unfiled: "Other Bookmarks",
  menu: "Bookmarks Menu",
  trash: null,
};

function decodeImportSourceId(sourceId: string): DecodedImportSourceId | null {
  try {
    const decoded = JSON.parse(sourceId) as Partial<DecodedImportSourceId>;
    if (
      decoded.kind !== "chromium-json"
      || typeof decoded.bookmarkPath !== "string"
      || typeof decoded.browserName !== "string"
      || typeof decoded.profileName !== "string"
    ) {
      return null;
    }
    return {
      kind: "chromium-json",
      bookmarkPath: decoded.bookmarkPath,
      browserId: decoded.browserId,
      browserName: decoded.browserName,
      profileId: decoded.profileId,
      profileName: decoded.profileName,
    };
  } catch {
    return null;
  }
}

function buildImportSourceId(
  browserId: string,
  browserName: string,
  profileId: string,
  profileName: string,
  bookmarkPath: string,
) {
  return JSON.stringify({
    kind: "chromium-json",
    browserId,
    browserName,
    profileId,
    profileName,
    bookmarkPath,
  });
}

function inferBookmarkTitle(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

function sanitizeImportedFolderName(name: string) {
  return name.trim() || "Untitled Folder";
}

function sanitizeImportedBookmarkTitle(title: string, url: string) {
  return title.trim() || inferBookmarkTitle(url);
}

function decodeHtmlEntities(value: string) {
  return value.replace(/&(#x?[0-9a-f]+|\w+);/gi, (match, token: string) => {
    const normalized = token.toLowerCase();
    if (normalized === "amp") return "&";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    if (normalized === "quot") return "\"";
    if (normalized === "apos") return "'";
    if (normalized === "nbsp") return " ";

    if (normalized.startsWith("#x")) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    if (normalized.startsWith("#")) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return match;
  });
}

function stripHtmlMarkup(value: string) {
  return decodeHtmlEntities(value).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function extractHtmlAttribute(attributes: string, name: string) {
  const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = pattern.exec(attributes);
  if (!match) {
    return "";
  }
  return decodeHtmlEntities(match[1] || match[2] || match[3] || "").trim();
}

function parseChromiumBookmarkNode(node: ChromiumBookmarkNode): ImportedBookmarkTreeNode | null {
  if (!node || typeof node !== "object") {
    return null;
  }

  if (node.type === "url" && typeof node.url === "string") {
    const url = node.url.trim();
    if (!url) {
      return null;
    }
    return {
      kind: "bookmark",
      title: sanitizeImportedBookmarkTitle(String(node.name || ""), url),
      url,
    };
  }

  if (node.type === "folder" && Array.isArray(node.children)) {
    const children = node.children
      .map((child) => parseChromiumBookmarkNode(child))
      .filter((child): child is ImportedBookmarkTreeNode => child !== null);

    if (children.length === 0) {
      return null;
    }

    return {
      kind: "folder",
      name: sanitizeImportedFolderName(String(node.name || "")),
      children,
    };
  }

  return null;
}

function parseChromiumBookmarksFile(raw: string) {
  const parsed = JSON.parse(raw) as { roots?: Record<string, ChromiumBookmarkNode> };
  if (!parsed || typeof parsed !== "object" || !parsed.roots || typeof parsed.roots !== "object") {
    throw new Error("Unsupported Chromium bookmarks file.");
  }

  const nodes: ImportedBookmarkTreeNode[] = [];
  for (const [rootKey, rootNode] of Object.entries(parsed.roots)) {
    if (!rootNode || typeof rootNode !== "object" || !Array.isArray(rootNode.children)) {
      continue;
    }

    const rootLabel = CHROMIUM_ROOT_LABELS[rootKey];
    if (rootLabel === null) {
      continue;
    }

    const children = rootNode.children
      .map((child) => parseChromiumBookmarkNode(child))
      .filter((child): child is ImportedBookmarkTreeNode => child !== null);

    if (children.length === 0) {
      continue;
    }

    const rootName = sanitizeImportedFolderName(String(rootNode.name || rootLabel || rootKey));
    nodes.push({
      kind: "folder",
      name: rootName,
      children,
    });
  }

  return nodes;
}

function parseHtmlBookmarksFile(raw: string) {
  const nodes: ImportedBookmarkTreeNode[] = [];
  const stack: ImportedBookmarkTreeNode[][] = [nodes];
  let pendingFolder: ImportedFolderNode | null = null;
  const tokenPattern = /<DT><H3\b([^>]*)>([\s\S]*?)<\/H3>|<DT><A\b([^>]*)>([\s\S]*?)<\/A>|<DL\b[^>]*>|<\/DL>/gi;

  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(raw)) !== null) {
    const token = match[0];

    if (/^<DL\b/i.test(token)) {
      if (pendingFolder) {
        stack.push(pendingFolder.children);
        pendingFolder = null;
      }
      continue;
    }

    if (/^<\/DL>/i.test(token)) {
      pendingFolder = null;
      if (stack.length > 1) {
        stack.pop();
      }
      continue;
    }

    if (match[2] != null) {
      const folder: ImportedFolderNode = {
        kind: "folder",
        name: sanitizeImportedFolderName(stripHtmlMarkup(match[2])),
        children: [],
      };
      stack[stack.length - 1].push(folder);
      pendingFolder = folder;
      continue;
    }

    pendingFolder = null;
    if (match[4] != null) {
      const href = extractHtmlAttribute(match[3] || "", "href");
      if (!href) {
        continue;
      }

      stack[stack.length - 1].push({
        kind: "bookmark",
        title: sanitizeImportedBookmarkTitle(stripHtmlMarkup(match[4]), href),
        url: href,
      });
    }
  }

  return nodes;
}

function parseImportFile(raw: string, extension: string) {
  const normalizedExtension = extension.trim().toLowerCase();

  if (normalizedExtension === ".json") {
    return parseChromiumBookmarksFile(raw);
  }

  if (normalizedExtension === ".html" || normalizedExtension === ".htm") {
    return parseHtmlBookmarksFile(raw);
  }

  const trimmed = raw.trimStart();
  if (trimmed.startsWith("{")) {
    return parseChromiumBookmarksFile(raw);
  }
  if (trimmed.startsWith("<")) {
    return parseHtmlBookmarksFile(raw);
  }

  throw new Error("Unsupported bookmarks file. Use an exported HTML file or a Chromium Bookmarks JSON file.");
}

function buildFolderLookupKey(parentId: string | null, name: string) {
  return `${parentId || "__root__"}\u0000${name}`;
}

function buildSourceLabel(browserName: string, profileName: string) {
  return buildChromiumSourceLabel(browserName, profileName);
}

function buildFileSourceLabel(filePath: string) {
  const basename = path.basename(filePath, path.extname(filePath)).trim();
  return basename || "Bookmarks File";
}

function buildImportContainerName(sourceLabel: string) {
  return `Imported from ${sourceLabel}`;
}

function importBookmarksIntoCollections(
  nodes: ImportedBookmarkTreeNode[],
  sourceLabel: string,
  currentBookmarks: BookmarkRecord[],
  currentFolders: BookmarkFolderRecord[],
  importSourceId?: string,
) {
  const nextBookmarks = [...currentBookmarks];
  const nextFolders = [...currentFolders];
  const existingUrls = new Set<string>();
  const folderIndex = new Map<string, string>();
  const folderIndicesById = new Map<string, number>();
  const importFolderIds = new Map<string, string>();

  currentBookmarks.forEach((bookmark) => {
    if (bookmark.url) {
      existingUrls.add(bookmark.url);
    }
  });
  currentFolders.forEach((folder, index) => {
    folderIndex.set(
      buildFolderLookupKey(folder.parentId ?? null, folder.name),
      folder.id,
    );
    folderIndicesById.set(folder.id, index);
    if (folder.importSourceId) {
      importFolderIds.set(folder.importSourceId, folder.id);
    }
  });

  let importedBookmarks = 0;
  let skippedBookmarks = 0;
  let importedFolders = 0;

  function ensureFolder(name: string, parentId: string | null, nextImportSourceId?: string) {
    if (nextImportSourceId) {
      const importedFolderId = importFolderIds.get(nextImportSourceId);
      if (importedFolderId) {
        return importedFolderId;
      }
    }

    const normalizedName = sanitizeImportedFolderName(name);
    const lookupKey = buildFolderLookupKey(parentId, normalizedName);
    const existingId = folderIndex.get(lookupKey);
    if (existingId) {
      if (nextImportSourceId) {
        importFolderIds.set(nextImportSourceId, existingId);
        const existingIndex = folderIndicesById.get(existingId);
        if (existingIndex != null && !nextFolders[existingIndex]?.importSourceId) {
          nextFolders[existingIndex] = {
            ...nextFolders[existingIndex],
            importSourceId: nextImportSourceId,
          };
        }
      }
      return existingId;
    }

    const folderId = randomUUID();
    nextFolders.push({
      id: folderId,
      name: normalizedName,
      parentId,
      importSourceId: nextImportSourceId,
      createdAt: Date.now(),
    });
    folderIndex.set(lookupKey, folderId);
    folderIndicesById.set(folderId, nextFolders.length - 1);
    if (nextImportSourceId) {
      importFolderIds.set(nextImportSourceId, folderId);
    }
    importedFolders += 1;
    return folderId;
  }

  function appendBookmark(
    node: ImportedBookmarkNode,
    resolveParentId: () => string | null,
  ) {
    if (existingUrls.has(node.url)) {
      skippedBookmarks += 1;
      return false;
    }

    const parentId = resolveParentId();
    existingUrls.add(node.url);
    nextBookmarks.push({
      id: randomUUID(),
      title: sanitizeImportedBookmarkTitle(node.title, node.url),
      url: node.url,
      folderId: parentId,
      createdAt: Date.now(),
    });
    importedBookmarks += 1;
    return true;
  }

  function importFolderNode(
    node: ImportedFolderNode,
    resolveParentId: () => string | null,
  ) {
    let folderId: string | null = null;

    const resolveFolderId = () => {
      if (!folderId) {
        folderId = ensureFolder(node.name, resolveParentId());
      }
      return folderId;
    };

    let importedAny = false;
    for (const child of node.children) {
      if (child.kind === "bookmark") {
        importedAny = appendBookmark(child, resolveFolderId) || importedAny;
        continue;
      }

      importedAny = importFolderNode(child, resolveFolderId) || importedAny;
    }

    return importedAny;
  }

  let importRootId: string | null = null;
  const resolveImportRootId = () => {
    if (!importRootId) {
      importRootId = ensureFolder(
        buildImportContainerName(sourceLabel),
        null,
        importSourceId,
      );
    }
    return importRootId;
  };

  for (const node of nodes) {
    if (node.kind === "bookmark") {
      appendBookmark(node, resolveImportRootId);
      continue;
    }

    importFolderNode(node, resolveImportRootId);
  }

  return {
    bookmarks: nextBookmarks,
    folders: nextFolders,
    importedBookmarks,
    skippedBookmarks,
    importedFolders,
    sourceLabel,
  } satisfies BookmarkImportResult;
}

export function listBookmarkImportSources() {
  return listChromiumProfileFileSources("Bookmarks").map((source) => ({
    id: buildImportSourceId(
      source.browserId,
      source.browserName,
      source.profileId,
      source.profileName,
      source.filePath,
    ),
    browserId: source.browserId,
    browserName: source.browserName,
    profileId: source.profileId,
    profileName: source.profileName,
    format: "chromium-json" as const,
  }));
}

export function importBookmarksFromSource(
  sourceId: string,
  currentBookmarks: BookmarkRecord[],
  currentFolders: BookmarkFolderRecord[],
) {
  const source = decodeImportSourceId(sourceId);
  if (!source) {
    throw new Error("Unsupported bookmark import source.");
  }

  if (!existsSync(source.bookmarkPath)) {
    throw new Error("The selected browser profile no longer has a readable bookmarks file.");
  }

  const raw = readFileSync(source.bookmarkPath, "utf-8");
  const nodes = parseChromiumBookmarksFile(raw);
  const sourceLabel = buildSourceLabel(source.browserName, source.profileName);
  return importBookmarksIntoCollections(
    nodes,
    sourceLabel,
    currentBookmarks,
    currentFolders,
    sourceId,
  );
}

export function importBookmarksFromFile(
  filePath: string,
  currentBookmarks: BookmarkRecord[],
  currentFolders: BookmarkFolderRecord[],
) {
  if (!existsSync(filePath)) {
    throw new Error("The selected bookmarks file could not be found.");
  }

  const raw = readFileSync(filePath, "utf-8");
  const nodes = parseImportFile(raw, path.extname(filePath));
  return importBookmarksIntoCollections(
    nodes,
    buildFileSourceLabel(filePath),
    currentBookmarks,
    currentFolders,
  );
}
