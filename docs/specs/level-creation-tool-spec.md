# Traffic Control — level creation tool specification

Version 1.1 · 16 November 2026 · Companion to `traffic-prototype-spec.md` (v1.1)

> **Changes in 1.1:** seven shipped levels; `schemaVersion` is the integer `1`; queue limits, `repeat` tails and vehicle routes are runtime fields the editor must preserve; parity is checked against the committed `level-validation.json`; issue code `GROUP_MISALIGNED` added.

## 1. Purpose and release strategy

Build a browser-based authoring tool for creating, inspecting and tuning Traffic Control levels. The main problem is **coordinating road geometry, queues and traffic timing so that a level is solvable and readable**. Drawing roads and increasing spawn frequency is not sufficient.

The tool must open, edit, simulate and export the seven supplied prototype levels without changing their meaning. It uses the same level format and the same JavaScript simulation as the game. AI assistance is an optional later capability for proposing layouts, schedules and changes. A working manual editor and deterministic validation must exist first.

Release in three increments:

1. **Manual authoring:** geometry, signals, traffic timeline, playtest, import/export, undo/redo.
2. **Analysis:** replay validation, crossing timelines, bounded solution search, difficulty measurements and regression reports.
3. **AI assistance:** plain-language briefs, constrained candidate proposals, targeted repairs and explanation, all passed through the analysis layer.

An AI-generated level is a draft. A successful replay is evidence of one solution under the model. A designer's playtest establishes whether the intended challenge is understandable and enjoyable. Show those as separate states.

## 2. User workflow

A designer can:

1. Start from a blank level, clone an existing level, or choose a layout template.
2. Draw directed lanes and place signal groups.
3. Add required traffic and ambient traffic with explicit schedules.
4. Inspect likely crossing arrivals, queue storage and dangerous overlap periods.
5. Run the level, toggle lights, and record a solution attempt.
6. Fix a problem manually or ask AI for a bounded change.
7. Validate the candidate, compare its metrics and replay against the previous version, then accept or discard it.
8. Export a self-contained level or pack for the prototype game.

The bundled levels are useful examples, not protected originals: clone before experimenting by default. Ordinary edits remain local until explicitly exported. “Accept candidate” changes the working draft; it does not publish a game.

## 3. Editor layout

| Area | Contents and behavior |
| --- | --- |
| Top bar | Level name, dirty/saved state, undo/redo, select tool, draw lane, add signal, validate, playtest, import, export |
| Left panel | Level list, layout templates, lane list, signal groups, vehicle types |
| Center canvas | Same world/view transform and artwork as the game, with optional coordinates, crossing IDs, stop boundaries and selection handles |
| Right inspector | Selected object's numeric properties, role, references, constraints and relevant diagnostics |
| Bottom timeline | Spawn-request tracks, actual-entry tracks, signals, crossing occupancy, exit events and replay scrubber |
| Analysis drawer | Validation issues, candidate comparison, solution results, difficulty metrics and AI brief/chat |

Do not cover approaching cars with editing panels during playtest. A single hotkey or button switches between Edit and Test mode. Test mode freezes the document revision and creates a disposable simulation instance. Returning to Edit restores the authored state, not cars at their final positions.

## 4. Manual authoring requirements

### 4.1 Geometry tools

Work on the prototype's fixed 1200 × 800 world. Grid snapping defaults to 20 units; allow numeric coordinates and an optional finer snap. A road tool creates a directed, axis-aligned lane from one world edge to the opposite edge. A direction arrow must remain visible while drawing.

In v1, author horizontal/vertical straight-through lanes only. Automatically derive perpendicular at-grade crossings. Do not offer tools for curved paths, turns, lane switching, merges, bridges or cropped internal endpoints. The runtime does support fixed vehicle routes (`route`, `loop`, interior endpoints on route lanes; prototype spec §4.5), which the roundabout level uses. The v1 editor must import, display, simulate and export such levels unchanged, but shows routes and route lanes read-only. Route authoring is a later increment. Reject collinear overlapping lanes. Adjacent parallel lanes are allowed if their vehicle envelopes do not overlap; show shared road pavement as decoration derived from the lanes.

