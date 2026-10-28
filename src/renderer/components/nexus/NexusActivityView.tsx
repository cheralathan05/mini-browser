import React, { useState, useEffect, useMemo } from "react";
import {
  Activity,
  Globe,
  Bot,
  Shield,
  Clock,
  Search,
  Filter,
  RefreshCw,
  ChevronRight,
  ExternalLink,
  Copy,
  Terminal,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Calendar,
  Layers,
  ArrowDown,
  X,
  Radio,
} from "lucide-react";
import { ActivityApi, ActivityEvent, ActivityStats, ActivityCategory, ActivityOutcome } from "../../lib/nexus/activity.api";
import { nexusWs } from "../../lib/nexus/nexus-ws";
import { useToast } from "./NexusToast";

interface NexusActivityViewProps {
  workspaceId?: string;
  onOpenInBrowser?: (url: string, title?: string) => void;
}

type DateRangeOption = "all" | "today" | "24h" | "7d" | "30d";

export const NexusActivityView: React.FC<NexusActivityViewProps> = ({ workspaceId, onOpenInBrowser }) => {
  const toast = useToast();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [stats, setStats] = useState<ActivityStats>({
    total: 0,
    byCategory: { browser: 0, agents: 0, approvals: 0, system: 0 },
    byOutcome: { success: 0, failure: 0, warning: 0 },
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);

  // Filters
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [dateRange, setDateRange] = useState<DateRangeOption>("all");
  const [outcomeFilter, setOutcomeFilter] = useState<string>("all");
  const [actorFilter, setActorFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Selected event for detail drawer
  const [selectedEvent, setSelectedEvent] = useState<ActivityEvent | null>(null);

  const loadInitialData = async () => {
    try {
      setIsLoading(true);
      const [res, statsRes] = await Promise.all([
        ActivityApi.getEvents({
          category: activeCategory === "all" ? undefined : activeCategory,
          dateRange: dateRange === "all" ? undefined : dateRange,
          outcome: outcomeFilter === "all" ? undefined : outcomeFilter,
          actorType: actorFilter === "all" ? undefined : actorFilter,
          search: searchQuery,
          limit: 40,
          workspaceId,
        }),
        ActivityApi.getStats(workspaceId),
      ]);

      setEvents(res.events || []);
      setNextCursor(res.nextCursor);
      setStats(statsRes.stats || {
        total: 0,
        byCategory: { browser: 0, agents: 0, approvals: 0, system: 0 },
        byOutcome: { success: 0, failure: 0, warning: 0 },
      });
    } catch (err: any) {
      console.error("Failed to load activity events:", err);
      toast.error(err.message || "Failed to load activity stream");
    } finally {
      setIsLoading(false);
    }
  };

  const loadMoreEvents = async () => {
    if (!nextCursor || isLoadingMore) return;
    try {
      setIsLoadingMore(true);
      const res = await ActivityApi.getEvents({
        category: activeCategory === "all" ? undefined : activeCategory,
        dateRange: dateRange === "all" ? undefined : dateRange,
        outcome: outcomeFilter === "all" ? undefined : outcomeFilter,
        actorType: actorFilter === "all" ? undefined : actorFilter,
        search: searchQuery,
        limit: 40,
        cursor: nextCursor,
        workspaceId,
      });

      setEvents((prev) => [...prev, ...(res.events || [])]);
      setNextCursor(res.nextCursor);
    } catch (err: any) {
      toast.error("Failed to load older activity events");
    } finally {
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    loadInitialData();

    // Subscribe to live activity stream
    const unsubActivity = nexusWs.subscribe("activity.event", (payload: any) => {
      if (payload?.event) {
        setEvents((prev) => {
          // Avoid duplicate events
          if (prev.some((e) => e.id === payload.event.id)) return prev;
          return [payload.event, ...prev];
        });
        setStats((prev) => ({
          ...prev,
          total: prev.total + 1,
        }));
      }
    });

    return () => {
      unsubActivity();
    };
  }, [activeCategory, dateRange, outcomeFilter, actorFilter, workspaceId]);

  const getCategoryIcon = (category: string) => {
    switch (category?.toLowerCase()) {
      case "browser":
        return { icon: Globe, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" };
      case "agents":
        return { icon: Bot, color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20" };
      case "approvals":
        return { icon: Shield, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" };
      default:
        return { icon: Terminal, color: "text-cyan-400", bg: "bg-cyan-500/10 border-cyan-500/20" };
    }
  };

  const getOutcomeBadge = (outcome: string) => {
    switch (outcome?.toLowerCase()) {
      case "failure":
        return { dot: "bg-rose-400 ring-rose-400/20", icon: XCircle, text: "text-rose-400", label: "Failed" };
      case "warning":
        return { dot: "bg-amber-400 ring-amber-400/20", icon: AlertTriangle, text: "text-amber-400", label: "Warning" };
      case "pending":
        return { dot: "bg-cyan-400 ring-cyan-400/20", icon: Clock, text: "text-cyan-400", label: "Pending" };
      default:
        return { dot: "bg-emerald-400 ring-emerald-400/20", icon: CheckCircle2, text: "text-emerald-400", label: "Success" };
    }
  };

  // Group events by human-friendly date header
  const groupedEvents = useMemo(() => {
    const groups: { [key: string]: ActivityEvent[] } = {};
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();

    for (const evt of events) {
      const d = new Date(evt.createdAt).toDateString();
      let label = d;
      if (d === today) label = "Today";
      else if (d === yesterday) label = "Yesterday";

      if (!groups[label]) groups[label] = [];
      groups[label].push(evt);
    }
    return groups;
  }, [events]);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#050507] text-neutral-100 overflow-hidden select-none font-sans">
      {/* 1. HEADER BAR */}
      <div className="px-8 py-5 border-b border-neutral-800/80 bg-[#08080d]/80 shrink-0 backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/25 flex items-center justify-center text-violet-400 shrink-0 mt-0.5">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-base font-semibold text-white tracking-wide">Activity Timeline & Audit Log</h1>
                <span className="flex items-center gap-1.5 text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Live Telemetry
                </span>
              </div>
              <p className="text-xs text-neutral-400 mt-0.5 max-w-xl">
                Comprehensive audit trail tracking autonomous agent missions, browser tool executions, workflow pipelines, and human approval events.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <div className="text-xs font-mono font-semibold text-white">{stats.total} Total Events</div>
              <div className="text-[10px] text-neutral-500 font-mono">Durable PostgreSQL Store</div>
            </div>
            <button
              onClick={loadInitialData}
              className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-white hover:border-neutral-700 transition"
              title="Refresh Activity Log"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-violet-400" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      {/* 2. CATEGORY BREAKDOWN METRICS */}
      <div className="px-8 py-3.5 border-b border-neutral-800/50 bg-[#06060a] shrink-0">
        <div className="max-w-7xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div
            onClick={() => setActiveCategory("all")}
            className={`p-3 rounded-xl border transition cursor-pointer ${
              activeCategory === "all"
                ? "bg-violet-500/10 border-violet-500/40 shadow-sm shadow-violet-500/10"
                : "bg-neutral-900/40 border-neutral-800/60 hover:border-neutral-700"
            }`}
          >
            <div className="text-[11px] text-neutral-400 font-medium">All Events</div>
            <div className="text-lg font-bold text-white mt-0.5">{stats.total}</div>
          </div>

          <div
            onClick={() => setActiveCategory("browser")}
            className={`p-3 rounded-xl border transition cursor-pointer ${
              activeCategory === "browser"
                ? "bg-emerald-500/10 border-emerald-500/40 shadow-sm shadow-emerald-500/10"
                : "bg-neutral-900/40 border-neutral-800/60 hover:border-neutral-700"
            }`}
          >
            <div className="text-[11px] text-neutral-400 font-medium flex items-center gap-1.5">
              <Globe className="w-3 h-3 text-emerald-400" />
              <span>Browser Telemetry</span>
            </div>
            <div className="text-lg font-bold text-emerald-400 mt-0.5">{stats.byCategory.browser}</div>
          </div>

          <div
            onClick={() => setActiveCategory("agents")}
            className={`p-3 rounded-xl border transition cursor-pointer ${
              activeCategory === "agents"
                ? "bg-violet-500/10 border-violet-500/40 shadow-sm shadow-violet-500/10"
                : "bg-neutral-900/40 border-neutral-800/60 hover:border-neutral-700"
            }`}
          >
            <div className="text-[11px] text-neutral-400 font-medium flex items-center gap-1.5">
              <Bot className="w-3 h-3 text-violet-400" />
              <span>Autonomous Agents</span>
            </div>
            <div className="text-lg font-bold text-violet-400 mt-0.5">{stats.byCategory.agents}</div>
          </div>

          <div
            onClick={() => setActiveCategory("approvals")}
            className={`p-3 rounded-xl border transition cursor-pointer ${
              activeCategory === "approvals"
                ? "bg-amber-500/10 border-amber-500/40 shadow-sm shadow-amber-500/10"
                : "bg-neutral-900/40 border-neutral-800/60 hover:border-neutral-700"
            }`}
          >
            <div className="text-[11px] text-neutral-400 font-medium flex items-center gap-1.5">
              <Shield className="w-3 h-3 text-amber-400" />
              <span>Approvals Audit</span>
            </div>
            <div className="text-lg font-bold text-amber-400 mt-0.5">{stats.byCategory.approvals}</div>
          </div>
        </div>
      </div>

      {/* 3. TABS AND SEARCH FILTERS */}
      <div className="px-8 py-3.5 border-b border-neutral-800/60 bg-[#08080c] shrink-0">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Category Tabs */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-neutral-950 border border-neutral-800">
            {[
              { id: "all", label: "All Events" },
              { id: "browser", label: "Browser" },
              { id: "agents", label: "Agents" },
              { id: "approvals", label: "Approvals" },
              { id: "system", label: "System" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveCategory(tab.id)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                  activeCategory === tab.id
                    ? "bg-neutral-800 text-white font-semibold shadow-sm"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search & Filter Dropdowns */}
          <div className="flex items-center gap-2.5 flex-1 max-w-lg">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search event message, action, module..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadInitialData()}
                className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-violet-500/50 transition"
              />
            </div>

            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as DateRangeOption)}
              className="px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-neutral-300 focus:outline-none focus:border-violet-500/50 transition cursor-pointer"
            >
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="24h">Past 24 Hours</option>
              <option value="7d">Past 7 Days</option>
              <option value="30d">Past 30 Days</option>
            </select>

            <select
              value={outcomeFilter}
              onChange={(e) => setOutcomeFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-neutral-300 focus:outline-none focus:border-violet-500/50 transition cursor-pointer"
            >
              <option value="all">All Outcomes</option>
              <option value="success">Success</option>
              <option value="warning">Warning</option>
              <option value="failure">Failure</option>
            </select>
          </div>
        </div>
      </div>

      {/* 4. CHRONOLOGICAL TIMELINE FEED */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-7xl mx-auto">
          {isLoading && events.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-neutral-500">
              <RefreshCw className="w-6 h-6 animate-spin text-violet-400 mb-3" />
              <p className="text-xs">Loading activity stream...</p>
            </div>
          ) : events.length === 0 ? (
            <div className="p-12 rounded-2xl bg-neutral-900/20 border border-dashed border-neutral-800 text-center max-w-lg mx-auto">
              <Activity className="w-10 h-10 text-neutral-600 mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-white">No Activity Events Found</h3>
              <p className="text-xs text-neutral-400 mt-1 max-w-sm mx-auto">
                No events recorded matching the current filter criteria. Autonomous actions and tool executions will stream here in real time.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedEvents).map(([dateLabel, groupList]) => (
                <div key={dateLabel} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono uppercase font-semibold text-neutral-400 tracking-wider">
                      {dateLabel}
                    </span>
                    <div className="flex-1 h-px bg-neutral-800/80" />
                    <span className="text-[10px] font-mono text-neutral-500">
                      {groupList.length} {groupList.length === 1 ? "event" : "events"}
                    </span>
                  </div>

                  <div className="space-y-2 relative before:absolute before:left-4 before:top-3 before:bottom-3 before:w-px before:bg-neutral-800/60">
                    {groupList.map((evt) => {
                      const catInfo = getCategoryIcon(evt.category);
                      const outInfo = getOutcomeBadge(evt.outcome);

                      return (
                        <div
                          key={evt.id}
                          onClick={() => setSelectedEvent(evt)}
                          className="relative pl-9 group p-3.5 rounded-xl bg-[#09090e] border border-neutral-800/80 hover:border-neutral-700 transition cursor-pointer hover:shadow-lg hover:shadow-black/50"
                        >
                          {/* Dot indicator on timeline spine */}
                          <div className="absolute left-2.5 top-5 -translate-y-1/2 w-3 h-3 rounded-full bg-[#050507] flex items-center justify-center">
                            <span className={`w-2 h-2 rounded-full ${outInfo.dot}`} />
                          </div>

                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5">
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border ${catInfo.bg} ${catInfo.color}`}>
                                  {evt.category}
                                </span>
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-neutral-400">
                                  {evt.actorType}
                                </span>
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-neutral-400">
                                  {evt.sourceModule}
                                </span>
                                {evt.actionName && (
                                  <span className="text-[11px] font-mono text-neutral-300 font-medium">
                                    {evt.actionName}
                                  </span>
                                )}
                              </div>

                              <p className="text-xs text-neutral-200 group-hover:text-white transition leading-relaxed">
                                {evt.message}
                              </p>
                            </div>

                            <div className="flex items-center gap-3 shrink-0 self-end md:self-center">
                              <span className="text-[10px] font-mono text-neutral-500 whitespace-nowrap">
                                {new Date(evt.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                              </span>
                              <ChevronRight className="w-3.5 h-3.5 text-neutral-600 group-hover:text-neutral-300 transition" />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Cursor Pagination Button */}
              {nextCursor && (
                <div className="text-center pt-4">
                  <button
                    onClick={loadMoreEvents}
                    disabled={isLoadingMore}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-neutral-900 border border-neutral-800 text-neutral-300 hover:text-white hover:border-neutral-700 transition disabled:opacity-50"
                  >
                    {isLoadingMore ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-violet-400" />
                        <span>Loading older events...</span>
                      </>
                    ) : (
                      <>
                        <ArrowDown className="w-3.5 h-3.5 text-neutral-400" />
                        <span>Load Older Events</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 5. SLIDE-OVER EVENT DETAIL DRAWER */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg h-full bg-[#0a0a0f] border-l border-neutral-800 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="p-5 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/60">
              <div className="flex items-center gap-2.5">
                <Activity className="w-4 h-4 text-violet-400" />
                <h3 className="text-sm font-semibold text-white">Event Audit Record</h3>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Drawer Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
              {/* Event Summary Card */}
              <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border ${getCategoryIcon(selectedEvent.category).bg} ${getCategoryIcon(selectedEvent.category).color}`}>
                    {selectedEvent.category}
                  </span>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded flex items-center gap-1 font-medium ${getOutcomeBadge(selectedEvent.outcome).text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${getOutcomeBadge(selectedEvent.outcome).dot}`} />
                    {getOutcomeBadge(selectedEvent.outcome).label}
                  </span>
                </div>
                <h2 className="text-sm font-semibold text-white leading-relaxed">
                  {selectedEvent.message}
                </h2>
                <div className="text-[11px] font-mono text-neutral-400">
                  Timestamp: {new Date(selectedEvent.createdAt).toUTCString()}
                </div>
              </div>

              {/* Attribution and Context */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-neutral-300">Operational Provenance</h4>
                <div className="p-3.5 rounded-xl bg-neutral-950 border border-neutral-800/80 space-y-2 text-[11px] font-mono">
                  <div className="flex justify-between py-1 border-b border-neutral-900">
                    <span className="text-neutral-500">Event ID:</span>
                    <span className="text-neutral-300">{selectedEvent.id}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-neutral-900">
                    <span className="text-neutral-500">Actor Type:</span>
                    <span className="text-neutral-300">{selectedEvent.actorType}</span>
                  </div>
                  {selectedEvent.actorId && (
                    <div className="flex justify-between py-1 border-b border-neutral-900">
                      <span className="text-neutral-500">Actor ID:</span>
                      <span className="text-neutral-300">{selectedEvent.actorId}</span>
                    </div>
                  )}
                  <div className="flex justify-between py-1 border-b border-neutral-900">
                    <span className="text-neutral-500">Source Module:</span>
                    <span className="text-cyan-400">{selectedEvent.sourceModule}</span>
                  </div>
                  {selectedEvent.actionName && (
                    <div className="flex justify-between py-1 border-b border-neutral-900">
                      <span className="text-neutral-500">Action Name:</span>
                      <span className="text-neutral-300">{selectedEvent.actionName}</span>
                    </div>
                  )}
                  {selectedEvent.correlationId && (
                    <div className="flex justify-between py-1 border-b border-neutral-900">
                      <span className="text-neutral-500">Correlation ID:</span>
                      <span className="text-neutral-300">{selectedEvent.correlationId}</span>
                    </div>
                  )}
                  {selectedEvent.workflowExecutionId && (
                    <div className="flex justify-between py-1 border-b border-neutral-900">
                      <span className="text-neutral-500">Workflow Execution:</span>
                      <span className="text-violet-400">{selectedEvent.workflowExecutionId}</span>
                    </div>
                  )}
                  {selectedEvent.skillExecutionId && (
                    <div className="flex justify-between py-1 border-b border-neutral-900">
                      <span className="text-neutral-500">Skill Execution:</span>
                      <span className="text-amber-400">{selectedEvent.skillExecutionId}</span>
                    </div>
                  )}
                  {selectedEvent.approvalRequestId && (
                    <div className="flex justify-between py-1">
                      <span className="text-neutral-500">Approval Request:</span>
                      <span className="text-amber-400">{selectedEvent.approvalRequestId}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Structured Metadata */}
              {selectedEvent.metadata && (
                <div>
                  <div className="flex items-center justify-between text-xs font-semibold text-neutral-300 mb-2">
                    <span>Structured Metadata</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(JSON.stringify(selectedEvent.metadata, null, 2));
                        toast.success("Metadata copied to clipboard");
                      }}
                      className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-white transition"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Copy JSON</span>
                    </button>
                  </div>
                  <pre className="p-3.5 rounded-xl bg-neutral-950 border border-neutral-800 text-[11px] font-mono text-neutral-300 overflow-x-auto max-h-60 leading-relaxed selection:bg-neutral-800">
                    {JSON.stringify(selectedEvent.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            {/* Drawer Footer */}
            <div className="p-4 border-t border-neutral-800 bg-neutral-950/80 flex items-center justify-end">
              <button
                onClick={() => setSelectedEvent(null)}
                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-white transition"
              >
                Close Record
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
