import { prisma } from "../../config/db.js";
import { wsManager } from "../../websocket/ws-server.js";
import { PlannedStep } from "../agent.types.js";
import { ToolRegistry } from "../tools/tool.registry.js";
import { AgentObserver } from "../agent.observer.js";
import { AgentValidator } from "../agent.validator.js";
import { CancellationManager } from "./cancellation-manager.js";
import { PauseManager } from "./pause-manager.js";
import { RetryManager } from "./retry-manager.js";
import { sanitizeForDb } from "../agent.utils.js";

export class AgentExecutionLoop {
  public static async run(runId: string): Promise<void> {
    const run = await prisma.agentRun.findUnique({
      where: { id: runId },
      include: {
        task: true,
        plans: { where: { status: "active" }, orderBy: { version: "desc" }, take: 1 },
        steps: { orderBy: { stepIndex: "asc" } },
      },
    });

    if (!run || !run.task) {
      console.error(`[AgentExecutionLoop] Run ${runId} not found.`);
      return;
    }

    const taskId = run.task.id;
    const userId = run.task.userId;
    const workspaceId = run.task.workspaceId;

    const abortController = new AbortController();
    CancellationManager.register(runId, abortController);

    // Update status to RUNNING
    await prisma.agentRun.update({
      where: { id: runId },
      data: { status: "RUNNING", startedAt: new Date() },
    });
    await prisma.agentTask.update({
      where: { id: taskId },
      data: { status: "RUNNING", startedAt: new Date() },
    });

    wsManager.broadcast(
      "agent.started",
      { taskId, runId, title: run.task.title, goal: run.task.goal },
      { userId, workspaceId }
    );

    // Record Activity
    await prisma.activityEvent.create({
      data: {
        userId,
        workspaceId,
        taskId,
        agentRunId: runId,
        type: "AGENT_STARTED",
        message: `Agent execution started for "${run.task.title}"`,
      },
    });

    try {
      const activePlan = run.plans[0];
      if (!activePlan) {
        throw new Error("No execution plan found for run.");
      }

      const plannedSteps = (activePlan.steps as unknown as PlannedStep[]) || [];
      const totalSteps = plannedSteps.length;

      let currentStepIndex = run.currentStep;

      // Persist step records if they don't exist yet
      if (run.steps.length === 0) {
        for (let i = 0; i < plannedSteps.length; i++) {
          const ps = plannedSteps[i];
          await prisma.agentStep.create({
            data: {
              taskId,
              agentRunId: runId,
              stepIndex: i,
              type: ps.toolName ? "tool_call" : "action",
              toolName: ps.toolName,
              description: sanitizeForDb(ps.description),
              status: "PENDING",
              input: sanitizeForDb(ps.input) as any,
            },
          });
        }
      }

      // Fetch fresh steps
      const dbSteps = await prisma.agentStep.findMany({
        where: { agentRunId: runId },
        orderBy: { stepIndex: "asc" },
      });

      const maxSteps = 25;
      let executedCount = 0;

      while (currentStepIndex < plannedSteps.length && executedCount < maxSteps) {
        const runAlive = await prisma.agentRun.findUnique({ where: { id: runId } }).catch(() => null);
        if (!runAlive) {
          return;
        }

        // 1. Check cancellation
        if (CancellationManager.isCancelled(runId) || abortController.signal.aborted) {
          await this.markCancelled(runId, taskId, userId, workspaceId);
          return;
        }

        // 2. Check pause
        if (PauseManager.isPaused(runId)) {
          await prisma.agentRun.update({ where: { id: runId }, data: { status: "PAUSED" } });
          await prisma.agentTask.update({ where: { id: taskId }, data: { status: "PAUSED" } });
          wsManager.broadcast("agent.paused", { taskId, runId }, { userId, workspaceId });
          await PauseManager.waitForResume(runId, abortController.signal);
          await prisma.agentRun.update({ where: { id: runId }, data: { status: "RUNNING" } });
          await prisma.agentTask.update({ where: { id: taskId }, data: { status: "RUNNING" } });
          wsManager.broadcast("agent.resumed", { taskId, runId }, { userId, workspaceId });
        }

        const plannedStep = plannedSteps[currentStepIndex];
        const dbStep = dbSteps[currentStepIndex] || (await prisma.agentStep.findFirst({
          where: { agentRunId: runId, stepIndex: currentStepIndex },
        }));

        if (!dbStep) {
          currentStepIndex++;
          continue;
        }

        // Update step to RUNNING
        await prisma.agentStep.update({
          where: { id: dbStep.id },
          data: { status: "RUNNING", startedAt: new Date() },
        });
        await prisma.agentRun.update({
          where: { id: runId },
          data: {
            currentStep: currentStepIndex,
            progress: Math.round(((currentStepIndex + 1) / totalSteps) * 100),
          },
        });

        wsManager.broadcast(
          "agent.stepStarted",
          {
            taskId,
            runId,
            stepId: dbStep.id,
            stepIndex: currentStepIndex,
            totalSteps,
            description: plannedStep.description,
            toolName: plannedStep.toolName,
          },
          { userId, workspaceId }
        );

        let retryCount = dbStep.retryCount || 0;
        let stepSucceeded = false;
        let toolExecutionResult: any = null;
        let observationPayload: any = null;

        while (!stepSucceeded && retryCount <= 3) {
          // Check cancellation
          if (CancellationManager.isCancelled(runId) || abortController.signal.aborted) {
            await this.markCancelled(runId, taskId, userId, workspaceId);
            return;
          }

          // Execute tool
          toolExecutionResult = await ToolRegistry.execute(
            plannedStep.toolName,
            plannedStep.input || {},
            {
              userId,
              workspaceId,
              spaceId: run.task.spaceId || undefined,
              taskId,
              runId,
              stepId: dbStep.id,
              signal: abortController.signal,
            }
          );

          // Handle Approval Requirement
          if (toolExecutionResult.approvalRequired) {
            await prisma.agentRun.update({
              where: { id: runId },
              data: { status: "WAITING_APPROVAL" },
            });
            await prisma.agentTask.update({
              where: { id: taskId },
              data: { status: "WAITING_APPROVAL" },
            });
            await prisma.agentStep.update({
              where: { id: dbStep.id },
              data: { status: "WAITING_APPROVAL" },
            });

            // Pause execution and wait for user approval or rejection
            console.log(`[AgentExecutionLoop] Run ${runId} paused for approval: ${toolExecutionResult.approvalId}`);
            return;
          }

          // Observe result
          observationPayload = await AgentObserver.inspect(
            plannedStep.toolName,
            toolExecutionResult,
            { taskId, runId, stepId: dbStep.id, userId, workspaceId }
          );

          // Verify result
          const isFinalStep = currentStepIndex === plannedSteps.length - 1;
          const verification = await AgentValidator.verify(
            plannedStep,
            toolExecutionResult,
            observationPayload,
            isFinalStep
          );

          if (verification.passed) {
            stepSucceeded = true;
          } else {
            retryCount++;
            if (RetryManager.isRetryable(verification.reason || "", retryCount)) {
              wsManager.broadcast(
                "agent.retrying",
                {
                  taskId,
                  runId,
                  stepId: dbStep.id,
                  retryCount,
                  reason: verification.reason,
                },
                { userId, workspaceId }
              );
              await RetryManager.calculateBackoffDelay(retryCount);
            } else {
              break;
            }
          }
        }

        if (!stepSucceeded) {
          const failReason = sanitizeForDb(toolExecutionResult?.error || "Step verification failed.");
          await prisma.agentStep.update({
            where: { id: dbStep.id },
            data: {
              status: "FAILED",
              error: failReason,
              output: sanitizeForDb(toolExecutionResult?.result) as any,
              completedAt: new Date(),
            },
          });
          await prisma.agentRun.update({
            where: { id: runId },
            data: {
              status: "FAILED",
              error: sanitizeForDb(`Failed at Step ${currentStepIndex + 1}: ${failReason}`),
              completedAt: new Date(),
            },
          });
          await prisma.agentTask.update({
            where: { id: taskId },
            data: { status: "FAILED", completedAt: new Date() },
          });

          wsManager.broadcast(
            "agent.failed",
            { taskId, runId, stepId: dbStep.id, error: failReason },
            { userId, workspaceId }
          );

          await prisma.activityEvent.create({
            data: {
              userId,
              workspaceId,
              taskId,
              agentRunId: runId,
              type: "AGENT_FAILED",
              message: sanitizeForDb(`Execution failed at step ${currentStepIndex + 1}: ${failReason}`),
            },
          });

          return;
        }

        // Complete step in database
        try {
          await prisma.agentStep.update({
            where: { id: dbStep.id },
            data: {
              status: "COMPLETED",
              output: sanitizeForDb(toolExecutionResult.result) as any,
              retryCount,
              completedAt: new Date(),
            },
          });
        } catch (stepUpdErr: any) {
          if (stepUpdErr?.code === "P2025" || stepUpdErr?.code === "P2003") {
            return;
          }
          throw stepUpdErr;
        }

        wsManager.broadcast(
          "agent.stepCompleted",
          {
            taskId,
            runId,
            stepId: dbStep.id,
            stepIndex: currentStepIndex,
            totalSteps,
            output: toolExecutionResult.result,
          },
          { userId, workspaceId }
        );

        // Check if report artifact produced
        if (plannedStep.toolName === "research.getReport" && toolExecutionResult.result?.report) {
          await prisma.agentArtifact.create({
            data: {
              agentRunId: runId,
              type: "report",
              name: sanitizeForDb(`Executive Report: ${toolExecutionResult.result.topic || run.task.title}`),
              content: sanitizeForDb(toolExecutionResult.result.report),
              metadata: sanitizeForDb({
                sourcesReferenced: toolExecutionResult.result.sourcesReferenced,
                generatedAt: new Date().toISOString(),
              }) as any,
            },
          });
        }

        // Check if source collection produced
        if (plannedStep.toolName === "research.search" && Array.isArray(toolExecutionResult.result?.sources)) {
          await prisma.agentArtifact.create({
            data: {
              agentRunId: runId,
              type: "research",
              name: sanitizeForDb(`Discovered Sources: ${toolExecutionResult.result.query || run.task.title}`),
              content: sanitizeForDb(JSON.stringify(toolExecutionResult.result.sources, null, 2)),
              metadata: sanitizeForDb({ count: toolExecutionResult.result.sourcesCount }) as any,
            },
          });
        }

        currentStepIndex++;
        executedCount++;
      }

      // Mark Run & Task as COMPLETED
      await prisma.agentRun.update({
        where: { id: runId },
        data: {
          status: "COMPLETED",
          progress: 100,
          completedAt: new Date(),
        },
      });

      await prisma.agentTask.update({
        where: { id: taskId },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
        },
      });

      // Record Activity
      await prisma.activityEvent.create({
        data: {
          userId,
          workspaceId,
          taskId,
          agentRunId: runId,
          type: "AGENT_COMPLETED",
          message: `Agent task "${run.task.title}" completed all ${totalSteps} steps successfully.`,
        },
      });

      wsManager.broadcast(
        "agent.completed",
        { taskId, runId, status: "COMPLETED" },
        { userId, workspaceId }
      );
    } catch (err: any) {
      if (err?.code === "P2025" || err?.code === "P2003") {
        return;
      }
      console.error(`[AgentExecutionLoop] Unhandled error in run ${runId}:`, err);
      try {
        await prisma.agentRun.update({
          where: { id: runId },
          data: { status: "FAILED", error: sanitizeForDb(err.message), completedAt: new Date() },
        });
        await prisma.agentTask.update({
          where: { id: taskId },
          data: { status: "FAILED", completedAt: new Date() },
        });
      } catch {}

      wsManager.broadcast(
        "agent.failed",
        { taskId, runId, error: err.message },
        { userId, workspaceId }
      );
    } finally {
      CancellationManager.cleanup(runId);
      PauseManager.cleanup(runId);
    }
  }

  private static async markCancelled(runId: string, taskId: string, userId: string, workspaceId: string) {
    await prisma.agentRun.update({
      where: { id: runId },
      data: { status: "CANCELLED", completedAt: new Date() },
    });
    await prisma.agentTask.update({
      where: { id: taskId },
      data: { status: "CANCELLED", completedAt: new Date() },
    });

    wsManager.broadcast(
      "agent.cancelled",
      { taskId, runId },
      { userId, workspaceId }
    );

    await prisma.activityEvent.create({
      data: {
        userId,
        workspaceId,
        taskId,
        agentRunId: runId,
        type: "AGENT_CANCELLED",
        message: "Agent execution was cancelled by user.",
      },
    });
  }
}