Lane inspector: stable ID, entry/exit, direction, speed, role (`required` or `ambient` for the stream), spawn track and entry queue limit (level `queueLimit`, defaulting to `rules.queueLimit`). Each lane has exactly one stream in the editor's first release. A designer can reposition or duplicate a lane; any attached signal stop coordinate must be recalculated or explicitly flagged, never silently retained at a different world position.

Show crossings as selectable overlays. Each crossing inspector lists its two lanes, which approach is controlled, approach visibility and associated stop boundary. A four-lane junction may comprise multiple lane-to-lane crossings; keep their physical footprints distinct.

### 4.2 Signals and groups

Place a stop boundary upstream of a selected crossing and attach a signal to it. Dragging the boundary changes `stopS`; the light button can be offset independently for legibility. Signal IDs are stable. Separate signals on the same lane are ordered by stopS.

Support grouping adjacent lanes: one signal ID can control multiple lanes with the same direction, speed and aligned world stop boundary (the runtime validator reports `GROUP_MISALIGNED` otherwise). The current game schema uses a common stopS, so grouped lanes also need matching entry alignment. Where that is not true, reject grouping with an explanation; do not invent per-lane offsets unsupported by the runtime.

All shipped levels begin with red lights. Keep this as a v1 creation constraint. There is no automatic mutual exclusion between perpendicular greens. A preview may warn about a potential collision, but must not change the player's signal input.

Flag stop lines inside a crossing or too close for a stopped vehicle to avoid its footprint. Check the lane's maximum vehicle length and the perpendicular vehicle width. The upstream/front stop line must lie before the nearest potential collision envelope with an explicit small design buffer, rather than an arbitrary road-art edge.

For successive signals, display storage from the rear edge of the upstream crossing envelope to the downstream stop line. A lane's nominal capacity for same-size vehicles is the largest n satisfying `n × length + (n − 1) × minGap <= storage`. Mixed buses/cars require actual summed lengths; capacity is an advisory bound, not proof against queue spillback.

### 4.3 Traffic schedule editor

Each lane has a timeline track with explicit vehicle events. An event is a spawn request at a time, a vehicle type, and a stable unique ID. Required status is stored at stream level. Editing the role changes every event on that track, updates the objective total and invalidates previous reports.

Support single-event placement, multi-select, move, duplicate, delete and type change. A batch dialog accepts start time, count, interval and a type sequence. A pulse tool accepts a period and end time. **Expand these tools to individual events when saving/exporting.** The one generator the runtime understands is the stream `repeat` tail `{every, type}`: one vehicle every `every` seconds after the last explicit event until the deadline. It is deterministic and may be exported as-is. Show its expanded events on the timeline. The shipped runtime must not depend on any other editor-only generator or implicit random rule. With a required repeat tail, `requiredCount` is an explicit target between 1 and the scheduled required vehicles, not the event total.

Distinguish:

- Requested entry time, authored by the designer.
- Actual admission time, measured in a replay when an entry is blocked.
- Earliest unimpeded arrival at a crossing, an estimate.
- Actual crossing entry/clearance and exit time, measured in a replay.

For an unimpeded vehicle admitted at time a, initial center is length/2. Its center would reach a crossing at lane-distance d at `a + (d − length/2) / speed`. Its collision interval depends on both vehicles' dimensions. For a perpendicular lane with vehicle width w, occupancy around the crossing center extends by `(length/2 + w/2) / speed` on either side. Clamp events that start inside a footprint to the beginning of the simulation interval. Do not use these estimates after a red light or a queue without labeling the assumption.

All events must request entry before the deadline. A queued request beyond the entry's `queueLimit` ends a run as a queue overflow, so show the queue-limit line on each spawn track. Late requests that cannot possibly exit in time are errors for required traffic, warnings for ambient traffic. A queued actual entry can be later than requested and still be valid; the engine must evaluate it.

