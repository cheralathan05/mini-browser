import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { requireAuth, optionalAuth } from "../../middleware/auth.js";
import { RequestWithId } from "../../middleware/logger.js";
import { AppError } from "../../middleware/error.js";
import { prisma } from "../../config/db.js";

const router = Router();

async function resolveUser(req: RequestWithId): Promise<string> {
  if (req.user?.id) return req.user.id;
  const user = await prisma.user.findFirst();
  if (user) return user.id;
  throw new AppError("Authentication required", 401, "UNAUTHORIZED");
}

const createBookmarkSchema = z.object({
  url: z.string().min(1),
  title: z.string().min(1),
  faviconUrl: z.string().optional(),
  folder: z.string().optional().default("General"),
  tags: z.array(z.string()).optional().default([]),
  notes: z.string().optional(),
  isPinned: z.boolean().optional().default(false),
  workspaceId: z.string().optional(),
});

const updateBookmarkSchema = z.object({
  title: z.string().optional(),
  folder: z.string().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  isPinned: z.boolean().optional(),
});

// 1. GET /api/bookmarks - List bookmarks
router.get("/", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const search = req.query.search as string | undefined;
    const folder = req.query.folder as string | undefined;

    const where: any = { userId };
    if (folder && folder !== "All") {
      where.folder = folder;
    }
    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { url: { contains: q, mode: "insensitive" } },
        { notes: { contains: q, mode: "insensitive" } },
      ];
    }

    const bookmarks = await prisma.bookmark.findMany({
      where,
      orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
    });

    res.json({ bookmarks });
  } catch (err) {
    next(err);
  }
});

// 2. POST /api/bookmarks - Create bookmark
router.post("/", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const body = createBookmarkSchema.parse(req.body);

    // Auto extract favicon if missing
    let favicon = body.faviconUrl;
    if (!favicon && body.url.startsWith("http")) {
      try {
        favicon = `https://${new URL(body.url).hostname}/favicon.ico`;
      } catch {}
    }

    const bookmark = await prisma.bookmark.create({
      data: {
        userId,
        workspaceId: body.workspaceId,
        title: body.title,
        url: body.url,
        faviconUrl: favicon,
        folder: body.folder,
        tags: body.tags,
        notes: body.notes,
        isPinned: body.isPinned,
      },
    });

    res.status(201).json({ bookmark });
  } catch (err) {
    next(err);
  }
});

// 2b. POST /api/bookmarks/sync - Bulk sync bookmarks from client
router.post("/sync", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const list = Array.isArray(req.body.bookmarks) ? req.body.bookmarks : [];
    let count = 0;
    for (const b of list) {
      if (!b.url || typeof b.url !== "string" || b.url.startsWith("nexus://")) continue;
      const title = b.title || b.url;
      let favicon = b.favicon || b.faviconUrl;
      if (!favicon && b.url.startsWith("http")) {
        try { favicon = `https://${new URL(b.url).hostname}/favicon.ico`; } catch {}
      }
      try {
        await prisma.bookmark.create({
          data: {
            userId,
            title,
            url: b.url,
            faviconUrl: favicon,
            folder: b.category || b.folder || "General",
          },
        });
        count++;
      } catch {}
    }
    res.json({ success: true, count });
  } catch (err) {
    next(err);
  }
});

// 3. PATCH /api/bookmarks/:id - Update bookmark
router.patch("/:id", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const body = updateBookmarkSchema.parse(req.body);

    const existing = await prisma.bookmark.findFirst({
      where: { id: req.params.id, userId },
    });
    if (!existing) {
      throw new AppError("Bookmark not found", 404, "NOT_FOUND");
    }

    const updated = await prisma.bookmark.update({
      where: { id: req.params.id },
      data: body,
    });

    res.json({ bookmark: updated });
  } catch (err) {
    next(err);
  }
});

// 4. DELETE /api/bookmarks/:id - Delete bookmark
router.delete("/:id", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const existing = await prisma.bookmark.findFirst({
      where: { id: req.params.id, userId },
    });
    if (!existing) {
      throw new AppError("Bookmark not found", 404, "NOT_FOUND");
    }

    await prisma.bookmark.delete({ where: { id: req.params.id } });
    res.json({ success: true, id: req.params.id });
  } catch (err) {
    next(err);
  }
});

export default router;
