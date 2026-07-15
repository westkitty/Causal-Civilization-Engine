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
- `[ ]` **Phase 6: Real-Browser Verification**
  - `[x]` Create Playwright acceptance test in `tests/e2e/e2e.spec.ts`
  - `[ ]` Run real-browser E2E suite (code prepared, execution unverified)
- `[x]` **Phase 7 & 8: Move Simulation to Web Worker**
  - `[x]` Measure main-thread blocking of simulation
  - `[x]` Implement ES-module Web Worker in `src/core/simulation.worker.ts`
  - `[x]` Integrate Worker thread with React `App.tsx` and fallback to synchronous mode in Node/JSDOM
- `[ ]` **Phase 9: Performance Instrumentation**
  - `[ ]` Record bundles, render times, frames, draw calls, triangles, and heap metrics (unverified against live rendering)
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

## Repository completion rule

Every project-work turn that changes repository files must finish by staging the intended changes, running applicable validation, committing with a descriptive message, pushing the active branch, and verifying that the local HEAD SHA matches the remote branch SHA. Read-only sessions do not create empty commits.
