import type { TimelineIntervention } from "../timelines/branch";
import { TimelineArchive } from "../timelines/archive";
import type { SerializedTimelineArchive } from "../timelines/archive";
import { validateTimelineArchive } from "../timelines/archiveValidation";
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
  const archiveErrors = validateTimelineArchive(archive);
  if (archiveErrors.length > 0) throw new Error(`Cannot export invalid archive: ${archiveErrors.join("; ")}`);
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
      deterministicHashesPresent: Object.keys(archive.yearHashes).length === archive.maxYear - archive.minYear + 1,
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
  if (!artifact || typeof artifact !== "object") return ["Artifact must be an object"];
  if (artifact.provenance?.artifactVersion !== SIMULATION_ARTIFACT_VERSION) {
    errors.push(`Unsupported artifact version ${artifact.provenance?.artifactVersion}`);
  }
  if (artifact.provenance?.engine !== "causal-civilization-engine") errors.push("Artifact engine identifier is invalid");
  if (artifact.provenance?.engineSchemaVersion !== 1) errors.push("Artifact engine schema version is unsupported");
  if (Number.isNaN(Date.parse(artifact.provenance?.generatedAt))) errors.push("Artifact generatedAt is invalid");

  errors.push(...validateTimelineArchive(artifact.archive).map(error => `Archive: ${error}`));
  if (artifact.provenance?.branchId !== artifact.archive?.branchId) errors.push("Provenance branchId does not match archive");
  if (artifact.provenance?.seed !== artifact.archive?.staticState?.seed) errors.push("Provenance seed does not match archive");
  if (artifact.provenance?.startYear !== artifact.archive?.minYear) errors.push("Provenance startYear does not match archive");
  if (artifact.provenance?.endYear !== artifact.archive?.maxYear) errors.push("Provenance endYear does not match archive");
  if (artifact.provenance?.intervention) {
    if (artifact.provenance.intervention.newBranchId !== artifact.provenance.branchId) {
      errors.push("Intervention newBranchId does not match artifact branchId");
    }
    if (artifact.provenance.intervention.parentBranchId !== artifact.provenance.parentBranchId) {
      errors.push("Intervention parentBranchId does not match provenance");
    }
  }

  if (deterministicHash(artifact.archive) !== artifact.provenance?.archiveHash) {
    errors.push("Archive hash does not match provenance");
  }
  if (deterministicHash(artifact.events) !== artifact.provenance?.ledgerHash) {
    errors.push("Ledger hash does not match provenance");
  }
  const finalHash = artifact.archive?.yearHashes?.[artifact.archive.maxYear];
  if (finalHash !== artifact.provenance?.finalStateHash) {
    errors.push("Final state hash does not match archive metadata");
  }

  for (const [eventId, event] of Object.entries(artifact.events ?? {})) {
    if (event.eventId !== eventId) errors.push(`Ledger key ${eventId} does not match eventId ${event.eventId}`);
    if (event.branchId !== artifact.provenance?.branchId) {
      errors.push(`Event ${eventId} branchId does not match artifact branch`);
    }
    if (!Number.isInteger(event.time?.year) || event.time.year < artifact.archive?.minYear || event.time.year > artifact.archive?.maxYear) {
      errors.push(`Event ${eventId} has an out-of-range year`);
    }
  }

  if (errors.length === 0) {
    try {
      const replayed = TimelineArchive.deserialize(artifact.archive).materialize(artifact.archive.maxYear);
      if (!replayed) errors.push("Final state cannot be materialized");
      else if (deterministicHash(replayed) !== artifact.provenance.finalStateHash) {
        errors.push("Materialized final state hash does not match provenance");
      }
    } catch (error) {
      errors.push(`Archive replay failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return errors;
}

export function serializeSimulationArtifact(artifact: SimulationArtifact): string {
  const errors = validateSimulationArtifact(artifact);
  if (errors.length > 0) throw new Error(`Invalid simulation artifact: ${errors.join("; ")}`);
  return JSON.stringify(artifact);
}

export function parseSimulationArtifact(source: string): SimulationArtifact {
  let artifact: SimulationArtifact;
  try {
    artifact = JSON.parse(source) as SimulationArtifact;
  } catch (error) {
    throw new Error(`Artifact is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const errors = validateSimulationArtifact(artifact);
  if (errors.length > 0) throw new Error(`Invalid simulation artifact: ${errors.join("; ")}`);
  return artifact;
}
