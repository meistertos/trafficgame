# Phase 1 — Data pack + pure simulation

Spec: §4 (simulation contract), §6 (data pack). Milestone exit: "L1 and deterministic tick/replay checks pass".

## Deliverables

- `game-proto/traffic-levels.json` — pack with `$schema`, `schemaVersion`, shared `rules`, six `levels`.
  Geometry, spawn times, types, signals, deadlines, `requiredCount` transcribed from spec §5 tables.
  `referenceSolution.windows` filled in phases 2–3 (placeholder `[[0, deadline]]`-style stubs initially).
- `game-proto/traffic-levels.schema.json` — JSON Schema (draft 2020-12 subset) for the pack.
- `game-proto/src/constants.js` — `TICK_RATE = 120`, world 1200×800, `MIN_GAP = 12`, vehicle types car 28×14 / bus 52×14.
- `game-proto/src/geometry.js` — lane vectors, point-at-s, vehicle rects, swept-AABB tick collision math.
- `game-proto/src/data.js` — pack parse + structural validation + semantic validation (axis alignment,
  boundary entry/exit, nonzero length, known refs, same-lane signal stopS ordering, stopS in range,
  grouped-signal alignment, event id uniqueness, `requiredCount` == required events, rejection of
  crossings with two uncontrolled streams).
- `game-proto/src/sim.js` — DOM-free simulation:
  - `prepareLevel`, `createState`, `queueCommand`, `step`, `runToEnd`, `windowsToCommands`,
    `serialize`/`deserialize`, `stateHash`.
  - Tick order per spec §4.3: commands → due spawns (epsilon-safe `dueTick = ceil(at*120 - 1e-9)`)
    → admit ≤1/lane if it fits with 12-unit gap to rearmost → move lane-by-lane frontmost-first with
    red-stop and leader clamps (never backward), commitment when front strictly passes `stopS` →
    swept collisions across lanes before exits → remove rear ≥ lane length (count required once) →
    outcome: collision > win > timeout (win allowed on the deadline tick).
  - All signals start red. Deterministic: fixed iteration orders, no randomness, no wall clock.

## Exit criteria

- Pack validates clean; a set of mutated packs is rejected (negative tests in the validation runner).
- L1: replaying `windows.A = [[4.5, 16]]` wins with `requiredCleared = 3`; all-red times out at 16 s.
- Identical command log stepped one tick at a time vs in batches of 7 → identical `stateHash` and outcome.
- `serialize` → `deserialize` mid-run → identical continuation (pause/resume equivalence).
