// Local completion check marks + audio preference (spec §3). Storage may be unavailable.
const COMPLETED_KEY = 'mindthegap.completed';
const AUDIO_KEY = 'mindthegap.audio';

export function loadCompleted() {
  try { return JSON.parse(localStorage.getItem(COMPLETED_KEY) ?? '{}') ?? {}; } catch { return {}; }
}
export function markCompleted(levelId) {
  const c = loadCompleted();
  c[levelId] = true;
  try { localStorage.setItem(COMPLETED_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}
export function loadAudioEnabled() {
  try { return localStorage.getItem(AUDIO_KEY) !== 'off'; } catch { return true; }
}
export function saveAudioEnabled(on) {
  try { localStorage.setItem(AUDIO_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
}
