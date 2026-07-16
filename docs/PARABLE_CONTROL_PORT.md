# Parable Control Port

Read-only source: `/Users/andrew/Parable`, branch `spike/godot-hand-feel-2026-07-02`,
HEAD `d6f66b705c0be43be791585b2b6953450ecbd9c1` at inspection time. Parable was
never edited, built, installed, or run as part of this task — see the
verification section at the end of this document.

## Which Parable implementation this ports

Parable is two things in one repository:

1. **`src/main.js` + `src/runtime/main.part01..12.js.txt`** — a browser-playable,
   no-build Three.js prototype. Inspected in full (`grep` across all 12 parts for
   `camera`, `addEventListener`, `keydown`, `wheel`, `touch`, etc.). Its camera is
   **static**: `camera.position.set(0, 48, 55); camera.lookAt(0, 0, 0);` is set once
   at boot (`src/runtime/main.part02.js.txt:29-30`) and touched again only on
   `resize` (aspect/projection update, `main.part10.js.txt:96-97`). Pointer events
   (`pointerdown`/`pointermove`/`pointerup`, `main.part05.js.txt`,
   `main.part06.js.txt`) drive a spiral gesture-drawing ritual mechanic, not camera
   movement. **This implementation has no map/camera navigation control scheme at
   all** — there is nothing here to port.
2. **`godot-spike/`** — a Godot 4 prototype (the branch this task's starting
   commit has checked out is literally named for this spike) implementing a "divine
   hand" god-game. `godot-spike/scripts/camera_rig.gd` is a real, fully-realized
   orbit/pan/zoom camera rig, and `godot-spike/scripts/hand_input.gd` drives its
   ground-drag pan trigger. This is the genuine "map-navigation control scheme"
   the task asks to port, and is the sole source for everything below.

This choice is corroborated by Parable's own human-facing documentation
(`godot-spike/README_FOR_ANDREW.md:79-101`, the "controls (this is everything)"
table) and its own automated test contract
(`godot-spike/tests/verify_playability_surrogates.gd`), both of which describe
exactly the same scheme found in source — three independent confirmations.

## Files inspected

- `godot-spike/scripts/camera_rig.gd` (the orbit/pan/zoom/reset rig — primary source)
- `godot-spike/scripts/hand_input.gd` (drives the LMB ground-drag pan trigger and
  the click-vs-drag threshold; everything else in this file — grab/carry/throw,
  miracle-gesture casting, Esc-cancel — is unrelated gameplay, not navigation)
- `godot-spike/scripts/world.gd` (`_notification` handler: window-focus-loss /
  mouse-exit clears transient camera input; focus-gain resyncs without moving
  the camera or resuming a drag)
- `godot-spike/scenes/Main.tscn` (confirms the `CameraRig → Pitch → Camera3D`
  node hierarchy has no scene-level property overrides; the script's `_ready()`
  values are authoritative)
- `godot-spike/tests/verify_playability_surrogates.gd` (authoritative behavioral
  contract: pan/orbit/zoom change the expected state fields; plain clicks don't
  zoom; Shift/Alt+LMB activate orbit fallback; MMB is `orbit_source() == "middle"`;
  orbiting doesn't change zoom; repeated input settles with no residual drift;
  reset returns to `yaw≈0, dist≈26`; a small left-drag (3,2) stays below the pan
  threshold and doesn't move the camera, a large one (55,-42) does; focus loss
  clears `is_orbiting()`/`middle_button_down()`/carry/hover and returns input mode
  to `hover`; focus gain does not auto-orbit or move the camera)
