import type { WorldState, HistoricalEvent, ConditionEvidence, StateDelta } from "./types";
import { CausalLedger } from "../timelines/ledger";
import { formatEventSummary } from "./eventSummary";

// ---------------------------------------------------------------------------
// Semantic cross-branch event correlation
//
// Corresponding events across two timelines must NOT be identified by a mutable
// global transaction counter. `correlationKey` carries a deterministic,
// order-independent semantic identity (year, seller, buyer, good, side,
// pair-scoped ordinal for trades). Events whose raw eventId is already stable
// (bridges, roads, founding, tax, …) fall back to the eventId.
// ---------------------------------------------------------------------------

export function getEventCorrelationKey(event: HistoricalEvent): string {
  return event.correlationKey ?? event.eventId;
}

export function buildCorrelationIndex(ledger: CausalLedger): Map<string, HistoricalEvent> {
  const index = new Map<string, HistoricalEvent>();
  for (const ev of ledger.getAllEvents()) {
    // First writer wins for determinism (getAllEvents is year- then
    // insertion-ordered). Keys are unique in practice.
    const key = getEventCorrelationKey(ev);
    if (!index.has(key)) index.set(key, ev);
  }
  return index;
}

export function findCorrelatedEvent(
  ledger: CausalLedger,
  event: HistoricalEvent
): HistoricalEvent | undefined {
  const wanted = getEventCorrelationKey(event);
  for (const ev of ledger.getAllEvents()) {
    if (getEventCorrelationKey(ev) === wanted) return ev;
  }
  return undefined;
}

// Aggregates the semantic trade mechanism between a seller/buyer for a good in a
// given year (total volume, weighted unit price, total transport expense),
// independent of how many discrete allocations or in what order they occurred.
export function aggregateTradeMechanism(
  ledger: CausalLedger,
  year: number,
  sellerId: string,
  buyerId: string,
  good: string
): { totalVolume: number; weightedPrice: number; transportExpense: number; allocations: number } {
  let totalVolume = 0;
  let priceVolume = 0;
  let transportExpense = 0;
  let allocations = 0;
  for (const ev of ledger.getAllEvents()) {
    if (ev.eventType !== "trade_allocation" || ev.time.year !== year) continue;
    if (ev.actorIds[0] !== sellerId || ev.actorIds[1] !== buyerId) continue;
    const argGood = ev.summaryArguments?.good;
    if (argGood !== undefined && argGood !== good) continue;
    const cond = ev.conditions[0];
    if (!cond) continue;
    const vol = cond.observed.find(o => o.name === "volume")?.value ?? 0;
    const price = cond.observed.find(o => o.name === "unitPrice")?.value ?? 0;
    const expense = cond.observed.find(o => o.name === "transportExpense")?.value ?? 0;
    totalVolume += vol;
    priceVolume += vol * price;
    transportExpense += expense;
    allocations += 1;
  }
  return {
    totalVolume,
    weightedPrice: totalVolume > 0 ? priceVolume / totalVolume : 0,
    transportExpense,
    allocations,
  };
}

// ---------------------------------------------------------------------------
// Symmetric, order-independent event comparison
// ---------------------------------------------------------------------------

function sortedJoin(arr: string[]): string {
  return [...arr].sort().join(",");
}

// Canonical signature of a condition. Excludes `conditionId` because it embeds
// branch-specific event ids; includes every semantic attribute plus sorted
// observations (name, value, unit, baseline, threshold).
function conditionSignature(c: ConditionEvidence): string {
  const obs = [...c.observed]
    .map(o => `${o.name}=${o.value}|u:${o.unit ?? ""}|b:${o.baseline ?? ""}|t:${o.threshold ?? ""}`)
    .sort()
    .join(";");
  return `${c.predicateType}|res:${c.result}|role:${c.role}|src:${c.sourceSystem}|unc:${c.uncertainty}|obs:[${obs}]`;
}

// Compares the multiset of conditions symmetrically (a condition present on
// only one side, an extra observation, or a repeated predicate type all change
// the multiset and are detected).
function conditionsDiffer(condsA: ConditionEvidence[], condsB: ConditionEvidence[]): boolean {
  const sigA = condsA.map(conditionSignature).sort();
  const sigB = condsB.map(conditionSignature).sort();
  if (sigA.length !== sigB.length) return true;
  for (let i = 0; i < sigA.length; i++) {
    if (sigA[i] !== sigB[i]) return true;
  }
  return false;
}

