import * as THREE from 'three';
import { PALETTE, SCALE } from '../core/Palette.js';
import TL from '../world/TextureLab.js';

/**
 * The amphibian warrior. Procedurally built, animated by transform hierarchy
 * (no skinning) so the silhouette stays crisp at the tiny on-screen size the
 * reference frame demands.
 *
 * Silhouette contract (ART_TARGET §7): the conical hat IS the silhouette. It is
 * wider than the body and has a ragged dripping fringe.
 */

function noisySphere(r, wSeg, hSeg, amp, seed = 1) {
  const g = new THREE.SphereGeometry(r, wSeg, hSeg);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 7.3 + seed) * Math.cos(v.y * 6.1 - seed) * Math.sin(v.z * 5.7 + seed * 2);
    v.multiplyScalar(1 + n * amp);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export class PlayerModel {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'player';

    const skinTex = TL.skin(512);
    const clothTex = TL.cloth(256);
    const thatchTex = TL.thatch(512);
    const steelTex = TL.steel(256);
    const mossTex = TL.moss(512);

    this.matSkin = new THREE.MeshStandardMaterial({
      ...skinTex, color: PALETTE.skin.clone(), roughness: 0.62, metalness: 0.0,
      normalScale: new THREE.Vector2(0.9, 0.9),
    });
    this.matSkin.map.repeat.set(2, 2);
    this.matCloth = new THREE.MeshStandardMaterial({ ...clothTex, color: PALETTE.cloth.clone(), roughness: 0.95 });
    this.matThatch = new THREE.MeshStandardMaterial({
      ...thatchTex, color: PALETTE.thatch.clone(), roughness: 0.92, side: THREE.DoubleSide,
    });
    this.matMoss = new THREE.MeshStandardMaterial({ ...mossTex, color: PALETTE.moss.clone(), roughness: 0.98 });
    this.matSteel = new THREE.MeshStandardMaterial({
      ...steelTex, color: PALETTE.steel.clone(), roughness: 0.34, metalness: 0.82,
      envMapIntensity: 1.3,
    });

    const S = SCALE.playerHeight;

    // ---------------- body ----------------
    this.pelvis = new THREE.Group();
    this.pelvis.position.y = S * 0.44;
    this.root.add(this.pelvis);

    this.torso = new THREE.Group();
    this.pelvis.add(this.torso);

    const torsoGeo = noisySphere(S * 0.30, 20, 16, 0.06, 3);
    torsoGeo.scale(1.12, 1.0, 0.92);
    const torso = new THREE.Mesh(torsoGeo, this.matSkin);
    torso.position.y = S * 0.06;
    torso.castShadow = true; torso.receiveShadow = true;
    this.torso.add(torso);

    // hunched mossy shell / cloak over the back
    const shellGeo = noisySphere(S * 0.34, 18, 14, 0.10, 7);
    shellGeo.scale(1.0, 0.72, 0.82);
    const shell = new THREE.Mesh(shellGeo, this.matMoss);
    shell.position.set(0, S * 0.14, -S * 0.10);
    shell.castShadow = true;
    this.torso.add(shell);

    // chest wrap
    const wrapGeo = new THREE.CylinderGeometry(S * 0.30, S * 0.32, S * 0.22, 16, 1, true);
    const wrap = new THREE.Mesh(wrapGeo, this.matCloth);
    wrap.position.y = S * 0.02;
    wrap.rotation.z = 0.06;
    this.torso.add(wrap);

    // ---------------- head ----------------
    this.neck = new THREE.Group();
    this.neck.position.y = S * 0.28;
    this.torso.add(this.neck);

    const headGeo = noisySphere(S * 0.21, 20, 16, 0.05, 11);
    headGeo.scale(1.22, 0.82, 1.05);   // broad flat amphibian skull
    const head = new THREE.Mesh(headGeo, this.matSkin);
    head.castShadow = true;
    this.neck.add(head);

    // eyes — domed, set high and wide
    const eyeGeo = new THREE.SphereGeometry(S * 0.058, 12, 10);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0d1210, roughness: 0.18, metalness: 0.1 });
    const eyeLidMat = new THREE.MeshStandardMaterial({ ...skinTex, color: PALETTE.skinDark.clone(), roughness: 0.6 });
    for (const sx of [-1, 1]) {
      const eyeSocket = new THREE.Mesh(noisySphere(S * 0.072, 12, 10, 0.05, 13), eyeLidMat);
      eyeSocket.position.set(sx * S * 0.115, S * 0.075, S * 0.055);
      this.neck.add(eyeSocket);
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(sx * S * 0.118, S * 0.082, S * 0.088);
      this.neck.add(eye);
    }

    // wide mouth line
    const mouth = new THREE.Mesh(
      new THREE.BoxGeometry(S * 0.30, S * 0.012, S * 0.02),
      new THREE.MeshStandardMaterial({ color: 0x1a1f18, roughness: 0.9 })
    );
    mouth.position.set(0, -S * 0.04, S * 0.155);
    mouth.rotation.x = -0.12;
    this.neck.add(mouth);

    // ---------------- hat (the silhouette) ----------------
    this.hat = new THREE.Group();
    this.hat.position.y = S * 0.15;
    this.neck.add(this.hat);

    const hatR = S * 0.62;                 // markedly wider than the body
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const r = hatR * t;
      const y = S * 0.30 * Math.pow(1 - t, 1.75) - S * 0.02 * t;
      pts.push(new THREE.Vector2(r, y));
    }
    const hatGeo = new THREE.LatheGeometry(pts, 28);
    // dent the brim so it isn't a perfect cone
    const hp = hatGeo.attributes.position; const hv = new THREE.Vector3();
    for (let i = 0; i < hp.count; i++) {
      hv.fromBufferAttribute(hp, i);
      const rr = Math.hypot(hv.x, hv.z);
      const a = Math.atan2(hv.z, hv.x);
      hv.y += Math.sin(a * 3.0) * 0.018 * rr / hatR * S + Math.sin(a * 7.0 + 1.3) * 0.008 * S;
      hp.setXYZ(i, hv.x, hv.y, hv.z);
    }
    hatGeo.computeVertexNormals();
    const hatMesh = new THREE.Mesh(hatGeo, this.matThatch);
    hatMesh.castShadow = true;
    this.hat.add(hatMesh);

    // a small moss tuft on the crown
    const tuft = new THREE.Mesh(noisySphere(S * 0.075, 10, 8, 0.22, 21), this.matMoss);
    tuft.position.y = S * 0.28;
    tuft.scale.set(1.3, 0.7, 1.1);
    this.hat.add(tuft);

    // ragged dripping fringe around the rim
    const fringeTex = TL.mossCurtain(256, 71);
    this.matFringe = new THREE.MeshStandardMaterial({
      map: fringeTex, transparent: true, alphaTest: 0.42, side: THREE.DoubleSide,
      roughness: 1.0, color: PALETTE.thatch.clone(),
    });
    const fringeGeo = new THREE.CylinderGeometry(hatR * 0.995, hatR * 1.02, S * 0.26, 30, 3, true);
    fringeGeo.translate(0, -S * 0.145, 0);
    this.fringe = new THREE.Mesh(fringeGeo, this.matFringe);
    this.fringe.castShadow = false;
    this._fringeBase = fringeGeo.attributes.position.clone();
    this.hat.add(this.fringe);

    // ---------------- arms ----------------
    this.armR = this._makeArm(S, 1);
    this.armL = this._makeArm(S, -1);
    this.torso.add(this.armR.shoulder, this.armL.shoulder);

    // ---------------- sword ----------------
    this.sword = this._makeSword(S);
    this.armR.hand.add(this.sword.group);

    // ---------------- legs ----------------
    this.legR = this._makeLeg(S, 1);
    this.legL = this._makeLeg(S, -1);
    this.pelvis.add(this.legR.hip, this.legL.hip);

    // hip cloth skirt (breaks the waterline)
    const skirtGeo = new THREE.CylinderGeometry(S * 0.26, S * 0.36, S * 0.30, 18, 2, true);
    skirtGeo.translate(0, -S * 0.13, 0);
    this.skirt = new THREE.Mesh(skirtGeo, this.matCloth);
    this.skirt.material = new THREE.MeshStandardMaterial({ ...clothTex, color: PALETTE.cloth.clone(), roughness: 0.96, side: THREE.DoubleSide });
    this._skirtBase = skirtGeo.attributes.position.clone();
    this.pelvis.add(this.skirt);

    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });

    this.height = S;
    this._t = 0;
  }

  _makeArm(S, side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * S * 0.28, S * 0.16, 0);
    const upperGeo = new THREE.CapsuleGeometry(S * 0.072, S * 0.16, 4, 10);
    upperGeo.translate(0, -S * 0.10, 0);
    const upper = new THREE.Mesh(upperGeo, this.matSkin);
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.y = -S * 0.20;
    shoulder.add(elbow);
    const foreGeo = new THREE.CapsuleGeometry(S * 0.060, S * 0.15, 4, 10);
    foreGeo.translate(0, -S * 0.095, 0);
    const fore = new THREE.Mesh(foreGeo, this.matSkin);
    elbow.add(fore);

    // wrapping
    const wrapGeo = new THREE.CylinderGeometry(S * 0.066, S * 0.062, S * 0.12, 10, 1, true);
    wrapGeo.translate(0, -S * 0.07, 0);
    elbow.add(new THREE.Mesh(wrapGeo, this.matCloth));

    const hand = new THREE.Group();
    hand.position.y = -S * 0.19;
    elbow.add(hand);
    const palm = new THREE.Mesh(noisySphere(S * 0.058, 10, 8, 0.10, 5), this.matSkin);
    palm.scale.set(1.0, 0.85, 1.25);
    hand.add(palm);

    return { shoulder, elbow, hand, side };
  }

  _makeLeg(S, side) {
    const hip = new THREE.Group();
    hip.position.set(side * S * 0.145, -S * 0.06, 0);
    const thighGeo = new THREE.CapsuleGeometry(S * 0.095, S * 0.14, 4, 10);
    thighGeo.translate(0, -S * 0.09, 0);
    hip.add(new THREE.Mesh(thighGeo, this.matSkin));

    const knee = new THREE.Group();
    knee.position.y = -S * 0.19;
    hip.add(knee);
    const shinGeo = new THREE.CapsuleGeometry(S * 0.072, S * 0.14, 4, 10);
    shinGeo.translate(0, -S * 0.085, 0);
    knee.add(new THREE.Mesh(shinGeo, this.matSkin));

    const foot = new THREE.Group();
    foot.position.y = -S * 0.175;
    knee.add(foot);
    // long webbed amphibian foot
    const footGeo = new THREE.SphereGeometry(S * 0.085, 10, 8);
    footGeo.scale(0.85, 0.45, 1.9);
    footGeo.translate(0, -S * 0.02, S * 0.055);
    foot.add(new THREE.Mesh(footGeo, this.matSkin));

    return { hip, knee, foot, side };
  }

  _makeSword(S) {
    const group = new THREE.Group();
    // held down and to the right, tip toward the water (ART_TARGET §7)
    group.rotation.set(-0.28, 0, 0.10);
    group.position.set(0, -S * 0.05, S * 0.02);

    const bladeLen = S * 1.02;
    const shape = new THREE.Shape();
    const w = S * 0.045;
    shape.moveTo(-w, 0);
    shape.lineTo(w, 0);
    shape.lineTo(w * 0.85, bladeLen * 0.86);
    shape.lineTo(0, bladeLen);
    shape.lineTo(-w * 0.85, bladeLen * 0.86);
    shape.closePath();
    const bladeGeo = new THREE.ExtrudeGeometry(shape, { depth: S * 0.016, bevelEnabled: true, bevelSize: S * 0.008, bevelThickness: S * 0.005, bevelSegments: 1, steps: 1 });
    bladeGeo.rotateX(-Math.PI / 2);
    bladeGeo.rotateY(Math.PI / 2);
    bladeGeo.translate(0, 0, 0);
    const blade = new THREE.Mesh(bladeGeo, this.matSteel);
    blade.rotation.z = -Math.PI / 2;
    blade.position.y = S * 0.10;
    group.add(blade);

    const guard = new THREE.Mesh(new THREE.BoxGeometry(S * 0.20, S * 0.026, S * 0.055), this.matSteel);
    guard.position.y = S * 0.09;
    group.add(guard);

    const gripGeo = new THREE.CylinderGeometry(S * 0.028, S * 0.032, S * 0.20, 8);
    gripGeo.translate(0, -S * 0.01, 0);
    group.add(new THREE.Mesh(gripGeo, this.matCloth));

    const pommel = new THREE.Mesh(new THREE.SphereGeometry(S * 0.036, 8, 6), this.matSteel);
    pommel.position.y = -S * 0.115;
    group.add(pommel);

    // tip marker for trail / hit sampling
    const tip = new THREE.Object3D();
    tip.position.set(0, S * 0.10 + bladeLen, 0);
    group.add(tip);
    const base = new THREE.Object3D();
    base.position.set(0, S * 0.12, 0);
    group.add(base);

    return { group, tip, base, length: bladeLen };
  }

  /** Deform the hat fringe and hip skirt so they drape and swing. */
  _flexCloth(dt, speed, turn) {
    const t = this._t;
    const doFlex = (mesh, base, amp, phase) => {
      const p = mesh.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const bx = base.getX(i), by = base.getY(i), bz = base.getZ(i);
        const hang = Math.max(0, -by);
        const sway = Math.sin(t * 2.1 + bx * 3.1 + phase) * 0.006 + Math.sin(t * 3.7 + bz * 2.4) * 0.004;
        p.setXYZ(i,
          bx + (sway + turn * 0.08) * hang * amp,
          by,
          bz + (sway * 0.7 - speed * 0.10) * hang * amp);
      }
      p.needsUpdate = true;
    };
    doFlex(this.fringe, this._fringeBase, 1.0, 0);
    doFlex(this.skirt, this._skirtBase, 0.8, 2.1);
  }

  update(dt, state) { this._t += dt; this._flexCloth(dt, state?.speed01 || 0, state?.turnRate || 0); }
}

export default PlayerModel;
