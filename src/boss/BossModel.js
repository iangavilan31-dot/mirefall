import * as THREE from 'three';
import { PALETTE, SCALE } from '../core/Palette.js';
import TL from '../world/TextureLab.js';

/**
 * The Mire Deity — a drowned tree canopy that learned to fly.
 *
 * Construction rules (ART_TARGET §8):
 *  - the body is NOT a clean insect; it is hanging moss, vines, dead branches and rotted cloth
 *    arranged in the *shape* of a moth;
 *  - the wings are enormous, tattered, veined and genuinely translucent — moonlight passes
 *    through them and they glow brightest where they overlap the moon;
 *  - 6 colossal legs read as architecture; the player runs between them;
 *  - 4 yellow-green ocelli are the focal point of the entire frame.
 */

// Backlit membrane. The signature material of the game.
const WING_VERT = /* glsl */`
  uniform float uTime;
  uniform float uFlap;
  uniform float uBend;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vSpan;

  void main() {
    vUv = uv;
    vec3 p = position;
    // span 0 at the root, 1 at the wingtip
    float span = clamp(uv.x, 0.0, 1.0);
    vSpan = span;

    // membrane billow: the wing trails behind the flap, more at the tip
    float trail = sin(uTime * 1.35 + span * 2.1) * 0.5 + 0.5;
    p.z += uBend * span * span * (0.55 + trail * 0.45);
    p.y += sin(span * 3.14159 + uTime * 0.9) * 0.35 * span * uFlap;
    // chordwise ripple so the surface is never a flat sheet
    p.z += sin(uv.y * 9.0 + uTime * 1.7 + span * 4.0) * 0.22 * span;

    vec4 wp = modelMatrix * vec4(p, 1.0);
    vWorld = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const WING_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uMap;
  uniform sampler2D uAlpha;
  uniform vec3  uMoonDir;
  uniform vec3  uMoonColor;
  uniform vec3  uFogColor;
  uniform float uFogDensity;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uDamage;
  uniform vec3  uEyeColor;
  uniform float uRage;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vSpan;

  void main() {
    vec4 tex = texture2D(uMap, vUv);
    float a = texture2D(uAlpha, vUv).r;
    // extra tatter toward the tip, and more as the fight progresses
    a *= 1.0 - smoothstep(0.72, 1.0, vSpan) * (0.25 + uRage * 0.45);
    if (a < 0.04) discard;

    vec3 V = normalize(cameraPosition - vWorld);
    vec3 N = normalize(vNormal);
    vec3 L = normalize(uMoonDir);

    // --- the signature term: light transmitted THROUGH the membrane ---
    // strongest when the moon is on the far side of the wing from the viewer
    float back = max(dot(-N, L), 0.0);
    float align = max(dot(V, -L), 0.0);
    float transmit = pow(back, 1.4) * (0.35 + 0.65 * pow(align, 2.2));

    // thin membrane transmits more where the texture is lighter (less grime/vein)
    float thin = 1.0 - tex.r * 0.55;
    transmit *= 0.55 + thin * 0.9;

    float front = max(dot(N, L), 0.0);

    vec3 col = tex.rgb * 0.30;
    col += uMoonColor * transmit * 1.85;
    col += uMoonColor * front * 0.22;

    // veins darken against the transmitted light — reads as structure
    col *= mix(1.0, 0.42, smoothstep(0.30, 0.72, tex.r) * transmit * 0.9);

    // grazing rim
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    col += uMoonColor * fres * 0.28;

    // sickly bioluminescence bleeding out from the body in later phases
    col += uEyeColor * uRage * (1.0 - vSpan) * 0.30 * (0.6 + 0.4 * sin(uTime * 2.3 + vUv.y * 6.0));

    // damage flash
    col += vec3(1.0, 0.85, 0.6) * uDamage * 0.7;

    float dist = length(cameraPosition - vWorld);
    float fogAmt = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    col = mix(col, uFogColor, clamp(fogAmt, 0.0, 1.0));

    float alpha = a * uOpacity * (0.62 + transmit * 0.5);
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

function gnarl(geo, amp, seed = 1, axis = 'y') {
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = axis === 'y' ? v.y : v.z;
    const bend = Math.sin(k * 0.55 + seed) * amp + Math.sin(k * 1.9 - seed * 2) * amp * 0.4;
    v.x += bend;
    v.z += Math.cos(k * 0.7 + seed * 1.7) * amp * 0.8;
    const swell = 1 + Math.sin(k * 3.1 + seed) * 0.07;
    if (axis === 'y') { v.x *= swell; v.z *= swell; }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

export class BossModel {
  constructor(sky) {
    this.root = new THREE.Group();
    this.root.name = 'boss';
    this.sky = sky;
    this.moonDir = sky ? sky.moonDir.clone() : new THREE.Vector3(0.06, 0.68, -0.73).normalize();

    const barkTex = TL.bark(512);
    const mossTex = TL.moss(512);
    const clothTex = TL.cloth(256);
    const wingTex = TL.wingMembrane(1024);

    this.matBark = new THREE.MeshStandardMaterial({
      ...barkTex, color: PALETTE.barkWet.clone(), roughness: 0.95, metalness: 0.0,
    });
    this.matBark.map.repeat.set(2, 5);
    this.matBark.normalMap.repeat.set(2, 5);
    this.matBark.roughnessMap.repeat.set(2, 5);
    this.matMoss = new THREE.MeshStandardMaterial({ ...mossTex, color: PALETTE.mossDark.clone(), roughness: 1.0 });
    this.matCloth = new THREE.MeshStandardMaterial({ ...clothTex, color: PALETTE.cloth.clone(), roughness: 0.98, side: THREE.DoubleSide });

    this.wingUniforms = {
      uMap: { value: wingTex.map },
      uAlpha: { value: wingTex.alphaMap },
      uMoonDir: { value: this.moonDir.clone() },
      uMoonColor: { value: PALETTE.moon.clone() },
      uFogColor: { value: PALETTE.fog.clone() },
      uFogDensity: { value: SCALE.fogDensity },
      uTime: { value: 0 },
      uFlap: { value: 1 },
      uBend: { value: 0 },
      uOpacity: { value: 0.92 },
      uDamage: { value: 0 },
      uEyeColor: { value: PALETTE.bossEye.clone() },
      uRage: { value: 0 },
    };

    this._buildBody();
    this._buildWings();
    this._buildLegs();
    this._buildEyes();
    this._buildDrapery();

    this.root.position.set(0, 0, -14);
    this._t = 0;
  }

  // ------------------------------------------------------------------ body --
  _buildBody() {
    this.bodyPivot = new THREE.Group();
    this.bodyPivot.position.y = SCALE.bossHeadHeight;
    this.root.add(this.bodyPivot);

    this.thorax = new THREE.Group();
    this.bodyPivot.add(this.thorax);

    // The mass: overlapping deformed lumps, not a clean insect body.
    const lumps = [
      [0, 0, 0, 6.2, 5.4, 6.8, 1],
      [0, -3.6, 1.2, 4.6, 4.2, 5.2, 2],
      [0, -7.4, 2.4, 3.4, 3.8, 3.9, 3],
      [0, 3.4, -0.6, 4.4, 3.2, 4.6, 4],
      [-2.4, 1.2, 1.8, 3.0, 2.6, 3.0, 5],
      [2.4, 1.2, 1.8, 3.0, 2.6, 3.0, 6],
    ];
    for (const [x, y, z, sx, sy, sz, seed] of lumps) {
      const g = new THREE.IcosahedronGeometry(1, 3);
      const p = g.attributes.position; const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const n = Math.sin(v.x * 3.1 + seed) * Math.cos(v.y * 2.7 - seed) * Math.sin(v.z * 3.4 + seed);
        const n2 = Math.sin(v.x * 9.3 + seed * 3) * Math.cos(v.z * 8.1) * 0.35;
        v.multiplyScalar(1 + n * 0.24 + n2 * 0.08);
        p.setXYZ(i, v.x, v.y, v.z);
      }
      g.computeVertexNormals();
      g.scale(sx, sy, sz);
      g.translate(x, y, z);
      const m = new THREE.Mesh(g, this.matMoss);
      m.castShadow = true;
      this.thorax.add(m);
    }

    // head — pushed forward and down, with a heavy brow that shades the eyes
    this.head = new THREE.Group();
    this.head.position.set(0, 1.4, 4.6);
    this.thorax.add(this.head);
    const headGeo = new THREE.IcosahedronGeometry(3.5, 3);
    const hp = headGeo.attributes.position; const hv = new THREE.Vector3();
    for (let i = 0; i < hp.count; i++) {
      hv.fromBufferAttribute(hp, i);
      const n = Math.sin(hv.x * 2.4) * Math.cos(hv.y * 3.1) * Math.sin(hv.z * 2.2);
      hv.multiplyScalar(1 + n * 0.22);
      hp.setXYZ(i, hv.x, hv.y, hv.z);
    }
    headGeo.computeVertexNormals();
    headGeo.scale(1.35, 0.95, 1.05);
    const head = new THREE.Mesh(headGeo, this.matMoss);
    head.castShadow = true;
    this.head.add(head);

    const brow = new THREE.Mesh(
      gnarl(new THREE.CylinderGeometry(0.85, 1.25, 9.5, 10, 4), 0.22, 3, 'y'),
      this.matBark
    );
    brow.rotation.z = Math.PI / 2;
    brow.rotation.y = 0.08;
    brow.position.set(0, 2.0, 1.4);
    brow.castShadow = true;
    this.head.add(brow);

    // antennae — long, drooping, feathered
    this.antennae = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 1.9, 2.6, 1.2);
      this.head.add(pivot);
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(s * 2.6, 3.0, 1.8),
        new THREE.Vector3(s * 6.0, 3.4, 3.6),
        new THREE.Vector3(s * 9.4, 1.2, 5.0),
        new THREE.Vector3(s * 11.6, -2.6, 5.6),
      ]);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.30, 6, false), this.matBark);
      tube.castShadow = true;
      pivot.add(tube);
      // feathering
      for (let i = 2; i < 22; i += 2) {
        const t = i / 24;
        const pt = curve.getPointAt(Math.min(0.99, t));
        const barb = new THREE.Mesh(new THREE.ConeGeometry(0.10, 1.4 * (1 - t * 0.6), 5), this.matMoss);
        barb.position.copy(pt);
        barb.rotation.set(Math.PI / 2, 0, s * 0.6 + t * 1.2);
        pivot.add(barb);
      }
      this.antennae.push(pivot);
    }
  }

  // ----------------------------------------------------------------- wings --
  _makeWingGeometry(span, chord, shapeFn) {
    const segX = 26, segY = 18;
    const g = new THREE.PlaneGeometry(span, chord, segX, segY);
    const p = g.attributes.position;
    const uv = g.attributes.uv;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const u = (v.x / span) + 0.5;          // 0 root .. 1 tip
      const w = (v.y / chord) + 0.5;         // 0 trailing .. 1 leading
      const half = shapeFn(u);
      v.y = (w - 0.5) * chord * half * 2.0;
      // camber
      v.z += Math.sin(u * Math.PI) * chord * 0.10 + Math.sin(w * Math.PI) * chord * 0.05;
      p.setXYZ(i, v.x + span * 0.5, v.y, v.z);
      uv.setXY(i, u, w);
    }
    g.computeVertexNormals();
    return g;
  }

  _buildWings() {
    const span = SCALE.bossWingSpan * 0.5;   // per side
    this.wings = [];
    this.wingRoots = [];

    const forewingShape = (u) => Math.sin(Math.pow(u, 0.55) * Math.PI * 0.92) * (1 - u * 0.18) + 0.06;
    const hindwingShape = (u) => Math.sin(Math.pow(u, 0.75) * Math.PI * 0.85) * (1 - u * 0.30) + 0.04;

    const defs = [
      { side: -1, pair: 0, span: span, chord: span * 0.62, pos: [-2.6, 2.2, -0.6], rot: [0.12, -0.22, 0.30], shape: forewingShape },
      { side: 1, pair: 0, span: span, chord: span * 0.62, pos: [2.6, 2.2, -0.6], rot: [0.12, 0.22, -0.30], shape: forewingShape },
      { side: -1, pair: 1, span: span * 0.68, chord: span * 0.50, pos: [-2.2, -2.2, 1.2], rot: [-0.10, -0.34, -0.22], shape: hindwingShape },
      { side: 1, pair: 1, span: span * 0.68, chord: span * 0.50, pos: [2.2, -2.2, 1.2], rot: [-0.10, 0.34, 0.22], shape: hindwingShape },
    ];

    for (const d of defs) {
      const root = new THREE.Group();
      root.position.set(...d.pos);
      root.rotation.set(...d.rot);
      this.thorax.add(root);

      const uniforms = {};
      for (const [k, val] of Object.entries(this.wingUniforms)) uniforms[k] = val;
      const mat = new THREE.ShaderMaterial({
        vertexShader: WING_VERT, fragmentShader: WING_FRAG,
        uniforms, transparent: true, side: THREE.DoubleSide,
        depthWrite: false, depthTest: true,
      });

      const geo = this._makeWingGeometry(d.span, d.chord, d.shape);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.x = d.side;
      mesh.frustumCulled = false;
      mesh.renderOrder = 6;
      root.add(mesh);

      // structural ribs read as silhouette against the moon
      const ribMat = new THREE.MeshBasicMaterial({ color: 0x151a19, transparent: true, opacity: 0.55 });
      for (let r = 0; r < 5; r++) {
        const t = 0.10 + r * 0.20;
        const half = d.shape(t) * d.chord;
        const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.05, half * 1.8, 5), ribMat);
        rib.position.set(d.side * d.span * t, 0, 0.3);
        rib.rotation.z = d.side * (0.1 + r * 0.06);
        rib.renderOrder = 7;
        root.add(rib);
      }
      // leading-edge spar
      const spar = new THREE.Mesh(
        gnarl(new THREE.CylinderGeometry(0.36, 0.10, d.span, 6, 6), 0.30, d.pair * 3 + 1, 'y'),
        this.matBark
      );
      spar.rotation.z = Math.PI / 2 * -d.side;
      spar.position.set(d.side * d.span * 0.5, d.chord * d.shape(0.5) * 0.55, 0.2);
      spar.castShadow = false;
      root.add(spar);

      this.wings.push({ root, mesh, mat, def: d });
      this.wingRoots.push(root);
    }
  }

  // ------------------------------------------------------------------ legs --
  _buildLegs() {
    this.legs = [];
    const n = SCALE.bossLegCount;
    const spread = SCALE.bossLegSpread;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI / n;
      const side = i < n / 2 ? -1 : 1;
      const hip = new THREE.Group();
      hip.position.set(Math.sin(a) * 3.2, -5.0 - Math.abs(Math.cos(a)) * 1.5, Math.cos(a) * 3.2);
      this.thorax.add(hip);

      const femurLen = 13 + (i % 3) * 2.2;
      const femurGeo = gnarl(new THREE.CylinderGeometry(0.95, 0.62, femurLen, 8, 8), 0.5, i + 1, 'y');
      femurGeo.translate(0, -femurLen / 2, 0);
      const femur = new THREE.Mesh(femurGeo, this.matBark);
      femur.castShadow = true;
      hip.add(femur);

      const knee = new THREE.Group();
      knee.position.y = -femurLen;
      hip.add(knee);

      const tibiaLen = 15 + (i % 2) * 3.0;
      const tibiaGeo = gnarl(new THREE.CylinderGeometry(0.60, 0.26, tibiaLen, 7, 8), 0.62, i + 11, 'y');
      tibiaGeo.translate(0, -tibiaLen / 2, 0);
      const tibia = new THREE.Mesh(tibiaGeo, this.matBark);
      tibia.castShadow = true;
      knee.add(tibia);

      const foot = new THREE.Group();
      foot.position.y = -tibiaLen;
      knee.add(foot);
      // splayed claw that breaks the water surface
      for (let c = 0; c < 3; c++) {
        const ca = (c / 3) * Math.PI * 2;
        const claw = new THREE.Mesh(
          gnarl(new THREE.CylinderGeometry(0.22, 0.05, 3.4, 5, 4), 0.35, c + i * 3, 'y'),
          this.matBark
        );
        claw.position.set(Math.sin(ca) * 0.8, -1.4, Math.cos(ca) * 0.8);
        claw.rotation.set(Math.cos(ca) * 0.6, 0, -Math.sin(ca) * 0.6);
        foot.add(claw);
      }

      // hanging moss on the leg — this is what makes it read as swamp architecture
      this._addMossCurtain(knee, 0, -tibiaLen * 0.35, 0, 4.5, 7.5, i);
      this._addMossCurtain(hip, 0, -femurLen * 0.55, 0, 5.5, 9.0, i + 30);

      const restAngle = { hip: hip.rotation.clone(), knee: knee.rotation.clone() };
      hip.rotation.z = Math.sin(a) * 0.55;
      hip.rotation.x = -Math.cos(a) * 0.55;
      knee.rotation.z = -Math.sin(a) * 0.75;
      knee.rotation.x = Math.cos(a) * 0.75;

      this.legs.push({
        hip, knee, foot, angle: a, side, index: i,
        femurLen, tibiaLen,
        restHipRot: hip.rotation.clone(), restKneeRot: knee.rotation.clone(),
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  _addMossCurtain(parent, x, y, z, w, h, seed) {
    const tex = TL.mossCurtain(256, 30 + (seed % 7));
    const mat = new THREE.MeshStandardMaterial({
      map: tex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide,
      roughness: 1.0, color: PALETTE.mossDark.clone(), depthWrite: true,
    });
    const group = new THREE.Group();
    group.position.set(x, y, z);
    for (let i = 0; i < 2; i++) {
      const g = new THREE.PlaneGeometry(w, h, 4, 6);
      g.translate(0, -h / 2, 0);
      const m = new THREE.Mesh(g, mat);
      m.rotation.y = i * Math.PI / 2 + seed * 0.3;
      m.userData.baseGeo = g.attributes.position.clone();
      m.userData.h = h;
      group.add(m);
    }
    parent.add(group);
    (this.curtains ||= []).push(group);
    return group;
  }

  // ------------------------------------------------------------------ eyes --
  _buildEyes() {
    this.eyes = [];
    this.eyeGroup = new THREE.Group();
    this.head.add(this.eyeGroup);

    const glowTex = TL.glowSprite(128, 2.0);
    // two larger low, two smaller high (ART_TARGET §2)
    const defs = [
      [-1.65, 0.05, 2.85, 0.98], [1.65, 0.05, 2.85, 0.98],
      [-2.55, 1.55, 2.35, 0.62], [2.55, 1.55, 2.35, 0.62],
    ];
    for (const [x, y, z, s] of defs) {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      this.eyeGroup.add(g);

      const core = new THREE.Mesh(
        new THREE.SphereGeometry(s * 0.92, 16, 12),
        new THREE.MeshBasicMaterial({ color: PALETTE.bossEye.clone(), toneMapped: false })
      );
      g.add(core);

      const iris = new THREE.Mesh(
        new THREE.SphereGeometry(s * 0.55, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0x0d1105, toneMapped: false })
      );
      iris.position.z = s * 0.5;
      iris.scale.set(1, 1.35, 0.5);
      g.add(iris);

      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: PALETTE.bossEye.clone(), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.85,
      }));
      halo.scale.setScalar(s * 12);
      g.add(halo);

      // heavy lid so the eye can narrow / blink
      const lid = new THREE.Mesh(new THREE.SphereGeometry(s * 1.05, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), this.matMoss);
      lid.rotation.x = -0.3;
      g.add(lid);

      this.eyes.push({ group: g, core, halo, lid, iris, size: s, blink: Math.random() * 6 });
    }
  }

  _buildDrapery() {
    // hanging vegetation from the thorax — the "drowned canopy" silhouette
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = 3.0 + Math.random() * 4.5;
      this._addMossCurtain(this.thorax, Math.sin(a) * r, -4.0 - Math.random() * 3, Math.cos(a) * r,
        3.0 + Math.random() * 3, 7 + Math.random() * 9, i + 60);
    }
    // rotted cloth banners
    this.banners = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      const g = new THREE.PlaneGeometry(3.2, 11, 3, 10);
      g.translate(0, -5.5, 0);
      const m = new THREE.Mesh(g, this.matCloth);
      m.position.set(Math.sin(a) * 5.2, -3.5, Math.cos(a) * 5.2);
      m.rotation.y = a;
      m.userData.baseGeo = g.attributes.position.clone();
      this.thorax.add(m);
      this.banners.push(m);
    }
  }

  // ---------------------------------------------------------------- update --
  update(dt, elapsed, ctx = {}) {
    this._t += dt;
    const t = elapsed;
    const u = this.wingUniforms;
    u.uTime.value = t;
    u.uRage.value = ctx.rage || 0;
    u.uDamage.value = Math.max(0, (u.uDamage.value || 0) - dt * 4.5);
    if (this.sky) u.uMoonDir.value.copy(this.sky.moonDir);

    // --- hover ---
    const hoverSpeed = 0.55 + (ctx.rage || 0) * 0.55;
    const flapAmp = (ctx.flapAmp !== undefined ? ctx.flapAmp : 1) * (0.28 + (ctx.rage || 0) * 0.22);
    const flap = Math.sin(t * Math.PI * 2 * hoverSpeed);
    const flapNext = Math.sin((t + 0.06) * Math.PI * 2 * hoverSpeed);
    u.uFlap.value = flapAmp;
    u.uBend.value = -(flapNext - flap) * 26 * flapAmp;

    this.bodyPivot.position.y = SCALE.bossHeadHeight + (ctx.heightOffset || 0) + flap * 1.35 * flapAmp * 2.4;
    this.thorax.rotation.x = (ctx.pitch || 0) + flap * 0.035;
    this.thorax.rotation.z = (ctx.roll || 0) + Math.sin(t * 0.41) * 0.018;

    for (const w of this.wings) {
      const d = w.def;
      const phase = d.pair === 0 ? 0 : 0.42;
      const f = Math.sin((t - phase * 0.25) * Math.PI * 2 * hoverSpeed);
      const amp = flapAmp * (d.pair === 0 ? 1.0 : 0.72);
      w.root.rotation.z = d.rot[2] + f * amp * d.side * 0.95;
      w.root.rotation.x = d.rot[0] + f * amp * 0.20;
      w.root.rotation.y = d.rot[1] + f * amp * d.side * 0.16;
      if (ctx.wingFlare) {
        w.root.rotation.z += ctx.wingFlare * d.side * 0.55;
        w.root.rotation.y += ctx.wingFlare * d.side * 0.35;
      }
    }

    // --- legs: micro-adjust constantly, never static ---
    for (const leg of this.legs) {
      const s = Math.sin(t * 0.7 + leg.phase);
      const s2 = Math.sin(t * 1.31 + leg.phase * 1.7);
      const anim = leg.anim;
      if (anim && anim.active) {
        leg.hip.rotation.x = leg.restHipRot.x + anim.hipX;
        leg.hip.rotation.z = leg.restHipRot.z + anim.hipZ;
        leg.knee.rotation.x = leg.restKneeRot.x + anim.kneeX;
      } else {
        leg.hip.rotation.x = leg.restHipRot.x + s * 0.035;
        leg.hip.rotation.z = leg.restHipRot.z + s2 * 0.030;
        leg.knee.rotation.x = leg.restKneeRot.x + s2 * 0.045;
      }
    }

    // --- eyes ---
    const rage = ctx.rage || 0;
    for (let i = 0; i < this.eyes.length; i++) {
      const e = this.eyes[i];
      e.blink -= dt;
      let lidClose = 0;
      if (e.blink < 0.14 && e.blink > 0) lidClose = 1 - Math.abs(e.blink - 0.07) / 0.07;
      if (e.blink <= 0) e.blink = 3.5 + Math.random() * 6;
      e.lid.rotation.x = -0.3 - lidClose * 0.9;

      const pulse = 0.78 + 0.22 * Math.sin(t * (1.4 + rage * 2.2) + i * 1.3);
      const tell = ctx.eyeIntensity !== undefined ? ctx.eyeIntensity : 1;
      const k = pulse * tell * (1 - lidClose * 0.8);
      e.halo.material.opacity = 0.55 * k + rage * 0.3;
      e.halo.scale.setScalar(e.size * (10 + rage * 5) * (0.85 + k * 0.3));
      const col = ctx.eyeColor || PALETTE.bossEye;
      e.core.material.color.copy(col).multiplyScalar(0.7 + k * 0.8);
      e.halo.material.color.copy(col);
    }

    // gaze tracking
    if (ctx.lookAt) {
      const local = this.head.worldToLocal(ctx.lookAt.clone());
      const yaw = Math.atan2(local.x, local.z);
      const pitch = Math.atan2(-local.y, Math.hypot(local.x, local.z));
      this.eyeGroup.rotation.y += (THREE.MathUtils.clamp(yaw, -0.45, 0.45) - this.eyeGroup.rotation.y) * Math.min(1, dt * 3.5);
      this.eyeGroup.rotation.x += (THREE.MathUtils.clamp(pitch, -0.3, 0.3) - this.eyeGroup.rotation.x) * Math.min(1, dt * 3.5);
    }

    // --- antennae sway ---
    for (let i = 0; i < this.antennae.length; i++) {
      const s = i === 0 ? -1 : 1;
      this.antennae[i].rotation.z = Math.sin(t * 0.63 + i * 2.1) * 0.13 * s;
      this.antennae[i].rotation.x = Math.sin(t * 0.47 + i) * 0.10 - (ctx.rage || 0) * 0.2;
    }

    // --- drapery sway (vertex-level so strands lag behind body motion) ---
    const sway = Math.sin(t * 0.8) * 0.5 + (ctx.wind || 0);
    if (this.curtains) {
      for (let ci = 0; ci < this.curtains.length; ci++) {
        const g = this.curtains[ci];
        g.rotation.z = Math.sin(t * 0.62 + ci * 0.9) * 0.06 + sway * 0.05;
        g.rotation.x = Math.cos(t * 0.53 + ci * 1.3) * 0.05;
      }
    }
    for (let bi = 0; bi < this.banners.length; bi++) {
      const b = this.banners[bi];
      const p = b.geometry.attributes.position;
      const base = b.userData.baseGeo;
      for (let i = 0; i < p.count; i++) {
        const bx = base.getX(i), by = base.getY(i), bz = base.getZ(i);
        const hang = Math.max(0, -by) / 11;
        p.setXYZ(i,
          bx + Math.sin(t * 1.3 + by * 0.4 + bi) * 0.7 * hang,
          by,
          bz + Math.sin(t * 0.9 + by * 0.3 + bi * 2) * 0.9 * hang + sway * hang * 1.4);
      }
      p.needsUpdate = true;
    }
  }

  flashDamage(amount = 1) { this.wingUniforms.uDamage.value = Math.min(1.5, this.wingUniforms.uDamage.value + amount); }

  /** World position of the head, used for lock-on and framing. */
  headWorld(out = new THREE.Vector3()) { return this.head.getWorldPosition(out); }
}

export default BossModel;
