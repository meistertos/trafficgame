// HTML screens + HUD (spec §3). All screens are ordinary HTML controls; no debug/replay UI.
const overlay = () => document.getElementById('overlay');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Countdown timers are cancelled whenever another screen replaces the overlay, so leaving the
// countdown (level select, retry, next level) can never start a stale run later.
let cdToken = 0;
export function cancelCountdown() { cdToken++; }

// Objective text: "all N" only when N is the complete set of marked cars in the level.
export function objectiveText(level) {
  const endless = (level.streams ?? []).some((s) => s.required && s.repeat);
  return endless ? `Get ${level.requiredCount} marked cars through` : `Get all ${level.requiredCount} marked cars through`;
}

function renderOverlay(html) {
  const o = overlay();
  o.innerHTML = html;
  o.classList.remove('hidden');
}
export function showOverlay(html) {
  cancelCountdown();
  renderOverlay(html);
}
export function hideOverlay() {
  cancelCountdown();
  const o = overlay();
  o.classList.add('hidden');
  o.innerHTML = '';
}

export function showLevelSelect(levels, completed, onPick) {
  const cards = levels.map((l, i) => `
    <button class="level-card" data-i="${i}" type="button">
      <strong>${i + 1}. ${esc(l.title)}</strong> ${completed[l.id] ? '<span class="done">✓</span>' : ''}
      <div class="sub">${objectiveText(l)} · ${l.deadline}s</div>
    </button>`).join('');
  showOverlay(`<div class="card"><h2>Mind the Gap</h2>
    <p class="meta">Release cars through intersections without collisions. Click a traffic light (or keys 1–4) to toggle it.</p>
    <div class="level-grid">${cards}</div></div>`);
  overlay().querySelectorAll('.level-card').forEach((b) =>
    b.addEventListener('click', () => onPick(Number(b.dataset.i))));
}

export function showPreview(level, onStart) {
  showOverlay(`<div class="card">
    <h2>${esc(level.title)}</h2>
    <p class="meta">Level ${esc(level.id)} · deadline ${level.deadline}s</p>
    <p><strong>${objectiveText(level)}.</strong> (◆ diamond = required)</p>
    <p class="lesson">Lesson: ${esc(level.lesson)}</p>
    ${level.tutorial ? `<p class="tutorial">${esc(level.tutorial)}</p>` : ''}
    <div class="buttons"><button class="primary" id="ov-start" type="button">Start</button></div>
  </div>`);
  overlay().querySelector('#ov-start').addEventListener('click', onStart);
}

export function showCountdown(n, done) {
  cancelCountdown();
  const token = cdToken;
  const live = (fn) => () => { if (token === cdToken) fn(); };
  const tick = (k) => {
    renderOverlay(`<div class="card"><div class="big" id="cd">${k}</div></div>`);
    const el = overlay().querySelector('#cd');
    if (k > 1) {
      setTimeout(live(() => { el.textContent = k - 1; }), 650);
      setTimeout(live(() => tick(k - 1)), 1300);
    } else {
      setTimeout(live(() => { el.textContent = 'GO'; }), 650);
      setTimeout(live(() => { hideOverlay(); done(); }), 1100);
    }
  };
  tick(n);
}

export function showPause(opts) {
  showOverlay(`<div class="card">
    <h2>Paused</h2>
    ${opts.auto ? '<p class="meta">The tab was hidden, so the game paused automatically.</p>' : ''}
    ${opts.perf ? '<p class="meta">Paused for performance: the app could not keep up with real time.</p>' : ''}
    <p class="meta">Vehicles and timer are frozen. Lights cannot change while paused.</p>
    <div class="buttons">
      <button class="primary" id="ov-resume" type="button">Resume</button>
      <button id="ov-retry" type="button">Retry (R)</button>
      <button id="ov-select" type="button">Level select</button>
    </div></div>`);
  overlay().querySelector('#ov-resume').addEventListener('click', opts.onResume);
  overlay().querySelector('#ov-retry').addEventListener('click', opts.onRetry);
  overlay().querySelector('#ov-select').addEventListener('click', opts.onSelect);
}

