# Project state — Mind the Gap (traffic signal puzzle)

_As of 2026-11-18 · commit `ca3e54b` ("first version")_

## Summary

| Area | State |
|---|---|
| Simulation engine (`game-proto/src`) | Complete for spec v1.1. Deterministic, headless-tested. |
| Level pack (`game-proto/traffic-levels.json`) | 7 levels, all validated. Each has a reference solution that wins. |
| Reference front end (`game-proto/`) | Canvas 2D, playable, feature complete per spec. |
| Shipped front end (`game/`) | Phaser 4. Builds cleanly but **has not been playtested in a browser yet**. |
| Headless validation | **60/60 pass**, matches the committed `level-validation.json`. |
| Level editor | Spec only (`docs/specs/level-creation-tool-spec.md` v1.1), not started. |

## Repository layout

```
docs/
  specs/traffic-prototype-spec.md      game spec, v1.1
  specs/level-creation-tool-spec.md    editor spec, v1.1
  plans/00-overview.md                 phase overview (phases 1–7)
  plans/phase-1 … phase-6-*.md         per-phase plans
  state/project-state.md               this file
game-proto/
  src/            engine (sim, data, geometry, constants) + Canvas front end (render, ui, input, audio, main)
  tools/          headless-validation.mjs, author-references.mjs
  traffic-levels.json / .schema.json   level pack + JSON schema
  level-validation.json                committed parity baseline
game/             Phaser 4 front end (Vite)
```

## Engine (shared by both front ends)

- **Fixed 120 Hz tick (spec §4.3).** Each tick runs, in order: signal commands → spawns into FIFO entry queues → admission → movement (frontmost first; clamped by red stop lines, leaders, ghost leaders and lookahead) → route transfers → swept-AABB collisions → exits → outcome.
- **Outcome priority:** collision > win > overflow > timeout.
- **Overflow:** an entry queue that exceeds `queueLimit` fails the level.
- **Routes and transfers (spec §4.5):**
  - Vehicles can change lane at a fixed point, which is how turns, diverges and merges work.
  - A ghost leader keeps a vehicle that has just turned blocking the lane it left until its body has cleared that lane.
  - A lookahead leader makes a vehicle respect traffic already on the lane it is about to enter.
  - Circulating traffic does not yield. Merging into it is a real collision, which is the puzzle for L7.
- **Validator (`data.js`)** reports these issue codes: GROUP_MISALIGNED, STOP_INSIDE_CONFLICT, UNCONTROLLED_CONFLICT, REQUIRED_COUNT_MISMATCH, UNKNOWN_REFERENCE. It also checks the reference windows.

## Levels

| # | Reference win | All red | All green |
|---|---|---|---|
| L1 | 10.175 s | timeout | win (tutorial) |
| L2 | 20.79 s | overflow | collision |
| L3 | 24.675 s | overflow | collision |
| L4 | 16.875 s | overflow | collision |
| L5 | 17.59 s | overflow | collision |
| L6 | 23.975 s | overflow | collision |
| L7 (roundabout) | 23.675 s | overflow | collision |

**Timing tolerance:** the fairness checks shift the reference schedule's switch times slightly (±0.1–0.4 s) to see whether it still wins.
- All shifted schedules still win on L1–L5 and L7.
- On L6, 70 of 80 still win, which means L6 has the tightest timing.

**L7 redesign:** ring traffic now enters from the south edge and leaves to the east, so cars no longer pile up on the ring forever. In stress tests, the only place collisions happen is the intended merge (W_in × R_left).

## Phaser front end (`game/`)

- **Stack:** Phaser 4.2.1 (WebGL) and Vite 8.3.5, both pinned exactly.
- **Shared engine:** the Vite aliases `@engine` → `../game-proto/src` and `@proto` → `../game-proto` mean the game imports the engine and level pack rather than copying them.
- **Scenes:**
  - Boot validates the pack and generates textures.
  - Select shows level cards with completion marks; keys 1–7 also choose a level.
  - Play runs preview → countdown → playing / paused → result (win, collision, overflow, timeout).
- **Behaviours that match the spec:**
  - The simulation steps on a fixed clock with a backlog guard (a "performance pause").
  - It pauses automatically when the tab is hidden.
  - The countdown can be cancelled.
  - Signal tap targets are at least 48 CSS px, and HUD buttons A–D duplicate them.
  - Signal state is shown as text as well as colour.
  - Rendering uses up to 2× internal resolution with FIT letterboxing.
- **Hidden helpers:** `?ref=1` auto-plays the reference solution, and `?debug` exposes `window.__game`.
- **Commands:** `cd game && npm install && npm run dev` / `npm run build` / `npm run validate`.

## Verification status

- **Done:**
  - The headless validator passes 60/60 (`node game-proto/tools/headless-validation.mjs`). It runs 17 mutation tests, fairness checks for every level, the route-transfer checks (8c) and the parity check.
  - `vite build` succeeds. The JS bundle is about 1.44 MB.
  - Node-level unit checks pass for countdown cancellation and hit-target size.
- **Not done:**
  - No interactive or visual browser test of the Phaser game yet. Launching headless Chrome was not permitted and the Chrome extension was not connected.
  - No touch or mobile device testing.

## Known gaps and open items

1. **Playtest the Phaser game.** Do a manual pass on desktop and touch (`?ref=1` per level is a quick way to see each level play out).
2. **Engine location.** The engine still lives under `game-proto/src`. Consider extracting it to a shared `engine/` package before the editor work starts.
3. **Bundle size.** The bundle is about 1.44 MB because it includes all of Phaser. There is no code-splitting or lazy loading.
4. **L6 timing.** L6 is the least forgiving level (70/80 shifted schedules win). This may be intended, but it is worth confirming in playtests.
5. **Level editor.** Not started. Routes are read-only in editor v1, per its spec.
6. ~~**Repo hygiene.**~~ Done: `.DS_Store` is no longer tracked and is listed in `.gitignore`.
