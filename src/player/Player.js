import * as THREE from 'three';
import { PlayerModel } from './PlayerModel.js';
import { input } from '../core/Input.js';
import { bus, EVT } from '../core/EventBus.js';
import { settings } from '../core/Settings.js';
import { SCALE } from '../core/Palette.js';

const DIFF = {
  wanderer: { dmgTaken: 1.0, healCharges: 5, stamina: 100 },
  pilgrim:  { dmgTaken: 0.62, healCharges: 7, stamina: 120 },
  drowned:  { dmgTaken: 1.55, healCharges: 3, stamina: 90 },
};

/** Attack definitions — windup / active / recovery in seconds. Commitment is real. */
const ATTACKS = {
  light1: { wind: 0.11, active: 0.10, rec: 0.20, dmg: 10, stam: 12, arc: 2.3, reach: 2.15, lunge: 2.6, next: 'light2', cancelAt: 0.16, heavy: false },
  light2: { wind: 0.09, active: 0.10, rec: 0.22, dmg: 11, stam: 12, arc: 2.5, reach: 2.15, lunge: 2.3, next: 'light3', cancelAt: 0.15, heavy: false },
  light3: { wind: 0.15, active: 0.13, rec: 0.34, dmg: 17, stam: 18, arc: 3.1, reach: 2.35, lunge: 3.4, next: null,     cancelAt: 0.22, heavy: false },
  heavy1: { wind: 0.33, active: 0.14, rec: 0.46, dmg: 30, stam: 28, arc: 3.4, reach: 2.6,  lunge: 3.0, next: 'heavy2', cancelAt: 0.26, heavy: true },
  heavy2: { wind: 0.40, active: 0.17, rec: 0.58, dmg: 42, stam: 34, arc: 4.0, reach: 2.7,  lunge: 2.2, next: null,     cancelAt: 0.30, heavy: true },
};

export class Player {
  constructor(scene, water, opts = {}) {
    this.model = new PlayerModel();
    this.root = this.model.root;
    scene.add(this.root);
    this.water = water;

    this.pos = this.root.position;
    this.pos.set(opts.x || 0, 0, opts.z || 26);
    this.vel = new THREE.Vector3();
    this.facing = Math.PI;
    this.targetFacing = Math.PI;

    const d = DIFF[settings.get('difficulty')] || DIFF.wanderer;
    this.maxHealth = 100;
    this.health = 100;
    this.maxStamina = d.stamina;
    this.stamina = d.stamina;
    this.staminaRegenDelay = 0;
    this.healCharges = d.healCharges;
    this.maxHealCharges = d.healCharges;
    this.dmgScale = d.dmgTaken;

    this.state = 'idle';
    this.stateTime = 0;
    this.attack = null;
    this.attackPhase = 'none';
    this.comboBuffer = null;
    this.bufferTime = 0;
    this.invuln = 0;
    this.hitStop = 0;
    this.dead = false;
    this.hitTargets = new Set();

    this.speed01 = 0;
    this.turnRate = 0;
    this.root.userData.speed01 = 0;

    this._walkSpeed = 2.35;
    this._runSpeed = 4.25;
    this._accel = 16.0;
    this._decel = 13.0;
    this._waterDrag = 3.4;

    this._stepPhase = 0;
    this._lastStepSide = 1;
    this._bobPhase = 0;
    this._camYawRef = () => 0;

    this._swordTipPrev = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();

    this.obstacles = [];      // {x,z,r} cylinders
    this.arenaRadius = SCALE.arenaRadius;

    this.enemies = [];        // things this player can hit
  }

  setCameraYawRef(fn) { this._camYawRef = fn; }
  lockPoint() { return this._tmp2.set(this.pos.x, this.pos.y + 0.9, this.pos.z); }

