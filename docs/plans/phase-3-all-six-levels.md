# Phase 3 — Four-light and grouped-lane layouts, buses

Spec: §5 Levels 5–6, §4.2 grouped signals. Milestone exit: "All six references reproduce in the actual engine".

## Deliverables

- Reference windows for L5 (signals A–D, four crossings, two independent required routes) and
  L6 (signal group A controls LEFT+RIGHT at stopS 180, B at 500; buses on all lanes; ambient speed 120).
- Grouped-signal support in sim + renderer: one signal id drives several lanes; shared crossings are
  NOT merged into one collision zone (pairwise rect checks only).
- Engine checks:
  - Grouped toggle releases both L6 lanes; collision attribution names the correct lane pair.
  - A long vehicle (bus) counts only after its rear exits (`s - length/2 >= laneLength`), exactly once.
  - `requiredCount` equals the number of required events for every level (validator).

## Exit criteria

- All six reference replays win; final-clear tick recorded per level into `level-validation.json`.
- Outcome matrix: all-red → timeout on all six; all-green → win on L1, collision on L2–L6
  (collision ticks reported; spec documents ~5.65 s for L2/L4).
- Reference clear times recorded (spec ballpark: L1 ≈ 10.2 s, L2 ≈ 20.6 s, L3 ≈ 23.5 s, L4 ≈ 16.9 s,
  L5 ≈ 19.3 s, L6 ≈ 26.5 s; the generated pack's own report is authoritative).
