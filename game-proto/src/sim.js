// Pure simulation engine (spec §4). No DOM, no wall clock, no randomness.
// Tick order per §4.3: commands → spawns → admission → movement/commitment → swept collisions → exits → outcome.
import { TICK_RATE, MIN_GAP, timeToTick, tickToTime, VEHICLE_COLORS } from './constants.js';
import { laneVector, pointAt, vehicleRect, sweptOverlap, rectsOverlapStrict } from './geometry.js';

export function createState(prepped) {
  const lanes = prepped.lanes.map((l) => ({ def: l, queue: [], vehicles: [], nextEvent: 0 }));
  return {
    level: prepped,
    debug: false,
    tick: 0,
    signals: prepped.signals.map((s) => ({ id: s.id, state: 'red' })), // all signals begin red
    lanes,
    laneById: new Map(lanes.map((l) => [l.def.id, l])),
    pending: [], // {tick, order, signalId, to} — applied in stable recorded order
    commandLog: [],
    vehSeq: 0,
    requiredTarget: prepped.requiredCount,
    requiredCleared: 0,
    totalExited: 0,
    outcome: null, // {type:'collision'|'win'|'timeout', tick, time, ...}
  };
}

export function signalState(state, signalId) {
  return state.signals.find((s) => s.id === signalId)?.state;
}

function setSignal(state, signalId, to) {
  const s = state.signals.find((x) => x.id === signalId);
  if (s) s.state = to;
}

// Queue a signal command for a tick (default: the current tick).
export function queueCommand(state, signalId, to, tick = state.tick) {
  state.pending.push({ tick, order: state.pending.length, signalId, to });
  state.commandLog.push({ tick, signalId, to });
}

// Reference windows → commands. A tick is green when its start time lies in a half-open
// window [start, end), using the epsilon-safe conversion (spec §6).
export function windowsToCommands(level, tickRate = TICK_RATE) {
  const cmds = [];
  const windows = level.referenceSolution?.windows ?? {};
  for (const [signalId, wins] of Object.entries(windows)) {
    for (const [start, end] of wins) {
      const t0 = timeToTick(start, tickRate);
      const t1 = timeToTick(end, tickRate);
      cmds.push({ tick: t0, signalId, to: 'green' });
      cmds.push({ tick: t1, signalId, to: 'red' });
    }
  }
  cmds.sort((a, b) => a.tick - b.tick); // Array.sort is stable: same-tick order = recorded order
  return cmds;
}

export function replayCommands(prepped, commands) {
  const state = createState(prepped);
  for (const c of commands) queueCommand(state, c.signalId, c.to, c.tick);
  return state;
}

export function replayWindows(prepped) {
  return replayCommands(prepped, windowsToCommands(prepped));
}

// Run the simulation to its outcome. onStep(ev) is called after every tick (debug/validation).
export function runToEnd(state, { onStep } = {}) {
  const limit = state.level.deadlineTicks;
  while (!state.outcome && state.tick <= limit) {
    const ev = step(state);
    if (onStep) onStep(ev, state);
  }
  if (!state.outcome) {
    state.outcome = { type: 'timeout', tick: limit, time: tickToTime(limit) };
  }
  return state.outcome;
}

// Lane band half-width used for "is this body still on that lane?" tests: the widest vehicle.
function maxHalfWidth(level) {
  if (level._maxHalfW === undefined) {
    level._maxHalfW = Math.max(...Object.values(level.rules.vehicleTypes).map((ty) => ty.width / 2));
  }
  return level._maxHalfW;
}

