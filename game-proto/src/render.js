// Canvas 2D renderer. Fixed 1200x800 world, uniform scale + letterbox (spec §3).
import { WORLD_W, WORLD_H, VEHICLE_COLORS } from './constants.js';
import { pointAt, vehicleRect } from './geometry.js';

const ROAD_HALF = 15;
const LANE_COLORS = ['#3a4150', '#3a4150', '#424a5c', '#424a5c'];

// View transform: world -> canvas backing pixels, uniform scale, letterboxed, centered.
export function computeView(canvas) {
  const w = canvas.width, h = canvas.height;
  const scale = Math.min(w / WORLD_W, h / WORLD_H);
  // backing pixels per CSS pixel (scale is in backing pixels, hit targets are specified in CSS px)
  const cssW = canvas.getBoundingClientRect?.().width || w;
  const dpr = w / cssW || 1;
  return {
    scale,
    dpr,
    ox: (w - WORLD_W * scale) / 2,
    oy: (h - WORLD_H * scale) / 2,
    w, h,
  };
}

// Inverse world transform for pointer positions (spec §3).
export function worldFromPointer(canvas, view, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const dprX = canvas.width / rect.width;
  const dprY = canvas.height / rect.height;
  const px = (clientX - rect.left) * dprX;
  const py = (clientY - rect.top) * dprY;
  return [(px - view.ox) / view.scale, (py - view.oy) / view.scale];
}

function w2c(view, x, y) { return [view.ox + x * view.scale, view.oy + y * view.scale]; }

// Signal head anchor points (world coords) and hit areas. Grouped lanes share one head at the
// midpoint, with callout lines to each stop line; hit radius guarantees >=48x48 CSS px.
export function signalLayout(prepped, view) {
  const out = [];
  for (const sig of prepped.signals) {
    const pts = sig.laneObjs.map((lane) => pointAt(lane, lane.vec, sig.stopS));
    const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    // offset perpendicular to the (shared) lane axis, to the side of travel
    const lane = sig.laneObjs[0];
    const nx = lane.vec.axis === 'v' ? 1 : 0;
    const ny = lane.vec.axis === 'v' ? 0 : 1;
    const hx = mx + nx * (ROAD_HALF + 22);
    const hy = my + ny * (ROAD_HALF + 22);
    // >= 48 CSS px diameter: 24 CSS px radius = 24 * dpr backing px = 24 * dpr / scale world units
    const r = Math.max(16, (24 * (view.dpr ?? 1)) / view.scale);
    out.push({ id: sig.id, stopPoints: pts, x: hx, y: hy, r, stopS: sig.stopS });
  }
  return out;
}

