import React, { useState, useRef, useEffect } from "react";
import { nexusClient } from "../../lib/nexus/nexus-client";
import {
  Globe,
  LayoutDashboard,
  Bot,
  Microscope,
  Workflow,
  Brain,
  Sparkles,
  ShieldAlert,
  Activity,
  Settings,
  Radio,
  User,
  LogOut,
  Layers,
  ChevronDown,
  Command,
  Plus,
  Edit2,
  Trash2,
} from "lucide-react";
import { NexusWorkspaceModal } from "./NexusWorkspaceModal";

export type NexusTab =
  | "browser"
  | "dashboard"
  | "agent"
  | "research"
  | "workflows"
  | "memory"
  | "skills"
  | "approvals"
  | "activity"
  | "settings"
  | "bookmarks"
  | "history"
  | "downloads"
  | "extensions";

interface NexusHeaderProps {
  activeTab: NexusTab;
  onSelectTab: (tab: NexusTab) => void;
  user: { name: string; email: string } | null;
  isConnected: boolean;
  pendingApprovalsCount: number;
  onLogout: () => void;
  onToggleAiPanel?: () => void;
  onOpenCommandPalette?: () => void;
  activeWorkspaceId?: string | null;
  onWorkspaceChange?: (workspaceId: string) => void;
}

