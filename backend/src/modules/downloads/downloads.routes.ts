import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { requireAuth, optionalAuth } from "../../middleware/auth.js";
import { RequestWithId } from "../../middleware/logger.js";
import { AppError } from "../../middleware/error.js";
import { downloadsService } from "./downloads.service.js";
import { downloadsAiService } from "./downloads-ai.service.js";
import { prisma } from "../../config/db.js";

const router = Router();

async function resolveUser(req: RequestWithId): Promise<string> {
  if (req.user?.id) return req.user.id;
  const user = await prisma.user.findFirst();
  if (user) return user.id;
  throw new AppError("Authentication required", 401, "UNAUTHORIZED");
}

const createDownloadSchema = z.object({
  filename: z.string().min(1),
  sourceUrl: z.string().optional(),
  sourceDomain: z.string().optional(),
  mimeType: z.string().optional(),
  extension: z.string().optional(),
  expectedSize: z.number().optional(),
  downloadedSize: z.number().optional(),
  status: z.enum(["completed", "in_progress", "paused", "failed", "cancelled"]).optional(),
  filePath: z.string().optional(),
  workspaceId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateDownloadSchema = z.object({
  status: z.enum(["completed", "in_progress", "paused", "failed", "cancelled"]).optional(),
  downloadedSize: z.number().optional(),
  expectedSize: z.number().optional(),
  error: z.string().nullable().optional(),
  filePath: z.string().optional(),
});

const aiAskSchema = z.object({
  query: z.string().min(1),
  action: z.enum(["summarize", "explain", "group", "find", "cleanup", "organize"]).optional(),
  downloadIds: z.array(z.string()).optional(),
  workspaceId: z.string().optional(),
});

const executeOrganizeSchema = z.object({
  moves: z.array(
    z.object({
      downloadId: z.string(),
      targetFolder: z.string().min(1),
    })
  ),
});

// 1. GET /api/downloads - List downloads with empirical metrics
router.get("/", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const result = await downloadsService.listDownloads(userId, {
      workspaceId: req.query.workspaceId as string | undefined,
      search: req.query.search as string | undefined,
      status: req.query.status as string | undefined,
      type: req.query.type as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// 2. GET /api/downloads/duplicates - Detect duplicate downloads
router.get("/duplicates", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const duplicates = await downloadsService.findDuplicates(userId);
    res.json({ duplicates });
  } catch (err) {
    next(err);
  }
});

// 3. POST /api/downloads - Record/create a download
router.post("/", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const body = createDownloadSchema.parse(req.body);
    const download = await downloadsService.createDownload(userId, body);
    res.status(201).json({ download });
  } catch (err) {
    next(err);
  }
});

// 4. POST /api/downloads/ai/ask - AI Downloads Assistant
router.post("/ai/ask", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const body = aiAskSchema.parse(req.body);
    const result = await downloadsAiService.askAssistant(userId, body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// 5. POST /api/downloads/ai/organize/execute - Execute approved file organization
router.post("/ai/organize/execute", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const body = executeOrganizeSchema.parse(req.body);
    const result = await downloadsAiService.executeOrganization(userId, body.moves);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// 6. GET /api/downloads/:id - Get download details
router.get("/:id", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const download = await downloadsService.getDownload(userId, req.params.id);
    res.json({ download });
  } catch (err) {
    next(err);
  }
});

// 7. GET /api/downloads/:id/preview - Safe preview for supported files
router.get("/:id/preview", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const preview = await downloadsService.getPreview(userId, req.params.id);
    res.json({ preview });
  } catch (err) {
    next(err);
  }
});

// 8. PATCH /api/downloads/:id - Update progress or status
router.patch("/:id", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const body = updateDownloadSchema.parse(req.body);
    const updated = await downloadsService.updateDownload(userId, req.params.id, {
      ...body,
      error: body.error === null ? undefined : body.error,
    });
    res.json({ download: updated });
  } catch (err) {
    next(err);
  }
});

// 9. POST /api/downloads/:id/retry - Retry download
router.post("/:id/retry", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const retried = await downloadsService.retryDownload(userId, req.params.id);
    res.json({ download: retried });
  } catch (err) {
    next(err);
  }
});

// 10. POST /api/downloads/:id/cancel - Cancel active download
router.post("/:id/cancel", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const cancelled = await downloadsService.cancelDownload(userId, req.params.id);
    res.json({ download: cancelled });
  } catch (err) {
    next(err);
  }
});

// 11. DELETE /api/downloads/:id - Remove record, with optional file deletion
router.delete("/:id", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const deleteFile = req.query.deleteFile === "true";
    const result = await downloadsService.deleteDownload(userId, req.params.id, deleteFile);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
