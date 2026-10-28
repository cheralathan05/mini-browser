// NEXUS Intelligence - Downloads API Client

import { nexusClient } from "./nexus-client";

export interface DownloadRecordItem {
  id: string;
  filename: string;
  sourceUrl?: string | null;
  sourceDomain?: string | null;
  mimeType?: string | null;
  extension?: string | null;
  expectedSize: number;
  downloadedSize: number;
  status: "completed" | "in_progress" | "paused" | "failed" | "cancelled";
  error?: string | null;
  filePath?: string | null;
  createdAt: string;
  completedAt?: string | null;
  metadata?: any;
}

export interface DownloadsListResponse {
  downloads: DownloadRecordItem[];
  total: number;
  completedCount: number;
  activeCount: number;
  pausedCount: number;
  failedCount: number;
  totalBytes: number;
  downloadsDirectory: string;
}

export interface DownloadPreviewResponse {
  preview: {
    id: string;
    filename: string;
    category: "image" | "pdf" | "archive" | "code" | "file";
    canPreview: boolean;
    truncated?: boolean;
    content?: string;
    imageData?: string;
    fileSize?: number;
    message?: string;
    error?: string;
  };
}

export interface DownloadsAiResponse {
  answer: string;
  filesInspected: number;
  proposedMoves: Array<{ downloadId: string; filename: string; targetFolder: string }>;
  cleanupCandidates: Array<{ downloadId: string; filename: string; reason: string }>;
}

export const downloadsApi = {
  async list(options: {
    workspaceId?: string;
    search?: string;
    status?: string;
    type?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<DownloadsListResponse> {
    const params = new URLSearchParams();
    if (options.workspaceId) params.append("workspaceId", options.workspaceId);
    if (options.search) params.append("search", options.search);
    if (options.status && options.status !== "all") params.append("status", options.status);
    if (options.type && options.type !== "all") params.append("type", options.type);
    if (options.limit) params.append("limit", options.limit.toString());
    if (options.offset) params.append("offset", options.offset.toString());

    const qs = params.toString();
    return nexusClient.request<DownloadsListResponse>(`/api/downloads${qs ? `?${qs}` : ""}`);
  },

  async create(data: {
    filename: string;
    sourceUrl?: string;
    sourceDomain?: string;
    mimeType?: string;
    extension?: string;
    expectedSize?: number;
    downloadedSize?: number;
    status?: string;
    filePath?: string;
    workspaceId?: string;
    metadata?: any;
  }): Promise<{ download: DownloadRecordItem }> {
    return nexusClient.request<{ download: DownloadRecordItem }>("/api/downloads", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async get(id: string): Promise<{ download: DownloadRecordItem }> {
    return nexusClient.request<{ download: DownloadRecordItem }>(`/api/downloads/${id}`);
  },

  async getPreview(id: string): Promise<DownloadPreviewResponse> {
    return nexusClient.request<DownloadPreviewResponse>(`/api/downloads/${id}/preview`);
  },

  async retry(id: string): Promise<{ download: DownloadRecordItem }> {
    return nexusClient.request<{ download: DownloadRecordItem }>(`/api/downloads/${id}/retry`, {
      method: "POST",
    });
  },

  async cancel(id: string): Promise<{ download: DownloadRecordItem }> {
    return nexusClient.request<{ download: DownloadRecordItem }>(`/api/downloads/${id}/cancel`, {
      method: "POST",
    });
  },

  async delete(id: string, deleteFile: boolean = false): Promise<{ success: boolean; id: string }> {
    return nexusClient.request<{ success: boolean; id: string }>(
      `/api/downloads/${id}?deleteFile=${deleteFile ? "true" : "false"}`,
      { method: "DELETE" }
    );
  },

  async findDuplicates(): Promise<{ duplicates: Array<{ size: number; files: DownloadRecordItem[] }> }> {
    return nexusClient.request<{ duplicates: Array<{ size: number; files: DownloadRecordItem[] }> }>(
      "/api/downloads/duplicates"
    );
  },

  async askAi(data: {
    query: string;
    action?: "summarize" | "explain" | "group" | "find" | "cleanup" | "organize";
    downloadIds?: string[];
    workspaceId?: string;
  }): Promise<DownloadsAiResponse> {
    return nexusClient.request<DownloadsAiResponse>("/api/downloads/ai/ask", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async executeOrganize(moves: Array<{ downloadId: string; targetFolder: string }>): Promise<{
    success: boolean;
    totalExecuted: number;
    results: Array<{ downloadId: string; success: boolean; newPath?: string; error?: string }>;
  }> {
    return nexusClient.request<{
      success: boolean;
      totalExecuted: number;
      results: Array<{ downloadId: string; success: boolean; newPath?: string; error?: string }>;
    }>("/api/downloads/ai/organize/execute", {
      method: "POST",
      body: JSON.stringify({ moves }),
    });
  },
};
