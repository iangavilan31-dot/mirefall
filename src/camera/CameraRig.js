import * as THREE from 'three';
import { settings } from '../core/Settings.js';
import { input } from '../core/Input.js';
import { bus, EVT } from '../core/EventBus.js';
import { SCALE } from '../core/Palette.js';

/**
 * Third-person camera. Keeps the reference frame's composition during gameplay:
 * the player sits LOW and LEFT-OF-CENTRE, the boss occupies the upper frame.
 * That is achieved with a shoulder offset plus a vertical framing bias that
 * grows when the boss is on screen.
 */
export class CameraRig {
  constructor(camera, target) {
    this.camera = camera;
    this.target = target;              // Object3D to follow (player root)
    this.yaw = Math.PI;                // start looking at the boss
    this.pitch = 0.14;
    this.distance = 6.4;
    this.desiredDistance = 6.4;
    this.minDistance = 2.4;
    this.maxDistance = 9.5;

    // composition: player low-left of frame
    this.shoulder = 0.85;
    this.heightOffset = 1.55;
    this.frameBias = 0.0;

    this.lockTarget = null;
    this.lockCandidates = [];
    this._lockBlend = 0;

    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this._smoothPos = new THREE.Vector3();
    this._smoothLook = new THREE.Vector3();
    this._initialised = false;

    this._shake = 0;
    this._shakeDecay = 1;
    this._shakeSeed = Math.random() * 100;
    this._trauma = 0;
    this._fovBase = settings.get('fov');
    this._fovOffset = 0;
    this._recoilOffset = new THREE.Vector3();

    this._raycaster = new THREE.Raycaster();
    // Sprites (lantern haloes) raycast against the camera and throw if it is unset.
    this._raycaster.camera = camera;
    this.collidables = [];

    bus.on(EVT.CAMERA_SHAKE, ({ amount = 0.4, duration = 0.4 }) => this.shake(amount, duration));
  }

  shake(amount, duration = 0.4) {
    const scaled = amount * settings.get('cameraShake');
    this._trauma = Math.min(1.2, this._trauma + scaled);
    this._shakeDecay = 1 / Math.max(0.08, duration);
  }

  punchFov(amount = 3.0, decay = 5.0) { this._fovOffset += amount; this._fovDecay = decay; }

  setLockCandidates(list) { this.lockCandidates = list; }

