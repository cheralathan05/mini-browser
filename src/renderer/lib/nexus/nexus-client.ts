// NEXUS BROWSER - Production Full-Stack API Client

const API_BASE =
  import.meta.env.VITE_NEXUS_API_URL ||
  (typeof window !== "undefined" &&
  window.location.origin &&
  !window.location.protocol.startsWith("file") &&
  !window.location.hostname.includes("localhost") &&
  !window.location.hostname.includes("127.0.0.1")
    ? window.location.origin
    : "http://127.0.0.1:8001");

class NexusApiClient {
  private token: string | null = null;

  constructor() {
    if (typeof window !== "undefined") {
      this.token = localStorage.getItem("nexus_token");
    }
  }

  public setToken(token: string | null) {
    this.token = token;
    if (typeof window !== "undefined") {
      if (token) {
        localStorage.setItem("nexus_token", token);
      } else {
        localStorage.removeItem("nexus_token");
      }
    }
  }

  public getToken(): string | null {
    return this.token;
  }

  public async ensureSession(): Promise<{ user: { id: string; email: string; name: string; avatar?: string }; token: string }> {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.token) {
        headers["Authorization"] = `Bearer ${this.token}`;
      }

      const res = await fetch(`${API_BASE}/api/auth/session`, {
        method: "POST",
        headers,
      });

