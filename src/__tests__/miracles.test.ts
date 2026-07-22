import { describe, expect, it } from "vitest";
import type { WorldState } from "../core/types";
import type { TimelineIntervention } from "../timelines/branch";
import { CausalLedger } from "../timelines/ledger";
import {
  applyTimelineMiracleEffects,
  type DivineMiracleAction,
} from "../timelines/miracleEffects";
import {
  STARTING_DIVINITY,
  makeQueuedMiracle,
  miraclesForEntity,
  worldMiracles,
} from "../gameplay/miracles";

function stateFixture(): WorldState {
  const width = 12;
  const height = 12;
  const size = width * height;
  return {
    seed: "miracle-test",
    year: 40,
    mapWidth: width,
    mapHeight: height,
    elevation: new Array(size).fill(100),
    moisture: new Array(size).fill(40),
    temperature: new Array(size).fill(18),
    flowAccumulation: new Array(size).fill(80),
    flowDirection: new Array(size).fill(0),
    soilFertility: new Array(size).fill(45),
    biomes: new Array(size).fill("grassland"),
    resources: {
      oreGrade: new Array(size).fill(30),
      timberStock: new Array(size).fill(35),
    },
    politicalControl: {},
    settlements: {
      town: {
        id: "town",
        name: "Town",
        cellId: 6 * width + 6,
        population: 500,
        carryingCapacity: 700,
        foodAccess: 0.45,
        waterSecurity: 0.5,
        marketAccess: 0.35,
        diseaseBurden: 0.4,
        wealth: 700,
        establishedYear: 0,
        abandoned: false,
      },
      ruin: {
        id: "ruin",
        name: "Ruin",
        cellId: 2 * width + 2,
        population: 0,
        carryingCapacity: 480,
        foodAccess: 0,
        waterSecurity: 0,
        marketAccess: 0.1,
        diseaseBurden: 0.8,
        wealth: 0,
        establishedYear: 0,
        abandoned: true,
        abandonedYear: 22,
      },
    },
    routes: {
      road: {
        id: "road",
        type: "road",
        length: 8,
        travelTime: 18,
        capacity: 80,
        condition: 0.35,
        constructionYear: 10,
        points: [[4, 6], [5, 6], [6, 6], [7, 6], [8, 6]],
      },
    },
    bridges: {
      bridge: {
        id: "bridge",
        routeEdgeId: "road",
        cellId: 6 * width + 7,
        span: 12,
        constructionYear: 10,
        status: "ruined",
      },
    },
    governments: {
      gov: {
        id: "gov",
        name: "Government",
        capitalId: "town",
        treasury: 250,
        legitimacy: 0.42,
        taxRate: 0.14,
      },
    },
    cohorts: {
      town: [
        { culture: "local", occupation: "farmer", wealthBand: "poor", size: 350 },
        { culture: "local", occupation: "merchant", wealthBand: "middle", size: 150 },
      ],
      ruin: [],
    },
    landmarks: {},
    scars: {},
  };
}

function intervention(miracles: DivineMiracleAction[]): TimelineIntervention {
  return {
    interventionId: "divine_test",
    parentBranchId: "main",
    newBranchId: "miracle_branch",
    insertionYear: 40,
    targetIds: miracles.map((miracle) => miracle.targetId ?? "world"),
    operation: "alter_condition",
    parameters: { miracles },
  };
}

describe("divine miracle system", () => {
  it("uses a separate divinity economy and exposes target-appropriate powers", () => {
    const state = stateFixture();
    expect(STARTING_DIVINITY).toBe(100);
    expect(miraclesForEntity(state, "town").map((miracle) => miracle.kind)).toContain("falling_star");
    expect(miraclesForEntity(state, "ruin").map((miracle) => miracle.kind)).toEqual(["resurrect_city"]);
    expect(miraclesForEntity(state, "gov").map((miracle) => miracle.kind)).toEqual(["golden_age"]);
    expect(miraclesForEntity(state, "road").map((miracle) => miracle.kind)).toEqual(["divine_highway"]);
    expect(worldMiracles().map((miracle) => miracle.kind)).toEqual(["world_bloom", "age_of_ruin"]);
  });

  it("applies blessings and wonders as real state changes with miracle ledger events", () => {
    const state = stateFixture();
    const ledger = new CausalLedger("miracle_branch");
    const miracles = [
      makeQueuedMiracle("rain_of_plenty", "town", 1),
      makeQueuedMiracle("golden_age", "gov", 2),
      makeQueuedMiracle("divine_highway", "road", 3),
      makeQueuedMiracle("resurrect_city", "ruin", 4),
    ];

    applyTimelineMiracleEffects(state, ledger, intervention(miracles));

    expect(state.settlements.town.foodAccess).toBe(1);
    expect(state.governments.gov.legitimacy).toBe(1);
    expect(state.routes.road.condition).toBe(1);
    expect(state.routes.road.capacity).toBeGreaterThan(500);
    expect(state.bridges.bridge.status).toBe("active");
    expect(state.settlements.ruin.abandoned).toBe(false);
    expect(Object.keys(state.landmarks).length).toBeGreaterThan(0);
    expect(ledger.getAllEvents().filter((event) => event.eventType === "divine_miracle")).toHaveLength(4);
  });

  it("makes divine wrath physically and historically destructive", () => {
    const state = stateFixture();
    const ledger = new CausalLedger("miracle_branch");
    const initialPopulation = state.settlements.town.population;
    const initialTimber = state.resources.timberStock[state.settlements.town.cellId];

    applyTimelineMiracleEffects(
      state,
      ledger,
      intervention([makeQueuedMiracle("pillar_of_fire", "town", 1)]),
    );

    expect(state.settlements.town.population).toBeLessThan(initialPopulation);
    expect(state.settlements.town.wealth).toBeLessThan(700);
    expect(state.resources.timberStock[state.settlements.town.cellId]).toBeLessThan(initialTimber);
    expect(Object.values(state.scars).some((scar) => scar.type === "burn_layer")).toBe(true);
  });

  it("supports true world-scale blessing and apocalypse", () => {
    const blessed = stateFixture();
    const ruined = stateFixture();
    const blessedLedger = new CausalLedger("blessed");
    const ruinedLedger = new CausalLedger("ruined");

    applyTimelineMiracleEffects(
      blessed,
      blessedLedger,
      intervention([makeQueuedMiracle("world_bloom", null, 1)]),
    );
    applyTimelineMiracleEffects(
      ruined,
      ruinedLedger,
      intervention([makeQueuedMiracle("age_of_ruin", null, 1)]),
    );

    expect(blessed.settlements.town.foodAccess).toBe(1);
    expect(blessed.settlements.town.diseaseBurden).toBe(0);
    expect(blessed.soilFertility[0]).toBeGreaterThan(45);

    expect(ruined.settlements.town.population).toBeLessThan(250);
    expect(ruined.governments.gov.legitimacy).toBeLessThan(0.1);
    expect(ruined.routes.road.condition).toBeLessThan(0.2);
    expect(ruined.bridges.bridge.status).toBe("ruined");
    expect(Object.keys(ruined.scars).length).toBeGreaterThan(0);
  });
});
