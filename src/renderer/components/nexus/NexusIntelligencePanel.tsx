import React, { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  X,
  Send,
  Square,
  Check,
  Copy,
  RotateCcw,
  Bookmark,
  Bot,
  Workflow,
  Microscope,
  ExternalLink,
  History,
  Plus,
  Trash2,
  GitBranch,
  BookOpen,
  FileText,
  Clock,
  ChevronDown,
  Layers,
  CheckCircle2,
  AlertCircle,
  Brain,
  Zap,
  Code2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { askApi, AIConversationSummary, AIMessageItem } from "@/lib/nexus/ask.api";
import { useToast } from "./NexusToast";
import { NexusThinkingBlock, ThinkingPhase } from "./NexusThinkingBlock";

function parseThinkTags(raw: string): { thought?: string; answer: string; isThinkingStill?: boolean } {
  if (!raw) return { answer: "" };

  const thinkStart = raw.indexOf("<think>");
  if (thinkStart === -1) {
    return { answer: raw };
  }

  const thinkEnd = raw.indexOf("</think>");
  if (thinkEnd === -1) {
    const thought = raw.slice(thinkStart + 7).trim();
    return { thought, answer: "", isThinkingStill: true };
  }

  const thought = raw.slice(thinkStart + 7, thinkEnd).trim();
  const answer = (raw.slice(0, thinkStart) + raw.slice(thinkEnd + 8)).trim();
  return { thought, answer, isThinkingStill: false };
}

interface NexusIntelligencePanelProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId?: string | null;
  activeUrl?: string;
  activeTitle?: string;
  selectedText?: string;
  initialPrompt?: string;
  windowId?: number;
  activeTabId?: string;
  onNavigate?: (view: string) => void;
}

