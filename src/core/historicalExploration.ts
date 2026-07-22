import type { EntityId, EventId, HistoricalEvent, WorldState } from "./types";
import type { TimelineIntervention } from "../timelines/branch";
import { planThreeWayHashMerge, stableSerialize } from "./replayDiagnostics";
import { scoreBranchSimilarity } from "./historicalAnalytics";

export interface HistoricalSearchQuery {
  text?: string;
  eventTypes?: string[];
  entityIds?: EntityId[];
  fromYear?: number;
  toYear?: number;
  minimumConfidence?: number;
}

export interface HistoricalSearchResult {
  event: HistoricalEvent;
  score: number;
  matchedFields: string[];
}

function renderSummary(event: HistoricalEvent): string {
  return event.summaryTemplate.replace(/\{([^}]+)\}/g, (_, key: string) => String(event.summaryArguments[key] ?? `{${key}}`));
}

export function searchHistory(events: Record<EventId, HistoricalEvent>, query: HistoricalSearchQuery): HistoricalSearchResult[] {
  const terms = (query.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return Object.values(events).flatMap(event => {
    if (query.eventTypes?.length && !query.eventTypes.includes(event.eventType)) return [];
    if (query.entityIds?.length && !query.entityIds.some(id => event.actorIds.includes(id) || event.affectedEntityIds.includes(id))) return [];
    if (query.fromYear !== undefined && event.time.year < query.fromYear) return [];
    if (query.toYear !== undefined && event.time.year > query.toYear) return [];
    if (query.minimumConfidence !== undefined && event.confidence < query.minimumConfidence) return [];
    const fields = {
      summary: renderSummary(event).toLowerCase(),
      eventType: event.eventType.toLowerCase(),
      ruleId: event.ruleId.toLowerCase(),
      entities: [...event.actorIds, ...event.affectedEntityIds].join(" ").toLowerCase(),
    };
    const matchedFields = Object.entries(fields).filter(([, value]) => terms.some(term => value.includes(term))).map(([key]) => key);
    if (terms.length && !terms.every(term => Object.values(fields).some(value => value.includes(term)))) return [];
    const score = matchedFields.length * 10 + event.confidence * 5 + Math.max(0, 1 - Math.abs((query.toYear ?? event.time.year) - event.time.year) / 1000);
    return [{ event, score, matchedFields }];
  }).sort((a, b) => b.score - a.score || b.event.time.year - a.event.time.year || a.event.eventId.localeCompare(b.event.eventId));
}

export interface ScenarioDefinition {
  id: string;
  name: string;
  description: string;
  seed: string;
  baseBranchId: string;
  endYear: number;
  interventions: TimelineIntervention[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export class ScenarioLibrary {
  private readonly scenarios = new Map<string, ScenarioDefinition>();
  upsert(scenario: ScenarioDefinition): void {
    if (!scenario.id || !scenario.name || !scenario.seed) throw new Error("Scenario id, name, and seed are required");
    if (!Number.isInteger(scenario.endYear) || scenario.endYear < 0) throw new Error("Scenario endYear must be a non-negative integer");
    this.scenarios.set(scenario.id, structuredClone(scenario));
  }
  get(id: string): ScenarioDefinition | undefined { const value = this.scenarios.get(id); return value ? structuredClone(value) : undefined; }
  remove(id: string): boolean { return this.scenarios.delete(id); }
  list(tag?: string): ScenarioDefinition[] {
    return [...this.scenarios.values()].filter(item => !tag || item.tags.includes(tag)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name)).map(item => structuredClone(item));
  }
  export(): ScenarioDefinition[] { return this.list(); }
  import(scenarios: ScenarioDefinition[]): void { for (const scenario of scenarios) this.upsert(scenario); }
}

export interface EntityLifetime {
  entityId: string;
  kind: string;
  firstYear: number;
  lastYear: number;
  observedYears: number;
  gaps: number[];
}

export function buildEntityLifetimes(states: Record<number, WorldState>): EntityLifetime[] {
  const observations = new Map<string, { kind: string; years: number[] }>();
  const selectors: Array<[string, (state: WorldState) => Record<string, unknown>]> = [
    ["settlement", state => state.settlements], ["route", state => state.routes], ["bridge", state => state.bridges],
    ["government", state => state.governments], ["landmark", state => state.landmarks], ["scar", state => state.scars],
  ];
  for (const year of Object.keys(states).map(Number).sort((a, b) => a - b)) {
    for (const [kind, select] of selectors) for (const id of Object.keys(select(states[year]))) {
      const key = `${kind}:${id}`;
      const item = observations.get(key) ?? { kind, years: [] };
      item.years.push(year);
      observations.set(key, item);
    }
  }
  return [...observations.entries()].map(([key, item]) => {
    const entityId = key.slice(item.kind.length + 1);
    const uniqueYears = [...new Set(item.years)].sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let year = uniqueYears[0]; year <= uniqueYears[uniqueYears.length - 1]; year++) if (!uniqueYears.includes(year)) gaps.push(year);
    return { entityId, kind: item.kind, firstYear: uniqueYears[0], lastYear: uniqueYears.at(-1) as number, observedYears: uniqueYears.length, gaps };
  }).sort((a, b) => a.firstYear - b.firstYear || a.kind.localeCompare(b.kind) || a.entityId.localeCompare(b.entityId));
}

export interface LineageNode { id: string; kind: "settlement" | "government"; firstYear: number; lastYear: number; parentIds: string[]; childIds: string[]; evidenceEventIds: EventId[]; }

export function buildLineage(states: Record<number, WorldState>, events: Record<EventId, HistoricalEvent>, kind: "settlement" | "government"): LineageNode[] {
  const lifetimes = buildEntityLifetimes(states).filter(item => item.kind === kind);
  const nodes = new Map(lifetimes.map(item => [item.entityId, { id: item.entityId, kind, firstYear: item.firstYear, lastYear: item.lastYear, parentIds: [] as string[], childIds: [] as string[], evidenceEventIds: [] as EventId[] }]));
  for (const event of Object.values(events)) {
    const ids = [...new Set([...event.actorIds, ...event.affectedEntityIds])].filter(id => nodes.has(id));
    if (ids.length < 2) continue;
    const older = ids.filter(id => (nodes.get(id) as LineageNode).firstYear < event.time.year);
    const newer = ids.filter(id => (nodes.get(id) as LineageNode).firstYear >= event.time.year);
    for (const parent of older) for (const child of newer) if (parent !== child) {
      const p = nodes.get(parent) as LineageNode;
      const c = nodes.get(child) as LineageNode;
      if (!p.childIds.includes(child)) p.childIds.push(child);
      if (!c.parentIds.includes(parent)) c.parentIds.push(parent);
      if (!p.evidenceEventIds.includes(event.eventId)) p.evidenceEventIds.push(event.eventId);
      if (!c.evidenceEventIds.includes(event.eventId)) c.evidenceEventIds.push(event.eventId);
    }
  }
  return [...nodes.values()].map(node => ({ ...node, parentIds: node.parentIds.sort(), childIds: node.childIds.sort(), evidenceEventIds: node.evidenceEventIds.sort() }));
}

export interface IntegrityIssue { severity: "error" | "warning"; code: string; message: string; year?: number; entityId?: string; eventId?: string; }

export function checkSimulationIntegrity(states: Record<number, WorldState>, events: Record<EventId, HistoricalEvent>): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const years = Object.keys(states).map(Number).sort((a, b) => a - b);
  for (const year of years) {
    const state = states[year];
    if (state.year !== year) issues.push({ severity: "error", code: "state_year_mismatch", message: `Snapshot key ${year} contains state year ${state.year}`, year });
    for (const settlement of Object.values(state.settlements)) {
      if (!Number.isFinite(settlement.population) || settlement.population < 0) issues.push({ severity: "error", code: "invalid_population", message: "Settlement population is negative or non-finite", year, entityId: settlement.id });
      if (settlement.abandoned && settlement.abandonedYear !== undefined && settlement.abandonedYear > year) issues.push({ severity: "error", code: "future_abandonment", message: "Settlement is abandoned before its abandonedYear", year, entityId: settlement.id });
    }
    for (const government of Object.values(state.governments)) {
      if (!state.settlements[government.capitalId]) issues.push({ severity: "warning", code: "missing_capital", message: "Government capital does not exist in this snapshot", year, entityId: government.id });
      if (government.legitimacy < 0 || government.legitimacy > 1) issues.push({ severity: "error", code: "invalid_legitimacy", message: "Government legitimacy is outside 0..1", year, entityId: government.id });
    }
    for (const route of Object.values(state.routes)) if (route.condition < 0 || route.condition > 1) issues.push({ severity: "error", code: "invalid_route_condition", message: "Route condition is outside 0..1", year, entityId: route.id });
    for (const bridge of Object.values(state.bridges)) if (!state.routes[bridge.routeEdgeId]) issues.push({ severity: "error", code: "orphan_bridge", message: "Bridge references a missing route", year, entityId: bridge.id });
  }
  for (const event of Object.values(events)) {
    for (const parentId of event.parentEventIds) if (!events[parentId]) issues.push({ severity: "error", code: "missing_parent_event", message: `Missing parent event ${parentId}`, eventId: event.eventId });
    for (const childId of event.resultingEventIds) if (!events[childId]) issues.push({ severity: "warning", code: "missing_result_event", message: `Missing resulting event ${childId}`, eventId: event.eventId });
    if (event.confidence < 0 || event.confidence > 1) issues.push({ severity: "error", code: "invalid_event_confidence", message: "Event confidence is outside 0..1", eventId: event.eventId });
  }
  return issues;
}

