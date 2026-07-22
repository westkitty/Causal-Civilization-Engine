import * as THREE from "three";

const PATCH_FLAG = Symbol.for("cce.rendererVisualPolicy");
const SCENE_STATE_KEY = "__cceRendererVisualPolicyState";
const GENERATED_KEY = "__cceGeneratedVisualPolicy";
const X_AXIS = new THREE.Vector3(1, 0, 0);

interface ScenePolicyState {
  atmosphereReady: boolean;
  contentSignature: string;
  waterMaterials: THREE.MeshStandardMaterial[];
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

function createConnector(
  start: THREE.Vector3,
  end: THREE.Vector3,
  width: number,
  height: number,
  overlap: number,
  material: THREE.Material,
): THREE.Mesh | null {
  const direction = end.clone().sub(start);
  const length = direction.length();
  if (!Number.isFinite(length) || length < 0.05) return null;

  const connector = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  connector.position.copy(start).add(end).multiplyScalar(0.5);
  connector.position.y += height * 0.35;
  connector.quaternion.setFromUnitVectors(X_AXIS, direction.normalize());
  connector.scale.set(length + overlap, height, width);
  connector.userData[GENERATED_KEY] = true;
  connector.receiveShadow = true;
  return connector;
}

function enhanceRoadGeometry(scene: THREE.Scene): void {
  const roadGroups = scene.children.filter(
    (child): child is THREE.Group => child instanceof THREE.Group && child.userData.kind === "road",
  );

  for (const roadGroup of roadGroups) {
    if (roadGroup.userData[GENERATED_KEY]) continue;

    const roadTiles = roadGroup.children.filter(
      (child): child is THREE.Mesh =>
        child instanceof THREE.Mesh && child.userData[GENERATED_KEY] !== true,
    );
    if (roadTiles.length < 2) {
      roadGroup.userData[GENERATED_KEY] = true;
      continue;
    }

    const sourceMaterial = Array.isArray(roadTiles[0].material)
      ? roadTiles[0].material[0]
      : roadTiles[0].material;
    const connectorMaterial = sourceMaterial.clone();
    const connectorGroup = new THREE.Group();
    connectorGroup.userData.kind = "road";
    connectorGroup.userData[GENERATED_KEY] = true;

    for (let index = 1; index < roadTiles.length; index += 1) {
      const connector = createConnector(
        roadTiles[index - 1].position,
        roadTiles[index].position,
        0.72,
        0.08,
        0.42,
        connectorMaterial,
      );
      if (connector) connectorGroup.add(connector);
    }

    roadGroup.add(connectorGroup);
    roadGroup.userData[GENERATED_KEY] = true;
  }
}

function enhanceSettlementGeometry(scene: THREE.Scene): void {
  const settlementGroups = scene.children.filter(
    (child): child is THREE.Group =>
      child instanceof THREE.Group && child.userData.kind === "settlement",
  );
  if (settlementGroups.length === 0) return;

  const roofMaterial = new THREE.MeshStandardMaterial({
    color: "#3a1710",
    roughness: 0.9,
    metalness: 0,
  });

  for (const settlementGroup of settlementGroups) {
    if (settlementGroup.userData[GENERATED_KEY]) continue;

    const buildings = settlementGroup.children.filter(
      (child): child is THREE.Mesh =>
        child instanceof THREE.Mesh && child.userData[GENERATED_KEY] !== true,
    );

    for (const building of buildings) {
      building.geometry.computeBoundingBox();
      const bounds = building.geometry.boundingBox;
      if (!bounds) continue;

      const size = new THREE.Vector3();
      bounds.getSize(size);
      if (size.y < 0.2) continue;

      const roofHeight = THREE.MathUtils.clamp(size.y * 0.32, 0.2, 0.62);
      const roofRadius = Math.max(size.x, size.z) * 0.8;
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(roofRadius, roofHeight, 4),
        roofMaterial,
      );
      roof.position.set(
        building.position.x,
        building.position.y + size.y / 2 + roofHeight / 2 - 0.025,
        building.position.z,
      );
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      roof.receiveShadow = true;
      roof.userData.kind = "settlement";
      roof.userData[GENERATED_KEY] = true;
      settlementGroup.add(roof);
    }

    settlementGroup.userData[GENERATED_KEY] = true;
  }
}

