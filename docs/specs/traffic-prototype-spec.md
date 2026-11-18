# Traffic Control — browser prototype specification

Version 1.1 · 16 November 2026 · Working title: **Mind the Gap**

> **Changes in 1.1** (aligning the spec with the accepted prototype): level schedules now come from the shipped `traffic-levels.json` (spawn times jittered, deterministic `repeat` tails); entry queues have a limit and a full queue fails the run; a seventh level (roundabout) uses fixed vehicle routes with turns, merges and diverges (§4.5); parity is checked against the committed `level-validation.json` instead of a separate Python checker; `schemaVersion` is the integer `1`.

## 1. Product and implementation brief

Build a playable browser game about releasing cars through intersections without collisions. The player clicks individual traffic lights. Some approaches have lights; other traffic streams cannot be stopped. The player must read gaps, release batches and anticipate what happens at the next intersection.

Ship **seven pre-designed levels** (six crossing levels plus a roundabout), not a procedural campaign. Their exact geometry, individual vehicles, requested spawn times and reference signal schedules are supplied in `traffic-levels.json`. Implement those levels before making additional ones. The accompanying level editor has its own specification in `level-creation-tool-spec.md` and is a separate delivery phase.

Use JavaScript ES modules. The shipped game (`./game`) is built with **Phaser 4** (WebGL, Vite), with HUD controls drawn in Phaser. The earlier Canvas 2D / HTML prototype (`./game-proto`) remains as a reference front end. Both import the same DOM-free engine and level pack from `game-proto/src` and `game-proto/traffic-levels.json`; a front end must never carry its own copy of the traffic rules. No server, accounts, installation, asset service or AI service is required to play. TypeScript is an acceptable implementation choice if it does not complicate the handoff. Simple readable geometric artwork is sufficient.

**Prototype success:** all seven levels load from data, are playable with mouse or touch, can be retried immediately, and reproduce the included reference replays in the game's actual simulation.

## 2. Fixed design decisions

| Topic | Prototype decision |
| --- | --- |
| Roads | Axis-aligned, straight, one-way lanes. Vehicles normally stay on their lane; a stream may give its vehicles a fixed **route** of connected lanes (turns, merges, diverges, §4.5), used by the roundabout level only |
| Player input | Toggle a signal group between red and green |
| Independence | Each signal is independent; no automatic cross-light switching or safety interlock |
| Uncontrolled traffic | Cannot be stopped by the player and never yields to crossing traffic |
| Following | All vehicles maintain the specified gap behind vehicles on their own lane |
| Required traffic | Marked vehicles must reach their exit; the objective is `requiredCount` marked exits. A required stream may continue with a deterministic repeat tail, so more marked cars can appear than the target |
| Ambient traffic | Unmarked, unstoppable cross traffic; does not advance the objective |
| Failure | Any collision (including ambient traffic), a queue overflow, or missing the objective at the deadline |
| Counting | Count a required vehicle once, only when its rear clears its final map exit |
| Determinism | Fixed spawn schedules and simulation ticks; retry reproduces the same challenge |
| Speed model | Constant lane speed, with immediate stopping/restarting under hard constraints |
| Queue overflow | Vehicles wait at an entry offscreen and are never silently discarded. Each entry has a queue limit (`queueLimit`); a spawn request arriving at a full entry queue ends the run as **Queue overflow** |
| Presentation | Clear road directions, visible stop lines and signal labels A–D |

The required/ambient distinction is deliberate: counting unstoppable traffic toward the target would allow some levels to be won with every light red. Mark required vehicles with a small roof diamond and use an objective such as **“Get all 8 marked cars through.”** When a required stream has a repeat tail, say **“Get 6 marked cars through”** (not “all”). Show an optional total-throughput statistic separately. At Level 4, both crossing streams are required and controllable; this is the lesson for that level.

## 3. Player flow and interface

