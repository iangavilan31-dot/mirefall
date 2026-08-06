import * as THREE from 'three';

/**
 * Procedural texture synthesis. Every material in the game is generated here at boot —
 * there are no image assets. Keep sizes modest (256–512) and always cache.
 */

const cache = new Map();
const anisoRef = { value: 8 };
export function setAnisotropy(a) { anisoRef.value = a; }

// ---------------------------------------------------------------- noise ----
function mulberry(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGrad(seed) {
  const rnd = mulberry(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return perm;
}

/** Tileable value noise. */
function tileNoise(perm, x, y, period) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = (a, b) => {
    const ax = ((a % period) + period) % period, by = ((b % period) + period) % period;
    return perm[(perm[ax & 255] + by) & 255] / 255;
  };
  const a = w(xi, yi), b = w(xi + 1, yi), c = w(xi, yi + 1), d = w(xi + 1, yi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

function fbm(perm, x, y, octaves, period) {
  let v = 0, a = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) { v += a * tileNoise(perm, x * f, y * f, period * f); f *= 2; a *= 0.5; }
  return v;
}

function ridged(perm, x, y, octaves, period) {
  let v = 0, a = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(tileNoise(perm, x * f, y * f, period * f) * 2 - 1);
    v += a * n * n; f *= 2; a *= 0.5;
  }
  return v;
}

// ------------------------------------------------------------- plumbing ----
function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function paint(size, fn) {
  const c = canvas(size);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const o = fn(x / size, y / size, x, y);
      d[i] = o[0] * 255; d[i + 1] = o[1] * 255; d[i + 2] = o[2] * 255;
      d[i + 3] = (o[3] === undefined ? 1 : o[3]) * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function toTexture(c, { repeat = 1, srgb = false, aniso = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (aniso) t.anisotropy = anisoRef.value;
  t.needsUpdate = true;
  return t;
}

/** Read a height canvas into a flat Float32Array once (never sample it per-pixel). */
function heightData(c) {
  const size = c.width;
  const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, size, size).data;
  const out = new Float32Array(size * size);
  for (let i = 0, n = size * size; i < n; i++) out[i] = d[i * 4] / 255;
  return out;
}

/** Sobel a height canvas into a tangent-space normal map. */
function normalFromHeight(heightCanvas, strength = 2.2) {
  const size = heightCanvas.width;
  const src = heightCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, size, size).data;
  const h = (x, y) => {
    const xi = ((x % size) + size) % size, yi = ((y % size) + size) % size;
    return src[(yi * size + xi) * 4] / 255;
  };
  return paint(size, (u, v, x, y) => {
    const dx = (h(x - 1, y) - h(x + 1, y)) * strength;
    const dy = (h(x, y - 1) - h(x, y + 1)) * strength;
    const len = Math.hypot(dx, dy, 1);
    return [(dx / len) * 0.5 + 0.5, (dy / len) * 0.5 + 0.5, (1 / len) * 0.5 + 0.5, 1];
  });
}

function grey(v) { return [v, v, v, 1]; }
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

function rgb(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}
function lerp3(a, b, t) { return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t), 1]; }

// -------------------------------------------------------------- library ----

function build(key, fn) {
  if (cache.has(key)) return cache.get(key);
  const v = fn();
  cache.set(key, v);
  return v;
}

/** Wet, dark, vertically-grained bark for dead trees and boss legs. */
export function bark(size = 512) {
  return build('bark' + size, () => {
    const perm = makeGrad(1337);
    const hc = paint(size, (u, v) => {
      const stretch = ridged(perm, u * 26, v * 5, 5, 26);
      const fine = fbm(perm, u * 90, v * 22, 4, 90);
      const crack = smooth(0.62, 0.92, ridged(perm, u * 12, v * 3.2, 3, 12));
      let h = stretch * 0.62 + fine * 0.22 - crack * 0.42;
      return grey(clamp01(h + 0.34));
    });
    const H = heightData(hc);

    const dark = rgb(0x1c2021), light = rgb(0x3a3f3a), mossy = rgb(0x424c37);
    const cc = paint(size, (u, v, x, y) => {
      const hh = H[y * size + x];
      const m = smooth(0.4, 0.85, fbm(perm, u * 7 + 40, v * 7, 4, 7));
      let c = lerp3(dark, light, hh * hh);
      c = lerp3(c, mossy, m * 0.55 * smooth(0.3, 0.7, hh));
      return c;
    });
    return {
      map: toTexture(cc, { srgb: true }),
      normalMap: toTexture(normalFromHeight(hc, 2.8)),
      roughnessMap: toTexture(paint(size, (u, v, x, y) => {
        const hh = H[y * size + x];
        return grey(clamp01(0.94 - hh * 0.30));
      })),
    };
  });
}

