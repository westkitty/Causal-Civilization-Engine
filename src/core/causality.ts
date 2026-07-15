import type { WorldState } from "./types";
import { CausalLedger } from "../timelines/ledger";

export interface CausalChainStep {
  eventId: string;
  year: number;
  eventType: string;
  summary: string;
}

export interface CausalAncestryResult {
  status:
    | "verified_causal_path"
    | "correlated_branch_difference"
    | "unresolved_ancestry"
    | "unrelated_difference";
  eventIds: string[];
  missingEventIds: string[];
  path: CausalChainStep[];
  confidence: number;
}

export function traceCausalAncestry(
  entityId: string,
  stateA: WorldState,
  stateB: WorldState | undefined,
  _ledgerA: CausalLedger,
  ledgerB: CausalLedger | undefined
): CausalAncestryResult {
  if (!stateB || !ledgerB) {
    return {
      status: "unrelated_difference",
      eventIds: [],
      missingEventIds: [],
      path: [],
      confidence: 0
    };
  }

  // Find the intervention event in ledgerB
  const interventionEvent = ledgerB.getAllEvents().find(e => e.eventType === "timeline_intervention");
  if (!interventionEvent) {
    return {
      status: "unrelated_difference",
      eventIds: [],
      missingEventIds: [],
      path: [],
      confidence: 0
    };
  }
  const interventionId = interventionEvent.eventId;

  // 1. Determine if there is actually a difference for this entity between stateA and stateB
  let hasDifference = false;
  if (stateA.bridges[entityId] || stateB.bridges[entityId]) {
    const bA = stateA.bridges[entityId];
    const bB = stateB.bridges[entityId];
    hasDifference = !bA || !bB || bA.status !== bB.status;
  } else if (stateA.routes[entityId] || stateB.routes[entityId]) {
    const rA = stateA.routes[entityId];
    const rB = stateB.routes[entityId];
    hasDifference = !rA || !rB || rA.travelTime !== rB.travelTime || rA.capacity !== rB.capacity;
  } else if (stateA.settlements[entityId] || stateB.settlements[entityId]) {
    const sA = stateA.settlements[entityId];
    const sB = stateB.settlements[entityId];
    hasDifference = !sA || !sB || sA.population !== sB.population || sA.wealth !== sB.wealth || sA.abandoned !== sB.abandoned;
  }

  if (!hasDifference) {
    return {
      status: "unrelated_difference",
      eventIds: [],
      missingEventIds: [],
      path: [],
      confidence: 1.0
    };
  }

  // 2. Find focal events in ledgerB that affect this entity
  const focalEvents = ledgerB.getAllEvents().filter(e => 
    e.affectedEntityIds.includes(entityId) || e.actorIds.includes(entityId)
  );

  if (focalEvents.length === 0) {
    return {
      status: "unresolved_ancestry",
      eventIds: [],
      missingEventIds: [],
      path: [],
      confidence: 0
    };
  }

  // 3. BFS search from focal events back to the intervention event
  const focalEventIds = focalEvents.map(e => e.eventId);
  const queue: string[] = [...focalEventIds];
  const visited = new Set<string>();
  const cameFrom: Record<string, string> = {}; // childId -> parentId
  let foundInterventionId: string | null = null;
  const missingEvents = new Set<string>();

  while (queue.length > 0) {
    const currId = queue.shift()!;
    if (visited.has(currId)) continue;
    visited.add(currId);

    const currEvent = ledgerB.getEvent(currId);
    if (!currEvent) {
      missingEvents.add(currId);
      continue;
    }

    if (currId === interventionId) {
      foundInterventionId = currId;
      break;
    }

    for (const parentId of currEvent.parentEventIds) {
      if (!visited.has(parentId)) {
        cameFrom[parentId] = currId;
        queue.push(parentId);
      }
    }
  }

  const missingList = Array.from(missingEvents);
  
  if (foundInterventionId && missingList.length === 0) {
    // Reconstruct chronological path from intervention to focal event
    const eventIdsPath: string[] = [];
    let curr: string | undefined = foundInterventionId;
    while (curr) {
      eventIdsPath.push(curr);
      curr = cameFrom[curr];
    }

    const pathSteps = eventIdsPath.map(id => {
      const ev = ledgerB.getEvent(id)!;
      let summary = ev.summaryTemplate;
      if (ev.summaryArguments) {
        for (const key of Object.keys(ev.summaryArguments)) {
          summary = summary.replace(`{${key}}`, String(ev.summaryArguments[key]));
        }
      }
      return {
        eventId: ev.eventId,
        year: ev.time.year,
        eventType: ev.eventType,
        summary
      };
    });

    return {
      status: "verified_causal_path",
      eventIds: eventIdsPath,
      missingEventIds: [],
      path: pathSteps,
      confidence: 1.0
    };
  }

  return {
    status: "unresolved_ancestry",
    eventIds: Array.from(visited),
    missingEventIds: missingList,
    path: [],
    confidence: missingList.length > 0 ? 0.0 : 0.2
  };
}
