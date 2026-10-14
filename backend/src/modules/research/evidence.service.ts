import { DiscreteEvidence, ExtractedSourceData } from "./research.types.js";
import { AIProviderFactory } from "../../ai/provider-factory.js";

export class EvidenceService {
  /**
   * Extracts discrete evidence claims directly mapped to source sections and URLs.
   */
  public static async extractEvidence(
    question: string,
    sources: ExtractedSourceData[]
  ): Promise<DiscreteEvidence[]> {
    const perSourceResults: DiscreteEvidence[][] = [];
    const queryTerms = question
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 3);

    for (const src of sources) {
      const list: DiscreteEvidence[] = [];

      // Extract high-value sentences from source content
      const sentences = src.content
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 45 && s.length < 320 && !s.includes("cookie") && !s.includes("javascript"));

      // Score sentences by relevance to question terms
      const scored = sentences.map((s) => {
        const lower = s.toLowerCase();
        let score = 0;
        for (const term of queryTerms) {
          if (lower.includes(term)) score += 2;
        }
        if (s.length > 70 && s.length < 200) score += 1;
        return { text: s, score };
      });

      scored.sort((a, b) => b.score - a.score);

      const topSentences = scored.slice(0, 3).map((item) => item.text);
      // Fallback to first sentences if no term matches
      const chosen = topSentences.length > 0 ? topSentences : sentences.slice(0, 2);

      for (let i = 0; i < chosen.length; i++) {
        const text = chosen[i];
        const heading = src.headings[i % (src.headings.length || 1)] || "Core Finding";
        list.push({
          claim: text.length > 100 ? `${text.slice(0, 97).trim()}...` : text,
          evidenceText: text,
          location: heading,
          sourceUrl: src.url,
          sourceTitle: src.title,
        });
      }

      perSourceResults.push(list);
    }

    return perSourceResults.flat();
  }
}
