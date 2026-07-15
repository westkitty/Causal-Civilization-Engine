import type { WorldState, RouteEdge, Bridge } from "../core/types";
import { CausalLedger, diffEntity } from "../timelines/ledger";
import type { Branch } from "../timelines/branch";

function isRiverCell(state: WorldState, idx: number): boolean {
  return state.flowAccumulation[idx] > 500;
}

export function findShortestPath(
  state: WorldState,
  startCell: number,
  endCell: number,
  checkBridges: boolean = true
): number[] {
  const width = state.mapWidth;
  const height = state.mapHeight;

  const getX = (idx: number) => idx % width;
  const getY = (idx: number) => Math.floor(idx / width);

  const openSet = new Set<number>([startCell]);
  const cameFrom = new Map<number, number>();

  const gScore = new Map<number, number>();
  gScore.set(startCell, 0);

  const fScore = new Map<number, number>();
  const dist = (a: number, b: number) => Math.hypot(getX(a) - getX(b), getY(a) - getY(b));
  fScore.set(startCell, dist(startCell, endCell));

  while (openSet.size > 0) {
    let current = -1;
    let minF = Infinity;
    for (const node of openSet) {
      const f = fScore.get(node) ?? Infinity;
      if (f < minF) {
        minF = f;
        current = node;
      }
    }

    if (current === endCell) {
      const path = [current];
      while (cameFrom.has(current)) {
        current = cameFrom.get(current)!;
        path.push(current);
      }
      return path.reverse();
    }

    openSet.delete(current);
    const cx = getX(current);
    const cy = getY(current);

    const neighbors: number[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          neighbors.push(ny * width + nx);
        }
      }
    }

    for (const neighbor of neighbors) {
      const elev = state.elevation[neighbor];
      if (state.biomes[neighbor] === "ocean") continue;

      let stepCost = Math.hypot(cx - getX(neighbor), cy - getY(neighbor));

      const slope = Math.abs(elev - state.elevation[current]);
      stepCost += (slope / 100) * 5.0;

      const biome = state.biomes[neighbor];
      if (biome === "mountain") stepCost += 10.0;
      if (biome === "wetland") stepCost += 6.0;
      if (biome === "forest") stepCost += 2.0;

      const currRiver = isRiverCell(state, current);
      const neighRiver = isRiverCell(state, neighbor);

      if (currRiver || neighRiver) {
        let hasBridge = false;
        if (checkBridges) {
          for (const bId of Object.keys(state.bridges)) {
            const bridge = state.bridges[bId];
            if (bridge.status === "active" && (bridge.cellId === current || bridge.cellId === neighbor)) {
              hasBridge = true;
              break;
            }
          }
        }
        if (!hasBridge) {
          stepCost += 40.0; // River crossing penalty without a bridge
        }
      }

      const tentativeG = (gScore.get(current) ?? 0) + stepCost;
      if (tentativeG < (gScore.get(neighbor) ?? Infinity)) {
        cameFrom.set(neighbor, current);
        gScore.set(neighbor, tentativeG);
        fScore.set(neighbor, tentativeG + dist(neighbor, endCell));
        openSet.add(neighbor);
      }
    }
  }

  return [];
}

