import { describe, it, expect } from "vitest";
import type { WorldState, HistoricalEvent, ConditionEvidence, StateDelta, Cohort } from "../core/types";
import { runFullSimulation, resimulateBranch } from "../core/runner";
import { Branch } from "../timelines/branch";
import type { TimelineIntervention } from "../timelines/branch";
import { CausalLedger } from "../timelines/ledger";
import { deterministicHash } from "../core/hashing";
import { simulateYear } from "../core/scheduler";
import {
  updateEconomy,
  resolveTransportPath,
  buildTransportPathSignature,
  OFFNET_ANNUAL_CAPACITY,
} from "../simulation/economy";
import {
  eventsDiffer,
  getEventCorrelationKey,
  findCorrelatedEvent,
  aggregateTradeMechanism,
} from "../core/causality";
import { acceptResult } from "../core/requestGuard";
import { initializeGovernments, updatePolitics } from "../simulation/politics";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function baseGrid(width: number, height: number): WorldState {
  const size = width * height;
  return {
    seed: "repairs-seed",
    year: 1,
    mapWidth: width,
    mapHeight: height,
    elevation: new Array(size).fill(10),
    moisture: new Array(size).fill(50),
    temperature: new Array(size).fill(20),
    flowAccumulation: new Array(size).fill(0),
    flowDirection: new Array(size).fill(0),
    soilFertility: new Array(size).fill(0),
    biomes: new Array(size).fill("grassland"),
    resources: { oreGrade: new Array(size).fill(0), timberStock: new Array(size).fill(0) },
    politicalControl: {},
    settlements: {},
    routes: {},
    bridges: {},
    governments: {},
    cohorts: {},
    landmarks: {},
    scars: {},
  };
}

function mkSettlement(id: string, cellId: number, population: number, wealth: number) {
  return {
    id, name: id, cellId, population, carryingCapacity: 100000,
    foodAccess: 1, waterSecurity: 1, marketAccess: 0.5, diseaseBurden: 0,
    wealth, establishedYear: 0, abandoned: false,
  };
}

// Two settlements 5 cells apart with NO road between them → forces off-network.
function mkOffnetState(): WorldState {
  const s = baseGrid(12, 12);
  s.settlements = {
    s_a: mkSettlement("s_a", 0, 50, 100000),   // (0,0)
    s_b: mkSettlement("s_b", 5, 50, 100000),   // (5,0)
  };
  s.cohorts = {
    s_a: [{ culture: "c", occupation: "farmer", wealthBand: "poor", size: 400 } as Cohort],     // grain
    s_b: [{ culture: "c", occupation: "woodcutter", wealthBand: "poor", size: 400 } as Cohort], // timber
  };
  return s;
}

