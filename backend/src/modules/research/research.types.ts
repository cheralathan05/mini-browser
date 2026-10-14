export type ResearchMode = "quick" | "standard" | "deep";

export interface ResearchModeConfig {
  sourceLimit: number;
  depth: number;
  timeBudgetSeconds: number;
  includeAcademic: boolean;
  includeGitHub: boolean;
  includeNews: boolean;
}

export const RESEARCH_MODE_PRESETS: Record<ResearchMode, ResearchModeConfig> = {
  quick: {
    sourceLimit: 6,
    depth: 1,
    timeBudgetSeconds: 20,
    includeAcademic: false,
    includeGitHub: true,
    includeNews: true,
  },
  standard: {
    sourceLimit: 12,
    depth: 2,
    timeBudgetSeconds: 40,
    includeAcademic: true,
    includeGitHub: true,
    includeNews: true,
  },
  deep: {
    sourceLimit: 20,
    depth: 3,
    timeBudgetSeconds: 90,
    includeAcademic: true,
    includeGitHub: true,
    includeNews: true,
  },
};

export interface ResearchObjective {
  id: string;
  title: string;
  description?: string;
  status: "pending" | "active" | "completed";
  order: number;
}

export interface DiscoveredSource {
  url: string;
  title: string;
  domain: string;
  sourceType: "web" | "paper" | "docs" | "github" | "news";
  snippet?: string;
}

export interface ExtractedSourceData {
  url: string;
  title: string;
  domain: string;
  sourceType: string;
  headings: string[];
  content: string;
  summary: string;
  contentHash: string;
  length: number;
}

export interface DiscreteEvidence {
  claim: string;
  evidenceText: string;
  location?: string;
  sourceUrl: string;
  sourceTitle: string;
}

export interface SynthesizedFinding {
  title: string;
  summary: string;
  claim: string;
  confidence: number;
  status: "SUPPORTED" | "PARTIALLY_SUPPORTED" | "CONFLICTING" | "UNSUPPORTED";
  supportingSourceUrls: string[];
}

export interface DiscoveredConflict {
  topic: string;
  perspectives: Array<{
    claim: string;
    sourceTitle: string;
    sourceUrl: string;
  }>;
  analysis: string;
}

export interface ReportSectionData {
  id: string;
  heading: string;
  content: string;
  citations: number[];
}

export interface ResearchProgressEvent {
  projectId: string;
  runId?: string;
  status: string;
  progress: number; // 0 to 100
  elapsedSeconds: number;
  message: string;
  sourceCount?: number;
  evidenceCount?: number;
  findingsCount?: number;
  currentSource?: { url: string; title: string };
  sources?: any[];
  error?: string;
}
