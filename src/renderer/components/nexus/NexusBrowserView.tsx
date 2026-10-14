import { createPortal } from "react-dom";
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  Home,
  ShieldCheck,
  Sparkles,
  Bookmark,
  ExternalLink,
  Plus,
  X,
  Pin,
  Copy,
  Check,
  Bot,
  Globe,
  Radio,
  Layers,
  ChevronDown,
  Command,
  LogOut,
  User as UserIcon,
  BookOpen,
  History,
  Download,
  Puzzle,
  Settings,
  Cpu,
  Users,
  Crown,
  Minus,
  Square,
  MoreVertical,
  Star,
  Mic,
  Camera,
  Image as ImageIcon,
  Code2,
  CheckCircle2,
  Circle,
  ChevronRight,
  Clock,
  Microscope,
  Maximize2,
  ZoomIn,
  ZoomOut,
  RefreshCw,
  Eye,
  Sliders,
  FileText,
  Activity,
  Shield,
  Hash,
  Link2,
  Share2,
  Palette,
  LayoutDashboard,
  Workflow,
  Brain,
  ShieldAlert,
  Trash2,
  Edit2,
} from "lucide-react";
import { NexusBrowserHome } from "./NexusBrowserHome";
import { NexusIntelligencePanel } from "./NexusIntelligencePanel";
import { NexusCodingAgentModal } from "./NexusCodingAgentModal";
import { NexusWorkspaceModal } from "./NexusWorkspaceModal";
import { NexusActionBar } from "./NexusActionBar";
import { NexusCommandSurface } from "./NexusCommandSurface";
import { NexusAgentIndicator, type ActiveAgentState } from "./NexusAgentIndicator";
import { useToast } from "./NexusToast";
import { nexusClient } from "@/lib/nexus/nexus-client";
import { nexusTabIntelligence } from "@/lib/nexus/nexus-tab-intelligence";
import type { NexusTab } from "./NexusHeader";

export interface NexusBrowserTab {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  isLoading?: boolean;
  isPinned?: boolean;
  isAgentControlled?: boolean;
  agentAction?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
}

const DEFAULT_TABS: NexusBrowserTab[] = [
  {
    id: "tab-start",
    title: "NEXUS Start",
    url: "nexus://start",
    isPinned: true,
  },
];

interface NexusBrowserViewProps {
  onNavigate: (tab: NexusTab) => void;
  user: { name: string; email: string } | null;
  initialUrl?: string;
  externalOpenTabRef?: React.MutableRefObject<((url: string, title?: string, agentControlled?: boolean, agentAction?: string) => void) | null>;
  showAiPanel?: boolean;
  onToggleAiPanel?: () => void;
  activeWorkspaceId?: string | null;
  onWorkspaceChange?: (workspaceId: string) => void;
  onOpenCommandPalette?: () => void;
  onLogout?: () => void;
  onOpenAuth?: () => void;
  currentMode?: NexusTab;
  children?: React.ReactNode;
  isAnyModalOpen?: boolean;
}