/** Straw / thatch — used for the player's hat and every ruined roof. */
export function thatch(size = 512) {
  return build('thatch' + size, () => {
    const perm = makeGrad(90210);
    const hc = paint(size, (u, v) => {
      // long straw strands running along V, bundled in clumps
      const clump = fbm(perm, u * 14, v * 1.6, 3, 14);
      const strand = Math.abs(Math.sin((u * 168 + clump * 9) * Math.PI));
      const strandH = Math.pow(strand, 0.55);
      const breaks = smooth(0.55, 0.95, fbm(perm, u * 30, v * 9, 4, 30));
      const rows = Math.abs(Math.sin(v * Math.PI * 7.0)) * 0.22;
      return grey(clamp01(strandH * 0.6 + clump * 0.24 + rows - breaks * 0.28));
    });
    const H = heightData(hc);

    const dry = rgb(0x7a6b4c), wet = rgb(0x3f3a2b), grn = rgb(0x4d543c);
    const cc = paint(size, (u, v, x, y) => {
      const hh = H[y * size + x];
      const damp = smooth(0.25, 0.9, v) * 0.75;               // wetter toward the brim
      const alg = smooth(0.55, 0.9, fbm(perm, u * 9 + 3, v * 9, 4, 9));
      let c = lerp3(wet, dry, hh);
      c = lerp3(c, wet, damp * 0.6);
      c = lerp3(c, grn, alg * 0.45);
      return c;
    });
    return {
      map: toTexture(cc, { srgb: true }),
      normalMap: toTexture(normalFromHeight(hc, 3.4)),
      roughnessMap: toTexture(paint(size, (u, v, x, y) => {
        const hh = H[y * size + x];
        return grey(clamp01(0.98 - hh * 0.2 - smooth(0.3, 1.0, v) * 0.25));
      })),
    };
  });
}

/** Soft clumping moss for cloaks, curtains, boss body. */
export function moss(size = 512) {
  return build('moss' + size, () => {
    const perm = makeGrad(4242);
    const hc = paint(size, (u, v) => {
      const clumps = fbm(perm, u * 11, v * 11, 5, 11);
      const fine = fbm(perm, u * 64, v * 64, 3, 64);
      const strands = Math.pow(Math.abs(Math.sin(v * Math.PI * 34 + fbm(perm, u * 8, v * 3, 2, 8) * 7)), 2.0) * 0.22;
      return grey(clamp01(clumps * 0.72 + fine * 0.2 + strands));
    });
    const H = heightData(hc);

    const dark = rgb(0x232a1e), mid = rgb(0x424b34), pale = rgb(0x6a7357);
    const cc = paint(size, (u, v, x, y) => {
      const hh = H[y * size + x];
      const patch = fbm(perm, u * 4 + 17, v * 4, 3, 4);
      let c = lerp3(dark, mid, hh);
      c = lerp3(c, pale, smooth(0.55, 0.95, hh) * 0.6 * patch);
      return c;
    });
    return {
      map: toTexture(cc, { srgb: true }),
      normalMap: toTexture(normalFromHeight(hc, 2.0)),
      roughnessMap: toTexture(paint(size, () => grey(0.96))),
    };
  });
}

/** Weathered, split, waterlogged planks for shrine architecture. */
export function plank(size = 512) {
  return build('plank' + size, () => {
    const perm = makeGrad(777);
    const hc = paint(size, (u, v) => {
      const board = Math.floor(v * 6);
      const inBoard = (v * 6) % 1;
      const gap = smooth(0.0, 0.055, inBoard) * smooth(1.0, 0.945, inBoard);
      const grain = fbm(perm, u * 34 + board * 13, v * 7, 4, 34);
      const ridge = ridged(perm, u * 60 + board * 5, v * 3, 3, 60) * 0.3;
      const rot = smooth(0.6, 0.95, fbm(perm, u * 8, v * 8, 4, 8));
      return grey(clamp01((grain * 0.5 + ridge + 0.3) * gap - rot * 0.3));
    });
    const H = heightData(hc);

    const wet = rgb(0x232520), wood = rgb(0x4a4335), grn = rgb(0x3d4632);
    const cc = paint(size, (u, v, x, y) => {
      const hh = H[y * size + x];
      const alg = smooth(0.5, 0.88, fbm(perm, u * 6 + 31, v * 6, 4, 6));
      let c = lerp3(wet, wood, hh);
      c = lerp3(c, grn, alg * 0.5);
      return c;
    });
    return {
      map: toTexture(cc, { srgb: true }),
      normalMap: toTexture(normalFromHeight(hc, 2.6)),
      roughnessMap: toTexture(paint(size, (u, v, x, y) => {
        const hh = H[y * size + x];
        return grey(clamp01(0.9 - hh * 0.28));
      })),
    };
  });
}

