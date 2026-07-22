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

export function runBaselineArchive(
  seed: string,
  endYear = 400,
  options?: ArchiveRunOptions,
): ArchiveRunResult {
  const branch = new Branch("main");
  const ledger = new CausalLedger("main");
  const state = generateWorld(seed, 125, 125);
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
  const parent = TimelineArchive.deserialize(parentArchive);
  const priorYear = Math.max(parentArchive.minYear, intervention.insertionYear - 1);
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
    if (hash) branch.recordYearHash(year, hash);
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

  simulateYear(state, ledger, branch, intervention.insertionYear);
  const builder = TimelineArchive.create(
    intervention.newBranchId,
    state,
    options?.checkpointInterval ?? parentArchive.checkpointInterval,
  );
  for (let year = intervention.insertionYear + 1; year <= endYear; year++) {
    checkCancellation(options);
    simulateYear(state, ledger, branch, year);
    builder.record(state, branch.yearHashes[year]);
    if (year % 10 === 0 || year === endYear) options?.onProgress?.(year, endYear);
  }
  return { archive: builder.serialize(), branch, ledger };
}
