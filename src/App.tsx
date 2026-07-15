import { useState, useEffect, useRef } from "react";
import type { WorldState } from "./core/types";
import { Branch } from "./timelines/branch";
import type { TimelineIntervention } from "./timelines/branch";
import { CausalLedger } from "./timelines/ledger";
import { MapViewer } from "./rendering/MapViewer";
import { Timeline } from "./ui/Timeline";
import { DivergenceControls } from "./ui/DivergenceControls";
import { Inspector } from "./ui/Inspector";
import { GitFork, Activity } from "lucide-react";
import { simulateYear } from "./core/scheduler";
import { generateWorld } from "./geography/terrain";

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

  // Playback timer Ref
  const playTimerRef = useRef<any>(null);

  // 1. Initialize Full Simulation for Parent Branch
  const runSimulationA = () => {
    setIsSimulating(true);
    setSimulatedProgress(0);

    const worker = spawnWorker();
    if (worker) {
      const requestId = Math.random().toString(36).substring(7);
      worker.postMessage({
        type: "RUN_BASELINE",
        requestId,
        seed,
        endYear: 400,
      });

      worker.onmessage = (e) => {
        const { type, completedYear, endYear, result, message } = e.data;
        if (type === "PROGRESS") {
          setSimulatedProgress(Math.round((completedYear / endYear) * 100));
        } else if (type === "COMPLETE") {
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
          worker.terminate();
        } else if (type === "ERROR") {
          console.error("Worker error during baseline:", message);
          setIsSimulating(false);
          worker.terminate();
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
      
      branchARef.current = tempBranch;
      ledgerARef.current = tempLedger;
      statesListARef.current = cachedStates;

      statesListBRef.current = {};
      branchBRef.current = undefined;
      ledgerBRef.current = undefined;
      setHasSecondBranch(false);
      setComparisonMode("none");

      setCurrentYear(0);
      setIsSimulating(false);
    }
  };

  useEffect(() => {
    runSimulationA();
  }, [seed]);

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

  // 3. Trigger Bridge Suppression Counterfactual Intervention
  const triggerIntervention = () => {
    if (isSimulating) return;
    setIsSimulating(true);
    setSimulatedProgress(0);

    const intervention: TimelineIntervention = {
      interventionId: "interv_suppress_bridge_10",
      parentBranchId: "main",
      newBranchId: "suppress_bridge_branch",
      insertionYear: 10,
      targetIds: ["bridge_6428"],
      operation: "suppress_event",
      parameters: {},
    };

    const worker = spawnWorker();
    if (worker) {
      const requestId = Math.random().toString(36).substring(7);
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
        const { type, completedYear, endYear, result, message } = e.data;
        if (type === "PROGRESS") {
          setSimulatedProgress(Math.round((completedYear / endYear) * 100));
        } else if (type === "COMPLETE") {
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
          worker.terminate();
        } else if (type === "ERROR") {
          console.error("Worker error during branch resimulation:", message);
          setIsSimulating(false);
          worker.terminate();
        }
      };
    } else {
      // Fallback to synchronous simulation
      const subBranch = new Branch("suppress_bridge_branch", "main", intervention);
      const subLedger = new CausalLedger("suppress_bridge_branch");

      const snapshot = branchARef.current.snapshots[0];
      const state = structuredClone(snapshot.state);

      for (const evId of Object.keys(snapshot.ledgerEvents)) {
        subLedger.addEvent(snapshot.ledgerEvents[evId]);
      }

      const cachedStatesB: Record<number, WorldState> = {};
      for (let y = 0; y < 10; y++) {
        cachedStatesB[y] = structuredClone(statesListARef.current[y]);
        subBranch.recordYearHash(y, branchARef.current.yearHashes[y]);
      }

      subLedger.addEvent({
        eventId: intervention.interventionId,
        time: { year: 10 },
        eventType: "timeline_intervention",
        location: {},
        actorIds: [],
        affectedEntityIds: ["bridge_6428"],
        conditions: [],
        immediateEffects: [],
        parentEventIds: [],
        resultingEventIds: [],
        ruleId: "user_intervention",
        summaryTemplate: "Timeline branch created: Suppress bridge construction at Year 10.",
        summaryArguments: { operation: "suppress_event" },
        confidence: 1.0,
      });

      for (let y = 10; y <= 400; y++) {
        simulateYear(state, subLedger, subBranch, y);
        cachedStatesB[y] = structuredClone(state);
      }

      statesListBRef.current = cachedStatesB;
      branchBRef.current = subBranch;
      ledgerBRef.current = subLedger;

      setHasSecondBranch(true);
      setComparisonMode("swipe");
      setCurrentYear(10);
      setIsSimulating(false);
    }
  };

  const activeStateA = statesListARef.current[currentYear];
  const activeStateB = statesListBRef.current[currentYear];

  const parentBridge = activeStateA ? Object.values(activeStateA.bridges).find(b => b.status === "active") : null;
  const bridgeExists = parentBridge !== null;

  return (
    <div className="w-full h-full relative bg-[#090d16] flex flex-col select-none">
      {activeStateA && (
        <MapViewer
          stateA={activeStateA}
          stateB={activeStateB}
          comparisonMode={comparisonMode}
          swipePosition={swipePosition}
          selectedEntityId={selectedEntityId}
          onSelectEntity={setSelectedEntityId}
          activeOverlay={activeOverlay}
        />
      )}

      {/* Top Header Panel */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 w-[450px] bg-slate-900/80 backdrop-blur-md border border-white/10 rounded-2xl p-4 shadow-2xl flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <div className="flex flex-col">
            <span className="text-[10px] text-cyan-400 font-bold tracking-widest uppercase flex items-center gap-1">
              <Activity size={12} /> Explorable Counterfactual Engine
            </span>
            <h1 className="text-sm font-extrabold text-white m-0 tracking-wide">CAUSAL CIVILIZATION ENGINE</h1>
          </div>
          <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-2 py-1">
            <span className="text-[9px] text-slate-400 uppercase font-mono">Seed</span>
            <input
              type="text"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              className="bg-transparent border-none text-[10px] font-mono text-cyan-300 w-28 focus:outline-none"
            />
          </div>
        </div>

        <div className="border-t border-white/10 pt-2.5 mt-1.5 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400">Timeline Branch:</span>
            <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-semibold ${
              hasSecondBranch ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30" : "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
            }`}>
              {hasSecondBranch ? "suppress_bridge_branch" : "main"}
            </span>
          </div>

          {bridgeExists && !hasSecondBranch && (
            <button
              onClick={triggerIntervention}
              className="bg-indigo-650 hover:bg-indigo-600 border border-indigo-400/40 text-white font-semibold text-xs px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition-all shadow-lg pulse-glow"
            >
              <GitFork size={13} /> Suppress Bridge Construction
            </button>
          )}
        </div>
      </div>

      <DivergenceControls
        comparisonMode={comparisonMode}
        onChangeComparisonMode={setComparisonMode}
        activeOverlay={activeOverlay}
        onChangeOverlay={setActiveOverlay}
        hasSecondBranch={hasSecondBranch}
        swipePosition={swipePosition}
        onChangeSwipePosition={setSwipePosition}
      />

      {selectedEntityId && activeStateA && (
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

      <Timeline
        currentYear={currentYear}
        maxYear={400}
        isPlaying={isPlaying}
        onTogglePlay={() => setIsPlaying(!isPlaying)}
        onSetYear={setCurrentYear}
        interventionYear={hasSecondBranch ? 10 : undefined}
      />

      {isSimulating && (
        <div className="absolute inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
          <div className="loader-spin" />
          <span className="text-sm font-semibold text-cyan-300 tracking-wider">Recompiling Causal History...</span>
          <span className="text-xs text-slate-400 font-mono">Progress: {simulatedProgress}%</span>
        </div>
      )}
    </div>
  );
}

export default App;
