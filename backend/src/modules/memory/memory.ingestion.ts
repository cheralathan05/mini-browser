// NEXUS MEMORY — Ingestion Pipeline
// Each stage is independently testable and can fail gracefully.

import { prisma } from "../../config/db.js";
import { createMemory, createMemorySource, createRelation, createMemoryEvent, updateMemory } from "./memory.repository.js";
import { MemoryEventType } from "./memory.types.js";
import type { IngestionInput } from "./memory.types.js";

// ---------------------------------------------------------------
// Stage 1: Content normalization
// ---------------------------------------------------------------
function normalizeContent(content: string): string {
  return content.trim().replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").slice(0, 50000);
}

// ---------------------------------------------------------------
// Stage 2: Simple importance scoring (deterministic, no LLM)
// ---------------------------------------------------------------
function scoreImportance(input: IngestionInput): number {
  let score = 0.3; // baseline

  // Explicit user save is highest signal
  if (input.importance && input.importance > 0.7) score += 0.3;
  else if (input.importance) score += 0.1;

  // Research context
  if (input.researchProjectId) score += 0.15;
  if (input.agentTaskId) score += 0.1;

  // Content richness
  const wordCount = input.content.split(/\s+/).length;
  if (wordCount > 500) score += 0.1;
  if (wordCount > 200) score += 0.05;

  // Source quality
  if (input.sourceUrl) score += 0.05;
  if (input.sourceType === "PAPER") score += 0.1;
  if (input.sourceType === "AGENT") score += 0.05;

  // Tags indicate categorization effort
  if (input.tags && input.tags.length > 2) score += 0.05;

  return Math.min(1.0, score);
}

// ---------------------------------------------------------------
// Stage 3: Auto-classify type from context
// ---------------------------------------------------------------
function classifyType(input: IngestionInput): string {
  if (input.type && input.type !== "fact") return input.type.toUpperCase();
  if (input.researchProjectId) return "RESEARCH";
  if (input.agentTaskId) return "INSIGHT";
  if (input.conversationId) return "CONVERSATION";
  if (input.sourceUrl?.includes("arxiv") || input.sourceUrl?.includes("doi")) return "FACT";
  if (input.sourceType === "PAPER") return "RESEARCH";
  return "FACT";
}

// ---------------------------------------------------------------
// Stage 4: Generate a title if missing
// ---------------------------------------------------------------
function deriveTitle(input: IngestionInput): string {
  if (input.title && input.title.trim()) return input.title.trim();
  if (input.sourceTitle) return input.sourceTitle;
  const firstLine = input.content.split("\n")[0].trim();
  return firstLine.slice(0, 80) || "Untitled Memory";
}

// ---------------------------------------------------------------
// Stage 5: Generate a summary (simple, no LLM — truncate + clean)
// ---------------------------------------------------------------
function generateSummary(content: string): string {
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 20);
  return sentences.slice(0, 3).join(". ").trim().slice(0, 500) || content.slice(0, 200);
}

