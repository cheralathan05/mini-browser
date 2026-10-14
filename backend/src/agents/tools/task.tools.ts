import { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from "../agent.types.js";
import { prisma } from "../../config/db.js";

export const taskCreateTool: ToolDefinition = {
  name: "task.create",
  description: "Create a sub-task or follow-up autonomous agent task in PostgreSQL.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Task title" },
      goal: { type: "string", description: "Goal or objective description" },
      priority: { type: "string", enum: ["low", "medium", "high"], default: "medium" },
    },
    required: ["title", "goal"],
  },
  riskLevel: "safe",
  execute: async (input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const title = String(input.title);
    const goal = String(input.goal);
    const priority = String(input.priority || "medium");

    const task = await prisma.agentTask.create({
      data: {
        userId: context.userId,
        workspaceId: context.workspaceId,
        spaceId: context.spaceId,
        title,
        goal,
        priority,
        status: "READY",
      },
    });

    return {
      success: true,
      result: {
        taskId: task.id,
        title: task.title,
        status: task.status,
      },
    };
  },
};

export const taskUpdateTool: ToolDefinition = {
  name: "task.update",
  description: "Update status or priority of a task.",
  parameters: {
    type: "object",
    properties: {
      taskId: { type: "string" },
      status: { type: "string" },
      priority: { type: "string" },
    },
    required: ["taskId"],
  },
  riskLevel: "safe",
  execute: async (input: Record<string, unknown>): Promise<ToolExecutionResult> => {
    const taskId = String(input.taskId);
    const status = input.status ? String(input.status) : undefined;
    const priority = input.priority ? String(input.priority) : undefined;

    const task = await prisma.agentTask.update({
      where: { id: taskId },
      data: {
        ...(status ? { status } : {}),
        ...(priority ? { priority } : {}),
      },
    });

    return {
      success: true,
      result: { taskId: task.id, status: task.status },
    };
  },
};
