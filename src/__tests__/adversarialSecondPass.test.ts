import { describe, expect, it } from "vitest";
import { createInitialState } from "../core/state";
import { deterministicHash } from "../core/hashing";
import { createSimulationArtifact, validateSimulationArtifact } from "../core/provenance";
import { createWorkerCancellationHandle } from "../core/workerProtocol";
import { runBranchArchive } from "../core/archiveRunner";
import { TimelineArchive } from "../timelines/archive";
import { validateTimelineArchive } from "../timelines/archiveValidation";
import { CausalLedger } from "../timelines/ledger";
import { summarizeDivergence } from "../timelines/workbench";
import type { TimelineIntervention } from "../timelines/branch";

function twoYearArchive() {
  const state = createInitialState("fixture", 2, 2);
  const builder = TimelineArchive.create("main", state, 5);
  state.year = 1;
  state.moisture[0] = 12;
  builder.record(state);
  return builder.serialize();
}

function addEvent(ledger: CausalLedger, eventId: string, year: number, parentEventIds: string[] = []) {
  ledger.addEvent({
    eventId,
    time: { year },
    eventType: "fixture",
    location: {},
    actorIds: [],
    affectedEntityIds: ["entity"],
    conditions: [],
    immediateEffects: [],
    parentEventIds,
    resultingEventIds: [],
    ruleId: "fixture_rule",
    summaryTemplate: eventId,
    summaryArguments: {},
    confidence: 1,
  });
}

describe("timeline archive trust boundary", () => {
  it("rejects missing frames and unsafe patch paths", () => {
    const archive = twoYearArchive();
    delete archive.deltas[1];
    expect(validateTimelineArchive(archive)).toContain("Year 1 must have exactly one checkpoint or delta");

    const unsafe = twoYearArchive();
    unsafe.deltas[1] = [{ op: "set", path: ["__proto__", "polluted"], value: true }];
    expect(validateTimelineArchive(unsafe).some(error => error.includes("unsafe patch path"))).toBe(true);
  });

  it("detects state tampering during materialization even when structure is valid", () => {
    const archive = twoYearArchive();
    archive.deltas[1] = [{ op: "set", path: ["moisture", 0], value: 99 }];
    expect(() => TimelineArchive.deserialize(archive).materialize(1)).toThrow(/replay hash mismatch/);
  });
});

describe("artifact provenance validation", () => {
  it("replays the final state and rejects ledger identity drift", () => {
    const archive = twoYearArchive();
    const ledger = new CausalLedger("main");
    addEvent(ledger, "event", 1);
    const artifact = createSimulationArtifact({ archive, events: ledger.exportEvents() });
    expect(validateSimulationArtifact(artifact)).toEqual([]);

    artifact.events.event.branchId = "other";
    artifact.provenance.ledgerHash = deterministicHash(artifact.events);
    expect(validateSimulationArtifact(artifact)).toContain("Event event branchId does not match artifact branch");
  });
});

describe("branch and divergence integrity", () => {
  it("rejects a branch that would replay the archive minimum year twice", () => {
    const archive = twoYearArchive();
    const intervention: TimelineIntervention = {
      interventionId: "intervention",
      parentBranchId: "main",
      newBranchId: "branch",
      insertionYear: 0,
      targetIds: ["entity"],
      operation: "suppress_event",
      parameters: {},
    };
    expect(() => runBranchArchive({ parentArchive: archive, parentEvents: {}, intervention, endYear: 1 }))
      .toThrow(/must be after archived Year 0/);
  });

  it("counts events removed from a branch instead of examining branch additions only", () => {
    const baseline = new CausalLedger("main");
    const branch = new CausalLedger("branch");
    addEvent(baseline, "kept", 0);
    addEvent(baseline, "removed", 1, ["kept"]);
    addEvent(branch, "kept", 0);
    const summary = summarizeDivergence({ 0: "a", 1: "b" }, { 0: "a", 1: "c" }, baseline, branch);
    expect(summary.removedEventCount).toBe(1);
    expect(summary.changedEventCount).toBe(1);
    expect(summary.earliestDivergenceYear).toBe(1);
  });
});

describe("worker cancellation", () => {
  it("exposes an atomic interrupt flag when SharedArrayBuffer is available", () => {
    const handle = createWorkerCancellationHandle();
    if (!handle) return;
    expect(handle.isCancelled()).toBe(false);
    handle.cancel();
    expect(handle.isCancelled()).toBe(true);
    handle.reset();
    expect(handle.isCancelled()).toBe(false);
  });
});
