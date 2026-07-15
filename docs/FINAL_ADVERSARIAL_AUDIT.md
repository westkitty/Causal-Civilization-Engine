# Final Adversarial Audit — Causal Civilization Engine

Auditor: senior engineer / adversarial reviewer (Claude Code, Opus 4.8).
Starting commit: `962dac8c70a8e162ef671eb31f9bb9b9d709eb52` (branch `main`).
Remote: `git@github.com:westkitty/Causal-Civilization-Engine.git`.

This document is durable. Findings are **not** erased after fixes; each finding
carries a final status and the commit that resolved it. Amendments discovered
during the resweep are appended in the "Adversarial Resweep" section, not by
rewriting the original findings.

---

## Phase 0 — Ground truth (recorded verbatim)

- Active branch: `main`; `origin` points at the correct remote.
- Starting SHA matched the expected `962dac8…` exactly. Working tree clean; no
  uncommitted files; `task.md` / `walkthrough.md` unmodified since last push.
- `dist/` exists on disk but is **git-ignored and untracked** (not committed).
- No `.github/` → **no CI**.
- Playwright **not installed** (`@playwright/test` absent from `package.json`,
  no browsers, no `playwright.config.ts`, no `test:e2e` script), yet
  `tests/e2e/e2e.spec.ts` exists → prepared-but-unexecuted.
- `scripts/scratch_debug.ts` is a committed scratch/diagnostic file.
- Scripts present: `dev`, `build` (`tsc -b && vite build`), `lint` (`oxlint`),
  `preview`, `test` (`vitest run`). No `test:e2e`, no diagnostics script.

### Baseline results (before any change)

| Check | Command | Result |
|-------|---------|--------|
| Lint  | `npm run lint` | **1 warning**, 0 errors — `react-hooks(exhaustive-deps)` at `src/App.tsx:122` |
| Test  | `npm run test` | **20 passed** (2 files: `kernel.test.ts` 19, `ui.test.tsx` 1); ~68 s wall |
| Build | `npm run build` | success; `index-*.js` **815.36 kB** (gzip 219.13 kB), worker 41.35 kB, css 4.97 kB; chunk-size >500 kB warning |

The previous agent report was **not** treated as ground truth. Every claim was
re-derived from source and, where possible, from executed probes.

---

## Severity ranking of findings

Critical: C1–C4. High: H1–H6. Medium: M1–M7. Low: L1–L3.

### CRITICAL

---

**C1 — Web Worker `RUN_BRANCH` double-simulates and throws `Duplicate causal event ID` (counterfactual branch broken in the real browser).**
- Subsystem: worker / runner.
- File/function: `src/core/simulation.worker.ts` (`RUN_BRANCH` handler), `src/core/runner.ts` (`resimulateBranch`).
- Evidence: `resimulateBranch(...)` already simulates the branch `insertionYear…endYear`, fully populating `subLedger`. The worker then **re-runs** `simulateYear(startState, subLedger, subBranch, y)` for `y = insertionYear…endYear` on the *same* `subLedger`. Empirically confirmed with a probe: the second pass throws `Duplicate causal event ID …`.
- Why insufficient: unit/UI tests never spawn a real `Worker` (jsdom/Node lack `Worker`), so the synchronous fallback is exercised and this path is untested. In a real browser the "Suppress Bridge Construction" feature posts `ERROR` and silently does nothing.
- Root cause: the worker both delegates the whole run to `resimulateBranch` **and** re-simulates the forward span, duplicating every event.
- Failure scenario: user clicks "Suppress Bridge Construction" in the browser → worker throws → no branch, no comparison, headline feature dead.
- Correction: worker no longer re-simulates. `resimulateBranch` now optionally records a per-year `cachedStates` map and returns it; the worker consumes `result.cachedStates` directly. Progress is reported from inside `resimulateBranch` via an `onProgress` callback.
- Validation: new worker-parity unit test (sync path == what worker returns); real-browser Playwright suppression test.
- Status: **FIXED** — commit `343ab83`.
- Residual risk: none identified; deterministic parity asserted.

---

