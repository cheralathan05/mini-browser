import { getApiBase } from "./nexus-config";

const API_BASE = getApiBase();

export interface WebCaptureTelemetry {
  protocol: string;
  statusCode: number;
  width: number;
  height: number;
  format: string;
  fileSize: number;
  durationMs: number;
  title: string;
  headings: string[];
  excerpt: string;
  linkCount: number;
  imageCount: number;
  canonicalUrl?: string;
  timestamp: string;
}

export interface CaptureAnalysisItem {
  id: string;
  captureId: string;
  userId: string;
  provider: string;
  model: string;
  content: string;
  status: string;
  createdAt: string;
}

export interface WebCaptureItem {
  id: string;
  userId: string;
  workspaceId?: string;
  url: string;
  resolvedUrl?: string;
  title: string;
  screenshotPath: string;
  publicUrl: string;
  width: number;
  height: number;
  format: string;
  fileSize: number;
  durationMs: number;
  status: "completed" | "failed" | "processing";
  telemetry?: WebCaptureTelemetry;
  headings?: string[];
  excerpt?: string;
  createdAt: string;
  updatedAt: string;
  analyses?: CaptureAnalysisItem[];
  _count?: { analyses: number };
}

class CapturesApiClient {
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

  public async getCaptures(workspaceId?: string): Promise<WebCaptureItem[]> {
    const q = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
    const res = await fetch(`${API_BASE}/api/captures${q}`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to load captures");
    const data = await res.json();
    return data.captures || [];
  }

  public async getCapture(id: string): Promise<WebCaptureItem> {
    const res = await fetch(`${API_BASE}/api/captures/${id}`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to load capture");
    const data = await res.json();
    return data.capture;
  }

  public async createCapture(opts: {
    url: string;
    width?: number;
    height?: number;
    fullPage?: boolean;
    deviceScaleFactor?: number;
    workspaceId?: string;
  }): Promise<WebCaptureItem> {
    const res = await fetch(`${API_BASE}/api/captures`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(opts),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Failed to capture screenshot");
    }
    const data = await res.json();
    return data.capture;
  }

  public async deleteCapture(id: string): Promise<boolean> {
    const res = await fetch(`${API_BASE}/api/captures/${id}`, {
      method: "DELETE",
      headers: this.getHeaders(),
    });
    return res.ok;
  }

  public async analyzeCapture(id: string, prompt?: string): Promise<CaptureAnalysisItem> {
    const res = await fetch(`${API_BASE}/api/captures/${id}/analyze`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Failed to analyze capture");
    }
    const data = await res.json();
    return data.analysis;
  }
}

export const capturesApi = new CapturesApiClient();
