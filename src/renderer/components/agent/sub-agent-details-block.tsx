import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Bookmark,
  Bot,
  ChevronDown,
  Clock,
  Eye,
  FileSearch,
  Globe,
  LayoutGrid,
  Terminal,
  Timer,
} from "lucide-react";
import type {
  AgentSubAgentRunKind,
  AgentSubAgentRunStatus,
  AgentSubAgentDetails,
  AgentSubAgentRunDetail,
} from "@/types/agent";
import {
  formatDurationMs,
  formatSubAgentTimestamp,
  stringifySubAgentResult,
} from "./sub-agent-utils";

export interface SubAgentLabelMap {
  detailsTitle: string;
  taskLabel: string;
  extractionLabel: string;
  bookmarkLabel: string;
  imageLabel: string;
  userScriptLabel: string;
  widgetBuilderLabel: string;
  statusPending: string;
  statusRunning: string;
  statusCompleted: string;
  statusNeedsUser: string;
  statusBlocked: string;
  statusFailed: string;
  statusCancelled: string;
  started: string;
  finished: string;
  duration: string;
  tab: string;
  window: string;
  startUrl: string;
  conflictPolicy: string;
  resourceKey: string;
  summary: string;
  nextStep: string;
  error: string;
  steps: string;
  result: string;
}

const kindIconMap: Record<
  AgentSubAgentRunKind,
  React.ComponentType<{ className?: string }>
> = {
  delegated_task: Bot,
  extraction: FileSearch,
  bookmark_organizer: Bookmark,
  image_recognition: Eye,
  user_script: Terminal,
  widget_builder: LayoutGrid,
};

const statusLabelMap: Record<AgentSubAgentRunStatus, keyof SubAgentLabelMap> = {
  pending: "statusPending",
  running: "statusRunning",
  completed: "statusCompleted",
  needs_user: "statusNeedsUser",
  blocked: "statusBlocked",
  failed: "statusFailed",
  cancelled: "statusCancelled",
};

interface MetaItem {
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
  isUrl?: boolean;
}

interface AgentSubAgentDetailsBlockProps {
  details: AgentSubAgentDetails;
  classPrefix: "agent-subagent" | "ai-subagent";
  labels: SubAgentLabelMap;
  locale: string;
}

export function AgentSubAgentDetailsBlock({
  details,
  classPrefix,
  labels,
  locale,
}: AgentSubAgentDetailsBlockProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [tick, setTick] = useState(0);
  const runCount = details.runs.length;
  const cn = (suffix: string) => `${classPrefix}-${suffix}`;

  const hasRunning = details.runs.some((r) => r.status === "running");

  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [hasRunning]);

  void tick;

  const summaryTiming = (() => {
    const runs = details.runs;
    const withStart = runs.filter((r) => r.startedAt != null);
    if (withStart.length === 0) return null;
    const earliestStart = Math.min(...withStart.map((r) => r.startedAt!));
    const withEnd = runs.filter((r) => r.finishedAt != null);
    const latestEnd = hasRunning
      ? Date.now()
      : withEnd.length > 0
        ? Math.max(...withEnd.map((r) => r.finishedAt!))
        : null;
    const durationMs = latestEnd != null ? latestEnd - earliestStart : null;
    return {
      startTime: formatSubAgentTimestamp(earliestStart, locale),
      duration: durationMs != null ? formatDurationMs(durationMs) : null,
    };
  })();

  return (
    <details
      className={cn("details")}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      open={isOpen}
    >
      <summary className={cn("details-summary")}>
        <span className={cn("summary-text")}>{labels.detailsTitle}</span>
        {summaryTiming?.startTime ? (
          <span className={cn("summary-time")}>
            <Timer className={cn("summary-time-icon")} />
            {summaryTiming.startTime}
          </span>
        ) : null}
        {summaryTiming?.duration ? (
          <span className={cn("summary-duration")}>
            <Clock className={cn("summary-duration-icon")} />
            {summaryTiming.duration}
          </span>
        ) : null}
        <span className={cn("count")}>{runCount}</span>
        <ChevronDown className={cn("chevron")} />
      </summary>
      <div className={cn("body-wrapper")}>
        <div className={cn("body")}>
          {details.runs.map((run) => (
            <AgentSubAgentRunCard
              key={run.id}
              classPrefix={classPrefix}
              labels={labels}
              locale={locale}
              run={run}
            />
          ))}
        </div>
      </div>
    </details>
  );
}

