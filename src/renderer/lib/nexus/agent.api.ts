import { nexusClient } from "./nexus-client";

export type AgentTaskStatus =
  | "pending"
  | "running"
  | "paused"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentRunStatus =
  | "PENDING"
  | "PLANNING"
  | "RUNNING"
  | "PAUSED"
  | "AWAITING_APPROVAL"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type AgentStepStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "SKIPPED";

export interface AgentPlanStep {
  id: string;
  order: number;
  description: string;
  toolName: string;
  input?: Record<string, unknown>;
  verification?: string;
  status?: string;
}

export interface AgentPlan {
  id: string;
  agentRunId: string;
  objective: string;
  version: number;
  steps: AgentPlanStep[];
  createdAt: string;
}

export interface AgentObservation {
  id: string;
  agentRunId: string;
  agentStepId?: string | null;
  type: string;
  title: string;
  summary: string;
  data?: any;
  createdAt: string;
}

export interface AgentToolCall {
  id: string;
  agentRunId: string;
  agentStepId?: string | null;
  toolName: string;
  parameters: any;
  riskLevel: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  result?: any;
  error?: string | null;
  durationMs?: number | null;
  startedAt: string;
  completedAt?: string | null;
}

export interface AgentStep {
  id: string;
  agentRunId: string;
  order: number;
  name: string;
  description?: string | null;
  toolName: string;
  input?: any;
  output?: any;
  status: AgentStepStatus;
  error?: string | null;
  verificationCriteria?: string | null;
  verificationOutcome?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  toolCalls?: AgentToolCall[];
  observations?: AgentObservation[];
}

export interface AgentArtifact {
  id: string;
  agentRunId: string;
  type: "report" | "research" | "source_collection" | "dataset" | "screenshot" | "log" | string;
  name: string;
  content: string;
  metadata?: any;
  createdAt: string;
}

export interface AgentRun {
  id: string;
  agentTaskId: string;
  status: AgentRunStatus;
  progress: number;
  totalSteps: number;
  currentStep?: number;
  completedSteps: number;
  error?: string | null;
  startedAt: string;
  completedAt?: string | null;
  plan?: AgentPlan | null;
  steps?: AgentStep[];
  artifacts?: AgentArtifact[];
  toolCalls?: AgentToolCall[];
  observations?: AgentObservation[];
  task?: {
    id: string;
    title: string;
    goal: string;
    priority: string;
  };
}

export interface AgentTask {
  id: string;
  userId: string;
  workspaceId: string;
  title: string;
  goal: string;
  priority: "low" | "medium" | "high";
  status: AgentTaskStatus;
  mode?: "balanced" | "quick" | "advanced";
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  runs?: AgentRun[];
}

export interface ApprovalRequest {
  id: string;
  agentTaskId: string;
  agentRunId?: string | null;
  agentStepId?: string | null;
  toolName: string;
  parameters: any;
  riskLevel: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
}

export interface CreateTaskPayload {
  workspaceId: string;
  title: string;
  goal: string;
  priority?: "low" | "medium" | "high";
  mode?: "balanced" | "quick" | "advanced";
  context?: Record<string, unknown>;
}

export class AgentApi {
  public static async createTask(payload: CreateTaskPayload): Promise<{ task: AgentTask; run: AgentRun }> {
    return nexusClient.request<{ task: AgentTask; run: AgentRun }>("/api/agents/tasks", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  public static async getTasks(workspaceId?: string, status?: string): Promise<{ tasks: AgentTask[] }> {
    const params = new URLSearchParams();
    if (workspaceId) params.append("workspaceId", workspaceId);
    if (status) params.append("status", status);
    const query = params.toString() ? `?${params.toString()}` : "";
    return nexusClient.request<{ tasks: AgentTask[] }>(`/api/agents/tasks${query}`);
  }

  public static async getTaskById(taskId: string): Promise<{ task: AgentTask }> {
    return nexusClient.request<{ task: AgentTask }>(`/api/agents/tasks/${taskId}`);
  }

  public static async startTask(taskId: string): Promise<{ success: boolean; status: string }> {
    return nexusClient.request<{ success: boolean; status: string }>(`/api/agents/tasks/${taskId}/start`, {
      method: "POST",
    });
  }

  public static async pauseTask(taskId: string): Promise<{ success: boolean; status: string }> {
    return nexusClient.request<{ success: boolean; status: string }>(`/api/agents/tasks/${taskId}/pause`, {
      method: "POST",
    });
  }

  public static async resumeTask(taskId: string): Promise<{ success: boolean; status: string }> {
    return nexusClient.request<{ success: boolean; status: string }>(`/api/agents/tasks/${taskId}/resume`, {
      method: "POST",
    });
  }

  public static async cancelTask(taskId: string): Promise<{ success: boolean; status: string }> {
    return nexusClient.request<{ success: boolean; status: string }>(`/api/agents/tasks/${taskId}/cancel`, {
      method: "POST",
    });
  }

  public static async retryTask(taskId: string): Promise<{ success: boolean; run: AgentRun }> {
    return nexusClient.request<{ success: boolean; run: AgentRun }>(`/api/agents/tasks/${taskId}/retry`, {
      method: "POST",
    });
  }

  public static async getTaskRuns(taskId: string): Promise<{ runs: AgentRun[] }> {
    return nexusClient.request<{ runs: AgentRun[] }>(`/api/agents/tasks/${taskId}/runs`);
  }

  public static async getRunById(runId: string): Promise<{ run: AgentRun }> {
    return nexusClient.request<{ run: AgentRun }>(`/api/agents/runs/${runId}`);
  }

  public static async getRunPlan(runId: string): Promise<{ plan: AgentPlan }> {
    return nexusClient.request<{ plan: AgentPlan }>(`/api/agents/runs/${runId}/plan`);
  }

  public static async getRunSteps(runId: string): Promise<{ steps: AgentStep[] }> {
    return nexusClient.request<{ steps: AgentStep[] }>(`/api/agents/runs/${runId}/steps`);
  }

  public static async getRunArtifacts(runId: string): Promise<{ artifacts: AgentArtifact[] }> {
    return nexusClient.request<{ artifacts: AgentArtifact[] }>(`/api/agents/runs/${runId}/artifacts`);
  }

  public static async getRunToolCalls(runId: string): Promise<{ toolCalls: AgentToolCall[] }> {
    return nexusClient.request<{ toolCalls: AgentToolCall[] }>(`/api/agents/runs/${runId}/tool-calls`);
  }

  public static async getRunObservations(runId: string): Promise<{ observations: AgentObservation[] }> {
    return nexusClient.request<{ observations: AgentObservation[] }>(`/api/agents/runs/${runId}/observations`);
  }

  public static async getRunActivity(runId: string): Promise<{ activity: any[] }> {
    return nexusClient.request<{ activity: any[] }>(`/api/agents/runs/${runId}/activity`);
  }

  public static async resolveApproval(approvalId: string, decision: "APPROVED" | "REJECTED"): Promise<{ success: boolean }> {
    return nexusClient.request<{ success: boolean }>(`/api/approvals/${approvalId}/respond`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    });
  }

  public static async getPendingApprovals(): Promise<{ approvals: ApprovalRequest[] }> {
    return nexusClient.request<{ approvals: ApprovalRequest[] }>("/api/approvals/pending");
  }
}
