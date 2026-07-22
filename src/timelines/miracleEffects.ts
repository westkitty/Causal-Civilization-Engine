import type { Landmark, Scar, Settlement, StateDelta, WorldState } from "../core/types";
import { CausalLedger, diffEntity } from "./ledger";
import type { TimelineIntervention } from "./branch";

export type DivineMiracleKind =
  | "rain_of_plenty"
  | "healing_light"
  | "divine_sanctuary"
  | "golden_age"
  | "found_star_city"
  | "resurrect_city"
  | "divine_highway"
  | "world_bloom"
  | "great_deluge"
  | "seven_year_drought"
  | "plague_wind"
  | "pillar_of_fire"
  | "earthshaker"
  | "falling_star"
  | "age_of_ruin";

export type MiracleDisposition = "blessing" | "wonder" | "wrath" | "apocalypse";

export interface DivineMiracleAction {
  miracleId: string;
  kind: DivineMiracleKind;
  targetId: string | null;
  cost: number;
}

export const MIRACLE_LABELS: Record<DivineMiracleKind, string> = {
  rain_of_plenty: "Rain of Plenty",
  healing_light: "Healing Light",
  divine_sanctuary: "Raise Divine Sanctuary",
  golden_age: "Declare a Golden Age",
  found_star_city: "Call Down a Star City",
  resurrect_city: "Resurrect the Fallen City",
  divine_highway: "Lay the Divine Highway",
  world_bloom: "World Bloom",
  great_deluge: "The Great Deluge",
  seven_year_drought: "Seven-Year Drought",
  plague_wind: "The Plague Wind",
  pillar_of_fire: "Pillar of Fire",
  earthshaker: "The Earthshaker",
  falling_star: "Call the Falling Star",
  age_of_ruin: "Begin the Age of Ruin",
};

export const MIRACLE_DISPOSITIONS: Record<DivineMiracleKind, MiracleDisposition> = {
  rain_of_plenty: "blessing",
  healing_light: "blessing",
  divine_sanctuary: "wonder",
  golden_age: "wonder",
  found_star_city: "wonder",
  resurrect_city: "wonder",
  divine_highway: "wonder",
  world_bloom: "blessing",
  great_deluge: "wrath",
  seven_year_drought: "wrath",
  plague_wind: "wrath",
  pillar_of_fire: "wrath",
  earthshaker: "wrath",
  falling_star: "apocalypse",
  age_of_ruin: "apocalypse",
};

const MIRACLE_KINDS = new Set<DivineMiracleKind>(Object.keys(MIRACLE_LABELS) as DivineMiracleKind[]);
const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));
const clamp01 = (value: number): number => clamp(value, 0, 1);

