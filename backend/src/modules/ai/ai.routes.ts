import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { optionalAuth } from "../../middleware/auth.js";
import { RequestWithId } from "../../middleware/logger.js";
import { AppError } from "../../middleware/error.js";
import { ContextExtractor } from "../../ai/ai.context.js";
import { AIOrchestrator } from "../../ai/ai.orchestrator.js";
import { wsManager } from "../../websocket/ws-server.js";
import { sanitizeForDb, sanitizeWin1252 } from "../../utils/sanitize-utf8.js";

const router = Router();

const createConversationSchema = z.object({
  workspaceId: z.string().uuid().optional(),
  spaceId: z.string().optional(),
  title: z.string().optional(),
  contextType: z.string().optional().default("page"),
  url: z.string().optional(),
  pageTitle: z.string().optional(),
  selectedText: z.string().optional(),
  context: z.record(z.unknown()).optional(),
});

const sendMessageSchema = z.object({
  message: z.string().min(1),
  context: z.record(z.unknown()).optional(),
  model: z.string().optional(),
  requestId: z.string().optional(),
});

// Helper to resolve user and workspace
async function resolveUserAndWorkspace(
  req: RequestWithId,
  explicitWorkspaceId?: string
): Promise<{ userId: string; workspaceId: string }> {
  let userId = req.user?.id;
  let workspaceId = explicitWorkspaceId;

  if (!userId) {
    const firstUser = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
    if (firstUser) {
      userId = firstUser.id;
    } else {
      const created = await prisma.user.create({
        data: {
          email: "user@nexus.local",
          name: "NEXUS User",
          passwordHash: "local",
        },
      });
      userId = created.id;
    }
  }

  if (!workspaceId) {
    const ws = await prisma.workspace.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    if (ws) {
      workspaceId = ws.id;
    } else {
      const createdWs = await prisma.workspace.create({
        data: {
          userId: userId!,
          name: "AI Browser Research",
        },
      });
      workspaceId = createdWs.id;
    }
  }

  return { userId: userId!, workspaceId: workspaceId! };
}

// 1. GET /api/ai/conversations - List conversations
router.get("/conversations", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const { userId } = await resolveUserAndWorkspace(req, req.query.workspaceId as string);

    const conversations = await prisma.conversation.findMany({
      where: { userId },
      include: {
        _count: { select: { messages: true } },
        snapshots: { take: 1, orderBy: { createdAt: "desc" } },
      },
      orderBy: { updatedAt: "desc" },
    });

    res.json({ conversations });
  } catch (error) {
    next(error);
  }
});

// 2. POST /api/ai/conversations - Create new discussion
router.post("/conversations", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const body = createConversationSchema.parse(req.body);
    const { userId, workspaceId } = await resolveUserAndWorkspace(req, body.workspaceId);

    const title = body.title || "New Discussion";

    const conversation = await prisma.conversation.create({
      data: {
        userId,
        workspaceId,
        spaceId: body.spaceId,
        title,
        contextType: body.contextType,
      },
    });

    // Save initial context snapshot if provided
    if (body.context || body.url || body.pageTitle || body.selectedText) {
      const norm = body.context
        ? ContextExtractor.normalizeContext(body.context)
        : {
            type: body.contextType || "page",
            url: body.url || "",
            title: body.pageTitle || "",
            selectedText: body.selectedText || "",
          };
      const urlStr = ("url" in norm && typeof norm.url === "string" ? norm.url : body.url) || null;
      const titleStr = ("title" in norm && typeof norm.title === "string" ? norm.title : body.pageTitle) || null;
      const textStr =
        ("selectedText" in norm
          ? (norm as any).selectedText
          : "text" in norm
          ? (norm as any).text
          : body.selectedText) || null;
      await prisma.contextSnapshot.create({
        data: {
          conversationId: conversation.id,
          url: urlStr,
          title: titleStr,
          selectedText: textStr,
          sourceType: (norm as any).type || "page",
          metadata: norm as any,
        },
      });
    }

    // Log activity
    await prisma.activityEvent.create({
      data: {
        userId,
        workspaceId,
        type: "AI_CONVERSATION_CREATED",
        message: `Created conversation: ${title}`,
        metadata: { conversationId: conversation.id },
      },
    });

    res.status(201).json({ conversation });
  } catch (error) {
    next(error);
  }
});

