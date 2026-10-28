import { nexusClient } from "./nexus-client";

export type NodeCategory =
  | "trigger"
  | "browser"
  | "ai"
  | "research"
  | "data"
  | "comm"
  | "logic"
  | "output";

export interface NodePort {
  id: string;
  name: string;
  type: "any" | "string" | "number" | "boolean" | "object" | "array" | "control";
  required?: boolean;
  description?: string;
}

export interface NodeMetadata {
  type: string;
  category: NodeCategory;
  title: string;
  description: string;
  inputs: NodePort[];
  outputs: NodePort[];
  defaultConfig: Record<string, any>;
  icon?: string;
  badgeColor?: string;
  permissions?: string[];
  requiresApproval?: boolean;
}

export interface VisualNode {
  id: string;
  type: string;
  title: string;
  category: NodeCategory;
  position: { x: number; y: number };
  config: Record<string, any>;
  inputs?: NodePort[];
  outputs?: NodePort[];
  status?:
    | "pending"
    | "ready"
    | "running"
    | "waiting_for_approval"
    | "succeeded"
    | "failed"
    | "skipped"
    | "cancelled";
  outputData?: any;
  error?: string;
}

export interface VisualEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
  status?: "pending" | "active" | "completed" | "failed";
}

export interface VisualWorkflowDefinition {
  viewport?: { x: number; y: number; zoom: number };
  nodes: VisualNode[];
  edges: VisualEdge[];
  variables?: Record<string, any>;
}

export interface WorkflowRecord {
  id: string;
  workspaceId: string;
  userId?: string;
  name: string;
  description?: string;
  definition: VisualWorkflowDefinition | Record<string, any>;
  status: "active" | "draft" | "archived";
  version: number;
  createdAt: string;
  updatedAt: string;
  _count?: {
    executions: number;
    versions: number;
  };
  versions?: WorkflowVersionRecord[];
  executions?: WorkflowExecutionSummary[];
}

export interface WorkflowVersionRecord {
  id: string;
  workflowId: string;
  version: number;
  definition: VisualWorkflowDefinition;
  changeLog?: string;
  createdAt: string;
}

export interface WorkflowExecutionSummary {
  id: string;
  workflowId: string;
  version: number;
  status: "queued" | "running" | "waiting_for_approval" | "paused" | "completed" | "partially_completed" | "failed" | "cancelled";
  mode: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
  steps?: Array<{
    id: string;
    stepId: string;
    nodeId?: string;
    nodeType?: string;
    status: string;
    startedAt?: string;
    completedAt?: string;
    output?: any;
    error?: string;
  }>;
}

