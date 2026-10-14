import { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from "../agent.types.js";
import { prisma } from "../../config/db.js";

export const workflowCreateTool: ToolDefinition = {
  name: "workflow.create",
  description: "Create an automated workflow pipeline in the NEXUS Workflow engine for scheduled or recurring automation.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Workflow name" },
      description: { type: "string", description: "Workflow description" },
      schedule: { type: "string", description: "Cron expression or trigger condition" },
      steps: { type: "array", items: { type: "object" }, description: "Workflow step definitions" },
    },
    required: ["name"],
  },
  riskLevel: "safe",
  execute: async (input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const name = String(input.name);
    const description = String(input.description || "");
    const schedule = String(input.schedule || "0 9 * * *");
    const steps = Array.isArray(input.steps) && input.steps.length > 0
      ? input.steps
      : [
          { id: "step_1", type: "browser.navigate", name: "Navigate to Source" },
          { id: "step_2", type: "browser.extract", name: "Extract Intelligence" },
          { id: "step_3", type: "memory.save", name: "Store in Long-term Memory" },
        ];

    const workflow = await prisma.workflow.create({
      data: {
        workspaceId: context.workspaceId,
        name,
        description,
        status: "active",
        definition: {
          trigger: { type: "schedule", cron: schedule },
          steps,
        },
      },
    });

    return {
      success: true,
      result: {
        workflowId: workflow.id,
        name: workflow.name,
        stepsCount: steps.length,
        status: workflow.status,
      },
    };
  },
};
