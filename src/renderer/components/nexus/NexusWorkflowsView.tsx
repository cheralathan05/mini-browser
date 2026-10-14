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
} from "lucide-react";

import { nexusClient } from "../../lib/nexus/nexus-client";
import { nexusWs } from "../../lib/nexus/nexus-ws";
import { useToast } from "./NexusToast";

interface NexusWorkflowsViewProps {
  onOpenInBrowser?: (url: string, title?: string) => void;
  workspaceId?: string | null;
}

export interface CanvasNode {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  status: "idle" | "running" | "completed" | "failed";
  x: number;
  y: number;
  stepData?: any;
  output?: any;
  startedAt?: string;
  completedAt?: string;
}

export const NexusWorkflowsView: React.FC<NexusWorkflowsViewProps> = ({ onOpenInBrowser, workspaceId }) => {
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<any | null>(null);
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<CanvasNode | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  
  // Dragging individual node
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [nodeDragOffset, setNodeDragOffset] = useState({ x: 0, y: 0 });

  const [isRunning, setIsRunning] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAddStepModal, setShowAddStepModal] = useState(false);
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [copiedOutput, setCopiedOutput] = useState(false);

  // New Workflow Form
  const [newWfName, setNewWfName] = useState("");
  const [newWfDesc, setNewWfDesc] = useState("");
  const [newWfTargetUrl, setNewWfTargetUrl] = useState("https://news.ycombinator.com");
  const [isCreatingWf, setIsCreatingWf] = useState(false);

  // New Step Form
  const [newStepName, setNewStepName] = useState("");
  const [newStepType, setNewStepType] = useState("browser.navigate");
  const [newStepUrl, setNewStepUrl] = useState("https://example.com");
  const [newStepPrompt, setNewStepPrompt] = useState("Synthesize key elements");
  const [newStepSelector, setNewStepSelector] = useState("body");
  const [isAddingStep, setIsAddingStep] = useState(false);

  const toast = useToast();
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const loadWorkflows = useCallback(async () => {
    try {
      const res = await nexusClient.getWorkflows(workspaceId || undefined);
      const list = res.workflows || [];
      setWorkflows(list);
      if (list.length > 0) {
        // If current workflow still exists, reload it, else pick the first
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
        // Extract latest execution to show real step outputs and statuses
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
        if (selectedNode) {
          const updatedSelected = mapped.find((n) => n.id === selectedNode.id);
          if (updatedSelected) setSelectedNode(updatedSelected);
        }
      } else {
        setNodes([]);
      }
    } catch (e) {
      console.error("Failed to load workflow details:", e);
    }
  };

  useEffect(() => {
    loadWorkflows();
  }, [workspaceId]);

  // WebSocket Live Updates
  useEffect(() => {
    const unsub = nexusWs.subscribe("workflow.progress", (data: any) => {
      if (data.workflowId && selectedWorkflow?.id === data.workflowId) {
        if (data.status === "step_running" && data.stepId) {
          setNodes((prev) =>
            prev.map((n) => (n.id === data.stepId ? { ...n, status: "running" } : n))
          );
        } else if (data.status === "step_completed" && data.stepId) {
          setNodes((prev) =>
            prev.map((n) =>
              n.id === data.stepId ? { ...n, status: "completed", output: data.output } : n
            )
          );
          if (selectedNode?.id === data.stepId) {
            setSelectedNode((prev) => prev ? { ...prev, status: "completed", output: data.output } : null);
          }
        } else if (data.status === "completed") {
          setIsRunning(false);
          loadWorkflowDetails(data.workflowId);
          toast.success("Pipeline executed successfully!");
        }
      }
    });

    return () => unsub();
  }, [selectedWorkflow?.id, selectedNode?.id]);

  // Execute Pipeline
  const handleRun = async () => {
    if (!selectedWorkflow) return;
    setIsRunning(true);
    try {
      // Set first node to running
      setNodes((prev) =>
        prev.map((n, i) => (i === 0 ? { ...n, status: "running" } : { ...n, status: "idle" }))
      );
      toast.info(`Executing pipeline "${selectedWorkflow.name}"...`);
      await nexusClient.runWorkflow(selectedWorkflow.id);
    } catch (err: any) {
      setIsRunning(false);
      toast.error(err.message || "Failed to execute workflow");
    }
  };

  // Duplicate Workflow
  const handleDuplicate = async () => {
    if (!selectedWorkflow) return;
    try {
      const res = await nexusClient.duplicateWorkflow(selectedWorkflow.id);
      toast.success(`Pipeline duplicated as "${res.workflow.name}"`);
      await loadWorkflows();
      if (res.workflow?.id) {
        await loadWorkflowDetails(res.workflow.id);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to duplicate workflow");
    }
  };

  // Delete Workflow
  const handleDeleteWorkflow = async () => {
    if (!selectedWorkflow) return;
    try {
      await nexusClient.deleteWorkflow(selectedWorkflow.id);
      toast.success(`Pipeline "${selectedWorkflow.name}" deleted`);
      setShowDeleteConfirm(false);
      setSelectedWorkflow(null);
      await loadWorkflows();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete workflow");
    }
  };

  // Add Step to Workflow
  const handleAddStep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWorkflow || !newStepName.trim()) return;

    try {
      setIsAddingStep(true);
      const stepPayload: any = {
        name: newStepName.trim(),
        type: newStepType,
      };

      if (newStepType.includes("navigate") || newStepType.includes("browser")) {
        stepPayload.url = newStepUrl.trim();
        stepPayload.action = "navigate";
      } else if (newStepType.includes("ai")) {
        stepPayload.prompt = newStepPrompt.trim();
      } else if (newStepType.includes("extract")) {
        stepPayload.selector = newStepSelector.trim();
        stepPayload.action = "extract";
      } else if (newStepType.includes("memory") || newStepType.includes("database")) {
        stepPayload.title = `${selectedWorkflow.name}: Automated Insight`;
      }

      await nexusClient.addWorkflowStep(selectedWorkflow.id, stepPayload);
      toast.success(`Step "${newStepName.trim()}" added to pipeline`);
      setShowAddStepModal(false);
      setNewStepName("");
      await loadWorkflowDetails(selectedWorkflow.id);
    } catch (err: any) {
      toast.error(err.message || "Failed to add step");
    } finally {
      setIsAddingStep(false);
    }
  };

  // Delete Step from Workflow
  const handleDeleteStep = async (stepId: string) => {
    if (!selectedWorkflow) return;
    try {
      await nexusClient.deleteWorkflowStep(selectedWorkflow.id, stepId);
      toast.success("Step removed from pipeline");
      if (selectedNode?.id === stepId) {
        setSelectedNode(null);
      }
      await loadWorkflowDetails(selectedWorkflow.id);
    } catch (err: any) {
      toast.error(err.message || "Failed to delete step");
    }
  };

  // Create New Workflow
  const handleCreateWorkflow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWfName.trim()) return;

    try {
      setIsCreatingWf(true);
      const wsRes = await nexusClient.getWorkspaces();
      const wsId = workspaceId || wsRes.workspaces?.[0]?.id;
      if (!wsId) throw new Error("No active workspace found");

      const created = await nexusClient.createWorkflow(
        wsId,
        newWfName.trim(),
        {
          trigger: { type: "manual" },
          steps: [
            {
              id: "step-1",
              name: "Navigate to Target",
              type: "browser.navigate",
              action: "navigate",
              url: newWfTargetUrl.trim() || "https://news.ycombinator.com",
            },
            {
              id: "step-2",
              name: "Extract DOM Content",
              type: "browser.extract",
              action: "extract_text",
              selector: "body",
            },
            {
              id: "step-3",
              name: "AI Analysis & Synthesis",
              type: "ai_action",
              prompt: "Synthesize key data points from the webpage",
            },
            {
              id: "step-4",
              name: "Persist to Knowledge Graph",
              type: "memory.save",
              destination: "memory_vault",
            },
          ],
        },
        newWfDesc.trim() || "Custom autonomous browser automation pipeline"
      );

      toast.success(`Workflow "${newWfName.trim()}" created!`);
      setShowCreateModal(false);
      setNewWfName("");
      setNewWfDesc("");
      await loadWorkflows();
      if (created?.workflow?.id) {
        await loadWorkflowDetails(created.workflow.id);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to create workflow");
    } finally {
      setIsCreatingWf(false);
    }
  };

  // Node Icon Helper
  const getNodeIcon = (type: string) => {
    const t = type.toLowerCase();
    if (t.includes("trigger") || t.includes("wait") || t.includes("clock")) return Clock;
    if (t.includes("search")) return Search;
    if (t.includes("navigate") || t.includes("browser")) return Globe;
    if (t.includes("ai")) return Sparkles;
    if (t.includes("memory") || t.includes("database")) return Database;
    if (t.includes("whatsapp") || t.includes("send")) return Send;
    if (t.includes("approval") || t.includes("shield")) return ShieldCheck;
    if (t.includes("output") || t.includes("verify") || t.includes("submit")) return CheckCircle2;
    return Workflow;
  };

  // Canvas Pan Handlers
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".canvas-node")) return;
    setIsPanning(true);
    setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    } else if (draggingNodeId) {
      // Drag individual node
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (canvasRect) {
        const mouseX = (e.clientX - canvasRect.left - pan.x) / zoom;
        const mouseY = (e.clientY - canvasRect.top - pan.y) / zoom;
        setNodes((prev) =>
          prev.map((n) =>
            n.id === draggingNodeId
              ? { ...n, x: Math.round(mouseX - nodeDragOffset.x), y: Math.round(mouseY - nodeDragOffset.y) }
              : n
          )
        );
      }
    }
  };

  const handleCanvasMouseUp = () => {
    setIsPanning(false);
    setDraggingNodeId(null);
  };

  const handleNodeMouseDown = (e: React.MouseEvent, node: CanvasNode) => {
    e.stopPropagation();
    setSelectedNode(node);
    setDraggingNodeId(node.id);
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (canvasRect) {
      const mouseX = (e.clientX - canvasRect.left - pan.x) / zoom;
      const mouseY = (e.clientY - canvasRect.top - pan.y) / zoom;
      setNodeDragOffset({ x: mouseX - node.x, y: mouseY - node.y });
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedOutput(true);
    setTimeout(() => setCopiedOutput(false), 2000);
  };

  return (
    <div className="flex-1 flex overflow-hidden bg-[#050507] text-neutral-100 select-none">
      {/* ── Sidebar: Pipelines List ── */}
      <div className="w-72 border-r border-white/5 flex flex-col bg-[#07070b] shrink-0">
        <div className="p-3.5 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Workflow className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">Pipelines</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-900 border border-white/5 text-neutral-400">
              {workflows.length}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="p-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 text-[11px] font-semibold flex items-center gap-1 px-2 transition"
          >
            <Plus className="w-3 h-3" />
            New
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1 no-scrollbar">
          {workflows.map((wf) => {
            const isSelected = selectedWorkflow?.id === wf.id;
            const executionCount = wf._count?.executions ?? wf.executions?.length ?? 0;
            return (
              <div
                key={wf.id}
                onClick={() => loadWorkflowDetails(wf.id)}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  isSelected
                    ? "bg-amber-500/10 border-amber-500/30 text-white shadow-lg shadow-amber-500/5"
                    : "bg-neutral-900/30 border-transparent hover:border-white/5 text-neutral-300 hover:text-white"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold truncate max-w-[140px]">{wf.name}</span>
                  <div className="flex items-center gap-1">
                    {executionCount > 0 && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-neutral-900/80 text-neutral-400 font-mono">
                        {executionCount} runs
                      </span>
                    )}
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-neutral-900 text-amber-400 border border-white/5 uppercase">
                      {wf.status || "active"}
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-neutral-500 line-clamp-2 leading-relaxed">
                  {wf.description || "Automated pipeline definition"}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Main Canvas Viewport ── */}
      <div
        ref={canvasRef}
        className="flex-1 flex flex-col relative overflow-hidden bg-[#030305] cursor-grab active:cursor-grabbing"
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
      >
        {/* Ambient Subtle Grid */}
        <div
          className="absolute inset-0 pointer-events-none opacity-20"
          style={{
            backgroundImage: `radial-gradient(circle, #383842 1px, transparent 1px)`,
            backgroundSize: `24px 24px`,
          }}
        />

        {/* Top Floating Control Bar */}
        <div className="absolute top-4 left-6 right-6 z-20 flex items-center justify-between pointer-events-none">
          <div className="flex items-center gap-3 bg-neutral-950/80 border border-white/10 backdrop-blur-xl px-4 py-2 rounded-2xl shadow-2xl pointer-events-auto">
            <span className="text-xs font-bold text-white">
              {selectedWorkflow?.name || "Automated Pipeline Canvas"}
            </span>
            <span className="text-[10px] text-neutral-500">·</span>
            <span className="text-[11px] text-neutral-400 font-medium">{nodes.length} Nodes</span>
            {selectedWorkflow?.executions?.[0] && (
              <>
                <span className="text-[10px] text-neutral-500">·</span>
                <span className="text-[10px] text-emerald-400 font-mono">
                  Last Run: {new Date(selectedWorkflow.executions[0].startedAt).toLocaleTimeString()}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 pointer-events-auto">
            {/* Zoom Controls */}
            <div className="flex items-center bg-neutral-950/80 border border-white/10 backdrop-blur-xl rounded-xl p-0.5 text-neutral-400">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.6, z - 0.1))}
                className="p-1.5 hover:text-white transition-colors"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-[10px] font-mono px-1">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(1.6, z + 0.1))}
                className="p-1.5 hover:text-white transition-colors"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
                className="p-1.5 hover:text-white transition-colors"
                title="Reset View"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Workflow Action Buttons */}
            {selectedWorkflow && (
              <>
                <button
                  type="button"
                  onClick={() => setShowAddStepModal(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-neutral-900/90 hover:bg-neutral-800 text-neutral-300 hover:text-white border border-white/10 text-xs font-semibold backdrop-blur-xl transition"
                  title="Add Step to Pipeline"
                >
                  <Plus className="w-3.5 h-3.5 text-amber-400" />
                  <span>Add Step</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowHistoryDrawer((prev) => !prev)}
                  className="p-2 rounded-xl bg-neutral-900/90 hover:bg-neutral-800 text-neutral-300 hover:text-white border border-white/10 backdrop-blur-xl transition"
                  title="Execution History"
                >
                  <History className="w-3.5 h-3.5 text-neutral-400" />
                </button>

                <button
                  type="button"
                  onClick={handleDuplicate}
                  className="p-2 rounded-xl bg-neutral-900/90 hover:bg-neutral-800 text-neutral-300 hover:text-white border border-white/10 backdrop-blur-xl transition"
                  title="Duplicate Pipeline"
                >
                  <Copy className="w-3.5 h-3.5 text-neutral-400" />
                </button>

                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="p-2 rounded-xl bg-neutral-900/90 hover:bg-rose-500/20 text-neutral-400 hover:text-rose-400 border border-white/10 backdrop-blur-xl transition"
                  title="Delete Pipeline"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}

            {/* Run Trigger Button */}
            <button
              type="button"
              onClick={handleRun}
              disabled={isRunning || !selectedWorkflow || nodes.length === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-lg shadow-amber-600/20 disabled:opacity-50 transition-all cursor-pointer"
            >
              {isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-white" />}
              <span>{isRunning ? "Executing..." : "Execute Pipeline"}</span>
            </button>
          </div>
        </div>

        {/* Empty Canvas Overlay */}
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center pointer-events-auto z-10">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4 text-amber-400">
              <Workflow className="w-8 h-8" />
            </div>
            <h3 className="text-base font-bold text-white mb-2">
              {workflows.length === 0 ? "No Workflow Pipelines in Database" : "No Pipeline Selected"}
            </h3>
            <p className="text-xs text-neutral-400 max-w-sm mb-6 leading-relaxed">
              {workflows.length === 0
                ? "Create your first autonomous browser automation pipeline. Workflows persist directly into PostgreSQL."
                : "Select a pipeline from the sidebar to inspect its nodes and live telemetry."}
            </p>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold transition shadow-lg shadow-amber-500/20"
            >
              <Plus className="w-4 h-4" />
              Create New Pipeline
            </button>
          </div>
        )}

        {/* Scaled/Panned Graph Container */}
        <div
          className="w-full h-full relative"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
        >
          {/* SVG Connector Lines */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
            {nodes.map((node, i) => {
              if (i === nodes.length - 1) return null;
              const nextNode = nodes[i + 1];
              const startX = node.x + 200;
              const startY = node.y + 45;
              const endX = nextNode.x;
              const endY = nextNode.y + 45;
              const midX = (startX + endX) / 2;
              const isActive = node.status === "completed" && nextNode.status === "running";
              const isBothDone = node.status === "completed" && nextNode.status === "completed";

              return (
                <g key={`conn-${node.id}-${nextNode.id}`}>
                  <path
                    d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`}
                    fill="none"
                    stroke={isActive ? "#f59e0b" : isBothDone ? "#10b981" : "#2a2a34"}
                    strokeWidth={isActive ? "2.5" : "1.5"}
                    strokeDasharray={isActive ? "6,4" : "none"}
                    className={isActive ? "animate-pulse" : ""}
                  />
                </g>
              );
            })}
          </svg>

          {/* Canvas Nodes */}
          {nodes.map((node) => {
            const Icon = getNodeIcon(node.type);
            const isRunningNode = node.status === "running";
            const isCompletedNode = node.status === "completed";
            const isFailedNode = node.status === "failed";
            const isNodeSelected = selectedNode?.id === node.id;

            return (
              <div
                key={node.id}
                onMouseDown={(e) => handleNodeMouseDown(e, node)}
                className={`canvas-node absolute w-[200px] rounded-2xl bg-[#09090e] border p-3.5 shadow-2xl transition-all cursor-pointer ${
                  isNodeSelected ? "ring-2 ring-amber-500/50 scale-[1.02]" : ""
                }`}
                style={{
                  left: `${node.x}px`,
                  top: `${node.y}px`,
                  borderColor: isRunningNode
                    ? "rgba(245,158,11,0.8)"
                    : isCompletedNode
                    ? "rgba(16,185,129,0.5)"
                    : isFailedNode
                    ? "rgba(239,68,68,0.5)"
                    : "rgba(255,255,255,0.08)",
                  boxShadow: isRunningNode
                    ? "0 0 25px rgba(245,158,11,0.25)"
                    : isCompletedNode
                    ? "0 0 20px rgba(16,185,129,0.15)"
                    : "0 10px 30px rgba(0,0,0,0.5)",
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                      isRunningNode
                        ? "bg-amber-500/20 text-amber-400"
                        : isCompletedNode
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-neutral-900 border border-white/5 text-neutral-300"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <span
                    className={`text-[9px] font-mono px-1.5 py-0.5 rounded-full uppercase ${
                      isRunningNode
                        ? "bg-amber-500/20 text-amber-300 animate-pulse font-bold"
                        : isCompletedNode
                        ? "bg-emerald-500/15 text-emerald-400 font-semibold"
                        : isFailedNode
                        ? "bg-rose-500/15 text-rose-400 font-semibold"
                        : "bg-neutral-900 text-neutral-500"
                    }`}
                  >
                    {node.status}
                  </span>
                </div>

                <h4 className="text-xs font-semibold text-white truncate">{node.title}</h4>
                <p className="text-[10px] text-neutral-500 truncate mt-0.5">{node.subtitle}</p>

                {node.output && (
                  <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between">
                    <span className="text-[9px] text-emerald-400/80 font-mono truncate max-w-[130px]">
                      ✓ Output saved
                    </span>
                    <ChevronRight className="w-3 h-3 text-neutral-500" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Slide-Out Node Details Inspector ── */}
        {selectedNode && (
          <div className="absolute top-16 right-6 bottom-6 w-96 rounded-2xl bg-[#090910] border border-white/10 shadow-2xl z-30 flex flex-col overflow-hidden backdrop-blur-2xl animate-in slide-in-from-right-8 duration-200">
            {/* Header */}
            <div className="p-4 border-b border-white/5 flex items-center justify-between bg-neutral-950/60">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                  {React.createElement(getNodeIcon(selectedNode.type), { className: "w-4 h-4" })}
                </div>
                <div>
                  <h3 className="text-xs font-bold text-white truncate max-w-[200px]">{selectedNode.title}</h3>
                  <p className="text-[10px] font-mono text-neutral-500 uppercase">{selectedNode.type}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedNode(null)}
                className="p-1 rounded-lg hover:bg-white/5 text-neutral-400 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Status Banner */}
              <div
                className={`p-3 rounded-xl border flex items-center justify-between ${
                  selectedNode.status === "completed"
                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                    : selectedNode.status === "running"
                    ? "bg-amber-500/10 border-amber-500/20 text-amber-400 animate-pulse"
                    : "bg-neutral-900 border-white/5 text-neutral-400"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      selectedNode.status === "completed"
                        ? "bg-emerald-400"
                        : selectedNode.status === "running"
                        ? "bg-amber-400"
                        : "bg-neutral-500"
                    }`}
                  />
                  <span className="text-xs font-semibold capitalize">{selectedNode.status}</span>
                </div>
                {selectedNode.completedAt && (
                  <span className="text-[10px] font-mono opacity-80">
                    {new Date(selectedNode.completedAt).toLocaleTimeString()}
                  </span>
                )}
              </div>

              {/* Step Parameters */}
              <div className="space-y-2">
                <h4 className="text-[11px] font-bold text-neutral-300 uppercase tracking-wider">Parameters</h4>
                <div className="bg-neutral-950/70 border border-white/5 rounded-xl p-3 space-y-2 text-xs">
                  {selectedNode.stepData?.url && (
                    <div>
                      <span className="text-[10px] text-neutral-500 block">Target URL</span>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="font-mono text-amber-300 text-[11px] truncate max-w-[240px]">
                          {selectedNode.stepData.url}
                        </span>
                        {onOpenInBrowser && (
                          <button
                            type="button"
                            onClick={() => onOpenInBrowser(selectedNode.stepData.url, selectedNode.title)}
                            className="p-1 hover:text-white text-neutral-400 transition"
                            title="Open URL in Browser Tab"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {selectedNode.stepData?.selector && (
                    <div>
                      <span className="text-[10px] text-neutral-500 block">CSS Selector</span>
                      <span className="font-mono text-neutral-300 text-[11px]">
                        {selectedNode.stepData.selector}
                      </span>
                    </div>
                  )}

                  {selectedNode.stepData?.prompt && (
                    <div>
                      <span className="text-[10px] text-neutral-500 block">AI Instruction / Prompt</span>
                      <p className="text-neutral-300 text-[11px] mt-0.5 leading-relaxed">
                        {selectedNode.stepData.prompt}
                      </p>
                    </div>
                  )}

                  {selectedNode.stepData?.fields && (
                    <div>
                      <span className="text-[10px] text-neutral-500 block">Form Field Payload</span>
                      <pre className="font-mono text-[10px] text-neutral-300 mt-1 p-2 rounded bg-neutral-900 overflow-x-auto">
                        {JSON.stringify(selectedNode.stepData.fields, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>

              {/* Step Output / Results */}
              {selectedNode.output && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">
                      Execution Output
                    </h4>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(JSON.stringify(selectedNode.output, null, 2))}
                      className="flex items-center gap-1 text-[10px] text-neutral-400 hover:text-white transition"
                    >
                      {copiedOutput ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedOutput ? "Copied" : "Copy JSON"}</span>
                    </button>
                  </div>
                  <div className="bg-neutral-950 border border-emerald-500/20 rounded-xl p-3 max-h-56 overflow-y-auto">
                    <pre className="text-[11px] font-mono text-neutral-300 whitespace-pre-wrap leading-relaxed">
                      {JSON.stringify(selectedNode.output, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="p-3 border-t border-white/5 bg-neutral-950/60 flex items-center justify-between">
              <button
                type="button"
                onClick={() => handleDeleteStep(selectedNode.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-rose-500/10 text-neutral-400 hover:text-rose-400 text-xs transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Step</span>
              </button>

              {selectedNode.stepData?.url && onOpenInBrowser && (
                <button
                  type="button"
                  onClick={() => onOpenInBrowser(selectedNode.stepData.url, selectedNode.title)}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20 text-xs font-semibold transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open in Browser</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Slide-Out Execution History Drawer ── */}
        {showHistoryDrawer && selectedWorkflow && (
          <div className="absolute top-16 right-6 bottom-6 w-96 rounded-2xl bg-[#090910] border border-white/10 shadow-2xl z-30 flex flex-col overflow-hidden backdrop-blur-2xl animate-in slide-in-from-right-8 duration-200">
            <div className="p-4 border-b border-white/5 flex items-center justify-between bg-neutral-950/60">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-amber-400" />
                <h3 className="text-xs font-bold text-white">Execution History</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowHistoryDrawer(false)}
                className="p-1 rounded-lg hover:bg-white/5 text-neutral-400 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {(!selectedWorkflow.executions || selectedWorkflow.executions.length === 0) ? (
                <div className="text-center py-12 text-neutral-500 text-xs">
                  No execution runs recorded yet.
                </div>
              ) : (
                selectedWorkflow.executions.map((exec: any) => (
                  <div key={exec.id} className="p-3 rounded-xl bg-neutral-950 border border-white/5 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-neutral-400">
                        {new Date(exec.startedAt).toLocaleString()}
                      </span>
                      <span
                        className={`text-[9px] font-mono px-1.5 py-0.5 rounded uppercase ${
                          exec.status === "completed"
                            ? "bg-emerald-500/10 text-emerald-400"
                            : exec.status === "running"
                            ? "bg-amber-500/10 text-amber-400 animate-pulse"
                            : "bg-rose-500/10 text-rose-400"
                        }`}
                      >
                        {exec.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-neutral-300">
                      {exec.steps?.length || 0} steps executed
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Add Step Modal ── */}
      {showAddStepModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-md p-6 rounded-3xl bg-[#0c0c16] border border-white/10 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                  <Plus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Add Step to Pipeline</h3>
                  <p className="text-[11px] text-neutral-500">Append automation node into workflow graph</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddStepModal(false)}
                className="p-1.5 text-neutral-400 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddStep} className="space-y-3.5">
              <div>
                <label className="text-[11px] font-semibold text-neutral-400 block mb-1">Step Name</label>
                <input
                  type="text"
                  value={newStepName}
                  onChange={(e) => setNewStepName(e.target.value)}
                  placeholder="e.g. Scrape Pricing Table"
                  required
                  className="w-full px-3.5 py-2 rounded-xl bg-neutral-900 border border-white/10 text-xs text-white placeholder-neutral-500 outline-none focus:border-amber-500/50"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-neutral-400 block mb-1">Step Type</label>
                <select
                  value={newStepType}
                  onChange={(e) => setNewStepType(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-neutral-900 border border-white/10 text-xs text-white outline-none focus:border-amber-500/50"
                >
                  <option value="browser.navigate">Browser: Navigate to URL</option>
                  <option value="browser.extract">Browser: Extract Page Text / DOM</option>
                  <option value="browser.fillForm">Browser: Fill & Submit Form</option>
                  <option value="ai_action">AI: Reasoning & Synthesis</option>
                  <option value="memory.save">Memory: Save to Knowledge Graph</option>
                  <option value="browser.whatsappSend">Communication: WhatsApp Web Dispatch</option>
                </select>
              </div>

              {newStepType.includes("navigate") && (
                <div>
                  <label className="text-[11px] font-semibold text-neutral-400 block mb-1">URL</label>
                  <input
                    type="url"
                    value={newStepUrl}
                    onChange={(e) => setNewStepUrl(e.target.value)}
                    placeholder="https://example.com"
                    required
                    className="w-full px-3.5 py-2 rounded-xl bg-neutral-900 border border-white/10 text-xs text-white outline-none focus:border-amber-500/50"
                  />
                </div>
              )}

              {newStepType.includes("ai") && (
                <div>
                  <label className="text-[11px] font-semibold text-neutral-400 block mb-1">Prompt</label>
                  <textarea
                    value={newStepPrompt}
                    onChange={(e) => setNewStepPrompt(e.target.value)}
                    rows={2}
                    placeholder="Describe AI synthesis instruction..."
                    className="w-full px-3.5 py-2 rounded-xl bg-neutral-900 border border-white/10 text-xs text-white outline-none focus:border-amber-500/50 resize-none"
                  />
                </div>
              )}

              {newStepType.includes("extract") && (
                <div>
                  <label className="text-[11px] font-semibold text-neutral-400 block mb-1">CSS Selector</label>
                  <input
                    type="text"
                    value={newStepSelector}
                    onChange={(e) => setNewStepSelector(e.target.value)}
                    placeholder="table, .price, body"
                    className="w-full px-3.5 py-2 rounded-xl bg-neutral-900 border border-white/10 text-xs text-white outline-none focus:border-amber-500/50"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddStepModal(false)}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-300 text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAddingStep || !newStepName.trim()}
                  className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold transition disabled:opacity-50"
                >
                  {isAddingStep ? "Adding..." : "Add Step"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Create Pipeline Modal ── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-lg p-6 rounded-3xl bg-[#0c0c16] border border-white/10 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                  <Workflow className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Create Automation Pipeline</h3>
                  <p className="text-[11px] text-neutral-500">Persists directly into PostgreSQL database</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 text-neutral-400 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateWorkflow} className="space-y-3.5">
              <div>
                <label className="text-[11px] font-semibold text-neutral-400 block mb-1">Pipeline Name</label>
                <input
                  type="text"
                  value={newWfName}
                  onChange={(e) => setNewWfName(e.target.value)}
                  placeholder="e.g. Daily Market Price Monitor"
                  required
                  className="w-full px-3.5 py-2 rounded-xl bg-neutral-900 border border-white/10 text-xs text-white placeholder-neutral-500 outline-none focus:border-amber-500/50"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-neutral-400 block mb-1">Target URL</label>
                <input
                  type="url"
                  value={newWfTargetUrl}
                  onChange={(e) => setNewWfTargetUrl(e.target.value)}
                  placeholder="https://example.com"
                  required
                  className="w-full px-3.5 py-2 rounded-xl bg-neutral-900 border border-white/10 text-xs text-white placeholder-neutral-500 outline-none focus:border-amber-500/50"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-neutral-400 block mb-1">Description</label>
                <textarea
                  value={newWfDesc}
                  onChange={(e) => setNewWfDesc(e.target.value)}
                  placeholder="Describe pipeline steps and automated actions..."
                  rows={3}
                  className="w-full px-3.5 py-2 rounded-xl bg-neutral-900 border border-white/10 text-xs text-white placeholder-neutral-500 outline-none focus:border-amber-500/50 resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-300 text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingWf || !newWfName.trim()}
                  className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold transition disabled:opacity-50"
                >
                  {isCreatingWf ? "Creating..." : "Save Pipeline"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ── */}
      {showDeleteConfirm && selectedWorkflow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-sm p-6 rounded-3xl bg-[#0c0c16] border border-white/10 shadow-2xl text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Delete Pipeline?</h3>
              <p className="text-xs text-neutral-400 mt-1">
                Are you sure you want to delete <span className="text-white font-medium">"{selectedWorkflow.name}"</span>? All steps and execution logs will be permanently deleted from PostgreSQL.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-300 text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteWorkflow}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
