export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ReplayFrame<T = unknown> { year: number; hash: string; state?: T; eventIds?: string[] }
export interface ReplayTraceEntry { label: string; startedAt: number; durationMs: number; metadata?: Record<string, JsonValue> }
export interface InvariantResult { name: string; ok: boolean; detail?: string }
export interface BenchmarkSample { name: string; durationMs: number; iterations: number }

function stableValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
      result[key] = stableValue((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return String(value);
}

export function stableSerialize(value: unknown): string { return JSON.stringify(stableValue(value)); }

export function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function signArtifact(value: unknown): string { return `fnv1a64:${fnv1a64(stableSerialize(value))}`; }
export function verifyArtifact(value: unknown, signature: string): boolean { return signArtifact(value) === signature; }

export function firstDivergentYear(a: Record<number, string>, b: Record<number, string>): number | null {
  const years = [...new Set([...Object.keys(a), ...Object.keys(b)].map(Number))].sort((x, y) => x - y);
  for (const year of years) if (a[year] !== b[year]) return year;
  return null;
}

export function bisectDivergence(a: ReplayFrame[], b: ReplayFrame[]): { year: number | null; left?: ReplayFrame; right?: ReplayFrame } {
  const left = new Map(a.map(frame => [frame.year, frame]));
  const right = new Map(b.map(frame => [frame.year, frame]));
  const year = firstDivergentYear(
    Object.fromEntries(a.map(frame => [frame.year, frame.hash])),
    Object.fromEntries(b.map(frame => [frame.year, frame.hash])),
  );
  return year === null ? { year: null } : { year, left: left.get(year), right: right.get(year) };
}

export interface Migration<T = unknown> { from: number; to: number; migrate(value: T): T }
export class SchemaMigrationRegistry<T = unknown> {
  private migrations = new Map<number, Migration<T>>();
  register(migration: Migration<T>): void {
    if (migration.to !== migration.from + 1) throw new Error("Migrations must advance exactly one version");
    if (this.migrations.has(migration.from)) throw new Error(`Migration from ${migration.from} already registered`);
    this.migrations.set(migration.from, migration);
  }
  migrate(value: T, from: number, to: number): T {
    if (to < from) throw new Error("Downgrade migrations are not supported");
    let current = value;
    for (let version = from; version < to; version++) {
      const migration = this.migrations.get(version);
      if (!migration) throw new Error(`Missing migration from ${version}`);
      current = migration.migrate(current);
    }
    return current;
  }
}

export class AdaptiveLruCache<K, V> {
  private values = new Map<K, V>();
  constructor(private capacity = 8, private readonly min = 2, private readonly max = 64) {}
  get size(): number { return this.values.size; }
  get limit(): number { return this.capacity; }
  get(key: K): V | undefined {
    const value = this.values.get(key);
    if (value !== undefined) { this.values.delete(key); this.values.set(key, value); }
    return value;
  }
  set(key: K, value: V): void {
    this.values.delete(key); this.values.set(key, value);
    while (this.values.size > this.capacity) this.values.delete(this.values.keys().next().value as K);
  }
  adapt(memoryPressure: number): void {
    const pressure = Math.max(0, Math.min(1, memoryPressure));
    this.capacity = Math.max(this.min, Math.min(this.max, Math.round(this.max - pressure * (this.max - this.min))));
    while (this.values.size > this.capacity) this.values.delete(this.values.keys().next().value as K);
  }
  clear(): void { this.values.clear(); }
}

export function planPrefetch(currentYear: number, direction: -1 | 1, radius: number, minYear = 0, maxYear = 400): number[] {
  const result: number[] = [];
  for (let step = 1; step <= radius; step++) {
    const year = currentYear + direction * step;
    if (year >= minYear && year <= maxYear) result.push(year);
  }
  return result;
}

export function diffRecords(a: Record<string, unknown>, b: Record<string, unknown>) {
  const added: string[] = [], removed: string[] = [], changed: string[] = [];
  for (const key of Object.keys(b)) if (!(key in a)) added.push(key);
  for (const key of Object.keys(a)) if (!(key in b)) removed.push(key);
  for (const key of Object.keys(a)) if (key in b && stableSerialize(a[key]) !== stableSerialize(b[key])) changed.push(key);
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort() };
}

export function buildProvenanceGraph(events: Record<string, { parentEventIds?: string[]; resultingEventIds?: string[] }>) {
  const edges: Array<{ from: string; to: string }> = [];
  for (const [id, event] of Object.entries(events)) {
    for (const parent of event.parentEventIds ?? []) edges.push({ from: parent, to: id });
    for (const child of event.resultingEventIds ?? []) edges.push({ from: id, to: child });
  }
  return { nodes: Object.keys(events).sort(), edges: edges.sort((x, y) => `${x.from}:${x.to}`.localeCompare(`${y.from}:${y.to}`)) };
}

export class ReplayProfiler {
  private entries: ReplayTraceEntry[] = [];
  measure<T>(label: string, action: () => T, metadata?: Record<string, JsonValue>): T {
    const startedAt = performance.now();
    try { return action(); }
    finally { this.entries.push({ label, startedAt, durationMs: performance.now() - startedAt, metadata }); }
  }
  trace(): ReplayTraceEntry[] { return this.entries.map(entry => ({ ...entry, metadata: entry.metadata ? { ...entry.metadata } : undefined })); }
  clear(): void { this.entries = []; }
}

export function exportFlamegraph(entries: ReplayTraceEntry[]): string {
  return entries.map(entry => `${entry.label} ${Math.max(1, Math.round(entry.durationMs * 1000))}`).join("\n");
}

