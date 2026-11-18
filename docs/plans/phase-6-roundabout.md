# Phase 6 — Roundabout traffic (user-requested extension beyond spec v1)

Spec v1 forbids turns/merges; this phase adds them as an opt-in data feature, demonstrated by level L7.

## Model

- Spawn events may carry `route: ["W_in", "R_left", "R_top", "R_right@100", "E_out"]` — the vehicle
  follows the listed lane segments in order; `"lane@s"` leaves the lane at distance `s` (mid-lane
  exit). `loop: true` wraps the last segment back to the first (circulating ring traffic).
- Transfers happen when the center reaches the segment's exit distance (capped there for that tick). The
  rectangle rotates at the transfer point. Three leader rules keep followers clear of rotated bodies
  (prototype spec §4.5, revised 16 Nov 2026; this replaces the earlier ad-hoc corner/merge yields):
  - **Ghost leader:** a vehicle that left lane L constrains L's followers while its body still overlaps
    L's band. Fixes a false collision where a min-gap follower drove into a car diverging off the ring.
  - **Lookahead leader:** a routed vehicle follows the nearest vehicle on its target lane at/after
    the landing point (path distance).
  - **No yield to approaching traffic:** circulating cars that have not yet reached a merge point are
    not yielded to. Merging into them is a real collision (swept approach check plus landing check).
- Vehicle colors are assigned per vehicle at admission, so a car keeps its color across the
  whole route (previously it recolored at every lane change).
- Crossings are now strictly-interior lane-centerline intersections, so merges/diverges/corners
  are not treated as at-grade crossings.
- Spawn admission is corner-aware: a spawn is held if a vehicle on another lane is about to
  transfer into that lane's entry corner (corner square is single-occupancy).
- Validator: route lanes must exist, start on the stream lane, be geometrically connected;
  interior lane endpoints are allowed only for route-target lanes.

## L7 — Roundabout

Square one-way ring (500,300)-(700,300)-(700,500)-(500,500), clockwise on screen. Marked cars come from the
west (W_in, signal A, stopS 380), merge into R_left at the yield point (500,400), circulate via R_top
and leave east at R_right@100 → E_out. Ambient ring traffic (NO SIGNAL) enters from the south edge
(S_in, 600,800 → 600,500), merges into R_bottom, passes the west yield point and leaves via the same
east exit, in pairs every ~6 s. Deadline 30 s, target 6 (required repeat tail every 1.4 s), queueLimit 8.

*Revision 16 Nov 2026:* the earlier design spawned ring cars at (500,300) in the middle of the map with
`loop: true`, so they appeared out of nowhere and never left. The ring filled up over the level, and the
merge gaps shrank to under one car length. The loop feature stays supported by the engine and validator.

Reference: A green [6, 9) and [13.2, 14.2) → win at 23.68 s; all 24 ±0.1–0.4 s boundary perturbations
still win. All-red → queue overflow; all-green → collision at the merge (4.65 s).

## Verification

- `headless-validation.mjs`: 59/59 (after the 16 Nov revision; includes diverge/corner transfer tests) — roundabout checks: merge conflict is a detected collision
  (micro test: entering into a circulating car crashes with both event ids), clear-gap entry wins,
  route following across W_in/R_left/R_top/R_right/E_out, 11 negative pack mutations rejected
  (incl. unknown/disconnected routes), L7 matrix (ref win 20.35s; all-red overflow; all-green
  collision at the merge), perturbation matrix recorded.
- Browser: L7 all-green run ends in "Collision!" at 8.03s with both vehicles flashing red;
  mid-play screenshot shows stable per-vehicle colors across ring lanes; win path verified
  ("Campaign complete! All 7 levels cleared", 20.35s, matching the headless replay).

## Known approximation

A vehicle is on exactly one lane per tick; at a transfer tick its rect swaps orientation at the
transfer point. Ghost and lookahead leaders keep followers outside the rotated body, so the
approximation does not cause false collisions.