function offnetTradeVolume(ledger: CausalLedger): number {
  let total = 0;
  // Sum volumes of trade_allocation events whose resolved path was off-network.
  const pathById = new Map<string, HistoricalEvent>();
  for (const ev of ledger.getAllEvents()) {
    if (ev.eventType === "transport_path_resolved") pathById.set(ev.eventId, ev);
  }
  for (const ev of ledger.getAllEvents()) {
    if (ev.eventType !== "trade_allocation") continue;
    const parent = pathById.get(ev.parentEventIds[0]);
    if (parent && parent.summaryArguments?.mode === "off_network") {
      total += ev.conditions[0]?.observed.find(o => o.name === "volume")?.value ?? 0;
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// C2 — Off-network annual capacity
// ---------------------------------------------------------------------------

describe("Off-network transport capacity (C2)", () => {
  it("enforces the annual off-network limit and does not reset mid-year", () => {
    const state = mkOffnetState();
    // s_a produces grain surplus; s_b needs grain. No route → off-network.
    const ledger = new CausalLedger("main");
    updateEconomy(state, ledger, 1);
    const vol = offnetTradeVolume(ledger);
    expect(vol).toBeGreaterThan(0);
    expect(vol).toBeLessThanOrEqual(OFFNET_ANNUAL_CAPACITY + 1e-9);
    // With ample surplus/deficit/wealth the annual budget is fully consumed.
    expect(vol).toBeCloseTo(OFFNET_ANNUAL_CAPACITY, 6);
  });

  it("shares the same budget across opposite directions on the same corridor", () => {
    const state = mkOffnetState();
    // grain flows s_a -> s_b (grain surplus at s_a, deficit at s_b),
    // timber flows s_b -> s_a (timber surplus at s_b, deficit at s_a).
    const ledger = new CausalLedger("main");
    updateEconomy(state, ledger, 1);
    const total = offnetTradeVolume(ledger);
    // If direction sharing failed, both directions would each draw ~10 (=20).
    expect(total).toBeCloseTo(OFFNET_ANNUAL_CAPACITY, 6);
  });

  it("resets to a fresh budget in the next simulation year", () => {
    const state = mkOffnetState();
    const l1 = new CausalLedger("main");
    updateEconomy(state, l1, 1);
    const v1 = offnetTradeVolume(l1);
    const l2 = new CausalLedger("main");
    updateEconomy(state, l2, 2);
    const v2 = offnetTradeVolume(l2);
    expect(v1).toBeGreaterThan(0);
    expect(v2).toBeGreaterThan(0); // fresh year → fresh capacity, not stuck at 0
  });

  it("produces a direction-independent off-network capacity key", () => {
    const state = mkOffnetState();
    const ab = resolveTransportPath(state, "s_a", "s_b");
    const ba = resolveTransportPath(state, "s_b", "s_a");
    expect(ab?.mode).toBe("off_network");
    expect(ba?.mode).toBe("off_network");
    expect(ab?.capacityKeys).toEqual(ba?.capacityKeys); // same shared key both ways
    expect(ab?.capacityKeys[0].startsWith("offnet:")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Network capacity across goods
// ---------------------------------------------------------------------------

describe("Network route capacity across multiple goods", () => {
  it("cannot exceed a route's capacity when two goods share it", () => {
    const state = baseGrid(6, 3);
    state.settlements = {
      s_a: mkSettlement("s_a", 0, 10, 100000),
      s_b: mkSettlement("s_b", 2, 400, 100000),
    };
    // s_a produces grain and metal surplus; s_b consumes both.
    state.cohorts = {
      s_a: [
        { culture: "c", occupation: "farmer", wealthBand: "p", size: 500 } as Cohort,
        { culture: "c", occupation: "merchant", wealthBand: "p", size: 500 } as Cohort,
      ],
      s_b: [],
    };
    state.resources.oreGrade = state.resources.oreGrade.map(() => 100);
    state.routes["r_ab"] = {
      id: "r_ab", type: "road", length: 2, travelTime: 2, capacity: 15,
      condition: 1, constructionYear: 0, points: [[0, 0], [1, 0], [2, 0]],
    };
    const ledger = new CausalLedger("main");
    updateEconomy(state, ledger, 1);

    let usage = 0;
    for (const ev of ledger.getAllEvents()) {
      if (ev.eventType !== "trade_allocation") continue;
      const path = ledger.getEvent(ev.parentEventIds[0]);
      if (path?.affectedEntityIds.includes("r_ab")) {
        usage += ev.conditions[0].observed.find(o => o.name === "volume")?.value ?? 0;
      }
    }
    expect(usage).toBeGreaterThan(0);
    expect(usage).toBeLessThanOrEqual(15 + 1e-9);
  });
});

// ---------------------------------------------------------------------------
// C3 — Semantic cross-branch correlation
// ---------------------------------------------------------------------------

function mkEvent(over: Partial<HistoricalEvent>): HistoricalEvent {
  return {
    eventId: "e", branchId: "main", time: { year: 5 }, eventType: "trade_allocation",
    location: {}, actorIds: [], affectedEntityIds: [], conditions: [],
    immediateEffects: [], parentEventIds: [], resultingEventIds: [],
    ruleId: "r", summaryTemplate: "", summaryArguments: {}, confidence: 1,
    ...over,
  };
}

describe("Semantic event correlation (C3)", () => {
  it("getEventCorrelationKey prefers correlationKey, falls back to eventId", () => {
    expect(getEventCorrelationKey(mkEvent({ eventId: "raw1", correlationKey: "corr" }))).toBe("corr");
    expect(getEventCorrelationKey(mkEvent({ eventId: "raw1" }))).toBe("raw1");
  });

  it("findCorrelatedEvent matches by correlationKey across differing raw IDs", () => {
    const ledgerA = new CausalLedger("main");
    ledgerA.addEvent(mkEvent({ eventId: "A_raw_0", correlationKey: "trade:5:x:y:grain:0" }));
    // Unrelated earlier event shifts nothing because keys are pair-scoped.
    ledgerA.addEvent(mkEvent({ eventId: "A_raw_unrelated", correlationKey: "trade:5:p:q:grain:0" }));
    const evB = mkEvent({ eventId: "B_raw_7", correlationKey: "trade:5:x:y:grain:0" });
    const found = findCorrelatedEvent(ledgerA, evB);
    expect(found?.eventId).toBe("A_raw_0");
  });

  it("aggregateTradeMechanism aggregates volume, weighted price, expense", () => {
    const ledger = new CausalLedger("main");
    const trade = (vol: number, price: number, expense: number, ord: number) => mkEvent({
      eventId: `trade_${ord}`,
      correlationKey: `trade:5:s:b:grain:${ord}`,
      eventType: "trade_allocation",
      time: { year: 5 },
      actorIds: ["s", "b"],
      summaryArguments: { good: "grain" },
      conditions: [{
        conditionId: `c${ord}`, predicateType: "price_and_volume", subjectIds: ["s", "b"],
        observed: [
          { name: "volume", value: vol },
          { name: "unitPrice", value: price },
          { name: "transportExpense", value: expense },
        ],
        result: true, role: "necessary", sourceSystem: "economy", uncertainty: 0,
      }],
    });
    ledger.addEvent(trade(10, 2, 1, 0));
    ledger.addEvent(trade(30, 4, 3, 1));
    const agg = aggregateTradeMechanism(ledger, 5, "s", "b", "grain");
    expect(agg.totalVolume).toBe(40);
    expect(agg.weightedPrice).toBeCloseTo((10 * 2 + 30 * 4) / 40, 9);
    expect(agg.transportExpense).toBe(4);
    expect(agg.allocations).toBe(2);
  });

  it("trade event IDs and correlation keys are branch-stable (pair-scoped, not global)", () => {
    // Run baseline and a branch; the focal pair's trade correlationKey must be
    // identical across branches even though other trades differ.
    const pb = new Branch("main"); const pl = new CausalLedger("main");
    runFullSimulation("bridge-emergence-001", pb, pl, 30);
    const iv: TimelineIntervention = {
      interventionId: "iv", parentBranchId: "main", newBranchId: "b",
      insertionYear: 10, targetIds: ["bridge_6428"], operation: "suppress_event", parameters: {},
    };
    const { ledger: sl } = resimulateBranch(pb, pl, iv, 30);
    // Every trade correlation key present in BOTH ledgers must map to a single
    // event on each side (no counter drift producing collisions/misses).
    const keysA = new Set(pl.getAllEvents().filter(e => e.eventType === "trade_allocation").map(getEventCorrelationKey));
    let shared = 0;
    for (const ev of sl.getAllEvents()) {
      if (ev.eventType !== "trade_allocation") continue;
      if (keysA.has(getEventCorrelationKey(ev))) {
        const corr = findCorrelatedEvent(pl, ev);
        expect(corr).toBeDefined();
        shared++;
      }
    }
    expect(shared).toBeGreaterThan(0);
  }, 40000);
});

// ---------------------------------------------------------------------------
// H1 — Symmetric event comparison (adversarial fixtures)
// ---------------------------------------------------------------------------

describe("Symmetric event comparison (H1)", () => {
  const cond = (over: Partial<ConditionEvidence>): ConditionEvidence => ({
    conditionId: "c", predicateType: "p", subjectIds: [], observed: [],
    result: true, role: "necessary", sourceSystem: "sys", uncertainty: 0, ...over,
  });
  const eff = (before: number, after: number): StateDelta =>
    ({ entityId: "e1", component: "settlements", field: "wealth", before, after });

  const A = () => mkEvent({
    eventId: "A", actorIds: ["x", "y"], affectedEntityIds: ["a", "b"],
    parentEventIds: ["p1", "p2"],
    immediateEffects: [eff(100, 90)],
    conditions: [cond({ conditionId: "cA", observed: [{ name: "v", value: 3 }] })],
  });

  it("same sets in different order are equal", () => {
    const b = mkEvent({
      eventId: "B", actorIds: ["y", "x"], affectedEntityIds: ["b", "a"],
      parentEventIds: ["p2", "p1"],
      immediateEffects: [eff(100, 90)],
      conditions: [cond({ conditionId: "cB", observed: [{ name: "v", value: 3 }] })],
    });
    expect(eventsDiffer(b, A(), "e1", "wealth", "iv")).toBe(false);
  });

  it("extra condition on B differs", () => {
    const b = A(); b.conditions = [...b.conditions, cond({ conditionId: "c2", predicateType: "q" })];
    expect(eventsDiffer(b, A(), "e1", "wealth", "iv")).toBe(true);
  });

  it("extra condition on A differs", () => {
    const a = A(); a.conditions = [...a.conditions, cond({ conditionId: "c2", predicateType: "q" })];
    expect(eventsDiffer(A(), a, "e1", "wealth", "iv")).toBe(true);
  });

  it("extra observation on either side differs", () => {
    const b = A();
    b.conditions = [cond({ conditionId: "cB", observed: [{ name: "v", value: 3 }, { name: "w", value: 1 }] })];
    expect(eventsDiffer(b, A(), "e1", "wealth", "iv")).toBe(true);
  });

  it("repeated predicate types are compared as a multiset", () => {
    const two = () => mkEvent({
      immediateEffects: [eff(100, 90)],
      conditions: [
        cond({ conditionId: "c1", predicateType: "p", observed: [{ name: "v", value: 1 }] }),
        cond({ conditionId: "c2", predicateType: "p", observed: [{ name: "v", value: 2 }] }),
      ],
    });
    const one = mkEvent({
      immediateEffects: [eff(100, 90)],
      conditions: [cond({ conditionId: "c1", predicateType: "p", observed: [{ name: "v", value: 1 }] })],
    });
    expect(eventsDiffer(two(), two(), "e1", "wealth", "iv")).toBe(false);
    expect(eventsDiffer(two(), one, "e1", "wealth", "iv")).toBe(true);
  });

  it("multiple matching effects: a differing delta is detected", () => {
    const a = mkEvent({ immediateEffects: [eff(100, 90), eff(50, 40)] });
    const b = mkEvent({ immediateEffects: [eff(100, 90), eff(50, 45)] });
    expect(eventsDiffer(b, a, "e1", "wealth", "iv")).toBe(true);
  });

  it("shifted event year differs", () => {
    const b = A(); b.time = { year: 6 };
    expect(eventsDiffer(b, A(), "e1", "wealth", "iv")).toBe(true);
  });

  it("same delta on different starting balances does NOT differ", () => {
    const a = mkEvent({ immediateEffects: [eff(100, 90)] });   // delta -10
    const b = mkEvent({ immediateEffects: [eff(200, 190)] });  // delta -10
    expect(eventsDiffer(b, a, "e1", "wealth", "iv")).toBe(false);
  });

  it("different mechanism (observation value) differs", () => {
    const b = A();
    b.conditions = [cond({ conditionId: "cB", observed: [{ name: "v", value: 4 }] })];
    expect(eventsDiffer(b, A(), "e1", "wealth", "iv")).toBe(true);
  });

  it("only the intervention id in parents does not by itself differ", () => {
    const b = A(); b.parentEventIds = ["p1", "p2", "iv"];
    expect(eventsDiffer(b, A(), "e1", "wealth", "iv")).toBe(false);
  });
});

describe("Transport path signature (buildTransportPathSignature)", () => {
  it("is deterministic and independent of crossing-asset order", () => {
    const s1 = buildTransportPathSignature("network", ["r1", "r2"], ["r1", "r2"], ["bA", "bB"]);
    const s2 = buildTransportPathSignature("network", ["r1", "r2"], ["r1", "r2"], ["bB", "bA"]);
    expect(s1).toBe(s2);
    const s3 = buildTransportPathSignature("network", ["r2", "r1"], ["r1", "r2"], ["bA", "bB"]);
    expect(s3).not.toBe(s1); // ordered edges are significant
  });
});

// ---------------------------------------------------------------------------
// C1 / 3.5 — Worker parity (branch simulated exactly once, no duplicates)
// ---------------------------------------------------------------------------

describe("Branch resimulation parity (C1)", () => {
  const iv: TimelineIntervention = {
    interventionId: "interv_suppress_bridge_10", parentBranchId: "main",
    newBranchId: "suppress_bridge_branch", insertionYear: 10,
    targetIds: ["bridge_6428"], operation: "suppress_event", parameters: {},
  };

  it("returns a complete per-year state cache whose hashes match the branch year hashes", () => {
    const pb = new Branch("main"); const pl = new CausalLedger("main");
    runFullSimulation("bridge-emergence-001", pb, pl, 40);
    const { branch, cachedStates } = resimulateBranch(pb, pl, iv, 40);
    for (let y = 0; y <= 40; y++) {
      expect(cachedStates[y]).toBeDefined();
      expect(deterministicHash(cachedStates[y])).toBe(branch.yearHashes[y]);
    }
  }, 40000);

  it("is deterministic across repeated resimulations (no double-sim, no throw)", () => {
    const pb = new Branch("main"); const pl = new CausalLedger("main");
    runFullSimulation("bridge-emergence-001", pb, pl, 40);
    const r1 = resimulateBranch(pb, pl, iv, 40);
    const r2 = resimulateBranch(pb, pl, iv, 40);
    expect(deterministicHash(r1.state)).toBe(deterministicHash(r2.state));
    // The returned ledger is complete WITHOUT any further simulation, so a
    // consumer never re-runs simulateYear (which previously threw duplicates).
    expect(Object.keys(r1.cachedStates).length).toBe(41);
  }, 40000);
});

// ---------------------------------------------------------------------------
// H4 — Full-year per-settlement wealth reconciliation
// ---------------------------------------------------------------------------

function reconciles(rec: NonNullable<WorldState["settlements"][string]["__transientReconciliation"]>): boolean {
  const expected =
    rec.wealthBefore
    + rec.exportRevenue + rec.productionIncome + rec.naturalGrowth
    - rec.importExpense - rec.transportExpense - rec.investment - rec.losses - rec.taxesPaid;
  return Math.abs(expected - rec.wealthAfter) < 1e-6;
}

describe("Full-year wealth reconciliation (H4)", () => {
  it("reconciles every pre-existing settlement each simulated year", () => {
    const branch = new Branch("main");
    const ledger = new CausalLedger("main");
    const state = runFullSimulation("bridge-emergence-001", branch, ledger, 3);
    let checked = 0;
    for (let year = 4; year <= 30; year++) {
      const preIds = new Set(Object.keys(state.settlements));
      simulateYear(state, ledger, branch, year);
      for (const sId of preIds) {
        const s = state.settlements[sId];
        const rec = s.__transientReconciliation;
        if (!rec || rec.year !== year) continue;
        expect(reconciles(rec)).toBe(true);
        expect(rec.wealthAfter).toBe(s.wealth);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  }, 40000);

  // Direct proof that the tax-booking fix reconciles. Taxation is dead in the
  // full simulation (see audit M8: governments are never created), so this
  // exercises updatePolitics on a controlled state with a pre-created
  // government whose capital is the taxed settlement.
  it("books taxation into reconciliation so a taxed settlement reconciles", () => {
    const state = baseGrid(5, 5);
    state.settlements = { s_cap: mkSettlement("s_cap", 12, 300, 1000) };
    state.governments = {
      gov_a: { id: "gov_a", name: "Gov", capitalId: "s_cap", treasury: 0, legitimacy: 0.8, taxRate: 0.1 },
    };
    // Initialize the per-year reconciliation record exactly as the scheduler does.
    const s = state.settlements["s_cap"];
    s.__transientReconciliation = {
      year: 5, wealthBefore: s.wealth, productionIncome: 0, exportRevenue: 0,
      importExpense: 0, transportExpense: 0, naturalGrowth: 0, taxesPaid: 0,
      investment: 0, losses: 0, wealthAfter: s.wealth,
    };
    const before = s.wealth;
    updatePolitics(state, new CausalLedger("main"), 5);
    const rec = s.__transientReconciliation!;
    rec.wealthAfter = s.wealth; // scheduler finalizes this after all systems
    expect(rec.taxesPaid).toBeGreaterThan(0);      // tax actually fired
    expect(rec.taxesPaid).toBe(before - s.wealth); // booked the actual delta
    expect(reconciles(rec)).toBe(true);            // full-year identity holds
  });
});

describe("Politics activation and lifecycle", () => {
  it("creates governments with valid capitals and nonuniform finite control fields", () => {
    const branch = new Branch("main");
    const ledger = new CausalLedger("main");
    const state = runFullSimulation("bridge-emergence-001", branch, ledger, 0);

    const govIds = Object.keys(state.governments).sort();
    expect(govIds).toEqual(["gov_a", "gov_b"]);
    expect(ledger.getAllEvents().filter(e => e.eventType === "political_founding")).toHaveLength(2);

    for (const govId of govIds) {
      const capital = state.settlements[state.governments[govId].capitalId];
      expect(capital).toBeDefined();
      expect(capital.abandoned).toBe(false);

      const control = state.politicalControl[govId];
      expect(control).toHaveLength(state.mapWidth * state.mapHeight);
      expect(control.every(Number.isFinite)).toBe(true);
      expect(new Set(control).size).toBeGreaterThan(1);
    }
  });

  it("does not duplicate government initialization in subsequent years", () => {
    const branch = new Branch("main");
    const ledger = new CausalLedger("main");
    runFullSimulation("bridge-emergence-001", branch, ledger, 10);

    const founding = ledger.getAllEvents().filter(e => e.eventType === "political_founding");
    expect(founding.map(e => e.eventId).sort()).toEqual(["est_gov_a_0", "est_gov_b_0"]);
    expect(ledger.getAllEvents().some(e => e.eventType === "taxation")).toBe(true);
  });

  it("waits for two eligible settlements and remains inert on repeated bootstrap calls", () => {
    const state = baseGrid(5, 5);
    const ledger = new CausalLedger("main");

    initializeGovernments(state, ledger, 0);
    expect(Object.keys(state.governments)).toEqual([]);

    state.settlements.s_one = mkSettlement("s_one", 6, 200, 1000);
    initializeGovernments(state, ledger, 0);
    expect(Object.keys(state.governments)).toEqual([]);

    state.settlements.s_two = mkSettlement("s_two", 18, 200, 1000);
    initializeGovernments(state, ledger, 1);
    initializeGovernments(state, ledger, 1);
    expect(Object.keys(state.governments).sort()).toEqual(["gov_a", "gov_b"]);
    expect(ledger.getAllEvents().filter(e => e.eventType === "political_founding")).toHaveLength(2);
  });

  it("produces identical state and ledger hashes across identical politics-active runs", () => {
    const b1 = new Branch("main");
    const l1 = new CausalLedger("main");
    const s1 = runFullSimulation("politics-determinism", b1, l1, 10);
    const b2 = new Branch("main");
    const l2 = new CausalLedger("main");
    const s2 = runFullSimulation("politics-determinism", b2, l2, 10);

    expect(deterministicHash(s1)).toBe(deterministicHash(s2));
    expect(deterministicHash(l1.events)).toBe(deterministicHash(l2.events));
    expect(b1.yearHashes).toEqual(b2.yearHashes);
  });

  it("reconciles taxation exactly, links wealth events, and respects the wealth floor", () => {
    const state = baseGrid(5, 5);
    state.settlements = {
      s_cap: mkSettlement("s_cap", 12, 300, 1000),
      s_floor: mkSettlement("s_floor", 13, 200, 105),
      s_below: mkSettlement("s_below", 17, 200, 90),
    };
    state.governments = {
      gov_a: { id: "gov_a", name: "Gov", capitalId: "s_cap", treasury: 250, legitimacy: 0.8, taxRate: 0.1 },
    };
    const ledger = new CausalLedger("main");
    const beforeWealth = Object.fromEntries(Object.entries(state.settlements).map(([id, s]) => [id, s.wealth]));
    const treasuryBefore = state.governments.gov_a.treasury;

    updatePolitics(state, ledger, 5);

    const taxEvent = ledger.getAllEvents().find(e => e.eventType === "taxation");
    expect(taxEvent).toBeDefined();
    const wealthEvents = ledger.getAllEvents().filter(e => e.ruleId === "tax_wealth_reduction");
    expect(wealthEvents).toHaveLength(2);
    expect(wealthEvents.every(e => e.parentEventIds[0] === taxEvent!.eventId)).toBe(true);

    const totalReduction = Object.entries(state.settlements)
      .reduce((sum, [id, s]) => sum + beforeWealth[id] - s.wealth, 0);
    const treasuryIncrease = state.governments.gov_a.treasury - treasuryBefore;
    expect(totalReduction).toBe(105);
    expect(treasuryIncrease).toBe(totalReduction);
    expect(state.settlements.s_floor.wealth).toBe(100);
    expect(state.settlements.s_below.wealth).toBe(90);
    expect(taxEvent!.immediateEffects[0]).toMatchObject({ before: 250, after: 355 });
  });

  it("taxes an equally controlled settlement only once using a deterministic government tie-break", () => {
    const state = baseGrid(5, 5);
    state.settlements = { s_cap: mkSettlement("s_cap", 12, 300, 1000) };
    state.governments = {
      gov_a: { id: "gov_a", name: "A", capitalId: "s_cap", treasury: 0, legitimacy: 0.8, taxRate: 0.1 },
      gov_b: { id: "gov_b", name: "B", capitalId: "s_cap", treasury: 0, legitimacy: 0.8, taxRate: 0.2 },
    };

    updatePolitics(state, new CausalLedger("main"), 5);

    expect(state.settlements.s_cap.wealth).toBe(900);
    expect(state.governments.gov_a.treasury).toBe(100);
    expect(state.governments.gov_b.treasury).toBe(0);
  });

  it("relocates an invalid capital once using the previous control field", () => {
    const state = baseGrid(5, 5);
    state.settlements = {
      s_old: { ...mkSettlement("s_old", 12, 0, 100), abandoned: true },
      s_small: mkSettlement("s_small", 13, 100, 500),
      s_large: mkSettlement("s_large", 14, 300, 500),
    };
    state.governments = {
      gov_a: { id: "gov_a", name: "Gov", capitalId: "s_old", treasury: 0, legitimacy: 0.8, taxRate: 0.1 },
    };
    state.politicalControl.gov_a = new Array(25).fill(0);
    state.politicalControl.gov_a[13] = 40;
    state.politicalControl.gov_a[14] = 40;
    const ledger = new CausalLedger("main");

    updatePolitics(state, ledger, 1);
    updatePolitics(state, ledger, 2);

    expect(state.governments.gov_a.capitalId).toBe("s_large");
    const relocations = ledger.getAllEvents().filter(e => e.eventType === "capital_relocation");
    expect(relocations).toHaveLength(1);
    expect(relocations[0].immediateEffects[0]).toMatchObject({ before: "s_old", after: "s_large" });
    expect(state.settlements[state.governments.gov_a.capitalId].abandoned).toBe(false);
  });

  it("does not invent a capital when no controlled replacement exists", () => {
    const state = baseGrid(5, 5);
    state.settlements = { s_outside: mkSettlement("s_outside", 12, 300, 1000) };
    state.governments = {
      gov_a: { id: "gov_a", name: "Gov", capitalId: "s_missing", treasury: 0, legitimacy: 0.8, taxRate: 0.1 },
    };
    state.politicalControl.gov_a = new Array(25).fill(0);
    const ledger = new CausalLedger("main");

    updatePolitics(state, ledger, 1);

    expect(state.governments.gov_a.capitalId).toBe("s_missing");
    expect(ledger.getAllEvents().filter(e => e.eventType === "capital_relocation")).toHaveLength(0);
    expect(state.politicalControl.gov_a).toHaveLength(25);
  });

  it("preserves politics and exact prefix hashes in a post-bootstrap counterfactual", () => {
    const parentBranch = new Branch("main");
    const parentLedger = new CausalLedger("main");
    runFullSimulation("bridge-emergence-001", parentBranch, parentLedger, 30);
    const prefixBranch = new Branch("main");
    const prefixLedger = new CausalLedger("main");
    const parentAt9 = runFullSimulation("bridge-emergence-001", prefixBranch, prefixLedger, 9);
    const intervention: TimelineIntervention = {
      interventionId: "politics_branch_10", parentBranchId: "main",
      newBranchId: "politics_branch", insertionYear: 10,
      targetIds: ["bridge_6428"], operation: "suppress_event", parameters: {},
    };

    const result = resimulateBranch(parentBranch, parentLedger, intervention, 30);

    for (let year = 0; year < intervention.insertionYear; year++) {
      expect(result.branch.yearHashes[year]).toBe(parentBranch.yearHashes[year]);
    }
    const stripBranchId = ({ branchId: _branchId, ...event }: HistoricalEvent) => event;
    const parentPrefixEvents = parentLedger.getAllEvents()
      .filter(event => event.time.year < intervention.insertionYear)
      .map(stripBranchId);
    const branchPrefixEvents = result.ledger.getAllEvents()
      .filter(event => event.time.year < intervention.insertionYear)
      .map(stripBranchId);
    expect(branchPrefixEvents).toEqual(parentPrefixEvents);
    expect(result.cachedStates[9].governments).toEqual(parentAt9.governments);
    expect(result.cachedStates[9].politicalControl).toEqual(parentAt9.politicalControl);
    expect(Object.keys(result.cachedStates[30].governments).length).toBeGreaterThan(0);
    expect(Object.keys(result.cachedStates[30].politicalControl).length).toBeGreaterThan(0);
    expect(result.ledger.getAllEvents().filter(e => e.eventType === "political_founding")).toHaveLength(2);
  }, 40000);

  it("creates a Year-0 branch without simulating bootstrap twice", () => {
    const parentBranch = new Branch("main");
    const parentLedger = new CausalLedger("main");
    runFullSimulation("bridge-emergence-001", parentBranch, parentLedger, 0);
    const intervention: TimelineIntervention = {
      interventionId: "politics_branch_0", parentBranchId: "main",
      newBranchId: "politics_branch_0", insertionYear: 0,
      targetIds: [], operation: "alter_condition", parameters: {},
    };

    const result = resimulateBranch(parentBranch, parentLedger, intervention, 1);

    expect(Object.keys(result.cachedStates[0].governments).sort()).toEqual(["gov_a", "gov_b"]);
    expect(result.ledger.getAllEvents().filter(e => e.eventType === "political_founding")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// C4 — Stale-response guard
// ---------------------------------------------------------------------------

describe("Worker stale-response guard (C4)", () => {
  it("accepts only the latest request while mounted", () => {
    expect(acceptResult(2, 2, true)).toBe(true);
    expect(acceptResult(2, 1, true)).toBe(false); // superseded
    expect(acceptResult(2, 3, true)).toBe(false); // impossible/future
    expect(acceptResult(2, 2, false)).toBe(false); // unmounted
  });

  it("a stale result cannot overwrite a newer one", () => {
    // Simulate two runs: run#1 completes AFTER run#2 was issued.
    const latest = 2;
    const run1Accepted = acceptResult(latest, 1, true);
    const run2Accepted = acceptResult(latest, 2, true);
    expect(run1Accepted).toBe(false);
    expect(run2Accepted).toBe(true);
  });
});
