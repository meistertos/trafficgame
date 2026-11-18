// Boot + game loop. Fixed 120 Hz simulation independent of rendering (spec §4.3);
// pause freezes vehicles and timer; hidden tab auto-pauses; big lag triggers a perf pause.
import { loadPack, prepareLevel } from './data.js';
import { createState, queueCommand, step, signalState, runToEnd } from './sim.js';
import { TICK_RATE } from './constants.js';
import { computeView, drawWorld, drawPreview, signalLayout } from './render.js';
import { attachPointer, attachKeys } from './input.js';
import * as ui from './ui.js';
import { audio } from './audio.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');

const COMPLETED_KEY = 'mindthegap.completed';
const loadCompleted = () => { try { return JSON.parse(localStorage.getItem(COMPLETED_KEY) ?? '{}'); } catch { return {}; } };
const saveCompleted = (c) => { try { localStorage.setItem(COMPLETED_KEY, JSON.stringify(c)); } catch { /* ignore */ } };

const { pack, errors, ok } = await loadPack('traffic-levels.json');
if (!ok) { ui.showError(errors); throw new Error('invalid level pack: ' + errors.join('; ')); }

const levels = pack.levels;
const preppedById = new Map(levels.map((l) => [l.id, prepareLevel(l, pack.rules)]));
const completed = loadCompleted();

let mode = 'select'; // select | preview | countdown | playing | paused | result
let levelIndex = 0;
let prepped = null;
let state = null;
let view = null;
let acc = 0;
let last = 0;
let pauseOpts = null;

function resize() {
  const r = stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  view = computeView(canvas);
}
window.addEventListener('resize', resize);
resize();

function currentLevel() { return levels[levelIndex]; }

function pickLevel(i) {
  levelIndex = i;
  prepped = preppedById.get(currentLevel().id);
  mode = 'preview';
  ui.buildSignalButtons(prepped.signals.map((s) => s.id), toggleSignal);
  ui.setSignalButtonsEnabled(false);
  drawPreview(ctx, view, prepped);
  ui.updateHud(currentLevel(), null, mode);
  ui.showPreview(currentLevel(), beginCountdown);
}

function beginCountdown() {
  mode = 'countdown';
  ui.showCountdown(3, () => {
    state = createState(prepped);
    acc = 0;
    last = performance.now();
    mode = 'playing';
    ui.hideOverlay();
    ui.setSignalButtonsEnabled(true);
    // the tab was hidden while counting down: start frozen and wait for a deliberate resume
    if (document.hidden) pause(true, false);
  });
  audio.countdown(false);
}

function toggleSignal(id) {
  if (mode !== 'playing' || !state) return;
  const cur = signalState(state, id);
  queueCommand(state, id, cur === 'green' ? 'red' : 'green');
  audio.click();
}

function pause(auto = false, perf = false) {
  if (mode !== 'playing') return;
  mode = 'paused';
  pauseOpts = { auto, perf };
  ui.setSignalButtonsEnabled(false);
  ui.showPause({
    auto, perf,
    onResume: resume,
    onRetry: retry,
    onSelect: showSelect,
  });
}

function resume() {
  if (mode !== 'paused') return;
  mode = 'playing';
  ui.hideOverlay();
  ui.setSignalButtonsEnabled(true);
  acc = 0;
  last = performance.now();
}

function retry() {
  ui.hideOverlay();
  beginCountdown();
}

function showSelect() {
  mode = 'select';
  state = null;
  ui.hideOverlay();
  ui.setSignalButtonsEnabled(false);
  ui.updateHud(null, null, mode);
  ui.showLevelSelect(levels, completed, pickLevel);
}

function nextLevel() {
  if (levelIndex + 1 < levels.length) pickLevel(levelIndex + 1);
  else showSelect();
}