**C2 — Off-network transport capacity is a constant and is never consumed (unbounded annual reuse; no direction sharing).**
- Subsystem: economy / transport.
- File/function: `src/simulation/economy.ts` `resolveTransportPath` (off-network branch) + `updateEconomy` allocation loop.
- Evidence: off-network paths returned `residualCapacity: 10` (a literal). The allocation loop only recorded `usedCapacity` for `mode === "network"`. Every while-iteration re-resolved the same off-network pair with a fresh `10`, so the annual off-network limit reset every iteration.
- Why insufficient: no test drove repeated same-year off-network allocations or opposite-direction sharing.
- Root cause: off-network paths had no stable capacity identity and no consumption bookkeeping.
- Failure scenario: two settlements not on the road network trade unlimited volume each year through a corridor that should be capacity-bounded; opposite directions double-count.
- Correction: added `capacityKeys: string[]` to `ResolvedTransportPath`. Network paths key on route edge IDs; off-network paths key on a **direction-independent** `offnet:<loId>:<hiId>:<canonicalCorridorHash>` (unordered settlement pair + canonical corridor signature computed lo→hi, no randomness, no global counter). `updateEconomy` derives the per-key limit (`route.capacity` for edges, `OFFNET_ANNUAL_CAPACITY` for `offnet:` keys), consumes `usedCapacity` for **all** capacity keys of both modes, and never resets mid-loop. `usedCapacity` is a per-year map (fresh each `updateEconomy`).
- Validation: new tests — annual limit enforced, no mid-year reset, opposite-direction sharing, fresh next-year capacity, network rerouting intact, cross-goods capacity.
- Status: **FIXED** — commit `343ab83`.
- Residual risk: canonical corridor recompute adds one A* call per off-network pair (bounded by the `distCells > 25` gate).

---

**C3 — Cross-branch event correlation depends on a mutable global per-good `tradeCounter` embedded in event IDs.**
- Subsystem: economy / causality.
- File/function: `src/simulation/economy.ts` (trade event IDs) + `src/core/causality.ts` (`eventsDiffer` uses `ledgerA.getEvent(evB.eventId)`).
- Evidence: trade/path/wealth event IDs ended in `_${tradeCounter}`, a counter reset per `(good, year)` and incremented per allocation across **all** pairs. An unrelated earlier trade in one branch shifts the focal trade's counter → different raw ID → `ledgerA.getEvent(evB.eventId)` misses → focal event wrongly treated as causally changed.
- Why insufficient: the existing 5-stage test happened to align counters, masking the coupling.
- Root cause: identity conflated a global allocation ordinal with semantic identity.
- Failure scenario: inject a benign earlier trade into the counterfactual; every downstream focal trade is mis-flagged as diverged.
- Correction: trade allocations now carry a **pair-scoped** ordinal (`pairKey = seller:buyer:good`, counted per pair) used both in the event ID and in an explicit `correlationKey`. Added `getEventCorrelationKey`, `findCorrelatedEvent`, `aggregateTradeMechanism`, `buildTransportPathSignature`. `eventsDiffer` now correlates by `correlationKey` (falling back to `eventId` for stable-ID events).
- Validation: new regression — unrelated earlier trade + shifted raw IDs, identical focal mechanism ⇒ focal not treated as changed.
- Status: **FIXED** — commit `343ab83`.
- Residual risk: none identified.

---

**C4 — Worker responses have no request-ID validation, prior workers are not terminated, and there is no unmount cleanup (stale/superseded results overwrite newer state; setState after unmount).**
- Subsystem: React / worker lifecycle.
- File/function: `src/App.tsx` (`runSimulationA`, `triggerIntervention`, effects).
- Evidence: each run spawned a fresh `Worker`, attached `onmessage`, and terminated only on that message. A `requestId` was generated and posted but never checked on receipt. Rapid seed changes spawn concurrent workers; whichever `COMPLETE` fires last wins even if stale. No cleanup terminates the worker on unmount → `setState` after unmount.
- Why insufficient: jsdom has no `Worker`; the path is untested.
- Root cause: fire-and-forget worker with no latest-request tracking / cancellation / mount guard.
- Failure scenario: type seed "a" then "b" quickly → worker(a) finishes after worker(b) → stale baseline overwrites the new one.
- Correction: `App` tracks a monotonically increasing `latestRequestIdRef`, an `activeWorkerRef`, and a `mountedRef`. Each new run increments the id, terminates the previous worker, and ignores any message whose `requestId` ≠ latest. Effects return cleanup that terminates the active worker; a mount guard blocks `setState` after unmount. Seed/branch changes cancel in-flight work.
- Validation: reducer-style unit test for the stale-guard predicate; real-browser rapid-seed-change test.
- Status: **FIXED** — commit `343ab83` (guard) / `045d7a8` (browser test).
- Residual risk: none identified.

