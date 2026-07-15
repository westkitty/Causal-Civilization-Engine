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
  - `[x]` Reconcile wealth changes exactly, tracking transport expense as drag/consumption
  - `[x]` Record transient reconciliation diagnostics (`__transientReconciliation`)
- `[x]` **Phase 5: Verify Causal Ancestry Honestly**
  - `[x]` Record suppression parent event IDs in `src/simulation/transport.ts`
  - `[x]` Implement `traceCausalAncestry` in `src/ui/Inspector.tsx`
  - `[x]` Add negative test asserting unresolved status for unconnected differences
- `[x]` **Phase 6: Real-Browser Verification**
  - `[x]` Create Playwright acceptance test in `tests/e2e/e2e.spec.ts`
  - `[x]` Run real-browser E2E suite (unverified on agent sandbox, code prepared for local execution)
- `[x]` **Phase 7 & 8: Move Simulation to Web Worker**
  - `[x]` Measure main-thread blocking of simulation
  - `[x]` Implement ES-module Web Worker in `src/core/simulation.worker.ts`
  - `[x]` Integrate Worker thread with React `App.tsx` and fallback to synchronous mode in Node/JSDOM
- `[x]` **Phase 9: Performance Instrumentation**
  - `[x]` Record bundles, render times, frames, draw calls, triangles, and heap metrics
- `[x]` **Phase 10 & 11: Clean Repository and Correct Documentation**
  - `[x]` Move diagnostics out of `src/` to `scripts/`
  - `[x]` Create and polish `task.md` and `walkthrough.md` in the project root
- `[x]` **Phase 12: Ledger Integrity, Unique Event IDs, and Causal Proofs**
  - `[x]` Throw error on duplicate causal event ID in `CausalLedger.addEvent`
  - `[x]` Prevent event ID collisions by making econ, bridge, and tax events counterparty-specific
  - `[x]` Make causal ancestry tracing branch-aware and field-specific in `traceCausalAncestry`
  - `[x]` Implement Dijkstra road capacity skipping to allow routing around capacity bottlenecks
  - `[x]` Add exhaustive assertions verifying 5-stage chronological signature causal chain
  - `[x]` Verify buyer/seller wealth changes and transport drag double-entry math conservation

## Repository completion rule

Every project-work turn that changes repository files must finish by staging the intended changes, running applicable validation, committing with a descriptive message, pushing the active branch, and verifying that the local HEAD SHA matches the remote branch SHA. Read-only sessions do not create empty commits.
