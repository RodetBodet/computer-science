'use strict';
/* =====================================================================
   GLTF MODELS (CC0, see assets/CREDITS.md)
   - guns: Pichuliru weapon set + two Quaternius shotguns
   - characters: Quaternius "SWAT", rigged and animated, recolored per team
   Falls back to the procedural models if anything fails to load.
   ===================================================================== */
const GLTF = { guns: {}, swat: null, ok: false };
// weapon key -> [model file, scale, extras]
const WEAPON_GLB = {
  glock: ['pistol_west_compact', 1], p250: ['pistol_west_compact', 1.05], usp: ['pistol_west', 1, { silencer: 0.15 }], fiveseven: ['pistol_west', 1],
  tec9: ['pistol_full_east', 1.05], deagle: ['pistol_west', 1.22],
  mac10: ['smg_compact_east', 1], mp9: ['smg_west', 1], mp7: ['smg_west', 1.05], ump45: ['smg_full_east', 1.08], p90: ['smg_full_east', 1.05],
  nova: ['shotgun_pump', 1], xm1014: ['shotgun_auto_west', 1], mag7: ['shotgun_pump', 0.82], sawedoff: ['shotgun_sawedoff', 1],
  galil: ['rifle_battle_east', 1], ak47: ['rifle_east', 1.1], sg553: ['rifle_battle_east', 1.05, { scope: 'small' }],
  famas: ['rifle_west2', 0.95], m4a4: ['rifle_west', 1.08], m4a1s: ['rifle_west', 1.08, { silencer: 0.2 }], aug: ['rifle_west2', 0.95, { scope: 'small' }],
  ssg08: ['sniper_east', 1.12, { scope: 'big' }], awp: ['sniper_west', 1.2, { scope: 'big' }],
  smoke: ['smoke_grenade', 1.3],
};
// models without bones: hand-measured anchors (model units) + orientation
const GLB_NOBONES = {
  shotgun_pump: { rotY: Math.PI / 2, len: 0.95, grip: [0.3, -0.3, 0], muzzle: [4.31, 0.12, 0], fore: [2.1, -0.15, 0] },
  shotgun_sawedoff: { rotY: Math.PI / 2, len: 0.62, grip: [0.5, -0.2, 0], muzzle: [3.28, 0.25, 0], fore: [1.9, -0.05, 0] },
  smoke_grenade: { rotY: 0, len: null, grip: [0, 0, 0], muzzle: [0, 0.08, 0], fore: [0, 0, 0] },
};
async function loadGLTFModels(progress) {
  if (location.protocol === 'file:' || typeof GLTFLoader === 'undefined') return false;
  const L = new GLTFLoader();
  const files = [...new Set(Object.values(WEAPON_GLB).map((v) => v[0]))];
  let n = 0;
  try {
    await Promise.all(files.map(async (f) => {
      const g = await L.loadAsync(`assets/models/${f}.glb`);
      GLTF.guns[f] = g.scene; progress && progress(++n / (files.length + 1));
    }));
    GLTF.swat = await L.loadAsync('assets/models/swat.glb'); progress && progress(1);
    GLTF.ok = true;
  } catch (e) { console.warn('model load failed, using built-in models', e); GLTF.ok = false; }
  return GLTF.ok;
}

