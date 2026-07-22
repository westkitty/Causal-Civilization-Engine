import type { WorldState } from "./types";
import type { HistoricalEvent } from "./types";
import type { BranchSnapshot } from "../timelines/branch";
import {
  buildProvenanceGraph,
  detectTimelineAnomalies,
  platformDeterminismManifest,
  reproducibilityReport,
  signArtifact,
  type ReplayFrame,
} from "./replayDiagnostics";

export interface ReplayDiagnostics {
  schemaVersion: 1;
  replaySignature: string;
  stateCacheSignature: string;
  eventLedgerSignature: string;
  snapshotSignature: string;
  reproducibility: ReturnType<typeof reproducibilityReport>;
  determinismManifest: ReturnType<typeof platformDeterminismManifest>;
  anomalies: ReturnType<typeof detectTimelineAnomalies>;
  provenance: ReturnType<typeof buildProvenanceGraph>;
  counts: {
    cachedStates: number;
    yearHashes: number;
    events: number;
    snapshots: number;
  };
}

export interface ReplayResultShape {
  cachedStates: Record<number, WorldState>;
  yearHashes: Record<number, string>;
  events: Record<string, HistoricalEvent>;
  snapshots: Record<number, BranchSnapshot>;
}

function sortedNumericEntries<T>(record: Record<number, T>): Array<[number, T]> {
  return Object.entries(record)
    .map(([key, value]) => [Number(key), value] as [number, T])
    .sort(([left], [right]) => left - right);
}

export function framesFromYearHashes(yearHashes: Record<number, string>): ReplayFrame[] {
  return sortedNumericEntries(yearHashes).map(([year, hash]) => ({ year, hash }));
}

export function buildReplayDiagnostics(
  seed: string,
  result: ReplayResultShape,
  runtime: Record<string, string> = {},
): ReplayDiagnostics {
  const frames = framesFromYearHashes(result.yearHashes);
  const normalizedRuntime = {
    execution: typeof WorkerGlobalScope !== "undefined" ? "worker" : "main-thread",
    ...runtime,
  };

  return {
    schemaVersion: 1,
    replaySignature: signArtifact(frames),
    stateCacheSignature: signArtifact(sortedNumericEntries(result.cachedStates)),
    eventLedgerSignature: signArtifact(result.events),
    snapshotSignature: signArtifact(sortedNumericEntries(result.snapshots)),
    reproducibility: reproducibilityReport(seed, frames, normalizedRuntime.execution),
    determinismManifest: platformDeterminismManifest(frames, normalizedRuntime),
    anomalies: detectTimelineAnomalies(frames),
    provenance: buildProvenanceGraph(result.events),
    counts: {
      cachedStates: Object.keys(result.cachedStates).length,
      yearHashes: Object.keys(result.yearHashes).length,
      events: Object.keys(result.events).length,
      snapshots: Object.keys(result.snapshots).length,
    },
  };
}

export function attachReplayDiagnostics<T extends ReplayResultShape>(
  seed: string,
  result: T,
  runtime?: Record<string, string>,
): T & { diagnostics: ReplayDiagnostics } {
  return { ...result, diagnostics: buildReplayDiagnostics(seed, result, runtime) };
}
