import { scheduler } from "node:timers/promises";
import { randomUUID } from "node:crypto";

export type TimeSourceEventType = "time.once.due" | "time.interval.tick" | "time.cron.due";

export interface TimeSourceEvent {
  id: string;
  type: TimeSourceEventType;
  sourceId: string;
  occurredAt: number;
  scheduledAt: number;
  driftMs: number;
  sequence: number;
  payload?: Record<string, unknown>;
}

export type TimeSourceEventListener = (event: TimeSourceEvent) => void;

export interface TimerDriver {
  now(): number;
  sleepUntil(targetTime: number, signal: AbortSignal): Promise<void>;
}

const MAX_NODE_TIMER_DELAY_MS = 2_147_483_647;

function createAbortError() {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

export class NodeTimerDriver implements TimerDriver {
  now() {
    return Date.now();
  }

  async sleepUntil(targetTime: number, signal: AbortSignal) {
    while (true) {
      if (signal.aborted) {
        throw createAbortError();
      }
      const delayMs = Math.max(0, targetTime - this.now());
      if (delayMs <= 0) {
        return;
      }
      await scheduler.wait(Math.min(delayMs, MAX_NODE_TIMER_DELAY_MS), { signal });
    }
  }
}

export interface TimeEventSourceRegistration {
  sourceId: string;
  type: TimeSourceEventType;
  scheduledAt: number;
  payload?: Record<string, unknown>;
}

interface TimeEventSourceEntry extends TimeEventSourceRegistration {
  sequence: number;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function compareEntries(left: TimeEventSourceEntry, right: TimeEventSourceEntry) {
  if (left.scheduledAt !== right.scheduledAt) {
    return left.scheduledAt - right.scheduledAt;
  }
  return left.sequence - right.sequence;
}

export function createTimeEventSource(driver: TimerDriver = new NodeTimerDriver()) {
  const entries = new Map<string, TimeEventSourceEntry>();
  const listeners = new Set<TimeSourceEventListener>();
  let nextSequence = 1;
  let loopPromise: Promise<void> | null = null;
  let waitAbortController: AbortController | null = null;
  let stopRequested = false;

  function getNextEntry() {
    let next: TimeEventSourceEntry | null = null;
    for (const entry of entries.values()) {
      if (!next || compareEntries(entry, next) < 0) {
        next = entry;
      }
    }
    return next;
  }

  function notifyLoopChanged() {
    if (waitAbortController && !waitAbortController.signal.aborted) {
      waitAbortController.abort();
    }
    if (!loopPromise) {
      loopPromise = runLoop().finally(() => {
        loopPromise = null;
      });
    }
  }

  function emitDueEvents(now: number) {
    const dueEntries = Array.from(entries.values())
      .filter((entry) => entry.scheduledAt <= now)
      .sort(compareEntries);

    for (const entry of dueEntries) {
      const current = entries.get(entry.sourceId);
      if (!current || current.sequence !== entry.sequence) {
        continue;
      }

      entries.delete(entry.sourceId);
      const event: TimeSourceEvent = {
        id: randomUUID(),
        type: entry.type,
        sourceId: entry.sourceId,
        occurredAt: now,
        scheduledAt: entry.scheduledAt,
        driftMs: now - entry.scheduledAt,
        sequence: entry.sequence,
        ...(entry.payload ? { payload: { ...entry.payload } } : {}),
      };

      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error(`[TimeEventSource] Listener failed for ${event.type}.`, error);
        }
      }
    }
  }

  async function runLoop() {
    while (!stopRequested) {
      const nextEntry = getNextEntry();
      if (!nextEntry) {
        return;
      }

      const abortController = new AbortController();
      waitAbortController = abortController;
      try {
        await driver.sleepUntil(nextEntry.scheduledAt, abortController.signal);
      } catch (error) {
        if (!isAbortError(error)) {
          console.error("[TimeEventSource] Timer driver failed.", error);
        }
        continue;
      } finally {
        if (waitAbortController === abortController) {
          waitAbortController = null;
        }
      }

      emitDueEvents(driver.now());
    }
  }

  return {
    upsert(registration: TimeEventSourceRegistration) {
      if (!Number.isFinite(registration.scheduledAt)) {
        throw new Error("Time event source registration requires a finite scheduledAt timestamp.");
      }
      const scheduledAt = Math.max(0, Math.floor(registration.scheduledAt));
      entries.set(registration.sourceId, {
        sourceId: registration.sourceId,
        type: registration.type,
        scheduledAt,
        sequence: nextSequence,
        ...(registration.payload ? { payload: { ...registration.payload } } : {}),
      });
      nextSequence += 1;
      notifyLoopChanged();
    },
    remove(sourceId: string) {
      const removed = entries.delete(sourceId);
      if (removed) {
        notifyLoopChanged();
      }
      return removed;
    },
    subscribe(listener: TimeSourceEventListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot() {
      return Array.from(entries.values())
        .sort(compareEntries)
        .map((entry) => ({
          sourceId: entry.sourceId,
          type: entry.type,
          scheduledAt: entry.scheduledAt,
          sequence: entry.sequence,
          ...(entry.payload ? { payload: { ...entry.payload } } : {}),
        }));
    },
    stop() {
      stopRequested = true;
      if (waitAbortController && !waitAbortController.signal.aborted) {
        waitAbortController.abort();
      }
      entries.clear();
    },
  };
}

export function createNodeTimeEventSource() {
  return createTimeEventSource(new NodeTimerDriver());
}