### 4.4 Replay and timeline tools

Play, pause, restart, one tick, 0.25×, 0.5×, 1×, 2× and accelerated headless validation. Record signal commands as `(tick, signalId, state)` with stable order. Store state-setting commands, not ambiguous click toggles. Multiple commands in one tick keep their recording order; repeated state-setting to the same value has no effect.

Scrubbing uses a saved deterministic checkpoint plus forward replay; dragging the scrubber backward must restore vehicles, commitments, counters, queues and signal states. Do not run physics backward. Keep editor selections separate from simulation IDs.

Display replay tracks for each signal's red/green state and, optionally, vehicles' crossing occupancy. Highlight a collision with the two vehicle IDs, the exact tick and their footprints. Selecting an issue jumps to its lane/crossing/event and can open the relevant replay moment.

A winning playtest can be saved as a reference replay. The export validator converts a compatible state-setting replay to the schema's half-open green windows, then replays the exported representation to verify equivalent results. Initial state is red; no hidden input is allowed.

## 5. Data contract and versioning

The game and editor share `traffic-levels.schema.json` and `schemaVersion: 1` (integer). The provided schema validates the pack structure. Single-level export wraps that level in the same pack structure with the shared rules. An AI candidate may be a single level object, but it must be wrapped and validated before test/export.

Keep editor metadata outside the runtime pack in a project document:

- Document revision, title, draft history, locked objects and selection/layout preferences.
- Runtime pack and a SHA-256 of its exact exported UTF-8 bytes.
- Engine build/version, rules version and the schema version used for each report.
- Replay commands, validation results, human playtest notes and AI proposal provenance.

Never put provider keys, chat credentials or private account data into the exported level. Unknown schema versions must produce a clear import error. Unknown runtime fields are rejected; editor extensions belong in the project document. Import is a transaction: validate a clone, present diagnostics, then replace the working draft only after successful parsing and acceptance. Invalid JSON must not corrupt the existing document.

Persist drafts locally with debounced autosave and explicit project JSON download/upload. Store an in-memory undo/redo command history of at least 100 operations. A multi-event edit or accepted AI proposal is one undoable transaction. Recalculate derived crossings and diagnostics after each edit. Preserve stable IDs while editing; duplicate creates new IDs and rewrites references.

## 6. Validation pipeline

Run checks in this order. Every issue has severity, code, object IDs and a human-readable explanation. Reports state which checks actually ran.

### Stage A — structure

Parse JSON and enforce size/count limits before simulation. Initial v1 limits: at most 12 lanes, 8 signal groups, 64 lane-to-lane crossings, 500 spawn events and a 120-second deadline. The game prototype only needs its supplied smaller packs; these are authoring guardrails, not a promise of solver performance. Validate types, finite values, required fields, ID uniqueness and valid references.

### Stage B — geometry and objectives

Validate axis alignment, boundary endpoints (interior endpoints only on route lanes), nonzero lengths, legal speed and dimensions, valid stop positions, grouped alignment, distinct same-lane signal boundaries, route connectivity and ordered, non-overlapping reference windows. Reject uncontrolled/uncontrolled crossing pairs in v1. Verify that every required lane has at least one signal, event types exist, event order is canonical, events are in range, and requiredCount equals actual required events (or, with a required repeat tail, lies between 1 and the scheduled required vehicles).

Required vehicles must have a theoretical unimpeded exit before the deadline. This lower-bound test can prove a level impossible; passing it does not prove solvability. Warn when queues could fill the storage between crossings, the player cannot see an approaching car early enough, or hit targets crowd the game view.

### Stage C — deterministic replay

Run the supplied or newly recorded solution in the game's own headless simulation. A report includes required exits, collisions, final time, pending entry requests, maximum stationary queues, crossing blockage and command counts. Also run all-red and all-green policies. All-red winning is an objective-design error for this game. All-red ending in a timeout or a queue overflow is fine. All-green winning is allowed only for an explicitly designated tutorial.

