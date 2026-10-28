import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  LayoutDashboard,
  Layers,
  Bot,
  CheckCircle2,
  Microscope,
  Workflow,
  Brain,
  ArrowUpRight,
  Clock,
  Sparkles,
  RefreshCw,
  Plus,
  TrendingUp,
  Zap,
  Activity,
  Globe,
  Shield,
  ChevronRight,
  Radio,
  Code2,
  Camera,
  ShieldAlert,
} from "lucide-react";
import { nexusClient } from "../../lib/nexus/nexus-client";
import { nexusWs } from "../../lib/nexus/nexus-ws";
import type { NexusTab } from "./NexusHeader";

interface DashboardProps {
  onNavigate: (tab: NexusTab) => void;
  workspaceId?: string | null;
}

// Animated count-up hook
function useCountUp(target: number, duration = 800) {
  const [val, setVal] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const start = prev.current;
    const diff = target - start;
    if (diff === 0) return;
    const startTime = performance.now();
    const frame = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setVal(Math.round(start + diff * eased));
      if (progress < 1) requestAnimationFrame(frame);
      else prev.current = target;
    };
    requestAnimationFrame(frame);
  }, [target, duration]);
  return val;
}

// Individual animated stat card
const StatCard: React.FC<{
  title: string;
  value: number;
  icon: React.ElementType;
  gradient: string;
  glowColor: string;
  tab: NexusTab;
  onNavigate: (tab: NexusTab) => void;
  isLoading: boolean;
  delay?: number;
}> = ({ title, value, icon: Icon, gradient, glowColor, tab, onNavigate, isLoading, delay = 0 }) => {
  const count = useCountUp(isLoading ? 0 : value, 900);
  return (
    <div
      onClick={() => onNavigate(tab)}
      className="relative overflow-hidden rounded-2xl border cursor-pointer group nx-hover-lift nx-fade-in"
      style={{
        background: `linear-gradient(135deg, ${gradient})`,
        borderColor: `${glowColor}33`,
        boxShadow: `0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px ${glowColor}15`,
        animationDelay: `${delay}ms`,
      }}
    >
      {/* Ambient glow */}
      <div
        className="absolute -top-6 -right-6 w-24 h-24 rounded-full blur-2xl opacity-20 transition-opacity group-hover:opacity-35"
        style={{ background: glowColor }}
      />
      {/* Content */}
      <div className="relative p-5">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-semibold text-white/50 tracking-wide uppercase">{title}</span>
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: `${glowColor}25`, border: `1px solid ${glowColor}40` }}>
            <Icon className="w-4 h-4" style={{ color: glowColor }} />
          </div>
        </div>
        <div className="flex items-end justify-between">
          <span className="text-4xl font-black text-white tracking-tight leading-none">
            {isLoading ? (
              <span className="inline-block w-12 h-9 nx-skeleton rounded-lg" />
            ) : (
              <span className="nx-stat-value">{count}</span>
            )}
          </span>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-x-2 group-hover:translate-x-0">
            <span className="text-[11px] font-semibold text-white/70">View</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-white/70" />
          </div>
        </div>
      </div>
      {/* Bottom accent line */}
      <div
        className="absolute bottom-0 left-0 right-0 h-[2px] opacity-60"
        style={{ background: `linear-gradient(90deg, transparent, ${glowColor}, transparent)` }}
      />
    </div>
  );
};

const getActivityStyle = (type: string) => {
  if (type?.includes("BROWSER") || type?.includes("browser")) return { color: "#10b981", bg: "rgba(16,185,129,0.12)", icon: Globe, label: "Browser" };
  if (type?.includes("APPROVAL") || type?.includes("approval")) return { color: "#f59e0b", bg: "rgba(245,158,11,0.12)", icon: Shield, label: "Approval" };
  if (type?.includes("TASK") || type?.includes("agent") || type?.includes("AGENT")) return { color: "#8b5cf6", bg: "rgba(139,92,246,0.12)", icon: Bot, label: "Agent" };
  if (type?.includes("research")) return { color: "#06b6d4", bg: "rgba(6,182,212,0.12)", icon: Microscope, label: "Research" };
  return { color: "#6366f1", bg: "rgba(99,102,241,0.12)", icon: Activity, label: "System" };
};

