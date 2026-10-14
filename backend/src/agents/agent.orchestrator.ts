import { prisma } from "../config/db.js";
import { wsManager } from "../websocket/ws-server.js";
import { AgentPlanner } from "./agent.planner.js";
import { AgentExecutionLoop } from "./runtime/execution-loop.js";

export class AgentOrchestrator {
  public static async orchestrateTask(taskId: string, runId: string): Promise<void> {
    const task = await prisma.agentTask.findUnique({
      where: { id: taskId },
      include: { user: true, workspace: true },
    });

    if (!task) return;

    wsManager.broadcast(
      "agent.planning",
      { taskId, runId, goal: task.goal },
      { userId: task.userId, workspaceId: task.workspaceId }
    );

    // 1. Retrieve relevant memories
    const relevantMemories = await prisma.memory.findMany({
      where: {
        userId: task.userId,
        status: "ACTIVE",
      },
      take: 4,
      orderBy: { importanceScore: "desc" },
      select: { title: true, content: true, type: true },
    });

    // 2. Generate structured plan
    const plan = await AgentPlanner.createPlan(task.goal, { relevantMemories });

    // 3. Persist plan in PostgreSQL if run is still active
    const runExists = await prisma.agentRun.findUnique({ where: { id: runId } });
    if (!runExists) {
      console.log(`[AgentOrchestrator] Run ${runId} no longer exists, aborting plan creation.`);
      return;
    }

    const savedPlan = await prisma.agentPlan.create({
      data: {
        agentRunId: runId,
        version: 1,
        status: "active",
        steps: plan.steps as any,
      },
    });

    // 4. Record Activity
    await prisma.activityEvent.create({
      data: {
        userId: task.userId,
        workspaceId: task.workspaceId,
        taskId: task.id,
        agentRunId: runId,
        type: "AGENT_PLAN_CREATED",
        message: `Plan generated with ${plan.steps.length} sequential execution steps.`,
      },
    });

    wsManager.broadcast(
      "agent.planReady",
      {
        taskId,
        runId,
        planId: savedPlan.id,
        stepsCount: plan.steps.length,
        steps: plan.steps,
      },
      { userId: task.userId, workspaceId: task.workspaceId }
    );

    // 5. Kick off asynchronous execution loop
    void AgentExecutionLoop.run(runId);
  }
}