// tune the flat-shaded materials so they read as metal / polymer / wood under our lighting
function tuneGunMaterial(m) {
  const n = (m.name || '').toLowerCase();
  const c = m.color ? m.color.clone() : new THREE.Color(0.2, 0.2, 0.2);
  const lum = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
  const wood = /brown|wood|chestnut|bole/.test(n);
  const brass = /brass|yellow/.test(n);
  const nm = new THREE.MeshStandardMaterial({
    color: c, roughness: wood ? 0.6 : lum < 0.08 ? 0.55 : 0.42, metalness: wood ? 0 : brass ? 0.9 : lum < 0.25 ? 0.35 : 0.65,
    envMapIntensity: 1.1,
  });
  if (wood && typeof detailTex === 'function' && detailTex('brown_planks_05', 'nor', 4)) { nm.normalMap = detailTex('brown_planks_05', 'nor', 4); nm.normalScale.set(0.5, 0.5); }
  else if (!wood && typeof detailTex === 'function' && detailTex('metal_plate', 'nor', 2)) { nm.normalMap = detailTex('metal_plate', 'nor', 2); nm.normalScale.set(0.15, 0.15); }
  return nm;
}
// returns { group, muzzle, fore, mag } in our gun space (origin at grip, barrel toward -Z)
function buildGLTFGun(key) {
  const spec = WEAPON_GLB[key];
  if (!GLTF.ok || !spec || !GLTF.guns[spec[0]]) return null;
  const [file, scale, extra = {}] = spec;
  const src = GLTF.guns[file];
  const model = SkeletonUtils.clone(src);
  model.updateMatrixWorld(true);
  const matCache = new Map();
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const tuned = mats.map((m) => { if (!matCache.has(m)) matCache.set(m, tuneGunMaterial(m)); return matCache.get(m); });
    o.material = Array.isArray(o.material) ? tuned : tuned[0];
  });
  let grip, muzzle, fore, k = scale;
  const holder = new THREE.Group(); holder.add(model);
  const nb = GLB_NOBONES[file];
  if (nb) {
    const box = new THREE.Box3().setFromObject(model);
    if (nb.len) k *= nb.len / (box.max.x - box.min.x);
    model.rotation.y = nb.rotY; model.scale.setScalar(k);
    const tf = (p) => new THREE.Vector3(...p).multiplyScalar(k).applyAxisAngle(_up, nb.rotY);
    grip = tf(nb.grip); muzzle = tf(nb.muzzle); fore = tf(nb.fore);
  } else {
    const bone = (name) => { let b = null; model.traverse((o) => { if (o.isBone && o.name === name) b = o; }); if (!b) return null; const p = new THREE.Vector3(); b.getWorldPosition(p); return p; };
    model.scale.setScalar(k);
    const t = bone('Trigger') || new THREE.Vector3(), m = bone('Attach_Muzzle') || new THREE.Vector3(0, 0.02, -0.4), r = bone('Attach_RailBottom') || new THREE.Vector3(0, 0, -0.15);
    grip = t.clone().add(new THREE.Vector3(0, -0.045, 0.035)).multiplyScalar(k);
    muzzle = m.multiplyScalar(k); fore = r.add(new THREE.Vector3(0, -0.035, 0)).multiplyScalar(k);
    if (WEAPONS[key].cat === 'pistol') fore = grip.clone().add(new THREE.Vector3(0, -0.01, 0.01));
  }
  model.position.sub(grip); muzzle.sub(grip); fore.sub(grip);
  const g = new THREE.Group(); g.add(holder);
  // attachments the models don't have
  const dark = gunMat(0x18191b, 'poly');
  if (extra.silencer) { cylPart(g, WEAPONS[key].cat === 'pistol' ? 0.016 : 0.02, extra.silencer, muzzle.x, muzzle.y, muzzle.z - extra.silencer / 2, dark, 14); muzzle.z -= extra.silencer; }
  if (extra.scope) {
    const big = extra.scope === 'big', sl = big ? 0.3 : 0.15, sr = big ? 0.024 : 0.019, y = big ? 0.085 : 0.07, z = -0.08;
    cylPart(g, sr, sl, 0, y, z, gunMat(0x121314, 'metal'), 16);
    cylPart(g, sr * 1.35, 0.06, 0, y, z - sl / 2, gunMat(0x121314, 'metal'), 16);
    cylPart(g, sr * 1.25, 0.05, 0, y, z + sl / 2, gunMat(0x121314, 'metal'), 16);
    cylPart(g, sr * 1.2, 0.004, 0, y, z - sl / 2 - 0.031, gunMat(0x4a8acc, 'glass'), 16);
    part(g, 0.014, y - 0.03, 0.02, 0, (y + 0.03) / 2, z + 0.06, gunMat(0x1a1a1a, 'metal')); part(g, 0.014, y - 0.03, 0.02, 0, (y + 0.03) / 2, z - 0.07, gunMat(0x1a1a1a, 'metal'));
  }
  return { group: g, muzzle, fore, mag: null, gltf: true };
}

