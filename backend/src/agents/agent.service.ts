import { prisma } from "../config/db.js";
import { wsManager } from "../websocket/ws-server.js";
import { AgentOrchestrator } from "./agent.orchestrator.js";
import { CancellationManager } from "./runtime/cancellation-manager.js";
import { PauseManager } from "./runtime/pause-manager.js";
import { AgentExecutionLoop } from "./runtime/execution-loop.js";

export class AgentService {
  public static async createTask(data: {
    userId: string;
    workspaceId: string;
    spaceId?: string;
    title: string;
    goal: string;
    priority?: string;
    executionMode?: "quick" | "balanced" | "advanced";
    model?: string;
  }) {
    const task = await prisma.agentTask.create({
      data: {
        userId: data.userId,
        workspaceId: data.workspaceId,
        spaceId: data.spaceId,
        title: data.title,
        goal: data.goal,
        priority: data.priority || "medium",
        status: "RUNNING",
        startedAt: new Date(),
      },
    });

    const run = await prisma.agentRun.create({
      data: {
        agentTaskId: task.id,
        status: "RUNNING",
        model: data.model || "qwen3:8b",
        executionMode: data.executionMode || "balanced",
        startedAt: new Date(),
        currentStep: 0,
        progress: 0,
      },
    });

    await prisma.activityEvent.create({
      data: {
        userId: data.userId,
        workspaceId: data.workspaceId,
        taskId: task.id,
        agentRunId: run.id,
        type: "AGENT_CREATED",
        message: `Task created: "${task.title}"`,
      },
    });

    wsManager.broadcast(
      "agent.created",
      { task, run },
      { userId: data.userId, workspaceId: data.workspaceId }
    );

    // Dispatch asynchronous orchestration
    void AgentOrchestrator.orchestrateTask(task.id, run.id);

    return { task, run };
  }

