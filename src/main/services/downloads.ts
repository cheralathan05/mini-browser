import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdir, open as openFile } from "node:fs/promises";
import path from "node:path";
import { app, session, shell, type DownloadItem, type Session } from "electron";

export type DownloadStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "canceled";

export interface DownloadSegmentRecord {
  index: number;
  start: number;
  end: number;
  receivedBytes: number;
  tempPath: string;
}

export interface DownloadRecord {
  id: string;
  source: "manual" | "browser";
  url: string;
  finalUrl: string;
  sourcePageUrl?: string;
  partition?: string;
  headers: Record<string, string>;
  filename: string;
  directory: string;
  targetPath: string;
  targetPathLocked: boolean;
  tempDirectory: string;
  mimeType?: string;
  status: DownloadStatus;
  threadCount: number;
  supportsRanges: boolean;
  totalBytes: number | null;
  receivedBytes: number;
  speedBytesPerSecond: number;
  fileExists: boolean;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
  etag?: string;
  lastModified?: string;
  segments: DownloadSegmentRecord[];
}

interface DownloadStoragePayload {
  version: number;
  records: DownloadRecord[];
}

export interface DownloadCreateInput {
  url: string;
  source?: "manual" | "browser";
  sourcePageUrl?: string;
  partition?: string;
  headers?: Record<string, string>;
  filename?: string;
  directory?: string;
  targetPath?: string;
  threadCount?: number;
  mimeType?: string;
  totalBytes?: number | null;
  finalUrl?: string;
}

export interface BrowserDownloadCreateInput {
  item: DownloadItem;
  partition?: string;
  sourcePageUrl?: string;
  headers?: Record<string, string>;
  defaults?: {
    directory?: string;
    threadCount?: number;
    headers?: Record<string, string>;
  };
}

interface CreateDownloadManagerOptions {
  storagePath: string;
  tempRootPath: string;
  defaultDownloadsPath?: string;
  fallbackUserAgent: string;
  onChange?: () => void;
}

interface DownloadRuntime {
  controller: AbortController;
  intent: "running" | "pausing" | "canceling";
  lastSpeedSampleAt: number;
  lastSpeedSampleBytes: number;
}

class RangeNotSupportedError extends Error {
  constructor() {
    super("The remote server did not honor byte range requests.");
    this.name = "RangeNotSupportedError";
  }
}

function normalizeHeaderEntries(input?: Record<string, string>) {
  if (!input || typeof input !== "object") {
    return {} as Record<string, string>;
  }

  const normalized: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = String(rawKey || "").trim();
    const value = String(rawValue ?? "").trim();
    if (!key || !value || key.toLowerCase() === "range") {
      continue;
    }
    normalized[key] = value;
  }
  return normalized;
}

function hasHeader(headers: Record<string, string>, key: string) {
  const normalizedKey = key.toLowerCase();
  return Object.keys(headers).some((header) => header.toLowerCase() === normalizedKey);
}

function setHeader(headers: Record<string, string>, key: string, value: string) {
  const normalizedKey = key.toLowerCase();
  for (const header of Object.keys(headers)) {
    if (header.toLowerCase() === normalizedKey) {
      delete headers[header];
    }
  }
  headers[key] = value;
}

function sanitizeFilename(value: string) {
  const normalized = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "");
  return normalized || "download";
}

function inferFilenameFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const candidate = decodeURIComponent(parsed.pathname.split("/").pop() ?? "").trim();
    if (!candidate) {
      return "download";
    }
    return sanitizeFilename(candidate);
  } catch {
    return "download";
  }
}

function parseContentDispositionFilename(contentDisposition?: string | null) {
  if (!contentDisposition) {
    return null;
  }

  const filenameStar = contentDisposition.match(/filename\*\s*=\s*(?:UTF-8''|)([^;]+)/i);
  if (filenameStar?.[1]) {
    const value = filenameStar[1].trim().replace(/^"(.*)"$/, "$1");
    try {
      return sanitizeFilename(decodeURIComponent(value));
    } catch {
      return sanitizeFilename(value);
    }
  }

  const filename = contentDisposition.match(/filename\s*=\s*([^;]+)/i);
  if (!filename?.[1]) {
    return null;
  }

  return sanitizeFilename(filename[1].trim().replace(/^"(.*)"$/, "$1"));
}

