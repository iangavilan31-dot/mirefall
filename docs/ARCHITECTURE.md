# Architecture

Plain JavaScript ES modules, Three.js r180, Vite. No framework, no asset pipeline, no build
step beyond bundling. ~1 unit = 1 metre throughout.

## Module map

```
src/
  main.js                bootstrap, RAF loop, audio arming, fatal-error surface
  core/
    Game.js              state machine + per-frame orchestration (owns render order)
    Engine.js            renderer, scene, camera, sizing, frame-budget sampling
    Input.js             keyboard + mouse + gamepad -> unified action state
    Settings.js          quality tiers, audio, controls, accessibility; localStorage
    EventBus.js          synchronous pub/sub; EVT is the authoritative event-name list
    Palette.js           SHARED ART CONTRACT — colours + world scale constants
  render/
    Sky.js               fog-coloured dome, hazy moon disc, halo, scattering wedge
    Lighting.js          moon key, hemisphere ambient, cold fill, lantern light pool
    FogSystem.js         instanced drifting fog cards + ground mist, body-displaced
    PostFX.js            scene target -> DOF -> bloom -> grade -> SMAA -> output
  world/
    TextureLab.js        procedural texture synthesis (all materials originate here)
    Water.js             planar reflection + ripple sampling + murk + scum shader
    RippleSim.js         GPU heightfield wave equation, ping-pong FBOs
    World.js             authored environment composition, props, arena alteration
  player/
    PlayerModel.js       procedural amphibian rig (transform hierarchy, no skinning)
    Player.js            movement, combat state machine, damage, healing, animation
  boss/
    BossModel.js         moth deity geometry + backlit membrane wing shader
    Boss.js              phases, attack selection, telegraphs, hazards, poise, death
  enemies/Enemy.js       lesser mire-spawn: emerge, chase, wind up, strike
  fx/Effects.js          pooled particles, shockwave rings, sword trail, splashes
  audio/Audio.js         WebAudio synthesis: ambience, adaptive score, SFX library
  ui/UI.js               HUD, menus, settings, state screens
  camera/CameraRig.js    third-person rig, lock-on, collision, shake, framing bias
  debug/DebugApi.js      window.__MIREFALL__ automation surface
```

## Contracts

**`core/Palette.js` is the single source of colour and scale.** Modules import `PALETTE` and
`SCALE`; no module defines its own colours. Colours are plain `THREE.Color(hex)` — three's
ColorManagement converts sRGB→linear on assignment, so converting again in user code darkens
everything twice (this was a real bug).

**`core/EventBus.js` is the only cross-system channel.** Systems never reach into each other.
`EVT` enumerates every event name so parallel contributors don't invent duplicates.

**`core/Settings.js` `settings.q` is the resolved quality tier.** Every renderer-cost decision
(shadow map size, reflection scale, particle budget, instancing density, post passes) reads
from it rather than hardcoding. `engine:quality` is broadcast on change so systems rebuild.

## Frame order

Order matters and is owned by `Game.frame()`:

1. Input poll → global hotkeys → state transitions.
2. Simulation at the current time scale (player → boss → enemies). Menus freeze simulation but
   keep *ambient* shader time advancing, so the world is never frozen behind a menu.
3. World, fog, effects, water update.
4. Camera (or the title orbit).
5. Lighting and sky follow the camera/player.
6. Audio listener + adaptive intensity.
7. **Water reflection pass**, then **post-processing composite**.

### Why the reflection is a visibility toggle, not a layer mask

`Water.excludeFromReflection` hides specific objects for the duration of the reflection render.
Layers cannot express "visible normally, absent from this one pass": `layers.set(n)` also
removes the object from the main camera, and an object on `{0,n}` still intersects a `{0}`
camera mask.

### Why the scene renders to its own target

`EffectComposer` builds `renderTarget2` via `renderTarget1.clone()`, and
`WebGLRenderTarget.copy()` assigns `depthTexture` **by reference** — so both ping-pong buffers
share one depth texture. A depth-reading pass (DOF) then samples a texture that is
simultaneously the depth attachment of the framebuffer it is drawing into. That is a feedback
loop; its result is undefined and in practice flattened every frame to a constant. The scene
therefore renders into a dedicated `sceneRT` that owns the depth texture, and the post chain
ping-pongs on plain buffers that never have one attached.

## Encounter design

The scale gap is a mechanic, not decoration. The deity hovers ~26 m up and is unreachable;
`Boss.hitParts()` exposes only the lower legs. Leg damage drains poise; at zero the boss
staggers, the head descends into reach, and `hitParts()` adds a head volume at 2.5× damage.

Attacks are data-driven state machines (`_begin_<name>` / `_run_<name>`) with explicit
windup → active → recovery phases. Damage is applied through pooled *hazards* (expanding rings,
cones, timed areas) rather than per-attack bespoke checks, so telegraphs, decals and damage
stay in sync.

## Performance model

Five quality tiers plus optional adaptive stepping (`Engine.sampleFrame`) that drops a tier
when the frame rate sits below 78% of target and restores it when there is headroom.
Particles, ring decals and effect meshes are pooled at construction; nothing is allocated
during combat. Instanced meshes are used for lilypads, reeds, debris and fog cards.

## Automated verification

`tools/harness.js` boots the real game in headless Chromium and waits for
`window.__MIREFALL_READY__`. Built on it:

- `tools/smoke.js` — the correctness gate. Drives a full run: start, movement under real input,
  damage, every boss attack to completion, all three phases, poise stagger, enemy spawning,
  death, restart, victory, ending, all five quality tiers, and checkpoint save/restore.
- `tools/capture.js` — repeatable named framings resolved against **live** player/boss
  positions, so a shot stays correct wherever a run left them.
- `tools/perf.js` — frame-time percentiles per tier per scenario. Headless Chromium uses a
  software rasteriser, so its absolute numbers are a floor, not a desktop-GPU prediction; the
  meaningful signal is relative movement between tiers, scenarios and passes.