  toggleLock() {
    if (this.lockTarget) { this.lockTarget = null; return; }
    let best = null, bestScore = Infinity;
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    const origin = this.target.position;
    for (const c of this.lockCandidates) {
      if (!c || c.dead || !c.lockPoint) continue;
      const p = c.lockPoint();
      const d = p.distanceTo(origin);
      if (d > 60) continue;
      const to = p.clone().sub(origin).normalize();
      const align = 1 - to.dot(camDir);
      const score = d * 0.05 + align * 3.0;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    this.lockTarget = best;
    if (best) bus.emit(EVT.SFX, { id: 'lockOn', gain: 0.5 });
  }

  update(dt, elapsed) {
    const t = this.target;
    if (!t) return;

    // ---- input look ----
    if (!this.lockTarget) {
      this.yaw -= input.look.x;
      this.pitch = THREE.MathUtils.clamp(this.pitch + input.look.y, -0.55, 0.92);
    } else {
      // soft look control while locked (lets the player peek)
      this.yaw -= input.look.x * 0.25;
      this.pitch = THREE.MathUtils.clamp(this.pitch + input.look.y * 0.35, -0.35, 0.85);
    }
    if (input.wheel) this.desiredDistance = THREE.MathUtils.clamp(this.desiredDistance + input.wheel * 0.6, this.minDistance, this.maxDistance);

    // ---- lock-on framing ----
    let lookTargetPoint = null;
    if (this.lockTarget && !this.lockTarget.dead) {
      const lp = this.lockTarget.lockPoint();
      const toT = new THREE.Vector3().subVectors(lp, t.position);
      const desiredYaw = Math.atan2(-toT.x, -toT.z);
      this.yaw = dampAngle(this.yaw, desiredYaw, 7.0, dt);
      // frame both the player and the target: aim between them, biased to the target
      const mid = lp.clone().lerp(t.position, 0.42);
      lookTargetPoint = mid;
      // pull back so a huge target fits
      const size = this.lockTarget.lockRadius ? this.lockTarget.lockRadius() : 2;
      this.desiredDistance = THREE.MathUtils.clamp(5.6 + size * 0.20, this.minDistance, 13.5);
      const height = lp.y - t.position.y;
      const desiredPitch = THREE.MathUtils.clamp(Math.atan2(height, toT.length()) * 0.55 - 0.03, -0.3, 0.78);
      this.pitch = THREE.MathUtils.damp(this.pitch, desiredPitch, 5.0, dt);
      this._lockBlend = THREE.MathUtils.damp(this._lockBlend, 1, 8, dt);
    } else {
      if (this.lockTarget && this.lockTarget.dead) this.lockTarget = null;
      this._lockBlend = THREE.MathUtils.damp(this._lockBlend, 0, 8, dt);
      this.desiredDistance = THREE.MathUtils.damp(this.desiredDistance, 6.4, 3.0, dt);
    }

    this.distance = THREE.MathUtils.damp(this.distance, this.desiredDistance, 6.0, dt);

    // ---- ideal position ----
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dir = new THREE.Vector3(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp);
    const focus = new THREE.Vector3(t.position.x, t.position.y + this.heightOffset, t.position.z);

    // shoulder offset pushes the player left-of-centre in frame (ART_TARGET §2)
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    focus.addScaledVector(right, this.shoulder * (1 - this._lockBlend * 0.45));

    this.pos.copy(focus).addScaledVector(dir, this.distance);
    // keep the camera above the waterline — never dip under
    this.pos.y = Math.max(this.pos.y, SCALE.waterLevel + 0.75);

    this.look.copy(lookTargetPoint || focus);
    // bias the look point down so the player sits low and the sky/boss fills the top
    this.look.y -= 0.16 + this._lockBlend * 0.05;

    if (!this._initialised) { this._smoothPos.copy(this.pos); this._smoothLook.copy(this.look); this._initialised = true; }

    // critically-damped follow; snappier laterally than vertically for weight
    this._smoothPos.x = THREE.MathUtils.damp(this._smoothPos.x, this.pos.x, 11, dt);
    this._smoothPos.z = THREE.MathUtils.damp(this._smoothPos.z, this.pos.z, 11, dt);
    this._smoothPos.y = THREE.MathUtils.damp(this._smoothPos.y, this.pos.y, 7, dt);
    this._smoothLook.lerp(this.look, 1 - Math.exp(-14 * dt));

    // ---- collision: pull in if something blocks the view ----
    const resolved = this._resolveCollision(focus, this._smoothPos);

    // ---- shake ----
    this._trauma = Math.max(0, this._trauma - dt * this._shakeDecay);
    const s = this._trauma * this._trauma;
    if (s > 0.0001) {
      const tt = elapsed * 34 + this._shakeSeed;
      resolved.x += (noise1(tt) - 0.5) * s * 0.55;
      resolved.y += (noise1(tt + 31.7) - 0.5) * s * 0.42;
      resolved.z += (noise1(tt + 77.3) - 0.5) * s * 0.55;
    }

    this.camera.position.copy(resolved);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this._smoothLook);
    if (s > 0.0001) this.camera.rotateZ((noise1(elapsed * 27 + 5.1) - 0.5) * s * 0.09);

    // ---- fov ----
    this._fovOffset = THREE.MathUtils.damp(this._fovOffset, 0, this._fovDecay || 5.0, dt);
    const speedFov = this.target.userData?.speed01 ? this.target.userData.speed01 * 2.2 : 0;
    const fov = this._fovBase + this._fovOffset + speedFov;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }

  _resolveCollision(focus, want) {
    if (!this.collidables.length) return want.clone();
    const dir = new THREE.Vector3().subVectors(want, focus);
    const len = dir.length();
    if (len < 0.01) return want.clone();
    dir.divideScalar(len);
    this._raycaster.set(focus, dir);
    this._raycaster.far = len + 0.4;
    this._raycaster.camera = this.camera;
    const hits = this._raycaster.intersectObjects(this.collidables, true);
    // ignore sprites/points/transparent drapery — only solid geometry should push the camera in
    const hit = hits.find((h) => h.object.isMesh && !h.object.material?.transparent);
    if (hit) {
      const d = Math.max(this.minDistance * 0.6, hit.distance - 0.45);
      return focus.clone().addScaledVector(dir, d);
    }
    return want.clone();
  }

  /** Framing used by tools/capture.js for repeatable shots. */
  applyPreset(preset) {
    if (preset.yaw !== undefined) this.yaw = preset.yaw;
    if (preset.pitch !== undefined) this.pitch = preset.pitch;
    if (preset.distance !== undefined) { this.distance = preset.distance; this.desiredDistance = preset.distance; }
    if (preset.shoulder !== undefined) this.shoulder = preset.shoulder;
    if (preset.heightOffset !== undefined) this.heightOffset = preset.heightOffset;
    this._initialised = false;
  }
}

function dampAngle(cur, target, lambda, dt) {
  let d = ((target - cur + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return cur + d * (1 - Math.exp(-lambda * dt));
}
function noise1(x) {
  const s = Math.sin(x * 12.9898) * 43758.5453;
  const f = s - Math.floor(s);
  const s2 = Math.sin(x * 3.233 + 1.7) * 21387.1;
  return (f + (s2 - Math.floor(s2))) * 0.5;
}

export default CameraRig;
