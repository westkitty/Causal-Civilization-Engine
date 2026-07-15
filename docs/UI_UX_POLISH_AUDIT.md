# UI/UX Polish Audit

Date: 2026-07-15
Starting SHA: `d54cfd69aa485f921242a54e790d30b9bf94aaee`
Surface: single-screen Causal Civilization Engine application UI
Classifier: **application UI** — a map-first technical workspace, not a marketing page

## Ground truth and baseline

- Repository: `main`, clean, synchronized with `origin/main` at the expected starting SHA.
- Initial lint: 0 errors, 0 warnings in 0.75 s.
- Initial Vitest run: 52 passed, 4 timed out, 56 total in 269.73 s. The four failures were timeout-only failures in existing deterministic/branch tests; no assertion mismatch was reported.
- Initial build: succeeded in 8.07 s. Vite reported the existing JavaScript chunk-size warning (`819.74 kB`, `220.45 kB` gzip).
- Before screenshots: `.qa/ui-ux/before/` (git-ignored). Required viewports plus loading, baseline, Inspector, Political, and branch-recomputation states were recaptured from the exact starting SHA in a detached worktree.
- Browser console during capture: 0 errors. Two recurring WebGL/software-renderer warnings were present in the Playwright command-line browser.

## First impression

The app communicates “technical prototype with controls attached,” not “causal-history workbench.” The first three visual anchors are the overlay card, the empty dark field, and the timeline. The application name, simulation status, map, and primary branch action are either clipped or visually absent. One-word verdict: **dislocated**.

The page-area test finds four intended areas: identity/status, map controls, map, and timeline. Only the controls and timeline can be named reliably from the rendered screen. The map is almost entirely outside the camera frame, while undefined utility classes leave the identity panel partially off-screen. Opening Inspector hides still more of the already-fragmented shell.

Baseline design score: **D**. Baseline AI-slop score: **D**. The interface has real domain identity in its data, but its cyan/indigo glass cards, tiny type, uniform rounding, and missing layout utilities read like an unfinished generated dashboard shell.

### App UI litmus checks

| Check | Baseline |
|---|---|
| Product unmistakable in first screen | No |
| One strong visual anchor | No |
| Understandable by scanning headings | No |
| Each area has one job | Partial |
| Cards are necessary | No — several are decorative containers |
| Motion improves hierarchy | No |
| Would remain deliberate without shadows | No |

Trunk-test adaptation for this one-screen app: **FAIL**. Product identity, active state, branch location, and available next action are not simultaneously clear.

## Severity-ranked findings

