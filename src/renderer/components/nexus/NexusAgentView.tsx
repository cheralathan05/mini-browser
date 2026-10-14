import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Bot,
  Play,
  Pause,
  Square,
  RotateCcw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Sparkles,
  Terminal,
  Globe,
  Clock,
  ArrowRight,
  ArrowLeft,
  Copy,
  Check,
  Download,
  ExternalLink,
  ShieldAlert,
  ShieldCheck,
  Layers,
  Cpu,
  FileText,
  Database,
  Search,
  Zap,
  ChevronRight,
  Filter,
  Eye,
  Code2,
  AlertTriangle,
  RefreshCw,
  MessageSquare,
  Sliders,
  Send,
  Plus,
  Trash2,
  MoveUp,
  MoveDown,
  Monitor,
  CheckCheck,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { nexusClient } from "../../lib/nexus/nexus-client";
import { nexusWs } from "../../lib/nexus/nexus-ws";
import {
  AgentApi,
  AgentTask,
  AgentRun,
  AgentStep,
  AgentArtifact,
  AgentObservation,
  ApprovalRequest,
} from "../../lib/nexus/agent.api";
import { useToast } from "./NexusToast";

interface NexusAgentViewProps {
  onOpenInBrowser?: (url: string, title?: string, agentControlled?: boolean, agentAction?: string) => void;
  workspaceId?: string | null;
}

interface TelemetryLog {
  id: string;
  timestamp: string;
  level: "info" | "tool" | "observe" | "verify" | "warn" | "error" | "state";
  message: string;
  metadata?: any;
}

export interface VisualStep {
  id: string;
  toolName: string;
  name: string;
  description: string;
  input: Record<string, any>;
  status?: "idle" | "running" | "completed" | "failed";
}

const DEFAULT_BUILDER_STEPS: VisualStep[] = [
  {
    id: "step-1",
    toolName: "browser.navigate",
    name: "Navigate to Web Portal",
    description: "Open the destination web service in an isolated browser tab",
    input: { url: "https://news.ycombinator.com" },
  },
  {
    id: "step-2",
    toolName: "browser.extractContent",
    name: "Extract DOM Tree & Text",
    description: "Capture visible page content and headings into structured context",
    input: { selector: "body", maxLength: 6000 },
  },
  {
    id: "step-3",
    toolName: "ai.synthesize",
    name: "Synthesize with Local AI",
    description: "Analyze extracted text using Ollama / local neural model",
    input: { prompt: "Extract key developments and actionable points" },
  },
  {
    id: "step-4",
    toolName: "memory.save",
    name: "Record to PostgreSQL Vault",
    description: "Persist execution audit trail and findings into database memory",
    input: { title: "Automated Web Synthesis", category: "Research" },
  },
];

const PRESET_GOALS = [
  {
    title: "Trending Intelligence Scraper",
    goal: "Scrape top 10 trending items from Hacker News, extract discussions and headings, and compile comparison matrix",
    category: "Scraping",
    icon: Globe,
  },
  {
    title: "AI Framework Benchmark & Report",
    goal: "Research top 5 AI browser automation frameworks, compare their architectures, and generate a report",
    category: "Research",
    icon: Cpu,
  },
  {
    title: "Web Portal Form Auto-Submitter",
    goal: "Navigate to user registration portal, populate all required fields with verified data, and submit form",
    category: "Form Filling",
    icon: FileText,
  },
  {
    title: "WhatsApp Real Browser Automation",
    goal: "Navigate to WhatsApp Web, search for active conversation, compose message, and dispatch",
    category: "Messaging",
    icon: MessageSquare,
  },
];

