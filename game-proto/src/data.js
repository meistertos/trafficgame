// Pack loading + structural/semantic validation (spec §6). No dependencies; works in browser and node.
import { laneVector, deriveCrossings, pointAt } from './geometry.js';
import { timeToTick, VEHICLE_TYPES, SIGNAL_IDS } from './constants.js';

// Parse an event route: ["lane", "lane@s", {lane, untilS}, ...]. Returns segments or null.
function parseRoute(route, laneById, ctx, err) {
  if (!Array.isArray(route) || route.length === 0) { err(`${ctx}: route must be a non-empty array`); return null; }
  const segs = [];
  for (const seg of route) {
    let lid;
    let untilS;
    if (typeof seg === 'string') {
      const at = seg.indexOf('@');
      if (at >= 0) { lid = seg.slice(0, at); untilS = Number(seg.slice(at + 1)); } else { lid = seg; }
    } else if (seg && typeof seg === 'object') { lid = seg.lane; untilS = seg.untilS; }
    const lane = laneById(lid);
    if (!lane) { err(`${ctx}: route references unknown lane ${lid}`); return null; }
    const exitS = untilS === undefined ? lane.vec.len : untilS;
    if (!(exitS > 0 && exitS <= lane.vec.len + 1e-9)) { err(`${ctx}: route untilS ${untilS} outside lane ${lid}`); return null; }
    segs.push({ lane, untilS: exitS });
  }
  return segs;
}

// True when the point at exitS on laneA lies on laneB (a legal transfer point).
function transferOK(laneA, exitS, laneB) {
  const [px, py] = pointAt(laneA, laneA.vec, exitS);
  let s;
  let off;
  if (laneB.vec.axis === 'v') { s = (py - laneB.from[1]) / laneB.vec.uy; off = Math.abs(px - laneB.from[0]); }
  else { s = (px - laneB.from[0]) / laneB.vec.ux; off = Math.abs(py - laneB.from[1]); }
  return off < 1e-6 && s >= -1e-9 && s <= laneB.vec.len + 1e-9;
}
export function parsePack(text) {
  const pack = JSON.parse(text);
  const errors = validatePack(pack);
  return { pack, errors, ok: errors.length === 0 };
}

