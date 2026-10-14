import React, { useState, useEffect, useRef } from "react";
import { Bot, CheckCircle2, Circle, Clock, Loader2, Play, Sparkles, X, ChevronRight } from "lucide-react";
import { nexusClient } from "@/lib/nexus/nexus-client";
import { nexusWs } from "@/lib/nexus/nexus-ws";

export interface ActiveAgentState {
  id: string;
  title: string;
  status: "running" | "completed" | "failed" | "pending";
  currentStepIndex: number;
  totalSteps: number;
  currentAction: string;
  steps: Array<{
    id: string;
    title: string;
    status: "completed" | "running" | "pending" | "failed";
  }>;
}

interface NexusAgentIndicatorProps {
  onOpenAgentView?: () => void;
  isOpen?: boolean;
  onToggleTimeline?: (open: boolean) => void;
  onActiveAgentChange?: (agent: ActiveAgentState | null) => void;
}

export const NexusAgentIndicator: React.FC<NexusAgentIndicatorProps> = ({
  onOpenAgentView,
  isOpen,
  onToggleTimeline,
  onActiveAgentChange,
}) => {
  const [activeAgent, setActiveAgent] = useState<ActiveAgentState | null>(null);
  const [isTimelineOpen, setIsTimelineOpen] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const effectiveIsOpen = typeof isOpen === "boolean" ? isOpen : isTimelineOpen;

  useEffect(() => {
    onActiveAgentChange?.(activeAgent);
  }, [activeAgent, onActiveAgentChange]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        if (onToggleTimeline) {
          onToggleTimeline(false);
        } else {
          setIsTimelineOpen(false);
        }
      }
    };
    if (effectiveIsOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [effectiveIsOpen, onToggleTimeline]);

  // Poll & subscribe to live agent tasks
  useEffect(() => {
    const fetchLatestTasks = async () => {
      try {
        const res = await nexusClient.getAgentTasks().catch(() => ({ tasks: [] }));
        const running = res.tasks?.find((t: any) => t.status === "running" || t.status === "pending");
        if (running) {
          const steps = (running.steps || []).map((s: any, idx: number) => ({
            id: s.id || `step-${idx}`,
            title: s.name || s.action || `Step ${idx + 1}`,
            status: s.status || "completed",
          }));
          const completedCount = steps.filter((s: any) => s.status === "completed").length;
          setActiveAgent({
            id: running.id,
            title: running.title || "Autonomous Task",
            status: running.status,
            currentStepIndex: completedCount,
            totalSteps: Math.max(steps.length, 1),
            currentAction: running.currentAction || "Processing browser automation...",
            steps,
          });
        } else {
          setActiveAgent(null);
        }
      } catch {}
    };

    fetchLatestTasks();
    const interval = setInterval(fetchLatestTasks, 3500);

    const unsubCreated = nexusWs.subscribe("agent.task.created", fetchLatestTasks);
    const unsubStep = nexusWs.subscribe("agent.step.completed", fetchLatestTasks);
    const unsubFailed = nexusWs.subscribe("agent.step.failed", fetchLatestTasks);

    return () => {
      clearInterval(interval);
      unsubCreated();
      unsubStep();
      unsubFailed();
    };
  }, []);

  return (
    <div ref={containerRef} className="relative flex items-center">
      {/* Small Process Indicator */}
      <button
        type="button"
        onClick={() => {
          if (onToggleTimeline) {
            onToggleTimeline(!effectiveIsOpen);
          } else if (activeAgent) {
            setIsTimelineOpen((prev) => !prev);
          } else if (onOpenAgentView) {
            onOpenAgentView();
          }
        }}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
          activeAgent
            ? "bg-violet-600/15 border border-violet-500/30 text-violet-300 shadow-[0_0_12px_rgba(139,92,246,0.25)] hover:bg-violet-600/25"
            : "bg-neutral-900/60 border border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700"
        }`}
        title={activeAgent ? "NEXUS Agent Running — Click for Timeline" : "NEXUS Operating System Ready"}
      >
        {activeAgent ? (
          <>
            <div className="w-2 h-2 rounded-full bg-violet-400 animate-ping" />
            <Sparkles className="w-3 h-3 text-violet-400 animate-pulse" />
            <span className="truncate max-w-[140px] hidden sm:inline">{activeAgent.title}</span>
            <span className="text-[10px] font-mono text-violet-400">
              {activeAgent.currentStepIndex}/{activeAgent.totalSteps}
            </span>
          </>
        ) : (
          <>
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-[11px] font-medium tracking-tight">NEXUS Ready</span>
          </>
        )}
      </button>

      {/* Floating Agent Timeline Drawer (Fallback when not docked) */}
      {!onToggleTimeline && effectiveIsOpen && activeAgent && (
        <div className="absolute right-0 top-full mt-2 w-80 z-50 rounded-2xl bg-neutral-950/95 border border-white/10 shadow-2xl backdrop-blur-2xl p-4 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between pb-3 border-b border-white/5 mb-3">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-violet-400 animate-pulse" />
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-300">NEXUS Agent</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-mono text-violet-400 font-semibold">
                {activeAgent.currentStepIndex} / {activeAgent.totalSteps}
              </span>
              <button
                type="button"
                onClick={() => setIsTimelineOpen(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="mb-3">
            <h4 className="text-xs font-semibold text-neutral-100 truncate">{activeAgent.title}</h4>
            <p className="text-[11px] text-neutral-400 mt-0.5 truncate">{activeAgent.currentAction}</p>
          </div>

          {/* Steps list */}
          <div className="space-y-2 max-h-48 overflow-y-auto no-scrollbar py-1">
            {activeAgent.steps.map((step, idx) => {
              const isDone = step.status === "completed";
              const isRunning = step.status === "running" || (!isDone && idx === activeAgent.currentStepIndex);
              return (
                <div key={step.id} className="flex items-center gap-2.5 text-xs">
                  {isDone ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  ) : isRunning ? (
                    <div className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
                      <div className="w-2 h-2 rounded-full bg-violet-400 animate-ping" />
                    </div>
                  ) : (
                    <Circle className="w-3.5 h-3.5 text-neutral-600 shrink-0" />
                  )}
                  <span
                    className={`truncate ${
                      isDone
                        ? "text-neutral-400 line-through decoration-neutral-600"
                        : isRunning
                        ? "text-violet-300 font-semibold"
                        : "text-neutral-500"
                    }`}
                  >
                    {step.title}
                  </span>
                </div>
              );
            })}
          </div>

          {onOpenAgentView && (
            <div className="mt-3 pt-3 border-t border-white/5 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setIsTimelineOpen(false);
                  onOpenAgentView();
                }}
                className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 font-medium transition-colors"
              >
                <span>Full Agent Workspace</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
