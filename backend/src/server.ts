import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { prisma } from "./config/db.js";
import { requestLogger } from "./middleware/logger.js";
import { errorHandler } from "./middleware/error.js";
import { wsManager } from "./websocket/ws-server.js";
import { AIProviderFactory } from "./ai/provider-factory.js";

// Routes
import { authRouter } from "./modules/auth/auth.routes.js";
import { usersRouter } from "./modules/users/users.routes.js";
import { workspacesRouter } from "./modules/workspaces/workspaces.routes.js";
import { conversationsRouter } from "./modules/conversations/conversations.routes.js";
import { agentsRouter } from "./modules/agents/agents.routes.js";
import { memoryRouter } from "./modules/memory/memory.routes.js";
import { researchRouter } from "./modules/research/research.routes.js";
import { workflowsRouter } from "./modules/workflows/workflows.routes.js";
import { skillsRouter } from "./modules/skills/skills.routes.js";
import { approvalsRouter } from "./modules/approvals/approvals.routes.js";
import { activityRouter } from "./modules/activity/activity.routes.js";
import { settingsRouter } from "./modules/settings/settings.routes.js";
import { nexusIntentRouter } from "./modules/nexus/nexus-intent.routes.js";
import { browserAnalyzeRouter } from "./modules/browser/browser-analyze.routes.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { aiRouter } from "./modules/ai/ai.routes.js";
import { AgentService } from "./agents/agent.service.js";
import { ResearchOrchestrator } from "./modules/research/research.orchestrator.js";

const app = express();

// Middlewares
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "20mb" }));
app.use(requestLogger);

// Health & Readiness checks
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/ready", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const ollamaOnline = await AIProviderFactory.getOllamaProvider().isAvailable();
    res.json({
      status: "ready",
      database: "connected",
      ollama: ollamaOnline ? "available" : "offline",
    });
  } catch (err) {
    res.status(503).json({
      status: "degraded",
      database: "disconnected",
      error: (err as Error).message,
    });
  }
});

// API Routes
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/workspaces", workspacesRouter);
app.use("/api/conversations", conversationsRouter);
app.use("/api/ai", aiRouter);
app.use("/api/agents", agentsRouter);
app.use("/api/agent", agentsRouter);
app.use("/api/memory", memoryRouter);
app.use("/api/research", researchRouter);
app.use("/api/workflows", workflowsRouter);
app.use("/api/skills", skillsRouter);
app.use("/api/approvals", approvalsRouter);
app.use("/api/activity", activityRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/nexus", nexusIntentRouter);
app.use("/api/browser", browserAnalyzeRouter);
app.use("/api/health", healthRouter);

// Frontend static assets & SPA fallback (production / web hosting)
const rendererDir = path.resolve(process.cwd(), "dist-renderer");
if (fs.existsSync(rendererDir)) {
  app.use(express.static(rendererDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path === "/health" || req.path === "/ready") {
      return next();
    }
    const indexPath = path.join(rendererDir, "index.html");
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      next();
    }
  });
}

// Centralized error handler
app.use(errorHandler);

// HTTP & WebSocket Server
const server = http.createServer(app);
wsManager.init(server);

// Boot-time crash recovery for interrupted runs
void AgentService.recoverInterruptedRunsOnBoot();
void ResearchOrchestrator.recoverInterruptedRunsOnBoot();

if (process.env.NODE_ENV !== "test") {
  server.listen(env.PORT, "0.0.0.0", () => {
    console.log(`============================================================`);
    console.log(`🚀 NEXUS BACKEND API SERVER RUNNING ON PORT ${env.PORT}`);
    console.log(`REST:     http://0.0.0.0:${env.PORT}`);
    console.log(`WS:       ws://0.0.0.0:${env.PORT}`);
    console.log(`DB:       ${env.DATABASE_URL.replace(/:[^:@]*@/, ":****@")}`);
    console.log(`FRONTEND: http://0.0.0.0:${env.PORT}/`);
    console.log(`DESKTOP:  Electron Desktop Window`);
    console.log(`============================================================`);
  });
}

export { app, server };
