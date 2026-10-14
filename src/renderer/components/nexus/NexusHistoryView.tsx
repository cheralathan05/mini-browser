import React, { useState, useEffect, useCallback } from "react";
import {
  History,
  Search,
  X,
  ExternalLink,
  Globe,
  Trash2,
  Clock,
  Calendar,
  ChevronDown,
  ChevronRight,
  Filter,
  Download,
  RefreshCw,
  Bot,
  Star,
  Shield,
  AlertTriangle,
  TrendingUp,
} from "lucide-react";
import { nexusClient } from "../../lib/nexus/nexus-client";
import { nexusTabIntelligence } from "../../lib/nexus/nexus-tab-intelligence";

interface HistoryItem {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  visitedAt: string;
  visitCount?: number;
  isAgentVisit?: boolean;
}

interface Props {
  onOpenInBrowser?: (url: string, title?: string) => void;
}

const PERIODS = ["Today", "Yesterday", "Last 7 Days", "Last 30 Days", "All Time"];

function groupByDate(items: HistoryItem[]): Record<string, HistoryItem[]> {
  const groups: Record<string, HistoryItem[]> = {};
  items.forEach((item) => {
    const d = new Date(item.visitedAt);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    let label: string;
    if (d.toDateString() === today.toDateString()) label = "Today";
    else if (d.toDateString() === yesterday.toDateString()) label = "Yesterday";
    else label = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

    if (!groups[label]) groups[label] = [];
    groups[label].push(item);
  });
  return groups;
}

