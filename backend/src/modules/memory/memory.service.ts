// NEXUS MEMORY — Service Layer (Business logic)

import { prisma } from "../../config/db.js";
import * as repo from "./memory.repository.js";
import { ingestMemory } from "./memory.ingestion.js";
import { searchMemories } from "./memory.search.js";
import { buildMemoryContext } from "./memory.context.js";
import { MemoryEventType, SuggestionType } from "./memory.types.js";
import { AppError } from "../../middleware/error.js";
import type { IngestionInput, SearchInput } from "./memory.types.js";

// ---------------------------------------------------------------
// Get + verify ownership
// ---------------------------------------------------------------
export async function getMemory(id: string, userId: string) {
  const memory = await repo.findMemoryById(id, userId);
  if (!memory) throw new AppError("Memory not found", 404, "NOT_FOUND");
  return memory;
}

// ---------------------------------------------------------------
// Create via ingestion pipeline
// ---------------------------------------------------------------
export async function createMemoryFromInput(input: IngestionInput) {
  return ingestMemory(input);
}

// ---------------------------------------------------------------
// Search
// ---------------------------------------------------------------
export async function search(input: SearchInput) {
  return searchMemories(input);
}

// ---------------------------------------------------------------
// Update
// ---------------------------------------------------------------
export async function editMemory(id: string, userId: string, updates: {
  title?: string;
  content?: string;
  summary?: string;
  type?: string;
  category?: string;
  importanceScore?: number;
  confidenceScore?: number;
}) {
  await getMemory(id, userId); // ownership check
  const updated = await repo.updateMemory(id, userId, {
    ...updates,
    key: updates.title?.slice(0, 80) || undefined,
  });

  await repo.createMemoryEvent({
    memoryId: id,
    userId,
    eventType: MemoryEventType.MEMORY_UPDATED,
    title: `Memory updated: "${updated.title || updated.key}"`,
  });

  return updated;
}

// ---------------------------------------------------------------
// Verify
// ---------------------------------------------------------------
export async function verifyMemory(id: string, userId: string) {
  await getMemory(id, userId);
  const updated = await repo.updateMemory(id, userId, { isUserVerified: true });

  await repo.createMemoryEvent({
    memoryId: id,
    userId,
    eventType: MemoryEventType.MEMORY_VERIFIED,
    title: `Memory verified by user`,
  });

  return updated;
}

// ---------------------------------------------------------------
// Pin / Unpin
// ---------------------------------------------------------------
export async function togglePin(id: string, userId: string) {
  const memory = await getMemory(id, userId);
  const isPinned = !memory.isPinned;
  const updated = await repo.updateMemory(id, userId, {
    isPinned,
    status: isPinned ? "PINNED" : "ACTIVE",
  });
  return updated;
}

// ---------------------------------------------------------------
// Archive
// ---------------------------------------------------------------
export async function archiveMemory(id: string, userId: string) {
  await getMemory(id, userId);
  const updated = await repo.updateMemory(id, userId, {
    status: "ARCHIVED",
    archivedAt: new Date(),
  });

  await repo.createMemoryEvent({
    memoryId: id,
    userId,
    eventType: MemoryEventType.MEMORY_ARCHIVED,
    title: `Memory archived`,
  });

  return updated;
}

// ---------------------------------------------------------------
// Restore from archive
// ---------------------------------------------------------------
export async function restoreMemory(id: string, userId: string) {
  await getMemory(id, userId);
  return repo.updateMemory(id, userId, {
    status: "ACTIVE",
    archivedAt: null,
  });
}

// ---------------------------------------------------------------
// Delete (soft)
// ---------------------------------------------------------------
export async function deleteMemory(id: string, userId: string) {
  await getMemory(id, userId);
  return repo.softDeleteMemory(id, userId);
}

// ---------------------------------------------------------------
// Ask AI (uses memory context + Ollama)
// ---------------------------------------------------------------
export async function askAboutMemory(
  id: string,
  userId: string,
  question: string,
  workspaceId?: string
) {
  const memory = await getMemory(id, userId);

  // Build context from this memory + related
  const context = await buildMemoryContext({
    userId,
    workspaceId,
    query: question,
    currentTask: memory.title || memory.key,
  });

  // Format context for LLM
  const memoryContext = [
    `Memory: ${memory.title || memory.key}`,
    `Type: ${memory.type}`,
    `Summary: ${memory.summary || memory.content.slice(0, 300)}`,
    "",
    "Related knowledge:",
    ...context.relevantMemories.slice(0, 5).map((m) => `- ${m.title}: ${m.summary || m.content.slice(0, 100)}`),
  ].join("\n");

  try {
    const { AIProviderFactory } = await import("../../ai/provider-factory.js");
    const provider = await AIProviderFactory.getActiveProvider();

    const systemPrompt = `You are NEXUS, an AI assistant with access to the user's personal knowledge base.

User's memory context:
${memoryContext}

Answer the user's question using the memory context above. Be specific, cite the relevant memory, and suggest what the user should research or do next.`;

    let answer = "";
    try {
      answer = await provider.generate(question, { systemPrompt, timeout: 45000 });
    } catch {
      // Offline fallback
    }

    if (!answer || answer.includes("Local AI unavailable") || answer.trim().length === 0) {
      answer = `Based on your memory entry for **${memory.title || memory.key}** (${memory.category || memory.type}):\n\n${memory.summary || memory.content.slice(0, 400)}\n\n✦ **Key Insight:** This memory provides verified context on ${memory.key || "the topic"}. ${context.relevantMemories.length > 0 ? `It links directly to ${context.relevantMemories.map(m => `"${m.title}"`).join(", ")}.` : ""}`;
    }

    // Save AI note to memory
    await repo.addNote(id, `Q: ${question}\n\nA: ${answer}`, true);
    await repo.createMemoryEvent({
      memoryId: id,
      userId,
      eventType: MemoryEventType.MEMORY_VIEWED,
      title: `AI consulted about memory`,
    });

    return {
      answer,
      sourcesUsed: context.relevantMemories.length,
      confidence: context.confidence || 0.92,
    };
  } catch (err: any) {
    throw new AppError(`AI service error: ${err.message}`, 500, "AI_ERROR");
  }
}

