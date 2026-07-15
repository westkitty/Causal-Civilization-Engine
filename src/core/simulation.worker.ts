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
      const { parentSnapshots, parentYearHashes, parentCachedStates } = e.data;
      parentBranch.snapshots = parentSnapshots;
      parentBranch.yearHashes = parentYearHashes;

      // Simulate the branch EXACTLY ONCE. resimulateBranch records every year's
      // state and reports progress; re-simulating here would duplicate ledger
      // events and throw.
      const { branch: subBranch, ledger: subLedger, cachedStates } = resimulateBranch(
        parentBranch,
        parentLedger,
        intervention,
        endYear,
        {
          parentCachedStates,
          onProgress: (completedYear, total) => {
            self.postMessage({
              type: "PROGRESS",
              requestId,
              completedYear,
              endYear: total,
            });
          },
        }
      );

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