/** Mushroom cap: mauve, damp, faintly mottled. Sanctioned accent 1. */
export function mushroomCap(size = 512) {
  return build('mcap' + size, () => {
    const perm = makeGrad(5150);
    const hc = paint(size, (u, v) => {
      const rings = Math.abs(Math.sin(v * Math.PI * 3.2)) * 0.12;
      const bumps = fbm(perm, u * 18, v * 18, 4, 18);
      const warts = smooth(0.72, 0.95, fbm(perm, u * 40, v * 40, 3, 40)) * 0.4;
      return grey(clamp01(bumps * 0.5 + rings + warts + 0.25));
    });
    const H = heightData(hc);

    const deep = rgb(0x554a68), cap = rgb(0x8a7a9e), lit = rgb(0xa896bd);
    const cc = paint(size, (u, v, x, y) => {
      const hh = H[y * size + x];
      const blot = fbm(perm, u * 5 + 9, v * 5, 3, 5);
      let c = lerp3(deep, cap, hh);
      c = lerp3(c, lit, smooth(0.6, 1.0, hh) * blot * 0.7);
      // radial darkening toward the rim
      c = lerp3(c, deep, smooth(0.72, 1.0, v) * 0.45);
      return c;
    });
    return {
      map: toTexture(cc, { srgb: true }),
      normalMap: toTexture(normalFromHeight(hc, 1.8)),
      roughnessMap: toTexture(paint(size, (u, v, x, y) => {
        const hh = H[y * size + x];
        return grey(clamp01(0.52 + hh * 0.24));   // damp = glossier than everything else
      })),
    };
  });
}

/** Amphibian skin: cold olive, fine pebbling, damp sheen. */
export function skin(size = 512) {
  return build('skin' + size, () => {
    const perm = makeGrad(3131);
    const hc = paint(size, (u, v) => {
      const pebble = fbm(perm, u * 78, v * 78, 3, 78);
      const cells = 1 - Math.abs(fbm(perm, u * 30, v * 30, 2, 30) * 2 - 1);
      const wart = smooth(0.78, 0.98, fbm(perm, u * 22, v * 22, 3, 22)) * 0.55;
      return grey(clamp01(pebble * 0.35 + cells * 0.3 + wart + 0.2));
    });
    const H = heightData(hc);

    const dark = rgb(0x333c2c), mid = rgb(0x5d6b4e), pale = rgb(0x7d8a63), belly = rgb(0x8a9070);
    const cc = paint(size, (u, v, x, y) => {
      const hh = H[y * size + x];
      const mott = fbm(perm, u * 6 + 21, v * 6, 4, 6);
      let c = lerp3(dark, mid, hh);
      c = lerp3(c, pale, smooth(0.62, 1.0, hh) * 0.8);
      c = lerp3(c, dark, smooth(0.55, 0.9, mott) * 0.5);
      c = lerp3(c, belly, smooth(0.86, 1.0, v) * 0.5);
      return c;
    });
    return {
      map: toTexture(cc, { srgb: true }),
      normalMap: toTexture(normalFromHeight(hc, 1.5)),
      roughnessMap: toTexture(paint(size, (u, v, x, y) => {
        const hh = H[y * size + x];
        return grey(clamp01(0.40 + hh * 0.28));   // wet skin
      })),
    };
  });
}

