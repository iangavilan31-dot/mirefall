import fs from 'node:fs';
import path from 'node:path';
import { launch, shoot } from './harness.js';

/**
 * Repeatable screenshot suite. Every shot in docs/ART_TARGET.md §12 is reproduced here so
 * critics compare like for like across passes.
 *
 *   node tools/capture.js [--out captures/passN] [--quality high] [--only hero,boss_close]
 */

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const OUT = arg('out', 'captures/latest');
const QUALITY = arg('quality', 'high');
const ONLY = arg('only', null)?.split(',');

const SHOTS = [
  {
    id: 'hero', desc: 'The reference frame recreated: player low-left, boss crowned by moon, wings full width.',
    setup: async (api) => {
      await api.call('start', false);
      await api.call('teleport', 0, 26);
      await api.call('setBossHealth', 1.0);
      await api.call('setTimeScale', 0);
      await api.call('hideUi', true);
      await api.call('shot', 'hero');
    },
  },
  {
    id: 'gameplay_default', desc: 'Same qualities from the normal over-shoulder combat camera.',
    setup: async (api) => {
      await api.call('releaseCamera');
      await api.call('hideUi', false);
      await api.call('setTimeScale', 1);
      await api.call('teleport', 0, 18);
      await api.eval('M.game.rig.lockTarget = M.game.boss; M.game.rig.yaw = Math.PI; M.game.rig.pitch = 0.16;');
    },
    settle: 1.6,
  },
  {
    id: 'boss_close', desc: 'Wing translucency, moss detail, eye bloom at close range.',
    setup: async (api) => { await api.call('hideUi', true); await api.call('setTimeScale', 0); await api.call('shot', 'boss_close'); },
  },
  {
    id: 'player_close', desc: 'Hat silhouette, straw fringe, blade highlight, waterline ripples.',
    setup: async (api) => { await api.call('shot', 'player_close'); },
  },
  {
    id: 'wide_arena', desc: 'Fog hides the world limits; both frame edges framed by architecture.',
    setup: async (api) => { await api.call('shot', 'wide_arena'); },
  },
  {
    id: 'left_frame', desc: 'Left-edge architecture framing and lantern warmth.',
    setup: async (api) => { await api.call('shot', 'left_frame'); },
  },
  {
    id: 'lotus', desc: 'The pink accent reads as the only saturated object in frame.',
    setup: async (api) => { await api.call('shot', 'lotus'); },
  },
  {
    id: 'combat_light', desc: 'Mid-swing: sword trail, impact sparks, water disturbance.',
    setup: async (api) => {
      await api.call('releaseCamera'); await api.call('hideUi', false); await api.call('setTimeScale', 1);
      await api.call('teleport', 2, -2);
      await api.eval('M.game.rig.lockTarget = M.game.boss;');
      await api.eval(`
        M.game.player._startAttack('light2');
        M.game.player.stateTime = 0.13;`);
    },
    settle: 0.12,
  },
  {
    id: 'telegraph_legslam', desc: 'Readable telegraph: closing ring decal, raised limb, eye flare.',
    setup: async (api) => {
      await api.call('setTimeScale', 1);
      await api.call('teleport', 0, 6);
      await api.call('forceAttack', 'legSlam');
    },
    settle: 0.7,
  },
  {
    id: 'telegraph_moonfall', desc: 'Arena-wide telegraph with cover pillars present.',
    setup: async (api) => {
      await api.call('forcePhase', 3);
      await api.call('raisePillars');
      await api.call('settle');
      await api.call('forceAttack', 'moonfall');
    },
    settle: 2.0,
  },
  {
    id: 'phase2', desc: 'Phase 2 arena alteration: risen shrine pillars.',
    setup: async (api) => {
      await api.call('start', false);
      await api.call('forcePhase', 2);
      await api.call('raisePillars');
      await api.call('teleport', 0, 16);
      await api.eval('M.game.rig.lockTarget = M.game.boss;');
    },
    settle: 2.4,
  },
  {
    id: 'phase3', desc: 'Phase 3: fog thickens, lanterns snuff, water darkens.',
    setup: async (api) => {
      await api.call('forcePhase', 3);
      await api.call('darken');
    },
    settle: 3.4,
  },
  {
    id: 'stagger', desc: 'Poise break: head lowered into reach — the payoff for the scale mechanic.',
    setup: async (api) => {
      await api.call('start', false);
      await api.call('teleport', 0, 8);
      await api.call('stagger');
      await api.eval('M.game.rig.lockTarget = M.game.boss;');
    },
    settle: 2.6,
  },
  {
    id: 'enemies', desc: 'Lesser mire-spawn readability against the environment.',
    setup: async (api) => {
      await api.call('start', false);
      await api.call('teleport', 0, 20);
      await api.call('spawnEnemy', 3, 16);
      await api.call('spawnEnemy', -3, 17);
      await api.call('spawnEnemy', 1, 14);
      await api.eval('M.game.rig.lockTarget = null; M.game.rig.yaw = Math.PI;');
    },
    settle: 2.2,
  },
  {
    id: 'damage', desc: 'Player damage feedback: vignette, hit reaction pose.',
    setup: async (api) => { await api.call('hurtPlayer', 32); },
    settle: 0.16,
  },
  {
    id: 'death', desc: 'Death state screen holds the palette.',
    setup: async (api) => { await api.call('killPlayer'); },
    settle: 3.4,
  },
  {
    id: 'boss_death', desc: 'Defeat sequence: it descends into the water, eyes going out.',
    setup: async (api) => {
      await api.call('start', false);
      await api.call('teleport', 0, 20);
      await api.call('killBoss');
    },
    settle: 6.0,
  },
  {
    id: 'victory', desc: 'Victory state.',
    setup: async (api) => { await api.call('setState', 'victory'); },
    settle: 1.2,
  },
  {
    id: 'title', desc: 'Title screen composition.',
    setup: async (api) => { await api.call('setState', 'title'); },
    settle: 2.0,
  },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page, api, logs } = await launch({ quality: QUALITY });
  const manifest = [];

  const list = ONLY ? SHOTS.filter((s) => ONLY.includes(s.id)) : SHOTS;
  for (const s of list) {
    try {
      await api.call('setTimeScale', 1);
      await s.setup(api);
      await api.settle(s.settle ?? 0.9);
      const file = path.join(OUT, `${s.id}.png`);
      await shoot(page, file);
      const stats = await api.call('stats');
      manifest.push({ id: s.id, desc: s.desc, file, fps: stats.fps, calls: stats.calls, tris: stats.tris });
      console.log(`  ✓ ${s.id.padEnd(20)} ${String(stats.fps).padStart(5)} fps  ${String(stats.calls).padStart(4)} draws  ${(stats.tris / 1000).toFixed(0)}k tris`);
    } catch (e) {
      console.log(`  ✗ ${s.id}: ${e.message}`);
      manifest.push({ id: s.id, desc: s.desc, error: e.message });
    }
  }

  const errs = await api.call('errors');
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
    at: new Date().toISOString(), quality: QUALITY, shots: manifest,
    consoleErrors: errs, logTail: logs.slice(-40),
  }, null, 2));

  console.log(`\n  ${manifest.filter((m) => !m.error).length}/${list.length} shots -> ${OUT}`);
  if (errs.length) console.log(`  ⚠ ${errs.length} console errors`);
  await browser.close();
})();
