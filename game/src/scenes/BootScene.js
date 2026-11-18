import * as Phaser from 'phaser';
import { getPack } from '../pack.js';
import { makeVehicleTextures } from '../vehicles.js';
import { setupCamera } from './common.js';
import { text } from '../ui.js';
import { CSS, GAME_W } from '../config.js';

export class BootScene extends Phaser.Scene {
  constructor() { super('boot'); }

  create() {
    setupCamera(this);
    const pack = getPack();
    if (!pack.ok) {
      // Invalid pack: show the validator's errors instead of a half-working game (spec §6).
      text(this, 40, 40, 'Level pack failed to load', { size: 28, weight: 'bold' });
      text(this, 40, 90, pack.errors.join('\n'), { size: 15, color: CSS.red, wrap: GAME_W - 80 });
      console.error('invalid level pack', pack.errors);
      return;
    }
    makeVehicleTextures(this, pack.pack.rules.vehicleTypes);
    this.scene.start('select');
  }
}
