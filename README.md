# Causal Civilization Engine

An explorable historical simulation in which geography, infrastructure, settlement, culture, wealth, and political control emerge from interacting systems. The primary feature of the engine is support for counterfactual resimulation, allowing users to suppress events (e.g. bridge construction) and trace the resulting chronological divergence.

## Tech Stack
- **Frontend**: React 19, TypeScript, Tailwind CSS / Vanilla CSS, Lucide React
- **Rendering**: Three.js WebGL (low-poly custom render loops)
- **Simulation**: Asynchronous ES-module Web Worker thread with synchronous fallback for test runs
- **Testing**: Vitest (Node for kernel logic, JSDOM for UI component mount checks)

## Phase Checklist & Diagnostics
- Hashing and exact Float64 DataView bitwise hashing ensures 100% repeatability.
- Double-entry trade cost accounting with transport drag destroyed.
- Real-time Web Worker progress indicators.
- Causal ancestry path tracing inside the interactive Inspector.

## Verification & Execution

### Run Development Server
```bash
npm run dev
```

### Run All Unit and UI Tests
```bash
npm run test
```

### Build Production Bundle
```bash
npm run build
```

## Repository completion rule

Every project-work turn that changes repository files must finish by staging the intended changes, running applicable validation, committing with a descriptive message, pushing the active branch, and verifying that the local HEAD SHA matches the remote branch SHA. Read-only sessions do not create empty commits.
