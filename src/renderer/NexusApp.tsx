import React, { useState, useEffect, useRef } from "react";
import { type NexusTab } from "./components/nexus/NexusHeader";
import { NexusBrowserView } from "./components/nexus/NexusBrowserView";
import { NexusDashboard } from "./components/nexus/NexusDashboard";
import { NexusAgentView } from "./components/nexus/NexusAgentView";
import { NexusResearchView } from "./components/nexus/NexusResearchView";
import { NexusWorkflowsView } from "./components/nexus/NexusWorkflowsView";
import { NexusMemoryView } from "./components/nexus/NexusMemoryView";
import { NexusSkillsView } from "./components/nexus/NexusSkillsView";
import { NexusActivityView } from "./components/nexus/NexusActivityView";
import { NexusApprovalsView } from "./components/nexus/NexusApprovalsView";
import { NexusSettingsView } from "./components/nexus/NexusSettingsView";
import { NexusApprovalsBanner } from "./components/nexus/NexusApprovalsBanner";
import { NexusCommandPalette } from "./components/nexus/NexusCommandPalette";
import { NexusAuthModal } from "./components/nexus/NexusAuthModal";
import { NexusToastProvider } from "./components/nexus/NexusToast";
import { NexusBookmarksView } from "./components/nexus/NexusBookmarksView";
import { NexusHistoryView } from "./components/nexus/NexusHistoryView";
import { NexusDownloadsView } from "./components/nexus/NexusDownloadsView";
import { NexusExtensionsView } from "./components/nexus/NexusExtensionsView";
import { NexusCodingWorkspaceView } from "./components/nexus/NexusCodingWorkspaceView";
import { NexusPictureStudioView } from "./components/nexus/NexusPictureStudioView";
import { nexusClient } from "./lib/nexus/nexus-client";
import { nexusWs } from "./lib/nexus/nexus-ws";
import { ShieldCheck } from "lucide-react";