export async function loadPack(source) {
  if (typeof window !== 'undefined' && typeof fetch === 'function') {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Failed to load ${source}: ${res.status}`);
    return parsePack(await res.text());
  }
  const { readFile } = await import(/* @vite-ignore */ 'node:fs/promises'); // node-only branch
  return parsePack(await readFile(source, 'utf8'));
}

function isNum(x) { return typeof x === 'number' && Number.isFinite(x); }
function isPoint(p) { return Array.isArray(p) && p.length === 2 && p.every(isNum); }

// Structural + semantic validation. Returns a list of human-readable errors (empty = valid).
export function validatePack(pack) {
  const E = [];
  const err = (m) => E.push(m);

  if (!pack || typeof pack !== 'object') return ['pack is not an object'];
  if (pack.schemaVersion !== 1) err('schemaVersion must be 1');
  if (typeof pack.$schema !== 'string') err('$schema must be a string');
  const rules = pack.rules;
  if (!rules || typeof rules !== 'object') return [...E, 'missing rules'];
  if (!Number.isInteger(rules.tickRate) || rules.tickRate < 1) err('rules.tickRate must be a positive integer');
  const W = rules.world;
  if (!W || !(W.width > 0) || !(W.height > 0)) err('rules.world needs positive width/height');
  if (!(rules.minGap >= 0)) err('rules.minGap must be >= 0');
  if (rules.queueLimit !== undefined && !(Number.isInteger(rules.queueLimit) && rules.queueLimit >= 1)) {
    err('rules.queueLimit must be an integer >= 1');
  }
  const types = rules.vehicleTypes;
  if (!types || typeof types !== 'object' || Object.keys(types).length === 0) {
    err('rules.vehicleTypes must be a non-empty object');
  } else {
    for (const [name, t] of Object.entries(types)) {
      if (!(t.length > 0) || !(t.width > 0)) err(`vehicleTypes.${name} needs positive length/width`);
    }
  }
  if (!Array.isArray(pack.levels) || pack.levels.length === 0) return [...E, 'levels must be a non-empty array'];

  const levelIds = new Set();
  for (const level of pack.levels) {
    const L = level.id ?? '?';
    const ctx = `level ${L}`;
    if (typeof level.id !== 'string' || !level.id) err(`${ctx}: missing id`);
    if (levelIds.has(level.id)) err(`${ctx}: duplicate level id`);
    levelIds.add(level.id);
    for (const f of ['title', 'lesson']) if (typeof level[f] !== 'string') err(`${ctx}: ${f} must be a string`);
    if (!(level.deadline > 0)) err(`${ctx}: deadline must be > 0`);
    if (!Number.isInteger(level.requiredCount) || level.requiredCount < 0) err(`${ctx}: requiredCount must be a non-negative integer`);
    if (level.queueLimit !== undefined && !(Number.isInteger(level.queueLimit) && level.queueLimit >= 1)) {
      err(`${ctx}: queueLimit must be an integer >= 1`);
    }
    if (!Array.isArray(level.lanes) || level.lanes.length === 0) err(`${ctx}: needs lanes`);

    // Lanes used as route targets (ring lanes, merge points) may have interior entries/exits.
    const routeEntryOK = new Set();
    const routeExitOK = new Set();
    for (const stream of level.streams ?? []) {
      for (const ev of stream.events ?? []) {
        if (!Array.isArray(ev.route)) continue;
        ev.route.forEach((seg, i) => {
          const lid = typeof seg === 'string' ? seg.split('@')[0] : seg?.lane;
          if (!lid) return;
          if (i > 0 || ev.loop) routeEntryOK.add(lid);
          if (i < ev.route.length - 1 || ev.loop) routeExitOK.add(lid);
        });
      }
    }
    const laneIds = new Set();
    const prepped = [];
    for (const lane of level.lanes ?? []) {
      const id = lane.id ?? '?';
      if (laneIds.has(id)) err(`${ctx}: duplicate lane id ${id}`);
      laneIds.add(id);
      if (!isPoint(lane.from) || !isPoint(lane.to)) { err(`${ctx}: lane ${id} needs from/to points`); continue; }
      if (!(lane.speed > 0)) err(`${ctx}: lane ${id} speed must be > 0`);
      // Axis alignment
      if (lane.from[0] !== lane.to[0] && lane.from[1] !== lane.to[1]) err(`${ctx}: lane ${id} must be axis-aligned`);
      const vec = laneVector(lane);
      if (!(vec.len > 0)) { err(`${ctx}: lane ${id} has zero length`); continue; }
      // Entries and exits lie on the world boundary
      const onBoundary = (p) => p[0] === 0 || p[0] === W.width || p[1] === 0 || p[1] === W.height;
      // boundary required unless the lane endpoint is a route transfer point (ring/merge)
      if (!onBoundary(lane.from) && !routeEntryOK.has(id)) err(`${ctx}: lane ${id} entry must lie on the world boundary`);
      if (!onBoundary(lane.to) && !routeExitOK.has(id)) err(`${ctx}: lane ${id} exit must lie on the world boundary`);
      // Exit must leave the world (not bounce back inside along the same edge)
      const inX = (p) => p[0] >= 0 && p[0] <= W.width;
      const inY = (p) => p[1] >= 0 && p[1] <= W.height;
      if (!inX(lane.from) || !inY(lane.from) || !inX(lane.to) || !inY(lane.to)) err(`${ctx}: lane ${id} points outside world`);
      prepped.push({ ...lane, vec });
    }

    const signalIds = new Set();
    const laneSignalStops = new Map(); // laneId -> [stopS]
    for (const sig of level.signals ?? []) {
      const id = sig.id ?? '?';
      if (!SIGNAL_IDS.includes(id)) err(`${ctx}: signal id must be one of A-D, got ${id}`);
      if (signalIds.has(id)) err(`${ctx}: duplicate signal id ${id}`);
      signalIds.add(id);
      if (!Array.isArray(sig.lanes) || sig.lanes.length === 0) { err(`${ctx}: signal ${id} needs lanes`); continue; }
      const axes = new Set();
      for (const lid of sig.lanes) {
        const lane = prepped.find((l) => l.id === lid);
        if (!lane) { err(`${ctx}: signal ${id} references unknown lane ${lid}`); continue; }
        // Valid stop line within the lane
        if (!(sig.stopS > 0 && sig.stopS < lane.vec.len)) err(`${ctx}: signal ${id} stopS ${sig.stopS} outside lane ${lid} (0, ${lane.vec.len})`);
        axes.add(lane.vec.axis);
        const arr = laneSignalStops.get(lid) ?? [];
        arr.push(sig.stopS);
        laneSignalStops.set(lid, arr);
      }
      // Grouped signal alignment: grouped lanes share one stopS, so they must run in the same
      // direction at the same speed from the same entry line (otherwise the shared stopS would sit
      // at different world positions, which the runtime cannot express).
      if (axes.size > 1) err(`${ctx}: [GROUP_MISALIGNED] signal ${id} groups lanes with different axes`);
      else {
        const gl = sig.lanes.map((lid) => prepped.find((l) => l.id === lid)).filter(Boolean);
        for (const l of gl.slice(1)) {
          const f = gl[0];
          const sameDir = l.vec.ux === f.vec.ux && l.vec.uy === f.vec.uy;
          const entryAligned = f.vec.axis === 'v' ? l.from[1] === f.from[1] : l.from[0] === f.from[0];
          if (!sameDir) err(`${ctx}: [GROUP_MISALIGNED] signal ${id} groups ${f.id} and ${l.id} with opposite directions`);
          else if (!entryAligned) err(`${ctx}: [GROUP_MISALIGNED] signal ${id} groups ${f.id} and ${l.id} whose entries are not aligned, so stopS ${sig.stopS} is at different world positions`);
          if (l.speed !== f.speed) err(`${ctx}: [GROUP_MISALIGNED] signal ${id} groups ${f.id} and ${l.id} with different speeds`);
        }
      }
    }
    // Same-lane signal ordering: distinct stopS per lane
    for (const [lid, stops] of laneSignalStops) {
      if (new Set(stops).size !== stops.length) err(`${ctx}: lane ${lid} has two signals with the same stopS`);
    }
    // Attach signal refs to lanes
    for (const lane of prepped) {
      lane.signals = (level.signals ?? []).filter((s) => s.lanes.includes(lane.id));
    }

    // Streams and events
    const eventIds = new Set();
    let requiredEvents = 0;
    let anyRequiredRepeat = false;
    for (const stream of level.streams ?? []) {
      const sid = stream.id ?? '?';
      const lane = prepped.find((l) => l.id === stream.lane);
      if (!lane) { err(`${ctx}: stream ${sid} references unknown lane ${stream.lane}`); continue; }
      if (typeof stream.required !== 'boolean') err(`${ctx}: stream ${sid} required must be boolean`);
      if (stream.repeat !== undefined) {
        const rp = stream.repeat;
        if (!rp || typeof rp !== 'object' || !(rp.every > 0)) err(`${ctx}: stream ${sid} repeat.every must be > 0`);
        if (!types || !rp || !types[rp.type]) err(`${ctx}: stream ${sid} repeat.type unknown`);
        if (stream.required) anyRequiredRepeat = true;
      }
      for (const ev of stream.events ?? []) {
        if (eventIds.has(ev.id)) err(`${ctx}: duplicate event id ${ev.id}`);
        eventIds.add(ev.id);
        if (!(ev.at >= 0)) err(`${ctx}: event ${ev.id} at must be >= 0`);
        if (!types || !types[ev.type]) err(`${ctx}: event ${ev.id} has unknown type ${ev.type}`);
        if (ev.route !== undefined) {
          const segs = parseRoute(ev.route, (lid) => prepped.find((l) => l.id === lid), `${ctx} event ${ev.id}`, err);
          if (segs) {
            if (segs[0].lane.id !== stream.lane) err(`${ctx}: event ${ev.id} route must start on its stream lane ${stream.lane}`);
            for (let i = 0; i + 1 < segs.length; i++) {
              if (!transferOK(segs[i].lane, segs[i].untilS, segs[i + 1].lane)) {
                err(`${ctx}: event ${ev.id} route ${segs[i].lane.id} -> ${segs[i + 1].lane.id} not connected at s=${segs[i].untilS}`);
              }
            }
            if (ev.loop && !transferOK(segs[segs.length - 1].lane, segs[segs.length - 1].untilS, segs[0].lane)) {
              err(`${ctx}: event ${ev.id} loop is not connected`);
            }
          }
        }
        if (stream.required) requiredEvents++;
      }
    }
    // Objective totals: with only explicit events, requiredCount must equal the required
    // event count; with a repeating required stream, requiredCount is a target that must be
    // reachable from the scheduled required vehicles (explicit + repeat tail before the deadline).
    if (anyRequiredRepeat) {
      let available = 0;
      for (const stream of level.streams ?? []) {
        if (!stream.required) continue;
        const evs = stream.events ?? [];
        available += evs.length;
        if (stream.repeat && stream.repeat.every > 0) {
          const last = evs.length ? evs[evs.length - 1].at : 0;
          available += Math.max(0, Math.floor((level.deadline - last) / stream.repeat.every + 1e-9));
        }
      }
      if (!(level.requiredCount >= 1)) err(`${ctx}: [REQUIRED_COUNT_MISMATCH] requiredCount must be >= 1`);
      else if (level.requiredCount > available) err(`${ctx}: [REQUIRED_COUNT_MISMATCH] requiredCount ${level.requiredCount} exceeds the ${available} required vehicles scheduled before the deadline`);
    } else if (level.requiredCount !== requiredEvents) {
      err(`${ctx}: [REQUIRED_COUNT_MISMATCH] requiredCount ${level.requiredCount} != required events ${requiredEvents}`);
    }

    // Crossing geometry. halfW: widest vehicle half-width (the perpendicular conflict band).
    const crossings = deriveCrossings(prepped);
    const halfW = types ? Math.max(...Object.values(types).map((t) => (t.width > 0 ? t.width / 2 : 0))) : 0;
    // Longest vehicle that can travel on each lane (stream lane + every lane on its routes).
    const laneMaxLen = new Map();
    const noteLen = (lid, type) => {
      if (lid && types?.[type]) laneMaxLen.set(lid, Math.max(laneMaxLen.get(lid) ?? 0, types[type].length));
    };
    for (const stream of level.streams ?? []) {
      const evs = stream.events ?? [];
      const repeatRoute = evs.find((e) => Array.isArray(e.route))?.route;
      const all = [...evs, ...(stream.repeat ? [{ type: stream.repeat.type, route: repeatRoute }] : [])];
      for (const ev of all) {
        noteLen(stream.lane, ev.type);
        for (const sg of Array.isArray(ev.route) ? ev.route : []) noteLen(typeof sg === 'string' ? sg.split('@')[0] : sg?.lane, ev.type);
      }
    }
    const maxLenOnLane = (lid) => laneMaxLen.get(lid) ?? 0;
    // Stop lines: a vehicle stopped at stopS must be fully inside the map and must not overlap
    // any crossing's conflict band (spec: STOP_INSIDE_CONFLICT).
    for (const sig of level.signals ?? []) {
      for (const lid of sig.lanes ?? []) {
        const lane = prepped.find((l) => l.id === lid);
        if (!lane) continue;
        const len = maxLenOnLane(lid);
        if (len > 0 && sig.stopS < len) err(`${ctx}: [STOP_INSIDE_CONFLICT] signal ${sig.id} stopS ${sig.stopS} on ${lid} is shorter than its longest vehicle (${len}); a newly admitted vehicle would already be past it`);
        for (const c of crossings) {
          if (!c.lanes.includes(lid)) continue;
          const cs = c.s[lid];
          if (sig.stopS > cs - halfW + 1e-9 && sig.stopS - len < cs + halfW - 1e-9) {
            err(`${ctx}: [STOP_INSIDE_CONFLICT] signal ${sig.id} stopS ${sig.stopS} on ${lid}: a stopped vehicle would overlap the crossing at ${c.point}`);
          }
        }
      }
    }
    // Uncontrolled-conflict rejection (editor v1 rule, spec §6). A lane only counts as controlled at
    // a crossing if one of its signals stops traffic before that crossing. Lanes reached via
    // routes carry traffic too.
    const streamed = new Set((level.streams ?? []).map((s) => s.lane));
    for (const stream of level.streams ?? []) {
      for (const ev of stream.events ?? []) {
        for (const sg of Array.isArray(ev.route) ? ev.route : []) streamed.add(typeof sg === 'string' ? sg.split('@')[0] : sg?.lane);
      }
    }
    const controlledAt = (lid, cs) => (level.signals ?? []).some((sg) => sg.lanes?.includes(lid) && sg.stopS <= cs - halfW + 1e-9);
    for (const c of crossings) {
      const [a, b] = c.lanes;
      if (!controlledAt(a, c.s[a]) && !controlledAt(b, c.s[b]) && streamed.has(a) && streamed.has(b)) {
        err(`${ctx}: [UNCONTROLLED_CONFLICT] crossing at ${c.point} has two uncontrolled conflicting streams (${a} x ${b}); rejected in v1`);
      }
    }

    // referenceSolution: known signal ids, ordered non-overlapping half-open windows
    const rs = level.referenceSolution;
    if (!rs || typeof rs !== 'object' || !rs.windows) { err(`${ctx}: missing referenceSolution.windows`); }
    else {
      for (const [sid, wins] of Object.entries(rs.windows)) {
        if (!signalIds.has(sid)) err(`${ctx}: [UNKNOWN_REFERENCE] referenceSolution references unknown signal ${sid}`);
        if (!Array.isArray(wins)) { err(`${ctx}: windows for ${sid} must be an array`); continue; }
        let prevEnd = -Infinity;
        for (const w of wins) {
          if (!Array.isArray(w) || w.length !== 2 || !isNum(w[0]) || !isNum(w[1]) || !(w[0] < w[1]) || w[0] < 0) {
            err(`${ctx}: invalid window ${JSON.stringify(w)} for ${sid}`);
            continue;
          }
          if (w[0] < prevEnd) err(`${ctx}: windows for ${sid} must be sorted and non-overlapping (${JSON.stringify(w)} starts before ${prevEnd})`);
          prevEnd = w[1];
        }
      }
    }
  }
  return E;
}

// Attach derived runtime data to a validated level (vectors, sorted events with dueTick, crossings).
export function prepareLevel(level, rules) {
  const tickRate = rules.tickRate;
  const rawLanes = level.lanes.map((lane) => ({ ...lane, vec: laneVector(lane) }));
  const rawById = new Map(rawLanes.map((l) => [l.id, l]));

  // Build route segments with transfer info: [{laneId, exitS, transfer:{laneId, baseS}|null}]
  function buildRouteSegs(ev) {
    if (!Array.isArray(ev.route)) return null;
    const segs = parseRoute(ev.route, (id) => rawById.get(id), 'prep', () => {});
    if (!segs) return null;
    return segs.map((s, i, arr) => {
      const next = i + 1 < arr.length ? arr[i + 1].lane : (ev.loop ? arr[0].lane : null);
      let transfer = null;
      if (next) {
        const [px, py] = pointAt(s.lane, s.lane.vec, s.untilS);
        const baseS = next.vec.axis === 'v'
          ? (py - next.from[1]) / next.vec.uy
          : (px - next.from[0]) / next.vec.ux;
        transfer = { laneId: next.id, baseS: Math.max(0, Math.min(next.vec.len, baseS)) };
      }
      return { laneId: s.lane.id, exitS: s.untilS, transfer };
    });
  }

  const lanes = rawLanes.map((lane) => {
    const events = [];
    for (const stream of level.streams.filter((s) => s.lane === lane.id)) {
      const proto = stream.events.find((e) => e.route || e.loop);
      for (const ev of stream.events) {
        events.push({ ...ev, streamId: stream.id, required: stream.required, dueTick: timeToTick(ev.at, tickRate), routeSegs: buildRouteSegs(ev) });
      }
      // Deterministic repeat tail: after the last explicit event, one vehicle every
      // `repeat.every` seconds until the deadline (still a fixed schedule per retry).
      if (stream.repeat && stream.repeat.every > 0) {
        let t = stream.events.length ? stream.events[stream.events.length - 1].at : 0;
        let k = 1;
        while (t + stream.repeat.every <= level.deadline + 1e-9) {
          t += stream.repeat.every;
          const rep = { id: `${stream.id}-r${k++}`, at: t, type: stream.repeat.type, streamId: stream.id, required: stream.required, dueTick: timeToTick(t, tickRate) };
          if (proto) { if (proto.route) rep.route = proto.route; if (proto.loop) rep.loop = true; }
          rep.routeSegs = buildRouteSegs(rep);
          events.push(rep);
        }
      }
    }
    // FIFO sorted by requested time then event ID (spec §4.3 step 2)
    events.sort((a, b) => (a.at - b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const signals = level.signals.filter((s) => s.lanes.includes(lane.id));
    const queueLimit = level.queueLimit ?? rules.queueLimit ?? Infinity;
    return { ...lane, events, signals, queueLimit };
  });
  const crossings = deriveCrossings(lanes);
  const laneById = new Map(lanes.map((l) => [l.id, l]));
  for (const c of crossings) {
    for (const lid of c.lanes) laneById.get(lid).crossings = (laneById.get(lid).crossings ?? []).concat([c]);
  }
  return {
    ...level,
    rules,
    lanes,
    laneById,
    signals: level.signals.map((s) => ({ ...s, laneObjs: s.lanes.map((id) => laneById.get(id)) })),
    crossings,
    deadlineTicks: Math.round(level.deadline * tickRate),
  };
}

export { VEHICLE_TYPES };
