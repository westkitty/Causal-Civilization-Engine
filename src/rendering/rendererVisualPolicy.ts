import * as THREE from "three";

const PATCH_FLAG = Symbol.for("cce.rendererVisualPolicy");
const SCENE_STATE_KEY = "__cceRendererVisualPolicyState";

interface ScenePolicyState {
  atmosphereReady: boolean;
  contentSignature: string;
}

const tunedMaterials = new WeakSet<THREE.Material>();
const rendererPrototype = THREE.WebGLRenderer.prototype as THREE.WebGLRenderer &
  Record<PropertyKey, unknown>;

function getVisualKind(object: THREE.Object3D): string | undefined {
  let current: THREE.Object3D | null = object;

  while (current && !(current instanceof THREE.Scene)) {
    const kind = current.userData.kind;
    if (typeof kind === "string") return kind;
    current = current.parent;
  }

  return undefined;
}

function tuneMaterial(material: THREE.Material, kind: string | undefined): void {
  if (tunedMaterials.has(material) || !(material instanceof THREE.MeshStandardMaterial)) {
    return;
  }

  switch (kind) {
    case "terrain":
      material.roughness = 0.94;
      material.metalness = 0;
      material.envMapIntensity = 0.35;
      break;
    case "river":
      material.roughness = 0.22;
      material.metalness = 0.05;
      material.envMapIntensity = 0.9;
      material.emissive.set("#062b3a");
      material.emissiveIntensity = 0.18;
      break;
    case "road":
      material.roughness = 0.98;
      material.metalness = 0;
      material.envMapIntensity = 0.15;
      break;
    case "settlement":
      material.roughness = Math.max(material.roughness, 0.78);
      material.metalness = 0;
      material.envMapIntensity = 0.28;
      break;
    case "bridge":
      material.roughness = 0.9;
      material.metalness = 0;
      material.envMapIntensity = 0.2;
      break;
    case "ruin":
      material.roughness = 1;
      material.metalness = 0;
      material.envMapIntensity = 0.12;
      break;
    default:
      material.envMapIntensity = Math.min(material.envMapIntensity, 0.45);
  }

  material.needsUpdate = true;
  tunedMaterials.add(material);
}

function tuneSceneContent(scene: THREE.Scene): void {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;

    const kind = getVisualKind(object);
    const materials = Array.isArray(object.material) ? object.material : [object.material];

    for (const material of materials) tuneMaterial(material, kind);

    if (kind === "settlement" || kind === "bridge" || kind === "ruin") {
      object.castShadow = true;
      object.receiveShadow = true;
    } else if (kind === "terrain" || kind === "road") {
      object.receiveShadow = true;
    }
  });
}

function getSceneContentSignature(scene: THREE.Scene): string {
  const childCount = scene.children.length;
  const firstChild = scene.children[0]?.uuid ?? "none";
  const lastChild = scene.children[childCount - 1]?.uuid ?? "none";
  return `${childCount}:${firstChild}:${lastChild}`;
}

if (rendererPrototype[PATCH_FLAG] !== true) {
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

    if (scene instanceof THREE.Scene) {
      const sceneState = (scene.userData[SCENE_STATE_KEY] ??= {
        atmosphereReady: false,
        contentSignature: "",
      }) as ScenePolicyState;

      if (!sceneState.atmosphereReady) {
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
            object.shadow.normalBias = 0.015;
            object.shadow.camera.near = 1;
            object.shadow.camera.far = 320;
          }
        });

        sceneState.atmosphereReady = true;
      }

      const contentSignature = getSceneContentSignature(scene);
      if (contentSignature !== sceneState.contentSignature) {
        tuneSceneContent(scene);
        sceneState.contentSignature = contentSignature;
      }
    }

    originalRender.call(this, scene, camera);
  };

  rendererPrototype[PATCH_FLAG] = true;
}
