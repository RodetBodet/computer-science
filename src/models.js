'use strict';
/* =====================================================================
   CHARACTERS: jointed soldier models built from boxes, their animation,
   and the hitboxes bullets are tested against.
   ===================================================================== */
const TEAM_LOOK = {
  T: { jacket: 0x6d6748, pants: 0x857552, vest: 0x4b4331, pouch: 0x5f563c, head: 0x2f2b27, skin: 0xc08a5c, boots: 0x2b241d, glove: 0x2b2723, band: 0xa8392a },
  CT: { jacket: 0x34476a, pants: 0x3f4d61, vest: 0x263345, pouch: 0x31425a, head: 0x46525a, skin: 0xd6a47e, boots: 0x18191c, glove: 0x1b1c20, band: 0x4f86d8 },
};
const SOLDIER_MATS = {};
function soldierMat(team, part) {
  const k = team + part;
  if (!SOLDIER_MATS[k]) {
    const col = TEAM_LOOK[team][part] !== undefined ? TEAM_LOOK[team][part] : part;
    const m = new THREE.MeshStandardMaterial({ color: col, roughness: part === 'head' && team === 'CT' ? 0.45 : 0.88, metalness: part === 'head' && team === 'CT' ? 0.25 : 0 });
    // woven-fabric feel on clothing
    const fab = ['jacket', 'pants', 'vest', 'pouch', 'band', 'glove'].includes(part) && detailTex('asphalt_02', 'nor', 3);
    if (fab) { m.normalMap = fab; m.normalScale.set(0.45, 0.45); }
    SOLDIER_MATS[k] = m;
  }
  return SOLDIER_MATS[k];
}
function sBox(parent, w, h, d, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
const _up = new THREE.Vector3(0, 1, 0);
const CAP_CACHE = {};
// rounded limb segment (capsule), total height h
function sCap(parent, r, h, x, y, z, mat, sx = 1, sz = 1) {
  const key = r + '|' + h;
  const geo = CAP_CACHE[key] || (CAP_CACHE[key] = new THREE.CapsuleGeometry(r, Math.max(0.01, h - 2 * r), 4, 10));
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.scale.set(sx, 1, sz); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function sSphere(parent, r, x, y, z, mat, sy = 1, partial) {
  const geo = partial ? new THREE.SphereGeometry(r, 16, 10, 0, TAU, 0, partial) : new THREE.SphereGeometry(r, 16, 12);
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.y = sy; m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
// box stretched between two points (for arms)
function sLimb(parent, a, b, thick, mat) {
  const d = new THREE.Vector3().subVectors(b, a), L = d.length();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(thick * 0.5, Math.max(0.01, L - thick), 3, 8), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(_up, d.normalize());
  m.castShadow = true; parent.add(m); return m;
}

class SoldierModel {
  constructor(team) {
    this.team = team;
    const M = (p) => soldierMat(team, p);
    const root = new THREE.Group(); this.root = root;
    const pelvis = new THREE.Group(); pelvis.position.y = 0.95; root.add(pelvis); this.pelvis = pelvis;
    sBox(pelvis, 0.34, 0.16, 0.2, 0, 0, 0, M('pants'));
    sBox(pelvis, 0.36, 0.05, 0.22, 0, 0.07, 0, soldierMat(team, 0x1d1b19)); // belt
    this.legs = [];
    for (const sx of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(sx * 0.1, -0.04, 0); pelvis.add(hip);
      sCap(hip, 0.085, 0.5, 0, -0.22, 0, M('pants'));
      sBox(hip, 0.12, 0.12, 0.05, sx * 0.04, -0.24, 0.0, M('pouch')); // cargo pocket
      const knee = new THREE.Group(); knee.position.y = -0.44; hip.add(knee);
      sCap(knee, 0.072, 0.46, 0, -0.22, 0, M('pants'));
      sBox(knee, 0.15, 0.1, 0.06, 0, -0.02, -0.07, M('vest')); // knee pad
      sBox(knee, 0.15, 0.11, 0.27, 0, -0.45, -0.045, M('boots'));
      this.legs.push({ hip, knee });
    }
    const spine = new THREE.Group(); spine.position.y = 0.06; pelvis.add(spine); this.spine = spine;
    sCap(spine, 0.19, 0.6, 0, 0.28, 0, M('jacket'), 1, 0.62);
    sBox(spine, 0.41, 0.36, 0.26, 0, 0.33, 0, M('vest'));
    for (let i = 0; i < 3; i++) sBox(spine, 0.1, 0.11, 0.06, -0.12 + i * 0.12, 0.22, -0.14, M('pouch'));
    sBox(spine, 0.3, 0.3, 0.1, 0, 0.3, 0.16, M('pouch')); // back pack/plate
    this.c4 = sBox(spine, 0.22, 0.14, 0.08, 0, 0.18, 0.24, soldierMat(team, 0x6b6346)); this.c4.visible = false;
    const neck = new THREE.Group(); neck.position.y = 0.56; spine.add(neck); this.neck = neck;
    sBox(neck, 0.12, 0.1, 0.12, 0, 0.0, 0, team === 'T' ? M('head') : M('skin'));
    if (team === 'T') {
      sSphere(neck, 0.118, 0, 0.15, 0, M('head'), 1.15);
      sBox(neck, 0.18, 0.05, 0.02, 0, 0.17, -0.12, M('skin')); // eye slit
      sBox(neck, 0.035, 0.025, 0.01, -0.045, 0.17, -0.131, soldierMat(team, 0x111111));
      sBox(neck, 0.035, 0.025, 0.01, 0.045, 0.17, -0.131, soldierMat(team, 0x111111));
    } else {
      sSphere(neck, 0.108, 0, 0.14, -0.005, M('skin'), 1.15);
      sSphere(neck, 0.135, 0, 0.18, 0.005, M('head'), 0.95, Math.PI * 0.52); // helmet dome
      sBox(neck, 0.27, 0.025, 0.29, 0, 0.185, 0.005, M('head'));
      sBox(neck, 0.2, 0.05, 0.04, 0, 0.215, -0.13, soldierMat(team, 0x181c20)); // goggles
      sBox(neck, 0.06, 0.035, 0.01, -0.05, 0.215, -0.152, soldierMat(team, 0x6fb0d6));
      sBox(neck, 0.06, 0.035, 0.01, 0.05, 0.215, -0.152, soldierMat(team, 0x6fb0d6));
    }
    // arms + weapon pivot (rotates with aim pitch)
    const aim = new THREE.Group(); aim.position.set(0, 0.44, -0.02); spine.add(aim); this.aim = aim;
    for (const sx of [-1, 1]) sSphere(spine, 0.085, sx * 0.23, 0.47, 0, M('jacket')); // shoulders
    sBox(spine, 0.13, 0.04, 0.165, 0.24, 0.43, 0, M('band'));
    this.gunHolder = new THREE.Group(); this.gunHolder.position.set(0.07, -0.07, -0.28); aim.add(this.gunHolder);
    this.armMeshes = [];
    this.weaponKey = null;
    root.traverse((o) => { o.frustumCulled = true; });
    this.walk = 0; this.crouchS = 0; this.deathT = 0; this.deathDir = 1;
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: FX_TEX.flash, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.scale.set(0.35, 0.35, 0.35); this.flash.visible = false; this.flash.material.color.setRGB(8, 6, 3);
  }
  setWeapon(key, cos) {
    const sig = cosKey(key, cos);
    if (this.weaponSig === sig) return;
    this.weaponSig = sig; this.weaponKey = key;
    if (this.gun) this.gunHolder.remove(this.gun.group);
    for (const m of this.armMeshes) this.aim.remove(m);
    this.armMeshes.length = 0;
    this.gun = gunModel(key, cos);
    this.gunHolder.add(this.gun.group);
    this.gun.muzzleObj = new THREE.Object3D(); this.gun.muzzleObj.position.copy(this.gun.muzzle); this.gun.group.add(this.gun.muzzleObj);
    this.gun.muzzleObj.add(this.flash);
    // arms: shoulder -> elbow -> hand on grip / handguard (in aim space)
    const M = (p) => soldierMat(this.team, p);
    const gripW = new THREE.Vector3().copy(this.gunHolder.position);
    const foreW = new THREE.Vector3().copy(this.gun.fore).add(this.gunHolder.position);
    const rs = new THREE.Vector3(0.24, 0.03, 0.02), ls = new THREE.Vector3(-0.24, 0.03, 0.02);
    const re = new THREE.Vector3(0.22, -0.17, -0.1), le = new THREE.Vector3(-0.17, -0.12, -0.2);
    const push = (m) => this.armMeshes.push(m);
    push(sLimb(this.aim, rs, re, 0.11, M('jacket'))); push(sLimb(this.aim, re, gripW, 0.095, M('jacket')));
    push(sLimb(this.aim, ls, le, 0.11, M('jacket'))); push(sLimb(this.aim, le, foreW, 0.095, M('jacket')));
    for (const p of [gripW, foreW]) push(sBox(this.aim, 0.08, 0.08, 0.09, p.x, p.y, p.z, M('glove')));
  }
  // pose the model from the agent's state
  update(a, dt) {
    const r = this.root;
    r.position.set(a.x, a.y, a.z);
    r.rotation.set(0, a.yaw, 0);
    const crouch = a.duckAmt;
    this.crouchS = crouch;
    if (!a.alive) {
      // fall over
      this.deathT = Math.min(1, this.deathT + dt * 2.4);
      const k = 1 - Math.pow(1 - this.deathT, 3);
      r.rotation.x = this.deathDir * k * (Math.PI / 2 - 0.08);
      r.rotation.z = this.deathSide * k * 0.4;
      this.pelvis.position.y = lerp(0.95 - crouch * 0.38, 0.32, k);
      for (const l of this.legs) { l.hip.rotation.x = lerp(l.hip.rotation.x, 0.15, k); l.knee.rotation.x = lerp(l.knee.rotation.x, -0.25, k); }
      this.aim.rotation.x = lerp(this.aim.rotation.x, -0.9, k);
      this.neck.rotation.x = lerp(0, 0.5 * this.deathDir, k);
      this.flash.visible = false;
      return;
    }
    this.deathT = 0; r.rotation.x = 0; r.rotation.z = 0;
    // walk cycle: phase advances with ground speed
    const sp = Math.hypot(a.vx, a.vz);
    const amp = clamp(sp / 4.5, 0, 1) * (a.onGround ? 1 : 0.2);
    this.walk += sp * dt * 2.1;
    const s = Math.sin(this.walk), c = Math.cos(this.walk);
    // local strafe vs forward motion decides how much legs swing
    this.pelvis.position.y = 0.95 - crouch * 0.4 + Math.abs(c) * 0.025 * amp;
    for (let i = 0; i < 2; i++) {
      const ph = i ? -s : s;
      const l = this.legs[i];
      l.hip.rotation.x = crouch * 1.25 + ph * 0.55 * amp * (1 - crouch * 0.5);
      l.knee.rotation.x = -crouch * 2.0 - Math.max(0, i ? c : -c) * 0.7 * amp;
    }
    if (!a.onGround) { this.legs[0].hip.rotation.x += 0.4; this.legs[0].knee.rotation.x -= 0.7; this.legs[1].hip.rotation.x += 0.15; this.legs[1].knee.rotation.x -= 0.3; }
    this.spine.rotation.x = -crouch * 0.28;
    this.aim.rotation.x = a.pitch + crouch * 0.28;
    this.neck.rotation.x = a.pitch * 0.5 + crouch * 0.2;
    this.spine.rotation.y = 0;
    this.c4.visible = a.hasC4;
    this.flash.visible = a.muzzleT > 0;
    if (this.flash.visible) { this.flash.material.rotation = Math.random() * TAU; const sc = 0.25 + Math.random() * 0.2; this.flash.scale.set(sc, sc, sc); }
    if (a.weaponKey) this.setWeapon(a.weaponKey, cosmeticFor(a, a.weaponKey));
  }
}

// ---------------------------------------------------------- hitboxes
// Local frame: feet at origin, facing -Z. [zone, cx, cy, cz, hx, hy, hz] for standing and crouched.
const HB_STAND = [
  ['head', 0, 1.69, -0.01, 0.12, 0.135, 0.125],
  ['chest', 0, 1.36, 0, 0.21, 0.17, 0.14],
  ['stomach', 0, 1.06, 0, 0.19, 0.13, 0.13],
  ['arm', 0.24, 1.3, -0.14, 0.07, 0.17, 0.17],
  ['arm', -0.2, 1.3, -0.22, 0.07, 0.15, 0.19],
  ['leg', -0.1, 0.47, 0, 0.09, 0.47, 0.1],
  ['leg', 0.1, 0.47, 0, 0.09, 0.47, 0.1],
];
const HB_CROUCH = [
  ['head', 0, 1.27, -0.12, 0.12, 0.135, 0.125],
  ['chest', 0, 0.98, -0.07, 0.21, 0.16, 0.15],
  ['stomach', 0, 0.71, -0.02, 0.19, 0.12, 0.14],
  ['arm', 0.24, 0.93, -0.22, 0.07, 0.16, 0.17],
  ['arm', -0.2, 0.93, -0.3, 0.07, 0.14, 0.19],
  ['leg', -0.1, 0.28, -0.15, 0.09, 0.28, 0.26],
  ['leg', 0.1, 0.28, -0.15, 0.09, 0.28, 0.26],
];
const ZONE_MULT = { head: 4, chest: 1, arm: 1, stomach: 1.25, leg: 0.75 };
// ray (world) vs agent hitboxes -> { t, zone } or null
function rayAgent(a, ox, oy, oz, dx, dy, dz, maxT) {
  // quick reject with a bounding cylinder
  const px = ox - a.x, pz = oz - a.z;
  const tc = -(px * dx + pz * dz) / Math.max(1e-6, dx * dx + dz * dz);
  const cx = px + dx * tc, cz = pz + dz * tc;
  if (cx * cx + cz * cz > 0.6 * 0.6) return null;
  const cs = Math.cos(a.yaw), sn = Math.sin(a.yaw);
  const lox = px * cs - pz * sn, loz = px * sn + pz * cs, loy = oy - a.y;
  const ldx = dx * cs - dz * sn, ldz = dx * sn + dz * cs;
  const k = a.duckAmt;
  let best = null;
  for (let i = 0; i < HB_STAND.length; i++) {
    const s = HB_STAND[i], c = HB_CROUCH[i];
    const bx = lerp(s[1], c[1], k), by = lerp(s[2], c[2], k), bz = lerp(s[3], c[3], k);
    const hx = lerp(s[4], c[4], k), hy = lerp(s[5], c[5], k), hz = lerp(s[6], c[6], k);
    const r = rayBox(lox, loy, loz, 1 / (ldx || 1e-9), 1 / (dy || 1e-9), 1 / (ldz || 1e-9), { x0: bx - hx, x1: bx + hx, y0: by - hy, y1: by + hy, z0: bz - hz, z1: bz + hz }, maxT);
    if (r && (!best || r[0] < best.t)) best = { t: r[0], zone: s[0] };
  }
  return best;
}
// points bots aim at
function aimPoint(a, zone) {
  const k = a.duckAmt;
  const y = zone === 'head' ? lerp(1.69, 1.27, k) : zone === 'stomach' ? lerp(1.06, 0.71, k) : lerp(1.33, 0.96, k);
  return { x: a.x, y: a.y + y, z: a.z };
}