// Compares ALL immediate effects that touch the focal (entityId, field).
// Numeric effects compare normalized deltas (after - before); non-numeric
// effects compare canonical before->after values. Multiset semantics.
function effectsDiffer(
  effsA: StateDelta[],
  effsB: StateDelta[]
): boolean {
  const numA: number[] = [];
  const strA: string[] = [];
  const numB: number[] = [];
  const strB: string[] = [];
  const bucket = (effs: StateDelta[], nums: number[], strs: string[]) => {
    for (const e of effs) {
      if (typeof e.before === "number" && typeof e.after === "number") {
        nums.push(e.after - e.before);
      } else {
        strs.push(`${JSON.stringify(e.before)}->${JSON.stringify(e.after)}`);
      }
    }
  };
  bucket(effsA, numA, strA);
  bucket(effsB, numB, strB);
  if (numA.length !== numB.length || strA.length !== strB.length) return true;
  numA.sort((a, b) => a - b);
  numB.sort((a, b) => a - b);
  for (let i = 0; i < numA.length; i++) {
    if (Math.abs(numA[i] - numB[i]) > 1e-9) return true;
  }
  strA.sort();
  strB.sort();
  for (let i = 0; i < strA.length; i++) {
    if (strA[i] !== strB[i]) return true;
  }
  return false;
}

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

// Returns true when the counterfactual event `evB` differs from its correlated
// baseline event `evA` in any causally-relevant way. All comparisons are
// symmetric and order-independent; a difference on either side is detected.
// Exported for adversarial testing.
export function eventsDiffer(
  evB: HistoricalEvent,
  evA: HistoricalEvent,
  entityId: string,
  field: string,
  interventionEventId: string
): boolean {
  if (evB.ruleId !== evA.ruleId) return true;
  if (evB.eventType !== evA.eventType) return true;
  if (evB.time.year !== evA.time.year) return true;

  // Set-like arrays: compare as sorted copies (order is not semantic). The
  // intervention id is excluded from parents so that merely inserting the
  // intervention does not by itself register as a divergence.
  const parentsB = evB.parentEventIds.filter(id => id !== interventionEventId);
  const parentsA = evA.parentEventIds.filter(id => id !== interventionEventId);
  if (sortedJoin(parentsB) !== sortedJoin(parentsA)) return true;
  if (sortedJoin(evB.actorIds) !== sortedJoin(evA.actorIds)) return true;
  if (sortedJoin(evB.affectedEntityIds) !== sortedJoin(evA.affectedEntityIds)) return true;

  // Location.
  if (evB.location.cellId !== evA.location.cellId ||
      evB.location.routeEdgeId !== evA.location.routeEdgeId ||
      evB.location.settlementId !== evA.location.settlementId) {
    return true;
  }

  // All immediate effects on the focal (entityId, field), by normalized delta.
  const effsB = evB.immediateEffects.filter(eff => eff.entityId === entityId && eff.field === field);
  const effsA = evA.immediateEffects.filter(eff => eff.entityId === entityId && eff.field === field);
  if (effectsDiffer(effsA, effsB)) return true;

  // Conditions (mechanism inputs), compared symmetrically as a multiset.
  if (conditionsDiffer(evA.conditions, evB.conditions)) return true;

  // Summary arguments (secondary signal — includes the transport path
  // signature). Compared symmetrically over the key union.
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

  // Correlate each candidate to its baseline counterpart by SEMANTIC identity
  // (correlationKey, not raw eventId) so unrelated transaction ordering cannot
  // spoof a divergence. Keep only events with no baseline counterpart or a
  // genuinely different mechanism.
  const baselineIndex = buildCorrelationIndex(ledgerA);
  focalEvents = focalEvents.filter(evB => {
    const evA = baselineIndex.get(getEventCorrelationKey(evB));
    if (!evA) return true;
    return eventsDiffer(evB, evA, entityId, field, interventionEventId);
  });

  // Deterministic focal ordering (year, then eventId) so path selection and BFS
  // seeding are reproducible regardless of ledger insertion order.
  focalEvents.sort((a, b) => a.time.year - b.time.year || a.eventId.localeCompare(b.eventId));

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
      return {
        eventId: ev.eventId,
        year: ev.time.year,
        eventType: ev.eventType,
        summary: formatEventSummary(ev.summaryTemplate, ev.summaryArguments)
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
