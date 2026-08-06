import * as THREE from 'three';
import { PALETTE, SCALE } from '../core/Palette.js';
import { settings } from '../core/Settings.js';
import { bus } from '../core/EventBus.js';

/**
 * One key light (the moon) and a pool of tiny warm lantern points.
 *
 * ART_TARGET §4: lanterns are NOT scene lights. They are self-luminous with a ~3 m falloff.
 * They must never warm the fog or the player. Enforced by low intensity + short distance.
 */
export class Lighting {
  constructor(scene, sky) {
    this.scene = scene;
    this.sky = sky;

    // --- moon key ---
    this.moon = new THREE.DirectionalLight(PALETTE.moonLight.getHex(), 1.85);
    this.moon.color.copy(PALETTE.moonLight);
    this.moon.position.copy(sky.moonDir).multiplyScalar(110);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(settings.q.shadowMap, settings.q.shadowMap);
    this.moon.shadow.camera.near = 20;
    this.moon.shadow.camera.far = 240;
    const ext = 46;
    this.moon.shadow.camera.left = -ext;
    this.moon.shadow.camera.right = ext;
    this.moon.shadow.camera.top = ext;
    this.moon.shadow.camera.bottom = -ext;
    this.moon.shadow.bias = -0.0009;
    this.moon.shadow.normalBias = 0.05;
    this.moon.shadow.radius = 2.4;
    this.moonTarget = new THREE.Object3D();
    scene.add(this.moonTarget);
    this.moon.target = this.moonTarget;
    scene.add(this.moon);

    // --- ambient: sky-to-water bounce, cold above, murky below ---
    this.hemi = new THREE.HemisphereLight(
      PALETTE.fogMoonlit.getHex(), PALETTE.waterDark.getHex(), 0.72
    );
    this.hemi.color.copy(PALETTE.fogMoonlit);
    this.hemi.groundColor.copy(PALETTE.waterDark);
    scene.add(this.hemi);

    // A very dim cold fill from the opposite side so silhouettes never go pure black.
    this.fill = new THREE.DirectionalLight(PALETTE.fog.getHex(), 0.18);
    this.fill.color.copy(PALETTE.fog);
    this.fill.position.set(-0.6, 0.35, 0.7).multiplyScalar(60);
    scene.add(this.fill);

    // --- lantern pool ---
    this.lanterns = [];
    this._lanternDefs = [];
    this._maxLights = settings.q.maxLights;

    // Boss eye glow, attached later by the boss.
    this.eyeLight = new THREE.PointLight(PALETTE.bossEye.getHex(), 0, 34, 2);
    this.eyeLight.color.copy(PALETTE.bossEye);
    scene.add(this.eyeLight);

    bus.on('engine:quality', (q) => {
      this.moon.castShadow = q.shadows;
      this.moon.shadow.mapSize.set(q.shadowMap, q.shadowMap);
      if (this.moon.shadow.map) { this.moon.shadow.map.dispose(); this.moon.shadow.map = null; }
      this._maxLights = q.maxLights;
      this._rebuildLanterns();
    });
  }

  /** Register a lantern position; only the nearest N get a real light. */
  registerLantern(pos, intensity = 1.0) {
    this._lanternDefs.push({ pos: pos.clone(), intensity, phase: Math.random() * 100 });
  }

  _rebuildLanterns() {
    for (const l of this.lanterns) this.scene.remove(l);
    this.lanterns.length = 0;
    const n = Math.max(0, Math.min(this._maxLights - 2, 12));
    for (let i = 0; i < n; i++) {
      const p = new THREE.PointLight(PALETTE.lantern.getHex(), 0, 4.2, 2.2);
      p.color.copy(PALETTE.lantern);
      p.castShadow = false;
      this.scene.add(p);
      this.lanterns.push(p);
    }
  }

  /** Keeps the shadow frustum tight around the player and assigns lantern lights by proximity. */
  update(dt, elapsed, focus) {
    if (focus) {
      this.moonTarget.position.copy(focus);
      this.moon.position.copy(this.sky.moonDir).multiplyScalar(110).add(focus);
      this.moon.shadow.camera.updateProjectionMatrix?.();
    }

    if (this.lanterns.length === 0) this._rebuildLanterns();

    // nearest-N assignment
    if (this._lanternDefs.length && focus) {
      if (!this._sorted || this._sortAge > 0.35) {
        this._lanternDefs.sort((a, b) => a.pos.distanceToSquared(focus) - b.pos.distanceToSquared(focus));
        this._sorted = true; this._sortAge = 0;
      }
      this._sortAge = (this._sortAge || 0) + dt;
      for (let i = 0; i < this.lanterns.length; i++) {
        const def = this._lanternDefs[i];
        const L = this.lanterns[i];
        if (!def || def.pos.distanceTo(focus) > 26) { L.intensity = 0; continue; }
        L.position.copy(def.pos);
        // slow candle breathing + rare flicker
        const t = elapsed * 1.7 + def.phase;
        const breathe = 0.82 + 0.18 * Math.sin(t) * Math.sin(t * 0.37 + 1.1);
        const flick = Math.sin(t * 9.3) * Math.sin(t * 3.1) > 0.93 ? 0.62 : 1.0;
        L.intensity = def.intensity * 2.1 * breathe * flick;
      }
    }
  }
}

export default Lighting;
