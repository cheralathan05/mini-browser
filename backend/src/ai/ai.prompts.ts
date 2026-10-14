import { AIContextPayload } from "./ai.types.js";

// /no_think is a qwen3-series soft directive that disables extended thinking mode
// at the prompt level. It works on all Ollama versions (unlike the API-level think:false
// flag which requires Ollama ≥0.7). Prepending it to the system prompt ensures
// qwen3:8b responds immediately instead of running a hidden reasoning pass first.
export const NEXUS_SYSTEM_PROMPT = `You are NEXUS, an AI intelligence layer embedded inside a next-generation browser operating system.

Core Operational Directives:
1. Context Fidelity: Ground your response strictly in the supplied context (active webpage, selected text, research findings, and memory) when relevant.
2. Honest Attribution: Distinguish clearly between:
   - Current page information
   - Saved personal memory
   - Active research project data
   - General world knowledge
3. Zero Fabrication:
   - Never claim to have visited pages or executed tools that were not actually supplied.
   - Never fabricate browser actions, sources, or citations.
4. Precision & Tone:
   - Deliver crisp, insightful, and well-structured answers.
   - Use clean Markdown with headers, bullet points, and syntax-highlighted code blocks where appropriate.
   - Be concise and direct unless the user requests deep architectural depth.
5. Autonomous Coding Directives:
   - When asked to solve, write code for, or implement a problem from a coding platform (LeetCode, HackerRank, Codeforces, online compiler, etc.), generate the complete, correct, optimal solution that directly satisfies the problem and matches the starter function signature.
   - Wrap the solution code in a fenced code block with the appropriate language tag (e.g. \`\`\`python, \`\`\`cpp, \`\`\`java, \`\`\`javascript).
   - Include explicit Time Complexity and Space Complexity lines (e.g. 'Time Complexity: O(N)', 'Space Complexity: O(1)').`;

export function buildContextPrompt(
  context: AIContextPayload | null | undefined,
  memories: Array<{ key: string; content: string; type: string }> = [],
  researchData?: { question?: string; findings?: string[]; sources?: string[] }
): string {
  const sections: string[] = [];

  // 1. High-priority selected text
  if (context && "selectedText" in context && context.selectedText) {
    sections.push(`=== HIGHEST PRIORITY: USER SELECTED TEXT ===\n"${context.selectedText}"\n`);
  } else if (context && context.type === "selection" && context.text) {
    sections.push(`=== HIGHEST PRIORITY: USER SELECTED TEXT ===\n"${context.text}"\n`);
  }

  // 2. Active Webpage context
  if (context && context.type === "page") {
    const pageHeader = `=== ACTIVE BROWSER TAB CONTEXT ===
URL: ${context.url || "local"}
Page Title: ${context.title || "Active Page"}`;

    const contentSnippet = context.content ? `\nPage Excerpt:\n${context.content}` : "";
    sections.push(`${pageHeader}${contentSnippet}\n`);
  }

  // 3. Relevant Memories from PostgreSQL
  if (memories && memories.length > 0) {
    const memoryItems = memories
      .map((m, idx) => `[Memory ${idx + 1}] (${m.type}) ${m.key}: ${m.content}`)
      .join("\n");
    sections.push(`=== RELEVANT PERSISTENT MEMORIES ===\n${memoryItems}\n`);
  }

  // 4. Research Context if available
  if (researchData && (researchData.question || (researchData.findings && researchData.findings.length > 0))) {
    let researchBlock = `=== ACTIVE RESEARCH PROJECT CONTEXT ===\n`;
    if (researchData.question) researchBlock += `Research Inquiry: ${researchData.question}\n`;
    if (researchData.findings && researchData.findings.length > 0) {
      researchBlock += `Key Findings:\n${researchData.findings.map((f, i) => `• ${f}`).join("\n")}\n`;
    }
    sections.push(researchBlock);
  }

  // 5. Task context
  if (context && context.type === "task") {
    sections.push(`=== ACTIVE TASK CONTEXT ===
Task: ${context.title || "Untitled"}
Goal: ${context.goal || "None specified"}
Status: ${context.status || "pending"}\n`);
  }

  return sections.join("\n");
}
