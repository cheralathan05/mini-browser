import { nexusClient } from "./nexus-client";

export interface InputFieldDef {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  label?: string;
  description?: string;
  required: boolean;
  defaultValue?: any;
}

export interface OutputFieldDef {
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

export interface SkillConfig {
  timeoutSeconds: number;
  maxRetries: number;
}

export interface SkillVersionItem {
  id: string;
  version: number;
  createdAt: string;
  changeLog?: string;
  definition?: any;
  inputSchema?: InputFieldDef[];
  outputSchema?: OutputFieldDef[];
  tools?: string[];
  permissions?: SkillPermissions;
  config?: SkillConfig;
}

export interface SkillExecutionItem {
  id: string;
  status: "queued" | "running" | "waiting_for_approval" | "completed" | "partially_completed" | "failed" | "cancelled";
  durationMs: number;
  inputs?: any;
  outputs?: any;
  error?: string;
  toolExecutions?: Array<{
    toolId: string;
    status: string;
    durationMs: number;
    outputs?: any;
    error?: string;
  }>;
  startedAt: string;
  completedAt?: string;
}

export interface SkillTestItem {
  id: string;
  name: string;
  status: "pending" | "passed" | "failed";
  inputs: any;
  result?: any;
  error?: string;
  durationMs?: number;
  lastRunAt?: string;
}

export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  instructions?: string;
  category: "research" | "browser" | "coding" | "automation" | "data";
  lifecycleState: "draft" | "validating" | "ready" | "active" | "disabled" | "deprecated" | "failed_validation";
  currentVersion: number;
  tags: string[];
  isSystem?: boolean;
  tools: string[];
  inputSchema: InputFieldDef[];
  outputSchema: OutputFieldDef[];
  permissions: SkillPermissions;
  config: SkillConfig;
  validationErrors?: Array<{ field?: string; message: string; code: string }>;
  versions?: SkillVersionItem[];
  executions?: SkillExecutionItem[];
  tests?: SkillTestItem[];
  createdAt: string;
  updatedAt: string;
}

export interface ToolCatalogItem {
  id: string;
  name: string;
  description: string;
  category: string;
  inputSchema: Record<string, string>;
  outputSchema: Record<string, string>;
  permissions: string[];
  timeout: number;
  sideEffect: string;
}

export const skillsApi = {
  async getSkills(params?: { workspaceId?: string; status?: string; category?: string; search?: string }): Promise<{ skills: SkillRecord[]; count: number }> {
    const query = new URLSearchParams();
    if (params?.workspaceId) query.set("workspaceId", params.workspaceId);
    if (params?.status) query.set("status", params.status);
    if (params?.category) query.set("category", params.category);
    if (params?.search) query.set("search", params.search);
    const qs = query.toString();
    const endpoint = `/api/v1/skills${qs ? `?${qs}` : ""}`;
    return (nexusClient as any).request(endpoint);
  },

  async getSkill(id: string): Promise<{ skill: SkillRecord }> {
    return (nexusClient as any).request(`/api/v1/skills/${id}`);
  },

  async createSkill(data: Partial<SkillRecord> & { workspaceId?: string }): Promise<{ skill: SkillRecord; validation: any }> {
    return (nexusClient as any).request("/api/v1/skills", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async updateSkill(id: string, data: Partial<SkillRecord>): Promise<{ skill: SkillRecord }> {
    return (nexusClient as any).request(`/api/v1/skills/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  async deleteSkill(id: string): Promise<{ success: boolean; message: string }> {
    return (nexusClient as any).request(`/api/v1/skills/${id}`, {
      method: "DELETE",
    });
  },

  async validateSkill(id: string): Promise<{ validation: { valid: boolean; errors: any[]; warnings: any[] } }> {
    return (nexusClient as any).request(`/api/v1/skills/${id}/validate`, {
      method: "POST",
    });
  },

  async activateSkill(id: string): Promise<{ skill: SkillRecord; message: string }> {
    return (nexusClient as any).request(`/api/v1/skills/${id}/activate`, {
      method: "POST",
    });
  },

  async disableSkill(id: string): Promise<{ skill: SkillRecord; message: string }> {
    return (nexusClient as any).request(`/api/v1/skills/${id}/disable`, {
      method: "POST",
    });
  },

  async executeSkill(id: string, inputs: Record<string, any>, options?: { version?: number; caller?: string }): Promise<{ execution: SkillExecutionItem }> {
    return (nexusClient as any).request(`/api/v1/skills/${id}/execute`, {
      method: "POST",
      body: JSON.stringify({ inputs, version: options?.version, caller: options?.caller || "manual" }),
    });
  },

  async getVersions(id: string): Promise<{ versions: SkillVersionItem[] }> {
    return (nexusClient as any).request(`/api/v1/skills/${id}/versions`);
  },

  async rollbackVersion(id: string, version: number): Promise<{ skill: SkillRecord; message: string }> {
    return (nexusClient as any).request(`/api/v1/skills/${id}/versions/${version}/rollback`, {
      method: "POST",
    });
  },

  async getExecutions(id: string): Promise<{ executions: SkillExecutionItem[] }> {
    return (nexusClient as any).request(`/api/v1/skills/${id}/executions`);
  },

  async runTests(id: string, payload: { name?: string; inputs: Record<string, any>; runNow?: boolean }): Promise<{ test: SkillTestItem; execution?: SkillExecutionItem; error?: string }> {
    return (nexusClient as any).request(`/api/v1/skills/${id}/tests`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async getToolCatalog(): Promise<{ tools: ToolCatalogItem[]; count: number }> {
    return (nexusClient as any).request("/api/v1/skills/tools/catalog");
  },
};