1. Select a level. All seven are accessible during prototype testing; completed levels receive a local check mark.
2. Show a frozen map preview, objective, time limit and a one-sentence lesson.
3. Start with a 3–2–1 countdown outside simulation time.
4. Click/tap signal A, B, C or D to toggle it. Keys 1–4 toggle the same signals; P/Escape pauses and R opens retry while paused or after a result. Do not bind ordinary movement keys.
5. Win as soon as every required vehicle has fully exited, provided no collision occurs in that simulation step.
6. On a collision, freeze at the collision and highlight the two vehicles. Show Retry and Level Select. On a queue overflow, name the overflowing entry. On a timeout, highlight required traffic still waiting.
7. After winning, show time used, required vehicles cleared, Next Level and Retry. After the last level (Level 7), show campaign completion and level selection.

HUD: level number/title, `Required: cleared / target`, time remaining, Pause and a short legend for the roof diamond. Labels must explain red/green in addition to color. Pausing freezes both vehicles and the timer; input cannot secretly change lights while paused. A hidden tab automatically pauses and requires deliberate resume; this includes a tab hidden during the countdown (the run starts paused). Leaving the countdown (level select, retry) cancels it.

Use a fixed 1200 × 800 world, scaled uniformly with letterboxing. Keep HUD outside the world rectangle. Transform pointer positions through the inverse world transform. Give every signal at least a 48 × 48 CSS-pixel hit target; where targets would overlap, use offset callout buttons connected to the correct stop lines. Scale sprites with the world, but retain usable HTML signal controls on small screens. Landscape is the preferred phone layout; do not crop approaching traffic.

Use dark roads on a quiet background, arrow markings for direction, distinguishable vehicle silhouettes and high-contrast stop lines. Give ambient streams an entry label such as **“NO SIGNAL”** at their map-edge entry (not on ring or exit lanes that only receive routed vehicles). No need for photorealistic grass, original-game graphics or generated imagery.

## 4. Authoritative simulation contract

This section and `traffic-levels.json` define the prototype model. The browser engine (`game-proto/src/sim.js`) is the executable reference; the headless runner imports it unchanged. Changing acceleration, spawn placement, collision geometry or stopping semantics invalidates the included reference results.

### 4.1 Coordinates and vehicle geometry

Coordinates are world units; x grows right and y grows down. Each lane has an entry `from`, exit `to`, and positive `speed` in units/second. Entries and exits lie on the world boundary. A lane is a directed segment with distance coordinate `s` from its entry. A crossing is derived where perpendicular lane centerlines intersect at grade.

Vehicle position `s` is its center. A newly admitted vehicle is fully inside the map: its rear is at s = 0, center at half its length, and front at its full length. This is important: the `at` field is an entry-admission request, not the instant the front first appears outside the world.

| Type | Length | Width | Behavior |
| --- | --- | --- | --- |
| `car` | 28 | 14 | Standard footprint |
| `bus` | 52 | 14 | Longer footprint; same speed as its lane |

All levels use a 12-unit minimum following gap. Buses take longer to clear crossings. Required status is independent of type or body color.

### 4.2 Signal position and commitment

`stopS` is the front-bumper stopping boundary measured from lane entry. A red signal limits an uncommitted vehicle's center to `stopS - length / 2`. It is **not** the light sprite's position. Grouped lanes share the same stopS and toggle together; Level 6 uses this to control two adjacent lanes.

Once a vehicle's front moves strictly beyond a stop line, it is committed past that signal. Later switching that signal red cannot stop it. Track this per vehicle and per signal. Another signal farther along its lane may still stop it. Vehicles already within the intersection must continue until constrained by a leader or a downstream red signal.

No amber phase, braking distance or automated intersection reservation is used in this first prototype. These would change timing and need new level validation. Clearly show the front-bumper stop line so the arcade stopping rule remains understandable.

### 4.3 Time, spawn requests and movement

Run simulation at **120 fixed ticks/second**, independent of rendering. `t = tick / 120` is the start of a tick. Use tick indices for replay inputs. An external time value is first eligible at the smallest tick whose time is at least that value; implement this with an epsilon-safe conversion, not arbitrary frame timing.

