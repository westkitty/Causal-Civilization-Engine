# Adversarial Upgrade — 2026-07-22

## Verdict

The Causal Civilization Engine has unusually strong correctness evidence for a prototype, but its architecture still pays prototype-scale costs for every serious run. The simulation kernel and causal ledger are more trustworthy than the storage, transport, and analysis surfaces around them. The next phase should therefore prioritize **state-volume reduction, query indexing, reproducible artifacts, and generalized counterfactual workflows** rather than adding decorative mechanics.

This pass deliberately does not repeat findings already closed by `docs/FINAL_ADVERSARIAL_AUDIT.md`.

## Capability and scope record

- Repository inspected through the connected GitHub API.
- Direct shell clone and local command execution were blocked because the execution environment could not resolve `github.com`.
- Changes were made only on `upgrade/adversarial-25-2026-07-22`; `main` was not modified.
- No dependencies, migrations, releases, merges, or destructive actions were performed.
- Validation status is source-reviewed but not runtime-verified in this environment. CI did not start for the branch commits at the time of inspection.

## Implemented cohesive change group

### Ledger correctness and hot-path hardening

1. Cache chronological ledger ordering rather than sorting the complete event set on every query.
2. Add deterministic `eventId` tie-breaking for events in the same year.
3. Invalidate the ordering cache whenever events are appended or replaced.
4. Replace `Array.shift()` ancestry traversal with a cursor-based linear queue.
5. Reuse ordered ledger results for entity-history queries.
6. Replace JSON cloning with `structuredClone` for ledger copies.
7. Make entity diffs include deleted fields, not only fields present in the resulting object.
8. Replace `any` inputs in `diffEntity` with `unknown` and narrow them before access.
9. Add focused tests for ordering, cache invalidation, ancestry, cloning, and add/change/delete deltas.

Commits:

- `4858469e9e87033ca4b67a6c036bb3fc5c8f3bc3` — ledger implementation
- `442a0374b955036d870433f397283901c4dfdda6` — regression tests

## Twenty-five new improvements

The list is ranked by leverage, not novelty theater.

