import { generateWorld } from "../src/geography/terrain";
import { findShortestPath } from "../src/simulation/transport";

const state = generateWorld("branch-divergence-seed", 125, 125);
const start = 40 * 125 + 45;
const end = 60 * 125 + 45;

const path = findShortestPath(state, start, end, true);
console.log("Path coords, elevation, flowAccumulation:");
for (const idx of path) {
  const x = idx % 125;
  const y = Math.floor(idx / 125);
  const elev = state.elevation[idx];
  const flow = state.flowAccumulation[idx];
  console.log(`x:${x}, y:${y}, idx:${idx}, elev:${elev.toFixed(1)}, flow:${flow.toFixed(1)}`);
}
