import * as THREE from 'three';
import { Engine } from './Engine.js';
import { input } from './Input.js';
import { settings } from './Settings.js';
import { bus, EVT } from './EventBus.js';
import { PALETTE, SCALE } from './Palette.js';
import { Sky } from '../render/Sky.js';
import { Lighting } from '../render/Lighting.js';
import { PostFX } from '../render/PostFX.js';
import { FogSystem } from '../render/FogSystem.js';
import { Water } from '../world/Water.js';
import { World } from '../world/World.js';
import TL from '../world/TextureLab.js';
import { Player } from '../player/Player.js';
import { Boss } from '../boss/Boss.js';
import { Enemy } from '../enemies/Enemy.js';
import { Effects } from '../fx/Effects.js';
import { CameraRig } from '../camera/CameraRig.js';
import { UI } from '../ui/UI.js';
import { audio } from '../audio/Audio.js';

const SAVE_KEY = 'mirefall.save.v1';

export class Game {
  constructor(canvas, onProgress = () => {}) {
    this.canvas = canvas;
    this.onProgress = onProgress;
    this.state = 'boot';
    this.stateTime = 0;
    this.elapsed = 0;
    this.paused = false;
    this.timeScale = 1;
    this._acc = 0;
    this.stats = { time: 0, deaths: 0, hits: 0, bestPhase: 1 };
  }

  async build() {
    const step = async (pct, note, fn) => {
      this.onProgress(pct, note);
      await new Promise((r) => setTimeout(r, 0));
      return fn?.();
    };

    await step(0.05, 'lighting the lanterns');
    this.engine = new Engine(this.canvas);
    TL.setAnisotropy(Math.min(settings.q.anisotropy, this.engine.caps.maxAniso));
    input.attach(this.canvas);

    await step(0.14, 'raising the moon');
    this.sky = new Sky().addTo(this.engine.scene);
    this.lighting = new Lighting(this.engine.scene, this.sky);

    await step(0.26, 'flooding the kingdom');
    this.water = new Water(this.engine, { level: SCALE.waterLevel });
    this.water.addTo(this.engine.scene);
    this.water.uniforms.uMoonDir.value.copy(this.sky.moonDir);

    await step(0.40, 'weaving the fog');
    this.fog = new FogSystem(this.engine.scene, this.sky);

    await step(0.52, 'raising the drowned village');
    this.world = new World(this.engine.scene, this.water, this.lighting);

    await step(0.70, 'sharpening a small sword');
    this.fx = new Effects(this.engine.scene, this.water);
    this.player = new Player(this.engine.scene, this.water, { x: 0, z: 30 });
    this.player.obstacles = this.world.obstacles;

    await step(0.84, 'waking the deity');
    this.boss = new Boss(this.engine.scene, this.water, this.sky, this.player, this.fx);
    this.boss.onSummon = (pos) => this.spawnEnemy(pos);
    this.boss.onArenaChange = (phase) => this.arenaChange(phase);
    this.player.enemies = [this.boss];
    this.enemies = [];

    await step(0.92, 'framing the shot');
    this.rig = new CameraRig(this.engine.camera, this.player.root);
    this.rig.collidables = this.world.collidables;
    this.rig.setLockCandidates([this.boss]);
    this.player.setCameraYawRef(() => this.rig.yaw);

    this.postfx = new PostFX(this.engine, this.sky);
    this.ui = new UI(this);

    this._bindEvents();
    this._buildCaptureRig();

    await step(1.0, 'the mire is listening');
    this.setState('title');
    return this;
  }

  _bindEvents() {
    bus.on(EVT.PLAYER_HIT, ({ damage }) => {
      this.postfx.damage(Math.min(1, damage / 40 + 0.35));
      audio.duck(0.3, 0.5);
    });
    bus.on(EVT.PLAYER_HEAL, () => this.postfx.heal(0.9));
    bus.on(EVT.PLAYER_DEAD, () => { this.stats.deaths++; this._toState('dying', 2.6); });
    bus.on(EVT.BOSS_DEAD, () => this._toState('slain', 11.0));
    bus.on(EVT.BOSS_TELEGRAPH, ({ attack, duration }) => {
      this.postfx.danger(attack === 'moonfall' ? 1.0 : 0.45);
      this.ui.subtitle(TELLS[attack] || '');
    });
    bus.on(EVT.BOSS_PHASE, ({ phase }) => {
      this.stats.bestPhase = Math.max(this.stats.bestPhase, phase);
      this.postfx.flash(0.30, 2.4);
      audio.duck(0.6, 1.6);
      this.save();
    });
    bus.on(EVT.HIT_LANDED, () => { this.stats.hits++; });
    bus.on(EVT.BOSS_STAGGER, () => { this.postfx.flash(0.22, 3.0); this.ui.subtitle('Its head is within reach.'); });
    bus.on(EVT.SETTINGS_CHANGE, ({ key }) => {
      if (key === 'quality' || key === '*') TL.setAnisotropy(Math.min(settings.q.anisotropy, this.engine.caps.maxAniso));
    });
  }

