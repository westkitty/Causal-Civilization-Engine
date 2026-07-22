import type { HistoricalEvent, EntityId, EventId, StateDelta } from "../core/types";

function cloneEvent(event: HistoricalEvent): HistoricalEvent {
  return structuredClone(event);
}

export class CausalLedger {
  private eventStore: Record<EventId, HistoricalEvent> = {};
  private orderedEventsCache: HistoricalEvent[] | null = null;
  private eventsByYear = new Map<number, HistoricalEvent[]>();
  private eventsByEntity = new Map<EntityId, HistoricalEvent[]>();
  private eventsByType = new Map<string, HistoricalEvent[]>();
  private eventsByCorrelation = new Map<string, HistoricalEvent>();
  branchId: string;

  constructor(branchId: string = "main") {
    this.branchId = branchId;
  }

  /**
   * Compatibility view for older call sites. The returned record is detached from
   * ledger storage so callers cannot mutate indexes behind the ledger's back.
   */
  get events(): Record<EventId, HistoricalEvent> {
    return this.exportEvents();
  }

  set events(events: Record<EventId, HistoricalEvent>) {
    this.importEvents(events);
  }

  private indexEvent(event: HistoricalEvent): void {
    const add = <K>(index: Map<K, HistoricalEvent[]>, key: K) => {
      const values = index.get(key) ?? [];
      values.push(event);
      index.set(key, values);
    };

    add(this.eventsByYear, event.time.year);
    add(this.eventsByType, event.eventType);
    for (const entityId of new Set([...event.actorIds, ...event.affectedEntityIds])) {
      add(this.eventsByEntity, entityId);
    }
    this.eventsByCorrelation.set(event.correlationKey ?? event.eventId, event);
  }

  private rebuildIndexes(): void {
    this.orderedEventsCache = null;
    this.eventsByYear.clear();
    this.eventsByEntity.clear();
    this.eventsByType.clear();
    this.eventsByCorrelation.clear();
    for (const event of Object.values(this.eventStore)) this.indexEvent(event);
  }

  importEvents(events: Record<EventId, HistoricalEvent>): void {
    const nextStore: Record<EventId, HistoricalEvent> = {};
    for (const [eventId, source] of Object.entries(events)) {
      if (eventId !== source.eventId) {
        throw new Error(`Ledger import key mismatch: ${eventId} != ${source.eventId}`);
      }
      if (nextStore[eventId]) throw new Error(`Duplicate causal event ID: ${eventId}`);
      nextStore[eventId] = cloneEvent({ ...source, branchId: this.branchId });
    }
    this.eventStore = nextStore;
    this.rebuildIndexes();
  }

  exportEvents(): Record<EventId, HistoricalEvent> {
    return structuredClone(this.eventStore);
  }

  addEvent(event: Omit<HistoricalEvent, "branchId">): HistoricalEvent {
    if (this.eventStore[event.eventId]) {
      throw new Error(`Duplicate causal event ID: ${event.eventId}`);
    }
    const fullEvent: HistoricalEvent = cloneEvent({
      ...event,
      branchId: this.branchId,
    });
    this.eventStore[fullEvent.eventId] = fullEvent;
    this.orderedEventsCache = null;
    this.indexEvent(fullEvent);
    return cloneEvent(fullEvent);
  }

  getEvent(eventId: EventId): HistoricalEvent | undefined {
    const event = this.eventStore[eventId];
    return event ? cloneEvent(event) : undefined;
  }

  getEventsByYear(year: number): HistoricalEvent[] {
    return structuredClone(this.eventsByYear.get(year) ?? []);
  }

  getEventsByEntity(entityId: EntityId): HistoricalEvent[] {
    return structuredClone(this.eventsByEntity.get(entityId) ?? []);
  }

  getEventsByType(eventType: string): HistoricalEvent[] {
    return structuredClone(this.eventsByType.get(eventType) ?? []);
  }

  getCorrelatedEvent(correlationKey: string): HistoricalEvent | undefined {
    const event = this.eventsByCorrelation.get(correlationKey);
    return event ? cloneEvent(event) : undefined;
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
    return structuredClone(this.orderedEventsCache);
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

  traceEntityHistory(entityId: EntityId): HistoricalEvent[] {
    return this.getEventsByEntity(entityId).sort(
      (a, b) => a.time.year - b.time.year || a.eventId.localeCompare(b.eventId),
    );
  }

  clone(newBranchId: string): CausalLedger {
    const newLedger = new CausalLedger(newBranchId);
    newLedger.importEvents(this.eventStore);
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
