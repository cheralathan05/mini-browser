import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Brain,
  Search,
  Play,
  Video,
  Clock,
  Globe,
  ExternalLink,
  Plus,
  Trash2,
  Pin,
  CheckCircle2,
  Sparkles,
  Layers,
  Filter,
  RefreshCw,
  X,
  Tag,
  ChevronRight,
  ArrowUpRight,
  Zap,
  BarChart3,
  Calendar,
  MessageSquare,
  Send,
  Copy,
  Check,
  Tv,
  Share2,
  Sliders,
  Eye,
  FileText,
  Radio,
  Bookmark,
  Compass,
} from "lucide-react";
import {
  nexusTabIntelligence,
  TabActivityRecord,
  PlatformInfo,
  ActionType,
  KNOWN_PLATFORMS,
  formatDuration,
} from "../../lib/nexus/nexus-tab-intelligence";
import { nexusClient } from "../../lib/nexus/nexus-client";
import { useToast } from "./NexusToast";

interface NexusMemoryViewProps {
  onOpenInBrowser?: (url: string, title?: string) => void;
  workspaceId?: string | null;
}

type ViewMode = "timeline" | "mesh" | "platforms" | "analytics";

// ============================================================================
// Platform Brand Helpers
// ============================================================================

function getPlatformBadge(platform: PlatformInfo, action: ActionType) {
  const isWatch = action === "watch";
  const isSearch = action === "search";

  let Icon = Globe;
  if (platform.id === "youtube" || isWatch) Icon = Play;
  else if (isSearch) Icon = Search;

  return {
    Icon,
    bg: platform.badgeBg,
    border: platform.badgeBorder,
    color: platform.textColor,
    brandColor: platform.brandColor,
    name: platform.name,
  };
}

// ============================================================================
// Interactive Canvas Knowledge Graph
// ============================================================================

interface SimNode {
  id: string;
  label: string;
  type: "platform" | "search" | "watch" | "visit";
  color: string;
  radius: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  record?: TabActivityRecord;
}

interface SimEdge {
  source: string;
  target: string;
  color: string;
}