  // ------------------------------------------------------------ state m/c --
  setState(s) {
    const from = this.state;
    this.state = s;
    this.stateTime = 0;
    bus.emit(EVT.STATE_CHANGE, { from, to: s });

    switch (s) {
      case 'title':
        this.ui.screen('start');
        this.ui.showBossBar(false);
        input.setEnabled(false);
        input.exitPointerLock();
        audio.music('menu');
        document.querySelector('[data-act="continue"]').disabled = !this.hasSave();
        break;
      case 'playing':
        this.ui.hideAll();
        this.ui.showBossBar(true, 'The Mire Deity');
        input.setEnabled(true);
        if (!input.usingPad) input.requestPointerLock();
        break;
      case 'paused':
        this.ui.screen('pause');
        input.setEnabled(false);
        input.exitPointerLock();
        audio.duck(0.5, 999);
        break;
      case 'dying':
        input.setEnabled(false);
        audio.music('death');
        this.ui.showBossBar(false);
        break;
      case 'death':
        this.ui.screen('death');
        input.exitPointerLock();
        break;
      case 'slain':
        input.setEnabled(false);
        this.ui.showBossBar(false);
        break;
      case 'victory':
        this.ui.screen('victory');
        input.exitPointerLock();
        break;
      case 'ending':
        this.ui.showEnding(this.stats);
        this.ui.screen('ending');
        break;
      case 'settings':
        this.ui.renderSettings('graphics');
        this.ui.screen('settings');
        input.exitPointerLock();
        break;
    }
  }

  _toState(s, delay) { this._pendingState = s; this._pendingDelay = delay; this.setState(s); }

  uiAction(act) {
    switch (act) {
      case 'new': this.startRun(false); break;
      case 'continue': this.startRun(true); break;
      case 'resume': this.setState('playing'); audio.duck(0, 0.2); break;
      case 'restart': this.startRun(false); break;
      case 'retry': this.startRun(true); break;
      case 'settings': this._settingsReturn = this.state; this.setState('settings'); break;
      case 'setback': this.setState(this._settingsReturn === 'playing' ? 'paused' : (this._settingsReturn || 'title')); break;
      case 'quit': this.setState('title'); break;
      case 'ending': this.setState('ending'); break;
    }
  }

  // ---------------------------------------------------------------- run ----
  startRun(fromCheckpoint) {
    const save = fromCheckpoint ? this.loadSave() : null;
    this.clearEnemies();
    this.player.respawn(0, 30);
    this.rig.lockTarget = null;
    this.rig.yaw = Math.PI; this.rig.pitch = 0.14;
    this.rig.applyPreset({ distance: 6.4 });
    this.postfx.setFade(0);
    this.world.pillars.forEach((p) => { p.mesh.position.y = -20; p.rising = false; });

    // rebuild the boss cleanly so phases/hazards reset
    this.engine.scene.remove(this.boss.root);
    this.boss = new Boss(this.engine.scene, this.water, this.sky, this.player, this.fx);
    this.boss.onSummon = (pos) => this.spawnEnemy(pos);
    this.boss.onArenaChange = (phase) => this.arenaChange(phase);
    this.player.enemies = [this.boss];
    this.rig.setLockCandidates([this.boss]);

    if (save) {
      this.boss.health = Math.min(this.boss.maxHealth, save.bossHealth);
      this.boss._phaseIndex = save.phaseIndex || 0;
      this.boss.phase = save.phase || 1;
      this.boss.rage = [0, 0.45, 1][this.boss._phaseIndex] || 0;
      this.stats = { ...this.stats, ...save.stats };
      if (this.boss.phase >= 2) this.world.raisePillars();
      if (this.boss.phase >= 3) this.world.darken();
      this.boss.state = 'idle';
      this.boss.stateTime = 0;
      this.boss.nextAttackIn = 3.0;
      this.boss.heightOffset = 0;
      this.ui.toast('THE VIGIL RESUMES');
    } else {
      this.stats = { time: 0, deaths: this.stats.deaths, hits: 0, bestPhase: 1 };
      this._resetArena();
    }

    audio.music('phase' + this.boss.phase);
    this.setState('playing');
  }

