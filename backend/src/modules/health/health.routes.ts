import { Router, Request, Response } from "express";
import { prisma } from "../../config/db.js";
import { AIProviderFactory } from "../../ai/provider-factory.js";
import { env } from "../../config/env.js";

const router = Router();

// GET /api/health
router.get("/", async (_req: Request, res: Response) => {
  let dbStatus = "unknown";
  let ollamaStatus = "unknown";

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = "healthy";
  } catch {
    dbStatus = "unhealthy";
  }

  try {
    const isOnline = await AIProviderFactory.getOllamaProvider().isAvailable();
    ollamaStatus = isOnline ? "connected" : "offline";
  } catch {
    ollamaStatus = "offline";
  }

  const isDegraded = dbStatus !== "healthy";
  res.status(isDegraded ? 503 : 200).json({
    status: isDegraded ? "degraded" : "healthy",
    timestamp: new Date().toISOString(),
    services: {
      database: dbStatus,
      ollama: ollamaStatus,
      backend: "healthy",
    },
  });
});

// GET /api/health/database
router.get("/database", async (_req: Request, res: Response) => {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const latency = Date.now() - start;

    const [userCount, workspaceCount, tabCount, memoryCount, taskCount] = await Promise.all([
      prisma.user.count(),
      prisma.workspace.count(),
      prisma.browserTab.count(),
      prisma.memory.count(),
      prisma.agentTask.count(),
    ]);

    res.json({
      status: "connected",
      latencyMs: latency,
      port: 5433,
      metrics: {
        users: userCount,
        workspaces: workspaceCount,
        tabs: tabCount,
        memories: memoryCount,
        tasks: taskCount,
      },
    });
  } catch (err) {
    res.status(503).json({
      status: "disconnected",
      error: (err as Error).message,
    });
  }
});

// GET /api/health/ollama
router.get("/ollama", async (_req: Request, res: Response) => {
  try {
    const resOllama = await fetch(`${env.OLLAMA_URL}/api/tags`);
    if (resOllama.ok) {
      const data = await resOllama.json() as { models?: Array<{ name: string; size: number }> };
      res.json({
        status: "connected",
        url: env.OLLAMA_URL,
        activeModel: env.OLLAMA_MODEL,
        models: data.models || [],
      });
    } else {
      res.status(502).json({
        status: "error",
        statusCode: resOllama.status,
      });
    }
  } catch (err) {
    res.status(503).json({
      status: "offline",
      url: env.OLLAMA_URL,
      error: (err as Error).message,
    });
  }
});

// GET /api/health/browser
router.get("/browser", async (_req: Request, res: Response) => {
  try {
    const [sessions, tabs, approvals] = await Promise.all([
      prisma.browserSession.count(),
      prisma.browserTab.count(),
      prisma.approvalRequest.count({ where: { status: "pending" } }),
    ]);

    res.json({
      status: "active",
      sessions,
      tabs,
      pendingApprovals: approvals,
    });
  } catch (err) {
    res.status(500).json({ status: "error", error: (err as Error).message });
  }
});

export { router as healthRouter };
