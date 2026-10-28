import { Router, Response, NextFunction } from "express";
import { prisma } from "../../config/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { RequestWithId } from "../../middleware/logger.js";
import { AppError } from "../../middleware/error.js";
import { AutomationRunnerService } from "../automation/automation-runner.service.js";

const router = Router();

// GET /api/v1/executions & /api/executions
router.get("/", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as string | undefined;

    const executions = await prisma.workflowExecution.findMany({
      where: {
        workflow: { workspace: { userId: req.user!.id } },
        status: status && status !== "all" ? status.toLowerCase() : undefined,
      },
      include: {
        workflow: { select: { id: true, name: true, description: true } },
        steps: {
          orderBy: { startedAt: "asc" },
        },
      },
      orderBy: { startedAt: "desc" },
      take: 50,
    });

    res.json({ executions });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/executions/:id & /api/executions/:id
router.get("/:id", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const execution = await prisma.workflowExecution.findFirst({
      where: {
        id: req.params.id,
        workflow: { workspace: { userId: req.user!.id } },
      },
      include: {
        workflow: true,
        steps: {
          orderBy: { startedAt: "asc" },
        },
      },
    });

    if (!execution) {
      throw new AppError("Workflow execution not found", 404, "NOT_FOUND");
    }

    res.json({ execution });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/executions/:id/cancel & /api/executions/:id/cancel
router.post("/:id/cancel", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const cancelled = await AutomationRunnerService.cancelExecution(req.params.id, req.user!.id);
    if (!cancelled) {
      throw new AppError("Execution could not be cancelled or not found", 404, "NOT_FOUND");
    }
    res.json({ success: true, message: "Execution cancelled" });
  } catch (err) {
    next(err);
  }
});

export const executionsRouter = router;
