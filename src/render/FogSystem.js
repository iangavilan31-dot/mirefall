import * as THREE from 'three';
import { PALETTE, SCALE } from '../core/Palette.js';
import { settings } from '../core/Settings.js';
import TL from '../world/TextureLab.js';
import { bus } from '../core/EventBus.js';

/**
 * Fog is the primary depth cue and it hides every world boundary (ART_TARGET §5).
 *
 * Three layers:
 *  1. scene FogExp2 — the flat far-field collapse to #8b979c;
 *  2. drifting sheets — large soft cards at 2–14 m, moving 0.15–0.4 m/s;
 *  3. ground mist — a dense band in the lowest 1.5 m that the player and boss displace.
 */

const MIST_VERT = /* glsl */`
  attribute float aSeed;
  attribute float aScale;
  uniform float uTime;
  uniform vec3  uDisplace;     // xz = position, w-ish = radius in uDisplaceR
  uniform float uDisplaceR;
  uniform vec3  uCamPos;
  varying float vFade;
  varying vec2  vUv;
  varying float vSeed;

  void main() {
    vUv = uv;
    vSeed = aSeed;
    vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;

    // per-card drift
    float t = uTime * (0.06 + aSeed * 0.05);
    vec3 off = vec3(sin(t + aSeed * 12.0) * 6.0, sin(t * 0.7 + aSeed * 3.0) * 0.35, cos(t * 0.8 + aSeed * 7.0) * 6.0);

    // push away from a displacing body (the player wading, the boss landing)
    vec2 d = world.xz + off.xz - uDisplace.xz;
    float dl = length(d);
    if (dl < uDisplaceR) {
      float k = 1.0 - dl / uDisplaceR;
      off.xz += normalize(d + 0.001) * k * k * uDisplaceR * 0.55;
      off.y += k * 0.35;
    }

    vec3 centre = world + off;

    // billboard toward the camera, but keep the up axis vertical
    vec3 toCam = normalize(uCamPos - centre);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec2 corner = (uv - 0.5) * aScale;
    vec3 pos = centre + right * corner.x + up * corner.y * 0.42;

    float dist = distance(uCamPos, pos);
    // fade out very close so the camera never punches through a card
    vFade = smoothstep(1.2, 6.0, dist) * (1.0 - smoothstep(52.0, 88.0, dist));

    gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
  }
`;

const MIST_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uTex;
  uniform vec3  uColor;
  uniform vec3  uMoonColor;
  uniform vec3  uMoonDir;
  uniform float uOpacity;
  uniform float uTime;
  varying float vFade;
  varying vec2  vUv;
  varying float vSeed;

  void main() {
    vec2 uv = vUv;
    uv.x += sin(uTime * 0.10 + vSeed * 6.0) * 0.05;
    float a = texture2D(uTex, uv).a;
    if (a < 0.005) discard;
    // brighter on the moon side
    vec3 col = mix(uColor, uMoonColor, 0.22 + 0.18 * sin(vSeed * 4.0));
    gl_FragColor = vec4(col, a * vFade * uOpacity);
  }
