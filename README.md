# Causal Civilization Engine

An explorable historical simulation in which geography, infrastructure, settlement, culture, wealth, and political control emerge from interacting systems. The primary feature of the engine is support for counterfactual resimulation, allowing users to suppress events (e.g. bridge construction) and trace the resulting chronological divergence.

## Tech Stack
- **Frontend**: React 19, TypeScript, semantic tokenized CSS, Lucide React
- **Rendering**: Three.js WebGL (low-poly custom render loops)
- **Simulation**: Asynchronous ES-module Web Worker thread with synchronous fallback for test runs
- **Testing**: Vitest (Node kernel logic + JSDOM UI mount) and Playwright (real-browser Chromium acceptance)

## Capability status

Each claim is classified by how it was verified. See `docs/FINAL_ADVERSARIAL_AUDIT.md`
for the full audit and evidence.

**Unit-test verified** (Vitest, 56 tests)
- Exact Float64 DataView bitwise hashing produces exact repeatability for identical
  runs in the tested local JavaScript runtime (V8 via Node/Chromium). Cross-engine
  determinism is **not** claimed.
- Transaction reconciliation: buyer expenditure = seller revenue + transport drag,
  and full-year per-settlement wealth reconciles against actual state deltas.
  (Transport drag is an expense **sink**, not a balanced counter-account — this is
  reconciliation, not double-entry accounting.)
- Off-network transport capacity is bounded per corridor per year, consumed (not
  reset mid-year), and shared direction-independently; network residual-capacity
  routing via Dijkstra re-routes around bottlenecks.
- Semantic, branch-stable cross-branch event correlation (independent of unrelated
  transaction ordering); symmetric, order-independent causal event comparison;
  cycle detection; chronology validation; invalid graphs cannot verify ancestry.
- Worker stale-response rejection logic (request-id guard).
- Branch resimulation parity: the branch is simulated exactly once and its per-year
  state cache matches the recorded year hashes.
- Politics bootstrap: the standard deterministic simulation creates two governments
  after Year-0 settlements exist; capitals resolve to active settlements and every
  125×125 political-control field is finite and nonuniform.
- Politics lifecycle: government founding is nonduplicating, five-year taxation
  reconciles settlement reductions exactly to treasury increases (including the
  100-wealth floor), and invalid capitals relocate once to the largest eligible
  controlled settlement when one exists.
- Politics remains deterministic across identical runs and survives both Year-0 and
  post-bootstrap counterfactual resimulation with exact pre-intervention hashes.

**Real-browser verified** (Playwright, headless Chromium; five established tests plus one focused UI-polish test)
- WebGL context initializes; terrain, rivers, settlements, roads, and the bridge
  render (verified via `renderer.info` and a scene census).
- Counterfactual bridge suppression runs end-to-end via the real Worker, producing a
  diverged branch, live progress, split-screen comparison, a movable comparison
  divider, and a suppressed-bridge Inspector.
- Camera controls, viewport resize, overlays, timeline play/pause and scrub, and the
  Inspector all respond; no serious console or page errors.
- The real Worker produces governments, valid capitals, and nonuniform control data;
  the Political overlay renders multiple terrain colors from that state, survives
  timeline scrubbing, and preserves exact pre-intervention politics across the bridge
  counterfactual.
- The focused UI test verifies loading-time resize, shell geometry, minimum target
  sizing, overlay legends, Inspector entity/fallback states, keyboard focus, reduced
  motion, mobile containment, branch lockout, comparison labels/divider, suppression,
  and error recovery.

## Interface and interaction model

The application is organized as a map-first causal-history workbench:

- the shell names simulation readiness, current year, active overlay, branch state,
  seed replacement behavior, and the primary available action;
- baseline and counterfactual Worker runs expose real percentage progress without
  inventing completion estimates;
- every overlay has a pressed state, visible label, and dynamic legend, including
  named political factions and shape-coded infrastructure states;
- the timeline provides first/previous/play/next/final controls, an accessible year
  range, responsive ticks, real ledger-event buckets, and the Year-10 intervention;
- split comparison labels baseline and counterfactual directly on the map and keeps
  the divider keyboard-operable;
- Inspector supports empty, settlement, road, bridge, government, scar, missing,
  causal-evidence, and branch-comparison states;
- tablet and narrow layouts preserve map space with a collapsible control tray and
  a dismissible Inspector sheet.

The interface uses local assets and font stacks only. It provides practical Web
Content Accessibility Guidelines (WCAG) AA-oriented contrast, visible focus,
semantic controls and landmarks, live status/error announcements, reduced-motion
handling, and approximately 44×44 CSS-pixel targets. This is not a claim of
universal accessibility or mobile-performance optimization.

**Measured (single headless run, software WebGL / SwiftShader — not GPU)**
- ~9 FPS, ~112 ms average / ~168 ms worst frame time; 141 draw calls; 32,432
  triangles; 1280×720 canvas; ~905 MB JS heap; ~107 s for the initial 400-year
  baseline simulation. These are software-rendering figures; a real GPU will differ
  substantially. **60 FPS is not claimed.**

**Not verified / out of scope**
- Cross-engine (SpiderMonkey / JavaScriptCore) determinism.
- GPU-accelerated performance and long-run memory-leak freedom (only a bounded
  30-scrub check was run: 0 MB heap growth).
- New political mechanics beyond the repaired existing subsystem (wars, diplomacy,
  treaties, elections, and additional government types) remain out of scope.
- The broader timeline-storage, Worker-payload, and memory/performance redesign remains
  deferred; activating politics does not change those documented limitations.

## Verification & Execution

### Run Development Server
```bash
npm run dev
```

### Run All Unit and UI Tests
```bash
npm run test
```
Vitest files run serially so long deterministic simulations do not compete for the
same CPU budget and fail their assertion-preserving time limits spuriously.

### Build Production Bundle
```bash
npm run build
```

### Run Real-Browser Acceptance Tests
```bash
npm run test:e2e        # first time: npx playwright install chromium
```
Starts Vite automatically and drives headless Chromium. Artifacts are written to the
git-ignored `test-results/` and `playwright-report/`.

### Continuous Integration
`.github/workflows/ci.yml` runs lint, unit/JSDOM tests, the production build, and the
Chromium E2E suite on every push and pull request to `main`.

## Repository completion rule

Every project-work turn that changes repository files must finish by staging the intended changes, running applicable validation, committing with a descriptive message, pushing the active branch, and verifying that the local HEAD SHA matches the remote branch SHA. Read-only sessions do not create empty commits.
