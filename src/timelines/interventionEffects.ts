import type { Scar, StateDelta, WorldState } from "../core/types";
import { CausalLedger, diffEntity } from "./ledger";
import type { TimelineIntervention } from "./branch";

export type PlayableInterventionKind =
  | "settlement_relief"
  | "sanitation_campaign"
  | "irrigation_program"
  | "housing_expansion"
  | "market_investment"
  | "welcome_migrants"
  | "quarantine_settlement"
  | "reforest_hinterland"
  | "strip_mine_hinterland"
  | "wealth_confiscation"
  | "engineered_scarcity"
  | "forced_displacement"
  | "forced_assimilation"
  | "poison_watershed"
  | "government_grant"
  | "tax_relief"
  | "institutional_reform"
  | "public_works_program"
  | "raise_taxes"
  | "propaganda_campaign"
  | "political_purge"
  | "embezzle_treasury"
  | "dissolve_government"
  | "route_repair"
  | "route_expansion"
  | "subsidize_transit"
  | "sabotage_route"
  | "blockade_route"
  | "abandon_route"
  | "restore_bridge"
  | "fortify_bridge"
  | "decommission_bridge"
  | "demolish_bridge";

export interface PlayableInterventionAction {
  actionId: string;
  kind: PlayableInterventionKind;
  targetId: string;
  cost: number;
}

const ACTION_LABELS: Record<PlayableInterventionKind, string> = {
  settlement_relief: "Emergency relief",
  sanitation_campaign: "Sanitation campaign",
  irrigation_program: "Irrigation program",
  housing_expansion: "Housing expansion",
  market_investment: "Market investment",
  welcome_migrants: "Welcome migrants",
  quarantine_settlement: "Quarantine settlement",
  reforest_hinterland: "Reforest hinterland",
  strip_mine_hinterland: "Strip-mine hinterland",
  wealth_confiscation: "Confiscate wealth",
  engineered_scarcity: "Engineer scarcity",
  forced_displacement: "Force displacement",
  forced_assimilation: "Force assimilation",
  poison_watershed: "Poison watershed",
  government_grant: "Civic grant",
  tax_relief: "Tax relief",
  institutional_reform: "Institutional reform",
  public_works_program: "Public works program",
  raise_taxes: "Raise taxes",
  propaganda_campaign: "Propaganda campaign",
  political_purge: "Political purge",
  embezzle_treasury: "Embezzle treasury",
  dissolve_government: "Dissolve government",
  route_repair: "Repair route",
  route_expansion: "Expand route",
  subsidize_transit: "Subsidize transit",
  sabotage_route: "Sabotage route",
  blockade_route: "Blockade route",
  abandon_route: "Abandon route",
  restore_bridge: "Restore bridge",
  fortify_bridge: "Fortify bridge",
  decommission_bridge: "Decommission bridge",
  demolish_bridge: "Demolish bridge",
};

const ACTION_KINDS = new Set<PlayableInterventionKind>(
  Object.keys(ACTION_LABELS) as PlayableInterventionKind[],
);

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));
const clamp01 = (value: number): number => clamp(value, 0, 1);

function isPlayableInterventionKind(value: unknown): value is PlayableInterventionKind {
  return typeof value === "string" && ACTION_KINDS.has(value as PlayableInterventionKind);
}

function recordEntityChange(
  effects: StateDelta[],
  entityId: string,
  component: string,
  before: unknown,
  after: unknown,
): void {
  effects.push(...diffEntity(entityId, component, before, after));
}

function recordFieldChange(
  effects: StateDelta[],
  entityId: string,
  component: string,
  field: string,
  before: unknown,
  after: unknown,
): void {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  effects.push({ entityId, component, field, before, after });
}

function neighborhoodCells(state: WorldState, cellId: number, radius: number = 2): number[] {
  const centerX = cellId % state.mapWidth;
  const centerY = Math.floor(cellId / state.mapWidth);
  const cells: number[] = [];

  for (let y = Math.max(0, centerY - radius); y <= Math.min(state.mapHeight - 1, centerY + radius); y++) {
    for (let x = Math.max(0, centerX - radius); x <= Math.min(state.mapWidth - 1, centerX + radius); x++) {
      const distance = Math.hypot(x - centerX, y - centerY);
      if (distance <= radius + 0.25) cells.push(y * state.mapWidth + x);
    }
  }

  return cells;
}

