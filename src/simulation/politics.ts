import type { WorldState, Government } from "../core/types";
import { CausalLedger, diffEntity } from "../timelines/ledger";

export function updatePolitics(state: WorldState, ledger: CausalLedger, year: number): void {
  const width = state.mapWidth;
  const height = state.mapHeight;
  const size = width * height;
  const sIds = Object.keys(state.settlements).filter(id => !state.settlements[id].abandoned);

  // Initialize governments at Year 0
  if (year === 0 && Object.keys(state.governments).length === 0 && sIds.length >= 2) {
    // Government A: centered at the first settlement
    const s1 = state.settlements[sIds[0]];
    const govA: Government = {
      id: "gov_a",
      name: "Kingdom of the Valleys",
      capitalId: s1.id,
      treasury: 5000,
      legitimacy: 0.8,
      taxRate: 0.05,
    };
    state.governments["gov_a"] = govA;

    // Government B: centered at the second settlement
    const s2 = state.settlements[sIds[1]];
    const govB: Government = {
      id: "gov_b",
      name: "Coastal Republic",
      capitalId: s2.id,
      treasury: 3000,
      legitimacy: 0.7,
      taxRate: 0.04,
    };
    state.governments["gov_b"] = govB;

    ledger.addEvent({
      eventId: "est_gov_a_0",
      time: { year: 0 },
      eventType: "political_founding",
      location: { cellId: s1.cellId, settlementId: s1.id },
      actorIds: [],
      affectedEntityIds: ["gov_a"],
      conditions: [],
      immediateEffects: diffEntity("gov_a", "governments", null, govA),
      parentEventIds: [],
      resultingEventIds: [],
      ruleId: "government_creation",
      summaryTemplate: "{govName} was established with its capital at {capitalName} in Year 0.",
      summaryArguments: { govName: govA.name, capitalName: s1.name },
      confidence: 1.0,
    });

    ledger.addEvent({
      eventId: "est_gov_b_0",
      time: { year: 0 },
      eventType: "political_founding",
      location: { cellId: s2.cellId, settlementId: s2.id },
      actorIds: [],
      affectedEntityIds: ["gov_b"],
      conditions: [],
      immediateEffects: diffEntity("gov_b", "governments", null, govB),
      parentEventIds: [],
      resultingEventIds: [],
      ruleId: "government_creation",
      summaryTemplate: "{govName} was established with its capital at {capitalName} in Year 0.",
      summaryArguments: { govName: govB.name, capitalName: s2.name },
      confidence: 1.0,
    });
  }

  // 1. Control Field Propagation
  // Clear old control grids
  for (const govId of Object.keys(state.governments)) {
    state.politicalControl[govId] = new Array(size).fill(0);
  }

  for (const govId of Object.keys(state.governments)) {
    const gov = state.governments[govId];
    const capital = state.settlements[gov.capitalId];
    if (!capital || capital.abandoned) continue;

    // Run Dijkstra-like expansion on the grid up to limit
    const power = state.politicalControl[govId];
    const capitalCell = capital.cellId;
    power[capitalCell] = 100; // Power at capital

    const openSet: number[] = [capitalCell];
    const visited = new Set<number>([capitalCell]);

    while (openSet.length > 0) {
      // pop highest power node
      let maxP = -1;
      let currIdx = -1;
      let maxNode = -1;
      for (let i = 0; i < openSet.length; i++) {
        const node = openSet[i];
        if (power[node] > maxP) {
          maxP = power[node];
          maxNode = node;
          currIdx = i;
        }
      }

      if (maxNode === -1) break;
      openSet.splice(currIdx, 1);

      const cx = maxNode % width;
      const cy = Math.floor(maxNode / width);
      const currPower = power[maxNode];

      // Stop if power is too low
      if (currPower < 10) continue;

      // Expand to neighbors
      const neighbors: number[] = [];
      for (const [dx, dy] of [[1,0], [-1,0], [0,1], [0,-1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          neighbors.push(ny * width + nx);
        }
      }

      for (const neighbor of neighbors) {
        if (state.biomes[neighbor] === "ocean") continue;

        // Cost of propagation
        let stepCost = 2.0; // base cost

        // Check if there is a road between current and neighbor
        let hasRoad = false;
        for (const rId of Object.keys(state.routes)) {
          const route = state.routes[rId];
          const points = route.points;
          // check if current and neighbor are adjacent points in route
          for (let p = 0; p < points.length - 1; p++) {
            const p1 = points[p][1] * width + points[p][0];
            const p2 = points[p+1][1] * width + points[p+1][0];
            if (
              (p1 === maxNode && p2 === neighbor) ||
              (p1 === neighbor && p2 === maxNode)
            ) {
              hasRoad = true;
              break;
            }
          }
        }

        if (hasRoad) {
          stepCost = 0.5; // Road makes reach easy!
        } else {
          // Add terrain and river crossing cost
          const slope = Math.abs(state.elevation[neighbor] - state.elevation[maxNode]);
          stepCost += (slope / 100) * 8.0;

          // River crossing check (without a bridge)
          const isCurrRiver = state.flowAccumulation[maxNode] > 500;
          const isNeighRiver = state.flowAccumulation[neighbor] > 500;

          if (isCurrRiver || isNeighRiver) {
            let hasBridge = false;
            for (const bId of Object.keys(state.bridges)) {
              const bridge = state.bridges[bId];
              if (bridge.status === "active" && (bridge.cellId === maxNode || bridge.cellId === neighbor)) {
                hasBridge = true;
                break;
              }
            }
            if (!hasBridge) {
              stepCost += 35.0; // High barrier without bridge
            }
          }
        }

        const nextPower = currPower - stepCost;
        if (nextPower > power[neighbor]) {
          power[neighbor] = nextPower;
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            openSet.push(neighbor);
          }
        }
      }
    }
  }

  // 2. Taxation & Governance checks
  if (year > 0 && year % 5 === 0) {
    for (const govId of Object.keys(state.governments)) {
      const gov = state.governments[govId];
      const power = state.politicalControl[govId];

      let taxCollected = 0;
      const taxedSettlements: string[] = [];

      for (const sId of sIds) {
        const s = state.settlements[sId];
        // If settlement lies in this government's control zone (power > 15)
        if (power[s.cellId] > 15) {
          // If multiple governments control it, it pays to the strongest
          let strongest = true;
          for (const otherGovId of Object.keys(state.governments)) {
            if (otherGovId !== govId && (state.politicalControl[otherGovId][s.cellId] > power[s.cellId])) {
              strongest = false;
              break;
            }
          }

          if (strongest) {
            const beforeWealth = s.wealth;
            const tax = Math.floor(s.wealth * gov.taxRate);
            s.wealth = Math.max(100, s.wealth - tax);
            if (s.__transientReconciliation) {
              s.__transientReconciliation.taxesPaid += (beforeWealth - s.wealth);
            }
            taxCollected += tax;
            taxedSettlements.push(s.name);
          }
        }
      }

      if (taxCollected > 0) {
        gov.treasury += taxCollected;

        ledger.addEvent({
          eventId: `tax_${govId}_${year}`,
          time: { year },
          eventType: "taxation",
          location: {},
          actorIds: [govId],
          affectedEntityIds: [govId],
          conditions: [],
          immediateEffects: [
            { entityId: govId, component: "governments", field: "treasury", before: gov.treasury - taxCollected, after: gov.treasury }
          ],
          parentEventIds: [],
          resultingEventIds: [],
          ruleId: "annual_taxation",
          summaryTemplate: "{govName} collected {taxCollected} in taxes from settlements under its administrative control.",
          summaryArguments: { govName: gov.name, taxCollected },
          confidence: 1.0,
        });
      }
    }
  }

  // 3. Capital relocation check
  for (const govId of Object.keys(state.governments)) {
    const gov = state.governments[govId];
    const capital = state.settlements[gov.capitalId];

    if (!capital || capital.abandoned) {
      // Find a replacement capital: the largest active settlement in our control zone
      const power = state.politicalControl[govId];
      let bestSId = "";
      let maxPop = 0;

      for (const sId of sIds) {
        const s = state.settlements[sId];
        if (power[s.cellId] > 20 && s.population > maxPop) {
          maxPop = s.population;
          bestSId = sId;
        }
      }

      if (bestSId && bestSId !== gov.capitalId) {
        const oldCapId = gov.capitalId;
        const newCap = state.settlements[bestSId];
        gov.capitalId = bestSId;

        ledger.addEvent({
          eventId: `cap_reloc_${govId}_${year}`,
          time: { year },
          eventType: "capital_relocation",
          location: { cellId: newCap.cellId, settlementId: bestSId },
          actorIds: [govId],
          affectedEntityIds: [govId],
          conditions: [
            {
              conditionId: `cap_reloc_cond_${govId}_${year}`,
              predicateType: "capital_abandoned_or_ruined",
              subjectIds: [oldCapId],
              observed: [],
              result: true,
              role: "necessary",
              sourceSystem: "politics",
              uncertainty: 0.0,
            },
          ],
          immediateEffects: [
            { entityId: govId, component: "governments", field: "capitalId", before: oldCapId, after: bestSId }
          ],
          parentEventIds: [],
          resultingEventIds: [],
          ruleId: "capital_succession",
          summaryTemplate: "With the collapse of its former capital, {govName} moved its administration to {newCapitalName}.",
          summaryArguments: { govName: gov.name, newCapitalName: newCap.name },
          confidence: 1.0,
        });
      }
    }
  }
}
