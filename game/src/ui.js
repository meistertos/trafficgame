// Small Phaser UI kit: crisp text, rounded panels and buttons with hover/disabled states.
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
  if (opts.origin !== undefined) t.setOrigin(...[].concat(opts.origin));
  return t;
}

export function roundedPanel(scene, x, y, w, h, opts = {}) {
  const g = scene.add.graphics({ x, y });
  g.fillStyle(opts.fill ?? COLORS.panel, opts.alpha ?? 1);
  g.fillRoundedRect(0, 0, w, h, opts.radius ?? 14);
  g.lineStyle(opts.lineWidth ?? 2, opts.stroke ?? COLORS.border, 1);
  g.strokeRoundedRect(0, 0, w, h, opts.radius ?? 14);
  return g;
}

// Button centered at (x, y). kind: 'normal' | 'primary'. Returns a controller object.
export function button(scene, x, y, w, h, label, onClick, opts = {}) {
  const c = scene.add.container(x, y);
  const bg = scene.add.graphics();
  const lbl = text(scene, 0, opts.sub ? -10 : 0, label, { size: opts.size ?? 20, weight: 'bold', origin: 0.5 });
  const sub = opts.sub ? text(scene, 0, 16, opts.sub, { size: 13, weight: 'bold', origin: 0.5 }) : null;
  c.add([bg, lbl, ...(sub ? [sub] : [])]);
  c.setSize(w, h);
  c.setInteractive({ useHandCursor: true });
  const st = { hover: false, enabled: true, kind: opts.kind ?? 'normal', border: opts.border ?? null };
  const draw = () => {
    bg.clear();
    const primary = st.kind === 'primary';
    bg.fillStyle(primary ? COLORS.accent : COLORS.panelDark, st.enabled ? 1 : 0.5);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
    const border = st.border ?? (st.hover && st.enabled ? COLORS.accent : COLORS.border);
    bg.lineStyle(2, primary ? COLORS.accent : border, st.enabled ? 1 : 0.5);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
    lbl.setColor(primary ? CSS.dark : CSS.fg);
    lbl.setAlpha(st.enabled ? 1 : 0.45);
    if (sub) sub.setAlpha(st.enabled ? 1 : 0.45);
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

// Diamond path helper (roof marker for required vehicles).
export function fillDiamond(g, cx, cy, d) {
  g.fillTriangle(cx, cy - d, cx + d, cy, cx - d, cy);
  g.fillTriangle(cx, cy + d, cx + d, cy, cx - d, cy);
}

export { Phaser };
