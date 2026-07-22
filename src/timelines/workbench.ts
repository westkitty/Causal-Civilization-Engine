import type { TimelineIntervention } from "./branch";
import type { WorldState, HistoricalEvent } from "../core/types";
import { deterministicHash } from "../core/hashing";
import { CausalLedger } from "./ledger";

export interface InterventionValidationContext {
  state: WorldState;
  minYear: number;
  maxYear: number;
  existingBranchIds: Iterable<string>;
}

export interface InterventionValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function entityExists(state: WorldState, targetId: string): boolean {
  return Boolean(
    state.settlements[targetId] ||
    state.routes[targetId] ||
    state.bridges[targetId] ||
    state.governments[targetId] ||
    state.landmarks[targetId] ||
    state.scars[targetId],
  );
}

export function validateIntervention(
  intervention: TimelineIntervention,
  context: InterventionValidationContext,
): InterventionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const branchIds = new Set(context.existingBranchIds);

  if (!SAFE_ID.test(intervention.interventionId)) errors.push("Intervention ID is missing or unsafe");
  if (!SAFE_ID.test(intervention.parentBranchId)) errors.push("Parent branch ID is missing or unsafe");
  if (!SAFE_ID.test(intervention.newBranchId)) errors.push("New branch ID is missing or unsafe");
  if (intervention.newBranchId === intervention.parentBranchId) errors.push("A branch cannot be its own parent");
  if (!branchIds.has(intervention.parentBranchId)) errors.push(`Parent branch ${intervention.parentBranchId} does not exist`);
  if (branchIds.has(intervention.newBranchId)) errors.push(`Branch ${intervention.newBranchId} already exists`);
  if (!Number.isInteger(intervention.insertionYear)) errors.push("Insertion year must be an integer");
  if (intervention.insertionYear < context.minYear || intervention.insertionYear > context.maxYear) {
    errors.push(`Insertion year must be between ${context.minYear} and ${context.maxYear}`);
  }
  if (!Array.isArray(intervention.targetIds)) errors.push("Intervention targets must be an array");
  const targets = Array.isArray(intervention.targetIds) ? intervention.targetIds : [];
  if (new Set(targets).size !== targets.length) errors.push("Intervention targets must be unique");
  if (targets.some(targetId => !SAFE_ID.test(targetId))) errors.push("Intervention contains an unsafe target ID");
  if (intervention.operation === "suppress_event" && targets.length === 0) {
    errors.push("Suppress-event interventions require at least one target");
  }
  if (intervention.operation !== "suppress_event" && intervention.operation !== "alter_condition") {
    errors.push(`Unsupported intervention operation ${(intervention as { operation?: unknown }).operation}`);
  }
  for (const targetId of targets) {
    if (!entityExists(context.state, targetId)) {
      const message = `Target ${targetId} is not present in the selected state`;
      if (intervention.operation === "suppress_event") errors.push(message);
      else warnings.push(message);
    }
  }
  if (!intervention.parameters || typeof intervention.parameters !== "object" || Array.isArray(intervention.parameters)) {
    errors.push("Intervention parameters must be an object");
  }
  return { valid: errors.length === 0, errors, warnings };
}

export interface BranchTreeNode {
  branchId: string;
  name: string;
  parentBranchId?: string;
  intervention?: TimelineIntervention;
  createdAt: string;
}

export class BranchTree {
  private nodes = new Map<string, BranchTreeNode>();

  constructor(root: BranchTreeNode = {
    branchId: "main",
    name: "Baseline",
    createdAt: new Date(0).toISOString(),
  }) {
    this.validateNode(root, true);
    this.nodes.set(root.branchId, structuredClone(root));
  }

  private validateNode(node: BranchTreeNode, isRoot = false): void {
    if (!SAFE_ID.test(node.branchId)) throw new Error(`Unsafe branch ID ${node.branchId}`);
    if (!node.name.trim()) throw new Error("Branch name is required");
    if (Number.isNaN(Date.parse(node.createdAt))) throw new Error(`Invalid branch timestamp ${node.createdAt}`);
    if (isRoot && node.parentBranchId) throw new Error("Root branch cannot have a parent");
    if (!isRoot && !node.parentBranchId) throw new Error("Non-root branch requires a parent");
    if (node.intervention) {
      if (node.intervention.newBranchId !== node.branchId) throw new Error("Intervention branch ID mismatch");
      if (node.intervention.parentBranchId !== node.parentBranchId) throw new Error("Intervention parent branch mismatch");
    }
  }

