import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Download,
  Search,
  X,
  CheckCircle2,
  Clock,
  Trash2,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Archive,
  Package,
  Pause,
  Play,
  RefreshCw,
  FolderOpen,
  Plus,
  TrendingDown,
  HardDrive,
  Copy,
  Check,
  FileCode,
  FileQuestion,
  Sparkles,
} from "lucide-react";

import { nexusClient } from "../../lib/nexus/nexus-client";

export interface DownloadItem {
  id: string;
  filename: string;
  url: string;
  path?: string;
  size: number; // bytes
  downloadedBytes: number;
  status: "completed" | "in_progress" | "paused" | "failed" | "cancelled";
  startedAt: string;
  completedAt?: string;
  type: "file" | "image" | "archive" | "pdf" | "code";
  speed?: number; // bytes/sec (for active downloads)
}

interface Props {
  onOpenInBrowser?: (url: string, title?: string) => void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatTimestamp(isoStr?: string): string {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return "";

  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));

  const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 0 && d.toDateString() === now.toDateString()) {
    return `Today at ${timeStr}`;
  }
  if (diffDays <= 1) {
    return `Yesterday at ${timeStr}`;
  }
  if (diffDays < 7) {
    return `${d.toLocaleDateString([], { weekday: "short" })} at ${timeStr}`;
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function getFileIcon(type: DownloadItem["type"]) {
  switch (type) {
    case "image": return ImageIcon;
    case "archive": return Archive;
    case "pdf": return FileText;
    case "code": return FileCode;
    default: return FileQuestion;
  }
}

function getTypeColor(type: DownloadItem["type"]) {
  switch (type) {
    case "image": return "text-pink-400 bg-pink-500/10 border-pink-500/20";
    case "archive": return "text-amber-400 bg-amber-500/10 border-amber-500/20";
    case "pdf": return "text-rose-400 bg-rose-500/10 border-rose-500/20";
    case "code": return "text-cyan-400 bg-cyan-500/10 border-cyan-500/20";
    default: return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
  }
}

function inferFileType(filename: string): DownloadItem["type"] {
  const ext = (filename || "").split(".").pop()?.toLowerCase() || "";
  if (["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp", "ico", "avif"].includes(ext)) return "image";
  if (["zip", "tar", "gz", "7z", "rar", "dmg", "exe", "msi", "iso", "pkg"].includes(ext)) return "archive";
  if (["pdf", "epub", "doc", "docx", "txt", "md", "rtf", "odt"].includes(ext)) return "pdf";
  if (["ts", "tsx", "js", "jsx", "py", "json", "html", "css", "rs", "go", "java", "c", "cpp", "xml", "yaml", "yml", "sh"].includes(ext)) return "code";
  return "file";
}

export const NexusDownloadsView: React.FC<Props> = ({ onOpenInBrowser }) => {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [downloadsDirectory, setDownloadsDirectory] = useState<string>("Downloads");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "completed" | "in_progress" | "paused" | "failed">("all");
  const [filterType, setFilterType] = useState<"all" | "image" | "pdf" | "archive" | "code" | "file">("all");
  const [toast, setToast] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const loadRealDownloads = useCallback(async () => {
    setIsLoading(true);
    const downloadMap = new Map<string, DownloadItem>();
    const shell = typeof window !== "undefined" ? (window as any).browserShell : undefined;

    // 1. Load native active and recorded downloads from Electron browser shell
    if (shell?.downloadsGetState) {
      try {
        const state = await shell.downloadsGetState();
        const records = state?.records || [];
        for (const r of records) {
          const type = inferFileType(r.filename || r.targetPath || "");
          const status = (r.status === "running" ? "in_progress" : r.status) as DownloadItem["status"];
          const key = (r.targetPath || r.filename || r.id).toLowerCase();

          downloadMap.set(key, {
            id: r.id,
            filename: r.filename || "Downloaded File",
            path: r.targetPath,
            url: r.url || (r.targetPath ? `file:///${r.targetPath.replace(/\\/g, "/")}` : ""),
            size: r.totalBytes || r.receivedBytes || 0,
            downloadedBytes: r.receivedBytes || 0,
            status,
            startedAt: new Date(r.createdAt || Date.now()).toISOString(),
            completedAt: r.completedAt ? new Date(r.completedAt).toISOString() : undefined,
            type,
            speed: r.speedBytesPerSecond,
          });
        }
      } catch (err) {
        console.warn("[NexusDownloads] browserShell downloads error:", err);
      }
    }

    if (shell?.downloadsGetPreferences) {
      try {
        const prefs = await shell.downloadsGetPreferences();
        if (prefs?.defaultDirectory) {
          setDownloadsDirectory(prefs.defaultDirectory);
        }
      } catch {}
    }

    // 2. Load system filesystem downloads from local full-stack backend
    try {
      const res = await nexusClient.getDownloads();
      if (res?.downloadsDirectory) {
        setDownloadsDirectory(res.downloadsDirectory);
      }
      if (res?.downloads && Array.isArray(res.downloads)) {
        for (const d of res.downloads as DownloadItem[]) {
          const key = (d.path || d.filename || d.id).toLowerCase();
          if (!downloadMap.has(key)) {
            downloadMap.set(key, d);
          }
        }
      }
    } catch (err) {
      console.warn("[NexusDownloads] backend filesystem fetch notice:", err);
    }

    const items = Array.from(downloadMap.values());
    items.sort((a, b) => {
      // In progress downloads on top, then newest completed/started
      if (a.status === "in_progress" && b.status !== "in_progress") return -1;
      if (b.status === "in_progress" && a.status !== "in_progress") return 1;
      const timeA = new Date(a.completedAt || a.startedAt).getTime() || 0;
      const timeB = new Date(b.completedAt || b.startedAt).getTime() || 0;
      return timeB - timeA;
    });

    setDownloads(items);
    setIsLoading(false);
  }, []);

  // Initial load and live event subscriptions
  useEffect(() => {
    loadRealDownloads();

    const handleDownloadsChanged = () => {
      loadRealDownloads();
    };

    const handleWindowFocus = () => {
      loadRealDownloads();
    };

    window.addEventListener("downloads:changed", handleDownloadsChanged);
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      window.removeEventListener("downloads:changed", handleDownloadsChanged);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [loadRealDownloads]);

  // Polling interval if active downloads exist
  useEffect(() => {
    const hasActive = downloads.some((d) => d.status === "in_progress");
    if (!hasActive) return;

    const interval = setInterval(() => {
      loadRealDownloads();
    }, 1200);

    return () => clearInterval(interval);
  }, [downloads, loadRealDownloads]);

  // Action Handlers
  const handleOpenFile = async (item: DownloadItem) => {
    const shell = typeof window !== "undefined" ? (window as any).browserShell : undefined;
    try {
      if (item.path) {
        // Reveal in OS file manager
        if (shell?.downloadsShowInFolder && !item.id.startsWith("dl_")) {
          await shell.downloadsShowInFolder(item.id);
        } else {
          await nexusClient.openLocalFile(item.path);
        }
        showToast(`Revealed "${item.filename}" in File Explorer`);
      } else if (item.url && item.url.startsWith("http")) {
        onOpenInBrowser ? onOpenInBrowser(item.url, item.filename) : window.open(item.url, "_blank");
      }
    } catch {
      showToast(`Opening "${item.filename}"`);
    }
  };

  const handleOpenFolder = async () => {
    try {
      await nexusClient.openLocalFile(downloadsDirectory);
      showToast(`Opened folder: ${downloadsDirectory}`);
    } catch {
      showToast(`Downloads directory: ${downloadsDirectory}`);
    }
  };

  const handleCopyPathOrUrl = (item: DownloadItem) => {
    const target = item.path || item.url;
    if (!target) return;
    navigator.clipboard.writeText(target);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 2000);
    showToast("Path copied to clipboard");
  };

  const handleDelete = async (id: string, pathOrFilename: string) => {
    const shell = typeof window !== "undefined" ? (window as any).browserShell : undefined;
    if (shell?.downloadsRemove && !id.startsWith("dl_")) {
      try {
        await shell.downloadsRemove(id, false);
      } catch {}
    }
    setDownloads((prev) => prev.filter((d) => d.id !== id));
    showToast("Download removed from history");
  };

  const handlePauseResume = async (item: DownloadItem) => {
    const shell = typeof window !== "undefined" ? (window as any).browserShell : undefined;
    if (shell) {
      try {
        if (item.status === "paused" && shell.downloadsResume) {
          await shell.downloadsResume(item.id);
        } else if (item.status === "in_progress" && shell.downloadsPause) {
          await shell.downloadsPause(item.id);
        }
      } catch {}
    }

    setDownloads((prev) =>
      prev.map((d) =>
        d.id === item.id
          ? { ...d, status: d.status === "paused" ? "in_progress" : "paused" }
          : d
      )
    );
  };

  const handleClearCompleted = () => {
    setDownloads((prev) => prev.filter((d) => d.status !== "completed"));
    showToast("Completed downloads cleared from list");
  };

  // Filtered List
  const filtered = downloads.filter((d) => {
    const matchStatus = filterStatus === "all" || d.status === filterStatus;
    const matchType = filterType === "all" || d.type === filterType;
    const q = searchQuery.toLowerCase().trim();
    const matchSearch =
      !q ||
      d.filename.toLowerCase().includes(q) ||
      (d.path && d.path.toLowerCase().includes(q)) ||
      (d.url && d.url.toLowerCase().includes(q));
    return matchStatus && matchType && matchSearch;
  });

  const totalSize = downloads.reduce((s, d) => s + (d.size || 0), 0);
  const completedCount = downloads.filter((d) => d.status === "completed").length;
  const activeCount = downloads.filter((d) => d.status === "in_progress").length;
  const pausedCount = downloads.filter((d) => d.status === "paused").length;
  const failedCount = downloads.filter((d) => d.status === "failed").length;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#04040a] text-neutral-100 overflow-hidden select-none">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-5 right-6 z-50 px-4 py-2.5 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold shadow-2xl backdrop-blur-md animate-in slide-in-from-top-3 duration-200">
          {toast}
        </div>
      )}

      {/* Header Chrome */}
      <div className="shrink-0 px-8 pt-7 pb-5 border-b border-white/[0.06] bg-[#05050c]">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500/25 to-green-600/35 border border-emerald-500/35 flex items-center justify-center shadow-lg shadow-emerald-500/10">
                <Download className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
                  Downloads
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono font-medium">
                    {downloads.length} files
                  </span>
                </h1>
                <p className="text-xs text-neutral-400 mt-1 flex items-center gap-2">
                  <span>Folder:</span>
                  <span
                    className="font-mono text-neutral-300 hover:text-emerald-300 cursor-pointer underline decoration-white/20 transition truncate max-w-md"
                    onClick={handleOpenFolder}
                    title="Click to reveal Downloads directory"
                  >
                    {downloadsDirectory}
                  </span>
                  {activeCount > 0 && (
                    <span className="text-cyan-400 font-semibold animate-pulse">
                      · {activeCount} active downloading
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={loadRealDownloads}
                disabled={isLoading}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-neutral-900/80 hover:bg-neutral-800 border border-white/10 hover:border-white/20 text-neutral-300 hover:text-white text-xs font-medium transition active:scale-95 shadow-sm"
                title="Scan Downloads directory and refresh state"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-cyan-400" : ""}`} />
                Scan
              </button>
              {completedCount > 0 && (
                <button
                  type="button"
                  onClick={handleClearCompleted}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-neutral-900/80 hover:bg-neutral-800 border border-white/10 hover:border-white/20 text-neutral-400 hover:text-rose-300 text-xs font-medium transition active:scale-95"
                  title="Clear completed downloads from view list"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear Completed
                </button>
              )}
              <button
                type="button"
                onClick={handleOpenFolder}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white text-xs font-bold shadow-lg shadow-emerald-500/20 transition active:scale-95 cursor-pointer"
                title={`Open folder: ${downloadsDirectory}`}
              >
                <FolderOpen className="w-4 h-4" />
                Open Folder
              </button>
            </div>
          </div>

          {/* Telemetry Stats Cards */}
          <div className="grid grid-cols-4 gap-3.5 mb-5">
            {[
              {
                label: "Total Files",
                value: downloads.length,
                sub: "In download library",
                icon: HardDrive,
                color: "text-emerald-400",
                border: "border-emerald-500/20",
              },
              {
                label: "Completed",
                value: completedCount,
                sub: "Saved to storage",
                icon: CheckCircle2,
                color: "text-emerald-400",
                border: "border-emerald-500/20",
              },
              {
                label: "Active Downloads",
                value: activeCount,
                sub: activeCount > 0 ? "Network streams running" : "Idle",
                icon: TrendingDown,
                color: "text-cyan-400",
                border: "border-cyan-500/20",
              },
              {
                label: "Storage Used",
                value: formatBytes(totalSize),
                sub: "Total file size",
                icon: HardDrive,
                color: "text-violet-400",
                border: "border-violet-500/20",
              },
            ].map(({ label, value, sub, icon: Icon, color, border }) => (
              <div
                key={label}
                className={`p-3.5 rounded-2xl bg-[#090912]/80 border ${border} flex items-center justify-between shadow-sm`}
              >
                <div className="min-w-0">
                  <span className="text-[10px] uppercase font-mono tracking-wider text-neutral-500 block mb-1">
                    {label}
                  </span>
                  <div className="text-lg font-extrabold text-white tracking-tight truncate">
                    {value}
                  </div>
                  <span className="text-[10px] text-neutral-500 truncate block mt-0.5">
                    {sub}
                  </span>
                </div>
                <div className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0 ml-2">
                  <Icon className={`w-4 h-4 ${color}`} />
                </div>
              </div>
            ))}
          </div>

          {/* Search + Filter Pill Row */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search downloads by filename, extension, or URL..."
                className="w-full pl-9 pr-8 py-2 bg-neutral-900/70 border border-white/10 rounded-xl text-xs text-neutral-200 placeholder-neutral-500 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 transition"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Status Filter Pills */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-neutral-900/90 border border-white/[0.08] overflow-x-auto">
              {[
                { id: "all", label: "All", count: downloads.length },
                { id: "completed", label: "Completed", count: completedCount },
                { id: "in_progress", label: "Active", count: activeCount },
                { id: "paused", label: "Paused", count: pausedCount },
                { id: "failed", label: "Failed", count: failedCount },
              ].map(({ id, label, count }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilterStatus(id as any)}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition shrink-0 ${
                    filterStatus === id
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/35 shadow-sm"
                      : "text-neutral-400 hover:text-white hover:bg-white/[0.04]"
                  }`}
                >
                  <span>{label}</span>
                  <span
                    className={`text-[10px] font-mono px-1 rounded ${
                      filterStatus === id
                        ? "bg-emerald-500/30 text-emerald-200"
                        : "text-neutral-500"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Secondary Filter: File Type Pills */}
          <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-white/[0.04] overflow-x-auto text-[11px]">
            <span className="text-neutral-500 font-mono text-[10px] uppercase mr-1">Type:</span>
            {[
              { id: "all", label: "All Types" },
              { id: "image", label: "Images" },
              { id: "pdf", label: "Documents & PDFs" },
              { id: "archive", label: "Archives & Installers" },
              { id: "code", label: "Code & Projects" },
              { id: "file", label: "Other" },
            ].map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilterType(id as any)}
                className={`px-2.5 py-0.5 rounded-md transition shrink-0 font-medium ${
                  filterType === id
                    ? "bg-white/10 text-white font-semibold"
                    : "text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.04]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Downloads List View */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-6xl mx-auto space-y-2.5">
          {isLoading && downloads.length === 0 ? (
            <div className="py-24 text-center text-neutral-400 flex flex-col items-center gap-3">
              <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin" />
              <p className="text-sm font-medium">Scanning Downloads library...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center text-neutral-400 space-y-3.5 border border-dashed border-white/10 rounded-3xl bg-[#070710]/40 p-8">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto text-emerald-400">
                <Download className="w-8 h-8" />
              </div>
              <div className="max-w-md mx-auto">
                <h3 className="text-base font-bold text-white">No downloads found</h3>
                <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                  {searchQuery || filterStatus !== "all" || filterType !== "all"
                    ? "No files match the currently applied filters or search criteria."
                    : "Files downloaded through NEXUS or located in your Windows Downloads folder will appear here."}
                </p>
              </div>
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={loadRealDownloads}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-neutral-900 border border-white/10 hover:border-white/20 text-neutral-200 text-xs font-semibold transition"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Rescan Local Storage
                </button>
                <button
                  type="button"
                  onClick={handleOpenFolder}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-500/20 transition"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  Open Downloads Folder
                </button>
              </div>
            </div>
          ) : (
            filtered.map((d) => {
              const Icon = getFileIcon(d.type);
              const typeColor = getTypeColor(d.type);
              const isImage = d.type === "image" && (d.path || (d.url && d.url.startsWith("file://")));
              const progress = d.size > 0 ? Math.min(100, Math.round((d.downloadedBytes / d.size) * 100)) : 0;
              const isCopied = copiedId === d.id;

              return (
                <div
                  key={d.id}
                  className="group flex items-center gap-4 p-4 rounded-2xl bg-[#080811]/90 hover:bg-[#0d0d1b] border border-white/[0.05] hover:border-emerald-500/25 transition-all shadow-sm duration-150"
                >
                  {/* File Type or Image Thumbnail Preview */}
                  {isImage ? (
                    <div
                      className="w-12 h-12 rounded-xl bg-neutral-950 border border-white/10 flex items-center justify-center shrink-0 overflow-hidden cursor-pointer hover:opacity-90 transition"
                      onClick={() => handleOpenFile(d)}
                      title={`Preview ${d.filename}`}
                    >
                      <img
                        src={d.url || (d.path ? `file:///${d.path.replace(/\\/g, "/")}` : "")}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLElement).style.display = "none";
                        }}
                      />
                    </div>
                  ) : (
                    <div
                      className={`w-12 h-12 rounded-xl border flex items-center justify-center shrink-0 ${typeColor}`}
                    >
                      <Icon className="w-6 h-6" />
                    </div>
                  )}

                  {/* Main File Information */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p
                        className="text-sm font-semibold text-neutral-100 hover:text-emerald-300 truncate cursor-pointer transition"
                        onClick={() => handleOpenFile(d)}
                        title={`Reveal in File Explorer: ${d.filename}`}
                      >
                        {d.filename}
                      </p>
                      {d.status === "completed" && (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      )}
                    </div>

                    <p className="text-[11px] text-neutral-400 font-mono truncate mb-1.5" title={d.path || d.url}>
                      {d.path || d.url}
                    </p>

                    {/* Progress Bar for active or paused downloads */}
                    {(d.status === "in_progress" || d.status === "paused") && (
                      <div className="flex items-center gap-3 mt-1.5">
                        <div className="flex-1 h-2 rounded-full bg-neutral-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              d.status === "paused"
                                ? "bg-amber-500"
                                : "bg-gradient-to-r from-emerald-500 to-cyan-400"
                            }`}
                            style={{ width: `${Math.max(5, progress)}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-neutral-300 font-mono shrink-0">
                          {formatBytes(d.downloadedBytes)} / {formatBytes(d.size)} · {progress}%
                        </span>
                        {d.speed && d.status === "in_progress" && (
                          <span className="text-[11px] text-cyan-400 font-mono font-semibold shrink-0">
                            {formatBytes(d.speed)}/s
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Status, Size & Date */}
                  <div className="flex items-center gap-3.5 shrink-0">
                    <div className="text-right">
                      <div className="text-xs font-mono font-bold text-neutral-200">
                        {formatBytes(d.size)}
                      </div>
                      <div className="text-[10px] text-neutral-400 font-mono mt-0.5">
                        {formatTimestamp(d.completedAt || d.startedAt)}
                      </div>
                    </div>

                    {/* Status Pill Badge */}
                    <span
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-mono uppercase font-bold tracking-wider border ${
                        d.status === "completed"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                          : d.status === "in_progress"
                          ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/30 animate-pulse"
                          : d.status === "paused"
                          ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                          : "bg-rose-500/15 text-rose-300 border-rose-500/30"
                      }`}
                    >
                      {d.status.replace("_", " ")}
                    </span>
                  </div>

                  {/* Actions Group (Visible on Hover / Focus) */}
                  <div className="flex items-center gap-1.5 opacity-80 group-hover:opacity-100 transition shrink-0 pl-2 border-l border-white/[0.05]">
                    {/* Pause / Resume */}
                    {(d.status === "in_progress" || d.status === "paused") && (
                      <button
                        type="button"
                        onClick={() => handlePauseResume(d)}
                        className="p-2 rounded-xl bg-neutral-900 border border-white/10 hover:border-white/25 text-neutral-300 hover:text-white transition"
                        title={d.status === "paused" ? "Resume Download" : "Pause Download"}
                      >
                        {d.status === "paused" ? <Play className="w-3.5 h-3.5 text-emerald-400" /> : <Pause className="w-3.5 h-3.5 text-amber-400" />}
                      </button>
                    )}

                    {/* Retry failed */}
                    {d.status === "failed" && (
                      <button
                        type="button"
                        onClick={() => onOpenInBrowser?.(d.url, d.filename)}
                        className="p-2 rounded-xl bg-neutral-900 border border-white/10 hover:border-white/25 text-neutral-300 hover:text-white transition"
                        title="Retry download in browser"
                      >
                        <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
                      </button>
                    )}

                    {/* Copy Path / Link */}
                    <button
                      type="button"
                      onClick={() => handleCopyPathOrUrl(d)}
                      className="p-2 rounded-xl bg-neutral-900/60 hover:bg-neutral-800 border border-white/[0.06] hover:border-white/20 text-neutral-400 hover:text-white transition"
                      title="Copy file path or URL"
                    >
                      {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>

                    {/* Reveal in Explorer */}
                    <button
                      type="button"
                      onClick={() => handleOpenFile(d)}
                      className="p-2 rounded-xl bg-neutral-900/60 hover:bg-emerald-500/20 border border-white/[0.06] hover:border-emerald-500/30 text-neutral-400 hover:text-emerald-300 transition"
                      title="Reveal in Windows File Explorer"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </button>

                    {/* Remove from list */}
                    <button
                      type="button"
                      onClick={() => handleDelete(d.id, d.path || d.filename)}
                      className="p-2 rounded-xl bg-neutral-900/60 hover:bg-rose-500/20 border border-white/[0.06] hover:border-rose-500/30 text-neutral-400 hover:text-rose-400 transition"
                      title="Remove from download history"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
