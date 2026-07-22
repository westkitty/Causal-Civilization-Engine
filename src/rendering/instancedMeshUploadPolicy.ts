import * as THREE from "three";

const PATCH_FLAG = Symbol.for("cce.instancedMeshUploadPolicy");
const prototype = THREE.InstancedMesh.prototype as THREE.InstancedMesh &
  Record<PropertyKey, unknown>;

if (prototype[PATCH_FLAG] !== true) {
  const originalSetMatrixAt = THREE.InstancedMesh.prototype.setMatrixAt;
  const originalSetColorAt = THREE.InstancedMesh.prototype.setColorAt;

  THREE.InstancedMesh.prototype.setMatrixAt = function setMatrixAtAndUpload(
    this: THREE.InstancedMesh,
    index: number,
    matrix: THREE.Matrix4,
  ): void {
    originalSetMatrixAt.call(this, index, matrix);
    this.instanceMatrix.needsUpdate = true;
  };

  THREE.InstancedMesh.prototype.setColorAt = function setColorAtAndUpload(
    this: THREE.InstancedMesh,
    index: number,
    color: THREE.Color,
  ): void {
    originalSetColorAt.call(this, index, color);
    if (this.instanceColor) this.instanceColor.needsUpdate = true;
  };

  prototype[PATCH_FLAG] = true;
}
