import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { optionalAuth } from "../../middleware/auth.js";
import { RequestWithId } from "../../middleware/logger.js";
import { AppError } from "../../middleware/error.js";
import { CodeExecutionService } from "./code-execution.service.js";
import { CaptureService } from "../captures/capture.service.js";
import { AIProviderFactory } from "../../ai/provider-factory.js";

const router = Router();

// Helper to resolve user
async function resolveUser(req: RequestWithId): Promise<string> {
  if (req.user?.id) return req.user.id;
  const firstUser = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (firstUser) return firstUser.id;
  const created = await prisma.user.create({
    data: {
      email: "developer@nexus.local",
      name: "NEXUS Developer",
      passwordHash: "local",
    },
  });
  return created.id;
}

const createProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  language: z.string().default("python"),
  problemTitle: z.string().optional(),
  problemStatement: z.string().optional(),
  problemUrl: z.string().optional(),
  code: z.string().optional().default(""),
  testCases: z.array(z.object({ input: z.string(), expectedOutput: z.string().optional() })).optional(),
  workspaceId: z.string().optional(),
});

const updateProjectSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  language: z.string().optional(),
  problemTitle: z.string().optional(),
  problemStatement: z.string().optional(),
  problemUrl: z.string().optional(),
  currentCode: z.string().optional(),
  timeComplexity: z.string().optional(),
  spaceComplexity: z.string().optional(),
  explanation: z.string().optional(),
  testCases: z.array(z.unknown()).optional(),
});

const executeSchema = z.object({
  language: z.string(),
  code: z.string().min(1),
  stdin: z.string().optional(),
  testCases: z.array(z.object({ input: z.string(), expectedOutput: z.string().optional() })).optional(),
  projectId: z.string().optional(),
  timeoutMs: z.number().optional(),
});

const saveVersionSchema = z.object({
  code: z.string().min(1),
  description: z.string().optional(),
  fileId: z.string().optional(),
});

// 1. GET /api/coding/projects - List coding projects
router.get("/projects", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const workspaceId = req.query.workspaceId as string | undefined;

    const projects = await prisma.codingProject.findMany({
      where: {
        userId,
        workspaceId: workspaceId || undefined,
      },
      include: {
        _count: {
          select: { versions: true, files: true, executions: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    res.json({ projects });
  } catch (err) {
    next(err);
  }
});

// 2. POST /api/coding/projects - Create project
router.post("/projects", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const body = createProjectSchema.parse(req.body);

    let wsId = body.workspaceId;
    if (!wsId) {
      const ws = await prisma.workspace.findFirst({ where: { userId } });
      wsId = ws?.id;
    }

    const defaultStarter = body.code || (body.language.toLowerCase().includes("python")
      ? `def solve():\n    # Optimal solution for ${body.name}\n    pass\n\nif __name__ == '__main__':\n    solve()\n`
      : `function solve() {\n    // Optimal solution for ${body.name}\n}\n\nsolve();\n`);

    const project = await prisma.codingProject.create({
      data: {
        userId,
        workspaceId: wsId,
        name: body.name,
        description: body.description,
        language: body.language,
        problemTitle: body.problemTitle || body.name,
        problemStatement: body.problemStatement,
        problemUrl: body.problemUrl,
        currentCode: defaultStarter,
        testCases: body.testCases || [],
      },
    });

    // Create initial version
    await prisma.codeVersion.create({
      data: {
        projectId: project.id,
        versionNumber: 1,
        content: defaultStarter,
        description: "Initial template creation",
      },
    });

    res.status(201).json({ project });
  } catch (err) {
    next(err);
  }
});

// 3. GET /api/coding/projects/:id - Retrieve project detail with history
router.get("/projects/:id", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const project = await prisma.codingProject.findFirst({
      where: { id: req.params.id, userId },
      include: {
        files: true,
        versions: { orderBy: { versionNumber: "desc" } },
        executions: { orderBy: { createdAt: "desc" }, take: 10 },
      },
    });

    if (!project) {
      throw new AppError("Coding project not found", 404, "NOT_FOUND");
    }

    res.json({ project });
  } catch (err) {
    next(err);
  }
});

// 4. PATCH /api/coding/projects/:id - Update project
router.patch("/projects/:id", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const body = updateProjectSchema.parse(req.body);

    const project = await prisma.codingProject.findFirst({
      where: { id: req.params.id, userId },
    });

    if (!project) {
      throw new AppError("Coding project not found", 404, "NOT_FOUND");
    }

    const updated = await prisma.codingProject.update({
      where: { id: project.id },
      data: {
        name: body.name,
        description: body.description,
        language: body.language,
        problemTitle: body.problemTitle,
        problemStatement: body.problemStatement,
        problemUrl: body.problemUrl,
        currentCode: body.currentCode,
        timeComplexity: body.timeComplexity,
        spaceComplexity: body.spaceComplexity,
        explanation: body.explanation,
        testCases: body.testCases !== undefined ? (body.testCases as any) : undefined,
      },
    });

    res.json({ project: updated });
  } catch (err) {
    next(err);
  }
});

