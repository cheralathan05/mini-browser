import React, { useState, useEffect } from "react";
import { Sparkles, Brain, Bot, Microscope, HelpCircle, X } from "lucide-react";
import { nexusClient } from "@/lib/nexus/nexus-client";

interface NexusActionBarProps {
  onAction: (action: string, selectedText: string) => void;
}

export const NexusActionBar: React.FC<NexusActionBarProps> = ({ onAction }) => {
  const [selectedText, setSelectedText] = useState("");
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const handleMouseUp = () => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();

      if (text && text.length > 2) {
        const range = selection?.getRangeAt(0);
        const rect = range?.getBoundingClientRect();

        if (rect) {
          setSelectedText(text);
          setPosition({
            top: Math.max(10, rect.top - 46),
            left: Math.max(10, Math.min(window.innerWidth - 300, rect.left + rect.width / 2 - 140)),
          });
        }
      } else {
        setPosition(null);
        setSelectedText("");
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("#nexus-action-bar")) {
        setPosition(null);
        setSelectedText("");
      }
    };

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("mousedown", handleMouseDown);

    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, []);

  if (!position || !selectedText) return null;

  return (
    <div
      id="nexus-action-bar"
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
      className="fixed z-50 flex items-center gap-1 p-1 bg-neutral-900 border border-neutral-700/80 rounded-xl shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100 text-neutral-200"
    >
      <button
        onClick={() => {
          onAction("ask", selectedText);
          setPosition(null);
        }}
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold hover:bg-indigo-600 hover:text-white transition-colors"
        title="Ask NEXUS AI about selection"
      >
        <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
        <span>Ask</span>
      </button>

      <button
        onClick={() => {
          onAction("explain", selectedText);
          setPosition(null);
        }}
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold hover:bg-indigo-600 hover:text-white transition-colors"
        title="Explain selected text"
      >
        <HelpCircle className="w-3.5 h-3.5 text-cyan-400" />
        <span>Explain</span>
      </button>

      <button
        onClick={() => {
          onAction("research", selectedText);
          setPosition(null);
        }}
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold hover:bg-indigo-600 hover:text-white transition-colors"
        title="Initiate research on selection"
      >
        <Microscope className="w-3.5 h-3.5 text-emerald-400" />
        <span>Research</span>
      </button>

      <button
        onClick={() => {
          onAction("save_memory", selectedText);
          setPosition(null);
        }}
        className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold hover:bg-violet-600 hover:text-white transition-colors"
        title="Save to NEXUS Memory"
      >
        <Brain className="w-3.5 h-3.5 text-amber-400" />
        <span>Save</span>
      </button>

      <button
        onClick={() => {
          onAction("create_task", selectedText);
          setPosition(null);
        }}
        className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold hover:bg-violet-600 hover:text-white transition-colors"
        title="Dispatch autonomous agent task from selection"
      >
        <Bot className="w-3.5 h-3.5 text-emerald-400" />
        <span>Task</span>
      </button>

      <button
        onClick={() => setPosition(null)}
        className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors ml-1"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
};
