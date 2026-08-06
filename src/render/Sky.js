import * as THREE from 'three';
import { PALETTE } from '../core/Palette.js';

/**
 * There is no visible sky in the reference frame — only fog and the moon's glow.
 * So the "sky" is a fog-coloured dome with a vertical gradient, a hazy moon disc,
 * a large soft halo, and a brighter fog wedge beneath the moon.
 */

const SKY_FRAG = /* glsl */`
precision highp float;
uniform vec3  uFog;
uniform vec3  uFogHigh;
uniform vec3  uMoonColor;
uniform vec3  uMoonDir;
uniform float uMoonSize;
uniform float uTime;
varying vec3 vDir;

float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y);
}
float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){ v+=a*vnoise(p); p*=2.07; a*=0.5;} return v; }

void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);

  // base gradient: slightly darker overhead, brighter at the fog line
  vec3 col = mix(uFog * 0.94, uFogHigh, smoothstep(0.5, 0.98, h));
  col = mix(col * 1.02, col * 0.86, smoothstep(0.55, 1.0, h));

  // drifting haze bands so the sky is never dead flat
  vec2 hp = vec2(atan(d.z, d.x) * 1.6, d.y * 3.2);
  float haze = fbm(hp * 1.4 + vec2(uTime * 0.012, uTime * 0.005));
  col *= 0.93 + haze * 0.16;

  float cosA = dot(d, normalize(uMoonDir));

  // wide scattering bloom around the moon (this is what lights the fog)
  float glow = pow(clamp(cosA, 0.0, 1.0), 26.0);
  float wide = pow(clamp(cosA, 0.0, 1.0), 4.0);
  col += uMoonColor * (glow * 0.55 + wide * 0.13);

  // the disc itself, softened by haze
  float ang = acos(clamp(cosA, -1.0, 1.0));
  float disc = 1.0 - smoothstep(uMoonSize * 0.62, uMoonSize, ang);
  float rim  = 1.0 - smoothstep(uMoonSize, uMoonSize * 2.6, ang);
  // faint mare mottling on the disc
  vec2 mp = d.xz * 26.0;
  float mare = fbm(mp) * 0.16;
  col = mix(col, uMoonColor * (1.28 - mare), disc * 0.94);
  col += uMoonColor * rim * 0.14;

  gl_FragColor = vec4(col, 1.0);
}
`;

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // always at far plane
}
`;

export class Sky {
  constructor() {
    // The moon is high and slightly behind the boss — it crowns it (ART_TARGET §2).
    this.moonDir = new THREE.Vector3(0.06, 0.68, -0.73).normalize();

    this.uniforms = {
      uFog: { value: PALETTE.fog.clone() },
      uFogHigh: { value: PALETTE.fogDeep.clone().multiplyScalar(0.9) },
      uMoonColor: { value: PALETTE.moon.clone() },
      uMoonDir: { value: this.moonDir.clone() },
      uMoonSize: { value: 0.055 },
      uTime: { value: 0 },
    };

    const geo = new THREE.SphereGeometry(1, 40, 24);
    this.material = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      uniforms: this.uniforms, side: THREE.BackSide,
      depthWrite: false, depthTest: true, fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'sky';
    this.mesh.scale.setScalar(500);
  }

  addTo(scene) { scene.add(this.mesh); return this; }

  /** World-space position of the moon, for lens flare / god rays / light placement. */
  moonWorldPos(out = new THREE.Vector3()) { return out.copy(this.moonDir).multiplyScalar(400); }

  update(dt, elapsed, cameraPos) {
    this.uniforms.uTime.value = elapsed;
    if (cameraPos) this.mesh.position.copy(cameraPos);
  }

  dispose() { this.material.dispose(); this.mesh.geometry.dispose(); }
}

export default Sky;
