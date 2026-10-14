import { Eye, EyeOff, Globe, Layers3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WindowSummary } from "@/types/workspace";

interface WindowCardProps {
  currentWindowId?: number;
  isShellAvailable: boolean;
  onFocusWindow: (windowId: number) => void;
  windowSummary: WindowSummary;
}

function getWindowStatusLabel(windowSummary: WindowSummary) {
  if (windowSummary.focused) {
    return "Focused";
  }

  if (windowSummary.visible) {
    return "Visible";
  }

  return "Hidden";
}

function getActionLabel(windowSummary: WindowSummary, isCurrent: boolean) {
  if (isCurrent && windowSummary.visible && windowSummary.focused) {
    return "Current window";
  }

  if (windowSummary.visible) {
    return "Focus window";
  }

  return "Show window";
}

export function WindowCard({
  currentWindowId,
  isShellAvailable,
  onFocusWindow,
  windowSummary,
}: WindowCardProps) {
  const isCurrent = currentWindowId === windowSummary.id;
  const disableAction =
    !isShellAvailable || (isCurrent && windowSummary.visible && windowSummary.focused);
  const visibleTabs = windowSummary.tabs.slice(0, 3);

  return (
    <div
      className={cn(
        "rounded-[24px] border p-4 shadow-soft transition-colors",
        isCurrent
          ? "border-sky-300/25 bg-sky-300/10"
          : "border-white/8 bg-background/50 hover:border-white/12",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-card-foreground">
              Window #{windowSummary.id}
            </p>
            {isCurrent ? (
              <span className="rounded-full border border-sky-300/30 bg-sky-300/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.22em] text-sky-100">
                Current
              </span>
            ) : null}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {windowSummary.workspaceName} · profile `{windowSummary.profileId}`
          </p>
        </div>

        <div className="rounded-full border border-white/10 bg-white/6 p-2 text-muted-foreground">
          {windowSummary.visible ? (
            <Eye className="h-4 w-4" />
          ) : (
            <EyeOff className="h-4 w-4" />
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-muted-foreground">
          <Layers3 className="h-3.5 w-3.5" />
          {getWindowStatusLabel(windowSummary)}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-muted-foreground">
          <Globe className="h-3.5 w-3.5" />
          {windowSummary.tabCount} tabs
        </span>
      </div>

      <div className="mt-4 space-y-2">
        {visibleTabs.length > 0 ? (
          visibleTabs.map((tab) => {
            const isActive = tab.id === windowSummary.activeTabId;

            return (
              <div
                key={tab.id}
                className={cn(
                  "rounded-[18px] border px-3 py-2 text-left",
                  isActive
                    ? "border-sky-300/25 bg-sky-300/10"
                    : "border-white/8 bg-white/5",
                )}
              >
                <p className="truncate text-xs font-medium text-card-foreground">
                  {tab.title}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {tab.displayUrl}
                </p>
              </div>
            );
          })
        ) : (
          <div className="rounded-[18px] border border-dashed border-white/10 bg-white/5 px-3 py-3 text-xs text-muted-foreground">
            这个窗口还没有同步 tabs。
          </div>
        )}

        {windowSummary.tabCount > visibleTabs.length ? (
          <p className="text-[11px] text-muted-foreground">
            还有 {windowSummary.tabCount - visibleTabs.length} 个 tabs 未展开显示。
          </p>
        ) : null}
      </div>

      <Button
        className="mt-4 w-full rounded-2xl"
        disabled={disableAction}
        onClick={() => onFocusWindow(windowSummary.id)}
        variant={isCurrent ? "secondary" : "outline"}
      >
        {getActionLabel(windowSummary, isCurrent)}
      </Button>
    </div>
  );
}
