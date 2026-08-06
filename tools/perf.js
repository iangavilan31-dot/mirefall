import fs from 'node:fs';
import { launch } from './harness.js';

/**
 * Performance report across quality tiers and gameplay scenarios.
 *   node tools/perf.js [--out captures/perf.json] [--seconds 6]
 *
 * NOTE: headless Chromium usually falls back to a software rasteriser, so absolute
 * numbers are a FLOOR, not a prediction of real desktop GPU performance. Relative
 * comparisons between tiers and scenarios are the meaningful signal. Any real-GPU
 * figure must be measured in a headed browser and labelled as such.
 */

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const OUT = arg('out', 'captures/perf.json');
const SECONDS = parseFloat(arg('seconds', '6'));
const HEADLESS = arg('headed', null) === null;

const SCENARIOS = [
  { id: 'idle_arena', setup: async (api) => { await api.call('start', false); await api.call('teleport', 0, 26); } },
  { id: 'combat_phase1', setup: async (api) => { await api.call('start', false); await api.call('teleport', 0, 6); await api.eval('M.game.rig.lockTarget = M.game.boss;'); } },
  { id: 'combat_phase3', setup: async (api) => { await api.call('forcePhase', 3); await api.call('raisePillars'); await api.call('darken'); } },
  { id: 'moonfall', setup: async (api) => { await api.call('forceAttack', 'moonfall'); } },
  { id: 'with_enemies', setup: async (api) => { for (let i = 0; i < 5; i++) await api.call('spawnEnemy', Math.sin(i) * 6, 6 + Math.cos(i) * 6); } },
];

(async () => {
  const results = [];
  for (const tier of ['potato', 'low', 'medium', 'high', 'ultra']) {
    const { browser, api } = await launch({ quality: tier, headless: HEADLESS });
    await api.call('setAdaptive', false);
    for (const sc of SCENARIOS) {
      try {
        await sc.setup(api);
        await api.settle(1.2);
        await api.call('startPerf');
        await api.settle(SECONDS);
        const r = await api.call('stopPerf');
        results.push({ tier, scenario: sc.id, ...r });
        console.log(`  ${tier.padEnd(7)} ${sc.id.padEnd(16)} ${String(r.avgFps).padStart(6)} fps avg  ` +
          `${String(r.fps1pctLow).padStart(6)} fps 1%low  ${String(r.stats.calls).padStart(4)} draws  ${(r.stats.tris / 1000).toFixed(0)}k tris`);
      } catch (e) {
        console.log(`  ${tier} ${sc.id}: ${e.message}`);
      }
    }
    await browser.close();
  }
  fs.mkdirSync('captures', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    at: new Date().toISOString(),
    renderer: HEADLESS ? 'headless-chromium (software raster likely — floor, not desktop GPU)' : 'headed browser',
    seconds: SECONDS, results,
  }, null, 2));
  console.log(`\n  -> ${OUT}`);
})();
