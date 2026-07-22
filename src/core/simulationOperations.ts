import type { EventId, HistoricalEvent, WorldState } from "./types";
import { detectTimelineAnomalies, signArtifact, stableSerialize } from "./replayDiagnostics";
import { buildTimelineHeatmap } from "./historicalAnalytics";
import { checkSimulationIntegrity } from "./historicalExploration";

export interface NarrativeSection {
  heading: string;
  startYear: number;
  endYear: number;
  eventIds: EventId[];
  paragraphs: string[];
}

export interface HistoricalNarrative {
  title: string;
  branchId: string | null;
  startYear: number | null;
  endYear: number | null;
  sections: NarrativeSection[];
  signature: string;
}

function eventSummary(event: HistoricalEvent): string {
  return event.summaryTemplate.replace(/\{([^}]+)\}/g, (_, key: string) => String(event.summaryArguments[key] ?? `{${key}}`));
}

function sentence(event: HistoricalEvent): string {
  const summary = eventSummary(event).trim();
  const text = summary.length === 0 ? `${event.eventType} occurred` : summary;
  return `In year ${event.time.year}, ${text.charAt(0).toLowerCase()}${text.slice(1)}${/[.!?]$/.test(text) ? "" : "."}`;
}

export function generateHistoricalNarrative(
  events: Record<EventId, HistoricalEvent>,
  options: { title?: string; sectionSpanYears?: number; maximumEvents?: number } = {},
): HistoricalNarrative {
  const ordered = Object.values(events)
    .sort((a, b) => a.time.year - b.time.year || b.confidence - a.confidence || a.eventId.localeCompare(b.eventId))
    .slice(0, options.maximumEvents ?? 500);
  const span = Math.max(1, Math.floor(options.sectionSpanYears ?? 25));
  const sections = new Map<number, HistoricalEvent[]>();
  for (const event of ordered) {
    const bucket = Math.floor(event.time.year / span) * span;
    const list = sections.get(bucket) ?? [];
    list.push(event);
    sections.set(bucket, list);
  }
  const narrativeSections: NarrativeSection[] = [...sections.entries()].sort(([a], [b]) => a - b).map(([startYear, sectionEvents]) => {
    const grouped = new Map<string, HistoricalEvent[]>();
    for (const event of sectionEvents) {
      const list = grouped.get(event.eventType) ?? [];
      list.push(event);
      grouped.set(event.eventType, list);
    }
    const paragraphs = [...grouped.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([type, group]) => {
        const lead = group.slice().sort((a, b) => b.confidence - a.confidence || a.time.year - b.time.year)[0];
        const remaining = group.filter(event => event !== lead).slice(0, 3);
        const tail = remaining.length ? ` Related developments included ${remaining.map(event => eventSummary(event)).join("; ")}.` : "";
        return `${sentence(lead)} This period recorded ${group.length} ${type} event${group.length === 1 ? "" : "s"}.${tail}`;
      });
    return { heading: `Years ${startYear}-${startYear + span - 1}`, startYear, endYear: startYear + span - 1, eventIds: sectionEvents.map(event => event.eventId), paragraphs };
  });
  const body = {
    title: options.title ?? "A History of the Simulated World",
    branchId: ordered[0]?.branchId ?? null,
    startYear: ordered[0]?.time.year ?? null,
    endYear: ordered.at(-1)?.time.year ?? null,
    sections: narrativeSections,
  };
  return { ...body, signature: signArtifact(body) };
}

export interface RuleContext {
  year: number;
  state: Readonly<WorldState>;
  events: Readonly<Record<EventId, HistoricalEvent>>;
}

export interface RuleProposal {
  pluginId: string;
  ruleId: string;
  priority: number;
  description: string;
  payload: Record<string, unknown>;
}

export interface SimulationRulePlugin {
  id: string;
  version: string;
  description?: string;
  evaluate(context: RuleContext): RuleProposal[];
}

export class RulePluginRegistry {
  private readonly plugins = new Map<string, SimulationRulePlugin>();

  register(plugin: SimulationRulePlugin): void {
    if (!plugin.id.trim()) throw new Error("Plugin id is required");
    if (!plugin.version.trim()) throw new Error(`Plugin ${plugin.id} requires a version`);
    if (this.plugins.has(plugin.id)) throw new Error(`Plugin ${plugin.id} is already registered`);
    this.plugins.set(plugin.id, plugin);
  }

  unregister(pluginId: string): boolean { return this.plugins.delete(pluginId); }
  list(): Array<{ id: string; version: string; description?: string }> {
    return [...this.plugins.values()].map(plugin => ({ id: plugin.id, version: plugin.version, description: plugin.description })).sort((a, b) => a.id.localeCompare(b.id));
  }

