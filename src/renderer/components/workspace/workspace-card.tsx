import { Bot, Eye, EyeOff, Link2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WorkspaceSummary } from "@/types/workspace";

interface WorkspaceCardProps {
  currentWorkspaceId?: string;
  isShellAvailable: boolean;
  onOpenWindow: (workspaceId: string) => void;
  workspace: WorkspaceSummary;
}

function getProfileLabel(workspace: WorkspaceSummary) {
  if (workspace.profileMode === "attached" && workspace.profileSourceWorkspaceName) {
    return `Attached to ${workspace.profileSourceWorkspaceName}`;
  }

  return "Fresh profile";
}

function getWindowLabel(workspace: WorkspaceSummary) {
  if (!workspace.hasWindow) {
    return "No windows";
  }

  if (workspace.windowVisible) {
    return `${workspace.windowCount} visible windows`;
  }

  return `${workspace.windowCount} hidden windows`;
}

function getAutomationLabel(workspace: WorkspaceSummary) {
  if (!workspace.automationEnabled) {
    return "Automation off";
  }

  if (workspace.automationAttached) {
    return "CDP attached";
  }

  return "CDP waiting";
}

function isAutomationWorkspace(workspace: WorkspaceSummary) {
  return workspace.tags?.includes("automation") ?? false;
}

function getActionLabel(workspace: WorkspaceSummary, isCurrent: boolean) {
  if (isCurrent) {
    return "New window here";
  }

  return "New window";
}

export function WorkspaceCard({
  currentWorkspaceId,
  isShellAvailable,
  onOpenWindow,
  workspace,
}: WorkspaceCardProps) {
  const isCurrent = workspace.id === currentWorkspaceId;
  const disableAction = !isShellAvailable;

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
              {workspace.name}
            </p>
            {isCurrent ? (
              <span className="rounded-full border border-sky-300/30 bg-sky-300/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.22em] text-sky-100">
                Current
              </span>
            ) : null}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            profile `{workspace.profileId}`
          </p>
        </div>

        <div className="rounded-full border border-white/10 bg-white/6 p-2 text-muted-foreground">
          {workspace.windowVisible ? (
            <Eye className="h-4 w-4" />
          ) : (
            <EyeOff className="h-4 w-4" />
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
        {isAutomationWorkspace(workspace) ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-sky-300/25 bg-sky-300/10 px-2.5 py-1 text-sky-100">
            <Bot className="h-3.5 w-3.5" />
            Automation
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-muted-foreground">
          <Link2 className="h-3.5 w-3.5" />
          {getProfileLabel(workspace)}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-muted-foreground">
          {workspace.automationEnabled ? (
            <Bot className="h-3.5 w-3.5" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {getAutomationLabel(workspace)}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-muted-foreground">
          <Eye className="h-3.5 w-3.5" />
          {getWindowLabel(workspace)}
        </span>
      </div>

      {workspace.automationTargetUrl ? (
        <p className="mt-3 truncate text-xs text-muted-foreground">
          target `{workspace.automationTargetUrl}`
        </p>
      ) : null}

      <Button
        className="mt-4 w-full rounded-2xl"
        disabled={disableAction}
        onClick={() => onOpenWindow(workspace.id)}
        variant={isCurrent ? "secondary" : "outline"}
      >
        {getActionLabel(workspace, isCurrent)}
      </Button>
    </div>
  );
}
