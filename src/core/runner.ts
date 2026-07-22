import type { WorldState } from "./types";
import { generateWorld } from "../geography/terrain";
import { CausalLedger } from "../timelines/ledger";
import { Branch } from "../timelines/branch";
import type { TimelineIntervention } from "../timelines/branch";
import { applyTimelineInterventionEffects } from "../timelines/interventionEffects";
import { simulateYear } from "./scheduler";
import { cloneState } from "./state";

export function runFullSimulation(
  seed: string,
  branch: Branch,
  ledger: CausalLedger,
  endYear: number = 400
): WorldState {
  const state = generateWorld(seed, 125, 125);

  simulateYear(state, ledger, branch, 0);

  for (let year = 1; year <= endYear; year++) {
    simulateYear(state, ledger, branch, year);
  }

  return state;
}

export interface ResimulateOptions {
  parentCachedStates?: Record<number, WorldState>;
  onProgress?: (completedYear: number, endYear: number) => void;
}

export function resimulateBranch(
  parentBranch: Branch,
  _parentLedger: CausalLedger,
  intervention: TimelineIntervention,
  endYear: number = 400,
  options?: ResimulateOptions
): { state: WorldState; ledger: CausalLedger; branch: Branch; cachedStates: Record<number, WorldState> } {
  const branchId = intervention.newBranchId;
  const branch = new Branch(branchId, parentBranch.branchId, intervention);
  const ledger = new CausalLedger(branchId);
  const cachedStates: Record<number, WorldState> = {};

  const snapshot = parentBranch.getLatestSnapshotBefore(intervention.insertionYear);

  let startYear = 0;
  let state: WorldState;

  if (snapshot) {
    state = cloneState(snapshot.state);
    for (const evId of Object.keys(snapshot.ledgerEvents)) {
      ledger.addEvent(snapshot.ledgerEvents[evId]);
    }
    startYear = snapshot.year + 1;
    cachedStates[snapshot.year] = cloneState(state);

    for (let y = 0; y <= snapshot.year; y++) {
      branch.recordYearHash(y, parentBranch.yearHashes[y]);
    }
    for (const yStr of Object.keys(parentBranch.snapshots)) {
      const y = Number(yStr);
      if (y <= snapshot.year) {
        branch.snapshots[y] = structuredClone(parentBranch.snapshots[y]);
      }
    }
  } else {
    state = generateWorld(parentBranch.snapshots[0]?.state.seed || "default", 125, 125);
    startYear = 0;
  }

  for (let year = startYear; year < intervention.insertionYear; year++) {
    simulateYear(state, ledger, branch, year);
    cachedStates[year] = cloneState(state);
  }

  ledger.addEvent({
    eventId: intervention.interventionId,
    time: { year: intervention.insertionYear },
    eventType: "timeline_intervention",
    location: {},
    actorIds: [],
    affectedEntityIds: intervention.targetIds,
    conditions: [],
    immediateEffects: [],
    parentEventIds: [],
    resultingEventIds: [],
    ruleId: "user_intervention",
    summaryTemplate: "Timeline branch was created: {operation} on entities {targetIds}.",
    summaryArguments: { operation: intervention.operation, targetIds: intervention.targetIds.join(", ") },
    confidence: 1.0,
  });

  // Apply player-authored state changes immediately before the insertion year's
  // normal simulation systems run. Their consequences therefore propagate
  // through hazards, transport, economy, demography, politics, and settlement.
  applyTimelineInterventionEffects(state, ledger, intervention);

  for (let year = intervention.insertionYear; year <= endYear; year++) {
    simulateYear(state, ledger, branch, year);
    cachedStates[year] = cloneState(state);
    if (year % 10 === 0 || year === endYear) {
      options?.onProgress?.(year, endYear);
    }
  }

  if (options?.parentCachedStates) {
    for (let y = 0; y < intervention.insertionYear; y++) {
      if (!(y in cachedStates) && options.parentCachedStates[y]) {
        cachedStates[y] = cloneState(options.parentCachedStates[y]);
      }
    }
  }

  return { state, ledger, branch, cachedStates };
}
