import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { RequestWithId } from "../../middleware/logger.js";
import { AppError } from "../../middleware/error.js";
import { wsManager } from "../../websocket/ws-server.js";
import { WorkflowValidator } from "./workflow-validator.js";
import { WorkflowEngineService } from "./workflow-engine.service.js";
import { VisualWorkflowDefinition } from "./workflow.types.js";

const router = Router();

const createWorkflowSchema = z.object({
  workspaceId: z.string().uuid().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  definition: z.record(z.unknown()),
  status: z.enum(["active", "draft", "archived"]).optional(),
});

const updateWorkflowSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  definition: z.record(z.unknown()).optional(),
  status: z.enum(["active", "draft", "archived"]).optional(),
  changeLog: z.string().optional(),
});

/**
 * Standard default Visual Graph Workflow template: Form Auto-Submitter & Lead Generator
 */
export function getDefaultVisualFormWorkflow(): VisualWorkflowDefinition {
  return {
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      {
        id: "node_trigger",
        type: "trigger.manual",
        title: "Manual Trigger",
        category: "trigger",
        position: { x: 100, y: 220 },
        config: {},
        status: "ready",
      },
      {
        id: "node_open_url",
        type: "browser.openUrl",
        title: "Open Portal Form",
        category: "browser",
        position: { x: 380, y: 220 },
        config: {
          url: "https://example.com/form",
          timeoutMs: 15000,
        },
        status: "ready",
      },
      {
        id: "node_fill_form",
        type: "browser.fillForm",
        title: "Fill Lead Inputs",
        category: "browser",
        position: { x: 660, y: 220 },
        config: {
          fields: {
            "input[name='fullName']": "Alex Rivera",
            "input[name='email']": "alex@nexus.io",
            "input[name='company']": "NEXUS Core",
          },
          clearBeforeTyping: true,
        },
        status: "ready",
      },
      {
        id: "node_submit",
        type: "browser.click",
        title: "Submit Registration",
        category: "browser",
        position: { x: 940, y: 220 },
        config: {
          selector: "button[type='submit']",
          waitForNavigation: false,
        },
        status: "ready",
      },
      {
        id: "node_end",
        type: "output.end",
        title: "Workflow Complete",
        category: "output",
        position: { x: 1220, y: 220 },
        config: {},
        status: "ready",
      },
    ],
    edges: [
      {
        id: "e_trig_open",
        source: "node_trigger",
        target: "node_open_url",
        sourceHandle: "out",
        targetHandle: "in",
      },
      {
        id: "e_open_fill",
        source: "node_open_url",
        target: "node_fill_form",
        sourceHandle: "out",
        targetHandle: "in",
      },
      {
        id: "e_fill_submit",
        source: "node_fill_form",
        target: "node_submit",
        sourceHandle: "out",
        targetHandle: "in",
      },
      {
        id: "e_submit_end",
        source: "node_submit",
        target: "node_end",
        sourceHandle: "out",
        targetHandle: "in",
      },
    ],
  };
}

