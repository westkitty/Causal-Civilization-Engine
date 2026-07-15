import type { WorldState } from "./types";
import { generateWorld } from "../geography/terrain";
import { CausalLedger } from "../timelines/ledger";
import { Branch } from "../timelines/branch";
import type { TimelineIntervention } from "../timelines/branch";
import { simulateYear } from "./scheduler";
import { cloneState } from "./state";

export function runFullSimulation(
  seed: string,
  branch: Branch,
  ledger: CausalLedger,
  endYear: number = 400
): WorldState {
  const state = generateWorld(seed, 125, 125);

  // Year 0 initialization
  simulateYear(state, ledger, branch, 0);

  // Run years 1 to endYear
  for (let year = 1; year <= endYear; year++) {
    simulateYear(state, ledger, branch, year);
  }

  return state;
}

export interface ResimulateOptions {
  // Parent per-year states, used only to backfill any pre-snapshot prefix years
  // that this branch did not itself re-simulate (identical by determinism).
  parentCachedStates?: Record<number, WorldState>;
  // Progress callback invoked while simulating forward from the intervention.
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

  // Per-year state cache for this branch. This is authoritative: the worker and
  // UI consume it directly, so the branch is simulated exactly ONCE.
  const cachedStates: Record<number, WorldState> = {};

  // Find the latest snapshot in parentBranch before the intervention year
  const snapshot = parentBranch.getLatestSnapshotBefore(intervention.insertionYear);

  let startYear = 0;
  let state: WorldState;

  if (snapshot) {
    state = cloneState(snapshot.state);
    // Restore ledger events up to snapshot year
    for (const evId of Object.keys(snapshot.ledgerEvents)) {
      ledger.addEvent(snapshot.ledgerEvents[evId]);
    }
    startYear = snapshot.year + 1;
    cachedStates[snapshot.year] = cloneState(state);

    // Copy year hashes up to snapshot year
    for (let y = 0; y <= snapshot.year; y++) {
      branch.recordYearHash(y, parentBranch.yearHashes[y]);
    }
    // Copy snapshots up to snapshot year
    for (const yStr of Object.keys(parentBranch.snapshots)) {
      const y = Number(yStr);
      if (y <= snapshot.year) {
        branch.snapshots[y] = structuredClone(parentBranch.snapshots[y]);
      }
    }
  } else {
    state = generateWorld(parentBranch.snapshots[0]?.state.seed || "default", 125, 125);
    simulateYear(state, ledger, branch, 0);
    cachedStates[0] = cloneState(state);
    startYear = 1;
  }

  // Simulate the (still identical) prefix up to the intervention year, caching
  // each year. These match the parent by construction.
  for (let year = startYear; year < intervention.insertionYear; year++) {
    simulateYear(state, ledger, branch, year);
    cachedStates[year] = cloneState(state);
  }

  // Record the intervention event to the ledger
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

  // Run years forward to endYear, caching each and reporting progress.
  for (let year = intervention.insertionYear; year <= endYear; year++) {
    simulateYear(state, ledger, branch, year);
    cachedStates[year] = cloneState(state);
    if (year % 10 === 0 || year === endYear) {
      options?.onProgress?.(year, endYear);
    }
  }

  // Backfill any pre-snapshot prefix years the branch did not itself simulate.
  if (options?.parentCachedStates) {
    for (let y = 0; y < intervention.insertionYear; y++) {
      if (!(y in cachedStates) && options.parentCachedStates[y]) {
        cachedStates[y] = cloneState(options.parentCachedStates[y]);
      }
    }
  }

  return { state, ledger, branch, cachedStates };
}
