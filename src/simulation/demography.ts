import type { WorldState } from "../core/types";
import { CausalLedger } from "../timelines/ledger";
import { keyedRandom } from "../core/random";

export function updateDemography(state: WorldState, ledger: CausalLedger, year: number): void {
  const sIds = Object.keys(state.settlements).filter(id => !state.settlements[id].abandoned);
  if (sIds.length < 2) return;

  const width = state.mapWidth;
  
  // 1. Cohort Migration
  for (const originId of sIds) {
    const origin = state.settlements[originId];
    
    // Check if origin is crowded
    const pushFactor = origin.population / origin.carryingCapacity;
    if (pushFactor < 0.6) continue; // No migration pressure if underpopulated

    // Evaluate potential destinations
    const candidates: { destId: string; utility: number; travelTime: number }[] = [];
    
    for (const destId of sIds) {
      if (originId === destId) continue;
      const dest = state.settlements[destId];

      // Calculate travel time
      // Check if a direct route exists in transport graph, else estimate based on Euclidean distance * terrain cost
      let travelTime = Math.hypot(
        (origin.cellId % width) - (dest.cellId % width),
        Math.floor(origin.cellId / width) - Math.floor(dest.cellId / width)
      ) * 1.5; // Base off-road travel cost

      // Search if there is a route edge connecting them
      for (const rId of Object.keys(state.routes)) {
        const route = state.routes[rId];
        const points = route.points;
        if (points.length > 0) {
          const pStart = points[0][1] * width + points[0][0];
          const pEnd = points[points.length - 1][1] * width + points[points.length - 1][0];
          if (
            (pStart === origin.cellId && pEnd === dest.cellId) ||
            (pStart === dest.cellId && pEnd === origin.cellId)
          ) {
            travelTime = route.travelTime;
            break;
          }
        }
      }

      const accessibility = 1.0 / (travelTime + 2.0);
      const pullFactor = 1.0 - (dest.population / dest.carryingCapacity); // Prefer underpopulated towns
      const wealthAttraction = dest.wealth / Math.max(100, dest.population);

      const utility = pullFactor * wealthAttraction * accessibility;

      if (utility > 0) {
        candidates.push({ destId, utility, travelTime });
      }
    }

    if (candidates.length === 0) continue;

    // Pick best destination
    candidates.sort((a, b) => b.utility - a.utility);
    const best = candidates[0];

    // Determine migration volume based on pushFactor
    const roll = keyedRandom(state.seed, originId, "migration", year, "volume");
    const migrationVolume = Math.floor(origin.population * (pushFactor - 0.5) * 0.1 * roll);

    if (migrationVolume > 5 && migrationVolume < origin.population * 0.3) {
      const dest = state.settlements[best.destId];
      
      const beforeOriginPop = origin.population;
      const beforeDestPop = dest.population;

      origin.population -= migrationVolume;
      dest.population += migrationVolume;

      // Transfer cohorts proportionally
      const originCohorts = state.cohorts[originId] || [];
      const destCohorts = state.cohorts[best.destId] || [];

      for (const co of originCohorts) {
        const fraction = co.size / beforeOriginPop;
        const toMove = Math.min(co.size, Math.floor(migrationVolume * fraction));
        co.size -= toMove;

        // Add to destination
        let destCo = destCohorts.find(
          dc => dc.culture === co.culture && dc.occupation === co.occupation && dc.wealthBand === co.wealthBand
        );
        if (!destCo) {
          destCo = { culture: co.culture, occupation: co.occupation, wealthBand: co.wealthBand, size: 0 };
          destCohorts.push(destCo);
        }
        destCo.size += toMove;
      }

      // Record migration event to the ledger
      ledger.addEvent({
        eventId: `mig_${originId}_${best.destId}_${year}`,
        time: { year },
        eventType: "migration",
        location: { cellId: origin.cellId, settlementId: originId },
        actorIds: [originId],
        affectedEntityIds: [originId, best.destId],
        conditions: [
          {
            conditionId: `mig_cond_${originId}_${year}`,
            predicateType: "high_travel_accessibility",
            subjectIds: [originId, best.destId],
            observed: [{ name: "travelTime", value: best.travelTime }, { name: "volume", value: migrationVolume }],
            result: true,
            role: "contributing",
            sourceSystem: "demography",
            uncertainty: 0.1,
          },
        ],
        immediateEffects: [
          { entityId: originId, component: "settlements", field: "population", before: beforeOriginPop, after: origin.population },
          { entityId: best.destId, component: "settlements", field: "population", before: beforeDestPop, after: dest.population },
        ],
        parentEventIds: [],
        resultingEventIds: [],
        ruleId: "cohort_migration",
        summaryTemplate: "A cohort of {volume} citizens migrated from {originName} to {destName} due to crowded conditions.",
        summaryArguments: { volume: migrationVolume, originName: origin.name, destName: dest.name },
        confidence: 0.85,
      });
    }
  }

  // 2. Cultural & Language shifts
  for (const sId of sIds) {
    const s = state.settlements[sId];
    const cohorts = state.cohorts[sId] || [];
    if (cohorts.length < 2) continue;

    // Find dominant culture
    const cultureSizes: Record<string, number> = {};
    for (const co of cohorts) {
      cultureSizes[co.culture] = (cultureSizes[co.culture] || 0) + co.size;
    }

    let dominantCulture = "";
    let maxSize = 0;
    for (const cult of Object.keys(cultureSizes)) {
      if (cultureSizes[cult] > maxSize) {
        maxSize = cultureSizes[cult];
        dominantCulture = cult;
      }
    }

    // Prestige conversion: minor cultures convert to dominant culture slowly
    // conversion rate is higher if marketAccess is high
    const conversionRate = 0.005 + s.marketAccess * 0.01;
    
    for (const co of cohorts) {
      if (co.culture !== dominantCulture && co.size > 5) {
        const toConvert = Math.floor(co.size * conversionRate);
        if (toConvert > 0) {
          co.size -= toConvert;
          
          let domCo = cohorts.find(
            dc => dc.culture === dominantCulture && dc.occupation === co.occupation && dc.wealthBand === co.wealthBand
          );
          if (!domCo) {
            domCo = { culture: dominantCulture, occupation: co.occupation, wealthBand: co.wealthBand, size: 0 };
            cohorts.push(domCo);
          }
          domCo.size += toConvert;
        }
      }
    }
  }
}
