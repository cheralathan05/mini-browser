import { nexusClient } from "./nexus-client";

export type AutonomyMode = "manual" | "assisted" | "autonomous";
export type RiskLevel = "safe" | "moderate" | "high";

export interface AutomationStep {
  id: string;
  name: string;
  type: string;
  action?: string;
  target?: string;
  params?: Record<string, any>;
  dependencies?: string[];
  expectedOutput?: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  timeoutMs?: number;
}

export interface ExecutionPlan {
  goal: string;
  requiredCapabilities: string[];
  mode: AutonomyMode;
  steps: AutomationStep[];
  riskLevel: RiskLevel;
  approvalRequirements: string[];
  resourceBudget: {
    maxSteps: number;
    timeoutSec: number;
  };
  completionCriteria: string;
  clarifications?: string[];
}

export interface WorkflowPreset {
  id: string;
  name: string;
  description: string;
  category: "research" | "messaging" | "coding" | "browser" | "forms";
  icon: string;
  defaultMode: AutonomyMode;
  defaultGoal: string;
  capabilities: string[];
  plan: ExecutionPlan;
}

export interface StepExecutionRecord {
  id: string;
  stepId: string;
  status: "pending" | "running" | "completed" | "waiting_approval" | "failed";
  input?: any;
  output?: any;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface WorkflowExecutionRecord {
  id: string;
  workflowId: string;
  status: "running" | "waiting_approval" | "completed" | "failed" | "cancelled";
  mode?: AutonomyMode;
  input?: any;
  output?: any;
  startedAt: string;
  completedAt?: string;
  workflow?: {
    id: string;
    name: string;
    description?: string;
  };
  steps?: StepExecutionRecord[];
}

export interface IntegrationConnection {
  id: string;
  provider: string;
  name: string;
  category: "messaging" | "ai" | "sandbox" | "research" | "capture" | "database";
  status: "connected" | "degraded" | "unconfigured" | "failed";
  scopes: string[];
  lastVerifiedAt: string;
  latencyMs: number;
  configSummary: Record<string, any>;
  description: string;
  error?: string;
}

export interface WhatsAppDeliveryResult {
  success: boolean;
  messageId: string;
  recipient: string;
  status: "accepted" | "sent" | "delivered" | "failed";
  timestamp: string;
  channel: string;
  requiresApproval?: boolean;
  approvalId?: string;
  error?: string;
}

export const automationApi = {
  async getPresets(): Promise<{ presets: WorkflowPreset[] }> {
    return nexusClient.request<{ presets: WorkflowPreset[] }>("/api/v1/automation/presets", {
      method: "GET",
    });
  },

  async planObjective(
    objective: string,
    mode: AutonomyMode = "assisted",
    workspaceId?: string
  ): Promise<{ plan: ExecutionPlan; valid: boolean; errors: string[] }> {
    return nexusClient.request<{ plan: ExecutionPlan; valid: boolean; errors: string[] }>(
      "/api/v1/automation/plan",
      {
        method: "POST",
        body: JSON.stringify({ objective, mode, workspaceId }),
      }
    );
  },

  async execute(params: {
    objective?: string;
    mode?: AutonomyMode;
    workspaceId?: string;
    presetId?: string;
    plan?: ExecutionPlan;
  }): Promise<{ workflowId: string; executionId: string; status: string; plan?: ExecutionPlan }> {
    return nexusClient.request<{ workflowId: string; executionId: string; status: string; plan?: ExecutionPlan }>(
      "/api/v1/automation/execute",
      {
        method: "POST",
        body: JSON.stringify(params),
      }
    );
  },

  async getExecutions(status?: string): Promise<{ executions: WorkflowExecutionRecord[] }> {
    const q = status ? `?status=${encodeURIComponent(status)}` : "";
    return nexusClient.request<{ executions: WorkflowExecutionRecord[] }>(
      `/api/v1/automation/executions${q}`,
      { method: "GET" }
    );
  },

  async getExecution(id: string): Promise<{ execution: WorkflowExecutionRecord }> {
    return nexusClient.request<{ execution: WorkflowExecutionRecord }>(
      `/api/v1/automation/executions/${id}`,
      { method: "GET" }
    );
  },

  async cancelExecution(id: string): Promise<{ success: boolean; message: string }> {
    return nexusClient.request<{ success: boolean; message: string }>(
      `/api/v1/automation/executions/${id}/cancel`,
      { method: "POST" }
    );
  },

  async retryExecution(id: string): Promise<{ workflowId: string; executionId: string; status: string }> {
    return nexusClient.request<{ workflowId: string; executionId: string; status: string }>(
      `/api/v1/automation/executions/${id}/retry`,
      { method: "POST" }
    );
  },

  async sendWhatsAppMessage(payload: {
    recipient: string;
    message: string;
    templateId?: string;
    workspaceId?: string;
    requiresApproval?: boolean;
  }): Promise<{ result: WhatsAppDeliveryResult }> {
    return nexusClient.request<{ result: WhatsAppDeliveryResult }>(
      "/api/v1/automation/whatsapp/send",
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
  },

  async getWhatsAppStatus(): Promise<{
    connection: {
      status: "connected" | "degraded" | "unconfigured";
      channel: string;
      verifiedAt: string;
      accountPhone?: string;
      capabilities: string[];
    };
  }> {
    return nexusClient.request<{
      connection: {
        status: "connected" | "degraded" | "unconfigured";
        channel: string;
        verifiedAt: string;
        accountPhone?: string;
        capabilities: string[];
      };
    }>("/api/v1/automation/whatsapp/status", { method: "GET" });
  },

  async getIntegrations(): Promise<{ integrations: IntegrationConnection[] }> {
    return nexusClient.request<{ integrations: IntegrationConnection[] }>("/api/v1/integrations", {
      method: "GET",
    });
  },

  async verifyIntegration(provider: string): Promise<{ integration: IntegrationConnection }> {
    return nexusClient.request<{ integration: IntegrationConnection }>(
      `/api/v1/integrations/${provider}/verify`,
      { method: "POST" }
    );
  },
};
