import * as THREE from "three";

const PATCH_FLAG = Symbol.for("cce.rendererVisualPolicy");
const SCENE_STATE_KEY = "__cceRendererVisualPolicyState";
const GENERATED_KEY = "__cceGeneratedVisualPolicy";
const X_AXIS = new THREE.Vector3(1, 0, 0);
const FOREST_COLOR = new THREE.Color("#166534");
const MAX_TREE_COUNT = 900;

