# Mind the Gap — Phaser 4 game

The playable game, built on [Phaser 4](https://phaser.io) (4.2.1, WebGL) with Vite.

It does **not** contain its own traffic rules. The simulation, level loader/validator and level pack
are imported from `../game-proto` (Vite aliases `@engine` → `game-proto/src`, `@proto` → `game-proto`),
so `game-proto/tools/headless-validation.mjs` tests exactly the engine this game runs (spec §6).

## Run

```
cd game
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/ (relative paths; any static host)
npm run validate   # headless engine checks + parity report (same engine)
```

## Structure

| File | Role |
| --- | --- |
| `src/main.js` | Phaser config: FIT scaling with letterboxing, internal resolution `RES` (≤ 2×) |
| `src/config.js` | 1200×800 world + 120-unit HUD bar above it, colors, fonts |
| `src/pack.js` | Loads the exact `traffic-levels.json` bytes via `parsePack`/`prepareLevel` |
| `src/scenes/BootScene.js` | Validates the pack (shows errors instead of playing), generates vehicle textures |
| `src/scenes/SelectScene.js` | Level grid with local ✓ marks; keys 1–7 |
| `src/scenes/PlayScene.js` | Preview → countdown → play → pause/result; fixed 120 Hz stepping, perf pause, hidden-tab pause |
| `src/map.js` | Static map (roads, arrows, stop lines, roundabout, NO SIGNAL), signal heads, queue badges |
| `src/vehicles.js` | Vehicle sprites synced from engine state; tinted generated textures |
| `src/ui.js`, `audio.js`, `storage.js` | Buttons/text, synthesized sounds, local persistence |

## Controls

Tap a signal head on the map or an A–D button in the HUD, or keys 1–4. P/Esc pause, R retry (paused or after a result), Enter starts from the preview.
Signal heads keep a ≥ 48 CSS-px hit circle at any display size.

Hidden test hooks (not in the HUD): `?ref=1` plays the level's reference windows automatically, `?debug` exposes `window.__game`.