function averageAt(values: number[], cells: number[]): number {
  if (cells.length === 0) return 0;
  return cells.reduce((sum, cellId) => sum + values[cellId], 0) / cells.length;
}

function alterLocalField(
  effects: StateDelta[],
  targetId: string,
  values: number[],
  cells: number[],
  field: string,
  delta: number,
  minimum: number = 0,
  maximum: number = 100,
): void {
  const before = averageAt(values, cells);
  for (const cellId of cells) values[cellId] = clamp(values[cellId] + delta, minimum, maximum);
  const after = averageAt(values, cells);
  recordFieldChange(effects, targetId, "geography", `local_${field}`, before, after);
}

function addScar(
  state: WorldState,
  effects: StateDelta[],
  intervention: TimelineIntervention,
  action: PlayableInterventionAction,
  cellId: number,
  type: Scar["type"],
  intensity: number,
): void {
  const scarId = `player_scar_${intervention.interventionId}_${action.actionId}`;
  const scar: Scar = {
    id: scarId,
    type,
    cellId,
    year: intervention.insertionYear,
    intensity: clamp01(intensity),
  };
  state.scars[scarId] = scar;
  effects.push(...diffEntity(scarId, "scars", null, scar));
}

function recordCohorts(
  effects: StateDelta[],
  settlementId: string,
  before: WorldState["cohorts"][string],
  after: WorldState["cohorts"][string],
): void {
  recordFieldChange(effects, settlementId, "cohorts", "composition", before, after);
}

function rescaleCohorts(
  state: WorldState,
  effects: StateDelta[],
  settlementId: string,
  beforePopulation: number,
): void {
  const settlement = state.settlements[settlementId];
  const cohorts = state.cohorts[settlementId] ?? [];
  if (!settlement || cohorts.length === 0 || beforePopulation <= 0) return;

  const before = structuredClone(cohorts);
  const scale = settlement.population / beforePopulation;
  let total = 0;
  for (const cohort of cohorts) {
    cohort.size = Math.max(0, Math.floor(cohort.size * scale));
    total += cohort.size;
  }
  if (cohorts.length > 0 && total !== settlement.population) {
    cohorts[0].size = Math.max(0, cohorts[0].size + settlement.population - total);
  }
  recordCohorts(effects, settlementId, before, structuredClone(cohorts));
}

function addMigrantCohort(
  state: WorldState,
  effects: StateDelta[],
  settlementId: string,
  amount: number,
): void {
  const cohorts = (state.cohorts[settlementId] ??= []);
  const before = structuredClone(cohorts);
  let migrant = cohorts.find(
    (cohort) => cohort.culture === "newcomer" && cohort.occupation === "farmer" && cohort.wealthBand === "poor",
  );
  if (!migrant) {
    migrant = { culture: "newcomer", occupation: "farmer", wealthBand: "poor", size: 0 };
    cohorts.push(migrant);
  }
  migrant.size += amount;
  recordCohorts(effects, settlementId, before, structuredClone(cohorts));
}

function forceAssimilation(
  state: WorldState,
  effects: StateDelta[],
  settlementId: string,
): void {
  const cohorts = state.cohorts[settlementId] ?? [];
  if (cohorts.length < 2) return;

  const cultureTotals = new Map<string, number>();
  for (const cohort of cohorts) {
    cultureTotals.set(cohort.culture, (cultureTotals.get(cohort.culture) ?? 0) + cohort.size);
  }
  const dominantCulture = [...cultureTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!dominantCulture) return;

  const before = structuredClone(cohorts);
  const originalCohorts = [...cohorts];
  for (const cohort of originalCohorts) {
    if (cohort.culture === dominantCulture || cohort.size <= 0) continue;
    const converted = Math.floor(cohort.size * 0.45);
    if (converted <= 0) continue;
    cohort.size -= converted;
    let destination = cohorts.find(
      (candidate) =>
        candidate.culture === dominantCulture &&
        candidate.occupation === cohort.occupation &&
        candidate.wealthBand === cohort.wealthBand,
    );
    if (!destination) {
      destination = {
        culture: dominantCulture,
        occupation: cohort.occupation,
        wealthBand: cohort.wealthBand,
        size: 0,
      };
      cohorts.push(destination);
    }
    destination.size += converted;
  }
  recordCohorts(effects, settlementId, before, structuredClone(cohorts));
}

