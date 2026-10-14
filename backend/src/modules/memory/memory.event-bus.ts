// NEXUS MEMORY — Event Bus for Cross-Module Integration
// Allows Research, Agents, AI Assistant, and Browser to asynchronously feed knowledge into Memory.

import { EventEmitter } from "node:events";
import { ingestMemory } from "./memory.ingestion.js";
import { createMemoryEvent } from "./memory.repository.js";
import { MemoryEventType, SourceType } from "./memory.types.js";
import { logger } from "../../middleware/logger.js";

export interface ResearchCompletedEvent {
  userId: string;
  workspaceId?: string;
  projectId: string;
  title: string;
  summary: string;
  findings?: Array<{ claim: string; confidence?: number }>;
  sources?: Array<{ url: string; title: string; domain?: string }>;
  tags?: string[];
}

export interface AgentCompletedEvent {
  userId: string;
  workspaceId?: string;
  taskId: string;
  taskTitle: string;
  goal: string;
  resultSummary: string;
  details?: Record<string, unknown>;
}

export interface ConversationCompletedEvent {
  userId: string;
  workspaceId?: string;
  conversationId: string;
  title: string;
  keyInsights: string[];
}

export interface PageSavedEvent {
  userId: string;
  workspaceId?: string;
  url: string;
  title: string;
  selectedText?: string;
  summary?: string;
  tags?: string[];
}

class MemoryEventBus extends EventEmitter {
  constructor() {
    super();
    this.setupListeners();
  }

  private setupListeners() {
    // 1. Research Completed
    this.on("RESEARCH_COMPLETED", async (event: ResearchCompletedEvent) => {
      try {
        const memory = await ingestMemory({
          userId: event.userId,
          workspaceId: event.workspaceId,
          title: event.title || "Research Project Findings",
          content: `${event.summary}\n\n${(event.findings || []).map((f, i) => `${i + 1}. ${f.claim}`).join("\n")}`,
          summary: event.summary,
          type: "RESEARCH",
          category: "Research",
          researchProjectId: event.projectId,
          tags: event.tags || ["research"],
          importance: 0.9,
          sourceType: SourceType.PAPER,
          sourceUrl: event.sources?.[0]?.url,
          sourceTitle: event.sources?.[0]?.title,
          sourceDomain: event.sources?.[0]?.domain,
        });

        await createMemoryEvent({
          memoryId: memory.id,
          userId: event.userId,
          workspaceId: event.workspaceId,
          eventType: MemoryEventType.RESEARCH_SAVED,
          title: `Research saved: "${event.title}"`,
        });

        logger.info(`[MemoryEventBus] Ingested research findings: ${memory.id}`);
      } catch (err) {
        logger.error("[MemoryEventBus] Failed to ingest research event:", err);
      }
    });

    // 2. Agent Completed
    this.on("AGENT_COMPLETED", async (event: AgentCompletedEvent) => {
      try {
        const memory = await ingestMemory({
          userId: event.userId,
          workspaceId: event.workspaceId,
          title: `Agent Result: ${event.taskTitle}`,
          content: `Goal: ${event.goal}\n\nOutcome:\n${event.resultSummary}`,
          summary: event.resultSummary.slice(0, 300),
          type: "INSIGHT",
          category: "Agent Automation",
          agentTaskId: event.taskId,
          tags: ["agent-task", "automation"],
          importance: 0.75,
          sourceType: SourceType.AGENT,
          metadata: event.details,
        });

        await createMemoryEvent({
          memoryId: memory.id,
          userId: event.userId,
          workspaceId: event.workspaceId,
          eventType: MemoryEventType.AGENT_RESULT_SAVED,
          title: `Agent task saved: "${event.taskTitle}"`,
        });

        logger.info(`[MemoryEventBus] Ingested agent result: ${memory.id}`);
      } catch (err) {
        logger.error("[MemoryEventBus] Failed to ingest agent event:", err);
      }
    });

    // 3. Conversation Completed
    this.on("AI_CONVERSATION_COMPLETED", async (event: ConversationCompletedEvent) => {
      try {
        if (!event.keyInsights?.length) return;
        const memory = await ingestMemory({
          userId: event.userId,
          workspaceId: event.workspaceId,
          title: `Insights from: ${event.title}`,
          content: event.keyInsights.map((ins, i) => `${i + 1}. ${ins}`).join("\n"),
          summary: event.keyInsights[0],
          type: "INSIGHT",
          category: "Conversation",
          conversationId: event.conversationId,
          tags: ["chat", "insights"],
          importance: 0.6,
          sourceType: SourceType.CHAT,
        });

        logger.info(`[MemoryEventBus] Ingested conversation insights: ${memory.id}`);
      } catch (err) {
        logger.error("[MemoryEventBus] Failed to ingest conversation event:", err);
      }
    });

    // 4. Page Saved
    this.on("PAGE_SAVED", async (event: PageSavedEvent) => {
      try {
        const domain = (() => {
          try {
            return new URL(event.url).hostname;
          } catch {
            return undefined;
          }
        })();

        const memory = await ingestMemory({
          userId: event.userId,
          workspaceId: event.workspaceId,
          title: event.title || event.url,
          content: event.selectedText || event.summary || event.title,
          summary: event.summary,
          type: "FACT",
          category: "Web clipping",
          sourceUrl: event.url,
          sourceTitle: event.title,
          sourceDomain: domain,
          sourceType: SourceType.WEB,
          tags: event.tags || ["web"],
          importance: 0.65,
        });

        await createMemoryEvent({
          memoryId: memory.id,
          userId: event.userId,
          workspaceId: event.workspaceId,
          eventType: MemoryEventType.SOURCE_ADDED,
          title: `Web page saved: "${event.title}"`,
        });

        logger.info(`[MemoryEventBus] Ingested saved page: ${memory.id}`);
      } catch (err) {
        logger.error("[MemoryEventBus] Failed to ingest page event:", err);
      }
    });
  }

  // Public emit helper methods
  public emitResearchCompleted(event: ResearchCompletedEvent) {
    this.emit("RESEARCH_COMPLETED", event);
  }

  public emitAgentCompleted(event: AgentCompletedEvent) {
    this.emit("AGENT_COMPLETED", event);
  }

  public emitConversationCompleted(event: ConversationCompletedEvent) {
    this.emit("AI_CONVERSATION_COMPLETED", event);
  }

  public emitPageSaved(event: PageSavedEvent) {
    this.emit("PAGE_SAVED", event);
  }
}

export const memoryEventBus = new MemoryEventBus();
