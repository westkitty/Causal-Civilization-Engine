import { describe, expect, it } from "vitest";
import type { HistoricalEvent, WorldState } from "../core/types";
import { CausalLedger } from "../timelines/ledger";
import { TimelineArchive } from "../timelines/archive";
import { createSimulationArtifact, parseSimulationArtifact, serializeSimulationArtifact } from "../core/provenance";
import { BranchTree, summarizeDivergence, validateIntervention } from "../timelines/workbench";

function state(year: number): WorldState {
  return {
    seed: "archive-test",
    year,
    mapWidth: 2,
    mapHeight: 2,
    elevation: [1, 2, 3, 4],
    moisture: [4, 3, 2, 1],
    temperature: [10, 10, 10, 10],
    flowAccumulation: [0, 1, 2, 3],
    flowDirection: [0, 0, 0, 0],
    soilFertility: [5, 5, 5, 5],
    biomes: ["grassland", "forest", "ocean", "mountain"],
    resources: { oreGrade: [0, 0, 1, 1], timberStock: [0, 5, 0, 0] },
    politicalControl: {},
    settlements: year === 0 ? {} : {
      s1: {
        id: "s1", name: "One", cellId: 0, population: 10 + year,
        carryingCapacity: 100, foodAccess: 1, waterSecurity: 1, marketAccess: 0,
        diseaseBurden: 0, wealth: 100 + year, establishedYear: 1, abandoned: false,
      },
    },
    routes: {}, bridges: {}, governments: {}, cohorts: {}, landmarks: {}, scars: {},
  };
}

function event(eventId: string, year: number, branchId = "main"): HistoricalEvent {
  return {
    eventId, branchId, time: { year }, eventType: "founding", location: {},
    actorIds: [], affectedEntityIds: ["s1"], conditions: [], immediateEffects: [],
    parentEventIds: [], resultingEventIds: [], ruleId: "settlement_founding",
    summaryTemplate: "founded", summaryArguments: {}, confidence: 1,
  };
}

describe("TimelineArchive", () => {
  it("round-trips sequential states with checkpoints and deltas", () => {
    const builder = TimelineArchive.create("main", state(0), 2);
    builder.record(state(1));
    builder.record(state(2));
    const archive = builder.finish();
    expect(archive.materialize(0)).toEqual(state(0));
    expect(archive.materialize(1)).toEqual(state(1));
    expect(archive.materialize(2)).toEqual(state(2));
    expect(Object.keys(archive.serialize().checkpoints).map(Number).sort()).toEqual([0, 2]);
    expect(archive.serialize().deltas[1].length).toBeGreaterThan(0);
  });

  it("rejects static geography mutation", () => {
    const builder = TimelineArchive.create("main", state(0));
    const changed = state(1);
    changed.elevation[0] = 999;
    expect(() => builder.record(changed)).toThrow(/Static geography changed/);
  });
});

describe("Simulation artifacts", () => {
  it("exports, validates and parses a replayable artifact", () => {
    const builder = TimelineArchive.create("main", state(0));
    builder.record(state(1));
    const ledger = new CausalLedger("main");
    ledger.addEvent(event("f1", 1));
    const artifact = createSimulationArtifact({
      archive: builder.serialize(),
      events: ledger.exportEvents(),
      replayVerified: true,
    });
    const parsed = parseSimulationArtifact(serializeSimulationArtifact(artifact));
    expect(parsed.provenance.finalStateHash).toBe(builder.serialize().yearHashes[1]);
    expect(parsed.events.f1.eventId).toBe("f1");
  });
});

describe("Branch workbench", () => {
  it("validates interventions and prevents duplicate branch names", () => {
    const result = validateIntervention({
      interventionId: "i1", parentBranchId: "main", newBranchId: "main",
      insertionYear: 1, targetIds: [], operation: "suppress_event", parameters: {},
    }, { state: state(1), minYear: 0, maxYear: 2, existingBranchIds: ["main"] });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("already exists"),
      expect.stringContaining("require at least one target"),
    ]));
  });

  it("stores a named branch tree and summarizes divergence", () => {
    const tree = new BranchTree();
    tree.add({ branchId: "b1", parentBranchId: "main", name: "No crossing", createdAt: "2026-01-01T00:00:00.000Z" });
    expect(tree.childrenOf("main").map(node => node.branchId)).toEqual(["b1"]);

    const baseline = new CausalLedger("main");
    baseline.addEvent(event("f1", 1));
    const branch = new CausalLedger("b1");
    branch.addEvent({ ...event("f1", 1, "b1"), correlationKey: "f1" });
    branch.addEvent({ ...event("changed", 2, "b1"), eventType: "famine", confidence: 0.5 });
    const summary = summarizeDivergence({ 0: "a", 1: "b", 2: "c" }, { 0: "a", 1: "b", 2: "d" }, baseline, branch);
    expect(summary.earliestDivergenceYear).toBe(2);
    expect(summary.changedEventCount).toBeGreaterThan(0);
    expect(summary.affectedEntityIds).toContain("s1");
  });
});
