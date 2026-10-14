import React, { useState, useEffect } from "react";
import {
  Activity,
  Clock,
  Globe,
  Bot,
  Shield,
  CheckCircle2,
  Globe2,
  Filter,
  RefreshCw,
  Search,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { nexusClient } from "../../lib/nexus/nexus-client";
import { nexusWs } from "../../lib/nexus/nexus-ws";

interface NexusActivityViewProps {
  onOpenInBrowser?: (url: string, title?: string) => void;
}

type FilterCategory = "all" | "browser" | "agent" | "approval" | "system";

export const NexusActivityView: React.FC<NexusActivityViewProps> = ({ onOpenInBrowser }) => {
  const [activities, setActivities] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<FilterCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadActivity = async () => {
    try {
      const res = await nexusClient.getActivity(100);
      setActivities(res.activities || []);
    } catch (e) {
      console.error("Failed to load activities:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadActivity();

    const unsubAction = nexusWs.subscribe("browser.action", () => loadActivity());
    const unsubStep = nexusWs.subscribe("agent.step.completed", () => loadActivity());
    const unsubTask = nexusWs.subscribe("agent.task.completed", () => loadActivity());
    const unsubApprReq = nexusWs.subscribe("approval.required", () => loadActivity());
    const unsubApprRes = nexusWs.subscribe("approval.resolved", () => loadActivity());

    return () => {
      unsubAction();
      unsubStep();
      unsubTask();
      unsubApprReq();
      unsubApprRes();
    };
  }, []);

  const getEventDotStyle = (type: string) => {
    if (type.startsWith("BROWSER")) {
      return { dot: "bg-emerald-400 ring-emerald-400/20", icon: Globe, color: "text-emerald-400" };
    }
    if (type.startsWith("APPROVAL")) {
      return { dot: "bg-amber-400 ring-amber-400/20", icon: Shield, color: "text-amber-400" };
    }
    if (type.startsWith("TASK") || type.startsWith("AGENT")) {
      return { dot: "bg-violet-400 ring-violet-400/20", icon: Bot, color: "text-violet-400" };
    }
    return { dot: "bg-cyan-400 ring-cyan-400/20", icon: Activity, color: "text-cyan-400" };
  };

  const filteredActivities = activities.filter((act) => {
    if (activeFilter === "browser" && !act.type.startsWith("BROWSER")) return false;
    if (activeFilter === "agent" && !act.type.startsWith("TASK") && !act.type.startsWith("AGENT")) return false;
    if (activeFilter === "approval" && !act.type.startsWith("APPROVAL")) return false;
    if (activeFilter === "system" && (act.type.startsWith("BROWSER") || act.type.startsWith("APPROVAL") || act.type.startsWith("TASK") || act.type.startsWith("AGENT"))) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchType = act.type.toLowerCase().includes(q);
      const matchMsg = (act.message || "").toLowerCase().includes(q);
      const matchUrl = (act.metadata?.url || "").toLowerCase().includes(q);
      return matchType || matchMsg || matchUrl;
    }
    return true;
  });

  return (
    <div className="flex-1 flex flex-col bg-[#050507] text-neutral-100 overflow-hidden select-none">
      {/* Chrome Subheader */}
      <div className="flex items-center justify-between px-8 py-4 border-b border-neutral-800/80 bg-[#0a0a0f]/60 shrink-0">
        <div className="flex items-center gap-3">
          <Activity className="w-4 h-4 text-violet-400" />
          <div>
            <h1 className="text-sm font-semibold text-white tracking-wide">Activity Timeline</h1>
            <p className="text-[11px] text-neutral-500">Chronological stream of browser, agent, and system events</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-400 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>LIVE</span>
          </div>

          <button
            type="button"
            onClick={() => {
              setIsLoading(true);
              loadActivity();
            }}
            className="p-1.5 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-neutral-400 hover:text-white transition"
            title="Refresh activity feed"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center justify-between px-8 py-3 border-b border-neutral-800/50 bg-[#07070a]/50 shrink-0 gap-4">
        <div className="flex items-center gap-1.5">
          {(
            [
              { id: "all", label: "All Events" },
              { id: "browser", label: "Browser" },
              { id: "agent", label: "Agents" },
              { id: "approval", label: "Approvals" },
              { id: "system", label: "System" },
            ] as const
          ).map((tab) => (
            <button
              type="button"
              key={tab.id}
              onClick={() => setActiveFilter(tab.id)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                activeFilter === tab.id
                  ? "bg-violet-600/20 text-violet-300 border border-violet-500/30"
                  : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900/50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-64">
          <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search timeline..."
            className="w-full bg-neutral-950 border border-neutral-800/80 rounded-xl pl-8 pr-3 py-1 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-violet-500"
          />
        </div>
      </div>

      {/* Clean Timeline Stream */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-3xl mx-auto relative">
          {/* Vertical Track Line */}
          <div className="absolute left-[70px] top-3 bottom-3 w-px bg-neutral-800/80" />

          {isLoading ? (
            <div className="space-y-6 animate-pulse py-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-6">
                  <div className="w-14 h-4 bg-neutral-900 rounded" />
                  <div className="w-3 h-3 bg-neutral-800 rounded-full" />
                  <div className="flex-1 h-5 bg-neutral-900/60 rounded" />
                </div>
              ))}
            </div>
          ) : filteredActivities.length === 0 ? (
            <div className="py-20 text-center text-xs text-neutral-500">
              No activity recorded in this timeline view.
            </div>
          ) : (
            <div className="space-y-4">
              {filteredActivities.map((act) => {
                const date = new Date(act.createdAt);
                const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                const { dot, icon: Icon, color } = getEventDotStyle(act.type);
                const isExpanded = expandedId === act.id;
                const hasDetails = act.metadata && Object.keys(act.metadata).length > 0;

                return (
                  <div
                    key={act.id}
                    className="flex items-start gap-4 group hover:bg-neutral-900/20 p-2 rounded-xl transition"
                  >
                    {/* Timestamp */}
                    <div className="w-14 text-right shrink-0 pt-0.5">
                      <span className="text-xs font-mono text-neutral-500 group-hover:text-neutral-400">
                        {timeStr}
                      </span>
                    </div>

                    {/* Timeline Node */}
                    <div className="relative shrink-0 flex items-center justify-center w-5 h-5 pt-0.5">
                      <div className={`w-2 h-2 rounded-full ${dot} ring-4 transition group-hover:scale-125`} />
                    </div>

                    {/* Event Content */}
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <Icon className={`w-3.5 h-3.5 ${color} shrink-0`} />
                          <span className="text-xs font-medium text-neutral-200 truncate">
                            {act.message || act.type}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {onOpenInBrowser && (act.metadata?.url || act.type.includes("BROWSER")) && (
                            <button
                              type="button"
                              onClick={() => onOpenInBrowser(act.metadata?.url || "nexus://start", `Reopened: ${act.type}`)}
                              className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[10px] text-violet-400 hover:text-violet-300 font-mono transition"
                            >
                              <ExternalLink className="w-3 h-3" />
                              <span>Reopen</span>
                            </button>
                          )}

                          {hasDetails && (
                            <button
                              type="button"
                              onClick={() => setExpandedId(isExpanded ? null : act.id)}
                              className="text-neutral-600 hover:text-neutral-400 transition"
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Expandable Details */}
                      {isExpanded && hasDetails && (
                        <div className="mt-2 p-2.5 rounded-lg bg-neutral-950/80 border border-neutral-800/80 font-mono text-[10px] text-neutral-400 overflow-x-auto animate-in fade-in duration-150">
                          {typeof act.metadata === "string"
                            ? act.metadata
                            : JSON.stringify(act.metadata, null, 2)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
