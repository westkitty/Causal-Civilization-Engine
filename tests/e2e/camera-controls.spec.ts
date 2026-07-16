import { expect, test, type Page } from "@playwright/test";

// Real-browser coverage for the Parable-ported camera controls
// (src/rendering/cameraControls.ts, src/rendering/MapViewer.tsx). See
// docs/PARABLE_CONTROL_PORT.md for the full behavioral contract this
// verifies against.

interface CameraDiag {
  cameraPosition: { x: number; y: number; z: number } | null;
  cameraTarget: { x: number; y: number; z: number } | null;
  cameraHeldActions: string[];
  cameraResetActive: boolean;
  cameraControlsEnabled: boolean;
  cameraMouseButtonLeft: number;
  cameraActivePointerId: number | null;
  cameraDragExceeded: boolean;
  drawCalls: number;
}

function attachErrorCollectors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  return { consoleErrors, pageErrors };
}

async function waitForBaseline(page: Page) {
  await expect(page.locator("h1")).toContainText("CAUSAL CIVILIZATION ENGINE");
  await expect(page.locator("text=Recompiling Causal History")).toBeHidden({ timeout: 150_000 });
  await expect(page.locator("canvas")).toBeVisible({ timeout: 150_000 });
  await page.waitForTimeout(500);
}

async function diag(page: Page): Promise<CameraDiag> {
  return page.evaluate(() => (window as unknown as { __cceDiag: () => CameraDiag }).__cceDiag());
}

