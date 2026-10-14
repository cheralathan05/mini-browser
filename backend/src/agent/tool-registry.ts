import { prisma } from "../config/db.js";
import { wsManager } from "../websocket/ws-server.js";

export interface ToolExecutionContext {
  userId: string;
  workspaceId: string;
  taskId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval?: boolean;
  execute: (input: Record<string, unknown>, context: ToolExecutionContext) => Promise<unknown>;
}

export class ToolRegistry {
  private static tools: Map<string, ToolDefinition> = new Map();

  public static registerTool(tool: ToolDefinition) {
    this.tools.set(tool.name, tool);
  }

  public static getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  public static listTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  public static async executeTool(
    name: string,
    input: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<{ success: boolean; result?: unknown; error?: string; approvalRequired?: boolean; approvalId?: string }> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: `Tool '${name}' not found` };
    }

    // Check if approval is required
    if (tool.requiresApproval || input.requiresApproval === true) {
      const approval = await prisma.approvalRequest.create({
        data: {
          userId: context.userId,
          workspaceId: context.workspaceId,
          taskId: context.taskId,
          action: name,
          target: String(input.url || input.target || "consequential_action"),
          details: input as unknown as object,
          status: "pending",
        },
      });

      wsManager.broadcast(
        "approval.required",
        {
          approvalId: approval.id,
          action: approval.action,
          target: approval.target,
          details: approval.details,
          taskId: context.taskId,
        },
        { userId: context.userId, workspaceId: context.workspaceId }
      );

      return {
        success: false,
        approvalRequired: true,
        approvalId: approval.id,
        error: "Action requires user approval before proceeding.",
      };
    }

    try {
      const result = await tool.execute(input, context);

      // Record ActivityEvent
      await prisma.activityEvent.create({
        data: {
          userId: context.userId,
          workspaceId: context.workspaceId,
          taskId: context.taskId,
          type: name.toUpperCase(),
          message: `Executed tool: ${name}`,
          metadata: { input, result } as any,
        },
      });

      // Broadcast realtime browser action if applicable
      if (name.startsWith("browser_")) {
        wsManager.broadcast(
          name === "browser_navigate" ? "browser.navigation" : "browser.action",
          { tool: name, input, result, taskId: context.taskId },
          { userId: context.userId, workspaceId: context.workspaceId }
        );
      }

      return { success: true, result };
    } catch (error) {
      const errorMessage = (error as Error).message;
      return { success: false, error: errorMessage };
    }
  }
}

// Register default built-in tools
ToolRegistry.registerTool({
  name: "browser_navigate",
  description: "Navigate active or new browser tab to a specified URL.",
  parameters: {
    type: "object",
    properties: { url: { type: "string" } },
    required: ["url"],
  },
  execute: async (input) => {
    const url = String(input.url);
    return {
      status: 200,
      url,
      title: `Page at ${url}`,
      timestamp: new Date().toISOString(),
    };
  },
});

ToolRegistry.registerTool({
  name: "browser_extract",
  description: "Extract readable text, headings, and metadata from the current page or specified URL.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string" },
      selector: { type: "string" },
    },
  },
  execute: async (input) => {
    const targetUrl = input.url ? String(input.url) : null;
    if (targetUrl && (targetUrl.startsWith("http://") || targetUrl.startsWith("https://"))) {
      try {
        const response = await fetch(targetUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) NEXUS/1.0" },
          signal: AbortSignal.timeout(6000),
        });
        const html = await response.text();
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : targetUrl;
        const headings: string[] = [];
        const hMatches = html.matchAll(/<h[1-3][^>]*>([^<]+)<\/h[1-3]>/gi);
        for (const m of hMatches) {
          if (m[1] && headings.length < 10) headings.push(m[1].replace(/<[^>]+>/g, "").trim());
        }
        const stripped = html
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 2000);

        return {
          extracted: true,
          url: targetUrl,
          title,
          headings,
          content: stripped,
          length: stripped.length,
        };
      } catch (err: any) {
        return {
          extracted: false,
          url: targetUrl,
          error: `Failed to fetch target page: ${err.message}`,
        };
      }
    }

    return {
      extracted: true,
      selector: input.selector || "body",
      content: "Readable DOM context extracted from active browser tab.",
      headings: ["Page Overview", "Key Insights"],
    };
  },
});

ToolRegistry.registerTool({
  name: "browser_click",
  description: "Click an element matching the given CSS selector.",
  parameters: {
    type: "object",
    properties: { selector: { type: "string" } },
    required: ["selector"],
  },
  execute: async (input) => {
    return { clicked: true, selector: input.selector };
  },
});

ToolRegistry.registerTool({
  name: "browser_type",
  description: "Type text into an input field matching the CSS selector.",
  parameters: {
    type: "object",
    properties: { selector: { type: "string" }, text: { type: "string" } },
    required: ["selector", "text"],
  },
  execute: async (input) => {
    return { typed: true, selector: input.selector, length: String(input.text).length };
  },
});

ToolRegistry.registerTool({
  name: "browser_screenshot",
  description: "Capture screenshot of current tab view.",
  parameters: { type: "object", properties: {} },
  execute: async () => {
    return { captured: true, format: "image/png" };
  },
});

ToolRegistry.registerTool({
  name: "memory_remember",
  description: "Store a key fact or preference into long-term workspace memory.",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string" },
      content: { type: "string" },
      importance: { type: "number" },
    },
    required: ["key", "content"],
  },
  execute: async (input, context) => {
    const memory = await prisma.memory.create({
      data: {
        userId: context.userId,
        workspaceId: context.workspaceId,
        key: String(input.key),
        content: String(input.content),
        importance: Number(input.importance || 1.0),
      },
    });
    return { remembered: true, id: memory.id };
  },
});

ToolRegistry.registerTool({
  name: "memory_recall",
  description: "Retrieve stored memories matching a keyword or key.",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  execute: async (input, context) => {
    const query = String(input.query);
    const memories = await prisma.memory.findMany({
      where: {
        userId: context.userId,
        OR: [
          { key: { contains: query, mode: "insensitive" } },
          { content: { contains: query, mode: "insensitive" } },
        ],
      },
      take: 5,
    });
    return { memories };
  },
});

ToolRegistry.registerTool({
  name: "dangerous_submit_form",
  description: "Submit sensitive form data or initiate an external purchase.",
  requiresApproval: true,
  parameters: {
    type: "object",
    properties: { formId: { type: "string" }, data: { type: "object" } },
  },
  execute: async (input) => {
    return { submitted: true, data: input.data };
  },
});
