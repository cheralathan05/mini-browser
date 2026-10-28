import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  GitBranch,
  Play,
  Save,
  CheckCircle2,
  AlertCircle,
  Clock,
  Plus,
  Trash2,
  Copy,
  Maximize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  RotateCw,
  Search,
  X,
  ChevronRight,
  ShieldAlert,
  Globe,
  Bot,
  Layers,
  Send,
  Database,
  ArrowRight,
  Check,
  Edit2,
  FileText,
  AlertTriangle,
  Settings,
} from "lucide-react";
import {
  workflowBuilderApi,
  VisualNode,
  VisualEdge,
  VisualWorkflowDefinition,
  WorkflowRecord,
  WorkflowExecutionSummary,
  ValidationResult,
  NODE_PALETTE,
  NodeMetadata,
  NodeCategory,
} from "../../lib/nexus/workflow-builder.api";

interface NexusVisualBuilderProps {
  onOpenInBrowser?: (url: string) => void;
  workspaceId?: string;
}

export const NexusVisualBuilder: React.FC<NexusVisualBuilderProps> = ({
  onOpenInBrowser,
  workspaceId,
}) => {
  // Workflows sidebar state
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowRecord | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoadingWorkflows, setIsLoadingWorkflows] = useState(false);

  // Active canvas graph state
  const [nodes, setNodes] = useState<VisualNode[]>([]);
  const [edges, setEdges] = useState<VisualEdge[]>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  // Undo/Redo history stack
  const [history, setHistory] = useState<Array<{ nodes: VisualNode[]; edges: VisualEdge[] }>>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Canvas viewport & transform
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);

  // Selection & Inspector
  const [selectedNode, setSelectedNode] = useState<VisualNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<VisualEdge | null>(null);

  // Node Dragging State
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Port Connection Dragging State
  const [connectingSource, setConnectingSource] = useState<{
    nodeId: string;
    handle: string;
    x: number;
    y: number;
  } | null>(null);
  const [mouseCanvasPos, setMouseCanvasPos] = useState({ x: 0, y: 0 });

  // Modals & Drawers
  const [showAddNodeModal, setShowAddNodeModal] = useState(false);
  const [addNodeCategory, setAddNodeCategory] = useState<string>("all");
  const [nodeSearchQuery, setNodeSearchQuery] = useState("");
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [showExecutionHistory, setShowExecutionHistory] = useState(false);
  const [executionHistory, setExecutionHistory] = useState<WorkflowExecutionSummary[]>([]);
  const [selectedExecution, setSelectedExecution] = useState<WorkflowExecutionSummary | null>(null);
  const [notification, setNotification] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);

  // Workflow title editing
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");

  const showToast = (text: string, type: "success" | "error" | "info" = "info") => {
    setNotification({ text, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // Push to undo stack
  const pushHistory = useCallback(
    (newNodes: VisualNode[], newEdges: VisualEdge[]) => {
      setHistory((prev) => {
        const sliced = prev.slice(0, historyIndex + 1);
        return [...sliced, { nodes: newNodes, edges: newEdges }];
      });
      setHistoryIndex((prev) => prev + 1);
      setHasUnsavedChanges(true);
    },
    [historyIndex]
  );

  const handleUndo = () => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      setNodes(prev.nodes);
      setEdges(prev.edges);
      setHistoryIndex((idx) => idx - 1);
      setHasUnsavedChanges(true);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setNodes(next.nodes);
      setEdges(next.edges);
      setHistoryIndex((idx) => idx + 1);
      setHasUnsavedChanges(true);
    }
  };

  // Fetch workflows on mount
  const loadWorkflows = useCallback(async () => {
    setIsLoadingWorkflows(true);
    try {
      const res = await workflowBuilderApi.getWorkflows(workspaceId);
      setWorkflows(res.workflows || []);
      if (res.workflows && res.workflows.length > 0 && !selectedWorkflow) {
        selectWorkflow(res.workflows[0]);
      }
    } catch {
      showToast("Failed to load saved workflows", "error");
    } finally {
      setIsLoadingWorkflows(false);
    }
  }, [workspaceId, selectedWorkflow]);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  // Select a workflow and populate canvas
  const selectWorkflow = (wf: WorkflowRecord) => {
    setSelectedWorkflow(wf);
    setEditedTitle(wf.name);
    setSelectedNode(null);
    setSelectedEdge(null);

    const def = wf.definition as VisualWorkflowDefinition;
    if (def && Array.isArray(def.nodes) && Array.isArray(def.edges)) {
      setNodes(def.nodes);
      setEdges(def.edges);
      setHistory([{ nodes: def.nodes, edges: def.edges }]);
      setHistoryIndex(0);
      if (def.viewport) {
        setPan({ x: def.viewport.x, y: def.viewport.y });
        setZoom(def.viewport.zoom || 1);
      } else {
        fitToScreen(def.nodes);
      }
    } else {
      setNodes([]);
      setEdges([]);
      setHistory([]);
      setHistoryIndex(-1);
    }
    setHasUnsavedChanges(false);
  };

  // Fit graph to viewport
  const fitToScreen = (nodeList = nodes) => {
    if (nodeList.length === 0) {
      setPan({ x: 50, y: 50 });
      setZoom(1);
      return;
    }

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    for (const n of nodeList) {
      if (n.position.x < minX) minX = n.position.x;
      if (n.position.y < minY) minY = n.position.y;
      if (n.position.x > maxX) maxX = n.position.x + 240;
      if (n.position.y > maxY) maxY = n.position.y + 140;
    }

    const canvasWidth = canvasRef.current?.clientWidth || 800;
    const canvasHeight = canvasRef.current?.clientHeight || 600;
    const graphWidth = maxX - minX + 100;
    const graphHeight = maxY - minY + 100;

    const scale = Math.min(1.2, Math.max(0.4, Math.min(canvasWidth / graphWidth, canvasHeight / graphHeight)));
    const centerX = (canvasWidth - graphWidth * scale) / 2 - minX * scale + 50;
    const centerY = (canvasHeight - graphHeight * scale) / 2 - minY * scale + 50;

    setZoom(scale);
    setPan({ x: centerX, y: centerY });
  };

  // Save current workflow
  const handleSaveWorkflow = async () => {
    if (!selectedWorkflow) return;
    setIsSaving(true);
    try {
      const def: VisualWorkflowDefinition = {
        viewport: { x: pan.x, y: pan.y, zoom },
        nodes,
        edges,
      };

      const res = await workflowBuilderApi.updateWorkflow(selectedWorkflow.id, {
        name: editedTitle || selectedWorkflow.name,
        definition: def,
        changeLog: `Updated in Visual Workflow Builder`,
      });

      setSelectedWorkflow(res.workflow);
      setHasUnsavedChanges(false);
      showToast(`Workflow "${res.workflow.name}" saved (v${res.workflow.version})`, "success");
      loadWorkflows();
    } catch (err: any) {
      showToast(err?.message || "Failed to save workflow", "error");
    } finally {
      setIsSaving(false);
    }
  };

  // Run current workflow
  const handleRunWorkflow = async () => {
    if (!selectedWorkflow) return;
    setIsRunning(true);

    // Reset node status to running/ready
    const updated = nodes.map((n) => ({ ...n, status: "pending" as const, outputData: undefined, error: undefined }));
    setNodes(updated);

    try {
      showToast(`Executing workflow "${selectedWorkflow.name}"...`, "info");
      const res = await workflowBuilderApi.runWorkflow(selectedWorkflow.id, {
        viewport: { x: pan.x, y: pan.y, zoom },
        nodes,
        edges,
      });

      showToast(`Workflow execution started (ID: ${res.executionId.slice(0, 8)}...)`, "success");

      // Poll execution status
      const pollTimer = setInterval(async () => {
        try {
          const execRes = await workflowBuilderApi.getExecution(res.executionId);
          const exec = execRes.execution;

          if (exec && exec.steps) {
            setNodes((prevNodes) =>
              prevNodes.map((n) => {
                const step = exec.steps?.find((s) => s.nodeId === n.id || s.stepId === n.id);
                if (step) {
                  return {
                    ...n,
                    status: (step.status === "completed" ? "succeeded" : step.status) as any,
                    outputData: step.output,
                    error: step.error,
                  };
                }
                return n;
              })
            );
          }

          if (exec.status === "completed" || exec.status === "failed" || exec.status === "cancelled") {
            clearInterval(pollTimer);
            setIsRunning(false);
            if (exec.status === "completed") {
              showToast("Workflow completed successfully!", "success");
            } else if (exec.status === "failed") {
              showToast(`Workflow failed: ${exec.error || "Unknown error"}`, "error");
            }
          }
        } catch {
          clearInterval(pollTimer);
          setIsRunning(false);
        }
      }, 1000);
    } catch (err: any) {
      setIsRunning(false);
      showToast(err?.message || "Workflow execution failed", "error");
    }
  };

  // Validate graph
  const handleValidateGraph = async () => {
    if (!selectedWorkflow) return;
    try {
      const def: VisualWorkflowDefinition = {
        viewport: { x: pan.x, y: pan.y, zoom },
        nodes,
        edges,
      };
      const result = await workflowBuilderApi.validateWorkflow(selectedWorkflow.id, def);
      setValidationResult(result);
      setShowValidationModal(true);
    } catch (err: any) {
      showToast(err?.message || "Validation failed", "error");
    }
  };

  // Create new workflow
  const handleCreateWorkflow = async () => {
    try {
      const newDef: VisualWorkflowDefinition = {
        viewport: { x: 50, y: 50, zoom: 1 },
        nodes: [
          {
            id: `node_${Date.now()}`,
            type: "trigger.manual",
            title: "Manual Trigger",
            category: "trigger",
            position: { x: 100, y: 200 },
            config: {},
            status: "ready",
          },
        ],
        edges: [],
      };

      const res = await workflowBuilderApi.createWorkflow({
        name: `New Workflow ${workflows.length + 1}`,
        description: "Custom visual workflow automation pipeline",
        workspaceId,
        definition: newDef,
      });

      await loadWorkflows();
      selectWorkflow(res.workflow);
      showToast(`Created workflow "${res.workflow.name}"`, "success");
    } catch {
      showToast("Failed to create workflow", "error");
    }
  };

  // Duplicate workflow
  const handleDuplicateWorkflow = async (id: string) => {
    try {
      const res = await workflowBuilderApi.duplicateWorkflow(id);
      await loadWorkflows();
      selectWorkflow(res.workflow);
      showToast(`Duplicated workflow "${res.workflow.name}"`, "success");
    } catch {
      showToast("Failed to duplicate workflow", "error");
    }
  };

  // Delete workflow
  const handleDeleteWorkflow = async (id: string) => {
    if (!confirm("Are you sure you want to delete this workflow? This cannot be undone.")) return;
    try {
      await workflowBuilderApi.deleteWorkflow(id);
      showToast("Workflow deleted", "info");
      const remaining = workflows.filter((w) => w.id !== id);
      setWorkflows(remaining);
      if (remaining.length > 0) {
        selectWorkflow(remaining[0]);
      } else {
        setSelectedWorkflow(null);
        setNodes([]);
        setEdges([]);
      }
    } catch {
      showToast("Failed to delete workflow", "error");
    }
  };

  // Add a new node to canvas
  const handleAddNode = (meta: NodeMetadata) => {
    const newNode: VisualNode = {
      id: `node_${Date.now()}`,
      type: meta.type,
      title: meta.title,
      category: meta.category,
      position: {
        x: Math.round((-pan.x + (canvasRef.current?.clientWidth || 800) / 2) / zoom - 100),
        y: Math.round((-pan.y + (canvasRef.current?.clientHeight || 600) / 2) / zoom - 50),
      },
      config: { ...meta.defaultConfig },
      inputs: meta.inputs,
      outputs: meta.outputs,
      status: "ready",
    };

    const nextNodes = [...nodes, newNode];
    setNodes(nextNodes);
    pushHistory(nextNodes, edges);
    setSelectedNode(newNode);
    setShowAddNodeModal(false);
    showToast(`Added "${meta.title}" node`, "info");
  };

  // Delete selected node
  const handleDeleteNode = (nodeId: string) => {
    const nextNodes = nodes.filter((n) => n.id !== nodeId);
    const nextEdges = edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
    setNodes(nextNodes);
    setEdges(nextEdges);
    pushHistory(nextNodes, nextEdges);
    setSelectedNode(null);
    showToast("Node removed from canvas", "info");
  };

  // Disconnect / delete selected edge
  const handleDeleteEdge = (edgeId: string) => {
    const nextEdges = edges.filter((e) => e.id !== edgeId);
    setEdges(nextEdges);
    pushHistory(nodes, nextEdges);
    setSelectedEdge(null);
    showToast("Connection removed", "info");
  };

  // Handle port connection creation
  const handlePortMouseDown = (e: React.MouseEvent, nodeId: string, handle: string) => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const canvasRect = canvasRef.current?.getBoundingClientRect() || { left: 0, top: 0 };

    setConnectingSource({
      nodeId,
      handle,
      x: (rect.left + rect.width / 2 - canvasRect.left - pan.x) / zoom,
      y: (rect.top + rect.height / 2 - canvasRect.top - pan.y) / zoom,
    });
  };

  const handlePortMouseUp = (e: React.MouseEvent, targetNodeId: string, targetHandle: string) => {
    e.stopPropagation();
    if (!connectingSource) return;

    if (connectingSource.nodeId === targetNodeId) {
      showToast("Cannot connect node to itself", "error");
      setConnectingSource(null);
      return;
    }

    // Check if edge already exists
    const exists = edges.some(
      (edge) =>
        edge.source === connectingSource.nodeId &&
        edge.target === targetNodeId &&
        edge.sourceHandle === connectingSource.handle &&
        edge.targetHandle === targetHandle
    );

    if (exists) {
      showToast("Connection already exists", "info");
      setConnectingSource(null);
      return;
    }

    const newEdge: VisualEdge = {
      id: `e_${connectingSource.nodeId}_${targetNodeId}_${Date.now()}`,
      source: connectingSource.nodeId,
      target: targetNodeId,
      sourceHandle: connectingSource.handle,
      targetHandle: targetHandle,
      status: "active",
    };

    const nextEdges = [...edges, newEdge];
    setEdges(nextEdges);
    pushHistory(nodes, nextEdges);
    setConnectingSource(null);
    showToast("Connected nodes", "success");
  };

  // Update node position during dragging
  const handleNodeMouseDown = (e: React.MouseEvent, node: VisualNode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSelectedNode(node);
    setSelectedEdge(null);
    setDraggingNodeId(node.id);
    setDragOffset({
      x: e.clientX / zoom - node.position.x,
      y: e.clientY / zoom - node.position.y,
    });
  };

  // Canvas Mouse Move & Up
  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    const canvasRect = canvasRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
    const curX = (e.clientX - canvasRect.left - pan.x) / zoom;
    const curY = (e.clientY - canvasRect.top - pan.y) / zoom;
    setMouseCanvasPos({ x: curX, y: curY });

    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    } else if (draggingNodeId) {
      const nextX = Math.round(e.clientX / zoom - dragOffset.x);
      const nextY = Math.round(e.clientY / zoom - dragOffset.y);

      setNodes((prev) =>
        prev.map((n) => (n.id === draggingNodeId ? { ...n, position: { x: nextX, y: nextY } } : n))
      );
    }
  };

  const handleCanvasMouseUp = () => {
    if (draggingNodeId) {
      pushHistory(nodes, edges);
      setDraggingNodeId(null);
    }
    setIsPanning(false);
    if (connectingSource) {
      setConnectingSource(null);
    }
  };

  // Calculate connection bezier path
  const getEdgePath = (edge: VisualEdge) => {
    const sourceNode = nodes.find((n) => n.id === edge.source);
    const targetNode = nodes.find((n) => n.id === edge.target);

    if (!sourceNode || !targetNode) return "";

    const x1 = sourceNode.position.x + 220;
    const y1 = sourceNode.position.y + 60;
    const x2 = targetNode.position.x;
    const y2 = targetNode.position.y + 60;

    const dx = Math.abs(x2 - x1) * 0.5;
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };

  // Filtered workflows
  const filteredWorkflows = workflows.filter(
    (wf) =>
      wf.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (wf.description && wf.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="flex-1 flex overflow-hidden relative bg-[#04040a] text-white">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`absolute top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-xs font-semibold shadow-2xl flex items-center gap-2 border transition-all ${
            notification.type === "success"
              ? "bg-emerald-950/90 text-emerald-300 border-emerald-500/40"
              : notification.type === "error"
              ? "bg-rose-950/90 text-rose-300 border-rose-500/40"
              : "bg-violet-950/90 text-violet-300 border-violet-500/40"
          }`}
        >
          {notification.type === "success" && <Check className="w-3.5 h-3.5" />}
          {notification.type === "error" && <AlertCircle className="w-3.5 h-3.5" />}
          {notification.type === "info" && <GitBranch className="w-3.5 h-3.5" />}
          <span>{notification.text}</span>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────
          LEFT WORKFLOWS SIDEBAR
         ────────────────────────────────────────────────────────── */}
      <div className="w-64 border-r border-white/[0.06] bg-[#06060e] flex flex-col shrink-0">
        <div className="p-3 border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-violet-400" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">Pipelines</span>
          </div>
          <button
            onClick={handleCreateWorkflow}
            title="Create New Workflow"
            className="p-1 rounded-lg bg-violet-600 text-white hover:bg-violet-500 transition text-xs flex items-center gap-1 shadow-sm shadow-violet-600/30"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Search Filter */}
        <div className="p-2 border-b border-white/[0.04]">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              type="text"
              placeholder="Search workflows..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-violet-500"
            />
          </div>
        </div>

        {/* Workflows List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {isLoadingWorkflows ? (
            <div className="p-4 text-center text-xs text-neutral-500">Loading workflows...</div>
          ) : filteredWorkflows.length === 0 ? (
            <div className="p-6 text-center text-xs text-neutral-500">No workflows found</div>
          ) : (
            filteredWorkflows.map((wf) => {
              const isSelected = selectedWorkflow?.id === wf.id;
              return (
                <div
                  key={wf.id}
                  onClick={() => selectWorkflow(wf)}
                  className={`group relative p-2.5 rounded-xl text-left text-xs transition cursor-pointer border ${
                    isSelected
                      ? "bg-violet-600/15 border-violet-500/40 text-white"
                      : "border-transparent text-neutral-400 hover:bg-white/[0.03] hover:text-white"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold truncate max-w-[140px] text-white">{wf.name}</span>
                    <span className="text-[9px] font-mono px-1 rounded bg-white/[0.06] text-neutral-400">
                      v{wf.version || 1}
                    </span>
                  </div>
                  <p className="text-[10px] text-neutral-500 truncate mb-1.5">
                    {wf.description || "Visual automation workflow"}
                  </p>

                  <div className="flex items-center justify-between text-[10px] text-neutral-500">
                    <span className="capitalize">{wf.status || "active"}</span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDuplicateWorkflow(wf.id);
                        }}
                        title="Duplicate Workflow"
                        className="p-1 hover:text-violet-400"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteWorkflow(wf.id);
                        }}
                        title="Delete Workflow"
                        className="p-1 hover:text-rose-400"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────
          MAIN CANVAS & TOP TOOLBAR
         ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col relative overflow-hidden bg-[#030308]">
        {/* Top Control Toolbar */}
        <div className="h-11 px-4 border-b border-white/[0.06] bg-[#070712]/90 backdrop-blur flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            {isEditingTitle ? (
              <input
                type="text"
                value={editedTitle}
                autoFocus
                onChange={(e) => setEditedTitle(e.target.value)}
                onBlur={() => {
                  setIsEditingTitle(false);
                  if (editedTitle.trim() && selectedWorkflow) {
                    setHasUnsavedChanges(true);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setIsEditingTitle(false);
                }}
                className="px-2 py-0.5 rounded bg-white/[0.06] border border-violet-500 text-xs text-white font-bold focus:outline-none"
              />
            ) : (
              <div
                onClick={() => setIsEditingTitle(true)}
                className="flex items-center gap-1.5 cursor-pointer group"
              >
                <span className="text-xs font-bold text-white group-hover:text-violet-300">
                  {editedTitle || selectedWorkflow?.name || "Pipeline Canvas"}
                </span>
                <Edit2 className="w-3 h-3 text-neutral-500 group-hover:text-white" />
              </div>
            )}

            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                hasUnsavedChanges
                  ? "bg-amber-500/10 text-amber-300 border-amber-500/30"
                  : "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
              }`}
            >
              {hasUnsavedChanges ? "Unsaved changes" : `Saved v${selectedWorkflow?.version || 1}`}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Undo / Redo */}
            <button
              onClick={handleUndo}
              disabled={historyIndex <= 0}
              title="Undo"
              className="p-1.5 rounded-lg bg-white/[0.04] text-neutral-400 hover:text-white disabled:opacity-30 disabled:hover:text-neutral-400"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleRedo}
              disabled={historyIndex >= history.length - 1}
              title="Redo"
              className="p-1.5 rounded-lg bg-white/[0.04] text-neutral-400 hover:text-white disabled:opacity-30 disabled:hover:text-neutral-400"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>

            <div className="h-4 w-[1px] bg-white/[0.1] mx-1" />

            {/* Zoom Controls */}
            <button
              onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
              title="Zoom In"
              className="p-1.5 rounded-lg bg-white/[0.04] text-neutral-400 hover:text-white"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] font-mono text-neutral-400 w-8 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))}
              title="Zoom Out"
              className="p-1.5 rounded-lg bg-white/[0.04] text-neutral-400 hover:text-white"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => fitToScreen()}
              title="Fit to Screen"
              className="p-1.5 rounded-lg bg-white/[0.04] text-neutral-400 hover:text-white"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>

            <div className="h-4 w-[1px] bg-white/[0.1] mx-1" />

            {/* Add Step */}
            <button
              onClick={() => setShowAddNodeModal(true)}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white/[0.06] hover:bg-white/[0.1] text-white flex items-center gap-1 transition"
            >
              <Plus className="w-3.5 h-3.5" /> Add Step
            </button>

            {/* Validate */}
            <button
              onClick={handleValidateGraph}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white/[0.06] hover:bg-white/[0.1] text-neutral-300 hover:text-white flex items-center gap-1 transition"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" /> Validate
            </button>

            {/* Save */}
            <button
              onClick={handleSaveWorkflow}
              disabled={isSaving}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white flex items-center gap-1 shadow-sm shadow-violet-600/30 transition disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" /> Save
            </button>

            {/* Run */}
            <button
              onClick={handleRunWorkflow}
              disabled={isRunning || !selectedWorkflow}
              className="px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1 shadow-md shadow-emerald-600/30 transition disabled:opacity-50"
            >
              <Play className="w-3 h-3 fill-current" /> {isRunning ? "Running..." : "Run Pipeline"}
            </button>

            {/* History Toggle */}
            <button
              onClick={async () => {
                setShowExecutionHistory(!showExecutionHistory);
                if (!showExecutionHistory) {
                  const res = await workflowBuilderApi.getExecutions();
                  setExecutionHistory(res.executions || []);
                }
              }}
              title="Execution History"
              className={`p-1.5 rounded-lg border transition ${
                showExecutionHistory
                  ? "bg-violet-600/20 border-violet-500 text-white"
                  : "bg-white/[0.04] border-white/[0.06] text-neutral-400 hover:text-white"
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* ──────────────────────────────────────────────────────────
            CANVAS WORKSPACE
           ────────────────────────────────────────────────────────── */}
        <div
          ref={canvasRef}
          onMouseDown={(e) => {
            if (e.target === canvasRef.current || (e.target as HTMLElement).tagName === "svg") {
              setIsPanning(true);
              setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
              setSelectedNode(null);
              setSelectedEdge(null);
            }
          }}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          className="flex-1 overflow-hidden relative cursor-grab active:cursor-grabbing select-none"
          style={{
            backgroundImage: "radial-gradient(rgba(255,255,255,0.07) 1.2px, transparent 1.2px)",
            backgroundSize: "24px 24px",
          }}
        >
          {/* SVG Connection Layer */}
          <svg
            className="absolute inset-0 pointer-events-none"
            style={{
              width: "100%",
              height: "100%",
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "0 0",
            }}
          >
            {/* Render Existing Edges */}
            {edges.map((edge) => {
              const pathData = getEdgePath(edge);
              const isEdgeSelected = selectedEdge?.id === edge.id;
              return (
                <g key={edge.id} className="pointer-events-auto cursor-pointer">
                  {/* Invisible broad stroke for easier clicking */}
                  <path
                    d={pathData}
                    fill="none"
                    stroke="transparent"
                    strokeWidth="16"
                    onClick={() => {
                      setSelectedEdge(edge);
                      setSelectedNode(null);
                    }}
                  />
                  {/* Visual Edge Path */}
                  <path
                    d={pathData}
                    fill="none"
                    stroke={
                      isEdgeSelected
                        ? "#a855f7"
                        : edge.status === "active"
                        ? "#8b5cf6"
                        : "#4b5563"
                    }
                    strokeWidth={isEdgeSelected ? "2.5" : "1.8"}
                    strokeDasharray={edge.status === "active" ? "4 3" : undefined}
                    className={edge.status === "active" ? "animate-[dash_1s_linear_infinite]" : ""}
                  />
                </g>
              );
            })}

            {/* In-progress Dragging Connection Line */}
            {connectingSource && (
              <path
                d={`M ${connectingSource.x} ${connectingSource.y} C ${
                  connectingSource.x + Math.abs(mouseCanvasPos.x - connectingSource.x) * 0.5
                } ${connectingSource.y}, ${
                  mouseCanvasPos.x - Math.abs(mouseCanvasPos.x - connectingSource.x) * 0.5
                } ${mouseCanvasPos.y}, ${mouseCanvasPos.x} ${mouseCanvasPos.y}`}
                fill="none"
                stroke="#06b6d4"
                strokeWidth="2"
                strokeDasharray="4 4"
              />
            )}
          </svg>

          {/* Render Nodes Layer */}
          <div
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "0 0",
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
            }}
          >
            {nodes.map((node) => {
              const isNodeSelected = selectedNode?.id === node.id;
              return (
                <div
                  key={node.id}
                  onMouseDown={(e) => handleNodeMouseDown(e, node)}
                  style={{
                    position: "absolute",
                    left: `${node.position.x}px`,
                    top: `${node.position.y}px`,
                  }}
                  className={`w-60 rounded-2xl bg-[#090916] border transition-shadow shadow-xl cursor-grab active:cursor-grabbing pointer-events-auto ${
                    isNodeSelected
                      ? "border-violet-500 ring-2 ring-violet-500/25"
                      : node.status === "running"
                      ? "border-cyan-400 ring-2 ring-cyan-400/20"
                      : node.status === "succeeded"
                      ? "border-emerald-500/60"
                      : node.status === "failed"
                      ? "border-rose-500"
                      : "border-white/[0.08] hover:border-white/20"
                  }`}
                >
                  {/* Left Input Port */}
                  {!node.type.startsWith("trigger.") && (
                    <div
                      onMouseUp={(e) => handlePortMouseUp(e, node.id, "in")}
                      className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-[#0a0a1a] border-2 border-violet-400 flex items-center justify-center hover:scale-125 transition cursor-crosshair z-20"
                      title="Input Flow Port"
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-violet-400" />
                    </div>
                  )}

                  {/* Right Output Port */}
                  {!node.type.startsWith("output.") && (
                    <div
                      onMouseDown={(e) => handlePortMouseDown(e, node.id, "out")}
                      className="absolute -right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-[#0a0a1a] border-2 border-emerald-400 flex items-center justify-center hover:scale-125 transition cursor-crosshair z-20"
                      title="Output Flow Port (drag to connect)"
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    </div>
                  )}

                  {/* Node Header */}
                  <div className="p-3 border-b border-white/[0.06] flex items-center justify-between">
                    <span
                      className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded tracking-wider ${
                        node.category === "trigger"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : node.category === "browser"
                          ? "bg-cyan-500/20 text-cyan-300"
                          : node.category === "ai"
                          ? "bg-violet-500/20 text-violet-300"
                          : node.category === "comm"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : node.category === "research"
                          ? "bg-amber-500/20 text-amber-300"
                          : "bg-blue-500/20 text-blue-300"
                      }`}
                    >
                      {node.category}
                    </span>

                    <div className="flex items-center gap-1.5">
                      {node.status === "running" && (
                        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                      )}
                      {node.status === "succeeded" && (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      )}
                      {node.status === "failed" && (
                        <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                      )}
                    </div>
                  </div>

                  {/* Node Body */}
                  <div className="p-3 space-y-1.5">
                    <div className="text-xs font-bold text-white truncate">{node.title}</div>
                    <div className="text-[10px] text-neutral-400 truncate">
                      {node.config?.url ||
                        node.config?.action ||
                        node.config?.query ||
                        node.config?.phone ||
                        node.type}
                    </div>

                    {/* Output summary badge */}
                    {node.outputData && (
                      <div className="mt-2 pt-2 border-t border-white/[0.04] text-[10px] text-emerald-400 font-mono truncate">
                        ✓ Output ready
                      </div>
                    )}
                    {node.error && (
                      <div className="mt-2 pt-2 border-t border-white/[0.04] text-[10px] text-rose-400 font-mono truncate">
                        ✕ {node.error}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ──────────────────────────────────────────────────────────
            NODE CONFIGURATION INSPECTOR PANEL
           ────────────────────────────────────────────────────────── */}
        {selectedNode && (
          <div className="absolute right-0 top-11 bottom-0 w-80 bg-[#080816]/95 backdrop-blur border-l border-white/[0.08] p-4 flex flex-col justify-between z-20 shadow-2xl overflow-y-auto">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                  <Settings className="w-4 h-4 text-violet-400" />
                  <h4 className="text-xs font-bold text-white">Node Inspector</h4>
                </div>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="text-neutral-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="py-3 space-y-3.5 text-xs">
                <div>
                  <label className="text-[10px] text-neutral-500 uppercase font-bold block mb-1">
                    Node Title
                  </label>
                  <input
                    type="text"
                    value={selectedNode.title}
                    onChange={(e) => {
                      const updated = { ...selectedNode, title: e.target.value };
                      setSelectedNode(updated);
                      setNodes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
                      setHasUnsavedChanges(true);
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-white focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] text-neutral-500 uppercase font-bold block mb-1">
                    Type Contract
                  </label>
                  <span className="text-xs font-mono text-neutral-300 px-2 py-1 rounded bg-black/40 block">
                    {selectedNode.type}
                  </span>
                </div>

                {/* Specific Config Inputs */}
                {selectedNode.type === "browser.openUrl" && (
                  <div>
                    <label className="text-[10px] text-neutral-500 uppercase font-bold block mb-1">
                      Target URL
                    </label>
                    <input
                      type="url"
                      value={selectedNode.config?.url || ""}
                      onChange={(e) => {
                        const updated = {
                          ...selectedNode,
                          config: { ...selectedNode.config, url: e.target.value },
                        };
                        setSelectedNode(updated);
                        setNodes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
                        setHasUnsavedChanges(true);
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-white focus:outline-none focus:border-violet-500"
                    />
                  </div>
                )}

                {selectedNode.type === "browser.click" && (
                  <div>
                    <label className="text-[10px] text-neutral-500 uppercase font-bold block mb-1">
                      CSS Selector
                    </label>
                    <input
                      type="text"
                      value={selectedNode.config?.selector || ""}
                      onChange={(e) => {
                        const updated = {
                          ...selectedNode,
                          config: { ...selectedNode.config, selector: e.target.value },
                        };
                        setSelectedNode(updated);
                        setNodes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
                        setHasUnsavedChanges(true);
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-white focus:outline-none focus:border-violet-500"
                    />
                  </div>
                )}

                {selectedNode.type === "comm.sendWhatsApp" && (
                  <>
                    <div>
                      <label className="text-[10px] text-neutral-500 uppercase font-bold block mb-1">
                        Recipient (E.164 Phone)
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config?.phone || ""}
                        onChange={(e) => {
                          const updated = {
                            ...selectedNode,
                            config: { ...selectedNode.config, phone: e.target.value },
                          };
                          setSelectedNode(updated);
                          setNodes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
                          setHasUnsavedChanges(true);
                        }}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-white focus:outline-none focus:border-violet-500"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-neutral-500 uppercase font-bold block mb-1">
                        Message Body
                      </label>
                      <textarea
                        rows={3}
                        value={selectedNode.config?.message || ""}
                        onChange={(e) => {
                          const updated = {
                            ...selectedNode,
                            config: { ...selectedNode.config, message: e.target.value },
                          };
                          setSelectedNode(updated);
                          setNodes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
                          setHasUnsavedChanges(true);
                        }}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-white focus:outline-none focus:border-violet-500 resize-none"
                      />
                    </div>
                  </>
                )}

                {/* Output Inspector */}
                {selectedNode.outputData && (
                  <div>
                    <label className="text-[10px] text-neutral-500 uppercase font-bold block mb-1">
                      Execution Result Output
                    </label>
                    <pre className="p-2.5 rounded bg-black/60 text-[10px] font-mono text-emerald-300 overflow-x-auto max-h-48 border border-white/[0.06]">
                      {JSON.stringify(selectedNode.outputData, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={() => handleDeleteNode(selectedNode.id)}
              className="w-full py-2 rounded-xl text-xs font-semibold bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 transition flex items-center justify-center gap-1.5 border border-rose-500/30"
            >
              <Trash2 className="w-3.5 h-3.5" /> Remove Node
            </button>
          </div>
        )}

        {/* Selected Edge Inspector Banner */}
        {selectedEdge && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-xl bg-[#090918] border border-violet-500/40 shadow-2xl flex items-center gap-4">
            <span className="text-xs text-white">
              Connection: <strong className="text-violet-400">{selectedEdge.source}</strong> →{" "}
              <strong className="text-emerald-400">{selectedEdge.target}</strong>
            </span>
            <button
              onClick={() => handleDeleteEdge(selectedEdge.id)}
              className="px-2 py-1 rounded bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 text-xs font-semibold flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" /> Disconnect
            </button>
            <button onClick={() => setSelectedEdge(null)} className="text-neutral-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* ──────────────────────────────────────────────────────────
          ADD NODE PALETTE MODAL
         ────────────────────────────────────────────────────────── */}
      {showAddNodeModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-[#080816] border border-white/[0.08] rounded-2xl shadow-2xl flex flex-col max-h-[80vh] overflow-hidden">
            <div className="p-4 border-b border-white/[0.06] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">Add Step to Workflow</h3>
                <p className="text-xs text-neutral-400">
                  Select a validated node to place on the automation canvas
                </p>
              </div>
              <button
                onClick={() => setShowAddNodeModal(false)}
                className="text-neutral-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Category Tabs & Search */}
            <div className="p-3 border-b border-white/[0.04] flex items-center justify-between gap-3">
              <div className="flex items-center gap-1 overflow-x-auto text-xs">
                {["all", "trigger", "browser", "ai", "research", "data", "comm", "logic", "output"].map(
                  (cat) => (
                    <button
                      key={cat}
                      onClick={() => setAddNodeCategory(cat)}
                      className={`px-2.5 py-1 rounded-lg capitalize font-medium transition ${
                        addNodeCategory === cat
                          ? "bg-violet-600 text-white"
                          : "text-neutral-400 hover:text-white hover:bg-white/[0.04]"
                      }`}
                    >
                      {cat}
                    </button>
                  )
                )}
              </div>

              <input
                type="text"
                placeholder="Search nodes..."
                value={nodeSearchQuery}
                onChange={(e) => setNodeSearchQuery(e.target.value)}
                className="px-2.5 py-1 rounded-lg bg-white/[0.03] border border-white/[0.08] text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-violet-500 w-44"
              />
            </div>

            {/* Nodes Grid */}
            <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 gap-2.5">
              {NODE_PALETTE.filter(
                (meta) =>
                  (addNodeCategory === "all" || meta.category === addNodeCategory) &&
                  (meta.title.toLowerCase().includes(nodeSearchQuery.toLowerCase()) ||
                    meta.description.toLowerCase().includes(nodeSearchQuery.toLowerCase()))
              ).map((meta) => (
                <div
                  key={meta.type}
                  onClick={() => handleAddNode(meta)}
                  className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-violet-500/40 hover:bg-violet-600/10 transition cursor-pointer flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-white">{meta.title}</span>
                      <span className="text-[9px] uppercase font-mono px-1 rounded bg-white/[0.06] text-neutral-400">
                        {meta.category}
                      </span>
                    </div>
                    <p className="text-[11px] text-neutral-400 line-clamp-2">{meta.description}</p>
                  </div>
                  <div className="mt-2 text-[10px] text-violet-400 flex items-center gap-1 font-semibold">
                    <span>Add to Canvas</span>
                    <ChevronRight className="w-3 h-3" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────
          VALIDATION RESULTS MODAL
         ────────────────────────────────────────────────────────── */}
      {showValidationModal && validationResult && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#080816] border border-white/[0.08] rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {validationResult.valid ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-rose-400" />
                )}
                <h3 className="text-sm font-bold text-white">
                  {validationResult.valid ? "Graph Validation Passed" : "Graph Validation Issues"}
                </h3>
              </div>
              <button
                onClick={() => setShowValidationModal(false)}
                className="text-neutral-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {validationResult.valid ? (
              <p className="text-xs text-neutral-300">
                All nodes, port connections, required inputs, and execution paths satisfy server validation contracts. Graph is acyclic and ready for execution.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-rose-300 font-semibold">
                  Please resolve the following issues before running:
                </p>
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {validationResult.errors.map((err, i) => (
                    <div
                      key={i}
                      onClick={() => {
                        if (err.nodeId) {
                          const n = nodes.find((x) => x.id === err.nodeId);
                          if (n) setSelectedNode(n);
                        }
                        setShowValidationModal(false);
                      }}
                      className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-200 cursor-pointer hover:bg-rose-500/20 transition flex items-start gap-2"
                    >
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                      <div>
                        <div>{err.message}</div>
                        {err.nodeId && (
                          <div className="text-[10px] text-rose-400 underline mt-0.5">
                            Jump to Node {err.nodeId}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => setShowValidationModal(false)}
              className="w-full py-2 rounded-xl bg-white/[0.08] hover:bg-white/[0.12] text-xs font-semibold text-white transition"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
