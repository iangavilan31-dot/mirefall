import * as THREE from 'three';

/**
 * GPU heightfield ripple simulation (damped wave equation, ping-pong FBOs).
 * World-space region of `size` metres centred on `center`, resolution `res`.
 * Impulses are injected as additive gaussian splats each frame.
 *
 * Output: `.texture` — R = height, G = previous height (for velocity/foam).
 */

const SIM_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uPrev;   // t-1
uniform sampler2D uCur;    // t
uniform vec2  uTexel;
uniform float uDamp;
uniform float uSpeed;
uniform int   uCount;
uniform vec4  uImpulse[16];  // xy = uv, z = radius(uv), w = strength
varying vec2 vUv;

void main() {
  float c  = texture2D(uCur, vUv).r;
  float p  = texture2D(uPrev, vUv).r;

  float l = texture2D(uCur, vUv + vec2(-uTexel.x, 0.0)).r;
  float r = texture2D(uCur, vUv + vec2( uTexel.x, 0.0)).r;
  float d = texture2D(uCur, vUv + vec2(0.0, -uTexel.y)).r;
  float u = texture2D(uCur, vUv + vec2(0.0,  uTexel.y)).r;
  float l2 = texture2D(uCur, vUv + vec2(-uTexel.x, -uTexel.y)).r;
  float r2 = texture2D(uCur, vUv + vec2( uTexel.x,  uTexel.y)).r;
  float d2 = texture2D(uCur, vUv + vec2( uTexel.x, -uTexel.y)).r;
  float u2 = texture2D(uCur, vUv + vec2(-uTexel.x,  uTexel.y)).r;

  float lap = (l + r + d + u) * 0.5 + (l2 + r2 + d2 + u2) * 0.25 - c * 3.0;

  float n = (c * 2.0 - p) + lap * uSpeed;
  n *= uDamp;

  for (int i = 0; i < 16; i++) {
    if (i >= uCount) break;
    vec4 imp = uImpulse[i];
    float dist = length((vUv - imp.xy) * vec2(1.0, 1.0));
    float g = exp(-(dist * dist) / max(imp.z * imp.z, 1e-6));
    n += g * imp.w;
  }

  // absorbing border so waves don't bounce off the sim edge
  vec2 edge = min(vUv, 1.0 - vUv);
  float fade = smoothstep(0.0, 0.035, min(edge.x, edge.y));
  n *= mix(0.86, 1.0, fade);

  gl_FragColor = vec4(clamp(n, -1.5, 1.5), c, 0.0, 1.0);
}
`;

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export class RippleSim {
  constructor(renderer, { res = 512, size = 140 } = {}) {
    this.renderer = renderer;
    this.res = res;
    this.size = size;
    this.center = new THREE.Vector2(0, 0);
    this.enabled = true;

    const opts = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this.rtA = new THREE.WebGLRenderTarget(res, res, opts);
    this.rtB = new THREE.WebGLRenderTarget(res, res, opts);
    this.rtC = new THREE.WebGLRenderTarget(res, res, opts);

    this.uniforms = {
      uPrev: { value: this.rtA.texture },
      uCur: { value: this.rtB.texture },
      uTexel: { value: new THREE.Vector2(1 / res, 1 / res) },
      uDamp: { value: 0.992 },
      uSpeed: { value: 0.42 },
      uCount: { value: 0 },
      uImpulse: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) },
    };

    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: SIM_FRAG,
      uniforms: this.uniforms, depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.simScene = new THREE.Scene();
    this.simScene.add(this.quad);
    this.simCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this._pending = [];
    this._acc = 0;
    this._step = 1 / 60;
    this.texture = this.rtB.texture;
    this._clear();
  }

  _clear() {
    const prev = this.renderer.getRenderTarget();
    for (const rt of [this.rtA, this.rtB, this.rtC]) {
      this.renderer.setRenderTarget(rt);
      this.renderer.setClearColor(0x000000, 1);
      this.renderer.clear(true, false, false);
    }
    this.renderer.setRenderTarget(prev);
  }

  /** World position -> sim UV. Returns null if outside the sim region. */
  worldToUv(x, z) {
    const u = (x - this.center.x) / this.size + 0.5;
    const v = (z - this.center.y) / this.size + 0.5;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    return [u, v];
  }

  /**
   * @param {number} x world X
   * @param {number} z world Z
   * @param {number} strength -1..1 (negative = depression, e.g. a foot pressing down)
   * @param {number} radiusM radius in metres
   */
  impulse(x, z, strength = 0.25, radiusM = 0.5) {
    if (!this.enabled) return;
    const uv = this.worldToUv(x, z);
    if (!uv) return;
    this._pending.push([uv[0], uv[1], Math.max(radiusM / this.size, 0.0025), strength]);
  }

  recenter(x, z) {
    // Recentring would smear the field; only recentre when the player leaves the safe inner box.
    const dx = x - this.center.x, dz = z - this.center.y;
    if (Math.abs(dx) < this.size * 0.24 && Math.abs(dz) < this.size * 0.24) return;
    this.center.set(x, z);
    this._clear();
  }

  update(dt) {
    if (!this.enabled) return;
    this._acc += Math.min(dt, 0.05);
    let steps = 0;
    while (this._acc >= this._step && steps < 3) {
      this._acc -= this._step;
      this._simStep();
      steps++;
    }
    if (steps === 0 && this._pending.length > 32) this._simStep();
  }

  _simStep() {
    const u = this.uniforms;
    const take = this._pending.splice(0, 16);
    u.uCount.value = take.length;
    for (let i = 0; i < take.length; i++) u.uImpulse.value[i].set(take[i][0], take[i][1], take[i][2], take[i][3]);
    if (this._pending.length > 200) this._pending.length = 0;

    u.uPrev.value = this.rtA.texture;
    u.uCur.value = this.rtB.texture;

    const prevRT = this.renderer.getRenderTarget();
    const prevAuto = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.renderer.setRenderTarget(this.rtC);
    this.renderer.render(this.simScene, this.simCam);
    this.renderer.setRenderTarget(prevRT);
    this.renderer.autoClear = prevAuto;

    const t = this.rtA; this.rtA = this.rtB; this.rtB = this.rtC; this.rtC = t;
    this.texture = this.rtB.texture;
  }

  setQuality(q) {
    this.enabled = !!q.waterRipples;
  }

  dispose() {
    this.rtA.dispose(); this.rtB.dispose(); this.rtC.dispose();
    this.mat.dispose(); this.quad.geometry.dispose();
  }
}

export default RippleSim;
