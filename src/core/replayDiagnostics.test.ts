import { describe, expect, it } from "vitest";
import {
  AdaptiveLruCache,
  InvariantRegistry,
  SchemaMigrationRegistry,
  bisectDivergence,
  buildProvenanceGraph,
  cacheMetrics,
  changedEntityIds,
  decodeCheckpoint,
  detectTimelineAnomalies,
  encodeCheckpoint,
  firstDivergentYear,
  fuzzSeeds,
  planPrefetch,
  planThreeWayHashMerge,
  recoverFromCheckpoint,
  signArtifact,
  stableSerialize,
  telemetrySnapshot,
  verifyArtifact,
  workerRetryDelay,
} from "./replayDiagnostics";

describe("replay diagnostics", () => {
  it("serializes objects deterministically and signs their content", () => {
    const left = { z: 1, a: { y: 2, x: 3 } };
    const right = { a: { x: 3, y: 2 }, z: 1 };
    expect(stableSerialize(left)).toBe(stableSerialize(right));
    const signature = signArtifact(left);
    expect(verifyArtifact(right, signature)).toBe(true);
    expect(verifyArtifact({ ...right, z: 2 }, signature)).toBe(false);
  });

  it("finds the first divergent replay frame", () => {
    expect(firstDivergentYear({ 0: "a", 1: "b" }, { 0: "a", 1: "c" })).toBe(1);
    expect(bisectDivergence(
      [{ year: 0, hash: "a" }, { year: 1, hash: "b" }],
      [{ year: 0, hash: "a" }, { year: 1, hash: "c" }],
    )).toMatchObject({ year: 1, left: { hash: "b" }, right: { hash: "c" } });
  });

  it("runs ordered schema migrations and rejects missing steps", () => {
    const registry = new SchemaMigrationRegistry<{ value: number }>();
    registry.register({ from: 1, to: 2, migrate: value => ({ value: value.value + 1 }) });
    registry.register({ from: 2, to: 3, migrate: value => ({ value: value.value * 2 }) });
    expect(registry.migrate({ value: 2 }, 1, 3)).toEqual({ value: 6 });
    expect(() => registry.migrate({ value: 2 }, 1, 4)).toThrow("Missing migration from 3");
  });

  it("adapts cache capacity and reports metrics", () => {
    const cache = new AdaptiveLruCache<string, number>(4, 2, 8);
    cache.set("a", 1); cache.set("b", 2); cache.set("c", 3);
    cache.adapt(1);
    expect(cache.limit).toBe(2);
    expect(cache.size).toBe(2);
    expect(cacheMetrics(cache)).toEqual({ entries: 2, capacity: 2, utilization: 1 });
  });

  it("plans bounded prefetches and retry backoff", () => {
    expect(planPrefetch(2, -1, 4, 0, 10)).toEqual([1, 0]);
    expect(planPrefetch(8, 1, 4, 0, 10)).toEqual([9, 10]);
    expect(workerRetryDelay(0)).toBe(250);
    expect(workerRetryDelay(10)).toBe(8000);
  });

  it("builds provenance edges without mutating events", () => {
    const graph = buildProvenanceGraph({
      a: { resultingEventIds: ["b"] },
      b: { parentEventIds: ["a"] },
    });
    expect(graph.nodes).toEqual(["a", "b"]);
    expect(graph.edges).toEqual([{ from: "a", to: "b" }, { from: "a", to: "b" }]);
  });

  it("round trips compressed checkpoints", () => {
    const encoded = encodeCheckpoint({ terrain: "aaaaabbbbb", year: 4 });
    expect(JSON.parse(decodeCheckpoint(encoded))).toEqual({ terrain: "aaaaabbbbb", year: 4 });
  });

  it("reports changed entities and three-way merge conflicts", () => {
    expect(changedEntityIds({ a: 1, b: 2 }, { b: 3, c: 4 })).toEqual(["a", "b", "c"]);
    expect(planThreeWayHashMerge(
      { 0: "base", 1: "base" },
      { 0: "left", 1: "base" },
      { 0: "right", 1: "right" },
    )).toEqual([
      { year: 0, resolution: "conflict", left: "left", right: "right" },
      { year: 1, resolution: "right", hash: "right" },
    ]);
  });

  it("detects gaps, missing hashes, and unchanged frames", () => {
    const anomalies = detectTimelineAnomalies([
      { year: 0, hash: "a" },
      { year: 2, hash: "a" },
      { year: 3, hash: "" },
    ]);
    expect(anomalies.map(item => item.kind)).toEqual(["year_gap", "unchanged_hash", "missing_hash"]);
  });

  it("recovers from the latest usable checkpoint", () => {
    const checkpoints = new Map([[0, 2], [5, 7]]);
    expect(recoverFromCheckpoint(8, checkpoints, (state, from, to) => state + to - from)).toBe(10);
    expect(() => recoverFromCheckpoint(-1, checkpoints, state => state)).toThrow("No checkpoint available");
  });

  it("evaluates registered invariants without aborting on errors", () => {
    const registry = new InvariantRegistry<number>();
    registry.register("positive", value => value > 0);
    registry.register("small", value => value < 5 ? true : "too large");
    registry.register("safe", () => { throw new Error("broken check"); });
    expect(registry.evaluate(8)).toEqual([
      { name: "positive", ok: true },
      { name: "small", ok: false, detail: "too large" },
      { name: "safe", ok: false, detail: "broken check" },
    ]);
  });

  it("produces deterministic fuzz seeds and telemetry", () => {
    expect(fuzzSeeds("seed", 2)).toEqual(["seed::fuzz::0000", "seed::fuzz::0001"]);
    expect(telemetrySnapshot(
      [{ year: 0, hash: "a" }],
      [{ label: "replay", startedAt: 0, durationMs: 3 }],
      { entries: 1, capacity: 4 },
    )).toEqual({ years: 1, anomalies: 0, traceCount: 1, totalDurationMs: 3, cacheUtilization: 0.25 });
  });
});
