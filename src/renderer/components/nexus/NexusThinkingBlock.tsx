import React, { useState, useEffect } from "react";
import { Brain, Sparkles, ChevronDown, ChevronRight, CheckCircle2, Loader2 } from "lucide-react";

export interface ThinkingPhase {
  id: string;
  label: string;
  status: "pending" | "active" | "completed";
}

interface NexusThinkingBlockProps {
  isThinking: boolean;
  thoughtText?: string;
  durationMs?: number;
  currentPhase?: string;
  phases?: ThinkingPhase[];
}

export const NexusThinkingBlock: React.FC<NexusThinkingBlockProps> = ({
  isThinking,
  thoughtText,
  durationMs = 0,
  currentPhase,
  phases = [
    { id: "context", label: "Analyzing query & active page context", status: "completed" },
    { id: "memory", label: "Scanning persistent workspace memory", status: "completed" },
    { id: "synthesis", label: "Formulating recommendations & code review", status: "active" },
  ],
}) => {
  const [isOpen, setIsOpen] = useState(isThinking);
  const [elapsed, setElapsed] = useState(0);

  // Default open while thinking, collapsed when done
  useEffect(() => {
    if (isThinking) {
      setIsOpen(true);
      const start = Date.now();
      const interval = setInterval(() => {
        setElapsed(Math.floor((Date.now() - start) / 100) / 10);
      }, 100);
      return () => clearInterval(interval);
    } else {
      if (durationMs > 0) {
        setElapsed(Math.floor(durationMs / 100) / 10);
      }
    }
  }, [isThinking, durationMs]);

  const displayTime = durationMs > 0 ? (durationMs / 1000).toFixed(1) : elapsed.toFixed(1);

  return (
    <div className="mb-3 rounded-xl border border-violet-500/20 bg-[#0c0c16]/90 backdrop-blur-md overflow-hidden text-xs transition-all duration-200 shadow-inner">
      {/* HEADER / TOGGLE BAR */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-white/[0.04] transition group select-none"
      >
        <div className="flex items-center gap-2">
          <div className="relative flex items-center justify-center w-5 h-5 rounded-lg bg-violet-600/20 border border-violet-500/30 text-violet-400">
            {isThinking ? (
              <Brain className="w-3 h-3 text-violet-300 animate-pulse" />
            ) : (
              <Sparkles className="w-3 h-3 text-cyan-300" />
            )}
            {isThinking && (
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-neutral-200">
              {isThinking ? "Reasoning & Thinking..." : `Thought for ${displayTime}s`}
            </span>
            {isThinking && currentPhase && (
              <span className="text-[11px] text-neutral-400 hidden sm:inline truncate max-w-[200px]">
                • {currentPhase}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-neutral-400 group-hover:text-neutral-200">
          <span className="text-[10px] font-mono text-neutral-500">
            {displayTime}s
          </span>
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 transition-transform" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 transition-transform" />
          )}
        </div>
      </button>

      {/* EXPANDED CONTENT ACCORDION */}
      {isOpen && (
        <div className="px-3 pb-3 pt-1 border-t border-white/5 space-y-2.5 animate-in fade-in slide-in-from-top-1 duration-150">
          {/* Phase Checklist */}
          <div className="space-y-1.5 pt-1">
            {phases.map((p, idx) => {
              const isCurrent = isThinking && (p.status === "active" || (idx === phases.length - 1 && !thoughtText));
              const isDone = !isThinking || p.status === "completed" || idx < phases.findIndex((x) => x.status === "active");

              return (
                <div key={p.id} className="flex items-center gap-2 text-[11px]">
                  {isCurrent ? (
                    <Loader2 className="w-3 h-3 text-violet-400 animate-spin shrink-0" />
                  ) : isDone ? (
                    <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  ) : (
                    <span className="w-3 h-3 rounded-full border border-neutral-700 shrink-0" />
                  )}
                  <span className={isCurrent ? "text-violet-200 font-medium" : isDone ? "text-neutral-300" : "text-neutral-500"}>
                    {p.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Model Thought Stream if extracted */}
          {thoughtText && (
            <div className="mt-2 p-2.5 rounded-lg bg-black/40 border border-white/5 font-mono text-[11px] leading-relaxed text-neutral-400 max-h-48 overflow-y-auto whitespace-pre-wrap select-text">
              {thoughtText}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
