import { describe, expect, it } from "vitest";
import type { WorldState } from "../core/types";
import type { TimelineIntervention } from "../timelines/branch";
import { CausalLedger } from "../timelines/ledger";
import { applyTimelineInterventionEffects } from "../timelines/interventionEffects";
import { actionsForEntity, scoreCivilization } from "../gameplay/gameplay";

function stateFixture(): WorldState {
  const size = 25;
  return {
    seed: "gameplay-test",
    year: 20,
    mapWidth: 5,
    mapHeight: 5,
    elevation: new Array(size).fill(100),
    moisture: new Array(size).fill(40),
    temperature: new Array(size).fill(20),
    flowAccumulation: new Array(size).fill(0),
    flowDirection: new Array(size).fill(0),
    soilFertility: new Array(size).fill(45),
    biomes: new Array(size).fill("grassland"),
    resources: { oreGrade: new Array(size).fill(50), timberStock: new Array(size).fill(50) },
    politicalControl: {},
    settlements: {
      town: {
        id: "town",
        name: "Town",
        cellId: 12,
        population: 500,
        carryingCapacity: 650,
        foodAccess: 0.4,
        waterSecurity: 0.5,
        marketAccess: 0.3,
        diseaseBurden: 0.4,
        wealth: 600,
        establishedYear: 0,
        abandoned: false,
      },
    },
    routes: {
      road: {
        id: "road",
        type: "road",
        length: 10,
        travelTime: 20,
        capacity: 100,
        condition: 0.4,
        constructionYear: 10,
        points: [[1, 1], [3, 3]],
      },
    },
    bridges: {
      bridge: {
        id: "bridge",
        routeEdgeId: "road",
        cellId: 12,
        span: 12,
        constructionYear: 10,
        status: "active",
      },
    },
    governments: {
      gov: {
        id: "gov",
        name: "Government",
        capitalId: "town",
        treasury: 800,
        legitimacy: 0.45,
        taxRate: 0.1,
      },
    },
    cohorts: {
      town: [
        { culture: "a", occupation: "farmer", wealthBand: "poor", size: 300 },
        { culture: "b", occupation: "merchant", wealthBand: "middle", size: 200 },
      ],
    },
    landmarks: {},
    scars: {},
  };
}

function intervention(actions: unknown[]): TimelineIntervention {
  return {
    interventionId: "player_intervention_test",
    parentBranchId: "main",
    newBranchId: "player",
    insertionYear: 20,
    targetIds: ["town", "road", "gov", "bridge"],
    operation: "alter_condition",
    parameters: { actions },
  };
}