// ---------------------------------------------------------------
// Stage 6: Chunk content for potential embedding
// ---------------------------------------------------------------
function chunkContent(content: string, chunkSize = 800): string[] {
  const chunks: string[] = [];
  const paragraphs = content.split(/\n\n+/);
  let current = "";

  for (const para of paragraphs) {
    if ((current + para).length > chunkSize && current.length > 0) {
      chunks.push(current.trim());
      current = para;
    } else {
      current += (current ? "\n\n" : "") + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [content.slice(0, chunkSize)];
}

// ---------------------------------------------------------------
// Stage 7: Detect deduplication candidate (keyword-based quick check)
// ---------------------------------------------------------------
async function checkDuplicate(userId: string, title: string, content: string): Promise<string | null> {
  const firstWords = title.split(" ").slice(0, 3).join(" ");
  if (!firstWords) return null;

  const candidate = await prisma.memory.findFirst({
    where: {
      userId,
      deletedAt: null,
      title: { contains: firstWords, mode: "insensitive" },
    },
    select: { id: true },
  });
  return candidate?.id ?? null;
}

// ---------------------------------------------------------------
// Main ingestion function — fast path, returns memory immediately
// Background enrichment (embeddings, relations) runs async.
// ---------------------------------------------------------------
export async function ingestMemory(input: IngestionInput) {
  const content = normalizeContent(input.content);
  const title = deriveTitle(input);
  const key = title.slice(0, 80);
  const type = classifyType(input);
  const importanceScore = scoreImportance(input);
  const summary = generateSummary(content);

  // Fast path: create memory record immediately
  const memory = await createMemory({
    userId: input.userId,
    workspaceId: input.workspaceId,
    type,
    category: input.category,
    title,
    key,
    content,
    summary,
    importanceScore,
    confidenceScore: input.researchProjectId ? 0.85 : 0.75,
    status: "ACTIVE",
    metadata: input.metadata,
  });

  // Record timeline event
  await createMemoryEvent({
    memoryId: memory.id,
    userId: input.userId,
    workspaceId: input.workspaceId,
    eventType: MemoryEventType.MEMORY_CREATED,
    title: `Memory created: "${title}"`,
    metadata: { type, importanceScore },
  });

  // Add source if provided
  if (input.sourceUrl || input.sourceTitle) {
    await createMemorySource({
      memoryId: memory.id,
      url: input.sourceUrl,
      title: input.sourceTitle || input.sourceUrl || "Source",
      domain: input.sourceDomain || extractDomain(input.sourceUrl),
      sourceType: input.sourceType || "WEB",
    });

    await createMemoryEvent({
      memoryId: memory.id,
      userId: input.userId,
      workspaceId: input.workspaceId,
      eventType: MemoryEventType.SOURCE_ADDED,
      title: `Source added: "${input.sourceTitle || input.sourceUrl}"`,
    });
  }

  // Background enrichment: create chunks (fire and forget)
  enrichMemoryAsync(memory.id, content, input.userId, input.workspaceId).catch((err) => {
    console.error(`[Memory] Background enrichment failed for ${memory.id}:`, err);
  });

  return memory;
}

// ---------------------------------------------------------------
// Background enrichment (async, non-blocking)
// ---------------------------------------------------------------
async function enrichMemoryAsync(memoryId: string, content: string, userId: string, workspaceId?: string) {
  try {
    // Create chunks
    const chunks = chunkContent(content);
    for (let i = 0; i < chunks.length; i++) {
      await prisma.memoryChunk.create({
        data: {
          memoryId,
          chunkIndex: i,
          content: chunks[i],
          tokenCount: Math.ceil(chunks[i].split(/\s+/).length * 1.3),
        },
      });
    }

    // Mark embedding status as PENDING (embeddings require Ollama, handled separately)
    await updateMemory(memoryId, userId, { embeddingStatus: "PENDING" as any });

    // Auto-detect relations with existing memories (simple keyword matching)
    await detectAndCreateRelations(memoryId, content, userId, workspaceId);
  } catch (err) {
    console.error(`[Memory] Enrichment error:`, err);
  }
}

// ---------------------------------------------------------------
// Simple relation detection via keyword overlap
// ---------------------------------------------------------------
async function detectAndCreateRelations(
  memoryId: string,
  content: string,
  userId: string,
  workspaceId?: string
) {
  const contentLower = content.toLowerCase();
  const words = contentLower.split(/\W+/).filter((w) => w.length > 5);
  const significantWords = [...new Set(words)].slice(0, 20);
  if (significantWords.length === 0) return;

  // Find other memories that share significant keywords
  const candidates = await prisma.memory.findMany({
    where: {
      userId,
      deletedAt: null,
      id: { not: memoryId },
      ...(workspaceId ? { workspaceId } : {}),
      OR: significantWords.slice(0, 5).map((w) => ({
        content: { contains: w, mode: "insensitive" as const },
      })),
    },
    select: { id: true, content: true },
    take: 10,
  });

  for (const candidate of candidates) {
    const candidateLower = candidate.content.toLowerCase();
    const overlap = significantWords.filter((w) => candidateLower.includes(w)).length;
    const strength = Math.min(0.9, overlap / significantWords.length);

    if (strength >= 0.2) {
      await createRelation({
        sourceId: memoryId,
        targetId: candidate.id,
        relationType: "RELATED_TO",
        strength,
        confidence: 0.7,
        isAutomatic: true,
      }).catch(() => {}); // ignore unique constraint violations
    }
  }
}

// ---------------------------------------------------------------
// Ingest from Research completion event
// ---------------------------------------------------------------
export async function ingestFromResearch(payload: {
  userId: string;
  workspaceId: string;
  researchProjectId: string;
  projectName: string;
  question: string;
  summary?: string;
  sources?: Array<{ url: string; title: string; domain?: string }>;
  findings?: string[];
}) {
  const content = [
    `Research Question: ${payload.question}`,
    payload.summary ? `\nSummary:\n${payload.summary}` : "",
    payload.findings?.length
      ? `\nKey Findings:\n${payload.findings.map((f, i) => `${i + 1}. ${f}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const memory = await ingestMemory({
    userId: payload.userId,
    workspaceId: payload.workspaceId,
    title: payload.projectName,
    content,
    type: "RESEARCH",
    category: "Research",
    importance: 0.85,
    researchProjectId: payload.researchProjectId,
    metadata: { researchProjectId: payload.researchProjectId },
  });

  // Add research sources
  if (payload.sources) {
    for (const src of payload.sources.slice(0, 10)) {
      await createMemorySource({
        memoryId: memory.id,
        url: src.url,
        title: src.title,
        domain: src.domain,
        sourceType: "WEB",
      }).catch(() => {});
    }
  }

  // Timeline
  await createMemoryEvent({
    memoryId: memory.id,
    userId: payload.userId,
    workspaceId: payload.workspaceId,
    eventType: MemoryEventType.RESEARCH_SAVED,
    title: `Research saved to memory: "${payload.projectName}"`,
    metadata: { researchProjectId: payload.researchProjectId, sourceCount: payload.sources?.length ?? 0 },
  });

  return memory;
}

// ---------------------------------------------------------------
// Ingest from Agent completion event
// ---------------------------------------------------------------
export async function ingestFromAgent(payload: {
  userId: string;
  workspaceId: string;
  agentTaskId: string;
  taskTitle: string;
  result: string;
  metadata?: Record<string, unknown>;
}) {
  const memory = await ingestMemory({
    userId: payload.userId,
    workspaceId: payload.workspaceId,
    title: `Agent: ${payload.taskTitle}`,
    content: payload.result,
    type: "INSIGHT",
    category: "Agent Result",
    importance: 0.7,
    agentTaskId: payload.agentTaskId,
    metadata: { agentTaskId: payload.agentTaskId, ...payload.metadata },
  });

  await createMemoryEvent({
    memoryId: memory.id,
    userId: payload.userId,
    workspaceId: payload.workspaceId,
    eventType: MemoryEventType.AGENT_RESULT_SAVED,
    title: `Agent result saved: "${payload.taskTitle}"`,
    metadata: { agentTaskId: payload.agentTaskId },
  });

  return memory;
}

// ---------------------------------------------------------------
// Helper: Extract domain from URL
// ---------------------------------------------------------------
function extractDomain(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return undefined;
  }
}
