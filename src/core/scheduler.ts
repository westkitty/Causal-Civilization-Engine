import type { WorldState } from "./types";
import { CausalLedger } from "../timelines/ledger";
import { Branch } from "../timelines/branch";
import { deterministicHash } from "./hashing";

import { updateGeography } from "../geography/terrain";
import { updateHazards } from "../simulation/hazards";
import { updateEconomy } from "../simulation/economy";
import { updateDemography } from "../simulation/demography";
import { updateSettlement } from "../simulation/settlement";
import { updateTransport } from "../simulation/transport";
import { updatePolitics } from "../simulation/politics";
import { updateBuiltEnvironment } from "../simulation/builtEnvironment";

export function simulateYear(
  state: WorldState,
  ledger: CausalLedger,
  branch: Branch,
  year: number
): void {
  state.year = year;

  // Initialize transient wealth reconciliation diagnostics
  for (const sId of Object.keys(state.settlements)) {
    const s = state.settlements[sId];
    s.__transientReconciliation = {
      year,
      wealthBefore: s.wealth,
      productionIncome: 0,
      exportRevenue: 0,
      importExpense: 0,
      transportExpense: 0,
      naturalGrowth: 0,
      taxesPaid: 0,
      investment: 0,
      losses: 0,
      wealthAfter: s.wealth,
    };
  }

  // 1. Hazards check (floods, droughts, fire, epidemics)
  updateHazards(state, ledger, year);

  // 2. Geography dynamic updates (erosion, resource replenishment/depletion)
  updateGeography(state, ledger, year);

  // 3. Transport infrastructure (shortest paths cost surface updates, road condition decay)
  updateTransport(state, ledger, branch, year);

  // 4. Economy (production, iterative min-cost trade allocation, local prices)
  updateEconomy(state, ledger, year);

  // 5. Demography and culture (births, deaths, migration, language shifts)
  updateDemography(state, ledger, year);

  // 6. Politics & administrative reach (control field propagation, borders, capital scoring)
  updatePolitics(state, ledger, year);

  // 7. Built environment (districts, ruins, scars, landmark lifecycle)
  updateBuiltEnvironment(state, ledger, year);

  // 8. Settlements lifecycle (founding checks, housing expansion, abandonment)
  updateSettlement(state, ledger, year);

  // Finalize transient wealth reconciliation diagnostics
  for (const sId of Object.keys(state.settlements)) {
    const s = state.settlements[sId];
    if (s.__transientReconciliation) {
      s.__transientReconciliation.wealthAfter = s.wealth;
    }
  }

  // Verification & snapshotting
  const hash = deterministicHash(state);
  branch.recordYearHash(year, hash);

  // Save snapshots every 25 years or in Year 0 / Year 400
  if (year === 0 || year === 400 || year % 25 === 0) {
    branch.saveSnapshot(year, state, ledger);
  }
}