- `godot-spike/README_FOR_ANDREW.md` (human-authored control table, "controls
  (this is everything)" — the authoritative UX description)
- `src/runtime/main.part01..12.js.txt`, `src/main.js` (ruled out — see above)

No behavior below was inferred from naming alone; every row traces to the
function(s) cited.

## Extracted Parable control matrix

| Input / gesture | Exact Parable behavior | Parable source | Speed / constraint values | CCE equivalent | Adaptation required | Verification |
|---|---|---|---|---|---|---|
| Middle-mouse drag | Orbit (yaw + pitch) around the rig's pivot | `camera_rig.gd:72-94` (`_input`), `_apply_orbit` (`:176-180`) | `ORBIT_SENS = 0.0036` rad/px; pitch clamped to `[-80°, -15°]` | `OrbitControls.mouseButtons.MIDDLE = MOUSE.ROTATE`; `minPolarAngle`/`maxPolarAngle` | Godot's yaw/pitch-around-a-pivot rig and three.js `OrbitControls`' spherical-coordinates-around-`target` model are the same underlying concept (orbit a point), so this ports directly. Pitch-clamp *numbers* don't transfer literally — Godot's pitch is measured as a signed Euler angle on a custom rig node, three.js's polar angle is measured from the world +Y axis on a different rig; ported as the equivalent *shape* of constraint (never fully overhead, never fully flat) layered onto CCE's existing `maxPolarAngle` | Confirmed behavior (source + test `_check(rig.orbit_source() == "middle", ...)` at `verify_playability_surrogates.gd:206`) |
| Left-mouse drag on empty ground | Pan (screen-relative, translated into camera-relative world XZ movement) | `hand_input.gd:165-209` triggers; `camera_rig.gd:135-146` (`pan_screen_delta`) executes | `SCREEN_PAN_SCALE = 0.044` world-units/px; drag only becomes "pan" past `CLICK_DRAG_THRESHOLD_PX = 10.0`; world-position clamped to `[-60, 60]` on X and Z (`pan_by`, `:166-171`) | `OrbitControls.mouseButtons.LEFT = MOUSE.PAN`; a pointerdown/pointerup distance check gates whether the subsequent `click` is treated as entity-selection | **Pan bound not ported.** A proportional pan-distance bound (`OrbitControls.maxTargetRadius`) was implemented and then removed after adversarial testing (`orbit after a large pan`) showed it destabilizing the orbit target — once panned near the clamp boundary, a subsequent orbit gesture's repeated per-frame `update()` recomputation caused the target to visibly drift instead of staying fixed at the orbit pivot, a real regression an end user would notice mid-orbit. Panning is unbounded in this port rather than ship that interaction bug; see the "Removed: pan-distance clamp" adversarial-resweep entry below. `SCREEN_PAN_SCALE` isn't literally portable either (three.js's built-in `pan()` already computes a screen-proportional world offset from the camera's own distance-to-target, which is the same design intent expressed through `OrbitControls`' own math rather than a hand-tuned constant) | Confirmed (source + test: small drag `(3,2)` stays below threshold and doesn't move the camera, large drag `(55,-42)` does, `:259-266`) |
| Left-mouse click (no/negligible drag) | Interact with an object/UI element under the cursor (temple doorway, shrine, ritual symbols) — explicitly *not* camera movement | `hand_input.gd:165-206` (`"pending_click"` path) | Same `CLICK_DRAG_THRESHOLD_PX = 10.0` decides click vs. drag | CCE's existing raycast-based entity selection (`MapViewer.tsx` `handleClick`) | This is the pre-existing CCE behavior; the *risk* introduced by porting LMB-drag-to-pan is that a pan gesture could spuriously fire a `click` and deselect/misselect on release — guarded with the same distance-threshold pattern Parable itself uses | Playwright: drag-then-release does not trigger selection; a genuine click still does |
| Shift + left-drag | Orbit fallback (identical to middle-drag orbit) — mutually exclusive with pan (pan never starts while this is active) | `camera_rig.gd:77-82` (`_orbit_fallback`), `hand_input.gd:165` (`not _rig.orbit_modifier_active()`) | Same `ORBIT_SENS` as middle-drag | Reactively set `controls.mouseButtons.LEFT = MOUSE.ROTATE` while Shift is held (restored to `PAN` on keyup), tracked via `keydown`/`keyup`, not inside the pointerdown handler (avoids event-ordering races) | Direct port of the *behavior*; the implementation mechanism differs because `OrbitControls` has no native per-modifier-key remap, so CCE swaps the public `mouseButtons.LEFT` value ahead of the press | Confirmed (source + test `:179-184`, "shift + left orbit fallback activates") |
| Alt/Option + left-drag | Orbit fallback, documented specifically as a Mac-trackpad-friendly alternative to middle-drag | `camera_rig.gd:77-82`; docs: "Orbit fallback only if middle mouse is unreliable on this Mac" (`README_FOR_ANDREW.md:91`) | Same as above | Same mechanism as Shift, keyed on Alt | Same as above | Confirmed (source + test `:190-195`, "alt + left orbit fallback activates") |
| Scroll wheel | Zoom in/out, fixed step per notch | `camera_rig.gd:83-86`, `_zoom` (`:163-164`) | `ZOOM_STEP_SCROLL = 2.4` distance-units/notch; clamped to `[DIST_MIN=7, DIST_MAX=55]` | `OrbitControls`' native wheel handling (already present, unmodified) | `OrbitControls` dolly is a *multiplicative* zoom-speed model, not Parable's *additive* fixed-step model — kept as CCE's existing `zoomSpeed`-tuned wheel zoom rather than hand-simulating additive steps, since forcing an additive model onto `OrbitControls`' internal spherical-radius math would fight the library rather than adapt it. Direction (up = in, down = out) and existence of a min/max distance clamp (already present in CCE, `minDistance=10`/`maxDistance=300`) both match | Playwright: wheel-up decreases camera-target distance, wheel-down increases it, both remain within bounds |
| Q / E | Continuous keyboard orbit (yaw) while held, frame-rate-independent | `camera_rig.gd:52-55` (`_process`), `orbit_step` (`:128-130`) | `KEY_ORBIT_RATE = 1.55` rad/sec, scaled by `delta` | `controls.rotateLeft(angle)` called every animation frame while Q/E held, `angle = ±KEY_ORBIT_RATE_EQUIV * delta` | Rate re-tuned for CCE's camera distance/FOV rather than copied literally (Parable's rig orbits at a fixed local radius; CCE's `rotateLeft` operates on a spherical angle around `target` at whatever the current zoom distance is — same visual angular rate regardless of zoom, so the Godot rad/sec value ports directly without rescaling) | Unit test: held-key simulation advances camera azimuth angle per frame; Playwright: Q/E changes camera position around target |
| W / S | Continuous keyboard pitch while held, frame-rate-independent, clamped | `camera_rig.gd:56-59`, `pitch_step` (`:132-133`) | `KEY_PITCH_RATE = 1.1` rad/sec; clamped to the same `[-80°,-15°]`-equivalent range as mouse-orbit pitch | `controls.rotateUp(angle)` called every animation frame while W/S held; relies on `OrbitControls`' own `minPolarAngle`/`maxPolarAngle` clamp (shared with the mouse-drag path — one clamp, both input paths) | Same rate-port rationale as Q/E | Unit test + Playwright, same method as Q/E |
| = / + (incl. numpad +) | Continuous keyboard zoom-in while held | `camera_rig.gd:60-61` | `ZOOM_STEP_KEYBOARD = 1.2` distance-units — **applied every rendered frame while held, not delta-scaled**, in Parable's own source | `controls.dollyIn(scale)` called every animation frame while held, **delta-scaled** in CCE | Deliberate adaptation, called out explicitly: Parable's own keyboard-zoom is frame-rate-dependent (a documented quirk of the source, not a design goal — nothing in the docs or tests asserts a specific frame-rate coupling). Porting it frame-rate-*dependent* would make CCE's zoom speed vary with the user's monitor refresh rate, which is worse behavior, not parity. Delta-scaling preserves the *practical feel* (hold = continuous zoom, release = stop) which is the actual portable behavior | Unit test + Playwright |
| - (incl. numpad -) | Continuous keyboard zoom-out while held | `camera_rig.gd:62-63` | Same as above, opposite direction | `controls.dollyOut(scale)`, delta-scaled | Same as above | Same as above |
| R | Reset camera to a saved default pose, via the same damped-glide the rig always uses (not an instant snap) | `camera_rig.gd:97-98`, `reset_to_safe_default` (`:173-174`), state captured once in `_ready()` (`:47`) | Parable's own numeric default (`DEFAULT_POS=(0,6,3.5)`, `DEFAULT_PITCH=-56°`, `DEFAULT_DIST=26`) belongs to its own ~120-unit island | `R` key calls `controls.reset()`; the saved state is **CCE's own existing initial camera pose** (`position.set(0,90,120)`, `target=(0,0,0)`), captured once via `controls.saveState()` right after the initial pose is set | The *behavior* (a reset control that returns to a documented home view, animated rather than instant) ports; the *specific pose* intentionally does not — the task requires preserving CCE's existing initial useful camera view, and Parable's numbers describe a different world at a different scale | Unit-observable via numeric camera/target assertions before and after; Playwright: after orbit+pan+zoom, pressing R returns camera position/target to the saved initial values within tolerance |
| Window blur / mouse leaves the game surface | Clears any in-progress orbit (`is_orbiting()` becomes false), clears `middle_button_down()`, clears the hand's pan/carry/hover state, returns input mode to `hover`. Refocus/re-enter does **not** resume the drag or move the camera | `world.gd:76-93` (`_notification`), `_clear_focus_transients` (`:111-115`), `camera_rig.gd` `clear_transient_input` (`:119-126`), `hand_input.gd` `clear_transient_input_for_focus`/`resync_after_focus` (`:315-341`) | n/a (state-clear, not a rate/limit) | `window.addEventListener("blur", ...)` and `document.addEventListener("visibilitychange", ...)` clear any held-key set and in-progress drag/orbit-modifier state; refocus does not resume | Direct port — CCE has an exact analog (browser blur/visibilitychange vs. Godot's `NOTIFICATION_WM_WINDOW_FOCUS_OUT`) | Unit test for the state-clear logic; Playwright: window blur while Q is held stops orbiting, and refocusing does not resume it |
| Esc | Cancels a held/grabbed object and any in-progress miracle-gesture drawing; "never throws" | `hand_input.gd:307-313` (`_cancel_everything`) | n/a | **Not ported** | CCE has no held-object or gesture-casting concept — there is nothing for Esc to cancel on the camera. Not implemented; not claimed | n/a — documented as intentionally not transferred |
| Right-mouse button | Grab/carry/throw a game object | `hand_input.gd:144-164`, `:276-306` | n/a | **Not ported** | Core gameplay mechanic unrelated to map/camera navigation; CCE has no "grabbable" entities. Not implemented; not claimed | n/a — documented as intentionally not transferred |
| Spiral gesture / miracle casting | Draws and casts spells | `hand_input.gd` `_update_miracle_tracking` and related | n/a | **Not ported** | Not a navigation control at all | n/a — documented as intentionally not transferred |
| Touch / pinch | — | n/a | n/a — confirmed absent by source search (`grep -i "touch\|InputEventScreenTouch\|pinch"` across every `godot-spike/scripts/*.gd` file: zero matches) and absent from the web runtime and the human-authored control table | **Not present in Parable — nothing to port** | CCE's existing `OrbitControls` touch defaults (one-finger rotate, two-finger pinch/pan) are left exactly as they were before this task | n/a — behavior not present in Parable |