export const NexusHistoryView: React.FC<Props> = ({ onOpenInBrowser }) => {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPeriod, setSelectedPeriod] = useState("All Time");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [stats, setStats] = useState({ totalVisits: 0, uniqueSites: 0, agentVisits: 0, mostVisited: "" });
  const [isLoading, setIsLoading] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const loadRealHistory = useCallback(async () => {
    setIsLoading(true);
    const shell = typeof window !== "undefined" ? (window as any).browserShell : undefined;
    const historyMap = new Map<string, HistoryItem>();

    // 1. Electron BrowserShell History (Real active sessions & visited tabs)
    if (shell?.historyGetState) {
      try {
        const state = await shell.historyGetState();
        const records = state?.records || [];
        for (const r of records) {
          if (!r.url || r.url.startsWith("nexus://")) continue;
          historyMap.set(r.url, {
            id: r.id || `sh-${r.url}`,
            url: r.url,
            title: r.title || r.url,
            favicon: r.favicon || (r.url.startsWith("http") ? `https://${new URL(r.url).hostname}/favicon.ico` : undefined),
            visitedAt: new Date(r.lastVisitedAt || r.createdAt || Date.now()).toISOString(),
            visitCount: r.visitCount || 1,
            isAgentVisit: false,
          });
        }
      } catch (err) {
        console.warn("[NexusHistory] browserShell history error:", err);
      }
    }

    // 2. Tab Intelligence Engine (Real tracked omnibox searches and video sessions)
    try {
      const tabRecords = nexusTabIntelligence.getRecords();
      for (const tr of tabRecords) {
        if (!tr.url || tr.url.startsWith("nexus://") || tr.id?.startsWith("demo-")) continue;
        const existing = historyMap.get(tr.url);
        if (!existing) {
          historyMap.set(tr.url, {
            id: tr.id,
            url: tr.url,
            title: tr.title || tr.query || tr.url,
            favicon: tr.favicon || (tr.url.startsWith("http") ? `https://${new URL(tr.url).hostname}/favicon.ico` : undefined),
            visitedAt: new Date(tr.timestamp).toISOString(),
            visitCount: 1,
            isAgentVisit: tr.action === "search" || tr.action === "watch",
          });
        }
      }
    } catch {}

    // 3. PostgreSQL Database History
    try {
      const dbHist = await nexusClient.getHistory();
      if (dbHist?.history && Array.isArray(dbHist.history)) {
        for (const item of dbHist.history) {
          if (!item.url || item.url.startsWith("nexus://") || item.id?.startsWith("demo-")) continue;
          if (!historyMap.has(item.url)) {
            historyMap.set(item.url, item);
          }
        }
      }
    } catch {}

    // 4. Persistent LocalStorage History
    try {
      const stored = localStorage.getItem("nexus_history");
      if (stored) {
        const parsed: HistoryItem[] = JSON.parse(stored);
        for (const item of parsed) {
          if (!item.url || item.url.startsWith("nexus://") || item.id?.startsWith("demo-")) continue;
          if (!historyMap.has(item.url)) {
            historyMap.set(item.url, item);
          }
        }
      }
    } catch {}

    // 5. PostgreSQL Backend Activities
    try {
      const actRes = await nexusClient.getActivity(50);
      for (const a of actRes.activities || []) {
        const url = a.metadata?.url || a.metadata?.sourceUrl;
        if (url && typeof url === "string" && !url.startsWith("nexus://") && !historyMap.has(url)) {
          historyMap.set(url, {
            id: a.id,
            url,
            title: a.metadata?.title || a.message || url,
            favicon: url.startsWith("http") ? `https://${new URL(url).hostname}/favicon.ico` : undefined,
            visitedAt: a.createdAt || new Date().toISOString(),
            visitCount: 1,
            isAgentVisit: a.type?.startsWith("AGENT") || a.type?.startsWith("TASK"),
          });
        }
      }
    } catch {}

    const list = Array.from(historyMap.values()).sort(
      (a, b) => new Date(b.visitedAt).getTime() - new Date(a.visitedAt).getTime()
    );

    setHistory(list);

    // Save consolidated clean real history to localStorage & PostgreSQL
    try {
      localStorage.setItem("nexus_history", JSON.stringify(list.slice(0, 300)));
    } catch {}
    void nexusClient.saveHistory(list.slice(0, 300)).catch(() => {});

    const uniqueSites = new Set(list.map((h) => { try { return new URL(h.url).hostname; } catch { return h.url; } }));
    const agentVisits = list.filter((h) => h.isAgentVisit).length;
    const visitCounts: Record<string, number> = {};
    list.forEach((h) => {
      try {
        const host = new URL(h.url).hostname;
        visitCounts[host] = (visitCounts[host] || 0) + (h.visitCount || 1);
      } catch {}
    });
    const mostVisited = Object.entries(visitCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
    setStats({ totalVisits: list.reduce((s, h) => s + (h.visitCount || 1), 0), uniqueSites: uniqueSites.size, agentVisits, mostVisited });
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadRealHistory();
  }, [loadRealHistory]);

  const handleDelete = async (id: string) => {
    const item = history.find((h) => h.id === id);
    const shell = typeof window !== "undefined" ? (window as any).browserShell : undefined;
    if (shell?.historyRemove && item) {
      try { await shell.historyRemove(item.id); } catch {}
    }
    nexusTabIntelligence.deleteRecord(id);
    const updated = history.filter((h) => h.id !== id);
    setHistory(updated);
    try { localStorage.setItem("nexus_history", JSON.stringify(updated)); } catch {}
    void nexusClient.saveHistory(updated.slice(0, 300)).catch(() => {});
    showToast("Removed from history");
  };

  const handleClearAll = async () => {
    if (!confirm("Clear all browsing history?")) return;
    const shell = typeof window !== "undefined" ? (window as any).browserShell : undefined;
    if (shell?.historyClear) {
      try { await shell.historyClear(); } catch {}
    }
    nexusTabIntelligence.clearAll();
    setHistory([]);
    try { localStorage.setItem("nexus_history", JSON.stringify([])); } catch {}
    void nexusClient.clearHistory().catch(() => {});
    showToast("History cleared");
  };

  const filterByPeriod = (items: HistoryItem[]) => {
    if (selectedPeriod === "All Time") return items;
    const now = Date.now();
    const cutoffs: Record<string, number> = {
      "Today": 86400000,
      "Yesterday": 172800000,
      "Last 7 Days": 604800000,
      "Last 30 Days": 2592000000,
    };
    return items.filter((h) => now - new Date(h.visitedAt).getTime() <= cutoffs[selectedPeriod]);
  };

  const filtered = filterByPeriod(
    history.filter((h) => {
      const q = searchQuery.toLowerCase();
      return !q || h.title.toLowerCase().includes(q) || h.url.toLowerCase().includes(q);
    })
  ).sort((a, b) => new Date(b.visitedAt).getTime() - new Date(a.visitedAt).getTime());

  const grouped = groupByDate(filtered);
  const groupKeys = Object.keys(grouped);

  const getDomain = (url: string) => {
    try { return new URL(url).hostname.replace("www.", ""); } catch { return url; }
  };

  const getFaviconUrl = (url: string) => {
    try { return `https://${new URL(url).hostname}/favicon.ico`; } catch { return undefined; }
  };

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  };

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#04040a] text-neutral-100 overflow-hidden select-none">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 px-4 py-2 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-sm font-medium shadow-lg animate-in slide-in-from-top">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="shrink-0 px-8 pt-8 pb-4 border-b border-white/5 bg-[#05050c]">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500/25 to-blue-600/30 border border-cyan-500/30 flex items-center justify-center shadow-lg">
                <History className="w-6 h-6 text-cyan-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white tracking-tight">Browsing History</h1>
                <p className="text-sm text-neutral-400 mt-0.5">{filtered.length} entries visible</p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleClearAll}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 text-sm font-medium transition"
            >
              <Trash2 className="w-4 h-4" />
              Clear All
            </button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-3 mb-5">
            {[
              { label: "Total Visits", value: stats.totalVisits, icon: TrendingUp, color: "text-cyan-400" },
              { label: "Unique Sites", value: stats.uniqueSites, icon: Globe, color: "text-violet-400" },
              { label: "AI Agent Visits", value: stats.agentVisits, icon: Bot, color: "text-emerald-400" },
              { label: "Most Visited", value: stats.mostVisited, icon: Star, color: "text-amber-400" },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="p-3 rounded-2xl bg-[#0a0a12] border border-white/5 flex items-center gap-3">
                <Icon className={`w-5 h-5 ${color} shrink-0`} />
                <div>
                  <span className="text-[10px] uppercase font-mono text-neutral-500 block">{label}</span>
                  <div className="text-sm font-bold text-white truncate">{value}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Search + Filter */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search history..."
                className="w-full pl-9 pr-3 py-2 bg-neutral-900/60 border border-white/5 rounded-xl text-sm text-neutral-200 placeholder-neutral-500 outline-none focus:border-cyan-500/50 transition"
              />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 p-1 rounded-xl bg-neutral-900 border border-white/5">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setSelectedPeriod(p)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                    selectedPeriod === p
                      ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                      : "text-neutral-500 hover:text-white"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* History List */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-5xl mx-auto space-y-6">
          {groupKeys.length === 0 ? (
            <div className="py-20 text-center text-neutral-500 space-y-3 border border-dashed border-white/5 rounded-3xl">
              <History className="w-12 h-12 text-neutral-700 mx-auto" />
              <p className="text-base font-medium text-neutral-400">No history found</p>
              <p className="text-sm">Your browsing history will appear here</p>
            </div>
          ) : (
            groupKeys.map((dateLabel) => {
              const items = grouped[dateLabel];
              const isCollapsed = collapsedGroups.has(dateLabel);
              return (
                <div key={dateLabel}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(dateLabel)}
                    className="flex items-center gap-2 mb-3 group"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="w-4 h-4 text-neutral-600 group-hover:text-neutral-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-neutral-600 group-hover:text-neutral-400" />
                    )}
                    <span className="text-sm font-semibold text-neutral-400 uppercase tracking-wider font-mono">{dateLabel}</span>
                    <span className="text-xs text-neutral-600 font-mono">({items.length})</span>
                  </button>

                  {!isCollapsed && (
                    <div className="space-y-1.5 pl-2">
                      {items.map((item) => {
                        const favicon = getFaviconUrl(item.url);
                        const domain = getDomain(item.url);
                        return (
                          <div
                            key={item.id}
                            className="group flex items-center gap-4 p-3.5 rounded-2xl bg-[#09090e]/80 hover:bg-[#0e0e18] border border-white/5 hover:border-cyan-500/20 transition-all"
                          >
                            <div className="w-8 h-8 rounded-xl bg-neutral-900 border border-white/5 flex items-center justify-center shrink-0 overflow-hidden">
                              {item.isAgentVisit ? (
                                <Bot className="w-4 h-4 text-emerald-400" />
                              ) : favicon ? (
                                <img src={favicon} alt="" className="w-4 h-4 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                              ) : (
                                <Globe className="w-4 h-4 text-neutral-500" />
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-neutral-200 truncate">{item.title}</p>
                              <p className="text-xs text-neutral-500 truncate">{domain}</p>
                            </div>

                            <div className="flex items-center gap-3 shrink-0">
                              {item.isAgentVisit && (
                                <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-mono">AI</span>
                              )}
                              {(item.visitCount || 1) > 1 && (
                                <span className="text-xs text-neutral-500 font-mono">{item.visitCount}x</span>
                              )}
                              <span className="text-xs text-neutral-600 font-mono">{formatTime(item.visitedAt)}</span>

                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                                <button type="button" onClick={() => onOpenInBrowser?.(item.url, item.title)} className="p-1.5 rounded-lg hover:bg-white/5 text-neutral-400 hover:text-white transition" title="Open">
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </button>
                                <button type="button" onClick={() => handleDelete(item.id)} className="p-1.5 rounded-lg hover:bg-rose-500/10 text-neutral-400 hover:text-rose-400 transition" title="Remove">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