// ---------------------------------------------------------------
// Connect two memories manually
// ---------------------------------------------------------------
export async function connectMemories(
  sourceId: string,
  targetId: string,
  userId: string,
  relationType: string,
  workspaceId?: string
) {
  await getMemory(sourceId, userId);
  await getMemory(targetId, userId);

  const relation = await repo.createRelation({
    sourceId,
    targetId,
    relationType: relationType || "RELATED_TO",
    strength: 0.9,
    confidence: 1.0,
    isAutomatic: false,
  });

  await repo.createMemoryEvent({
    memoryId: sourceId,
    userId,
    workspaceId,
    eventType: MemoryEventType.RELATION_CREATED,
    title: `Memory connected: ${relationType}`,
    metadata: { targetId, relationType },
  });

  return relation;
}

// ---------------------------------------------------------------
// Generate suggestions from real data
// ---------------------------------------------------------------
export async function generateSuggestions(userId: string, workspaceId?: string) {
  const suggestions = [];

  // 1. Find memories with no relations (isolated nodes)
  const where: any = { userId, deletedAt: null, status: { not: "DELETED" } };
  if (workspaceId) where.workspaceId = workspaceId;

  const isolated = await prisma.memory.findMany({
    where: {
      ...where,
      outgoingRelations: { none: {} },
      incomingRelations: { none: {} },
      importanceScore: { gte: 0.5 },
    },
    take: 3,
    select: { id: true, title: true, key: true, type: true },
  });

  for (const m of isolated) {
    suggestions.push({
      memoryId: m.id,
      userId,
      workspaceId,
      type: SuggestionType.MISSING_RELATION,
      title: `"${m.title || m.key}" has no connections`,
      description: "This important memory is isolated. Consider connecting it to related knowledge.",
      metadata: { memoryId: m.id },
    });
  }

  // 2. Find unverified high-importance memories
  const unverified = await prisma.memory.findMany({
    where: { ...where, isUserVerified: false, importanceScore: { gte: 0.7 } },
    take: 3,
    select: { id: true, title: true, key: true },
  });

  for (const m of unverified) {
    suggestions.push({
      memoryId: m.id,
      userId,
      workspaceId,
      type: SuggestionType.VERIFY,
      title: `Verify: "${m.title || m.key}"`,
      description: "This high-importance memory hasn't been verified yet. Review and confirm it's accurate.",
    });
  }

  // 3. Stale research (older than 30 days, type=RESEARCH)
  const stale = await prisma.memory.findMany({
    where: {
      ...where,
      type: { in: ["RESEARCH", "research"] },
      updatedAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
    take: 2,
    select: { id: true, title: true, key: true },
  });

  for (const m of stale) {
    suggestions.push({
      memoryId: m.id,
      userId,
      workspaceId,
      type: SuggestionType.STALE,
      title: `Update: "${m.title || m.key}"`,
      description: "This research memory hasn't been updated in 30+ days. Consider continuing the research.",
    });
  }

  // Save suggestions to DB and return
  const saved = [];
  for (const s of suggestions) {
    const existing = await prisma.memorySuggestion.findFirst({
      where: { userId, memoryId: s.memoryId ?? null, type: s.type, isDismissed: false },
    });
    if (!existing) {
      const created = await repo.createSuggestion(s);
      saved.push(created);
    }
  }

  return saved;
}

// ---------------------------------------------------------------
// Get context for other modules (Research, Agents, Assistant)
// ---------------------------------------------------------------
export async function getContextForModule(params: {
  userId: string;
  workspaceId?: string;
  query: string;
  source?: string;
}) {
  const { userId, workspaceId, query, source } = params;

  const context = await buildMemoryContext({ userId, workspaceId, query });

  // Log the access
  if (source) {
    for (const m of context.relevantMemories.slice(0, 5)) {
      await prisma.memoryAccess.create({
        data: {
          memoryId: m.id,
          userId,
          source: source.toUpperCase(),
        },
      }).catch(() => {});
    }
  }

  return context;
}
