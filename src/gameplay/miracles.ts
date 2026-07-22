import type { WorldState } from "../core/types";
import type {
  DivineMiracleAction,
  DivineMiracleKind,
  MiracleDisposition,
} from "../timelines/miracleEffects";

export const STARTING_DIVINITY = 100;

export interface AvailableMiracle {
  kind: DivineMiracleKind;
  label: string;
  invocation: string;
  description: string;
  cost: number;
  disposition: MiracleDisposition;
  scope: "target" | "world";
}

const MIRACLES: Record<DivineMiracleKind, Omit<AvailableMiracle, "kind">> = {
  rain_of_plenty: {
    label: "Rain of Plenty",
    invocation: "Let the sealed sky open.",
    description: "Soak a settlement's region, restore soil and forests, and force food and water to abundance.",
    cost: 12,
    disposition: "blessing",
    scope: "target",
  },
  healing_light: {
    label: "Healing Light",
    invocation: "No wound shall keep what I have named.",
    description: "Erase disease and return part of the settlement's lost population through divine restoration.",
    cost: 14,
    disposition: "blessing",
    scope: "target",
  },
  divine_sanctuary: {
    label: "Raise Divine Sanctuary",
    invocation: "Here, suffering ends at the threshold.",
    description: "Create a permanent holy wonder and transform one settlement into a wealthy, healthy refuge.",
    cost: 22,
    disposition: "wonder",
    scope: "target",
  },
  golden_age: {
    label: "Declare a Golden Age",
    invocation: "Let this crown carry more than weight.",
    description: "Perfect a government's legitimacy, enrich its treasury, and accelerate nearby settlements.",
    cost: 25,
    disposition: "wonder",
    scope: "target",
  },
  found_star_city: {
    label: "Call Down a Star City",
    invocation: "Where the star touches earth, build.",
    description: "Found an entirely new prosperous city near the selected settlement and raise a celestial landmark.",
    cost: 30,
    disposition: "wonder",
    scope: "target",
  },
  resurrect_city: {
    label: "Resurrect the Fallen City",
    invocation: "The bells remember those who left.",
    description: "Return an abandoned settlement to life with people, wealth, health, and a resurrection wonder.",
    cost: 28,
    disposition: "wonder",
    scope: "target",
  },
  divine_highway: {
    label: "Lay the Divine Highway",
    invocation: "Distance is a law. I repeal it.",
    description: "Transform a route into an immense, nearly instantaneous transport artery and restore its bridges.",
    cost: 20,
    disposition: "wonder",
    scope: "target",
  },
  world_bloom: {
    label: "World Bloom",
    invocation: "Let every root remember spring.",
    description: "Heal every active settlement and renew moisture, fertility, and forests across the entire world.",
    cost: 55,
    disposition: "blessing",
    scope: "world",
  },
  great_deluge: {
    label: "The Great Deluge",
    invocation: "The rivers have been patient long enough.",
    description: "Drown a settlement's region, kill citizens, damage wealth and capacity, and permanently scar the land.",
    cost: 18,
    disposition: "wrath",
    scope: "target",
  },
  seven_year_drought: {
    label: "Seven-Year Drought",
    invocation: "Not one drop until the lesson is learned.",
    description: "Strip a region of water and fertility, collapse carrying capacity, and drive hunger and death.",
    cost: 16,
    disposition: "wrath",
    scope: "target",
  },
  plague_wind: {
    label: "The Plague Wind",
    invocation: "Let every closed door hear the same breath.",
    description: "Inflict catastrophic disease, population loss, economic collapse, and ruined foundations.",
    cost: 18,
    disposition: "wrath",
    scope: "target",
  },
  pillar_of_fire: {
    label: "Pillar of Fire",
    invocation: "Become ash beneath my attention.",
    description: "Burn a settlement and its forests, destroy population and wealth, and leave a permanent burn layer.",
    cost: 20,
    disposition: "wrath",
    scope: "target",
  },
  earthshaker: {
    label: "The Earthshaker",
    invocation: "The ground itself will testify.",
    description: "Shatter a city, nearby roads, and bridges while leaving ruined foundations across the region.",
    cost: 22,
    disposition: "wrath",
    scope: "target",
  },
  falling_star: {
    label: "Call the Falling Star",
    invocation: "I point. The heavens answer.",
    description: "Nearly erase a settlement, excavate a crater, ignite the region, and expose strange new ore.",
    cost: 35,
    disposition: "apocalypse",
    scope: "target",
  },
  age_of_ruin: {
    label: "Begin the Age of Ruin",
    invocation: "History has had its chance.",
    description: "Collapse civilization worldwide: populations, governments, roads, bridges, wealth, and fertile land.",
    cost: 80,
    disposition: "apocalypse",
    scope: "world",
  },
};

function available(...kinds: DivineMiracleKind[]): AvailableMiracle[] {
  return kinds.map((kind) => ({ kind, ...MIRACLES[kind] }));
}

export function worldMiracles(): AvailableMiracle[] {
  return available("world_bloom", "age_of_ruin");
}

export function miraclesForEntity(
  state: WorldState | undefined,
  entityId: string | null,
): AvailableMiracle[] {
  if (!state || !entityId) return [];

  const settlement = state.settlements[entityId];
  if (settlement) {
    if (settlement.abandoned) return available("resurrect_city");
    return available(
      "rain_of_plenty",
      "healing_light",
      "divine_sanctuary",
      "found_star_city",
      "great_deluge",
      "seven_year_drought",
      "plague_wind",
      "pillar_of_fire",
      "earthshaker",
      "falling_star",
    );
  }

  if (state.governments[entityId]) return available("golden_age");
  if (state.routes[entityId]) return available("divine_highway");
  return [];
}

export function makeQueuedMiracle(
  kind: DivineMiracleKind,
  targetId: string | null,
  sequence: number,
): DivineMiracleAction {
  return {
    miracleId: `miracle_${sequence}_${kind}_${targetId ?? "world"}`,
    kind,
    targetId,
    cost: MIRACLES[kind].cost,
  };
}

export function miracleDefinition(kind: DivineMiracleKind): AvailableMiracle {
  return { kind, ...MIRACLES[kind] };
}
