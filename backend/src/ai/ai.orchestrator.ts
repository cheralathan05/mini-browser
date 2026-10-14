import { prisma } from "../config/db.js";
import { env } from "../config/env.js";
import { AIProviderFactory } from "./provider-factory.js";
import { AIContextPayload, IntentDetectionResult } from "./ai.types.js";
import { NEXUS_SYSTEM_PROMPT, buildContextPrompt } from "./ai.prompts.js";
import { wsManager } from "../websocket/ws-server.js";

interface OrchestrateOptions {
  conversationId: string;
  userId: string;
  workspaceId: string;
  message: string;
  context?: AIContextPayload;
  model?: string;
  signal?: AbortSignal;
  onToken: (token: string) => void;
  onAction?: (action: IntentDetectionResult["suggestedAction"]) => void;
}

export class AIOrchestrator {
  private static activeControllers = new Map<string, AbortController>();

  public static registerAbortController(conversationId: string, controller: AbortController) {
    this.activeControllers.set(conversationId, controller);
  }

  public static cancel(conversationId: string): boolean {
    const controller = this.activeControllers.get(conversationId);
    if (controller) {
      controller.abort();
      this.activeControllers.delete(conversationId);
      return true;
    }
    return false;
  }

  /**
   * Detects actionable intents such as research agents, workflow builders, or memory persistence.
   */
  public static detectIntent(prompt: string, context?: AIContextPayload): IntentDetectionResult {
    const p = prompt.toLowerCase().trim();

    // 0. Browser Automation & WhatsApp Dispatch detection
    if (
      p.includes("whatsapp") ||
      p.includes("whatpapp") ||
      p.includes("send hi") ||
      (p.includes("send") && (p.includes("number") || p.includes("message") || /\d{5,}/.test(p))) ||
      p.startsWith("go to ") ||
      p.includes("scrape ") ||
      p.includes("fill form") ||
      p.includes("run automation")
    ) {
      return {
        intent: "workflow_automation",
        suggestedAction: {
          type: "launch_agent",
          title: "🚀 Launch Browser Automation",
          description: "Initialize autonomous multi-step real browser execution.",
          payload: { goal: prompt },
        },
      };
    }

    // 1. Research Agent detection
    if (
      p.includes("find competitors") ||
      p.includes("compare frameworks") ||
      p.includes("deep research") ||
      p.includes("research top") ||
      p.includes("find and compare") ||
      p.includes("market analysis") ||
      p.includes("research this topic") ||
      p.includes("research this") ||
      p.includes("start research") ||
      p.startsWith("research ")
    ) {
      return {
        intent: "research_agent",
        suggestedAction: {
          type: "start_research",
          title: "Autonomous Research Investigation",
          description: "Launch deep background crawler and multi-source evidence synthesizer on this topic.",
          payload: { query: prompt },
        },
      };
    }

    // 2. Workflow automation detection
    if (
      p.includes("automate this") ||
      p.includes("every monday") ||
      p.includes("every day") ||
      p.includes("schedule a workflow") ||
      p.includes("build a workflow")
    ) {
      return {
        intent: "workflow_automation",
        suggestedAction: {
          type: "create_workflow",
          title: "Automate Recurring Task",
          description: "Pre-populate Workflow Canvas with trigger, browser extraction, and AI step.",
          payload: { prompt, url: context && "url" in context ? context.url : undefined },
        },
      };
    }

    // 3. Explicit memory saving
    if (
      p.startsWith("remember that") ||
      p.startsWith("save to memory") ||
      p.startsWith("remember this")
    ) {
      return {
        intent: "memory_save",
        suggestedAction: {
          type: "save_memory",
          title: "Save Insight to Memory",
          description: "Persist explicit user knowledge into PostgreSQL memory store.",
          payload: { content: prompt.replace(/^(remember that|save to memory|remember this)\s*/i, "") },
        },
      };
    }

    // 4. Autonomous Coding Agent / Platform Implementation detection
    const pageUrl = context && "url" in context ? String(context.url || "").toLowerCase() : "";
    const isCodingSite = /leetcode|hackerrank|codeforces|onlinegdb|programiz|w3schools|geeksforgeeks|replit|compiler|codewars/i.test(pageUrl);
    if (
      isCodingSite ||
      p.includes("solve this question") ||
      p.includes("write code") ||
      p.includes("solve this problem") ||
      p.includes("solve the problem") ||
      p.includes("implement code") ||
      p.includes("code solution") ||
      p.includes("leetcode") ||
      p.includes("two sum") ||
      p.startsWith("solve ") ||
      p.startsWith("write ")
    ) {
      return {
        intent: "coding_solution",
        suggestedAction: {
          type: "implement_code",
          title: "⚡ Antigravity Code Implementation",
          description: "Directly implant and inject the generated solution into the platform's editor.",
          payload: { prompt, url: pageUrl },
        },
      };
    }

    return { intent: "general" };
  }

