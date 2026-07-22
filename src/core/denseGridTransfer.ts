import type { WorldState } from "./types";

export interface TransferableWorldState extends Omit<WorldState,
  "elevation" | "moisture" | "temperature" | "flowAccumulation" | "flowDirection" | "soilFertility" | "resources" | "politicalControl"
> {
  elevation: Float64Array;
  moisture: Float64Array;
  temperature: Float64Array;
  flowAccumulation: Float64Array;
  flowDirection: Int16Array;
  soilFertility: Float64Array;
  resources: {
    oreGrade: Float64Array;
    timberStock: Float64Array;
  };
  politicalControl: Record<string, Float64Array>;
}

export function encodeTransferableState(state: WorldState): TransferableWorldState {
  return {
    ...structuredClone({
      ...state,
      elevation: undefined,
      moisture: undefined,
      temperature: undefined,
      flowAccumulation: undefined,
      flowDirection: undefined,
      soilFertility: undefined,
      resources: undefined,
      politicalControl: undefined,
    }),
    elevation: Float64Array.from(state.elevation),
    moisture: Float64Array.from(state.moisture),
    temperature: Float64Array.from(state.temperature),
    flowAccumulation: Float64Array.from(state.flowAccumulation),
    flowDirection: Int16Array.from(state.flowDirection),
    soilFertility: Float64Array.from(state.soilFertility),
    resources: {
      oreGrade: Float64Array.from(state.resources.oreGrade),
      timberStock: Float64Array.from(state.resources.timberStock),
    },
    politicalControl: Object.fromEntries(
      Object.entries(state.politicalControl).map(([id, values]) => [id, Float64Array.from(values)]),
    ),
  } as TransferableWorldState;
}

export function decodeTransferableState(state: TransferableWorldState): WorldState {
  return {
    ...structuredClone({
      ...state,
      elevation: undefined,
      moisture: undefined,
      temperature: undefined,
      flowAccumulation: undefined,
      flowDirection: undefined,
      soilFertility: undefined,
      resources: undefined,
      politicalControl: undefined,
    }),
    elevation: Array.from(state.elevation),
    moisture: Array.from(state.moisture),
    temperature: Array.from(state.temperature),
    flowAccumulation: Array.from(state.flowAccumulation),
    flowDirection: Array.from(state.flowDirection),
    soilFertility: Array.from(state.soilFertility),
    resources: {
      oreGrade: Array.from(state.resources.oreGrade),
      timberStock: Array.from(state.resources.timberStock),
    },
    politicalControl: Object.fromEntries(
      Object.entries(state.politicalControl).map(([id, values]) => [id, Array.from(values)]),
    ),
  } as WorldState;
}

export function transferableBuffers(state: TransferableWorldState): ArrayBuffer[] {
  return [
    state.elevation.buffer,
    state.moisture.buffer,
    state.temperature.buffer,
    state.flowAccumulation.buffer,
    state.flowDirection.buffer,
    state.soilFertility.buffer,
    state.resources.oreGrade.buffer,
    state.resources.timberStock.buffer,
    ...Object.values(state.politicalControl).map(values => values.buffer),
  ];
}
