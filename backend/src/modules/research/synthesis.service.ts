import {
  DiscreteEvidence,
  DiscoveredConflict,
  ExtractedSourceData,
  ReportSectionData,
  SynthesizedFinding,
} from "./research.types.js";
import { AIProviderFactory } from "../../ai/provider-factory.js";

export class SynthesisService {
  /**
   * Synthesizes an executive research intelligence report with inline citations.
   */
  public static async generateReport(
    question: string,
    sources: ExtractedSourceData[],
    evidence: DiscreteEvidence[],
    findings: SynthesizedFinding[],
    conflicts: DiscoveredConflict[]
  ): Promise<{
    markdown: string;
    sections: ReportSectionData[];
    citationsMap: Array<{ inlineIndex: number; sourceUrl: string; claim?: string }>;
  }> {
    // 1. Build Citation Index
    const citationsMap: Array<{ inlineIndex: number; sourceUrl: string; claim?: string }> = sources.map(
      (src, idx) => ({
        inlineIndex: idx + 1,
        sourceUrl: src.url,
        claim: src.title,
      })
    );

    const sourcesBibliography = sources
      .map((s, idx) => `[${idx + 1}] [${s.title}](${s.url}) — ${s.domain} (${s.sourceType})`)
      .join("\n");

    const findingsMarkdown = findings
      .map(
        (f, idx) =>
          `### ${idx + 1}. ${f.title}\n**Claim:** ${f.claim}\n\n${f.summary}\n*Confidence: ${(f.confidence * 100).toFixed(
            0
          )}% • Status: ${f.status}*`
      )
      .join("\n\n");

    const evidenceMarkdown = evidence
      .map((e) => {
        const matchingCitation = citationsMap.find((c) => c.sourceUrl === e.sourceUrl);
        const citePill = matchingCitation ? `[${matchingCitation.inlineIndex}]` : "";
        return `- **${e.claim}** ${citePill}\n  > "${e.evidenceText}" — *Section: ${e.location || "General"}*`;
      })
      .join("\n");

    const conflictsMarkdown =
      conflicts.length > 0
        ? conflicts
            .map(
              (c) =>
                `#### Discrepancy: ${c.topic}\n${c.perspectives
                  .map((p) => `- **${p.sourceTitle}:** ${p.claim}`)
                  .join("\n")}\n\n**Synthesis & Uncertainty:** ${c.analysis}`
            )
            .join("\n\n")
        : "_No unresolved conflicting factual statements detected across the surveyed sources._";

    // 2. Draft Executive Summary and Comparative Analysis via AI or structured composition
    const topSourceNames = sources.slice(0, 4).map(s => s.domain || s.title).join(", ");
    let executiveSummary = `This investigation synthesized empirical intelligence from ${sources.length} live online sources (including ${topSourceNames}) to address: "${question}". Primary analysis reveals ${findings.length} key supported findings with comprehensive citation tracing.`;
    let comparativeAnalysis = findings.length > 0
      ? `Evaluation across the surveyed sources indicates strong consensus on ${findings[0].title}. ${findings.length > 1 ? `Key operational and architectural insights were also validated regarding ${findings[1].title}.` : ""}`
      : `Evaluation reveals distinct trade-offs across current implementations based on live web telemetry and documentation surveyed.`;

    try {
      const provider = await AIProviderFactory.getActiveProvider();
      const prompt = `Research Question: "${question}"
Key Findings:
${findingsMarkdown}

Discrepancies:
${conflictsMarkdown}

Write an Executive Summary (2 paragraphs) and a Comparative Analysis (2 paragraphs) in clean Markdown.
Format response as:
=== EXECUTIVE SUMMARY ===
...
=== COMPARATIVE ANALYSIS ===
...`;

      const aiResponse = await provider.generate(prompt, {
        systemPrompt: "You are the NEXUS Principal Research Analyst. Produce objective, evidence-grounded prose.",
        temperature: 0.25,
        timeout: 45000,
        maxTokens: 800,
      });

      if (aiResponse.includes("=== EXECUTIVE SUMMARY ===")) {
        const parts = aiResponse.split("=== COMPARATIVE ANALYSIS ===");
        const execPart = parts[0].replace("=== EXECUTIVE SUMMARY ===", "").trim();
        const compPart = parts[1]?.trim();
        if (execPart) executiveSummary = execPart;
        if (compPart) comparativeAnalysis = compPart;
      }
    } catch (err: any) {
      console.warn("[synthesis.service] AI generation notice:", err.message);
    }

    // 3. Assemble Complete Markdown Report
    const markdown = `# Research Report: ${question}

## Executive Summary
${executiveSummary}

---

## Key Findings
${findingsMarkdown}

---

## Comparative Analysis
${comparativeAnalysis}

---

## Conflicting Information & Trade-offs
${conflictsMarkdown}

---

## Empirical Evidence & Quotes
${evidenceMarkdown}

---

## Limitations & Unknowns
- Source coverage is bounded by public network availability and index accessibility at the time of retrieval.
- Specific performance metrics are contingent on target environment configurations and hardware specifications.

---

## Recommendations & Next Steps
1. Align architectural selection with primary workload constraints (e.g. latency vs. state persistence).
2. Establish automated validation benchmarks using isolated sandbox instances.
3. Integrate contextual findings into long-term workspace memory for downstream agent execution.

---

## Sources & Citations
${sourcesBibliography}
`;

    // 4. Structured Sections for Database persistence
    const sections: ReportSectionData[] = [
      { id: "exec-summary", heading: "Executive Summary", content: executiveSummary, citations: [1, 2] },
      { id: "key-findings", heading: "Key Findings", content: findingsMarkdown, citations: [1, 2, 3] },
      { id: "comparative-analysis", heading: "Comparative Analysis", content: comparativeAnalysis, citations: [2, 3] },
      { id: "conflicts", heading: "Conflicting Information", content: conflictsMarkdown, citations: [] },
      { id: "evidence", heading: "Empirical Evidence", content: evidenceMarkdown, citations: citationsMap.map((c) => c.inlineIndex) },
      { id: "sources", heading: "Sources & Citations", content: sourcesBibliography, citations: citationsMap.map((c) => c.inlineIndex) },
    ];

    return { markdown, sections, citationsMap };
  }
}