function parseContentLength(value?: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseContentRangeTotal(value?: string | null) {
  if (!value) {
    return null;
  }

  const match = value.match(/\/(\d+|\*)$/);
  if (!match || match[1] === "*") {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function clampThreadCount(value?: number) {
  if (!Number.isFinite(value)) {
    return 4;
  }

  return Math.min(16, Math.max(1, Math.floor(Number(value))));
}

function cloneSegment(segment: DownloadSegmentRecord): DownloadSegmentRecord {
  return {
    index: segment.index,
    start: segment.start,
    end: segment.end,
    receivedBytes: segment.receivedBytes,
    tempPath: segment.tempPath,
  };
}

function cloneRecord(record: DownloadRecord): DownloadRecord {
  return {
    ...record,
    headers: { ...record.headers },
    segments: record.segments.map(cloneSegment),
  };
}

function ensureDirectory(filePath: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function ensureUniquePath(targetPath: string) {
  if (!existsSync(targetPath)) {
    return targetPath;
  }

  const directory = path.dirname(targetPath);
  const extension = path.extname(targetPath);
  const baseName = path.basename(targetPath, extension);
  let index = 1;
  while (true) {
    const candidate = path.join(directory, `${baseName} (${index})${extension}`);
    if (!existsSync(candidate)) {
      return candidate;
    }
    index += 1;
  }
}

function buildOriginHeader(sourcePageUrl?: string) {
  if (!sourcePageUrl) {
    return undefined;
  }

  try {
    const parsed = new URL(sourcePageUrl);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.origin;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.message === "The operation was aborted.");
}

function abortIfNeeded(signal: AbortSignal) {
  if (typeof signal.throwIfAborted === "function") {
    signal.throwIfAborted();
    return;
  }

  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The operation was aborted.", "AbortError");
  }
}

function buildSegments(record: DownloadRecord, segmentCount: number) {
  if (record.totalBytes === null || record.totalBytes <= 0) {
    return [] as DownloadSegmentRecord[];
  }

  const actualCount = Math.max(1, Math.min(segmentCount, record.totalBytes));
  const chunkSize = Math.ceil(record.totalBytes / actualCount);
  const segments: DownloadSegmentRecord[] = [];

  for (let index = 0; index < actualCount; index += 1) {
    const start = index * chunkSize;
    const end = Math.min(record.totalBytes - 1, start + chunkSize - 1);
    if (start > end) {
      continue;
    }

    segments.push({
      index,
      start,
      end,
      receivedBytes: 0,
      tempPath: path.join(record.tempDirectory, `part-${index}.bin`),
    });
  }

  return segments;
}

function sumReceivedBytes(segments: DownloadSegmentRecord[]) {
  return segments.reduce((total, segment) => total + Math.max(0, segment.receivedBytes), 0);
}

async function writeResponseBodyToFile(
  response: Response,
  filePath: string,
  signal: AbortSignal,
  onChunk: (chunkSize: number) => void,
  append = false,
) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Response body is unavailable.");
  }

  ensureDirectory(filePath);
  const handle = await openFile(filePath, append ? "a" : "w");

  try {
    while (true) {
      abortIfNeeded(signal);
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (!value || value.byteLength === 0) {
        continue;
      }

      const chunk = Buffer.from(value);
      await handle.writeFile(chunk);
      onChunk(chunk.byteLength);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore reader release failures while aborting.
    }
    await handle.close();
  }
}

async function mergeSegmentFiles(record: DownloadRecord) {
  const mergedPath = path.join(record.tempDirectory, "merged.bin");
  ensureDirectory(mergedPath);
  const targetHandle = await openFile(mergedPath, "w");

  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (const segment of record.segments.slice().sort((left, right) => left.index - right.index)) {
      const sourceHandle = await openFile(segment.tempPath, "r");
      try {
        while (true) {
          const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.length, null);
          if (bytesRead <= 0) {
            break;
          }
          await targetHandle.writeFile(buffer.subarray(0, bytesRead));
        }
      } finally {
        await sourceHandle.close();
      }
    }
  } finally {
    await targetHandle.close();
  }

  return mergedPath;
}

async function removePathIfExists(targetPath: string) {
  try {
    if (existsSync(targetPath)) {
      rmSync(targetPath, { recursive: true, force: true });
    }
  } catch {
    // Ignore best-effort cleanup failures.
  }
}

