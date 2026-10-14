import { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from "../agent.types.js";
import { prisma } from "../../config/db.js";
import { wsManager } from "../../websocket/ws-server.js";
import { sanitizeForDb } from "../agent.utils.js";

// Import all tools
import {
  browserNavigateTool,
  browserBackTool,
  browserForwardTool,
  browserReloadTool,
  browserClickTool,
  browserTypeTool,
  browserPressKeyTool,
  browserScrollTool,
  browserHoverTool,
  browserExtractTool,
  browserGetCurrentPageTool,
  browserWaitForSelectorTool,
  browserFindElementTool,
  browserSubmitActionTool,
  browserWhatsappSendTool,
  browserFillFormTool,
  browserExecuteScriptTool,
} from "./browser.tools.js";
import { researchSearchTool, researchCreateTool, researchGetReportTool } from "./research.tools.js";
import { memorySearchTool, memorySaveTool } from "./memory.tools.js";
import { workflowCreateTool } from "./workflow.tools.js";
import { taskCreateTool, taskUpdateTool } from "./task.tools.js";
import { activityLogTool } from "./activity.tools.js";

export class ToolRegistry {
  private static tools: Map<string, ToolDefinition> = new Map();

  public static initialize() {
    if (this.tools.size > 0) return;

    // Browser tools (all 13 core tools)
    this.register(browserNavigateTool);
    this.register(browserBackTool);
    this.register(browserForwardTool);
    this.register(browserReloadTool);
    this.register(browserClickTool);
    this.register(browserTypeTool);
    this.register(browserPressKeyTool);
    this.register(browserScrollTool);
    this.register(browserHoverTool);
    this.register(browserExtractTool);
    this.register(browserGetCurrentPageTool);
    this.register(browserWaitForSelectorTool);
    this.register(browserFindElementTool);

    // Consequential / Approval-Gated Tools
    this.register(browserSubmitActionTool);
    this.register(browserWhatsappSendTool);
    this.register(browserFillFormTool);
    this.register(browserExecuteScriptTool);

    // Research tools
    this.register(researchSearchTool);
    this.register(researchCreateTool);
    this.register(researchGetReportTool);

    // Memory tools
    this.register(memorySearchTool);
    this.register(memorySaveTool);

    // Automation & Management tools
    this.register(workflowCreateTool);
    this.register(taskCreateTool);
    this.register(taskUpdateTool);
    this.register(activityLogTool);

    // Backward-compatibility and semantic aliases
    this.tools.set("browser_navigate", browserNavigateTool);
    this.tools.set("browser_extract", browserExtractTool);
    this.tools.set("browser_click", browserClickTool);
    this.tools.set("browser_type", browserTypeTool);
    this.tools.set("browser_press", browserPressKeyTool);
    this.tools.set("browser.pressKey", browserPressKeyTool);
    this.tools.set("browser_pressKey", browserPressKeyTool);
    this.tools.set("browser.wait", browserWaitForSelectorTool);
    this.tools.set("browser_wait", browserWaitForSelectorTool);
    this.tools.set("browser.waitForSelector", browserWaitForSelectorTool);
    this.tools.set("browser_waitForSelector", browserWaitForSelectorTool);
    this.tools.set("browser_findElement", browserFindElementTool);
    this.tools.set("browser_back", browserBackTool);
    this.tools.set("browser_forward", browserForwardTool);
    this.tools.set("browser_reload", browserReloadTool);
    this.tools.set("browser_hover", browserHoverTool);
    this.tools.set("whatsapp.send", browserWhatsappSendTool);
    this.tools.set("whatsapp_send", browserWhatsappSendTool);
    this.tools.set("browser.whatsapp", browserWhatsappSendTool);
    this.tools.set("browser_whatsapp", browserWhatsappSendTool);
    this.tools.set("memory_remember", memorySaveTool);
    this.tools.set("memory_recall", memorySearchTool);
  }

  public static register(tool: ToolDefinition) {
    this.tools.set(tool.name, tool);
  }

  public static get(name: string): ToolDefinition | undefined {
    this.initialize();
    return this.tools.get(name);
  }

  public static list(): ToolDefinition[] {
    this.initialize();
    return Array.from(new Set(this.tools.values()));
  }

  public static async execute(
    name: string,
    input: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    this.initialize();

    // Canonicalize tool name
    const normalizedName = name.replace(/_/g, ".");
    const tool = this.tools.get(name) || this.tools.get(normalizedName);

    if (!tool) {
      return {
        success: false,
        error: `Tool '${name}' not found in NEXUS registry. Available tools: ${Array.from(this.tools.keys()).join(", ")}`,
      };
    }

    // Check approval requirement
    if (tool.requiresApproval || input.requiresApproval === true || tool.riskLevel === "critical_approval") {
      const approval = await prisma.approvalRequest.create({
        data: {
          userId: context.userId,
          workspaceId: context.workspaceId,
          taskId: context.taskId,
          agentRunId: context.runId,
          action: tool.name,
          target: String(input.targetUrl || input.target || input.url || tool.name),
          details: input as any,
          status: "pending",
        },
      });

      // Broadcast approval required
      wsManager.broadcast(
        "agent.approvalRequired",
        {
          approvalId: approval.id,
          taskId: context.taskId,
          runId: context.runId,
          stepId: context.stepId,
          toolName: tool.name,
          action: approval.action,
          target: approval.target,
          details: approval.details,
        },
        { userId: context.userId, workspaceId: context.workspaceId }
      );

      wsManager.broadcast(
        "approval.required",
        {
          approvalId: approval.id,
          taskId: context.taskId,
          action: approval.action,
          target: approval.target,
          details: approval.details,
        },
        { userId: context.userId, workspaceId: context.workspaceId }
      );

      return {
        success: false,
        approvalRequired: true,
        approvalId: approval.id,
        error: `Action '${tool.name}' requires explicit user approval before execution.`,
      };
    }

    const t0 = Date.now();

    wsManager.broadcast(
      "agent.toolStarted",
      {
        taskId: context.taskId,
        runId: context.runId,
        stepId: context.stepId,
        toolName: tool.name,
        input,
      },
      { userId: context.userId, workspaceId: context.workspaceId }
    );

    try {
      const result = await tool.execute(input, context);
      const durationMs = result.durationMs ?? (Date.now() - t0);

      // Persist ToolCall record in PostgreSQL
      if (context.runId) {
        try {
          await prisma.agentToolCall.create({
            data: {
              agentRunId: context.runId,
              agentStepId: context.stepId,
              toolName: tool.name,
              input: sanitizeForDb(input) as any,
              output: sanitizeForDb(result.result || result.error || {}) as any,
              status: result.success ? "completed" : "failed",
              durationMs,
              error: sanitizeForDb(result.error),
            },
          });
        } catch (dbErr: any) {
          if (dbErr?.code !== "P2003" && dbErr?.code !== "P2025") {
            console.warn("[ToolRegistry] Could not persist AgentToolCall:", dbErr);
          }
        }
      }

      wsManager.broadcast(
        "agent.toolCompleted",
        {
          taskId: context.taskId,
          runId: context.runId,
          stepId: context.stepId,
          toolName: tool.name,
          success: result.success,
          durationMs,
          error: result.error,
        },
        { userId: context.userId, workspaceId: context.workspaceId }
      );

      return { ...result, durationMs };
    } catch (error: any) {
      const durationMs = Date.now() - t0;
      const errorMsg = error.message || "Unknown error executing tool";

      wsManager.broadcast(
        "agent.toolCompleted",
        {
          taskId: context.taskId,
          runId: context.runId,
          stepId: context.stepId,
          toolName: tool.name,
          success: false,
          durationMs,
          error: errorMsg,
        },
        { userId: context.userId, workspaceId: context.workspaceId }
      );

      return {
        success: false,
        durationMs,
        error: errorMsg,
      };
    }
  }
}

// Pre-initialize registry on module load
ToolRegistry.initialize();
