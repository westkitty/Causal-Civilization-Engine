import type { TimelineIntervention } from "./branch";
import type { WorldState, HistoricalEvent } from "../core/types";
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

export function validateIntervention(
  intervention: TimelineIntervention,
  context: InterventionValidationContext,
): InterventionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const branchIds = new Set(context.existingBranchIds);

  if (!intervention.interventionId.trim()) errors.push("Intervention ID is required");
  if (!intervention.newBranchId.trim()) errors.push("New branch ID is required");
  if (branchIds.has(intervention.newBranchId)) errors.push(`Branch ${intervention.newBranchId} already exists`);
  if (intervention.insertionYear < context.minYear || intervention.insertionYear > context.maxYear) {
    errors.push(`Insertion year must be between ${context.minYear} and ${context.maxYear}`);
  }
  if (intervention.operation === "suppress_event" && intervention.targetIds.length === 0) {
    errors.push("Suppress-event interventions require at least one target");
  }
  for (const targetId of intervention.targetIds) {
    const exists = Boolean(
      context.state.settlements[targetId] ||
      context.state.routes[targetId] ||
      context.state.bridges[targetId] ||
      context.state.governments[targetId] ||
      context.state.landmarks[targetId] ||
      context.state.scars[targetId],
    );
    if (!exists) warnings.push(`Target ${targetId} is not present in the selected state`);
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
    this.nodes.set(root.branchId, structuredClone(root));
  }

  add(node: BranchTreeNode): void {
    if (this.nodes.has(node.branchId)) throw new Error(`Duplicate branch ${node.branchId}`);
    if (node.parentBranchId && !this.nodes.has(node.parentBranchId)) {
      throw new Error(`Missing parent branch ${node.parentBranchId}`);
    }
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

  list(): BranchTreeNode[] {
    return [...this.nodes.values()].map(node => structuredClone(node));
  }
}

export interface DivergenceSummary {
  earliestDivergenceYear: number | null;
  changedEventCount: number;
  affectedEntityIds: string[];
  affectedSystems: string[];
  verifiedCausalLinks: number;
  unresolvedEvents: number;
  confidence: number;
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
  const changed: HistoricalEvent[] = [];
  let verifiedCausalLinks = 0;
  let unresolvedEvents = 0;

  for (const event of branchLedger.getAllEvents()) {
    const key = event.correlationKey ?? event.eventId;
    const baseline = baselineByCorrelation.get(key);
    if (!baseline || JSON.stringify(baseline) !== JSON.stringify({ ...event, branchId: baseline.branchId })) {
      changed.push(event);
      if (event.parentEventIds.length > 0) verifiedCausalLinks += 1;
      else if (event.eventType !== "timeline_intervention") unresolvedEvents += 1;
    }
  }

  const affectedEntityIds = [...new Set(changed.flatMap(event => event.affectedEntityIds))].sort();
  const affectedSystems = [...new Set(changed.map(event => event.ruleId.split("_")[0] || event.eventType))].sort();
  const confidence = changed.length === 0
    ? 1
    : Math.max(0, Math.min(1, changed.reduce((sum, event) => sum + event.confidence, 0) / changed.length));

  return {
    earliestDivergenceYear,
    changedEventCount: changed.length,
    affectedEntityIds,
    affectedSystems,
    verifiedCausalLinks,
    unresolvedEvents,
    confidence,
  };
}
