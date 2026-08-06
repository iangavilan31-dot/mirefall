import { bus, EVT } from '../core/EventBus.js';
import { settings, TIERS } from '../core/Settings.js';
import { input } from '../core/Input.js';

/**
 * Minimal, nearly invisible UI (ART_TARGET §11). No frames, no gradients, no bright colours.
 * Everything is thin rules, low-opacity type, and the sanctioned palette.
 */

const CSS = `
#ui-root { font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif; --s: 1; }
#ui-root * { box-sizing: border-box; }
.mf-hud { position:absolute; inset:0; pointer-events:none; opacity:1; transition:opacity .5s ease; }
.mf-hud.dim { opacity:0; }

/* --- player vitals, bottom-left --- */
.mf-vitals { position:absolute; left:calc(38px * var(--s)); bottom:calc(38px * var(--s)); width:calc(268px * var(--s)); }
.mf-bar { position:relative; height:calc(7px * var(--s)); background:rgba(10,13,15,.62);
  box-shadow: inset 0 0 0 1px rgba(233,238,240,.10); overflow:hidden; }
.mf-bar > i { position:absolute; left:0; top:0; bottom:0; width:100%; transform-origin:left;
  transition: transform .18s cubic-bezier(.2,.8,.3,1); }
.mf-bar > .lag { background:rgba(196,96,80,.55); transition: transform .55s ease .18s; }
.mf-hp > .fill { background:linear-gradient(90deg,#8fa39a,#c9d6cf); }
.mf-stam { height:calc(4px * var(--s)); margin-top:calc(5px * var(--s)); opacity:.8; }
.mf-stam > .fill { background:rgba(200,214,208,.5); }
.mf-stam.low > .fill { background:rgba(216,152,96,.65); }
.mf-flasks { display:flex; gap:calc(5px * var(--s)); margin-top:calc(9px * var(--s)); }
.mf-flask { width:calc(9px * var(--s)); height:calc(9px * var(--s)); border:1px solid rgba(233,238,240,.30);
  background:transparent; transition:background .25s, border-color .25s; }
.mf-flask.on { background:rgba(168,216,192,.72); border-color:rgba(168,216,192,.72); }

/* --- boss bar, bottom-centre --- */
.mf-boss { position:absolute; left:50%; transform:translateX(-50%); bottom:calc(34px * var(--s));
  width:min(52vw, calc(680px * var(--s))); opacity:0; transition:opacity .8s ease; }
.mf-boss.show { opacity:1; }
.mf-boss .name { font-size:calc(10px * var(--s)); letter-spacing:.42em; text-transform:uppercase;
  color:rgba(233,238,240,.52); text-align:center; margin-bottom:calc(7px * var(--s)); text-indent:.42em; }
.mf-boss .mf-bar { height:calc(5px * var(--s)); }
.mf-boss .fill { background:linear-gradient(90deg,#7d8a5c,#c9d24e); }
.mf-boss .ticks { position:absolute; inset:0; pointer-events:none; }
.mf-boss .ticks i { position:absolute; top:0; bottom:0; width:1px; background:rgba(10,13,15,.75); }
.mf-poise { height:calc(2px * var(--s)); margin-top:calc(3px * var(--s)); opacity:.55; }
.mf-poise > .fill { background:rgba(233,238,240,.55); }

/* --- prompts, bottom-right (matches the reference frame) --- */
.mf-prompts { position:absolute; right:calc(38px * var(--s)); bottom:calc(38px * var(--s));
  display:flex; flex-direction:column; gap:calc(9px * var(--s)); align-items:flex-end; }
.mf-prompt { display:flex; align-items:center; gap:calc(9px * var(--s)); opacity:.55;
  font-size:calc(12px * var(--s)); color:#e9eef0; letter-spacing:.04em; }
.mf-key { display:inline-flex; align-items:center; justify-content:center; min-width:calc(22px * var(--s));
  height:calc(22px * var(--s)); padding:0 calc(6px * var(--s)); border-radius:999px;
  background:rgba(10,13,15,.62); box-shadow: inset 0 0 0 1px rgba(233,238,240,.18);
  font-size:calc(10px * var(--s)); letter-spacing:.02em; color:rgba(233,238,240,.85); }

/* --- toast --- */
.mf-toast { position:absolute; left:50%; top:26%; transform:translateX(-50%);
  font-size:calc(15px * var(--s)); letter-spacing:.52em; text-transform:uppercase; text-indent:.52em;
  color:rgba(233,238,240,.9); opacity:0; transition:opacity .5s ease, letter-spacing 1.6s ease;
  text-shadow:0 2px 24px rgba(0,0,0,.9); pointer-events:none; white-space:nowrap; }
.mf-toast.show { opacity:1; letter-spacing:.62em; }

/* --- subtitle --- */
.mf-sub { position:absolute; left:50%; bottom:calc(96px * var(--s)); transform:translateX(-50%);
  font-size:calc(13px * var(--s)); color:rgba(233,238,240,.72); text-shadow:0 2px 12px #000;
  opacity:0; transition:opacity .3s; max-width:60vw; text-align:center; }
.mf-sub.show { opacity:1; }

/* --- screens --- */
.mf-screen { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  flex-direction:column; background:rgba(8,11,13,.72); backdrop-filter:blur(7px);
  pointer-events:auto; opacity:0; transition:opacity .6s ease; }
.mf-screen.hidden { display:none; }
.mf-screen.show { opacity:1; }
.mf-screen.clear { background:rgba(8,11,13,.34); backdrop-filter:blur(2px); }
.mf-title { font-size:clamp(38px, 7vw, 86px); letter-spacing:.30em; text-indent:.30em; font-weight:200;
  color:#e9eef0; text-shadow:0 4px 60px rgba(0,0,0,.9); }
.mf-sub-title { margin-top:14px; font-size:12px; letter-spacing:.44em; text-indent:.44em;
  text-transform:uppercase; color:rgba(139,151,156,.75); }
.mf-menu { margin-top:52px; display:flex; flex-direction:column; gap:2px; min-width:290px; }
.mf-item { padding:11px 20px; font-size:13px; letter-spacing:.24em; text-transform:uppercase;
  color:rgba(233,238,240,.55); background:transparent; border:0; cursor:pointer; text-align:center;
  transition:color .2s, background .2s, letter-spacing .3s; font-family:inherit; }
.mf-item:hover, .mf-item.sel { color:#e9eef0; background:rgba(233,238,240,.055); letter-spacing:.30em; }
.mf-item[disabled] { opacity:.28; cursor:default; }
.mf-hint { position:absolute; bottom:34px; font-size:10px; letter-spacing:.28em; text-transform:uppercase;
  color:rgba(139,151,156,.45); }
.mf-death .mf-title { color:#c47a68; }
.mf-victory .mf-title { color:#dfe6d8; }

/* --- settings --- */
.mf-settings { width:min(660px, 88vw); max-height:74vh; overflow-y:auto; margin-top:28px; padding-right:8px; }
.mf-settings::-webkit-scrollbar { width:3px; }
.mf-settings::-webkit-scrollbar-thumb { background:rgba(233,238,240,.2); }
.mf-tabs { display:flex; gap:0; justify-content:center; margin-top:26px; }
.mf-tab { padding:8px 22px; font-size:11px; letter-spacing:.26em; text-transform:uppercase;
  color:rgba(233,238,240,.4); background:none; border:0; border-bottom:1px solid rgba(233,238,240,.10);
  cursor:pointer; font-family:inherit; transition:color .2s, border-color .2s; }
.mf-tab.sel { color:#e9eef0; border-bottom-color:rgba(233,238,240,.6); }
.mf-row { display:flex; align-items:center; justify-content:space-between; gap:24px;
  padding:11px 6px; border-bottom:1px solid rgba(233,238,240,.055); }
.mf-row label { font-size:12px; letter-spacing:.10em; color:rgba(233,238,240,.7); text-transform:uppercase; }
.mf-row .val { font-size:11px; letter-spacing:.14em; color:rgba(233,238,240,.5); min-width:72px; text-align:right; }
.mf-row input[type=range] { width:190px; accent-color:#9fb0a8; background:transparent; }
.mf-row select, .mf-row button.opt { background:rgba(10,13,15,.6); color:rgba(233,238,240,.8);
  border:1px solid rgba(233,238,240,.14); padding:6px 12px; font-size:11px; letter-spacing:.14em;
  font-family:inherit; text-transform:uppercase; cursor:pointer; }
.mf-note { font-size:10px; color:rgba(139,151,156,.5); letter-spacing:.1em; padding:10px 6px 0; }

/* --- perf readout --- */
.mf-perf { position:absolute; left:10px; top:10px; font-family:ui-monospace,Consolas,monospace;
  font-size:10px; line-height:1.5; color:rgba(180,220,190,.72); background:rgba(8,11,13,.55);
  padding:6px 9px; white-space:pre; pointer-events:none; }
.mf-perf.hidden { display:none; }
`;