function extractCodeBlock(markdown: string): string | null {
  const match = markdown.match(/```(?:[a-zA-Z0-9_\-\+#]+)?\n([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}

export const NexusIntelligencePanel: React.FC<NexusIntelligencePanelProps> = ({
  isOpen,
  onClose,
  workspaceId,
  activeUrl,
  activeTitle,
  selectedText = "",
  initialPrompt,
  windowId = 1,
  activeTabId = "",
  onNavigate,
}) => {
  const [conversations, setConversations] = useState<AIConversationSummary[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AIMessageItem[]>([]);
  const [prompt, setPrompt] = useState(initialPrompt || "");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [streamingStatus, setStreamingStatus] = useState<string | null>(null);
  const [activeActionCard, setActiveActionCard] = useState<any | null>(null);
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savedMemoryIds, setSavedMemoryIds] = useState<Set<string>>(new Set());
  const [thinkingStartTime, setThinkingStartTime] = useState<number | null>(null);
  const [thinkingDuration, setThinkingDuration] = useState<number>(0);
  const [currentThinkingPhase, setCurrentThinkingPhase] = useState<string>("Analyzing query & page context");
  const [thinkingPhases, setThinkingPhases] = useState<ThinkingPhase[]>([
    { id: "context", label: "Analyzing query & active page context", status: "active" },
    { id: "memory", label: "Scanning persistent workspace memory", status: "pending" },
    { id: "synthesis", label: "Formulating recommendations & solution", status: "pending" },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const toast = useToast();

  const isGitHub = activeUrl?.toLowerCase().includes("github.com");
  const isResearch =
    activeUrl?.toLowerCase().includes("arxiv.org") ||
    activeUrl?.toLowerCase().includes("huggingface.co") ||
    activeUrl?.toLowerCase().includes("paperswithcode") ||
    activeUrl?.toLowerCase().includes(".pdf");
  const isCodingPlatform = Boolean(
    activeUrl &&
      (/leetcode\.com/i.test(activeUrl) ||
        /hackerrank\.com/i.test(activeUrl) ||
        /codeforces\.com/i.test(activeUrl) ||
        /onlinegdb\.com/i.test(activeUrl) ||
        /programiz\.com/i.test(activeUrl) ||
        /w3schools\.com/i.test(activeUrl) ||
        /geeksforgeeks\.org/i.test(activeUrl) ||
        /replit\.com/i.test(activeUrl) ||
        /compiler|coding|problem/i.test(activeUrl + " " + (activeTitle || "")))
  );

  // Scroll to bottom on messages update
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText]);

  // Load conversations list on open
  useEffect(() => {
    if (isOpen) {
      loadConversations();
    }
  }, [isOpen, workspaceId]);

  // Handle initialPrompt trigger reliably when panel opens
  const lastExecutedPromptRef = useRef<string | null>(null);
  useEffect(() => {
    if (initialPrompt && isOpen && lastExecutedPromptRef.current !== initialPrompt) {
      lastExecutedPromptRef.current = initialPrompt;
      setPrompt(initialPrompt);
      handleSendMessage(initialPrompt);
    }
  }, [initialPrompt, isOpen]);

  const loadConversations = async () => {
    try {
      const list = await askApi.getConversations(workspaceId || undefined);
      setConversations(list);

      // If no current conversation, restore latest or create one
      if (!currentConversationId && list.length > 0) {
        selectConversation(list[0].id);
      } else if (currentConversationId && !isStreaming) {
        try {
          const detail = await askApi.getConversation(currentConversationId);
          if (detail?.messages && detail.messages.length > 0) {
            setMessages(detail.messages);
          }
        } catch {}
      }
    } catch (e) {
      console.error("Failed to load conversations:", e);
    }
  };

  const selectConversation = async (id: string) => {
    try {
      setCurrentConversationId(id);
      setShowHistoryDrawer(false);
      const detail = await askApi.getConversation(id);
      setMessages(detail.messages || []);
      setStreamingText("");
    } catch (err: any) {
      toast.error("Failed to load conversation history");
    }
  };

  const startNewConversation = async () => {
    try {
      const contextObj: Record<string, unknown> = {};
      if (activeUrl) contextObj.url = activeUrl;
      if (activeTitle) contextObj.title = activeTitle;
      if (selectedText) contextObj.selectedText = selectedText;

      const created = await askApi.createConversation({
        workspaceId: workspaceId || undefined,
        title: "New Discussion",
        contextType: selectedText ? "selection" : activeUrl ? "page" : "general",
        context: Object.keys(contextObj).length > 0 ? contextObj : undefined,
      });

      setCurrentConversationId(created.id);
      setMessages([]);
      setStreamingText("");
      setShowHistoryDrawer(false);
      await loadConversations();
      textareaRef.current?.focus();
    } catch (err: any) {
      toast.error("Could not start new conversation");
    }
  };

  const handleDeleteConversation = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await askApi.deleteConversation(id);
      toast.info("Conversation deleted");
      if (currentConversationId === id) {
        setCurrentConversationId(null);
        setMessages([]);
      }
      await loadConversations();
    } catch {
      toast.error("Failed to delete conversation");
    }
  };

  const handleSendMessage = async (customPrompt?: string) => {
    const textToSend = (customPrompt || prompt).trim();
    if (!textToSend || isStreaming) return;

    let convId = currentConversationId;
    if (!convId) {
      try {
        const newConv = await askApi.createConversation({
          workspaceId: workspaceId || undefined,
          title: textToSend.slice(0, 45),
          contextType: selectedText ? "selection" : "page",
        });
        convId = newConv.id;
        setCurrentConversationId(convId);
      } catch {
        toast.error("Failed to initialize conversation");
        return;
      }
    }

    // Append user message optimistically
    const userMsg: AIMessageItem = {
      id: `temp_user_${Date.now()}`,
      conversationId: convId,
      role: "user",
      content: textToSend,
      status: "completed",
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setPrompt("");
    setIsStreaming(true);
    setStreamingText("");
    setStreamingStatus("✦ NEXUS is thinking...");
    setActiveActionCard(null);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Context snapshot payload
    const contextPayload: Record<string, unknown> = {
      type: selectedText ? "selection" : "page",
      url: activeUrl,
      title: activeTitle,
      selectedText: selectedText || undefined,
    };

    const startTime = Date.now();
    setThinkingStartTime(startTime);
    setThinkingDuration(0);
    setCurrentThinkingPhase("Analyzing query & active page context");
    setThinkingPhases([
      { id: "context", label: "Analyzing query & active page context", status: "active" },
      { id: "memory", label: "Scanning persistent workspace memory", status: "pending" },
      { id: "synthesis", label: "Formulating recommendations & solution", status: "pending" },
    ]);

    const phaseTimer1 = setTimeout(() => {
      setCurrentThinkingPhase("Scanning persistent workspace memory");
      setThinkingPhases([
        { id: "context", label: "Analyzing query & active page context", status: "completed" },
        { id: "memory", label: "Scanning persistent workspace memory", status: "active" },
        { id: "synthesis", label: "Formulating recommendations & solution", status: "pending" },
      ]);
    }, 1200);

    const phaseTimer2 = setTimeout(() => {
      setCurrentThinkingPhase("Formulating recommendations & solution");
      setThinkingPhases([
        { id: "context", label: "Analyzing query & active page context", status: "completed" },
        { id: "memory", label: "Scanning persistent workspace memory", status: "completed" },
        { id: "synthesis", label: "Formulating recommendations & solution", status: "active" },
      ]);
    }, 2800);

    await askApi.streamMessage(
      convId,
      textToSend,
      contextPayload,
      {
        onToken: (token) => {
          setThinkingDuration((curr) => (curr === 0 ? Date.now() - startTime : curr));
          setStreamingStatus("✦ Formulating response...");
          setStreamingText((prev) => prev + token);
        },
        onAction: (action) => {
          setActiveActionCard(action);
        },
        onComplete: (data) => {
          clearTimeout(phaseTimer1);
          clearTimeout(phaseTimer2);
          const finalDuration = Date.now() - startTime;
          setIsStreaming(false);
          setStreamingStatus(null);
          setThinkingStartTime(null);

          const finalContent = (data.content || streamingText || "").trim();
          const { thought } = parseThinkTags(finalContent);

          if (finalContent) {
            const assistantMsg: AIMessageItem = {
              id: data.messageId || `msg_${Date.now()}`,
              conversationId: convId!,
              role: "assistant",
              content: finalContent,
              model: data.model || "Ollama (qwen3:8b)",
              status: "completed",
              metadata: {
                ...(activeActionCard ? { suggestedAction: activeActionCard } : {}),
                thought,
                thinkingDuration: finalDuration,
              },
              createdAt: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, assistantMsg]);
          }
          setStreamingText("");
          loadConversations();
        },
        onError: (err) => {
          clearTimeout(phaseTimer1);
          clearTimeout(phaseTimer2);
          setIsStreaming(false);
          setStreamingStatus(null);
          setThinkingStartTime(null);
          toast.error(err);

          setStreamingText((current) => {
            if (current.trim()) {
              const { thought } = parseThinkTags(current);
              const partialMsg: AIMessageItem = {
                id: `partial_${Date.now()}`,
                conversationId: convId!,
                role: "assistant",
                content: current,
                model: "Ollama (qwen3:8b)",
                status: "completed",
                metadata: {
                  thought,
                  thinkingDuration: Date.now() - startTime,
                },
                createdAt: new Date().toISOString(),
              };
              setMessages((prev) => [...prev, partialMsg]);
            } else {
              const errMsg: AIMessageItem = {
                id: `error_${Date.now()}`,
                conversationId: convId!,
                role: "assistant",
                content: `⚠️ **Unable to complete AI response**\n\n${err}\n\nPlease check that Ollama is active and click **Retry** below.`,
                status: "failed",
                createdAt: new Date().toISOString(),
              };
              setMessages((prev) => [...prev, errMsg]);
            }
            return "";
          });
        },
      },
      abortController.signal
    );
  };

  const handleStopGeneration = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (currentConversationId) {
      await askApi.cancelGeneration(currentConversationId);
    }
    setIsStreaming(false);
    setStreamingStatus(null);
    if (streamingText) {
      const assistantMsg: AIMessageItem = {
        id: `cancelled_${Date.now()}`,
        conversationId: currentConversationId!,
        role: "assistant",
        content: `${streamingText} [Generation stopped]`,
        status: "cancelled",
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setStreamingText("");
    }
    toast.info("Generation stopped");
  };

  const handleCopyMessage = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleSaveToMemory = async (msgId: string, content: string) => {
    try {
      await askApi.saveToMemory({
        content,
        key: activeTitle || "NEXUS Insight",
        type: "fact",
        workspaceId: workspaceId || undefined,
        metadata: { url: activeUrl, source: "NexusIntelligence" },
      });
      setSavedMemoryIds((prev) => new Set([...prev, msgId]));
      toast.success("Saved to persistent NEXUS Memory");
    } catch (err: any) {
      toast.error(err.message || "Failed to save memory");
    }
  };

  const handleImplementCodeToPlatform = async (codeToInject?: string) => {
    try {
      const code = codeToInject || extractCodeBlock(messages[messages.length - 1]?.content || "");
      if (!code) {
        toast.error("No code block found to implement.");
        return;
      }
      const shell = (window as any).browserShell;
      if (shell?.tabInjectCode) {
        const res = await shell.tabInjectCode(windowId, activeTabId || "", code);
        if (res.success) {
          toast.success(res.message || "Code successfully implemented into platform editor!");
        } else {
          toast.error(res.message || "Failed to inject code into platform editor.");
        }
      } else {
        await navigator.clipboard.writeText(code);
        toast.info("Copied code to clipboard.");
      }
    } catch (err: any) {
      toast.error(`Injection failed: ${err.message}`);
    }
  };

  const handleExecuteAction = async (action: any) => {
    if ((action.type === "start_research" || action.type === "research") && onNavigate) {
      onNavigate("research");
      toast.success("Navigating to Autonomous Research");
    } else if (action.type === "launch_agent" && onNavigate) {
      onNavigate("agent");
      toast.success("Navigating to Autonomous Agent Dispatcher");
    } else if (action.type === "create_workflow" && onNavigate) {
      onNavigate("workflows");
      toast.success("Opening Workflow Canvas");
    } else if (action.type === "implement_code") {
      await handleImplementCodeToPlatform(action.payload?.code);
    } else if (action.type === "save_memory") {
      await handleSaveToMemory("action_card", action.payload?.content || action.description);
    }
  };

  if (!isOpen) return null;

  return (
    <aside className="flex flex-col h-full w-full bg-[#08080c] border-l border-white/5 text-neutral-200 select-none shadow-2xl relative overflow-hidden font-sans">
      {/* TOP HEADER */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-[#0a0a0f]/90 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg bg-violet-600/20 text-violet-400 border border-violet-500/30 flex items-center justify-center shadow-[0_0_12px_rgba(139,92,246,0.3)]">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div>
            <h2 className="text-xs font-semibold text-white tracking-wide">NEXUS Intelligence</h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`w-1.5 h-1.5 rounded-full ${isStreaming ? "bg-amber-400 animate-pulse" : "bg-emerald-400"}`} />
              <span className="text-[10px] font-mono text-neutral-400">
                {isStreaming ? "Working..." : "Ready"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowHistoryDrawer((v) => !v)}
            className={`p-1.5 rounded-lg border transition ${
              showHistoryDrawer
                ? "bg-violet-600/20 text-violet-300 border-violet-500/30"
                : "bg-neutral-900 border-white/5 text-neutral-400 hover:text-white"
            }`}
            title="Conversation history"
          >
            <History className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={startNewConversation}
            className="p-1.5 rounded-lg bg-neutral-900 border border-white/5 text-neutral-400 hover:text-white transition"
            title="New discussion"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition ml-1"
            title="Close dock (Ctrl+J)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* CONVERSATION HISTORY DRAWER (Section 25) */}
      {showHistoryDrawer && (
        <div className="absolute top-12 left-0 right-0 z-30 bg-[#0c0c12]/95 backdrop-blur-xl border-b border-white/10 p-3 max-h-72 overflow-y-auto space-y-2 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between px-1 mb-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-semibold">
              Recent Discussions ({conversations.length})
            </span>
            <button
              type="button"
              onClick={startNewConversation}
              className="text-[10px] text-violet-400 hover:text-violet-300 font-medium"
            >
              + New
            </button>
          </div>

          {conversations.length === 0 ? (
            <div className="text-center py-6 text-xs text-neutral-500">No discussions recorded yet.</div>
          ) : (
            <div className="space-y-1">
              {conversations.map((c) => {
                const isSelected = c.id === currentConversationId;
                return (
                  <div
                    key={c.id}
                    onClick={() => selectConversation(c.id)}
                    className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs cursor-pointer transition ${
                      isSelected
                        ? "bg-violet-600/20 text-violet-300 border border-violet-500/30 font-medium"
                        : "text-neutral-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate min-w-0 pr-2">
                      <Clock className="w-3 h-3 shrink-0 text-neutral-500" />
                      <span className="truncate">{c.title}</span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteConversation(e, c.id)}
                      className="p-1 text-neutral-600 hover:text-rose-400 transition shrink-0"
                      title="Delete discussion"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* CONTEXT BAR (Section 3 & 4) */}
      <div className="px-3.5 py-2 bg-[#0a0a0f]/60 border-b border-white/5 flex flex-wrap items-center gap-1.5 text-xs shrink-0">
        {/* Active Page Chip */}
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-950 border border-white/5 text-[11px] text-neutral-300 max-w-full truncate"
          title={activeUrl}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
          <span className="font-mono text-neutral-500 text-[10px] uppercase shrink-0">Page</span>
          <span className="truncate font-medium">{activeTitle || activeUrl || "nexus://start"}</span>
        </div>

        {/* Selected Text Context Chip */}
        {selectedText && (
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-950/40 border border-violet-500/30 text-[11px] text-violet-300 animate-in fade-in duration-150">
            <Sparkles className="w-3 h-3 text-violet-400 shrink-0" />
            <span className="font-mono text-[10px] uppercase shrink-0">Selection</span>
            <span className="truncate max-w-[140px] italic">"{selectedText}"</span>
          </div>
        )}
      </div>

      {/* MESSAGE STREAM */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs leading-relaxed">
        {messages.length === 0 && !streamingText ? (
          /* EMPTY ENTRY STATE (Section 3) */
          <div className="py-8 flex flex-col items-center text-center max-w-xs mx-auto space-y-4">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-600/20 to-cyan-500/20 border border-violet-500/30 flex items-center justify-center text-violet-400 shadow-[0_0_20px_rgba(139,92,246,0.15)]">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">NEXUS Intelligence</h3>
              <p className="text-xs text-neutral-400 mt-1">What would you like to know?</p>
            </div>

            {/* Quick Contextual Actions based on Active URL */}
            <div className="w-full space-y-1.5 pt-2">
              {(isCodingPlatform
                ? [
                    "⚡ Solve Question & Implement to Editor",
                    "Explain Optimal Time & Space Complexity",
                    "Generate Python3 Optimal Solution",
                    "Debug & Fix Current Solution",
                  ]
                : isGitHub
                ? [
                    "Explain repository architecture",
                    "Analyze key components & patterns",
                    "Find top open issues & technical debt",
                  ]
                : isResearch
                ? [
                    "Summarize core hypothesis & results",
                    "Explain methodology and architecture",
                    "Extract dataset benchmarks",
                  ]
                : [
                    "Summarize this page",
                    "Explain the core concept",
                    "Extract key takeaways & facts",
                    "Research this topic in depth",
                  ]
              ).map((chip, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSendMessage(chip)}
                  className="w-full text-left px-3 py-2 rounded-xl bg-neutral-900/60 hover:bg-violet-600/15 border border-white/5 hover:border-violet-500/30 text-xs text-neutral-300 hover:text-white transition group flex items-center justify-between"
                >
                  <span>{chip}</span>
                  <Sparkles className="w-3 h-3 text-neutral-600 group-hover:text-violet-400 transition" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => {
            const isUser = m.role === "user";
            const isSaved = savedMemoryIds.has(m.id);
            const { thought, answer } = parseThinkTags(m.content);

            return (
              <div
                key={m.id}
                className={`group flex flex-col ${isUser ? "items-end" : "items-start"} space-y-1`}
              >
                {/* Message Header */}
                <div className="flex items-center gap-1.5 px-1 text-[10px] text-neutral-500 font-mono">
                  <span>{isUser ? "YOU" : "NEXUS"}</span>
                  {m.model && <span className="text-neutral-600">• {m.model}</span>}
                </div>

                {/* Message Bubble */}
                <div
                  className={`p-3.5 rounded-2xl max-w-[92%] leading-relaxed ${
                    isUser
                      ? "bg-violet-600 text-white rounded-tr-sm shadow-md"
                      : m.status === "failed"
                      ? "bg-rose-950/20 border border-rose-500/30 text-rose-200 rounded-tl-sm w-full shadow-lg"
                      : "bg-[#0e0e14] border border-white/5 text-neutral-200 rounded-tl-sm w-full shadow-lg"
                  }`}
                >
                  {isUser ? (
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  ) : (
                    <>
                      {/* Thought process block if present */}
                      {(thought || m.metadata?.thinkingDuration) && (
                        <NexusThinkingBlock
                          isThinking={false}
                          durationMs={(m.metadata?.thinkingDuration as number) || 2400}
                          thoughtText={thought}
                        />
                      )}

                      <div className="prose prose-invert prose-neutral text-xs leading-relaxed max-w-none break-words">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer || m.content}</ReactMarkdown>
                      </div>

                      {/* Retry Button if message failed */}
                      {m.status === "failed" && (
                        <div className="pt-2.5 mt-2 border-t border-rose-500/20 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const lastUser = [...messages].reverse().find((x) => x.role === "user");
                              if (lastUser) handleSendMessage(lastUser.content);
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition shadow-md shadow-violet-600/30"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Retry Generation</span>
                          </button>
                        </div>
                      )}
                    </>
                  )}

                  {/* Contextual Action Card if detected */}
                  {m.metadata?.suggestedAction && (
                    <div className="mt-3 p-3 rounded-xl bg-[#09090e] border border-violet-500/30 space-y-2">
                      <div className="flex items-center gap-2 text-violet-300 font-semibold text-xs">
                        <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                        <span>{m.metadata.suggestedAction.title}</span>
                      </div>
                      <p className="text-[11px] text-neutral-400 leading-normal">
                        {m.metadata.suggestedAction.description}
                      </p>
                      <button
                        type="button"
                        onClick={() => handleExecuteAction(m.metadata?.suggestedAction)}
                        className="w-full py-1.5 px-3 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition shadow-sm"
                      >
                        {m.metadata.suggestedAction.type === "start_research" || m.metadata.suggestedAction.type === "research" ? (
                          <Microscope className="w-3 h-3" />
                        ) : m.metadata.suggestedAction.type === "launch_agent" ? (
                          <Bot className="w-3 h-3" />
                        ) : m.metadata.suggestedAction.type === "create_workflow" ? (
                          <Workflow className="w-3 h-3" />
                        ) : (
                          <Bookmark className="w-3 h-3" />
                        )}
                        <span>Launch Execution</span>
                      </button>
                    </div>
                  )}

                  {/* Assistant Action Bar (Section 32) */}
                  {!isUser && (
                    <div className="flex items-center justify-between gap-2 pt-2.5 mt-2 border-t border-white/5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <div>
                        {extractCodeBlock(m.content) && (
                          <button
                            type="button"
                            onClick={() => handleImplementCodeToPlatform(extractCodeBlock(m.content)!)}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-[11px] font-semibold transition"
                            title="Directly implement this solution code into active platform editor"
                          >
                            <Zap className="w-3.5 h-3.5 text-amber-300" />
                            <span>⚡ Implement to Editor</span>
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleCopyMessage(m.id, answer || m.content)}
                          className="flex items-center gap-1 text-[10px] text-neutral-400 hover:text-white transition"
                          title="Copy text"
                        >
                          {copiedId === m.id ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span>{copiedId === m.id ? "Copied" : "Copy"}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleSaveToMemory(m.id, answer || m.content)}
                          disabled={isSaved}
                          className={`flex items-center gap-1 text-[10px] transition ${
                            isSaved
                              ? "text-emerald-400 font-medium"
                              : "text-neutral-400 hover:text-violet-300"
                          }`}
                          title="Persist to PostgreSQL Memory"
                        >
                          {isSaved ? (
                            <CheckCircle2 className="w-3 h-3" />
                          ) : (
                            <Bookmark className="w-3 h-3" />
                          )}
                          <span>{isSaved ? "Saved" : "Save to Memory"}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

        {/* LIVE STREAMING RESPONSE */}
        {isStreaming && (
          <div className="flex flex-col items-start space-y-1 animate-in fade-in duration-150">
            <div className="flex items-center gap-1.5 px-1 text-[10px] text-neutral-500 font-mono">
              <Sparkles className="w-3 h-3 text-violet-400 animate-spin" />
              <span>{streamingStatus || "✦ Synthesizing response..."}</span>
            </div>

            <div className="p-3.5 rounded-2xl bg-[#0e0e14] border border-violet-500/30 text-neutral-200 rounded-tl-sm w-full shadow-lg">
              {/* Modern Thinking Block */}
              <NexusThinkingBlock
                isThinking={!streamingText || (parseThinkTags(streamingText).isThinkingStill ?? false)}
                thoughtText={parseThinkTags(streamingText).thought}
                currentPhase={currentThinkingPhase}
                phases={thinkingPhases}
                durationMs={thinkingDuration}
              />

              {parseThinkTags(streamingText).answer ? (
                <div className="prose prose-invert prose-neutral text-xs leading-relaxed max-w-none break-words">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{parseThinkTags(streamingText).answer}</ReactMarkdown>
                </div>
              ) : (
                !parseThinkTags(streamingText).thought && (
                  <div className="flex items-center gap-2 text-xs text-neutral-400 py-1.5">
                    <span className="w-2 h-2 rounded-full bg-violet-400 animate-ping" />
                    <span>{currentThinkingPhase || "Synthesizing response..."}</span>
                  </div>
                )
              )}

              {activeActionCard && (
                <div className="mt-3 p-3 rounded-xl bg-[#09090e] border border-violet-500/30 space-y-1.5">
                  <span className="text-xs font-semibold text-violet-300 flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3 text-violet-400" />
                    {activeActionCard.title}
                  </span>
                  <p className="text-[11px] text-neutral-400">{activeActionCard.description}</p>
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* COMPOSER BAR */}
      <div className="p-3 border-t border-white/5 bg-[#0a0a0f]/90 shrink-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex flex-col bg-neutral-950 border border-white/10 rounded-2xl p-2.5 focus-within:border-violet-500/60 focus-within:ring-2 focus-within:ring-violet-500/20 transition-all shadow-inner"
        >
          <textarea
            ref={textareaRef}
            rows={2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder={
              selectedText
                ? "Ask about selected text or page..."
                : "Ask NEXUS anything about this page..."
            }
            className="w-full bg-transparent text-xs text-neutral-100 placeholder-neutral-500 outline-none resize-none leading-relaxed"
          />

          <div className="flex items-center justify-between pt-2 border-t border-white/5 mt-1">
            <div className="flex items-center gap-1 text-[10px] text-neutral-500 font-mono">
              <span>Enter to send</span>
              <span>•</span>
              <span>Shift+Enter for newline</span>
            </div>

            {isStreaming ? (
              <button
                type="button"
                onClick={handleStopGeneration}
                className="flex items-center gap-1 px-3 py-1 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-xs font-medium transition"
                title="Stop generation"
              >
                <Square className="w-3 h-3 fill-rose-300" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!prompt.trim() || isStreaming}
                className="p-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-25 transition-all shadow-md shadow-violet-600/30"
                title="Send to NEXUS"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </form>
      </div>
    </aside>
  );
};
