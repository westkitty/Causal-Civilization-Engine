import type { HistoricalEvent, EntityId, EventId, StateDelta } from "../core/types";

export class CausalLedger {
  events: Record<EventId, HistoricalEvent> = {};
  branchId: string;

  constructor(branchId: string = "main") {
    this.branchId = branchId;
  }

  addEvent(event: Omit<HistoricalEvent, "branchId">): HistoricalEvent {
    if (this.events[event.eventId]) {
      throw new Error(`Duplicate causal event ID: ${event.eventId}`);
    }
    const fullEvent: HistoricalEvent = {
      ...event,
      branchId: this.branchId,
    };
    this.events[fullEvent.eventId] = fullEvent;
    return fullEvent;
  }

  getEvent(eventId: EventId): HistoricalEvent | undefined {
    return this.events[eventId];
  }

  // Returns all events in order of occurrence
  getAllEvents(): HistoricalEvent[] {
    return Object.values(this.events).sort((a, b) => a.time.year - b.time.year);
  }

  // Traces the causal ancestry of an event
  traceAncestry(eventId: EventId): EventId[] {
    const ancestors = new Set<EventId>();
    const queue = [eventId];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      const ev = this.events[curr];
      if (ev) {
        for (const p of ev.parentEventIds) {
          if (!ancestors.has(p)) {
            ancestors.add(p);
            queue.push(p);
          }
        }
      }
    }
    return Array.from(ancestors);
  }

  // Traces why an entity is in its current state
  traceEntityHistory(entityId: EntityId): HistoricalEvent[] {
    return Object.values(this.events)
      .filter(ev => ev.affectedEntityIds.includes(entityId))
      .sort((a, b) => a.time.year - b.time.year);
  }

  clone(newBranchId: string): CausalLedger {
    const newLedger = new CausalLedger(newBranchId);
    newLedger.events = JSON.parse(JSON.stringify(this.events));
    return newLedger;
  }
}

// Generate state deltas by comparing an entity before and after mutations
export function diffEntity(
  entityId: string,
  component: string,
  before: any,
  after: any
): StateDelta[] {
  const deltas: StateDelta[] = [];
  if (!before && after) {
    // New entity
    for (const key of Object.keys(after)) {
      deltas.push({
        entityId,
        component,
        field: key,
        before: null,
        after: after[key],
      });
    }
  } else if (before && !after) {
    // Deleted entity
    for (const key of Object.keys(before)) {
      deltas.push({
        entityId,
        component,
        field: key,
        before: before[key],
        after: null,
      });
    }
  } else if (before && after) {
    for (const key of Object.keys(after)) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        deltas.push({
          entityId,
          component,
          field: key,
          before: before[key],
          after: after[key],
        });
      }
    }
  }
  return deltas;
}
