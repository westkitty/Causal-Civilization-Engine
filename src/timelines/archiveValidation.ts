import { TIMELINE_ARCHIVE_VERSION } from "./archive";
import type { SerializedTimelineArchive, StatePatchOperation } from "./archive";

const FORBIDDEN_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

export function isSafePatchPath(path: Array<string | number>): boolean {
  return path.every(segment =>
    typeof segment === "number"
      ? Number.isInteger(segment) && segment >= 0
      : segment.length > 0 && !FORBIDDEN_PATH_SEGMENTS.has(segment),
  );
}

function validatePatch(operation: StatePatchOperation, label: string, errors: string[]): void {
  if (operation.op !== "set" && operation.op !== "delete") {
    errors.push(`${label} has unsupported operation ${(operation as { op?: unknown }).op}`);
  }
  if (!Array.isArray(operation.path) || !isSafePatchPath(operation.path)) {
    errors.push(`${label} has an unsafe patch path`);
  }
  if (operation.op === "delete" && operation.path.length === 0) {
    errors.push(`${label} cannot delete the archive root`);
  }
  if (operation.op === "set" && !("value" in operation)) {
    errors.push(`${label} set operation is missing a value`);
  }
}

export function validateTimelineArchive(archive: SerializedTimelineArchive): string[] {
  const errors: string[] = [];
  if (!archive || typeof archive !== "object") return ["Archive must be an object"];
  if (archive.version !== TIMELINE_ARCHIVE_VERSION) {
    errors.push(`Unsupported timeline archive version ${archive.version}`);
  }
  if (!archive.branchId?.trim()) errors.push("Archive branchId is required");
  if (!Number.isInteger(archive.checkpointInterval) || archive.checkpointInterval < 1) {
    errors.push("Archive checkpointInterval must be a positive integer");
  }
  if (!Number.isInteger(archive.minYear) || !Number.isInteger(archive.maxYear) || archive.minYear > archive.maxYear) {
    errors.push("Archive year bounds are invalid");
  }

  const width = archive.staticState?.mapWidth;
  const height = archive.staticState?.mapHeight;
  const cellCount = Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
    ? width * height
    : -1;
  if (cellCount < 1) errors.push("Archive map dimensions are invalid");
  const staticGrids = [
    ["elevation", archive.staticState?.elevation],
    ["temperature", archive.staticState?.temperature],
    ["flowAccumulation", archive.staticState?.flowAccumulation],
    ["flowDirection", archive.staticState?.flowDirection],
    ["soilFertility", archive.staticState?.soilFertility],
    ["biomes", archive.staticState?.biomes],
  ] as const;
  for (const [name, grid] of staticGrids) {
    if (!Array.isArray(grid) || grid.length !== cellCount) {
      errors.push(`Archive static grid ${name} must contain ${cellCount} cells`);
    }
  }

  const checkpointYears = new Set(Object.keys(archive.checkpoints ?? {}).map(Number));
  const deltaYears = new Set(Object.keys(archive.deltas ?? {}).map(Number));
  if (!checkpointYears.has(archive.minYear)) errors.push("Archive must checkpoint minYear");

  for (let year = archive.minYear; year <= archive.maxYear; year++) {
    if (typeof archive.yearHashes?.[year] !== "string" || archive.yearHashes[year].length === 0) {
      errors.push(`Archive is missing the hash for Year ${year}`);
    }
    if (year !== archive.minYear) {
      const representations = Number(checkpointYears.has(year)) + Number(deltaYears.has(year));
      if (representations !== 1) {
        errors.push(`Year ${year} must have exactly one checkpoint or delta`);
      }
    }
  }

  for (const year of [...checkpointYears, ...deltaYears]) {
    if (!Number.isInteger(year) || year < archive.minYear || year > archive.maxYear) {
      errors.push(`Archive contains out-of-range frame Year ${year}`);
    }
  }
  for (const [year, operations] of Object.entries(archive.deltas ?? {})) {
    if (!Array.isArray(operations)) {
      errors.push(`Archive delta Year ${year} must be an array`);
      continue;
    }
    operations.forEach((operation, index) => validatePatch(operation, `Year ${year} patch ${index}`, errors));
  }
  return errors;
}

export function assertValidTimelineArchive(archive: SerializedTimelineArchive): void {
  const errors = validateTimelineArchive(archive);
  if (errors.length > 0) throw new Error(`Invalid timeline archive: ${errors.join("; ")}`);
}