export const NexusDashboard: React.FC<DashboardProps> = ({ onNavigate, workspaceId }) => {
  const [stats, setStats] = useState({
    workspacesCount: 0,
    activeTasksCount: 0,
    completedTasksCount: 0,
    researchCount: 0,
    workflowsCount: 0,
    memoriesCount: 0,
  });
  const [recentActivities, setRecentActivities] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [liveEvents, setLiveEvents] = useState<string[]>([]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [workspacesRes, tasksRes, researchRes, workflowsRes, memoryRes, activityRes] = await Promise.all([
        nexusClient.getWorkspaces().catch(() => ({ workspaces: [] })),
        nexusClient.getTasks(workspaceId || undefined).catch(() => ({ tasks: [] })),
        nexusClient.getResearchProjects(workspaceId || undefined).catch(() => ({ projects: [] })),
        nexusClient.getWorkflows(workspaceId || undefined).catch(() => ({ workflows: [] })),
        nexusClient.getMemories({ workspaceId: workspaceId || undefined }).catch(() => ({ memories: [] })),
        nexusClient.getActivity(20).catch(() => ({ activities: [] })),
      ]);

      const tasks = tasksRes.tasks || [];
      setStats({
        workspacesCount: workspacesRes.workspaces?.length || 0,
        activeTasksCount: tasks.filter((t: any) => t.status === "running" || t.status === "pending").length,
        completedTasksCount: tasks.filter((t: any) => t.status === "completed").length,
        researchCount: researchRes.projects?.length || 0,
        workflowsCount: workflowsRes.workflows?.length || 0,
        memoriesCount: memoryRes.memories?.length || 0,
      });
      setRecentActivities(activityRes.activities || []);
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    loadData();
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedReload = () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => loadData(), 2000);
    };

    const unsubActivity = nexusWs.subscribe("agent.step.completed", (data: any) => {
      setLiveEvents(p => [`⚡ Step completed: ${data.stepId || "processing"}`, ...p].slice(0, 5));
      debouncedReload();
    });
    const unsubTask = nexusWs.subscribe("agent.task.completed", (data: any) => {
      setLiveEvents(p => [`✅ Task finished: ${data.taskId || "done"}`, ...p].slice(0, 5));
      debouncedReload();
    });
    const unsubBrowser = nexusWs.subscribe("browser.action", () => debouncedReload());
    const unsubTaskCreated = nexusWs.subscribe("agent.task.created", (data: any) => {
      setLiveEvents(p => [`🤖 New task started`, ...p].slice(0, 5));
      debouncedReload();
    });

    return () => { unsubActivity(); unsubTask(); unsubBrowser(); unsubTaskCreated(); if (reloadTimer) clearTimeout(reloadTimer); };
  }, [loadData]);

  const statCards = [
    { title: "Workspaces", value: stats.workspacesCount, icon: Layers, gradient: "rgba(14,16,40,0.8), rgba(30,40,80,0.6)", glowColor: "#60a5fa", tab: "browser" as NexusTab },
    { title: "Active Tasks", value: stats.activeTasksCount, icon: Bot, gradient: "rgba(40,20,10,0.8), rgba(80,40,10,0.6)", glowColor: "#fbbf24", tab: "agent" as NexusTab },
    { title: "Tasks Done", value: stats.completedTasksCount, icon: CheckCircle2, gradient: "rgba(6,30,20,0.8), rgba(10,50,35,0.6)", glowColor: "#34d399", tab: "agent" as NexusTab },
    { title: "Research", value: stats.researchCount, icon: Microscope, gradient: "rgba(30,10,50,0.8), rgba(60,20,80,0.6)", glowColor: "#a78bfa", tab: "research" as NexusTab },
    { title: "Workflows", value: stats.workflowsCount, icon: Workflow, gradient: "rgba(5,30,40,0.8), rgba(10,50,60,0.6)", glowColor: "#22d3ee", tab: "workflows" as NexusTab },
    { title: "Memories", value: stats.memoriesCount, icon: Brain, gradient: "rgba(40,10,15,0.8), rgba(70,15,25,0.6)", glowColor: "#fb7185", tab: "memory" as NexusTab },
  ];

  const quickActions = [
    { label: "Run Agent Goal", desc: "Autonomous multi-step browser planner", tab: "agent" as NexusTab, icon: Bot, color: "#fbbf24" },
    { label: "Visual Builder", desc: "Drag-and-drop automation graph studio", tab: "workflows" as NexusTab, icon: Workflow, color: "#22d3ee" },
    { label: "Coding Workspace", desc: "Monaco IDE, Python 3.13 & Node sandbox", tab: "coding" as NexusTab, icon: Code2, color: "#10b981" },
    { label: "Picture Studio", desc: "Web captures, vision telemetry & frames", tab: "picture-studio" as NexusTab, icon: Camera, color: "#f43f5e" },
    { label: "Deep Research", desc: "Multi-source crawler with cited report", tab: "research" as NexusTab, icon: Microscope, color: "#a78bfa" },
    { label: "Approvals Gate", desc: "Human-in-the-loop security & audit", tab: "approvals" as NexusTab, icon: ShieldAlert, color: "#eab308" },
    { label: "Memory Vault", desc: "Persistent knowledge & context storage", tab: "memory" as NexusTab, icon: Brain, color: "#fb7185" },
    { label: "Activity Timeline", desc: "Real-time durable audit logs", tab: "activity" as NexusTab, icon: Activity, color: "#818cf8" },
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-[#02020a] text-neutral-100 relative">
      {/* Ambient background orbs */}
      <div className="nx-orb nx-orb-violet w-96 h-96 top-[-80px] right-[10%]" />
      <div className="nx-orb nx-orb-cyan w-64 h-64 bottom-[20%] left-[5%]" style={{ animationDelay: "3s" }} />

      <div className="relative p-8 max-w-[1400px] mx-auto">
        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-10 nx-fade-in">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-violet-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-violet-600/30">
                <LayoutDashboard className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-black tracking-tight text-white">
                  Mission Control
                </h1>
                <p className="text-xs text-neutral-500 mt-0.5">Realtime telemetry · Active agent operations · Knowledge graph</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Live pulse indicator */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <div className="nx-status-online w-2 h-2" />
              <span className="text-[11px] text-emerald-400 font-semibold">LIVE</span>
            </div>
            <button
              onClick={loadData}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl nx-btn-ghost text-xs font-medium"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button
              onClick={() => onNavigate("agent")}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold nx-btn-primary"
            >
              <Plus className="w-4 h-4" />
              Launch Agent
            </button>
          </div>
        </div>

        {/* ── Live Events Ticker ── */}
        {liveEvents.length > 0 && (
          <div className="mb-6 nx-fade-in">
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-violet-500/8 border border-violet-500/15">
              <Radio className="w-3.5 h-3.5 text-violet-400 shrink-0" style={{ animation: "nx-glow-pulse 1.5s ease-in-out infinite" }} />
              <span className="text-xs text-violet-300 font-semibold">Live:</span>
              <span className="text-xs text-neutral-300 truncate">{liveEvents[0]}</span>
            </div>
          </div>
        )}

        {/* ── Stat Cards Grid ── */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8 nx-stagger">
          {statCards.map((card, idx) => (
            <StatCard
              key={idx}
              {...card}
              onNavigate={onNavigate}
              isLoading={isLoading}
              delay={idx * 60}
            />
          ))}
        </div>

        {/* ── Two Column: Quick Actions + Activity ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
          {/* Quick Actions Panel */}
          <div className="nx-glass rounded-2xl p-6 nx-fade-in" style={{ animationDelay: "300ms" }}>
            <div className="flex items-center gap-2 mb-5">
              <Zap className="w-4 h-4 text-amber-400" />
              <h2 className="text-sm font-bold text-white">Quick Actions</h2>
            </div>
            <div className="space-y-3">
              {quickActions.map((action, i) => (
                <button
                  key={i}
                  onClick={() => onNavigate(action.tab)}
                  className="w-full flex items-center justify-between p-3.5 rounded-xl transition-all duration-200 group text-left"
                  style={{
                    background: `${action.color}08`,
                    border: `1px solid ${action.color}18`,
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.background = `${action.color}15`;
                    (e.currentTarget as HTMLElement).style.borderColor = `${action.color}35`;
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = `${action.color}08`;
                    (e.currentTarget as HTMLElement).style.borderColor = `${action.color}18`;
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${action.color}18` }}>
                      <action.icon className="w-4 h-4" style={{ color: action.color }} />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-neutral-200">{action.label}</div>
                      <div className="text-[10.5px] text-neutral-500 mt-0.5 leading-tight">{action.desc}</div>
                    </div>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-neutral-600 group-hover:text-neutral-400 group-hover:translate-x-0.5 transition-all" />
                </button>
              ))}
            </div>
          </div>

          {/* Live Activity Feed */}
          <div className="nx-glass rounded-2xl p-6 nx-fade-in" style={{ animationDelay: "360ms" }}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-bold text-white">Activity Stream</h2>
                <span className="nx-badge nx-badge-emerald">PostgreSQL</span>
              </div>
              <button
                onClick={() => onNavigate("activity")}
                className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                Full Log <ChevronRight className="w-3 h-3" />
              </button>
            </div>

            <div className="space-y-2">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-10 nx-skeleton rounded-xl" style={{ animationDelay: `${i * 100}ms` }} />
                ))
              ) : recentActivities.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-neutral-900 border border-neutral-800 flex items-center justify-center mb-4">
                    <Activity className="w-6 h-6 text-neutral-600" />
                  </div>
                  <p className="text-sm text-neutral-500 font-medium">No activity yet</p>
                  <p className="text-xs text-neutral-600 mt-1">Run an agent task or browse to stream events</p>
                </div>
              ) : (
                recentActivities.slice(0, 8).map((act, idx) => {
                  const style = getActivityStyle(act.type);
                  const EventIcon = style.icon;
                  return (
                    <div
                      key={act.id}
                      className="flex items-center gap-3 p-3 rounded-xl transition-all duration-150 nx-fade-in"
                      style={{
                        background: style.bg,
                        border: `1px solid ${style.color}20`,
                        animationDelay: `${idx * 50}ms`,
                      }}
                    >
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${style.color}20` }}>
                        <EventIcon className="w-3.5 h-3.5" style={{ color: style.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: style.color }}>{style.label}</span>
                          <span className="text-[10px] text-neutral-600">·</span>
                          <span className="text-[10px] text-neutral-500 font-mono">{new Date(act.createdAt).toLocaleTimeString()}</span>
                        </div>
                        <p className="text-xs text-neutral-300 truncate mt-0.5 leading-tight">{act.message}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* ── System Health Row ── */}
        <div className="mt-6 grid grid-cols-3 gap-4 nx-fade-in" style={{ animationDelay: "420ms" }}>
          {[
            { label: "AI Backend", status: "Operational", color: "#34d399", icon: Sparkles },
            { label: "WebSocket", status: "Connected", color: "#60a5fa", icon: Radio },
            { label: "PostgreSQL", status: "Active", color: "#a78bfa", icon: TrendingUp },
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-3 p-4 rounded-xl nx-glass">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: `${item.color}15`, border: `1px solid ${item.color}25` }}>
                <item.icon className="w-4 h-4" style={{ color: item.color }} />
              </div>
              <div>
                <div className="text-xs font-semibold text-neutral-300">{item.label}</div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: item.color }} />
                  <span className="text-[10px]" style={{ color: item.color }}>{item.status}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
