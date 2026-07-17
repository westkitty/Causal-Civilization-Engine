// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  mapKeyToCameraAction,
  computeCameraFrameDeltas,
  shouldSuppressCameraKeys,
  isClickNotDrag,
  updateDragExceededThreshold,
  CAMERA_KEY_ORBIT_RATE,
  CAMERA_KEY_PITCH_RATE,
  CLICK_DRAG_THRESHOLD_PX,
  MAP_KEYBOARD_REGION_ATTR,
} from "../rendering/cameraControls";

describe("mapKeyToCameraAction", () => {
  it("maps Q to orbitLeft", () => {
    expect(mapKeyToCameraAction("KeyQ")).toBe("orbitLeft");
  });
  it("maps E to orbitRight", () => {
    expect(mapKeyToCameraAction("KeyE")).toBe("orbitRight");
  });
  it("maps W to pitchUp", () => {
    expect(mapKeyToCameraAction("KeyW")).toBe("pitchUp");
  });
  it("maps S to pitchDown", () => {
    expect(mapKeyToCameraAction("KeyS")).toBe("pitchDown");
  });
  it("maps Equal and NumpadAdd to zoomIn", () => {
    expect(mapKeyToCameraAction("Equal")).toBe("zoomIn");
    expect(mapKeyToCameraAction("NumpadAdd")).toBe("zoomIn");
  });
  it("maps Minus and NumpadSubtract to zoomOut", () => {
    expect(mapKeyToCameraAction("Minus")).toBe("zoomOut");
    expect(mapKeyToCameraAction("NumpadSubtract")).toBe("zoomOut");
  });
  it("maps R to reset", () => {
    expect(mapKeyToCameraAction("KeyR")).toBe("reset");
  });
  it("returns null for unrelated keys, including arrow keys reserved for sliders", () => {
    expect(mapKeyToCameraAction("ArrowLeft")).toBeNull();
    expect(mapKeyToCameraAction("ArrowUp")).toBeNull();
    expect(mapKeyToCameraAction("Space")).toBeNull();
    expect(mapKeyToCameraAction("Enter")).toBeNull();
    expect(mapKeyToCameraAction("Escape")).toBeNull();
    expect(mapKeyToCameraAction("KeyA")).toBeNull();
  });
});

describe("computeCameraFrameDeltas", () => {
  it("produces zero deltas with no held actions", () => {
    const deltas = computeCameraFrameDeltas(new Set(), 0.1);
    expect(deltas.orbitAngle).toBe(0);
    expect(deltas.pitchAngle).toBe(0);
    expect(deltas.zoomScale).toBe(1);
  });

  it("scales orbit angle by elapsed time at the ported rate", () => {
    const deltas = computeCameraFrameDeltas(new Set(["orbitLeft"]), 0.5);
    expect(deltas.orbitAngle).toBeCloseTo(CAMERA_KEY_ORBIT_RATE * 0.5, 10);
  });

  it("orbitLeft and orbitRight point in opposite directions", () => {
    const left = computeCameraFrameDeltas(new Set(["orbitLeft"]), 0.2);
    const right = computeCameraFrameDeltas(new Set(["orbitRight"]), 0.2);
    expect(left.orbitAngle).toBeGreaterThan(0);
    expect(right.orbitAngle).toBeLessThan(0);
    expect(left.orbitAngle).toBeCloseTo(-right.orbitAngle, 10);
  });

  it("pitchUp and pitchDown point in opposite directions at the ported rate", () => {
    const up = computeCameraFrameDeltas(new Set(["pitchUp"]), 0.3);
    const down = computeCameraFrameDeltas(new Set(["pitchDown"]), 0.3);
    expect(up.pitchAngle).toBeCloseTo(CAMERA_KEY_PITCH_RATE * 0.3, 10);
    expect(down.pitchAngle).toBeCloseTo(-CAMERA_KEY_PITCH_RATE * 0.3, 10);
  });

  it("opposite keys held simultaneously cancel out", () => {
    const deltas = computeCameraFrameDeltas(new Set(["orbitLeft", "orbitRight"]), 0.4);
    expect(deltas.orbitAngle).toBe(0);
    const pitch = computeCameraFrameDeltas(new Set(["pitchUp", "pitchDown"]), 0.4);
    expect(pitch.pitchAngle).toBe(0);
  });

  it("zoomIn produces a scale below 1 (dolly in) and zoomOut above 1 (dolly out)", () => {
    const zoomIn = computeCameraFrameDeltas(new Set(["zoomIn"]), 0.2);
    const zoomOut = computeCameraFrameDeltas(new Set(["zoomOut"]), 0.2);
    expect(zoomIn.zoomScale).toBeLessThan(1);
    expect(zoomOut.zoomScale).toBeGreaterThan(1);
  });

  it("opposite zoom keys held simultaneously cancel to a neutral scale", () => {
    const deltas = computeCameraFrameDeltas(new Set(["zoomIn", "zoomOut"]), 0.3);
    expect(deltas.zoomScale).toBeCloseTo(1, 10);
  });

  it("multiple non-opposing keys combine independently", () => {
    const deltas = computeCameraFrameDeltas(new Set(["orbitLeft", "pitchUp", "zoomIn"]), 0.1);
    expect(deltas.orbitAngle).toBeGreaterThan(0);
    expect(deltas.pitchAngle).toBeGreaterThan(0);
    expect(deltas.zoomScale).toBeLessThan(1);
  });

  it("zero elapsed time produces no movement", () => {
    const deltas = computeCameraFrameDeltas(new Set(["orbitLeft", "zoomIn"]), 0);
    expect(deltas.orbitAngle).toBe(0);
    expect(deltas.zoomScale).toBe(1);
  });
});

