import { describe, expect, it } from "vitest";
import type { WorldState } from "../core/types";
import type { TimelineIntervention } from "../timelines/branch";
import { CausalLedger } from "../timelines/ledger";
import { applyTimelineInterventionEffects } from "../timelines/interventionEffects";
import { actionsForEntity, scoreCivilization } from "../gameplay/gameplay";

function stateFixture(): WorldState {
  const size = 4;
  return {
    seed: "gameplay-test",
    year: 20,
    mapWidth: 2,
    mapHeight: 2,
    elevation: new Array(size).fill(0),
    moisture: new Array(size).fill(0),
    temperature: new Array(size).fill(0),
    flowAccumulation: new Array(size).fill(0),
    flowDirection: new Array(size).fill(0),
    soilFertility: new Array(size).fill(0),
    biomes: new Array(size).fill("grassland"),
    resources: { oreGrade: new Array(size).fill(0), timberStock: new Array(size).fill(0) },
    politicalControl: {},
    settlements: {
      town: {
        id: "town",
        name: "Town",
        cellId: 0,
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
        points: [[0, 0], [1, 1]],
      },
    },
    bridges: {
      bridge: {
        id: "bridge",
        routeEdgeId: "road",
        cellId: 1,
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
        treasury: 200,
        legitimacy: 0.45,
        taxRate: 0.1,
      },
    },
    cohorts: {},
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
  it("applies queued actions as real state changes and records them", () => {
    const state = stateFixture();
    const ledger = new CausalLedger("player");

    applyTimelineInterventionEffects(state, ledger, intervention([
      { actionId: "relief", kind: "settlement_relief", targetId: "town", cost: 20 },
      { actionId: "repair", kind: "route_repair", targetId: "road", cost: 15 },
      { actionId: "grant", kind: "government_grant", targetId: "gov", cost: 25 },
      { actionId: "remove", kind: "decommission_bridge", targetId: "bridge", cost: 10 },
    ]));

    expect(state.settlements.town.foodAccess).toBeCloseTo(0.58);
    expect(state.settlements.town.diseaseBurden).toBeCloseTo(0.18);
    expect(state.routes.road.condition).toBe(1);
    expect(state.routes.road.capacity).toBe(150);
    expect(state.governments.gov.treasury).toBe(700);
    expect(state.bridges.bridge.status).toBe("ruined");
    expect(ledger.getAllEvents().filter((event) => event.eventType === "player_intervention")).toHaveLength(4);
  });

  it("offers actions that match the selected simulation entity", () => {
    const state = stateFixture();
    expect(actionsForEntity(state, "town").map((action) => action.kind)).toEqual([
      "settlement_relief",
      "market_investment",
    ]);
    expect(actionsForEntity(state, "road")[0].kind).toBe("route_repair");
    expect(actionsForEntity(state, "gov")[0].kind).toBe("government_grant");
    expect(actionsForEntity(state, "bridge")[0].kind).toBe("decommission_bridge");
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
