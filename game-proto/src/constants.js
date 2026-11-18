// Shared simulation constants (spec §4). Single source of truth for engine + renderer.

export const TICK_RATE = 120; // fixed simulation ticks per second
export const WORLD_W = 1200;
export const WORLD_H = 800;
export const MIN_GAP = 12; // bumper-to-bumper following gap, world units
export const EPS_TIME = 1e-9; // epsilon-safe tick conversion (spec §4.3)
export const EPS_COLL = 1e-9; // boundary contact is not a collision (strict interior only)


// Vehicle body palette; a vehicle keeps its color for its whole route (assigned per vehicle).
export const VEHICLE_COLORS = ['#d8b24a', '#7fb2d9', '#c98fd0', '#8fd0a5', '#e08f8f', '#b9a7e8'];
export const VEHICLE_TYPES = {
  car: { length: 28, width: 14 },
  bus: { length: 52, width: 14 },
};

export const SIGNAL_IDS = ['A', 'B', 'C', 'D'];

// Smallest tick whose start time is at least `seconds` (epsilon-safe, spec §4.3).
export function timeToTick(seconds, tickRate = TICK_RATE) {
  return Math.max(0, Math.ceil(seconds * tickRate - EPS_TIME));
}

export function tickToTime(tick, tickRate = TICK_RATE) {
  return tick / tickRate;
}
