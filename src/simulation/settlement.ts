import type { WorldState, Settlement } from "../core/types";
import { CausalLedger, diffEntity } from "../timelines/ledger";
import { keyedRandom } from "../core/random";

const SUITABLE_NAMES_COAST = ["Oakhaven", "Seawall", "Bayview", "Sandpoint", "Portus", "Southport", "Deepwater", "Anchorbay"];
const SUITABLE_NAMES_RIVER = ["Riverbend", "Fordsmouth", "Bridgeway", "Flowingwell", "Stoneturn", "Greenvalley", "Waterford", "Broadriver"];
const SUITABLE_NAMES_MOUNTAIN = ["Silvermine", "Highcrag", "Ironpeak", "Stonebarrow", "Skyreach", "Coldwind", "Orebrow", "Timberridge"];
const SUITABLE_NAMES_GENERIC = ["Fairview", "Meadowfield", "Broadwell", "Newlands", "Westward", "Claywell", "Crossroads", "Suntop"];

export function getSiteSuitability(state: WorldState, cellId: number): number {
  const elev = state.elevation[cellId];
  if (elev < 30) return 0; // In ocean
  if (elev > 750) return 10; // Too high mountain top

  const width = state.mapWidth;
  const x = cellId % width;
  const y = Math.floor(cellId / width);

  // Avoid placing too close to other settlements
  for (const sId of Object.keys(state.settlements)) {
    const s = state.settlements[sId];
    if (s.abandoned) continue;
    const sx = s.cellId % width;
    const sy = Math.floor(s.cellId / width);
    const dist = Math.hypot(x - sx, y - sy);
    if (dist < 8) return 0; // Too close
  }

  const flow = state.flowAccumulation[cellId];
  const fertility = state.soilFertility[cellId];
  const biome = state.biomes[cellId];

  let score = 0;
  
  // Water accessibility (high flow or coast)
  if (flow > 200) score += 30;
  if (x > width * 0.8) score += 25; // Close to coast
  
  // Agriculture suitability
  score += fertility * 0.6;
  
  // Resource suitability
  if (state.resources.oreGrade[cellId] > 30) score += 20;
  if (state.resources.timberStock[cellId] > 30) score += 15;

  // Biome multipliers
  if (biome === "desert") score -= 20;
  if (biome === "mountain") score -= 10;
  if (biome === "wetland") score += 5; // Marsh/wetland has food/water access but disease

  return Math.max(0, score);
}

function getDeterministicName(state: WorldState, cellId: number, index: number): string {
  const elev = state.elevation[cellId];
  const flow = state.flowAccumulation[cellId];
  const x = cellId % state.mapWidth;
  
  let list = SUITABLE_NAMES_GENERIC;
  if (x > state.mapWidth * 0.8) list = SUITABLE_NAMES_COAST;
  else if (flow > 500) list = SUITABLE_NAMES_RIVER;
  else if (elev > 500) list = SUITABLE_NAMES_MOUNTAIN;

  const nameIdx = (murmurHash3(`name_${cellId}_${index}`) >>> 0) % list.length;
  return `${list[nameIdx]} ${index}`;
}

import { murmurHash3 } from "../core/random";

