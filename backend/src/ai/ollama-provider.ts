import { AIProvider, AIRequestOptions } from "./provider-interface.js";
import { env } from "../config/env.js";

/**
 * OllamaProvider — connects to a local Ollama instance.
 *
 * Uses /api/chat (not /api/generate) which supports the top-level `think` field
 * introduced in Ollama 0.7+. Setting `think: false` is critical for qwen3:8b
 * (and other thinking models) — without it the model generates a massive hidden
 * reasoning block before every answer, causing the request to hang until the
 * socket times out and the UI shows "network error".
 */
export class OllamaProvider implements AIProvider {
  public name = "Ollama";
  private baseUrl: string;
  private defaultModel: string;

  constructor(baseUrl?: string, defaultModel?: string) {
    this.baseUrl = (baseUrl || env.OLLAMA_URL).replace(/\/$/, "");
    this.defaultModel = defaultModel || env.OLLAMA_MODEL;
  }

  private lastAvailableTime: number = 0;
  private lastAvailableStatus: boolean = false;

  public async isAvailable(): Promise<boolean> {
    const now = Date.now();
    // Cache positive availability for 30 seconds to avoid blocking inference
    if (this.lastAvailableStatus && now - this.lastAvailableTime < 30000) {
      return true;
    }
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timeoutId);
      this.lastAvailableStatus = res.ok;
      this.lastAvailableTime = now;
      return res.ok;
    } catch {
      // If previously connected within 60s, assume it's still alive but busy
      if (this.lastAvailableStatus && now - this.lastAvailableTime < 60000) {
        return true;
      }
      this.lastAvailableStatus = false;
      return false;
    }
  }

  private resolvedModel: string | null = null;

  public async getModel(requested?: string): Promise<string> {
    if (this.resolvedModel && !requested) {
      return this.resolvedModel;
    }
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = (await res.json()) as { models?: Array<{ name: string }> };
        if (data.models && data.models.length > 0) {
          if (requested) {
            const reqMatch = data.models.find(
              (m) => m.name === requested || m.name.startsWith(requested + ":") || m.name.split(":")[0] === requested
            );
            if (reqMatch) return reqMatch.name;
          }

          const defaultMatch = data.models.find(
            (m) =>
              m.name === this.defaultModel ||
              m.name.startsWith(this.defaultModel + ":") ||
              m.name.split(":")[0] === this.defaultModel
          );
          if (defaultMatch) {
            this.resolvedModel = defaultMatch.name;
            return defaultMatch.name;
          }

          // Fallback: use first available model
          this.resolvedModel = data.models[0].name;
          return this.resolvedModel;
        }
      }
    } catch {
      // ignore — fallback to configured name
    }
    return requested || this.defaultModel;
  }

  /**
   * Builds the /api/chat request body. Uses top-level `think: false` to
   * disable qwen3's extended reasoning pass, making responses immediate.
   */
  private buildChatBody(
    prompt: string,
    options: AIRequestOptions | undefined,
    targetModel: string,
    streaming: boolean
  ) {
    const messages: Array<{ role: string; content: string }> = [];
    if (options?.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    return {
      model: targetModel,
      stream: streaming,
      think: false,        // Top-level flag — disables qwen3 thinking mode (Ollama ≥0.7)
      keep_alive: "30m",
      messages,
      options: {
        temperature: options?.temperature ?? 0.7,
        num_predict: options?.maxTokens ?? 1024,
        num_ctx: 2048,
        num_thread: 6,
      },
    };
  }

  public async generate(prompt: string, options?: AIRequestOptions): Promise<string> {
    const isOnline = await this.isAvailable();
    if (!isOnline) {
      return "Local AI unavailable. Start Ollama or configure another provider.";
    }

    const controller = new AbortController();
    const timeoutMs = options?.timeout ?? 90000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const targetModel = await this.getModel(options?.model);
      const body = this.buildChatBody(prompt, options, targetModel, false);

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(body),
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama API error (${response.status}): ${await response.text()}`);
      }

      const data = (await response.json()) as { message?: { content?: string; thinking?: string } };
      return data.message?.content || "";
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error?.name === "AbortError") {
        console.warn("[OllamaProvider] Generate timed out after", timeoutMs, "ms");
        return "Response generation timed out. The model may be busy — please retry.";
      }
      console.warn("[OllamaProvider] Generate error:", error);
      return "Local AI unavailable. Start Ollama or configure another provider.";
    }
  }

  public async stream(
    prompt: string,
    onChunk: (chunk: string) => void,
    options?: AIRequestOptions
  ): Promise<string> {
    const isOnline = await this.isAvailable();
    if (!isOnline) {
      const fallback = "Local AI unavailable. Start Ollama or configure another provider.";
      onChunk(fallback);
      return fallback;
    }

    // Hard timeout — prevents permanent hang on thinking models (qwen3, deepseek-r1, etc.)
    const controller = new AbortController();
    const timeoutMs = options?.timeout ?? 120000; // 2-minute cap
    const timeoutId = setTimeout(() => {
      controller.abort();
      console.warn("[OllamaProvider] Stream timed out after", timeoutMs, "ms");
    }, timeoutMs);

    try {
      const targetModel = await this.getModel(options?.model);
      const body = this.buildChatBody(prompt, options, targetModel, true);

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(body),
      });

      if (!response.ok || !response.body) {
        const errText = await response.text().catch(() => "");
        throw new Error(`Ollama streaming error (${response.status}): ${errText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            // /api/chat response: { message: { content: "...", thinking: "..." }, done: bool }
            const parsed = JSON.parse(trimmed) as {
              message?: { content?: string; thinking?: string };
              done?: boolean;
            };
            const thinkingToken = parsed.message?.thinking;
            if (thinkingToken && options?.onThought) {
              options.onThought(thinkingToken);
            }

            const token = parsed.message?.content;
            if (token) {
              fullText += token;
              onChunk(token);
            }
          } catch {
            // Ignore partial / malformed NDJSON lines during streaming
          }
        }
      }

      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim()) as {
            message?: { content?: string; thinking?: string };
            done?: boolean;
          };
          const token = parsed.message?.content;
          if (token) {
            fullText += token;
            onChunk(token);
          }
        } catch {}
      }

      clearTimeout(timeoutId);
      return fullText;
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error?.name === "AbortError") {
        console.warn("[OllamaProvider] Stream aborted (timeout or signal).");
        const timeoutMsg = "Response generation timed out. The model may be overloaded — please retry.";
        onChunk(timeoutMsg);
        return timeoutMsg;
      }
      console.warn("[OllamaProvider] Stream error:", error);
      const fallback = "Local AI unavailable. Start Ollama or configure another provider.";
      onChunk(fallback);
      return fallback;
    }
  }
}
