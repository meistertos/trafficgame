// Pointer + keyboard input (spec §3). Pointer positions go through the inverse world transform.
import { worldFromPointer } from './render.js';

export function attachPointer(canvas, getView, getHitAreas, onSignal) {
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const view = getView();
    const [wx, wy] = worldFromPointer(canvas, view, e.clientX, e.clientY);
    for (const area of getHitAreas()) {
      const dx = wx - area.x, dy = wy - area.y;
      if (dx * dx + dy * dy <= area.r * area.r) {
        onSignal(area.id);
        return;
      }
    }
  });
}

export function attachKeys(getSignalIds, handlers) {
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const ids = getSignalIds();
    if (e.key >= '1' && e.key <= '4') {
      const i = Number(e.key) - 1;
      if (ids[i]) { handlers.onSignal(ids[i]); e.preventDefault(); }
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'p' || e.key === 'Escape') { handlers.onPauseToggle(); e.preventDefault(); }
    else if (k === 'r') { handlers.onRetry(); e.preventDefault(); }
  });
}
