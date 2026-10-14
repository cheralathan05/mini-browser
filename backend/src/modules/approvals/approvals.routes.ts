import { Router, Response, NextFunction } from "express";
import { prisma } from "../../config/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { RequestWithId } from "../../middleware/logger.js";
import { AppError } from "../../middleware/error.js";
import { wsManager } from "../../websocket/ws-server.js";
import { AgentService } from "../../agents/agent.service.js";

const router = Router();

// GET /api/approvals/pending
router.get("/pending", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const approvals = await prisma.approvalRequest.findMany({
      where: {
        userId: req.user!.id,
        status: { in: ["pending", "PENDING"] },
      },
      include: {
        task: { select: { id: true, title: true, goal: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ approvals });
  } catch (error) {
    next(error);
  }
});

// GET /api/approvals
router.get("/", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as string | undefined;

    const approvals = await prisma.approvalRequest.findMany({
      where: {
        userId: req.user!.id,
        status: status ? { in: [status.toLowerCase(), status.toUpperCase()] } : undefined,
      },
      include: {
        task: { select: { id: true, title: true, goal: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ approvals });
  } catch (error) {
    next(error);
  }
});

// POST /api/approvals/:id/approve
router.post("/:id/approve", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const approval = await prisma.approvalRequest.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!approval) {
      throw new AppError("Approval request not found", 404, "NOT_FOUND");
    }

    const updated = await prisma.approvalRequest.update({
      where: { id: approval.id },
      data: {
        status: "approved",
        resolvedAt: new Date(),
      },
    });

    // Record activity
    await prisma.activityEvent.create({
      data: {
        userId: req.user!.id,
        workspaceId: approval.workspaceId,
        taskId: approval.taskId,
        agentRunId: approval.agentRunId,
        type: "APPROVAL_RESOLVED",
        message: `Approved action: ${approval.action} on ${approval.target}`,
      },
    });

    wsManager.broadcast(
      "approval.resolved",
      { approvalId: approval.id, status: "approved", taskId: approval.taskId, runId: approval.agentRunId },
      { userId: req.user!.id, workspaceId: approval.workspaceId }
    );

    // Resume agent task if waiting approval
    if (approval.taskId) {
      try {
        await AgentService.resumeTask(approval.taskId, req.user!.id);
      } catch (resumeErr) {
        console.warn("[Approvals] Auto-resume task notice:", resumeErr);
      }
    }

    res.json({ approval: updated });
  } catch (error) {
    next(error);
  }
});

// POST /api/approvals/:id/reject
router.post("/:id/reject", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const approval = await prisma.approvalRequest.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!approval) {
      throw new AppError("Approval request not found", 404, "NOT_FOUND");
    }

    const updated = await prisma.approvalRequest.update({
      where: { id: approval.id },
      data: {
        status: "rejected",
        resolvedAt: new Date(),
      },
    });

    if (approval.taskId) {
      try {
        await AgentService.cancelTask(approval.taskId, req.user!.id);
      } catch {}
    }

    await prisma.activityEvent.create({
      data: {
        userId: req.user!.id,
        workspaceId: approval.workspaceId,
        taskId: approval.taskId,
        agentRunId: approval.agentRunId,
        type: "APPROVAL_REJECTED",
        message: `Rejected action: ${approval.action} on ${approval.target}`,
      },
    });

    wsManager.broadcast(
      "approval.resolved",
      { approvalId: approval.id, status: "rejected", taskId: approval.taskId, runId: approval.agentRunId },
      { userId: req.user!.id, workspaceId: approval.workspaceId }
    );

    res.json({ approval: updated });
  } catch (error) {
    next(error);
  }
});

export const approvalsRouter = router;
