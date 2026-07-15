import React from "react";
import { Shield, Droplets, Mountain, Trees, GitBranch, Eye } from "lucide-react";

interface DivergenceControlsProps {
  comparisonMode: "none" | "swipe" | "ghost" | "heat";
  onChangeComparisonMode: (mode: "none" | "swipe" | "ghost" | "heat") => void;
  activeOverlay: "none" | "politics" | "moisture" | "ore" | "timber";
  onChangeOverlay: (overlay: "none" | "politics" | "moisture" | "ore" | "timber") => void;
  hasSecondBranch: boolean;
  swipePosition: number;
  onChangeSwipePosition: (pos: number) => void;
}

export const DivergenceControls: React.FC<DivergenceControlsProps> = ({
  comparisonMode,
  onChangeComparisonMode,
  activeOverlay,
  onChangeOverlay,
  hasSecondBranch,
  swipePosition,
  onChangeSwipePosition,
}) => {
  return (
    <div className="absolute top-4 left-4 z-10 flex flex-col gap-4 max-w-sm">
      {/* Overlay Selection Panel */}
      <div className="bg-slate-900/80 backdrop-blur-md border border-white/10 rounded-xl p-4 shadow-xl">
        <h3 className="text-sm font-semibold text-cyan-400 mb-3 flex items-center gap-2">
          <Eye size={16} /> Geographic Overlays
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onChangeOverlay("none")}
            className={`px-3 py-2 text-xs font-medium rounded-lg border transition-all ${
              activeOverlay === "none"
                ? "bg-cyan-500/20 border-cyan-400 text-cyan-200"
                : "border-white/10 hover:border-white/20 text-slate-300"
            }`}
          >
            None (Biome)
          </button>
          <button
            onClick={() => onChangeOverlay("politics")}
            className={`px-3 py-2 text-xs font-medium rounded-lg border flex items-center justify-center gap-1.5 transition-all ${
              activeOverlay === "politics"
                ? "bg-cyan-500/20 border-cyan-400 text-cyan-200"
                : "border-white/10 hover:border-white/20 text-slate-300"
            }`}
          >
            <Shield size={12} /> Political
          </button>
          <button
            onClick={() => onChangeOverlay("moisture")}
            className={`px-3 py-2 text-xs font-medium rounded-lg border flex items-center justify-center gap-1.5 transition-all ${
              activeOverlay === "moisture"
                ? "bg-cyan-500/20 border-cyan-400 text-cyan-200"
                : "border-white/10 hover:border-white/20 text-slate-300"
            }`}
          >
            <Droplets size={12} /> Moisture
          </button>
          <button
            onClick={() => onChangeOverlay("ore")}
            className={`px-3 py-2 text-xs font-medium rounded-lg border flex items-center justify-center gap-1.5 transition-all ${
              activeOverlay === "ore"
                ? "bg-cyan-500/20 border-cyan-400 text-cyan-200"
                : "border-white/10 hover:border-white/20 text-slate-300"
            }`}
          >
            <Mountain size={12} /> Metal Ore
          </button>
          <button
            onClick={() => onChangeOverlay("timber")}
            className={`px-3 py-2 text-xs font-medium rounded-lg border flex items-center justify-center gap-1.5 col-span-2 transition-all ${
              activeOverlay === "timber"
                ? "bg-cyan-500/20 border-cyan-400 text-cyan-200"
                : "border-white/10 hover:border-white/20 text-slate-300"
            }`}
          >
            <Trees size={12} /> Timber Reserves
          </button>
        </div>
      </div>

      {/* Counterfactual Timeline Comparison Panel */}
      {hasSecondBranch && (
        <div className="bg-slate-900/80 backdrop-blur-md border border-white/10 rounded-xl p-4 shadow-xl">
          <h3 className="text-sm font-semibold text-indigo-400 mb-3 flex items-center gap-2">
            <GitBranch size={16} /> Timeline Comparison
          </h3>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onChangeComparisonMode("none")}
                className={`px-3 py-2 text-xs font-medium rounded-lg border transition-all ${
                  comparisonMode === "none"
                    ? "bg-indigo-500/20 border-indigo-400 text-indigo-200"
                    : "border-white/10 hover:border-white/20 text-slate-300"
                }`}
              >
                Show Current
              </button>
              <button
                onClick={() => onChangeComparisonMode("swipe")}
                className={`px-3 py-2 text-xs font-medium rounded-lg border transition-all ${
                  comparisonMode === "swipe"
                    ? "bg-indigo-500/20 border-indigo-400 text-indigo-200"
                    : "border-white/10 hover:border-white/20 text-slate-300"
                }`}
              >
                Split Screen
              </button>
            </div>
            
            {comparisonMode === "swipe" && (
              <div className="flex flex-col gap-1.5 mt-1">
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>Parent History</span>
                  <span>Branch History</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={swipePosition}
                  onChange={(e) => onChangeSwipePosition(Number(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
