# Mind the Gap — browser prototype

Playable prototype per `docs/specs/traffic-prototype-spec.md`. Plain JS ES modules + Canvas 2D, no build step.

## Run

```
cd game-proto
python3 -m http.server 8080
# open http://localhost:8080/
```

(any static file server works; ES modules require http, not file://)

## Controls

- Click a signal head on the map, or the A–D buttons in the HUD, or keys 1–4: toggle red/green.
- Queue overflow: each entry holds a limited number of waiting cars (`⏳n/limit`); a full queue ends the run.
- P / Escape: pause · R: retry (while paused or after a result) · Level select: always available.
- ◆ diamond on a roof = required car (counts when its rear leaves the map). "NO SIGNAL" = unstoppable ambient traffic.

## Engine validation (headless, no browser)

```
node tools/headless-validation.mjs           # runs all spec §7 engine checks, writes level-validation.json
node tools/headless-validation.mjs --accept  # replace the parity baseline after investigating a divergence
node tools/author-references.mjs --write  # re-derive referenceSolution windows (authoring only)
```

`src/sim.js` is DOM-free and shared by the game and the validators.
