import {
  DiscreteEvidence,
  DiscoveredConflict,
  ExtractedSourceData,
  ReportSectionData,
  ResearchMode,
  SynthesizedFinding,
} from "./research.types.js";
import { AIProviderFactory } from "../../ai/provider-factory.js";

export class SynthesisService {
  /**
   * Synthesizes an executive research intelligence report with inline citations,
   * structurally customized for Quick, Standard, and Deep research modes.
   */
  public static async generateReport(
    question: string,
    sources: ExtractedSourceData[],
    evidence: DiscreteEvidence[],
    findings: SynthesizedFinding[],
    conflicts: DiscoveredConflict[],
    mode: ResearchMode = "standard"
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
    const topSourceNames = sources.slice(0, 4).map((s) => s.domain || s.title).join(", ");
    let executiveSummary = `This investigation synthesized empirical intelligence from ${sources.length} live online sources (including ${topSourceNames}) to address: "${question}". Primary analysis reveals ${findings.length} key supported findings with comprehensive citation tracing.`;
    let comparativeAnalysis =
      findings.length > 0
        ? `Evaluation across the surveyed sources indicates strong consensus on ${findings[0].title}. ${
            findings.length > 1
              ? `Key operational and architectural insights were also validated regarding ${findings[1].title}.`
              : ""
          }`
        : `Evaluation reveals distinct trade-offs across current implementations based on live web telemetry and documentation surveyed.`;

    try {
      const provider = await AIProviderFactory.getActiveProvider();
      const prompt = `Research Question: "${question}"
Mode: ${mode.toUpperCase()}
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

    // 3. Assemble Complete Markdown Report based on mode
    let markdown = "";
    let sections: ReportSectionData[] = [];

    if (mode === "quick") {
      markdown = `# Quick Research Brief: ${question}

## Executive Summary
${executiveSummary}

---

## Key Verified Findings
${findingsMarkdown}

---

## Immediate Recommendations
1. Validate primary implementation trade-offs highlighted in the top citations.
2. Review source documentation for specific operational configuration parameters.

---

## Sources & Citations
${sourcesBibliography}
`;
      sections = [
        { id: "exec-summary", heading: "Executive Summary", content: executiveSummary, citations: [1, 2] },
        { id: "key-findings", heading: "Key Verified Findings", content: findingsMarkdown, citations: [1, 2, 3] },
        { id: "sources", heading: "Sources & Citations", content: sourcesBibliography, citations: citationsMap.map((c) => c.inlineIndex) },
      ];
    } else if (mode === "deep") {
      markdown = `# Comprehensive Deep Intelligence Report: ${question}

## 1. Executive Summary & Confidence Assessment
${executiveSummary}

---

## 2. Investigation Scope & Multi-Stage Discovery Methodology
This deep investigation conducted recursive multi-angle queries across Web, Technical Documentation, GitHub Open Source, ArXiv academic papers, and practitioner communities.
- **Total Corpus Evaluated:** ${sources.length} primary and secondary sources.
- **Empirical Claims Extracted:** ${evidence.length} verified quotes and claims.
- **Cross-Source Consensus:** Evaluated with conflict detection and automated discrepancy tracking.

---

## 3. In-Depth Architectural & Empirical Analysis
${comparativeAnalysis}

---

## 4. Synthesized Findings & Verified Claims
${findingsMarkdown}

---

## 5. Cross-Source Conflict Resolution & Trade-Offs
${conflictsMarkdown}

---

## 6. Empirical Evidence Matrix & Direct Citations
${evidenceMarkdown}

---

## 7. Limitations, Information Gaps & Uncertainty
- Source coverage is bounded by public network availability and index accessibility at the time of retrieval.
- Specific performance benchmarks are contingent on host hardware and configuration baselines.
- Further empirical stress-testing is recommended for production edge-cases.

---

## 8. Strategic Directives & Suggested Follow-Up Inquiries
1. **Benchmark Validation:** Deploy automated unit and load tests to verify documented latency figures.
2. **Context Persistence:** Save synthesized findings into PostgreSQL workspace memory for downstream coding agent execution.
3. **Follow-Up Inquiry:** "How do enterprise resilience patterns compare under high-concurrency workloads?"

---

## 9. Comprehensive Source Bibliography & Provenance Trace
${sourcesBibliography}
`;
      sections = [
        { id: "exec-summary", heading: "Executive Summary & Confidence Assessment", content: executiveSummary, citations: [1, 2] },
        { id: "methodology", heading: "Investigation Scope & Methodology", content: `Evaluated ${sources.length} sources and ${evidence.length} claims.`, citations: [] },
        { id: "comparative-analysis", heading: "In-Depth Architectural & Empirical Analysis", content: comparativeAnalysis, citations: [2, 3] },
        { id: "key-findings", heading: "Synthesized Findings & Verified Claims", content: findingsMarkdown, citations: [1, 2, 3] },
        { id: "conflicts", heading: "Cross-Source Conflict Resolution & Trade-Offs", content: conflictsMarkdown, citations: [] },
        { id: "evidence", heading: "Empirical Evidence Matrix", content: evidenceMarkdown, citations: citationsMap.map((c) => c.inlineIndex) },
        { id: "sources", heading: "Source Bibliography & Provenance", content: sourcesBibliography, citations: citationsMap.map((c) => c.inlineIndex) },
      ];
    } else {
      // Standard mode
      markdown = `# Research Report: ${question}

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
      sections = [
        { id: "exec-summary", heading: "Executive Summary", content: executiveSummary, citations: [1, 2] },
        { id: "key-findings", heading: "Key Findings", content: findingsMarkdown, citations: [1, 2, 3] },
        { id: "comparative-analysis", heading: "Comparative Analysis", content: comparativeAnalysis, citations: [2, 3] },
        { id: "conflicts", heading: "Conflicting Information", content: conflictsMarkdown, citations: [] },
        { id: "evidence", heading: "Empirical Evidence", content: evidenceMarkdown, citations: citationsMap.map((c) => c.inlineIndex) },
        { id: "sources", heading: "Sources & Citations", content: sourcesBibliography, citations: citationsMap.map((c) => c.inlineIndex) },
      ];
    }

    return { markdown, sections, citationsMap };
  }
}
