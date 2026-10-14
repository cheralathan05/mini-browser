export type NexusWebSocketEventType =
  // Flagship Agent Lifecycle & Telemetry Events
  | "agent.created"
  | "agent.planning"
  | "agent.planReady"
  | "agent.started"
  | "agent.stepStarted"
  | "agent.toolStarted"
  | "agent.toolCompleted"
  | "agent.observation"
  | "agent.observationCreated"
  | "agent.stepCompleted"
  | "agent.stepVerified"
  | "agent.approvalRequired"
  | "agent.paused"
  | "agent.resumed"
  | "agent.retrying"
  | "agent.completed"
  | "agent.failed"
  | "agent.cancelled"
  // Legacy Agent Events (backwards compatibility)
  | "agent.task.created"
  | "agent.task.started"
  | "agent.step.started"
  | "agent.step.completed"
  | "agent.task.completed"
  | "agent.task.failed"
  // Browser Events
  | "browser.navigation"
  | "browser.action"
  | "browser.command"
  | "browser.command.result"
  // Approvals Events
  | "approval.required"
  | "approval.resolved"
  // System & Modules Events
  | "research.project.created"
  | "research.progress"
  | "workflow.progress"
  | "memory.created"
  | "memory.updated"
  | "memory.deleted"
  | "memory.archived"
  | "workspace.created"
  | "workspace.updated"
  | "workspace.deleted"
  | "notification.created"
  | "system.heartbeat";


export interface NexusWebSocketMessage<T = unknown> {
  event: NexusWebSocketEventType;
  payload: T;
  timestamp: string;
  userId?: string;
  workspaceId?: string;
}
