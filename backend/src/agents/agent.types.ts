// NEXUS AI AGENT - CORE TYPE SYSTEM

export type AgentTaskStatus =
  | "DRAFT"
  | "READY"
  | "RUNNING"
  | "PAUSED"
  | "WAITING_APPROVAL"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type AgentRunStatus =
  | "DRAFT"
  | "READY"
  | "RUNNING"
  | "PAUSED"
  | "WAITING_APPROVAL"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type AgentStepStatus =
  | "PENDING"
  | "RUNNING"
  | "WAITING_APPROVAL"
  | "COMPLETED"
  | "FAILED"
  | "SKIPPED"
  | "CANCELLED";

export type ExecutionMode = "quick" | "balanced" | "advanced";

export type ToolRiskLevel = "safe" | "read_only" | "consequential" | "critical_approval";

export interface PlannedStep {
  id: string;
  order: number;
  description: string;
  toolName: string;
  input?: Record<string, unknown>;
  dependencies?: string[];
  verification: string;
  status?: AgentStepStatus;
}

export interface AgentExecutionPlan {
  objective: string;
  steps: PlannedStep[];
}

export interface ToolExecutionContext {
  userId: string;
  workspaceId: string;
  spaceId?: string;
  taskId: string;
  runId: string;
  stepId?: string;
  signal?: AbortSignal;
}

export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  approvalRequired?: boolean;
  approvalId?: string;
  durationMs?: number;
  riskLevel?: ToolRiskLevel;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  riskLevel?: ToolRiskLevel;
  requiresApproval?: boolean;
  execute: (input: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolExecutionResult>;
}

export interface AgentObservationPayload {
  url?: string;
  title?: string;
  summary?: string;
  extractedData?: unknown;
  metadata?: Record<string, unknown>;
}

export interface VerificationResult {
  passed: boolean;
  reason?: string;
  completedGoal: boolean;
  adaptPlan?: boolean;
  adaptedSteps?: PlannedStep[];
}

export interface AgentArtifactPayload {
  type: "report" | "document" | "research" | "url" | "file" | "memory" | "task" | "workflow";
  name: string;
  location?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentTelemetryEvent {
  taskId: string;
  runId: string;
  stepId?: string;
  stepIndex?: number;
  toolName?: string;
  status?: string;
  message?: string;
  timestamp: string;
  payload?: Record<string, unknown>;
}
