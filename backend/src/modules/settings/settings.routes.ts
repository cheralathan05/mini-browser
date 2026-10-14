import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { RequestWithId } from "../../middleware/logger.js";
import { env } from "../../config/env.js";
import { AIProviderFactory } from "../../ai/provider-factory.js";

const router = Router();

const updateSettingsSchema = z.object({
  theme: z.enum(["dark", "light", "system"]).optional(),
  language: z.string().optional(),
  ollamaUrl: z.string().optional(),
  ollamaModel: z.string().optional(),
  openAiApiKey: z.string().optional(),
  openAiModel: z.string().optional(),
});

// GET /api/settings
router.get("/", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const preferences = await prisma.userPreference.findMany({
      where: { userId: req.user!.id },
    });

    const prefMap: Record<string, unknown> = {};
    for (const p of preferences) {
      prefMap[p.key] = p.value;
    }

    const isOllamaOnline = await AIProviderFactory.getOllamaProvider().isAvailable();

    res.json({
      settings: {
        theme: prefMap.theme || "dark",
        language: prefMap.language || "en",
        ollamaUrl: prefMap.ollamaUrl || env.OLLAMA_URL,
        ollamaModel: prefMap.ollamaModel || env.OLLAMA_MODEL,
        openAiModel: prefMap.openAiModel || env.OPENAI_MODEL,
        hasOpenAiKey: Boolean(prefMap.openAiApiKey || (env.OPENAI_API_KEY && env.OPENAI_API_KEY.length > 0)),
        isOllamaOnline,
      },
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/settings
router.patch("/", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const data = updateSettingsSchema.parse(req.body);

    for (const [key, val] of Object.entries(data)) {
      if (val !== undefined) {
        await prisma.userPreference.upsert({
          where: {
            userId_key: {
              userId: req.user!.id,
              key,
            },
          },
          update: { value: val as any },
          create: {
            userId: req.user!.id,
            key,
            value: val as any,
          },
        });
      }
    }

    res.json({ success: true, message: "Settings saved successfully" });
  } catch (error) {
    next(error);
  }
});

export const settingsRouter = router;
