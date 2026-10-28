import { Router, Response, NextFunction } from "express";
import { prisma } from "../../config/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { RequestWithId } from "../../middleware/logger.js";
import { AppError } from "../../middleware/error.js";
import { ApprovalPolicyEngine } from "./approval-policy.service.js";

const router = Router();

// GET /api/approvals/pending & GET /api/v1/approvals/pending
router.get("/pending", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const approvals = await prisma.approvalRequest.findMany({
      where: {
        userId: req.user!.id,
        status: "pending",
      },
      include: {
        task: { select: { id: true, title: true, goal: true } },
        decisions: { orderBy: { decidedAt: "desc" } },
        policy: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ approvals, count: approvals.length });
  } catch (error) {
    next(error);
  }
});

// GET /api/approvals/stats & GET /api/v1/approvals/stats
router.get("/stats", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const workspaceId = req.query.workspaceId as string | undefined;

    const where: any = { userId };
    if (workspaceId) where.workspaceId = workspaceId;

    const [pending, approved, rejected, expired, cancelled, total] = await Promise.all([
      prisma.approvalRequest.count({ where: { ...where, status: "pending" } }),
      prisma.approvalRequest.count({ where: { ...where, status: "approved" } }),
      prisma.approvalRequest.count({ where: { ...where, status: "rejected" } }),
      prisma.approvalRequest.count({ where: { ...where, status: "expired" } }),
      prisma.approvalRequest.count({ where: { ...where, status: "cancelled" } }),
      prisma.approvalRequest.count({ where }),
    ]);

    res.json({
      stats: {
        pending,
        approved,
        rejected,
        expired,
        cancelled,
        total,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Dedicated policies router for /api/v1/approval-policies
const policiesRouter = Router();

// GET /api/approvals/policies & GET /api/v1/approval-policies
const getPoliciesHandler = async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.query.workspaceId as string | undefined;
    await ApprovalPolicyEngine.seedDefaultPoliciesIfEmpty(req.user!.id, workspaceId);

    const policies = await prisma.approvalPolicy.findMany({
      where: {
        userId: req.user!.id,
        workspaceId: workspaceId || undefined,
      },
      orderBy: { createdAt: "asc" },
    });

    res.json({ policies, count: policies.length });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/approvals/policies/:id & PATCH /api/v1/approval-policies/:id
const patchPolicyHandler = async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const policy = await prisma.approvalPolicy.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!policy) {
      throw new AppError("Approval policy not found", 404, "NOT_FOUND");
    }

    const { enabled, riskThreshold, requiresApproval, autoExpireHours, description } = req.body;

    const updated = await prisma.approvalPolicy.update({
      where: { id: policy.id },
      data: {
        enabled: typeof enabled === "boolean" ? enabled : undefined,
        riskThreshold: riskThreshold || undefined,
        requiresApproval: typeof requiresApproval === "boolean" ? requiresApproval : undefined,
        autoExpireHours: typeof autoExpireHours === "number" ? autoExpireHours : undefined,
        description: description || undefined,
      },
    });

    res.json({ policy: updated });
  } catch (error) {
    next(error);
  }
};

router.get("/policies", requireAuth, getPoliciesHandler);
router.patch("/policies/:id", requireAuth, patchPolicyHandler);

policiesRouter.get("/", requireAuth, getPoliciesHandler);
policiesRouter.patch("/:id", requireAuth, patchPolicyHandler);

export const approvalPoliciesRouter = policiesRouter;

// POST /api/approvals & POST /api/v1/approvals
router.post("/", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const { actionTitle, actionType, action, target, riskLevel, requestingActor, details, workspaceId, taskId, workflowExecutionId, skillExecutionId } = req.body;
    const approval = await ApprovalPolicyEngine.createApproval({
      userId: req.user!.id,
      workspaceId: workspaceId || undefined,
      actionTitle,
      actionType,
      action: action || actionTitle || "GENERAL_ACTION",
      target,
      riskLevel,
      requestingActor,
      details,
      taskId,
      workflowExecutionId,
      skillExecutionId,
    });
    res.status(201).json({ approval });
  } catch (error) {
    next(error);
  }
});

// GET /api/approvals & GET /api/v1/approvals
router.get("/", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as string | undefined;
    const risk = req.query.risk as string | undefined;
    const search = req.query.search as string | undefined;
    const sort = (req.query.sort as string) || "created_desc";
    const workspaceId = req.query.workspaceId as string | undefined;

    const where: any = {
      userId: req.user!.id,
    };

    if (workspaceId) {
      where.workspaceId = workspaceId;
    }

    if (status && status !== "all") {
      where.status = status.toLowerCase();
    }

    if (risk && risk !== "all") {
      where.riskLevel = risk.toLowerCase();
    }

    if (search && search.trim().length > 0) {
      const q = search.trim();
      where.OR = [
        { action: { contains: q, mode: "insensitive" } },
        { actionTitle: { contains: q, mode: "insensitive" } },
        { target: { contains: q, mode: "insensitive" } },
        { requestingActor: { contains: q, mode: "insensitive" } },
      ];
    }

    let orderBy: any = { createdAt: "desc" };
    if (sort === "created_asc") {
      orderBy = { createdAt: "asc" };
    } else if (sort === "deadline_asc") {
      orderBy = { expiresAt: "asc" };
    }

    const approvals = await prisma.approvalRequest.findMany({
      where,
      include: {
        task: { select: { id: true, title: true, goal: true } },
        decisions: { orderBy: { decidedAt: "desc" } },
        policy: true,
      },
      orderBy,
    });

    res.json({ approvals, count: approvals.length });
  } catch (error) {
    next(error);
  }
});

// GET /api/approvals/:id & GET /api/v1/approvals/:id
router.get("/:id", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const approval = await prisma.approvalRequest.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: {
        task: true,
        decisions: {
          include: { user: { select: { id: true, name: true, email: true } } },
          orderBy: { decidedAt: "desc" },
        },
        policy: true,
      },
    });

    if (!approval) {
      throw new AppError("Approval request not found", 404, "NOT_FOUND");
    }

    res.json({ approval });
  } catch (error) {
    next(error);
  }
});

// POST /api/approvals/:id/approve & POST /api/v1/approvals/:id/approve
router.post("/:id/approve", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const { notes } = req.body || {};
    const result = await ApprovalPolicyEngine.approve(req.params.id, req.user!.id, notes);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// POST /api/approvals/:id/reject & POST /api/v1/approvals/:id/reject
router.post("/:id/reject", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const { reason } = req.body || {};
    const result = await ApprovalPolicyEngine.reject(req.params.id, req.user!.id, reason);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// POST /api/approvals/:id/cancel & POST /api/v1/approvals/:id/cancel
router.post("/:id/cancel", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const { reason } = req.body || {};
    const result = await ApprovalPolicyEngine.cancel(req.params.id, req.user!.id, reason);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export const approvalsRouter = router;
