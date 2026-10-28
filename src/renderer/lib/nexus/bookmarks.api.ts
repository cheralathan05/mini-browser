// NEXUS Intelligence - Bookmarks API Client

import { nexusClient } from "./nexus-client";

export interface BookmarkRecord {
  id: string;
  url: string;
  title: string;
  faviconUrl?: string | null;
  folder?: string | null;
  tags: string[];
  notes?: string | null;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export const bookmarksApi = {
  async list(search?: string, folder?: string): Promise<{ bookmarks: BookmarkRecord[] }> {
    const params = new URLSearchParams();
    if (search) params.append("search", search);
    if (folder) params.append("folder", folder);
    const qs = params.toString();
    return nexusClient.request<{ bookmarks: BookmarkRecord[] }>(`/api/bookmarks${qs ? `?${qs}` : ""}`);
  },

  async create(data: {
    url: string;
    title: string;
    faviconUrl?: string;
    folder?: string;
    tags?: string[];
    notes?: string;
    isPinned?: boolean;
    workspaceId?: string;
  }): Promise<{ bookmark: BookmarkRecord }> {
    return nexusClient.request<{ bookmark: BookmarkRecord }>("/api/bookmarks", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async update(id: string, data: Partial<BookmarkRecord>): Promise<{ bookmark: BookmarkRecord }> {
    return nexusClient.request<{ bookmark: BookmarkRecord }>(`/api/bookmarks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  async delete(id: string): Promise<{ success: boolean; id: string }> {
    return nexusClient.request<{ success: boolean; id: string }>(`/api/bookmarks/${id}`, {
      method: "DELETE",
    });
  },
};
