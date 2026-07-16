import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RotateCcw } from "lucide-react";
import type { WorldState } from "../core/types";
import { murmurHash3 } from "../core/random";
import {
  mapKeyToCameraAction,
  computeCameraFrameDeltas,
  shouldSuppressCameraKeys,
  updateDragExceededThreshold,
  type CameraKeyAction,
} from "./cameraControls";

// Camera-reset glide rate, ported directly from Parable's CAMERA_SMOOTH
// (godot-spike/scripts/camera_rig.gd) — see docs/PARABLE_CONTROL_PORT.md.
const CAMERA_RESET_SMOOTH = 12.0;
const CAMERA_RESET_EPSILON = 0.01;

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
  // Set by the mount-once effect; lets JSX (e.g. the reset button) trigger
  // behavior owned by the persistent camera-control closure without lifting
  // that closure's state into React.
  const triggerResetRef = useRef<() => void>(() => {});
  
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
    renderer.shadowMap.type = THREE.PCFShadowMap;
    
    // Clear container and append canvas
    containerRef.current.innerHTML = "";
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 2. Initialize Camera & Controls
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    // Position camera looking down at an angle
    camera.position.set(0, 90, 120);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2.1; // Don't go below ground
    controls.minDistance = 10;
    controls.maxDistance = 300;
    controls.target.set(0, 0, 0);
    // Ported from Parable's camera_rig.gd (docs/PARABLE_CONTROL_PORT.md):
    // left-drag pans, middle-drag orbits (the reverse of OrbitControls'
    // defaults); a modest polar-angle floor avoids a fully top-down snap,
    // matching Parable's pitch never reaching true overhead. Parable's
    // world-position pan clamp (position.x/z bounded to +/-60) was attempted
    // here via OrbitControls' maxTargetRadius but removed: adversarially
    // testing orbit-after-pan showed the target drifting away from the
    // orbit pivot once panned near the clamp boundary (an interaction
    // between the radius clamp and repeated per-frame recomputation, not
    // present when orbiting from an unclamped target). Panning is therefore
    // unbounded in this port; see docs/PARABLE_CONTROL_PORT.md.
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    };
    controls.minPolarAngle = THREE.MathUtils.degToRad(8);
    // Captures the existing initial camera view as the "R"/reset-button home
    // pose (Parable's own reset target does not transfer — its numbers
    // describe a different, smaller world; see PARABLE_CONTROL_PORT.md).
    controls.saveState();
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

    // Ported click-vs-drag disambiguation (Parable's hand_input.gd
    // CLICK_DRAG_THRESHOLD_PX, see docs/PARABLE_CONTROL_PORT.md): now that
    // left-drag pans the camera, a pan gesture's mouseup must not also
    // register as an entity-selection click. dragExceeded is a *sticky* flag
    // updated on every pointermove (not just checked against the final
    // release point) — a large drag that curls back near its start before
    // release must still count as a drag, not a click. preDragSnapshot lets
    // a genuine click revert any tiny pan OrbitControls' own damping applied
    // from sub-threshold pointer wobble between press and release.
    let pointerDownPos: { x: number; y: number } | null = null;
    let activePointerId: number | null = null;
    let dragExceeded = false;
    let preDragSnapshot: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;

    const handlePointerDown = (event: PointerEvent) => {
      pointerDownPos = { x: event.clientX, y: event.clientY };
      activePointerId = event.pointerId;
      dragExceeded = false;
      preDragSnapshot = { position: camera.position.clone(), target: controls.target.clone() };
    };
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);

    // enableDamping means OrbitControls only applies a fraction
    // (dampingFactor) of its accumulated _sphericalDelta/_panOffset per
    // update() call, not the whole thing at once — the remainder stays
    // queued and keeps getting (partially) applied on subsequent frames.
    // Copying camera.position/controls.target back to a snapshot is not
    // enough on its own: whatever hadn't been applied yet re-appears on the
    // very next frame(s), partially re-introducing the movement that was
    // just reverted. Not part of the public .d.ts, hence the narrow cast.
    const zeroDampingAccumulators = () => {
      const internals = controls as unknown as {
        _sphericalDelta: { theta: number; phi: number };
        _panOffset: THREE.Vector3;
      };
      internals._sphericalDelta.theta = 0;
      internals._sphericalDelta.phi = 0;
      internals._panOffset.set(0, 0, 0);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!pointerDownPos || event.pointerId !== activePointerId) return;
      dragExceeded = updateDragExceededThreshold(pointerDownPos.x, pointerDownPos.y, event.clientX, event.clientY, dragExceeded);
    };
    renderer.domElement.addEventListener("pointermove", handlePointerMove);

    const clearPointerGestureState = () => {
      pointerDownPos = null;
      activePointerId = null;
      dragExceeded = false;
      preDragSnapshot = null;
    };
    // Pointer release tracked at the window level (not just the canvas) so a
    // drag that ends outside the canvas still clears activePointerId — a
    // stale pointerId here is exactly what causes the blur/mouseleave
    // cancellation below to target the wrong (already-released) pointer.
    // Deliberately narrower than clearPointerGestureState: native pointerup
    // always fires *before* click for a completed in-canvas gesture, so
    // clearing dragExceeded/preDragSnapshot here would erase them before
    // handleClick (below) gets to read them — the click-vs-drag classifier
    // and the sub-threshold-wobble revert would silently stop working.
    // handleClick owns clearing the rest, once it's done with them.
    const clearActivePointerId = () => {
      activePointerId = null;
    };
    window.addEventListener("pointerup", clearActivePointerId);
    window.addEventListener("pointercancel", clearActivePointerId);

    const handleClick = (event: MouseEvent) => {
      const wasDrag = dragExceeded;
      if (!wasDrag && preDragSnapshot) {
        // A genuine click: undo any tiny pan OrbitControls' own damping
        // already applied to camera position/target from sub-threshold
        // pointer movement between press and release, matching Parable's
        // own click gesture producing zero camera movement. Also zero the
        // pending damping accumulators themselves — otherwise whatever
        // hadn't been applied yet re-appears on the next frame(s), partially
        // undoing this revert (see zeroDampingAccumulators above).
        camera.position.copy(preDragSnapshot.position);
        controls.target.copy(preDragSnapshot.target);
        zeroDampingAccumulators();
      }
      clearPointerGestureState();
      if (wasDrag) return;
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

    // 5b. Ported keyboard controls (Q/E orbit, W/S pitch, +/- zoom, R reset —
    // see docs/PARABLE_CONTROL_PORT.md). Held-key state lives in a plain
    // closure Set, not React state, so holding a key never triggers a
    // re-render; per-frame movement is applied in the animation loop below.
    const heldCameraActions = new Set<CameraKeyAction>();
    let resetActive = false;

    const syncOrbitModifier = (event: KeyboardEvent) => {
      // Only Alt is remapped here. OrbitControls' own onMouseDown dispatch
      // already special-cases Shift (and Ctrl/Meta): when the configured
      // action is MOUSE.PAN and Shift is held, it natively switches to
      // rotate for that gesture — giving Parable's Shift+left-drag-orbits
      // behavior for free. Reactively setting LEFT to MOUSE.ROTATE for
      // Shift here would collide with that native check: OrbitControls'
      // MOUSE.ROTATE case *also* special-cases Shift, converting it back to
      // pan, silently canceling the intended orbit. Alt is not natively
      // special-cased, so it's the only modifier this needs to override.
      controls.mouseButtons.LEFT = event.altKey ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      syncOrbitModifier(event);
      if (shouldSuppressCameraKeys(event.target)) return;
      const action = mapKeyToCameraAction(event.code);
      if (!action) return;
      event.preventDefault();
      if (action === "reset") {
        resetActive = true;
        heldCameraActions.clear();
        return;
      }
      heldCameraActions.add(action);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      syncOrbitModifier(event);
      const action = mapKeyToCameraAction(event.code);
      if (action && action !== "reset") heldCameraActions.delete(action);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    // Cancels an in-progress pointer drag (orbit or pan) through
    // OrbitControls' own real pointer-up path — not just resetting `state`.
    // OrbitControls tracks the active pointer in a private `_pointers` array
    // and only clears it via its bound _onPointerUp handler (which also
    // releases pointer capture and removes its own document-level listeners).
    // Skipping that and only forcing `state = -1` leaves the pointer id in
    // `_pointers`; the *next* real pointerdown with the same id (the mouse
    // reuses pointerId 1 for its whole session in every major browser) is
    // then silently swallowed by OrbitControls' onPointerDown
    // (`_isTrackingPointer` short-circuits before `_onMouseDown` ever runs),
    // permanently breaking mouse-driven camera control until reload. Calling
    // the library's own handler guarantees its internal bookkeeping is
    // cleared exactly as it would be for a real release. Not part of the
    // public .d.ts, hence the narrow casts.
    const cancelActivePointerDrag = () => {
      if (activePointerId !== null) {
        (controls as unknown as { _onPointerUp: (e: { pointerId: number }) => void })
          ._onPointerUp({ pointerId: activePointerId });
      }
      // Defensive fallback in case some path leaves state non-NONE without
      // an active pointer id (_onPointerUp above already does this when a
      // pointer was active).
      (controls as unknown as { state: number }).state = -1;
      // enableDamping means a completed drag keeps "coasting" otherwise —
      // see zeroDampingAccumulators above.
      zeroDampingAccumulators();
      controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
      // A cancelled drag must not be reclassified as a click if a stray
      // click event still arrives afterward (e.g. the button is released,
      // dispatching mouseup/click, immediately after this cancellation runs
      // on blur) — mark it as "was a drag" rather than resetting to the
      // fresh/click-eligible state clearPointerGestureState would produce.
      dragExceeded = true;
      preDragSnapshot = null;
      pointerDownPos = null;
      activePointerId = null;
    };

    // Ported focus-loss contract (Parable's world.gd _notification handler:
    // window blur clears held keys and any in-progress orbit/pan without
    // moving the camera; refocus never resumes a drag — see
    // docs/PARABLE_CONTROL_PORT.md).
    const clearTransientCameraInput = () => {
      heldCameraActions.clear();
      cancelActivePointerDrag();
    };
    window.addEventListener("blur", clearTransientCameraInput);
    const handleVisibilityChange = () => {
      if (document.hidden) clearTransientCameraInput();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Parable's world.gd also clears transient input on
    // NOTIFICATION_WM_MOUSE_EXIT (the mouse leaving the game surface), not
    // only on window focus loss. This is scoped to cancelling an in-progress
    // pointer drag only — not clearing held keyboard actions, which have no
    // "mouse left the canvas" analog in Parable (Q/E/W/S are independent of
    // pointer position) and would otherwise stop unexpectedly if the user
    // holds a key while glancing at another part of the page.
    renderer.domElement.addEventListener("pointerleave", cancelActivePointerDrag);

    triggerResetRef.current = () => {
      resetActive = true;
      heldCameraActions.clear();
    };

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // 6. Animation Loop
    let animationFrameId: number;
    let frameCount = 0;
    let lastFrameTime = performance.now();
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      frameCount++;

      const now = performance.now();
      // Clamp so a throttled/backgrounded tab resuming doesn't apply one huge
      // catch-up step (e.g. a full orbit) on its first frame back.
      const deltaSeconds = Math.min(0.1, Math.max(0, (now - lastFrameTime) / 1000));
      lastFrameTime = now;

      if (resetActive && cameraRef.current && controlsRef.current) {
        const ctrl = controlsRef.current;
        const cam = cameraRef.current;
        if (prefersReducedMotion) {
          cam.position.copy(ctrl.position0);
          ctrl.target.copy(ctrl.target0);
          resetActive = false;
        } else {
          const smooth = 1 - Math.exp(-CAMERA_RESET_SMOOTH * deltaSeconds);
          cam.position.lerp(ctrl.position0, smooth);
          ctrl.target.lerp(ctrl.target0, smooth);
          if (
            cam.position.distanceTo(ctrl.position0) < CAMERA_RESET_EPSILON &&
            ctrl.target.distanceTo(ctrl.target0) < CAMERA_RESET_EPSILON
          ) {
            cam.position.copy(ctrl.position0);
            ctrl.target.copy(ctrl.target0);
            resetActive = false;
          }
        }
      } else if (controlsRef.current && heldCameraActions.size > 0 && deltaSeconds > 0) {
        const ctrl = controlsRef.current;
        const { orbitAngle, pitchAngle, zoomScale } = computeCameraFrameDeltas(heldCameraActions, deltaSeconds);
        if (orbitAngle !== 0) ctrl.rotateLeft(orbitAngle);
        if (pitchAngle !== 0) ctrl.rotateUp(pitchAngle);
        if (zoomScale < 1) ctrl.dollyIn(zoomScale);
        else if (zoomScale > 1) ctrl.dollyOut(1 / zoomScale);
      }

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
          // Camera-control diagnostics for the ported Parable control scheme
          // (docs/PARABLE_CONTROL_PORT.md) — dev/test only, never in production.
          cameraPosition: cameraRef.current
            ? { x: cameraRef.current.position.x, y: cameraRef.current.position.y, z: cameraRef.current.position.z }
            : null,
          cameraTarget: controlsRef.current
            ? { x: controlsRef.current.target.x, y: controlsRef.current.target.y, z: controlsRef.current.target.z }
            : null,
          cameraHeldActions: [...heldCameraActions],
          cameraResetActive: resetActive,
          cameraControlsEnabled: controlsRef.current?.enabled ?? false,
          cameraMouseButtonLeft: controls.mouseButtons.LEFT,
          cameraActivePointerId: activePointerId,
          cameraDragExceeded: dragExceeded,
        };
      };
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", clearTransientCameraInput);
      window.removeEventListener("pointerup", clearActivePointerId);
      window.removeEventListener("pointercancel", clearActivePointerId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      triggerResetRef.current = () => {};
      if (rendererRef.current) {
        rendererRef.current.domElement.removeEventListener("pointerdown", handlePointerDown);
        rendererRef.current.domElement.removeEventListener("pointermove", handlePointerMove);
        rendererRef.current.domElement.removeEventListener("pointerleave", cancelActivePointerDrag);
        rendererRef.current.domElement.removeEventListener("click", handleClick);
        rendererRef.current.dispose();
      }
      controls.dispose();
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

  return (
    <div className="map-canvas-wrap">
      <div ref={containerRef} className="map-canvas" aria-label="Interactive civilization map" />
      <button
        type="button"
        className="icon-button map-reset-button"
        onClick={() => triggerResetRef.current()}
        aria-label="Reset camera view"
        title="Reset camera to the default view (R)"
      >
        <RotateCcw aria-hidden="true" />
      </button>
    </div>
  );
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
  terrainMesh.position.set(0, 0, 0);
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
    const routeGroup = new THREE.Group();
    routeGroup.userData.kind = "road";
    for (const pt of route.points) {
      const rx = pt[0] - width / 2;
      const rz = pt[1] - height / 2;
      const idx = pt[1] * width + pt[0];
      const ry = state.elevation[idx] * 0.04 + 0.05; // slightly above river

      const roadGeom = new THREE.BoxGeometry(0.8, 0.1, 0.8);
      const roadMesh = new THREE.Mesh(roadGeom, roadMaterial);
      roadMesh.position.set(rx, ry, rz);
      routeGroup.add(roadMesh);
    }
    scene.add(routeGroup);
    pickables.push(routeGroup);
    entityMap.set(routeGroup.uuid, route.id);
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
