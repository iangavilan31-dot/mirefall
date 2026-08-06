# ART TARGET — the reference frame

> This is a forensic description of the single reference screenshot that defines this game's look.
> **Sub-agents cannot see the image. This document IS the image.** Treat every number as a
> measured target, not a suggestion. When a critic says "does not match the target", they mean
> this document.

Coordinates are given as **percentages of frame width (x) and height (y)**, origin top-left,
for a 16:9 frame. "Value" means perceptual lightness 0 (black) – 100 (white).

---

## 1. One-sentence read

A tiny mossy amphibian swordsman stands thigh-deep in still, reflective black water at the
bottom-left of frame, dwarfed by a colossal moth deity made of hanging moss and dead vegetation
whose translucent wings span the entire sky, backlit by a hazy full moon, framed by ruined
wooden shrine architecture and giant purple mushrooms that dissolve into grey fog.

## 2. Frame composition (memorize these positions)

| Element | x | y | Notes |
|---|---|---|---|
| Player (amphibian warrior) | **31%** | **72%** | Back three-quarter view. Occupies only ~16% of frame height. |
| Boss head / thorax | **56%** | **35%** | Centre of visual mass. |
| Boss eye cluster | 56% | 36% | 4 glowing ocelli, two larger low + two smaller high. |
| Moon | 56% | 6% | Directly above the boss head — it *crowns* the boss. |
| Wing span | **18% → 95%** | 3% → 45% | Wings occupy nearly the full frame width. |
| Left giant mushroom | 17% | 24% | Cap is a wide flat disc. |
| Right giant mushroom | 85% | 25% | Mirrors the left, slightly smaller. |
| Right torii / gate ruin | 88–100% | 20–70% | Hard vertical frame on the right edge. |
| Left lantern (on gate) | 7% | 45% | Warm point, tiny. |
| Right lanterns | 91%,37% and 97%,52% | | Warm points, tiny. |
| Distant villagers/huts | 8%, 15%, 21% | 62% | Three small hatted silhouettes, mid-fog. |
| **Pink lotus** | **81%** | **73%** | The single saturated accent in the frame. ~3% of frame width. |
| Foreground lilypads | bottom edge, 0–30% and 55–95% | 82–100% | Slightly soft, darkest greens. |
| Control prompts UI | 90–99% | 84–95% | Three rows, bottom-right, low opacity. |

**Rule of thirds:** the player sits on the lower-left third intersection. The boss head sits
slightly right of centre on the upper-third line. Do not centre the player.

## 3. Palette (hard values — sample these)

The palette is **desaturated, cold, and wet**. Saturation above ~15% is forbidden except for
three sanctioned accents.

| Role | Hex | Value | Where |
|---|---|---|---|
| Fog / far field | `#8b979c` | 60 | Everything beyond ~40 m collapses to this |
| Mid water | `#6e7b80` | 48 | Broad water surface |
| Dark water / shadow | `#2b3236` | 18 | Near water, under structures |
| Deepest silhouette | `#12171a` | 8 | Boss legs, foreground trees, roofs |
| Moon disc | `#e9eef0` | 93 | Only near-white in frame |
| Wing membrane (backlit) | `#b9c2c2` → `#7c8688` | 75 → 53 | Bright near moon, dark at tips |
| Moss / vegetation | `#4a5340` (cold olive) | 32 | Sat ≤ 18% |
| Mushroom cap | `#8a7a9e` → `#a08bb8` | 52 → 60 | **Accent 1** — muted mauve, sat ~22% |
| Lantern glow | `#ffb85c` core, `#e8933a` halo | 80 | **Accent 2** — warm, tiny, local only |
| Boss eyes | `#d8e05a` → `#c9d24e` | 85 | **Accent 3** — sickly yellow-green |
| Lotus | `#ff7cc0` core, `#f06ab0` petals | 70 | **Accent 4** — the ONLY high-saturation object |

Sanctioned saturated area budget: lanterns + eyes + lotus together must occupy **< 1.5% of
frame pixels**. If the frame looks colourful, it is wrong.

## 4. Lighting model

- **One key light**: the moon. Cold (`#cdd9e0`), high, slightly behind the boss. It is the only
  light that shapes form. It rim-lights the player's hat brim and shoulders, and it **transmits
  through the wing membrane** — this backlit-translucency is the signature effect of the frame.
- **Lanterns are not light sources for the scene.** They are self-luminous points with a small
  warm halo and a short reflection streak on the water. Their falloff radius is ~3 m. They must
  never warm the fog or the player.
- **Boss eyes** emit a soft bloom but cast almost no light.
- **No fill light.** Shadow side of everything falls to fog colour, not black — aerial
  perspective, not crushed blacks.
- Contrast is **high in the near field** (player, foreground lilypads) and **almost zero in the
  far field** (huts, distant trees are flat grey shapes).

## 5. Fog & atmospheric depth

Fog is the primary depth cue and hides all world boundaries.

- Exponential-squared fog, colour `#8b979c`, calibrated so a mid-grey object at 40 m reads at
  ~70% fog blend and at 70 m is indistinguishable from the fog.
