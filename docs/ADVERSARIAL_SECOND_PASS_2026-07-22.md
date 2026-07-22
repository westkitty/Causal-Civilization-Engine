# Second Adversarial Upgrade — 25 New Improvements

Branch: `upgrade/adversarial-new-25-2026-07-22`

This pass does not repeat the previous memory, Worker-payload, ledger-index, CLI, branch-tree, or browser-compatibility recommendations. It attacks the newly added archive/artifact/workbench layer itself.

## Adversarial verdict

The previous upgrade added valuable architecture, but several claims were ahead of their proof:

- artifact verification checked stored hashes without always recomputing the replayed final state;
- archive deserialization trusted structural shape and patch paths;
- CLI branching reconstructed a snapshot with the entire future parent ledger and used the legacy full-cache branch runner;
- message-only Worker cancellation could not interrupt a synchronous simulation loop;
- divergence analysis examined branch-side changes but did not count baseline events that disappeared;
- intervention and branch identifiers lacked strong domain validation.

Those are correctness and trust-boundary defects, not polish preferences.

## 25 implemented improvements

1. **Archive version validation at every deserialize boundary.**
2. **Positive integer map-dimension validation.**
3. **Static grid length validation against map cell count.**
4. **Checkpoint/delta continuity validation for every archived year.**
5. **Exactly-one frame representation enforcement per non-initial year.**
6. **Year-hash presence enforcement across the full archive range.**
7. **Out-of-range checkpoint and delta rejection.**
8. **Prototype-pollution path rejection (`__proto__`, `prototype`, `constructor`).**
9. **Root-deletion patch rejection and set-value validation.**
10. **Replay hash verification whenever a year is materialized.**
11. **Strict sequential archive-builder recording with no duplicate initial-year writes.**
12. **Archive-builder validation for branch IDs and checkpoint intervals.**
13. **Artifact engine, schema, timestamp, branch, seed, and year coherence validation.**
14. **Ledger key, event branch identity, and event chronology validation inside artifacts.**
15. **Actual final-state replay verification instead of metadata-only verification.**
16. **Friendly invalid-JSON artifact errors rather than raw parser failures.**
17. **CLI integer/range validation for years and checkpoint intervals.**
18. **CLI overwrite protection with explicit `--force`.**
19. **CLI branching migrated to the compact archive runner, removing future-ledger snapshot contamination.**
20. **CLI intervention validation plus explicit warning override.**
21. **Archive runner parent-branch, minimum-year, maximum-year, and end-year boundaries.**
22. **Real interruptible Worker cancellation through optional shared atomic flags.**
23. **Cancellation registry cleanup after completion, failure, or cancellation.**
24. **Safer branch-tree/intervention identity validation and deterministic ancestry/list ordering.**
25. **Symmetric divergence accounting for added, removed, and modified events with verified parent-link counting.**

## Tests added

`src/__tests__/adversarialSecondPass.test.ts` covers:

- missing archive frames;
- unsafe patch paths;
- replay tampering;
- ledger identity drift;
- minimum-year branch duplication;
- removed-event divergence;
- atomic cancellation flags.

## Residual risks

- Integrity hashes establish internal consistency, not authorship or authenticity. A future signed-artifact format would require an explicit key-management decision.
- `SharedArrayBuffer` cancellation requires platform support and appropriate browser isolation headers; Worker termination remains the universal fallback.
- The visible React workbench still uses the legacy state-record protocol. This pass hardens the compact path but does not claim that UI migration is complete.
- Runtime validation remains mandatory before merge. Source review cannot prove TypeScript, browser, or simulation performance behavior.

## Required validation

```bash
npm ci
npm run lint
npm test
npm run build
npm run budget
npm run test:e2e
npm run test:e2e:cross-browser
npm run cli -- simulate --seed bridge-emergence-001 --years 10 --output /tmp/cce-second-pass.json
npm run cli -- verify --input /tmp/cce-second-pass.json
```

## Proof state

`implemented and source-reviewed; runtime verification blocked`