  // ------------------------------------------------------------------ dmg --
  takeDamage(amount, fromDir, source = 'boss') {
    if (this.dead || this.invuln > 0) return false;
    const dmg = Math.max(1, Math.round(amount * this.dmgScale));
    this.health = Math.max(0, this.health - dmg);
    this.invuln = 0.55;
    this.hitStop = 0.09;
    this.state = 'hurt';
    this.stateTime = 0;
    this.attack = null;
    this._hurtDir = fromDir ? fromDir.clone().normalize() : new THREE.Vector3(0, 0, 1);
    this.vel.addScaledVector(this._hurtDir, 3.4);
    bus.emit(EVT.PLAYER_HIT, { damage: dmg, dir: this._hurtDir, source });
    bus.emit(EVT.CAMERA_SHAKE, { amount: 0.55, duration: 0.35 });
    bus.emit(EVT.SFX, { id: 'playerHurt', pos: this.pos.clone(), gain: 0.9 });
    bus.emit(EVT.WATER_IMPACT, { pos: this.pos.clone(), strength: 0.5, radius: 1.1 });
    input.rumble(0.7, 0.45, 200);
    if (this.health <= 0) this._die();
    return true;
  }

  _die() {
    this.dead = true;
    this.state = 'dead';
    this.stateTime = 0;
    bus.emit(EVT.PLAYER_DEAD);
    bus.emit(EVT.SFX, { id: 'playerDie', gain: 1.0 });
  }

  heal() {
    if (this.dead || this.healCharges <= 0) return false;
    if (this.state === 'heal' || this.state === 'dodge') return false;
    this.healCharges--;
    this.state = 'heal';
    this.stateTime = 0;
    this._healApplied = false;
    bus.emit(EVT.SFX, { id: 'healStart', pos: this.pos.clone(), gain: 0.8 });
    return true;
  }

  respawn(x, z) {
    this.health = this.maxHealth;
    this.stamina = this.maxStamina;
    this.healCharges = this.maxHealCharges;
    this.dead = false;
    this.state = 'idle';
    this.stateTime = 0;
    this.attack = null;
    this.invuln = 1.2;
    this.vel.set(0, 0, 0);
    this.pos.set(x, 0, z);
    this.root.rotation.y = this.facing = this.targetFacing = Math.PI;
  }

  // --------------------------------------------------------------- update --
  update(dt, elapsed) {
    if (this.hitStop > 0) { this.hitStop -= dt; if (this.hitStop > 0) { this.model.update(dt * 0.15, this); return; } }

    this.stateTime += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.bufferTime = Math.max(0, this.bufferTime - dt);
    if (this.bufferTime === 0) this.comboBuffer = null;

    if (this.dead) { this._updateDead(dt); this.model.update(dt, this); return; }

    // stamina
    this.staminaRegenDelay = Math.max(0, this.staminaRegenDelay - dt);
    if (this.staminaRegenDelay === 0 && this.state !== 'dodge') {
      this.stamina = Math.min(this.maxStamina, this.stamina + dt * 34);
    }

    this._readIntent();
    this._updateState(dt);
    this._integrate(dt);
    this._animate(dt, elapsed);
    this._waterInteraction(dt, elapsed);

    this.root.userData.speed01 = this.speed01;
    this.model.update(dt, this);
  }

  _readIntent() {
    const canAct = this.state !== 'dodge' && this.state !== 'hurt' && this.state !== 'heal';
    const inRecovery = this.state === 'attack' && this.attackPhase === 'recovery';

    if (input.pressed('dodge')) this._buffer('dodge');
    if (input.pressed('light')) this._buffer('light');
    if (input.pressed('heavy')) this._buffer('heavy');
    if (input.pressed('heal')) this._buffer('heal');

    if (!this.comboBuffer) return;

    if (this.comboBuffer === 'dodge' && (canAct || inRecovery) && this.stamina >= 20) {
      this._startDodge();
    } else if (this.comboBuffer === 'heal' && canAct && this.state !== 'attack') {
      if (this.heal()) this.comboBuffer = null;
    } else if (this.comboBuffer === 'light' || this.comboBuffer === 'heavy') {
      const heavy = this.comboBuffer === 'heavy';
      if (this.state === 'idle' || this.state === 'move') {
        this._startAttack(heavy ? 'heavy1' : 'light1');
      } else if (this.state === 'attack' && this.attack) {
        const def = ATTACKS[this.attack];
        const elapsedIn = this.stateTime;
        const canCancel = elapsedIn >= def.wind + def.active - 0.02 || elapsedIn >= def.cancelAt;
        if (canCancel && this.attackPhase !== 'windup') {
          const nextName = heavy ? (def.heavy ? def.next : 'heavy1') : (def.heavy ? 'light1' : def.next);
          if (nextName) this._startAttack(nextName);
        }
      }
    }
  }

