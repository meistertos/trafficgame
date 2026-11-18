// Vehicle sprites synced from the simulation state every frame (render never feeds back into the
// engine). Bodies come from generated textures that point along +x; rotation follows lane direction.
import { vehicleRect } from '@engine/geometry.js';
import { RES, COLORS } from './config.js';

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
          // flat two-tone traffic: required cars in ink (with a ◆), everything else in the enemy colour
          const tint = crashed ? COLORS.crash : veh.required ? COLORS.car : COLORS.enemy;
          if (s.crash !== tint) { s.body.setTint(tint); s.crash = tint; }
          if (s.diamond) {
            const w = waiting.has(veh.id) ? COLORS.red : COLORS.mark;
            if (s.wait !== w) { s.diamond.setTint(w); s.wait = w; }
          }
          if (crashed) {
            this.fx.lineStyle(3, COLORS.crash, 1);
            this.fx.strokeCircle(cx, cy, Math.max(r.w, r.h) * 0.9);
            this.fx.lineStyle(1.5, COLORS.crash, 0.4);
            this.fx.strokeCircle(cx, cy, Math.max(r.w, r.h) * 1.25);
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

// Generated, asset-free textures (drawn at RES for crisp scaling): plain white pills, tinted per vehicle.
export function makeVehicleTextures(scene, vehicleTypes) {
  const mk = (key, len, wid, segments) => {
    if (scene.textures.exists(key)) return;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    const L = len * RES;
    const W = wid * RES;
    g.fillStyle(0xffffff, 1);
    if (segments > 1) {
      // articulated: separate carriages with a hairline gap, like a train
      const gap = 2 * RES;
      const seg = (L - gap * (segments - 1)) / segments;
      for (let i = 0; i < segments; i++) g.fillRoundedRect(i * (seg + gap), 0, seg, W, 3 * RES);
    } else {
      g.fillRoundedRect(0, 0, L, W, 3 * RES);
    }
    g.generateTexture(key, L, W);
    g.destroy();
  };
  mk('car', vehicleTypes.car.length, vehicleTypes.car.width, 1);
  if (vehicleTypes.bus) mk('bus', vehicleTypes.bus.length, vehicleTypes.bus.width, 2);
  if (!scene.textures.exists('diamond')) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    const d = 4.5 * RES;
    g.fillStyle(0xffffff, 1);
    g.fillTriangle(d, 0, 2 * d, d, 0, d);
    g.fillTriangle(d, 2 * d, 2 * d, d, 0, d);
    g.generateTexture('diamond', 2 * d, 2 * d);
    g.destroy();
  }
}
