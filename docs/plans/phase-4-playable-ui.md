# Phase 4 — Playable UI

Spec: §3 (flow/interface), §2 presentation. Milestone exit: "Every level can be played/retried without developer tools".

## Deliverables

- `game-proto/index.html` + `styles.css` + `src/main.js` — ES modules, Canvas 2D, no build step.
- `src/render.js` — fixed 1200×800 world, uniform scale + letterbox, HUD outside the world rect;
  dark roads, direction arrows, high-contrast front-bumper stop lines at `stopS`, signal heads with
  letter label AND red/green text (not color alone), roof diamond on required vehicles,
  "NO SIGNAL" entry labels on ambient streams, waiting-queue badges at entries, collision highlight,
  timeout highlight of required traffic still waiting.
- `src/input.js` — pointer positions transformed through the inverse world transform; every signal
  gets ≥48×48 CSS-px hit target (on-canvas heads sized `max(worldR, 24/scale)` plus always-available
  HTML A–D buttons; grouped signals share one head with callout lines to each stop line).
  Keys: 1–4 toggle signals, P/Escape pause, R retry while paused/after result. No movement keys.
- `src/ui.js` — level select (all six, localStorage check marks), frozen-map preview with objective /
  deadline / lesson / tutorial, 3-2-1 countdown outside simulation time, HUD (level, `Required: x/y`,
  time remaining, total throughput, pause, audio toggle, diamond legend), pause overlay
  (resume/retry/select), result overlays (win: time used, cleared, Next/Retry/Select; collision: frozen
  + highlighted pair, Retry/Select; timeout: waiting required highlighted; campaign completion after L6).
- Pause semantics: freezes vehicles and timer (sim time = tick count), signal input ignored while
  paused, `visibilitychange` auto-pauses with deliberate resume.
- Fixed-step loop: 120 Hz accumulator; if the app falls >0.25 s behind it pauses with a performance
  message instead of silently skipping sim time. No render interpolation of sim state.
- `src/audio.js` — minimal WebAudio click/collision/win sounds with persisted toggle.

## Exit criteria

- Browser smoke test (automated via headless browser): page loads with no console errors, level select
  shows 6 levels, preview → countdown → play L1, click signal A (canvas and HTML button), keys 1–4/P/R
  work, win screen appears on L1 with the reference schedule driven by scripted clicks, retry and
  next-level flows work, completion check mark persists across reload.
- Touch: tap targets ≥48 CSS px (HTML buttons + enlarged canvas heads).
