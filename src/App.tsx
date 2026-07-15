import { useState, useEffect, useRef, useCallback } from "react";
import type { WorldState } from "./core/types";
import { Branch } from "./timelines/branch";
import type { TimelineIntervention } from "./timelines/branch";
import { CausalLedger } from "./timelines/ledger";
import { MapViewer } from "./rendering/MapViewer";
import { Timeline } from "./ui/Timeline";
import { DivergenceControls } from "./ui/DivergenceControls";
import { Inspector } from "./ui/Inspector";
import { AlertTriangle, CheckCircle2, Database, GitFork, RotateCcw } from "lucide-react";
import { simulateYear } from "./core/scheduler";
import { generateWorld } from "./geography/terrain";
import { resimulateBranch } from "./core/runner";
import { acceptResult } from "./core/requestGuard";

const spawnWorker = () => {
  if (typeof Worker !== "undefined") {
    return new Worker(new URL("./core/simulation.worker.ts", import.meta.url), { type: "module" });
  }
  return null;
};

function App() {
  const [seed, setSeed] = useState("bridge-emergence-001");
  const [currentYear, setCurrentYear] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeOverlay, setActiveOverlay] = useState<"none" | "politics" | "moisture" | "ore" | "timber">("none");
  const [comparisonMode, setComparisonMode] = useState<"none" | "swipe" | "ghost" | "heat">("none");
  const [swipePosition, setSwipePosition] = useState(50);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

  // Simulation timeline caches
  const statesListARef = useRef<Record<number, WorldState>>({});
  const statesListBRef = useRef<Record<number, WorldState>>({});
  const ledgerARef = useRef<CausalLedger>(new CausalLedger("main"));
  const ledgerBRef = useRef<CausalLedger | undefined>(undefined);
  const branchARef = useRef<Branch>(new Branch("main"));
  const branchBRef = useRef<Branch | undefined>(undefined);

  const [hasSecondBranch, setHasSecondBranch] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulatedProgress, setSimulatedProgress] = useState(0);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [simulationOperation, setSimulationOperation] = useState<"baseline" | "branch" | null>(null);

  // Worker lifecycle guards: only the latest request may commit results, prior
  // workers are terminated, and no state is written after unmount.
  const activeWorkerRef = useRef<Worker | null>(null);
  const latestRequestIdRef = useRef(0);
  const mountedRef = useRef(true);

  // Playback timer Ref
  const playTimerRef = useRef<any>(null);

  // 1. Initialize Full Simulation for Parent Branch
  const runSimulationA = useCallback(() => {
    // Supersede any in-flight run: bump the request id and kill the old worker.
    const requestId = ++latestRequestIdRef.current;
    if (activeWorkerRef.current) {
      activeWorkerRef.current.terminate();
      activeWorkerRef.current = null;
    }

    setIsSimulating(true);
    setSimulatedProgress(0);
    setSimulationError(null);
    setSimulationOperation("baseline");
    setSelectedEntityId(null);

    const commitBaseline = (result: any) => {
      statesListARef.current = result.cachedStates;

      const tempBranch = new Branch("main");
      tempBranch.yearHashes = result.yearHashes;
      tempBranch.snapshots = result.snapshots;

      const tempLedger = new CausalLedger("main");
      tempLedger.events = result.events;

      branchARef.current = tempBranch;
      ledgerARef.current = tempLedger;

      statesListBRef.current = {};
      branchBRef.current = undefined;
      ledgerBRef.current = undefined;
      setHasSecondBranch(false);
      setComparisonMode("none");
      setCurrentYear(0);
      setIsSimulating(false);
      setSimulationOperation(null);
    };

    const worker = spawnWorker();
    if (worker) {
      activeWorkerRef.current = worker;
      worker.postMessage({ type: "RUN_BASELINE", requestId, seed, endYear: 400 });

      worker.onmessage = (e) => {
        // Reject stale/superseded responses and post-unmount writes.
        if (!acceptResult(latestRequestIdRef.current, e.data.requestId, mountedRef.current)) return;
        const { type, completedYear, endYear, result, message } = e.data;
        if (type === "PROGRESS") {
          setSimulatedProgress(Math.round((completedYear / endYear) * 100));
        } else if (type === "COMPLETE") {
          commitBaseline(result);
          worker.terminate();
          if (activeWorkerRef.current === worker) activeWorkerRef.current = null;
        } else if (type === "ERROR") {
          console.error("Worker error during baseline:", message);
          setSimulationError(`Baseline simulation failed: ${message}`);
          setIsSimulating(false);
          setSimulationOperation(null);
          worker.terminate();
          if (activeWorkerRef.current === worker) activeWorkerRef.current = null;
        }
      };
    } else {
      // Fallback to synchronous simulation (Node / Vitest / E2E context)
      const tempBranch = new Branch("main");
      const tempLedger = new CausalLedger("main");
      const tempState = generateWorld(seed, 125, 125);

      simulateYear(tempState, tempLedger, tempBranch, 0);
      const cachedStates: Record<number, WorldState> = { 0: structuredClone(tempState) };

      for (let y = 1; y <= 400; y++) {
        simulateYear(tempState, tempLedger, tempBranch, y);
        cachedStates[y] = structuredClone(tempState);
      }

      if (!acceptResult(latestRequestIdRef.current, requestId, mountedRef.current)) return;
      commitBaseline({
        cachedStates,
        yearHashes: tempBranch.yearHashes,
        events: tempLedger.events,
        snapshots: tempBranch.snapshots,
      });
    }
  }, [seed]);

  useEffect(() => {
    runSimulationA();
  }, [runSimulationA]);

  // Terminate any active worker and block post-unmount writes on teardown.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (activeWorkerRef.current) {
        activeWorkerRef.current.terminate();
        activeWorkerRef.current = null;
      }
    };
  }, []);

  // DEV-only test seam for real-browser (Playwright) verification. Lets the
  // acceptance suite drive entity selection (Inspector) and resolve entity ids
  // deterministically without pixel-perfect canvas raycasting.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__cce = {
      selectEntity: (id: string | null) => setSelectedEntityId(id),
      firstSettlementId: () => {
        const st = statesListARef.current[currentYear] || statesListARef.current[0];
        return st ? Object.keys(st.settlements)[0] : null;
      },
      firstRouteId: () => {
        const st = statesListARef.current[currentYear] || statesListARef.current[0];
        return st ? Object.keys(st.routes)[0] ?? null : null;
      },
      firstGovernmentId: () => {
        const st = statesListARef.current[currentYear] || statesListARef.current[0];
        return st ? Object.keys(st.governments)[0] ?? null : null;
      },
      activeBridgeId: () => {
        const states = statesListARef.current;
        for (const y of Object.keys(states).map(Number).sort((a, b) => a - b)) {
          const b = Object.values(states[y].bridges).find(br => br.status === "active");
          if (b) return b.id;
        }
        return null;
      },
      politicsAt: (year: number = currentYear, branchId: "main" | "suppress_bridge_branch" = "main") => {
        const isBranch = branchId === "suppress_bridge_branch";
        const state = (isBranch ? statesListBRef.current : statesListARef.current)[year];
        if (!state) return null;
        const branch = isBranch ? branchBRef.current : branchARef.current;
        const ledger = isBranch ? ledgerBRef.current : ledgerARef.current;
        return {
          year: state.year,
          mapCells: state.mapWidth * state.mapHeight,
          governments: structuredClone(state.governments),
          activeSettlementIds: Object.keys(state.settlements)
            .filter(id => !state.settlements[id].abandoned)
            .sort(),
          politicalControl: structuredClone(state.politicalControl),
          stateHash: branch?.yearHashes[year] ?? null,
          politicalFoundingEventIds: ledger
            ? ledger.getAllEvents()
              .filter(event => event.eventType === "political_founding")
              .map(event => event.eventId)
              .sort()
            : [],
        };
      },
      currentYear: () => currentYear,
      hasSecondBranch: () => hasSecondBranch,
      activeOverlay: () => activeOverlay,
      showSimulationError: (message: string) => setSimulationError(message),
      clearSimulationError: () => setSimulationError(null),
    };
  }, [currentYear, hasSecondBranch, activeOverlay]);

  // 2. Playback logic
  useEffect(() => {
    if (isPlaying) {
      playTimerRef.current = setInterval(() => {
        setCurrentYear((prev) => {
          if (prev >= 400) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 150);
    } else {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    }

    return () => {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    };
  }, [isPlaying]);

  // Find the earliest active bridge in the cached baseline so the intervention
  // targets the actual emergent bridge id (not a hard-coded id that only fits
  // one seed).
  const findTargetBridgeId = (): string | null => {
    const states = statesListARef.current;
    const years = Object.keys(states).map(Number).sort((a, b) => a - b);
    for (const y of years) {
      const bridge = Object.values(states[y].bridges).find(b => b.status === "active");
      if (bridge) return bridge.id;
    }
    return null;
  };

  // 3. Trigger Bridge Suppression Counterfactual Intervention
  const triggerIntervention = () => {
    if (isSimulating) return;

    const targetBridgeId = findTargetBridgeId();
    if (!targetBridgeId) {
      setSimulationError("No bridge available to suppress in the baseline timeline.");
      return;
    }

    const intervention: TimelineIntervention = {
      interventionId: "interv_suppress_bridge_10",
      parentBranchId: "main",
      newBranchId: "suppress_bridge_branch",
      insertionYear: 10,
      targetIds: [targetBridgeId],
      operation: "suppress_event",
      parameters: {},
    };

    const requestId = ++latestRequestIdRef.current;
    if (activeWorkerRef.current) {
      activeWorkerRef.current.terminate();
      activeWorkerRef.current = null;
    }
    setIsSimulating(true);
    setSimulatedProgress(0);
    setSimulationError(null);
    setSimulationOperation("branch");

    const commitBranch = (result: any) => {
      const subBranch = new Branch("suppress_bridge_branch", "main", intervention);
      subBranch.yearHashes = result.yearHashes;
      subBranch.snapshots = result.snapshots;

      const subLedger = new CausalLedger("suppress_bridge_branch");
      subLedger.events = result.events;

      statesListBRef.current = result.cachedStates;
      branchBRef.current = subBranch;
      ledgerBRef.current = subLedger;

      setHasSecondBranch(true);
      setComparisonMode("swipe");
      setCurrentYear(10);
      setIsSimulating(false);
      setSimulationOperation(null);
    };

    const worker = spawnWorker();
    if (worker) {
      activeWorkerRef.current = worker;
      worker.postMessage({
        type: "RUN_BRANCH",
        requestId,
        parentBranchId: "main",
        intervention,
        endYear: 400,
        parentSnapshots: branchARef.current.snapshots,
        parentYearHashes: branchARef.current.yearHashes,
        parentCachedStates: statesListARef.current,
      });

      worker.onmessage = (e) => {
        if (!acceptResult(latestRequestIdRef.current, e.data.requestId, mountedRef.current)) return;
        const { type, completedYear, endYear, result, message } = e.data;
        if (type === "PROGRESS") {
          setSimulatedProgress(Math.round((completedYear / endYear) * 100));
        } else if (type === "COMPLETE") {
          commitBranch(result);
          worker.terminate();
          if (activeWorkerRef.current === worker) activeWorkerRef.current = null;
        } else if (type === "ERROR") {
          console.error("Worker error during branch resimulation:", message);
          setSimulationError(`Counterfactual resimulation failed: ${message}`);
          setIsSimulating(false);
          setSimulationOperation(null);
          worker.terminate();
          if (activeWorkerRef.current === worker) activeWorkerRef.current = null;
        }
      };
    } else {
      // Fallback to synchronous simulation (Node / Vitest / E2E context).
      const parentBranch = branchARef.current;
      const { ledger: subLedger, branch: subBranch, cachedStates } = resimulateBranch(
        parentBranch,
        ledgerARef.current,
        intervention,
        400,
        { parentCachedStates: statesListARef.current }
      );

      if (!acceptResult(latestRequestIdRef.current, requestId, mountedRef.current)) return;
      commitBranch({
        cachedStates,
        yearHashes: subBranch.yearHashes,
        events: subLedger.events,
        snapshots: subBranch.snapshots,
      });
    }
  };

  const activeStateA = statesListARef.current[currentYear];
  const activeStateB = statesListBRef.current[currentYear];

  const targetBridgeId = findTargetBridgeId();
  const overlayLabels = {
    none: "Terrain",
    politics: "Political",
    moisture: "Moisture",
    ore: "Metal ore",
    timber: "Timber",
  } as const;
  const notableEventTypes = new Set([
    "founding",
    "abandonment",
    "bridge_construction",
    "road_construction",
    "political_founding",
    "capital_relocation",
    "flood",
    "epidemic",
    "famine",
  ]);
  const markerBuckets = new Map<number, { count: number; types: Set<string> }>();
  if (activeStateA) {
    for (const event of ledgerARef.current.getAllEvents()) {
      if (!notableEventTypes.has(event.eventType)) continue;
      const bucket = Math.min(400, Math.floor(event.time.year / 10) * 10);
      const current = markerBuckets.get(bucket) ?? { count: 0, types: new Set<string>() };
      current.count += 1;
      current.types.add(event.eventType.replaceAll("_", " "));
      markerBuckets.set(bucket, current);
    }
  }
  const timelineMarkers = [...markerBuckets.entries()]
    .sort(([yearA], [yearB]) => yearA - yearB)
    .map(([year, marker]) => ({
      year,
      count: marker.count,
      label: `${marker.count} recorded event${marker.count === 1 ? "" : "s"}: ${[...marker.types].join(", ")}`,
    }));
  const governments = activeStateA
    ? Object.values(activeStateA.governments).map((government) => ({ id: government.id, name: government.name }))
    : [];
  const branchDisplay = hasSecondBranch
    ? comparisonMode === "swipe" ? "Comparing histories" : "Baseline view"
    : "Baseline history";
  const operationTitle = simulationOperation === "branch"
    ? "Recompiling Causal History..."
    : "Building baseline history";
  const operationDetail = simulationOperation === "branch"
    ? "Replaying Years 10–400 with the bridge-construction event suppressed. The baseline map remains available."
    : "Running the deterministic 400-year simulation in a Worker. Seed changes replace the active run.";

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <img src="/favicon.svg" alt="" aria-hidden="true" width="40" height="40" />
          <div>
            <span className="eyebrow">Explorable counterfactual simulator</span>
            <h1>CAUSAL CIVILIZATION ENGINE</h1>
          </div>
        </div>

        <div className="header-status" aria-label="Current simulation state">
          <div className="status-item">
            <span className="eyebrow">Simulation</span>
            <strong className="status-with-icon" aria-live="polite">
              {simulationError ? <AlertTriangle aria-hidden="true" /> : isSimulating ? <Database aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
              {simulationError ? "Needs attention" : isSimulating ? operationTitle : activeStateA ? "Ready" : "Preparing"}
            </strong>
          </div>
          <div className="status-item">
            <span className="eyebrow">Branch</span>
            <strong>{branchDisplay}</strong>
            <code>{hasSecondBranch ? "suppress_bridge_branch" : "main"}</code>
          </div>
          <div className="status-item">
            <span className="eyebrow">Overlay</span>
            <strong>{overlayLabels[activeOverlay]}</strong>
          </div>
          <div className="status-item status-item--year">
            <span className="eyebrow">Current year</span>
            <strong>{currentYear}</strong>
          </div>
        </div>

        <div className="seed-control">
          <label htmlFor="simulation-seed">Simulation seed</label>
          <input
            id="simulation-seed"
            type="text"
            value={seed}
            onChange={(event) => setSeed(event.target.value)}
            aria-describedby="seed-help"
            spellCheck="false"
          />
          <span id="seed-help">Editing replaces the active baseline run.</span>
        </div>

        <div className="primary-action">
          {targetBridgeId && !hasSecondBranch ? (
            <>
              <div className="primary-action__copy" id="branch-action-help">
                <span className="eyebrow">Counterfactual at Year 10</span>
                <span>Suppress <code>{targetBridgeId}</code> and create a new branch.</span>
              </div>
              <button
                type="button"
                className="action-button action-button--branch"
                onClick={triggerIntervention}
                aria-describedby="branch-action-help"
                disabled={isSimulating}
              >
                <GitFork aria-hidden="true" />
                {simulationOperation === "branch" ? "Recomputing branch" : "Suppress Bridge Construction"}
              </button>
            </>
          ) : hasSecondBranch ? (
            <div className="branch-ready" role="status">
              <CheckCircle2 aria-hidden="true" />
              <span><strong>Counterfactual ready.</strong> Compare it or return to baseline only.</span>
            </div>
          ) : (
            <div className="primary-action__copy">
              <span className="eyebrow">Counterfactual</span>
              <span>{isSimulating ? "Available after the baseline is ready." : "No bridge is available to suppress in this history."}</span>
            </div>
          )}
        </div>
      </header>

      <section className={`workspace ${activeStateA ? "" : "workspace--map-only"}`} aria-label="Simulation workspace">
        <section className="map-stage" aria-label="Map and comparison workspace">
          {activeStateA ? (
            <MapViewer
              stateA={activeStateA}
              stateB={activeStateB}
              comparisonMode={comparisonMode}
              swipePosition={swipePosition}
              selectedEntityId={selectedEntityId}
              onSelectEntity={setSelectedEntityId}
              activeOverlay={activeOverlay}
            />
          ) : (
            <div className="map-empty" aria-hidden="true" />
          )}

          <DivergenceControls
            comparisonMode={comparisonMode}
            onChangeComparisonMode={setComparisonMode}
            activeOverlay={activeOverlay}
            onChangeOverlay={setActiveOverlay}
            hasSecondBranch={hasSecondBranch}
            swipePosition={swipePosition}
            onChangeSwipePosition={setSwipePosition}
            governments={governments}
            onSelectEntity={setSelectedEntityId}
            disabled={!activeStateA}
          />

          <p className="map-help">
            <span aria-hidden="true">↔</span> Drag to orbit · scroll to zoom · select a settlement, road, or bridge to inspect
          </p>

          {comparisonMode === "swipe" && activeStateB && (
            <div className="comparison-map-overlay" aria-hidden="true">
              <span className="comparison-map-label comparison-map-label--baseline">Baseline · main</span>
              <span className="comparison-map-label comparison-map-label--branch">Counterfactual · bridge suppressed</span>
              <span className="comparison-divider-line" style={{ left: `${swipePosition}%` }}>
                <i />
              </span>
            </div>
          )}

          {isSimulating && (
            <section className="loader-card" role="status" aria-live="polite" aria-atomic="true">
              <div className="causal-loader" aria-hidden="true"><i /><i /><i /></div>
              <span className="eyebrow">{simulationOperation === "branch" ? "Counterfactual branch" : "Baseline history"}</span>
              <h2>{operationTitle}</h2>
              <p>{operationDetail}</p>
              <progress max="100" value={simulatedProgress} aria-label={`${operationTitle} progress`} />
              <div className="loader-card__progress">
                <span>Worker progress</span>
                <strong>Progress: {simulatedProgress}%</strong>
              </div>
            </section>
          )}

          {simulationError && (
            <section className="error-card" role="alert" aria-labelledby="simulation-error-title">
              <AlertTriangle aria-hidden="true" />
              <div>
                <span className="eyebrow">Simulation stopped</span>
                <h2 id="simulation-error-title">The history could not be completed</h2>
                <p>{simulationError}</p>
                <div className="error-card__actions">
                  <button type="button" className="action-button" onClick={runSimulationA}>
                    <RotateCcw aria-hidden="true" /> Retry baseline
                  </button>
                  <button type="button" className="text-button" onClick={() => setSimulationError(null)}>Dismiss</button>
                </div>
              </div>
            </section>
          )}
        </section>

        {activeStateA && (
          <Inspector
            stateA={activeStateA}
            stateB={activeStateB}
            ledgerA={ledgerARef.current}
            ledgerB={ledgerBRef.current}
            selectedEntityId={selectedEntityId}
            onClose={() => setSelectedEntityId(null)}
            onJumpToYear={setCurrentYear}
          />
        )}
      </section>

      <Timeline
        currentYear={currentYear}
        maxYear={400}
        isPlaying={isPlaying}
        disabled={!activeStateA || isSimulating}
        markers={timelineMarkers}
        onTogglePlay={() => setIsPlaying(!isPlaying)}
        onSetYear={setCurrentYear}
        interventionYear={hasSecondBranch ? 10 : undefined}
      />
    </main>
  );
}

export default App;
