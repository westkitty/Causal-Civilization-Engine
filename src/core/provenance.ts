import type { TimelineIntervention } from "../timelines/branch";
import type { SerializedTimelineArchive } from "../timelines/archive";
import type { HistoricalEvent } from "./types";
import { deterministicHash } from "./hashing";

export const SIMULATION_ARTIFACT_VERSION = 1;

export interface SimulationProvenance {
  artifactVersion: number;
  engine: "causal-civilization-engine";
  engineSchemaVersion: number;
  branchId: string;
  parentBranchId?: string;
  seed: string;
  startYear: number;
  endYear: number;
  generatedAt: string;
  intervention?: TimelineIntervention;
  finalStateHash: string;
  archiveHash: string;
  ledgerHash: string;
  verification: {
    deterministicHashesPresent: boolean;
    replayVerified: boolean;
    runtime: string;
  };
}

export interface SimulationArtifact {
  provenance: SimulationProvenance;
  archive: SerializedTimelineArchive;
  events: Record<string, HistoricalEvent>;
}

export function createSimulationArtifact(input: {
  archive: SerializedTimelineArchive;
  events: Record<string, HistoricalEvent>;
  intervention?: TimelineIntervention;
  replayVerified?: boolean;
}): SimulationArtifact {
  const { archive, events, intervention, replayVerified = false } = input;
  const finalStateHash = archive.yearHashes[archive.maxYear];
  if (!finalStateHash) throw new Error("Cannot export a simulation without a final state hash");

  const provenance: SimulationProvenance = {
    artifactVersion: SIMULATION_ARTIFACT_VERSION,
    engine: "causal-civilization-engine",
    engineSchemaVersion: 1,
    branchId: archive.branchId,
    parentBranchId: intervention?.parentBranchId,
    seed: archive.staticState.seed,
    startYear: archive.minYear,
    endYear: archive.maxYear,
    generatedAt: new Date().toISOString(),
    intervention: intervention ? structuredClone(intervention) : undefined,
    finalStateHash,
    archiveHash: deterministicHash(archive),
    ledgerHash: deterministicHash(events),
    verification: {
      deterministicHashesPresent: Object.keys(archive.yearHashes).length > 0,
      replayVerified,
      runtime: typeof navigator === "undefined" ? "node" : navigator.userAgent,
    },
  };

  return {
    provenance,
    archive: structuredClone(archive),
    events: structuredClone(events),
  };
}

export function validateSimulationArtifact(artifact: SimulationArtifact): string[] {
  const errors: string[] = [];
  if (artifact.provenance.artifactVersion !== SIMULATION_ARTIFACT_VERSION) {
    errors.push(`Unsupported artifact version ${artifact.provenance.artifactVersion}`);
  }
  if (deterministicHash(artifact.archive) !== artifact.provenance.archiveHash) {
    errors.push("Archive hash does not match provenance");
  }
  if (deterministicHash(artifact.events) !== artifact.provenance.ledgerHash) {
    errors.push("Ledger hash does not match provenance");
  }
  const finalHash = artifact.archive.yearHashes[artifact.archive.maxYear];
  if (finalHash !== artifact.provenance.finalStateHash) {
    errors.push("Final state hash does not match archive metadata");
  }
  return errors;
}

export function serializeSimulationArtifact(artifact: SimulationArtifact): string {
  const errors = validateSimulationArtifact(artifact);
  if (errors.length > 0) throw new Error(`Invalid simulation artifact: ${errors.join("; ")}`);
  return JSON.stringify(artifact);
}

export function parseSimulationArtifact(source: string): SimulationArtifact {
  const artifact = JSON.parse(source) as SimulationArtifact;
  const errors = validateSimulationArtifact(artifact);
  if (errors.length > 0) throw new Error(`Invalid simulation artifact: ${errors.join("; ")}`);
  return artifact;
}
