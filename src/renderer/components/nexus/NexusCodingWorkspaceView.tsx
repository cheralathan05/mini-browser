import React, { useState, useEffect, useRef } from "react";
import {
  Code2,
  Sparkles,
  Play,
  RotateCcw,
  Copy,
  Check,
  Save,
  Download,
  Terminal,
  Zap,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Send,
  Loader2,
  History,
  Layers,
  ChevronDown,
  Globe,
  Plus,
  Trash2,
  Settings,
  Split,
  Eye,
  FileCode,
  Square,
  HelpCircle,
  PanelLeft,
  PanelRight,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { NexusMonacoEditor } from "./NexusMonacoEditor";
import { codingApi, type CodingProjectSummary, type CodingProjectDetail, type CodeExecutionItem } from "@/lib/nexus/coding.api";
import { askApi, type AIConversationSummary, type AIMessageItem } from "@/lib/nexus/ask.api";
import { useToast } from "./NexusToast";

interface NexusCodingWorkspaceViewProps {
  workspaceId?: string | null;
  onOpenInBrowser?: (url: string, title?: string) => void;
}

const SUPPORTED_LANGUAGES = [
  { id: "python", label: "Python 3.13" },
  { id: "javascript", label: "JavaScript (Node.js)" },
  { id: "typescript", label: "TypeScript" },
  { id: "cpp", label: "C++ (GCC)" },
  { id: "java", label: "Java (OpenJDK)" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
  { id: "csharp", label: "C# (.NET)" },
  { id: "sql", label: "PostgreSQL SQL" },
];

const STRATEGIES = [
  { id: "optimal", label: "Optimal Solution", desc: "Optimal algorithm with minimal time and space complexity" },
  { id: "complexity", label: "Complexity Optimization", desc: "Rigorous Big-O time and space optimization" },
  { id: "explanation", label: "Code Walkthrough", desc: "Step-by-step intuitive logic walkthrough" },
  { id: "diagnosis", label: "Bug Diagnosis", desc: "Detect edge-case failures, overflow, and runtime errors" },
  { id: "refactor", label: "Clean Refactor", desc: "Idiomatic restructuring for production readability" },
  { id: "tests", label: "Test Suite Generation", desc: "Generate exhaustive boundary and corner case tests" },
  { id: "alternatives", label: "Brute vs Optimal", desc: "Compare brute-force approach vs optimal approach" },
  { id: "review", label: "Code Review", desc: "Holistic quality, security, and algorithmic audit" },
];

const PRESETS = [
  { label: "Optimal O(N)", strategy: "optimal", desc: "Optimal algorithm with time and space complexity" },
  { label: "Line-by-Line Comments", strategy: "explanation", desc: "Solve with step-by-step explanatory comments" },
  { label: "Brute vs Optimal", strategy: "alternatives", desc: "Compare brute force approach with optimal" },
  { label: "Starter Template", strategy: "optimal", desc: "Generate complete function skeleton and driver code" },
  { label: "Debug Selected Code", strategy: "diagnosis", desc: "Diagnose bugs in current code or selection" },
  { label: "Generate Edge Cases", strategy: "tests", desc: "Corner cases, large inputs, and boundary checks" },
  { label: "Code Review", strategy: "review", desc: "In-depth code review and quality suggestions" },
];

export const NexusCodingWorkspaceView: React.FC<NexusCodingWorkspaceViewProps> = ({
  workspaceId,
  onOpenInBrowser,
}) => {
  const toast = useToast();

  // Project state
  const [projects, setProjects] = useState<CodingProjectSummary[]>([]);
  const [currentProject, setCurrentProject] = useState<CodingProjectDetail | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>("python");
  const [problemTitle, setProblemTitle] = useState<string>("Two Sum");
  const [problemStatement, setProblemStatement] = useState<string>(
    "Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.\nYou may assume each input would have exactly one solution, and you may not use the same element twice."
  );
  const [problemUrl, setProblemUrl] = useState<string>("");
  const [isImportingUrl, setIsImportingUrl] = useState<boolean>(false);
  const [customInstructions, setCustomInstructions] = useState<string>("");
  const [strategy, setStrategy] = useState<string>("optimal");
  const [includeComments, setIncludeComments] = useState<boolean>(true);
  const [includeTests, setIncludeTests] = useState<boolean>(true);
  const [autoApply, setAutoApply] = useState<boolean>(false);

  // Editor state
  const [code, setCode] = useState<string>(`class Solution:
    def twoSum(self, nums: list[int], target: int) -> list[int]:
        """
        One-pass Hash Map solution for Two Sum.
        Time Complexity: O(N)
        Space Complexity: O(N)
        """
        seen: dict[int, int] = {}
        for i, num in enumerate(nums):
            complement = target - num
            if complement in seen:
                return [seen[complement], i]
            seen[num] = i
        return []

if __name__ == "__main__":
    s = Solution()
    print("Test 1:", s.twoSum([2, 7, 11, 15], 9)) # Expected: [0, 1]
    print("Test 2:", s.twoSum([3, 2, 4], 6))       # Expected: [1, 2]
`);
  const [editorFontSize, setEditorFontSize] = useState<number>(14);
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [selectedEditorText, setSelectedEditorText] = useState<string>("");
  const [diffProposedCode, setDiffProposedCode] = useState<string | null>(null);
  const [undoCode, setUndoCode] = useState<string | null>(null);

  // Execution state
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [executionResult, setExecutionResult] = useState<CodeExecutionItem | null>(null);
  const [consoleTab, setConsoleTab] = useState<"output" | "tests" | "history">("output");
  const [executionHistory, setExecutionHistory] = useState<CodeExecutionItem[]>([]);

  // Generation state
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [streamingStatus, setStreamingStatus] = useState<string | null>(null);
  const [generationOutput, setGenerationOutput] = useState<string>("");
  const abortControllerRef = useRef<AbortController | null>(null);

  // AI Assistant Panel state
  const [assistantMessages, setAssistantMessages] = useState<AIMessageItem[]>([]);
  const [assistantPrompt, setAssistantPrompt] = useState<string>("");
  const [isAssistantStreaming, setIsAssistantStreaming] = useState<boolean>(false);
  const [assistantStreamingText, setAssistantStreamingText] = useState<string>("");
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [conversationsList, setConversationsList] = useState<AIConversationSummary[]>([]);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState<boolean>(true);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState<boolean>(true);

  // Global keyboard shortcuts: Ctrl+Enter (Run), Ctrl+S (Save), Ctrl+B (Toggle Left Panel)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleRunCode();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSaveProject();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setIsLeftPanelOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [code, selectedLanguage, currentProject, isExecuting]);

  // Load projects & history on mount
  useEffect(() => {
    loadProjects();
    loadExecutionHistory();
    loadConversations();
  }, [workspaceId]);

  const loadProjects = async () => {
    try {
      const list = await codingApi.getProjects(workspaceId || undefined);
      setProjects(list);
      if (list.length > 0 && !currentProject) {
        loadProjectDetail(list[0].id);
      }
    } catch (err: any) {
      console.warn("Could not load projects:", err.message);
    }
  };

  const loadProjectDetail = async (id: string) => {
    try {
      const p = await codingApi.getProject(id);
      setCurrentProject(p);
      setSelectedLanguage(p.language);
      setProblemTitle(p.problemTitle || p.name);
      setProblemStatement(p.problemStatement || "");
      setProblemUrl(p.problemUrl || "");
      setCode(p.currentCode);
      setIsDirty(false);
    } catch (err: any) {
      toast.error("Failed to load project details");
    }
  };

  const loadExecutionHistory = async () => {
    try {
      const execs = await codingApi.getExecutions();
      setExecutionHistory(execs);
    } catch {}
  };

  const loadConversations = async () => {
    try {
      const list = await askApi.getConversations(workspaceId || undefined);
      setConversationsList(list);
      if (list.length > 0 && !currentConversationId) {
        const detail = await askApi.getConversation(list[0].id);
        setCurrentConversationId(list[0].id);
        setAssistantMessages(detail.messages || []);
      }
    } catch {}
  };

  // Import public URL problem
  const handleImportUrl = async () => {
    if (!problemUrl.trim()) {
      toast.error("Please enter a valid problem URL.");
      return;
    }
    setIsImportingUrl(true);
    try {
      const res = await codingApi.importProblemUrl(problemUrl.trim());
      setProblemTitle(res.title);
      setProblemStatement(res.problemStatement);
      toast.success("Problem statement imported successfully.");
    } catch (err: any) {
      toast.error(`Import failed: ${err.message}`);
    } finally {
      setIsImportingUrl(false);
    }
  };

  // Run code in real execution sandbox
  const handleRunCode = async () => {
    if (isExecuting) return;
    setIsExecuting(true);
    setConsoleTab("output");
    try {
      const testCases = currentProject?.testCases || [
        { input: "Default Standard Execution", expectedOutput: "" },
      ];

      const res = await codingApi.executeCode({
        language: selectedLanguage,
        code,
        testCases,
        projectId: currentProject?.id,
      });

      setExecutionResult(res);
      await loadExecutionHistory();

      if (res.status === "completed" && res.exitCode === 0) {
        toast.success(`⚡ Executed in ${res.durationMs}ms with exit code 0`);
      } else if (res.status === "timeout") {
        toast.error("Execution timed out (exceeded resource quota)");
      } else {
        toast.error(`Execution failed with exit code ${res.exitCode}`);
      }
    } catch (err: any) {
      toast.error(`Execution error: ${err.message}`);
    } finally {
      setIsExecuting(false);
    }
  };

  // Save project and version snapshot
  const handleSaveProject = async () => {
    try {
      if (currentProject) {
        await codingApi.updateProject(currentProject.id, {
          name: problemTitle || currentProject.name,
          problemTitle,
          problemStatement,
          problemUrl,
          language: selectedLanguage,
          currentCode: code,
        });
        await codingApi.saveVersion(currentProject.id, code, `Saved update at ${new Date().toLocaleTimeString()}`);
        setIsDirty(false);
        toast.success("Project and version snapshot saved to PostgreSQL.");
        await loadProjects();
      } else {
        const created = await codingApi.createProject({
          name: problemTitle || "Coding Task",
          problemTitle,
          problemStatement,
          problemUrl,
          language: selectedLanguage,
          code,
          workspaceId: workspaceId || undefined,
        });
        setCurrentProject(created);
        setIsDirty(false);
        toast.success("Created new project in PostgreSQL.");
        await loadProjects();
      }
    } catch (err: any) {
      toast.error(`Save failed: ${err.message}`);
    }
  };

  // AI Solution Generator with real SSE streaming
  const handleGenerateSolution = async (presetItem?: { label: string; strategy?: string }) => {
    if (isGenerating) return;
    setIsGenerating(true);
    const chosenStrategy = presetItem?.strategy || strategy;
    setStreamingStatus(`✦ Synthesizing ${chosenStrategy} solution...`);
    setGenerationOutput("");
    setDiffProposedCode(null);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const instruction = [
      presetItem?.label ? `Preset: ${presetItem.label}` : `Strategy: ${chosenStrategy}`,
      customInstructions ? `Constraints: ${customInstructions}` : "",
      includeComments ? "Include line-by-line documentation" : "",
      includeTests ? "Generate verified test cases" : "",
    ]
      .filter(Boolean)
      .join(". ");

    try {
      const response = await fetch("/api/coding/generate/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: selectedLanguage,
          problemTitle,
          problemStatement,
          currentCode: code,
          strategy: chosenStrategy,
          customInstructions: instruction,
          includeComments,
          includeTests,
          workspaceId: workspaceId || undefined,
          projectId: currentProject?.id,
        }),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error("Generation request failed");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data:")) {
            try {
              const parsed = JSON.parse(trimmed.replace(/^data:\s*/, ""));
              if (parsed.status) {
                setStreamingStatus(parsed.status);
              }
              if (parsed.token) {
                accumulated += parsed.token;
                setGenerationOutput(accumulated);
              }
              if (parsed.code) {
                if (autoApply) {
                  setUndoCode(code);
                  setCode(parsed.code);
                  setIsDirty(true);
                  toast.success("Generated solution applied to editor.");
                } else {
                  setDiffProposedCode(parsed.code);
                }
              }
            } catch {}
          }
        }
      }

      setStreamingStatus(null);
    } catch (err: any) {
      if (err.name !== "AbortError") {
        toast.error(`Generation error: ${err.message}`);
      }
    } finally {
      setIsGenerating(false);
      setStreamingStatus(null);
    }
  };

  // Assistant Chat Send
  const handleSendAssistant = async (textToSend?: string) => {
    const promptText = (textToSend || assistantPrompt).trim();
    if (!promptText || isAssistantStreaming) return;

    let convId = currentConversationId;
    if (!convId) {
      try {
        const newConv = await askApi.createConversation({
          workspaceId: workspaceId || undefined,
          title: `Coding: ${problemTitle}`,
          contextType: "coding",
        });
        convId = newConv.id;
        setCurrentConversationId(convId);
      } catch {
        toast.error("Failed to start assistant conversation");
        return;
      }
    }

    const userMsg: AIMessageItem = {
      id: `usr_${Date.now()}`,
      conversationId: convId,
      role: "user",
      content: promptText,
      status: "completed",
      createdAt: new Date().toISOString(),
    };

    setAssistantMessages((prev) => [...prev, userMsg]);
    setAssistantPrompt("");
    setIsAssistantStreaming(true);
    setAssistantStreamingText("");

    const contextPayload = {
      type: "code",
      language: selectedLanguage,
      problemTitle,
      problemStatement: problemStatement.slice(0, 1000),
      selectedCode: selectedEditorText || undefined,
      currentCode: code.slice(0, 2000),
    };

    try {
      await askApi.streamMessage(convId, promptText, contextPayload, {
        onToken: (tok) => setAssistantStreamingText((prev) => prev + tok),
        onComplete: (data) => {
          setIsAssistantStreaming(false);
          const finalTxt = data.content || assistantStreamingText;
          if (finalTxt) {
            setAssistantMessages((prev) => [
              ...prev,
              {
                id: data.messageId || `asst_${Date.now()}`,
                conversationId: convId!,
                role: "assistant",
                content: finalTxt,
                status: "completed",
                model: data.model || "qwen3:8b",
                createdAt: new Date().toISOString(),
              },
            ]);
          }
          setAssistantStreamingText("");
        },
        onError: (err) => {
          setIsAssistantStreaming(false);
          toast.error(err);
        },
      });
    } catch (err: any) {
      setIsAssistantStreaming(false);
      toast.error(err.message);
    }
  };

  return (
    <div className="flex h-full w-full bg-[#050507] text-neutral-100 overflow-hidden font-sans select-none">
      {/* ============================================================ */}
      {/* REGION A: LEFT CONFIGURATION & AGENT PANEL (340px) */}
      {/* ============================================================ */}
      {isLeftPanelOpen && (
        <div className="w-[340px] flex-shrink-0 border-r border-white/5 bg-[#08080d] flex flex-col h-full overflow-hidden">
          {/* Panel Header */}
        <div className="p-4 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400">
              <Code2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white tracking-wide">Coding Agent</h2>
              <p className="text-[10px] text-neutral-400">Algorithmic Synthesis & IDE</p>
            </div>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
            qwen3:8b
          </span>
        </div>

        {/* Scrollable Configuration Controls */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs">
          {/* Target Language */}
          <div>
            <label className="block text-[11px] font-medium text-neutral-300 mb-1.5 uppercase tracking-wider">
              Programming Language
            </label>
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              className="w-full bg-neutral-900/80 border border-white/10 rounded-lg px-3 py-2 text-neutral-200 focus:outline-none focus:border-violet-500 text-xs"
            >
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>

          {/* Problem Statement & Title */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-medium text-neutral-300 uppercase tracking-wider">
                Problem Definition
              </label>
            </div>
            <input
              type="text"
              value={problemTitle}
              onChange={(e) => setProblemTitle(e.target.value)}
              placeholder="Problem Title (e.g. Two Sum)"
              className="w-full bg-neutral-900/80 border border-white/10 rounded-lg px-3 py-2 text-neutral-200 focus:outline-none focus:border-violet-500 text-xs mb-2"
            />
            <textarea
              rows={3}
              value={problemStatement}
              onChange={(e) => setProblemStatement(e.target.value)}
              placeholder="Paste problem description, input/output constraints..."
              className="w-full bg-neutral-900/80 border border-white/10 rounded-lg p-3 text-neutral-300 focus:outline-none focus:border-violet-500 text-xs leading-relaxed resize-none"
            />
          </div>

          {/* Problem URL Import */}
          <div>
            <label className="block text-[11px] font-medium text-neutral-300 mb-1.5 uppercase tracking-wider">
              Public Problem URL
            </label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={problemUrl}
                onChange={(e) => setProblemUrl(e.target.value)}
                placeholder="https://leetcode.com/problems/..."
                className="flex-1 bg-neutral-900/80 border border-white/10 rounded-lg px-3 py-1.5 text-neutral-300 text-[11px] focus:outline-none focus:border-violet-500"
              />
              <button
                onClick={handleImportUrl}
                disabled={isImportingUrl || !problemUrl}
                className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-200 text-xs flex items-center gap-1 disabled:opacity-40"
              >
                {isImportingUrl ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
                Import
              </button>
            </div>
          </div>

          {/* Generation Strategy Selector */}
          <div>
            <label className="block text-[11px] font-medium text-neutral-300 mb-1.5 uppercase tracking-wider">
              Generation Strategy
            </label>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              className="w-full bg-neutral-900/80 border border-white/10 rounded-lg px-3 py-2 text-neutral-200 focus:outline-none focus:border-violet-500 text-xs"
            >
              {STRATEGIES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {/* Generation Strategy Presets */}
          <div>
            <label className="block text-[11px] font-medium text-neutral-300 mb-1.5 uppercase tracking-wider">
              Quick-Start Presets
            </label>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => handleGenerateSolution({ label: p.label, strategy: p.strategy })}
                  disabled={isGenerating}
                  title={p.desc}
                  className="px-2 py-1 rounded-md bg-white/5 hover:bg-violet-600/20 border border-white/5 hover:border-violet-500/30 text-neutral-300 hover:text-violet-300 text-[10px] transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Constraints */}
          <div>
            <label className="block text-[11px] font-medium text-neutral-300 mb-1.5 uppercase tracking-wider">
              Custom Instructions
            </label>
            <input
              type="text"
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              placeholder="e.g. Space must be O(1), no recursion"
              className="w-full bg-neutral-900/80 border border-white/10 rounded-lg px-3 py-2 text-neutral-300 text-xs focus:outline-none focus:border-violet-500"
            />
          </div>

          {/* Execution Settings Toggles */}
          <div className="space-y-2 pt-2 border-t border-white/5">
            <label className="flex items-center gap-2 cursor-pointer text-[11px] text-neutral-400 hover:text-neutral-200">
              <input
                type="checkbox"
                checked={includeComments}
                onChange={(e) => setIncludeComments(e.target.checked)}
                className="rounded border-white/20 bg-neutral-900 text-violet-600 focus:ring-0"
              />
              Include complexity & line comments
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-[11px] text-neutral-400 hover:text-neutral-200">
              <input
                type="checkbox"
                checked={includeTests}
                onChange={(e) => setIncludeTests(e.target.checked)}
                className="rounded border-white/20 bg-neutral-900 text-violet-600 focus:ring-0"
              />
              Generate edge-case test suite
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-[11px] text-neutral-400 hover:text-neutral-200">
              <input
                type="checkbox"
                checked={autoApply}
                onChange={(e) => setAutoApply(e.target.checked)}
                className="rounded border-white/20 bg-neutral-900 text-violet-600 focus:ring-0"
              />
              Auto-apply changes to editor (opt-in)
            </label>
          </div>
        </div>

        {/* Generate Solution Action Footer */}
        <div className="p-4 border-t border-white/5 bg-[#06060a]">
          <button
            onClick={() => handleGenerateSolution()}
            disabled={isGenerating}
            className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-medium text-xs flex items-center justify-center gap-2 shadow-lg shadow-violet-900/20 disabled:opacity-50 transition-all cursor-pointer"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Synthesizing...
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                Generate Solution
              </>
            )}
          </button>
          {streamingStatus && (
            <p className="text-[10px] text-violet-400 text-center mt-2 animate-pulse truncate font-mono">
              {streamingStatus}
            </p>
          )}
        </div>
      </div>
      )}

      {/* ============================================================ */}
      {/* REGION B: CENTER CODE EDITOR & EXECUTION CONSOLE */}
      {/* ============================================================ */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#07070b]">
        {/* Editor Toolbar */}
        <div className="h-11 border-b border-white/5 px-4 flex items-center justify-between bg-[#08080d]/80 backdrop-blur">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsLeftPanelOpen((prev) => !prev)}
              className={`p-1.5 rounded-lg border transition-colors ${
                isLeftPanelOpen
                  ? "bg-violet-600/20 text-violet-300 border-violet-500/30"
                  : "bg-white/5 text-neutral-400 border-white/5 hover:text-white"
              }`}
              title="Toggle Left Configuration Panel (Ctrl+B)"
            >
              <PanelLeft className="w-3.5 h-3.5" />
            </button>

            <div className="flex items-center gap-2">
              <FileCode className="w-4 h-4 text-violet-400" />
              <span className="text-xs font-semibold text-neutral-200">
                {problemTitle ? `${problemTitle.replace(/[^a-zA-Z0-9]/g, "_")}.${selectedLanguage.startsWith("py") ? "py" : selectedLanguage.startsWith("js") ? "js" : "ts"}` : "solution.py"}
              </span>
              {isDirty && (
                <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" title="Unsaved changes" />
              )}
            </div>

            <span className="text-neutral-600">|</span>

            {/* Font Size Selector */}
            <div className="flex items-center gap-1 text-[11px] text-neutral-400">
              <button
                onClick={() => setEditorFontSize(Math.max(11, editorFontSize - 1))}
                className="px-1.5 py-0.5 rounded hover:bg-white/5"
              >
                A-
              </button>
              <span className="font-mono">{editorFontSize}px</span>
              <button
                onClick={() => setEditorFontSize(Math.min(20, editorFontSize + 1))}
                className="px-1.5 py-0.5 rounded hover:bg-white/5"
              >
                A+
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Version Snapshot Rollback */}
            {currentProject?.versions && currentProject.versions.length > 0 && (
              <div className="relative group">
                <button className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 text-xs flex items-center gap-1 border border-white/5 transition-colors">
                  <History className="w-3.5 h-3.5 text-violet-400" />
                  <span>v{currentProject.versions[0]?.versionNumber || 1}</span>
                  <ChevronDown className="w-3 h-3 text-neutral-500" />
                </button>
                <div className="hidden group-hover:block absolute top-full right-0 mt-1 w-64 bg-neutral-900 border border-white/10 rounded-xl shadow-xl z-30 p-1.5 text-xs">
                  <div className="px-2 py-1 text-[10px] text-neutral-500 uppercase font-semibold">Saved Version History</div>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {currentProject.versions.map((ver) => (
                      <button
                        key={ver.id}
                        onClick={() => {
                          setUndoCode(code);
                          setCode(ver.content);
                          setIsDirty(true);
                          toast.info(`Restored Version #${ver.versionNumber}`);
                        }}
                        className="w-full text-left px-2 py-1.5 rounded hover:bg-violet-600/20 hover:text-violet-200 text-neutral-300 flex items-center justify-between text-xs"
                      >
                        <span className="font-mono">v{ver.versionNumber} {ver.description ? `· ${ver.description.slice(0, 18)}` : ""}</span>
                        <span className="text-[10px] text-neutral-500">{new Date(ver.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Undo AI changes */}
            {undoCode && (
              <button
                onClick={() => {
                  setCode(undoCode);
                  setUndoCode(null);
                  toast.info("Reverted to previous code.");
                }}
                className="px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs font-medium flex items-center gap-1 border border-amber-500/20 transition-colors"
                title="Undo AI changes"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Undo
              </button>
            )}

            {/* Save snapshot */}
            <button
              onClick={handleSaveProject}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-200 text-xs font-medium flex items-center gap-1.5 border border-white/5 transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              Save Snapshot
            </button>

            {/* Run Code Button */}
            <button
              onClick={handleRunCode}
              disabled={isExecuting}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium flex items-center gap-1.5 shadow-md shadow-emerald-950/40 disabled:opacity-50 transition-all cursor-pointer"
              title="Execute code in isolated sandbox (Ctrl+Enter)"
            >
              {isExecuting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current" />
              )}
              Run Code
            </button>

            {/* Toggle Right Assistant Panel */}
            <button
              onClick={() => setIsRightPanelOpen((prev) => !prev)}
              className={`p-1.5 rounded-lg border transition-colors ${
                isRightPanelOpen
                  ? "bg-violet-600/20 text-violet-300 border-violet-500/30"
                  : "bg-white/5 text-neutral-400 border-white/5 hover:text-white"
              }`}
              title="Toggle Right AI Assistant Panel"
            >
              <PanelRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Diff Review Banner when AI generates code without auto-apply */}
        {diffProposedCode && (
          <div className="p-3 bg-violet-950/40 border-b border-violet-500/30 flex items-center justify-between text-xs animate-in slide-in-from-top-2">
            <div className="flex items-center gap-2 text-violet-200">
              <Sparkles className="w-4 h-4 text-violet-400 shrink-0" />
              <span>AI proposed optimal code. Review and apply to Monaco editor.</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setUndoCode(code);
                  setCode(diffProposedCode);
                  setDiffProposedCode(null);
                  setIsDirty(true);
                  toast.success("Applied AI code to editor.");
                }}
                className="px-3 py-1 bg-violet-600 hover:bg-violet-500 text-white rounded-md font-medium"
              >
                Apply to Editor
              </button>
              <button
                onClick={() => setDiffProposedCode(null)}
                className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white rounded-md"
              >
                Discard
              </button>
            </div>
          </div>
        )}

        {/* Monaco Editor Container */}
        <div className="flex-1 relative overflow-hidden">
          <NexusMonacoEditor
            value={code}
            language={selectedLanguage}
            fontSize={editorFontSize}
            onChange={(val) => {
              setCode(val);
              setIsDirty(true);
            }}
            onSelectionChange={(sel) => setSelectedEditorText(sel)}
          />
        </div>

        {/* Bottom Execution Console & Test Runner */}
        <div className="h-64 border-t border-white/5 bg-[#08080d] flex flex-col">
          {/* Console Header Tabs */}
          <div className="h-9 px-4 border-b border-white/5 flex items-center justify-between bg-black/30">
            <div className="flex items-center gap-4 text-xs font-medium">
              <button
                onClick={() => setConsoleTab("output")}
                className={`flex items-center gap-1.5 py-2 border-b-2 ${
                  consoleTab === "output" ? "border-violet-500 text-white" : "border-transparent text-neutral-400 hover:text-neutral-200"
                }`}
              >
                <Terminal className="w-3.5 h-3.5" />
                Console Output
              </button>
              <button
                onClick={() => setConsoleTab("tests")}
                className={`flex items-center gap-1.5 py-2 border-b-2 ${
                  consoleTab === "tests" ? "border-violet-500 text-white" : "border-transparent text-neutral-400 hover:text-neutral-200"
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Test Cases
              </button>
              <button
                onClick={() => setConsoleTab("history")}
                className={`flex items-center gap-1.5 py-2 border-b-2 ${
                  consoleTab === "history" ? "border-violet-500 text-white" : "border-transparent text-neutral-400 hover:text-neutral-200"
                }`}
              >
                <History className="w-3.5 h-3.5" />
                Execution History
              </button>
            </div>

            {executionResult && (
              <div className="flex items-center gap-3 text-[11px] font-mono">
                <span className="text-neutral-400">Exit: {executionResult.exitCode}</span>
                <span className="text-neutral-400">{executionResult.durationMs}ms</span>
                <span
                  className={`px-1.5 py-0.5 rounded ${
                    executionResult.exitCode === 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                  }`}
                >
                  {executionResult.exitCode === 0 ? "SUCCESS" : "FAILED"}
                </span>
              </div>
            )}
          </div>

          {/* Console Body Content */}
          <div className="flex-1 p-4 font-mono text-xs overflow-y-auto">
            {consoleTab === "output" && (
              <div>
                {executionResult ? (
                  <div className="space-y-2">
                    {executionResult.stdout && (
                      <pre className="text-emerald-400 whitespace-pre-wrap">{executionResult.stdout}</pre>
                    )}
                    {executionResult.stderr && (
                      <pre className="text-red-400 whitespace-pre-wrap">{executionResult.stderr}</pre>
                    )}
                    {!executionResult.stdout && !executionResult.stderr && (
                      <p className="text-neutral-500 italic">Program finished with no output.</p>
                    )}
                  </div>
                ) : (
                  <p className="text-neutral-500 italic">Click "Run Code" to execute script in secure isolated sandbox.</p>
                )}
              </div>
            )}

            {consoleTab === "tests" && (
              <div className="space-y-2">
                {executionResult?.testResults && executionResult.testResults.length > 0 ? (
                  executionResult.testResults.map((t, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg bg-neutral-900/60 border border-white/5 flex items-start justify-between"
                    >
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          {t.passed ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-400" />
                          )}
                          <span className="text-neutral-200 font-semibold">Test Case #{idx + 1}</span>
                        </div>
                        <p className="text-neutral-400 text-[11px]">Input: {t.input}</p>
                        <p className="text-neutral-300 text-[11px]">Output: {t.actualOutput}</p>
                      </div>
                      <span className="text-[10px] text-neutral-500 font-mono">{t.durationMs}ms</span>
                    </div>
                  ))
                ) : (
                  <p className="text-neutral-500 italic">No test results available yet. Run code to evaluate test suite.</p>
                )}
              </div>
            )}

            {consoleTab === "history" && (
              <div className="space-y-2">
                {executionHistory.map((h) => (
                  <div
                    key={h.id}
                    className="p-2.5 rounded-lg bg-neutral-900/40 border border-white/5 flex items-center justify-between text-[11px]"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full ${h.exitCode === 0 ? "bg-emerald-400" : "bg-red-400"}`}
                      />
                      <span className="text-neutral-200">{h.language}</span>
                      <span className="text-neutral-500 truncate max-w-xs">{h.code.slice(0, 45)}...</span>
                    </div>
                    <div className="flex items-center gap-3 text-neutral-400">
                      <span>{h.durationMs}ms</span>
                      <span>{new Date(h.createdAt).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* REGION C: RIGHT AI CODING ASSISTANT PANEL (380px) */}
      {/* ============================================================ */}
      {isRightPanelOpen && (
        <div className="w-[380px] flex-shrink-0 border-l border-white/5 bg-[#08080d] flex flex-col h-full overflow-hidden">
          {/* Assistant Header */}
        <div className="p-4 border-b border-white/5 flex items-center justify-between bg-[#06060a]">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-violet-600 to-cyan-500 flex items-center justify-center text-white">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-white">NEXUS Coding Assistant</h3>
              <p className="text-[10px] text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Live Context Active
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              setCurrentConversationId(null);
              setAssistantMessages([]);
            }}
            className="p-1 rounded hover:bg-white/10 text-neutral-400 hover:text-white"
            title="Start new discussion"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Selected Context Indicator */}
        <div className="px-4 py-2 bg-neutral-900/50 border-b border-white/5 text-[10px] text-neutral-400 flex items-center justify-between">
          <span className="truncate">
            Context: <span className="text-violet-300 font-mono">{selectedLanguage}</span> ·{" "}
            {selectedEditorText ? `Selected ${selectedEditorText.length} chars` : `File: ${code.split("\n").length} lines`}
          </span>
          {selectedEditorText && (
            <button
              onClick={() => setSelectedEditorText("")}
              className="text-neutral-500 hover:text-white"
            >
              Clear
            </button>
          )}
        </div>

        {/* Messages History */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {assistantMessages.length === 0 && !isAssistantStreaming && (
            <div className="text-center py-12 text-neutral-500">
              <Sparkles className="w-8 h-8 mx-auto text-violet-500/40 mb-3" />
              <p className="font-medium text-neutral-300">Ask anything about your code</p>
              <p className="text-[11px] text-neutral-500 mt-1 max-w-[240px] mx-auto">
                Explain algorithms, diagnose bug stacktraces, optimize space/time, or generate unit tests.
              </p>

              {/* Action Chips */}
              <div className="mt-6 flex flex-col gap-2">
                {[
                  "Explain this algorithm in simple terms",
                  "What is the time and space complexity?",
                  "Identify possible edge cases or overflow",
                  "Suggest 3 unit tests for this code",
                ].map((action) => (
                  <button
                    key={action}
                    onClick={() => handleSendAssistant(action)}
                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-neutral-300 text-left text-[11px] transition-colors"
                  >
                    ✦ {action}
                  </button>
                ))}
              </div>
            </div>
          )}

          {assistantMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[92%] rounded-xl p-3 ${
                  msg.role === "user"
                    ? "bg-violet-600/20 border border-violet-500/30 text-neutral-100"
                    : "bg-neutral-900/70 border border-white/5 text-neutral-200"
                }`}
              >
                <div className="prose prose-invert prose-xs max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                </div>

                {msg.role === "assistant" && (
                  <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between text-[10px] text-neutral-400">
                    <span>{msg.model || "qwen3:8b"}</span>
                    <div className="flex items-center gap-2">
                      {/```[\s\S]*?```/.test(msg.content) && (
                        <button
                          onClick={() => {
                            const match = msg.content.match(/```(?:[a-zA-Z0-9_\-\+#]+)?\n([\s\S]*?)```/);
                            if (match && match[1]) {
                              setDiffProposedCode(match[1].trim());
                              toast.info("Proposed assistant code loaded for review in editor.");
                            }
                          }}
                          className="text-violet-400 hover:text-violet-300 flex items-center gap-1 font-medium transition-colors"
                        >
                          <Sparkles className="w-3 h-3" /> Review in Editor
                        </button>
                      )}
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(msg.content);
                          toast.success("Copied to clipboard");
                        }}
                        className="hover:text-white flex items-center gap-1 transition-colors"
                      >
                        <Copy className="w-3 h-3" /> Copy
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Streaming token bubble */}
          {isAssistantStreaming && assistantStreamingText && (
            <div className="flex flex-col items-start">
              <div className="max-w-[92%] rounded-xl p-3 bg-neutral-900/70 border border-white/5 text-neutral-200">
                <div className="prose prose-invert prose-xs max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{assistantStreamingText}</ReactMarkdown>
                </div>
                <div className="mt-2 flex items-center gap-1 text-[10px] text-violet-400 animate-pulse">
                  <Loader2 className="w-3 h-3 animate-spin" /> Synthesizing response...
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Assistant Composer */}
        <div className="p-3 border-t border-white/5 bg-[#06060a]">
          <div className="relative rounded-xl border border-white/10 bg-neutral-900/80 focus-within:border-violet-500 transition-colors">
            <textarea
              rows={2}
              value={assistantPrompt}
              onChange={(e) => setAssistantPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendAssistant();
                }
              }}
              placeholder="Ask about this code... (Enter to send)"
              className="w-full bg-transparent p-2.5 text-xs text-neutral-200 placeholder:text-neutral-500 focus:outline-none resize-none"
            />
            <div className="flex items-center justify-between px-2.5 pb-2">
              <span className="text-[10px] text-neutral-500">Shift+Enter for newline</span>
              <button
                onClick={() => handleSendAssistant()}
                disabled={!assistantPrompt.trim() || isAssistantStreaming}
                className="p-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40 transition-colors cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
};
