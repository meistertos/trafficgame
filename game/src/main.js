// Mind the Gap — Phaser 4 front end over the shared deterministic engine (game-proto/src).
import * as Phaser from 'phaser';
import { GAME_W, GAME_H, RES, COLORS } from './config.js';
import { BootScene } from './scenes/BootScene.js';
import { SelectScene } from './scenes/SelectScene.js';
import { PlayScene } from './scenes/PlayScene.js';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: COLORS.letterbox,
  // internal resolution RES x the logical 1200x920 layout; cameras zoom by RES (see scenes/common.js)
  width: GAME_W * RES,
  height: GAME_H * RES,
  scale: {
    mode: Phaser.Scale.FIT, // uniform scale with letterboxing (spec §3)
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: { antialias: true, roundPixels: false },
  input: { activePointers: 2 },
  disableContextMenu: true,
  scene: [BootScene, SelectScene, PlayScene],
});

if (new URLSearchParams(window.location.search).has('debug')) window.__game = game;
