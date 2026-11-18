'use strict';
/* =====================================================================
   WEAPONS: stats, spray patterns and procedural 3D models.
   Speeds/ranges are given in classic game units and converted (UNIT).
   Inaccuracy values are radians of cone half-angle.
   ===================================================================== */
const W = (o) => Object.assign({ auto: false, pellets: 1, pen: 1, rangeMod: 0.9, range: 4096, inCrouch: 0.75, inJump: 0.3, recover: 0.35, award: 300, deploy: 0.6, scope: null, silenced: false, tracer: 1 }, o);
const WEAPONS = {
  // ---------- pistols ----------
  glock: W({ name: 'Glock-18', slot: 'secondary', cat: 'pistol', team: 'T', price: 200, dmg: 30, ap: 0.47, rpm: 400, mag: 20, reserve: 120, reload: 2.27, speed: 240, rangeMod: 0.85, inStand: 0.0062, inMove: 0.03, inFire: 0.024, recover: 0.33, sound: 'pistol', pat: [11, 0.75, 6, 0.25], model: { type: 'pistol', body: 0x2b2c2e, slide: 0x2f3134 } }),
  usp: W({ name: 'USP-S', slot: 'secondary', cat: 'pistol', team: 'CT', price: 200, dmg: 35, ap: 0.505, rpm: 352, mag: 12, reserve: 24, reload: 2.2, speed: 240, rangeMod: 0.99, inStand: 0.0045, inMove: 0.03, inFire: 0.03, recover: 0.36, sound: 'silenced', silenced: true, pat: [12, 1.0, 6, 0.2], model: { type: 'pistol', body: 0x232426, slide: 0x2a2b2e, silencer: true } }),
  p250: W({ name: 'P250', slot: 'secondary', cat: 'pistol', price: 300, dmg: 38, ap: 0.64, rpm: 400, mag: 13, reserve: 26, reload: 2.2, speed: 240, rangeMod: 0.85, inStand: 0.0058, inMove: 0.032, inFire: 0.04, recover: 0.36, sound: 'pistol', pat: [13, 1.25, 6, 0.3], model: { type: 'pistol', body: 0x2a2a2a, slide: 0x6d6f72 } }),
  tec9: W({ name: 'Tec-9', slot: 'secondary', cat: 'pistol', team: 'T', price: 500, dmg: 33, ap: 0.905, rpm: 500, mag: 18, reserve: 90, reload: 2.5, speed: 240, rangeMod: 0.83, inStand: 0.0075, inMove: 0.035, inFire: 0.04, recover: 0.4, sound: 'pistol', pat: [14, 1.1, 6, 0.4], model: { type: 'pistol', body: 0x2b2b29, slide: 0x2f2f2c, long: true } }),
  fiveseven: W({ name: 'Five-SeveN', slot: 'secondary', cat: 'pistol', team: 'CT', price: 500, dmg: 32, ap: 0.911, rpm: 400, mag: 20, reserve: 100, reload: 2.2, speed: 240, rangeMod: 0.81, inStand: 0.0058, inMove: 0.032, inFire: 0.032, recover: 0.36, sound: 'pistol', pat: [15, 1.05, 6, 0.3], model: { type: 'pistol', body: 0x3c3a36, slide: 0x2c2c2c } }),
  deagle: W({ name: 'Desert Eagle', slot: 'secondary', cat: 'pistol', price: 700, dmg: 53, ap: 0.932, rpm: 267, mag: 7, reserve: 35, reload: 2.2, speed: 230, rangeMod: 0.81, pen: 2, inStand: 0.0045, inMove: 0.11, inFire: 0.06, recover: 0.6, sound: 'deagle', pat: [16, 2.6, 4, 0.5], model: { type: 'pistol', body: 0x9b9c9e, slide: 0xb9babc, big: true } }),
  // ---------- SMGs ----------
  mac10: W({ name: 'MAC-10', slot: 'primary', cat: 'smg', team: 'T', price: 1050, dmg: 29, ap: 0.575, rpm: 800, mag: 30, reserve: 100, reload: 2.6, speed: 240, rangeMod: 0.8, auto: true, inStand: 0.012, inMove: 0.045, inFire: 0.006, recover: 0.3, award: 600, sound: 'smg', pat: [21, 0.55, 7, 0.65], model: { type: 'smg', len: 0.32, body: 0x2a2a2a, mag: 'straight', stock: 'folded' } }),
  mp9: W({ name: 'MP9', slot: 'primary', cat: 'smg', team: 'CT', price: 1250, dmg: 26, ap: 0.6, rpm: 857, mag: 30, reserve: 120, reload: 2.1, speed: 240, rangeMod: 0.87, auto: true, inStand: 0.011, inMove: 0.04, inFire: 0.006, recover: 0.3, award: 600, sound: 'smg', pat: [22, 0.5, 7, 0.5], model: { type: 'smg', len: 0.38, body: 0x222324, mag: 'straight', stock: 'polymer' } }),
  mp7: W({ name: 'MP7', slot: 'primary', cat: 'smg', price: 1500, dmg: 29, ap: 0.625, rpm: 750, mag: 30, reserve: 120, reload: 3.1, speed: 220, rangeMod: 0.85, auto: true, inStand: 0.009, inMove: 0.04, inFire: 0.0055, recover: 0.3, award: 600, sound: 'smg', pat: [23, 0.48, 8, 0.4], model: { type: 'smg', len: 0.42, body: 0x262728, mag: 'straight', stock: 'polymer', scope: 'dot' } }),
  ump45: W({ name: 'UMP-45', slot: 'primary', cat: 'smg', price: 1200, dmg: 35, ap: 0.65, rpm: 666, mag: 25, reserve: 100, reload: 3.5, speed: 230, rangeMod: 0.75, auto: true, inStand: 0.011, inMove: 0.04, inFire: 0.0065, recover: 0.3, award: 600, sound: 'smg', pat: [24, 0.62, 8, 0.45], model: { type: 'smg', len: 0.5, body: 0x2d2e2f, mag: 'straight', stock: 'polymer' } }),
  p90: W({ name: 'P90', slot: 'primary', cat: 'smg', price: 2350, dmg: 26, ap: 0.69, rpm: 857, mag: 50, reserve: 100, reload: 3.3, speed: 230, rangeMod: 0.86, auto: true, inStand: 0.01, inMove: 0.035, inFire: 0.0045, recover: 0.3, sound: 'smg', pat: [25, 0.4, 9, 0.35], model: { type: 'smg', len: 0.5, body: 0x3a3d33, mag: 'top', stock: 'bullpup' } }),
  // ---------- heavy ----------
  nova: W({ name: 'Nova', slot: 'primary', cat: 'heavy', price: 1050, dmg: 26, pellets: 9, ap: 0.5, rpm: 68, mag: 8, reserve: 32, reload: 3.4, speed: 220, rangeMod: 0.7, range: 3000, inStand: 0.0, inMove: 0.03, inFire: 0, spread: 0.065, award: 900, sound: 'shotgun', pat: [31, 2.4, 1, 0], model: { type: 'shotgun', len: 1.0, body: 0x2a2b2d, accent: 0x1d1e20, pump: true } }),
  xm1014: W({ name: 'XM1014', slot: 'primary', cat: 'heavy', price: 2000, dmg: 20, pellets: 6, ap: 0.8, rpm: 171, mag: 7, reserve: 32, reload: 3.6, speed: 215, rangeMod: 0.7, range: 3000, auto: true, inStand: 0.0, inMove: 0.03, inFire: 0, spread: 0.07, award: 900, sound: 'shotgun', pat: [32, 1.6, 4, 0.4], model: { type: 'shotgun', len: 1.0, body: 0x232425, accent: 0x232425 } }),
  mag7: W({ name: 'MAG-7', slot: 'primary', cat: 'heavy', team: 'CT', price: 1300, dmg: 30, pellets: 8, ap: 0.75, rpm: 71, mag: 5, reserve: 32, reload: 2.4, speed: 225, rangeMod: 0.45, range: 1400, inStand: 0.0, inMove: 0.03, inFire: 0, spread: 0.055, award: 900, sound: 'shotgun', pat: [33, 2.8, 1, 0], model: { type: 'shotgun', len: 0.75, body: 0x3a3d40, accent: 0x222222, boxmag: true } }),
  sawedoff: W({ name: 'Sawed-Off', slot: 'primary', cat: 'heavy', team: 'T', price: 1100, dmg: 32, pellets: 8, ap: 0.75, rpm: 71, mag: 7, reserve: 32, reload: 3.4, speed: 210, rangeMod: 0.45, range: 1400, inStand: 0.0, inMove: 0.03, inFire: 0, spread: 0.085, award: 900, sound: 'shotgun', pat: [34, 2.8, 1, 0], model: { type: 'shotgun', len: 0.62, body: 0x2c2c2c, accent: 0x7a4a26, pump: true, wood: true } }),
  // ---------- rifles ----------
  galil: W({ name: 'Galil AR', slot: 'primary', cat: 'rifle', team: 'T', price: 1800, dmg: 30, ap: 0.775, rpm: 666, mag: 35, reserve: 90, reload: 3.0, speed: 215, rangeMod: 0.98, pen: 2, auto: true, inStand: 0.0055, inMove: 0.13, inJump: 0.35, inFire: 0.0075, recover: 0.4, sound: 'rifle_t', pat: [41, 0.8, 9, 0.5], model: { type: 'rifle', len: 0.95, body: 0x3a3832, accent: 0x262624, stock: 'skeleton', mag: 'curved', magColor: 0x2b2b29, hg: 'polymer', carry: false } }),
  famas: W({ name: 'FAMAS', slot: 'primary', cat: 'rifle', team: 'CT', price: 2050, dmg: 30, ap: 0.7, rpm: 666, mag: 25, reserve: 90, reload: 3.3, speed: 220, rangeMod: 0.96, pen: 2, auto: true, inStand: 0.005, inMove: 0.12, inJump: 0.35, inFire: 0.0072, recover: 0.4, sound: 'rifle_ct', pat: [42, 0.75, 9, 0.45], model: { type: 'rifle', len: 0.76, body: 0x4a4d52, accent: 0x2a2c30, stock: 'bullpup', mag: 'straight', carry: true } }),
  ak47: W({ name: 'AK-47', slot: 'primary', cat: 'rifle', team: 'T', price: 2700, dmg: 36, ap: 0.775, rpm: 600, mag: 30, reserve: 90, reload: 2.43, speed: 215, rangeMod: 0.98, pen: 2, auto: true, inStand: 0.0048, inMove: 0.14, inJump: 0.38, inFire: 0.0078, recover: 0.42, sound: 'rifle_t', pat: [47, 0.95, 9, 0.6], model: { type: 'rifle', len: 0.88, body: 0x2e2e30, accent: 0x8a5228, stock: 'wood', mag: 'curved', magColor: 0x9a5626, hg: 'wood' } }),
  m4a4: W({ name: 'M4A4', slot: 'primary', cat: 'rifle', team: 'CT', price: 3100, dmg: 33, ap: 0.7, rpm: 666, mag: 30, reserve: 90, reload: 3.07, speed: 225, rangeMod: 0.97, pen: 2, auto: true, inStand: 0.0038, inMove: 0.12, inJump: 0.36, inFire: 0.0066, recover: 0.38, sound: 'rifle_ct', pat: [44, 0.78, 9, 0.45], model: { type: 'rifle', len: 0.84, body: 0x2c2e31, accent: 0x222326, stock: 'polymer', mag: 'straight', magColor: 0x3a3c40, hg: 'rail', scope: 'dot' } }),
  m4a1s: W({ name: 'M4A1-S', slot: 'primary', cat: 'rifle', team: 'CT', price: 2900, dmg: 38, ap: 0.7, rpm: 600, mag: 20, reserve: 80, reload: 3.07, speed: 225, rangeMod: 0.99, pen: 2, auto: true, inStand: 0.0035, inMove: 0.12, inJump: 0.36, inFire: 0.006, recover: 0.36, sound: 'silenced_rifle', silenced: true, pat: [45, 0.65, 9, 0.33], model: { type: 'rifle', len: 0.84, body: 0x2c2e31, accent: 0x222326, stock: 'polymer', mag: 'straight', magColor: 0x3a3c40, hg: 'rail', silencer: true } }),
  sg553: W({ name: 'SG 553', slot: 'primary', cat: 'rifle', team: 'T', price: 3000, dmg: 30, ap: 1.0, rpm: 545, mag: 30, reserve: 90, reload: 2.8, speed: 210, rangeMod: 0.98, pen: 2, auto: true, inStand: 0.0042, inMove: 0.13, inJump: 0.36, inFire: 0.007, recover: 0.4, scope: [45], sound: 'rifle_t', pat: [46, 0.82, 9, 0.5], model: { type: 'rifle', len: 0.9, body: 0x3a3c35, accent: 0x2b2c27, stock: 'polymer', mag: 'curved', magColor: 0x2b2c27, hg: 'polymer', scope: 'small' } }),
  aug: W({ name: 'AUG', slot: 'primary', cat: 'rifle', team: 'CT', price: 3300, dmg: 28, ap: 0.9, rpm: 600, mag: 30, reserve: 90, reload: 3.8, speed: 220, rangeMod: 0.98, pen: 2, auto: true, inStand: 0.0038, inMove: 0.12, inJump: 0.36, inFire: 0.0066, recover: 0.38, scope: [45], sound: 'rifle_ct', pat: [48, 0.72, 9, 0.42], model: { type: 'rifle', len: 0.74, body: 0x4b5245, accent: 0x2b2e28, stock: 'bullpup', mag: 'straight', magColor: 0x8a9478, scope: 'small' } }),
  ssg08: W({ name: 'SSG 08', slot: 'primary', cat: 'sniper', price: 1700, dmg: 88, ap: 0.85, rpm: 48, mag: 10, reserve: 90, reload: 3.7, speed: 230, rangeMod: 0.98, range: 8192, pen: 2.5, inStand: 0.03, inScoped: 0.0007, inMove: 0.17, inJump: 0.3, inFire: 0.06, recover: 0.3, scope: [40, 15], sound: 'scout', deploy: 1.0, pat: [51, 0, 1, 0], kick: 1.6, model: { type: 'sniper', len: 1.0, body: 0x3d434a, accent: 0x272b30, scope: 'big', slim: true } }),
  awp: W({ name: 'AWP', slot: 'primary', cat: 'sniper', price: 4750, dmg: 115, ap: 0.975, rpm: 41, mag: 5, reserve: 30, reload: 3.67, speed: 200, rangeMod: 0.99, range: 8192, pen: 3, inStand: 0.09, inScoped: 0.0004, inMove: 0.3, inJump: 0.5, inFire: 0.08, recover: 0.4, scope: [40, 10], award: 100, sound: 'awp', deploy: 1.2, pat: [52, 0, 1, 0], kick: 2.6, model: { type: 'sniper', len: 1.18, body: 0x55623f, accent: 0x2a301e, scope: 'big' } }),
  // ---------- melee / equipment ----------
  knife: W({ name: 'Knife', slot: 'knife', cat: 'knife', price: 0, dmg: 40, speed: 250, award: 1500, deploy: 0.5, model: { type: 'knife' } }),
  taser: W({ name: 'Zeus x27', slot: 'taser', cat: 'equipment', price: 200, dmg: 500, ap: 1, rpm: 30, mag: 1, reserve: 0, reload: 0, speed: 220, range: 180, inStand: 0.004, inMove: 0.01, inFire: 0, award: 0, sound: 'taser', model: { type: 'taser' } }),
  c4: W({ name: 'C4 Explosive', slot: 'c4', cat: 'c4', price: 0, speed: 250, deploy: 0.4, model: { type: 'c4' } }),
  // ---------- grenades ----------
  he: W({ name: 'HE Grenade', short: 'HE', slot: 'grenade', cat: 'grenade', price: 300, max: 1, speed: 245, deploy: 0.6, model: { type: 'nade', kind: 'he' } }),
  flash: W({ name: 'Flashbang', short: 'Flash', slot: 'grenade', cat: 'grenade', price: 200, max: 2, speed: 245, deploy: 0.6, model: { type: 'nade', kind: 'flash' } }),
  smoke: W({ name: 'Smoke Grenade', short: 'Smoke', slot: 'grenade', cat: 'grenade', price: 300, max: 1, speed: 245, deploy: 0.6, model: { type: 'nade', kind: 'smoke' } }),
  molotov: W({ name: 'Molotov', short: 'Molotov', slot: 'grenade', cat: 'grenade', team: 'T', price: 400, max: 1, speed: 245, deploy: 0.6, fire: true, model: { type: 'nade', kind: 'molotov' } }),
  incgrenade: W({ name: 'Incendiary Grenade', short: 'Incendiary', slot: 'grenade', cat: 'grenade', team: 'CT', price: 500, max: 1, speed: 245, deploy: 0.6, fire: true, model: { type: 'nade', kind: 'incendiary' } }),
  decoy: W({ name: 'Decoy Grenade', short: 'Decoy', slot: 'grenade', cat: 'grenade', price: 50, max: 1, speed: 245, deploy: 0.6, model: { type: 'nade', kind: 'decoy' } }),
};
const NADE_KEYS = ['he', 'flash', 'smoke', 'molotov', 'incgrenade', 'decoy'];
const MAX_NADES = 4;
const GEAR = {
  vest: { name: 'Kevlar Vest', price: 650 },
  vesthelm: { name: 'Kevlar + Helmet', price: 1000 },
  defuser: { name: 'Defuse Kit', price: 400, team: 'CT' },
};
const BUY_MENU = {
  T: [['Pistols', ['glock', 'p250', 'tec9', 'deagle']], ['Mid-tier', ['mac10', 'mp7', 'ump45', 'p90', 'nova', 'xm1014', 'sawedoff']], ['Rifles', ['galil', 'ak47', 'sg553', 'ssg08', 'awp']], ['Grenades', ['flash', 'smoke', 'he', 'molotov', 'decoy']], ['Equipment', ['vest', 'vesthelm', 'taser']]],
  CT: [['Pistols', ['usp', 'p250', 'fiveseven', 'deagle']], ['Mid-tier', ['mp9', 'mp7', 'ump45', 'p90', 'nova', 'xm1014', 'mag7']], ['Rifles', ['famas', 'm4a4', 'm4a1s', 'aug', 'ssg08', 'awp']], ['Grenades', ['flash', 'smoke', 'he', 'incgrenade', 'decoy']], ['Equipment', ['vest', 'vesthelm', 'defuser', 'taser']]],
};
for (const k in WEAPONS) WEAPONS[k].key = k;

