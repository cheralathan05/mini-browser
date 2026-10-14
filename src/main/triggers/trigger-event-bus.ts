import { randomUUID } from "node:crypto";

export interface TriggerEvent {
  id: string;
  type: string;
  triggerId: string;
  occurredAt: number;
  sourceEventId?: string;
  sourceType?: string;
  dedupeKey?: string;
  payload?: Record<string, unknown>;
}

export interface TriggerEventInput {
  type: string;
  triggerId: string;
  occurredAt?: number;
  sourceEventId?: string;
  sourceType?: string;
  dedupeKey?: string;
  payload?: Record<string, unknown>;
}

export interface TriggerEventSubscribeOptions {
  type?: string;
  triggerId?: string;
  replayRecentMs?: number;
}

export type TriggerEventListener = (event: TriggerEvent) => void;

const MAX_TRIGGER_EVENT_HISTORY = 512;
const MAX_TRIGGER_EVENT_AGE_MS = 60_000;

function eventMatchesOptions(event: TriggerEvent, options?: TriggerEventSubscribeOptions) {
  return (!options?.type || event.type === options.type)
    && (!options?.triggerId || event.triggerId === options.triggerId);
}

export function createTriggerEventBus() {
  const listeners = new Set<{
    listener: TriggerEventListener;
    options?: TriggerEventSubscribeOptions;
  }>();
  const history: TriggerEvent[] = [];

  function pruneHistory(now = Date.now()) {
    while (history.length > 0 && now - history[0]!.occurredAt > MAX_TRIGGER_EVENT_AGE_MS) {
      history.shift();
    }
    if (history.length > MAX_TRIGGER_EVENT_HISTORY) {
      history.splice(0, history.length - MAX_TRIGGER_EVENT_HISTORY);
    }
  }

  return {
    emit(input: TriggerEventInput) {
      const occurredAt = Math.floor(input.occurredAt ?? Date.now());
      const event: TriggerEvent = {
        id: randomUUID(),
        type: input.type,
        triggerId: input.triggerId,
        occurredAt,
        ...(input.sourceEventId ? { sourceEventId: input.sourceEventId } : {}),
        ...(input.sourceType ? { sourceType: input.sourceType } : {}),
        ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
        ...(input.payload ? { payload: { ...input.payload } } : {}),
      };

      history.push(event);
      pruneHistory(occurredAt);

      for (const subscriber of listeners) {
        if (!eventMatchesOptions(event, subscriber.options)) {
          continue;
        }
        try {
          subscriber.listener(event);
        } catch (error) {
          console.error(`[TriggerEventBus] Listener failed for ${event.type}.`, error);
        }
      }

      return event;
    },
    subscribe(listener: TriggerEventListener, options?: TriggerEventSubscribeOptions) {
      const subscriber = { listener, ...(options ? { options: { ...options } } : {}) };
      listeners.add(subscriber);

      const replayRecentMs = Math.max(0, Math.floor(options?.replayRecentMs ?? 0));
      if (replayRecentMs > 0) {
        const cutoff = Date.now() - replayRecentMs;
        pruneHistory();
        for (const event of history) {
          if (event.occurredAt >= cutoff && eventMatchesOptions(event, options)) {
            listener(event);
          }
        }
      }

      return () => {
        listeners.delete(subscriber);
      };
    },
    snapshot() {
      pruneHistory();
      return history.map((event) => ({
        ...event,
        ...(event.payload ? { payload: { ...event.payload } } : {}),
      }));
    },
  };
}
