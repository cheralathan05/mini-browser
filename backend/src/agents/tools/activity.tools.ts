import { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from "../agent.types.js";
import { prisma } from "../../config/db.js";
import { wsManager } from "../../websocket/ws-server.js";

export const activityLogTool: ToolDefinition = {
  name: "activity.log",
  description: "Log an operational milestone or security-relevant audit event into PostgreSQL ActivityEvent store.",
  parameters: {
    type: "object",
    properties: {
      type: { type: "string", description: "Event type identifier" },
      message: { type: "string", description: "Human-readable activity summary" },
      metadata: { type: "object", description: "Arbitrary structured context" },
    },
    required: ["type", "message"],
  },
  riskLevel: "safe",
  execute: async (input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const type = String(input.type || "AGENT_ACTION").toUpperCase();
    const message = String(input.message || "");
    const metadata = (input.metadata || {}) as Record<string, unknown>;

    const event = await prisma.activityEvent.create({
      data: {
        userId: context.userId,
        workspaceId: context.workspaceId,
        taskId: context.taskId,
        agentRunId: context.runId,
        type,
        message,
        metadata: metadata as any,
      },
    });

    wsManager.broadcast(
      "agent.stepCompleted",
      { eventId: event.id, type, message, taskId: context.taskId, runId: context.runId },
      { userId: context.userId, workspaceId: context.workspaceId }
    );

    return {
      success: true,
      result: { eventId: event.id, type, message },
    };
  },
};