      if (res.ok) {
        const data = await res.json();
        if (data.token) {
          this.setToken(data.token);
        }
        if (data.user && typeof window !== "undefined") {
          localStorage.setItem("nexus_user", JSON.stringify(data.user));
        }
        return data;
      }
    } catch (err) {
      console.warn("[NexusClient] ensureSession notice:", err);
    }
    return { user: { id: "", email: "", name: "" }, token: "" };
  }

  public async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    let response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    // Auto-retry once with ensureSession if 401 occurs
    if (response.status === 401 && !endpoint.startsWith("/api/auth/login") && !endpoint.startsWith("/api/auth/register")) {
      try {
        const session = await this.ensureSession();
        if (session.token) {
          headers["Authorization"] = `Bearer ${session.token}`;
          response = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers,
          });
        }
      } catch {
        // Fall through to standard error handling
      }
    }

    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch {
        errorData = { message: response.statusText };
      }
      throw new Error(errorData.message || errorData.error || `Request failed with status ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  public async getReadiness() {
    return this.request<{ status: string; database: string; ollama: string }>("/ready");
  }

  // Auth
  public async register(email: string, password: string, name: string) {
    const res = await this.request<{ user: { id: string; email: string; name: string }; token: string }>(
      "/api/auth/register",
      { method: "POST", body: JSON.stringify({ email, password, name }) }
    );
    this.setToken(res.token);
    return res;
  }

  public async login(email: string, password: string) {
    const res = await this.request<{ user: { id: string; email: string; name: string }; token: string }>(
      "/api/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) }
    );
    this.setToken(res.token);
    return res;
  }

  public async logout() {
    try {
      await this.request("/api/auth/logout", { method: "POST" });
    } finally {
      this.setToken(null);
    }
  }

  public async getMe() {
    const res = await this.request<{ user: { id: string; email: string; name: string; avatar?: string }; token?: string }>("/api/auth/me");
    if (res.token) {
      this.setToken(res.token);
    }
    return res;
  }

  public async updateProfile(data: { name?: string; avatar?: string }) {
    const res = await this.request<{ user: any; message: string }>("/api/users/me", {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    if (res.user && typeof window !== "undefined") {
      localStorage.setItem("nexus_user", JSON.stringify(res.user));
    }
    return res;
  }

  public async changePassword(currentPassword: string, newPassword: string) {
    return this.request<{ success: boolean; message: string }>("/api/users/me/password", {
      method: "PUT",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }

  public async getUserPreferences() {
    return this.request<{ preferences: Record<string, unknown> }>("/api/users/me/preferences");
  }

  public async updateUserPreferences(preferences: Record<string, unknown>) {
    return this.request<{ success: boolean; message: string }>("/api/users/me/preferences", {
      method: "PUT",
      body: JSON.stringify(preferences),
    });
  }

  public async getUsersList() {
    return this.request<{ users: Array<{ id: string; email: string; name: string; avatar?: string; createdAt: string }> }>("/api/users");
  }


  // Workspaces
  public async getWorkspaces() {
    return this.request<{ workspaces: any[] }>("/api/workspaces");
  }

  public async createWorkspace(name: string, description?: string) {
    return this.request<{ workspace: any }>("/api/workspaces", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    });
  }

  public async getWorkspace(id: string) {
    return this.request<{ workspace: any }>(`/api/workspaces/${id}`);
  }

  public async updateWorkspace(id: string, updates: { name?: string; description?: string }) {
    return this.request<{ workspace: any }>(`/api/workspaces/${id}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  }

  public async deleteWorkspace(id: string) {
    return this.request<{ success: boolean }>(`/api/workspaces/${id}`, { method: "DELETE" });
  }

  // Autonomous Agent Engine
  public async getTasks(workspaceId?: string, status?: string) {
    const params = new URLSearchParams();
    if (workspaceId) params.append("workspaceId", workspaceId);
    if (status) params.append("status", status);
    const query = params.toString() ? `?${params.toString()}` : "";
    return this.request<{ tasks: any[] }>(`/api/agents/tasks${query}`);
  }

  public async getAgentTasks(workspaceId?: string, status?: string) {
    return this.getTasks(workspaceId, status);
  }

  public async createTask(workspaceId: string, title: string, goal: string, priority = "medium", mode = "balanced") {
    return this.request<{ task: any; run: any }>("/api/agents/tasks", {
      method: "POST",
      body: JSON.stringify({ workspaceId, title, goal, priority, mode }),
    });
  }

  public async getTask(id: string) {
    return this.request<{ task: any }>(`/api/agents/tasks/${id}`);
  }

  public async startTask(id: string) {
    return this.request<{ success: boolean; status: string }>(`/api/agents/tasks/${id}/start`, { method: "POST" });
  }

  public async pauseTask(id: string) {
    return this.request<{ success: boolean; status: string }>(`/api/agents/tasks/${id}/pause`, { method: "POST" });
  }

  public async resumeTask(id: string) {
    return this.request<{ success: boolean; status: string }>(`/api/agents/tasks/${id}/resume`, { method: "POST" });
  }

  public async cancelTask(id: string) {
    return this.request<{ success: boolean; status: string }>(`/api/agents/tasks/${id}/cancel`, { method: "POST" });
  }

  public async retryTask(id: string) {
    return this.request<{ success: boolean; run: any }>(`/api/agents/tasks/${id}/retry`, { method: "POST" });
  }

  public async getRun(id: string) {
    return this.request<{ run: any }>(`/api/agents/runs/${id}`);
  }

  public async getRunPlan(id: string) {
    return this.request<{ plan: any }>(`/api/agents/runs/${id}/plan`);
  }

  public async getRunArtifacts(id: string) {
    return this.request<{ artifacts: any[] }>(`/api/agents/runs/${id}/artifacts`);
  }

  // Memory — Full Production API
  public async getMemories(params?: {
    workspaceId?: string;
    query?: string;
    type?: string;
    status?: string;
    limit?: number;
    cursor?: string;
  }) {
    const searchParams = new URLSearchParams();
    if (params?.workspaceId) searchParams.set("workspaceId", params.workspaceId);
    if (params?.query) searchParams.set("q", params.query);
    if (params?.type) searchParams.set("type", params.type);
    if (params?.status) searchParams.set("status", params.status);
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.cursor) searchParams.set("cursor", params.cursor);
    return this.request<{ memories: any[]; total: number; nextCursor?: string }>(
      `/api/memory?${searchParams.toString()}`
    );
  }

  public async getMemoryStats(workspaceId?: string) {
    const url = workspaceId ? `/api/memory/stats?workspaceId=${workspaceId}` : "/api/memory/stats";
    return this.request<{ stats: any }>(url);
  }

  public async getMemoryGraph(workspaceId?: string) {
    const url = workspaceId ? `/api/memory/graph?workspaceId=${workspaceId}` : "/api/memory/graph";
    return this.request<{ graph: { nodes: any[]; edges: any[] } }>(url);
  }

  public async getMemoryTimeline(workspaceId?: string, limit = 50) {
    const url = workspaceId
      ? `/api/memory/timeline?workspaceId=${workspaceId}&limit=${limit}`
      : `/api/memory/timeline?limit=${limit}`;
    return this.request<{ timeline: any[] }>(url);
  }

  public async getMemorySuggestions(workspaceId?: string) {
    const url = workspaceId ? `/api/memory/suggestions?workspaceId=${workspaceId}` : "/api/memory/suggestions";
    return this.request<{ suggestions: any[] }>(url);
  }

  public async getMemoryCollections(workspaceId?: string) {
    const url = workspaceId ? `/api/memory/collections?workspaceId=${workspaceId}` : "/api/memory/collections";
    return this.request<{ collections: any[] }>(url);
  }

  public async createCollection(data: { name: string; description?: string; color?: string; icon?: string; workspaceId?: string }) {
    return this.request<{ collection: any }>("/api/memory/collections", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  public async deleteCollection(id: string) {
    return this.request<{ success: boolean }>(`/api/memory/collections/${id}`, { method: "DELETE" });
  }

  public async searchMemories(query: string, filters: {
    workspaceId?: string;
    type?: string;
    status?: string;
    minImportance?: number;
    isVerified?: boolean;
    limit?: number;
  } = {}) {
    return this.request<{ results: any[]; total: number; count: number }>("/api/memory/search", {
      method: "POST",
      body: JSON.stringify({ query, ...filters }),
    });
  }

  public async getMemory(id: string) {
    return this.request<{ memory: any }>(`/api/memory/${id}`);
  }

  public async getRelatedMemories(id: string) {
    return this.request<{ related: any[] }>(`/api/memory/${id}/related`);
  }

  public async getMemorySources(id: string) {
    return this.request<{ sources: any[] }>(`/api/memory/${id}/sources`);
  }

  public async createMemory(data: {
    workspaceId?: string;
    type?: string;
    category?: string;
    title?: string;
    key?: string;
    content: string;
    summary?: string;
    importance?: number;
    sourceUrl?: string;
    sourceTitle?: string;
    sourceDomain?: string;
    sourceType?: string;
    tags?: string[];
  }) {
    return this.request<{ memory: any }>("/api/memory", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  public async updateMemory(id: string, data: {
    title?: string;
    content?: string;
    summary?: string;
    type?: string;
    category?: string;
    importanceScore?: number;
    confidenceScore?: number;
  }) {
    return this.request<{ memory: any }>(`/api/memory/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  public async deleteMemory(id: string) {
    return this.request<{ success: boolean }>(`/api/memory/${id}`, { method: "DELETE" });
  }

  public async askMemory(id: string, question: string, workspaceId?: string) {
    return this.request<{ answer: string; memory: any; contextUsed: any[] }>(`/api/memory/${id}/ask`, {
      method: "POST",
      body: JSON.stringify({ question, workspaceId }),
    });
  }

  public async verifyMemory(id: string) {
    return this.request<{ memory: any }>(`/api/memory/${id}/verify`, { method: "POST" });
  }

  public async pinMemory(id: string) {
    return this.request<{ memory: any }>(`/api/memory/${id}/pin`, { method: "POST" });
  }

  public async archiveMemory(id: string) {
    return this.request<{ memory: any }>(`/api/memory/${id}/archive`, { method: "POST" });
  }

  public async restoreMemory(id: string) {
    return this.request<{ memory: any }>(`/api/memory/${id}/restore`, { method: "POST" });
  }

  public async addMemoryNote(id: string, content: string) {
    return this.request<{ note: any }>(`/api/memory/${id}/note`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
  }

  public async connectMemories(id: string, targetId: string, relationType = "RELATED_TO", workspaceId?: string) {
    return this.request<{ relation: any }>(`/api/memory/${id}/connect`, {
      method: "POST",
      body: JSON.stringify({ targetId, relationType, workspaceId }),
    });
  }

  public async addToCollection(collectionId: string, memoryId: string) {
    return this.request<{ item: any }>(`/api/memory/${memoryId}/add-to-collection`, {
      method: "POST",
      body: JSON.stringify({ collectionId }),
    });
  }

  public async dismissSuggestion(id: string) {
    return this.request<{ success: boolean }>(`/api/memory/suggestions/${id}/dismiss`, { method: "POST" });
  }

  // Research
  public async getResearchProjects(workspaceId?: string) {
    const url = workspaceId ? `/api/research?workspaceId=${workspaceId}` : "/api/research";
    return this.request<{ projects: any[] }>(url);
  }

  public async createResearchProject(workspaceId: string, name: string, question: string) {
    return this.request<{ project: any }>("/api/research", {
      method: "POST",
      body: JSON.stringify({ workspaceId, name, question }),
    });
  }

  public async getResearchProject(id: string) {
    return this.request<{ project: any }>(`/api/research/${id}`);
  }

  public async runResearch(id: string) {
    return this.request<{ project: any }>(`/api/research/${id}/run`, { method: "POST" });
  }

  // Workflows
  public async getWorkflows(workspaceId?: string) {
    const url = workspaceId ? `/api/workflows?workspaceId=${workspaceId}` : "/api/workflows";
    return this.request<{ workflows: any[] }>(url);
  }

  public async getWorkflow(id: string) {
    return this.request<{ workflow: any }>(`/api/workflows/${id}`);
  }

  public async createWorkflow(workspaceId: string, name: string, definition: any, description?: string) {
    return this.request<{ workflow: any }>("/api/workflows", {
      method: "POST",
      body: JSON.stringify({ workspaceId, name, definition, description }),
    });
  }

  public async runWorkflow(id: string, input: any = {}) {
    return this.request<{ execution: any }>(`/api/workflows/${id}/run`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  public async deleteWorkflow(id: string) {
    return this.request<{ success: boolean }>(`/api/workflows/${id}`, { method: "DELETE" });
  }

  public async updateWorkflow(id: string, data: { name?: string; description?: string; definition?: any; status?: string }) {
    return this.request<{ workflow: any }>(`/api/workflows/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  public async duplicateWorkflow(id: string) {
    return this.request<{ workflow: any }>(`/api/workflows/${id}/duplicate`, { method: "POST" });
  }

  public async addWorkflowStep(id: string, step: any) {
    return this.request<{ workflow: any; step: any }>(`/api/workflows/${id}/steps`, {
      method: "POST",
      body: JSON.stringify(step),
    });
  }

  public async updateWorkflowStep(id: string, stepId: string, step: any) {
    return this.request<{ workflow: any; step: any }>(`/api/workflows/${id}/steps/${stepId}`, {
      method: "PATCH",
      body: JSON.stringify(step),
    });
  }

  public async deleteWorkflowStep(id: string, stepId: string) {
    return this.request<{ workflow: any; remainingSteps: number }>(`/api/workflows/${id}/steps/${stepId}`, {
      method: "DELETE",
    });
  }

  // Skills
  public async getSkills(workspaceId?: string) {
    const url = workspaceId ? `/api/skills?workspaceId=${workspaceId}` : "/api/skills";
    return this.request<{ skills: any[] }>(url);
  }

  public async createSkill(data: { workspaceId?: string; name: string; description: string; instructions: string; tools?: string[] }) {
    return this.request<{ skill: any }>("/api/skills", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  public async runSkill(id: string) {
    return this.request<{ task: any }>(`/api/skills/${id}/run`, { method: "POST" });
  }

  public async deleteSkill(id: string) {
    return this.request<{ success: boolean }>(`/api/skills/${id}`, { method: "DELETE" });
  }

  public async updateSkill(id: string, data: { name?: string; description?: string; instructions?: string; tools?: string[] }) {
    return this.request<{ skill: any }>(`/api/skills/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  // Approvals
  public async getApprovals(status = "pending") {
    return this.request<{ approvals: any[] }>(`/api/approvals?status=${status}`);
  }

  public async getPendingApprovals() {
    return this.getApprovals("pending");
  }

  public async approve(id: string) {
    return this.request<{ approval: any }>(`/api/approvals/${id}/approve`, { method: "POST" });
  }

  public async reject(id: string) {
    return this.request<{ approval: any }>(`/api/approvals/${id}/reject`, { method: "POST" });
  }

  // Activity
  public async getActivity(limit = 30) {
    return this.request<{ activities: any[] }>(`/api/activity?limit=${limit}`);
  }

  // Bookmarks (PostgreSQL Backed)
  public async getBookmarks() {
    return this.request<{ bookmarks: any[] }>("/api/browser/bookmarks");
  }

  public async saveBookmarks(bookmarks: any[]) {
    return this.request<{ success: boolean; count: number }>("/api/browser/bookmarks", {
      method: "POST",
      body: JSON.stringify({ bookmarks }),
    });
  }

  // History (PostgreSQL Backed)
  public async getHistory() {
    return this.request<{ history: any[] }>("/api/browser/history");
  }

  public async saveHistory(history: any[]) {
    return this.request<{ success: boolean; count: number }>("/api/browser/history", {
      method: "POST",
      body: JSON.stringify({ history }),
    });
  }

  public async clearHistory() {
    return this.request<{ success: boolean }>("/api/browser/history", {
      method: "DELETE",
    });
  }



  // Settings
  public async getSettings() {
    return this.request<{ settings: any }>("/api/settings");
  }

  public async updateSettings(settings: any) {
    return this.request<{ success: boolean }>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(settings),
    });
  }

  // Intent Engine
  public async determineIntent(query: string, options?: { spaceId?: string; currentUrl?: string; execute?: boolean }) {
    return this.request<{
      intent: string;
      action: string;
      confidence: number;
      target?: string;
      summary: string;
      data?: any;
    }>("/api/nexus/intent", {
      method: "POST",
      body: JSON.stringify({ query, ...options }),
    });
  }

  // Browser Page Context Analysis
  public async analyzePage(data: {
    url?: string;
    title?: string;
    content?: string;
    selectedText?: string;
    imageData?: string;
    action: string;
    prompt?: string;
    workspaceId?: string;
  }) {
    return this.request<{
      action: string;
      url?: string;
      title?: string;
      result?: string;
      memory?: any;
      task?: any;
      workflow?: any;
      message?: string;
    }>("/api/browser/analyze", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Multimodal Visual Snapshot Analysis
  public async analyzeImage(data: {
    imageData: string;
    url?: string;
    title?: string;
    prompt?: string;
  }) {
    return this.analyzePage({
      action: "analyze_image",
      imageData: data.imageData,
      url: data.url,
      title: data.title,
      prompt: data.prompt,
    });
  }

  // Real Local Downloads Explorer
  public async getDownloads() {
    return this.request<{
      downloads: Array<{
        id: string;
        filename: string;
        path: string;
        url: string;
        size: number;
        downloadedBytes: number;
        status: "completed" | "in_progress" | "paused" | "failed" | "cancelled";
        startedAt: string;
        completedAt: string;
        type: "file" | "image" | "archive" | "pdf" | "code";
      }>;
      downloadsDirectory: string;
    }>("/api/browser/downloads");
  }

  public async openLocalFile(filePath: string) {
    return this.request<{ success: boolean; opened: string }>("/api/browser/open-file", {
      method: "POST",
      body: JSON.stringify({ filePath }),
    });
  }

  // Autonomous Coding Agent Solver
  public async solveCodingProblem(opts: {
    language: string;
    problemTitle?: string;
    problemDescription?: string;
    starterCode?: string;
    platform?: string;
    instruction?: string;
    mode?: "ai" | "canonical" | "auto";
    workspaceId?: string;
  }) {
    return this.request<{
      success: boolean;
      solution: string;
      code: string;
      timeComplexity: string;
      spaceComplexity: string;
      language: string;
      explanation: string;
      testCases?: Array<{ input: string; output: string }>;
    }>("/api/browser/solve-code", {
      method: "POST",
      body: JSON.stringify(opts),
    });
  }

  public async getCodingHistory() {
    return this.request<{
      history: Array<{
        id: string;
        problemTitle: string;
        language: string;
        platform: string;
        instruction?: string;
        code: string;
        solution: string;
        timeComplexity: string;
        spaceComplexity: string;
        explanation: string;
        testCases?: Array<{ input: string; output: string }>;
        createdAt: string;
      }>;
      count: number;
      database: string;
    }>("/api/browser/solve-code/history");
  }

  public async deleteCodingHistory(id: string = "all") {
    return this.request<{ success: boolean; count: number }>(`/api/browser/solve-code/history/${id}`, {
      method: "DELETE",
    });
  }

  public async solveCodingProblemStream(
    opts: {
      language: string;
      problemTitle?: string;
      problemDescription?: string;
      starterCode?: string;
      platform?: string;
      instruction?: string;
      mode?: "ai" | "canonical" | "auto";
      workspaceId?: string;
    },
    callbacks: {
      onStatus?: (status: string) => void;
      onThought?: (thought: string) => void;
      onToken?: (token: string) => void;
      onComplete?: (result: {
        success: boolean;
        solution: string;
        code: string;
        timeComplexity: string;
        spaceComplexity: string;
        language: string;
        explanation: string;
        testCases?: Array<{ input: string; output: string }>;
      }) => void;
      onError?: (error: string) => void;
    },
    signal?: AbortSignal
  ): Promise<void> {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.token) {
        headers["Authorization"] = `Bearer ${this.token}`;
      }

      const response = await fetch(`${API_BASE}/api/browser/solve-code/stream`, {
        method: "POST",
        headers,
        body: JSON.stringify(opts),
        signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Streaming failed with status ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "token";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed.startsWith("event:")) {
            currentEvent = trimmed.replace(/^event:\s*/, "");
            continue;
          }

          if (trimmed.startsWith("data:")) {
            const rawData = trimmed.replace(/^data:\s*/, "");
            try {
              const parsed = JSON.parse(rawData);
              if (currentEvent === "status" && parsed.status) {
                callbacks.onStatus?.(parsed.status);
              } else if (currentEvent === "thought" && parsed.thought) {
                callbacks.onThought?.(parsed.thought);
              } else if (currentEvent === "token" && parsed.token) {
                callbacks.onToken?.(parsed.token);
              } else if (currentEvent === "complete") {
                callbacks.onComplete?.(parsed);
              } else if (currentEvent === "error") {
                callbacks.onError?.(parsed.error || "Generation error");
              }
            } catch {}
          }
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") return;
      callbacks.onError?.(err.message || "Failed to solve problem");
    }
  }

  // Health checks
  public async getHealth() {
    return this.request<{
      status: string;
      timestamp: string;
      services: { database: string; ollama: string; backend: string };
    }>("/api/health");
  }

  public async getDatabaseHealth() {
    return this.request<{
      status: string;
      latencyMs: number;
      port: number;
      metrics: { users: number; workspaces: number; tabs: number; memories: number; tasks: number };
    }>("/api/health/database");
  }

  public async getOllamaHealth() {
    return this.request<{
      status: string;
      url: string;
      activeModel: string;
      models: Array<{ name: string; size: number }>;
    }>("/api/health/ollama");
  }
}

export const nexusClient = new NexusApiClient();