// GET /api/workflows & /api/v1/workflows
router.get("/", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.query.workspaceId as string | undefined;

    let workflows = await prisma.workflow.findMany({
      where: {
        workspace: { userId: req.user!.id },
        workspaceId: workspaceId || undefined,
      },
      include: {
        _count: { select: { executions: true, versions: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    // Auto-seed default visual graph templates if none exist
    if (workflows.length === 0) {
      let targetWorkspaceId = workspaceId;
      if (!targetWorkspaceId) {
        const ws = await prisma.workspace.findFirst({ where: { userId: req.user!.id } });
        targetWorkspaceId = ws?.id;
      }

      if (targetWorkspaceId) {
        const formFlow = getDefaultVisualFormWorkflow();

        const created = await prisma.workflow.create({
          data: {
            workspaceId: targetWorkspaceId,
            userId: req.user!.id,
            name: "Web Form Auto-Submitter & Lead Generator",
            description: "Four-node automated form filling and submission pipeline in authorized browser environment.",
            definition: formFlow as object,
            status: "active",
            version: 1,
            versions: {
              create: {
                version: 1,
                definition: formFlow as object,
                changeLog: "Initial template generation",
              },
            },
          },
        });

        // Seed second visual flow: WhatsApp Customer Notification
        const whatsappFlow: VisualWorkflowDefinition = {
          viewport: { x: 0, y: 0, zoom: 1 },
          nodes: [
            {
              id: "node_trig",
              type: "trigger.manual",
              title: "Manual Trigger",
              category: "trigger",
              position: { x: 100, y: 200 },
              config: {},
              status: "ready",
            },
            {
              id: "node_prepare",
              type: "comm.prepareWhatsApp",
              title: "Prepare WhatsApp Notification",
              category: "comm",
              position: { x: 380, y: 200 },
              config: {
                phone: "+15550192834",
                message: "Your NEXUS autonomous workflow report is ready for review.",
              },
              status: "ready",
            },
            {
              id: "node_approval",
              type: "comm.requestApproval",
              title: "Authorization Boundary",
              category: "comm",
              position: { x: 680, y: 200 },
              config: {
                action: "Send External WhatsApp Message",
                riskLevel: "moderate",
              },
              status: "ready",
            },
            {
              id: "node_send",
              type: "comm.sendWhatsApp",
              title: "WhatsApp Gateway Dispatch",
              category: "comm",
              position: { x: 980, y: 200 },
              config: {
                phone: "+15550192834",
                message: "Your NEXUS autonomous workflow report is ready for review.",
              },
              status: "ready",
            },
            {
              id: "node_finish",
              type: "output.end",
              title: "Dispatch Confirmed",
              category: "output",
              position: { x: 1260, y: 200 },
              config: {},
              status: "ready",
            },
          ],
          edges: [
            { id: "e1", source: "node_trig", target: "node_prepare", sourceHandle: "out", targetHandle: "in" },
            { id: "e2", source: "node_prepare", target: "node_approval", sourceHandle: "out", targetHandle: "in" },
            { id: "e3", source: "node_approval", target: "node_send", sourceHandle: "approved", targetHandle: "in" },
            { id: "e4", source: "node_send", target: "node_finish", sourceHandle: "out", targetHandle: "in" },
          ],
        };

        await prisma.workflow.create({
          data: {
            workspaceId: targetWorkspaceId,
            userId: req.user!.id,
            name: "WhatsApp Approval & Notification Flow",
            description: "Gated WhatsApp customer dispatch with human approval gate and real delivery verification.",
            definition: whatsappFlow as object,
            status: "active",
            version: 1,
            versions: {
              create: {
                version: 1,
                definition: whatsappFlow as object,
                changeLog: "Initial template generation",
              },
            },
          },
        });

        workflows = await prisma.workflow.findMany({
          where: {
            workspace: { userId: req.user!.id },
            workspaceId: targetWorkspaceId,
          },
          include: {
            _count: { select: { executions: true, versions: true } },
          },
          orderBy: { updatedAt: "desc" },
        });
      }
    }

    res.json({ workflows });
  } catch (error) {
    next(error);
  }
});

// POST /api/workflows & /api/v1/workflows
router.post("/", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const data = createWorkflowSchema.parse(req.body);

    let targetWorkspaceId = data.workspaceId;
    if (!targetWorkspaceId) {
      const ws = await prisma.workspace.findFirst({ where: { userId: req.user!.id } });
      if (!ws) throw new AppError("Workspace not found", 404, "NOT_FOUND");
      targetWorkspaceId = ws.id;
    }

    // Validate visual graph if definition has nodes
    const def = data.definition as unknown as VisualWorkflowDefinition;
    if (def && Array.isArray(def.nodes)) {
      const val = WorkflowValidator.validate(def);
      if (!val.valid) {
        throw new AppError(
          `Workflow graph validation failed: ${val.errors.map((e) => e.message).join("; ")}`,
          400,
          "INVALID_GRAPH"
        );
      }
    }

    const workflow = await prisma.workflow.create({
      data: {
        workspaceId: targetWorkspaceId,
        userId: req.user!.id,
        name: data.name,
        description: data.description,
        definition: data.definition as object,
        status: data.status || "active",
        version: 1,
        versions: {
          create: {
            version: 1,
            definition: data.definition as object,
            changeLog: "Initial creation",
          },
        },
      },
      include: {
        versions: true,
        _count: { select: { executions: true, versions: true } },
      },
    });

    res.status(201).json({ workflow });
  } catch (error) {
    next(error);
  }
});

// GET /api/workflows/:id & /api/v1/workflows/:id
router.get("/:id", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const workflow = await prisma.workflow.findFirst({
      where: {
        id: req.params.id,
        workspace: { userId: req.user!.id },
      },
      include: {
        versions: {
          orderBy: { version: "desc" },
          take: 5,
        },
        executions: {
          orderBy: { startedAt: "desc" },
          take: 10,
          include: { steps: true },
        },
        _count: { select: { executions: true, versions: true } },
      },
    });

    if (!workflow) {
      throw new AppError("Workflow not found", 404, "NOT_FOUND");
    }

    res.json({ workflow });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/workflows/:id & /api/v1/workflows/:id
router.patch("/:id", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.workflow.findFirst({
      where: {
        id: req.params.id,
        workspace: { userId: req.user!.id },
      },
    });

    if (!existing) {
      throw new AppError("Workflow not found", 404, "NOT_FOUND");
    }

    const data = updateWorkflowSchema.parse(req.body);

    // If definition changed, validate and snapshot version
    let newVersion = existing.version;
    if (data.definition) {
      const def = data.definition as unknown as VisualWorkflowDefinition;
      if (def && Array.isArray(def.nodes)) {
        const val = WorkflowValidator.validate(def);
        if (!val.valid) {
          throw new AppError(
            `Workflow graph validation failed: ${val.errors.map((e) => e.message).join("; ")}`,
            400,
            "INVALID_GRAPH"
          );
        }
      }

      newVersion = existing.version + 1;
      await prisma.workflowVersion.create({
        data: {
          workflowId: existing.id,
          version: newVersion,
          definition: data.definition as object,
          changeLog: data.changeLog || `Updated workflow to version ${newVersion}`,
        },
      });
    }

    const updated = await prisma.workflow.update({
      where: { id: req.params.id },
      data: {
        name: data.name !== undefined ? data.name : existing.name,
        description: data.description !== undefined ? data.description : existing.description,
        definition: data.definition !== undefined ? (data.definition as object) : (existing.definition as any),
        status: data.status !== undefined ? data.status : existing.status,
        version: newVersion,
      },
      include: {
        _count: { select: { executions: true, versions: true } },
      },
    });

    res.json({ workflow: updated });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/workflows/:id & /api/v1/workflows/:id
router.delete("/:id", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.workflow.findFirst({
      where: {
        id: req.params.id,
        workspace: { userId: req.user!.id },
      },
    });

    if (!existing) {
      throw new AppError("Workflow not found", 404, "NOT_FOUND");
    }

    await prisma.workflow.delete({
      where: { id: req.params.id },
    });

    res.json({ success: true, message: "Workflow deleted successfully" });
  } catch (error) {
    next(error);
  }
});

// POST /api/workflows/:id/duplicate & /api/v1/workflows/:id/duplicate
router.post("/:id/duplicate", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.workflow.findFirst({
      where: {
        id: req.params.id,
        workspace: { userId: req.user!.id },
      },
    });

    if (!existing) {
      throw new AppError("Workflow not found", 404, "NOT_FOUND");
    }

    const duplicated = await prisma.workflow.create({
      data: {
        workspaceId: existing.workspaceId,
        userId: req.user!.id,
        name: `${existing.name} (Copy)`,
        description: existing.description,
        definition: existing.definition as object,
        status: "active",
        version: 1,
        versions: {
          create: {
            version: 1,
            definition: existing.definition as object,
            changeLog: `Cloned from ${existing.name}`,
          },
        },
      },
    });

    res.status(201).json({ workflow: duplicated });
  } catch (error) {
    next(error);
  }
});