// 3. GET /api/ai/conversations/:id - Get conversation with messages
router.get("/conversations/:id", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const { userId } = await resolveUserAndWorkspace(req);

    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
        snapshots: { take: 3, orderBy: { createdAt: "desc" } },
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

// 4. POST /api/ai/conversations/:id/messages - Send message with real-time SSE streaming
router.post("/conversations/:id/messages", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const body = sendMessageSchema.parse(req.body);
    const { userId, workspaceId } = await resolveUserAndWorkspace(req);

    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId },
    });

    if (!conversation) {
      throw new AppError("Conversation not found", 404, "NOT_FOUND");
    }

    // Save user message to PostgreSQL
    let userMessage: any = null;
    try {
      userMessage = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: "user",
          content: sanitizeForDb(body.message),
          status: "completed",
          metadata: { requestId: body.requestId },
        },
      });
    } catch {
      userMessage = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: "user",
          content: sanitizeWin1252(body.message),
          status: "completed",
          metadata: { requestId: body.requestId },
        },
      });
    }

    // Auto-title conversation on first message if currently default
    if (conversation.title === "New Discussion" || conversation.title === "New Conversation") {
      const generatedTitle = body.message.slice(0, 45);
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { title: generatedTitle },
      });
    }

    // Set up Server-Sent Events headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const sendSSE = (event: string, data: Record<string, unknown>) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendSSE("message:start", {
      userMessageId: userMessage.id,
      conversationId: conversation.id,
    });

    const abortController = new AbortController();
    AIOrchestrator.registerAbortController(conversation.id, abortController);

    res.on("close", () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    const normalizedContext = body.context ? ContextExtractor.normalizeContext(body.context) : undefined;

    // Snapshot context in database if provided
    if (normalizedContext) {
      try {
        const urlStr = "url" in normalizedContext && typeof normalizedContext.url === "string" ? normalizedContext.url : undefined;
        const titleStr = "title" in normalizedContext && typeof normalizedContext.title === "string" ? normalizedContext.title : undefined;
        const textStr =
          "selectedText" in normalizedContext
            ? normalizedContext.selectedText
            : "text" in normalizedContext
            ? (normalizedContext as any).text
            : undefined;

        await prisma.contextSnapshot.create({
          data: {
            conversationId: conversation.id,
            url: urlStr,
            title: titleStr,
            selectedText: textStr,
            sourceType: normalizedContext.type,
            metadata: normalizedContext as any,
          },
        });
      } catch (snapErr: any) {
        console.warn("[ai.routes] Context snapshot skipped:", snapErr.message);
      }
    }

    // Execute through AI Orchestrator with streaming tokens
    let finalAction: any = undefined;
    const result = await AIOrchestrator.execute({
      conversationId: conversation.id,
      userId,
      workspaceId,
      message: body.message,
      context: normalizedContext,
      model: body.model,
      signal: abortController.signal,
      onToken: (token) => {
        sendSSE("message:token", { text: token, token });
      },
      onAction: (action) => {
        finalAction = action;
        sendSSE("message:action", { action });
      },
    });

    // Resiliently persist assistant response to PostgreSQL
    let assistantMessage: any = null;
    try {
      assistantMessage = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: "assistant",
          content: sanitizeForDb(result.content),
          model: result.modelUsed,
          status: abortController.signal.aborted ? "cancelled" : "completed",
          metadata: finalAction ? { suggestedAction: finalAction } : undefined,
        },
      });
    } catch (dbErr: any) {
      console.warn("[ai.routes] Warning saving assistant message, applying fallback:", dbErr.message);
      try {
        assistantMessage = await prisma.message.create({
          data: {
            conversationId: conversation.id,
            role: "assistant",
            content: sanitizeWin1252(result.content),
            model: result.modelUsed,
            status: abortController.signal.aborted ? "cancelled" : "completed",
            metadata: finalAction ? { suggestedAction: finalAction } : undefined,
          },
        });
      } catch (fallbackErr: any) {
        console.error("[ai.routes] Error persisting assistant message:", fallbackErr.message);
      }
    }

    try {
      // Update conversation timestamp
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
      });
    } catch {}

    try {
      // Create activity record in PostgreSQL
      await prisma.activityEvent.create({
        data: {
          userId,
          workspaceId,
          type: "AI_MESSAGE_CREATED",
          message: `NEXUS AI responded to: "${body.message.slice(0, 30)}..."`,
          metadata: {
            conversationId: conversation.id,
            messageId: assistantMessage?.id,
            model: result.modelUsed,
          },
        },
      });
    } catch {}

    sendSSE("message:complete", {
      messageId: assistantMessage?.id || `msg_${Date.now()}`,
      content: result.content,
      model: result.modelUsed,
      action: finalAction,
      done: true,
    });

    res.end();
  } catch (error: any) {
    console.error("[ai.routes] Error processing message:", error);
    if (!res.headersSent) {
      next(error);
    } else {
      res.write(`event: message:error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }
});

// 5. POST /api/ai/conversations/:id/cancel - Stop ongoing generation
router.post("/conversations/:id/cancel", optionalAuth, async (req: RequestWithId, res: Response) => {
  const cancelled = AIOrchestrator.cancel(req.params.id);
  res.json({ success: true, cancelled });
});

// 6. POST /api/ai/conversations/:id/retry - Retry last generation
router.post("/conversations/:id/retry", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const { userId } = await resolveUserAndWorkspace(req);

    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId },
      include: { messages: { orderBy: { createdAt: "desc" }, take: 2 } },
    });

    if (!conversation || conversation.messages.length === 0) {
      throw new AppError("No message to retry", 400, "BAD_REQUEST");
    }

    const lastUserMessage = conversation.messages.find((m: any) => m.role === "user");
    if (!lastUserMessage) {
      throw new AppError("No user prompt found to retry", 400, "BAD_REQUEST");
    }

    // Delete last assistant message if it exists
    if (conversation.messages[0].role === "assistant") {
      await prisma.message.delete({ where: { id: conversation.messages[0].id } });
    }

    res.json({ readyToRetry: true, prompt: lastUserMessage.content });
  } catch (error) {
    next(error);
  }
});

// 7. DELETE /api/ai/conversations/:id - Delete conversation
router.delete("/conversations/:id", optionalAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const { userId } = await resolveUserAndWorkspace(req);

    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId },
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

export const aiRouter = router;
