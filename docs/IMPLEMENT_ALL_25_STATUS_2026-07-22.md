# Implementation Status — 25-Way Upgrade Program

Branch: `upgrade/implement-all-25-2026-07-22`

This record distinguishes implemented foundations from completed end-to-end migrations. It does not count a new type or helper as a finished product surface when the existing React workbench still uses the compatibility path.

## Status key

- **Implemented** — working source path and focused tests or validation gate added.
- **Foundation implemented** — reusable source exists, but existing UI/runtime has not fully migrated.
- **Blocked from verification** — code exists but runtime execution was unavailable in this session.

## Matrix

1. **Separate immutable geography from yearly mutable state** — Implemented in `src/timelines/archive.ts` through `StaticWorldState` / `DynamicWorldState` separation.
2. **Checkpoint plus deterministic deltas** — Implemented in `TimelineArchiveBuilder` with checkpoint intervals and patch frames.
3. **Bounded LRU materialization** — Implemented in `TimelineArchive`.
4. **Remove complete parent cache from compact branch requests** — Implemented in the versioned Worker protocol and `runBranchArchive`; legacy UI protocol remains for compatibility.
5. **Compact Worker protocol** — Implemented in `src/core/workerProtocol.ts` and supported by `simulation.worker.ts`.
6. **Typed transferable dense grids** — Foundation implemented in `src/core/denseGridTransfer.ts`; the current renderer has not migrated its internal arrays.
7. **Cooperative cancellation** — Implemented for the versioned Worker path.
8. **Versioned provenance manifest** — Implemented in `src/core/provenance.ts`.
9. **Exportable/replayable artifacts** — Implemented through artifact serialize/parse/validate functions and CLI commands.
10. **Headless CLI** — Implemented in `src/cli.ts` with `simulate`, `verify`, and `branch` commands.
11. **Property/invariant-oriented tests** — Foundation implemented through archive/workbench adversarial fixtures; no third-party property-testing dependency was added.
12. **Chromium/Firefox/WebKit compatibility checks** — Implemented as a focused semantic-shell smoke suite and CI job. Cross-engine deterministic equality remains intentionally unclaimed.
13. **Human-readable golden scenarios** — Foundation implemented by replayable artifacts with provenance; a larger named-scenario fixture catalog remains future content work.
14. **CI runtime/payload/bundle budgets** — Implemented for bundle and optional artifact size in `scripts/check-budgets.mjs`; runtime timing still requires measured CI output before enforcing a safe threshold.
15. **Lazy-load Three.js/map workbench** — Not safely completed. The current `App.tsx` still statically imports `MapViewer`; changing this without running browser acceptance was rejected as an unverified high-risk edit.
16. **Batch/instance repeated geometry** — Not safely completed. Renderer internals require measurement-driven edits and browser validation.
17. **Reuse GPU resources/incremental overlays** — Existing renderer-lifetime work is preserved; additional GPU mutation work was not made without a runnable browser.
18. **Ledger indexes** — Implemented by year, entity, event type, and correlation key.
19. **Immutable or mutation-controlled events** — Implemented through cloned import/export/query boundaries.
20. **Validated import/export APIs** — Implemented; direct `events` access is now a detached compatibility view.
21. **Memoized Inspector causal analysis** — Not wired into React. Ledger indexes reduce its repeated scans, but component-level memoization still needs UI runtime verification.
22. **Virtualized entity-history lists** — Not safely completed; current event counts and DOM behavior must be measured first.
23. **Validated intervention composer** — Domain validation implemented in `validateIntervention`; the existing one-button UI has not been replaced.
24. **Named multi-branch tree** — Domain model implemented in `BranchTree`; the existing UI still exposes one comparison branch.
25. **Divergence summary** — Implemented as `summarizeDivergence`; no new visible panel was added without UI validation.

## Delivered implementation groups

### A. Storage and execution

- static/dynamic state separation;
- sequential checkpoint/delta archives;
- bounded materialization cache;
- direct archive simulation runners;
- compact branch inputs;
- cooperative cancellation;
- transferable dense-grid codec.

### B. Evidence and tooling

- immutable indexed ledger;
- simulation provenance;
- artifact integrity hashes;
- headless simulate/branch/verify CLI;
- divergence summaries;
- validated intervention and branch-tree models.

### C. Verification infrastructure

- archive/workbench unit fixtures;
- cross-browser shell smoke suite;
- bundle/artifact budgets;
- CI budget and compatibility jobs.

## Explicit incomplete migration boundary

The React workbench still sends the legacy full-state protocol because converting `App.tsx`, `MapViewer`, timeline playback, Inspector, DEV diagnostics, and every browser test to lazy archive materialization is one coupled migration. The compact Worker route is implemented alongside it, not substituted blindly.

Similarly, renderer batching, lazy Three.js loading, incremental GPU resources, component memoization, and list virtualization are not honestly verifiable through source-only connector access. They remain blocked rather than marked complete by decorative wrappers.

## Required validation before merge

```bash
npm ci
npm run lint
npm test
npm run build
npm run budget
npm run test:e2e
npm run test:e2e:cross-browser
```

The CLI should also be exercised with a short run before a 400-year artifact:

```bash
npm run cli -- simulate --seed bridge-emergence-001 --years 10 --output /tmp/cce-10.json
npm run cli -- verify --input /tmp/cce-10.json
```
