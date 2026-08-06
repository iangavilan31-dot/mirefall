import { settings } from './Settings.js';

/**
 * Unified keyboard + mouse + gamepad input.
 * Consumers read the resolved action state; they never touch raw events.
 *
 *   input.move        -> {x,y} normalised, deadzoned
 *   input.look        -> {x,y} per-frame delta (already sensitivity-scaled)
 *   input.pressed(a)  -> edge (true for exactly one frame)
 *   input.down(a)     -> held
 *   input.released(a) -> edge
 *   input.heldTime(a) -> seconds held
 */

export const ACTIONS = {
  light:   { keys: ['Mouse0'],       pad: ['RT', 'X'] },
  heavy:   { keys: ['Mouse2'],       pad: ['RB', 'Y'] },
  dodge:   { keys: ['Space'],        pad: ['A', 'LB'] },
  sprint:  { keys: ['ShiftLeft'],    pad: ['LT'] },
  heal:    { keys: ['KeyQ', 'KeyR'], pad: ['B'] },
  lockOn:  { keys: ['KeyF', 'Mouse1'], pad: ['R3'] },
  interact:{ keys: ['KeyE'],         pad: ['X'] },
  pause:   { keys: ['Escape'],       pad: ['Start'] },
  map:     { keys: ['Tab'],          pad: ['Back'] },
};

const PAD_BUTTON_INDEX = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7,
  Back: 8, Start: 9, L3: 10, R3: 11,
  Up: 12, Down: 13, Left: 14, Right: 15,
};

class Input {
  constructor() {
    this.keys = new Set();
    this.prevKeys = new Set();
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this._rawLook = { x: 0, y: 0 };
    this.pointerLocked = false;
    this.gamepadIndex = null;
    this.usingPad = false;
    this.lastInputKind = 'kbm';
    this._held = new Map();
    this._padPrev = new Set();
    this._padNow = new Set();
    this._padAxes = [0, 0, 0, 0];
    this._enabled = true;
    this._wheel = 0;
    this.triggerL = 0;
    this.triggerR = 0;
  }

