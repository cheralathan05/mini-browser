import { Router, Response, NextFunction } from "express";
import { prisma } from "../../config/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { RequestWithId } from "../../middleware/logger.js";
import { AppError } from "../../middleware/error.js";
import { AuditService } from "./audit.service.js";

const router = Router();

// GET /api/activity & GET /api/v1/activity
router.get("/", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const { category, actorType, outcome, sourceModule, search, dateRange, limit, cursor, workspaceId } = req.query;

    const result = await AuditService.query({
      userId: req.user!.id,
      workspaceId: workspaceId as string | undefined,
      category: category as string | undefined,
      actorType: actorType as string | undefined,
      outcome: outcome as string | undefined,
      sourceModule: sourceModule as string | undefined,
      search: search as string | undefined,
      dateRange: dateRange as string | undefined,
      limit: limit ? Number(limit) : 50,
      cursor: cursor as string | undefined,
    });

    res.json({
      activities: result.events,
      events: result.events,
      totalCount: result.totalCount,
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/activity/stats & GET /api/v1/activity/stats
router.get("/stats", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.query.workspaceId as string | undefined;
    const stats = await AuditService.getStats(req.user!.id, workspaceId);
    res.json({ stats });
  } catch (error) {
    next(error);
  }
});

// GET /api/activity/:id & GET /api/v1/activity/:id
router.get("/:id", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const event = await prisma.activityEvent.findFirst({
      where: {
        id: req.params.id,
        userId: req.user!.id,
      },
      include: {
        task: { select: { id: true, title: true, goal: true, status: true } },
      },
    });

    if (!event) {
      throw new AppError("Activity event not found", 404, "NOT_FOUND");
    }

    res.json({ event });
  } catch (error) {
    next(error);
  }
});

// POST /api/activity/log & POST /api/v1/activity/log
router.post("/log", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const {
      category,
      actorType,
      actorId,
      sourceModule,
      actionName,
      outcome,
      message,
      type,
      correlationId,
      workflowExecutionId,
      skillExecutionId,
      approvalRequestId,
      metadata,
    } = req.body;

    if (!message) {
      throw new AppError("Activity message is required", 400, "VALIDATION_ERROR");
    }

    const event = await AuditService.log({
      userId: req.user!.id,
      workspaceId: req.body.workspaceId || undefined,
      category,
      actorType,
      actorId,
      sourceModule,
      actionName,
      outcome,
      message,
      type,
      correlationId,
      workflowExecutionId,
      skillExecutionId,
      approvalRequestId,
      metadata,
    });

    res.status(201).json({ event });
  } catch (error) {
    next(error);
  }
});

export const activityRouter = router;
