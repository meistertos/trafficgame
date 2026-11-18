// Minimal WebAudio sound effects with a persisted toggle. No assets.
const KEY = 'mindthegap.audio';
let ctx = null;
let enabled = (typeof localStorage !== 'undefined' && localStorage.getItem(KEY)) !== 'off';

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur = 0.08, type = 'square', gain = 0.05, when = 0) {
  if (!enabled) return;
  try {
    const a = ac();
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, a.currentTime + when);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + when + dur);
    o.connect(g).connect(a.destination);
    o.start(a.currentTime + when);
    o.stop(a.currentTime + when + dur + 0.02);
  } catch { /* audio unavailable */ }
}

export const audio = {
  get enabled() { return enabled; },
  toggle() {
    enabled = !enabled;
    try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch { /* private mode */ }
    return enabled;
  },
  click() { tone(660, 0.06, 'square', 0.04); },
  countdown(final) { tone(final ? 880 : 440, final ? 0.18 : 0.09, 'sine', 0.07); },
  collision() { tone(110, 0.35, 'sawtooth', 0.09); tone(82, 0.4, 'sawtooth', 0.07, 0.05); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.14, 'triangle', 0.07, i * 0.09)); },
};
