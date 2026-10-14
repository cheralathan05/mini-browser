import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { optionalAuth } from "../../middleware/auth.js";
import { RequestWithId } from "../../middleware/logger.js";
import { AIProviderFactory } from "../../ai/provider-factory.js";
import { wsManager } from "../../websocket/ws-server.js";

const router = Router();

const intentRequestSchema = z.object({
  query: z.string().min(1),
  spaceId: z.string().optional(),
  currentUrl: z.string().optional(),
  execute: z.boolean().optional().default(false),
});

export type NexusIntent =
  | "navigate"
  | "search_web"
  | "ask_ai"
  | "launch_agent"
  | "start_research"
  | "create_workflow"
  | "query_memory"
  | "open_page";

interface IntentResult {
  intent: NexusIntent;
  action: string;
  confidence: number;
  target?: string;
  summary: string;
  data?: Record<string, unknown>;
}

function parseRuleBasedIntent(query: string): IntentResult | null {
  const trimmed = query.trim();

  // 1. Direct URL check
  const urlPattern = /^(https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d+)?(\/\S*)?$/i;
  const localhostPattern = /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?(\/\S*)?$/i;
  if (urlPattern.test(trimmed) || localhostPattern.test(trimmed)) {
    const fullUrl = trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;
    return {
      intent: "navigate",
      action: "open_url",
      confidence: 0.99,
      target: fullUrl,
      summary: `Navigate directly to ${fullUrl}`,
    };
  }

  // 2. Named Quick Jump shortcuts
  const lower = trimmed.toLowerCase();
  const siteShortcuts: Record<string, string> = {
    "open github": "https://github.com",
    "github": "https://github.com",
    "open youtube": "https://youtube.com",
    "youtube": "https://youtube.com",
    "open google": "https://google.com",
    "open twitter": "https://x.com",
    "open x": "https://x.com",
    "open reddit": "https://reddit.com",
    "open huggingface": "https://huggingface.co",
    "huggingface": "https://huggingface.co",
    "open arxiv": "https://arxiv.org",
    "arxiv": "https://arxiv.org",
  };
  if (siteShortcuts[lower]) {
    return {
      intent: "navigate",
      action: "open_url",
      confidence: 0.98,
      target: siteShortcuts[lower],
      summary: `Open ${siteShortcuts[lower]}`,
    };
  }

  // 3. Research triggers
  if (
    lower.startsWith("research ") ||
    lower.startsWith("find papers ") ||
    lower.startsWith("deep research ") ||
    lower.includes("literature review") ||
    lower.includes("competitor analysis")
  ) {
    const topic = trimmed.replace(/^(research|deep research|find papers about|find papers on|investigate)\s+/i, "");
    return {
      intent: "start_research",
      action: "create_research_project",
      confidence: 0.95,
      target: topic,
      summary: `Initiate deep research project: "${topic}"`,
    };
  }

  // 4. Memory triggers
  if (
    lower.includes("memory") ||
    lower.startsWith("what did i ") ||
    lower.startsWith("what was the project ") ||
    lower.startsWith("what project was i ") ||
    lower.startsWith("recall ") ||
    lower.startsWith("remember ")
  ) {
    return {
      intent: "query_memory",
      action: "search_memory",
      confidence: 0.92,
      target: trimmed,
      summary: `Search persistent memory for: "${trimmed}"`,
    };
  }

  // 5. Workflow triggers
  if (
    lower.includes("workflow") ||
    lower.startsWith("automate ") ||
    lower.includes("automation pipeline")
  ) {
    const name = trimmed.replace(/^(create|build|make|start|new)?(\s+a)?\s+workflow(\s+for|\s+to)?\s*/i, "").replace(/^automate\s+/i, "");
    return {
      intent: "create_workflow",
      action: "define_workflow",
      confidence: 0.95,
      target: name || trimmed,
      summary: `Build workflow automation: "${name || trimmed}"`,
    };
  }

  // 6. Agent triggers
  if (
    lower.includes("agent") ||
    lower.startsWith("browse and find ") ||
    lower.startsWith("crawl ") ||
    lower.startsWith("scrape ")
  ) {
    const task = trimmed.replace(/^(run|launch|start|deploy)?(\s+an?|\s+my)?\s+agent(\s+to|\s+for)?\s*/i, "");
    return {
      intent: "launch_agent",
      action: "execute_agent_task",
      confidence: 0.95,
      target: task || trimmed,
      summary: `Deploy autonomous browser agent for: "${task || trimmed}"`,
    };
  }

  // 7. Navigation command (internal pages)
  const internalPages: Record<string, string> = {
    "dashboard": "dashboard",
    "open dashboard": "dashboard",
    "agent": "agent",
    "open agent": "agent",
    "research": "research",
    "open research": "research",
    "workflows": "workflows",
    "open workflows": "workflows",
    "memory": "memory",
    "open memory": "memory",
    "skills": "skills",
    "open skills": "skills",
    "approvals": "approvals",
    "open approvals": "approvals",
    "activity": "activity",
    "open activity": "activity",
    "settings": "settings",
    "open settings": "settings",
  };
  if (internalPages[lower]) {
    return {
      intent: "open_page",
      action: "navigate_internal",
      confidence: 0.99,
      target: internalPages[lower],
      summary: `Switch to ${internalPages[lower]} view`,
    };
  }

  // 8. Q&A / AI Question
  if (
    lower.startsWith("how ") ||
    lower.startsWith("what ") ||
    lower.startsWith("why ") ||
    lower.startsWith("who ") ||
    lower.startsWith("when ") ||
    lower.startsWith("explain ") ||
    lower.startsWith("summarize ") ||
    lower.startsWith("compare ")
  ) {
    return {
      intent: "ask_ai",
      action: "ai_chat",
      confidence: 0.88,
      target: trimmed,
      summary: `Ask NEXUS AI: "${trimmed}"`,
    };
  }

  return null;
}

