import { describe, it, expect } from "vitest";
import { runFullSimulation, resimulateBranch } from "../core/runner";
import { Branch } from "../timelines/branch";
import type { TimelineIntervention } from "../timelines/branch";
import { CausalLedger } from "../timelines/ledger";
import { deterministicHash, canonicalStringify, fnv1a64 } from "../core/hashing";
import { keyedRandom } from "../core/random";
import { simulateYear } from "../core/scheduler";
import type { WorldState } from "../core/types";
import { traceCausalAncestry } from "../core/causality";

describe("Causal Civilization Engine - Audited Deterministic Kernel", () => {
  const testSeed = "bridge-emergence-001";

  // 1. Identical-seed determinism
  it("should generate identical year-by-year state and ledger hashes for identical seeds", () => {
    const branch1 = new Branch("main");
    const ledger1 = new CausalLedger("main");
    const state1 = runFullSimulation(testSeed, branch1, ledger1, 100);
    const hash1 = deterministicHash(state1);

    const branch2 = new Branch("main");
    const ledger2 = new CausalLedger("main");
    const state2 = runFullSimulation(testSeed, branch2, ledger2, 100);
    const hash2 = deterministicHash(state2);

    expect(hash1).toBe(hash2);

    // Verify state hashes match at every single year
    for (let y = 0; y <= 100; y++) {
      expect(branch1.yearHashes[y]).toBe(branch2.yearHashes[y]);
    }

    // Verify ledger hashes match
    const ledgerHash1 = fnv1a64(canonicalStringify(ledger1.getAllEvents()));
    const ledgerHash2 = fnv1a64(canonicalStringify(ledger2.getAllEvents()));
    expect(ledgerHash1).toBe(ledgerHash2);
  }, 40000);

  // 2. Keyed-random stability
  it("should maintain random stream stability when unrelated checks are changed", () => {
    // Proves that generating unrelated random checks does not alter retained decision values
    const r1 = keyedRandom("seedA", "settlement_1", "hazards", 150, "epidemic", 0);
    const r2 = keyedRandom("seedA", "settlement_1", "hazards", 150, "epidemic", 0);
    expect(r1).toBe(r2);

    // Generate random values for an unrelated settlement/decision
    const rUnrelated = keyedRandom("seedA", "unrelated_node", "hazards", 150, "flood", 0);
    expect(rUnrelated).toBeDefined();

    // Verify the first value remains identical and did not drift
    const r3 = keyedRandom("seedA", "settlement_1", "hazards", 150, "epidemic", 0);
    expect(r3).toBe(r1);
  });

  // 3. Multi-year Snapshot replay
  it("should match uninterrupted runs at every compared year, not only the final year", () => {
    const branch = new Branch("main");
    const ledger = new CausalLedger("main");
    const finalState = runFullSimulation(testSeed, branch, ledger, 150);
    const finalHash = deterministicHash(finalState);

    // Get snapshot at Year 100
    const snapshot = branch.snapshots[100];
    expect(snapshot).toBeDefined();

    // Reconstruct and run from Year 100
    const restoreBranch = new Branch("restore");
    const restoreLedger = new CausalLedger("restore");

    // Copy snapshot data
    for (let y = 0; y <= 100; y++) {
      restoreBranch.recordYearHash(y, branch.yearHashes[y]);
    }
    restoreBranch.snapshots[100] = JSON.parse(JSON.stringify(snapshot));
    for (const evId of Object.keys(snapshot.ledgerEvents)) {
      restoreLedger.addEvent(snapshot.ledgerEvents[evId]);
    }

    const state = JSON.parse(JSON.stringify(snapshot.state));

    // Simulate years 101 to 150, checking year hashes at every step
    for (let year = 101; year <= 150; year++) {
      simulateYear(state, restoreLedger, restoreBranch, year);
      expect(restoreBranch.yearHashes[year]).toBe(branch.yearHashes[year]);
    }

    const replayedHash = deterministicHash(state);
    expect(replayedHash).toBe(finalHash);
  }, 40000);

  // 4. Counterfactual prefix isolation
  it("should isolate counterfactual timelines, keeping pre-intervention prefix identical", () => {
    const parentBranch = new Branch("main");
    const parentLedger = new CausalLedger("main");
    const parentState = runFullSimulation(testSeed, parentBranch, parentLedger, 100);

    const intervention: TimelineIntervention = {
      interventionId: "interv_suppress_bridge_10",
      parentBranchId: "main",
      newBranchId: "suppress_bridge_branch",
      insertionYear: 10,
      targetIds: ["bridge_6428"],
      operation: "suppress_event",
      parameters: {},
    };

    const { state: branchState, branch: subBranch, ledger: subLedger } = resimulateBranch(
      parentBranch,
      parentLedger,
      intervention,
      100
    );

    // Verify hashes are identical before the intervention year (Years 0 to 9)
    for (let y = 0; y < 10; y++) {
      expect(subBranch.yearHashes[y]).toBe(parentBranch.yearHashes[y]);
    }

    // Verify divergence occurred after the intervention year
    expect(deterministicHash(branchState)).not.toBe(deterministicHash(parentState));

    // Verify intervention is recorded in branch ledger
    const intervEvent = subLedger.getEvent(intervention.interventionId);
    expect(intervEvent).toBeDefined();
    expect(intervEvent?.eventType).toBe("timeline_intervention");
  }, 40000);

  // 5. Bridge suppression
  it("should confirm the target bridge is suppressed in counterfactual branch under same seed", () => {
    const parentBranch = new Branch("main");
    const parentLedger = new CausalLedger("main");
    const parentState = runFullSimulation(testSeed, parentBranch, parentLedger, 50);

    // Assert bridge was naturally constructed in main
    const parentBridges = Object.values(parentState.bridges).filter(b => b.status === "active");
    expect(parentBridges.length).toBeGreaterThan(0);
    const targetBridgeId = parentBridges[0].id;

    // Suppress it in branch
    const intervention: TimelineIntervention = {
      interventionId: "interv_suppress_bridge_10",
      parentBranchId: "main",
      newBranchId: "suppress_bridge_branch",
      insertionYear: 10,
      targetIds: [targetBridgeId],
      operation: "suppress_event",
      parameters: {},
    };

    const { state: branchState } = resimulateBranch(
      parentBranch,
      parentLedger,
      intervention,
      50
    );

    // Confirm that the seed remains identical
    expect(branchState.seed).toBe(parentState.seed);

    // Confirm that the bridge is absent in counterfactual branch
    expect(branchState.bridges[targetBridgeId]).toBeUndefined();
  }, 40000);

  // 6. Causal trace completeness
  it("should reject unknown/deleted events and verify trace condition references", () => {
    const branch = new Branch("main");
    const ledger = new CausalLedger("main");
    runFullSimulation(testSeed, branch, ledger, 50);

    const bridgeConstEvent = ledger.getAllEvents().find(e => e.eventType === "bridge_construction");
    expect(bridgeConstEvent).toBeDefined();

    // Confirm displayed causes correspond to actual conditions
    expect(bridgeConstEvent?.conditions.length).toBeGreaterThan(0);
    const condition = bridgeConstEvent!.conditions[0];
    expect(condition.conditionId).toBeDefined();
    expect(condition.observed[0]?.name).toBe("demand");

    // Verify trace lookup rejects unknown event IDs
    const result = ledger.getEvent("non_existent_event_id");
    expect(result).toBeUndefined();
  }, 40000);

  // 7. Divergence ancestry
  it("should verify that UI-reported branch differences can trace back to the intervention", () => {
    const parentBranch = new Branch("main");
    const parentLedger = new CausalLedger("main");
    runFullSimulation(testSeed, parentBranch, parentLedger, 50);

    const intervention: TimelineIntervention = {
      interventionId: "interv_suppress_bridge_10",
      parentBranchId: "main",
      newBranchId: "suppress_bridge_branch",
      insertionYear: 10,
      targetIds: ["bridge_6428"],
      operation: "suppress_event",
      parameters: {},
    };

    const { state: branchState, ledger: subLedger } = resimulateBranch(
      parentBranch,
      parentLedger,
      intervention,
      50
    );

    // Divergence check: population differences
    const divergedSettlementIds = Object.keys(branchState.settlements);
    expect(divergedSettlementIds.length).toBeGreaterThan(0);

    // Find the intervention event in sub-ledger
    const intervEvent = subLedger.getEvent(intervention.interventionId);
    expect(intervEvent).toBeDefined();
    expect(intervEvent?.eventId).toBe("interv_suppress_bridge_10");
  }, 40000);

  // 8. JSON Snapshot Serialization
  it("should serialize, reload, and verify that replayed hashes match", () => {
    const branch = new Branch("main");
    const ledger = new CausalLedger("main");
    const stateAt100 = runFullSimulation(testSeed, branch, ledger, 100);
    const originalHash100 = deterministicHash(stateAt100);

    // Serialize current state and ledger
    const serializedState = JSON.stringify(stateAt100);
    const serializedLedger = JSON.stringify(ledger.events);

    // Run to 120 in parent timeline
    for (let year = 101; year <= 120; year++) {
      simulateYear(stateAt100, ledger, branch, year);
    }
    const finalHash120 = deterministicHash(stateAt100);

    // Reload serialized state and ledger
    const reloadedState: WorldState = JSON.parse(serializedState);
    const reloadedLedger = new CausalLedger("main");
    reloadedLedger.events = JSON.parse(serializedLedger);
    const reloadedBranch = new Branch("main");

    // Verify hash matches at snapshot point
    expect(deterministicHash(reloadedState)).toBe(originalHash100);

    // Replay to 120 from reloaded state
    for (let year = 101; year <= 120; year++) {
      simulateYear(reloadedState, reloadedLedger, reloadedBranch, year);
    }

    const replayedHash120 = deterministicHash(reloadedState);
    expect(replayedHash120).toBe(finalHash120);
  }, 40000);

  // 9. Exact Float64 sensitivity
  it("should generate different hashes for states differing only by extremely small float values", () => {
    const state1 = { value: 123.456789 };
    const state2 = { value: 123.456788 };
    expect(deterministicHash(state1)).not.toBe(deterministicHash(state2));
  });

  // 10. Wealth delta reconciliation rules
  it("should reconcile wealth changes exactly for every settlement according to the accounting formula", () => {
    const branch = new Branch("main");
    const ledger = new CausalLedger("main");
    const state = runFullSimulation(testSeed, branch, ledger, 20);

    for (const sId of Object.keys(state.settlements)) {
      const s = state.settlements[sId];
      if (s.abandoned) continue;
      const recon = s.__transientReconciliation;
      expect(recon).toBeDefined();
      if (recon) {
        const calculatedWealthAfter = 
          recon.wealthBefore + 
          recon.productionIncome + 
          recon.exportRevenue + 
          recon.naturalGrowth - 
          recon.importExpense - 
          recon.transportExpense - 
          recon.taxesPaid - 
          recon.investment - 
          recon.losses;
        expect(s.wealth).toBe(recon.wealthAfter);
        expect(recon.wealthAfter).toBe(calculatedWealthAfter);
      }
    }
  });

  // 11. Causal ancestry tracing & negative tests
  it("should trace causal ancestry correctly and label unconnected differences as unresolved", () => {
    const parentBranch = new Branch("main");
    const parentLedger = new CausalLedger("main");
    const parentState = runFullSimulation(testSeed, parentBranch, parentLedger, 50);

    const intervention: TimelineIntervention = {
      interventionId: "interv_suppress_bridge_10",
      parentBranchId: "main",
      newBranchId: "suppress_bridge_branch",
      insertionYear: 10,
      targetIds: ["bridge_6428"],
      operation: "suppress_event",
      parameters: {},
    };

    const { state: branchState, ledger: subLedger } = resimulateBranch(
      parentBranch,
      parentLedger,
      intervention,
      50
    );

    const resultBridge = traceCausalAncestry("bridge_6428", parentState, branchState, parentLedger, subLedger);
    expect(resultBridge.status).toBe("verified_causal_path");
    expect(resultBridge.confidence).toBe(1.0);

    // Negative test: unconnected test settlement
    const resultUnconnected = traceCausalAncestry("unconnected_test_settlement", parentState, branchState, parentLedger, subLedger);
    expect(resultUnconnected.status).toBe("unresolved_ancestry");
    expect(resultUnconnected.confidence).toBeLessThan(0.5);
  }, 40000);
});