export const NexusAgentView: React.FC<NexusAgentViewProps> = ({ onOpenInBrowser, workspaceId }) => {
  // Navigation / View modes
  const [activeTab, setActiveTab] = useState<"composer" | "builder" | "templates" | "inspector" | "history">("composer");
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<AgentTask | null>(null);
  const [activeRun, setActiveRun] = useState<AgentRun | null>(null);

  // Inspector selection
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState<"actions" | "telemetry" | "artifacts" | "approvals">("actions");
  const [logFilter, setLogFilter] = useState<"all" | "tools" | "state" | "errors">("all");

  // Telemetry logs
  const [logs, setLogs] = useState<TelemetryLog[]>([]);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Composer state
  const [goal, setGoal] = useState("");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [mode, setMode] = useState<"balanced" | "quick" | "advanced">("balanced");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // WhatsApp Quick Drawer state (clean real inputs)
  const [waPhone, setWaPhone] = useState("");
  const [waMessage, setWaMessage] = useState("");
  const [isLaunchingWa, setIsLaunchingWa] = useState(false);

  // Visual Workflow Builder state
  const [builderSteps, setBuilderSteps] = useState<VisualStep[]>(DEFAULT_BUILDER_STEPS);
  const [workflowName, setWorkflowName] = useState("Web Synthesis & Extraction Pipeline");
  const [isSavingWorkflow, setIsSavingWorkflow] = useState(false);
  const [newStepType, setNewStepType] = useState("browser.navigate");

  // Approvals & Memory
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const [isSavingMemory, setIsSavingMemory] = useState(false);
  const [copiedArtifact, setCopiedArtifact] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const toast = useToast();

  // -------------------------------------------------------------
  // Load tasks from backend
  // -------------------------------------------------------------
  const loadTasks = async () => {
    try {
      const res = await AgentApi.getTasks(workspaceId || undefined);
      const loadedTasks = res.tasks || [];
      setTasks(loadedTasks);

      if (activeTaskId) {
        const found = loadedTasks.find((t) => t.id === activeTaskId);
        if (found) {
          setActiveTask(found);
          const latestRun = found.runs?.[0] || null;
          setActiveRun(latestRun);
        }
      }
    } catch (e: any) {
      console.warn("[NexusAgentView] Error loading tasks:", e.message);
    }
  };

  // -------------------------------------------------------------
  // Load specific task details & run telemetry
  // -------------------------------------------------------------
  const loadTaskDetails = async (taskId: string) => {
    try {
      const { task } = await AgentApi.getTaskById(taskId);
      setActiveTask(task);
      const latestRun = task.runs?.[0] || null;
      setActiveRun(latestRun);

      if (latestRun?.artifacts && latestRun.artifacts.length > 0) {
        setSelectedArtifactId(latestRun.artifacts[0].id);
      }

      try {
        const appRes = await AgentApi.getPendingApprovals();
        setPendingApprovals(appRes.approvals || []);
        if (appRes.approvals && appRes.approvals.length > 0) {
          setRightPanelTab("approvals");
        }
      } catch {}
    } catch (e: any) {
      console.error("[NexusAgentView] Failed to load task details:", e);
    }
  };

  // -------------------------------------------------------------
  // Realtime WebSocket subscriptions & lifecycle
  // -------------------------------------------------------------
  useEffect(() => {
    loadTasks();

    const unsubState = nexusWs.subscribe("agent.*", (msg: any) => {
      if (msg?.event) handleAgentEvent(msg.event, msg.payload);
    });

    const unsubSpecific = [
      nexusWs.subscribe("agent.started", (p) => handleAgentEvent("agent.started", p)),
      nexusWs.subscribe("agent.stepStarted", (p) => handleAgentEvent("agent.stepStarted", p)),
      nexusWs.subscribe("agent.toolStarted", (p) => handleAgentEvent("agent.toolStarted", p)),
      nexusWs.subscribe("agent.toolCompleted", (p) => handleAgentEvent("agent.toolCompleted", p)),
      nexusWs.subscribe("agent.observationCreated", (p) => handleAgentEvent("agent.observationCreated", p)),
      nexusWs.subscribe("agent.stepCompleted", (p) => handleAgentEvent("agent.stepCompleted", p)),
      nexusWs.subscribe("agent.approvalRequired", (p) => handleAgentEvent("agent.approvalRequired", p)),
      nexusWs.subscribe("agent.paused", (p) => handleAgentEvent("agent.paused", p)),
      nexusWs.subscribe("agent.resumed", (p) => handleAgentEvent("agent.resumed", p)),
      nexusWs.subscribe("agent.completed", (p) => handleAgentEvent("agent.completed", p)),
      nexusWs.subscribe("agent.failed", (p) => handleAgentEvent("agent.failed", p)),
      nexusWs.subscribe("agent.cancelled", (p) => handleAgentEvent("agent.cancelled", p)),
      nexusWs.subscribe("browser.navigation", (p) => handleAgentEvent("browser.navigation", p)),
      nexusWs.subscribe("browser.action", (p) => handleAgentEvent("browser.action", p)),
    ];

    return () => {
      unsubState();
      unsubSpecific.forEach((fn) => fn());
    };
  }, [workspaceId, activeTaskId]);

  const appendLog = (level: TelemetryLog["level"], message: string, metadata?: any) => {
    const time = new Date().toLocaleTimeString("en-US", { hour12: false });
    setLogs((prev) => [
      ...prev.slice(-150),
      { id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, timestamp: time, level, message, metadata },
    ]);
  };

  const handleAgentEvent = (event: string, payload: any) => {
    if (!payload) return;

    if (payload.taskId && activeTaskId && payload.taskId !== activeTaskId) {
      loadTasks();
      return;
    }

    switch (event) {
      case "agent.started":
        appendLog("state", `Autonomous execution started for task "${payload.title || payload.taskId}"`);
        loadTasks();
        if (activeTaskId) loadTaskDetails(activeTaskId);
        break;

      case "agent.stepStarted":
        appendLog("state", `[Step ${payload.stepIndex + 1 || ""}] ${payload.description || payload.name || ""}`);
        if (activeTaskId) loadTaskDetails(activeTaskId);
        break;

      case "agent.toolStarted":
        appendLog("tool", `Invoking tool: [${payload.toolName}]`, payload.parameters);
        break;

      case "agent.toolCompleted":
        appendLog("tool", `Tool [${payload.toolName}] executed cleanly (${payload.durationMs || 0}ms)`, payload.result);
        if (activeTaskId) loadTaskDetails(activeTaskId);
        break;

      case "browser.navigation":
        appendLog("tool", `Browser navigated to: ${payload.url} [Status ${payload.status || 200}]`, payload);
        break;

      case "browser.action":
        appendLog("tool", `Real Browser Action: ${payload.action?.toUpperCase()}`, payload);
        break;

      case "agent.stepCompleted":
        appendLog("verify", `Step completed successfully.`);
        if (activeTaskId) loadTaskDetails(activeTaskId);
        break;

      case "agent.completed":
        appendLog("state", `Autonomous task execution successfully completed!`);
        toast.success("Autonomous automation completed successfully!");
        loadTasks();
        if (activeTaskId) loadTaskDetails(activeTaskId);
        break;

      case "agent.failed":
        appendLog("error", `Task execution failed: ${payload.error || payload.reason}`);
        toast.error(`Automation failed: ${payload.error || payload.reason}`);
        loadTasks();
        if (activeTaskId) loadTaskDetails(activeTaskId);
        break;

      default:
        break;
    }
  };

  // Auto-scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // -------------------------------------------------------------
  // Execution Dispatcher
  // -------------------------------------------------------------
  const launchAutomationGoal = async (targetGoal: string, customTitle?: string) => {
    if (!targetGoal.trim() || isSubmitting) return;
    setIsSubmitting(true);

    try {
      let wsId = workspaceId;
      if (!wsId) {
        const wsRes = await nexusClient.getWorkspaces();
        wsId = wsRes.workspaces?.[0]?.id;
      }
      if (!wsId) {
        toast.warning("Please create or select a workspace first.");
        setIsSubmitting(false);
        return;
      }

      const taskTitle = customTitle || targetGoal.slice(0, 70).trim();
      const res = await AgentApi.createTask({
        workspaceId: wsId,
        title: taskTitle,
        goal: targetGoal.trim(),
        priority,
        mode,
      });

      toast.success("Autonomous automation started!");
      setActiveTaskId(res.task.id);
      setActiveTask(res.task);
      setActiveRun(res.run);
      setActiveTab("inspector");
      setLogs([]);
      appendLog("state", `Initialized: "${taskTitle}"`);

      await loadTasks();
      await loadTaskDetails(res.task.id);

      // If it's a WhatsApp automation, open WhatsApp Web in the browser tab
      if (
        targetGoal.toLowerCase().includes("whatsapp") ||
        targetGoal.toLowerCase().includes("whatpapp")
      ) {
        const phone = waPhone.trim();
        const text = waMessage.trim();
        const waUrl = phone
          ? `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text || "Hello")}`
          : `https://web.whatsapp.com`;
        if (onOpenInBrowser) {
          onOpenInBrowser(waUrl, phone ? `WhatsApp: ${phone}` : "WhatsApp Web", true, phone ? `Dispatching message to ${phone}` : "WhatsApp Web Automation");
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to launch autonomous agent");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLaunchComposer = (e: React.FormEvent) => {
    e.preventDefault();
    launchAutomationGoal(goal, title);
  };

  const handleLaunchWhatsApp = async () => {
    if (!waPhone.trim()) {
      toast.warning("Please enter a recipient phone number");
      return;
    }
    setIsLaunchingWa(true);
    const msg = waMessage.trim() || "Hello";
    const waGoal = `Go to WhatsApp Web, send '${msg}' message to ${waPhone.trim()} number`;
    await launchAutomationGoal(waGoal, `WhatsApp Automation: Send to ${waPhone.trim()}`);
    setIsLaunchingWa(false);
  };

  const handleRunVisualWorkflow = async () => {
    const stepsSummary = builderSteps.map((s, i) => `${i + 1}. ${s.name}: ${s.description}`).join(", ");
    const visualGoal = `Execute customized ${workflowName}: ${stepsSummary}`;
    await launchAutomationGoal(visualGoal, workflowName);
  };

  const handleSaveWorkflowToDb = async () => {
    setIsSavingWorkflow(true);
    try {
      const wsRes = await nexusClient.getWorkspaces();
      const wsId = wsRes.workspaces?.[0]?.id;
      if (!wsId) throw new Error("No workspace found");

      await nexusClient.createWorkflow(
        wsId,
        workflowName,
        { steps: builderSteps, updatedAt: new Date().toISOString() },
        `Custom ${builderSteps.length}-step browser automation pipeline`
      );

      toast.success("Workflow pipeline saved into PostgreSQL Database!");
    } catch (err: any) {
      toast.error(err.message || "Failed to save workflow");
    } finally {
      setIsSavingWorkflow(false);
    }
  };

  // Execution controls
  const handlePause = async () => {
    if (!activeTaskId) return;
    try {
      await AgentApi.pauseTask(activeTaskId);
      toast.info("Execution loop paused.");
      await loadTaskDetails(activeTaskId);
    } catch (err: any) {
      toast.error(err.message || "Failed to pause execution");
    }
  };

  const handleResume = async () => {
    if (!activeTaskId) return;
    try {
      await AgentApi.resumeTask(activeTaskId);
      toast.success("Execution loop resumed.");
      await loadTaskDetails(activeTaskId);
    } catch (err: any) {
      toast.error(err.message || "Failed to resume execution");
    }
  };

  const handleCancel = async () => {
    if (!activeTaskId) return;
    try {
      await AgentApi.cancelTask(activeTaskId);
      toast.warning("Execution cancelled.");
      await loadTaskDetails(activeTaskId);
      await loadTasks();
    } catch (err: any) {
      toast.error(err.message || "Failed to cancel task");
    }
  };

  const handleRetry = async () => {
    if (!activeTaskId) return;
    try {
      await AgentApi.retryTask(activeTaskId);
      toast.info("Retrying autonomous execution...");
      setLogs([]);
      appendLog("state", `Retrying task execution for ${activeTask?.title}`);
      await loadTaskDetails(activeTaskId);
      await loadTasks();
    } catch (err: any) {
      toast.error(err.message || "Failed to retry task");
    }
  };

  const handleResolveApproval = async (approvalId: string, decision: "APPROVED" | "REJECTED") => {
    try {
      await AgentApi.resolveApproval(approvalId, decision);
      toast.success(decision === "APPROVED" ? "Operation authorized." : "Operation rejected.");
      if (activeTaskId) await loadTaskDetails(activeTaskId);
    } catch (err: any) {
      toast.error(err.message || "Failed to resolve approval");
    }
  };

  const handleSaveReportToMemory = async (artifact: AgentArtifact) => {
    if (!artifact || isSavingMemory) return;
    setIsSavingMemory(true);
    try {
      await nexusClient.createMemory({
        title: artifact.name,
        content: artifact.content,
        summary: `Autonomous Report: ${activeTask?.title || "Automation"}`,
        type: "INSIGHT",
        category: "Automation",
        importance: 0.95,
      });
      toast.success("Report successfully persisted into PostgreSQL Long-Term Memory!");
    } catch (err: any) {
      toast.error(err.message || "Failed to save into memory");
    } finally {
      setIsSavingMemory(false);
    }
  };

  // Step Builder utilities
  const moveStep = (index: number, direction: "up" | "down") => {
    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= builderSteps.length) return;
    const next = [...builderSteps];
    const temp = next[index];
    next[index] = next[targetIdx];
    next[targetIdx] = temp;
    setBuilderSteps(next);
  };

  const removeStep = (index: number) => {
    setBuilderSteps((prev) => prev.filter((_, i) => i !== index));
  };

  const addStep = () => {
    const id = `step-${Date.now()}`;
    let newStep: VisualStep = {
      id,
      toolName: newStepType,
      name: `Execute ${newStepType.replace("browser.", "")}`,
      description: "Automated browser action",
      input: {},
    };

    if (newStepType === "browser.navigate") {
      newStep.input = { url: "https://example.com" };
      newStep.name = "Navigate to URL";
    } else if (newStepType === "browser.whatsappSend") {
      newStep.input = { phone: "229093", message: "Hi!" };
      newStep.name = "Send WhatsApp Message";
    } else if (newStepType === "browser.waitForSelector") {
      newStep.input = { selector: "button, div", timeoutMs: 3000 };
      newStep.name = "Wait for DOM Element";
    } else if (newStepType === "browser.type") {
      newStep.input = { selector: "input", text: "Automated Input" };
      newStep.name = "Type Text into Input";
    } else if (newStepType === "browser.click") {
      newStep.input = { selector: "button[type='submit']" };
      newStep.name = "Click Element";
    } else if (newStepType === "browser.pressKey") {
      newStep.input = { key: "Enter" };
      newStep.name = "Press Keyboard Key";
    } else if (newStepType === "browser.extract") {
      newStep.input = { selector: "body" };
      newStep.name = "Extract Page Data";
    } else if (newStepType === "browser.executeScript") {
      newStep.input = { script: "() => window.title" };
      newStep.name = "Run Custom JavaScript";
    }

    setBuilderSteps((prev) => [...prev, newStep]);
    toast.success(`Added ${newStep.name}`);
  };

  // Computations
  const filteredTasks = useMemo(() => {
    if (filterStatus === "all") return tasks;
    return tasks.filter((t) => t.status === filterStatus);
  }, [tasks, filterStatus]);

  const activeSteps: AgentStep[] = activeRun?.steps || [];
  const currentStep =
    activeSteps.find((s) => s.id === selectedStepId) ||
    activeSteps.find((s) => s.status === "RUNNING") ||
    activeSteps[0] ||
    null;

  const activeArtifacts: AgentArtifact[] = activeRun?.artifacts || [];
  const currentArtifact =
    activeArtifacts.find((a) => a.id === selectedArtifactId) || activeArtifacts[0] || null;

  const progressPercent = activeRun?.progress || (activeTask?.status === "completed" ? 100 : 0);
  const isRunning = activeTask?.status === "running" || activeRun?.status === "RUNNING";
  const isPaused = activeTask?.status === "paused" || activeRun?.status === "PAUSED";
  const isCompleted = activeTask?.status === "completed" || activeRun?.status === "COMPLETED";
  const isFailed = activeTask?.status === "failed" || activeRun?.status === "FAILED";

  const filteredLogs = useMemo(() => {
    if (logFilter === "all") return logs;
    if (logFilter === "tools") return logs.filter((l) => l.level === "tool");
    if (logFilter === "state") return logs.filter((l) => l.level === "state" || l.level === "verify");
    if (logFilter === "errors") return logs.filter((l) => l.level === "error" || l.level === "warn");
    return logs;
  }, [logs, logFilter]);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#05060a] text-neutral-100 overflow-hidden font-sans select-none">
      {/* ══════════════════════════════════════════════════════════════
          TOP COMMAND STUDIO HEADER (ZERO-OVERLAP ARCHITECTURE)
          ══════════════════════════════════════════════════════════════ */}
      <header className="h-14 px-6 border-b border-white/[0.08] bg-[#070810]/95 backdrop-blur flex items-center justify-between shrink-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-violet-600 to-cyan-500 p-[1px] shadow-lg shadow-violet-600/20">
            <div className="w-full h-full bg-[#070810] rounded-[11px] flex items-center justify-center">
              <Zap className="w-4 h-4 text-cyan-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold tracking-wider text-white uppercase font-mono">
                NEXUS AUTOMATION STUDIO
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                ONLINE • REAL BROWSER ENGINE
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 hidden sm:block">
              Multi-step autonomous browser actions, WhatsApp dispatch, web scraping & database persistence
            </p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1 bg-[#0c0d18] p-1 rounded-xl border border-white/[0.08]">
          <button
            type="button"
            onClick={() => setActiveTab("composer")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              activeTab === "composer"
                ? "bg-violet-600 text-white shadow-md shadow-violet-600/30"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Composer</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("builder")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              activeTab === "builder"
                ? "bg-violet-600 text-white shadow-md shadow-violet-600/30"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Workflow Builder</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("templates")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              activeTab === "templates"
                ? "bg-violet-600 text-white shadow-md shadow-violet-600/30"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Templates</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("inspector")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition relative ${
              activeTab === "inspector"
                ? "bg-cyan-600 text-white shadow-md shadow-cyan-600/30"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            <span>Live Inspector</span>
            {isRunning && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping absolute -top-0.5 -right-0.5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("history")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              activeTab === "history"
                ? "bg-violet-600 text-white shadow-md shadow-violet-600/30"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Database ({tasks.length})</span>
          </button>
        </div>

        {/* Quick Action Button */}
        <div className="flex items-center gap-2">
          {onOpenInBrowser && (
            <button
              type="button"
              onClick={() => onOpenInBrowser("https://web.whatsapp.com", "WhatsApp Web", true, "WhatsApp Automation Active")}
              className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-500/30 text-emerald-300 text-xs font-medium transition"
              title="Open WhatsApp Web in Browser Tab"
            >
              <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
              <span>WhatsApp Web Tab</span>
            </button>
          )}

          <button
            type="button"
            onClick={loadTasks}
            className="p-2 rounded-xl bg-[#0c0d18] hover:bg-neutral-800 border border-white/[0.08] text-neutral-300 transition"
            title="Refresh State"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* ══════════════════════════════════════════════════════════════
          BODY CONTENT AREA (SWITCHABLE BY TAB)
          ══════════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex overflow-hidden">
        {/* ─── TAB 1: COMPOSER & WHATSAPP QUICK LAUNCHER ─── */}
        {activeTab === "composer" && (
          <div className="flex-1 overflow-y-auto p-8 bg-gradient-to-b from-[#070810] to-[#040407]">
            <div className="max-w-4xl mx-auto space-y-6">
              {/* WhatsApp Dedicated Quick Automation Card */}
              <div className="rounded-2xl p-6 bg-gradient-to-r from-emerald-950/40 via-[#0a1412] to-[#080914] border border-emerald-500/30 shadow-2xl relative overflow-hidden">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-md">
                      <MessageSquare className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-white flex items-center gap-2">
                        <span>WhatsApp Real Browser Automation</span>
                        <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          INSTANT DISPATCH
                        </span>
                      </h2>
                      <p className="text-xs text-neutral-400">
                        Automatically open WhatsApp Web, load recipient chat, type message, send, and verify in real time.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleLaunchWhatsApp}
                    disabled={isLaunchingWa || !waPhone.trim()}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-neutral-950 font-bold text-xs shadow-lg shadow-emerald-500/20 transition transform active:scale-95"
                  >
                    {isLaunchingWa ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    <span>Launch WhatsApp Automation</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-white/[0.08]">
                  <div>
                    <label className="block text-[11px] font-medium text-emerald-300 mb-1.5 font-mono">
                      RECIPIENT PHONE NUMBER:
                    </label>
                    <input
                      type="text"
                      value={waPhone}
                      onChange={(e) => setWaPhone(e.target.value)}
                      placeholder="e.g. +14155552671 or recipient contact number"
                      className="w-full bg-[#050608] border border-emerald-500/30 focus:border-emerald-400 rounded-xl px-3.5 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none transition font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-emerald-300 mb-1.5 font-mono">
                      MESSAGE CONTENT:
                    </label>
                    <input
                      type="text"
                      value={waMessage}
                      onChange={(e) => setWaMessage(e.target.value)}
                      placeholder="Type message content..."
                      className="w-full bg-[#050608] border border-emerald-500/30 focus:border-emerald-400 rounded-xl px-3.5 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none transition"
                    />
                  </div>
                </div>
              </div>

              {/* Natural Language Objective Composer */}
              <div className="rounded-2xl p-6 bg-[#090a14] border border-white/[0.08] shadow-2xl relative overflow-hidden">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <Sparkles className="w-4 h-4 text-violet-400" />
                    <div>
                      <h2 className="text-sm font-semibold text-white">Universal Autonomous Objective Composer</h2>
                      <p className="text-xs text-neutral-400">
                        Instruct NEXUS in plain language. The engine breaks down goals, plans actions, controls tabs, and persists results.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 bg-[#05060a] p-1 rounded-xl border border-white/[0.08] text-xs">
                    {(["balanced", "quick", "advanced"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMode(m)}
                        className={`px-3 py-1 rounded-lg capitalize transition text-xs font-medium ${
                          mode === m
                            ? "bg-violet-600 text-white shadow-sm"
                            : "text-neutral-400 hover:text-neutral-200"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                <form onSubmit={handleLaunchComposer} className="space-y-4">
                  <div>
                    <textarea
                      rows={4}
                      value={goal}
                      onChange={(e) => setGoal(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleLaunchComposer(e);
                      }}
                      placeholder="Describe any browser automation or research goal... (e.g. Scrape top AI stories from Hacker News, or research competitor features)"
                      className="w-full bg-[#05060a] border border-white/[0.1] focus:border-violet-500 rounded-2xl p-4 text-xs text-white placeholder-neutral-500 focus:outline-none transition leading-relaxed resize-none"
                    />
                  </div>

                  {/* Preset Suggestions */}
                  <div className="space-y-2">
                    <span className="text-[11px] font-mono text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-cyan-400" />
                      <span>One-Click Automation Presets:</span>
                    </span>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {PRESET_GOALS.map((preset, idx) => {
                        const Icon = preset.icon;
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              setGoal(preset.goal);
                              setTitle(preset.title);
                            }}
                            className="p-3 rounded-xl bg-[#0c0d18] hover:bg-[#121324] border border-white/[0.08] hover:border-violet-500/40 text-left transition flex items-center justify-between group"
                          >
                            <div className="flex items-center gap-2.5 overflow-hidden">
                              <Icon className="w-4 h-4 text-violet-400 shrink-0" />
                              <div className="truncate">
                                <div className="text-xs font-medium text-white group-hover:text-violet-300">
                                  {preset.title}
                                </div>
                                <div className="text-[11px] text-neutral-500 truncate">{preset.goal}</div>
                              </div>
                            </div>
                            <ArrowRight className="w-3.5 h-3.5 text-neutral-500 group-hover:text-violet-400 shrink-0 ml-2 transition" />
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Submit Toolbar */}
                  <div className="flex items-center justify-between pt-3 border-t border-white/[0.08]">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-neutral-400 font-medium">Priority:</span>
                        <select
                          value={priority}
                          onChange={(e) => setPriority(e.target.value as any)}
                          className="bg-[#05060a] border border-white/[0.1] text-xs rounded-xl px-3 py-1.5 text-neutral-200 focus:outline-none"
                        >
                          <option value="low">Low Priority</option>
                          <option value="medium">Medium Priority</option>
                          <option value="high">High Priority</option>
                        </select>
                      </div>
                      <span className="text-[11px] text-neutral-500 hidden sm:inline font-mono">
                        Press Ctrl + Enter to launch
                      </span>
                    </div>

                    <button
                      type="submit"
                      disabled={isSubmitting || !goal.trim()}
                      className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-violet-600/25 transition"
                    >
                      {isSubmitting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4 fill-white" />
                      )}
                      <span>Launch Autonomous Execution</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* ─── TAB 2: VISUAL WORKFLOW STUDIO & BUILDER ─── */}
        {activeTab === "builder" && (
          <div className="flex-1 overflow-y-auto p-8 bg-[#05060a]">
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="flex items-center justify-between p-6 rounded-2xl bg-[#080914] border border-white/[0.08]">
                <div>
                  <div className="flex items-center gap-2">
                    <Sliders className="w-5 h-5 text-violet-400" />
                    <input
                      type="text"
                      value={workflowName}
                      onChange={(e) => setWorkflowName(e.target.value)}
                      className="text-base font-bold text-white bg-transparent border-b border-transparent hover:border-neutral-600 focus:border-violet-500 focus:outline-none px-1"
                    />
                  </div>
                  <p className="text-xs text-neutral-400 mt-1">
                    Assemble and customize step-by-step browser automations with fine-grained DOM controls.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSaveWorkflowToDb}
                    disabled={isSavingWorkflow}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium border border-white/10 transition"
                  >
                    {isSavingWorkflow ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
                    <span>Save to Database</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleRunVisualWorkflow}
                    className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold shadow-lg shadow-violet-600/30 transition"
                  >
                    <Play className="w-3.5 h-3.5 fill-white" />
                    <span>Run Visual Workflow</span>
                  </button>
                </div>
              </div>

              {/* Steps List */}
              <div className="space-y-3">
                {builderSteps.map((step, idx) => (
                  <div
                    key={step.id}
                    className="p-4 rounded-xl bg-[#090a16] border border-white/[0.08] hover:border-violet-500/40 transition flex items-center justify-between group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-300 font-mono text-xs flex items-center justify-center font-bold">
                        {idx + 1}
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-white">{step.name}</span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-neutral-800 text-neutral-400">
                            {step.toolName}
                          </span>
                        </div>
                        <p className="text-[11px] text-neutral-400 mt-0.5">{step.description}</p>
                        <div className="text-[10px] font-mono text-neutral-500 mt-1">
                          Params: {JSON.stringify(step.input)}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition">
                      <button
                        type="button"
                        onClick={() => moveStep(idx, "up")}
                        disabled={idx === 0}
                        className="p-1.5 rounded-lg bg-neutral-800/60 hover:bg-neutral-800 text-neutral-300 disabled:opacity-30"
                        title="Move Up"
                      >
                        <MoveUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveStep(idx, "down")}
                        disabled={idx === builderSteps.length - 1}
                        className="p-1.5 rounded-lg bg-neutral-800/60 hover:bg-neutral-800 text-neutral-300 disabled:opacity-30"
                        title="Move Down"
                      >
                        <MoveDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeStep(idx)}
                        className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20"
                        title="Delete Step"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add New Step Drawer */}
              <div className="p-4 rounded-xl bg-[#090a16] border border-dashed border-white/15 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-300">Add Automation Step:</span>
                  <select
                    value={newStepType}
                    onChange={(e) => setNewStepType(e.target.value)}
                    className="bg-[#050608] border border-white/10 text-xs rounded-lg px-3 py-1.5 text-white focus:outline-none"
                  >
                    <option value="browser.whatsappSend">WhatsApp Direct Message</option>
                    <option value="browser.navigate">Navigate to URL</option>
                    <option value="browser.waitForSelector">Wait for DOM Element</option>
                    <option value="browser.type">Type into Input</option>
                    <option value="browser.click">Click DOM Element</option>
                    <option value="browser.pressKey">Press Keyboard Key (Enter/Tab)</option>
                    <option value="browser.extract">Scrape / Extract Data</option>
                    <option value="browser.executeScript">Evaluate JavaScript</option>
                    <option value="memory.save">Save to PostgreSQL Memory</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={addStep}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-md transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Step to Pipeline</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ─── TAB 3: READY-MADE TEMPLATES HUB ─── */}
        {activeTab === "templates" && (
          <div className="flex-1 overflow-y-auto p-8 bg-[#05060a]">
            <div className="max-w-4xl mx-auto space-y-6">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Layers className="w-5 h-5 text-violet-400" />
                  <span>High-Performance Automation Templates</span>
                </h2>
                <p className="text-xs text-neutral-400 mt-1">
                  Ready-to-run automation pipelines tested with real browser DOM execution.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Template 1: WhatsApp */}
                <div className="p-5 rounded-2xl bg-gradient-to-br from-[#0c1613] to-[#080a14] border border-emerald-500/30 flex flex-col justify-between space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                        <MessageSquare className="w-4 h-4" />
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                        WHATSAPP DEEP-LINK
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-white">WhatsApp Web Direct Dispatcher</h3>
                    <p className="text-xs text-neutral-400 mt-1">
                      Automates opening WhatsApp Web, targeting recipient number, composing message, and verifying dispatch checkmark.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleLaunchWhatsApp}
                    className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold text-xs flex items-center justify-center gap-2 transition"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Run WhatsApp Automation</span>
                  </button>
                </div>

                {/* Template 2: Scraper */}
                <div className="p-5 rounded-2xl bg-[#090a16] border border-white/[0.08] flex flex-col justify-between space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="w-8 h-8 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center">
                        <Globe className="w-4 h-4" />
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300">
                        WEB SCRAPER
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-white">Competitor Market & Price Scraper</h3>
                    <p className="text-xs text-neutral-400 mt-1">
                      Navigates to product catalogs, waits for dynamic DOM listings, extracts prices, and generates a structured comparison matrix.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      launchAutomationGoal(
                        "Navigate to target listings, extract pricing and product attributes, and save into database",
                        "Market Price Scraper"
                      )
                    }
                    className="w-full py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-medium text-xs flex items-center justify-center gap-2 transition"
                  >
                    <Play className="w-3.5 h-3.5 fill-white" />
                    <span>Launch Scraper Pipeline</span>
                  </button>
                </div>

                {/* Template 3: Form Submitter */}
                <div className="p-5 rounded-2xl bg-[#090a16] border border-white/[0.08] flex flex-col justify-between space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
                        <FileText className="w-4 h-4" />
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
                        FORM FILLER
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-white">Web Form & Lead Auto-Submitter</h3>
                    <p className="text-xs text-neutral-400 mt-1">
                      Batch-populates web registration portals and application forms with verified credentials and checks response.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      launchAutomationGoal(
                        "Navigate to application form, populate inputs with user profile, and submit form",
                        "Form Auto-Submitter"
                      )
                    }
                    className="w-full py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-medium text-xs flex items-center justify-center gap-2 transition"
                  >
                    <Play className="w-3.5 h-3.5 fill-white" />
                    <span>Launch Form Automation</span>
                  </button>
                </div>

                {/* Template 4: Research */}
                <div className="p-5 rounded-2xl bg-[#090a16] border border-white/[0.08] flex flex-col justify-between space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="w-8 h-8 rounded-lg bg-violet-500/20 text-violet-400 flex items-center justify-center">
                        <Cpu className="w-4 h-4" />
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-violet-500/20 text-violet-300">
                        AI SYNTHESIS
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-white">Daily AI Tech Intelligence Digest</h3>
                    <p className="text-xs text-neutral-400 mt-1">
                      Harvests arXiv papers and developer discussions, synthesizes findings into a Markdown report, and saves to PostgreSQL memory.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      launchAutomationGoal(
                        "Research top 5 AI browser frameworks, compare architectures, and synthesize report",
                        "AI Tech Intelligence Digest"
                      )
                    }
                    className="w-full py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-medium text-xs flex items-center justify-center gap-2 transition"
                  >
                    <Play className="w-3.5 h-3.5 fill-white" />
                    <span>Launch Research Pipeline</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── TAB 4: LIVE EXECUTION INSPECTOR & RUNNER ─── */}
        {activeTab === "inspector" && (
          <div className="flex-1 flex overflow-hidden">
            {/* Left Column: Step Timeline & Execution Control */}
            <div className="w-1/2 border-r border-white/[0.08] flex flex-col bg-[#06070e] overflow-hidden">
              {/* Task Header & Controls */}
              <div className="p-5 border-b border-white/[0.08] bg-[#080914] space-y-3 shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider ${
                        isRunning
                          ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 animate-pulse"
                          : isCompleted
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : isPaused
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                          : "bg-neutral-800 text-neutral-400"
                      }`}
                    >
                      {activeTask?.status || "READY"}
                    </span>
                    <span className="text-xs font-bold text-white truncate max-w-sm">
                      {activeTask?.title || "No active automation running"}
                    </span>
                  </div>

                  {/* Execution Control Buttons */}
                  <div className="flex items-center gap-1.5">
                    {isRunning && (
                      <button
                        type="button"
                        onClick={handlePause}
                        className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-medium border border-amber-500/30 flex items-center gap-1 transition"
                      >
                        <Pause className="w-3 h-3" />
                        <span>Pause</span>
                      </button>
                    )}

                    {isPaused && (
                      <button
                        type="button"
                        onClick={handleResume}
                        className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-medium border border-emerald-500/30 flex items-center gap-1 transition"
                      >
                        <Play className="w-3 h-3" />
                        <span>Resume</span>
                      </button>
                    )}

                    {(isRunning || isPaused) && (
                      <button
                        type="button"
                        onClick={handleCancel}
                        className="px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-medium border border-rose-500/30 flex items-center gap-1 transition"
                      >
                        <Square className="w-3 h-3" />
                        <span>Stop</span>
                      </button>
                    )}

                    {(isCompleted || isFailed) && (
                      <button
                        type="button"
                        onClick={handleRetry}
                        className="px-2.5 py-1 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 text-xs font-medium border border-violet-500/30 flex items-center gap-1 transition"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Re-run</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400">
                    <span>PROGRESS: {progressPercent}%</span>
                    <span>{activeSteps.length} AUTOMATION STEPS</span>
                  </div>
                  <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all duration-300"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Steps Timeline */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
                {activeSteps.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8 text-neutral-500">
                    <Bot className="w-8 h-8 mb-2 opacity-50" />
                    <p className="text-xs">No active automation steps in progress.</p>
                    <p className="text-[11px] text-neutral-600 mt-1">
                      Launch an automation from the Composer or WhatsApp quick launcher to watch real-time execution.
                    </p>
                  </div>
                ) : (
                  activeSteps.map((step, idx) => {
                    const isStepRunning = step.status === "RUNNING";
                    const isStepCompleted = step.status === "COMPLETED";
                    const isStepFailed = step.status === "FAILED";
                    const isSelected = selectedStepId === step.id;

                    return (
                      <div
                        key={step.id}
                        onClick={() => setSelectedStepId(step.id)}
                        className={`p-3.5 rounded-xl border transition cursor-pointer ${
                          isSelected
                            ? "bg-violet-950/30 border-violet-500 shadow-md"
                            : isStepRunning
                            ? "bg-cyan-950/25 border-cyan-500/50 shadow-cyan-500/10 shadow-lg"
                            : "bg-[#090a16] border-white/[0.06] hover:border-white/20"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`w-6 h-6 rounded-lg text-xs font-mono font-bold flex items-center justify-center ${
                                isStepCompleted
                                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                  : isStepRunning
                                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                                  : isStepFailed
                                  ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                                  : "bg-neutral-800 text-neutral-400"
                              }`}
                            >
                              {isStepRunning ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                              ) : isStepCompleted ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : isStepFailed ? (
                                <XCircle className="w-3.5 h-3.5 text-rose-400" />
                              ) : (
                                idx + 1
                              )}
                            </div>

                            <div>
                              <div className="text-xs font-semibold text-white flex items-center gap-2">
                                <span>{step.description || step.name || `Step ${idx + 1}`}</span>
                                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-neutral-800/80 text-neutral-400">
                                  {step.toolName}
                                </span>
                              </div>
                            </div>
                          </div>

                          <span
                            className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded ${
                              isStepCompleted
                                ? "text-emerald-400 bg-emerald-500/10"
                                : isStepRunning
                                ? "text-cyan-300 bg-cyan-500/10 animate-pulse"
                                : "text-neutral-500"
                            }`}
                          >
                            {step.status}
                          </span>
                        </div>

                        {step.output && (
                          <div className="mt-2 text-[11px] text-neutral-400 bg-[#05060a] p-2 rounded-lg font-mono truncate">
                            Output: {JSON.stringify(step.output)}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Column: Live Browser Viewport & Telemetry Deck */}
            <div className="w-1/2 flex flex-col bg-[#050608] overflow-hidden">
              {/* Right Deck Tab Bar */}
              <div className="h-10 px-4 border-b border-white/[0.08] bg-[#070810] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRightPanelTab("actions")}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                      rightPanelTab === "actions"
                        ? "bg-violet-600 text-white"
                        : "text-neutral-400 hover:text-white"
                    }`}
                  >
                    Live Browser Viewport
                  </button>

                  <button
                    type="button"
                    onClick={() => setRightPanelTab("telemetry")}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                      rightPanelTab === "telemetry"
                        ? "bg-violet-600 text-white"
                        : "text-neutral-400 hover:text-white"
                    }`}
                  >
                    Console Logs ({logs.length})
                  </button>

                  <button
                    type="button"
                    onClick={() => setRightPanelTab("artifacts")}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                      rightPanelTab === "artifacts"
                        ? "bg-violet-600 text-white"
                        : "text-neutral-400 hover:text-white"
                    }`}
                  >
                    Artifacts ({activeArtifacts.length})
                  </button>

                  {pendingApprovals.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setRightPanelTab("approvals")}
                      className="px-2.5 py-0.5 rounded-lg bg-amber-500/20 text-amber-300 text-xs font-bold border border-amber-500/30 animate-pulse"
                    >
                      Approvals ({pendingApprovals.length})
                    </button>
                  )}
                </div>

                {onOpenInBrowser && (
                  <button
                    type="button"
                    onClick={() => {
                      const url =
                        currentStep?.input?.url ||
                        (activeTask?.goal.includes("whatsapp")
                          ? "https://web.whatsapp.com"
                          : "https://news.ycombinator.com");
                      onOpenInBrowser(url, "Automation Active Tab", true, "Automation running");
                    }}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 text-xs font-medium transition"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open Live in Tab</span>
                  </button>
                )}
              </div>

              {/* Right Panel Content */}
              <div className="flex-1 overflow-y-auto p-5">
                {/* 1. Live Browser Viewport Preview */}
                {rightPanelTab === "actions" && (
                  <div className="space-y-4">
                    <div className="rounded-2xl bg-[#090a16] border border-white/[0.08] p-5 space-y-4">
                      <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
                        <div className="flex items-center gap-2">
                          <Monitor className="w-4 h-4 text-cyan-400" />
                          <span className="text-xs font-bold text-white font-mono uppercase">
                            ACTIVE BROWSER CONTROLLER
                          </span>
                        </div>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          CDP ATTACHED
                        </span>
                      </div>

                      <div className="space-y-3 text-xs">
                        <div className="flex items-center justify-between p-3 rounded-xl bg-[#05060a] border border-white/[0.06]">
                          <span className="text-neutral-400 font-mono">CURRENT ACTION:</span>
                          <span className="text-cyan-300 font-bold font-mono">
                            {currentStep?.toolName?.toUpperCase() || "IDLE / STANDBY"}
                          </span>
                        </div>

                        <div className="flex items-center justify-between p-3 rounded-xl bg-[#05060a] border border-white/[0.06]">
                          <span className="text-neutral-400 font-mono">TARGET URL / RECIPIENT:</span>
                          <span className="text-white font-mono truncate max-w-xs">
                            {currentStep?.input?.phone
                              ? `WhatsApp: ${currentStep.input.phone}`
                              : currentStep?.input?.url || "https://web.whatsapp.com"}
                          </span>
                        </div>

                        <div className="p-3 rounded-xl bg-[#05060a] border border-white/[0.06] space-y-1">
                          <span className="text-neutral-400 font-mono block">ACTIVE STEP PAYLOAD:</span>
                          <pre className="text-[11px] text-neutral-300 font-mono overflow-x-auto p-2 bg-[#020306] rounded-lg">
                            {JSON.stringify(currentStep?.input || {}, null, 2)}
                          </pre>
                        </div>
                      </div>

                      {onOpenInBrowser && (
                        <button
                          type="button"
                          onClick={() => {
                            const url =
                              currentStep?.input?.url ||
                              (activeTask?.goal.includes("whatsapp")
                                ? `https://web.whatsapp.com/send?phone=${waPhone}&text=${encodeURIComponent(waMessage)}`
                                : "https://news.ycombinator.com");
                            onOpenInBrowser(url, "Automation Active Tab", true, "Automation running");
                          }}
                          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-violet-600/20 transition"
                        >
                          <Monitor className="w-4 h-4" />
                          <span>View Real-Time Tab Execution</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* 2. Console Logs Deck */}
                {rightPanelTab === "telemetry" && (
                  <div className="flex flex-col h-full space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs">
                        {(["all", "tools", "state", "errors"] as const).map((f) => (
                          <button
                            key={f}
                            type="button"
                            onClick={() => setLogFilter(f)}
                            className={`px-2.5 py-1 rounded-lg capitalize text-xs ${
                              logFilter === f
                                ? "bg-neutral-800 text-white font-medium"
                                : "text-neutral-500 hover:text-neutral-300"
                            }`}
                          >
                            {f}
                          </button>
                        ))}
                      </div>
                      <span className="text-[10px] font-mono text-neutral-500">
                        {filteredLogs.length} events logged
                      </span>
                    </div>

                    <div
                      ref={logContainerRef}
                      className="flex-1 overflow-y-auto p-4 rounded-xl bg-[#030408] border border-white/[0.06] font-mono text-[11px] space-y-2"
                    >
                      {filteredLogs.length === 0 ? (
                        <div className="text-neutral-600 text-center py-8">No logs recorded yet.</div>
                      ) : (
                        filteredLogs.map((log) => (
                          <div key={log.id} className="leading-relaxed">
                            <span className="text-neutral-600 select-none mr-2">[{log.timestamp}]</span>
                            <span
                              className={`px-1.5 py-0.2 rounded text-[9px] uppercase font-bold mr-2 ${
                                log.level === "tool"
                                  ? "bg-violet-900/40 text-violet-300"
                                  : log.level === "verify"
                                  ? "bg-emerald-900/40 text-emerald-300"
                                  : log.level === "error"
                                  ? "bg-rose-900/40 text-rose-300"
                                  : "bg-neutral-800 text-neutral-400"
                              }`}
                            >
                              {log.level}
                            </span>
                            <span className="text-neutral-200">{log.message}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* 3. Artifacts Deck */}
                {rightPanelTab === "artifacts" && (
                  <div className="space-y-4">
                    {activeArtifacts.length === 0 ? (
                      <div className="text-center py-12 text-neutral-500 text-xs">
                        No artifacts generated for this execution run yet.
                      </div>
                    ) : (
                      activeArtifacts.map((art) => (
                        <div key={art.id} className="p-5 rounded-2xl bg-[#090a16] border border-white/[0.08] space-y-3">
                          <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
                            <h3 className="text-sm font-bold text-white flex items-center gap-2">
                              <FileText className="w-4 h-4 text-violet-400" />
                              <span>{art.name}</span>
                            </h3>
                            <button
                              type="button"
                              onClick={() => handleSaveReportToMemory(art)}
                              disabled={isSavingMemory}
                              className="px-3 py-1 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 border border-violet-500/30 text-xs flex items-center gap-1.5 transition"
                            >
                              <Database className="w-3.5 h-3.5" />
                              <span>Save to Memory</span>
                            </button>
                          </div>
                          <div className="prose prose-invert prose-sm max-w-none text-neutral-300 text-xs leading-relaxed">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{art.content}</ReactMarkdown>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* 4. Approvals Deck */}
                {rightPanelTab === "approvals" && (
                  <div className="space-y-3">
                    {pendingApprovals.map((appr) => (
                      <div key={appr.id} className="p-4 rounded-xl bg-amber-950/20 border border-amber-500/40 space-y-3">
                        <div className="flex items-center gap-2 text-amber-300 text-xs font-bold">
                          <ShieldAlert className="w-4 h-4" />
                          <span>Human-in-the-Loop Authorization Required</span>
                        </div>
                        <p className="text-xs text-neutral-300">
                          Tool: <span className="font-mono text-amber-200">{appr.toolName}</span> with parameters{" "}
                          <span className="font-mono text-amber-200">{JSON.stringify(appr.parameters)}</span>
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleResolveApproval(appr.id, "APPROVED")}
                            className="px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold text-xs"
                          >
                            Authorize
                          </button>
                          <button
                            type="button"
                            onClick={() => handleResolveApproval(appr.id, "REJECTED")}
                            className="px-4 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-xs font-bold"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ─── TAB 5: DATABASE & EXECUTION HISTORY VAULT ─── */}
        {activeTab === "history" && (
          <div className="flex-1 overflow-y-auto p-8 bg-[#05060a]">
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <Database className="w-5 h-5 text-violet-400" />
                    <span>PostgreSQL Automation History Vault</span>
                  </h2>
                  <p className="text-xs text-neutral-400 mt-1">
                    Complete audit trail of all autonomous runs, outputs, and artifacts.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="bg-[#0c0d18] border border-white/10 text-xs rounded-xl px-3 py-1.5 text-white focus:outline-none"
                  >
                    <option value="all">All Statuses</option>
                    <option value="running">Running</option>
                    <option value="completed">Completed</option>
                    <option value="paused">Paused</option>
                    <option value="failed">Failed</option>
                  </select>
                </div>
              </div>

              <div className="space-y-3">
                {filteredTasks.length === 0 ? (
                  <div className="text-center py-16 text-neutral-500 text-xs">
                    No task execution history located in database.
                  </div>
                ) : (
                  filteredTasks.map((t) => {
                    const latestRun = t.runs?.[0];
                    const isTaskRunning = t.status === "running" || latestRun?.status === "RUNNING";

                    return (
                      <div
                        key={t.id}
                        className="p-4 rounded-xl bg-[#090a16] border border-white/[0.08] hover:border-violet-500/40 transition flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                              t.status === "completed"
                                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                : isTaskRunning
                                ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
                                : "bg-neutral-800 text-neutral-400"
                            }`}
                          >
                            {isTaskRunning ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : t.status === "completed" ? (
                              <CheckCircle2 className="w-4 h-4" />
                            ) : (
                              <Bot className="w-4 h-4" />
                            )}
                          </div>

                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-white">{t.title}</span>
                              <span
                                className={`text-[10px] font-mono px-2 py-0.5 rounded uppercase font-semibold ${
                                  t.status === "completed"
                                    ? "bg-emerald-500/20 text-emerald-300"
                                    : isTaskRunning
                                    ? "bg-cyan-500/20 text-cyan-300"
                                    : "bg-neutral-800 text-neutral-400"
                                }`}
                              >
                                {t.status}
                              </span>
                            </div>
                            <p className="text-[11px] text-neutral-400 mt-0.5 truncate max-w-xl">{t.goal}</p>
                            <div className="text-[10px] text-neutral-500 font-mono mt-1">
                              Created: {new Date(t.createdAt).toLocaleString()} • Model: {(latestRun as any)?.model || "Nexus-1.0"}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveTaskId(t.id);
                              loadTaskDetails(t.id);
                              setActiveTab("inspector");
                            }}
                            className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-medium border border-white/10 transition"
                          >
                            Inspect Run
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
