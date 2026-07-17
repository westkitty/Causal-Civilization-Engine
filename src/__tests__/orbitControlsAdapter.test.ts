// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  detectOrbitControlsPrivateShape,
  zeroOrbitControlsDamping,
  cancelOrbitControlsPointer,
} from "../rendering/orbitControlsAdapter";

function makeControls(): OrbitControls {
  const camera = new THREE.PerspectiveCamera();
  const dom = document.createElement("div");
  // jsdom doesn't implement the Pointer Events capture API that
  // OrbitControls' real _onPointerUp calls; real browsers do.
  (dom as unknown as { releasePointerCapture: (id: number) => void }).releasePointerCapture = () => {};
  return new OrbitControls(camera, dom);
}

describe("orbitControlsAdapter", () => {
  it("detects the installed OrbitControls' private shape as present", () => {
    const shape = detectOrbitControlsPrivateShape(makeControls());
    expect(shape.hasSphericalDelta).toBe(true);
    expect(shape.hasPanOffset).toBe(true);
    expect(shape.hasOnPointerUp).toBe(true);
    expect(shape.hasState).toBe(true);
  });

  it("zeroes pending damping accumulators when present", () => {
    const controls = makeControls();
    const raw = controls as unknown as {
      _sphericalDelta: { theta: number; phi: number };
      _panOffset: THREE.Vector3;
    };
    raw._sphericalDelta.theta = 1.2;
    raw._sphericalDelta.phi = -0.4;
    raw._panOffset.set(1, 2, 3);

    zeroOrbitControlsDamping(controls);

    expect(raw._sphericalDelta.theta).toBe(0);
    expect(raw._sphericalDelta.phi).toBe(0);
    expect(raw._panOffset.x).toBe(0);
    expect(raw._panOffset.y).toBe(0);
    expect(raw._panOffset.z).toBe(0);
  });

  it("forces state to NONE (-1) via cancelOrbitControlsPointer, even with no active pointer id", () => {
    const controls = makeControls();
    const raw = controls as unknown as { state: number };
    raw.state = 2;

    cancelOrbitControlsPointer(controls, null);

    expect(raw.state).toBe(-1);
  });

  it("routes a real pointer id through _onPointerUp when one is active", () => {
    const controls = makeControls();
    let capturedPointerId: number | null = null;
    const raw = controls as unknown as { _onPointerUp: (e: { pointerId: number }) => void; state: number };
    const originalOnPointerUp = raw._onPointerUp;
    raw._onPointerUp = (event: { pointerId: number }) => {
      capturedPointerId = event.pointerId;
      originalOnPointerUp(event);
    };

    cancelOrbitControlsPointer(controls, 7);

    expect(capturedPointerId).toBe(7);
    expect(raw.state).toBe(-1);
  });

  it("degrades to a safe no-op (never throws, never leaves state undefined) when expected private fields are missing", () => {
    const controls = makeControls();
    const broken = controls as unknown as Record<string, unknown>;
    delete broken._sphericalDelta;
    delete broken._panOffset;
    delete broken._onPointerUp;
    delete broken.state;

    expect(() => zeroOrbitControlsDamping(controls)).not.toThrow();
    expect(() => cancelOrbitControlsPointer(controls, 3)).not.toThrow();

    const shape = detectOrbitControlsPrivateShape(controls);
    expect(shape.hasSphericalDelta).toBe(false);
    expect(shape.hasPanOffset).toBe(false);
    expect(shape.hasOnPointerUp).toBe(false);
    expect(shape.hasState).toBe(false);
  });
});