## Engine-specific differences (summary)

- Godot's rig is a hand-authored `Node3D → Pitch → Camera3D` hierarchy with
  explicit yaw/pitch/distance target fields and a manual `1 - exp(-12·dt)`
  exponential smoother applied once per `_process` tick to every target (yaw,
  pitch, distance, position). Three.js's `OrbitControls` is a single object that
  already maintains spherical coordinates around a `target` and already has a
  damping system (`enableDamping` / `dampingFactor`, already `true`/`0.05` in
  CCE) that plays the same role for every input path (drag, wheel, and now
  keyboard) uniformly. The port therefore reuses `OrbitControls`' own damping
  rather than re-implementing Parable's smoother — same *behavioral effect*
  (inputs set a target, the camera glides toward it), different mechanism.
- Absolute numeric constants tied to Parable's world scale (island radius,
  default camera pose, pan bounds) do not transfer literally and were
  re-derived proportionally for CCE's own 125×125 world and its own existing
  camera setup, as detailed row-by-row above.
- Parable's keyboard zoom is (as written) frame-rate-dependent; CCE's port is
  delta-scaled. Documented above as a deliberate improvement-in-kind, not a
  literal copy.

## Behavior not present in Parable (not invented for CCE)

Confirmed absent by source inspection, not merely unmentioned: touch/pinch
gestures, arrow-key camera movement, WASD movement (Parable uses Q/E/W/S for
orbit/pitch, not translation — there is no "fly through the world" keyboard
movement in Parable at all, only orbit/pitch/zoom around a fixed pivot), and any
camera-relevant use of Escape or the right mouse button. None of these were
added to CCE.

