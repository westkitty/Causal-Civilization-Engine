import type { TimelineIntervention } from "../timelines/branch";
import type { SerializedTimelineArchive } from "../timelines/archive";
import type { HistoricalEvent } from "./types";

export const WORKER_PROTOCOL_VERSION = 1;

export interface RunBaselineRequest {
  version: number;
  type: "RUN_BASELINE";
  requestId: number;
  seed: string;
  endYear: number;
  checkpointInterval?: number;
}

export interface RunBranchRequest {
  version: number;
  type: "RUN_BRANCH";
  requestId: number;
  endYear: number;
  intervention: TimelineIntervention;
  parentArchive: SerializedTimelineArchive;
  parentEvents: Record<string, HistoricalEvent>;
}

export interface CancelRequest {
  version: number;
  type: "CANCEL";
  requestId: number;
}

export type SimulationWorkerRequest = RunBaselineRequest | RunBranchRequest | CancelRequest;

export type SimulationWorkerResponse =
  | { version: number; type: "PROGRESS"; requestId: number; completedYear: number; endYear: number }
  | { version: number; type: "CANCELLED"; requestId: number }
  | {
      version: number;
      type: "COMPLETE";
      requestId: number;
      result: {
        archive: SerializedTimelineArchive;
        events: Record<string, HistoricalEvent>;
        snapshots: unknown;
        yearHashes: Record<number, string>;
      };
    }
  | { version: number; type: "ERROR"; requestId: number; message: string };

export function assertWorkerProtocolVersion(version: number): void {
  if (version !== WORKER_PROTOCOL_VERSION) {
    throw new Error(`Unsupported Worker protocol version ${version}`);
  }
}

export class CooperativeCancellation {
  private cancelled = new Set<number>();

  cancel(requestId: number): void {
    this.cancelled.add(requestId);
  }

  reset(requestId: number): void {
    this.cancelled.delete(requestId);
  }

  throwIfCancelled(requestId: number): void {
    if (this.cancelled.has(requestId)) {
      throw new SimulationCancelledError(requestId);
    }
  }
}

export class SimulationCancelledError extends Error {
  constructor(readonly requestId: number) {
    super(`Simulation request ${requestId} was cancelled`);
    this.name = "SimulationCancelledError";
  }
}
