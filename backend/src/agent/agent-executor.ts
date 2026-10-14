import { prisma } from "../config/db.js";
import { wsManager } from "../websocket/ws-server.js";
import { ToolRegistry } from "./tool-registry.js";
import { AgentPlanner } from "./agent-planner.js";
import { AIProviderFactory } from "../ai/provider-factory.js";

export class AgentExecutor {
  private static activeTasks: Set<string> = new Set();

  public static isTaskRunning(taskId: string): boolean {
    return this.activeTasks.has(taskId);
  }

  public static async cancelTask(taskId: string): Promise<boolean> {
    this.activeTasks.delete(taskId);
    await prisma.agentTask.update({
      where: { id: taskId },
      data: { status: "cancelled", completedAt: new Date() },
    });

    wsManager.broadcast("agent.task.failed", { taskId, status: "cancelled", reason: "Cancelled by user" });
    return true;
  }

  public static async executeTask(taskId: string): Promise<void> {
    const task = await prisma.agentTask.findUnique({
      where: { id: taskId },
      include: { steps: true },
    });

    if (!task) return;

    this.activeTasks.add(taskId);

    // Update status to running
    await prisma.agentTask.update({
      where: { id: taskId },
      data: { status: "running", startedAt: new Date() },
    });

    wsManager.broadcast(
      "agent.task.started",
      { taskId, title: task.title, goal: task.goal },
      { userId: task.userId, workspaceId: task.workspaceId }
    );

    try {
      // 1. Generate plan if no steps exist
      let plannedSteps = task.steps;
      if (plannedSteps.length === 0) {
        const generatedPlan = await AgentPlanner.generatePlan(task.goal);

        for (const step of generatedPlan) {
          const taskExists = await prisma.agentTask.findUnique({ where: { id: task.id } });
          if (!taskExists) return;

          const created = await prisma.agentStep.create({
            data: {
              taskId: task.id,
              type: step.type,
              status: "pending",
              input: { name: step.name, tool: step.tool, input: step.input, description: step.description } as any,
            },
          });
          plannedSteps.push(created);
        }
      }

      // 2. Execute each step sequentially
      for (const step of plannedSteps) {
        if (!this.activeTasks.has(taskId)) {
          console.log(`Task ${taskId} was cancelled.`);
          return;
        }

        await prisma.agentStep.update({
          where: { id: step.id },
          data: { status: "running", startedAt: new Date() },
        });

        wsManager.broadcast(
          "agent.step.started",
          { taskId, stepId: step.id, type: step.type, input: step.input },
          { userId: task.userId, workspaceId: task.workspaceId }
        );

        const stepInput = (step.input || {}) as Record<string, unknown>;
        let stepOutput: Record<string, unknown> = {};

        if (step.type === "tool_call" && stepInput.tool) {
          const toolResult = await ToolRegistry.executeTool(
            String(stepInput.tool),
            (stepInput.input as Record<string, unknown>) || {},
            { userId: task.userId, workspaceId: task.workspaceId, taskId: task.id }
          );

          if (toolResult.approvalRequired) {
            await prisma.agentTask.update({
              where: { id: taskId },
              data: { status: "waiting_approval" },
            });
            await prisma.agentStep.update({
              where: { id: step.id },
              data: { status: "waiting_approval" },
            });
            return;
          }

          stepOutput = toolResult as unknown as Record<string, unknown>;
        } else if (step.type === "answer" || step.type === "verification") {
          const provider = await AIProviderFactory.getActiveProvider();
          const answerText = await provider.generate(
            `Task Goal: ${task.goal}\nSynthesize an informative, professional completion message for this step.`,
            { maxTokens: 500 }
          );
          stepOutput = { summary: answerText };
        } else {
          stepOutput = { status: "ok", detail: "Step finished cleanly." };
        }

        await prisma.agentStep.update({
          where: { id: step.id },
          data: { status: "completed", output: stepOutput as object, completedAt: new Date() },
        });

        wsManager.broadcast(
          "agent.step.completed",
          { taskId, stepId: step.id, output: stepOutput },
          { userId: task.userId, workspaceId: task.workspaceId }
        );
      }

      // Mark task completed
      await prisma.agentTask.update({
        where: { id: taskId },
        data: { status: "completed", completedAt: new Date() },
      });

      await prisma.activityEvent.create({
        data: {
          userId: task.userId,
          workspaceId: task.workspaceId,
          taskId: task.id,
          type: "TASK_COMPLETED",
          message: `Agent task "${task.title}" completed successfully.`,
        },
      });

      wsManager.broadcast(
        "agent.task.completed",
        { taskId, status: "completed" },
        { userId: task.userId, workspaceId: task.workspaceId }
      );
    } catch (error) {
      console.error(`[AgentExecutor] Task ${taskId} failed:`, error);
      try {
        await prisma.agentTask.update({
          where: { id: taskId },
          data: { status: "failed", completedAt: new Date() },
        });
      } catch {
        // Record may have been removed or cleaned up
      }

      wsManager.broadcast(
        "agent.task.failed",
        { taskId, error: (error as Error).message },
        { userId: task.userId, workspaceId: task.workspaceId }
      );
    } finally {
      this.activeTasks.delete(taskId);
    }
  }
}
