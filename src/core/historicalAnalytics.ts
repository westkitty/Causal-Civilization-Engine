import type { EntityId, EventId, HistoricalEvent, WorldState } from "./types";
import { changedEntityIds, firstDivergentYear, stableSerialize } from "./replayDiagnostics";

export interface ProvenanceNode {
  eventId: EventId;
  year: number;
  eventType: string;
  summary: string;
  depth: number;
  confidence: number;
}

export interface ProvenanceExplanation {
  subjectId: string;
  branchId: string | null;
  directEvents: ProvenanceNode[];
  causalChain: ProvenanceNode[];
  rootEventIds: EventId[];
  truncated: boolean;
}

function formatSummary(event: HistoricalEvent): string {
  return event.summaryTemplate.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = event.summaryArguments[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

function toNode(event: HistoricalEvent, depth: number): ProvenanceNode {
  return {
    eventId: event.eventId,
    year: event.time.year,
    eventType: event.eventType,
    summary: formatSummary(event),
    depth,
    confidence: event.confidence,
  };
}

export class WorldProvenanceService {
  constructor(private readonly events: Record<EventId, HistoricalEvent>) {}

  explainEntity(entityId: EntityId, maxNodes = 250): ProvenanceExplanation {
    const direct = Object.values(this.events)
      .filter(event => event.actorIds.includes(entityId) || event.affectedEntityIds.includes(entityId))
      .sort((a, b) => a.time.year - b.time.year || a.eventId.localeCompare(b.eventId));
    return this.explainFromEvents(entityId, direct, maxNodes);
  }

  explainEvent(eventId: EventId, maxNodes = 250): ProvenanceExplanation {
    const event = this.events[eventId];
    return this.explainFromEvents(eventId, event ? [event] : [], maxNodes);
  }

  private explainFromEvents(subjectId: string, direct: HistoricalEvent[], maxNodes: number): ProvenanceExplanation {
    const depthById = new Map<EventId, number>();
    const queue = direct.map(event => ({ id: event.eventId, depth: 0 }));
    let truncated = false;

    while (queue.length > 0) {
      const current = queue.shift() as { id: EventId; depth: number };
      const previousDepth = depthById.get(current.id);
      if (previousDepth !== undefined && previousDepth <= current.depth) continue;
      if (depthById.size >= maxNodes) {
        truncated = true;
        break;
      }
      depthById.set(current.id, current.depth);
      const event = this.events[current.id];
      for (const parentId of event?.parentEventIds ?? []) queue.push({ id: parentId, depth: current.depth + 1 });
    }

    const causalChain = [...depthById.entries()]
      .map(([id, depth]) => this.events[id] ? toNode(this.events[id], depth) : null)
      .filter((node): node is ProvenanceNode => node !== null)
      .sort((a, b) => b.depth - a.depth || a.year - b.year || a.eventId.localeCompare(b.eventId));
    const rootEventIds = causalChain
      .filter(node => (this.events[node.eventId]?.parentEventIds.length ?? 0) === 0)
      .map(node => node.eventId);

    return {
      subjectId,
      branchId: direct[0]?.branchId ?? null,
      directEvents: direct.map(event => toNode(event, 0)),
      causalChain,
      rootEventIds,
      truncated,
    };
  }
}

export interface BranchSimilarity {
  score: number;
  matchingYears: number;
  comparedYears: number;
  firstDivergentYear: number | null;
  matchingEventRatio: number;
  matchingEntityRatio: number;
}

function jaccard(left: Iterable<string>, right: Iterable<string>): number {
  const a = new Set(left);
  const b = new Set(right);
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / union.size;
}

function worldEntityKeys(state?: WorldState): string[] {
  if (!state) return [];
  return [
    ...Object.keys(state.settlements).map(id => `settlement:${id}`),
    ...Object.keys(state.routes).map(id => `route:${id}`),
    ...Object.keys(state.bridges).map(id => `bridge:${id}`),
    ...Object.keys(state.governments).map(id => `government:${id}`),
    ...Object.keys(state.landmarks).map(id => `landmark:${id}`),
    ...Object.keys(state.scars).map(id => `scar:${id}`),
  ];
}

export function scoreBranchSimilarity(input: {
  yearHashesA: Record<number, string>;
  yearHashesB: Record<number, string>;
  eventsA: Record<EventId, HistoricalEvent>;
  eventsB: Record<EventId, HistoricalEvent>;
  finalStateA?: WorldState;
  finalStateB?: WorldState;
}): BranchSimilarity {
  const years = [...new Set([...Object.keys(input.yearHashesA), ...Object.keys(input.yearHashesB)].map(Number))].sort((a, b) => a - b);
  const matchingYears = years.filter(year => input.yearHashesA[year] !== undefined && input.yearHashesA[year] === input.yearHashesB[year]).length;
  const matchingEventRatio = jaccard(
    Object.values(input.eventsA).map(event => event.correlationKey ?? event.eventId),
    Object.values(input.eventsB).map(event => event.correlationKey ?? event.eventId),
  );
  const matchingEntityRatio = jaccard(worldEntityKeys(input.finalStateA), worldEntityKeys(input.finalStateB));
  const hashRatio = years.length === 0 ? 1 : matchingYears / years.length;
  const score = Math.round((hashRatio * 0.6 + matchingEventRatio * 0.25 + matchingEntityRatio * 0.15) * 10000) / 100;

  return {
    score,
    matchingYears,
    comparedYears: years.length,
    firstDivergentYear: firstDivergentYear(input.yearHashesA, input.yearHashesB),
    matchingEventRatio,
    matchingEntityRatio,
  };
}

export interface TimelineHeatPoint {
  year: number;
  eventCount: number;
  affectedEntityCount: number;
  stateDeltaCount: number;
  weightedIntensity: number;
  eventTypes: Record<string, number>;
}

export function buildTimelineHeatmap(events: Record<EventId, HistoricalEvent>): TimelineHeatPoint[] {
  const byYear = new Map<number, HistoricalEvent[]>();
  for (const event of Object.values(events)) {
    const bucket = byYear.get(event.time.year) ?? [];
    bucket.push(event);
    byYear.set(event.time.year, bucket);
  }
  return [...byYear.entries()].sort(([a], [b]) => a - b).map(([year, yearEvents]) => {
    const affected = new Set(yearEvents.flatMap(event => [...event.actorIds, ...event.affectedEntityIds]));
    const eventTypes: Record<string, number> = {};
    let stateDeltaCount = 0;
    let weightedIntensity = 0;
    for (const event of yearEvents) {
      eventTypes[event.eventType] = (eventTypes[event.eventType] ?? 0) + 1;
      stateDeltaCount += event.immediateEffects.length;
      weightedIntensity += (1 + event.immediateEffects.length * 0.5 + event.affectedEntityIds.length * 0.25) * event.confidence;
    }
    return {
      year,
      eventCount: yearEvents.length,
      affectedEntityCount: affected.size,
      stateDeltaCount,
      weightedIntensity: Math.round(weightedIntensity * 1000) / 1000,
      eventTypes,
    };
  });
}

export interface HistoricalStatistics {
  totalEvents: number;
  firstEventYear: number | null;
  lastEventYear: number | null;
  busiestYear: number | null;
  busiestYearEventCount: number;
  mostCommonEventType: string | null;
  mostCommonEventTypeCount: number;
  averageConfidence: number;
  longestLivedGovernment: { id: string; years: number } | null;
  longestLivedSettlement: { id: string; years: number } | null;
  largestSettlement: { id: string; population: number; year: number } | null;
}

export function computeHistoricalStatistics(
  states: Record<number, WorldState>,
  events: Record<EventId, HistoricalEvent>,
): HistoricalStatistics {
  const heat = buildTimelineHeatmap(events);
  const allEvents = Object.values(events);
  const busiest = heat.reduce<TimelineHeatPoint | null>((best, point) => !best || point.eventCount > best.eventCount ? point : best, null);
  const eventTypeCounts = new Map<string, number>();
  for (const event of allEvents) eventTypeCounts.set(event.eventType, (eventTypeCounts.get(event.eventType) ?? 0) + 1);
  const mostCommon = [...eventTypeCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? null;
  const years = Object.keys(states).map(Number).sort((a, b) => a - b);
  const entityLifetimes = (selector: (state: WorldState) => Record<string, unknown>) => {
    const spans = new Map<string, { first: number; last: number }>();
    for (const year of years) {
      for (const id of Object.keys(selector(states[year]))) {
        const span = spans.get(id);
        if (span) span.last = year;
        else spans.set(id, { first: year, last: year });
      }
    }
    return [...spans.entries()].map(([id, span]) => ({ id, years: span.last - span.first + 1 }));
  };
  const longestGovernment = entityLifetimes(state => state.governments).sort((a, b) => b.years - a.years || a.id.localeCompare(b.id))[0] ?? null;
  const longestSettlement = entityLifetimes(state => state.settlements).sort((a, b) => b.years - a.years || a.id.localeCompare(b.id))[0] ?? null;
  let largestSettlement: { id: string; population: number; year: number } | null = null;
  for (const year of years) {
    for (const settlement of Object.values(states[year].settlements)) {
      if (!largestSettlement || settlement.population > largestSettlement.population) {
        largestSettlement = { id: settlement.id, population: settlement.population, year };
      }
    }
  }

  return {
    totalEvents: allEvents.length,
    firstEventYear: heat[0]?.year ?? null,
    lastEventYear: heat[heat.length - 1]?.year ?? null,
    busiestYear: busiest?.year ?? null,
    busiestYearEventCount: busiest?.eventCount ?? 0,
    mostCommonEventType: mostCommon?.[0] ?? null,
    mostCommonEventTypeCount: mostCommon?.[1] ?? 0,
    averageConfidence: allEvents.length === 0 ? 0 : allEvents.reduce((sum, event) => sum + event.confidence, 0) / allEvents.length,
    longestLivedGovernment: longestGovernment,
    longestLivedSettlement: longestSettlement,
    largestSettlement,
  };
}

export interface ReplayDiffReport {
  generatedAtYear: number;
  firstDivergentYear: number | null;
  similarity: BranchSimilarity;
  changedEntities: {
    settlements: string[];
    routes: string[];
    bridges: string[];
    governments: string[];
    landmarks: string[];
    scars: string[];
  };
  eventsOnlyInA: EventId[];
  eventsOnlyInB: EventId[];
  heatDelta: TimelineHeatPoint[];
  reportSignature: string;
}

export function generateReplayDiffReport(input: {
  year: number;
  statesA: Record<number, WorldState>;
  statesB: Record<number, WorldState>;
  yearHashesA: Record<number, string>;
  yearHashesB: Record<number, string>;
  eventsA: Record<EventId, HistoricalEvent>;
  eventsB: Record<EventId, HistoricalEvent>;
}): ReplayDiffReport {
  const stateA = input.statesA[input.year];
  const stateB = input.statesB[input.year];
  const ids = (state: WorldState | undefined, key: keyof Pick<WorldState, "settlements" | "routes" | "bridges" | "governments" | "landmarks" | "scars">) => state?.[key] ?? {};
  const semanticIds = (events: Record<EventId, HistoricalEvent>) => new Map(Object.values(events).map(event => [event.correlationKey ?? event.eventId, event.eventId]));
  const semanticA = semanticIds(input.eventsA);
  const semanticB = semanticIds(input.eventsB);
  const eventsOnlyInA = [...semanticA.entries()].filter(([key]) => !semanticB.has(key)).map(([, id]) => id).sort();
  const eventsOnlyInB = [...semanticB.entries()].filter(([key]) => !semanticA.has(key)).map(([, id]) => id).sort();
  const heatA = new Map(buildTimelineHeatmap(input.eventsA).map(point => [point.year, point]));
  const heatB = new Map(buildTimelineHeatmap(input.eventsB).map(point => [point.year, point]));
  const heatYears = [...new Set([...heatA.keys(), ...heatB.keys()])].filter(year => year <= input.year).sort((a, b) => a - b);
  const heatDelta = heatYears.map(year => ({
    year,
    eventCount: (heatB.get(year)?.eventCount ?? 0) - (heatA.get(year)?.eventCount ?? 0),
    affectedEntityCount: (heatB.get(year)?.affectedEntityCount ?? 0) - (heatA.get(year)?.affectedEntityCount ?? 0),
    stateDeltaCount: (heatB.get(year)?.stateDeltaCount ?? 0) - (heatA.get(year)?.stateDeltaCount ?? 0),
    weightedIntensity: Math.round(((heatB.get(year)?.weightedIntensity ?? 0) - (heatA.get(year)?.weightedIntensity ?? 0)) * 1000) / 1000,
    eventTypes: {},
  }));
  const similarity = scoreBranchSimilarity({
    yearHashesA: input.yearHashesA,
    yearHashesB: input.yearHashesB,
    eventsA: input.eventsA,
    eventsB: input.eventsB,
    finalStateA: stateA,
    finalStateB: stateB,
  });
  const body = {
    generatedAtYear: input.year,
    firstDivergentYear: similarity.firstDivergentYear,
    similarity,
    changedEntities: {
      settlements: changedEntityIds(ids(stateA, "settlements"), ids(stateB, "settlements")),
      routes: changedEntityIds(ids(stateA, "routes"), ids(stateB, "routes")),
      bridges: changedEntityIds(ids(stateA, "bridges"), ids(stateB, "bridges")),
      governments: changedEntityIds(ids(stateA, "governments"), ids(stateB, "governments")),
      landmarks: changedEntityIds(ids(stateA, "landmarks"), ids(stateB, "landmarks")),
      scars: changedEntityIds(ids(stateA, "scars"), ids(stateB, "scars")),
    },
    eventsOnlyInA,
    eventsOnlyInB,
    heatDelta,
  };
  return { ...body, reportSignature: stableSerialize(body) };
}