- **There is no visible horizon line and no visible sky except the moon's glow.** If the player
  can see where the water ends, the fog is wrong.
- Fog is **animated**: slow drifting sheets low over the water (0.15–0.4 m/s), plus thicker
  ground mist in the lowest 1.5 m that the player and boss legs displace.
- Layered scattering: a brighter fog wedge under the moon, darker fog in the frame corners.

## 6. Water

Water covers the bottom ~40% of the frame and is the arena floor.

- **Reflective but not a mirror**: vertical smeared reflections of the moon, lanterns and boss
  legs, blurred proportional to distance and roughness. Reflection strength rises at grazing
  angles (Fresnel).
- Surface is **almost still**: long, low-amplitude swells (< 4 cm), not choppy waves.
- Concentric **ripple rings** radiate from the player at all times while standing, and much
  stronger while moving.
- Wakes trail behind movement; **splashes** on dodge, on attack impact, on boss footfalls.
- Scattered flat lilypad clusters, dark green, deliberately grouped — never uniformly scattered.
- Underwater is opaque within ~0.4 m — you see submerged shins fading, not a clean floor.

## 7. The player — silhouette contract

- **Read at 16% of frame height.** The silhouette must be legible at that size.
- **The conical hat is the silhouette.** A wide, low thatch/straw *kasa* — noticeably wider than
  the body — with a ragged dripping fringe of straw and moss around its rim.
- Body: hunched, round, heavy. A mossy shell/cloak over the back. Short thick limbs. Amphibian
  proportions: broad flat head, wide mouth, low stance.
- Weapon: a long, straight, slightly worn blade held down and to the right, tip near the water,
  catching a single pale specular highlight along its edge.
- Wades **thigh-deep**. Ripple rings always present at the waterline.
- Colours: cold olive-green skin, weathered straw hat, wet dark cloth. All within the palette.

## 8. The boss — presence contract

- **It must dominate the skyline.** From gameplay camera, the boss head should sit near the top
  third and the wings should exceed the frame width. If the boss ever fits comfortably in frame,
  scale is wrong.
- Construction: the body is **not a clean insect**. It is a mass of hanging moss, vines, dead
  branches and rotted cloth in the *shape* of a moth — like a drowned tree canopy that learned
  to fly.
- **Wings**: two enormous pairs, tattered at the edges, veined, dirty translucent. Moonlight
  passes through them; they glow brightest where they overlap the moon. They must be visibly
  thin — see-through, with silhouetted vein structure.
- **Eyes**: 4 glowing ocelli, warm yellow-green, soft bloom. They are the focal point of the
  entire frame and must remain readable through fog at all distances.
- **Legs**: 6+ colossal spindly legs like tree trunks, splayed wide, descending into the water,
  draped in hanging moss strands. They read as architecture — the player runs *between* them.
- Long drooping antennae. Constant slow motion: wing flex, moss sway, leg micro-adjustment,
  breathing. **The boss is never static.**

## 9. Environment framing

- **Both frame edges are occupied by ruined wooden shrine architecture** — torii gates, collapsed
  roofs, walkway posts — hung with moss and small warm lanterns. This framing is mandatory in the
  gameplay camera, not just the hero shot.
- **Giant mushrooms**: wide flat mauve caps on thick pale stalks, ~12–20 m tall, with pale ridged
  gills underneath. Placed as mid-ground silhouette anchors, left and right.
- **Dead trees**: bare, black, hung with long vertical moss curtains, entering frame from the top
  edge. They are near-black silhouettes, not detailed models.
- Distant hatted villager silhouettes standing motionless in the water, barely visible.
- **Placement must be authored, not scattered.** Every view should have a distinct foreground
  occluder, a mid-ground subject, and a fogged background layer.

## 10. Motion & tone

- Ambient movement is **slow and oppressive**: drifting fog, slow wing beats, swaying moss,
  spreading ripples. Nothing darts.
- Combat is the violent exception — attacks are fast and punctuated, which only works because
  everything around them is slow.
- The frame is **quiet**. Reverent. The player is an intruder in something's temple.

## 11. UI

- Bottom-right control prompts: dark circular glyph + label, white at ~55% opacity, small.
- No frames, no boxes, no gradients, no bright colours. UI must be nearly invisible.
- Health/stamina must be equally restrained and must not break the palette.

---

## 12. Automated verification hooks

`tools/capture.js` reproduces these named camera setups. Critics compare against this document.

| Shot id | What it must prove |
|---|---|
| `hero` | The reference frame, recreated: player low-left, boss crowned by moon, wings full-width. |
| `gameplay_default` | The same qualities hold from the normal over-shoulder combat camera. |
| `boss_close` | Wing translucency, moss detail, eye bloom at close range. |
| `player_close` | Hat silhouette, fringe, blade highlight, waterline ripples. |
| `wide_arena` | Fog hides world limits; both edges framed by architecture. |
| `phase2` / `phase3` | Arena alteration is visible and readable. |
| `lotus` | The pink accent reads as the only saturated object. |
| `death` / `victory` | State screens hold the palette. |
