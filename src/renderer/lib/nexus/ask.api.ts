import { getApiBase } from "./nexus-config";

const API_BASE = getApiBase();

export interface AIConversationSummary {
  id: string;
  title: string;
  spaceId?: string;
  contextType?: string;
  createdAt: string;
  updatedAt: string;
  _count?: { messages: number };
  snapshots?: Array<{
    id: string;
    url?: string;
    title?: string;
    selectedText?: string;
    sourceType: string;
  }>;
}

export interface AIMessageItem {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  model?: string;
  status: "streaming" | "completed" | "failed" | "cancelled";
  metadata?: {
    requestId?: string;
    suggestedAction?: {
      type: "launch_agent" | "create_workflow" | "save_memory" | "create_task" | "start_research" | "research" | "implement_code";
      title: string;
      description: string;
      payload?: Record<string, unknown>;
    };
    [key: string]: unknown;
  };
  createdAt: string;
}

export interface AIConversationDetail {
  id: string;
  workspaceId: string;
  userId: string;
  title: string;
  spaceId?: string;
  contextType?: string;
  createdAt: string;
  updatedAt: string;
  messages: AIMessageItem[];
  snapshots: Array<{
    id: string;
    url?: string;
    title?: string;
    selectedText?: string;
    sourceType: string;
  }>;
}

export interface StreamMessageCallbacks {
  onToken: (token: string) => void;
  onAction?: (action: any) => void;
  onComplete: (data: { messageId?: string; content: string; model?: string }) => void;
  onError: (error: string) => void;
}

class AskApiClient {
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

  public async getConversations(workspaceId?: string): Promise<AIConversationSummary[]> {
    const q = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
    const res = await fetch(`${API_BASE}/api/ai/conversations${q}`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to load conversations");
    const data = await res.json();
    return data.conversations || [];
  }

  public async getConversation(id: string): Promise<AIConversationDetail> {
    const res = await fetch(`${API_BASE}/api/ai/conversations/${id}`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to load conversation");
    const data = await res.json();
    return data.conversation;
  }

  public async createConversation(opts: {
    workspaceId?: string;
    spaceId?: string;
    title?: string;
    contextType?: string;
    context?: Record<string, unknown>;
  }): Promise<AIConversationDetail> {
    const res = await fetch(`${API_BASE}/api/ai/conversations`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(opts),
    });
    if (!res.ok) throw new Error("Failed to create conversation");
    const data = await res.json();
    return data.conversation;
  }

  public async renameConversation(id: string, title: string): Promise<AIConversationDetail> {
    const res = await fetch(`${API_BASE}/api/ai/conversations/${id}`, {
      method: "PATCH",
      headers: this.getHeaders(),
      body: JSON.stringify({ title }),
    });
    if (!res.ok) throw new Error("Failed to rename conversation");
    const data = await res.json();
    return data.conversation;
  }

  public async deleteConversation(id: string): Promise<boolean> {
    const res = await fetch(`${API_BASE}/api/ai/conversations/${id}`, {
      method: "DELETE",
      headers: this.getHeaders(),
    });
    return res.ok;
  }

  public async cancelGeneration(conversationId: string): Promise<boolean> {
    const res = await fetch(`${API_BASE}/api/ai/conversations/${conversationId}/cancel`, {
      method: "POST",
      headers: this.getHeaders(),
    });
    return res.ok;
  }

  public async retryMessage(conversationId: string): Promise<{ readyToRetry: boolean; prompt: string }> {
    const res = await fetch(`${API_BASE}/api/ai/conversations/${conversationId}/retry`, {
      method: "POST",
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to retry message");
    return res.json();
  }

  public async saveToMemory(opts: {
    content: string;
    key?: string;
    type?: string;
    workspaceId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<any> {
    const res = await fetch(`${API_BASE}/api/memory`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        key: opts.key || `Insight_${Date.now()}`,
        content: opts.content,
        type: opts.type || "fact",
        workspaceId: opts.workspaceId,
        importance: 0.8,
        metadata: opts.metadata,
      }),
    });
    if (!res.ok) throw new Error("Failed to save memory");
    return res.json();
  }

  /**
   * Stream message with real Server-Sent Events (SSE) parsing
   */
  public async streamMessage(
    conversationId: string,
    message: string,
    context?: Record<string, unknown>,
    callbacks?: StreamMessageCallbacks,
    signal?: AbortSignal
  ): Promise<void> {
    const response = await fetch(`${API_BASE}/api/ai/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        message,
        context,
        requestId: `req_${Date.now()}`,
      }),
      signal,
    });

    if (!response.ok || !response.body) {
      let errorMsg = "Failed to stream AI response";
      try {
        const errJson = await response.json();
        if (errJson.message) errorMsg = errJson.message;
      } catch {}
      callbacks?.onError(errorMsg);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = "";
    let buffer = "";

    let currentEvent = "message:token";
    let completed = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep partial trailing line in buffer
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

              if (currentEvent === "message:token" && (parsed.text || parsed.token)) {
                const token = parsed.text || parsed.token;
                accumulated += token;
                callbacks?.onToken(token);
              } else if (currentEvent === "message:action" && parsed.action) {
                callbacks?.onAction?.(parsed.action);
              } else if (currentEvent === "message:complete") {
                completed = true;
                callbacks?.onComplete({
                  messageId: parsed.messageId,
                  content: accumulated || parsed.content || "",
                  model: parsed.model,
                });
              } else if (currentEvent === "message:error") {
                completed = true;
                callbacks?.onError(parsed.error || "Generation error");
              }
            } catch {
              // Ignore non-JSON payload fragments
            }
          }
        }
      }

      // Check remaining buffer if stream ended without newline
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith("data:")) {
          try {
            const rawData = trimmed.replace(/^data:\s*/, "");
            const parsed = JSON.parse(rawData);
            if (currentEvent === "message:token" && (parsed.text || parsed.token)) {
              const token = parsed.text || parsed.token;
              accumulated += token;
              callbacks?.onToken(token);
            } else if (currentEvent === "message:complete") {
              completed = true;
              callbacks?.onComplete({
                messageId: parsed.messageId,
                content: accumulated || parsed.content || "",
                model: parsed.model,
              });
            }
          } catch {}
        }
      }

      if (!completed && !signal?.aborted) {
        callbacks?.onComplete({
          content: accumulated,
        });
      }
    } catch (err: any) {
      if (signal?.aborted) {
        callbacks?.onComplete({
          content: accumulated,
        });
      } else {
        callbacks?.onError(err.message || "Streaming connection interrupted");
      }
    }
  }
}

export const askApi = new AskApiClient();
