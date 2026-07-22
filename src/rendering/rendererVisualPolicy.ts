import * as THREE from "three";

const PATCH_FLAG = Symbol.for("cce.rendererVisualPolicy");
const SCENE_FLAG = "__cceRendererVisualPolicyApplied";

type PatchedRendererPrototype = THREE.WebGLRenderer & {
  [PATCH_FLAG]?: boolean;
};

const rendererPrototype = THREE.WebGLRenderer.prototype as PatchedRendererPrototype;

if (!rendererPrototype[PATCH_FLAG]) {
  const originalRender = THREE.WebGLRenderer.prototype.render;

  THREE.WebGLRenderer.prototype.render = function renderWithVisualPolicy(
    scene: THREE.Object3D,
    camera: THREE.Camera,
  ): void {
    this.outputColorSpace = THREE.SRGBColorSpace;
    this.toneMapping = THREE.ACESFilmicToneMapping;
    this.toneMappingExposure = 1.08;
    this.shadowMap.enabled = true;
    this.shadowMap.type = THREE.PCFSoftShadowMap;

    if (scene instanceof THREE.Scene && !scene.userData[SCENE_FLAG]) {
      const atmosphereColor = new THREE.Color("#071014");

      scene.background = atmosphereColor;
      scene.fog = new THREE.FogExp2(atmosphereColor, 0.00215);

      const skyLight = new THREE.HemisphereLight("#9fd8d1", "#17130c", 0.72);
      skyLight.userData.kind = "atmosphere-light";
      scene.add(skyLight);

      scene.traverse((object) => {
        if (object instanceof THREE.AmbientLight) {
          object.color.set("#6f9d9a");
          object.intensity = 0.48;
        } else if (object instanceof THREE.DirectionalLight) {
          object.shadow.radius = 3;
          object.shadow.blurSamples = 12;
          object.shadow.camera.near = 1;
          object.shadow.camera.far = 320;
        }
      });

      scene.userData[SCENE_FLAG] = true;
    }

    originalRender.call(this, scene, camera);
  };

  rendererPrototype[PATCH_FLAG] = true;
}