### HIGH

---

**H1 — Causal event comparison is asymmetric and order-sensitive.**
- Subsystem: causality.
- File/function: `src/core/causality.ts` `eventsDiffer`.
- Evidence: set-like arrays (`parentEventIds`, `actorIds`, `affectedEntityIds`) compared via `.join(",")` (order-sensitive); only the **first** matching `immediateEffect` compared (`.find`); conditions compared only from B's side, matched by first predicate type, ignoring `result`, `role`, `sourceSystem`, `uncertainty`, `threshold`, and conditions present only in A; observations not compared symmetrically; event `year` not compared.
- Why insufficient: adversarial fixtures for reordered sets, extra conditions/observations, repeated predicate types, and multiple matching effects were absent.
- Root cause: ad-hoc field-by-field comparison instead of normalized structural comparison.
- Correction: rewrote comparison around normalized structures — sorted copies of set-like arrays; symmetric key-union comparison of conditions keyed by `(predicateType, conditionId)` including all scalar attributes and symmetric observation comparison; **all** matching immediate effects compared (normalized numeric deltas); event `year` compared.
- Validation: nine new adversarial fixtures (reordered sets, extra condition either side, extra observation either side, repeated predicate types, multiple matching effects, shifted year, same-delta-different-baseline, identical mechanism/different raw ID, different mechanism/correlated identity).
- Status: **FIXED** — commit `343ab83`.
- Residual risk: none identified.

---

**H2 — `MapViewer` tears down and recreates the entire WebGL renderer, scenes, camera, controls, and animation loop on every swipe-slider tick and branch change.**
- Subsystem: rendering.
- File/function: `src/rendering/MapViewer.tsx` main `useEffect` deps `[comparisonMode, swipePosition, onSelectEntity, stateB]`.
- Evidence: dragging the comparison swipe (`swipePosition`) or creating a branch (`stateB`) re-runs the init effect → new `WebGLRenderer`, new `OrbitControls` (camera resets), new `requestAnimationFrame` loop.
- Why insufficient: jsdom mocks Three.js; no real-browser test observed camera persistence or GPU churn.
- Root cause: transient view state used as init-effect dependencies.
- Failure scenario: user drags the divider → camera jumps back to default, terrain flickers, GPU re-uploads all geometry each frame of the drag.
- Correction: init effect now runs once on mount; `comparisonMode`, `swipePosition`, and `stateB` are read through refs inside the animation loop and click handler. Resize and disposal preserved.
- Validation: real-browser test — drag divider then assert canvas size unchanged and no re-init; camera-control response test.
- Status: **FIXED** — commit `343ab83`.
- Residual risk: none identified.

---

**H4 — Tax wealth reductions are not booked into per-settlement reconciliation, so full-year wealth reconciliation does not balance.**
- Subsystem: economy / politics.
- File/function: `src/simulation/politics.ts` (taxation) vs `__transientReconciliation`.
- Evidence: every other wealth mutation books into `__transientReconciliation` (`exportRevenue`, `importExpense`, `transportExpense`, `naturalGrowth`, `investment`, `losses`), but tax (`s.wealth = Math.max(100, s.wealth - tax)`) increments only `taxCollected`, never `taxesPaid`.
- Why insufficient: the only reconciliation test checked per-trade conservation, never the full-year settlement identity.
- Root cause: missing booking line.
- Failure scenario: in any taxation year (`year % 5 === 0`) a controlled settlement's `wealthBefore + credits − debits ≠ wealthAfter`.
- Correction: book `s.__transientReconciliation.taxesPaid += (beforeWealth − s.wealth)`. Added (a) a full-year, per-settlement reconciliation test over the real simulation asserting `wealthBefore + exportRevenue + productionIncome + naturalGrowth − importExpense − transportExpense − investment − losses − taxesPaid == wealthAfter` for every settlement that existed at the start of the year, and (b) a **direct** `updatePolitics` taxation test that pre-creates a government and asserts the tax booking reconciles.
- Note: during validation I discovered taxation **never fires in the full simulation for any tested seed** because the politics subsystem is dead (see **M8**). The booking fix is therefore currently unreached in the full run but is correct and directly unit-tested; it prevents a latent reconciliation break if politics is ever activated.
- Status: **FIXED (defensive, directly unit-tested)** — commit `343ab83`.
- Residual risk: settlements founded mid-year have no reconciliation record for that year (by construction) and are excluded from the full-sim assertion; documented.

