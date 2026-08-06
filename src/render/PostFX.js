import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { PALETTE } from '../core/Palette.js';
import { settings } from '../core/Settings.js';
import { bus } from '../core/EventBus.js';

/**
 * Grade pass — vignette, film grain, chromatic aberration, subtle bleach/desaturation,
 * damage vignette, and a cheap radial god-ray streak from the moon.
 * All of it in one full-screen pass to keep bandwidth down.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uVignette: { value: 1.0 },
    uGrain: { value: 1.0 },
    uAberration: { value: 1.0 },
    uDamage: { value: 0.0 },       // red-edge pulse when hurt
    uHeal: { value: 0.0 },
    uFlash: { value: 0.0 },        // white impact flash
    uFade: { value: 0.0 },         // 0 = visible, 1 = black (state transitions)
    uFadeColor: { value: new THREE.Color(0x000000) },
    uMoonScreen: { value: new THREE.Vector2(0.5, 0.9) },
    uGodrays: { value: 0.0 },
    uDesat: { value: 0.12 },
    uLift: { value: new THREE.Vector3(0.012, 0.016, 0.020) },
    uContrast: { value: 1.055 },
    uDangerPulse: { value: 0.0 },  // boss telegraph screen cue
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uAberration, uDamage, uHeal, uFlash, uFade;
    uniform float uGodrays, uDesat, uContrast, uDangerPulse;
    uniform vec2 uResolution, uMoonScreen;
    uniform vec3 uLift, uFadeColor;
    varying vec2 vUv;

    float hash(vec2 p){ p = fract(p*vec2(443.897,441.423)); p += dot(p,p+19.19); return fract(p.x*p.y); }

    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c,c);

      // chromatic aberration grows toward the edges
      float ab = uAberration * (0.0016 + r2 * 0.0052);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ab).b;

      // ---- god rays: radial streak from the moon ----
      if (uGodrays > 0.001) {
        vec2 dir = (uMoonScreen - uv);
        vec3 acc = vec3(0.0);
        float w = 1.0;
        float total = 0.0;
        for (int i = 0; i < 14; i++) {
          float f = float(i) / 13.0;
          vec2 s = uv + dir * f * 0.55;
          vec3 t = texture2D(tDiffuse, s).rgb;
          float lum = max(t.r, max(t.g, t.b));
          float bright = smoothstep(0.55, 1.5, lum);
          acc += t * bright * w;
          total += w;
          w *= 0.88;
        }
        acc /= max(total, 0.001);
        float falloff = 1.0 - smoothstep(0.0, 0.95, length(dir));
        col += acc * uGodrays * falloff * 0.55;
      }

      // ---- grade ----
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, vec3(lum), uDesat);
      col = (col - 0.5) * uContrast + 0.5;
      col += uLift * (1.0 - lum);
      // cold shadows, neutral highlights — the wet, moonlit look
      col.b += (1.0 - lum) * 0.020;
      col.r -= (1.0 - lum) * 0.008;

      // ---- vignette ----
      float vig = smoothstep(0.92, 0.18, r2 * 1.9);
      col *= mix(1.0, vig, uVignette * 0.82);

      // ---- combat feedback ----
      if (uDamage > 0.001) {
        float edge = smoothstep(0.06, 0.42, r2);
        col = mix(col, vec3(0.44, 0.055, 0.045), edge * uDamage * 0.82);
        col *= 1.0 - uDamage * 0.10;
      }
      if (uHeal > 0.001) {
        float edge = smoothstep(0.10, 0.45, r2);
        col = mix(col, vec3(0.30, 0.52, 0.44), edge * uHeal * 0.42);
      }
      if (uDangerPulse > 0.001) {
        float edge = smoothstep(0.10, 0.50, r2);
        col = mix(col, vec3(0.50, 0.54, 0.14), edge * uDangerPulse * 0.30);
      }
      col += uFlash * 0.85;

      // ---- grain ----
      float g = hash(uv * uResolution + fract(uTime) * 91.7) - 0.5;
      col += g * 0.030 * uGrain * (1.25 - lum * 0.75);

      col = mix(col, uFadeColor, clamp(uFade, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/** Cheap depth-of-field: blurs only the far field, keeping the near/mid crisp. */
const DofShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uNear: { value: 0.15 },
    uFar: { value: 900 },
    uFocus: { value: 12.0 },
    uRange: { value: 42.0 },
    uStrength: { value: 1.0 },
  },
  vertexShader: GradeShader.vertexShader,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse, tDepth;
    uniform vec2 uResolution;
    uniform float uNear, uFar, uFocus, uRange, uStrength;
    varying vec2 vUv;

    float linearDepth(vec2 uv){
      float z = texture2D(tDepth, uv).x;
      float ndc = z * 2.0 - 1.0;
      return (2.0 * uNear * uFar) / (uFar + uNear - ndc * (uFar - uNear));
    }
    void main(){
      float d = linearDepth(vUv);
      float coc = clamp((d - uFocus) / uRange, 0.0, 1.0);
      coc = pow(coc, 1.4) * uStrength;
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      if (coc > 0.006) {
        vec2 px = (1.0 / uResolution) * coc * 5.0;
        vec3 acc = col;
        float w = 1.0;
        // 8-tap poisson-ish ring
        const vec2 K[8] = vec2[8](
          vec2( 0.94, 0.34), vec2(-0.94, 0.34), vec2( 0.34, 0.94), vec2(-0.34,-0.94),
          vec2( 0.66,-0.75), vec2(-0.66, 0.75), vec2( 0.15,-0.99), vec2(-0.15, 0.99));
        for (int i = 0; i < 8; i++) {
          acc += texture2D(tDiffuse, vUv + K[i] * px).rgb;
          w += 1.0;
        }
        col = acc / w;
      }
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostFX {
  constructor(engine, sky) {
    this.engine = engine;
    this.sky = sky;
    this.renderer = engine.renderer;
    this._moonNdc = new THREE.Vector3();
    this._build();
    bus.on('engine:resize', () => this.resize());
    bus.on('engine:quality', () => this.rebuild());
  }

  _build() {
    const { renderer, scene, camera, width, height } = this.engine;
    const q = settings.q;
    const dpr = renderer.getPixelRatio();

    const rt = new THREE.WebGLRenderTarget(
      Math.floor(width * dpr), Math.floor(height * dpr),
      { type: THREE.HalfFloatType, samples: 0, depthTexture: new THREE.DepthTexture(Math.floor(width * dpr), Math.floor(height * dpr)) }
    );
    this.composer = new EffectComposer(renderer, rt);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(width, height);

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    if (q.dof) {
      this.dof = new ShaderPass(DofShader);
      this.dof.uniforms.tDepth.value = rt.depthTexture;
      this.dof.uniforms.uNear.value = camera.near;
      this.dof.uniforms.uFar.value = camera.far;
      this.composer.addPass(this.dof);
    }

    if (q.bloom) {
      this.bloom = new UnrealBloomPass(
        new THREE.Vector2(width, height), q.bloomStrength, 0.72, 0.72
      );
      this.composer.addPass(this.bloom);
    }

    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.uGrain.value = settings.get('grainAmount');
    this.grade.uniforms.uGodrays.value = q.godrays ? 0.85 : 0.0;
    this.composer.addPass(this.grade);

    if (q.smaa) {
      this.smaa = new SMAAPass(width * dpr, height * dpr);
      this.composer.addPass(this.smaa);
    }

    this.output = new OutputPass();
    this.composer.addPass(this.output);

    this._rt = rt;
    this.resize();
  }

  rebuild() {
    this.composer?.dispose?.();
    this._rt?.dispose?.();
    this.dof = this.bloom = this.grade = this.smaa = null;
    this._build();
  }

  resize() {
    const { width, height, renderer } = this.engine;
    const dpr = renderer.getPixelRatio();
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(width, height);
    const w = Math.floor(width * dpr), h = Math.floor(height * dpr);
    if (this._rt?.depthTexture) { this._rt.depthTexture.image.width = w; this._rt.depthTexture.image.height = h; this._rt.depthTexture.needsUpdate = true; }
    this.grade?.uniforms.uResolution.value.set(w, h);
    if (this.dof) this.dof.uniforms.uResolution.value.set(w, h);
    this.bloom?.setSize(width, height);
  }

  // --- transient effect API used by combat / state machine ---
  flash(amount = 0.35, decay = 4.0) { this._flash = Math.max(this._flash || 0, amount); this._flashDecay = decay; }
  damage(amount = 1.0) { this._damage = Math.min(1.4, (this._damage || 0) + amount); }
  heal(amount = 1.0) { this._heal = Math.min(1.0, (this._heal || 0) + amount); }
  danger(amount = 1.0) { this._danger = Math.max(this._danger || 0, amount); }
  setFade(v, color = 0x000000) {
    this.grade.uniforms.uFade.value = v;
    this.grade.uniforms.uFadeColor.value.set(color);
  }
  setFocus(dist) { if (this.dof) this.dof.uniforms.uFocus.value = dist; }

  update(dt, elapsed, camera) {
    const g = this.grade.uniforms;
    g.uTime.value = elapsed;
    g.uGrain.value = settings.get('grainAmount');
    g.uVignette.value = 1.0;

    this._flash = Math.max(0, (this._flash || 0) - dt * (this._flashDecay || 4.0));
    this._damage = Math.max(0, (this._damage || 0) - dt * 1.9);
    this._heal = Math.max(0, (this._heal || 0) - dt * 1.3);
    this._danger = Math.max(0, (this._danger || 0) - dt * 2.4);

    const flashScale = settings.get('screenFlash');
    g.uFlash.value = this._flash * flashScale;
    g.uDamage.value = Math.min(1, this._damage) * (0.45 + 0.55 * flashScale);
    g.uHeal.value = this._heal;
    g.uDangerPulse.value = this._danger * flashScale;

    // moon position in screen space for the god-ray origin
    if (this.sky) {
      this._moonNdc.copy(this.sky.moonDir).multiplyScalar(400).add(camera.position).project(camera);
      const behind = this._moonNdc.z > 1;
      g.uMoonScreen.value.set(this._moonNdc.x * 0.5 + 0.5, this._moonNdc.y * 0.5 + 0.5);
      const off = Math.max(Math.abs(this._moonNdc.x), Math.abs(this._moonNdc.y));
      const vis = behind ? 0 : (1 - THREE.MathUtils.smoothstep(off, 0.85, 1.9));
      g.uGodrays.value = (settings.q.godrays ? 0.9 : 0.0) * vis;
    }
  }

  render() { this.composer.render(); }
}

export default PostFX;
