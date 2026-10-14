import React, { useState, useEffect, useRef } from "react";
import {
  Code2,
  Sparkles,
  Check,
  Copy,
  Play,
  X,
  ChevronDown,
  ChevronUp,
  Terminal,
  Cpu,
  Zap,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Layers,
  ExternalLink,
  Globe,
  FileCode,
  Send,
  Loader2,
  CheckCheck,
  Database,
  History,
  Trash2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { askApi } from "@/lib/nexus/ask.api";
import { nexusClient } from "@/lib/nexus/nexus-client";
import { useToast } from "./NexusToast";

export interface CodingContextData {
  isCodingSite: boolean;
  platform: string;
  problemTitle: string;
  problemDescription: string;
  detectedLanguage: string;
  starterCode: string;
  editorType: string;
  url: string;
  error?: string;
}

interface NexusCodingAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  windowId?: number;
  activeTabId?: string;
  activeUrl?: string;
  activeTitle?: string;
  workspaceId?: string | null;
}

const SUPPORTED_LANGUAGES = [
  "Python3",
  "C++",
  "Java",
  "JavaScript",
  "TypeScript",
  "C#",
  "Go",
  "Rust",
  "C",
  "SQL",
];

export const NexusCodingAgentModal: React.FC<NexusCodingAgentModalProps> = ({
  isOpen,
  onClose,
  windowId = 1,
  activeTabId = "",
  activeUrl = "",
  activeTitle = "",
  workspaceId,
}) => {
  const [codingContext, setCodingContext] = useState<CodingContextData | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>("Python3");
  const [prompt, setPrompt] = useState<string>("");
  const [engineMode, setEngineMode] = useState<"ai" | "canonical">("ai");
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generatedSolution, setGeneratedSolution] = useState<string>("");
  const [streamingText, setStreamingText] = useState<string>("");
  const [streamingStatus, setStreamingStatus] = useState<string | null>(null);
  const [showDescription, setShowDescription] = useState<boolean>(false);
  const [showStarterCode, setShowStarterCode] = useState<boolean>(false);
  const [autoImplement, setAutoImplement] = useState<boolean>(true);
  const [isInjecting, setIsInjecting] = useState<boolean>(false);
  const [injectSuccess, setInjectSuccess] = useState<boolean>(false);
  const [injectStatus, setInjectStatus] = useState<{ success?: boolean; message?: string } | null>(null);
  const [isRunningOnPlatform, setIsRunningOnPlatform] = useState<boolean>(false);
  const [runSuccessTarget, setRunSuccessTarget] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [rightTab, setRightTab] = useState<"code" | "complexity" | "testcases" | "history">("code");
  const [historyList, setHistoryList] = useState<any[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);
  const [solutionMeta, setSolutionMeta] = useState<{
    timeComplexity?: string;
    spaceComplexity?: string;
    testCases?: Array<{ input: string; output: string }>;
    explanation?: string;
  } | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const toast = useToast();

  const loadHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const res = await nexusClient.getCodingHistory();
      if (res && Array.isArray(res.history)) {
        setHistoryList(res.history);
      }
    } catch (err: any) {
      console.warn("[NexusCodingAgentModal] History fetch notice:", err.message);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Scan and extract problem context on open or tab change
  useEffect(() => {
    if (isOpen) {
      scanTabContext();
      void loadHistory();
    } else {
      setGeneratedSolution("");
      setStreamingText("");
      setInjectStatus(null);
      setInjectSuccess(false);
      setRunSuccessTarget(null);
      setIsInjecting(false);
      setIsRunningOnPlatform(false);
    }
  }, [isOpen, activeTabId, activeUrl]);

  const scanTabContext = async () => {
    setIsScanning(true);
    setInjectStatus(null);
    try {
      const shell = (window as any).browserShell;
      if (shell?.tabGetCodingContext) {
        const timeoutPromise = new Promise<any>((_, reject) =>
          setTimeout(() => reject(new Error("Tab scan timed out (4s)")), 4000)
        );
        const data = await Promise.race([
          shell.tabGetCodingContext(windowId, activeTabId || undefined),
          timeoutPromise,
        ]);
        setCodingContext(data);
        if (data.detectedLanguage) {
          const matched = SUPPORTED_LANGUAGES.find(
            (l) => l.toLowerCase() === data.detectedLanguage.toLowerCase()
          );
          if (matched) setSelectedLanguage(matched);
          else if (/python/i.test(data.detectedLanguage)) setSelectedLanguage("Python3");
          else if (/c\+\+/i.test(data.detectedLanguage)) setSelectedLanguage("C++");
          else if (/javascript/i.test(data.detectedLanguage)) setSelectedLanguage("JavaScript");
          else if (/typescript/i.test(data.detectedLanguage)) setSelectedLanguage("TypeScript");
          else if (/java/i.test(data.detectedLanguage)) setSelectedLanguage("Java");
        }
      } else {
        let hostname = "";
        try {
          if (activeUrl) hostname = new URL(activeUrl).hostname.replace(/^www\./, "");
        } catch {}
        const isLeetCode = /leetcode/i.test(activeUrl || "");
        const isCoding = isLeetCode || /compiler|judge|challenge|codeforces|hackerrank|geeksforgeeks|codechef|codewars/i.test(activeUrl || "");
        setCodingContext({
          isCodingSite: isCoding,
          platform: isLeetCode ? "LeetCode" : (isCoding ? "Online Compiler" : (hostname || "Web Page Context")),
          problemTitle: activeTitle || "Coding Task",
          problemDescription: "",
          detectedLanguage: "Python3",
          starterCode: "",
          editorType: isCoding ? "monaco" : "unknown",
          url: activeUrl || "",
        });
      }
    } catch (err: any) {
      toast.info(`Tab scan notice: ${err.message}`);
    } finally {
      setIsScanning(false);
    }
  };

  // Helper to extract the primary code block from markdown
  const extractCodeBlock = (text: string): string => {
    const codeBlockRegex = /```(?:[a-zA-Z0-9_\-\+#]+)?\n([\s\S]*?)```/g;
    const matches: string[] = [];
    let match;
    while ((match = codeBlockRegex.exec(text)) !== null) {
      if (match[1]?.trim()) {
        matches.push(match[1].trim());
      }
    }
    // Return longest code block (usually the full solution)
    if (matches.length > 0) {
      return matches.sort((a, b) => b.length - a.length)[0];
    }
    return text.trim();
  };

  // Direct injection into platform's editor with safe race timeout
  const handleImplementCode = async (codeToInject?: string) => {
    if (isInjecting) return;
    const rawCode = codeToInject || extractCodeBlock(generatedSolution || streamingText);
    if (!rawCode) {
      toast.error("No code available to implement.");
      return;
    }

    setIsInjecting(true);
    setInjectStatus(null);
    setInjectSuccess(false);

    try {
      const shell = (window as any).browserShell;
      if (shell?.tabInjectCode) {
        const timeoutPromise = new Promise<any>((_, reject) =>
          setTimeout(() => reject(new Error("Editor implant timed out (5s)")), 5000)
        );

        const res = await Promise.race([
          shell.tabInjectCode(windowId, activeTabId || "", rawCode),
          timeoutPromise,
        ]);

        if (res.success) {
          setInjectSuccess(true);
          setInjectStatus({
            success: true,
            message: res.message || `Implanted via ${res.methodUsed} (${res.codeLength} chars)!`,
          });
          toast.success(`⚡ Code successfully implanted into ${codingContext?.platform || "platform"} editor!`);
          setTimeout(() => setInjectSuccess(false), 3000);
        } else {
          // Copy to clipboard fallback
          await navigator.clipboard.writeText(rawCode).catch(() => {});
          setInjectStatus({
            success: true,
            message: "Code copied to clipboard! (Click inside editor & press Ctrl+V / Cmd+V)",
          });
          toast.info("Code ready in clipboard. Press Ctrl+V inside editor.");
        }
      } else {
        await navigator.clipboard.writeText(rawCode);
        setInjectSuccess(true);
        setInjectStatus({
          success: true,
          message: "Code copied to clipboard! Paste into editor with Ctrl+V.",
        });
        toast.info("Copied code to clipboard.");
        setTimeout(() => setInjectSuccess(false), 3000);
      }
    } catch (err: any) {
      try {
        await navigator.clipboard.writeText(rawCode);
      } catch {}
      setInjectStatus({
        success: true,
        message: "Code copied to clipboard! (Bridge timed out, ready for Ctrl+V)",
      });
      toast.info("Code preserved in clipboard. Paste with Ctrl+V.");
    } finally {
      setIsInjecting(false);
    }
  };

  // Trigger platform run button with safe race timeout
  const handleRunOnPlatform = async () => {
    if (isRunningOnPlatform) return;
    setIsRunningOnPlatform(true);
    setRunSuccessTarget(null);

    try {
      const shell = (window as any).browserShell;
      if (shell?.tabRunCode) {
        const timeoutPromise = new Promise<any>((_, reject) =>
          setTimeout(() => reject(new Error("Run trigger timed out (5s)")), 5000)
        );

        const res = await Promise.race([
          shell.tabRunCode(windowId, activeTabId || ""),
          timeoutPromise,
        ]);

        if (res.clicked) {
          const target = res.target || "Run";
          setRunSuccessTarget(target);
          toast.success(`Triggered ${target} on ${codingContext?.platform || "platform"}!`);
          setTimeout(() => setRunSuccessTarget(null), 3000);
        } else {
          toast.info(res.message || "No Run button detected on active page.");
        }
      } else {
        toast.info("Platform run bridge requires active browser tab view.");
      }
    } catch (err: any) {
      toast.info(`Run trigger notice: ${err.message}`);
    } finally {
      setIsRunningOnPlatform(false);
    }
  };

  // Generate solution code using backend AI
  const handleGenerateSolution = async (customInstruction?: string) => {
    if (isGenerating) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsGenerating(true);
    setStreamingText("");
    setGeneratedSolution("");
    setInjectStatus(null);
    setStreamingStatus("✦ Formulating optimal algorithm architecture...");

    const problemTitle = codingContext?.problemTitle || activeTitle || "Coding Problem";
    const problemDesc = codingContext?.problemDescription || "";
    const starter = codingContext?.starterCode || "";
    const platform = codingContext?.platform || "Online Compiler";

    const instruction = customInstruction || prompt.trim() || "Optimal solution with best time and space complexity";

    let accumulatedTokens = "";

    try {
      await nexusClient.solveCodingProblemStream(
        {
          language: selectedLanguage,
          problemTitle,
          problemDescription: problemDesc,
          starterCode: starter,
          platform,
          instruction,
          mode: engineMode,
          workspaceId: workspaceId || undefined,
        },
        {
          onStatus: (status) => {
            setStreamingStatus(status);
          },
          onThought: (thought) => {
            setStreamingStatus(`💭 Reasoning: ${thought.slice(0, 90)}...`);
          },
          onToken: (token) => {
            accumulatedTokens += token;
            setStreamingText(accumulatedTokens);
          },
          onComplete: (res) => {
            setGeneratedSolution(res.solution || accumulatedTokens);
            setSolutionMeta({
              timeComplexity: res.timeComplexity || "O(N)",
              spaceComplexity: res.spaceComplexity || "O(1)",
              testCases: res.testCases,
              explanation: res.explanation,
            });
            setStreamingText("");
            setIsGenerating(false);
            setStreamingStatus(null);
            void loadHistory();

            // Auto-implement to editor on active tab if enabled
            const codeToInject = res.code || extractCodeBlock(res.solution || accumulatedTokens);
            if (autoImplement && codeToInject) {
              void handleImplementCode(codeToInject);
            }
          },
          onError: async (err) => {
            console.warn("[NexusCodingAgentModal] solveCodingProblemStream fallback:", err);
            try {
              const res = await nexusClient.solveCodingProblem({
                language: selectedLanguage,
                problemTitle,
                problemDescription: problemDesc,
                starterCode: starter,
                platform,
                instruction,
                mode: engineMode,
                workspaceId: workspaceId || undefined,
              });

              if (res && res.solution) {
                setGeneratedSolution(res.solution);
                setSolutionMeta({
                  timeComplexity: res.timeComplexity,
                  spaceComplexity: res.spaceComplexity,
                  testCases: res.testCases,
                  explanation: res.explanation,
                });
                setStreamingText("");
                setIsGenerating(false);
                setStreamingStatus(null);
                void loadHistory();

                const code = res.code || extractCodeBlock(res.solution);
                if (autoImplement && code) {
                  void handleImplementCode(code);
                }
                return;
              }
            } catch (fallbackErr: any) {
              setIsGenerating(false);
              setStreamingStatus(null);
              toast.error(fallbackErr.message || "Failed to generate solution.");
            }
          },
        },
        abortController.signal
      );
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setIsGenerating(false);
      setStreamingStatus(null);
      toast.error(`Generation failed: ${err.message}`);
    }
  };

  const handleCopyCode = () => {
    const code = extractCodeBlock(generatedSolution || streamingText);
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success("Code copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  const currentCode = extractCodeBlock(generatedSolution || streamingText);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200 select-none"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-5xl max-h-[92vh] bg-[#0b0b14] border border-violet-500/30 rounded-2xl shadow-[0_0_50px_rgba(139,92,246,0.15)] flex flex-col overflow-hidden text-neutral-200 animate-in zoom-in-95 duration-200 font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── TOP HEADER ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-[#0e0e1a]/95 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600/30 to-emerald-500/30 border border-emerald-500/40 flex items-center justify-center text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.3)]">
              <Code2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white tracking-wide uppercase font-mono">
                  Antigravity AI Coding Agent
                </h2>
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[10px] font-mono font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Active Tab Hook
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-neutral-400">
                <span className="text-violet-400 font-medium">
                  {codingContext?.platform || "Coding Platform"}
                </span>
                <span>•</span>
                <span className="truncate max-w-[340px] text-neutral-300 font-semibold">
                  {codingContext?.problemTitle || activeTitle || "Ready to Code"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={scanTabContext}
              disabled={isScanning}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-xs text-neutral-300 transition"
              title="Rescan active tab"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? "animate-spin text-cyan-400" : ""}`} />
              <span className="hidden sm:inline">Rescan Tab</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-neutral-400 hover:text-white hover:bg-white/[0.08] transition"
              title="Close (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ── MAIN CONTENT SPLIT ── */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* ── LEFT PANEL: PROBLEM CONTEXT & CONFIG ── */}
          <div className="w-full md:w-[380px] shrink-0 border-r border-white/[0.06] bg-[#0d0d16] flex flex-col overflow-y-auto p-4 space-y-4">
            {/* Context Card */}
            <div className="p-3.5 rounded-xl bg-[#121220] border border-white/[0.07] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-400 font-semibold flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-violet-400" />
                  Target Environment
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-violet-600/20 text-violet-300 border border-violet-500/30">
                  {codingContext?.editorType?.toUpperCase() || "MONACO"}
                </span>
              </div>

              {/* Language Selector */}
              <div>
                <label className="block text-[11px] text-neutral-400 font-medium mb-1">
                  Programming Language:
                </label>
                <div className="relative">
                  <select
                    value={selectedLanguage}
                    onChange={(e) => setSelectedLanguage(e.target.value)}
                    className="w-full appearance-none bg-neutral-900 border border-white/[0.1] rounded-xl px-3 py-2 text-xs text-white font-medium focus:border-violet-500 outline-none transition"
                  >
                    {SUPPORTED_LANGUAGES.map((lang) => (
                      <option key={lang} value={lang}>
                        {lang}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-neutral-400 absolute right-3 top-2.5 pointer-events-none" />
                </div>
              </div>

              {/* Problem Title & URL preview */}
              <div className="p-2.5 rounded-lg bg-neutral-950/80 border border-white/5 space-y-1">
                <div className="text-xs font-semibold text-white truncate">
                  {codingContext?.problemTitle || "General Coding Problem"}
                </div>
                <div className="text-[10px] font-mono text-neutral-400 truncate flex items-center gap-1">
                  <Globe className="w-3 h-3 text-cyan-400 shrink-0" />
                  <span className="truncate">{activeUrl || "https://leetcode.com"}</span>
                </div>
              </div>
            </div>

            {/* Engine Architecture Switch */}
            <div className="p-3 rounded-xl bg-[#121220] border border-white/[0.07] space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="text-neutral-400 uppercase font-semibold">Engine Architecture</span>
                <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  PostgreSQL & AI Live
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-black/40 rounded-lg border border-white/5 text-xs">
                <button
                  type="button"
                  onClick={() => setEngineMode("ai")}
                  className={`py-1.5 px-2 rounded-md font-medium text-[11px] flex items-center justify-center gap-1.5 transition ${
                    engineMode === "ai"
                      ? "bg-violet-600 text-white font-bold shadow-md shadow-violet-600/30"
                      : "text-neutral-400 hover:text-white"
                  }`}
                >
                  <Zap className="w-3 h-3 text-amber-300" />
                  <span>AI (qwen3:8b)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEngineMode("canonical")}
                  className={`py-1.5 px-2 rounded-md font-medium text-[11px] flex items-center justify-center gap-1.5 transition ${
                    engineMode === "canonical"
                      ? "bg-cyan-600 text-white font-bold shadow-md shadow-cyan-600/30"
                      : "text-neutral-400 hover:text-white"
                  }`}
                >
                  <Layers className="w-3 h-3 text-cyan-200" />
                  <span>Canonical Fast</span>
                </button>
              </div>
            </div>

            {/* Problem Description Accordion */}
            <div className="rounded-xl bg-[#121220] border border-white/[0.07] overflow-hidden">
              <button
                type="button"
                onClick={() => setShowDescription((v) => !v)}
                className="w-full flex items-center justify-between px-3.5 py-2.5 text-left text-xs font-semibold text-neutral-200 hover:text-white transition"
              >
                <span className="flex items-center gap-1.5">
                  <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                  Problem Statement & Constraints
                  {codingContext?.problemDescription && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                  )}
                </span>
                {showDescription ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showDescription && (
                <div className="p-3 border-t border-white/5 space-y-2">
                  <textarea
                    value={codingContext?.problemDescription || ""}
                    onChange={(e) =>
                      setCodingContext((prev) =>
                        prev ? { ...prev, problemDescription: e.target.value } : null
                      )
                    }
                    placeholder="Paste problem description, examples, or constraints here..."
                    rows={4}
                    className="w-full bg-neutral-950 border border-white/[0.08] rounded-lg p-2 text-xs text-neutral-200 placeholder-neutral-500 font-sans outline-none focus:border-cyan-500 resize-y"
                  />
                  <span className="text-[10px] text-neutral-500 block">
                    Auto-extracted from tab viewport or manually editable.
                  </span>
                </div>
              )}
            </div>

            {/* Starter Code Template Accordion */}
            <div className="rounded-xl bg-[#121220] border border-white/[0.07] overflow-hidden">
              <button
                type="button"
                onClick={() => setShowStarterCode((v) => !v)}
                className="w-full flex items-center justify-between px-3.5 py-2.5 text-left text-xs font-semibold text-neutral-200 hover:text-white transition"
              >
                <span className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-emerald-400" />
                  Starter Code Template
                  {codingContext?.starterCode && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                  )}
                </span>
                {showStarterCode ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showStarterCode && (
                <div className="p-3 border-t border-white/5 space-y-2">
                  <textarea
                    value={codingContext?.starterCode || ""}
                    onChange={(e) =>
                      setCodingContext((prev) =>
                        prev ? { ...prev, starterCode: e.target.value } : null
                      )
                    }
                    placeholder="class Solution:\n    def solve(self): ..."
                    rows={4}
                    className="w-full bg-neutral-950 border border-white/[0.08] rounded-lg p-2 text-[11px] font-mono text-emerald-300 placeholder-neutral-600 outline-none focus:border-emerald-500 resize-y"
                  />
                  <span className="text-[10px] text-neutral-500 block">
                    Target function signature to fulfill.
                  </span>
                </div>
              )}
            </div>

            {/* Presets */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-semibold">
                Quick Strategy Presets
              </span>
              {[
                "⚡ Optimal Solution (Time & Space Optimal)",
                "📝 Solve with Line-by-Line Comments",
                "🔄 Compare Approaches (Brute-Force vs Optimal)",
                "🐛 Fix & Complete Starter Template",
              ].map((strategy, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleGenerateSolution(strategy)}
                  disabled={isGenerating}
                  className="w-full text-left px-3 py-2 rounded-xl bg-neutral-900/80 hover:bg-violet-600/15 border border-white/5 hover:border-violet-500/30 text-xs text-neutral-300 hover:text-white transition flex items-center justify-between group"
                >
                  <span>{strategy}</span>
                  <Sparkles className="w-3 h-3 text-neutral-600 group-hover:text-violet-400 transition" />
                </button>
              ))}
            </div>

            {/* Custom Instruction Prompt */}
            <div className="space-y-2 pt-1">
              <label className="block text-[11px] font-mono uppercase tracking-wider text-neutral-400 font-semibold">
                Custom Instruction
              </label>
              <div className="relative">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      void handleGenerateSolution();
                    }
                  }}
                  placeholder="e.g. Use two-pointer approach, avoid recursion..."
                  rows={2}
                  className="w-full bg-neutral-900 border border-white/[0.1] rounded-xl p-2.5 text-xs text-white placeholder-neutral-500 outline-none focus:border-violet-500 resize-none transition"
                />
              </div>

              {/* Auto Implement Toggle */}
              <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-neutral-300">
                <input
                  type="checkbox"
                  checked={autoImplement}
                  onChange={(e) => setAutoImplement(e.target.checked)}
                  className="rounded border-neutral-700 bg-neutral-900 text-violet-600 focus:ring-violet-500 w-4 h-4 cursor-pointer"
                />
                <span className="font-medium text-emerald-300">
                  ⚡ Auto-implement code to editor once generated
                </span>
              </label>

              {/* Generate Button */}
              <button
                type="button"
                onClick={() => handleGenerateSolution()}
                disabled={isGenerating}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-violet-600/25 transition disabled:opacity-50"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Solving Question...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Generate Optimal Solution</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* ── RIGHT PANEL: LIVE CODE EDITOR & IMPLEMENTATION STUDIO ── */}
          <div className="flex-1 flex flex-col bg-[#090910] overflow-hidden">
            {/* Top Toolbar */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06] bg-[#0c0c16] shrink-0">
              <div className="flex items-center gap-3">
                <span className="font-mono text-neutral-400 font-semibold uppercase text-[11px]">
                  Generated Code Output:
                </span>
                {isGenerating && (
                  <span className="flex items-center gap-1.5 text-amber-300 font-mono text-[11px]">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                    {streamingStatus}
                  </span>
                )}
                {!isGenerating && generatedSolution && (
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1 text-emerald-400 font-mono text-[11px]">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Optimal Solution Ready
                    </span>
                    {solutionMeta?.timeComplexity && (
                      <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 font-mono text-[10px]">
                        Time: {solutionMeta.timeComplexity}
                      </span>
                    )}
                    {solutionMeta?.spaceComplexity && (
                      <span className="px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 font-mono text-[10px]">
                        Space: {solutionMeta.spaceComplexity}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center bg-white/[0.04] p-0.5 rounded-lg border border-white/[0.06]">
                  {generatedSolution && (
                    <>
                      <button
                        type="button"
                        onClick={() => setRightTab("code")}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-mono transition ${
                          rightTab === "code"
                            ? "bg-violet-600 text-white font-semibold shadow-sm"
                            : "text-neutral-400 hover:text-white"
                        }`}
                      >
                        Solution Code
                      </button>
                      <button
                        type="button"
                        onClick={() => setRightTab("complexity")}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-mono transition ${
                          rightTab === "complexity"
                            ? "bg-violet-600 text-white font-semibold shadow-sm"
                            : "text-neutral-400 hover:text-white"
                        }`}
                      >
                        Complexity & Logic
                      </button>
                      {solutionMeta?.testCases && solutionMeta.testCases.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setRightTab("testcases")}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-mono transition ${
                            rightTab === "testcases"
                              ? "bg-violet-600 text-white font-semibold shadow-sm"
                              : "text-neutral-400 hover:text-white"
                          }`}
                        >
                          Test Cases ({solutionMeta.testCases.length})
                        </button>
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setRightTab("history");
                      void loadHistory();
                    }}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-mono transition flex items-center gap-1.5 ${
                      rightTab === "history"
                        ? "bg-emerald-600 text-white font-semibold shadow-sm"
                        : "text-neutral-400 hover:text-white"
                    }`}
                  >
                    <History className="w-3 h-3 text-emerald-300" />
                    <span>History ({historyList.length})</span>
                  </button>
                </div>

                {currentCode && (
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-xs text-neutral-300 transition"
                    title="Copy Solution Code"
                  >
                    {copied ? <CheckCheck className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? "Copied" : "Copy Code"}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Code Output Canvas */}
            <div className="flex-1 p-5 overflow-y-auto space-y-4">
              {rightTab === "history" ? (
                /* ── DATABASE HISTORY VIEW ── */
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-white/10">
                    <div className="flex items-center gap-2">
                      <Database className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs font-mono font-bold text-white uppercase tracking-wider">
                        PostgreSQL Solved Solutions ({historyList.length})
                      </span>
                    </div>
                    {historyList.length > 0 && (
                      <button
                        type="button"
                        onClick={async () => {
                          await nexusClient.deleteCodingHistory("all");
                          void loadHistory();
                          toast.success("History cleared from PostgreSQL.");
                        }}
                        className="text-[10px] font-mono text-rose-400 hover:text-rose-300 flex items-center gap-1 hover:underline"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Clear History</span>
                      </button>
                    )}
                  </div>

                  {isLoadingHistory ? (
                    <div className="py-12 flex flex-col items-center justify-center gap-2 text-neutral-400 text-xs">
                      <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
                      <span>Fetching solutions from PostgreSQL (nexus_db)...</span>
                    </div>
                  ) : historyList.length === 0 ? (
                    <div className="py-12 text-center text-neutral-500 text-xs space-y-2">
                      <History className="w-8 h-8 mx-auto text-neutral-600" />
                      <p>No solved coding solutions in database yet.</p>
                      <p className="text-[11px] text-neutral-600">Solutions generated will automatically sync to PostgreSQL (nexus_db).</p>
                    </div>
                  ) : (
                    <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
                      {historyList.map((item, idx) => (
                        <div
                          key={item.id || idx}
                          className="p-3.5 rounded-xl bg-[#0e0e1a] border border-white/10 hover:border-violet-500/30 transition space-y-2.5 group"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h5 className="text-xs font-bold text-white group-hover:text-violet-300 transition">
                                {item.problemTitle}
                              </h5>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 text-[10px] font-mono">
                                  {item.language}
                                </span>
                                <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 text-[10px] font-mono">
                                  {item.platform}
                                </span>
                                <span className="text-[10px] text-neutral-500 font-mono">
                                  {item.createdAt ? new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Recent"}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5">
                              <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 text-[10px] font-mono">
                                {item.timeComplexity || "O(N)"}
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 text-[10px] font-mono">
                                {item.spaceComplexity || "O(1)"}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center justify-end gap-2 pt-1 border-t border-white/5">
                            <button
                              type="button"
                              onClick={() => {
                                setGeneratedSolution(item.solution || item.code);
                                setSolutionMeta({
                                  timeComplexity: item.timeComplexity,
                                  spaceComplexity: item.spaceComplexity,
                                  testCases: item.testCases,
                                  explanation: item.explanation,
                                });
                                setSelectedLanguage(item.language || "Python3");
                                setRightTab("code");
                                toast.success(`Loaded "${item.problemTitle}" solution into studio!`);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] font-medium text-neutral-300 hover:text-white transition"
                            >
                              View in Studio
                            </button>
                            <button
                              type="button"
                              onClick={() => handleImplementCode(item.code)}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-[11px] font-bold text-white shadow-sm transition flex items-center gap-1"
                            >
                              <Zap className="w-3 h-3 text-amber-300 fill-amber-300" />
                              <span>Implant</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : isGenerating && !generatedSolution && !streamingText ? (
                <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-5 py-10 animate-in fade-in duration-200">
                  <div className="relative">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-600/30 to-cyan-600/30 border border-violet-500/40 flex items-center justify-center text-violet-300 shadow-[0_0_30px_rgba(139,92,246,0.25)]">
                      <Cpu className="w-8 h-8 animate-spin text-cyan-400" />
                    </div>
                    <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-[#090910] animate-ping" />
                  </div>

                  <div className="space-y-1.5">
                    <h3 className="text-sm font-bold text-white tracking-wide uppercase font-mono">
                      Synthesizing Optimal Solution
                    </h3>
                    <p className="text-xs text-neutral-400 max-w-sm leading-relaxed">
                      Antigravity AI engine is analyzing algorithmic constraints, formulating the optimal data structure, and generating accepted code for <strong className="text-cyan-300">{selectedLanguage}</strong>.
                    </p>
                  </div>

                  {/* Cybernetic Progress Bar */}
                  <div className="w-full max-w-xs space-y-2">
                    <div className="h-1.5 w-full bg-neutral-900 rounded-full overflow-hidden border border-white/10 relative">
                      <div className="h-full bg-gradient-to-r from-violet-500 via-cyan-400 to-emerald-400 rounded-full animate-pulse w-full" />
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-mono text-neutral-400">
                      <span>{codingContext?.platform || "Online Compiler"}</span>
                      <span className="text-cyan-400">{selectedLanguage}</span>
                    </div>
                  </div>
                </div>
              ) : !generatedSolution && !streamingText ? (
                <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto space-y-3 py-12">
                  <div className="w-12 h-12 rounded-2xl bg-violet-600/10 border border-violet-500/20 flex items-center justify-center text-violet-400 shadow-[0_0_25px_rgba(139,92,246,0.15)]">
                    <Code2 className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">Antigravity Coding Agent Ready</h3>
                    <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                      Click <strong className="text-violet-300">Generate Optimal Solution</strong> to solve the specific question on the active tab and automatically implant it into the platform's editor.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {rightTab === "complexity" ? (
                    <div className="p-4 rounded-2xl bg-[#0e0e1a] border border-white/10 space-y-4 text-xs">
                      <h4 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                        <Zap className="w-4 h-4 text-amber-400" />
                        Algorithmic Complexity & Intuition
                      </h4>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 rounded-xl bg-neutral-900/80 border border-white/5 space-y-1">
                          <span className="text-[10px] uppercase font-mono text-neutral-400 block">Time Complexity</span>
                          <span className="text-base font-bold text-emerald-400 font-mono">
                            {solutionMeta?.timeComplexity || "O(N)"}
                          </span>
                        </div>
                        <div className="p-3 rounded-xl bg-neutral-900/80 border border-white/5 space-y-1">
                          <span className="text-[10px] uppercase font-mono text-neutral-400 block">Space Complexity</span>
                          <span className="text-base font-bold text-cyan-400 font-mono">
                            {solutionMeta?.spaceComplexity || "O(N)"}
                          </span>
                        </div>
                      </div>
                      <div className="p-3.5 rounded-xl bg-neutral-900/60 border border-white/5 text-neutral-300 leading-relaxed">
                        {solutionMeta?.explanation || "Optimal implementation satisfying platform time and space constraints."}
                      </div>
                    </div>
                  ) : rightTab === "testcases" && solutionMeta?.testCases ? (
                    <div className="space-y-3">
                      <h4 className="text-xs font-mono uppercase text-neutral-400 font-semibold">
                        Verified Test Cases
                      </h4>
                      {solutionMeta.testCases.map((tc, idx) => (
                        <div key={idx} className="p-3 rounded-xl bg-[#0e0e1a] border border-white/10 space-y-2 text-xs font-mono">
                          <div className="text-neutral-300">
                            <span className="text-neutral-500 font-semibold mr-2">Input:</span>
                            <span className="text-white">{tc.input}</span>
                          </div>
                          <div className="text-emerald-400">
                            <span className="text-neutral-500 font-semibold mr-2">Output:</span>
                            <span>{tc.output}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    /* Streaming or Completed Markdown */
                    <div className="prose prose-invert prose-neutral text-xs leading-relaxed max-w-none break-words">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {generatedSolution || streamingText}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── BOTTOM ACTION DECK: THE ANTIGRAVITY DIRECT IMPLEMENTER ── */}
            <div className="p-4 border-t border-white/[0.08] bg-[#0c0c16]/95 shrink-0 space-y-3">
              {/* Injection Feedback Status */}
              {injectStatus && (
                <div
                  className={`p-2.5 rounded-xl border flex items-center justify-between text-xs animate-in fade-in duration-150 ${
                    injectStatus.success
                      ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-200"
                      : "bg-rose-950/40 border-rose-500/40 text-rose-200"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {injectStatus.success ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                    )}
                    <span className="font-medium">{injectStatus.message}</span>
                  </div>
                  {injectStatus.success && (
                    <span className="text-[10px] font-mono uppercase bg-emerald-500/20 px-2 py-0.5 rounded text-emerald-300 font-semibold">
                      ACCEPTED
                    </span>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-neutral-400">
                  <Zap className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="text-[11px]">
                    Implements directly into Monaco / CodeMirror / Ace editor on active tab without page reload.
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {/* Run on Platform Button */}
                  <button
                    type="button"
                    onClick={handleRunOnPlatform}
                    disabled={isRunningOnPlatform}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition border ${
                      runSuccessTarget
                        ? "bg-cyan-600/30 border-cyan-400/60 text-cyan-200 shadow-[0_0_15px_rgba(6,182,212,0.3)]"
                        : "bg-white/[0.06] hover:bg-white/[0.12] text-neutral-200 hover:text-white border-white/[0.1]"
                    }`}
                    title="Click the Run / Submit button on the website"
                  >
                    {isRunningOnPlatform ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                    ) : runSuccessTarget ? (
                      <CheckCheck className="w-3.5 h-3.5 text-cyan-300" />
                    ) : (
                      <Play className="w-3.5 h-3.5 text-cyan-400 fill-cyan-400" />
                    )}
                    <span>{runSuccessTarget ? `Triggered ${runSuccessTarget}!` : "Run on Platform"}</span>
                  </button>

                  {/* Primary: Implement Directly to Platform Button */}
                  <button
                    type="button"
                    onClick={() => handleImplementCode()}
                    disabled={isInjecting || (!generatedSolution && !streamingText)}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-xs font-bold transition transform active:scale-95 disabled:opacity-40 ${
                      injectSuccess
                        ? "bg-emerald-600 shadow-[0_0_30px_rgba(16,185,129,0.5)] border border-emerald-400"
                        : "bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 shadow-[0_0_25px_rgba(16,185,129,0.3)]"
                    }`}
                  >
                    {isInjecting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Implanting into Editor...</span>
                      </>
                    ) : injectSuccess ? (
                      <>
                        <CheckCheck className="w-4 h-4 text-emerald-200" />
                        <span>Implanted Successfully!</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4 text-amber-300 fill-amber-300" />
                        <span>⚡ Implement Directly to Platform</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
