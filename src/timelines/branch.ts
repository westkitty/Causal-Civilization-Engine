import type { WorldState, HistoricalEvent, EventId } from "../core/types";
import { CausalLedger } from "./ledger";
import { cloneState } from "../core/state";

export interface TimelineIntervention {
  interventionId: string;
  parentBranchId: string;
  newBranchId: string;
  insertionYear: number;
  targetIds: string[];
  operation: "suppress_event" | "alter_condition";
  parameters: Record<string, any>;
}

export interface BranchSnapshot {
  year: number;
  state: WorldState;
  ledgerEvents: Record<EventId, HistoricalEvent>;
}

export class Branch {
  branchId: string;
  parentBranchId?: string;
  intervention?: TimelineIntervention;
  snapshots: Record<number, BranchSnapshot> = {};
  yearHashes: Record<number, string> = {};

  constructor(branchId: string, parentBranchId?: string, intervention?: TimelineIntervention) {
    this.branchId = branchId;
    this.parentBranchId = parentBranchId;
    this.intervention = intervention;
  }

  saveSnapshot(year: number, state: WorldState, ledger: CausalLedger) {
    this.snapshots[year] = {
      year,
      state: cloneState(state),
      ledgerEvents: JSON.parse(JSON.stringify(ledger.events)),
    };
  }

  getLatestSnapshotBefore(year: number): BranchSnapshot | undefined {
    const years = Object.keys(this.snapshots)
      .map(Number)
      .sort((a, b) => b - a);
    for (const y of years) {
      if (y < year) {
        return this.snapshots[y];
      }
    }
    return undefined;
  }

  recordYearHash(year: number, hash: string) {
    this.yearHashes[year] = hash;
  }
}