// POST /api/workflows/:id/validate & /api/v1/workflows/:id/validate
router.post("/:id/validate", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.workflow.findFirst({
      where: {
        id: req.params.id,
        workspace: { userId: req.user!.id },
      },
    });

    if (!existing) {
      throw new AppError("Workflow not found", 404, "NOT_FOUND");
    }

    const definition = (req.body?.definition || existing.definition) as unknown as VisualWorkflowDefinition;
    const result = WorkflowValidator.validate(definition);

    res.json({
      valid: result.valid,
      errors: result.errors,
      warnings: result.warnings,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/workflows/:id/versions & /api/v1/workflows/:id/versions
router.get("/:id/versions", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const versions = await prisma.workflowVersion.findMany({
      where: {
        workflow: {
          id: req.params.id,
          workspace: { userId: req.user!.id },
        },
      },
      orderBy: { version: "desc" },
    });

    res.json({ versions });
  } catch (error) {
    next(error);
  }
});

// POST /api/workflows/:id/run & /api/v1/workflows/:id/run
router.post("/:id/run", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const workflow = await prisma.workflow.findFirst({
      where: {
        id: req.params.id,
        workspace: { userId: req.user!.id },
      },
    });

    if (!workflow) {
      throw new AppError("Workflow not found", 404, "NOT_FOUND");
    }

    const definition = (req.body?.definition || workflow.definition) as unknown as VisualWorkflowDefinition;

    // Check if definition is a Visual Graph (has nodes array)
    if (definition && Array.isArray(definition.nodes)) {
      const result = await WorkflowEngineService.runWorkflow(
        req.user!.id,
        workflow.workspaceId,
        workflow.id,
        definition
      );

      return res.status(202).json({
        workflowId: workflow.id,
        executionId: result.executionId,
        status: result.status,
      });
    }

    // Fallback for sequential steps
    const execution = await prisma.workflowExecution.create({
      data: {
        workflowId: workflow.id,
        version: workflow.version,
        status: "running",
        input: (req.body || {}) as object,
      },
    });

    wsManager.broadcast(
      "workflow.progress",
      { workflowId: workflow.id, executionId: execution.id, status: "started" },
      { userId: req.user!.id, workspaceId: workflow.workspaceId }
    );

    res.status(202).json({ executionId: execution.id, status: "running" });
  } catch (error) {
    next(error);
  }
});

export const workflowsRouter = router;
