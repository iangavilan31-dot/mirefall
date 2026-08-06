import { bus, EVT } from '../core/EventBus.js';
import { settings } from '../core/Settings.js';

/**
 * Fully procedural audio — no sample assets. Everything is synthesised in WebAudio:
 * an ambient bed (wind, water, insects, distant creaks), an adaptive score, and
 * a small SFX synthesis library.
 */
export class Audio {
  constructor() {
    this.ready = false;
    this.ctx = null;
    this.listenerPos = { x: 0, y: 0, z: 0 };
    this._musicCue = 'none';
    this._noiseBuf = null;
    this._pending = [];
    bus.on(EVT.SFX, (e) => this.sfx(e.id, e.pos, e.gain, e.rate));
    bus.on(EVT.MUSIC, (e) => this.music(e.cue));
    bus.on(EVT.SETTINGS_CHANGE, () => this._applyVolumes());
  }

  /** Must be called from a user gesture. */
  async init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC({ latencyHint: 'interactive' });
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);

    // gentle bus compression so combat never clips the ambience
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.knee.value = 22;
    this.comp.ratio.value = 3.2;
    this.comp.attack.value = 0.005;
    this.comp.release.value = 0.22;
    this.comp.connect(this.master);

    this.busMusic = ctx.createGain(); this.busMusic.connect(this.comp);
    this.busSfx = ctx.createGain(); this.busSfx.connect(this.comp);
    this.busAmb = ctx.createGain(); this.busAmb.connect(this.comp);

    // a shared plate-ish reverb for space
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(3.4, 2.6);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.32;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.comp);

    this._noiseBuf = this._makeNoise(4);
    this._applyVolumes();
    this._startAmbience();
    this.ready = true;
    for (const p of this._pending) this.sfx(...p);
    this._pending.length = 0;
    if (this._musicCue !== 'none') this.music(this._musicCue, true);
  }

  _applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(settings.get('master'), t, 0.05);
    this.busMusic.gain.setTargetAtTime(settings.get('music'), t, 0.1);
    this.busSfx.gain.setTargetAtTime(settings.get('sfx'), t, 0.05);
    this.busAmb.gain.setTargetAtTime(settings.get('ambience'), t, 0.15);
  }

  _makeNoise(seconds) {
    const n = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _makeImpulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const n = rate * seconds;
    const buf = this.ctx.createBuffer(2, n, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (1 - t * 0.2);
      }
    }
    return buf;
  }

  _noiseSource(loop = true) {
    const s = this.ctx.createBufferSource();
    s.buffer = this._noiseBuf;
    s.loop = loop;
    return s;
  }

  // ------------------------------------------------------------- ambience --
  _startAmbience() {
    const ctx = this.ctx;
    // --- wind: filtered noise with a slowly wandering band ---
    const wind = this._noiseSource();
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 420;
    windFilter.Q.value = 0.7;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.10;
    wind.connect(windFilter); windFilter.connect(windGain); windGain.connect(this.busAmb);
    windGain.connect(this.reverb);
    wind.start();
    this._wind = { gain: windGain, filter: windFilter };

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.055;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 240;
    lfo.connect(lfoGain); lfoGain.connect(windFilter.frequency);
    lfo.start();

    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.031;
    const lfo2g = ctx.createGain();
    lfo2g.gain.value = 0.05;
    lfo2.connect(lfo2g); lfo2g.connect(windGain.gain);
    lfo2.start();

    // --- water lapping: low-passed noise, amplitude modulated ---
    const water = this._noiseSource();
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass'; wf.frequency.value = 340; wf.Q.value = 0.4;
    const wg = ctx.createGain(); wg.gain.value = 0.075;
    water.connect(wf); wf.connect(wg); wg.connect(this.busAmb);
    water.start();
    const wlfo = ctx.createOscillator(); wlfo.frequency.value = 0.19;
    const wlg = ctx.createGain(); wlg.gain.value = 0.035;
    wlfo.connect(wlg); wlg.connect(wg.gain); wlfo.start();

    // --- deep sub drone: the mire breathing ---
    const drone = ctx.createOscillator();
    drone.type = 'sine'; drone.frequency.value = 38.9;
    const dg = ctx.createGain(); dg.gain.value = 0.11;
    drone.connect(dg); dg.connect(this.busAmb); drone.start();
    const drone2 = ctx.createOscillator();
    drone2.type = 'triangle'; drone2.frequency.value = 58.3;
    const dg2 = ctx.createGain(); dg2.gain.value = 0.035;
    drone2.connect(dg2); dg2.connect(this.busAmb); drone2.start();
    this._drone = { osc: drone, gain: dg, osc2: drone2, gain2: dg2 };

    // --- sparse insect / frog chirps and distant timber creaks ---
    this._chirpTimer = 0;
    this._creakTimer = 0;
  }

  /** Occasional one-shot ambience events. Called from update. */
  _ambienceTick(dt) {
    this._chirpTimer -= dt;
    if (this._chirpTimer <= 0) {
      this._chirpTimer = 1.4 + Math.random() * 4.5;
      this._chirp();
    }
    this._creakTimer -= dt;
    if (this._creakTimer <= 0) {
      this._creakTimer = 7 + Math.random() * 16;
      this._creak();
    }
  }

  _chirp() {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = Math.random() < 0.5 ? 'sine' : 'triangle';
    const base = 900 + Math.random() * 1800;
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * (0.7 + Math.random() * 0.6), t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.018 + Math.random() * 0.02, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09 + Math.random() * 0.14);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    o.connect(g); g.connect(pan); pan.connect(this.busAmb); pan.connect(this.reverb);
    o.start(t); o.stop(t + 0.4);
  }

  _creak() {
    const ctx = this.ctx, t = ctx.currentTime;
    const s = this._noiseSource(false);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(180 + Math.random() * 200, t);
    f.frequency.linearRampToValueAtTime(90 + Math.random() * 120, t + 1.2);
    f.Q.value = 9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.045, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    s.connect(f); f.connect(g); g.connect(pan); pan.connect(this.busAmb); pan.connect(this.reverb);
    s.start(t); s.stop(t + 1.6);
  }

  // ---------------------------------------------------------------- music --
  music(cue, force = false) {
    if (cue === this._musicCue && !force) return;
    this._musicCue = cue;
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;

    if (this._musicNodes) {
      for (const n of this._musicNodes) {
        try { n.gain?.gain.setTargetAtTime(0, t, 0.6); } catch {}
        try { setTimeout(() => n.osc?.stop(), 2200); } catch {}
      }
    }
    this._musicNodes = [];
    if (cue === 'none' || cue === 'silence') return;

    const CUES = {
      menu:    { root: 55.0, voices: [1, 1.5, 2, 3], gain: 0.055, wob: 0.03, type: 'sine' },
      explore: { root: 49.0, voices: [1, 1.5, 2.02], gain: 0.045, wob: 0.02, type: 'sine' },
      phase1:  { root: 55.0, voices: [1, 1.5, 2, 2.99], gain: 0.075, wob: 0.05, type: 'sawtooth' },
      phase2:  { root: 58.3, voices: [1, 1.19, 1.5, 2, 3], gain: 0.085, wob: 0.08, type: 'sawtooth' },
      phase3:  { root: 61.7, voices: [1, 1.12, 1.5, 2, 2.38, 3], gain: 0.10, wob: 0.14, type: 'sawtooth' },
      danger:  { root: 61.7, voices: [1, 1.06, 1.41], gain: 0.13, wob: 0.3, type: 'square' },
      victory: { root: 65.4, voices: [1, 1.5, 2, 2.5, 3], gain: 0.07, wob: 0.015, type: 'sine' },
      death:   { root: 43.7, voices: [1, 1.19, 1.5], gain: 0.06, wob: 0.02, type: 'sine' },
    };
    const c = CUES[cue] || CUES.explore;

    for (let i = 0; i < c.voices.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = c.type;
      osc.frequency.value = c.root * c.voices[i];
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 260 + i * 130;
      filt.Q.value = 1.4;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setTargetAtTime(c.gain / (1 + i * 0.35), t, 1.4);

      // slow detune wobble keeps it from sounding synthetic-static
      const wob = ctx.createOscillator();
      wob.frequency.value = 0.07 + i * 0.031;
      const wg = ctx.createGain();
      wg.gain.value = c.root * c.voices[i] * c.wob * 0.02;
      wob.connect(wg); wg.connect(osc.frequency); wob.start();

      osc.connect(filt); filt.connect(g); g.connect(this.busMusic);
      g.connect(this.reverb);
      osc.start();
      this._musicNodes.push({ osc, gain: g, wob });
    }

    // slow pulse on the combat cues
    if (cue.startsWith('phase') || cue === 'danger') {
      const pulseGain = ctx.createGain();
      pulseGain.gain.value = 0;
      const src = this._noiseSource();
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 110;
      src.connect(f); f.connect(pulseGain); pulseGain.connect(this.busMusic);
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = cue === 'phase3' ? 0.95 : cue === 'phase2' ? 0.72 : 0.55;
      const lg = ctx.createGain(); lg.gain.value = 0.06;
      lfo.connect(lg); lg.connect(pulseGain.gain);
      src.start(); lfo.start();
      this._musicNodes.push({ osc: src, gain: pulseGain });
      this._musicNodes.push({ osc: lfo });
    }
  }

  // ------------------------------------------------------------------ sfx --
  sfx(id, pos = null, gain = 1, rate = 1) {
    if (!this.ready) { if (this._pending.length < 20) this._pending.push([id, pos, gain, rate]); return; }
    const ctx = this.ctx, t = ctx.currentTime;

    let pan = 0, dist = 1;
    if (pos) {
      const dx = pos.x - this.listenerPos.x, dz = pos.z - this.listenerPos.z;
      const d = Math.hypot(dx, dz);
      dist = 1 / (1 + d * 0.06);
      pan = Math.max(-1, Math.min(1, dx * 0.06));
    }
    const out = ctx.createGain();
    out.gain.value = gain * dist;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    out.connect(panner);
    panner.connect(this.busSfx);
    const send = ctx.createGain();
    send.gain.value = 0.28;
    panner.connect(send); send.connect(this.reverb);

    const noise = (dur, type, f0, f1, q, vol, curve = 'exp') => {
      const s = this._noiseSource(false);
      s.playbackRate.value = rate;
      const f = ctx.createBiquadFilter();
      f.type = type; f.Q.value = q;
      f.frequency.setValueAtTime(f0, t);
      if (curve === 'exp') f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      else f.frequency.linearRampToValueAtTime(Math.max(20, f1), t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + Math.min(0.012, dur * 0.2));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(out);
      s.start(t); s.stop(t + dur + 0.05);
    };
    const tone = (dur, type, f0, f1, vol, delay = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0 * rate, t + delay);
      o.frequency.exponentialRampToValueAtTime(Math.max(18, f1 * rate), t + delay + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + delay);
      g.gain.linearRampToValueAtTime(vol, t + delay + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
      o.connect(g); g.connect(out);
      o.start(t + delay); o.stop(t + delay + dur + 0.05);
    };

    switch (id) {
      case 'step':        noise(0.22, 'lowpass', 900, 180, 1.2, 0.35); noise(0.10, 'bandpass', 2400, 900, 2, 0.10); break;
      case 'dodge':       noise(0.42, 'lowpass', 1600, 190, 1.0, 0.55); tone(0.20, 'sine', 180, 70, 0.10); break;
      case 'swingLight':  noise(0.20, 'bandpass', 2600, 700, 2.6, 0.30); break;
      case 'swingHeavy':  noise(0.34, 'bandpass', 1500, 320, 2.0, 0.42); tone(0.22, 'sine', 120, 55, 0.12); break;
      case 'bossHitLeg':  noise(0.16, 'lowpass', 1700, 260, 1.4, 0.55); tone(0.14, 'triangle', 220, 80, 0.20); break;
      case 'bossHitHead': noise(0.30, 'lowpass', 2200, 200, 1.2, 0.75); tone(0.26, 'sawtooth', 300, 70, 0.24); break;
      case 'playerHurt':  noise(0.30, 'lowpass', 1200, 160, 1.0, 0.6); tone(0.34, 'sawtooth', 340, 90, 0.20); break;
      case 'playerDie':   tone(1.9, 'sine', 220, 42, 0.26); noise(1.5, 'lowpass', 700, 90, 0.8, 0.34); break;
      case 'heal':        tone(0.7, 'sine', 480, 760, 0.16); tone(0.9, 'sine', 720, 980, 0.09, 0.1); break;
      case 'healStart':   noise(0.35, 'bandpass', 700, 1500, 3, 0.20); break;
      case 'lockOn':      tone(0.10, 'sine', 900, 1250, 0.10); break;
      case 'legSlam':     noise(0.85, 'lowpass', 700, 45, 0.7, 1.0); tone(0.65, 'sine', 90, 30, 0.42); break;
      case 'sporeBurst':  noise(0.75, 'bandpass', 1500, 260, 1.4, 0.5); break;
      case 'gust':        noise(1.5, 'bandpass', 900, 260, 0.8, 0.62); break;
      case 'dive':        noise(1.3, 'bandpass', 1400, 200, 1.1, 0.72); tone(1.1, 'sawtooth', 180, 48, 0.22); break;
      case 'moonfall':    noise(2.4, 'lowpass', 1600, 40, 0.6, 1.0); tone(1.9, 'sine', 120, 26, 0.5); break;
      case 'summon':      tone(0.7, 'triangle', 180, 460, 0.18); noise(0.6, 'bandpass', 500, 1600, 3, 0.24); break;
      case 'bossRoar':    tone(2.1, 'sawtooth', 130, 44, 0.40); tone(2.0, 'square', 66, 30, 0.16, 0.05); noise(2.0, 'lowpass', 900, 120, 0.8, 0.5); break;
      case 'bossStagger': tone(1.5, 'sawtooth', 220, 55, 0.36); noise(1.3, 'lowpass', 1100, 90, 0.7, 0.6); break;
      case 'bossRecover': tone(0.9, 'sawtooth', 90, 190, 0.28); break;
      case 'bossDeath':   tone(3.6, 'sawtooth', 180, 30, 0.42); tone(3.2, 'sine', 90, 24, 0.28, 0.2); noise(3.0, 'lowpass', 800, 50, 0.6, 0.5); break;
      case 'bossCrash':   noise(2.2, 'lowpass', 900, 35, 0.6, 1.0); tone(1.6, 'sine', 70, 24, 0.5); break;
      case 'pillarsRise': noise(2.0, 'lowpass', 500, 110, 0.9, 0.6); tone(1.8, 'sawtooth', 60, 110, 0.22); break;
      case 'enemyHit':    noise(0.14, 'bandpass', 1800, 500, 2, 0.4); break;
      case 'enemyDie':    noise(0.5, 'lowpass', 1300, 180, 1.0, 0.45); tone(0.4, 'triangle', 300, 90, 0.14); break;
      case 'tellLeg':     tone(0.55, 'triangle', 150, 260, 0.16); break;
      case 'tellSpore':   tone(0.7, 'sine', 420, 620, 0.11); break;
      case 'tellGust':    noise(0.9, 'bandpass', 400, 1100, 2.5, 0.24); break;
      case 'tellDive':    tone(0.9, 'sawtooth', 220, 420, 0.16); break;
      case 'tellSummon':  tone(0.7, 'triangle', 300, 180, 0.14); break;
      case 'tellMoonfall':tone(2.3, 'sawtooth', 90, 320, 0.28); noise(2.2, 'bandpass', 300, 1800, 2, 0.3); break;
      case 'uiMove':      tone(0.05, 'sine', 620, 620, 0.06); break;
      case 'uiSelect':    tone(0.09, 'sine', 780, 1040, 0.09); break;
      case 'uiBack':      tone(0.09, 'sine', 520, 340, 0.08); break;
      case 'checkpoint':  tone(1.0, 'sine', 320, 480, 0.12); tone(1.2, 'sine', 480, 640, 0.07, 0.12); break;
      default:            noise(0.12, 'bandpass', 1200, 400, 2, 0.20); break;
    }
  }

  /** Ducks music while a big cue plays. */
  duck(amount = 0.45, time = 0.9) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.busMusic.gain.setTargetAtTime(settings.get('music') * (1 - amount), t, 0.08);
    this.busMusic.gain.setTargetAtTime(settings.get('music'), t + time, 0.5);
  }

  setListener(pos) { this.listenerPos = pos; }

  /** Intensity 0..1 drives ambient wind/drone with combat state. */
  setIntensity(k) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._wind.gain.gain.setTargetAtTime(0.10 + k * 0.14, t, 0.6);
    this._drone.gain.gain.setTargetAtTime(0.11 + k * 0.10, t, 0.8);
  }

  update(dt) { if (this.ready) this._ambienceTick(dt); }

  suspend() { this.ctx?.suspend?.(); }
  resume() { this.ctx?.resume?.(); }
}

export const audio = new Audio();
export default audio;
