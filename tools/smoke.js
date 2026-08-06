import { launch } from './harness.js';

/**
 * End-to-end playable-loop check. Exits non-zero if the game is broken.
 * This is the gate that must pass before any wave is considered landed.
 *   node tools/smoke.js
 */

const checks = [];
function check(name, cond, detail = '') {
  checks.push({ name, pass: !!cond, detail });
  console.log(`  ${cond ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}`);
}

(async () => {
  const { browser, api, logs } = await launch({ quality: 'high' });

  try {
    check('boots without fatal', !(await api.call('fatal')));
    check('reaches title state', (await api.call('state')) === 'title');

    // --- start a run ---
    await api.call('start', false);
    await api.settle(0.6);
    check('enters playing state', (await api.call('state')) === 'playing');

    let p = await api.call('player');
    check('player spawns at full health', p.health === 100, `hp=${p.health}`);

    // --- movement: drive the real input path, not a velocity poke ---
    const before = p.pos.slice();
    await api.eval(`
      const { input } = await import('/src/core/Input.js');
      const pl = M.game.player;
      for (let i = 0; i < 60; i++) {
        input.move.x = 0; input.move.y = 1; input.moveMag = 1;
        pl._readIntent(); pl._updateState(1/60); pl._integrate(1/60);
      }
      input.move.y = 0; input.moveMag = 0;`);
    p = await api.call('player');
    const moved = Math.hypot(p.pos[0] - before[0], p.pos[2] - before[2]);
    check('player moves under input', moved > 1.0, `moved ${moved.toFixed(2)}m in 1s`);

    // --- combat: the boss is invulnerable during its entrance, so wait it out ---
    await api.call('teleport', 0, -6);
    await api.settle(5.0);
    check('boss finishes its entrance', (await api.call('boss')).state !== 'intro');
    const b0 = await api.call('boss');
    const dmg = await api.call('damageBoss', 120);
    check('boss takes damage', dmg < b0.health, `${b0.health.toFixed(0)} -> ${dmg.toFixed(0)}`);

    // --- attack state machine ---
    await api.eval(`M.game.player._startAttack('light1');`);
    p = await api.call('player');
    check('light attack enters attack state', p.state === 'attack');
    await api.settle(0.8);
    p = await api.call('player');
    check('attack recovers to neutral', p.state !== 'attack', `state=${p.state}`);

    // --- dodge ---
    await api.eval(`M.game.player._startDodge();`);
    p = await api.call('player');
    check('dodge enters dodge state', p.state === 'dodge');
    await api.settle(0.7);

    // --- every boss attack runs to completion without hanging ---
    // Count _endAttack calls rather than sampling state: the boss may legitimately have
    // already queued its NEXT attack by the time we look.
    await api.eval(`
      const b = M.game.boss;
      if (!b.__endCount) {
        const orig = b._endAttack.bind(b);
        b.__endCount = 0;
        b._endAttack = () => { b.__endCount++; orig(); };
      }`);
    const attacks = await api.call('attacks');
    for (const a of attacks) {
      await api.call('godMode', true);
      const n0 = await api.eval('return M.game.boss.__endCount;');
      await api.eval(`M.game.boss.nextAttackIn = 999;`);   // stop it queueing follow-ups
      await api.call('forceAttack', a);
      await api.settle(a === 'moonfall' ? 5.2 : a === 'legTriple' ? 4.2 : 3.0);
      const n1 = await api.eval('return M.game.boss.__endCount;');
      const bs = await api.call('boss');
      check(`boss attack "${a}" completes`, n1 > n0, `endCount ${n0}->${n1}, state=${bs.state}/${bs.attack}`);
    }
    await api.call('godMode', false);

    // --- phases ---
    for (const ph of [2, 3]) {
      await api.call('forcePhase', ph);
      await api.settle(3.6);
      const bs = await api.call('boss');
      check(`reaches phase ${ph}`, bs.phase === ph, `phase=${bs.phase}`);
    }
    check('phase 2 raised cover pillars', (await api.eval('return M.game.world.pillars.length > 0;')));

    // --- stagger window ---
    await api.call('stagger');
    await api.settle(2.6);
    const stg = await api.call('boss');
    check('stagger lowers the head into reach', stg.headY < 14, `headY=${stg.headY.toFixed(1)}`);
    check('stagger exposes a head hitbox', await api.eval('return M.game.boss.hitParts().some(p => p.name === "head");'));

    // --- enemies ---
    await api.call('spawnEnemy', 2, 2);
    await api.settle(1.4);
    check('enemy spawns and lives', (await api.call('enemyCount')) > 0);

    // --- player death -> death screen ---
    await api.eval('M.game.player.invuln = 0; M.game.player.dead = false; M.game.player.health = 100;');
    await api.call('killPlayer');
    await api.settle(0.3);
    const dyingState = await api.call('state');
    check('player death enters the dying sequence', dyingState === 'dying' || dyingState === 'death', `state=${dyingState}`);
    await api.settle(3.4);
    const deadState = await api.call('state');
    check('player death reaches death state', deadState === 'death', `state=${deadState}`);

    // --- restart from death ---
    await api.eval('M.game.uiAction("retry")');
    await api.settle(1.0);
    check('restart returns to playing', (await api.call('state')) === 'playing');
    check('restart restores health', (await api.call('player')).health === 100);

    // --- boss death -> victory ---
    await api.call('killBoss');
    await api.settle(12.5);
    const st = await api.call('state');
    check('boss death reaches victory', st === 'victory', `state=${st}`);

    // --- ending ---
    await api.eval('M.game.uiAction("ending")');
    await api.settle(0.8);
    check('ending state reachable', (await api.call('state')) === 'ending');

    // --- settings ---
    for (const q of ['potato', 'low', 'medium', 'high', 'ultra']) {
      await api.call('setQuality', q);
      await api.settle(0.5);
      check(`quality tier "${q}" renders`, !(await api.call('fatal')));
    }
    await api.call('setQuality', 'high');

    // --- save/checkpoint ---
    await api.eval('M.game.startRun(false); M.game.boss.health = M.game.boss.maxHealth*0.5; M.game.save();');
    await api.settle(0.4);
    check('checkpoint writes a save', await api.eval('return M.game.hasSave();'));
    await api.eval('M.game.startRun(true);');
    await api.settle(0.6);
    check('checkpoint restores boss health', (await api.call('boss')).health < (await api.call('boss')).max);

    const errs = await api.call('errors');
    check('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  } catch (e) {
    check('smoke run completed', false, e.message);
    console.log(logs.slice(-25).join('\n'));
  }

  await browser.close();
  const failed = checks.filter((c) => !c.pass);
  console.log(`\n  ${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) {
    console.log('\n  FAILURES:');
    for (const f of failed) console.log(`    ✗ ${f.name} ${f.detail}`);
    process.exit(1);
  }
})();
