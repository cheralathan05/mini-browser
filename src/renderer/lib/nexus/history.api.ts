// NEXUS Intelligence - Browser History API Client

import { nexusClient } from "./nexus-client";

export interface BrowserHistoryRecord {
  id: string;
  url: string;
  title: string;
  faviconUrl?: string | null;
  visitCount: number;
  isAgentVisit: boolean;
  lastVisitedAt: string;
  createdAt: string;
}

export const historyApi = {
  async list(search?: string, period?: string): Promise<{ history: BrowserHistoryRecord[] }> {
    const params = new URLSearchParams();
    if (search) params.append("search", search);
    if (period) params.append("period", period);
    const qs = params.toString();
    return nexusClient.request<{ history: BrowserHistoryRecord[] }>(`/api/history${qs ? `?${qs}` : ""}`);
  },

  async record(data: {
    url: string;
    title: string;
    faviconUrl?: string;
    isAgentVisit?: boolean;
    workspaceId?: string;
  }): Promise<{ historyItem?: BrowserHistoryRecord; ignored?: boolean }> {
    return nexusClient.request<{ historyItem?: BrowserHistoryRecord; ignored?: boolean }>("/api/history", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async delete(id: string): Promise<{ success: boolean; id: string }> {
    return nexusClient.request<{ success: boolean; id: string }>(`/api/history/${id}`, {
      method: "DELETE",
    });
  },

  async clear(): Promise<{ success: boolean; count: number }> {
    return nexusClient.request<{ success: boolean; count: number }>("/api/history", {
      method: "DELETE",
    });
  },
};
