import React from "react";
import { Play, Pause, RotateCcw } from "lucide-react";

interface TimelineProps {
  currentYear: number;
  maxYear: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSetYear: (year: number) => void;
  interventionYear?: number;
}

export const Timeline: React.FC<TimelineProps> = ({
  currentYear,
  maxYear,
  isPlaying,
  onTogglePlay,
  onSetYear,
  interventionYear,
}) => {
  const steps = [];
  for (let y = 0; y <= maxYear; y += 25) {
    steps.push(y);
  }

  return (
    <div className="absolute bottom-4 left-4 right-4 z-10 bg-slate-900/80 backdrop-blur-md border border-white/10 rounded-2xl p-4 shadow-2xl flex items-center gap-6">
      {/* Playback Controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={onTogglePlay}
          aria-label={isPlaying ? "Pause" : "Play"}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
            isPlaying
              ? "bg-cyan-500 text-slate-950 hover:bg-cyan-400"
              : "bg-white/10 text-white hover:bg-white/20"
          }`}
        >
          {isPlaying ? <Pause size={18} /> : <Play size={18} className="translate-x-[1px]" />}
        </button>
        <button
          onClick={() => onSetYear(0)}
          title="Reset to Year 0"
          aria-label="Reset to Year 0"
          className="w-9 h-9 rounded-full flex items-center justify-center bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition-all"
        >
          <RotateCcw size={16} />
        </button>
      </div>

      {/* Year Readout */}
      <div className="flex flex-col select-none">
        <span className="text-[10px] text-cyan-400 font-semibold tracking-wider uppercase">Temporal Frame</span>
        <span className="text-xl font-bold font-mono text-white">Year {currentYear}</span>
      </div>

      {/* Timeline Slider and Markers */}
      <div className="flex-1 flex flex-col gap-2 relative">
        <div className="relative w-full h-8 flex items-center">
          <input
            type="range"
            min="0"
            max={maxYear}
            value={currentYear}
            aria-label="Timeline year"
            onChange={(e) => onSetYear(Number(e.target.value))}
            className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 z-10"
          />

          {/* Intervention marker if set */}
          {interventionYear !== undefined && (
            <div
              className="absolute w-3 h-3 bg-indigo-500 border border-white rounded-full -translate-x-1/2 cursor-pointer z-20 group"
              style={{ left: `${(interventionYear / maxYear) * 100}%`, top: "calc(50% - 6px)" }}
              title={`Bridge Suppressed at Year ${interventionYear}`}
            >
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-indigo-650 text-white text-[10px] px-2 py-1 rounded shadow-md whitespace-nowrap border border-indigo-400">
                Bridge suppressed in counterfactual timeline (Year {interventionYear})
              </div>
            </div>
          )}
        </div>

        {/* Coarse Year Ticks */}
        <div className="flex justify-between px-1 select-none">
          {steps.map((y) => (
            <span
              key={y}
              onClick={() => onSetYear(y)}
              className={`text-[10px] font-mono cursor-pointer transition-colors ${
                Math.abs(currentYear - y) < 12
                  ? "text-cyan-400 font-bold"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {y}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
