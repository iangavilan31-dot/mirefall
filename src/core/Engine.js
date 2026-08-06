import * as THREE from 'three';
import { PALETTE, SCALE } from './Palette.js';
import { settings, TIERS } from './Settings.js';
import { bus, EVT } from './EventBus.js';

/**
 * Owns the renderer, the scene, the camera, sizing, and the frame budget monitor.
 * Everything else attaches to `engine.scene`.
 */
export class Engine {
  constructor(canvas) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,           // SMAA in post instead; cheaper with a composer
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      alpha: false,
      preserveDrawingBuffer: true, // needed for automated capture
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = false;

    this.caps = {
      maxAniso: this.renderer.capabilities.getMaxAnisotropy(),
      float: this.renderer.capabilities.isWebGL2,
    };

    this.scene = new THREE.Scene();
    this.scene.background = PALETTE.fog.clone();
    this.scene.fog = new THREE.FogExp2(PALETTE.fog.clone(), SCALE.fogDensity);

    this.camera = new THREE.PerspectiveCamera(settings.get('fov'), 1, 0.15, 900);
    this.camera.position.set(0, 3, 12);

    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.frame = 0;

    // rolling perf window
    this._samples = new Float32Array(90);
    this._si = 0;
    this._adaptCooldown = 3.0;
    this.fps = 60;
    this.ms = 16.6;

    this._onResize = this.resize.bind(this);
    window.addEventListener('resize', this._onResize);
    bus.on(EVT.SETTINGS_CHANGE, ({ key }) => {
      if (key === 'quality' || key === '*') this.applyQuality();
      if (key === 'fov' || key === '*') { this.camera.fov = settings.get('fov'); this.camera.updateProjectionMatrix(); }
    });

    this.applyQuality();
    this.resize();
  }

  applyQuality() {
    const q = settings.q;
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.needsUpdate = true;
    this.resize();
    bus.emit('engine:quality', q);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * settings.q.pixelRatio;
    this.width = w; this.height = h; this.dpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    bus.emit('engine:resize', { w, h, dpr });
  }

  /** Rolling FPS + optional adaptive tier stepping. */
  sampleFrame(dt) {
    this._samples[this._si++ % this._samples.length] = dt;
    let sum = 0, n = Math.min(this.frame, this._samples.length) || 1;
    for (let i = 0; i < n; i++) sum += this._samples[i];
    const avg = sum / n;
    this.ms = avg * 1000;
    this.fps = 1 / Math.max(avg, 1e-4);

    if (!settings.get('adaptive')) return;
    this._adaptCooldown -= dt;
    if (this._adaptCooldown > 0 || this.frame < 120) return;

    const order = ['potato', 'low', 'medium', 'high', 'ultra'];
    const cur = order.indexOf(settings.q === TIERS[settings.get('quality')] ? settings.get('quality') : (this._adaptTier || settings.get('quality')));
    const target = settings.get('targetFps');
    if (this.fps < target * 0.78 && cur > 0) {
      this._adaptTier = order[cur - 1];
      settings.applyAdaptive(this._adaptTier);
      this._adaptCooldown = 6.0;
      this.applyQuality();
    } else if (this.fps > target * 1.22 && cur < order.indexOf(settings.get('quality'))) {
      this._adaptTier = order[cur + 1];
      settings.applyAdaptive(this._adaptTier);
      this._adaptCooldown = 8.0;
      this.applyQuality();
    }
  }

  stats() {
    const i = this.renderer.info;
    return {
      fps: +this.fps.toFixed(1), ms: +this.ms.toFixed(2),
      calls: i.render.calls, tris: i.render.triangles,
      geometries: i.memory.geometries, textures: i.memory.textures,
      programs: i.programs ? i.programs.length : 0,
      tier: settings.q.label, dpr: +this.dpr.toFixed(2),
    };
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
  }
}

export default Engine;
