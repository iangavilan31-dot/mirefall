import * as THREE from 'three';
import { PALETTE, SCALE } from '../core/Palette.js';
import { settings } from '../core/Settings.js';
import { bus, EVT } from '../core/EventBus.js';
import TL from './TextureLab.js';

/**
 * Authored environment composition.
 *
 * ART_TARGET §9: placement must be authored, not scattered. Every view needs a
 * foreground occluder, a mid-ground subject, and a fogged background layer.
 * Positions below are hand-placed to reproduce the reference frame's framing:
 * ruined architecture on BOTH frame edges, giant mushrooms as mid-ground anchors,
 * dead trees entering from the top, and distant hatted villagers in the fog.
 */

let SEED = 20260806;
function rnd() { SEED = (SEED * 1664525 + 1013904223) >>> 0; return SEED / 4294967296; }
function rr(a, b) { return a + rnd() * (b - a); }

export class World {
  constructor(scene, water, lighting) {
    this.scene = scene;
    this.water = water;
    this.lighting = lighting;
    this.group = new THREE.Group();
    this.group.name = 'world';
    scene.add(this.group);

    this.obstacles = [];      // {x,z,r} for player collision
    this.collidables = [];    // meshes for camera collision
    this.lanternMeshes = [];
    this.pillars = [];
    this.swayables = [];

    this._materials();
    this._buildBed();
    this._composeArchitecture();
    this._composeMushrooms();
    this._composeTrees();
    this._composeVillagers();
    this._composeLilypads();
    this._composeReeds();
    this._composeLotus();
    this._composeDebris();

    this.group.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.computeBoundingSphere?.(); });
  }

  _materials() {
    const bark = TL.bark(512), plank = TL.plank(512), thatch = TL.thatch(512);
    const mcap = TL.mushroomCap(512), moss = TL.moss(512);
    this.matBark = new THREE.MeshStandardMaterial({ ...bark, color: PALETTE.barkWet.clone(), roughness: 0.96 });
    this.matBark.map.repeat.set(1.5, 4);
    this.matPlank = new THREE.MeshStandardMaterial({ ...plank, color: PALETTE.wood.clone(), roughness: 0.94 });
    this.matThatch = new THREE.MeshStandardMaterial({ ...thatch, color: PALETTE.thatch.clone(), roughness: 0.95, side: THREE.DoubleSide });
    this.matCap = new THREE.MeshStandardMaterial({ ...mcap, color: PALETTE.mushroomCap.clone(), roughness: 0.58, side: THREE.DoubleSide });
    this.matGill = new THREE.MeshStandardMaterial({ color: PALETTE.mushroomGill.clone(), roughness: 0.82, side: THREE.DoubleSide });
    this.matStalk = new THREE.MeshStandardMaterial({ ...moss, color: PALETTE.mushroomGill.clone().multiplyScalar(0.55), roughness: 0.9 });
    this.matMoss = new THREE.MeshStandardMaterial({ ...moss, color: PALETTE.moss.clone(), roughness: 1.0 });
    this.matSilhouette = new THREE.MeshStandardMaterial({ color: PALETTE.silhouette.clone(), roughness: 1.0 });
    this.matLantern = new THREE.MeshBasicMaterial({ color: PALETTE.lantern.clone(), toneMapped: false });
    this.glowTex = TL.glowSprite(128, 2.2);
  }

  // -------------------------------------------------------------- swamp bed --
  _buildBed() {
    // A murky floor just below the surface so the water never reads as infinite void.
    const g = new THREE.PlaneGeometry(320, 320, 60, 60);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const h = Math.sin(x * 0.07) * Math.cos(z * 0.06) * 0.5 + Math.sin(x * 0.021 + z * 0.017) * 0.9;
      p.setY(i, -2.6 + h);
    }
    g.computeVertexNormals();
    const bed = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      color: PALETTE.waterDeep.clone(), roughness: 1.0,
    }));
    bed.receiveShadow = true;
    // bed is excluded from the reflection pass by Water.excludeFromReflection
    this.group.add(bed);
  }

  // ----------------------------------------------------------- architecture --
  _composeArchitecture() {
    // Frame edges MUST be occupied (ART_TARGET §9). Two hero gates flank the arena
    // along the boss axis, plus scattered walkway ruins.
    const gates = [
      { x: -26, z: -4, rot: 0.35, s: 1.35 },
      { x: 27, z: -6, rot: -0.42, s: 1.5 },
      { x: -18, z: 22, rot: 1.1, s: 1.0 },
      { x: 21, z: 24, rot: -1.2, s: 1.15 },
      { x: -34, z: -26, rot: 0.9, s: 1.2 },
      { x: 33, z: -30, rot: -0.8, s: 1.25 },
      { x: 4, z: 40, rot: Math.PI, s: 1.1 },
    ];
    for (const g of gates) this._torii(g.x, g.z, g.rot, g.s);

    const huts = [
      { x: -21, z: 12, rot: 0.4, s: 1.0 }, { x: -29, z: 6, rot: 1.1, s: 0.9 },
      { x: 24, z: 14, rot: -0.6, s: 1.05 }, { x: 31, z: 4, rot: -1.3, s: 0.85 },
      { x: -12, z: 34, rot: 2.2, s: 0.95 }, { x: 15, z: 33, rot: -2.4, s: 1.0 },
      { x: -38, z: -12, rot: 0.2, s: 1.1 }, { x: 39, z: -16, rot: -0.3, s: 1.0 },
      { x: -8, z: -34, rot: 3.0, s: 0.9 }, { x: 11, z: -38, rot: 2.7, s: 1.05 },
    ];
    for (const h of huts) this._hut(h.x, h.z, h.rot, h.s);

    // broken walkway posts — mid-ground texture without blocking movement
    for (let i = 0; i < 70; i++) {
      const a = rr(0, Math.PI * 2);
      const r = rr(14, 74);
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      const h = rr(0.7, 3.2);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(rr(0.10, 0.20), rr(0.13, 0.24), h, 6), this.matPlank);
      post.position.set(x, h / 2 - 0.45, z);
      post.rotation.set(rr(-0.14, 0.14), rr(0, 6.28), rr(-0.14, 0.14));
      post.castShadow = true;
      this.group.add(post);
      if (rnd() < 0.35) this._mossDrape(post, 0, h * 0.3, 0, rr(0.5, 1.1), rr(0.8, 2.0));
    }
  }

  _torii(x, z, rot, s) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    g.scale.setScalar(s);
    const H = SCALE.toriiHeight[0] + rnd() * (SCALE.toriiHeight[1] - SCALE.toriiHeight[0]);
    const halfW = H * 0.42;

    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.40, H, 9), this.matPlank);
      post.position.set(sx * halfW, H / 2 - 0.7, 0);
      post.rotation.z = sx * rr(-0.035, 0.035);
      post.castShadow = true; post.receiveShadow = true;
      g.add(post);
      this.obstacles.push({ x: x + Math.cos(rot) * sx * halfW * s, z: z - Math.sin(rot) * sx * halfW * s, r: 0.55 * s });
    }

    // top beam with an upward sweep, slightly broken
    const beamLen = halfW * 2.75;
    const beamGeo = new THREE.BoxGeometry(beamLen, 0.44, 0.62);
    const bp = beamGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const bx = bp.getX(i);
      bp.setY(i, bp.getY(i) + Math.pow(Math.abs(bx) / (beamLen / 2), 2.4) * 0.85);
    }
    beamGeo.computeVertexNormals();
    const beam = new THREE.Mesh(beamGeo, this.matPlank);
    beam.position.y = H - 0.85;
    beam.rotation.z = rr(-0.035, 0.035);
    beam.castShadow = true;
    g.add(beam);

    const beam2 = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2.25, 0.30, 0.40), this.matPlank);
    beam2.position.y = H - 1.95;
    beam2.castShadow = true;
    g.add(beam2);

    // heavy moss drapery so it reads as swamp, not clean shrine
    this._mossDrape(g, -halfW * 0.55, H - 1.15, 0, 2.2, 4.4);
    this._mossDrape(g, halfW * 0.45, H - 1.15, 0, 1.8, 5.6);
    this._mossDrape(g, 0, H - 2.15, 0, 2.6, 3.2);

    // warm lantern — the only warmth in the frame
    const lx = rr(-halfW * 0.7, halfW * 0.7);
    this._lantern(g, lx, H - 2.9, 0, x + lx * s * Math.cos(rot), H - 2.9, z - lx * s * Math.sin(rot));
    if (rnd() < 0.5) {
      const lx2 = -lx * 0.8;
      this._lantern(g, lx2, H - 4.2, 0, x + lx2 * s * Math.cos(rot), H - 4.2, z - lx2 * s * Math.sin(rot));
    }

    this.group.add(g);
    this.collidables.push(g);
  }

  _hut(x, z, rot, s) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    g.scale.setScalar(s);
    const H = SCALE.hutHeight[0] + rnd() * (SCALE.hutHeight[1] - SCALE.hutHeight[0]);
    const R = H * 0.85;

    // stilts
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.78;
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, H * 0.75, 6), this.matPlank);
      st.position.set(Math.sin(a) * R * 0.6, H * 0.375 - 0.5, Math.cos(a) * R * 0.6);
      st.castShadow = true;
      g.add(st);
    }
    // platform + partial walls
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.72, R * 0.72, 0.16, 8), this.matPlank);
    plat.position.y = H * 0.72;
    plat.castShadow = true; plat.receiveShadow = true;
    g.add(plat);
    const wallCount = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < wallCount; i++) {
      const a = rr(0, Math.PI * 2);
      const w = new THREE.Mesh(new THREE.BoxGeometry(R * 0.7, H * 0.5, 0.10), this.matPlank);
      w.position.set(Math.sin(a) * R * 0.62, H * 0.98, Math.cos(a) * R * 0.62);
      w.rotation.y = a;
      w.rotation.z = rr(-0.1, 0.1);
      w.castShadow = true;
      g.add(w);
    }

    // conical thatch roof — echoes the player's hat, deliberately
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push(new THREE.Vector2(R * 1.16 * t, H * 0.85 * Math.pow(1 - t, 1.7)));
    }
    const roofGeo = new THREE.LatheGeometry(pts, 14);
    const rp = roofGeo.attributes.position; const rv = new THREE.Vector3();
    for (let i = 0; i < rp.count; i++) {
      rv.fromBufferAttribute(rp, i);
      const a = Math.atan2(rv.z, rv.x);
      rv.y += Math.sin(a * 3.3 + rot) * 0.10 * (Math.hypot(rv.x, rv.z) / (R * 1.16));
      rp.setXYZ(i, rv.x, rv.y, rv.z);
    }
    roofGeo.computeVertexNormals();
    const roof = new THREE.Mesh(roofGeo, this.matThatch);
    roof.position.y = H * 1.24;
    roof.rotation.z = rr(-0.09, 0.09);
    roof.castShadow = true;
    g.add(roof);

    this._mossDrape(g, R * 0.5, H * 1.15, 0, 1.4, rr(1.2, 2.6));
    this._mossDrape(g, -R * 0.4, H * 1.1, R * 0.3, 1.1, rr(1.0, 2.2));
    if (rnd() < 0.55) this._lantern(g, R * 0.75, H * 0.95, 0, x + R * 0.75 * s * Math.cos(rot), H * 0.95, z - R * 0.75 * s * Math.sin(rot));

    this.obstacles.push({ x, z, r: R * 0.75 * s });
    this.group.add(g);
    this.collidables.push(g);
  }

  _lantern(parent, lx, ly, lz, wx, wy, wz) {
    const g = new THREE.Group();
    g.position.set(lx, ly, lz);

    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.55, 4), this.matPlank);
    cord.position.y = 0.42;
    g.add(cord);

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.20, 0.42, 8), new THREE.MeshStandardMaterial({
      color: PALETTE.lantern.clone().multiplyScalar(0.5), emissive: PALETTE.lantern.clone(),
      emissiveIntensity: 1.6, roughness: 0.8, transparent: true, opacity: 0.94,
    }));
    g.add(body);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.24, 0.07, 8), this.matPlank);
    cap.position.y = 0.24; g.add(cap);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.22, 0.06, 8), this.matPlank);
    base.position.y = -0.23; g.add(base);

    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTex, color: PALETTE.lantern.clone(), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.75,
    }));
    halo.scale.setScalar(2.6);
    g.add(halo);

    parent.add(g);
    this.lanternMeshes.push({ group: g, halo, body, phase: rr(0, 100) });
    this.lighting?.registerLantern(new THREE.Vector3(wx, wy, wz), rr(0.8, 1.15));
  }

  _mossDrape(parent, x, y, z, w, h) {
    const tex = TL.mossCurtain(256, 30 + Math.floor(rnd() * 7));
    const mat = new THREE.MeshStandardMaterial({
      map: tex, transparent: true, alphaTest: 0.42, side: THREE.DoubleSide,
      roughness: 1.0, color: PALETTE.mossDark.clone(),
    });
    const g = new THREE.Group();
    g.position.set(x, y, z);
    for (let i = 0; i < 2; i++) {
      const geo = new THREE.PlaneGeometry(w, h, 3, 5);
      geo.translate(0, -h / 2, 0);
      const m = new THREE.Mesh(geo, mat);
      m.rotation.y = i * Math.PI / 2 + rr(0, 1);
      g.add(m);
    }
    parent.add(g);
    this.swayables.push({ group: g, phase: rr(0, 100), amp: rr(0.03, 0.08) });
    return g;
  }

  // -------------------------------------------------------------- mushrooms --
  _composeMushrooms() {
    // Mid-ground silhouette anchors, deliberately left AND right (ART_TARGET §2).
    const spots = [
      { x: -22, z: -18, s: 1.35 }, { x: 26, z: -22, s: 1.15 },
      { x: -40, z: 4, s: 1.0 }, { x: 42, z: 10, s: 1.1 },
      { x: -14, z: -44, s: 0.9 }, { x: 18, z: -48, s: 1.0 },
      { x: -52, z: -30, s: 1.25 }, { x: 55, z: -26, s: 1.2 },
      { x: -33, z: 36, s: 0.85 }, { x: 36, z: 40, s: 0.95 },
      { x: 0, z: -62, s: 1.3 }, { x: -62, z: 12, s: 1.15 },
    ];
    for (const s of spots) this._mushroom(s.x, s.z, s.s);

    // small clusters at the waterline for foreground detail
    for (let i = 0; i < 26; i++) {
      const a = rr(0, 6.283), r = rr(12, 70);
      this._mushroom(Math.sin(a) * r, Math.cos(a) * r, rr(0.06, 0.14), true);
    }
  }

  _mushroom(x, z, s, small = false) {
    const g = new THREE.Group();
    g.position.set(x, small ? -0.35 : -0.6, z);
    g.rotation.y = rr(0, 6.283);
    const H = (SCALE.mushroomHeight[0] + rnd() * (SCALE.mushroomHeight[1] - SCALE.mushroomHeight[0])) * s;
    const capR = H * rr(0.42, 0.58);

    // curved tapering stalk
    const stalkPts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      stalkPts.push(new THREE.Vector2(H * 0.085 * (1 - t * 0.42) + H * 0.02 * Math.sin(t * 6), H * t));
    }
    const stalkGeo = new THREE.LatheGeometry(stalkPts, 12);
    const sp = stalkGeo.attributes.position; const sv = new THREE.Vector3();
    const lean = rr(-0.10, 0.10), lean2 = rr(-0.10, 0.10);
    for (let i = 0; i < sp.count; i++) {
      sv.fromBufferAttribute(sp, i);
      const t = sv.y / H;
      sv.x += lean * H * t * t; sv.z += lean2 * H * t * t;
      sp.setXYZ(i, sv.x, sv.y, sv.z);
    }
    stalkGeo.computeVertexNormals();
    const stalk = new THREE.Mesh(stalkGeo, this.matStalk);
    stalk.castShadow = true; stalk.receiveShadow = true;
    g.add(stalk);

    // wide flat cap
    const capPts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      capPts.push(new THREE.Vector2(capR * t, capR * 0.30 * Math.pow(1 - t * t, 0.75) - capR * 0.05 * t));
    }
    const capGeo = new THREE.LatheGeometry(capPts, 24);
    const cp = capGeo.attributes.position; const cv = new THREE.Vector3();
    for (let i = 0; i < cp.count; i++) {
      cv.fromBufferAttribute(cp, i);
      const a = Math.atan2(cv.z, cv.x);
      const rr2 = Math.hypot(cv.x, cv.z) / capR;
      cv.y += (Math.sin(a * 4.1) * 0.05 + Math.sin(a * 9.3) * 0.02) * capR * rr2;
      cp.setXYZ(i, cv.x, cv.y, cv.z);
    }
    capGeo.computeVertexNormals();
    const cap = new THREE.Mesh(capGeo, this.matCap);
    cap.position.set(lean * H, H, lean2 * H);
    cap.castShadow = true;
    g.add(cap);

    // pale ridged gills underneath — catches the moon from below
    const gillGeo = new THREE.CircleGeometry(capR * 0.93, 26);
    gillGeo.rotateX(Math.PI / 2);
    const gp = gillGeo.attributes.position; const gv = new THREE.Vector3();
    for (let i = 0; i < gp.count; i++) {
      gv.fromBufferAttribute(gp, i);
      const a = Math.atan2(gv.z, gv.x);
      gv.y -= Math.abs(Math.sin(a * 22)) * capR * 0.02 + Math.hypot(gv.x, gv.z) / capR * capR * 0.05;
      gp.setXYZ(i, gv.x, gv.y, gv.z);
    }
    gillGeo.computeVertexNormals();
    const gill = new THREE.Mesh(gillGeo, this.matGill);
    gill.position.set(lean * H, H - capR * 0.02, lean2 * H);
    g.add(gill);

    if (!small) {
      this._mossDrape(g, capR * 0.5, H - capR * 0.1, 0, capR * 0.4, rr(2, 5));
      this.obstacles.push({ x, z, r: H * 0.09 });
      this.collidables.push(g);
    }
    this.group.add(g);
  }

  // ------------------------------------------------------------------ trees --
  _composeTrees() {
    // Near-black silhouettes entering from the top of frame (ART_TARGET §9).
    const spots = [
      { x: -16, z: -8, s: 1.4 }, { x: 19, z: -12, s: 1.3 },
      { x: -30, z: -34, s: 1.5 }, { x: 34, z: -38, s: 1.45 },
      { x: -46, z: 20, s: 1.2 }, { x: 48, z: 26, s: 1.25 },
      { x: -9, z: 46, s: 1.1 }, { x: 12, z: 52, s: 1.15 },
      { x: -68, z: -8, s: 1.5 }, { x: 70, z: -14, s: 1.4 },
      { x: -24, z: 62, s: 1.2 }, { x: 28, z: 66, s: 1.3 },
    ];
    for (const s of spots) this._deadTree(s.x, s.z, s.s);
    for (let i = 0; i < 22; i++) {
      const a = rr(0, 6.283), r = rr(52, 105);
      this._deadTree(Math.sin(a) * r, Math.cos(a) * r, rr(0.8, 1.4), true);
    }
  }

  _deadTree(x, z, s, distant = false) {
    const g = new THREE.Group();
    g.position.set(x, -0.9, z);
    g.rotation.y = rr(0, 6.283);
    const H = (SCALE.deadTreeHeight[0] + rnd() * (SCALE.deadTreeHeight[1] - SCALE.deadTreeHeight[0])) * s;
    const mat = distant ? this.matSilhouette : this.matBark;

    const trunkPts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      trunkPts.push(new THREE.Vector2(H * 0.055 * (1 - t * 0.72) + H * 0.012, H * t));
    }
    const trunkGeo = new THREE.LatheGeometry(trunkPts, 9);
    const tp = trunkGeo.attributes.position; const tv = new THREE.Vector3();
    const bx = rr(-0.12, 0.12), bz = rr(-0.12, 0.12);
    for (let i = 0; i < tp.count; i++) {
      tv.fromBufferAttribute(tp, i);
      const t = tv.y / H;
      tv.x += bx * H * t * t + Math.sin(tv.y * 0.4) * H * 0.012;
      tv.z += bz * H * t * t + Math.cos(tv.y * 0.35) * H * 0.012;
      tp.setXYZ(i, tv.x, tv.y, tv.z);
    }
    trunkGeo.computeVertexNormals();
    const trunk = new THREE.Mesh(trunkGeo, mat);
    trunk.castShadow = true;
    g.add(trunk);

    // bare branches
    const nb = distant ? 4 : 7;
    for (let i = 0; i < nb; i++) {
      const t = 0.42 + (i / nb) * 0.55;
      const a = rr(0, 6.283);
      const len = H * rr(0.16, 0.38) * (1 - t * 0.4);
      const bg = new THREE.CylinderGeometry(H * 0.012, H * 0.004, len, 5);
      bg.translate(0, len / 2, 0);
      const b = new THREE.Mesh(bg, mat);
      b.position.set(bx * H * t * t, H * t, bz * H * t * t);
      b.rotation.set(rr(0.7, 1.35), a, 0);
      b.castShadow = true;
      g.add(b);
      if (!distant && rnd() < 0.75) {
        this._mossDrape(b, 0, len * rr(0.4, 0.8), 0, rr(1.0, 2.4), rr(3, 9));
      }
    }
    if (!distant) {
      this.obstacles.push({ x, z, r: H * 0.06 });
      this.collidables.push(g);
    }
    this.group.add(g);
  }

  // ------------------------------------------------------------- villagers --
  _composeVillagers() {
    // Motionless hatted silhouettes standing in the water, barely visible (ART_TARGET §9).
    this.villagers = [];
    const spots = [
      [-30, 16], [-35, 19], [-40, 14], [30, 30], [37, 27],
      [-52, -4], [56, 2], [-16, 52], [20, 56], [-60, 30], [63, 34],
    ];
    for (const [x, z] of spots) {
      const g = new THREE.Group();
      g.position.set(x, -0.5, z);
      g.rotation.y = rr(0, 6.283);
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.55, 3, 8), this.matSilhouette);
      body.position.y = 0.55;
      g.add(body);
      const hatPts = [];
      for (let i = 0; i <= 6; i++) { const t = i / 6; hatPts.push(new THREE.Vector2(0.72 * t, 0.34 * Math.pow(1 - t, 1.7))); }
      const hat = new THREE.Mesh(new THREE.LatheGeometry(hatPts, 12), this.matSilhouette);
      hat.position.y = 1.05;
      g.add(hat);
      const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 2.4, 5), this.matSilhouette);
      spear.position.set(0.4, 1.0, 0);
      spear.rotation.z = rr(-0.16, 0.16);
      g.add(spear);
      this.group.add(g);
      this.villagers.push({ group: g, phase: rr(0, 100) });
      this.obstacles.push({ x, z, r: 0.45 });
    }
  }

  // -------------------------------------------------------------- lilypads --
  _composeLilypads() {
    const tex = TL.lilypad(256);
    const mat = new THREE.MeshStandardMaterial({
      map: tex.map, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide,
      roughness: 0.62, color: 0xffffff,
    });
    const geo = new THREE.PlaneGeometry(1, 1, 2, 2);
    geo.rotateX(-Math.PI / 2);

    // Deliberate clusters, never uniform scatter (ART_TARGET §6).
    const clusters = [
      { x: -8, z: 30, r: 9, n: 34 }, { x: 14, z: 26, r: 8, n: 30 },
      { x: -24, z: 2, r: 7, n: 24 }, { x: 22, z: -2, r: 8, n: 28 },
      { x: 0, z: 44, r: 11, n: 40 }, { x: -36, z: -14, r: 9, n: 26 },
      { x: 38, z: -10, r: 8, n: 24 }, { x: -44, z: 30, r: 10, n: 30 },
      { x: 46, z: 34, r: 9, n: 26 }, { x: 6, z: -30, r: 7, n: 20 },
      { x: -14, z: -22, r: 6, n: 18 }, { x: 30, z: 48, r: 10, n: 28 },
    ];
    let total = 0;
    for (const c of clusters) total += c.n;
    total = Math.ceil(total * settings.q.instanceDensity);

    const inst = new THREE.InstancedMesh(geo, mat, total);
    inst.receiveShadow = true;
    
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    let i = 0;
    this.lilypadData = [];
    for (const c of clusters) {
      const n = Math.ceil(c.n * settings.q.instanceDensity);
      for (let k = 0; k < n && i < total; k++, i++) {
        // gaussian-ish clumping toward the cluster centre
        const a = rr(0, 6.283);
        const rad = c.r * Math.pow(rnd(), 0.6);
        const x = c.x + Math.sin(a) * rad, z = c.z + Math.cos(a) * rad;
        const s = rr(0.55, 1.9);
        pos.set(x, SCALE.waterLevel + 0.015 + rnd() * 0.01, z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rr(0, 6.283));
        scl.set(s, 1, s);
        m.compose(pos, q, scl);
        inst.setMatrixAt(i, m);
        this.lilypadData.push({ x, z, s, rot: a, phase: rr(0, 100) });
      }
    }
    inst.count = i;
    inst.instanceMatrix.needsUpdate = true;
    this.lilypads = inst;
    this.group.add(inst);
  }

  _composeReeds() {
    const geo = new THREE.PlaneGeometry(0.14, 2.0, 1, 4);
    geo.translate(0, 1.0, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: PALETTE.mossDark.clone(), roughness: 1.0, side: THREE.DoubleSide,
      transparent: true, alphaTest: 0.3,
    });
    const n = Math.ceil(900 * settings.q.instanceDensity);
    const inst = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    // reeds hug the arena edge — they visually close the world without a wall
    let i = 0;
    for (; i < n; i++) {
      const a = rr(0, 6.283);
      const edge = rnd() < 0.72;
      const r = edge ? rr(SCALE.arenaRadius * 0.92, SCALE.arenaRadius * 1.5) : rr(14, SCALE.arenaRadius * 0.85);
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      pos.set(x, SCALE.waterLevel - 0.3, z);
      q.setFromEuler(new THREE.Euler(rr(-0.2, 0.2), rr(0, 6.283), rr(-0.2, 0.2)));
      const s = rr(0.6, 1.7);
      scl.set(1, s, 1);
      m.compose(pos, q, scl);
      inst.setMatrixAt(i, m);
    }
    inst.count = i;
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = false;
    this.reeds = inst;
    this.group.add(inst);
  }

  // ----------------------------------------------------------------- lotus --
  _composeLotus() {
    // THE single saturated accent in the frame (ART_TARGET §3, accent 4).
    this.lotuses = [];
    const spots = [[13, 27], [-7, 31], [1, 45]];
    for (let li = 0; li < spots.length; li++) {
      const [x, z] = spots[li];
      const g = new THREE.Group();
      g.position.set(x, SCALE.waterLevel + 0.02, z);
      const petalMat = new THREE.MeshStandardMaterial({
        color: PALETTE.lotus.clone(), emissive: PALETTE.lotusDeep.clone(),
        emissiveIntensity: li === 0 ? 0.55 : 0.3, roughness: 0.62, side: THREE.DoubleSide,
      });
      const rows = [
        { n: 8, len: 0.34, tilt: 1.25, y: 0.02 },
        { n: 7, len: 0.28, tilt: 0.95, y: 0.06 },
        { n: 6, len: 0.21, tilt: 0.62, y: 0.10 },
        { n: 5, len: 0.14, tilt: 0.30, y: 0.14 },
      ];
      for (const row of rows) {
        for (let i = 0; i < row.n; i++) {
          const a = (i / row.n) * Math.PI * 2 + rr(0, 0.4);
          const shape = new THREE.Shape();
          shape.moveTo(0, 0);
          shape.quadraticCurveTo(row.len * 0.42, row.len * 0.42, 0, row.len);
          shape.quadraticCurveTo(-row.len * 0.42, row.len * 0.42, 0, 0);
          const pg = new THREE.ShapeGeometry(shape, 8);
          const petal = new THREE.Mesh(pg, petalMat);
          petal.position.set(Math.sin(a) * row.len * 0.16, row.y, Math.cos(a) * row.len * 0.16);
          petal.rotation.set(-row.tilt, a, 0);
          g.add(petal);
        }
      }
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), new THREE.MeshBasicMaterial({
        color: PALETTE.lotus.clone(), toneMapped: false,
      }));
      core.position.y = 0.15;
      g.add(core);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTex, color: PALETTE.lotus.clone(), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.5,
      }));
      halo.scale.setScalar(1.1);
      halo.position.y = 0.14;
      g.add(halo);
      this.group.add(g);
      this.lotuses.push({ group: g, phase: rr(0, 100), halo });
    }
  }

  _composeDebris() {
    // floating planks and broken beams — foreground interest at the waterline
    const geo = new THREE.BoxGeometry(1, 0.09, 0.28);
    const n = Math.ceil(120 * settings.q.instanceDensity);
    const inst = new THREE.InstancedMesh(geo, this.matPlank, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    this.debrisData = [];
    for (let i = 0; i < n; i++) {
      const a = rr(0, 6.283), r = rr(8, 78);
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      const rot = rr(0, 6.283);
      const s = rr(0.6, 2.6);
      pos.set(x, SCALE.waterLevel - 0.02, z);
      q.setFromEuler(new THREE.Euler(0, rot, 0));
      scl.set(s, 1, rr(0.7, 1.6));
      m.compose(pos, q, scl);
      inst.setMatrixAt(i, m);
      this.debrisData.push({ x, z, rot, s, phase: rr(0, 100) });
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.receiveShadow = true;
    this.debris = inst;
    this.group.add(inst);
  }

  // --------------------------------------------------------- arena changes --
  /** Phase 2 raises broken shrine pillars from the water: cover for moonfall. */
  raisePillars() {
    if (this.pillars.length) return;
    const spots = [[-11, -4], [12, -6], [-6, 12], [9, 14], [-17, 6], [18, 4]];
    for (const [x, z] of spots) {
      const h = rr(4.5, 7.0);
      const geo = new THREE.CylinderGeometry(1.05, 1.35, h, 10, 3);
      const p = geo.attributes.position; const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const n = Math.sin(v.y * 1.7 + x) * 0.11 + Math.sin(v.x * 3 + v.z * 3) * 0.07;
        v.x *= 1 + n; v.z *= 1 + n;
        p.setXYZ(i, v.x, v.y, v.z);
      }
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, this.matPlank);
      mesh.position.set(x, -h, z);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.group.add(mesh);
      this._mossDrape(mesh, 0, h * 0.3, 0, 1.8, 3.0);
      const rec = { mesh, x, z, r: 1.3, targetY: h / 2 - 1.2, rising: true };
      this.pillars.push(rec);
      this.obstacles.push({ x, z, r: 1.35 });
      this.collidables.push(mesh);
    }
    bus.emit(EVT.SFX, { id: 'pillarsRise', gain: 0.95 });
  }

  /** Phase 3: the mire turns against the player — lanterns snuff, fog thickens. */
  darken() {
    this._darkening = 0.0001;
  }

  // ---------------------------------------------------------------- update --
  update(dt, elapsed, playerPos) {
    const t = elapsed;

    for (const s of this.swayables) {
      s.group.rotation.z = Math.sin(t * 0.55 + s.phase) * s.amp;
      s.group.rotation.x = Math.cos(t * 0.42 + s.phase * 1.3) * s.amp * 0.8;
    }

    for (const l of this.lanternMeshes) {
      const k = 0.78 + 0.22 * Math.sin(t * 1.7 + l.phase) * Math.sin(t * 0.63 + l.phase * 0.4);
      const flick = Math.sin(t * 9.1 + l.phase) * Math.sin(t * 3.3) > 0.93 ? 0.55 : 1;
      const dim = this._darkening ? Math.max(0, 1 - this._darkening * 1.4) : 1;
      l.halo.material.opacity = 0.75 * k * flick * dim;
      l.halo.scale.setScalar(2.6 * (0.9 + k * 0.2));
      l.body.material.emissiveIntensity = 1.6 * k * flick * dim;
      l.group.rotation.z = Math.sin(t * 0.9 + l.phase) * 0.06;
    }

    for (const lo of this.lotuses) {
      lo.group.position.y = SCALE.waterLevel + 0.02 + Math.sin(t * 0.7 + lo.phase) * 0.015;
      lo.group.rotation.z = Math.sin(t * 0.5 + lo.phase) * 0.04;
      lo.halo.material.opacity = 0.4 + 0.16 * Math.sin(t * 1.1 + lo.phase);
    }

    for (const v of this.villagers) {
      v.group.position.y = -0.5 + Math.sin(t * 0.4 + v.phase) * 0.015;
    }

    for (const p of this.pillars) {
      if (!p.rising) continue;
      p.mesh.position.y += dt * 3.4;
      if (Math.random() < dt * 30) this.water.splash(p.x + rr(-1.5, 1.5), p.z + rr(-1.5, 1.5), 0.7, 1.3);
      if (p.mesh.position.y >= p.targetY) { p.mesh.position.y = p.targetY; p.rising = false; }
    }

    if (this._darkening !== undefined && this._darkening < 1) {
      this._darkening = Math.min(1, this._darkening + dt * 0.35);
      const k = this._darkening;
      this.scene.fog.density = SCALE.fogDensity * (1 + k * 0.55);
      this.scene.fog.color.copy(PALETTE.fog).lerp(PALETTE.waterDark, k * 0.42);
      this.scene.background.copy(this.scene.fog.color);
      this.water.uniforms.uFogColor.value.copy(this.scene.fog.color);
      this.water.uniforms.uFogDensity.value = this.scene.fog.density;
      this.water.uniforms.uDeep.value.copy(PALETTE.waterDeep).multiplyScalar(1 - k * 0.4);
    }

    // lilypads bob on the swell
    if (this.lilypads && this.lilypadData) {
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
      const step = 3;                             // amortise across frames
      this._lilyCursor = (this._lilyCursor || 0);
      for (let k = 0; k < this.lilypadData.length; k += step) {
        const i = (k + this._lilyCursor) % this.lilypadData.length;
        const d = this.lilypadData[i];
        const y = this.water.heightAt(d.x, d.z, t) + 0.015;
        const tiltX = Math.sin(t * 0.9 + d.phase) * 0.05;
        const tiltZ = Math.cos(t * 0.75 + d.phase) * 0.05;
        pos.set(d.x, y, d.z);
        q.setFromEuler(new THREE.Euler(tiltX, d.rot, tiltZ));
        scl.set(d.s, 1, d.s);
        m.compose(pos, q, scl);
        this.lilypads.setMatrixAt(i, m);
      }
      this._lilyCursor = (this._lilyCursor + 1) % step;
      this.lilypads.instanceMatrix.needsUpdate = true;
    }
  }
}

export default World;
