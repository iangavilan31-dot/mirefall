# MIREFALL

A cinematic dark-fantasy third-person action game that runs in a desktop browser.
You are a small amphibian warrior, thigh-deep in a flooded swamp kingdom, fighting a
colossal moth deity beneath a hazy moon.

Built with Three.js. **No image, audio, or model assets** — every texture, mesh, sound and
piece of music in the game is generated procedurally at load time.

---

## Run it

```bash
npm install
npm run dev
```

Then open **http://localhost:5135/**.

A production build:

```bash
npm run build
npm run preview
```

`dist/` is fully static — any web server will do. First load spends ~1–2 s synthesising
textures; the loading bar reports progress.

### Requirements
A desktop browser with WebGL2 (Chrome, Edge, Firefox, Safari 15+). A discrete or modern
integrated GPU is recommended for the `High` preset; the game auto-detects a starting tier
and will step quality down on its own if the frame rate drops.

---

## Controls

|  | Keyboard / mouse | Gamepad |
|---|---|---|
| Move | `W A S D` | Left stick |
| Camera | Mouse | Right stick |
| Light attack | Left mouse | `RT` / `X` |
| Heavy attack | Right mouse | `RB` / `Y` |
| Dodge | `Space` | `A` / `LB` |
| Sprint | `Shift` | `LT` |
| Heal | `Q` or `R` | `B` |
| Lock on | `F` or middle mouse | `R3` |
| Pause | `Esc` | `Start` |
| Performance overlay | `F1` | — |

Controller is hot-pluggable; on-screen prompts switch between keyboard and pad glyphs
automatically based on your last input. Rumble is supported where the browser exposes it.

---

## The fight

The deity hovers ~26 m above the arena, so you can never reach its head in normal play.
**Its legs are the weak point.** Punishing them breaks its poise; it crashes down, and its
head becomes hittable for a burst window at 2.5× damage. That is what turns the scale
difference from a camera trick into a mechanic.

Three phases, each adding attacks and altering the arena:

1. **Phase 1** — leg slams, spore fall, wing gusts.
2. **Phase 2** — adds a diving sweep and summoned mire-spawn. Broken shrine pillars rise
   from the water.
3. **Phase 3** — adds *Moonfall*, an arena-wide strike you must take cover from behind a
   pillar. The lanterns go out, the fog thickens and the water darkens.

Every attack has an anticipation telegraph (a ground decal that closes as the strike
approaches, an eye flare, and a distinct sound), an impact, and a recovery you can punish.

Progress is checkpointed at each phase transition — **Continue** on the title screen resumes
from the last phase reached.

---

## Settings

`Esc` → Settings, or from the title screen. Four tabs:

- **Graphics** — five quality presets (Potato → Ultra) controlling shadow resolution, water
  reflection scale, particle budget, post-processing and instancing density; adaptive quality;
  target frame rate; field of view; film grain.
- **Audio** — master, music, effects, ambience.
- **Controls** — mouse and pad sensitivity, invert axes, vibration, difficulty
  (Pilgrim / Wanderer / Drowned).
- **Accessibility** — camera shake, screen flash, UI scale, subtitles, high-contrast
  telegraphs, colour-blind-safe telegraphs.

Attack telegraphs are always signalled by **shape and sound as well as colour**, so colour is
never the only channel.

---

## Development tooling

The game exposes a scripted debug surface at `window.__MIREFALL__` (see
`src/debug/DebugApi.js`) — forced phases and attacks, repeatable camera framings, teleports,
quality switching and a frame-time sampler. Everything below drives the real game through it
in headless Chromium.

```bash
npm run smoke     # end-to-end playable-loop gate — must stay green
npm run shots     # repeatable named screenshot suite -> captures/
npm run perf      # frame-time report across tiers and scenarios
npm run progress  # live build-progress page on :5136
```

`docs/ART_TARGET.md` is the art bible: a forensic, measured description of the single
reference frame this game is built to match. It is the specification every visual decision is
judged against.

`docs/ARCHITECTURE.md` describes the module layout and the contracts between systems.
