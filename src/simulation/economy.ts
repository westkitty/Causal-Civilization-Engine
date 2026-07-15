import type { WorldState } from "../core/types";
import { CausalLedger } from "../timelines/ledger";

export function updateEconomy(state: WorldState, ledger: CausalLedger, year: number): void {
  const sIds = Object.keys(state.settlements).filter(id => !state.settlements[id].abandoned);
  if (sIds.length === 0) return;

  const width = state.mapWidth;

  const GOODS = ["grain", "timber", "metal"];
  const BASE_PRICES: Record<string, number> = { grain: 1.0, timber: 2.0, metal: 5.0 };

  // 1. Calculate production and consumption per settlement
  const surplus: Record<string, Record<string, number>> = {};
  const deficit: Record<string, Record<string, number>> = {};
  
  const production: Record<string, Record<string, number>> = {};
  const consumption: Record<string, Record<string, number>> = {};

  for (const sId of sIds) {
    const s = state.settlements[sId];
    const cellId = s.cellId;
    const cohorts = state.cohorts[sId] || [];

    // Count occupations
    let farmers = 0;
    let woodcutters = 0;
    let merchants = 0;

    for (const co of cohorts) {
      if (co.occupation === "farmer") farmers += co.size;
      else if (co.occupation === "woodcutter") woodcutters += co.size;
      else if (co.occupation === "merchant") merchants += co.size;
    }

    // Production calculation
    const grainProd = farmers * 1.5 * (1.0 + state.soilFertility[cellId] / 150);
    const timberProd = woodcutters * 1.2 * (1.0 + state.resources.timberStock[cellId] / 150);
    const metalProd = merchants * 0.8 * (1.0 + state.resources.oreGrade[cellId] / 150);

    production[sId] = {
      grain: grainProd,
      timber: timberProd,
      metal: metalProd,
    };

    // Consumption calculation
    consumption[sId] = {
      grain: s.population * 1.0,
      timber: s.population * 0.2,
      metal: s.population * 0.05,
    };

    surplus[sId] = {};
    deficit[sId] = {};

    for (const good of GOODS) {
      const diff = production[sId][good] - consumption[sId][good];
      if (diff > 0) {
        surplus[sId][good] = diff;
        deficit[sId][good] = 0;
      } else {
        surplus[sId][good] = 0;
        deficit[sId][good] = -diff;
      }
    }
    
    // Reset food access by default
    s.foodAccess = 1.0;
  }

  // Track route capacity usage across all commodities
  const usedCapacity: Record<string, number> = {};

  // 2. Perform min-cost trade allocation per good
  for (const good of GOODS) {
    const basePrice = BASE_PRICES[good];

    // Find all sellers and buyers
    const sellers = sIds.filter(id => surplus[id][good] > 0);
    const buyers = sIds.filter(id => deficit[id][good] > 0);

    if (sellers.length === 0 || buyers.length === 0) continue;

    // Build trade candidate pairs
    const pairs: { sellerId: string; buyerId: string; travelTime: number; routeId: string | null }[] = [];

    for (const sellerId of sellers) {
      const sCell = state.settlements[sellerId].cellId;
      for (const buyerId of buyers) {
        const bCell = state.settlements[buyerId].cellId;

        // Compute route distance
        let travelTime = Math.hypot(
          (sCell % width) - (bCell % width),
          Math.floor(sCell / width) - Math.floor(bCell / width)
        ) * 2.0;
        let routeId: string | null = null;

        // Check if there is a road connecting them
        for (const rId of Object.keys(state.routes)) {
          const route = state.routes[rId];
          const points = route.points;
          if (points.length > 0) {
            const pStart = points[0][1] * width + points[0][0];
            const pEnd = points[points.length - 1][1] * width + points[points.length - 1][0];
            if (
              (pStart === sCell && pEnd === bCell) ||
              (pStart === bCell && pEnd === sCell)
            ) {
              travelTime = route.travelTime;
              routeId = rId;
              break;
            }
          }
        }

        pairs.push({ sellerId, buyerId, travelTime, routeId });
      }
    }

    // Sort trade pairs by travel time (lowest cost first)
    pairs.sort((a, b) => a.travelTime - b.travelTime);

    // Allocate flows
    for (const pair of pairs) {
      const seller = state.settlements[pair.sellerId];
      const buyer = state.settlements[pair.buyerId];

      const sellAvail = surplus[pair.sellerId][good];
      const buyNeeded = deficit[pair.buyerId][good];

      if (sellAvail <= 0 || buyNeeded <= 0) continue;

      // Check route capacity constraint
      let routeLimit = Infinity;
      if (pair.routeId) {
        const route = state.routes[pair.routeId];
        if (route) {
          const currentUsage = usedCapacity[pair.routeId] || 0;
          routeLimit = Math.max(0, route.capacity - currentUsage);
        }
      }

      // Local price with distance markup
      const localPrice = basePrice * (1.0 + pair.travelTime * 0.05);

      // Enforce buyer wealth capacity (buyer cannot spend more than they have)
      const maxAffordableVolume = localPrice > 0 ? buyer.wealth / localPrice : Infinity;

      // Final volume is the min of all constraints
      const tradeVolume = Math.min(sellAvail, buyNeeded, maxAffordableVolume, routeLimit);
      if (tradeVolume <= 0) continue;

      // Apply transaction
      surplus[pair.sellerId][good] -= tradeVolume;
      deficit[pair.buyerId][good] -= tradeVolume;
      
      if (pair.routeId) {
        usedCapacity[pair.routeId] = (usedCapacity[pair.routeId] || 0) + tradeVolume;
      }

      // Exchange wealth using exact double-entry accounting
      const exportRevenueVal = tradeVolume * basePrice;
      const transportExpenseVal = tradeVolume * (localPrice - basePrice);
      const totalCost = tradeVolume * localPrice;

      seller.wealth += exportRevenueVal;
      buyer.wealth = Math.max(0, buyer.wealth - totalCost);

      // Record to transient reconciliation
      if (buyer.__transientReconciliation) {
        buyer.__transientReconciliation.importExpense += exportRevenueVal;
        buyer.__transientReconciliation.transportExpense += transportExpenseVal;
      }
      if (seller.__transientReconciliation) {
        seller.__transientReconciliation.exportRevenue += exportRevenueVal;
      }

      // Update trade statistics / records
      buyer.marketAccess = Math.min(1.0, buyer.marketAccess + 0.1);
      seller.marketAccess = Math.min(1.0, seller.marketAccess + 0.1);
    }
  }

  // 3. Post-trade check (famines / shortages)
  for (const sId of sIds) {
    const s = state.settlements[sId];
    const grainShortage = deficit[sId]["grain"];
    
    if (grainShortage > 0) {
      const required = consumption[sId]["grain"];
      const actual = required - grainShortage;
      s.foodAccess = required > 0 ? actual / required : 1.0;

      // Famine consequence
      if (s.foodAccess < 0.8) {
        const deaths = Math.floor(s.population * (1.0 - s.foodAccess) * 0.2);
        s.population = Math.max(10, s.population - deaths);

        ledger.addEvent({
          eventId: `famine_${sId}_${year}`,
          time: { year },
          eventType: "famine",
          location: { cellId: s.cellId, settlementId: sId },
          actorIds: [],
          affectedEntityIds: [sId],
          conditions: [
            {
              conditionId: `fam_cond_${sId}_${year}`,
              predicateType: "food_shortage",
              subjectIds: [sId],
              observed: [{ name: "foodAccess", value: s.foodAccess }],
              result: true,
              role: "necessary",
              sourceSystem: "economy",
              uncertainty: 0.05,
            },
          ],
          immediateEffects: [
            { entityId: sId, component: "settlements", field: "population", before: s.population + deaths, after: s.population },
          ],
          parentEventIds: [],
          resultingEventIds: [],
          ruleId: "starvation_consequence",
          summaryTemplate: "A severe food shortage in {settlementName} caused a famine, killing {deaths} citizens.",
          summaryArguments: { settlementName: s.name, deaths },
          confidence: 1.0,
        });
      }
    }
  }
}
