import * as THREE from 'three';

/**
 * SHARED ART CONTRACT — every module must source colour from here.
 * Values are transcribed from docs/ART_TARGET.md §3. Do not introduce ad-hoc colours.
 * Anything above ~0.18 saturation must be one of the four sanctioned accents.
 */

// three's ColorManagement already converts sRGB hex -> linear working space on set.
// Converting again here would darken every colour in the game.
const c = (hex) => new THREE.Color(hex);

export const PALETTE = {
  fog:        c(0x8b979c),
  fogDeep:    c(0x6a767b),
  fogMoonlit: c(0xa8b4b8),

  waterMid:   c(0x6e7b80),
  waterDark:  c(0x2b3236),
  waterDeep:  c(0x141a1d),

  silhouette: c(0x12171a),
  ink:        c(0x0a0d0f),

  moon:       c(0xe9eef0),
  moonLight:  c(0xcdd9e0),

  wingLit:    c(0xb9c2c2),
  wingDark:   c(0x7c8688),

  moss:       c(0x4a5340),
  mossDark:   c(0x333a2d),
  mossPale:   c(0x69735b),

  bark:       c(0x2e3230),
  barkWet:    c(0x1d2122),
  wood:       c(0x3a352c),
  woodPale:   c(0x554d3f),
  thatch:     c(0x6b5f45),

  skin:       c(0x5d6b4e),
  skinDark:   c(0x3c4634),
  cloth:      c(0x2a2f2c),
  steel:      c(0x9aa4a6),

  // ---- sanctioned accents (budget: <1.5% of frame pixels combined) ----
  mushroomCap:   c(0x8a7a9e),
  mushroomLit:   c(0xa08bb8),
  mushroomGill:  c(0xcabfd4),
  lantern:       c(0xffb85c),
  lanternHalo:   c(0xe8933a),
  bossEye:       c(0xd8e05a),
  bossEyeDim:    c(0xc9d24e),
  lotus:         c(0xff7cc0),
  lotusDeep:     c(0xf06ab0),

  // combat feedback
  hitSpark:   c(0xf2e9c8),
  bloodSpore: c(0x9fae6a),
  dangerTell: c(0xd8e05a),
  healGlow:   c(0xa8d8c0),
};

/** Scene-scale constants shared by every system. 1 unit = 1 metre. */
export const SCALE = {
  playerHeight: 1.15,      // tiny — the whole point
  playerRadius: 0.42,
  waterLevel: 0.0,
  wadeDepth: 0.52,         // thigh-deep on the player

  bossHeadHeight: 26.0,    // head sits 26 m up
  bossWingSpan: 82.0,      // wings exceed the frame
  bossLegSpread: 21.0,
  bossLegCount: 6,

  mushroomHeight: [12, 20],
  deadTreeHeight: [18, 34],
  toriiHeight: [7, 11],
  hutHeight: [2.4, 3.4],

  arenaRadius: 62.0,       // playable water
  fogNear: 12.0,
  fogFar: 78.0,
  fogDensity: 0.0225,
};

export const LAYERS = {
  DEFAULT: 0,
  REFLECTIVE: 1,   // objects rendered into the water reflection pass
  NO_REFLECT: 2,   // excluded from reflection (water itself, fullscreen fx)
  BLOOM: 3,
};

export default PALETTE;
