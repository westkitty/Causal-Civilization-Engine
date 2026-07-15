import { runFullSimulation, resimulateBranch } from "../src/core/runner";
import { Branch } from "../src/timelines/branch";
import type { TimelineIntervention } from "../src/timelines/branch";
import { CausalLedger } from "../src/timelines/ledger";

function runCounterfactualAnalysis() {
  const seed = "bridge-emergence-001";
  console.log("=== Running Counterfactual Analysis ===");
  console.log("Seed:", seed);

  // 1. Run parent simulation to Year 400
  const parentBranch = new Branch("main");
  const parentLedger = new CausalLedger("main");
  
  const startTime = performance.now();
  const parentState = runFullSimulation(seed, parentBranch, parentLedger, 400);
  const endTime = performance.now();
  console.log(`Parent simulation to Year 400 completed in ${(endTime - startTime).toFixed(1)} ms.`);

  // Find the bridge construction event
  const events = parentLedger.getAllEvents();
  const bridgeEvent = events.find(e => e.eventType === "bridge_construction");

  if (!bridgeEvent) {
    console.log("Error: No bridge construction event found in parent timeline!");
    return;
  }

  const bridgeYear = bridgeEvent.time.year;
  const bridgeId = bridgeEvent.affectedEntityIds.find(id => id.startsWith("bridge_")) || "bridge_6428";
  console.log("\n--- Natural Bridge Construction Details ---");
  console.log("Year constructed:", bridgeYear);
  console.log("Event ID:", bridgeEvent.eventId);
  console.log("Affected Entity:", bridgeId);
  console.log("Rule triggered:", bridgeEvent.ruleId);
  console.log("Conditions:", JSON.stringify(bridgeEvent.conditions, null, 2));

  // 2. Set up suppress intervention at construction year
  console.log("\n--- Setting up Suppress Intervention ---");
  const intervention: TimelineIntervention = {
    interventionId: `interv_suppress_${bridgeId}_${bridgeYear}`,
    parentBranchId: "main",
    newBranchId: `suppress_${bridgeId}`,
    insertionYear: bridgeYear,
    targetIds: [bridgeId],
    operation: "suppress_event",
    parameters: {},
  };

  const branchStartTime = performance.now();
  const { state: branchState, branch: subBranch } = resimulateBranch(
    parentBranch,
    parentLedger,
    intervention,
    400
  );
  const branchEndTime = performance.now();
  console.log(`Counterfactual resimulation completed in ${(branchEndTime - branchStartTime).toFixed(1)} ms.`);

  // 3. Verify prefix isolation
  console.log("\n--- Verifying Prefix Isolation ---");
  let prefixIdentical = true;
  for (let y = 0; y < bridgeYear; y++) {
    const parentHash = parentBranch.yearHashes[y];
    const subHash = subBranch.yearHashes[y];
    if (parentHash !== subHash) {
      prefixIdentical = false;
      console.log(`Mismatch at Year ${y}: Parent=${parentHash}, Branch=${subHash}`);
    }
  }
  if (prefixIdentical) {
    console.log(`SUCCESS: All years 0 to ${bridgeYear - 1} are 100% identical between branches.`);
  } else {
    console.log("FAILURE: Prefix isolation violated before intervention!");
  }

  // 4. Compare Diverged Domains at Year 400
  console.log("\n--- Comparing Diverged Domains at Year 400 ---");
  console.log("Original Branch vs. Suppressed Branch:");

  const settlementsA = parentState.settlements;
  const settlementsB = branchState.settlements;

  console.log("\nSettlements Population & Wealth Comparison:");
  console.log(
    "Name".padEnd(15) + 
    "| Pop (Original)".padStart(16) + 
    "| Pop (Suppressed)".padStart(18) + 
    "| Wealth (Original)".padStart(19) + 
    "| Wealth (Suppressed)".padStart(21)
  );
  console.log("-".repeat(95));

  for (const sId of Object.keys(settlementsA)) {
    const sA = settlementsA[sId];
    const sB = settlementsB[sId];
    if (sA && sB) {
      console.log(
        sA.name.padEnd(15) +
        `| ${sA.population}`.padStart(16) +
        `| ${sB.population}`.padStart(18) +
        `| ${sA.wealth.toFixed(1)}`.padStart(19) +
        `| ${sB.wealth.toFixed(1)}`.padStart(21)
      );
    }
  }

  console.log("\nBridges present in original branch:");
  Object.values(parentState.bridges).forEach(b => {
    console.log(`- ${b.id} at cell ${b.cellId} (Status: ${b.status}, Built Year: ${b.constructionYear})`);
  });

  console.log("\nBridges present in suppressed branch:");
  Object.values(branchState.bridges).forEach(b => {
    console.log(`- ${b.id} at cell ${b.cellId} (Status: ${b.status}, Built Year: ${b.constructionYear})`);
  });

  console.log("\nRoutes Count:");
  console.log("- Original:", Object.keys(parentState.routes).length);
  console.log("- Suppressed:", Object.keys(branchState.routes).length);
}

runCounterfactualAnalysis();
