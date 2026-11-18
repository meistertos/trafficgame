// Layout + theme. The playfield is the engine's fixed 1200x800 world; the HUD bar sits above it,
// outside the world rectangle (spec §3). RES renders internally at device resolution for crisp
// vector art, with every camera zoomed by RES, so all game code works in world/HUD units.
import { WORLD_W, WORLD_H } from '@engine/constants.js';

export { WORLD_W, WORLD_H };
export const HUD_H = 120;
export const GAME_W = WORLD_W;
export const GAME_H = WORLD_H + HUD_H;
export const RES = Math.max(1, Math.min(2, Math.round(window.devicePixelRatio || 1)));

export const COLORS = {
  letterbox: 0x0b0d10,
  panel: 0x1d222b,
  panelDark: 0x11141a,
  world: 0x181c23,
  road: 0x3a4150,
  roadAlt: 0x424a5c,
  border: 0x2c3442,
  fg: 0xe8ecf1,
  muted: 0x9aa4b2,
  accent: 0x4da3ff,
  red: 0xff5252,
  green: 0x43d17c,
  yellow: 0xffd54a,
  crash: 0xff2d2d,
  noSignal: 0xff8a5c,
  bus: 0xa8c6e8,
};
export const CSS = {
  fg: '#e8ecf1', muted: '#9aa4b2', accent: '#4da3ff', red: '#ff5252', green: '#43d17c',
  yellow: '#ffd54a', noSignal: '#ff8a5c', dark: '#0b0d10',
};
export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const MIN_TARGET_CSS_PX = 48; // spec §3: every signal gets at least a 48x48 CSS-px target
