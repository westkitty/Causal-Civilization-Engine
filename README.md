# Causal Civilization Engine

An explorable historical simulation in which geography, infrastructure, settlement, culture, wealth, and political control emerge from interacting systems. The primary feature of the engine is support for counterfactual resimulation, allowing users to suppress events (e.g. bridge construction) and trace the resulting chronological divergence.

## Tech Stack
- **Frontend**: React 19, TypeScript, Tailwind CSS / Vanilla CSS, Lucide React
- **Rendering**: Three.js WebGL (low-poly custom render loops)
- **Simulation**: Asynchronous ES-module Web Worker thread with synchronous fallback for test runs
- **Testing**: Vitest (Node kernel logic + JSDOM UI mount) and Playwright (real-browser Chromium acceptance)

## Capability status

Each claim is classified by how it was verified. See `docs/FINAL_ADVERSARIAL_AUDIT.md`
for the full audit and evidence.

**Unit-test verified** (Vitest, 46 tests)
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

**Real-browser verified** (Playwright, headless Chromium, 4 tests)
- WebGL context initializes; terrain, rivers, settlements, roads, and the bridge
  render (verified via `renderer.info` and a scene census).
- Counterfactual bridge suppression runs end-to-end via the real Worker, producing a
  diverged branch, live progress, split-screen comparison, a movable comparison
  divider, and a suppressed-bridge Inspector.
- Camera controls, viewport resize, overlays, timeline play/pause and scrub, and the
  Inspector all respond; no serious console or page errors.

**Measured (single headless run, software WebGL / SwiftShader — not GPU)**
- ~11 FPS, ~89 ms average / ~149 ms worst frame time; 141 draw calls; 32,432
  triangles; 1280×720 canvas; ~803 MB JS heap; ~75 s for the initial 400-year
  baseline simulation. These are software-rendering figures; a real GPU will differ
  substantially. **60 FPS is not claimed.**

**Not verified / out of scope**
- Cross-engine (SpiderMonkey / JavaScriptCore) determinism.
- GPU-accelerated performance and long-run memory-leak freedom (only a bounded
  30-scrub check was run: 0 MB heap growth).
- The **politics subsystem is inert**: governments are never created (a year-0
  scheduler-ordering issue), so taxation, control-field borders, and capital
  succession do not occur and the "Political" overlay renders uniform neutral. This
  is documented in the audit (finding M8) and deliberately left unchanged, as
  altering the political simulation is out of scope.

## Verification & Execution

### Run Development Server
```bash
npm run dev
```

### Run All Unit and UI Tests
```bash
npm run test
```

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