  _buffer(a) { this.comboBuffer = a; this.bufferTime = 0.24; }

  _startAttack(name) {
    const def = ATTACKS[name];
    if (!def || this.stamina < def.stam * 0.5) return;
    this.attack = name;
    this.state = 'attack';
    this.stateTime = 0;
    this.attackPhase = 'windup';
    this.hitTargets.clear();
    this.stamina = Math.max(0, this.stamina - def.stam);
    this.staminaRegenDelay = 0.7;
    this.comboBuffer = null;
    // snap facing to input or lock target at the moment of commitment
    this._applyAttackFacing();
    this._lungeSpeed = def.lunge;
    bus.emit(EVT.PLAYER_ATTACK, { type: def.heavy ? 'heavy' : 'light', name });
    bus.emit(EVT.SFX, { id: def.heavy ? 'swingHeavy' : 'swingLight', pos: this.pos.clone(), gain: 0.75 });
  }

  _applyAttackFacing() {
    if (this.lockTarget && !this.lockTarget.dead) {
      const p = this.lockTarget.lockPoint();
      this.targetFacing = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
    } else if (input.moveMag > 0.15) {
      this.targetFacing = this._inputWorldAngle();
    }
    this.facing = this.targetFacing;
    this.root.rotation.y = this.facing;
  }

  _inputWorldAngle() {
    const yaw = this._camYawRef();
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const dx = input.move.x * rx + input.move.y * fx;
    const dz = input.move.x * rz + input.move.y * fz;
    return Math.atan2(dx, dz);
  }