// 5. DELETE /api/coding/projects/:id - Delete project
router.delete("/projects/:id", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const project = await prisma.codingProject.findFirst({
      where: { id: req.params.id, userId },
    });

    if (!project) {
      throw new AppError("Coding project not found", 404, "NOT_FOUND");
    }

    await prisma.codingProject.delete({ where: { id: project.id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// 6. POST /api/coding/projects/:id/versions - Create a version snapshot
router.post("/projects/:id/versions", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const body = saveVersionSchema.parse(req.body);

    const project = await prisma.codingProject.findFirst({
      where: { id: req.params.id, userId },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });

    if (!project) {
      throw new AppError("Coding project not found", 404, "NOT_FOUND");
    }

    const nextVer = (project.versions[0]?.versionNumber || 0) + 1;

    const version = await prisma.codeVersion.create({
      data: {
        projectId: project.id,
        versionNumber: nextVer,
        content: body.code,
        description: body.description || `Snapshot v${nextVer}`,
        fileId: body.fileId,
      },
    });

    // Also update project currentCode
    await prisma.codingProject.update({
      where: { id: project.id },
      data: { currentCode: body.code },
    });

    res.status(201).json({ version });
  } catch (err) {
    next(err);
  }
});

// 7. POST /api/coding/execute - Run code in secure sandbox and persist execution record
router.post("/execute", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const body = executeSchema.parse(req.body);

    const executionResult = await CodeExecutionService.execute({
      language: body.language,
      code: body.code,
      stdin: body.stdin,
      testCases: body.testCases,
      timeoutMs: body.timeoutMs,
    });

    // Persist execution result in PostgreSQL
    let savedExecution = null;
    try {
      savedExecution = await prisma.codeExecution.create({
        data: {
          userId,
          projectId: body.projectId || null,
          language: body.language,
          code: body.code,
          status: executionResult.status,
          exitCode: executionResult.exitCode,
          stdout: executionResult.stdout,
          stderr: executionResult.stderr,
          durationMs: executionResult.durationMs,
          testResults: executionResult.testResults as any,
        },
      });
    } catch (saveErr: any) {
      console.warn("[coding.routes] Warning saving execution record:", saveErr.message);
    }

    res.json({
      execution: {
        id: savedExecution?.id || crypto.randomUUID(),
        ...executionResult,
      },
    });
  } catch (err) {
    next(err);
  }
});

// 8. GET /api/coding/executions - Retrieve recent execution history
router.get("/executions", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const projectId = req.query.projectId as string | undefined;

    const executions = await prisma.codeExecution.findMany({
      where: {
        userId,
        projectId: projectId || undefined,
      },
      orderBy: { createdAt: "desc" },
      take: 25,
    });

    res.json({ executions });
  } catch (err) {
    next(err);
  }
});

// 9. POST /api/coding/import-url - Securely extract problem statement from public URL
router.post("/import-url", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== "string") {
      throw new AppError("Valid url parameter is required", 400, "BAD_REQUEST");
    }

    const validation = await CaptureService.validateUrl(url);
    if (!validation.valid) {
      throw new AppError(validation.error || "URL validation failed", 400, "SSRF_BLOCKED");
    }

    const response = await fetch(validation.normalizedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) NEXUS-CodingImport/2.0",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      throw new AppError(`Target returned HTTP status ${response.status}`, 502, "BAD_GATEWAY");
    }

    const html = await response.text();
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : validation.normalizedUrl;

    const cleanBody = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);

    res.json({
      success: true,
      title,
      url: validation.normalizedUrl,
      problemStatement: cleanBody,
    });
  } catch (err) {
    next(err);
  }
});

const generateSchema = z.object({
  language: z.string().default("python"),
  problemTitle: z.string().default("Coding Task"),
  problemStatement: z.string().optional(),
  currentCode: z.string().optional(),
  strategy: z.string().optional().default("optimal"),
  customInstructions: z.string().optional(),
  includeComments: z.boolean().optional().default(true),
  includeTests: z.boolean().optional().default(true),
  workspaceId: z.string().optional(),
  projectId: z.string().optional(),
});

