import { nexusClient } from "./nexus-client";

export type ApprovalRiskLevel = "low" | "moderate" | "high" | "critical";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "cancelled";

export interface ApprovalDecision {
  id: string;
  approvalRequestId: string;
  userId: string;
  decision: "approved" | "rejected" | "cancelled";
  reason?: string;
  payloadDigest?: string;
  decidedAt: string;
  user?: {
    id: string;
    name: string;
    email: string;
  };
}

export interface ApprovalPolicy {
  id: string;
  userId: string;
  workspaceId?: string;
  name: string;
  category: string;
  description: string;
  riskThreshold: ApprovalRiskLevel;
  requiresApproval: boolean;
  autoExpireHours: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRequest {
  id: string;
  userId: string;
  workspaceId: string;
  taskId?: string;
  agentRunId?: string;
  workflowExecutionId?: string;
  stepId?: string;
  skillExecutionId?: string;
  actionTitle?: string;
  actionType?: string;
  action: string;
  target: string;
  details?: Record<string, any>;
  requestingActor?: string;
  callerId?: string;
  payloadDigest?: string;
  riskLevel: ApprovalRiskLevel;
  status: ApprovalStatus;
  policyId?: string;
  policy?: ApprovalPolicy;
  createdAt: string;
  expiresAt?: string;
  resolvedAt?: string;
  decisions?: ApprovalDecision[];
  task?: {
    id: string;
    title: string;
    goal: string;
  };
}

export interface ApprovalStats {
  pending: number;
  approved: number;
  rejected: number;
  expired: number;
  cancelled: number;
  total: number;
}

export class ApprovalsApi {
  public static async getApprovals(params: {
    status?: string;
    risk?: string;
    search?: string;
    sort?: string;
    workspaceId?: string;
  } = {}): Promise<{ approvals: ApprovalRequest[]; count: number }> {
    const query = new URLSearchParams();
    if (params.status) query.append("status", params.status);
    if (params.risk) query.append("risk", params.risk);
    if (params.search) query.append("search", params.search);
    if (params.sort) query.append("sort", params.sort);
    if (params.workspaceId) query.append("workspaceId", params.workspaceId);

    const queryString = query.toString();
    const endpoint = queryString ? `/api/v1/approvals?${queryString}` : "/api/v1/approvals";
    return nexusClient.request<{ approvals: ApprovalRequest[]; count: number }>(endpoint);
  }

  public static async getPendingApprovals(): Promise<{ approvals: ApprovalRequest[]; count: number }> {
    return nexusClient.request<{ approvals: ApprovalRequest[]; count: number }>("/api/v1/approvals/pending");
  }

  public static async getStats(workspaceId?: string): Promise<{ stats: ApprovalStats }> {
    const endpoint = workspaceId ? `/api/v1/approvals/stats?workspaceId=${workspaceId}` : "/api/v1/approvals/stats";
    return nexusClient.request<{ stats: ApprovalStats }>(endpoint);
  }

  public static async getApproval(id: string): Promise<{ approval: ApprovalRequest }> {
    return nexusClient.request<{ approval: ApprovalRequest }>(`/api/v1/approvals/${id}`);
  }

  public static async approve(id: string, notes?: string): Promise<{ approval: ApprovalRequest; decision: ApprovalDecision }> {
    return nexusClient.request<{ approval: ApprovalRequest; decision: ApprovalDecision }>(`/api/v1/approvals/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ notes }),
    });
  }

  public static async reject(id: string, reason?: string): Promise<{ approval: ApprovalRequest; decision: ApprovalDecision }> {
    return nexusClient.request<{ approval: ApprovalRequest; decision: ApprovalDecision }>(`/api/v1/approvals/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  public static async cancel(id: string, reason?: string): Promise<{ approval: ApprovalRequest; decision: ApprovalDecision }> {
    return nexusClient.request<{ approval: ApprovalRequest; decision: ApprovalDecision }>(`/api/v1/approvals/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  public static async getPolicies(workspaceId?: string): Promise<{ policies: ApprovalPolicy[]; count: number }> {
    const endpoint = workspaceId ? `/api/v1/approval-policies?workspaceId=${workspaceId}` : "/api/v1/approval-policies";
    return nexusClient.request<{ policies: ApprovalPolicy[]; count: number }>(endpoint);
  }

  public static async updatePolicy(id: string, updates: Partial<ApprovalPolicy>): Promise<{ policy: ApprovalPolicy }> {
    return nexusClient.request<{ policy: ApprovalPolicy }>(`/api/v1/approval-policies/${id}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  }
}