  public static async getTasks(userId: string, workspaceId?: string, status?: string) {
    const tasks = await prisma.agentTask.findMany({
      where: {
        userId,
        workspaceId: workspaceId || undefined,
        status: status ? status.toUpperCase() : undefined,
      },
      include: {
        runs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            artifacts: true,
            steps: { orderBy: { stepIndex: "asc" } },
          },
        },
        _count: { select: { runs: true, steps: true, approvals: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return tasks;
  }

  public static async getTaskById(taskId: string, userId: string) {
    const task = await prisma.agentTask.findFirst({
      where: { id: taskId, userId },
      include: {
        runs: {
          orderBy: { createdAt: "desc" },
          include: {
            plans: { orderBy: { version: "desc" }, take: 1 },
            steps: {
              orderBy: { stepIndex: "asc" },
              include: { observations: true, toolCalls: true },
            },
            artifacts: { orderBy: { createdAt: "desc" } },
            approvals: { where: { status: "pending" } },
          },
        },
        approvals: { orderBy: { createdAt: "desc" } },
        activities: { orderBy: { createdAt: "desc" }, take: 25 },
      },
    });

    return task;
  }

  public static async pauseTask(taskId: string, userId: string) {
    const task = await prisma.agentTask.findFirst({
      where: { id: taskId, userId },
      include: { runs: { orderBy: { createdAt: "desc" }, take: 1 } },
    });

    if (!task) throw new Error("Task not found");
    const activeRun = task.runs[0];
    if (!activeRun) throw new Error("No active run found for task");

    PauseManager.pause(activeRun.id);

    await prisma.agentRun.update({
      where: { id: activeRun.id },
      data: { status: "PAUSED" },
    });
    await prisma.agentTask.update({
      where: { id: taskId },
      data: { status: "PAUSED" },
    });

    wsManager.broadcast(
      "agent.paused",
      { taskId, runId: activeRun.id },
      { userId, workspaceId: task.workspaceId }
    );

    return { success: true, status: "PAUSED" };
  }

  public static async resumeTask(taskId: string, userId: string) {
    const task = await prisma.agentTask.findFirst({
      where: { id: taskId, userId },
      include: { runs: { orderBy: { createdAt: "desc" }, take: 1 } },
    });

    if (!task) throw new Error("Task not found");
    const activeRun = task.runs[0];
    if (!activeRun) throw new Error("No run found to resume");

    await prisma.agentRun.update({
      where: { id: activeRun.id },
      data: { status: "RUNNING" },
    });
    await prisma.agentTask.update({
      where: { id: taskId },
      data: { status: "RUNNING" },
    });

    wsManager.broadcast(
      "agent.resumed",
      { taskId, runId: activeRun.id },
      { userId, workspaceId: task.workspaceId }
    );

    if (PauseManager.isPaused(activeRun.id)) {
      PauseManager.resume(activeRun.id);
    } else {
      void AgentExecutionLoop.run(activeRun.id);
    }

    return { success: true, status: "RUNNING" };
  }

  public static async cancelTask(taskId: string, userId: string) {
    const task = await prisma.agentTask.findFirst({
      where: { id: taskId, userId },
      include: { runs: { orderBy: { createdAt: "desc" }, take: 1 } },
    });

    if (!task) throw new Error("Task not found");
    const activeRun = task.runs[0];

    if (activeRun) {
      CancellationManager.cancel(activeRun.id);
      await prisma.agentRun.update({
        where: { id: activeRun.id },
        data: { status: "CANCELLED", completedAt: new Date() },
      });
    }

    await prisma.agentTask.update({
      where: { id: taskId },
      data: { status: "CANCELLED", completedAt: new Date() },
    });

    wsManager.broadcast(
      "agent.cancelled",
      { taskId, runId: activeRun?.id },
      { userId, workspaceId: task.workspaceId }
    );

    return { success: true, status: "CANCELLED" };
  }

  public static async retryTask(taskId: string, userId: string) {
    const task = await prisma.agentTask.findFirst({
      where: { id: taskId, userId },
    });

    if (!task) throw new Error("Task not found");

    // Create a new run without destroying past runs!
    const newRun = await prisma.agentRun.create({
      data: {
        agentTaskId: task.id,
        status: "RUNNING",
        startedAt: new Date(),
        currentStep: 0,
        progress: 0,
      },
    });

    await prisma.agentTask.update({
      where: { id: taskId },
      data: { status: "RUNNING", startedAt: new Date(), completedAt: null },
    });

    wsManager.broadcast(
      "agent.started",
      { taskId, runId: newRun.id, title: task.title },
      { userId, workspaceId: task.workspaceId }
    );

    void AgentOrchestrator.orchestrateTask(task.id, newRun.id);

    return { success: true, run: newRun };
  }

  public static async getRunDetails(runId: string, userId: string) {
    const run = await prisma.agentRun.findFirst({
      where: { id: runId, task: { userId } },
      include: {
        task: true,
        plans: { orderBy: { version: "desc" } },
        steps: {
          orderBy: { stepIndex: "asc" },
          include: { observations: true, toolCalls: true },
        },
        toolCalls: { orderBy: { createdAt: "asc" } },
        observations: { orderBy: { createdAt: "asc" } },
        artifacts: { orderBy: { createdAt: "desc" } },
        approvals: true,
      },
    });

    return run;
  }

  public static async getRunObservations(runId: string, userId: string) {
    const observations = await prisma.agentObservation.findMany({
      where: {
        agentRunId: runId,
        run: { task: { userId } },
      },
      orderBy: { createdAt: "asc" },
      include: {
        step: { select: { stepIndex: true, toolName: true, description: true } },
      },
    });
    return observations;
  }

  // Crash recovery on backend boot
  public static async recoverInterruptedRunsOnBoot() {
    try {
      const interruptedRuns = await prisma.agentRun.findMany({
        where: { status: "RUNNING" },
        include: { task: true },
      });

      for (const run of interruptedRuns) {
        await prisma.agentRun.update({
          where: { id: run.id },
          data: {
            status: "PAUSED",
            error: "Backend restarted during execution. State safely recovered.",
          },
        });
        await prisma.agentTask.update({
          where: { id: run.agentTaskId },
          data: { status: "PAUSED" },
        });
      }

      if (interruptedRuns.length > 0) {
        console.log(`[AgentService] Recovered ${interruptedRuns.length} interrupted runs on boot.`);
      }
    } catch (err) {
      console.warn("[AgentService] Crash recovery check skipped:", err);
    }
  }
}
