import * as THREE from 'three';
import { settings } from '../core/Settings.js';
import { bus, EVT } from '../core/EventBus.js';

/**
 * window.__MIREFALL__ — the automation surface.
 *
 * Critics and capture tooling drive the real game through this. It is intentionally
 * capable: repeatable camera framings, forced phases, damage, state jumps, and a
 * frame-time sampler. Shipping it is fine — it changes nothing unless called.
 */
export function installDebugApi(game) {
  const api = {
    version: '1.0',
    game,

    // ---- readiness ----
    get ready() { return !!game.engine && game.state !== 'boot'; },
    state: () => game.state,
    stats: () => game.engine.stats(),

    // ---- state control ----
    setState: (s) => { game.setState(s); return s; },
    start: (fromCheckpoint = false) => { game.startRun(!!fromCheckpoint); return true; },
    pause: () => game.setState('paused'),
    resume: () => game.setState('playing'),

    // ---- camera ----
    shots: () => Object.keys(game.shots),
    shot: (name) => {
      const ok = game.applyShot(name);
      api._shotLock = ok ? name : null;
      return ok;
    },
    freeCamera: (pos, look, fov = 55) => {
      const cam = game.engine.camera;
      cam.position.set(pos[0], pos[1], pos[2]);
      cam.lookAt(new THREE.Vector3(look[0], look[1], look[2]));
      cam.fov = fov; cam.updateProjectionMatrix();
      api._shotLock = 'free';
    },
    releaseCamera: () => { api._shotLock = null; },
    orbit: (yaw, pitch, distance) => {
      game.rig.yaw = yaw; game.rig.pitch = pitch;
      game.rig.applyPreset({ distance });
    },
    cameraInfo: () => {
      const c = game.engine.camera;
      return { pos: c.position.toArray(), fov: c.fov, rot: [c.rotation.x, c.rotation.y, c.rotation.z] };
    },

    // ---- player ----
    player: () => ({
      pos: game.player.pos.toArray(), health: game.player.health, stamina: game.player.stamina,
      state: game.player.state, flasks: game.player.healCharges, dead: game.player.dead,
    }),
    teleport: (x, z) => { game.player.pos.set(x, game.player.pos.y, z); return true; },
    hurtPlayer: (n = 25) => game.player.takeDamage(n, new THREE.Vector3(0, 0, 1), 'debug'),
    killPlayer: () => game.player.takeDamage(9999, new THREE.Vector3(0, 0, 1), 'debug'),
    healPlayer: () => { game.player.health = game.player.maxHealth; },
    godMode: (on = true) => { game.player.dmgScale = on ? 0 : 1; return on; },

    // ---- boss ----
    boss: () => ({
      health: game.boss.health, max: game.boss.maxHealth, phase: game.boss.phase,
      state: game.boss.state, attack: game.boss.attackName, staggered: game.boss.staggered,
      poise: game.boss.poise, pos: game.boss.root.position.toArray(),
      headY: game.boss.model.bodyPivot.position.y,
    }),
    damageBoss: (n = 100) => {
      game.boss.takeDamage(n, game.boss.model.headWorld(new THREE.Vector3()), { part: 'leg' });
      return game.boss.health;
    },
    setBossHealth: (frac) => {
      game.boss.health = game.boss.maxHealth * frac;
      game.boss._checkPhase();
      return game.boss.health;
    },
    forcePhase: (n) => {
      const target = n === 3 ? 0.30 : n === 2 ? 0.66 : 0.99;
      game.boss.health = game.boss.maxHealth * target;
      game.boss._phaseIndex = n - 2 >= 0 ? n - 2 : 0;
      game.boss._checkPhase();
      return game.boss.phase;
    },
    forceAttack: (name) => {
      game.boss.state = 'attack';
      game.boss.stateTime = 0;
      game.boss.attackName = name;
      game.boss._attackData = {};
      game.boss[`_begin_${name}`]?.();
      return name;
    },
    stagger: () => { game.boss.poise = 0; game.boss._stagger(); },
    killBoss: () => { game.boss.health = 0; game.boss._beginDeath(); },
    attacks: () => ['legSlam', 'legTriple', 'sporeFall', 'gustSweep', 'dive', 'moonfall', 'summon'],

    // ---- enemies ----
    spawnEnemy: (x, z) => { game.spawnEnemy(new THREE.Vector3(x, 0, z)); return game.enemies.length; },
    enemyCount: () => game.enemies.length,

    // ---- settings / quality ----
    setQuality: (tier) => { settings.set('quality', tier); return tier; },
    setSetting: (k, v) => { settings.set(k, v); return settings.get(k); },
    settings: () => settings.all(),
    setAdaptive: (on) => settings.set('adaptive', !!on),

    // ---- world ----
    raisePillars: () => game.world.raisePillars(),
    darken: () => game.world.darken(),
    time: () => game.elapsed,
    setTimeScale: (s) => { game.timeScale = s; return s; },

    // ---- perf sampling ----
    perf: null,
    startPerf: () => {
      api.perf = { frames: [], t0: performance.now(), samples: [] };
      api._perfHook = true;
      return true;
    },
    stopPerf: () => {
      api._perfHook = false;
      const f = api.perf?.frames || [];
      if (!f.length) return null;
      const sorted = [...f].sort((a, b) => a - b);
      const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
      const avg = f.reduce((a, b) => a + b, 0) / f.length;
      const res = {
        frames: f.length,
        avgMs: +avg.toFixed(2),
        avgFps: +(1000 / avg).toFixed(1),
        p50: +pct(0.5).toFixed(2),
        p95: +pct(0.95).toFixed(2),
        p99: +pct(0.99).toFixed(2),
        worstMs: +sorted[sorted.length - 1].toFixed(2),
        fps1pctLow: +(1000 / pct(0.99)).toFixed(1),
        over16ms: +(f.filter((x) => x > 16.7).length / f.length * 100).toFixed(1),
        stats: game.engine.stats(),
      };
      api.perf = res;
      return res;
    },

    // ---- misc ----
    hideUi: (on = true) => { document.getElementById('ui-root').style.opacity = on ? '0' : '1'; },
    fatal: () => window.__MIREFALL_FATAL__ || null,
    errors: () => api._errors,
    _errors: [],
    emit: (evt, payload) => bus.emit(evt, payload),
    EVT,
  };

  // frame hook for perf sampling + camera lock
  const origFrame = game.frame.bind(game);
  let last = performance.now();
  game.frame = (dt) => {
    const t0 = performance.now();
    origFrame(dt);
    const t1 = performance.now();
    if (api._perfHook && api.perf?.frames) api.perf.frames.push(t1 - t0);
    // keep a forced shot applied after the rig runs
    if (api._shotLock && api._shotLock !== 'free' && api._shotLock !== 'gameplay_default') {
      game.applyShot(api._shotLock);
    }
    last = t1;
  };

  const origError = console.error;
  console.error = (...a) => { api._errors.push(a.map(String).join(' ')); origError(...a); };
  window.addEventListener('error', (e) => api._errors.push(String(e.message)));

  window.__MIREFALL__ = api;
  return api;
}

export default installDebugApi;
