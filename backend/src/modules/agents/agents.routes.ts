import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { AgentController } from "../../agents/agent.controller.js";

const router = Router();

// Agent Task Routes
router.post("/tasks", requireAuth, AgentController.createTask);
router.get("/tasks", requireAuth, AgentController.getTasks);
router.get("/tasks/:id", requireAuth, AgentController.getTaskById);
router.post("/tasks/:id/start", requireAuth, AgentController.startTask);
router.post("/tasks/:id/pause", requireAuth, AgentController.pauseTask);
router.post("/tasks/:id/resume", requireAuth, AgentController.resumeTask);
router.post("/tasks/:id/cancel", requireAuth, AgentController.cancelTask);
router.post("/tasks/:id/retry", requireAuth, AgentController.retryTask);
router.get("/tasks/:id/runs", requireAuth, AgentController.getTaskRuns);

// Agent Run & Telemetry Routes
router.get("/runs/:id", requireAuth, AgentController.getRunById);
router.get("/runs/:id/plan", requireAuth, AgentController.getRunPlan);
router.get("/runs/:id/steps", requireAuth, AgentController.getRunSteps);
router.get("/runs/:id/tool-calls", requireAuth, AgentController.getRunToolCalls);
router.get("/runs/:id/observations", requireAuth, AgentController.getRunObservations);
router.get("/runs/:id/artifacts", requireAuth, AgentController.getRunArtifacts);
router.get("/runs/:id/activity", requireAuth, AgentController.getRunActivity);

export const agentsRouter = router;