export interface ValidationError {
  nodeId?: string;
  edgeId?: string;
  field?: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  nodeId?: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export const NODE_PALETTE: NodeMetadata[] = [
  // Triggers
  {
    type: "trigger.manual",
    category: "trigger",
    title: "Manual Trigger",
    description: "Starts the workflow on manual execution click or API dispatch",
    inputs: [],
    outputs: [{ id: "out", name: "Trigger", type: "control" }],
    defaultConfig: {},
    badgeColor: "emerald",
  },
  {
    type: "trigger.schedule",
    category: "trigger",
    title: "Scheduled Trigger",
    description: "Fires periodically on a configured cron expression or interval",
    inputs: [],
    outputs: [{ id: "out", name: "Trigger", type: "control" }],
    defaultConfig: { cron: "0 * * * *", intervalMinutes: 60 },
    badgeColor: "emerald",
  },
  {
    type: "trigger.webhook",
    category: "trigger",
    title: "Webhook Trigger",
    description: "Listens for incoming HTTP POST payloads with secure authentication",
    inputs: [],
    outputs: [
      { id: "payload", name: "Payload", type: "object" },
      { id: "out", name: "Trigger", type: "control" },
    ],
    defaultConfig: { path: "/webhook/custom", method: "POST" },
    badgeColor: "emerald",
  },

  // Browser Nodes
  {
    type: "browser.openUrl",
    category: "browser",
    title: "Open URL",
    description: "Safely navigates to an authorized URL with SSRF protection",
    inputs: [
      { id: "in", name: "Flow In", type: "control", required: true },
      { id: "url", name: "Target URL", type: "string", required: true },
    ],
    outputs: [
      { id: "out", name: "Flow Out", type: "control" },
      { id: "status", name: "HTTP Status", type: "number" },
      { id: "title", name: "Page Title", type: "string" },
    ],
    defaultConfig: { url: "https://example.com/form", timeoutMs: 15000 },
    badgeColor: "cyan",
  },
  {
    type: "browser.inspectPage",
    category: "browser",
    title: "Inspect Page",
    description: "Collects DOM telemetry, headings, meta tags, and interactive links",
    inputs: [{ id: "in", name: "Flow In", type: "control", required: true }],
    outputs: [
      { id: "out", name: "Flow Out", type: "control" },
      { id: "headings", name: "Headings", type: "array" },
      { id: "metadata", name: "Metadata", type: "object" },
    ],
    defaultConfig: { includeLinks: true, maxElements: 50 },
    badgeColor: "cyan",
  },
  {
    type: "browser.click",
    category: "browser",
    title: "Click Element",
    description: "Simulates an authorized user click on a target CSS selector",
    inputs: [
      { id: "in", name: "Flow In", type: "control", required: true },
      { id: "selector", name: "CSS Selector", type: "string", required: true },
    ],
    outputs: [{ id: "out", name: "Flow Out", type: "control" }],
    defaultConfig: { selector: "button[type='submit']", waitForNavigation: false },
    badgeColor: "cyan",
  },
  {
    type: "browser.fillForm",
    category: "browser",
    title: "Fill Form Field",
    description: "Populates form fields with verified data payload",
    inputs: [
      { id: "in", name: "Flow In", type: "control", required: true },
      { id: "formData", name: "Form Data", type: "object" },
    ],
    outputs: [
      { id: "out", name: "Flow Out", type: "control" },
      { id: "filledCount", name: "Fields Filled", type: "number" },
    ],
    defaultConfig: {
      fields: {
        "input[name='fullName']": "Alex Rivera",
        "input[name='email']": "alex@nexus.io",
      },
      clearBeforeTyping: true,
    },
    badgeColor: "cyan",
  },
  {
    type: "browser.extractData",
    category: "browser",
    title: "Extract Page Data",
    description: "Scrapes structured table rows, lists, or text contents",
    inputs: [
      { id: "in", name: "Flow In", type: "control", required: true },
      { id: "selector", name: "Selector", type: "string" },
    ],
    outputs: [
      { id: "out", name: "Flow Out", type: "control" },
      { id: "records", name: "Extracted Records", type: "array" },
    ],
    defaultConfig: { selector: ".item-row, article", extractAttributes: ["href", "text"] },
    badgeColor: "cyan",
  },
  {
    type: "browser.captureScreenshot",
    category: "browser",
    title: "Capture Screenshot",
    description: "Captures a full-page or viewport screenshot via Playwright",
    inputs: [{ id: "in", name: "Flow In", type: "control", required: true }],
    outputs: [
      { id: "out", name: "Flow Out", type: "control" },
      { id: "screenshotUrl", name: "Screenshot URL", type: "string" },
    ],
    defaultConfig: { fullPage: true, quality: 90 },
    badgeColor: "cyan",
  },

  // AI Nodes
  {
    type: "ai.classify",
    category: "ai",
    title: "Classify Text",
    description: "Uses local Ollama or OpenAI to categorize input into predefined labels",
    inputs: [
      { id: "in", name: "Flow In", type: "control", required: true },
      { id: "text", name: "Input Text", type: "string", required: true },
    ],
    outputs: [
      { id: "out", name: "Flow Out", type: "control" },
      { id: "category", name: "Assigned Category", type: "string" },
      { id: "confidence", name: "Confidence Score", type: "number" },
    ],
    defaultConfig: { categories: ["Support", "Billing", "Feature Request", "Urgent"] },
    badgeColor: "violet",
  },
  {
    type: "ai.summarize",
    category: "ai",
    title: "Summarize Content",
    description: "Generates an executive briefing or concise summary of target text",
    inputs: [
      { id: "in", name: "Flow In", type: "control", required: true },
      { id: "content", name: "Content", type: "string", required: true },
    ],
    outputs: [
      { id: "out", name: "Flow Out", type: "control" },
      { id: "summary", name: "Summary", type: "string" },
    ],
    defaultConfig: { maxWords: 150, format: "bullet_points" },
    badgeColor: "violet",
  },
  {
    type: "ai.extractStructured",
    category: "ai",
    title: "Extract Structured Information",
    description: "Extracts schema-conforming JSON fields from unstructured documents",
    inputs: [
      { id: "in", name: "Flow In", type: "control", required: true },
      { id: "text", name: "Unstructured Text", type: "string", required: true },
    ],
    outputs: [
      { id: "out", name: "Flow Out", type: "control" },
      { id: "data", name: "Structured Data", type: "object" },
    ],
    defaultConfig: { schema: { name: "string", email: "string", amount: "number" } },
    badgeColor: "violet",
  },
  {
    type: "ai.visionAnalysis",
    category: "ai",
    title: "Vision Analysis",
    description: "Analyzes visual screenshots, UI layout, accessibility, and visual hierarchy",
    inputs: [
      { id: "in", name: "Flow In", type: "control", required: true },
      { id: "imageRef", name: "Image Reference", type: "string" },
    ],
    outputs: [
      { id: "out", name: "Flow Out", type: "control" },
      { id: "analysis", name: "Vision Analysis", type: "string" },
    ],
    defaultConfig: { prompt: "Analyze the visual UI hierarchy and UX layout of this screenshot." },
    badgeColor: "violet",
  },

  // Research Nodes
  {
    type: "research.search",
    category: "research",
    title: "Search Sources",
    description: "Executes multi-channel queries across DuckDuckGo, ArXiv, GitHub, and News",
    inputs: [
      { id: "in", name: "Flow In", type: "control", required: true },
      { id: "query", name: "Search Query", type: "string", required: true },
    ],
    outputs: [
      { id: "out", name: "Flow Out", type: "control" },
      { id: "sources", name: "Discovered Sources", type: "array" },
    ],
    defaultConfig: { maxResults: 5, channels: ["duckduckgo", "github"] },
    badgeColor: "amber",
  },
  {
    type: "research.generateReport",
    category: "research",
    title: "Generate Cited Report",
    description: "Synthesizes multi-source research into an evidence-backed report with citations",
    inputs: [
      { id: "in", name: "Flow In", type: "control", required: true },
      { id: "topic", name: "Topic", type: "string", required: true },
    ],
    outputs: [
      { id: "out", name: "Flow Out", type: "control" },
      { id: "reportMarkdown", name: "Report Markdown", type: "string" },
    ],
    defaultConfig: { mode: "standard", minSources: 3 },
    badgeColor: "amber",
  },

  // Data Nodes
  {
    type: "data.transform",
    category: "data",
    title: "Transform Structured Data",
    description: "Applies field mapping, trimming, and JSON transformations",
    inputs: [
      { id: "in", name: "Flow In", type: "control", required: true },
      { id: "inputData", name: "Input Object", type: "object", required: true },
    ],
    outputs: [
      { id: "out", name: "Flow Out", type: "control" },
      { id: "transformed", name: "Transformed Data", type: "object" },
    ],
    defaultConfig: { mappings: { title: "name", userEmail: "email" } },
    badgeColor: "blue",
  },
  {
    type: "data.filter",
    category: "data",
    title: "Filter Records",
    description: "Filters an array of records matching predicate conditions",
    inputs: [
      { id: "in", name: "Flow In", type: "control", required: true },
      { id: "records", name: "Records", type: "array", required: true },
    ],
    outputs: [
      { id: "out", name: "Flow Out", type: "control" },
      { id: "filtered", name: "Filtered Records", type: "array" },
    ],
    defaultConfig: { field: "status", operator: "equals", value: "active" },
    badgeColor: "blue",
  },

  // Communication Nodes
  {
    type: "comm.prepareWhatsApp",
    category: "comm",
    title: "Prepare WhatsApp Message",
    description: "Validates E.164 phone number and formats approved message templates",
    inputs: [
      { id: "in", name: "Flow In", type: "control", required: true },
      { id: "phone", name: "Phone Number", type: "string", required: true },
      { id: "message", name: "Message Body", type: "string", required: true },
    ],
    outputs: [
      { id: "out", name: "Flow Out", type: "control" },
      { id: "payload", name: "Prepared Payload", type: "object" },
    ],
    defaultConfig: { phone: "+15550192834", message: "Hello from NEXUS Automation Studio." },
    badgeColor: "emerald",
  },
  {
    type: "comm.requestApproval",
    category: "comm",
    title: "Approval Gate",
    description: "Human-in-the-loop authorization boundary; halts execution until reviewed",
    inputs: [
      { id: "in", name: "Flow In", type: "control", required: true },
      { id: "actionDetails", name: "Action Payload", type: "object" },
    ],
    outputs: [
      { id: "approved", name: "Approved Flow", type: "control" },
      { id: "rejected", name: "Rejected Flow", type: "control" },
    ],
    defaultConfig: {
      action: "Send External Message",
      riskLevel: "moderate",
      timeoutHours: 24,
    },
    badgeColor: "amber",
    requiresApproval: true,
  },
  {
    type: "comm.sendWhatsApp",
    category: "comm",
    title: "Send WhatsApp Action",
    description: "Dispatches payload via configured WhatsApp Gateway and returns delivery status",
    inputs: [
      { id: "in", name: "Flow In", type: "control", required: true },
      { id: "phone", name: "Phone Number", type: "string" },
      { id: "message", name: "Message Body", type: "string" },
    ],
    outputs: [
      { id: "out", name: "Flow Out", type: "control" },
      { id: "messageId", name: "Message ID", type: "string" },
      { id: "deliveryStatus", name: "Delivery Status", type: "string" },
    ],
    defaultConfig: { phone: "+15550192834", message: "Automated alert from NEXUS." },
    badgeColor: "emerald",
  },

  // Logic Nodes
  {
    type: "logic.ifElse",
    category: "logic",
    title: "If / Else Condition",
    description: "Evaluates boolean logic and branches execution conditionally",
    inputs: [
      { id: "in", name: "Flow In", type: "control", required: true },
      { id: "condition", name: "Condition Value", type: "boolean" },
    ],
    outputs: [
      { id: "true", name: "True Branch", type: "control" },
      { id: "false", name: "False Branch", type: "control" },
    ],
    defaultConfig: { operator: "isTrue", field: "condition" },
    badgeColor: "violet",
  },
  {
    type: "logic.loop",
    category: "logic",
    title: "Bounded Loop",
    description: "Iterates over an array with a hard maximum boundary (max 10 iterations)",
    inputs: [
      { id: "in", name: "Flow In", type: "control", required: true },
      { id: "items", name: "Items Array", type: "array" },
    ],
    outputs: [
      { id: "loopBody", name: "Loop Item", type: "control" },
      { id: "done", name: "Loop Done", type: "control" },
    ],
    defaultConfig: { maxIterations: 5 },
    badgeColor: "violet",
  },

  // Output Nodes
  {
    type: "output.saveReport",
    category: "output",
    title: "Save Report",
    description: "Persists output document to PostgreSQL ResearchReport records",
    inputs: [
      { id: "in", name: "Flow In", type: "control", required: true },
      { id: "content", name: "Report Markdown", type: "string" },
    ],
    outputs: [
      { id: "out", name: "Flow Out", type: "control" },
      { id: "reportId", name: "Report ID", type: "string" },
    ],
    defaultConfig: { title: "Automated Workflow Report" },
    badgeColor: "cyan",
  },
  {
    type: "output.writeDatabase",
    category: "output",
    title: "Write Database Record",
    description: "Persists workflow telemetry or artifacts directly to PostgreSQL Memory Vault",
    inputs: [
      { id: "in", name: "Flow In", type: "control", required: true },
      { id: "data", name: "Data Payload", type: "object" },
    ],
    outputs: [
      { id: "out", name: "Flow Out", type: "control" },
      { id: "recordId", name: "Saved ID", type: "string" },
    ],
    defaultConfig: { table: "Memory", title: "Workflow Output" },
    badgeColor: "cyan",
  },
  {
    type: "output.end",
    category: "output",
    title: "End Workflow",
    description: "Marks workflow as successfully completed and returns aggregated results",
    inputs: [{ id: "in", name: "Flow In", type: "control", required: true }],
    outputs: [],
    defaultConfig: {},
    badgeColor: "emerald",
  },
];

export const workflowBuilderApi = {
  async getWorkflows(workspaceId?: string): Promise<{ workflows: WorkflowRecord[] }> {
    const q = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
    return nexusClient.request<{ workflows: WorkflowRecord[] }>(`/api/v1/workflows${q}`, {
      method: "GET",
    });
  },

  async getWorkflow(id: string): Promise<{ workflow: WorkflowRecord }> {
    return nexusClient.request<{ workflow: WorkflowRecord }>(`/api/v1/workflows/${id}`, {
      method: "GET",
    });
  },

  async createWorkflow(params: {
    name: string;
    description?: string;
    workspaceId?: string;
    definition: VisualWorkflowDefinition | Record<string, any>;
    status?: "active" | "draft" | "archived";
  }): Promise<{ workflow: WorkflowRecord }> {
    return nexusClient.request<{ workflow: WorkflowRecord }>("/api/v1/workflows", {
      method: "POST",
      body: JSON.stringify(params),
    });
  },

  async updateWorkflow(
    id: string,
    params: {
      name?: string;
      description?: string;
      definition?: VisualWorkflowDefinition | Record<string, any>;
      status?: "active" | "draft" | "archived";
      changeLog?: string;
    }
  ): Promise<{ workflow: WorkflowRecord }> {
    return nexusClient.request<{ workflow: WorkflowRecord }>(`/api/v1/workflows/${id}`, {
      method: "PATCH",
      body: JSON.stringify(params),
    });
  },

  async deleteWorkflow(id: string): Promise<{ success: boolean; message: string }> {
    return nexusClient.request<{ success: boolean; message: string }>(`/api/v1/workflows/${id}`, {
      method: "DELETE",
    });
  },

  async duplicateWorkflow(id: string): Promise<{ workflow: WorkflowRecord }> {
    return nexusClient.request<{ workflow: WorkflowRecord }>(`/api/v1/workflows/${id}/duplicate`, {
      method: "POST",
    });
  },

  async validateWorkflow(
    id: string,
    definition?: VisualWorkflowDefinition
  ): Promise<ValidationResult> {
    return nexusClient.request<ValidationResult>(`/api/v1/workflows/${id}/validate`, {
      method: "POST",
      body: JSON.stringify({ definition }),
    });
  },

  async runWorkflow(
    id: string,
    definition?: VisualWorkflowDefinition
  ): Promise<{ executionId: string; status: string }> {
    return nexusClient.request<{ executionId: string; status: string }>(
      `/api/v1/workflows/${id}/run`,
      {
        method: "POST",
        body: JSON.stringify({ definition }),
      }
    );
  },

  async getVersions(id: string): Promise<{ versions: WorkflowVersionRecord[] }> {
    return nexusClient.request<{ versions: WorkflowVersionRecord[] }>(
      `/api/v1/workflows/${id}/versions`,
      {
        method: "GET",
      }
    );
  },

  async getExecutions(status?: string): Promise<{ executions: WorkflowExecutionSummary[] }> {
    const q = status ? `?status=${encodeURIComponent(status)}` : "";
    return nexusClient.request<{ executions: WorkflowExecutionSummary[] }>(
      `/api/v1/executions${q}`,
      {
        method: "GET",
      }
    );
  },

  async getExecution(id: string): Promise<{ execution: WorkflowExecutionSummary }> {
    return nexusClient.request<{ execution: WorkflowExecutionSummary }>(
      `/api/v1/executions/${id}`,
      {
        method: "GET",
      }
    );
  },

  async cancelExecution(id: string): Promise<{ success: boolean; message: string }> {
    return nexusClient.request<{ success: boolean; message: string }>(
      `/api/v1/executions/${id}/cancel`,
      {
        method: "POST",
      }
    );
  },
};
