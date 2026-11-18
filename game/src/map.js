// Static playfield drawing + interactive signal heads + entry queue badges (spec §3).
// Everything here lives in world coordinates inside the scene's world layer.
import * as Phaser from 'phaser';
import { pointAt } from '@engine/geometry.js';
import { WORLD_W, WORLD_H, COLORS, CSS } from './config.js';
import { text, fillDiamond } from './ui.js';

const ROAD_HALF = 15;
const onEdge = (p) => p[0] === 0 || p[0] === WORLD_W || p[1] === 0 || p[1] === WORLD_H;
const interior = (p) => p[0] > 0 && p[0] < WORLD_W && p[1] > 0 && p[1] < WORLD_H;

// Signal head anchors: grouped lanes share one head at the midpoint of their stop points,
// offset beside the road, with callout lines to every stop line (spec §3).
export function signalLayout(prepped) {
  return prepped.signals.map((sig) => {
    const pts = sig.laneObjs.map((lane) => pointAt(lane, lane.vec, sig.stopS));
    const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const v = sig.laneObjs[0].vec.axis === 'v';
    return { id: sig.id, stopPoints: pts, x: mx + (v ? ROAD_HALF + 22 : 0), y: my + (v ? 0 : ROAD_HALF + 22) };
  });
}

export function drawStaticMap(scene, layer, prepped) {
  const g = scene.add.graphics();
  layer.add(g);
  g.fillStyle(COLORS.world, 1);
  g.fillRect(0, 0, WORLD_W, WORLD_H);

  // roads (lane bands), center dashes, direction arrows
  prepped.lanes.forEach((lane, i) => {
    const [x0, y0] = lane.from;
    const [x1, y1] = lane.to;
    g.fillStyle(i % 4 < 2 ? COLORS.road : COLORS.roadAlt, 1);
    if (lane.vec.axis === 'h') g.fillRect(Math.min(x0, x1), y0 - ROAD_HALF, Math.abs(x1 - x0), ROAD_HALF * 2);
    else g.fillRect(x0 - ROAD_HALF, Math.min(y0, y1), ROAD_HALF * 2, Math.abs(y1 - y0));
  });
  prepped.lanes.forEach((lane) => {
    const len = lane.vec.len;
    g.fillStyle(COLORS.fg, 0.3);
    for (let s = 0; s < len; s += 22) {
      const [ax, ay] = pointAt(lane, lane.vec, s);
      const [bx, by] = pointAt(lane, lane.vec, Math.min(len, s + 10));
      g.fillRect(Math.min(ax, bx) - (lane.vec.axis === 'v' ? 1 : 0), Math.min(ay, by) - (lane.vec.axis === 'h' ? 1 : 0),
        Math.max(2, Math.abs(bx - ax)), Math.max(2, Math.abs(by - ay)));
    }
    g.fillStyle(COLORS.fg, 0.55);
    for (let s = 90; s < len - 40; s += 180) {
      const [tx, ty] = pointAt(lane, lane.vec, s + 26);
      const ang = Math.atan2(lane.vec.uy, lane.vec.ux);
      g.fillTriangle(tx, ty,
        tx - 10 * Math.cos(ang - 0.45), ty - 10 * Math.sin(ang - 0.45),
        tx - 10 * Math.cos(ang + 0.45), ty - 10 * Math.sin(ang + 0.45));
    }
  });

  // roundabout decoration: dashed ring + label over the interior ring lanes; yield triangles at merges
  const targets = new Set();
  const yieldPoints = [];
  for (const lane of prepped.lanes) {
    for (const ev of lane.events) {
      for (const seg of ev.routeSegs ?? []) {
        if (!seg.transfer) continue;
        targets.add(seg.transfer.laneId);
        if (seg.transfer.baseS > 1e-9) {
          const p = pointAt(lane, lane.vec, seg.exitS);
          if (!yieldPoints.some((q) => q[0] === p[0] && q[1] === p[1])) yieldPoints.push(p);
        }
      }
    }
  }
  const ringLanes = prepped.lanes.filter((l) => targets.has(l.id) && interior(l.from) && interior(l.to));
  if (ringLanes.length >= 3) {
    const cx = ringLanes.reduce((a, l) => a + (l.from[0] + l.to[0]) / 2, 0) / ringLanes.length;
    const cy = ringLanes.reduce((a, l) => a + (l.from[1] + l.to[1]) / 2, 0) / ringLanes.length;
    const r = Math.max(...ringLanes.map((l) => l.vec.len)) * 0.42;
    g.fillStyle(0x222833, 1);
    g.fillCircle(cx, cy, r);
    g.lineStyle(2, COLORS.muted, 0.45);
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 18) {
      g.beginPath(); g.arc(cx, cy, r, a, a + Math.PI / 36); g.strokePath();
    }
    layer.add(text(scene, cx, cy, 'ROUNDABOUT', { size: 12, weight: 'bold', color: CSS.muted, origin: 0.5 }));
  }
  g.fillStyle(COLORS.yellow, 1);
  for (const [px, py] of yieldPoints) g.fillTriangle(px, py - 8, px + 8, py + 8, px - 8, py + 8);

  // stop lines: high-contrast front-bumper boundary at stopS (spec §4.2)
  g.fillStyle(0xf5f7fa, 1);
  for (const sig of prepped.signals) {
    for (const lane of sig.laneObjs) {
      const [sx, sy] = pointAt(lane, lane.vec, sig.stopS);
      if (lane.vec.axis === 'v') g.fillRect(sx - ROAD_HALF, sy - 2.5, ROAD_HALF * 2, 5);
      else g.fillRect(sx - 2.5, sy - ROAD_HALF, 5, ROAD_HALF * 2);
    }
  }

  // NO SIGNAL labels at uncontrolled map-edge entries
  for (const lane of prepped.lanes) {
    if (lane.signals.length || !lane.events.length || !onEdge(lane.from)) continue;
    const [ex, ey] = pointAt(lane, lane.vec, 34);
    const lx = ex + (lane.vec.axis === 'v' ? 0 : 0);
    const ly = ey + (lane.vec.axis === 'h' ? -26 : 0);
    const t = text(scene, lane.vec.axis === 'v' ? lx + 52 : lx, ly, 'NO SIGNAL', { size: 13, weight: 'bold', color: CSS.noSignal, origin: 0.5 });
    layer.add(t);
  }

  // signal callout lines (heads are interactive objects created separately)
  g.lineStyle(1.5, COLORS.fg, 0.4);
  for (const lay of signalLayout(prepped)) {
    for (const [px, py] of lay.stopPoints) g.lineBetween(px, py, lay.x, lay.y);
  }
  return g;
}

