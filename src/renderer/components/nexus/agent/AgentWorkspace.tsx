import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  ChevronLeft,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  ShieldAlert,
  ShieldCheck,
  Globe,
  Play,
  Pause,
  Square,
  RotateCcw,
  ExternalLink,
  FileText,
  Database,
  ChevronRight,
  ChevronDown,
  Terminal,
  Layers,
  AlertTriangle,
  Copy,
  Check,
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  SkipForward,
} from "lucide-react";
import type {
  AgentTask,
  AgentRun,
  AgentStep,
  AgentArtifact,
  AgentObservation,
  ApprovalRequest,
} from "../../../lib/nexus/agent.api";
import { AgentApi } from "../../../lib/nexus/agent.api";
import { nexusClient } from "../../../lib/nexus/nexus-client";
import { nexusWs } from "../../../lib/nexus/nexus-ws";

interface AgentWorkspaceProps {
  task: AgentTask;
  run: AgentRun | null;
  onBack: () => void;
  onOpenInBrowser?: (url: string, title?: string, agentControlled?: boolean, agentAction?: string) => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onSaveMemory?: (artifact: AgentArtifact) => void;
}

type RightTab = "state" | "context" | "artifacts" | "approvals";

interface LiveActivityEvent {
  id: string;
  ts: string;
  level: "info" | "tool" | "observe" | "verify" | "warn" | "error" | "state";
  message: string;
  meta?: any;
}

const StepIcon: React.FC<{ status: string }> = ({ status }) => {
  switch (status) {
    case "RUNNING":
      return <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin shrink-0" />;
    case "COMPLETED":
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    case "FAILED":
      return <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />;
    case "SKIPPED":
      return <SkipForward className="w-3.5 h-3.5 text-neutral-500 shrink-0" />;
    default:
      return <div className="w-3.5 h-3.5 rounded-full border border-neutral-600 shrink-0" />;
  }
};

const logColor = (level: LiveActivityEvent["level"]) => {
  switch (level) {
    case "tool":    return "text-cyan-400";
    case "observe": return "text-violet-400";
    case "verify":  return "text-emerald-400";
    case "warn":    return "text-amber-400";
    case "error":   return "text-red-400";
    case "state":   return "text-blue-400";
    default:        return "text-neutral-400";
  }
};

const logPrefix = (level: LiveActivityEvent["level"]) => {
  switch (level) {
    case "tool":    return "TOOL";
    case "observe": return "OBS ";
    case "verify":  return "VFY ";
    case "warn":    return "WARN";
    case "error":   return "ERR ";
    case "state":   return "INFO";
    default:        return "    ";
  }
};

