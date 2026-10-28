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

const recordHistorySchema = z.object({
  url: z.string().min(1),
  title: z.string().min(1),
  faviconUrl: z.string().optional(),
  isAgentVisit: z.boolean().optional().default(false),
  workspaceId: z.string().optional(),
});

// 1. GET /api/history - List history with search and time period filter
router.get("/", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const search = req.query.search as string | undefined;
    const period = req.query.period as string | undefined; // "Today" | "Yesterday" | "Last 7 Days" | "Last 30 Days" | "All Time"

    const where: any = { userId };
    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { url: { contains: q, mode: "insensitive" } },
      ];
    }

    const now = new Date();
    if (period === "Today") {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      where.lastVisitedAt = { gte: startOfDay };
    } else if (period === "Yesterday") {
      const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      const endOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      where.lastVisitedAt = { gte: startOfYesterday, lt: endOfYesterday };
    } else if (period === "Last 7 Days") {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      where.lastVisitedAt = { gte: sevenDaysAgo };
    } else if (period === "Last 30 Days") {
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      where.lastVisitedAt = { gte: thirtyDaysAgo };
    }

    const items = await prisma.browserHistoryItem.findMany({
      where,
      orderBy: { lastVisitedAt: "desc" },
      take: 100,
    });

    res.json({ history: items });
  } catch (err) {
    next(err);
  }
});

// 2. POST /api/history - Record or increment navigation history
router.post("/", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const body = recordHistorySchema.parse(req.body);

    if (body.url.startsWith("nexus://") || body.url.startsWith("about:")) {
      res.json({ ignored: true });
      return;
    }

    let favicon = body.faviconUrl;
    if (!favicon && body.url.startsWith("http")) {
      try {
        favicon = `https://${new URL(body.url).hostname}/favicon.ico`;
      } catch {}
    }

    const existing = await prisma.browserHistoryItem.findFirst({
      where: { userId, url: body.url },
    });

    if (existing) {
      const updated = await prisma.browserHistoryItem.update({
        where: { id: existing.id },
        data: {
          title: body.title || existing.title,
          faviconUrl: favicon || existing.faviconUrl,
          visitCount: existing.visitCount + 1,
          lastVisitedAt: new Date(),
        },
      });
      res.json({ historyItem: updated });
    } else {
      const created = await prisma.browserHistoryItem.create({
        data: {
          userId,
          workspaceId: body.workspaceId,
          title: body.title,
          url: body.url,
          faviconUrl: favicon,
          isAgentVisit: body.isAgentVisit,
          visitCount: 1,
          lastVisitedAt: new Date(),
        },
      });
      res.status(201).json({ historyItem: created });
    }
  } catch (err) {
    next(err);
  }
});

// 2b. POST /api/history/sync - Bulk sync history items
router.post("/sync", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const list = Array.isArray(req.body.history) ? req.body.history : [];
    let count = 0;
    for (const h of list) {
      if (!h.url || typeof h.url !== "string" || h.url.startsWith("nexus://")) continue;
      const title = h.title || h.url;
      try {
        await prisma.browserHistoryItem.create({
          data: {
            userId,
            title,
            url: h.url,
            faviconUrl: h.favicon || h.faviconUrl,
            visitCount: h.visitCount || 1,
            isAgentVisit: Boolean(h.isAgentVisit),
            lastVisitedAt: h.visitedAt ? new Date(h.visitedAt) : new Date(),
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

// 3. DELETE /api/history/:id - Remove single history item
router.delete("/:id", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const existing = await prisma.browserHistoryItem.findFirst({
      where: { id: req.params.id, userId },
    });
    if (!existing) {
      throw new AppError("History item not found", 404, "NOT_FOUND");
    }

    await prisma.browserHistoryItem.delete({ where: { id: req.params.id } });
    res.json({ success: true, id: req.params.id });
  } catch (err) {
    next(err);
  }
});

// 4. DELETE /api/history - Clear all user history
router.delete("/", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const deleted = await prisma.browserHistoryItem.deleteMany({
      where: { userId },
    });
    res.json({ success: true, count: deleted.count });
  } catch (err) {
    next(err);
  }
});

export default router;