// Interactive signal head: circle + letter + RED/GREEN label (not color alone, spec §3).
export class SignalHead {
  constructor(scene, layer, lay, onToggle) {
    this.scene = scene;
    this.id = lay.id;
    this.c = scene.add.container(lay.x, lay.y);
    this.g = scene.add.graphics();
    this.letter = text(scene, 0, 0, lay.id, { size: 20, weight: 'bold', origin: 0.5 });
    this.state = text(scene, 0, 0, 'RED', { size: 12, weight: 'bold', color: CSS.red, origin: 0.5 });
    this.c.add([this.g, this.letter, this.state]);
    layer.add(this.c);
    this.green = false;
    this.r = 18;
    this.c.on('pointerdown', (p, lx, ly, event) => { event?.stopPropagation?.(); onToggle(this.id); });
    this.redraw();
  }

  setRadius(r) {
    if (Math.abs(r - this.r) < 0.01 && this.c.input) return;
    this.r = r;
    this.c.setSize(r * 2, r * 2);
    if (this.c.input) this.c.removeInteractive();
    this.c.setInteractive(new Phaser.Geom.Circle(r, r, r), Phaser.Geom.Circle.Contains);
    if (this.c.input) this.c.input.cursor = 'pointer';
    this.redraw();
  }

  setGreen(green) {
    if (green === this.green) return;
    this.green = green;
    this.redraw();
  }

  redraw() {
    const r = this.r;
    const col = this.green ? COLORS.green : COLORS.red;
    this.g.clear();
    this.g.fillStyle(COLORS.panelDark, 0.92);
    this.g.fillCircle(0, 0, r);
    this.g.lineStyle(3, col, 1);
    this.g.strokeCircle(0, 0, r);
    this.g.fillStyle(col, 1);
    this.g.fillCircle(0, 0, Math.min(r * 0.45, 9));
    this.letter.setFontSize(Math.max(18, r * 0.75));
    this.letter.setY(-1);
    this.state.setText(this.green ? 'GREEN' : 'RED').setColor(this.green ? CSS.green : CSS.red).setY(r + 10);
  }
}

// "⏳n/limit (k◆)" badge at each entry with a waiting queue.
export class QueueBadges {
  constructor(scene, layer, prepped) {
    this.items = prepped.lanes.map((lane) => {
      const [x, y] = pointAt(lane, lane.vec, 56);
      const off = lane.vec.axis === 'v' ? [-46, 0] : [0, 26];
      const t = text(scene, x + off[0], y + off[1], '', { size: 13, weight: 'bold', color: CSS.muted, origin: 0.5 });
      layer.add(t);
      return { laneId: lane.id, limit: lane.queueLimit, t, last: '' };
    });
  }

  update(state) {
    for (const it of this.items) {
      const lane = state?.laneById.get(it.laneId);
      const n = lane ? lane.queue.length : 0;
      const req = lane ? lane.queue.filter((e) => e.required).length : 0;
      const cap = Number.isFinite(it.limit) ? `/${it.limit}` : '';
      const s = n ? `⏳${n}${cap}${req ? ` (${req}◆)` : ''}` : '';
      if (s !== it.last) {
        it.last = s;
        const full = Number.isFinite(it.limit) && n >= it.limit;
        it.t.setText(s).setColor(full ? CSS.red : req ? CSS.yellow : CSS.muted);
      }
    }
  }
}

export { fillDiamond };