function sanitizeSegmentRecords(input: unknown) {
  if (!Array.isArray(input)) {
    return [] as DownloadSegmentRecord[];
  }

  return input.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const maybeSegment = entry as Partial<DownloadSegmentRecord>;
    const start = Number(maybeSegment.start);
    const end = Number(maybeSegment.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
      return [];
    }

    return [{
      index: Number.isFinite(maybeSegment.index) ? Number(maybeSegment.index) : index,
      start,
      end,
      receivedBytes: Number.isFinite(maybeSegment.receivedBytes)
        ? Math.max(0, Math.min(Number(maybeSegment.receivedBytes), end - start + 1))
        : 0,
      tempPath: typeof maybeSegment.tempPath === "string" && maybeSegment.tempPath.trim()
        ? maybeSegment.tempPath
        : "",
    }] satisfies DownloadSegmentRecord[];
  });
}

function sanitizeDownloadRecords(input: unknown) {
  if (!Array.isArray(input)) {
    return [] as DownloadRecord[];
  }

  return input.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const maybeRecord = entry as Partial<DownloadRecord>;
    if (
      typeof maybeRecord.id !== "string"
      || typeof maybeRecord.url !== "string"
      || typeof maybeRecord.filename !== "string"
      || typeof maybeRecord.directory !== "string"
      || typeof maybeRecord.targetPath !== "string"
      || typeof maybeRecord.tempDirectory !== "string"
    ) {
      return [];
    }

    const status: DownloadStatus =
      maybeRecord.status === "running"
      || maybeRecord.status === "completed"
      || maybeRecord.status === "paused"
      || maybeRecord.status === "failed"
      || maybeRecord.status === "canceled"
      ? maybeRecord.status
      : "pending";

    const segments = sanitizeSegmentRecords(maybeRecord.segments)
      .filter((segment) => segment.tempPath);

    const record: DownloadRecord = {
      id: maybeRecord.id,
      source: maybeRecord.source === "browser" ? "browser" : "manual",
      url: maybeRecord.url,
      finalUrl: typeof maybeRecord.finalUrl === "string" && maybeRecord.finalUrl.trim()
        ? maybeRecord.finalUrl
        : maybeRecord.url,
      sourcePageUrl: typeof maybeRecord.sourcePageUrl === "string" ? maybeRecord.sourcePageUrl : undefined,
      partition: typeof maybeRecord.partition === "string" ? maybeRecord.partition : undefined,
      headers: normalizeHeaderEntries(maybeRecord.headers),
      filename: sanitizeFilename(maybeRecord.filename),
      directory: maybeRecord.directory,
      targetPath: maybeRecord.targetPath,
      targetPathLocked: Boolean(maybeRecord.targetPathLocked),
      tempDirectory: maybeRecord.tempDirectory,
      mimeType: typeof maybeRecord.mimeType === "string" ? maybeRecord.mimeType : undefined,
      status,
      threadCount: clampThreadCount(maybeRecord.threadCount),
      supportsRanges: Boolean(maybeRecord.supportsRanges),
      totalBytes: Number.isFinite(maybeRecord.totalBytes) ? Math.max(0, Number(maybeRecord.totalBytes)) : null,
      receivedBytes: Number.isFinite(maybeRecord.receivedBytes) ? Math.max(0, Number(maybeRecord.receivedBytes)) : 0,
      speedBytesPerSecond: Number.isFinite(maybeRecord.speedBytesPerSecond)
        ? Math.max(0, Number(maybeRecord.speedBytesPerSecond))
        : 0,
      fileExists: Boolean(maybeRecord.fileExists),
      createdAt: Number.isFinite(maybeRecord.createdAt) ? Number(maybeRecord.createdAt) : Date.now(),
      updatedAt: Number.isFinite(maybeRecord.updatedAt) ? Number(maybeRecord.updatedAt) : Date.now(),
      completedAt: Number.isFinite(maybeRecord.completedAt) ? Number(maybeRecord.completedAt) : undefined,
      error: typeof maybeRecord.error === "string" ? maybeRecord.error : undefined,
      etag: typeof maybeRecord.etag === "string" ? maybeRecord.etag : undefined,
      lastModified: typeof maybeRecord.lastModified === "string" ? maybeRecord.lastModified : undefined,
      segments,
    };

    return [record];
  });
}

