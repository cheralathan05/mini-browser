// NEXUS MEMORY — Full Production Routes

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { RequestWithId } from "../../middleware/logger.js";
import { AppError } from "../../middleware/error.js";
import * as repo from "./memory.repository.js";
import * as service from "./memory.service.js";
import { prisma } from "../../config/db.js";
import { wsManager } from "../../websocket/ws-server.js";

const router = Router();

// ---------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------

const createSchema = z.object({
  workspaceId: z.string().optional().transform(v => (!v || !v.trim() ? undefined : v.trim())),
  type: z.string().default("FACT"),
  category: z.string().optional(),
  title: z.string().optional(),
  key: z.string().optional(),
  content: z.string().min(1),
  summary: z.string().optional(),
  importance: z.number().min(0).max(1).optional(),
  sourceUrl: z.string().optional().transform(v => (!v || !v.trim() ? undefined : v.trim())),
  sourceTitle: z.string().optional(),
  sourceDomain: z.string().optional(),
  sourceType: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  researchProjectId: z.string().optional(),
  agentTaskId: z.string().optional(),
  conversationId: z.string().optional(),
});

const updateSchema = z.object({
  title: z.string().optional(),
  content: z.string().min(1).optional(),
  summary: z.string().optional(),
  type: z.string().optional(),
  category: z.string().optional(),
  importanceScore: z.number().min(0).max(1).optional(),
  confidenceScore: z.number().min(0).max(1).optional(),
});

const searchSchema = z.object({
  query: z.string().default(""),
  workspaceId: z.string().uuid().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  minImportance: z.number().min(0).max(1).optional(),
  isVerified: z.boolean().optional(),
  limit: z.number().min(1).max(100).optional().default(30),
  cursor: z.string().optional(),
});

// ---------------------------------------------------------------
// Helper: Get userId (with fallback for dev/demo)
// ---------------------------------------------------------------
async function resolveUserId(req: RequestWithId): Promise<string> {
  if (req.user?.id) return req.user.id;
  const first = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!first) throw new AppError("No user found", 401, "UNAUTHORIZED");
  return first.id;
}

