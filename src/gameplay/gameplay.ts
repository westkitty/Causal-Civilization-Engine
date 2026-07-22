import type { WorldState } from "../core/types";
import type { PlayableInterventionAction, PlayableInterventionKind } from "../timelines/interventionEffects";

export const STARTING_INFLUENCE = 180;

export type ActionDisposition = "support" | "tradeoff" | "coercion" | "destruction";

export interface CivilizationScore {
  total: number;
  population: number;
  prosperity: number;
  resilience: number;
  connectivity: number;
  legitimacy: number;
  survivingSettlements: number;
}

export interface AvailableAction {
  kind: PlayableInterventionKind;
  label: string;
  description: string;
  cost: number;
  disposition: ActionDisposition;
}

const ACTIONS: Record<PlayableInterventionKind, Omit<AvailableAction, "kind">> = {
  settlement_relief: { label: "Emergency relief", description: "Improve food and water access, reduce disease, and inject emergency wealth.", cost: 18, disposition: "support" },
  sanitation_campaign: { label: "Sanitation campaign", description: "Spend local wealth to sharply reduce disease and improve water security.", cost: 20, disposition: "support" },
  irrigation_program: { label: "Irrigation program", description: "Raise food, water, carrying capacity, soil fertility, and moisture around the settlement.", cost: 28, disposition: "support" },
  housing_expansion: { label: "Expand housing", description: "Spend wealth to create substantial new carrying capacity.", cost: 22, disposition: "support" },
  market_investment: { label: "Invest in market", description: "Increase market access, carrying capacity, and productive wealth.", cost: 24, disposition: "support" },
  welcome_migrants: { label: "Welcome migrants", description: "Add a newcomer population and capacity, with short-term fiscal and disease pressure.", cost: 18, disposition: "tradeoff" },
  quarantine_settlement: { label: "Impose quarantine", description: "Reduce disease at the cost of trade, food access, and wealth.", cost: 12, disposition: "tradeoff" },
  reforest_hinterland: { label: "Reforest hinterland", description: "Restore timber, moisture, and soil fertility while imposing a short-term economic cost.", cost: 22, disposition: "support" },
  strip_mine_hinterland: { label: "Strip-mine hinterland", description: "Generate immediate wealth while exhausting ore, timber, and soil and leaving pollution.", cost: 10, disposition: "tradeoff" },
  wealth_confiscation: { label: "Confiscate wealth", description: "Destroy much of a settlement's wealth and weaken its market position.", cost: 8, disposition: "coercion" },
  engineered_scarcity: { label: "Engineer scarcity", description: "Cripple food and water access, increase disease, and damage wealth.", cost: 10, disposition: "destruction" },
  forced_displacement: { label: "Force displacement", description: "Remove nearly half the population and damage local wealth and market access.", cost: 12, disposition: "coercion" },
  forced_assimilation: { label: "Force assimilation", description: "Convert a large share of minority cohorts into the dominant culture.", cost: 10, disposition: "coercion" },
  poison_watershed: { label: "Poison watershed", description: "Devastate water security, food access, health, and the surrounding environment.", cost: 14, disposition: "destruction" },

  government_grant: { label: "Fund government", description: "Add treasury reserves and strengthen political legitimacy.", cost: 22, disposition: "support" },
  tax_relief: { label: "Grant tax relief", description: "Reduce taxes and boost legitimacy and capital wealth while draining the treasury.", cost: 18, disposition: "support" },
  institutional_reform: { label: "Reform institutions", description: "Spend treasury to substantially improve legitimacy and slightly lower taxation.", cost: 26, disposition: "support" },
  public_works_program: { label: "Public works program", description: "Spend treasury to strengthen the capital's capacity, market access, and wealth.", cost: 28, disposition: "support" },
  raise_taxes: { label: "Raise taxes", description: "Gain treasury quickly while reducing legitimacy and capital wealth.", cost: 8, disposition: "tradeoff" },
  propaganda_campaign: { label: "Propaganda campaign", description: "Purchase legitimacy without solving underlying conditions.", cost: 12, disposition: "coercion" },
  political_purge: { label: "Political purge", description: "Damage legitimacy, population, wealth, and health in the capital.", cost: 12, disposition: "coercion" },
  embezzle_treasury: { label: "Embezzle treasury", description: "Remove most public funds and sharply damage legitimacy.", cost: 6, disposition: "destruction" },
  dissolve_government: { label: "Dissolve government", description: "Eliminate treasury, legitimacy, and taxation entirely.", cost: 14, disposition: "destruction" },

  route_repair: { label: "Repair route", description: "Restore condition, add capacity, and lower travel time.", cost: 12, disposition: "support" },
  route_expansion: { label: "Expand route", description: "Greatly increase route capacity and reduce travel time.", cost: 24, disposition: "support" },
  subsidize_transit: { label: "Subsidize transit", description: "Increase throughput and speed while slightly accelerating wear.", cost: 16, disposition: "tradeoff" },
  sabotage_route: { label: "Sabotage route", description: "Severely damage condition, capacity, and travel speed.", cost: 8, disposition: "destruction" },
  blockade_route: { label: "Blockade route", description: "Reduce a route to near-zero capacity and multiply travel time.", cost: 10, disposition: "coercion" },
  abandon_route: { label: "Abandon route", description: "Remove all usable capacity and leave a permanent abandoned-route scar.", cost: 6, disposition: "destruction" },

  restore_bridge: { label: "Restore bridge", description: "Reactivate a ruined bridge and improve its connected route.", cost: 24, disposition: "support" },
  fortify_bridge: { label: "Fortify bridge", description: "Strengthen the connected route's condition, capacity, and speed.", cost: 18, disposition: "support" },
  decommission_bridge: { label: "Decommission bridge", description: "Close the crossing and seriously reduce connected-route performance.", cost: 8, disposition: "tradeoff" },
  demolish_bridge: { label: "Demolish bridge", description: "Destroy the crossing, cripple the route, and leave a permanent scar.", cost: 10, disposition: "destruction" },
};