---

**H5 — No continuous integration.**
- Subsystem: repository.
- Evidence: no `.github/workflows`.
- Correction: added `.github/workflows/ci.yml` running on push/PR — `npm ci`, lint, unit/UI tests, production build, and Playwright Chromium E2E, uploading failure artifacts.
- Status: **FIXED** — commit `045d7a8`. CI run status reported in the final report (pending vs passed).
- Residual risk: first run may be queued at session end → reported as pending, not "CI verified".

---

**H6 — Playwright E2E prepared but not runnable (no dependency, config, or script).**
- Subsystem: testing.
- Correction: added `@playwright/test` (dev), `playwright.config.ts` with an auto-started Vite `webServer`, and a `test:e2e` script; rewrote `tests/e2e/e2e.spec.ts` into a real acceptance suite that inspects WebGL, rendered content, interactions, and console/page errors. Artifacts land under git-ignored `test-results/` / `playwright-report/`.
- Status: **FIXED** — commit `045d7a8`. Execution result in the final report.
- Residual risk: browser download may be blocked in restricted environments → reported honestly as an external blocker if so.

### MEDIUM

---

**M1 — `exhaustive-deps` lint warning at `App.tsx:122`.**
- Correction: `runSimulationA` wrapped in `useCallback([seed])`; the effect depends on `[runSimulationA]`. Root lifecycle issue (stale closure over `seed`) removed rather than suppressed.
- Status: **FIXED** — commit `343ab83`. Final lint: 0 errors, 0 warnings.

---

**M2 — Causal path reconstruction/focal selection determinism.**
- File: `src/core/causality.ts` (BFS `cameFrom`, focal ordering).
- Evidence: focal events and BFS seeding depended on `getAllEvents()` ordering; multiple focal events / multiple paths could select non-deterministically.
- Correction: focal events sorted deterministically (year, then eventId); BFS seeded in that order; path reconstruction reproducible. Every adjacent pair asserted to be a genuine parent edge.
- Status: **FIXED** — commit `343ab83`.

---

**M3 — Documentation calls reconciliation "double-entry accounting"; walkthrough carries stale event IDs / numbers.**
- Correction: replaced with "transaction reconciliation" across `README.md`, `walkthrough.md`, comments, and tests; refreshed the 5-stage diagnostic block with re-generated values; corrected test/bundle/timing figures.
- Status: **FIXED** — the documentation commit (below).

---

**M4 — README "Verified Capabilities" overclaims (worker progress, Inspector tracing listed as verified though the worker branch path was broken and browser was unverified).**
- Correction: reclassified every claim as IMPLEMENTED / UNIT-TEST VERIFIED / REAL-BROWSER VERIFIED / CI VERIFIED / UNVERIFIED / OUT OF SCOPE; narrowed the determinism claim to the tested JS runtime.
- Status: **FIXED** — the documentation commit (below).

---

**M5 — `scripts/scratch_debug.ts` committed scratch file.**
- Correction: removed the scratch file. `scripts/counterfactual_runner.ts` retained as a genuine diagnostic.
- Status: **FIXED** — commit `343ab83`.

---

**M6 — `resimulateBranch` / branch snapshots use `JSON.parse(JSON.stringify(state))` (loses `-0`/`NaN`/`Infinity`) inconsistently with `cloneState` (`structuredClone`).**
- Evidence: state values are currently all finite, so determinism holds today, but the two clone paths differ.
- Correction: state clones in `resimulateBranch` and `Branch.saveSnapshot` use `cloneState`/`structuredClone` for consistency; ledger-event clones remain JSON (plain data).
- Status: **FIXED** — commit `343ab83`.
- Residual risk: low; behavior-preserving.

---

**M7 — Production bundle >500 kB (Three.js), single chunk.**
- Assessment: dominated by Three.js. Code-splitting is a refactor explicitly out of scope for this task.
- Status: **DEFERRED (documented)**. Measured sizes recorded in the performance section.

---