  /**
   * Retrieves relevant memories from PostgreSQL based on keyword and importance ranking.
   */
  public static async retrieveRelevantMemories(
    userId: string,
    workspaceId: string,
    prompt: string,
    limit: number = 4
  ): Promise<Array<{ key: string; content: string; type: string }>> {
    try {
      const words = prompt
        .toLowerCase()
        .replace(/[^\w\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 3);

      const conditions: any[] = [];
      if (words.length > 0) {
        for (const word of words.slice(0, 3)) {
          conditions.push({ key: { contains: word, mode: "insensitive" } });
          conditions.push({ content: { contains: word, mode: "insensitive" } });
        }
      }

      const memories = await prisma.memory.findMany({
        where: {
          userId,
          ...(conditions.length > 0 ? { OR: conditions } : {}),
        },
        orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
        take: limit,
        select: { key: true, content: true, type: true },
      });

      return memories;
    } catch {
      return [];
    }
  }

  /**
   * Executes the full AI orchestrator pipeline.
   */
  public static async execute(opts: OrchestrateOptions): Promise<{
    content: string;
    action?: IntentDetectionResult["suggestedAction"];
    modelUsed: string;
  }> {
    const { conversationId, userId, workspaceId, message, context, model, onToken, onAction } = opts;

    // 1. Retrieve relevant memories
    const relevantMemories = await this.retrieveRelevantMemories(userId, workspaceId, message);

    // 2. Fetch active research context if available
    let researchData: { question?: string; findings?: string[] } | undefined = undefined;
    if (context && context.type === "research" && context.projectId) {
      try {
        const project = await prisma.researchProject.findUnique({
          where: { id: context.projectId },
          include: { notes: { take: 5, orderBy: { createdAt: "desc" } } },
        });
        if (project) {
          researchData = {
            question: project.question,
            findings: project.notes.map((n: { content: string }) => n.content),
          };
        }
      } catch {}
    }

    // 3. Build structured context block
    const contextPrompt = buildContextPrompt(context, relevantMemories, researchData);

    // 4. Fetch recent conversation turns for multi-turn coherence
    const previousMessages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { role: true, content: true },
    });
    previousMessages.reverse();

    // Format previous turns
    const conversationHistory = previousMessages
      .map((m: { role: string; content: string }) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n\n");

    const fullPrompt = `${contextPrompt ? `${contextPrompt}\n\n` : ""}${
      conversationHistory ? `=== CONVERSATION HISTORY ===\n${conversationHistory}\n\n` : ""
    }USER: ${message}`;

    // 5. Detect actionable intent
    const intentResult = this.detectIntent(message, context);
    if (intentResult.suggestedAction && onAction) {
      onAction(intentResult.suggestedAction);
    }

    // 6. Route to active provider
    const provider = await AIProviderFactory.getActiveProvider();
    const resolvedModel =
      model ||
      (provider.name === "Ollama"
        ? (provider.getModel ? await provider.getModel() : env.OLLAMA_MODEL)
        : "gpt-4o-mini");

    let streamedContent = "";

    // 7. Stream tokens
    try {
      streamedContent = await provider.stream(
        fullPrompt,
        (chunk) => {
          if (opts.signal?.aborted) return;
          streamedContent += chunk;
          onToken(chunk);
        },
        {
          systemPrompt: NEXUS_SYSTEM_PROMPT,
          model: resolvedModel,
          temperature: 0.3,
          maxTokens: 1500,
        }
      );
    } catch (err: any) {
      if (opts.signal?.aborted) {
        streamedContent = `${streamedContent} [Generation cancelled by user]`;
      } else {
        throw err;
      }
    }

    return {
      content: streamedContent,
      action: intentResult.suggestedAction,
      modelUsed: resolvedModel,
    };
  }
}