For imported shipped fixtures, compare against the committed `level-validation.json` (pack SHA-256 plus engine hash) only when the content hash and rules/engine assumptions match. A stale report is displayed as stale, not as a pass.

### Stage D — solution search

If there is no winning replay, offer bounded automated search. Failure to find a solution means **“No solution found within the search budget”**, not “Impossible.” Only a specific proven contradiction, such as an unreachable deadline lower bound, warrants an impossibility claim.

A winning search result must be replayed from tick zero by the full engine before it is labeled model-solvable. Do not accept an AI claim of solvability or a collision-free analytic estimate in place of this replay.

### Stage E — robustness and human review

Perturb replay input times by configured ±0.10/±0.20-second offsets and test selected combinations. Report tested cases, pass fraction, deadline slack and the smallest observed safe timing window. This is a measured sample, not a proof of all possible disturbances.

The designer plays at normal speed, checks that upcoming traffic is visible, verifies the lesson and labels the result human-reviewed. No automatic “fun score.” Display progression as a bundle of metrics plus reviewer notes.

Suggested issue codes: `UNKNOWN_REFERENCE`, `OVERLAPPING_LANES`, `STOP_INSIDE_CONFLICT`, `GROUP_MISALIGNED`, `UNCONTROLLED_CONFLICT`, `REQUIRED_COUNT_MISMATCH`, `UNREACHABLE_DEADLINE`, `POSSIBLE_SPILLBACK`, `REPLAY_COLLISION`, `SEARCH_INCONCLUSIVE`, `NARROW_INPUT_WINDOW`, `STALE_REPORT`.

## 7. Search and analysis design

### 7.1 First useful solver

For the shipped seven-level scope, use known reference replay validation first. Add a bounded beam search or best-first search in a Web Worker as the first general search capability. This shares serializable states and the exact engine step function with ordinary play.

Search at 0.1-second decision intervals, which correspond to 12 physics ticks. Keep 120 Hz physics throughout. Consider keeping the current signal mask and changing selected signal states. Up to four signals have at most 16 masks; for larger levels, restrict candidate masks and report that the search is incomplete. Favor state changes near predicted vehicle arrivals and discourage unnecessary toggles. Retain a broader search mode when those heuristics fail.

A starting budget might be 20,000 expanded states with a visible 10-second interactive time budget, whichever ends first. Run cooperatively in the worker and support cancellation. Budgets are configuration values and must be benchmarked; they are not guaranteed response times. Return best progress plus an explicit inconclusive status on exhaustion.

Reject collisions immediately. Track progress, deadline remaining, total required waiting time, exposed crossing queues and signal changes. Avoid pruning solely by completed exits, because getting vehicles into safe intermediate positions can be necessary. State deduplication must account for positions, spawned/pending events, signals and per-car committed stop boundaries. Approximate hashing/pruning makes the search incomplete and must be recorded in the report. Never let quantized search state replace the exact replay state used for final verification.

After finding a solution, simplify redundant commands and replay again. Prefer solutions with fewer toggles and longer usable windows. Event-time reasoning can speed search, but all accepted results must pass full-engine replay.

### 7.2 Metrics for design and progression

| Metric | Meaning and limit |
| --- | --- |
| Independent signal groups | Attention/interaction load; grouped lanes count as one control |
| Crossings per required route | Need for downstream planning |
| Number and shape of traffic pulses | Pattern-recognition load; raw event count alone is insufficient |
| Minimum sampled input margin | Timing sensitivity around the tested replay |
| Toggle count in the reference | A property of this solution, not a proven minimum |
| Max stationary queue and pending entries | Queue pressure under this replay |
| Crossing blockage | Whether queued vehicles occupy a conflict envelope |
| Completion slack | Deadline minus last required exit under this replay |
| Bus count and speed contrast | Clearance and arrival-reading complexity |
| Simultaneous demands | Overlapping short decision windows across signals |

