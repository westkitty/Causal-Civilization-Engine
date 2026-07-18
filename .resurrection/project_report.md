# Project Resurrection Report: Causal Civilization Engine

## Identity
- Name: Causal Civilization Engine
- Path: /Users/andrew/Causal Civilization Engine
- Project type: vite_app
- Confidence: 0.75
- Inferred purpose: Purpose could not be inferred confidently from filesystem signals.
- Evidence:
  - Found package.json
  - Found vite.config.ts
  - Found playwright.config.ts
  - Found index.html

## Git State
- Summary: Repo root: /Users/andrew/Causal Civilization Engine | Branch: main | Status: dirty | Remote: git@github.com:westkitty/Causal-Civilization-Engine.git
- Latest commit: be714399dff2c4e6ab11ec711e918386e6f73c88 fix: scope camera shortcuts to the map
- Tracked modified count: 0
- Untracked count: 1
- Staged count: 0

## Commands Detected
- [build] npm run build (package.json:scripts.build)
- [run/dev] npm run dev (package.json:scripts.dev)
- [unknown] npm run lint (package.json:scripts.lint)
- [run/dev] npm run preview (package.json:scripts.preview)
- [test] npm run test (package.json:scripts.test)
- [test] npm run test:e2e (package.json:scripts.test:e2e)
- [run/dev] npm run dev (vite.config.*)
- [build] npm run build (vite.config.*)
- [test] npx playwright test (playwright.config.*)

## Fragile Files
- package-lock.json
- package.json
- playwright.config.ts
- README.md
- vite.config.ts

## Duplicate Or Stale Candidates
- None detected.

## Secret-Risk Findings
No secret-risk matches detected.

## Recommended Next Actions
1. Inspect the current uncommitted Git changes before making new edits.
2. Back up or review fragile configuration files before any risky changes.
3. Validate the project with the hinted test command: npm run test
4. Validate the project with the hinted run/dev command: npm run dev
5. Validate the project with the hinted build command: npm run build

## Scan Metadata
- Timestamp: 2026-07-17T23:40:00+00:00
- Scanner version: 1.1.0