export const NexusApp: React.FC = () => {
  // Flagship browser-first OS state
  const [activeTab, setActiveTab] = useState<NexusTab>("browser");

  const [nexusUser, setNexusUser] = useState<{ id?: string; name: string; email: string } | null>(() => {
    try {
      const saved = localStorage.getItem("nexus_user");
      if (saved) return JSON.parse(saved);
    } catch {}
    return null;
  });


  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState<number>(0);
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const [showCommandPalette, setShowCommandPalette] = useState<boolean>(false);
  const [showAiPanel, setShowAiPanel] = useState<boolean>(false);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);

  // Cross-component browser tab opener
  const externalOpenTabRef = useRef<((url: string, title?: string, agentControlled?: boolean, agentAction?: string) => void) | null>(null);

  const openInBrowser = (url: string, title?: string, agentControlled?: boolean, agentAction?: string) => {
    setActiveTab("browser");
    if (externalOpenTabRef.current) {
      externalOpenTabRef.current(url, title, agentControlled, agentAction);
    }
  };

  // Check auth & health on mount
  useEffect(() => {
    nexusClient
      .ensureSession()
      .then((res) => {
        if (res.user && res.user.id) {
          setNexusUser(res.user);
          try {
            localStorage.setItem("nexus_user", JSON.stringify(res.user));
          } catch {}
        }
        return nexusClient.getWorkspaces();
      })
      .then((res) => {
        if (res?.workspaces?.length > 0) {
          setActiveWorkspaceId(res.workspaces[0].id);
        }
      })
      .catch((err) => {
        console.warn("[NexusApp] Session bootstrap notice:", err);
      });

    // Query pending approvals count
    nexusClient.getPendingApprovals().then((res) => {
      setPendingApprovalsCount(res.approvals?.length || 0);
    }).catch(() => {});

    // WebSocket connection & live updates
    nexusWs.connect();
    const unsubWs = nexusWs.onStateChange((connected) => {
      setWsConnected(connected);
    });

    const unsubApprReq = nexusWs.subscribe("approval.required", () => {
      setPendingApprovalsCount((c) => c + 1);
    });

    const unsubApprRes = nexusWs.subscribe("approval.resolved", () => {
      setPendingApprovalsCount((c) => Math.max(0, c - 1));
    });

    return () => {
      unsubWs();
      unsubApprReq();
      unsubApprRes();
    };
  }, []);

  // Hide Electron native BrowserView when user navigates away from browser view
  useEffect(() => {
    try {
      const shell = (window as any).browserShell;
      if (shell?.tabUpdateBounds) {
        if (activeTab !== "browser") {
          shell.tabUpdateBounds(1, 200, 99999, 0);
        }
      }
    } catch {}
  }, [activeTab]);

  // Global keyboard shortcuts (Ctrl+1 through Ctrl+8, Ctrl+K, Ctrl+J)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === "1") {
          e.preventDefault();
          setActiveTab("browser");
        } else if (e.key === "2") {
          e.preventDefault();
          setActiveTab("dashboard");
        } else if (e.key === "3") {
          e.preventDefault();
          setActiveTab("agent");
        } else if (e.key === "4") {
          e.preventDefault();
          setActiveTab("research");
        } else if (e.key === "5") {
          e.preventDefault();
          setActiveTab("workflows");
        } else if (e.key === "6") {
          e.preventDefault();
          setActiveTab("memory");
        } else if (e.key === "7") {
          e.preventDefault();
          setActiveTab("skills");
        } else if (e.key === "8") {
          e.preventDefault();
          setActiveTab("approvals");
        } else if (e.key === "9") {
          e.preventDefault();
          setActiveTab("activity");
        } else if (e.key === "0") {
          e.preventDefault();
          setActiveTab("settings");
        } else if (e.key.toLowerCase() === "k") {
          e.preventDefault();
          setShowCommandPalette((prev) => !prev);
        } else if (e.key.toLowerCase() === "j") {
          e.preventDefault();
          setShowAiPanel((prev) => !prev);
        }
      }
      // Ctrl+Shift+R => Research
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        setActiveTab("research");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleLogout = () => {
    nexusClient.logout().then(() => {
      setNexusUser(null);
      localStorage.removeItem("nexus_user");
    });
  };

  return (
    <NexusToastProvider>
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#050507] font-sans text-neutral-100 antialiased selection:bg-violet-500/30 selection:text-violet-200">
        {/* UNIFIED BROWSER OS SHELL */}
        <NexusBrowserView
          onNavigate={(tab) => setActiveTab(tab)}
          user={nexusUser}
          externalOpenTabRef={externalOpenTabRef}
          showAiPanel={showAiPanel}
          onToggleAiPanel={() => setShowAiPanel((prev) => !prev)}
          activeWorkspaceId={activeWorkspaceId}
          onWorkspaceChange={setActiveWorkspaceId}
          onOpenCommandPalette={() => setShowCommandPalette(true)}
          onLogout={handleLogout}
          onOpenAuth={() => setShowAuthModal(true)}
          currentMode={activeTab}
          isAnyModalOpen={showCommandPalette || showAuthModal}
        >
          {/* Workspaces rendered seamlessly when active */}
          {activeTab === "coding" && <NexusCodingWorkspaceView workspaceId={activeWorkspaceId} onOpenInBrowser={openInBrowser} />}
          {activeTab === "picture-studio" && <NexusPictureStudioView workspaceId={activeWorkspaceId} onOpenInBrowser={openInBrowser} />}
          {activeTab === "dashboard" && <NexusDashboard onNavigate={(tab) => setActiveTab(tab)} workspaceId={activeWorkspaceId} />}
          {activeTab === "agent" && <NexusAgentView onOpenInBrowser={openInBrowser} workspaceId={activeWorkspaceId} />}
          {activeTab === "research" && <NexusResearchView onOpenInBrowser={openInBrowser} workspaceId={activeWorkspaceId} />}
          {activeTab === "workflows" && <NexusWorkflowsView onOpenInBrowser={openInBrowser} workspaceId={activeWorkspaceId} />}
          {activeTab === "memory" && <NexusMemoryView onOpenInBrowser={openInBrowser} workspaceId={activeWorkspaceId} />}
          {activeTab === "skills" && <NexusSkillsView workspaceId={activeWorkspaceId} />}
          {activeTab === "activity" && <NexusActivityView onOpenInBrowser={openInBrowser} />}
          {activeTab === "settings" && <NexusSettingsView />}
          {activeTab === "bookmarks" && <NexusBookmarksView onOpenInBrowser={openInBrowser} />}
          {activeTab === "history" && <NexusHistoryView onOpenInBrowser={openInBrowser} />}
          {activeTab === "downloads" && <NexusDownloadsView onOpenInBrowser={openInBrowser} workspaceId={activeWorkspaceId} />}
          {activeTab === "extensions" && <NexusExtensionsView onOpenInBrowser={openInBrowser} />}

          {/* Approvals Full View */}
          {activeTab === "approvals" && (
            <NexusApprovalsView workspaceId={activeWorkspaceId || undefined} onOpenInBrowser={openInBrowser} />
          )}
        </NexusBrowserView>

        {/* Floating Approvals Banner across all views */}
        {activeTab !== "approvals" && <NexusApprovalsBanner />}

        {/* Universal Command Palette (Ctrl+K) */}
        <NexusCommandPalette
          isOpen={showCommandPalette}
          onClose={() => setShowCommandPalette(false)}
          onNavigate={(tab) => {
            setActiveTab(tab);
            setShowCommandPalette(false);
          }}
          onOpenUrl={(url) => {
            openInBrowser(url);
            setShowCommandPalette(false);
          }}
          onToggleAiPanel={() => setShowAiPanel((prev) => !prev)}
        />

        {/* Authentication Modal */}
        <NexusAuthModal
          isOpen={showAuthModal}
          onSuccess={(u) => {
            setNexusUser(u);
            setShowAuthModal(false);
            nexusClient.getWorkspaces().then((res) => {
              if (res.workspaces?.length > 0) {
                setActiveWorkspaceId(res.workspaces[0].id);
              }
            }).catch(() => {});
          }}
          onClose={() => setShowAuthModal(false)}
        />
      </div>
    </NexusToastProvider>
  );
};