// Ghost leaders (route transfers). A vehicle that just turned/merged/diverged off lane L keeps a
// body footprint inside L's band for a few ticks (its rectangle rotates at the transfer point).
// Followers on L must treat that footprint as their leader, otherwise a car following at the
// legal minGap drives into the rotated body. Returns Map laneId -> [{veh, rearS}] and clears
// prevLaneId once the body has left the old lane's band.
function computeGhosts(state, halfW) {
  const ghosts = new Map();
  for (const lane of state.lanes) {
    for (const v of lane.vehicles) {
      if (!v.prevLaneId) continue;
      const L = state.laneById.get(v.prevLaneId);
      if (!L) { v.prevLaneId = null; continue; }
      const r = vehicleRect(lane.def, lane.def.vec, v.s, v.length, v.width);
      const Ld = L.def;
      let inBand;
      let a0;
      let a1; // body extent along L, in L's s coordinate
      if (Ld.vec.axis === 'h') {
        const cy = Ld.from[1];
        inBand = r.y < cy + halfW - 1e-9 && r.y + r.h > cy - halfW + 1e-9;
        a0 = (r.x - Ld.from[0]) * Ld.vec.ux; a1 = (r.x + r.w - Ld.from[0]) * Ld.vec.ux;
      } else {
        const cx = Ld.from[0];
        inBand = r.x < cx + halfW - 1e-9 && r.x + r.w > cx - halfW + 1e-9;
        a0 = (r.y - Ld.from[1]) * Ld.vec.uy; a1 = (r.y + r.h - Ld.from[1]) * Ld.vec.uy;
      }
      const rearS = Math.min(a0, a1);
      if (!inBand || rearS >= Ld.vec.len) { v.prevLaneId = null; continue; }
      const arr = ghosts.get(L.def.id) ?? [];
      arr.push({ veh: v, rearS });
      ghosts.set(L.def.id, arr);
    }
  }
  return ghosts;
}