describe("isClickNotDrag", () => {
  it("treats zero movement as a click", () => {
    expect(isClickNotDrag(100, 100, 100, 100)).toBe(true);
  });

  it("treats movement just below the threshold as a click", () => {
    expect(isClickNotDrag(0, 0, CLICK_DRAG_THRESHOLD_PX - 1, 0)).toBe(true);
  });

  it("treats movement at or above the threshold as a drag", () => {
    expect(isClickNotDrag(0, 0, CLICK_DRAG_THRESHOLD_PX, 0)).toBe(false);
    expect(isClickNotDrag(0, 0, 100, 100)).toBe(false);
  });

  it("measures Euclidean distance, not per-axis distance", () => {
    // 6-8-10 triangle: each axis alone is under threshold, combined is not.
    expect(isClickNotDrag(0, 0, 6, 8)).toBe(false);
  });
});

describe("updateDragExceededThreshold", () => {
  it("stays false while the pointer has never left the click radius", () => {
    expect(updateDragExceededThreshold(0, 0, 3, 2, false)).toBe(false);
  });

  it("becomes true once displacement crosses the threshold", () => {
    expect(updateDragExceededThreshold(0, 0, 50, 0, false)).toBe(true);
  });

  it("stays true once exceeded even if the pointer returns near the start", () => {
    // Simulates a drag that goes out past the threshold, then curls back
    // near its starting point before release — must not be reclassified as
    // a click (this is what let a large drag-and-return register as an
    // entity-selection click).
    let exceeded = false;
    exceeded = updateDragExceededThreshold(0, 0, 10, 10, exceeded); // out
    expect(exceeded).toBe(true);
    exceeded = updateDragExceededThreshold(0, 0, 1, 1, exceeded); // back near start
    expect(exceeded).toBe(true);
  });

  it("is idempotent once already exceeded, regardless of current position", () => {
    expect(updateDragExceededThreshold(0, 0, 0, 0, true)).toBe(true);
  });
});

describe("shouldSuppressCameraKeys", () => {
  it("suppresses when a text input is focused", () => {
    const input = document.createElement("input");
    input.type = "text";
    expect(shouldSuppressCameraKeys(input)).toBe(true);
  });

  it("suppresses when a range input is focused", () => {
    const input = document.createElement("input");
    input.type = "range";
    expect(shouldSuppressCameraKeys(input)).toBe(true);
  });

  it("suppresses when a textarea is focused", () => {
    expect(shouldSuppressCameraKeys(document.createElement("textarea"))).toBe(true);
  });

  it("suppresses when a select is focused", () => {
    expect(shouldSuppressCameraKeys(document.createElement("select"))).toBe(true);
  });

  it("suppresses when a contenteditable element is focused", () => {
    const div = document.createElement("div");
    div.contentEditable = "true";
    document.body.appendChild(div);
    expect(shouldSuppressCameraKeys(div)).toBe(true);
    document.body.removeChild(div);
  });

  it("suppresses when focus is inside the Inspector panel", () => {
    const aside = document.createElement("aside");
    aside.className = "inspector inspector--selected";
    const button = document.createElement("button");
    aside.appendChild(button);
    document.body.appendChild(aside);
    expect(shouldSuppressCameraKeys(button)).toBe(true);
    document.body.removeChild(aside);
  });

  it("suppresses for a button anywhere in the app, not just inside the Inspector", () => {
    // The task requires keyboard camera movement to begin only in an
    // appropriate map control context — a denylist of specific elements
    // (text inputs, the Inspector) is not sufficient: pressing Q/E/W/S while
    // an ordinary timeline, overlay, or map-control-tray button has focus
    // must not also move the camera.
    const button = document.createElement("button");
    document.body.appendChild(button);
    expect(shouldSuppressCameraKeys(button)).toBe(true);
    document.body.removeChild(button);
  });

  it("suppresses for a link", () => {
    const link = document.createElement("a");
    link.href = "#";
    document.body.appendChild(link);
    expect(shouldSuppressCameraKeys(link)).toBe(true);
    document.body.removeChild(link);
  });

  it("suppresses for any element with an explicit tabindex", () => {
    const div = document.createElement("div");
    div.tabIndex = 0;
    document.body.appendChild(div);
    expect(shouldSuppressCameraKeys(div)).toBe(true);
    document.body.removeChild(div);
  });

  it("does not suppress for a plain, non-interactive element (e.g. the map canvas container)", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    expect(shouldSuppressCameraKeys(div)).toBe(false);
    document.body.removeChild(div);
  });

  it("does not suppress for a null or non-element target", () => {
    expect(shouldSuppressCameraKeys(null)).toBe(false);
  });
});

