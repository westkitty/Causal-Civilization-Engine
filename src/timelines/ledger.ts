import type { HistoricalEvent, EntityId, EventId, StateDelta } from "../core/types";

export class CausalLedger {
  private eventStore: Record<EventId, HistoricalEvent> = {};
  private orderedEventsCache: HistoricalEvent[] | null = null;
  branchId: string;

  constructor(branchId: string = "main") {
    this.branchId = branchId;
  }

  get events(): Record<EventId, HistoricalEvent> {
    return this.eventStore;
  }

  set events(events: Record<EventId, HistoricalEvent>) {
    this.eventStore = events;
    this.orderedEventsCache = null;
  }

  addEvent(event: Omit<HistoricalEvent, "branchId">): HistoricalEvent {
    if (this.eventStore[event.eventId]) {
      throw new Error(`Duplicate causal event ID: ${event.eventId}`);
    }
    const fullEvent: HistoricalEvent = {
      ...event,
      branchId: this.branchId,
    };
    this.eventStore[fullEvent.eventId] = fullEvent;
    this.orderedEventsCache = null;
    return fullEvent;
  }

  getEvent(eventId: EventId): HistoricalEvent | undefined {
    return this.eventStore[eventId];
  }

  // Returns a stable chronological snapshot. The cache is invalidated whenever
  // events are replaced or appended, avoiding repeated full-ledger sorts in UI
  // and causal-analysis hot paths.
  getAllEvents(): HistoricalEvent[] {
    if (!this.orderedEventsCache) {
      this.orderedEventsCache = Object.values(this.eventStore).sort(
        (a, b) => a.time.year - b.time.year || a.eventId.localeCompare(b.eventId),
      );
    }
    return this.orderedEventsCache;
  }

  // Traces the causal ancestry of an event without repeatedly shifting an array.
  traceAncestry(eventId: EventId): EventId[] {
    const ancestors = new Set<EventId>();
    const queue: EventId[] = [eventId];
    let cursor = 0;
    while (cursor < queue.length) {
      const curr = queue[cursor++];
      const ev = this.eventStore[curr];
      if (!ev) continue;
      for (const parentId of ev.parentEventIds) {
        if (ancestors.has(parentId)) continue;
        ancestors.add(parentId);
        queue.push(parentId);
      }
    }
    return Array.from(ancestors);
  }

  // Traces why an entity is in its current state.
  traceEntityHistory(entityId: EntityId): HistoricalEvent[] {
    return this.getAllEvents().filter(
      event => event.affectedEntityIds.includes(entityId),
    );
  }

  clone(newBranchId: string): CausalLedger {
    const newLedger = new CausalLedger(newBranchId);
    newLedger.events = structuredClone(this.eventStore);
    return newLedger;
  }
}

// Generate state deltas by comparing an entity before and after mutations.
export function diffEntity(
  entityId: string,
  component: string,
  before: unknown,
  after: unknown,
): StateDelta[] {
  const deltas: StateDelta[] = [];
  if (!before && after && typeof after === "object") {
    for (const key of Object.keys(after)) {
      deltas.push({
        entityId,
        component,
        field: key,
        before: null,
        after: (after as Record<string, unknown>)[key],
      });
    }
  } else if (before && !after && typeof before === "object") {
    for (const key of Object.keys(before)) {
      deltas.push({
        entityId,
        component,
        field: key,
        before: (before as Record<string, unknown>)[key],
        after: null,
      });
    }
  } else if (before && after && typeof before === "object" && typeof after === "object") {
    const beforeRecord = before as Record<string, unknown>;
    const afterRecord = after as Record<string, unknown>;
    const keys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]);
    for (const key of keys) {
      if (JSON.stringify(beforeRecord[key]) !== JSON.stringify(afterRecord[key])) {
        deltas.push({
          entityId,
          component,
          field: key,
          before: key in beforeRecord ? beforeRecord[key] : null,
          after: key in afterRecord ? afterRecord[key] : null,
        });
      }
    }
  }
  return deltas;
}
