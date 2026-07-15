import type { WorldState } from "./types";
import { generateWorld } from "../geography/terrain";
import { CausalLedger } from "../timelines/ledger";
import { Branch } from "../timelines/branch";
import type { TimelineIntervention } from "../timelines/branch";
import { simulateYear } from "./scheduler";

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

export function resimulateBranch(
  parentBranch: Branch,
  _parentLedger: CausalLedger,
  intervention: TimelineIntervention,
  endYear: number = 400
): { state: WorldState; ledger: CausalLedger; branch: Branch } {
  const branchId = intervention.newBranchId;
  const branch = new Branch(branchId, parentBranch.branchId, intervention);
  const ledger = new CausalLedger(branchId);

  // Find the latest snapshot in parentBranch before the intervention year
  const snapshot = parentBranch.getLatestSnapshotBefore(intervention.insertionYear);

  let startYear = 0;
  let state: WorldState;

  if (snapshot) {
    state = JSON.parse(JSON.stringify(snapshot.state));
    // Restore ledger events up to snapshot year
    for (const evId of Object.keys(snapshot.ledgerEvents)) {
      ledger.addEvent(snapshot.ledgerEvents[evId]);
    }
    startYear = snapshot.year + 1;

    // Copy year hashes up to snapshot year
    for (let y = 0; y <= snapshot.year; y++) {
      branch.recordYearHash(y, parentBranch.yearHashes[y]);
    }
    // Copy snapshots up to snapshot year
    for (const yStr of Object.keys(parentBranch.snapshots)) {
      const y = Number(yStr);
      if (y <= snapshot.year) {
        branch.snapshots[y] = JSON.parse(JSON.stringify(parentBranch.snapshots[y]));
      }
    }
  } else {
    state = generateWorld(parentBranch.snapshots[0]?.state.seed || "default", 125, 125);
    simulateYear(state, ledger, branch, 0);
    startYear = 1;
  }

  // Simulate up to the intervention year
  for (let year = startYear; year < intervention.insertionYear; year++) {
    simulateYear(state, ledger, branch, year);
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

  // Run years forward to endYear
  for (let year = intervention.insertionYear; year <= endYear; year++) {
    simulateYear(state, ledger, branch, year);
  }

  return { state, ledger, branch };
}
