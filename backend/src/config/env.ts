import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(8001),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().default("postgresql://nexus:nexuspassword@localhost:5432/nexus_db?schema=public"),
  JWT_SECRET: z.string().min(16).default("nexus-development-jwt-secret-key-must-be-at-least-32-chars-long"),
  REDIS_URL: z.string().optional().default("redis://localhost:6379"),
  AI_PROVIDER: z.enum(["auto", "ollama", "openai"]).default("auto"),
  OLLAMA_URL: z.string().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().default("qwen3:8b"),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),
});

export const env = envSchema.parse(process.env);