// Positive map-focus activation (docs/PARABLE_CONTROL_PORT.md): the map
// wrapper itself now carries a tabindex so it can receive focus (see
// MapViewer.tsx), which would otherwise be caught by the generic
// "any tabindex-bearing element is suppressed" rule above. These scenarios
// cover the DOM-shape half of that fix (the pure, unit-testable half); the
// live focus/blur state machine that actually flips shortcuts on and off is
// covered in tests/e2e/camera-controls.spec.ts, since it depends on real
// browser focus events MapViewer.tsx's mount-once effect owns internally.
describe("shouldSuppressCameraKeys: map keyboard region exemption", () => {
  function makeMapRegion(): HTMLDivElement {
    const div = document.createElement("div");
    div.className = "map-canvas";
    div.tabIndex = 0;
    div.setAttribute(MAP_KEYBOARD_REGION_ATTR, "true");
    document.body.appendChild(div);
    return div;
  }

  it("does not suppress the map keyboard region itself, despite its tabindex", () => {
    const region = makeMapRegion();
    expect(shouldSuppressCameraKeys(region)).toBe(false);
    document.body.removeChild(region);
  });

  it("does not suppress a plain, non-interactive descendant of the map region", () => {
    const region = makeMapRegion();
    const child = document.createElement("span");
    region.appendChild(child);
    expect(shouldSuppressCameraKeys(child)).toBe(false);
    document.body.removeChild(region);
  });

  it("still suppresses an ordinary tabindex-bearing element that is not the map region", () => {
    // Regression guard: the exemption above must be scoped to the map
    // region specifically, not loosen the general tabindex rule for
    // everything else (a custom divider, a card, etc.).
    const div = document.createElement("div");
    div.tabIndex = 0;
    document.body.appendChild(div);
    expect(shouldSuppressCameraKeys(div)).toBe(true);
    document.body.removeChild(div);
  });

  it("still suppresses an input nested inside the map region (defense-in-depth preserved)", () => {
    const region = makeMapRegion();
    const input = document.createElement("input");
    input.type = "text";
    region.appendChild(input);
    expect(shouldSuppressCameraKeys(input)).toBe(true);
    document.body.removeChild(region);
  });

  it("still suppresses a button nested inside the map region (defense-in-depth preserved)", () => {
    const region = makeMapRegion();
    const button = document.createElement("button");
    region.appendChild(button);
    expect(shouldSuppressCameraKeys(button)).toBe(true);
    document.body.removeChild(region);
  });

  it("still suppresses the Inspector even though it is unrelated to the map region", () => {
    const aside = document.createElement("aside");
    aside.className = "inspector inspector--selected";
    document.body.appendChild(aside);
    expect(shouldSuppressCameraKeys(aside)).toBe(true);
    document.body.removeChild(aside);
  });

  it("does not suppress a sibling of the map region that merely happens to share its parent", () => {
    const wrapper = document.createElement("div");
    const region = document.createElement("div");
    region.tabIndex = 0;
    region.setAttribute(MAP_KEYBOARD_REGION_ATTR, "true");
    const sibling = document.createElement("div");
    sibling.tabIndex = 0;
    wrapper.appendChild(region);
    wrapper.appendChild(sibling);
    document.body.appendChild(wrapper);
    expect(shouldSuppressCameraKeys(sibling)).toBe(true);
    expect(shouldSuppressCameraKeys(region)).toBe(false);
    document.body.removeChild(wrapper);
  });

  it("does not suppress the map region even with an empty attribute value", () => {
    // closest() matches on attribute presence, not its exact string value —
    // React renders it as "true", but the exemption must not be brittle to
    // that specific value.
    const div = document.createElement("div");
    div.tabIndex = 0;
    div.setAttribute(MAP_KEYBOARD_REGION_ATTR, "");
    document.body.appendChild(div);
    expect(shouldSuppressCameraKeys(div)).toBe(false);
    document.body.removeChild(div);
  });

  it("suppression order is independent: a descendant of the map region that is itself a link is still suppressed", () => {
    const region = makeMapRegion();
    const link = document.createElement("a");
    link.href = "#";
    region.appendChild(link);
    expect(shouldSuppressCameraKeys(link)).toBe(true);
    document.body.removeChild(region);
  });
});
