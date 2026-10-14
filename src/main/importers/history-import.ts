import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  buildChromiumSourceLabel,
  listChromiumProfileFileSources,
} from "./chromium-import.js";
import type {
  HistoryImportSourceStat,
  HistoryRecord,
} from "../bridge/ipc.js";

interface DecodedHistoryImportSourceId {
  kind: "chromium-sqlite";
  historyPath: string;
  browserId?: string;
  browserName: string;
  profileId?: string;
  profileName: string;
}

interface ChromiumHistoryQueryRow {
  url?: unknown;
  title?: unknown;
  last_visit_time?: unknown;
  visit_count?: unknown;
}

interface ImportedHistoryRow {
  title: string;
  url: string;
  lastVisitedAt: number;
  visitCount: number;
}

export interface HistoryImportSource {
  id: string;
  browserId: string;
  browserName: string;
  profileId: string;
  profileName: string;
  format: "chromium-sqlite";
}

export interface HistoryImportResult {
  records: HistoryRecord[];
  importedRecords: number;
  mergedRecords: number;
  skippedRecords: number;
  sourceLabel: string;
}

const CHROMIUM_EPOCH_OFFSET_MS = 11_644_473_600_000n;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function decodeImportSourceId(sourceId: string): DecodedHistoryImportSourceId | null {
  try {
    const decoded = JSON.parse(sourceId) as Partial<DecodedHistoryImportSourceId>;
    if (
      decoded.kind !== "chromium-sqlite"
      || typeof decoded.historyPath !== "string"
      || typeof decoded.browserName !== "string"
      || typeof decoded.profileName !== "string"
    ) {
      return null;
    }

    return {
      kind: "chromium-sqlite",
      historyPath: decoded.historyPath,
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
  historyPath: string,
) {
  return JSON.stringify({
    kind: "chromium-sqlite",
    browserId,
    browserName,
    profileId,
    profileName,
    historyPath,
  });
}

function inferHistoryTitle(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

function normalizeInteger(value: unknown) {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }

  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    try {
      return BigInt(value.trim());
    } catch {
      return 0n;
    }
  }

  return 0n;
}

function clampBigIntToNumber(value: bigint) {
  if (value <= 0n) {
    return 0;
  }
  if (value > MAX_SAFE_INTEGER_BIGINT) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Number(value);
}

function chromiumTimeToUnixMs(value: unknown) {
  const raw = normalizeInteger(value);
  if (raw <= 0n) {
    return 0;
  }

  const unixMilliseconds = (raw / 1000n) - CHROMIUM_EPOCH_OFFSET_MS;
  return clampBigIntToNumber(unixMilliseconds);
}

function normalizeVisitCount(value: unknown) {
  const normalized = clampBigIntToNumber(normalizeInteger(value));
  return Math.max(1, normalized || 0);
}

function isTrackableHistoryUrl(url: string) {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol === "ab:" || parsed.protocol === "data:" || parsed.protocol === "devtools:") {
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

function createDatabaseSnapshot(filePath: string) {
  const tempDirectory = mkdtempSync(path.join(tmpdir(), "milo-history-import-"));
  const snapshotPath = path.join(tempDirectory, path.basename(filePath));

  copyFileSync(filePath, snapshotPath);

  for (const suffix of ["-wal", "-shm"]) {
    const sourcePath = `${filePath}${suffix}`;
    if (existsSync(sourcePath)) {
      copyFileSync(sourcePath, `${snapshotPath}${suffix}`);
    }
  }

  return {
    snapshotPath,
    cleanup() {
      try {
        rmSync(tempDirectory, { recursive: true, force: true });
      } catch {
        // Ignore temp cleanup failures.
      }
    },
  };
}

function readChromiumHistoryRows(historyPath: string) {
  const { snapshotPath, cleanup } = createDatabaseSnapshot(historyPath);
  let database: DatabaseSync | null = null;

  try {
    database = new DatabaseSync(snapshotPath);
    const statement = database.prepare(`
      SELECT
        url,
        title,
        last_visit_time,
        visit_count
      FROM urls
      WHERE url IS NOT NULL AND TRIM(url) != ''
      ORDER BY last_visit_time DESC
    `);
    statement.setReadBigInts(true);

    const rows = statement.all() as ChromiumHistoryQueryRow[];
    const importedRows: ImportedHistoryRow[] = [];

    for (const row of rows) {
      const url = typeof row.url === "string" ? row.url.trim() : "";
      if (!url || !isTrackableHistoryUrl(url)) {
        continue;
      }

      const lastVisitedAt = chromiumTimeToUnixMs(row.last_visit_time);
      const visitCount = normalizeVisitCount(row.visit_count);
      const title = typeof row.title === "string" && row.title.trim()
        ? row.title.trim()
        : inferHistoryTitle(url);

      importedRows.push({
        title,
        url,
        lastVisitedAt: lastVisitedAt || Date.now(),
        visitCount,
      });
    }

    return importedRows;
  } catch {
    throw new Error("Failed to read the selected browser history database.");
  } finally {
    try {
      database?.close();
    } catch {
      // Ignore close failures for the temp snapshot.
    }
    cleanup();
  }
}

function normalizeImportSourceStats(input: HistoryRecord["importSourceStats"]) {
  if (!Array.isArray(input)) {
    return [] as HistoryImportSourceStat[];
  }

  const statsBySourceId = new Map<string, HistoryImportSourceStat>();
  for (const entry of input) {
    if (!entry || typeof entry !== "object" || typeof entry.sourceId !== "string") {
      continue;
    }

    const nextVisitCount = Math.max(1, Number(entry.visitCount || 0));
    const nextLastVisitedAt = Number.isFinite(entry.lastVisitedAt)
      ? Number(entry.lastVisitedAt)
      : 0;
    const existing = statsBySourceId.get(entry.sourceId);

    statsBySourceId.set(entry.sourceId, {
      sourceId: entry.sourceId,
      visitCount: Math.max(existing?.visitCount ?? 0, nextVisitCount),
      lastVisitedAt: Math.max(existing?.lastVisitedAt ?? 0, nextLastVisitedAt),
    });
  }

  return [...statsBySourceId.values()].sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

function sumImportedVisitCounts(stats: HistoryImportSourceStat[]) {
  return stats.reduce((total, entry) => total + Math.max(1, Number(entry.visitCount || 0)), 0);
}

function areImportStatsEqual(left: HistoryImportSourceStat[], right: HistoryImportSourceStat[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => {
    const other = right[index];
    return !!other
      && other.sourceId === entry.sourceId
      && other.visitCount === entry.visitCount
      && other.lastVisitedAt === entry.lastVisitedAt;
  });
}

function chooseHistoryTitle(existing: HistoryRecord, imported: ImportedHistoryRow) {
  const existingTitle = String(existing.title || "").trim();
  if (!existingTitle) {
    return imported.title;
  }

  const fallbackTitle = inferHistoryTitle(existing.url);
  if (existingTitle === fallbackTitle && imported.title.trim()) {
    return imported.title.trim();
  }

  return existingTitle;
}

function mergeImportedHistoryRecord(
  existing: HistoryRecord,
  imported: ImportedHistoryRow,
  sourceId: string,
) {
  const currentStats = normalizeImportSourceStats(existing.importSourceStats);
  const manualVisitCount = Math.max(
    0,
    Math.max(1, Number(existing.visitCount || 0)) - sumImportedVisitCounts(currentStats),
  );

  const statsBySourceId = new Map(currentStats.map((entry) => [entry.sourceId, entry]));
  const previousSourceStat = statsBySourceId.get(sourceId);
  statsBySourceId.set(sourceId, {
    sourceId,
    visitCount: Math.max(previousSourceStat?.visitCount ?? 0, imported.visitCount),
    lastVisitedAt: Math.max(previousSourceStat?.lastVisitedAt ?? 0, imported.lastVisitedAt),
  });

  const nextStats = [...statsBySourceId.values()].sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  const nextVisitCount = Math.max(1, manualVisitCount + sumImportedVisitCounts(nextStats));
  const nextLastVisitedAt = Math.max(existing.lastVisitedAt || 0, imported.lastVisitedAt);
  const nextCreatedAt = imported.lastVisitedAt > 0
    ? Math.min(existing.createdAt || imported.lastVisitedAt, imported.lastVisitedAt)
    : existing.createdAt;
  const nextUpdatedAt = Math.max(existing.updatedAt || 0, nextLastVisitedAt);
  const nextTitle = chooseHistoryTitle(existing, imported);
  const nextRecord: HistoryRecord = {
    ...existing,
    title: nextTitle,
    createdAt: nextCreatedAt,
    updatedAt: nextUpdatedAt,
    lastVisitedAt: nextLastVisitedAt,
    visitCount: nextVisitCount,
    importSourceStats: nextStats,
  };

  const changed = nextRecord.title !== existing.title
    || nextRecord.createdAt !== existing.createdAt
    || nextRecord.updatedAt !== existing.updatedAt
    || nextRecord.lastVisitedAt !== existing.lastVisitedAt
    || nextRecord.visitCount !== existing.visitCount
    || !areImportStatsEqual(nextStats, currentStats);

  return {
    changed,
    record: nextRecord,
  };
}

export function listHistoryImportSources() {
  return listChromiumProfileFileSources("History").map((source) => ({
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
    format: "chromium-sqlite" as const,
  }));
}

export function importHistoryFromSource(
  sourceId: string,
  currentRecords: HistoryRecord[],
) {
  const source = decodeImportSourceId(sourceId);
  if (!source) {
    throw new Error("Unsupported history import source.");
  }

  if (!existsSync(source.historyPath)) {
    throw new Error("The selected browser profile no longer has a readable history database.");
  }

  const rows = readChromiumHistoryRows(source.historyPath);
  const nextRecords = [...currentRecords];
  const recordIndexByUrl = new Map<string, number>();
  nextRecords.forEach((record, index) => {
    recordIndexByUrl.set(record.url, index);
  });

  let importedRecords = 0;
  let mergedRecords = 0;
  let skippedRecords = 0;

  for (const row of rows) {
    const existingIndex = recordIndexByUrl.get(row.url);
    if (existingIndex == null) {
      nextRecords.push({
        id: randomUUID(),
        title: row.title,
        url: row.url,
        createdAt: row.lastVisitedAt,
        updatedAt: row.lastVisitedAt,
        lastVisitedAt: row.lastVisitedAt,
        visitCount: row.visitCount,
        importSourceStats: [
          {
            sourceId,
            visitCount: row.visitCount,
            lastVisitedAt: row.lastVisitedAt,
          },
        ],
      });
      recordIndexByUrl.set(row.url, nextRecords.length - 1);
      importedRecords += 1;
      continue;
    }

    const merged = mergeImportedHistoryRecord(nextRecords[existingIndex], row, sourceId);
    if (!merged.changed) {
      skippedRecords += 1;
      continue;
    }

    nextRecords[existingIndex] = merged.record;
    mergedRecords += 1;
  }

  return {
    records: nextRecords,
    importedRecords,
    mergedRecords,
    skippedRecords,
    sourceLabel: buildChromiumSourceLabel(source.browserName, source.profileName),
  } satisfies HistoryImportResult;
}
