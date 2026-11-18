// Vehicle sprites synced from the simulation state every frame (render never feeds back into the
// engine). Bodies come from generated textures that point along +x; rotation follows lane direction.
import { vehicleRect } from '@engine/geometry.js';
import { VEHICLE_COLORS } from '@engine/constants.js';
import { RES, COLORS } from './config.js';

const hex = (s) => parseInt(s.slice(1), 16);
const PALETTE = VEHICLE_COLORS.map(hex);

export class VehicleLayer {
  constructor(scene, layer) {
    this.scene = scene;
    this.layer = layer;
    this.sprites = new Map();
    this.fx = scene.add.graphics(); // collision rings drawn above vehicles
    layer.add(this.fx);
  }

  make(veh) {
    const c = this.scene.add.container(0, 0);
    const body = this.scene.add.image(0, 0, veh.type === 'bus' ? 'bus' : 'car').setScale(1 / RES);
    const parts = [body];
    let diamond = null;
    if (veh.required) {
      diamond = this.scene.add.image(0, 0, 'diamond').setScale(1 / RES);
      parts.push(diamond);
    }
    c.add(parts);
    this.layer.addAt(c, Math.max(0, this.layer.getIndex(this.fx)));
    const s = { c, body, diamond, crash: null, wait: null };
    this.sprites.set(veh.id, s);
    return s;
  }

  // highlight: { collision:Set<vehId>, waiting:Set<vehId> }
  sync(state, highlight = {}) {
    const seen = new Set();
    const collision = highlight.collision ?? new Set();
    const waiting = highlight.waiting ?? new Set();
    this.fx.clear();
    if (state) {
      for (const lane of state.lanes) {
        const def = lane.def;
        for (const veh of lane.vehicles) {
          seen.add(veh.id);
          const s = this.sprites.get(veh.id) ?? this.make(veh);
          const r = vehicleRect(def, def.vec, veh.s, veh.length, veh.width);
          const cx = r.x + r.w / 2;
          const cy = r.y + r.h / 2;
          s.c.setPosition(cx, cy);
          s.c.setRotation(Math.atan2(def.vec.uy, def.vec.ux));
          const crashed = collision.has(veh.id);
          const tint = crashed ? COLORS.crash : veh.type === 'bus' ? COLORS.bus : PALETTE[veh.colorIdx % PALETTE.length];
          if (s.crash !== tint) { s.body.setTint(tint); s.crash = tint; }
          if (s.diamond) {
            const w = waiting.has(veh.id) ? COLORS.red : COLORS.yellow;
            if (s.wait !== w) { s.diamond.setTint(w); s.wait = w; }
          }
          if (crashed) {
            this.fx.lineStyle(4, COLORS.crash, 1);
            this.fx.strokeCircle(cx, cy, Math.max(r.w, r.h) * 0.8);
          }
        }
      }
    }
    for (const [id, s] of this.sprites) {
      if (!seen.has(id)) { s.c.destroy(); this.sprites.delete(id); }
    }
  }

  clear() {
    for (const s of this.sprites.values()) s.c.destroy();
    this.sprites.clear();
    this.fx.clear();
  }
}

// Generated, asset-free textures (drawn at RES for crisp scaling). White bodies are tinted per vehicle.
export function makeVehicleTextures(scene, vehicleTypes) {
  const mk = (key, len, wid, buses) => {
    if (scene.textures.exists(key)) return;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    const L = len * RES;
    const W = wid * RES;
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(0, 0, L, W, Math.min(5 * RES, W / 3));
    g.lineStyle(1 * RES, 0x000000, 0.45);
    g.strokeRoundedRect(0.5 * RES, 0.5 * RES, L - RES, W - RES, Math.min(5 * RES, W / 3));
    g.fillStyle(0x0a0e14, 0.6);
    if (buses) {
      for (let x = 4 * RES; x < L - 10 * RES; x += 7 * RES) g.fillRect(x, 2.5 * RES, 5 * RES, W - 5 * RES);
      g.fillRect(L - 7 * RES, 2 * RES, 4 * RES, W - 4 * RES); // windshield (front = +x)
    } else {
      g.fillRect(L * 0.62, 2 * RES, L * 0.16, W - 4 * RES); // windshield
      g.fillRect(L * 0.14, 2.5 * RES, L * 0.1, W - 5 * RES); // rear window
    }
    g.generateTexture(key, L, W);
    g.destroy();
  };
  mk('car', vehicleTypes.car.length, vehicleTypes.car.width, false);
  if (vehicleTypes.bus) mk('bus', vehicleTypes.bus.length, vehicleTypes.bus.width, true);
  if (!scene.textures.exists('diamond')) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    const d = 6 * RES;
    g.fillStyle(0xffffff, 1);
    g.fillTriangle(d, 0, 2 * d, d, 0, d);
    g.fillTriangle(d, 2 * d, 2 * d, d, 0, d);
    g.generateTexture('diamond', 2 * d, 2 * d);
    g.destroy();
  }
}
