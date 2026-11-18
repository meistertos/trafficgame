# Coupled traffic lights as a level-design element

_Written 2026-11-19 · planned for implementation 2026-11-20._

## Idea

Test **coupled traffic lights** as a level-design element: a signal whose state is linked to another signal, so that one toggle changes more than one light. This would give us a new kind of puzzle beyond "toggle each light independently".

## Conflicts with the current spec

`docs/specs/traffic-prototype-spec.md` currently says the opposite:

> Independence | Each signal is independent; no automatic cross-light switching or safety interlock

So this is a **spec change**, not only new level content. Update the spec (and bump its version) together with the implementation.

It is also different from what already exists:
- **Grouped lanes** are already supported: one signal ID controls several parallel lanes that share a stop line (L6). That is one light covering several lanes, not two lights linked together.

## Variants to try

1. **Inverse pair (interlock):** A and B are always opposite. Making A green makes B red, and the other way round. This is the classic crossroads phasing, and it can never cause a crossing collision between A and B.
2. **Mirror pair:** A and B always show the same state. One tap releases two approaches at once, which helps throughput but can collide.
3. **Delayed coupling:** B follows A after a fixed delay, for example 1.5 s. This tests timing rather than reaction.
4. **Partial coupling:** only one direction is coupled. For example, "A → green forces B → red", but B can be toggled freely.

Start with 1 and 2, which are the simplest and the most readable.

## Questions to settle before implementing

- **Data model:** where does the coupling live? Options are a `couplings` array on the level (`{ a, b, mode: 'inverse' | 'mirror', delay? }`) or a field on the signal.
- **Engine:** must stay deterministic. Coupled changes should go through the existing command queue on the same tick, or after `delay` ticks for variant 3, so the headless validation and reference solutions still work.
- **Validator:** new issue codes for couplings that refer to unknown signals, a signal coupled to itself, or contradictory cycles (A mirror B, B inverse C, C mirror A).
- **Input:** does tapping B do anything when it is coupled? Decide per variant. For the inverse pair, tapping either light should flip the pair.
- **Visuals (minimal design):** show the link on the map, for example a thin connector between the two stations, or the two stations sharing a colour or shape. In the top bar, show the coupled buttons as one joined control.
- **Level design:** which existing level becomes a better puzzle with coupling, and do we need a new tutorial level that introduces it?
- **Editor spec:** add coupling to `docs/specs/level-creation-tool-spec.md` (signal groups panel and validation).

## Done when

- At least one test level uses coupled lights and has a reference solution that wins.
- Headless validation still passes, plus new checks for the coupling.
- The coupling is visible and understandable in both day and night themes.
