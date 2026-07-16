// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  mapKeyToCameraAction,
  computeCameraFrameDeltas,
  shouldSuppressCameraKeys,
  isClickNotDrag,
  CAMERA_KEY_ORBIT_RATE,
  CAMERA_KEY_PITCH_RATE,
  CLICK_DRAG_THRESHOLD_PX,
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

  it("does not suppress for a plain button outside the Inspector", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    expect(shouldSuppressCameraKeys(button)).toBe(false);
    document.body.removeChild(button);
  });

  it("does not suppress for a null or non-element target", () => {
    expect(shouldSuppressCameraKeys(null)).toBe(false);
  });
});
