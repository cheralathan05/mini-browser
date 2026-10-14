// NEXUS MEMORY — Repository Layer (All Prisma queries isolated here)

import { prisma } from "../../config/db.js";
import type {
  GraphNode,
  GraphEdge,
  MemoryGraph,
  MemoryStats,
  SearchInput,
} from "./memory.types.js";

// ---------------------------------------------------------------
// Core Memory CRUD
// ---------------------------------------------------------------

export async function findMemoryById(id: string, userId: string) {
  return prisma.memory.findFirst({
    where: { id, userId, deletedAt: null },
    include: {
      sources: { orderBy: { createdAt: "desc" } },
      notes: { orderBy: { createdAt: "desc" } },
      outgoingRelations: {
        include: { target: { select: { id: true, title: true, type: true, key: true } } },
        take: 20,
      },
      incomingRelations: {
        include: { source: { select: { id: true, title: true, type: true, key: true } } },
        take: 20,
      },
      collectionItems: {
        include: { collection: { select: { id: true, name: true, color: true, icon: true } } },
      },
    },
  });
}

export async function findMemories(params: {
  userId: string;
  workspaceId?: string;
  type?: string;
  status?: string;
  query?: string;
  limit?: number;
  cursor?: string;
}) {
  const { userId, workspaceId, type, status, query, limit = 50, cursor } = params;

  const where: any = {
    userId,
    deletedAt: null,
    ...(workspaceId ? { workspaceId } : {}),
    ...(type ? { type: { equals: type, mode: "insensitive" } } : {}),
    ...(status ? { status } : { status: { not: "DELETED" } }),
    ...(query?.trim()
      ? {
          OR: [
            { title: { contains: query, mode: "insensitive" } },
            { key: { contains: query, mode: "insensitive" } },
            { content: { contains: query, mode: "insensitive" } },
            { summary: { contains: query, mode: "insensitive" } },
            { category: { contains: query, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [memories, total] = await Promise.all([
    prisma.memory.findMany({
      where,
      orderBy: [{ isPinned: "desc" }, { importanceScore: "desc" }, { updatedAt: "desc" }],
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        sources: { select: { id: true, title: true, sourceType: true, url: true, domain: true }, take: 5 },
        _count: { select: { outgoingRelations: true, incomingRelations: true, notes: true } },
      },
    }),
    prisma.memory.count({ where }),
  ]);

  const nextCursor = memories.length === limit ? memories[memories.length - 1].id : null;
  return { memories, total, nextCursor };
}

export async function createMemory(data: {
  userId: string;
  workspaceId?: string;
  type: string;
  category?: string;
  title: string;
  key: string;
  content: string;
  summary?: string;
  importanceScore?: number;
  confidenceScore?: number;
  status?: string;
  metadata?: object;
}) {
  return prisma.memory.create({
    data: {
      userId: data.userId,
      workspaceId: data.workspaceId,
      type: data.type,
      category: data.category,
      title: data.title,
      key: data.key,
      content: data.content,
      summary: data.summary,
      importanceScore: data.importanceScore ?? 0.5,
      confidenceScore: data.confidenceScore ?? 0.8,
      importance: data.importanceScore ?? 0.5,
      status: data.status ?? "ACTIVE",
      embeddingStatus: "PENDING",
      metadata: data.metadata,
    },
  });
}

export async function updateMemory(id: string, userId: string, data: Partial<{
  title: string;
  key: string;
  content: string;
  summary: string;
  type: string;
  category: string;
  status: string;
  importanceScore: number;
  confidenceScore: number;
  embeddingStatus: string;
  isPinned: boolean;
  isUserVerified: boolean;
  metadata: object;
  lastAccessedAt: Date;
  archivedAt: Date | null;
}>) {
  return prisma.memory.update({
    where: { id },
    data: {
      ...data,
      updatedAt: new Date(),
    },
  });
}

export async function softDeleteMemory(id: string, userId: string) {
  return prisma.memory.update({
    where: { id },
    data: { status: "DELETED", deletedAt: new Date() },
  });
}

export async function incrementAccessCount(id: string) {
  return prisma.memory.update({
    where: { id },
    data: { accessCount: { increment: 1 }, lastAccessedAt: new Date() },
  });
}

// ---------------------------------------------------------------
// Sources
// ---------------------------------------------------------------

export async function createMemorySource(data: {
  memoryId: string;
  url?: string;
  title: string;
  domain?: string;
  author?: string;
  publishedAt?: Date;
  retrievedAt?: Date;
  sourceType?: string;
  summary?: string;
  metadata?: object;
}) {
  const source = await prisma.memorySource.create({ data: { ...data } });
  // Update sourceCount on parent memory
  await prisma.memory.update({
    where: { id: data.memoryId },
    data: { sourceCount: { increment: 1 } },
  });
  return source;
}

export async function getMemorySources(memoryId: string) {
  return prisma.memorySource.findMany({
    where: { memoryId },
    orderBy: { createdAt: "desc" },
  });
}

// ---------------------------------------------------------------
// Relations (Graph Edges)
// ---------------------------------------------------------------

export async function createRelation(data: {
  sourceId: string;
  targetId: string;
  relationType: string;
  strength?: number;
  confidence?: number;
  isAutomatic?: boolean;
}) {
  return prisma.memoryRelation.upsert({
    where: {
      sourceId_targetId_relationType: {
        sourceId: data.sourceId,
        targetId: data.targetId,
        relationType: data.relationType,
      },
    },
    update: { strength: data.strength ?? 0.5, confidence: data.confidence ?? 0.8 },
    create: {
      sourceId: data.sourceId,
      targetId: data.targetId,
      relationType: data.relationType,
      strength: data.strength ?? 0.5,
      confidence: data.confidence ?? 0.8,
      isAutomatic: data.isAutomatic ?? true,
    },
  });
}

export async function getRelatedMemories(memoryId: string, userId: string) {
  const [outgoing, incoming] = await Promise.all([
    prisma.memoryRelation.findMany({
      where: { sourceId: memoryId },
      include: {
        target: {
          select: { id: true, title: true, key: true, type: true, summary: true, importanceScore: true, userId: true, deletedAt: true },
        },
      },
      take: 20,
    }),
    prisma.memoryRelation.findMany({
      where: { targetId: memoryId },
      include: {
        source: {
          select: { id: true, title: true, key: true, type: true, summary: true, importanceScore: true, userId: true, deletedAt: true },
        },
      },
      take: 20,
    }),
  ]);

  return {
    outgoing: outgoing.filter((r: any) => r.target && r.target.userId === userId && !r.target.deletedAt),
    incoming: incoming.filter((r: any) => r.source && r.source.userId === userId && !r.source.deletedAt),
  };
}

// ---------------------------------------------------------------
// Graph
// ---------------------------------------------------------------

export async function getMemoryGraph(userId: string, workspaceId?: string): Promise<MemoryGraph> {
  const where: any = { userId, deletedAt: null, status: { not: "DELETED" } };
  if (workspaceId) where.workspaceId = workspaceId;

  const memories = await prisma.memory.findMany({
    where,
    select: {
      id: true,
      title: true,
      key: true,
      type: true,
      importanceScore: true,
      accessCount: true,
      isUserVerified: true,
      isPinned: true,
    },
    orderBy: { importanceScore: "desc" },
    take: 100, // Graph cap for performance
  });

  const memoryIds = memories.map((m) => m.id);

  const relations = await prisma.memoryRelation.findMany({
    where: {
      sourceId: { in: memoryIds },
      targetId: { in: memoryIds },
    },
    select: {
      id: true,
      sourceId: true,
      targetId: true,
      relationType: true,
      strength: true,
    },
  });

  const nodes: GraphNode[] = memories.map((m) => ({
    id: m.id,
    title: m.title || m.key || "Untitled",
    type: m.type,
    importanceScore: m.importanceScore,
    accessCount: m.accessCount,
    isUserVerified: m.isUserVerified,
    isPinned: m.isPinned,
  }));

  const edges: GraphEdge[] = relations.map((r) => ({
    id: r.id,
    source: r.sourceId,
    target: r.targetId,
    relationType: r.relationType,
    strength: r.strength,
  }));

  return { nodes, edges };
}

// ---------------------------------------------------------------
// Collections
// ---------------------------------------------------------------

export async function getCollections(userId: string, workspaceId?: string) {
  return prisma.memoryCollection.findMany({
    where: {
      userId,
      ...(workspaceId ? { workspaceId } : {}),
    },
    include: {
      _count: { select: { items: true } },
      items: {
        take: 3,
        include: { memory: { select: { id: true, title: true, key: true, type: true } } },
        orderBy: { addedAt: "desc" },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function createCollection(data: {
  userId: string;
  workspaceId?: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
}) {
  return prisma.memoryCollection.create({ data });
}

export async function addToCollection(collectionId: string, memoryId: string) {
  return prisma.memoryCollectionItem.upsert({
    where: { collectionId_memoryId: { collectionId, memoryId } },
    update: {},
    create: { collectionId, memoryId },
  });
}

export async function removeFromCollection(collectionId: string, memoryId: string) {
  return prisma.memoryCollectionItem.deleteMany({
    where: { collectionId, memoryId },
  });
}

export async function deleteCollection(id: string, userId: string) {
  return prisma.memoryCollection.deleteMany({ where: { id, userId } });
}

// ---------------------------------------------------------------
// Events (Timeline)
// ---------------------------------------------------------------

export async function createMemoryEvent(data: {
  memoryId?: string;
  userId: string;
  workspaceId?: string;
  eventType: string;
  title: string;
  metadata?: object;
}) {
  return prisma.memoryEvent.create({ data });
}

export async function getTimeline(userId: string, workspaceId?: string, limit = 50) {
  return prisma.memoryEvent.findMany({
    where: {
      userId,
      ...(workspaceId ? { workspaceId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      memory: { select: { id: true, title: true, key: true, type: true } },
    },
  });
}

// ---------------------------------------------------------------
// Notes
// ---------------------------------------------------------------

export async function addNote(memoryId: string, content: string, isAI = false) {
  return prisma.memoryNote.create({ data: { memoryId, content, isAI } });
}

export async function deleteNote(id: string) {
  return prisma.memoryNote.delete({ where: { id } });
}

// ---------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------

export async function getSuggestions(userId: string, workspaceId?: string, limit = 10) {
  return prisma.memorySuggestion.findMany({
    where: {
      userId,
      isDismissed: false,
      ...(workspaceId ? { workspaceId } : {}),
    },
    include: { memory: { select: { id: true, title: true, key: true, type: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function dismissSuggestion(id: string, userId: string) {
  return prisma.memorySuggestion.updateMany({
    where: { id, userId },
    data: { isDismissed: true },
  });
}

export async function createSuggestion(data: {
  memoryId?: string;
  userId: string;
  workspaceId?: string;
  type: string;
  title: string;
  description: string;
  metadata?: object;
}) {
  return prisma.memorySuggestion.create({ data });
}

// ---------------------------------------------------------------
// Stats
// ---------------------------------------------------------------

export async function getMemoryStats(userId: string, workspaceId?: string): Promise<MemoryStats> {
  const where: any = { userId, deletedAt: null, status: { not: "DELETED" } };
  if (workspaceId) where.workspaceId = workspaceId;

  const [
    knowledgeCount,
    verifiedCount,
    pinnedCount,
    researchCount,
    projectCount,
    collectionCount,
    sourceCount,
    recentlyUpdated,
  ] = await Promise.all([
    prisma.memory.count({ where }),
    prisma.memory.count({ where: { ...where, isUserVerified: true } }),
    prisma.memory.count({ where: { ...where, isPinned: true } }),
    prisma.memory.count({ where: { ...where, type: { in: ["RESEARCH", "research"] } } }),
    prisma.memory.count({ where: { ...where, type: { in: ["PROJECT", "project"] } } }),
    prisma.memoryCollection.count({ where: { userId, ...(workspaceId ? { workspaceId } : {}) } }),
    prisma.memorySource.count({ where: { memory: { userId, deletedAt: null } } }),
    prisma.memory.count({
      where: {
        ...where,
        updatedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
    }),
  ]);

  // Distinct topics: approximate by counting distinct categories
  const topicQuery = await prisma.memory.findMany({
    where,
    select: { category: true },
    distinct: ["category"],
  });
  const topicCount = topicQuery.filter((t) => t.category).length;

  // Health score: 0-100
  const healthScore = Math.min(
    100,
    Math.round(
      (verifiedCount / Math.max(knowledgeCount, 1)) * 40 +
        (Math.min(recentlyUpdated, 10) / 10) * 30 +
        (Math.min(collectionCount, 5) / 5) * 30
    )
  );

  return {
    knowledgeCount,
    topicCount,
    projectCount,
    researchThreadCount: researchCount,
    recentlyUpdatedCount: recentlyUpdated,
    verifiedCount,
    pinnedCount,
    collectionCount,
    sourceCount,
    healthScore,
  };
}