const average = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

export function scoreCivilization(state: WorldState | undefined): CivilizationScore {
  if (!state) {
    return { total: 0, population: 0, prosperity: 0, resilience: 0, connectivity: 0, legitimacy: 0, survivingSettlements: 0 };
  }

  const settlements = Object.values(state.settlements);
  const active = settlements.filter((settlement) => !settlement.abandoned);
  const governments = Object.values(state.governments);
  const routes = Object.values(state.routes);

  const population = active.reduce((sum, settlement) => sum + settlement.population, 0);
  const prosperity = active.reduce((sum, settlement) => sum + settlement.wealth, 0);
  const resilience = average(active.map((settlement) =>
    ((settlement.foodAccess + settlement.waterSecurity + (1 - settlement.diseaseBurden)) / 3) * 100
  ));
  const connectivity = routes.reduce((sum, route) =>
    sum + Math.max(0, route.condition) * Math.max(0, route.capacity) / Math.max(1, route.travelTime), 0
  );
  const legitimacy = average(governments.map((government) => government.legitimacy * 100));

  const populationPoints = Math.log10(Math.max(10, population)) * 90;
  const prosperityPoints = Math.log10(Math.max(10, prosperity)) * 65;
  const settlementPoints = active.length * 40;
  const total = Math.round(
    populationPoints +
    prosperityPoints +
    resilience * 2.2 +
    Math.min(300, connectivity * 0.35) +
    legitimacy * 1.4 +
    settlementPoints
  );

  return {
    total,
    population: Math.round(population),
    prosperity: Math.round(prosperity),
    resilience: Math.round(resilience),
    connectivity: Math.round(connectivity),
    legitimacy: Math.round(legitimacy),
    survivingSettlements: active.length,
  };
}

function available(...kinds: PlayableInterventionKind[]): AvailableAction[] {
  return kinds.map((kind) => ({ kind, ...ACTIONS[kind] }));
}

export function actionsForEntity(state: WorldState | undefined, entityId: string | null): AvailableAction[] {
  if (!state || !entityId) return [];

  if (state.settlements[entityId] && !state.settlements[entityId].abandoned) {
    return available(
      "settlement_relief", "sanitation_campaign", "irrigation_program", "housing_expansion",
      "market_investment", "welcome_migrants", "quarantine_settlement", "reforest_hinterland",
      "strip_mine_hinterland", "wealth_confiscation", "engineered_scarcity", "forced_displacement",
      "forced_assimilation", "poison_watershed",
    );
  }
  if (state.governments[entityId]) {
    return available(
      "government_grant", "tax_relief", "institutional_reform", "public_works_program",
      "raise_taxes", "propaganda_campaign", "political_purge", "embezzle_treasury", "dissolve_government",
    );
  }
  if (state.routes[entityId]) {
    return available(
      "route_repair", "route_expansion", "subsidize_transit",
      "sabotage_route", "blockade_route", "abandon_route",
    );
  }
  const bridge = state.bridges[entityId];
  if (bridge) {
    return bridge.status === "active"
      ? available("fortify_bridge", "decommission_bridge", "demolish_bridge")
      : available("restore_bridge", "demolish_bridge");
  }
  return [];
}

export function makeQueuedAction(
  kind: PlayableInterventionKind,
  targetId: string,
  sequence: number,
): PlayableInterventionAction {
  return {
    actionId: `action_${sequence}_${kind}_${targetId}`,
    kind,
    targetId,
    cost: ACTIONS[kind].cost,
  };
}

export function describeEntity(state: WorldState | undefined, entityId: string | null): string {
  if (!state || !entityId) return "Select a settlement, route, bridge, or government on the map.";
  const settlement = state.settlements[entityId];
  if (settlement) return `${settlement.name} · population ${Math.round(settlement.population)} · wealth ${Math.round(settlement.wealth)} · food ${Math.round(settlement.foodAccess * 100)}% · water ${Math.round(settlement.waterSecurity * 100)}% · disease ${Math.round(settlement.diseaseBurden * 100)}%`;
  const government = state.governments[entityId];
  if (government) return `${government.name} · treasury ${Math.round(government.treasury)} · legitimacy ${Math.round(government.legitimacy * 100)}% · tax ${Math.round(government.taxRate * 100)}%`;
  const route = state.routes[entityId];
  if (route) return `${route.type} route · condition ${Math.round(route.condition * 100)}% · capacity ${Math.round(route.capacity)} · travel time ${route.travelTime.toFixed(1)}`;
  const bridge = state.bridges[entityId];
  if (bridge) return `Bridge at cell ${bridge.cellId} · ${bridge.status} · route ${bridge.routeEdgeId}`;
  return entityId;
}
