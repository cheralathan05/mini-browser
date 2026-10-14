// NEXUS BROWSER — Tab Search & Watch Intelligence Engine
// Intercepts and parses every tab navigation, omnibox search, and media watch event.
// Captures: exact time, platform identity, search query, video title, and duration.

import { nexusClient } from "./nexus-client";

export type ActionType = "search" | "watch" | "read" | "visit";

export interface PlatformInfo {
  id: string;
  name: string;
  domain: string;
  brandColor: string;
  badgeBg: string;
  badgeBorder: string;
  textColor: string;
  iconType: "google" | "youtube" | "github" | "reddit" | "twitter" | "duckduckgo" | "bing" | "wikipedia" | "amazon" | "perplexity" | "generic";
}

export interface TabActivityRecord {
  id: string;
  action: ActionType;
  platform: PlatformInfo;
  query?: string;
  title: string;
  url: string;
  favicon?: string;
  timestamp: number;
  formattedTime: string;
  formattedDate: string;
  timeAgo: string;
  durationSeconds?: number;
  videoId?: string;
  channel?: string;
  aiSummary?: string;
  tags: string[];
  isPinned?: boolean;
  isVerified?: boolean;
  notes?: Array<{ id: string; content: string; createdAt: number }>;
  backendMemoryId?: string;
}

const STORAGE_KEY = "nexus_tab_intelligence_records_v1";

// Standard Platforms Configuration
export const KNOWN_PLATFORMS: Record<string, PlatformInfo> = {
  google: {
    id: "google",
    name: "Google Search",
    domain: "google.com",
    brandColor: "#4285F4",
    badgeBg: "rgba(66, 133, 244, 0.14)",
    badgeBorder: "rgba(66, 133, 244, 0.35)",
    textColor: "#93bbf8",
    iconType: "google",
  },
  youtube: {
    id: "youtube",
    name: "YouTube",
    domain: "youtube.com",
    brandColor: "#FF0000",
    badgeBg: "rgba(255, 0, 0, 0.14)",
    badgeBorder: "rgba(255, 0, 0, 0.35)",
    textColor: "#ff8080",
    iconType: "youtube",
  },
  github: {
    id: "github",
    name: "GitHub",
    domain: "github.com",
    brandColor: "#a855f7",
    badgeBg: "rgba(168, 85, 247, 0.14)",
    badgeBorder: "rgba(168, 85, 247, 0.35)",
    textColor: "#c084fc",
    iconType: "github",
  },
  reddit: {
    id: "reddit",
    name: "Reddit",
    domain: "reddit.com",
    brandColor: "#FF4500",
    badgeBg: "rgba(255, 69, 0, 0.14)",
    badgeBorder: "rgba(255, 69, 0, 0.35)",
    textColor: "#ff8c66",
    iconType: "reddit",
  },
  twitter: {
    id: "twitter",
    name: "X (Twitter)",
    domain: "x.com",
    brandColor: "#38bdf8",
    badgeBg: "rgba(56, 189, 248, 0.14)",
    badgeBorder: "rgba(56, 189, 248, 0.35)",
    textColor: "#7dd3fc",
    iconType: "twitter",
  },
  duckduckgo: {
    id: "duckduckgo",
    name: "DuckDuckGo",
    domain: "duckduckgo.com",
    brandColor: "#DE5833",
    badgeBg: "rgba(222, 88, 51, 0.14)",
    badgeBorder: "rgba(222, 88, 51, 0.35)",
    textColor: "#f0947a",
    iconType: "duckduckgo",
  },
  bing: {
    id: "bing",
    name: "Microsoft Bing",
    domain: "bing.com",
    brandColor: "#008373",
    badgeBg: "rgba(0, 131, 115, 0.14)",
    badgeBorder: "rgba(0, 131, 115, 0.35)",
    textColor: "#4ade80",
    iconType: "bing",
  },
  wikipedia: {
    id: "wikipedia",
    name: "Wikipedia",
    domain: "wikipedia.org",
    brandColor: "#94a3b8",
    badgeBg: "rgba(148, 163, 184, 0.14)",
    badgeBorder: "rgba(148, 163, 184, 0.35)",
    textColor: "#cbd5e1",
    iconType: "wikipedia",
  },
  amazon: {
    id: "amazon",
    name: "Amazon",
    domain: "amazon.com",
    brandColor: "#FF9900",
    badgeBg: "rgba(255, 153, 0, 0.14)",
    badgeBorder: "rgba(255, 153, 0, 0.35)",
    textColor: "#fbbf24",
    iconType: "amazon",
  },
  perplexity: {
    id: "perplexity",
    name: "Perplexity AI",
    domain: "perplexity.ai",
    brandColor: "#20B2AA",
    badgeBg: "rgba(32, 178, 170, 0.14)",
    badgeBorder: "rgba(32, 178, 170, 0.35)",
    textColor: "#5eead4",
    iconType: "perplexity",
  },
};

