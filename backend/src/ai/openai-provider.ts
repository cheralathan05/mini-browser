import OpenAI from "openai";
import { AIProvider, AIRequestOptions } from "./provider-interface.js";
import { env } from "../config/env.js";

export class OpenAICompatibleProvider implements AIProvider {
  public name = "OpenAI-Compatible";
  private client: OpenAI | null = null;
  private apiKey?: string;
  private baseUrl?: string;
  private model: string;

  constructor(apiKey?: string, baseUrl?: string, model?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model || env.OPENAI_MODEL;
  }

  private getClient(): OpenAI | null {
    const key = (this.apiKey || process.env.OPENAI_API_KEY || env.OPENAI_API_KEY || "").trim();
    const baseUrl = (this.baseUrl || process.env.OPENAI_BASE_URL || env.OPENAI_BASE_URL || "").trim();

    if (key.length > 0) {
      if (!this.client || (this.client as any).apiKey !== key) {
        this.client = new OpenAI({
          apiKey: key,
          baseURL: baseUrl || "https://api.openai.com/v1",
        });
      }
      return this.client;
    }
    return null;
  }

  public async isAvailable(): Promise<boolean> {
    return this.getClient() !== null;
  }

  public async generate(prompt: string, options?: AIRequestOptions): Promise<string> {
    const client = this.getClient();
    if (!client) {
      return "OpenAI-compatible provider not configured. Please supply an API key in settings or .env";
    }

    try {
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
      if (options?.systemPrompt) {
        messages.push({ role: "system", content: options.systemPrompt });
      }
      messages.push({ role: "user", content: prompt });

      const completion = await client.chat.completions.create({
        model: options?.model || this.model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 2048,
      });

      return completion.choices[0]?.message?.content || "";
    } catch (error) {
      console.warn("[OpenAIProvider] Generate error:", error);
      return `AI Generation failed: ${(error as Error).message}`;
    }
  }

  public async stream(
    prompt: string,
    onChunk: (chunk: string) => void,
    options?: AIRequestOptions
  ): Promise<string> {
    const client = this.getClient();
    if (!client) {
      const msg = "OpenAI-compatible provider not configured. Please supply an API key in settings or .env";
      onChunk(msg);
      return msg;
    }

    try {
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
      if (options?.systemPrompt) {
        messages.push({ role: "system", content: options.systemPrompt });
      }
      messages.push({ role: "user", content: prompt });

      const stream = await client.chat.completions.create({
        model: options?.model || this.model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 2048,
        stream: true,
      });

      let fullText = "";
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || "";
        if (delta) {
          fullText += delta;
          onChunk(delta);
        }
      }

      return fullText;
    } catch (error) {
      console.warn("[OpenAIProvider] Stream error:", error);
      const msg = `AI Streaming failed: ${(error as Error).message}`;
      onChunk(msg);
      return msg;
    }
  }
}
