import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Search,
  Mic,
  Sparkles,
  Plus,
  ExternalLink,
  Bot,
  Shield,
  Layers,
  Sun,
  Cloud,
  CloudRain,
  Zap,
  Globe,
  X,
  ArrowRight,
  Microscope,
  Workflow,
  Brain,
  Activity,
} from "lucide-react";
import { nexusClient } from "@/lib/nexus/nexus-client";
import type { NexusTab } from "./NexusHeader";

interface NexusBrowserHomeProps {
  onNavigate: (tab: NexusTab) => void;
  onOpenUrl: (url: string, title?: string) => void;
  user: { name: string; email: string } | null;
  onOpenAiPanel: (initialPrompt?: string) => void;
}

interface Shortcut {
  id: string;
  name: string;
  url: string;
  favicon: string;
  color: string;
}

const DEFAULT_SHORTCUTS: Shortcut[] = [
  { id: "yt", name: "YouTube", url: "https://youtube.com", favicon: "https://www.youtube.com/favicon.ico", color: "#FF0000" },
  { id: "gpt", name: "ChatGPT", url: "https://chat.openai.com", favicon: "https://chat.openai.com/favicon.ico", color: "#10a37f" },
  { id: "gh", name: "GitHub", url: "https://github.com", favicon: "https://github.com/favicon.ico", color: "#e8eaea" },
  { id: "gm", name: "Gmail", url: "https://mail.google.com", favicon: "https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico", color: "#EA4335" },
  { id: "notion", name: "Notion", url: "https://notion.so", favicon: "https://notion.so/favicon.ico", color: "#ffffff" },
  { id: "li", name: "LinkedIn", url: "https://linkedin.com", favicon: "https://linkedin.com/favicon.ico", color: "#0077B5" },
  { id: "x", name: "X / Twitter", url: "https://x.com", favicon: "https://x.com/favicon.ico", color: "#ffffff" },
  { id: "gemini", name: "Gemini", url: "https://gemini.google.com", favicon: "https://gemini.google.com/favicon.ico", color: "#4285F4" },
];

function useTime() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

function formatTime(date: Date) {
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return { time: `${hours}:${minutes}`, seconds, ampm };
}

function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

const WeatherIcon: React.FC<{ condition: string }> = ({ condition }) => {
  if (condition.toLowerCase().includes("rain")) return <CloudRain className="w-4 h-4 text-blue-400" />;
  if (condition.toLowerCase().includes("cloud")) return <Cloud className="w-4 h-4 text-neutral-400" />;
  return <Sun className="w-4 h-4 text-amber-400" />;
};

const AI_CHIPS = [
  { label: "Summarize current page", icon: Sparkles, prompt: "Summarize this page for me" },
  { label: "Research topic", icon: Microscope, prompt: "Research a topic in depth" },
  { label: "Write an email", icon: Bot, prompt: "Help me write a professional email" },
  { label: "Code review", icon: Zap, prompt: "Review my code and suggest improvements" },
];

