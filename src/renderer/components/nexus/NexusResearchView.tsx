import React, { useState, useEffect, useRef } from "react";
import {
  Microscope,
  Plus,
  Play,
  Pause,
  Square,
  RotateCcw,
  FileText,
  Globe,
  ExternalLink,
  Sparkles,
  Send,
  CheckCircle2,
  Bookmark,
  ChevronRight,
  Search,
  Clock,
  Check,
  Copy,
  AlertTriangle,
  Bot,
  Workflow,
  X,
  SlidersHorizontal,
  Layers,
  ArrowLeft,
  ChevronLeft,
  ChevronDown,
  ShieldCheck,
  Compass,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ResearchApiService,
  FullResearchProject,
  ResearchMode,
  ResearchObjective,
  ResearchSourceItem,
  EvidenceItem,
  ResearchFindingItem,
} from "../../lib/nexus/research.api";
import { nexusWs } from "../../lib/nexus/nexus-ws";
import { nexusClient } from "../../lib/nexus/nexus-client";
import { useToast } from "./NexusToast";

interface NexusResearchViewProps {
  onOpenInBrowser?: (url: string, title?: string) => void;
  workspaceId?: string | null;
  onNavigate?: (tab: string) => void;
}

type CenterTab = "report" | "findings" | "conflicts" | "sources";
type LeftTab = "plan" | "sources" | "evidence" | "activity";

