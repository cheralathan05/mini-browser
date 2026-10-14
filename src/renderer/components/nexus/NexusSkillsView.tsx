import React, { useState, useEffect } from "react";
import { Sparkles, Play, Plus, Check, Loader2, Code2, X, Wrench, FileText, Trash2 } from "lucide-react";
import { nexusClient } from "../../lib/nexus/nexus-client";
import { useToast } from "./NexusToast";

const AVAILABLE_TOOLS = [
  "web_search",
  "browser_navigate",
  "browser_extract",
  "browser_click",
  "browser_type",
  "save_memory",
  "query_memory",
];

interface NexusSkillsViewProps {
  workspaceId?: string | null;
}

export const NexusSkillsView: React.FC<NexusSkillsViewProps> = ({ workspaceId }) => {
  const [skills, setSkills] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newSkillName, setNewSkillName] = useState("");
  const [newSkillDesc, setNewSkillDesc] = useState("");
  const [newSkillInstructions, setNewSkillInstructions] = useState("");
  const [selectedTools, setSelectedTools] = useState<string[]>(["web_search", "browser_extract"]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toast = useToast();

  const loadSkills = async () => {
    try {
      setIsLoading(true);
      const res = await nexusClient.getSkills(workspaceId || undefined);
      setSkills(res.skills || []);
    } catch (e) {
      console.error("Failed to load skills:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSkills();
  }, [workspaceId]);

  const handleRun = async (skill: any) => {
    setIsRunning(skill.id);
    try {
      await nexusClient.runSkill(skill.id);
      toast.success(`Skill "${skill.name}" launched as an Agent Task`);
    } catch (err: any) {
      toast.error(err.message || "Failed to trigger skill");
    } finally {
      setIsRunning(null);
    }
  };

  const handleDelete = async (skillId: string, skillName: string) => {
    if (!window.confirm(`Are you sure you want to delete the skill "${skillName}"?`)) return;
    try {
      setDeletingId(skillId);
      await nexusClient.deleteSkill(skillId);
      toast.success(`Skill "${skillName}" deleted`);
      setSkills((prev) => prev.filter((s) => s.id !== skillId));
    } catch (err: any) {
      toast.error(err.message || "Failed to delete skill");
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleTool = (tool: string) => {
    setSelectedTools((prev) =>
      prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool]
    );
  };

  const handleCreateSkill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSkillName.trim() || !newSkillDesc.trim() || !newSkillInstructions.trim()) {
      toast.warning("Please fill in all required skill fields.");
      return;
    }

    try {
      setIsSubmitting(true);
      await nexusClient.createSkill({
        workspaceId: workspaceId || undefined,
        name: newSkillName.trim(),
        description: newSkillDesc.trim(),
        instructions: newSkillInstructions.trim(),
        tools: selectedTools,
      });
      toast.success(`Skill "${newSkillName.trim()}" created`);
      setShowCreateModal(false);
      setNewSkillName("");
      setNewSkillDesc("");
      setNewSkillInstructions("");
      setSelectedTools(["web_search", "browser_extract"]);
      await loadSkills();
    } catch (err: any) {
      toast.error(err.message || "Failed to create skill");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-[#050507] text-neutral-100 overflow-hidden select-none">
      {/* Subheader */}
      <div className="flex items-center justify-between px-8 py-4 border-b border-neutral-800/80 bg-[#0a0a0f]/60 shrink-0">
        <div className="flex items-center gap-3">
          <Sparkles className="w-4 h-4 text-violet-400" />
          <div>
            <h1 className="text-sm font-semibold text-white tracking-wide">Skills Registry</h1>
            <p className="text-[11px] text-neutral-500">Reusable autonomous agent routines and tool capabilities</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition shadow-lg shadow-violet-600/20"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Skill</span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-5xl mx-auto">
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-pulse">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="p-5 rounded-2xl bg-[#0e0e14] border border-neutral-800/80 h-44" />
              ))}
            </div>
          ) : skills.length === 0 ? (
            <div className="py-24 text-center max-w-sm mx-auto">
              <div className="w-10 h-10 rounded-2xl bg-violet-600/10 border border-violet-500/20 flex items-center justify-center text-violet-400 mx-auto mb-3">
                <Sparkles className="w-5 h-5" />
              </div>
              <h3 className="text-xs font-semibold text-white">No Skills Configured</h3>
              <p className="text-[11px] text-neutral-500 mt-1 mb-4">
                Define automated procedures with tool bindings that agents can invoke on command.
              </p>
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="px-3 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-300 hover:text-white transition"
              >
                Create First Skill
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {skills.map((skill) => (
                <div
                  key={skill.id}
                  className="p-5 rounded-2xl bg-[#0e0e14] border border-neutral-800/80 flex flex-col justify-between hover:border-neutral-700/80 transition group"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-xs font-semibold text-white tracking-wide">{skill.name}</span>
                      <Sparkles className="w-3.5 h-3.5 text-violet-400/60 group-hover:text-violet-400 transition" />
                    </div>
                    <p className="text-[11px] text-neutral-400 line-clamp-2 leading-relaxed mb-4">
                      {skill.description}
                    </p>

                    <div className="flex flex-wrap gap-1.5 mb-4">
                      {(skill.tools || []).map((t: string, i: number) => (
                        <span
                          key={i}
                          className="text-[10px] px-2 py-0.5 rounded-md bg-neutral-950 border border-neutral-800 text-neutral-400 font-mono"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-auto">
                    <button
                      type="button"
                      onClick={() => handleRun(skill)}
                      disabled={isRunning === skill.id}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-neutral-900 hover:bg-violet-600 hover:text-white border border-neutral-800 text-xs font-medium text-neutral-300 transition disabled:opacity-50"
                    >
                      {isRunning === skill.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                      <span>Execute Skill</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(skill.id, skill.name)}
                      disabled={deletingId === skill.id}
                      title="Delete Skill"
                      className="p-2 rounded-xl bg-neutral-900 hover:bg-rose-950/40 hover:text-rose-400 border border-neutral-800 text-neutral-500 transition disabled:opacity-50"
                    >
                      {deletingId === skill.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create Skill Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-100">
          <div className="bg-[#0d0d12] border border-neutral-800/80 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-800/80 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-violet-400" />
                <h3 className="text-xs font-semibold text-white">Create New Skill</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1 rounded-lg text-neutral-500 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSkill} className="space-y-4 text-xs">
              <div>
                <label className="block text-neutral-300 font-medium mb-1">Skill Name</label>
                <input
                  type="text"
                  value={newSkillName}
                  onChange={(e) => setNewSkillName(e.target.value)}
                  placeholder="e.g. Daily Tech Radar"
                  required
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-2.5 text-white placeholder-neutral-600 focus:outline-none focus:border-violet-500"
                />
              </div>

              <div>
                <label className="block text-neutral-300 font-medium mb-1">Description</label>
                <input
                  type="text"
                  value={newSkillDesc}
                  onChange={(e) => setNewSkillDesc(e.target.value)}
                  placeholder="e.g. Scrapes top AI repos and summarizes architectural updates"
                  required
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-2.5 text-white placeholder-neutral-600 focus:outline-none focus:border-violet-500"
                />
              </div>

              <div>
                <label className="block text-neutral-300 font-medium mb-1">Execution Instructions</label>
                <textarea
                  rows={3}
                  value={newSkillInstructions}
                  onChange={(e) => setNewSkillInstructions(e.target.value)}
                  placeholder="Step-by-step instructions for the autonomous agent..."
                  required
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-2.5 text-white placeholder-neutral-600 focus:outline-none focus:border-violet-500 resize-none"
                />
              </div>

              <div>
                <label className="block text-neutral-300 font-medium mb-1.5">Tool Permissions</label>
                <div className="flex flex-wrap gap-1.5">
                  {AVAILABLE_TOOLS.map((tool) => {
                    const isSelected = selectedTools.includes(tool);
                    return (
                      <button
                        type="button"
                        key={tool}
                        onClick={() => handleToggleTool(tool)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-mono transition flex items-center gap-1 ${
                          isSelected
                            ? "bg-violet-600/20 text-violet-300 border border-violet-500/30 font-medium"
                            : "bg-neutral-950 border border-neutral-800 text-neutral-500 hover:text-neutral-300"
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3" />}
                        {tool}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-neutral-800/80">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-white font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold flex items-center gap-1.5 disabled:opacity-50 transition shadow-lg shadow-violet-600/20"
                >
                  {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>Save Skill</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