function getWeatherConditionName(code?: number): string {
  if (code === undefined) return "Clear";
  if (code === 0) return "Clear Sky";
  if ([1, 2, 3].includes(code)) return "Partly Cloudy";
  if ([45, 48].includes(code)) return "Foggy";
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return "Rainy";
  if ([71, 73, 75, 85, 86].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Thunderstorm";
  return "Clear";
}

export const NexusBrowserHome: React.FC<NexusBrowserHomeProps> = ({
  onNavigate,
  onOpenUrl,
  user,
  onOpenAiPanel,
}) => {
  const date = useTime();
  const { time, seconds, ampm } = formatTime(date);
  const [query, setQuery] = useState("");
  const [shortcuts, setShortcuts] = useState<Shortcut[]>(DEFAULT_SHORTCUTS);
  const [weather, setWeather] = useState({
    temp: "24°C",
    condition: "Clear",
    location: Intl.DateTimeFormat().resolvedOptions().timeZone.split("/")[1]?.replace(/_/g, " ") || "Local",
  });
  const [showAddShortcut, setShowAddShortcut] = useState(false);
  const [newShortcutUrl, setNewShortcutUrl] = useState("");
  const [newShortcutName, setNewShortcutName] = useState("");
  const [isMicActive, setIsMicActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    async function fetchLiveWeather() {
      try {
        const locRes = await fetch("https://ipapi.co/json/", { signal: AbortSignal.timeout(3000) });
        if (locRes.ok) {
          const loc = await locRes.json();
          const lat = loc.latitude;
          const lon = loc.longitude;
          const city = loc.city || loc.region || "Local";
          const country = loc.country_code || "";

          if (lat && lon) {
            const wRes = await fetch(
              `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`,
              { signal: AbortSignal.timeout(3000) }
            );
            if (wRes.ok) {
              const wData = await wRes.json();
              const temp = Math.round(wData.current_weather?.temperature);
              const condition = getWeatherConditionName(wData.current_weather?.weathercode);
              if (active) {
                setWeather({
                  temp: `${temp}°C`,
                  condition,
                  location: `${city}${country ? `, ${country}` : ""}`,
                });
                return;
              }
            }
          }
        }
      } catch {
        // Safe fallback already initialized
      }
    }

    fetchLiveWeather();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    nexusClient
      .getUserPreferences()
      .then((res) => {
        if (
          res?.preferences?.home_shortcuts &&
          Array.isArray(res.preferences.home_shortcuts) &&
          res.preferences.home_shortcuts.length > 0
        ) {
          setShortcuts(res.preferences.home_shortcuts as Shortcut[]);
          try {
            localStorage.setItem("nexus_home_shortcuts", JSON.stringify(res.preferences.home_shortcuts));
          } catch {}
        } else {
          const saved = localStorage.getItem("nexus_home_shortcuts");
          if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) setShortcuts(parsed);
          }
        }
      })
      .catch(() => {
        try {
          const saved = localStorage.getItem("nexus_home_shortcuts");
          if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) setShortcuts(parsed);
          }
        } catch {}
      });
  }, []);

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!query.trim()) return;
      const isUrl = /^https?:\/\//.test(query) || /^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(query);
      if (isUrl) {
        const url = query.startsWith("http") ? query : `https://${query}`;
        onOpenUrl(url, query);
      } else {
        onOpenUrl(`https://www.google.com/search?q=${encodeURIComponent(query)}`, `Search: ${query}`);
      }
      setQuery("");
    },
    [query, onOpenUrl]
  );

  const handleAddShortcut = () => {
    if (!newShortcutUrl.trim() || !newShortcutName.trim()) return;
    const url = newShortcutUrl.startsWith("http") ? newShortcutUrl : `https://${newShortcutUrl}`;
    try { new URL(url); } catch { return; }
    const domain = new URL(url).hostname;
    const newShortcut: Shortcut = {
      id: Date.now().toString(),
      name: newShortcutName,
      url,
      favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
      color: "#6366f1",
    };
    const updated = [...shortcuts, newShortcut];
    setShortcuts(updated);
    try { localStorage.setItem("nexus_home_shortcuts", JSON.stringify(updated)); } catch {}
    void nexusClient.updateUserPreferences({ home_shortcuts: updated }).catch(() => {});
    setNewShortcutUrl("");
    setNewShortcutName("");
    setShowAddShortcut(false);
  };

  const removeShortcut = (id: string) => {
    const updated = shortcuts.filter((s) => s.id !== id);
    setShortcuts(updated);
    try { localStorage.setItem("nexus_home_shortcuts", JSON.stringify(updated)); } catch {}
    void nexusClient.updateUserPreferences({ home_shortcuts: updated }).catch(() => {});
  };

  const greeting = () => {
    const h = date.getHours();
    if (h < 5) return "Good night";
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    if (h < 21) return "Good evening";
    return "Good night";
  };

  return (
    <div className="relative flex flex-col items-center justify-start min-h-full overflow-y-auto bg-[#02020a] pb-12">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-[-120px] left-1/2 -translate-x-1/2 w-[900px] h-[500px] rounded-full blur-[120px] opacity-10"
          style={{ background: "radial-gradient(ellipse, #7c3aed 0%, #4f46e5 40%, transparent 70%)" }}
        />
        <div className="absolute top-[30%] right-[-100px] w-80 h-80 rounded-full blur-[100px] opacity-8"
          style={{ background: "radial-gradient(circle, #06b6d4 0%, transparent 70%)", animation: "nx-orb-float 10s ease-in-out infinite" }}
        />
        <div className="absolute bottom-[10%] left-[-50px] w-64 h-64 rounded-full blur-[80px] opacity-8"
          style={{ background: "radial-gradient(circle, #f43f5e 0%, transparent 70%)", animation: "nx-orb-float 12s ease-in-out infinite", animationDelay: "5s" }}
        />
        {/* Subtle grid overlay */}
        <div className="absolute inset-0 opacity-[0.015]"
          style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)", backgroundSize: "60px 60px" }}
        />
      </div>

      <div className="relative w-full max-w-3xl px-6 pt-16">
        {/* ── Top Bar: Weather + User ── */}
        <div className="flex items-center justify-between mb-6 nx-fade-in">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full nx-glass text-xs">
            <WeatherIcon condition={weather.condition} />
            <span className="text-neutral-300 font-medium">{weather.temp}</span>
            <span className="text-neutral-600">·</span>
            <span className="text-neutral-500">{weather.location}</span>
          </div>
          {user && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full nx-glass">
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                style={{ background: "linear-gradient(135deg, #7c3aed, #4f46e5)" }}
              >
                {user.name.charAt(0).toUpperCase()}
              </div>
              <span className="text-xs text-neutral-400 font-medium">{user.name.split(" ")[0]}</span>
            </div>
          )}
        </div>

        {/* ── Hero Clock ── */}
        <div className="text-center mb-10 nx-fade-in" style={{ animationDelay: "80ms" }}>
          <div className="flex items-end justify-center gap-2">
            <div
              className="text-[80px] font-black leading-none tracking-tighter"
              style={{
                background: "linear-gradient(135deg, #f1f1ff 30%, #a78bfa 70%, #60a5fa 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              {time}
            </div>
            <div className="pb-3 flex flex-col items-start gap-1">
              <span className="text-lg font-bold text-neutral-400">{ampm}</span>
              <span className="text-xs font-mono text-neutral-600">{seconds}s</span>
            </div>
          </div>
          <p className="text-sm text-neutral-500 mt-2 font-medium">{formatDate(date)}</p>
          <p className="text-base text-neutral-400 mt-3 font-medium">
            {greeting()},{" "}
            <span className="nx-gradient-text-violet font-bold">{user?.name?.split(" ")[0] || "Explorer"}</span>
          </p>
        </div>

        {/* ── Main Search Bar ── */}
        <div className="mb-8 nx-fade-in" style={{ animationDelay: "160ms" }}>
          <form onSubmit={handleSearch} className="relative">
            <div
              className="relative flex items-center rounded-2xl overflow-hidden transition-all duration-300"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.1)",
                boxShadow: "0 8px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(99,102,241,0.0)",
              }}
              onFocus={() => {
                // handled via focus on input itself
              }}
            >
              <Search className="absolute left-4 w-5 h-5 text-neutral-500" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search the web or type a URL..."
                className="flex-1 bg-transparent py-4 pl-12 pr-28 text-sm text-neutral-200 placeholder-neutral-600 outline-none"
                style={{ fontFamily: "Inter, sans-serif" }}
                onFocus={e => {
                  (e.currentTarget.parentElement as HTMLElement).style.border = "1px solid rgba(99,102,241,0.5)";
                  (e.currentTarget.parentElement as HTMLElement).style.boxShadow = "0 8px 40px rgba(0,0,0,0.4), 0 0 0 3px rgba(99,102,241,0.12)";
                }}
                onBlur={e => {
                  (e.currentTarget.parentElement as HTMLElement).style.border = "1px solid rgba(255,255,255,0.1)";
                  (e.currentTarget.parentElement as HTMLElement).style.boxShadow = "0 8px 40px rgba(0,0,0,0.4)";
                }}
              />
              {/* Mic button */}
              <button
                type="button"
                onClick={() => setIsMicActive(v => !v)}
                className="absolute right-16 p-2 rounded-xl transition-all"
                style={{ color: isMicActive ? "#f43f5e" : "#606080" }}
              >
                <Mic className={`w-4 h-4 ${isMicActive ? "animate-pulse" : ""}`} />
              </button>
              {/* AI Button */}
              <button
                type="button"
                onClick={() => onOpenAiPanel(query || undefined)}
                className="absolute right-2.5 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all"
                style={{
                  background: "linear-gradient(135deg, rgba(109,40,217,0.6), rgba(79,70,229,0.6))",
                  border: "1px solid rgba(124,58,237,0.4)",
                  color: "#c4b5fd",
                }}
              >
                <Sparkles className="w-3.5 h-3.5" />
                AI
              </button>
            </div>
          </form>

          {/* AI Quick Chips */}
          <div className="flex flex-wrap gap-2 mt-3 justify-center">
            {AI_CHIPS.map((chip, i) => (
              <button
                key={i}
                onClick={() => onOpenAiPanel(chip.prompt)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all duration-200 nx-fade-in"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "#a0a0c0",
                  animationDelay: `${200 + i * 50}ms`,
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.background = "rgba(99,102,241,0.15)";
                  (e.currentTarget as HTMLElement).style.borderColor = "rgba(99,102,241,0.35)";
                  (e.currentTarget as HTMLElement).style.color = "#c4b5fd";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
                  (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)";
                  (e.currentTarget as HTMLElement).style.color = "#a0a0c0";
                }}
              >
                <chip.icon className="w-3 h-3" />
                {chip.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Shortcuts Grid ── */}
        <div className="mb-8 nx-fade-in" style={{ animationDelay: "240ms" }}>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
            {shortcuts.map((sc, i) => (
              <div key={sc.id} className="relative group">
                <button
                  onClick={() => onOpenUrl(sc.url, sc.name)}
                  className="w-full flex flex-col items-center gap-2 p-3 rounded-2xl transition-all duration-200 nx-fade-in"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.07)",
                    animationDelay: `${240 + i * 40}ms`,
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.background = `${sc.color}12`;
                    (e.currentTarget as HTMLElement).style.borderColor = `${sc.color}35`;
                    (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
                    (e.currentTarget as HTMLElement).style.boxShadow = `0 8px 24px ${sc.color}20`;
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.07)";
                    (e.currentTarget as HTMLElement).style.transform = "";
                    (e.currentTarget as HTMLElement).style.boxShadow = "";
                  }}
                >
                  <img
                    src={sc.favicon}
                    alt={sc.name}
                    className="w-7 h-7 object-contain rounded-md shrink-0"
                    style={{ width: "28px", height: "28px", maxWidth: "28px", maxHeight: "28px" }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect fill="${encodeURIComponent(sc.color)}" width="32" height="32" rx="8"/><text x="16" y="22" text-anchor="middle" font-size="16" fill="white" font-family="sans-serif">${sc.name.charAt(0)}</text></svg>`;
                    }}
                  />
                  <span className="text-[10px] text-neutral-400 font-medium truncate w-full text-center">{sc.name}</span>
                </button>
                {/* Remove button */}
                <button
                  onClick={() => removeShortcut(sc.id)}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                >
                  <X className="w-2.5 h-2.5 text-neutral-400" />
                </button>
              </div>
            ))}

            {/* Add Shortcut */}
            <button
              onClick={() => setShowAddShortcut(true)}
              className="flex flex-col items-center gap-2 p-3 rounded-2xl transition-all duration-200 nx-fade-in"
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px dashed rgba(255,255,255,0.1)",
                animationDelay: `${240 + shortcuts.length * 40}ms`,
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = "rgba(99,102,241,0.08)";
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(99,102,241,0.3)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)";
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.1)";
              }}
            >
              <div className="w-7 h-7 rounded-xl bg-neutral-900 flex items-center justify-center">
                <Plus className="w-3.5 h-3.5 text-neutral-500" />
              </div>
              <span className="text-[10px] text-neutral-600 font-medium">Add</span>
            </button>
          </div>
        </div>

        {/* ── NEXUS Quick Nav Cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 nx-fade-in" style={{ animationDelay: "360ms" }}>
          {[
            { label: "AI Agent", icon: Bot, tab: "agent" as NexusTab, color: "#fbbf24", desc: "Launch task" },
            { label: "Research", icon: Microscope, tab: "research" as NexusTab, color: "#a78bfa", desc: "Deep dive" },
            { label: "Workflows", icon: Workflow, tab: "workflows" as NexusTab, color: "#22d3ee", desc: "Automate" },
            { label: "Memory", icon: Brain, tab: "memory" as NexusTab, color: "#fb7185", desc: "Knowledge" },
          ].map((item, i) => (
            <button
              key={i}
              onClick={() => onNavigate(item.tab)}
              className="flex items-center gap-3 p-4 rounded-2xl transition-all duration-200 text-left group nx-fade-in"
              style={{
                background: `${item.color}08`,
                border: `1px solid ${item.color}18`,
                animationDelay: `${360 + i * 60}ms`,
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = `${item.color}15`;
                (e.currentTarget as HTMLElement).style.borderColor = `${item.color}35`;
                (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = `${item.color}08`;
                (e.currentTarget as HTMLElement).style.borderColor = `${item.color}18`;
                (e.currentTarget as HTMLElement).style.transform = "";
              }}
            >
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${item.color}18` }}>
                <item.icon className="w-4.5 h-4.5" style={{ color: item.color }} />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-neutral-200">{item.label}</div>
                <div className="text-[10px] text-neutral-600">{item.desc}</div>
              </div>
              <ArrowRight className="w-3.5 h-3.5 ml-auto text-neutral-700 group-hover:text-neutral-400 transition-colors" style={{ color: item.color + "60" }} />
            </button>
          ))}
        </div>
      </div>

      {/* ── Add Shortcut Modal ── */}
      {showAddShortcut && (
        <div className="nx-modal-overlay" onClick={() => setShowAddShortcut(false)}>
          <div
            className="nx-modal rounded-2xl p-6 w-80 nx-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-white">Add Shortcut</h3>
              <button onClick={() => setShowAddShortcut(false)} className="w-7 h-7 rounded-xl nx-btn-ghost flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <input
                type="text"
                value={newShortcutName}
                onChange={(e) => setNewShortcutName(e.target.value)}
                placeholder="Site name"
                className="w-full px-3 py-2.5 rounded-xl text-sm nx-input"
              />
              <input
                type="url"
                value={newShortcutUrl}
                onChange={(e) => setNewShortcutUrl(e.target.value)}
                placeholder="URL (e.g. https://example.com)"
                className="w-full px-3 py-2.5 rounded-xl text-sm nx-input"
                onKeyDown={(e) => e.key === "Enter" && handleAddShortcut()}
              />
              <button
                onClick={handleAddShortcut}
                className="w-full py-2.5 rounded-xl text-sm nx-btn-primary"
              >
                Add Shortcut
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
