import { describe, expect, it } from "vitest";
import type { HistoricalEvent } from "./types";
import {
  ReplayRegressionSuite,
  RulePluginRegistry,
  evaluateReplayFixture,
  generateHistoricalNarrative,
} from "./simulationOperations";
import { analyzeBranchMerge, searchHistory } from "./historicalExploration";
import { createSimulationAnalysisApi } from "./analysisFacade";

function event(overrides: Partial<HistoricalEvent> = {}): HistoricalEvent {
  return {
    eventId: "evt-1",
    branchId: "main",
    time: { year: 12 },
    eventType: "founding",
    location: {},
    actorIds: ["settlement-a"],
    affectedEntityIds: ["settlement-a"],
    conditions: [],
    immediateEffects: [],
    parentEventIds: [],
    resultingEventIds: [],
    ruleId: "rule.founding",
    summaryTemplate: "{name} was founded",
    summaryArguments: { name: "Aster" },
    confidence: 0.9,
    ...overrides,
  };
}

describe("historical narrative", () => {
  it("groups events into deterministic chronological sections", () => {
    const events = {
      "evt-1": event(),
      "evt-2": event({ eventId: "evt-2", time: { year: 38 }, eventType: "flood", summaryTemplate: "A flood struck {name}" }),
    };
    const result = generateHistoricalNarrative(events, { sectionSpanYears: 25 });
    expect(result.sections.map(section => section.startYear)).toEqual([0, 25]);
    expect(result.sections[0].paragraphs[0]).toContain("Aster");
    expect(result.signature).toMatch(/^fnv1a64:/);
  });
});

describe("rule plugin registry", () => {
  it("evaluates plugins in a stable priority order", () => {
    const registry = new RulePluginRegistry();
    registry.register({
      id: "roads",
      version: "1.0.0",
      evaluate: () => [{ pluginId: "roads", ruleId: "repair", priority: 2, description: "Repair road", payload: {} }],
    });
    registry.register({
      id: "bridges",
      version: "1.0.0",
      evaluate: () => [{ pluginId: "bridges", ruleId: "inspect", priority: 5, description: "Inspect bridge", payload: {} }],
    });
    const proposals = registry.evaluate({ year: 4, state: {} as never, events: {} });
    expect(proposals.map(item => item.pluginId)).toEqual(["bridges", "roads"]);
  });

  it("rejects proposals attributed to another plugin", () => {
    const registry = new RulePluginRegistry();
    registry.register({
      id: "roads",
      version: "1.0.0",
      evaluate: () => [{ pluginId: "other", ruleId: "bad", priority: 1, description: "Invalid", payload: {} }],
    });
    expect(() => registry.evaluate({ year: 1, state: {} as never, events: {} })).toThrow(/emitted proposal/);
  });
});

describe("replay regression fixtures", () => {
  it("reports hash, count, and final-state mismatches", () => {
    const result = evaluateReplayFixture(
      { id: "baseline", description: "baseline", seed: "seed", endYear: 2, expectedYearHashes: { 0: "a", 1: "b" }, expectedEventCount: 3 },
      { yearHashes: { 0: "a", 1: "c" }, eventCount: 2 },
    );
    expect(result.passed).toBe(false);
    expect(result.hashMismatches).toEqual([{ year: 1, expected: "b", actual: "c" }]);
    expect(result.eventCountMismatch).toEqual({ expected: 3, actual: 2 });
  });

  it("runs a stored fixture suite", () => {
    const suite = new ReplayRegressionSuite();
    suite.add({ id: "stable", description: "stable", seed: "seed", endYear: 0, expectedYearHashes: { 0: "hash" } });
    expect(suite.run(() => ({ yearHashes: { 0: "hash" }, eventCount: 0 }))[0].passed).toBe(true);
  });
});

describe("historical search and merge analysis", () => {
  it("filters and ranks matching historical events", () => {
    const results = searchHistory(
      {
        "evt-1": event(),
        "evt-2": event({ eventId: "evt-2", eventType: "flood", time: { year: 30 }, summaryTemplate: "A flood struck {name}", confidence: 0.5 }),
      },
      { text: "Aster founded", eventTypes: ["founding"], fromYear: 10, toYear: 20 },
    );
    expect(results).toHaveLength(1);
    expect(results[0].event.eventId).toBe("evt-1");
  });

  it("identifies conflicting three-way branch hashes", () => {
    const result = analyzeBranchMerge({ 0: "a", 1: "base" }, { 0: "a", 1: "left" }, { 0: "a", 1: "right" });
    expect(result.mergeable).toBe(false);
    expect(result.conflicts).toEqual([{ year: 1, left: "left", right: "right" }]);
  });
});

describe("analysis facade", () => {
  it("exposes search and provenance without UI dependencies", () => {
    const api = createSimulationAnalysisApi({ branchId: "main", states: {}, events: { "evt-1": event() }, yearHashes: {} });
    expect(api.search({ text: "Aster" })[0].event.eventId).toBe("evt-1");
    expect(api.explainEvent("evt-1").targetEventId).toBe("evt-1");
  });
});
