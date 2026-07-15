import type { WorldState } from "../core/types";
import { CausalLedger } from "../timelines/ledger";
import { keyedRandom } from "../core/random";

export function updateHazards(state: WorldState, ledger: CausalLedger, year: number): void {
  // Loop through all settlements and check for hazard events
  for (const sId of Object.keys(state.settlements)) {
    const s = state.settlements[sId];
    if (s.abandoned) continue;

    // Flood risk check if near river
    const cellId = s.cellId;
    const isNearRiver = state.flowAccumulation[cellId] > 500;

    if (isNearRiver) {
      const roll = keyedRandom(state.seed, sId, "hazards_flood", year, "check");
      if (roll < 0.05) {
        // Flood occurs!
        const damage = Math.floor(s.population * 0.05);
        const wealthLoss = Math.floor(s.wealth * 0.1);

        const popBefore = s.population;
        const wealthBefore = s.wealth;

        s.population = Math.max(10, s.population - damage);
        s.wealth = Math.max(0, s.wealth - wealthLoss);
        s.diseaseBurden = Math.min(1.0, s.diseaseBurden + 0.1);

        if (s.__transientReconciliation) {
          s.__transientReconciliation.losses += (wealthBefore - s.wealth);
        }

        const floodEventId = `flood_${sId}_${year}`;
        ledger.addEvent({
          eventId: floodEventId,
          time: { year },
          eventType: "flood",
          location: { cellId, settlementId: sId },
          actorIds: [],
          affectedEntityIds: [sId],
          conditions: [
            {
              conditionId: `flood_cond_${sId}_${year}`,
              predicateType: "near_river",
              subjectIds: [sId],
              observed: [{ name: "flowAccumulation", value: state.flowAccumulation[cellId] }],
              result: true,
              role: "necessary",
              sourceSystem: "hazards",
              uncertainty: 0.1,
            },
          ],
          immediateEffects: [
            {
              entityId: sId,
              component: "settlements",
              field: "population",
              before: popBefore,
              after: s.population,
            },
            {
              entityId: sId,
              component: "settlements",
              field: "wealth",
              before: wealthBefore,
              after: s.wealth,
            },
          ],
          parentEventIds: [],
          resultingEventIds: [],
          ruleId: "flood_hazard",
          summaryTemplate:
            "A severe river flood damaged {settlementName}, reducing its population by {damage} and destroying wealth.",
          summaryArguments: { settlementName: s.name, damage },
          confidence: 0.9,
        });

        if (s.wealth !== wealthBefore) {
          ledger.addEvent({
            eventId: `wealth_change_${sId}_flood_${year}`,
            time: { year },
            eventType: "settlement_wealth_changed",
            location: { cellId, settlementId: sId },
            actorIds: [sId],
            affectedEntityIds: [sId],
            conditions: [],
            immediateEffects: [
              { entityId: sId, component: "settlements", field: "wealth", before: wealthBefore, after: s.wealth }
            ],
            parentEventIds: [floodEventId],
            resultingEventIds: [],
            ruleId: "flood_wealth_loss",
            summaryTemplate: "Wealth of {name} decreased by {delta} due to flood damage.",
            summaryArguments: { name: s.name, delta: (wealthBefore - s.wealth).toFixed(0) },
            confidence: 1.0,
          });
        }
      }
    }

    // Disease outbreak check based on density and size
    if (s.population > 500) {
      const roll = keyedRandom(state.seed, sId, "hazards_epidemic", year, "check");
      const threshold = 0.02 + s.population * 0.00001 + s.diseaseBurden * 0.1;
      if (roll < threshold) {
        const deaths = Math.floor(s.population * 0.08);
        const popBefore = s.population;

        s.population = Math.max(10, s.population - deaths);
        s.diseaseBurden = Math.max(0.1, s.diseaseBurden - 0.2);

        ledger.addEvent({
          eventId: `epidemic_${sId}_${year}`,
          time: { year },
          eventType: "epidemic",
          location: { cellId, settlementId: sId },
          actorIds: [],
          affectedEntityIds: [sId],
          conditions: [],
          immediateEffects: [
            {
              entityId: sId,
              component: "settlements",
              field: "population",
              before: popBefore,
              after: s.population,
            },
          ],
          parentEventIds: [],
          resultingEventIds: [],
          ruleId: "epidemic_hazard",
          summaryTemplate: "An epidemic broke out in {settlementName}, killing {deaths} citizens.",
          summaryArguments: { settlementName: s.name, deaths },
          confidence: 0.9,
        });
      }
    }
  }
}
