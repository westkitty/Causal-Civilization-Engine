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

    for (let y = 0; y <= 100; y++) {
      expect(branch1.yearHashes[y]).toBe(branch2.yearHashes[y]);
    }

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
    runFullSimulation(testSeed, parentBranch, parentLedger, 100);

    const intervention: TimelineIntervention = {
      interventionId: "interv_suppress_bridge_10",
      parentBranchId: "main",
      newBranchId: "suppress_bridge_branch",
      insertionYear: 10,
      targetIds: ["bridge_6428"],
      operation: "suppress_event",
      parameters: {},
    };

    const { branch: subBranch, ledger: subLedger } = resimulateBranch(
      parentBranch,
      parentLedger,
      intervention,
      100
    );

    for (let y = 0; y < 10; y++) {
      expect(subBranch.yearHashes[y]).toBe(parentBranch.yearHashes[y]);
    }

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

  // 7. duplicate event ID insertion rejection
  it("should throw an error when trying to add an event with a duplicate ID to the ledger", () => {
    const ledger = new CausalLedger("main");
    ledger.addEvent({
      eventId: "dup_event_id",
      time: { year: 1 },
      eventType: "test_event",
      location: {},
      actorIds: [],
      affectedEntityIds: [],
      conditions: [],
      immediateEffects: [],
      parentEventIds: [],
      resultingEventIds: [],
      ruleId: "test",
      summaryTemplate: "Test",
      summaryArguments: {},
      confidence: 1.0,
    });
    expect(() => {
      ledger.addEvent({
        eventId: "dup_event_id",
        time: { year: 2 },
        eventType: "test_event_2",
        location: {},
        actorIds: [],
        affectedEntityIds: [],
        conditions: [],
        immediateEffects: [],
        parentEventIds: [],
        resultingEventIds: [],
        ruleId: "test",
        summaryTemplate: "Test 2",
        summaryArguments: {},
        confidence: 1.0,
      });
    }).toThrow("Duplicate causal event ID: dup_event_id");
  });

  // 8. Causal tracing negative and missing-reference cases
  it("should handle unconnected branch differences and missing event references correctly", () => {
    const mockStateA = runFullSimulation(testSeed, new Branch("main"), new CausalLedger("main"), 10);
    const mockStateB = JSON.parse(JSON.stringify(mockStateA)) as WorldState;
    
    const setIds = Object.keys(mockStateB.settlements);
    expect(setIds.length).toBeGreaterThan(0);
    const targetSetId = setIds[0];
    mockStateB.settlements[targetSetId].wealth += 500;

    const mockLedgerA = new CausalLedger("main");
    const mockLedgerB = new CausalLedger("branch");

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

    mockLedgerB.addEvent({
      eventId: "random_wealth_change",
      time: { year: 12 },
      eventType: "settlement_wealth_changed",
      location: {},
      actorIds: [targetSetId],
      affectedEntityIds: [targetSetId],
      conditions: [],
      immediateEffects: [
        { entityId: targetSetId, component: "settlements", field: "wealth", before: 100, after: 600 }
      ], 
      parentEventIds: [], 
      resultingEventIds: [],
      ruleId: "manual_growth",
      summaryTemplate: "Wealth change",
      summaryArguments: {},
      confidence: 1.0,
    });

    const query = {
      entityId: targetSetId,
      field: "wealth",
      interventionEventId: "interv_10"
    };

    const unresolvedResult = traceCausalAncestry(query, mockStateA, mockStateB, mockLedgerA, mockLedgerB);
    expect(unresolvedResult.status).toBe("unresolved_ancestry");
    expect(unresolvedResult.missingEventIds.length).toBe(0);

    mockLedgerB.events["random_wealth_change"].parentEventIds = ["non_existent_event_id"];
    const missingResult = traceCausalAncestry(query, mockStateA, mockStateB, mockLedgerA, mockLedgerB);
    expect(missingResult.status).toBe("unresolved_ancestry");
    expect(missingResult.missingEventIds).toContain("non_existent_event_id");
  });

  // Helper mock factory for deterministic transport fixtures
  function createMockState(): WorldState {
    return {
      seed: "test-seed",
      year: 1,
      mapWidth: 10,
      mapHeight: 10,
      elevation: new Array(100).fill(10),
      moisture: new Array(100).fill(50),
      temperature: new Array(100).fill(20),
      flowAccumulation: new Array(100).fill(0),
      flowDirection: new Array(100).fill(0),
      soilFertility: new Array(100).fill(100),
      biomes: new Array(100).fill("grassland"),
      resources: {
        oreGrade: new Array(100).fill(0),
        timberStock: new Array(100).fill(0),
      },
      politicalControl: {},
      settlements: {
        s_a: { id: "s_a", name: "Settlement A", cellId: 0, population: 100, carryingCapacity: 1000, foodAccess: 1, waterSecurity: 1, marketAccess: 0.5, diseaseBurden: 0, wealth: 1000, establishedYear: 0, abandoned: false },
        s_b: { id: "s_b", name: "Settlement B", cellId: 9, population: 100, carryingCapacity: 1000, foodAccess: 1, waterSecurity: 1, marketAccess: 0.5, diseaseBurden: 0, wealth: 1000, establishedYear: 0, abandoned: false },
        s_c: { id: "s_c", name: "Settlement C", cellId: 99, population: 100, carryingCapacity: 1000, foodAccess: 1, waterSecurity: 1, marketAccess: 0.5, diseaseBurden: 0, wealth: 1000, establishedYear: 0, abandoned: false },
      },
      routes: {},
      bridges: {},
      governments: {},
      cohorts: {},
      landmarks: {},
      scars: {},
    };
  }

  // 9. Strengthen Transport Tests
  it("should enforce transport ranges, capacity bottlenecking, river costs, and select valid alternate routes over zero-capacity routes", () => {
    // A. Capacity bottleneck test
    const state = createMockState();
    state.routes["route_ab_1"] = {
      id: "route_ab_1",
      type: "road",
      length: 9,
      travelTime: 9,
      capacity: 15,
      condition: 1.0,
      constructionYear: 0,
      points: [[0,0], [1,0], [2,0], [3,0], [4,0], [5,0], [6,0], [7,0], [8,0], [9,0]],
    };
    const path = resolveTransportPath(state, "s_a", "s_b");
    expect(path).toBeDefined();
    expect(path?.residualCapacity).toBe(15);

    // B. Range limit check
    const stateRange = createMockState();
    stateRange.mapWidth = 50;
    stateRange.mapHeight = 50;
    stateRange.settlements["s_c"].cellId = 2499; // (49, 49) -> distance is ~69 cells
    const pathTooFar = resolveTransportPath(stateRange, "s_a", "s_c");
    expect(pathTooFar).toBeNull(); // exceeds off-network limit of 25 cells

    // C. River crossing barrier check
    const stateRiver = createMockState();
    stateRiver.mapWidth = 5;
    stateRiver.mapHeight = 5;
    stateRiver.settlements = {
      s_a: { id: "s_a", name: "Settlement A", cellId: 0, population: 100, carryingCapacity: 1000, foodAccess: 1, waterSecurity: 1, marketAccess: 0.5, diseaseBurden: 0, wealth: 1000, establishedYear: 0, abandoned: false },
      s_b: { id: "s_b", name: "Settlement B", cellId: 2, population: 100, carryingCapacity: 1000, foodAccess: 1, waterSecurity: 1, marketAccess: 0.5, diseaseBurden: 0, wealth: 1000, establishedYear: 0, abandoned: false },
    };
    stateRiver.flowAccumulation[1] = 1000; // cell 1 is a river

    const pathNoBridge = resolveTransportPath(stateRiver, "s_a", "s_b");
    expect(pathNoBridge).toBeDefined();
    const timeNoBridge = pathNoBridge!.totalTravelTime;

    stateRiver.bridges["bridge_1"] = {
      id: "bridge_1",
      routeEdgeId: "",
      cellId: 1,
      span: 10,
      constructionYear: 0,
      status: "active",
    };
    const pathWithBridge = resolveTransportPath(stateRiver, "s_a", "s_b");
    expect(pathWithBridge).toBeDefined();
    const timeWithBridge = pathWithBridge!.totalTravelTime;
    expect(timeNoBridge).toBeGreaterThan(timeWithBridge); // Bridge crossing should be cheaper

    // D. Bridge removal/ruined check
    stateRiver.bridges["bridge_1"].status = "ruined";
    const pathRuinedBridge = resolveTransportPath(stateRiver, "s_a", "s_b");
    expect(pathRuinedBridge?.totalTravelTime).toBeCloseTo(timeNoBridge, 4);

    // E. Removing unrelated bridge check
    stateRiver.bridges["bridge_1"].status = "active";
    stateRiver.bridges["bridge_unrelated"] = {
      id: "bridge_unrelated",
      routeEdgeId: "",
      cellId: 4, 
      span: 10,
      constructionYear: 0,
      status: "active",
    };
    const pathBefore = resolveTransportPath(stateRiver, "s_a", "s_b");
    stateRiver.bridges["bridge_unrelated"].status = "ruined";
    const pathAfter = resolveTransportPath(stateRiver, "s_a", "s_b");
    expect(pathBefore?.totalTravelTime).toBe(pathAfter?.totalTravelTime);

    // F. Zero-capacity cheapest route fallback selection check
    const stateAlt = createMockState();
    stateAlt.settlements = {
      s_a: { id: "s_a", name: "Settlement A", cellId: 0, population: 100, carryingCapacity: 1000, foodAccess: 1, waterSecurity: 1, marketAccess: 0.5, diseaseBurden: 0, wealth: 1000, establishedYear: 0, abandoned: false },
      s_b: { id: "s_b", name: "Settlement B", cellId: 2, population: 100, carryingCapacity: 1000, foodAccess: 1, waterSecurity: 1, marketAccess: 0.5, diseaseBurden: 0, wealth: 1000, establishedYear: 0, abandoned: false },
    };
    // Route 1 (cheapest, capacity = 0)
    stateAlt.routes["r_cheap"] = {
      id: "r_cheap",
      type: "road",
      length: 2,
      travelTime: 5,
      capacity: 0,
      condition: 1.0,
      constructionYear: 0,
      points: [[0,0], [1,0], [2,0]],
    };
    // Route 2 (longer, capacity = 20) via s_mid
    stateAlt.settlements["s_mid"] = { id: "s_mid", name: "Settlement Mid", cellId: 10, population: 100, carryingCapacity: 1000, foodAccess: 1, waterSecurity: 1, marketAccess: 0.5, diseaseBurden: 0, wealth: 1000, establishedYear: 0, abandoned: false };
    stateAlt.routes["r_mid1"] = {
      id: "r_mid1",
      type: "road",
      length: 2,
      travelTime: 5,
      capacity: 20,
      condition: 1.0,
      constructionYear: 0,
      points: [[0,0], [0,1]], 
    };
    stateAlt.routes["r_mid2"] = {
      id: "r_mid2",
      type: "road",
      length: 2,
      travelTime: 5,
      capacity: 20,
      condition: 1.0,
      constructionYear: 0,
      points: [[0,1], [1,1], [2,0]], 
    };

    const pathAlt = resolveTransportPath(stateAlt, "s_a", "s_b");
    expect(pathAlt).toBeDefined();
    expect(pathAlt?.edgeIds).toContain("r_mid1");
    expect(pathAlt?.edgeIds).toContain("r_mid2");
    expect(pathAlt?.edgeIds).not.toContain("r_cheap");
  });

  // 10. Explicit Transaction Reconciliation
  it("should reconcile transaction accounting conservation, parent links, and capacity limits", () => {
    const branch = new Branch("main");
    const ledger = new CausalLedger("main");
    const state = runFullSimulation(testSeed, branch, ledger, 40);

    const tradeAllocations = ledger.getAllEvents().filter(e => e.eventType === "trade_allocation");
    expect(tradeAllocations.length).toBeGreaterThan(0);

    const wealthEvents = ledger.getAllEvents().filter(e => e.eventType === "settlement_wealth_changed");
    const tradeWealthEvents = wealthEvents.filter(e => e.ruleId === "wealth_deduction" || e.ruleId === "wealth_addition");

    // Expected total transaction sides: 2 * tradeAllocations.length
    expect(tradeWealthEvents.length).toBe(2 * tradeAllocations.length);

    for (const alloc of tradeAllocations) {
      const buyerEvent = tradeWealthEvents.find(e => e.parentEventIds.includes(alloc.eventId) && e.ruleId === "wealth_deduction");
      const sellerEvent = tradeWealthEvents.find(e => e.parentEventIds.includes(alloc.eventId) && e.ruleId === "wealth_addition");

      expect(buyerEvent).toBeDefined();
      expect(sellerEvent).toBeDefined();

      const buyerBefore = buyerEvent!.immediateEffects[0].before;
      const buyerAfter = buyerEvent!.immediateEffects[0].after;
      const sellerBefore = sellerEvent!.immediateEffects[0].before;
      const sellerAfter = sellerEvent!.immediateEffects[0].after;

      const transportSink = alloc.conditions[0].observed.find(o => o.name === "transportExpense")?.value || 0;

      expect(buyerBefore - buyerAfter).toBeCloseTo(sellerAfter - sellerBefore + transportSink, 4);
    }

    const routeUsage: Record<string, number> = {};
    for (const alloc of tradeAllocations) {
      const pathEvent = ledger.getAllEvents().find(e => e.eventType === "transport_path_resolved" && alloc.parentEventIds.includes(e.eventId));
      if (pathEvent) {
        const vol = alloc.conditions[0].observed.find(o => o.name === "volume")?.value || 0;
        for (const entId of pathEvent.affectedEntityIds) {
          if (state.routes[entId]) {
            routeUsage[entId] = (routeUsage[entId] || 0) + vol;
          }
        }
      }
    }

    for (const rId of Object.keys(routeUsage)) {
      const route = state.routes[rId];
      if (route) {
        expect(routeUsage[rId]).toBeLessThanOrEqual(route.capacity);
      }
    }
  }, 40000);

  // 11. Complete 5-Stage Chronological Signature Chain Proof & Causal Diagnostic
  it("should verify the complete five-stage chronological signature causal chain and print diagnostic trace", () => {
    const parentBranch = new Branch("main");
    const parentLedger = new CausalLedger("main");
    const parentState = runFullSimulation(testSeed, parentBranch, parentLedger, 50);

    const activeBridges = Object.values(parentState.bridges).filter(b => b.status === "active");
    expect(activeBridges.length).toBeGreaterThan(0);
    const bridgeId = activeBridges[0].id;

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

    expect(parentState.bridges[bridgeId]).toBeDefined();
    expect(parentState.bridges[bridgeId].status).toBe("active");
    expect(branchState.bridges[bridgeId]).toBeUndefined();

    const routeId = activeBridges[0].routeEdgeId;
    expect(parentState.routes[routeId]).toBeDefined();
    expect(branchState.routes[routeId]).toBeDefined();
    expect(parentState.routes[routeId].travelTime).not.toBe(branchState.routes[routeId].travelTime);

    let divergentSetId = "";
    for (const sId of Object.keys(parentState.settlements)) {
      if (parentState.settlements[sId].wealth !== branchState.settlements[sId].wealth) {
        divergentSetId = sId;
        break;
      }
    }
    expect(divergentSetId).not.toBe("");

    const query = {
      entityId: divergentSetId,
      field: "wealth",
      interventionEventId: intervention.interventionId,
    };
    const traceResult = traceCausalAncestry(query, parentState, branchState, parentLedger, subLedger);
    expect(traceResult.status).toBe("verified_causal_path");

    // Print the diagnostic to stdout
    console.log("=== CAUSAL DIAGNOSTIC TRACE ===");
    for (let i = 0; i < traceResult.path.length; i++) {
      const step = traceResult.path[i];
      console.log(`[Stage ${i + 1}] Event ID: ${step.eventId} | Type: ${step.eventType}`);
      if (i > 0) {
        const currentEvent = subLedger.getEvent(step.eventId)!;
        const prevEvent = subLedger.getEvent(traceResult.path[i - 1].eventId)!;
        console.log(`   Child's Parent Event IDs: ${JSON.stringify(currentEvent.parentEventIds)}`);
        console.log(`   Proves previous ID (${prevEvent.eventId}) is included: ${currentEvent.parentEventIds.includes(prevEvent.eventId)}`);
        expect(currentEvent.parentEventIds).toContain(prevEvent.eventId);
      }
    }
    console.log("===============================");

    // Verify expected exact sequence of types exists chronologically
    const eventTypes = traceResult.path.map(step => step.eventType);
    const expectedSequence = [
      "timeline_intervention",
      "road_construction",
      "transport_path_resolved",
      "trade_allocation",
      "settlement_wealth_changed"
    ];

    let seqIndex = 0;
    for (const et of eventTypes) {
      if (seqIndex < expectedSequence.length && et === expectedSequence[seqIndex]) {
        seqIndex++;
      }
    }
    expect(seqIndex).toBe(expectedSequence.length);

    // Verify all path event IDs resolve
    for (const step of traceResult.path) {
      const ev = subLedger.getEvent(step.eventId);
      expect(ev).toBeDefined();
    }
  }, 40000);
});
