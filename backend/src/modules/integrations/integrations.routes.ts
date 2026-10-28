import { Router, Response, NextFunction } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { RequestWithId } from "../../middleware/logger.js";
import { IntegrationsService } from "./integrations.service.js";

const router = Router();

// GET /api/v1/integrations
router.get("/", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const integrations = await IntegrationsService.listIntegrations(req.user!.id);
    res.json({ integrations });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/integrations/:id/verify
router.post("/:id/verify", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const provider = req.params.id;
    const verified = await IntegrationsService.verifyIntegration(req.user!.id, provider);
    res.json({ integration: verified });
  } catch (err) {
    next(err);
  }
});

export const integrationsRouter = router;
