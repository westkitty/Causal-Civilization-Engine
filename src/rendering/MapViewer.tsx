import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { WorldState } from "../core/types";
import { murmurHash3 } from "../core/random";

interface MapViewerProps {
  stateA: WorldState;
  stateB?: WorldState; // Comparative branch state
  comparisonMode: "none" | "swipe" | "ghost" | "heat";
  swipePosition: number; // 0..100
  selectedEntityId: string | null;
  onSelectEntity: (id: string | null) => void;
  activeOverlay: "none" | "politics" | "moisture" | "ore" | "timber";
}

export const MapViewer: React.FC<MapViewerProps> = ({
  stateA,
  stateB,
  comparisonMode,
  swipePosition,
  selectedEntityId: _selectedEntityId,
  onSelectEntity,
  activeOverlay,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  
  // Track scenes
  const sceneARef = useRef<THREE.Scene | null>(null);
  const sceneBRef = useRef<THREE.Scene | null>(null);

  // Track interactive meshes for raycasting
  const pickableObjectsARef = useRef<THREE.Object3D[]>([]);
  const pickableObjectsBRef = useRef<THREE.Object3D[]>([]);

  // Maps display objects to entity IDs
  const objectToEntityMapRef = useRef<Map<string, string>>(new Map());

  // Transient view state is read through refs inside the persistent render loop
  // and click handler so that changing it does NOT tear down and recreate the
  // renderer, camera, or animation loop (which would reset the camera).
  const comparisonModeRef = useRef(comparisonMode);
  const swipePositionRef = useRef(swipePosition);
  const stateBRef = useRef(stateB);
  const onSelectEntityRef = useRef(onSelectEntity);
  const activeOverlayRef = useRef(activeOverlay);
  useEffect(() => {
    comparisonModeRef.current = comparisonMode;
    swipePositionRef.current = swipePosition;
    stateBRef.current = stateB;
    onSelectEntityRef.current = onSelectEntity;
    activeOverlayRef.current = activeOverlay;
  });

  useEffect(() => {
    if (!containerRef.current) return;

    // 1. Initialize Renderer
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // Clear container and append canvas
    containerRef.current.innerHTML = "";
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 2. Initialize Camera & Controls
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    // Position camera looking down at an angle
    camera.position.set(62, 90, 120);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2.1; // Don't go below ground
    controls.minDistance = 10;
    controls.maxDistance = 300;
    controls.target.set(62, 0, 62);
    controlsRef.current = controls;

    // 3. Initialize Scenes
    const sceneA = new THREE.Scene();
    sceneA.background = new THREE.Color("#090d16");
    sceneARef.current = sceneA;

    const sceneB = new THREE.Scene();
    sceneB.background = new THREE.Color("#090d16");
    sceneBRef.current = sceneB;

    // Setup Lighting helper
    const setupLights = (scene: THREE.Scene) => {
      const ambientLight = new THREE.AmbientLight("#1e293b", 0.6);
      scene.add(ambientLight);

      const dirLight = new THREE.DirectionalLight("#fef08a", 1.2);
      dirLight.position.set(62, 120, 62);
      dirLight.castShadow = true;
      dirLight.shadow.mapSize.width = 2048;
      dirLight.shadow.mapSize.height = 2048;
      dirLight.shadow.bias = -0.0005;
      scene.add(dirLight);

      // Secondary cool light
      const fillLight = new THREE.DirectionalLight("#38bdf8", 0.4);
      fillLight.position.set(-20, 40, -20);
      scene.add(fillLight);
    };

    setupLights(sceneA);
    setupLights(sceneB);

    // 4. Handle Window Resize
    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    // 5. Setup Raycasting click handler
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handleClick = (event: MouseEvent) => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      const rect = rendererRef.current.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, cameraRef.current);

      // Raycast against active scene (current view state read from refs).
      const pickables = comparisonModeRef.current === "swipe" && event.clientX - rect.left > rect.width * (swipePositionRef.current / 100)
        ? pickableObjectsBRef.current
        : pickableObjectsARef.current;

      const intersects = raycaster.intersectObjects(pickables, true);

      if (intersects.length > 0) {
        // Find entity ID in hierarchy
        let obj: THREE.Object3D | null = intersects[0].object;
        let id: string | null = null;
        while (obj) {
          id = objectToEntityMapRef.current.get(obj.uuid) || null;
          if (id) break;
          obj = obj.parent;
        }
        onSelectEntityRef.current(id);
      } else {
        onSelectEntityRef.current(null);
      }
    };

    renderer.domElement.addEventListener("click", handleClick);

    // 6. Animation Loop
    let animationFrameId: number;
    let frameCount = 0;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      frameCount++;
      
      if (controlsRef.current) {
        controlsRef.current.update();
      }

      const r = rendererRef.current;
      const cam = cameraRef.current;
      const sA = sceneARef.current;
      const sB = sceneBRef.current;

      if (r && cam && sA && sB) {
        if (import.meta.env.DEV && frameCount % 300 === 0) {
          console.log(`[PERF DIAGNOSTICS] Draw Calls: ${r.info.render.calls}, Triangles: ${r.info.render.triangles}, Geometries: ${r.info.memory.geometries}, Textures: ${r.info.memory.textures}`);
        }
        if (comparisonModeRef.current === "swipe" && stateBRef.current) {
          const w = containerRef.current?.clientWidth || window.innerWidth;
          const h = containerRef.current?.clientHeight || window.innerHeight;
          const swipeX = w * (swipePositionRef.current / 100);

          // Render Left side (Scene A)
          r.setScissorTest(true);
          r.setScissor(0, 0, swipeX, h);
          r.setViewport(0, 0, w, h);
          r.render(sA, cam);

          // Render Right side (Scene B)
          r.setScissor(swipeX, 0, w - swipeX, h);
          r.setViewport(0, 0, w, h);
          r.render(sB, cam);
          r.setScissorTest(false);
        } else {
          // Render only Scene A
          r.render(sA, cam);
        }
      }
    };
    animate();

    // DEV-only diagnostics hook for real-browser (Playwright) verification:
    // reports live renderer stats and a census of scene content by kind.
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__cceDiag = () => {
        const info = rendererRef.current?.info.render;
        const counts: Record<string, number> = {};
        const terrainColors = new Set<string>();
        sceneARef.current?.traverse((o) => {
          const kind = (o.userData as { kind?: string })?.kind;
          if (kind) counts[kind] = (counts[kind] || 0) + 1;
          if (kind === "terrain" && o instanceof THREE.Mesh) {
            const colors = o.geometry.getAttribute("color");
            for (let i = 0; i < colors.count; i++) {
              terrainColors.add([
                colors.getX(i).toFixed(6),
                colors.getY(i).toFixed(6),
                colors.getZ(i).toFixed(6),
              ].join(":"));
            }
          }
        });
        const canvas = rendererRef.current?.domElement;
        return {
          drawCalls: info?.calls ?? 0,
          triangles: info?.triangles ?? 0,
          lines: info?.lines ?? 0,
          points: info?.points ?? 0,
          canvasWidth: canvas?.width ?? 0,
          canvasHeight: canvas?.height ?? 0,
          webglContext: !!(canvas && (canvas.getContext("webgl2") || canvas.getContext("webgl"))),
          kinds: counts,
          activeOverlay: activeOverlayRef.current,
          terrainDistinctColors: terrainColors.size,
        };
      };
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      if (rendererRef.current) {
        rendererRef.current.domElement.removeEventListener("click", handleClick);
        rendererRef.current.dispose();
      }
      cancelAnimationFrame(animationFrameId);
    };
    // Mount-once: the renderer, camera, controls, and animation loop persist for
    // the component's lifetime. Transient view state is read via refs above.
  }, []);

  // 7. Update scenes when state changes
  useEffect(() => {
    const sceneA = sceneARef.current;
    const sceneB = sceneBRef.current;
    if (!sceneA || !sceneB) return;

    // Reset maps
    pickableObjectsARef.current = [];
    pickableObjectsBRef.current = [];
    objectToEntityMapRef.current.clear();

    // Helper to clear non-light children
    const clearScene = (scene: THREE.Scene) => {
      const toRemove = scene.children.filter(
        child => !(child instanceof THREE.Light || child instanceof THREE.AmbientLight || child instanceof THREE.DirectionalLight)
      );
      for (const obj of toRemove) {
        scene.remove(obj);
      }
    };

    clearScene(sceneA);
    clearScene(sceneB);

    // Build visual representation
    buildVisualWorld(stateA, sceneA, pickableObjectsARef.current, objectToEntityMapRef.current, activeOverlay);
    if (stateB) {
      buildVisualWorld(stateB, sceneB, pickableObjectsBRef.current, objectToEntityMapRef.current, activeOverlay);
    }
  }, [stateA, stateB, activeOverlay]);

  return <div ref={containerRef} className="w-full h-full" style={{ minHeight: "500px" }} />;
};