export function updateTransport(state: WorldState, ledger: CausalLedger, branch: Branch, year: number): void {
  const width = state.mapWidth;
  const sIds = Object.keys(state.settlements).filter(id => !state.settlements[id].abandoned);
  if (sIds.length < 2) return;

  // Plan and build routes every 10 years
  if (year > 0 && year % 10 === 0) {
    for (let i = 0; i < sIds.length; i++) {
      for (let j = i + 1; j < sIds.length; j++) {
        const s1 = state.settlements[sIds[i]];
        const s2 = state.settlements[sIds[j]];
        
        const dist = Math.hypot(
          (s1.cellId % width) - (s2.cellId % width),
          Math.floor(s1.cellId / width) - Math.floor(s2.cellId / width)
        );
        if (dist > 35) continue; // Only build roads for relatively nearby settlements

        const rId = `route_${s1.id}_to_${s2.id}`;
        if (state.routes[rId]) continue; // Road already exists

        // Calculate path
        const path = findShortestPath(state, s1.cellId, s2.cellId, true);
        if (path.length === 0) continue;

        // Determine if path crosses the river
        let riverCrossingCell = -1;
        for (let p = 0; p < path.length; p++) {
          if (isRiverCell(state, path[p])) {
            riverCrossingCell = path[p];
            break;
          }
        }

        // Bridge evaluation
        let bridgeBuilt = false;
        let bId = "";
        let isSuppressed = false;
        
        if (riverCrossingCell !== -1) {
          bId = `bridge_${riverCrossingCell}`;
          isSuppressed = state.seed === "suppressed" || !!(
            branch.intervention &&
            year >= branch.intervention.insertionYear &&
            branch.intervention.operation === "suppress_event" &&
            (branch.intervention.targetIds.includes(bId) ||
             branch.intervention.targetIds.includes("bridge_crossing") ||
             branch.intervention.targetIds.includes("bridge_construction"))
          );
          
          // Check if a bridge already exists at this cell
          const existingBridge = state.bridges[bId];
          if (existingBridge && existingBridge.status === "active") {
            bridgeBuilt = true;
          } else {
            // Check if there is enough demand and treasury.
            // Demand is proportional to populations of connected towns
            const demand = (s1.population + s2.population) * 5;
            const threshold = 1800; // demand threshold for building a bridge
            const hasWealth = s1.wealth + s2.wealth > 1200;
            
            if (demand > threshold && hasWealth && !isSuppressed) {
              // Build bridge!
              const bridge: Bridge = {
                id: bId,
                routeEdgeId: rId,
                cellId: riverCrossingCell,
                span: 12,
                constructionYear: year,
                status: "active",
              };
              
              state.bridges[bId] = bridge;
              bridgeBuilt = true;

              // Deduct wealth
              const before1 = s1.wealth;
              const before2 = s2.wealth;
              s1.wealth = Math.max(100, s1.wealth - 400);
              s2.wealth = Math.max(100, s2.wealth - 400);
              if (s1.__transientReconciliation) {
                s1.__transientReconciliation.investment += (before1 - s1.wealth);
              }
              if (s2.__transientReconciliation) {
                s2.__transientReconciliation.investment += (before2 - s2.wealth);
              }

              const bridgeEventId = `build_bridge_${bId}_${year}`;
              ledger.addEvent({
                eventId: bridgeEventId,
                time: { year },
                eventType: "bridge_construction",
                location: { cellId: riverCrossingCell, routeEdgeId: rId },
                actorIds: [s1.id, s2.id],
                affectedEntityIds: [bId, s1.id, s2.id],
                conditions: [
                  {
                    conditionId: `bridge_dem_${bId}_${year}`,
                    predicateType: "crossing_demand_exceeded",
                    subjectIds: [s1.id, s2.id],
                    observed: [{ name: "demand", value: demand, threshold }],
                    result: true,
                    role: "necessary",
                    sourceSystem: "transport",
                    uncertainty: 0.05,
                  },
                ],
                immediateEffects: diffEntity(bId, "bridges", null, bridge),
                parentEventIds: [],
                resultingEventIds: [],
                ruleId: "crossing_improvement",
                summaryTemplate: "A stone bridge was built at river crossing cell {cellId} to connect {s1Name} and {s2Name}.",
                summaryArguments: { cellId: riverCrossingCell, s1Name: s1.name, s2Name: s2.name },
                confidence: 1.0,
              });

              if (s1.wealth !== before1) {
                ledger.addEvent({
                  eventId: `wealth_change_${s1.id}_invest_${year}`,
                  time: { year },
                  eventType: "settlement_wealth_changed",
                  location: { cellId: s1.cellId, settlementId: s1.id },
                  actorIds: [s1.id],
                  affectedEntityIds: [s1.id],
                  conditions: [],
                  immediateEffects: [
                    { entityId: s1.id, component: "settlements", field: "wealth", before: before1, after: s1.wealth }
                  ],
                  parentEventIds: [bridgeEventId],
                  resultingEventIds: [],
                  ruleId: "bridge_investment",
                  summaryTemplate: "Wealth of {name} decreased by {delta} due to bridge investment.",
                  summaryArguments: { name: s1.name, delta: (before1 - s1.wealth).toFixed(0) },
                  confidence: 1.0,
                });
              }

              if (s2.wealth !== before2) {
                ledger.addEvent({
                  eventId: `wealth_change_${s2.id}_invest_${year}`,
                  time: { year },
                  eventType: "settlement_wealth_changed",
                  location: { cellId: s2.cellId, settlementId: s2.id },
                  actorIds: [s2.id],
                  affectedEntityIds: [s2.id],
                  conditions: [],
                  immediateEffects: [
                    { entityId: s2.id, component: "settlements", field: "wealth", before: before2, after: s2.wealth }
                  ],
                  parentEventIds: [bridgeEventId],
                  resultingEventIds: [],
                  ruleId: "bridge_investment",
                  summaryTemplate: "Wealth of {name} decreased by {delta} due to bridge investment.",
                  summaryArguments: { name: s2.name, delta: (before2 - s2.wealth).toFixed(0) },
                  confidence: 1.0,
                });
              }
            }
          }
        }

        // Build the road route
        // If river crosses and no bridge, travelTime is high. If bridge exists, travelTime is low.
        const length = path.length;
        const travelTime = length * (riverCrossingCell !== -1 && !bridgeBuilt ? 3.0 : 1.0);
        
        const route: RouteEdge = {
          id: rId,
          type: "road",
          length,
          travelTime,
          capacity: 100,
          condition: 1.0,
          constructionYear: year,
          points: path.map(idx => [idx % width, Math.floor(idx / width)]),
        };

        state.routes[rId] = route;

        ledger.addEvent({
          eventId: `build_road_${rId}_${year}`,
          time: { year },
          eventType: "road_construction",
          location: { settlementId: s1.id },
          actorIds: [s1.id, s2.id],
          affectedEntityIds: [rId],
          conditions: [],
          immediateEffects: diffEntity(rId, "routes", null, route),
          parentEventIds: riverCrossingCell !== -1
            ? (bridgeBuilt
                ? [`build_bridge_${bId}_${year}`]
                : (isSuppressed
                    ? [branch.intervention?.interventionId || ""].filter(Boolean)
                    : []
                  )
              )
            : [],
          resultingEventIds: [],
          ruleId: "road_expansion",
          summaryTemplate: "A new road route was cleared connecting {s1Name} and {s2Name}.",
          summaryArguments: { s1Name: s1.name, s2Name: s2.name },
          confidence: 1.0,
        });
      }
    }
  }
}
