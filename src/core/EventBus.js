/** Tiny synchronous pub/sub. Systems communicate through this, never by reaching into each other. */
class EventBus {
  constructor() { this.map = new Map(); }
  on(evt, fn) {
    if (!this.map.has(evt)) this.map.set(evt, new Set());
    this.map.get(evt).add(fn);
    return () => this.off(evt, fn);
  }
  once(evt, fn) {
    const un = this.on(evt, (...a) => { un(); fn(...a); });
    return un;
  }
  off(evt, fn) { const s = this.map.get(evt); if (s) s.delete(fn); }
  emit(evt, payload) {
    const s = this.map.get(evt);
    if (!s) return;
    for (const fn of Array.from(s)) {
      try { fn(payload); } catch (e) { console.error(`[bus] ${evt}`, e); }
    }
  }
  clear() { this.map.clear(); }
}

export const bus = new EventBus();

/** Canonical event names — keep this list authoritative so agents don't invent duplicates. */
export const EVT = {
  STATE_CHANGE:    'state:change',      // {from,to}
  PLAYER_HIT:      'player:hit',        // {damage,dir,source}
  PLAYER_DEAD:     'player:dead',
  PLAYER_HEAL:     'player:heal',       // {amount}
  PLAYER_ATTACK:   'player:attack',     // {type:'light'|'heavy', index}
  PLAYER_DODGE:    'player:dodge',      // {dir}
  PLAYER_STEP:     'player:step',       // {pos, speed}
  HIT_LANDED:      'combat:hit',        // {pos,normal,damage,target,heavy}
  PARRY:           'combat:parry',
  BOSS_HIT:        'boss:hit',          // {damage,pos,part}
  BOSS_PHASE:      'boss:phase',        // {phase}
  BOSS_TELEGRAPH:  'boss:telegraph',    // {attack,duration}
  BOSS_ATTACK:     'boss:attack',       // {attack}
  BOSS_STAGGER:    'boss:stagger',
  BOSS_DEAD:       'boss:dead',
  ENEMY_DEAD:      'enemy:dead',        // {pos}
  WATER_IMPACT:    'water:impact',      // {pos, strength, radius}
  CAMERA_SHAKE:    'camera:shake',      // {amount, duration}
  SFX:             'audio:sfx',         // {id, pos, gain, rate}
  MUSIC:           'audio:music',       // {cue}
  SETTINGS_CHANGE: 'settings:change',   // {key,value}
  CHECKPOINT:      'game:checkpoint',
  TOAST:           'ui:toast',          // {text}
};

export default bus;
