// Layout + theme. The playfield is the engine's fixed 1200x800 world; the HUD bar sits above it,
// outside the world rectangle (spec §3). RES renders internally at device resolution for crisp
// vector art, with every camera zoomed by RES, so all game code works in world/HUD units.
//
// Theme: minimal flat "transit map" with a day (paper) and a night palette. COLORS, CSS and
// LINE_COLORS are live objects: applyTheme() rewrites them in place, and scenes restart to redraw.
import { WORLD_W, WORLD_H } from '@engine/constants.js';

export { WORLD_W, WORLD_H };
export const HUD_H = 120;
export const GAME_W = WORLD_W;
export const GAME_H = WORLD_H + HUD_H;
export const RES = Math.max(1, Math.min(2, Math.round(window.devicePixelRatio || 1)));

const THEMES = {
  day: {
    paper: 0xf3f0e9, // background + letterbox, so the frame disappears
    card: 0xfbfaf6, // station fill, overlay cards
    ink: 0x2b2b2b, // text, stop lines, required cars
    mark: 0xffffff, // ◆ printed on required cars
    muted: 0x9a958a,
    faint: 0xdcd7cc,
    red: 0xe0473c,
    green: 0x2f9e5b,
    yellow: 0xd99a1e,
    enemy: 0xee6c1f, // non-required traffic: the thing you must not hit
    shadow: 0x2b2b2b,
    shadowAlpha: 0.08,
    lines: [0x3d7cc9, 0xe5a823, 0x8e5bb8, 0x37a6a0, 0xd8689f, 0x8a6a4d, 0x2e4f86, 0x6fb3e0],
    css: { yellow: '#c58a14' }, // darker ochre for text on paper
  },
  night: {
    paper: 0x1b1e24,
    card: 0x262a32,
    ink: 0xece8df,
    mark: 0x1b1e24,
    muted: 0x7f8590,
    faint: 0x343943,
    red: 0xff5a4e,
    green: 0x3ccf74,
    yellow: 0xf0b43a,
    enemy: 0xff8a3d,
    shadow: 0x000000,
    shadowAlpha: 0.35,
    lines: [0x4f95e6, 0xf2bb3a, 0xa877d6, 0x45c2bb, 0xe682b8, 0xb08a66, 0x5f86c9, 0x8ccaf0],
    css: {},
  },
};

export const COLORS = {};
export const CSS = {};
export const LINE_COLORS = [];
export let THEME = 'day';

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const THEME_KEY = 'mindthegap.theme';

export function applyTheme(name) {
  const t = THEMES[name] ?? THEMES.day;
  THEME = THEMES[name] ? name : 'day';
  Object.assign(COLORS, {
    letterbox: t.paper, world: t.paper, paper: t.paper, card: t.card, panel: t.card,
    ink: t.ink, fg: t.ink, accent: t.ink, mark: t.mark, muted: t.muted, faint: t.faint, border: t.faint,
    red: t.red, green: t.green, yellow: t.yellow, crash: t.red, noSignal: t.enemy,
    enemy: t.enemy, car: t.ink, shadow: t.shadow, shadowAlpha: t.shadowAlpha,
  });
  Object.assign(CSS, {
    fg: hex(t.ink), dark: hex(t.ink), accent: hex(t.ink), paper: hex(t.paper), muted: hex(t.muted),
    red: hex(t.red), green: hex(t.green), yellow: hex(t.yellow), noSignal: hex(t.enemy), enemy: hex(t.enemy),
    ...t.css,
  });
  LINE_COLORS.splice(0, LINE_COLORS.length, ...t.lines);
  document.documentElement.style.background = CSS.paper;
  document.body && (document.body.style.background = CSS.paper);
  try { localStorage.setItem(THEME_KEY, THEME); } catch { /* ignore */ }
}

export function toggleTheme() {
  applyTheme(THEME === 'day' ? 'night' : 'day');
  return THEME;
}

let initial = 'day';
try {
  initial = localStorage.getItem(THEME_KEY)
    ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'night' : 'day');
} catch { /* ignore */ }
applyTheme(initial);

export const FONT = '"Avenir Next", Avenir, Futura, "Helvetica Neue", system-ui, sans-serif';
export const MIN_TARGET_CSS_PX = 48; // spec §3: every signal gets at least a 48x48 CSS-px target