export interface DiscoveredInvariant { name: string; confidence: number; observations: number; violations: number; description: string; }

export function discoverInvariants(states: Record<number, WorldState>): DiscoveredInvariant[] {
  const candidates: Array<[string, string, (state: WorldState) => boolean]> = [
    ["non_negative_population", "All settlement populations are non-negative", state => Object.values(state.settlements).every(item => item.population >= 0)],
    ["valid_government_legitimacy", "Government legitimacy remains within 0..1", state => Object.values(state.governments).every(item => item.legitimacy >= 0 && item.legitimacy <= 1)],
    ["valid_route_condition", "Route condition remains within 0..1", state => Object.values(state.routes).every(item => item.condition >= 0 && item.condition <= 1)],
    ["bridges_have_routes", "Every bridge references an existing route", state => Object.values(state.bridges).every(item => Boolean(state.routes[item.routeEdgeId]))],
    ["governments_have_capitals", "Every government references an existing capital settlement", state => Object.values(state.governments).every(item => Boolean(state.settlements[item.capitalId]))],
  ];
  const snapshots = Object.values(states);
  return candidates.map(([name, description, predicate]) => {
    const violations = snapshots.filter(state => !predicate(state)).length;
    return { name, description, observations: snapshots.length, violations, confidence: snapshots.length === 0 ? 0 : 1 - violations / snapshots.length };
  }).sort((a, b) => b.confidence - a.confidence || b.observations - a.observations || a.name.localeCompare(b.name));
}

