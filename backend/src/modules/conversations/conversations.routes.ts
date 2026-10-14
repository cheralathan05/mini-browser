import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { RequestWithId } from "../../middleware/logger.js";
import { AppError } from "../../middleware/error.js";
import { AIProviderFactory } from "../../ai/provider-factory.js";

const router = Router();

const createConversationSchema = z.object({
  workspaceId: z.string().uuid(),
  title: z.string().min(1),
});

const createMessageSchema = z.object({
  content: z.string().min(1),
  role: z.enum(["user", "assistant", "system"]).default("user"),
  autoReply: z.boolean().default(true),
});

// GET /api/conversations
router.get("/", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.query.workspaceId as string | undefined;

    const conversations = await prisma.conversation.findMany({
      where: {
        userId: req.user!.id,
        workspaceId: workspaceId || undefined,
      },
      include: {
        _count: { select: { messages: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    res.json({ conversations });
  } catch (error) {
    next(error);
  }
});

// POST /api/conversations
router.post("/", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const data = createConversationSchema.parse(req.body);

    const workspace = await prisma.workspace.findFirst({
      where: { id: data.workspaceId, userId: req.user!.id },
    });
    if (!workspace) {
      throw new AppError("Workspace not found", 404, "NOT_FOUND");
    }

    const conversation = await prisma.conversation.create({
      data: {
        userId: req.user!.id,
        workspaceId: data.workspaceId,
        title: data.title,
      },
    });

    res.status(201).json({ conversation });
  } catch (error) {
    next(error);
  }
});

// GET /api/conversations/:id
router.get("/:id", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!conversation) {
      throw new AppError("Conversation not found", 404, "NOT_FOUND");
    }

    res.json({ conversation });
  } catch (error) {
    next(error);
  }
});

// POST /api/conversations/:id/messages
router.post("/:id/messages", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const data = createMessageSchema.parse(req.body);

    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: { messages: { take: 10, orderBy: { createdAt: "desc" } } },
    });

    if (!conversation) {
      throw new AppError("Conversation not found", 404, "NOT_FOUND");
    }

    // 1. Save user message
    const userMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: data.role,
        content: data.content,
      },
    });

    let assistantMessage = null;

    // 2. Generate AI response if requested
    if (data.autoReply && data.role === "user") {
      const provider = await AIProviderFactory.getActiveProvider();
      const reply = await provider.generate(data.content, {
        systemPrompt: "You are NEXUS Assistant, an intelligent web copilot. Provide actionable and concise guidance.",
      });

      assistantMessage = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: "assistant",
          content: reply,
        },
      });
    }

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    res.status(201).json({
      message: userMessage,
      reply: assistantMessage,
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/conversations/:id
router.delete("/:id", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!conversation) {
      throw new AppError("Conversation not found", 404, "NOT_FOUND");
    }

    await prisma.conversation.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export const conversationsRouter = router;
