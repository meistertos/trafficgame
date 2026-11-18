// Derives referenceSolution windows for levels that lack them, using the REAL simulation
// (src/sim.js) as the oracle: grid-scan each window's start, binary-search the max collision-free
// end (the collision set is monotone in window length), accept windows that increase the number
// of required vehicles committed past the signal. Then centers window boundaries for input
// margin (fairness gate, spec §7).
//
// Usage: node game-proto/tools/author-references.mjs [--write]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parsePack, prepareLevel } from '../src/data.js';
import { replayWindows, runToEnd } from '../src/sim.js';

const here = dirname(fileURLToPath(import.meta.url));
const packPath = join(here, '..', 'traffic-levels.json');
const write = process.argv.includes('--write');

const GRID = 0.2; // window start grid (s)
const MINLEN = 0.8; // no reference green interval shorter than this (spec §7)
const bad = (o) => o.type === 'collision' || o.type === 'overflow'; // run-ending failures

const { pack, errors } = parsePack(readFileSync(packPath, 'utf8'));
if (errors.length) { console.error('pack invalid:', errors); process.exit(1); }
const rules = pack.rules;

function replayOutcome(prepped, windows) {
  const lvl = { ...prepped, referenceSolution: { windows } };
  const state = replayWindows(lvl);
  state.debug = true;
  let requiredExited = 0;
  const outcome = runToEnd(state, {
    onStep: (ev) => { for (const x of ev.exited) if (x.required) requiredExited++; },
  });
  return { state, outcome, requiredExited };
}

// Required vehicles that got past signal `id`: exited + still on map and committed.
function pastCount(res, id) {
  let n = res.requiredExited;
  for (const lane of res.state.lanes) {
    for (const v of lane.vehicles) if (v.required && v.committed.has(id)) n++;
  }
  return n;
}

function tryWindow(prepped, windows, id, t0, t1) {
  const cand = {};
  for (const [k, v] of Object.entries(windows)) cand[k] = v.map((w) => [...w]);
  cand[id] = [...(cand[id] ?? []), [t0, t1]];
  return replayOutcome(prepped, cand);
}

function planLevel(prepped) {
  const sigIds = prepped.signals.map((s) => s.id);
  const windows = {};
  for (const id of sigIds) windows[id] = [];
  const deadline = prepped.deadline;
  const target = prepped.requiredCount;

  for (let round = 0; round < 24; round++) {
    const base = replayOutcome(prepped, windows);
    if (base.outcome.type === 'win') return windows;
    let improved = false;
    for (const id of sigIds) {
      const basePast = pastCount(replayOutcome(prepped, windows), id);
      const startFrom = windows[id].length ? windows[id][windows[id].length - 1][1] : 0;
      const t0start = Math.ceil(startFrom / GRID) * GRID;
      for (let t0 = t0start; t0 < deadline - MINLEN; t0 = Math.round((t0 + GRID) * 100) / 100) {
        // scan window ends longest-first; accept the first non-failing window that makes progress
        // (failures are not monotone in the window end: short windows can overflow the queue,
        // long windows can crash — so no binary search)
        let accepted = null;
        for (let t1 = deadline; t1 >= t0 + MINLEN + 1e-9; t1 = Math.round((t1 - 0.5) * 100) / 100) {
          const cand = tryWindow(prepped, windows, id, t0, t1);
          // only a collision disqualifies a candidate; a later queue overflow just means
          // more windows are needed (the queue cap punishes not releasing, not releasing)
          if (cand.outcome.type === 'collision') continue;
          if (pastCount(cand, id) > basePast) { accepted = [t0, t1]; break; }
        }
        if (accepted) {
          windows[id].push(accepted);
          improved = true;
          break;
        }
      }
    }
    if (!improved) break;
  }
  const fin = replayOutcome(prepped, windows);
  return fin.outcome.type === 'win' ? windows : null;
}

