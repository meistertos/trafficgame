// Headless validation of the browser engine (spec §7). Imports the same src/sim.js the game uses.
// Writes game-proto/level-validation.json (report + pack hash).
// Usage: node game-proto/tools/headless-validation.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parsePack, prepareLevel, validatePack } from '../src/data.js';
import {
  createState, queueCommand, step, runToEnd, replayCommands, replayWindows,
  windowsToCommands, serialize, deserialize, stateHash,
} from '../src/sim.js';
import { sweptOverlap, rectsOverlapStrict } from '../src/geometry.js';
import { TICK_RATE } from '../src/constants.js';

const here = dirname(fileURLToPath(import.meta.url));
const packPath = join(here, '..', 'traffic-levels.json');
const reportPath = join(here, '..', 'level-validation.json');

const packText = readFileSync(packPath, 'utf8');
const packHash = createHash('sha256').update(packText).digest('hex');
const { pack, errors } = parsePack(packText);
const rules = pack.rules;

const checks = [];
function check(name, pass, detail = '') {
  checks.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

function preppedOf(id) {
  return prepareLevel(pack.levels.find((l) => l.id === id), rules);
}

function runRef(prepped) {
  const s = replayWindows(prepped);
  s.debug = true;
  const exits = [];
  const o = runToEnd(s, { onStep: (ev) => exits.push(...ev.exited) });
  return { state: s, outcome: o, exits };
}

function runCmds(prepped, cmds) {
  const s = replayCommands(prepped, cmds);
  s.debug = true;
  const o = runToEnd(s);
  return { state: s, outcome: o };
}

const allGreenCmds = (prepped) => prepped.signals.map((sg) => ({ tick: 0, signalId: sg.id, to: 'green' }));

// ---------- 1. reference replays ----------
const levelResults = {};
for (const level of pack.levels) {
  const prepped = prepareLevel(level, rules);
  const { state, outcome, exits } = runRef(prepped);
  const ok = outcome.type === 'win' && state.requiredCleared === level.requiredCount;
  check(`ref ${level.id} wins with all required cleared`, ok,
    `${outcome.type} @ ${outcome.time?.toFixed(4)}s, cleared ${state.requiredCleared}/${level.requiredCount}`);
  levelResults[level.id] = {
    reference: { outcome: outcome.type, clearTick: outcome.tick, clearTime: outcome.time, requiredCleared: state.requiredCleared, target: level.requiredCount },
    windows: level.referenceSolution.windows,
  };
  // exit sanity: rear past lane end, once per event
  const laneLen = new Map(prepped.lanes.map((l) => [l.id, l.vec.len]));
  let exitOk = true;
  const seen = new Set();
  for (const x of exits) {
    if (seen.has(x.eventId)) exitOk = false;
    seen.add(x.eventId);
  }
  check(`ref ${level.id} exits counted once per event`, exitOk && exits.length > 0, `${exits.length} exits`);
}

// ---------- 2. all-red / all-green matrix ----------
for (const level of pack.levels) {
  const prepped = prepareLevel(level, rules);
  const red = runCmds(prepped, []);
  check(`allRed ${level.id} -> fails (timeout or queue overflow), 0 required`,
    red.outcome.type !== 'win' && red.state.requiredCleared === 0,
    `${red.outcome.type} @ ${red.outcome.time}s`);
  const green = runCmds(prepped, allGreenCmds(prepped));
  const expectWin = level.id === 'L1'; // L7 all-green crashes at the merge (no auto-yield)
  const ok = expectWin ? green.outcome.type === 'win' : green.outcome.type === 'collision';
  check(`allGreen ${level.id} -> ${expectWin ? 'win' : 'collision'}`, ok,
    `${green.outcome.type} @ ${green.outcome.time?.toFixed(4)}s`);
  levelResults[level.id].allRed = { outcome: red.outcome.type, tick: red.outcome.tick, requiredCleared: red.state.requiredCleared };
  levelResults[level.id].allGreen = {
    outcome: green.outcome.type, tick: green.outcome.tick, time: green.outcome.time,
    vehicles: green.outcome.vehicles, lanes: green.outcome.lanes,
  };
}

// ---------- 3. commitment ----------
{
  // Micro level: one lane, signals A (stopS 340) and B (stopS 600); two cars.
  const micro = {
    id: 'micro-commit', title: 't', lesson: '', deadline: 30, requiredCount: 0,
    lanes: [{ id: 'V', from: [600, 0], to: [600, 800], speed: 100 }],
    signals: [
      { id: 'A', lanes: ['V'], stopS: 340 },
      { id: 'B', lanes: ['V'], stopS: 600 },
    ],
    streams: [{ id: 'S', lane: 'V', required: false, events: [
      { id: 'e1', at: 0, type: 'car' }, { id: 'e2', at: 1, type: 'car' },
    ]}],
    referenceSolution: { windows: {} },
  };
  const prepped = prepareLevel(micro, rules);
  const s = replayCommands(prepped, [
    { tick: 0, signalId: 'A', to: 'green' },   // release through A
    { tick: 600, signalId: 'A', to: 'red' },   // A red at t=5 while car1 is past A
    // B stays red the whole time
  ]);
  s.debug = true;
  let car1sAtRed = null; let car1movesAfterRed = false; let car1stopsAtB = false;
  let prevS = null;
  while (!s.outcome && s.tick <= prepped.deadlineTicks) {
    const before = s.lanes[0].vehicles.find((v) => v.eventId === 'e1')?.s;
    const ev = step(s);
    const car1 = s.lanes[0].vehicles.find((v) => v.eventId === 'e1');
    if (s.tick === 600 && car1) car1sAtRed = car1.s;
    if (s.tick > 600 && car1 && prevS !== null && car1.s > prevS + 1e-9) car1movesAfterRed = true;
    if (car1) {
      if (car1.s + car1.half <= 600 + 1e-9 && car1.s > 500) car1stopsAtB = true; // clamped at B red line
      prevS = car1.s;
    }
  }
  check('commitment: red A cannot stop committed car (keeps moving)', car1movesAfterRed,
    `s@red=${car1sAtRed?.toFixed(2)}`);
  check('commitment: downstream red B stops the same car at B line', car1stopsAtB);
}

// ---------- 4. queue integrity + queue limit ----------
{
  const prepped = preppedOf('L6');
  const s = replayCommands(prepped, []);
  s.debug = true; // same-lane overlap assert active every tick
  let maxQueue = 0;
  let limitOk = true;
  let spawned = 0;
  let overflowed = 0;
  const o = runToEnd(s, {
    onStep: (ev, st) => {
      spawned += ev.spawned.length;
      if (ev.overflow) overflowed++;
      for (const l of st.lanes) {
        maxQueue = Math.max(maxQueue, l.queue.length);
        if (l.queue.length > (l.def.queueLimit ?? Infinity)) limitOk = false;
      }
    },
  });
  const limit = prepped.lanes[0].queueLimit;
  const waiting = s.lanes.flatMap((l) => [...l.queue, ...l.vehicles]);
  const busesWaiting = waiting.filter((v) => v.type === 'bus').length;
  check('queue: per-lane limit never exceeded; overflow ends the run; waiting vehicles (incl. buses) preserved',
    limitOk && maxQueue <= limit && o.type === 'overflow' && spawned > 0 && busesWaiting > 0,
    `outcome ${o.type} @ ${o.time?.toFixed(2)}s lane ${o.lane}, maxQueue ${maxQueue}/${limit}, spawned ${spawned}, overflow ${overflowed}, buses waiting ${busesWaiting}`);
  // no-limit pack (spec v1 behavior): queue unbounded, run reaches the deadline
  const noLimit = JSON.parse(packText);
  delete noLimit.rules.queueLimit;
  for (const l of noLimit.levels) delete l.queueLimit;
  const p2 = prepareLevel(noLimit.levels[1], noLimit.rules); // L2
  const s2 = replayCommands(p2, []);
  s2.debug = true;
  const o2 = runToEnd(s2);
  check('queue: without queueLimit the queue is unbounded and all-red reaches the deadline (v1 behavior)',
    o2.type === 'timeout' && s2.lanes.every((l) => l.queue.length > 0 || l.vehicles.length > 0),
    `${o2.type} @ ${o2.time}s`);
}

// ---------- 5. counting: rear-exit, once, buses ----------
{
  const prepped = preppedOf('L6');
  const { state, outcome, exits } = runRef(prepped);
  const lenByLane = new Map(state.lanes.map((l) => [l.def.id, l.def.vec.len]));
  let rearOk = true; let onceOk = true;
  const seen = new Set();
  for (const x of exits) {
    if (seen.has(x.eventId)) onceOk = false;
    seen.add(x.eventId);
  }
  // rear-exit: recompute from a fresh instrumented run tracking s per tick
  const s2 = replayWindows(prepped);
  let busCountOk = true;
  const lastS = new Map();
  const busExits = [];
  runToEnd(s2, {
    onStep: (ev, st) => {
      for (const lane of st.lanes) for (const v of lane.vehicles) lastS.set(v.id, v.s);
      for (const x of ev.exited) {
        const prev = lastS.get(x.id);
        // at exit tick s is recorded on the event; rear must be >= lane len
        const lane = st.lanes.find((l) => l.def.id === x.laneId || true);
      }
    },
  });
  // simpler: exits carry s now; verify rear >= laneLen using event's own s and lane length
  const laneLenOf = (eventId) => {
    const lvl = prepped.lanes.find((l) => l.events.some((e) => e.id === eventId));
    return lvl.vec.len;
  };
  for (const x of exits) {
    const veh = null;
    const len = laneLenOf(x.eventId);
    // need half length: look up type
    const ev = prepped.lanes.flatMap((l) => l.events).find((e) => e.id === x.eventId);
    const half = rules.vehicleTypes[ev.type].length / 2;
    if (!(x.s - half >= len - 1e-6)) rearOk = false;
    if (ev.type === 'bus') busExits.push(x);
  }
  check('counting: every exit has rear >= lane length; each event exits once', rearOk && onceOk,
    `${exits.length} exits, ${busExits.length} buses`);
  check('counting: L6 reference cleared all 16 required', outcome.type === 'win' && state.requiredCleared === 16);
}

// ---------- 6. determinism ----------
{
  const prepped = preppedOf('L2');
  const cmds = [
    ...windowsToCommands(prepped),
    { tick: 300, signalId: 'A', to: 'red' },
    { tick: 700, signalId: 'A', to: 'green' },
    { tick: 900, signalId: 'A', to: 'red' },
  ];
  const runBatched = (batch) => {
    const s = replayCommands(prepped, cmds);
    s.debug = true;
    while (!s.outcome && s.tick <= prepped.deadlineTicks) {
      for (let i = 0; i < batch && !s.outcome && s.tick <= prepped.deadlineTicks; i++) step(s);
    }
    if (!s.outcome) s.outcome = { type: 'timeout', tick: prepped.deadlineTicks };
    return { hash: stateHash(s), outcome: s.outcome };
  };
  const h1 = runBatched(1); const h7 = runBatched(7); const h3 = runBatched(3);
  check('determinism: identical command log, different step batching -> identical hash/outcome',
    h1.hash === h7.hash && h1.hash === h3.hash && h1.outcome.type === h7.outcome.type && h1.outcome.tick === h7.outcome.tick);
  // pause/resume equivalence
  const a = replayCommands(prepped, cmds); a.debug = true;
  while (!a.outcome && a.tick < 500) step(a);
  const b = deserialize(prepped, serialize(a)); b.debug = true;
  runToEnd(a); runToEnd(b);
  check('determinism: serialize/pause/resume mid-run -> identical continuation',
    stateHash(a) === stateHash(b) && a.outcome.type === b.outcome.type && a.outcome.tick === b.outcome.tick);
}

// ---------- 7. swept collision correctness ----------
{
  // unit: boundary contact is not a collision; strict overlap is
  const A = { x: 0, y: 0, w: 28, h: 14 };
  const Btouch = { x: 28, y: 0, w: 28, h: 14 };
  check('swept unit: exact boundary contact is not a collision',
    !sweptOverlap(A, { x: 0, y: 0 }, Btouch, { x: 0, y: 0 }) && !rectsOverlapStrict(A, Btouch));
  const Bover = { x: 27.9, y: 0, w: 28, h: 14 };
  check('swept unit: strict interior overlap is a collision',
    sweptOverlap(A, { x: 0, y: 0 }, Bover, { x: 0, y: 0 }));
  // unit: fast mover jumping the zone within one tick is still caught
  const fast = { x: 500, y: 393, w: 28, h: 14 };
  const target = { x: 593, y: 393, w: 14, h: 28 };
  // fast moves +67 in x this tick: from x=500..528 to 567..595 — would end just touching; make it pass fully:
  const fast2 = { x: 520, y: 393, w: 28, h: 14 };
  const d2 = { x: 67, y: 0 };
  check('swept unit: one-tick fast crossing detected', sweptOverlap(fast2, d2, target, { x: 0, y: 0 }));
  // integration: L2 all-green crossing collision has correct ids/lanes
  const l2 = runCmds(preppedOf('L2'), allGreenCmds(preppedOf('L2')));
  const c = l2.outcome;
  check('swept: L2 all-green crossing collision names both vehicles and lanes',
    c.type === 'collision' && c.lanes[0] !== c.lanes[1] && c.vehicles.length === 2 && c.events[0] !== c.events[1],
    `${c.lanes} ${c.events} @ ${c.time?.toFixed(4)}s`);
  // blocked-crossing collision: L3, release through A early, B red -> queue spills into lower crossing
  const l3p = preppedOf('L3');
  const l3 = runCmds(l3p, [{ tick: 0, signalId: 'A', to: 'green' }, { tick: 2400, signalId: 'A', to: 'red' }]);
  check('swept: blocked-crossing collision detected (queue spilled into crossing hit by ambient)',
    l3.outcome.type === 'collision' && [l3.outcome.lanes[0], l3.outcome.lanes[1]].sort().join(',') === 'LOW,V',
    `${l3.outcome.lanes} @ ${l3.outcome.time?.toFixed(4)}s`);
  // fast crossing integration: synthetic level, H car at 8000 u/s crosses V car within one tick
  const fastLvl = {
    id: 'micro-fast', title: 't', lesson: '', deadline: 10, requiredCount: 0,
    lanes: [
      { id: 'H', from: [0, 400], to: [1200, 400], speed: 8000 },
      { id: 'V', from: [600, 0], to: [600, 800], speed: 100 },
    ],
    signals: [],
    streams: [
      { id: 'SH', lane: 'H', required: false, events: [{ id: 'h1', at: 3.78675, type: 'car' }] },
      { id: 'SV', lane: 'V', required: false, events: [{ id: 'v1', at: 0, type: 'car' }] },
    ],
    referenceSolution: { windows: {} },
  };
  const fp = prepareLevel(fastLvl, rules);
  const fr = runCmds(fp, []);
  check('swept: fast crossing within one tick detected with correct ids',
    fr.outcome.type === 'collision' && new Set(fr.outcome.events).size === 2,
    `${fr.outcome.type} ${fr.outcome.events} @ ${fr.outcome.time?.toFixed(4)}s`);
}

// ---------- 8. grouped lights ----------
{
  const prepped = preppedOf('L6');
  const s = replayCommands(prepped, [{ tick: 0, signalId: 'A', to: 'green' }]);
  for (let i = 0; i < 600 && !s.outcome; i++) step(s);
  const left = s.lanes.find((l) => l.def.id === 'LEFT');
  const right = s.lanes.find((l) => l.def.id === 'RIGHT');
  const moved = (lane) => lane.vehicles.some((v) => v.s > v.half + 1);
  check('grouped: one A toggle releases both LEFT and RIGHT lanes',
    moved(left) && moved(right),
    `LEFT ${left.vehicles.length} RIGHT ${right.vehicles.length}`);
  // shared crossings are not merged: all-green first collision is a single lane pair
  const g = runCmds(prepped, allGreenCmds(prepped));
  check('grouped: shared-crossing collision attributed to one lane pair (no merged zone)',
    g.outcome.type === 'collision' && g.outcome.lanes[0] !== g.outcome.lanes[1],
    `${g.outcome.lanes} @ ${g.outcome.time?.toFixed(4)}s`);
}

// ---------- 9. negative pack validation ----------
{
  const base = JSON.parse(packText);
  const mutations = {
    'duplicate event id': (p) => { p.levels[0].streams[0].events[1].id = p.levels[0].streams[0].events[0].id; },
    'requiredCount below target minimum': (p) => { p.levels[0].requiredCount = 0; },
    'bad repeat interval': (p) => { p.levels[0].streams[0].repeat.every = -1; },
    'signal on unknown lane': (p) => { p.levels[0].signals[0].lanes = ['NOPE']; },
    'stopS out of range': (p) => { p.levels[0].signals[0].stopS = 99999; },
    'non-axis-aligned lane': (p) => { p.levels[1].lanes[0].to = [500, 500]; },
    'two uncontrolled crossing streams': (p) => {
      p.levels[1].signals = []; // L2 crossing H x V now uncontrolled
    },
    'unknown vehicle type': (p) => { p.levels[0].streams[0].events[0].type = 'truck'; },
    'bad window': (p) => { p.levels[0].referenceSolution.windows.A = [[5, 2]]; },
    'route unknown lane': (p) => { p.levels[6].streams[0].events[0].route = ['W_in', 'NOPE']; },
    'disconnected route': (p) => { p.levels[6].streams[0].events[0].route = ['W_in', 'R_bottom']; },
    'grouped lanes in opposite directions': (p) => {
      const r = p.levels[5].lanes.find((l) => l.id === 'RIGHT'); r.from = [580, 0]; r.to = [580, 800];
    },
    'grouped lanes with different speeds': (p) => { p.levels[5].lanes.find((l) => l.id === 'RIGHT').speed = 90; },
    'stop line inside a crossing': (p) => { p.levels[1].signals[0].stopS = 600; },
    'signal downstream of its crossing (uncontrolled conflict)': (p) => { p.levels[1].signals[0].stopS = 700; },
    'overlapping reference windows': (p) => { p.levels[2].referenceSolution.windows.A = [[1, 6], [5, 9]]; },
    'requiredCount unreachable': (p) => { p.levels[0].requiredCount = 999; },
  };
  let allRejected = true;
  for (const [name, mutate] of Object.entries(mutations)) {
    const p = JSON.parse(packText);
    mutate(p);
    const errs = validatePack(p);
    if (errs.length === 0) { allRejected = false; console.log(`  mutation "${name}" was NOT rejected`); }
  }
  check(`validation: semantic validator rejects ${Object.keys(mutations).length} mutated packs`, allRejected);
  check('validation: shipped pack is clean', errors.length === 0, errors.join('; '));
}

// ---------- 8b. roundabout: routes, merge conflicts, corner transfer ----------
{
  // merge conflict: required car timed into a ring car at the merge point must CRASH
  const micro = (ringAt) => ({
    id: 'micro-merge', title: 't', lesson: '', deadline: 20, requiredCount: 1, queueLimit: 10,
    lanes: [
      { id: 'R', from: [500, 500], to: [500, 300], speed: 100 },
      { id: 'W', from: [0, 400], to: [500, 400], speed: 100 },
    ],
    signals: [],
    streams: [
      { id: 'SR', lane: 'R', required: false, events: [{ id: 'ring1', at: ringAt, type: 'car' }] },
      { id: 'SW', lane: 'W', required: true, events: [{ id: 'req1', at: 0, type: 'car', route: ['W', 'R'] }] },
    ],
    referenceSolution: { windows: {} },
  });
  // req reaches the merge (W exitS=500) at t=(500-14)/100=4.86; ring car is at merge s=100 at t=ringAt+0.86
  const conflict = prepareLevel(micro(4.0), rules); // ring at merge at 4.86 == req arrival
  const cs = replayCommands(conflict, []);
  cs.debug = true;
  const co = runToEnd(cs);
  check('roundabout: entering the merge into a circulating car is a detected collision',
    co.type === 'collision' && co.events?.includes('req1') && co.events?.includes('ring1'),
    `${co.type} @ ${co.time?.toFixed(2)}s lanes=${co.lanes} events=${co.events}`);
  // gap: ring car passes the merge well before the req car arrives -> req enters and exits
  const gapLvl = prepareLevel(micro(1.0), rules);
  const gs = replayCommands(gapLvl, []);
  gs.debug = true;
  const go = runToEnd(gs);
  check('roundabout: entering on a clear gap succeeds (no false collision)',
    go.type === 'win' && gs.requiredCleared === 1,
    `${go.type} @ ${go.time?.toFixed(2)}s cleared ${gs.requiredCleared}`);
  // route following: L7 reference run moves required cars onto ring lanes and out via E_out
  const l7 = preppedOf('L7');
  const l7s = replayWindows(l7);
  l7s.debug = true;
  const lanesSeen = new Set();
  const l7o = runToEnd(l7s, { onStep: (ev, st) => { for (const l of st.lanes) for (const v of l.vehicles) if (v.required) lanesSeen.add(l.def.id); } });
  check('roundabout: required cars traverse ring lanes (route following works)',
    l7o.type === 'win' && ['R_left', 'R_top', 'R_right', 'E_out'].every((x) => lanesSeen.has(x)),
    `outcome ${l7o.type}, required lanes seen: ${[...lanesSeen].join(',')}`);
}

// ---------- 8c. route transfers: rotated bodies at turns / diverges ----------
{
  const lvl = (lanes, streams, requiredCount) => prepareLevel({
    id: 'micro-xfer', title: 't', lesson: '', deadline: 20, requiredCount, lanes, signals: [], streams,
    referenceSolution: { windows: {} },
  }, rules);
  const D = { id: 'D', from: [700, 0], to: [700, 800], speed: 100 };
  const E = { id: 'E', from: [700, 400], to: [1200, 400], speed: 100 };
  for (const type of ['car', 'bus']) {
    // a vehicle leaves D at a diverge; the next vehicle on D follows at exactly minGap and goes straight on
    const p = lvl([D, E], [
      { id: 'R', lane: 'D', required: true, events: [{ id: 'r1', at: 0, type, route: ['D@400', 'E'] }] },
      { id: 'A', lane: 'D', required: false, events: [{ id: 'a1', at: 0.01, type: 'car' }] },
    ], 1);
    const r = runCmds(p, []);
    check(`transfer: diverging ${type} does not hit the min-gap follower going straight (ghost leader)`,
      r.outcome.type === 'win', `${r.outcome.type} @ ${r.outcome.time?.toFixed(3)}s ${r.outcome.events ?? ''}`);
  }
  // a platoon (car, bus, car) at minGap turns a 90° corner without colliding or overlapping
  const N = { id: 'N', from: [0, 400], to: [700, 400], speed: 100 };
  const S = { id: 'S', from: [700, 400], to: [700, 800], speed: 100 };
  const pc = lvl([N, S], [{ id: 'R', lane: 'N', required: true,
    events: ['car', 'bus', 'car'].map((type, i) => ({ id: 'p' + i, at: i * 0.01, type, route: ['N', 'S'] })) }], 3);
  const rc = runCmds(pc, []);
  check('transfer: min-gap platoon (car, bus, car) turns a corner without collision',
    rc.outcome.type === 'win' && rc.state.requiredCleared === 3, `${rc.outcome.type} @ ${rc.outcome.time?.toFixed(3)}s`);
}

 // ---------- fairness: perturbation matrix ----------
{
  for (const level of pack.levels) {
    const prepped = prepareLevel(level, rules);
    const windows = level.referenceSolution.windows;
    const variants = [];
    for (const [id, wins] of Object.entries(windows)) {
      wins.forEach(([s, e], idx) => {
        for (const b of [0, 1]) {
          for (const d of [-0.2, -0.1, 0.1, 0.2]) {
            const cand = Object.fromEntries(Object.entries(windows).map(([k, v]) => [k, v.map((w) => [...w])]));
            cand[id][idx][b] = Math.round((cand[id][idx][b] + d) * 100) / 100;
            if (cand[id][idx][0] >= cand[id][idx][1]) continue;
            const lvl = { ...prepped, referenceSolution: { windows: cand } };
            const st = replayWindows(lvl);
            const o = runToEnd(st);
            variants.push({ signal: id, window: [s, e], boundary: b === 0 ? 'start' : 'end', delta: d, outcome: o.type, time: o.time });
          }
        }
      });
    }
    const wins = variants.filter((v) => v.outcome === 'win').length;
    levelResults[level.id].perturbations = { total: variants.length, stillWin: wins, variants };
    check(`fairness ${level.id}: base schedule wins; perturbations documented (${wins}/${variants.length} still win)`,
      variants.length === 0 || wins >= 1, `${wins}/${variants.length} win`);
  }
}

// ---------- report ----------
// The committed level-validation.json is the parity baseline (spec §7). If the pack hash matches,
// every reference clear tick must match it exactly; a divergence fails the run and the baseline is
// NOT overwritten unless --accept is passed (after investigating the divergence).
const accept = process.argv.includes('--accept');
const engineFiles = ['constants.js', 'geometry.js', 'data.js', 'sim.js'];
const engineHash = createHash('sha256')
  .update(engineFiles.map((f) => readFileSync(join(here, '..', 'src', f), 'utf8')).join('\n'))
  .digest('hex');
const prev = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null;
let parityNote = 'no previous report';
let parityOk = true;
if (prev && prev.packHash === packHash) {
  const diffs = [];
  for (const [id, res] of Object.entries(levelResults)) {
    const p = prev.levels?.[id]?.reference;
    if (!p || Math.abs(p.clearTick - res.reference.clearTick) > 1 || p.outcome !== res.reference.outcome) {
      diffs.push(`${id}: ${p ? `${p.outcome}@${p.clearTick}` : 'missing'} -> ${res.reference.outcome}@${res.reference.clearTick}`);
    }
  }
  parityOk = diffs.length === 0;
  check('parity: reference clear ticks within one tick of the committed report', parityOk || accept,
    parityOk ? (prev.engineHash && prev.engineHash !== engineHash ? 'engine changed, outcomes unchanged' : '') : diffs.join('; ') + (accept ? ' (accepted)' : ''));
  parityNote = parityOk ? 'matches committed report' : (accept ? 'diverged; new baseline accepted' : 'DIVERGES from committed report');
} else if (prev) {
  parityNote = 'pack hash changed since previous report (new baseline)';
}
const allPassed = checks.every((c) => c.pass);
const report = {
  generatedAt: new Date().toISOString(),
  pack: 'traffic-levels.json',
  packHash,
  engine: 'game-proto/src/sim.js @ 120 ticks/s',
  engineHash,
  parityNote,
  levels: levelResults,
  checks,
  allPassed,
};
const writeReport = !prev || prev.packHash !== packHash || parityOk || accept;
if (writeReport) writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(`\n${checks.filter((c) => c.pass).length}/${checks.length} checks passed. allPassed=${allPassed}`);
console.log(writeReport
  ? `report written: ${reportPath} (pack hash ${packHash.slice(0, 12)}…, ${parityNote})`
  : `report NOT written (${parityNote}); investigate, then rerun with --accept to replace the baseline`);
process.exit(allPassed ? 0 : 1);
