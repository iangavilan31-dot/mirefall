export const meta = {
  name: 'mirefall-wave2-critique',
  description: 'Demanding critics inspect the running merged build, then an integration playthrough and a perf audit',
  phases: [
    { title: 'Critique', detail: 'independent critics, fresh context, real gameplay' },
    { title: 'Integrate', detail: 'one agent plays the whole game start to finish' },
    { title: 'Profile', detail: 'exclusive performance audit' },
  ],
};

const URL = 'http://localhost:5135/';

const CRITIC_PREAMBLE = `
You are a CRITIC on MIREFALL, a cinematic dark-fantasy third-person action game in Three.js.
A small amphibian warrior fights a colossal moth deity in a flooded swamp kingdom under a moon.

You did not build this. You have fresh eyes and no stake in it. Your job is to find what is
WRONG, with evidence, and to name the single biggest remaining weakness in your area.

## The bar
The standard is NOT "good for Three.js". The standard is a modern AAA dark-fantasy third-person
action game — Sekiro, Bloodborne, Elden Ring. Judge it against that, and against
\`docs/ART_TARGET.md\`, which is a forensic measured description of the single reference frame
this game exists to reproduce. **Read ART_TARGET.md in full before judging anything.** You
cannot see the reference image; that document IS the image.

## How to inspect — you MUST inspect the running game, not the source
The game is already running at ${URL}. Do NOT start another server on port 5135.

- \`MIREFALL_URL=${URL} node tools/capture.js --out captures/<your-name> --only <ids>\`
  Shot ids: hero, gameplay_default, boss_close, player_close, wide_arena, left_frame, lotus,
  combat_light, telegraph_legslam, telegraph_moonfall, phase2, phase3, stagger, enemies,
  damage, death, boss_death, victory, title.
- **OPEN EVERY PNG WITH THE Read TOOL AND LOOK AT IT.** A judgement not grounded in an image
  you actually looked at, or in a measurement you actually took, is worthless — do not make one.
- For anything the named shots don't cover, write your own script against \`tools/harness.js\`
  (see tools/capture.js for the pattern). \`window.__MIREFALL__\` (src/debug/DebugApi.js) gives
  you forcePhase, forceAttack, stagger, teleport, freeCamera, orbit, hurtPlayer, killBoss,
  setQuality, startPerf/stopPerf and more. Use it to inspect motion over time, close views,
  distant views, every boss phase, damage, death and restart.
- You may measure pixels: draw the canvas into a small 2D canvas and read back values to check
  the value structure and saturation budget against ART_TARGET §3.

## Rules
- **You are READ-ONLY. Do not edit any file under src/.** You may create scripts under tools/
  or files under captures/ for your own inspection.
- Do NOT approve something because the code is technically complete or because a feature exists.
  A feature that exists but reads badly on screen is a failure.
- No vague scores. Every judgement names visible or playable evidence: which capture, what you
  saw in it, or what number you measured.
- Be specific about the FIX, not just the complaint.
- If something is genuinely good, say so briefly — but your value here is finding what is wrong.
`;

