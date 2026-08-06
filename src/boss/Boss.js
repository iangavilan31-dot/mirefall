import * as THREE from 'three';
import { BossModel } from './BossModel.js';
import { bus, EVT } from '../core/EventBus.js';
import { PALETTE, SCALE } from '../core/Palette.js';
import { settings } from '../core/Settings.js';

/**
 * The encounter.
 *
 * Scale problem, solved by design: the deity hovers 26 m up, so the player can never reach
 * its head in normal play. The LEGS are the reachable weak points. Enough leg punishment
 * breaks its poise, it crashes down, and the head becomes hittable for a burst window at
 * 2.5x damage. That is what makes "you are tiny" a mechanic and not just a camera trick.
 */

const PHASES = [
  { at: 1.00, name: 1, attacks: ['legSlam', 'sporeFall', 'gustSweep'],                        gap: [2.6, 3.8], rage: 0.0 },
  { at: 0.68, name: 2, attacks: ['legSlam', 'sporeFall', 'gustSweep', 'dive', 'summon'],      gap: [1.9, 3.0], rage: 0.45 },
  { at: 0.32, name: 3, attacks: ['legSlam', 'sporeFall', 'gustSweep', 'dive', 'moonfall', 'legTriple'], gap: [1.3, 2.3], rage: 1.0 },
];

const DIFF_SCALE = { wanderer: 1.0, pilgrim: 0.72, drowned: 1.45 };

export class Boss {
  constructor(scene, water, sky, player, fx) {
    this.scene = scene;
    this.water = water;
    this.player = player;
    this.fx = fx;

    this.model = new BossModel(sky);
    scene.add(this.model.root);
    this.root = this.model.root;

    this.maxHealth = 1350;
    this.health = this.maxHealth;
    this.dead = false;
    this.phase = 1;
    this._phaseIndex = 0;

    this.maxPoise = 240;
    this.poise = this.maxPoise;
    this.staggered = false;
    this.staggerTime = 0;

    this.state = 'intro';
    this.stateTime = 0;
    this.attackName = null;
    this.attackTime = 0;
    this.nextAttackIn = 4.5;
    this.dmgScale = DIFF_SCALE[settings.get('difficulty')] || 1;

    this.hovering = new THREE.Vector3(0, 0, -14);
    this.targetPos = this.hovering.clone();
    this.heightOffset = 0;
    this._targetHeightOffset = 0;
    this.rage = 0;

    this.hazards = [];       // active damage volumes
    this.decals = [];        // telegraph decals
    this._legWorld = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._hitParts = [];
    this.lockRadiusValue = 22;

    this.arenaPillars = [];
    this.onSummon = null;    // set by Game to spawn enemies
    this.onArenaChange = null;

    this._buildDecalPool();
    this._introTimer = 0;
  }

  // ------------------------------------------------------------- interface --
  lockPoint() {
    if (this.staggered) return this.model.headWorld(this._tmp).clone();
    // when it is airborne, lock onto the base of the nearest leg so the camera stays sane
    const leg = this._nearestLeg();
    if (leg) { leg.foot.getWorldPosition(this._tmp); this._tmp.y += 2.5; return this._tmp.clone(); }
    return this.model.headWorld(this._tmp).clone();
  }
  lockRadius() { return this.staggered ? 10 : this.lockRadiusValue; }

  /** Reachable hit volumes for the player's sword. */
  hitParts() {
    this._hitParts.length = 0;
    for (const leg of this.model.legs) {
      leg.foot.getWorldPosition(this._legWorld);
      // only the lower part of the leg is reachable from the water
      if (this._legWorld.y < 4.5) {
        this._hitParts.push({ pos: this._legWorld.clone().setY(Math.max(0.6, this._legWorld.y + 1.6)), radius: 1.5, name: 'leg', leg });
      }
    }
    if (this.staggered) {
      const h = this.model.headWorld(this._tmp);
      if (h.y < 9) this._hitParts.push({ pos: h.clone(), radius: 4.0, name: 'head' });
    }
    return this._hitParts;
  }

