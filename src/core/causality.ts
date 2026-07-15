import type { WorldState } from "./types";
import { CausalLedger } from "../timelines/ledger";

export interface CausalChainStep {
  eventId: string;
  year: number;
  eventType: string;
  summary: string;
}

export interface CausalTraceQuery {
  entityId: string;
  field: string;
  interventionEventId: string;
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
  query: CausalTraceQuery,
  stateA: WorldState,
  stateB: WorldState | undefined,
  ledgerA: CausalLedger,
  ledgerB: CausalLedger | undefined
): CausalAncestryResult {
  const { entityId, field, interventionEventId } = query;
  if (!stateB || !ledgerB) {
    return {
      status: "unrelated_difference",
      eventIds: [],
      missingEventIds: [],
      path: [],
      confidence: 0
    };
  }

  // 1. Confirm the selected field actually differs between states
  const getEntityValue = (state: WorldState, entId: string, fld: string): any => {
    if (state.bridges[entId]) return state.bridges[entId][fld as keyof typeof state.bridges[string]];
    if (state.routes[entId]) return state.routes[entId][fld as keyof typeof state.routes[string]];
    if (state.settlements[entId]) return state.settlements[entId][fld as keyof typeof state.settlements[string]];
    if (state.scars[entId]) return state.scars[entId][fld as keyof typeof state.scars[string]];
    return undefined;
  };

  const hasEntityA = !!(stateA.bridges[entityId] || stateA.routes[entityId] || stateA.settlements[entityId] || stateA.scars[entityId]);
  const hasEntityB = !!(stateB.bridges[entityId] || stateB.routes[entityId] || stateB.settlements[entityId] || stateB.scars[entityId]);

  if (!hasEntityA && !hasEntityB) {
    return {
      status: "unrelated_difference",
      eventIds: [],
      missingEventIds: [],
      path: [],
      confidence: 1.0
    };
  }

  let differs = false;
  if (hasEntityA !== hasEntityB) {
    differs = true;
  } else {
    const valA = getEntityValue(stateA, entityId, field);
    const valB = getEntityValue(stateB, entityId, field);
    if (Array.isArray(valA) || Array.isArray(valB)) {
      differs = JSON.stringify(valA) !== JSON.stringify(valB);
    } else {
      differs = valA !== valB;
    }
  }

  if (!differs) {
    return {
      status: "unrelated_difference",
      eventIds: [],
      missingEventIds: [],
      path: [],
      confidence: 1.0
    };
  }

  // 2. Identify focal branch events in ledgerB whose immediateEffects modify that exact entity and field
  let focalEvents = ledgerB.getAllEvents().filter(e =>
    e.immediateEffects.some(eff => eff.entityId === entityId && eff.field === field)
  );

  // Filter to keep only branch-specific or quantitatively different ones compared to ledgerA
  focalEvents = focalEvents.filter(evB => {
    const evA = ledgerA.getEvent(evB.eventId);
    if (!evA) {
      // Branch-specific event
      return true;
    }
    // Check if the immediateEffect for entityId and field differs quantitatively
    const effB = evB.immediateEffects.find(eff => eff.entityId === entityId && eff.field === field);
    const effA = evA.immediateEffects.find(eff => eff.entityId === entityId && eff.field === field);
    if (!effA || !effB) return true;
    return effB.before !== effA.before || effB.after !== effA.after;
  });

  // Fallback for suppressed entities
  if (focalEvents.length === 0 && hasEntityA && !hasEntityB) {
    const intervEvent = ledgerB.getEvent(interventionEventId);
    if (intervEvent && intervEvent.affectedEntityIds.includes(entityId)) {
      focalEvents.push(intervEvent);
    }
  }

  if (focalEvents.length === 0) {
    return {
      status: "unresolved_ancestry",
      eventIds: [],
      missingEventIds: [],
      path: [],
      confidence: 0
    };
  }

  // 3. BFS search from focal events back to the intervention
  const visited = new Set<string>();
  const cameFrom: Record<string, string> = {}; // parentId -> childId
  const queue: string[] = focalEvents.map(e => e.eventId);
  let reachedIntervention = false;
  const missingEvents = new Set<string>();

  while (queue.length > 0) {
    const currId = queue.shift()!;
    if (visited.has(currId)) continue;
    visited.add(currId);

    if (currId === interventionEventId) {
      reachedIntervention = true;
      break;
    }

    const currEvent = ledgerB.getEvent(currId);
    if (!currEvent) {
      missingEvents.add(currId);
      continue;
    }

    for (const parentId of currEvent.parentEventIds) {
      if (!visited.has(parentId) && !queue.includes(parentId)) {
        cameFrom[parentId] = currId;
        queue.push(parentId);
      }
    }
  }

  if (reachedIntervention && missingEvents.size === 0) {
    // Reconstruct path from interventionEventId to focal event
    const eventIdsPath: string[] = [];
    let curr: string | undefined = interventionEventId;
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
    missingEventIds: Array.from(missingEvents),
    path: [],
    confidence: missingEvents.size > 0 ? 0.0 : 0.2
  };
}