// ---------------------------------------------------------------
// GET /api/memory/stats
// ---------------------------------------------------------------
router.get("/stats", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.query.workspaceId as string | undefined;
    const stats = await repo.getMemoryStats(req.user!.id, workspaceId);
    res.json({ stats });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /api/memory/graph
// ---------------------------------------------------------------
router.get("/graph", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.query.workspaceId as string | undefined;
    const graph = await repo.getMemoryGraph(req.user!.id, workspaceId);
    res.json({ graph });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /api/memory/timeline
// ---------------------------------------------------------------
router.get("/timeline", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.query.workspaceId as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const timeline = await repo.getTimeline(req.user!.id, workspaceId, limit);
    res.json({ timeline });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /api/memory/suggestions
// ---------------------------------------------------------------
router.get("/suggestions", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.query.workspaceId as string | undefined;
    // Generate fresh suggestions from real data
    await service.generateSuggestions(req.user!.id, workspaceId);
    const suggestions = await repo.getSuggestions(req.user!.id, workspaceId);
    res.json({ suggestions });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /api/memory/collections
// ---------------------------------------------------------------
router.get("/collections", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.query.workspaceId as string | undefined;
    const collections = await repo.getCollections(req.user!.id, workspaceId);
    res.json({ collections });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// POST /api/memory/collections
// ---------------------------------------------------------------
router.post("/collections", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const { name, description, color, icon, workspaceId } = req.body;
    if (!name?.trim()) throw new AppError("Name is required", 400, "VALIDATION");
    const collection = await repo.createCollection({
      userId: req.user!.id,
      workspaceId,
      name: name.trim(),
      description,
      color,
      icon,
    });
    res.status(201).json({ collection });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// DELETE /api/memory/collections/:id
// ---------------------------------------------------------------
router.delete("/collections/:id", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    await repo.deleteCollection(req.params.id, req.user!.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /api/memory/search
// ---------------------------------------------------------------
router.get("/search", async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUserId(req);
    const query = (req.query.q as string) || (req.query.query as string) || "";
    const workspaceId = req.query.workspaceId as string | undefined;
    const type = req.query.type as string | undefined;

    const result = await service.search({ userId, workspaceId, query, type, limit: 20 });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// POST /api/memory/search (POST-body search with filters)
// ---------------------------------------------------------------
router.post("/search", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const data = searchSchema.parse(req.body);
    const result = await service.search({ ...data, userId: req.user!.id });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /api/memory/:id/related
// ---------------------------------------------------------------
router.get("/:id/related", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const related = await repo.getRelatedMemories(req.params.id, req.user!.id);
    res.json({ related });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /api/memory/:id/sources
// ---------------------------------------------------------------
router.get("/:id/sources", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    await service.getMemory(req.params.id, req.user!.id);
    const sources = await repo.getMemorySources(req.params.id);
    res.json({ sources });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /api/memory/:id
// ---------------------------------------------------------------
router.get("/:id", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const memory = await service.getMemory(req.params.id, req.user!.id);
    await repo.incrementAccessCount(req.params.id);
    res.json({ memory });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /api/memory (list with pagination)
// ---------------------------------------------------------------
router.get("/", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.query.workspaceId as string | undefined;
    const query = req.query.q as string | undefined;
    const type = req.query.type as string | undefined;
    const status = req.query.status as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const cursor = req.query.cursor as string | undefined;

    const result = await repo.findMemories({
      userId: req.user!.id,
      workspaceId,
      type,
      status,
      query,
      limit,
      cursor,
    });

    res.json({ memories: result.memories, total: result.total, nextCursor: result.nextCursor });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// POST /api/memory (create)
// ---------------------------------------------------------------
router.post("/", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const data = createSchema.parse(req.body);
    let targetWorkspaceId = data.workspaceId;
    if (!targetWorkspaceId) {
      const ws = await prisma.workspace.findFirst({ where: { userId: req.user!.id } });
      targetWorkspaceId = ws?.id;
    }

    const memory = await service.createMemoryFromInput({
      userId: req.user!.id,
      ...data,
      workspaceId: targetWorkspaceId,
      title: data.title || data.key || data.content.slice(0, 80),
      importance: data.importance,
    });
    wsManager.broadcast("memory.created", { memory }, { userId: req.user!.id, workspaceId: targetWorkspaceId });
    res.status(201).json({ memory });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// POST /api/memory/:id/ask (Ask AI)
// ---------------------------------------------------------------
router.post("/:id/ask", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const { question, workspaceId } = req.body;
    if (!question?.trim()) throw new AppError("Question is required", 400, "VALIDATION");
    const result = await service.askAboutMemory(req.params.id, req.user!.id, question, workspaceId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// POST /api/memory/:id/verify
// ---------------------------------------------------------------
router.post("/:id/verify", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const memory = await service.verifyMemory(req.params.id, req.user!.id);
    wsManager.broadcast("memory.updated", { memory }, { userId: req.user!.id });
    res.json({ memory });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// POST /api/memory/:id/pin
// ---------------------------------------------------------------
router.post("/:id/pin", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const memory = await service.togglePin(req.params.id, req.user!.id);
    wsManager.broadcast("memory.updated", { memory }, { userId: req.user!.id });
    res.json({ memory });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// POST /api/memory/:id/archive
// ---------------------------------------------------------------
router.post("/:id/archive", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const memory = await service.archiveMemory(req.params.id, req.user!.id);
    res.json({ memory });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// POST /api/memory/:id/restore
// ---------------------------------------------------------------
router.post("/:id/restore", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const memory = await service.restoreMemory(req.params.id, req.user!.id);
    res.json({ memory });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// POST /api/memory/:id/note
// ---------------------------------------------------------------
router.post("/:id/note", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) throw new AppError("Content is required", 400, "VALIDATION");
    await service.getMemory(req.params.id, req.user!.id); // ownership
    const note = await repo.addNote(req.params.id, content.trim());
    await repo.createMemoryEvent({
      memoryId: req.params.id,
      userId: req.user!.id,
      eventType: "NOTE_ADDED",
      title: "Note added to memory",
    });
    res.status(201).json({ note });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// POST /api/memory/:id/connect
// ---------------------------------------------------------------
router.post("/:id/connect", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const { targetId, relationType, workspaceId } = req.body;
    if (!targetId) throw new AppError("targetId is required", 400, "VALIDATION");
    const relation = await service.connectMemories(req.params.id, targetId, req.user!.id, relationType, workspaceId);
    res.status(201).json({ relation });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// POST /api/memory/:id/add-to-collection
// ---------------------------------------------------------------
router.post("/:id/add-to-collection", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const { collectionId } = req.body;
    if (!collectionId) throw new AppError("collectionId is required", 400, "VALIDATION");
    await service.getMemory(req.params.id, req.user!.id);
    const item = await repo.addToCollection(collectionId, req.params.id);
    res.status(201).json({ item });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// POST /api/memory/suggestions/:id/dismiss
// ---------------------------------------------------------------
router.post("/suggestions/:id/dismiss", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    await repo.dismissSuggestion(req.params.id, req.user!.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// PATCH /api/memory/:id
// ---------------------------------------------------------------
router.patch("/:id", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const data = updateSchema.parse(req.body);
    const memory = await service.editMemory(req.params.id, req.user!.id, data);
    wsManager.broadcast("memory.updated", { memory }, { userId: req.user!.id });
    res.json({ memory });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// DELETE /api/memory/:id
// ---------------------------------------------------------------
router.delete("/:id", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    await service.deleteMemory(req.params.id, req.user!.id);
    wsManager.broadcast("memory.deleted", { id: req.params.id }, { userId: req.user!.id });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export const memoryRouter = router;
