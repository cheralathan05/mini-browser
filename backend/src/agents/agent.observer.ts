import { AgentObservationPayload, ToolExecutionResult } from "./agent.types.js";
import { prisma } from "../config/db.js";
import { wsManager } from "../websocket/ws-server.js";
import { sanitizeForDb } from "./agent.utils.js";

export class AgentObserver {
  public static async inspect(
    toolName: string,
    toolResult: ToolExecutionResult,
    context: { taskId: string; runId: string; stepId?: string; userId: string; workspaceId: string }
  ): Promise<AgentObservationPayload> {
    const rawResult = (toolResult.result || {}) as Record<string, any>;

    let url = rawResult.url ? String(rawResult.url) : undefined;
    let title = rawResult.title ? String(rawResult.title) : undefined;
    let summary: string | undefined = undefined;
    let extractedData: any = undefined;

    switch (toolName) {
      case "browser.whatsappSend":
        url = rawResult.url ? String(rawResult.url) : undefined;
        title = `WhatsApp Chat: ${rawResult.phone || "Recipient"}`;
        summary = `Initialized WhatsApp Web session for ${rawResult.phone || "recipient"} with payload "${rawResult.message || ""}".`;
        extractedData = {
          phone: rawResult.phone,
          message: rawResult.message,
          dispatched: true,
          url: rawResult.url,
        };
        break;

      case "browser.navigate":
        title = rawResult.title || title;
        summary = `Page loaded with HTTP ${rawResult.status}. Found ${rawResult.headings?.length || 0} headings.`;
        extractedData = {
          status: rawResult.status,
          headings: rawResult.headings,
          snippet: rawResult.snippet?.slice(0, 300),
        };
        break;

      case "browser.extract":
        summary = `Extracted structured content from ${title || url || "page"}. Found ${rawResult.keyPoints?.length || 0} key items.`;
        extractedData = {
          headings: rawResult.headings,
          keyPoints: rawResult.keyPoints,
          summary: rawResult.contentSummary,
        };
        break;

      case "browser.click":
        summary = `Clicked element "${rawResult.selector || "target"}". Resulting URL: ${rawResult.resultingUrl || url || "active page"}.`;
        extractedData = {
          clicked: true,
          selector: rawResult.selector,
          resultingUrl: rawResult.resultingUrl || url,
        };
        break;

      case "browser.type":
        summary = `Typed "${rawResult.text || ""}" into "${rawResult.selector || "input"}". (${rawResult.characters || (rawResult.text || "").length} chars).`;
        extractedData = {
          typed: true,
          selector: rawResult.selector,
          text: rawResult.text,
          characters: rawResult.characters,
        };
        break;

      case "browser.press":
        summary = `Pressed keyboard key "${rawResult.key || "Enter"}" on active element.`;
        extractedData = { pressed: true, key: rawResult.key };
        break;

      case "browser.scroll":
        summary = `Scrolled viewport ${rawResult.direction || "down"} by ${rawResult.pixels || 800}px.`;
        extractedData = { scrolled: true, direction: rawResult.direction, pixels: rawResult.pixels };
        break;

      case "browser.hover":
        summary = `Hovered over element "${rawResult.selector || "target"}".`;
        extractedData = { hovered: true, selector: rawResult.selector };
        break;

      case "browser.wait":
        summary = `Waited ${rawResult.waitedMs || 1000}ms for DOM stability${rawResult.selector ? ` and selector "${rawResult.selector}"` : ""}.`;
        extractedData = { waited: true, ms: rawResult.waitedMs, selector: rawResult.selector };
        break;

      case "browser.findElement":
        summary = `Located element "${rawResult.selector || "target"}" in active DOM. (Count: ${rawResult.count || 1}).`;
        extractedData = { found: true, selector: rawResult.selector, count: rawResult.count };
        break;

      case "browser.getCurrentPage":
        summary = `Active viewport inspecting: "${rawResult.title || title}" (${rawResult.url || url}).`;
        extractedData = { url: rawResult.url || url, title: rawResult.title || title };
        break;

      case "browser.back":
      case "browser.forward":
      case "browser.reload":
        summary = `Executed browser viewport command: ${toolName}.`;
        extractedData = { action: toolName, url: rawResult.currentUrl || url };
        break;

      case "research.search":
        summary = `Discovered ${rawResult.sourcesCount || 0} authoritative sources across online repositories and literature.`;
        extractedData = {
          query: rawResult.query,
          sources: (rawResult.sources || []).map((s: any) => ({
            title: s.title,
            url: s.url,
            domain: s.domain,
            sourceType: s.sourceType,
          })),
        };
        break;

      case "research.getReport":
        summary = `Generated executive comparison report (${rawResult.length} characters) referencing ${rawResult.sourcesReferenced || 0} sources.`;
        extractedData = {
          topic: rawResult.topic,
          reportPreview: rawResult.report ? rawResult.report.slice(0, 300) + "..." : "",
        };
        break;

      case "memory.save":
        summary = `Verified fact "${rawResult.title}" committed to PostgreSQL long-term memory.`;
        extractedData = { memoryId: rawResult.memoryId, saved: true };
        break;

      default:
        summary = toolResult.success ? `Successfully executed ${toolName}.` : `Tool ${toolName} encountered an error.`;
        extractedData = toolResult.result;
        break;
    }

    const observationPayload: AgentObservationPayload = {
      url,
      title,
      summary,
      extractedData,
      metadata: { toolName, success: toolResult.success },
    };

    // Persist AgentObservation in PostgreSQL
    if (context.runId) {
      try {
        const observation = await prisma.agentObservation.create({
          data: {
            agentRunId: context.runId,
            agentStepId: context.stepId,
            url: sanitizeForDb(url),
            title: sanitizeForDb(title),
            summary: sanitizeForDb(summary),
            extractedData: sanitizeForDb(extractedData) as any,
            metadata: sanitizeForDb(observationPayload.metadata) as any,
          },
        });

        wsManager.broadcast(
          "agent.observationCreated",
          {
            observationId: observation.id,
            taskId: context.taskId,
            runId: context.runId,
            stepId: context.stepId,
            observation: observationPayload,
          },
          { userId: context.userId, workspaceId: context.workspaceId }
        );

        wsManager.broadcast(
          "agent.observation",
          {
            observationId: observation.id,
            taskId: context.taskId,
            runId: context.runId,
            stepId: context.stepId,
            observation: observationPayload,
          },
          { userId: context.userId, workspaceId: context.workspaceId }
        );
      } catch (err: any) {
        if (err?.code !== "P2003" && err?.code !== "P2025") {
          console.warn("[AgentObserver] Could not persist AgentObservation:", err);
        }
      }
    }

    return observationPayload;
  }
}