export function updateSettlement(state: WorldState, ledger: CausalLedger, year: number): void {
  const width = state.mapWidth;
  const height = state.mapHeight;

  // Initialize first settlements at Year 0
  if (year === 0 && Object.keys(state.settlements).length === 0) {
    const predefinedCells = [
      40 * width + 45,  // North
      60 * width + 45,  // South
      62 * width + 90,  // Coast
    ];

    let index = 1;
    for (const cellId of predefinedCells) {
      const sId = `settlement_${cellId}`;
      const name = getDeterministicName(state, cellId, index++);
      const initialPop = 220 + (murmurHash3(`pop_${cellId}`) % 50);

      const s: Settlement = {
        id: sId,
        name,
        cellId,
        population: initialPop,
        carryingCapacity: 500 + Math.floor(state.soilFertility[cellId] * 5),
        foodAccess: 1.0,
        waterSecurity: 1.0,
        marketAccess: 0.5,
        diseaseBurden: 0.1,
        wealth: 1000,
        establishedYear: 0,
        abandoned: false,
      };

      state.settlements[sId] = s;

      // Initialize basic cohorts
      state.cohorts[sId] = [
        { culture: "indigenous", occupation: "farmer", wealthBand: "poor", size: Math.floor(initialPop * 0.7) },
        { culture: "indigenous", occupation: "woodcutter", wealthBand: "middle", size: Math.floor(initialPop * 0.2) },
        { culture: "indigenous", occupation: "merchant", wealthBand: "rich", size: Math.floor(initialPop * 0.1) },
      ];

      ledger.addEvent({
        eventId: `found_${sId}_0`,
        time: { year: 0 },
        eventType: "founding",
        location: { cellId, settlementId: sId },
        actorIds: [],
        affectedEntityIds: [sId],
        conditions: [
          {
            conditionId: `found_suit_${sId}`,
            predicateType: "highly_suitable_site",
            subjectIds: [sId],
            observed: [{ name: "suitability", value: getSiteSuitability(state, cellId) }],
            result: true,
            role: "necessary",
            sourceSystem: "settlement",
            uncertainty: 0.05,
          },
        ],
        immediateEffects: diffEntity(sId, "settlements", null, s),
        parentEventIds: [],
        resultingEventIds: [],
        ruleId: "initial_spawning",
        summaryTemplate: "{settlementName} was founded at a fertile site near water sources in Year 0.",
        summaryArguments: { settlementName: name },
        confidence: 1.0,
      });
    }
    return;
  }

  // Found new settlements over time from population pressure
  // Check every 15 years
  if (year % 15 === 0 && Object.keys(state.settlements).length < 45) {
    // Find settlements that are over 85% capacity
    const crowded = Object.values(state.settlements).filter(
      s => !s.abandoned && s.population > s.carryingCapacity * 0.85
    );

    if (crowded.length > 0) {
      // Pick one crowded settlement to spin off founders
      const source = crowded[Math.floor(keyedRandom(state.seed, "settlement_founding", "pick_source", year, "select") * crowded.length)];
      
      // Find the most suitable cell within reasonable travel distance (e.g. 30 cells)
      const sx = source.cellId % width;
      const sy = Math.floor(source.cellId / width);
      
      let bestCell = -1;
      let bestScore = 0;
      
      for (let y = Math.max(0, sy - 30); y < Math.min(height, sy + 30); y++) {
        for (let x = Math.max(0, sx - 30); x < Math.min(width, sx + 30); x++) {
          const c = y * width + x;
          const score = getSiteSuitability(state, c);
          if (score > bestScore) {
            bestScore = score;
            bestCell = c;
          }
        }
      }

      if (bestCell !== -1 && bestScore > 25) {
        const sId = `settlement_${bestCell}`;
        const index = Object.keys(state.settlements).length + 1;
        const name = getDeterministicName(state, bestCell, index);
        
        const initialPop = 80;
        
        // Subtract from source population
        const sourceBefore = source.population;
        source.population = Math.max(20, source.population - initialPop);
        
        // Create new settlement
        const s: Settlement = {
          id: sId,
          name,
          cellId: bestCell,
          population: initialPop,
          carryingCapacity: 300 + Math.floor(state.soilFertility[bestCell] * 4),
          foodAccess: 1.0,
          waterSecurity: 1.0,
          marketAccess: 0.2,
          diseaseBurden: 0.1,
          wealth: 500,
          establishedYear: year,
          abandoned: false,
        };
        
        state.settlements[sId] = s;
        
        // Distribute cohorts
        const culture = state.cohorts[source.id]?.[0]?.culture || "indigenous";
        state.cohorts[sId] = [
          { culture, occupation: "farmer", wealthBand: "poor", size: Math.floor(initialPop * 0.8) },
          { culture, occupation: "woodcutter", wealthBand: "middle", size: Math.floor(initialPop * 0.2) },
        ];

        // Update source cohorts sizes
        const srcCohorts = state.cohorts[source.id] || [];
        for (const co of srcCohorts) {
          co.size = Math.floor(co.size * (source.population / sourceBefore));
        }

        ledger.addEvent({
          eventId: `found_${sId}_${year}`,
          time: { year },
          eventType: "founding",
          location: { cellId: bestCell, settlementId: sId },
          actorIds: [source.id],
          affectedEntityIds: [sId, source.id],
          conditions: [
            {
              conditionId: `found_press_${sId}_${year}`,
              predicateType: "population_pressure",
              subjectIds: [source.id],
              observed: [{ name: "sourcePopulation", value: sourceBefore }, { name: "capacity", value: source.carryingCapacity }],
              result: true,
              role: "necessary",
              sourceSystem: "settlement",
              uncertainty: 0.1,
            },
          ],
          immediateEffects: [
            ...diffEntity(sId, "settlements", null, s),
            { entityId: source.id, component: "settlements", field: "population", before: sourceBefore, after: source.population }
          ],
          parentEventIds: [`found_${source.id}_${source.establishedYear}`],
          resultingEventIds: [],
          ruleId: "population_spinoff",
          summaryTemplate: "Due to population pressure in {sourceName}, settlers migrated and founded {settlementName} at a new site in Year {year}.",
          summaryArguments: { sourceName: source.name, settlementName: name, year },
          confidence: 0.95,
        });
      }
    }
  }

  // Yearly growth, decay, and abandonment checks
  for (const sId of Object.keys(state.settlements)) {
    const s = state.settlements[sId];
    if (s.abandoned) continue;

    const beforePop = s.population;

    // Carrying capacity feedback
    // If pop is below carrying capacity, it grows. If above, it declines.
    const cap = s.carryingCapacity;
    const diseaseFactor = s.diseaseBurden * 0.05;
    
    // Natural growth rate
    const growthFactor = (1 - s.population / cap);
    const rate = 0.025 * growthFactor - diseaseFactor;
    
    // Wealth effects
    const wealthRate = s.marketAccess * 0.05 - 0.02; // wealth grows with trade access
    
    s.population = Math.max(0, Math.floor(s.population * (1 + rate)));
    const beforeWealth = s.wealth;
    s.wealth = Math.max(0, Math.floor(s.wealth * (1 + wealthRate)));
    if (s.__transientReconciliation) {
      s.__transientReconciliation.naturalGrowth += (s.wealth - beforeWealth);
    }
    if (s.wealth !== beforeWealth) {
      const delta = s.wealth - beforeWealth;
      ledger.addEvent({
        eventId: `wealth_change_${s.id}_growth_${year}`,
        time: { year },
        eventType: "settlement_wealth_changed",
        location: { cellId: s.cellId, settlementId: s.id },
        actorIds: [s.id],
        affectedEntityIds: [s.id],
        conditions: [],
        immediateEffects: [
          { entityId: s.id, component: "settlements", field: "wealth", before: beforeWealth, after: s.wealth }
        ],
        parentEventIds: [], // natural growth has no specific single parent event
        resultingEventIds: [],
        ruleId: "natural_growth_wealth",
        summaryTemplate: "Wealth of {name} changed by {delta} due to local natural growth.",
        summaryArguments: { name: s.name, delta: delta.toFixed(0) },
        confidence: 1.0,
      });
    }

    // Apply cohort changes proportionally
    const cohorts = state.cohorts[sId] || [];
    let cohortSum = 0;
    for (const c of cohorts) {
      c.size = Math.max(0, Math.floor(c.size * (s.population / beforePop)));
      cohortSum += c.size;
    }
    // Correct minor rounding mismatches
    if (cohorts.length > 0 && cohortSum !== s.population) {
      cohorts[0].size += (s.population - cohortSum);
    }

    // Abandonment check
    if (s.population < 20) {
      s.abandoned = true;
      s.abandonedYear = year;
      s.population = 0;
      state.cohorts[sId] = [];

      ledger.addEvent({
        eventId: `abandon_${sId}_${year}`,
        time: { year },
        eventType: "abandonment",
        location: { cellId: s.cellId, settlementId: sId },
        actorIds: [],
        affectedEntityIds: [sId],
        conditions: [
          {
            conditionId: `abandon_pop_${sId}_${year}`,
            predicateType: "population_collapse",
            subjectIds: [sId],
            observed: [{ name: "population", value: beforePop }],
            result: true,
            role: "necessary",
            sourceSystem: "settlement",
            uncertainty: 0.01,
          },
        ],
        immediateEffects: [
          { entityId: sId, component: "settlements", field: "abandoned", before: false, after: true },
          { entityId: sId, component: "settlements", field: "population", before: beforePop, after: 0 },
        ],
        parentEventIds: [],
        resultingEventIds: [],
        ruleId: "population_depletion",
        summaryTemplate: "{settlementName} fell below minimum viable population and was abandoned in Year {year}.",
        summaryArguments: { settlementName: s.name, year },
        confidence: 1.0,
      });
    }
  }
}
