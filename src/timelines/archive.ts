import type { WorldState } from "../core/types";
import { deterministicHash } from "../core/hashing";
import { assertValidTimelineArchive, isSafePatchPath } from "./archiveValidation";

export const TIMELINE_ARCHIVE_VERSION = 1;

export interface StaticWorldState {
  seed: string;
  mapWidth: number;
  mapHeight: number;
  elevation: number[];
  temperature: number[];
  flowAccumulation: number[];
  flowDirection: number[];
  soilFertility: number[];
  biomes: string[];
}

export type DynamicWorldState = Omit<WorldState, keyof StaticWorldState>;

export interface StatePatchOperation {
  op: "set" | "delete";
  path: Array<string | number>;
  value?: unknown;
}

export interface SerializedTimelineArchive {
  version: number;
  branchId: string;
  checkpointInterval: number;
  staticState: StaticWorldState;
  checkpoints: Record<number, DynamicWorldState>;
  deltas: Record<number, StatePatchOperation[]>;
  yearHashes: Record<number, string>;
  minYear: number;
  maxYear: number;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function splitWorldState(state: WorldState): {
  staticState: StaticWorldState;
  dynamicState: DynamicWorldState;
} {
  const {
    seed,
    mapWidth,
    mapHeight,
    elevation,
    temperature,
    flowAccumulation,
    flowDirection,
    soilFertility,
    biomes,
    ...dynamicState
  } = state;
  return {
    staticState: clone({
      seed,
      mapWidth,
      mapHeight,
      elevation,
      temperature,
      flowAccumulation,
      flowDirection,
      soilFertility,
      biomes,
    }),
    dynamicState: clone(dynamicState),
  };
}

export function joinWorldState(
  staticState: StaticWorldState,
  dynamicState: DynamicWorldState,
): WorldState {
  return clone({ ...staticState, ...dynamicState });
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== "object") return false;
  return deterministicHash(a) === deterministicHash(b);
}

function createPatch(
  before: unknown,
  after: unknown,
  path: Array<string | number> = [],
  operations: StatePatchOperation[] = [],
): StatePatchOperation[] {
  if (valuesEqual(before, after)) return operations;

  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length) {
      operations.push({ op: "set", path, value: clone(after) });
      return operations;
    }
    for (let index = 0; index < after.length; index++) {
      if (!Object.is(before[index], after[index])) {
        createPatch(before[index], after[index], [...path, index], operations);
      }
    }
    return operations;
  }

  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object" &&
    !ArrayBuffer.isView(before) &&
    !ArrayBuffer.isView(after)
  ) {
    const beforeRecord = before as Record<string, unknown>;
    const afterRecord = after as Record<string, unknown>;
    const keys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]);
    for (const key of keys) {
      const nextPath = [...path, key];
      if (!isSafePatchPath(nextPath)) throw new Error(`Cannot archive unsafe state path ${nextPath.join(".")}`);
      if (!(key in afterRecord)) {
        operations.push({ op: "delete", path: nextPath });
      } else if (!(key in beforeRecord)) {
        operations.push({ op: "set", path: nextPath, value: clone(afterRecord[key]) });
      } else {
        createPatch(beforeRecord[key], afterRecord[key], nextPath, operations);
      }
    }
    return operations;
  }

  operations.push({ op: "set", path, value: clone(after) });
  return operations;
}

function applyPatch<T>(source: T, operations: StatePatchOperation[]): T {
  const target = clone(source) as unknown as Record<string | number, unknown>;
  for (const operation of operations) {
    if (!isSafePatchPath(operation.path)) throw new Error("Archive contains an unsafe patch path");
    if (operation.path.length === 0) {
      if (operation.op === "delete") throw new Error("Cannot delete archive root");
      return clone(operation.value) as T;
    }
    let cursor: Record<string | number, unknown> = target;
    for (let index = 0; index < operation.path.length - 1; index++) {
      const segment = operation.path[index];
      const next = cursor[segment];
      if (!next || typeof next !== "object") {
        cursor[segment] = typeof operation.path[index + 1] === "number" ? [] : Object.create(null);
      }
      cursor = cursor[segment] as Record<string | number, unknown>;
    }
    const finalSegment = operation.path.at(-1)!;
    if (operation.op === "delete") {
      if (Array.isArray(cursor) && typeof finalSegment === "number") {
        cursor.splice(finalSegment, 1);
      } else {
        delete cursor[finalSegment];
      }
    } else {
      cursor[finalSegment] = clone(operation.value);
    }
  }
  return target as unknown as T;
}

export class TimelineArchive {
  private readonly archive: SerializedTimelineArchive;
  private readonly materialized = new Map<number, WorldState>();
  private readonly lruCapacity: number;