function formatTime(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatDate(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: new Date(timestamp).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    });
  } catch {
    return "";
  }
}

export function computeTimeAgo(timestamp: number): string {
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  return formatDate(timestamp);
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "0s";
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const remSec = seconds % 60;
  if (mins < 60) return remSec > 0 ? `${mins}m ${remSec}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMin = mins % 60;
  return `${hrs}h ${remMin}m`;
}

class TabIntelligenceService {
  private records: TabActivityRecord[] = [];
  private listeners: Set<(records: TabActivityRecord[]) => void> = new Set();
  private activeTabTracking: { tabId: string; url: string; startTime: number } | null = null;
  private durationInterval: any = null;

  constructor() {
    this.loadFromStorage();
    this.startDurationTracking();
  }

  private loadFromStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // Filter out any legacy mock demo records
          this.records = parsed
            .filter((r: any) => !r.id?.startsWith("demo-"))
            .map((r: any) => ({
              ...r,
              timeAgo: computeTimeAgo(r.timestamp),
            }));
        }
      }
    } catch (e) {
      console.warn("Failed to load tab intelligence records from storage:", e);
    }

    // Auto-sync real browser history from Electron shell and PostgreSQL backend
    void this.syncFromBrowserHistory();
    void this.syncFromBackend();
  }

  private saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.records.slice(0, 300)));
    } catch (e) {
      console.warn("Failed to save tab intelligence records to storage:", e);
    }
    this.notify();
  }

  private notify() {
    const updated = this.getRecords();
    for (const listener of this.listeners) {
      try {
        listener(updated);
      } catch (err) {
        console.error("TabIntelligence listener error:", err);
      }
    }
  }

  public subscribe(listener: (records: TabActivityRecord[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.getRecords());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getRecords(): TabActivityRecord[] {
    return this.records
      .map((r) => ({ ...r, timeAgo: computeTimeAgo(r.timestamp) }))
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Automatically inspects a URL and title, categorizing platform, search query, or watched video.
   */
  public parseUrl(url: string, title?: string): {
    action: ActionType;
    platform: PlatformInfo;
    query?: string;
    cleanTitle: string;
    videoId?: string;
    channel?: string;
    tags: string[];
    aiSummary?: string;
  } {
    let cleanTitle = (title || "").trim();
    let action: ActionType = "visit";
    let query: string | undefined;
    let videoId: string | undefined;
    let channel: string | undefined;
    const tags: string[] = [];
    let aiSummary: string | undefined;

    try {
      const parsedUrl = new URL(url);
      const hostname = parsedUrl.hostname.toLowerCase().replace(/^www\./, "");
      const pathname = parsedUrl.pathname;
      const searchParams = parsedUrl.searchParams;

      // 1. Google
      if (hostname.includes("google.")) {
        if (pathname.includes("/search")) {
          action = "search";
          query = searchParams.get("q") || "";
          tags.push("google", "search");
          cleanTitle = query ? `Google Search: "${query}"` : cleanTitle || "Google Search";
          aiSummary = query ? `Search query for "${query}" on Google Search.` : undefined;
        } else {
          cleanTitle = cleanTitle || "Google";
        }
        return { action, platform: KNOWN_PLATFORMS.google, query, cleanTitle, tags, aiSummary };
      }

      // 2. YouTube
      if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) {
        if (pathname.includes("/results")) {
          action = "search";
          query = searchParams.get("search_query") || "";
          tags.push("youtube", "video-search");
          cleanTitle = query ? `YouTube Search: "${query}"` : cleanTitle || "YouTube Search";
          aiSummary = query ? `Searched YouTube for video content matching "${query}".` : undefined;
        } else if (pathname.includes("/watch") || hostname.includes("youtu.be") || pathname.includes("/shorts/")) {
          action = "watch";
          videoId = searchParams.get("v") || pathname.split("/").pop() || "";
          tags.push("youtube", "video", "media");
          // Clean YouTube title: remove " - YouTube" suffix
          if (cleanTitle.endsWith(" - YouTube")) {
            cleanTitle = cleanTitle.replace(/ - YouTube$/, "");
          }
          cleanTitle = cleanTitle || `YouTube Video (${videoId || "Watch"})`;
          aiSummary = `Watched streaming video on YouTube: "${cleanTitle}".`;
        }
        return { action, platform: KNOWN_PLATFORMS.youtube, query, cleanTitle, videoId, channel, tags, aiSummary };
      }

      // 3. GitHub
      if (hostname.includes("github.com")) {
        if (pathname.includes("/search")) {
          action = "search";
          query = searchParams.get("q") || "";
          tags.push("github", "code-search", "developer");
          cleanTitle = query ? `GitHub Search: "${query}"` : cleanTitle || "GitHub Search";
          aiSummary = query ? `Searched GitHub repositories and code for "${query}".` : undefined;
        } else {
          action = "read";
          tags.push("github", "repository", "code");
          cleanTitle = cleanTitle || `GitHub: ${pathname.slice(1)}`;
          aiSummary = `Navigated GitHub repository or code artifact: ${pathname.slice(1)}`;
        }
        return { action, platform: KNOWN_PLATFORMS.github, query, cleanTitle, tags, aiSummary };
      }

      // 4. Reddit
      if (hostname.includes("reddit.com")) {
        if (pathname.includes("/search")) {
          action = "search";
          query = searchParams.get("q") || "";
          tags.push("reddit", "community", "search");
          cleanTitle = query ? `Reddit Search: "${query}"` : cleanTitle || "Reddit Search";
          aiSummary = query ? `Searched Reddit community discussions for "${query}".` : undefined;
        } else {
          action = "read";
          tags.push("reddit", "community");
          cleanTitle = cleanTitle || "Reddit Discussion";
        }
        return { action, platform: KNOWN_PLATFORMS.reddit, query, cleanTitle, tags, aiSummary };
      }

      // 5. X / Twitter
      if (hostname.includes("x.com") || hostname.includes("twitter.com")) {
        if (pathname.includes("/search")) {
          action = "search";
          query = searchParams.get("q") || "";
          tags.push("twitter", "social-search");
          cleanTitle = query ? `X Search: "${query}"` : cleanTitle || "X Search";
          aiSummary = query ? `Searched live feeds on X (Twitter) for "${query}".` : undefined;
        } else {
          action = "read";
          tags.push("twitter", "social");
          cleanTitle = cleanTitle || "X Feed";
        }
        return { action, platform: KNOWN_PLATFORMS.twitter, query, cleanTitle, tags, aiSummary };
      }

      // 6. DuckDuckGo
      if (hostname.includes("duckduckgo.com")) {
        action = "search";
        query = searchParams.get("q") || "";
        tags.push("duckduckgo", "private-search");
        cleanTitle = query ? `DuckDuckGo: "${query}"` : cleanTitle || "DuckDuckGo Search";
        aiSummary = query ? `Executed privacy search for "${query}" on DuckDuckGo.` : undefined;
        return { action, platform: KNOWN_PLATFORMS.duckduckgo, query, cleanTitle, tags, aiSummary };
      }

      // 7. Bing
      if (hostname.includes("bing.com")) {
        action = "search";
        query = searchParams.get("q") || "";
        tags.push("bing", "search");
        cleanTitle = query ? `Bing Search: "${query}"` : cleanTitle || "Bing Search";
        aiSummary = query ? `Searched Microsoft Bing for "${query}".` : undefined;
        return { action, platform: KNOWN_PLATFORMS.bing, query, cleanTitle, tags, aiSummary };
      }

      // 8. Wikipedia
      if (hostname.includes("wikipedia.org")) {
        if (pathname.includes("/Special:Search")) {
          action = "search";
          query = searchParams.get("search") || "";
          tags.push("wikipedia", "encyclopedia");
          cleanTitle = query ? `Wikipedia Search: "${query}"` : cleanTitle || "Wikipedia Search";
          aiSummary = query ? `Searched Wikipedia encyclopedia for "${query}".` : undefined;
        } else {
          action = "read";
          tags.push("wikipedia", "encyclopedia", "knowledge");
          cleanTitle = cleanTitle || "Wikipedia Article";
          aiSummary = `Read encyclopedic reference on Wikipedia: ${cleanTitle}`;
        }
        return { action, platform: KNOWN_PLATFORMS.wikipedia, query, cleanTitle, tags, aiSummary };
      }

      // 9. Amazon
      if (hostname.includes("amazon.")) {
        if (pathname.includes("/s") || searchParams.has("k")) {
          action = "search";
          query = searchParams.get("k") || "";
          tags.push("amazon", "shopping", "products");
          cleanTitle = query ? `Amazon Search: "${query}"` : cleanTitle || "Amazon Shopping";
          aiSummary = query ? `Searched Amazon catalog for "${query}".` : undefined;
        } else {
          action = "visit";
          tags.push("amazon", "shopping");
          cleanTitle = cleanTitle || "Amazon";
        }
        return { action, platform: KNOWN_PLATFORMS.amazon, query, cleanTitle, tags, aiSummary };
      }

      // 10. Perplexity AI
      if (hostname.includes("perplexity.ai")) {
        action = "search";
        query = searchParams.get("q") || pathname.replace(/^\/search\/?/, "") || "";
        tags.push("perplexity", "ai-search");
        cleanTitle = query ? `Perplexity AI: "${query}"` : cleanTitle || "Perplexity AI";
        aiSummary = query ? `AI-synthesized research query for "${query}" on Perplexity.` : undefined;
        return { action, platform: KNOWN_PLATFORMS.perplexity, query, cleanTitle, tags, aiSummary };
      }

      // 11. Generic Search detection
      const genericQuery =
        searchParams.get("q") ||
        searchParams.get("query") ||
        searchParams.get("search") ||
        searchParams.get("k") ||
        searchParams.get("keyword");

      if (genericQuery && genericQuery.length > 1) {
        action = "search";
        query = genericQuery;
        tags.push("search", hostname);
        cleanTitle = cleanTitle || `${hostname} Search: "${query}"`;
        aiSummary = `Search query for "${query}" on ${hostname}.`;
      } else {
        cleanTitle = cleanTitle || hostname;
        tags.push("web", hostname);
      }

      // Media / Video streaming check
      if (
        hostname.includes("netflix.") ||
        hostname.includes("twitch.tv") ||
        hostname.includes("vimeo.com") ||
        hostname.includes("dailymotion.") ||
        hostname.includes("tiktok.com")
      ) {
        action = "watch";
        tags.push("video", "media");
        aiSummary = `Watched streaming media on ${hostname}: "${cleanTitle}".`;
      }

      const genericPlatform: PlatformInfo = {
        id: hostname.replace(/[^a-z0-9]/gi, "_"),
        name: hostname.charAt(0).toUpperCase() + hostname.slice(1),
        domain: hostname,
        brandColor: "#6366f1",
        badgeBg: "rgba(99, 102, 241, 0.14)",
        badgeBorder: "rgba(99, 102, 241, 0.35)",
        textColor: "#a5b4fc",
        iconType: "generic",
      };

      return { action, platform: genericPlatform, query, cleanTitle, tags, aiSummary };
    } catch {
      return {
        action: "visit",
        platform: {
          id: "web",
          name: "Web Page",
          domain: url,
          brandColor: "#94a3b8",
          badgeBg: "rgba(148, 163, 184, 0.14)",
          badgeBorder: "rgba(148, 163, 184, 0.35)",
          textColor: "#cbd5e1",
          iconType: "generic",
        },
        cleanTitle: cleanTitle || url,
        tags: ["web"],
      };
    }
  }

  /**
   * Main entry point: Records navigation or search across any tab.
   */
  public recordNavigation(
    url: string,
    title?: string,
    tabId?: string,
    explicitAction?: ActionType,
    explicitQuery?: string
  ): TabActivityRecord | null {
    if (!url || url === "nexus://start" || url.startsWith("nexus://")) {
      return null;
    }

    const now = Date.now();
    const parsed = this.parseUrl(url, title);
    const action = explicitAction || parsed.action;
    const query = explicitQuery || parsed.query;
    const recordTitle = query ? (action === "search" ? `Search: "${query}"` : parsed.cleanTitle) : parsed.cleanTitle;

    // Check for recent duplicate (within 15 seconds for same URL) to avoid spamming
    const existingIndex = this.records.findIndex(
      (r) => r.url === url && now - r.timestamp < 15000
    );

    if (existingIndex !== -1) {
      // Just update timestamp and title if better
      const existing = this.records[existingIndex];
      existing.timestamp = now;
      existing.formattedTime = formatTime(now);
      existing.timeAgo = "Just now";
      if (title && title !== "Page" && title !== "NEXUS Start") {
        existing.title = title;
      }
      this.saveToStorage();
      return existing;
    }

    const id = `act-${now}-${Math.random().toString(36).slice(2, 7)}`;
    const newRecord: TabActivityRecord = {
      id,
      action,
      platform: parsed.platform,
      query,
      title: recordTitle,
      url,
      favicon: url.startsWith("http") ? `https://${parsed.platform.domain}/favicon.ico` : undefined,
      timestamp: now,
      formattedTime: formatTime(now),
      formattedDate: formatDate(now),
      timeAgo: "Just now",
      durationSeconds: action === "watch" ? 10 : undefined,
      videoId: parsed.videoId,
      channel: parsed.channel,
      aiSummary: parsed.aiSummary,
      tags: parsed.tags,
      isPinned: false,
      isVerified: action === "search" || action === "watch",
      notes: [],
    };

    // Prepend to list
    this.records = [newRecord, ...this.records].slice(0, 300);
    this.saveToStorage();

    // If watching or active, track active tab dwell time
    if (tabId) {
      this.setActiveTab(tabId, url);
    }

    // Mirror to backend NEXUS Memory asynchronously
    this.syncToBackendMemory(newRecord);

    return newRecord;
  }

  /**
   * Set active tab for dwell/watch time tracking.
   */
  public setActiveTab(tabId: string, url: string) {
    // If previous tab was being tracked, update its duration
    if (this.activeTabTracking && this.activeTabTracking.url) {
      const elapsedSec = Math.max(1, Math.floor((Date.now() - this.activeTabTracking.startTime) / 1000));
      this.updateDurationForUrl(this.activeTabTracking.url, elapsedSec);
    }

    this.activeTabTracking = {
      tabId,
      url,
      startTime: Date.now(),
    };
  }

  private startDurationTracking() {
    if (this.durationInterval) clearInterval(this.durationInterval);
    this.durationInterval = setInterval(() => {
      if (this.activeTabTracking && this.activeTabTracking.url) {
        const elapsedSec = Math.max(1, Math.floor((Date.now() - this.activeTabTracking.startTime) / 1000));
        // Only update if >= 5s
        if (elapsedSec % 5 === 0) {
          this.updateDurationForUrl(this.activeTabTracking.url, elapsedSec);
        }
      }
    }, 5000);
  }

  private updateDurationForUrl(url: string, addedSeconds: number) {
    const target = this.records.find((r) => r.url === url);
    if (target) {
      target.durationSeconds = (target.durationSeconds || 0) + addedSeconds;
      this.saveToStorage();
    }
  }

  /**
   * Asynchronously saves into Nexus Memory PostgreSQL backend.
   */
  private async syncToBackendMemory(record: TabActivityRecord) {
    try {
      const memType = record.action === "search" ? "RESEARCH" : record.action === "watch" ? "SOURCE" : "FACT";
      const res = await nexusClient.createMemory({
        type: memType,
        category: record.platform.name,
        title: record.title,
        key: `${record.action.toUpperCase()}: ${record.query || record.title}`,
        content: `Activity: ${record.action.toUpperCase()} on ${record.platform.name}\nURL: ${record.url}\nTime: ${record.formattedDate} ${record.formattedTime}\nQuery/Detail: ${record.query || record.title}\n${record.aiSummary || ""}`,
        summary: record.aiSummary || `${record.action} on ${record.platform.name}`,
        importance: record.action === "search" || record.action === "watch" ? 0.85 : 0.6,
        sourceUrl: record.url,
        sourceTitle: record.title,
        sourceDomain: record.platform.domain,
        sourceType: record.action === "watch" ? "VIDEO" : "WEB",
        tags: record.tags,
      });

      if (res?.memory?.id) {
        record.backendMemoryId = res.memory.id;
      }
    } catch {
      // Backend might be offline or unauthorized; local storage safely maintains data!
    }
  }

  /**
   * Imports all existing history records from Electron's browserShell.
   */
  public async syncFromBrowserHistory(): Promise<number> {
    const shell = typeof window !== "undefined" ? (window as any).browserShell : undefined;
    if (!shell?.historyGetState) return 0;

    try {
      const state = await shell.historyGetState();
      const rawRecords: any[] = state?.records || [];
      if (!Array.isArray(rawRecords) || rawRecords.length === 0) return 0;

      let importedCount = 0;
      for (const raw of rawRecords) {
        if (!raw.url || raw.url === "nexus://start" || raw.url.startsWith("nexus://")) continue;

        const exists = this.records.some((r) => r.url === raw.url);
        if (exists) continue;

        const ts = raw.lastVisitedAt || raw.createdAt || Date.now();
        const parsed = this.parseUrl(raw.url, raw.title);
        const recordTitle = parsed.query
          ? (parsed.action === "search" ? `Search: "${parsed.query}"` : parsed.cleanTitle)
          : parsed.cleanTitle;

        const record: TabActivityRecord = {
          id: `hist-${raw.id || Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          action: parsed.action,
          platform: parsed.platform,
          query: parsed.query,
          title: recordTitle,
          url: raw.url,
          favicon: raw.favicon || (raw.url.startsWith("http") ? `https://${parsed.platform.domain}/favicon.ico` : undefined),
          timestamp: ts,
          formattedTime: formatTime(ts),
          formattedDate: formatDate(ts),
          timeAgo: computeTimeAgo(ts),
          durationSeconds: parsed.action === "watch" ? 180 : undefined,
          videoId: parsed.videoId,
          channel: parsed.channel,
          aiSummary: parsed.aiSummary,
          tags: parsed.tags,
          isPinned: false,
          isVerified: true,
          notes: [],
        };

        this.records.push(record);
        importedCount++;
      }

      if (importedCount > 0) {
        this.records.sort((a, b) => b.timestamp - a.timestamp);
        this.saveToStorage();
      }

      return importedCount;
    } catch (e) {
      console.warn("Failed to sync from browser history:", e);
      return 0;
    }
  }

  /**
   * Imports existing knowledge records from the PostgreSQL database backend.
   */
  public async syncFromBackend(): Promise<number> {
    try {
      const res = await nexusClient.getMemories({ limit: 100 });
      const memories = res?.memories || [];
      if (!Array.isArray(memories) || memories.length === 0) return 0;

      let importedCount = 0;
      for (const mem of memories) {
        const memId = mem.id;
        const exists = this.records.some(
          (r) => r.backendMemoryId === memId || (mem.sourceUrl && r.url === mem.sourceUrl)
        );
        if (exists) {
          const existing = this.records.find(
            (r) => r.backendMemoryId === memId || (mem.sourceUrl && r.url === mem.sourceUrl)
          );
          if (existing && !existing.backendMemoryId) {
            existing.backendMemoryId = memId;
          }
          continue;
        }

        const ts = mem.createdAt ? new Date(mem.createdAt).getTime() : Date.now();
        const url = mem.sourceUrl || `nexus://memory/${memId}`;
        const parsed = this.parseUrl(url, mem.title || mem.key);
        const actionType: ActionType =
          mem.type === "RESEARCH" ? "search" : mem.sourceType === "VIDEO" ? "watch" : "visit";

        const record: TabActivityRecord = {
          id: `mem-${memId}`,
          backendMemoryId: memId,
          action: actionType,
          platform: parsed.platform,
          query: mem.type === "RESEARCH" ? mem.title : undefined,
          title: mem.title || mem.key || "Knowledge Record",
          url: url,
          favicon: url.startsWith("http") ? `https://${parsed.platform.domain}/favicon.ico` : undefined,
          timestamp: ts,
          formattedTime: formatTime(ts),
          formattedDate: formatDate(ts),
          timeAgo: computeTimeAgo(ts),
          aiSummary: mem.summary || (mem.content ? mem.content.slice(0, 200) : undefined),
          tags: Array.isArray(mem.tags) ? mem.tags : [],
          isPinned: !!mem.isPinned,
          isVerified: !!mem.isVerified,
          notes: [],
        };

        this.records.push(record);
        importedCount++;
      }

      if (importedCount > 0) {
        this.records.sort((a, b) => b.timestamp - a.timestamp);
        this.saveToStorage();
      }

      return importedCount;
    } catch (e) {
      console.warn("Failed to sync memories from PostgreSQL backend:", e);
      return 0;
    }
  }

  public deleteRecord(id: string) {
    const item = this.records.find((r) => r.id === id);
    if (item?.backendMemoryId) {
      nexusClient.deleteMemory(item.backendMemoryId).catch(() => {});
    }
    this.records = this.records.filter((r) => r.id !== id);
    this.saveToStorage();
  }

  public togglePin(id: string) {
    const item = this.records.find((r) => r.id === id);
    if (item) {
      item.isPinned = !item.isPinned;
      if (item.backendMemoryId) {
        nexusClient.pinMemory(item.backendMemoryId).catch(() => {});
      }
      this.saveToStorage();
    }
  }

  public toggleVerify(id: string) {
    const item = this.records.find((r) => r.id === id);
    if (item) {
      item.isVerified = !item.isVerified;
      if (item.backendMemoryId) {
        nexusClient.verifyMemory(item.backendMemoryId).catch(() => {});
      }
      this.saveToStorage();
    }
  }

  public addNote(id: string, noteContent: string) {
    const item = this.records.find((r) => r.id === id);
    if (item && noteContent.trim()) {
      if (!item.notes) item.notes = [];
      item.notes.unshift({
        id: `note-${Date.now()}`,
        content: noteContent.trim(),
        createdAt: Date.now(),
      });
      this.saveToStorage();
    }
  }

  public clearAll() {
    this.records = [];
    this.saveToStorage();
  }

  /**
   * Clears any legacy mock demo records and syncs live browser history and backend memories.
   */
  public seedDefaultRecords() {
    this.records = this.records.filter((r) => !r.id?.startsWith("demo-"));
    this.saveToStorage();
    void this.syncFromBrowserHistory();
    void this.syncFromBackend();
  }
}

export const nexusTabIntelligence = new TabIntelligenceService();
