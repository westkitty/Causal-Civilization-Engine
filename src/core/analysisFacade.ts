import type { EventId, HistoricalEvent, WorldState } from "./types";
import type { TimelineIntervention } from "../timelines/branch";
import {
  WorldProvenanceService,
  buildTimelineHeatmap,
  computeHistoricalStatistics,
  generateReplayDiffReport,
  scoreBranchSimilarity,
} from "./historicalAnalytics";
import {
  analyzeBranchMerge,
  buildEntityLifetimes,
  buildLineage,
  checkSimulationIntegrity,
  discoverInvariants,
  rankCounterfactuals,
  searchHistory,
} from "./historicalExploration";
import {
  buildSimulationHealthReport,
  generateHistoricalNarrative,
} from "./simulationOperations";

export interface BranchAnalysisInput {
  branchId: string;
  states: Record<number, WorldState>;
  events: Record<EventId, HistoricalEvent>;
  yearHashes: Record<number, string>;
}

export interface SimulationAnalysisBundle {
  branchId: string;
  health: ReturnType<typeof buildSimulationHealthReport>;
  statistics: ReturnType<typeof computeHistoricalStatistics>;
  heatmap: ReturnType<typeof buildTimelineHeatmap>;
  lifetimes: ReturnType<typeof buildEntityLifetimes>;
  settlementLineage: ReturnType<typeof buildLineage>;
  governmentLineage: ReturnType<typeof buildLineage>;
  integrity: ReturnType<typeof checkSimulationIntegrity>;
  discoveredInvariants: ReturnType<typeof discoverInvariants>;
  narrative: ReturnType<typeof generateHistoricalNarrative>;
}

export function analyzeSimulationBranch(input: BranchAnalysisInput): SimulationAnalysisBundle {
  return {
    branchId: input.branchId,
    health: buildSimulationHealthReport(input.states, input.events, input.yearHashes),
    statistics: computeHistoricalStatistics(input.states, input.events),
    heatmap: buildTimelineHeatmap(input.events),
    lifetimes: buildEntityLifetimes(input.states),
    settlementLineage: buildLineage(input.states, input.events, "settlement"),
    governmentLineage: buildLineage(input.states, input.events, "government"),
    integrity: checkSimulationIntegrity(input.states, input.events),
    discoveredInvariants: discoverInvariants(input.states),
    narrative: generateHistoricalNarrative(input.events),
  };
}

export function compareSimulationBranches(
  baseline: BranchAnalysisInput,
  candidate: BranchAnalysisInput,
  year: number,
) {
  return {
    similarity: scoreBranchSimilarity({
      yearHashesA: baseline.yearHashes,
      yearHashesB: candidate.yearHashes,
      eventsA: baseline.events,
      eventsB: candidate.events,
      finalStateA: baseline.states[year],
      finalStateB: candidate.states[year],
    }),
    diff: generateReplayDiffReport({
      year,
      statesA: baseline.states,
      statesB: candidate.states,
      yearHashesA: baseline.yearHashes,
      yearHashesB: candidate.yearHashes,
      eventsA: baseline.events,
      eventsB: candidate.events,
    }),
  };
}

export function createSimulationAnalysisApi(input: BranchAnalysisInput) {
  const provenance = new WorldProvenanceService(input.events);
  return {
    branch: () => analyzeSimulationBranch(input),
    search: (query: Parameters<typeof searchHistory>[1]) => searchHistory(input.events, query),
    explainEntity: (entityId: string, maxNodes?: number) => provenance.explainEntity(entityId, maxNodes),
    explainEvent: (eventId: EventId, maxNodes?: number) => provenance.explainEvent(eventId, maxNodes),
  };
}

export function compareCounterfactualSet(input: {
  baseline: BranchAnalysisInput;
  candidates: Array<BranchAnalysisInput & { intervention: TimelineIntervention }>;
}) {
  return rankCounterfactuals(
    {
      yearHashes: input.baseline.yearHashes,
      events: input.baseline.events,
      finalState: latestState(input.baseline.states),
    },
    input.candidates.map(candidate => ({
      id: candidate.branchId,
      intervention: candidate.intervention,
      yearHashes: candidate.yearHashes,
      events: candidate.events,
      finalState: latestState(candidate.states),
    })),
  );
}

export function analyzeThreeWayBranchMerge(
  base: BranchAnalysisInput,
  left: BranchAnalysisInput,
  right: BranchAnalysisInput,
) {
  return analyzeBranchMerge(base.yearHashes, left.yearHashes, right.yearHashes);
}

function latestState(states: Record<number, WorldState>): WorldState | undefined {
  const year = Object.keys(states).map(Number).sort((a, b) => b - a)[0];
  return year === undefined ? undefined : states[year];
}
