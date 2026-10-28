import React, { useState, useEffect, useRef } from "react";
import {
  Camera,
  Sparkles,
  Download,
  Copy,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Trash2,
  Globe,
  Loader2,
  Check,
  Eye,
  FileImage,
  Layers,
  Activity,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Sliders,
  Send,
  HelpCircle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  capturesApi,
  type WebCaptureItem,
  type CaptureAnalysisItem,
} from "@/lib/nexus/captures.api";
import { useToast } from "./NexusToast";

interface NexusPictureStudioViewProps {
  workspaceId?: string | null;
  onOpenInBrowser?: (url: string, title?: string) => void;
}

const VIEWPORT_PRESETS = [
  { label: "Desktop", width: 1920, height: 1080 },
  { label: "Laptop", width: 1440, height: 900 },
  { label: "Tablet", width: 768, height: 1024 },
  { label: "Mobile", width: 390, height: 844 },
];

type FrameStyle = "browser" | "window" | "clean" | "raw";

export const NexusPictureStudioView: React.FC<NexusPictureStudioViewProps> = ({
  workspaceId,
  onOpenInBrowser,
}) => {
  const toast = useToast();

  const [url, setUrl] = useState<string>("https://news.ycombinator.com");
  const [selectedPreset, setSelectedPreset] = useState<string>("Laptop");
  const [viewportWidth, setViewportWidth] = useState<number>(1440);
  const [viewportHeight, setViewportHeight] = useState<number>(900);
  const [fullPage, setFullPage] = useState<boolean>(false);
  const [frameStyle, setFrameStyle] = useState<FrameStyle>("browser");

  // Capture State
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [currentCapture, setCurrentCapture] = useState<WebCaptureItem | null>(null);
  const [savedCaptures, setSavedCaptures] = useState<WebCaptureItem[]>([]);
  const [zoomScale, setZoomScale] = useState<number>(1.0);

  // Vision Analysis State
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [currentAnalysis, setCurrentAnalysis] = useState<CaptureAnalysisItem | null>(null);
  const [analysisPrompt, setAnalysisPrompt] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"telemetry" | "analysis" | "headings">("telemetry");

  // Load saved captures on mount
  useEffect(() => {
    loadCaptures();
  }, [workspaceId]);

  const loadCaptures = async () => {
    try {
      const list = await capturesApi.getCaptures(workspaceId || undefined);
      setSavedCaptures(list);
      if (list.length > 0 && !currentCapture) {
        setCurrentCapture(list[0]);
        if (list[0].analyses && list[0].analyses.length > 0) {
          setCurrentAnalysis(list[0].analyses[0]);
        }
      }
    } catch (err: any) {
      console.warn("Could not load captures:", err.message);
    }
  };

  // Execute real Playwright screenshot capture
  const handleCapture = async () => {
    if (!url.trim() || isCapturing) return;
    setIsCapturing(true);
    setCurrentAnalysis(null);

    try {
      const capture = await capturesApi.createCapture({
        url: url.trim(),
        width: viewportWidth,
        height: viewportHeight,
        fullPage,
        workspaceId: workspaceId || undefined,
      });

      setCurrentCapture(capture);
      setZoomScale(1.0);
      toast.success(`Captured ${capture.width}×${capture.height} screenshot in ${capture.durationMs}ms`);
      await loadCaptures();
    } catch (err: any) {
      toast.error(`Capture failed: ${err.message}`);
    } finally {
      setIsCapturing(false);
    }
  };

  // Run AI Vision Analysis
  const handleAnalyzeVision = async () => {
    if (!currentCapture || isAnalyzing) return;
    setIsAnalyzing(true);
    setActiveTab("analysis");

    try {
      const analysis = await capturesApi.analyzeCapture(currentCapture.id, analysisPrompt || undefined);
      setCurrentAnalysis(analysis);
      setAnalysisPrompt("");
      toast.success("Multimodal AI Vision analysis complete.");
      await loadCaptures();
    } catch (err: any) {
      toast.error(`Vision analysis failed: ${err.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Download image PNG
  const handleDownload = () => {
    if (!currentCapture) return;
    const a = document.createElement("a");
    a.href = currentCapture.publicUrl;
    a.download = `nexus_capture_${currentCapture.id.slice(0, 8)}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success("Downloading lossless PNG screenshot.");
  };

  // Copy image to clipboard
  const handleCopyImage = async () => {
    if (!currentCapture) return;
    try {
      const res = await fetch(currentCapture.publicUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      toast.success("Copied screenshot to clipboard.");
    } catch {
      // Fallback: copy image URL
      await navigator.clipboard.writeText(window.location.origin + currentCapture.publicUrl);
      toast.info("Copied image link to clipboard.");
    }
  };

  // Delete capture
  const handleDeleteCapture = async (id: string) => {
    try {
      await capturesApi.deleteCapture(id);
      toast.info("Capture deleted.");
      if (currentCapture?.id === id) {
        setCurrentCapture(null);
        setCurrentAnalysis(null);
      }
      await loadCaptures();
    } catch (err: any) {
      toast.error(`Delete failed: ${err.message}`);
    }
  };

  return (
    <div className="flex h-full w-full bg-[#050507] text-neutral-100 overflow-hidden font-sans select-none">
      {/* ============================================================ */}
      {/* LEFT SIDEBAR: SAVED CAPTURES & CONTROLS (320px) */}
      {/* ============================================================ */}
      <div className="w-[320px] flex-shrink-0 border-r border-white/5 bg-[#08080d] flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-cyan-600/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white tracking-wide">Picture Studio</h2>
              <p className="text-[10px] text-neutral-400">Headless Chromium & Vision</p>
            </div>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-mono">
            Playwright
          </span>
        </div>

        {/* Capture Input Form */}
        <div className="p-4 border-b border-white/5 space-y-4 text-xs">
          <div>
            <label className="block text-[11px] font-medium text-neutral-300 mb-1.5 uppercase tracking-wider">
              Target Webpage URL
            </label>
            <div className="relative">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
                className="w-full bg-neutral-900/80 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-neutral-200 text-xs focus:outline-none focus:border-cyan-500"
              />
              <Globe className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-2.5" />
            </div>
          </div>

          {/* Viewport Presets */}
          <div>
            <label className="block text-[11px] font-medium text-neutral-300 mb-1.5 uppercase tracking-wider">
              Viewport Dimensions
            </label>
            <div className="grid grid-cols-2 gap-1.5 mb-2">
              {VIEWPORT_PRESETS.map((vp) => (
                <button
                  key={vp.label}
                  onClick={() => {
                    setSelectedPreset(vp.label);
                    setViewportWidth(vp.width);
                    setViewportHeight(vp.height);
                  }}
                  className={`px-2.5 py-1.5 rounded-lg border text-left text-[11px] transition-colors ${
                    selectedPreset === vp.label
                      ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-200 font-medium"
                      : "bg-white/5 border-white/5 text-neutral-400 hover:text-white"
                  }`}
                >
                  <div className="font-semibold">{vp.label}</div>
                  <div className="text-[9px] text-neutral-500 font-mono">
                    {vp.width}×{vp.height}
                  </div>
                </button>
              ))}
            </div>

            <label className="flex items-center gap-2 cursor-pointer text-[11px] text-neutral-400 hover:text-neutral-200 pt-1">
              <input
                type="checkbox"
                checked={fullPage}
                onChange={(e) => setFullPage(e.target.checked)}
                className="rounded border-white/20 bg-neutral-900 text-cyan-600 focus:ring-0"
              />
              Capture entire scrollable page (Full Page)
            </label>
          </div>

          {/* Showcase Frame Selector */}
          <div>
            <label className="block text-[11px] font-medium text-neutral-300 mb-1.5 uppercase tracking-wider">
              Showcase Frame
            </label>
            <div className="grid grid-cols-4 gap-1 text-[10px]">
              {(
                [
                  { id: "browser", label: "Browser" },
                  { id: "window", label: "Window" },
                  { id: "clean", label: "Studio" },
                  { id: "raw", label: "Raw" },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFrameStyle(f.id)}
                  className={`py-1.5 rounded-md border text-center transition-colors ${
                    frameStyle === f.id
                      ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-200 font-medium"
                      : "bg-white/5 border-white/5 text-neutral-400 hover:text-white"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Capture Trigger Button */}
          <button
            onClick={handleCapture}
            disabled={isCapturing || !url.trim()}
            className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium text-xs flex items-center justify-center gap-2 shadow-lg shadow-cyan-900/20 disabled:opacity-50 transition-all cursor-pointer"
          >
            {isCapturing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Capturing Rendered DOM...
              </>
            ) : (
              <>
                <Camera className="w-3.5 h-3.5" />
                Capture Webpage
              </>
            )}
          </button>
        </div>

        {/* Saved Captures List */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-4 py-2 text-[10px] uppercase font-semibold text-neutral-400 tracking-wider border-b border-white/5">
            Saved Captures ({savedCaptures.length})
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {savedCaptures.length === 0 ? (
              <p className="text-center text-neutral-500 text-xs py-8 italic">
                No captures yet. Enter a URL above and click Capture.
              </p>
            ) : (
              savedCaptures.map((c) => (
                <div
                  key={c.id}
                  onClick={() => {
                    setCurrentCapture(c);
                    if (c.analyses && c.analyses.length > 0) {
                      setCurrentAnalysis(c.analyses[0]);
                    } else {
                      setCurrentAnalysis(null);
                    }
                  }}
                  className={`p-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition-colors ${
                    currentCapture?.id === c.id
                      ? "bg-cyan-950/40 border-cyan-500/40 text-white"
                      : "bg-white/5 border-white/5 text-neutral-300 hover:bg-white/10"
                  }`}
                >
                  <div className="truncate mr-2">
                    <p className="text-xs font-medium truncate">{c.title}</p>
                    <p className="text-[10px] text-neutral-500 truncate">{c.url}</p>
                    <p className="text-[9px] text-neutral-600 font-mono mt-0.5">
                      {c.width}×{c.height} · {(c.fileSize / 1024).toFixed(0)} KB · {new Date(c.createdAt).toLocaleTimeString()}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteCapture(c.id);
                    }}
                    className="p-1 rounded hover:bg-red-500/20 text-neutral-500 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* CENTER REGION: SCREENSHOT PREVIEW CANVAS */}
      {/* ============================================================ */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#07070b]">
        {/* Canvas Toolbar */}
        <div className="h-11 border-b border-white/5 px-4 flex items-center justify-between bg-[#08080d]/80 backdrop-blur">
          <div className="flex items-center gap-3 text-xs">
            {currentCapture ? (
              <>
                <span className="font-semibold text-neutral-200 truncate max-w-sm">
                  {currentCapture.title}
                </span>
                <span className="text-[10px] text-neutral-400 font-mono">
                  {currentCapture.width}×{currentCapture.height} px
                </span>
                <span className="text-[10px] text-neutral-500 font-mono">
                  {(currentCapture.fileSize / 1024).toFixed(1)} KB
                </span>
              </>
            ) : (
              <span className="text-neutral-500 italic">No image loaded</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Zoom Controls */}
            <div className="flex items-center gap-1 bg-white/5 border border-white/5 rounded-lg p-0.5 text-xs text-neutral-300">
              <button
                onClick={() => setZoomScale(Math.max(0.25, zoomScale - 0.1))}
                className="p-1 rounded hover:bg-white/10"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="font-mono text-[11px] px-1">{Math.round(zoomScale * 100)}%</span>
              <button
                onClick={() => setZoomScale(Math.min(2.5, zoomScale + 0.1))}
                className="p-1 rounded hover:bg-white/10"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setZoomScale(1.0)}
                className="px-1.5 py-0.5 text-[10px] text-neutral-400 hover:text-white"
              >
                100%
              </button>
            </div>

            {/* Actions */}
            {currentCapture && (
              <>
                <button
                  onClick={handleCopyImage}
                  className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 text-xs flex items-center gap-1.5 border border-white/5"
                  title="Copy image to clipboard"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Copy
                </button>
                <button
                  onClick={handleDownload}
                  className="px-2.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium flex items-center gap-1.5 shadow-md shadow-cyan-950/40"
                  title="Download PNG"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download PNG
                </button>
              </>
            )}
          </div>
        </div>

        {/* Showcase Frame & Image Canvas */}
        <div className="flex-1 overflow-auto p-8 flex items-center justify-center bg-[#050507]">
          {currentCapture ? (
            <div
              style={{
                transform: `scale(${zoomScale})`,
                transformOrigin: "center center",
                transition: "transform 0.15s ease",
              }}
              className="max-w-full"
            >
              {/* Frame: Browser */}
              {frameStyle === "browser" && (
                <div className="rounded-xl overflow-hidden border border-white/10 shadow-2xl shadow-black/80 bg-neutral-900">
                  <div className="h-8 bg-neutral-950/90 border-b border-white/10 px-3 flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                      <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                    </div>
                    <div className="flex-1 mx-6 bg-neutral-900 border border-white/5 rounded-md px-3 py-0.5 text-[10px] text-neutral-400 font-mono truncate text-center">
                      {currentCapture.url}
                    </div>
                  </div>
                  <img
                    src={currentCapture.publicUrl}
                    alt={currentCapture.title}
                    className="block max-w-full max-h-[70vh] object-contain"
                  />
                </div>
              )}

              {/* Frame: Window */}
              {frameStyle === "window" && (
                <div className="rounded-2xl overflow-hidden border border-white/15 shadow-2xl shadow-cyan-950/30 bg-neutral-950 p-2">
                  <img
                    src={currentCapture.publicUrl}
                    alt={currentCapture.title}
                    className="block rounded-xl max-w-full max-h-[70vh] object-contain"
                  />
                </div>
              )}

              {/* Frame: Clean Studio */}
              {frameStyle === "clean" && (
                <div className="p-8 rounded-2xl bg-gradient-to-tr from-neutral-900/60 to-cyan-950/20 border border-white/10 shadow-2xl">
                  <img
                    src={currentCapture.publicUrl}
                    alt={currentCapture.title}
                    className="block rounded-lg shadow-xl max-w-full max-h-[65vh] object-contain"
                  />
                </div>
              )}

              {/* Frame: Raw */}
              {frameStyle === "raw" && (
                <img
                  src={currentCapture.publicUrl}
                  alt={currentCapture.title}
                  className="block max-w-full max-h-[75vh] object-contain border border-white/5"
                />
              )}
            </div>
          ) : (
            <div className="text-center text-neutral-500">
              <Camera className="w-12 h-12 mx-auto text-neutral-700 mb-3" />
              <p className="text-sm font-medium text-neutral-400">No Webpage Captured</p>
              <p className="text-xs text-neutral-600 mt-1 max-w-sm">
                Enter any public URL on the left panel to trigger headless Playwright Chromium capture.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ============================================================ */}
      {/* RIGHT SIDEBAR: LIVE TELEMETRY & MULTIMODAL AI VISION (380px) */}
      {/* ============================================================ */}
      <div className="w-[380px] flex-shrink-0 border-l border-white/5 bg-[#08080d] flex flex-col h-full overflow-hidden">
        {/* Navigation Tabs */}
        <div className="h-11 border-b border-white/5 px-4 flex items-center justify-between bg-[#06060a]">
          <div className="flex items-center gap-3 text-xs font-medium">
            <button
              onClick={() => setActiveTab("telemetry")}
              className={`py-2 border-b-2 flex items-center gap-1.5 ${
                activeTab === "telemetry"
                  ? "border-cyan-500 text-white"
                  : "border-transparent text-neutral-400 hover:text-white"
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              Telemetry
            </button>
            <button
              onClick={() => setActiveTab("analysis")}
              className={`py-2 border-b-2 flex items-center gap-1.5 ${
                activeTab === "analysis"
                  ? "border-cyan-500 text-white"
                  : "border-transparent text-neutral-400 hover:text-white"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              AI Vision
            </button>
            <button
              onClick={() => setActiveTab("headings")}
              className={`py-2 border-b-2 flex items-center gap-1.5 ${
                activeTab === "headings"
                  ? "border-cyan-500 text-white"
                  : "border-transparent text-neutral-400 hover:text-white"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              DOM Tree
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {activeTab === "telemetry" && (
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-neutral-900/60 border border-white/5 space-y-2">
                <span className="text-[10px] uppercase font-semibold text-neutral-400 tracking-wider">
                  Network & Protocol
                </span>
                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                  <div>
                    <span className="text-neutral-500 block text-[9px]">Protocol</span>
                    <span className="text-cyan-400">
                      {currentCapture?.telemetry?.protocol?.toUpperCase() || "HTTPS"}
                    </span>
                  </div>
                  <div>
                    <span className="text-neutral-500 block text-[9px]">Status</span>
                    <span className="text-emerald-400">
                      HTTP {currentCapture?.telemetry?.statusCode || 200} OK
                    </span>
                  </div>
                  <div>
                    <span className="text-neutral-500 block text-[9px]">Capture Duration</span>
                    <span className="text-neutral-200">
                      {currentCapture?.durationMs || 0} ms
                    </span>
                  </div>
                  <div>
                    <span className="text-neutral-500 block text-[9px]">File Size</span>
                    <span className="text-neutral-200">
                      {currentCapture ? (currentCapture.fileSize / 1024).toFixed(1) : 0} KB
                    </span>
                  </div>
                </div>
              </div>

              {/* Resolution Metrics */}
              <div className="p-3 rounded-xl bg-neutral-900/60 border border-white/5 space-y-2">
                <span className="text-[10px] uppercase font-semibold text-neutral-400 tracking-wider">
                  Dimensions & Rendering
                </span>
                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                  <div>
                    <span className="text-neutral-500 block text-[9px]">Raster Width</span>
                    <span className="text-neutral-200">{currentCapture?.width || 0} px</span>
                  </div>
                  <div>
                    <span className="text-neutral-500 block text-[9px]">Raster Height</span>
                    <span className="text-neutral-200">{currentCapture?.height || 0} px</span>
                  </div>
                  <div>
                    <span className="text-neutral-500 block text-[9px]">Hyperlinks</span>
                    <span className="text-cyan-400">{currentCapture?.telemetry?.linkCount || 0}</span>
                  </div>
                  <div>
                    <span className="text-neutral-500 block text-[9px]">DOM Images</span>
                    <span className="text-cyan-400">{currentCapture?.telemetry?.imageCount || 0}</span>
                  </div>
                </div>
              </div>

              {/* Page Title & Canonical */}
              <div className="p-3 rounded-xl bg-neutral-900/60 border border-white/5 space-y-1.5">
                <span className="text-[10px] uppercase font-semibold text-neutral-400 tracking-wider">
                  Page Identity
                </span>
                <p className="text-xs font-semibold text-neutral-200">
                  {currentCapture?.title || "No page loaded"}
                </p>
                <p className="text-[10px] text-neutral-500 font-mono truncate">
                  {currentCapture?.resolvedUrl || currentCapture?.url}
                </p>
              </div>

              {/* Text Excerpt */}
              {currentCapture?.excerpt && (
                <div className="p-3 rounded-xl bg-neutral-900/60 border border-white/5 space-y-1.5">
                  <span className="text-[10px] uppercase font-semibold text-neutral-400 tracking-wider">
                    Extracted Text Excerpt
                  </span>
                  <p className="text-[11px] text-neutral-300 leading-relaxed font-mono line-clamp-6">
                    "{currentCapture.excerpt}"
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === "analysis" && (
            <div className="space-y-4">
              {/* Trigger Vision Analysis Button */}
              <button
                onClick={handleAnalyzeVision}
                disabled={isAnalyzing || !currentCapture}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500 text-white font-medium text-xs flex items-center justify-center gap-2 shadow-lg shadow-violet-900/20 disabled:opacity-50 transition-all cursor-pointer"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Analyzing Visual Hierarchy...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    Analyze with AI Vision
                  </>
                )}
              </button>

              {/* Analysis Result Display */}
              {currentAnalysis ? (
                <div className="p-3 rounded-xl bg-neutral-900/70 border border-white/5 space-y-2">
                  <div className="flex items-center justify-between pb-2 border-b border-white/5">
                    <span className="text-[10px] text-violet-400 font-mono">
                      {currentAnalysis.model}
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(currentAnalysis.content);
                        toast.success("Analysis copied.");
                      }}
                      className="text-[10px] text-neutral-400 hover:text-white flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" /> Copy
                    </button>
                  </div>
                  <div className="prose prose-invert prose-xs max-w-none text-neutral-200">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {currentAnalysis.content}
                    </ReactMarkdown>
                  </div>
                </div>
              ) : (
                <p className="text-center text-neutral-500 text-xs py-6 italic">
                  Click "Analyze with AI Vision" to inspect layout, color contrast, and UX hierarchy.
                </p>
              )}
            </div>
          )}

          {activeTab === "headings" && (
            <div className="space-y-2">
              <span className="text-[10px] uppercase font-semibold text-neutral-400 tracking-wider">
                DOM Headings Hierarchy
              </span>
              {currentCapture?.headings && currentCapture.headings.length > 0 ? (
                currentCapture.headings.map((h, i) => (
                  <div
                    key={i}
                    className="p-2 rounded-lg bg-neutral-900/50 border border-white/5 text-[11px] font-mono text-neutral-300"
                  >
                    {h}
                  </div>
                ))
              ) : (
                <p className="text-center text-neutral-500 text-xs py-6 italic">
                  No headings extracted from this capture.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
