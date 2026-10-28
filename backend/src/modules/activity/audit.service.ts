import { prisma } from "../../config/db.js";
import { wsManager } from "../../websocket/ws-server.js";

export type AuditCategory = "browser" | "agents" | "approvals" | "system";
export type AuditActorType = "user" | "agent" | "workflow" | "system";
export type AuditOutcome = "success" | "failure" | "warning" | "pending";
export type AuditSourceModule =
  | "browser"
  | "coding"
  | "research"
  | "automation"
  | "workflows"
  | "skills"
  | "approvals"
  | "auth"
  | "settings"
  | "system";

export interface AuditLogOptions {
  userId: string;
  workspaceId?: string;
  category?: AuditCategory;
  actorType?: AuditActorType;
  actorId?: string;
  sourceModule?: AuditSourceModule;
  actionName?: string;
  outcome?: AuditOutcome;
  message: string;
  type?: string;
  correlationId?: string;
  workflowExecutionId?: string;
  skillExecutionId?: string;
  approvalRequestId?: string;
  taskId?: string;
  agentRunId?: string;
  metadata?: Record<string, any>;
}

export interface AuditQueryOptions {
  userId: string;
  workspaceId?: string;
  category?: string;
  actorType?: string;
  outcome?: string;
  sourceModule?: string;
  search?: string;
  dateRange?: string; // "today" | "24h" | "7d" | "30d" | "all"
  limit?: number;
  cursor?: string;
}

const REDACTED_KEYS = new Set([
  "password",
  "passwordhash",
  "token",
  "accesstoken",
  "refreshtoken",
  "secret",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "creditcard",
  "privatekey",
  "clientsecret",
]);

export class AuditService {
  /**
   * Deeply redacts sensitive keys from metadata or payload objects
   */
  public static redactSecrets(obj: any): any {
    if (!obj || typeof obj !== "object") {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.redactSecrets(item));
    }

    const cleaned: Record<string, any> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (REDACTED_KEYS.has(key.toLowerCase())) {
        cleaned[key] = "[REDACTED]";
      } else if (typeof val === "object" && val !== null) {
        cleaned[key] = this.redactSecrets(val);
      } else {
        cleaned[key] = val;
      }
    }
    return cleaned;
  }

  /**
   * Persists a durable audit record and broadcasts to connected clients
   */
  public static async log(options: AuditLogOptions) {
    try {
      const category: AuditCategory = options.category || "system";
      const actorType: AuditActorType = options.actorType || "system";
      const sourceModule: AuditSourceModule = options.sourceModule || "system";
      const outcome: AuditOutcome = options.outcome || "success";
      const eventType = options.type || `${category.toUpperCase()}_${outcome.toUpperCase()}`;

      const safeMetadata = options.metadata ? this.redactSecrets(options.metadata) : undefined;

      const event = await prisma.activityEvent.create({
        data: {
          userId: options.userId,
          workspaceId: options.workspaceId || undefined,
          taskId: options.taskId || undefined,
          agentRunId: options.agentRunId || undefined,
          category,
          actorType,
          actorId: options.actorId || undefined,
          sourceModule,
          actionName: options.actionName || undefined,
          outcome,
          type: eventType,
          message: options.message,
          correlationId: options.correlationId || undefined,
          workflowExecutionId: options.workflowExecutionId || undefined,
          skillExecutionId: options.skillExecutionId || undefined,
          approvalRequestId: options.approvalRequestId || undefined,
          metadata: safeMetadata as object,
        },
      });

      // Broadcast live event over WebSocket
      wsManager.broadcast(
        "activity.event",
        {
          event: {
            id: event.id,
            category: event.category,
            actorType: event.actorType,
            actorId: event.actorId,
            sourceModule: event.sourceModule,
            actionName: event.actionName,
            outcome: event.outcome,
            type: event.type,
            message: event.message,
            metadata: event.metadata,
            createdAt: event.createdAt.toISOString(),
          },
        },
        { userId: options.userId, workspaceId: options.workspaceId }
      );

      return event;
    } catch (err) {
      console.warn("[AuditService] Failed to write audit event:", err);
      return null;
    }
  }

  /**
   * Queries audit events with server-side filtering, search, and pagination
   */
  public static async query(options: AuditQueryOptions) {
    const { userId, workspaceId, category, actorType, outcome, sourceModule, search, dateRange, limit = 50, cursor } = options;

    const takeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);

    const where: any = {
      userId,
    };

    if (workspaceId) {
      where.workspaceId = workspaceId;
    }

    if (category && category !== "all") {
      where.category = category.toLowerCase();
    }

    if (actorType && actorType !== "all") {
      where.actorType = actorType.toLowerCase();
    }

    if (outcome && outcome !== "all") {
      where.outcome = outcome.toLowerCase();
    }

    if (sourceModule && sourceModule !== "all") {
      where.sourceModule = sourceModule.toLowerCase();
    }

    // Date range filter
    if (dateRange && dateRange !== "all") {
      const now = new Date();
      let startDate: Date;
      if (dateRange === "today") {
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      } else if (dateRange === "24h") {
        startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      } else if (dateRange === "7d") {
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      } else if (dateRange === "30d") {
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      } else {
        startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      }
      where.createdAt = { gte: startDate };
    }

    // Search filter across message, actionName, sourceModule
    if (search && search.trim().length > 0) {
      const q = search.trim();
      where.OR = [
        { message: { contains: q, mode: "insensitive" } },
        { actionName: { contains: q, mode: "insensitive" } },
        { sourceModule: { contains: q, mode: "insensitive" } },
        { type: { contains: q, mode: "insensitive" } },
      ];
    }

    // Cursor pagination (using createdAt + id deterministic order)
    const [events, totalCount] = await Promise.all([
      prisma.activityEvent.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: takeLimit + 1,
        cursor: cursor ? { id: cursor } : undefined,
        skip: cursor ? 1 : 0,
      }),
      prisma.activityEvent.count({ where }),
    ]);

    let nextCursor: string | null = null;
    if (events.length > takeLimit) {
      const nextItem = events.pop();
      nextCursor = nextItem ? nextItem.id : null;
    }

    return {
      events,
      totalCount,
      nextCursor,
    };
  }

  /**
   * Retrieves aggregated event metrics across categories and outcomes
   */
  public static async getStats(userId: string, workspaceId?: string) {
    const where: any = { userId };
    if (workspaceId) where.workspaceId = workspaceId;

    const [total, browserCount, agentCount, approvalCount, systemCount, successCount, failureCount, warningCount] =
      await Promise.all([
        prisma.activityEvent.count({ where }),
        prisma.activityEvent.count({ where: { ...where, category: "browser" } }),
        prisma.activityEvent.count({ where: { ...where, category: "agents" } }),
        prisma.activityEvent.count({ where: { ...where, category: "approvals" } }),
        prisma.activityEvent.count({ where: { ...where, category: "system" } }),
        prisma.activityEvent.count({ where: { ...where, outcome: "success" } }),
        prisma.activityEvent.count({ where: { ...where, outcome: "failure" } }),
        prisma.activityEvent.count({ where: { ...where, outcome: "warning" } }),
      ]);

    return {
      total,
      byCategory: {
        browser: browserCount,
        agents: agentCount,
        approvals: approvalCount,
        system: systemCount,
      },
      byOutcome: {
        success: successCount,
        failure: failureCount,
        warning: warningCount,
      },
    };
  }
}
