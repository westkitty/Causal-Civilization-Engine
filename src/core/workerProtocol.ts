import type { TimelineIntervention } from "../timelines/branch";
import type { SerializedTimelineArchive } from "../timelines/archive";
import type { HistoricalEvent } from "./types";

export const WORKER_PROTOCOL_VERSION = 1;

interface CancellableRequest {
  cancellationBuffer?: SharedArrayBuffer;
}

export interface RunBaselineRequest extends CancellableRequest {
  version: number;
  type: "RUN_BASELINE";
  requestId: number;
  seed: string;
  endYear: number;
  checkpointInterval?: number;
}

export interface RunBranchRequest extends CancellableRequest {
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

export interface WorkerCancellationHandle {
  buffer: SharedArrayBuffer;
  cancel(): void;
  reset(): void;
  isCancelled(): boolean;
}

export function createWorkerCancellationHandle(): WorkerCancellationHandle | undefined {
  if (typeof SharedArrayBuffer === "undefined") return undefined;
  const buffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const view = new Int32Array(buffer);
  return {
    buffer,
    cancel: () => { Atomics.store(view, 0, 1); },
    reset: () => { Atomics.store(view, 0, 0); },
    isCancelled: () => Atomics.load(view, 0) === 1,
  };
}

export class CooperativeCancellation {
  private cancelled = new Set<number>();
  private sharedFlags = new Map<number, Int32Array>();

  register(requestId: number, buffer?: SharedArrayBuffer): void {
    if (buffer) this.sharedFlags.set(requestId, new Int32Array(buffer));
  }

  cancel(requestId: number): void {
    this.cancelled.add(requestId);
    const flag = this.sharedFlags.get(requestId);
    if (flag) Atomics.store(flag, 0, 1);
  }

  reset(requestId: number, buffer?: SharedArrayBuffer): void {
    this.cancelled.delete(requestId);
    this.sharedFlags.delete(requestId);
    this.register(requestId, buffer);
  }

  release(requestId: number): void {
    this.cancelled.delete(requestId);
    this.sharedFlags.delete(requestId);
  }

  isCancelled(requestId: number): boolean {
    if (this.cancelled.has(requestId)) return true;
    const flag = this.sharedFlags.get(requestId);
    return flag ? Atomics.load(flag, 0) === 1 : false;
  }

  throwIfCancelled(requestId: number): void {
    if (this.isCancelled(requestId)) throw new SimulationCancelledError(requestId);
  }
}

export class SimulationCancelledError extends Error {
  constructor(readonly requestId: number) {
    super(`Simulation request ${requestId} was cancelled`);
    this.name = "SimulationCancelledError";
  }
}
