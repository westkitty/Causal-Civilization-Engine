import type { WorldState } from "../core/types";
import type { PlayableInterventionAction, PlayableInterventionKind } from "../timelines/interventionEffects";

export const STARTING_INFLUENCE = 100;

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
}

const ACTIONS: Record<PlayableInterventionKind, Omit<AvailableAction, "kind">> = {
  settlement_relief: {
    label: "Emergency relief",
    description: "Improve food and water access, reduce disease, and inject emergency wealth.",
    cost: 20,
  },
  market_investment: {
    label: "Invest in market",
    description: "Increase market access, carrying capacity, and productive wealth.",
    cost: 30,
  },
  government_grant: {
    label: "Fund the government",
    description: "Add treasury reserves and strengthen political legitimacy.",
    cost: 25,
  },
  route_repair: {
    label: "Repair and widen route",
    description: "Restore condition, add capacity, and lower travel time.",
    cost: 15,
  },
  decommission_bridge: {
    label: "Decommission bridge",
    description: "Remove an active crossing and test whether the network can adapt.",
    cost: 10,
  },
};

const average = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

export function scoreCivilization(state: WorldState | undefined): CivilizationScore {
  if (!state) {
    return {
      total: 0,
      population: 0,
      prosperity: 0,
      resilience: 0,
      connectivity: 0,
      legitimacy: 0,
      survivingSettlements: 0,
    };
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
    sum + Math.max(0, route.condition) * Math.max(1, route.capacity) / Math.max(1, route.travelTime), 0
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

export function actionsForEntity(state: WorldState | undefined, entityId: string | null): AvailableAction[] {
  if (!state || !entityId) return [];

  if (state.settlements[entityId] && !state.settlements[entityId].abandoned) {
    return [
      { kind: "settlement_relief", ...ACTIONS.settlement_relief },
      { kind: "market_investment", ...ACTIONS.market_investment },
    ];
  }
  if (state.governments[entityId]) {
    return [{ kind: "government_grant", ...ACTIONS.government_grant }];
  }
  if (state.routes[entityId]) {
    return [{ kind: "route_repair", ...ACTIONS.route_repair }];
  }
  if (state.bridges[entityId]?.status === "active") {
    return [{ kind: "decommission_bridge", ...ACTIONS.decommission_bridge }];
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
  if (settlement) return `${settlement.name} · population ${Math.round(settlement.population)} · wealth ${Math.round(settlement.wealth)}`;
  const government = state.governments[entityId];
  if (government) return `${government.name} · treasury ${Math.round(government.treasury)} · legitimacy ${Math.round(government.legitimacy * 100)}%`;
  const route = state.routes[entityId];
  if (route) return `${route.type} route · condition ${Math.round(route.condition * 100)}% · travel time ${route.travelTime.toFixed(1)}`;
  const bridge = state.bridges[entityId];
  if (bridge) return `Bridge at cell ${bridge.cellId} · ${bridge.status}`;
  return entityId;
}