// Shift each window boundary toward the middle of its winning range (input margin, spec §7).
function maximizeMargins(prepped, windows) {
  const result = {};
  for (const [id, wins] of Object.entries(windows)) result[id] = wins.map((w) => [...w]);
  const wins2 = () => replayOutcome(prepped, result).outcome.type === 'win';
  if (!wins2()) return null;
  const stepS = 0.05;
  for (const id of Object.keys(result)) {
    for (let i = 0; i < result[id].length; i++) {
      const [s0, e0] = result[id][i];
      const maxShift = Math.min(2.0, e0 - s0 - MINLEN);
      const goodStarts = [];
      for (let d = 0; d <= maxShift + 1e-9; d += stepS) {
        result[id][i] = [Math.round((s0 + d) * 100) / 100, e0];
        if (wins2()) goodStarts.push(d);
      }
      const goodEnds = [];
      for (let d = 0; d <= maxShift + 1e-9; d += stepS) {
        result[id][i] = [s0, Math.round((e0 - d) * 100) / 100];
        if (wins2()) goodEnds.push(d);
      }
      const pick = (arr) => (arr.length ? arr[Math.floor(arr.length / 2)] : 0);
      result[id][i] = [Math.round((s0 + pick(goodStarts)) * 100) / 100, Math.round((e0 - pick(goodEnds)) * 100) / 100];
      if (!wins2()) result[id][i] = [s0, e0];
    }
  }
  return wins2() ? result : null;
}

// Tolerance of each boundary: which +/- perturbations still win.
function boundaryTolerances(prepped, windows) {
  const out = {};
  for (const [id, wins] of Object.entries(windows)) {
    out[id] = wins.map(([s, e], idx) => {
      const tolerance = {};
      for (const b of [0, 1]) {
        for (const mag of [0.1, 0.2, 0.4, 0.8]) {
          for (const sign of [-1, 1]) {
            const cand = wins.map((w) => [...w]);
            cand[idx][b] += sign * mag;
            if (cand[idx][0] >= cand[idx][1]) continue;
            const all = { ...windows, [id]: cand };
            tolerance[`${b === 0 ? 'start' : 'end'}${sign > 0 ? '+' : '-'}${mag}`] =
              replayOutcome(prepped, all).outcome.type === 'win';
          }
        }
      }
      return { window: [s, e], tolerance };
    });
  }
  return out;
}

for (const level of pack.levels) {
  const prepped = prepareLevel(level, rules);
  const existing = level.referenceSolution?.windows ?? {};
  const hasWindows = Object.values(existing).some((w) => w.length > 0);
  if (hasWindows) {
    const { outcome } = replayOutcome(prepped, existing);
    console.log(`${level.id}: existing windows -> ${outcome.type} @ ${outcome.time?.toFixed(4)}s`);
    if (outcome.type === 'win') continue;
    console.log(`${level.id}: existing windows no longer win after spawn jitter; replanning`);
  }
  const planned = planLevel(prepped);
  if (!planned) {
    console.error(`${level.id}: planner failed`);
    process.exitCode = 1;
    continue;
  }
  const margined = maximizeMargins(prepped, planned) ?? planned;
  const fin = replayOutcome(prepped, margined);
  console.log(`${level.id}: planned -> ${fin.outcome.type} @ ${fin.outcome.time?.toFixed(4)}s`, JSON.stringify(margined));
  console.log(`${level.id}: tolerances`, JSON.stringify(boundaryTolerances(prepped, margined)));
  if (write) level.referenceSolution = { windows: margined };
}

if (write) {
  writeFileSync(packPath, JSON.stringify(pack, null, 2) + '\n');
  console.log('pack written:', packPath);
  const re = parsePack(readFileSync(packPath, 'utf8'));
  if (re.errors.length) { console.error('rewritten pack invalid:', re.errors); process.exit(1); }
  for (const level of re.pack.levels) {
    const prepped = prepareLevel(level, re.pack.rules);
    const s = replayWindows(prepped);
    s.debug = true;
    const o = runToEnd(s);
    console.log(`${level.id}: verify -> ${o.type} @ ${o.time?.toFixed(4)}s cleared ${s.requiredCleared}/${s.requiredTarget}`);
    if (o.type !== 'win') process.exitCode = 1;
  }
}
