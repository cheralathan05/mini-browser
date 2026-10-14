import React, { useState, useEffect, useCallback } from "react";
import {
  Puzzle,
  Search,
  X,
  CheckCircle2,
  Shield,
  ExternalLink,
  Plus,
  Trash2,
  RefreshCw,
  FolderOpen,
  Code2,
  AlertCircle,
  Package,
} from "lucide-react";

interface RealExtension {
  id: string;
  name: string;
  description?: string;
  version?: string;
  enabled?: boolean;
  permissions?: string[];
  isComponentExtension?: boolean;
  path?: string;
}

interface Props {
  onOpenInBrowser?: (url: string, title?: string) => void;
}

export const NexusExtensionsView: React.FC<Props> = ({ onOpenInBrowser }) => {
  const [extensions, setExtensions] = useState<RealExtension[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [developerMode, setDeveloperMode] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const loadRealExtensions = useCallback(async () => {
    const shell = typeof window !== "undefined" ? (window as any).browserShell : undefined;
    if (!shell?.extensionsList) {
      setExtensions([]);
      return;
    }

    try {
      setIsLoading(true);
      const list = await shell.extensionsList();
      if (Array.isArray(list)) {
        setExtensions(list);
      } else {
        setExtensions([]);
      }
    } catch (err: any) {
      console.warn("[NexusExtensions] extensionsList error:", err);
      setExtensions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRealExtensions();

    const shell = typeof window !== "undefined" ? (window as any).browserShell : undefined;
    if (shell?.onExtensionsChanged) {
      const unsub = shell.onExtensionsChanged(() => {
        loadRealExtensions();
      });
      return () => {
        if (typeof unsub === "function") unsub();
      };
    }
  }, [loadRealExtensions]);

  const handleToggle = async (id: string, currentEnabled?: boolean) => {
    const shell = typeof window !== "undefined" ? (window as any).browserShell : undefined;
    if (shell?.extensionsSetEnabled) {
      try {
        await shell.extensionsSetEnabled(id, !currentEnabled);
        showToast(`Extension ${!currentEnabled ? "enabled" : "disabled"}`);
        await loadRealExtensions();
      } catch (e: any) {
        showToast(`Error: ${e.message || "Failed to toggle extension"}`);
      }
    }
  };

  const handleReload = async (id: string) => {
    const shell = typeof window !== "undefined" ? (window as any).browserShell : undefined;
    if (shell?.extensionsReload) {
      try {
        await shell.extensionsReload(id);
        showToast("Extension reloaded");
        await loadRealExtensions();
      } catch (e: any) {
        showToast(`Error: ${e.message || "Failed to reload"}`);
      }
    }
  };

  const handleRemove = async (id: string, name: string) => {
    if (!confirm(`Remove extension "${name}"?`)) return;
    const shell = typeof window !== "undefined" ? (window as any).browserShell : undefined;
    if (shell?.extensionsRemove) {
      try {
        await shell.extensionsRemove(id);
        showToast(`Removed "${name}"`);
        await loadRealExtensions();
      } catch (e: any) {
        showToast(`Error: ${e.message || "Failed to remove"}`);
      }
    }
  };

  const handleLoadUnpacked = async () => {
    const shell = typeof window !== "undefined" ? (window as any).browserShell : undefined;
    if (!shell?.extensionsPickUnpackedDirectory || !shell?.extensionsInstallUnpacked) {
      showToast("Extension installation is only available in Desktop mode");
      return;
    }

    try {
      setIsInstalling(true);
      const chosenPath = await shell.extensionsPickUnpackedDirectory();
      if (!chosenPath) {
        setIsInstalling(false);
        return;
      }

      await shell.extensionsInstallUnpacked(chosenPath);
      showToast("Extension loaded successfully!");
      await loadRealExtensions();
    } catch (err: any) {
      showToast(`Install error: ${err.message || "Failed to load unpacked extension"}`);
    } finally {
      setIsInstalling(false);
    }
  };

  const handleOpenStore = () => {
    if (onOpenInBrowser) {
      onOpenInBrowser("https://chromewebstore.google.com", "Chrome Web Store");
    } else {
      window.open("https://chromewebstore.google.com", "_blank");
    }
  };

  const filteredExtensions = extensions.filter((ext) => {
    const q = searchQuery.toLowerCase();
    return !q || (ext.name || "").toLowerCase().includes(q) || (ext.description || "").toLowerCase().includes(q);
  });

  return (
    <div className="flex-1 flex flex-col h-full bg-[#04040a] text-neutral-100 overflow-hidden select-none">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 px-4 py-2 rounded-xl bg-violet-500/20 border border-violet-500/40 text-violet-300 text-sm font-medium shadow-lg animate-in slide-in-from-top">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="shrink-0 px-8 pt-8 pb-4 border-b border-white/5 bg-[#05050c]">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500/25 to-indigo-600/30 border border-violet-500/30 flex items-center justify-center shadow-lg">
                <Puzzle className="w-6 h-6 text-violet-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white tracking-tight">Extensions Manager</h1>
                <p className="text-sm text-neutral-400 mt-0.5">
                  {extensions.length} installed · {extensions.filter((e) => e.enabled).length} active
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setDeveloperMode(!developerMode)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border transition ${
                  developerMode
                    ? "bg-violet-500/15 border-violet-500/30 text-violet-300"
                    : "bg-white/5 border-white/10 text-neutral-400 hover:text-white"
                }`}
              >
                <Code2 className="w-4 h-4" />
                Developer Mode: {developerMode ? "ON" : "OFF"}
              </button>

              <button
                type="button"
                onClick={handleLoadUnpacked}
                disabled={isInstalling}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/30 transition disabled:opacity-50"
              >
                <FolderOpen className="w-4 h-4" />
                Load Unpacked
              </button>

              <button
                type="button"
                onClick={handleOpenStore}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-semibold transition"
              >
                <ExternalLink className="w-4 h-4" />
                Web Store
              </button>
            </div>
          </div>

          {/* Search bar */}
          <div className="relative max-w-md">
            <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search installed extensions..."
              className="w-full pl-9 pr-3 py-2 bg-neutral-900/60 border border-white/5 rounded-xl text-sm text-neutral-200 placeholder-neutral-500 outline-none focus:border-violet-500/50 transition"
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-5xl mx-auto space-y-6">
          {isLoading ? (
            <div className="py-20 text-center text-neutral-500 flex flex-col items-center gap-3">
              <RefreshCw className="w-8 h-8 text-violet-400 animate-spin" />
              <p className="text-sm font-medium">Scanning browser extension registry...</p>
            </div>
          ) : filteredExtensions.length === 0 ? (
            <div className="py-16 text-center text-neutral-400 space-y-4 border border-dashed border-white/10 rounded-3xl bg-[#080812]/50 p-8">
              <div className="w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mx-auto text-violet-400">
                <Puzzle className="w-8 h-8" />
              </div>
              <div className="max-w-md mx-auto">
                <h3 className="text-base font-semibold text-white">No browser extensions installed</h3>
                <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
                  Load any standard Chrome Manifest V2 or V3 extension folder, or install extensions directly into the browser shell.
                </p>
              </div>
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleLoadUnpacked}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/30 transition"
                >
                  <FolderOpen className="w-4 h-4" />
                  Load Extension from Folder
                </button>
                <button
                  type="button"
                  onClick={handleOpenStore}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-300 hover:text-white text-xs font-semibold transition"
                >
                  <ExternalLink className="w-4 h-4" />
                  Browse Chrome Store
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {filteredExtensions.map((ext) => (
                <div
                  key={ext.id}
                  className="group relative flex flex-col p-5 rounded-2xl bg-[#09090e]/80 hover:bg-[#0f0f1a] border border-white/5 hover:border-violet-500/25 transition-all shadow-sm"
                >
                  <div className="flex items-start gap-4 mb-3">
                    <div className="w-12 h-12 rounded-2xl bg-neutral-900 border border-white/10 flex items-center justify-center text-violet-400 shrink-0">
                      <Package className="w-6 h-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-neutral-200 truncate">{ext.name}</p>
                      <p className="text-xs text-neutral-500 truncate">
                        ID: <span className="font-mono text-[11px]">{ext.id.slice(0, 16)}...</span>
                        {ext.version && ` · v${ext.version}`}
                      </p>
                    </div>
                  </div>

                  {ext.description && (
                    <p className="text-xs text-neutral-400 leading-relaxed mb-4 flex-1">{ext.description}</p>
                  )}

                  {developerMode && ext.permissions && ext.permissions.length > 0 && (
                    <div className="mb-3">
                      <p className="text-[10px] uppercase font-mono text-neutral-500 mb-1">Permissions</p>
                      <div className="flex flex-wrap gap-1">
                        {ext.permissions.slice(0, 3).map((p) => (
                          <span key={p} className="px-1.5 py-0.5 rounded bg-white/5 text-[10px] text-neutral-400 font-mono">
                            {p}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-3 border-t border-white/5">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleReload(ext.id)}
                        className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/5 transition"
                        title="Reload Extension"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemove(ext.id, ext.name)}
                        className="p-1.5 rounded-lg text-rose-400/80 hover:text-rose-300 hover:bg-rose-500/10 transition"
                        title="Remove Extension"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleToggle(ext.id, ext.enabled)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
                        ext.enabled
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20"
                          : "bg-neutral-900 text-neutral-400 border-white/5 hover:text-white"
                      }`}
                    >
                      {ext.enabled ? <CheckCircle2 className="w-3 h-3" /> : <X className="w-3 h-3" />}
                      {ext.enabled ? "Active" : "Disabled"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
