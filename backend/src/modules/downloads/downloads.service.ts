import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import { prisma } from "../../config/db.js";
import { AppError } from "../../middleware/error.js";

export interface ListDownloadsOptions {
  workspaceId?: string;
  search?: string;
  status?: string;
  type?: string;
  limit?: number;
  offset?: number;
}

export function inferCategoryFromExtension(ext?: string | null): "image" | "pdf" | "archive" | "code" | "file" {
  const cleanExt = (ext || "").toLowerCase().replace(/^\./, "");
  if (["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp", "ico", "avif"].includes(cleanExt)) return "image";
  if (["pdf", "epub", "doc", "docx", "txt", "md", "rtf", "odt"].includes(cleanExt)) return "pdf";
  if (["zip", "tar", "gz", "7z", "rar", "dmg", "exe", "msi", "iso", "pkg"].includes(cleanExt)) return "archive";
  if (["ts", "tsx", "js", "jsx", "py", "json", "html", "css", "rs", "go", "java", "c", "cpp", "xml", "yaml", "yml", "sh", "sql"].includes(cleanExt)) return "code";
  return "file";
}

export class DownloadsService {
  private getDefaultDownloadsDir(): string {
    return path.join(os.homedir(), "Downloads");
  }

  private isPathSafe(targetPath: string): boolean {
    const downloadsDir = path.resolve(this.getDefaultDownloadsDir());
    const resolved = path.resolve(targetPath);
    // Allow files in user's Downloads directory or in application appData/captures directory
    const isUnderDownloads = resolved.startsWith(downloadsDir);
    const isUnderApp = resolved.includes("Milo-main") || resolved.includes(".gemini");
    return isUnderDownloads || isUnderApp;
  }