| ID | Severity | Screen / component | Evidence | User consequence | Concrete correction | Validation | Baseline status |
|---|---|---|---|---|---|---|---|
| UI-001 | Blocker | `MapViewer` | At all four viewports, only a thin terrain fragment appears at the top edge. The centered terrain is translated by half its size while camera/controls target positive coordinates. | The primary workspace appears empty; selection and exploration are effectively undiscoverable. | Center terrain, camera, and OrbitControls on the same world origin without changing scene data or renderer lifecycle. | Direct screenshots plus existing renderer/camera/selection E2E. | OPEN |
| UI-002 | Blocker | Application shell / CSS | Components use many Tailwind-like classes (`left-1/2`, arbitrary widths, transforms, colors) that the handwritten utility sheet does not define. Header content clips behind the overlay panel and responsive layouts collapse. | Identity, seed, status, and actions are obscured; the app cannot be demonstrated reliably. | Replace utility-class dependency with a semantic tokenized layout and stable component classes. | Bounding-box/no-overlap assertions at 1440, 1280, 768, and 390 px. | OPEN |
| UI-003 | Major | Baseline and branch loading | The accessibility tree reports real progress, but screenshots at 28% and 73% show no readable operation or progress card. | A 100+ second operation looks frozen or broken. | Add an in-workspace live status card with operation, real percentage, explanation, progress track, and replacement/error guidance. | Loading and branch-recompute screenshots; live-region and progressbar assertions. | OPEN |
| UI-004 | Major | Overlay controls and map legend | Active overlay styling exists, but no dynamic legend explains biome, politics, resource ranges, or infrastructure states. Political hue has no named faction key. | Users cannot interpret the map and must guess at color meaning. | Add pressed-state controls, visible names/tooltips, and overlay-specific text/pattern legends including neutral, both governments, active, ruined, and suppressed. | Semantic overlay/legend E2E plus terrain-color diagnostic. | OPEN |
| UI-005 | Major | Split comparison | “Parent History / Branch History” exists only above a small slider. The map itself has no side labels or visible divider handle; “Show Current” does not say which branch is shown. | Users can mistake one history for the other and cannot locate the split boundary. | Add map-side baseline/counterfactual labels, a visible keyboard-operable divider, explicit “Baseline only” return, and intervention marker. | Split screenshot, label assertions, divider extremes and keyboard test. | OPEN |
| UI-006 | Major | Counterfactual action | The button does not name its bridge ID, insertion year, new branch, or unavailable reason. During work it remains visually indistinguishable because the loader is absent. | Users cannot predict cost or consequence and may repeat activation. | Add concise target/year/new-branch preview, disabled/recomputing copy, duplicate prevention, and branch-ready confirmation. | Before/during/after branch assertions and repeated-click resweep. | OPEN |
| UI-007 | Major | Timeline | Year is small, reset/play are 36–40 px, the slider is 14 px high, ticks are tiny clickable spans, mobile ticks concatenate, and real event data is not surfaced. | Historical navigation is difficult with mouse, touch, and keyboard. | Add first/previous/play/next/last controls, prominent year, accessible range metadata, coarser responsive ticks, and aggregated real event/intervention markers. | Keyboard, touch-size, mobile screenshot, marker and disabled-state tests. | OPEN |
| UI-008 | Major | Inspector | Inspector is absent when nothing is selected, uses dense 9–12 px text, hides entity IDs, and only resolves settlements/bridges/scars. Road and government states have no usable inspection path. | Selection affordance and causal evidence are hard to discover; key entities cannot be understood consistently. | Keep an empty instruction surface, reorganize identity/state/history/causes/evidence/comparison, expose subordinate IDs, add road and government resolution, and use disclosure for evidence. | Empty/open/close plus settlement, bridge, road, government, unresolved, and overflow checks. | OPEN |
| UI-009 | Major | Accessibility across shell | Most controls are under 44 px; body text is often 10–14 px; focus styling depends on browser defaults; status changes lack a deliberate live region; color alone distinguishes several states. | Keyboard, low-vision, touch, and screen-reader users receive incomplete or difficult feedback. | Establish 44 px targets, 16 px body baseline, strong `:focus-visible`, landmarks/headings, pressed/disabled semantics, live regions, text/icon/pattern status cues, and reduced motion. | Programmatic target/focus/roles checks plus keyboard-only and reduced-motion resweep. | OPEN |
| UI-010 | Major | Tablet and narrow layouts | At 390 px, header/input/action crop horizontally and timeline ticks concatenate; fixed panels consume map space and Inspector has no drawer behavior. | The app is not operable at required narrow/tablet sizes. | Use responsive grid areas, a collapsible control tray, Inspector side sheet/bottom drawer, compact timeline, safe-area padding, and page-overflow guards. | Four viewport captures, overflow assertions, resize during loading. | OPEN |
| UI-011 | Major | Error and unavailable states | Worker errors render as a small transient-looking string with no retry. “No bridge” is only produced after clicking and has no recovery guidance. | Failure becomes a dead end. | Add associated alert surface, operation context, retry baseline action, dismiss control, and plain unavailable explanation. | Development fault seam/component assertion and visual capture. | OPEN |
| UI-012 | Major | Copy and state naming | “Recompiling” is used for the first compilation; raw `main` and `suppress_bridge_branch` IDs lead; “GPT Q&A” implies a model call though answers are local ledger rules. | Users misread what the system is doing and what evidence is generated. | Use “Building baseline history,” “Recomputing counterfactual,” readable branch labels with subordinate IDs, and “Ledger questions / verified evidence.” | Copy assertions and direct visual review. | OPEN |
| UI-013 | Major | Fonts and interface assets | `index.html` loads external Google Fonts despite the local-only constraint; favicon is the default purple Vite mark; unused Vite/social starter assets remain. | Offline rendering is inconsistent and the product lacks identity. | Remove external font requests, use purposeful local font stacks, replace favicon with an original causal/terrain mark, and document all active assets. | Network request audit, favicon/manifest inspection, build. | OPEN |
| UI-014 | Major | Status semantics | Active/suppressed and baseline/branch values rely heavily on green/red or cyan/indigo. | Meaning is weakened for color-vision deficiencies and screenshots without color context. | Add explicit badges, icons, labels, patterns, and side names everywhere color is used. | No-color-only review and semantic assertions. | OPEN |
| UI-015 | Minor | Seed control | Editing reruns the baseline immediately, but the tiny unlabeled field does not explain replacement behavior. | A typo starts expensive work without clear feedback. | Keep existing replacement semantics but provide a full label, helper/status text, and adequate input target. | Rapid-seed existing E2E plus copy/target assertions. | OPEN |
| UI-016 | Minor | Event density | Timeline currently has coarse numeric ticks only although ledger events are available. | Users cannot connect visible history with causal evidence. | Aggregate meaningful recorded events by year; never invent markers. | Marker years checked against ledger-backed data. | OPEN |
| UI-017 | Minor | Inspector evidence overflow | Long event IDs, missing names, and evidence prose can overflow narrow panels. | Technical evidence becomes unreadable. | Apply wrapping, tabular numerals, bounded disclosure, and readable empty/missing-name fallbacks. | Long-name/evidence resweep at 390 px and 200% zoom. | OPEN |
| UI-018 | Minor | Map instructions | No persistent instruction explains pan, zoom, or selection. | First-time users see a map but do not know how to explore it. | Add one concise, dismiss-free help line adjacent to map state. | Visual review and copy assertion. | OPEN |
| UI-019 | Polish | Panel styling | Heavy blur, large shadows, cyan/indigo glow, and uniformly rounded cards compete with the terrain. | The interface feels ornamental and generic. | Use calm opaque surfaces, restrained borders, small radius hierarchy, and one warm accent. | Screenshot/design rescore. | OPEN |
| UI-020 | Polish | Numeric presentation | Metrics mix proportional and monospaced type without consistent grouping or units. | Comparisons take longer to scan. | Use tabular numerals, aligned definition lists, explicit units, and branch columns. | Inspector visual review. | OPEN |