const CRITICS = [
  {
    name: 'art-direction',
    brief: `
YOUR AREA: art direction, composition, scale, atmospheric depth, and the palette.

Judge against ART_TARGET.md §1–§5 and §9. Specifically test:
- Does the 'hero' capture actually reproduce the reference frame? Player low and LEFT of centre
  at ~16% frame height; boss head upper-third and crowned by the moon; wings spanning the frame
  width; both frame edges occupied by ruined architecture; giant mushrooms as mid-ground anchors;
  dead trees entering from the top edge.
- Measure the VALUE STRUCTURE. Sample pixels. Fog/far field should sit near value 60, mid water
  ~48, dark water ~18, silhouettes ~8, and the moon disc must be the ONLY near-white (~93).
  Report the numbers you actually measured.
- Measure the SATURATION BUDGET: lanterns + boss eyes + lotus together must occupy under ~1.5%
  of frame pixels, and nothing else may exceed ~0.18 saturation. Report what you measured.
- Is there real foreground / mid-ground / background separation, or does the scene read flat?
- Does placement read as AUTHORED or as procedural scatter?
- Does fog genuinely hide every world boundary? Fly the camera around and try to find the edge
  of the world, the edge of the water plane, or a visible horizon line. Report if you find one.`,
  },
  {
    name: 'boss-encounter',
    brief: `
YOUR AREA: the boss as a centrepiece encounter — presence, animation, attacks, phases, defeat.

Judge against ART_TARGET.md §8 and the user's requirements. Specifically test:
- Does the deity DOMINATE THE SKYLINE in normal gameplay, not just in one posed shot? Check
  'gameplay_default', 'wide_arena', 'phase2', 'phase3'.
- Do the four ocelli read as the strongest focal point at every distance, including through fog?
  Do they bloom without clipping to flat white?
- Does moonlight visibly transmit THROUGH the wing membrane with silhouetted vein structure?
  This is the signature effect. Check 'boss_close'.
- Is the boss ever static? Capture the same framing several seconds apart and diff what moved:
  wings, legs, moss, antennae, eyes, breathing.
- Force every attack (forceAttack) and judge each: is the telegraph READABLE and does it give
  fair reaction time? Is there real anticipation, impact and recovery? Does it affect the water
  and fog? Time the windups.
- Force each phase. Does behaviour actually change? Does the arena visibly alter?
- Trigger a poise stagger. Does the head come into reach and does that read as a reward?
- Watch the full defeat sequence (killBoss, then observe ~12 s). Is it memorable or perfunctory?`,
  },
  {
    name: 'combat-feel',
    brief: `
YOUR AREA: player design, movement, camera behaviour, combat responsiveness and impact.

Judge against ART_TARGET.md §7 and AAA action-game standards. Specifically test:
- Is the player silhouette legible at gameplay distance? Is the conical hat clearly the
  silhouette, wider than the body, with a ragged fringe? Check 'gameplay_default' + 'player_close'.
- Drive the player through the real input path over many frames and measure: acceleration and
  deceleration curves, turning weight, top speed, whether water resistance is felt. Report numbers.
- Combat: measure the actual windup/active/recovery frame counts of each attack from the running
  game. Is attack commitment real? Is recovery punishable and readable? Does the light combo
  chain cleanly? Is the dodge responsive and are the i-frames where they should be?
- Impact feedback: hit stop, camera shake, sparks, sword trail, sound, rumble. Capture
  'combat_light' and 'damage'. Does a hit FEEL like it lands, or does it pass through?
- Camera: does it keep the reference composition during real combat? Does it whip, clip through
  architecture, or lose the boss? Does lock-on frame both the player and a 26 m tall boss sanely?
- Animation: does it blend or snap? Is any animation obviously repetitive or floaty?`,
  },
  {
    name: 'water-atmosphere',
    brief: `
YOUR AREA: water, fog, lighting and post-processing — as a single atmospheric system.

Judge against ART_TARGET.md §4, §5, §6. Specifically test:
- Water: are reflections vertically smeared and distance-blurred rather than a clean mirror?
  Does reflection strength rise at grazing angles? Is the water DARK enough not to out-brighten
  the fog? Measure it.
- Are concentric ripple rings genuinely visible around the standing player, and stronger when
  moving? Are there wakes behind movement, and splashes on dodge and impact? Capture motion.
- Is there murk — do submerged shins fade out, or does the water read as clean glass over a floor?
- Fog: is it animated? Are there drifting sheets and low ground mist? Is fog displaced by the
  player and by the boss when it comes low? Does anything pop in or out at a fog boundary?
- Lighting: is the moon visible, hazy, and the brightest thing in frame? Is it the only real
  key light? Do lanterns stay tiny local warm points that never warm the fog or the player?
- Post: is bloom clipping anything to flat white? Do god rays read as soft shafts or as a smear?
  Does DOF blur anything it shouldn't, like the player?
- Is there any obvious shader artefact — banding, aliasing on the water, reflection seams,
  z-fighting, flickering at grazing angles? Look hard at edges and at distance.`,
  },
  {
    name: 'ui-states-audio',
    brief: `
YOUR AREA: UI, game states, settings, accessibility, and audio.

Specifically test:
- Walk every state: title, playing, paused, settings (all four tabs), death, restart, victory,
  ending. Capture each. Does any of them break immersion or the palette (ART_TARGET §11)?
- Is the HUD nearly invisible as required — no frames, no gradients, no bright colours? Is the
  health/stamina/flask read still instantly legible in combat?
- Does the boss health bar communicate phases and the poise/stagger window?
- Settings: change every setting through the real UI and verify it TAKES EFFECT. Quality presets,
  FOV, grain, invert axes, sensitivity, camera shake, screen flash, UI scale, subtitles,
  high-contrast tells, colour-blind-safe tells, difficulty. Report any that do nothing.
- Accessibility: are attack telegraphs signalled by shape and sound as well as colour? Set
  colourBlindSafeTells and verify. Is anything unreadable at uiScale 0.75 or 1.6?
- Checkpoint/save: does Continue actually resume the right phase? Is it cleared on victory?
- AUDIO: audio is fully synthesised WebAudio (no files). You cannot hear it, so INSPECT IT
  ANALYTICALLY: read src/audio/Audio.js, then in the running page inspect the live graph — node
  counts, gain values, whether music cues actually switch on phase change, whether SFX fire on
  the right events (subscribe to the EventBus via M.emit / M.EVT and log), whether the mix could
  clip (sum the gains), and whether ducking works. Report imbalance and anything silent.
- Controller: verify prompts switch between keyboard and pad glyphs.`,
  },
];

const CRITIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['area', 'biggestWeakness', 'findings', 'whatWorks', 'verdict'],
  properties: {
    area: { type: 'string' },
    biggestWeakness: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'evidence', 'fix'],
      properties: {
        title: { type: 'string', description: 'The single biggest remaining weakness in this area.' },
        evidence: { type: 'string', description: 'The capture you looked at or number you measured.' },
        fix: { type: 'string', description: 'Concretely what should change, and in which file.' },
      },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'title', 'evidence', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          title: { type: 'string' },
          evidence: { type: 'string' },
          fix: { type: 'string' },
          file: { type: 'string' },
        },
      },
    },
    measurements: { type: 'array', items: { type: 'string' }, description: 'Concrete numbers you measured.' },
    whatWorks: { type: 'array', items: { type: 'string' } },
    verdict: { type: 'string', enum: ['ship-quality', 'close', 'needs-work', 'failing'] },
  },
};

phase('Critique');
log(`${CRITICS.length} critics inspecting the running merged build`);

const critiques = await parallel(CRITICS.map((c) => () =>
  agent(CRITIC_PREAMBLE + `\n## YOUR AREA\n` + c.brief,
    { label: `critic:${c.name}`, phase: 'Critique', schema: CRITIC_SCHEMA })
));

const valid = critiques.filter(Boolean);
log(`Critiques in: ${valid.length}/${CRITICS.length}. Verdicts: ${valid.map((c) => c.verdict).join(', ')}`);

phase('Integrate');
const integration = await agent(
  CRITIC_PREAMBLE + `
## YOUR AREA: WHOLE-GAME INTEGRATION

You are the integration pass. The individual systems have each been polished in isolation by
separate specialists who could not see each other's work. Your job is to find where they DON'T
FIT TOGETHER.

**Play the entire game from beginning to end**, driving the real game through the debug API:
title -> start -> phase 1 combat -> phase 2 -> phase 3 -> take damage -> die -> restart from
checkpoint -> defeat the boss -> victory -> ending. Capture liberally along the way and LOOK at
every capture.

Hunt specifically for:
- Mismatched art styles between systems (does the player belong in this world? do the enemies?
  does the boss share the environment's material language?)
- Bad proportions and scale mismatches between player, enemies, architecture and boss.
- Weak or abrupt transitions between states; anything that cuts instead of flowing.
- Lighting inconsistencies — anything lit as if by a different sun than everything else.
- Unclear attacks, or telegraphs that are readable in isolation but lost in a busy frame.
- Repetitive animation once you watch it for a while.
- Audio imbalance across the whole session.
- Difficulty spikes: is any phase disproportionately harder? Is the fight winnable and fair?
  Actually try to assess pacing and length.
- Performance drops at specific moments (phase transitions, moonfall, many enemies).
- UI that breaks immersion.
- Systems that work separately but feel disconnected together.

Report the integration failures that a player would actually notice, ranked.`,
  { label: 'integration:playthrough', phase: 'Integrate', schema: CRITIC_SCHEMA, effort: 'high' }
);

phase('Profile');
const perf = await agent(
  CRITIC_PREAMBLE + `
## YOUR AREA: PERFORMANCE

You have the machine to yourself now — no other agent is rendering. Produce an honest
performance report.

- Run \`MIREFALL_URL=${URL} node tools/perf.js --seconds 6\` for the full tier x scenario matrix.
- IMPORTANT AND NON-NEGOTIABLE: headless Chromium here uses a SOFTWARE rasteriser. Absolute fps
  from it is a floor, not a prediction of desktop GPU performance. Say so plainly in your report
  and never present a headless number as a desktop number. What IS hardware-independent and
  meaningful: draw calls, triangle counts, texture/geometry/program counts, allocation churn,
  and RELATIVE cost between tiers and scenarios.
- The scene was recently at ~1079 draw calls, which is far too many for its content. Find out
  where they go: count draw calls per subsystem by selectively hiding groups
  (M.game.world.group, M.game.fog.group, M.game.boss.root, M.game.fx.points) and re-measuring.
  Report a breakdown and name the worst offenders concretely.
- Identify the most expensive passes: water reflection, shadow map, post chain, transparency,
  particles. Measure by toggling (e.g. setQuality, or disabling a pass) and re-timing.
- Check for per-frame allocation / GC churn and for anything created during gameplay rather
  than pooled.
- Check boot time and how long procedural texture synthesis takes.
- Recommend a prioritised optimisation list with expected savings.`,
  { label: 'perf:audit', phase: 'Profile', schema: CRITIC_SCHEMA, effort: 'high' }
);

return {
  critiques: valid,
  integration,
  perf,
  verdicts: valid.map((c) => ({ area: c.area, verdict: c.verdict })),
};
