import { generateWorld } from "../geography/terrain";
import { Branch } from "../timelines/branch";
import type { TimelineIntervention } from "../timelines/branch";
import { CausalLedger } from "../timelines/ledger";
import { TimelineArchive } from "../timelines/archive";
import type { SerializedTimelineArchive } from "../timelines/archive";
import { simulateYear } from "./scheduler";
import { cloneState } from "./state";

export interface ArchiveRunOptions {
  checkpointInterval?: number;
  onProgress?: (completedYear: number, endYear: number) => void;
  shouldCancel?: () => boolean;
}

export interface ArchiveRunResult {
  archive: SerializedTimelineArchive;
  branch: Branch;
  ledger: CausalLedger;
}

function checkCancellation(options?: ArchiveRunOptions): void {
  if (options?.shouldCancel?.()) throw new Error("Simulation cancelled");
}

function assertYear(value: number, name: string, minimum = 0): void {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}`);
  }
}

export function runBaselineArchive(
  seed: string,
  endYear = 400,
  options?: ArchiveRunOptions,
): ArchiveRunResult {
  if (!seed.trim()) throw new Error("Simulation seed is required");
  assertYear(endYear, "End year");
  if (options?.checkpointInterval !== undefined) assertYear(options.checkpointInterval, "Checkpoint interval", 1);

  const branch = new Branch("main");
  const ledger = new CausalLedger("main");
  const state = generateWorld(seed, 125, 125);
  checkCancellation(options);
  simulateYear(state, ledger, branch, 0);
  const builder = TimelineArchive.create("main", state, options?.checkpointInterval ?? 25);

  for (let year = 1; year <= endYear; year++) {
    checkCancellation(options);
    simulateYear(state, ledger, branch, year);
    builder.record(state, branch.yearHashes[year]);
    if (year % 10 === 0 || year === endYear) options?.onProgress?.(year, endYear);
  }
  return { archive: builder.serialize(), branch, ledger };
}

export function runBranchArchive(input: {
  parentArchive: SerializedTimelineArchive;
  parentEvents: ReturnType<CausalLedger["exportEvents"]>;
  intervention: TimelineIntervention;
  endYear?: number;
  options?: ArchiveRunOptions;
}): ArchiveRunResult {
  const { parentArchive, parentEvents, intervention, endYear = parentArchive.maxYear, options } = input;
  assertYear(intervention.insertionYear, "Intervention year");
  assertYear(endYear, "End year");
  if (intervention.parentBranchId !== parentArchive.branchId) {
    throw new Error(`Intervention parent ${intervention.parentBranchId} does not match archive ${parentArchive.branchId}`);
  }
  if (intervention.insertionYear <= parentArchive.minYear) {
    throw new Error(`Intervention year must be after archived Year ${parentArchive.minYear}`);
  }
  if (intervention.insertionYear > parentArchive.maxYear) {
    throw new Error(`Intervention year cannot exceed parent Year ${parentArchive.maxYear}`);
  }
  if (endYear < intervention.insertionYear) {
    throw new Error("Branch end year cannot precede its intervention");
  }
  if (options?.checkpointInterval !== undefined) assertYear(options.checkpointInterval, "Checkpoint interval", 1);

  const parent = TimelineArchive.deserialize(parentArchive);
  const priorYear = intervention.insertionYear - 1;
  const priorState = parent.materialize(priorYear);
  if (!priorState) throw new Error(`Parent archive cannot materialize Year ${priorYear}`);

  const branch = new Branch(intervention.newBranchId, intervention.parentBranchId, intervention);
  const ledger = new CausalLedger(intervention.newBranchId);
  const parentLedger = new CausalLedger(intervention.parentBranchId);
  parentLedger.importEvents(parentEvents);
  const prefixEvents = Object.fromEntries(
    parentLedger.getAllEvents()
      .filter(event => event.time.year < intervention.insertionYear)
      .map(event => [event.eventId, event]),
  );
  ledger.importEvents(prefixEvents);

  for (let year = parentArchive.minYear; year < intervention.insertionYear; year++) {
    const hash = parentArchive.yearHashes[year];
    if (!hash) throw new Error(`Parent archive is missing Year ${year} hash`);
    branch.recordYearHash(year, hash);
  }

  const state = cloneState(priorState);
  ledger.addEvent({
    eventId: intervention.interventionId,
    time: { year: intervention.insertionYear },
    eventType: "timeline_intervention",
    location: {},
    actorIds: [],
    affectedEntityIds: intervention.targetIds,
    conditions: [],
    immediateEffects: [],
    parentEventIds: [],
    resultingEventIds: [],
    ruleId: "user_intervention",
    summaryTemplate: "Timeline branch was created: {operation} on entities {targetIds}.",
    summaryArguments: { operation: intervention.operation, targetIds: intervention.targetIds.join(", ") },
    confidence: 1,
  });

  checkCancellation(options);
  simulateYear(state, ledger, branch, intervention.insertionYear);
  const builder = TimelineArchive.create(
    intervention.newBranchId,
    state,
    options?.checkpointInterval ?? parentArchive.checkpointInterval,
  );
  options?.onProgress?.(intervention.insertionYear, endYear);
  for (let year = intervention.insertionYear + 1; year <= endYear; year++) {
    checkCancellation(options);
    simulateYear(state, ledger, branch, year);
    builder.record(state, branch.yearHashes[year]);
    if (year % 10 === 0 || year === endYear) options?.onProgress?.(year, endYear);
  }
  return { archive: builder.serialize(), branch, ledger };
}