  _startDodge() {
    this.state = 'dodge';
    this.stateTime = 0;
    this.attack = null;
    this.comboBuffer = null;
    this.stamina = Math.max(0, this.stamina - 20);
    this.staminaRegenDelay = 0.55;
    let ang;
    if (input.moveMag > 0.15) ang = this._inputWorldAngle();
    else ang = this.facing + Math.PI;   // backstep when no direction given
    this._dodgeDir = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));
    this.targetFacing = this.facing = ang;
    this.root.rotation.y = ang;
    this.invuln = 0.30;               // i-frames start after a 2-frame startup below
    this._dodgeIFrameStart = 0.055;
    bus.emit(EVT.PLAYER_DODGE, { dir: this._dodgeDir.clone() });
    bus.emit(EVT.SFX, { id: 'dodge', pos: this.pos.clone(), gain: 0.8 });
    bus.emit(EVT.WATER_IMPACT, { pos: this.pos.clone(), strength: 0.75, radius: 1.5 });
    bus.emit('fx:splash', { pos: this.pos.clone(), power: 1.2, dir: this._dodgeDir.clone() });
    input.rumble(0.25, 0.15, 90);
  }

  _updateState(dt) {
    switch (this.state) {
      case 'attack': this._updateAttack(dt); break;
      case 'dodge': this._updateDodge(dt); break;
      case 'hurt':
        if (this.stateTime > 0.34) this.state = 'idle';
        break;
      case 'heal': {
        if (!this._healApplied && this.stateTime > 0.42) {
          this._healApplied = true;
          this.health = Math.min(this.maxHealth, this.health + 48);
          bus.emit(EVT.PLAYER_HEAL, { amount: 48 });
          bus.emit(EVT.SFX, { id: 'heal', pos: this.pos.clone(), gain: 0.9 });
        }
        if (this.stateTime > 1.0) this.state = 'idle';
        break;
      }
      default: {
        const moving = input.moveMag > 0.06;
        this.state = moving ? 'move' : 'idle';
      }
    }
  }

  _updateAttack(dt) {
    const def = ATTACKS[this.attack];
    const t = this.stateTime;
    const prev = this.attackPhase;
    if (t < def.wind) this.attackPhase = 'windup';
    else if (t < def.wind + def.active) this.attackPhase = 'active';
    else if (t < def.wind + def.active + def.rec) this.attackPhase = 'recovery';
    else { this.state = 'idle'; this.attack = null; this.attackPhase = 'none'; return; }

    if (prev !== 'active' && this.attackPhase === 'active') {
      bus.emit('fx:swordTrail', { on: true, heavy: def.heavy });
      bus.emit(EVT.WATER_IMPACT, { pos: this.pos.clone(), strength: 0.4, radius: 1.2 });
    }
    if (prev === 'active' && this.attackPhase !== 'active') bus.emit('fx:swordTrail', { on: false });

    if (this.attackPhase === 'active') this._resolveHits(def);
  }

  _resolveHits(def) {
    const origin = this._tmp.set(this.pos.x, this.pos.y + 0.75, this.pos.z);
    const fwd = this._tmp2.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    for (const e of this.enemies) {
      if (!e || e.dead || this.hitTargets.has(e)) continue;
      const parts = e.hitParts ? e.hitParts() : [{ pos: e.lockPoint(), radius: e.hitRadius || 1.0 }];
      for (const part of parts) {
        const d = part.pos.distanceTo(origin) - (part.radius || 1.0);
        if (d > def.reach) continue;
        const to = part.pos.clone().sub(origin); to.y = 0; to.normalize();
        const ang = Math.acos(THREE.MathUtils.clamp(to.dot(fwd), -1, 1));
        if (ang > def.arc * 0.5) continue;

        this.hitTargets.add(e);
        const hitPos = origin.clone().addScaledVector(to, Math.min(def.reach, part.pos.distanceTo(origin)));
        hitPos.y = part.pos.y - (part.radius || 1) * 0.3;
        e.takeDamage(def.dmg, hitPos, { heavy: def.heavy, part: part.name });
        this.hitStop = def.heavy ? 0.11 : 0.065;
        bus.emit(EVT.HIT_LANDED, { pos: hitPos, normal: to.clone().negate(), damage: def.dmg, target: e, heavy: def.heavy });
        bus.emit(EVT.CAMERA_SHAKE, { amount: def.heavy ? 0.55 : 0.26, duration: def.heavy ? 0.3 : 0.18 });
        input.rumble(def.heavy ? 0.8 : 0.4, 0.3, def.heavy ? 170 : 90);
        this.stamina = Math.min(this.maxStamina, this.stamina + 4);
        break;
      }
    }
  }

  _updateDodge(dt) {
    const T = 0.44;
    const t = this.stateTime;
    if (t > this._dodgeIFrameStart && t < 0.30) this.invuln = Math.max(this.invuln, 0.02);
    if (t >= T) { this.state = 'idle'; return; }
    // ease-out burst
    const k = 1 - Math.pow(t / T, 1.6);
    const speed = 9.2 * k;
    this.vel.x = this._dodgeDir.x * speed;
    this.vel.z = this._dodgeDir.z * speed;
  }

  _updateDead(dt) {
    this.vel.multiplyScalar(Math.max(0, 1 - dt * 5));
    this.pos.addScaledVector(this.vel, dt);
  }

  _integrate(dt) {
    const locomotionAllowed = this.state === 'idle' || this.state === 'move';
    const attackDrift = this.state === 'attack' && this.attackPhase === 'windup';

    if (locomotionAllowed) {
      const sprint = settings.get('holdToSprint') ? input.down('sprint') : input.down('sprint');
      const maxSpeed = (sprint && this.stamina > 6 ? this._runSpeed : this._walkSpeed) * Math.min(1, input.moveMag / 0.9);
      if (sprint && input.moveMag > 0.2) { this.stamina = Math.max(0, this.stamina - dt * 9); this.staminaRegenDelay = 0.4; }

      if (input.moveMag > 0.06) {
        const ang = this._inputWorldAngle();
        this.targetFacing = ang;
        const want = this._tmp.set(Math.sin(ang) * maxSpeed, 0, Math.cos(ang) * maxSpeed);
        // acceleration is slower than deceleration -> weight
        this.vel.x += (want.x - this.vel.x) * Math.min(1, this._accel * dt);
        this.vel.z += (want.z - this.vel.z) * Math.min(1, this._accel * dt);
      } else {
        this.vel.x -= this.vel.x * Math.min(1, this._decel * dt);
        this.vel.z -= this.vel.z * Math.min(1, this._decel * dt);
      }
    } else if (attackDrift) {
      const f = this._tmp.set(Math.sin(this.facing), 0, Math.cos(this.facing));
      this.vel.x += (f.x * this._lungeSpeed - this.vel.x) * Math.min(1, 12 * dt);
      this.vel.z += (f.z * this._lungeSpeed - this.vel.z) * Math.min(1, 12 * dt);
    } else if (this.state === 'attack' || this.state === 'hurt' || this.state === 'heal') {
      const drag = this.state === 'attack' ? 9 : 5;
      this.vel.x -= this.vel.x * Math.min(1, drag * dt);
      this.vel.z -= this.vel.z * Math.min(1, drag * dt);
    }

    // water resistance — everything is wading, so add quadratic drag
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 0.001) {
      const drag = this._waterDrag * dt * (0.35 + sp * 0.12);
      const k = Math.max(0, 1 - drag / Math.max(sp, 0.001));
      this.vel.x *= k; this.vel.z *= k;
    }

    // turning weight
    const prevFacing = this.facing;
    const turnLambda = this.state === 'attack' ? 3.0 : (sp > 3 ? 9 : 13);
    this.facing = dampAngle(this.facing, this.targetFacing, turnLambda, dt);
    this.turnRate = shortestAngle(this.facing - prevFacing) / Math.max(dt, 1e-4);
    this.root.rotation.y = this.facing;

    // integrate + collide
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    this._collide(nx, nz);

    this.speed01 = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / this._runSpeed);
  }

  _collide(nx, nz) {
    let x = nx, z = nz;
    const r = SCALE.playerRadius;
    for (const o of this.obstacles) {
      const dx = x - o.x, dz = z - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.r + r;
      if (d < min && d > 1e-4) {
        const push = (min - d) / d;
        x += dx * push; z += dz * push;
        // kill the velocity component into the obstacle
        const nxn = dx / d, nzn = dz / d;
        const vn = this.vel.x * nxn + this.vel.z * nzn;
        if (vn < 0) { this.vel.x -= vn * nxn; this.vel.z -= vn * nzn; }
      }
    }
    const dr = Math.hypot(x, z);
    if (dr > this.arenaRadius) {
      const k = this.arenaRadius / dr;
      x *= k; z *= k;
      this.vel.x *= 0.5; this.vel.z *= 0.5;
    }
    this.pos.x = x; this.pos.z = z;
    this.pos.y = this.water ? this.water.heightAt(x, z) - SCALE.wadeDepth : -SCALE.wadeDepth;
  }

  _waterInteraction(dt, elapsed) {
    if (!this.water) return;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    // constant presence ripple — the player always disturbs the water
    if (!this._ripTimer || this._ripTimer <= 0) {
      this.water.splash(this.pos.x, this.pos.z, 0.045 + sp * 0.02, 0.42);
      this._ripTimer = 0.14;
    }
    this._ripTimer -= dt;

    // wake behind movement
    if (sp > 0.4) {
      const back = this._tmp.set(-this.vel.x, 0, -this.vel.z).normalize().multiplyScalar(0.35);
      this.water.splash(this.pos.x + back.x, this.pos.z + back.z, 0.05 + sp * 0.028, 0.3);
    }

    // footsteps
    if ((this.state === 'move' || this.state === 'idle') && sp > 0.3) {
      const cadence = 1.55 + this.speed01 * 1.35;
      this._stepPhase += dt * cadence * Math.PI * 2;
      if (this._stepPhase > Math.PI) {
        this._stepPhase -= Math.PI;
        this._lastStepSide *= -1;
        const side = this._tmp.set(Math.cos(this.facing), 0, -Math.sin(this.facing)).multiplyScalar(this._lastStepSide * 0.16);
        const fx = this.pos.x + side.x, fz = this.pos.z + side.z;
        this.water.splash(fx, fz, 0.16 + sp * 0.05, 0.36);
        bus.emit(EVT.PLAYER_STEP, { pos: new THREE.Vector3(fx, 0, fz), speed: sp });
        bus.emit('fx:splash', { pos: new THREE.Vector3(fx, 0, fz), power: 0.25 + this.speed01 * 0.5 });
        bus.emit(EVT.SFX, { id: 'step', pos: new THREE.Vector3(fx, 0, fz), gain: 0.28 + this.speed01 * 0.32, rate: 0.9 + Math.random() * 0.25 });
      }
    } else {
      this._stepPhase = 0;
    }
  }

  // ------------------------------------------------------------ animation --
  _animate(dt, elapsed) {
    const m = this.model;
    const S = m.height;
    const sp = this.speed01;
    const t = elapsed;

    // ---- base idle pose ----
    const breathe = Math.sin(t * 1.5) * 0.5 + 0.5;
    let torsoPitch = 0.12 + breathe * 0.02;
    let torsoRoll = 0;
    let torsoYaw = 0;
    let pelvisY = 0;
    let neckPitch = -0.04;
    let hatTilt = 0;

    let armRShoulder = new THREE.Euler(-0.30, 0.10, 0.32);
    let armRElbow = new THREE.Euler(-0.55, 0, 0);
    let armLShoulder = new THREE.Euler(-0.18, -0.10, -0.36);
    let armLElbow = new THREE.Euler(-0.42, 0, 0);
    let legRHip = new THREE.Euler(0.04, 0, 0.06);
    let legRKnee = new THREE.Euler(0.10, 0, 0);
    let legLHip = new THREE.Euler(-0.04, 0, -0.06);
    let legLKnee = new THREE.Euler(0.10, 0, 0);

    // ---- locomotion layer ----
    if (sp > 0.02) {
      const cadence = 1.55 + sp * 1.35;
      this._bobPhase += dt * cadence * Math.PI * 2;
      const p = this._bobPhase;
      const amp = 0.45 + sp * 0.75;
      // wading gait: high knee lift, slow, heavy
      legRHip.x = Math.sin(p) * 0.52 * amp + 0.10;
      legLHip.x = Math.sin(p + Math.PI) * 0.52 * amp + 0.10;
      legRKnee.x = Math.max(0, -Math.sin(p - 0.6)) * 0.95 * amp + 0.12;
      legLKnee.x = Math.max(0, -Math.sin(p + Math.PI - 0.6)) * 0.95 * amp + 0.12;
      pelvisY = (Math.abs(Math.sin(p)) * 0.035 - 0.018) * amp * S;
      torsoRoll = Math.sin(p) * 0.055 * amp;
      torsoYaw = -Math.sin(p) * 0.10 * amp;
      torsoPitch = 0.12 + sp * 0.18;
      armLShoulder.x = -0.18 + Math.sin(p) * 0.52 * amp;
      armRShoulder.x = -0.30 - Math.sin(p) * 0.18 * amp;   // sword arm swings less
      hatTilt = -sp * 0.05 + Math.sin(p) * 0.02;
      neckPitch = -0.04 - sp * 0.06;
    } else {
      this._bobPhase *= 0.9;
      pelvisY = Math.sin(t * 1.5) * 0.006 * S;
    }

    // turning lean
    torsoRoll += THREE.MathUtils.clamp(-this.turnRate * 0.05, -0.22, 0.22);

    // ---- state layers ----
    const blend = (a, b, k) => a + (b - a) * k;

    if (this.state === 'attack' && this.attack) {
      const def = ATTACKS[this.attack];
      const t0 = this.stateTime;
      const total = def.wind + def.active + def.rec;
      let k, phase;
      if (t0 < def.wind) { phase = 'w'; k = t0 / def.wind; }
      else if (t0 < def.wind + def.active) { phase = 'a'; k = (t0 - def.wind) / def.active; }
      else { phase = 'r'; k = (t0 - def.wind - def.active) / def.rec; }

      const isHeavy = def.heavy;
      const combo = this.attack;
      // windup: coil back and up; active: whip through; recovery: settle heavily
      let swing;   // -1 = wound back, +1 = followed through
      if (phase === 'w') swing = -easeOut(k);
      else if (phase === 'a') swing = -1 + easeIn(k) * 2.2;
      else swing = 1.2 - easeOut(k) * 1.2;

      const horizontal = combo === 'light2' || combo === 'heavy2';
      const overhead = combo === 'light3' || combo === 'heavy1';

      torsoYaw = -swing * (horizontal ? 0.95 : 0.55);
      torsoPitch = 0.12 + (overhead ? -swing * 0.30 : swing * 0.16) + (isHeavy ? 0.06 : 0);
      torsoRoll = swing * (overhead ? 0.20 : 0.10);

      armRShoulder.set(
        overhead ? (-1.9 - swing * 1.5) : (-0.5 - swing * 0.6),
        -swing * 0.9,
        0.30 + (horizontal ? swing * 0.85 : swing * 0.25)
      );
      armRElbow.set(overhead ? (-1.0 + swing * 0.85) : (-1.15 + swing * 1.0), 0, 0);
      armLShoulder.set(-0.25 + swing * 0.42, 0.15, -0.44 - swing * 0.20);
      armLElbow.set(-0.7, 0, 0);

      // planted stance
      legRHip.x = 0.16 + swing * 0.22; legRKnee.x = 0.30;
      legLHip.x = -0.14 - swing * 0.18; legLKnee.x = 0.24;
      pelvisY = -0.02 * S - Math.abs(swing) * 0.012 * S;
      hatTilt = -swing * 0.16;
      neckPitch = -0.05 + (overhead ? -swing * 0.2 : swing * 0.10);
    }

    if (this.state === 'dodge') {
      const k = Math.min(1, this.stateTime / 0.44);
      const roll = easeOutBack(k);
      // a low, splashing shoulder-dive rather than a clean roll
      torsoPitch = 0.12 + Math.sin(roll * Math.PI) * 1.05;
      pelvisY = -Math.sin(roll * Math.PI) * 0.20 * S;
      torsoRoll = Math.sin(roll * Math.PI) * 0.28;
      const tuck = Math.sin(roll * Math.PI);
      legRHip.x = 0.2 + tuck * 1.5; legRKnee.x = 0.2 + tuck * 1.7;
      legLHip.x = 0.1 + tuck * 1.3; legLKnee.x = 0.2 + tuck * 1.6;
      armRShoulder.set(-0.4 - tuck * 0.7, 0.2, 0.5 + tuck * 0.3);
      armLShoulder.set(-0.2 - tuck * 1.1, -0.2, -0.5 - tuck * 0.4);
      armLElbow.set(-0.6 - tuck * 0.8, 0, 0);
      hatTilt = tuck * 0.45;
      neckPitch = -0.1 - tuck * 0.35;
    }

    if (this.state === 'hurt') {
      const k = Math.min(1, this.stateTime / 0.34);
      const j = Math.sin((1 - k) * Math.PI * 2.2) * (1 - k);
      torsoPitch = 0.12 - j * 0.42;
      torsoRoll = j * 0.30;
      torsoYaw = j * 0.22;
      armRShoulder.x -= j * 0.6;
      armLShoulder.x -= j * 0.8;
      hatTilt = j * 0.5;
      neckPitch = -0.05 - j * 0.30;
      pelvisY -= j * 0.05 * S;
    }

    if (this.state === 'heal') {
      const k = Math.min(1, this.stateTime / 1.0);
      const lift = Math.sin(Math.min(1, k * 1.8) * Math.PI);
      armLShoulder.set(-1.5 * lift - 0.18, 0.4 * lift, -0.36);
      armLElbow.set(-1.9 * lift - 0.42, 0, 0);
      neckPitch = -0.05 + lift * 0.30;
      torsoPitch = 0.12 - lift * 0.10;
      hatTilt = -lift * 0.22;
    }

    if (this.state === 'dead') {
      const k = Math.min(1, this.stateTime / 1.5);
      const f = easeOut(k);
      torsoPitch = 0.12 + f * 1.35;
      pelvisY = -f * 0.34 * S;
      torsoRoll = f * 0.42;
      legRHip.x = 0.2 + f * 0.9; legLHip.x = 0.1 + f * 0.7;
      legRKnee.x = 0.2 + f * 0.8; legLKnee.x = 0.2 + f * 0.9;
      armRShoulder.set(-0.2 + f * 0.5, 0.1, 0.4 + f * 0.5);
      armLShoulder.set(-0.1 + f * 0.4, -0.1, -0.5 - f * 0.4);
      hatTilt = f * 0.85;
      neckPitch = -0.05 + f * 0.5;
    }

    // ---- apply ----
    const L = 1 - Math.exp(-26 * dt);   // pose smoothing = animation blending
    m.pelvis.position.y = blend(m.pelvis.position.y, S * 0.44 + pelvisY, L);
    m.torso.rotation.x = blend(m.torso.rotation.x, torsoPitch, L);
    m.torso.rotation.y = blend(m.torso.rotation.y, torsoYaw, L);
    m.torso.rotation.z = blend(m.torso.rotation.z, torsoRoll, L);
    m.neck.rotation.x = blend(m.neck.rotation.x, neckPitch - torsoPitch * 0.55, L);
    m.hat.rotation.x = blend(m.hat.rotation.x, hatTilt, L * 0.7);
    m.hat.rotation.z = blend(m.hat.rotation.z, -torsoRoll * 0.4 + Math.sin(t * 0.9) * 0.012, L * 0.7);

    applyEuler(m.armR.shoulder.rotation, armRShoulder, L);
    applyEuler(m.armR.elbow.rotation, armRElbow, L);
    applyEuler(m.armL.shoulder.rotation, armLShoulder, L);
    applyEuler(m.armL.elbow.rotation, armLElbow, L);
    applyEuler(m.legR.hip.rotation, legRHip, L);
    applyEuler(m.legR.knee.rotation, legRKnee, L);
    applyEuler(m.legL.hip.rotation, legLHip, L);
    applyEuler(m.legL.knee.rotation, legLKnee, L);

    // damage flash on the materials
    const flash = this.invuln > 0.35 ? (this.invuln - 0.35) / 0.2 : 0;
    const em = flash * 0.55;
    m.matSkin.emissive.setRGB(em * 0.5, em * 0.1, em * 0.1);
  }

  swordTipWorld(out = new THREE.Vector3()) { return this.model.sword.tip.getWorldPosition(out); }
  swordBaseWorld(out = new THREE.Vector3()) { return this.model.sword.base.getWorldPosition(out); }
}

function applyEuler(dst, src, k) {
  dst.x += (src.x - dst.x) * k;
  dst.y += (src.y - dst.y) * k;
  dst.z += (src.z - dst.z) * k;
}
function shortestAngle(a) { let d = ((a + Math.PI) % (Math.PI * 2)) - Math.PI; if (d < -Math.PI) d += Math.PI * 2; return d; }
function dampAngle(cur, target, lambda, dt) { return cur + shortestAngle(target - cur) * (1 - Math.exp(-lambda * dt)); }
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const easeIn = (k) => k * k;
const easeOutBack = (k) => { const c1 = 1.20, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };

export default Player;