export interface CounterfactualCandidate { id: string; intervention: TimelineIntervention; yearHashes: Record<number, string>; events: Record<EventId, HistoricalEvent>; finalState?: WorldState; }
export interface RankedCounterfactual { id: string; impactScore: number; similarityScore: number; firstDivergentYear: number | null; intervention: TimelineIntervention; }

export function rankCounterfactuals(baseline: Omit<CounterfactualCandidate, "id" | "intervention">, candidates: CounterfactualCandidate[]): RankedCounterfactual[] {
  return candidates.map(candidate => {
    const similarity = scoreBranchSimilarity({ yearHashesA: baseline.yearHashes, yearHashesB: candidate.yearHashes, eventsA: baseline.events, eventsB: candidate.events, finalStateA: baseline.finalState, finalStateB: candidate.finalState });
    return { id: candidate.id, impactScore: Math.round((100 - similarity.score) * 100) / 100, similarityScore: similarity.score, firstDivergentYear: similarity.firstDivergentYear, intervention: candidate.intervention };
  }).sort((a, b) => b.impactScore - a.impactScore || (a.firstDivergentYear ?? Infinity) - (b.firstDivergentYear ?? Infinity) || a.id.localeCompare(b.id));
}

export interface BranchMergeAnalysis { mergeable: boolean; conflicts: Array<{ year: number; left?: string; right?: string }>; resolutions: Array<{ year: number; source: "same" | "left" | "right"; hash?: string }>; signature: string; }

export function analyzeBranchMerge(base: Record<number, string>, left: Record<number, string>, right: Record<number, string>): BranchMergeAnalysis {
  const plan = planThreeWayHashMerge(base, left, right);
  const conflicts = plan.filter(item => item.resolution === "conflict").map(item => ({ year: item.year, left: item.left, right: item.right }));
  const resolutions = plan.filter(item => item.resolution !== "conflict").map(item => ({ year: item.year, source: item.resolution as "same" | "left" | "right", hash: item.hash }));
  const body = { mergeable: conflicts.length === 0, conflicts, resolutions };
  return { ...body, signature: stableSerialize(body) };
}