// POST /api/nexus/intent
router.post("/intent", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const { query, spaceId, currentUrl, execute } = intentRequestSchema.parse(req.body);

    // Step 1: Rule-based fast intent detection
    let result = parseRuleBasedIntent(query);

    // Step 2: AI model fallback if ambiguous
    if (!result || result.confidence < 0.85) {
      const provider = await AIProviderFactory.getActiveProvider();
      const prompt = `You are the intent router for NEXUS Browser.
Analyze this user input from the browser omnibox:
"${query}"

Classify into exactly one of these intents:
- "navigate": user wants to visit a specific website or URL
- "search_web": general web search
- "ask_ai": conversational or conceptual question for AI
- "launch_agent": user asks an agent to do a web task or automation
- "start_research": deep research, gathering papers, or market study
- "create_workflow": workflow or recurring automation pipeline
- "query_memory": asking about past notes, saved facts, or projects
- "open_page": navigation to internal section (dashboard, agent, research, workflows, memory, skills, approvals, activity, settings)

Return strictly valid JSON only:
{
  "intent": "<one of the above>",
  "action": "<short verb action>",
  "confidence": <0.0 to 1.0>,
  "target": "<extracted target URL, topic, or search term>",
  "summary": "<one sentence user-friendly summary>"
}`;

      try {
        const aiOutput = await provider.generate(prompt, { temperature: 0.1 });
        const jsonMatch = aiOutput.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as {
            intent: NexusIntent;
            action: string;
            confidence: number;
            target?: string;
            summary: string;
          };
          result = {
            intent: parsed.intent || "search_web",
            action: parsed.action || "web_search",
            confidence: parsed.confidence || 0.85,
            target: parsed.target || query,
            summary: parsed.summary || `Process: "${query}"`,
          };
        }
      } catch {
        // Fallback to web search
        result = {
          intent: "search_web",
          action: "web_search",
          confidence: 0.75,
          target: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
          summary: `Search the web for "${query}"`,
        };
      }
    }

    if (!result) {
      result = {
        intent: "search_web",
        action: "web_search",
        confidence: 0.8,
        target: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
        summary: `Search the web for "${query}"`,
      };
    }

    // Step 3: Optional immediate execution if requested
    if (execute) {
      const targetUserId = req.user?.id;
      const workspace = targetUserId
        ? (await prisma.workspace.findFirst({
            where: { userId: targetUserId, id: spaceId || undefined },
          })) ||
          (await prisma.workspace.findFirst({
            where: { userId: targetUserId },
          }))
        : await prisma.workspace.findFirst();

      const wsId = workspace?.id;

      if (result.intent === "start_research" && wsId) {
        const project = await prisma.researchProject.create({
          data: {
            workspaceId: wsId,
            name: result.target || query,
            question: query,
            status: "planning",
          },
        });
        result.data = { projectId: project.id };

        wsManager.broadcast(
          "research.project.created",
          { project },
          { userId: req.user!.id, workspaceId: wsId }
        );
      } else if (result.intent === "launch_agent" && wsId) {
        const task = await prisma.agentTask.create({
          data: {
            userId: req.user!.id,
            workspaceId: wsId,
            title: result.target || query,
            goal: query,
            status: "pending",
            priority: "high",
          },
        });
        result.data = { taskId: task.id };

        wsManager.broadcast(
          "agent.task.created",
          { task },
          { userId: req.user!.id, workspaceId: wsId }
        );
      } else if (result.intent === "query_memory" && wsId) {
        const memories = await prisma.memory.findMany({
          where: {
            workspaceId: wsId,
            content: { contains: result.target || query, mode: "insensitive" },
          },
          take: 5,
        });
        result.data = { memories };
      }
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});

export { router as nexusIntentRouter };
