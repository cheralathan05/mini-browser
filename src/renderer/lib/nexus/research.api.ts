import { nexusClient } from "./nexus-client";

export type ResearchMode = "quick" | "standard" | "deep";

export interface ResearchObjective {
  id: string;
  title: string;
  description?: string;
  status: "pending" | "active" | "completed";
  order: number;
}

export interface ResearchSourceItem {
  id: string;
  researchProjectId: string;
  url: string;
  title: string;
  domain?: string | null;
  sourceType: string;
  status: string; // discovered, queued, fetching, extracting, analyzing, completed, failed
  content?: string | null;
  summary?: string | null;
  contentHash?: string | null;
  retrievedAt: string;
}

export interface EvidenceItem {
  id: string;
  researchProjectId: string;
  sourceId: string;
  source?: { id: string; title: string; url: string; domain?: string | null };
  claim: string;
  evidenceText: string;
  location?: string | null;
  createdAt: string;
}

export interface ResearchFindingItem {
  id: string;
  researchProjectId: string;
  title: string;
  summary: string;
  claim: string;
  confidence: number;
  status: "SUPPORTED" | "PARTIALLY_SUPPORTED" | "CONFLICTING" | "UNSUPPORTED";
  createdAt: string;
}

export interface ResearchReportItem {
  id: string;
  researchProjectId: string;
  title: string;
  summary: string;
  sections: Array<{ id: string; heading: string; content: string; citations: number[] }>;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchCitationItem {
  id: string;
  researchProjectId: string;
  sourceId: string;
  evidenceId?: string | null;
  findingId?: string | null;
  inlineIndex: number;
  claim?: string | null;
}

export interface ResearchRunItem {
  id: string;
  researchProjectId: string;
  status: string;
  progress: number;
  startedAt: string;
  completedAt?: string | null;
  error?: string | null;
}

export interface ResearchPlanItem {
  id: string;
  researchProjectId: string;
  objectives: ResearchObjective[];
  status: string;
}

export interface FullResearchProject {
  id: string;
  userId?: string | null;
  workspaceId: string;
  spaceId?: string | null;
  name: string;
  title?: string | null;
  question: string;
  mode: ResearchMode;
  status: "in_progress" | "completed" | "paused" | "failed" | "cancelled";
  finalReport?: string | null;
  createdAt: string;
  updatedAt: string;
  runs?: ResearchRunItem[];
  plans?: ResearchPlanItem[];
  sources?: ResearchSourceItem[];
  evidence?: EvidenceItem[];
  findings?: ResearchFindingItem[];
  reports?: ResearchReportItem[];
  citations?: ResearchCitationItem[];
  _count?: { sources: number; findings: number; evidence: number };
}

export class ResearchApiService {
  public static async getProjects(params?: {
    workspaceId?: string;
    status?: string;
    search?: string;
  }): Promise<FullResearchProject[]> {
    const q = new URLSearchParams();
    if (params?.workspaceId) q.set("workspaceId", params.workspaceId);
    if (params?.status) q.set("status", params.status);
    if (params?.search) q.set("q", params.search);

    const queryStr = q.toString() ? `?${q.toString()}` : "";
    const res = await nexusClient.request<{ projects: FullResearchProject[] }>(`/api/research${queryStr}`);
    return res.projects || [];
  }

  public static async createProject(data: {
    name: string;
    question: string;
    mode?: ResearchMode;
    workspaceId?: string;
    spaceId?: string;
    sourcePreferences?: string[];
    dateRange?: string;
    exclusions?: string;
    outputFormat?: string;
  }): Promise<FullResearchProject> {
    const res = await nexusClient.request<{ project: FullResearchProject }>("/api/research", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return res.project;
  }

  public static async updateProject(
    id: string,
    data: { name?: string; question?: string; title?: string }
  ): Promise<FullResearchProject> {
    const res = await nexusClient.request<{ success: boolean; project: FullResearchProject }>(
      `/api/research/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify(data),
      }
    );
    return res.project;
  }

  public static async getProject(id: string): Promise<FullResearchProject> {
    const res = await nexusClient.request<{ project: FullResearchProject }>(`/api/research/${id}`);
    return res.project;
  }

  public static async startResearch(id: string, mode?: ResearchMode): Promise<{ runId: string; status: string }> {
    const res = await nexusClient.request<{ success: boolean; runId: string; status: string }>(
      `/api/research/${id}/start`,
      {
        method: "POST",
        body: JSON.stringify({ mode: mode || "standard" }),
      }
    );
    return { runId: res.runId, status: res.status };
  }

  public static async pauseResearch(id: string): Promise<boolean> {
    const res = await nexusClient.request<{ success: boolean; paused: boolean }>(
      `/api/research/${id}/pause`,
      { method: "POST" }
    );
    return res.paused;
  }

  public static async resumeResearch(id: string): Promise<boolean> {
    const res = await nexusClient.request<{ success: boolean; resumed: boolean }>(
      `/api/research/${id}/resume`,
      { method: "POST" }
    );
    return res.resumed;
  }

  public static async cancelResearch(id: string): Promise<boolean> {
    const res = await nexusClient.request<{ success: boolean; cancelled: boolean }>(
      `/api/research/${id}/cancel`,
      { method: "POST" }
    );
    return res.cancelled;
  }

  public static async retryResearch(id: string): Promise<{ runId: string }> {
    const res = await nexusClient.request<{ success: boolean; runId: string }>(
      `/api/research/${id}/retry`,
      { method: "POST" }
    );
    return { runId: res.runId };
  }

  public static async updatePlan(id: string, objectives: ResearchObjective[]): Promise<ResearchPlanItem> {
    const res = await nexusClient.request<{ success: boolean; plan: ResearchPlanItem }>(
      `/api/research/${id}/plan`,
      {
        method: "PATCH",
        body: JSON.stringify({ objectives }),
      }
    );
    return res.plan;
  }

  public static async askResearch(id: string, question: string): Promise<{ answer: string; question: string }> {
    const res = await nexusClient.request<{ answer: string; question: string }>(
      `/api/research/${id}/ask`,
      {
        method: "POST",
        body: JSON.stringify({ question }),
      }
    );
    return { answer: res.answer, question: res.question };
  }

  public static async deleteProject(id: string): Promise<boolean> {
    const res = await nexusClient.request<{ success: boolean }>(`/api/research/${id}`, {
      method: "DELETE",
    });
    return res.success;
  }

  public static exportMarkdown(project: FullResearchProject): void {
    const reportText = project.finalReport || `# ${project.name}\n\n${project.question}`;
    const blob = new Blob([reportText], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const safeTitle = project.name.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 40);
    link.download = `nexus_research_${safeTitle}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  public static exportJson(project: FullResearchProject): void {
    const exportData = {
      investigationId: project.id,
      title: project.name,
      question: project.question,
      mode: project.mode,
      status: project.status,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      sourcesCount: project.sources?.length || 0,
      evidenceCount: project.evidence?.length || 0,
      findingsCount: project.findings?.length || 0,
      report: project.finalReport,
      sources: project.sources?.map((s) => ({
        title: s.title,
        url: s.url,
        domain: s.domain,
        sourceType: s.sourceType,
        summary: s.summary,
        retrievedAt: s.retrievedAt,
      })),
      findings: project.findings?.map((f) => ({
        title: f.title,
        summary: f.summary,
        claim: f.claim,
        confidence: f.confidence,
        status: f.status,
      })),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const safeTitle = project.name.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 40);
    link.download = `nexus_research_${safeTitle}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}