| # | Improvement | Why it matters | Priority | Disposition |
|---|---|---|---|---|
| 1 | Separate immutable geography from dynamic yearly state | Terrain and resource arrays are duplicated across hundreds of cached years even though most are invariant. | Critical leverage | Next architecture group |
| 2 | Replace full-year state clones with checkpoints plus deterministic deltas | The current 401-state cache is the central memory cost and makes every branch expensive. | Critical leverage | Next architecture group |
| 3 | Materialize years on demand behind a bounded LRU cache | Users rarely inspect all 401 years simultaneously; memory should follow active inspection. | High | Merge with #2 |
| 4 | Stop posting the entire parent state cache to branch Workers | Structured-cloning hundreds of world states duplicates memory and stalls branch startup. | High | Next architecture group |
| 5 | Define a compact Worker protocol with snapshots, hashes, intervention, and requested years | Makes branch execution explicit, testable, and independent of UI-owned caches. | High | Merge with #4 |
| 6 | Store dense numeric grids in typed arrays and use transferables where ownership permits | Reduces heap overhead and Worker copy cost while preserving deterministic numeric representation. | High | Deferred design spike |
| 7 | Add cooperative cancellation checkpoints inside long simulation loops | `terminate()` stops a Worker bluntly; cooperative cancellation can release partial resources and report a truthful cancelled state. | Medium | Deferred |
| 8 | Introduce a versioned simulation-run manifest | Every result should record seed, engine/schema version, dimensions, end year, interventions, and hash policy. | High | Small follow-up |
| 9 | Add export/import for reproducible baseline and branch artifacts | Counterfactual findings should survive a browser session and be independently replayable. | High product value | Deferred feature group |
| 10 | Add a headless CLI for baseline, branch, hash, and performance runs | CI and researchers need the engine without React, WebGL, or browser orchestration. | High | Deferred feature group |
| 11 | Build property-based tests for ledger and branch invariants | Handwritten scenarios cannot cover malformed graphs, ordering permutations, and unusual delta combinations exhaustively. | High correctness | Deferred test group |
| 12 | Run a browser-engine determinism matrix without overclaiming equality | Chromium-only evidence cannot establish behavior in Firefox or WebKit; differences should be measured and classified. | Medium | Deferred CI group |
| 13 | Maintain golden semantic scenarios alongside raw hashes | Hashes detect change but do not explain whether change is acceptable; golden events and metrics provide interpretable contracts. | High | Deferred test group |
| 14 | Add enforceable CI budgets for bundle size, simulation duration, and retained payload size | Performance regressions currently become prose after the fact instead of failing near their source. | High | Deferred CI group |
| 15 | Lazy-load Three.js and the map workbench | The simulation shell should not pay the full renderer bundle before it is needed. | Medium | Deferred performance group |
| 16 | Use instancing or merged geometry for repeated map entities | Draw calls remain unnecessarily high for repeated settlements, routes, and markers. | Medium | Deferred rendering group |
| 17 | Update overlay textures incrementally and reuse GPU resources | Overlay switching should not rebuild data that did not change. | Medium | Deferred rendering group |
| 18 | Add ledger indexes by year, entity, event type, and correlation key | Repeated full-ledger scans remain in causal analysis and Inspector workflows. | High | Partially implemented; next ledger group |
| 19 | Make stored events immutable or mutation-controlled | A cached ordered view is only safe when callers cannot mutate event identity or time behind its back. | High correctness | Next ledger group |
| 20 | Replace the public mutable `events` record with explicit import/export APIs | Direct assignment is convenient but bypasses validation, branch normalization, and future indexes. | High maintainability | Next ledger group |
| 21 | Memoize Inspector causal analysis by branch, year, entity, and field | The current Inspector recomputes ledger-backed analysis during unrelated renders. | Medium | Deferred UI performance group |
| 22 | Virtualize long historical-event lists | Large ledgers should not produce equally large DOM trees when one entity has extensive history. | Medium | Deferred UI performance group |
| 23 | Replace the single hard-coded bridge action with a validated intervention composer | The engine claims counterfactual resimulation, but the product surface demonstrates one scripted counterfactual. | High product value | Deferred feature group |
| 24 | Support a named branch tree rather than one baseline and one counterfactual | Comparative causal work requires multiple sibling hypotheses, provenance, and branch deletion/export. | High product value | Deferred feature group |
| 25 | Add a divergence summary surface | Users need earliest divergence, affected systems/entities, magnitude, confidence, and unresolved ancestry before inspecting individual objects. | High product value | Deferred feature group |

## Adversarial objections to the program

- **Do not implement all 25 at once.** The state-storage redesign changes the dominant memory model and should land before broad feature expansion.
- **Do not add a database merely because the ledger is large.** In-memory indexes and compact serialized artifacts are the smaller credible step.
- **Do not claim cross-engine determinism as a goal until measured.** The correct deliverable is a compatibility classification, not forced equality at any cost.
- **Do not generalize interventions before provenance exists.** A flexible editor without versioned manifests creates irreproducible histories.
- **Do not optimize rendering before separating static and dynamic state.** The largest verified cost is data volume, not merely triangles.

## Recommended next frozen scope

1. Split static world data from dynamic state.
2. Introduce checkpoint-plus-delta storage with an on-demand materializer.
3. Replace the branch Worker payload with the compact protocol built on that storage model.

Acceptance criteria:

- Exact tested-runtime hashes remain unchanged for the standard baseline and branch fixtures.
- A requested year materializes to a state deeply equal to the current full-cache implementation.
- The UI can scrub all years without retaining all materialized states.
- Branch execution no longer receives `parentCachedStates` containing every year.
- Peak retained JS heap and serialized Worker payload are measured before and after.
- Existing lint, Vitest, build, and Playwright acceptance checks pass.

## Validation record

Runtime validation was blocked in this environment because the repository could not be cloned and no CI run was attached to the branch commits. The changes are therefore **implemented and source-reviewed, not runtime-verified**. The new tests are committed but must be executed before merge.
