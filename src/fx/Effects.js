import * as THREE from 'three';
import { PALETTE, SCALE } from '../core/Palette.js';
import { settings } from '../core/Settings.js';
import { bus, EVT } from '../core/EventBus.js';
import TL from '../world/TextureLab.js';

/**
 * Pooled particle + decal effects. One additive points system for sparks/spores/mist,
 * one alpha system for splashes, plus expanding ring meshes for shockwaves.
 *
 * All allocation happens up front. Nothing is created during gameplay.
 */

const MAX = 3000;

export class Effects {
  constructor(scene, water) {
    this.scene = scene;
    this.water = water;

    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.siz = new Float32Array(MAX);
    this.alp = new Float32Array(MAX);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.siz, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alp, 1));
    geo.setDrawRange(0, 0);

    const tex = TL.glowSprite(64, 2.2);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: tex }, uScale: { value: 1 } },
      vertexShader: /* glsl */`
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        varying vec3 vColor; varying float vAlpha;
        uniform float uScale;
        void main(){
          vColor = aColor; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale * (300.0 / max(-mv.z, 0.5));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform sampler2D uTex;
        varying vec3 vColor; varying float vAlpha;
        void main(){
          float a = texture2D(uTex, gl_PointCoord).a;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a * vAlpha);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    // excluded from the water reflection via Water.excludeFromReflection
    scene.add(this.points);

    this.parts = new Array(MAX);
    for (let i = 0; i < MAX; i++) this.parts[i] = { alive: false };
    this.count = 0;
    this._cursor = 0;

    // ---- shockwave rings ----
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.86, 1.0, 64);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: PALETTE.moonLight.clone(), transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
      }));
      m.visible = false; m.renderOrder = 8;
      scene.add(m);
      this.rings.push({ mesh: m, active: false });
    }

    // ---- sword trail ----
    this._trail = { on: false, pts: [], heavy: false };
    const trailGeo = new THREE.BufferGeometry();
    this._trailPos = new Float32Array(64 * 3);
    this._trailAlpha = new Float32Array(64);
    trailGeo.setAttribute('position', new THREE.BufferAttribute(this._trailPos, 3));
    trailGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this._trailAlpha, 1));
    trailGeo.setIndex([]);
    this.trailMesh = new THREE.Mesh(trailGeo, new THREE.ShaderMaterial({
      uniforms: { uColor: { value: PALETTE.hitSpark.clone() } },
      vertexShader: `attribute float aAlpha; varying float vA; void main(){ vA=aAlpha; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `precision highp float; uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor, vA*0.55); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    }));
    this.trailMesh.frustumCulled = false;
    this.trailMesh.renderOrder = 21;
    
    scene.add(this.trailMesh);

    this._moonfallBeam = null;
    this._bindEvents();
    this._tmp = new THREE.Vector3();
  }

  _bindEvents() {
    bus.on('fx:splash', ({ pos, power = 1, dir }) => this.splash(pos, power, dir));
    bus.on('fx:swordTrail', ({ on, heavy }) => { this._trail.on = on; this._trail.heavy = !!heavy; if (!on) this._trail.pts.length = 0; });
    bus.on(EVT.HIT_LANDED, ({ pos, normal, heavy }) => this.hitImpact(pos, { heavy, normal }));
  }

  _spawn(x, y, z, vx, vy, vz, life, size, color, opts = {}) {
    const budget = settings.q.particles;
    if (Math.random() > budget && !opts.important) return null;
    let idx = -1;
    for (let i = 0; i < MAX; i++) {
      const j = (this._cursor + i) % MAX;
      if (!this.parts[j].alive) { idx = j; break; }
    }
    if (idx < 0) return null;
    this._cursor = (idx + 1) % MAX;
    const p = this.parts[idx];
    p.alive = true;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = life; p.maxLife = life;
    p.size = size; p.baseSize = size;
    p.r = color.r; p.g = color.g; p.b = color.b;
    p.drag = opts.drag ?? 1.6;
    p.gravity = opts.gravity ?? -9.0;
    p.buoyant = opts.buoyant ?? false;
    p.splashOnLand = opts.splashOnLand ?? false;
    p.fade = opts.fade ?? 1;
    p.grow = opts.grow ?? 0;
    if (idx + 1 > this.count) this.count = idx + 1;
    return p;
  }

  // ------------------------------------------------------------- emitters --
  splash(pos, power = 1, dir = null) {
    const n = Math.round(8 + power * 22);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.6 + Math.random() * 2.4) * power;
      const vx = Math.sin(a) * s + (dir ? dir.x * power * 1.5 : 0);
      const vz = Math.cos(a) * s + (dir ? dir.z * power * 1.5 : 0);
      const vy = (1.6 + Math.random() * 3.4) * power;
      this._spawn(pos.x + Math.sin(a) * 0.2, SCALE.waterLevel + 0.05, pos.z + Math.cos(a) * 0.2,
        vx, vy, vz, 0.4 + Math.random() * 0.6, 0.055 + Math.random() * 0.09 * power,
        PALETTE.moonLight, { drag: 1.1, gravity: -13, splashOnLand: true, fade: 1.4 });
    }
  }

  bigSplash(pos, power = 2) {
    const n = Math.round(26 + power * 26);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * power * 1.6;
      const s = (1.5 + Math.random() * 5) * power * 0.6;
      this._spawn(pos.x + Math.sin(a) * r, SCALE.waterLevel + 0.1, pos.z + Math.cos(a) * r,
        Math.sin(a) * s, (2.5 + Math.random() * 6) * power * 0.55, Math.cos(a) * s,
        0.7 + Math.random() * 0.9, 0.10 + Math.random() * 0.24 * power,
        PALETTE.moonLight, { drag: 0.9, gravity: -12, splashOnLand: true, important: i < 20 });
    }
    // low mist skirt
    for (let i = 0; i < Math.round(10 * power); i++) {
      const a = Math.random() * Math.PI * 2;
      const r = power * (0.8 + Math.random() * 2.2);
      this._spawn(pos.x + Math.sin(a) * r, 0.3 + Math.random() * 0.8, pos.z + Math.cos(a) * r,
        Math.sin(a) * 1.2, 0.35, Math.cos(a) * 1.2, 1.6 + Math.random(), 1.2 + Math.random() * 1.8,
        PALETTE.fog, { drag: 1.6, gravity: 0.15, fade: 0.5, grow: 1.4 });
    }
  }

  hitImpact(pos, { heavy = false, big = false, normal = null } = {}) {
    const n = heavy || big ? 34 : 18;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const el = Math.random() * Math.PI - Math.PI / 2;
      const s = (3 + Math.random() * 9) * (heavy ? 1.5 : 1);
      const dx = Math.cos(el) * Math.sin(a), dy = Math.sin(el), dz = Math.cos(el) * Math.cos(a);
      const bias = normal ? 0.55 : 0;
      this._spawn(pos.x, pos.y, pos.z,
        dx * s + (normal ? normal.x * s * bias : 0),
        dy * s + 2.5,
        dz * s + (normal ? normal.z * s * bias : 0),
        0.18 + Math.random() * 0.30, 0.05 + Math.random() * 0.10,
        PALETTE.hitSpark, { drag: 3.4, gravity: -14, fade: 2.2, important: i < 8 });
    }
    // spore/ichor puff — the deity bleeds pale green
    for (let i = 0; i < (heavy ? 16 : 8); i++) {
      const a = Math.random() * Math.PI * 2;
      this._spawn(pos.x, pos.y, pos.z,
        Math.sin(a) * 2.2, 1.4 + Math.random() * 2.2, Math.cos(a) * 2.2,
        0.9 + Math.random() * 0.8, 0.16 + Math.random() * 0.22,
        PALETTE.bloodSpore, { drag: 1.9, gravity: -1.2, fade: 0.7, grow: 0.5 });
    }
  }

  sporeBurst(pos, power = 1) {
    const n = Math.round(26 * power);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * power * 2;
      this._spawn(pos.x + Math.sin(a) * r, pos.y + Math.random() * power, pos.z + Math.cos(a) * r,
        Math.sin(a) * (1 + Math.random() * 2), 0.6 + Math.random() * 1.6, Math.cos(a) * (1 + Math.random() * 2),
        1.8 + Math.random() * 1.6, 0.25 + Math.random() * 0.45 * power,
        PALETTE.bossEyeDim, { drag: 1.2, gravity: -0.5, buoyant: true, fade: 0.55, grow: 0.8 });
    }
  }

  gust(pos, dir) {
    for (let i = 0; i < 60; i++) {
      const spread = (Math.random() - 0.5) * 1.1;
      const d = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), spread);
      const s = 12 + Math.random() * 22;
      this._spawn(pos.x + d.x * 3, 0.4 + Math.random() * 5, pos.z + d.z * 3,
        d.x * s, 0.6 + Math.random(), d.z * s,
        1.2 + Math.random(), 1.4 + Math.random() * 2.4,
        PALETTE.fogMoonlit, { drag: 0.6, gravity: 0.1, fade: 0.6, grow: 2.2 });
    }
  }

  spirit(pos) {
    this._spawn(pos.x, pos.y, pos.z, (Math.random() - 0.5) * 0.5, 2.4 + Math.random() * 2.2, (Math.random() - 0.5) * 0.5,
      4.5, 0.22 + Math.random() * 0.3, PALETTE.moon, { drag: 0.25, gravity: 0.9, fade: 0.4, important: true });
  }

  shockwave(pos, maxR, duration) {
    const slot = this.rings.find((r) => !r.active);
    if (!slot) return;
    slot.active = true;
    slot.t = 0;
    slot.duration = duration;
    slot.maxR = maxR;
    slot.mesh.visible = true;
    slot.mesh.position.copy(pos);
    slot.mesh.position.y = SCALE.waterLevel + 0.06;
  }

  moonfallCharge(k) {
    if (Math.random() < k * 0.5) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * SCALE.arenaRadius;
      this._spawn(Math.sin(a) * r, 0.2, Math.cos(a) * r, 0, 3 + Math.random() * 6, 0,
        1.4, 0.18 + Math.random() * 0.3, PALETTE.moon, { drag: 0.4, gravity: 1.2, fade: 0.8 });
    }
  }

  moonfallStrike() {
    for (let i = 0; i < 140; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * SCALE.arenaRadius;
      this._spawn(Math.sin(a) * r, 0.1, Math.cos(a) * r,
        Math.sin(a) * (2 + Math.random() * 8), 3 + Math.random() * 12, Math.cos(a) * (2 + Math.random() * 8),
        0.9 + Math.random(), 0.12 + Math.random() * 0.3, PALETTE.moon,
        { drag: 1.0, gravity: -12, splashOnLand: true, important: i < 40 });
    }
    this.shockwave(new THREE.Vector3(0, 0, 0), SCALE.arenaRadius, 1.2);
  }

  // ---------------------------------------------------------------- update --
  update(dt, elapsed, player) {
    let maxIdx = 0;
    for (let i = 0; i < this.count; i++) {
      const p = this.parts[i];
      const i3 = i * 3;
      if (!p.alive) { this.alp[i] = 0; continue; }
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; this.alp[i] = 0; continue; }

      p.vy += p.gravity * dt;
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d; p.vz *= d;
      if (p.buoyant) p.vy += 1.4 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;

      if (p.y < SCALE.waterLevel && p.vy < 0) {
        if (p.splashOnLand) {
          this.water?.splash(p.x, p.z, 0.06, 0.28);
          p.alive = false; this.alp[i] = 0; continue;
        }
        p.y = SCALE.waterLevel; p.vy *= -0.25;
      }

      const k = p.life / p.maxLife;
      this.pos[i3] = p.x; this.pos[i3 + 1] = p.y; this.pos[i3 + 2] = p.z;
      this.col[i3] = p.r; this.col[i3 + 1] = p.g; this.col[i3 + 2] = p.b;
      this.siz[i] = p.baseSize * (1 + (1 - k) * p.grow);
      this.alp[i] = Math.pow(k, p.fade);
      maxIdx = i + 1;
    }
    this.count = maxIdx;
    this.points.geometry.setDrawRange(0, this.count);
    if (this.count > 0) {
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.aColor.needsUpdate = true;
      this.points.geometry.attributes.aSize.needsUpdate = true;
      this.points.geometry.attributes.aAlpha.needsUpdate = true;
    }

    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt;
      const k = Math.min(1, r.t / r.duration);
      r.mesh.scale.setScalar(0.5 + k * r.maxR);
      r.mesh.material.opacity = (1 - k) * 0.65;
      if (k >= 1) { r.active = false; r.mesh.visible = false; }
    }

    this._updateTrail(dt, player);
  }

  _updateTrail(dt, player) {
    const T = this._trail;
    if (T.on && player) {
      const tip = player.swordTipWorld(new THREE.Vector3());
      const base = player.swordBaseWorld(this._tmp.clone());
      T.pts.push({ tip: tip.clone(), base: base.clone(), age: 0 });
    }
    for (let i = T.pts.length - 1; i >= 0; i--) {
      T.pts[i].age += dt;
      if (T.pts[i].age > 0.16) T.pts.splice(i, 1);
    }
    const n = Math.min(T.pts.length, 30);
    const idx = [];
    for (let i = 0; i < n; i++) {
      const p = T.pts[T.pts.length - n + i];
      const a = (1 - p.age / 0.16) * (i / Math.max(1, n - 1));
      this._trailPos[i * 6 + 0] = p.base.x; this._trailPos[i * 6 + 1] = p.base.y; this._trailPos[i * 6 + 2] = p.base.z;
      this._trailPos[i * 6 + 3] = p.tip.x; this._trailPos[i * 6 + 4] = p.tip.y; this._trailPos[i * 6 + 5] = p.tip.z;
      this._trailAlpha[i * 2] = a * 0.5; this._trailAlpha[i * 2 + 1] = a;
      if (i > 0) {
        const b = (i - 1) * 2;
        idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }
    this.trailMesh.visible = n > 1;
    if (n > 1) {
      this.trailMesh.geometry.setIndex(idx);
      this.trailMesh.geometry.attributes.position.needsUpdate = true;
      this.trailMesh.geometry.attributes.aAlpha.needsUpdate = true;
      this.trailMesh.geometry.setDrawRange(0, idx.length);
      this.trailMesh.material.uniforms.uColor.value.copy(T.heavy ? PALETTE.dangerTell : PALETTE.hitSpark);
    }
  }
}

export default Effects;
