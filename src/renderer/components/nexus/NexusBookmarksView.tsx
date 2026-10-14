import React, { useState, useEffect, useCallback } from "react";
import {
  Bookmark,
  Search,
  Plus,
  X,
  ExternalLink,
  Folder,
  Star,
  Globe,
  Trash2,
  Edit3,
  Check,
  Grid3x3,
  List,
  Clock,
  Tag,
  Filter,
  Download,
  Upload,
  Heart,
  BookOpen,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { nexusClient } from "../../lib/nexus/nexus-client";

interface BookmarkItem {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  createdAt: string;
  tags?: string[];
  category?: string;
  notes?: string;
  isPinned?: boolean;
}

interface Props {
  onOpenInBrowser?: (url: string, title?: string) => void;
}

const CATEGORIES = ["All", "Work", "Research", "Social", "Shopping", "Entertainment", "Tools", "News"];

export const NexusBookmarksView: React.FC<Props> = ({ onOpenInBrowser }) => {
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [addCategory, setAddCategory] = useState("Work");
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  // Load bookmarks from Electron browser shell and localStorage
  const loadRealBookmarks = useCallback(async () => {
    const shell = typeof window !== "undefined" ? (window as any).browserShell : undefined;
    const bookmarkMap = new Map<string, BookmarkItem>();

    // 1. Electron shell bookmarks
    if (shell?.bookmarksGetState) {
      try {
        const state = await shell.bookmarksGetState();
        const records = state?.bookmarks || [];
        for (const b of records) {
          if (!b.url || b.url.startsWith("nexus://")) continue;
          bookmarkMap.set(b.url, {
            id: b.id,
            url: b.url,
            title: b.title || b.url,
            favicon: b.favicon || `https://${new URL(b.url).hostname}/favicon.ico`,
            createdAt: new Date(b.createdAt || Date.now()).toISOString(),
            category: "Work",
            tags: [],
          });
        }
      } catch (err) {
        console.warn("[NexusBookmarks] browserShell bookmarks error:", err);
      }
    }

    // 2. Local storage bookmarks
    try {
      const stored = localStorage.getItem("nexus_bookmarks");
      if (stored) {
        const parsed: BookmarkItem[] = JSON.parse(stored);
        for (const b of parsed) {
          if (!b.url || b.url.startsWith("nexus://")) continue;
          if (!bookmarkMap.has(b.url)) {
            bookmarkMap.set(b.url, b);
          }
        }
      }
    } catch {}

    // 3. PostgreSQL backend bookmarks
    try {
      const dbRes = await nexusClient.getBookmarks();
      if (dbRes?.bookmarks && Array.isArray(dbRes.bookmarks)) {
        for (const b of dbRes.bookmarks as BookmarkItem[]) {
          if (!b.url || b.url.startsWith("nexus://")) continue;
          if (!bookmarkMap.has(b.url)) {
            bookmarkMap.set(b.url, b);
          }
        }
      }
    } catch {}

    // 4. Legacy backend user preferences fallback
    try {
      const prefRes = await nexusClient.getUserPreferences();
      if (prefRes?.preferences?.bookmarks && Array.isArray(prefRes.preferences.bookmarks)) {
        for (const b of prefRes.preferences.bookmarks as BookmarkItem[]) {
          if (!b.url || b.url.startsWith("nexus://")) continue;
          if (!bookmarkMap.has(b.url)) {
            bookmarkMap.set(b.url, b);
          }
        }
      }
    } catch {}

    const list = Array.from(bookmarkMap.values());
    setBookmarks(list);
    try { localStorage.setItem("nexus_bookmarks", JSON.stringify(list)); } catch {}
  }, []);

  useEffect(() => {
    loadRealBookmarks();
  }, [loadRealBookmarks]);

  const saveBookmarks = useCallback((updated: BookmarkItem[]) => {
    setBookmarks(updated);
    try { localStorage.setItem("nexus_bookmarks", JSON.stringify(updated)); } catch {}
    void nexusClient.saveBookmarks(updated).catch(() => {});
    void nexusClient.updateUserPreferences({ bookmarks: updated }).catch(() => {});
  }, []);

  const handleDelete = async (id: string) => {
    const shell = typeof window !== "undefined" ? (window as any).browserShell : undefined;
    if (shell?.bookmarksRemove) {
      try { await shell.bookmarksRemove(id); } catch {}
    }
    saveBookmarks(bookmarks.filter((b) => b.id !== id));
    showToast("Bookmark removed");
  };

  const handleTogglePin = (id: string) => {
    saveBookmarks(bookmarks.map((b) => b.id === id ? { ...b, isPinned: !b.isPinned } : b));
  };

  const handleEdit = (bm: BookmarkItem) => {
    setEditingId(bm.id);
    setEditTitle(bm.title);
    setEditNotes(bm.notes || "");
  };

  const handleSaveEdit = (id: string) => {
    saveBookmarks(bookmarks.map((b) => b.id === id ? { ...b, title: editTitle, notes: editNotes } : b));
    setEditingId(null);
    showToast("Bookmark updated");
  };

  const handleAdd = async () => {
    if (!addUrl.trim()) return;
    let url = addUrl.trim();
    if (!url.startsWith("http")) url = "https://" + url;
    const title = addTitle.trim() || new URL(url).hostname;
    const shell = typeof window !== "undefined" ? (window as any).browserShell : undefined;

    let id = `bm-${Date.now()}`;
    if (shell?.bookmarksAdd) {
      try {
        const added = await shell.bookmarksAdd(title, url);
        if (added && added[0]?.id) id = added[0].id;
      } catch {}
    }

    const newBm: BookmarkItem = {
      id,
      url,
      title,
      createdAt: new Date().toISOString(),
      category: addCategory,
      favicon: `https://${new URL(url).hostname}/favicon.ico`,
    };

    saveBookmarks([newBm, ...bookmarks.filter((b) => b.url !== url)]);

    // Mirror to PostgreSQL memory vault
    nexusClient.createMemory({
      type: "website",
      category: addCategory,
      title: `Bookmark: ${title}`,
      content: url,
      sourceUrl: url,
      importance: 0.9,
    }).catch(() => {});

    setAddUrl("");
    setAddTitle("");
    setShowAddForm(false);
    showToast("Bookmark saved!");
  };

  const handleExport = () => {
    const data = JSON.stringify(bookmarks, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "nexus-bookmarks.json";
    a.click();
    showToast("Bookmarks exported!");
  };

  const filtered = bookmarks.filter((b) => {
    const matchCat = selectedCategory === "All" || b.category === selectedCategory;
    const q = searchQuery.toLowerCase();
    const matchSearch = !q || b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  const pinned = filtered.filter((b) => b.isPinned);
  const unpinned = filtered.filter((b) => !b.isPinned);

  const getFaviconUrl = (url: string) => {
    try { return `https://${new URL(url).hostname}/favicon.ico`; } catch { return undefined; }
  };

  const getDomain = (url: string) => {
    try { return new URL(url).hostname.replace("www.", ""); } catch { return url; }
  };

  const getTimeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const d = Math.floor(diff / 86400000);
    if (d === 0) return "Today";
    if (d === 1) return "Yesterday";
    return `${d} days ago`;
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
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500/25 to-orange-600/30 border border-amber-500/30 flex items-center justify-center shadow-lg">
                <Bookmark className="w-6 h-6 text-amber-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white tracking-tight">Bookmarks</h1>
                <p className="text-sm text-neutral-400 mt-0.5">{bookmarks.length} saved • {pinned.length} pinned</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExport}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-neutral-900 border border-white/5 text-neutral-400 hover:text-white hover:border-white/10 text-sm transition"
                title="Export bookmarks"
              >
                <Download className="w-4 h-4" />
                <span>Export</span>
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-sm font-semibold shadow-lg shadow-amber-500/20 transition active:scale-95"
              >
                <Plus className="w-4 h-4" />
                <span>Add Bookmark</span>
              </button>
            </div>
          </div>

          {/* Search + Filter Row */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search bookmarks..."
                className="w-full pl-9 pr-3 py-2 bg-neutral-900/60 border border-white/5 rounded-xl text-sm text-neutral-200 placeholder-neutral-500 outline-none focus:border-amber-500/50 transition"
              />
            </div>

            <div className="flex items-center gap-1 p-1 rounded-xl bg-neutral-900 border border-white/5">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                    selectedCategory === cat
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                      : "text-neutral-500 hover:text-white"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 p-1 rounded-xl bg-neutral-900 border border-white/5">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={`p-1.5 rounded-lg transition ${viewMode === "grid" ? "bg-white/10 text-white" : "text-neutral-500 hover:text-white"}`}
              >
                <Grid3x3 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`p-1.5 rounded-lg transition ${viewMode === "list" ? "bg-white/10 text-white" : "text-neutral-500 hover:text-white"}`}
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Add Bookmark Form */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md p-6 rounded-3xl bg-[#0c0c18] border border-white/10 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Add Bookmark</h3>
              <button type="button" onClick={() => setShowAddForm(false)} className="p-1 text-neutral-400 hover:text-white transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            <input
              type="url"
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
              placeholder="https://example.com"
              autoFocus
              className="w-full px-4 py-3 bg-neutral-900 border border-white/5 rounded-xl text-sm text-white placeholder-neutral-500 outline-none focus:border-amber-500/50 transition"
            />
            <input
              type="text"
              value={addTitle}
              onChange={(e) => setAddTitle(e.target.value)}
              placeholder="Title (optional)"
              className="w-full px-4 py-3 bg-neutral-900 border border-white/5 rounded-xl text-sm text-white placeholder-neutral-500 outline-none focus:border-amber-500/50 transition"
            />
            <select
              value={addCategory}
              onChange={(e) => setAddCategory(e.target.value)}
              className="w-full px-4 py-3 bg-neutral-900 border border-white/5 rounded-xl text-sm text-white outline-none focus:border-amber-500/50 transition"
            >
              {CATEGORIES.filter((c) => c !== "All").map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleAdd}
              disabled={!addUrl.trim()}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-semibold text-sm disabled:opacity-30 transition"
            >
              Save Bookmark
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-6xl mx-auto space-y-8">
          {/* Pinned Section */}
          {pinned.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                <span className="text-sm font-semibold text-amber-400 uppercase tracking-wider font-mono">Pinned</span>
              </div>
              <div className={viewMode === "grid" ? "grid grid-cols-3 gap-3" : "space-y-2"}>
                {pinned.map((bm) => (
                  <BookmarkCard
                    key={bm.id}
                    bm={bm}
                    viewMode={viewMode}
                    editingId={editingId}
                    editTitle={editTitle}
                    editNotes={editNotes}
                    onEdit={handleEdit}
                    onSaveEdit={handleSaveEdit}
                    onDelete={handleDelete}
                    onTogglePin={handleTogglePin}
                    onOpen={(url, title) => onOpenInBrowser?.(url, title)}
                    setEditTitle={setEditTitle}
                    setEditNotes={setEditNotes}
                    getFaviconUrl={getFaviconUrl}
                    getDomain={getDomain}
                    getTimeAgo={getTimeAgo}
                  />
                ))}
              </div>
            </section>
          )}

          {/* All Bookmarks */}
          <section>
            {pinned.length > 0 && (
              <div className="flex items-center gap-2 mb-4">
                <Bookmark className="w-4 h-4 text-neutral-400" />
                <span className="text-sm font-semibold text-neutral-400 uppercase tracking-wider font-mono">All Bookmarks</span>
                <span className="text-xs text-neutral-600 font-mono">({unpinned.length})</span>
              </div>
            )}

            {unpinned.length === 0 && pinned.length === 0 && (
              <div className="py-20 text-center text-neutral-500 space-y-3 border border-dashed border-white/5 rounded-3xl">
                <Bookmark className="w-12 h-12 text-neutral-700 mx-auto" />
                <p className="text-base font-medium text-neutral-400">No bookmarks yet</p>
                <p className="text-sm">Click "Add Bookmark" to save your favorite pages</p>
                <button
                  type="button"
                  onClick={() => setShowAddForm(true)}
                  className="mx-auto mt-2 flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-600/20 border border-amber-500/30 text-amber-300 text-sm font-medium transition hover:bg-amber-600/30"
                >
                  <Plus className="w-4 h-4" />
                  Add First Bookmark
                </button>
              </div>
            )}

            <div className={viewMode === "grid" ? "grid grid-cols-3 gap-3" : "space-y-2"}>
              {unpinned.map((bm) => (
                <BookmarkCard
                  key={bm.id}
                  bm={bm}
                  viewMode={viewMode}
                  editingId={editingId}
                  editTitle={editTitle}
                  editNotes={editNotes}
                  onEdit={handleEdit}
                  onSaveEdit={handleSaveEdit}
                  onDelete={handleDelete}
                  onTogglePin={handleTogglePin}
                  onOpen={(url, title) => onOpenInBrowser?.(url, title)}
                  setEditTitle={setEditTitle}
                  setEditNotes={setEditNotes}
                  getFaviconUrl={getFaviconUrl}
                  getDomain={getDomain}
                  getTimeAgo={getTimeAgo}
                />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

// Sub-component: individual bookmark card
const BookmarkCard: React.FC<{
  bm: BookmarkItem;
  viewMode: "grid" | "list";
  editingId: string | null;
  editTitle: string;
  editNotes: string;
  onEdit: (bm: BookmarkItem) => void;
  onSaveEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
  onOpen: (url: string, title?: string) => void;
  setEditTitle: (v: string) => void;
  setEditNotes: (v: string) => void;
  getFaviconUrl: (url: string) => string | undefined;
  getDomain: (url: string) => string;
  getTimeAgo: (iso: string) => string;
}> = ({
  bm, viewMode, editingId, editTitle, editNotes,
  onEdit, onSaveEdit, onDelete, onTogglePin, onOpen,
  setEditTitle, setEditNotes, getFaviconUrl, getDomain, getTimeAgo,
}) => {
  const isEditing = editingId === bm.id;
  const domain = getDomain(bm.url);
  const favicon = getFaviconUrl(bm.url);

  if (viewMode === "list") {
    return (
      <div className="group flex items-center gap-4 p-4 rounded-2xl bg-[#09090e]/80 hover:bg-[#0e0e18] border border-white/5 hover:border-amber-500/25 transition-all">
        <div className="w-9 h-9 rounded-xl bg-neutral-900 border border-white/5 flex items-center justify-center shrink-0 overflow-hidden">
          {favicon ? (
            <img src={favicon} alt="" className="w-5 h-5 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <Globe className="w-4 h-4 text-neutral-500" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          {isEditing ? (
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="w-full bg-neutral-900 border border-amber-500/40 rounded-lg px-2 py-1 text-sm text-white outline-none"
              autoFocus
            />
          ) : (
            <p className="text-sm font-semibold text-neutral-200 truncate">{bm.title}</p>
          )}
          <p className="text-xs text-neutral-500 truncate">{domain} · {getTimeAgo(bm.createdAt)}</p>
        </div>

        {bm.category && (
          <span className="px-2 py-0.5 rounded-md bg-neutral-900 border border-white/5 text-xs text-neutral-400 font-mono shrink-0">{bm.category}</span>
        )}

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
          {isEditing ? (
            <button type="button" onClick={() => onSaveEdit(bm.id)} className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition">
              <Check className="w-3.5 h-3.5" />
            </button>
          ) : (
            <>
              <button type="button" onClick={() => onOpen(bm.url, bm.title)} className="p-1.5 rounded-lg hover:bg-white/5 text-neutral-400 hover:text-white transition" title="Open">
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => onEdit(bm)} className="p-1.5 rounded-lg hover:bg-white/5 text-neutral-400 hover:text-white transition" title="Edit">
                <Edit3 className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => onTogglePin(bm.id)} className={`p-1.5 rounded-lg hover:bg-white/5 transition ${bm.isPinned ? "text-amber-400" : "text-neutral-400 hover:text-amber-400"}`} title="Pin">
                <Star className={`w-3.5 h-3.5 ${bm.isPinned ? "fill-amber-400" : ""}`} />
              </button>
              <button type="button" onClick={() => onDelete(bm.id)} className="p-1.5 rounded-lg hover:bg-rose-500/10 text-neutral-400 hover:text-rose-400 transition" title="Delete">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Grid view
  return (
    <div className="group relative flex flex-col p-4 rounded-2xl bg-[#09090e]/80 hover:bg-[#0f0f1a] border border-white/5 hover:border-amber-500/25 transition-all cursor-pointer shadow-sm hover:shadow-lg hover:shadow-amber-500/5">
      {/* Favicon + Actions */}
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-xl bg-neutral-900 border border-white/5 flex items-center justify-center overflow-hidden">
          {favicon ? (
            <img src={favicon} alt="" className="w-6 h-6 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <Globe className="w-5 h-5 text-neutral-500" />
          )}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
          <button type="button" onClick={() => onTogglePin(bm.id)} className={`p-1 rounded-lg hover:bg-white/5 transition ${bm.isPinned ? "text-amber-400" : "text-neutral-500"}`} title="Pin">
            <Star className={`w-3.5 h-3.5 ${bm.isPinned ? "fill-amber-400" : ""}`} />
          </button>
          <button type="button" onClick={() => onDelete(bm.id)} className="p-1 rounded-lg hover:bg-rose-500/10 text-neutral-500 hover:text-rose-400 transition" title="Delete">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Title */}
      {isEditing ? (
        <input
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onSaveEdit(bm.id); }}
          className="w-full bg-neutral-900 border border-amber-500/40 rounded-lg px-2 py-1 text-sm text-white outline-none mb-2"
          autoFocus
        />
      ) : (
        <p className="text-sm font-semibold text-neutral-200 truncate mb-1">{bm.title}</p>
      )}
      <p className="text-xs text-neutral-500 truncate mb-3">{domain}</p>

      {/* Footer */}
      <div className="flex items-center justify-between mt-auto">
        <div className="flex items-center gap-2">
          {bm.category && (
            <span className="px-1.5 py-0.5 rounded bg-neutral-800 text-[10px] text-neutral-400 font-mono">{bm.category}</span>
          )}
          <span className="text-[10px] text-neutral-600 font-mono">{getTimeAgo(bm.createdAt)}</span>
        </div>

        <button
          type="button"
          onClick={() => onOpen(bm.url, bm.title)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-amber-500/20 hover:text-amber-300 text-neutral-400 text-xs font-medium transition"
        >
          <ExternalLink className="w-3 h-3" />
          Open
        </button>
      </div>
    </div>
  );
};

interface BookmarkItem {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  createdAt: string;
  tags?: string[];
  category?: string;
  notes?: string;
  isPinned?: boolean;
}