function riverPositionKey(x: number, z: number): string {
  return `${Math.round(x * 1000)}:${Math.round(z * 1000)}`;
}

function enhanceRiverGeometry(scene: THREE.Scene): void {
  const riverMeshes = scene.children.filter(
    (child): child is THREE.Mesh => child instanceof THREE.Mesh && child.userData.kind === "river",
  );
  if (riverMeshes.length === 0 || riverMeshes[0].userData[GENERATED_KEY]) return;

  const riverLookup = new Map<string, THREE.Mesh>();
  for (const river of riverMeshes) {
    riverLookup.set(riverPositionKey(river.position.x, river.position.z), river);

    river.geometry.dispose();
    river.geometry = new THREE.CylinderGeometry(0.72, 0.76, 0.12, 10);
    river.userData[GENERATED_KEY] = true;
  }

  const sourceMaterial = Array.isArray(riverMeshes[0].material)
    ? riverMeshes[0].material[0]
    : riverMeshes[0].material;
  const connectorMaterial = sourceMaterial.clone();
  const waterLinks = new THREE.Group();
  waterLinks.userData.kind = "visual-enhancement";
  waterLinks.userData[GENERATED_KEY] = true;

  const neighborOffsets = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ] as const;

  for (const river of riverMeshes) {
    for (const [dx, dz] of neighborOffsets) {
      const neighbor = riverLookup.get(riverPositionKey(river.position.x + dx, river.position.z + dz));
      if (!neighbor || Math.abs(neighbor.position.y - river.position.y) > 2.5) continue;

      const connector = createConnector(
        river.position,
        neighbor.position,
        0.92,
        0.09,
        0.5,
        connectorMaterial,
      );
      if (!connector) continue;
      connector.userData.kind = "river";
      connector.castShadow = false;
      waterLinks.add(connector);
    }
  }

  scene.add(waterLinks);
}

function tuneSceneContent(scene: THREE.Scene): THREE.MeshStandardMaterial[] {
  enhanceRoadGeometry(scene);
  enhanceSettlementGeometry(scene);
  enhanceRiverGeometry(scene);

  const waterMaterials = new Set<THREE.MeshStandardMaterial>();

  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;

    const kind = getVisualKind(object);
    const materials = Array.isArray(object.material) ? object.material : [object.material];

    for (const material of materials) {
      tuneMaterial(material, kind);
      if (kind === "river" && material instanceof THREE.MeshStandardMaterial) {
        waterMaterials.add(material);
      }
    }

    if (kind === "settlement" || kind === "bridge" || kind === "ruin") {
      object.castShadow = true;
      object.receiveShadow = true;
    } else if (kind === "terrain" || kind === "road") {
      object.receiveShadow = true;
    }
  });

  return [...waterMaterials];
}

function getSceneContentSignature(scene: THREE.Scene): string {
  const authoredChildren = scene.children.filter(
    (child) => child.userData[GENERATED_KEY] !== true,
  );
  const childCount = authoredChildren.length;
  const firstChild = authoredChildren[0]?.uuid ?? "none";
  const lastChild = authoredChildren[childCount - 1]?.uuid ?? "none";
  return `${childCount}:${firstChild}:${lastChild}`;
}

function animateWater(materials: THREE.MeshStandardMaterial[]): void {
  if (materials.length === 0) return;
  const shimmer = 0.18 + Math.sin(performance.now() * 0.00115) * 0.035;
  for (const material of materials) material.emissiveIntensity = shimmer;
}

if (rendererPrototype[PATCH_FLAG] !== true) {
  const originalRender = THREE.WebGLRenderer.prototype.render;

  THREE.WebGLRenderer.prototype.render = function renderWithVisualPolicy(
    this: THREE.WebGLRenderer,
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
        waterMaterials: [],
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
        sceneState.waterMaterials = tuneSceneContent(scene);
        sceneState.contentSignature = contentSignature;
      }

      animateWater(sceneState.waterMaterials);
    }

    originalRender.call(this, scene, camera);
  };

  rendererPrototype[PATCH_FLAG] = true;
}