  _resetArena() {
    for (const p of this.world.pillars) { p.mesh.position.y = -20; p.rising = false; }
    this.world._darkening = undefined;
    this.engine.scene.fog.density = SCALE.fogDensity;
    this.engine.scene.fog.color.copy(PALETTE.fog);
    this.engine.scene.background.copy(PALETTE.fog);
    this.water.uniforms.uFogColor.value.copy(PALETTE.fog);
    this.water.uniforms.uFogDensity.value = SCALE.fogDensity;
    this.water.uniforms.uDeep.value.copy(PALETTE.waterDeep);
  }

  arenaChange(phase) {
    if (phase === 2) { this.world.raisePillars(); this.ui.subtitle('Broken shrines rise from the water. Use them.'); }
    if (phase === 3) { this.world.darken(); this.ui.subtitle('The lanterns are going out.'); }
  }

  spawnEnemy(pos) {
    if (this.enemies.length > 7) return;
    const e = new Enemy(this.engine.scene, this.water, this.player, pos);
    this.enemies.push(e);
    this.player.enemies = [this.boss, ...this.enemies];
    this.rig.setLockCandidates([this.boss, ...this.enemies]);
  }

  clearEnemies() {
    for (const e of this.enemies || []) e.destroy();
    this.enemies = [];
    if (this.player) this.player.enemies = [this.boss];
  }