Use plain difficulty labels—tutorial, easy, medium, hard—as designer annotations supported by these metrics. A four-light map can be harder than a faster one-light map. Keep geometry and timing metrics separately visible so adjustments are explainable.

## 8. Optional AI assistance

### 8.1 Supported requests

- **Create from a brief:** “Make a medium level with two crossings and one unstoppable horizontal stream.”
- **Generate variants:** preserve the road map, propose three different timing patterns.
- **Repair:** make a narrow solution more forgiving without removing a crossing.
- **Explain:** identify the likely bottleneck using actual validation/replay evidence.
- **Tune progression:** suggest a smaller change between two levels with very different interaction loads.

A non-AI template generator must remain available. Templates: single controlled crossing, two crossings on one route, two controlled approaches, two-route grid, and grouped parallel lanes. Parameterized templates expand to explicit, reproducible level data. AI can select and tune templates before attempting arbitrary geometry.

### 8.2 Brief and constraints

Collect a compact structured brief alongside free text:

| Field | Example |
| --- | --- |
| Intended lesson | Downstream planning |
| Difficulty target | Medium |
| Maximum controls/crossings | 2 signals / 2 crossings |
| Required traffic | 8–10 vehicles |
| Ambient behavior | Periodic pairs, fixed schedule |
| Vehicle types | Cars only |
| Duration target | 25–35 seconds |
| Locked elements | Keep road geometry and signal B |
| Allowed changes | Spawn timing and deadline only |

Missing fields use visible defaults from the selected template. A prompt is not enough to infer every constraint silently; show the brief before running generation. Preserve the designer's explicitly locked objects and fields. “Make it harder” must produce a visible explanation of which measurable demands changed.

### 8.3 Candidate generation pipeline

1. Snapshot the current document revision and runtime pack.
2. Construct a request containing the schema, brief, permitted operations, relevant current level, known issue IDs and measured replay results. Include only relevant examples, not an unbounded history.
3. Obtain a structured candidate. Prefer template parameters or a typed change set for repair; full level objects are allowed for new levels.
4. Parse and validate without executing code. Reject changes outside scope or to locked fields. AI-generated text cannot set a validated/approved flag.
5. Apply the candidate to an isolated clone and run the validation stages. A repair result is compared with the original using the same rules and metrics.
6. If search/replay fails, feed back concrete errors and bounded metrics for at most three proposal/repair rounds. Respect the global cancellation/time/token budget. Do not loop indefinitely.
7. Return the best candidates, with failure or inconclusive states visible. Show map preview, changed fields, objective, metrics, replay result and proposed lesson.
8. Accept is an explicit undoable editor action. Export remains a separate normal action. Never replace the draft merely because the provider returned a response.

AI does not control cars while a player is playing. It acts during authoring. Any suggested reference schedule must pass the actual engine, including long-vehicle geometry and queue effects.

### 8.4 AI adapter contract

Use an interchangeable provider adapter. Example request fields: `requestId`, `documentRevision`, `mode`, `brief`, `lockedFields`, `allowedOperations`, `runtimePack`, `validationEvidence`, `schemaVersion`. Supported modes: `create`, `variant`, `repair`, `explain`.

Example repair proposal, as an editor-only domain change set:

```json
{
  "baseRevision": 17,
  "mode": "repair",
  "summary": "Increase the second pulse spacing while preserving the map.",
  "operations": [
    {"op": "setSpawnTime", "laneId": "V", "eventId": "V-05", "at": 8.2},
    {"op": "setDeadline", "seconds": 34}
  ],
  "claimsToCheck": ["A wider second release window"]
}
```

Editor-only operations include add/move/delete lane, add/change/delete signal, add/move/delete event, setEventType, setStreamRole and setDeadline. Validate each operation against a typed schema, known IDs and lock constraints. Never use `eval`, accept executable snippets or interpret model text as commands. If the working revision has changed since generation began, mark the proposal stale and request a rebase/regeneration; do not apply old array positions to a new document.

