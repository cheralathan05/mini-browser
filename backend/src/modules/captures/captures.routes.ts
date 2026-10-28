import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import fs from "node:fs/promises";
import { prisma } from "../../config/db.js";
import { optionalAuth } from "../../middleware/auth.js";
import { RequestWithId } from "../../middleware/logger.js";
import { AppError } from "../../middleware/error.js";
import { CaptureService, type CaptureTelemetry } from "./capture.service.js";
import { VisionAnalysisService } from "./vision.service.js";

const router = Router();

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

const captureSchema = z.object({
  url: z.string().min(1),
  width: z.number().int().min(320).max(3840).optional().default(1280),
  height: z.number().int().min(240).max(2160).optional().default(800),
  fullPage: z.boolean().optional().default(false),
  deviceScaleFactor: z.number().optional().default(1),
  workspaceId: z.string().optional(),
});

const analyzeSchema = z.object({
  prompt: z.string().optional(),
});

// 1. POST /api/captures - Execute real screenshot capture
router.post("/", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const body = captureSchema.parse(req.body);

    let wsId = body.workspaceId;
    if (!wsId) {
      const ws = await prisma.workspace.findFirst({ where: { userId } });
      wsId = ws?.id;
    }

    // Execute Playwright Chromium capture
    const captureResult = await CaptureService.capture({
      url: body.url,
      width: body.width,
      height: body.height,
      fullPage: body.fullPage,
      deviceScaleFactor: body.deviceScaleFactor,
    });

    // Save capture to PostgreSQL
    const capture = await prisma.webCapture.create({
      data: {
        userId,
        workspaceId: wsId,
        url: captureResult.url,
        resolvedUrl: captureResult.resolvedUrl,
        title: captureResult.title,
        screenshotPath: captureResult.screenshotPath,
        width: captureResult.width,
        height: captureResult.height,
        format: captureResult.format,
        fileSize: captureResult.fileSize,
        durationMs: captureResult.durationMs,
        status: "completed",
        telemetry: captureResult.telemetry as any,
        headings: captureResult.telemetry.headings as any,
        excerpt: captureResult.telemetry.excerpt,
      },
    });

    res.status(201).json({
      capture: {
        ...capture,
        publicUrl: captureResult.publicUrl,
      },
    });
  } catch (err: any) {
    next(err);
  }
});

// 2. GET /api/captures - List saved captures
router.get("/", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const workspaceId = req.query.workspaceId as string | undefined;

    const captures = await prisma.webCapture.findMany({
      where: {
        userId,
        workspaceId: workspaceId || undefined,
      },
      include: {
        _count: { select: { analyses: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const enriched = captures.map((c) => {
      const filename = c.screenshotPath.split(/[/\\]/).pop();
      return {
        ...c,
        publicUrl: `/captures/${filename}`,
      };
    });

    res.json({ captures: enriched });
  } catch (err) {
    next(err);
  }
});

// 3. GET /api/captures/:id - Get single capture with analyses
router.get("/:id", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const capture = await prisma.webCapture.findFirst({
      where: { id: req.params.id, userId },
      include: {
        analyses: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!capture) {
      throw new AppError("Capture not found", 404, "NOT_FOUND");
    }

    const filename = capture.screenshotPath.split(/[/\\]/).pop();

    res.json({
      capture: {
        ...capture,
        publicUrl: `/captures/${filename}`,
      },
    });
  } catch (err) {
    next(err);
  }
});

// 4. DELETE /api/captures/:id - Delete capture and remove screenshot file
router.delete("/:id", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const capture = await prisma.webCapture.findFirst({
      where: { id: req.params.id, userId },
    });

    if (!capture) {
      throw new AppError("Capture not found", 404, "NOT_FOUND");
    }

    // Attempt file deletion
    try {
      await fs.unlink(capture.screenshotPath);
    } catch {}

    await prisma.webCapture.delete({ where: { id: capture.id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// 5. POST /api/captures/:id/analyze - Run multimodal AI vision analysis
router.post("/:id/analyze", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUser(req);
    const body = analyzeSchema.parse(req.body);

    const capture = await prisma.webCapture.findFirst({
      where: { id: req.params.id, userId },
    });

    if (!capture) {
      throw new AppError("Capture not found", 404, "NOT_FOUND");
    }

    const telemetry = (capture.telemetry as unknown as CaptureTelemetry) || {
      protocol: "https",
      statusCode: 200,
      width: capture.width,
      height: capture.height,
      format: capture.format,
      fileSize: capture.fileSize,
      durationMs: capture.durationMs,
      title: capture.title,
      headings: (capture.headings as string[]) || [],
      excerpt: capture.excerpt || "",
      linkCount: 0,
      imageCount: 0,
      timestamp: capture.createdAt.toISOString(),
    };

    const analysisResult = await VisionAnalysisService.analyze(
      capture.screenshotPath,
      telemetry,
      body.prompt
    );

    const analysis = await prisma.captureAnalysis.create({
      data: {
        captureId: capture.id,
        userId,
        provider: analysisResult.provider,
        model: analysisResult.model,
        content: analysisResult.content,
        status: "completed",
      },
    });

    res.status(201).json({ analysis });
  } catch (err) {
    next(err);
  }
});

export const capturesRouter = router;
