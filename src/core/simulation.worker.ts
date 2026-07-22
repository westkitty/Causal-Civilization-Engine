import { runFullSimulation, resimulateBranch } from "./runner";
import { runBaselineArchive, runBranchArchive } from "./archiveRunner";
import { Branch } from "../timelines/branch";
import { CausalLedger } from "../timelines/ledger";
import { simulateYear } from "./scheduler";
import { cloneState } from "./state";
import {
  WORKER_PROTOCOL_VERSION,
  assertWorkerProtocolVersion,
  CooperativeCancellation,
  SimulationCancelledError,
} from "./workerProtocol";
import type { SimulationWorkerRequest } from "./workerProtocol";

const cancellation = new CooperativeCancellation();

function post(message: unknown): void {
  self.postMessage(message);
}

self.onmessage = (e: MessageEvent<SimulationWorkerRequest | Record<string, unknown>>) => {
  const data = e.data as SimulationWorkerRequest & Record<string, unknown>;
  const requestId = Number(data.requestId);

  if (data.type === "CANCEL") {
    cancellation.cancel(requestId);
    post({ version: WORKER_PROTOCOL_VERSION, type: "CANCELLED", requestId });
    return;
  }

  try {
    if (typeof data.version === "number") {
      assertWorkerProtocolVersion(data.version);
      cancellation.reset(requestId);

      if (data.type === "RUN_BASELINE") {
        const result = runBaselineArchive(data.seed, data.endYear, {
          checkpointInterval: data.checkpointInterval,
          shouldCancel: () => {
            try {
              cancellation.throwIfCancelled(requestId);
              return false;
            } catch {
              return true;
            }
          },
          onProgress: (completedYear, endYear) => post({
            version: WORKER_PROTOCOL_VERSION,
            type: "PROGRESS",
            requestId,
            completedYear,
            endYear,
          }),
        });
        post({
          version: WORKER_PROTOCOL_VERSION,
          type: "COMPLETE",
          requestId,
          result: {
            archive: result.archive,
            yearHashes: result.branch.yearHashes,
            events: result.ledger.exportEvents(),
            snapshots: result.branch.snapshots,
          },
        });
        return;
      }

      if (data.type === "RUN_BRANCH") {
        const result = runBranchArchive({
          parentArchive: data.parentArchive,
          parentEvents: data.parentEvents,
          intervention: data.intervention,
          endYear: data.endYear,
          options: {
            shouldCancel: () => {
              try {
                cancellation.throwIfCancelled(requestId);
                return false;
              } catch {
                return true;
              }
            },
            onProgress: (completedYear, endYear) => post({
              version: WORKER_PROTOCOL_VERSION,
              type: "PROGRESS",
              requestId,
              completedYear,
              endYear,
            }),
          },
        });
        post({
          version: WORKER_PROTOCOL_VERSION,
          type: "COMPLETE",
          requestId,
          result: {
            archive: result.archive,
            yearHashes: result.branch.yearHashes,
            events: result.ledger.exportEvents(),
            snapshots: result.branch.snapshots,
          },
        });
        return;
      }
    }

    // Legacy protocol remains available while the React workbench migrates to
    // archive materialization. It is intentionally isolated from the compact path.
    const { type, seed, endYear, parentBranchId, intervention } = data as any;
    if (type === "RUN_BASELINE") {
      const branch = new Branch("main");
      const ledger = new CausalLedger("main");
      const state = runFullSimulation(seed, branch, ledger, 0);
      const cachedStates: Record<number, any> = { 0: cloneState(state) };
      for (let y = 1; y <= endYear; y++) {
        simulateYear(state, ledger, branch, y);
        cachedStates[y] = cloneState(state);
        if (y % 10 === 0 || y === endYear) {
          post({ type: "PROGRESS", requestId, completedYear: y, endYear });
        }
      }
      post({
        type: "COMPLETE",
        requestId,
        result: {
          cachedStates,
          yearHashes: branch.yearHashes,
          events: ledger.exportEvents(),
          snapshots: branch.snapshots,
        },
      });
    } else if (type === "RUN_BRANCH") {
      const parentBranch = new Branch(parentBranchId);
      const parentLedger = new CausalLedger(parentBranchId);
      const { parentSnapshots, parentYearHashes, parentCachedStates } = data as any;
      parentBranch.snapshots = parentSnapshots;
      parentBranch.yearHashes = parentYearHashes;
      const { branch: subBranch, ledger: subLedger, cachedStates } = resimulateBranch(
        parentBranch,
        parentLedger,
        intervention,
        endYear,
        {
          parentCachedStates,
          onProgress: (completedYear, total) => post({
            type: "PROGRESS",
            requestId,
            completedYear,
            endYear: total,
          }),
        },
      );
      post({
        type: "COMPLETE",
        requestId,
        result: {
          cachedStates,
          yearHashes: subBranch.yearHashes,
          events: subLedger.exportEvents(),
          snapshots: subBranch.snapshots,
        },
      });
    }
  } catch (error: unknown) {
    if (error instanceof SimulationCancelledError || (error instanceof Error && error.message === "Simulation cancelled")) {
      post({ version: WORKER_PROTOCOL_VERSION, type: "CANCELLED", requestId });
      return;
    }
    post({
      version: typeof data.version === "number" ? WORKER_PROTOCOL_VERSION : undefined,
      type: "ERROR",
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
