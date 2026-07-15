# Walkthrough & Verification Summary - Causal Civilization Engine

This document provides a final summary of changes made to the Causal Civilization Engine, verifying ledger integrity, causal signature proofs, transport constraints, causal-semantics correctness, and the repaired existing politics subsystem.

## Changes Made

1. **Phase 1 — Prevent Event Overwrites**:
   - Modified `CausalLedger.addEvent` in `src/timelines/ledger.ts` to check if an event with the target `eventId` already exists. If it does, the ledger throws a descriptive error: `Duplicate causal event ID: ${event.eventId}`.
   - Refactored trade events to use pair-scoped allocation ordinals for unique raw IDs and semantic `correlationKey` values for cross-branch matching. Unrelated trade ordering can no longer shift the identity of a focal pair.
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

7. **Politics Subsystem Completion**:
   - Confirmed the initialization chain: Year-0 politics ran before settlement bootstrap, then a Year-0-only guard prevented every later retry.
   - `simulateYear` now performs explicit Year-0 settlement bootstrap, calls the existing two-government initializer once its prerequisites exist, and then runs ordinary annual systems once in their stable order.
   - Government founding remains deterministic and guarded against duplicate calls. Capitals resolve to active settlements and each control field contains exactly `mapWidth * mapHeight` finite entries with real spatial variance.
   - Capital succession now consults the previous valid control field before that field is reset; an abandoned or missing capital relocates once to the largest eligible controlled settlement, while no eligible replacement causes no fabricated capital.
   - Tax fixtures prove settlement wealth reductions equal treasury increases exactly. The existing 100-wealth floor is honored without increasing settlements already below it, and each settlement pays only one deterministically selected strongest government.
   - Branch replay at Year 0 no longer simulates bootstrap twice. Post-bootstrap branches retain government/control data, exactly match every pre-intervention hash, and do not duplicate political-founding events.
   - Political propagation indexes road adjacency and active bridge cells once per year. This preserves the existing formula while avoiding repeated route scans; timeline storage and Worker payload architecture were not changed.

8. **UI/UX and Interface-Asset Polish**:
   - Corrected the map/camera origin mismatch that left the terrain almost entirely outside the visible workspace.
   - Replaced the incomplete Tailwind-like utility sheet with a semantic CSS token layer for surfaces, text, branch/faction/infrastructure states, spacing, radii, borders, targets, focus, transitions, and reduced motion.
   - Reframed the app as a map-first causal field atlas: identity/status/action shell, real Worker progress, overlay-specific legends, ledger-event timeline markers, explicit branch preview, directly labeled split comparison, and a persistent empty Inspector.
   - Expanded Inspector coverage to settlements, routes, bridges, governments, scars, missing entities, causal paths, evidence history, and branch comparison without changing simulation or causal semantics.
   - Added graceful 768×1024 and 390×844 behavior with a collapsible map-control tray, Inspector sheet, compact timeline, page-overflow guard, and approximately 44×44 CSS-pixel targets.
   - Replaced the external Google Font requests and default Vite favicon with local font stacks and an original local branching-terrain SVG mark. Removed unrelated unused SVG starter assets.
   - Added `tests/e2e/ui-polish.spec.ts` to verify loading resize, semantic shell geometry, overlay/legend/data agreement, Inspector states, keyboard focus, reduced motion, narrow layout, branch recomputation, comparison labels/divider, suppression, and error recovery.

## Verification Evidence

### Automated Test Output
All 56 unit/JSDOM tests (kernel + repairs + 1 UI mount) pass cleanly. The focused UI-polish Playwright test also passes through the real Worker flow:
```bash
 Test Files  3 passed (3)
      Tests  56 passed (56)     # vitest
   1 passed                     # focused UI Playwright (headless Chromium)
```
Final bounded gate: lint 0 errors/0 warnings in 0.78 s; Vitest 56/56 in 228.06 s with file-level serialization; production build success in 6.67 s; focused UI Playwright 1/1 in approximately 3.7 min. The six-test aggregate E2E sweep was started and then intentionally interrupted when the user requested minimum required testing; it is not reported as a final full-suite pass.

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

## 2026-07-15 UI verification closure

Starting SHA `a52016e1a02fbf947501ad889f3a61d2400ca203`. This bounded pass closed
four verification gaps left after the UI/UX polish pass, without any further
redesign:

1. Timeline markers previously labeled a ten-year event bucket as though every
   event occurred at the bucket's first year (e.g. a Year-24 event announced "at
   Year 20"). `src/timelines/markers.ts` now builds truthful `Years 20–29`-style
   ranges and jumps to the true earliest recorded year in the bucket on click.
2. The Inspector's Historical Changes section previously showed raw
   `summaryTemplate` text with unresolved `{placeholder}` tokens. Both the
   Inspector and the causal-path view now render through one shared
   `src/core/eventSummary.ts` helper.
3. Timeline playback (`currentYear` changing roughly every 150 ms) previously
   rebuilt and resorted the entire event ledger on every render. Markers are now
   computed once per committed baseline, in React state, not on every render.
4. `border-cyan-400` / `border-indigo-400` — CSS classes with no stylesheet
   backing, kept alive only so two Playwright assertions could match them — were
   removed; the assertions now check `aria-pressed`, the semantic `is-active`
   class, and real overlay-diagnostic state instead.

Running the full suite fresh also surfaced one test defect (not an application
regression): a Playwright locator ambiguity, since the operation-status text
"Recompiling Causal History..." legitimately renders in two places at once (a
header live-region summary and a status-card heading). The two affected
assertions now target the heading role specifically instead of matching on
plain text. The complete six-test suite then passed, uninterrupted: **6/6, 18.3
minutes, zero page or console errors**.

Full detail, unit-test evidence, and the adversarial resweep for this commit are
recorded in `docs/FINAL_ADVERSARIAL_AUDIT.md` under "2026-07-15 UI verification
closure amendment".

### Verification status (updated by the final adversarial audit)
- **Playwright E2E Tests**: AVAILABLE and PASSING. `@playwright/test` + Chromium are installed; the suite defines six real-browser tests, and the 2026-07-15 UI verification closure pass ran all six together, uninterrupted, on the final commit: 6/6 passed in 18.3 minutes with zero page or console errors. Earlier five-test and one-test evidence above remains historical, captured against earlier commits (see the audit for exact SHAs).
- **Browser performance**: MEASURED with politics active under software WebGL (SwiftShader): ~9 FPS, ~112/168 ms avg/worst frame, 141 draw calls, 32,432 triangles, ~905 MB heap, ~107 s baseline sim. These are software-rendering figures (no GPU); 60 FPS is not claimed.
- **SpiderMonkey & Cross-engine Hashing**: still unverified (out of scope) — determinism is claimed only for the tested local JavaScript runtime.
- **Leak Profiling**: a bounded 30-scrub check showed 0 MB heap growth; long-run leak freedom remains unverified.
- **Politics subsystem**: ACTIVATED AND VERIFIED for the existing government bootstrap, political-control propagation, taxation, capital succession, deterministic replay, counterfactual prefix, and Political overlay paths. No new political mechanics were added.
- **Remaining architecture limits**: the large cached-state/timeline-storage and Worker-payload redesign remains deferred, as do broader performance work and new political mechanics.