describe("playable civilization loop", () => {
  it("applies constructive actions as real state and environmental changes", () => {
    const state = stateFixture();
    const ledger = new CausalLedger("player");

    applyTimelineInterventionEffects(state, ledger, intervention([
      { actionId: "irrigate", kind: "irrigation_program", targetId: "town", cost: 28 },
      { actionId: "migrants", kind: "welcome_migrants", targetId: "town", cost: 18 },
      { actionId: "works", kind: "public_works_program", targetId: "gov", cost: 28 },
      { actionId: "expand", kind: "route_expansion", targetId: "road", cost: 24 },
      { actionId: "fortify", kind: "fortify_bridge", targetId: "bridge", cost: 18 },
    ]));

    expect(state.settlements.town.foodAccess).toBeGreaterThan(0.6);
    expect(state.settlements.town.population).toBeGreaterThan(500);
    expect(state.settlements.town.carryingCapacity).toBeGreaterThan(1000);
    expect(state.soilFertility[12]).toBeGreaterThan(45);
    expect(state.routes.road.condition).toBe(1);
    expect(state.routes.road.capacity).toBeGreaterThan(300);
    expect(state.governments.gov.legitimacy).toBeGreaterThan(0.45);
    expect(state.cohorts.town.some((cohort) => cohort.culture === "newcomer")).toBe(true);
    expect(ledger.getAllEvents().filter((event) => event.eventType === "player_intervention")).toHaveLength(5);
  });

  it("supports destructive and coercive actions with lasting consequences", () => {
    const state = stateFixture();
    const ledger = new CausalLedger("player");

    applyTimelineInterventionEffects(state, ledger, intervention([
      { actionId: "mine", kind: "strip_mine_hinterland", targetId: "town", cost: 10 },
      { actionId: "poison", kind: "poison_watershed", targetId: "town", cost: 14 },
      { actionId: "purge", kind: "political_purge", targetId: "gov", cost: 12 },
      { actionId: "sabotage", kind: "sabotage_route", targetId: "road", cost: 8 },
      { actionId: "demolish", kind: "demolish_bridge", targetId: "bridge", cost: 10 },
    ]));

    expect(state.settlements.town.waterSecurity).toBe(0);
    expect(state.settlements.town.diseaseBurden).toBeGreaterThan(0.8);
    expect(state.settlements.town.population).toBeLessThan(500);
    expect(state.governments.gov.legitimacy).toBeLessThan(0.3);
    expect(state.routes.road.condition).toBeLessThanOrEqual(0.15);
    expect(state.routes.road.capacity).toBeLessThan(20);
    expect(state.bridges.bridge.status).toBe("ruined");
    expect(Object.values(state.scars).some((scar) => scar.type === "polluted_soil")).toBe(true);
    expect(Object.values(state.scars).some((scar) => scar.type === "abandoned_route")).toBe(true);
  });

  it("offers a broad set of actions appropriate to each entity type", () => {
    const state = stateFixture();
    const settlementActions = actionsForEntity(state, "town");
    const governmentActions = actionsForEntity(state, "gov");
    const routeActions = actionsForEntity(state, "road");
    const bridgeActions = actionsForEntity(state, "bridge");

    expect(settlementActions).toHaveLength(14);
    expect(settlementActions.map((action) => action.kind)).toContain("settlement_relief");
    expect(settlementActions.map((action) => action.kind)).toContain("poison_watershed");
    expect(governmentActions).toHaveLength(9);
    expect(governmentActions.map((action) => action.kind)).toContain("institutional_reform");
    expect(governmentActions.map((action) => action.kind)).toContain("dissolve_government");
    expect(routeActions).toHaveLength(6);
    expect(routeActions.map((action) => action.kind)).toContain("route_expansion");
    expect(routeActions.map((action) => action.kind)).toContain("abandon_route");
    expect(bridgeActions.map((action) => action.kind)).toEqual([
      "fortify_bridge",
      "decommission_bridge",
      "demolish_bridge",
    ]);
  });

  it("can restore a ruined bridge and connected route", () => {
    const state = stateFixture();
    state.bridges.bridge.status = "ruined";
    state.routes.road.condition = 0.2;
    state.routes.road.capacity = 20;
    state.routes.road.travelTime = 60;
    const ledger = new CausalLedger("player");

    applyTimelineInterventionEffects(state, ledger, intervention([
      { actionId: "restore", kind: "restore_bridge", targetId: "bridge", cost: 24 },
    ]));

    expect(state.bridges.bridge.status).toBe("active");
    expect(state.routes.road.condition).toBeGreaterThanOrEqual(0.75);
    expect(state.routes.road.capacity).toBe(100);
    expect(state.routes.road.travelTime).toBe(27);
  });

  it("rewards an objectively stronger civilization state", () => {
    const baseline = stateFixture();
    const improved = structuredClone(baseline);
    improved.settlements.town.population += 300;
    improved.settlements.town.wealth += 900;
    improved.settlements.town.foodAccess = 0.9;
    improved.settlements.town.waterSecurity = 0.9;
    improved.settlements.town.diseaseBurden = 0.05;
    improved.governments.gov.legitimacy = 0.8;
    improved.routes.road.condition = 1;

    expect(scoreCivilization(improved).total).toBeGreaterThan(scoreCivilization(baseline).total);
  });
});