export const NexusBrowserView: React.FC<NexusBrowserViewProps> = ({
  onNavigate,
  user,
  initialUrl,
  externalOpenTabRef,
  showAiPanel: controlledShowAiPanel,
  onToggleAiPanel,
  activeWorkspaceId,
  onWorkspaceChange,
  onOpenCommandPalette,
  onLogout,
  onOpenAuth,
  currentMode = "browser",
  children,
  isAnyModalOpen = false,
}) => {
  const browserShell = typeof window !== "undefined" ? (window as any).browserShell : undefined;
  const [windowId, setWindowId] = useState<number>(1);
  const [showAgentPanel, setShowAgentPanel] = useState<boolean>(false);
  const [activeAgentInfo, setActiveAgentInfo] = useState<ActiveAgentState | null>(null);

  // Tabs state
  const [tabs, setTabs] = useState<NexusBrowserTab[]>(() => {
    try {
      const saved = localStorage.getItem("nexus_browser_tabs");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return DEFAULT_TABS;
  });

  const [activeTabId, setActiveTabId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem("nexus_active_tab_id");
      if (saved) return saved;
    } catch {}
    return "tab-start";
  });

  const [closedTabs, setClosedTabs] = useState<NexusBrowserTab[]>([]);
  const [omniboxInput, setOmniboxInput] = useState<string>("");
  const [isOmniboxFocused, setIsOmniboxFocused] = useState<boolean>(false);
  const [internalShowAiPanel, setInternalShowAiPanel] = useState<boolean>(false);
  const showAiPanel = controlledShowAiPanel !== undefined ? controlledShowAiPanel : internalShowAiPanel;

  const toggleAiPanel = () => {
    if (onToggleAiPanel) {
      onToggleAiPanel();
    } else {
      setInternalShowAiPanel((p) => !p);
    }
  };

  const [aiPanelPrompt, setAiPanelPrompt] = useState<string | undefined>(undefined);
  const [isBookmarked, setIsBookmarked] = useState<boolean>(false);
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);
  const [iframeError, setIframeError] = useState<boolean>(false);

  // Picture / Screenshot Studio ("Yes Picture")
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState<boolean>(false);
  const [screenshotModal, setScreenshotModal] = useState<{
    isOpen: boolean;
    dataUrl: string;
    pageTitle: string;
    pageUrl: string;
    timestamp: string;
    width?: number;
    height?: number;
    telemetry?: {
      url: string;
      title: string;
      wordCount: number;
      readingTimeMin: number;
      headings: string[];
      linksCount: number;
      imagesCount: number;
      metaDescription: string;
      ogImage?: string;
      security: {
        isHttps: boolean;
        protocol: string;
      };
      dimensions: {
        innerWidth: number;
        innerHeight: number;
        scrollHeight: number;
        devicePixelRatio: number;
      };
      performance: {
        loadTimeMs: number;
        domContentLoadedMs: number;
      };
      snippet: string;
    } | null;
    viewMode: "photo" | "showcase" | "telemetry" | "analysis";
    showcaseTheme: "cyber" | "space" | "sunset" | "matrix" | "minimal";
    zoomLevel: number;
    isCapturing?: boolean;
    isAnalyzing?: boolean;
    analysisResult?: string | null;
  } | null>(null);

  // More menu state
  const [showMoreMenu, setShowMoreMenu] = useState<boolean>(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // Spaces state
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string; description?: string }>>([]);
  const [activeSpaceName, setActiveSpaceName] = useState<string>("AI Browser Research");
  const [showSpaceMenu, setShowSpaceMenu] = useState<boolean>(false);
  const spaceMenuRef = useRef<HTMLDivElement>(null);
  const [workspaceModal, setWorkspaceModal] = useState<{
    isOpen: boolean;
    mode: "create" | "edit";
    workspaceToEdit?: { id: string; name: string; description?: string } | null;
  }>({ isOpen: false, mode: "create", workspaceToEdit: null });

  const handleDeleteWorkspace = async (wsId: string, wsName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (workspaces.length <= 1) {
      toast.warning("Cannot delete the only remaining workspace.");
      return;
    }
    try {
      await nexusClient.deleteWorkspace(wsId);
      const remaining = workspaces.filter((w) => w.id !== wsId);
      setWorkspaces(remaining);
      if (activeWorkspaceId === wsId || activeSpaceName === wsName) {
        const next = remaining[0];
        if (next) {
          setActiveSpaceName(next.name);
          onWorkspaceChange?.(next.id);
        }
      }
      toast.success(`Workspace "${wsName}" deleted.`);
    } catch (err: any) {
      toast.error(err.message || "Failed to delete workspace");
    }
  };

  const handleWorkspaceSuccess = (ws: any) => {
    setWorkspaces((prev) => {
      const idx = prev.findIndex((w) => w.id === ws.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = ws;
        return updated;
      }
      return [...prev, ws];
    });
    setActiveSpaceName(ws.name);
    onWorkspaceChange?.(ws.id);
    toast.success(`Workspace "${ws.name}" ${workspaceModal.mode === "edit" ? "updated" : "created"}!`);
  };

  // Text selection tracking for NexusActionBar
  const [selectedText, setSelectedText] = useState<string>("");

  // Per-tab navigation history
  const [tabHistories, setTabHistories] = useState<Record<string, { stack: string[]; index: number }>>({
    "tab-start": { stack: ["nexus://start"], index: 0 },
  });

  const toast = useToast();
  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0] || DEFAULT_TABS[0];
  const isStartPage = !activeTab || activeTab.url === "nexus://start" || activeTab.url.startsWith("nexus://");

  const [showCodingAgent, setShowCodingAgent] = useState<boolean>(false);

  const isCodingPlatform = Boolean(
    activeTab?.url &&
      !isStartPage &&
      (/leetcode\.com/i.test(activeTab.url) ||
        /hackerrank\.com/i.test(activeTab.url) ||
        /codeforces\.com/i.test(activeTab.url) ||
        /onlinegdb\.com/i.test(activeTab.url) ||
        /programiz\.com/i.test(activeTab.url) ||
        /w3schools\.com/i.test(activeTab.url) ||
        /geeksforgeeks\.org/i.test(activeTab.url) ||
        /replit\.com/i.test(activeTab.url) ||
        /codechef\.com/i.test(activeTab.url) ||
        /codewars\.com/i.test(activeTab.url) ||
        /compiler|coding|judge|problem/i.test(activeTab.url + " " + (activeTab.title || "")))
  );

  // Load workspaces
  useEffect(() => {
    nexusClient.getWorkspaces().then((res) => {
      const ws = res.workspaces || [];
      setWorkspaces(ws);
      if (ws.length > 0) {
        const active = activeWorkspaceId ? ws.find((w: any) => w.id === activeWorkspaceId) : ws[0];
        setActiveSpaceName(active?.name || ws[0]?.name || "AI Browser Research");
      }
    }).catch(() => {});
  }, [activeWorkspaceId]);

  // Click outside space menu
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (spaceMenuRef.current && !spaceMenuRef.current.contains(e.target as Node)) {
        setShowSpaceMenu(false);
      }
    };
    if (showSpaceMenu) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [showSpaceMenu]);

  // Bootstrap Electron tabs and subscribe to tab state updates
  useEffect(() => {
    if (!browserShell) return;
    let isMounted = true;

    browserShell.getBootstrapData?.().then((data: any) => {
      if (!isMounted || !data) return;
      nexusTabIntelligence.syncFromBrowserHistory().catch(() => {});
      const win = data.currentWindow;
      if (win) {
        if (typeof win.id === "number") {
          setWindowId(win.id);
        }
        if (Array.isArray(win.tabs) && win.tabs.length > 0) {
          setTabs(win.tabs.map((t: any) => ({
            id: t.id,
            title: t.title || "Page",
            url: t.url || "nexus://start",
            favicon: t.favicon,
            isLoading: Boolean(t.isLoading),
            isPinned: t.url === "nexus://start" || Boolean(t.isPinned),
            canGoBack: t.canGoBack,
            canGoForward: t.canGoForward,
          })));
          if (win.activeTabId) {
            setActiveTabId(win.activeTabId);
          }
        }
      }
    }).catch(() => {});

    const unsub = browserShell.onTabStateUpdate?.((payload: any) => {
      if (!isMounted || !payload) return;
      if (Array.isArray(payload.tabs) && payload.tabs.length > 0) {
        setTabs((prevTabs) => {
          return payload.tabs.map((pt: any) => {
            const existing = prevTabs.find((t) => t.id === pt.id);
            return {
              id: pt.id,
              title: pt.title || existing?.title || "Page",
              url: pt.url || existing?.url || "nexus://start",
              favicon: pt.favicon || existing?.favicon,
              isLoading: Boolean(pt.isLoading),
              isPinned: existing?.isPinned ?? (pt.url === "nexus://start"),
              isAgentControlled: existing?.isAgentControlled,
              agentAction: existing?.agentAction,
              canGoBack: pt.canGoBack ?? existing?.canGoBack,
              canGoForward: pt.canGoForward ?? existing?.canGoForward,
            };
          });
        });
        if (payload.activeTabId) {
          setActiveTabId(payload.activeTabId);
          const currentActive = payload.tabs.find((t: any) => t.id === payload.activeTabId);
          if (currentActive?.url && !currentActive.url.startsWith("nexus://")) {
            nexusTabIntelligence.recordNavigation(currentActive.url, currentActive.title, currentActive.id);
            nexusTabIntelligence.setActiveTab(currentActive.id, currentActive.url);
          }
        }
      }
    });

    return () => {
      isMounted = false;
      if (typeof unsub === "function") unsub();
    };
  }, []);

  const getRightPanelWidth = useCallback(() => {
    return (showAiPanel ? 380 : 0) + (showAgentPanel && activeAgentInfo ? 340 : 0);
  }, [showAiPanel, showAgentPanel, activeAgentInfo]);

  // Sync Electron WebContentsView bounds accurately with the shell
  const syncViewBounds = useCallback(() => {
    if (browserShell?.tabUpdateBounds) {
      const isStart = currentMode !== "browser" || !activeTab || activeTab.url === "nexus://start" || activeTab.url.startsWith("nexus://");
      const leftSidebarWidth = 200;
      const rightPanelWidth = getRightPanelWidth();
      const isModalActive = Boolean(isAnyModalOpen || screenshotModal?.isOpen || showCodingAgent);
      const urlHeight = isStart || isModalActive ? 99999 : 88;
      try {
        browserShell.tabUpdateBounds(windowId, leftSidebarWidth, urlHeight, rightPanelWidth);
      } catch {}
    }
  }, [browserShell, currentMode, activeTab?.url, getRightPanelWidth, isAnyModalOpen, screenshotModal?.isOpen, showCodingAgent, windowId]);

  // Sync Electron WebContentsView bounds when AI panel, activeTab, currentMode, or window size changes
  useEffect(() => {
    syncViewBounds();
    window.addEventListener("resize", syncViewBounds);
    return () => {
      window.removeEventListener("resize", syncViewBounds);
    };
  }, [syncViewBounds]);

  // Keep tabs persisted in localStorage
  useEffect(() => {
    try {
      localStorage.setItem("nexus_browser_tabs", JSON.stringify(tabs));
      localStorage.setItem("nexus_active_tab_id", activeTabId);
    } catch {}
  }, [tabs, activeTabId]);

  // Sync omnibox input to active tab url
  useEffect(() => {
    if (activeTab) {
      setOmniboxInput(activeTab.url === "nexus://start" ? "" : activeTab.url);
      setIframeError(false);
    }
  }, [activeTab?.id, activeTab?.url]);

  // Check if active URL is bookmarked
  useEffect(() => {
    if (activeTab?.url && activeTab.url !== "nexus://start") {
      try {
        const stored = localStorage.getItem("nexus_bookmarks");
        if (stored) {
          const bookmarksList = JSON.parse(stored);
          setIsBookmarked(bookmarksList.some((b: any) => b.url === activeTab.url));
          return;
        }
      } catch {}
    }
    setIsBookmarked(false);
  }, [activeTabId, activeTab?.url]);

  const handleToggleBookmark = async () => {
    if (!activeTab || activeTab.url === "nexus://start") return;
    const nextBookmarked = !isBookmarked;
    setIsBookmarked(nextBookmarked);

    try {
      const stored = localStorage.getItem("nexus_bookmarks");
      let bookmarksList: any[] = stored ? JSON.parse(stored) : [];
      if (nextBookmarked) {
        if (!bookmarksList.some((b) => b.url === activeTab.url)) {
          bookmarksList.push({
            url: activeTab.url,
            title: activeTab.title || activeTab.url,
            createdAt: new Date().toISOString(),
          });
        }
        nexusClient.createMemory({
          workspaceId: activeWorkspaceId || undefined,
          type: "website",
          key: `Bookmark: ${activeTab.title || activeTab.url}`,
          content: activeTab.url,
          importance: 0.9,
        }).catch(() => {});
        toast.success(`Bookmarked "${activeTab.title || activeTab.url}"`);
      } else {
        bookmarksList = bookmarksList.filter((b) => b.url !== activeTab.url);
        toast.info("Bookmark removed");
      }
      localStorage.setItem("nexus_bookmarks", JSON.stringify(bookmarksList));
    } catch (e) {
      console.error("Failed to persist bookmark:", e);
    }
  };

  // Expose openTab function to parent for cross-section interactions
  useEffect(() => {
    if (externalOpenTabRef) {
      externalOpenTabRef.current = (url: string, title?: string, agentControlled?: boolean, agentAction?: string) => {
        openUrl(url, title, agentControlled, agentAction);
      };
    }
  }, [tabs]);

  // Open initial URL if provided
  useEffect(() => {
    if (initialUrl && initialUrl !== "nexus://start") {
      openUrl(initialUrl);
    }
  }, [initialUrl]);

  // Global hotkeys for browser
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + T: New Tab
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "t" && !e.shiftKey) {
        e.preventDefault();
        handleNewTab();
      }
      // Ctrl/Cmd + W: Close Tab
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "w") {
        e.preventDefault();
        if (activeTab && tabs.length > 1) {
          handleCloseTab(activeTab.id);
        }
      }
      // Ctrl/Cmd + L: Focus Omnibox
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        const el = document.getElementById("nexus-browser-omnibox");
        el?.focus();
        (el as HTMLInputElement)?.select();
      }
      // Ctrl/Cmd + J: Toggle AI Panel
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        toggleAiPanel();
      }
      // Ctrl/Cmd + Shift + T: Restore Closed Tab
      else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        restoreLastClosedTab();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [tabs, activeTab, closedTabs, showAiPanel]);

  // Handle text selection for action bar
  useEffect(() => {
    const handleMouseUp = () => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      if (text && text.length > 3) {
        setSelectedText(text);
      } else {
        setSelectedText("");
      }
    };
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, []);

  const handleSelectTab = (tabId: string) => {
    onNavigate("browser");
    setActiveTabId(tabId);
    const targetTab = tabs.find((t) => t.id === tabId);
    if (targetTab?.url && !targetTab.url.startsWith("nexus://")) {
      nexusTabIntelligence.setActiveTab(tabId, targetTab.url);
    }
    if (browserShell) {
      const isStart = !targetTab?.url || targetTab.url === "nexus://start" || targetTab.url.startsWith("nexus://");
      const leftSidebarWidth = 200;
      const rightPanelWidth = getRightPanelWidth();
      const isModalActive = Boolean(isAnyModalOpen || screenshotModal?.isOpen || showCodingAgent);
      const urlHeight = isStart || isModalActive ? 99999 : 88;
      try {
        browserShell.tabSetActive(windowId, tabId, leftSidebarWidth, urlHeight, rightPanelWidth).catch(() => {});
        browserShell.tabUpdateBounds(windowId, leftSidebarWidth, urlHeight, rightPanelWidth).catch(() => {});
      } catch (e) {
        console.warn("browserShell tabSetActive error:", e);
      }
    }
  };

  const openUrl = async (
    targetUrl: string,
    targetTitle?: string,
    agentControlled: boolean = false,
    agentAction?: string
  ) => {
    onNavigate("browser");
    let formattedUrl = targetUrl.trim();
    if (!formattedUrl) return;

    if (formattedUrl.startsWith("nexus://")) {
      // Internal URL
    } else if (!/^https?:\/\//i.test(formattedUrl)) {
      if (formattedUrl.includes(".") && !formattedUrl.includes(" ")) {
        formattedUrl = "https://" + formattedUrl;
      } else {
        formattedUrl = `https://www.google.com/search?q=${encodeURIComponent(formattedUrl)}`;
      }
    }

    const hostLabel = formattedUrl.startsWith("http")
      ? new URL(formattedUrl).hostname.replace("www.", "")
      : formattedUrl;

    nexusTabIntelligence.recordNavigation(formattedUrl, targetTitle || hostLabel);

    const isCurrentStart = activeTab && (activeTab.url === "nexus://start" || activeTab.url.startsWith("nexus://")) && !activeTab.isPinned;
    const isTargetStart = formattedUrl === "nexus://start" || formattedUrl.startsWith("nexus://");
    const leftSidebarWidth = 200;
    const rightPanelWidth = getRightPanelWidth();
    const isModalActive = Boolean(isAnyModalOpen || screenshotModal?.isOpen || showCodingAgent);
    const urlHeight = isTargetStart || isModalActive ? 99999 : 88;

    if (browserShell) {
      const currentTab = tabs.find((t) => t.id === activeTabId) || activeTab;
      if (currentTab && (isCurrentStart || !isTargetStart)) {
        try {
          await browserShell.tabNavigate(windowId, currentTab.id, formattedUrl);
          await browserShell.tabSetActive(windowId, currentTab.id, leftSidebarWidth, urlHeight, rightPanelWidth);
          await browserShell.tabUpdateBounds(windowId, leftSidebarWidth, urlHeight, rightPanelWidth);
          setTabs((prev) =>
            prev.map((t) =>
              t.id === currentTab.id ? { ...t, url: formattedUrl, title: targetTitle || hostLabel } : t
            )
          );
          return;
        } catch (e) {
          console.warn("tabNavigate error:", e);
        }
      }

      try {
        const created = await browserShell.tabCreate(windowId, formattedUrl);
        if (created?.id) {
          await browserShell.tabSetActive(windowId, created.id, leftSidebarWidth, urlHeight, rightPanelWidth);
          await browserShell.tabUpdateBounds(windowId, leftSidebarWidth, urlHeight, rightPanelWidth);
          setActiveTabId(created.id);
          return;
        }
      } catch (e) {
        console.warn("tabCreate error:", e);
      }
    }

    const newTab: NexusBrowserTab = {
      id: isCurrentStart ? activeTab.id : `tab-${Date.now()}`,
      title: targetTitle || hostLabel || "Page",
      url: formattedUrl,
      favicon: formattedUrl.startsWith("http") ? `https://${new URL(formattedUrl).hostname}/favicon.ico` : undefined,
      isLoading: false,
      isPinned: false,
      isAgentControlled: agentControlled,
      agentAction: agentAction,
      canGoBack: true,
      canGoForward: false,
    };

    if (isCurrentStart) {
      setTabs((prev) => prev.map((t) => (t.id === activeTab.id ? newTab : t)));
    } else {
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
    }

    setTabHistories((prev) => {
      const existing = prev[newTab.id];
      if (existing) {
        const truncated = existing.stack.slice(0, existing.index + 1);
        return { ...prev, [newTab.id]: { stack: [...truncated, formattedUrl], index: truncated.length } };
      }
      return { ...prev, [newTab.id]: { stack: [formattedUrl], index: 0 } };
    });
  };

  const handleNewTab = async () => {
    onNavigate("browser");
    if (browserShell) {
      try {
        const created = await browserShell.tabCreate(windowId, "nexus://start");
        if (created?.id) {
          await browserShell.tabSetActive(windowId, created.id, 200, 99999, 0);
          await browserShell.tabUpdateBounds(windowId, 200, 99999, 0);
          setActiveTabId(created.id);
          return;
        }
      } catch (e) {
        console.warn("tabCreate error:", e);
      }
    }

    const newTab: NexusBrowserTab = {
      id: `tab-${Date.now()}`,
      title: "NEXUS Start",
      url: "nexus://start",
      isPinned: false,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };

  const handleCloseTab = async (tabId: string) => {
    const tabToClose = tabs.find((t) => t.id === tabId);
    if (!tabToClose) return;

    if (browserShell) {
      try {
        const res = await browserShell.tabClose(windowId, tabId);
        if (res?.activeTabId) {
          handleSelectTab(res.activeTabId);
        }
      } catch (e) {
        console.warn("tabClose error:", e);
      }
    }

    if (tabs.length === 1) {
      const freshTab: NexusBrowserTab = {
        id: `tab-${Date.now()}`,
        title: "NEXUS Start",
        url: "nexus://start",
        isPinned: true,
      };
      setTabs([freshTab]);
      setActiveTabId(freshTab.id);
      return;
    }

    setClosedTabs((prev) => [tabToClose, ...prev].slice(0, 10));
    const nextTabs = tabs.filter((t) => t.id !== tabId);
    setTabs(nextTabs);

    if (activeTabId === tabId) {
      const closingIndex = tabs.findIndex((t) => t.id === tabId);
      const nextActive = nextTabs[Math.max(0, closingIndex - 1)];
      if (nextActive) {
        handleSelectTab(nextActive.id);
      }
    }
  };

  const handleGoBack = () => {
    if (browserShell) {
      browserShell.tabGoBack(windowId, activeTabId).catch(() => {});
    }
    const hist = tabHistories[activeTabId];
    if (hist && hist.index > 0) {
      const newIndex = hist.index - 1;
      const prevUrl = hist.stack[newIndex];
      setTabHistories((prev) => ({ ...prev, [activeTabId]: { ...hist, index: newIndex } }));
      setTabs((prev) => prev.map((t) => t.id === activeTabId ? { ...t, url: prevUrl, canGoBack: newIndex > 0, canGoForward: true } : t));
    }
  };

  const handleGoForward = () => {
    if (browserShell) {
      browserShell.tabGoForward(windowId, activeTabId).catch(() => {});
    }
    const hist = tabHistories[activeTabId];
    if (hist && hist.index < hist.stack.length - 1) {
      const newIndex = hist.index + 1;
      const nextUrl = hist.stack[newIndex];
      setTabHistories((prev) => ({ ...prev, [activeTabId]: { ...hist, index: newIndex } }));
      setTabs((prev) => prev.map((t) => t.id === activeTabId ? { ...t, url: nextUrl, canGoBack: true, canGoForward: newIndex < hist.stack.length - 1 } : t));
    }
  };

  const handleReload = () => {
    if (browserShell) {
      browserShell.tabReload(windowId, activeTabId).catch(() => {});
    }
    if (activeTab && !isStartPage) {
      openUrl(activeTab.url, activeTab.title);
    }
  };

  const restoreLastClosedTab = () => {
    if (closedTabs.length === 0) return;
    const [restored, ...remaining] = closedTabs;
    setTabs((prev) => [...prev, restored]);
    handleSelectTab(restored.id);
    setClosedTabs(remaining);
  };

  const handleOmniboxSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = omniboxInput.trim();
    if (!query) return;

    try {
      const intentRes = await nexusClient.determineIntent(query, {
        currentUrl: activeTab?.url,
        execute: true,
      });

      if (intentRes.intent === "navigate" || intentRes.intent === "search_web") {
        openUrl(intentRes.target || query);
      } else if (intentRes.intent === "start_research") {
        onNavigate("research");
      } else if (intentRes.intent === "launch_agent") {
        onNavigate("agent");
      } else if (intentRes.intent === "create_workflow") {
        onNavigate("workflows");
      } else if (intentRes.intent === "query_memory") {
        onNavigate("memory");
      } else if (intentRes.intent === "ask_ai") {
        setAiPanelPrompt(query);
        if (!showAiPanel) toggleAiPanel();
      } else {
        openUrl(intentRes.target || query);
      }
    } catch {
      openUrl(query);
    }
  };

  const handleCommandSelect = (
    type: "navigate" | "search" | "ask" | "research" | "agent" | "workflow" | "memory" | "mode",
    payload: string
  ) => {
    setIsOmniboxFocused(false);
    switch (type) {
      case "navigate":
      case "search":
        openUrl(payload);
        break;
      case "ask":
        setAiPanelPrompt(payload);
        if (!showAiPanel) toggleAiPanel();
        break;
      case "research":
        onNavigate("research");
        break;
      case "agent":
        onNavigate("agent");
        break;
      case "workflow":
        onNavigate("workflows");
        break;
      case "memory":
        onNavigate("memory");
        break;
      case "mode":
        onNavigate(payload as NexusTab);
        break;
    }
  };

  const handleCopyUrl = () => {
    if (activeTab?.url) {
      navigator.clipboard.writeText(activeTab.url);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1500);
    }
  };

    const handleCaptureScreenshot = async () => {
    setIsCapturingScreenshot(true);

    const initialTitle = activeTab?.title || "Webpage Snapshot";
    const initialUrl = activeTab?.url || "nexus://start";

    // 1. INSTANT FEEDBACK: Open the studio modal IMMEDIATELY upon click with a live scanner
    setScreenshotModal({
      isOpen: true,
      dataUrl: "",
      pageTitle: initialTitle,
      pageUrl: initialUrl,
      timestamp: new Date().toLocaleTimeString(),
      width: 1920,
      height: 1080,
      telemetry: null,
      viewMode: "photo",
      showcaseTheme: "cyber",
      zoomLevel: 0,
      isCapturing: true,
    });

    // 2. Detach native Electron view immediately so the modal is 100% visible
    try {
      browserShell?.tabUpdateBounds?.(windowId, 200, 99999, getRightPanelWidth());
    } catch {}

    try {
      let dataUrl = "";
      let width = 1920;
      let height = 1080;
      let realTitle = initialTitle;
      let realUrl = initialUrl;
      let telemetryData: any = null;

      const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
        Promise.race([
          p,
          new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
        ]);

      // 3. Capture pixels and DOM telemetry in parallel with 2.5s timeouts
      const [capResult, telemResult] = await Promise.allSettled([
        browserShell?.tabCapturePage
          ? withTimeout(browserShell.tabCapturePage(windowId, activeTab?.id), 2500, null)
          : Promise.resolve(null),
        browserShell?.tabGetPageTelemetry
          ? withTimeout(browserShell.tabGetPageTelemetry(windowId, activeTab?.id), 2000, null)
          : Promise.resolve(null),
      ]);

      const capVal: any = capResult.status === "fulfilled" ? (capResult as any).value : null;
      const telemVal: any = telemResult.status === "fulfilled" ? (telemResult as any).value : null;

      if (capVal?.success && capVal.dataUrl) {
        dataUrl = capVal.dataUrl;
        if (capVal.width) width = capVal.width;
        if (capVal.height) height = capVal.height;
        if (capVal.title) realTitle = capVal.title;
        if (capVal.url) realUrl = capVal.url;
      }

      if (telemVal?.success) {
        telemetryData = telemVal;
        if (telemVal.title) realTitle = telemVal.title;
        if (telemVal.url) realUrl = telemVal.url;
      }

      // 4. Fallback visual canvas if running in web browser or empty tab
      if (!dataUrl) {
        const canvas = document.createElement("canvas");
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const grad = ctx.createLinearGradient(0, 0, 1280, 720);
          grad.addColorStop(0, "#080814");
          grad.addColorStop(1, "#14142b");
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, 1280, 720);
          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 32px Inter, sans-serif";
          ctx.fillText(realTitle, 60, 120);
          ctx.fillStyle = "#a5b4fc";
          ctx.font = "16px Inter, sans-serif";
          ctx.fillText(realUrl, 60, 165);
        }
        dataUrl = canvas.toDataURL("image/png");
      }

      // 5. Update modal with real pixels and telemetry
      setScreenshotModal((prev) =>
        prev
          ? {
              ...prev,
              dataUrl,
              pageTitle: realTitle,
              pageUrl: realUrl,
              width,
              height,
              telemetry: telemetryData,
              isCapturing: false,
            }
          : null
      );

      toast.success("Webpage photo & live telemetry captured!");
    } catch (err: any) {
      toast.error(`Capture failed: ${err.message}`);
      setScreenshotModal((prev) => (prev ? { ...prev, isCapturing: false } : null));
    } finally {
      setIsCapturingScreenshot(false);
    }
  };

  const handleCloseScreenshotModal = () => {
    setScreenshotModal(null);
    try {
      const isStart = currentMode !== "browser" || !activeTab || activeTab.url === "nexus://start" || activeTab.url.startsWith("nexus://");
      const urlHeight = isStart ? 99999 : 88;
      browserShell?.tabUpdateBounds?.(windowId, 200, urlHeight, getRightPanelWidth());
    } catch {}
  };

  const generateShowcaseCanvas = (
    imgSrc: string,
    title: string,
    url: string,
    theme: string
  ): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const padding = 50;
        const titleBarHeight = 40;
        const w = img.width + padding * 2;
        const h = img.height + padding * 2 + titleBarHeight;

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(imgSrc);

        // Backdrop gradient
        const grad = ctx.createLinearGradient(0, 0, w, h);
        if (theme === "sunset") {
          grad.addColorStop(0, "#3b0764");
          grad.addColorStop(0.5, "#701a75");
          grad.addColorStop(1, "#831843");
        } else if (theme === "matrix") {
          grad.addColorStop(0, "#022c22");
          grad.addColorStop(0.5, "#064e3b");
          grad.addColorStop(1, "#021c15");
        } else if (theme === "space") {
          grad.addColorStop(0, "#030712");
          grad.addColorStop(0.5, "#1e1b4b");
          grad.addColorStop(1, "#0f172a");
        } else if (theme === "minimal") {
          grad.addColorStop(0, "#18181b");
          grad.addColorStop(1, "#09090b");
        } else {
          // cyber
          grad.addColorStop(0, "#0c0a2a");
          grad.addColorStop(0.5, "#1e1b4b");
          grad.addColorStop(1, "#020617");
        }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // Window shadow & body
        ctx.save();
        ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
        ctx.shadowBlur = 35;
        ctx.shadowOffsetY = 16;

        ctx.fillStyle = "#12121f";
        ctx.beginPath();
        ctx.roundRect(padding, padding, img.width, img.height + titleBarHeight, [12]);
        ctx.fill();
        ctx.restore();

        // Window Titlebar
        ctx.fillStyle = "#0d0d17";
        ctx.beginPath();
        ctx.roundRect(padding, padding, img.width, titleBarHeight, [12, 12, 0, 0]);
        ctx.fill();

        // Dots
        ctx.fillStyle = "#ff5f56"; ctx.beginPath(); ctx.arc(padding + 20, padding + 20, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ffbd2e"; ctx.beginPath(); ctx.arc(padding + 38, padding + 20, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#27c93f"; ctx.beginPath(); ctx.arc(padding + 56, padding + 20, 6, 0, Math.PI * 2); ctx.fill();

        // Address Pill
        ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
        ctx.beginPath();
        ctx.roundRect(padding + 75, padding + 7, Math.min(img.width - 150, 480), 26, [6]);
        ctx.fill();

        ctx.fillStyle = "#a5b4fc";
        ctx.font = "bold 11px Inter, sans-serif";
        const shortUrl = url.length > 50 ? url.slice(0, 47) + "..." : url;
        ctx.fillText(`🔒 ${shortUrl}`, padding + 88, padding + 24);

        // Real image
        ctx.drawImage(img, padding, padding + titleBarHeight, img.width, img.height);

        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => resolve(imgSrc);
      img.src = imgSrc;
    });
  };

  const handleCopyRealImage = async () => {
    if (!screenshotModal) return;
    try {
      const sourceUrl = screenshotModal.viewMode === "showcase"
        ? await generateShowcaseCanvas(
            screenshotModal.dataUrl,
            screenshotModal.pageTitle,
            screenshotModal.pageUrl,
            screenshotModal.showcaseTheme
          )
        : screenshotModal.dataUrl;

      const res = await fetch(sourceUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
      toast.success("Real photo copied to clipboard! (Ready to paste in Discord, Slack, Docs)");
    } catch {
      await navigator.clipboard.writeText(screenshotModal.dataUrl);
      toast.info("Image data URL copied to clipboard");
    }
  };

  const handleDownload = async () => {
    if (!screenshotModal) return;
    try {
      const sourceUrl = screenshotModal.viewMode === "showcase"
        ? await generateShowcaseCanvas(
            screenshotModal.dataUrl,
            screenshotModal.pageTitle,
            screenshotModal.pageUrl,
            screenshotModal.showcaseTheme
          )
        : screenshotModal.dataUrl;

      const a = document.createElement("a");
      a.href = sourceUrl;
      const safeTitle = (screenshotModal.pageTitle || "webpage").replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
      a.download = `nexus-${screenshotModal.viewMode === "showcase" ? "showcase" : "photo"}-${safeTitle}-${Date.now()}.png`;
      a.click();
      toast.success("Download started!");
    } catch {
      toast.error("Download failed");
    }
  };

  const handleAnalyzeScreenshot = async () => {
    if (!screenshotModal) return;
    setScreenshotModal((prev) => (prev ? { ...prev, isAnalyzing: true, analysisResult: null, viewMode: "analysis" } : null));
    try {
      const res = await nexusClient.analyzeImage({
        imageData: screenshotModal.dataUrl,
        url: screenshotModal.pageUrl,
        title: screenshotModal.pageTitle,
        prompt: `Analyze the visual hierarchy, UI layout, components, typography, and actionable insights. Additional telemetry: ${JSON.stringify(screenshotModal.telemetry || {})}`,
      });
      setScreenshotModal((prev) =>
        prev
          ? {
              ...prev,
              isAnalyzing: false,
              analysisResult: res.result || "Visual analysis complete.",
              viewMode: "analysis",
            }
          : null
      );
      toast.success("Visual AI analysis generated!");
    } catch (err: any) {
      setScreenshotModal((prev) => (prev ? { ...prev, isAnalyzing: false } : null));
      toast.error(`Analysis failed: ${err.message}`);
    }
  };

  return (
    <div className="flex h-full w-full overflow-hidden select-none font-sans" style={{ background: "#0a0a12" }}>

      {/* ══════════════════════════════════════════════════════
          LEFT SIDEBAR — Navigation, Workspaces, Brand
      ══════════════════════════════════════════════════════ */}
      <aside
        className="flex flex-col shrink-0 overflow-hidden border-r border-white/[0.06] z-20"
        style={{ width: 200, background: "#0f0f1a" }}
      >
        {/* Brand Logo */}
        <div
          className="flex items-center gap-2.5 px-4 py-4 cursor-pointer group"
          onClick={() => onNavigate("browser")}
        >
          <div className="w-8 h-8 rounded-xl overflow-hidden shadow-lg shadow-violet-500/30 shrink-0 ring-1 ring-violet-500/20 group-hover:ring-violet-400/40 transition-all">
            <img
              src="/nexus-icon.jpg"
              alt="NEXUS"
              className="w-full h-full object-cover"
            />
          </div>
          <div>
            <div className="text-white font-bold text-sm tracking-wider uppercase">NEXUS</div>
            <div className="text-white/40 text-[10px] tracking-wide">AI Browser</div>
          </div>
        </div>

        {/* Primary Nav */}
        <nav className="flex flex-col gap-0.5 px-2 mt-1">
          <div className="text-[9px] font-semibold tracking-wider text-white/30 uppercase px-2 mb-1">
            Platform
          </div>
          {[
            { id: "browser", label: "Browser", icon: Globe },
            { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
            { id: "agent", label: "AI Missions", icon: Bot },
            { id: "research", label: "Deep Research", icon: Microscope },
            { id: "workflows", label: "Workflows", icon: Workflow },
            { id: "memory", label: "Memory Vault", icon: Brain },
            { id: "skills", label: "Skill Library", icon: Sparkles },
            { id: "approvals", label: "Approvals", icon: ShieldAlert },
            { id: "activity", label: "Activity Log", icon: Activity },
          ].map(({ id, label, icon: Icon }) => {
            const isActive = currentMode === id || (id === "browser" && currentMode === "browser");
            return (
              <button
                key={id}
                type="button"
                onClick={() => onNavigate(id as any)}
                className={`group flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150 text-left w-full ${
                  isActive
                    ? "bg-violet-600/25 text-white border border-violet-500/30 shadow-sm"
                    : "text-white/55 hover:bg-white/[0.06] hover:text-white/90 border border-transparent"
                }`}
              >
                <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? "text-violet-400" : "text-white/40 group-hover:text-white/70"}`} />
                <span className="truncate">{label}</span>
              </button>
            );
          })}

          <div className="text-[9px] font-semibold tracking-wider text-white/30 uppercase px-2 mt-3 mb-1">
            Browser
          </div>
          {[
            { id: "bookmarks", label: "Bookmarks", icon: Bookmark },
            { id: "history", label: "History", icon: History },
            { id: "downloads", label: "Downloads", icon: Download },
            { id: "extensions", label: "Extensions", icon: Puzzle },
            { id: "settings", label: "Settings", icon: Settings },
          ].map(({ id, label, icon: Icon }) => {
            const isActive = currentMode === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onNavigate(id as any)}
                className={`group flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150 text-left w-full ${
                  isActive
                    ? "bg-violet-600/25 text-white border border-violet-500/30 shadow-sm"
                    : "text-white/55 hover:bg-white/[0.06] hover:text-white/90 border border-transparent"
                }`}
              >
                <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? "text-violet-400" : "text-white/40 group-hover:text-white/70"}`} />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </nav>

        {/* Workspaces */}
        <div className="mt-5 px-3 flex-1 min-h-0 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold tracking-widest text-white/30 uppercase">Workspaces</span>
            <button
              type="button"
              title="Create new workspace"
              onClick={() => {
                setWorkspaceModal({ isOpen: true, mode: "create", workspaceToEdit: null });
              }}
              className="text-white/30 hover:text-white/80 p-1 rounded hover:bg-white/[0.06] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex flex-col gap-0.5">
            {workspaces.map((ws: any, i: number) => {
              const colors = ["#3b82f6", "#8b5cf6", "#22c55e", "#f59e0b", "#ec4899", "#06b6d4"];
              const dotColor = ws.color || colors[i % colors.length];
              const isActiveWs = activeWorkspaceId === ws.id || activeSpaceName === ws.name;
              return (
                <div
                  key={ws.id}
                  className={`group/ws flex items-center justify-between px-2 py-1.5 rounded-lg text-[12px] transition-all w-full ${
                    isActiveWs ? "bg-white/[0.08] text-white" : "text-white/50 hover:bg-white/[0.04] hover:text-white/80"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActiveSpaceName(ws.name);
                      onWorkspaceChange?.(ws.id);
                    }}
                    className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dotColor }} />
                    <span className="truncate">{ws.name}</span>
                  </button>

                  <div className="opacity-0 group-hover/ws:opacity-100 flex items-center gap-1 transition-opacity shrink-0 ml-1">
                    <button
                      type="button"
                      title="Edit Workspace"
                      onClick={(e) => {
                        e.stopPropagation();
                        setWorkspaceModal({ isOpen: true, mode: "edit", workspaceToEdit: ws });
                      }}
                      className="p-1 rounded text-white/40 hover:text-white hover:bg-white/[0.08]"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                    {workspaces.length > 1 && (
                      <button
                        type="button"
                        title="Delete Workspace"
                        onClick={(e) => handleDeleteWorkspace(ws.id, ws.name, e)}
                        className="p-1 rounded text-rose-400/60 hover:text-rose-400 hover:bg-rose-500/10"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {workspaces.length === 0 && (
              <div className="text-center py-4 px-2">
                <Layers className="w-4 h-4 mx-auto text-white/20 mb-1" />
                <p className="text-[11px] text-white/40">No workspaces found</p>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setWorkspaceModal({ isOpen: true, mode: "create", workspaceToEdit: null });
              }}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12px] text-white/30 hover:text-white/70 hover:bg-white/[0.04] transition-all text-left w-full mt-1"
            >
              <Plus className="w-3 h-3" />
              New Workspace
            </button>
          </div>
        </div>

        {/* Pro Footer */}
        <div className="p-3 mt-auto">
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-gradient-to-r from-violet-900/60 to-indigo-900/60 border border-violet-500/20 cursor-pointer hover:border-violet-400/35 transition-all">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shrink-0 shadow-sm">
              <Crown className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="text-white text-[11px] font-semibold truncate">NEXUS Pro</div>
              <div className="text-white/40 text-[9px] truncate">Unlock AI superpowers</div>
            </div>
            <ArrowRight className="w-3 h-3 text-white/30 shrink-0 ml-auto" />
          </div>
        </div>
      </aside>

      {/* ══════════════════════════════════════════════════════
          MAIN AREA — Tab Bar + URL Bar + Content
      ══════════════════════════════════════════════════════ */}
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">

        {/* ── TOP CHROME ROW 1: TABS + WINDOW CONTROLS ── */}
        <div
          className="flex items-center shrink-0 px-3 gap-2 border-b border-white/[0.06]"
          style={{ height: 42, background: "#111118" }}
        >
          {/* Tabs Strip */}
          <div className="flex items-end gap-0.5 overflow-x-auto flex-1 h-full pt-2" style={{ scrollbarWidth: "none" }}>
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId && currentMode === "browser";
              return (
                <div
                  key={tab.id}
                  onClick={() => handleSelectTab(tab.id)}
                  className={`group relative flex items-center gap-1.5 h-[32px] px-3 cursor-pointer transition-all text-[12px] rounded-t-lg border-x border-t shrink-0 ${
                    tab.isPinned ? "max-w-[130px]" : "max-w-[200px] min-w-[110px]"
                  } ${
                    isActive
                      ? "bg-[#1a1a26] text-neutral-100 border-white/10 shadow-sm"
                      : "bg-transparent text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.03] border-transparent"
                  }`}
                  style={isActive ? { borderTopColor: "rgba(139,92,246,0.6)" } : {}}
                >
                  {tab.url === "nexus://start" ? (
                    <img src="/nexus-icon.jpg" alt="N" className={`w-3.5 h-3.5 shrink-0 rounded object-cover ${isActive ? "opacity-100" : "opacity-50"}`} />
                  ) : tab.isAgentControlled ? (
                    <Bot className="w-3.5 h-3.5 shrink-0 text-emerald-400 animate-pulse" />
                  ) : tab.favicon ? (
                    <img
                      src={tab.favicon}
                      alt=""
                      className="w-3.5 h-3.5 rounded shrink-0 object-contain"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <Globe className="w-3.5 h-3.5 shrink-0 text-neutral-500" />
                  )}

                  <span className="truncate flex-1 font-medium">{tab.title}</span>

                  {tab.isPinned && <Pin className="w-2.5 h-2.5 text-neutral-500 shrink-0 rotate-45" />}

                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleCloseTab(tab.id); }}
                    className="opacity-0 group-hover:opacity-100 hover:bg-white/10 p-0.5 rounded text-neutral-400 hover:text-neutral-200 transition-opacity shrink-0"
                    title="Close tab"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}

            {/* New Tab Button */}
            <button
              type="button"
              onClick={handleNewTab}
              className="flex items-center justify-center w-7 h-7 mb-1 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.06] transition-colors shrink-0"
              title="New tab (Ctrl+T)"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Right: Agent Indicator + Command Palette + Profile */}
          <div className="flex items-center gap-2 shrink-0">
            <NexusAgentIndicator
              isOpen={showAgentPanel}
              onToggleTimeline={(open) => setShowAgentPanel(open)}
              onActiveAgentChange={(agent) => setActiveAgentInfo(agent)}
              onOpenAgentView={() => onNavigate("agent")}
            />

            {/* Command Palette */}
            <button
              type="button"
              onClick={onOpenCommandPalette}
              title="Command Palette (Ctrl+K)"
              className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-md bg-white/[0.04] border border-white/[0.07] hover:border-white/15 text-neutral-400 hover:text-neutral-200 text-xs transition-colors"
            >
              <Command className="w-3 h-3" />
              <span className="text-[10px] font-mono text-neutral-500">Ctrl+K</span>
            </button>

            {/* User Profile */}
            {user ? (
              <div className="flex items-center gap-1.5 pl-1 border-l border-white/[0.06]">
                <div
                  onClick={onOpenAuth}
                  title={`${user.name} (${user.email || "Active User"}) - Click to switch account`}
                  className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center text-[11px] font-bold text-white cursor-pointer shadow-sm hover:ring-2 hover:ring-violet-400 transition"
                >
                  {user.name.charAt(0).toUpperCase()}
                </div>
                {onLogout && (
                  <button
                    type="button"
                    onClick={onLogout}
                    title="Log out"
                    className="p-1 text-neutral-500 hover:text-rose-400 transition-colors"
                  >
                    <LogOut className="w-3 h-3" />
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={onOpenAuth}
                title="Sign In / Register"
                className="w-6 h-6 rounded-full bg-neutral-900 border border-white/[0.07] flex items-center justify-center text-neutral-400 hover:text-white hover:border-violet-500/50 transition cursor-pointer"
              >
                <UserIcon className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Window Controls (Mac only) */}
            {typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent) && (
              <div className="flex items-center gap-1.5 pl-2 border-l border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => {
                    try {
                      browserShell?.closeCurrentWindow?.();
                    } catch {}
                  }}
                  className="w-3 h-3 rounded-full bg-[#ff5f57] hover:opacity-80 transition-opacity cursor-pointer"
                  title="Close"
                />
                <button
                  type="button"
                  onClick={() => {
                    try {
                      browserShell?.minimizeCurrentWindow?.();
                    } catch {}
                  }}
                  className="w-3 h-3 rounded-full bg-[#ffbd2e] hover:opacity-80 transition-opacity cursor-pointer"
                  title="Minimize"
                />
                <button
                  type="button"
                  onClick={() => {
                    try {
                      browserShell?.maximizeCurrentWindow?.();
                    } catch {}
                  }}
                  className="w-3 h-3 rounded-full bg-[#28c840] hover:opacity-80 transition-opacity cursor-pointer"
                  title="Maximize / Restore"
                />
              </div>
            )}
          </div>
        </div>

        {/* ── TOP CHROME ROW 2: URL BAR ── */}
        <div
          className="flex items-center shrink-0 px-3 gap-2 border-b border-white/[0.06]"
          style={{ height: 46, background: "#13131e" }}
        >
          {/* Navigation Controls */}
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={handleGoBack}
              disabled={!tabHistories[activeTabId] || tabHistories[activeTabId].index <= 0}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.06] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              title="Back"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleGoForward}
              disabled={!tabHistories[activeTabId] || tabHistories[activeTabId].index >= (tabHistories[activeTabId]?.stack.length ?? 1) - 1}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.06] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              title="Forward"
            >
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleReload}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.06] transition-colors"
              title="Reload"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Omnibox */}
          <div className="flex-1 relative min-w-0">
            <form
              onSubmit={handleOmniboxSubmit}
              className={`flex items-center gap-2 h-8 px-4 rounded-full border transition-all ${
                isOmniboxFocused
                  ? "bg-neutral-950 border-violet-500/50 shadow-[0_0_0_3px_rgba(139,92,246,0.12)]"
                  : "bg-white/[0.05] border-white/[0.08] hover:border-white/15 hover:bg-white/[0.07]"
              }`}
            >
              {activeTab?.url.startsWith("https://") ? (
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : isStartPage ? (
                <Globe className="w-3.5 h-3.5 text-white/30 shrink-0" />
              ) : (
                <Globe className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              )}

              <input
                id="nexus-browser-omnibox"
                type="text"
                value={omniboxInput}
                onChange={(e) => setOmniboxInput(e.target.value)}
                onFocus={() => setIsOmniboxFocused(true)}
                onBlur={() => { setTimeout(() => setIsOmniboxFocused(false), 200); }}
                placeholder="Search Google or type a URL..."
                className="flex-1 bg-transparent text-sm text-neutral-100 placeholder-neutral-400 outline-none min-w-0"
              />

              <div className="flex items-center gap-1 shrink-0">
                {activeTab?.url && activeTab.url !== "nexus://start" && (
                  <>
                    <button type="button" onClick={handleCopyUrl} className="p-1 text-neutral-500 hover:text-neutral-200 transition-colors" title="Copy URL">
                      {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    <button type="button" onClick={handleToggleBookmark} className="p-1 hover:text-neutral-200 transition-colors" title={isBookmarked ? "Bookmarked" : "Bookmark"}>
                      <Star className={`w-3.5 h-3.5 ${isBookmarked ? "text-amber-400 fill-amber-400" : "text-neutral-500"}`} />
                    </button>
                  </>
                )}
              </div>
            </form>

            {/* Command Surface on Focus */}
            {isOmniboxFocused && (
              <NexusCommandSurface
                query={omniboxInput}
                onSelectAction={handleCommandSelect}
                onClose={() => setIsOmniboxFocused(false)}
                activeUrl={activeTab?.url}
                activeTitle={activeTab?.title}
              />
            )}
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Picture Studio / Screenshot Button ("Yes Picture") */}
            {/* Picture Studio / Screenshot Button ("Yes Picture") */}
            <button
              type="button"
              onClick={handleCaptureScreenshot}
              disabled={isCapturingScreenshot}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-neutral-400 hover:text-cyan-300 hover:bg-cyan-500/10 border border-transparent hover:border-cyan-500/20 transition-all shadow-sm"
              title="Capture Real Webpage Photo & Telemetry (NEXUS Picture Studio)"
            >
              <Camera className={`w-4 h-4 ${isCapturingScreenshot ? "animate-pulse text-cyan-400" : ""}`} />
            </button>

            {/* Bookmark icon — navigates to Bookmarks view */}
            <button
              type="button"
              onClick={() => onNavigate("bookmarks")}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-neutral-400 hover:text-amber-300 hover:bg-amber-500/10 border border-transparent hover:border-amber-500/20 transition-all"
              title="Bookmarks"
            >
              <Bookmark className="w-4 h-4" />
            </button>

            {/* Extensions — navigates to Extensions view */}
            <button
              type="button"
              onClick={() => onNavigate("extensions")}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-neutral-400 hover:text-violet-300 hover:bg-violet-500/10 border border-transparent hover:border-violet-500/20 transition-all"
              title="Extensions"
            >
              <Puzzle className="w-4 h-4" />
            </button>

            {/* AI Coding Agent Button (Antigravity Agent) */}
            <button
              type="button"
              onClick={() => setShowCodingAgent(true)}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-semibold transition-all ${
                isCodingPlatform
                  ? "bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-500/40 shadow-[0_0_18px_rgba(16,185,129,0.35)] animate-pulse"
                  : "bg-white/[0.04] hover:bg-white/[0.08] text-neutral-300 border border-white/[0.08]"
              }`}
              title={isCodingPlatform ? "Antigravity AI Coding Agent (Connected to Active Coding Platform)" : "Antigravity AI Coding Agent (LeetCode, Online Compilers)"}
            >
              <Code2 className={`w-3.5 h-3.5 ${isCodingPlatform ? "text-emerald-400" : "text-neutral-400"}`} />
              <span className="font-mono text-[11px] font-bold">
                {isCodingPlatform ? "⚡ AI Coding Agent" : "Coding Agent"}
              </span>
            </button>

            {/* AI Intelligence Toggle */}
            <button
              type="button"
              onClick={toggleAiPanel}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-semibold transition-all ${
                showAiPanel
                  ? "bg-violet-600 text-white shadow-[0_0_20px_rgba(139,92,246,0.35)]"
                  : "bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 border border-violet-500/25"
              }`}
              title="Toggle AI Panel (Ctrl+J)"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Ask AI</span>
            </button>

            {/* Settings */}
            <button type="button" onClick={() => onNavigate("settings")} className="w-8 h-8 flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.06] transition-colors" title="Settings">
              <Settings className="w-4 h-4" />
            </button>

            {/* More Menu Dropdown */}
            <div className="relative" ref={moreMenuRef}>
              <button
                type="button"
                onClick={() => setShowMoreMenu((p) => !p)}
                className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                  showMoreMenu
                    ? "bg-white/10 text-white"
                    : "text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.06]"
                }`}
                title="Browser Menu & Tools"
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {showMoreMenu && (
                <div
                  className="absolute right-0 top-full mt-2 w-64 rounded-2xl bg-[#0c0c16] border border-white/10 shadow-2xl p-2 z-50 animate-in fade-in zoom-in-95 duration-150 backdrop-blur-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-3 py-2 border-b border-white/5 mb-1.5 flex items-center justify-between">
                    <span className="text-[11px] font-mono uppercase font-bold text-neutral-400">NEXUS Tools</span>
                    <span className="text-[10px] text-cyan-400 font-mono">v2.0 Pro</span>
                  </div>

                  <div className="space-y-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        handleNewTab();
                        setShowMoreMenu(false);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs text-neutral-300 hover:text-white hover:bg-white/5 transition"
                    >
                      <div className="flex items-center gap-2.5">
                        <Plus className="w-3.5 h-3.5 text-cyan-400" />
                        <span>New Tab</span>
                      </div>
                      <kbd className="text-[10px] text-neutral-500 font-mono">Ctrl+T</kbd>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        onNavigate("bookmarks");
                        setShowMoreMenu(false);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs text-neutral-300 hover:text-white hover:bg-white/5 transition"
                    >
                      <div className="flex items-center gap-2.5">
                        <Bookmark className="w-3.5 h-3.5 text-amber-400" />
                        <span>Bookmarks</span>
                      </div>
                      <kbd className="text-[10px] text-neutral-500 font-mono">Ctrl+B</kbd>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        onNavigate("history");
                        setShowMoreMenu(false);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs text-neutral-300 hover:text-white hover:bg-white/5 transition"
                    >
                      <div className="flex items-center gap-2.5">
                        <Clock className="w-3.5 h-3.5 text-blue-400" />
                        <span>Browsing History</span>
                      </div>
                      <kbd className="text-[10px] text-neutral-500 font-mono">Ctrl+H</kbd>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        onNavigate("downloads");
                        setShowMoreMenu(false);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs text-neutral-300 hover:text-white hover:bg-white/5 transition"
                    >
                      <div className="flex items-center gap-2.5">
                        <Download className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Downloads</span>
                      </div>
                      <kbd className="text-[10px] text-neutral-500 font-mono">Ctrl+J</kbd>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        onNavigate("extensions");
                        setShowMoreMenu(false);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs text-neutral-300 hover:text-white hover:bg-white/5 transition"
                    >
                      <div className="flex items-center gap-2.5">
                        <Puzzle className="w-3.5 h-3.5 text-violet-400" />
                        <span>Extensions</span>
                      </div>
                    </button>

                    <div className="h-px bg-white/5 my-1" />

                    <button
                      type="button"
                      onClick={() => {
                        onNavigate("research");
                        setShowMoreMenu(false);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs text-neutral-300 hover:text-white hover:bg-white/5 transition"
                    >
                      <div className="flex items-center gap-2.5">
                        <Microscope className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Deep Research</span>
                      </div>
                      <span className="text-[10px] font-mono text-cyan-400">20 Sources</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setShowCodingAgent(true);
                        setShowMoreMenu(false);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs text-neutral-300 hover:text-white hover:bg-white/5 transition"
                    >
                      <div className="flex items-center gap-2.5">
                        <Code2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>AI Coding Agent</span>
                      </div>
                      <span className="text-[10px] font-mono text-emerald-400">Active</span>
                    </button>

                    <div className="h-px bg-white/5 my-1" />

                    <button
                      type="button"
                      onClick={() => {
                        onNavigate("settings");
                        setShowMoreMenu(false);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs text-neutral-300 hover:text-white hover:bg-white/5 transition"
                    >
                      <div className="flex items-center gap-2.5">
                        <Settings className="w-3.5 h-3.5 text-neutral-400" />
                        <span>Settings</span>
                      </div>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── MODE BREADCRUMB (non-browser workspace) ── */}
        {currentMode !== "browser" && (
          <div className="flex items-center justify-between px-5 py-2 bg-[#090912] border-b border-white/[0.08] text-xs z-20 shrink-0 shadow-sm">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => onNavigate("browser")}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-600/10 hover:bg-violet-600/20 text-violet-300 hover:text-violet-200 border border-violet-500/20 font-medium transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Return to Browser</span>
              </button>
              <span className="text-neutral-600">/</span>
              <span className="text-neutral-300 font-semibold tracking-wide uppercase text-[11px] font-mono">
                {currentMode === "agent" ? "Automation Studio" : currentMode}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-neutral-400 font-mono hidden sm:inline">Ctrl+1 to return to tabs</span>
            </div>
          </div>
        )}

        {/* ══ MAIN CONTENT ══ */}
        <div className="flex-1 flex overflow-hidden relative">
          {currentMode !== "browser" && children ? (
            <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "#050507" }}>
              {children}
            </div>
          ) : (
            <div className="flex-1 flex overflow-hidden relative">
              <div className="flex-1 flex flex-col overflow-hidden relative">
                {isStartPage ? (
                  <NexusBrowserHome
                    onNavigate={onNavigate}
                    onOpenUrl={(url, title) => openUrl(url, title)}
                    user={user}
                    onOpenAiPanel={(prompt) => {
                      setAiPanelPrompt(prompt);
                      if (!showAiPanel) toggleAiPanel();
                    }}
                  />
                ) : (
                  <div className="flex-1 flex flex-col overflow-hidden bg-neutral-950 relative">
                    {/* Agent Active Banner */}
                    {activeTab?.isAgentControlled && (
                      <div className="flex items-center justify-between px-4 py-2 bg-gradient-to-r from-emerald-950/80 via-emerald-900/40 to-neutral-950 border-b border-emerald-500/30 text-emerald-300 text-xs shrink-0">
                        <div className="flex items-center gap-2">
                          <Radio className="w-3.5 h-3.5 animate-pulse text-emerald-400" />
                          <span className="font-semibold">NEXUS Autonomous Agent Active:</span>
                          <span>{activeTab.agentAction || "Browsing and extracting page intelligence..."}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => onNavigate("agent")}
                          className="px-2 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-500/30 transition-colors"
                        >
                          View Live Agent Run
                        </button>
                      </div>
                    )}

                    {/* Web Content Area */}
                    <div className="flex-1 relative w-full h-full bg-[#05050a]">
                      {!browserShell && (
                        <iframe
                          key={activeTab?.id}
                          src={activeTab?.url}
                          title={activeTab?.title}
                          className="w-full h-full border-0"
                          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                          onError={() => setIframeError(true)}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* AI Intelligence Panel */}
              {showAiPanel && (
                <div className="w-[380px] shrink-0 border-l border-white/[0.06] flex flex-col h-full overflow-hidden shadow-2xl" style={{ background: "#0c0c18" }}>
                  <NexusIntelligencePanel
                    isOpen={showAiPanel}
                    workspaceId={activeWorkspaceId}
                    activeUrl={activeTab?.url === "nexus://start" ? undefined : activeTab?.url}
                    activeTitle={activeTab?.title === "NEXUS Start" ? undefined : activeTab?.title}
                    selectedText={selectedText || undefined}
                    initialPrompt={aiPanelPrompt}
                    windowId={windowId}
                    activeTabId={activeTab?.id}
                    onNavigate={(tab: string) => onNavigate(tab as any)}
                    onClose={() => {
                      if (onToggleAiPanel && showAiPanel) {
                        onToggleAiPanel();
                      } else {
                        setInternalShowAiPanel(false);
                      }
                    }}
                  />
                </div>
              )}

              {/* Agent Automation Timeline Dock (340px) */}
              {showAgentPanel && activeAgentInfo && (
                <div
                  className="w-[340px] shrink-0 border-l border-white/[0.06] flex flex-col h-full overflow-hidden shadow-2xl"
                  style={{ background: "#0d0d1a" }}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-white/[0.02]">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-violet-600/20 border border-violet-500/30 flex items-center justify-center shrink-0">
                        <Bot className="w-4 h-4 text-violet-400 animate-pulse" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold uppercase tracking-wider text-neutral-200 truncate">NEXUS Agent</span>
                          <span className="text-[9px] font-mono px-1.5 py-0.2 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30 shrink-0">
                            Active
                          </span>
                        </div>
                        <div className="text-[10px] text-neutral-400 font-mono truncate">
                          Step {activeAgentInfo.currentStepIndex} of {activeAgentInfo.totalSteps}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAgentPanel(false)}
                      className="p-1 rounded-lg text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.06] transition-colors shrink-0"
                      title="Close Agent Panel"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Task Info */}
                  <div className="p-3.5 border-b border-white/[0.06] bg-violet-950/20">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2 h-2 rounded-full bg-violet-400 animate-ping shrink-0" />
                      <h4 className="text-xs font-semibold text-neutral-100 truncate">{activeAgentInfo.title}</h4>
                    </div>
                    <p className="text-[11px] text-neutral-400 leading-relaxed line-clamp-2">{activeAgentInfo.currentAction}</p>
                  </div>

                  {/* Steps list */}
                  <div className="flex-1 overflow-y-auto p-3 space-y-2" style={{ scrollbarWidth: "thin" }}>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 font-mono mb-1">
                      Execution Timeline
                    </div>
                    {activeAgentInfo.steps.map((step, idx) => {
                      const isDone = step.status === "completed";
                      const isRunning = step.status === "running" || (!isDone && idx === activeAgentInfo.currentStepIndex);
                      return (
                        <div
                          key={step.id}
                          className={`flex items-start gap-2.5 p-2 rounded-xl border transition-all ${
                            isRunning
                              ? "bg-violet-600/15 border-violet-500/35 text-violet-200 shadow-sm"
                              : isDone
                              ? "bg-white/[0.02] border-white/[0.04] text-neutral-400"
                              : "bg-transparent border-transparent text-neutral-600"
                          }`}
                        >
                          {isDone ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                          ) : isRunning ? (
                            <div className="w-3.5 h-3.5 flex items-center justify-center shrink-0 mt-0.5">
                              <div className="w-2 h-2 rounded-full bg-violet-400 animate-ping" />
                            </div>
                          ) : (
                            <Circle className="w-3.5 h-3.5 text-neutral-600 shrink-0 mt-0.5" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div
                              className={`text-[11px] leading-tight ${
                                isDone ? "line-through text-neutral-500" : isRunning ? "text-violet-200 font-semibold" : "text-neutral-500"
                              }`}
                            >
                              {step.title}
                            </div>
                            <div className="text-[9px] text-neutral-500 font-mono mt-0.5">
                              {isDone ? "Completed" : isRunning ? "In progress..." : "Pending"}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Footer link to Automation Studio */}
                  <div className="p-3 border-t border-white/[0.06] bg-white/[0.02]">
                    <button
                      type="button"
                      onClick={() => {
                        setShowAgentPanel(false);
                        onNavigate("agent");
                      }}
                      className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/25 transition-all"
                    >
                      <span>Full Agent Workspace</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Picture / Screenshot Studio Modal (Yes Picture) */}
      {screenshotModal?.isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-lg p-3 sm:p-5 animate-in fade-in duration-200"
          onClick={() => setScreenshotModal(null)}
        >
          <div
            className="relative w-full max-w-5xl h-[90vh] max-h-[860px] bg-[#0c0d18] border border-cyan-500/30 rounded-2xl shadow-[0_0_50px_rgba(34,211,238,0.15)] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ── TOP HEADER ── */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.08] bg-[#101120] shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 via-indigo-600 to-violet-600 flex items-center justify-center text-white shadow-lg shadow-cyan-500/30 shrink-0">
                  <Camera className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-bold text-white tracking-wide">NEXUS Picture Studio</h3>
                    <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Real Photo Capture
                    </span>
                    {screenshotModal.width && screenshotModal.height && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-neutral-300 font-mono border border-white/[0.08]">
                        {screenshotModal.width} × {screenshotModal.height} PNG
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-neutral-400 truncate max-w-xl mt-0.5">
                    {screenshotModal.pageTitle} <span className="text-neutral-600">·</span> <span className="text-neutral-400 font-mono text-[11px]">{screenshotModal.pageUrl}</span> <span className="text-neutral-600">·</span> {screenshotModal.timestamp}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleCaptureScreenshot}
                  disabled={isCapturingScreenshot}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-neutral-300 hover:text-white text-xs border border-white/[0.08] transition-all disabled:opacity-50 cursor-pointer"
                  title="Retake real photo of active page"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isCapturingScreenshot ? "animate-spin text-cyan-400" : ""}`} />
                  <span className="hidden sm:inline">Retake</span>
                </button>
                <button
                  type="button"
                  onClick={() => setScreenshotModal(null)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/[0.08] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* ── MODE SWITCHER STRIP ── */}
            <div className="flex items-center justify-between px-5 py-2.5 bg-[#090914] border-b border-white/[0.06] shrink-0 gap-3 overflow-x-auto">
              {/* Navigation Tabs */}
              <div className="flex items-center gap-1">
                {[
                  { id: "photo", label: "Real Photo", icon: Camera },
                  { id: "showcase", label: "Showcase Frame", icon: Palette },
                  { id: "telemetry", label: "Real Data & Telemetry", icon: Activity, count: screenshotModal.telemetry?.headings?.length },
                  { id: "analysis", label: "AI Vision Analysis", icon: Sparkles, badge: screenshotModal.analysisResult ? "Ready" : undefined },
                ].map(({ id, label, icon: Icon, count, badge }: any) => {
                  const isActive = screenshotModal.viewMode === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setScreenshotModal((prev) => (prev ? { ...prev, viewMode: id } : null))}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        isActive
                          ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm shadow-cyan-500/20"
                          : "text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.04] border border-transparent"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span>{label}</span>
                      {count !== undefined && count > 0 && (
                        <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-cyan-500/20 text-cyan-300 font-mono">
                          {count}
                        </span>
                      )}
                      {badge && (
                        <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-violet-500/20 text-violet-300 font-mono">
                          {badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Context Controls (Zoom or Themes depending on active tab) */}
              <div className="flex items-center gap-2">
                {screenshotModal.viewMode === "showcase" && (
                  <div className="flex items-center gap-1 bg-black/40 p-0.5 rounded-lg border border-white/[0.08]">
                    <span className="text-[10px] text-neutral-400 px-2 font-mono uppercase">Theme:</span>
                    {(["cyber", "space", "sunset", "matrix", "minimal"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setScreenshotModal((prev) => (prev ? { ...prev, showcaseTheme: t } : null))}
                        className={`px-2 py-0.5 rounded text-[11px] font-mono capitalize transition cursor-pointer ${
                          screenshotModal.showcaseTheme === t
                            ? "bg-white/15 text-white font-bold"
                            : "text-neutral-400 hover:text-neutral-200"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}

                {screenshotModal.viewMode === "photo" && (
                  <div className="flex items-center gap-1 bg-black/40 p-0.5 rounded-lg border border-white/[0.08]">
                    <button
                      type="button"
                      onClick={() => setScreenshotModal((prev) => (prev ? { ...prev, zoomLevel: 0 } : null))}
                      className={`px-2 py-0.5 rounded text-[11px] font-mono transition cursor-pointer ${
                        screenshotModal.zoomLevel === 0 ? "bg-white/15 text-white font-bold" : "text-neutral-400 hover:text-neutral-200"
                      }`}
                    >
                      Fit
                    </button>
                    <button
                      type="button"
                      onClick={() => setScreenshotModal((prev) => (prev ? { ...prev, zoomLevel: 1 } : null))}
                      className={`px-2 py-0.5 rounded text-[11px] font-mono transition cursor-pointer ${
                        screenshotModal.zoomLevel === 1 ? "bg-white/15 text-white font-bold" : "text-neutral-400 hover:text-neutral-200"
                      }`}
                    >
                      100%
                    </button>
                    <button
                      type="button"
                      onClick={() => setScreenshotModal((prev) => (prev ? { ...prev, zoomLevel: Math.min((prev.zoomLevel || 1) + 0.25, 2.5) } : null))}
                      className="p-1 text-neutral-400 hover:text-white rounded cursor-pointer"
                      title="Zoom In"
                    >
                      <ZoomIn className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setScreenshotModal((prev) => (prev ? { ...prev, zoomLevel: Math.max((prev.zoomLevel || 1) - 0.25, 0.5) } : null))}
                      className="p-1 text-neutral-400 hover:text-white rounded cursor-pointer"
                      title="Zoom Out"
                    >
                      <ZoomOut className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* ── MAIN STAGE CONTENT (FLEX-1) ── */}
            <div className="flex-1 overflow-auto p-4 sm:p-6 bg-[#070711] relative flex flex-col" style={{ scrollbarWidth: "thin" }}>

              {/* Laser Vision Scanner Animation (Active during AI analysis) */}
              {screenshotModal.isAnalyzing && (
                <div className="absolute inset-0 bg-cyan-950/40 backdrop-blur-[2px] flex flex-col items-center justify-center z-30 pointer-events-none">
                  <div className="w-full h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_25px_#22d3ee] animate-pulse" />
                  <div className="mt-5 flex items-center gap-3 px-5 py-2.5 rounded-xl bg-black/90 border border-cyan-500/50 text-cyan-300 text-xs font-semibold shadow-2xl backdrop-blur-md">
                    <Sparkles className="w-4 h-4 text-cyan-400 animate-spin" />
                    <span>NEXUS Multimodal Vision AI is analyzing visual hierarchy & real data...</span>
                  </div>
                </div>
              )}

              {/* ── VIEW 1: REAL PHOTO VIEW ── */}
              {screenshotModal.viewMode === "photo" && (
                <div className="flex-1 flex items-center justify-center min-h-[300px] overflow-auto">
                  <div
                    className="relative rounded-xl overflow-hidden border border-white/[0.1] shadow-2xl transition-all duration-200"
                    style={{
                      maxHeight: screenshotModal.zoomLevel === 0 ? "100%" : "none",
                      maxWidth: screenshotModal.zoomLevel === 0 ? "100%" : "none",
                      transform: screenshotModal.zoomLevel > 0 ? `scale(${screenshotModal.zoomLevel})` : undefined,
                      transformOrigin: "center center",
                    }}
                  >
                    <img
                      src={screenshotModal.dataUrl}
                      alt="Real Webpage Photo"
                      className="w-full h-auto object-contain rounded-xl select-none"
                    />
                  </div>
                </div>
              )}

              {/* ── VIEW 2: SHOWCASE FRAME (CleanShot / Ray.so Style) ── */}
              {screenshotModal.viewMode === "showcase" && (
                <div className="flex-1 flex items-center justify-center p-2 sm:p-6 overflow-auto">
                  <div
                    className="relative p-6 sm:p-10 rounded-2xl shadow-2xl transition-all duration-300 max-w-4xl w-full"
                    style={{
                      background:
                        screenshotModal.showcaseTheme === "sunset"
                          ? "linear-gradient(135deg, #3b0764, #701a75, #831843)"
                          : screenshotModal.showcaseTheme === "matrix"
                          ? "linear-gradient(135deg, #022c22, #064e3b, #021c15)"
                          : screenshotModal.showcaseTheme === "space"
                          ? "linear-gradient(135deg, #030712, #1e1b4b, #0f172a)"
                          : screenshotModal.showcaseTheme === "minimal"
                          ? "linear-gradient(135deg, #18181b, #09090b)"
                          : "linear-gradient(135deg, #0c0a2a, #1e1b4b, #020617)",
                    }}
                  >
                    {/* Framed Window */}
                    <div className="rounded-xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.7)] border border-white/10 bg-[#12121f]">
                      {/* Window Header */}
                      <div className="flex items-center gap-2 px-4 py-2.5 bg-[#0e0e18] border-b border-white/[0.06]">
                        <div className="flex items-center gap-1.5">
                          <span className="w-3 h-3 rounded-full bg-[#ff5f56]" />
                          <span className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                          <span className="w-3 h-3 rounded-full bg-[#27c93f]" />
                        </div>
                        <div className="flex-1 flex justify-center px-4">
                          <div className="px-3 py-1 rounded-md bg-white/[0.06] border border-white/[0.08] text-[11px] text-indigo-200/80 font-mono truncate max-w-sm flex items-center gap-1.5">
                            <span className="text-emerald-400">🔒</span>
                            <span className="truncate">{screenshotModal.pageUrl}</span>
                          </div>
                        </div>
                        <div className="w-10" />
                      </div>
                      {/* Real Image Body */}
                      <img
                        src={screenshotModal.dataUrl}
                        alt="Framed Webpage Photo"
                        className="w-full h-auto object-cover max-h-[460px]"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ── VIEW 3: REAL DATA & TELEMETRY ── */}
              {screenshotModal.viewMode === "telemetry" && (
                <div className="space-y-4 max-w-4xl mx-auto w-full">
                  {/* 4 Metrics Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                      <div className="flex items-center justify-between text-neutral-400 mb-1">
                        <span className="text-[11px] font-mono uppercase tracking-wider">Protocol</span>
                        <Shield className="w-3.5 h-3.5 text-emerald-400" />
                      </div>
                      <div className="text-sm font-bold text-white flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                        <span>{screenshotModal.telemetry?.security.protocol || "HTTPS"} Verified</span>
                      </div>
                      <div className="text-[10px] text-neutral-400 font-mono mt-1">SSL Encrypted · Sandboxed</div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                      <div className="flex items-center justify-between text-neutral-400 mb-1">
                        <span className="text-[11px] font-mono uppercase tracking-wider">Performance</span>
                        <Activity className="w-3.5 h-3.5 text-cyan-400" />
                      </div>
                      <div className="text-sm font-bold text-cyan-300">
                        {screenshotModal.telemetry?.performance.loadTimeMs || 185} ms
                      </div>
                      <div className="text-[10px] text-neutral-400 font-mono mt-1">
                        DOM Ready: {screenshotModal.telemetry?.performance.domContentLoadedMs || 140} ms
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                      <div className="flex items-center justify-between text-neutral-400 mb-1">
                        <span className="text-[11px] font-mono uppercase tracking-wider">Content Volume</span>
                        <FileText className="w-3.5 h-3.5 text-violet-400" />
                      </div>
                      <div className="text-sm font-bold text-violet-300">
                        {screenshotModal.telemetry?.wordCount ? `${screenshotModal.telemetry.wordCount.toLocaleString()} Words` : "Live Text Tracked"}
                      </div>
                      <div className="text-[10px] text-neutral-400 font-mono mt-1">
                        {screenshotModal.telemetry?.readingTimeMin || 1} min read · {screenshotModal.telemetry?.linksCount || 0} Links
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                      <div className="flex items-center justify-between text-neutral-400 mb-1">
                        <span className="text-[11px] font-mono uppercase tracking-wider">Canvas Native</span>
                        <Maximize2 className="w-3.5 h-3.5 text-amber-400" />
                      </div>
                      <div className="text-sm font-bold text-amber-300">
                        {screenshotModal.width} × {screenshotModal.height}
                      </div>
                      <div className="text-[10px] text-neutral-400 font-mono mt-1">
                        DPR: {screenshotModal.telemetry?.dimensions.devicePixelRatio || 1}x · Full Height: {screenshotModal.telemetry?.dimensions.scrollHeight || 0}px
                      </div>
                    </div>
                  </div>

                  {/* Real Headings Extracted */}
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08] space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Hash className="w-4 h-4 text-cyan-400" />
                        <span className="text-xs font-bold text-white font-mono uppercase tracking-wider">
                          Real DOM Headings Extracted ({screenshotModal.telemetry?.headings?.length || 0})
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          const text = (screenshotModal.telemetry?.headings || []).join("\n");
                          await navigator.clipboard.writeText(text);
                          toast.success("Headings copied to clipboard!");
                        }}
                        className="text-[11px] text-cyan-400 hover:text-cyan-300 transition font-mono cursor-pointer"
                      >
                        Copy Headings
                      </button>
                    </div>
                    {screenshotModal.telemetry?.headings && screenshotModal.telemetry.headings.length > 0 ? (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pt-1">
                        {screenshotModal.telemetry.headings.map((h, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs text-neutral-300 p-2 rounded-lg bg-black/30 border border-white/[0.04]">
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 shrink-0">
                              H{i === 0 ? 1 : 2}
                            </span>
                            <span className="truncate">{h}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-neutral-400 italic py-2">
                        No headings detected on active view.
                      </div>
                    )}
                  </div>

                  {/* Real Page Snippet / Text */}
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08] space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-violet-400" />
                        <span className="text-xs font-bold text-white font-mono uppercase tracking-wider">
                          Real In-Page Content Excerpt
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          await navigator.clipboard.writeText(screenshotModal.telemetry?.snippet || screenshotModal.pageTitle);
                          toast.success("Content excerpt copied!");
                        }}
                        className="text-[11px] text-violet-400 hover:text-violet-300 transition font-mono cursor-pointer"
                      >
                        Copy Excerpt
                      </button>
                    </div>
                    <p className="text-xs text-neutral-300 leading-relaxed bg-black/30 p-3 rounded-lg border border-white/[0.04] max-h-40 overflow-y-auto select-text">
                      {screenshotModal.telemetry?.snippet || screenshotModal.telemetry?.metaDescription || "No textual description available for this page."}
                    </p>
                  </div>
                </div>
              )}

              {/* ── VIEW 4: AI VISION ANALYSIS ── */}
              {screenshotModal.viewMode === "analysis" && (
                <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full space-y-3">
                  {screenshotModal.analysisResult ? (
                    <div className="rounded-xl bg-[#090a16] border border-cyan-500/30 p-5 text-xs text-neutral-200 space-y-4 shadow-xl overflow-y-auto">
                      <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-lg bg-cyan-500/20 text-cyan-300 flex items-center justify-center shadow-sm">
                            <Sparkles className="w-3.5 h-3.5" />
                          </div>
                          <div>
                            <span className="font-bold text-cyan-300 font-mono text-xs uppercase tracking-wider">
                              Empirical Multimodal AI Analysis
                            </span>
                            <div className="text-[10px] text-neutral-400">Generated from Real Photo & Live Telemetry</div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              await navigator.clipboard.writeText(screenshotModal.analysisResult || "");
                              toast.success("Analysis report copied to clipboard!");
                            }}
                            className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white text-xs transition border border-white/5 cursor-pointer"
                          >
                            Copy Report
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAiPanelPrompt(`Visual snapshot analysis from ${screenshotModal.pageTitle}:\n\n${screenshotModal.analysisResult}\n\nWhat are the highest-impact actions we can execute on this page?`);
                              if (!showAiPanel) toggleAiPanel();
                              setScreenshotModal(null);
                            }}
                            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-semibold transition shadow-md shadow-violet-600/30 cursor-pointer"
                          >
                            <span>Open in AI Chat</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      <div className="whitespace-pre-wrap leading-relaxed text-neutral-300 font-sans text-xs select-text space-y-2">
                        {screenshotModal.analysisResult}
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
                      <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 shadow-lg">
                        <Sparkles className="w-6 h-6" />
                      </div>
                      <h4 className="text-sm font-bold text-white">Multimodal Vision Analysis Armed</h4>
                      <p className="text-xs text-neutral-400 max-w-md">
                        NEXUS AI can inspect the real captured layout, typography, UI controls, and extracted DOM telemetry to generate actionable insights.
                      </p>
                      <button
                        type="button"
                        onClick={handleAnalyzeScreenshot}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-600 via-indigo-600 to-violet-600 hover:from-cyan-500 hover:to-violet-500 text-white text-xs font-semibold shadow-lg shadow-cyan-600/25 transition cursor-pointer"
                      >
                        <Sparkles className="w-4 h-4" />
                        <span>Run Full AI Vision Analysis</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── FOOTER ACTIONS BAR ── */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-white/[0.08] bg-[#0c0d18] shrink-0">
              <div className="flex items-center gap-2">
                {/* Download PNG (Raw Photo or Framed Showcase) */}
                <button
                  type="button"
                  onClick={handleDownload}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition-all cursor-pointer"
                  title="Download Real PNG image"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download {screenshotModal.viewMode === "showcase" ? "Showcase PNG" : "Real PNG"}</span>
                </button>

                {/* Copy Real Image Directly to Clipboard (Binary ClipboardItem) */}
                <button
                  type="button"
                  onClick={handleCopyRealImage}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.1] text-neutral-200 text-xs font-medium transition-all cursor-pointer"
                  title="Copy Real Image to Clipboard (Paste directly in Discord, Slack, etc.)"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Image</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                {/* Save to Memory */}
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await nexusClient.createMemory({
                        type: "website",
                        key: `Picture Snapshot: ${screenshotModal.pageTitle}`,
                        content: `Real visual snapshot of ${screenshotModal.pageUrl} (${screenshotModal.width}x${screenshotModal.height}) captured at ${screenshotModal.timestamp}. Words: ${screenshotModal.telemetry?.wordCount || 0}. Excerpt: ${(screenshotModal.telemetry?.snippet || "").slice(0, 300)}`,
                        importance: 0.9,
                      });
                      toast.success("Saved real snapshot & telemetry to Memory Vault!");
                    } catch (err: any) {
                      toast.error(`Memory save failed: ${err.message}`);
                    }
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 text-cyan-300 text-xs font-semibold transition-all cursor-pointer"
                >
                  <Bookmark className="w-3.5 h-3.5" />
                  <span>Save to Memory</span>
                </button>

                {/* Analyze with AI Button */}
                <button
                  type="button"
                  disabled={screenshotModal.isAnalyzing}
                  onClick={handleAnalyzeScreenshot}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-600 via-indigo-600 to-violet-600 hover:from-cyan-500 hover:to-violet-500 text-white text-xs font-semibold shadow-lg shadow-cyan-600/25 disabled:opacity-40 transition-all cursor-pointer"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${screenshotModal.isAnalyzing ? "animate-spin" : ""}`} />
                  <span>{screenshotModal.isAnalyzing ? "Analyzing..." : screenshotModal.analysisResult ? "Re-analyze with AI" : "Analyze with AI"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating Text Action Bar */}
      <NexusActionBar
        onAction={async (action: string, text: string) => {
          if (action === "ask") {
            setAiPanelPrompt(`Explain this selection: "${text}"`);
            if (!showAiPanel) toggleAiPanel();
          } else if (action === "explain") {
            setAiPanelPrompt(`Explain in depth: "${text}"`);
            if (!showAiPanel) toggleAiPanel();
          } else if (action === "research") {
            onNavigate("research");
          } else if (action === "create_task") {
            try {
              await (nexusClient as any).createAgentTask({
                title: `Task: ${text.slice(0, 40)}`,
                description: text,
              });
              toast.success("Dispatched autonomous agent task!");
            } catch (err: any) {
              toast.error(`Task error: ${err.message}`);
            }
          } else if (action === "save_memory") {
            try {
              await nexusClient.createMemory({
                type: "fact",
                key: `Highlight from ${activeTab?.title || "Webpage"}`,
                content: text,
                importance: 0.8,
              });
              toast.success("Saved highlight to NEXUS Memory!");
            } catch (err: any) {
              toast.error(`Failed to save: ${err.message}`);
            }
          }
        }}
      />

      {/* Antigravity AI Coding Agent Modal */}
      <NexusCodingAgentModal
        isOpen={showCodingAgent}
        onClose={() => setShowCodingAgent(false)}
        windowId={windowId}
        activeTabId={activeTab?.id}
        activeUrl={activeTab?.url === "nexus://start" ? undefined : activeTab?.url}
        activeTitle={activeTab?.title === "NEXUS Start" ? undefined : activeTab?.title}
        workspaceId={activeWorkspaceId}
      />

      {/* Workspace Create / Edit Modal */}
      <NexusWorkspaceModal
        isOpen={workspaceModal.isOpen}
        mode={workspaceModal.mode}
        workspaceToEdit={workspaceModal.workspaceToEdit}
        onClose={() => setWorkspaceModal((prev) => ({ ...prev, isOpen: false }))}
        onSuccess={handleWorkspaceSuccess}
      />
    </div>
  );
};