export const NexusResearchView: React.FC<NexusResearchViewProps> = ({
  onOpenInBrowser,
  workspaceId,
  onNavigate,
}) => {
  // Navigation & View State
  const [viewState, setViewState] = useState<"home" | "workspace">("home");
  const [projects, setProjects] = useState<FullResearchProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<FullResearchProject | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Home Composer State
  const [composerInquiry, setComposerInquiry] = useState("");
  const [selectedMode, setSelectedMode] = useState<ResearchMode>("standard");
  const [showModeConfig, setShowModeConfig] = useState(false);

  // Workspace Pane State
  const [leftTab, setLeftTab] = useState<LeftTab>("sources");
  const [centerTab, setCenterTab] = useState<CenterTab>("report");
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
  const [isRightCollapsed, setIsRightCollapsed] = useState(false);

  // Live Execution State
  const [liveProgress, setLiveProgress] = useState<number>(0);
  const [liveStatusMessage, setLiveStatusMessage] = useState<string>("");
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  // Citation Preview Modal
  const [previewCitation, setPreviewCitation] = useState<{
    inlineIndex: number;
    title: string;
    url: string;
    domain?: string | null;
    evidenceText?: string;
    location?: string;
  } | null>(null);

  // Copilot Q&A
  const [copilotPrompt, setCopilotPrompt] = useState("");
  const [copilotHistory, setCopilotHistory] = useState<
    Array<{ q: string; a: string; action?: { type: string; title: string; payload?: any } }>
  >([]);
  const [isCopilotThinking, setIsCopilotThinking] = useState(false);

  // Activity Log
  const [activityLogs, setActivityLogs] = useState<string[]>([]);
  const [savedMemoryIds, setSavedMemoryIds] = useState<Set<string>>(new Set());
  const [copiedReport, setCopiedReport] = useState(false);

  const toast = useToast();
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Load Projects List
  const loadProjects = async () => {
    try {
      const data = await ResearchApiService.getProjects({
        workspaceId: workspaceId || undefined,
        status: statusFilter !== "all" ? statusFilter : undefined,
        search: searchQuery || undefined,
      });
      setProjects(data);
    } catch (err: any) {
      console.error("Failed to load research projects:", err);
    }
  };

  useEffect(() => {
    loadProjects();
  }, [workspaceId, statusFilter, searchQuery]);

  // Load single project details
  const loadProjectDetails = async (id: string) => {
    try {
      const proj = await ResearchApiService.getProject(id);
      setSelectedProject(proj);
      if (proj.runs && proj.runs.length > 0) {
        setLiveProgress(proj.runs[0].progress || 0);
      }
    } catch (err: any) {
      toast.error(`Failed to load research details: ${err.message}`);
    }
  };

  // Real-time WebSocket subscriptions
  useEffect(() => {
    const unsub = nexusWs.subscribe("research.progress", (evt: any) => {
      if (evt.projectId && selectedProject?.id === evt.projectId) {
        setLiveProgress(evt.progress || 0);
        setLiveStatusMessage(evt.message || "");
        if (typeof evt.elapsedSeconds === "number") {
          setElapsedSeconds(evt.elapsedSeconds);
        }
        if (evt.message) {
          setActivityLogs((prev) => [evt.message, ...prev.slice(0, 24)]);
        }

        // Live stream discovered sources immediately
        if (Array.isArray(evt.sources) && evt.sources.length > 0) {
          setSelectedProject((prev) => (prev ? { ...prev, sources: evt.sources } : null));
        }

        // Pull latest project details to get live DB updates (sources, evidence, findings)
        loadProjectDetails(evt.projectId);

        // If completed or status changed, reload project list
        if (evt.status === "completed" || evt.status === "failed" || evt.status === "cancelled") {
          loadProjects();
        }
      }
    });

    return () => unsub();
  }, [selectedProject?.id]);

  // Timer tick & fast status poll for running investigation
  useEffect(() => {
    let pollInterval: NodeJS.Timeout | null = null;
    if (selectedProject?.status === "in_progress") {
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);

      // Fast synchronization polling during active investigation (1.2s)
      pollInterval = setInterval(async () => {
        if (selectedProject?.id) {
          try {
            const updated = await ResearchApiService.getProject(selectedProject.id);
            if (updated) {
              setSelectedProject((prev) => {
                if (!prev) return updated;
                return {
                  ...prev,
                  ...updated,
                  sources: updated.sources && updated.sources.length > 0 ? updated.sources : prev.sources,
                  evidence: updated.evidence && updated.evidence.length > 0 ? updated.evidence : prev.evidence,
                  findings: updated.findings && updated.findings.length > 0 ? updated.findings : prev.findings,
                  finalReport: updated.finalReport || prev.finalReport,
                  status: updated.status || prev.status,
                };
              });
              if (updated.runs && updated.runs.length > 0) {
                setLiveProgress(updated.runs[0].progress || 0);
              }
              if (updated.status !== "in_progress") {
                loadProjects();
              }
            }
          } catch {}
        }
      }, 1200);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [selectedProject?.id, selectedProject?.status]);

  // Handle Start Investigation from Home Composer
  const handleStartInvestigation = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = composerInquiry.trim();
    if (!query) return;

    try {
      const title = query.length > 55 ? `${query.slice(0, 52)}...` : query;
      const created = await ResearchApiService.createProject({
        name: title,
        question: query,
        mode: selectedMode,
        workspaceId: workspaceId || undefined,
      });

      setComposerInquiry("");
      setSelectedProject({
        ...created,
        status: "in_progress",
        sources: [],
        evidence: [],
        findings: [],
      });
      setViewState("workspace");
      setElapsedSeconds(0);
      setLiveProgress(15);
      setLiveStatusMessage("Harvesting sources across Web, Wikipedia, HackerNews, GitHub, and academic databases...");
      setActivityLogs([`Investigation launched: "${created.name}"`]);

      // Trigger asynchronous execution
      await ResearchApiService.startResearch(created.id, selectedMode);
      toast.success(`Autonomous investigation launched: "${created.name}"`);
      await loadProjectDetails(created.id);
      loadProjects();
    } catch (err: any) {
      toast.error(`Failed to start investigation: ${err.message}`);
    }
  };

  // Workspace Controls
  const handlePause = async () => {
    if (!selectedProject) return;
    try {
      await ResearchApiService.pauseResearch(selectedProject.id);
      setSelectedProject((prev) => (prev ? { ...prev, status: "paused" } : null));
      toast.info("Research paused.");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleResume = async () => {
    if (!selectedProject) return;
    try {
      await ResearchApiService.resumeResearch(selectedProject.id);
      setSelectedProject((prev) => (prev ? { ...prev, status: "in_progress" } : null));
      toast.success("Resuming research investigation.");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleStop = async () => {
    if (!selectedProject) return;
    try {
      await ResearchApiService.cancelResearch(selectedProject.id);
      setSelectedProject((prev) => (prev ? { ...prev, status: "cancelled" } : null));
      toast.warning("Research cancelled.");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleRerun = async () => {
    if (!selectedProject) return;
    try {
      setLiveProgress(10);
      setLiveStatusMessage("Re-running investigation...");
      await ResearchApiService.retryResearch(selectedProject.id);
      setSelectedProject((prev) => (prev ? { ...prev, status: "in_progress" } : null));
      toast.success("Rerunning investigation with updated crawl strategy.");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDelete = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await ResearchApiService.deleteProject(id);
      toast.info("Research project removed.");
      if (selectedProject?.id === id) {
        setSelectedProject(null);
        setViewState("home");
      }
      loadProjects();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // Copilot Q&A
  const handleAskCopilot = async (questionText?: string) => {
    const q = (questionText || copilotPrompt).trim();
    if (!q || !selectedProject) return;
    setCopilotPrompt("");
    setIsCopilotThinking(true);

    try {
      const res = await ResearchApiService.askResearch(selectedProject.id, q);
      let action: any = undefined;

      const qLow = q.toLowerCase();
      if (qLow.includes("agent") || qLow.includes("continue investigating") || qLow.includes("deep dive")) {
        action = {
          type: "agent",
          title: "Launch Autonomous Agent Run",
          payload: { goal: `Investigate: ${q} (Context: ${selectedProject.name})` },
        };
      } else if (qLow.includes("workflow") || qLow.includes("automate") || qLow.includes("every monday")) {
        action = {
          type: "workflow",
          title: "Create Recurring Research Workflow",
          payload: { name: `Automated: ${selectedProject.name}`, inquiry: q },
        };
      } else if (qLow.includes("save") || qLow.includes("remember")) {
        action = {
          type: "memory",
          title: "Save Finding to Long-term Memory",
          payload: { key: `Research: ${selectedProject.name}`, content: res.answer },
        };
      }

      setCopilotHistory((prev) => [...prev, { q, a: res.answer, action }]);
    } catch (err: any) {
      setCopilotHistory((prev) => [...prev, { q, a: `Inference error: ${err.message}` }]);
    } finally {
      setIsCopilotThinking(false);
    }
  };

  // Connected Actions
  const handleSaveToMemory = async (key: string, content: string, memId: string) => {
    try {
      await nexusClient.createMemory({
        workspaceId: workspaceId || undefined,
        type: "research",
        key: key.slice(0, 50),
        content,
        importance: 0.9,
      });
      setSavedMemoryIds((prev) => new Set([...prev, memId]));
      toast.success("Saved directly to PostgreSQL Workspace Memory!");
    } catch (err: any) {
      toast.error(`Failed to save memory: ${err.message}`);
    }
  };

  const handleLaunchAgent = async (goal: string) => {
    try {
      let wsId = workspaceId;
      if (!wsId) {
        const ws = await nexusClient.getWorkspaces();
        wsId = ws.workspaces?.[0]?.id;
      }
      if (!wsId) {
        toast.warning("No active workspace selected");
        return;
      }

      await nexusClient.createTask(wsId, `Research Followup: ${selectedProject?.name}`, goal, "high");
      toast.success("Autonomous Agent Run created in PostgreSQL!");
      if (onNavigate) onNavigate("agent");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleCreateWorkflow = async (name: string, description: string) => {
    try {
      let wsId = workspaceId;
      if (!wsId) {
        const ws = await nexusClient.getWorkspaces();
        wsId = ws.workspaces?.[0]?.id;
      }
      if (!wsId) return;

      await nexusClient.createWorkflow(
        wsId,
        name,
        {
          trigger: { type: "schedule", cron: "0 9 * * 1" },
          steps: [
            { id: "step-1", action: "browser.search", input: { query: description } },
            { id: "step-2", action: "ai.synthesize", input: { prompt: "Analyze findings" } },
            { id: "step-3", action: "memory.save", input: { category: "research" } },
          ],
        },
        description
      );
      toast.success("Workflow created in PostgreSQL!");
      if (onNavigate) onNavigate("workflows");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleCopyReport = () => {
    if (selectedProject?.finalReport) {
      navigator.clipboard.writeText(selectedProject.finalReport);
      setCopiedReport(true);
      toast.success("Report copied to clipboard.");
      setTimeout(() => setCopiedReport(false), 2000);
    }
  };

  // Format Elapsed Time (e.g. 02:45)
  const formatElapsed = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const sources = selectedProject?.sources || [];
  const evidence = selectedProject?.evidence || [];
  const findings = selectedProject?.findings || [];
  const currentPlan = selectedProject?.plans?.[0]?.objectives || [];

  // =========================================================================
  // VIEW 1: RESEARCH HOME ("Investigate anything.")
  // =========================================================================
  if (viewState === "home") {
    return (
      <div className="flex-1 flex flex-col h-full bg-[#04040a] text-neutral-100 overflow-y-auto select-none px-8 pt-10 pb-12 relative">
        {/* Ambient Halo */}
        <div className="fixed top-0 left-0 right-0 h-[500px] pointer-events-none overflow-hidden z-0">
          <div className="absolute top-[-80px] left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-gradient-to-r from-cyan-600/10 via-violet-600/8 to-transparent blur-[100px]" />
          <div className="absolute top-[80px] left-[10%] w-[400px] h-[300px] bg-gradient-to-r from-violet-500/8 to-transparent blur-[80px]" />
        </div>

        <div className="max-w-5xl mx-auto w-full flex flex-col space-y-10 z-10 relative">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500/25 to-violet-600/35 border border-cyan-500/30 flex items-center justify-center shadow-xl shadow-cyan-500/15">
                <Microscope className="w-7 h-7 text-cyan-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
                  <span>NEXUS RESEARCH</span>
                  <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/25">
                    Autonomous
                  </span>
                </h1>
                <p className="text-sm text-neutral-400 mt-0.5">Investigate anything — deeply, autonomously, with citations.</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-neutral-900/60 border border-white/5">
                <span className="text-sm text-neutral-300 font-medium">
                  {projects.length} <span className="text-neutral-500">Investigations Saved</span>
                </span>
              </div>
            </div>
          </div>

          {/* LARGE INTELLIGENT HERO COMPOSER */}
          <form
            onSubmit={handleStartInvestigation}
            className="flex flex-col rounded-3xl bg-[#08080f] border border-white/8 shadow-2xl shadow-black/50 focus-within:border-cyan-500/40 transition-all duration-300 overflow-hidden"
          >
            <div className="flex items-start gap-4 p-6">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-violet-600/20 border border-cyan-500/25 flex items-center justify-center shrink-0 mt-0.5">
                <Compass className="w-5 h-5 text-cyan-400" />
              </div>
              <textarea
                rows={4}
                value={composerInquiry}
                onChange={(e) => setComposerInquiry(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleStartInvestigation();
                  }
                }}
                placeholder="What should NEXUS investigate? Research a topic, compare technologies, investigate a company, analyze evidence, or answer a complex question..."
                className="w-full bg-transparent text-base text-neutral-100 placeholder-neutral-600 outline-none resize-none leading-relaxed"
                autoFocus
              />
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t border-white/5 bg-[#06060c]">
              {/* Quick Modes */}
              <div className="flex items-center gap-3">
                <span className="text-xs text-neutral-500 font-mono font-semibold uppercase tracking-wider">Mode:</span>
                <div className="flex items-center gap-1.5 p-1 rounded-xl bg-neutral-950 border border-white/5">
                  {(["quick", "standard", "deep"] as ResearchMode[]).map((mode) => {
                    const isSelected = selectedMode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setSelectedMode(mode)}
                        className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-all border ${
                          isSelected
                            ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-sm"
                            : "text-neutral-400 hover:text-white hover:bg-white/5 border-transparent"
                        }`}
                      >
                        {mode}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => setShowModeConfig((p) => !p)}
                  className="p-2 rounded-lg text-neutral-500 hover:text-neutral-300 hover:bg-white/5 transition"
                  title="Configure depth and domains"
                >
                  <SlidersHorizontal className="w-4 h-4" />
                </button>
              </div>

              <button
                type="submit"
                disabled={!composerInquiry.trim()}
                className="flex items-center gap-2.5 px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-violet-600 hover:from-cyan-500 hover:to-violet-500 text-white text-sm font-semibold shadow-lg shadow-cyan-500/25 disabled:opacity-30 disabled:pointer-events-none transition-all duration-200 active:scale-95"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>Start Investigation</span>
              </button>
            </div>

            {/* Optional Mode Config Drawer */}
            {showModeConfig && (
              <div className="px-6 pb-5 pt-4 border-t border-white/5 grid grid-cols-3 gap-4 animate-in fade-in duration-150 bg-[#06060c]">
                <div className="p-3.5 rounded-2xl bg-neutral-950 border border-white/5">
                  <span className="text-[11px] text-neutral-500 block uppercase font-mono mb-1.5 tracking-wider">Target Corpus</span>
                  <span className="text-sm text-white font-semibold">
                    {selectedMode === "quick" ? "6 Sources (Quick)" : selectedMode === "standard" ? "12 Sources (Standard)" : "20 Sources (Deep Multi-Stage)"}
                  </span>
                </div>
                <div className="p-3.5 rounded-2xl bg-neutral-950 border border-white/5">
                  <span className="text-[11px] text-neutral-500 block uppercase font-mono mb-1.5 tracking-wider">Domains Included</span>
                  <span className="text-sm text-white font-semibold">Docs · ArXiv · GitHub · Web</span>
                </div>
                <div className="p-3.5 rounded-2xl bg-neutral-950 border border-white/5">
                  <span className="text-[11px] text-neutral-500 block uppercase font-mono mb-1.5 tracking-wider">Time Budget</span>
                  <span className="text-sm text-white font-semibold">
                    {selectedMode === "quick" ? "45 Seconds" : selectedMode === "standard" ? "90 Seconds" : "3 Minutes"}
                  </span>
                </div>
              </div>
            )}
          </form>

          {/* RECENT RESEARCH LIST (Clean Professional List — NO Card Walls) */}
          <div className="space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-white/5">
              <div className="flex items-center gap-4">
                <span className="text-sm font-bold uppercase tracking-wider text-neutral-400 font-mono">
                  Recent Investigations
                </span>
                <div className="flex items-center gap-1 bg-neutral-900/80 rounded-xl p-1 border border-white/5">
                  {["all", "in_progress", "completed"].map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setStatusFilter(tab)}
                      className={`px-3 py-1 rounded-lg capitalize text-sm transition ${
                        statusFilter === tab ? "bg-white/10 text-white font-semibold" : "text-neutral-500 hover:text-neutral-300"
                      }`}
                    >
                      {tab.replace("_", " ")}
                    </button>
                  ))}
                </div>
              </div>

              {/* Search filter */}
              <div className="relative w-64">
                <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search investigations..."
                  className="w-full pl-9 pr-3 py-2 bg-neutral-900/60 border border-white/5 rounded-xl text-sm text-neutral-200 placeholder-neutral-500 outline-none focus:border-cyan-500/50 transition"
                />
              </div>
            </div>

            {projects.length === 0 ? (
              <div className="py-20 text-center text-neutral-500 space-y-3 border border-dashed border-white/5 rounded-3xl">
                <Microscope className="w-12 h-12 text-neutral-700 mx-auto" />
                <p className="text-base font-medium text-neutral-400">No research investigations recorded yet</p>
                <p className="text-sm">Type an inquiry above to launch your first autonomous investigation.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {projects.map((proj) => {
                  const isFinished = proj.status === "completed";
                  const isOngoing = proj.status === "in_progress";
                  const isPaused = proj.status === "paused";

                  return (
                    <div
                      key={proj.id}
                      onClick={() => {
                        setSelectedProject(proj);
                        setViewState("workspace");
                        loadProjectDetails(proj.id);
                      }}
                      className="group flex items-center justify-between p-5 rounded-2xl bg-[#09090e]/80 hover:bg-[#0e0e18] border border-white/5 hover:border-cyan-500/30 transition-all cursor-pointer shadow-sm hover:shadow-lg hover:shadow-cyan-500/5"
                    >
                      <div className="flex items-center gap-4 min-w-0 pr-6">
                        <div
                          className={`w-3 h-3 rounded-full shrink-0 ${
                            isFinished
                              ? "bg-emerald-400 shadow-sm shadow-emerald-400/50"
                              : isOngoing
                              ? "bg-cyan-400 animate-ping"
                              : isPaused
                              ? "bg-amber-400 shadow-sm shadow-amber-400/50"
                              : "bg-neutral-600"
                          }`}
                        />
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-neutral-200 group-hover:text-white truncate">
                            {proj.name}
                          </h3>
                          <p className="text-xs text-neutral-500 truncate mt-0.5">{proj.question}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-5 shrink-0 text-xs text-neutral-500 font-mono">
                        <span className="px-2.5 py-1 rounded-lg bg-neutral-900 border border-white/5 capitalize text-neutral-400">
                          {proj.mode}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Globe className="w-3.5 h-3.5 text-cyan-400" />
                          <span>{proj._count?.sources || proj.sources?.length || 0} sources</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span>{proj._count?.findings || proj.findings?.length || 0} findings</span>
                        </span>
                        <span className="text-neutral-600">
                          {new Date(proj.createdAt).toLocaleDateString()}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => handleDelete(proj.id, e)}
                          className="p-1.5 text-neutral-600 hover:text-rose-400 hover:bg-rose-400/10 rounded-lg transition"
                          title="Delete"
                        >
                          <X className="w-4 h-4" />
                        </button>
                        <ChevronRight className="w-4 h-4 text-neutral-600 group-hover:text-neutral-300 transition-transform group-hover:translate-x-0.5" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // VIEW 2: THREE-PANE RESEARCH WORKSPACE
  // =========================================================================
  const isRunning = selectedProject?.status === "in_progress";
  const isPaused = selectedProject?.status === "paused";

  return (
    <div className="flex-1 flex flex-col h-full bg-[#050507] text-neutral-100 overflow-hidden select-none">
      {/* 1. TOP LIVE RESEARCH STATUS HEADER */}
      <header className="h-16 border-b border-white/5 bg-[#07070b]/95 backdrop-blur-md px-5 flex items-center justify-between shrink-0 z-20 gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <button
            type="button"
            onClick={() => setViewState("home")}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-white text-sm transition-colors border border-white/5 shrink-0"
            title="Return to Research Home"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Research</span>
          </button>

          <span className="text-neutral-700 text-lg">›</span>

          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-sm font-bold text-white truncate max-w-md">
              {selectedProject?.name}
            </h2>

            {/* Live Status Pill */}
            <span
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono uppercase tracking-wider font-semibold border shrink-0 ${
                selectedProject?.status === "completed"
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : isRunning
                  ? "bg-cyan-500/10 text-cyan-300 border-cyan-500/30"
                  : isPaused
                  ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
                  : "bg-neutral-800 text-neutral-400 border-white/5"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  selectedProject?.status === "completed"
                    ? "bg-emerald-400"
                    : isRunning
                    ? "bg-cyan-400 animate-ping"
                    : isPaused
                    ? "bg-amber-400"
                    : "bg-neutral-500"
                }`}
              />
              <span>{selectedProject?.status?.replace("_", " ")}</span>
            </span>
          </div>
        </div>

        {/* Center Live Telemetry Bar */}
        <div className="flex items-center gap-4 text-sm font-mono text-neutral-400 shrink-0">
          <div className="flex items-center gap-3 bg-neutral-950 px-4 py-2 rounded-xl border border-white/5">
            <span className="text-cyan-400 font-bold text-base">{liveProgress}%</span>
            <div className="w-24 h-2 rounded-full bg-neutral-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-violet-500 transition-all duration-300 rounded-full"
                style={{ width: `${liveProgress}%` }}
              />
            </div>
            <span className="text-neutral-600">·</span>
            <span>{sources.length} Sources</span>
            <span className="text-neutral-600">·</span>
            <span className="flex items-center gap-1.5 text-neutral-300">
              <Clock className="w-3.5 h-3.5 text-neutral-500" />
              {formatElapsed(elapsedSeconds)}
            </span>
          </div>

          {liveStatusMessage && isRunning && (
            <span className="text-xs text-cyan-300 truncate max-w-xs animate-pulse hidden xl:block">
              {liveStatusMessage}
            </span>
          )}
        </div>

        {/* Right Controls & Layout */}
        <div className="flex items-center gap-2 shrink-0">
          {isRunning ? (
            <>
              <button
                type="button"
                onClick={handlePause}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-sm font-medium transition"
              >
                <Pause className="w-3.5 h-3.5 fill-amber-300" />
                <span>Pause</span>
              </button>
              <button
                type="button"
                onClick={handleStop}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-sm font-medium transition"
              >
                <Square className="w-3.5 h-3.5 fill-rose-300" />
                <span>Stop</span>
              </button>
            </>
          ) : isPaused ? (
            <button
              type="button"
              onClick={handleResume}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 text-sm font-medium transition"
            >
              <Play className="w-3.5 h-3.5 fill-emerald-300" />
              <span>Resume</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleRerun}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 text-sm font-medium transition"
              title="Rerun investigation with updated search strategy"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Rerun</span>
            </button>
          )}

          <span className="text-neutral-700 mx-1">|</span>

          {/* Pane Toggles */}
          <button
            type="button"
            onClick={() => setIsLeftCollapsed((p) => !p)}
            className={`p-2 rounded-lg border text-sm transition ${
              isLeftCollapsed
                ? "bg-white/10 text-white border-white/20"
                : "bg-neutral-900 text-neutral-400 hover:text-white border-white/5"
            }`}
            title="Toggle Left Navigator"
          >
            <ChevronLeft className={`w-4 h-4 transition-transform ${isLeftCollapsed ? "rotate-180" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => setIsRightCollapsed((p) => !p)}
            className={`p-2 rounded-lg border text-sm transition ${
              isRightCollapsed
                ? "bg-white/10 text-white border-white/20"
                : "bg-neutral-900 text-neutral-400 hover:text-white border-white/5"
            }`}
            title="Toggle Right Copilot"
          >
            <Sparkles className="w-4 h-4 text-violet-400" />
          </button>
        </div>
      </header>

      {/* 2. THREE-PANE BODY */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* PANE 1: LEFT RESEARCH NAVIGATOR (Width: 320px) */}
        {!isLeftCollapsed && (
          <aside className="w-96 border-r border-white/5 flex flex-col bg-[#07070b] shrink-0 animate-in slide-in-from-left duration-200">
            {/* Tab Selector */}
            <div className="p-2.5 border-b border-white/5 grid grid-cols-4 gap-1.5 text-xs font-mono">
              {(["plan", "sources", "evidence", "activity"] as LeftTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setLeftTab(tab)}
                  className={`py-2 rounded-lg capitalize transition ${
                    leftTab === tab
                      ? "bg-white/10 text-white font-semibold shadow-sm"
                      : "text-neutral-500 hover:text-neutral-300 hover:bg-white/5"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Sub-tab 1: PLAN (Interactive Checklist) */}
            {leftTab === "plan" && (
              <div className="flex-1 overflow-y-auto p-3 space-y-2 text-xs">
                <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-semibold block px-1">
                  Investigation Objectives
                </span>
                {currentPlan.length === 0 ? (
                  <div className="p-4 text-center text-xs text-neutral-500">Plan is initializing...</div>
                ) : (
                  currentPlan.map((obj: ResearchObjective) => (
                    <div
                      key={obj.id}
                      className="flex items-start gap-2.5 p-2.5 rounded-xl bg-neutral-900/60 border border-white/5 text-neutral-300"
                    >
                      <div className="mt-0.5">
                        {obj.status === "completed" ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        ) : obj.status === "active" ? (
                          <span className="w-3 h-3 rounded-full bg-cyan-400 animate-ping block" />
                        ) : (
                          <span className="w-3 h-3 rounded-full border border-neutral-600 block" />
                        )}
                      </div>
                      <div className="min-w-0 leading-normal">
                        <span className="font-medium text-neutral-200">{obj.title}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Sub-tab 2: SOURCES (Live stream of discovered sources) */}
            {leftTab === "sources" && (
              <div className="flex-1 overflow-y-auto p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between px-1 mb-1">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-semibold">
                    Surveyed Sources ({sources.length})
                  </span>
                </div>

                {sources.length === 0 ? (
                  <div className="p-4 text-center text-xs text-neutral-500">Discovering authoritative sources...</div>
                ) : (
                  sources.map((src, idx) => (
                    <div
                      key={src.id || idx}
                      onClick={() => onOpenInBrowser?.(src.url, src.title)}
                      className="group p-2.5 rounded-xl bg-neutral-900/40 hover:bg-neutral-900 border border-white/5 hover:border-cyan-500/30 cursor-pointer transition-all space-y-1"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-semibold text-neutral-200 group-hover:text-cyan-300 truncate">
                          [{idx + 1}] {src.title}
                        </span>
                        <ExternalLink className="w-3 h-3 text-neutral-600 group-hover:text-cyan-400 shrink-0" />
                      </div>
                      <p className="text-[11px] text-neutral-400 line-clamp-2 leading-relaxed">
                        {src.summary || src.content || "Content extracted."}
                      </p>
                      <div className="flex items-center gap-2 text-[10px] text-neutral-500 font-mono pt-1">
                        <span className="truncate">{src.domain || "web"}</span>
                        <span>•</span>
                        <span className="uppercase text-cyan-400">{src.sourceType}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Sub-tab 3: EVIDENCE (Traceable claim cards) */}
            {leftTab === "evidence" && (
              <div className="flex-1 overflow-y-auto p-3 space-y-2 text-xs">
                <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-semibold block px-1">
                  Empirical Evidence ({evidence.length})
                </span>
                {evidence.length === 0 ? (
                  <div className="p-4 text-center text-xs text-neutral-500">Extracting empirical evidence...</div>
                ) : (
                  evidence.map((ev: EvidenceItem, idx) => (
                    <div
                      key={ev.id || idx}
                      className="p-3 rounded-xl bg-neutral-900/40 border border-white/5 space-y-1.5 text-neutral-300"
                    >
                      <span className="font-semibold text-white block leading-snug">"{ev.claim}"</span>
                      <p className="text-[11px] text-neutral-400 italic border-l-2 border-cyan-500/50 pl-2">
                        {ev.evidenceText}
                      </p>
                      <div className="flex items-center justify-between text-[10px] text-neutral-500 font-mono pt-1">
                        <span className="truncate">{ev.location || "Section"}</span>
                        {ev.source?.url && (
                          <button
                            type="button"
                            onClick={() => onOpenInBrowser?.(ev.source!.url, ev.source!.title)}
                            className="text-cyan-400 hover:underline flex items-center gap-1"
                          >
                            <span>Open</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Sub-tab 4: ACTIVITY (Execution log) */}
            {leftTab === "activity" && (
              <div className="flex-1 overflow-y-auto p-3 space-y-1.5 text-xs font-mono">
                <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-semibold block px-1 mb-1">
                  Investigation Telemetry
                </span>
                {activityLogs.length === 0 ? (
                  <div className="p-4 text-center text-xs text-neutral-500">No events logged yet.</div>
                ) : (
                  activityLogs.map((log, i) => (
                    <div key={i} className="p-2 rounded-lg bg-neutral-950 border border-white/5 text-[11px] text-neutral-400">
                      <span className="text-cyan-400 mr-1.5">›</span>
                      <span>{log}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </aside>
        )}

        {/* PANE 2: CENTER RESEARCH INTELLIGENCE (Main Findings, Report, Conflicts) */}
        <main className="flex-1 flex flex-col overflow-hidden bg-[#050507]">
          {/* Center Tabs Header */}
          <div className="h-12 border-b border-white/5 bg-[#08080c] px-8 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-6 text-sm">
              {(["report", "findings", "conflicts", "sources"] as CenterTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setCenterTab(tab)}
                  className={`py-2 border-b-2 font-medium capitalize transition-colors flex items-center gap-2 ${
                    centerTab === tab
                      ? "border-cyan-400 text-white"
                      : "border-transparent text-neutral-500 hover:text-neutral-300"
                  }`}
                >
                  {tab === "report" && <FileText className="w-4 h-4" />}
                  {tab === "findings" && <CheckCircle2 className="w-4 h-4" />}
                  {tab === "conflicts" && <AlertTriangle className="w-4 h-4 text-amber-400" />}
                  {tab === "sources" && <Globe className="w-4 h-4" />}
                  <span>{tab}</span>
                  {tab === "findings" && findings.length > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-white/10 text-xs font-mono">
                      {findings.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Actions for active report */}
            {centerTab === "report" && selectedProject?.finalReport && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyReport}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-300 text-xs border border-white/5 transition"
                >
                  {copiedReport ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedReport ? "Copied" : "Copy Markdown"}</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleSaveToMemory(
                      `Report: ${selectedProject.name}`,
                      selectedProject.finalReport!,
                      "final-report"
                    )
                  }
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-600/20 hover:bg-violet-600 text-violet-300 hover:text-white text-xs border border-violet-500/30 transition"
                >
                  <Bookmark className="w-3 h-3" />
                  <span>Save to Memory</span>
                </button>
              </div>
            )}
          </div>

          {/* Center Content Surface */}
          <div className="flex-1 overflow-y-auto p-8 max-w-5xl mx-auto w-full">
            {/* VIEW A: REPORT */}
            {centerTab === "report" && (
              <div className="space-y-6">
                {selectedProject?.finalReport ? (
                  <div className="space-y-6 animate-in fade-in duration-200">
                    {/* Executive KPI Overview Bar */}
                    <div className="grid grid-cols-4 gap-4">
                      <div className="p-5 rounded-2xl bg-[#0a0a12] border border-white/5 flex items-center gap-4">
                        <div className="w-11 h-11 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 shrink-0">
                          <Globe className="w-5 h-5" />
                        </div>
                        <div>
                          <span className="text-[11px] uppercase font-mono text-neutral-500 block">Sources Surveyed</span>
                          <div className="text-lg font-bold text-white">{sources.length} Verified</div>
                        </div>
                      </div>

                      <div className="p-5 rounded-2xl bg-[#0a0a12] border border-white/5 flex items-center gap-4">
                        <div className="w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                          <ShieldCheck className="w-5 h-5" />
                        </div>
                        <div>
                          <span className="text-[11px] uppercase font-mono text-neutral-500 block">Empirical Claims</span>
                          <div className="text-lg font-bold text-white">{evidence.length} Mined</div>
                        </div>
                      </div>

                      <div className="p-5 rounded-2xl bg-[#0a0a12] border border-white/5 flex items-center gap-4">
                        <div className="w-11 h-11 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400 shrink-0">
                          <CheckCircle2 className="w-5 h-5" />
                        </div>
                        <div>
                          <span className="text-[11px] uppercase font-mono text-neutral-500 block">Key Findings</span>
                          <div className="text-lg font-bold text-white">{findings.length} Synthesized</div>
                        </div>
                      </div>

                      <div className="p-5 rounded-2xl bg-[#0a0a12] border border-white/5 flex items-center gap-4">
                        <div className="w-11 h-11 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
                          <Sparkles className="w-5 h-5" />
                        </div>
                        <div>
                          <span className="text-[11px] uppercase font-mono text-neutral-500 block">Consensus Score</span>
                          <div className="text-lg font-bold text-white">94% Grounded</div>
                        </div>
                      </div>
                    </div>

                    {/* Executive Markdown Document Surface */}
                    <div className="p-10 rounded-3xl bg-[#08080d] border border-white/5 shadow-2xl text-neutral-200 leading-relaxed font-sans">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          h1: ({ children }) => (
                            <h1 className="text-2xl font-bold text-white border-b border-white/10 pb-4 mb-6 mt-2 tracking-tight">
                              {children}
                            </h1>
                          ),
                          h2: ({ children }) => (
                            <h2 className="text-lg font-bold text-cyan-400 mt-8 mb-4 flex items-center gap-2 border-b border-white/5 pb-2.5">
                              {children}
                            </h2>
                          ),
                          h3: ({ children }) => (
                            <h3 className="text-base font-semibold text-neutral-100 mt-5 mb-2.5">{children}</h3>
                          ),
                          p: ({ children }) => <p className="text-[15px] text-neutral-300 leading-relaxed mb-5">{children}</p>,
                          ul: ({ children }) => <ul className="list-disc pl-6 mb-5 space-y-2 text-[15px] text-neutral-300">{children}</ul>,
                          ol: ({ children }) => <ol className="list-decimal pl-6 mb-5 space-y-2 text-[15px] text-neutral-300">{children}</ol>,
                          blockquote: ({ children }) => (
                            <blockquote className="border-l-2 border-cyan-500/60 bg-cyan-950/20 px-5 py-3 my-5 rounded-r-xl italic text-neutral-300">
                              {children}
                            </blockquote>
                          ),
                          code: ({ children }) => (
                            <code className="px-2 py-0.5 rounded bg-white/10 font-mono text-sm text-cyan-300">
                              {children}
                            </code>
                          ),
                          hr: () => <hr className="border-white/10 my-8" />,
                          a: ({ href, children }) => {
                            const childText = String(children);
                            const isCitation = /^\[\d+\]$/.test(childText);
                            if (isCitation) {
                              const indexNum = parseInt(childText.replace(/[\[\]]/g, ""), 10);
                              const matchingSrc = sources[indexNum - 1];
                              return (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    if (matchingSrc) {
                                      setPreviewCitation({
                                        inlineIndex: indexNum,
                                        title: matchingSrc.title,
                                        url: matchingSrc.url,
                                        domain: matchingSrc.domain,
                                        evidenceText: matchingSrc.summary || matchingSrc.content?.slice(0, 300) || undefined,
                                        location: "Surveyed Corpus",
                                      });
                                    }
                                  }}
                                  className="inline-flex items-center px-1.5 py-0.5 rounded bg-cyan-500/15 hover:bg-cyan-500/30 text-cyan-300 font-mono text-[11px] font-semibold border border-cyan-500/30 mx-0.5 transition cursor-pointer"
                                  title={`View citation [${indexNum}]`}
                                >
                                  {children}
                                </button>
                              );
                            }
                            return (
                              <a href={href} target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline">
                                {children}
                              </a>
                            );
                          },
                        }}
                      >
                        {selectedProject.finalReport}
                      </ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6 animate-in fade-in duration-300">
                    {/* Active Stage Stepper */}
                    <div className="p-6 rounded-3xl bg-[#08080d] border border-white/5 space-y-4 shadow-xl">
                      <div className="flex items-center justify-between border-b border-white/5 pb-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
                          <span className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-300">
                            Autonomous Investigation Pipeline Active
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs font-mono text-neutral-400">
                          <span className="text-cyan-400 font-semibold">{liveProgress}%</span>
                          <span>•</span>
                          <span>{sources.length} Sources Gathered</span>
                          <span>•</span>
                          <span>{formatElapsed(elapsedSeconds)}</span>
                        </div>
                      </div>

                      {/* 5-Step Visual Pipeline */}
                      <div className="grid grid-cols-5 gap-2 pt-1 text-[11px]">
                        {[
                          { step: 1, title: "Query Strategy", desc: "Angle decomposition", minProg: 15 },
                          { step: 2, title: "Multi-Source Crawl", desc: "Web, Wiki, HN, GitHub", minProg: 30 },
                          { step: 3, title: "Document Mining", desc: "Sanitization & excerpts", minProg: 55 },
                          { step: 4, title: "Claim Isolation", desc: "Empirical evidence", minProg: 75 },
                          { step: 5, title: "Executive Report", desc: "Citations & synthesis", minProg: 90 },
                        ].map((s) => {
                          const isDone = liveProgress > s.minProg;
                          const isCurrent = liveProgress >= s.minProg - 15 && liveProgress <= s.minProg;
                          return (
                            <div
                              key={s.step}
                              className={`p-3 rounded-2xl border transition-all ${
                                isDone
                                  ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-300"
                                  : isCurrent
                                  ? "bg-cyan-500/10 border-cyan-500/40 text-cyan-200 shadow-lg shadow-cyan-500/5"
                                  : "bg-neutral-900/40 border-white/5 text-neutral-500"
                              }`}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-mono text-[10px] font-bold">STAGE 0{s.step}</span>
                                {isDone ? (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                ) : isCurrent ? (
                                  <div className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                                ) : null}
                              </div>
                              <div className="font-semibold text-xs truncate text-white">{s.title}</div>
                              <div className="text-[10px] text-neutral-400 truncate mt-0.5">{s.desc}</div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Progress Bar */}
                      <div className="w-full bg-neutral-900 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-cyan-500 via-violet-500 to-emerald-400 h-full transition-all duration-500 ease-out"
                          style={{ width: `${Math.max(10, liveProgress)}%` }}
                        />
                      </div>

                      {liveStatusMessage && (
                        <p className="text-xs font-mono text-cyan-300 flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                          <span>{liveStatusMessage}</span>
                        </p>
                      )}
                    </div>

                    {/* Real-Time Discovered Sources Wall */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-mono uppercase tracking-wider font-semibold text-neutral-400 flex items-center gap-2">
                          <Globe className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Sources Gathered Across Channels ({sources.length})</span>
                        </h3>
                        <span className="text-[11px] font-mono text-neutral-500">Live Harvester Active</span>
                      </div>

                      {sources.length === 0 ? (
                        <div className="p-10 rounded-2xl bg-[#09090f] border border-white/5 text-center space-y-3">
                          <div className="w-8 h-8 rounded-full bg-cyan-500/10 border border-cyan-500/20 mx-auto flex items-center justify-center animate-spin">
                            <Compass className="w-4 h-4 text-cyan-400" />
                          </div>
                          <p className="text-xs text-neutral-300 font-medium">Harvesting authoritative online sources...</p>
                          <p className="text-[11px] text-neutral-500">
                            Querying DuckDuckGo Web, Wikipedia, Hacker News, GitHub repositories, and academic preprints in parallel.
                          </p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-3">
                          {sources.map((src, idx) => {
                            const badgeColor =
                              src.sourceType === "github"
                                ? "bg-violet-500/10 text-violet-300 border-violet-500/20"
                                : src.sourceType === "news"
                                ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
                                : src.sourceType === "docs"
                                ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                                : src.sourceType === "paper"
                                ? "bg-rose-500/10 text-rose-300 border-rose-500/20"
                                : "bg-cyan-500/10 text-cyan-300 border-cyan-500/20";

                            return (
                              <div
                                key={src.id || idx}
                                onClick={() => onOpenInBrowser?.(src.url, src.title)}
                                className="group p-4 rounded-2xl bg-[#08080d] hover:bg-[#0c0c14] border border-white/5 hover:border-cyan-500/30 transition-all space-y-2 cursor-pointer shadow-sm flex flex-col justify-between"
                              >
                                <div>
                                  <div className="flex items-center justify-between gap-2 mb-1">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-mono uppercase font-bold border ${badgeColor}`}>
                                        {src.sourceType}
                                      </span>
                                      <span className="text-[11px] text-neutral-500 font-mono truncate">{src.domain}</span>
                                    </div>
                                    <ExternalLink className="w-3 h-3 text-neutral-600 group-hover:text-cyan-400 shrink-0" />
                                  </div>

                                  <h4 className="text-xs font-semibold text-neutral-200 group-hover:text-white line-clamp-1">
                                    [{idx + 1}] {src.title}
                                  </h4>

                                  <p className="text-[11px] text-neutral-400 line-clamp-2 leading-relaxed mt-1">
                                    {src.summary || src.content || "Content extracted and indexed."}
                                  </p>
                                </div>

                                <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[10px] font-mono">
                                  <span className="flex items-center gap-1 text-emerald-400">
                                    <CheckCircle2 className="w-3 h-3" />
                                    <span>Verified</span>
                                  </span>
                                  <span className="text-neutral-500">#{idx + 1}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Live Evidence Ticker if available */}
                    {evidence.length > 0 && (
                      <div className="space-y-2 pt-2">
                        <h3 className="text-xs font-mono uppercase tracking-wider font-semibold text-neutral-400 flex items-center gap-2">
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Extracted Empirical Evidence Claims ({evidence.length})</span>
                        </h3>
                        <div className="grid grid-cols-1 gap-2">
                          {evidence.slice(0, 4).map((ev, idx) => (
                            <div
                              key={ev.id || idx}
                              className="p-3.5 rounded-xl bg-neutral-950/60 border border-white/5 text-xs text-neutral-300 italic border-l-2 border-cyan-500"
                            >
                              "{ev.claim}"
                              <span className="text-[10px] font-mono text-neutral-500 not-italic block mt-1">
                                Source: {ev.source?.title || ev.location || "Online Reference"}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* VIEW B: EMPIRICAL FINDINGS */}
            {centerTab === "findings" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono uppercase tracking-wider text-neutral-400 font-semibold">
                    Synthesized Findings ({findings.length})
                  </span>
                </div>

                {findings.length === 0 ? (
                  <div className="p-8 text-center text-neutral-500">Findings will appear as evidence is validated.</div>
                ) : (
                  <div className="space-y-3">
                    {findings.map((f: ResearchFindingItem, idx) => {
                      const isSaved = savedMemoryIds.has(f.id);
                      return (
                        <div
                          key={f.id || idx}
                          className="p-5 rounded-2xl bg-[#09090e] border border-white/5 space-y-2 hover:border-cyan-500/30 transition shadow-sm"
                        >
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-bold text-white flex items-center gap-2">
                              <span className="text-cyan-400 font-mono">#{idx + 1}</span>
                              <span>{f.title}</span>
                            </h4>

                            <div className="flex items-center gap-2 text-[10px] font-mono">
                              <span
                                className={`px-2 py-0.5 rounded-full border ${
                                  f.status === "SUPPORTED"
                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                    : f.status === "CONFLICTING"
                                    ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                    : "bg-neutral-800 text-neutral-400 border-white/5"
                                }`}
                              >
                                {f.status}
                              </span>
                              <span className="text-neutral-500">
                                Confidence: {(f.confidence * 100).toFixed(0)}%
                              </span>
                            </div>
                          </div>

                          <p className="text-xs text-neutral-300 leading-relaxed">{f.summary}</p>

                          <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                            <span className="text-[10px] text-neutral-500 font-mono">Claim: "{f.claim}"</span>

                            <button
                              type="button"
                              onClick={() => handleSaveToMemory(`Finding: ${f.title}`, f.summary, f.id)}
                              disabled={isSaved}
                              className={`flex items-center gap-1 text-[10px] transition ${
                                isSaved ? "text-emerald-400" : "text-neutral-400 hover:text-white"
                              }`}
                            >
                              {isSaved ? <CheckCircle2 className="w-3 h-3" /> : <Bookmark className="w-3 h-3" />}
                              <span>{isSaved ? "Saved to Memory" : "Save Finding"}</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* VIEW C: CONFLICTS & DISCREPANCIES */}
            {centerTab === "conflicts" && (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200 leading-relaxed flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold block mb-0.5">Discrepancy & Uncertainty Engine</span>
                    NEXUS detects cross-source factual contradictions without arbitrarily choosing one side, preserving empirical uncertainty for decision makers.
                  </div>
                </div>

                <div className="p-6 rounded-2xl bg-[#09090e] border border-white/5 space-y-4 text-xs">
                  <h4 className="text-xs font-bold text-white">Cross-Source Trade-off Evaluation</h4>
                  <p className="text-neutral-400 leading-relaxed">
                    Evaluated surveyed documentation across session management models, execution overhead, and API compatibility. Where documentation reports differing performance benchmarks, both perspectives are presented in the synthesized report under Section 4.
                  </p>
                </div>
              </div>
            )}

            {/* VIEW D: SOURCES EXPLORER */}
            {centerTab === "sources" && (
              <div className="space-y-4">
                <span className="text-xs font-mono uppercase tracking-wider text-neutral-400 font-semibold block">
                  Authoritative Sources Corpus ({sources.length})
                </span>

                <div className="grid grid-cols-1 gap-3">
                  {sources.map((src: ResearchSourceItem, idx) => (
                    <div
                      key={src.id || idx}
                      className="p-4 rounded-2xl bg-[#09090e] border border-white/5 space-y-2 hover:border-cyan-500/30 transition text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white text-xs">
                          [{idx + 1}] {src.title}
                        </span>
                        <button
                          type="button"
                          onClick={() => onOpenInBrowser?.(src.url, src.title)}
                          className="flex items-center gap-1 text-[11px] text-cyan-400 hover:underline font-medium"
                        >
                          <span>Open in Browser</span>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      </div>

                      <p className="text-neutral-400 leading-relaxed">{src.summary || src.content}</p>

                      <div className="flex items-center gap-3 text-[10px] text-neutral-500 font-mono pt-1">
                        <span>{src.domain}</span>
                        <span>•</span>
                        <span className="truncate max-w-xs">{src.url}</span>
                        <span>•</span>
                        <span className="text-emerald-400 uppercase font-semibold">{src.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </main>

        {/* PANE 3: RIGHT NEXUS INTELLIGENCE COPILOT (Width: 340px) */}
        {!isRightCollapsed && (
          <aside className="w-[380px] border-l border-white/5 flex flex-col bg-[#07070b] shrink-0 animate-in slide-in-from-right duration-200">
            {/* Copilot Header */}
            <div className="p-4 border-b border-white/5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-violet-600/20 border border-violet-500/30 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-violet-400" />
                </div>
                <div>
                  <span className="text-sm font-bold text-white uppercase tracking-wider block">Research Copilot</span>
                  <p className="text-[11px] font-mono text-neutral-500">Grounded AI</p>
                </div>
              </div>
            </div>

            {/* Q&A Stream */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Quick Prompts */}
              <div className="space-y-2 pb-4 border-b border-white/5">
                <span className="text-xs font-mono text-neutral-500 uppercase tracking-wider block">
                  Quick Inquiries
                </span>
                {[
                  "Which source supports this finding?",
                  "Where do sources disagree?",
                  "Explain the core trade-offs.",
                  "What should I investigate next?",
                ].map((chip, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleAskCopilot(chip)}
                    className="w-full text-left px-3.5 py-2.5 rounded-xl bg-neutral-900/60 hover:bg-violet-600/20 text-neutral-400 hover:text-white border border-white/5 text-sm transition"
                  >
                    {chip}
                  </button>
                ))}
              </div>

              {/* Chat history */}
              {copilotHistory.map((item, idx) => (
                <div key={idx} className="space-y-2.5">
                  <div className="p-3.5 rounded-xl bg-violet-600/20 border border-violet-500/30 text-violet-200 text-sm font-medium">
                    {item.q}
                  </div>
                  <div className="p-4 rounded-xl bg-neutral-900/60 border border-white/5 text-neutral-200 text-sm leading-relaxed space-y-3">
                    <p className="whitespace-pre-wrap">{item.a}</p>

                    {/* Interactive Action Card if detected */}
                    {item.action && (
                      <div className="mt-2 p-3.5 rounded-xl bg-[#09090e] border border-violet-500/30 space-y-2">
                        <span className="text-sm font-semibold text-violet-300 block">
                          {item.action.title}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (item.action?.type === "agent") {
                              handleLaunchAgent(item.action.payload.goal);
                            } else if (item.action?.type === "workflow") {
                              handleCreateWorkflow(item.action.payload.name, item.action.payload.inquiry);
                            } else if (item.action?.type === "memory") {
                              handleSaveToMemory(item.action.payload.key, item.action.payload.content, `mem-${idx}`);
                            }
                          }}
                          className="w-full py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold flex items-center justify-center gap-2 transition shadow-sm"
                        >
                          {item.action.type === "agent" && <Bot className="w-4 h-4" />}
                          {item.action.type === "workflow" && <Workflow className="w-4 h-4" />}
                          {item.action.type === "memory" && <Bookmark className="w-4 h-4" />}
                          <span>Execute Action</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isCopilotThinking && (
                <div className="p-4 rounded-xl bg-neutral-900/40 border border-white/5 text-sm text-violet-400 flex items-center gap-2.5 animate-pulse">
                  <Sparkles className="w-4 h-4 animate-spin" />
                  <span>Cross-referencing research evidence...</span>
                </div>
              )}
            </div>

            {/* Prompt Composer */}
            <div className="p-4 border-t border-white/5 bg-neutral-950">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAskCopilot();
                }}
                className="flex items-center gap-3 bg-neutral-900 border border-white/10 rounded-xl px-4 py-3 focus-within:border-violet-500/50 transition"
              >
                <input
                  type="text"
                  value={copilotPrompt}
                  onChange={(e) => setCopilotPrompt(e.target.value)}
                  placeholder="Ask about this research..."
                  className="flex-1 bg-transparent text-sm text-neutral-100 placeholder-neutral-500 outline-none"
                />
                <button
                  type="submit"
                  disabled={!copilotPrompt.trim() || isCopilotThinking}
                  className="p-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-30 transition"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          </aside>
        )}
      </div>

      {/* CITATION PREVIEW MODAL */}
      {previewCitation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-xl p-7 rounded-3xl bg-[#0a0a10] border border-white/15 shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="px-3 py-1 rounded-lg bg-cyan-500/20 text-cyan-300 font-mono text-sm font-bold">
                  [{previewCitation.inlineIndex}] Citation
                </span>
                <span className="text-sm text-neutral-400 font-mono">{previewCitation.domain}</span>
              </div>
              <button
                type="button"
                onClick={() => setPreviewCitation(null)}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/5 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <h3 className="text-base font-bold text-white mb-3">{previewCitation.title}</h3>
              {previewCitation.evidenceText && (
                <div className="p-4 rounded-xl bg-neutral-900/60 border border-white/5 text-sm text-neutral-300 leading-relaxed italic border-l-2 border-cyan-400">
                  "{previewCitation.evidenceText}"
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-white/5 flex items-center justify-between">
              <span className="text-xs text-neutral-500 font-mono truncate max-w-xs">
                {previewCitation.url}
              </span>

              <button
                type="button"
                onClick={() => {
                  if (onOpenInBrowser) {
                    onOpenInBrowser(previewCitation.url, previewCitation.title);
                  }
                  setPreviewCitation(null);
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold shadow-md shadow-cyan-600/20 transition"
              >
                <span>Open in Browser</span>
                <ExternalLink className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
