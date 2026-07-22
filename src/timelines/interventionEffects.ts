import type { WorldState } from "../core/types";
import { CausalLedger, diffEntity } from "./ledger";
import type { TimelineIntervention } from "./branch";

export type PlayableInterventionKind =
  | "settlement_relief"
  | "market_investment"
  | "government_grant"
  | "route_repair"
  | "decommission_bridge";

export interface PlayableInterventionAction {
  actionId: string;
  kind: PlayableInterventionKind;
  targetId: string;
  cost: number;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function actionLabel(kind: PlayableInterventionKind): string {
  switch (kind) {
    case "settlement_relief": return "Emergency relief";
    case "market_investment": return "Market investment";
    case "government_grant": return "Civic grant";
    case "route_repair": return "Repair route";
    case "decommission_bridge": return "Decommission bridge";
  }
}

function applyAction(
  state: WorldState,
  ledger: CausalLedger,
  intervention: TimelineIntervention,
  action: PlayableInterventionAction,
): void {
  let component = "";
  let before: unknown;
  let after: unknown;

  switch (action.kind) {
    case "settlement_relief": {
      const settlement = state.settlements[action.targetId];
      if (!settlement || settlement.abandoned) return;
      component = "settlements";
      before = structuredClone(settlement);
      settlement.foodAccess = clamp01(settlement.foodAccess + 0.18);
      settlement.waterSecurity = clamp01(settlement.waterSecurity + 0.18);
      settlement.diseaseBurden = clamp01(settlement.diseaseBurden - 0.22);
      settlement.wealth += 180;
      after = structuredClone(settlement);
      break;
    }
    case "market_investment": {
      const settlement = state.settlements[action.targetId];
      if (!settlement || settlement.abandoned) return;
      component = "settlements";
      before = structuredClone(settlement);
      settlement.marketAccess = clamp01(settlement.marketAccess + 0.25);
      settlement.carryingCapacity += 120;
      settlement.wealth += 300;
      after = structuredClone(settlement);
      break;
    }
    case "government_grant": {
      const government = state.governments[action.targetId];
      if (!government) return;
      component = "governments";
      before = structuredClone(government);
      government.treasury += 500;
      government.legitimacy = clamp01(government.legitimacy + 0.15);
      after = structuredClone(government);
      break;
    }
    case "route_repair": {
      const route = state.routes[action.targetId];
      if (!route) return;
      component = "routes";
      before = structuredClone(route);
      route.condition = 1;
      route.capacity += 50;
      route.travelTime = Math.max(1, route.travelTime * 0.82);
      after = structuredClone(route);
      break;
    }
    case "decommission_bridge": {
      const bridge = state.bridges[action.targetId];
      if (!bridge || bridge.status !== "active") return;
      component = "bridges";
      before = structuredClone(bridge);
      bridge.status = "ruined";
      after = structuredClone(bridge);
      break;
    }
  }

  const effects = diffEntity(action.targetId, component, before, after);
  if (effects.length === 0) return;

  ledger.addEvent({
    eventId: `${intervention.interventionId}_${action.actionId}`,
    time: { year: intervention.insertionYear },
    eventType: "player_intervention",
    location: {},
    actorIds: ["player"],
    affectedEntityIds: [action.targetId],
    conditions: [],
    immediateEffects: effects,
    parentEventIds: [intervention.interventionId],
    resultingEventIds: [],
    ruleId: `player_${action.kind}`,
    summaryTemplate: "The player used {action} on {targetId} at a cost of {cost} influence.",
    summaryArguments: {
      action: actionLabel(action.kind),
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
    const action = rawAction as PlayableInterventionAction;
    if (
      typeof action.actionId !== "string" ||
      typeof action.targetId !== "string" ||
      typeof action.cost !== "number"
    ) continue;
    applyAction(state, ledger, intervention, action);
  }
}