function AgentSubAgentRunCard({
  classPrefix,
  labels,
  locale,
  run,
}: {
  classPrefix: "agent-subagent" | "ai-subagent";
  labels: SubAgentLabelMap;
  locale: string;
  run: AgentSubAgentRunDetail;
}) {
  const isRunning = run.status === "running";

  const cn = (suffix: string) => `${classPrefix}-${suffix}`;
  const resultText = stringifySubAgentResult(run.result);
  const finishedAt = formatSubAgentTimestamp(run.finishedAt, locale);
  const displayTitle = run.task ?? run.title;

  const KindIcon = kindIconMap[run.kind];
  const kindLabel = (() => {
    switch (run.kind) {
      case "extraction":
        return labels.extractionLabel;
      case "bookmark_organizer":
        return labels.bookmarkLabel;
      case "image_recognition":
        return labels.imageLabel;
      case "user_script":
        return labels.userScriptLabel;
      case "widget_builder":
        return labels.widgetBuilderLabel;
      case "delegated_task":
      default:
        return labels.taskLabel;
    }
  })();

  const rawMetaItems: Array<MetaItem | null> = [
    finishedAt ? { icon: Timer, value: finishedAt } : null,
    run.startUrl
      ? { icon: Globe, value: run.startUrl, isUrl: true }
      : null,
    run.windowId !== undefined
      ? { value: `#${run.windowId}` }
      : null,
    run.resourceKey
      ? { value: run.resourceKey }
      : null,
    run.conflictPolicy
      ? { value: run.conflictPolicy }
      : null,
  ];
  const metaItems = rawMetaItems.filter((item): item is MetaItem => item !== null);

  return (
    <article className={cn("run")} data-status={run.status}>
      {isRunning ? (
        <div className={cn("progress-bar")}>
          <div className={cn("progress-bar-indeterminate")} />
        </div>
      ) : null}
      <div className={cn("run-header")}>
        <span className={cn("kind")}>
          <KindIcon className={cn("kind-icon")} />
          {kindLabel}
        </span>
        <span className={`${cn("status")} ${run.status}`}>
          {labels[statusLabelMap[run.status]]}
        </span>
      </div>
      <div className={cn("run-title")}>{displayTitle}</div>
      {metaItems.length > 0 ? (
        <div className={cn("meta")}>
          {metaItems.map((item) => (
            <span
              className={`${cn("meta-item")}${item.isUrl ? ` ${cn("meta-url")}` : ""}`}
              key={item.value}
            >
              {item.icon ? <item.icon className={cn("meta-icon")} /> : null}
              <code>{item.value}</code>
            </span>
          ))}
        </div>
      ) : null}
      {run.summary ? (
        <div className={`${cn("section")} ${cn("section-summary")}`}>
          <p>{run.summary}</p>
        </div>
      ) : null}
      {run.nextStep ? (
        <div className={cn("section")}>
          <span className={cn("section-label")}>{labels.nextStep}</span>
          <p>{run.nextStep}</p>
        </div>
      ) : null}
      {run.lastError ? (
        <div className={`${cn("section")} is-error`}>
          <span className={cn("section-label")}>
            <AlertTriangle className={cn("section-icon")} />
            {labels.error}
          </span>
          <p>{run.lastError}</p>
        </div>
      ) : null}
      {run.steps?.length ? (
        <div className={cn("section")}>
          <span className={cn("section-label")}>{labels.steps}</span>
          <ol className={cn("steps")}>
            {run.steps.map((step, index) => (
              <li key={`${index}:${step}`}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {resultText ? (
        <div className={cn("section")}>
          <span className={cn("section-label")}>{labels.result}</span>
          <pre className={cn("result")}>{resultText}</pre>
        </div>
      ) : null}
    </article>
  );
}