  evaluate(context: RuleContext): RuleProposal[] {
    const proposals: RuleProposal[] = [];
    for (const plugin of [...this.plugins.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      const output = plugin.evaluate(context);
      for (const proposal of output) {
        if (proposal.pluginId !== plugin.id) throw new Error(`Plugin ${plugin.id} emitted proposal for ${proposal.pluginId}`);
        if (!Number.isFinite(proposal.priority)) throw new Error(`Plugin ${plugin.id} emitted non-finite priority`);
        proposals.push(structuredClone(proposal));
      }
    }
    return proposals.sort((a, b) => b.priority - a.priority || a.pluginId.localeCompare(b.pluginId) || a.ruleId.localeCompare(b.ruleId));
  }
}

export interface ReplayRegressionFixture {
  id: string;
  description: string;
  seed: string;
  endYear: number;
  expectedYearHashes: Record<number, string>;
  expectedEventCount?: number;
  expectedFinalStateSignature?: string;
}

export interface ReplayRegressionActual {
  yearHashes: Record<number, string>;
  eventCount: number;
  finalState?: WorldState;
}

export interface ReplayRegressionResult {
  fixtureId: string;
  passed: boolean;
  hashMismatches: Array<{ year: number; expected?: string; actual?: string }>;
  eventCountMismatch?: { expected: number; actual: number };
  finalStateSignatureMismatch?: { expected: string; actual: string };
}

export function evaluateReplayFixture(fixture: ReplayRegressionFixture, actual: ReplayRegressionActual): ReplayRegressionResult {
  const years = [...new Set([...Object.keys(fixture.expectedYearHashes), ...Object.keys(actual.yearHashes)].map(Number))].sort((a, b) => a - b);
  const hashMismatches = years.filter(year => fixture.expectedYearHashes[year] !== actual.yearHashes[year]).map(year => ({ year, expected: fixture.expectedYearHashes[year], actual: actual.yearHashes[year] }));
  const eventCountMismatch = fixture.expectedEventCount !== undefined && fixture.expectedEventCount !== actual.eventCount
    ? { expected: fixture.expectedEventCount, actual: actual.eventCount }
    : undefined;
  const actualFinalSignature = actual.finalState ? signArtifact(actual.finalState) : undefined;
  const finalStateSignatureMismatch = fixture.expectedFinalStateSignature !== undefined && fixture.expectedFinalStateSignature !== actualFinalSignature
    ? { expected: fixture.expectedFinalStateSignature, actual: actualFinalSignature ?? "missing" }
    : undefined;
  return { fixtureId: fixture.id, passed: hashMismatches.length === 0 && !eventCountMismatch && !finalStateSignatureMismatch, hashMismatches, eventCountMismatch, finalStateSignatureMismatch };
}

export class ReplayRegressionSuite {
  private readonly fixtures = new Map<string, ReplayRegressionFixture>();
  add(fixture: ReplayRegressionFixture): void {
    if (this.fixtures.has(fixture.id)) throw new Error(`Fixture ${fixture.id} already exists`);
    this.fixtures.set(fixture.id, structuredClone(fixture));
  }
  remove(id: string): boolean { return this.fixtures.delete(id); }
  list(): ReplayRegressionFixture[] { return [...this.fixtures.values()].sort((a, b) => a.id.localeCompare(b.id)).map(item => structuredClone(item)); }
  run(execute: (fixture: ReplayRegressionFixture) => ReplayRegressionActual): ReplayRegressionResult[] {
    return this.list().map(fixture => evaluateReplayFixture(fixture, execute(fixture)));
  }
}

export interface SimulationHealthReport {
  status: "healthy" | "degraded" | "critical";
  score: number;
  snapshotCount: number;
  eventCount: number;
  integrityErrors: number;
  integrityWarnings: number;
  timelineAnomalies: number;
  emptyYears: number;
  hottestYear: number | null;
  hottestYearIntensity: number;
  recommendations: string[];
  signature: string;
}

export function buildSimulationHealthReport(
  states: Record<number, WorldState>,
  events: Record<EventId, HistoricalEvent>,
  yearHashes: Record<number, string>,
): SimulationHealthReport {
  const integrity = checkSimulationIntegrity(states, events);
  const frames = Object.keys(yearHashes).map(Number).sort((a, b) => a - b).map(year => ({ year, hash: yearHashes[year] }));
  const anomalies = detectTimelineAnomalies(frames);
  const heat = buildTimelineHeatmap(events);
  const hottest = heat.slice().sort((a, b) => b.weightedIntensity - a.weightedIntensity || a.year - b.year)[0];
  const years = Object.keys(states).map(Number).sort((a, b) => a - b);
  const eventYears = new Set(Object.values(events).map(event => event.time.year));
  const emptyYears = years.filter(year => !eventYears.has(year)).length;
  const integrityErrors = integrity.filter(issue => issue.severity === "error").length;
  const integrityWarnings = integrity.filter(issue => issue.severity === "warning").length;
  const penalty = integrityErrors * 12 + integrityWarnings * 3 + anomalies.length * 5;
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const recommendations: string[] = [];
  if (integrityErrors) recommendations.push("Resolve simulation integrity errors before treating replay output as authoritative.");
  if (integrityWarnings) recommendations.push("Review dangling or weakly grounded relationships reported by the integrity checker.");
  if (anomalies.length) recommendations.push("Inspect replay hash gaps or unchanged consecutive hashes.");
  if (!Object.keys(yearHashes).length) recommendations.push("Record deterministic year hashes to enable replay verification.");
  if (!recommendations.length) recommendations.push("No immediate correctness intervention is indicated.");
  const body = {
    status: (score < 60 ? "critical" : score < 85 ? "degraded" : "healthy") as SimulationHealthReport["status"],
    score,
    snapshotCount: years.length,
    eventCount: Object.keys(events).length,
    integrityErrors,
    integrityWarnings,
    timelineAnomalies: anomalies.length,
    emptyYears,
    hottestYear: hottest?.year ?? null,
    hottestYearIntensity: hottest?.weightedIntensity ?? 0,
    recommendations,
  };
  return { ...body, signature: signArtifact(body) };
}

export function simulationOperationsManifest(): string {
  return stableSerialize({
    narrative: 1,
    pluginRules: 1,
    regressionFixtures: 1,
    healthReport: 1,
  });
}
