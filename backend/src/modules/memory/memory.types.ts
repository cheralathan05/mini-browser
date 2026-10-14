// NEXUS MEMORY — Types, Enums & Interfaces

export enum MemoryType {
  CONCEPT = "CONCEPT",
  RESEARCH = "RESEARCH",
  PROJECT = "PROJECT",
  NOTE = "NOTE",
  DECISION = "DECISION",
  PREFERENCE = "PREFERENCE",
  SOURCE = "SOURCE",
  TASK = "TASK",
  CONVERSATION = "CONVERSATION",
  ENTITY = "ENTITY",
  INSIGHT = "INSIGHT",
  FACT = "FACT",
  QUESTION = "QUESTION",
  SUMMARY = "SUMMARY",
  // Legacy compatibility
  fact = "FACT",
  research = "RESEARCH",
  project = "PROJECT",
  website = "SOURCE",
  rule = "NOTE",
  preference = "PREFERENCE",
  workflow = "PROJECT",
  decision = "DECISION",
  task = "TASK",
  conversation = "CONVERSATION",
}

export enum MemoryStatus {
  CANDIDATE = "CANDIDATE",
  ACTIVE = "ACTIVE",
  PINNED = "PINNED",
  ARCHIVED = "ARCHIVED",
  DELETED = "DELETED",
}

export enum RelationType {
  RELATED_TO = "RELATED_TO",
  MENTIONS = "MENTIONS",
  DERIVED_FROM = "DERIVED_FROM",
  BELONGS_TO = "BELONGS_TO",
  SUPPORTS = "SUPPORTS",
  CONTRADICTS = "CONTRADICTS",
  SAME_TOPIC = "SAME_TOPIC",
  SAME_PROJECT = "SAME_PROJECT",
  SAME_SOURCE = "SAME_SOURCE",
  CREATED_FROM = "CREATED_FROM",
  UPDATED_FROM = "UPDATED_FROM",
}

export enum SourceType {
  WEB = "WEB",
  PAPER = "PAPER",
  DOCUMENT = "DOCUMENT",
  VIDEO = "VIDEO",
  CHAT = "CHAT",
  AGENT = "AGENT",
  USER_NOTE = "USER_NOTE",
}

export enum MemoryEventType {
  MEMORY_CREATED = "MEMORY_CREATED",
  MEMORY_UPDATED = "MEMORY_UPDATED",
  MEMORY_VIEWED = "MEMORY_VIEWED",
  MEMORY_VERIFIED = "MEMORY_VERIFIED",
  MEMORY_ARCHIVED = "MEMORY_ARCHIVED",
  RESEARCH_SAVED = "RESEARCH_SAVED",
  AGENT_RESULT_SAVED = "AGENT_RESULT_SAVED",
  SOURCE_ADDED = "SOURCE_ADDED",
  NOTE_ADDED = "NOTE_ADDED",
  RELATION_CREATED = "RELATION_CREATED",
}

export enum SuggestionType {
  CONNECT = "CONNECT",
  MERGE = "MERGE",
  REVIEW = "REVIEW",
  VERIFY = "VERIFY",
  UPDATE = "UPDATE",
  MISSING_RELATION = "MISSING_RELATION",
  CONTRADICTION = "CONTRADICTION",
  STALE = "STALE",
}

export enum EmbeddingStatus {
  PENDING = "PENDING",
  PROCESSING = "PROCESSING",
  READY = "READY",
  FAILED = "FAILED",
}

// ---------------------------------------------------------------
// Context Engine Output
// ---------------------------------------------------------------

export interface MemoryContextItem {
  id: string;
  title: string;
  summary?: string | null;
  content: string;
  type: string;
  importanceScore: number;
  confidenceScore: number;
  isUserVerified: boolean;
  sources: Array<{ url?: string | null; title: string; sourceType: string }>;
  relevanceScore: number;
}

export interface MemoryContext {
  relevantMemories: MemoryContextItem[];
  relatedSources: Array<{ url?: string | null; title: string; domain?: string | null; sourceType: string }>;
  confidence: number;
  tokenEstimate: number;
  query: string;
}

// ---------------------------------------------------------------
// Graph Types
// ---------------------------------------------------------------

export interface GraphNode {
  id: string;
  title: string;
  type: string;
  importanceScore: number;
  accessCount: number;
  isUserVerified: boolean;
  isPinned: boolean;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relationType: string;
  strength: number;
}

export interface MemoryGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ---------------------------------------------------------------
// Stats
// ---------------------------------------------------------------

export interface MemoryStats {
  knowledgeCount: number;
  topicCount: number;
  projectCount: number;
  researchThreadCount: number;
  recentlyUpdatedCount: number;
  verifiedCount: number;
  pinnedCount: number;
  collectionCount: number;
  sourceCount: number;
  healthScore: number;
}

// ---------------------------------------------------------------
// Ingestion Input
// ---------------------------------------------------------------

export interface IngestionInput {
  userId: string;
  workspaceId?: string;
  title?: string;
  summary?: string;
  content: string;
  type?: string;
  category?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  sourceDomain?: string;
  sourceType?: string;
  tags?: string[];
  importance?: number;
  metadata?: Record<string, unknown>;
  // Cross-module context
  researchProjectId?: string;
  agentTaskId?: string;
  conversationId?: string;
}

// ---------------------------------------------------------------
// Search Input
// ---------------------------------------------------------------

export interface SearchInput {
  userId: string;
  workspaceId?: string;
  query: string;
  type?: string;
  status?: string;
  category?: string;
  minImportance?: number;
  minConfidence?: number;
  isVerified?: boolean;
  tags?: string[];
  limit?: number;
  cursor?: string;
}