export function drawWorld(ctx, view, prepped, state, opts = {}) {
  const { scale, ox, oy } = view;
  ctx.clearRect(0, 0, view.w, view.h);
  // letterbox background
  ctx.fillStyle = '#0b0d10';
  ctx.fillRect(0, 0, view.w, view.h);
  // world background
  const [wx0, wy0] = w2c(view, 0, 0);
  const [wx1, wy1] = w2c(view, WORLD_W, WORLD_H);
  ctx.fillStyle = '#181c23';
  ctx.fillRect(wx0, wy0, wx1 - wx0, wy1 - wy0);

  // roads
  for (const lane of prepped.lanes) {
    const [x0, y0] = w2c(view, lane.from[0], lane.from[1]);
    const [x1, y1] = w2c(view, lane.to[0], lane.to[1]);
    ctx.strokeStyle = LANE_COLORS[prepped.lanes.indexOf(lane) % LANE_COLORS.length];
    ctx.lineWidth = ROAD_HALF * 2 * scale;
    ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    // center dashes + direction arrows
    ctx.strokeStyle = 'rgba(232,236,241,0.35)';
    ctx.lineWidth = Math.max(1, 2 * scale);
    ctx.setLineDash([10 * scale, 12 * scale]);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.setLineDash([]);
    const len = lane.vec.len;
    for (let s = 90; s < len - 40; s += 180) {
      const [cx, cy] = w2c(view, ...pointAt(lane, lane.vec, s));
      const [tx, ty] = w2c(view, ...pointAt(lane, lane.vec, s + 26));
      ctx.fillStyle = 'rgba(232,236,241,0.5)';
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      const ang = Math.atan2(ty - cy, tx - cx);
      ctx.lineTo(tx - 9 * scale * Math.cos(ang - 0.45), ty - 9 * scale * Math.sin(ang - 0.45));
      ctx.lineTo(tx - 9 * scale * Math.cos(ang + 0.45), ty - 9 * scale * Math.sin(ang + 0.45));
      ctx.closePath(); ctx.fill();
    }
    // entry label: NO SIGNAL for uncontrolled traffic entering at the map edge (not for ring /
    // exit lanes, which only carry vehicles that transferred onto them)
    const onEdge = lane.from[0] === 0 || lane.from[0] === WORLD_W || lane.from[1] === 0 || lane.from[1] === WORLD_H;
    if (lane.signals.length === 0 && lane.events.length > 0 && onEdge) {
      const [ex, ey] = w2c(view, lane.from[0] + lane.vec.ux * 34, lane.from[1] + lane.vec.uy * 34);
      ctx.fillStyle = '#ff8a5c';
      ctx.font = `700 ${Math.max(10, 13 * scale)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('NO SIGNAL', ex, ey);
    }
  }

  // roundabout hints: dashed ring over lanes that receive transfers, yield triangles at merges
  const ringLaneIds = new Set();
  const yieldPoints = [];
  for (const lane of prepped.lanes) {
    for (const ev of lane.events) {
      for (const seg of ev.routeSegs ?? []) {
        if (seg.transfer) {
          ringLaneIds.add(seg.transfer.laneId);
          if (seg.transfer.baseS > 1e-9) {
            yieldPoints.push(pointAt(lane, lane.vec, seg.exitS));
          }
        }
      }
    }
  }
  if (ringLaneIds.size >= 3) {
    // the ring itself: transfer-target lanes with both endpoints inside the world (exits and
    // approaches touch the map edge and must not skew the ring's center/radius)
    const interior = (p) => p[0] > 0 && p[0] < WORLD_W && p[1] > 0 && p[1] < WORLD_H;
    const ringLanes = prepped.lanes.filter((l) => ringLaneIds.has(l.id) && interior(l.from) && interior(l.to));
    if (ringLanes.length >= 3) {
    const cx = ringLanes.reduce((a, l) => a + (l.from[0] + l.to[0]) / 2, 0) / ringLanes.length;
    const cy = ringLanes.reduce((a, l) => a + (l.from[1] + l.to[1]) / 2, 0) / ringLanes.length;
    const radius = Math.max(...ringLanes.map((l) => l.vec.len)) * 0.42;
    const [ccx, ccy] = w2c(view, cx, cy);
    ctx.strokeStyle = 'rgba(154,164,178,0.4)';
    ctx.lineWidth = Math.max(1, 1.5 * scale);
    ctx.setLineDash([6 * scale, 6 * scale]);
    ctx.beginPath(); ctx.arc(ccx, ccy, radius * scale, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(154,164,178,0.55)';
    ctx.font = `700 ${Math.max(9, 11 * scale)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('ROUNDABOUT', ccx, ccy);
    }
  }
  for (const p of yieldPoints) {
    const [px, py] = w2c(view, p[0], p[1]);
    const s2 = 7 * scale;
    ctx.beginPath();
    ctx.moveTo(px, py - s2); ctx.lineTo(px + s2, py + s2); ctx.lineTo(px - s2, py + s2);
    ctx.closePath();
    ctx.fillStyle = '#ffd54a';
    ctx.fill();
  }

  // stop lines (front-bumper boundary) + signal heads
  const layout = signalLayout(prepped, view);
  for (const sig of prepped.signals) {
    const lay = layout.find((l) => l.id === sig.id);
    for (const lane of sig.laneObjs) {
      const [sx, sy] = w2c(view, ...pointAt(lane, lane.vec, sig.stopS));
      const perp = lane.vec.axis === 'v' ? [1, 0] : [0, 1];
      ctx.strokeStyle = '#f5f7fa';
      ctx.lineWidth = Math.max(2, 5 * scale);
      ctx.beginPath();
      ctx.moveTo(sx - perp[0] * ROAD_HALF * scale, sy - perp[1] * ROAD_HALF * scale);
      ctx.lineTo(sx + perp[0] * ROAD_HALF * scale, sy + perp[1] * ROAD_HALF * scale);
      ctx.stroke();
    }
  }
  for (const sig of prepped.signals) {
    const lay = layout.find((l) => l.id === sig.id);
    const green = state ? state.signals.find((s) => s.id === sig.id)?.state === 'green' : false;
    // callout lines to each stop line
    ctx.strokeStyle = 'rgba(232,236,241,0.4)';
    ctx.lineWidth = Math.max(1, 1.5 * scale);
    for (const p of lay.stopPoints) {
      const [px, py] = w2c(view, p[0], p[1]);
      const [hx, hy] = w2c(view, lay.x, lay.y);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(hx, hy); ctx.stroke();
    }
    const [hx, hy] = w2c(view, lay.x, lay.y);
    const hr = lay.r * scale;
    ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2);
    ctx.fillStyle = '#11141a'; ctx.fill();
    ctx.lineWidth = Math.max(2, 3 * scale);
    ctx.strokeStyle = green ? '#43d17c' : '#ff5252';
    ctx.stroke();
    ctx.beginPath(); ctx.arc(hx, hy, hr * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = green ? '#43d17c' : '#ff5252';
    ctx.fill();
    ctx.fillStyle = '#e8ecf1';
    ctx.font = `800 ${Math.max(12, hr * 0.75)}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(sig.id, hx, hy - hr * 0.0);
    // state label explains red/green beyond color
    ctx.font = `700 ${Math.max(9, 10 * scale)}px system-ui, sans-serif`;
    ctx.fillStyle = green ? '#43d17c' : '#ff5252';
    ctx.fillText(green ? 'GREEN' : 'RED', hx, hy + hr + Math.max(8, 9 * scale));
    ctx.textBaseline = 'alphabetic';
  }

  // vehicles
  if (state) {
    const collisionIds = new Set(opts.collisionVehicles ?? []);
    const waitingReq = opts.waitingRequiredIds ?? new Set();
    for (const lane of state.lanes) {
      // waiting queue badge at entry
      const reqWaiting = lane.queue.filter((e) => e.required).length;
      if (lane.queue.length) {
        const [ex, ey] = w2c(view, lane.def.from[0] + lane.def.vec.ux * 52, lane.def.from[1] + lane.def.vec.uy * 52);
        const limit = lane.def.queueLimit;
        const full = Number.isFinite(limit) && lane.queue.length >= limit;
        ctx.fillStyle = full ? '#ff5252' : reqWaiting ? '#ffd54a' : '#9aa4b2';
        ctx.font = `700 ${Math.max(10, 12 * scale)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        const cap = Number.isFinite(limit) ? `/${limit}` : '';
        ctx.fillText(`⏳${lane.queue.length}${cap}${reqWaiting ? ` (${reqWaiting}◆)` : ''}`, ex, ey);
      }
      for (const veh of lane.vehicles) {
        const r = vehicleRect(lane.def, lane.def.vec, veh.s, veh.length, veh.width);
        const [x, y] = w2c(view, r.x, r.y);
        const wpx = r.w * scale, hpx = r.h * scale;
        // vehicle keeps its color for the whole route; collided vehicles flash red
        ctx.fillStyle = collisionIds.has(veh.id) ? '#ff2d2d' : VEHICLE_COLORS[veh.colorIdx % VEHICLE_COLORS.length];
        if (veh.type === 'bus' && !collisionIds.has(veh.id)) ctx.fillStyle = '#a8c6e8';
        roundRect(ctx, x, y, wpx, hpx, Math.min(6 * scale, wpx / 4));
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = Math.max(1, scale);
        ctx.stroke();
        // windows hint along the body
        ctx.fillStyle = 'rgba(10,14,20,0.55)';
        if (lane.def.vec.axis === 'h') ctx.fillRect(x + wpx * 0.2, y + hpx * 0.2, wpx * 0.6, hpx * 0.28);
        else ctx.fillRect(x + wpx * 0.2, y + hpx * 0.2, wpx * 0.6, hpx * 0.28);
        // required roof diamond
        if (veh.required) {
          const [cx, cy] = w2c(view, r.x + r.w / 2, r.y + r.h / 2);
          const d = Math.max(4, 6 * scale);
          ctx.beginPath();
          ctx.moveTo(cx, cy - d); ctx.lineTo(cx + d, cy); ctx.lineTo(cx, cy + d); ctx.lineTo(cx - d, cy);
          ctx.closePath();
          ctx.fillStyle = waitingReq.has(veh.id) ? '#ff5252' : '#ffd54a';
          ctx.fill();
        }
        if (collisionIds.has(veh.id)) {
          const [cx, cy] = w2c(view, r.x + r.w / 2, r.y + r.h / 2);
          ctx.beginPath(); ctx.arc(cx, cy, Math.max(wpx, hpx) * 0.8, 0, Math.PI * 2);
          ctx.strokeStyle = '#ff2d2d'; ctx.lineWidth = Math.max(3, 4 * scale); ctx.stroke();
        }
      }
    }
  }
  ctx.textBaseline = 'alphabetic';
}

export function drawPreview(ctx, view, prepped) {
  drawWorld(ctx, view, prepped, null, {});
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
