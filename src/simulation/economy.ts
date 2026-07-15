import type { WorldState, ResolvedTransportPath } from "../core/types";
import { CausalLedger } from "../timelines/ledger";
import { findShortestPath } from "./transport";

function isRiverCell(state: WorldState, idx: number): boolean {
  return state.flowAccumulation[idx] > 500;
}

export function resolveTransportPath(
  state: WorldState,
  sellerId: string,
  buyerId: string
): ResolvedTransportPath | null {
  const width = state.mapWidth;
  const seller = state.settlements[sellerId];
  const buyer = state.settlements[buyerId];
  if (!seller || !buyer) return null;

  // 1. Try to find path on road network
  // Build adjacency list for settlements connected by routes
  const cellToSetId: Record<number, string> = {};
  for (const sId of Object.keys(state.settlements)) {
    cellToSetId[state.settlements[sId].cellId] = sId;
  }

  interface Edge {
    toId: string;
    routeId: string;
    travelTime: number;
    capacity: number;
  }
  const adj: Record<string, Edge[]> = {};
  for (const sId of Object.keys(state.settlements)) {
    adj[sId] = [];
  }

  for (const rId of Object.keys(state.routes)) {
    const route = state.routes[rId];
    if (route.points.length === 0) continue;
    const pStart = route.points[0][1] * width + route.points[0][0];
    const pEnd = route.points[route.points.length - 1][1] * width + route.points[route.points.length - 1][0];
    const sStart = cellToSetId[pStart];
    const sEnd = cellToSetId[pEnd];
    if (sStart && sEnd) {
      adj[sStart].push({ toId: sEnd, routeId: rId, travelTime: route.travelTime, capacity: route.capacity });
      adj[sEnd].push({ toId: sStart, routeId: rId, travelTime: route.travelTime, capacity: route.capacity });
    }
  }

  // Dijkstra on settlement graph
  const dist: Record<string, number> = {};
  const prev: Record<string, { routeId: string; fromId: string }> = {};
  const pq: string[] = [sellerId];
  dist[sellerId] = 0;

  for (const sId of Object.keys(state.settlements)) {
    if (sId !== sellerId) dist[sId] = Infinity;
  }

  while (pq.length > 0) {
    pq.sort((a, b) => dist[a] - dist[b]);
    const u = pq.shift()!;
    if (u === buyerId) break;
    if (dist[u] === Infinity) break;

    for (const edge of adj[u]) {
      // Dynamic travel time check in Dijkstra: if route crosses an inactive bridge, travelTime increases
      let effectiveTravelTime = edge.travelTime;
      const bridge = Object.values(state.bridges).find(b => b.routeEdgeId === edge.routeId);
      if (bridge && bridge.status !== "active") {
        const route = state.routes[edge.routeId];
        effectiveTravelTime = (route?.length || 1) * 3.0;
      }

      const alt = dist[u] + effectiveTravelTime;
      if (alt < dist[edge.toId]) {
        dist[edge.toId] = alt;
        prev[edge.toId] = { routeId: edge.routeId, fromId: u };
        if (!pq.includes(edge.toId)) {
          pq.push(edge.toId);
        }
      }
    }
  }

  if (dist[buyerId] !== Infinity) {
    // Reconstruct path
    const edgeIds: string[] = [];
    let curr = buyerId;
    let minCapacity = Infinity;
    let totalTravelTime = 0;
    while (curr !== sellerId) {
      const step = prev[curr];
      edgeIds.push(step.routeId);
      const route = state.routes[step.routeId];
      if (route) {
        minCapacity = Math.min(minCapacity, route.capacity);
        
        let effectiveTravelTime = route.travelTime;
        const bridge = Object.values(state.bridges).find(b => b.routeEdgeId === step.routeId);
        if (bridge && bridge.status !== "active") {
          effectiveTravelTime = route.length * 3.0;
        }
        totalTravelTime += effectiveTravelTime;
      }
      curr = step.fromId;
    }
    edgeIds.reverse();

    // Crossing assets (bridges)
    const crossingAssetIds: string[] = [];
    for (const bId of Object.keys(state.bridges)) {
      const bridge = state.bridges[bId];
      if (bridge.status === "active" && edgeIds.includes(bridge.routeEdgeId)) {
        crossingAssetIds.push(bId);
      }
    }

    return {
      edgeIds,
      totalTravelTime,
      residualCapacity: minCapacity,
      crossingAssetIds,
      mode: "network",
    };
  }

  // 2. Off-network fallback (check Euclidean limit first to optimize CPU)
  const sCell = seller.cellId;
  const bCell = buyer.cellId;
  const distCells = Math.hypot(
    (sCell % width) - (bCell % width),
    Math.floor(sCell / width) - Math.floor(bCell / width)
  );
  if (distCells > 25) return null;

  const cellPath = findShortestPath(state, sCell, bCell, true);
  if (cellPath.length === 0) return null;

  // Calculate off-network cumulative cost
  let totalTime = 0;
  const crossingAssetIds: string[] = [];

  const getX = (idx: number) => idx % width;
  const getY = (idx: number) => Math.floor(idx / width);

  for (let idx = 0; idx < cellPath.length - 1; idx++) {
    const current = cellPath[idx];
    const neighbor = cellPath[idx + 1];
    const cx = getX(current);
    const cy = getY(current);

    let stepCost = Math.hypot(cx - getX(neighbor), cy - getY(neighbor));
    const slope = Math.abs(state.elevation[neighbor] - state.elevation[current]);
    stepCost += (slope / 100) * 5.0;

    const biome = state.biomes[neighbor];
    if (biome === "mountain") stepCost += 10.0;
    if (biome === "wetland") stepCost += 6.0;
    if (biome === "forest") stepCost += 2.0;

    const currRiver = isRiverCell(state, current);
    const neighRiver = isRiverCell(state, neighbor);

    if (currRiver || neighRiver) {
      let hasBridge = false;
      for (const bId of Object.keys(state.bridges)) {
        const bridge = state.bridges[bId];
        if (bridge.status === "active" && (bridge.cellId === current || bridge.cellId === neighbor)) {
          hasBridge = true;
          if (!crossingAssetIds.includes(bId)) {
            crossingAssetIds.push(bId);
          }
          break;
        }
      }
      if (!hasBridge) {
        stepCost += 40.0; // River crossing penalty without a bridge
      }
    }
    totalTime += stepCost;
  }

  return {
    edgeIds: [],
    totalTravelTime: totalTime,
    residualCapacity: 10,
    crossingAssetIds,
    mode: "off_network",
  };
}