export class UI {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui-root');
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root.innerHTML = this._markup();
    this._q();
    this._bind();
    this._toastTimer = 0;
    this._subTimer = 0;
    this.applyScale();
  }

  _markup() {
    return `
    <div class="mf-hud" id="hud">
      <div class="mf-vitals">
        <div class="mf-bar mf-hp"><i class="lag" id="hpLag"></i><i class="fill" id="hpFill"></i></div>
        <div class="mf-bar mf-stam" id="stamBar"><i class="fill" id="stamFill"></i></div>
        <div class="mf-flasks" id="flasks"></div>
      </div>
      <div class="mf-boss" id="bossBar">
        <div class="name" id="bossName">The Mire Deity</div>
        <div class="mf-bar"><i class="lag" id="bossLag"></i><i class="fill" id="bossFill"></i><div class="ticks" id="bossTicks"></div></div>
        <div class="mf-bar mf-poise"><i class="fill" id="poiseFill"></i></div>
      </div>
      <div class="mf-prompts" id="prompts"></div>
      <div class="mf-toast" id="toast"></div>
      <div class="mf-sub" id="subtitle"></div>
    </div>
    <div class="mf-perf hidden" id="perf"></div>

    <div class="mf-screen hidden" id="scr-start">
      <div class="mf-title">MIREFALL</div>
      <div class="mf-sub-title">a small thing, beneath a large god</div>
      <div class="mf-menu">
        <button class="mf-item" data-act="continue">Continue</button>
        <button class="mf-item" data-act="new">Begin the Vigil</button>
        <button class="mf-item" data-act="settings">Settings</button>
      </div>
      <div class="mf-hint">WASD move &nbsp;·&nbsp; Mouse look &nbsp;·&nbsp; LMB light &nbsp;·&nbsp; RMB heavy &nbsp;·&nbsp; Space dodge &nbsp;·&nbsp; Q heal &nbsp;·&nbsp; F lock-on &nbsp;·&nbsp; gamepad supported</div>
    </div>

    <div class="mf-screen hidden clear" id="scr-pause">
      <div class="mf-title" style="font-size:clamp(26px,4vw,44px)">PAUSED</div>
      <div class="mf-menu">
        <button class="mf-item" data-act="resume">Resume</button>
        <button class="mf-item" data-act="settings">Settings</button>
        <button class="mf-item" data-act="restart">Restart Encounter</button>
        <button class="mf-item" data-act="quit">Abandon</button>
      </div>
    </div>

    <div class="mf-screen hidden mf-death" id="scr-death">
      <div class="mf-title">DROWNED</div>
      <div class="mf-sub-title" id="deathSub">the mire keeps what it takes</div>
      <div class="mf-menu">
        <button class="mf-item" data-act="retry">Rise Again</button>
        <button class="mf-item" data-act="settings">Settings</button>
        <button class="mf-item" data-act="quit">Abandon</button>
      </div>
    </div>

    <div class="mf-screen hidden mf-victory" id="scr-victory">
      <div class="mf-title">STILLNESS</div>
      <div class="mf-sub-title" id="vicSub">the moon is only a moon again</div>
      <div class="mf-menu">
        <button class="mf-item" data-act="ending">Continue</button>
      </div>
    </div>

    <div class="mf-screen hidden" id="scr-ending">
      <div class="mf-title" style="font-size:clamp(22px,3.2vw,38px)" id="endTitle">THE VIGIL ENDS</div>
      <div class="mf-sub-title" id="endText" style="max-width:640px; line-height:2.4; text-align:center"></div>
      <div class="mf-menu">
        <button class="mf-item" data-act="restart">Begin Again</button>
        <button class="mf-item" data-act="quit">Return to the Title</button>
      </div>
    </div>

    <div class="mf-screen hidden" id="scr-settings">
      <div class="mf-title" style="font-size:clamp(24px,3.4vw,40px)">SETTINGS</div>
      <div class="mf-tabs" id="setTabs">
        <button class="mf-tab sel" data-tab="graphics">Graphics</button>
        <button class="mf-tab" data-tab="audio">Audio</button>
        <button class="mf-tab" data-tab="controls">Controls</button>
        <button class="mf-tab" data-tab="access">Accessibility</button>
      </div>
      <div class="mf-settings" id="setBody"></div>
      <div class="mf-menu" style="margin-top:22px">
        <button class="mf-item" data-act="setback">Back</button>
      </div>
    </div>`;
  }

  _q() {
    const g = (id) => document.getElementById(id);
    this.el = {
      hud: g('hud'), hpFill: g('hpFill'), hpLag: g('hpLag'), stamFill: g('stamFill'), stamBar: g('stamBar'),
      flasks: g('flasks'), bossBar: g('bossBar'), bossFill: g('bossFill'), bossLag: g('bossLag'),
      poiseFill: g('poiseFill'), bossTicks: g('bossTicks'), bossName: g('bossName'),
      prompts: g('prompts'), toast: g('toast'), subtitle: g('subtitle'), perf: g('perf'),
      screens: {
        start: g('scr-start'), pause: g('scr-pause'), death: g('scr-death'),
        victory: g('scr-victory'), ending: g('scr-ending'), settings: g('scr-settings'),
      },
      setBody: g('setBody'), setTabs: g('setTabs'), endText: g('endText'),
    };
    this._hpLagV = 1; this._bossLagV = 1;
    this._buildFlasks(5);
    this._buildTicks();
    this.setPrompts([
      { key: 'LMB', pad: 'RT', label: 'Attack' },
      { key: 'RMB', pad: 'RB', label: 'Heavy' },
      { key: 'SPC', pad: 'A', label: 'Dodge' },
    ]);
  }

  _bind() {
    this.root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      bus.emit(EVT.SFX, { id: 'uiSelect', gain: 0.5 });
      this.game.uiAction(b.dataset.act);
    });
    this.root.addEventListener('mouseover', (e) => {
      if (e.target.closest('.mf-item')) bus.emit(EVT.SFX, { id: 'uiMove', gain: 0.3 });
    });
    this.el.setTabs.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]');
      if (!t) return;
      for (const x of this.el.setTabs.children) x.classList.toggle('sel', x === t);
      this.renderSettings(t.dataset.tab);
      bus.emit(EVT.SFX, { id: 'uiMove', gain: 0.4 });
    });
    bus.on(EVT.TOAST, ({ text }) => this.toast(text));
    bus.on(EVT.SETTINGS_CHANGE, ({ key }) => { if (key === 'uiScale' || key === '*') this.applyScale(); });
  }

  applyScale() { this.root.style.setProperty('--s', settings.get('uiScale')); }

  _buildFlasks(n) {
    this.el.flasks.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const d = document.createElement('div');
      d.className = 'mf-flask on';
      this.el.flasks.appendChild(d);
    }
  }
  _buildTicks() {
    this.el.bossTicks.innerHTML = '';
    for (const p of [0.32, 0.68]) {
      const i = document.createElement('i');
      i.style.left = (p * 100) + '%';
      this.el.bossTicks.appendChild(i);
    }
  }

  setPrompts(list) {
    this.el.prompts.innerHTML = list.map((p) => `
      <div class="mf-prompt"><span class="mf-key">${input.usingPad ? p.pad : p.key}</span><span>${p.label}</span></div>
    `).join('');
    this._promptList = list;
  }

  showBossBar(show, name) {
    this.el.bossBar.classList.toggle('show', show);
    if (name) this.el.bossName.textContent = name;
  }

  toast(text, dur = 2.6) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('show');
    this._toastTimer = dur;
  }

  subtitle(text, dur = 3.4) {
    if (!settings.get('subtitles')) return;
    this.el.subtitle.textContent = text;
    this.el.subtitle.classList.add('show');
    this._subTimer = dur;
  }

  screen(name) {
    for (const [k, el] of Object.entries(this.el.screens)) {
      const on = k === name;
      if (on) { el.classList.remove('hidden'); requestAnimationFrame(() => el.classList.add('show')); }
      else { el.classList.remove('show'); setTimeout(() => { if (!el.classList.contains('show')) el.classList.add('hidden'); }, 600); }
    }
    this.el.hud.classList.toggle('dim', name !== null && name !== 'pause');
    this._current = name;
  }

  hideAll() { this.screen(null); }

  update(dt, state) {
    if (this._toastTimer > 0) { this._toastTimer -= dt; if (this._toastTimer <= 0) this.el.toast.classList.remove('show'); }
    if (this._subTimer > 0) { this._subTimer -= dt; if (this._subTimer <= 0) this.el.subtitle.classList.remove('show'); }

    const p = state.player;
    if (p) {
      const hp = p.health / p.maxHealth;
      this.el.hpFill.style.transform = `scaleX(${hp})`;
      this._hpLagV += (hp - this._hpLagV) * Math.min(1, dt * 2.2);
      if (this._hpLagV < hp) this._hpLagV = hp;
      this.el.hpLag.style.transform = `scaleX(${this._hpLagV})`;
      const st = p.stamina / p.maxStamina;
      this.el.stamFill.style.transform = `scaleX(${st})`;
      this.el.stamBar.classList.toggle('low', st < 0.25);
      const fl = this.el.flasks.children;
      if (fl.length !== p.maxHealCharges) this._buildFlasks(p.maxHealCharges);
      for (let i = 0; i < fl.length; i++) fl[i].classList.toggle('on', i < p.healCharges);
    }

    const b = state.boss;
    if (b) {
      const h = b.health / b.maxHealth;
      this.el.bossFill.style.transform = `scaleX(${h})`;
      this._bossLagV += (h - this._bossLagV) * Math.min(1, dt * 1.4);
      if (this._bossLagV < h) this._bossLagV = h;
      this.el.bossLag.style.transform = `scaleX(${this._bossLagV})`;
      this.el.poiseFill.style.transform = `scaleX(${b.staggered ? 0 : b.poise / b.maxPoise})`;
    }

    if (this._promptDirty !== input.usingPad) {
      this._promptDirty = input.usingPad;
      if (this._promptList) this.setPrompts(this._promptList);
    }

    if (this._perfOn && state.stats) {
      const s = state.stats;
      this.el.perf.textContent =
        `${s.fps.toFixed(0)} fps  ${s.ms.toFixed(1)} ms\n` +
        `draw ${s.calls}  tris ${(s.tris / 1000).toFixed(0)}k\n` +
        `tier ${s.tier}  dpr ${s.dpr}\n` +
        `geo ${s.geometries} tex ${s.textures} prog ${s.programs}`;
    }
  }

  togglePerf(force) {
    this._perfOn = force !== undefined ? force : !this._perfOn;
    this.el.perf.classList.toggle('hidden', !this._perfOn);
  }

  // ------------------------------------------------------------- settings --
  renderSettings(tab = 'graphics') {
    const body = this.el.setBody;
    const rows = [];
    const S = settings;
    const row = (label, control, val = '') =>
      `<div class="mf-row"><label>${label}</label><div style="display:flex;align-items:center;gap:14px">${control}<span class="val">${val}</span></div></div>`;
    const slider = (key, min, max, step) =>
      `<input type="range" data-set="${key}" min="${min}" max="${max}" step="${step}" value="${S.get(key)}">`;
    const select = (key, opts) =>
      `<select data-set="${key}">${opts.map(([v, l]) => `<option value="${v}" ${S.get(key) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const toggle = (key) =>
      `<button class="opt" data-toggle="${key}">${S.get(key) ? 'On' : 'Off'}</button>`;

    if (tab === 'graphics') {
      rows.push(row('Quality preset', select('quality', Object.keys(TIERS).map((k) => [k, TIERS[k].label]))));
      rows.push(row('Adaptive quality', toggle('adaptive'), 'auto-scales to hold target fps'));
      rows.push(row('Target frame rate', select('targetFps', [[30, '30'], [60, '60'], [120, '120']])));
      rows.push(row('Field of view', slider('fov', 45, 80, 1), S.get('fov') + '°'));
      rows.push(row('Film grain', slider('grainAmount', 0, 1.5, 0.05), Math.round(S.get('grainAmount') * 100) + '%'));
      rows.push(`<div class="mf-note">Presets set shadow resolution, water reflection scale, particle budget, post-processing and instancing density. Adaptive quality steps the tier down automatically if the frame rate falls below 78% of target.</div>`);
    } else if (tab === 'audio') {
      rows.push(row('Master', slider('master', 0, 1, 0.01), Math.round(S.get('master') * 100) + '%'));
      rows.push(row('Music', slider('music', 0, 1, 0.01), Math.round(S.get('music') * 100) + '%'));
      rows.push(row('Effects', slider('sfx', 0, 1, 0.01), Math.round(S.get('sfx') * 100) + '%'));
      rows.push(row('Ambience', slider('ambience', 0, 1, 0.01), Math.round(S.get('ambience') * 100) + '%'));
      rows.push(`<div class="mf-note">All audio is synthesised at runtime — there are no sound files.</div>`);
    } else if (tab === 'controls') {
      rows.push(row('Mouse sensitivity', slider('mouseSensitivity', 0.2, 3, 0.05), S.get('mouseSensitivity').toFixed(2) + '×'));
      rows.push(row('Gamepad sensitivity', slider('padSensitivity', 0.2, 3, 0.05), S.get('padSensitivity').toFixed(2) + '×'));
      rows.push(row('Invert Y', toggle('invertY')));
      rows.push(row('Invert X', toggle('invertX')));
      rows.push(row('Controller vibration', toggle('vibration')));
      rows.push(row('Difficulty', select('difficulty', [['pilgrim', 'Pilgrim — forgiving'], ['wanderer', 'Wanderer — intended'], ['drowned', 'Drowned — punishing']])));
      rows.push(`<div class="mf-note">Keyboard: WASD move · Shift sprint · LMB light · RMB heavy · Space dodge · Q heal · F lock-on · Esc pause · F1 performance overlay.<br>Gamepad: left stick move · right stick camera · RT light · RB heavy · A dodge · B heal · R3 lock-on · Start pause.</div>`);
    } else {
      rows.push(row('Camera shake', slider('cameraShake', 0, 1, 0.05), Math.round(S.get('cameraShake') * 100) + '%'));
      rows.push(row('Screen flash', slider('screenFlash', 0, 1, 0.05), Math.round(S.get('screenFlash') * 100) + '%'));
      rows.push(row('UI scale', slider('uiScale', 0.75, 1.6, 0.05), S.get('uiScale').toFixed(2) + '×'));
      rows.push(row('Subtitles', toggle('subtitles')));
      rows.push(row('High-contrast telegraphs', toggle('highContrastTells'), 'brighter attack warnings'));
      rows.push(row('Colour-blind safe tells', toggle('colourBlindSafeTells'), 'blue instead of yellow-green'));
      rows.push(`<div class="mf-note">Attack telegraphs are always shown as a shape and a sound as well as a colour, so colour is never the only signal.</div>`);
    }
    body.innerHTML = rows.join('');

    body.oninput = (e) => {
      const k = e.target.dataset.set;
      if (!k) return;
      const v = e.target.type === 'range' ? parseFloat(e.target.value) : e.target.value;
      settings.set(k, isNaN(v) ? e.target.value : (k === 'quality' || k === 'difficulty' ? e.target.value : v));
      this.renderSettings(tab);
    };
    body.onchange = body.oninput;
    body.onclick = (e) => {
      const k = e.target.dataset.toggle;
      if (!k) return;
      settings.set(k, !settings.get(k));
      bus.emit(EVT.SFX, { id: 'uiSelect', gain: 0.4 });
      this.renderSettings(tab);
    };
  }

  showEnding(stats) {
    const mins = Math.floor(stats.time / 60), secs = Math.floor(stats.time % 60);
    this.el.endText.innerHTML = `
      The water is only water.<br>
      The lanterns still burn, and no one lights them.<br><br>
      <span style="opacity:.6; font-size:11px; letter-spacing:.3em">
        VIGIL ${mins}:${String(secs).padStart(2, '0')} &nbsp;·&nbsp; DEATHS ${stats.deaths} &nbsp;·&nbsp;
        HITS ${stats.hits} &nbsp;·&nbsp; ${settings.get('difficulty').toUpperCase()}
      </span>`;
  }
}

export default UI;
