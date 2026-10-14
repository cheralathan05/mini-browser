import { Response, NextFunction } from "express";
import { z } from "zod";
import { RequestWithId } from "../middleware/logger.js";
import { AppError } from "../middleware/error.js";
import { AgentService } from "./agent.service.js";
import { prisma } from "../config/db.js";

const createTaskSchema = z.object({
  workspaceId: z.string().uuid(),
  spaceId: z.string().optional(),
  title: z.string().min(1),
  goal: z.string().min(1),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  executionMode: z.enum(["quick", "balanced", "advanced"]).default("balanced"),
  model: z.string().optional(),
});

export class AgentController {
  public static async createTask(req: RequestWithId, res: Response, next: NextFunction) {
    try {
      const data = createTaskSchema.parse(req.body);

      // Verify workspace exists and belongs to user
      const workspace = await prisma.workspace.findFirst({
        where: { id: data.workspaceId, userId: req.user!.id },
      });
      if (!workspace) {
        throw new AppError("Workspace not found", 404, "NOT_FOUND");
      }

      const result = await AgentService.createTask({
        userId: req.user!.id,
        workspaceId: data.workspaceId,
        spaceId: data.spaceId,
        title: data.title,
        goal: data.goal,
        priority: data.priority,
        executionMode: data.executionMode,
        model: data.model,
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  public static async getTasks(req: RequestWithId, res: Response, next: NextFunction) {
    try {
      const workspaceId = req.query.workspaceId as string | undefined;
      const status = req.query.status as string | undefined;

      const tasks = await AgentService.getTasks(req.user!.id, workspaceId, status);
      res.json({ tasks });
    } catch (error) {
      next(error);
    }
  }

  public static async getTaskById(req: RequestWithId, res: Response, next: NextFunction) {
    try {
      const task = await AgentService.getTaskById(req.params.id, req.user!.id);
      if (!task) {
        throw new AppError("Agent task not found", 404, "NOT_FOUND");
      }
      res.json({ task });
    } catch (error) {
      next(error);
    }
  }

  public static async startTask(req: RequestWithId, res: Response, next: NextFunction) {
    try {
      const result = await AgentService.resumeTask(req.params.id, req.user!.id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  public static async pauseTask(req: RequestWithId, res: Response, next: NextFunction) {
    try {
      const result = await AgentService.pauseTask(req.params.id, req.user!.id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  public static async resumeTask(req: RequestWithId, res: Response, next: NextFunction) {
    try {
      const result = await AgentService.resumeTask(req.params.id, req.user!.id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  public static async cancelTask(req: RequestWithId, res: Response, next: NextFunction) {
    try {
      const result = await AgentService.cancelTask(req.params.id, req.user!.id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  public static async retryTask(req: RequestWithId, res: Response, next: NextFunction) {
    try {
      const result = await AgentService.retryTask(req.params.id, req.user!.id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  public static async getTaskRuns(req: RequestWithId, res: Response, next: NextFunction) {
    try {
      const runs = await prisma.agentRun.findMany({
        where: {
          agentTaskId: req.params.id,
          task: { userId: req.user!.id },
        },
        include: {
          artifacts: true,
          _count: { select: { steps: true, toolCalls: true, observations: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      res.json({ runs });
    } catch (error) {
      next(error);
    }
  }

  public static async getRunById(req: RequestWithId, res: Response, next: NextFunction) {
    try {
      const run = await AgentService.getRunDetails(req.params.id, req.user!.id);
      if (!run) {
        throw new AppError("Agent run not found", 404, "NOT_FOUND");
      }
      res.json({ run });
    } catch (error) {
      next(error);
    }
  }

  public static async getRunPlan(req: RequestWithId, res: Response, next: NextFunction) {
    try {
      const plan = await prisma.agentPlan.findFirst({
        where: {
          agentRunId: req.params.id,
          run: { task: { userId: req.user!.id } },
        },
        orderBy: { version: "desc" },
      });
      res.json({ plan });
    } catch (error) {
      next(error);
    }
  }

  public static async getRunSteps(req: RequestWithId, res: Response, next: NextFunction) {
    try {
      const steps = await prisma.agentStep.findMany({
        where: {
          agentRunId: req.params.id,
          run: { task: { userId: req.user!.id } },
        },
        include: { observations: true, toolCalls: true },
        orderBy: { stepIndex: "asc" },
      });
      res.json({ steps });
    } catch (error) {
      next(error);
    }
  }

  public static async getRunToolCalls(req: RequestWithId, res: Response, next: NextFunction) {
    try {
      const toolCalls = await prisma.agentToolCall.findMany({
        where: {
          agentRunId: req.params.id,
          run: { task: { userId: req.user!.id } },
        },
        orderBy: { createdAt: "asc" },
      });
      res.json({ toolCalls });
    } catch (error) {
      next(error);
    }
  }

  public static async getRunArtifacts(req: RequestWithId, res: Response, next: NextFunction) {
    try {
      const artifacts = await prisma.agentArtifact.findMany({
        where: {
          agentRunId: req.params.id,
          run: { task: { userId: req.user!.id } },
        },
        orderBy: { createdAt: "desc" },
      });
      res.json({ artifacts });
    } catch (error) {
      next(error);
    }
  }

  public static async getRunActivity(req: RequestWithId, res: Response, next: NextFunction) {
    try {
      const activities = await prisma.activityEvent.findMany({
        where: {
          agentRunId: req.params.id,
          userId: req.user!.id,
        },
        orderBy: { createdAt: "asc" },
      });
      res.json({ activities });
    } catch (error) {
      next(error);
    }
  }

  public static async getRunObservations(req: RequestWithId, res: Response, next: NextFunction) {
    try {
      const observations = await AgentService.getRunObservations(req.params.id, req.user!.id);
      res.json({ observations });
    } catch (error) {
      next(error);
    }
  }
}
