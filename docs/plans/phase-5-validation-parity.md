# Phase 5 — Validation, parity regression, fairness tolerance

Spec: §7. Milestone exit: "Six-level campaign accepted; report and fixtures updated together".

## Deliverables

- `game-proto/tools/headless-validation.mjs` (node, imports the same `src/sim.js` the game uses):
  1. Replay every `referenceSolution` → win, required exits == target, final-clear tick/time recorded
     (within one tick of the stored report; the report is regenerated together with the pack hash).
  2. All-red → timeout everywhere and `requiredCleared == 0` for required streams. All-green →
     documented outcomes (L1 win; L2–L6 collision, ticks recorded).
  3. Commitment: red cannot stop a committed car; downstream red can.
  4. Queue integrity: no same-lane overlap ever (debug asserts), blocked entries preserve all events.
  5. Counting: rear-exit only, once per vehicle (buses included).
  6. Determinism: identical command logs → identical outcomes/state hashes when stepped at different
     batch sizes; serialize/pause/resume preserves simulation time.
  7. Swept collision correctness: crossing, blocked-crossing, one-tick fast crossing, boundary contact
     non-collision; correct vehicle ids.
  8. Grouped lights affect both lanes; shared crossings stay per-lane (no merged zone).
  9. Negative pack tests: semantic validator rejects mutated packs.
  - Fairness: each reference window boundary perturbed by ±0.10 s and ±0.20 s; win/loss per variant
    recorded in the report. Requirement: base schedule wins and documented margins exist
    (spec: do not require every perturbation to win).
- `game-proto/level-validation.json` — generated report: pack sha256, per-level reference/all-red/
  all-green outcomes with ticks, perturbation matrix, check results, pass/fail.

## Exit criteria

- Runner exits 0 with all checks passing; report committed next to the pack so pack changes invalidate it.
- Human playtest (§7.9) is the tester's pass after this build — all flows reachable without dev tools.
