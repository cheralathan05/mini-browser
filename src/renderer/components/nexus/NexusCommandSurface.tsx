import React, { useEffect, useState } from "react";
import {
  Globe,
  Sparkles,
  Microscope,
  Bot,
  Workflow,
  Brain,
  ArrowRight,
  Search,
  ExternalLink,
  Layers,
  Settings,
  ShieldAlert,
} from "lucide-react";

export interface CommandItem {
  id: string;
  title: string;
  subtitle?: string;
  category: "browser" | "ai" | "research" | "agent" | "workflow" | "memory" | "system";
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  action: () => void;
}

interface NexusCommandSurfaceProps {
  query: string;
  onSelectAction: (type: "navigate" | "search" | "ask" | "research" | "agent" | "workflow" | "memory" | "mode", payload: string) => void;
  onClose: () => void;
  activeUrl?: string;
  activeTitle?: string;
}

export const NexusCommandSurface: React.FC<NexusCommandSurfaceProps> = ({
  query,
  onSelectAction,
  onClose,
  activeUrl,
  activeTitle,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const cleanQuery = query.trim();
  const isUrl = /^https?:\/\//i.test(cleanQuery) || (/^[\w.-]+\.[a-z]{2,}/i.test(cleanQuery) && !cleanQuery.includes(" "));

  // Generate dynamic command list
  const commands: CommandItem[] = [];

  if (isUrl) {
    commands.push({
      id: "nav-direct",
      title: `Go to ${cleanQuery}`,
      subtitle: "Open URL in active tab",
      category: "browser",
      icon: ExternalLink,
      action: () => onSelectAction("navigate", cleanQuery),
    });
  }

  if (cleanQuery.length > 0) {
    commands.push({
      id: "search-web",
      title: `Search "${cleanQuery}"`,
      subtitle: "Search the web via default engine",
      category: "browser",
      icon: Search,
      badge: "Web",
      action: () => onSelectAction("search", cleanQuery),
    });
    commands.push({
      id: "ask-ai",
      title: `Ask NEXUS: "${cleanQuery}"`,
      subtitle: "Synthesize answer using local LLM & page context",
      category: "ai",
      icon: Sparkles,
      badge: "AI",
      action: () => onSelectAction("ask", cleanQuery),
    });
    commands.push({
      id: "deep-research",
      title: `Research "${cleanQuery}"`,
      subtitle: "Dispatch deep research across multiple sources",
      category: "research",
      icon: Microscope,
      badge: "Research",
      action: () => onSelectAction("research", cleanQuery),
    });
    commands.push({
      id: "agent-task",
      title: `Dispatch Agent: "${cleanQuery}"`,
      subtitle: "Execute multi-step autonomous browser automation",
      category: "agent",
      icon: Bot,
      badge: "Agent",
      action: () => onSelectAction("agent", cleanQuery),
    });
    commands.push({
      id: "create-workflow",
      title: `Create Workflow: "${cleanQuery}"`,
      subtitle: "Build reusable automation pipeline canvas",
      category: "workflow",
      icon: Workflow,
      badge: "Workflow",
      action: () => onSelectAction("workflow", cleanQuery),
    });
    commands.push({
      id: "search-memory",
      title: `Query Memory for "${cleanQuery}"`,
      subtitle: "Search saved knowledge, facts, and preferences",
      category: "memory",
      icon: Brain,
      badge: "Memory",
      action: () => onSelectAction("memory", cleanQuery),
    });
  } else {
    // Empty state: Core Intents & Quick Jump
    commands.push(
      {
        id: "default-search",
        title: "Search web",
        subtitle: "Enter search terms or URLs",
        category: "browser",
        icon: Search,
        action: () => {},
      },
      {
        id: "default-ask",
        title: "Ask NEXUS",
        subtitle: activeTitle ? `Ask about "${activeTitle}"` : "Ask AI any question",
        category: "ai",
        icon: Sparkles,
        badge: "Ctrl+J",
        action: () => onSelectAction("ask", ""),
      },
      {
        id: "default-research",
        title: "Deep Research",
        subtitle: "Launch autonomous multi-source synthesis",
        category: "research",
        icon: Microscope,
        badge: "Ctrl+4",
        action: () => onSelectAction("mode", "research"),
      },
      {
        id: "default-agent",
        title: "Autonomous Agent",
        subtitle: "Execute live browser tasks",
        category: "agent",
        icon: Bot,
        badge: "Ctrl+3",
        action: () => onSelectAction("mode", "agent"),
      },
      {
        id: "default-workflow",
        title: "Workflow Canvas",
        subtitle: "Visual node graph automation",
        category: "workflow",
        icon: Workflow,
        badge: "Ctrl+5",
        action: () => onSelectAction("mode", "workflows"),
      },
      {
        id: "default-memory",
        title: "Knowledge Memory",
        subtitle: "Explore connected facts, rules & notes",
        category: "memory",
        icon: Brain,
        badge: "Ctrl+6",
        action: () => onSelectAction("mode", "memory"),
      }
    );
  }

  // Keyboard navigation
  useEffect(() => {
    setSelectedIndex(0);
  }, [cleanQuery]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % commands.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + commands.length) % commands.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (commands[selectedIndex]) {
          commands[selectedIndex].action();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [commands, selectedIndex]);

  return (
    <div
      className="absolute top-full left-0 right-0 mt-2 z-50 overflow-hidden rounded-2xl bg-neutral-950/95 border border-white/10 shadow-[0_20px_60px_rgba(0,0,0,0.8)] backdrop-blur-2xl animate-in fade-in zoom-in-98 duration-150"
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between text-[11px] text-neutral-400 font-medium">
        <span className="flex items-center gap-1.5 text-violet-400">
          <Sparkles className="w-3.5 h-3.5" />
          <span>What do you want NEXUS to do?</span>
        </span>
        <div className="flex items-center gap-2 text-[10px] text-neutral-500 font-mono">
          <span>↑↓ to navigate</span>
          <span>↵ to execute</span>
          <span>esc to close</span>
        </div>
      </div>

      <div className="p-1.5 max-h-[340px] overflow-y-auto space-y-0.5 no-scrollbar">
        {commands.map((cmd, idx) => {
          const isSelected = idx === selectedIndex;
          const Icon = cmd.icon;
          return (
            <div
              key={cmd.id}
              onClick={() => cmd.action()}
              onMouseEnter={() => setSelectedIndex(idx)}
              className={`group flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer transition-all ${
                isSelected
                  ? "bg-violet-600/20 text-white border border-violet-500/30 shadow-sm"
                  : "text-neutral-300 hover:bg-neutral-900/60 border border-transparent"
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                    isSelected
                      ? "bg-violet-600 text-white shadow-md shadow-violet-600/30"
                      : "bg-neutral-900 text-neutral-400 group-hover:text-neutral-200"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-semibold truncate">{cmd.title}</span>
                  {cmd.subtitle && (
                    <span className="text-[11px] text-neutral-500 truncate">{cmd.subtitle}</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 ml-2">
                {cmd.badge && (
                  <span className="px-2 py-0.5 rounded-md bg-neutral-900 border border-white/5 text-[10px] font-mono text-neutral-400">
                    {cmd.badge}
                  </span>
                )}
                <ArrowRight
                  className={`w-3.5 h-3.5 transition-transform ${
                    isSelected ? "text-violet-400 translate-x-0.5 opacity-100" : "text-neutral-600 opacity-0 group-hover:opacity-60"
                  }`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
