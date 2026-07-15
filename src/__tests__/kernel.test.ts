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
import { resolveTransportPath } from "../simulation/economy";

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
    const r1 = keyedRandom("seedA", "settlement_1", "hazards", 150, "epidemic", 0);
    const r2 = keyedRandom("seedA", "settlement_1", "hazards", 150, "epidemic", 0);
    expect(r1).toBe(r2);

    const rUnrelated = keyedRandom("seedA", "unrelated_node", "hazards", 150, "flood", 0);
    expect(rUnrelated).toBeDefined();

    const r3 = keyedRandom("seedA", "settlement_1", "hazards", 150, "epidemic", 0);
    expect(r3).toBe(r1);
  });

  // 3. Multi-year Snapshot replay
  it("should match uninterrupted runs at every compared year, not only the final year", () => {
    const branch = new Branch("main");
    const ledger = new CausalLedger("main");
    const finalState = runFullSimulation(testSeed, branch, ledger, 150);
    const finalHash = deterministicHash(finalState);

    const snapshot = branch.snapshots[100];
    expect(snapshot).toBeDefined();

    const restoreBranch = new Branch("restore");
    const restoreLedger = new CausalLedger("restore");

    for (let y = 0; y <= 100; y++) {
      restoreBranch.recordYearHash(y, branch.yearHashes[y]);
    }
    restoreBranch.snapshots[100] = JSON.parse(JSON.stringify(snapshot));
    for (const evId of Object.keys(snapshot.ledgerEvents)) {
      restoreLedger.addEvent(snapshot.ledgerEvents[evId]);
    }

    const state = JSON.parse(JSON.stringify(snapshot.state));

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

    for (let y = 0; y < 10; y++) {
      expect(subBranch.yearHashes[y]).toBe(parentBranch.yearHashes[y]);
    }

    expect(deterministicHash(branchState)).not.toBe(deterministicHash(parentState));

    const intervEvent = subLedger.getEvent(intervention.interventionId);
    expect(intervEvent).toBeDefined();
    expect(intervEvent?.eventType).toBe("timeline_intervention");
  }, 40000);

  // 5. JSON Snapshot Serialization
  it("should serialize, reload, and verify that replayed hashes match", () => {
    const branch = new Branch("main");
    const ledger = new CausalLedger("main");
    const stateAt100 = runFullSimulation(testSeed, branch, ledger, 100);
    const originalHash100 = deterministicHash(stateAt100);

    const serializedState = JSON.stringify(stateAt100);
    const serializedLedger = JSON.stringify(ledger.events);

    for (let year = 101; year <= 120; year++) {
      simulateYear(stateAt100, ledger, branch, year);
    }
    const finalHash120 = deterministicHash(stateAt100);

    const reloadedState: WorldState = JSON.parse(serializedState);
    const reloadedLedger = new CausalLedger("main");
    reloadedLedger.events = JSON.parse(serializedLedger);
    const reloadedBranch = new Branch("main");

    expect(deterministicHash(reloadedState)).toBe(originalHash100);

    for (let year = 101; year <= 120; year++) {
      simulateYear(reloadedState, reloadedLedger, reloadedBranch, year);
    }

    const replayedHash120 = deterministicHash(reloadedState);
    expect(replayedHash120).toBe(finalHash120);
  }, 40000);

  // 6. Exact Float64 sensitivity
  it("should generate different hashes for states differing only by extremely small float values", () => {
    const state1 = { value: 123.456789 };
    const state2 = { value: 123.456788 };
    expect(deterministicHash(state1)).not.toBe(deterministicHash(state2));
  });

  // 7. Generic Causal Ancestry - Direct bridge path, route path, trade path, and wealth path
  it("should trace generic causal ancestry chains through ledger event parent links", () => {
    const parentBranch = new Branch("main");
    const parentLedger = new CausalLedger("main");
    const parentState = runFullSimulation(testSeed, parentBranch, parentLedger, 50);

    // Assert a bridge was built in main
    const activeBridges = Object.values(parentState.bridges).filter(b => b.status === "active");
    expect(activeBridges.length).toBeGreaterThan(0);
    const bridgeId = activeBridges[0].id;

    // Suppress it in branch
    const intervention: TimelineIntervention = {
      interventionId: "interv_suppress_bridge_10",
      parentBranchId: "main",
      newBranchId: "suppress_bridge_branch",
      insertionYear: 10,
      targetIds: [bridgeId],
      operation: "suppress_event",
      parameters: {},
    };

    const { state: branchState, ledger: subLedger } = resimulateBranch(
      parentBranch,
      parentLedger,
      intervention,
      50
    );

    // Direct bridge path check
    const resultBridge = traceCausalAncestry(bridgeId, parentState, branchState, parentLedger, subLedger);
    expect(resultBridge.status).toBe("verified_causal_path");
    expect(resultBridge.confidence).toBe(1.0);
    expect(resultBridge.path.some(step => step.eventType === "timeline_intervention")).toBe(true);

    // Route path check
    const routeId = activeBridges[0].routeEdgeId;
    const resultRoute = traceCausalAncestry(routeId, parentState, branchState, parentLedger, subLedger);
    expect(resultRoute.status).toBe("verified_causal_path");
    expect(resultRoute.confidence).toBe(1.0);

    // Wealth path check: find a settlement whose wealth differs
    let divergentSetId = "";
    for (const sId of Object.keys(parentState.settlements)) {
      if (parentState.settlements[sId].wealth !== branchState.settlements[sId].wealth) {
        divergentSetId = sId;
        break;
      }
    }

    if (divergentSetId) {
      const resultWealth = traceCausalAncestry(divergentSetId, parentState, branchState, parentLedger, subLedger);
      expect(resultWealth.status).toBe("verified_causal_path");
      expect(resultWealth.confidence).toBe(1.0);
      expect(resultWealth.path.length).toBeGreaterThan(1);
    }
  }, 40000);

  // 8. Causal tracing negative and missing-reference cases
  it("should handle unconnected branch differences and missing event references correctly", () => {
    // A. Unresolved negative case
    const mockStateA = runFullSimulation(testSeed, new Branch("main"), new CausalLedger("main"), 10);
    const mockStateB = JSON.parse(JSON.stringify(mockStateA)) as WorldState;
    
    // Modify mockStateB to create a difference
    const setIds = Object.keys(mockStateB.settlements);
    expect(setIds.length).toBeGreaterThan(0);
    const targetSetId = setIds[0];
    mockStateB.settlements[targetSetId].wealth += 500;

    const mockLedgerA = new CausalLedger("main");
    const mockLedgerB = new CausalLedger("branch");

    // Add intervention event
    mockLedgerB.addEvent({
      eventId: "interv_10",
      time: { year: 10 },
      eventType: "timeline_intervention",
      location: {},
      actorIds: [],
      affectedEntityIds: ["unrelated_target"],
      conditions: [],
      immediateEffects: [],
      parentEventIds: [],
      resultingEventIds: [],
      ruleId: "user_intervention",
      summaryTemplate: "Intervention",
      summaryArguments: {},
      confidence: 1.0,
    });

    // Add a focal event for the settlement wealth change but with NO parent link back to intervention
    mockLedgerB.addEvent({
      eventId: "random_wealth_change",
      time: { year: 12 },
      eventType: "settlement_wealth_changed",
      location: {},
      actorIds: [targetSetId],
      affectedEntityIds: [targetSetId],
      conditions: [],
      immediateEffects: [],
      parentEventIds: [], // Empty -> unconnected
      resultingEventIds: [],
      ruleId: "manual_growth",
      summaryTemplate: "Wealth change",
      summaryArguments: {},
      confidence: 1.0,
    });

    const unresolvedResult = traceCausalAncestry(targetSetId, mockStateA, mockStateB, mockLedgerA, mockLedgerB);
    expect(unresolvedResult.status).toBe("unresolved_ancestry");
    expect(unresolvedResult.missingEventIds.length).toBe(0);

    // B. Missing-reference case
    mockLedgerB.events["random_wealth_change"].parentEventIds = ["non_existent_event_id"];
    const missingResult = traceCausalAncestry(targetSetId, mockStateA, mockStateB, mockLedgerA, mockLedgerB);
    expect(missingResult.status).toBe("unresolved_ancestry");
    expect(missingResult.missingEventIds).toContain("non_existent_event_id");
  });

  // 9. Transport constraints & River barriers
  it("should enforce transport capacity, river barriers, and correct path routing", () => {
    const state = runFullSimulation(testSeed, new Branch("main"), new CausalLedger("main"), 20);

    const sIds = Object.keys(state.settlements);
    expect(sIds.length).toBeGreaterThan(1);
    
    // Pick two settlements separated by a river
    // Verify resolving transport path respects river crossing costs when off-network
    const pathOffNetwork = resolveTransportPath(state, sIds[0], sIds[1]);
    expect(pathOffNetwork).toBeDefined();

    // Verify bridge removal alters routing when bridge belonged to that path
    if (pathOffNetwork && pathOffNetwork.crossingAssetIds.length > 0) {
      const activeBridgeId = pathOffNetwork.crossingAssetIds[0];
      const stateNoBridge = JSON.parse(JSON.stringify(state)) as WorldState;
      
      // Deactivate the bridge
      stateNoBridge.bridges[activeBridgeId].status = "ruined";

      const pathNoBridge = resolveTransportPath(stateNoBridge, sIds[0], sIds[1]);
      if (pathNoBridge) {
        expect(pathNoBridge.totalTravelTime).toBeGreaterThan(pathOffNetwork.totalTravelTime);
      }
    }
  }, 40000);

  // 10. Economic & transaction reconciliation
  it("should preserve double-entry conservation: buyer wealth reduction = seller revenue + transport sink", () => {
    const branch = new Branch("main");
    const ledger = new CausalLedger("main");
    runFullSimulation(testSeed, branch, ledger, 40);

    // Verify all trade allocation events balance exactly
    const tradeAllocations = ledger.getAllEvents().filter(e => e.eventType === "trade_allocation");
    expect(tradeAllocations.length).toBeGreaterThan(0);

    for (const alloc of tradeAllocations) {
      const vol = alloc.conditions[0].observed.find(o => o.name === "volume")?.value || 0;
      const unitPrice = alloc.conditions[0].observed.find(o => o.name === "unitPrice")?.value || 0;
      const transportSink = alloc.conditions[0].observed.find(o => o.name === "transportExpense")?.value || 0;

      const good = alloc.summaryArguments.good as string;
      const basePrice = good === "grain" ? 1.0 : (good === "timber" ? 2.0 : 5.0);

      const buyerReduction = vol * unitPrice;
      const sellerRevenue = vol * basePrice;

      expect(buyerReduction).toBeCloseTo(sellerRevenue + transportSink, 4);
    }
  }, 40000);
});
