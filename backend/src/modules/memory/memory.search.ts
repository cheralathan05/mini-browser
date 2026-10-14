// NEXUS MEMORY — Hybrid Search
// Always-available: PostgreSQL keyword search
// Optional: Vector similarity (when embeddings exist)

import { prisma } from "../../config/db.js";
import type { SearchInput } from "./memory.types.js";

// ---------------------------------------------------------------
// Keyword search (PostgreSQL ILIKE — always available)
// ---------------------------------------------------------------
async function keywordSearch(input: SearchInput) {
  const {
    userId,
    workspaceId,
    query,
    type,
    status,
    minImportance,
    isVerified,
    limit = 20,
    cursor,
  } = input;

  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2)
    .slice(0, 10);

  const where: any = {
    userId,
    deletedAt: null,
    status: status ? status : { not: "DELETED" },
    ...(workspaceId ? { workspaceId } : {}),
    ...(type ? { type: { equals: type, mode: "insensitive" } } : {}),
    ...(minImportance ? { importanceScore: { gte: minImportance } } : {}),
    ...(isVerified !== undefined ? { isUserVerified: isVerified } : {}),
    OR:
      terms.length > 0
        ? terms.map((term) => ({
            OR: [
              { title: { contains: term, mode: "insensitive" } },
              { content: { contains: term, mode: "insensitive" } },
              { summary: { contains: term, mode: "insensitive" } },
              { category: { contains: term, mode: "insensitive" } },
              { key: { contains: term, mode: "insensitive" } },
            ],
          }))
        : [{ title: { not: null } }], // No-query = return all
  };

  const memories = await prisma.memory.findMany({
    where,
    include: {
      sources: { select: { id: true, title: true, sourceType: true, url: true, domain: true }, take: 3 },
      _count: { select: { outgoingRelations: true, incomingRelations: true, notes: true } },
    },
    orderBy: [{ isPinned: "desc" }, { importanceScore: "desc" }, { updatedAt: "desc" }],
    take: limit,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  // Score each result
  return memories.map((m) => {
    let keywordScore = 0;
    const text = `${m.title} ${m.content} ${m.summary ?? ""} ${m.category ?? ""}`.toLowerCase();
    for (const term of terms) {
      const occurrences = (text.match(new RegExp(term, "gi")) || []).length;
      keywordScore += Math.min(occurrences * 0.1, 0.5);
    }

    // Hybrid scoring formula
    const recencyScore = getRecencyScore(m.updatedAt);
    const relCount = m._count.outgoingRelations + m._count.incomingRelations;
    const relationScore = Math.min(relCount * 0.05, 0.3);

    const finalScore =
      Math.min(keywordScore, 1.0) * 0.45 +
      m.importanceScore * 0.25 +
      recencyScore * 0.15 +
      relationScore * 0.1 +
      (m.isUserVerified ? 0.05 : 0);

    return { ...m, _score: finalScore };
  }).sort((a, b) => b._score - a._score);
}

// ---------------------------------------------------------------
// Recency scoring: exponential decay
// ---------------------------------------------------------------
function getRecencyScore(date: Date): number {
  const ageMs = Date.now() - date.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return Math.exp(-ageDays / 30); // Half-life: 30 days
}

// ---------------------------------------------------------------
// Main search function (hybrid, graceful fallback)
// ---------------------------------------------------------------
export async function searchMemories(input: SearchInput) {
  const results = await keywordSearch(input);
  return {
    memories: results,
    total: results.length,
    searchType: "keyword" as const,
    query: input.query,
  };
}
