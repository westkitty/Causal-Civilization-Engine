import React, { useState } from "react";
import type { WorldState } from "../core/types";
import { CausalLedger } from "../timelines/ledger";
import {
  AlertCircle,
  ArrowRight,
  Building2,
  GitPullRequest,
  HelpCircle,
  Link2,
  MapPin,
  MessageSquare,
  MousePointer2,
  Route as RouteIcon,
  ShieldCheck,
  X,
} from "lucide-react";
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

const formatNumber = (value: number, maximumFractionDigits = 0) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);

const readableEventType = (eventType: string) => eventType.replaceAll("_", " ");

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
  const [ledgerQuestion, setLedgerQuestion] = useState("");
  const [ledgerResponse, setLedgerResponse] = useState<string | null>(null);

  if (!selectedEntityId) {
    return (
      <aside className="inspector inspector--empty" aria-labelledby="inspector-title">
        <div className="inspector__empty-mark" aria-hidden="true">
          <img src="/favicon.svg" alt="" />
          <MousePointer2 />
        </div>
        <span className="eyebrow">Inspector</span>
        <h2 id="inspector-title">Select a map entity</h2>
        <p>Choose a settlement, road, bridge, or political faction to inspect its state and recorded causes.</p>
        <ul>
          <li><MapPin aria-hidden="true" /> Current measurements and status</li>
          <li><GitPullRequest aria-hidden="true" /> Ledger-backed causal evidence</li>
          <li><ArrowRight aria-hidden="true" /> Baseline and counterfactual comparison</li>
        </ul>
      </aside>
    );
  }

  const settlementA = stateA.settlements[selectedEntityId];
  const bridgeA = stateA.bridges[selectedEntityId];
  const routeA = stateA.routes[selectedEntityId];
  const governmentA = stateA.governments[selectedEntityId];
  const scarA = stateA.scars[selectedEntityId];
  const settlementB = stateB?.settlements[selectedEntityId];
  const bridgeB = stateB?.bridges[selectedEntityId];
  const routeB = stateB?.routes[selectedEntityId];
  const governmentB = stateB?.governments[selectedEntityId];

  const isSettlement = settlementA !== undefined || settlementB !== undefined;
  const isBridge = bridgeA !== undefined || bridgeB !== undefined;
  const isRoute = routeA !== undefined || routeB !== undefined;
  const isGovernment = governmentA !== undefined || governmentB !== undefined;
  const isScar = scarA !== undefined;

  const currentSettlement = settlementA || settlementB;
  const currentBridge = bridgeA || bridgeB;
  const currentRoute = routeA || routeB;
  const currentGovernment = governmentA || governmentB;

  const entityType = isSettlement
    ? "Settlement Node"
    : isBridge
      ? "Infrastructure Link"
      : isRoute
        ? "Transport route"
        : isGovernment
          ? "Government"
          : isScar
            ? "Historical scar"
            : "Unknown entity";
  const entityName = isSettlement
    ? currentSettlement?.name?.trim() || "Unnamed settlement"
    : isBridge
      ? "Stone arch bridge"
      : isRoute
        ? `${currentRoute?.type === "road" ? "Road" : currentRoute?.type ?? "Route"} link`
        : isGovernment
          ? currentGovernment?.name?.trim() || "Unnamed government"
          : isScar
            ? readableEventType(scarA.type)
            : "Entity not present at this year";

  const field = isSettlement ? "wealth" : isBridge ? "status" : isRoute ? "travelTime" : "intensity";
  const interventionEvent = ledgerB?.getAllEvents().find((event) => event.eventType === "timeline_intervention");
  const causalTrace = traceCausalAncestry({
    entityId: selectedEntityId,
    field,
    interventionEventId: interventionEvent?.eventId ?? "interv_suppress_bridge_10",
  }, stateA, stateB, ledgerA, ledgerB);

  const affectedEvents = ledgerA.getAllEvents()
    .filter((event) => event.affectedEntityIds.includes(selectedEntityId) || event.actorIds.includes(selectedEntityId))
    .sort((a, b) => b.time.year - a.time.year || a.eventId.localeCompare(b.eventId));

  const buildEvent = isBridge
    ? ledgerA.getAllEvents().find((event) => event.eventType === "bridge_construction" && event.affectedEntityIds.includes(selectedEntityId))
    : undefined;
  const foundingEvent = isSettlement
    ? ledgerA.getAllEvents().find((event) => event.eventType === "founding" && event.affectedEntityIds.includes(selectedEntityId))
    : undefined;
  const causeSummary = isBridge
    ? [
        `Crossing demand reached the bridge rule threshold${buildEvent ? ` in Year ${buildEvent.time.year}` : ""}.`,
        "A permanent link connected the existing transport corridor across the river.",
      ]
    : isSettlement
      ? [
          `The site met settlement suitability conditions${foundingEvent ? ` in Year ${foundingEvent.time.year}` : ""}.`,
          "Fresh water, terrain, and migration pressure contributed to the recorded founding.",
        ]
      : isRoute
        ? ["The route records a built transport corridor between settlement activity centers."]
        : isGovernment
          ? ["Government creation followed eligible settlement and capital prerequisites."]
          : isScar
            ? ["The scar preserves a recorded loss or abandonment in the physical landscape."]
            : ["This identifier is not present in the selected year."];

  const answerLedgerQuestion = (question: "created" | "diverged") => {
    setLedgerQuestion(question);
    if (question === "diverged") {
      if (!stateB) {
        setLedgerResponse("No counterfactual is ready. Create a branch before asking how this entity diverged.");
      } else if (isBridge && !bridgeB) {
        setLedgerResponse(`The Year 10 intervention directly suppressed this bridge. The baseline retains it; the counterfactual does not.${interventionEvent ? ` Evidence: ${interventionEvent.eventId}.` : ""}`);
      } else if (causalTrace.status === "verified_causal_path") {
        setLedgerResponse(`A verified path of ${causalTrace.path.length} ledger events connects the intervention to this changed ${field} value.`);
      } else if (causalTrace.status === "unresolved_ancestry") {
        setLedgerResponse("The value differs, but the ledger does not contain a continuous verified event path from the intervention. The difference remains unresolved.");
      } else {
        setLedgerResponse(`No ${field} divergence is recorded for this entity at Year ${stateA.year}.`);
      }
      return;
    }

    if (buildEvent) {
      setLedgerResponse(`The bridge-construction event was recorded in Year ${buildEvent.time.year} under rule ${buildEvent.ruleId}. Evidence: ${buildEvent.eventId}.`);
    } else if (foundingEvent) {
      setLedgerResponse(`The settlement founding was recorded in Year ${foundingEvent.time.year} under rule ${foundingEvent.ruleId}. Evidence: ${foundingEvent.eventId}.`);
    } else if (affectedEvents.length > 0) {
      setLedgerResponse(`The earliest matching record is ${affectedEvents.at(-1)?.eventId} in Year ${affectedEvents.at(-1)?.time.year}.`);
    } else {
      setLedgerResponse("No creation event for this identifier is present in the current ledger.");
    }
  };

  const entityIcon = isSettlement
    ? <Building2 aria-hidden="true" />
    : isRoute || isBridge
      ? <RouteIcon aria-hidden="true" />
      : isGovernment
        ? <ShieldCheck aria-hidden="true" />
        : <MapPin aria-hidden="true" />;

  return (
    <aside className="inspector inspector--selected" aria-labelledby="inspector-title">
      <header className="inspector__header">
        <div className="inspector__identity">
          <span className="inspector__icon">{entityIcon}</span>
          <div>
            <span className="eyebrow">{entityType}</span>
            <h2 id="inspector-title">{entityName}</h2>
            <code>{selectedEntityId}</code>
          </div>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close" title="Close Inspector">
          <X aria-hidden="true" />
        </button>
      </header>

      <div className="inspector__body">
        <section className="inspector-section" aria-labelledby="current-state-title">
          <div className="section-heading">
            <span className="eyebrow">At Year {stateA.year}</span>
            <h3 id="current-state-title">Current state</h3>
          </div>

          {isSettlement && currentSettlement && (
            <dl className="metric-list">
              <div><dt>Status</dt><dd><span className={`state-badge ${currentSettlement.abandoned ? "state-badge--ruined" : "state-badge--active"}`}>{currentSettlement.abandoned ? "Abandoned" : "Active"}</span></dd></div>
              <div><dt>Established</dt><dd>Year {currentSettlement.establishedYear}</dd></div>
              <div><dt>Population</dt><dd>{formatNumber(currentSettlement.population)} people</dd></div>
              <div><dt>Wealth</dt><dd>{formatNumber(currentSettlement.wealth)} gold</dd></div>
              <div><dt>Food access</dt><dd>{formatNumber(currentSettlement.foodAccess * 100)}%</dd></div>
              <div><dt>Water security</dt><dd>{formatNumber(currentSettlement.waterSecurity * 100)}%</dd></div>
            </dl>
          )}

          {isBridge && currentBridge && (
            <dl className="metric-list">
              <div><dt>Baseline status</dt><dd><span className={`state-badge ${currentBridge.status === "active" ? "state-badge--active" : "state-badge--ruined"}`}>{currentBridge.status}</span></dd></div>
              <div><dt>Built</dt><dd>Year {currentBridge.constructionYear}</dd></div>
              <div><dt>Span</dt><dd>{formatNumber(currentBridge.span)} metres</dd></div>
              <div><dt>Route</dt><dd><code>{currentBridge.routeEdgeId}</code></dd></div>
              {stateB && <div><dt>Counterfactual</dt><dd><span className={`state-badge ${bridgeB ? "state-badge--active" : "state-badge--suppressed"}`}>{bridgeB ? bridgeB.status : "SUPPRESSED"}</span></dd></div>}
            </dl>
          )}

          {isRoute && currentRoute && (
            <dl className="metric-list">
              <div><dt>Type</dt><dd>{currentRoute.type}</dd></div>
              <div><dt>Built</dt><dd>Year {currentRoute.constructionYear}</dd></div>
              <div><dt>Length</dt><dd>{formatNumber(currentRoute.length, 1)} cells</dd></div>
              <div><dt>Travel time</dt><dd>{formatNumber(currentRoute.travelTime, 1)} time units</dd></div>
              <div><dt>Capacity</dt><dd>{formatNumber(currentRoute.capacity)} units / year</dd></div>
              <div><dt>Condition</dt><dd>{formatNumber(currentRoute.condition * 100)}%</dd></div>
            </dl>
          )}

          {isGovernment && currentGovernment && (
            <dl className="metric-list">
              <div><dt>Status</dt><dd><span className="state-badge state-badge--active">Active government</span></dd></div>
              <div><dt>Capital</dt><dd><code>{currentGovernment.capitalId}</code></dd></div>
              <div><dt>Treasury</dt><dd>{formatNumber(currentGovernment.treasury)} gold</dd></div>
              <div><dt>Legitimacy</dt><dd>{formatNumber(currentGovernment.legitimacy * 100)}%</dd></div>
              <div><dt>Tax rate</dt><dd>{formatNumber(currentGovernment.taxRate * 100)}%</dd></div>
            </dl>
          )}

          {isScar && (
            <dl className="metric-list">
              <div><dt>Status</dt><dd><span className="state-badge state-badge--ruined">Recorded scar</span></dd></div>
              <div><dt>Formed</dt><dd>Year {scarA.year}</dd></div>
              <div><dt>Intensity</dt><dd>{formatNumber(scarA.intensity * 100)}%</dd></div>
            </dl>
          )}

          {!isSettlement && !isBridge && !isRoute && !isGovernment && !isScar && (
            <div className="inline-notice inline-notice--warning">
              <AlertCircle aria-hidden="true" /> This entity is unavailable at Year {stateA.year}. Try another year.
            </div>
          )}
        </section>

        {stateB && isSettlement && currentSettlement && (
          <section className="inspector-section" aria-labelledby="branch-comparison-title">
            <div className="section-heading">
              <span className="eyebrow">Baseline → counterfactual</span>
              <h3 id="branch-comparison-title">Branch comparison</h3>
            </div>
            <div className="comparison-table" role="table" aria-label="Settlement branch comparison">
              <div role="row"><span role="columnheader">Measure</span><span role="columnheader">Baseline</span><span role="columnheader">Counterfactual</span></div>
              <div role="row"><span role="rowheader">Population</span><strong>{formatNumber(settlementA?.population ?? 0)}</strong><strong>{formatNumber(settlementB?.population ?? 0)}</strong></div>
              <div role="row"><span role="rowheader">Wealth</span><strong>{formatNumber(settlementA?.wealth ?? 0)}</strong><strong>{formatNumber(settlementB?.wealth ?? 0)}</strong></div>
              <div role="row"><span role="rowheader">Status</span><strong>{settlementA?.abandoned ? "Abandoned" : "Active"}</strong><strong>{settlementB?.abandoned ? "Abandoned" : "Active"}</strong></div>
            </div>
          </section>
        )}

        <section className="inspector-section" aria-labelledby="history-title">
          <details>
            <summary>
              <span><span className="eyebrow">{affectedEvents.length} matching records</span><strong id="history-title">Historical changes</strong></span>
            </summary>
            {affectedEvents.length > 0 ? (
              <ol className="event-list">
                {affectedEvents.slice(0, 12).map((event) => (
                  <li key={event.eventId}>
                    <span>Year {event.time.year}</span>
                    <strong>{readableEventType(event.eventType)}</strong>
                    <p>{event.summaryTemplate || "Recorded ledger change."}</p>
                    <code>{event.eventId}</code>
                  </li>
                ))}
              </ol>
            ) : <p className="empty-copy">No matching ledger events are recorded for this identifier.</p>}
          </details>
        </section>

        <section className="inspector-section inspector-section--causal" aria-labelledby="causal-title">
          <button
            type="button"
            className="action-button action-button--causal"
            onClick={() => setShowCausalChain((visible) => !visible)}
            aria-expanded={showCausalChain}
          >
            <GitPullRequest aria-hidden="true" /> Why is this here?
          </button>

          {showCausalChain && (
            <div className="causal-panel">
              <div className="section-heading">
                <span className="eyebrow">Recorded evidence</span>
                <h3 id="causal-title">Ledger-Backed Causal Ancestry</h3>
              </div>
              {stateB && (
                <div className={`trace-status trace-status--${causalTrace.status}`}>
                  <Link2 aria-hidden="true" />
                  <span><strong>{readableEventType(causalTrace.status)}</strong> · {formatNumber(causalTrace.confidence * 100)}% confidence</span>
                </div>
              )}

              {stateB && causalTrace.status === "verified_causal_path" ? (
                <ol className="causal-path">
                  {causalTrace.path.map((step) => (
                    <li key={step.eventId}>
                      <span>Year {step.year}</span>
                      <strong>{readableEventType(step.eventType)}</strong>
                      <p>{step.summary}</p>
                      <code>{step.eventId}</code>
                    </li>
                  ))}
                </ol>
              ) : stateB && causalTrace.status === "unresolved_ancestry" ? (
                <div className="inline-notice inline-notice--warning">
                  <AlertCircle aria-hidden="true" />
                  <span><strong>Unresolved ancestry.</strong> The value differs, but no continuous ledger path connects it to the intervention.{causalTrace.missingEventIds.length > 0 ? ` Missing: ${causalTrace.missingEventIds.join(", ")}.` : ""}</span>
                </div>
              ) : (
                <ol className="cause-list">
                  {causeSummary.map((cause, index) => <li key={cause}><span>{index + 1}</span><p>{cause}</p></li>)}
                </ol>
              )}

              {(currentSettlement?.establishedYear ?? currentBridge?.constructionYear ?? currentRoute?.constructionYear) !== undefined && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => onJumpToYear(currentSettlement?.establishedYear ?? currentBridge?.constructionYear ?? currentRoute?.constructionYear ?? stateA.year)}
                >
                  Jump to recorded start year
                </button>
              )}
            </div>
          )}
        </section>

        <section className="inspector-section" aria-labelledby="ledger-questions-title">
          <div className="section-heading">
            <span className="eyebrow">Deterministic local answers</span>
            <h3 id="ledger-questions-title"><MessageSquare aria-hidden="true" /> Ledger questions</h3>
          </div>
          <div className="question-buttons">
            <button type="button" onClick={() => answerLedgerQuestion("created")}>Why was it created?</button>
            {stateB && <button type="button" onClick={() => answerLedgerQuestion("diverged")}>How did the branches diverge?</button>}
          </div>
          {ledgerQuestion && ledgerResponse && (
            <div className="ledger-answer" role="status">
              <span className="eyebrow">Ledger-grounded response</span>
              <p>{ledgerResponse}</p>
              <small><HelpCircle aria-hidden="true" /> Derived from recorded simulation events; no external model call.</small>
            </div>
          )}
        </section>
      </div>
    </aside>
  );
};
