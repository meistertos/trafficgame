import { RES, COLORS } from '../config.js';

// Every scene renders at RES x internal resolution; zooming the camera from the top-left keeps
// all coordinates in world/HUD units while staying crisp on high-DPI screens.
export function setupCamera(scene) {
  const cam = scene.cameras.main;
  cam.setOrigin(0, 0);
  cam.setZoom(RES);
  cam.setBackgroundColor(COLORS.letterbox);
}
