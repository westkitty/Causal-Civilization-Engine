import type { EventId, HistoricalEvent, WorldState } from "./types";
import type { TimelineIntervention } from "../timelines/branch";
import { signArtifact, stableSerialize, verifyArtifact } from "./replayDiagnostics";

export interface ReplayBookmark {
  id: string;
  name: string;
  year: number;
  branchId: string;
  entityId?: string;
  note?: string;
}

export class ReplayBookmarkStore {
  private readonly bookmarks = new Map<string, ReplayBookmark>();
  save(bookmark: ReplayBookmark): void { this.bookmarks.set(bookmark.id, structuredClone(bookmark)); }
  remove(id: string): boolean { return this.bookmarks.delete(id); }
  get(id: string): ReplayBookmark | undefined { const item = this.bookmarks.get(id); return item ? structuredClone(item) : undefined; }
  list(branchId?: string): ReplayBookmark[] {
    return [...this.bookmarks.values()]
      .filter(item => !branchId || item.branchId === branchId)
      .sort((a, b) => a.year - b.year || a.name.localeCompare(b.name))
      .map(item => structuredClone(item));
  }
}

export interface ReplayPackage {
  format: "cce-replay";
  version: 1;
  seed: string;
  branchId: string;
  endYear: number;
  yearHashes: Record<number, string>;
  events: Record<EventId, HistoricalEvent>;
  interventions: TimelineIntervention[];
  metadata: Record<string, string | number | boolean>;
  signature: string;
}

export function createReplayPackage(input: Omit<ReplayPackage, "format" | "version" | "signature">): ReplayPackage {
  const body = { format: "cce-replay" as const, version: 1 as const, ...input };
  return { ...body, signature: signArtifact(body) };
}

export function validateReplayPackage(pkg: ReplayPackage): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (pkg.format !== "cce-replay") errors.push("Unsupported replay format");
  if (pkg.version !== 1) errors.push(`Unsupported replay version ${pkg.version}`);
  if (!pkg.seed) errors.push("Missing seed");
  if (!pkg.branchId) errors.push("Missing branch id");
  if (!Number.isInteger(pkg.endYear) || pkg.endYear < 0) errors.push("Invalid end year");
  const { signature, ...body } = pkg;
  if (!verifyArtifact(body, signature)) errors.push("Replay signature mismatch");
  return { valid: errors.length === 0, errors };
}

export interface SaveEnvelope<T> {
  schemaVersion: number;
  createdAt: string;
  payload: T;
  signature: string;
}

export function createSaveEnvelope<T>(payload: T, schemaVersion = 1, createdAt = new Date().toISOString()): SaveEnvelope<T> {
  const body = { schemaVersion, createdAt, payload };
  return { ...body, signature: signArtifact(body) };
}

export function validateSaveEnvelope<T>(envelope: SaveEnvelope<T>, expectedVersion?: number): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!Number.isInteger(envelope.schemaVersion) || envelope.schemaVersion < 1) errors.push("Invalid schema version");
  if (expectedVersion !== undefined && envelope.schemaVersion !== expectedVersion) errors.push(`Expected schema ${expectedVersion}, received ${envelope.schemaVersion}`);
  if (Number.isNaN(Date.parse(envelope.createdAt))) errors.push("Invalid creation timestamp");
  const { signature, ...body } = envelope;
  if (!verifyArtifact(body, signature)) errors.push("Save signature mismatch");
  return { valid: errors.length === 0, errors };
}

export type DeltaOperation = { path: string[]; value?: unknown; remove?: true };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function diffSnapshot(before: unknown, after: unknown, path: string[] = []): DeltaOperation[] {
  if (stableSerialize(before) === stableSerialize(after)) return [];
  if (!isRecord(before) || !isRecord(after)) return [{ path, value: structuredClone(after) }];
  const changes: DeltaOperation[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of [...keys].sort()) {
    if (!(key in after)) changes.push({ path: [...path, key], remove: true });
    else if (!(key in before)) changes.push({ path: [...path, key], value: structuredClone(after[key]) });
    else changes.push(...diffSnapshot(before[key], after[key], [...path, key]));
  }
  return changes;
}

export function applySnapshotDelta<T>(base: T, delta: DeltaOperation[]): T {
  const result = structuredClone(base) as unknown;
  for (const operation of delta) {
    if (operation.path.length === 0) return structuredClone(operation.value) as T;
    let cursor = result as Record<string, unknown>;
    for (const segment of operation.path.slice(0, -1)) {
      if (!isRecord(cursor[segment])) cursor[segment] = {};
      cursor = cursor[segment] as Record<string, unknown>;
    }
    const key = operation.path[operation.path.length - 1];
    if (operation.remove) delete cursor[key];
    else cursor[key] = structuredClone(operation.value);
  }
  return result as T;
}

export interface IncrementalReplayPlan {
  replayFromYear: number;
  reusableYears: number[];
  invalidatedYears: number[];
  checkpointYear: number | null;
}

export function planIncrementalReplay(input: {
  insertionYear: number;
  endYear: number;
  cachedYears: number[];
  snapshotYears: number[];
}): IncrementalReplayPlan {
  const cached = [...new Set(input.cachedYears)].filter(year => year >= 0 && year <= input.endYear).sort((a, b) => a - b);
  const checkpointYear = [...input.snapshotYears].filter(year => year < input.insertionYear).sort((a, b) => b - a)[0] ?? null;
  const replayFromYear = checkpointYear === null ? 0 : checkpointYear;
  return {
    replayFromYear,
    checkpointYear,
    reusableYears: cached.filter(year => year < input.insertionYear),
    invalidatedYears: cached.filter(year => year >= input.insertionYear),
  };
}

export interface ProfileSample { subsystem: string; durationMs: number; invocations?: number; year?: number; }
export interface ProfileSummary { totalDurationMs: number; bySubsystem: Record<string, { durationMs: number; percentage: number; invocations: number }>; slowestSubsystem: string | null; }

export function summarizeReplayProfile(samples: ProfileSample[]): ProfileSummary {
  const totalDurationMs = samples.reduce((sum, sample) => sum + Math.max(0, sample.durationMs), 0);
  const bySubsystem: ProfileSummary["bySubsystem"] = {};
  for (const sample of samples) {
    const item = bySubsystem[sample.subsystem] ?? { durationMs: 0, percentage: 0, invocations: 0 };
    item.durationMs += Math.max(0, sample.durationMs);
    item.invocations += sample.invocations ?? 1;
    bySubsystem[sample.subsystem] = item;
  }
  for (const item of Object.values(bySubsystem)) item.percentage = totalDurationMs === 0 ? 0 : item.durationMs / totalDurationMs;
  const slowestSubsystem = Object.entries(bySubsystem).sort((a, b) => b[1].durationMs - a[1].durationMs)[0]?.[0] ?? null;
  return { totalDurationMs, bySubsystem, slowestSubsystem };
}

export function stateCacheFingerprint(states: Record<number, WorldState>): string {
  return signArtifact(Object.keys(states).map(Number).sort((a, b) => a - b).map(year => ({ year, seed: states[year].seed, stateYear: states[year].year })));
}