export function showResult(r) {
  // r: {kind:'win'|'collision'|'timeout', level, timeUsed, cleared, target, throughput,
  //     isLast, campaignDone, onNext, onRetry, onSelect}
  let body;
  if (r.kind === 'win') {
    body = `<h2>Level complete ✓</h2>
      ${r.campaignDone ? `<p><strong>Campaign complete!</strong> All ${r.levelCount} levels cleared.</p>` : ''}
      <p class="meta">Time used: ${r.timeUsed.toFixed(2)}s of ${r.level.deadline}s</p>
      <p>Required cleared: ${r.cleared} / ${r.target} · total throughput: ${r.throughput}</p>`;
  } else if (r.kind === 'collision') {
    body = `<h2>Collision!</h2>
      <p class="meta">Two vehicles were highlighted on the map at ${r.timeUsed.toFixed(2)}s. Any collision ends the run — including ambient traffic.</p>`;
  } else if (r.kind === 'overflow') {
    body = `<h2>Queue overflow!</h2>
      <p class="meta">Too many cars waiting at the ${esc(r.lane ?? '')} entry (limit ${r.limit}) at ${r.timeUsed.toFixed(2)}s. Keep the queue moving.</p>`;
  } else {
    body = `<h2>Time out</h2>
      <p class="meta">Deadline ${r.level.deadline}s reached. Required cars still waiting are highlighted (◆ red). Cleared ${r.cleared} / ${r.target}.</p>`;
  }
  const nextLabel = r.isLast ? 'Finish' : 'Next level';
  showOverlay(`<div class="card">${body}
    <div class="buttons">
      ${r.kind === 'win' ? `<button class="primary" id="ov-next" type="button">${nextLabel}</button>` : ''}
      <button id="ov-retry" type="button">Retry (R)</button>
      <button id="ov-select" type="button">Level select</button>
    </div></div>`);
  const next = overlay().querySelector('#ov-next');
  if (next) next.addEventListener('click', r.onNext);
  overlay().querySelector('#ov-retry').addEventListener('click', r.onRetry);
  overlay().querySelector('#ov-select').addEventListener('click', r.onSelect);
}

export function showError(errors) {
  showOverlay(`<div class="card"><h2>Level pack failed to load</h2>
    <pre style="text-align:left;color:#ff8a8a">${esc(errors.join('\n'))}</pre></div>`);
}

// ---------- HUD ----------
export function buildSignalButtons(signalIds, onToggle) {
  const box = document.getElementById('signals');
  box.innerHTML = '';
  for (const id of signalIds) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sig-btn red';
    b.dataset.sig = id;
    b.innerHTML = `<span>${id}</span><span class="state">RED</span>`;
    b.addEventListener('click', () => onToggle(id));
    box.appendChild(b);
  }
}

export function updateSignalButtons(state) {
  for (const b of document.querySelectorAll('.sig-btn')) {
    const id = b.dataset.sig;
    const green = state?.signals.find((s) => s.id === id)?.state === 'green';
    b.classList.toggle('green', !!green);
    b.classList.toggle('red', !green);
    b.querySelector('.state').textContent = green ? 'GREEN' : 'RED';
  }
}

export function setSignalButtonsEnabled(enabled) {
  for (const b of document.querySelectorAll('.sig-btn')) b.disabled = !enabled;
}

export function updateHud(level, state, mode) {
  document.getElementById('hud-title').textContent = 'Mind the Gap';
  document.getElementById('hud-level').textContent = level ? `Level ${level.id} — ${level.title}` : '—';
  if (level && state) {
    document.getElementById('hud-required').textContent =
      `Required: ${state.requiredCleared} / ${state.requiredTarget}`;
    const remaining = Math.max(0, level.deadline - state.tick / 120);
    const t = document.getElementById('hud-time');
    t.textContent = `Time: ${remaining.toFixed(1)}s`;
    t.classList.toggle('low', remaining <= 5);
    document.getElementById('hud-through').textContent = `Throughput: ${state.totalExited}`;
  } else {
    document.getElementById('hud-required').textContent = 'Required: 0 / 0';
    document.getElementById('hud-time').textContent = 'Time: —';
    document.getElementById('hud-through').textContent = 'Throughput: 0';
  }
  document.getElementById('btn-pause').disabled = !(mode === 'playing' || mode === 'paused');
}
