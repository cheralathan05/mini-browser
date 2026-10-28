import React, { useState, useEffect, useRef } from "react";
import {
  Search,
  Globe,
  Bot,
  Microscope,
  Workflow,
  Brain,
  Sparkles,
  ShieldCheck,
  Activity,
  Settings,
  Plus,
  ArrowRight,
  Command,
  Code2,
  Camera,
  Bookmark,
  History,
  Download,
  Puzzle,
} from "lucide-react";
import type { NexusTab } from "./NexusHeader";

interface NexusCommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: NexusTab) => void;
  onOpenUrl: (url: string) => void;
  onToggleAiPanel: () => void;
}

export const NexusCommandPalette: React.FC<NexusCommandPaletteProps> = ({
  isOpen,
  onClose,
  onNavigate,
  onOpenUrl,
  onToggleAiPanel,
}) => {
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = [
    { id: "browser", label: "Open Browser & Tabs", category: "Navigation", icon: Globe, action: () => onNavigate("browser") },
    { id: "dashboard", label: "Open Mission Control Dashboard", category: "Navigation", icon: Command, action: () => onNavigate("dashboard") },
    { id: "workflows", label: "Open Visual Workflow Builder & Automation", category: "Navigation", icon: Workflow, action: () => onNavigate("workflows") },
    { id: "coding", label: "Open AI Coding Agent (Monaco IDE & Sandboxes)", category: "Navigation", icon: Code2, action: () => onNavigate("coding") },
    { id: "picture-studio", label: "Open Picture Studio (Screenshots & Vision)", category: "Navigation", icon: Camera, action: () => onNavigate("picture-studio") },
    { id: "agent", label: "Open Autonomous AI Missions Hub", category: "Navigation", icon: Bot, action: () => onNavigate("agent") },
    { id: "research", label: "Open Deep Research Engine", category: "Navigation", icon: Microscope, action: () => onNavigate("research") },
    { id: "memory", label: "Open Persistent Memory Vault", category: "Navigation", icon: Brain, action: () => onNavigate("memory") },
    { id: "skills", label: "Open Skills Catalog & Runner", category: "Navigation", icon: Sparkles, action: () => onNavigate("skills") },
    { id: "approvals", label: "Open Approvals Center & Security Policies", category: "Navigation", icon: ShieldCheck, action: () => onNavigate("approvals") },
    { id: "activity", label: "Open Activity Timeline & Audit Logs", category: "Navigation", icon: Activity, action: () => onNavigate("activity") },
    { id: "bookmarks", label: "Open Bookmarks Manager", category: "Navigation", icon: Bookmark, action: () => onNavigate("bookmarks") },
    { id: "history", label: "Open Browsing History", category: "Navigation", icon: History, action: () => onNavigate("history") },
    { id: "downloads", label: "Open Downloads Manager & AI File Inspector", category: "Navigation", icon: Download, action: () => onNavigate("downloads") },
    { id: "extensions", label: "Open Extensions & Widgets", category: "Navigation", icon: Puzzle, action: () => onNavigate("extensions") },
    { id: "settings", label: "Open Settings & AI Configuration", category: "Navigation", icon: Settings, action: () => onNavigate("settings") },
    { id: "ai_panel", label: "Toggle NEXUS Intelligence Sidebar", category: "Actions", icon: Sparkles, action: onToggleAiPanel },
    { id: "new_research", label: "Start Multi-Source Deep Research", category: "Actions", icon: Microscope, action: () => onNavigate("research") },
    { id: "new_workflow", label: "Build New Node Automation Workflow", category: "Actions", icon: Workflow, action: () => onNavigate("workflows") },
  ];

  const filtered = items.filter(
    (item) =>
      item.label.toLowerCase().includes(search.toLowerCase()) ||
      item.category.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    if (isOpen) {
      setSearch("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, filtered.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filtered.length) % Math.max(1, filtered.length));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          filtered[selectedIndex].action();
          onClose();
        } else if (search.trim()) {
          onOpenUrl(`https://www.google.com/search?q=${encodeURIComponent(search)}`);
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, filtered, selectedIndex, search]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center pt-24 px-4">
      <div className="w-full max-w-xl bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150 text-neutral-100">
        {/* Search Input */}
        <div className="flex items-center px-4 py-3.5 border-b border-neutral-800 gap-3">
          <Search className="w-4 h-4 text-indigo-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Type a command, page, or search query..."
            className="flex-1 bg-transparent border-none outline-none text-sm text-white placeholder-neutral-500 font-medium"
          />
          <kbd className="px-2 py-0.5 rounded bg-neutral-800 text-neutral-400 text-[10px] font-mono border border-neutral-700">
            ESC
          </kbd>
        </div>

        {/* List of actions */}
        <div className="max-h-80 overflow-y-auto p-2 space-y-1">
          {filtered.length > 0 ? (
            filtered.map((item, idx) => {
              const Icon = item.icon;
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    item.action();
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left text-xs transition-colors ${
                    isSelected ? "bg-indigo-600 text-white font-medium" : "text-neutral-300 hover:bg-neutral-800/60"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className={`w-4 h-4 ${isSelected ? "text-white" : "text-neutral-400"}`} />
                    <span>{item.label}</span>
                  </div>
                  <span className={`text-[10px] ${isSelected ? "text-indigo-200" : "text-neutral-500"}`}>
                    {item.category}
                  </span>
                </button>
              );
            })
          ) : (
            <div
              onClick={() => {
                onOpenUrl(`https://www.google.com/search?q=${encodeURIComponent(search)}`);
                onClose();
              }}
              className="px-4 py-3 text-xs text-neutral-400 cursor-pointer hover:bg-neutral-800 rounded-xl flex items-center justify-between"
            >
              <span>Search the web for "{search}"</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </div>
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="px-4 py-2 border-t border-neutral-800/80 bg-neutral-950/60 flex items-center justify-between text-[11px] text-neutral-500">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>ESC Close</span>
          </div>
          <span>NEXUS Command Palette</span>
        </div>
      </div>
    </div>
  );
};
