export type AgentSessionStatus = "idle" | "running" | "waiting_event" | "queued" | "error" | "interrupted";
export type AgentUiMessageRole = "system" | "user" | "assistant";
export type AgentUiMessageKind = "message" | "tool" | "error";
export type AgentSubAgentRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "needs_user"
  | "blocked"
  | "failed"
  | "cancelled";
export type AgentSubAgentRunKind =
  | "delegated_task"
  | "extraction"
  | "bookmark_organizer"
  | "image_recognition"
  | "user_script"
  | "widget_builder";

export interface AgentSubAgentRunDetail {
  id: string;
  kind: AgentSubAgentRunKind;
  title: string;
  status: AgentSubAgentRunStatus;
  task?: string;
  startUrl?: string;
  tabId?: string;
  windowId?: number;
  workspaceId?: string;
  resourceKey?: string;
  conflictPolicy?: string;
  createdAt?: number;
  updatedAt?: number;
  startedAt?: number;
  finishedAt?: number;
  cancelRequestedAt?: number;
  cancelRequested?: boolean;
  summary?: string;
  nextStep?: string;
  lastError?: string;
  result?: Record<string, unknown>;
  steps?: string[];
}

export interface AgentSubAgentDetails {
  kind: "sub_agents";
  updatedAt: number;
  runs: AgentSubAgentRunDetail[];
}

export interface AgentUiMessage {
  id: string;
  role: AgentUiMessageRole;
  kind: AgentUiMessageKind;
  content: string;
  thinkingContent?: string;
  createdAt: number;
  state?: "running" | "completed" | "failed";
  toolName?: string;
  subAgentDetails?: AgentSubAgentDetails;
}

export interface AgentSessionContextSnapshot {
  activeTabId?: string;
  activeUrl?: string;
  activeTitle?: string;
  originTabId?: string;
  originUrl?: string;
  originTitle?: string;
  browserSessionCount: number;
  subscriptionCount: number;
  recentEventCount: number;
}

export interface AgentBackendSnapshot {
  configured: boolean;
  provider: "openai-compatible";
  providerId: string | null;
  providerName: string | null;
  endpoint: string | null;
  model: string | null;
  source: "env" | "agent-settings" | "image-agent-settings" | "translation-settings" | "missing";
}

export type AgentSessionScheduleTriggerStatus = "triggered" | "skipped" | "failed";
export type AgentSessionEventTriggerStatus = "triggered" | "skipped" | "failed";

export interface AgentSessionScheduleSnapshot {
  prompt: string;
  cronExpression: string;
  timezone: string;
  nextRunAt: number;
  lastTriggeredAt?: number;
  lastTriggerStatus?: AgentSessionScheduleTriggerStatus;
  lastTriggerError?: string;
}

export interface AgentSessionEventMatchSnapshot {
  kinds?: string[];
  source?: string;
  urlMatches?: string;
  titleMatches?: string;
  summaryMatches?: string;
}

export interface AgentSessionEventSnapshot {
  kind: string;
  ts: number;
  url?: string;
  title?: string;
  summary?: string;
  source?: string;
}

export interface AgentSessionEventTriggerSnapshot {
  prompt: string;
  channels: string[];
  match?: AgentSessionEventMatchSnapshot;
  awaitTimeoutMs: number;
  cooldownMs: number;
  lastTriggeredAt?: number;
  lastTriggerStatus?: AgentSessionEventTriggerStatus;
  lastTriggerError?: string;
  lastEvent?: AgentSessionEventSnapshot;
}

export interface AgentLaunchScheduleSnapshot {
  triggerId: string;
  workspaceId: string;
  windowId: number;
  scope: "default" | "current-tab";
  privacyMode: boolean;
  profile: "default" | "organizer" | "widget-builder";
  prompt: string;
  cronExpression: string;
  timezone: string;
  nextRunAt: number;
  createdAt: number;
  updatedAt: number;
  tabId?: string;
  title?: string;
  lastTriggeredAt?: number;
  lastTriggerStatus?: AgentSessionScheduleTriggerStatus;
  lastTriggerError?: string;
  lastSessionId?: string;
}

export type AgentPlanItemStatus = "pending" | "in_progress" | "completed" | "blocked" | "skipped";

export interface AgentPlanItemSnapshot {
  id: string;
  title: string;
  status: AgentPlanItemStatus;
  notes?: string;
}

export interface AgentPlanSnapshot {
  objective: string;
  revision: number;
  updatedAt: number;
  revisionReason?: string;
  items: AgentPlanItemSnapshot[];
}

export interface AgentSessionSnapshot {
  sessionId: string;
  workspaceId: string;
  windowId: number;
  privacyMode: boolean;
  automationWorkspaceBound: boolean;
  createdAt: number;
  updatedAt: number;
  title: string;
  preview: string;
  status: AgentSessionStatus;
  messages: AgentUiMessage[];
  context: AgentSessionContextSnapshot;
  backend: AgentBackendSnapshot;
  schedule?: AgentSessionScheduleSnapshot;
  eventTrigger?: AgentSessionEventTriggerSnapshot;
  plan?: AgentPlanSnapshot;
  lastError?: string;
}

export interface AgentSessionListItem {
  sessionId: string;
  workspaceId: string;
  windowId: number;
  privacyMode: boolean;
  automationWorkspaceBound: boolean;
  createdAt: number;
  updatedAt: number;
  title: string;
  preview: string;
  status: AgentSessionStatus;
  messageCount: number;
  context: AgentSessionContextSnapshot;
  schedule?: AgentSessionScheduleSnapshot;
  eventTrigger?: AgentSessionEventTriggerSnapshot;
  plan?: AgentPlanSnapshot;
  lastError?: string;
}

export interface AgentSessionUpdate {
  sessionId: string;
  reason: "created" | "message" | "status" | "tool" | "context" | "error" | "schedule" | "deleted";
  snapshot: AgentSessionSnapshot | null;
}

export interface AgentSessionDeleteResult {
  sessionId: string;
  deleted: boolean;
}

export interface AgentMcpToolExport {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  risk: "low" | "medium" | "high";
  tags: string[];
}

export interface AgentMcpServerExport {
  sessionId: string;
  title: string;
  workspaceId: string;
  windowId: number;
  tabId?: string;
  automationWorkspaceBound: boolean;
  server: {
    name: string;
    version: string;
  };
  tools: AgentMcpToolExport[];
}

export interface AgentMcpToolCallInput {
  sessionId: string;
  name: string;
  input?: Record<string, unknown> | null;
}

export interface McpToolResultEnvelope {
  content: Array<Record<string, unknown>>;
  structuredContent: unknown;
  isError?: boolean;
}
