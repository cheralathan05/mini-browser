export type ContextType = "page" | "selection" | "research" | "task" | "general";

export interface PageContext {
  type: "page";
  url?: string;
  title?: string;
  favicon?: string;
  selectedText?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface SelectionContext {
  type: "selection";
  text: string;
  url?: string;
  title?: string;
}

export interface ResearchContext {
  type: "research";
  projectId?: string;
  question?: string;
  sourceCount?: number;
  findingsCount?: number;
  recentFindings?: string[];
}

export interface TaskContext {
  type: "task";
  taskId?: string;
  title?: string;
  goal?: string;
  status?: string;
}

export type AIContextPayload =
  | PageContext
  | SelectionContext
  | ResearchContext
  | TaskContext
  | { type: "general"; [key: string]: unknown };

export interface AIStreamEvent {
  event: "message:start" | "message:token" | "message:tool" | "message:action" | "message:complete" | "message:error";
  data: {
    messageId?: string;
    conversationId?: string;
    text?: string;
    action?: {
      type: "launch_agent" | "create_workflow" | "save_memory" | "create_task" | "start_research" | "research" | "implement_code";
      title: string;
      description: string;
      payload?: Record<string, unknown>;
    };
    model?: string;
    error?: string;
    done?: boolean;
  };
}

export interface IntentDetectionResult {
  intent: "general" | "research_agent" | "workflow_automation" | "memory_save" | "task_reminder" | "coding_solution";
  suggestedAction?: {
    type: "launch_agent" | "create_workflow" | "save_memory" | "create_task" | "start_research" | "research" | "implement_code";
    title: string;
    description: string;
    payload?: Record<string, unknown>;
  };
}
