export const meta = {
  name: 'mirefall-wave1',
  description: 'Seven parallel specialist builders raise Mirefall toward its reference frame',
  phases: [{ title: 'Build', detail: 'one specialist per visual area, isolated worktrees' }],
};

const REPO = 'C:/Projects with Code/creative/mirefall';

const PREAMBLE = (name, port) => `
You are a specialist builder on MIREFALL, a cinematic dark-fantasy third-person action game
in Three.js (r180, Vite, plain JS ESM — NOT TypeScript). A small amphibian warrior fights a
colossal moth deity in a flooded swamp kingdom under a hazy moon.

## Your workspace
You are in an ISOLATED GIT WORKTREE — a private copy of the repo. Your cwd is its root.
Other specialists are editing other files in their own worktrees simultaneously.

Setup, in order (use the Bash tool):
1. \`npm install --no-audit --no-fund\`   (node_modules is not copied into a worktree)
2. Start the dev server in the background: \`npx vite --port ${port} --strictPort\`
   (run_in_background: true). Do NOT use port 5135 — that is the shared project port.
3. All tooling reads the MIREFALL_URL env var. Always invoke it like:
   \`MIREFALL_URL=http://localhost:${port}/ node tools/capture.js --out captures/mine --only hero,gameplay_default\`

## The specification
**READ \`docs/ART_TARGET.md\` FIRST AND IN FULL.** It is a forensic description of the single
reference screenshot that defines this game's look, with measured positions, hex values and
compositional rules. You cannot see the image; that document IS the image. Every judgement you
make must trace back to it. \`src/core/Palette.js\` is the shared colour contract in code.

## Your tools for seeing your own work
- \`node tools/capture.js --out captures/x --only <shot,shot>\` renders repeatable named shots.
  Shot ids: hero, gameplay_default, boss_close, player_close, wide_arena, left_frame, lotus,
  combat_light, telegraph_legslam, telegraph_moonfall, phase2, phase3, stagger, enemies,
  damage, death, boss_death, victory, title.
- **You MUST open the resulting .png files with the Read tool and actually look at them.**
  Do not reason about what the code should produce — look at what it did produce. Iterate
  at least three times: capture -> look -> fix -> capture again.
- \`window.__MIREFALL__\` is a rich debug API (see src/debug/DebugApi.js): forcePhase,
  forceAttack, stagger, teleport, shot, freeCamera, setQuality, startPerf/stopPerf, etc.
  Drive it from your own node scripts via tools/harness.js if you need custom framings.

## Non-negotiable gates before you finish
- \`npm run build\` must succeed.
- \`MIREFALL_URL=http://localhost:${port}/ node tools/smoke.js\` must still pass every check
  (it was 37/37 before you started). If you break a check, fix it.
- Keep 'high' quality above ~45 fps in the headless harness (it is a software rasteriser, so
  treat it as a relative floor, not a desktop number). Never raise draw calls substantially.

## File ownership — STRICT
You may edit ONLY the files listed as yours. Editing any other source file will be discarded
and may break another specialist. You may READ anything. If you need a change in a file you do
not own, describe it in your report instead.

## Handing your work back
When done, copy each file you changed to:
  \`${REPO}/.wave1/${name}/<same relative path>\`
(e.g. src/world/Water.js -> ${REPO}/.wave1/${name}/src/world/Water.js). Create directories as
needed. Also copy your 3-6 best final PNGs to \`${REPO}/.wave1/${name}/shots/\`.
Then report. Your final message is parsed as data, not shown to a human.
`;