**M8 — Historical finding: politics did not activate; governments were never created, so control fields, taxation, and capital succession were dead (discovered during implementation).**
- Subsystem: politics / scheduler.
- File/function: `src/core/scheduler.ts` (system order) + `src/simulation/politics.ts` (`year === 0 && … sIds.length >= 2` government-creation guard) + `src/simulation/settlement.ts`.
- Evidence: `updatePolitics` runs at step 6 but `updateSettlement` (which creates the initial settlements) runs at step 8, so at `year === 0` there are **zero** settlements when politics runs; the creation guard fails and governments are never created on any later year. Probe over 80 years: `governments = {}`, `politicalControl = {}`, zero taxation events.
- Why insufficient: no test asserted governments exist; the politics overlay silently renders uniform neutral.
- Root cause: system ordering at year 0 (politics before settlement) combined with a year-0-only creation guard.
- Failure scenario: taxation, control-field borders, and capital relocation never occur; the "politics" overlay is meaningless.
- Assessment / decision: **NOT fixed by design.** The task constraints explicitly forbid adding or altering political-simulation systems, and enabling this subsystem would change simulation rules and every downstream hash broadly (control-field Dijkstra per government per year on a 125×125 grid also has performance implications). It is **not** part of the core definition of done (causal/economic/transport/worker/UI). Recorded honestly rather than silently "fixed".
- Status: **DEFERRED (documented; out of scope per constraints).** The H4 tax-booking fix remains as defensive correctness so that activating politics later would not break reconciliation.
- Residual risk: the politics overlay and any politics-dependent narration are non-functional; documented in README/walkthrough.
- 2026-07-15 amendment: this historical disposition was superseded by the bounded
  politics completion pass starting at `94acf387f57918fc44c22bf5e62608c22cc578c5`.
  The original finding is retained here; current correction and evidence are recorded
  in the appended resweep amendment below.

### LOW

- **L1** — `MapViewer` logs `[PERF DIAGNOSTICS]` every 300 frames. Gated behind `import.meta.env.DEV` so production/E2E consoles stay clean. **FIXED** — commit `343ab83`.
- **L2** — `Inspector` recomputes `traceCausalAncestry` every render. Acceptable (only while the panel is open). **DEFERRED (documented)**.
- **L3** — `CausalLedger.getAllEvents()` sorts on each call. Acceptable at current event counts. **DEFERRED (documented)**.

---

## Frozen work list (Phase 2)

Implement all Critical + High + M1–M6. Defer M7, L2, L3 with honest notes.
Order: (1) core kernel repairs C1–C3, H1, H4, M1, M2, M5, M6, L1, H2;
(2) worker lifecycle C4 + browser harness H6; (3) CI H5; (4) docs M3, M4.
No new gameplay systems, no framework migrations, no dependency upgrades beyond
adding Playwright.

---

## Causal-category audit notes (challenges applied)

- **Determinism/serialization**: `hashing.ts` handles exact Float64, `-0`, `NaN`,
  `±Infinity`, typed arrays, `Set`, `Map`, sorted keys, `__transient` exclusion —
  sound. Event IDs previously depended on a mutable counter (C3, fixed). Snapshot
  replay verified by existing tests + new parity test.
- **Branching/isolation**: pre-intervention prefix identity holds (test 4 + browser).
  C1 broke the *browser* branch path (fixed). Snapshot restore now uses
  `structuredClone` (M6).
- **Ledger integrity**: duplicate IDs rejected; cycles / chronology / missing
  parents detected; prefix-collision-safe infra lookup present. Correlation moved
  off raw IDs (C3).
- **Economy**: buyer affordability, route capacity, and now off-network capacity
  (C2) enforced; per-trade and full-year reconciliation balanced (H4). Transport
  drag is an expense **sink**, not a balanced account → "transaction
  reconciliation", not "double-entry" (M3).
- **Transport/pathfinding**: Dijkstra + residual capacity + off-network fallback;
  bridge/ruin/river handling covered by tests; off-network capacity now shared,
  bounded, and reset per year.
- **Worker/concurrency**: C1 (double-sim) and C4 (stale responses) fixed.
- **React lifecycle**: exhaustive-deps (M1), renderer re-init (H2) fixed.
- **Three.js/browser**: exercised by the new Playwright suite (WebGL, terrain,
  rivers, settlements, roads, bridge, suppression, camera, resize, timeline,
  inspector evidence, comparison divider, worker progress).
- **Tests**: hardened per above; no tautologies added; adversarial fixtures added.

## Claim classification (post-fix)

