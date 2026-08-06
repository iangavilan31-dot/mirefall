import { Game } from './core/Game.js';
import { settings } from './core/Settings.js';
import { audio } from './audio/Audio.js';
import { installDebugApi } from './debug/DebugApi.js';

const canvas = document.getElementById('gl');
const boot = document.getElementById('boot');
const bar = document.getElementById('boot-bar');
const note = document.getElementById('boot-note');

function progress(pct, text) {
  if (bar) bar.style.right = `${Math.max(0, 100 - pct * 100)}%`;
  if (note && text) note.textContent = text;
}

async function main() {
  settings.autodetect();

  const game = new Game(canvas, progress);
  await game.build();
  installDebugApi(game);

  // Audio needs a gesture. Arm it on the first interaction of any kind.
  const arm = () => {
    audio.init().then(() => {
      if (game.state === 'title') audio.music('menu');
    });
    window.removeEventListener('pointerdown', arm);
    window.removeEventListener('keydown', arm);
    window.removeEventListener('gamepadconnected', arm);
  };
  window.addEventListener('pointerdown', arm);
  window.addEventListener('keydown', arm);
  window.addEventListener('gamepadconnected', arm);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { audio.suspend(); if (game.state === 'playing') game.setState('paused'); }
    else audio.resume();
  });

  boot.classList.add('gone');
  setTimeout(() => boot.remove(), 1300);

  let last = performance.now();
  let consecutiveErrors = 0;
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    try {
      game.frame(dt);
      consecutiveErrors = 0;
    } catch (e) {
      // One bad frame must not end the game. Only a sustained failure is fatal.
      consecutiveErrors++;
      if (consecutiveErrors <= 3) console.error('[frame]', e);
      if (consecutiveErrors >= 30) {
        window.__MIREFALL_FATAL__ = e.stack || String(e);
        const f = document.getElementById('fatal');
        if (f) { f.classList.remove('hidden'); f.textContent = 'FATAL (frame)\n\n' + (e.stack || e); }
        return;
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  window.__MIREFALL_READY__ = true;
}

main().catch((e) => {
  console.error(e);
  window.__MIREFALL_FATAL__ = e.stack || String(e);
  const f = document.getElementById('fatal');
  if (f) { f.classList.remove('hidden'); f.textContent = 'FATAL (boot)\n\n' + (e.stack || e); }
});
