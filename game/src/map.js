// Static playfield drawing + interactive signal heads + entry queue dots (spec §3).
// Everything here lives in world coordinates inside the scene's world layer.
// Style: flat transit map — each lane is a thin coloured line, signals are station rings.
import * as Phaser from 'phaser';
import { pointAt } from '@engine/geometry.js';
import { WORLD_W, WORLD_H, COLORS, CSS, LINE_COLORS } from './config.js';
import { text, fillDiamond, station } from './ui.js';

const ROAD_HALF = 15; // engine lane half-width; used for layout offsets only
const LINE_W = 6; // drawn line thickness
const onEdge = (p) => p[0] === 0 || p[0] === WORLD_W || p[1] === 0 || p[1] === WORLD_H;
const interior = (p) => p[0] > 0 && p[0] < WORLD_W && p[1] > 0 && p[1] < WORLD_H;
const side = (lane) => (lane.vec.axis === 'v' ? [1, 0] : [0, 1]); // fixed perpendicular for labels

// Signal head anchors: grouped lanes share one head at the midpoint of their stop points,
// offset beside the road, with callout lines to every stop line (spec §3).
export function signalLayout(prepped) {
  return prepped.signals.map((sig) => {
    const pts = sig.laneObjs.map((lane) => pointAt(lane, lane.vec, sig.stopS));
    const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const v = sig.laneObjs[0].vec.axis === 'v';
    return { id: sig.id, stopPoints: pts, x: mx + (v ? ROAD_HALF + 30 : 0), y: my + (v ? 0 : ROAD_HALF + 30) };
  });
}

function analyse(prepped) {
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
  return { yieldPoints, ringLanes: ringLanes.length >= 3 ? ringLanes : [] };
}

// Line colour per lane: a roundabout ring reads as one line; everything else gets its own colour.
export function laneColors(prepped) {
  const { ringLanes } = analyse(prepped);
  const ring = new Set(ringLanes.map((l) => l.id));
  const map = new Map();
  let i = 0;
  const ringColor = ring.size ? LINE_COLORS[i++] : null;
  for (const lane of prepped.lanes) map.set(lane.id, ring.has(lane.id) ? ringColor : LINE_COLORS[i++ % LINE_COLORS.length]);
  return map;
}

function dottedLine(g, x0, y0, x1, y1, color, alpha = 1, gap = 7, r = 1.4) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  g.fillStyle(color, alpha);
  for (let d = 0; d <= len; d += gap) g.fillCircle(x0 + ((x1 - x0) * d) / len, y0 + ((y1 - y0) * d) / len, r);
}

export function drawStaticMap(scene, layer, prepped) {
  const g = scene.add.graphics();
  layer.add(g);
  g.fillStyle(COLORS.world, 1);
  g.fillRect(0, 0, WORLD_W, WORLD_H);

  const { yieldPoints, ringLanes } = analyse(prepped);
  const colors = laneColors(prepped);

  // roundabout island: a soft disc under the ring lines
  if (ringLanes.length) {
    const cx = ringLanes.reduce((a, l) => a + (l.from[0] + l.to[0]) / 2, 0) / ringLanes.length;
    const cy = ringLanes.reduce((a, l) => a + (l.from[1] + l.to[1]) / 2, 0) / ringLanes.length;
    const r = Math.max(...ringLanes.map((l) => l.vec.len)) * 0.36;
    g.fillStyle(COLORS.faint, 0.6);
    g.fillCircle(cx, cy, r);
  }

  // lines: flat stroke with round caps (caps also round the ring's corners)
  for (const lane of prepped.lanes) {
    const [x0, y0] = lane.from;
    const [x1, y1] = lane.to;
    const h = LINE_W / 2;
    g.fillStyle(colors.get(lane.id), 1);
    if (lane.vec.axis === 'h') g.fillRect(Math.min(x0, x1), y0 - h, Math.abs(x1 - x0), LINE_W);
    else g.fillRect(x0 - h, Math.min(y0, y1), LINE_W, Math.abs(y1 - y0));
    g.fillCircle(x0, y0, h);
    g.fillCircle(x1, y1, h);
  }

  // direction chevrons, small and white, riding on the line
  g.lineStyle(1.5, COLORS.paper, 0.9);
  for (const lane of prepped.lanes) {
    const len = lane.vec.len;
    const { ux, uy } = lane.vec;
    for (let s = 120; s < len - 60; s += 200) {
      const [tx, ty] = pointAt(lane, lane.vec, s);
      const a = 2.2;
      g.beginPath();
      g.moveTo(tx - ux * a - uy * a, ty - uy * a + ux * a);
      g.lineTo(tx + ux * a, ty + uy * a);
      g.lineTo(tx - ux * a + uy * a, ty - uy * a - ux * a);
      g.strokePath();
    }
  }

  // yield marks at merges: small outlined triangles
  for (const [px, py] of yieldPoints) {
    g.fillStyle(COLORS.card, 1);
    g.fillTriangle(px, py - 7, px + 7, py + 6, px - 7, py + 6);
    g.lineStyle(2.5, COLORS.ink, 1);
    g.strokeTriangle(px, py - 7, px + 7, py + 6, px - 7, py + 6);
  }

  // stop lines: ink ticks across the line at stopS (front-bumper boundary, spec §4.2)
  g.fillStyle(COLORS.ink, 1);
  for (const sig of prepped.signals) {
    for (const lane of sig.laneObjs) {
      const [sx, sy] = pointAt(lane, lane.vec, sig.stopS);
      if (lane.vec.axis === 'v') g.fillRoundedRect(sx - 11, sy - 1.75, 22, 3.5, 1.75);
      else g.fillRoundedRect(sx - 1.75, sy - 11, 3.5, 22, 1.75);
    }
  }

  // NO SIGNAL labels at uncontrolled map-edge entries (opposite side from the queue dots)
  for (const lane of prepped.lanes) {
    if (lane.signals.length || !lane.events.length || !onEdge(lane.from)) continue;
    const [ex, ey] = pointAt(lane, lane.vec, 40);
    const [px, py] = side(lane);
    const t = text(scene, ex + px * 48, ey + py * 22, 'NO SIGNAL',
      { size: 11, weight: 'bold', color: CSS.noSignal, origin: 0.5, letterSpacing: 1.5 });
    layer.add(t);
  }

  // signal callouts: dotted leaders from the station to each stop line
  for (const lay of signalLayout(prepped)) {
    for (const [px, py] of lay.stopPoints) dottedLine(g, px, py, lay.x, lay.y, COLORS.muted, 0.9);
  }
  return g;
}

