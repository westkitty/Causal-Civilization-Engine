import type { WorldState } from "./types";

export function createInitialState(
  seed: string,
  width: number = 125,
  height: number = 125
): WorldState {
  const size = width * height;
  return {
    seed,
    year: 0,
    mapWidth: width,
    mapHeight: height,
    elevation: new Array(size).fill(0),
    moisture: new Array(size).fill(0),
    temperature: new Array(size).fill(0),
    flowAccumulation: new Array(size).fill(0),
    flowDirection: new Array(size).fill(0),
    soilFertility: new Array(size).fill(0),
    biomes: new Array(size).fill("desert"),
    resources: {
      oreGrade: new Array(size).fill(0),
      timberStock: new Array(size).fill(0),
    },
    politicalControl: {},
    settlements: {},
    routes: {},
    bridges: {},
    governments: {},
    cohorts: {},
    landmarks: {},
    scars: {},
  };
}

export function cloneState(state: WorldState): WorldState {
  return structuredClone(state);
}
