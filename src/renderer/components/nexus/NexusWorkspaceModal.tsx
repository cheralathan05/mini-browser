import React, { useState, useEffect } from "react";
import { Layers, X, Loader2, Sparkles, AlertCircle } from "lucide-react";
import { nexusClient } from "../../lib/nexus/nexus-client";

interface NexusWorkspaceModalProps {
  isOpen: boolean;
  mode?: "create" | "edit";
  workspaceToEdit?: { id: string; name: string; description?: string } | null;
  onClose: () => void;
  onSuccess: (workspace: any) => void;
}

export const NexusWorkspaceModal: React.FC<NexusWorkspaceModalProps> = ({
  isOpen,
  mode = "create",
  workspaceToEdit,
  onClose,
  onSuccess,
}) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (mode === "edit" && workspaceToEdit) {
        setName(workspaceToEdit.name || "");
        setDescription(workspaceToEdit.description || "");
      } else {
        setName("");
        setDescription("");
      }
      setError(null);
    }
  }, [isOpen, mode, workspaceToEdit]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Please enter a workspace name.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      if (mode === "edit" && workspaceToEdit) {
        const res = await nexusClient.updateWorkspace(workspaceToEdit.id, {
          name: trimmedName,
          description: description.trim() || undefined,
        });
        if (res.workspace) {
          onSuccess(res.workspace);
          onClose();
        }
      } else {
        const res = await nexusClient.createWorkspace(
          trimmedName,
          description.trim() || undefined
        );
        if (res.workspace) {
          onSuccess(res.workspace);
          onClose();
        }
      }
    } catch (err: any) {
      setError(err.message || "Failed to save workspace. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-[#0e0e1a] border border-white/10 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">
                {mode === "edit" ? "Edit Workspace" : "Create New Workspace"}
              </h2>
              <p className="text-[11px] text-white/50">
                {mode === "edit"
                  ? "Update your workspace details"
                  : "Organize research, tabs, and automated missions"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-medium text-white/70 uppercase tracking-wider mb-1.5">
              Workspace Name <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. AI Engineering, Market Intel, Personal"
              className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-sm text-white placeholder-white/25 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-all"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-white/70 uppercase tracking-wider mb-1.5">
              Description <span className="text-white/30 font-normal lowercase">(optional)</span>
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this space is used for..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-sm text-white placeholder-white/25 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 resize-none transition-all"
            />
          </div>

          {/* Quick presets for new workspace */}
          {mode === "create" && (
            <div>
              <div className="text-[10px] font-medium text-white/40 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-indigo-400" />
                Quick Suggestions
              </div>
              <div className="flex flex-wrap gap-1.5">
                {["Competitor Analysis", "Product Launch", "Full-Stack Dev", "Academic Papers"].map(
                  (suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setName(suggestion)}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-white/[0.03] hover:bg-white/[0.08] text-white/60 hover:text-white/90 border border-white/[0.06] transition-colors"
                    >
                      {suggestion}
                    </button>
                  )
                )}
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-white/[0.08]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-white/60 hover:text-white hover:bg-white/[0.06] transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !name.trim()}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-lg shadow-indigo-600/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{mode === "edit" ? "Save Changes" : "Create Workspace"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
