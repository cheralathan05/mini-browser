import { Router, Response, NextFunction } from "express";
import { prisma } from "../../config/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { RequestWithId } from "../../middleware/logger.js";

const router = Router();

// GET /api/activity
router.get("/", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.query.workspaceId as string | undefined;
    const limit = Math.min(Number(req.query.limit || 50), 100);

    const activities = await prisma.activityEvent.findMany({
      where: {
        userId: req.user!.id,
        workspaceId: workspaceId || undefined,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        task: { select: { id: true, title: true } },
      },
    });

    res.json({ activities });
  } catch (error) {
    next(error);
  }
});

export const activityRouter = router;