## Workflow map and primary action

1. **Load simulation:** read status and real progress; seed edits replace the active baseline run.
2. **Explore map:** map remains dominant; overlay tray and one-line navigation help are secondary.
3. **Change overlay:** pressed control updates a nearby legend and shell status.
4. **Navigate history:** timeline year is primary; play/step/start/end and real event markers support it.
5. **Select entity:** map or political legend selection opens Inspector; empty Inspector teaches the action.
6. **Inspect state and causes:** identity first, metrics second, causal/evidence disclosures third.
7. **Create branch:** after a baseline bridge exists, the primary action states target, Year 10 insertion, and new branch behavior.
8. **Wait:** the map remains visible; branch progress replaces action affordances and blocks duplicates.
9. **Compare:** split is labeled directly on the map; divider and Inspector use explicit baseline/counterfactual names.
10. **Return:** “Baseline only” removes the split without deleting the ready branch.

## Frozen bounded change set

The following checklist is frozen before implementation. It includes every Blocker and Major plus the bounded Minor/Polish work needed to make those fixes coherent.

- [x] Center the existing Three.js world and camera without changing simulation or render-loop lifetime.
- [x] Replace fragile utility-class layout with semantic CSS and a minimal token layer.
- [x] Rebuild the shell hierarchy: identity, seed/status, year, branch, overlay, primary action.
- [x] Add readable baseline/branch Worker progress, error recovery, and branch-ready feedback.
- [x] Add overlay buttons, dynamic legends, faction names, infrastructure state keys, and map help.
- [x] Rework timeline controls, labels, real event markers, disabled states, and keyboard/touch behavior.
- [x] Clarify the branch target/insertion/new-branch flow while preserving existing branch behavior.
- [x] Add labeled split comparison, divider handle, branch distinction, and baseline-only return.
- [x] Reorganize Inspector; add empty, road, government, missing-name, unresolved, evidence, and comparison states.
- [x] Add responsive control tray and Inspector drawer behavior for 768×1024 and 390×844.
- [x] Add global focus, target-size, contrast, live-region, semantic landmark, no-color-only, and reduced-motion treatment.
- [x] Replace external fonts/default favicon with an original local branching-terrain SVG; remove no-longer-used starter assets where safe.
- [x] Correct stale taxation and pair-scoped trade wording; update project documentation.
- [x] Add focused semantic Playwright UI coverage and matching after screenshots.
- [x] Run the full adversarial resweep and required repository validation.

## Design direction and token intent

The interface will use a **causal field atlas** direction: a dark cartographic workbench with opaque instrument surfaces, warm parchment typography, teal baseline, amber counterfactual, blue/rose governments, and a small branching contour mark. The shell is banded around one dominant map rather than composed from dashboard cards.

