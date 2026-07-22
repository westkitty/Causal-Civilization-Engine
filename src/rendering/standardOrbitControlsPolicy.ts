import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const PATCH_FLAG = Symbol.for("cce.standardOrbitControlsPolicy");
const prototype = OrbitControls.prototype as OrbitControls & Record<PropertyKey, unknown>;

if (prototype[PATCH_FLAG] !== true) {
  const originalUpdate = OrbitControls.prototype.update;

  OrbitControls.prototype.update = function updateWithStandardMouseBindings(
    this: OrbitControls,
    ...args: Parameters<OrbitControls["update"]>
  ): ReturnType<OrbitControls["update"]> {
    // Standard browser-3D behavior: left rotates, middle/right pan, wheel zooms.
    // This intentionally overrides the earlier Parable-style left-pan mapping,
    // which made the camera appear non-rotatable to ordinary mouse users.
    this.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    this.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    this.mouseButtons.RIGHT = THREE.MOUSE.PAN;

    return originalUpdate.apply(this, args);
  };

  prototype[PATCH_FLAG] = true;
}
