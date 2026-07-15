import type { WorldState, HistoricalEvent } from "./types";
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
  cycleEventIds?: string[];
  chronologyViolations?: Array<{
    parentEventId: string;
    parentYear: number;
    childEventId: string;
    childYear: number;
  }>;
}

function eventsDiffer(
  evB: HistoricalEvent,
  evA: HistoricalEvent,
  entityId: string,
  field: string,
  interventionEventId: string
): boolean {
  if (evB.ruleId !== evA.ruleId) return true;
  if (evB.eventType !== evA.eventType) return true;

  const parentsB = evB.parentEventIds.filter(id => id !== interventionEventId);
  const parentsA = evA.parentEventIds.filter(id => id !== interventionEventId);
  if (parentsB.join(",") !== parentsA.join(",")) return true;

  // Compare location
  if (evB.location.cellId !== evA.location.cellId ||
      evB.location.routeEdgeId !== evA.location.routeEdgeId ||
      evB.location.settlementId !== evA.location.settlementId) {
    return true;
  }

  // Compare actors & affected entities
  if (evB.actorIds.join(",") !== evA.actorIds.join(",")) return true;
  if (evB.affectedEntityIds.join(",") !== evA.affectedEntityIds.join(",")) return true;

  // Compare immediateEffects
  const effB = evB.immediateEffects.find(eff => eff.entityId === entityId && eff.field === field);
  const effA = evA.immediateEffects.find(eff => eff.entityId === entityId && eff.field === field);
  if (effB || effA) {
    if (!effB || !effA) return true;
    if (typeof effB.before === "number" && typeof effB.after === "number" &&
        typeof effA.before === "number" && typeof effA.after === "number") {
      const deltaB = effB.after - effB.before;
      const deltaA = effA.after - effA.before;
      if (Math.abs(deltaB - deltaA) > 1e-6) return true;
    } else {
      if (effB.before !== effA.before || effB.after !== effA.after) return true;
    }
  }

  // Compare conditions (mechanism inputs)
  for (const condB of evB.conditions) {
    const condA = evA.conditions.find(c => c.predicateType === condB.predicateType) ||
                  evA.conditions.find(c => c.conditionId === condB.conditionId);
    if (!condA) return true;

    for (const obsB of condB.observed) {
      const obsA = condA.observed.find(o => o.name === obsB.name);
      if (!obsA) return true;
      if (Math.abs(obsB.value - obsA.value) > 1e-6) return true;
    }
  }

  // Compare summaryArguments
  const allKeys = new Set([...Object.keys(evB.summaryArguments || {}), ...Object.keys(evA.summaryArguments || {})]);
  for (const key of allKeys) {
    const valB = evB.summaryArguments?.[key];
    const valA = evA.summaryArguments?.[key];
    if (typeof valB === "number" && typeof valA === "number") {
      if (Math.abs(valB - valA) > 1e-6) return true;
    } else {
      if (String(valB) !== String(valA)) return true;
    }
  }

  return false;
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
      confidence: 0,
      cycleEventIds: [],
      chronologyViolations: []
    };
  }

  // 1. Require that intervention exists and eventType === "timeline_intervention"
  const intervEvent = ledgerB.getEvent(interventionEventId);
  if (!intervEvent || intervEvent.eventType !== "timeline_intervention") {
    return {
      status: "unresolved_ancestry",
      eventIds: [],
      missingEventIds: [interventionEventId],
      path: [],
      confidence: 0,
      cycleEventIds: [],
      chronologyViolations: []
    };
  }

  // 2. Confirm the selected field actually differs between states
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
      confidence: 1.0,
      cycleEventIds: [],
      chronologyViolations: []
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
      confidence: 1.0,
      cycleEventIds: [],
      chronologyViolations: []
    };
  }

  // 3. Identify focal branch events in ledgerB whose immediateEffects modify that exact entity and field
  let focalEvents = ledgerB.getAllEvents().filter(e =>
    e.immediateEffects.some(eff => eff.entityId === entityId && eff.field === field)
  );

  // Filter to keep only branch-specific or quantitatively different ones compared to ledgerA
  focalEvents = focalEvents.filter(evB => {
    const evA = ledgerA.getEvent(evB.eventId);
    if (!evA) return true;
    return eventsDiffer(evB, evA, entityId, field, interventionEventId);
  });

  // Fallback for suppressed entities
  if (focalEvents.length === 0 && hasEntityA && !hasEntityB) {
    if (intervEvent.affectedEntityIds.includes(entityId)) {
      focalEvents.push(intervEvent);
    }
  }

  if (focalEvents.length === 0) {
    return {
      status: "unresolved_ancestry",
      eventIds: [],
      missingEventIds: [],
      path: [],
      confidence: 0,
      cycleEventIds: [],
      chronologyViolations: []
    };
  }

  // 4. Trace graph for cycles, chronology violations, and missing events
  const missingEvents = new Set<string>();
  const cycleEventIds = new Set<string>();
  const chronologyViolations: Array<{
    parentEventId: string;
    parentYear: number;
    childEventId: string;
    childYear: number;
  }> = [];

  const visitedState = new Map<string, "visiting" | "visited">();

  function dfs(currId: string) {
    visitedState.set(currId, "visiting");

    const currEvent = ledgerB!.getEvent(currId);
    if (!currEvent) {
      missingEvents.add(currId);
      visitedState.set(currId, "visited");
      return;
    }

    for (const parentId of currEvent.parentEventIds) {
      const parentEvent = ledgerB!.getEvent(parentId);
      if (parentEvent) {
        if (parentEvent.time.year > currEvent.time.year) {
          chronologyViolations.push({
            parentEventId: parentId,
            parentYear: parentEvent.time.year,
            childEventId: currId,
            childYear: currEvent.time.year
          });
        }
      } else {
        missingEvents.add(parentId);
      }

      const pState = visitedState.get(parentId);
      if (pState === "visiting") {
        cycleEventIds.add(parentId);
        cycleEventIds.add(currId);
      } else if (!pState) {
        dfs(parentId);
      }
    }

    visitedState.set(currId, "visited");
  }

  for (const focal of focalEvents) {
    if (!visitedState.has(focal.eventId)) {
      dfs(focal.eventId);
    }
  }

  // 5. BFS search from focal events back to the intervention
  const queue: string[] = focalEvents.map(e => e.eventId);
  const bfsVisited = new Set<string>();
  const cameFrom: Record<string, string> = {}; // parentId -> childId
  let reachedIntervention = false;

  while (queue.length > 0) {
    const currId = queue.shift()!;
    if (bfsVisited.has(currId)) continue;
    bfsVisited.add(currId);

    if (currId === interventionEventId) {
      reachedIntervention = true;
    }

    const currEvent = ledgerB.getEvent(currId);
    if (!currEvent) continue;

    for (const parentId of currEvent.parentEventIds) {
      if (!bfsVisited.has(parentId) && !queue.includes(parentId)) {
        cameFrom[parentId] = currId;
        queue.push(parentId);
      }
    }
  }

  const hasErrors = missingEvents.size > 0 || cycleEventIds.size > 0 || chronologyViolations.length > 0;

  if (reachedIntervention && !hasErrors) {
    // Reconstruct chronological path from intervention to focal event
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
      confidence: 1.0,
      cycleEventIds: [],
      chronologyViolations: []
    };
  }

  return {
    status: "unresolved_ancestry",
    eventIds: Array.from(bfsVisited),
    missingEventIds: Array.from(missingEvents),
    path: [],
    confidence: missingEvents.size > 0 ? 0.0 : 0.2,
    cycleEventIds: Array.from(cycleEventIds),
    chronologyViolations
  };
}