/** Dirty translucent wing membrane with vein structure. The signature boss material. */
export function wingMembrane(size = 1024) {
  return build('wing' + size, () => {
    const perm = makeGrad(60613);
    // veins: branching-ish structure from layered ridged noise stretched radially
    const veinAt = (u, v) => {
      const cu = u - 0.06, cv = v - 0.5;
      const ang = Math.atan2(cv, cu);
      const rad = Math.hypot(cu, cv);
      const primary = ridged(perm, ang * 3.4, rad * 9, 3, 12);
      const secondary = ridged(perm, ang * 11 + rad * 6, rad * 22, 3, 24);
      const cross = ridged(perm, u * 26, v * 26, 2, 26);
      return clamp01(Math.pow(primary, 2.2) * 1.5 + Math.pow(secondary, 3.0) * 0.9 + Math.pow(cross, 5.0) * 0.5);
    };
    const hc = paint(size, (u, v) => {
      const veins = veinAt(u, v);
      const dust = fbm(perm, u * 40, v * 40, 4, 40) * 0.3;
      return grey(clamp01(veins * 0.85 + dust));
    });
    // alpha: tattered outer edge, holes
    const ac = paint(size, (u, v) => {
      const edge = smooth(0.0, 0.10, u) * smooth(1.0, 0.86, u) * smooth(0.0, 0.07, v) * smooth(1.0, 0.93, v);
      const tatter = fbm(perm, u * 9 + 5, v * 9, 4, 9);
      const rip = smooth(0.42, 0.60, tatter);
      const holes = 1 - smooth(0.80, 0.90, fbm(perm, u * 17, v * 17, 3, 17));
      const outer = smooth(0.55, 1.0, u);                     // more damage toward the wingtip
      const a = clamp01(edge * (1 - outer * (1 - rip) * 0.9) * holes);
      return grey(a);
    });
    const H = heightData(hc);

    const memb = rgb(0x9aa4a4), grime = rgb(0x5e6663), vein = rgb(0x2e3431);
    const cc = paint(size, (u, v, x, y) => {
      const veins = veinAt(u, v);
      const dirt = fbm(perm, u * 6, v * 6, 4, 6);
      let c = lerp3(memb, grime, dirt * 0.72);
      c = lerp3(c, vein, smooth(0.35, 0.85, veins));
      c = lerp3(c, grime, smooth(0.4, 1.0, u) * 0.35);
      return c;
    });
    return {
      map: toTexture(cc, { srgb: true, repeat: 1 }),
      alphaMap: toTexture(ac, { repeat: 1 }),
      normalMap: toTexture(normalFromHeight(hc, 1.2), { repeat: 1 }),
      roughnessMap: toTexture(paint(size, () => grey(0.72)), { repeat: 1 }),
    };
  });
}

/** Single lilypad silhouette with the classic wedge notch (alpha-cut plane). */
export function lilypad(size = 256) {
  return build('lily' + size, () => {
    const perm = makeGrad(818);
    const cc = paint(size, (u, v) => {
      const cu = u - 0.5, cv = v - 0.5;
      const r = Math.hypot(cu, cv) * 2;
      const ang = Math.atan2(cv, cu);
      const wobble = fbm(perm, Math.cos(ang) * 3 + 5, Math.sin(ang) * 3, 3, 6) * 0.1;
      const notch = Math.abs(ang) < 0.30 ? 1 : 0;
      const inside = r < (0.92 + wobble) && !notch;
      if (!inside) return [0, 0, 0, 0];
      const veins = Math.pow(Math.abs(Math.cos(ang * 9)), 22) * 0.5 + smooth(0.86, 1.0, r) * 0.5;
      const spot = fbm(perm, u * 12, v * 12, 3, 12);
      const dark = rgb(0x1e2a1a), mid = rgb(0x2f3f26), pale = rgb(0x455632), rot = rgb(0x4a4127);
      let c = lerp3(dark, mid, spot);
      c = lerp3(c, pale, veins * 0.7);
      c = lerp3(c, rot, smooth(0.72, 1.0, spot) * 0.45);
      c = lerp3(c, dark, smooth(0.80, 1.0, r) * 0.6);
      return [c[0], c[1], c[2], 1];
    });
    return { map: toTexture(cc, { srgb: true, repeat: 1 }) };
  });
}

/** A soft radial glow sprite, used for lanterns, eyes, embers, spores. */
export function glowSprite(size = 128, power = 2.4) {
  return build('glow' + size + '_' + power, () => {
    const cc = paint(size, (u, v) => {
      const r = Math.hypot(u - 0.5, v - 0.5) * 2;
      const a = Math.pow(clamp01(1 - r), power);
      return [1, 1, 1, a];
    });
    return toTexture(cc, { repeat: 1, aniso: false });
  });
}

/** A soft elongated wisp used for fog sheets and mist cards. */
export function fogSheet(size = 256, seed = 12) {
  return build('fogsheet' + size + '_' + seed, () => {
    const perm = makeGrad(seed);
    const cc = paint(size, (u, v) => {
      const n = fbm(perm, u * 3.2, v * 3.2, 5, 4);
      const n2 = fbm(perm, u * 8 + 30, v * 8, 4, 8);
      const edge = smooth(0.0, 0.42, u) * smooth(1.0, 0.58, u)
                 * smooth(0.0, 0.5, v) * smooth(1.0, 0.5, v);
      const a = clamp01((n * 0.75 + n2 * 0.35 - 0.28)) * edge;
      return [1, 1, 1, a * a];
    });
    return toTexture(cc, { repeat: 1, aniso: false });
  });
}