function onOutcome() {
  const o = state.outcome;
  mode = 'result';
  ui.setSignalButtonsEnabled(false);
  if (o.type === 'collision' || o.type === 'overflow') audio.collision();
  if (o.type === 'win') {
    audio.win();
    completed[currentLevel().id] = true;
    saveCompleted(completed);
  }
  const waitingReq = [];
  if (o.type === 'timeout') {
    for (const lane of state.lanes) {
      for (const v of lane.vehicles) if (v.required) waitingReq.push(v.id);
      for (const e of lane.queue) if (e.required) waitingReq.push('q:' + e.id);
    }
  }
  ui.showResult({
    kind: o.type,
    lane: o.lane,
    limit: o.limit,
    level: currentLevel(),
    levelCount: levels.length,
    timeUsed: o.time ?? 0,
    cleared: state.requiredCleared,
    target: state.requiredTarget,
    throughput: state.totalExited,
    isLast: levelIndex === levels.length - 1,
    campaignDone: o.type === 'win' && levelIndex === levels.length - 1,
    onNext: nextLevel,
    onRetry: retry,
    onSelect: showSelect,
  });
  render(waitingReq);
}

function render(waitingReqOverride) {
  if (!prepped) return;
  let collisionVehicles = [];
  let waitingReq = waitingReqOverride ?? [];
  if (state?.outcome?.type === 'collision') collisionVehicles = state.outcome.vehicles;
  if (state?.outcome?.type === 'timeout' && !waitingReqOverride) {
    for (const lane of state.lanes) {
      for (const v of lane.vehicles) if (v.required) waitingReq.push(v.id);
    }
  }
  drawWorld(ctx, view, prepped, state, { collisionVehicles, waitingRequiredIds: new Set(waitingReq) });
  ui.updateSignalButtons(state);
  ui.updateHud(currentLevel(), state, mode);
}

const STEP = 1 / TICK_RATE;
const MAX_STEPS_PER_FRAME = 60; // 0.5 s of simulation per rendered frame
const MAX_BACKLOG = 0.25; // seconds of unsimulated wall time tolerated before a performance pause
function frame(now) {
  const dt = Math.max(0, (now - last) / 1000);
  last = now;
  if (mode === 'playing' && state) {
    acc += dt;
    let n = 0;
    const limit = prepped.deadlineTicks;
    while (acc >= STEP && n < MAX_STEPS_PER_FRAME && !state.outcome && state.tick <= limit) {
      step(state);
      acc -= STEP;
      n++;
    }
    if (!state.outcome && state.tick > limit) {
      // deadline reached without a win (completion on the deadline tick itself is allowed)
      state.outcome = { type: 'timeout', tick: limit, time: limit / TICK_RATE };
    }
    if (state.outcome) {
      onOutcome();
    } else if (acc > MAX_BACKLOG) {
      // cannot catch up safely: pause with a message instead of silently skipping or
      // fast-forwarding simulation time (spec §4.3). Nothing is lost: the sim is exactly where it was.
      acc = 0;
      pause(false, true);
    }
  }
  render();
  requestAnimationFrame(frame);
}

attachPointer(canvas, () => view, () => signalLayout(prepped, view), (id) => toggleSignal(id));
attachKeys(() => (prepped ? prepped.signals.map((s) => s.id) : []), {
  onSignal: toggleSignal,
  onPauseToggle: () => { if (mode === 'playing') pause(); else if (mode === 'paused') resume(); },
  onRetry: () => { if (mode === 'paused' || mode === 'result') retry(); },
});
document.getElementById('btn-pause').addEventListener('click', () => {
  if (mode === 'playing') pause(); else if (mode === 'paused') resume();
});
const audioBtn = document.getElementById('btn-audio');
audioBtn.textContent = `Sound: ${audio.enabled ? 'on' : 'off'}`;
audioBtn.setAttribute('aria-pressed', String(audio.enabled));
audioBtn.addEventListener('click', () => {
  const on = audio.toggle();
  audioBtn.textContent = `Sound: ${on ? 'on' : 'off'}`;
  audioBtn.setAttribute('aria-pressed', String(on));
  if (on) audio.click();
});
document.getElementById('btn-select').addEventListener('click', showSelect);

document.addEventListener('visibilitychange', () => {
  if (document.hidden && mode === 'playing') pause(true, false);
});

showSelect();
requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