  attach(canvas) {
    this.canvas = canvas;
    const kd = (e) => {
      if (e.code === 'Tab') e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.lastInputKind = 'kbm'; this.usingPad = false;
    };
    const ku = (e) => this.keys.delete(e.code);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', () => { this.keys.clear(); this._held.clear(); });

    canvas.addEventListener('mousedown', (e) => {
      this.keys.add('Mouse' + e.button);
      this.lastInputKind = 'kbm'; this.usingPad = false;
      if (!this.pointerLocked && this._enabled && this.requestLockOnClick) this.requestPointerLock();
    });
    window.addEventListener('mouseup', (e) => this.keys.delete('Mouse' + e.button));
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this._rawLook.x += e.movementX;
      this._rawLook.y += e.movementY;
      this.lastInputKind = 'kbm'; this.usingPad = false;
    });
    window.addEventListener('wheel', (e) => { this._wheel += Math.sign(e.deltaY); }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });

    window.addEventListener('gamepadconnected', (e) => { this.gamepadIndex = e.gamepad.index; });
    window.addEventListener('gamepaddisconnected', () => { this.gamepadIndex = null; this.usingPad = false; });
    this.requestLockOnClick = true;
  }

  requestPointerLock() {
    if (!this.canvas) return;
    const p = this.canvas.requestPointerLock?.({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => this.canvas.requestPointerLock());
  }
  exitPointerLock() { if (document.pointerLockElement) document.exitPointerLock(); }
  setEnabled(v) { this._enabled = v; }

  _pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    if (this.gamepadIndex != null && pads[this.gamepadIndex]) pad = pads[this.gamepadIndex];
    else for (const p of pads) if (p && p.connected) { pad = p; this.gamepadIndex = p.index; break; }
    this._padPrev = this._padNow;
    this._padNow = new Set();
    if (!pad) { this._padAxes = [0, 0, 0, 0]; this.triggerL = this.triggerR = 0; return; }

    for (const [name, idx] of Object.entries(PAD_BUTTON_INDEX)) {
      const b = pad.buttons[idx];
      if (b && (b.pressed || b.value > 0.55)) this._padNow.add(name);
    }
    this.triggerL = pad.buttons[6] ? pad.buttons[6].value : 0;
    this.triggerR = pad.buttons[7] ? pad.buttons[7].value : 0;
    this._padAxes = [pad.axes[0] || 0, pad.axes[1] || 0, pad.axes[2] || 0, pad.axes[3] || 0];

    const active = this._padNow.size > 0 || this._padAxes.some((a) => Math.abs(a) > 0.22);
    if (active) { this.usingPad = true; this.lastInputKind = 'pad'; }
  }

  static _dz(v, dz = 0.18) {
    const a = Math.abs(v);
    if (a < dz) return 0;
    return Math.sign(v) * ((a - dz) / (1 - dz)) ** 1.6;
  }

  update(dt) {
    this._pollPad();
    this.prevKeys = new Set(this.keys);

    // ---- move ----
    let mx = 0, my = 0;
    if (this._enabled) {
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my -= 1;
      const px = Input._dz(this._padAxes[0]);
      const py = Input._dz(this._padAxes[1]);
      if (px || py) { mx = px; my = -py; }
    }
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    this.move.x = mx; this.move.y = my;
    this.moveMag = Math.min(1, Math.hypot(mx, my));

    // ---- look ----
    const sens = settings.get('mouseSensitivity');
    const psens = settings.get('padSensitivity');
    let lx = this._rawLook.x * 0.0022 * sens;
    let ly = this._rawLook.y * 0.0022 * sens;
    this._rawLook.x = 0; this._rawLook.y = 0;
    const rx = Input._dz(this._padAxes[2], 0.16);
    const ry = Input._dz(this._padAxes[3], 0.16);
    if (rx || ry) { lx += rx * 2.6 * psens * dt * 60 * 0.0166; ly += ry * 2.6 * psens * dt * 60 * 0.0166; }
    if (settings.get('invertX')) lx = -lx;
    if (settings.get('invertY')) ly = -ly;
    this.look.x = this._enabled ? lx : 0;
    this.look.y = this._enabled ? ly : 0;

    this.wheel = this._wheel; this._wheel = 0;

    // ---- held timers ----
    for (const a of Object.keys(ACTIONS)) {
      if (this.down(a)) this._held.set(a, (this._held.get(a) || 0) + dt);
      else if (!this.released(a)) this._held.set(a, 0);
    }
  }

  /** Call at the very end of a frame so edge detection works. */
  postUpdate() { this._prevSnapshot = new Set([...this.keys, ...Array.from(this._padNow, (b) => 'pad:' + b)]); }

  _actionSources(a) {
    const def = ACTIONS[a];
    if (!def) return { keys: [], pad: [] };
    return def;
  }
  down(a) {
    if (!this._enabled) return false;
    const { keys, pad } = this._actionSources(a);
    for (const k of keys) if (this.keys.has(k)) return true;
    for (const b of pad) if (this._padNow.has(b)) return true;
    if (a === 'light' && this.triggerR > 0.6) return true;
    if (a === 'sprint' && this.triggerL > 0.5) return true;
    return false;
  }
  pressed(a) {
    if (!this._enabled) return false;
    const { keys, pad } = this._actionSources(a);
    const prev = this._prevSnapshot || new Set();
    for (const k of keys) if (this.keys.has(k) && !prev.has(k)) return true;
    for (const b of pad) if (this._padNow.has(b) && !prev.has('pad:' + b)) return true;
    return false;
  }
  released(a) {
    const { keys, pad } = this._actionSources(a);
    const prev = this._prevSnapshot || new Set();
    for (const k of keys) if (!this.keys.has(k) && prev.has(k)) return true;
    for (const b of pad) if (!this._padNow.has(b) && prev.has('pad:' + b)) return true;
    return false;
  }
  heldTime(a) { return this._held.get(a) || 0; }

  rumble(strong = 0.5, weak = 0.3, ms = 120) {
    if (!settings.get('vibration')) return;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = this.gamepadIndex != null ? pads[this.gamepadIndex] : null;
    if (pad && pad.vibrationActuator) {
      pad.vibrationActuator.playEffect('dual-rumble', {
        duration: ms, strongMagnitude: strong, weakMagnitude: weak, startDelay: 0,
      }).catch(() => {});
    }
  }
}

export const input = new Input();
export default input;
