export type SkillLifecycleState =
  | "draft"
  | "validating"
  | "ready"
  | "active"
  | "disabled"
  | "deprecated"
  | "failed_validation";

export type SkillCategory =
  | "research"
  | "browser"
  | "coding"
  | "automation"
  | "data";

export interface InputFieldDefinition {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  label?: string;
  description?: string;
  required: boolean;
  defaultValue?: any;
}

export interface OutputFieldDefinition {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
}

export interface SkillPermissions {
  network: boolean;
  browser: boolean;
  sandbox: boolean;
  approvalRequired: boolean;
}

export interface SkillExecutionConfig {
  timeoutSeconds: number;
  maxRetries: number;
  sideEffectClassification?: "read_only" | "idempotent_mutation" | "sensitive_mutation";
}

export interface SkillDefinition {
  instructions: string;
  executorType: "standard" | "pipeline" | "orchestrated";
  tools: string[];
  inputSchema: InputFieldDefinition[];
  outputSchema: OutputFieldDefinition[];
  permissions: SkillPermissions;
  config: SkillExecutionConfig;
  testCases?: Array<{
    name: string;
    description?: string;
    inputs: Record<string, any>;
    expectedOutputs?: Record<string, any>;
  }>;
}

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ field?: string; message: string; code: string }>;
  warnings: Array<{ field?: string; message: string }>;
}

export interface ToolExecutionContext {
  userId: string;
  workspaceId?: string;
  skillId: string;
  version: number;
  executionId: string;
}

export interface RegisteredTool {
  id: string;
  name: string;
  description: string;
  category: "browser" | "research" | "coding" | "memory" | "approval" | "reporting" | "ai";
  inputSchema: Record<string, string>;
  outputSchema: Record<string, string>;
  permissions: string[];
  timeout: number;
  sideEffect: "read_only" | "idempotent_mutation" | "sensitive_mutation";
  handler: (inputs: any, context: ToolExecutionContext) => Promise<any>;
}
