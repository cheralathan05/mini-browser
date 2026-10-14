import { AIContextPayload, PageContext } from "./ai.types.js";

const MAX_PAGE_CHARS = 2500;
const MAX_SELECTION_CHARS = 2000;

export class ContextExtractor {
  public static sanitizeText(input: string): string {
    if (!input) return "";
    return input
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  public static normalizePageContext(raw: any): PageContext {
    const url = typeof raw?.url === "string" ? raw.url : undefined;
    const title = typeof raw?.title === "string" ? raw.title.slice(0, 200) : "Active Page";
    const favicon = typeof raw?.favicon === "string" ? raw.favicon : undefined;

    let selectedText = "";
    if (typeof raw?.selectedText === "string" && raw.selectedText.trim()) {
      selectedText = raw.selectedText.trim().slice(0, MAX_SELECTION_CHARS);
    }

    let content = "";
    if (typeof raw?.content === "string" && raw.content.trim()) {
      content = this.sanitizeText(raw.content).slice(0, MAX_PAGE_CHARS);
    }

    return {
      type: "page",
      url,
      title,
      favicon,
      selectedText: selectedText || undefined,
      content: content || undefined,
      metadata: typeof raw?.metadata === "object" ? raw.metadata : undefined,
    };
  }

  public static normalizeContext(raw: any): AIContextPayload {
    if (!raw || typeof raw !== "object") {
      return { type: "general" };
    }

    if (raw.type === "selection" || (raw.selectedText && !raw.content)) {
      return {
        type: "selection",
        text: (raw.text || raw.selectedText || "").slice(0, MAX_SELECTION_CHARS),
        url: raw.url,
        title: raw.title,
      };
    }

    if (raw.type === "research") {
      return {
        type: "research",
        projectId: raw.projectId,
        question: raw.question,
        sourceCount: raw.sourceCount,
        findingsCount: raw.findingsCount,
        recentFindings: Array.isArray(raw.recentFindings) ? raw.recentFindings.slice(0, 5) : undefined,
      };
    }

    if (raw.type === "task") {
      return {
        type: "task",
        taskId: raw.taskId,
        title: raw.title,
        goal: raw.goal,
        status: raw.status,
      };
    }

    return this.normalizePageContext(raw);
  }
}