// ---------------------------------------------------------- spray patterns
// Fixed (learnable) pattern per gun: climbs first, then sways side to side.
// Values are cumulative degrees [right, up] for bullet n.
function makePattern(seed, climb, climbShots, sway, n = 60) {
  const rng = mulberry32(seed * 7919);
  const out = [[0, 0]];
  let x = 0, y = 0, dir = rng() < 0.5 ? -1 : 1, seg = 3 + Math.floor(rng() * 4);
  for (let i = 1; i < n; i++) {
    let dx, dy;
    if (i < climbShots) { dy = climb * (1.15 - i / (climbShots * 1.5)); dx = (rng() - 0.45) * sway * 0.35; }
    else {
      if (--seg <= 0) { dir = -dir; seg = 4 + Math.floor(rng() * 5); }
      dx = dir * sway * (0.7 + rng() * 0.5); dy = climb * 0.12 * (rng() - 0.25);
    }
    x += dx; y += dy; out.push([x, y]);
  }
  return out;
}
for (const k in WEAPONS) { const w = WEAPONS[k]; if (w.pat) w.pattern = makePattern(...w.pat); }

// ---------------------------------------------------------- 3D models
const GUNMAT = {};
function gunMat(color, kind) {
  const key = color + '|' + kind;
  if (!GUNMAT[key]) {
    const p = kind === 'metal' ? { roughness: 0.38, metalness: 0.55, envMapIntensity: 1.2 } : kind === 'wood' ? { roughness: 0.62, metalness: 0 } : kind === 'glass' ? { roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.75 } : kind === 'glow' ? { roughness: 1, metalness: 0, emissive: color, emissiveIntensity: 2 } : { roughness: 0.68, metalness: 0.15 };
    const m = new THREE.MeshStandardMaterial(Object.assign({ color }, p));
    // surface detail from the scanned textures: wood grain, machined metal, textured polymer
    if (kind === 'wood' && detailTex('brown_planks_05', 'diff', 1)) {
      m.map = detailTex('brown_planks_05', 'diff', 1); m.normalMap = detailTex('brown_planks_05', 'nor', 1); m.normalScale.set(0.6, 0.6);
      m.color.multiplyScalar(1.9); m.roughness = 0.55;
    } else if (kind === 'metal' && detailTex('metal_plate', 'nor', 1)) {
      m.normalMap = detailTex('metal_plate', 'nor', 1); m.normalScale.set(0.25, 0.25); m.roughnessMap = detailTex('metal_plate', 'arm', 1); m.roughness = 0.9;
    } else if (kind === 'poly' && detailTex('concrete_floor_worn_001', 'nor', 2)) {
      m.normalMap = detailTex('concrete_floor_worn_001', 'nor', 2); m.normalScale.set(0.35, 0.35); m.roughness = 0.78;
    }
    GUNMAT[key] = m;
  }
  return GUNMAT[key];
}
// box with rounded edges: vertices are pulled onto spheres around an inner box
const RBOX = {};
function roundedBox(w, h, d) {
  const key = [w, h, d].map((v) => v.toFixed(4)).join('|');
  if (RBOX[key]) return RBOX[key];
  const r = Math.min(w, h, d) * 0.22, seg = 3;
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg), pos = g.attributes.position, v = new THREE.Vector3(), inner = new THREE.Vector3();
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    inner.set(clamp(v.x, -hx, hx), clamp(v.y, -hy, hy), clamp(v.z, -hz, hz));
    v.sub(inner); if (v.lengthSq() > 0) v.setLength(r);
    v.add(inner); pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return (RBOX[key] = g);
}
function part(group, w, h, d, x, y, z, mat, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(roundedBox(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; group.add(m); return m;
}
function cylPart(group, r, len, x, y, z, mat, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.rotation.x = Math.PI / 2; m.position.set(x, y, z); m.castShadow = true; group.add(m); return m;
}
// Origin = pistol grip (where the trigger hand sits); barrel points to -Z.
function buildGunModel(key, opts = {}) {
  if (key === 'knife' && typeof buildKnife === 'function') return buildKnife(opts.knife || 'combat', opts.finish, opts.team);
  const gl = typeof buildGLTFGun === 'function' && buildGLTFGun(key);
  if (gl) { if (opts.finish) applyFinish(gl.group, opts.finish, 0.45); return gl; }
  const proc = buildGunModelProc(key);
  if (opts.finish && typeof applyFinish === 'function') applyFinish(proc.group, opts.finish, 0.45);
  return proc;
}
function buildGunModelProc(key) {
  const w = WEAPONS[key], m = w.model, g = new THREE.Group();
  const info = { group: g, muzzle: new THREE.Vector3(0, 0.03, -0.5), fore: new THREE.Vector3(0, -0.02, -0.3), mag: null };
  const steel = gunMat(m.body || 0x2a2a2a, 'metal'), poly = gunMat(m.accent || 0x222222, m.wood ? 'wood' : 'poly');
  if (m.type === 'rifle' || m.type === 'smg' || m.type === 'shotgun' || m.type === 'sniper') {
    const L = m.len || 0.8, bull = m.stock === 'bullpup';
    const recL = m.type === 'smg' ? L * 0.55 : bull ? L * 0.55 : L * 0.36;
    const recZ0 = bull ? 0.18 : 0.06; // rear of receiver
    const recH = m.type === 'smg' ? 0.075 : 0.085;
    part(g, 0.052, recH, recL, 0, 0.035, recZ0 - recL / 2, steel);
    part(g, 0.054, 0.012, recL * 0.9, 0, 0.035 + recH / 2 + 0.004, recZ0 - recL / 2, gunMat(0x1a1a1a, 'metal')); // top cover/rail
    part(g, 0.034, 0.1, 0.045, 0, -0.045, 0.012, poly, 0.32); // pistol grip
    part(g, 0.008, 0.035, 0.03, 0, -0.012, -0.03, steel); // trigger guard
    // stock
    if (m.stock === 'wood' || m.stock === 'polymer') {
      const sm = m.stock === 'wood' ? gunMat(m.accent, 'wood') : poly;
      const s = part(g, 0.045, 0.08, 0.28, 0, 0.01, recZ0 + 0.14, sm); s.rotation.x = -0.06;
      part(g, 0.047, 0.11, 0.02, 0, -0.005, recZ0 + 0.28, gunMat(0x1a1a1a, 'poly'));
    } else if (m.stock === 'skeleton') {
      part(g, 0.012, 0.012, 0.26, 0, 0.05, recZ0 + 0.13, steel); part(g, 0.012, 0.012, 0.26, 0, -0.03, recZ0 + 0.13, steel, 0.25);
      part(g, 0.014, 0.1, 0.02, 0, 0.0, recZ0 + 0.26, steel);
    } else if (m.stock === 'folded') {
      part(g, 0.01, 0.01, 0.12, 0.03, 0.02, recZ0 - 0.04, steel);
    }
    // handguard / pump
    const hgZ = recZ0 - recL, hgL = m.type === 'smg' ? 0.08 : m.type === 'sniper' ? 0.3 : 0.22;
    if (!bull && m.type !== 'smg') {
      const hgMat = m.hg === 'wood' ? gunMat(m.accent, 'wood') : m.hg === 'rail' ? steel : poly;
      part(g, 0.056, m.pump ? 0.06 : 0.068, hgL, 0, m.pump ? 0.0 : 0.028, hgZ - hgL / 2, m.pump ? poly : hgMat);
      if (m.hg === 'rail') for (let i = 0; i < 5; i++) part(g, 0.06, 0.008, 0.02, 0, 0.066, hgZ - 0.02 - i * 0.045, gunMat(0x151515, 'metal'));
      if (m.hg === 'wood') part(g, 0.014, 0.014, hgL * 0.9, 0, 0.075, hgZ - hgL / 2, steel); // gas tube
    }
    info.fore.set(0, -0.01, (bull ? recZ0 - recL - 0.03 : hgZ - hgL * 0.55));
    // barrel
    const barrelL = (m.type === 'sniper' ? 0.42 : m.type === 'shotgun' ? L * 0.5 : m.type === 'smg' ? 0.06 : 0.22) + (bull ? 0.06 : 0);
    const bz0 = bull ? recZ0 - recL : m.type === 'smg' ? recZ0 - recL : hgZ - hgL;
    cylPart(g, m.type === 'shotgun' ? 0.016 : m.slim ? 0.009 : 0.011, barrelL, 0, 0.035, bz0 - barrelL / 2, gunMat(0x1b1b1b, 'metal'));
    if (m.type === 'shotgun' && !m.boxmag) cylPart(g, 0.013, barrelL * 0.8, 0, 0.0, bz0 - barrelL * 0.4, gunMat(0x202020, 'metal')); // tube magazine
    let mz = bz0 - barrelL;
    if (m.silencer) { cylPart(g, 0.02, 0.17, 0, 0.035, mz - 0.085, gunMat(0x18191b, 'poly'), 12); mz -= 0.17; }
    else if (m.type === 'rifle' || m.type === 'sniper') { cylPart(g, 0.015, 0.05, 0, 0.035, mz - 0.025, gunMat(0x111111, 'metal')); mz -= 0.05; }
    info.muzzle.set(0, 0.035, mz);
    if (m.type === 'rifle' && !m.scope && !m.carry) part(g, 0.008, 0.05, 0.01, 0, 0.065, bz0 - barrelL + 0.04, steel); // front sight
    // magazine
    const magG = new THREE.Group(); magG.position.set(0, 0, bull ? recZ0 - 0.07 : -0.09); g.add(magG); info.mag = magG;
    const mm = gunMat(m.magColor || 0x2a2a2a, m.magColor === 0x9a5626 ? 'wood' : 'poly');
    if (m.mag === 'curved') { for (let i = 0; i < 3; i++) part(magG, 0.03, 0.07, 0.06, 0, -0.03 - i * 0.06, -i * 0.022, mm, -0.25 - i * 0.12); }
    else if (m.mag === 'straight') part(magG, 0.028, m.type === 'smg' ? 0.16 : 0.15, 0.05, 0, -0.07, 0, mm, -0.12);
    else if (m.mag === 'top') part(magG, 0.05, 0.035, 0.26, 0, 0.09, -0.08, gunMat(0x6b6b4a, 'glass'));
    else if (m.boxmag) part(magG, 0.03, 0.1, 0.05, 0, -0.05, 0, mm, -0.05);
    // optics
    if (m.carry) { part(g, 0.02, 0.05, recL * 0.8, 0, 0.1, recZ0 - recL / 2, poly); part(g, 0.02, 0.012, recL * 0.9, 0, 0.13, recZ0 - recL / 2, steel); }
    if (m.scope === 'big' || m.scope === 'small') {
      const sl = m.scope === 'big' ? 0.32 : 0.16, sr = m.scope === 'big' ? 0.024 : 0.02;
      cylPart(g, sr, sl, 0, 0.115, recZ0 - recL / 2 + 0.02, gunMat(0x121314, 'metal'), 14);
      cylPart(g, sr * 1.35, 0.06, 0, 0.115, recZ0 - recL / 2 + 0.02 - sl / 2, gunMat(0x121314, 'metal'), 14);
      const lens = cylPart(g, sr * 1.2, 0.004, 0, 0.115, recZ0 - recL / 2 + 0.02 - sl / 2 - 0.031, gunMat(0x4a8acc, 'glass'), 14);
      lens.renderOrder = 2;
      part(g, 0.012, 0.04, 0.02, 0, 0.08, recZ0 - recL / 2 + 0.08, steel); part(g, 0.012, 0.04, 0.02, 0, 0.08, recZ0 - recL / 2 - 0.05, steel);
    } else if (m.scope === 'dot') {
      part(g, 0.035, 0.04, 0.05, 0, 0.09, recZ0 - recL * 0.55, gunMat(0x18191a, 'metal'));
      part(g, 0.02, 0.02, 0.004, 0, 0.095, recZ0 - recL * 0.55 + 0.026, gunMat(0xff2a1a, 'glow'));
    }
    if (m.type === 'sniper') part(g, 0.01, 0.012, 0.06, 0.035, 0.05, recZ0 - 0.05, steel, 0, 0, 0.4); // bolt handle
  } else if (m.type === 'pistol') {
    const big = m.big ? 1.25 : 1, len = (m.long ? 0.24 : 0.19) * big;
    part(g, 0.03 * big, 0.034 * big, len, 0, 0.045, -len / 2 + 0.035, gunMat(m.slide, 'metal'));
    part(g, 0.028 * big, 0.022, len * 0.85, 0, 0.018, -len / 2 + 0.03, gunMat(m.body, 'poly'));
    part(g, 0.03 * big, 0.11 * big, 0.045, 0, -0.04, 0.02, gunMat(m.body, 'poly'), 0.28);
    part(g, 0.007, 0.03, 0.03, 0, -0.005, -0.03, gunMat(m.body, 'poly'));
    let mz = -len + 0.035;
    if (m.silencer) { cylPart(g, 0.017, 0.15, 0, 0.045, mz - 0.075, gunMat(0x18191b, 'poly'), 12); mz -= 0.15; }
    info.muzzle.set(0, 0.045, mz);
    info.fore.set(0, -0.04, 0.03);
    const magG = new THREE.Group(); magG.position.set(0, -0.05, 0.02); g.add(magG); info.mag = magG;
    part(magG, 0.024, 0.05, 0.035, 0, -0.04, 0, gunMat(0x1a1a1a, 'metal'), 0.28);
  } else if (m.type === 'knife') {
    part(g, 0.025, 0.03, 0.12, 0, 0, 0.03, gunMat(0x1c1c1c, 'poly'));
    part(g, 0.05, 0.04, 0.012, 0, 0, -0.035, gunMat(0x555555, 'metal'));
    const blade = new THREE.BoxGeometry(0.006, 0.034, 0.19, 1, 1, 4);
    const pos = blade.attributes.position;
    for (let i = 0; i < pos.count; i++) { const z = pos.getZ(i); if (z < -0.05) pos.setY(i, pos.getY(i) * (1 - (-(z) - 0.05) / 0.16) + 0.006); }
    blade.computeVertexNormals();
    const bm = new THREE.Mesh(blade, gunMat(0xd8dde2, 'metal')); bm.position.set(0, 0.004, -0.135); g.add(bm);
    info.muzzle.set(0, 0, -0.23);
  } else if (m.type === 'taser') {
    part(g, 0.04, 0.05, 0.16, 0, 0.04, -0.06, gunMat(0x2b2f36, 'poly'));
    part(g, 0.03, 0.1, 0.045, 0, -0.03, 0.02, gunMat(0x2b2f36, 'poly'), 0.28);
    part(g, 0.042, 0.052, 0.02, 0, 0.04, -0.15, gunMat(0xd8b832, 'poly'));
    info.muzzle.set(0, 0.04, -0.16);
  } else if (m.type === 'c4') {
    part(g, 0.14, 0.06, 0.2, 0, 0.0, -0.05, gunMat(0x6b6346, 'poly'));
    for (let i = 0; i < 4; i++) part(g, 0.03, 0.065, 0.19, -0.05 + i * 0.033, 0, -0.05, gunMat(0xb39a64, 'poly'));
    part(g, 0.08, 0.02, 0.09, 0, 0.04, -0.04, gunMat(0x222222, 'poly'));
    part(g, 0.06, 0.004, 0.025, 0, 0.051, -0.06, gunMat(0x6e8f5a, 'glow'));
    info.mag = null;
  } else if (m.type === 'nade') {
    const k = m.kind;
    if (k === 'he') { const s = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), gunMat(0x4f5a30, 'poly')); s.scale.y = 1.25; g.add(s); }
    else if (k === 'molotov') {
      cylPart(g, 0.03, 0.12, 0, 0, 0, gunMat(0x3f6b2c, 'glass')).rotation.x = 0;
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.02, 0.06, 8), gunMat(0x3f6b2c, 'glass')); neck.position.y = 0.09; g.add(neck);
      const rag = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.02), gunMat(0xd8cfb4, 'poly')); rag.position.y = 0.135; rag.rotation.z = 0.3; g.add(rag);
    } else {
      const col = k === 'flash' ? 0x9ea2a6 : k === 'smoke' ? 0x7a8a7c : k === 'incendiary' ? 0x8e2a22 : 0x6b6b5a;
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, k === 'decoy' ? 0.08 : 0.11, 12), gunMat(col, 'metal')); g.add(c);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.015, 12), gunMat(k === 'smoke' ? 0xc9b04a : 0x333333, 'poly')); band.position.y = 0.02; g.add(band);
    }
    if (k !== 'molotov') {
      part(g, 0.012, 0.02, 0.02, 0, 0.065, 0, gunMat(0x555555, 'metal'));
      part(g, 0.01, 0.08, 0.012, 0.022, 0.03, 0, gunMat(0x8a8d90, 'metal'), 0, 0, -0.15); // spoon
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.0025, 6, 12), gunMat(0xb9bcc0, 'metal')); ring.position.set(-0.02, 0.075, 0); g.add(ring);
    }
    info.muzzle.set(0, 0.05, 0);
  }
  return info;
}
const GUN_CACHE = {};
// opts: { finish, knife, team } (cosmetics); each look is built once and cloned
const cosKey = (key, o) => key + '|' + ((o && o.knife) || '') + '|' + ((o && o.finish) || '') + '|' + (key === 'knife' && o ? o.team : '');
function gunModel(key, opts) {
  const ck = cosKey(key, opts);
  if (!GUN_CACHE[ck]) GUN_CACHE[ck] = buildGunModel(key, opts || {});
  const src = GUN_CACHE[ck], g = src.gltf ? SkeletonUtils.clone(src.group) : src.group.clone(true);
  // find the cloned magazine by index path
  let mag = null;
  if (src.mag) { const idx = src.group.children.indexOf(src.mag); mag = g.children[idx]; }
  return { group: g, muzzle: src.muzzle.clone(), fore: src.fore.clone(), mag };
}
