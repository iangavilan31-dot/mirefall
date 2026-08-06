import * as THREE from 'three';
import { PALETTE, SCALE } from '../core/Palette.js';
import { settings } from '../core/Settings.js';
import { bus, EVT } from '../core/EventBus.js';
import { RippleSim } from './RippleSim.js';

/**
 * The flooded arena floor. Half the reference frame.
 *
 * Layers, in order of visual importance (ART_TARGET §6):
 *   1. Planar reflection of moon / boss legs / lanterns / architecture, blurred with distance.
 *   2. Simulated ripple rings driven by the player, boss and impacts.
 *   3. Long low procedural swells (< 4 cm) — the water is almost still.
 *   4. Murk: opaque within ~0.4 m, so submerged geometry fades rather than reading as a floor.
 *   5. Scum / duckweed film breaking the surface into authored patches.
 */

const WATER_VERT = /* glsl */`
uniform sampler2D uRipple;
uniform vec2  uRippleCenter;
uniform float uRippleSize;
uniform float uTime;
uniform float uSwell;

varying vec3 vWorld;
varying vec2 vUv;
varying float vRipple;
varying vec3 vViewDir;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);

  vec2 ruv = (wp.xz - uRippleCenter) / uRippleSize + 0.5;
  float rip = 0.0;
  if (all(greaterThan(ruv, vec2(0.0))) && all(lessThan(ruv, vec2(1.0)))) {
    rip = texture2D(uRipple, ruv).r;
  }
  vRipple = rip;

  // long, low swells — deliberately gentle
  float s = sin(wp.x * 0.062 + uTime * 0.32) * cos(wp.z * 0.048 - uTime * 0.24);
  s += 0.5 * sin(wp.x * 0.021 - wp.z * 0.017 + uTime * 0.17);
  wp.y += s * uSwell + rip * 0.16;

  vWorld = wp.xyz;
  vUv = uv;
  vViewDir = cameraPosition - wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WATER_FRAG = /* glsl */`
precision highp float;

uniform sampler2D uReflect;
uniform sampler2D uRipple;
uniform sampler2D uNormalNoise;
uniform vec2  uRippleCenter;
uniform float uRippleSize;
uniform float uRippleTexel;
uniform float uTime;
uniform float uHasReflection;
uniform float uReflectStrength;
uniform vec3  uDeep;
uniform vec3  uShallow;
uniform vec3  uFogColor;
uniform float uFogDensity;
uniform vec3  uMoonDir;
uniform vec3  uMoonColor;
uniform float uScum;
uniform vec2  uResolution;

varying vec3 vWorld;
varying vec2 vUv;
varying float vRipple;
varying vec3 vViewDir;

