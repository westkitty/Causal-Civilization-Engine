import type { HistoricalEvent, WorldState } from "./types";
import type { ReplayDiagnostics } from "./replayIntegration";
import { changedEntityIds, firstDivergentYear } from "./replayDiagnostics";

export interface EntityDeltaSummary {
  settlements: string[];
  routes: string[];
  bridges: string[];
  governments: string[];
  landmarks: string[];
  scars: string[];
}

export interface CounterfactualAnalysis {
  firstDivergentYear: number | null;
  selectedYear: number;
  stateHashA: string | null;
  stateHashB: string | null;
  hashesMatch: boolean;
  entities: EntityDeltaSummary;
  eventIdsOnlyInA: string[];
  eventIdsOnlyInB: string[];
  causalAncestorsA: string[];
  causalAncestorsB: string[];
}

function ids<T>(record: Record<string, T> | undefined): Record<string, T> {
  return record ?? {};
}

function changedWorldEntities(a?: WorldState, b?: WorldState): EntityDeltaSummary {
  if (!a || !b) {
    return { settlements: [], routes: [], bridges: [], governments: [], landmarks: [], scars: [] };
  }
  return {
    settlements: changedEntityIds(ids(a.settlements), ids(b.settlements)),
    routes: changedEntityIds(ids(a.routes), ids(b.routes)),
    bridges: changedEntityIds(ids(a.bridges), ids(b.bridges)),
    governments: changedEntityIds(ids(a.governments), ids(b.governments)),
    landmarks: changedEntityIds(ids(a.landmarks), ids(b.landmarks)),
    scars: changedEntityIds(ids(a.scars), ids(b.scars)),
  };
}

function eventIdsThroughYear(events: Record<string, HistoricalEvent>, year: number): Set<string> {
  return new Set(Object.values(events).filter(event => event.time.year <= year).map(event => event.eventId));
}

function difference(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter(value => !right.has(value)).sort();
}

export function causalAncestors(events: Record<string, HistoricalEvent>, eventIds: string[], limit = 200): string[] {
  const visited = new Set<string>();
  const queue = [...eventIds];
  while (queue.length && visited.size < limit) {
    const eventId = queue.shift() as string;
    if (visited.has(eventId)) continue;
    visited.add(eventId);
    for (const parentId of events[eventId]?.parentEventIds ?? []) {
      if (!visited.has(parentId)) queue.push(parentId);
    }
  }
  return [...visited].sort();
}

export function analyzeCounterfactual(input: {
  selectedYear: number;
  statesA: Record<number, WorldState>;
  statesB: Record<number, WorldState>;
  yearHashesA: Record<number, string>;
  yearHashesB: Record<number, string>;
  eventsA: Record<string, HistoricalEvent>;
  eventsB: Record<string, HistoricalEvent>;
}): CounterfactualAnalysis {
  const {
    selectedYear,
    statesA,
    statesB,
    yearHashesA,
    yearHashesB,
    eventsA,
    eventsB,
  } = input;
  const idsA = eventIdsThroughYear(eventsA, selectedYear);
  const idsB = eventIdsThroughYear(eventsB, selectedYear);
  const onlyA = difference(idsA, idsB);
  const onlyB = difference(idsB, idsA);
  const stateHashA = yearHashesA[selectedYear] ?? null;
  const stateHashB = yearHashesB[selectedYear] ?? null;

  return {
    firstDivergentYear: firstDivergentYear(yearHashesA, yearHashesB),
    selectedYear,
    stateHashA,
    stateHashB,
    hashesMatch: stateHashA !== null && stateHashA === stateHashB,
    entities: changedWorldEntities(statesA[selectedYear], statesB[selectedYear]),
    eventIdsOnlyInA: onlyA,
    eventIdsOnlyInB: onlyB,
    causalAncestorsA: causalAncestors(eventsA, onlyA),
    causalAncestorsB: causalAncestors(eventsB, onlyB),
  };
}

export interface DeterminismStatus {
  ready: boolean;
  anomalyCount: number;
  replaySignature: string | null;
  stateCacheSignature: string | null;
  eventLedgerSignature: string | null;
  snapshotSignature: string | null;
  frameCount: number;
  firstYear: number | null;
  lastYear: number | null;
}

export function summarizeDeterminism(diagnostics?: ReplayDiagnostics): DeterminismStatus {
  if (!diagnostics) {
    return {
      ready: false,
      anomalyCount: 0,
      replaySignature: null,
      stateCacheSignature: null,
      eventLedgerSignature: null,
      snapshotSignature: null,
      frameCount: 0,
      firstYear: null,
      lastYear: null,
    };
  }
  return {
    ready: diagnostics.anomalies.length === 0,
    anomalyCount: diagnostics.anomalies.length,
    replaySignature: diagnostics.replaySignature,
    stateCacheSignature: diagnostics.stateCacheSignature,
    eventLedgerSignature: diagnostics.eventLedgerSignature,
    snapshotSignature: diagnostics.snapshotSignature,
    frameCount: diagnostics.reproducibility.frameCount,
    firstYear: diagnostics.reproducibility.firstYear,
    lastYear: diagnostics.reproducibility.lastYear,
  };
}
