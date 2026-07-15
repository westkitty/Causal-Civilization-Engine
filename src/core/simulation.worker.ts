import { runFullSimulation, resimulateBranch } from "./runner";
import { Branch } from "../timelines/branch";
import { CausalLedger } from "../timelines/ledger";
import { simulateYear } from "./scheduler";
import { cloneState } from "./state";

// Listen to parent thread
self.onmessage = (e: MessageEvent) => {
  const { type, requestId, seed, endYear, parentBranchId, intervention } = e.data;

  try {
    if (type === "RUN_BASELINE") {
      const branch = new Branch("main");
      const ledger = new CausalLedger("main");
      
      const state = runFullSimulation(seed, branch, ledger, 0); // Initialize Year 0
      const cachedStates: Record<number, any> = { 0: cloneState(state) };

      // Simulate step-by-step to report progress
      for (let y = 1; y <= endYear; y++) {
        simulateYear(state, ledger, branch, y);
        cachedStates[y] = cloneState(state);

        if (y % 10 === 0 || y === endYear) {
          self.postMessage({
            type: "PROGRESS",
            requestId,
            completedYear: y,
            endYear,
          });
        }
      }

      self.postMessage({
        type: "COMPLETE",
        requestId,
        result: {
          cachedStates,
          yearHashes: branch.yearHashes,
          events: ledger.events,
          snapshots: branch.snapshots,
        },
      });
    } else if (type === "RUN_BRANCH") {
      // Reconstruct parent branch state and ledger
      const parentBranch = new Branch(parentBranchId);
      const parentLedger = new CausalLedger(parentBranchId);
      
      // We need to restore snapshots from parent
      const { parentSnapshots, parentYearHashes } = e.data;
      parentBranch.snapshots = parentSnapshots;
      parentBranch.yearHashes = parentYearHashes;

      const { branch: subBranch, ledger: subLedger } = resimulateBranch(
        parentBranch,
        parentLedger,
        intervention,
        endYear
      );

      // Now cache and simulate all states for the new branch
      const cachedStates: Record<number, any> = {};
      const insertionYear = intervention.insertionYear;

      // Copy identical prefix states from parent snapshots or restore them
      // Since it's identical before insertionYear, we can copy parentStates
      const { parentCachedStates } = e.data;
      for (let y = 0; y < insertionYear; y++) {
        cachedStates[y] = parentCachedStates[y];
      }

      // Simulate forward from insertionYear
      // Get state at insertionYear - 1
      const startState = cloneState(parentCachedStates[insertionYear - 1]);
      startState.year = insertionYear - 1;

      // Run simulation year-by-year from insertionYear
      for (let y = insertionYear; y <= endYear; y++) {
        simulateYear(startState, subLedger, subBranch, y);
        cachedStates[y] = cloneState(startState);

        if (y % 10 === 0 || y === endYear) {
          self.postMessage({
            type: "PROGRESS",
            requestId,
            completedYear: y,
            endYear,
          });
        }
      }

      self.postMessage({
        type: "COMPLETE",
        requestId,
        result: {
          cachedStates,
          yearHashes: subBranch.yearHashes,
          events: subLedger.events,
          snapshots: subBranch.snapshots,
        },
      });
    }
  } catch (err: any) {
    self.postMessage({
      type: "ERROR",
      requestId,
      message: err.message || String(err),
    });
  }
};
