import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bot, Globe, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BrowserTabState } from "@/types/browser";

interface BrowserTabButtonProps {
  active: boolean;
  activeBackgroundMode?: "self" | "shared";
  automationLabel?: string;
  className?: string;
  collapsed?: boolean;
  draggable?: boolean;
  dropIndicator?: "before" | "after" | null;
  indicatorIcon?: ReactNode;
  isDragging?: boolean;
  isLight?: boolean;
  tab: BrowserTabState;
  onClose: () => void;
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void;
  onDragEnd?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragStart?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
  onSelect: () => void;
}

function buildTabFaviconFallbackUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return new URL("/favicon.ico", parsed.origin).toString();
  } catch {
    return undefined;
  }
}

export function BrowserTabButton({
  active,
  activeBackgroundMode = "self",
  automationLabel,
  className,
  collapsed = false,
  draggable = false,
  dropIndicator = null,
  indicatorIcon,
  isDragging = false,
  isLight = false,
  tab,
  onClose,
  onContextMenu,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onSelect,
}: BrowserTabButtonProps) {
  const fallbackFavicon = useMemo(() => buildTabFaviconFallbackUrl(tab.url), [tab.url]);
  const [faviconSrc, setFaviconSrc] = useState<string | undefined>(tab.favicon ?? fallbackFavicon);

  useEffect(() => {
    setFaviconSrc(tab.favicon ?? fallbackFavicon);
  }, [fallbackFavicon, tab.favicon, tab.id]);

  const usesSharedActiveBackground = active && activeBackgroundMode === "shared";

  const iconClassName = cn(
    "h-3.5 w-3.5",
    collapsed && active ? "transition-opacity duration-150 group-hover:opacity-0" : "",
    tab.isLoading ? (isLight ? "text-sky-600" : "text-sky-300") : "",
  );

  return (
    <div
      className={cn(
        "group relative flex w-full min-w-0 max-w-full select-none items-center overflow-hidden rounded-lg px-1.5 py-1 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60",
        draggable ? "cursor-default" : "cursor-pointer",
        collapsed ? "justify-center" : "gap-2",
        !collapsed && tab.manualInterventionMessage ? "py-1.5" : "",
        isDragging ? "scale-[0.985] opacity-45" : "",
        dropIndicator === "before"
          ? "before:pointer-events-none before:absolute before:left-2 before:right-2 before:top-0 before:h-0.5 before:rounded-full before:bg-sky-500/90"
          : "",
        dropIndicator === "after"
          ? "after:pointer-events-none after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:rounded-full after:bg-sky-500/90"
          : "",
        isLight
          ? active && !collapsed
            ? usesSharedActiveBackground
              ? "bg-transparent text-black/85"
              : "bg-black/10 text-black/80 shadow-sm"
            : "bg-transparent text-black/55 hover:bg-black/5 hover:text-black/80"
          : active && !collapsed
            ? usesSharedActiveBackground
              ? "bg-transparent text-white"
              : "bg-white/10 text-white shadow-sm"
            : "bg-transparent text-white/50 hover:bg-white/5 hover:text-white/80",
        className,
      )}
      draggable={draggable}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onDragEnd={(event) => {
        event.stopPropagation();
        onDragEnd?.(event);
      }}
      onDragOver={(event) => {
        event.stopPropagation();
        onDragOver?.(event);
      }}
      onDragStart={(event) => {
        event.stopPropagation();
        onDragStart?.(event);
      }}
      onDrop={(event) => {
        event.stopPropagation();
        onDrop?.(event);
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        event.stopPropagation();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onContextMenu?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          onSelect();
        }
      }}
      role="button"
      tabIndex={0}
    >
      {/* Icon */}
      <div className={cn(
        "relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md",
        active && !collapsed ? (isLight ? "bg-black/10" : "bg-white/10") : "",
        tab.isLoading ? (isLight ? "bg-sky-500/10" : "bg-sky-400/10") : "",
      )}>
        {faviconSrc ? (
          <img
            alt=""
            className={cn(iconClassName, "object-contain")}
            draggable={false}
            src={faviconSrc}
            onError={() => {
              if (faviconSrc !== fallbackFavicon && fallbackFavicon) {
                setFaviconSrc(fallbackFavicon);
                return;
              }
              setFaviconSrc(undefined);
            }}
          />
        ) : tab.isLoading ? (
          <LoaderCircle className={cn(iconClassName, "animate-spin")} />
        ) : (
          <Globe className={iconClassName} />
        )}
        {tab.manualInterventionMessage ? (
          <span
            className={cn(
              "absolute bottom-0 right-0 flex h-3.5 w-3.5 items-center justify-center rounded-full shadow-sm",
              isLight ? "bg-amber-50 text-amber-600" : "bg-zinc-950 text-amber-300",
            )}
            title={tab.manualInterventionMessage}
          >
            <TriangleAlert className="h-2.5 w-2.5" />
          </span>
        ) : tab.isLoading && faviconSrc ? (
          <span
            className={cn(
              "absolute bottom-0 right-0 flex h-3 w-3 items-center justify-center rounded-full",
              isLight ? "bg-white/85 text-sky-600" : "bg-zinc-950/85 text-sky-300",
            )}
          >
            <LoaderCircle className="h-2.5 w-2.5 animate-spin" />
          </span>
        ) : null}
        {indicatorIcon ? (
          <span
            className={cn(
              "pointer-events-none absolute right-0 top-0 flex h-3.5 w-3.5 items-center justify-center rounded-full shadow-sm",
              isLight ? "bg-white/90 text-sky-700" : "bg-zinc-950/88 text-sky-300",
            )}
          >
            {indicatorIcon}
          </span>
        ) : null}
        {/* Close button (collapsed mode) */}
        {collapsed && active && (
          <button
            className={cn(
              "pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100",
              isLight ? "text-black/60 hover:text-black/85" : "text-white/75 hover:text-white",
            )}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) {
                return;
              }
              e.preventDefault();
              e.stopPropagation();
            }}
            onMouseDown={(e) => {
              if (e.button !== 0) {
                return;
              }
              e.preventDefault();
              e.stopPropagation();
            }}
            type="button"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Title */}
      {!collapsed && (
        <div className="w-0 min-w-0 flex-1 overflow-hidden">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 overflow-hidden">
              <span className="block min-w-0 truncate text-left text-[13px] font-medium leading-5">
                {tab.title}
              </span>
              {tab.manualInterventionMessage ? (
                <span
                  className={cn(
                    "mt-1 inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium leading-4",
                    isLight
                      ? "border-amber-500/30 bg-amber-500/10 text-amber-700"
                      : "border-amber-300/25 bg-amber-400/10 text-amber-200",
                  )}
                  title={tab.manualInterventionMessage}
                >
                  <TriangleAlert className="h-2.5 w-2.5 shrink-0" />
                  <span className="truncate">{tab.manualInterventionMessage}</span>
                </span>
              ) : null}
            </div>
            {tab.manualInterventionMessage ? (
              <span
                className={cn(
                  "inline-flex shrink-0 items-center justify-center rounded-full p-0.5",
                  isLight ? "bg-amber-500/12 text-amber-700" : "bg-amber-400/12 text-amber-300",
                )}
                title={tab.manualInterventionMessage}
              >
                <TriangleAlert className="h-3 w-3" />
              </span>
            ) : null}
            {tab.isAutomationControlled ? (
              <span
                className={cn(
                  "inline-flex shrink-0 items-center justify-center rounded-full p-0.5",
                  isLight
                    ? "bg-emerald-500/12 text-emerald-700"
                    : "bg-emerald-400/12 text-emerald-300",
                )}
                title={automationLabel}
              >
                <Bot className="h-3 w-3" />
              </span>
            ) : null}
          </div>
        </div>
      )}

      {/* Close button (expanded mode) */}
      {!collapsed && (
        <button
          className={cn(
            "pointer-events-none flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 transition-[opacity,color,background-color] group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
            isLight
              ? "text-black/50 hover:bg-black/10 hover:text-black/80"
              : "text-white/65 hover:bg-white/10 hover:text-white",
          )}
          aria-label={`Close ${tab.title}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) {
              return;
            }
            e.preventDefault();
            e.stopPropagation();
          }}
          onMouseDown={(e) => {
            if (e.button !== 0) {
              return;
            }
            e.preventDefault();
            e.stopPropagation();
          }}
          type="button"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
