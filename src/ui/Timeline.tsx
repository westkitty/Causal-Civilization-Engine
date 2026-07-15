import React from "react";
import {
  ChevronLeft,
  ChevronRight,
  Flag,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "lucide-react";
import type { TimelineMarker } from "../timelines/markers";

export type { TimelineMarker };

interface TimelineProps {
  currentYear: number;
  maxYear: number;
  isPlaying: boolean;
  disabled?: boolean;
  markers?: TimelineMarker[];
  onTogglePlay: () => void;
  onSetYear: (year: number) => void;
  interventionYear?: number;
}

const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));

export const Timeline: React.FC<TimelineProps> = ({
  currentYear,
  maxYear,
  isPlaying,
  disabled = false,
  markers = [],
  onTogglePlay,
  onSetYear,
  interventionYear,
}) => {
  const ticks = Array.from({ length: 9 }, (_, index) => Math.round((maxYear / 8) * index));

  return (
    <footer className="timeline" aria-label="Historical timeline">
      <span className="sr-only">Temporal Frame</span>
      <div className="timeline__controls" role="group" aria-label="Timeline playback controls">
        <button
          className="icon-button"
          type="button"
          onClick={() => onSetYear(0)}
          aria-label="Go to first year"
          title="First year"
          disabled={disabled || currentYear === 0}
        >
          <SkipBack aria-hidden="true" />
        </button>
        <button
          className="icon-button"
          type="button"
          onClick={() => onSetYear(clamp(currentYear - 1, maxYear))}
          aria-label="Previous year"
          title="Previous year"
          disabled={disabled || currentYear === 0}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <button
          className="icon-button icon-button--primary"
          type="button"
          onClick={onTogglePlay}
          aria-label={isPlaying ? "Pause" : "Play"}
          title={isPlaying ? "Pause history" : "Play history"}
          disabled={disabled || (!isPlaying && currentYear === maxYear)}
        >
          {isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </button>
        <button
          className="icon-button"
          type="button"
          onClick={() => onSetYear(clamp(currentYear + 1, maxYear))}
          aria-label="Next year"
          title="Next year"
          disabled={disabled || currentYear === maxYear}
        >
          <ChevronRight aria-hidden="true" />
        </button>
        <button
          className="icon-button"
          type="button"
          onClick={() => onSetYear(maxYear)}
          aria-label="Go to final year"
          title="Final year"
          disabled={disabled || currentYear === maxYear}
        >
          <SkipForward aria-hidden="true" />
        </button>
      </div>

      <div className="timeline__year" aria-live="polite" aria-atomic="true">
        <span className="eyebrow">Historical year</span>
        <output htmlFor="timeline-year">Year {currentYear}</output>
      </div>

      <div className="timeline__track-wrap">
        <div className="timeline__markers" aria-label="Recorded event markers">
          {markers.map((marker) => {
            const rangeText = marker.startYear === marker.endYear
              ? `Year ${marker.startYear}`
              : `Years ${marker.startYear}–${marker.endYear}`;
            const countText = `${marker.count} recorded event${marker.count === 1 ? "" : "s"}`;
            const typesText = marker.types.join(", ");
            const tooltip = `${rangeText} · ${countText} · ${typesText} · jumps to Year ${marker.jumpYear}`;
            return (
              <button
                className="timeline-marker"
                type="button"
                key={`${marker.startYear}-${marker.endYear}`}
                style={{ left: `${(marker.jumpYear / maxYear) * 100}%` }}
                onClick={() => onSetYear(marker.jumpYear)}
                aria-label={tooltip}
                title={tooltip}
                disabled={disabled}
              >
                <span aria-hidden="true" />
              </button>
            );
          })}
          {interventionYear !== undefined && (
            <button
              className="timeline-marker timeline-marker--intervention"
              type="button"
              style={{ left: `${(interventionYear / maxYear) * 100}%` }}
              onClick={() => onSetYear(interventionYear)}
              aria-label={`Counterfactual intervention at Year ${interventionYear}`}
              title={`Counterfactual intervention — Year ${interventionYear}`}
              disabled={disabled}
            >
              <Flag aria-hidden="true" />
            </button>
          )}
        </div>

        <label className="sr-only" htmlFor="timeline-year">Timeline year</label>
        <input
          id="timeline-year"
          className="range-control timeline__range"
          type="range"
          min="0"
          max={maxYear}
          value={currentYear}
          aria-label="Timeline year"
          aria-valuetext={`Year ${currentYear}`}
          onChange={(event) => onSetYear(Number(event.target.value))}
          disabled={disabled}
        />

        <div className="timeline__ticks" aria-hidden="true">
          {ticks.map((year) => <span key={year}>{year}</span>)}
        </div>
      </div>
    </footer>
  );
};
