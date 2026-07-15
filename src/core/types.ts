export type EntityId = string;
export type EventId = string;
export type BranchId = string;
export type SnapshotId = string;
export type ConditionId = string;

export type CauseRole =
  | "necessary"
  | "enabling"
  | "contributing"
  | "inhibiting"
  | "trigger";

export type EpistemicStatus =
  | "recorded_fact"
  | "derived_metric"
  | "model_inference"
  | "uncertain_attribution"
  | "gpt_interpretation";

export interface SimulationTime {
  year: number;
}

export interface SpatialRef {
  cellId?: number;
  settlementId?: EntityId;
  routeEdgeId?: EntityId;
  positionMeters?: [number, number];
}

export interface QuantifiedValue {
  name: string;
  value: number;
  unit?: string;
  baseline?: number;
  threshold?: number;
}

export interface ConditionEvidence {
  conditionId: ConditionId;
  predicateType: string;
  subjectIds: EntityId[];
  observed: QuantifiedValue[];
  result: boolean;
  role: CauseRole;
  sourceSystem: string;
  uncertainty: number;
}

export interface StateDelta {
  entityId: EntityId;
  component: string;
  field: string;
  before: any;
  after: any;
  unit?: string;
}

export interface CausalEdge {
  fromEventId: EventId;
  toEventId: EventId;
  role: CauseRole;
  influence: number;
  confidence: number;
  mechanismCode: string;
  delayYears: number;
}

export interface HistoricalEvent {
  eventId: EventId;
  branchId: BranchId;
  time: SimulationTime;
  eventType: string;
  location: SpatialRef;
  actorIds: EntityId[];
  affectedEntityIds: EntityId[];
  conditions: ConditionEvidence[];
  immediateEffects: StateDelta[];
  parentEventIds: EventId[];
  resultingEventIds: EventId[];
  ruleId: string;
  summaryTemplate: string;
  summaryArguments: Record<string, string | number>;
  confidence: number;
}

export interface ResolvedTransportPath {
  edgeIds: string[];
  totalTravelTime: number;
  residualCapacity: number;
  crossingAssetIds: string[];
  mode: "network" | "off_network";
}

export interface Cohort {
  culture: string;
  occupation: string;
  wealthBand: string;
  size: number;
}

export interface Settlement {
  id: EntityId;
  name: string;
  cellId: number;
  population: number;
  carryingCapacity: number;
  foodAccess: number;
  waterSecurity: number;
  marketAccess: number;
  diseaseBurden: number;
  wealth: number;
  establishedYear: number;
  abandoned: boolean;
  abandonedYear?: number;
  __transientReconciliation?: {
    year: number;
    wealthBefore: number;
    productionIncome: number;
    exportRevenue: number;
    importExpense: number;
    transportExpense: number;
    naturalGrowth: number;
    taxesPaid: number;
    investment: number;
    losses: number;
    wealthAfter: number;
  };
}

export interface RouteEdge {
  id: EntityId;
  type: "road" | "sea" | "river";
  length: number;
  travelTime: number;
  capacity: number;
  condition: number; // 0..1
  owner?: EntityId;
  constructionYear: number;
  points: [number, number][]; // list of cell indices
}

export interface Bridge {
  id: EntityId;
  routeEdgeId: EntityId;
  cellId: number;
  span: number;
  constructionYear: number;
  status: "active" | "ruined";
}

export interface Government {
  id: EntityId;
  name: string;
  capitalId: EntityId;
  treasury: number;
  legitimacy: number; // 0..1
  taxRate: number; // 0..1
}

export interface Landmark {
  id: EntityId;
  name: string;
  type: string;
  cellId: number;
  constructionYear: number;
  state: string;
}

export interface Scar {
  id: EntityId;
  type: "abandoned_route" | "ruined_foundation" | "burn_layer" | "polluted_soil" | "deforested_land";
  cellId: number;
  year: number;
  intensity: number; // 0..1
}

export interface WorldState {
  seed: string;
  year: number;
  mapWidth: number;
  mapHeight: number;
  elevation: number[]; // flat grid
  moisture: number[]; // flat grid
  temperature: number[]; // flat grid
  flowAccumulation: number[]; // flat grid
  flowDirection: number[]; // flat grid
  soilFertility: number[]; // flat grid
  biomes: string[]; // flat grid
  resources: {
    oreGrade: number[]; // flat grid
    timberStock: number[]; // flat grid
  };
  politicalControl: Record<EntityId, number[]>; // govId -> flat grid power level
  settlements: Record<EntityId, Settlement>;
  routes: Record<EntityId, RouteEdge>;
  bridges: Record<EntityId, Bridge>;
  governments: Record<EntityId, Government>;
  cohorts: Record<EntityId, Cohort[]>; // settlementId -> cohorts
  landmarks: Record<EntityId, Landmark>;
  scars: Record<EntityId, Scar>;
}