const SPECS = [
  {
    name: 'boss-presence', port: 5301,
    files: ['src/boss/BossModel.js', 'src/boss/Boss.js'],
    brief: `
YOUR AREA: the boss — the centrepiece of the entire game.

THE FAILURE YOU MUST FIX: in the current build the deity is **effectively invisible**. In the
'hero' and 'gameplay_default' captures you cannot tell there is a boss at all — its legs read
as ordinary tree trunks, its body is lost in fog, its wings do not register, and its glowing
eyes are not a focal point. ART_TARGET.md §8 requires it to DOMINATE THE SKYLINE.

Acceptance criteria — each must be visible in a capture you have looked at:
1. In 'gameplay_default' and 'hero', the boss is unmistakably a vast winged creature: body/head
   in the upper third, wings exceeding the frame width, silhouette legible against the fog.
2. The four yellow-green ocelli read as the strongest focal point in the frame at ALL distances,
   including through fog in 'wide_arena'. They must bloom but never blow out to white.
3. Moonlight visibly TRANSMITS through the wing membrane — the wings glow where they overlap
   the moon and show silhouetted vein structure. This is the signature effect of the game.
4. The legs read as architecture (bark texture, gnarl, hanging moss) that the player moves
   between — not as smooth grey cylinders.
5. The boss is never static: wing flex, moss sway, leg micro-adjustment, breathing, antennae.
6. Damage reactions and the defeat sequence are legible (capture 'boss_death').
7. Telegraphs stay readable: capture 'telegraph_legslam' and 'telegraph_moonfall'.

Notes: fog density and the moon direction are owned by other specialists this wave — do not
fight them; make the boss work against the CURRENT atmosphere and say in your report if you
need a fog or moon change. Boss hover height, wing span and leg spread are in SCALE in
src/core/Palette.js (read-only for you) — you may compensate within your own files.
The 'legs are the reachable weak point, poise break lowers the head' mechanic must keep working
(smoke.js checks it).`,
  },
  {
    name: 'lighting-values', port: 5302,
    files: ['src/render/Lighting.js', 'src/render/Sky.js', 'src/core/Palette.js'],
    brief: `
YOUR AREA: lighting, the moon, and the overall VALUE STRUCTURE.

THE FAILURE YOU MUST FIX: the current build is washed out and value-inverted. The far field
renders near-WHITE, the water reads bright, and almost nothing in frame is dark. ART_TARGET.md
§3 specifies fog at value ~60 (#8b979c), mid water ~48, dark water ~18, deepest silhouettes ~8,
and the moon disc as the ONLY near-white in the frame (~93). Right now the fog is brighter than
the moon, which destroys the entire image.

Also: **the moon is not visible in frame at all**, despite being the key light, the compositional
crown above the boss, and the source of the wing backlight (§2, §4).

Acceptance criteria:
1. Sample your captures: the fog/far field must sit near value 60, not 90+. The brightest thing
   in any frame must be the moon disc.
2. The moon is clearly visible as a soft hazy disc with a halo in 'hero' and 'wide_arena', high
   in frame, and it crowns the boss.
3. High contrast in the near field, near-zero contrast in the far field (aerial perspective).
   Shadow sides fall to fog colour, never to crushed black.
4. Lanterns remain TINY LOCAL warm points (~3 m falloff) that never warm the fog or the player.
   Verify in 'left_frame'.
5. Nothing in the palette exceeds ~0.18 saturation except the four sanctioned accents.

You own src/core/Palette.js. You may retune its values, but keep every exported key — many
modules import them. If you change SCALE numbers, say so loudly in your report.
The camera, post-processing grade and water are owned by others this wave; report any change
you need from them rather than editing their files.`,
  },
  {
    name: 'water', port: 5303,
    files: ['src/world/Water.js', 'src/world/RippleSim.js'],
    brief: `
YOUR AREA: the water — it is the arena floor and half of the reference frame (ART_TARGET §6).

CURRENT STATE: planar reflection and the GPU ripple simulation both work, but the surface reads
as a bright flat mirror. It is too luminous, the ripple rings around the player are not visibly
reading, wakes and splashes are weak, and there is no sense of murk or depth.

Acceptance criteria:
1. Reflections are vertically smeared and blurred with distance, NOT a clean mirror. Reflection
   strength rises at grazing angles (Fresnel).
2. Concentric ripple rings radiating from the player are clearly visible in 'player_close' at
   all times while standing, and much stronger while moving.
3. The water body is DARK (target values: mid ~48, dark ~18) — it must not out-brighten the fog.
4. Murk: submerged geometry fades out within ~0.4 m rather than reading as a clean floor.
5. Authored duckweed/scum patches break the surface up; the surface is almost still (swells < 4 cm).
6. Wakes trail behind movement and splashes read on dodge and on impacts.
7. The ripple simulation must not cost more than it does now; keep the reflection render at the
   configured quality-tier scale.

Verify with 'player_close', 'hero', 'lotus', 'combat_light'. Water colour keys live in
src/core/Palette.js which another specialist owns this wave — read them, do not edit them.`,
  },
  {
    name: 'environment', port: 5304,
    files: ['src/world/World.js', 'src/world/TextureLab.js'],
    brief: `
YOUR AREA: the environment — architecture, flora, and above all COMPOSITION.

THE FAILURE YOU MUST FIX: placement currently reads as procedural scatter. Dozens of near-identical
broken posts are sprinkled at random radii, which looks generated rather than authored.
ART_TARGET.md §9 is explicit: "placement must be authored, not scattered. Every view should have
a distinct foreground occluder, a mid-ground subject, and a fogged background layer."

Acceptance criteria:
1. BOTH frame edges are occupied by ruined wooden shrine architecture in 'hero',
   'gameplay_default' and 'wide_arena'. This framing is mandatory, not incidental.
2. Giant mushrooms (wide flat mauve caps, pale ridged gills, thick stalks, 12–20 m) act as
   mid-ground silhouette anchors left and right.
3. Dead trees enter the frame from the TOP edge as near-black silhouettes hung with long
   vertical moss curtains.
4. Every capture has readable foreground / mid-ground / background separation.
5. The random post scatter is replaced by deliberate clusters — jetty lines, collapsed walkways,
   groups that imply a village that drowned. Lilypads and reeds cluster, never spread uniformly.
6. Distant motionless hatted villager silhouettes remain barely visible in the fog.
7. The pink lotus stays the single saturated accent and is not multiplied into decoration.

You also own src/world/TextureLab.js (procedural texture synthesis — there are no image assets).
Improve bark, thatch, moss, plank and mushroom-cap textures if they are letting the models down,
but keep every exported function name and keep boot time reasonable (textures are generated at
load). Keep draw calls from rising: prefer InstancedMesh and merged geometry — the scene is
already at ~1079 draw calls which is too high.`,
  },
  {
    name: 'player', port: 5305,
    files: ['src/player/PlayerModel.js', 'src/player/Player.js'],
    brief: `
YOUR AREA: the player character — model, silhouette, animation and movement feel.

THE FAILURE YOU MUST FIX: at gameplay distance the player reads as an indistinct dark blob.
ART_TARGET.md §7 is a silhouette contract: the character must be legible at ~16% of frame height,
and **the wide conical straw hat IS the silhouette** — noticeably wider than the body, with a
ragged dripping fringe of straw and moss around the rim.

Acceptance criteria:
1. In 'gameplay_default' the character is instantly readable as a small hatted swordsman.
   In 'player_close' the hat brim, straw fringe, amphibian head and blade highlight all read.
2. The blade catches a single pale specular highlight along its edge, held down and to the right.
3. The character wades THIGH-DEEP with ripple rings always present at the waterline.
4. Movement has acceleration, deceleration and turning weight; water resistance is felt.
5. Attack commitment is real and recovery is readable. Light combo (3 hits), heavy (2), dodge
   with i-frames, healing. Hit reactions have visible impact.
6. Animation blends rather than snapping between states; the wading gait has high knee lift.
7. Capture 'combat_light' and 'damage' to prove impact and hit reaction read.

Do not weaken the combat timings without saying so — tuning constants are ATTACKS in
src/player/Player.js. smoke.js checks attack/dodge/heal state transitions and must stay green.
Cold olive skin, weathered straw, wet dark cloth — all within the palette, saturation <= 0.18.`,
  },
  {
    name: 'postfx-fog', port: 5306,
    files: ['src/render/PostFX.js', 'src/render/FogSystem.js'],
    brief: `
YOUR AREA: post-processing and volumetric fog.

CONTEXT: the post chain was just repaired (a depth-texture feedback loop was flattening every
frame — read the comments in PostFX.js _build() before touching it, and do NOT reintroduce a
shared depthTexture between the ping-pong buffers). The chain is now:
scene -> sceneRT(depth) -> DOF -> bloom -> grade(vignette/grain/CA/godrays) -> SMAA -> output.

THE FAILURE YOU MUST FIX: the grade is washing the image out. The far field reads near-white
when ART_TARGET §3 wants fog at value ~60 with the moon as the only near-white. Contrast, lift
and desaturation need retuning so the image is COLD, WET and desaturated rather than bright and
milky. Bloom is also currently strong enough to blow small bright objects to pure white.

Acceptance criteria:
1. Values land where §3 specifies; the moon disc is the brightest thing in frame, not the fog.
2. Bloom blooms the moon, the boss eyes, lanterns and the lotus WITHOUT clipping them to flat
   white discs. Check 'boss_close' and 'left_frame'.
3. God rays from the moon read as soft shafts, not a radial smear over the whole frame.
4. DOF keeps the near/mid crisp and softens only the far field. It must not blur the player.
5. Fog (FogSystem.js) is animated: slow drifting sheets low over the water, thicker ground mist
   in the lowest ~1.5 m, displaced by the player and by the boss when it is low. Fog must hide
   every world boundary — if you can see where the water ends, the fog is wrong.
6. Fog cards are an ACCENT over the exponential fog. An earlier pass used ~200 cards and buried
   the scene in flat grey; the current ~52 is the safe direction. Do not push count back up.
7. Grain, chromatic aberration and vignette stay subtle — cinematic, not stylised.

The moon direction and colour live in src/render/Sky.js which another specialist owns this
wave — read it, do not edit it.`,
  },
  {
    name: 'camera', port: 5307,
    files: ['src/camera/CameraRig.js'],
    brief: `
YOUR AREA: the third-person camera — framing, feel, lock-on, collision, shake.

THE FAILURE YOU MUST FIX: the gameplay camera does not preserve the reference composition.
ART_TARGET.md §2 requires the player LOW and LEFT-OF-CENTRE (roughly the lower-left third
intersection) with the boss dominating the upper frame. Currently the player sits centred and
the boss is rarely framed at all. The user's brief is explicit that "the screenshot should remain
recognisable during actual gameplay, not only from one fixed camera angle."

Acceptance criteria:
1. In 'gameplay_default' with lock-on active, the player occupies roughly the lower-left third
   and the boss's head and wings fill the upper frame. Verify by looking at the capture.
2. Framing adapts to the boss's enormous size — it must fit without the player becoming a speck,
   and must not whip around when the boss moves.
3. Camera collision pulls in smoothly past architecture without jitter, and never dips below the
   waterline. (It currently ignores transparent drapery deliberately — keep that.)
4. Movement has weight: critically damped follow, snappier laterally than vertically.
5. Shake is punchy on impact but scales with the accessibility 'cameraShake' setting and never
   induces nausea. Lock-on acquisition and release are smooth.
6. Free (unlocked) camera still frames the world well — check 'wide_arena' style angles by
   driving M.game.rig directly.

You own ONLY src/camera/CameraRig.js. The named capture framings live in src/core/Game.js
(_buildCaptureRig) which you must NOT edit — if a shot preset needs changing, say so in your
report. Player and boss are owned by others; do not edit them.`,
  },
];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'filesChanged', 'criteriaMet', 'remaining', 'gates'],
  properties: {
    summary: { type: 'string', description: 'What you changed and why, 4-10 sentences.' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    criteriaMet: {
      type: 'array',
      description: 'One entry per numbered acceptance criterion.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['criterion', 'met', 'evidence'],
        properties: {
          criterion: { type: 'string' },
          met: { type: 'boolean' },
          evidence: { type: 'string', description: 'Which capture you looked at and what you saw. Be concrete.' },
        },
      },
    },
    remaining: { type: 'array', items: { type: 'string' }, description: 'Honest list of what is still weak in your area.' },
    needFromOthers: { type: 'array', items: { type: 'string' } },
    gates: {
      type: 'object',
      additionalProperties: false,
      required: ['buildPasses', 'smokePassed', 'smokeTotal'],
      properties: {
        buildPasses: { type: 'boolean' },
        smokePassed: { type: 'number' },
        smokeTotal: { type: 'number' },
        fpsHigh: { type: 'number' },
        drawCalls: { type: 'number' },
      },
    },
    dropPath: { type: 'string', description: 'Absolute path of the .wave1/<name>/ folder you copied your files into.' },
  },
};

phase('Build');
log(`Wave 1: ${SPECS.length} specialists building in isolated worktrees`);

const results = await parallel(SPECS.map((s) => () =>
  agent(
    PREAMBLE(s.name, s.port) +
    `\n## YOUR OWNED FILES (edit nothing else)\n${s.files.map((f) => '  - ' + f).join('\n')}\n` +
    s.brief +
    `\n\nWork until your acceptance criteria are genuinely met, not until the code compiles. ` +
    `Be honest in your report — a criterion you did not achieve must be reported met:false.`,
    { label: `build:${s.name}`, phase: 'Build', schema: SCHEMA, isolation: 'worktree' }
  ).then((r) => (r ? { spec: s.name, files: s.files, ...r } : { spec: s.name, files: s.files, failed: true }))
));

const ok = results.filter(Boolean);
log(`Wave 1 complete: ${ok.filter((r) => !r.failed).length}/${SPECS.length} specialists reported`);
return { wave: 1, results: ok };