  constructor(serialized: SerializedTimelineArchive, lruCapacity = 8) {
    assertValidTimelineArchive(serialized);
    this.archive = clone(serialized);
    this.lruCapacity = Math.max(2, lruCapacity);
  }

  static create(branchId: string, initialState: WorldState, checkpointInterval = 25): TimelineArchiveBuilder {
    return new TimelineArchiveBuilder(branchId, initialState, checkpointInterval);
  }

  static deserialize(serialized: SerializedTimelineArchive, lruCapacity = 8): TimelineArchive {
    return new TimelineArchive(serialized, lruCapacity);
  }

  serialize(): SerializedTimelineArchive {
    return clone(this.archive);
  }

  get minYear(): number {
    return this.archive.minYear;
  }

  get maxYear(): number {
    return this.archive.maxYear;
  }

  get branchId(): string {
    return this.archive.branchId;
  }

  getYearHash(year: number): string | undefined {
    return this.archive.yearHashes[year];
  }

  materialize(year: number): WorldState | undefined {
    if (!Number.isInteger(year) || year < this.minYear || year > this.maxYear) return undefined;
    const cached = this.materialized.get(year);
    if (cached) {
      this.touch(year, cached);
      return clone(cached);
    }

    const checkpointYear = Object.keys(this.archive.checkpoints)
      .map(Number)
      .filter(candidate => candidate <= year)
      .sort((a, b) => b - a)[0];
    if (checkpointYear === undefined) return undefined;

    let dynamicState = clone(this.archive.checkpoints[checkpointYear]);
    for (let cursor = checkpointYear + 1; cursor <= year; cursor++) {
      const checkpoint = this.archive.checkpoints[cursor];
      if (checkpoint) dynamicState = clone(checkpoint);
      else dynamicState = applyPatch(dynamicState, this.archive.deltas[cursor] ?? []);
    }
    const state = joinWorldState(this.archive.staticState, dynamicState);
    const expectedHash = this.archive.yearHashes[year];
    const actualHash = deterministicHash(state);
    if (actualHash !== expectedHash) {
      throw new Error(`Archive replay hash mismatch at Year ${year}: ${actualHash} != ${expectedHash}`);
    }
    this.touch(year, state);
    return clone(state);
  }

  private touch(year: number, state: WorldState): void {
    this.materialized.delete(year);
    this.materialized.set(year, clone(state));
    while (this.materialized.size > this.lruCapacity) {
      const oldest = this.materialized.keys().next().value as number | undefined;
      if (oldest === undefined) break;
      this.materialized.delete(oldest);
    }
  }
}

export class TimelineArchiveBuilder {
  private readonly serialized: SerializedTimelineArchive;
  private previousDynamic: DynamicWorldState;

  constructor(branchId: string, initialState: WorldState, checkpointInterval = 25) {
    if (!branchId.trim()) throw new Error("Archive branchId is required");
    if (!Number.isInteger(checkpointInterval) || checkpointInterval < 1) {
      throw new Error("Checkpoint interval must be a positive integer");
    }
    const { staticState, dynamicState } = splitWorldState(initialState);
    this.previousDynamic = clone(dynamicState);
    this.serialized = {
      version: TIMELINE_ARCHIVE_VERSION,
      branchId,
      checkpointInterval,
      staticState,
      checkpoints: { [initialState.year]: clone(dynamicState) },
      deltas: {},
      yearHashes: { [initialState.year]: deterministicHash(initialState) },
      minYear: initialState.year,
      maxYear: initialState.year,
    };
  }

  record(state: WorldState, hash = deterministicHash(state)): void {
    const { staticState, dynamicState } = splitWorldState(state);
    if (deterministicHash(staticState) !== deterministicHash(this.serialized.staticState)) {
      throw new Error("Static geography changed; archive cannot silently rewrite its base world");
    }
    const year = state.year;
    if (year !== this.serialized.maxYear + 1) {
      throw new Error(`Timeline archive requires the next sequential year ${this.serialized.maxYear + 1}; received ${year}`);
    }
    if (year % this.serialized.checkpointInterval === 0) {
      this.serialized.checkpoints[year] = clone(dynamicState);
    } else {
      this.serialized.deltas[year] = createPatch(this.previousDynamic, dynamicState);
    }
    this.serialized.yearHashes[year] = hash;
    this.serialized.maxYear = year;
    this.previousDynamic = clone(dynamicState);
  }

  finish(): TimelineArchive {
    return TimelineArchive.deserialize(this.serialized);
  }

  serialize(): SerializedTimelineArchive {
    assertValidTimelineArchive(this.serialized);
    return clone(this.serialized);
  }
}