// Interactive signal head: station ring + letter + RED/GREEN label (not color alone, spec §3).
export class SignalHead {
  constructor(scene, layer, lay, onToggle) {
    this.scene = scene;
    this.id = lay.id;
    this.c = scene.add.container(lay.x, lay.y);
    this.g = scene.add.graphics();
    this.letter = text(scene, 0, 0, lay.id, { size: 18, weight: 'bold', origin: 0.5 });
    this.state = text(scene, 0, 0, 'RED', { size: 10, weight: 'bold', color: CSS.red, origin: 0.5, letterSpacing: 1.5 });
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
    // the hit target may be larger than the drawn station; keep the visual compact
    const r = Math.min(this.r, 22);
    this.g.clear();
    if (this.green) station(this.g, 0, 0, r, { ring: COLORS.green, fill: COLORS.green });
    else station(this.g, 0, 0, r, { ring: COLORS.red, fill: COLORS.card, width: 5 });
    this.letter.setFontSize(Math.round(r * 0.85)).setColor(this.green ? CSS.paper : CSS.fg).setY(0);
    this.state.setText(this.green ? 'GREEN' : 'RED').setColor(this.green ? CSS.green : CSS.red).setY(r + 11);
  }
}

// Waiting cars at each entry, drawn as a row of dots beside the line (◆ = required car).
// With a finite queue limit, empty slots show how much room is left; near the limit they turn red.
export class QueueBadges {
  constructor(scene, layer, prepped) {
    this.g = scene.add.graphics();
    layer.add(this.g);
    this.scene = scene;
    this.layer = layer;
    this.items = prepped.lanes.filter((l) => l.events.length).map((lane) => ({ lane, limit: lane.queueLimit, key: null, more: null }));
  }

  update(state) {
    const keys = this.items.map((it) => {
      const lane = state?.laneById.get(it.lane.id);
      const q = lane ? lane.queue : [];
      return q.map((e) => (e.required ? 'r' : 'a')).join('');
    });
    if (this.items.every((it, i) => it.key === keys[i])) return;
    this.g.clear();
    this.items.forEach((it, i) => {
      it.key = keys[i];
      const q = keys[i];
      const finite = Number.isFinite(it.limit);
      if (!q.length && !finite) { it.more?.setVisible(false); return; }
      const { lane } = it;
      const [px, py] = side(lane);
      const slots = finite ? it.limit : Math.min(q.length, 10);
      const warn = finite && q.length >= it.limit - 1;
      for (let k = 0; k < slots; k++) {
        const [x, y] = pointAt(lane, lane.vec, 24 + k * 14);
        const cx = x - px * 22;
        const cy = y - py * 22;
        const kind = q[k];
        if (!kind) {
          this.g.lineStyle(1.5, COLORS.muted, 0.6);
          this.g.strokeCircle(cx, cy, 4);
        } else if (kind === 'r') {
          this.g.fillStyle(warn ? COLORS.red : COLORS.ink, 1);
          fillDiamond(this.g, cx, cy, 6);
        } else {
          this.g.fillStyle(warn ? COLORS.red : COLORS.enemy, 1);
          this.g.fillCircle(cx, cy, 4.5);
        }
      }
      const extra = q.length - slots;
      if (extra > 0) {
        const [x, y] = pointAt(lane, lane.vec, 24 + slots * 14 + 6);
        if (!it.more) {
          it.more = text(this.scene, 0, 0, '', { size: 12, weight: 'bold', color: CSS.muted, origin: [0, 0.5] });
          this.layer.add(it.more);
        }
        it.more.setPosition(x - px * 22, y - py * 22).setText(`+${extra}`).setVisible(true);
      } else it.more?.setVisible(false);
    });
  }
}

export { fillDiamond };
