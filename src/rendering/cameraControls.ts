// Pure camera-control logic ported from Parable's Godot camera rig
// (godot-spike/scripts/camera_rig.gd) — see docs/PARABLE_CONTROL_PORT.md for
// the full behavioral contract and source citations. Kept side-effect-free so
// it can be unit tested without a WebGL context or a React render tree.

export type CameraKeyAction =
  | "orbitLeft"
  | "orbitRight"
  | "pitchUp"
  | "pitchDown"
  | "zoomIn"
  | "zoomOut"
  | "reset";

// KeyboardEvent.code values, not .key — layout-independent, matching Parable's
// physical-key (Q/E/W/S) binding rather than a localized character.
const KEY_ACTION_MAP: Record<string, CameraKeyAction> = {
  KeyQ: "orbitLeft",
  KeyE: "orbitRight",
  KeyW: "pitchUp",
  KeyS: "pitchDown",
  Equal: "zoomIn",
  NumpadAdd: "zoomIn",
  Minus: "zoomOut",
  NumpadSubtract: "zoomOut",
  KeyR: "reset",
};

export function mapKeyToCameraAction(code: string): CameraKeyAction | null {
  return KEY_ACTION_MAP[code] ?? null;
}

// Ported directly from Parable's KEY_ORBIT_RATE / KEY_PITCH_RATE (rad/sec) —
// these port without rescaling because both engines orbit a target at an
// angular rate independent of camera distance. See PARABLE_CONTROL_PORT.md.
export const CAMERA_KEY_ORBIT_RATE = 1.55;
export const CAMERA_KEY_PITCH_RATE = 1.1;

// Parable's ZOOM_STEP_KEYBOARD is applied once per rendered frame, undamped by
// delta time (frame-rate dependent). This is delta-scaled here as a deliberate
// adaptation — see PARABLE_CONTROL_PORT.md — expressed as a multiplicative
// dolly rate per second so it composes with OrbitControls' own dolly model.
export const CAMERA_KEY_ZOOM_RATE_PER_SECOND = 1.9;

export interface CameraFrameDeltas {
  /** Radians to orbit (rotateLeft-positive) this frame. */
  orbitAngle: number;
  /** Radians to pitch (rotateUp-positive) this frame. */
  pitchAngle: number;
  /**
   * Multiplicative factor to apply directly to the camera's distance from its
   * orbit target this frame. 1 = unchanged, <1 = move closer (zoom in), >1 =
   * move farther (zoom out). Distance-multiplier semantics are chosen so this
   * function stays library-agnostic; the caller translates it into whichever
   * dolly primitive its controls expose (see MapViewer.tsx).
   */
  zoomScale: number;
}

export function computeCameraFrameDeltas(
  heldActions: ReadonlySet<CameraKeyAction>,
  deltaSeconds: number
): CameraFrameDeltas {
  let orbitAngle = 0;
  let pitchAngle = 0;
  let zoomScale = 1;

  if (heldActions.has("orbitLeft")) orbitAngle += CAMERA_KEY_ORBIT_RATE * deltaSeconds;
  if (heldActions.has("orbitRight")) orbitAngle -= CAMERA_KEY_ORBIT_RATE * deltaSeconds;
  if (heldActions.has("pitchUp")) pitchAngle += CAMERA_KEY_PITCH_RATE * deltaSeconds;
  if (heldActions.has("pitchDown")) pitchAngle -= CAMERA_KEY_PITCH_RATE * deltaSeconds;
  if (heldActions.has("zoomIn")) zoomScale /= Math.pow(CAMERA_KEY_ZOOM_RATE_PER_SECOND, deltaSeconds);
  if (heldActions.has("zoomOut")) zoomScale *= Math.pow(CAMERA_KEY_ZOOM_RATE_PER_SECOND, deltaSeconds);

  return { orbitAngle, pitchAngle, zoomScale };
}

// Mirrors Parable's own click-vs-drag disambiguation
// (hand_input.gd CLICK_DRAG_THRESHOLD_PX) — a pointer gesture below this
// screen-pixel distance is a click (entity selection); at or above it, a drag
// (camera pan), matching the ported LEFT-drag-to-pan binding.
export const CLICK_DRAG_THRESHOLD_PX = 10;

export function isClickNotDrag(startX: number, startY: number, endX: number, endY: number): boolean {
  return Math.hypot(endX - startX, endY - startY) < CLICK_DRAG_THRESHOLD_PX;
}

// Mirrors Parable's own "pending_pan" state (hand_input.gd): once a gesture's
// displacement from its start crosses the threshold, it stays classified as a
// drag for the rest of that gesture, even if the pointer later moves back
// near its starting point — checking only the final start/end distance would
// let a large drag-and-return be misclassified as a click.
export function updateDragExceededThreshold(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  alreadyExceeded: boolean
): boolean {
  if (alreadyExceeded) return true;
  return !isClickNotDrag(startX, startY, currentX, currentY);
}

// Attribute marking the map's own focusable wrapper (see MapViewer.tsx). The
// primary gate for camera keyboard shortcuts is now positive activation —
// MapViewer only processes Q/E/W/S/+/-/R while this element itself has DOM
// focus (see the mapKeyboardActive flag in MapViewer.tsx). This denylist is
// kept as a secondary, defense-in-depth check for the map's own focused
// state (and any future control living inside it), so it must not itself
// suppress the map wrapper — see the exemption below.
export const MAP_KEYBOARD_REGION_ATTR = "data-camera-keyboard-region";

// Camera keyboard shortcuts (Q/E/W/S/+/-/R) must not fire while the user is
// typing, operating a native form control, interacting with any button/link,
// or interacting with the Inspector panel. This is secondary to the positive
// map-focus activation gate in MapViewer.tsx (shortcuts are inert unless the
// map wrapper itself has focus); this function remains as defense-in-depth
// for that focused state. Arrow keys are deliberately not part of Parable's
// scheme, so timeline/divider slider arrow-key behavior never collides with
// this check.
export function shouldSuppressCameraKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || tag === "A") return true;
  if (target.contentEditable === "true") return true;
  if (target.closest("button, a, [role='button'], .inspector")) return true;
  // The map wrapper itself carries a tabindex so it can receive focus (the
  // positive activation model) — it must not be caught by the generic
  // "any tabindex-bearing element" rule below, which exists to suppress
  // *other* focusable-but-non-map elements (dividers, custom controls).
  if (target.closest(`[${MAP_KEYBOARD_REGION_ATTR}]`)) return false;
  if (target.closest("[tabindex]")) return true;
  return false;
}
