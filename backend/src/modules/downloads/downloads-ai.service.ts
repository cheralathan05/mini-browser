import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { prisma } from "../../config/db.js";
import { AIProviderFactory } from "../../ai/provider-factory.js";
import { downloadsService, inferCategoryFromExtension } from "./downloads.service.js";
import { AppError } from "../../middleware/error.js";

export interface DownloadsAiRequest {
  query: string;
  action?: "summarize" | "explain" | "group" | "find" | "cleanup" | "organize";
  downloadIds?: string[];
  workspaceId?: string;
}

export class DownloadsAiService {
  private sanitizeFolderName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_\-\s]/g, "").trim().slice(0, 50) || "Organized";
  }

  public async askAssistant(userId: string, request: DownloadsAiRequest) {
    // 1. Fetch relevant authorized download records for this user
    let records = await prisma.downloadRecord.findMany({
      where: {
        userId,
        ...(request.downloadIds && request.downloadIds.length > 0
          ? { id: { in: request.downloadIds } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 40,
    });

    if (records.length === 0 && (!request.downloadIds || request.downloadIds.length === 0)) {
      records = await prisma.downloadRecord.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 40,
      });
    }

    // 2. Build metadata manifest
    const manifest = records.map((r, i) => {
      const cat = inferCategoryFromExtension(r.extension);
      const sizeMb = ((r.downloadedSize || r.expectedSize || 0) / (1024 * 1024)).toFixed(2);
      return `[File ${i + 1}] ID: ${r.id} | Name: "${r.filename}" | Type: ${cat} (.${r.extension || "bin"}) | Size: ${sizeMb} MB | Source: ${r.sourceDomain || "local"} | Status: ${r.status}`;
    }).join("\n");

    // 3. For "explain" or "summarize" on a single file, retrieve safe snippet if available
    let contentSnippet = "";
    if (request.downloadIds && request.downloadIds.length === 1) {
      try {
        const preview = await downloadsService.getPreview(userId, request.downloadIds[0]);
        if (preview.canPreview && preview.content) {
          contentSnippet = `\n\nFile Content Excerpt (first 2,000 characters):\n"""\n${preview.content.slice(0, 2000)}\n"""`;
        }
      } catch {}
    }

    // 4. Construct AI prompt grounded strictly in actual authorized records
    const systemPrompt = `You are the NEXUS AI Downloads & File Intelligence Assistant.
You assist developers in managing, understanding, grouping, finding, and organizing their downloaded files.
Rules:
1. Ground all answers STRICTLY in the supplied file manifest below. Never fabricate filenames, counts, or sizes.
2. If the user asks to organize files, provide a clear explanation AND include a structured JSON block at the end with suggested moves:
\`\`\`json
{
  "proposedMoves": [
    { "downloadId": "...", "filename": "...", "targetFolder": "Documents" }
  ],
  "cleanupCandidates": [
    { "downloadId": "...", "filename": "...", "reason": "Duplicate or large stale file" }
  ]
}
\`\`\`
3. Keep target folder names concise and standard (e.g. "Documents", "Images", "Installers", "Code", "Archives").
4. If no files exist in the manifest, state clearly that no authorized downloads were found in the current workspace.

Authorized Download Records Manifest:
${manifest || "No download records registered."}${contentSnippet}

User Request: "${request.query}" (Action: ${request.action || "general"})
`;

    // 5. Invoke configured AI Provider
    const provider = await AIProviderFactory.getActiveProvider();
    const response = await provider.generate(systemPrompt, {
      temperature: 0.3,
      maxTokens: 1200,
    });

    // 6. Extract structured proposed moves if present
    let parsedMoves: Array<{ downloadId: string; filename: string; targetFolder: string }> = [];
    let parsedCleanup: Array<{ downloadId: string; filename: string; reason: string }> = [];
    try {
      const jsonMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        if (Array.isArray(parsed.proposedMoves)) {
          parsedMoves = parsed.proposedMoves.map((m: any) => ({
            downloadId: String(m.downloadId),
            filename: String(m.filename || ""),
            targetFolder: this.sanitizeFolderName(String(m.targetFolder || "Organized")),
          }));
        }
        if (Array.isArray(parsed.cleanupCandidates)) {
          parsedCleanup = parsed.cleanupCandidates;
        }
      }
    } catch {}

    return {
      answer: response,
      filesInspected: records.length,
      proposedMoves: parsedMoves,
      cleanupCandidates: parsedCleanup,
    };
  }

  public async executeOrganization(
    userId: string,
    moves: Array<{ downloadId: string; targetFolder: string }>
  ) {
    if (!moves || moves.length === 0) {
      throw new AppError("No moves specified for organization", 400, "BAD_REQUEST");
    }

    const defaultDir = path.join(os.homedir(), "Downloads");
    const results: Array<{ downloadId: string; success: boolean; newPath?: string; error?: string }> = [];

    for (const move of moves) {
      try {
        const record = await downloadsService.getDownload(userId, move.downloadId);
        if (!record.filePath) {
          results.push({ downloadId: move.downloadId, success: false, error: "No local filePath recorded" });
          continue;
        }

        const safeFolder = this.sanitizeFolderName(move.targetFolder);
        const targetDirPath = path.join(defaultDir, safeFolder);
        await fs.mkdir(targetDirPath, { recursive: true });

        const originalPath = record.filePath;
        const newPath = path.join(targetDirPath, path.basename(originalPath));

        try {
          await fs.rename(originalPath, newPath);
        } catch {
          // If cross-device or permission, fallback to copy + unlink
          await fs.copyFile(originalPath, newPath);
          await fs.unlink(originalPath);
        }

        await prisma.downloadRecord.update({
          where: { id: record.id },
          data: {
            filePath: newPath,
            metadata: {
              ...(typeof record.metadata === "object" && record.metadata !== null ? (record.metadata as object) : {}),
              organizedInto: safeFolder,
              organizedAt: new Date().toISOString(),
            },
          },
        });

        results.push({ downloadId: move.downloadId, success: true, newPath });
      } catch (err: any) {
        results.push({ downloadId: move.downloadId, success: false, error: err.message });
      }
    }

    return {
      success: true,
      totalExecuted: results.filter((r) => r.success).length,
      results,
    };
  }
}

export const downloadsAiService = new DownloadsAiService();
