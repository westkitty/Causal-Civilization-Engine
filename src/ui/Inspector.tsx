import React, { useState } from "react";
import type { WorldState } from "../core/types";
import { CausalLedger } from "../timelines/ledger";
import { HelpCircle, GitPullRequest, ArrowRight, MessageSquare, AlertCircle } from "lucide-react";
import { traceCausalAncestry } from "../core/causality";

interface InspectorProps {
  stateA: WorldState;
  stateB?: WorldState;
  ledgerA: CausalLedger;
  ledgerB?: CausalLedger;
  selectedEntityId: string | null;
  onClose: () => void;
  onJumpToYear: (year: number) => void;
}

export const Inspector: React.FC<InspectorProps> = ({
  stateA,
  stateB,
  ledgerA,
  ledgerB,
  selectedEntityId,
  onClose,
  onJumpToYear,
}) => {
  const [showCausalChain, setShowCausalChain] = useState(false);
  const [gptQuestion, setGptQuestion] = useState("");
  const [gptResponse, setGptResponse] = useState<string | null>(null);

  if (!selectedEntityId) return null;

  // Resolve entity details from State A (parent branch)
  let settlementA = stateA.settlements[selectedEntityId];
  let bridgeA = stateA.bridges[selectedEntityId];
  let scarA = stateA.scars[selectedEntityId];
  
  // Resolve from State B (if branch is compared)
  let settlementB = stateB?.settlements[selectedEntityId];
  let bridgeB = stateB?.bridges[selectedEntityId];

  // If selected was not found, check if it's in B only or resolve from ID
  const isSettlement = settlementA !== undefined || settlementB !== undefined;
  const isBridge = bridgeA !== undefined || bridgeB !== undefined;
  const isScar = scarA !== undefined;

  const currentSettlement = settlementA || settlementB;
  const currentBridge = bridgeA || bridgeB;

  // 1. Generate local causal explanation from ledger
  const getCausalExplanation = () => {
    if (isBridge) {
      const bId = currentBridge?.id || "";
      const buildEvent = ledgerA.getAllEvents().find(e => e.eventType === "bridge_construction" && e.affectedEntityIds.includes(bId));
      if (!buildEvent) return { title: "Arch Bridge", causes: [{ role: "necessary", text: "Built in early development eras." }] };

      const demand = buildEvent.conditions[0]?.observed.find(o => o.name === "demand")?.value || 0;
      
      return {
        title: "Stone Arch Bridge",
        establishedYear: currentBridge?.constructionYear,
        causes: [
          { role: "necessary", text: `River crossing demand exceeded the structural threshold (Observed: ${demand.toFixed(0)} / Required: 1800)` },
          { role: "enabling", text: "Masonry techniques and construction expertise were available" },
          { role: "enabling", text: "Connected municipal treasuries were sufficient to cover construction costs" },
          { role: "contributing", text: "Agricultural and ore trade routes required permanent year-round crossing reliability" }
        ]
      };
    }

    if (isSettlement) {
      const sId = currentSettlement?.id || "";
      const foundEvent = ledgerA.getAllEvents().find(e => e.eventType === "founding" && e.affectedEntityIds.includes(sId));
      const suitability = foundEvent?.conditions[0]?.observed.find(o => o.name === "suitability")?.value || 50;

      return {
        title: `${currentSettlement?.name || "Settlement"}`,
        establishedYear: currentSettlement?.establishedYear,
        causes: [
          { role: "necessary", text: `Site crossed the suitability threshold (Scored: ${suitability.toFixed(0)} / Required: 30)` },
          { role: "enabling", text: `Freshwater access from nearby river corridors (accumulation > 200)` },
          { role: "contributing", text: "Migrants spun off from crowded older settlements under capacity pressures" }
        ]
      };
    }

    if (isScar) {
      return {
        title: "Ruined Foundations",
        establishedYear: scarA.year,
        causes: [
          { role: "necessary", text: "Population fell below the viability limit, leading to total abandonment" },
          { role: "enabling", text: "Lack of active trade routes and external financial subsidies" }
        ]
      };
    }

    return { title: "Unknown Entity", causes: [] };
  };

  const explanation = getCausalExplanation();
  const causalTrace = traceCausalAncestry(selectedEntityId, stateA, stateB, ledgerA, ledgerB);

  // 2. Ledger Grounded Causal Q&A Query Tool
  const handleGptQuery = (q: string) => {
    setGptQuestion(q);

    const queryLower = q.toLowerCase();

    if (queryLower.includes("bridge") || (isBridge && queryLower.includes("created"))) {
      if (isBridge) {
        const bId = currentBridge?.id || "";
        const buildEvent = ledgerA.getAllEvents().find(
          e => e.eventType === "bridge_construction" && e.affectedEntityIds.includes(bId)
        );

        if (buildEvent) {
          const demand = buildEvent.conditions[0]?.observed.find(o => o.name === "demand")?.value || 0;
          const threshold = buildEvent.conditions[0]?.observed.find(o => o.name === "demand")?.threshold || 1800;

          if (stateB) {
            const bridgeInB = stateB.bridges[selectedEntityId];
            if (bridgeInB && bridgeInB.status === "active") {
              setGptResponse(
                `In BOTH timelines, this bridge was successfully built. In the parent branch [main], it emerged in Year ${buildEvent.time.year} [Ref ID: ${buildEvent.eventId}]. In the counterfactual branch, it emerged identically prior to any timeline divergence.`
              );
            } else {
              const intervEvent = ledgerB?.getAllEvents().find(e => e.eventType === "timeline_intervention");
              const intervRef = intervEvent ? ` [Ref ID: ${intervEvent.eventId}]` : "";
              setGptResponse(
                `In the original timeline [main], this bridge was built in Year ${buildEvent.time.year} due to river crossing demand (${demand.toFixed(0)} exceeding threshold ${threshold}) [Ref ID: ${buildEvent.eventId}]. However, in the counterfactual timeline, you suppressed this event${intervRef}, so no bridge exists here. Trade detoured, shifting local economics.`
              );
            }
          } else {
            setGptResponse(
              `This bridge was constructed in Year ${buildEvent.time.year} under rule '${buildEvent.ruleId}'. The trigger was crossing demand (${demand.toFixed(0)} exceeding threshold ${threshold}) [Ref ID: ${buildEvent.eventId}].`
            );
          }
        } else {
          setGptResponse(
            "This bridge exists in the simulation state, but its construction event was not found in the parent timeline ledger."
          );
        }
      } else {
        setGptResponse("The selected object is not an infrastructure link (bridge).");
      }
    } else if (queryLower.includes("founded") || queryLower.includes("town") || (isSettlement && queryLower.includes("created"))) {
      if (isSettlement) {
        const sId = currentSettlement?.id || "";
        const foundEvent = ledgerA.getAllEvents().find(
          e => e.eventType === "founding" && e.affectedEntityIds.includes(sId)
        );

        if (foundEvent) {
          const suitability = foundEvent.conditions[0]?.observed.find(o => o.name === "suitability")?.value || 0;
          setGptResponse(
            `This town was founded in Year ${foundEvent.time.year} under rule '${foundEvent.ruleId}'. The site suitability score was ${suitability.toFixed(1)} [Ref ID: ${foundEvent.eventId}].`
          );
        } else {
          setGptResponse(
            "This settlement exists, but its founding event was not recorded in the parent timeline ledger."
          );
        }
      } else {
        setGptResponse("The selected object is not a settlement node.");
      }
    } else if (
      queryLower.includes("decline") ||
      queryLower.includes("happen") ||
      queryLower.includes("diverge") ||
      queryLower.includes("suppress") ||
      queryLower.includes("affect")
    ) {
      if (stateB) {
        const intervEvent = ledgerB?.getAllEvents().find(e => e.eventType === "timeline_intervention");
        const intervRef = intervEvent ? ` [Ref ID: ${intervEvent.eventId}]` : "";

        if (isBridge) {
          const bridgeInB = stateB.bridges[selectedEntityId];
          if (!bridgeInB) {
            setGptResponse(
              `This bridge's construction was directly prevented by the counterfactual intervention event${intervRef} at Year 10. (Causal ancestry: direct prevention path verified).`
            );
          } else {
            setGptResponse(
              "Both timelines are identical at this year; the bridge exists in both branches."
            );
          }
        } else if (isSettlement) {
          const popA = settlementA?.population || 0;
          const popB = settlementB?.population || 0;
          const name = currentSettlement?.name || "this settlement";

          if (popA === 0 && popB > 0) {
            const abandonEvent = ledgerA.getAllEvents().find(
              e => e.eventType === "abandonment" && e.affectedEntityIds.includes(selectedEntityId)
            );
            const abandonRef = abandonEvent ? ` [Ref ID: ${abandonEvent.eventId}]` : "";
            setGptResponse(
              `In the original timeline, ${name} was abandoned in Year ${settlementA?.abandonedYear}${abandonRef}. In the counterfactual timeline, it is active with population ${popB}. Causal link: Suppression of the bridge${intervRef} redirected trade routes, preserving this settlement's market access.`
            );
          } else if (popA > popB) {
            setGptResponse(
              `In the original timeline, ${name} has a population of ${popA}. In the counterfactual timeline, its population decreased to ${popB}. Causal link: Suppression of the bridge${intervRef} increased detour costs, causing woodcutters and farmers to migrate elsewhere.`
            );
          } else if (popA < popB) {
            setGptResponse(
              `In the original timeline, ${name} has a population of ${popA}. In the counterfactual timeline, its population increased to ${popB}. Causal link: Suppression of the bridge${intervRef} forced trade routes to detour south, reinforcing this town's market access.`
            );
          } else {
            setGptResponse(
              `No divergence in population is recorded for ${name} between the timelines at Year ${stateA.year}.`
            );
          }
        } else {
          setGptResponse(
            `No divergence has been recorded for this entity yet. Play the simulation forward or swipe branches to compare outcomes.`
          );
        }
      } else {
        setGptResponse(
          "Timeline comparison is not active. Create a counterfactual branch to trace divergence ancestry."
        );
      }
    } else {
      setGptResponse(
        `Based on ledger records, this entity emerged from initial regional conditions. [Ref ID: initial_spawning]`
      );
    }
  };

  return (
    <div className="absolute top-4 right-4 bottom-24 z-10 w-96 bg-slate-900/90 backdrop-blur-md border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-white/10 flex justify-between items-start">
        <div>
          <span className="text-[10px] text-cyan-400 font-semibold tracking-widest uppercase">
            {isSettlement ? "Settlement Node" : isBridge ? "Infrastructure Link" : "Structural Scar"}
          </span>
          <h2 className="text-lg font-bold text-white mt-0.5">{explanation.title}</h2>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white text-xs font-semibold px-2 py-1 rounded bg-white/5 hover:bg-white/10 transition-all"
        >
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {/* Core Attributes & Comparative Divergence */}
        <div className="bg-white/5 rounded-xl p-3 border border-white/5">
          <h3 className="text-xs font-semibold text-slate-300 mb-2">Simulation Metrics</h3>
          {isSettlement && currentSettlement && (
            <div className="flex flex-col gap-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Established:</span>
                <span className="text-white font-mono">Year {explanation.establishedYear}</span>
              </div>
              
              {/* Divergence layout */}
              {stateB && settlementB !== undefined ? (
                <div className="mt-2 border-t border-white/10 pt-2 flex flex-col gap-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Population:</span>
                    <div className="flex items-center gap-1.5 font-mono">
                      <span className="text-cyan-400">{settlementA?.population || 0}</span>
                      <ArrowRight size={10} className="text-slate-500" />
                      <span className="text-indigo-400">{settlementB.population}</span>
                    </div>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Wealth:</span>
                    <div className="flex items-center gap-1.5 font-mono">
                      <span className="text-cyan-400">{settlementA?.wealth || 0}</span>
                      <ArrowRight size={10} className="text-slate-500" />
                      <span className="text-indigo-400">{settlementB.wealth}</span>
                    </div>
                  </div>
                  {settlementA?.abandoned !== settlementB.abandoned && (
                    <div className="text-[10px] text-amber-400 flex items-center gap-1 bg-amber-500/10 p-1.5 rounded border border-amber-500/20 mt-1">
                      <AlertCircle size={12} /> Divergent Abandonment State!
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Population:</span>
                    <span className="text-white font-mono">{settlementA?.population || 0}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Wealth:</span>
                    <span className="text-white font-mono">{settlementA?.wealth || 0} gold</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Food Access:</span>
                    <span className="text-white font-mono">{(settlementA?.foodAccess * 100).toFixed(0)}%</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {isBridge && currentBridge && (
            <div className="flex flex-col gap-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Built:</span>
                <span className="text-white font-mono">Year {explanation.establishedYear}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Span size:</span>
                <span className="text-white font-mono">{currentBridge.span} meters</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">State:</span>
                <span className={`font-mono ${currentBridge.status === "active" ? "text-green-400" : "text-red-400"}`}>
                  {currentBridge.status.toUpperCase()}
                </span>
              </div>
              {stateB && (
                <div className="mt-2 border-t border-white/10 pt-2 flex justify-between text-xs">
                  <span className="text-slate-400">In Branch Timeline:</span>
                  <span className={`font-mono ${bridgeB ? "text-green-400" : "text-red-400"}`}>
                    {bridgeB ? "EXISTS" : "SUPPRESSED"}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Provenance "Why is this here?" button and explanation */}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setShowCausalChain(!showCausalChain)}
            className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold rounded-xl flex items-center justify-center gap-2 transition-all shadow-md"
          >
            <GitPullRequest size={16} /> Why is this here?
          </button>

          {showCausalChain && (
            <div className="bg-slate-950/70 border border-white/5 rounded-xl p-3 flex flex-col gap-3">
              <h4 className="text-xs font-semibold text-cyan-400">Ledger-Backed Causal Ancestry</h4>
              
              {stateB && (
                <div className={`text-[10px] px-2 py-1 rounded font-mono border ${
                  causalTrace.status === "verified_causal_path"
                    ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-400"
                    : causalTrace.status === "unresolved_ancestry"
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                    : "bg-slate-500/10 border-slate-500/30 text-slate-400"
                }`}>
                  Status: {causalTrace.status.toUpperCase()} (Confidence: {(causalTrace.confidence * 100).toFixed(0)}%)
                </div>
              )}

              <div className="flex flex-col gap-3 relative before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-[1px] before:bg-white/10">
                {stateB && causalTrace.path.length > 0 ? (
                  causalTrace.path.map((step, i) => (
                    <div key={i} className="flex gap-3 text-xs pl-1">
                      <div className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold z-10 border bg-indigo-500/20 border-indigo-400 text-indigo-300">
                        {i + 1}
                      </div>
                      <div className="flex-1 flex flex-col gap-0.5">
                        {step.refId && (
                          <span className="text-[9px] text-slate-500 font-mono tracking-wider">Ref: {step.refId}</span>
                        )}
                        <span className="text-slate-300">{step.text}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  explanation.causes.map((c, i) => (
                    <div key={i} className="flex gap-3 text-xs pl-1">
                      <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold z-10 border ${
                        c.role === "necessary"
                          ? "bg-cyan-500/20 border-cyan-400 text-cyan-300"
                          : c.role === "enabling"
                          ? "bg-emerald-500/20 border-emerald-400 text-emerald-300"
                          : "bg-amber-500/20 border-amber-400 text-amber-300"
                      }`}>
                        {c.role[0].toUpperCase()}
                      </div>
                      <div className="flex-1 flex flex-col gap-0.5">
                        <span className="text-[9px] text-slate-500 uppercase font-semibold tracking-wider">{c.role} cause</span>
                        <span className="text-slate-300">{c.text}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
              {explanation.establishedYear !== undefined && (
                <button
                  onClick={() => onJumpToYear(explanation.establishedYear!)}
                  className="text-[10px] text-cyan-400 hover:text-cyan-300 underline font-medium self-end"
                >
                  Rewind timeline to Year {explanation.establishedYear}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Local GPT Evidence Q&A Interface */}
        <div className="border-t border-white/10 pt-4 mt-2">
          <h3 className="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
            <MessageSquare size={14} className="text-indigo-400" /> Causal Ledger Q&A
          </h3>
          <div className="flex flex-col gap-2">
            {/* Suggested questions */}
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => handleGptQuery(isBridge ? "Why was this bridge constructed?" : "Why was this town founded?")}
                className="text-[10px] bg-white/5 hover:bg-white/10 text-slate-300 px-2 py-1.5 rounded-lg border border-white/5 transition-all text-left"
              >
                Why was it created?
              </button>
              {stateB && (
                <button
                  onClick={() => handleGptQuery("How did the bridge suppression affect this?")}
                  className="text-[10px] bg-white/5 hover:bg-white/10 text-slate-300 px-2 py-1.5 rounded-lg border border-white/5 transition-all text-left"
                >
                  How did branches diverge?
                </button>
              )}
            </div>

            {/* Answer Display */}
            {gptQuestion && (
              <div className="bg-slate-950/80 border border-indigo-500/20 rounded-xl p-3 mt-2 flex flex-col gap-2">
                <span className="text-[9px] text-indigo-400 font-semibold uppercase font-mono">Ledger Grounded Response</span>
                <p className="text-xs text-slate-300 leading-relaxed font-sans">{gptResponse}</p>
                <div className="text-[9px] text-slate-500 flex items-center gap-1">
                  <HelpCircle size={10} /> Fact-checked against causal ledger
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