Token groups: app/elevated/recessed surfaces; border/text levels; accent; baseline/counterfactual; success/warning/error; selection/focus; political factions; active/ruined/suppressed infrastructure; 4 px spacing base; 4/8/12 px radii; 44 px minimum targets; fast/standard transitions; explicit reduced-motion overrides.

Typography is local-only: a purposeful `Avenir Next`/`Segoe UI` humanist body stack, `Charter`/`Georgia` display stack, and native monospace for IDs/numerals. No font files or network requests.

## Before evidence

Ignored evidence directory: `.qa/ui-ux/before/`.

- `1440x900-loading.png`
- `1440x900-baseline.png`, `1280x720-baseline.png`
- `768x1024-baseline.png`, `390x844-baseline.png`
- `1440x900-political.png`, `1440x900-inspector.png`
- `1440x900-branch-recompute.png`

The pre-change UI exposed no safe visual-only seam for a Worker error, so a fabricated before-error screenshot was not created.

## Quick wins identified

1. Center the world/camera so the actual map becomes visible.
2. Replace undefined layout utilities with semantic CSS.
3. Make Worker progress a readable in-map status card.
4. Raise all interactive targets to 44 px and add visible focus.
5. Remove external fonts and replace the Vite favicon.

## Before-and-after results

Ignored after-evidence directory: `.qa/ui-ux/after/`.

- Required viewports: `1440x900-baseline.png`, `1280x720-baseline.png`, `768x1024-baseline.png`, `390x844-baseline.png`.
- Runtime states: desktop/mobile loading, Political, Inspector, Worker error, branch recompute, split comparison, and suppressed bridge.
- Direct review confirms that the map is centered and dominant, the shell no longer overlaps, the timeline remains contained, the mobile control tray is operable, and real loading/comparison states remain legible over the map.
- The first interactive split-capture attempt crashed Playwright's graphics target during the long Worker run. A fresh isolated headless Chromium run completed the same real baseline and branch operations and produced the final split/suppressed captures. This is recorded as capture-tool behavior; the focused Playwright acceptance test independently completed the flow with zero page or console errors.

Final design score: **B**. Final AI-slop score: **A**. The remaining visual limitations are the inherently dense 400-year atlas and software-rendered Three.js softness, not generic dashboard ornament.

### Final resolution matrix

| Findings | Result | Evidence |
|---|---|---|
| UI-001–UI-002 | FIXED | Four direct viewport captures; shell geometry and map-height assertions. |
| UI-003–UI-006 | FIXED | Real baseline/branch progress, explicit branch preview, ready state, labels, divider extremes, duplicate-action lockout. |
| UI-007–UI-010 | FIXED | Keyboard range behavior, 44 px target gate, focus/reduced-motion checks, mobile no-overflow and responsive tray. |
| UI-011–UI-014 | FIXED | Dismissible/retry error state, corrected terminology, local-only asset audit, named/icon-backed state distinctions. |
| UI-015–UI-020 | FIXED | Labeled seed replacement behavior, ledger-derived timeline markers, wrapped/disclosed evidence, map help, restrained surfaces, tabular units. |

## Adversarial resweep

The resweep covered long/missing entity identifiers, empty Inspector, road and government selection, no/missing entity fallback, unresolved evidence, Worker error recovery, duplicate branch activation, rapid overlay changes, timeline keyboard input, narrow layout, loading-time resize, 44 px targets, visible focus, reduced motion, disabled controls, divider values at 5/95, evidence overflow, and overlay switching while branch computation was active.

- No remaining Blocker or Major UI finding was observed.
- No horizontal document overflow was observed at 390×844.
- All visible buttons measured at least 43 CSS px in both dimensions (one-pixel tolerance for browser rounding).
- Political rendering contained multiple actual terrain colors and a named neutral/faction legend.
- The real Worker loading state retained the baseline map and blocked repeat branch activation.
- The error seam is development-only and does not alter production behavior.
- Browser check: 0 page errors and 0 console errors in the focused final suite. The deprecated `PCFSoftShadowMap` warning seen in the before revision was removed by using Three.js `PCFShadowMap`; no renderer lifecycle or simulation behavior changed.

Final repository gate: lint 0 errors/0 warnings (0.78 s); Vitest 56/56 (228.06 s, file-level serialization); production build success (6.67 s, existing >500 kB Three.js chunk warning); focused Worker-backed UI Playwright 1/1 (approximately 3.7 min, 0 page/console errors). At the user's request for minimum required testing, the redundant final six-test aggregate Playwright sweep was interrupted and is not claimed as a pass. Findings above remain preserved as the baseline ledger; this resolution matrix closes them without rewriting the original evidence.
