# Causal Civilization Engine Task Checklist

- `[x]` **Phase 2: Correct the Hashing and Determinism Claims**
  - `[x]` Implement exact Float64 hexadecimal stringifier in `src/core/hashing.ts`
  - `[x]` Add tests proving values differing below four decimal places produce different hashes
  - `[x]` Ensure exact state and exact ledger hashes match across repeated runs
  - `[x]` Verify snapshot serialization preserves exact hashes
- `[x]` **Phase 3: Repair Test-Environment Separation**
  - `[x]` Annotate `ui.test.tsx` with `// @vitest-environment jsdom`
  - `[x]` Run unit tests in default Node environment
  - `[x]` Verify `npm run test` executes both environments cleanly
- `[x]` **Phase 4: Audit Economic Correctness**
  - `[x]` Constrain transaction volume by buyer wealth in `src/simulation/economy.ts`
  - `[x]` Enforce route capacity limits during allocation
  - `[x]` Transaction reconciliation: verify wealth conservation with transport drag as expense term
  - `[x]` Record transient reconciliation diagnostics (`__transientReconciliation`)
- `[x]` **Phase 5: Verify Causal Ancestry Honestly**
  - `[x]` Record suppression parent event IDs in `src/simulation/transport.ts`
  - `[x]` Implement `traceCausalAncestry` in `src/core/causality.ts`
  - `[x]` Add negative test asserting unresolved status for unconnected differences
- `[x]` **Phase 6: Real-Browser Verification** (REAL-BROWSER VERIFIED — headless Chromium)
  - `[x]` Create Playwright acceptance test in `tests/e2e/e2e.spec.ts`
  - `[x]` Install `@playwright/test` + Chromium; add `playwright.config.ts` with auto Vite server and `test:e2e` script
  - `[x]` Run real-browser E2E suite (5 tests pass): WebGL init, terrain/rivers/settlements/roads/bridge render, camera, resize, overlays, play/pause, timeline scrub, Inspector, politics, console/page errors
  - `[x]` Counterfactual suppression verified end-to-end via the real Worker (branch, progress, split-screen, comparison divider, suppressed-bridge Inspector)
- `[x]` **Phase 7 & 8: Web Worker** (worker branch path repaired — was broken by a double-simulation duplicate-event bug)
  - `[x]` ES-module Web Worker in `src/core/simulation.worker.ts` (no longer re-simulates the branch)
  - `[x]` Worker lifecycle hardened in `App.tsx`: request-id guard, prior-worker termination, unmount cleanup, error surface
- `[x]` **Phase 9: Performance Instrumentation** (REAL-BROWSER MEASURED — software WebGL / SwiftShader)
  - `[x]` Recorded politics-active FPS (~9), avg/worst frame time (~112/~168 ms), draw calls (141), triangles (32,432), heap (~905 MB), baseline sim time (~107 s), bundle sizes. Software-rendering figures; 60 FPS not claimed. GPU/leak profiling remains unverified.
- `[x]` **Phase 10 & 11: Clean Repository and Correct Documentation**
  - `[x]` Move diagnostics out of `src/` to `scripts/`
  - `[x]` Create and polish `task.md` and `walkthrough.md` in the project root
- `[x]` **Phase 12: Ledger Integrity, Unique Event IDs, and Causal Proofs**
  - `[x]` Throw error on duplicate causal event ID in `CausalLedger.addEvent`
  - `[x]` Prevent event ID collisions by making econ, bridge, and tax events counterparty-specific
  - `[x]` Make causal ancestry tracing branch-aware and field-specific in `traceCausalAncestry`
    - `[x]` Delta comparison for causal event effects (compare after−before, not absolute values)
    - `[x]` Cycle detection via DFS with visiting/visited states
    - `[x]` Chronology violation detection (parent.year > child.year)
    - `[x]` Missing intervention ID returns unresolved without throwing
  - `[x]` Dynamic residual-capacity routing via Dijkstra (skip zero-residual edges, re-route dynamically)
  - `[x]` Semantic infrastructure-parent lookup by exact entity ID (no prefix matching)
  - `[x]` Add exhaustive assertions verifying 5-stage chronological signature causal chain
  - `[x]` Verify transaction reconciliation: buyer/seller wealth conservation with transport drag
  - `[x]` Remove seed-based suppression (no `state.seed === "suppressed"` magic)
- `[x]` **Phase 13: Final Adversarial Audit repairs** (see `docs/FINAL_ADVERSARIAL_AUDIT.md`)
  - `[x]` C1: Web Worker branch path no longer double-simulates (fixed duplicate-event crash in the real browser)
  - `[x]` C2: off-network annual transport capacity is bounded, consumed, direction-independent, and resets per year (`capacityKeys`)
  - `[x]` C3: semantic branch-stable event correlation (`correlationKey`, pair-scoped ordinal) replaces the global `tradeCounter`
  - `[x]` C4: worker stale-response rejection, prior-worker termination, and unmount cleanup
  - `[x]` H1: symmetric, order-independent causal event comparison (sets, conditions, observations, all effects, year)
  - `[x]` H2: MapViewer no longer re-initializes the renderer on swipe/branch changes
  - `[x]` H4: taxation booked into per-settlement reconciliation and exercised naturally after the politics repair
  - `[x]` H5/H6: GitHub Actions CI + runnable Playwright suite
  - `[x]` M1: exhaustive-deps lint warning removed (0 errors, 0 warnings)
  - `[x]` Added adversarial unit coverage + 5 real-browser tests
  - `[deferred]` M7: bundle code-splitting (out of scope)
- `[x]` **Phase 14: Activate and validate the existing politics subsystem**
  - `[x]` Bootstrap Year-0 settlements before deterministic government creation; retry initialization only until its two-settlement prerequisite exists
  - `[x]` Keep ordinary annual politics single-run and government founding nonduplicating
  - `[x]` Produce finite, correctly sized, nonuniform political-control fields and valid standard-simulation capitals
  - `[x]` Reconcile taxation reductions exactly to treasury increases, including at and below the existing 100-wealth floor
  - `[x]` Relocate invalid capitals from the previous valid control field; leave the capital unchanged when no eligible replacement exists
  - `[x]` Preserve deterministic hashes, snapshot replay, Year-0 branching, and exact post-bootstrap branch prefixes
  - `[x]` Verify real Worker state and non-neutral Political rendering in focused Chromium coverage
  - `[x]` Leave wars, diplomacy, elections, timeline storage, Worker payloads, and the broader performance architecture untouched

## Legend

`[x]` implemented and verified at the stated level · `[deferred]` recorded, not done (rationale in the audit).

## Repository completion rule

Every project-work turn that changes repository files must finish by staging the intended changes, running applicable validation, committing with a descriptive message, pushing the active branch, and verifying that the local HEAD SHA matches the remote branch SHA. Read-only sessions do not create empty commits.
