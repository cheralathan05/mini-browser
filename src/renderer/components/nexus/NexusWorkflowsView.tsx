import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Workflow,
  Plus,
  Play,
  CheckCircle2,
  Clock,
  Layers,
  ArrowRight,
  Loader2,
  Sparkles,
  Search,
  Globe,
  Database,
  ShieldCheck,
  ShieldAlert,
  ZoomIn,
  ZoomOut,
  Maximize2,
  GitBranch,
  X,
  Trash2,
  Copy,
  Edit2,
  History,
  Info,
  ChevronRight,
  AlertCircle,
  FileText,
  ExternalLink,
  RefreshCw,
  Sliders,
  Send,
  Check,
  MessageSquare,
  Phone,
  Shield,
  Zap,
  CheckCheck,
  Terminal,
  Camera,
  Cpu,
  ListFilter,
  Power,
  AlertTriangle,
  RotateCcw,
  StopCircle,
} from "lucide-react";

import { nexusClient } from "../../lib/nexus/nexus-client";
import { nexusWs } from "../../lib/nexus/nexus-ws";
import { useToast } from "./NexusToast";
import {
  automationApi,
  AutonomyMode,
  ExecutionPlan,
  WorkflowPreset,
  WorkflowExecutionRecord,
  IntegrationConnection,
  WhatsAppDeliveryResult,
} from "../../lib/nexus/automation.api";
import { NexusVisualBuilder } from "./NexusVisualBuilder";

interface NexusWorkflowsViewProps {
  onOpenInBrowser?: (url: string, title?: string) => void;
  workspaceId?: string | null;
}

export interface CanvasNode {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  status: "idle" | "running" | "completed" | "failed" | "waiting_approval";
  x: number;
  y: number;
  stepData?: any;
  output?: any;
  startedAt?: string;
  completedAt?: string;
}

