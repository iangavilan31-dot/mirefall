import * as THREE from 'three';
import { PALETTE, SCALE } from '../core/Palette.js';
import { bus, EVT } from '../core/EventBus.js';
import TL from '../world/TextureLab.js';

/**
 * Mire-spawn: a drowned husk the deity pulls up out of the water.
 * Deliberately simple silhouette — a hunched, hatless echo of the player, so the
 * player reads as "the last one who still stands upright".
 */

let sharedMats = null;
function mats() {
  if (sharedMats) return sharedMats;
  const skin = TL.skin(512), moss = TL.moss(512);
  sharedMats = {
    body: new THREE.MeshStandardMaterial({ ...skin, color: PALETTE.skinDark.clone(), roughness: 0.8 }),
    moss: new THREE.MeshStandardMaterial({ ...moss, color: PALETTE.mossDark.clone(), roughness: 1.0 }),
    eye: new THREE.MeshBasicMaterial({ color: PALETTE.bossEyeDim.clone(), toneMapped: false }),
  };
  return sharedMats;
}

export class Enemy {
  constructor(scene, water, player, pos) {
    this.scene = scene;
    this.water = water;
    this.player = player;
    const M = mats();

    this.root = new THREE.Group();
    this.root.position.copy(pos);
    this.root.position.y = -0.9;
    scene.add(this.root);

    this.body = new THREE.Group();
    this.root.add(this.body);

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.30, 0.42, 4, 10), M.body);
    torso.position.y = 0.62;
    torso.castShadow = true;
    this.body.add(torso);

    const hump = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), M.moss);
    hump.scale.set(1.1, 0.7, 0.9);
    hump.position.set(0, 0.86, -0.16);
    hump.castShadow = true;
    this.body.add(hump);

    this.head = new THREE.Group();
    this.head.position.y = 1.02;
    this.body.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), M.body);
    skull.scale.set(1.2, 0.85, 1.05);
    skull.castShadow = true;
    this.head.add(skull);
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), M.eye);
      e.position.set(sx * 0.09, 0.05, 0.15);
      this.head.add(e);
    }

    this.arms = [];
    for (const sx of [-1, 1]) {
      const a = new THREE.Group();
      a.position.set(sx * 0.28, 0.86, 0);
      const g = new THREE.CapsuleGeometry(0.058, 0.46, 3, 8);
      g.translate(0, -0.27, 0);
      a.add(new THREE.Mesh(g, M.body));
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 5), M.body);
      claw.position.y = -0.56; claw.rotation.x = Math.PI;
      a.add(claw);
      this.body.add(a);
      this.arms.push(a);
    }
    this.legs = [];
    for (const sx of [-1, 1]) {
      const l = new THREE.Group();
      l.position.set(sx * 0.14, 0.34, 0);
      const g = new THREE.CapsuleGeometry(0.07, 0.34, 3, 8);
      g.translate(0, -0.20, 0);
      l.add(new THREE.Mesh(g, M.body));
      this.body.add(l);
      this.legs.push(l);
    }

    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    this.health = 46;
    this.maxHealth = 46;
    this.dead = false;
    this.state = 'emerge';
    this.stateTime = 0;
    this.vel = new THREE.Vector3();
    this.facing = 0;
    this.hitRadius = 0.55;
    this.attackCooldown = 1.2;
    this.hitPlayer = false;
    this._tmp = new THREE.Vector3();
    this._phase = Math.random() * 6.28;
    this._removeAt = 0;

    this.water.splash(pos.x, pos.z, 0.6, 1.2);
  }

  lockPoint() { return this._tmp.set(this.root.position.x, this.root.position.y + 1.0, this.root.position.z).clone(); }
  lockRadius() { return 1.2; }
  hitParts() { return [{ pos: this.lockPoint(), radius: this.hitRadius, name: 'body' }]; }

  takeDamage(amount, hitPos, opts = {}) {
    if (this.dead) return;
    this.health -= amount;
    this.state = 'hurt';
    this.stateTime = 0;
    const away = this._tmp.subVectors(this.root.position, this.player.pos).setY(0).normalize();
    this.vel.addScaledVector(away, opts.heavy ? 6.5 : 3.2);
    bus.emit(EVT.SFX, { id: 'enemyHit', pos: hitPos, gain: 0.6 });
    if (this.health <= 0) this._die();
  }

  _die() {
    this.dead = true;
    this.state = 'dying';
    this.stateTime = 0;
    this._removeAt = 1.6;
    bus.emit(EVT.ENEMY_DEAD, { pos: this.root.position.clone() });
    bus.emit(EVT.SFX, { id: 'enemyDie', pos: this.root.position.clone(), gain: 0.7 });
    bus.emit('fx:splash', { pos: this.root.position.clone(), power: 0.8 });
  }

  update(dt, elapsed) {
    this.stateTime += dt;
    const p = this.player;

    if (this.state === 'dying') {
      this._removeAt -= dt;
      const k = Math.min(1, this.stateTime / 1.2);
      this.body.rotation.x = k * 1.5;
      this.root.position.y = -0.9 - k * 0.9;
      this.body.scale.setScalar(Math.max(0.01, 1 - k * 0.35));
      if (this._removeAt <= 0) this.destroy();
      return;
    }

    if (this.state === 'emerge') {
      const k = Math.min(1, this.stateTime / 1.1);
      this.root.position.y = -2.2 + k * 1.3;
      this.body.rotation.x = (1 - k) * 1.2;
      if (Math.random() < dt * 14) this.water.splash(this.root.position.x, this.root.position.z, 0.3, 0.8);
      if (k >= 1) { this.state = 'chase'; this.root.position.y = -0.9; }
      return;
    }

    const toP = this._tmp.subVectors(p.pos, this.root.position).setY(0);
    const dist = toP.length();
    if (dist > 0.001) toP.normalize();
    const targetFacing = Math.atan2(toP.x, toP.z);

    this.attackCooldown -= dt;

    switch (this.state) {
      case 'chase': {
        if (!p.dead && dist < 1.9 && this.attackCooldown <= 0) {
          this.state = 'windup'; this.stateTime = 0; this.hitPlayer = false;
          bus.emit(EVT.SFX, { id: 'tellSummon', pos: this.root.position.clone(), gain: 0.4 });
        } else if (!p.dead) {
          const speed = dist > 2.6 ? 2.9 : 1.5;
          this.vel.x += (toP.x * speed - this.vel.x) * Math.min(1, dt * 6);
          this.vel.z += (toP.z * speed - this.vel.z) * Math.min(1, dt * 6);
        } else {
          this.vel.multiplyScalar(Math.max(0, 1 - dt * 3));
        }
        break;
      }
      case 'windup': {
        this.vel.multiplyScalar(Math.max(0, 1 - dt * 8));
        if (this.stateTime > 0.52) { this.state = 'strike'; this.stateTime = 0; }
        break;
      }
      case 'strike': {
        if (this.stateTime < 0.16) {
          this.vel.x = toP.x * 7.5; this.vel.z = toP.z * 7.5;
          if (!this.hitPlayer && dist < 1.7) {
            this.hitPlayer = true;
            p.takeDamage(11, toP.clone().negate().negate(), 'enemy');
          }
        } else this.vel.multiplyScalar(Math.max(0, 1 - dt * 7));
        if (this.stateTime > 0.7) { this.state = 'chase'; this.attackCooldown = 1.4 + Math.random() * 1.2; }
        break;
      }
      case 'hurt': {
        this.vel.multiplyScalar(Math.max(0, 1 - dt * 4));
        if (this.stateTime > 0.30) this.state = 'chase';
        break;
      }
    }

    this.facing += shortest(targetFacing - this.facing) * Math.min(1, dt * 7);
    this.root.rotation.y = this.facing;
    this.root.position.x += this.vel.x * dt;
    this.root.position.z += this.vel.z * dt;
    const r = Math.hypot(this.root.position.x, this.root.position.z);
    if (r > SCALE.arenaRadius) this.root.position.multiplyScalar(SCALE.arenaRadius / r);

    // wading animation + water disturbance
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this._phase += dt * (2 + sp * 1.3);
    this.legs[0].rotation.x = Math.sin(this._phase) * 0.55 * Math.min(1, sp / 2);
    this.legs[1].rotation.x = Math.sin(this._phase + Math.PI) * 0.55 * Math.min(1, sp / 2);
    const wind = this.state === 'windup' ? Math.min(1, this.stateTime / 0.52) : 0;
    const strike = this.state === 'strike' ? Math.max(0, 1 - this.stateTime / 0.3) : 0;
    this.arms[0].rotation.x = -0.3 - wind * 2.1 + strike * 2.6;
    this.arms[1].rotation.x = -0.3 - wind * 1.9 + strike * 2.4;
    this.body.rotation.x = 0.20 + wind * -0.25 + strike * 0.5 + (this.state === 'hurt' ? -0.4 * (1 - this.stateTime / 0.3) : 0);
    this.head.rotation.x = -this.body.rotation.x * 0.6;
    this.root.position.y = -0.9 + Math.sin(this._phase * 2) * 0.02 * Math.min(1, sp);

    this._ripple = (this._ripple || 0) - dt;
    if (this._ripple <= 0) { this._ripple = 0.2; this.water.splash(this.root.position.x, this.root.position.z, 0.06 + sp * 0.02, 0.35); }
  }

  destroy() {
    this.scene.remove(this.root);
    this.root.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    this._destroyed = true;
  }
}

function shortest(a) { let d = ((a + Math.PI) % (Math.PI * 2)) - Math.PI; if (d < -Math.PI) d += Math.PI * 2; return d; }

export default Enemy;
