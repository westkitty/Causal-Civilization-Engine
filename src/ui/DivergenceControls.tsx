import React, { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Droplets,
  Eye,
  GitCompareArrows,
  LandPlot,
  Map,
  Mountain,
  Shield,
  Trees,
} from "lucide-react";

export type OverlayMode = "none" | "politics" | "moisture" | "ore" | "timber";
export type ComparisonMode = "none" | "swipe" | "ghost" | "heat";

interface GovernmentOption {
  id: string;
  name: string;
}

interface DivergenceControlsProps {
  comparisonMode: ComparisonMode;
  onChangeComparisonMode: (mode: ComparisonMode) => void;
  activeOverlay: OverlayMode;
  onChangeOverlay: (overlay: OverlayMode) => void;
  hasSecondBranch: boolean;
  swipePosition: number;
  onChangeSwipePosition: (position: number) => void;
  governments: GovernmentOption[];
  onSelectEntity: (id: string) => void;
  disabled?: boolean;
}

const overlays: Array<{
  id: OverlayMode;
  label: string;
  help: string;
  icon: LucideIcon;
}> = [
  { id: "none", label: "Terrain", help: "Biome and elevation colors", icon: Map },
  { id: "politics", label: "Political", help: "Strongest government control by cell", icon: Shield },
  { id: "moisture", label: "Moisture", help: "Relative ground moisture", icon: Droplets },
  { id: "ore", label: "Metal ore", help: "Cells with meaningful ore grade", icon: Mountain },
  { id: "timber", label: "Timber", help: "Standing timber reserves", icon: Trees },
];

function OverlayLegend({
  activeOverlay,
  governments,
  hasSecondBranch,
  onSelectEntity,
}: Pick<DivergenceControlsProps, "activeOverlay" | "governments" | "hasSecondBranch" | "onSelectEntity">) {
  const politicalEntries = [
    { id: "neutral", name: "Neutral / contested", swatch: "legend-swatch--neutral" },
    { id: governments[0]?.id ?? "gov_a", name: governments[0]?.name ?? "Government A", swatch: "legend-swatch--government-a" },
    { id: governments[1]?.id ?? "gov_b", name: governments[1]?.name ?? "Government B", swatch: "legend-swatch--government-b" },
  ];

  const entries = activeOverlay === "politics"
    ? politicalEntries
    : activeOverlay === "moisture"
      ? [
          { id: "dry", name: "Drier ground", swatch: "legend-swatch--dry" },
          { id: "wet", name: "Wetter ground", swatch: "legend-swatch--wet" },
        ]
      : activeOverlay === "ore"
        ? [
            { id: "low-ore", name: "Low / none", swatch: "legend-swatch--neutral" },
            { id: "ore", name: "Higher ore grade", swatch: "legend-swatch--ore" },
          ]
        : activeOverlay === "timber"
          ? [
              { id: "low-timber", name: "Low / cleared", swatch: "legend-swatch--neutral" },
              { id: "timber", name: "Higher timber stock", swatch: "legend-swatch--timber" },
            ]
          : [
              { id: "water", name: "Water", swatch: "legend-swatch--water" },
              { id: "lowland", name: "Lowland", swatch: "legend-swatch--lowland" },
              { id: "forest", name: "Forest", swatch: "legend-swatch--forest" },
              { id: "highland", name: "Highland", swatch: "legend-swatch--highland" },
            ];

  return (
    <section className="map-legend" aria-live="polite" aria-label={`${activeOverlay} map legend`}>
      <div className="map-legend__heading">
        <span>Legend</span>
        <strong>{overlays.find((overlay) => overlay.id === activeOverlay)?.label}</strong>
      </div>
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>
            {activeOverlay === "politics" && entry.id !== "neutral" ? (
              <button type="button" className="legend-entry-button" onClick={() => onSelectEntity(entry.id)}>
                <span className={`legend-swatch ${entry.swatch}`} aria-hidden="true" />
                <span>{entry.name}</span>
              </button>
            ) : (
              <>
                <span className={`legend-swatch ${entry.swatch}`} aria-hidden="true" />
                <span>{entry.name}</span>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="map-legend__infrastructure" aria-label="Infrastructure states">
        <span><i className="state-key state-key--active" aria-hidden="true" />Active</span>
        <span><i className="state-key state-key--ruined" aria-hidden="true" />Ruined</span>
        {hasSecondBranch && <span><i className="state-key state-key--suppressed" aria-hidden="true" />Suppressed</span>}
      </div>
    </section>
  );
}

export const DivergenceControls: React.FC<DivergenceControlsProps> = ({
  comparisonMode,
  onChangeComparisonMode,
  activeOverlay,
  onChangeOverlay,
  hasSecondBranch,
  swipePosition,
  onChangeSwipePosition,
  governments,
  onSelectEntity,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);

  return (
    <aside className={`map-controls ${open ? "map-controls--open" : ""}`} aria-label="Map controls">
      <button
        type="button"
        className="map-controls__toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="map-control-panel"
      >
        <LandPlot aria-hidden="true" />
        Map controls
      </button>

      <div id="map-control-panel" className="map-controls__panel">
        <div className="control-section__heading">
          <div>
            <span className="eyebrow">Active overlay</span>
            <h2>{overlays.find((overlay) => overlay.id === activeOverlay)?.label}</h2>
          </div>
          <Eye aria-hidden="true" />
        </div>

        <div className="overlay-grid" role="group" aria-label="Map overlay">
          {overlays.map(({ id, label, help, icon: Icon }) => (
            <button
              type="button"
              key={id}
              className={`overlay-button ${activeOverlay === id ? "is-active" : ""}`}
              aria-pressed={activeOverlay === id}
              title={help}
              onClick={() => onChangeOverlay(id)}
              disabled={disabled}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <OverlayLegend
          activeOverlay={activeOverlay}
          governments={governments}
          hasSecondBranch={hasSecondBranch}
          onSelectEntity={onSelectEntity}
        />

        {hasSecondBranch && (
          <section className="comparison-controls" aria-label="Timeline comparison controls">
            <div className="control-section__heading control-section__heading--compact">
              <div>
                <span className="eyebrow">Ready</span>
                <h2>Timeline comparison</h2>
              </div>
              <GitCompareArrows aria-hidden="true" />
            </div>
            <div className="segmented-control" role="group" aria-label="Comparison view">
              <button
                type="button"
                className={comparisonMode === "none" ? "is-active" : ""}
                aria-pressed={comparisonMode === "none"}
                onClick={() => onChangeComparisonMode("none")}
              >
                Baseline only
              </button>
              <button
                type="button"
                className={comparisonMode === "swipe" ? "is-active" : ""}
                aria-label="Split Screen"
                aria-pressed={comparisonMode === "swipe"}
                onClick={() => onChangeComparisonMode("swipe")}
              >
                Compare split
              </button>
            </div>
            {comparisonMode === "swipe" && (
              <label className="comparison-slider">
                <span>
                  <b>Baseline</b>
                  <output>{swipePosition}%</output>
                  <b>Counterfactual</b>
                </span>
                <input
                  className="range-control range-control--branch"
                  type="range"
                  min="0"
                  max="100"
                  value={swipePosition}
                  aria-label="Comparison divider"
                  aria-valuetext={`${swipePosition}% baseline, ${100 - swipePosition}% counterfactual`}
                  onChange={(event) => onChangeSwipePosition(Number(event.target.value))}
                />
              </label>
            )}
          </section>
        )}
      </div>
    </aside>
  );
};