  takeDamage(amount, hitPos, opts = {}) {
    if (this.dead || this.state === 'intro' || this.state === 'dying') return;
    const isHead = opts.part === 'head';
    const mult = isHead ? 2.5 : 1.0;
    const dmg = amount * mult;
    this.health = Math.max(0, this.health - dmg);
    this.model.flashDamage(isHead ? 1.2 : 0.55);

    if (!this.staggered) {
      this.poise -= amount * (opts.heavy ? 1.7 : 1.0);
      if (this.poise <= 0) this._stagger();
    }

    bus.emit(EVT.BOSS_HIT, { damage: dmg, pos: hitPos, part: opts.part });
    bus.emit(EVT.SFX, { id: isHead ? 'bossHitHead' : 'bossHitLeg', pos: hitPos, gain: isHead ? 1.0 : 0.7 });
    this.fx?.hitImpact(hitPos, { heavy: opts.heavy, big: isHead });
    // the leg recoils
    if (opts.leg) { opts.leg.anim = opts.leg.anim || {}; }

    this._checkPhase();
    if (this.health <= 0) this._beginDeath();
  }

  _stagger() {
    this.staggered = true;
    this.staggerTime = 0;
    this.state = 'stagger';
    this.stateTime = 0;
    this.attackName = null;
    this._clearDecals();
    this.hazards.length = 0;
    bus.emit(EVT.BOSS_STAGGER);
    bus.emit(EVT.SFX, { id: 'bossStagger', gain: 1.0 });
    bus.emit(EVT.CAMERA_SHAKE, { amount: 1.0, duration: 0.9 });
    bus.emit(EVT.TOAST, { text: 'ITS POISE BREAKS' });
    // massive water displacement as it crashes down
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 20;
      this.water.splash(this.root.position.x + Math.sin(a) * r, this.root.position.z + Math.cos(a) * r, 0.9, 2.2);
    }
    this.fx?.bigSplash(this.root.position.clone(), 3.0);
  }

  _checkPhase() {
    const frac = this.health / this.maxHealth;
    for (let i = PHASES.length - 1; i >= 0; i--) {
      if (frac <= PHASES[i].at && i > this._phaseIndex) {
        this._phaseIndex = i;
        this.phase = PHASES[i].name;
        this.rage = PHASES[i].rage;
        this._enterPhase();
        break;
      }
    }
  }

  _enterPhase() {
    this.state = 'phaseShift';
    this.stateTime = 0;
    this.attackName = null;
    this._clearDecals();
    this.hazards.length = 0;
    bus.emit(EVT.BOSS_PHASE, { phase: this.phase });
    bus.emit(EVT.SFX, { id: 'bossRoar', gain: 1.0 });
    bus.emit(EVT.MUSIC, { cue: 'phase' + this.phase });
    bus.emit(EVT.CAMERA_SHAKE, { amount: 1.1, duration: 1.4 });
    bus.emit(EVT.TOAST, { text: this.phase === 2 ? 'THE MIRE ANSWERS' : 'IT UNMAKES THE MOON' });
    this.onArenaChange?.(this.phase);
    this.poise = this.maxPoise;
  }

  // ------------------------------------------------------------ decal pool --
  _buildDecalPool() {
    this._decalPool = [];
    const geo = new THREE.RingGeometry(0.72, 1.0, 48);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 14; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: PALETTE.dangerTell.clone(), transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
        blending: THREE.AdditiveBlending,
      });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.renderOrder = 5;
      m.position.y = SCALE.waterLevel + 0.03;
      this.scene.add(m);
      this._decalPool.push(m);
    }
  }

  _decal(x, z, radius, duration, kind = 'circle') {
    const m = this._decalPool.find((d) => !d.visible);
    if (!m) return null;
    m.visible = true;
    m.position.set(x, SCALE.waterLevel + 0.04, z);
    m.scale.setScalar(radius);
    m.material.opacity = 0;
    const hc = settings.get('highContrastTells');
    m.material.color.copy(settings.get('colourBlindSafeTells') ? new THREE.Color(0x66ccff) : PALETTE.dangerTell);
    const d = { mesh: m, t: 0, duration, radius, kind, hc };
    this.decals.push(d);
    return d;
  }

  _clearDecals() {
    for (const d of this.decals) { d.mesh.visible = false; d.mesh.material.opacity = 0; }
    this.decals.length = 0;
  }

  _updateDecals(dt) {
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.t += dt;
      const k = Math.min(1, d.t / d.duration);
      // fill-up read: the ring closes in as the strike approaches
      const inner = 1 - k;
      d.mesh.scale.setScalar(d.radius * (d.kind === 'closing' ? Math.max(0.04, inner) : 1));
      const pulse = 0.55 + 0.45 * Math.sin(d.t * (10 + k * 22));
      d.mesh.material.opacity = (d.hc ? 0.85 : 0.55) * pulse * (k < 0.92 ? 1 : (1 - (k - 0.92) / 0.08));
      if (d.t >= d.duration) { d.mesh.visible = false; d.mesh.material.opacity = 0; this.decals.splice(i, 1); }
    }
  }

  // ---------------------------------------------------------------- update --
  update(dt, elapsed) {
    const p = this.player;
    this.stateTime += dt;
    this._updateDecals(dt);
    this._updateHazards(dt);

    const ctx = {
      rage: this.rage,
      lookAt: p && !p.dead ? p.pos.clone().setY(p.pos.y + 1) : null,
      heightOffset: this.heightOffset,
      eyeIntensity: this._eyeIntensity ?? 1,
      eyeColor: this._eyeColor,
      wingFlare: this._wingFlare || 0,
      flapAmp: this._flapAmp ?? 1,
      pitch: this._pitch || 0,
      roll: this._roll || 0,
      wind: this._wind || 0,
    };

    switch (this.state) {
      case 'intro': this._updateIntro(dt); break;
      case 'idle': this._updateIdle(dt); break;
      case 'attack': this._updateAttack(dt); break;
      case 'stagger': this._updateStagger(dt); break;
      case 'phaseShift': this._updatePhaseShift(dt); break;
      case 'dying': this._updateDying(dt, ctx); break;
    }

    // smooth height
    this.heightOffset += (this._targetHeightOffset - this.heightOffset) * Math.min(1, dt * 2.2);
    ctx.heightOffset = this.heightOffset;
    ctx.eyeIntensity = this._eyeIntensity ?? 1;

    // reposition: drift to stay in front of the player without ever closing fully
    if (this.state === 'idle' || this.state === 'attack') this._drift(dt);

    this.model.update(dt, elapsed, ctx);
    this._legWaterInteraction(dt, elapsed);

    this._eyeIntensity = THREE.MathUtils.damp(this._eyeIntensity ?? 1, this._eyeTarget ?? 1, 6, dt);
    this._wingFlare = THREE.MathUtils.damp(this._wingFlare || 0, this._wingFlareTarget || 0, 5, dt);
  }

  _drift(dt) {
    const p = this.player;
    if (!p) return;
    const toP = this._tmp.subVectors(p.pos, this.root.position);
    toP.y = 0;
    const dist = toP.length();
    const want = 17;
    if (dist > 0.01) {
      toP.normalize();
      const speed = (dist > want + 4 ? 2.6 : dist < want - 4 ? -1.9 : 0) * (1 + this.rage * 0.6);
      this.root.position.addScaledVector(toP, speed * dt);
      // face the player
      const yaw = Math.atan2(toP.x, toP.z);
      this.root.rotation.y = dampAngle(this.root.rotation.y, yaw, 1.6, dt);
      // bank into the drift
      this._roll = THREE.MathUtils.damp(this._roll || 0, 0, 3, dt);
    }
    const r = Math.hypot(this.root.position.x, this.root.position.z);
    if (r > SCALE.arenaRadius * 0.55) {
      this.root.position.multiplyScalar((SCALE.arenaRadius * 0.55) / r);
    }
  }

  _updateIntro(dt) {
    this._targetHeightOffset = Math.max(0, 26 - this.stateTime * 9);
    this._flapAmp = 0.45;
    this._eyeTarget = Math.min(1, this.stateTime / 3.2);
    if (this.stateTime > 4.2) {
      this.state = 'idle';
      this.stateTime = 0;
      this.nextAttackIn = 2.0;
      this._targetHeightOffset = 0;
      this._flapAmp = 1;
    }
  }

  _updateIdle(dt) {
    this._flapAmp = 1;
    this._eyeTarget = 1;
    this._wingFlareTarget = 0;
    this.nextAttackIn -= dt;
    if (this.nextAttackIn <= 0 && this.player && !this.player.dead) this._pickAttack();
    // poise slowly recovers so the player can't chip-stagger forever
    this.poise = Math.min(this.maxPoise, this.poise + dt * 5.5);
  }

  _pickAttack() {
    const ph = PHASES[this._phaseIndex];
    const pool = ph.attacks.filter((a) => a !== this._lastAttack || Math.random() < 0.25);
    const name = pool[Math.floor(Math.random() * pool.length)];
    this._lastAttack = name;
    this.attackName = name;
    this.state = 'attack';
    this.stateTime = 0;
    this.attackTime = 0;
    this._attackStage = 0;
    this._attackData = {};
    this[`_begin_${name}`]?.();
    bus.emit(EVT.BOSS_TELEGRAPH, { attack: name, duration: this._attackData.tell || 1.0 });
  }

  _endAttack() {
    this.state = 'idle';
    this.stateTime = 0;
    this.attackName = null;
    this._wingFlareTarget = 0;
    this._targetHeightOffset = 0;
    const ph = PHASES[this._phaseIndex];
    this.nextAttackIn = ph.gap[0] + Math.random() * (ph.gap[1] - ph.gap[0]);
  }

  _updateAttack(dt) {
    const fn = this[`_run_${this.attackName}`];
    if (!fn) { this._endAttack(); return; }
    fn.call(this, dt);
  }

  _updateStagger(dt) {
    this._targetHeightOffset = -18.5;
    this._flapAmp = 0.12;
    this._pitch = THREE.MathUtils.damp(this._pitch || 0, 0.42, 3, dt);
    this._eyeTarget = 0.35;
    this.staggerTime += dt;
    if (this.staggerTime > 7.0) {
      this.staggered = false;
      this.poise = this.maxPoise;
      this._targetHeightOffset = 0;
      this._pitch = 0;
      this.state = 'idle';
      this.stateTime = 0;
      this.nextAttackIn = 1.0;
      bus.emit(EVT.SFX, { id: 'bossRecover', gain: 0.9 });
      bus.emit(EVT.CAMERA_SHAKE, { amount: 0.7, duration: 0.7 });
      // punish lingering players
      this._shockwave(this.root.position.x, this.root.position.z, 3, 30, 22, 0.6);
    }
  }

  _updatePhaseShift(dt) {
    this._targetHeightOffset = 8 + Math.sin(this.stateTime * 2) * 2;
    this._flapAmp = 1.9;
    this._eyeTarget = 2.2;
    this._wingFlareTarget = 1.0;
    this._wind = 1.5;
    if (this.stateTime > 0.9 && !this._phaseBlast) {
      this._phaseBlast = true;
      this._shockwave(this.root.position.x, this.root.position.z, 4, 46, 26, 0.75);
      this.fx?.sporeBurst(this.root.position.clone().setY(6), 3.0);
    }
    if (this.stateTime > 3.0) {
      this._phaseBlast = false;
      this._wind = 0;
      this.state = 'idle';
      this.stateTime = 0;
      this.nextAttackIn = 1.2;
      this._targetHeightOffset = 0;
    }
  }

  // ------------------------------------------------------------- attacks ----
  _nearestLeg() {
    if (!this.player) return this.model.legs[0];
    let best = null, bd = Infinity;
    for (const leg of this.model.legs) {
      leg.foot.getWorldPosition(this._legWorld);
      const d = this._legWorld.distanceToSquared(this.player.pos);
      if (d < bd) { bd = d; best = leg; }
    }
    return best;
  }

  // --- LEG SLAM: a single leg rises, hangs, and drives into the water -------
  _begin_legSlam() {
    const leg = this._nearestLeg();
    this._attackData = { leg, tell: 0.95, done: false, target: this.player.pos.clone() };
    leg.anim = { active: true, hipX: 0, hipZ: 0, kneeX: 0 };
    this._decal(this._attackData.target.x, this._attackData.target.z, 5.4, 0.95, 'closing');
    bus.emit(EVT.SFX, { id: 'tellLeg', pos: this._attackData.target.clone(), gain: 0.8 });
    this._eyeTarget = 1.9;
  }

  _run_legSlam(dt) {
    const d = this._attackData;
    const t = this.stateTime;
    const leg = d.leg;
    if (t < d.tell) {
      const k = t / d.tell;
      leg.anim.hipX = -0.55 * ease(k);
      leg.anim.kneeX = 0.9 * ease(k);
      this._roll = Math.sin(k * Math.PI) * 0.06;
    } else if (t < d.tell + 0.16) {
      const k = (t - d.tell) / 0.16;
      leg.anim.hipX = -0.55 + 1.25 * k * k;
      leg.anim.kneeX = 0.9 - 1.5 * k * k;
    } else if (!d.done) {
      d.done = true;
      leg.foot.getWorldPosition(this._legWorld);
      const x = d.target.x, z = d.target.z;
      this._shockwave(x, z, 2.0, 15, 26, 0.5);
      this.fx?.bigSplash(new THREE.Vector3(x, 0, z), 2.2);
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 5;
        this.water.splash(x + Math.sin(a) * r, z + Math.cos(a) * r, 0.85, 1.5);
      }
      bus.emit(EVT.SFX, { id: 'legSlam', pos: new THREE.Vector3(x, 0, z), gain: 1.0 });
      bus.emit(EVT.CAMERA_SHAKE, { amount: 0.95, duration: 0.6 });
      bus.emit(EVT.BOSS_ATTACK, { attack: 'legSlam' });
    } else if (t > d.tell + 0.75) {
      leg.anim.active = false;
      this._endAttack();
    } else {
      const k = (t - d.tell - 0.16) / 0.6;
      leg.anim.hipX = 0.70 * (1 - k);
      leg.anim.kneeX = -0.60 * (1 - k);
    }
  }

  _begin_legTriple() {
    this._attackData = { tell: 0.7, count: 0, timer: 0 };
    this._eyeTarget = 2.1;
  }
  _run_legTriple(dt) {
    const d = this._attackData;
    d.timer -= dt;
    if (d.timer <= 0 && d.count < 3) {
      const t = this.player.pos.clone();
      t.x += (Math.random() - 0.5) * 4; t.z += (Math.random() - 0.5) * 4;
      this._decal(t.x, t.z, 4.6, 0.62, 'closing');
      setTimeoutSafe(this, 0.62, () => {
        this._shockwave(t.x, t.z, 1.8, 13, 22, 0.42);
        this.fx?.bigSplash(t.clone(), 1.7);
        bus.emit(EVT.SFX, { id: 'legSlam', pos: t.clone(), gain: 0.9 });
        bus.emit(EVT.CAMERA_SHAKE, { amount: 0.7, duration: 0.4 });
      });
      d.timer = 0.82;
      d.count++;
    }
    if (d.count >= 3 && this.stateTime > 3.1) this._endAttack();
  }

  // --- SPORE FALL: telegraphed AoE circles, then bursts that leave pools ----
  _begin_sporeFall() {
    const n = this.phase === 1 ? 4 : this.phase === 2 ? 6 : 8;
    const spots = [];
    const pp = this.player.pos;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = i === 0 ? 0 : 3 + Math.random() * 13;
      spots.push(new THREE.Vector3(pp.x + Math.sin(a) * r, 0, pp.z + Math.cos(a) * r));
    }
    this._attackData = { tell: 1.25, spots, fired: false };
    for (const s of spots) this._decal(s.x, s.z, 3.5, 1.25);
    this._eyeTarget = 1.6;
    this._targetHeightOffset = 3;
    bus.emit(EVT.SFX, { id: 'tellSpore', gain: 0.7 });
  }

  _run_sporeFall(dt) {
    const d = this._attackData;
    if (this.stateTime > d.tell && !d.fired) {
      d.fired = true;
      for (const s of d.spots) {
        this._hazard({ x: s.x, z: s.z, r: 3.5, dmg: 16, life: 2.4, tick: 0.55, kind: 'spore' });
        this.fx?.sporeBurst(s.clone(), 1.3);
        this.water.splash(s.x, s.z, 0.55, 1.6);
      }
      bus.emit(EVT.SFX, { id: 'sporeBurst', pos: d.spots[0].clone(), gain: 0.9 });
      bus.emit(EVT.CAMERA_SHAKE, { amount: 0.4, duration: 0.4 });
      bus.emit(EVT.BOSS_ATTACK, { attack: 'sporeFall' });
    }
    if (this.stateTime > d.tell + 1.0) this._endAttack();
  }

  // --- GUST SWEEP: wings flare, then a cone of wind pushes and damages ------
  _begin_gustSweep() {
    this._attackData = { tell: 1.15, fired: false, dir: null };
    this._wingFlareTarget = 1.0;
    this._eyeTarget = 1.5;
    this._targetHeightOffset = 5;
    bus.emit(EVT.SFX, { id: 'tellGust', gain: 0.8 });
  }

  _run_gustSweep(dt) {
    const d = this._attackData;
    if (this.stateTime < d.tell) {
      this._wind = this.stateTime / d.tell * 0.8;
      return;
    }
    if (!d.fired) {
      d.fired = true;
      d.dir = this._tmp.subVectors(this.player.pos, this.root.position).setY(0).normalize().clone();
      this._wingFlareTarget = -0.7;
      this._wind = 3.0;
      this._hazard({
        x: this.root.position.x, z: this.root.position.z, r: 46, dmg: 14, life: 0.85, tick: 0.85,
        kind: 'gust', cone: { dir: d.dir, halfAngle: 0.62 }, push: 16,
      });
      // the whole surface is driven away from the boss
      for (let i = 0; i < 30; i++) {
        const a = Math.atan2(d.dir.x, d.dir.z) + (Math.random() - 0.5) * 1.3;
        const r = 6 + Math.random() * 34;
        this.water.splash(this.root.position.x + Math.sin(a) * r, this.root.position.z + Math.cos(a) * r, 0.6, 2.4);
      }
      this.fx?.gust(this.root.position.clone().setY(4), d.dir.clone());
      bus.emit(EVT.SFX, { id: 'gust', gain: 1.0 });
      bus.emit(EVT.CAMERA_SHAKE, { amount: 0.6, duration: 0.8 });
      bus.emit(EVT.BOSS_ATTACK, { attack: 'gustSweep' });
    }
    this._wind = Math.max(0, this._wind - dt * 3);
    if (this.stateTime > d.tell + 1.1) this._endAttack();
  }

  // --- DIVE: the deity drops and sweeps along a telegraphed line ------------
  _begin_dive() {
    const from = this.root.position.clone();
    const to = this.player.pos.clone();
    const dir = to.clone().sub(from).setY(0).normalize();
    const start = to.clone().addScaledVector(dir, -26);
    const end = to.clone().addScaledVector(dir, 24);
    this._attackData = { tell: 1.4, dir, start, end, fired: false, progress: 0 };
    // line telegraph as a chain of rings
    for (let i = 0; i <= 8; i++) {
      const p = start.clone().lerp(end, i / 8);
      this._decal(p.x, p.z, 4.2, 1.4);
    }
    this._eyeTarget = 2.0;
    this._targetHeightOffset = 12;
    bus.emit(EVT.SFX, { id: 'tellDive', gain: 0.9 });
  }

  _run_dive(dt) {
    const d = this._attackData;
    if (this.stateTime < d.tell) {
      this._flapAmp = 1.8;
      this._pitch = THREE.MathUtils.damp(this._pitch || 0, -0.25, 4, dt);
      return;
    }
    if (!d.fired) {
      d.fired = true;
      this.root.position.copy(d.start);
      this._targetHeightOffset = -19;
      this.heightOffset = -19;
      this._pitch = 0.30;
      bus.emit(EVT.SFX, { id: 'dive', gain: 1.0 });
      bus.emit(EVT.BOSS_ATTACK, { attack: 'dive' });
    }
    d.progress = Math.min(1, d.progress + dt / 1.05);
    const p = d.start.clone().lerp(d.end, ease(d.progress));
    this.root.position.set(p.x, 0, p.z);
    this.root.rotation.y = Math.atan2(d.dir.x, d.dir.z);
    this._roll = Math.sin(d.progress * Math.PI) * 0.22;

    // continuous damage volume travelling with the body
    if (this.player && !this.player.dead) {
      const dx = this.player.pos.x - p.x, dz = this.player.pos.z - p.z;
      if (Math.hypot(dx, dz) < 7.0) {
        const dir = new THREE.Vector3(dx, 0, dz).normalize();
        if (this.player.takeDamage(30 * this.dmgScale, dir, 'dive')) {
          this.player.vel.addScaledVector(dir, 14);
        }
      }
    }
    // it drags a violent wake
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 8;
      this.water.splash(p.x + Math.sin(a) * r, p.z + Math.cos(a) * r, 0.8, 1.8);
    }
    if (d.progress >= 1) {
      this._targetHeightOffset = 0;
      this._pitch = 0;
      this.fx?.bigSplash(p.clone(), 2.5);
      bus.emit(EVT.CAMERA_SHAKE, { amount: 0.8, duration: 0.6 });
      this._endAttack();
    }
  }

  // --- MOONFALL: arena-wide. Take cover behind a risen pillar or be crushed --
  _begin_moonfall() {
    this._attackData = { tell: 2.6, fired: false };
    this._targetHeightOffset = 16;
    this._eyeTarget = 2.6;
    this._wingFlareTarget = 1.0;
    bus.emit(EVT.TOAST, { text: 'TAKE COVER' });
    bus.emit(EVT.SFX, { id: 'tellMoonfall', gain: 1.0 });
    bus.emit(EVT.MUSIC, { cue: 'danger' });
  }

  _run_moonfall(dt) {
    const d = this._attackData;
    if (this.stateTime < d.tell) {
      this._wind = this.stateTime / d.tell * 2.5;
      this._flapAmp = 1.0 + this.stateTime / d.tell;
      if (this.fx) this.fx.moonfallCharge(this.stateTime / d.tell);
      return;
    }
    if (!d.fired) {
      d.fired = true;
      const covered = this._playerHasCover();
      this.fx?.moonfallStrike();
      bus.emit(EVT.SFX, { id: 'moonfall', gain: 1.0 });
      bus.emit(EVT.CAMERA_SHAKE, { amount: 1.6, duration: 1.5 });
      bus.emit(EVT.BOSS_ATTACK, { attack: 'moonfall' });
      for (let i = 0; i < 60; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * SCALE.arenaRadius;
        this.water.splash(Math.sin(a) * r, Math.cos(a) * r, 1.0, 2.6);
      }
      if (!covered && this.player && !this.player.dead) {
        const dir = this.player.pos.clone().sub(this.root.position).setY(0).normalize();
        this.player.takeDamage(52 * this.dmgScale, dir, 'moonfall');
      } else {
        bus.emit(EVT.TOAST, { text: 'SHELTERED' });
      }
      this._wind = 0;
    }
    if (this.stateTime > d.tell + 1.6) { this._targetHeightOffset = 0; this._endAttack(); }
  }

  _playerHasCover() {
    if (!this.player) return false;
    for (const p of this.arenaPillars) {
      const d = Math.hypot(this.player.pos.x - p.x, this.player.pos.z - p.z);
      if (d < p.r + 2.6) return true;
    }
    return false;
  }

  // --- SUMMON -------------------------------------------------------------
  _begin_summon() {
    this._attackData = { tell: 1.1, fired: false };
    this._eyeTarget = 1.8;
    this._targetHeightOffset = 4;
    bus.emit(EVT.SFX, { id: 'tellSummon', gain: 0.8 });
  }
  _run_summon(dt) {
    const d = this._attackData;
    if (this.stateTime > d.tell && !d.fired) {
      d.fired = true;
      const n = 3;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random();
        const r = 9 + Math.random() * 8;
        const pos = new THREE.Vector3(this.player.pos.x + Math.sin(a) * r, 0, this.player.pos.z + Math.cos(a) * r);
        this.onSummon?.(pos);
        this.water.splash(pos.x, pos.z, 0.7, 1.4);
        this.fx?.sporeBurst(pos.clone().setY(0.5), 0.9);
      }
      bus.emit(EVT.SFX, { id: 'summon', gain: 0.9 });
    }
    if (this.stateTime > d.tell + 0.9) this._endAttack();
  }

  // ------------------------------------------------------------- hazards ----
  _hazard(h) { h.t = 0; h.lastTick = -99; this.hazards.push(h); }

  _shockwave(x, z, speed, maxR, dmg, width) {
    this._hazard({ x, z, r: 0.5, maxR, speed, dmg, width, kind: 'ring', life: maxR / speed, tick: 99 });
    this.fx?.shockwave(new THREE.Vector3(x, 0.05, z), maxR, maxR / speed);
  }

  _updateHazards(dt) {
    const p = this.player;
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.t += dt;
      if (h.kind === 'ring') {
        h.r += h.speed * dt;
        if (p && !p.dead) {
          const d = Math.hypot(p.pos.x - h.x, p.pos.z - h.z);
          if (Math.abs(d - h.r) < (h.width || 0.6) + 0.4 && !h.hitPlayer) {
            h.hitPlayer = true;
            const dir = new THREE.Vector3(p.pos.x - h.x, 0, p.pos.z - h.z).normalize();
            if (p.takeDamage(h.dmg * this.dmgScale, dir, 'shockwave')) p.vel.addScaledVector(dir, 9);
          }
        }
        if (h.r >= h.maxR) this.hazards.splice(i, 1);
        continue;
      }
      if (p && !p.dead && h.t - h.lastTick >= h.tick) {
        let inside = false;
        const dx = p.pos.x - h.x, dz = p.pos.z - h.z;
        const dist = Math.hypot(dx, dz);
        if (dist < h.r) {
          inside = true;
          if (h.cone) {
            const to = new THREE.Vector3(dx, 0, dz).normalize();
            if (Math.acos(THREE.MathUtils.clamp(to.dot(h.cone.dir), -1, 1)) > h.cone.halfAngle) inside = false;
          }
        }
        if (inside) {
          h.lastTick = h.t;
          const dir = new THREE.Vector3(dx, 0, dz).normalize();
          if (p.takeDamage(h.dmg * this.dmgScale, dir, h.kind)) {
            if (h.push) p.vel.addScaledVector(dir, h.push);
          }
        }
      }
      if (h.t >= h.life) this.hazards.splice(i, 1);
    }

    // deferred callbacks (used by legTriple)
    if (this._timers) {
      for (let i = this._timers.length - 1; i >= 0; i--) {
        this._timers[i].t -= dt;
        if (this._timers[i].t <= 0) { this._timers[i].fn(); this._timers.splice(i, 1); }
      }
    }
  }

  _legWaterInteraction(dt, elapsed) {
    // every leg that touches the surface keeps disturbing it
    this._legRipTimer = (this._legRipTimer || 0) - dt;
    if (this._legRipTimer > 0) return;
    this._legRipTimer = 0.16;
    for (const leg of this.model.legs) {
      leg.foot.getWorldPosition(this._legWorld);
      if (this._legWorld.y < 1.2 && this._legWorld.y > -3) {
        this.water.splash(this._legWorld.x, this._legWorld.z, 0.10, 1.6);
      }
    }
  }

  // ----------------------------------------------------------------- death --
  _beginDeath() {
    this.state = 'dying';
    this.stateTime = 0;
    this.dead = true;
    this._clearDecals();
    this.hazards.length = 0;
    bus.emit(EVT.BOSS_DEAD);
    bus.emit(EVT.MUSIC, { cue: 'victory' });
    bus.emit(EVT.SFX, { id: 'bossDeath', gain: 1.0 });
  }

  _updateDying(dt, ctx) {
    const t = this.stateTime;
    // 1. wings lock, body convulses      0.0 - 2.0
    // 2. legs buckle, it descends        2.0 - 5.5
    // 3. eyes go out one by one          3.0 - 6.5
    // 4. it settles into the water       5.5 - 8.5
    this._flapAmp = Math.max(0.05, 1 - t * 0.45);
    this._eyeTarget = Math.max(0, 1 - t * 0.16);

    if (t < 2.0) {
      this._roll = Math.sin(t * 9) * 0.10 * (1 - t / 2);
      this._pitch = Math.sin(t * 7) * 0.08;
      if (Math.random() < dt * 12) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 14;
        this.fx?.sporeBurst(this.root.position.clone().add(new THREE.Vector3(Math.sin(a) * r, 8 + Math.random() * 12, Math.cos(a) * r)), 0.8);
      }
      if (!this._deathShake1) { this._deathShake1 = true; bus.emit(EVT.CAMERA_SHAKE, { amount: 1.2, duration: 2.0 }); }
    } else if (t < 6.0) {
      const k = (t - 2.0) / 4.0;
      this._targetHeightOffset = -24 * ease(k);
      this._pitch = 0.55 * ease(k);
      this._roll = 0.22 * ease(k) * Math.sin(k * 3);
      for (const leg of this.model.legs) {
        leg.anim = leg.anim || {};
        leg.anim.active = true;
        leg.anim.hipX = 0.9 * ease(k) * (0.6 + 0.4 * Math.sin(leg.phase));
        leg.anim.kneeX = -1.4 * ease(k);
        leg.anim.hipZ = 0.4 * ease(k) * Math.sin(leg.phase * 2);
      }
      if (Math.random() < dt * 26) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 22;
        this.water.splash(this.root.position.x + Math.sin(a) * r, this.root.position.z + Math.cos(a) * r, 1.0, 2.4);
      }
      if (!this._deathCrash && t > 4.6) {
        this._deathCrash = true;
        this.fx?.bigSplash(this.root.position.clone(), 5.0);
        bus.emit(EVT.CAMERA_SHAKE, { amount: 1.8, duration: 1.8 });
        bus.emit(EVT.SFX, { id: 'bossCrash', gain: 1.0 });
        for (let i = 0; i < 80; i++) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * 34;
          this.water.splash(this.root.position.x + Math.sin(a) * r, this.root.position.z + Math.cos(a) * r, 1.2, 3.0);
        }
      }
    } else {
      const k = Math.min(1, (t - 6.0) / 4.0);
      this._targetHeightOffset = -24 - k * 6;
      this.model.wingUniforms.uOpacity.value = 0.92 * (1 - k * 0.75);
      // released spirit: motes drift up toward the moon
      if (Math.random() < dt * 30) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 20;
        this.fx?.spirit(this.root.position.clone().add(new THREE.Vector3(Math.sin(a) * r, 2, Math.cos(a) * r)));
      }
    }
  }
}

function setTimeoutSafe(boss, delay, fn) {
  (boss._timers ||= []).push({ t: delay, fn });
}
function ease(k) { return 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3); }
function dampAngle(cur, target, lambda, dt) {
  let d = ((target - cur + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return cur + d * (1 - Math.exp(-lambda * dt));
}

export default Boss;