export const NexusWorkflowsView: React.FC<NexusWorkflowsViewProps> = ({
  onOpenInBrowser,
  workspaceId,
}) => {
  // Primary Module Navigation
  const [activeSubTab, setActiveSubTab] = useState<
    "studio" | "whatsapp" | "builder" | "history" | "approvals" | "integrations"
  >("studio");

  // Objective Composer State
  const [objectivePrompt, setObjectivePrompt] = useState("");
  const [autonomyMode, setAutonomyMode] = useState<AutonomyMode>("assisted");
  const [isPlanning, setIsPlanning] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [activePlan, setActivePlan] = useState<ExecutionPlan | null>(null);
  const [planErrors, setPlanErrors] = useState<string[]>([]);
  const [presets, setPresets] = useState<WorkflowPreset[]>([]);

  // Active Live Execution Tracking
  const [currentExecution, setCurrentExecution] = useState<WorkflowExecutionRecord | null>(null);
  const [liveSteps, setLiveSteps] = useState<any[]>([]);

  // WhatsApp Automation Panel State
  const [waRecipient, setWaRecipient] = useState("+1 (555) 019-2834");
  const [waMessage, setWaMessage] = useState(
    "NEXUS Automation Studio: Your autonomous pipeline completed with 4 verified sources and all tests passing."
  );
  const [waTemplate, setWaTemplate] = useState("milestone");
  const [waRequiresApproval, setWaRequiresApproval] = useState(false);
  const [waStatus, setWaStatus] = useState<any>(null);
  const [isSendingWa, setIsSendingWa] = useState(false);
  const [waLastResult, setWaLastResult] = useState<WhatsAppDeliveryResult | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  // Workflow Builder State
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<any | null>(null);
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<CanvasNode | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAddStepModal, setShowAddStepModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [newWfName, setNewWfName] = useState("");
  const [newWfDesc, setNewWfDesc] = useState("");
  const [newWfTargetUrl, setNewWfTargetUrl] = useState("https://news.ycombinator.com");
  const [newStepName, setNewStepName] = useState("");
  const [newStepType, setNewStepType] = useState("browser.navigate");
  const [newStepUrl, setNewStepUrl] = useState("https://example.com");
  const [newStepPrompt, setNewStepPrompt] = useState("Synthesize key elements");
  const [newStepSelector, setNewStepSelector] = useState("body");

  // Execution History State
  const [executions, setExecutions] = useState<WorkflowExecutionRecord[]>([]);
  const [historyFilter, setHistoryFilter] = useState<string>("all");
  const [selectedHistoryExec, setSelectedHistoryExec] = useState<WorkflowExecutionRecord | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Approvals State
  const [pendingApprovals, setPendingApprovals] = useState<any[]>([]);
  const [isResolvingApproval, setIsResolvingApproval] = useState(false);

  // Integrations State
  const [integrations, setIntegrations] = useState<IntegrationConnection[]>([]);
  const [isVerifyingMap, setIsVerifyingMap] = useState<Record<string, boolean>>({});

  const toast = useToast();
  const canvasRef = useRef<HTMLDivElement | null>(null);

  // Load Presets & Integrations
  useEffect(() => {
    automationApi.getPresets().then((res) => {
      if (res.presets) setPresets(res.presets);
    }).catch(() => {});

    automationApi.getWhatsAppStatus().then((res) => {
      if (res.connection) setWaStatus(res.connection);
    }).catch(() => {});

    loadIntegrations();
    loadApprovals();
  }, []);

  const loadIntegrations = async () => {
    try {
      const res = await automationApi.getIntegrations();
      if (res.integrations) setIntegrations(res.integrations);
    } catch {}
  };

  const loadApprovals = async () => {
    try {
      const res = await nexusClient.getApprovals("pending");
      setPendingApprovals(res.approvals || []);
    } catch {}
  };

  // Load Workflows for Builder
  const loadWorkflows = useCallback(async () => {
    try {
      const res = await nexusClient.getWorkflows(workspaceId || undefined);
      const list = res.workflows || [];
      setWorkflows(list);
      if (list.length > 0) {
        const currentExists = selectedWorkflow ? list.find((w) => w.id === selectedWorkflow.id) : null;
        await loadWorkflowDetails(currentExists ? currentExists.id : list[0].id);
      } else {
        setSelectedWorkflow(null);
        setNodes([]);
        setSelectedNode(null);
      }
    } catch (e) {
      console.error("Failed to load workflows:", e);
    }
  }, [workspaceId, selectedWorkflow?.id]);

  const loadWorkflowDetails = async (id: string) => {
    try {
      const res = await nexusClient.getWorkflow(id);
      const wf = res.workflow;
      setSelectedWorkflow(wf);

      if (wf?.definition?.steps && Array.isArray(wf.definition.steps)) {
        const latestExec = wf.executions?.[0];
        const stepExecMap = new Map<string, any>();
        if (latestExec?.steps) {
          latestExec.steps.forEach((st: any) => stepExecMap.set(st.stepId, st));
        }

        const mapped: CanvasNode[] = wf.definition.steps.map((s: any, idx: number) => {
          const exec = stepExecMap.get(s.id);
          const computedStatus = exec ? (exec.status as any) : s.status || "idle";
          return {
            id: s.id || `node-${idx + 1}`,
            type: s.type || (idx === 0 ? "trigger" : idx === 1 ? "search" : idx === 2 ? "ai" : "output"),
            title: s.name || `Step ${idx + 1}`,
            subtitle: s.action || s.description || s.url || s.prompt || s.selector || "Automated step",
            status: computedStatus,
            x: s.x !== undefined ? s.x : 60 + idx * 240,
            y: s.y !== undefined ? s.y : 160,
            stepData: s,
            output: exec?.output,
            startedAt: exec?.startedAt,
            completedAt: exec?.completedAt,
          };
        });

        setNodes(mapped);
      } else {
        setNodes([]);
      }
    } catch (e) {
      console.error("Failed to load workflow details:", e);
    }
  };

  useEffect(() => {
    if (activeSubTab === "builder") {
      loadWorkflows();
    } else if (activeSubTab === "history") {
      loadHistory();
    } else if (activeSubTab === "approvals") {
      loadApprovals();
    } else if (activeSubTab === "integrations") {
      loadIntegrations();
    }
  }, [activeSubTab, workspaceId]);

  const loadHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const res = await automationApi.getExecutions(historyFilter !== "all" ? historyFilter : undefined);
      setExecutions(res.executions || []);
      if (res.executions?.length > 0 && !selectedHistoryExec) {
        setSelectedHistoryExec(res.executions[0]);
      }
    } catch {} finally {
      setIsLoadingHistory(false);
    }
  };

  // WebSocket Live Updates
  useEffect(() => {
    const unsubProgress = nexusWs.subscribe("workflow.progress", (data: any) => {
      // Step running update
      if (data.status === "step_running") {
        setLiveSteps((prev) => {
          const idx = prev.findIndex((s) => s.id === data.stepId);
          if (idx !== -1) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], status: "running" };
            return updated;
          }
          return [...prev, { id: data.stepId, name: data.stepName || data.stepId, status: "running" }];
        });

        setNodes((prev) =>
          prev.map((n) => (n.id === data.stepId ? { ...n, status: "running" } : n))
        );
      } else if (data.status === "step_completed") {
        setLiveSteps((prev) =>
          prev.map((s) => (s.id === data.stepId ? { ...s, status: "completed", output: data.output } : s))
        );

        setNodes((prev) =>
          prev.map((n) => (n.id === data.stepId ? { ...n, status: "completed", output: data.output } : n))
        );
      } else if (data.status === "waiting_approval") {
        setLiveSteps((prev) =>
          prev.map((s) => (s.id === data.stepId ? { ...s, status: "waiting_approval" } : s))
        );
        loadApprovals();
      } else if (data.status === "completed") {
        setIsExecuting(false);
        toast.success("Autonomous workflow completed successfully!");
        loadApprovals();
        loadHistory();
      } else if (data.status === "cancelled") {
        setIsExecuting(false);
        toast.info("Workflow execution cancelled.");
      }
    });

    const unsubApprReq = nexusWs.subscribe("approval.required", () => {
      loadApprovals();
    });

    const unsubApprRes = nexusWs.subscribe("approval.resolved", () => {
      loadApprovals();
    });

    return () => {
      unsubProgress();
      unsubApprReq();
      unsubApprRes();
    };
  }, [currentExecution?.id]);

  // Objective Planning Trigger
  const handlePlanObjective = async (overrideGoal?: string) => {
    const targetGoal = overrideGoal || objectivePrompt.trim();
    if (!targetGoal) {
      toast.error("Please enter a research or automation objective");
      return;
    }

    setIsPlanning(true);
    setPlanErrors([]);
    try {
      const res = await automationApi.planObjective(targetGoal, autonomyMode, workspaceId || undefined);
      setActivePlan(res.plan);
      if (!res.valid && res.errors?.length > 0) {
        setPlanErrors(res.errors);
      } else {
        toast.success("Objective parsed into structured execution plan");
      }
    } catch (err: any) {
      toast.error(`Planning failed: ${err.message}`);
    } finally {
      setIsPlanning(false);
    }
  };

  // Launch Autonomous Workflow
  const handleLaunchPlan = async () => {
    if (!activePlan && !objectivePrompt.trim()) {
      toast.error("Please enter an objective or generate a plan");
      return;
    }

    setIsExecuting(true);
    try {
      const res = await automationApi.execute({
        objective: activePlan ? activePlan.goal : objectivePrompt.trim(),
        mode: autonomyMode,
        workspaceId: workspaceId || undefined,
        plan: activePlan || undefined,
      });

      toast.info(`Workflow started in ${autonomyMode.toUpperCase()} mode...`);
      setCurrentExecution({
        id: res.executionId,
        workflowId: res.workflowId,
        status: "running",
        mode: autonomyMode,
        startedAt: new Date().toISOString(),
        steps: (activePlan?.steps || []).map((s) => ({
          id: s.id,
          stepId: s.id,
          status: "pending",
        })),
      });

      if (activePlan?.steps) {
        setLiveSteps(activePlan.steps.map((s) => ({ ...s, status: "pending" })));
      }
    } catch (err: any) {
      setIsExecuting(false);
      toast.error(`Execution failed: ${err.message}`);
    }
  };

  // Preset Selection
  const handleSelectPreset = (preset: WorkflowPreset) => {
    setObjectivePrompt(preset.defaultGoal);
    setAutonomyMode(preset.defaultMode);
    setActivePlan(preset.plan);
    setPlanErrors([]);
    toast.info(`Selected preset: "${preset.name}"`);
  };

  // WhatsApp Send Action
  const handleSendWhatsApp = async () => {
    setPhoneError(null);
    const cleaned = waRecipient.replace(/[\s\(\)\-]/g, "");
    if (!/^\+?[1-9]\d{6,14}$/.test(cleaned)) {
      setPhoneError("Invalid international phone number. Must be valid E.164 format (e.g. +1 555-0199)");
      return;
    }
    if (!waMessage.trim()) {
      toast.error("Message content cannot be empty");
      return;
    }

    setIsSendingWa(true);
    try {
      const res = await automationApi.sendWhatsAppMessage({
        recipient: waRecipient,
        message: waMessage,
        templateId: waTemplate,
        workspaceId: workspaceId || undefined,
        requiresApproval: waRequiresApproval,
      });

      setWaLastResult(res.result);
      if (res.result.requiresApproval) {
        toast.info("WhatsApp dispatch gated by Approvals Center. Review pending action.");
        loadApprovals();
      } else if (res.result.success) {
        toast.success(`Message delivered! ID: ${res.result.messageId}`);
      }
    } catch (err: any) {
      toast.error(`WhatsApp error: ${err.message}`);
    } finally {
      setIsSendingWa(false);
    }
  };

  // Resolve Approval
  const handleResolveApproval = async (approvalId: string, approve: boolean) => {
    setIsResolvingApproval(true);
    try {
      if (approve) {
        await nexusClient.approve(approvalId);
        toast.success("Action approved. Resuming autonomous workflow...");
      } else {
        await nexusClient.reject(approvalId);
        toast.info("Action rejected. Workflow halted.");
      }
      await loadApprovals();
      await loadHistory();
    } catch (err: any) {
      toast.error(`Failed to resolve approval: ${err.message}`);
    } finally {
      setIsResolvingApproval(false);
    }
  };

  // Verify Integration
  const handleVerifyIntegration = async (provider: string) => {
    setIsVerifyingMap((prev) => ({ ...prev, [provider]: true }));
    try {
      const res = await automationApi.verifyIntegration(provider);
      setIntegrations((prev) =>
        prev.map((i) => (i.provider === provider ? res.integration : i))
      );
      toast.success(`Verified connection: ${res.integration.name} (${res.integration.latencyMs}ms)`);
    } catch (err: any) {
      toast.error(`Verification error: ${err.message}`);
    } finally {
      setIsVerifyingMap((prev) => ({ ...prev, [provider]: false }));
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#04040a] text-neutral-100 overflow-hidden font-sans">
      {/* Top Header */}
      <header className="h-14 px-6 border-b border-white/[0.08] bg-[#070712]/95 backdrop-blur-md flex items-center justify-between shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-violet-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-white tracking-tight">NEXUS Automation Studio</h1>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-500/15 text-violet-400 border border-violet-500/30">
                Autonomous Engine v2.4
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 hidden sm:block">
              Natural-language goal composition, browser automation, WhatsApp gateway, and policy-governed execution
            </p>
          </div>
        </div>

        {/* Sub-tab Navigation */}
        <div className="flex items-center gap-1 bg-white/[0.04] p-1 rounded-xl border border-white/[0.06]">
          {[
            { id: "studio", label: "Studio", icon: Sparkles },
            { id: "whatsapp", label: "WhatsApp", icon: MessageSquare, badge: "Live" },
            { id: "builder", label: "Workflow Builder", icon: GitBranch },
            { id: "history", label: "History", icon: History },
            {
              id: "approvals",
              label: "Approvals",
              icon: ShieldCheck,
              count: pendingApprovals.length,
            },
            { id: "integrations", label: "Integrations", icon: Cpu },
          ].map(({ id, label, icon: Icon, count, badge }) => {
            const isActive = activeSubTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveSubTab(id as any)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? "bg-violet-600 text-white shadow-md shadow-violet-600/30"
                    : "text-neutral-400 hover:text-white hover:bg-white/[0.06]"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
                {count !== undefined && count > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500 text-black ml-1">
                    {count}
                  </span>
                )}
                {badge && (
                  <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 ml-0.5">
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* ========================================================
            SUBVIEW 1: AUTOMATION STUDIO (OBJECTIVE COMPOSER & PRESETS)
           ======================================================== */}
        {activeSubTab === "studio" && (
          <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-6xl mx-auto w-full">
            {/* Universal Objective Composer Card */}
            <div className="p-6 rounded-2xl bg-gradient-to-b from-[#0c0c1a] to-[#070712] border border-white/[0.08] shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-96 h-96 bg-violet-600/10 rounded-full blur-3xl pointer-events-none" />

              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-violet-400" />
                  <h2 className="text-base font-semibold text-white">Universal Autonomous Objective Composer</h2>
                </div>
                <div className="flex items-center gap-1 bg-white/[0.04] p-1 rounded-lg border border-white/[0.06]">
                  {(["manual", "assisted", "autonomous"] as AutonomyMode[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => {
                        setAutonomyMode(mode);
                        if (activePlan) {
                          setActivePlan({ ...activePlan, mode });
                        }
                      }}
                      className={`px-3 py-1 rounded-md text-xs font-semibold capitalize transition-all ${
                        autonomyMode === mode
                          ? mode === "autonomous"
                            ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/30"
                            : mode === "assisted"
                            ? "bg-violet-600 text-white shadow-md shadow-violet-600/30"
                            : "bg-cyan-600 text-white shadow-md shadow-cyan-600/30"
                          : "text-neutral-400 hover:text-white"
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              {/* Mode Description Tag */}
              <div className="mb-4 text-xs flex items-center gap-2 text-neutral-400 bg-white/[0.02] p-2.5 rounded-xl border border-white/[0.04]">
                <Shield className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                <span>
                  {autonomyMode === "manual" && (
                    <strong className="text-cyan-400">Manual Mode: </strong>
                  )}
                  {autonomyMode === "assisted" && (
                    <strong className="text-violet-400">Assisted Mode: </strong>
                  )}
                  {autonomyMode === "autonomous" && (
                    <strong className="text-emerald-400">Autonomous Mode: </strong>
                  )}
                  {autonomyMode === "manual" &&
                    "Plans workflow steps. Requires explicit approval before any external action, write, or communication."}
                  {autonomyMode === "assisted" &&
                    "Safely executes internal reads, code gen, and research automatically. Pauses for human approval on external communication and forms."}
                  {autonomyMode === "autonomous" &&
                    "Executes pre-authorized actions within defined resource budgets. Only halts on high-risk irreversible operations."}
                </span>
              </div>

              {/* Text Input */}
              <div className="relative">
                <textarea
                  value={objectivePrompt}
                  onChange={(e) => setObjectivePrompt(e.target.value)}
                  placeholder="What goal should NEXUS accomplish? (e.g. 'Research and compare three AI coding tools and save a report', 'Draft a WhatsApp message to +1 555-0199 and request approval', 'Capture https://news.ycombinator.com and audit typography', 'Generate Python code for LRU cache and run sandbox tests')"
                  rows={3}
                  className="w-full px-4 py-3 bg-[#05050b] text-neutral-100 placeholder-neutral-500 rounded-xl border border-white/[0.1] focus:outline-none focus:border-violet-500/80 text-sm resize-none shadow-inner transition-colors"
                />
              </div>

              {/* Validation Errors */}
              {planErrors.length > 0 && (
                <div className="mt-3 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-start gap-2 text-xs text-rose-300">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">Plan Validation Alert:</span>
                    <ul className="list-disc list-inside mt-1 space-y-0.5">
                      {planErrors.map((err, idx) => (
                        <li key={idx}>{err}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* Controls */}
              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-neutral-400">
                  <Cpu className="w-3.5 h-3.5 text-neutral-500" />
                  <span>Configured Model: <strong>qwen3:8b (Ollama)</strong></span>
                  <span className="text-neutral-600">•</span>
                  <span>PostgreSQL 16 Engine</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handlePlanObjective()}
                    disabled={isPlanning || !objectivePrompt.trim()}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-white/[0.06] hover:bg-white/[0.1] text-white border border-white/[0.1] transition flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {isPlanning ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <GitBranch className="w-3.5 h-3.5 text-violet-400" />
                    )}
                    <span>Preview Plan</span>
                  </button>

                  <button
                    onClick={handleLaunchPlan}
                    disabled={isExecuting || (!activePlan && !objectivePrompt.trim())}
                    className="px-5 py-2 rounded-xl text-xs font-semibold bg-gradient-to-r from-violet-600 to-emerald-600 hover:from-violet-500 hover:to-emerald-500 text-white shadow-lg shadow-violet-600/30 transition flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {isExecuting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5 fill-current" />
                    )}
                    <span>Launch Autonomous Workflow</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Structured Plan Preview (If generated) */}
            {activePlan && (
              <div className="p-5 rounded-2xl bg-[#090915] border border-violet-500/20 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-sm font-semibold text-white">Execution Plan Overview</h3>
                    <span className="text-xs px-2 py-0.5 rounded bg-violet-500/15 text-violet-400 border border-violet-500/30">
                      {activePlan.steps.length} Steps
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-white/[0.05] text-neutral-400">
                      Budget: {activePlan.resourceBudget.timeoutSec}s max
                    </span>
                  </div>
                  <span className="text-xs text-neutral-400">
                    Completion Criteria: {activePlan.completionCriteria}
                  </span>
                </div>

                {/* Steps List */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  {activePlan.steps.map((st, i) => (
                    <div
                      key={st.id}
                      className="p-3.5 rounded-xl bg-[#06060e] border border-white/[0.06] flex flex-col justify-between space-y-2"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-600/20 text-violet-300">
                            Step {i + 1}
                          </span>
                          {st.requiresApproval ? (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 flex items-center gap-0.5">
                              <ShieldAlert className="w-2.5 h-2.5" /> Approval Gate
                            </span>
                          ) : (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">
                              Auto-Execute
                            </span>
                          )}
                        </div>
                        <h4 className="text-xs font-semibold text-neutral-200">{st.name}</h4>
                        <p className="text-[11px] text-neutral-400 mt-1 line-clamp-2">
                          Type: {st.type}
                        </p>
                      </div>
                      <div className="text-[10px] text-neutral-500 pt-2 border-t border-white/[0.04]">
                        Output: {st.expectedOutput || "Execution result"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Live Progress Bar & Step Timeline when executing */}
            {isExecuting && liveSteps.length > 0 && (
              <div className="p-5 rounded-2xl bg-[#070b14] border border-cyan-500/30 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
                    <h3 className="text-sm font-semibold text-white">Live Execution Progress</h3>
                  </div>
                  <button
                    onClick={() => {
                      if (currentExecution?.id) {
                        automationApi.cancelExecution(currentExecution.id);
                      }
                    }}
                    className="px-2.5 py-1 rounded-lg text-xs bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 transition flex items-center gap-1"
                  >
                    <StopCircle className="w-3.5 h-3.5" />
                    <span>Cancel Workflow</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {liveSteps.map((ls, idx) => (
                    <div
                      key={ls.id}
                      className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-lg bg-white/[0.05] flex items-center justify-center text-xs font-bold text-neutral-300">
                          {idx + 1}
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-white">{ls.name}</div>
                          <div className="text-[11px] text-neutral-400">Type: {ls.type}</div>
                        </div>
                      </div>

                      <div>
                        {ls.status === "completed" && (
                          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/20 text-emerald-400 flex items-center gap-1">
                            <Check className="w-3 h-3" /> Done
                          </span>
                        )}
                        {ls.status === "running" && (
                          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-cyan-500/20 text-cyan-400 flex items-center gap-1 animate-pulse">
                            <Loader2 className="w-3 h-3 animate-spin" /> Running
                          </span>
                        )}
                        {ls.status === "waiting_approval" && (
                          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-500/20 text-amber-400 flex items-center gap-1">
                            <ShieldAlert className="w-3 h-3" /> Gated by Approval
                          </span>
                        )}
                        {ls.status === "pending" && (
                          <span className="px-2 py-0.5 rounded text-xs text-neutral-500">Queued</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reusable Workflow Presets */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white tracking-tight">Reusable Workflow Presets</h3>
                  <p className="text-xs text-neutral-400">
                    Production presets with validated capability chains, approval boundaries, and real backend dispatch
                  </p>
                </div>
                <span className="text-xs text-neutral-500">{presets.length} Presets Available</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {presets.map((preset) => (
                  <div
                    key={preset.id}
                    onClick={() => handleSelectPreset(preset)}
                    className="p-5 rounded-2xl bg-[#080812] hover:bg-[#0c0c1c] border border-white/[0.06] hover:border-violet-500/40 transition-all cursor-pointer group flex flex-col justify-between space-y-3"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="w-8 h-8 rounded-lg bg-violet-600/15 text-violet-400 border border-violet-500/20 flex items-center justify-center group-hover:scale-105 transition-transform">
                          {preset.category === "messaging" && <MessageSquare className="w-4 h-4 text-emerald-400" />}
                          {preset.category === "coding" && <Terminal className="w-4 h-4 text-cyan-400" />}
                          {preset.category === "browser" && <Camera className="w-4 h-4 text-amber-400" />}
                          {preset.category === "forms" && <Layers className="w-4 h-4 text-indigo-400" />}
                          {preset.category === "research" && <MicroscopeIcon className="w-4 h-4 text-violet-400" />}
                        </div>
                        <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-white/[0.05] text-neutral-400">
                          {preset.category}
                        </span>
                      </div>

                      <h4 className="text-sm font-bold text-white group-hover:text-violet-300 transition-colors">
                        {preset.name}
                      </h4>
                      <p className="text-xs text-neutral-400 mt-1 line-clamp-2">
                        {preset.description}
                      </p>
                    </div>

                    <div className="pt-3 border-t border-white/[0.04] flex items-center justify-between text-xs">
                      <span className="text-neutral-500">
                        {preset.plan.steps.length} steps • {preset.defaultMode}
                      </span>
                      <span className="text-violet-400 font-semibold flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                        Select Preset <ArrowRight className="w-3 h-3" />
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================
            SUBVIEW 2: WHATSAPP BROWSER AUTOMATION PANEL
           ======================================================== */}
        {activeSubTab === "whatsapp" && (
          <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full space-y-6">
            <div className="p-6 rounded-2xl bg-gradient-to-b from-[#061a12] to-[#040c08] border border-emerald-500/20 shadow-2xl relative">
              <div className="flex items-center justify-between mb-4 pb-4 border-b border-emerald-500/15">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-500/20">
                    <MessageSquare className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-white">WhatsApp Browser Automation Gateway</h2>
                    <p className="text-xs text-neutral-400">
                      E.164 phone verification, approved message templates, live chat bubble preview, and human review gating
                    </p>
                  </div>
                </div>

                {/* Connection Status Indicator */}
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>{waStatus?.channel || "Connected (WhatsApp Web Gateway)"}</span>
                </div>
              </div>

              {/* Form Controls */}
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
                    Recipient Phone Number (International E.164 format)
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-neutral-400 absolute left-3 top-3" />
                    <input
                      type="text"
                      value={waRecipient}
                      onChange={(e) => {
                        setWaRecipient(e.target.value);
                        setPhoneError(null);
                      }}
                      placeholder="+1 (555) 019-2834 or +44 7911 123456"
                      className="w-full pl-9 pr-4 py-2.5 bg-[#030a06] text-white rounded-xl border border-emerald-500/20 focus:outline-none focus:border-emerald-400 text-sm"
                    />
                  </div>
                  {phoneError && (
                    <p className="text-xs text-rose-400 mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" /> {phoneError}
                    </p>
                  )}
                </div>

                {/* Approved Message Template Selector */}
                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
                    Message Template
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { id: "milestone", label: "Milestone Alert", text: "NEXUS Automation Studio: Your autonomous pipeline completed with 4 verified sources and all tests passing." },
                      { id: "research", label: "Research Digest", text: "NEXUS Deep Research: New synthesis ready on 'Open-weights reasoning models'. 12 sources verified." },
                      { id: "security", label: "Security Alert", text: "NEXUS Security Sentinel: Gated action awaiting your explicit human-in-the-loop approval." },
                      { id: "custom", label: "Custom Message", text: "" },
                    ].map((tpl) => (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => {
                          setWaTemplate(tpl.id);
                          if (tpl.text) setWaMessage(tpl.text);
                        }}
                        className={`p-2 rounded-lg text-xs font-medium border text-left transition ${
                          waTemplate === tpl.id
                            ? "bg-emerald-500/20 border-emerald-400 text-emerald-300"
                            : "bg-white/[0.02] border-white/[0.06] text-neutral-400 hover:text-white"
                        }`}
                      >
                        {tpl.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Message Content */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-neutral-300">Message Content</label>
                    <span className="text-[11px] text-neutral-500">{waMessage.length}/4096 chars</span>
                  </div>
                  <textarea
                    value={waMessage}
                    onChange={(e) => setWaMessage(e.target.value)}
                    rows={4}
                    className="w-full p-3 bg-[#030a06] text-white rounded-xl border border-emerald-500/20 focus:outline-none focus:border-emerald-400 text-sm resize-none"
                  />
                </div>

                {/* Approval Requirement Checkbox */}
                <div className="flex items-center gap-2 p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                  <input
                    type="checkbox"
                    id="requireApprovalCheck"
                    checked={waRequiresApproval}
                    onChange={(e) => setWaRequiresApproval(e.target.checked)}
                    className="rounded border-white/20 text-emerald-500 focus:ring-0"
                  />
                  <label htmlFor="requireApprovalCheck" className="text-xs text-neutral-300 cursor-pointer">
                    Require explicit human-in-the-loop review in Approvals Center before dispatch
                  </label>
                </div>

                {/* Live Message Preview Card */}
                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-2">
                    Live Chat Bubble Preview
                  </label>
                  <div className="p-4 rounded-xl bg-[#0b141a] border border-[#202c33] max-w-md">
                    <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/[0.06] text-xs text-neutral-400">
                      <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-[10px]">
                        WA
                      </div>
                      <span className="font-semibold text-white">{waRecipient || "+1 (555) 019-2834"}</span>
                    </div>

                    <div className="bg-[#005c4b] text-white text-xs p-3 rounded-xl rounded-tr-none ml-auto max-w-xs space-y-1 shadow">
                      <p>{waMessage || "Type a message..."}</p>
                      <div className="flex items-center justify-end gap-1 text-[10px] text-emerald-200">
                        <span>{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        <CheckCheck className="w-3.5 h-3.5 text-cyan-300" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Delivery Result */}
                {waLastResult && (
                  <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-1.5 text-xs">
                    <div className="flex items-center gap-2 text-emerald-400 font-bold">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{waLastResult.requiresApproval ? "Approval Requested" : "Message Dispatched Successfully"}</span>
                    </div>
                    <div className="text-neutral-300">
                      Message ID: <code className="bg-black/40 px-1 py-0.5 rounded font-mono text-emerald-300">{waLastResult.messageId}</code>
                    </div>
                    <div className="text-neutral-400">
                      Channel: {waLastResult.channel} • Status: <strong className="text-emerald-400 uppercase">{waLastResult.status}</strong>
                    </div>
                  </div>
                )}

                {/* Send Button */}
                <button
                  onClick={handleSendWhatsApp}
                  disabled={isSendingWa}
                  className="w-full py-3 rounded-xl text-sm font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30 transition flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSendingWa ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  <span>
                    {waRequiresApproval ? "Submit to Approvals Center" : "Send WhatsApp Message Now"}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================
            SUBVIEW 3: WORKFLOW BUILDER (VISUAL NODE CANVAS)
           ======================================================== */}
        {activeSubTab === "builder" && (
          <NexusVisualBuilder
            onOpenInBrowser={onOpenInBrowser}
            workspaceId={workspaceId || undefined}
          />
        )}

        {/* ========================================================
            SUBVIEW 4: EXECUTION HISTORY
           ======================================================== */}
        {activeSubTab === "history" && (
          <div className="flex-1 overflow-y-auto p-6 max-w-5xl mx-auto w-full space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-white">Execution History</h2>
                <p className="text-xs text-neutral-400">
                  Persistent log of autonomous workflow runs with step-by-step telemetry and retry controls
                </p>
              </div>

              {/* Status Filter */}
              <div className="flex items-center gap-1 bg-white/[0.04] p-1 rounded-lg border border-white/[0.06]">
                {["all", "running", "completed", "failed", "cancelled"].map((st) => (
                  <button
                    key={st}
                    onClick={() => {
                      setHistoryFilter(st);
                      automationApi.getExecutions(st !== "all" ? st : undefined).then((res) => {
                        setExecutions(res.executions || []);
                      });
                    }}
                    className={`px-2.5 py-1 rounded text-xs font-medium capitalize transition ${
                      historyFilter === st
                        ? "bg-violet-600 text-white"
                        : "text-neutral-400 hover:text-white"
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            {executions.length === 0 ? (
              <div className="p-12 text-center rounded-2xl bg-white/[0.02] border border-white/[0.06]">
                <Clock className="w-8 h-8 text-neutral-600 mx-auto mb-2" />
                <p className="text-sm text-neutral-400">No execution records found matching filter</p>
              </div>
            ) : (
              <div className="space-y-3">
                {executions.map((exec) => (
                  <div
                    key={exec.id}
                    className="p-4 rounded-2xl bg-[#080814] border border-white/[0.06] hover:border-violet-500/30 transition space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            exec.status === "completed"
                              ? "bg-emerald-400"
                              : exec.status === "running"
                              ? "bg-cyan-400 animate-pulse"
                              : "bg-rose-400"
                          }`}
                        />
                        <h4 className="text-xs font-bold text-white">
                          {exec.workflow?.name || "Autonomous Workflow"}
                        </h4>
                        <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-white/[0.06] text-neutral-400">
                          {exec.mode || "assisted"}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-neutral-500">
                          {new Date(exec.startedAt).toLocaleString()}
                        </span>
                        {(exec.status === "failed" || exec.status === "cancelled") && (
                          <button
                            onClick={async () => {
                              toast.info("Retrying execution...");
                              await automationApi.retryExecution(exec.id);
                              loadHistory();
                            }}
                            className="px-2 py-0.5 rounded bg-violet-600/20 text-violet-300 hover:bg-violet-600/30 transition flex items-center gap-1 text-[11px]"
                          >
                            <RotateCcw className="w-3 h-3" /> Retry
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Steps Telemetry */}
                    {exec.steps && exec.steps.length > 0 && (
                      <div className="flex items-center gap-1.5 overflow-x-auto pt-1">
                        {exec.steps.map((st, i) => (
                          <div
                            key={st.id || i}
                            className={`px-2 py-1 rounded text-[10px] font-mono shrink-0 flex items-center gap-1 ${
                              st.status === "completed"
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                : "bg-white/[0.04] text-neutral-400"
                            }`}
                          >
                            <span>{st.stepId}</span>
                            {st.status === "completed" && <Check className="w-2.5 h-2.5" />}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ========================================================
            SUBVIEW 5: APPROVALS CENTER
           ======================================================== */}
        {activeSubTab === "approvals" && (
          <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <ShieldAlert className="w-5 h-5 text-amber-400" />
                <h2 className="text-base font-bold text-white">Human-in-the-Loop Approvals Center</h2>
              </div>
              <p className="text-xs text-neutral-400">
                Review and authorize sensitive agent actions, external messaging, and consequential mutations
              </p>
            </div>

            {pendingApprovals.length === 0 ? (
              <div className="p-12 text-center rounded-2xl bg-[#06060e] border border-white/[0.06] space-y-2">
                <ShieldCheck className="w-8 h-8 text-emerald-400 mx-auto" />
                <p className="text-sm font-semibold text-white">All Clear — No Pending Approvals</p>
                <p className="text-xs text-neutral-500 max-w-sm mx-auto">
                  When autonomous workflows reach approval boundaries (such as sending messages or submitting forms), they will pause here for sign-off.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingApprovals.map((appr) => (
                  <div
                    key={appr.id}
                    className="p-5 rounded-2xl bg-[#090916] border border-amber-500/30 shadow-xl space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40 uppercase">
                          {appr.riskLevel || "MODERATE RISK"}
                        </span>
                        <h4 className="text-sm font-bold text-white">{appr.action}</h4>
                      </div>
                      <span className="text-xs text-neutral-500">
                        {new Date(appr.createdAt).toLocaleTimeString()}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-black/40 border border-white/[0.04] text-xs space-y-1">
                      <div className="text-neutral-400">
                        Target / Recipient: <strong className="text-white">{appr.target}</strong>
                      </div>
                      {appr.details && (
                        <div className="text-neutral-400">
                          Payload:{" "}
                          <span className="text-neutral-200">
                            {typeof appr.details === "string"
                              ? appr.details
                              : JSON.stringify(appr.details)}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.04]">
                      <button
                        onClick={() => handleResolveApproval(appr.id, false)}
                        disabled={isResolvingApproval}
                        className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-white/[0.06] hover:bg-rose-500/20 hover:text-rose-400 text-neutral-300 transition"
                      >
                        Reject Action
                      </button>
                      <button
                        onClick={() => handleResolveApproval(appr.id, true)}
                        disabled={isResolvingApproval}
                        className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/30 transition flex items-center gap-1"
                      >
                        <Check className="w-3.5 h-3.5" /> Authorize & Resume
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ========================================================
            SUBVIEW 6: INTEGRATIONS REGISTRY
           ======================================================== */}
        {activeSubTab === "integrations" && (
          <div className="flex-1 overflow-y-auto p-6 max-w-5xl mx-auto w-full space-y-4">
            <div>
              <h2 className="text-sm font-bold text-white">Integration Connections Registry</h2>
              <p className="text-xs text-neutral-400">
                Verified connections, credential statuses, and live health ping diagnostics
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {integrations.map((conn) => (
                <div
                  key={conn.id || conn.provider}
                  className="p-5 rounded-2xl bg-[#080814] border border-white/[0.06] space-y-3 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-bold text-white">{conn.name}</h4>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase flex items-center gap-1 ${
                          conn.status === "connected"
                            ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                            : "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        {conn.status}
                      </span>
                    </div>

                    <p className="text-xs text-neutral-400">{conn.description}</p>

                    {/* Scopes */}
                    <div className="flex flex-wrap gap-1 mt-2.5">
                      {conn.scopes.map((sc, i) => (
                        <span
                          key={i}
                          className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-white/[0.04] text-neutral-400"
                        >
                          {sc}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-white/[0.04] flex items-center justify-between text-xs">
                    <span className="text-neutral-500">Latency: {conn.latencyMs}ms</span>
                    <button
                      onClick={() => handleVerifyIntegration(conn.provider)}
                      disabled={isVerifyingMap[conn.provider]}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white/[0.06] hover:bg-white/[0.1] text-white transition flex items-center gap-1"
                    >
                      {isVerifyingMap[conn.provider] ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3 h-3" />
                      )}
                      <span>Verify Connection</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Create Pipeline Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0a0a16] border border-white/[0.1] rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Create New Pipeline</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-neutral-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-neutral-300 block mb-1">Pipeline Name</label>
                <input
                  type="text"
                  value={newWfName}
                  onChange={(e) => setNewWfName(e.target.value)}
                  placeholder="e.g. Daily Tech Radar"
                  className="w-full p-2.5 bg-[#05050e] rounded-xl border border-white/[0.1] text-xs text-white"
                />
              </div>
              <div>
                <label className="text-xs text-neutral-300 block mb-1">Description</label>
                <textarea
                  value={newWfDesc}
                  onChange={(e) => setNewWfDesc(e.target.value)}
                  placeholder="Summary of pipeline capabilities..."
                  rows={2}
                  className="w-full p-2.5 bg-[#05050e] rounded-xl border border-white/[0.1] text-xs text-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 rounded-xl text-xs text-neutral-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!newWfName.trim()) return;
                  const wsRes = await nexusClient.getWorkspaces();
                  const wsId = workspaceId || wsRes.workspaces?.[0]?.id;
                  if (!wsId) return;
                  await nexusClient.createWorkflow(
                    wsId,
                    newWfName.trim(),
                    {
                      trigger: { type: "manual" },
                      steps: [
                        { id: "step-1", name: "Target Navigation", type: "browser.navigate", url: newWfTargetUrl },
                        { id: "step-2", name: "Extract Content", type: "browser.extract", selector: "body" },
                        { id: "step-3", name: "AI Synthesis", type: "ai_action", prompt: "Summarize findings" },
                      ],
                    },
                    newWfDesc.trim() || "Autonomous workflow"
                  );
                  setShowCreateModal(false);
                  setNewWfName("");
                  setNewWfDesc("");
                  await loadWorkflows();
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-violet-600 hover:bg-violet-500 text-white"
              >
                Create Pipeline
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Step Modal */}
      {showAddStepModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0a0a16] border border-white/[0.1] rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Add Step to Pipeline</h3>
              <button onClick={() => setShowAddStepModal(false)} className="text-neutral-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-neutral-300 block mb-1">Step Name</label>
                <input
                  type="text"
                  value={newStepName}
                  onChange={(e) => setNewStepName(e.target.value)}
                  placeholder="e.g. Scrape Price Matrix"
                  className="w-full p-2.5 bg-[#05050e] rounded-xl border border-white/[0.1] text-xs text-white"
                />
              </div>

              <div>
                <label className="text-xs text-neutral-300 block mb-1">Step Type</label>
                <select
                  value={newStepType}
                  onChange={(e) => setNewStepType(e.target.value)}
                  className="w-full p-2.5 bg-[#05050e] rounded-xl border border-white/[0.1] text-xs text-white"
                >
                  <option value="browser.navigate">Browser: Navigate URL</option>
                  <option value="browser.extract">Browser: Extract DOM</option>
                  <option value="browser.whatsappSend">WhatsApp: Send Notification</option>
                  <option value="ai.synthesize">AI: Synthesize Analysis</option>
                  <option value="coding.execute">Coding: Execute in Sandbox</option>
                  <option value="memory.save">Memory: Save to Vault</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowAddStepModal(false)}
                className="px-4 py-2 rounded-xl text-xs text-neutral-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!selectedWorkflow || !newStepName.trim()) return;
                  await nexusClient.addWorkflowStep(selectedWorkflow.id, {
                    name: newStepName.trim(),
                    type: newStepType,
                  });
                  setShowAddStepModal(false);
                  setNewStepName("");
                  await loadWorkflowDetails(selectedWorkflow.id);
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-violet-600 hover:bg-violet-500 text-white"
              >
                Add Step
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Helper component for Research icon
const MicroscopeIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6 18h8" />
    <path d="M3 22h18" />
    <path d="m14 14-3.5 3.5a1.5 1.5 0 0 1-2.12 0l-.88-.88a1.5 1.5 0 0 1 0-2.12L11 11" />
    <path d="M9 7l4 4" />
    <path d="m20 4-3.5 3.5" />
    <path d="m17 7 3 3" />
    <path d="m12 2 8 8" />
  </svg>
);
