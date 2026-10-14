import React, { useState } from "react";
import {
  Sparkles,
  ArrowRight,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ShieldAlert,
  XCircle,
  Plus,
  Compass,
  Play,
  Terminal,
} from "lucide-react";
import type { AgentTask } from "../../../lib/nexus/agent.api";

interface AgentHomeProps {
  tasks: AgentTask[];
  onLaunchTask: (goal: string, mode: "quick" | "balanced" | "advanced") => void;
  onSelectTask: (task: AgentTask) => void;
  isLoading?: boolean;
}

const PROMPT_SUGGESTIONS = [
  {
    label: "YouTube Search",
    query: "Open YouTube and search for Java Spring Boot tutorials.",
    badge: "Popular",
  },
  {
    label: "Compare AI Frameworks",
    query: "Research the top 5 AI browser frameworks, compare them, and create a report.",
    badge: "Deep Research",
  },
  {
    label: "Hacker News Scraper",
    query: "Navigate to https://news.ycombinator.com, extract the top 10 frontpage headlines, and summarize findings.",
    badge: "Extraction",
  },
  {
    label: "Form Automation",
    query: "Navigate to user registration portal, populate form fields with verified data, and submit.",
    badge: "Human-in-the-Loop",
  },
];

export const AgentHome: React.FC<AgentHomeProps> = ({
  tasks,
  onLaunchTask,
  onSelectTask,
  isLoading,
}) => {
  const [goalInput, setGoalInput] = useState("");
  const [executionMode, setExecutionMode] = useState<"quick" | "balanced" | "advanced">("balanced");
  const [taskFilter, setTaskFilter] = useState<"all" | "running" | "completed" | "approvals" | "failed">("all");

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!goalInput.trim()) return;
    onLaunchTask(goalInput.trim(), executionMode);
  };

  const filteredTasks = tasks.filter((t) => {
    const status = (t.status || "").toLowerCase();
    if (taskFilter === "running") return status === "running";
    if (taskFilter === "completed") return status === "completed";
    if (taskFilter === "approvals") return status === "waiting_approval" || status === "awaiting_approval";
    if (taskFilter === "failed") return status === "failed" || status === "cancelled";
    return true;
  });

  const getStatusPill = (task: AgentTask) => {
    const status = (task.status || "pending").toLowerCase();
    const run = task.runs?.[0];

    if (status === "running") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          Running · Step {task.runs?.[0]?.currentStep ? task.runs[0].currentStep + 1 : 1}/{task.runs?.[0]?.steps?.length || 5}
        </span>
      );
    }
    if (status === "completed") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          Completed
        </span>
      );
    }
    if (status === "waiting_approval" || status === "awaiting_approval") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">
          <ShieldAlert className="w-3 h-3 text-amber-400" />
          Waiting Approval
        </span>
      );
    }
    if (status === "paused") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-neutral-500/15 text-neutral-300 border border-neutral-500/30">
          <span className="w-1.5 h-1.5 rounded-full bg-neutral-400" />
          Paused
        </span>
      );
    }
    if (status === "failed") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-red-500/15 text-red-300 border border-red-500/30">
          <XCircle className="w-3 h-3 text-red-400" />
          Failed
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-neutral-800 text-neutral-400 border border-white/5">
        <Clock className="w-3 h-3" />
        {status}
      </span>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-[#050507] text-neutral-100 p-6 md:p-8 selection:bg-violet-500/30 selection:text-violet-200">
      <div className="max-w-4xl mx-auto w-full flex flex-col gap-8 pb-12">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-6">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                <span>NEXUS Agent</span>
              </h1>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Browser Ready
              </span>
            </div>
            <p className="text-xs text-neutral-400">
              Turn objectives into actions. Real browser execution, observation, and verification.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setGoalInput("");
              const el = document.getElementById("nexus-agent-composer");
              el?.focus();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-xs font-medium text-neutral-200 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Task</span>
          </button>
        </div>

        {/* Main Composer Card */}
        <div className="relative rounded-2xl bg-[#090912] border border-white/[0.08] shadow-2xl overflow-hidden p-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="nexus-agent-composer" className="text-sm font-semibold text-white">
              What should NEXUS accomplish?
            </label>
            <p className="text-xs text-neutral-400">
              Give NEXUS a real objective. It will plan the work, use available tools, execute browser actions, verify results and return the outcome.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="relative rounded-xl bg-neutral-950/80 border border-white/10 focus-within:border-violet-500/50 focus-within:ring-1 focus-within:ring-violet-500/30 transition-all p-3">
              <textarea
                id="nexus-agent-composer"
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                placeholder="e.g. Open YouTube and search for Java Spring Boot tutorials..."
                rows={3}
                className="w-full bg-transparent text-sm text-neutral-100 placeholder:text-neutral-500 outline-none resize-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
              />

              <div className="flex items-center justify-between pt-2 border-t border-white/[0.06] mt-2">
                {/* Mode Selector */}
                <div className="flex items-center gap-1.5">
                  <select
                    value={executionMode}
                    onChange={(e) => setExecutionMode(e.target.value as any)}
                    className="bg-neutral-900 border border-white/10 text-neutral-300 text-xs rounded-lg px-2 py-1 outline-none font-medium hover:border-white/20 transition-colors cursor-pointer"
                  >
                    <option value="quick">Quick (Rapid actions)</option>
                    <option value="balanced">Balanced (Verified)</option>
                    <option value="advanced">Advanced (Deep plan)</option>
                  </select>
                </div>

                {/* Launch Button */}
                <button
                  type="submit"
                  disabled={!goalInput.trim() || isLoading}
                  className="flex items-center gap-2 px-4 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:pointer-events-none text-white text-xs font-semibold shadow-lg shadow-violet-600/25 transition-all"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Planning...</span>
                    </>
                  ) : (
                    <>
                      <span>Launch Agent</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>

          {/* Quick Suggestions */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[11px] text-neutral-500 font-mono">Suggestions:</span>
            {PROMPT_SUGGESTIONS.map((item, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setGoalInput(item.query)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-xs text-neutral-300 transition-colors"
              >
                <span>{item.label}</span>
                <span className="text-[9px] px-1 py-0.2 rounded bg-violet-500/20 text-violet-300 font-mono">
                  {item.badge}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Recent Tasks Section */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-bold tracking-wider uppercase font-mono text-neutral-400">
                Recent Tasks
              </h2>
              <span className="text-[11px] text-neutral-600 font-mono">({tasks.length})</span>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-neutral-900/60 border border-white/5 text-[11px]">
              {(["all", "running", "completed", "approvals", "failed"] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setTaskFilter(filter)}
                  className={`px-2.5 py-0.5 rounded-md capitalize transition-colors ${
                    taskFilter === filter
                      ? "bg-violet-600/30 text-violet-200 border border-violet-500/30 font-semibold"
                      : "text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>

          {/* Task Rows List */}
          {filteredTasks.length === 0 ? (
            <div className="p-8 rounded-2xl bg-[#090912] border border-white/[0.06] text-center flex flex-col items-center justify-center gap-2">
              <Compass className="w-6 h-6 text-neutral-600" />
              <p className="text-xs text-neutral-400">No agent tasks found in this category.</p>
              <p className="text-[11px] text-neutral-600">Enter an objective above to dispatch an autonomous agent run.</p>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-white/[0.04] rounded-2xl bg-[#090912] border border-white/[0.08] overflow-hidden">
              {filteredTasks.map((task) => (
                <div
                  key={task.id}
                  onClick={() => onSelectTask(task)}
                  className="group flex items-center justify-between p-4 hover:bg-white/[0.03] transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-white/[0.04] border border-white/5 flex items-center justify-center text-neutral-400 group-hover:text-violet-300 group-hover:border-violet-500/30 transition-all shrink-0">
                      <Terminal className="w-4 h-4" />
                    </div>

                    <div className="flex flex-col min-w-0">
                      <h3 className="text-sm font-semibold text-neutral-100 group-hover:text-white truncate">
                        {task.title || task.goal}
                      </h3>
                      <p className="text-xs text-neutral-500 truncate max-w-lg">
                        {task.goal}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    {getStatusPill(task)}

                    <span className="text-[11px] text-neutral-500 font-mono hidden sm:inline">
                      {new Date(task.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>

                    <button
                      type="button"
                      className="p-1.5 rounded-lg text-neutral-500 group-hover:text-white group-hover:bg-white/[0.06] transition-colors"
                      title="Open Workspace"
                    >
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
