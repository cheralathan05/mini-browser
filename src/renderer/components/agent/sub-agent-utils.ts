import type { AgentSubAgentDetails } from "@/types/agent";

export function formatSubAgentTimestamp(
  timestamp: number | undefined,
  locale: string,
) {
  if (timestamp === undefined) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

export function stringifySubAgentResult(
  result: Record<string, unknown> | undefined,
) {
  if (!result || Object.keys(result).length === 0) {
    return null;
  }

  try {
    const text = JSON.stringify(result, null, 2);
    return text.length > 12000 ? `${text.slice(0, 12000)}\n...` : text;
  } catch {
    return String(result);
  }
}

export function formatDurationMs(durationMs: number) {
  if (durationMs < 1_000) {
    return `${durationMs}ms`;
  }
  const totalSeconds = Math.round(durationMs / 1_000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function isSameSubAgentDetails(
  left: AgentSubAgentDetails | undefined,
  right: AgentSubAgentDetails | undefined,
) {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}
