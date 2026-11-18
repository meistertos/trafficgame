// One level: frozen preview → 3-2-1 countdown → play → pause/result (spec §3).
// The simulation is the shared DOM-free engine stepped at a fixed 120 Hz, independent of Phaser's
// frame rate (spec §4.3). Rendering only reads engine state.
import * as Phaser from 'phaser';
import { createState, queueCommand, step, signalState, windowsToCommands } from '@engine/sim.js';
import { TICK_RATE } from '@engine/constants.js';
import { getPack, objectiveText } from '../pack.js';
import { markCompleted } from '../storage.js';
import { audio } from '../audio.js';
import { setupCamera } from './common.js';
import { text, button, roundedPanel, station, fillDiamond } from '../ui.js';
import { drawStaticMap, signalLayout, SignalHead, QueueBadges } from '../map.js';
import { VehicleLayer } from '../vehicles.js';
import { GAME_W, HUD_H, WORLD_W, WORLD_H, COLORS, CSS, MIN_TARGET_CSS_PX, THEME, toggleTheme } from '../config.js';

const STEP = 1 / TICK_RATE;
const MAX_STEPS_PER_FRAME = 60; // at most 0.5 s of simulation per rendered frame
const MAX_BACKLOG = 0.25; // unsimulated wall time tolerated before a performance pause

export class PlayScene extends Phaser.Scene {
  constructor() { super('play'); }

  init(data) {
    const pack = getPack();
    this.index = data.index ?? 0;
    this.levels = pack.levels;
    this.level = pack.levels[this.index];
    this.prepped = pack.prepped[this.index];
    this.mode = 'preview';
    this.sim = null;
    this.acc = 0;
    this.last = 0;
    this.cdToken = 0;
    this.highlight = { collision: new Set(), waiting: new Set() };
    // hidden test hook (not in the HUD, spec §7): ?ref=1 drives the level's reference windows
    this.autoRef = new URLSearchParams(window.location.search).has('ref');
  }

  create() {
    setupCamera(this);
    this.world = this.add.container(0, HUD_H);
    drawStaticMap(this, this.world, this.prepped);
    this.vehicles = new VehicleLayer(this, this.world);
    this.badges = new QueueBadges(this, this.world, this.prepped);
    this.heads = signalLayout(this.prepped).map((lay) => new SignalHead(this, this.world, lay, (id) => this.toggleSignal(id)));
    this.buildHud();
    this.overlay = this.add.container(0, 0).setDepth(100);

    this.input.keyboard.on('keydown', (e) => this.onKey(e));
    const onHidden = () => { if (this.mode === 'playing') this.pause({ auto: true }); };
    this.game.events.on(Phaser.Core.Events.HIDDEN, onHidden);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.game.events.off(Phaser.Core.Events.HIDDEN, onHidden));