// Procedurally builds the visual meshes for a state snapshot
function buildVisualWorld(
  state: WorldState,
  scene: THREE.Scene,
  pickables: THREE.Object3D[],
  entityMap: Map<string, string>,
  overlayType: string
) {
  const width = state.mapWidth;
  const height = state.mapHeight;

  // 1. Generate Terrain Mesh
  const geom = new THREE.PlaneGeometry(width - 1, height - 1, width - 1, height - 1);
  geom.rotateX(-Math.PI / 2); // Lay flat on XZ plane

  // Move vertices according to elevation
  const pos = geom.attributes.position;
  const colors: number[] = [];

  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i) + (width - 1) / 2;
    const vz = pos.getZ(i) + (height - 1) / 2; // Z coordinate on Plane is actually Y on flat
    
    // Map to grid
    const gx = Math.min(width - 1, Math.max(0, Math.floor(vx)));
    const gy = Math.min(height - 1, Math.max(0, Math.floor(vz)));
    const idx = gy * width + gx;
    
    const elev = state.elevation[idx];
    pos.setY(i, elev * 0.04); // scale height slightly

    // Colors based on biome / overlay
    let color = new THREE.Color();
    
    if (overlayType === "politics") {
      // Find strongest political control
      let strongestGov = "";
      let maxPower = 15;
      for (const govId of Object.keys(state.politicalControl)) {
        const power = state.politicalControl[govId][idx];
        if (power > maxPower) {
          maxPower = power;
          strongestGov = govId;
        }
      }
      if (strongestGov === "gov_a") color.set("#06b6d4"); // Kingdom cyan
      else if (strongestGov === "gov_b") color.set("#ec4899"); // Republic magenta
      else color.set("#1f2937"); // neutral dark gray
    } else if (overlayType === "moisture") {
      color.setHSL(0.55, 0.8, state.moisture[idx] / 150);
    } else if (overlayType === "ore" && state.resources.oreGrade[idx] > 10) {
      color.setHSL(0.08, 0.9, state.resources.oreGrade[idx] / 100);
    } else if (overlayType === "timber" && state.resources.timberStock[idx] > 10) {
      color.setHSL(0.3, 0.9, state.resources.timberStock[idx] / 120);
    } else {
      // Standard Biome coloring
      const biome = state.biomes[idx];
      if (biome === "ocean") color.set("#1d4ed8");
      else if (biome === "wetland") color.set("#0f766e");
      else if (biome === "desert") color.set("#fbbf24");
      else if (biome === "forest") color.set("#166534");
      else if (biome === "grassland") color.set("#65a30d");
      else if (biome === "mountain") {
        if (elev > 650) color.set("#f3f4f6"); // snowcap
        else color.set("#4b5563");
      } else color.set("#374151");
    }

    colors.push(color.r, color.g, color.b);
  }

  geom.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geom.computeVertexNormals();

  const terrainMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.8,
    metalness: 0.1,
    flatShading: true, // low-poly style matches retro aesthetic
  });

  const terrainMesh = new THREE.Mesh(geom, terrainMaterial);
  terrainMesh.userData.kind = "terrain";
  terrainMesh.position.set(-width / 2, 0, -height / 2);
  terrainMesh.receiveShadow = true;
  scene.add(terrainMesh);

  // 2. Render Rivers
  const riverMaterial = new THREE.MeshStandardMaterial({
    color: "#38bdf8",
    roughness: 0.1,
    metalness: 0.9,
  });
  
  for (let idx = 0; idx < state.elevation.length; idx++) {
    if (state.flowAccumulation[idx] > 500 && state.elevation[idx] > 20) {
      const rx = idx % width - width / 2;
      const ry = state.elevation[idx] * 0.04 + 0.1; // slightly above terrain
      const rz = Math.floor(idx / width) - height / 2;
      
      const rGeom = new THREE.BoxGeometry(1.2, 0.2, 1.2);
      const rMesh = new THREE.Mesh(rGeom, riverMaterial);
      rMesh.userData.kind = "river";
      rMesh.position.set(rx, ry, rz);
      scene.add(rMesh);
    }
  }

  // 3. Render Roads
  const roadMaterial = new THREE.MeshStandardMaterial({
    color: "#6b7280",
    roughness: 0.9,
  });

  for (const rId of Object.keys(state.routes)) {
    const route = state.routes[rId];
    for (const pt of route.points) {
      const rx = pt[0] - width / 2;
      const rz = pt[1] - height / 2;
      const idx = pt[1] * width + pt[0];
      const ry = state.elevation[idx] * 0.04 + 0.05; // slightly above river

      const roadGeom = new THREE.BoxGeometry(0.8, 0.1, 0.8);
      const roadMesh = new THREE.Mesh(roadGeom, roadMaterial);
      roadMesh.userData.kind = "road";
      roadMesh.position.set(rx, ry, rz);
      scene.add(roadMesh);
    }
  }

  // 4. Render Settlements (Clusters of buildings)
  const houseMaterials = [
    new THREE.MeshStandardMaterial({ color: "#b45309", roughness: 0.7 }), // wood
    new THREE.MeshStandardMaterial({ color: "#b91c1c", roughness: 0.6 }), // brick
    new THREE.MeshStandardMaterial({ color: "#78716c", roughness: 0.8 }), // stone
  ];

  for (const sId of Object.keys(state.settlements)) {
    const s = state.settlements[sId];
    if (s.abandoned) continue;

    const sx = s.cellId % width - width / 2;
    const sz = Math.floor(s.cellId / width) - height / 2;
    const sy = state.elevation[s.cellId] * 0.04;

    const settlementGroup = new THREE.Group();
    settlementGroup.userData.kind = "settlement";
    settlementGroup.position.set(sx, sy, sz);

    // Spawn a small cluster of houses based on population size
    const houseCount = Math.min(25, Math.max(3, Math.floor(s.population / 20)));
    for (let h = 0; h < houseCount; h++) {
      const angle = (h / houseCount) * Math.PI * 2 + (murmurHash3(`house_${s.id}_${h}`) % 10) * 0.1;
      const dist = 0.8 + (murmurHash3(`dist_${s.id}_${h}`) % 10) * 0.15;
      
      const hx = Math.cos(angle) * dist;
      const hz = Math.sin(angle) * dist;
      const heightVal = 0.5 + (murmurHash3(`h_${s.id}_${h}`) % 6) * 0.15;

      const geom = new THREE.BoxGeometry(0.5, heightVal, 0.5);
      const mat = houseMaterials[murmurHash3(`mat_${s.id}_${h}`) % houseMaterials.length];
      const mesh = new THREE.Mesh(geom, mat);
      
      mesh.position.set(hx, heightVal / 2, hz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      settlementGroup.add(mesh);
    }

    // Add a representative tower/keep for administrative status
    const towerGeom = new THREE.BoxGeometry(0.8, 2.2, 0.8);
    const towerMat = new THREE.MeshStandardMaterial({ color: "#451a03", roughness: 0.8 });
    const tower = new THREE.Mesh(towerGeom, towerMat);
    tower.position.set(0, 1.1, 0);
    tower.castShadow = true;
    settlementGroup.add(tower);

    scene.add(settlementGroup);
    pickables.push(settlementGroup);
    entityMap.set(settlementGroup.uuid, s.id);
  }

  // 5. Render Bridges
  const bridgeMaterial = new THREE.MeshStandardMaterial({
    color: "#a8a29e", // grey stone
    roughness: 0.8,
  });

  for (const bId of Object.keys(state.bridges)) {
    const bridge = state.bridges[bId];
    if (bridge.status !== "active") continue;

    const bx = bridge.cellId % width - width / 2;
    const bz = Math.floor(bridge.cellId / width) - height / 2;
    const by = state.elevation[bridge.cellId] * 0.04;

    const bridgeGroup = new THREE.Group();
    bridgeGroup.userData.kind = "bridge";
    bridgeGroup.position.set(bx, by, bz);

    // Draw an arch span bridge
    const deckGeom = new THREE.BoxGeometry(1.6, 0.25, 2.2);
    const deck = new THREE.Mesh(deckGeom, bridgeMaterial);
    deck.position.set(0, 0.3, 0);
    deck.castShadow = true;
    bridgeGroup.add(deck);

    const archGeom = new THREE.BoxGeometry(1.2, 0.4, 1.6);
    const arch = new THREE.Mesh(archGeom, bridgeMaterial);
    arch.position.set(0, 0.0, 0);
    bridgeGroup.add(arch);

    scene.add(bridgeGroup);
    pickables.push(bridgeGroup);
    entityMap.set(bridgeGroup.uuid, bridge.id);
  }

  // 6. Render Ruins (Scars)
  const ruinMaterial = new THREE.MeshStandardMaterial({
    color: "#78716c", // stony debris
    roughness: 0.95,
  });

  for (const scarId of Object.keys(state.scars)) {
    const scar = state.scars[scarId];
    if (scar.type === "ruined_foundation") {
      const rx = scar.cellId % width - width / 2;
      const rz = Math.floor(scar.cellId / width) - height / 2;
      const ry = state.elevation[scar.cellId] * 0.04;

      const ruinsGroup = new THREE.Group();
      ruinsGroup.userData.kind = "ruin";
      ruinsGroup.position.set(rx, ry, rz);

      // Create collapsed stone blocks
      const count = 5;
      for (let r = 0; r < count; r++) {
        const blockGeom = new THREE.BoxGeometry(0.4, 0.25, 0.4);
        const block = new THREE.Mesh(blockGeom, ruinMaterial);
        
        const dx = (murmurHash3(`r_x_${scar.id}_${r}`) % 10) * 0.08 - 0.4;
        const dz = (murmurHash3(`r_z_${scar.id}_${r}`) % 10) * 0.08 - 0.4;
        
        block.position.set(dx, 0.1, dz);
        block.rotation.set(
          (murmurHash3(`rot_x_${scar.id}_${r}`) % 10) * 0.2,
          (murmurHash3(`rot_y_${scar.id}_${r}`) % 10) * 0.2,
          0
        );
        ruinsGroup.add(block);
      }

      scene.add(ruinsGroup);
      pickables.push(ruinsGroup);
      entityMap.set(ruinsGroup.uuid, scarId);
    }
  }
}
