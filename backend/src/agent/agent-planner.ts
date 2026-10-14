import { AIProviderFactory } from "../ai/provider-factory.js";

export interface PlannedStep {
  type: "plan" | "tool_call" | "observation" | "verification" | "answer";
  name: string;
  tool?: string;
  input?: Record<string, unknown>;
  description: string;
}

export class AgentPlanner {
  public static async generatePlan(goal: string): Promise<PlannedStep[]> {
    const provider = await AIProviderFactory.getActiveProvider();

    const systemPrompt = `You are the NEXUS BROWSER Agent Planner. Deconstruct the user's browser goal into 3-5 sequential execution steps.
Output ONLY a raw valid JSON array of objects with fields:
- type: "tool_call" | "verification" | "answer"
- name: short step name
- tool: "browser_navigate" | "browser_extract" | "browser_click" | "memory_remember" | "memory_recall" (optional)
- input: parameters for the tool (optional)
- description: human-readable explanation of this step`;

    try {
      const response = await provider.generate(`Goal: ${goal}`, {
        systemPrompt,
        temperature: 0.2,
      });

      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as PlannedStep[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn("[AgentPlanner] AI planning failed, using deterministic fallback:", e);
    }

    // Deterministic fallback plan
    const isResearch = goal.toLowerCase().includes("research") || goal.toLowerCase().includes("compare");
    if (isResearch) {
      return [
        {
          type: "tool_call",
          name: "Identify & Navigate Sources",
          tool: "browser_navigate",
          input: { url: "https://news.ycombinator.com" },
          description: "Navigate to primary information sources to gather context.",
        },
        {
          type: "tool_call",
          name: "Extract Page Data",
          tool: "browser_extract",
          input: { selector: "body" },
          description: "Extract structured text and references from page.",
        },
        {
          type: "answer",
          name: "Synthesize Findings",
          description: "Synthesize findings into an executive report.",
        },
      ];
    }

    return [
      {
        type: "tool_call",
        name: "Navigate to Target",
        tool: "browser_navigate",
        input: { url: "https://duckduckgo.com" },
        description: "Initiate web session for requested action.",
      },
      {
        type: "verification",
        name: "Verify Content",
        description: "Check page loaded and matches user criteria.",
      },
      {
        type: "answer",
        name: "Complete Action",
        description: "Finalize task and present result.",
      },
    ];
  }
}
