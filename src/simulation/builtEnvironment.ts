import type { WorldState, Scar } from "../core/types";
import { CausalLedger, diffEntity } from "../timelines/ledger";

export function updateBuiltEnvironment(state: WorldState, ledger: CausalLedger, year: number): void {
  // 1. Decay existing scars
  for (const scarId of Object.keys(state.scars)) {
    const scar = state.scars[scarId];
    
    scar.intensity = Math.max(0, scar.intensity - 0.015); // 1.5% decay per year
    
    if (scar.intensity === 0) {
      delete state.scars[scarId];
    }
  }

  // 2. Generate scars from abandoned settlements
  for (const sId of Object.keys(state.settlements)) {
    const s = state.settlements[sId];
    if (s.abandoned && s.abandonedYear === year) {
      const scarId = `ruin_${sId}`;
      if (!state.scars[scarId]) {
        const scar: Scar = {
          id: scarId,
          type: "ruined_foundation",
          cellId: s.cellId,
          year,
          intensity: 1.0,
        };
        state.scars[scarId] = scar;

        ledger.addEvent({
          eventId: `scar_${scarId}_${year}`,
          time: { year },
          eventType: "scar_formation",
          location: { cellId: s.cellId, settlementId: sId },
          actorIds: [],
          affectedEntityIds: [scarId],
          conditions: [],
          immediateEffects: diffEntity(scarId, "scars", null, scar),
          parentEventIds: [`abandon_${sId}_${year}`],
          resultingEventIds: [],
          ruleId: "abandonment_decay",
          summaryTemplate: "Ruins of {settlementName} formed ruined foundations at cell {cellId}.",
          summaryArguments: { settlementName: s.name, cellId: s.cellId },
          confidence: 1.0,
        });
      }
    }
  }

  // 3. Road scars (if a route is deleted or decayed)
  // For the MVP, we can keep roads intact or add scars when routes are not maintained.
}
