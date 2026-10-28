export type AutonomyMode = "manual" | "assisted" | "autonomous";

export type RiskLevel = "safe" | "moderate" | "high";

export type AutomationStepType =
  | "browser.navigate"
  | "browser.extract"
  | "browser.fillForm"
  | "browser.submitForm"
  | "browser.whatsappSend"
  | "browser.capture"
  | "ai.plan"
  | "ai.synthesize"
  | "research.search"
  | "coding.generate"
  | "coding.execute"
  | "memory.save"
  | "approval.gate";

export interface AutomationStep {
  id: string;
  name: string;
  type: AutomationStepType | string;
  action?: string;
  target?: string;
  params?: Record<string, any>;
  dependencies?: string[];
  expectedOutput?: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  timeoutMs?: number;
  retryPolicy?: {
    maxRetries: number;
    backoffMs: number;
  };
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

export interface WhatsAppMessagePayload {
  recipient: string;
  message: string;
  templateId?: string;
  mediaUrl?: string;
  requiresApproval?: boolean;
}

export interface WhatsAppDeliveryResult {
  success: boolean;
  messageId: string;
  recipient: string;
  status: "accepted" | "sent" | "delivered" | "failed";
  timestamp: string;
  channel: "WhatsApp Cloud API" | "WhatsApp Web Gateway";
  requiresApproval?: boolean;
  approvalId?: string;
  error?: string;
}