At each tick:

1. Apply all queued signal commands, in stable recorded order. For supplied reference windows, set each signal's state directly from its windows at time t.
2. Add all due spawn requests to per-lane FIFO entry queues, sorted by requested time then event ID. If the queue already holds `queueLimit` requests, record a queue overflow for this tick instead (the request is not added).
3. Admit at most one waiting vehicle per lane if it fits entirely within the map with a 12-unit gap to the rearmost existing vehicle (including a ghost body, §4.5). Otherwise leave it waiting. No overlap or event deletion is allowed.
4. Move vehicles lane by lane, frontmost first. Desired center is `oldS + speed / 120`. Clamp this to every applicable red stop boundary and the updated leader rear minus gap minus this vehicle's half length (and, for routed vehicles, the ghost and lookahead leaders of §4.5). A clamp must never move a vehicle backward. Update committed signal IDs when its front passes a stop line. Then apply route transfers (§4.5).
5. Detect collisions across all lanes over the tick's actual motion, before removing exited cars. Evaluate vehicle rectangles, not whole intersection occupancy. Two cars may occupy different parts of a junction without colliding.
6. Remove vehicles whose rear has reached or exceeded their lane length; increment the required counter once per required exit.
7. Resolve collision first, then success, then queue overflow, then timeout. Completion on the deadline tick is allowed if collision-free, and wins over a same-tick overflow.

The timer runs from tick 0 through `timeLimit × 120` ticks. Countdown, pause and result screens do not consume it. Render interpolation must not change collision positions or input order. Do not silently skip simulation time under load: run at most 0.5 s of simulation per rendered frame, and if more than 0.25 s of wall time is still unsimulated, pause with a brief performance message.

### 4.4 Collision and queue behavior

Use axis-aligned vehicle rectangles; rotating from horizontal to vertical simply swaps dimensions. Use swept AABB intersection over relative motion within a tick to prevent missed collisions. Strict interior overlap is a collision; boundary contact alone is not. The authoring validator implements the same linear within-tick movement convention. Same-lane hard-gap constraints prevent rear-end collisions, but assert that invariant in debug mode.

A stopped downstream queue can extend into an upstream crossing. Ambient cars still do not yield: this can cause a collision. Do not automatically hold a car before a green light just because a downstream crossing might be blocked. The player must learn to manage the queue. Offscreen entry queues are allowed up to the entry's `queueLimit` (level value, else `rules.queueLimit`, else unlimited). The waiting count is shown at the entry as `⏳n/limit`. A request arriving at a full queue fails the run (**Queue overflow**). This punishes leaving a light red too long. The queue limits are tuned per level so that all-red fails before the deadline in Levels 2–7, while every reference solution wins.

### 4.5 Routes and lane transfers (roundabout)

A stream event may carry `route`: an ordered list of lane IDs, the first being the stream's lane. `"lane@s"` (or `{lane, untilS}`) leaves that lane at distance `s` instead of at its end; `loop: true` wraps the last segment back to the first. Consecutive segments must be geometrically connected: the leaving point must lie on the next lane. A lane endpoint may be inside the world only when that lane is a route target. Route lanes count as carrying traffic for the uncontrolled-conflict check.

