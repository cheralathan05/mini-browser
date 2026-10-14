import { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from "../agent.types.js";
import { prisma } from "../../config/db.js";
import { wsManager } from "../../websocket/ws-server.js";

export const memorySearchTool: ToolDefinition = {
  name: "memory.search",
  description: "Search user long-term memory in PostgreSQL for existing knowledge, preferences, and verified facts.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query or keyword" },
      limit: { type: "number", default: 5 },
    },
    required: ["query"],
  },
  riskLevel: "read_only",
  execute: async (input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const query = String(input.query || "").trim();
    const limit = Number(input.limit || 5);

    const memories = await prisma.memory.findMany({
      where: {
        userId: context.userId,
        status: { not: "DELETED" },
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { content: { contains: query, mode: "insensitive" } },
          { summary: { contains: query, mode: "insensitive" } },
          { key: { contains: query, mode: "insensitive" } },
        ],
      },
      take: limit,
      orderBy: [{ importanceScore: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        type: true,
        category: true,
        summary: true,
        content: true,
        importanceScore: true,
      },
    });

    return {
      success: true,
      result: {
        query,
        count: memories.length,
        memories,
      },
    };
  },
};

export const memorySaveTool: ToolDefinition = {
  name: "memory.save",
  description: "Persist an agent conclusion, discovered fact, or research finding into long-term PostgreSQL memory.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Memory title" },
      content: { type: "string", description: "Detailed content to remember" },
      category: { type: "string", default: "Agent Research" },
      type: { type: "string", default: "RESEARCH" },
      importance: { type: "number", default: 0.8 },
    },
    required: ["title", "content"],
  },
  riskLevel: "safe",
  execute: async (input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const title = String(input.title || "Agent Finding");
    const content = String(input.content || "");
    const category = String(input.category || "Agent Research");
    const type = String(input.type || "RESEARCH").toUpperCase();
    const importance = Number(input.importance || 0.8);

    let memory: any = null;
    try {
      memory = await prisma.memory.create({
        data: {
          userId: context.userId,
          workspaceId: context.workspaceId,
          title,
          key: title.slice(0, 50),
          category,
          type,
          content,
          summary: content.slice(0, 180) + (content.length > 180 ? "..." : ""),
          importanceScore: importance,
          confidenceScore: 0.95,
          status: "ACTIVE",
          isUserVerified: false,
          sourceCount: 1,
          accessCount: 1,
          metadata: {
            taskId: context.taskId,
            runId: context.runId,
            savedBy: "NEXUS_AGENT",
          },
        },
      });
    } catch (memErr: any) {
      if (memErr?.code === "P2003" || memErr?.code === "P2025") {
        return { success: false, error: "User or workspace not found" };
      }
      throw memErr;
    }

    // Record MemoryEvent
    await prisma.memoryEvent.create({
      data: {
        memoryId: memory.id,
        userId: context.userId,
        workspaceId: context.workspaceId,
        eventType: "AGENT_RESULT_SAVED",
        title: `Saved from Agent Task: ${title}`,
        metadata: { taskId: context.taskId, runId: context.runId },
      },
    });

    wsManager.broadcast(
      "memory.created",
      { memory },
      { userId: context.userId, workspaceId: context.workspaceId }
    );

    return {
      success: true,
      result: {
        memoryId: memory.id,
        title: memory.title,
        saved: true,
      },
    };
  },
};
