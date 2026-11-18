# Phase 2 — Collision, ambient traffic, following, downstream signals

Spec: §4.2 commitment, §4.4 collision/queue behavior. Milestone exit: "L2–L4 references reproduce; commitment and queue tests pass".

## Deliverables

- `game-proto/tools/author-references.mjs` — deterministic lookahead autopilot that imports the real
  `sim.js`, derives winning green windows per level, and writes them into `referenceSolution.windows`.
  Windows are then re-verified by pure window replay (spec §6: tick is green when `tick/120` lies in a
  half-open window, epsilon-safe conversion).
- Reference windows for L2, L3, L4.
- Engine checks (asserted by `tools/headless-validation.mjs`):
  - Switching a signal red cannot stop an already-committed vehicle (front strictly past `stopS`);
    a downstream red on the same lane does stop it.
  - Same-lane queues never overlap (debug assertion every tick, all levels, all runs).
  - Blocked entry preserves every scheduled vehicle (incl. buses): all-red run ends with per-lane
    queue lengths equal to scheduled counts; nothing discarded.
  - Swept collision detects: crossing collision (L2 all-green, correct vehicle ids/lanes), a
    blocked-crossing collision (queued cars spilling into a crossing hit by ambient traffic), and a
    synthetic fast crossing that endpoint-only sampling would miss.
  - Strict interior overlap collides; exact boundary contact does not.

## Exit criteria

- L2–L4 reference replays win with `requiredCleared == requiredCount`.
- All-red times out on L1–L4; all-green: L1 wins, L2–L4 collide.
- All commitment/queue/swept assertions above pass.
