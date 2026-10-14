import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { RequestWithId } from "../../middleware/logger.js";
import { AppError } from "../../middleware/error.js";

const router = Router();

const createWorkspaceSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  settings: z.record(z.unknown()).optional(),
});

const updateWorkspaceSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  settings: z.record(z.unknown()).optional(),
});

// GET /api/workspaces
router.get("/", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    let workspaces = await prisma.workspace.findMany({
      where: { userId: req.user!.id },
      include: {
        browserSessions: {
          include: { tabs: { orderBy: { position: "asc" } } },
        },
        _count: {
          select: {
            agentTasks: true,
            workflows: true,
            researchProjects: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    if (workspaces.length === 0) {
      const defaultWs = await prisma.workspace.create({
        data: {
          userId: req.user!.id,
          name: "Primary Workspace",
          description: "General research, automated workflows, and active web sessions.",
        },
        include: {
          browserSessions: {
            include: { tabs: { orderBy: { position: "asc" } } },
          },
          _count: {
            select: {
              agentTasks: true,
              workflows: true,
              researchProjects: true,
            },
          },
        },
      });
      workspaces = [defaultWs];
    }

    res.json({ workspaces });
  } catch (error) {
    next(error);
  }
});

// POST /api/workspaces
router.post("/", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const data = createWorkspaceSchema.parse(req.body);
    const workspace = await prisma.workspace.create({
      data: {
        userId: req.user!.id,
        name: data.name,
        description: data.description,
        settings: (data.settings || {}) as object,
      },
    });

    res.status(201).json({ workspace });
  } catch (error) {
    next(error);
  }
});

// GET /api/workspaces/:id
router.get("/:id", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const workspace = await prisma.workspace.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: {
        browserSessions: {
          include: { tabs: { orderBy: { position: "asc" } } },
        },
      },
    });

    if (!workspace) {
      throw new AppError("Workspace not found", 404, "NOT_FOUND");
    }

    res.json({ workspace });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/workspaces/:id
router.patch("/:id", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const data = updateWorkspaceSchema.parse(req.body);

    const existing = await prisma.workspace.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!existing) {
      throw new AppError("Workspace not found", 404, "NOT_FOUND");
    }

    const updated = await prisma.workspace.update({
      where: { id: req.params.id },
      data: {
        name: data.name,
        description: data.description,
        settings: data.settings ? (data.settings as object) : undefined,
      },
    });

    res.json({ workspace: updated });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/workspaces/:id
router.delete("/:id", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.workspace.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!existing) {
      throw new AppError("Workspace not found", 404, "NOT_FOUND");
    }

    await prisma.workspace.delete({
      where: { id: req.params.id },
    });

    res.json({ success: true, message: "Workspace deleted" });
  } catch (error) {
    next(error);
  }
});

export const workspacesRouter = router;