    this.updateTargets();
    this.refresh();
    this.showPreview();
  }

  // ---------- HUD (outside the world rectangle) ----------
  buildHud() {
    const g = this.add.graphics();
    g.fillStyle(COLORS.paper, 1);
    g.fillRect(0, 0, GAME_W, HUD_H);
    g.fillStyle(COLORS.faint, 1);
    g.fillRect(40, HUD_H - 2, GAME_W - 80, 2);

    text(this, 40, 26, `LEVEL ${this.index + 1} / ${this.levels.length}`, { size: 11, weight: 'bold', color: CSS.muted, origin: [0, 0.5], letterSpacing: 2 });
    this.hudTitle = text(this, 40, 56, this.level.title, { size: 26, weight: 'bold', origin: [0, 0.5] });
    text(this, 40, 94, '1–4 toggle  ·  P pause  ·  R retry  ·  N night', { size: 12, color: CSS.muted, origin: [0, 0.5] });

    // required counter: ◆ n / N, with throughput underneath
    const ig = this.add.graphics();
    ig.fillStyle(COLORS.ink, 1);
    fillDiamond(ig, 352, 52, 9);
    this.hudRequired = text(this, 370, 52, '', { size: 26, weight: 'bold', origin: [0, 0.5] });
    this.hudThrough = text(this, 344, 86, '', { size: 12, color: CSS.muted, origin: [0, 0.5] });

    // clock: a ring that empties as the deadline approaches
    this.clockG = this.add.graphics();
    this.hudTime = text(this, 530, 60, '', { size: 16, weight: 'bold', origin: 0.5 });

    // signal stations duplicating the map heads: always usable on small screens (spec §3)
    this.sigButtons = this.prepped.signals.map((s, i) => ({ id: s.id, b: this.hudSignal(650 + i * 84, 52, s.id), green: null }));

    this.pauseBtn = button(this, 1000, 40, 120, 44, 'Pause', () => this.togglePause(), { size: 15 });
    this.menuBtn = button(this, 1120, 40, 100, 44, 'Levels', () => this.toSelect(), { size: 15 });
    this.themeBtn = button(this, 1120, 94, 100, 32, THEME === 'day' ? 'Night' : 'Day', () => this.swapTheme(), { size: 13 });
    this.audioBtn = button(this, 1000, 94, 120, 32, `Sound ${audio.enabled ? 'on' : 'off'}`, () => {
      const on = audio.toggle();
      this.audioBtn.setLabel(`Sound ${on ? 'on' : 'off'}`);
      if (on) audio.click();
    }, { size: 13 });
  }

  hudSignal(x, y, id) {
    const c = this.add.container(x, y);
    const g = this.add.graphics();
    const letter = text(this, 0, 0, id, { size: 22, weight: 'bold', origin: 0.5 });
    const sub = text(this, 0, 42, 'RED', { size: 10, weight: 'bold', color: CSS.red, origin: 0.5, letterSpacing: 1.5 });
    c.add([g, letter, sub]);
    c.setSize(76, 104);
    c.setInteractive({ useHandCursor: true });
    const st = { green: false, enabled: true, hover: false };
    const draw = () => {
      g.clear();
      const r = st.hover && st.enabled ? 28 : 26;
      if (st.green) station(g, 0, 0, r, { ring: COLORS.green, fill: COLORS.green });
      else station(g, 0, 0, r, { ring: COLORS.red, fill: COLORS.card, width: 6 });
      letter.setColor(st.green ? CSS.paper : CSS.fg);
      sub.setText(st.green ? 'GREEN' : 'RED').setColor(st.green ? CSS.green : CSS.red);
      c.setAlpha(st.enabled ? 1 : 0.4);
    };
    c.on('pointerover', () => { st.hover = true; draw(); });
    c.on('pointerout', () => { st.hover = false; draw(); });
    c.on('pointerdown', (p, lx, ly, event) => { event?.stopPropagation?.(); if (st.enabled) this.toggleSignal(id); });
    draw();
    return {
      setGreen(on) { st.green = on; draw(); return this; },
      setEnabled(on) { if (st.enabled === !!on) return this; st.enabled = !!on; c.input && (c.input.cursor = on ? 'pointer' : 'default'); draw(); return this; },
    };
  }

  drawClock(remaining, urgent) {
    const g = this.clockG;
    const cx = 530;
    const cy = 60;
    const r = 30;
    const frac = Math.max(0, Math.min(1, remaining / this.level.deadline));
    g.clear();
    g.lineStyle(6, COLORS.faint, 1);
    g.strokeCircle(cx, cy, r);
    if (frac > 0) {
      g.lineStyle(6, urgent ? COLORS.red : COLORS.ink, 1);
      g.beginPath();
      g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2, false);
      g.strokePath();
    }
  }

  refresh() {
    const st = this.sim;
    const cleared = st ? st.requiredCleared : 0;
    this.hudRequired.setText(`${cleared} / ${this.level.requiredCount}`);
    const remaining = Math.max(0, this.level.deadline - (st ? st.tick / TICK_RATE : 0));
    const urgent = remaining <= 5 && !!st;
    const label = remaining.toFixed(remaining < 10 ? 1 : 0);
    if (label !== this.lastClock || urgent !== this.lastUrgent) {
      this.lastClock = label;
      this.lastUrgent = urgent;
      this.hudTime.setText(label).setColor(urgent ? CSS.red : CSS.fg);
    }
    this.drawClock(remaining, urgent);
    this.hudThrough.setText(`${st ? st.totalExited : 0} cars through`);
    const playing = this.mode === 'playing';
    for (const sb of this.sigButtons) {
      const green = st ? signalState(st, sb.id) === 'green' : false;
      if (green !== sb.green) {
        sb.green = green;
        sb.b.setGreen(green);
      }
      sb.b.setEnabled(playing);
    }
    for (const h of this.heads) h.setGreen(st ? signalState(st, h.id) === 'green' : false);
    this.pauseBtn.setEnabled(playing || this.mode === 'paused');
    this.themeBtn.setEnabled(this.canSwapTheme());
    this.pauseBtn.setLabel(this.mode === 'paused' ? 'Resume' : 'Pause');
    this.badges.update(st);
    this.vehicles.sync(st, this.highlight);
  }

  // Signal heads keep >= 48 CSS px targets at any display size (spec §3).
  updateTargets() {
    const cssPerUnit = this.scale.displaySize.width / GAME_W || 1;
    const r = Math.max(18, MIN_TARGET_CSS_PX / 2 / cssPerUnit);
    for (const h of this.heads) h.setRadius(r);
  }

  // ---------- input ----------
  toggleSignal(id) {
    if (this.mode !== 'playing' || !this.sim) return;
    // toggle relative to the latest queued state, so two taps within one tick cancel out
    const pend = this.sim.pending.filter((c) => c.signalId === id).at(-1);
    const cur = pend ? pend.to : signalState(this.sim, id);
    queueCommand(this.sim, id, cur === 'green' ? 'red' : 'green');
    audio.click();
  }

  onKey(e) {
    if (e.repeat) return;
    if (e.key >= '1' && e.key <= '4') {
      const sig = this.prepped.signals[Number(e.key) - 1];
      if (sig) this.toggleSignal(sig.id);
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'n') { this.swapTheme(); return; }
    if (k === 'p' || e.key === 'Escape') this.togglePause();
    else if (k === 'r' && (this.mode === 'paused' || this.mode === 'result')) this.retry();
    else if (e.key === 'Enter' && this.mode === 'preview') this.beginCountdown();
  }

  // ---------- flow ----------
  clearOverlay() {
    this.cdToken++; // any screen change cancels a running countdown
    this.overlay.removeAll(true);
  }

  card(w, h) {
    const cx = WORLD_W / 2;
    const cy = HUD_H + WORLD_H / 2;
    const dim = this.add.rectangle(WORLD_W / 2, HUD_H + WORLD_H / 2, WORLD_W, WORLD_H, COLORS.paper, 0.75);
    dim.setInteractive(); // swallow taps so nothing underneath reacts
    const panel = roundedPanel(this, cx - w / 2, cy - h / 2, w, h, { radius: 16 });
    this.overlay.add([dim, panel]);
    return { x: cx - w / 2, y: cy - h / 2, cx, cy, w, h };
  }

  addButtons(box, specs) {
    const bw = 190;
    const gap = 16;
    const total = specs.length * bw + (specs.length - 1) * gap;
    specs.forEach((s, i) => {
      const b = button(this, box.cx - total / 2 + bw / 2 + i * (bw + gap), box.y + box.h - 52, bw, 60, s.label, s.onClick,
        { kind: s.primary ? 'primary' : 'normal', size: 19 });
      this.overlay.add(b.container);
    });
  }

  showPreview() {
    this.mode = 'preview';
    this.clearOverlay();
    const box = this.card(640, 380);
    const lines = [
      text(this, box.cx, box.y + 36, this.level.title, { size: 30, weight: 'bold', origin: 0.5 }),
      text(this, box.cx, box.y + 74, `Level ${this.index + 1} of ${this.levels.length} · deadline ${this.level.deadline}s`, { size: 16, color: CSS.muted, origin: 0.5 }),
      text(this, box.cx, box.y + 116, `◆  ${objectiveText(this.level)}`, { size: 20, weight: 'bold', color: CSS.fg, origin: 0.5 }),
      text(this, box.cx, box.y + 154, `Lesson: ${this.level.lesson}`, { size: 16, color: CSS.fg, origin: [0.5, 0], align: 'center', wrap: 560 }),
    ];
    if (this.level.tutorial) {
      lines.push(text(this, box.cx, box.y + 214, this.level.tutorial, { size: 16, color: CSS.muted, origin: [0.5, 0], align: 'center', wrap: 560 }));
    }
    this.overlay.add(lines);
    this.addButtons(box, [
      { label: 'Start', primary: true, onClick: () => this.beginCountdown() },
      { label: 'Levels', onClick: () => this.toSelect() },
    ]);
    this.refresh();
  }

  beginCountdown() {
    this.clearOverlay();
    this.mode = 'countdown';
    this.sim = null;
    this.highlight = { collision: new Set(), waiting: new Set() };
    this.vehicles.clear();
    const token = this.cdToken;
    const box = this.card(220, 200);
    const big = text(this, box.cx, box.cy, '3', { size: 96, weight: 'bold', origin: 0.5 });
    this.overlay.add(big);
    const seq = ['3', '2', '1', 'GO'];
    seq.forEach((label, i) => {
      this.time.delayedCall(i * 650, () => {
        if (token !== this.cdToken) return;
        big.setText(label);
        audio.countdown(label === 'GO');
      });
    });
    this.time.delayedCall(seq.length * 650, () => {
      if (token !== this.cdToken) return;
      this.startRun();
    });
    this.refresh();
  }

  startRun() {
    this.clearOverlay();
    this.sim = createState(this.prepped);
    if (this.autoRef) for (const c of windowsToCommands(this.prepped)) queueCommand(this.sim, c.signalId, c.to, c.tick);
    this.acc = 0;
    this.last = performance.now();
    this.mode = 'playing';
    // the tab was hidden during the countdown: start frozen and wait for a deliberate resume
    if (document.hidden) this.pause({ auto: true });
    this.refresh();
  }

  togglePause() {
    if (this.mode === 'playing') this.pause();
    else if (this.mode === 'paused') this.resume();
  }

  pause({ auto = false, perf = false } = {}) {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.clearOverlay();
    const box = this.card(560, 300);
    const msg = auto ? 'The tab was hidden, so the game paused automatically.'
      : perf ? 'Paused for performance: the app could not keep up with real time.' : '';
    this.overlay.add([
      text(this, box.cx, box.y + 44, 'Paused', { size: 32, weight: 'bold', origin: 0.5 }),
      text(this, box.cx, box.y + 104, `${msg}${msg ? '\n' : ''}Vehicles and timer are frozen. Lights cannot change while paused.`,
        { size: 16, color: CSS.muted, origin: [0.5, 0], align: 'center', wrap: 500 }),
    ]);
    this.addButtons(box, [
      { label: 'Resume', primary: true, onClick: () => this.resume() },
      { label: 'Retry (R)', onClick: () => this.retry() },
      { label: 'Levels', onClick: () => this.toSelect() },
    ]);
    this.refresh();
  }

  resume() {
    if (this.mode !== 'paused') return;
    this.clearOverlay();
    this.mode = 'playing';
    this.acc = 0;
    this.last = performance.now();
    this.refresh();
  }

  retry() { this.beginCountdown(); }

  // Swapping redraws the whole scene, so it is only offered when no run is in progress.
  canSwapTheme() { return this.mode === 'preview' || this.mode === 'result'; }

  swapTheme() {
    if (!this.canSwapTheme()) return;
    toggleTheme();
    this.scene.restart({ index: this.index });
  }

  toSelect(data = {}) { this.clearOverlay(); this.scene.start('select', data); }

  next() {
    if (this.index + 1 < this.levels.length) this.scene.restart({ index: this.index + 1 });
    else this.toSelect({ campaignDone: true });
  }

  onOutcome() {
    const o = this.sim.outcome;
    this.mode = 'result';
    if (o.type === 'collision') {
      this.highlight.collision = new Set(o.vehicles);
      audio.collision();
    } else if (o.type === 'overflow') {
      audio.collision();
    } else if (o.type === 'timeout') {
      for (const lane of this.sim.lanes) for (const v of lane.vehicles) if (v.required) this.highlight.waiting.add(v.id);
    } else if (o.type === 'win') {
      audio.win();
      markCompleted(this.level.id);
    }
    this.showResult(o);
  }

  showResult(o) {
    this.clearOverlay();
    const last = this.index === this.levels.length - 1;
    const box = this.card(600, 300);
    const t = (o.time ?? 0).toFixed(2);
    let title;
    let body;
    let color = CSS.fg;
    if (o.type === 'win') {
      title = 'Level complete';
      color = CSS.green;
      body = `${last ? `Campaign complete! All ${this.levels.length} levels cleared.\n` : ''}Time used: ${t}s of ${this.level.deadline}s\n` +
        `Required cleared: ${this.sim.requiredCleared} / ${this.sim.requiredTarget} · total throughput: ${this.sim.totalExited}`;
    } else if (o.type === 'collision') {
      title = 'Collision!';
      color = CSS.red;
      body = `The two highlighted vehicles collided at ${t}s.\nAny collision ends the run — including ambient traffic.`;
    } else if (o.type === 'overflow') {
      title = 'Queue overflow!';
      color = CSS.red;
      body = `Too many cars waiting at the ${o.lane} entry (limit ${o.limit}) at ${t}s.\nKeep the queue moving.`;
    } else {
      title = 'Time out';
      color = CSS.yellow;
      body = `Deadline ${this.level.deadline}s reached. Cleared ${this.sim.requiredCleared} / ${this.sim.requiredTarget}.\nRequired cars still on the map are marked with a red ◆.`;
    }
    this.overlay.add([
      text(this, box.cx, box.y + 44, title, { size: 32, weight: 'bold', color, origin: 0.5 }),
      text(this, box.cx, box.y + 96, body, { size: 17, color: CSS.fg, origin: [0.5, 0], align: 'center', wrap: 540 }),
    ]);
    const specs = [];
    if (o.type === 'win') specs.push({ label: last ? 'Finish' : 'Next level', primary: true, onClick: () => this.next() });
    specs.push({ label: 'Retry (R)', primary: o.type !== 'win', onClick: () => this.retry() });
    specs.push({ label: 'Levels', onClick: () => this.toSelect() });
    this.addButtons(box, specs);
    this.refresh();
  }

  // ---------- fixed-step loop ----------
  update() {
    this.updateTargets();
    if (this.mode === 'playing' && this.sim) {
      const now = performance.now();
      this.acc += Math.max(0, (now - this.last) / 1000);
      this.last = now;
      const st = this.sim;
      const limit = this.prepped.deadlineTicks;
      let n = 0;
      while (this.acc >= STEP && n < MAX_STEPS_PER_FRAME && !st.outcome && st.tick <= limit) {
        step(st);
        this.acc -= STEP;
        n++;
      }
      if (!st.outcome && st.tick > limit) {
        // deadline reached without a win (completion on the deadline tick itself is allowed)
        st.outcome = { type: 'timeout', tick: limit, time: limit / TICK_RATE };
      }
      if (st.outcome) {
        this.onOutcome();
      } else if (this.acc > MAX_BACKLOG) {
        // cannot catch up: pause with a message instead of silently skipping simulation time
        this.acc = 0;
        this.pause({ perf: true });
      }
    }
    this.refresh();
  }
}
