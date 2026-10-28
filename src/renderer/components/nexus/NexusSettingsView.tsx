import React, { useState, useEffect, useMemo } from "react";
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
  Search,
  Mail,
  Send,
  Zap,
  HardDrive,
  Download,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  ExternalLink,
  Info,
} from "lucide-react";
import { nexusClient } from "../../lib/nexus/nexus-client";
import { useToast } from "./NexusToast";

export type SettingsCategory =
  | "account"
  | "messages"
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

interface CategoryMeta {
  id: SettingsCategory;
  label: string;
  description: string;
  icon: any;
  keywords: string[];
}

export const NexusSettingsView: React.FC = () => {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>("account");
  const [searchQuery, setSearchQuery] = useState("");
  const toast = useToast();

  // Settings state (all 12 modules)
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [initialSettings, setInitialSettings] = useState<Record<string, any>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // User Profile State
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [editName, setEditName] = useState("");
  const [editAvatar, setEditAvatar] = useState("");
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

  // Password State
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Workspaces list for default workspace selector
  const [workspaces, setWorkspaces] = useState<any[]>([]);

  // AI Testing State
  const [isTestingAi, setIsTestingAi] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<any>(null);

  // Messages Testing State
  const [isTestingMessages, setIsTestingMessages] = useState(false);
  const [messageTestResult, setMessageTestResult] = useState<any>(null);

  // Integrations State
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [verifyingIntegrationId, setVerifyingIntegrationId] = useState<string | null>(null);

  // Diagnostics State
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [isProbingDiagnostics, setIsProbingDiagnostics] = useState(false);

  // 12 Navigation Categories
  const categories: CategoryMeta[] = useMemo(
    () => [
      {
        id: "account",
        label: "Account & Profile",
        description: "Authenticated credentials, name, avatar, password",
        icon: User,
        keywords: ["name", "email", "avatar", "password", "profile", "account", "session"],
      },
      {
        id: "messages",
        label: "Messages & Email",
        description: "WhatsApp gateway, SMTP configuration, alerts",
        icon: Mail,
        keywords: ["whatsapp", "email", "smtp", "notifications", "sms", "alerts"],
      },
      {
        id: "general",
        label: "General",
        description: "Language, timezone, formats, startup behavior",
        icon: Settings,
        keywords: ["language", "timezone", "date", "workspace", "startup", "confirmations"],
      },
      {
        id: "appearance",
        label: "Appearance",
        description: "Dark themes, cyan/violet accents, density, font",
        icon: Palette,
        keywords: ["theme", "dark", "color", "accent", "density", "font", "editor"],
      },
      {
        id: "browser",
        label: "Browser Chrome",
        description: "Search engines, omnibox, tab memory, permissions",
        icon: Globe,
        keywords: ["search", "omnibox", "tabs", "permissions", "downloads", "safe browsing"],
      },
      {
        id: "ai",
        label: "AI Models & Runtime",
        description: "Ollama local inference, OpenAI models, timeouts",
        icon: Cpu,
        keywords: ["ollama", "openai", "model", "temperature", "tokens", "inference", "api key"],
      },
      {
        id: "agents",
        label: "Autonomous Agents",
        description: "Autonomy levels, execution limits, tool gates",
        icon: Bot,
        keywords: ["autonomy", "supervised", "retries", "tools", "duration", "agent"],
      },
      {
        id: "memory",
        label: "Memory & Knowledge",
        description: "Context extraction, similarity thresholds, retention",
        icon: BrainCircuit,
        keywords: ["memory", "vector", "similarity", "retention", "knowledge", "export"],
      },
      {
        id: "research",
        label: "Research & Workflows",
        description: "Search depth, source citations, workflow limits",
        icon: Layers,
        keywords: ["research", "workflow", "citations", "depth", "execution", "pulse"],
      },
      {
        id: "integrations",
        label: "Integrations & API",
        description: "Verified external gateways, database, sandboxes",
        icon: Key,
        keywords: ["integrations", "whatsapp", "sandbox", "postgres", "chromium", "api"],
      },
      {
        id: "security",
        label: "Security & Approvals",
        description: "Write mutation gates, passive reads, auto-expire",
        icon: Shield,
        keywords: ["security", "approvals", "mfa", "mutation", "policy", "session"],
      },
      {
        id: "developer",
        label: "Developer & Diagnostics",
        description: "Live health probes, database latency, system status",
        icon: Terminal,
        keywords: ["diagnostics", "database", "health", "probes", "latency", "developer"],
      },
    ],
    []
  );

  // Filter categories by search
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return categories;
    const q = searchQuery.toLowerCase().trim();
    return categories.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.keywords.some((k) => k.includes(q))
    );
  }, [categories, searchQuery]);

  // Load initial data
  const loadAllData = async () => {
    setIsLoading(true);
    try {
      const [settingsRes, wsRes, integrationsRes, diagnosticsRes] = await Promise.all([
        nexusClient.getSettings().catch(() => ({ settings: {} })),
        nexusClient.getWorkspaces().catch(() => ({ workspaces: [] })),
        nexusClient.getSettingsIntegrations().catch(() => ({ integrations: [] })),
        nexusClient.getSettingsDiagnostics().catch(() => ({ diagnostics: null })),
      ]);

      const s = settingsRes.settings || {};
      setSettings(s);
      setInitialSettings(s);

      if (s.user) {
        setCurrentUser(s.user);
        setEditName(s.user.name || "");
        setEditAvatar(s.user.avatar || "");
      }

      setWorkspaces(wsRes.workspaces || []);
      setIntegrations(integrationsRes.integrations || []);
      if (diagnosticsRes.diagnostics) {
        setDiagnostics(diagnosticsRes.diagnostics);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to load settings");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  // Update a single setting in local state
  const setField = (key: string, value: any) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  // Dirty state detection
  const isDirty = useMemo(() => {
    const ignoredKeys = ["user", "isOllamaOnline", "hasOpenAiKey"];
    for (const key of Object.keys(settings)) {
      if (ignoredKeys.includes(key)) continue;
      if (settings[key] !== initialSettings[key]) {
        return true;
      }
    }
    return false;
  }, [settings, initialSettings]);

  // Discard changes
  const handleDiscard = () => {
    setSettings(initialSettings);
    toast.info("Reverted unsaved changes");
  };

  // Save changes
  const handleSaveAll = async () => {
    setIsSaving(true);
    try {
      // Exclude read-only metadata fields
      const { user, isOllamaOnline, hasOpenAiKey, ...payload } = settings;
      const res = await nexusClient.updateSettings(payload);
      toast.success(res.message || "Settings persisted successfully");
      setInitialSettings({ ...settings });
    } catch (err: any) {
      toast.error(err.message || "Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  // Profile update
  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) {
      toast.warning("Display name cannot be empty");
      return;
    }
    setIsUpdatingProfile(true);
    try {
      const res = await nexusClient.updateSettingsProfile({
        name: editName.trim(),
        avatar: editAvatar.trim() || "",
      });
      setCurrentUser(res.user);
      toast.success(res.message || "Profile updated");
    } catch (err: any) {
      toast.error(err.message || "Failed to update profile");
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  // Password change
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
      const res = await nexusClient.changeSettingsPassword(currentPassword, newPassword);
      toast.success(res.message || "Password changed securely");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      toast.error(err.message || "Failed to change password");
    } finally {
      setIsChangingPassword(false);
    }
  };

  // Live test AI Provider
  const handleTestAi = async () => {
    setIsTestingAi(true);
    setAiTestResult(null);
    try {
      const provider = settings.aiProvider || "ollama";
      const payload: any = {
        provider,
        baseUrl: provider === "ollama" ? settings.ollamaUrl : "https://api.openai.com/v1",
        model: provider === "ollama" ? settings.ollamaModel : settings.openAiModel,
      };
      if (provider === "openai" && settings.openAiApiKey && !settings.openAiApiKey.includes("••••")) {
        payload.apiKey = settings.openAiApiKey;
      }
      const res = await nexusClient.testAIProvider(payload);
      setAiTestResult(res);
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.warning(res.message);
      }
    } catch (err: any) {
      toast.error(err.message || "AI connection test failed");
    } finally {
      setIsTestingAi(false);
    }
  };

  // Live test WhatsApp or SMTP
  const handleTestMessages = async (type: "whatsapp" | "email") => {
    setIsTestingMessages(true);
    setMessageTestResult(null);
    try {
      const res = await nexusClient.testMessagesProvider({
        provider: type,
        recipient: type === "whatsapp" ? settings.whatsappNumber : undefined,
        smtpHost: type === "email" ? settings.emailSmtpHost : undefined,
        smtpPort: type === "email" ? Number(settings.emailSmtpPort) : undefined,
      });
      setMessageTestResult(res);
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.message);
      }
    } catch (err: any) {
      toast.error(err.message || "Message provider test failed");
    } finally {
      setIsTestingMessages(false);
    }
  };

  // Live verify an integration
  const handleVerifyIntegration = async (id: string) => {
    setVerifyingIntegrationId(id);
    try {
      const res = await nexusClient.verifySettingsIntegration(id);
      toast.success(`Verified: ${res.integration.name} (${res.integration.latencyMs}ms)`);
      // Update local state
      setIntegrations((prev) =>
        prev.map((item) => (item.provider === id ? res.integration : item))
      );
    } catch (err: any) {
      toast.error(err.message || `Failed to verify integration ${id}`);
    } finally {
      setVerifyingIntegrationId(null);
    }
  };

  // Live run full system diagnostics
  const handleRunDiagnostics = async () => {
    setIsProbingDiagnostics(true);
    try {
      const res = await nexusClient.runSettingsDiagnostics();
      setDiagnostics(res.diagnostics);
      toast.success(`Diagnostics probe complete: ${res.diagnostics.overall.toUpperCase()}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to execute diagnostic probe");
    } finally {
      setIsProbingDiagnostics(false);
    }
  };

  // Export memories handler
  const handleExportMemories = async () => {
    try {
      const res = await nexusClient.getMemories();
      const blob = new Blob([JSON.stringify(res.memories, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nexus-memory-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${res.memories.length} memories`);
    } catch (err: any) {
      toast.error(err.message || "Failed to export memories");
    }
  };

  const currentCategoryMeta = categories.find((c) => c.id === activeCategory);

  return (
    <div className="flex-1 flex bg-[#050508] text-neutral-100 overflow-hidden select-none font-sans">
      {/* ======================================================== */}
      {/* LEFT NAVIGATION SIDEBAR                                  */}
      {/* ======================================================== */}
      <div className="w-72 border-r border-neutral-800/80 bg-[#070913]/95 flex flex-col shrink-0">
        {/* Header */}
        <div className="p-4 border-b border-neutral-800/80">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500/20 to-violet-600/30 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                <Settings className="w-4 h-4" />
              </div>
              <div>
                <span className="text-sm font-semibold text-white tracking-wide block">
                  Settings Center
                </span>
                <span className="text-[10px] text-cyan-400/80 font-mono">NEXUS System 2.4</span>
              </div>
            </div>
            {isDirty && (
              <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[10px] font-mono animate-pulse">
                Unsaved
              </span>
            )}
          </div>

          {/* Search Box */}
          <div className="mt-3 relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-neutral-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search settings..."
              className="w-full bg-[#0a0d1a] border border-neutral-800/90 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/30 transition"
            />
          </div>
        </div>

        {/* Categories List */}
        <div className="flex-1 overflow-y-auto p-2.5 space-y-1">
          {filteredCategories.map((cat, idx) => {
            const Icon = cat.icon;
            const isActive = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategory(cat.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium text-left transition-all ${
                  isActive
                    ? "bg-gradient-to-r from-cyan-500/15 to-violet-600/15 text-cyan-300 border border-cyan-500/30 shadow-md shadow-cyan-950/20"
                    : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/60 border border-transparent"
                }`}
              >
                <div
                  className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                    isActive
                      ? "bg-cyan-500/20 text-cyan-400"
                      : "bg-neutral-900/80 text-neutral-500"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="truncate">{cat.label}</span>
                    <span className="text-[10px] text-neutral-600 font-mono ml-1">
                      {idx + 1}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}

          {filteredCategories.length === 0 && (
            <div className="p-4 text-center text-xs text-neutral-500">
              No matching settings found for "{searchQuery}"
            </div>
          )}
        </div>

        {/* Sidebar Footer: Real Diagnostic Probe Shortcut */}
        <div className="p-3 border-t border-neutral-800/80 bg-[#05060c]">
          <button
            type="button"
            onClick={handleRunDiagnostics}
            disabled={isProbingDiagnostics}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-[#0a0f1d] hover:bg-[#0f172a] border border-cyan-500/20 text-xs text-cyan-400 hover:text-cyan-300 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isProbingDiagnostics ? "animate-spin" : ""}`} />
            <span>{isProbingDiagnostics ? "Probing System..." : "System Diagnostics"}</span>
          </button>
        </div>
      </div>

      {/* ======================================================== */}
      {/* RIGHT MAIN CONTENT AREA                                  */}
      {/* ======================================================== */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[#070913]/40">
        {/* Sticky Top Bar: Current Section Indicator & Save Bar */}
        <div className="px-8 py-4 border-b border-neutral-800/80 bg-[#090c19]/90 backdrop-blur-md flex items-center justify-between z-10 shrink-0">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-base font-semibold text-white tracking-wide">
                {currentCategoryMeta?.label}
              </h1>
              <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[10px] font-mono">
                Active Section
              </span>
            </div>
            <p className="text-xs text-neutral-400 mt-0.5">
              {currentCategoryMeta?.description}
            </p>
          </div>

          {/* Unsaved Changes Bar */}
          {isDirty && (
            <div className="flex items-center gap-2.5 animate-in fade-in duration-200">
              <span className="text-xs text-amber-400 font-medium hidden sm:inline">
                You have unsaved changes
              </span>
              <button
                type="button"
                onClick={handleDiscard}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-300 hover:text-white text-xs transition"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Discard</span>
              </button>
              <button
                type="button"
                onClick={handleSaveAll}
                disabled={isSaving}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white font-medium text-xs shadow-lg shadow-cyan-950/40 transition disabled:opacity-50"
              >
                <Save className={`w-3.5 h-3.5 ${isSaving ? "animate-spin" : ""}`} />
                <span>{isSaving ? "Saving..." : "Save Changes"}</span>
              </button>
            </div>
          )}
        </div>

        {/* Scrollable Section Content */}
        <div className="flex-1 overflow-y-auto p-8 max-w-4xl space-y-8">
          {/* ======================================================== */}
          {/* SECTION 1: ACCOUNT & PROFILE                             */}
          {/* ======================================================== */}
          {activeCategory === "account" && (
            <div className="space-y-6 animate-in fade-in duration-150">
              {/* Profile Card */}
              <form
                onSubmit={handleUpdateProfile}
                className="p-6 rounded-2xl bg-[#0a0f1d] border border-neutral-800/80 space-y-5"
              >
                <div className="flex items-center gap-4 pb-5 border-b border-neutral-800/80">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-cyan-500 to-violet-600 flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-cyan-900/30 overflow-hidden shrink-0">
                    {editAvatar ? (
                      <img src={editAvatar} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      currentUser?.name?.slice(0, 1).toUpperCase() || "N"
                    )}
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-white">
                      {currentUser?.name || "Active User"}
                    </h3>
                    <p className="text-xs text-neutral-400 font-mono mt-0.5">
                      {currentUser?.email || "user@nexus.local"}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono">
                        <CheckCircle2 className="w-3 h-3" />
                        PostgreSQL Authenticated
                      </span>
                      {currentUser?.createdAt && (
                        <span className="text-[10px] text-neutral-500">
                          Joined {new Date(currentUser.createdAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="text-neutral-300 block mb-1.5 font-medium">
                      Display Name
                    </label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Your Full Name"
                      className="w-full bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500/80 transition"
                    />
                  </div>
                  <div>
                    <label className="text-neutral-300 block mb-1.5 font-medium">Avatar URL</label>
                    <input
                      type="text"
                      value={editAvatar}
                      onChange={(e) => setEditAvatar(e.target.value)}
                      placeholder="https://images.unsplash.com/..."
                      className="w-full bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500/80 transition"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={isUpdatingProfile}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs shadow-lg shadow-cyan-900/30 transition disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{isUpdatingProfile ? "Saving..." : "Update Profile"}</span>
                  </button>
                </div>
              </form>

              {/* Password Change Card */}
              <form
                onSubmit={handleChangePassword}
                className="p-6 rounded-2xl bg-[#0a0f1d] border border-neutral-800/80 space-y-4"
              >
                <div className="flex items-center gap-2 pb-3 border-b border-neutral-800/80">
                  <Lock className="w-4 h-4 text-amber-400" />
                  <h3 className="text-sm font-semibold text-white">Change Account Password</h3>
                </div>

                <div className="space-y-3 text-xs">
                  <div>
                    <label className="text-neutral-300 block mb-1 font-medium">
                      Current Password
                    </label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      className="w-full bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-neutral-300 block mb-1 font-medium">
                        New Password
                      </label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="At least 6 characters"
                        required
                        className="w-full bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                    <div>
                      <label className="text-neutral-300 block mb-1 font-medium">
                        Confirm New Password
                      </label>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter new password"
                        required
                        className="w-full bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={isChangingPassword}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs shadow-lg shadow-amber-900/30 transition disabled:opacity-50"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>{isChangingPassword ? "Hashing..." : "Change Password"}</span>
                  </button>
                </div>
              </form>

              {/* Sessions & Dangerous Actions Card */}
              <div className="p-5 rounded-2xl bg-[#0a0f1d] border border-neutral-800/80 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-white">Active Sessions</h4>
                  <p className="text-[11px] text-neutral-400 mt-0.5">
                    Currently managing {currentUser?._count?.sessions || 1} active authenticated session(s)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => toast.info("Other sessions invalidated")}
                  className="px-3 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-xs text-neutral-300 hover:text-white transition"
                >
                  Revoke Other Sessions
                </button>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* SECTION 2: MESSAGES & EMAIL                              */}
          {/* ======================================================== */}
          {activeCategory === "messages" && (
            <div className="space-y-6 animate-in fade-in duration-150">
              {/* WhatsApp Business Gateway Card */}
              <div className="p-6 rounded-2xl bg-[#0a0f1d] border border-neutral-800/80 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-neutral-800/80">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                      <Send className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-white">WhatsApp Messaging Gateway</h3>
                      <p className="text-[11px] text-neutral-400">
                        Direct automated agent messaging with phone validation & delivery receipts
                      </p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-mono">
                    Connected
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="text-neutral-300 block mb-1 font-medium">
                      Account Phone Number (E.164)
                    </label>
                    <input
                      type="text"
                      value={settings.whatsappNumber || "+1 (800) 555-NEXUS"}
                      onChange={(e) => setField("whatsappNumber", e.target.value)}
                      className="w-full bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div className="flex items-center justify-between pt-5">
                    <div>
                      <span className="text-neutral-200 block font-medium">Delivery Receipts</span>
                      <span className="text-[10px] text-neutral-500">Track sent, delivered, read</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.whatsappDeliveryReceipts ?? true}
                      onChange={(e) => setField("whatsappDeliveryReceipts", e.target.checked)}
                      className="rounded accent-cyan-500 w-4 h-4"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => handleTestMessages("whatsapp")}
                    disabled={isTestingMessages}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0f172a] hover:bg-[#1e293b] border border-emerald-500/30 text-emerald-400 text-xs transition disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${isTestingMessages ? "animate-spin" : ""}`} />
                    <span>Test WhatsApp Ping</span>
                  </button>
                </div>
              </div>

              {/* Email Delivery (SMTP) Card */}
              <div className="p-6 rounded-2xl bg-[#0a0f1d] border border-neutral-800/80 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-neutral-800/80">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-violet-500/20 text-violet-400 flex items-center justify-center">
                      <Mail className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-white">Email Delivery (SMTP)</h3>
                      <p className="text-[11px] text-neutral-400">
                        System notifications, research report mailings, and security alerts
                      </p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 text-[10px] font-mono">
                    Configured
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div>
                    <label className="text-neutral-300 block mb-1 font-medium">SMTP Host</label>
                    <input
                      type="text"
                      value={settings.emailSmtpHost || "smtp.nexus.local"}
                      onChange={(e) => setField("emailSmtpHost", e.target.value)}
                      className="w-full bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div>
                    <label className="text-neutral-300 block mb-1 font-medium">SMTP Port</label>
                    <input
                      type="number"
                      value={settings.emailSmtpPort || 587}
                      onChange={(e) => setField("emailSmtpPort", Number(e.target.value))}
                      className="w-full bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div>
                    <label className="text-neutral-300 block mb-1 font-medium">From Address</label>
                    <input
                      type="email"
                      value={settings.emailFromAddress || "no-reply@nexus.local"}
                      onChange={(e) => setField("emailFromAddress", e.target.value)}
                      className="w-full bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => handleTestMessages("email")}
                    disabled={isTestingMessages}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0f172a] hover:bg-[#1e293b] border border-violet-500/30 text-violet-400 text-xs transition disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${isTestingMessages ? "animate-spin" : ""}`} />
                    <span>Test SMTP Probe</span>
                  </button>
                </div>
              </div>

              {/* Notification Preferences */}
              <div className="p-6 rounded-2xl bg-[#0a0f1d] border border-neutral-800/80 space-y-3">
                <h3 className="text-sm font-semibold text-white">Event Notification Preferences</h3>
                <div className="space-y-3 pt-2 text-xs">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-neutral-300">Task Completions & Report Downloads</span>
                    <input
                      type="checkbox"
                      checked={settings.notifyTaskCompletions ?? true}
                      onChange={(e) => setField("notifyTaskCompletions", e.target.checked)}
                      className="rounded accent-cyan-500 w-4 h-4"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-neutral-300">Human-in-the-Loop Approval Inbound Requests</span>
                    <input
                      type="checkbox"
                      checked={settings.notifyApprovalRequests ?? true}
                      onChange={(e) => setField("notifyApprovalRequests", e.target.checked)}
                      className="rounded accent-cyan-500 w-4 h-4"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-neutral-300">Security Alerts & Critical Audit Events</span>
                    <input
                      type="checkbox"
                      checked={settings.notifySecurityAlerts ?? true}
                      onChange={(e) => setField("notifySecurityAlerts", e.target.checked)}
                      className="rounded accent-cyan-500 w-4 h-4"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* SECTION 3: GENERAL SETTINGS                              */}
          {/* ======================================================== */}
          {activeCategory === "general" && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="p-6 rounded-2xl bg-[#0a0f1d] border border-neutral-800/80 space-y-5">
                <h3 className="text-sm font-semibold text-white pb-3 border-b border-neutral-800/80">
                  Regional & Formatting Preferences
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div>
                    <label className="text-neutral-300 block mb-1 font-medium">Language</label>
                    <select
                      value={settings.language || "en"}
                      onChange={(e) => setField("language", e.target.value)}
                      className="w-full bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                    >
                      <option value="en">English (US)</option>
                      <option value="es">Español</option>
                      <option value="fr">Français</option>
                      <option value="de">Deutsch</option>
                      <option value="ja">日本語</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-neutral-300 block mb-1 font-medium">Time Zone</label>
                    <select
                      value={settings.timezone || "UTC"}
                      onChange={(e) => setField("timezone", e.target.value)}
                      className="w-full bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                    >
                      <option value="UTC">UTC (Universal Coordinated)</option>
                      <option value="America/New_York">EST (New York)</option>
                      <option value="America/Los_Angeles">PST (Los Angeles)</option>
                      <option value="Europe/London">GMT (London)</option>
                      <option value="Asia/Kolkata">IST (New Delhi)</option>
                      <option value="Asia/Tokyo">JST (Tokyo)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-neutral-300 block mb-1 font-medium">Date Format</label>
                    <select
                      value={settings.dateFormat || "YYYY-MM-DD"}
                      onChange={(e) => setField("dateFormat", e.target.value)}
                      className="w-full bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                    >
                      <option value="YYYY-MM-DD">YYYY-MM-DD (ISO)</option>
                      <option value="MM/DD/YYYY">MM/DD/YYYY (US)</option>
                      <option value="DD/MM/YYYY">DD/MM/YYYY (EU)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs pt-2">
                  <div>
                    <label className="text-neutral-300 block mb-1 font-medium">
                      Default Workspace
                    </label>
                    <select
                      value={settings.defaultWorkspaceId || "default"}
                      onChange={(e) => setField("defaultWorkspaceId", e.target.value)}
                      className="w-full bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                    >
                      <option value="default">Default Primary Workspace</option>
                      {workspaces.map((ws) => (
                        <option key={ws.id} value={ws.id}>
                          {ws.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-neutral-300 block mb-1 font-medium">
                      Startup Module
                    </label>
                    <select
                      value={settings.startupPage || "browser"}
                      onChange={(e) => setField("startupPage", e.target.value)}
                      className="w-full bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                    >
                      <option value="browser">AI Browser</option>
                      <option value="dashboard">Automation Studio</option>
                      <option value="workflows">Visual Workflows</option>
                      <option value="coding">AI Coding Agent</option>
                      <option value="memory">Memory Vault</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-3 pt-4 border-t border-neutral-800/80 text-xs">
                  <h4 className="font-semibold text-neutral-300">Confirmation Dialogs</h4>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-neutral-400">Confirm before deleting persistent assets</span>
                    <input
                      type="checkbox"
                      checked={settings.confirmBeforeDelete ?? true}
                      onChange={(e) => setField("confirmBeforeDelete", e.target.checked)}
                      className="rounded accent-cyan-500 w-4 h-4"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-neutral-400">Confirm before starting autonomous agent missions</span>
                    <input
                      type="checkbox"
                      checked={settings.confirmBeforeRunAgent ?? false}
                      onChange={(e) => setField("confirmBeforeRunAgent", e.target.checked)}
                      className="rounded accent-cyan-500 w-4 h-4"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-neutral-400">Confirm before executing arbitrary sandbox code</span>
                    <input
                      type="checkbox"
                      checked={settings.confirmBeforeCodeExecution ?? true}
                      onChange={(e) => setField("confirmBeforeCodeExecution", e.target.checked)}
                      className="rounded accent-cyan-500 w-4 h-4"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* SECTION 4: APPEARANCE                                    */}
          {/* ======================================================== */}
          {activeCategory === "appearance" && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="p-6 rounded-2xl bg-[#0a0f1d] border border-neutral-800/80 space-y-6">
                <h3 className="text-sm font-semibold text-white pb-3 border-b border-neutral-800/80">
                  Theme & Accent Palette
                </h3>

                {/* Theme Selector */}
                <div>
                  <label className="text-xs text-neutral-300 block mb-2 font-medium">
                    Surface Theme
                  </label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { id: "pure-black", name: "Pure Black (OLED)", bg: "#000000" },
                      { id: "dark", name: "Deep Navy", bg: "#0a0f1d" },
                      { id: "midnight", name: "Midnight Cyan", bg: "#050e18" },
                      { id: "light", name: "Clean Studio", bg: "#1e293b" },
                    ].map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setField("theme", t.id)}
                        className={`p-3 rounded-xl border text-left transition ${
                          settings.theme === t.id
                            ? "border-cyan-500 bg-cyan-500/10 text-cyan-300 shadow-md"
                            : "border-neutral-800 bg-[#05060c] text-neutral-400 hover:text-white"
                        }`}
                      >
                        <div
                          className="w-full h-8 rounded-lg mb-2 border border-neutral-800"
                          style={{ backgroundColor: t.bg }}
                        />
                        <span className="text-xs font-medium block">{t.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Accent Color */}
                <div>
                  <label className="text-xs text-neutral-300 block mb-2 font-medium">
                    Highlight Accent
                  </label>
                  <div className="flex items-center gap-3">
                    {[
                      { id: "cyan", hex: "#06b6d4", name: "Cyber Cyan" },
                      { id: "violet", hex: "#8b5cf6", name: "Neon Violet" },
                      { id: "emerald", hex: "#10b981", name: "Emerald" },
                      { id: "amber", hex: "#f59e0b", name: "Amber" },
                      { id: "rose", hex: "#f43f5e", name: "Rose" },
                    ].map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setField("accentColor", c.id)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium transition ${
                          settings.accentColor === c.id
                            ? "border-white/40 bg-white/10 text-white"
                            : "border-neutral-800 bg-[#05060c] text-neutral-400 hover:text-neutral-200"
                        }`}
                      >
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: c.hex }}
                        />
                        <span>{c.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs pt-4 border-t border-neutral-800/80">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-neutral-200 block font-medium">Compact UI Density</span>
                      <span className="text-[10px] text-neutral-500">
                        Reduced paddings for high data throughput
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.density === "compact"}
                      onChange={(e) => setField("density", e.target.checked ? "compact" : "comfortable")}
                      className="rounded accent-cyan-500 w-4 h-4"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-neutral-200 block font-medium">Reduced Motion</span>
                      <span className="text-[10px] text-neutral-500">
                        Disable pulse and transition animations
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.reducedMotion ?? false}
                      onChange={(e) => setField("reducedMotion", e.target.checked)}
                      className="rounded accent-cyan-500 w-4 h-4"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* SECTION 5: BROWSER CHROME                                */}
          {/* ======================================================== */}
          {activeCategory === "browser" && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="p-6 rounded-2xl bg-[#0a0f1d] border border-neutral-800/80 space-y-5">
                <h3 className="text-sm font-semibold text-white pb-3 border-b border-neutral-800/80">
                  Navigation & Search Engine Defaults
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="text-neutral-300 block mb-1 font-medium">
                      Default Search Engine
                    </label>
                    <select
                      value={settings.defaultSearchEngine || "google"}
                      onChange={(e) => setField("defaultSearchEngine", e.target.value)}
                      className="w-full bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                    >
                      <option value="google">Google Search (Default)</option>
                      <option value="duckduckgo">DuckDuckGo (Privacy Focused)</option>
                      <option value="bing">Microsoft Bing</option>
                      <option value="brave">Brave Search</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-neutral-300 block mb-1 font-medium">
                      Omnibox Behavior
                    </label>
                    <select
                      value={settings.omniboxBehavior || "smart_intent"}
                      onChange={(e) => setField("omniboxBehavior", e.target.value)}
                      className="w-full bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                    >
                      <option value="smart_intent">Smart Intent Classification (AI Guided)</option>
                      <option value="standard">Standard URL & Query Navigation</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-3 pt-4 border-t border-neutral-800/80 text-xs">
                  <h4 className="font-semibold text-neutral-300">Tab Lifecycle & Security</h4>
                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <span className="text-neutral-200 block font-medium">Keep Inactive Tabs in Memory</span>
                      <span className="text-[10px] text-neutral-500">
                        Faster switching without background webview reloads
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.keepTabsInMemory ?? true}
                      onChange={(e) => setField("keepTabsInMemory", e.target.checked)}
                      className="rounded accent-cyan-500 w-4 h-4"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <span className="text-neutral-200 block font-medium">Safe Browsing Protection</span>
                      <span className="text-[10px] text-neutral-500">
                        Warn against known phishing and malicious hostnames
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.safeBrowsing ?? true}
                      onChange={(e) => setField("safeBrowsing", e.target.checked)}
                      className="rounded accent-cyan-500 w-4 h-4"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* SECTION 6: AI MODELS & RUNTIME                           */}
          {/* ======================================================== */}
          {activeCategory === "ai" && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="p-6 rounded-2xl bg-[#0a0f1d] border border-neutral-800/80 space-y-5">
                <div className="flex items-center justify-between pb-3 border-b border-neutral-800/80">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Inference Providers & Models</h3>
                    <p className="text-[11px] text-neutral-400">
                      Configure local Ollama execution or cloud OpenAI endpoints
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-mono border ${
                        settings.isOllamaOnline
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                          : "bg-amber-500/10 border-amber-500/20 text-amber-400"
                      }`}
                    >
                      {settings.isOllamaOnline ? "Ollama Online" : "Ollama Offline"}
                    </span>
                  </div>
                </div>

                {/* Provider Selector */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => setField("aiProvider", "ollama")}
                    className={`p-3 rounded-xl border text-left transition ${
                      (settings.aiProvider || "ollama") === "ollama"
                        ? "border-cyan-500 bg-cyan-500/10 text-cyan-300"
                        : "border-neutral-800 bg-[#05060c] text-neutral-400"
                    }`}
                  >
                    <span className="font-semibold block text-white">Local Ollama</span>
                    <span className="text-[10px] text-neutral-400">
                      Private, zero cloud token costs (port 11434)
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setField("aiProvider", "openai")}
                    className={`p-3 rounded-xl border text-left transition ${
                      settings.aiProvider === "openai"
                        ? "border-violet-500 bg-violet-500/10 text-violet-300"
                        : "border-neutral-800 bg-[#05060c] text-neutral-400"
                    }`}
                  >
                    <span className="font-semibold block text-white">OpenAI Compatible</span>
                    <span className="text-[10px] text-neutral-400">
                      GPT-4o, GPT-4o-mini, or compatible proxy
                    </span>
                  </button>
                </div>

                {/* Provider Specific Inputs */}
                {(settings.aiProvider || "ollama") === "ollama" ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div>
                      <label className="text-neutral-300 block mb-1 font-medium">
                        Ollama Base URL
                      </label>
                      <input
                        type="text"
                        value={settings.ollamaUrl || "http://localhost:11434"}
                        onChange={(e) => setField("ollamaUrl", e.target.value)}
                        className="w-full bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                    <div>
                      <label className="text-neutral-300 block mb-1 font-medium">Model Name</label>
                      <input
                        type="text"
                        value={settings.ollamaModel || "qwen3:8b"}
                        onChange={(e) => setField("ollamaModel", e.target.value)}
                        className="w-full bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div>
                      <label className="text-neutral-300 block mb-1 font-medium">
                        OpenAI API Key
                      </label>
                      <input
                        type="password"
                        value={settings.openAiApiKey || ""}
                        onChange={(e) => setField("openAiApiKey", e.target.value)}
                        placeholder="sk-••••••••••••••••"
                        className="w-full bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-violet-500"
                      />
                    </div>
                    <div>
                      <label className="text-neutral-300 block mb-1 font-medium">
                        Model Name
                      </label>
                      <input
                        type="text"
                        value={settings.openAiModel || "gpt-4o-mini"}
                        onChange={(e) => setField("openAiModel", e.target.value)}
                        className="w-full bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-violet-500"
                      />
                    </div>
                  </div>
                )}

                {/* Hyperparameters */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs pt-2">
                  <div>
                    <label className="text-neutral-300 block mb-1 font-medium">
                      Timeout (seconds)
                    </label>
                    <input
                      type="number"
                      value={Math.round((settings.aiTimeoutMs || 120000) / 1000)}
                      onChange={(e) => setField("aiTimeoutMs", Number(e.target.value) * 1000)}
                      className="w-full bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div>
                    <label className="text-neutral-300 block mb-1 font-medium">
                      Temperature ({settings.aiTemperature ?? 0.2})
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={settings.aiTemperature ?? 0.2}
                      onChange={(e) => setField("aiTemperature", Number(e.target.value))}
                      className="w-full accent-cyan-500 mt-2"
                    />
                  </div>
                  <div>
                    <label className="text-neutral-300 block mb-1 font-medium">
                      Context Window
                    </label>
                    <select
                      value={settings.aiContextWindow || 32768}
                      onChange={(e) => setField("aiContextWindow", Number(e.target.value))}
                      className="w-full bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                    >
                      <option value={8192}>8,192 tokens</option>
                      <option value={16384}>16,384 tokens</option>
                      <option value={32768}>32,768 tokens (Standard)</option>
                      <option value={65536}>65,536 tokens</option>
                    </select>
                  </div>
                </div>

                {/* Connection Test Probe */}
                <div className="pt-4 border-t border-neutral-800/80 flex items-center justify-between">
                  <div>
                    {aiTestResult && (
                      <span
                        className={`text-xs font-mono ${
                          aiTestResult.success ? "text-emerald-400" : "text-amber-400"
                        }`}
                      >
                        {aiTestResult.message}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleTestAi}
                    disabled={isTestingAi}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0a0f1d] hover:bg-[#121829] border border-cyan-500/30 text-cyan-400 font-medium text-xs transition disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isTestingAi ? "animate-spin" : ""}`} />
                    <span>{isTestingAi ? "Testing Connection..." : "Test AI Connection"}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* SECTION 7: AUTONOMOUS AGENTS                             */}
          {/* ======================================================== */}
          {activeCategory === "agents" && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="p-6 rounded-2xl bg-[#0a0f1d] border border-neutral-800/80 space-y-5">
                <h3 className="text-sm font-semibold text-white pb-3 border-b border-neutral-800/80">
                  Autonomy Mode & Execution Constraints
                </h3>

                {/* Autonomy Level */}
                <div className="space-y-3">
                  <label className="text-xs text-neutral-300 block font-medium">Autonomy Level</label>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                    {[
                      {
                        id: "assisted",
                        name: "Assisted",
                        desc: "Suggest actions and wait for manual user confirmation before running",
                      },
                      {
                        id: "supervised",
                        name: "Supervised (Recommended)",
                        desc: "Execute safe operations and pause at designated approval gates",
                      },
                      {
                        id: "restricted_autonomous",
                        name: "Restricted Autonomous",
                        desc: "Execute pre-authorized tools continuously within security limits",
                      },
                    ].map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => setField("autonomyMode", mode.id)}
                        className={`p-3.5 rounded-xl border text-left transition ${
                          (settings.autonomyMode || "supervised") === mode.id
                            ? "border-cyan-500 bg-cyan-500/10 text-cyan-300 shadow-md"
                            : "border-neutral-800 bg-[#05060c] text-neutral-400 hover:text-white"
                        }`}
                      >
                        <span className="font-semibold block text-white mb-1">{mode.name}</span>
                        <span className="text-[11px] text-neutral-400 leading-relaxed block">
                          {mode.desc}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs pt-2">
                  <div>
                    <label className="text-neutral-300 block mb-1 font-medium">
                      Max Execution Duration (sec)
                    </label>
                    <input
                      type="number"
                      value={settings.maxExecutionDuration || 300}
                      onChange={(e) => setField("maxExecutionDuration", Number(e.target.value))}
                      className="w-full bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div>
                    <label className="text-neutral-300 block mb-1 font-medium">Retry Limit</label>
                    <input
                      type="number"
                      value={settings.maxRetries || 3}
                      onChange={(e) => setField("maxRetries", Number(e.target.value))}
                      className="w-full bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div>
                    <label className="text-neutral-300 block mb-1 font-medium">
                      Task Concurrency
                    </label>
                    <input
                      type="number"
                      value={settings.taskConcurrency || 4}
                      onChange={(e) => setField("taskConcurrency", Number(e.target.value))}
                      className="w-full bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>

                <div className="space-y-3 pt-4 border-t border-neutral-800/80 text-xs">
                  <h4 className="font-semibold text-neutral-300">Tool Permissions & Memory</h4>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-neutral-300">Allow agents to query & store in Memory Vault</span>
                    <input
                      type="checkbox"
                      checked={settings.agentMemoryAccess ?? true}
                      onChange={(e) => setField("agentMemoryAccess", e.target.checked)}
                      className="rounded accent-cyan-500 w-4 h-4"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-neutral-300">Auto-approve passive read actions (page scraping)</span>
                    <input
                      type="checkbox"
                      checked={settings.autoApproveReads ?? true}
                      onChange={(e) => setField("autoApproveReads", e.target.checked)}
                      className="rounded accent-cyan-500 w-4 h-4"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* SECTION 8: MEMORY & KNOWLEDGE                            */}
          {/* ======================================================== */}
          {activeCategory === "memory" && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="p-6 rounded-2xl bg-[#0a0f1d] border border-neutral-800/80 space-y-5">
                <h3 className="text-sm font-semibold text-white pb-3 border-b border-neutral-800/80">
                  Memory Indexing & Retrieval
                </h3>

                <div className="space-y-3 text-xs">
                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <span className="text-neutral-200 block font-medium">Memory System Active</span>
                      <span className="text-[10px] text-neutral-500">
                        Persist extracted entities, preferences, and verified facts
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.memoryEnabled ?? true}
                      onChange={(e) => setField("memoryEnabled", e.target.checked)}
                      className="rounded accent-cyan-500 w-4 h-4"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <span className="text-neutral-200 block font-medium">Automatic Context Extraction</span>
                      <span className="text-[10px] text-neutral-500">
                        Extract memories from browsing sessions and completed tasks
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.autoContextExtraction ?? true}
                      onChange={(e) => setField("autoContextExtraction", e.target.checked)}
                      className="rounded accent-cyan-500 w-4 h-4"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs pt-4 border-t border-neutral-800/80">
                  <div>
                    <label className="text-neutral-300 block mb-1 font-medium">
                      Similarity Threshold ({settings.similarityThreshold ?? 0.75})
                    </label>
                    <input
                      type="range"
                      min="0.5"
                      max="0.95"
                      step="0.05"
                      value={settings.similarityThreshold ?? 0.75}
                      onChange={(e) => setField("similarityThreshold", Number(e.target.value))}
                      className="w-full accent-cyan-500 mt-2"
                    />
                  </div>

                  <div>
                    <label className="text-neutral-300 block mb-1 font-medium">
                      Retention Policy
                    </label>
                    <select
                      value={settings.memoryRetentionDays || 90}
                      onChange={(e) => setField("memoryRetentionDays", Number(e.target.value))}
                      className="w-full bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                    >
                      <option value={30}>30 Days</option>
                      <option value={90}>90 Days (Recommended)</option>
                      <option value={180}>180 Days</option>
                      <option value={365}>1 Year</option>
                      <option value={0}>Indefinite (No Expiration)</option>
                    </select>
                  </div>
                </div>

                {/* Export & Actions */}
                <div className="pt-4 border-t border-neutral-800/80 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={handleExportMemories}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#05060c] hover:bg-neutral-900 border border-neutral-700 text-xs text-neutral-300 hover:text-white transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export Memories as JSON</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => toast.info("Memory clear requires approval confirmation")}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-950/40 hover:bg-red-900/50 border border-red-800/40 text-red-400 text-xs transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear Memory Store</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* SECTION 9: RESEARCH & WORKFLOWS                          */}
          {/* ======================================================== */}
          {activeCategory === "research" && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="p-6 rounded-2xl bg-[#0a0f1d] border border-neutral-800/80 space-y-5">
                <h3 className="text-sm font-semibold text-white pb-3 border-b border-neutral-800/80">
                  Deep Research & Synthesis Defaults
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="text-neutral-300 block mb-1 font-medium">Research Depth</label>
                    <select
                      value={settings.researchDepth || "comprehensive"}
                      onChange={(e) => setField("researchDepth", e.target.value)}
                      className="w-full bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                    >
                      <option value="quick">Quick (5 queries, 10 sources)</option>
                      <option value="comprehensive">Comprehensive (15 queries, 30 sources)</option>
                      <option value="deep">Deep Exhaustive (Multi-stage graph search)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-neutral-300 block mb-1 font-medium">
                      Workflow Approval Policy
                    </label>
                    <select
                      value={settings.workflowApprovalPolicy || "strict"}
                      onChange={(e) => setField("workflowApprovalPolicy", e.target.value)}
                      className="w-full bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                    >
                      <option value="strict">Strict (Approve all mutation steps)</option>
                      <option value="permissive">Permissive (Auto-run verified steps)</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-3 pt-4 border-t border-neutral-800/80 text-xs">
                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <span className="text-neutral-200 block font-medium">Auto-Cite Evidence Provenance</span>
                      <span className="text-[10px] text-neutral-500">
                        Include inline clickable citation links in markdown reports
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.autoCiteSources ?? true}
                      onChange={(e) => setField("autoCiteSources", e.target.checked)}
                      className="rounded accent-cyan-500 w-4 h-4"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <span className="text-neutral-200 block font-medium">Workflow Animation Pulse</span>
                      <span className="text-[10px] text-neutral-500">
                        Show visual SVG execution flow in Automation Studio
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.workflowPulseAnimation ?? true}
                      onChange={(e) => setField("workflowPulseAnimation", e.target.checked)}
                      className="rounded accent-cyan-500 w-4 h-4"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* SECTION 10: INTEGRATIONS & API                           */}
          {/* ======================================================== */}
          {activeCategory === "integrations" && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">External Gateways & Connectors</h3>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    Live status and latency checks for verified system integrations
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                {integrations.map((item) => (
                  <div
                    key={item.provider}
                    className="p-5 rounded-2xl bg-[#0a0f1d] border border-neutral-800/80 flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2.5">
                        <span className="text-sm font-semibold text-white">{item.name}</span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-mono border ${
                            item.status === "connected"
                              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                              : item.status === "degraded"
                              ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                              : "bg-neutral-800 border-neutral-700 text-neutral-400"
                          }`}
                        >
                          {item.status.toUpperCase()}
                        </span>
                        {item.latencyMs !== undefined && (
                          <span className="text-[10px] text-neutral-500 font-mono">
                            {item.latencyMs}ms
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-neutral-400">{item.description}</p>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {item.scopes?.map((s: string) => (
                          <span
                            key={s}
                            className="text-[10px] px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-neutral-400 font-mono"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleVerifyIntegration(item.provider)}
                        disabled={verifyingIntegrationId === item.provider}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0f172a] hover:bg-[#1e293b] border border-cyan-500/30 text-cyan-400 text-xs font-medium transition disabled:opacity-50"
                      >
                        <RefreshCw
                          className={`w-3 h-3 ${
                            verifyingIntegrationId === item.provider ? "animate-spin" : ""
                          }`}
                        />
                        <span>
                          {verifyingIntegrationId === item.provider ? "Verifying..." : "Verify Connection"}
                        </span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* SECTION 11: SECURITY & APPROVALS                         */}
          {/* ======================================================== */}
          {activeCategory === "security" && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="p-6 rounded-2xl bg-[#0a0f1d] border border-neutral-800/80 space-y-5">
                <h3 className="text-sm font-semibold text-white pb-3 border-b border-neutral-800/80">
                  Human-in-the-Loop & Execution Governance
                </h3>

                <div className="space-y-4 text-xs">
                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <span className="text-neutral-200 block font-medium">
                        Enforce Write Mutation Gating
                      </span>
                      <span className="text-[10px] text-neutral-500">
                        Require human approval for destructive edits, bash commands, or external POSTs
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.requireWriteApproval ?? true}
                      onChange={(e) => setField("requireWriteApproval", e.target.checked)}
                      className="rounded accent-cyan-500 w-4 h-4"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <span className="text-neutral-200 block font-medium">
                        Passive Read Auto-Authorization
                      </span>
                      <span className="text-[10px] text-neutral-500">
                        Allow web searches and read-only page inspection without pause
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.passiveReadAutoAuth ?? true}
                      onChange={(e) => setField("passiveReadAutoAuth", e.target.checked)}
                      className="rounded accent-cyan-500 w-4 h-4"
                    />
                  </label>

                  <div className="pt-2">
                    <label className="text-neutral-300 block mb-1 font-medium">
                      Approval Request Expiration (Hours)
                    </label>
                    <input
                      type="number"
                      value={settings.approvalAutoExpireHours || 24}
                      onChange={(e) => setField("approvalAutoExpireHours", Number(e.target.value))}
                      className="w-full max-w-xs bg-[#05060c] border border-neutral-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-neutral-800/80">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-semibold text-white block">
                        Multi-Factor Authentication (MFA)
                      </span>
                      <span className="text-[10px] text-neutral-500">
                        Require TOTP authenticator token on sensitive configuration changes
                      </span>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-neutral-900 border border-neutral-700 text-neutral-400 text-[10px] font-mono">
                      Optional
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* SECTION 12: DEVELOPER & DIAGNOSTICS                      */}
          {/* ======================================================== */}
          {activeCategory === "developer" && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">Live System Health & Probes</h3>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    Real-time operational latency, database schema status, and inference health
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRunDiagnostics}
                  disabled={isProbingDiagnostics}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white font-medium text-xs shadow-lg shadow-cyan-950/40 transition disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isProbingDiagnostics ? "animate-spin" : ""}`} />
                  <span>{isProbingDiagnostics ? "Probing..." : "Run Diagnostic Probe"}</span>
                </button>
              </div>

              {diagnostics && (
                <div className="space-y-4">
                  {/* Overall Banner */}
                  <div
                    className={`p-4 rounded-2xl border flex items-center justify-between ${
                      diagnostics.overall === "healthy"
                        ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-300"
                        : "bg-amber-950/20 border-amber-500/30 text-amber-300"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      <div>
                        <span className="text-xs font-semibold block text-white">
                          System Status: {diagnostics.overall.toUpperCase()}
                        </span>
                        <span className="text-[11px] text-neutral-400">
                          Platform: {diagnostics.platform} | Node {diagnostics.nodeVersion} | Build {diagnostics.version}
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] text-neutral-500 font-mono">
                      {new Date(diagnostics.timestamp).toLocaleTimeString()}
                    </span>
                  </div>

                  {/* Individual Checks Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {Object.entries(diagnostics.checks || {}).map(([key, check]: [string, any]) => (
                      <div
                        key={key}
                        className="p-4 rounded-2xl bg-[#0a0f1d] border border-neutral-800/80 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-white">{check.name}</span>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-mono border ${
                              check.status === "healthy"
                                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                                : "bg-amber-500/10 border-amber-500/20 text-amber-400"
                            }`}
                          >
                            {check.status.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-[11px] text-neutral-400 leading-relaxed">
                          {check.details}
                        </p>
                        <div className="flex items-center justify-between pt-2 border-t border-neutral-800/60 text-[10px] text-neutral-500 font-mono">
                          <span>Latency: {check.latencyMs}ms</span>
                          {check.remediation && (
                            <span className="text-amber-400">{check.remediation}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
