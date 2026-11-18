// Small Phaser UI kit in the flat transit-map style: crisp text, paper cards, ink buttons.
import * as Phaser from 'phaser';
import { RES, COLORS, CSS, FONT } from './config.js';

export function text(scene, x, y, str, opts = {}) {
  const t = scene.add.text(x, y, str, {
    fontFamily: FONT,
    fontSize: `${opts.size ?? 18}px`,
    fontStyle: opts.weight ?? 'normal',
    color: opts.color ?? CSS.fg,
    align: opts.align ?? 'left',
    wordWrap: opts.wrap ? { width: opts.wrap, useAdvancedWrap: true } : undefined,
    lineSpacing: opts.lineSpacing ?? 4,
  });
  t.setResolution(RES * (opts.res ?? 1));
  if (opts.letterSpacing) t.setLetterSpacing(opts.letterSpacing);
  if (opts.origin !== undefined) t.setOrigin(...[].concat(opts.origin));
  return t;
}

// Paper card with a flat offset shadow instead of a border.
export function roundedPanel(scene, x, y, w, h, opts = {}) {
  const g = scene.add.graphics({ x, y });
  const r = opts.radius ?? 6;
  g.fillStyle(COLORS.shadow, COLORS.shadowAlpha);
  g.fillRoundedRect(4, 6, w, h, r);
  g.fillStyle(opts.fill ?? COLORS.card, opts.alpha ?? 1);
  g.fillRoundedRect(0, 0, w, h, r);
  return g;
}

// Station ring: white disc with a thick ink (or coloured) ring. Used for signals and level stops.
export function station(g, x, y, r, { ring = COLORS.ink, fill = COLORS.card, width = Math.max(3, r * 0.22) } = {}) {
  g.fillStyle(fill, 1);
  g.fillCircle(x, y, r);
  g.lineStyle(width, ring, 1);
  g.strokeCircle(x, y, r - width / 2);
}

// Button centered at (x, y). kind: 'normal' (ink outline) | 'primary' (ink fill). Returns a controller.
export function button(scene, x, y, w, h, label, onClick, opts = {}) {
  const c = scene.add.container(x, y);
  const bg = scene.add.graphics();
  const lbl = text(scene, 0, opts.sub ? -10 : 0, label, { size: opts.size ?? 18, weight: 'bold', origin: 0.5 });
  const sub = opts.sub ? text(scene, 0, 16, opts.sub, { size: 12, weight: 'bold', origin: 0.5 }) : null;
  c.add([bg, lbl, ...(sub ? [sub] : [])]);
  c.setSize(w, h);
  c.setInteractive({ useHandCursor: true });
  const st = { hover: false, enabled: true, kind: opts.kind ?? 'normal', border: opts.border ?? null };
  const draw = () => {
    bg.clear();
    const primary = st.kind === 'primary';
    const a = st.enabled ? 1 : 0.35;
    const r = h / 2 > 24 ? 8 : h / 2; // pill for short buttons
    if (primary) {
      bg.fillStyle(COLORS.ink, a * (st.hover ? 0.85 : 1));
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, r);
    } else {
      if (st.hover && st.enabled) { bg.fillStyle(COLORS.ink, 0.06); bg.fillRoundedRect(-w / 2, -h / 2, w, h, r); }
      bg.lineStyle(2.5, st.border ?? COLORS.ink, a);
      bg.strokeRoundedRect(-w / 2 + 1.25, -h / 2 + 1.25, w - 2.5, h - 2.5, r);
    }
    lbl.setColor(primary ? CSS.paper : CSS.fg);
    lbl.setAlpha(st.enabled ? 1 : 0.4);
    if (sub) sub.setAlpha(st.enabled ? 1 : 0.4);
  };
  c.on('pointerover', () => { st.hover = true; draw(); });
  c.on('pointerout', () => { st.hover = false; draw(); });
  c.on('pointerdown', (pointer, lx, ly, event) => {
    event?.stopPropagation?.();
    if (st.enabled) onClick();
  });
  draw();
  return {
    container: c,
    setLabel(s) { lbl.setText(s); return this; },
    setSub(s, color) { if (sub) { sub.setText(s); if (color) sub.setColor(color); } return this; },
    setEnabled(on) { if (st.enabled === !!on) return this; st.enabled = !!on; c.input && (c.input.cursor = on ? 'pointer' : 'default'); draw(); return this; },
    setBorder(color) { st.border = color; draw(); return this; },
    destroy() { c.destroy(); },
  };
}

// Diamond path helper (marker for required vehicles).
export function fillDiamond(g, cx, cy, d) {
  g.fillTriangle(cx, cy - d, cx + d, cy, cx - d, cy);
  g.fillTriangle(cx, cy + d, cx + d, cy, cx - d, cy);
}

export { Phaser };
