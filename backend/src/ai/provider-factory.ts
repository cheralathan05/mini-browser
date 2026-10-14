import { AIProvider } from "./provider-interface.js";
import { OllamaProvider } from "./ollama-provider.js";
import { OpenAICompatibleProvider } from "./openai-provider.js";
import { env } from "../config/env.js";

export class AIProviderFactory {
  private static ollama = new OllamaProvider();
  private static openAi = new OpenAICompatibleProvider();

  public static async getActiveProvider(): Promise<AIProvider> {
    const openAiKey = (process.env.OPENAI_API_KEY || env.OPENAI_API_KEY || "").trim();
    const explicitProvider = (process.env.AI_PROVIDER || (env as any).AI_PROVIDER || "auto").toLowerCase();

    if (explicitProvider === "openai") {
      return this.openAi;
    }

    if (explicitProvider === "ollama") {
      return this.ollama;
    }

    // Auto mode: If user configured an OpenAI API key, prioritize OpenAI for cloud performance
    if (openAiKey.length > 0 && (await this.openAi.isAvailable())) {
      return this.openAi;
    }

    // Otherwise check if local Ollama is available
    const isOllamaOnline = await this.ollama.isAvailable();
    if (isOllamaOnline) {
      return this.ollama;
    }

    // Fallback
    if (openAiKey.length > 0) {
      return this.openAi;
    }

    return this.ollama;
  }

  public static getOllamaProvider(): AIProvider {
    return this.ollama;
  }

  public static getOpenAIProvider(): AIProvider {
    return this.openAi;
  }
}