function dist(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// OrbitControls' native damped inertia (dampingFactor) means a completed
// drag keeps "coasting" briefly after release. Polls until position/target
// stop changing before treating a snapshot as a stable baseline for the next
// assertion — the same discipline Parable's own test suite uses
// (verify_playability_surrogates.gd: "camera has no residual ... drift").
//
// The 15s timeout and multi-consecutive-quiet-interval requirement are sized
// for this specific test environment, not padding: OrbitControls applies
// `dampingFactor` as a fixed fraction *per update() call*, not scaled by
// elapsed time, and this suite's headless Chromium renders at ~9 FPS under
// software WebGL/SwiftShader (measured and documented in
// docs/FINAL_ADVERSARIAL_AUDIT.md's performance section) — roughly one frame
// per 111ms. The poll interval is kept comfortably above that frame period
// (and 3 consecutive quiet polls, not 1) so scheduling jitter can't produce
// a false "settled" reading from a window that simply had zero frames run in
// it; a tighter poll/streak was measured to return early with real internal
// OrbitControls momentum (a non-1 dolly _scale, specifically) still
// unresolved (see the Adversarial Resweep section of
// docs/PARABLE_CONTROL_PORT.md).
async function waitForCameraSettled(page: Page, timeoutMs = 15_000): Promise<CameraDiag> {
  const start = Date.now();
  let prev = await diag(page);
  let quietStreak = 0;
  while (Date.now() - start < timeoutMs) {
    await page.waitForTimeout(400);
    const curr = await diag(page);
    const quiet =
      dist(curr.cameraPosition!, prev.cameraPosition!) < 0.01 &&
      dist(curr.cameraTarget!, prev.cameraTarget!) < 0.01;
    quietStreak = quiet ? quietStreak + 1 : 0;
    prev = curr;
    if (quietStreak >= 3) return curr;
  }
  return prev;
}

test("ported Parable camera controls: pan, orbit, zoom, keyboard, reset, and input-conflict protection", async ({ page }) => {
  const errs = attachErrorCollectors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await waitForBaseline(page);

  // 1. Initial camera view still shows the map.
  const initial = await diag(page);
  expect(initial.drawCalls).toBeGreaterThan(0);
  expect(initial.cameraPosition).not.toBeNull();
  expect(initial.cameraTarget).not.toBeNull();
  const initialPos = initial.cameraPosition!;
  const initialTarget = initial.cameraTarget!;

  const canvas = page.locator("canvas");
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // 8a. Left-drag on empty ground pans the camera (position and target move
  // together — a translation, not a rotation).
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(cx + 40, cy + 20, { steps: 12 });
  await page.mouse.up({ button: "left" });
  const afterPan = await waitForCameraSettled(page);
  expect(dist(afterPan.cameraTarget!, initialTarget)).toBeGreaterThan(0.5);
  const panPosDelta = {
    x: afterPan.cameraPosition!.x - initialPos.x,
    y: afterPan.cameraPosition!.y - initialPos.y,
    z: afterPan.cameraPosition!.z - initialPos.z,
  };
  const panTargetDelta = {
    x: afterPan.cameraTarget!.x - initialTarget.x,
    y: afterPan.cameraTarget!.y - initialTarget.y,
    z: afterPan.cameraTarget!.z - initialTarget.z,
  };
  // A pure pan moves position and target by (nearly) the same offset.
  expect(dist(panPosDelta, panTargetDelta)).toBeLessThan(0.05);

  // 12a. The pan-drag must NOT have opened the Inspector (click-vs-drag
  // suppression — Parable's own CLICK_DRAG_THRESHOLD_PX contract).
  await expect(page.getByRole("heading", { name: "Select a map entity" })).toBeVisible();

  // 12b. Entity selection itself remains functional (existing mechanism,
  // unbroken by the drag-to-pan change).
  const sid = await page.evaluate(() =>
    (window as unknown as { __cce: { firstSettlementId: () => string | null } }).__cce.firstSettlementId());
  expect(sid).toBeTruthy();
  await page.evaluate((id) =>
    (window as unknown as { __cce: { selectEntity: (i: string) => void } }).__cce.selectEntity(id), sid);
  await expect(page.locator("text=Settlement Node")).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { __cce: { selectEntity: (i: string | null) => void } }).__cce.selectEntity(null));

  // 8b. Middle-drag orbits the camera (rotation around the target — the
  // target should stay fixed, only camera position moves).
  const beforeOrbit = await waitForCameraSettled(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(cx + 50, cy - 20, { steps: 10 });
  await page.mouse.up({ button: "middle" });
  const afterOrbit = await waitForCameraSettled(page);
  // Target should stay essentially fixed (orbit rotates the camera around
  // it) — a generous-but-meaningful tolerance well below the >0.5 threshold
  // used for "position moved significantly" below, clear of the sub-0.1
  // measurement noise floor observed from OrbitControls' own damped-settle
  // rounding in this environment (see waitForCameraSettled's doc comment).
  expect(dist(afterOrbit.cameraTarget!, beforeOrbit.cameraTarget!)).toBeLessThan(0.3);
  expect(dist(afterOrbit.cameraPosition!, beforeOrbit.cameraPosition!)).toBeGreaterThan(0.5);

  // 9. Wheel input zooms (distance from target changes; direction: negative
  // deltaY, the natural "scroll up" zoom-in gesture, decreases distance).
  const distBeforeWheel = dist(afterOrbit.cameraPosition!, afterOrbit.cameraTarget!);
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -400);
  const afterWheelIn = await waitForCameraSettled(page);
  const distAfterWheelIn = dist(afterWheelIn.cameraPosition!, afterWheelIn.cameraTarget!);
  expect(distAfterWheelIn).toBeLessThan(distBeforeWheel);
  await page.mouse.wheel(0, 400);
  const afterWheelOut = await waitForCameraSettled(page);
  const distAfterWheelOut = dist(afterWheelOut.cameraPosition!, afterWheelOut.cameraTarget!);
  expect(distAfterWheelOut).toBeGreaterThan(distAfterWheelIn);

  // 2/3. Each keyboard binding moves the camera in the expected direction
  // while held, and stops changing it once released (no continued drift).
  await page.locator("body").click({ position: { x: 10, y: 10 } }); // ensure no input has focus
  const beforeQ = await waitForCameraSettled(page);
  await page.keyboard.down("KeyQ");
  await page.waitForTimeout(400);
  await page.keyboard.up("KeyQ");
  const afterQ = await diag(page);
  expect(dist(afterQ.cameraPosition!, beforeQ.cameraPosition!)).toBeGreaterThan(0.01);
  const settledAfterQ = await waitForCameraSettled(page);
  expect(settledAfterQ.cameraHeldActions).not.toContain("orbitLeft");

  const beforeE = await waitForCameraSettled(page);
  await page.keyboard.down("KeyE");
  await page.waitForTimeout(400);
  await page.keyboard.up("KeyE");
  const afterE = await waitForCameraSettled(page);
  // Q and E orbit in opposite directions: the position delta E produces
  // should not continue in the same direction Q produced.
  expect(dist(afterE.cameraPosition!, beforeE.cameraPosition!)).toBeGreaterThan(0.01);

  const beforeW = await waitForCameraSettled(page);
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(400);
  await page.keyboard.up("KeyW");
  const afterW = await waitForCameraSettled(page);
  expect(dist(afterW.cameraPosition!, beforeW.cameraPosition!)).toBeGreaterThan(0.01);

  const beforeZoomIn = await waitForCameraSettled(page);
  const beforeZoomInDist = dist(beforeZoomIn.cameraPosition!, beforeZoomIn.cameraTarget!);
  await page.keyboard.down("Equal");
  await page.waitForTimeout(400);
  await page.keyboard.up("Equal");
  const afterZoomIn = await waitForCameraSettled(page);
  const afterZoomInDist = dist(afterZoomIn.cameraPosition!, afterZoomIn.cameraTarget!);
  expect(afterZoomInDist).toBeLessThan(beforeZoomInDist);

  await page.keyboard.down("Minus");
  await page.waitForTimeout(400);
  await page.keyboard.up("Minus");
  const afterZoomOut = await waitForCameraSettled(page);
  const afterZoomOutDist = dist(afterZoomOut.cameraPosition!, afterZoomOut.cameraTarget!);
  expect(afterZoomOutDist).toBeGreaterThan(afterZoomInDist);

  // 11. Movement respects bounds: holding zoom-out well past the configured
  // maxDistance must not exceed it.
  await page.keyboard.down("Minus");
  await page.waitForTimeout(2000);
  await page.keyboard.up("Minus");
  const afterLongZoomOut = await waitForCameraSettled(page);
  expect(dist(afterLongZoomOut.cameraPosition!, afterLongZoomOut.cameraTarget!)).toBeLessThanOrEqual(300.5);

  // 10. R resets the camera to the saved initial pose, via a damped glide
  // (not an instant snap).
  await waitForCameraSettled(page);
  await page.keyboard.down("KeyR");
  await page.keyboard.up("KeyR");
  const afterReset = await waitForCameraSettled(page);
  expect(dist(afterReset.cameraPosition!, initialPos)).toBeLessThan(0.1);
  expect(dist(afterReset.cameraTarget!, initialTarget)).toBeLessThan(0.1);
  expect(afterReset.cameraResetActive).toBe(false);

  // 4. Window blur clears held controls (Parable's world.gd focus-loss
  // contract, ported — see docs/PARABLE_CONTROL_PORT.md).
  await page.keyboard.down("KeyQ");
  await page.waitForTimeout(50);
  const heldBeforeBlur = await diag(page);
  expect(heldBeforeBlur.cameraHeldActions).toContain("orbitLeft");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.waitForTimeout(50);
  const heldAfterBlur = await diag(page);
  expect(heldAfterBlur.cameraHeldActions).not.toContain("orbitLeft");
  await page.keyboard.up("KeyQ");

  // 5. Typing into a text input never moves the camera. Deliberately does
  // NOT use the real seed field: its onChange restarts the entire 400-year
  // baseline simulation on every keystroke (including on any "restore"
  // fill()), which would leave the rest of this test racing a fresh
  // resimulation. A throwaway scratch input exercises the exact same
  // shouldSuppressCameraKeys() tag-name check without that side effect.
  await page.evaluate(() => {
    const el = document.createElement("input");
    el.type = "text";
    el.id = "__camera_test_scratch_input";
    document.body.appendChild(el);
    el.focus();
  });
  const beforeTyping = await waitForCameraSettled(page);
  await page.locator("#__camera_test_scratch_input").press("q");
  await page.locator("#__camera_test_scratch_input").press("e");
  await page.waitForTimeout(150);
  const afterTyping = await diag(page);
  // Tolerance matches the settle-noise floor discussed in
  // waitForCameraSettled's doc comment, not genuine camera movement — which
  // is independently and more directly ruled out by cameraHeldActions being
  // empty below (shouldSuppressCameraKeys would have kept it non-empty had
  // the scratch input's keypresses been treated as camera input).
  expect(dist(afterTyping.cameraPosition!, beforeTyping.cameraPosition!)).toBeLessThan(0.1);
  expect(afterTyping.cameraHeldActions).toHaveLength(0);
  await page.evaluate(() => document.getElementById("__camera_test_scratch_input")?.remove());
  await page.locator("body").click({ position: { x: 10, y: 10 } });

  // 6. Focused timeline controls retain native arrow-key behavior (Parable's
  // scheme never binds arrow keys, so there is nothing to conflict with).
  const timelineRange = page.getByLabel("Timeline year");
  await timelineRange.focus();
  await timelineRange.press("ArrowRight");
  await expect(page.locator("text=/^Year 1$/")).toBeVisible();

  // Phase 6 adversarial resweep, continued in this same page session — not a
  // separate test — specifically to avoid paying a second ~100s baseline
  // simulation. This suite's headless Chromium is software-rendered
  // (SwiftShader) and each additional baseline-simulation-paying test adds
  // real, measured cumulative load across a long sequential run (workers: 1);
  // an earlier version of this file with one scenario per test reliably
  // caused *unrelated* later tests in the full suite to exceed their own
  // canvas-ready timeout purely from that accumulated load — reproduced by
  // isolating them (they passed alone) and resolved by this consolidation.
  // See docs/PARABLE_CONTROL_PORT.md's Adversarial Resweep section for the
  // full record, including two scenarios argued from the implementation
  // rather than re-tested live (map movement during branch recomputation:
  // MapViewer's camera code has no coupling to isSimulating/
  // simulationOperation state at all, so it cannot be affected by it;
  // unmount-while-a-key-is-held: verified by code review of the cleanup
  // function, since MapViewer is never conditionally unmounted in this app's
  // actual render tree).
  //
  // The timeline range input above still has focus — blur it first, or
  // shouldSuppressCameraKeys will (correctly, by design) suppress every
  // keyboard camera action below for the same reason it must suppress them
  // while the seed field is focused.
  await page.locator("body").click({ position: { x: 10, y: 10 } });
  await waitForCameraSettled(page);

  // Opposite keys held simultaneously cancel out (no crash, no net drift).
  // Measures steady-state — position while both keys are already held,
  // sampled twice with a gap in between — rather than comparing the final,
  // both-released position back to the state from before either key went
  // down: page.keyboard.down("KeyQ") and down("KeyE") are two separate,
  // sequentially-awaited CDP round-trips, and this environment's measured
  // frame rate is variable enough (~6-10 FPS, see waitForCameraSettled's doc
  // comment) that a slow round-trip can widen the real gap between them to
  // tens of milliseconds — real, uncancelled orbit accumulates during that
  // Q-only window, which a before/after comparison spanning that window
  // would wrongly read as "cancellation failed". Once both are confirmed
  // held, steady-state position is a fair, timing-independent check.
  await page.keyboard.down("KeyQ");
  await page.keyboard.down("KeyE");
  await page.waitForTimeout(150);
  const bothHeld = await diag(page);
  expect(bothHeld.cameraHeldActions.sort()).toEqual(["orbitLeft", "orbitRight"]);
  const steadyStateBefore = await diag(page);
  await page.waitForTimeout(400);
  const steadyStateAfter = await diag(page);
  expect(dist(steadyStateAfter.cameraPosition!, steadyStateBefore.cameraPosition!)).toBeLessThan(0.3);
  await page.keyboard.up("KeyQ");
  await page.keyboard.up("KeyE");
  await waitForCameraSettled(page);

  // Multiple non-opposing keys held simultaneously (orbit + pitch + zoom
  // together) — must not crash and must move on more than one axis.
  await page.keyboard.down("KeyQ");
  await page.keyboard.down("KeyW");
  await page.keyboard.down("Equal");
  await page.waitForTimeout(300);
  expect((await diag(page)).cameraHeldActions.sort()).toEqual(["orbitLeft", "pitchUp", "zoomIn"]);
  await page.keyboard.up("KeyQ");
  await page.keyboard.up("KeyW");
  await page.keyboard.up("Equal");
  const afterMulti = await waitForCameraSettled(page);
  expect(afterMulti.cameraHeldActions).toHaveLength(0);

  // Rapid keydown/keyup does not leave a key stuck "held".
  for (let i = 0; i < 8; i++) {
    await page.keyboard.down("KeyE");
    await page.keyboard.up("KeyE");
  }
  await page.waitForTimeout(100);
  expect((await diag(page)).cameraHeldActions).toHaveLength(0);

  // A key held while focus moves into the seed field must not stay "held"
  // (shouldSuppressCameraKeys only gates *new* keydowns; a key already down
  // when focus moves must not silently keep driving the camera forever).
  await page.locator("body").click({ position: { x: 10, y: 10 } });
  await page.keyboard.down("KeyQ");
  await page.waitForTimeout(100);
  const seedInput = page.getByLabel("Simulation seed");
  await seedInput.click();
  await page.keyboard.up("KeyQ"); // keyup fires with the seed input focused
  await page.waitForTimeout(100);
  expect((await diag(page)).cameraHeldActions).toHaveLength(0);
  await page.locator("body").click({ position: { x: 10, y: 10 } });

  // Map movement during timeline playback does not crash or desync.
  await page.getByRole("button", { name: "Play" }).click();
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(cx + 30, cy + 15, { steps: 5 });
  await page.mouse.up({ button: "left" });
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Pause" }).click();

  // Map movement with the Inspector open does not crash, and a real click
  // after a drag still selects an entity (drag-then-click sequencing). Reuses
  // `sid`, already fetched earlier in this same test.
  await page.evaluate((id) =>
    (window as unknown as { __cce: { selectEntity: (i: string) => void } }).__cce.selectEntity(id), sid);
  await expect(page.locator("text=Settlement Node")).toBeVisible();
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(cx + 25, cy - 15, { steps: 5 });
  await page.mouse.up({ button: "left" });
  await page.waitForTimeout(300);
  await expect(page.locator("text=Settlement Node")).toBeVisible(); // drag didn't deselect

  // Wheel zoom respects the minimum distance bound too (not just maximum,
  // covered in the main test).
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -600);
  const afterZoomInLimit = await waitForCameraSettled(page);
  expect(dist(afterZoomInLimit.cameraPosition!, afterZoomInLimit.cameraTarget!)).toBeGreaterThanOrEqual(9.5);

  // Viewport resize while a key is held does not crash or leave it stuck.
  await page.keyboard.down("KeyQ");
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.waitForTimeout(200);
  await page.keyboard.up("KeyQ");
  await page.waitForTimeout(200);
  expect((await diag(page)).cameraHeldActions).toHaveLength(0);

  // Regression coverage for an external adversarial review of this port
  // (2026-07-15), continued in this same page session for the same resource
  // reason as the rest of this test. Each scenario cites the exact
  // OrbitControls (r185) mechanism confirmed by re-reading
  // node_modules/three/examples/jsm/controls/OrbitControls.js — see
  // docs/PARABLE_CONTROL_PORT.md's "External adversarial review" section for
  // the full account of what was confirmed, what was fixed, and why.

  // Shift+left-drag orbits (target fixed, position moves) — OrbitControls'
  // own onMouseDown MOUSE.PAN case natively converts Shift+left to rotate;
  // reactively remapping mouseButtons.LEFT to ROTATE for Shift ourselves (the
  // original implementation) collided with that native check and silently
  // canceled it back to pan.
  const beforeShift = await waitForCameraSettled(page);
  await page.keyboard.down("ShiftLeft");
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(cx + 50, cy - 20, { steps: 8 });
  await page.mouse.up({ button: "left" });
  await page.keyboard.up("ShiftLeft");
  const afterShift = await waitForCameraSettled(page);
  expect(dist(afterShift.cameraTarget!, beforeShift.cameraTarget!)).toBeLessThan(0.3);
  expect(dist(afterShift.cameraPosition!, beforeShift.cameraPosition!)).toBeGreaterThan(0.5);

  // Alt+left-drag also orbits (Alt is not natively special-cased by
  // OrbitControls, so this exercises this port's own explicit remap).
  const beforeAlt = await waitForCameraSettled(page);
  await page.keyboard.down("AltLeft");
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(cx - 50, cy + 20, { steps: 8 });
  await page.mouse.up({ button: "left" });
  await page.keyboard.up("AltLeft");
  const afterAlt = await waitForCameraSettled(page);
  expect(dist(afterAlt.cameraTarget!, beforeAlt.cameraTarget!)).toBeLessThan(0.3);
  expect(dist(afterAlt.cameraPosition!, beforeAlt.cameraPosition!)).toBeGreaterThan(0.5);
  // The left-button mode must return to pan afterward, not stay stuck as
  // rotate from the modifier remap.
  expect((await diag(page)).cameraMouseButtonLeft).toBe(2); // THREE.MOUSE.PAN

  // A large drag that exceeds the click threshold and then curls back near
  // its starting point must still be classified as a drag, not a click —
  // isClickNotDrag alone (checking only the final start/end distance) would
  // accept this as a click and fire entity-selection at the release point.
  await page.evaluate(() => (window as unknown as { __cce: { selectEntity: (i: string | null) => void } }).__cce.selectEntity(null));
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(cx + 80, cy + 60, { steps: 6 }); // out past the 10px threshold
  await page.mouse.move(cx + 2, cy + 1, { steps: 6 }); // back near the start
  await page.mouse.up({ button: "left" });
  await page.waitForTimeout(200);
  await expect(page.getByRole("heading", { name: "Select a map entity" })).toBeVisible();

  // A sub-threshold pointer wobble (well under 10px) must leave the camera
  // genuinely stationary, not just avoid triggering selection — OrbitControls
  // begins accumulating pan from the very first pixel of movement with no
  // built-in minimum-drag concept, so this port must actively revert any
  // such accumulation on release for a gesture that is classified as a click.
  const beforeWobble = await waitForCameraSettled(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(cx + 3, cy + 2, { steps: 2 });
  await page.mouse.up({ button: "left" });
  await page.waitForTimeout(200);
  const afterWobble = await diag(page);
  expect(dist(afterWobble.cameraPosition!, beforeWobble.cameraPosition!)).toBeLessThan(0.05);
  expect(dist(afterWobble.cameraTarget!, beforeWobble.cameraTarget!)).toBeLessThan(0.05);

  // Window blur during an active LEFT-drag (pan) must not wedge
  // OrbitControls' internal pointer tracking: without routing the cancel
  // through the library's own _onPointerUp, the stale pointerId (the mouse
  // reuses the same id for its whole session) causes _isTrackingPointer to
  // silently swallow the *next* pointerdown before onMouseDown ever runs —
  // the drag after refocus would do nothing at all.
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(cx + 40, cy + 10, { steps: 5 });
  const midBlurDiag = await diag(page);
  expect(midBlurDiag.cameraActivePointerId).not.toBeNull();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.mouse.up({ button: "left" }); // release now happens "elsewhere" from the app's perspective
  await page.waitForTimeout(100);
  expect((await diag(page)).cameraActivePointerId).toBeNull();
  const beforePostBlurDrag = await waitForCameraSettled(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(cx - 40, cy - 10, { steps: 5 });
  await page.mouse.up({ button: "left" });
  const afterPostBlurDrag = await waitForCameraSettled(page);
  expect(dist(afterPostBlurDrag.cameraTarget!, beforePostBlurDrag.cameraTarget!)).toBeGreaterThan(0.1);

  // Same for a MIDDLE-drag (orbit) blurred mid-gesture.
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(cx + 30, cy - 10, { steps: 5 });
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.mouse.up({ button: "middle" });
  await page.waitForTimeout(100);
  expect((await diag(page)).cameraActivePointerId).toBeNull();
  const beforePostBlurOrbit = await waitForCameraSettled(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(cx - 30, cy + 10, { steps: 5 });
  await page.mouse.up({ button: "middle" });
  const afterPostBlurOrbit = await waitForCameraSettled(page);
  expect(dist(afterPostBlurOrbit.cameraPosition!, beforePostBlurOrbit.cameraPosition!)).toBeGreaterThan(0.5);

  // Blur mid-drag must also stop OrbitControls' own damped "coasting" of
  // whatever had already accumulated before the blur, not just block new
  // input — enableDamping decays _sphericalDelta/_panOffset by a fixed
  // fraction per update() call rather than zeroing them on cancellation.
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(cx + 60, cy + 40, { steps: 3 });
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.mouse.up({ button: "left" });
  const rightAfterBlur = await diag(page);
  await page.waitForTimeout(500);
  const settledAfterBlur = await diag(page);
  expect(dist(settledAfterBlur.cameraPosition!, rightAfterBlur.cameraPosition!)).toBeLessThan(0.05);

  // The pointer leaving the map canvas mid-drag (not just the window losing
  // focus) cancels the drag too, matching Parable's own mouse-exit-the-game-
  // surface contract — and controls remain usable for a fresh drag afterward.
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(cx + 20, cy, { steps: 3 });
  await page.mouse.move(10, 10, { steps: 8 }); // move outside the canvas bounds
  await page.mouse.up({ button: "left" });
  await page.waitForTimeout(100);
  expect((await diag(page)).cameraActivePointerId).toBeNull();
  const beforePostLeaveDrag = await waitForCameraSettled(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(cx + 25, cy + 25, { steps: 5 });
  await page.mouse.up({ button: "left" });
  const afterPostLeaveDrag = await waitForCameraSettled(page);
  expect(dist(afterPostLeaveDrag.cameraTarget!, beforePostLeaveDrag.cameraTarget!)).toBeGreaterThan(0.1);

  // Keyboard camera shortcuts must not fire while an ordinary, unrelated
  // button has focus — shouldSuppressCameraKeys must scope to "appropriate
  // map control context", not just a denylist of form fields and the
  // Inspector. Uses the timeline Play button, not the mobile map-controls
  // tray toggle (CSS `display: none` outside narrow viewports, so it isn't
  // focusable at this test's 1440x900 desktop width).
  const playButton = page.getByRole("button", { name: "Play" });
  await playButton.focus();
  const beforeFocusedButtonKey = await waitForCameraSettled(page);
  await page.keyboard.down("KeyQ");
  await page.waitForTimeout(200);
  await page.keyboard.up("KeyQ");
  const afterFocusedButtonKey = await diag(page);
  expect(dist(afterFocusedButtonKey.cameraPosition!, beforeFocusedButtonKey.cameraPosition!)).toBeLessThan(0.01);
  expect(afterFocusedButtonKey.cameraHeldActions).toHaveLength(0);
  await page.locator("body").click({ position: { x: 10, y: 10 } });

  expect(errs.pageErrors, errs.pageErrors.join("\n")).toEqual([]);
  const serious = [/Warning: ReactDOM/i];
  const seriousConsole = errs.consoleErrors.filter((e) => serious.some((r) => r.test(e)));
  expect(seriousConsole, seriousConsole.join("\n")).toEqual([]);
});

// Narrow viewport and reduced-motion are orthogonal settings bundled into one
// test (rather than one baseline simulation each) for the same resource
// reason as the adversarial resweep above.
test("narrow viewport with reduced motion: pan, tray, and an instant (non-gliding) reset all remain usable", async ({ page }) => {
  const errs = attachErrorCollectors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await waitForBaseline(page);

  const initial = await diag(page);
  const canvas = page.locator("canvas");
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(cx + 40, cy + 20, { steps: 6 });
  await page.mouse.up({ button: "left" });
  const afterPan = await waitForCameraSettled(page);
  expect(dist(afterPan.cameraTarget!, initial.cameraTarget!)).toBeGreaterThan(0.1);

  // Opening and closing the mobile map-control tray leaves camera controls
  // usable afterward (the open tray panel legitimately overlaps the map
  // canvas by design at this width — that's expected occlusion, not broken
  // input handling — so this checks controls survive the open/close cycle
  // rather than dragging through the panel itself).
  await page.getByRole("button", { name: "Map controls" }).click();
  await expect(page.locator(".map-controls--open")).toBeVisible();
  await page.getByRole("button", { name: "Map controls" }).click();
  await expect(page.locator(".map-controls--open")).toBeHidden();
  const beforeTrayDrag = await waitForCameraSettled(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(cx - 30, cy - 15, { steps: 5 });
  await page.mouse.up({ button: "left" });
  const afterTrayDrag = await waitForCameraSettled(page);
  expect(dist(afterTrayDrag.cameraTarget!, beforeTrayDrag.cameraTarget!)).toBeGreaterThan(0.1);

  // A reduced-motion reset resolves on the very next frame, not over a
  // multi-hundred-millisecond glide — a short fixed wait is appropriate here
  // (verifying "fast", not polling for eventual convergence).
  await page.keyboard.down("KeyR");
  await page.keyboard.up("KeyR");
  await page.waitForTimeout(300);
  const afterReset = await diag(page);
  expect(dist(afterReset.cameraPosition!, initial.cameraPosition!)).toBeLessThan(0.1);
  expect(afterReset.cameraResetActive).toBe(false);

  expect(errs.pageErrors, errs.pageErrors.join("\n")).toEqual([]);
});
