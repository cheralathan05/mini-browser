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

export const NODE_REGISTRY: Record<string, NodeMetadata> = {
  // Triggers
  "trigger.manual": {
    type: "trigger.manual",
    category: "trigger",
    title: "Manual Trigger",
    description: "Starts the workflow on manual execution click or API dispatch",
    inputs: [],
    outputs: [{ id: "out", name: "Trigger", type: "control" }],
    defaultConfig: {},
    badgeColor: "emerald",
  },
  "trigger.schedule": {
    type: "trigger.schedule",
    category: "trigger",
    title: "Scheduled Trigger",
    description: "Fires periodically on a configured cron expression or interval",
    inputs: [],
    outputs: [{ id: "out", name: "Trigger", type: "control" }],
    defaultConfig: { cron: "0 * * * *", intervalMinutes: 60 },
    badgeColor: "emerald",
  },
  "trigger.webhook": {
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
  "browser.openUrl": {
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
    defaultConfig: { url: "https://example.com", timeoutMs: 15000 },
    badgeColor: "cyan",
  },
  "browser.inspectPage": {
    type: "browser.inspectPage",
    category: "browser",
    title: "Inspect Page",
    description: "Collects DOM telemetry, headings, meta tags, and interactive links",
    inputs: [
      { id: "in", name: "Flow In", type: "control", required: true },
    ],
    outputs: [
      { id: "out", name: "Flow Out", type: "control" },
      { id: "headings", name: "Headings", type: "array" },
      { id: "metadata", name: "Metadata", type: "object" },
    ],
    defaultConfig: { includeLinks: true, maxElements: 50 },
    badgeColor: "cyan",
  },
  "browser.click": {
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
  "browser.fillForm": {
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
  "browser.extractData": {
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
  "browser.captureScreenshot": {
    type: "browser.captureScreenshot",
    category: "browser",
    title: "Capture Screenshot",
    description: "Captures a full-page or viewport screenshot via Playwright",
    inputs: [
      { id: "in", name: "Flow In", type: "control", required: true },
    ],
    outputs: [
      { id: "out", name: "Flow Out", type: "control" },
      { id: "screenshotUrl", name: "Screenshot URL", type: "string" },
    ],
    defaultConfig: { fullPage: true, quality: 90 },
    badgeColor: "cyan",
  },

  // AI Nodes
  "ai.classify": {
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
  "ai.summarize": {
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
  "ai.extractStructured": {
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
  "ai.visionAnalysis": {
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
  "skill.execute": {
    type: "skill.execute",
    category: "ai",
    title: "Execute Agent Skill",
    description: "Invokes a verified capability from the Skills Registry with mapped inputs",
    inputs: [
      { id: "in", name: "Flow In", type: "control", required: true },
      { id: "skillInputs", name: "Skill Inputs", type: "object" },
    ],
    outputs: [
      { id: "out", name: "Flow Out", type: "control" },
      { id: "skillResult", name: "Skill Result", type: "object" },
    ],
    defaultConfig: { skillId: "", skillName: "Competitor Pricing Monitor", inputs: {} },
    badgeColor: "violet",
  },

  // Research Nodes
  "research.search": {
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
  "research.generateReport": {
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
  "data.transform": {
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
  "data.filter": {
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
  "comm.prepareWhatsApp": {
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
  "comm.requestApproval": {
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
  "comm.sendWhatsApp": {
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
  "logic.ifElse": {
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
  "logic.loop": {
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
  "output.saveReport": {
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
  "output.writeDatabase": {
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
  "output.end": {
    type: "output.end",
    category: "output",
    title: "End Workflow",
    description: "Marks workflow as successfully completed and returns aggregated results",
    inputs: [
      { id: "in", name: "Flow In", type: "control", required: true },
    ],
    outputs: [],
    defaultConfig: {},
    badgeColor: "emerald",
  },
};