export const AgentWorkspace: React.FC<AgentWorkspaceProps> = ({
  task,
  run,
  onBack,
  onOpenInBrowser,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onSaveMemory,
}) => {
  const [liveRun, setLiveRun] = useState<AgentRun | null>(run);
  const [rightTab, setRightTab] = useState<RightTab>("state");
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [activityLogs, setActivityLogs] = useState<LiveActivityEvent[]>([]);
  const [currentActionPill, setCurrentActionPill] = useState<string | null>(null);
  const [copiedArtifact, setCopiedArtifact] = useState<string | null>(null);
  const [isSavingMemory, setIsSavingMemory] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const steps: AgentStep[] = liveRun?.steps ?? [];
  const artifacts: AgentArtifact[] = liveRun?.artifacts ?? [];
  const observations: AgentObservation[] = liveRun?.observations ?? [];
  const taskStatus = task.status;
  const runStatus = liveRun?.status ?? "PENDING";
  const isRunning = taskStatus === "running" || runStatus === "RUNNING";
  const isPaused = taskStatus === "paused" || runStatus === "PAUSED";
  const isCompleted = taskStatus === "completed" || runStatus === "COMPLETED";
  const isFailed = taskStatus === "failed" || runStatus === "FAILED";
  const awaitingApproval = taskStatus === "awaiting_approval" || runStatus === "AWAITING_APPROVAL";
  const totalSteps = liveRun?.totalSteps ?? steps.length ?? 0;
  const completedSteps = liveRun?.completedSteps ?? steps.filter(s => s.status === "COMPLETED").length ?? 0;
  const progress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : liveRun?.progress ?? 0;
  const activeStep = steps.find(s => s.status === "RUNNING") ?? steps.find(s => s.status === "PENDING");
  const currentUrl = (observations as any[]).slice().reverse().find((o: any) => o.data?.url)?.data?.url ?? "";
  const currentTitle = (observations as any[]).slice().reverse().find((o: any) => o.data?.title)?.data?.title ?? "";
  const currentHeadings = (observations as any[]).slice().reverse().find((o: any) => o.data?.headings)?.data?.headings ?? [];

  const refreshRun = useCallback(async () => {
    const runId = liveRun?.id ?? run?.id;
    if (!runId) return;
    try {
      const { run: fresh } = await AgentApi.getRunById(runId);
      setLiveRun(fresh);
      try {
        const res = await AgentApi.getPendingApprovals();
        setApprovals(res.approvals ?? []);
        if ((res.approvals ?? []).length > 0) setRightTab("approvals");
      } catch {}
    } catch {}
  }, [liveRun?.id, run?.id]);

  const appendLog = useCallback((level: LiveActivityEvent["level"], message: string, meta?: any) => {
    const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
    setActivityLogs(prev => [...prev.slice(-200), {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ts, level, message, meta,
    }]);
  }, []);

  useEffect(() => {
    appendLog("state", `Workspace opened: "${task.title}"`);
    const subs = [
      nexusWs.subscribe("agent.started", () => { appendLog("state", "Agent started. Planning execution…"); refreshRun(); }),
      nexusWs.subscribe("agent.stepStarted", (p: any) => {
        const desc = p?.description || p?.name || `Step ${(p?.stepIndex ?? 0) + 1}`;
        setCurrentActionPill(desc);
        appendLog("tool", `[Step ${(p?.stepIndex ?? 0) + 1}] ${desc}`);
        refreshRun();
      }),
      nexusWs.subscribe("agent.toolStarted", (p: any) => {
        const pill = `${p?.toolName}(${JSON.stringify(p?.parameters ?? {}).slice(0, 60)})`;
        setCurrentActionPill(pill);
        appendLog("tool", `▶ ${p?.toolName}`, p?.parameters);
        if (p?.toolName === "browser.navigate" && p?.parameters?.url) {
          onOpenInBrowser?.(p.parameters.url, p.parameters.url, true, `Navigating to ${p.parameters.url}`);
        }
      }),
      nexusWs.subscribe("agent.toolCompleted", (p: any) => {
        appendLog("verify", `✓ ${p?.toolName} (${p?.durationMs ?? 0}ms)`, p?.result);
        refreshRun();
      }),
      nexusWs.subscribe("agent.observationCreated", (p: any) => {
        appendLog("observe", `Observation: ${p?.title || p?.type || "recorded"}`);
        refreshRun();
      }),
      nexusWs.subscribe("agent.stepCompleted", () => { appendLog("verify", "Step completed ✓"); setCurrentActionPill(null); refreshRun(); }),
      nexusWs.subscribe("agent.approvalRequired", (p: any) => {
        appendLog("warn", `⚠ Approval required: ${p?.toolName}`);
        setRightTab("approvals");
        refreshRun();
      }),
      nexusWs.subscribe("agent.paused", () => { appendLog("state", "Execution paused."); refreshRun(); }),
      nexusWs.subscribe("agent.resumed", () => { appendLog("state", "Execution resumed."); refreshRun(); }),
      nexusWs.subscribe("agent.completed", () => { appendLog("state", "✓ Task completed successfully."); setCurrentActionPill(null); refreshRun(); }),
      nexusWs.subscribe("agent.failed", (p: any) => { appendLog("error", `Task failed: ${p?.error || p?.reason || "Unknown"}`); setCurrentActionPill(null); refreshRun(); }),
      nexusWs.subscribe("browser.navigation", (p: any) => { appendLog("tool", `Navigated → ${p?.url}`); }),
      nexusWs.subscribe("browser.action", (p: any) => { appendLog("tool", `Browser: ${p?.action?.toUpperCase()} on ${p?.selector || p?.url || ""}`); }),
      nexusWs.subscribe("agent.stepVerified", (p: any) => { appendLog("verify", `Verification passed: ${p?.criterion || ""}`); }),
    ];
    return () => subs.forEach(fn => fn());
  }, [task.id]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [activityLogs]);

  useEffect(() => {
    if (run) setLiveRun(run);
    refreshRun();
  }, [run?.id]);

  const toggleStep = (id: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleResolveApproval = async (approvalId: string, decision: "APPROVED" | "REJECTED") => {
    try {
      await AgentApi.resolveApproval(approvalId, decision);
      setApprovals(prev => prev.filter(a => a.id !== approvalId));
    } catch (e) {
      appendLog("error", `Failed to resolve approval: ${e}`);
    }
  };

  const copyArtifact = (id: string, content: string) => {
    navigator.clipboard.writeText(content).catch(() => {});
    setCopiedArtifact(id);
    setTimeout(() => setCopiedArtifact(null), 1500);
  };

  const handleSaveToMemory = async (artifact: AgentArtifact) => {
    if (isSavingMemory) return;
    setIsSavingMemory(true);
    try {
      if (onSaveMemory) {
        onSaveMemory(artifact);
      } else {
        await nexusClient.createMemory({
          title: artifact.name,
          content: artifact.content,
          summary: `Agent Artifact: ${task.title}`,
          type: "INSIGHT",
          category: "Automation",
          importance: 0.95,
        });
      }
    } catch {}
    setIsSavingMemory(false);
  };

  const getDuration = () => {
    if (!liveRun?.startedAt) return "—";
    const end = liveRun.completedAt ? new Date(liveRun.completedAt) : new Date();
    const s = Math.round((end.getTime() - new Date(liveRun.startedAt).getTime()) / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  const StatusBadge = () => {
    if (isRunning) return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-medium bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
        Running · {completedSteps}/{totalSteps}
      </span>
    );
    if (isPaused) return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">
        <Pause className="w-3 h-3" /> Paused
      </span>
    );
    if (awaitingApproval) return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-medium bg-orange-500/15 text-orange-300 border border-orange-500/30">
        <ShieldAlert className="w-3 h-3" /> Awaiting Approval
      </span>
    );
    if (isCompleted) return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
        <CheckCircle2 className="w-3 h-3" /> Completed
      </span>
    );
    if (isFailed) return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-medium bg-red-500/15 text-red-300 border border-red-500/30">
        <XCircle className="w-3 h-3" /> Failed
      </span>
    );
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-medium bg-neutral-800 text-neutral-400 border border-white/5">
        <Clock className="w-3 h-3" /> Pending
      </span>
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#050507] text-neutral-100 overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] bg-[#080810] shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-100 transition-colors px-2 py-1 rounded-md hover:bg-white/5"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Tasks
          </button>
          <span className="text-white/20 text-xs">|</span>
          <span className="text-sm font-semibold text-white truncate max-w-[280px]">{task.title}</span>
          <StatusBadge />
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isRunning && (
            <button type="button" onClick={onPause} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-800 hover:bg-neutral-700 border border-white/10 text-neutral-200 transition-colors">
              <Pause className="w-3.5 h-3.5" /> Pause
            </button>
          )}
          {isPaused && (
            <button type="button" onClick={onResume} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 text-cyan-300 transition-colors">
              <Play className="w-3.5 h-3.5" /> Resume
            </button>
          )}
          {(isFailed || isCompleted) && (
            <button type="button" onClick={onRetry} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-violet-300 transition-colors">
              <RotateCcw className="w-3.5 h-3.5" /> Retry
            </button>
          )}
          {(isRunning || isPaused) && (
            <button type="button" onClick={onCancel} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600/10 hover:bg-red-600/20 border border-red-500/30 text-red-400 transition-colors">
              <Square className="w-3.5 h-3.5" /> Cancel
            </button>
          )}
          <button type="button" onClick={refreshRun} className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-300 hover:bg-white/5 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 3-pane body */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT — Steps */}
        <div className="w-[280px] shrink-0 flex flex-col border-r border-white/[0.06] overflow-hidden">
          <div className="p-4 border-b border-white/[0.06] bg-[#080810]">
            <div className="flex items-center gap-2 mb-2">
              <Layers className="w-3.5 h-3.5 text-violet-400 shrink-0" />
              <span className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">Objective</span>
            </div>
            <p className="text-xs text-neutral-300 leading-relaxed line-clamp-3">{task.goal}</p>
            {totalSteps > 0 && (
              <div className="mt-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[11px] text-neutral-500">{completedSteps}/{totalSteps} steps</span>
                  <span className="text-[11px] font-mono text-neutral-400">{progress}%</span>
                </div>
                <div className="h-1 bg-neutral-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${isCompleted ? "bg-emerald-500" : isFailed ? "bg-red-500" : "bg-gradient-to-r from-violet-500 to-cyan-500"}`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {steps.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2 text-neutral-600">
                {isRunning ? <><Loader2 className="w-5 h-5 animate-spin" /><span className="text-xs">Planning steps…</span></> : <><Clock className="w-5 h-5" /><span className="text-xs">No steps yet</span></>}
              </div>
            ) : (
              <div className="p-2 flex flex-col gap-0.5">
                {steps.map((step, i) => {
                  const isExpanded = expandedSteps.has(step.id);
                  const isActive = step.status === "RUNNING";
                  return (
                    <div key={step.id} className={`rounded-lg border transition-all ${isActive ? "border-cyan-500/30 bg-cyan-500/5" : step.status === "COMPLETED" ? "border-emerald-500/20 bg-emerald-500/3" : step.status === "FAILED" ? "border-red-500/20 bg-red-500/3" : "border-transparent hover:border-white/5 hover:bg-white/[0.02]"}`}>
                      <button type="button" className="w-full flex items-center gap-2 px-3 py-2 text-left" onClick={() => toggleStep(step.id)}>
                        <StepIcon status={step.status} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-mono text-neutral-600 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                            <span className={`text-xs truncate font-medium ${isActive ? "text-cyan-300" : step.status === "COMPLETED" ? "text-emerald-300" : step.status === "FAILED" ? "text-red-300" : "text-neutral-300"}`}>{step.name}</span>
                          </div>
                          <div className="flex items-center gap-1 mt-0.5">
                            <Terminal className="w-2.5 h-2.5 text-neutral-600" />
                            <span className="text-[10px] font-mono text-neutral-600 truncate">{step.toolName}</span>
                          </div>
                        </div>
                        {isExpanded ? <ChevronDown className="w-3 h-3 text-neutral-600 shrink-0" /> : <ChevronRight className="w-3 h-3 text-neutral-600 shrink-0" />}
                      </button>
                      {isExpanded && (
                        <div className="px-3 pb-2 border-t border-white/[0.04] mt-0.5 pt-2">
                          {step.description && <p className="text-[11px] text-neutral-400 mb-2 leading-relaxed">{step.description}</p>}
                          {step.input && Object.keys(step.input).length > 0 && (
                            <div className="bg-neutral-900/60 rounded-md p-2 font-mono text-[10px] text-neutral-500 overflow-x-auto max-h-24 overflow-y-auto">{JSON.stringify(step.input, null, 2)}</div>
                          )}
                          {step.error && (
                            <div className="mt-2 flex items-start gap-1.5 text-[11px] text-red-400">
                              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /><span>{step.error}</span>
                            </div>
                          )}
                          {step.verificationOutcome && (
                            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-400">
                              <ShieldCheck className="w-3 h-3 shrink-0" /><span>{step.verificationOutcome}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* CENTER — Live Browser */}
        <div className="flex-1 flex flex-col overflow-hidden relative min-w-0">
          {/* Browser chrome */}
          <div className="flex items-center gap-2 px-3 py-2 bg-[#0a0a12] border-b border-white/[0.06] shrink-0">
            <div className="flex gap-1">
              <button type="button" className="w-6 h-6 flex items-center justify-center rounded text-neutral-600 hover:text-neutral-400 hover:bg-white/5 transition-colors"><ArrowLeft className="w-3.5 h-3.5" /></button>
              <button type="button" className="w-6 h-6 flex items-center justify-center rounded text-neutral-600 hover:text-neutral-400 hover:bg-white/5 transition-colors"><ArrowRight className="w-3.5 h-3.5" /></button>
              <button type="button" className="w-6 h-6 flex items-center justify-center rounded text-neutral-600 hover:text-neutral-400 hover:bg-white/5 transition-colors"><RefreshCw className="w-3.5 h-3.5" /></button>
            </div>
            <div className="flex-1 flex items-center gap-2 bg-neutral-900/80 border border-white/[0.06] rounded-lg px-3 py-1 min-w-0">
              <Globe className="w-3 h-3 text-neutral-500 shrink-0" />
              <span className="text-xs font-mono text-neutral-400 truncate flex-1">{currentUrl || (isRunning ? "Waiting for navigation…" : "No active page")}</span>
            </div>
            {currentUrl && (
              <button type="button" onClick={() => onOpenInBrowser?.(currentUrl, currentTitle)} className="w-6 h-6 flex items-center justify-center rounded text-neutral-600 hover:text-neutral-400 hover:bg-white/5 transition-colors">
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Live browser area — Electron WebContentsView is overlaid here */}
          <div className="flex-1 relative flex flex-col overflow-hidden bg-neutral-950">
            {!isRunning && !currentUrl && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center z-10 pointer-events-none">
                <Globe className={`w-10 h-10 ${isCompleted ? "text-emerald-500/40" : isFailed ? "text-red-500/40" : "text-neutral-700"}`} />
                <div>
                  <p className="text-sm font-medium text-neutral-400">{isCompleted ? "Task Completed" : isFailed ? "Task Failed" : "Browser Idle"}</p>
                  <p className="text-xs text-neutral-600 mt-1">{isCompleted ? "The agent finished all steps successfully." : isFailed ? (liveRun?.error || "An error occurred during execution.") : "Browser will activate when the agent begins navigation."}</p>
                </div>
              </div>
            )}

            {currentActionPill && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
                <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-neutral-900/95 border border-cyan-500/30 shadow-lg shadow-cyan-500/10 backdrop-blur-sm">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shrink-0" />
                  <span className="text-xs font-mono text-cyan-300 max-w-[400px] truncate">{currentActionPill}</span>
                </div>
              </div>
            )}

            {isCompleted && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
                <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-950/90 border border-emerald-500/40 shadow-lg backdrop-blur-sm">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-emerald-300">Completed in {getDuration()} · {completedSteps} steps</p>
                    {artifacts.length > 0 && <p className="text-[11px] text-emerald-500 mt-0.5">{artifacts.length} artifact{artifacts.length > 1 ? "s" : ""} generated</p>}
                  </div>
                </div>
              </div>
            )}

            {isFailed && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
                <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-950/90 border border-red-500/40 shadow-lg backdrop-blur-sm">
                  <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-red-300">Execution failed</p>
                    {liveRun?.error && <p className="text-[11px] text-red-500 mt-0.5 max-w-[360px] truncate">{liveRun.error}</p>}
                  </div>
                </div>
              </div>
            )}

            {/* Transparent placeholder — real Electron tab renders here */}
            <div className="flex-1 w-full" style={{ background: "transparent" }} />
          </div>
        </div>

        {/* RIGHT — Tabs */}
        <div className="w-[300px] shrink-0 flex flex-col border-l border-white/[0.06] overflow-hidden">
          <div className="flex border-b border-white/[0.06] bg-[#080810] shrink-0">
            {(["state", "context", "artifacts", "approvals"] as RightTab[]).map(tab => (
              <button key={tab} type="button" onClick={() => setRightTab(tab)}
                className={`flex-1 py-2.5 text-[11px] font-medium uppercase tracking-wider transition-colors relative ${rightTab === tab ? "text-violet-300" : "text-neutral-500 hover:text-neutral-300"}`}
              >
                {tab === "approvals" && approvals.length > 0 && (
                  <span className="absolute top-1.5 right-1 w-4 h-4 rounded-full bg-amber-500 text-[9px] font-bold text-white flex items-center justify-center">{approvals.length}</span>
                )}
                {tab}
                {rightTab === tab && <div className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-violet-500 rounded-full" />}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {rightTab === "state" && (
              <div className="flex flex-col gap-3">
                <div className="rounded-xl bg-neutral-900/60 border border-white/5 p-3">
                  <p className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-3">Execution State</p>
                  <div className="flex flex-col gap-2">
                    {[
                      { label: "Status", value: runStatus },
                      { label: "Progress", value: `${progress}% (${completedSteps}/${totalSteps})` },
                      { label: "Duration", value: getDuration() },
                      { label: "Run ID", value: liveRun?.id ? liveRun.id.slice(0, 16) + "…" : "—" },
                      { label: "Active Tool", value: activeStep?.toolName || "—" },
                      { label: "Step", value: activeStep ? `${(activeStep.order ?? 0) + 1} / ${totalSteps}` : "—" },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex items-center justify-between">
                        <span className="text-[11px] text-neutral-500">{label}</span>
                        <span className="text-[11px] font-mono text-neutral-300">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {activeStep && (
                  <div className="rounded-xl bg-cyan-500/5 border border-cyan-500/20 p-3">
                    <p className="text-[11px] font-medium text-cyan-400 mb-2">Active Step</p>
                    <p className="text-xs text-cyan-300 font-medium">{activeStep.name}</p>
                    {activeStep.description && <p className="text-[11px] text-neutral-400 mt-1 leading-relaxed">{activeStep.description}</p>}
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] font-mono text-neutral-500">
                      <Terminal className="w-3 h-3" />{activeStep.toolName}
                    </div>
                  </div>
                )}
                {liveRun?.error && (
                  <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-3">
                    <div className="flex items-center gap-2 mb-2"><AlertTriangle className="w-3.5 h-3.5 text-red-400" /><p className="text-[11px] font-medium text-red-400">Error</p></div>
                    <p className="text-xs text-red-300 leading-relaxed">{liveRun.error}</p>
                  </div>
                )}
              </div>
            )}

            {rightTab === "context" && (
              <div className="flex flex-col gap-3">
                <div className="rounded-xl bg-neutral-900/60 border border-white/5 p-3">
                  <div className="flex items-center gap-2 mb-3"><Globe className="w-3.5 h-3.5 text-blue-400" /><p className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">Browser Context</p></div>
                  <div className="flex flex-col gap-2">
                    <div><span className="text-[10px] text-neutral-600 uppercase tracking-wider">URL</span><p className="text-[11px] font-mono text-blue-400 mt-0.5 break-all leading-relaxed">{currentUrl || "—"}</p></div>
                    {currentTitle && <div><span className="text-[10px] text-neutral-600 uppercase tracking-wider">Title</span><p className="text-[11px] text-neutral-300 mt-0.5">{currentTitle}</p></div>}
                    {currentHeadings.length > 0 && (
                      <div>
                        <span className="text-[10px] text-neutral-600 uppercase tracking-wider">Headings</span>
                        <div className="mt-1 flex flex-col gap-1">{currentHeadings.slice(0, 5).map((h: string, i: number) => <p key={i} className="text-[11px] text-neutral-400 truncate">{h}</p>)}</div>
                      </div>
                    )}
                  </div>
                </div>
                {observations.length > 0 && (
                  <div className="rounded-xl bg-neutral-900/60 border border-white/5 p-3">
                    <p className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-3">Observations</p>
                    <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
                      {observations.slice(-10).reverse().map(obs => (
                        <div key={obs.id} className="border-l-2 border-violet-500/40 pl-2">
                          <p className="text-[11px] font-medium text-neutral-300">{obs.title}</p>
                          <p className="text-[10px] text-neutral-500 mt-0.5">{obs.summary}</p>
                          <p className="text-[10px] text-neutral-700 mt-0.5">{new Date(obs.createdAt).toLocaleTimeString()}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="rounded-xl bg-neutral-900/60 border border-white/5 p-3">
                  <p className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-3">Task Details</p>
                  <div className="flex flex-col gap-2">
                    {[
                      { label: "Priority", value: task.priority },
                      { label: "Mode", value: task.mode ?? "balanced" },
                      { label: "Created", value: new Date(task.createdAt).toLocaleString() },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex items-center justify-between">
                        <span className="text-[11px] text-neutral-500">{label}</span>
                        <span className="text-[11px] font-mono text-neutral-300 capitalize">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {rightTab === "artifacts" && (
              <div className="flex flex-col gap-2">
                {artifacts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-32 gap-2 text-neutral-600"><FileText className="w-6 h-6" /><span className="text-xs">No artifacts yet</span></div>
                ) : artifacts.map(art => (
                  <div key={art.id} className="rounded-xl bg-neutral-900/60 border border-white/5 p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 min-w-0"><FileText className="w-3.5 h-3.5 text-violet-400 shrink-0" /><p className="text-xs font-medium text-neutral-200 truncate">{art.name}</p></div>
                      <span className="text-[10px] text-neutral-600 font-mono shrink-0 capitalize">{art.type}</span>
                    </div>
                    <p className="text-[11px] text-neutral-400 line-clamp-3 leading-relaxed mb-3">{art.content.slice(0, 200)}{art.content.length > 200 ? "…" : ""}</p>
                    <div className="flex gap-1.5">
                      <button type="button" onClick={() => copyArtifact(art.id, art.content)} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-white/5 transition-colors">
                        {copiedArtifact === art.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        {copiedArtifact === art.id ? "Copied" : "Copy"}
                      </button>
                      <button type="button" onClick={() => handleSaveToMemory(art)} disabled={isSavingMemory} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] bg-violet-900/30 hover:bg-violet-900/50 text-violet-300 border border-violet-500/20 transition-colors disabled:opacity-50">
                        <Database className="w-3 h-3" /> Memory
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {rightTab === "approvals" && (
              <div className="flex flex-col gap-2">
                {approvals.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-32 gap-2 text-neutral-600"><ShieldCheck className="w-6 h-6" /><span className="text-xs">No pending approvals</span></div>
                ) : approvals.map(appr => (
                  <div key={appr.id} className="rounded-xl bg-amber-950/30 border border-amber-500/30 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                      <p className="text-xs font-semibold text-amber-300">Approval Required</p>
                      <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-mono">{appr.riskLevel}</span>
                    </div>
                    <div className="mb-2"><p className="text-[11px] text-neutral-400">Tool</p><p className="text-xs font-mono text-neutral-200">{appr.toolName}</p></div>
                    {appr.parameters && (
                      <div className="mb-3"><p className="text-[11px] text-neutral-400 mb-1">Parameters</p>
                        <div className="bg-neutral-900/60 rounded-lg p-2 font-mono text-[10px] text-neutral-400 overflow-x-auto max-h-24 overflow-y-auto">{JSON.stringify(appr.parameters, null, 2)}</div>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button type="button" onClick={() => handleResolveApproval(appr.id, "APPROVED")} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 transition-colors">
                        <ShieldCheck className="w-3.5 h-3.5" /> Approve
                      </button>
                      <button type="button" onClick={() => handleResolveApproval(appr.id, "REJECTED")} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-500/30 transition-colors">
                        <XCircle className="w-3.5 h-3.5" /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* BOTTOM — Activity Stream */}
      <div className="h-[160px] border-t border-white/[0.06] bg-[#040408] flex flex-col shrink-0">
        <div className="flex items-center justify-between px-4 py-1.5 border-b border-white/[0.04]">
          <div className="flex items-center gap-2">
            <Terminal className="w-3 h-3 text-neutral-600" />
            <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">Live Activity</span>
            {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />}
          </div>
          <span className="text-[10px] text-neutral-700">{activityLogs.length} events</span>
        </div>
        <div ref={logRef} className="flex-1 overflow-y-auto px-4 py-1.5 font-mono text-[11px] leading-relaxed" style={{ scrollBehavior: "smooth" }}>
          {activityLogs.length === 0 ? <span className="text-neutral-700">Waiting for events…</span> : activityLogs.map(log => (
            <div key={log.id} className="flex gap-2 py-0.5 hover:bg-white/[0.02] rounded px-1 -mx-1">
              <span className="text-neutral-700 shrink-0">{log.ts}</span>
              <span className={`shrink-0 ${logColor(log.level)}`}>[{logPrefix(log.level)}]</span>
              <span className="text-neutral-300 break-all">{log.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