function isMiracleKind(value: unknown): value is DivineMiracleKind {
  return typeof value === "string" && MIRACLE_KINDS.has(value as DivineMiracleKind);
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

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageAt(values: number[], cells: number[]): number {
  if (cells.length === 0) return 0;
  return cells.reduce((sum, cellId) => sum + values[cellId], 0) / cells.length;
}

function neighborhoodCells(state: WorldState, cellId: number, radius: number): number[] {
  const centerX = cellId % state.mapWidth;
  const centerY = Math.floor(cellId / state.mapWidth);
  const cells: number[] = [];

  for (let y = Math.max(0, centerY - radius); y <= Math.min(state.mapHeight - 1, centerY + radius); y++) {
    for (let x = Math.max(0, centerX - radius); x <= Math.min(state.mapWidth - 1, centerX + radius); x++) {
      if (Math.hypot(x - centerX, y - centerY) <= radius + 0.25) {
        cells.push(y * state.mapWidth + x);
      }
    }
  }

  return cells;
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

function alterGlobalField(
  effects: StateDelta[],
  values: number[],
  field: string,
  delta: number,
  minimum: number = 0,
  maximum: number = 100,
): void {
  const before = average(values);
  for (let index = 0; index < values.length; index++) {
    values[index] = clamp(values[index] + delta, minimum, maximum);
  }
  const after = average(values);
  recordFieldChange(effects, "world", "geography", `global_${field}`, before, after);
}

function addScar(
  state: WorldState,
  effects: StateDelta[],
  intervention: TimelineIntervention,
  miracle: DivineMiracleAction,
  cellId: number,
  type: Scar["type"],
  intensity: number,
  suffix: string,
): void {
  const scarId = `miracle_scar_${intervention.interventionId}_${miracle.miracleId}_${suffix}`;
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

function addLandmark(
  state: WorldState,
  effects: StateDelta[],
  intervention: TimelineIntervention,
  miracle: DivineMiracleAction,
  cellId: number,
  name: string,
  type: string,
): void {
  const landmarkId = `miracle_landmark_${intervention.interventionId}_${miracle.miracleId}`;
  const landmark: Landmark = {
    id: landmarkId,
    name,
    type,
    cellId,
    constructionYear: intervention.insertionYear,
    state: "radiant",
  };
  state.landmarks[landmarkId] = landmark;
  effects.push(...diffEntity(landmarkId, "landmarks", null, landmark));
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
  if (total !== settlement.population) {
    cohorts[0].size = Math.max(0, cohorts[0].size + settlement.population - total);
  }
  recordFieldChange(effects, settlementId, "cohorts", "composition", before, structuredClone(cohorts));
}

function growFirstCohort(state: WorldState, effects: StateDelta[], settlementId: string, amount: number): void {
  const cohorts = (state.cohorts[settlementId] ??= []);
  const before = structuredClone(cohorts);
  if (cohorts.length === 0) {
    cohorts.push({ culture: "pilgrim", occupation: "farmer", wealthBand: "middle", size: amount });
  } else {
    cohorts[0].size += amount;
  }
  recordFieldChange(effects, settlementId, "cohorts", "composition", before, structuredClone(cohorts));
}

function settlementDistance(state: WorldState, cellA: number, cellB: number): number {
  const ax = cellA % state.mapWidth;
  const ay = Math.floor(cellA / state.mapWidth);
  const bx = cellB % state.mapWidth;
  const by = Math.floor(cellB / state.mapWidth);
  return Math.hypot(ax - bx, ay - by);
}

function routeNearCell(state: WorldState, routeId: string, cellId: number, radius: number): boolean {
  const route = state.routes[routeId];
  if (!route) return false;
  const centerX = cellId % state.mapWidth;
  const centerY = Math.floor(cellId / state.mapWidth);
  return route.points.some(([x, y]) => Math.hypot(x - centerX, y - centerY) <= radius);
}

function findStarCityCell(state: WorldState, sourceCellId: number): number | null {
  const centerX = sourceCellId % state.mapWidth;
  const centerY = Math.floor(sourceCellId / state.mapWidth);
  let bestCell: number | null = null;
  let bestScore = -Infinity;

  for (let y = Math.max(0, centerY - 28); y <= Math.min(state.mapHeight - 1, centerY + 28); y++) {
    for (let x = Math.max(0, centerX - 28); x <= Math.min(state.mapWidth - 1, centerX + 28); x++) {
      const cellId = y * state.mapWidth + x;
      const distance = Math.hypot(x - centerX, y - centerY);
      if (distance < 10 || distance > 28) continue;
      if (state.biomes[cellId] === "ocean" || state.elevation[cellId] < 30 || state.elevation[cellId] > 750) continue;
      if (Object.values(state.settlements).some((settlement) => !settlement.abandoned && settlementDistance(state, cellId, settlement.cellId) < 8)) continue;

      const score =
        state.soilFertility[cellId] * 0.7 +
        Math.min(35, state.flowAccumulation[cellId] / 20) +
        state.resources.timberStock[cellId] * 0.2 +
        state.resources.oreGrade[cellId] * 0.1 -
        Math.abs(distance - 18);
      if (score > bestScore) {
        bestScore = score;
        bestCell = cellId;
      }
    }
  }

  return bestCell;
}

function createStarCity(
  state: WorldState,
  effects: StateDelta[],
  intervention: TimelineIntervention,
  miracle: DivineMiracleAction,
  source: Settlement,
): void {
  const cellId = findStarCityCell(state, source.cellId);
  if (cellId === null) return;
  const settlementId = `star_city_${cellId}_${intervention.insertionYear}`;
  if (state.settlements[settlementId]) return;

  const index = Object.keys(state.settlements).length + 1;
  const settlement: Settlement = {
    id: settlementId,
    name: `Starhaven ${index}`,
    cellId,
    population: 260,
    carryingCapacity: 1100 + Math.floor(state.soilFertility[cellId] * 7),
    foodAccess: 1,
    waterSecurity: 1,
    marketAccess: 0.72,
    diseaseBurden: 0,
    wealth: 2200,
    establishedYear: intervention.insertionYear,
    abandoned: false,
  };
  state.settlements[settlementId] = settlement;
  const sourceCulture = state.cohorts[source.id]?.[0]?.culture ?? "pilgrim";
  state.cohorts[settlementId] = [
    { culture: sourceCulture, occupation: "farmer", wealthBand: "middle", size: 150 },
    { culture: sourceCulture, occupation: "merchant", wealthBand: "rich", size: 70 },
    { culture: "starborn", occupation: "artisan", wealthBand: "middle", size: 40 },
  ];
  effects.push(...diffEntity(settlementId, "settlements", null, settlement));
  recordFieldChange(effects, settlementId, "cohorts", "composition", null, state.cohorts[settlementId]);
  addLandmark(state, effects, intervention, miracle, cellId, "The Star Gate", "divine_star_gate");
}

function applyMiracle(
  state: WorldState,
  ledger: CausalLedger,
  intervention: TimelineIntervention,
  miracle: DivineMiracleAction,
): void {
  const effects: StateDelta[] = [];
  const affectedEntityIds = new Set<string>();
  if (miracle.targetId) affectedEntityIds.add(miracle.targetId);

  switch (miracle.kind) {
    case "rain_of_plenty": {
      const settlement = miracle.targetId ? state.settlements[miracle.targetId] : undefined;
      if (!settlement || settlement.abandoned) return;
      const before = structuredClone(settlement);
      settlement.foodAccess = 1;
      settlement.waterSecurity = 1;
      settlement.carryingCapacity += 360;
      settlement.wealth += 260;
      settlement.diseaseBurden = clamp01(settlement.diseaseBurden - 0.12);
      recordEntityChange(effects, settlement.id, "settlements", before, structuredClone(settlement));
      const cells = neighborhoodCells(state, settlement.cellId, 4);
      alterLocalField(effects, settlement.id, state.moisture, cells, "moisture", 24);
      alterLocalField(effects, settlement.id, state.soilFertility, cells, "soil_fertility", 18);
      alterLocalField(effects, settlement.id, state.resources.timberStock, cells, "timber_stock", 12);
      break;
    }
    case "healing_light": {
      const settlement = miracle.targetId ? state.settlements[miracle.targetId] : undefined;
      if (!settlement || settlement.abandoned) return;
      const before = structuredClone(settlement);
      const healedPopulation = Math.max(25, Math.floor(settlement.population * 0.08));
      settlement.population += healedPopulation;
      settlement.diseaseBurden = 0;
      settlement.foodAccess = clamp01(settlement.foodAccess + 0.15);
      settlement.waterSecurity = clamp01(settlement.waterSecurity + 0.15);
      growFirstCohort(state, effects, settlement.id, healedPopulation);
      recordEntityChange(effects, settlement.id, "settlements", before, structuredClone(settlement));
      break;
    }
    case "divine_sanctuary": {
      const settlement = miracle.targetId ? state.settlements[miracle.targetId] : undefined;
      if (!settlement || settlement.abandoned) return;
      const before = structuredClone(settlement);
      settlement.carryingCapacity = Math.max(settlement.carryingCapacity * 2, settlement.population * 2.5);
      settlement.foodAccess = 1;
      settlement.waterSecurity = 1;
      settlement.diseaseBurden = 0;
      settlement.marketAccess = clamp01(settlement.marketAccess + 0.2);
      settlement.wealth += 1200;
      recordEntityChange(effects, settlement.id, "settlements", before, structuredClone(settlement));
      addLandmark(state, effects, intervention, miracle, settlement.cellId, "Sanctuary of the Watching God", "divine_sanctuary");
      break;
    }
    case "golden_age": {
      const government = miracle.targetId ? state.governments[miracle.targetId] : undefined;
      if (!government) return;
      const before = structuredClone(government);
      government.treasury += 1800;
      government.legitimacy = 1;
      government.taxRate = clamp01(government.taxRate - 0.06);
      recordEntityChange(effects, government.id, "governments", before, structuredClone(government));
      const capital = state.settlements[government.capitalId];
      if (capital) {
        for (const settlement of Object.values(state.settlements)) {
          if (settlement.abandoned || settlementDistance(state, capital.cellId, settlement.cellId) > 28) continue;
          const settlementBefore = structuredClone(settlement);
          settlement.wealth += 850;
          settlement.marketAccess = clamp01(settlement.marketAccess + 0.28);
          settlement.carryingCapacity += 180;
          recordEntityChange(effects, settlement.id, "settlements", settlementBefore, structuredClone(settlement));
          affectedEntityIds.add(settlement.id);
        }
        addLandmark(state, effects, intervention, miracle, capital.cellId, "The Aureate Throne", "golden_age_throne");
      }
      break;
    }
    case "found_star_city": {
      const settlement = miracle.targetId ? state.settlements[miracle.targetId] : undefined;
      if (!settlement || settlement.abandoned) return;
      createStarCity(state, effects, intervention, miracle, settlement);
      break;
    }
    case "resurrect_city": {
      const settlement = miracle.targetId ? state.settlements[miracle.targetId] : undefined;
      if (!settlement || !settlement.abandoned) return;
      const before = structuredClone(settlement);
      settlement.abandoned = false;
      delete settlement.abandonedYear;
      settlement.population = Math.max(140, Math.floor(settlement.carryingCapacity * 0.32));
      settlement.wealth = Math.max(900, settlement.wealth);
      settlement.foodAccess = 0.9;
      settlement.waterSecurity = 0.9;
      settlement.marketAccess = Math.max(0.45, settlement.marketAccess);
      settlement.diseaseBurden = 0.02;
      state.cohorts[settlement.id] = [
        { culture: "returned", occupation: "farmer", wealthBand: "middle", size: Math.floor(settlement.population * 0.65) },
        { culture: "returned", occupation: "artisan", wealthBand: "middle", size: settlement.population - Math.floor(settlement.population * 0.65) },
      ];
      recordEntityChange(effects, settlement.id, "settlements", before, structuredClone(settlement));
      recordFieldChange(effects, settlement.id, "cohorts", "composition", null, state.cohorts[settlement.id]);
      addLandmark(state, effects, intervention, miracle, settlement.cellId, "The Returning Bell", "resurrection_bell");
      break;
    }
    case "divine_highway": {
      const route = miracle.targetId ? state.routes[miracle.targetId] : undefined;
      if (!route) return;
      const before = structuredClone(route);
      route.condition = 1;
      route.capacity += 520;
      route.travelTime = Math.max(1, route.travelTime * 0.22);
      recordEntityChange(effects, route.id, "routes", before, structuredClone(route));
      for (const bridge of Object.values(state.bridges)) {
        if (bridge.routeEdgeId !== route.id) continue;
        const bridgeBefore = structuredClone(bridge);
        bridge.status = "active";
        recordEntityChange(effects, bridge.id, "bridges", bridgeBefore, structuredClone(bridge));
        affectedEntityIds.add(bridge.id);
      }
      const firstPoint = route.points[0];
      if (firstPoint) {
        addLandmark(
          state,
          effects,
          intervention,
          miracle,
          firstPoint[1] * state.mapWidth + firstPoint[0],
          "The First Mile",
          "divine_highway_marker",
        );
      }
      break;
    }
    case "world_bloom": {
      for (const settlement of Object.values(state.settlements)) {
        if (settlement.abandoned) continue;
        const before = structuredClone(settlement);
        settlement.foodAccess = 1;
        settlement.waterSecurity = 1;
        settlement.diseaseBurden = 0;
        settlement.carryingCapacity += 480;
        settlement.wealth += 500;
        recordEntityChange(effects, settlement.id, "settlements", before, structuredClone(settlement));
        affectedEntityIds.add(settlement.id);
      }
      alterGlobalField(effects, state.moisture, "moisture", 14);
      alterGlobalField(effects, state.soilFertility, "soil_fertility", 16);
      alterGlobalField(effects, state.resources.timberStock, "timber_stock", 20);
      affectedEntityIds.add("world");
      break;
    }
    case "great_deluge": {
      const settlement = miracle.targetId ? state.settlements[miracle.targetId] : undefined;
      if (!settlement || settlement.abandoned) return;
      const before = structuredClone(settlement);
      const beforePopulation = settlement.population;
      settlement.population = Math.max(20, Math.floor(settlement.population * 0.72));
      settlement.wealth = Math.floor(settlement.wealth * 0.58);
      settlement.foodAccess = clamp01(settlement.foodAccess - 0.32);
      settlement.waterSecurity = clamp01(settlement.waterSecurity + 0.12);
      settlement.diseaseBurden = clamp01(settlement.diseaseBurden + 0.34);
      settlement.carryingCapacity = Math.max(100, Math.floor(settlement.carryingCapacity * 0.82));
      rescaleCohorts(state, effects, settlement.id, beforePopulation);
      recordEntityChange(effects, settlement.id, "settlements", before, structuredClone(settlement));
      const cells = neighborhoodCells(state, settlement.cellId, 5);
      alterLocalField(effects, settlement.id, state.moisture, cells, "moisture", 42);
      alterLocalField(effects, settlement.id, state.flowAccumulation, cells, "flow_accumulation", 420, 0, 5000);
      addScar(state, effects, intervention, miracle, settlement.cellId, "polluted_soil", 0.62, "deluge");
      break;
    }
    case "seven_year_drought": {
      const settlement = miracle.targetId ? state.settlements[miracle.targetId] : undefined;
      if (!settlement || settlement.abandoned) return;
      const before = structuredClone(settlement);
      const beforePopulation = settlement.population;
      settlement.population = Math.max(20, Math.floor(settlement.population * 0.84));
      settlement.wealth = Math.floor(settlement.wealth * 0.76);
      settlement.foodAccess = clamp01(settlement.foodAccess - 0.56);
      settlement.waterSecurity = clamp01(settlement.waterSecurity - 0.62);
      settlement.diseaseBurden = clamp01(settlement.diseaseBurden + 0.18);
      settlement.carryingCapacity = Math.max(100, Math.floor(settlement.carryingCapacity * 0.72));
      rescaleCohorts(state, effects, settlement.id, beforePopulation);
      recordEntityChange(effects, settlement.id, "settlements", before, structuredClone(settlement));
      const cells = neighborhoodCells(state, settlement.cellId, 5);
      alterLocalField(effects, settlement.id, state.moisture, cells, "moisture", -44);
      alterLocalField(effects, settlement.id, state.soilFertility, cells, "soil_fertility", -24);
      break;
    }
    case "plague_wind": {
      const settlement = miracle.targetId ? state.settlements[miracle.targetId] : undefined;
      if (!settlement || settlement.abandoned) return;
      const before = structuredClone(settlement);
      const beforePopulation = settlement.population;
      settlement.population = Math.max(15, Math.floor(settlement.population * 0.58));
      settlement.wealth = Math.floor(settlement.wealth * 0.64);
      settlement.diseaseBurden = 0.96;
      settlement.marketAccess = clamp01(settlement.marketAccess - 0.12);
      rescaleCohorts(state, effects, settlement.id, beforePopulation);
      recordEntityChange(effects, settlement.id, "settlements", before, structuredClone(settlement));
      addScar(state, effects, intervention, miracle, settlement.cellId, "ruined_foundation", 0.5, "plague");
      break;
    }
    case "pillar_of_fire": {
      const settlement = miracle.targetId ? state.settlements[miracle.targetId] : undefined;
      if (!settlement || settlement.abandoned) return;
      const before = structuredClone(settlement);
      const beforePopulation = settlement.population;
      settlement.population = Math.max(10, Math.floor(settlement.population * 0.62));
      settlement.wealth = Math.floor(settlement.wealth * 0.4);
      settlement.foodAccess = clamp01(settlement.foodAccess - 0.38);
      settlement.waterSecurity = clamp01(settlement.waterSecurity - 0.24);
      settlement.carryingCapacity = Math.max(80, Math.floor(settlement.carryingCapacity * 0.64));
      rescaleCohorts(state, effects, settlement.id, beforePopulation);
      recordEntityChange(effects, settlement.id, "settlements", before, structuredClone(settlement));
      const cells = neighborhoodCells(state, settlement.cellId, 4);
      alterLocalField(effects, settlement.id, state.resources.timberStock, cells, "timber_stock", -70);
      alterLocalField(effects, settlement.id, state.soilFertility, cells, "soil_fertility", -22);
      addScar(state, effects, intervention, miracle, settlement.cellId, "burn_layer", 1, "fire");
      break;
    }
    case "earthshaker": {
      const settlement = miracle.targetId ? state.settlements[miracle.targetId] : undefined;
      if (!settlement || settlement.abandoned) return;
      const before = structuredClone(settlement);
      const beforePopulation = settlement.population;
      settlement.population = Math.max(20, Math.floor(settlement.population * 0.8));
      settlement.wealth = Math.floor(settlement.wealth * 0.66);
      settlement.carryingCapacity = Math.max(100, Math.floor(settlement.carryingCapacity * 0.8));
      rescaleCohorts(state, effects, settlement.id, beforePopulation);
      recordEntityChange(effects, settlement.id, "settlements", before, structuredClone(settlement));

      for (const route of Object.values(state.routes)) {
        if (!routeNearCell(state, route.id, settlement.cellId, 14)) continue;
        const routeBefore = structuredClone(route);
        route.condition = Math.min(route.condition, 0.24);
        route.capacity = Math.max(1, Math.floor(route.capacity * 0.42));
        route.travelTime *= 2.4;
        recordEntityChange(effects, route.id, "routes", routeBefore, structuredClone(route));
        affectedEntityIds.add(route.id);
      }
      for (const bridge of Object.values(state.bridges)) {
        if (settlementDistance(state, bridge.cellId, settlement.cellId) > 14) continue;
        const bridgeBefore = structuredClone(bridge);
        bridge.status = "ruined";
        recordEntityChange(effects, bridge.id, "bridges", bridgeBefore, structuredClone(bridge));
        affectedEntityIds.add(bridge.id);
      }
      addScar(state, effects, intervention, miracle, settlement.cellId, "ruined_foundation", 0.9, "quake");
      break;
    }
    case "falling_star": {
      const settlement = miracle.targetId ? state.settlements[miracle.targetId] : undefined;
      if (!settlement || settlement.abandoned) return;
      const before = structuredClone(settlement);
      const beforePopulation = settlement.population;
      settlement.population = Math.max(5, Math.floor(settlement.population * 0.16));
      settlement.wealth = Math.floor(settlement.wealth * 0.08);
      settlement.foodAccess = clamp01(settlement.foodAccess - 0.72);
      settlement.waterSecurity = clamp01(settlement.waterSecurity - 0.52);
      settlement.diseaseBurden = clamp01(settlement.diseaseBurden + 0.42);
      settlement.carryingCapacity = Math.max(40, Math.floor(settlement.carryingCapacity * 0.34));
      rescaleCohorts(state, effects, settlement.id, beforePopulation);
      recordEntityChange(effects, settlement.id, "settlements", before, structuredClone(settlement));
      const cells = neighborhoodCells(state, settlement.cellId, 6);
      alterLocalField(effects, settlement.id, state.soilFertility, cells, "soil_fertility", -72);
      alterLocalField(effects, settlement.id, state.resources.timberStock, cells, "timber_stock", -95);
      alterLocalField(effects, settlement.id, state.resources.oreGrade, cells, "ore_grade", 25);
      alterLocalField(effects, settlement.id, state.elevation, cells, "elevation", -80, 0, 1200);
      addScar(state, effects, intervention, miracle, settlement.cellId, "burn_layer", 1, "meteor_fire");
      addScar(state, effects, intervention, miracle, settlement.cellId, "ruined_foundation", 1, "meteor_crater");
      break;
    }
    case "age_of_ruin": {
      for (const settlement of Object.values(state.settlements)) {
        if (settlement.abandoned) continue;
        const before = structuredClone(settlement);
        const beforePopulation = settlement.population;
        settlement.population = Math.max(5, Math.floor(settlement.population * 0.46));
        settlement.wealth = Math.floor(settlement.wealth * 0.28);
        settlement.foodAccess = clamp01(settlement.foodAccess - 0.4);
        settlement.waterSecurity = clamp01(settlement.waterSecurity - 0.3);
        settlement.diseaseBurden = clamp01(settlement.diseaseBurden + 0.36);
        settlement.carryingCapacity = Math.max(30, Math.floor(settlement.carryingCapacity * 0.62));
        rescaleCohorts(state, effects, settlement.id, beforePopulation);
        recordEntityChange(effects, settlement.id, "settlements", before, structuredClone(settlement));
        addScar(state, effects, intervention, miracle, settlement.cellId, "burn_layer", 0.75, `ruin_${settlement.id}`);
        affectedEntityIds.add(settlement.id);
      }
      for (const government of Object.values(state.governments)) {
        const before = structuredClone(government);
        government.treasury = Math.floor(government.treasury * 0.12);
        government.legitimacy = clamp01(government.legitimacy * 0.2);
        recordEntityChange(effects, government.id, "governments", before, structuredClone(government));
        affectedEntityIds.add(government.id);
      }
      for (const route of Object.values(state.routes)) {
        const before = structuredClone(route);
        route.condition = Math.min(route.condition, 0.18);
        route.capacity = Math.max(0, Math.floor(route.capacity * 0.22));
        route.travelTime *= 3.4;
        recordEntityChange(effects, route.id, "routes", before, structuredClone(route));
        affectedEntityIds.add(route.id);
      }
      for (const bridge of Object.values(state.bridges)) {
        const before = structuredClone(bridge);
        bridge.status = "ruined";
        recordEntityChange(effects, bridge.id, "bridges", before, structuredClone(bridge));
        affectedEntityIds.add(bridge.id);
      }
      alterGlobalField(effects, state.soilFertility, "soil_fertility", -18);
      alterGlobalField(effects, state.resources.timberStock, "timber_stock", -24);
      affectedEntityIds.add("world");
      break;
    }
  }

  if (effects.length === 0) return;

  ledger.addEvent({
    eventId: `${intervention.interventionId}_${miracle.miracleId}`,
    time: { year: intervention.insertionYear },
    eventType: "divine_miracle",
    location: {},
    actorIds: ["overwatching_god"],
    affectedEntityIds: [...affectedEntityIds],
    conditions: [],
    immediateEffects: effects,
    parentEventIds: [intervention.interventionId],
    resultingEventIds: [],
    ruleId: `miracle_${miracle.kind}`,
    summaryTemplate: "The overwatching god invoked {miracle} upon {target} at a cost of {cost} divinity.",
    summaryArguments: {
      miracle: MIRACLE_LABELS[miracle.kind],
      target: miracle.targetId ?? "the whole world",
      cost: miracle.cost,
      disposition: MIRACLE_DISPOSITIONS[miracle.kind],
    },
    confidence: 1,
  });
}

export function applyTimelineMiracleEffects(
  state: WorldState,
  ledger: CausalLedger,
  intervention: TimelineIntervention,
): void {
  if (intervention.operation !== "alter_condition") return;
  const miracles = intervention.parameters.miracles;
  if (!Array.isArray(miracles)) return;

  for (const rawMiracle of miracles) {
    if (!rawMiracle || typeof rawMiracle !== "object") continue;
    const candidate = rawMiracle as Partial<DivineMiracleAction>;
    if (
      typeof candidate.miracleId !== "string" ||
      !isMiracleKind(candidate.kind) ||
      (candidate.targetId !== null && typeof candidate.targetId !== "string") ||
      typeof candidate.cost !== "number"
    ) continue;
    applyMiracle(state, ledger, intervention, candidate as DivineMiracleAction);
  }
}
