import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { RequestWithId } from "../../middleware/logger.js";
import { AppError } from "../../middleware/error.js";
import { AgentExecutor } from "../../agent/agent-executor.js";

const router = Router();

const createSkillSchema = z.object({
  workspaceId: z.string().uuid().optional(),
  name: z.string().min(1),
  description: z.string().min(1),
  instructions: z.string().min(1),
  tools: z.array(z.string()).optional(),
  permissions: z.record(z.unknown()).optional(),
});

// GET /api/skills
router.get("/", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.query.workspaceId as string | undefined;

    const skills = await prisma.skill.findMany({
      where: {
        userId: req.user!.id,
        workspaceId: workspaceId || undefined,
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ skills });
  } catch (error) {
    next(error);
  }
});

// POST /api/skills
router.post("/", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const data = createSkillSchema.parse(req.body);

    const skill = await prisma.skill.create({
      data: {
        userId: req.user!.id,
        workspaceId: data.workspaceId,
        name: data.name,
        description: data.description,
        instructions: data.instructions,
        tools: (data.tools || []) as object,
        permissions: (data.permissions || {}) as object,
      },
    });

    res.status(201).json({ skill });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/skills/:id
router.patch("/:id", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.skill.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!existing) {
      throw new AppError("Skill not found", 404, "NOT_FOUND");
    }

    const updated = await prisma.skill.update({
      where: { id: req.params.id },
      data: {
        name: req.body.name,
        description: req.body.description,
        instructions: req.body.instructions,
        tools: req.body.tools ? (req.body.tools as object) : undefined,
        permissions: req.body.permissions ? (req.body.permissions as object) : undefined,
      },
    });

    res.json({ skill: updated });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/skills/:id
router.delete("/:id", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.skill.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!existing) {
      throw new AppError("Skill not found", 404, "NOT_FOUND");
    }

    await prisma.skill.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// POST /api/skills/:id/run
router.post("/:id/run", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const skill = await prisma.skill.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!skill) {
      throw new AppError("Skill not found", 404, "NOT_FOUND");
    }

    let targetWorkspaceId: string | null | undefined = skill.workspaceId;
    if (!targetWorkspaceId) {
      const defaultWs = await prisma.workspace.findFirst({
        where: { userId: req.user!.id },
      });
      targetWorkspaceId = defaultWs?.id;
    }

    if (!targetWorkspaceId) {
      throw new AppError("No workspace available to run skill", 400, "NO_WORKSPACE");
    }

    // Launch an AgentTask configured with this skill's instructions
    const task = await prisma.agentTask.create({
      data: {
        userId: req.user!.id,
        workspaceId: targetWorkspaceId,
        title: `Skill Run: ${skill.name}`,
        goal: skill.instructions,
        priority: "medium",
        status: "pending",
      },
    });

    void AgentExecutor.executeTask(task.id);

    res.status(202).json({ task, message: "Skill execution initiated" });
  } catch (error) {
    next(error);
  }
});

export const skillsRouter = router;