export const NexusHeader: React.FC<NexusHeaderProps> = ({
  activeTab,
  onSelectTab,
  user,
  isConnected,
  pendingApprovalsCount,
  onLogout,
  onToggleAiPanel,
  onOpenCommandPalette,
  activeWorkspaceId,
  onWorkspaceChange,
}) => {
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string; description?: string }>>([]);
  const [activeSpace, setActiveSpace] = useState("Loading...");
  const [showSpaceMenu, setShowSpaceMenu] = useState(false);
  const spaceMenuRef = useRef<HTMLDivElement>(null);
  const [workspaceModal, setWorkspaceModal] = useState<{
    isOpen: boolean;
    mode: "create" | "edit";
    workspaceToEdit?: { id: string; name: string; description?: string } | null;
  }>({ isOpen: false, mode: "create", workspaceToEdit: null });

  const handleDeleteWorkspace = async (wsId: string, wsName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (workspaces.length <= 1) return;
    try {
      await nexusClient.deleteWorkspace(wsId);
      const remaining = workspaces.filter((w) => w.id !== wsId);
      setWorkspaces(remaining);
      if (activeWorkspaceId === wsId || activeSpace === wsName) {
        const next = remaining[0];
        if (next) {
          setActiveSpace(next.name);
          onWorkspaceChange?.(next.id);
        }
      }
    } catch (err: any) {
      console.error("Failed to delete workspace:", err);
    }
  };

  const handleWorkspaceSuccess = (ws: any) => {
    setWorkspaces((prev) => {
      const idx = prev.findIndex((w) => w.id === ws.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = ws;
        return updated;
      }
      return [...prev, ws];
    });
    setActiveSpace(ws.name);
    onWorkspaceChange?.(ws.id);
  };

  // Load real workspaces from API
  useEffect(() => {
    nexusClient
      .getWorkspaces()
      .then((res) => {
        const ws = res.workspaces || [];
        setWorkspaces(ws);
        if (ws.length > 0) {
          const active = activeWorkspaceId ? ws.find((w: any) => w.id === activeWorkspaceId) : ws[0];
          setActiveSpace(active?.name || ws[0]?.name || "Default Workspace");
        }
      })
      .catch(() => {
        setWorkspaces([]);
        setActiveSpace("Default Space");
      });
  }, [activeWorkspaceId]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (spaceMenuRef.current && !spaceMenuRef.current.contains(e.target as Node)) {
        setShowSpaceMenu(false);
      }
    };
    if (showSpaceMenu) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [showSpaceMenu]);

  const tabs = [
    { id: "browser", label: "Browser", icon: Globe, shortcut: "1" },
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, shortcut: "2" },
    { id: "agent", label: "AI Agent", icon: Bot, shortcut: "3" },
    { id: "research", label: "Research", icon: Microscope, shortcut: "4" },
    { id: "workflows", label: "Workflows", icon: Workflow, shortcut: "5" },
    { id: "memory", label: "Memory", icon: Brain, shortcut: "6" },
    { id: "skills", label: "Skills", icon: Sparkles, shortcut: "7" },
    {
      id: "approvals",
      label: "Approvals",
      icon: ShieldAlert,
      shortcut: "8",
      badge: pendingApprovalsCount > 0 ? pendingApprovalsCount : undefined,
    },
    { id: "activity", label: "Activity", icon: Activity, shortcut: "9" },
    { id: "settings", label: "Settings", icon: Settings, shortcut: "0" },
  ];

  return (
    <header className="flex items-center justify-between px-3.5 py-1.5 bg-[#060611]/95 backdrop-blur-xl border-b border-white/[0.08] text-neutral-200 select-none z-40 shrink-0 shadow-lg shadow-black/40">
      {/* Left: Brand + Space Switcher */}
      <div className="flex items-center gap-3">
        <div
          onClick={() => onSelectTab("browser")}
          className="flex items-center gap-2.5 cursor-pointer group"
        >
          <div className="relative w-7 h-7 rounded-lg bg-gradient-to-tr from-cyan-500 via-indigo-600 to-fuchsia-500 flex items-center justify-center font-black text-white text-xs shadow-[0_0_15px_rgba(99,102,241,0.5)] group-hover:shadow-[0_0_22px_rgba(99,102,241,0.8)] group-hover:scale-105 transition-all duration-300">
            <span className="relative z-10 tracking-tight">NX</span>
            <div className="absolute inset-0 rounded-lg bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold tracking-wider bg-gradient-to-r from-white via-indigo-200 to-cyan-300 bg-clip-text text-transparent text-xs font-mono">
                NEXUS
              </span>
              <span className="text-[9px] font-semibold px-1.5 py-0.2 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                v3.0
              </span>
            </div>
          </div>
        </div>

        {/* Space Switcher */}
        <div className="relative" ref={spaceMenuRef}>
          <button
            onClick={() => setShowSpaceMenu(!showSpaceMenu)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:border-indigo-500/40 hover:bg-white/[0.07] text-xs font-semibold text-neutral-300 hover:text-white transition-all shadow-inner"
          >
            <Layers className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
            <span className="truncate max-w-[120px]">{activeSpace}</span>
            <ChevronDown className={`w-3 h-3 text-neutral-400 transition-transform duration-200 ${showSpaceMenu ? "rotate-180" : ""}`} />
          </button>

          {showSpaceMenu && (
            <div className="absolute top-full left-0 mt-1.5 w-56 bg-[#0c0c20]/95 backdrop-blur-2xl border border-indigo-500/20 rounded-xl shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between px-2.5 py-1 text-[10px] uppercase font-bold text-neutral-400 tracking-wider">
                <span>NEXUS Spaces</span>
                <span className="text-indigo-400 text-[10px]">{workspaces.length} active</span>
              </div>
              <div className="space-y-0.5 my-1 max-h-48 overflow-y-auto">
                {workspaces.map((ws) => (
                  <div
                    key={ws.id}
                    className={`group/ws w-full px-2.5 py-1.5 rounded-lg text-xs transition-all flex items-center justify-between ${
                      activeWorkspaceId === ws.id || activeSpace === ws.name
                        ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-medium shadow-md shadow-indigo-600/30"
                        : "text-neutral-300 hover:bg-white/[0.06] hover:text-white"
                    }`}
                  >
                    <button
                      onClick={() => {
                        setActiveSpace(ws.name);
                        setShowSpaceMenu(false);
                        onWorkspaceChange?.(ws.id);
                      }}
                      className="flex-1 text-left truncate flex items-center gap-1.5 min-w-0"
                    >
                      <span className="truncate">{ws.name}</span>
                      {(activeWorkspaceId === ws.id || activeSpace === ws.name) && (
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-300 shadow-[0_0_6px_#06b6d4] shrink-0" />
                      )}
                    </button>
                    <div className="opacity-0 group-hover/ws:opacity-100 flex items-center gap-1 shrink-0 ml-1 transition-opacity">
                      <button
                        title="Edit Space"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowSpaceMenu(false);
                          setWorkspaceModal({ isOpen: true, mode: "edit", workspaceToEdit: ws });
                        }}
                        className="p-0.5 rounded hover:text-white text-white/50"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      {workspaces.length > 1 && (
                        <button
                          title="Delete Space"
                          onClick={(e) => handleDeleteWorkspace(ws.id, ws.name, e)}
                          className="p-0.5 rounded hover:text-rose-400 text-white/50"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {workspaces.length === 0 && (
                  <div className="px-2.5 py-2 text-[11px] text-neutral-500">No workspaces found</div>
                )}
              </div>
              <div className="border-t border-white/[0.08] pt-1">
                <button
                  onClick={() => {
                    setShowSpaceMenu(false);
                    setWorkspaceModal({ isOpen: true, mode: "create", workspaceToEdit: null });
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-indigo-400 hover:bg-indigo-600/15 hover:text-indigo-300 font-medium flex items-center gap-1.5 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create Workspace</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Center: Primary Navigation */}
      <nav className="flex items-center gap-0.5 bg-black/40 p-1 rounded-xl border border-white/[0.08] shadow-inner backdrop-blur-md">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onSelectTab(tab.id as NexusTab)}
              title={`Switch to ${tab.label} (Ctrl+${tab.shortcut})`}
              className={`relative flex items-center gap-1.5 px-2.5 py-1.2 rounded-lg text-xs font-medium transition-all duration-200 ${
                isActive
                  ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-600/30 font-semibold"
                  : "text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.05]"
              }`}
            >
              <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? "text-cyan-300" : ""}`} />
              <span>{tab.label}</span>
              {tab.badge !== undefined && (
                <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-black text-[9px] font-black shadow-[0_0_8px_rgba(245,158,11,0.5)]">
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Right: Command Palette, AI Panel, Status, Profile */}
      <div className="flex items-center gap-2">
        {/* Command Palette Trigger */}
        <button
          onClick={onOpenCommandPalette}
          title="Command Palette (Ctrl+K)"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:border-indigo-500/40 hover:bg-white/[0.08] text-neutral-400 hover:text-neutral-200 text-xs transition-all shadow-inner"
        >
          <Command className="w-3.5 h-3.5 text-neutral-400" />
          <span className="text-[10px] font-mono text-neutral-400 font-semibold">Ctrl+K</span>
        </button>

        {/* AI Panel Toggle */}
        <button
          onClick={onToggleAiPanel}
          title="Toggle NEXUS Intelligence (Ctrl+J)"
          className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-gradient-to-r from-indigo-600/30 to-violet-600/30 hover:from-indigo-600 hover:to-violet-600 border border-indigo-500/40 hover:border-indigo-400 text-indigo-200 hover:text-white text-xs font-semibold transition-all shadow-[0_0_12px_rgba(99,102,241,0.2)] hover:shadow-[0_0_20px_rgba(99,102,241,0.5)]"
        >
          <Sparkles className="w-3.5 h-3.5 text-cyan-300" />
          <span>AI Panel</span>
        </button>

        {/* Realtime WS Indicator */}
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium border transition-all ${
            isConnected
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 shadow-[0_0_8px_rgba(16,185,129,0.2)]"
              : "bg-rose-500/10 text-rose-400 border-rose-500/30 animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.3)]"
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-emerald-400 shadow-[0_0_6px_#10b981]" : "bg-rose-400"}`} />
          <Radio className="w-2.5 h-2.5" />
          <span>{isConnected ? "Live" : "Offline"}</span>
        </div>

        {/* User Pill */}
        {user ? (
          <div className="flex items-center gap-1.5 pl-2 border-l border-white/[0.08]">
            <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white font-bold text-xs border border-white/20 shadow-[0_0_8px_rgba(99,102,241,0.4)]">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <button
              onClick={onLogout}
              title="Log out"
              className="p-1 rounded-lg hover:bg-white/[0.08] text-neutral-400 hover:text-rose-400 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-xs text-neutral-400">
            <User className="w-3.5 h-3.5" />
            <span>Guest</span>
          </div>
        )}
      </div>

      {/* Workspace Modal */}
      <NexusWorkspaceModal
        isOpen={workspaceModal.isOpen}
        mode={workspaceModal.mode}
        workspaceToEdit={workspaceModal.workspaceToEdit}
        onClose={() => setWorkspaceModal((prev) => ({ ...prev, isOpen: false }))}
        onSuccess={handleWorkspaceSuccess}
      />
    </header>
  );
};
