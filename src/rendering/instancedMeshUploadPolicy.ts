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
  ): THREE.InstancedMesh {
    originalSetMatrixAt.call(this, index, matrix);
    this.instanceMatrix.needsUpdate = true;
    return this;
  };

  THREE.InstancedMesh.prototype.setColorAt = function setColorAtAndUpload(
    this: THREE.InstancedMesh,
    index: number,
    color: THREE.Color,
  ): THREE.InstancedMesh {
    originalSetColorAt.call(this, index, color);
    if (this.instanceColor) this.instanceColor.needsUpdate = true;
    return this;
  };

  prototype[PATCH_FLAG] = true;
}