const KnowledgeMeshCanvas: React.FC<{
  records: TabActivityRecord[];
  selectedId: string | null;
  onSelectRecord: (record: TabActivityRecord) => void;
}> = ({ records, selectedId, onSelectRecord }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const edgesRef = useRef<SimEdge[]>([]);

  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null);
  const isDraggingRef = useRef(false);
  const dragNodeRef = useRef<SimNode | null>(null);
  const isPanningRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });

  // Build graph from records
  useEffect(() => {
    const width = 850;
    const height = 480;

    // Platform hubs
    const platformsMap = new Map<string, SimNode>();
    const nodes: SimNode[] = [];
    const edges: SimEdge[] = [];

    // Distinct platforms
    const uniquePlatforms = Array.from(new Set(records.map((r) => r.platform.id)));
    const platAngleStep = (Math.PI * 2) / Math.max(1, uniquePlatforms.length);

    uniquePlatforms.forEach((platId, idx) => {
      const platObj = KNOWN_PLATFORMS[platId] || records.find((r) => r.platform.id === platId)?.platform;
      const angle = idx * platAngleStep;
      const dist = 140;
      const pNode: SimNode = {
        id: `hub-${platId}`,
        label: platObj?.name || platId,
        type: "platform",
        color: platObj?.brandColor || "#818cf8",
        radius: 20,
        x: width / 2 + Math.cos(angle) * dist,
        y: height / 2 + Math.sin(angle) * dist,
        vx: 0,
        vy: 0,
      };
      platformsMap.set(platId, pNode);
      nodes.push(pNode);
    });

    // Activity items (up to 40 for clean render)
    const items = records.slice(0, 40);
    items.forEach((record, i) => {
      const pHub = platformsMap.get(record.platform.id);
      const angle = (i * 0.4) + Math.random() * 0.2;
      const dist = 80 + Math.random() * 80;
      const originX = pHub ? pHub.x : width / 2;
      const originY = pHub ? pHub.y : height / 2;

      const actColor =
        record.action === "search"
          ? "#38bdf8"
          : record.action === "watch"
          ? "#ef4444"
          : "#a855f7";

      const node: SimNode = {
        id: record.id,
        label: record.query || record.title,
        type: record.action as any,
        color: actColor,
        radius: record.action === "watch" ? 14 : record.action === "search" ? 13 : 10,
        x: originX + Math.cos(angle) * dist,
        y: originY + Math.sin(angle) * dist,
        vx: 0,
        vy: 0,
        record,
      };

      nodes.push(node);

      if (pHub) {
        edges.push({
          source: pHub.id,
          target: node.id,
          color: pHub.color,
        });
      }
    });

    nodesRef.current = nodes;
    edgesRef.current = edges;
  }, [records]);

  // Simulation physics loop
  useEffect(() => {
    let active = true;

    const tick = () => {
      if (!active) return;
      const canvas = canvasRef.current;
      if (!canvas) {
        animRef.current = requestAnimationFrame(tick);
        return;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        animRef.current = requestAnimationFrame(tick);
        return;
      }

      const width = canvas.width;
      const height = canvas.height;
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const nodeMap = new Map<string, SimNode>();
      for (const n of nodes) nodeMap.set(n.id, n);

      // Repulsion
      for (let i = 0; i < nodes.length; i++) {
        const n1 = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const n2 = nodes[j];
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          if (dist < 180) {
            const force = (180 - dist) / (dist * 20);
            const fx = dx * force;
            const fy = dy * force;
            if (n1 !== dragNodeRef.current) {
              n1.vx -= fx;
              n1.vy -= fy;
            }
            if (n2 !== dragNodeRef.current) {
              n2.vx += fx;
              n2.vy += fy;
            }
          }
        }
      }

      // Edge spring attraction
      for (const edge of edges) {
        const source = nodeMap.get(edge.source);
        const target = nodeMap.get(edge.target);
        if (!source || !target) continue;

        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const targetDist = 90;
        const spring = (dist - targetDist) * 0.02;

        const fx = (dx / dist) * spring;
        const fy = (dy / dist) * spring;

        if (source !== dragNodeRef.current) {
          source.vx += fx;
          source.vy += fy;
        }
        if (target !== dragNodeRef.current) {
          target.vx -= fx;
          target.vy -= fy;
        }
      }

      // Centering & damping
      const cx = width / 2;
      const cy = height / 2;
      for (const n of nodes) {
        if (n === dragNodeRef.current) continue;
        n.vx += (cx - n.x) * 0.002;
        n.vy += (cy - n.y) * 0.002;
        n.vx *= 0.88;
        n.vy *= 0.88;
        n.x += n.vx;
        n.y += n.vy;
        n.x = Math.max(30, Math.min(width - 30, n.x));
        n.y = Math.max(30, Math.min(height - 30, n.y));
      }

      // Render
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(offset.x, offset.y);
      ctx.scale(zoom, zoom);

      // Grid
      ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
      ctx.lineWidth = 1;
      const gridSize = 40;
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Draw Edges
      for (const edge of edges) {
        const source = nodeMap.get(edge.source);
        const target = nodeMap.get(edge.target);
        if (!source || !target) continue;

        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.strokeStyle = edge.color + "33";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // Draw Nodes
      for (const node of nodes) {
        const isSelected = selectedId === node.id;
        const isHovered = hoveredNode?.id === node.id;

        ctx.save();

        // Glow
        if (isSelected || isHovered || node.type === "platform") {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.radius + 8, 0, Math.PI * 2);
          ctx.fillStyle = node.color + "33";
          ctx.fill();
        }

        // Circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = node.color;
        ctx.fill();
        ctx.strokeStyle = isSelected ? "#ffffff" : node.color + "aa";
        ctx.lineWidth = isSelected ? 2.5 : 1;
        ctx.stroke();

        // Label
        ctx.font = node.type === "platform" ? "bold 11px Inter, sans-serif" : "10px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const shortLabel = node.label.length > 18 ? node.label.slice(0, 16) + "…" : node.label;

        // Label background pill
        const tw = ctx.measureText(shortLabel).width;
        ctx.fillStyle = "rgba(10, 12, 20, 0.85)";
        ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
        ctx.beginPath();
        ctx.roundRect(node.x - tw / 2 - 4, node.y + node.radius + 4, tw + 8, 15, 3);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = isSelected ? "#ffffff" : "#cbd5e1";
        ctx.fillText(shortLabel, node.x, node.y + node.radius + 5);

        ctx.restore();
      }

      ctx.restore();
      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => {
      active = false;
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [offset, zoom, hoveredNode, selectedId]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left - offset.x) / zoom;
    const my = (e.clientY - rect.top - offset.y) / zoom;

    for (const node of nodesRef.current) {
      const dx = mx - node.x;
      const dy = my - node.y;
      if (Math.sqrt(dx * dx + dy * dy) <= node.radius + 4) {
        dragNodeRef.current = node;
        isDraggingRef.current = true;
        if (node.record) {
          onSelectRecord(node.record);
        }
        return;
      }
    }

    isPanningRef.current = true;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left - offset.x) / zoom;
    const my = (e.clientY - rect.top - offset.y) / zoom;

    if (isDraggingRef.current && dragNodeRef.current) {
      dragNodeRef.current.x = mx;
      dragNodeRef.current.y = my;
      dragNodeRef.current.vx = 0;
      dragNodeRef.current.vy = 0;
      return;
    }

    if (isPanningRef.current) {
      const dx = e.clientX - lastMouseRef.current.x;
      const dy = e.clientY - lastMouseRef.current.y;
      setOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    let found: SimNode | null = null;
    for (const node of nodesRef.current) {
      const dx = mx - node.x;
      const dy = my - node.y;
      if (Math.sqrt(dx * dx + dy * dy) <= node.radius + 4) {
        found = node;
        break;
      }
    }
    setHoveredNode(found);
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
    dragNodeRef.current = null;
    isPanningRef.current = false;
  };

  return (
    <div className="relative w-full h-[480px] bg-[#070913] rounded-2xl border border-white/10 overflow-hidden shadow-2xl group">
      <canvas
        ref={canvasRef}
        width={960}
        height={480}
        className="w-full h-full cursor-grab active:cursor-grabbing block"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={(e) => {
          e.preventDefault();
          const factor = e.deltaY < 0 ? 1.08 : 0.92;
          setZoom((z) => Math.max(0.5, Math.min(2.2, z * factor)));
        }}
      />

      {/* Canvas HUD Controls */}
      <div className="absolute top-4 right-4 flex items-center gap-1.5 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 shadow-lg">
        <button
          onClick={() => setZoom((z) => Math.min(2.2, z * 1.15))}
          className="p-1 text-slate-400 hover:text-white rounded hover:bg-white/10 transition"
          title="Zoom In"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(0.5, z * 0.85))}
          className="p-1 text-slate-400 hover:text-white rounded hover:bg-white/10 transition text-xs font-bold leading-none"
          title="Zoom Out"
        >
          −
        </button>
        <div className="w-[1px] h-3 bg-white/10 mx-1" />
        <button
          onClick={() => {
            setZoom(1);
            setOffset({ x: 0, y: 0 });
          }}
          className="p-1 text-slate-400 hover:text-white rounded hover:bg-white/10 transition text-[11px] font-mono"
          title="Reset View"
        >
          {Math.round(zoom * 100)}%
        </button>
      </div>

      {/* Legend Badge */}
      <div className="absolute top-4 left-4 flex items-center gap-3 bg-black/60 backdrop-blur-md px-3.5 py-1.5 rounded-xl border border-white/10 text-xs text-slate-300">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#38bdf8]" />
          <span>Searches</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ef4444]" />
          <span>Watched Media</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#818cf8]" />
          <span>Platforms</span>
        </div>
      </div>

      {/* Tooltip */}
      {hoveredNode && (
        <div
          className="absolute bottom-4 left-4 bg-slate-950/95 backdrop-blur-md px-4 py-2.5 rounded-xl border border-white/15 shadow-2xl pointer-events-none flex items-center gap-3 animate-in fade-in zoom-in-95 duration-150"
          style={{ borderColor: hoveredNode.color }}
        >
          <div className="w-3 h-3 rounded-full shadow-sm shrink-0" style={{ backgroundColor: hoveredNode.color }} />
          <div>
            <div className="text-xs font-semibold text-white truncate max-w-sm">{hoveredNode.label}</div>
            <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
              <span className="uppercase font-mono tracking-wide">{hoveredNode.type}</span>
              {hoveredNode.record?.formattedTime && (
                <>
                  <span>•</span>
                  <span>{hoveredNode.record.formattedTime}</span>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT: NEXUS MEMORY VIEW
// ============================================================================

export const NexusMemoryView: React.FC<NexusMemoryViewProps> = ({
  onOpenInBrowser,
  workspaceId,
}) => {
  const toast = useToast();

  // Core records from tab intelligence engine
  const [records, setRecords] = useState<TabActivityRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<TabActivityRecord | null>(null);

  // Filters & views
  const [viewMode, setViewMode] = useState<ViewMode>("timeline");
  const [actionFilter, setActionFilter] = useState<"all" | "search" | "watch">("all");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filterPinned, setFilterPinned] = useState<boolean>(false);

  // Modals & inputs
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [memTitle, setMemTitle] = useState<string>("");
  const [memType, setMemType] = useState<string>("FACT");
  const [memCategory, setMemCategory] = useState<string>("General");
  const [memContent, setMemContent] = useState<string>("");
  const [memUrl, setMemUrl] = useState<string>("");
  const [memImportance, setMemImportance] = useState<number>(0.8);
  const [memTags, setMemTags] = useState<string>("");
  const [isSubmittingMem, setIsSubmittingMem] = useState<boolean>(false);
  const [newNoteInput, setNewNoteInput] = useState<string>("");
  const [isSyncingHistory, setIsSyncingHistory] = useState<boolean>(false);

  // Subscribe to real-time tab intelligence engine
  useEffect(() => {
    const unsub = nexusTabIntelligence.subscribe((newRecords) => {
      setRecords(newRecords);
      // If current selected record is updated, refresh it
      if (selectedRecord) {
        const found = newRecords.find((r) => r.id === selectedRecord.id);
        if (found) setSelectedRecord(found);
      }
    });

    return () => unsub();
  }, [selectedRecord?.id]);

  // Initial browser history & backend PostgreSQL memory sync
  const handleSyncHistory = async () => {
    setIsSyncingHistory(true);
    try {
      const histCount = await nexusTabIntelligence.syncFromBrowserHistory();
      const backendCount = await nexusTabIntelligence.syncFromBackend();
      const total = histCount + backendCount;
      if (total > 0) {
        toast.success(`Synced ${total} records from history & PostgreSQL vault!`);
      } else {
        toast.info("Knowledge vault is already up-to-date.");
      }
    } catch {
      toast.error("Could not sync vault records.");
    } finally {
      setIsSyncingHistory(false);
    }
  };

  // Add real memory directly to PostgreSQL backend
  const handleAddMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memContent.trim()) {
      toast.error("Memory content or key details are required.");
      return;
    }

    setIsSubmittingMem(true);
    try {
      const titleToUse = memTitle.trim() || memContent.trim().slice(0, 50);
      const res = await nexusClient.createMemory({
        workspaceId: workspaceId || undefined,
        title: titleToUse,
        key: titleToUse,
        type: memType,
        category: memCategory.trim() || "General",
        content: memContent.trim(),
        summary: memContent.trim().slice(0, 180),
        sourceUrl: memUrl.trim() || undefined,
        sourceType: memUrl.trim() ? (memType === "RESEARCH" ? "DOCUMENT" : "WEB") : "MANUAL",
        importance: Number(memImportance) || 0.8,
        tags: memTags
          ? memTags.split(",").map((t) => t.trim()).filter(Boolean)
          : [memType.toLowerCase(), (memCategory || "general").toLowerCase()],
      });

      if (res?.memory) {
        toast.success(`Saved "${titleToUse}" to PostgreSQL Vault!`);
        if (memUrl.trim()) {
          const actionType: ActionType =
            memType === "RESEARCH" ? "search" : memUrl.includes("youtube.com") ? "watch" : "visit";
          nexusTabIntelligence.recordNavigation(memUrl.trim(), titleToUse, undefined, actionType);
        }
        await nexusTabIntelligence.syncFromBackend();
        setShowAddModal(false);
        setMemTitle("");
        setMemContent("");
        setMemUrl("");
        setMemTags("");
      } else {
        toast.error("Failed to save memory to backend.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to create memory.");
    } finally {
      setIsSubmittingMem(false);
    }
  };

  // Add note to selected record
  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRecord || !newNoteInput.trim()) return;
    nexusTabIntelligence.addNote(selectedRecord.id, newNoteInput.trim());
    setNewNoteInput("");
    toast.success("Note added to memory record");
  };

  // Metrics calculation
  const totalSearches = useMemo(() => records.filter((r) => r.action === "search").length, [records]);
  const totalWatches = useMemo(() => records.filter((r) => r.action === "watch").length, [records]);
  const totalDuration = useMemo(
    () => records.reduce((acc, r) => acc + (r.durationSeconds || 0), 0),
    [records]
  );
  const uniquePlatformsCount = useMemo(
    () => new Set(records.map((r) => r.platform.id)).size,
    [records]
  );
  const vaultIntegrity = useMemo(() => {
    if (records.length === 0) return 100;
    const verifiedCount = records.filter((r) => r.isVerified).length;
    const pinnedCount = records.filter((r) => r.isPinned).length;
    const notesCount = records.filter((r) => (r.notes?.length || 0) > 0).length;
    const base = Math.round((verifiedCount / records.length) * 80);
    const bonus = Math.min(20, (pinnedCount + notesCount) * 2);
    return Math.min(100, Math.max(50, base + bonus));
  }, [records]);

  // Filtered timeline records
  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (actionFilter !== "all" && r.action !== actionFilter) return false;
      if (platformFilter !== "all" && r.platform.id !== platformFilter) return false;
      if (filterPinned && !r.isPinned) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = r.title.toLowerCase().includes(q);
        const matchQuery = (r.query || "").toLowerCase().includes(q);
        const matchUrl = r.url.toLowerCase().includes(q);
        const matchPlat = r.platform.name.toLowerCase().includes(q);
        return matchTitle || matchQuery || matchUrl || matchPlat;
      }
      return true;
    });
  }, [records, actionFilter, platformFilter, filterPinned, searchQuery]);

  // Group by Date for Timeline
  const groupedTimeline = useMemo(() => {
    const groups: Record<string, TabActivityRecord[]> = {};
    const todayStr = new Date().toLocaleDateString();
    const yesterday = new Date(Date.now() - 86400000).toLocaleDateString();

    filteredRecords.forEach((rec) => {
      const recDate = new Date(rec.timestamp).toLocaleDateString();
      let key = recDate;
      if (recDate === todayStr) key = "Today";
      else if (recDate === yesterday) key = "Yesterday";

      if (!groups[key]) groups[key] = [];
      groups[key].push(rec);
    });

    return groups;
  }, [filteredRecords]);

  // Platform breakdown stats
  const platformStats = useMemo(() => {
    const stats: Record<string, { platform: PlatformInfo; searches: number; watches: number; latest: number }> = {};

    records.forEach((r) => {
      const pid = r.platform.id;
      if (!stats[pid]) {
        stats[pid] = {
          platform: r.platform,
          searches: 0,
          watches: 0,
          latest: r.timestamp,
        };
      }
      if (r.action === "search") stats[pid].searches += 1;
      if (r.action === "watch") stats[pid].watches += 1;
      if (r.timestamp > stats[pid].latest) stats[pid].latest = r.timestamp;
    });

    return Object.values(stats).sort((a, b) => b.searches + b.watches - (a.searches + a.watches));
  }, [records]);

  return (
    <div className="flex flex-col h-full w-full bg-[#060810] text-slate-100 select-none overflow-hidden font-sans">
      {/* ══════════════════════════════════════════════════════════════════════
          TOP HEADER & VAULT STATUS BAR
      ══════════════════════════════════════════════════════════════════════ */}
      <header className="flex items-center justify-between px-6 py-3.5 border-b border-white/10 bg-[#090d1a]/80 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-600/30">
            <Brain className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-base font-bold text-white tracking-wide flex items-center gap-2">
                <span>NEXUS VAULT</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-gradient-to-r from-purple-500/20 to-indigo-500/20 text-purple-300 border border-purple-500/30 uppercase tracking-widest font-mono">
                  Active Intelligence Core
                </span>
              </h1>
            </div>
            <p className="text-xs text-slate-400">
              Universal Search & Watch Intelligence · Real-time tab interception & temporal memory
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Live Tab Interceptor Badge */}
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-400 text-xs">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="font-semibold tracking-wide">Live Tab Interceptor Online</span>
          </div>

          {/* Sync History Button */}
          <button
            onClick={handleSyncHistory}
            disabled={isSyncingHistory}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-xs text-slate-200 transition-all shadow-sm"
            title="Scan open tabs and Milo history to auto-populate the vault"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-indigo-400 ${isSyncingHistory ? "animate-spin" : ""}`} />
            <span>Sync History</span>
          </button>

          {/* Add Memory Button */}
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Memory</span>
          </button>
        </div>
      </header>

      {/* ══════════════════════════════════════════════════════════════════════
          TOP STATS DECK (5 Cards)
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4 border-b border-white/5 bg-[#070a14]/60 shrink-0">
        {/* Card 1: Total Searches */}
        <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:border-cyan-500/30 transition-all">
          <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
            <Search className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-lg font-bold text-white tracking-tight">{totalSearches}</div>
            <div className="text-[11px] text-slate-400 truncate">Searches Captured</div>
          </div>
        </div>

        {/* Card 2: Videos Watched */}
        <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:border-red-500/30 transition-all">
          <div className="w-9 h-9 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-400 shrink-0">
            <Play className="w-4 h-4 fill-current" />
          </div>
          <div className="min-w-0">
            <div className="text-lg font-bold text-white tracking-tight">{totalWatches}</div>
            <div className="text-[11px] text-slate-400 truncate">Videos Watched</div>
          </div>
        </div>

        {/* Card 3: Watch Time */}
        <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:border-purple-500/30 transition-all">
          <div className="w-9 h-9 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0">
            <Clock className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-lg font-bold text-white tracking-tight">
              {formatDuration(totalDuration)}
            </div>
            <div className="text-[11px] text-slate-400 truncate">Total Time Spent</div>
          </div>
        </div>

        {/* Card 4: Platforms Monitored */}
        <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:border-amber-500/30 transition-all">
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
            <Compass className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-lg font-bold text-white tracking-tight">{uniquePlatformsCount}</div>
            <div className="text-[11px] text-slate-400 truncate">Active Platforms</div>
          </div>
        </div>

        {/* Card 5: Knowledge Density / Health */}
        <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:border-emerald-500/30 transition-all col-span-2 md:col-span-1">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-lg font-bold text-white tracking-tight">{vaultIntegrity}/100</div>
            <div className="text-[11px] text-slate-400 truncate">Vault Integrity</div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          VIEW SWITCHER & FILTER CONTROLS BAR
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5 border-b border-white/5 bg-[#090c17] shrink-0">
        {/* Left: View Mode Tabs */}
        <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-white/5">
          {[
            { id: "timeline", label: "Search & Watch Stream", icon: Clock },
            { id: "mesh", label: "Neural Mesh", icon: Share2 },
            { id: "platforms", label: "Platform Matrix", icon: Globe },
            { id: "analytics", label: "Time Intelligence", icon: BarChart3 },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setViewMode(id as ViewMode)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                viewMode === id
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30 font-semibold"
                  : "text-slate-400 hover:text-white hover:bg-white/[0.04]"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* Right: Quick Search Input & Filters */}
        <div className="flex items-center gap-2 flex-1 max-w-md justify-end">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search queries, videos, channels..."
              className="w-full bg-white/[0.05] border border-white/10 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2.5 text-slate-500 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button
            onClick={() => setFilterPinned(!filterPinned)}
            className={`p-2 rounded-xl border text-xs transition-all ${
              filterPinned
                ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                : "bg-white/[0.04] text-slate-400 border-white/5 hover:text-white"
            }`}
            title="Show Pinned Memories Only"
          >
            <Pin className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          MAIN WORKSPACE VIEW AREA + DETAIL INSPECTOR
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left / Center View Area */}
        <div className="flex-1 flex flex-col overflow-y-auto custom-scrollbar p-6 bg-[#060812]">
          {/* VIEW 1: TIMELINE STREAM (Primary) */}
          {viewMode === "timeline" && (
            <div className="max-w-4xl mx-auto w-full space-y-6">
              {/* Category Pills Filter */}
              <div className="flex flex-wrap items-center gap-1.5 pb-2">
                <button
                  onClick={() => {
                    setActionFilter("all");
                    setPlatformFilter("all");
                  }}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    actionFilter === "all" && platformFilter === "all"
                      ? "bg-white text-slate-900 font-bold"
                      : "bg-white/[0.05] text-slate-400 hover:text-white border border-white/5"
                  }`}
                >
                  All ({records.length})
                </button>

                <button
                  onClick={() => {
                    setActionFilter("search");
                    setPlatformFilter("all");
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    actionFilter === "search" && platformFilter === "all"
                      ? "bg-cyan-500 text-white font-bold"
                      : "bg-cyan-500/10 text-cyan-300 border border-cyan-500/25 hover:bg-cyan-500/20"
                  }`}
                >
                  <Search className="w-3 h-3" />
                  <span>Searches ({totalSearches})</span>
                </button>

                <button
                  onClick={() => {
                    setActionFilter("watch");
                    setPlatformFilter("all");
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    actionFilter === "watch" && platformFilter === "all"
                      ? "bg-red-600 text-white font-bold"
                      : "bg-red-500/10 text-red-300 border border-red-500/25 hover:bg-red-500/20"
                  }`}
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span>Watched Media ({totalWatches})</span>
                </button>

                <div className="w-[1px] h-4 bg-white/10 mx-1" />

                {/* Popular platform quick tags */}
                {["google", "youtube", "github", "reddit", "twitter"].map((platId) => {
                  const plat = KNOWN_PLATFORMS[platId];
                  if (!plat) return null;
                  const isAct = platformFilter === platId;
                  return (
                    <button
                      key={platId}
                      onClick={() => {
                        setPlatformFilter(isAct ? "all" : platId);
                        setActionFilter("all");
                      }}
                      className={`px-2.5 py-1 rounded-full text-xs transition-all ${
                        isAct
                          ? "bg-indigo-600 text-white font-semibold"
                          : "bg-white/[0.04] text-slate-400 hover:text-white border border-white/5"
                      }`}
                    >
                      {plat.name.split(" ")[0]}
                    </button>
                  );
                })}
              </div>

              {/* Empty State */}
              {filteredRecords.length === 0 && (
                <div className="py-20 text-center flex flex-col items-center justify-center">
                  <div className="w-16 h-16 rounded-3xl bg-white/[0.04] border border-white/10 flex items-center justify-center text-slate-500 mb-4">
                    <Search className="w-7 h-7" />
                  </div>
                  <h3 className="text-base font-bold text-white">No Search or Watch Activity Found</h3>
                  <p className="text-xs text-slate-400 max-w-sm mt-1">
                    Open tabs in the browser, search on Google, or watch YouTube videos. They will be automatically captured here!
                  </p>
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="mt-4 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Knowledge Memory</span>
                  </button>
                </div>
              )}

              {/* Grouped Chronological Timeline Feed */}
              {Object.entries(groupedTimeline).map(([groupDate, items]) => (
                <div key={groupDate} className="space-y-3">
                  <div className="flex items-center gap-2 px-1">
                    <Calendar className="w-3.5 h-3.5 text-indigo-400" />
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      {groupDate}
                    </h2>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-400 font-mono">
                      {items.length} {items.length === 1 ? "activity" : "activities"}
                    </span>
                    <div className="flex-1 h-[1px] bg-white/[0.06] ml-2" />
                  </div>

                  <div className="space-y-2.5">
                    {items.map((record) => {
                      const badge = getPlatformBadge(record.platform, record.action);
                      const isSelected = selectedRecord?.id === record.id;
                      const Icon = badge.Icon;

                      return (
                        <div
                          key={record.id}
                          onClick={() => setSelectedRecord(record)}
                          className={`group relative flex flex-col md:flex-row md:items-center justify-between gap-3.5 p-4 rounded-2xl border transition-all cursor-pointer ${
                            isSelected
                              ? "bg-[#131728] border-indigo-500/60 shadow-lg shadow-indigo-600/10 ring-1 ring-indigo-500/40"
                              : "bg-[#0b0f1d]/80 hover:bg-[#101426] border-white/5 hover:border-white/15"
                          }`}
                        >
                          <div className="flex items-start gap-3.5 min-w-0">
                            {/* Platform Icon Badge */}
                            <div
                              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border shadow-inner transition-transform group-hover:scale-105"
                              style={{
                                backgroundColor: badge.bg,
                                borderColor: badge.border,
                                color: badge.brandColor,
                              }}
                            >
                              <Icon className="w-5 h-5" />
                            </div>

                            {/* Main Details */}
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className="text-[11px] font-bold px-2 py-0.5 rounded-md border"
                                  style={{
                                    backgroundColor: badge.bg,
                                    borderColor: badge.border,
                                    color: badge.color,
                                  }}
                                >
                                  {badge.name}
                                </span>

                                <span
                                  className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-md font-bold ${
                                    record.action === "search"
                                      ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
                                      : record.action === "watch"
                                      ? "bg-red-500/15 text-red-300 border border-red-500/30"
                                      : "bg-purple-500/15 text-purple-300 border border-purple-500/30"
                                  }`}
                                >
                                  {record.action === "search" ? "Search Query" : record.action === "watch" ? "Video Watched" : "Visited"}
                                </span>

                                {record.durationSeconds && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-purple-900/30 text-purple-300 border border-purple-500/20 font-mono">
                                    ⏱️ {formatDuration(record.durationSeconds)}
                                  </span>
                                )}

                                <span className="text-[11px] text-slate-500 ml-auto md:ml-0">
                                  {record.formattedTime} · {record.timeAgo}
                                </span>
                              </div>

                              {/* Title / Query */}
                              <h3 className="text-sm font-bold text-white mt-1.5 truncate group-hover:text-indigo-300 transition-colors">
                                {record.query ? `"${record.query}"` : record.title}
                              </h3>

                              {/* URL snippet */}
                              <div className="text-xs text-slate-400 mt-0.5 truncate flex items-center gap-1.5">
                                <Globe className="w-3 h-3 text-slate-500 shrink-0" />
                                <span className="truncate">{record.url}</span>
                              </div>
                            </div>
                          </div>

                          {/* Right Controls */}
                          <div className="flex items-center gap-1.5 shrink-0 self-end md:self-center">
                            {/* Open Tab */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (onOpenInBrowser) {
                                  onOpenInBrowser(record.url, record.title);
                                } else {
                                  window.open(record.url, "_blank");
                                }
                              }}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-white text-xs font-semibold border border-white/10 transition-all shadow-sm"
                              title="Open in Tab"
                            >
                              <ExternalLink className="w-3 h-3 text-indigo-400" />
                              <span>Open</span>
                            </button>

                            {/* Pin Toggle */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                nexusTabIntelligence.togglePin(record.id);
                              }}
                              className={`p-1.5 rounded-xl border transition-all ${
                                record.isPinned
                                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                                  : "bg-white/[0.04] text-slate-400 border-white/5 hover:text-white"
                              }`}
                              title={record.isPinned ? "Unpin from Vault" : "Pin to Vault"}
                            >
                              <Pin className="w-3.5 h-3.5" />
                            </button>

                            {/* Delete */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                nexusTabIntelligence.deleteRecord(record.id);
                                if (selectedRecord?.id === record.id) setSelectedRecord(null);
                              }}
                              className="p-1.5 rounded-xl bg-white/[0.04] hover:bg-red-500/20 text-slate-400 hover:text-red-400 border border-white/5 hover:border-red-500/30 transition-all"
                              title="Delete Record"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* VIEW 2: NEURAL KNOWLEDGE MESH */}
          {viewMode === "mesh" && (
            <div className="flex-1 flex flex-col space-y-4 max-w-5xl mx-auto w-full">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-white">Neural Knowledge Mesh</h2>
                  <p className="text-xs text-slate-400">
                    Interactive topology connecting your search queries, watched video hubs, and platforms.
                  </p>
                </div>
                <span className="text-xs text-slate-400 font-mono">
                  {records.length} Nodes Connected
                </span>
              </div>

              <KnowledgeMeshCanvas
                records={records}
                selectedId={selectedRecord?.id || null}
                onSelectRecord={(rec) => setSelectedRecord(rec)}
              />
            </div>
          )}

          {/* VIEW 3: PLATFORM MATRIX */}
          {viewMode === "platforms" && (
            <div className="max-w-4xl mx-auto w-full space-y-6">
              <div>
                <h2 className="text-base font-bold text-white">Monitored Platform Matrix</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Deep breakdown of searches, media streaming, and dwell time across all platforms.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {platformStats.map(({ platform, searches, watches, latest }) => (
                  <div
                    key={platform.id}
                    onClick={() => {
                      setPlatformFilter(platform.id);
                      setViewMode("timeline");
                    }}
                    className="p-5 rounded-2xl bg-[#0b0f1d] border border-white/5 hover:border-white/20 transition-all cursor-pointer group shadow-lg"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center border shadow-inner"
                          style={{
                            backgroundColor: platform.badgeBg,
                            borderColor: platform.badgeBorder,
                            color: platform.brandColor,
                          }}
                        >
                          <Globe className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-white group-hover:text-indigo-400 transition-colors">
                            {platform.name}
                          </h3>
                          <span className="text-xs text-slate-400">{platform.domain}</span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-white transition-transform group-hover:translate-x-1" />
                    </div>

                    <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-black/40 border border-white/5 text-center">
                      <div>
                        <div className="text-base font-bold text-white">{searches}</div>
                        <div className="text-[10px] text-slate-400">Searches</div>
                      </div>
                      <div>
                        <div className="text-base font-bold text-white">{watches}</div>
                        <div className="text-[10px] text-slate-400">Videos Watched</div>
                      </div>
                      <div>
                        <div className="text-base font-bold text-indigo-400">{searches + watches}</div>
                        <div className="text-[10px] text-slate-400">Total Visits</div>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
                      <span>Last searched / watched:</span>
                      <span className="text-slate-300 font-medium">
                        {new Date(latest).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* VIEW 4: TIME INTELLIGENCE & ANALYTICS */}
          {viewMode === "analytics" && (
            <div className="max-w-4xl mx-auto w-full space-y-6">
              <div>
                <h2 className="text-base font-bold text-white">Temporal Search & Watch Intelligence</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Pattern analysis of when you search, what platforms you use most, and content topics.
                </p>
              </div>

              {/* Time of Day Distribution */}
              <div className="p-6 rounded-2xl bg-[#0b0f1d] border border-white/5 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Search & Watch Activity by Hour of Day
                </h3>
                <div className="grid grid-cols-4 gap-3 text-center">
                  {[
                    { label: "Morning (6 AM - 12 PM)", count: records.filter((r) => new Date(r.timestamp).getHours() >= 6 && new Date(r.timestamp).getHours() < 12).length },
                    { label: "Afternoon (12 PM - 5 PM)", count: records.filter((r) => new Date(r.timestamp).getHours() >= 12 && new Date(r.timestamp).getHours() < 17).length },
                    { label: "Evening (5 PM - 10 PM)", count: records.filter((r) => new Date(r.timestamp).getHours() >= 17 && new Date(r.timestamp).getHours() < 22).length },
                    { label: "Night (10 PM - 6 AM)", count: records.filter((r) => new Date(r.timestamp).getHours() >= 22 || new Date(r.timestamp).getHours() < 6).length },
                  ].map((period) => (
                    <div key={period.label} className="p-4 rounded-xl bg-white/[0.03] border border-white/5">
                      <div className="text-2xl font-bold text-indigo-400">{period.count}</div>
                      <div className="text-[11px] text-slate-400 mt-1">{period.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Top Search Queries Cloud */}
              <div className="p-6 rounded-2xl bg-[#0b0f1d] border border-white/5 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Recent Search Queries & Explored Topics
                </h3>
                <div className="flex flex-wrap gap-2">
                  {records
                    .filter((r) => r.query)
                    .slice(0, 20)
                    .map((r) => (
                      <span
                        key={r.id}
                        onClick={() => {
                          setSelectedRecord(r);
                          setViewMode("timeline");
                        }}
                        className="px-3 py-1 rounded-xl bg-white/[0.05] hover:bg-indigo-600/30 text-xs text-slate-200 border border-white/10 hover:border-indigo-500/40 cursor-pointer transition-all"
                      >
                        🔍 "{r.query}"
                      </span>
                    ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            RIGHT DETAIL INSPECTOR DRAWER
        ══════════════════════════════════════════════════════════════════════ */}
        {selectedRecord && (
          <aside className="w-[360px] bg-[#090d1c] border-l border-white/10 flex flex-col h-full overflow-y-auto custom-scrollbar shadow-2xl animate-in slide-in-from-right duration-200 shrink-0">
            {/* Inspector Header */}
            <div className="p-5 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-white">Record Inspector</h3>
              </div>
              <button
                onClick={() => setSelectedRecord(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content Details */}
            <div className="p-5 space-y-5 flex-1">
              {/* Platform & Action Pill */}
              <div className="flex items-center gap-2">
                <span
                  className="text-xs font-bold px-3 py-1 rounded-lg border"
                  style={{
                    backgroundColor: selectedRecord.platform.badgeBg,
                    borderColor: selectedRecord.platform.badgeBorder,
                    color: selectedRecord.platform.textColor,
                  }}
                >
                  {selectedRecord.platform.name}
                </span>

                <span
                  className={`text-[10px] font-mono font-bold uppercase px-2.5 py-1 rounded-lg ${
                    selectedRecord.action === "search"
                      ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
                      : selectedRecord.action === "watch"
                      ? "bg-red-500/15 text-red-300 border border-red-500/30"
                      : "bg-purple-500/15 text-purple-300 border border-purple-500/30"
                  }`}
                >
                  {selectedRecord.action}
                </span>
              </div>

              {/* Title / Query */}
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                  {selectedRecord.action === "search" ? "Search Query" : "Content Title"}
                </label>
                <h4 className="text-base font-bold text-white mt-1 leading-snug break-words">
                  {selectedRecord.query ? `"${selectedRecord.query}"` : selectedRecord.title}
                </h4>
              </div>

              {/* Exact Time & Date Card */}
              <div className="p-4 rounded-xl bg-white/[0.03] border border-white/5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Exact Time:</span>
                  <span className="text-white font-mono font-bold">{selectedRecord.formattedTime}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Date:</span>
                  <span className="text-white">{selectedRecord.formattedDate}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Relative:</span>
                  <span className="text-indigo-400 font-medium">{selectedRecord.timeAgo}</span>
                </div>
                {selectedRecord.durationSeconds && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Duration Watched:</span>
                    <span className="text-purple-400 font-mono font-semibold">
                      {formatDuration(selectedRecord.durationSeconds)}
                    </span>
                  </div>
                )}
              </div>

              {/* Target URL */}
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                  Destination URL
                </label>
                <div className="mt-1 p-3 rounded-xl bg-black/50 border border-white/10 break-all text-xs text-slate-300 flex items-start gap-2">
                  <span className="flex-1 font-mono text-[11px] leading-relaxed">{selectedRecord.url}</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(selectedRecord.url);
                      toast.success("URL copied to clipboard");
                    }}
                    className="p-1 text-slate-400 hover:text-white"
                    title="Copy URL"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Open in Tab CTA */}
              <button
                onClick={() => {
                  if (onOpenInBrowser) {
                    onOpenInBrowser(selectedRecord.url, selectedRecord.title);
                  } else {
                    window.open(selectedRecord.url, "_blank");
                  }
                }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition-all"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Reopen in Browser Tab</span>
              </button>

              {/* AI Summary / Insight */}
              {selectedRecord.aiSummary && (
                <div className="p-4 rounded-xl bg-gradient-to-br from-indigo-950/40 to-purple-950/30 border border-indigo-500/20 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-indigo-300">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Neural Memory Synthesis</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">{selectedRecord.aiSummary}</p>
                </div>
              )}

              {/* Notes Section */}
              <div className="space-y-2">
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                  User Notes & Insights
                </label>
                <form onSubmit={handleAddNote} className="flex gap-2">
                  <input
                    type="text"
                    value={newNoteInput}
                    onChange={(e) => setNewNoteInput(e.target.value)}
                    placeholder="Attach note to this search/watch..."
                    className="flex-1 bg-white/[0.05] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </form>

                {selectedRecord.notes && selectedRecord.notes.length > 0 && (
                  <div className="space-y-1.5 pt-2">
                    {selectedRecord.notes.map((n) => (
                      <div key={n.id} className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 text-xs text-slate-200">
                        {n.content}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          ADD MEMORY TO POSTGRESQL VAULT MODAL
      ══════════════════════════════════════════════════════════════════════ */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="w-full max-w-lg bg-[#0e1222] border border-indigo-500/30 rounded-2xl shadow-2xl p-6 space-y-4 animate-in zoom-in-95 duration-150 text-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-bold text-white">Add Memory to PostgreSQL Vault</h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddMemory} className="space-y-4">
              {/* Memory Type Selector */}
              <div>
                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Memory Type</label>
                <div className="grid grid-cols-5 gap-1.5 mt-1.5">
                  {(["FACT", "RESEARCH", "INSIGHT", "CONCEPT", "NOTE"] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setMemType(type)}
                      className={`py-1.5 px-2 rounded-lg border text-[11px] font-bold tracking-wide transition ${
                        memType === type
                          ? "bg-indigo-600/30 border-indigo-500 text-indigo-200 shadow-sm"
                          : "bg-white/[0.04] border-white/10 text-slate-400 hover:text-white"
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              {/* Title & Category */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Title / Key</label>
                  <input
                    type="text"
                    value={memTitle}
                    onChange={(e) => setMemTitle(e.target.value)}
                    placeholder="e.g. Distributed Consensus in Raft"
                    className="w-full mt-1.5 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-indigo-500 placeholder-slate-500"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Category</label>
                  <input
                    type="text"
                    value={memCategory}
                    onChange={(e) => setMemCategory(e.target.value)}
                    placeholder="e.g. Systems Architecture"
                    className="w-full mt-1.5 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-indigo-500 placeholder-slate-500"
                  />
                </div>
              </div>

              {/* Content */}
              <div>
                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Memory Content & Details *</label>
                <textarea
                  value={memContent}
                  onChange={(e) => setMemContent(e.target.value)}
                  placeholder="Core factual information, findings, code snippets, or notes to persist..."
                  rows={4}
                  required
                  className="w-full mt-1.5 bg-black/40 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white outline-none focus:border-indigo-500 placeholder-slate-500 resize-none"
                />
              </div>

              {/* Source URL & Tags */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Source URL (Optional)</label>
                  <input
                    type="text"
                    value={memUrl}
                    onChange={(e) => setMemUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full mt-1.5 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-indigo-500 placeholder-slate-500"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Tags (comma-separated)</label>
                  <input
                    type="text"
                    value={memTags}
                    onChange={(e) => setMemTags(e.target.value)}
                    placeholder="raft, distributed, database"
                    className="w-full mt-1.5 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-indigo-500 placeholder-slate-500"
                  />
                </div>
              </div>

              {/* Importance Slider */}
              <div className="flex items-center justify-between bg-white/[0.02] border border-white/5 p-3 rounded-xl">
                <div>
                  <div className="text-xs font-semibold text-slate-200">Importance Weight</div>
                  <div className="text-[10px] text-slate-400">Controls retrieval priority in neural agent context</div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.05"
                    value={memImportance}
                    onChange={(e) => setMemImportance(parseFloat(e.target.value))}
                    className="w-24 accent-indigo-500"
                  />
                  <span className="font-mono text-xs font-bold text-indigo-400 w-8 text-right">
                    {Math.round(memImportance * 100)}%
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingMem}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold shadow-md shadow-indigo-600/30 transition flex items-center gap-1.5"
                >
                  {isSubmittingMem ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving to PostgreSQL...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Store in Vault</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