export function step(state) {
  const t = state.tick;
  const gap = state.level.rules.minGap;
  const types = state.level.rules.vehicleTypes;
  const halfW = maxHalfWidth(state.level);
  const ev = { tick: t, time: tickToTime(t), spawned: [], admitted: [], moved: [], exited: [], collisions: [] };

  // 1. Apply all queued signal commands due at this tick, in stable recorded order.
  if (state.pending.length) {
    const due = [];
    const later = [];
    for (const c of state.pending) (c.tick <= t ? due : later).push(c);
    due.sort((a, b) => a.tick - b.tick || a.order - b.order);
    state.pending = later;
    for (const c of due) setSignal(state, c.signalId, c.to);
  }

  // 2. Add all due spawn requests to per-lane FIFO entry queues (pre-sorted by time, then id).
  //    Queue is capped per lane (level queueLimit / rules default): a due request arriving at a
  //    full queue is an overflow and ends the run (recorded, then dropped with the failure).
  for (const lane of state.lanes) {
    const evs = lane.def.events;
    const limit = lane.def.queueLimit ?? Infinity;
    while (lane.nextEvent < evs.length && evs[lane.nextEvent].dueTick <= t) {
      const e = evs[lane.nextEvent];
      if (lane.queue.length >= limit) {
        ev.overflow = { lane: lane.def.id, eventId: e.id, queueLength: lane.queue.length, limit };
        break;
      }
      lane.nextEvent++;
      lane.queue.push(e);
      ev.spawned.push(e.id);
    }
  }

  // Ghost leaders from bodies still overlapping the lane they just left (positions at tick start;
  // ghosts only move forward during the tick, so this is conservative and order-independent).
  const ghosts = computeGhosts(state, halfW);

  // 3. Admit at most one waiting vehicle per lane if it fits entirely within the map
  //    with a minGap gap to the rearmost existing vehicle (or ghost body). Never discarded.
  for (const lane of state.lanes) {
    if (!lane.queue.length) continue;
    const cand = lane.queue[0];
    const type = types[cand.type];
    const half = type.length / 2;
    // new vehicle: rear at s=0, center at half, front at length.
    let rearmost = Infinity;
    for (const v of lane.vehicles) rearmost = Math.min(rearmost, v.s - v.half);
    for (const g of ghosts.get(lane.def.id) ?? []) rearmost = Math.min(rearmost, g.rearS);
    let fits = rearmost - gap - type.length >= 0;
    // corner-conflict guard: don't admit a spawn if a vehicle on another lane is about to
    // transfer into this lane at its entry corner (the corner square is single-occupancy)
    for (const other of state.lanes) {
      if (!fits) break;
      if (other === lane) continue;
      for (const v of other.vehicles) {
        const seg = v.route[v.routeIdx];
        if (seg.transfer && seg.transfer.laneId === lane.def.id &&
            Math.abs(seg.transfer.baseS) < 1e-9 &&
            v.s + v.half > seg.exitS - type.length - gap) { fits = false; break; }
      }
    }
    if (fits) {
      lane.queue.shift();
      const veh = {
        id: `v${++state.vehSeq}`,
        eventId: cand.id,
        type: cand.type,
        required: !!cand.required,
        length: type.length,
        width: type.width,
        half,
        s: half,
        oldS: half,
        committed: new Set(),
        laneId: lane.def.id,
        prevLaneId: null,
        route: cand.routeSegs ?? [{ laneId: lane.def.id, exitS: lane.def.vec.len, transfer: null }],
        routeIdx: 0,
        colorIdx: state.vehSeq % VEHICLE_COLORS.length,
        streamId: cand.streamId,
        loop: !!cand.loop,
      };
      lane.vehicles.push(veh);
      ev.admitted.push(veh.id);
    }
  }

  // 4. Move vehicles lane by lane, frontmost first. Clamps never move a vehicle backward.
  for (const lane of state.lanes) {
    const vs = [...lane.vehicles].sort((a, b) => (b.s - a.s) || (a.id < b.id ? -1 : 1));
    const laneGhosts = ghosts.get(lane.def.id) ?? [];
    let leader = null;
    for (const veh of vs) {
      veh.oldS = veh.s;
      const desired = veh.s + lane.def.speed / TICK_RATE;
      let limit = desired;
      // red stop boundaries for signals this vehicle is not committed past
      for (const sig of lane.def.signals) {
        if (signalState(state, sig.id) === 'red' && !veh.committed.has(sig.id)) {
          limit = Math.min(limit, sig.stopS - veh.half);
        }
      }
      // leader constraint: updated leader rear minus gap minus this half length
      if (leader) limit = Math.min(limit, leader.s - leader.half - gap - veh.half);
      // ghost leaders: bodies that left this lane but still overlap it ahead of this vehicle
      for (const g of laneGhosts) {
        if (g.veh !== veh && g.rearS > veh.s) limit = Math.min(limit, g.rearS - gap - veh.half);
      }
      // lookahead across the next route transfer: the nearest vehicle already on the target lane
      // at/after the landing point is a leader in path distance. Vehicles still approaching the
      // landing point from behind (circulating traffic at a merge) are NOT yielded to: entering
      // into them is a real collision the player must avoid.
      const seg = veh.route[veh.routeIdx];
      if (seg.transfer) {
        const tLane = state.laneById.get(seg.transfer.laneId);
        const baseS = seg.transfer.baseS;
        let nearestRear = Infinity;
        for (const v of tLane ? tLane.vehicles : []) {
          if (v !== veh && v.s >= baseS - 1e-9) nearestRear = Math.min(nearestRear, v.s - v.half);
        }
        for (const g of tLane ? (ghosts.get(tLane.def.id) ?? []) : []) {
          if (g.veh !== veh && g.rearS >= baseS - halfW) nearestRear = Math.min(nearestRear, g.rearS);
        }
        if (nearestRear < Infinity) {
          limit = Math.min(limit, seg.exitS + (nearestRear - baseS) - gap - veh.half);
        }
      }
      veh.s = Math.max(veh.s, limit);
      // commitment: front strictly beyond the stop line
      for (const sig of lane.def.signals) {
        if (veh.s + veh.half > sig.stopS) veh.committed.add(sig.id);
      }
      if (seg.transfer && veh.s >= seg.exitS - 1e-9) {
        veh.s = seg.exitS; // cap at the transfer point this tick; the lane change happens below
        veh._xfer = true;
      }
      if (veh.s !== veh.oldS) ev.moved.push(veh.id);
      leader = veh;
    }
    lane.vehicles = vs;
  }

  // Apply lane transfers (turns / merges / diverges / loop wrap). The approach motion on the
  // old lane is swept-checked here so a merge-square conflict is still caught this tick.
  for (const lane of state.lanes) {
    if (!lane.vehicles.some((v) => v._xfer)) continue;
    const staying = [];
    for (const veh of lane.vehicles) {
      if (!veh._xfer) { staying.push(veh); continue; }
      const tr = veh.route[veh.routeIdx].transfer;
      const ra0 = vehicleRect(lane.def, lane.def.vec, veh.oldS, veh.length, veh.width);
      const dA = { x: (veh.s - veh.oldS) * lane.def.vec.ux, y: (veh.s - veh.oldS) * lane.def.vec.uy };
      for (const other of state.lanes) {
        if (other === lane) continue;
        for (const b of other.vehicles) {
          const rb0 = vehicleRect(other.def, other.def.vec, b.oldS, b.length, b.width);
          const dB = { x: (b.s - b.oldS) * other.def.vec.ux, y: (b.s - b.oldS) * other.def.vec.uy };
          if (sweptOverlap(ra0, dA, rb0, dB)) {
            ev.collisions.push({ a: veh.id, b: b.id, laneA: lane.def.id, laneB: other.def.id, eventA: veh.eventId, eventB: b.eventId });
          }
        }
      }
      const tl = state.laneById.get(tr.laneId);
      // landing on an occupied target lane is a collision (same-lane overlap after a transfer)
      const rn = vehicleRect(tl.def, tl.def.vec, tr.baseS, veh.length, veh.width);
      for (const v of tl.vehicles) {
        const rv = vehicleRect(tl.def, tl.def.vec, v.s, v.length, v.width);
        if (rectsOverlapStrict(rn, rv)) {
          ev.collisions.push({ a: veh.id, b: v.id, laneA: tl.def.id, laneB: tl.def.id, eventA: veh.eventId, eventB: v.eventId });
        }
      }
      veh.prevLaneId = lane.def.id;
      veh.laneId = tr.laneId;
      veh.routeIdx = veh.loop ? (veh.routeIdx + 1) % veh.route.length : veh.routeIdx + 1;
      veh.oldS = tr.baseS;
      veh.s = tr.baseS;
      delete veh._xfer;
      tl.vehicles.push(veh);
    }
    lane.vehicles = staying;
  }
  if (state.debug && ev.collisions.length === 0) {
    for (const lane of state.lanes) {
      const vs = [...lane.vehicles].sort((a, b) => (b.s - a.s) || (a.id < b.id ? -1 : 1));
      for (let i = 0; i + 1 < vs.length; i++) {
        const front = vs[i];
        const behind = vs[i + 1];
        if (front.s - front.half - (behind.s + behind.half) < -1e-6) {
          throw new Error(`same-lane overlap on ${lane.def.id}: ${front.id} / ${behind.id} @tick ${t}`);
        }
      }
    }
  }

  // 5. Swept collisions across all lanes over the tick's actual motion, before removals.
  //    Broad phase: per-vehicle swept bounding box rejects far-apart pairs cheaply.
  const lanes = state.lanes;
  const sweptBox = (lane, veh) => {
    const r0 = vehicleRect(lane.def, lane.def.vec, veh.oldS, veh.length, veh.width);
    const r1 = vehicleRect(lane.def, lane.def.vec, veh.s, veh.length, veh.width);
    return {
      x0: Math.min(r0.x, r1.x), y0: Math.min(r0.y, r1.y),
      x1: Math.max(r0.x + r0.w, r1.x + r1.w), y1: Math.max(r0.y + r0.h, r1.y + r1.h),
      r0, d: { x: (veh.s - veh.oldS) * lane.def.vec.ux, y: (veh.s - veh.oldS) * lane.def.vec.uy },
    };
  };
  for (let i = 0; i < lanes.length; i++) {
    for (let j = i + 1; j < lanes.length; j++) {
      const la = lanes[i];
      const lb = lanes[j];
      if (!la.vehicles.length || !lb.vehicles.length) continue;
      const boxesA = la.vehicles.map((v) => sweptBox(la, v));
      const boxesB = lb.vehicles.map((v) => sweptBox(lb, v));
      for (let ai = 0; ai < la.vehicles.length; ai++) {
        for (let bi = 0; bi < lb.vehicles.length; bi++) {
          const ba = boxesA[ai];
          const bb = boxesB[bi];
          if (ba.x1 <= bb.x0 || bb.x1 <= ba.x0 || ba.y1 <= bb.y0 || bb.y1 <= ba.y0) continue;
          const a = la.vehicles[ai];
          const b = lb.vehicles[bi];
          const rb0 = vehicleRect(lb.def, lb.def.vec, b.oldS, b.length, b.width);
          if (sweptOverlap(ba.r0, ba.d, rb0, bb.d)) {
            ev.collisions.push({ a: a.id, b: b.id, laneA: la.def.id, laneB: lb.def.id, eventA: a.eventId, eventB: b.eventId });
          }
        }
      }
    }
  }

  // 6. Remove vehicles whose rear reached/exceeded the lane end; count required once.
  for (const lane of state.lanes) {
    const keep = [];
    for (const veh of lane.vehicles) {
      if (veh.s - veh.half >= lane.def.vec.len - 1e-9) {
        ev.exited.push({ id: veh.id, eventId: veh.eventId, required: veh.required, tick: t, time: tickToTime(t), s: veh.s });
        if (veh.required) state.requiredCleared++;
        state.totalExited++;
      } else {
        keep.push(veh);
      }
    }
    lane.vehicles = keep;
  }

  // 7. Resolve collision first, then success, then queue overflow; timeout is set by the runner.
  //    Win is allowed on the deadline tick and takes priority over a same-tick overflow.
  if (ev.collisions.length) {
    const c = ev.collisions[0];
    state.outcome = {
      type: 'collision', tick: t, time: tickToTime(t),
      vehicles: [c.a, c.b], lanes: [c.laneA, c.laneB], events: [c.eventA, c.eventB],
      allCollisions: ev.collisions,
    };
  } else if (state.requiredCleared >= state.requiredTarget && state.requiredTarget > 0) {
    state.outcome = { type: 'win', tick: t, time: tickToTime(t) };
  } else if (ev.overflow) {
    state.outcome = {
      type: 'overflow', tick: t, time: tickToTime(t),
      lane: ev.overflow.lane, eventId: ev.overflow.eventId, limit: ev.overflow.limit,
    };
  }
  state.tick = t + 1;
  return ev;
}

