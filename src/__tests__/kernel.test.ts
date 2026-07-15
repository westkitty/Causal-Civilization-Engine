import { describe, it, expect } from "vitest";
import { runFullSimulation, resimulateBranch } from "../core/runner";
import { Branch } from "../timelines/branch";
import type { TimelineIntervention } from "../timelines/branch";
import { CausalLedger } from "../timelines/ledger";
import { deterministicHash, canonicalStringify, fnv1a64 } from "../core/hashing";
import { keyedRandom } from "../core/random";
import { simulateYear } from "../core/scheduler";
import type { WorldState, HistoricalEvent } from "../core/types";
import { traceCausalAncestry } from "../core/causality";
import { resolveTransportPath, findInfrastructureEvent, updateEconomy } from "../simulation/economy";
import { updateTransport } from "../simulation/transport";

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

    // Retrieve trade allocation event details
    const tradeStep = traceResult.path.find(step => step.eventType === "trade_allocation")!;
    const tradeAllocB = subLedger.getEvent(tradeStep.eventId)!;
    const tradeAllocA = parentLedger.getEvent(tradeStep.eventId)!;
    const volA = tradeAllocA.conditions[0]?.observed.find(o => o.name === "volume")?.value || 0;
    const volB = tradeAllocB.conditions[0]?.observed.find(o => o.name === "volume")?.value || 0;
    const priceA = tradeAllocA.conditions[0]?.observed.find(o => o.name === "unitPrice")?.value || 0;
    const priceB = tradeAllocB.conditions[0]?.observed.find(o => o.name === "unitPrice")?.value || 0;
    const expenseA = tradeAllocA.conditions[0]?.observed.find(o => o.name === "transportExpense")?.value || 0;
    const expenseB = tradeAllocB.conditions[0]?.observed.find(o => o.name === "transportExpense")?.value || 0;

    // Retrieve wealth event normalized delta
    const wealthStep = traceResult.path.find(step => step.eventType === "settlement_wealth_changed")!;
    const wealthEvent = subLedger.getEvent(wealthStep.eventId)!;
    const delta = wealthEvent.immediateEffects[0].after - wealthEvent.immediateEffects[0].before;

    // Assert that the trade allocation changed quantitatively (Objective 2)
    const tradeChanged = volA !== volB || priceA !== priceB || expenseA !== expenseB;
    expect(tradeChanged).toBe(true);

    // Print the diagnostic to stdout
    console.log("=== CAUSAL DIAGNOSTIC TRACE ===");
    console.log(`Focal Wealth Event Normalized Delta: ${delta.toFixed(4)}`);
    console.log(`Original Trade Volume: ${volA.toFixed(2)} | Counterfactual Trade Volume: ${volB.toFixed(2)}`);
    console.log(`Original Unit Price: ${priceA.toFixed(4)} | Counterfactual Unit Price: ${priceB.toFixed(4)}`);
    console.log(`Original Transport Expense: ${expenseA.toFixed(4)} | Counterfactual Transport Expense: ${expenseB.toFixed(4)}`);
    
    for (let i = 0; i < traceResult.path.length; i++) {
      const step = traceResult.path[i];
      console.log(`[Stage ${i + 1}] Event ID: ${step.eventId} | Year: ${step.year} | Type: ${step.eventType}`);
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

  // 12. Regression Test: Shifted baseline with identical effect delta does not verify a causal path (Objective 1)
  it("should not verify a causal path if the baseline and counterfactual have identical effect deltas on different starting balances", () => {
    const mockStateA = createMockState();
    const mockStateB = JSON.parse(JSON.stringify(mockStateA)) as WorldState;
    mockStateB.settlements["s_a"].wealth += 100; // shift baseline

    const mockLedgerA = new CausalLedger("main");
    const mockLedgerB = new CausalLedger("branch");

    const interventionId = "interv_suppress_10";
    mockLedgerB.addEvent({
      eventId: interventionId,
      time: { year: 10 },
      eventType: "timeline_intervention",
      location: {},
      actorIds: [],
      affectedEntityIds: [],
      conditions: [],
      immediateEffects: [],
      parentEventIds: [],
      resultingEventIds: [],
      ruleId: "intervention",
      summaryTemplate: "Intervention",
      summaryArguments: {},
      confidence: 1.0,
    });

    // In baseline: before 100 -> after 90 (delta = -10)
    mockLedgerA.addEvent({
      eventId: "wealth_change_s_a_event",
      time: { year: 12 },
      eventType: "settlement_wealth_changed",
      location: {},
      actorIds: ["s_a"],
      affectedEntityIds: ["s_a"],
      conditions: [],
      immediateEffects: [
        { entityId: "s_a", component: "settlements", field: "wealth", before: 100, after: 90 }
      ],
      parentEventIds: [],
      resultingEventIds: [],
      ruleId: "manual_growth",
      summaryTemplate: "Growth",
      summaryArguments: {},
      confidence: 1.0,
    });

    // In counterfactual: before 200 -> after 190 (delta = -10)
    mockLedgerB.addEvent({
      eventId: "wealth_change_s_a_event",
      time: { year: 12 },
      eventType: "settlement_wealth_changed",
      location: {},
      actorIds: ["s_a"],
      affectedEntityIds: ["s_a"],
      conditions: [],
      immediateEffects: [
        { entityId: "s_a", component: "settlements", field: "wealth", before: 200, after: 190 }
      ],
      parentEventIds: [interventionId],
      resultingEventIds: [],
      ruleId: "manual_growth",
      summaryTemplate: "Growth",
      summaryArguments: {},
      confidence: 1.0,
    });

    const query = {
      entityId: "s_a",
      field: "wealth",
      interventionEventId: interventionId,
    };

    const traceResult = traceCausalAncestry(query, mockStateA, mockStateB, mockLedgerA, mockLedgerB);
    // Since deltas are identical (-10), this is NOT considered a divergent event
    expect(traceResult.status).not.toBe("verified_causal_path");
  });

  // 13. Test: Missing requested intervention ID returns unresolved without throwing (Objective 3)
  it("should return unresolved when the requested intervention ID is missing without throwing", () => {
    const parentState = createMockState();
    const branchState = createMockState();
    const parentLedger = new CausalLedger("main");
    const subLedger = new CausalLedger("branch");

    const query = {
      entityId: "s_a",
      field: "wealth",
      interventionEventId: "nonexistent_interv",
    };

    const result = traceCausalAncestry(query, parentState, branchState, parentLedger, subLedger);
    expect(result.status).toBe("unresolved_ancestry");
    expect(result.missingEventIds).toContain("nonexistent_interv");
  });

  // 14. Test: Nonexistent parent matching the intervention string does not verify a path (Objective 3)
  it("should not verify a path if parent is nonexistent even if its ID matches the interventionId", () => {
    const mockStateA = createMockState();
    const mockStateB = JSON.parse(JSON.stringify(mockStateA)) as WorldState;
    mockStateB.settlements["s_a"].wealth += 500;

    const mockLedgerA = new CausalLedger("main");
    const mockLedgerB = new CausalLedger("branch");

    const query = {
      entityId: "s_a",
      field: "wealth",
      interventionEventId: "nonexistent_interv",
    };

    mockLedgerB.addEvent({
      eventId: "wealth_change_s_a",
      time: { year: 12 },
      eventType: "settlement_wealth_changed",
      location: {},
      actorIds: ["s_a"],
      affectedEntityIds: ["s_a"],
      conditions: [],
      immediateEffects: [
        { entityId: "s_a", component: "settlements", field: "wealth", before: 100, after: 600 }
      ],
      parentEventIds: ["nonexistent_interv"], // points to nonexistent intervention
      resultingEventIds: [],
      ruleId: "manual_growth",
      summaryTemplate: "Growth",
      summaryArguments: {},
      confidence: 1.0,
    });

    const result = traceCausalAncestry(query, mockStateA, mockStateB, mockLedgerA, mockLedgerB);
    expect(result.status).toBe("unresolved_ancestry");
    expect(result.missingEventIds).toContain("nonexistent_interv");
  });

  // 15. Test: Cycle detection (Objective 3)
  it("should detect cycle loops and report unresolved ancestry with cycle event IDs", () => {
    const mockStateA = createMockState();
    const mockStateB = JSON.parse(JSON.stringify(mockStateA)) as WorldState;
    mockStateB.settlements["s_a"].wealth += 500;

    const mockLedgerA = new CausalLedger("main");
    const mockLedgerB = new CausalLedger("branch");

    const query = {
      entityId: "s_a",
      field: "wealth",
      interventionEventId: "interv_10",
    };

    mockLedgerB.addEvent({
      eventId: "interv_10",
      time: { year: 10 },
      eventType: "timeline_intervention",
      location: {},
      actorIds: [],
      affectedEntityIds: [],
      conditions: [],
      immediateEffects: [],
      parentEventIds: [],
      resultingEventIds: [],
      ruleId: "intervention",
      summaryTemplate: "Intervention",
      summaryArguments: {},
      confidence: 1.0,
    });

    mockLedgerB.addEvent({
      eventId: "wealth_change_s_a",
      time: { year: 12 },
      eventType: "settlement_wealth_changed",
      location: {},
      actorIds: ["s_a"],
      affectedEntityIds: ["s_a"],
      conditions: [],
      immediateEffects: [
        { entityId: "s_a", component: "settlements", field: "wealth", before: 100, after: 600 }
      ],
      parentEventIds: ["cycle_event_2"],
      resultingEventIds: [],
      ruleId: "manual_growth",
      summaryTemplate: "Growth",
      summaryArguments: {},
      confidence: 1.0,
    });

    mockLedgerB.addEvent({
      eventId: "cycle_event_2",
      time: { year: 12 },
      eventType: "settlement_wealth_changed",
      location: {},
      actorIds: ["s_a"],
      affectedEntityIds: ["s_a"],
      conditions: [],
      immediateEffects: [],
      parentEventIds: ["wealth_change_s_a", "interv_10"], // cycle back to wealth_change_s_a!
      resultingEventIds: [],
      ruleId: "cycle_rule",
      summaryTemplate: "Cycle",
      summaryArguments: {},
      confidence: 1.0,
    });

    const result = traceCausalAncestry(query, mockStateA, mockStateB, mockLedgerA, mockLedgerB);
    expect(result.status).toBe("unresolved_ancestry");
    expect(result.cycleEventIds).toContain("wealth_change_s_a");
    expect(result.cycleEventIds).toContain("cycle_event_2");
  });

  // 16. Test: Forward-time parent rejection (Objective 3)
  it("should reject a path with a forward-time parent-to-child chronology violation", () => {
    const mockStateA = createMockState();
    const mockStateB = JSON.parse(JSON.stringify(mockStateA)) as WorldState;
    mockStateB.settlements["s_a"].wealth += 500;

    const mockLedgerA = new CausalLedger("main");
    const mockLedgerB = new CausalLedger("branch");

    const query = {
      entityId: "s_a",
      field: "wealth",
      interventionEventId: "interv_10",
    };

    mockLedgerB.addEvent({
      eventId: "interv_10",
      time: { year: 10 },
      eventType: "timeline_intervention",
      location: {},
      actorIds: [],
      affectedEntityIds: [],
      conditions: [],
      immediateEffects: [],
      parentEventIds: [],
      resultingEventIds: [],
      ruleId: "intervention",
      summaryTemplate: "Intervention",
      summaryArguments: {},
      confidence: 1.0,
    });

    mockLedgerB.addEvent({
      eventId: "wealth_change_s_a",
      time: { year: 12 },
      eventType: "settlement_wealth_changed",
      location: {},
      actorIds: ["s_a"],
      affectedEntityIds: ["s_a"],
      conditions: [],
      immediateEffects: [
        { entityId: "s_a", component: "settlements", field: "wealth", before: 100, after: 600 }
      ],
      parentEventIds: ["future_event"],
      resultingEventIds: [],
      ruleId: "manual_growth",
      summaryTemplate: "Growth",
      summaryArguments: {},
      confidence: 1.0,
    });

    mockLedgerB.addEvent({
      eventId: "future_event",
      time: { year: 15 }, // Year 15 is after Year 12 (chronology violation!)
      eventType: "settlement_wealth_changed",
      location: {},
      actorIds: ["s_a"],
      affectedEntityIds: ["s_a"],
      conditions: [],
      immediateEffects: [],
      parentEventIds: ["interv_10"],
      resultingEventIds: [],
      ruleId: "future_rule",
      summaryTemplate: "Future parent",
      summaryArguments: {},
      confidence: 1.0,
    });

    const result = traceCausalAncestry(query, mockStateA, mockStateB, mockLedgerA, mockLedgerB);
    expect(result.status).toBe("unresolved_ancestry");
    expect(result.chronologyViolations).toBeDefined();
    expect(result.chronologyViolations!.length).toBe(1);
    expect(result.chronologyViolations![0].parentEventId).toBe("future_event");
    expect(result.chronologyViolations![0].childEventId).toBe("wealth_change_s_a");
  });

  // 17. Test: Prefix-collision-safe infrastructure-parent lookup (Objective 4)
  it("should safely match exact entity ID in infrastructure event rather than relying on prefix string matches", () => {
    const events: HistoricalEvent[] = [
      {
        eventId: "build_road_route_abc_def_10",
        branchId: "main",
        time: { year: 10 },
        eventType: "road_construction",
        location: {},
        actorIds: [],
        affectedEntityIds: ["route_abc_def"],
        conditions: [],
        immediateEffects: [],
        parentEventIds: [],
        resultingEventIds: [],
        ruleId: "road_expansion",
        summaryTemplate: "Cleared route_abc_def",
        summaryArguments: {},
        confidence: 1.0,
      },
      {
        eventId: "build_road_route_abc_10",
        branchId: "main",
        time: { year: 10 },
        eventType: "road_construction",
        location: {},
        actorIds: [],
        affectedEntityIds: ["route_abc"],
        conditions: [],
        immediateEffects: [],
        parentEventIds: [],
        resultingEventIds: [],
        ruleId: "road_expansion",
        summaryTemplate: "Cleared route_abc",
        summaryArguments: {},
        confidence: 1.0,
      }
    ];

    const matched = findInfrastructureEvent(events, "road_construction", "route_abc", 10);
    expect(matched).toBeDefined();
    expect(matched?.eventId).toBe("build_road_route_abc_10");
  });

  // 18. Test: Residual capacity rerouting (Objective 5)
  it("should reroute a second transaction via a longer route when the first transaction fills the shortest route's capacity", () => {
    const state = createMockState();
    
    // Settlement s_a is at cell 0 (0,0), s_b is at cell 2 (2,0), s_mid is at cell 10 (0,1)
    state.settlements = {
      s_a: { id: "s_a", name: "Settlement A", cellId: 0, population: 100, carryingCapacity: 1000, foodAccess: 1, waterSecurity: 1, marketAccess: 0.5, diseaseBurden: 0, wealth: 1000, establishedYear: 0, abandoned: false },
      s_b: { id: "s_b", name: "Settlement B", cellId: 2, population: 100, carryingCapacity: 1000, foodAccess: 1, waterSecurity: 1, marketAccess: 0.5, diseaseBurden: 0, wealth: 1000, establishedYear: 0, abandoned: false },
      s_mid: { id: "s_mid", name: "Settlement Mid", cellId: 10, population: 0, carryingCapacity: 1000, foodAccess: 1, waterSecurity: 1, marketAccess: 0.5, diseaseBurden: 0, wealth: 0, establishedYear: 0, abandoned: true },
    };

    // Route 1 (cheapest route directly from A to B: travelTime = 5, capacity = 10)
    state.routes["r_cheap"] = {
      id: "r_cheap",
      type: "road",
      length: 2,
      travelTime: 5,
      capacity: 10, // low capacity!
      condition: 1.0,
      constructionYear: 0,
      points: [[0,0], [1,0], [2,0]],
    };

    // Route 2 (longer route via s_mid: A -> Mid has travelTime = 10, capacity = 100)
    state.routes["r_mid1"] = {
      id: "r_mid1",
      type: "road",
      length: 2,
      travelTime: 10,
      capacity: 100,
      condition: 1.0,
      constructionYear: 0,
      points: [[0,0], [0,1]],
    };

    // Route 3 (longer route via s_mid: Mid -> B has travelTime = 10, capacity = 100)
    state.routes["r_mid2"] = {
      id: "r_mid2",
      type: "road",
      length: 2,
      travelTime: 10,
      capacity: 100,
      condition: 1.0,
      constructionYear: 0,
      points: [[0,1], [1,1], [2,0]],
    };

    // Manually run updateEconomy logic (it calculates surplus/deficits and allocates)
    // To ensure exact conditions, let's override cohort populations so s_a has 20 surplus and s_b has 20 deficit
    // In updateEconomy, production: s_a woodcutters/merchants/farmers.
    // Let's configure cohorts:
    state.settlements["s_a"].population = 10;
    state.cohorts["s_a"] = [{ culture: "native", occupation: "farmer", wealthBand: "poor", size: 20 }]; // produces grain
    state.cohorts["s_b"] = []; // consumes grain, produces none. Population = 20, consumes 20 grain.
    state.settlements["s_b"].population = 20;

    const ledger = new CausalLedger("main");

    // Run updateEconomy
    updateEconomy(state, ledger, 1);

    // Verify two trade allocations occurred!
    const tradeAllocations = ledger.getAllEvents().filter(e => e.eventType === "trade_allocation");
    expect(tradeAllocations.length).toBe(2);

    // The first trade allocation should use r_cheap
    const firstAlloc = tradeAllocations[0];
    const pathEvent1 = ledger.getEvent(firstAlloc.parentEventIds[0])!;
    expect(pathEvent1.affectedEntityIds).toContain("r_cheap");

    // The second trade allocation should use r_mid1 and r_mid2!
    const secondAlloc = tradeAllocations[1];
    const pathEvent2 = ledger.getEvent(secondAlloc.parentEventIds[0])!;
    expect(pathEvent2.affectedEntityIds).not.toContain("r_cheap");
    expect(pathEvent2.affectedEntityIds).toContain("r_mid1");
    expect(pathEvent2.affectedEntityIds).toContain("r_mid2");

    // Price of the second allocation must be higher due to longer travel time markup
    const priceA = firstAlloc.conditions[0].observed.find(o => o.name === "unitPrice")!.value;
    const priceB = secondAlloc.conditions[0].observed.find(o => o.name === "unitPrice")!.value;
    expect(priceB).toBeGreaterThan(priceA);
  });

  // 19. Test: Seed "suppressed" has no magic behavior (Objective 6)
  it("should build bridge normally when seed is literal string suppressed", () => {
    // Use a 3x3 grid where the entire middle row (cells 3,4,5) is a river.
    // Settlements at row 0 (cell 1) and row 2 (cell 7). Path must cross the river.
    const state: WorldState = {
      seed: "suppressed",
      year: 10,
      mapWidth: 3,
      mapHeight: 3,
      elevation: new Array(9).fill(10),
      moisture: new Array(9).fill(50),
      temperature: new Array(9).fill(20),
      flowAccumulation: [0, 0, 0, 1000, 1000, 1000, 0, 0, 0], // middle row = river
      flowDirection: new Array(9).fill(0),
      soilFertility: new Array(9).fill(100),
      biomes: new Array(9).fill("grassland"),
      resources: {
        oreGrade: new Array(9).fill(0),
        timberStock: new Array(9).fill(0),
      },
      politicalControl: {},
      settlements: {
        s_a: { id: "s_a", name: "Settlement A", cellId: 1, population: 500, carryingCapacity: 1000, foodAccess: 1, waterSecurity: 1, marketAccess: 0.5, diseaseBurden: 0, wealth: 2000, establishedYear: 0, abandoned: false },
        s_b: { id: "s_b", name: "Settlement B", cellId: 7, population: 500, carryingCapacity: 1000, foodAccess: 1, waterSecurity: 1, marketAccess: 0.5, diseaseBurden: 0, wealth: 2000, establishedYear: 0, abandoned: false },
      },
      routes: {},
      bridges: {},
      governments: {},
      cohorts: {},
      landmarks: {},
      scars: {},
    };

    const branch = new Branch("main");
    const ledger = new CausalLedger("main");

    // updateTransport should construct a bridge at one of the river cells (3, 4, or 5)
    updateTransport(state, ledger, branch, 10);

    // At least one bridge must have been built
    const bridgeIds = Object.keys(state.bridges);
    expect(bridgeIds.length).toBeGreaterThan(0);
    const bridge = state.bridges[bridgeIds[0]];
    expect(bridge.status).toBe("active"); // Bridge built normally despite seed="suppressed"
  });
});