function applyAction(
  state: WorldState,
  ledger: CausalLedger,
  intervention: TimelineIntervention,
  action: PlayableInterventionAction,
): void {
  const effects: StateDelta[] = [];
  const affectedEntityIds = new Set<string>([action.targetId]);

  switch (action.kind) {
    case "settlement_relief": {
      const settlement = state.settlements[action.targetId];
      if (!settlement || settlement.abandoned) return;
      const before = structuredClone(settlement);
      settlement.foodAccess = clamp01(settlement.foodAccess + 0.18);
      settlement.waterSecurity = clamp01(settlement.waterSecurity + 0.18);
      settlement.diseaseBurden = clamp01(settlement.diseaseBurden - 0.22);
      settlement.wealth += 180;
      recordEntityChange(effects, settlement.id, "settlements", before, structuredClone(settlement));
      break;
    }
    case "sanitation_campaign": {
      const settlement = state.settlements[action.targetId];
      if (!settlement || settlement.abandoned) return;
      const before = structuredClone(settlement);
      settlement.diseaseBurden = clamp01(settlement.diseaseBurden - 0.36);
      settlement.waterSecurity = clamp01(settlement.waterSecurity + 0.12);
      settlement.wealth = Math.max(0, settlement.wealth - 80);
      recordEntityChange(effects, settlement.id, "settlements", before, structuredClone(settlement));
      break;
    }
    case "irrigation_program": {
      const settlement = state.settlements[action.targetId];
      if (!settlement || settlement.abandoned) return;
      const before = structuredClone(settlement);
      settlement.foodAccess = clamp01(settlement.foodAccess + 0.28);
      settlement.waterSecurity = clamp01(settlement.waterSecurity + 0.24);
      settlement.carryingCapacity += 220;
      settlement.wealth = Math.max(0, settlement.wealth - 120);
      recordEntityChange(effects, settlement.id, "settlements", before, structuredClone(settlement));
      const cells = neighborhoodCells(state, settlement.cellId);
      alterLocalField(effects, settlement.id, state.soilFertility, cells, "soil_fertility", 12);
      alterLocalField(effects, settlement.id, state.moisture, cells, "moisture", 8);
      break;
    }
    case "housing_expansion": {
      const settlement = state.settlements[action.targetId];
      if (!settlement || settlement.abandoned) return;
      const before = structuredClone(settlement);
      settlement.carryingCapacity += 420;
      settlement.marketAccess = clamp01(settlement.marketAccess + 0.04);
      settlement.wealth = Math.max(0, settlement.wealth - 220);
      recordEntityChange(effects, settlement.id, "settlements", before, structuredClone(settlement));
      break;
    }
    case "market_investment": {
      const settlement = state.settlements[action.targetId];
      if (!settlement || settlement.abandoned) return;
      const before = structuredClone(settlement);
      settlement.marketAccess = clamp01(settlement.marketAccess + 0.25);
      settlement.carryingCapacity += 120;
      settlement.wealth += 300;
      recordEntityChange(effects, settlement.id, "settlements", before, structuredClone(settlement));
      break;
    }
    case "welcome_migrants": {
      const settlement = state.settlements[action.targetId];
      if (!settlement || settlement.abandoned) return;
      const before = structuredClone(settlement);
      const arrivals = Math.max(50, Math.round(settlement.population * 0.12));
      settlement.population += arrivals;
      settlement.carryingCapacity += 90;
      settlement.wealth = Math.max(0, settlement.wealth - 100);
      settlement.diseaseBurden = clamp01(settlement.diseaseBurden + 0.05);
      addMigrantCohort(state, effects, settlement.id, arrivals);
      recordEntityChange(effects, settlement.id, "settlements", before, structuredClone(settlement));
      break;
    }
    case "quarantine_settlement": {
      const settlement = state.settlements[action.targetId];
      if (!settlement || settlement.abandoned) return;
      const before = structuredClone(settlement);
      settlement.diseaseBurden = clamp01(settlement.diseaseBurden - 0.3);
      settlement.marketAccess = clamp01(settlement.marketAccess - 0.28);
      settlement.foodAccess = clamp01(settlement.foodAccess - 0.08);
      settlement.wealth = Math.floor(settlement.wealth * 0.84);
      recordEntityChange(effects, settlement.id, "settlements", before, structuredClone(settlement));
      break;
    }
    case "reforest_hinterland": {
      const settlement = state.settlements[action.targetId];
      if (!settlement || settlement.abandoned) return;
      const before = structuredClone(settlement);
      settlement.wealth = Math.max(0, settlement.wealth - 90);
      recordEntityChange(effects, settlement.id, "settlements", before, structuredClone(settlement));
      const cells = neighborhoodCells(state, settlement.cellId, 3);
      alterLocalField(effects, settlement.id, state.resources.timberStock, cells, "timber_stock", 32);
      alterLocalField(effects, settlement.id, state.moisture, cells, "moisture", 6);
      alterLocalField(effects, settlement.id, state.soilFertility, cells, "soil_fertility", 5);
      break;
    }
    case "strip_mine_hinterland": {
      const settlement = state.settlements[action.targetId];
      if (!settlement || settlement.abandoned) return;
      const before = structuredClone(settlement);
      settlement.wealth += 650;
      settlement.diseaseBurden = clamp01(settlement.diseaseBurden + 0.08);
      recordEntityChange(effects, settlement.id, "settlements", before, structuredClone(settlement));
      const cells = neighborhoodCells(state, settlement.cellId, 3);
      alterLocalField(effects, settlement.id, state.resources.oreGrade, cells, "ore_grade", -18);
      alterLocalField(effects, settlement.id, state.resources.timberStock, cells, "timber_stock", -20);
      alterLocalField(effects, settlement.id, state.soilFertility, cells, "soil_fertility", -12);
      addScar(state, effects, intervention, action, settlement.cellId, "polluted_soil", 0.65);
      break;
    }
    case "wealth_confiscation": {
      const settlement = state.settlements[action.targetId];
      if (!settlement || settlement.abandoned) return;
      const before = structuredClone(settlement);
      settlement.wealth = Math.floor(settlement.wealth * 0.42);
      settlement.marketAccess = clamp01(settlement.marketAccess - 0.08);
      recordEntityChange(effects, settlement.id, "settlements", before, structuredClone(settlement));
      break;
    }
    case "engineered_scarcity": {
      const settlement = state.settlements[action.targetId];
      if (!settlement || settlement.abandoned) return;
      const before = structuredClone(settlement);
      settlement.foodAccess = clamp01(settlement.foodAccess - 0.5);
      settlement.waterSecurity = clamp01(settlement.waterSecurity - 0.25);
      settlement.diseaseBurden = clamp01(settlement.diseaseBurden + 0.2);
      settlement.wealth = Math.floor(settlement.wealth * 0.75);
      recordEntityChange(effects, settlement.id, "settlements", before, structuredClone(settlement));
      break;
    }
    case "forced_displacement": {
      const settlement = state.settlements[action.targetId];
      if (!settlement || settlement.abandoned) return;
      const before = structuredClone(settlement);
      const beforePopulation = settlement.population;
      settlement.population = Math.max(20, Math.floor(settlement.population * 0.55));
      settlement.wealth = Math.floor(settlement.wealth * 0.68);
      settlement.marketAccess = clamp01(settlement.marketAccess - 0.2);
      rescaleCohorts(state, effects, settlement.id, beforePopulation);
      recordEntityChange(effects, settlement.id, "settlements", before, structuredClone(settlement));
      break;
    }
    case "forced_assimilation": {
      const settlement = state.settlements[action.targetId];
      if (!settlement || settlement.abandoned) return;
      forceAssimilation(state, effects, settlement.id);
      const before = structuredClone(settlement);
      settlement.marketAccess = clamp01(settlement.marketAccess + 0.03);
      settlement.diseaseBurden = clamp01(settlement.diseaseBurden + 0.03);
      recordEntityChange(effects, settlement.id, "settlements", before, structuredClone(settlement));
      break;
    }
    case "poison_watershed": {
      const settlement = state.settlements[action.targetId];
      if (!settlement || settlement.abandoned) return;
      const before = structuredClone(settlement);
      settlement.waterSecurity = clamp01(settlement.waterSecurity - 0.65);
      settlement.foodAccess = clamp01(settlement.foodAccess - 0.2);
      settlement.diseaseBurden = clamp01(settlement.diseaseBurden + 0.45);
      recordEntityChange(effects, settlement.id, "settlements", before, structuredClone(settlement));
      const cells = neighborhoodCells(state, settlement.cellId, 3);
      alterLocalField(effects, settlement.id, state.moisture, cells, "moisture", -10);
      addScar(state, effects, intervention, action, settlement.cellId, "polluted_soil", 0.92);
      break;
    }
    case "government_grant": {
      const government = state.governments[action.targetId];
      if (!government) return;
      const before = structuredClone(government);
      government.treasury += 500;
      government.legitimacy = clamp01(government.legitimacy + 0.15);
      recordEntityChange(effects, government.id, "governments", before, structuredClone(government));
      break;
    }
    case "tax_relief": {
      const government = state.governments[action.targetId];
      if (!government) return;
      const before = structuredClone(government);
      government.taxRate = clamp01(government.taxRate - 0.08);
      government.treasury = Math.max(0, government.treasury - 250);
      government.legitimacy = clamp01(government.legitimacy + 0.08);
      recordEntityChange(effects, government.id, "governments", before, structuredClone(government));
      const capital = state.settlements[government.capitalId];
      if (capital) {
        const capitalBefore = structuredClone(capital);
        capital.wealth += 150;
        recordEntityChange(effects, capital.id, "settlements", capitalBefore, structuredClone(capital));
        affectedEntityIds.add(capital.id);
      }
      break;
    }
    case "institutional_reform": {
      const government = state.governments[action.targetId];
      if (!government) return;
      const before = structuredClone(government);
      government.legitimacy = clamp01(government.legitimacy + 0.25);
      government.taxRate = clamp01(government.taxRate - 0.02);
      government.treasury = Math.max(0, government.treasury - 200);
      recordEntityChange(effects, government.id, "governments", before, structuredClone(government));
      break;
    }
    case "public_works_program": {
      const government = state.governments[action.targetId];
      if (!government) return;
      const before = structuredClone(government);
      government.treasury = Math.max(0, government.treasury - 450);
      government.legitimacy = clamp01(government.legitimacy + 0.1);
      recordEntityChange(effects, government.id, "governments", before, structuredClone(government));
      const capital = state.settlements[government.capitalId];
      if (capital && !capital.abandoned) {
        const capitalBefore = structuredClone(capital);
        capital.carryingCapacity += 300;
        capital.marketAccess = clamp01(capital.marketAccess + 0.15);
        capital.wealth += 250;
        recordEntityChange(effects, capital.id, "settlements", capitalBefore, structuredClone(capital));
        affectedEntityIds.add(capital.id);
      }
      break;
    }
    case "raise_taxes": {
      const government = state.governments[action.targetId];
      if (!government) return;
      const before = structuredClone(government);
      government.taxRate = clamp01(government.taxRate + 0.12);
      government.treasury += 600;
      government.legitimacy = clamp01(government.legitimacy - 0.12);
      recordEntityChange(effects, government.id, "governments", before, structuredClone(government));
      const capital = state.settlements[government.capitalId];
      if (capital) {
        const capitalBefore = structuredClone(capital);
        capital.wealth = Math.max(0, capital.wealth - 200);
        recordEntityChange(effects, capital.id, "settlements", capitalBefore, structuredClone(capital));
        affectedEntityIds.add(capital.id);
      }
      break;
    }
    case "propaganda_campaign": {
      const government = state.governments[action.targetId];
      if (!government) return;
      const before = structuredClone(government);
      government.treasury = Math.max(0, government.treasury - 150);
      government.legitimacy = clamp01(government.legitimacy + 0.18);
      government.taxRate = clamp01(government.taxRate + 0.02);
      recordEntityChange(effects, government.id, "governments", before, structuredClone(government));
      break;
    }
    case "political_purge": {
      const government = state.governments[action.targetId];
      if (!government) return;
      const before = structuredClone(government);
      government.treasury = Math.max(0, government.treasury - 100);
      government.legitimacy = clamp01(government.legitimacy - 0.22);
      government.taxRate = clamp01(government.taxRate + 0.04);
      recordEntityChange(effects, government.id, "governments", before, structuredClone(government));
      const capital = state.settlements[government.capitalId];
      if (capital && !capital.abandoned) {
        const capitalBefore = structuredClone(capital);
        const beforePopulation = capital.population;
        capital.population = Math.max(20, Math.floor(capital.population * 0.88));
        capital.wealth = Math.floor(capital.wealth * 0.8);
        capital.diseaseBurden = clamp01(capital.diseaseBurden + 0.1);
        rescaleCohorts(state, effects, capital.id, beforePopulation);
        recordEntityChange(effects, capital.id, "settlements", capitalBefore, structuredClone(capital));
        affectedEntityIds.add(capital.id);
      }
      break;
    }
    case "embezzle_treasury": {
      const government = state.governments[action.targetId];
      if (!government) return;
      const before = structuredClone(government);
      government.treasury = Math.floor(government.treasury * 0.25);
      government.legitimacy = clamp01(government.legitimacy - 0.3);
      recordEntityChange(effects, government.id, "governments", before, structuredClone(government));
      break;
    }
    case "dissolve_government": {
      const government = state.governments[action.targetId];
      if (!government) return;
      const before = structuredClone(government);
      government.treasury = 0;
      government.legitimacy = 0;
      government.taxRate = 0;
      recordEntityChange(effects, government.id, "governments", before, structuredClone(government));
      break;
    }
    case "route_repair": {
      const route = state.routes[action.targetId];
      if (!route) return;
      const before = structuredClone(route);
      route.condition = 1;
      route.capacity += 50;
      route.travelTime = Math.max(1, route.travelTime * 0.82);
      recordEntityChange(effects, route.id, "routes", before, structuredClone(route));
      break;
    }
    case "route_expansion": {
      const route = state.routes[action.targetId];
      if (!route) return;
      const before = structuredClone(route);
      route.condition = 1;
      route.capacity += 180;
      route.travelTime = Math.max(1, route.travelTime * 0.72);
      recordEntityChange(effects, route.id, "routes", before, structuredClone(route));
      break;
    }
    case "subsidize_transit": {
      const route = state.routes[action.targetId];
      if (!route) return;
      const before = structuredClone(route);
      route.capacity += 60;
      route.travelTime = Math.max(1, route.travelTime * 0.8);
      route.condition = clamp01(route.condition - 0.05);
      recordEntityChange(effects, route.id, "routes", before, structuredClone(route));
      break;
    }
    case "sabotage_route": {
      const route = state.routes[action.targetId];
      if (!route) return;
      const before = structuredClone(route);
      route.condition = Math.min(route.condition, 0.15);
      route.capacity = Math.max(1, Math.floor(route.capacity * 0.35));
      route.travelTime *= 2.2;
      recordEntityChange(effects, route.id, "routes", before, structuredClone(route));
      break;
    }
    case "blockade_route": {
      const route = state.routes[action.targetId];
      if (!route) return;
      const before = structuredClone(route);
      route.capacity = 1;
      route.travelTime *= 4;
      recordEntityChange(effects, route.id, "routes", before, structuredClone(route));
      break;
    }
    case "abandon_route": {
      const route = state.routes[action.targetId];
      if (!route) return;
      const before = structuredClone(route);
      route.condition = 0;
      route.capacity = 0;
      route.travelTime *= 6;
      recordEntityChange(effects, route.id, "routes", before, structuredClone(route));
      const firstPoint = route.points[0];
      if (firstPoint) {
        addScar(
          state,
          effects,
          intervention,
          action,
          firstPoint[1] * state.mapWidth + firstPoint[0],
          "abandoned_route",
          0.8,
        );
      }
      break;
    }
    case "restore_bridge": {
      const bridge = state.bridges[action.targetId];
      if (!bridge || bridge.status === "active") return;
      const before = structuredClone(bridge);
      bridge.status = "active";
      recordEntityChange(effects, bridge.id, "bridges", before, structuredClone(bridge));
      const route = state.routes[bridge.routeEdgeId];
      if (route) {
        const routeBefore = structuredClone(route);
        route.condition = Math.max(route.condition, 0.75);
        route.capacity += 80;
        route.travelTime = Math.max(1, route.travelTime * 0.45);
        recordEntityChange(effects, route.id, "routes", routeBefore, structuredClone(route));
        affectedEntityIds.add(route.id);
      }
      break;
    }
    case "fortify_bridge": {
      const bridge = state.bridges[action.targetId];
      if (!bridge || bridge.status !== "active") return;
      const route = state.routes[bridge.routeEdgeId];
      if (!route) return;
      const routeBefore = structuredClone(route);
      route.condition = 1;
      route.capacity += 100;
      route.travelTime = Math.max(1, route.travelTime * 0.88);
      recordEntityChange(effects, route.id, "routes", routeBefore, structuredClone(route));
      affectedEntityIds.add(route.id);
      break;
    }
    case "decommission_bridge": {
      const bridge = state.bridges[action.targetId];
      if (!bridge || bridge.status !== "active") return;
      const before = structuredClone(bridge);
      bridge.status = "ruined";
      recordEntityChange(effects, bridge.id, "bridges", before, structuredClone(bridge));
      const route = state.routes[bridge.routeEdgeId];
      if (route) {
        const routeBefore = structuredClone(route);
        route.capacity = Math.max(1, Math.floor(route.capacity * 0.5));
        route.travelTime *= 2.5;
        recordEntityChange(effects, route.id, "routes", routeBefore, structuredClone(route));
        affectedEntityIds.add(route.id);
      }
      break;
    }
    case "demolish_bridge": {
      const bridge = state.bridges[action.targetId];
      if (!bridge) return;
      const before = structuredClone(bridge);
      bridge.status = "ruined";
      recordEntityChange(effects, bridge.id, "bridges", before, structuredClone(bridge));
      const route = state.routes[bridge.routeEdgeId];
      if (route) {
        const routeBefore = structuredClone(route);
        route.condition = Math.min(route.condition, 0.35);
        route.capacity = Math.max(1, Math.floor(route.capacity * 0.15));
        route.travelTime *= 4;
        recordEntityChange(effects, route.id, "routes", routeBefore, structuredClone(route));
        affectedEntityIds.add(route.id);
      }
      addScar(state, effects, intervention, action, bridge.cellId, "abandoned_route", 0.95);
      break;
    }
  }

  if (effects.length === 0) return;

  ledger.addEvent({
    eventId: `${intervention.interventionId}_${action.actionId}`,
    time: { year: intervention.insertionYear },
    eventType: "player_intervention",
    location: {},
    actorIds: ["player"],
    affectedEntityIds: [...affectedEntityIds],
    conditions: [],
    immediateEffects: effects,
    parentEventIds: [intervention.interventionId],
    resultingEventIds: [],
    ruleId: `player_${action.kind}`,
    summaryTemplate: "The player used {action} on {targetId} at a cost of {cost} influence.",
    summaryArguments: {
      action: ACTION_LABELS[action.kind],
      targetId: action.targetId,
      cost: action.cost,
    },
    confidence: 1,
  });
}

export function applyTimelineInterventionEffects(
  state: WorldState,
  ledger: CausalLedger,
  intervention: TimelineIntervention,
): void {
  if (intervention.operation !== "alter_condition") return;

  const actions = intervention.parameters.actions;
  if (!Array.isArray(actions)) return;

  for (const rawAction of actions) {
    if (!rawAction || typeof rawAction !== "object") continue;
    const candidate = rawAction as Partial<PlayableInterventionAction>;
    if (
      typeof candidate.actionId !== "string" ||
      !isPlayableInterventionKind(candidate.kind) ||
      typeof candidate.targetId !== "string" ||
      typeof candidate.cost !== "number"
    ) continue;
    applyAction(state, ledger, intervention, candidate as PlayableInterventionAction);
  }
}
