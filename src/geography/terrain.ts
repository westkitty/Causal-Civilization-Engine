import type { WorldState } from "../core/types";
import { murmurHash3 } from "../core/random";
import { CausalLedger } from "../timelines/ledger";

// Simple deterministic noise
function noise2D(x: number, y: number, seed: string): number {
  const key = `${seed}:${Math.floor(x)}:${Math.floor(y)}`;
  return (murmurHash3(key) / 0xffffffff) * 2 - 1; // [-1, 1]
}

function interpolatedNoise2D(x: number, y: number, seed: string): number {
  const xInt = Math.floor(x);
  const xFrac = x - xInt;
  const yInt = Math.floor(y);
  const yFrac = y - yInt;

  const v1 = noise2D(xInt, yInt, seed);
  const v2 = noise2D(xInt + 1, yInt, seed);
  const v3 = noise2D(xInt, yInt + 1, seed);
  const v4 = noise2D(xInt + 1, yInt + 1, seed);

  // Fade curve
  const u = xFrac * xFrac * (3 - 2 * xFrac);
  const v = yFrac * yFrac * (3 - 2 * yFrac);

  const i1 = v1 * (1 - u) + v2 * u;
  const i2 = v3 * (1 - u) + v4 * u;

  return i1 * (1 - v) + i2 * v;
}

function fbm2D(x: number, y: number, seed: string, octaves: number = 4): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1.0;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * interpolatedNoise2D(x * frequency, y * frequency, seed);
    frequency *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

export function generateWorld(seed: string, width: number = 125, height: number = 125): WorldState {
  const size = width * height;
  const state: WorldState = {
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

  const getIdx = (x: number, y: number) => y * width + x;

  // 1. Elevation generation (Mountains on left, coast on right)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = getIdx(x, y);

      // Base slope: high on left, low on right
      const slope = 1.0 - x / width;
      const baseElev = slope * 800; // 0..800

      // Add noise
      const noise = fbm2D(x * 0.05, y * 0.05, seed, 4);
      let elev = baseElev + noise * 150;

      // Restrict mountains and water depths
      if (elev < 0) elev = 5;
      if (elev > 1000) elev = 1000;

      state.elevation[idx] = elev;
    }
  }

  // 2. Hydrology: Flow accumulation and River pathing
  // Let's carve a main river path from left to right that winds slightly.
  // This guarantees a single connected, downhill watershed draining to the ocean.
  const riverY = Math.floor(height / 2);
  const riverCells = new Set<number>();
  
  for (let x = 0; x < width; x++) {
    // winding
    const wind = Math.floor(Math.sin(x * 0.1) * (height * 0.1));
    const ry = Math.min(height - 1, Math.max(0, riverY + wind));
    
    // Carve river elevation slightly so it flows downhill and attracts accumulation
    for (let dy = -1; dy <= 1; dy++) {
      const cy = ry + dy;
      if (cy >= 0 && cy < height) {
        const idx = getIdx(x, cy);
        state.elevation[idx] = Math.min(state.elevation[idx], 250 * (1 - x / width) + 15);
        riverCells.add(idx);
      }
    }
  }

  // Compute flow accumulation and direction approximation
  // Let's set flow direction pointing towards the river channel or towards the coast on the right
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = getIdx(x, y);
      
      // Flow towards ocean on the right (dx=1, dy=0 is direction index)
      // Direction indices: 0 = R, 1 = DR, 2 = D, 3 = DL, 4 = L, 5 = UL, 6 = U, 7 = UR
      if (riverCells.has(idx)) {
        state.flowAccumulation[idx] = 1000 + x * 50; // River has high flow
        state.flowDirection[idx] = 0; // right
      } else {
        const wind = Math.floor(Math.sin(x * 0.1) * (height * 0.1));
        const targetY = riverY + wind;
        
        let dy = 0;
        if (y < targetY) dy = 1;
        else if (y > targetY) dy = -1;

        // map dy/dx to direction
        // standard D8: R(0), DR(1), D(2), DL(3), L(4), UL(5), U(6), UR(7)
        if (dy === 0) state.flowDirection[idx] = 0; // R
        else if (dy === 1) state.flowDirection[idx] = 1; // DR
        else state.flowDirection[idx] = 7; // UR
        
        state.flowAccumulation[idx] = 5 + (1 - Math.abs(y - targetY) / height) * 20;
      }
    }
  }

  // 3. Climate, Soil, and Biomes
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = getIdx(x, y);
      const elev = state.elevation[idx];

      // Temperature: decreases with elevation and latitude (y)
      state.temperature[idx] = 30 - (elev / 1000) * 15 - (y / height) * 10;

      // Moisture: high near river (flowAccumulation > 200) and coast (x > width * 0.8), low in mountain shadow
      let moist = 50 + fbm2D(x * 0.1, y * 0.1, seed + "_moist", 2) * 20;
      if (state.flowAccumulation[idx] > 500) {
        moist += 40;
      }
      if (x > width * 0.8) {
        moist += 20; // Coastal moisture
      }
      if (elev > 600) {
        moist -= 15; // Dry mountain tops
      }
      state.moisture[idx] = Math.max(0, Math.min(100, moist));

      // Soil fertility: high in floodplains (near river) and low on slopes
      state.soilFertility[idx] = Math.max(0, 50 - (elev / 1000) * 20 + (state.flowAccumulation[idx] > 500 ? 30 : 0));

      // Biomes
      const m = state.moisture[idx];

      if (elev > 700) {
        state.biomes[idx] = "mountain";
      } else if (elev < 30) {
        state.biomes[idx] = "ocean";
      } else if (state.flowAccumulation[idx] > 1500) {
        state.biomes[idx] = "wetland";
      } else if (m < 35) {
        state.biomes[idx] = "desert";
      } else if (m > 65) {
        state.biomes[idx] = "forest";
      } else {
        state.biomes[idx] = "grassland";
      }
    }
  }

  // 4. Resources
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = getIdx(x, y);
      const biome = state.biomes[idx];

      // Metal ore: high in mountain uplift structures
      if (biome === "mountain") {
        state.resources.oreGrade[idx] = Math.max(0, fbm2D(x * 0.2, y * 0.2, seed + "_ore") * 50 + 40);
      }

      // Timber: high in forest biomes
      if (biome === "forest") {
        state.resources.timberStock[idx] = Math.max(0, fbm2D(x * 0.15, y * 0.15, seed + "_timber") * 40 + 60);
      }
    }
  }

  return state;
}

export function updateGeography(_state: WorldState, _ledger: CausalLedger, _year: number): void {
  // Limited dynamic geographic changes, like slight timber recovery or mining depletion.
  // Typically very rare updates.
}
