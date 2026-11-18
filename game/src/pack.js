// Level pack: the same traffic-levels.json bytes and the same loader/validator the headless runner uses.
import packText from '@proto/traffic-levels.json?raw';
import { parsePack, prepareLevel } from '@engine/data.js';

let cache = null;
export function getPack() {
  if (cache) return cache;
  let parsed;
  try { parsed = parsePack(packText); } catch (e) { parsed = { pack: null, errors: [`invalid JSON: ${e.message}`], ok: false }; }
  const { pack, errors, ok } = parsed;
  const prepped = ok ? pack.levels.map((l) => prepareLevel(l, pack.rules)) : [];
  cache = { pack, errors, ok, levels: ok ? pack.levels : [], prepped };
  return cache;
}

// "all N" only when N is the complete set of marked cars in the level (spec §2).
export function objectiveText(level) {
  const endless = (level.streams ?? []).some((s) => s.required && s.repeat);
  return endless ? `Get ${level.requiredCount} marked cars through` : `Get all ${level.requiredCount} marked cars through`;
}