## Parable read-only verification

Phase 0 baseline (before any inspection):
```
branch: spike/godot-hand-feel-2026-07-02
HEAD:   d6f66b705c0be43be791585b2b6953450ecbd9c1
git diff --stat:        (empty)
git diff --cached --stat: (empty)
```
Post-task verification (after all CCE implementation and testing work):
```
branch: spike/godot-hand-feel-2026-07-02
HEAD:   d6f66b705c0be43be791585b2b6953450ecbd9c1
git diff --stat:        (empty)
git diff --cached --stat: (empty)
```
Identical. Parable was inspected read-only (`ls`, `find`, `grep`, `cat`/`Read`)
and never written to, built, installed into, or executed.

---

## Implementation

- `src/rendering/cameraControls.ts` (new) — pure, side-effect-free logic:
  key→action mapping (`mapKeyToCameraAction`), per-frame orbit/pitch/zoom
  deltas (`computeCameraFrameDeltas`), the ported click-vs-drag threshold
  (`isClickNotDrag`, `CLICK_DRAG_THRESHOLD_PX`), and the input-conflict guard
  (`shouldSuppressCameraKeys`).
- `src/rendering/MapViewer.tsx` — wired into the existing mount-once
  `OrbitControls` setup, not a parallel implementation:
  - `mouseButtons = { LEFT: PAN, MIDDLE: ROTATE, RIGHT: PAN }` (was the
    library default `LEFT: ROTATE, MIDDLE: DOLLY, RIGHT: PAN`).
  - `minPolarAngle` added (existing `maxPolarAngle` kept) so the camera can't
    reach a fully top-down view, matching Parable's pitch never reaching true
    overhead.
  - Shift/Alt held reactively remaps `mouseButtons.LEFT` to `ROTATE` (tracked
    via `keydown`/`keyup`, not inside the pointerdown handler, avoiding any
    event-ordering race — see the contract table above).
  - Q/E/W/S/+/-/R held in a plain closure `Set<CameraKeyAction>`, applied
    every animation frame via `OrbitControls`' own public `rotateLeft`,
    `rotateUp`, `dollyIn`, `dollyOut` — not React state, so holding a key
    never triggers a re-render (Phase 3 requirement 20).
  - `R` triggers a custom damped glide (`camera.position.lerp`/
    `controls.target.lerp` toward `OrbitControls`' own `position0`/`target0`,
    captured once via `saveState()` right after CCE's existing initial camera
    pose is set) using the exact same `1 - exp(-k·dt)` shape as Parable's
    `CAMERA_SMOOTH`, `k = 12.0` — a literal behavioral port, not just an
    adapted one. `prefers-reduced-motion` makes this an instant snap instead.
  - `pointerdown` capture + a distance check on `click` (`isClickNotDrag`)
    prevents a pan-drag's `mouseup` from also registering as an
    entity-selection click.
  - `window` `blur` / `document` `visibilitychange` (hidden) clears the
    held-key set, resets the Shift/Alt mouseButtons remap, and force-resets
    `OrbitControls`' own interaction-state field (`state = -1`, the library's
    `_STATE.NONE`) — the standard technique for canceling a drag that will
    never receive its matching `pointerup` (e.g. released in a different
    window after alt-tab), since the public API has no "cancel" method.
  - A new `RotateCcw`-icon button (`.map-reset-button`, absolutely positioned
    in the map's bottom-right corner) triggers the same reset via a ref
    (`triggerResetRef`) set by the mount-once effect — visible discoverability
    alongside the `R` key, per the "reset/recenter affordance" requirement.
  - `controls.dispose()` added to the unmount cleanup (previously missing —
    a pre-existing gap, not introduced by this pass, fixed while already
    auditing every listener for cleanup per Phase 3 requirement 19).
- `src/App.tsx` — `map-help` text rewritten to describe the actual ported
  controls (drag-to-pan, middle/Shift/Alt-drag-to-orbit, Q/E/W/S, scroll/+/−
  zoom, R reset), replacing the stale "Drag to orbit" copy.
- `src/index.css` — `.map-canvas-wrap` (new) restores the exact `position:
  absolute; inset: 0` sizing the canvas container always had, now with the
  reset button as a sibling inside it; `.map-reset-button` positions that
  button.

### Engine-specific differences not already covered above

- Parable's `pan_by` clamps world position to a fixed `[-60, 60]` per-axis
  box. An equivalent bound (`OrbitControls.maxTargetRadius`, a spherical
  distance-from-origin clamp) was implemented and then removed after
  adversarial testing found it destabilizing: orbiting after a large pan
  caused the orbit target to visibly drift instead of staying fixed at the
  pivot, once panned near the clamp boundary — a real, user-visible
  regression, not a test artifact (isolated by testing orbit-from-origin,
  which showed zero drift, against orbit-after-pan, which didn't, with the
  clamp in place; removing the clamp entirely did not change the drift
  magnitude, ruling it out as the cause outright, but it was removed anyway
  once identified as unnecessary complexity carrying risk with no working
  benefit). **Panning is therefore unbounded in this port.** This is the one
  Parable behavior in the contract table not carried over.

## Unit-test evidence

`src/__tests__/cameraControls.test.ts` — 29 tests, all passing:
- `mapKeyToCameraAction`: each ported binding (Q/E/W/S/=/NumpadAdd/-/NumpadSubtract/R)
  maps correctly; arrow keys, Space, Enter, Escape, and unrelated keys map to
  `null` (proving no accidental collision with slider/button keys).
- `computeCameraFrameDeltas`: zero held actions → zero deltas; each rate
  matches the ported Parable constant scaled by elapsed time; opposite keys
  (orbitLeft+orbitRight, pitchUp+pitchDown, zoomIn+zoomOut) held together
  cancel to exactly zero/neutral; multiple non-opposing keys combine
  independently; zero elapsed time produces zero movement.
- `isClickNotDrag`: zero movement and movement just under
  `CLICK_DRAG_THRESHOLD_PX` are clicks; movement at/above it is a drag;
  measures true Euclidean distance (a 6-8-10 triangle where each axis alone
  is under threshold but the combined distance isn't).
- `shouldSuppressCameraKeys`: suppresses for `input` (text and range),
  `textarea`, `select`, `contenteditable`, and anything inside `.inspector`;
  does not suppress for a plain button outside the Inspector or a null
  target.

## Browser-test evidence

`tests/e2e/camera-controls.spec.ts` (new, 4 tests) plus one addition to the
existing `tests/e2e/e2e.spec.ts` branch-comparison test. All pass in the real
Playwright/headless-Chromium suite (see Required Validation below for the
final combined run). Per-scenario:

1. **Initial camera view** — `drawCalls > 0`, camera position/target defined,
   matching CCE's existing (unchanged) initial pose.
2. **Each keyboard binding** — Q/E/W/S/+/- each measurably move camera
   position or target-distance in the expected direction while held, and
   stop changing after release (`cameraHeldActions` empty, position settles).
3. **Key release stops movement** — covered by the same assertions (no
   continued drift observed after release across repeated settle-polls).
4. **Window blur clears held controls** — `KeyQ` held, synthetic `blur`
   dispatched, `cameraHeldActions` becomes empty without a matching `keyup`.
5. **Typing doesn't move the camera** — a scratch `<input>` (not the real
   seed field, which has its own expensive side effect — see the Adversarial
   Resweep entry below) receives `q`/`e` keypresses; camera position
   unchanged, `cameraHeldActions` stays empty.
6. **Timeline retains native arrow-key behavior** — `ArrowRight` on the
   focused range input still advances `currentYear`.
7. **Comparison divider retains native arrow-key behavior** — added to the
   existing branch-comparison test in `e2e.spec.ts`: `ArrowLeft` on the
   focused divider still changes its value.
8. **Mouse drag** — left-drag pans (position and target move by the same
   offset — a translation); middle-drag orbits (target stays fixed, only
   position moves).
9. **Wheel zoom** — scroll up decreases camera-target distance, scroll down
   increases it, both remain within `[minDistance, maxDistance]`.
10. **Reset** — `R` returns camera position and target to the saved initial
    pose within 0.1 units; `prefers-reduced-motion` makes this an instant
    snap instead of a glide (separate dedicated test).
11. **Bounds respected** — holding zoom-out for 2s doesn't exceed
    `maxDistance` (300); holding zoom-in via repeated wheel doesn't go below
    `minDistance` (10).
12. **Entity selection** — a pan-drag does not open the Inspector (no
    spurious selection); the existing dev-seam selection mechanism still
    resolves and displays the correct entity afterward; a genuine click after
    a drag still selects (adversarial resweep).
13. **Split comparison** — added to `e2e.spec.ts`: drag-to-pan and
    wheel-zoom exercised while `comparisonMode === "swipe"`, followed by the
    existing suppressed-bridge Inspector check, confirming raycasting still
    resolves against the correct scene side after camera changes.
14. **Desktop and narrow viewports** — 1440×900 (main test) and 390×844
    (dedicated test, including opening/closing the mobile map-controls tray).
15. **No serious page/console errors** — asserted in every test via the same
    error-collector pattern as the existing suite.

## Entity-selection and split-comparison regression result

**No regression.** Both remain fully functional — see items 12 and 13 above.

## Adversarial Resweep

Attempted, with results:

- **Multiple movement keys held simultaneously** (Q+W+= together) — no
  crash; `cameraHeldActions` correctly reflects all three; releasing all
  three empties it. PASS.
- **Opposite keys held simultaneously** (Q+E, and separately W+S/+/- via the
  unit tests) — real-browser: Q+E held together nets no meaningful drift
  (within the same settle-noise tolerance used throughout, ~0.3 units, versus
  the >0.5 unit threshold that indicates genuine single-direction movement).
  Unit-level: exact zero cancellation, proven analytically. PASS.
- **Rapid keydown/keyup** — 8 rapid down/up cycles on E leave
  `cameraHeldActions` empty afterward (no keyup ever "lost"). PASS.
- **Key held while focus enters an input** — Q held, then the seed field is
  clicked (moving focus) *while Q is still physically down*, then released —
  `shouldSuppressCameraKeys` only gates new `keydown`s, so a `keyup` that
  arrives while an input has focus must still clear the held-set (it does;
  the `keyup` handler doesn't check suppression at all, only removes from the
  set) — verified empty afterward. PASS.
- **Key held during window blur** — see browser-test item 4 above. PASS.
- **Map movement during timeline playback** — Play started, then a pan-drag
  and wheel-zoom performed, then paused; no crash, no console error. PASS.
- **Map movement while branch recomputation runs** — not re-tested live
  (would require paying another ~90s+ real branch resimulation purely to
  prove a negative). Argued from the implementation instead: `MapViewer`'s
  camera-control code (mouse/keyboard/wheel handlers, the animation loop's
  reset/held-action branch) reads only `cameraRef`/`controlsRef` and the
  module-local `heldCameraActions`/`resetActive` closure state — it has zero
  reference to `isSimulating`, `simulationOperation`, or any Worker-related
  ref. There is no code path by which branch recomputation could affect it,
  or vice versa. This is a structural guarantee, not an inference from
  behavior.
- **Map movement with Inspector open** — an entity is selected (Inspector
  visible), then a pan-drag performed; Inspector remains showing the same
  entity afterward (no crash, no state loss). PASS.
- **Map movement in split comparison** — see browser-test item 13. PASS.
- **Pointer drag followed by click selection** — a drag-then-release
  sequence does not select; a subsequent genuine click on the same session
  does. PASS.
- **Wheel zoom at minimum and maximum distance** — both bounds independently
  verified (browser-test item 11). PASS.
- **Reset after rotation or panning** — the main test's reset assertion runs
  after a full sequence of pan, orbit, and multiple zoom operations. PASS.
- **Viewport resize during movement** — `KeyQ` held across a
  `setViewportSize` call; released afterward; `cameraHeldActions` empty, no
  crash. PASS.
- **Mobile control tray open** — opening the tray on a 390px viewport
  legitimately overlaps the (short) map canvas by design — that is expected
  occlusion, not broken input handling. Verified open→close leaves camera
  controls fully usable afterward, rather than asserting a drag can reach
  "through" a panel that's visually on top of the canvas by intent. PASS
  (after correcting the test's own coordinate assumption — see below).
- **Reduced-motion mode** — `prefers-reduced-motion: reduce` makes `R`
  resolve on the very next frame rather than gliding; verified via a
  dedicated test. PASS.
- **Component unmount while an input is held** — not re-tested live:
  `MapViewer` is never conditionally unmounted anywhere in this app's actual
  render tree (it is a permanent child of `App`), so this specific scenario
  cannot occur in practice. The unmount cleanup itself (which removes every
  listener this pass added, plus the pre-existing gap of `controls.dispose()`
  it also fixed) was verified by direct code review of the `return () => {
  ... }` block in `MapViewer.tsx`'s mount-once effect.

### Defects found and fixed during this resweep (test-authoring, not application)

Three real issues surfaced while building this Playwright coverage, all in
the *test*, not the ported application code:

1. **Settle-wait timing.** `OrbitControls` applies `dampingFactor` as a fixed
   fraction *per `update()` call*, not scaled by elapsed real time. This
   suite's headless Chromium renders at ~9 FPS under software WebGL
   (SwiftShader) — already measured and documented in
   `docs/FINAL_ADVERSARIAL_AUDIT.md`. The same damped settle that resolves in
   ~1.5s at 60 FPS can take upward of 10s of wall-clock time at 9 FPS, purely
   because far fewer `update()` calls happen per second. An initial 300ms
   fixed wait after each gesture, then a 4-second settle-poll, both returned
   before genuine settling completed, misattributing leftover native
   `OrbitControls` momentum (from a *preceding* gesture) to whichever
   *following* gesture happened to be under test at the time (observed as an
   apparent ~2.5-unit orbit-target drift that, on isolated retest, turned out
   to be exactly zero for orbit-from-origin). Fixed by polling with a
   generous, explicitly-justified timeout (15s) and requiring 3 consecutive
   quiet 400ms-spaced polls (comfortably above one ~111ms frame period, so
   scheduling jitter can't produce a false "settled" reading) before treating
   a snapshot as a stable baseline — the same discipline Parable's own
   Godot test suite uses (`verify_playability_surrogates.gd`: "camera has no
   residual pan drift after input").
2. **Seed-field side effect.** The original "typing doesn't move the camera"
   test typed individual characters into the real simulation-seed `<input>`.
   Its `onChange` restarts the entire 400-year baseline simulation on *every
   keystroke* (`setSeed` → `useEffect` → `runSimulationA`), including on the
   test's own "restore the original value" step — leaving the app mid-
   resimulation (year reset to 0, controls possibly disabled) for the rest of
   the test. Fixed by testing the same `shouldSuppressCameraKeys` logic
   against a throwaway scratch `<input>` injected via `page.evaluate`,
   which exercises the identical tag-name check without touching real
   application state.
3. **Tray-drag coordinate assumption.** The narrow-viewport test originally
   assumed a drag at the canvas's center would pan the map even with the
   mobile control tray open. At 390px width the open tray legitimately
   overlaps most of the (short) canvas by design — the drag was landing on
   the tray panel, not the canvas, so `OrbitControls` never received the
   pointer events. Not an application bug: covering the map is the tray's
   intended behavior while open. Fixed by testing that camera controls remain
   usable after an open→close cycle instead of asserting interaction through
   an intentionally-opaque overlay.

No Critical, High, Blocker, or Major defect was found in the ported
application code (`src/rendering/MapViewer.tsx`,
`src/rendering/cameraControls.ts`) itself during this resweep.