/** Vertical strand card for hanging moss curtains — many thin strands with gaps. */
export function mossCurtain(size = 256, seed = 33) {
  return build('mosscurtain' + size + '_' + seed, () => {
    const perm = makeGrad(seed);
    const cc = paint(size, (u, v) => {
      const strandN = 26;
      const su = u * strandN;
      const idx = Math.floor(su);
      const f = su - idx;
      const jitter = tileNoise(perm, idx * 3.7, 1.3, 64);
      const width = 0.26 + jitter * 0.36;
      const len = 0.32 + tileNoise(perm, idx * 7.1, 9.4, 64) * 0.68;
      const centre = 0.5 + (tileNoise(perm, idx * 2.3, 4.4, 64) - 0.5) * 0.4;
      const inStrand = Math.abs(f - centre) < width * 0.5;
      if (!inStrand || v > len) return [0, 0, 0, 0];
      const taper = smooth(len, len * 0.55, v);
      const grain = fbm(perm, u * 40, v * 14, 3, 40);
      const dark = rgb(0x212a1c), mid = rgb(0x3c4630), pale = rgb(0x596146);
      let c = lerp3(dark, mid, grain);
      c = lerp3(c, pale, smooth(0.6, 1.0, grain) * 0.55);
      c = lerp3(c, dark, smooth(0.3, 1.0, v) * 0.45);
      const a = clamp01(taper * (0.72 + grain * 0.5));
      return [c[0], c[1], c[2], a > 0.34 ? 1 : 0];
    });
    return toTexture(cc, { srgb: true, repeat: 1 });
  });
}

/** Steel blade: fine longitudinal polish streaks plus nicks. */
export function steel(size = 256) {
  return build('steel' + size, () => {
    const perm = makeGrad(2024);
    const hc = paint(size, (u, v) => {
      const streak = fbm(perm, u * 4, v * 120, 3, 120);
      const nick = smooth(0.86, 0.99, fbm(perm, u * 14, v * 14, 3, 14)) * 0.7;
      return grey(clamp01(0.6 + streak * 0.3 - nick));
    });
    const H = heightData(hc);

    const dark = rgb(0x3a4144), lit = rgb(0x9aa4a6), rust = rgb(0x4e4034);
    const cc = paint(size, (u, v, x, y) => {
      const hh = H[y * size + x];
      const r = smooth(0.62, 0.92, fbm(perm, u * 8 + 4, v * 8, 4, 8));
      let c = lerp3(dark, lit, hh);
      c = lerp3(c, rust, r * 0.55);
      return c;
    });
    return {
      map: toTexture(cc, { srgb: true }),
      normalMap: toTexture(normalFromHeight(hc, 1.1)),
      roughnessMap: toTexture(paint(size, (u, v, x, y) => {
        const hh = H[y * size + x];
        return grey(clamp01(0.68 - hh * 0.42));
      })),
      metalnessMap: toTexture(paint(size, (u, v, x, y) => {
        const hh = H[y * size + x];
        return grey(clamp01(hh * 0.9));
      })),
    };
  });
}

/** Cloth / wrapping — coarse weave, waterlogged. */
export function cloth(size = 256) {
  return build('cloth' + size, () => {
    const perm = makeGrad(6060);
    const hc = paint(size, (u, v) => {
      const weave = (Math.sin(u * Math.PI * 62) * Math.sin(v * Math.PI * 62)) * 0.5 + 0.5;
      const wear = fbm(perm, u * 12, v * 12, 4, 12);
      return grey(clamp01(weave * 0.4 + wear * 0.5));
    });
    const H = heightData(hc);

    const dark = rgb(0x1c211e), mid = rgb(0x2f3531), stain = rgb(0x3d3a2a);
    const cc = paint(size, (u, v, x, y) => {
      const hh = H[y * size + x];
      const s = smooth(0.5, 0.9, fbm(perm, u * 5 + 8, v * 5, 3, 5));
      let c = lerp3(dark, mid, hh);
      c = lerp3(c, stain, s * 0.5);
      return c;
    });
    return {
      map: toTexture(cc, { srgb: true }),
      normalMap: toTexture(normalFromHeight(hc, 1.4)),
      roughnessMap: toTexture(paint(size, () => grey(0.93))),
    };
  });
}

export function disposeAll() {
  for (const v of cache.values()) {
    if (v && v.isTexture) v.dispose();
    else if (v) for (const t of Object.values(v)) t?.dispose?.();
  }
  cache.clear();
}

export default {
  bark, thatch, moss, plank, mushroomCap, skin, wingMembrane, lilypad,
  glowSprite, fogSheet, mossCurtain, steel, cloth, setAnisotropy, disposeAll,
};