export function createDownloadManager(options: CreateDownloadManagerOptions) {
  const records: DownloadRecord[] = [];
  const activeDownloads = new Map<string, DownloadRuntime>();
  let flushTimer: NodeJS.Timeout | null = null;

  const defaultDownloadsPath = options.defaultDownloadsPath || app.getPath("downloads");
  const emitChange = () => {
    options.onChange?.();
  };

  function scheduleFlush() {
    if (flushTimer) {
      return;
    }

    flushTimer = setTimeout(() => {
      flushTimer = null;
      save();
      emitChange();
    }, 140);
  }

  function flushNow() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    save();
    emitChange();
  }

  function findRecord(id: string) {
    return records.find((record) => record.id === id);
  }

  function requireRecord(id: string) {
    const record = findRecord(id);
    if (!record) {
      throw new Error("Download record not found.");
    }
    return record;
  }

  function getSessionForPartition(partition?: string) {
    return partition ? session.fromPartition(partition) : session.defaultSession;
  }

  function buildRequestHeaders(record: DownloadRecord) {
    const headers = normalizeHeaderEntries(record.headers);
    if (!hasHeader(headers, "User-Agent")) {
      setHeader(headers, "User-Agent", options.fallbackUserAgent);
    }
    if (record.sourcePageUrl && !hasHeader(headers, "Referer")) {
      setHeader(headers, "Referer", record.sourcePageUrl);
    }
    if (record.sourcePageUrl && !hasHeader(headers, "Origin")) {
      const origin = buildOriginHeader(record.sourcePageUrl);
      if (origin) {
        setHeader(headers, "Origin", origin);
      }
    }
    if (!hasHeader(headers, "Accept")) {
      setHeader(headers, "Accept", "*/*");
    }
    return headers;
  }

  function updateRecordProgress(record: DownloadRecord, runtime: DownloadRuntime) {
    record.receivedBytes = sumReceivedBytes(record.segments);
    record.updatedAt = Date.now();

    const now = record.updatedAt;
    const elapsed = now - runtime.lastSpeedSampleAt;
    if (elapsed >= 600) {
      const deltaBytes = record.receivedBytes - runtime.lastSpeedSampleBytes;
      record.speedBytesPerSecond = elapsed > 0
        ? Math.max(0, Math.round(deltaBytes * 1000 / elapsed))
        : 0;
      runtime.lastSpeedSampleAt = now;
      runtime.lastSpeedSampleBytes = record.receivedBytes;
    }

    scheduleFlush();
  }

  function reconcileSegmentProgress(record: DownloadRecord) {
    record.receivedBytes = 0;
    for (const segment of record.segments) {
      if (!segment.tempPath || !existsSync(segment.tempPath)) {
        segment.receivedBytes = 0;
        continue;
      }

      try {
        const size = statSync(segment.tempPath).size;
        const segmentLength = segment.end - segment.start + 1;
        segment.receivedBytes = Math.min(size, segmentLength);
      } catch {
        segment.receivedBytes = 0;
      }

      record.receivedBytes += segment.receivedBytes;
    }
    record.fileExists = existsSync(record.targetPath);
  }

  async function cleanupTempArtifacts(record: DownloadRecord) {
    await removePathIfExists(record.tempDirectory);
    for (const segment of record.segments) {
      segment.receivedBytes = 0;
    }
    record.receivedBytes = 0;
  }

  async function fetchMetadata(
    targetSession: Session,
    record: DownloadRecord,
    signal: AbortSignal,
  ) {
    const headers = new Headers(buildRequestHeaders(record));
    try {
      const response = await targetSession.fetch(record.finalUrl || record.url, {
        method: "HEAD",
        headers,
        redirect: "follow",
        signal,
      });

      if (!response.ok) {
        return;
      }

      const suggestedFilename =
        parseContentDispositionFilename(response.headers.get("content-disposition"))
        || sanitizeFilename(record.filename || inferFilenameFromUrl(record.url));
      if (!record.targetPathLocked && suggestedFilename && suggestedFilename !== record.filename) {
        record.filename = suggestedFilename;
        const nextTargetPath = ensureUniquePath(path.join(record.directory, record.filename));
        record.targetPath = nextTargetPath;
      }

      record.mimeType = record.mimeType || response.headers.get("content-type") || undefined;
      record.totalBytes = parseContentLength(response.headers.get("content-length")) ?? record.totalBytes;
      record.supportsRanges = /\bbytes\b/i.test(response.headers.get("accept-ranges") ?? "");
      record.etag = response.headers.get("etag") || record.etag;
      record.lastModified = response.headers.get("last-modified") || record.lastModified;
      record.updatedAt = Date.now();
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
    }
  }

  function ensureRecordSegments(record: DownloadRecord) {
    if (record.totalBytes !== null && record.supportsRanges && record.threadCount > 1) {
      const desiredSegments = buildSegments(record, record.threadCount);
      if (
        record.segments.length !== desiredSegments.length
        || record.segments.some((segment, index) =>
          segment.start !== desiredSegments[index]?.start
          || segment.end !== desiredSegments[index]?.end
          || segment.tempPath !== desiredSegments[index]?.tempPath)
      ) {
        record.segments = desiredSegments;
      }
      return;
    }

    const segmentEnd = record.totalBytes !== null && record.totalBytes > 0
      ? record.totalBytes - 1
      : 0;
    const singlePath = path.join(record.tempDirectory, "part-0.bin");
    if (record.segments.length !== 1 || record.segments[0]?.tempPath !== singlePath) {
      record.segments = [{
        index: 0,
        start: 0,
        end: segmentEnd,
        receivedBytes: 0,
        tempPath: singlePath,
      }];
      return;
    }

    record.segments[0].start = 0;
    record.segments[0].end = segmentEnd;
  }

  async function downloadSingle(
    targetSession: Session,
    record: DownloadRecord,
    runtime: DownloadRuntime,
  ) {
    ensureRecordSegments(record);
    let append = false;
    const headers = new Headers(buildRequestHeaders(record));
    let segment = record.segments[0];

    if (record.supportsRanges && record.totalBytes !== null && segment.receivedBytes > 0) {
      headers.set("Range", `bytes=${segment.start + segment.receivedBytes}-`);
      append = true;
    } else if (segment.receivedBytes > 0) {
      await cleanupTempArtifacts(record);
      ensureRecordSegments(record);
      segment = record.segments[0];
    }

    abortIfNeeded(runtime.controller.signal);
    const response = await targetSession.fetch(record.finalUrl || record.url, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: runtime.controller.signal,
    });

    if (!response.ok && response.status !== 206) {
      throw new Error(`Download request failed with status ${response.status}.`);
    }

    if (headers.has("Range") && response.status !== 206) {
      throw new RangeNotSupportedError();
    }

    const suggestedFilename =
      parseContentDispositionFilename(response.headers.get("content-disposition"))
      || sanitizeFilename(record.filename || inferFilenameFromUrl(record.url));
    if (!record.targetPathLocked && suggestedFilename && suggestedFilename !== record.filename) {
      record.filename = suggestedFilename;
      record.targetPath = ensureUniquePath(path.join(record.directory, record.filename));
    }

    record.mimeType = record.mimeType || response.headers.get("content-type") || undefined;
    record.supportsRanges = record.supportsRanges || response.status === 206;
    record.totalBytes =
      parseContentRangeTotal(response.headers.get("content-range"))
      ?? parseContentLength(response.headers.get("content-length"))
      ?? record.totalBytes;
    if (record.totalBytes !== null) {
      record.segments[0].end = Math.max(0, record.totalBytes - 1);
    }

    await writeResponseBodyToFile(
      response,
      segment.tempPath,
      runtime.controller.signal,
      (chunkSize) => {
        segment.receivedBytes += chunkSize;
        updateRecordProgress(record, runtime);
      },
      append,
    );
  }

  async function downloadSegment(
    targetSession: Session,
    record: DownloadRecord,
    segment: DownloadSegmentRecord,
    runtime: DownloadRuntime,
  ) {
    if (segment.receivedBytes >= segment.end - segment.start + 1) {
      return;
    }

    const rangeStart = segment.start + segment.receivedBytes;
    const headers = new Headers(buildRequestHeaders(record));
    headers.set("Range", `bytes=${rangeStart}-${segment.end}`);

    abortIfNeeded(runtime.controller.signal);
    const response = await targetSession.fetch(record.finalUrl || record.url, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: runtime.controller.signal,
    });

    if (response.status !== 206) {
      throw new RangeNotSupportedError();
    }

    await writeResponseBodyToFile(
      response,
      segment.tempPath,
      runtime.controller.signal,
      (chunkSize) => {
        segment.receivedBytes += chunkSize;
        updateRecordProgress(record, runtime);
      },
      segment.receivedBytes > 0,
    );
  }

  async function finalizeDownload(record: DownloadRecord) {
    await mkdir(record.directory, { recursive: true });

    let sourcePath = record.segments[0]?.tempPath || "";
    if (record.segments.length > 1) {
      sourcePath = await mergeSegmentFiles(record);
    }

    if (!sourcePath || !existsSync(sourcePath)) {
      throw new Error("Downloaded file is missing from the temporary directory.");
    }

    const resolvedTargetPath =
      existsSync(record.targetPath) && !record.fileExists
        ? ensureUniquePath(record.targetPath)
        : record.targetPath;
    record.targetPath = resolvedTargetPath;

    ensureDirectory(record.targetPath);
    renameSync(sourcePath, record.targetPath);
    await cleanupTempArtifacts(record);
    record.fileExists = true;
    record.status = "completed";
    record.completedAt = Date.now();
    record.updatedAt = record.completedAt;
    record.speedBytesPerSecond = 0;
    if (record.totalBytes === null) {
      try {
        record.totalBytes = statSync(record.targetPath).size;
      } catch {
        record.totalBytes = record.receivedBytes;
      }
    }
    record.receivedBytes = record.totalBytes ?? record.receivedBytes;
  }

  async function startDownload(id: string) {
    const record = requireRecord(id);
    if (activeDownloads.has(id) || record.status === "completed") {
      return cloneRecord(record);
    }

    reconcileSegmentProgress(record);
    ensureRecordSegments(record);
    ensureDirectory(path.join(record.tempDirectory, "placeholder"));

    const runtime: DownloadRuntime = {
      controller: new AbortController(),
      intent: "running",
      lastSpeedSampleAt: Date.now(),
      lastSpeedSampleBytes: record.receivedBytes,
    };

    activeDownloads.set(id, runtime);
    record.status = "running";
    record.error = undefined;
    record.fileExists = existsSync(record.targetPath);
    record.speedBytesPerSecond = 0;
    record.updatedAt = Date.now();
    scheduleFlush();

    const targetSession = getSessionForPartition(record.partition);

    try {
      await fetchMetadata(targetSession, record, runtime.controller.signal);
      reconcileSegmentProgress(record);
      ensureRecordSegments(record);

      if (record.supportsRanges && record.totalBytes !== null && record.threadCount > 1) {
        await Promise.all(record.segments.map((segment) =>
          downloadSegment(targetSession, record, segment, runtime)
        ));
      } else {
        await downloadSingle(targetSession, record, runtime);
      }

      await finalizeDownload(record);
      flushNow();
      return cloneRecord(record);
    } catch (error) {
      if (error instanceof RangeNotSupportedError) {
        await cleanupTempArtifacts(record);
        record.supportsRanges = false;
        ensureRecordSegments(record);
        runtime.lastSpeedSampleAt = Date.now();
        runtime.lastSpeedSampleBytes = 0;
        try {
          await downloadSingle(targetSession, record, runtime);
          await finalizeDownload(record);
          flushNow();
          return cloneRecord(record);
        } catch (retryError) {
          error = retryError;
        }
      }

      if (isAbortError(error)) {
        record.speedBytesPerSecond = 0;
        record.updatedAt = Date.now();

        if (runtime.intent === "pausing") {
          record.status = "paused";
        } else {
          await cleanupTempArtifacts(record);
          record.status = "canceled";
        }

        flushNow();
        return cloneRecord(record);
      }

      record.status = "failed";
      record.speedBytesPerSecond = 0;
      record.error = error instanceof Error ? error.message : "Download failed.";
      record.updatedAt = Date.now();
      flushNow();
      return cloneRecord(record);
    } finally {
      activeDownloads.delete(id);
    }
  }

  function save() {
    const payload: DownloadStoragePayload = {
      version: 1,
      records: records.map(cloneRecord),
    };
    writeFileSync(options.storagePath, JSON.stringify(payload, null, 2), "utf-8");
  }

  function load() {
    mkdirSync(path.dirname(options.storagePath), { recursive: true });
    mkdirSync(options.tempRootPath, { recursive: true });

    let nextRecords: DownloadRecord[] = [];

    try {
      const raw = readFileSync(options.storagePath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      const payload = Array.isArray(parsed)
        ? { records: parsed }
        : parsed as Partial<DownloadStoragePayload>;
      nextRecords = sanitizeDownloadRecords(payload.records);
    } catch {
      nextRecords = [];
    }

    records.splice(0, records.length, ...nextRecords);

    for (const record of records) {
      reconcileSegmentProgress(record);
      record.fileExists = existsSync(record.targetPath);
      record.speedBytesPerSecond = 0;

      if (record.status === "running" || record.status === "pending") {
        record.status = record.receivedBytes > 0 ? "paused" : "canceled";
        record.error = record.receivedBytes > 0
          ? "Download was interrupted when the app closed."
          : record.error;
      }
    }

    flushNow();
  }

  function getRecords() {
    return records.map(cloneRecord);
  }

  async function create(input: DownloadCreateInput) {
    const rawUrl = String(input.url || "").trim();
    if (!rawUrl) {
      throw new Error("Download URL is required.");
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      throw new Error("Download URL is invalid.");
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("Only HTTP and HTTPS downloads are supported.");
    }

    const normalizedHeaders = normalizeHeaderEntries(input.headers);
    if (!hasHeader(normalizedHeaders, "User-Agent")) {
      setHeader(normalizedHeaders, "User-Agent", options.fallbackUserAgent);
    }
    if (input.sourcePageUrl && !hasHeader(normalizedHeaders, "Referer")) {
      setHeader(normalizedHeaders, "Referer", input.sourcePageUrl);
    }
    if (input.sourcePageUrl && !hasHeader(normalizedHeaders, "Origin")) {
      const origin = buildOriginHeader(input.sourcePageUrl);
      if (origin) {
        setHeader(normalizedHeaders, "Origin", origin);
      }
    }

    const explicitTargetPath = typeof input.targetPath === "string" && input.targetPath.trim()
      ? path.resolve(input.targetPath.trim())
      : "";
    const directory = explicitTargetPath
      ? path.dirname(explicitTargetPath)
      : path.resolve(
        (typeof input.directory === "string" && input.directory.trim())
          ? input.directory.trim()
          : defaultDownloadsPath,
      );
    const filename = sanitizeFilename(
      explicitTargetPath
        ? path.basename(explicitTargetPath)
        : (input.filename?.trim() || inferFilenameFromUrl(rawUrl)),
    );
    const targetPathLocked = Boolean(explicitTargetPath || input.filename?.trim());
    const targetPath = ensureUniquePath(
      explicitTargetPath || path.join(directory, filename),
    );
    const id = randomUUID();
    const tempDirectory = path.join(options.tempRootPath, id);
    const createdAt = Date.now();

    const record: DownloadRecord = {
      id,
      source: input.source === "browser" ? "browser" : "manual",
      url: rawUrl,
      finalUrl: input.finalUrl?.trim() || rawUrl,
      sourcePageUrl: input.sourcePageUrl?.trim() || undefined,
      partition: input.partition?.trim() || undefined,
      headers: normalizedHeaders,
      filename,
      directory,
      targetPath,
      targetPathLocked,
      tempDirectory,
      mimeType: input.mimeType?.trim() || undefined,
      status: "pending",
      threadCount: clampThreadCount(input.threadCount),
      supportsRanges: false,
      totalBytes: Number.isFinite(input.totalBytes) ? Math.max(0, Number(input.totalBytes)) : null,
      receivedBytes: 0,
      speedBytesPerSecond: 0,
      fileExists: false,
      createdAt,
      updatedAt: createdAt,
      segments: [],
    };

    ensureRecordSegments(record);
    records.unshift(record);
    flushNow();
    void startDownload(record.id).catch((error) => {
      console.error("[Download] Failed to start download.", error);
    });
    return cloneRecord(record);
  }

  async function createFromBrowserDownload(input: BrowserDownloadCreateInput) {
    const url = input.item.getURL();
    if (!url) {
      throw new Error("Browser download did not expose a valid URL.");
    }

    const headers = {
      ...normalizeHeaderEntries(input.headers),
      ...normalizeHeaderEntries(input.defaults?.headers),
    };
    if (input.sourcePageUrl && !hasHeader(headers, "Referer")) {
      setHeader(headers, "Referer", input.sourcePageUrl);
    }
    if (input.sourcePageUrl && !hasHeader(headers, "Origin")) {
      const origin = buildOriginHeader(input.sourcePageUrl);
      if (origin) {
        setHeader(headers, "Origin", origin);
      }
    }

    return create({
      url,
      source: "browser",
      sourcePageUrl: input.sourcePageUrl,
      partition: input.partition,
      headers,
      directory: input.defaults?.directory,
      filename: input.item.getFilename(),
      mimeType: input.item.getMimeType() || undefined,
      totalBytes: input.item.getTotalBytes(),
      finalUrl: input.item.getURLChain().slice(-1)[0] || url,
      threadCount: input.defaults?.threadCount,
    });
  }

  async function pause(id: string) {
    const record = requireRecord(id);
    const runtime = activeDownloads.get(id);
    if (!runtime) {
      if (record.status === "running" || record.status === "pending") {
        record.status = "paused";
        record.speedBytesPerSecond = 0;
        record.updatedAt = Date.now();
        flushNow();
      }
      return cloneRecord(record);
    }

    runtime.intent = "pausing";
    runtime.controller.abort(new DOMException("Paused", "AbortError"));
    return cloneRecord(record);
  }

  async function cancel(id: string) {
    const record = requireRecord(id);
    const runtime = activeDownloads.get(id);
    if (runtime) {
      runtime.intent = "canceling";
      runtime.controller.abort(new DOMException("Canceled", "AbortError"));
      return cloneRecord(record);
    }

    await cleanupTempArtifacts(record);
    record.status = "canceled";
    record.fileExists = existsSync(record.targetPath);
    record.speedBytesPerSecond = 0;
    record.updatedAt = Date.now();
    flushNow();
    return cloneRecord(record);
  }

  async function resume(id: string) {
    const record = requireRecord(id);
    if (record.status !== "paused") {
      return cloneRecord(record);
    }

    void startDownload(record.id).catch((error) => {
      console.error("[Download] Failed to resume download.", error);
    });
    return cloneRecord(record);
  }

  async function retry(id: string) {
    const record = requireRecord(id);
    await cancel(id);
    await cleanupTempArtifacts(record);
    record.status = "pending";
    record.error = undefined;
    record.completedAt = undefined;
    record.fileExists = existsSync(record.targetPath);
    record.updatedAt = Date.now();
    ensureRecordSegments(record);
    flushNow();
    void startDownload(record.id).catch((error) => {
      console.error("[Download] Failed to retry download.", error);
    });
    return cloneRecord(record);
  }

  async function removeRecord(id: string, options?: { deleteFile?: boolean }) {
    const record = requireRecord(id);
    await cancel(id);

    if (options?.deleteFile && existsSync(record.targetPath)) {
      unlinkSync(record.targetPath);
    }

    await cleanupTempArtifacts(record);
    const index = records.findIndex((entry) => entry.id === id);
    if (index >= 0) {
      records.splice(index, 1);
    }
    flushNow();
    return getRecords();
  }

  async function deleteFile(id: string) {
    const record = requireRecord(id);
    if (activeDownloads.has(id)) {
      await cancel(id);
    }

    if (existsSync(record.targetPath)) {
      unlinkSync(record.targetPath);
    }

    record.fileExists = existsSync(record.targetPath);
    record.updatedAt = Date.now();
    flushNow();
    return cloneRecord(record);
  }

  async function showInFolder(id: string) {
    const record = requireRecord(id);
    if (existsSync(record.targetPath)) {
      shell.showItemInFolder(record.targetPath);
      return record.targetPath;
    }

    const openError = await shell.openPath(record.directory);
    if (openError) {
      throw new Error(openError);
    }
    return record.directory;
  }

  async function pauseAll() {
    await Promise.all(Array.from(activeDownloads.keys()).map((id) => pause(id)));
    flushNow();
  }

  return {
    load,
    getRecords,
    create,
    createFromBrowserDownload,
    pause,
    cancel,
    resume,
    retry,
    removeRecord,
    deleteFile,
    showInFolder,
    pauseAll,
  };
}