| Claim | Classification |
|-------|----------------|
| Exact Float64 hashing / identical-run repeatability (tested JS runtime) | UNIT-TEST VERIFIED |
| Cross-engine determinism | UNVERIFIED / OUT OF SCOPE |
| Transaction reconciliation (per-trade + full-year) | UNIT-TEST VERIFIED |
| Off-network + residual-capacity routing | UNIT-TEST VERIFIED |
| Branch-aware, field-specific, symmetric causal ancestry | UNIT-TEST VERIFIED |
| Worker progress + stale-response rejection | UNIT-TEST VERIFIED + REAL-BROWSER VERIFIED |
| WebGL init / terrain / bridge / suppression / interactions | REAL-BROWSER VERIFIED |
| Existing politics bootstrap / control / tax / succession | UNIT-TEST VERIFIED + REAL-BROWSER VERIFIED |
| GPU perf metrics (draw calls, FPS, heap) | REAL-BROWSER MEASURED (single run) |
| Memory-leak freedom | UNVERIFIED (bounded repeat check only) |
| CI non-interactive checks | CI VERIFIED / PENDING (see final report) |

See the "Adversarial Resweep" section for post-fix findings.

---

## Performance measurements (real browser)

Captured by the Playwright `captures real-browser performance measurements` test.

- Browser: headless Chromium (Playwright 1.61.1); **software WebGL via SwiftShader**
  (`--use-gl=angle --use-angle=swiftshader`), i.e. **no GPU acceleration**.
- OS: macOS (Darwin, Apple Silicon). Viewport / canvas: 1280×720.
- Shell render (title visible): ~0.9 s.
- Canvas visible / politics-active baseline 400-year simulation complete: ~107 s (Worker thread).
- FPS over a ~2 s interval: **~9 FPS**; average frame ~112 ms; worst frame ~168 ms.
- `renderer.info`: **141 draw calls, 32,432 triangles**, 0 lines, 0 points.
- JS heap: ~905 MB (400 cached per-year world states, including two active political-control fields).
- Bounded repeat check: 30 timeline scrubs → **0 MB** heap growth (not a leak proof).
- Bundle: `index-*.js` ~819 kB (gzip ~220 kB), worker ~42 kB, css ~5 kB.

These are software-rendering numbers; a real GPU will differ substantially. **60 FPS
is explicitly not claimed** (the low FPS is a SwiftShader artifact). The larger
politics-active cached state and yearly control propagation are included in the ~107 s
baseline; the deferred timeline-storage/Worker-payload redesign remains separate.

---

## Adversarial Resweep (after fixes)

The corrected repository was re-attacked along the required axes. Results:

- **Off-network annual capacity / opposite-direction sharing**: new tests drive
  repeated same-year off-network allocations (capped at the annual budget, no
  mid-year reset), opposite-direction sharing (grain A→B and timber B→A draw one
  shared budget = 10, not 20), fresh next-year capacity, and cross-goods network
  capacity. All hold.
- **Trade ordering / pair correlation / event-ID uniqueness**: injecting unrelated
  trades no longer perturbs a focal trade's `correlationKey`; `findCorrelatedEvent`
  matches across differing raw IDs; ledger still rejects duplicate raw IDs.
- **Semantic event matching / symmetric comparison**: nine adversarial fixtures
  (reordered sets, extra condition/observation either side, repeated predicate
  types, multiple matching effects, shifted year, same-delta-different-baseline,
  identical-mechanism-different-id, different-mechanism) all classify correctly.
- **Cycle / chronology / missing-intervention / multiple-paths**: existing negative
  tests still pass; focal ordering is now deterministic (year, then id).
- **Stale worker responses / rapid seed / repeated mount-unmount / timeline scrub
  during simulation / resize during rendering**: the request-id guard is unit-tested;
  the browser suite drives rapid seed change to a consistent end state, resize, and
  timeline scrub without errors; MapViewer no longer re-inits on swipe/branch.
- **Inspector evidence resolution / browser console cleanliness**: the browser suite
  opens the Inspector, renders ledger-backed ancestry, and asserts no serious console
  or page errors (only a benign `PCFSoftShadowMap` deprecation `console.warn`).
- **Snapshot replay / branch-prefix identity / route capacity across goods**: covered
  by existing kernel tests plus the new branch-parity test.

### New defects discovered during the resweep

