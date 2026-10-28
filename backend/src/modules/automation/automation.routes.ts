import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { RequestWithId } from "../../middleware/logger.js";
import { AppError } from "../../middleware/error.js";
import { ObjectivePlannerService } from "./objective-planner.service.js";
import { AutomationRunnerService } from "./automation-runner.service.js";
import { WhatsAppService } from "./whatsapp.service.js";
import { AutonomyMode, ExecutionPlan } from "./automation.types.js";

const router = Router();

const planSchema = z.object({
  objective: z.string().min(1, "Objective is required"),
  mode: z.enum(["manual", "assisted", "autonomous"]).default("assisted"),
  workspaceId: z.string().uuid().optional(),
});

const executeSchema = z.object({
  objective: z.string().optional(),
  mode: z.enum(["manual", "assisted", "autonomous"]).default("assisted"),
  workspaceId: z.string().uuid().optional(),
  presetId: z.string().optional(),
  plan: z.record(z.unknown()).optional(),
});

const whatsappSendSchema = z.object({
  recipient: z.string().min(1, "Recipient phone number is required"),
  message: z.string().min(1, "Message content is required"),
  templateId: z.string().optional(),
  workspaceId: z.string().uuid().optional(),
  requiresApproval: z.boolean().default(false),
});

// GET /api/v1/automation/presets
router.get("/presets", (req, res) => {
  res.json({ presets: ObjectivePlannerService.PRESETS });
});

// POST /api/v1/automation/plan
router.post("/plan", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const data = planSchema.parse(req.body);
    const plan = await ObjectivePlannerService.planObjective(data.objective, data.mode as AutonomyMode);
    const validation = ObjectivePlannerService.validatePlan(plan);

    res.json({
      plan,
      valid: validation.valid,
      errors: validation.errors,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/automation/execute
router.post("/execute", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const data = executeSchema.parse(req.body);

    let workspaceId = data.workspaceId;
    if (!workspaceId) {
      const ws = await prisma.workspace.findFirst({ where: { userId: req.user!.id } });
      if (!ws) throw new AppError("No workspace found for user", 404, "NOT_FOUND");
      workspaceId = ws.id;
    }

    let plan: ExecutionPlan;
    if (data.plan && Array.isArray((data.plan as any).steps)) {
      plan = data.plan as unknown as ExecutionPlan;
    } else if (data.presetId) {
      const foundPreset = ObjectivePlannerService.PRESETS.find((p) => p.id === data.presetId);
      if (!foundPreset) throw new AppError(`Preset "${data.presetId}" not found`, 404, "NOT_FOUND");
      plan = ObjectivePlannerService.applyModePolicy(
        { ...foundPreset.plan, goal: data.objective || foundPreset.defaultGoal },
        data.mode as AutonomyMode
      );
    } else if (data.objective) {
      plan = await ObjectivePlannerService.planObjective(data.objective, data.mode as AutonomyMode);
    } else {
      throw new AppError("Either plan, presetId, or objective must be provided", 400, "BAD_REQUEST");
    }

    const validation = ObjectivePlannerService.validatePlan(plan);
    if (!validation.valid) {
      throw new AppError(`Plan validation failed: ${validation.errors.join(", ")}`, 400, "INVALID_PLAN");
    }

    const execResult = await AutomationRunnerService.executePlan(
      req.user!.id,
      workspaceId,
      plan
    );

    res.status(202).json({
      workflowId: execResult.workflowId,
      executionId: execResult.executionId,
      status: execResult.status,
      plan,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/automation/executions
router.get("/executions", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as string | undefined;

    const executions = await prisma.workflowExecution.findMany({
      where: {
        workflow: { workspace: { userId: req.user!.id } },
        status: status ? status.toLowerCase() : undefined,
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

// GET /api/v1/automation/executions/:id
router.get("/executions/:id", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
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

// POST /api/v1/automation/executions/:id/cancel
router.post("/executions/:id/cancel", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
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

// POST /api/v1/automation/executions/:id/retry
router.post("/executions/:id/retry", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const exec = await prisma.workflowExecution.findFirst({
      where: {
        id: req.params.id,
        workflow: { workspace: { userId: req.user!.id } },
      },
      include: { workflow: true },
    });

    if (!exec) {
      throw new AppError("Workflow execution not found", 404, "NOT_FOUND");
    }

    const plan = exec.workflow.definition as unknown as ExecutionPlan;
    const retryResult = await AutomationRunnerService.executePlan(
      req.user!.id,
      exec.workflow.workspaceId,
      plan,
      exec.workflowId
    );

    res.status(202).json({
      workflowId: retryResult.workflowId,
      executionId: retryResult.executionId,
      status: "running",
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/automation/whatsapp/send
router.post("/whatsapp/send", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const data = whatsappSendSchema.parse(req.body);

    let workspaceId = data.workspaceId;
    if (!workspaceId) {
      const ws = await prisma.workspace.findFirst({ where: { userId: req.user!.id } });
      workspaceId = ws?.id || "";
    }

    const result = await WhatsAppService.sendMessage(
      req.user!.id,
      workspaceId,
      {
        recipient: data.recipient,
        message: data.message,
        templateId: data.templateId,
        requiresApproval: data.requiresApproval,
      }
    );

    res.json({ result });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/automation/whatsapp/status
router.get("/whatsapp/status", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const status = await WhatsAppService.getConnectionStatus(req.user!.id);
    res.json({ connection: status });
  } catch (err) {
    next(err);
  }
});

export const automationRouter = router;
