export interface AIRequestOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  timeout?: number;
  onThought?: (thought: string) => void;
  tools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
}

export interface AIProvider {
  name: string;
  isAvailable(): Promise<boolean>;
  getModel?(requested?: string): Promise<string>;
  generate(prompt: string, options?: AIRequestOptions): Promise<string>;
  stream(prompt: string, onChunk: (chunk: string) => void, options?: AIRequestOptions): Promise<string>;
  embed?(text: string): Promise<number[]>;
}