// --- compact value noise -------------------------------------------------
float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1,0)), u.x),
             mix(hash21(i + vec2(0,1)), hash21(i + vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){ v += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return v;
}

vec3 rippleNormal(vec2 world) {
  vec2 ruv = (world - uRippleCenter) / uRippleSize + 0.5;
  if (any(lessThan(ruv, vec2(0.002))) || any(greaterThan(ruv, vec2(0.998)))) return vec3(0.0, 1.0, 0.0);
  float t = uRippleTexel;
  float l = texture2D(uRipple, ruv - vec2(t, 0.0)).r;
  float r = texture2D(uRipple, ruv + vec2(t, 0.0)).r;
  float d = texture2D(uRipple, ruv - vec2(0.0, t)).r;
  float u = texture2D(uRipple, ruv + vec2(0.0, t)).r;
  return normalize(vec3(-(r - l) * 6.0, 1.0, -(u - d) * 6.0));
}

void main() {
  vec3 V = normalize(vViewDir);
  float dist = length(vViewDir);

  // ---- surface normal ---------------------------------------------------
  vec2 w = vWorld.xz;
  float n1 = fbm(w * 0.55 + vec2(uTime * 0.035, uTime * 0.021));
  float n2 = fbm(w * 1.7 - vec2(uTime * 0.06, uTime * 0.045));
  float n3 = fbm(w * 4.1 + vec2(-uTime * 0.09, uTime * 0.07));
  float e = 0.09;
  float nx = fbm((w + vec2(e,0.0)) * 1.7 - vec2(uTime * 0.06, uTime * 0.045)) - n2;
  float nz = fbm((w + vec2(0.0,e)) * 1.7 - vec2(uTime * 0.06, uTime * 0.045)) - n2;
  vec3 microN = normalize(vec3(-nx * 2.6, 1.0, -nz * 2.6));

  // detail fades with distance so the far water stays glassy and calm
  float detailFade = 1.0 - smoothstep(14.0, 60.0, dist);
  vec3 N = normalize(mix(vec3(0.0,1.0,0.0), microN, 0.55 * detailFade));
  vec3 rN = rippleNormal(w);
  N = normalize(mix(N, rN, 0.85 * detailFade));

  // ---- fresnel ----------------------------------------------------------
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - NdV, 4.2);
  fres = mix(0.045, 1.0, fres);

  // ---- reflection -------------------------------------------------------
  vec2 screen = gl_FragCoord.xy / uResolution;
  // distance-dependent distortion: strong up close, tiny far away (keeps far reflections vertical & smeared)
  float distort = mix(0.055, 0.006, smoothstep(4.0, 55.0, dist));
  vec2 ruv = screen + N.xz * distort;
  ruv = clamp(ruv, vec2(0.002), vec2(0.998));
  vec3 refl = texture2D(uReflect, ruv).rgb;
  // reflection blur approximation via 4-tap cross, widened by roughness
  float blur = mix(0.0015, 0.006, clamp(abs(vRipple) * 3.0, 0.0, 1.0));
  refl += texture2D(uReflect, clamp(ruv + vec2(blur, 0.0), vec2(0.002), vec2(0.998))).rgb;
  refl += texture2D(uReflect, clamp(ruv - vec2(blur, 0.0), vec2(0.002), vec2(0.998))).rgb;
  refl += texture2D(uReflect, clamp(ruv + vec2(0.0, blur), vec2(0.002), vec2(0.998))).rgb;
  refl += texture2D(uReflect, clamp(ruv - vec2(0.0, blur), vec2(0.002), vec2(0.998))).rgb;
  refl /= 5.0;

  vec3 fallback = mix(uFogColor * 0.72, uFogColor * 1.05, clamp(N.y, 0.0, 1.0));
  refl = mix(fallback, refl, uHasReflection);

  // ---- body colour ------------------------------------------------------
  float murk = clamp(n1 * 0.6 + 0.35, 0.0, 1.0);
  vec3 body = mix(uDeep, uShallow, murk * 0.55);
  body *= 0.82 + 0.3 * n3;

  vec3 col = mix(body, refl, clamp(fres * uReflectStrength, 0.0, 0.96));

  // ---- moon specular ----------------------------------------------------
  vec3 H = normalize(uMoonDir + V);
  float spec = pow(clamp(dot(N, H), 0.0, 1.0), 240.0);
  float glint = pow(clamp(dot(N, H), 0.0, 1.0), 26.0) * 0.09;
  col += uMoonColor * (spec * 1.9 + glint) * (0.35 + 0.65 * detailFade);

  // ---- ripple crest highlight (the visible rings) -----------------------
  float crest = clamp(vRipple, 0.0, 1.0);
  float trough = clamp(-vRipple, 0.0, 1.0);
  col += uMoonColor * crest * 0.16 * detailFade;
  col *= 1.0 - trough * 0.14 * detailFade;
  // thin bright rim where the ripple slope is steepest
  float slope = clamp(length(rN.xz) * 2.2, 0.0, 1.0);
  col += uMoonColor * slope * slope * 0.10 * detailFade;

  // ---- duckweed / scum film --------------------------------------------
  float scumMask = fbm(w * 0.16 + 11.3);
  scumMask = smoothstep(0.56, 0.78, scumMask) * uScum;
  float scumDetail = fbm(w * 3.4);
  vec3 scumCol = mix(vec3(0.055, 0.072, 0.048), vec3(0.10, 0.125, 0.078), scumDetail);
  scumMask *= 1.0 - smoothstep(30.0, 70.0, dist) * 0.5;
  col = mix(col, scumCol, scumMask * 0.72);

  // ---- fog --------------------------------------------------------------
  float fogAmt = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, clamp(fogAmt, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);
}
`;

export class Water {
  constructor(engine, { level = SCALE.waterLevel, extent = 900 } = {}) {
    this.engine = engine;
    this.level = level;
    this.enabled = true;

    this.sim = new RippleSim(engine.renderer, { res: 512, size: 150 });
    this.sim.setQuality(settings.q);

    // Reflection target
    this.reflectRT = null;
    this._makeReflectionTarget();
    this.reflectCam = new THREE.PerspectiveCamera();
    /**
     * Objects hidden for the duration of the reflection pass. Visibility toggling is used
     * rather than layers: `layers.set(n)` would also hide them from the MAIN camera, and
     * an object on {0,n} still intersects a {0} camera mask, so layers cannot express
     * "visible normally, absent from this one pass".
     */
    this.excludeFromReflection = [];

    const geo = new THREE.PlaneGeometry(extent, extent, 220, 220);
    geo.rotateX(-Math.PI / 2);

    this.uniforms = {
      uReflect: { value: null },
      uRipple: { value: this.sim.texture },
      uNormalNoise: { value: null },
      uRippleCenter: { value: this.sim.center },
      uRippleSize: { value: this.sim.size },
      uRippleTexel: { value: 1 / this.sim.res },
      uTime: { value: 0 },
      uHasReflection: { value: settings.q.reflection ? 1 : 0 },
      uReflectStrength: { value: 1.0 },
      uDeep: { value: PALETTE.waterDeep.clone() },
      uShallow: { value: PALETTE.waterMid.clone() },
      uFogColor: { value: PALETTE.fog.clone() },
      uFogDensity: { value: SCALE.fogDensity },
      uMoonDir: { value: new THREE.Vector3(0.05, 0.62, -0.78).normalize() },
      uMoonColor: { value: PALETTE.moonLight.clone() },
      uScum: { value: 1.0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uSwell: { value: 0.035 },
    };

    this.material = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      uniforms: this.uniforms,
      side: THREE.FrontSide,
      transparent: false,
      depthWrite: true,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.y = level;
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    // the water never reflects itself; Game hides it around the reflection pass
    this.mesh.name = 'water';

    this._reflectMatrix = new THREE.Matrix4();
    this._normal = new THREE.Vector3(0, 1, 0);
    this._view = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._lookAt = new THREE.Vector3();
    this._rot = new THREE.Matrix4();
    this._camPos = new THREE.Vector3();
    this._clipPlane = new THREE.Plane();
    this._clipVec = new THREE.Vector4();
    this._q = new THREE.Vector4();
    this._mirrorPos = new THREE.Vector3(0, level, 0);

    bus.on(EVT.WATER_IMPACT, ({ pos, strength = 0.3, radius = 0.6 }) => {
      this.sim.impulse(pos.x, pos.z, strength, radius);
    });
    bus.on('engine:quality', (q) => this.setQuality(q));
    bus.on('engine:resize', () => this._makeReflectionTarget());
  }

  _makeReflectionTarget() {
    const q = settings.q;
    if (this.reflectRT) this.reflectRT.dispose();
    if (!q.reflection) { this.reflectRT = null; return; }
    const w = Math.max(160, Math.floor(this.engine.width * q.reflectionScale));
    const h = Math.max(90, Math.floor(this.engine.height * q.reflectionScale));
    this.reflectRT = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false,
      colorSpace: THREE.LinearSRGBColorSpace,
    });
  }

  setQuality(q) {
    this.sim.setQuality(q);
    this._makeReflectionTarget();
    this.uniforms.uHasReflection.value = q.reflection && this.reflectRT ? 1 : 0;
  }

  addTo(scene) { scene.add(this.mesh); return this; }

  /** Height of the water surface at a world position (swell only — cheap CPU approximation). */
  heightAt(x, z, t = this.uniforms.uTime.value) {
    const s = Math.sin(x * 0.062 + t * 0.32) * Math.cos(z * 0.048 - t * 0.24)
            + 0.5 * Math.sin(x * 0.021 - z * 0.017 + t * 0.17);
    return this.level + s * this.uniforms.uSwell.value;
  }

  /** Convenience: emit a ripple + return whether it landed inside the sim. */
  splash(x, z, strength = 0.35, radius = 0.7) {
    this.sim.impulse(x, z, strength, radius);
  }

  update(dt, elapsed, focusX = 0, focusZ = 0) {
    this.uniforms.uTime.value = elapsed;
    this.uniforms.uResolution.value.set(
      this.engine.renderer.domElement.width,
      this.engine.renderer.domElement.height
    );
    this.sim.recenter(focusX, focusZ);
    this.sim.update(dt);
    this.uniforms.uRipple.value = this.sim.texture;
    this.uniforms.uRippleCenter.value = this.sim.center;
  }

  /**
   * Render the planar reflection. Must be called before the main render pass.
   * Uses Lengyel oblique near-plane clipping so nothing below the surface leaks in.
   */
  renderReflection(scene, camera) {
    if (!this.reflectRT || !settings.q.reflection) {
      this.uniforms.uHasReflection.value = 0;
      return;
    }
    const renderer = this.engine.renderer;
    const level = this.level;

    camera.updateMatrixWorld();
    this._camPos.setFromMatrixPosition(camera.matrixWorld);
    if (this._camPos.y < level + 0.05) { this.uniforms.uHasReflection.value = 0; return; }

    this._rot.extractRotation(camera.matrixWorld);
    this._lookAt.set(0, 0, -1).applyMatrix4(this._rot).add(this._camPos);

    this._mirrorPos.set(this._camPos.x, level, this._camPos.z);

    // reflected eye position
    this._view.subVectors(this._mirrorPos, this._camPos);
    this._view.reflect(this._normal).negate().add(this._mirrorPos);

    // reflected look-at
    this._target.subVectors(this._mirrorPos, this._lookAt);
    this._target.reflect(this._normal).negate().add(this._mirrorPos);

    const rc = this.reflectCam;
    rc.position.copy(this._view);
    rc.up.set(0, 1, 0).applyMatrix4(this._rot).reflect(this._normal);
    rc.lookAt(this._target);
    rc.fov = camera.fov; rc.aspect = camera.aspect; rc.near = camera.near; rc.far = camera.far;
    rc.updateProjectionMatrix();
    rc.updateMatrixWorld();

    // oblique near plane at the water surface
    this._clipPlane.setFromNormalAndCoplanarPoint(this._normal, new THREE.Vector3(0, level - 0.02, 0));
    this._clipPlane.applyMatrix4(rc.matrixWorldInverse);
    const cp = this._clipVec.set(this._clipPlane.normal.x, this._clipPlane.normal.y, this._clipPlane.normal.z, this._clipPlane.constant);
    const P = rc.projectionMatrix;
    this._q.x = (Math.sign(cp.x) + P.elements[8]) / P.elements[0];
    this._q.y = (Math.sign(cp.y) + P.elements[9]) / P.elements[5];
    this._q.z = -1.0;
    this._q.w = (1.0 + P.elements[10]) / P.elements[14];
    cp.multiplyScalar(2.0 / cp.dot(this._q));
    P.elements[2] = cp.x;
    P.elements[6] = cp.y;
    P.elements[10] = cp.z + 1.0;
    P.elements[14] = cp.w;

    const prevRT = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.enabled;
    const prevBg = scene.background;

    this.mesh.visible = false;
    const restore = [];
    for (const o of this.excludeFromReflection) {
      if (o) { restore.push([o, o.visible]); o.visible = false; }
    }

    renderer.shadowMap.enabled = false;
    renderer.setRenderTarget(this.reflectRT);
    renderer.setClearColor(PALETTE.fog, 1);
    renderer.clear(true, true, false);
    renderer.render(scene, rc);
    renderer.setRenderTarget(prevRT);
    renderer.shadowMap.enabled = prevShadow;
    scene.background = prevBg;

    for (const [o, v] of restore) o.visible = v;
    this.mesh.visible = true;

    this.uniforms.uReflect.value = this.reflectRT.texture;
    this.uniforms.uHasReflection.value = 1;
  }

  dispose() {
    this.sim.dispose();
    this.reflectRT?.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}

export default Water;