// --- serialization (checkpoints / pause-resume equivalence) ---

export function serialize(state) {
  return JSON.stringify({
    tick: state.tick,
    signals: state.signals,
    lanes: state.lanes.map((l) => ({
      id: l.def.id,
      queue: l.queue.map((e) => e.id),
      vehicles: l.vehicles.map((v) => ({
        id: v.id, eventId: v.eventId, type: v.type, required: v.required,
        length: v.length, width: v.width, half: v.half, s: v.s, oldS: v.oldS,
        committed: [...v.committed], laneId: v.laneId, prevLaneId: v.prevLaneId ?? null, route: v.route, routeIdx: v.routeIdx, loop: v.loop, colorIdx: v.colorIdx, streamId: v.streamId,
      })),
      nextEvent: l.nextEvent,
    })),
    pending: state.pending,
    commandLog: state.commandLog,
    vehSeq: state.vehSeq,
    requiredCleared: state.requiredCleared,
    totalExited: state.totalExited,
    outcome: state.outcome,
  });
}

export function deserialize(prepped, json) {
  const d = JSON.parse(json);
  const state = createState(prepped);
  state.debug = false;
  state.tick = d.tick;
  state.signals = d.signals;
  const byId = new Map(state.lanes.map((l) => [l.def.id, l]));
  const eventById = new Map();
  for (const lane of prepped.lanes) for (const e of lane.events) eventById.set(e.id, e);
  for (const ld of d.lanes) {
    const lane = byId.get(ld.id);
    lane.queue = ld.queue.map((id) => eventById.get(id));
    lane.nextEvent = ld.nextEvent;
    lane.vehicles = ld.vehicles.map((v) => ({ ...v, committed: new Set(v.committed) }));
  }
  state.pending = d.pending;
  state.commandLog = d.commandLog;
  state.vehSeq = d.vehSeq;
  state.requiredCleared = d.requiredCleared;
  state.totalExited = d.totalExited;
  state.outcome = d.outcome;
  return state;
}

// Stable hash for determinism checks.
export function stateHash(state) {
  const parts = [
    state.tick,
    state.signals.map((s) => `${s.id}:${s.state}`).join(','),
    state.requiredCleared,
    state.totalExited,
    state.outcome ? `${state.outcome.type}@${state.outcome.tick}` : 'none',
    ...state.lanes.map((l) =>
      `${l.def.id}|q${l.queue.length}|n${l.nextEvent}|` +
      l.vehicles.map((v) => `${v.id}:${v.s.toFixed(9)}:${[...v.committed].sort().join('+')}:${v.prevLaneId ?? ''}`).join(';')
    ),
  ];
  return parts.join('\n');
}

// Convenience: run a full game from a prepped level with a list of commands.
export function runCommands(prepped, commands, opts = {}) {
  const state = replayCommands(prepped, commands);
  state.debug = opts.debug ?? false;
  const outcome = runToEnd(state, opts);
  return { state, outcome };
}

export { laneVector, pointAt, rectsOverlapStrict };