- **M8 (Medium, historical disposition; superseded 2026-07-15)** — the politics
  subsystem was inert because `updatePolitics` ran before `updateSettlement` at Year 0.
  It was deliberately deferred during the original audit; the bounded completion pass
  and current evidence are recorded in the amendment below.
- **Browser-only test-selector issues** found and fixed while executing the suite
  (ambiguous `text=SUPPRESSED`, initial-load timeouts under CPU contention). These
  were test defects, not application defects; corrected in commit `045d7a8`.

No new Critical or High application defects survived the resweep.

### 2026-07-15 politics completion amendment

- **Ground truth**: branch `main`, expected starting SHA
  `94acf387f57918fc44c22bf5e62608c22cc578c5`, expected GitHub origin, clean tree.
  Baseline lint passed with no findings; 46/46 Vitest tests passed; build passed with
  the existing >500 kB Three.js chunk warning.
- **Confirmed M8 chain**: `updatePolitics` ran before Year-0 `updateSettlement`; the
  politics initializer required two active settlements and was guarded by `year === 0`.
  A fresh focused probe failed with `governments.length === 0`, matching the earlier
  80-year evidence. No alternate government creator exists.
- **Bootstrap correction**: scheduler-owned explicit bootstrap now creates initial
  settlements before `initializeGovernments`, which remains eligible to retry while no
  government exists and creates governments only once two active settlements exist.
  Ordinary annual politics still runs exactly once. Zero- and one-settlement fixtures remain government-free;
  repeated bootstrap calls do not duplicate founding events.
- **Government/control proof**: the standard seed creates `gov_a` and `gov_b`; each
  capital resolves to an active settlement. Every field has 15,625 finite entries and
  more than one distinct value. Identical politics-active runs match exact state,
  ledger, and per-year hashes.
- **Tax proof**: controlled fixtures produce a taxation event and linked settlement
  wealth events. Total settlement reduction equals treasury increase exactly. Wealth
  105 clamps to 100; wealth already below 100 remains unchanged. Equal control is
  resolved once by deterministic government ID, preventing double taxation.
- **Succession proof**: relocation now runs before control-grid reset and consults the
  previous valid field. An invalid capital moves exactly once to the largest eligible
  active controlled settlement with the recorded before/after IDs. With no eligible
  replacement, no relocation or fabricated capital occurs.
- **Branch/snapshot proof**: insertion at Year 0 no longer pre-simulates Year 0 and
  then repeats it. Post-bootstrap branch states retain governments/control arrays;
  every pre-intervention year hash matches and political-founding events remain unique.
- **Focused Chromium proof**: the real application and ES-module Worker completed the
  baseline and bridge branch in 4.1 minutes. The DEV seam observed real government,
  capital, and control arrays; Political rendering had multiple terrain colors; data
  survived scrubbing; branch Year 9 matched baseline state hash, governments, and full
  control arrays; no console errors or page errors occurred. The existing benign
  `PCFSoftShadowMap` deprecation warning remained.
- **Hostile resweep**: exercised zero/one settlements, repeated bootstrap, finite field
  dimensions, tax floor and overlap, missing/abandoned capitals, no-replacement
  succession, Year-0 and post-init branches, duplicate event IDs, snapshot replay, and
  deterministic hashes. One High defect was found and fixed: taxation previously raised
  wealth below 100 and could book a negative tax.
- **Performance boundary**: political propagation now indexes existing road adjacency
  and active bridge cells once per yearly update, preserving formulas. The deferred
  timeline-storage, cached-state, Worker-payload, bundle-splitting, and broader memory/
  performance architecture was not undertaken.

---

## Final validation snapshot

- Lint (`npm run lint`): **0 errors, 0 warnings**.
- Unit/JSDOM (`npm test`): **56 passed** (kernel 19, repairs 36, ui 1) in 127.58 s;
  politics-active long-run tests use measured 80 s budgets rather than reducing years.
- Build (`npm run build`): success; `index-*.js` ~819 kB (gzip ~220 kB), chunk-size
  >500 kB warning (Three.js; deferred — M7).
- Focused politics E2E: **1 passed** in 4.1 min with the real Worker and Chromium.
- E2E (`npm run test:e2e`): **5 passed** in headless Chromium in 15.3 min; no page
  errors or console errors. Known warning: `PCFSoftShadowMap` deprecation.
- CI (`.github/workflows/ci.yml`): result reported in the session's final report.
