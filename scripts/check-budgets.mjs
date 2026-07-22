import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const MAX_MAIN_JS_BYTES = Number(process.env.CCE_MAX_MAIN_JS_BYTES ?? 900_000);
const MAX_WORKER_JS_BYTES = Number(process.env.CCE_MAX_WORKER_JS_BYTES ?? 100_000);
const MAX_ARTIFACT_BYTES = Number(process.env.CCE_MAX_ARTIFACT_BYTES ?? 80_000_000);

async function filesRecursively(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await filesRecursively(path));
    else files.push(path);
  }
  return files;
}

async function main() {
  const files = await filesRecursively("dist");
  const js = files.filter(file => file.endsWith(".js"));
  const records = await Promise.all(js.map(async file => ({ file, bytes: (await stat(file)).size })));
  const worker = records.filter(record => /worker/i.test(record.file));
  const main = records.filter(record => !/worker/i.test(record.file));
  const failures = [];

  for (const record of main) {
    if (record.bytes > MAX_MAIN_JS_BYTES) failures.push(`${record.file}: ${record.bytes} > ${MAX_MAIN_JS_BYTES}`);
  }
  for (const record of worker) {
    if (record.bytes > MAX_WORKER_JS_BYTES) failures.push(`${record.file}: ${record.bytes} > ${MAX_WORKER_JS_BYTES}`);
  }

  const artifactPath = process.env.CCE_BUDGET_ARTIFACT;
  if (artifactPath) {
    const bytes = (await stat(artifactPath)).size;
    if (bytes > MAX_ARTIFACT_BYTES) failures.push(`${artifactPath}: ${bytes} > ${MAX_ARTIFACT_BYTES}`);
    const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
    if (!artifact?.provenance?.finalStateHash) failures.push(`${artifactPath}: missing provenance finalStateHash`);
  }

  console.log(JSON.stringify({ budgets: { MAX_MAIN_JS_BYTES, MAX_WORKER_JS_BYTES, MAX_ARTIFACT_BYTES }, records }, null, 2));
  if (failures.length > 0) throw new Error(`Budget failures:\n${failures.join("\n")}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