export function reproducibilityReport(seed: string, frames: ReplayFrame[], platform = "unknown") {
  return { seed, platform, frameCount: frames.length, firstYear: frames[0]?.year ?? null, lastYear: frames.at(-1)?.year ?? null, digest: signArtifact(frames.map(({ year, hash }) => ({ year, hash }))) };
}

export class InvariantRegistry<T> {
  private checks = new Map<string, (value: T) => boolean | string>();
  register(name: string, check: (value: T) => boolean | string): void { if (this.checks.has(name)) throw new Error(`Invariant ${name} already registered`); this.checks.set(name, check); }
  evaluate(value: T): InvariantResult[] {
    return [...this.checks.entries()].map(([name, check]) => { try { const result = check(value); return typeof result === "string" ? { name, ok: false, detail: result } : { name, ok: result }; } catch (error) { return { name, ok: false, detail: error instanceof Error ? error.message : String(error) }; } });
  }
}

export function platformDeterminismManifest(frames: ReplayFrame[], runtime: Record<string, string>) {
  return { runtime: { ...runtime }, hashes: Object.fromEntries(frames.map(frame => [frame.year, frame.hash])), signature: signArtifact(frames.map(frame => [frame.year, frame.hash])) };
}

export function encodeCheckpoint(value: unknown): string {
  const source = stableSerialize(value);
  return source.replace(/(.)\1{3,}/g, match => `~${match.length.toString(36)}~${match[0]}`);
}
export function decodeCheckpoint(encoded: string): string { return encoded.replace(/~([0-9a-z]+)~(.)/g, (_m, count, char) => char.repeat(parseInt(count, 36))); }

export function createLazyMaterializer<T>(load: (year: number) => T) {
  const cache = new AdaptiveLruCache<number, T>(4, 1, 16);
  return (year: number): T => { const cached = cache.get(year); if (cached !== undefined) return cached; const value = load(year); cache.set(year, value); return value; };
}

export function changedEntityIds(previous: Record<string, unknown>, next: Record<string, unknown>): string[] {
  const diff = diffRecords(previous, next);
  return [...diff.added, ...diff.removed, ...diff.changed].sort();
}

export function planThreeWayHashMerge(base: Record<number, string>, left: Record<number, string>, right: Record<number, string>) {
  const years = [...new Set([...Object.keys(base), ...Object.keys(left), ...Object.keys(right)].map(Number))].sort((a, b) => a - b);
  return years.map(year => {
    if (left[year] === right[year]) return { year, resolution: "same", hash: left[year] };
    if (left[year] === base[year]) return { year, resolution: "right", hash: right[year] };
    if (right[year] === base[year]) return { year, resolution: "left", hash: left[year] };
    return { year, resolution: "conflict", left: left[year], right: right[year] };
  });
}

export function detectTimelineAnomalies(frames: ReplayFrame[]) {
  const anomalies: Array<{ year: number; kind: string; detail: string }> = [];
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (!frame.hash) anomalies.push({ year: frame.year, kind: "missing_hash", detail: "Frame hash is empty" });
    if (i > 0 && frame.year !== frames[i - 1].year + 1) anomalies.push({ year: frame.year, kind: "year_gap", detail: `Expected ${frames[i - 1].year + 1}` });
    if (i > 0 && frame.hash === frames[i - 1].hash) anomalies.push({ year: frame.year, kind: "unchanged_hash", detail: "Consecutive frames have identical hashes" });
  }
  return anomalies;
}

export function recoverFromCheckpoint<T>(targetYear: number, checkpoints: Map<number, T>, replay: (state: T, fromYear: number, toYear: number) => T): T {
  const available = [...checkpoints.keys()].filter(year => year <= targetYear).sort((a, b) => b - a);
  if (!available.length) throw new Error(`No checkpoint available before year ${targetYear}`);
  const year = available[0];
  return replay(checkpoints.get(year) as T, year, targetYear);
}

export function workerRetryDelay(attempt: number, baseMs = 250, maxMs = 8000): number { return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt)); }

export function cacheMetrics<K, V>(cache: AdaptiveLruCache<K, V>) { return { entries: cache.size, capacity: cache.limit, utilization: cache.limit === 0 ? 0 : cache.size / cache.limit }; }

export function telemetrySnapshot(frames: ReplayFrame[], traces: ReplayTraceEntry[], cache: { entries: number; capacity: number }) {
  return { years: frames.length, anomalies: detectTimelineAnomalies(frames).length, traceCount: traces.length, totalDurationMs: traces.reduce((sum, entry) => sum + entry.durationMs, 0), cacheUtilization: cache.capacity ? cache.entries / cache.capacity : 0 };
}

export function benchmark(name: string, action: () => void, iterations = 10): BenchmarkSample {
  const started = performance.now();
  for (let i = 0; i < iterations; i++) action();
  return { name, durationMs: performance.now() - started, iterations };
}

export function createReplayTraceRecorder() {
  const frames: ReplayFrame[] = [];
  return { record(frame: ReplayFrame): void { frames.push({ ...frame, eventIds: frame.eventIds ? [...frame.eventIds] : undefined }); }, export(): ReplayFrame[] { return frames.map(frame => ({ ...frame, eventIds: frame.eventIds ? [...frame.eventIds] : undefined })); }, clear(): void { frames.length = 0; } };
}

export function fuzzSeeds(baseSeed: string, count: number): string[] {
  if (!Number.isInteger(count) || count < 0) throw new Error("count must be a non-negative integer");
  return Array.from({ length: count }, (_, index) => `${baseSeed}::fuzz::${index.toString(36).padStart(4, "0")}`);
}
