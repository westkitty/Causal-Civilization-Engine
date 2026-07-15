# Walkthrough & Verification Summary - Causal Civilization Engine

This document provides a final summary of changes made to the Causal Civilization Engine, verifying ledger integrity, causal signature proofs, transport constraints, and causal-semantics correctness.

## Changes Made

1. **Phase 1 — Prevent Event Overwrites**:
   - Modified `CausalLedger.addEvent` in `src/timelines/ledger.ts` to check if an event with the target `eventId` already exists. If it does, the ledger throws a descriptive error: `Duplicate causal event ID: ${event.eventId}`.
   - Refactored event IDs in `src/simulation/economy.ts` to prevent collisions between transactions in the same year. Added a per-good `tradeCounter` suffix to all trade event IDs so that capacity-split re-routes within the same year produce unique IDs.
   - Refactored event IDs in `src/simulation/transport.ts` to include the bridge ID: `wealth_change_${s.id}_invest_${bId}_${year}`.
   - Refactored event IDs in `src/simulation/politics.ts` to include the government ID: `wealth_change_${item.s.id}_tax_${govId}_${year}`.
   - Added a unit test verifying that duplicate ID insertion is rejected.

2. **Phase 2 — Branch-Aware Field-Specific Causal Trace**:
   - Refactored `traceCausalAncestry` in `src/core/causality.ts` to accept a `CausalTraceQuery` structure containing `{ entityId, field, interventionEventId }`.
   - The tracer checks if the target field differs between the baseline state and counterfactual state.
   - It filters focal events to select only those branch events in the counterfactual timeline that modify the target field/entity AND have a genuinely different delta (`after − before`) compared to the baseline event.
   - Parent ID comparison filters out the `interventionEventId` to prevent false positives from parent-list differences caused solely by the intervention being inserted.
   - Upgraded `src/ui/Inspector.tsx` to construct the field-specific query and call the updated tracer.

3. **Phase 3 — Causal Chain Signature Proof**:
   - Implemented a rigorous 5-stage signature verification test: `timeline_intervention` → `road_construction` → `transport_path_resolved` → `trade_allocation` → `settlement_wealth_changed`.
   - Verified that every adjacent pair in the reconstructed path is linked explicitly via parent event IDs.
   - Asserted that quantitative trade mechanism values (volume, unit price, transport expense) genuinely differ between baseline and counterfactual branches.

4. **Phase 4 — Dynamic Residual-Capacity Routing**:
   - Modified Dijkstra in `src/simulation/economy.ts` to compute `residual = route.capacity − currentUsage` per edge and exclude edges where `residual ≤ 0`.
   - The trade allocation loop re-resolves paths dynamically after each transaction, tracking cumulative `usedCapacity` across all goods.
   - Wrote tests verifying: range limits (fails beyond 25 cells), river costs with/without bridges, bridge removal path and travel time adjustments, alternate routing when the cheapest route is bottlenecked at zero capacity, and multi-transaction rerouting when the first trade fills the shortest route.

5. **Phase 5 — Transaction Reconciliation**:
   - Implemented transaction reconciliation conservation tests verifying: `buyer_expenditure = seller_revenue + transport_drag`. (Transport drag is an expense sink, not a balanced counter-account, so this is transaction reconciliation, not double-entry accounting.)
   - Asserted matching parent links, no duplicate/overwritten events, and capacity limit compliance.

6. **Phase 6 — Causal Integrity Validation**:
   - Cycle detection via DFS with visiting/visited states; cycles are reported as `cycleEventIds` in the result.
   - Chronology violation detection: parent events with `year > child.year` are reported as `chronologyViolations`.
   - Missing intervention ID returns `unresolved_ancestry` with the missing ID (does not throw).
   - Semantic infrastructure-parent lookup via `findEligibleInfrastructureEvent` matches by exact event type, affected entity ID, and year bounds — eliminates prefix-based ID matching.
   - Removed seed-based suppression (`state.seed === "suppressed"` check removed from `transport.ts`).

## Verification Evidence

### Automated Test Output
All 46 unit/JSDOM tests (kernel + repairs + 1 UI mount) pass cleanly, plus 4 real-browser Playwright tests:
```bash
 Test Files  3 passed (3)
      Tests  46 passed (46)     # vitest
   4 passed                     # playwright (headless Chromium)
```
Lint reports 0 errors and 0 warnings.

### 5-Stage Causal Diagnostic Output
The test run output prints the following verified causal signature with quantitative divergence data. Trade/path/wealth event IDs now carry a pair-scoped ordinal suffix (`_0`) instead of a global trade counter, and correlate across branches by an explicit `correlationKey` (e.g. `trade:24:settlement_5045:settlement_7545:timber:0`):
```
=== CAUSAL DIAGNOSTIC TRACE ===
Focal Wealth Event Normalized Delta: 0.8000
Original Trade Volume: 0.40 | Counterfactual Trade Volume: 0.40
Original Unit Price: 4.1000 | Counterfactual Unit Price: 8.3000
Original Transport Expense: 0.8400 | Counterfactual Transport Expense: 2.5200
[Stage 1] Event ID: interv_suppress_bridge_10 | Year: 10 | Type: timeline_intervention
[Stage 2] Event ID: build_road_route_settlement_5045_to_settlement_7545_10 | Year: 10 | Type: road_construction
   Proves previous ID (interv_suppress_bridge_10) is included: true
[Stage 3] Event ID: path_resolve_settlement_5045_to_settlement_7545_timber_24_0 | Year: 24 | Type: transport_path_resolved
   Proves previous ID (build_road_route_settlement_5045_to_settlement_7545_10) is included: true
[Stage 4] Event ID: trade_alloc_settlement_5045_to_settlement_7545_timber_24_0 | Year: 24 | Type: trade_allocation
   Proves previous ID (path_resolve_settlement_5045_to_settlement_7545_timber_24_0) is included: true
[Stage 5] Event ID: wealth_change_settlement_5045_export_to_settlement_7545_timber_24_0 | Year: 24 | Type: settlement_wealth_changed
   Proves previous ID (trade_alloc_settlement_5045_to_settlement_7545_timber_24_0) is included: true
===============================
```

### Verification status (updated by the final adversarial audit)
- **Playwright E2E Tests**: NOW EXECUTED. `@playwright/test` + Chromium are installed; `npm run test:e2e` runs 4 real-browser tests (WebGL init, rendered content, all core interactions, and the full counterfactual-suppression flow via the real Worker). All pass in headless Chromium.
- **Browser performance**: MEASURED under software WebGL (SwiftShader): ~11 FPS, ~89/149 ms avg/worst frame, 141 draw calls, 32,432 triangles, ~803 MB heap, ~75 s baseline sim. These are software-rendering figures (no GPU); 60 FPS is not claimed.
- **SpiderMonkey & Cross-engine Hashing**: still unverified (out of scope) — determinism is claimed only for the tested local JavaScript runtime.
- **Leak Profiling**: a bounded 30-scrub check showed 0 MB heap growth; long-run leak freedom remains unverified.
- **Politics subsystem**: found inert (governments never created; audit finding M8) and deliberately left unchanged as out of scope.
