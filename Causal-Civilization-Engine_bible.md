# Causal Civilization Engine Bible

## 2026-07-22 — Playable Overwatching God Mode

### Identity

The playable experience is a deterministic causal civilization strategy game in which the player exists above the simulation as an overwatching god. The player can influence institutions through bounded mortal interventions and separately invoke miracles that directly alter the world.

### Resource contract

- **Influence** pays for ordinary political, economic, demographic, ecological, and infrastructure interventions.
- **Divinity** pays for miracles and is tracked independently from Influence.
- Ordinary interventions and miracles may be combined into one causal decree at a chosen insertion year.
- Every real intervention must alter authoritative `WorldState`, produce ledger evidence, and propagate through the normal annual simulation systems.
- Decorative controls or miracle effects that do not change simulation state are not acceptable.

### Miracle contract

Implemented miracle families:

- blessings: Rain of Plenty, Healing Light, World Bloom;
- wonders: Divine Sanctuary, Golden Age, Star City, City Resurrection, Divine Highway;
- wrath: Great Deluge, Seven-Year Drought, Plague Wind, Pillar of Fire, Earthshaker;
- apocalypse: Falling Star, Age of Ruin.

Miracles can modify settlements, cohorts, governments, routes, bridges, geography arrays, resources, landmarks, and permanent scars. World miracles may target the entire simulation without a selected entity.

### Presentation contract

Miracles must feel categorically different from policy actions:

- separate Divinity display;
- invocation text spoken over the map;
- distinct blessing, wonder, wrath, and apocalypse visual treatments;
- miracle entries recorded in the Book of Causation;
- map-scale omen feedback when a miracle is queued;
- reduced-motion behavior must remain supported.

### Controls

- left mouse drag rotates the camera;
- right or middle mouse drag pans;
- mouse wheel zooms;
- map entities can be selected as intervention and miracle targets.

### Validation

Required validation for changes to this mode:

- lint;
- unit and JSDOM tests;
- TypeScript/Vite production build;
- real-browser Playwright acceptance suite;
- confirmation that miracles create `divine_miracle` ledger events and observable state deltas.

### Current implementation head

Implementation commit before this documentation entry: `f3f0ce45b077b34a1067d91b1e4c340aac436e67`.

Full CI and packaging were queued at the time of this entry. Do not describe the miracle layer as fully verified until those workflows complete successfully.