`;

export class FogSystem {
  constructor(scene, sky) {
    this.scene = scene;
    this.sky = sky;
    this.group = new THREE.Group();
    this.group.name = 'fog';
    // fog cards are excluded from the reflection pass by Water.excludeFromReflection
    scene.add(this.group);

    this.uniforms = {
      uTex: { value: TL.fogSheet(256, 12) },
      uTime: { value: 0 },
      uColor: { value: PALETTE.fog.clone() },
      uMoonColor: { value: PALETTE.fogMoonlit.clone() },
      uMoonDir: { value: sky.moonDir.clone() },
      uOpacity: { value: 0.30 },
      uCamPos: { value: new THREE.Vector3() },
      uDisplace: { value: new THREE.Vector3(0, 0, 0) },
      uDisplaceR: { value: 3.0 },
    };

    this.layers = [];
    this._build();
    bus.on('engine:quality', () => this._build());
  }

  _build() {
    for (const l of this.layers) { this.group.remove(l.mesh); l.mesh.geometry.dispose(); }
    this.layers.length = 0;

    const sheets = settings.q.fogSheets;
    if (sheets <= 0) return;

    // Layer plan: dense low mist near the waterline, thinner sheets higher up.
    //
    // These cards are an ACCENT on top of the scene's exponential fog — they add drift and
    // shape, they are not the fog itself. Counts and opacities are deliberately small:
    // alpha compositing is multiplicative, so N overlapping cards of opacity a reach
    // 1-(1-a)^N very fast. An earlier pass used ~200 cards at 0.10–0.34 and buried the
    // entire scene in a flat grey wash.
    const plan = [
      { y: 0.60, count: 16, scale: [16, 34], opacity: 0.100, tex: 12 },
      { y: 2.00, count: 12, scale: [22, 44], opacity: 0.075, tex: 27 },
      { y: 5.00, count: 10, scale: [30, 58], opacity: 0.055, tex: 41 },
      { y: 10.0, count: 8, scale: [38, 72], opacity: 0.040, tex: 55 },
      { y: 17.0, count: 6, scale: [46, 88], opacity: 0.030, tex: 68 },
    ].slice(0, sheets);

    for (let li = 0; li < plan.length; li++) {
      const p = plan[li];
      const count = Math.ceil(p.count * settings.q.instanceDensity);
      const geo = new THREE.InstancedBufferGeometry();
      const base = new THREE.PlaneGeometry(1, 1);
      geo.index = base.index;
      geo.attributes.position = base.attributes.position;
      geo.attributes.uv = base.attributes.uv;
      geo.attributes.normal = base.attributes.normal;

      const offs = new Float32Array(count * 3);
      const seeds = new Float32Array(count);
      const scales = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        // keep cards out of the player's immediate bubble so the camera never sits inside one
        const r = 18 + Math.pow(Math.random(), 0.6) * 84;
        offs[i * 3] = Math.sin(a) * r;
        offs[i * 3 + 1] = p.y + (Math.random() - 0.5) * p.y * 0.8;
        offs[i * 3 + 2] = Math.cos(a) * r;
        seeds[i] = Math.random();
        scales[i] = p.scale[0] + Math.random() * (p.scale[1] - p.scale[0]);
      }
      geo.setAttribute('offset', new THREE.InstancedBufferAttribute(offs, 3));
      geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
      geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(scales, 1));
      geo.instanceCount = count;

      const uniforms = {};
      for (const [k, v] of Object.entries(this.uniforms)) uniforms[k] = v;
      uniforms.uOpacity = { value: p.opacity };
      uniforms.uTex = { value: TL.fogSheet(256, p.tex) };

      const mat = new THREE.ShaderMaterial({
        vertexShader: MIST_VERT.replace('vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;',
          'vec3 world = offset;'),
        fragmentShader: MIST_FRAG,
        uniforms, transparent: true, depthWrite: false, depthTest: true,
        blending: THREE.NormalBlending, side: THREE.DoubleSide, toneMapped: true,
      });
      mat.vertexShader = 'attribute vec3 offset;\n' + mat.vertexShader;

      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 10 + li;
      
      this.group.add(mesh);
      this.layers.push({ mesh, mat, y: p.y });
    }
  }

  /** Thicken the fog for phase 3 / dim the whole field. */
  setDensity(k) {
    for (const l of this.layers) l.mat.uniforms.uOpacity.value *= k;
  }

  update(dt, elapsed, cameraPos, boss) {
    this.uniforms.uTime.value = elapsed;
    this.uniforms.uCamPos.value.copy(cameraPos);
    for (const l of this.layers) {
      l.mat.uniforms.uTime.value = elapsed;
      l.mat.uniforms.uCamPos.value.copy(cameraPos);
      l.mat.uniforms.uColor.value.copy(this.scene.fog.color);
    }
    // the boss displaces the mist when it is low
    if (boss) {
      const y = boss.model.bodyPivot.position.y;
      const low = y < 14;
      this.uniforms.uDisplace.value.set(boss.root.position.x, 0, boss.root.position.z);
      this.uniforms.uDisplaceR.value = low ? 26 : 3;
    }
  }
}

export default FogSystem;
