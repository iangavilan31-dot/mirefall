import { bus, EVT } from './EventBus.js';

const KEY = 'mirefall.settings.v1';

/**
 * Quality tiers drive every renderer-cost decision in the game.
 * Systems must read from `settings.q` (the resolved tier object), never hardcode.
 */
export const TIERS = {
  potato: {
    label: 'Potato', pixelRatio: 0.65, shadows: false, shadowMap: 512,
    reflection: 0, reflectionScale: 0.0, bloom: true, bloomStrength: 0.5,
    ssao: false, dof: false, grain: true, godrays: false, smaa: false,
    particles: 0.25, fogSheets: 1, instanceDensity: 0.35, waterRipples: false,
    anisotropy: 1, maxLights: 4, volumetricSteps: 0,
  },
  low: {
    label: 'Low', pixelRatio: 0.8, shadows: true, shadowMap: 1024,
    reflection: 1, reflectionScale: 0.28, bloom: true, bloomStrength: 0.55,
    ssao: false, dof: false, grain: true, godrays: false, smaa: false,
    particles: 0.45, fogSheets: 2, instanceDensity: 0.55, waterRipples: true,
    anisotropy: 2, maxLights: 6, volumetricSteps: 0,
  },
  medium: {
    label: 'Medium', pixelRatio: 1.0, shadows: true, shadowMap: 1536,
    reflection: 1, reflectionScale: 0.4, bloom: true, bloomStrength: 0.6,
    ssao: false, dof: true, grain: true, godrays: true, smaa: true,
    particles: 0.7, fogSheets: 3, instanceDensity: 0.78, waterRipples: true,
    anisotropy: 4, maxLights: 8, volumetricSteps: 8,
  },
  high: {
    label: 'High', pixelRatio: 1.0, shadows: true, shadowMap: 2048,
    reflection: 1, reflectionScale: 0.55, bloom: true, bloomStrength: 0.62,
    ssao: true, dof: true, grain: true, godrays: true, smaa: true,
    particles: 1.0, fogSheets: 4, instanceDensity: 1.0, waterRipples: true,
    anisotropy: 8, maxLights: 12, volumetricSteps: 14,
  },
  ultra: {
    label: 'Ultra', pixelRatio: 1.25, shadows: true, shadowMap: 3072,
    reflection: 1, reflectionScale: 0.7, bloom: true, bloomStrength: 0.65,
    ssao: true, dof: true, grain: true, godrays: true, smaa: true,
    particles: 1.35, fogSheets: 5, instanceDensity: 1.25, waterRipples: true,
    anisotropy: 16, maxLights: 16, volumetricSteps: 20,
  },
};

const DEFAULTS = {
  // graphics
  quality: 'high',
  adaptive: true,
  targetFps: 60,
  motionBlur: false,
  fov: 55,
  // audio
  master: 0.9, music: 0.62, sfx: 0.95, ambience: 0.7,
  // controls
  mouseSensitivity: 1.0,
  padSensitivity: 1.0,
  invertY: false,
  invertX: false,
  lockOnToggle: true,
  vibration: true,
  // accessibility
  cameraShake: 1.0,
  screenFlash: 1.0,
  grainAmount: 1.0,
  subtitles: true,
  highContrastTells: false,
  colourBlindSafeTells: false,
  uiScale: 1.0,
  aimAssist: 0.5,
  holdToSprint: false,
  difficulty: 'wanderer',   // wanderer | pilgrim | drowned
};

class Settings {
  constructor() {
    this.data = { ...DEFAULTS };
    this.load();
    this.q = TIERS[this.data.quality] || TIERS.high;
    this._overrides = {};
  }
  get(k) { return this.data[k]; }
  set(k, v) {
    if (this.data[k] === v) return;
    this.data[k] = v;
    if (k === 'quality') this.q = TIERS[v] || TIERS.high;
    this.save();
    bus.emit(EVT.SETTINGS_CHANGE, { key: k, value: v });
  }
  /** Adaptive quality nudges without persisting a user choice. */
  applyAdaptive(tierName) {
    this.q = TIERS[tierName] || this.q;
    bus.emit(EVT.SETTINGS_CHANGE, { key: 'quality:adaptive', value: tierName });
  }
  all() { return { ...this.data }; }
  reset() { this.data = { ...DEFAULTS }; this.q = TIERS[this.data.quality]; this.save(); bus.emit(EVT.SETTINGS_CHANGE, { key: '*', value: null }); }
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch { /* private mode */ }
  }
  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
  }
  /** Best-guess starting tier from hardware hints. */
  autodetect() {
    if (localStorage.getItem(KEY)) return;
    const mem = navigator.deviceMemory || 8;
    const cores = navigator.hardwareConcurrency || 8;
    let tier = 'high';
    if (mem <= 4 || cores <= 4) tier = 'low';
    else if (mem <= 8 && cores <= 8) tier = 'medium';
    this.data.quality = tier;
    this.q = TIERS[tier];
  }
}

export const settings = new Settings();
export default settings;