  public async listDownloads(userId: string, options: ListDownloadsOptions = {}) {
    const where: any = { userId };
    if (options.workspaceId) {
      where.workspaceId = options.workspaceId;
    }
    if (options.status && options.status !== "all") {
      where.status = options.status;
    }
    if (options.search && options.search.trim()) {
      const q = options.search.trim();
      where.OR = [
        { filename: { contains: q, mode: "insensitive" } },
        { sourceUrl: { contains: q, mode: "insensitive" } },
        { sourceDomain: { contains: q, mode: "insensitive" } },
        { extension: { contains: q, mode: "insensitive" } },
      ];
    }

    const records = await prisma.downloadRecord.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: options.limit || 100,
      skip: options.offset || 0,
    });

    // If filter by type is requested
    let filteredRecords = records;
    if (options.type && options.type !== "all") {
      filteredRecords = records.filter((r) => inferCategoryFromExtension(r.extension) === options.type);
    }

    // Compute empirical stats over user's actual authorized records
    const allUserRecords = await prisma.downloadRecord.findMany({
      where: { userId },
      select: { status: true, downloadedSize: true, expectedSize: true },
    });

    const totalCount = allUserRecords.length;
    const completedCount = allUserRecords.filter((r) => r.status === "completed").length;
    const activeCount = allUserRecords.filter((r) => r.status === "in_progress").length;
    const pausedCount = allUserRecords.filter((r) => r.status === "paused").length;
    const failedCount = allUserRecords.filter((r) => r.status === "failed" || r.status === "cancelled").length;
    const totalBytes = allUserRecords.reduce((sum, r) => sum + (r.downloadedSize || r.expectedSize || 0), 0);

    return {
      downloads: filteredRecords,
      total: totalCount,
      completedCount,
      activeCount,
      pausedCount,
      failedCount,
      totalBytes,
      downloadsDirectory: this.getDefaultDownloadsDir(),
    };
  }

  public async getDownload(userId: string, id: string) {
    const record = await prisma.downloadRecord.findFirst({
      where: { id, userId },
    });
    if (!record) {
      throw new AppError("Download record not found", 404, "NOT_FOUND");
    }
    return record;
  }

  public async createDownload(
    userId: string,
    data: {
      filename: string;
      sourceUrl?: string;
      sourceDomain?: string;
      mimeType?: string;
      extension?: string;
      expectedSize?: number;
      downloadedSize?: number;
      status?: string;
      filePath?: string;
      workspaceId?: string;
      metadata?: any;
    }
  ) {
    let ext = data.extension;
    if (!ext && data.filename) {
      ext = path.extname(data.filename).toLowerCase().replace(/^\./, "");
    }

    let domain = data.sourceDomain;
    if (!domain && data.sourceUrl) {
      try {
        domain = new URL(data.sourceUrl).hostname;
      } catch {}
    }

    const record = await prisma.downloadRecord.create({
      data: {
        userId,
        workspaceId: data.workspaceId,
        filename: data.filename,
        sourceUrl: data.sourceUrl,
        sourceDomain: domain,
        mimeType: data.mimeType,
        extension: ext,
        expectedSize: data.expectedSize || 0,
        downloadedSize: data.downloadedSize || data.expectedSize || 0,
        status: data.status || "completed",
        filePath: data.filePath,
        completedAt: data.status === "completed" || !data.status ? new Date() : undefined,
        metadata: data.metadata || {},
      },
    });

    return record;
  }

  public async updateDownload(
    userId: string,
    id: string,
    data: {
      status?: string;
      downloadedSize?: number;
      expectedSize?: number;
      error?: string;
      filePath?: string;
    }
  ) {
    await this.getDownload(userId, id);

    const updated = await prisma.downloadRecord.update({
      where: { id },
      data: {
        status: data.status,
        downloadedSize: data.downloadedSize,
        expectedSize: data.expectedSize,
        error: data.error,
        filePath: data.filePath,
        completedAt: data.status === "completed" ? new Date() : undefined,
      },
    });

    return updated;
  }

  public async retryDownload(userId: string, id: string) {
    const record = await this.getDownload(userId, id);
    return prisma.downloadRecord.update({
      where: { id },
      data: {
        status: "in_progress",
        error: null,
      },
    });
  }

  public async cancelDownload(userId: string, id: string) {
    const record = await this.getDownload(userId, id);
    return prisma.downloadRecord.update({
      where: { id },
      data: {
        status: "cancelled",
      },
    });
  }

  public async deleteDownload(userId: string, id: string, deleteUnderlyingFile: boolean = false) {
    const record = await this.getDownload(userId, id);

    // If requested to delete underlying file, verify path safety
    if (deleteUnderlyingFile && record.filePath) {
      if (this.isPathSafe(record.filePath)) {
        try {
          await fs.unlink(record.filePath);
        } catch (err: any) {
          console.warn(`[DownloadsService] Could not unlink file ${record.filePath}:`, err?.message);
        }
      }
    }

    await prisma.downloadRecord.delete({ where: { id } });
    return { success: true, id };
  }

  public async getPreview(userId: string, id: string) {
    const record = await this.getDownload(userId, id);
    const category = inferCategoryFromExtension(record.extension);

    if (!record.filePath) {
      return {
        id: record.id,
        filename: record.filename,
        category,
        canPreview: false,
        message: "No local file path recorded for this download",
      };
    }

    if (!this.isPathSafe(record.filePath)) {
      throw new AppError("Access to requested file path is restricted", 403, "FORBIDDEN");
    }

    try {
      const stat = await fs.stat(record.filePath);
      const MAX_PREVIEW_BYTES = 2 * 1024 * 1024; // 2MB

      if (category === "code" || category === "pdf" && (record.extension === "txt" || record.extension === "md" || record.extension === "json")) {
        if (stat.size > MAX_PREVIEW_BYTES) {
          const buffer = Buffer.alloc(10000);
          const fh = await fs.open(record.filePath, "r");
          await fh.read(buffer, 0, 10000, 0);
          await fh.close();
          return {
            id: record.id,
            filename: record.filename,
            category: "code",
            canPreview: true,
            truncated: true,
            content: buffer.toString("utf-8"),
            fileSize: stat.size,
          };
        }
        const content = await fs.readFile(record.filePath, "utf-8");
        return {
          id: record.id,
          filename: record.filename,
          category: "code",
          canPreview: true,
          truncated: false,
          content,
          fileSize: stat.size,
        };
      }

      if (category === "image") {
        const imageBuffer = await fs.readFile(record.filePath);
        const mime = record.mimeType || `image/${record.extension || "png"}`;
        const base64Data = `data:${mime};base64,${imageBuffer.toString("base64")}`;
        return {
          id: record.id,
          filename: record.filename,
          category: "image",
          canPreview: true,
          imageData: base64Data,
          fileSize: stat.size,
        };
      }

      return {
        id: record.id,
        filename: record.filename,
        category,
        canPreview: false,
        fileSize: stat.size,
        message: `Direct preview not supported for .${record.extension} files. Open using system viewer.`,
      };
    } catch (err: any) {
      return {
        id: record.id,
        filename: record.filename,
        category,
        canPreview: false,
        error: err.message,
      };
    }
  }

  public async findDuplicates(userId: string) {
    const records = await prisma.downloadRecord.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    const sizeMap = new Map<number, typeof records>();
    for (const r of records) {
      const size = r.downloadedSize || r.expectedSize;
      if (size && size > 1024) {
        if (!sizeMap.has(size)) sizeMap.set(size, []);
        sizeMap.get(size)!.push(r);
      }
    }

    const duplicates: Array<{ size: number; files: typeof records }> = [];
    for (const [size, list] of sizeMap.entries()) {
      if (list.length > 1) {
        duplicates.push({ size, files: list });
      }
    }

    return duplicates;
  }
}

export const downloadsService = new DownloadsService();
