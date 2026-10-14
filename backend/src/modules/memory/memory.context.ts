// NEXUS MEMORY — Context Engine
// Builds a token-budget-aware context for LLM consumption.

import { prisma } from "../../config/db.js";
import { incrementAccessCount } from "./memory.repository.js";
import type { MemoryContext, MemoryContextItem } from "./memory.types.js";

const DEFAULT_TOKEN_BUDGET = 4000;
const TOKENS_PER_CHAR = 0.25; // Rough estimate

function estimateTokens(text: string): number {
  return Math.ceil(text.length * TOKENS_PER_CHAR);
}

// ---------------------------------------------------------------
// Priority scoring for context selection
// Verified > Active project > Relevant research > Recent > Relations > General
// ---------------------------------------------------------------
function priorityScore(memory: any, queryTerms: string[]): number {
  let score = 0;

  // Verification signal (highest trust)
  if (memory.isUserVerified) score += 40;

  // Pinned = user considers it important
  if (memory.isPinned) score += 20;

  // Type bonuses
  if (memory.type === "PROJECT") score += 15;
  if (memory.type === "RESEARCH") score += 12;
  if (memory.type === "INSIGHT") score += 10;

  // Importance
  score += memory.importanceScore * 20;

  // Keyword relevance
  const text = `${memory.title} ${memory.summary ?? ""} ${memory.content}`.toLowerCase();
  for (const term of queryTerms) {
    if (text.includes(term)) score += 5;
  }

  // Recency (recent = more relevant for current task)
  const ageDays = (Date.now() - new Date(memory.updatedAt).getTime()) / 86400000;
  score += Math.max(0, 10 - ageDays * 0.3);

  // Access frequency
  score += Math.min(memory.accessCount * 0.5, 5);

  return score;
}

// ---------------------------------------------------------------
// Main context builder
// ---------------------------------------------------------------
export async function buildMemoryContext(params: {
  userId: string;
  workspaceId?: string;
  query: string;
  currentTask?: string;
  tokenBudget?: number;
}): Promise<MemoryContext> {
  const { userId, workspaceId, query, currentTask, tokenBudget = DEFAULT_TOKEN_BUDGET } = params;

  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 3);

  const fullText = [query, currentTask].filter(Boolean).join(" ");
  const searchTerms = fullText
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 3)
    .slice(0, 15);

  if (searchTerms.length === 0) {
    return { relevantMemories: [], relatedSources: [], confidence: 0, tokenEstimate: 0, query };
  }

  // Fetch candidate memories
  const where: any = {
    userId,
    deletedAt: null,
    status: { not: "DELETED" },
    ...(workspaceId ? { workspaceId } : {}),
    OR: searchTerms.slice(0, 8).map((term) => ({
      OR: [
        { title: { contains: term, mode: "insensitive" } },
        { content: { contains: term, mode: "insensitive" } },
        { summary: { contains: term, mode: "insensitive" } },
      ],
    })),
  };

  const candidates = await prisma.memory.findMany({
    where,
    include: {
      sources: { select: { url: true, title: true, sourceType: true }, take: 3 },
    },
    orderBy: [{ isUserVerified: "desc" }, { importanceScore: "desc" }, { updatedAt: "desc" }],
    take: 30,
  });

  // Score and rank
  const scored = candidates
    .map((m) => ({ ...m, _priority: priorityScore(m, queryTerms) }))
    .sort((a, b) => b._priority - a._priority);

  // Select within token budget
  const relevantMemories: MemoryContextItem[] = [];
  const relatedSources: Array<{ url?: string | null; title: string; domain?: string | null; sourceType: string }> = [];
  let usedTokens = 0;

  for (const m of scored) {
    const text = `${m.title}: ${m.summary || m.content.slice(0, 300)}`;
    const tokens = estimateTokens(text);

    if (usedTokens + tokens > tokenBudget) break;

    relevantMemories.push({
      id: m.id,
      title: m.title || m.key,
      summary: m.summary,
      content: m.content.slice(0, 500),
      type: m.type,
      importanceScore: m.importanceScore,
      confidenceScore: m.confidenceScore,
      isUserVerified: m.isUserVerified,
      sources: m.sources.map((s) => ({ url: s.url, title: s.title, sourceType: s.sourceType })),
      relevanceScore: m._priority / 100,
    });

    usedTokens += tokens;

    // Collect sources
    for (const src of m.sources) {
      relatedSources.push({
        url: src.url,
        title: src.title,
        domain: null,
        sourceType: src.sourceType,
      });
    }

    // Track access
    incrementAccessCount(m.id).catch(() => {});
  }

  const confidence = relevantMemories.length > 0
    ? Math.min(0.95, 0.5 + relevantMemories.filter((m) => m.isUserVerified).length * 0.1)
    : 0;

  return {
    relevantMemories,
    relatedSources: relatedSources.slice(0, 10),
    confidence,
    tokenEstimate: usedTokens,
    query,
  };
}