“Explain” responses must distinguish observed facts from suggestions. For example, “The replay collides at crossing J2 at tick 1480” is allowed only if that evidence exists. “Try moving the second pulse” is a proposal whose effect still needs validation.

### 8.5 Deployment and failure behavior

The manual editor and validator run locally in the browser and work without an AI connection. A live AI provider can be attached later through a small server/proxy that keeps provider secrets outside frontend code and exported files. If no such service is configured, show a disabled connection state and allow copy/export of a structured request for use in another AI tool.

Show request progress, allow cancellation, and cap retries. Network errors or malformed responses leave the current document untouched. Do not promise generation cost or timing until a provider is chosen and measured. Store the accepted proposal's provenance locally in the editor project, not secrets or full provider credentials.

## 9. Export gates and status model

Use separate badges rather than a single misleading green check:

- **Draft:** edited but unchecked.
- **Structurally valid:** schema and semantic checks pass.
- **Model-solvable:** a winning replay has been verified against this exact pack hash and engine version.
- **Robustness sampled:** specified perturbation cases have run, with their results visible.
- **Human-reviewed:** named review notes/date exist for this revision.
- **Stale:** a change invalidated any previously applicable badge.

Allow export of a structurally valid draft for debugging with a visible warning that solvability is unverified. A **Release pack** action requires a verified winning replay for every level and an explicit designer review state. Attach reports to the editor project; the runtime only needs the pack. The generated referenceSolution status text is informational; validation badges derive from local evidence, never that field alone.

Changing any gameplay-relevant field invalidates replay and robustness evidence. A text-only title change also changes the byte hash; conservatively invalidate in v1 rather than inventing a semantic hash system. Moving an editor-only panel does not affect runtime hashes.

## 10. Acceptance criteria and milestones

### Manual editor acceptance

- Import and round-trip all seven fixtures (including the routed roundabout, `repeat` tails and queue limits) with identical runtime meaning and winning reference outcomes.
- Create a seventh level without editing JSON by hand; save, reopen and play it.
- Add/remove/reposition signals and change spawn schedules with complete undo/redo.
- Explain invalid crossings, counts or stop lines without losing the working draft.
- Record a winning manual attempt, convert it to windows, export, then replay the export successfully.
- Show both requested and actual admission times for a deliberately blocked entry.
- Scrub a replay backward/forward and restore commitments, pending events and counts exactly.

### Analysis acceptance

- Use the exact game engine in preview, replay and validation workers.
- Reproduce the seven fixture outcomes; show invalidation after a traffic edit.
- Label search budget exhaustion as inconclusive.
- Detect the all-red counting exploit in a deliberately broken objective configuration.
- Display vehicle-level collision evidence and a measured timing-tolerance report.

### AI acceptance

- Create three candidate drafts from a brief and show their individual validation states.
- Respect locked geometry during a timing-only repair.
- Reject unknown fields, invalid IDs, executable text, out-of-scope edits and stale revisions.
- Keep the draft unchanged on cancellation, timeout or malformed output.
- Accept a candidate as one undoable action, then run and export it through the same normal pipeline.
- Produce no “solvable” or “reviewed” label based solely on model-generated claims.

| Milestone | Scope | Dependency |
| --- | --- | --- |
| E1 | Shared schema/engine package and import/export | Game simulation stable |
| E2 | Geometry, signals, schedule timeline, undo/autosave | E1 |
| E3 | Playtest, recording, scrubbing and diagnostics | E2 |
| E4 | Replay reports, bounded search and robustness sampling | E3 |
| E5 | Template generation and provider-independent AI adapter | E4 |
| E6 | Constrained AI proposals, repair loop and candidate comparison | E5 |

Keep the first release focused on authoring the existing game rules. Arbitrary road networks, turning routes, traffic-light phase programming, real-world traffic simulation, community publishing and collaborative editing are separate products or later extensions.
