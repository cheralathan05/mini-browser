import { prisma } from "../../config/db.js";
import { ToolRegistry } from "./tool-registry.js";
import { ToolExecutionContext, InputFieldDefinition } from "./skills.types.js";
import { wsManager } from "../../websocket/ws-server.js";

export interface ExecuteSkillOptions {
  skillId: string;
  version?: number;
  userId: string;
  workspaceId?: string;
  inputs: Record<string, any>;
  caller?: string; // "manual", "agent", "workflow:<id>", "test"
  isTestRun?: boolean;
}

export class SkillExecutorService {
  /**
   * Executes a registered skill version against verified tools
   */
  public static async executeSkill(options: ExecuteSkillOptions) {
    const { skillId, userId, workspaceId, inputs = {}, caller = "manual", isTestRun = false } = options;

    // 1. Fetch Skill from database
    const skill = await prisma.skill.findUnique({
      where: { id: skillId },
      include: {
        versions: true,
      },
    });

    if (!skill) {
      throw new Error(`Skill with ID "${skillId}" not found.`);
    }

    // 2. Lifecycle State Gate
    // Active skills can execute; ready skills can execute only if test run
    if (!isTestRun && skill.lifecycleState !== "active") {
      throw new Error(
        `Skill "${skill.name}" cannot be executed because its lifecycle state is "${skill.lifecycleState}". Skills must be validated and active before execution.`
      );
    }

    if (isTestRun && skill.lifecycleState === "disabled") {
      throw new Error(`Skill "${skill.name}" is disabled and cannot be executed.`);
    }

    // 3. Resolve Target Version
    const targetVersionNumber = options.version || skill.currentVersion;
    const skillVersion = skill.versions.find((v) => v.version === targetVersionNumber);

    if (!skillVersion) {
      throw new Error(`Version ${targetVersionNumber} for skill "${skill.name}" not found.`);
    }

    const inputSchema = (skillVersion.inputSchema as unknown as InputFieldDefinition[]) || [];
    const declaredTools = (skillVersion.tools as unknown as string[]) || [];

    // 4. Validate Inputs
    for (const field of inputSchema) {
      if (field.required && (inputs[field.name] === undefined || inputs[field.name] === null || inputs[field.name] === "")) {
        throw new Error(`Missing required input field "${field.name}" for skill "${skill.name}".`);
      }
    }

    // 5. Create SkillExecution record
    const execution = await prisma.skillExecution.create({
      data: {
        skillId: skill.id,
        skillVersionId: skillVersion.id,
        userId,
        caller,
        status: "running",
        inputs: inputs as object,
        startedAt: new Date(),
      },
    });

    wsManager.broadcast(
      "skill.execution_status",
      { executionId: execution.id, skillId: skill.id, status: "running", caller },
      { userId, workspaceId }
    );

    const startTime = Date.now();
    const toolExecutionsTrace: Array<{
      toolId: string;
      status: "succeeded" | "failed" | "waiting_for_approval";
      durationMs: number;
      outputs: any;
      error?: string;
    }> = [];

    const executionContext: ToolExecutionContext = {
      userId,
      workspaceId,
      skillId: skill.id,
      version: targetVersionNumber,
      executionId: execution.id,
    };

    let accumulatedOutputs: Record<string, any> = { ...inputs };
    let hasWaitingApproval = false;
    let executionError: string | null = null;

    try {
      // 6. Execute registered tools in order
      for (const toolId of declaredTools) {
        const tool = ToolRegistry.get(toolId);
        if (!tool) {
          throw new Error(`Execution halted: Registered capability "${toolId}" not available in runtime.`);
        }

        const toolStart = Date.now();
        try {
          // Pass accumulated inputs/outputs to tool
          const toolResult = await tool.handler(accumulatedOutputs, executionContext);
          const toolDuration = Date.now() - toolStart;

          toolExecutionsTrace.push({
            toolId,
            status: toolResult?.approvalRequired ? "waiting_for_approval" : "succeeded",
            durationMs: toolDuration,
            outputs: toolResult,
          });

          accumulatedOutputs = { ...accumulatedOutputs, ...toolResult };

          if (toolResult?.approvalRequired) {
            hasWaitingApproval = true;
            break; // Pause at approval gate
          }
        } catch (toolErr: any) {
          const toolDuration = Date.now() - toolStart;
          toolExecutionsTrace.push({
            toolId,
            status: "failed",
            durationMs: toolDuration,
            outputs: null,
            error: toolErr?.message || "Tool failure",
          });
          throw toolErr;
        }
      }

      // 7. Success / Paused State
      const durationMs = Date.now() - startTime;
      const finalStatus = hasWaitingApproval ? "waiting_for_approval" : "completed";

      const updated = await prisma.skillExecution.update({
        where: { id: execution.id },
        data: {
          status: finalStatus,
          outputs: accumulatedOutputs as object,
          durationMs,
          toolExecutions: toolExecutionsTrace as unknown as object,
          completedAt: hasWaitingApproval ? null : new Date(),
        },
      });

      wsManager.broadcast(
        "skill.execution_status",
        {
          executionId: execution.id,
          skillId: skill.id,
          status: finalStatus,
          durationMs,
        },
        { userId, workspaceId }
      );

      return updated;
    } catch (err: any) {
      executionError = err?.message || "Skill execution failed.";
      const durationMs = Date.now() - startTime;

      const updated = await prisma.skillExecution.update({
        where: { id: execution.id },
        data: {
          status: "failed",
          error: executionError,
          durationMs,
          toolExecutions: toolExecutionsTrace as unknown as object,
          completedAt: new Date(),
        },
      });

      wsManager.broadcast(
        "skill.execution_status",
        {
          executionId: execution.id,
          skillId: skill.id,
          status: "failed",
          error: executionError,
          durationMs,
        },
        { userId, workspaceId }
      );

      return updated;
    }
  }
}