  // --------------------------------------------------------------- saves ---
  hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } }
  loadSave() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; } }
  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        bossHealth: this.boss.health, phase: this.boss.phase, phaseIndex: this.boss._phaseIndex,
        stats: this.stats, at: Date.now(),
      }));
      bus.emit(EVT.SFX, { id: 'checkpoint', gain: 0.6 });
      this.ui.toast('VIGIL MARKED');
    } catch {}
  }

  // -------------------------------------------------------------- update ---
  frame(dtRaw) {
    const dt = Math.min(dtRaw, 1 / 20);
    this.engine.frame++;
    this.engine.sampleFrame(dtRaw);

    input.update(dt);

    // global hotkeys
    if (input.pressed('pause')) {
      if (this.state === 'playing') this.setState('paused');
      else if (this.state === 'paused') { this.setState('playing'); audio.duck(0, 0.2); }
      else if (this.state === 'settings') this.uiAction('setback');
    }
    if (input.keys.has('F1') && !this._f1) { this._f1 = true; this.ui.togglePerf(); }
    if (!input.keys.has('F1')) this._f1 = false;

    const active = this.state === 'playing' || this.state === 'dying' || this.state === 'slain';
    const scale = this.state === 'slain' ? 0.55 : 1;
    const sdt = active ? dt * this.timeScale * scale : 0;
    // Ambient shader time keeps running on menus (at a slower drift) so the world is
    // never frozen behind the title or pause screens — only simulation stops.
    this.elapsed += active ? sdt : dt * 0.35;
    this.stateTime += dt;
    if (this.state === 'playing') this.stats.time += dt;

    if (active) {
      this.player.update(sdt, this.elapsed);
      this.boss.update(sdt, this.elapsed);
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        e.update(sdt, this.elapsed);
        if (e._destroyed) {
          this.enemies.splice(i, 1);
          this.player.enemies = [this.boss, ...this.enemies];
          this.rig.setLockCandidates([this.boss, ...this.enemies]);
        }
      }
      if (input.pressed('lockOn')) this.rig.toggleLock();
      this.player.lockTarget = this.rig.lockTarget;
    }

    // state transitions
    if (this.state === 'dying' && this.stateTime > 2.6) this.setState('death');
    if (this.state === 'slain') {
      const k = Math.min(1, Math.max(0, (this.stateTime - 8.5) / 2.5));
      this.postfx.setFade(k, 0x0a0d0f);
      if (this.stateTime > 11.0) { this.postfx.setFade(0); this.clearSaveOnWin(); this.setState('victory'); }
    }

    this.world.update(sdt || dt * 0.25, this.elapsed, this.player.pos);
    this.fog.update(sdt || dt * 0.4, this.elapsed, this.engine.camera.position, this.boss);
    this.fx.update(sdt, this.elapsed, this.player);
    this.water.update(sdt || dt * 0.3, this.elapsed, this.player.pos.x, this.player.pos.z);

    // camera
    if (this.state === 'title') this._titleCamera(dt);
    else this.rig.update(dt, this.elapsed);

    this.lighting.update(dt, this.elapsed, this.player.pos);
    this.sky.update(dt, this.elapsed, this.engine.camera.position);

    // audio
    audio.setListener(this.engine.camera.position);
    audio.update(dt);
    if (active) {
      const intensity = this.boss.state === 'attack' || this.boss.staggered ? 0.9 : 0.35 + this.boss.rage * 0.4;
      audio.setIntensity(intensity);
    }

    // dof focus follows the lock target / player
    const focusD = this.rig.lockTarget
      ? this.engine.camera.position.distanceTo(this.rig.lockTarget.lockPoint()) * 0.55
      : this.engine.camera.position.distanceTo(this.player.pos);
    this.postfx.setFocus(THREE.MathUtils.clamp(focusD, 5, 40));
    this.postfx.update(dt, this.elapsed, this.engine.camera);

    this.ui.update(dt, { player: this.player, boss: this.boss, stats: this.engine.stats() });

    // ---- render ----
    this.engine.renderer.info.reset();
    this.water.mesh.visible = false;
    this.water.renderReflection(this.engine.scene, this.engine.camera);
    this.water.mesh.visible = true;
    this.postfx.render();

    input.postUpdate();
  }

  clearSaveOnWin() { try { localStorage.removeItem(SAVE_KEY); } catch {} }

  _titleCamera(dt) {
    // A slow authored orbit that reproduces the reference framing.
    this._titleT = (this._titleT || 0) + dt * 0.05;
    const t = this._titleT;
    const r = 30 + Math.sin(t * 0.6) * 3;
    const cam = this.engine.camera;
    cam.position.set(Math.sin(t) * r * 0.32 + 3, 3.4 + Math.sin(t * 0.8) * 0.5, 26 + Math.cos(t) * 4);
    const look = new THREE.Vector3(this.boss.root.position.x * 0.4, 12, this.boss.root.position.z * 0.6);
    cam.lookAt(look);
    cam.fov = 52;
    cam.updateProjectionMatrix();
  }

  // ------------------------------------------------------ capture support --
  _buildCaptureRig() {
    this.shots = {
      hero:      { pos: [4.4, 2.05, 14.5], look: [1.5, 12.5, -12], fov: 48 },
      gameplay_default: null,   // uses the live rig
      boss_close:{ pos: [2.0, 6.0, -1.0], look: [0, 24, -14], fov: 55 },
      player_close: { pos: [1.6, 1.05, 3.2], look: [0, 0.85, 0], fov: 44 },
      wide_arena:{ pos: [-26, 5.5, 34], look: [0, 10, -10], fov: 60 },
      lotus:     { pos: [13.6, 0.9, 30.4], look: [13, 0.15, 27], fov: 40 },
      left_frame:{ pos: [-14, 2.6, 18], look: [-24, 6, -4], fov: 55 },
    };
  }

  applyShot(name) {
    const s = this.shots[name];
    if (!s) return false;
    const cam = this.engine.camera;
    cam.position.set(...s.pos);
    cam.lookAt(new THREE.Vector3(...s.look));
    cam.fov = s.fov;
    cam.updateProjectionMatrix();
    this._shotLock = name;
    return true;
  }
}

const TELLS = {
  legSlam: 'It lifts a limb the size of a temple pillar.',
  legTriple: 'Three strikes, and no pause between them.',
  sporeFall: 'Spores gather in the air above you.',
  gustSweep: 'Its wings draw back. The water flattens.',
  dive: 'It falls forward along a line of dead water.',
  moonfall: 'It reaches for the moon. Get behind something.',
  summon: 'The drowned are being pulled back up.',
};

export default Game;
