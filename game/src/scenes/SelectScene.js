import * as Phaser from 'phaser';
import { getPack, objectiveText } from '../pack.js';
import { loadCompleted } from '../storage.js';
import { setupCamera } from './common.js';
import { text, station, fillDiamond, button } from '../ui.js';
import { GAME_W, GAME_H, COLORS, CSS, LINE_COLORS, THEME, toggleTheme } from '../config.js';

// Level select drawn as a single transit line: one station per level, filled once completed.
// All levels are open during prototype testing.
export class SelectScene extends Phaser.Scene {
  constructor() { super('select'); }

  create(data = {}) {
    setupCamera(this);
    const { levels } = getPack();
    const completed = loadCompleted();

    text(this, 80, 96, 'Mind the Gap', { size: 52, weight: 'bold', origin: [0, 0.5] });
    text(this, 82, 146, 'Release cars through intersections without collisions. Tap a signal, or press 1–4, to toggle it.',
      { size: 17, color: CSS.muted, origin: [0, 0.5] });
    if (data.campaignDone) {
      text(this, 82, 186, `All ${levels.length} levels cleared.`, { size: 18, weight: 'bold', color: CSS.green, origin: [0, 0.5] });
    }

    // the line
    const y = 430;
    const x0 = 140;
    const x1 = GAME_W - 140;
    const dx = levels.length > 1 ? (x1 - x0) / (levels.length - 1) : 0;
    const g = this.add.graphics();
    g.fillStyle(LINE_COLORS[0], 1);
    g.fillRect(x0 - 60, y - 4, x1 - x0 + 120, 8);
    // terminus bars
    g.fillRoundedRect(x0 - 64, y - 16, 8, 32, 4);
    g.fillRoundedRect(x1 + 56, y - 16, 8, 32, 4);

    levels.forEach((l, i) => {
      const x = x0 + i * dx;
      const done = !!completed[l.id];
      const sg = this.add.graphics();
      const num = text(this, x, y, String(i + 1), { size: 20, weight: 'bold', origin: 0.5 });
      const draw = (hover) => {
        sg.clear();
        const r = hover ? 27 : 24;
        if (done) station(sg, x, y, r, { ring: COLORS.ink, fill: COLORS.ink, width: 5 });
        else station(sg, x, y, r, { ring: COLORS.ink, fill: COLORS.card, width: 5 });
        num.setColor(done ? CSS.paper : CSS.fg);
      };
      draw(false);
      text(this, x, y + 50, l.title, { size: 17, weight: 'bold', origin: [0.5, 0], align: 'center', wrap: 150 });
      text(this, x, y + 98, `${objectiveText(l)}\n${l.deadline}s`,
        { size: 13, color: CSS.muted, origin: [0.5, 0], align: 'center', wrap: 140, lineSpacing: 3 });
      if (done) text(this, x, y - 50, 'CLEARED', { size: 10, weight: 'bold', color: CSS.green, origin: 0.5, letterSpacing: 1.5 });

      const zone = this.add.zone(x, y + 60, Math.max(120, dx - 8), 220).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => draw(true));
      zone.on('pointerout', () => draw(false));
      zone.on('pointerdown', () => this.scene.start('play', { index: i }));
    });

    this.legend(GAME_H - 70);
    button(this, GAME_W - 140, 96, 120, 40, THEME === 'day' ? 'Night' : 'Day', () => this.swapTheme(), { size: 14 });
    this.input.keyboard.on('keydown', (e) => {
      if (e.key.toLowerCase() === 'n') { this.swapTheme(); return; }
      const n = Number(e.key);
      if (n >= 1 && n <= levels.length) this.scene.start('play', { index: n - 1 });
    });
  }

  swapTheme() {
    toggleTheme();
    this.scene.restart();
  }

  legend(y) {
    const g = this.add.graphics();
    const items = [
      ['diamond', 'marked car: get these through'],
      ['dot', 'other traffic: avoid it'],
      ['nosig', 'never stops'],
      ['ring', 'any collision ends the run'],
    ];
    let x = 82;
    for (const [kind, label] of items) {
      if (kind === 'diamond') { g.fillStyle(COLORS.ink, 1); g.fillRoundedRect(x, y - 5, 18, 10, 3); g.fillStyle(COLORS.mark, 1); fillDiamond(g, x + 9, y, 3.5); x += 26; }
      else if (kind === 'dot') { g.fillStyle(COLORS.enemy, 1); g.fillRoundedRect(x, y - 5, 18, 10, 3); x += 26; }
      else if (kind === 'nosig') { const t = text(this, x, y, 'NO SIGNAL', { size: 11, weight: 'bold', color: CSS.noSignal, origin: [0, 0.5], letterSpacing: 1.5 }); x += t.width + 10; }
      else if (kind === 'ring') { g.lineStyle(2.5, COLORS.red, 1); g.strokeCircle(x + 7, y, 7); x += 24; }
      const t = text(this, x, y, label, { size: 14, color: CSS.muted, origin: [0, 0.5] });
      x += t.width + 40;
    }
  }
}