function buildStrategyPrompt(data: z.infer<typeof generateSchema>): string {
  const strategyDirectives: Record<string, string> = {
    optimal: "Generate the accepted, optimal solution code with optimal time and space complexity, clear intuition, and edge cases.",
    complexity: "Analyze the time complexity and auxiliary space complexity in rigorous mathematical detail with Big-O notation.",
    explanation: "Explain this algorithm line-by-line in clear, beginner-friendly terms with visual analogies.",
    diagnosis: "Diagnose potential bugs, boundary violations, integer overflow, infinite loop risks, and fix them.",
    refactor: "Refactor this solution for clean code, readability, modularity, and idiomatic conventions.",
    tests: "Generate comprehensive unit test cases covering edge cases, empty inputs, negative numbers, and large boundaries.",
    alternatives: "Compare the brute-force approach vs the optimal approach, showing trade-offs between time and memory.",
    review: "Conduct an engineering code review evaluating time complexity, space efficiency, naming, and error handling.",
  };

  const directive = strategyDirectives[data.strategy] || strategyDirectives.optimal;

  return `You are NEXUS AI Coding Agent, a world-class competitive programming and systems architect.
Target Language: ${data.language}
Problem Title: ${data.problemTitle}
Strategy: ${data.strategy} (${directive})
${data.customInstructions ? `Custom Constraints: ${data.customInstructions}\n` : ""}
${data.includeComments ? "Instruction: Include line-by-line comments explaining non-trivial logic.\n" : ""}
${data.includeTests ? "Instruction: Include runnable test cases asserting expected outputs.\n" : ""}
${data.problemStatement ? `Problem Statement:\n${data.problemStatement.slice(0, 3000)}\n` : ""}
${data.currentCode ? `Current Editor Code:\n\`\`\`${data.language}\n${data.currentCode.slice(0, 2500)}\n\`\`\`\n` : ""}

Generate the complete solution. Always wrap code in \`\`\`${data.language.toLowerCase()} ... \`\`\`.
Explicitly detail:
- Time Complexity: O(...)
- Space Complexity: O(...)
- Core Intuition: (2-3 concise sentences)
- Edge Cases Handled: (list 2-3 key conditions)`;
}

// 10. POST /api/coding/generate/stream - Real-time SSE solution synthesis
router.post("/generate/stream", optionalAuth, async (req: RequestWithId, res: Response) => {
  try {
    const data = generateSchema.parse(req.body);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    if (typeof (res as any).flushHeaders === "function") {
      (res as any).flushHeaders();
    }

    const sendSse = (event: string, payload: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    sendSse("status", { status: `✦ Synthesizing ${data.strategy} solution in ${data.language}...` });

    const provider = await AIProviderFactory.getActiveProvider();
    const prompt = buildStrategyPrompt(data);

    let fullOutput = "";
    try {
      await provider.stream(
        prompt,
        (chunk) => {
          fullOutput += chunk;
          sendSse("token", { token: chunk });
        },
        {
          temperature: 0.2,
          timeout: 60000,
          maxTokens: 1500,
        }
      );
    } catch (err: any) {
      console.warn("[coding.routes/generate/stream] AI stream notice:", err.message);
    }

    const codeMatch = fullOutput.match(/```(?:[a-zA-Z0-9_\-\+#]+)?\n([\s\S]*?)```/);
    const parsedCode = codeMatch ? codeMatch[1].trim() : fullOutput;
    const timeMatch = fullOutput.match(/Time Complexity[:\s]+([^\n\*\#]+)/i);
    const spaceMatch = fullOutput.match(/Space Complexity[:\s]+([^\n\*\#]+)/i);

    const result = {
      success: true,
      solution: fullOutput,
      code: parsedCode,
      timeComplexity: timeMatch ? timeMatch[1].trim() : "O(N)",
      spaceComplexity: spaceMatch ? spaceMatch[1].trim() : "O(1)",
      language: data.language,
      strategy: data.strategy,
    };

    sendSse("complete", result);
    res.end();
  } catch (err: any) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// 11. POST /api/coding/generate - Non-streaming solution synthesis
router.post("/generate", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const data = generateSchema.parse(req.body);
    const provider = await AIProviderFactory.getActiveProvider();
    const prompt = buildStrategyPrompt(data);

    let fullOutput = "";
    try {
      await provider.stream(
        prompt,
        (chunk) => {
          fullOutput += chunk;
        },
        { temperature: 0.2, timeout: 60000, maxTokens: 1500 }
      );
    } catch (err: any) {
      console.warn("[coding.routes/generate] AI generation error:", err.message);
    }

    const codeMatch = fullOutput.match(/```(?:[a-zA-Z0-9_\-\+#]+)?\n([\s\S]*?)```/);
    const parsedCode = codeMatch ? codeMatch[1].trim() : fullOutput;
    const timeMatch = fullOutput.match(/Time Complexity[:\s]+([^\n\*\#]+)/i);
    const spaceMatch = fullOutput.match(/Space Complexity[:\s]+([^\n\*\#]+)/i);

    res.json({
      success: true,
      solution: fullOutput,
      code: parsedCode,
      timeComplexity: timeMatch ? timeMatch[1].trim() : "O(N)",
      spaceComplexity: spaceMatch ? spaceMatch[1].trim() : "O(1)",
      language: data.language,
      strategy: data.strategy,
    });
  } catch (err) {
    next(err);
  }
});

export const codingRouter = router;
