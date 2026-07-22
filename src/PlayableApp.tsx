import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Crown,
  Flame,
  Globe2,
  Play,
  RotateCcw,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import type { HistoricalEvent, WorldState } from "./core/types";
import { MapViewer } from "./rendering/MapViewer";
import { Timeline } from "./ui/Timeline";
import { Branch } from "./timelines/branch";
import type { TimelineIntervention } from "./timelines/branch";
import { CausalLedger } from "./timelines/ledger";
import type { PlayableInterventionAction, PlayableInterventionKind } from "./timelines/interventionEffects";
import type { DivineMiracleAction, DivineMiracleKind } from "./timelines/miracleEffects";
import {
  STARTING_INFLUENCE,
  actionsForEntity,
  describeEntity,
  makeQueuedAction,
  scoreCivilization,
} from "./gameplay/gameplay";
import {
  STARTING_DIVINITY,
  miracleDefinition,
  miraclesForEntity,
  makeQueuedMiracle,
  worldMiracles,
} from "./gameplay/miracles";

const END_YEAR = 400;

const spawnWorker = () =>
  typeof Worker === "undefined"
    ? null
    : new Worker(new URL("./core/simulation.worker.ts", import.meta.url), { type: "module" });

function PlayableApp() {
  const [seed, setSeed] = useState("bridge-emergence-001");
  const [currentYear, setCurrentYear] = useState(25);
  const [baselineStates, setBaselineStates] = useState<Record<number, WorldState>>({});
  const [playerStates, setPlayerStates] = useState<Record<number, WorldState>>({});
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [queuedActions, setQueuedActions] = useState<PlayableInterventionAction[]>([]);
  const [queuedMiracles, setQueuedMiracles] = useState<DivineMiracleAction[]>([]);
  const [activeOmen, setActiveOmen] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<HistoricalEvent[]>([]);
  const [runCount, setRunCount] = useState(0);
  const [comparisonMode, setComparisonMode] = useState<"none" | "swipe" | "ghost" | "heat">("none");
  const [swipePosition, setSwipePosition] = useState(50);

  const baselineBranchRef = useRef(new Branch("main"));
  const baselineLedgerRef = useRef(new CausalLedger("main"));
  const activeWorkerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const omenTimerRef = useRef<number | null>(null);

  const baselineState = baselineStates[currentYear] ?? baselineStates[END_YEAR];
  const playerState = playerStates[currentYear] ?? playerStates[END_YEAR];
  const planningState = baselineState;
  const influenceSpent = queuedActions.reduce((sum, action) => sum + action.cost, 0);
  const influenceRemaining = STARTING_INFLUENCE - influenceSpent;
  const divinitySpent = queuedMiracles.reduce((sum, miracle) => sum + miracle.cost, 0);
  const divinityRemaining = STARTING_DIVINITY - divinitySpent;
  const availableActions = actionsForEntity(planningState, selectedEntityId);
  const availableMiracles = miraclesForEntity(planningState, selectedEntityId);
  const globalMiracles = worldMiracles();
  const baselineScore = scoreCivilization(baselineStates[END_YEAR]);
  const playerScore = scoreCivilization(playerStates[END_YEAR]);
  const scoreDelta = playerStates[END_YEAR] ? playerScore.total - baselineScore.total : 0;
  const planSize = queuedActions.length + queuedMiracles.length;

  const objectiveStatus = useMemo(() => {
    if (!playerStates[END_YEAR]) return [];
    return [
      {
        label: "Preserve settlements",
        passed: playerScore.survivingSettlements >= baselineScore.survivingSettlements,
        detail: `${playerScore.survivingSettlements} surviving`,
      },
      {
        label: "Improve resilience",
        passed: playerScore.resilience > baselineScore.resilience,
        detail: `${playerScore.resilience} vs ${baselineScore.resilience}`,
      },
      {
        label: "Beat baseline score",
        passed: playerScore.total > baselineScore.total,
        detail: `${scoreDelta >= 0 ? "+" : ""}${scoreDelta}`,
      },
    ];
  }, [baselineScore, playerScore, playerStates, scoreDelta]);

  const stopWorker = () => {
    activeWorkerRef.current?.terminate();
    activeWorkerRef.current = null;
  };

  const clearOmen = () => {
    if (omenTimerRef.current !== null) window.clearTimeout(omenTimerRef.current);
    omenTimerRef.current = null;
    setActiveOmen(null);
  };

  const showOmen = (invocation: string) => {
    if (omenTimerRef.current !== null) window.clearTimeout(omenTimerRef.current);
    setActiveOmen(invocation);
    omenTimerRef.current = window.setTimeout(() => {
      setActiveOmen(null);
      omenTimerRef.current = null;
    }, 2200);
  };

  const runBaseline = useCallback(() => {
    stopWorker();
    const worker = spawnWorker();
    if (!worker) {
      setError("This playable build requires Web Workers in the browser.");
      return;
    }

    const requestId = ++requestIdRef.current;
    activeWorkerRef.current = worker;
    setIsRunning(true);
    setProgress(0);
    setError(null);
    setBaselineStates({});
    setPlayerStates({});
    setQueuedActions([]);
    setQueuedMiracles([]);
    setEvents([]);
    setSelectedEntityId(null);
    setComparisonMode("none");
    clearOmen();

    worker.onmessage = (event) => {
      if (event.data.requestId !== requestId) return;
      if (event.data.type === "PROGRESS") {
        setProgress(Math.round((event.data.completedYear / event.data.endYear) * 100));
        return;
      }
      if (event.data.type === "ERROR") {
        setError(event.data.message);
        setIsRunning(false);
        stopWorker();
        return;
      }
      if (event.data.type === "COMPLETE") {
        const result = event.data.result;
        const branch = new Branch("main");
        branch.snapshots = result.snapshots;
        branch.yearHashes = result.yearHashes;
        const ledger = new CausalLedger("main");
        ledger.events = result.events;
        baselineBranchRef.current = branch;
        baselineLedgerRef.current = ledger;
        setBaselineStates(result.cachedStates);
        setCurrentYear(25);
        setIsRunning(false);
        stopWorker();
      }
    };

    worker.postMessage({ type: "RUN_BASELINE", requestId, seed, endYear: END_YEAR });
  }, [seed]);

  useEffect(() => {
    runBaseline();
    return () => {
      stopWorker();
      if (omenTimerRef.current !== null) window.clearTimeout(omenTimerRef.current);
    };
  }, [runBaseline]);

  const queueAction = (kind: PlayableInterventionKind) => {
    if (!selectedEntityId) return;
    const action = makeQueuedAction(kind, selectedEntityId, queuedActions.length + 1);
    if (action.cost > influenceRemaining) return;
    setQueuedActions((current) => [...current, action]);
  };

  const queueMiracle = (kind: DivineMiracleKind, targetId: string | null) => {
    const definition = miracleDefinition(kind);
    const miracle = makeQueuedMiracle(kind, targetId, queuedMiracles.length + 1);
    if (miracle.cost > divinityRemaining) return;
    setQueuedMiracles((current) => [...current, miracle]);
    showOmen(definition.invocation);
  };

  const executePlan = () => {
    if (planSize === 0 || isRunning) return;
    stopWorker();
    const worker = spawnWorker();
    if (!worker) return;

    const insertionYear = Math.max(1, Math.min(350, currentYear));
    const requestId = ++requestIdRef.current;
    const branchId = `player_branch_${runCount + 1}`;
    const intervention: TimelineIntervention = {
      interventionId: `player_intervention_${runCount + 1}_${insertionYear}`,
      parentBranchId: "main",
      newBranchId: branchId,
      insertionYear,
      targetIds: [...new Set([
        ...queuedActions.map((action) => action.targetId),
        ...queuedMiracles.flatMap((miracle) => miracle.targetId ? [miracle.targetId] : ["world"]),
      ])],
      operation: "alter_condition",
      parameters: { actions: queuedActions, miracles: queuedMiracles },
    };

    activeWorkerRef.current = worker;
    setIsRunning(true);
    setProgress(0);
    setError(null);

    worker.onmessage = (event) => {
      if (event.data.requestId !== requestId) return;
      if (event.data.type === "PROGRESS") {
        const completed = Math.max(insertionYear, event.data.completedYear);
        setProgress(Math.round(((completed - insertionYear) / (END_YEAR - insertionYear)) * 100));
        return;
      }
      if (event.data.type === "ERROR") {
        setError(event.data.message);
        setIsRunning(false);
        stopWorker();
        return;
      }
      if (event.data.type === "COMPLETE") {
        const result = event.data.result;
        setPlayerStates(result.cachedStates);
        setEvents(Object.values(result.events).sort((a: HistoricalEvent, b: HistoricalEvent) => b.time.year - a.time.year));
        setComparisonMode("swipe");
        setCurrentYear(insertionYear);
        setRunCount((count) => count + 1);
        setIsRunning(false);
        stopWorker();
      }
    };

    worker.postMessage({
      type: "RUN_BRANCH",
      requestId,
      parentBranchId: "main",
      intervention,
      endYear: END_YEAR,
      parentSnapshots: baselineBranchRef.current.snapshots,
      parentYearHashes: baselineBranchRef.current.yearHashes,
      parentCachedStates: baselineStates,
    });
  };

  const resetPlan = () => {
    setQueuedActions([]);
    setQueuedMiracles([]);
    setPlayerStates({});
    setEvents([]);
    setComparisonMode("none");
    clearOmen();
  };

  const interventionEvents = events.filter(
    (event) => event.eventType === "player_intervention" || event.eventType === "divine_miracle",
  );

  return (
    <main className="playable-shell">
      <header className="playable-header playable-header--godmode">
        <div>
          <span className="eyebrow">Overwatching god · causal strategy simulation</span>
          <h1>CAUSAL CIVILIZATION ENGINE</h1>
          <p>Guide mortals with policy, or bend the world directly through miracle and wrath.</p>
        </div>
        <label className="playable-seed">
          <span>World seed</span>
          <input value={seed} onChange={(event) => setSeed(event.target.value)} disabled={isRunning} />
          <button type="button" onClick={runBaseline} disabled={isRunning}><RotateCcw /> Rebuild world</button>
        </label>
        <div className="playable-resource">
          <span className="eyebrow">Influence</span>
          <strong>{influenceRemaining}</strong>
          <small>{influenceSpent} committed of {STARTING_INFLUENCE}</small>
        </div>
        <div className="playable-resource playable-resource--divinity">
          <span className="eyebrow">Divinity</span>
          <strong>{divinityRemaining}</strong>
          <small>{divinitySpent} invoked of {STARTING_DIVINITY}</small>
        </div>
        <div className="playable-resource">
          <span className="eyebrow">Outcome score</span>
          <strong>{playerStates[END_YEAR] ? playerScore.total : baselineScore.total}</strong>
          <small>{playerStates[END_YEAR] ? `${scoreDelta >= 0 ? "+" : ""}${scoreDelta} versus baseline` : "Baseline target"}</small>
        </div>
      </header>

      <section className="playable-workspace">
        <section className={`playable-map-stage${activeOmen ? " miracle-is-speaking" : ""}`}>
          {baselineState ? (
            <MapViewer
              stateA={baselineState}
              stateB={playerState}
              comparisonMode={comparisonMode}
              swipePosition={swipePosition}
              selectedEntityId={selectedEntityId}
              onSelectEntity={setSelectedEntityId}
              activeOverlay="none"
            />
          ) : <div className="playable-map-empty" />}

          {activeOmen && (
            <div className="divine-omen" role="status" aria-live="polite">
              <Crown />
              <strong>{activeOmen}</strong>
              <span>The world has heard you.</span>
            </div>
          )}

          {playerState && comparisonMode === "swipe" && (
            <label className="playable-swipe">
              <span>Baseline</span>
              <input type="range" min="0" max="100" value={swipePosition} onChange={(event) => setSwipePosition(Number(event.target.value))} />
              <span>Your history</span>
            </label>
          )}

          {isRunning && (
            <div className="playable-loader">
              <Sparkles />
              <strong>{baselineStates[END_YEAR] ? "Rewriting history" : "Generating world"}</strong>
              <progress max="100" value={progress} />
              <span>{progress}%</span>
            </div>
          )}
          {error && <div className="playable-error"><AlertTriangle /> {error}</div>}
        </section>

        <aside className="playable-director">
          <section className="divine-panel">
            <div className="playable-section-heading">
              <div><span className="eyebrow">Divine dominion</span><h2><Zap /> Miracles</h2></div>
              <strong className="divinity-readout">{divinityRemaining}</strong>
            </div>
            <p>Miracles consume Divinity, not Influence. World miracles require no selected target.</p>
            <div className="miracle-grid miracle-grid--world">
              {globalMiracles.map((miracle) => (
                <button
                  type="button"
                  key={miracle.kind}
                  className={`miracle-card miracle-card--${miracle.disposition}`}
                  onClick={() => queueMiracle(miracle.kind, null)}
                  disabled={isRunning || miracle.cost > divinityRemaining}
                >
                  <Globe2 />
                  <strong>{miracle.label}</strong>
                  <em>“{miracle.invocation}”</em>
                  <span>{miracle.description}</span>
                  <b>{miracle.cost} divinity</b>
                </button>
              ))}
            </div>
            {availableMiracles.length > 0 && (
              <>
                <span className="miracle-target-label">Miracles upon selected target</span>
                <div className="miracle-grid">
                  {availableMiracles.map((miracle) => (
                    <button
                      type="button"
                      key={miracle.kind}
                      className={`miracle-card miracle-card--${miracle.disposition}`}
                      onClick={() => queueMiracle(miracle.kind, selectedEntityId)}
                      disabled={isRunning || miracle.cost > divinityRemaining}
                    >
                      {miracle.disposition === "wrath" || miracle.disposition === "apocalypse" ? <Flame /> : <Sparkles />}
                      <strong>{miracle.label}</strong>
                      <em>“{miracle.invocation}”</em>
                      <span>{miracle.description}</span>
                      <b>{miracle.cost} divinity</b>
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>

          <section>
            <span className="eyebrow">Selected mortal target</span>
            <h2>{selectedEntityId ?? "Nothing selected"}</h2>
            <p>{describeEntity(planningState, selectedEntityId)}</p>
            <div className="playable-action-grid">
              {availableActions.map((action) => (
                <button
                  type="button"
                  key={action.kind}
                  className={`action-card action-card--${action.disposition}`}
                  onClick={() => queueAction(action.kind)}
                  disabled={isRunning || action.cost > influenceRemaining}
                >
                  <strong>{action.label}</strong>
                  <span>{action.description}</span>
                  <b>{action.cost} influence</b>
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="playable-section-heading">
              <div><span className="eyebrow">Causal decree</span><h2>{planSize} invocations</h2></div>
              <button type="button" className="icon-button" onClick={resetPlan} disabled={isRunning}><Trash2 /></button>
            </div>
            <ol className="playable-plan">
              {queuedMiracles.map((miracle) => {
                const definition = miracleDefinition(miracle.kind);
                return (
                  <li key={miracle.miracleId} className={`plan-miracle plan-miracle--${definition.disposition}`}>
                    <span>{definition.label}</span>
                    <code>{miracle.targetId ?? "THE WHOLE WORLD"}</code>
                    <b>{miracle.cost} D</b>
                  </li>
                );
              })}
              {queuedActions.map((action) => (
                <li key={action.actionId}>
                  <span>{action.kind.replaceAll("_", " ")}</span>
                  <code>{action.targetId}</code>
                  <b>{action.cost} I</b>
                </li>
              ))}
              {planSize === 0 && <li className="playable-empty">Select a target, issue policy, or invoke a world miracle.</li>}
            </ol>
            <button type="button" className="playable-execute" onClick={executePlan} disabled={isRunning || planSize === 0}>
              <Play /> Decree history from Year {Math.max(1, Math.min(350, currentYear))}
            </button>
          </section>

          <section>
            <span className="eyebrow">Objectives</span>
            <div className="playable-objectives">
              {objectiveStatus.length === 0 ? <p>Execute a decree to reveal the outcome objectives.</p> : objectiveStatus.map((objective) => (
                <div key={objective.label} className={objective.passed ? "passed" : "failed"}>
                  {objective.passed ? <CheckCircle2 /> : <AlertTriangle />}
                  <span><strong>{objective.label}</strong><small>{objective.detail}</small></span>
                </div>
              ))}
            </div>
          </section>

          <section className="playable-feed">
            <span className="eyebrow">Book of causation</span>
            {interventionEvents.slice(0, 10).map((event) => (
              <article key={event.eventId} className={event.eventType === "divine_miracle" ? "divine-event" : ""}>
                <strong>Year {event.time.year}</strong>
                <p>{String(event.summaryArguments.miracle ?? event.summaryArguments.action)} → {String(event.summaryArguments.target ?? event.summaryArguments.targetId)}</p>
              </article>
            ))}
            {interventionEvents.length === 0 && <p>Your policies and miracles will be recorded here.</p>}
          </section>
        </aside>
      </section>

      <Timeline
        currentYear={currentYear}
        maxYear={END_YEAR}
        isPlaying={false}
        disabled={!baselineState || isRunning}
        markers={[]}
        onTogglePlay={() => {}}
        onSetYear={setCurrentYear}
        interventionYear={playerStates[END_YEAR] ? Math.max(1, Math.min(350, currentYear)) : undefined}
      />
    </main>
  );
}

export default PlayableApp;
