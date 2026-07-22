import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { runBaselineArchive, runBranchArchive } from "./core/archiveRunner";
import type { TimelineIntervention } from "./timelines/branch";
import { CausalLedger } from "./timelines/ledger";
import { TimelineArchive } from "./timelines/archive";
import { validateIntervention } from "./timelines/workbench";
import { deterministicHash } from "./core/hashing";
import {
  createSimulationArtifact,
  parseSimulationArtifact,
  serializeSimulationArtifact,
} from "./core/provenance";

function argument(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function required(name: string): string {
  const value = argument(name);
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

function integerArgument(name: string, fallback: number, minimum = 0): number {
  const raw = argument(name, String(fallback));
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`--${name} must be an integer greater than or equal to ${minimum}`);
  }
  return value;
}

async function writeArtifact(path: string, contents: string): Promise<void> {
  try {
    await writeFile(path, contents, { encoding: "utf8", flag: hasFlag("force") ? "w" : "wx" });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") throw new Error(`Refusing to overwrite ${path}; pass --force to replace it`);
    throw error;
  }
}

async function simulate(): Promise<void> {
  const seed = argument("seed", "bridge-emergence-001")!;
  const endYear = integerArgument("years", 400);
  const checkpointInterval = integerArgument("checkpoint", 25, 1);
  const output = argument("output", `cce-${seed}-${endYear}.json`)!;
  const started = performance.now();
  const result = runBaselineArchive(seed, endYear, { checkpointInterval });
  const artifact = createSimulationArtifact({
    archive: result.archive,
    events: result.ledger.exportEvents(),
    replayVerified: true,
  });
  await writeArtifact(output, serializeSimulationArtifact(artifact));
  console.log(JSON.stringify({
    command: "simulate",
    seed,
    endYear,
    checkpointInterval,
    output,
    finalHash: result.branch.yearHashes[endYear],
    elapsedMs: Math.round(performance.now() - started),
  }, null, 2));
}

async function verify(): Promise<void> {
  const input = required("input");
  const artifact = parseSimulationArtifact(await readFile(input, "utf8"));
  const archive = TimelineArchive.deserialize(artifact.archive);
  const finalState = archive.materialize(artifact.provenance.endYear);
  if (!finalState) throw new Error("Artifact final state cannot be materialized");
  const replayedHash = deterministicHash(finalState);
  if (replayedHash !== artifact.provenance.finalStateHash) {
    throw new Error(`Replayed final hash mismatch: ${replayedHash} != ${artifact.provenance.finalStateHash}`);
  }
  console.log(JSON.stringify({
    command: "verify",
    input,
    branchId: artifact.provenance.branchId,
    seed: artifact.provenance.seed,
    years: [artifact.provenance.startYear, artifact.provenance.endYear],
    finalHash: replayedHash,
    finalStateYear: finalState.year,
    eventCount: Object.keys(artifact.events).length,
    status: "valid",
  }, null, 2));
}

async function branch(): Promise<void> {
  const input = required("input");
  const output = required("output");
  const target = required("target");
  const source = parseSimulationArtifact(await readFile(input, "utf8"));
  const year = integerArgument("year", 10, source.archive.minYear);
  const endYear = integerArgument("years", source.provenance.endYear, year);
  if (year > source.archive.maxYear) throw new Error(`--year cannot exceed parent Year ${source.archive.maxYear}`);

  const parentArchive = TimelineArchive.deserialize(source.archive);
  const targetState = parentArchive.materialize(year);
  if (!targetState) throw new Error(`Artifact cannot materialize Year ${year}`);
  const intervention: TimelineIntervention = {
    interventionId: argument("intervention", `cli_suppress_${target}_${year}`)!,
    parentBranchId: source.provenance.branchId,
    newBranchId: argument("branch", `branch-${year}`)!,
    insertionYear: year,
    targetIds: [target],
    operation: "suppress_event",
    parameters: {},
  };
  const validation = validateIntervention(intervention, {
    state: targetState,
    minYear: source.archive.minYear,
    maxYear: source.archive.maxYear,
    existingBranchIds: [source.provenance.branchId],
  });
  if (!validation.valid) throw new Error(`Invalid intervention: ${validation.errors.join("; ")}`);
  if (validation.warnings.length > 0 && !hasFlag("allow-warnings")) {
    throw new Error(`Intervention warnings: ${validation.warnings.join("; ")}; pass --allow-warnings to continue`);
  }

  const result = runBranchArchive({
    parentArchive: source.archive,
    parentEvents: source.events,
    intervention,
    endYear,
  });
  const artifact = createSimulationArtifact({
    archive: result.archive,
    events: result.ledger.exportEvents(),
    intervention,
    replayVerified: true,
  });
  await writeArtifact(output, serializeSimulationArtifact(artifact));
  console.log(JSON.stringify({
    command: "branch",
    input,
    output,
    branchId: intervention.newBranchId,
    parentBranchId: intervention.parentBranchId,
    interventionYear: year,
    endYear,
    warnings: validation.warnings,
    finalHash: result.branch.yearHashes[endYear],
  }, null, 2));
}

function usage(): string {
  return [
    "Usage:",
    "  npm run cli -- simulate [--seed SEED] [--years N] [--checkpoint N] [--output FILE] [--force]",
    "  npm run cli -- verify --input FILE",
    "  npm run cli -- branch --input FILE --output FILE --target ID [--year N] [--years N] [--branch ID] [--allow-warnings] [--force]",
  ].join("\n");
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "simulate") return simulate();
  if (command === "verify") return verify();
  if (command === "branch") return branch();
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }
  throw new Error(usage());
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