  add(node: BranchTreeNode): void {
    this.validateNode(node);
    if (this.nodes.has(node.branchId)) throw new Error(`Duplicate branch ${node.branchId}`);
    if (!this.nodes.has(node.parentBranchId!)) throw new Error(`Missing parent branch ${node.parentBranchId}`);
    this.nodes.set(node.branchId, structuredClone(node));
  }

  get(branchId: string): BranchTreeNode | undefined {
    const node = this.nodes.get(branchId);
    return node ? structuredClone(node) : undefined;
  }

  childrenOf(branchId: string): BranchTreeNode[] {
    return [...this.nodes.values()]
      .filter(node => node.parentBranchId === branchId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.branchId.localeCompare(b.branchId))
      .map(node => structuredClone(node));
  }

  ancestryOf(branchId: string): BranchTreeNode[] {
    const ancestry: BranchTreeNode[] = [];
    let cursor = this.nodes.get(branchId);
    while (cursor) {
      ancestry.push(structuredClone(cursor));
      cursor = cursor.parentBranchId ? this.nodes.get(cursor.parentBranchId) : undefined;
    }
    return ancestry.reverse();
  }

  list(): BranchTreeNode[] {
    return [...this.nodes.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.branchId.localeCompare(b.branchId))
      .map(node => structuredClone(node));
  }
}

export interface DivergenceSummary {
  earliestDivergenceYear: number | null;
  changedEventCount: number;
  addedEventCount: number;
  removedEventCount: number;
  modifiedEventCount: number;
  affectedEntityIds: string[];
  affectedSystems: string[];
  verifiedCausalLinks: number;
  unresolvedEvents: number;
  confidence: number;
}

function normalizedEventHash(event: HistoricalEvent): string {
  return deterministicHash({ ...event, branchId: "<branch>" });
}

export function summarizeDivergence(
  baselineHashes: Record<number, string>,
  branchHashes: Record<number, string>,
  baselineLedger: CausalLedger,
  branchLedger: CausalLedger,
): DivergenceSummary {
  const years = new Set([
    ...Object.keys(baselineHashes).map(Number),
    ...Object.keys(branchHashes).map(Number),
  ]);
  const earliestDivergenceYear = [...years]
    .sort((a, b) => a - b)
    .find(year => baselineHashes[year] !== branchHashes[year]) ?? null;

  const baselineByCorrelation = new Map(
    baselineLedger.getAllEvents().map(event => [event.correlationKey ?? event.eventId, event]),
  );
  const branchByCorrelation = new Map(
    branchLedger.getAllEvents().map(event => [event.correlationKey ?? event.eventId, event]),
  );
  const keys = new Set([...baselineByCorrelation.keys(), ...branchByCorrelation.keys()]);
  const changed: HistoricalEvent[] = [];
  let addedEventCount = 0;
  let removedEventCount = 0;
  let modifiedEventCount = 0;
  let verifiedCausalLinks = 0;
  let unresolvedEvents = 0;

  for (const key of keys) {
    const baseline = baselineByCorrelation.get(key);
    const branch = branchByCorrelation.get(key);
    let representative: HistoricalEvent;
    if (!baseline && branch) {
      addedEventCount += 1;
      representative = branch;
    } else if (baseline && !branch) {
      removedEventCount += 1;
      representative = baseline;
    } else if (baseline && branch && normalizedEventHash(baseline) !== normalizedEventHash(branch)) {
      modifiedEventCount += 1;
      representative = branch;
    } else {
      continue;
    }
    changed.push(representative);
    const ledger = branch ?? baseline ? (branch ? branchLedger : baselineLedger) : branchLedger;
    const validParents = representative.parentEventIds.filter(parentId => {
      const parent = ledger.getEvent(parentId);
      return parent && parent.time.year <= representative.time.year;
    });
    if (validParents.length > 0) verifiedCausalLinks += validParents.length;
    else if (representative.eventType !== "timeline_intervention") unresolvedEvents += 1;
  }

  const affectedEntityIds = [...new Set(changed.flatMap(event => event.affectedEntityIds))].sort();
  const affectedSystems = [...new Set(changed.flatMap(event => [
    event.ruleId.split("_")[0] || event.eventType,
    ...event.conditions.map(condition => condition.sourceSystem),
  ]).filter(Boolean))].sort();
  const confidence = changed.length === 0
    ? 1
    : Math.max(0, Math.min(1, changed.reduce((sum, event) => sum + event.confidence, 0) / changed.length));

  return {
    earliestDivergenceYear,
    changedEventCount: changed.length,
    addedEventCount,
    removedEventCount,
    modifiedEventCount,
    affectedEntityIds,
    affectedSystems,
    verifiedCausalLinks,
    unresolvedEvents,
    confidence,
  };
}
