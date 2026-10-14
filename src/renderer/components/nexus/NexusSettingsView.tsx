import React, { useState, useEffect } from "react";
import {
  Settings,
  Cpu,
  Save,
  CheckCircle2,
  AlertCircle,
  Database,
  Shield,
  Globe,
  Sliders,
  Radio,
  Check,
  RefreshCw,
  Palette,
  Bot,
  Layers,
  Network,
  Terminal,
  BrainCircuit,
  Key,
  User,
  Users,
  Lock,
  Plus,
  Trash2,
} from "lucide-react";
import { nexusClient } from "../../lib/nexus/nexus-client";
import { useToast } from "./NexusToast";

type SettingsCategory =
  | "account"
  | "workspaces"
  | "general"
  | "appearance"
  | "browser"
  | "ai"
  | "agents"
  | "memory"
  | "research"
  | "integrations"
  | "security"
  | "developer";

export const NexusSettingsView: React.FC = () => {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>("account");
  const [settings, setSettings] = useState<any>({});
  
  // User profile state
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [editName, setEditName] = useState("");
  const [editAvatar, setEditAvatar] = useState("");
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

  // Password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Workspaces & Team state
  const [workspaces, setWorkspaces] = useState<any[]>([]);
  const [newWsName, setNewWsName] = useState("");
  const [newWsDesc, setNewWsDesc] = useState("");
  const [isCreatingWs, setIsCreatingWs] = useState(false);
  const [teamUsers, setTeamUsers] = useState<any[]>([]);

  // Engine state
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [ollamaModel, setOllamaModel] = useState("qwen3:8b");
  const [openAiApiKey, setOpenAiApiKey] = useState("");
  const [openAiModel, setOpenAiModel] = useState("gpt-4o-mini");
  const [defaultSearchEngine, setDefaultSearchEngine] = useState("google");
  const [autoApproveReads, setAutoApproveReads] = useState(true);
  const [requireWriteApproval, setRequireWriteApproval] = useState(true);
  const [themeMode, setThemeMode] = useState<"dark" | "pure-black">("pure-black");
  const [accentGlow, setAccentGlow] = useState(true);

  // System Diagnostics
  const [dbStatus, setDbStatus] = useState<string>("checking...");
  const [ollamaStatus, setOllamaStatus] = useState<string>("checking...");
  const [isCheckingSystem, setIsCheckingSystem] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const toast = useToast();

  const loadUserData = async () => {
    try {
      const res = await nexusClient.getMe();
      if (res.user) {
        setCurrentUser(res.user);
        setEditName(res.user.name || "");
        setEditAvatar(res.user.avatar || "");
      }
    } catch (e) {
      console.warn("Failed to load user profile:", e);
    }
  };

  const loadWorkspacesData = async () => {
    try {
      const [wsRes, usersRes] = await Promise.all([
        nexusClient.getWorkspaces().catch(() => ({ workspaces: [] })),
        nexusClient.getUsersList().catch(() => ({ users: [] })),
      ]);
      setWorkspaces(wsRes.workspaces || []);
      setTeamUsers(usersRes.users || []);
    } catch (e) {
      console.warn("Failed to load workspaces or users:", e);
    }
  };

  const loadSettings = async () => {
    try {
      const res = await nexusClient.getSettings();
      if (res.settings) {
        setSettings(res.settings);
        setOllamaUrl(res.settings.ollamaUrl || "http://localhost:11434");
        setOllamaModel(res.settings.ollamaModel || "qwen3:8b");
        setOpenAiModel(res.settings.openAiModel || "gpt-4o-mini");
        if (res.settings.defaultSearchEngine) setDefaultSearchEngine(res.settings.defaultSearchEngine);
        if (res.settings.theme) setThemeMode(res.settings.theme === "pure-black" ? "pure-black" : "dark");
      }
    } catch (e) {
      console.error("Failed to load settings:", e);
    }
  };

  const checkHealth = async () => {
    setIsCheckingSystem(true);
    try {
      const res = await nexusClient.getReadiness();
      setDbStatus(res.database || "healthy");
      setOllamaStatus(res.ollama || "offline");
    } catch {
      setDbStatus("unreachable");
      setOllamaStatus("offline");
    } finally {
      setIsCheckingSystem(false);
    }
  };

  useEffect(() => {
    loadUserData();
    loadWorkspacesData();
    loadSettings();
    checkHealth();
  }, []);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) {
      toast.warning("Name cannot be empty");
      return;
    }
    setIsUpdatingProfile(true);
    try {
      const res = await nexusClient.updateProfile({
        name: editName.trim(),
        avatar: editAvatar.trim() || undefined,
      });
      setCurrentUser(res.user);
      toast.success("Profile updated successfully");
    } catch (err: any) {
      toast.error(err.message || "Failed to update profile");
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast.warning("New password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.warning("New passwords do not match");
      return;
    }
    setIsChangingPassword(true);
    try {
      await nexusClient.changePassword(currentPassword, newPassword);
      toast.success("Password changed successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      toast.error(err.message || "Failed to update password");
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWsName.trim()) return;
    setIsCreatingWs(true);
    try {
      await nexusClient.createWorkspace(newWsName.trim(), newWsDesc.trim() || undefined);
      toast.success(`Workspace "${newWsName.trim()}" created`);
      setNewWsName("");
      setNewWsDesc("");
      await loadWorkspacesData();
    } catch (err: any) {
      toast.error(err.message || "Failed to create workspace");
    } finally {
      setIsCreatingWs(false);
    }
  };

  const handleDeleteWorkspace = async (id: string, name: string) => {
    if (workspaces.length <= 1) {
      toast.warning("Cannot delete the only remaining workspace");
      return;
    }
    try {
      await nexusClient.deleteWorkspace(id);
      toast.success(`Workspace "${name}" removed`);
      await loadWorkspacesData();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete workspace");
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSaving(true);

    try {
      await nexusClient.updateSettings({
        ollamaUrl,
        ollamaModel,
        openAiApiKey: openAiApiKey || undefined,
        openAiModel,
      });
      await nexusClient.updateUserPreferences({
        defaultSearchEngine,
        requireWriteApproval,
        autoApproveReads,
        theme: themeMode,
        accentGlow,
      });
      toast.success("Settings saved successfully");
      await loadSettings();
    } catch (err: any) {
      toast.error(err.message || "Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  const categories: { id: SettingsCategory; label: string; icon: any }[] = [
    { id: "account", label: "Account & Profile", icon: User },
    { id: "workspaces", label: "Workspaces & Team", icon: Users },
    { id: "general", label: "General", icon: Settings },
    { id: "appearance", label: "Appearance", icon: Palette },
    { id: "browser", label: "Browser Chrome", icon: Globe },
    { id: "ai", label: "AI Models & Runtime", icon: Cpu },
    { id: "agents", label: "Autonomous Agents", icon: Bot },
    { id: "memory", label: "Memory & Knowledge", icon: BrainCircuit },
    { id: "research", label: "Research & Workflows", icon: Layers },
    { id: "integrations", label: "Integrations & API", icon: Key },
    { id: "security", label: "Security & Approvals", icon: Shield },
    { id: "developer", label: "Developer & Diagnostics", icon: Terminal },
  ];

  return (
    <div className="flex-1 flex bg-[#07070a] text-neutral-100 overflow-hidden select-none">
      {/* Left Settings Sidebar */}
      <div className="w-64 border-r border-neutral-800/80 bg-[#0a0a0f]/80 flex flex-col shrink-0">
        <div className="p-4 border-b border-neutral-800/80">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-violet-400" />
            <span className="text-sm font-semibold text-white tracking-wide">Settings</span>
          </div>
          <p className="text-[11px] text-neutral-500 mt-1">NEXUS System Preferences</p>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {categories.map((cat) => {
            const Icon = cat.icon;
            const isActive = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategory(cat.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-left transition ${
                  isActive
                    ? "bg-violet-600/15 text-violet-300 border border-violet-500/20 shadow-sm"
                    : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/60"
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? "text-violet-400" : "text-neutral-500"}`} />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        <div className="p-3 border-t border-neutral-800/80 bg-neutral-950/40">
          <button
            type="button"
            onClick={checkHealth}
            disabled={isCheckingSystem}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-[11px] text-neutral-400 hover:text-white transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isCheckingSystem ? "animate-spin" : ""}`} />
            <span>Diagnostic Probe</span>
          </button>
        </div>
      </div>

      {/* Right Settings Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <div className="flex-1 p-8 max-w-3xl space-y-8">
          {/* Account Category */}
          {activeCategory === "account" && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div>
                <h2 className="text-base font-semibold text-white">Account & Profile</h2>
                <p className="text-xs text-neutral-400 mt-0.5">Manage your authenticated credentials, display name, and avatar</p>
              </div>

              {/* Profile Card */}
              <form onSubmit={handleUpdateProfile} className="p-5 rounded-2xl bg-[#0e0e14] border border-neutral-800/80 space-y-4 text-xs">
                <div className="flex items-center gap-4 pb-4 border-b border-neutral-800/80">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-violet-600 to-indigo-600 flex items-center justify-center text-white text-xl font-bold shadow-lg shadow-violet-600/30 overflow-hidden">
                    {editAvatar ? (
                      <img src={editAvatar} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      currentUser?.name?.slice(0, 1).toUpperCase() || "N"
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">{currentUser?.name || "Active User"}</h3>
                    <p className="text-neutral-400 text-xs">{currentUser?.email || "user@nexus.local"}</p>
                    <span className="inline-block mt-1 text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono">
                      Database Authenticated
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-neutral-300 block mb-1 font-medium">Display Name</label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Your Full Name"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-violet-500"
                    />
                  </div>
                  <div>
                    <label className="text-neutral-300 block mb-1 font-medium">Avatar URL</label>
                    <input
                      type="text"
                      value={editAvatar}
                      onChange={(e) => setEditAvatar(e.target.value)}
                      placeholder="https://images.unsplash.com/..."
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-violet-500"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={isUpdatingProfile}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium text-xs shadow-lg shadow-violet-600/20 transition disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{isUpdatingProfile ? "Saving..." : "Update Profile"}</span>
                  </button>
                </div>
              </form>

              {/* Security / Password Card */}
              <form onSubmit={handleChangePassword} className="p-5 rounded-2xl bg-[#0e0e14] border border-neutral-800/80 space-y-4 text-xs">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-amber-400" />
                  <h3 className="font-semibold text-white">Change Account Password</h3>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-neutral-300 block mb-1 font-medium">Current Password</label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-violet-500"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-neutral-300 block mb-1 font-medium">New Password</label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="At least 6 characters"
                        required
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-violet-500"
                      />
                    </div>
                    <div>
                      <label className="text-neutral-300 block mb-1 font-medium">Confirm New Password</label>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Repeat new password"
                        required
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-violet-500"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={isChangingPassword}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-200 font-medium text-xs transition disabled:opacity-50"
                  >
                    <Shield className="w-3.5 h-3.5 text-amber-400" />
                    <span>{isChangingPassword ? "Updating..." : "Update Password"}</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Workspaces & Team Category */}
          {activeCategory === "workspaces" && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div>
                <h2 className="text-base font-semibold text-white">Workspaces & User Directory</h2>
                <p className="text-xs text-neutral-400 mt-0.5">Manage persistent database workspaces and collaborate with workspace users</p>
              </div>

              {/* Workspaces list */}
              <div className="p-5 rounded-2xl bg-[#0e0e14] border border-neutral-800/80 space-y-4 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white">Active Workspaces ({workspaces.length})</span>
                </div>

                <div className="space-y-2">
                  {workspaces.map((ws) => (
                    <div
                      key={ws.id}
                      className="flex items-center justify-between p-3 rounded-xl bg-neutral-950 border border-neutral-800/80"
                    >
                      <div>
                        <div className="font-medium text-white">{ws.name}</div>
                        <div className="text-[11px] text-neutral-500 mt-0.5">{ws.description || "General workspace"}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteWorkspace(ws.id, ws.name)}
                        className="p-1.5 rounded-lg text-neutral-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
                        title="Delete workspace"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add Workspace Form */}
                <form onSubmit={handleCreateWorkspace} className="pt-3 border-t border-neutral-800/80 space-y-3">
                  <span className="font-medium text-neutral-300 block">Create New Workspace</span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input
                      type="text"
                      value={newWsName}
                      onChange={(e) => setNewWsName(e.target.value)}
                      placeholder="Workspace name (e.g. AI Research)"
                      className="bg-neutral-950 border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-violet-500"
                    />
                    <input
                      type="text"
                      value={newWsDesc}
                      onChange={(e) => setNewWsDesc(e.target.value)}
                      placeholder="Description"
                      className="bg-neutral-950 border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-violet-500"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isCreatingWs || !newWsName.trim()}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium text-xs transition disabled:opacity-50"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create Workspace</span>
                  </button>
                </form>
              </div>

              {/* Team / Users Directory */}
              <div className="p-5 rounded-2xl bg-[#0e0e14] border border-neutral-800/80 space-y-4 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white">Registered Users Directory ({teamUsers.length})</span>
                  <span className="text-[10px] text-neutral-500">PostgreSQL Users</span>
                </div>

                <div className="space-y-2">
                  {teamUsers.map((u) => (
                    <div
                      key={u.id}
                      className="flex items-center justify-between p-3 rounded-xl bg-neutral-950 border border-neutral-800/80"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-neutral-800 flex items-center justify-center text-neutral-300 font-semibold">
                          {u.name?.slice(0, 1).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium text-white">{u.name}</div>
                          <div className="text-[11px] text-neutral-500">{u.email}</div>
                        </div>
                      </div>
                      <span className="text-[10px] text-neutral-500 font-mono">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* General Category */}
          {activeCategory === "general" && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div>
                <h2 className="text-base font-semibold text-white">General Preferences</h2>
                <p className="text-xs text-neutral-400 mt-0.5">Core operating system behaviors and workspace retention</p>
              </div>

              <div className="p-5 rounded-2xl bg-[#0e0e14] border border-neutral-800/80 space-y-4 text-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-neutral-200">Session Continuity</span>
                    <span className="block text-[11px] text-neutral-500 mt-0.5">Restore open tabs, research notes, and agent workspaces on launch</span>
                  </div>
                  <input type="checkbox" defaultChecked className="rounded accent-violet-600" />
                </div>

                <div className="pt-3 border-t border-neutral-800/80 flex items-center justify-between">
                  <div>
                    <span className="font-medium text-neutral-200">Omnibox Global Shortcut</span>
                    <span className="block text-[11px] text-neutral-500 mt-0.5">Press Ctrl + L to focus universal command interface instantly</span>
                  </div>
                  <span className="text-[11px] font-mono px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-neutral-400">Ctrl + L</span>
                </div>

                <div className="pt-3 border-t border-neutral-800/80 flex items-center justify-between">
                  <div>
                    <span className="font-medium text-neutral-200">Command Palette</span>
                    <span className="block text-[11px] text-neutral-500 mt-0.5">Universal action launcher for all workspaces, memory, and skills</span>
                  </div>
                  <span className="text-[11px] font-mono px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-neutral-400">Ctrl + K</span>
                </div>
              </div>
            </div>
          )}

          {/* Appearance Category */}
          {activeCategory === "appearance" && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div>
                <h2 className="text-base font-semibold text-white">Appearance & Display</h2>
                <p className="text-xs text-neutral-400 mt-0.5">Ambient lighting, surfaces, and visual design language</p>
              </div>

              <div className="p-5 rounded-2xl bg-[#0e0e14] border border-neutral-800/80 space-y-4 text-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-neutral-200">Background Canvas Mode</span>
                    <span className="block text-[11px] text-neutral-500 mt-0.5">Deep near-black aesthetic (#050507) for minimal eye strain</span>
                  </div>
                  <select
                    value={themeMode}
                    onChange={(e: any) => setThemeMode(e.target.value)}
                    className="bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1 text-xs text-white"
                  >
                    <option value="pure-black">OLED Pure Black (#050507)</option>
                    <option value="dark">Deep Charcoal (#0b0b10)</option>
                  </select>
                </div>

                <div className="pt-3 border-t border-neutral-800/80 flex items-center justify-between">
                  <div>
                    <span className="font-medium text-neutral-200">Subtle Ambient Glow</span>
                    <span className="block text-[11px] text-neutral-500 mt-0.5">Dynamic violet aura behind focused omnibox and active agents</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={accentGlow}
                    onChange={(e) => setAccentGlow(e.target.checked)}
                    className="rounded accent-violet-600"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Browser Chrome Category */}
          {activeCategory === "browser" && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div>
                <h2 className="text-base font-semibold text-white">Browser Navigation & Omnibox</h2>
                <p className="text-xs text-neutral-400 mt-0.5">Search providers, tab management, and selection toolbar</p>
              </div>

              <div className="p-5 rounded-2xl bg-[#0e0e14] border border-neutral-800/80 space-y-4 text-xs">
                <div>
                  <label className="text-neutral-300 block mb-1 font-medium">Default Search Provider</label>
                  <select
                    value={defaultSearchEngine}
                    onChange={(e) => setDefaultSearchEngine(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-violet-500"
                  >
                    <option value="google">Google Search (https://www.google.com/search?q=)</option>
                    <option value="duckduckgo">DuckDuckGo (https://duckduckgo.com/?q=)</option>
                    <option value="bing">Microsoft Bing (https://www.bing.com/search?q=)</option>
                  </select>
                </div>

                <div className="pt-3 border-t border-neutral-800/80 flex items-center justify-between">
                  <div>
                    <span className="font-medium text-neutral-200">Contextual Action Bar</span>
                    <span className="block text-[11px] text-neutral-500 mt-0.5">Show floating Ask, Explain, Research, Save actions on text highlight</span>
                  </div>
                  <input type="checkbox" defaultChecked className="rounded accent-violet-600" />
                </div>

                <div className="pt-3 border-t border-neutral-800/80 flex items-center justify-between">
                  <div>
                    <span className="font-medium text-neutral-200">Tab Layout Height</span>
                    <span className="block text-[11px] text-neutral-500 mt-0.5">Ultra-compact 84px top chrome granting 95% space to web view</span>
                  </div>
                  <span className="text-[11px] font-mono text-emerald-400">84px (Standard)</span>
                </div>
              </div>
            </div>
          )}

          {/* AI Models & Runtime Category */}
          {activeCategory === "ai" && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div>
                <h2 className="text-base font-semibold text-white">AI Models & Local Runtime</h2>
                <p className="text-xs text-neutral-400 mt-0.5">Local Ollama inference engine and cloud model fallback</p>
              </div>

              {/* Ollama Section */}
              <div className="p-5 rounded-2xl bg-[#0e0e14] border border-neutral-800/80 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-xs font-semibold text-white">Local Ollama Runtime</h3>
                  </div>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded font-mono font-medium ${
                      settings.isOllamaOnline
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                        : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                    }`}
                  >
                    {settings.isOllamaOnline ? "Online & Serving" : "Local Engine Offline"}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="text-neutral-400 block mb-1">Ollama API URL</label>
                    <input
                      type="text"
                      value={ollamaUrl}
                      onChange={(e) => setOllamaUrl(e.target.value)}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-violet-500"
                    />
                  </div>
                  <div>
                    <label className="text-neutral-400 block mb-1">Default Model Name</label>
                    <input
                      type="text"
                      value={ollamaModel}
                      onChange={(e) => setOllamaModel(e.target.value)}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-violet-500"
                    />
                  </div>
                </div>
              </div>

              {/* Cloud Fallback Section */}
              <div className="p-5 rounded-2xl bg-[#0e0e14] border border-neutral-800/80 space-y-4">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-violet-400" />
                  <h3 className="text-xs font-semibold text-white">Cloud Provider (OpenAI Compatible)</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="text-neutral-400 block mb-1">API Key (Optional)</label>
                    <input
                      type="password"
                      value={openAiApiKey}
                      onChange={(e) => setOpenAiApiKey(e.target.value)}
                      placeholder={settings.hasOpenAiKey ? "••••••••••••••••" : "sk-..."}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-violet-500"
                    />
                  </div>
                  <div>
                    <label className="text-neutral-400 block mb-1">Model Tag</label>
                    <input
                      type="text"
                      value={openAiModel}
                      onChange={(e) => setOpenAiModel(e.target.value)}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-violet-500"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Autonomous Agents Category */}
          {activeCategory === "agents" && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div>
                <h2 className="text-base font-semibold text-white">Autonomous Agents</h2>
                <p className="text-xs text-neutral-400 mt-0.5">Execution limits, tool capabilities, and sandbox parameters</p>
              </div>

              <div className="p-5 rounded-2xl bg-[#0e0e14] border border-neutral-800/80 space-y-4 text-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-neutral-200">Parallel Agent Limit</span>
                    <span className="block text-[11px] text-neutral-500 mt-0.5">Maximum concurrent agent routines running in background</span>
                  </div>
                  <span className="text-[11px] font-mono px-2 py-0.5 bg-neutral-900 border border-neutral-800 rounded text-neutral-300">4 Concurrent</span>
                </div>

                <div className="pt-3 border-t border-neutral-800/80 flex items-center justify-between">
                  <div>
                    <span className="font-medium text-neutral-200">Execution Timeline In Chrome</span>
                    <span className="block text-[11px] text-neutral-500 mt-0.5">Render compact agent step indicator directly in tab strip</span>
                  </div>
                  <input type="checkbox" defaultChecked className="rounded accent-violet-600" />
                </div>
              </div>
            </div>
          )}

          {/* Memory Category */}
          {activeCategory === "memory" && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div>
                <h2 className="text-base font-semibold text-white">Memory & Knowledge Graph</h2>
                <p className="text-xs text-neutral-400 mt-0.5">Long-term context persistence and entity relationship extraction</p>
              </div>

              <div className="p-5 rounded-2xl bg-[#0e0e14] border border-neutral-800/80 space-y-4 text-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-neutral-200">Automatic Context Extraction</span>
                    <span className="block text-[11px] text-neutral-500 mt-0.5">Extract core concepts and findings from research sessions</span>
                  </div>
                  <input type="checkbox" defaultChecked className="rounded accent-violet-600" />
                </div>

                <div className="pt-3 border-t border-neutral-800/80 flex items-center justify-between">
                  <div>
                    <span className="font-medium text-neutral-200">Memory Storage Engine</span>
                    <span className="block text-[11px] text-neutral-500 mt-0.5">PostgreSQL relational entity graph with vector embedding index</span>
                  </div>
                  <span className="text-[11px] font-mono text-emerald-400">PostgreSQL (Connected)</span>
                </div>
              </div>
            </div>
          )}

          {/* Research & Workflows Category */}
          {activeCategory === "research" && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div>
                <h2 className="text-base font-semibold text-white">Research & Workflow Canvases</h2>
                <p className="text-xs text-neutral-400 mt-0.5">Deep research synthesis, document drafting, and node engine</p>
              </div>

              <div className="p-5 rounded-2xl bg-[#0e0e14] border border-neutral-800/80 space-y-4 text-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-neutral-200">Auto-Generate Evidence Citing</span>
                    <span className="block text-[11px] text-neutral-500 mt-0.5">Attach URL and quote references directly to research report drafts</span>
                  </div>
                  <input type="checkbox" defaultChecked className="rounded accent-violet-600" />
                </div>

                <div className="pt-3 border-t border-neutral-800/80 flex items-center justify-between">
                  <div>
                    <span className="font-medium text-neutral-200">Workflow Animation Engine</span>
                    <span className="block text-[11px] text-neutral-500 mt-0.5">Show animated pulse connectors between active DAG nodes</span>
                  </div>
                  <input type="checkbox" defaultChecked className="rounded accent-violet-600" />
                </div>
              </div>
            </div>
          )}

          {/* Integrations Category */}
          {activeCategory === "integrations" && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div>
                <h2 className="text-base font-semibold text-white">Integrations & External APIs</h2>
                <p className="text-xs text-neutral-400 mt-0.5">Connect external developer services and web tools</p>
              </div>

              <div className="p-5 rounded-2xl bg-[#0e0e14] border border-neutral-800/80 space-y-4 text-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-neutral-200">GitHub Context Bridge</span>
                    <span className="block text-[11px] text-neutral-500 mt-0.5">Analyze repository architecture when viewing github.com URLs</span>
                  </div>
                  <span className="text-[11px] font-mono text-emerald-400">Active</span>
                </div>

                <div className="pt-3 border-t border-neutral-800/80 flex items-center justify-between">
                  <div>
                    <span className="font-medium text-neutral-200">ArXiv & Paper Reader</span>
                    <span className="block text-[11px] text-neutral-500 mt-0.5">Contextual summarizer and methodology extractor for scientific docs</span>
                  </div>
                  <span className="text-[11px] font-mono text-emerald-400">Active</span>
                </div>
              </div>
            </div>
          )}

          {/* Security & Approvals Category */}
          {activeCategory === "security" && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div>
                <h2 className="text-base font-semibold text-white">Security & Human-in-the-Loop Safety</h2>
                <p className="text-xs text-neutral-400 mt-0.5">Action authorization boundaries and write isolation</p>
              </div>

              <div className="p-5 rounded-2xl bg-[#0e0e14] border border-neutral-800/80 space-y-4 text-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-neutral-200">Require Approval on State Mutations</span>
                    <span className="block text-[11px] text-neutral-500 mt-0.5">Always ask before form submission, file modification, or purchase</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={requireWriteApproval}
                    onChange={(e) => setRequireWriteApproval(e.target.checked)}
                    className="rounded accent-amber-500"
                  />
                </div>

                <div className="pt-3 border-t border-neutral-800/80 flex items-center justify-between">
                  <div>
                    <span className="font-medium text-neutral-200">Auto-Authorize Passive Read Actions</span>
                    <span className="block text-[11px] text-neutral-500 mt-0.5">Allow agent to read DOM and search without interrupting workflow</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={autoApproveReads}
                    onChange={(e) => setAutoApproveReads(e.target.checked)}
                    className="rounded accent-amber-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Developer & System Diagnostics */}
          {activeCategory === "developer" && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div>
                <h2 className="text-base font-semibold text-white">Developer & System Diagnostics</h2>
                <p className="text-xs text-neutral-400 mt-0.5">Underlying daemon health, IPC status, and backend connectivity</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="p-4 bg-[#0e0e14] rounded-2xl border border-neutral-800/80">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-neutral-400 font-medium">PostgreSQL Engine</span>
                    <span className="text-emerald-400 font-mono text-[11px] uppercase">{dbStatus}</span>
                  </div>
                  <p className="text-[11px] text-neutral-500">Relational and vector database backend.</p>
                </div>

                <div className="p-4 bg-[#0e0e14] rounded-2xl border border-neutral-800/80">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-neutral-400 font-medium">Local Ollama Runtime</span>
                    <span className="text-amber-400 font-mono text-[11px] uppercase">{ollamaStatus}</span>
                  </div>
                  <p className="text-[11px] text-neutral-500">Local inference daemon at port 11434.</p>
                </div>

                <div className="p-4 bg-[#0e0e14] rounded-2xl border border-neutral-800/80">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-neutral-400 font-medium">WebSocket Event Bus</span>
                    <span className="text-emerald-400 font-mono text-[11px] uppercase">CONNECTED</span>
                  </div>
                  <p className="text-[11px] text-neutral-500">Real-time bi-directional agent events.</p>
                </div>

                <div className="p-4 bg-[#0e0e14] rounded-2xl border border-neutral-800/80">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-neutral-400 font-medium">NEXUS Platform Version</span>
                    <span className="text-violet-400 font-mono text-[11px] uppercase">v1.0.0-PROD</span>
                  </div>
                  <p className="text-[11px] text-neutral-500">The AI Browser Operating System.</p>
                </div>
              </div>
            </div>
          )}

          {/* Bottom Save Bar for preferences */}
          {["general", "appearance", "browser", "ai", "agents", "memory", "research", "integrations", "security"].includes(activeCategory) && (
            <div className="pt-4 border-t border-neutral-800/80 flex items-center gap-3">
              <button
                type="button"
                onClick={() => handleSave()}
                disabled={isSaving}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/30 transition disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSaving ? "Saving..." : "Save Preferences"}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
