// Centralizes every touchpoint that reaches into OrbitControls' private,
// undocumented internals for the ported Parable camera controls (see
// docs/PARABLE_CONTROL_PORT.md). Before this module existed, MapViewer.tsx
// read/wrote `_sphericalDelta`, `_panOffset`, `_onPointerUp`, and `state`
// directly at three separate call sites. None of these are part of
// OrbitControls' public .d.ts — they are only guaranteed to exist in the
// exact `three` version pinned in package.json (r185,
// three/examples/jsm/controls/OrbitControls.js). Every function here checks
// the field's presence/type before touching it, so a future dependency bump
// that renames or removes one degrades to a partial (but never wedging)
// cleanup instead of throwing.

import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

interface OrbitControlsInternals {
  _sphericalDelta: { theta: number; phi: number };
  _panOffset: THREE.Vector3;
  _onPointerUp: (event: { pointerId: number }) => void;
  state: number;
}

function internals(controls: OrbitControls): Partial<OrbitControlsInternals> {
  return controls as unknown as Partial<OrbitControlsInternals>;
}

/**
 * Reports which of the private fields this adapter depends on are actually
 * present on the installed OrbitControls build, with the shape this adapter
 * expects. Exists so a test can assert the adapter still matches reality
 * (see src/__tests__/orbitControlsAdapter.test.ts) rather than only being
 * exercised indirectly.
 */
export function detectOrbitControlsPrivateShape(controls: OrbitControls) {
  const i = internals(controls);
  return {
    hasSphericalDelta:
      typeof i._sphericalDelta?.theta === "number" && typeof i._sphericalDelta?.phi === "number",
    hasPanOffset: i._panOffset instanceof THREE.Vector3,
    hasOnPointerUp: typeof i._onPointerUp === "function",
    hasState: typeof i.state === "number",
  };
}

/**
 * Zeroes OrbitControls' pending damping accumulators so a reverted or
 * cancelled gesture doesn't keep "coasting" on later update() calls —
 * enableDamping applies only a fraction of _sphericalDelta/_panOffset per
 * update(), not the whole thing, so the remainder otherwise re-appears on
 * subsequent frames. Safe no-op field-by-field if either is missing.
 */
export function zeroOrbitControlsDamping(controls: OrbitControls): void {
  const i = internals(controls);
  if (i._sphericalDelta) {
    i._sphericalDelta.theta = 0;
    i._sphericalDelta.phi = 0;
  }
  i._panOffset?.set(0, 0, 0);
}

/**
 * Cancels an in-progress pointer drag through OrbitControls' own real
 * pointer-up path (`_onPointerUp`) so its private `_pointers` bookkeeping is
 * cleared exactly as it would be for a real release — forcing `state` alone
 * leaves a stale pointerId in `_pointers`, which silently swallows the next
 * real pointerdown with the same id (see docs/PARABLE_CONTROL_PORT.md,
 * BUG-04). `pointerId` may be null (no pointer was active); `state` is reset
 * unconditionally regardless, as a defensive fallback that guarantees the
 * controls are never left in an active-drag state even if `_onPointerUp` is
 * missing or renamed.
 */
export function cancelOrbitControlsPointer(controls: OrbitControls, pointerId: number | null): void {
  const i = internals(controls);
  if (pointerId !== null && typeof i._onPointerUp === "function") {
    i._onPointerUp({ pointerId });
  }
  if (typeof i.state === "number") {
    (i as OrbitControlsInternals).state = -1;
  }
}