export function updateEconomy(state: WorldState, ledger: CausalLedger, year: number): void {
  const sIds = Object.keys(state.settlements).filter(id => !state.settlements[id].abandoned);
  if (sIds.length === 0) return;

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
    const pairs: { sellerId: string; buyerId: string; path: ResolvedTransportPath }[] = [];

    for (const sellerId of sellers) {
      for (const buyerId of buyers) {
        const path = resolveTransportPath(state, sellerId, buyerId);
        if (path) {
          pairs.push({ sellerId, buyerId, path });
        }
      }
    }

    // Sort trade pairs by travel time (lowest cost first)
    pairs.sort((a, b) => a.path.totalTravelTime - b.path.totalTravelTime);

    // Allocate flows
    for (const pair of pairs) {
      const seller = state.settlements[pair.sellerId];
      const buyer = state.settlements[pair.buyerId];

      const sellAvail = surplus[pair.sellerId][good];
      const buyNeeded = deficit[pair.buyerId][good];

      if (sellAvail <= 0 || buyNeeded <= 0) continue;

      // Check route capacity constraint
      let routeLimit = pair.path.residualCapacity;
      if (pair.path.mode === "network") {
        for (const edgeId of pair.path.edgeIds) {
          const currentUsage = usedCapacity[edgeId] || 0;
          const route = state.routes[edgeId];
          if (route) {
            routeLimit = Math.min(routeLimit, Math.max(0, route.capacity - currentUsage));
          }
        }
      }

      // Local price with distance markup
      const localPrice = basePrice * (1.0 + pair.path.totalTravelTime * 0.05);

      // Enforce buyer wealth capacity
      const maxAffordableVolume = localPrice > 0 ? buyer.wealth / localPrice : Infinity;

      const tradeVolume = Math.min(sellAvail, buyNeeded, maxAffordableVolume, routeLimit);
      if (tradeVolume <= 0) continue;

      // Apply transaction
      surplus[pair.sellerId][good] -= tradeVolume;
      deficit[pair.buyerId][good] -= tradeVolume;

      if (pair.path.mode === "network") {
        for (const edgeId of pair.path.edgeIds) {
          usedCapacity[edgeId] = (usedCapacity[edgeId] || 0) + tradeVolume;
        }
      }

      // Exchange wealth
      const exportRevenueVal = tradeVolume * basePrice;
      const transportExpenseVal = tradeVolume * (localPrice - basePrice);
      const totalCost = tradeVolume * localPrice;

      const buyerBeforeWealth = buyer.wealth;
      const sellerBeforeWealth = seller.wealth;

      seller.wealth += exportRevenueVal;
      buyer.wealth = Math.max(0, buyer.wealth - totalCost);

      if (buyer.__transientReconciliation) {
        buyer.__transientReconciliation.importExpense += exportRevenueVal;
        buyer.__transientReconciliation.transportExpense += transportExpenseVal;
      }
      if (seller.__transientReconciliation) {
        seller.__transientReconciliation.exportRevenue += exportRevenueVal;
      }

      const buyerAfterWealth = buyer.wealth;
      const sellerAfterWealth = seller.wealth;

      const buyerBeforeAccess = buyer.marketAccess;
      const sellerBeforeAccess = seller.marketAccess;

      buyer.marketAccess = Math.min(1.0, buyer.marketAccess + 0.1);
      seller.marketAccess = Math.min(1.0, seller.marketAccess + 0.1);

      // --- EMIT LEDGER EVENTS ---
      // A. Path resolved
      const bridgeParentIds: string[] = [];
      for (const bId of pair.path.crossingAssetIds) {
        const foundBuild = Object.keys(ledger.events).find(k => k.startsWith(`build_bridge_${bId}`));
        if (foundBuild) {
          bridgeParentIds.push(foundBuild);
        }
      }
      for (const rId of pair.path.edgeIds) {
        const foundBuild = Object.keys(ledger.events).find(k => k.startsWith(`build_road_${rId}`));
        if (foundBuild) {
          bridgeParentIds.push(foundBuild);
        }
      }

      const pathResolvedEventId = `path_resolve_${pair.sellerId}_to_${pair.buyerId}_${good}_${year}`;
      ledger.addEvent({
        eventId: pathResolvedEventId,
        time: { year },
        eventType: "transport_path_resolved",
        location: { cellId: seller.cellId },
        actorIds: [pair.sellerId, pair.buyerId],
        affectedEntityIds: [...pair.path.edgeIds, ...pair.path.crossingAssetIds],
        conditions: [
          {
            conditionId: `path_cond_${pathResolvedEventId}`,
            predicateType: "path_mode",
            subjectIds: [pair.sellerId, pair.buyerId],
            observed: [
              { name: "totalTravelTime", value: pair.path.totalTravelTime },
              { name: "residualCapacity", value: pair.path.residualCapacity }
            ],
            result: true,
            role: "necessary",
            sourceSystem: "economy",
            uncertainty: 0,
          }
        ],
        immediateEffects: [],
        parentEventIds: bridgeParentIds,
        resultingEventIds: [],
        ruleId: "transport_routing",
        summaryTemplate: "Transport path resolved from {sellerName} to {buyerName} via {mode} mode.",
        summaryArguments: { sellerName: seller.name, buyerName: buyer.name, mode: pair.path.mode },
        confidence: 1.0,
      });

      // B. Trade allocation
      const tradeAllocEventId = `trade_alloc_${pair.sellerId}_to_${pair.buyerId}_${good}_${year}`;
      ledger.addEvent({
        eventId: tradeAllocEventId,
        time: { year },
        eventType: "trade_allocation",
        location: { cellId: buyer.cellId },
        actorIds: [pair.sellerId, pair.buyerId],
        affectedEntityIds: [pair.sellerId, pair.buyerId],
        conditions: [
          {
            conditionId: `trade_cond_${tradeAllocEventId}`,
            predicateType: "price_and_volume",
            subjectIds: [pair.sellerId, pair.buyerId],
            observed: [
              { name: "volume", value: tradeVolume },
              { name: "unitPrice", value: localPrice },
              { name: "transportExpense", value: transportExpenseVal }
            ],
            result: true,
            role: "necessary",
            sourceSystem: "economy",
            uncertainty: 0,
          }
        ],
        immediateEffects: [],
        parentEventIds: [pathResolvedEventId],
        resultingEventIds: [],
        ruleId: "market_allocation",
        summaryTemplate: "Allocated {volume} units of {good} from {sellerName} to {buyerName} at price {price}.",
        summaryArguments: { volume: tradeVolume.toFixed(1), good, sellerName: seller.name, buyerName: buyer.name, price: localPrice.toFixed(2) },
        confidence: 1.0,
      });

      // C. Market access changed
      if (buyer.marketAccess !== buyerBeforeAccess) {
        ledger.addEvent({
          eventId: `market_access_${buyer.id}_${good}_${year}`,
          time: { year },
          eventType: "market_access_changed",
          location: { cellId: buyer.cellId },
          actorIds: [buyer.id],
          affectedEntityIds: [buyer.id],
          conditions: [],
          immediateEffects: [
            { entityId: buyer.id, component: "settlements", field: "marketAccess", before: buyerBeforeAccess, after: buyer.marketAccess }
          ],
          parentEventIds: [tradeAllocEventId],
          resultingEventIds: [],
          ruleId: "market_access_update",
          summaryTemplate: "Market access of {name} changed from {before} to {after}.",
          summaryArguments: { name: buyer.name, before: buyerBeforeAccess.toFixed(2), after: buyer.marketAccess.toFixed(2) },
          confidence: 1.0,
        });
      }
      if (seller.marketAccess !== sellerBeforeAccess) {
        ledger.addEvent({
          eventId: `market_access_${seller.id}_${good}_${year}`,
          time: { year },
          eventType: "market_access_changed",
          location: { cellId: seller.cellId },
          actorIds: [seller.id],
          affectedEntityIds: [seller.id],
          conditions: [],
          immediateEffects: [
            { entityId: seller.id, component: "settlements", field: "marketAccess", before: sellerBeforeAccess, after: seller.marketAccess }
          ],
          parentEventIds: [tradeAllocEventId],
          resultingEventIds: [],
          ruleId: "market_access_update",
          summaryTemplate: "Market access of {name} changed from {before} to {after}.",
          summaryArguments: { name: seller.name, before: sellerBeforeAccess.toFixed(2), after: seller.marketAccess.toFixed(2) },
          confidence: 1.0,
        });
      }

      // D. Settlement wealth changed
      ledger.addEvent({
        eventId: `wealth_change_${buyer.id}_import_${good}_${year}`,
        time: { year },
        eventType: "settlement_wealth_changed",
        location: { cellId: buyer.cellId },
        actorIds: [buyer.id],
        affectedEntityIds: [buyer.id],
        conditions: [],
        immediateEffects: [
          { entityId: buyer.id, component: "settlements", field: "wealth", before: buyerBeforeWealth, after: buyerAfterWealth }
        ],
        parentEventIds: [tradeAllocEventId],
        resultingEventIds: [],
        ruleId: "wealth_deduction",
        summaryTemplate: "Wealth of {name} decreased from {before} to {after} due to importing {good}.",
        summaryArguments: { name: buyer.name, before: buyerBeforeWealth.toFixed(0), after: buyerAfterWealth.toFixed(0), good },
        confidence: 1.0,
      });

      ledger.addEvent({
        eventId: `wealth_change_${seller.id}_export_${good}_${year}`,
        time: { year },
        eventType: "settlement_wealth_changed",
        location: { cellId: seller.cellId },
        actorIds: [seller.id],
        affectedEntityIds: [seller.id],
        conditions: [],
        immediateEffects: [
          { entityId: seller.id, component: "settlements", field: "wealth", before: sellerBeforeWealth, after: sellerAfterWealth }
        ],
        parentEventIds: [tradeAllocEventId],
        resultingEventIds: [],
        ruleId: "wealth_addition",
        summaryTemplate: "Wealth of {name} increased from {before} to {after} due to exporting {good}.",
        summaryArguments: { name: seller.name, before: sellerBeforeWealth.toFixed(0), after: sellerAfterWealth.toFixed(0), good },
        confidence: 1.0,
      });
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
