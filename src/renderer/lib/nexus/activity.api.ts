import { nexusClient } from "./nexus-client";

export type ActivityCategory = "browser" | "agents" | "approvals" | "system";
export type ActivityActorType = "user" | "agent" | "workflow" | "system";
export type ActivityOutcome = "success" | "failure" | "warning" | "pending";

export interface ActivityEvent {
  id: string;
  userId: string;
  workspaceId?: string;
  taskId?: string;
  agentRunId?: string;
  category: ActivityCategory;
  actorType: ActivityActorType;
  actorId?: string;
  sourceModule: string;
  actionName?: string;
  outcome: ActivityOutcome;
  type: string;
  message: string;
  metadata?: Record<string, any>;
  correlationId?: string;
  workflowExecutionId?: string;
  skillExecutionId?: string;
  approvalRequestId?: string;
  createdAt: string;
  task?: {
    id: string;
    title: string;
    goal?: string;
    status?: string;
  };
}

export interface ActivityStats {
  total: number;
  byCategory: {
    browser: number;
    agents: number;
    approvals: number;
    system: number;
  };
  byOutcome: {
    success: number;
    failure: number;
    warning: number;
  };
}

export class ActivityApi {
  public static async getEvents(params: {
    category?: string;
    actorType?: string;
    outcome?: string;
    sourceModule?: string;
    search?: string;
    dateRange?: string;
    limit?: number;
    cursor?: string;
    workspaceId?: string;
  } = {}): Promise<{ events: ActivityEvent[]; activities: ActivityEvent[]; totalCount: number; nextCursor: string | null }> {
    const query = new URLSearchParams();
    if (params.category) query.append("category", params.category);
    if (params.actorType) query.append("actorType", params.actorType);
    if (params.outcome) query.append("outcome", params.outcome);
    if (params.sourceModule) query.append("sourceModule", params.sourceModule);
    if (params.search) query.append("search", params.search);
    if (params.dateRange) query.append("dateRange", params.dateRange);
    if (params.limit) query.append("limit", String(params.limit));
    if (params.cursor) query.append("cursor", params.cursor);
    if (params.workspaceId) query.append("workspaceId", params.workspaceId);

    const queryString = query.toString();
    const endpoint = queryString ? `/api/v1/activity?${queryString}` : "/api/v1/activity";
    return nexusClient.request<{ events: ActivityEvent[]; activities: ActivityEvent[]; totalCount: number; nextCursor: string | null }>(endpoint);
  }

  public static async getStats(workspaceId?: string): Promise<{ stats: ActivityStats }> {
    const endpoint = workspaceId ? `/api/v1/activity/stats?workspaceId=${workspaceId}` : "/api/v1/activity/stats";
    return nexusClient.request<{ stats: ActivityStats }>(endpoint);
  }

  public static async getEvent(id: string): Promise<{ event: ActivityEvent }> {
    return nexusClient.request<{ event: ActivityEvent }>(`/api/v1/activity/${id}`);
  }

  public static async logEvent(data: {
    message: string;
    category?: ActivityCategory;
    actorType?: ActivityActorType;
    sourceModule?: string;
    actionName?: string;
    outcome?: ActivityOutcome;
    metadata?: Record<string, any>;
    workspaceId?: string;
  }): Promise<{ event: ActivityEvent }> {
    return nexusClient.request<{ event: ActivityEvent }>("/api/v1/activity/log", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }
}
