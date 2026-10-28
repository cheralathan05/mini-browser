import { getApiBase } from "./nexus-config";

const API_BASE = getApiBase();

export interface CodingProjectSummary {
  id: string;
  userId: string;
  workspaceId?: string;
  name: string;
  description?: string;
  language: string;
  problemTitle?: string;
  currentCode: string;
  timeComplexity?: string;
  spaceComplexity?: string;
  createdAt: string;
  updatedAt: string;
  _count?: {
    versions: number;
    files: number;
    executions: number;
  };
}

export interface CodeVersionItem {
  id: string;
  projectId: string;
  versionNumber: number;
  content: string;
  description?: string;
  createdAt: string;
}

export interface CodeExecutionItem {
  id: string;
  userId: string;
  projectId?: string;
  language: string;
  code: string;
  status: "completed" | "timeout" | "error" | "unsupported_language";
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  testResults?: Array<{
    input: string;
    expectedOutput?: string;
    actualOutput: string;
    passed: boolean;
    durationMs: number;
    error?: string;
  }>;
  createdAt: string;
}

export interface CodingProjectDetail extends CodingProjectSummary {
  problemStatement?: string;
  problemUrl?: string;
  explanation?: string;
  testCases?: Array<{ input: string; expectedOutput?: string }>;
  files: any[];
  versions: CodeVersionItem[];
  executions: CodeExecutionItem[];
}

class CodingApiClient {
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const token = typeof window !== "undefined" ? localStorage.getItem("nexus_token") : null;
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
  }

  public async getProjects(workspaceId?: string): Promise<CodingProjectSummary[]> {
    const q = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
    const res = await fetch(`${API_BASE}/api/coding/projects${q}`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to load coding projects");
    const data = await res.json();
    return data.projects || [];
  }

  public async getProject(id: string): Promise<CodingProjectDetail> {
    const res = await fetch(`${API_BASE}/api/coding/projects/${id}`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to load coding project");
    const data = await res.json();
    return data.project;
  }

  public async createProject(opts: {
    name: string;
    description?: string;
    language?: string;
    problemTitle?: string;
    problemStatement?: string;
    problemUrl?: string;
    code?: string;
    testCases?: Array<{ input: string; expectedOutput?: string }>;
    workspaceId?: string;
  }): Promise<CodingProjectDetail> {
    const res = await fetch(`${API_BASE}/api/coding/projects`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(opts),
    });
    if (!res.ok) throw new Error("Failed to create coding project");
    const data = await res.json();
    return data.project;
  }

  public async updateProject(id: string, opts: Partial<CodingProjectDetail>): Promise<CodingProjectDetail> {
    const res = await fetch(`${API_BASE}/api/coding/projects/${id}`, {
      method: "PATCH",
      headers: this.getHeaders(),
      body: JSON.stringify(opts),
    });
    if (!res.ok) throw new Error("Failed to update coding project");
    const data = await res.json();
    return data.project;
  }

  public async deleteProject(id: string): Promise<boolean> {
    const res = await fetch(`${API_BASE}/api/coding/projects/${id}`, {
      method: "DELETE",
      headers: this.getHeaders(),
    });
    return res.ok;
  }

  public async saveVersion(projectId: string, code: string, description?: string): Promise<CodeVersionItem> {
    const res = await fetch(`${API_BASE}/api/coding/projects/${projectId}/versions`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ code, description }),
    });
    if (!res.ok) throw new Error("Failed to save version snapshot");
    const data = await res.json();
    return data.version;
  }

  public async executeCode(opts: {
    language: string;
    code: string;
    stdin?: string;
    testCases?: Array<{ input: string; expectedOutput?: string }>;
    projectId?: string;
    timeoutMs?: number;
  }): Promise<CodeExecutionItem> {
    const res = await fetch(`${API_BASE}/api/coding/execute`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(opts),
    });
    if (!res.ok) throw new Error("Failed to execute code in sandbox");
    const data = await res.json();
    return data.execution;
  }

  public async getExecutions(projectId?: string): Promise<CodeExecutionItem[]> {
    const q = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    const res = await fetch(`${API_BASE}/api/coding/executions${q}`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to load executions");
    const data = await res.json();
    return data.executions || [];
  }

  public async importProblemUrl(url: string): Promise<{ title: string; url: string; problemStatement: string }> {
    const res = await fetch(`${API_BASE}/api/coding/import-url`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Failed to import problem from URL");
    }
    return res.json();
  }

  public async generateSolution(opts: {
    language: string;
    problemTitle: string;
    problemStatement?: string;
    currentCode?: string;
    strategy?: string;
    customInstructions?: string;
    includeComments?: boolean;
    includeTests?: boolean;
    workspaceId?: string;
    projectId?: string;
  }): Promise<{
    success: boolean;
    solution: string;
    code: string;
    timeComplexity: string;
    spaceComplexity: string;
    language: string;
    strategy: string;
  }> {
    const res = await fetch(`${API_BASE}/api/coding/generate`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(opts),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Failed to generate solution");
    }
    return res.json();
  }
}

export const codingApi = new CodingApiClient();
