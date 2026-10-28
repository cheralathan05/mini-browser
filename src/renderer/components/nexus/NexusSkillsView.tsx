import React, { useState, useEffect, useMemo } from "react";
import {
  Sparkles,
  Play,
  Plus,
  Check,
  Loader2,
  Code2,
  X,
  Wrench,
  FileText,
  Trash2,
  Search,
  SlidersHorizontal,
  Compass,
  Globe,
  Zap,
  Database,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  History,
  Terminal,
  RotateCcw,
  ExternalLink,
  ChevronRight,
  Activity,
  Layers,
  Copy,
} from "lucide-react";
import { skillsApi, SkillRecord, ToolCatalogItem, InputFieldDef, OutputFieldDef } from "../../lib/nexus/skills.api";
import { useToast } from "./NexusToast";

interface NexusSkillsViewProps {
  workspaceId?: string | null;
}

export const NexusSkillsView: React.FC<NexusSkillsViewProps> = ({ workspaceId }) => {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [toolCatalog, setToolCatalog] = useState<ToolCatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");

  // Slide-over Studio State
  const [editingSkill, setEditingSkill] = useState<SkillRecord | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [activeStudioTab, setActiveStudioTab] = useState<"schemas" | "tools" | "tests" | "versions" | "executions">("schemas");
  const [isSaving, setIsSaving] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isActivating, setIsActivating] = useState(false);

  // Execution Modal State
  const [executingSkill, setExecutingSkill] = useState<SkillRecord | null>(null);
  const [executionInputs, setExecutionInputs] = useState<Record<string, any>>({});
  const [isRunningExecution, setIsRunningExecution] = useState(false);
  const [executionResult, setExecutionResult] = useState<any>(null);

  // Form State for Studio
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formCategory, setFormCategory] = useState<"research" | "browser" | "coding" | "automation" | "data">("automation");
  const [formInstructions, setFormInstructions] = useState("");
  const [formTags, setFormTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [formTools, setFormTools] = useState<string[]>([]);
  const [formInputSchema, setFormInputSchema] = useState<InputFieldDef[]>([]);
  const [formOutputSchema, setFormOutputSchema] = useState<OutputFieldDef[]>([]);
  const [formPermissions, setFormPermissions] = useState({ network: true, browser: false, sandbox: false, approvalRequired: false });
  const [formTimeout, setFormTimeout] = useState(30);
  const [formRetries, setFormRetries] = useState(1);
  const [validationAlerts, setValidationAlerts] = useState<any[]>([]);

  // Testing State in Studio
  const [testInputJson, setTestInputJson] = useState("{}");
  const [isRunningTest, setIsRunningTest] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  const toast = useToast();

  const loadSkills = async () => {
    try {
      setIsLoading(true);
      const [skillsRes, toolsRes] = await Promise.all([
        skillsApi.getSkills({
          workspaceId: workspaceId || undefined,
          status: selectedStatus === "all" ? undefined : selectedStatus,
          category: selectedCategory === "all" ? undefined : selectedCategory,
          search: searchQuery.trim() || undefined,
        }),
        skillsApi.getToolCatalog().catch(() => ({ tools: [], count: 0 })),
      ]);
      setSkills(skillsRes.skills || []);
      setToolCatalog(toolsRes.tools || []);
    } catch (e: any) {
      console.error("Failed to load skills registry:", e);
      toast.error(e.message || "Failed to load skills");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSkills();
  }, [workspaceId, selectedCategory, selectedStatus]);

  // Metric Computations
  const metrics = useMemo(() => {
    const total = skills.length;
    const active = skills.filter((s) => s.lifecycleState === "active").length;
    const readyOrDraft = skills.filter((s) => s.lifecycleState === "ready" || s.lifecycleState === "draft").length;
    const executionsCount = skills.reduce((acc, s) => acc + (s.executions?.length || 0), 0);
    return { total, active, readyOrDraft, executionsCount };
  }, [skills]);

  // Open Studio for Editing
  const handleOpenStudio = (skill: SkillRecord) => {
    setEditingSkill(skill);
    setIsCreatingNew(false);
    setFormName(skill.name);
    setFormDesc(skill.description);
    setFormCategory(skill.category);
    setFormInstructions(skill.instructions || skill.description);
    setFormTags(skill.tags || []);
    setFormTools(skill.tools || []);
    setFormInputSchema(skill.inputSchema || []);
    setFormOutputSchema(skill.outputSchema || []);
    setFormPermissions(skill.permissions || { network: true, browser: false, sandbox: false, approvalRequired: false });
    setFormTimeout(skill.config?.timeoutSeconds || 30);
    setFormRetries(skill.config?.maxRetries || 1);
    setValidationAlerts(skill.validationErrors || []);
    setActiveStudioTab("schemas");
    setTestResult(null);

    // Populate test JSON draft with defaults
    const defaultInputs: Record<string, any> = {};
    (skill.inputSchema || []).forEach((f) => {
      defaultInputs[f.name] = f.defaultValue !== undefined ? f.defaultValue : (f.type === "number" ? 0 : f.type === "boolean" ? false : f.type === "object" ? {} : "");
    });
    setTestInputJson(JSON.stringify(defaultInputs, null, 2));
  };

  // Open Studio for New Skill
  const handleOpenNewSkill = () => {
    setEditingSkill(null);
    setIsCreatingNew(true);
    setFormName("");
    setFormDesc("");
    setFormCategory("automation");
    setFormInstructions("");
    setFormTags(["custom"]);
    setFormTools(["web_search"]);
    setFormInputSchema([
      { name: "query", type: "string", label: "Query", description: "Search query or task prompt", required: true, defaultValue: "Autonomous agents" },
    ]);
    setFormOutputSchema([
      { name: "result", type: "string", description: "Output result payload" },
    ]);
    setFormPermissions({ network: true, browser: false, sandbox: false, approvalRequired: false });
    setFormTimeout(30);
    setFormRetries(1);
    setValidationAlerts([]);
    setActiveStudioTab("schemas");
    setTestResult(null);
    setTestInputJson(JSON.stringify({ query: "Autonomous agents" }, null, 2));
  };

  // Close Studio
  const handleCloseStudio = () => {
    setEditingSkill(null);
    setIsCreatingNew(false);
    setValidationAlerts([]);
    setTestResult(null);
  };

  // Save / Update Skill
  const handleSaveSkill = async () => {
    if (!formName.trim() || !formDesc.trim()) {
      toast.warning("Please provide a name and description for the skill.");
      return;
    }

    try {
      setIsSaving(true);
      const payload = {
        workspaceId: workspaceId || undefined,
        name: formName.trim(),
        description: formDesc.trim(),
        instructions: formInstructions.trim() || formDesc.trim(),
        category: formCategory,
        tags: formTags,
        tools: formTools,
        inputSchema: formInputSchema,
        outputSchema: formOutputSchema,
        permissions: formPermissions,
        config: { timeoutSeconds: formTimeout, maxRetries: formRetries },
      };

      if (isCreatingNew) {
        const res = await skillsApi.createSkill(payload);
        toast.success(`Skill "${res.skill.name}" created as draft`);
        setEditingSkill(res.skill);
        setIsCreatingNew(false);
      } else if (editingSkill) {
        const res = await skillsApi.updateSkill(editingSkill.id, payload);
        toast.success(`Skill "${res.skill.name}" updated (v${res.skill.currentVersion})`);
        setEditingSkill(res.skill);
      }
      await loadSkills();
    } catch (err: any) {
      toast.error(err.message || "Failed to save skill");
    } finally {
      setIsSaving(false);
    }
  };

  // Validate Skill
  const handleValidateSkill = async () => {
    if (!editingSkill) return;
    try {
      setIsValidating(true);
      const res = await skillsApi.validateSkill(editingSkill.id);
      if (res.validation.valid) {
        toast.success("Validation passed! All tool contracts and schemas verified.");
        setValidationAlerts([]);
      } else {
        toast.warning(`Validation issues found (${res.validation.errors.length} errors)`);
        setValidationAlerts(res.validation.errors);
      }
      await loadSkills();
    } catch (err: any) {
      toast.error(err.message || "Validation request failed");
    } finally {
      setIsValidating(false);
    }
  };

  // Activate Skill
  const handleActivateSkill = async () => {
    if (!editingSkill) return;
    try {
      setIsActivating(true);
      const res = await skillsApi.activateSkill(editingSkill.id);
      toast.success(res.message || `Skill "${editingSkill.name}" is now active!`);
      setEditingSkill(res.skill);
      setValidationAlerts([]);
      await loadSkills();
    } catch (err: any) {
      toast.error(err.message || "Activation rejected");
    } finally {
      setIsActivating(false);
    }
  };

  // Toggle Disable
  const handleToggleDisable = async (skill: SkillRecord) => {
    try {
      if (skill.lifecycleState === "active") {
        await skillsApi.disableSkill(skill.id);
        toast.info(`Skill "${skill.name}" disabled`);
      } else {
        await skillsApi.activateSkill(skill.id);
        toast.success(`Skill "${skill.name}" activated`);
      }
      await loadSkills();
    } catch (err: any) {
      toast.error(err.message || "Failed to update lifecycle state");
    }
  };

  // Delete Skill
  const handleDeleteSkill = async (skillId: string, skillName: string) => {
    if (!window.confirm(`Are you sure you want to permanently delete the skill "${skillName}" and its version history?`)) return;
    try {
      await skillsApi.deleteSkill(skillId);
      toast.success(`Skill "${skillName}" deleted`);
      if (editingSkill?.id === skillId) {
        handleCloseStudio();
      }
      setSkills((prev) => prev.filter((s) => s.id !== skillId));
    } catch (err: any) {
      toast.error(err.message || "Failed to delete skill");
    }
  };

  // Run Test in Studio
  const handleRunStudioTest = async () => {
    if (!editingSkill) return;
    try {
      setIsRunningTest(true);
      let parsedInputs = {};
      try {
        parsedInputs = JSON.parse(testInputJson);
      } catch {
        toast.error("Invalid JSON format in test inputs");
        setIsRunningTest(false);
        return;
      }

      const res = await skillsApi.runTests(editingSkill.id, {
        name: "Studio Interactive Test",
        inputs: parsedInputs,
        runNow: true,
      });

      setTestResult(res);
      if (res.test?.status === "passed") {
        toast.success("Test passed! Verified tool execution.");
      } else {
        toast.warning(res.error || "Test execution reported errors.");
      }
      await loadSkills();
    } catch (err: any) {
      toast.error(err.message || "Failed to execute test run");
    } finally {
      setIsRunningTest(false);
    }
  };

  // Rollback Version
  const handleRollbackVersion = async (targetVersion: number) => {
    if (!editingSkill) return;
    if (!window.confirm(`Rollback skill to version ${targetVersion}?`)) return;
    try {
      const res = await skillsApi.rollbackVersion(editingSkill.id, targetVersion);
      toast.success(res.message);
      setEditingSkill(res.skill);
      await loadSkills();
    } catch (err: any) {
      toast.error(err.message || "Rollback failed");
    }
  };

  // Open Execution Modal
  const handleOpenExecutionModal = (skill: SkillRecord) => {
    setExecutingSkill(skill);
    const initialInputs: Record<string, any> = {};
    (skill.inputSchema || []).forEach((field) => {
      initialInputs[field.name] = field.defaultValue !== undefined ? field.defaultValue : (field.type === "number" ? 0 : field.type === "boolean" ? false : field.type === "object" ? {} : "");
    });
    setExecutionInputs(initialInputs);
    setExecutionResult(null);
  };

  // Run Execution from Modal
  const handleExecuteSkill = async () => {
    if (!executingSkill) return;
    try {
      setIsRunningExecution(true);
      const res = await skillsApi.executeSkill(executingSkill.id, executionInputs, { caller: "manual" });
      setExecutionResult(res.execution);
      if (res.execution.status === "completed") {
        toast.success(`Skill "${executingSkill.name}" executed successfully!`);
      } else if (res.execution.status === "waiting_for_approval") {
        toast.info("Execution paused at Human-in-the-Loop approval gate.");
      } else {
        toast.warning(`Execution status: ${res.execution.status}`);
      }
      await loadSkills();
    } catch (err: any) {
      toast.error(err.message || "Skill execution failed");
    } finally {
      setIsRunningExecution(false);
    }
  };

  // Add/Remove Input Field in Studio
  const handleAddInputField = () => {
    setFormInputSchema((prev) => [
      ...prev,
      { name: `param_${prev.length + 1}`, type: "string", label: `Param ${prev.length + 1}`, required: true },
    ]);
  };
  const handleRemoveInputField = (index: number) => {
    setFormInputSchema((prev) => prev.filter((_, i) => i !== index));
  };

  // Add/Remove Output Field in Studio
  const handleAddOutputField = () => {
    setFormOutputSchema((prev) => [
      ...prev,
      { name: `output_${prev.length + 1}`, type: "string", description: "Result data" },
    ]);
  };
  const handleRemoveOutputField = (index: number) => {
    setFormOutputSchema((prev) => prev.filter((_, i) => i !== index));
  };

  // Add Tag
  const handleAddTag = () => {
    if (tagInput.trim() && !formTags.includes(tagInput.trim())) {
      setFormTags([...formTags, tagInput.trim()]);
      setTagInput("");
    }
  };

  // Lifecycle Badge Helper
  const getLifecycleBadge = (state: string) => {
    switch (state) {
      case "active":
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"><CheckCircle2 className="w-2.5 h-2.5" />Active</span>;
      case "ready":
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20"><AlertCircle className="w-2.5 h-2.5" />Ready</span>;
      case "disabled":
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">Disabled</span>;
      case "failed_validation":
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20">Validation Failed</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-800 text-zinc-400 border border-zinc-700">Draft</span>;
    }
  };

  // Category Icon Helper
  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "research":
        return <Compass className="w-3.5 h-3.5 text-amber-400" />;
      case "browser":
        return <Globe className="w-3.5 h-3.5 text-cyan-400" />;
      case "coding":
        return <Code2 className="w-3.5 h-3.5 text-violet-400" />;
      case "data":
        return <Database className="w-3.5 h-3.5 text-blue-400" />;
      default:
        return <Zap className="w-3.5 h-3.5 text-emerald-400" />;
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-[#050507] text-neutral-100 overflow-hidden select-none font-sans">
      {/* 1. TOP HEADER & METRICS BAR */}
      <div className="px-8 pt-6 pb-4 border-b border-neutral-800/80 bg-[#08080d]/80 backdrop-blur-md shrink-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-600/30 via-cyan-600/20 to-transparent border border-violet-500/30 flex items-center justify-center text-violet-400 shadow-lg shadow-violet-900/20">
              <Sparkles className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-white tracking-wide">Skills Registry</h1>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-violet-500/10 text-violet-300 border border-violet-500/20">
                  {metrics.active} Active
                </span>
              </div>
              <p className="text-xs text-neutral-400">
                Reusable, versioned autonomous capabilities with verified input/output schemas and authorized tool contracts
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleOpenNewSkill}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/20 transition active:scale-[0.98]"
            >
              <Plus className="w-4 h-4" />
              <span>Create Skill</span>
            </button>
          </div>
        </div>

        {/* METRICS TILES */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl bg-[#0c0c12] border border-neutral-800/80 flex items-center justify-between">
            <div>
              <div className="text-[11px] text-neutral-400 font-medium">Total Registered</div>
              <div className="text-lg font-bold text-white mt-0.5">{metrics.total}</div>
            </div>
            <Layers className="w-5 h-5 text-neutral-500" />
          </div>
          <div className="p-3 rounded-xl bg-[#0c0c12] border border-neutral-800/80 flex items-center justify-between">
            <div>
              <div className="text-[11px] text-emerald-400/90 font-medium">Active Capabilities</div>
              <div className="text-lg font-bold text-emerald-400 mt-0.5">{metrics.active}</div>
            </div>
            <CheckCircle2 className="w-5 h-5 text-emerald-500/60" />
          </div>
          <div className="p-3 rounded-xl bg-[#0c0c12] border border-neutral-800/80 flex items-center justify-between">
            <div>
              <div className="text-[11px] text-amber-400/90 font-medium">Ready / Drafts</div>
              <div className="text-lg font-bold text-amber-400 mt-0.5">{metrics.readyOrDraft}</div>
            </div>
            <SlidersHorizontal className="w-5 h-5 text-amber-500/60" />
          </div>
          <div className="p-3 rounded-xl bg-[#0c0c12] border border-neutral-800/80 flex items-center justify-between">
            <div>
              <div className="text-[11px] text-cyan-400/90 font-medium">Execution Runs</div>
              <div className="text-lg font-bold text-cyan-400 mt-0.5">{metrics.executionsCount}</div>
            </div>
            <Activity className="w-5 h-5 text-cyan-500/60" />
          </div>
        </div>

        {/* FILTER & SEARCH ROW */}
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-4 border-t border-neutral-800/60">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            {["all", "research", "browser", "coding", "automation", "data"].map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition shrink-0 ${
                  selectedCategory === cat
                    ? "bg-neutral-800 text-white border border-neutral-700 shadow-sm"
                    : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-neutral-300 focus:outline-none focus:border-violet-500"
            >
              <option value="all">All States</option>
              <option value="active">Active</option>
              <option value="ready">Ready</option>
              <option value="draft">Draft</option>
              <option value="disabled">Disabled</option>
            </select>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search capabilities..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-violet-500 w-44 sm:w-56"
              />
            </div>
          </div>
        </div>
      </div>

      {/* 2. SKILL CARDS GRID */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-7xl mx-auto">
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="p-5 rounded-2xl bg-[#0c0c12] border border-neutral-800/80 h-56" />
              ))}
            </div>
          ) : skills.length === 0 ? (
            <div className="py-24 text-center max-w-md mx-auto">
              <div className="w-12 h-12 rounded-2xl bg-violet-600/10 border border-violet-500/20 flex items-center justify-center text-violet-400 mx-auto mb-3">
                <Sparkles className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-semibold text-white">No Skills Found</h3>
              <p className="text-xs text-neutral-500 mt-1 mb-5">
                No registered agent skills match the selected filter criteria. Create a new skill to get started.
              </p>
              <button
                type="button"
                onClick={handleOpenNewSkill}
                className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/20 transition"
              >
                Create First Skill
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {skills.map((skill) => (
                <div
                  key={skill.id}
                  className="p-5 rounded-2xl bg-[#0c0c12] border border-neutral-800/80 hover:border-neutral-700 transition flex flex-col justify-between group shadow-lg shadow-black/20"
                >
                  <div>
                    {/* CARD HEADER */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-neutral-900 border border-neutral-800">
                          {getCategoryIcon(skill.category)}
                        </div>
                        <div>
                          <h3 className="text-xs font-bold text-white tracking-wide group-hover:text-violet-300 transition line-clamp-1">
                            {skill.name}
                          </h3>
                          <span className="text-[10px] text-neutral-500 font-mono">v{skill.currentVersion}</span>
                        </div>
                      </div>
                      <div>{getLifecycleBadge(skill.lifecycleState)}</div>
                    </div>

                    {/* DESCRIPTION */}
                    <p className="text-[11px] text-neutral-400 line-clamp-2 leading-relaxed mb-3">
                      {skill.description}
                    </p>

                    {/* TOOLS CHIPS */}
                    <div className="mb-3">
                      <div className="text-[10px] text-neutral-500 font-medium mb-1.5 uppercase tracking-wider">Declared Tools</div>
                      <div className="flex flex-wrap gap-1">
                        {(skill.tools || []).slice(0, 3).map((t, idx) => (
                          <span
                            key={idx}
                            className="text-[10px] px-2 py-0.5 rounded-md bg-neutral-900 border border-neutral-800 text-neutral-300 font-mono"
                          >
                            {t}
                          </span>
                        ))}
                        {(skill.tools || []).length > 3 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-neutral-900 border border-neutral-800 text-neutral-500">
                            +{(skill.tools || []).length - 3}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* PERMISSION BADGES */}
                    <div className="flex items-center gap-2 text-[10px] text-neutral-500 font-mono mb-4">
                      {skill.permissions?.network && <span className="text-cyan-400">● Network</span>}
                      {skill.permissions?.browser && <span className="text-emerald-400">● Browser</span>}
                      {skill.permissions?.sandbox && <span className="text-violet-400">● Sandbox</span>}
                      {skill.permissions?.approvalRequired && <span className="text-amber-400">● Approval Gate</span>}
                    </div>
                  </div>

                  {/* CARD ACTIONS */}
                  <div className="pt-3 border-t border-neutral-800/80 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenExecutionModal(skill)}
                      disabled={skill.lifecycleState !== "active"}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-xl bg-violet-600/10 hover:bg-violet-600 text-violet-300 hover:text-white border border-violet-500/20 text-xs font-semibold transition disabled:opacity-40 disabled:hover:bg-violet-600/10 disabled:hover:text-violet-300"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>Execute</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenStudio(skill)}
                      className="py-1.5 px-3 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 hover:text-white text-xs font-medium transition"
                    >
                      Inspect
                    </button>

                    <button
                      type="button"
                      onClick={() => handleToggleDisable(skill)}
                      title={skill.lifecycleState === "active" ? "Disable Skill" : "Activate Skill"}
                      className="p-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-400 hover:text-neutral-200 transition"
                    >
                      {skill.lifecycleState === "active" ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <AlertCircle className="w-3.5 h-3.5 text-amber-400" />}
                    </button>

                    {!skill.isSystem && (
                      <button
                        type="button"
                        onClick={() => handleDeleteSkill(skill.id, skill.name)}
                        className="p-1.5 rounded-xl bg-neutral-900 hover:bg-red-500/20 border border-neutral-800 text-neutral-500 hover:text-red-400 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 3. SLIDE-OVER SKILL STUDIO DRAWER */}
      {(editingSkill || isCreatingNew) && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-2xl bg-[#09090f] border-l border-neutral-800/90 h-full flex flex-col shadow-2xl">
            {/* DRAWER HEADER */}
            <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between bg-[#0e0e16]/80">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-xl bg-violet-600/20 text-violet-400 border border-violet-500/20">
                  <Wrench className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">
                    {isCreatingNew ? "Create Agent Skill" : `Skill Studio: ${editingSkill?.name}`}
                  </h2>
                  <p className="text-[11px] text-neutral-400">
                    {isCreatingNew ? "Configure capability contract and registered tools" : `Active Version v${editingSkill?.currentVersion} • ${editingSkill?.lifecycleState}`}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCloseStudio}
                className="p-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* STUDIO TABS */}
            <div className="flex items-center px-6 border-b border-neutral-800 bg-[#0c0c14] gap-4">
              {[
                { id: "schemas", label: "Schemas & Metadata" },
                { id: "tools", label: "Tools & Permissions" },
                { id: "tests", label: "Test Suite" },
                { id: "versions", label: "Version History" },
                { id: "executions", label: "Execution Logs" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveStudioTab(tab.id as any)}
                  className={`py-3 text-xs font-semibold border-b-2 transition ${
                    activeStudioTab === tab.id
                      ? "border-violet-500 text-violet-400"
                      : "border-transparent text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* STUDIO TAB CONTENT */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* VALIDATION ALERTS BANNER */}
              {validationAlerts.length > 0 && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs space-y-1">
                  <div className="font-semibold flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                    Validation Errors ({validationAlerts.length}):
                  </div>
                  {validationAlerts.map((err, i) => (
                    <div key={i} className="text-[11px] text-red-200 pl-5">
                      • {err.message}
                    </div>
                  ))}
                </div>
              )}

              {/* TAB 1: SCHEMAS & METADATA */}
              {activeStudioTab === "schemas" && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-neutral-300 mb-1">Skill Name *</label>
                    <input
                      type="text"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="e.g. Competitor Pricing Monitor"
                      className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-xs text-white focus:outline-none focus:border-violet-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-neutral-300 mb-1">Description *</label>
                    <textarea
                      rows={2}
                      value={formDesc}
                      onChange={(e) => setFormDesc(e.target.value)}
                      placeholder="Concise summary of this skill's autonomous capability"
                      className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-xs text-white focus:outline-none focus:border-violet-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-neutral-300 mb-1">Category</label>
                      <select
                        value={formCategory}
                        onChange={(e) => setFormCategory(e.target.value as any)}
                        className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-xs text-white focus:outline-none focus:border-violet-500 capitalize"
                      >
                        <option value="research">Research</option>
                        <option value="browser">Browser</option>
                        <option value="coding">Coding</option>
                        <option value="automation">Automation</option>
                        <option value="data">Data</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-neutral-300 mb-1">Tags</label>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={tagInput}
                          onChange={(e) => setTagInput(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddTag())}
                          placeholder="Add tag and hit Enter"
                          className="flex-1 px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-xs text-white focus:outline-none focus:border-violet-500"
                        />
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {formTags.map((t, idx) => (
                          <span key={idx} className="text-[10px] px-2 py-0.5 rounded-md bg-neutral-900 border border-neutral-800 text-neutral-300 flex items-center gap-1">
                            {t}
                            <button type="button" onClick={() => setFormTags(formTags.filter((_, i) => i !== idx))} className="hover:text-red-400">×</button>
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* INPUT SCHEMA BUILDER */}
                  <div className="pt-3 border-t border-neutral-800/80">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-[11px] font-semibold text-neutral-300 uppercase tracking-wider">Input Schema Parameters</label>
                      <button
                        type="button"
                        onClick={handleAddInputField}
                        className="text-[11px] text-violet-400 hover:text-violet-300 font-medium flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" /> Add Input Field
                      </button>
                    </div>

                    <div className="space-y-2">
                      {formInputSchema.map((field, idx) => (
                        <div key={idx} className="p-3 rounded-xl bg-[#0c0c14] border border-neutral-800 grid grid-cols-12 gap-2 items-center">
                          <input
                            type="text"
                            value={field.name}
                            onChange={(e) => {
                              const updated = [...formInputSchema];
                              updated[idx].name = e.target.value;
                              setFormInputSchema(updated);
                            }}
                            placeholder="paramName"
                            className="col-span-4 px-2 py-1 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-white"
                          />
                          <select
                            value={field.type}
                            onChange={(e) => {
                              const updated = [...formInputSchema];
                              updated[idx].type = e.target.value as any;
                              setFormInputSchema(updated);
                            }}
                            className="col-span-3 px-2 py-1 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-neutral-300"
                          >
                            <option value="string">string</option>
                            <option value="number">number</option>
                            <option value="boolean">boolean</option>
                            <option value="object">object</option>
                            <option value="array">array</option>
                          </select>
                          <label className="col-span-4 flex items-center gap-1.5 text-xs text-neutral-400">
                            <input
                              type="checkbox"
                              checked={field.required}
                              onChange={(e) => {
                                const updated = [...formInputSchema];
                                updated[idx].required = e.target.checked;
                                setFormInputSchema(updated);
                              }}
                              className="rounded border-neutral-700 text-violet-600"
                            />
                            Required
                          </label>
                          <button
                            type="button"
                            onClick={() => handleRemoveInputField(idx)}
                            className="col-span-1 text-neutral-500 hover:text-red-400 text-center"
                          >
                            <Trash2 className="w-3.5 h-3.5 mx-auto" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* OUTPUT SCHEMA BUILDER */}
                  <div className="pt-3 border-t border-neutral-800/80">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-[11px] font-semibold text-neutral-300 uppercase tracking-wider">Output Schema Parameters</label>
                      <button
                        type="button"
                        onClick={handleAddOutputField}
                        className="text-[11px] text-violet-400 hover:text-violet-300 font-medium flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" /> Add Output Field
                      </button>
                    </div>

                    <div className="space-y-2">
                      {formOutputSchema.map((field, idx) => (
                        <div key={idx} className="p-3 rounded-xl bg-[#0c0c14] border border-neutral-800 grid grid-cols-12 gap-2 items-center">
                          <input
                            type="text"
                            value={field.name}
                            onChange={(e) => {
                              const updated = [...formOutputSchema];
                              updated[idx].name = e.target.value;
                              setFormOutputSchema(updated);
                            }}
                            placeholder="outputName"
                            className="col-span-5 px-2 py-1 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-white"
                          />
                          <select
                            value={field.type}
                            onChange={(e) => {
                              const updated = [...formOutputSchema];
                              updated[idx].type = e.target.value as any;
                              setFormOutputSchema(updated);
                            }}
                            className="col-span-6 px-2 py-1 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-neutral-300"
                          >
                            <option value="string">string</option>
                            <option value="number">number</option>
                            <option value="boolean">boolean</option>
                            <option value="object">object</option>
                            <option value="array">array</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => handleRemoveOutputField(idx)}
                            className="col-span-1 text-neutral-500 hover:text-red-400 text-center"
                          >
                            <Trash2 className="w-3.5 h-3.5 mx-auto" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: TOOLS & PERMISSIONS */}
              {activeStudioTab === "tools" && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-neutral-300 mb-2 uppercase tracking-wider">
                      Authorized Registered Capabilities
                    </label>
                    <div className="grid grid-cols-1 gap-2">
                      {toolCatalog.map((tool) => {
                        const isChecked = formTools.includes(tool.id);
                        return (
                          <label
                            key={tool.id}
                            className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition ${
                              isChecked
                                ? "bg-violet-950/20 border-violet-500/40"
                                : "bg-[#0c0c14] border-neutral-800 hover:border-neutral-700"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setFormTools([...formTools, tool.id]);
                                } else {
                                  setFormTools(formTools.filter((t) => t !== tool.id));
                                }
                              }}
                              className="mt-0.5 rounded border-neutral-700 text-violet-600 focus:ring-0"
                            />
                            <div className="flex-1">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-white">{tool.name}</span>
                                <span className="text-[10px] font-mono text-neutral-500">{tool.id}</span>
                              </div>
                              <p className="text-[11px] text-neutral-400 mt-0.5">{tool.description}</p>
                              <div className="flex items-center gap-2 mt-2 text-[10px] text-neutral-500">
                                <span className="px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-800 capitalize font-mono">
                                  {tool.category}
                                </span>
                                <span>Timeout: {tool.timeout}s</span>
                                <span className="capitalize">{tool.sideEffect.replace("_", " ")}</span>
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* PERMISSIONS & LIMITS */}
                  <div className="pt-4 border-t border-neutral-800/80 space-y-3">
                    <label className="block text-[11px] font-semibold text-neutral-300 uppercase tracking-wider">
                      Required Permissions & Guardrails
                    </label>

                    <div className="grid grid-cols-2 gap-3">
                      <label className="p-3 rounded-xl bg-[#0c0c14] border border-neutral-800 flex items-center justify-between cursor-pointer">
                        <span className="text-xs text-neutral-200">Network Access</span>
                        <input
                          type="checkbox"
                          checked={formPermissions.network}
                          onChange={(e) => setFormPermissions({ ...formPermissions, network: e.target.checked })}
                          className="rounded border-neutral-700 text-violet-600"
                        />
                      </label>
                      <label className="p-3 rounded-xl bg-[#0c0c14] border border-neutral-800 flex items-center justify-between cursor-pointer">
                        <span className="text-xs text-neutral-200">Browser Automation</span>
                        <input
                          type="checkbox"
                          checked={formPermissions.browser}
                          onChange={(e) => setFormPermissions({ ...formPermissions, browser: e.target.checked })}
                          className="rounded border-neutral-700 text-violet-600"
                        />
                      </label>
                      <label className="p-3 rounded-xl bg-[#0c0c14] border border-neutral-800 flex items-center justify-between cursor-pointer">
                        <span className="text-xs text-neutral-200">Sandbox Code Execution</span>
                        <input
                          type="checkbox"
                          checked={formPermissions.sandbox}
                          onChange={(e) => setFormPermissions({ ...formPermissions, sandbox: e.target.checked })}
                          className="rounded border-neutral-700 text-violet-600"
                        />
                      </label>
                      <label className="p-3 rounded-xl bg-[#0c0c14] border border-neutral-800 flex items-center justify-between cursor-pointer">
                        <span className="text-xs text-neutral-200">Human Approval Gate</span>
                        <input
                          type="checkbox"
                          checked={formPermissions.approvalRequired}
                          onChange={(e) => setFormPermissions({ ...formPermissions, approvalRequired: e.target.checked })}
                          className="rounded border-neutral-700 text-violet-600"
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-2">
                      <div>
                        <label className="block text-[11px] font-medium text-neutral-400 mb-1">Timeout (seconds)</label>
                        <input
                          type="number"
                          value={formTimeout}
                          onChange={(e) => setFormTimeout(Number(e.target.value))}
                          min={1}
                          max={300}
                          className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-xs text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-neutral-400 mb-1">Max Retries</label>
                        <input
                          type="number"
                          value={formRetries}
                          onChange={(e) => setFormRetries(Number(e.target.value))}
                          min={0}
                          max={5}
                          className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-xs text-white"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: TEST SUITE */}
              {activeStudioTab === "tests" && (
                <div className="space-y-4">
                  <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800 text-xs text-neutral-300">
                    Run automated test payloads against registered tools in this skill to verify inputs, schemas, and live execution.
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-neutral-300 mb-1.5 uppercase tracking-wider">
                      Test Case Input Payload (JSON)
                    </label>
                    <textarea
                      rows={6}
                      value={testInputJson}
                      onChange={(e) => setTestInputJson(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-[#0c0c14] border border-neutral-800 text-xs font-mono text-cyan-300 focus:outline-none focus:border-violet-500"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleRunStudioTest}
                    disabled={isRunningTest || isCreatingNew}
                    className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-lg shadow-violet-600/20 transition disabled:opacity-50"
                  >
                    {isRunningTest ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    <span>Run Verification Test</span>
                  </button>

                  {testResult && (
                    <div className="p-4 rounded-xl bg-[#0c0c14] border border-neutral-800 space-y-2 animate-in fade-in">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-white">Test Result</span>
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${testResult.test?.status === "passed" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                          {testResult.test?.status?.toUpperCase()}
                        </span>
                      </div>
                      <div className="text-[11px] text-neutral-400 font-mono">
                        Latency: {testResult.test?.durationMs || 0}ms
                      </div>
                      <pre className="p-2.5 rounded-lg bg-black/40 border border-neutral-800 text-[10px] font-mono text-neutral-300 overflow-x-auto max-h-48">
                        {JSON.stringify(testResult.test?.result || testResult.execution?.outputs || testResult.error, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: VERSION HISTORY */}
              {activeStudioTab === "versions" && (
                <div className="space-y-3">
                  <div className="text-xs text-neutral-400">
                    Immutable snapshots created upon definition modifications. Rollback to any prior compatible release.
                  </div>
                  {(editingSkill?.versions || []).map((ver) => (
                    <div key={ver.id} className="p-3.5 rounded-xl bg-[#0c0c14] border border-neutral-800 flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-white">Version {ver.version}</span>
                          {ver.version === editingSkill?.currentVersion && (
                            <span className="text-[10px] px-2 py-0.2 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30">Current</span>
                          )}
                        </div>
                        <p className="text-[11px] text-neutral-400 mt-0.5">{ver.changeLog || "Definition release"}</p>
                        <span className="text-[10px] text-neutral-500 font-mono">{new Date(ver.createdAt).toLocaleString()}</span>
                      </div>
                      {ver.version !== editingSkill?.currentVersion && (
                        <button
                          type="button"
                          onClick={() => handleRollbackVersion(ver.version)}
                          className="px-2.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-xs text-neutral-300 flex items-center gap-1 transition"
                        >
                          <RotateCcw className="w-3 h-3" /> Rollback
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* TAB 5: EXECUTION LOGS */}
              {activeStudioTab === "executions" && (
                <div className="space-y-3">
                  {(editingSkill?.executions || []).length === 0 ? (
                    <div className="py-12 text-center text-xs text-neutral-500">No execution runs recorded yet.</div>
                  ) : (
                    (editingSkill?.executions || []).map((exec) => (
                      <div key={exec.id} className="p-3.5 rounded-xl bg-[#0c0c14] border border-neutral-800 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-mono text-neutral-300">{exec.id.slice(0, 8)}...</span>
                          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${exec.status === "completed" ? "bg-emerald-500/10 text-emerald-400" : exec.status === "failed" ? "bg-red-500/10 text-red-400" : "bg-amber-500/10 text-amber-400"}`}>
                            {exec.status}
                          </span>
                        </div>
                        <div className="text-[11px] text-neutral-400 flex items-center justify-between font-mono">
                          <span>Duration: {exec.durationMs}ms</span>
                          <span>{new Date(exec.startedAt).toLocaleTimeString()}</span>
                        </div>
                        {exec.error && <p className="text-[11px] text-red-400">{exec.error}</p>}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* STUDIO FOOTER ACTIONS */}
            <div className="p-4 border-t border-neutral-800 bg-[#0c0c14] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {!isCreatingNew && (
                  <button
                    type="button"
                    onClick={handleValidateSkill}
                    disabled={isValidating}
                    className="px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs font-medium text-neutral-300 hover:text-white transition flex items-center gap-1.5"
                  >
                    {isValidating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />}
                    <span>Validate</span>
                  </button>
                )}

                {!isCreatingNew && editingSkill?.lifecycleState !== "active" && (
                  <button
                    type="button"
                    onClick={handleActivateSkill}
                    disabled={isActivating}
                    className="px-3 py-2 rounded-xl bg-emerald-600/10 hover:bg-emerald-600 text-emerald-400 hover:text-white border border-emerald-500/20 text-xs font-semibold transition flex items-center gap-1.5"
                  >
                    {isActivating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    <span>Activate Skill</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCloseStudio}
                  className="px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-xs text-neutral-400 hover:text-white transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveSkill}
                  disabled={isSaving}
                  className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/20 transition flex items-center gap-1.5"
                >
                  {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>{isCreatingNew ? "Create Draft" : "Save Changes"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. EXECUTION RUNNER MODAL */}
      {executingSkill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-lg bg-[#0e0e16] border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between bg-[#12121c]">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-violet-600/20 text-violet-400">
                  <Play className="w-4 h-4 fill-current" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-white tracking-wide">Execute Skill: {executingSkill.name}</h3>
                  <span className="text-[10px] text-neutral-400 font-mono">v{executingSkill.currentVersion} • Active</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setExecutingSkill(null)}
                className="p-1 rounded-lg text-neutral-400 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              <p className="text-xs text-neutral-400">{executingSkill.description}</p>

              {/* INPUT FIELDS DYNAMICALLY RENDERED */}
              <div className="space-y-3">
                <label className="text-[11px] font-semibold text-neutral-300 uppercase tracking-wider block">Input Parameters</label>
                {(executingSkill.inputSchema || []).map((field) => (
                  <div key={field.name}>
                    <label className="block text-[11px] font-medium text-neutral-300 mb-1">
                      {field.label || field.name} {field.required && <span className="text-violet-400">*</span>}
                    </label>
                    {field.type === "boolean" ? (
                      <input
                        type="checkbox"
                        checked={Boolean(executionInputs[field.name])}
                        onChange={(e) => setExecutionInputs({ ...executionInputs, [field.name]: e.target.checked })}
                        className="rounded border-neutral-700 text-violet-600"
                      />
                    ) : field.type === "object" ? (
                      <textarea
                        rows={3}
                        value={typeof executionInputs[field.name] === "object" ? JSON.stringify(executionInputs[field.name], null, 2) : executionInputs[field.name]}
                        onChange={(e) => {
                          try {
                            const parsed = JSON.parse(e.target.value);
                            setExecutionInputs({ ...executionInputs, [field.name]: parsed });
                          } catch {
                            setExecutionInputs({ ...executionInputs, [field.name]: e.target.value });
                          }
                        }}
                        className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-xs font-mono text-white"
                      />
                    ) : (
                      <input
                        type={field.type === "number" ? "number" : "text"}
                        value={executionInputs[field.name] ?? ""}
                        onChange={(e) => setExecutionInputs({ ...executionInputs, [field.name]: field.type === "number" ? Number(e.target.value) : e.target.value })}
                        className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-xs text-white"
                      />
                    )}
                    {field.description && <p className="text-[10px] text-neutral-500 mt-0.5">{field.description}</p>}
                  </div>
                ))}
              </div>

              {/* OUTPUTS PREVIEW */}
              {executionResult && (
                <div className="p-3.5 rounded-xl bg-black/40 border border-neutral-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">Execution Result</span>
                    <span className="text-[10px] font-mono text-emerald-400">{executionResult.status}</span>
                  </div>
                  <pre className="p-2.5 rounded-lg bg-neutral-950 text-[10px] font-mono text-neutral-300 overflow-x-auto max-h-48">
                    {JSON.stringify(executionResult.outputs, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-neutral-800 bg-[#12121c] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setExecutingSkill(null)}
                className="px-3 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-xs text-neutral-400 hover:text-white transition"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleExecuteSkill}
                disabled={isRunningExecution}
                className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/20 transition flex items-center gap-1.5 disabled:opacity-50"
              >
                {isRunningExecution ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                <span>{isRunningExecution ? "Executing Pipeline..." : "Run Execution"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
