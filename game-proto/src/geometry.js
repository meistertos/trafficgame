// Lane geometry and swept-AABB collision math (spec §4.1, §4.4). Pure functions, no DOM.
import { EPS_COLL } from './constants.js';

// Lane vector: unit direction and length. Lanes are axis-aligned by validation.
export function laneVector(lane) {
  const dx = lane.to[0] - lane.from[0];
  const dy = lane.to[1] - lane.from[1];
  const len = Math.hypot(dx, dy);
  return { len, ux: dx / len, uy: dy / len, axis: dx === 0 ? 'v' : 'h' };
}

export function pointAt(lane, vec, s) {
  return [lane.from[0] + vec.ux * s, lane.from[1] + vec.uy * s];
}

// Axis-aligned rectangle of a vehicle whose center is at distance s on the lane.
// Rotating horizontal→vertical just swaps width/height (spec §4.4).
export function vehicleRect(lane, vec, s, length, width) {
  const [cx, cy] = pointAt(lane, vec, s);
  const hl = length / 2;
  const hw = width / 2;
  if (vec.axis === 'h') return { x: cx - hl, y: cy - hw, w: length, h: width };
  return { x: cx - hw, y: cy - hl, w: width, h: length };
}

// Open interval of tau where |a(tau) - b(tau)| < halfA + halfB (strict interior overlap),
// with a(tau) = pA + dA*tau, b(tau) = pB + dB*tau. Returns null when never overlapping.
function axisOverlapInterval(pA, dA, halfA, pB, dB, halfB) {
  const p = pA - pB;
  const q = dA - dB;
  const R = halfA + halfB;
  if (q === 0) return Math.abs(p) < R ? [-Infinity, Infinity] : null;
  let lo = (-R - p) / q;
  let hi = (R - p) / q;
  if (lo > hi) [lo, hi] = [hi, lo];
  return [lo, hi];
}

// Swept AABB over the tick's actual linear motion: rects move by dA/dB over tau in [0,1].
// Collision iff the x- and y-overlap intervals and [0,1] share a strict interior point.
export function sweptOverlap(rectA, dA, rectB, dB) {
  const ix = axisOverlapInterval(
    rectA.x + rectA.w / 2, dA.x, rectA.w / 2,
    rectB.x + rectB.w / 2, dB.x, rectB.w / 2
  );
  if (!ix) return false;
  const iy = axisOverlapInterval(
    rectA.y + rectA.h / 2, dA.y, rectA.h / 2,
    rectB.y + rectB.h / 2, dB.y, rectB.h / 2
  );
  if (!iy) return false;
  const lo = Math.max(ix[0], iy[0], 0);
  const hi = Math.min(ix[1], iy[1], 1);
  return hi - lo > EPS_COLL;
}

// Strict interior overlap of two static rects (boundary contact alone is not a collision).
export function rectsOverlapStrict(a, b) {
  return a.x < b.x + b.w - EPS_COLL && b.x < a.x + a.w - EPS_COLL &&
         a.y < b.y + b.h - EPS_COLL && b.y < a.y + a.h - EPS_COLL;
}

// Derived at-grade crossings: where perpendicular lane centerlines intersect (spec §4.1).
export function deriveCrossings(lanes) {
  const out = [];
  for (let i = 0; i < lanes.length; i++) {
    for (let j = i + 1; j < lanes.length; j++) {
      const a = lanes[i];
      const b = lanes[j];
      if (a.vec.axis === b.vec.axis) continue;
      const v = a.vec.axis === 'v' ? a : b;
      const h = a.vec.axis === 'v' ? b : a;
      const px = v.from[0];
      const py = h.from[1];
      const sv = v.from[1] + (py - v.from[1]) / v.vec.uy; // s on vertical lane
      const sh = h.from[0] + (px - h.from[0]) / h.vec.ux; // s on horizontal lane
      // strictly interior: endpoint touches are merges/diverges/corners, not at-grade crossings
      if (!(sv > 1e-9 && sv < v.vec.len - 1e-9 && sh > 1e-9 && sh < h.vec.len - 1e-9)) continue;
      out.push({ point: [px, py], lanes: [a.id, b.id], s: { [a.id]: a.vec.axis === 'v' ? sv : sh, [b.id]: a.vec.axis === 'v' ? sh : sv } });
    }
  }
  return out;
}