- **Transfer.** When a vehicle's center reaches the segment's exit distance it is capped there for that tick, then moved onto the next lane at the landing point `baseS` (the leaving point's distance on the next lane). Its rectangle rotates at that instant. A transfer with `baseS = 0` is a **turn or diverge** (it joins the next lane at its start). One with `baseS > 0` is a **merge** into the middle of a lane.
- **Ghost leader.** After a transfer, the vehicle's body still overlaps the lane it left for a few ticks, because its rotated rectangle sticks into that lane's band (± the widest vehicle half-width). Until the body clears the band, followers on the old lane treat the body's near edge as their leader's rear (gap and clamp as in §4.3). Without this, a car following at the legal gap would drive into a car turning off ahead of it. Ghosts are computed from tick-start positions, which is conservative.
- **Lookahead leader.** A routed vehicle approaching its transfer also follows the nearest vehicle on the target lane whose center is at or past `baseS`, measured in path distance: `exitS + (leaderRear − baseS) − gap − half`.
- **No yielding to approaching traffic.** Vehicles on the target lane that have not yet reached the landing point are not yielded to. Entering a roundabout in front of circulating traffic is the player's timing problem, exactly like an uncontrolled crossing.
- **Collisions.** The approach motion of a transferring vehicle is swept against all other lanes. A landing that overlaps a vehicle already on the target lane is a collision.
- **Admission guard.** A spawn at a lane start is held while a vehicle on another lane is about to turn into that start.
- **Crossings** are only strictly interior intersections of perpendicular centerlines. Touching endpoints (turns, merges, diverges) are not at-grade crossings.

The rotation at a transfer is the one known approximation: a vehicle occupies exactly one lane per tick. The ghost and lookahead rules keep followers clear of the rotated body, and the headless runner tests a min-gap diverge (car and bus) and a min-gap car/bus/car platoon through a corner.

## 5. Seven pre-designed levels

All signals begin red. Speeds are 100 units/second except Level 6's ambient lanes (120). **`traffic-levels.json` is authoritative**; the tables below are a readable summary of it. Spawn times are deliberately irregular (fixed jitter), so the challenge does not reduce to a metronome. Each stream ends with a deterministic **repeat tail**: after its last listed event, one more vehicle every `repeat.every` seconds until the deadline. There is no runtime randomization, adaptive spawning or hidden difficulty scaling. Reference times, all-red/all-green outcomes and perturbation results below are from the committed `level-validation.json`.

| Level | Target / deadline | Queue limit | Reference clear | All-red | All-green |
| --- | --- | --- | --- | --- | --- |
| 1 First Release | 3 / 16 s | 6 | 10.18 s | timeout | win (tutorial) |
| 2 Find the Gap | 5 / 28 s | 7 | 20.79 s | overflow | collision 5.65 s |
| 3 Two Crossings | 8 / 32 s | 8 | 24.68 s | overflow | collision 20.45 s |
| 4 Share the Junction | 12 / 25 s | 8 | 16.88 s | overflow | collision 5.65 s |
| 5 Moving Gaps | 12 / 34 s | 9 | 17.59 s | overflow | collision 3.75 s |
| 6 Rush Hour | 16 / 38 s | 10 | 23.98 s | overflow | collision 6.18 s |
| 7 Roundabout | 6 / 30 s | 8 | 23.68 s | overflow | collision 4.65 s |

### Level 1 — First Release

**Lesson:** click a light, release a queue, and understand exit counting. Tutorial: **“Click A to turn it green. Marked cars count when they leave the map.”**

| Lane | Entry → exit | Role | Spawn requests, seconds | Repeat |
| --- | --- | --- | --- | --- |
| V | (600, 0) → (600, 800) | Required, southbound | 0, 0.8, 1.5 | car every 1.3 |

Signal A controls V at stopS = 340. Reference: A green from 4.5 s. Leaving A red times out; all-green succeeds here intentionally.

### Level 2 — Find the Gap

**Lesson:** release traffic between an unstoppable stream. Tutorial: **“The vertical traffic will not stop. Let a gap reach the crossing before you release your queue.”**

| Lane | Entry → exit | Role | Spawn requests | Repeat |
| --- | --- | --- | --- | --- |
| H | (0, 400) → (1200, 400) | Required, eastbound | 0, 0.9, 1.4, 7.3, 8.8 | car every 1.1 |
| V | (600, 0) → (600, 800) | Ambient, southbound | 1.6, 8.4, 13.2, 20.8, 25.7 | car every 2 |

One crossing at (600, 400). Signal A controls H at stopS = 540. Reference: A green [6.2, 15.06).

### Level 3 — Two Crossings

**Lesson:** coordinate signals along the same route. Tutorial: **“A gets cars through the first crossing. B must get the same cars through the next.”**

| Lane | Entry → exit | Role | Spawn requests | Repeat |
| --- | --- | --- | --- | --- |
| V | (400, 800) → (400, 0) | Required, northbound | 0, 0.9, 1.3, 6.5, 7.8, 8.9, 13.4, 15.1 | car every 1.2 |
| LOW | (1200, 560) → (0, 560) | Ambient, westbound | 0.4, 8.7, 15.2, 24.6 | car every 3.5 |
| HIGH | (0, 240) → (1200, 240) | Ambient, eastbound | 0.2, 7.4, 16.8, 23.1 | car every 3 |

A controls V at stopS = 180 (before the lower crossing), B at stopS = 500 (before the upper crossing). All-green crashes late (20.45 s), exposing downstream planning.

### Level 4 — Share the Junction

**Lesson:** deliberately share a crossing between two controlled queues. Tutorial: **“Turn one approach red, let the last car clear, then release the other.”**

| Lane | Entry → exit | Role | Spawn requests | Repeat |
| --- | --- | --- | --- | --- |
| H | (0, 400) → (1200, 400) | Required, eastbound | 0, 0.7, 1.1, 1.8, 2.2, 2.9 | car every 1 |
| V | (600, 0) → (600, 800) | Required, southbound | 0.3, 0.6, 1.4, 1.9, 2.5, 2.8 | car every 1 |

A controls H at stopS = 540; B controls V at stopS = 340. No ambient stream and no interlock. Reference: A [1, 9), B [10, 24.9).

### Level 5 — Moving Gaps

**Lesson:** a safe window reaches different junctions at different times. Tutorial: **“Watch where each gap is going. The four lights need different timing.”**

| Lane | Entry → exit | Role | Spawn requests | Repeat |
| --- | --- | --- | --- | --- |
| LEFT | (360, 800) → (360, 0) | Required, northbound | 0, 0.8, 1.5, 7.4, 8.7, 9.6 | car every 1.3 |
| RIGHT | (840, 800) → (840, 0) | Required, northbound | 0.2, 0.7, 1.3, 8.2, 8.8, 9.4 | car every 1.4 |
| LOW | (0, 560) → (1200, 560) | Ambient, eastbound | 0.5, 6.8, 14.4, 20.2, 28.7 | car every 3 |
| HIGH | (1200, 240) → (0, 240) | Ambient, westbound | 0.3, 7.6, 13.8, 21.5, 27.2 | car every 3.2 |

Signals: A = LEFT stopS 180; B = LEFT stopS 500; C = RIGHT stopS 180; D = RIGHT stopS 500. Avoid implying that A/C or B/D should toggle together.

### Level 6 — Rush Hour

**Lesson:** clear two adjacent lanes and allow for longer vehicles. Tutorial: **“One light controls both lanes. Leave enough room for the bus to clear.”**

| Lane | Entry → exit | Role/speed | Spawn requests | Types (C/B) | Repeat |
| --- | --- | --- | --- | --- | --- |
| LEFT | (540, 800) → (540, 0) | Required, 100 | 0, 0.9, 1.6, 6.7, 7.9, 8.8, 13.5, 15.2 | C B C C C B C C | car every 1.2 |
| RIGHT | (580, 800) → (580, 0) | Required, 100 | 0.1, 0.6, 1.4, 7.2, 7.7, 8.5, 14.3, 14.9 | C C B C B C C C | car every 1.3 |
| LOW | (0, 560) → (1200, 560) | Ambient, 120 | 0.4, 1.3, 6.6, 8.8, 13.2, 15.7, 20.6, 22.9, 27.4, 29.8, 34.6 | C B C C B C C B C C B | car every 2.2 |
| HIGH | (1200, 240) → (0, 240) | Ambient, 120 | 1.5, 2.2, 7.5, 9.6, 14.4, 16.8, 21.3, 23.7, 28.6, 30.9, 35.5 | B C C B C C B C C B C | car every 2.4 |

Signal A controls both LEFT and RIGHT at stopS 180; B both at stopS 500. A green opening must be safe for traffic in both lanes.

### Level 7 — Roundabout

**Lesson:** enter the ring only when there is a gap; circulating traffic never stops. Tutorial: **“Cars already on the roundabout have priority. Release A so your cars reach the yield point between ring cars.”**

One-way square ring, clockwise on screen: R_top (500,300)→(700,300), R_right (700,300)→(700,500), R_bottom (700,500)→(500,500), R_left (500,500)→(500,300).

| Lane / stream | Route | Role | Spawn requests | Repeat |
| --- | --- | --- | --- | --- |
| W_in (0,400)→(500,400) | W_in → R_left (merge at s=100) → R_top → R_right@100 → E_out | Required | 0, 0.9, 1.7 | car every 1.4 |
| S_in (600,800)→(600,500) | S_in → R_bottom (merge at s=100) → R_left → R_top → R_right@100 → E_out | Ambient, NO SIGNAL | pairs: 0/1.4, 6/7.4, 12/13.4, 18/19.4, 24/25.4 | — |

E_out (700,400)→(1200,400) is the shared exit. Signal A controls W_in at stopS = 380. Ambient cars enter from the map edge, circulate a quarter-plus of the ring past the west yield point (yellow triangle), and leave east. The ring therefore never fills up. The only conflict is the west merge, with ambient pairs passing roughly every 6 s. Reference: A green [6, 9) and [13.2, 14.2), i.e. release after each ambient pair has passed. Every ±0.1–0.4 s boundary shift still wins.

## 6. Level data and engine boundary

`traffic-levels.json` is a pack: `$schema`, `schemaVersion` (the integer `1`), shared `rules` (`tickRate`, `world`, `minGap`, `signalsStartRed`, `vehicleTypes`, optional default `queueLimit`), and `levels`. Each level contains ID, title, lesson, optional tutorial, deadline, optional `queueLimit`, lanes, signals, streams, requiredCount, and a referenceSolution. Each stream references a lane and contains explicitly enumerated events with unique IDs, times and vehicle types (optionally `route`/`loop`, §4.5). It may also have a `repeat` tail `{every, type}`, which the loader expands into explicit, deterministic events before the deadline. Without a required repeat tail, `requiredCount` must equal the number of required events. With one, it must be between 1 and the number of required vehicles scheduled before the deadline. Reject mismatches rather than silently adjusting the objective.

`traffic-levels.schema.json` supplies structural validation. Add semantic validation for axis alignment, boundary entries/exits, nonzero length, known references, same-lane signal ordering, valid stop lines, crossing geometry, grouped signal alignment, event uniqueness, route connectivity, ordered non-overlapping reference windows and objective totals. Specifically:

- **Grouped signals** need the same direction, the same speed and aligned entries, so the shared stopS is one world line (`GROUP_MISALIGNED`).
- **Stop lines** must lie at or beyond the lane's longest vehicle length, and a vehicle stopped there must not overlap any crossing band (`STOP_INSIDE_CONFLICT`).
- **Uncontrolled conflicts.** A lane counts as controlled at a crossing only if one of its signals stops traffic before that crossing. A crossing with two uncontrolled conflicting streams is outside this version and must be rejected, unless their schedules are explicitly proven collision-free; the first editor version should simply reject it (`UNCONTROLLED_CONFLICT`).

Validator messages carry these issue codes where they apply.

`referenceSolution.windows[signalId]` lists absolute half-open green intervals `[start, end)`. The signal is red outside those intervals. A tick is green when its start time is within one of those intervals, using the time-conversion rule above. Windows per signal must be sorted and non-overlapping. These schedules are authoring fixtures, not player automation, hints shown during play or a claim of an optimal solution. The player may find other solutions.

Use pure simulation functions with no DOM dependence. Suggested module boundary:

- Data loader and validators.
- Simulation state, spawn queues, following constraints, signal commitment and swept collisions.
- Commands/replay, deterministic stepping and serializable checkpoints.
- Canvas rendering and pointer mapping.
- HTML screens/HUD and local completion persistence.
- Headless validation runner that imports the same simulation used by the game.

The later editor must import this engine; do not create a separate approximation of traffic rules for preview or AI validation. `tools/author-references.mjs` derives candidate reference windows with the same engine. Its output is an authoring aid and is re-verified by the headless runner.

## 7. Validation, fairness and completion criteria

The package includes `tools/headless-validation.mjs` and the committed report `level-validation.json`. The runner imports the game's own engine and replays every reference. It checks that all-red never wins (it times out in Level 1 and overflows in Levels 2–7), that all-green wins only in the introductory Level 1 and collides in Levels 2–7, and it runs the checks below. The report stores the pack's SHA-256 and an engine-source hash, so changes invalidate previous results. These are model-level results, **not human difficulty ratings**.

**Parity baseline.** The committed `level-validation.json` is the parity baseline. When the pack hash matches, every reference clear tick must match within one tick. A divergence fails the run, and the baseline is not overwritten. After investigating, rerun with `--accept` to replace it. A pack change starts a new baseline automatically.

Mandatory browser-engine checks:

1. Replay every reference schedule and reproduce required exits and outcome, with final-clear time within one tick of the committed report. Investigate divergences before tuning levels.
2. All-red cannot advance objectives from ambient traffic and never wins. All-green has the documented outcomes.
3. Switching red cannot stop an already committed car. A downstream red can stop it.
4. Same-lane queues never overlap; a blocked entry preserves every scheduled vehicle, including buses, until the queue limit is exceeded, which ends the run as an overflow.
5. A long vehicle counts only after its rear exits. Every vehicle counts at most once.
6. Identical command logs produce identical outcomes at different render frame rates. Pause/resume and hidden-tab behavior preserve simulation time.
7. Crossing collisions, a blocked-crossing collision and a fast crossing within one tick are detected with the correct vehicle IDs.
8. Grouped lights affect both lanes. Shared crossings do not collapse into one oversized collision zone.
8b. Routes: entering a merge into circulating traffic is a collision, entering on a gap is not, routed cars traverse all their lanes, a min-gap follower survives a diverge (car and bus), and a min-gap car/bus/car platoon turns a corner.
8c. The semantic validator rejects each deliberately broken pack (duplicate IDs, unknown references, misaligned groups, stop line inside a crossing, signal downstream of its crossing, overlapping windows, unreachable or mismatched requiredCount, disconnected routes).
9. Run a human playtest of each level with normal-speed input. Confirm that approach visibility gives time to act and valid solutions do not require a one-tick click.

The authoring references use no green interval shorter than 0.8 seconds. This alone does not prove comfortable control. As a fairness gate, perturb relevant replay command times by ±0.10 and ±0.20 seconds, measure which variants still win, and document the tolerance. Do not assert that every perturbation must win; require at least one understandable, repeatable solution with a useful input margin before signing off the campaign. Adjust geometry or schedules if that is missing, then regenerate fixtures and reports.

Acceptance also requires working start/pause/retry/next/select flows, legible controls on desktop and touch, no missing events after repeated retries, and no debug/replay controls exposed in the ordinary HUD.

## 8. Implementation milestones

| Phase | Deliverable | Exit condition |
| --- | --- | --- |
| 1 | Pure simulation and data loader | L1 and deterministic tick/replay checks pass |
| 2 | Collision, ambient traffic, following and downstream signals | L2–L4 references reproduce; commitment and queue tests pass |
| 3 | Four-light and grouped-lane layouts, buses | All six references reproduce in the actual engine |
| 4 | Playable UI, touch, audio toggle and results | Every level can be played/retried without developer tools |
| 5 | Human tuning and parity regression | Campaign accepted; report and fixtures updated together |
| 6 | Routes and the roundabout level (§4.5) | L7 reference reproduces; transfer regression tests pass |

Do not implement the AI editor during these phases. Preserve the shared data/engine interface so the editor can follow. Potential later additions—general turning traffic beyond fixed routes, acceleration, emergency vehicles, random campaigns or scoring stars—need separate design and new level validation.
