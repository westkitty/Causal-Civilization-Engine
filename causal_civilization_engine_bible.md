# Causal Civilization Engine Bible

Append-only project continuity ledger. Do not delete or rewrite prior entries; append corrections and new evidence.

## 2026-07-22 — Adversarial 25-way upgrade pass

### Objective

Adversarially review the current repository without repeating the extensive closed findings in `docs/FINAL_ADVERSARIAL_AUDIT.md`, implement the highest-value bounded improvement group, and record 25 genuinely new upgrade paths.

### Capability and authorization

- Repository read/write: available through connected GitHub API.
- Shell: available, but repository clone blocked by DNS failure (`Could not resolve host: github.com`).
- Browser/runtime execution: unavailable for this source branch.
- GitHub identity and branch writes: available as `westkitty`.
- Authorized action used: created and committed to task branch `upgrade/adversarial-25-2026-07-22`.
- Not performed: default-branch writes, merge, pull request, release, deployment, dependency changes, migration, destructive operation.

### Ground truth and project classification

- Classification: React/Three.js simulation workbench with a deterministic-tested JavaScript simulation kernel, causal ledger, Web Worker execution, counterfactual branch replay, Vitest, and Playwright.
- Existing audit evidence is unusually extensive and already closes prior worker, transport, causal-correlation, politics, rendering-lifecycle, accessibility, and browser-acceptance defects.
- Dominant documented unresolved architecture cost: full per-year world-state caching, large Worker payloads, and high memory use.
- Newly selected bounded seam: causal-ledger query behavior and entity-delta completeness.

### Changes implemented

1. `src/timelines/ledger.ts`
   - added cached deterministic chronological ordering;
   - added event-ID tie-break ordering;
   - invalidates ordering cache on append/replacement;
   - replaced ancestry `shift()` loop with cursor traversal;
   - reuses ordered events for entity history;
   - uses `structuredClone` for ledger clone data;
   - records changed, added, and deleted fields in `diffEntity`;
   - narrows `unknown` inputs before object access.

2. `src/__tests__/ledgerHardening.test.ts`
   - deterministic ordering test;
   - append/replacement cache invalidation test;
   - ancestry traversal test;
   - clone isolation test;
   - changed/added/deleted delta test.

3. `docs/ADVERSARIAL_UPGRADE_2026-07-22.md`
   - 25 ranked improvements;
   - adversarial objections;
   - recommended next frozen scope;
   - explicit validation limitations.

### Commits

- `4858469e9e87033ca4b67a6c036bb3fc5c8f3bc3` — `perf: harden causal ledger ordering and diffs`
- `442a0374b955036d870433f397283901c4dfdda6` — `test: cover ledger cache ancestry and complete diffs`
- `6dd8797aec8da7fedc43a0bd4dfcfcdefa106bb5` — `docs: record 25-way adversarial upgrade program`

### Validation

- Source inspection: completed.
- GitHub branch writes: confirmed.
- Combined commit statuses at test commit: none reported.
- PR-triggered workflow runs at test commit: none reported.
- Local lint/test/build/E2E: blocked because repository clone failed in the execution environment.
- Final proof state: **implemented and source-reviewed; runtime verification blocked**.

### Fragile areas and residual risks

- `events` remains externally readable as a mutable record for compatibility. In-place mutation after `getAllEvents()` can bypass cache invalidation. The next ledger pass should replace direct mutable access with explicit import/export and immutable event records.
- `clone(newBranchId)` changes the ledger identity but preserves copied events' existing `branchId` values, matching prior behavior. Decide explicitly whether cloned prefix events retain provenance or are normalized to the new branch before changing it.
- `diffEntity` still uses JSON string comparison for field values. This is acceptable for current plain event data but is not a canonical comparator for all JavaScript values.
- The new tests have not executed in this environment and must pass before merge.

### Next bounded action

Implement and benchmark static-world separation plus checkpoint/delta year storage, then remove the full `parentCachedStates` branch Worker payload while preserving current tested-runtime hashes and year-materialization equality.
