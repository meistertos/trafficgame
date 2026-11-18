import * as Phaser from 'phaser';
import { getPack, objectiveText } from '../pack.js';
import { loadCompleted } from '../storage.js';
import { setupCamera } from './common.js';
import { text, roundedPanel } from '../ui.js';
import { GAME_W, GAME_H, COLORS, CSS } from '../config.js';

// Level select: all levels are open during prototype testing; completed ones get a check mark.
export class SelectScene extends Phaser.Scene {
  constructor() { super('select'); }

  create(data = {}) {
    setupCamera(this);
    const { levels } = getPack();
    const completed = loadCompleted();
    text(this, GAME_W / 2, 56, 'Mind the Gap', { size: 44, weight: 'bold', origin: 0.5 });
    text(this, GAME_W / 2, 104, 'Release cars through intersections without collisions. Tap a traffic light (or keys 1–4) to toggle it.',
      { size: 17, color: CSS.muted, origin: 0.5 });
    let y0 = 150;
    if (data.campaignDone) {
      text(this, GAME_W / 2, y0, `Campaign complete! All ${levels.length} levels cleared.`, { size: 22, weight: 'bold', color: CSS.green, origin: 0.5 });
      y0 += 40;
    }
    const cols = 2;
    const cw = 540;
    const ch = 92;
    const gap = 20;
    const x0 = (GAME_W - (cols * cw + (cols - 1) * gap)) / 2;
    levels.forEach((l, i) => {
      const x = x0 + (i % cols) * (cw + gap);
      const y = y0 + Math.floor(i / cols) * (ch + gap);
      const card = this.add.container(x, y);
      const bg = roundedPanel(this, 0, 0, cw, ch);
      const title = text(this, 22, 18, `${i + 1}. ${l.title}`, { size: 22, weight: 'bold' });
      const sub = text(this, 22, 54, `${objectiveText(l)} · ${l.deadline}s`, { size: 15, color: CSS.muted });
      card.add([bg, title, sub]);
      if (completed[l.id]) card.add(text(this, cw - 24, ch / 2, '✓', { size: 30, weight: 'bold', color: CSS.green, origin: [1, 0.5] }));
      card.setSize(cw, ch);
      // container hit areas are offset by displayOrigin (half the size): shift the rect so it covers [0,cw]x[0,ch]
      card.setInteractive(new Phaser.Geom.Rectangle(cw / 2, ch / 2, cw, ch), Phaser.Geom.Rectangle.Contains);
      card.input.cursor = 'pointer';
      const hover = (on) => { bg.clear(); bg.fillStyle(COLORS.panel, 1); bg.fillRoundedRect(0, 0, cw, ch, 14); bg.lineStyle(2, on ? COLORS.accent : COLORS.border, 1); bg.strokeRoundedRect(0, 0, cw, ch, 14); };
      card.on('pointerover', () => hover(true));
      card.on('pointerout', () => hover(false));
      card.on('pointerdown', () => this.scene.start('play', { index: i }));
    });
    text(this, GAME_W / 2, GAME_H - 40,
      '◆ marked car = required (counts when its rear leaves the map)   ·   NO SIGNAL = unstoppable traffic   ·   any collision ends the run',
      { size: 14, color: CSS.muted, origin: 0.5 });
    this.input.keyboard.on('keydown', (e) => {
      const n = Number(e.key);
      if (n >= 1 && n <= levels.length) this.scene.start('play', { index: n - 1 });
    });
  }
}
