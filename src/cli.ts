import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { resimulateBranch } from "./core/runner";
import { simulateYear } from "./core/scheduler";
import { generateWorld } from "./geography/terrain";
import { Branch } from "./timelines/branch";
import type { TimelineIntervention } from "./timelines/branch";
import { CausalLedger } from "./timelines/ledger";
import { TimelineArchive } from "./timelines/archive";
import { createSimulationArtifact, parseSimulationArtifact, serializeSimulationArtifact } from "./core/provenance";

function argument(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function required(name: string): string {
  const value = argument(name);
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

async function simulate(): Promise<void> {
  const seed = argument("seed", "bridge-emergence-001")!;
  const endYear = Number(argument("years", "400"));
  const output = argument("output", `cce-${seed}-${endYear}.json`)!;
  const branch = new Branch("main");
  const ledger = new CausalLedger("main");
  const state = generateWorld(seed, 125, 125);
  const started = performance.now();

  simulateYear(state, ledger, branch, 0);
  const archive = TimelineArchive.create("main", state);
  for (let year = 1; year <= endYear; year++) {
    simulateYear(state, ledger, branch, year);
    archive.record(state, branch.yearHashes[year]);
  }

  const artifact = createSimulationArtifact({
    archive: archive.serialize(),
    events: ledger.exportEvents(),
  });
  await writeFile(output, serializeSimulationArtifact(artifact), "utf8");
  console.log(JSON.stringify({
    command: "simulate",
    seed,
    endYear,
    output,
    finalHash: branch.yearHashes[endYear],
    elapsedMs: Math.round(performance.now() - started),
    finalStateYear: state.year,
  }, null, 2));
}

async function verify(): Promise<void> {
  const input = required("input");
  const artifact = parseSimulationArtifact(await readFile(input, "utf8"));
  const archive = TimelineArchive.deserialize(artifact.archive);
  const finalState = archive.materialize(artifact.provenance.endYear);
  if (!finalState) throw new Error("Artifact final state cannot be materialized");
  console.log(JSON.stringify({
    command: "verify",
    input,
    branchId: artifact.provenance.branchId,
    seed: artifact.provenance.seed,
    years: [artifact.provenance.startYear, artifact.provenance.endYear],
    finalHash: artifact.provenance.finalStateHash,
    finalStateYear: finalState.year,
    status: "valid",
  }, null, 2));
}

async function branch(): Promise<void> {
  const input = required("input");
  const output = required("output");
  const target = required("target");
  const year = Number(argument("year", "10"));
  const source = parseSimulationArtifact(await readFile(input, "utf8"));
  const parentBranch = new Branch(source.provenance.branchId);
  parentBranch.yearHashes = source.archive.yearHashes;
  const parentLedger = new CausalLedger(source.provenance.branchId);
  parentLedger.importEvents(source.events);
  const parentArchive = TimelineArchive.deserialize(source.archive);
  const state = parentArchive.materialize(year - 1);
  if (!state) throw new Error(`Artifact cannot materialize Year ${year - 1}`);
  parentBranch.snapshots[year - 1] = {
    year: year - 1,
    state,
    ledgerEvents: parentLedger.exportEvents(),
  };
  const intervention: TimelineIntervention = {
    interventionId: `cli_suppress_${target}_${year}`,
    parentBranchId: source.provenance.branchId,
    newBranchId: argument("branch", `branch-${year}`)!,
    insertionYear: year,
    targetIds: [target],
    operation: "suppress_event",
    parameters: {},
  };
  const endYear = Number(argument("years", String(source.provenance.endYear)));
  const result = resimulateBranch(parentBranch, parentLedger, intervention, endYear);
  const first = result.cachedStates[year];
  if (!first) throw new Error("Branch produced no state at intervention year");
  const archive = TimelineArchive.create(intervention.newBranchId, first);
  for (let cursor = year + 1; cursor <= endYear; cursor++) {
    const next = result.cachedStates[cursor];
    if (next) archive.record(next, result.branch.yearHashes[cursor]);
  }
  const artifact = createSimulationArtifact({
    archive: archive.serialize(),
    events: result.ledger.exportEvents(),
    intervention,
  });
  await writeFile(output, serializeSimulationArtifact(artifact), "utf8");
  console.log(JSON.stringify({ command: "branch", output, branchId: intervention.newBranchId }, null, 2));
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "simulate") return simulate();
  if (command === "verify") return verify();
  if (command === "branch") return branch();
  throw new Error("Usage: npm run cli -- <simulate|verify|branch> [options]");
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