// ---------------------------------------------------------- characters
const SWAT_LOOK = {
  T: { suit: 0x7b6d4e, dark: 0x3a3528, visor: 0x1a1a1a },
  CT: { suit: 0x34445e, dark: 0x1a1f2a, visor: 0x223344 },
};
const SWAT_MATS = {};
function swatMaterial(team, src) {
  const key = team + src.name;
  if (SWAT_MATS[key]) return SWAT_MATS[key];
  const L = SWAT_LOOK[team], n = src.name;
  const col = n === 'Swat' ? L.suit : n === 'Swat_Black' ? L.dark : n === 'Visor' ? L.visor : src.color.getHex();
  const m = new THREE.MeshStandardMaterial({ color: col, roughness: n === 'Visor' ? 0.15 : 0.85, metalness: n === 'Visor' ? 0.6 : 0 });
  if (n !== 'Skin' && n !== 'Visor' && typeof detailTex === 'function' && detailTex('asphalt_02', 'nor', 3)) { m.normalMap = detailTex('asphalt_02', 'nor', 3); m.normalScale.set(0.4, 0.4); }
  return (SWAT_MATS[key] = m);
}
const SWAT_CLIP = { show: 'Idle_Gun_Pointing', idle: 'Idle_Gun_Pointing', walk: 'Walk', run: 'Run_Shoot', back: 'Run_Back', left: 'Run_Left', right: 'Run_Right', death: 'Death', hit: 'HitRecieve' };
class GltfSoldier {
  constructor(team) {
    this.team = team;
    this.root = new THREE.Group();
    const body = SkeletonUtils.clone(GLTF.swat.scene);
    body.rotation.y = Math.PI; // model faces +Z, ours face -Z
    body.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; o.material = swatMaterial(team, o.material); } });
    this.body = body; this.root.add(body);
    this.bones = {};
    body.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    // bones we tilt by hand (aim + crouch): remember their rest pose so the tilt never accumulates
    this.rest = ['Chest', 'Torso', 'Neck', 'UpperLegL', 'UpperLegR', 'LowerLegL', 'LowerLegR', 'FootL', 'FootR']
      .filter((n) => this.bones[n]).map((n) => [this.bones[n], this.bones[n].quaternion.clone()]);
    this.mixer = new THREE.AnimationMixer(body);
    this.actions = {};
    for (const k in SWAT_CLIP) {
      const clip = GLTF.swat.animations.find((a) => a.name.endsWith('|' + SWAT_CLIP[k]));
      if (!clip) continue;
      const act = this.mixer.clipAction(clip);
      if (k === 'death') { act.setLoop(THREE.LoopOnce); act.clampWhenFinished = true; }
      else if (k === 'hit') { act.setLoop(THREE.LoopOnce); }
      else { act.play(); act.setEffectiveWeight(k === 'idle' ? 1 : 0); }
      this.actions[k] = act;
    }
    this.gunHolder = new THREE.Group(); this.root.add(this.gunHolder);
    this.c4 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.08), new THREE.MeshStandardMaterial({ color: 0x6b6346, roughness: 0.8 }));
    this.c4.visible = false; (this.bones.Chest || this.bones.Torso || this.root).add(this.c4);
    this.c4.position.set(0, 0, -0.18);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: FX_TEX.flash, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.scale.set(0.35, 0.35, 0.35); this.flash.visible = false; this.flash.material.color.setRGB(8, 6, 3);
    this.weaponKey = null; this.deathT = 0; this.deathDir = 1; this.deathSide = 0; this.dead = false;
    this._v = new THREE.Vector3();
  }
  setWeapon(key, cos) {
    const sig = cosKey(key, cos);
    if (this.weaponSig === sig) return;
    this.weaponSig = sig; this.weaponKey = key;
    this.gunHolder.clear();
    this.gun = gunModel(key, cos);
    this.gunHolder.add(this.gun.group);
    const mo = new THREE.Object3D(); mo.position.copy(this.gun.muzzle); this.gun.group.add(mo); mo.add(this.flash);
  }
  update(a, dt) {
    const r = this.root;
    r.position.set(a.x, a.y, a.z);
    r.rotation.set(0, a.yaw, 0);
    if (a.weaponKey) this.setWeapon(a.weaponKey, cosmeticFor(a, a.weaponKey));
    const A = this.actions;
    if (!a.alive) {
      if (!this.dead) {
        this.dead = true;
        for (const k in A) if (k !== 'death') A[k].fadeOut(0.15);
        if (A.death) { A.death.reset(); A.death.setEffectiveWeight(1); A.death.fadeIn(0.1); A.death.play(); }
      }
      this.mixer.update(dt);
      this.gunHolder.visible = false; this.flash.visible = false;
      return;
    }
    if (this.dead) { // respawned
      this.dead = false; this.mixer.stopAllAction();
      for (const k in A) if (k !== 'death' && k !== 'hit') { A[k].play(); A[k].setEffectiveWeight(k === 'idle' ? 1 : 0); }
    }
    this.gunHolder.visible = true;
    // blend locomotion from velocity in the body's own frame
    const sp = Math.hypot(a.vx, a.vz), cs = Math.cos(a.yaw), sn = Math.sin(a.yaw);
    const f = a.vx * -sn + a.vz * -cs;   // speed along facing
    const side = a.vx * cs + a.vz * -sn; // speed to the right
    const run = clamp(sp / 4.5, 0, 1), walk = clamp(sp / 2.2, 0, 1) * (1 - run);
    const sw = (k, w) => { if (A[k]) A[k].setEffectiveWeight(w); };
    const total = Math.max(1e-3, Math.abs(f) + Math.abs(side));
    const fwdShare = Math.max(0, f) / total, backShare = Math.max(0, -f) / total, rightShare = Math.max(0, side) / total, leftShare = Math.max(0, -side) / total;
    const moving = run + walk;
    sw('show', a.showcase ? 1 : 0);
    sw('idle', a.showcase ? 0 : 1 - moving);
    sw('walk', walk * (fwdShare + backShare * 0.2 + (leftShare + rightShare) * 0.2));
    sw('run', run * fwdShare);
    sw('back', run * backShare + walk * backShare * 0.8);
    sw('left', run * leftShare + walk * leftShare * 0.8);
    sw('right', run * rightShare + walk * rightShare * 0.8);
    const rate = sp > 0.3 ? clamp(sp / (run > 0.5 ? 5.2 : 2.4), 0.5, 1.4) : 1;
    for (const k of ['walk', 'run', 'back', 'left', 'right']) if (A[k]) A[k].timeScale = rate;
    // reset hand-tilted bones first: the animation overwrites the ones it drives, the rest stay at rest
    for (const [bone, q] of this.rest) bone.quaternion.copy(q);
    this.mixer.update(dt);
    // procedural layers on top of the animation: crouch + aim pitch
    const B = this.bones, k = a.duckAmt;
    if (k > 0.01) {
      this.body.position.y = -0.42 * k;
      for (const s of ['L', 'R']) {
        if (B['UpperLeg' + s]) B['UpperLeg' + s].rotateX(-1.25 * k);
        if (B['LowerLeg' + s]) B['LowerLeg' + s].rotateX(2.1 * k);
        if (B['Foot' + s]) B['Foot' + s].rotateX(-0.8 * k);
      }
    } else this.body.position.y = 0;
    const spine = B.Chest || B.Torso;
    if (spine) spine.rotateX(-a.pitch * 0.55);
    if (B.Neck) B.Neck.rotateX(-a.pitch * 0.35);
    // gun: held at the right hand, pointed exactly where the agent aims
    const hand = B.WristR || B.LowerArmR;
    this.root.updateMatrixWorld(true);
    if (hand) {
      hand.getWorldPosition(this._v);
      this.root.worldToLocal(this._v);
      this.gunHolder.position.copy(this._v);
    } else this.gunHolder.position.set(0.15, 1.3 - k * 0.4, -0.3);
    this.gunHolder.rotation.set(a.pitch, 0, 0);
    this.c4.visible = a.hasC4;
    this.flash.visible = a.muzzleT > 0;
    if (this.flash.visible) { this.flash.material.rotation = Math.random() * TAU; const s = 0.25 + Math.random() * 0.2; this.flash.scale.set(s, s, s); }
  }
}
function makeSoldierModel(team) { return GLTF.ok && GLTF.swat ? new GltfSoldier(team) : new SoldierModel(team); }
