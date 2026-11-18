'use strict';
/* =====================================================================
   COSMETICS: knife models, weapon finishes, and the item catalog.
   Finishes are applied by a small shader patch that recolors a material
   and adds a pattern in the model's own space (no UVs needed).
   ===================================================================== */
const RARITY = [
  { id: 'common', name: 'Common', color: '#9aa4ad', weight: 50 },
  { id: 'uncommon', name: 'Uncommon', color: '#6cc36c', weight: 26 },
  { id: 'rare', name: 'Rare', color: '#4f9cf0', weight: 13 },
  { id: 'epic', name: 'Epic', color: '#a066f0', weight: 7 },
  { id: 'legendary', name: 'Legendary', color: '#f0a23a', weight: 3 },
  { id: 'mythic', name: 'Mythic', color: '#ff5a5a', weight: 1 },
];
const RAR = Object.fromEntries(RARITY.map((r, i) => [r.id, Object.assign({ tier: i }, r)]));
// palette = [dark, mid, light]; pattern: solid | camo | stripes | fade | damascus
const FINISHES = {
  factory: { name: 'Factory', rarity: 'common', pattern: null },
  nightops: { name: 'Night Ops', rarity: 'common', pattern: 'solid', palette: [0x0e0f11, 0x24272b, 0x3a3e44], metal: 0.4 },
  sandstorm: { name: 'Sandstorm', rarity: 'common', pattern: 'camo', palette: [0x5c4a32, 0x9c8458, 0xcdb88a], metal: 0.1, scale: 14 },
  hazard: { name: 'Hazard', rarity: 'uncommon', pattern: 'stripes', palette: [0x111111, 0x1c1c1c, 0xe8b82a], metal: 0.2, scale: 55 },
  glacier: { name: 'Glacier', rarity: 'uncommon', pattern: 'camo', palette: [0x7f97a8, 0xbccbd6, 0xf2f6f9], metal: 0.1, scale: 12 },
  cobalt: { name: 'Cobalt Wave', rarity: 'rare', pattern: 'stripes', palette: [0x0d1d3a, 0x234f9a, 0x9fb9de], metal: 0.6, scale: 32 },
  jade: { name: 'Jade', rarity: 'rare', pattern: 'solid', palette: [0x0b3326, 0x1f7a58, 0x7fd6b0], metal: 0.3 },
  copper: { name: 'Copper Rush', rarity: 'rare', pattern: 'fade', palette: [0x3a1c0e, 0xb4643a, 0xf0b07a], metal: 0.9 },
  ember: { name: 'Ember', rarity: 'epic', pattern: 'fade', palette: [0x1a0805, 0xc83a12, 0xffb03a], metal: 0.5 },
  orchid: { name: 'Orchid', rarity: 'epic', pattern: 'fade', palette: [0x2a0f3a, 0xa04ac8, 0xf6d6ff], metal: 0.4 },
  aurora: { name: 'Aurora', rarity: 'legendary', pattern: 'fade', palette: [0x062a3a, 0x18b6a8, 0xb06cff], metal: 0.7 },
  damascus: { name: 'Damascus', rarity: 'legendary', pattern: 'damascus', palette: [0x2a2c30, 0x777c84, 0xd8dde2], metal: 0.95, scale: 70 },
  gilded: { name: 'Gilded', rarity: 'mythic', pattern: 'solid', palette: [0x5a3c08, 0xc8962a, 0xffe08a], metal: 1.0 },
};
const PATTERN_ID = { solid: 0, camo: 1, stripes: 2, fade: 3, damascus: 4 };
const FINISH_MATS = new Map();
// returns a copy of `base` wearing the finish
function finishMaterial(base, fid, along) {
  const F = FINISHES[fid];
  if (!F || !F.pattern) return base;
  const key = base.uuid + '|' + fid;
  if (FINISH_MATS.has(key)) return FINISH_MATS.get(key);
  const m = base.clone();
  m.map = null; // the palette replaces any color texture
  m.metalness = F.metal; m.roughness = F.pattern === 'solid' && F.metal > 0.8 ? 0.25 : 0.42;
  const pal = F.palette.map((c) => new THREE.Color(c));
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uC0 = { value: pal[0] }; sh.uniforms.uC1 = { value: pal[1] }; sh.uniforms.uC2 = { value: pal[2] };
    sh.uniforms.uScale = { value: F.scale || 20 }; sh.uniforms.uPat = { value: PATTERN_ID[F.pattern] }; sh.uniforms.uAlong = { value: along || 0.4 };
    sh.vertexShader = 'varying vec3 vObj;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vObj = position;');
    sh.fragmentShader = `varying vec3 vObj; uniform vec3 uC0, uC1, uC2; uniform float uScale, uPat, uAlong;
      float hsh(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float vnoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hsh(i), hsh(i + vec3(1,0,0)), f.x), mix(hsh(i + vec3(0,1,0)), hsh(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hsh(i + vec3(0,0,1)), hsh(i + vec3(1,0,1)), f.x), mix(hsh(i + vec3(0,1,1)), hsh(i + vec3(1,1,1)), f.x), f.y), f.z); }
      ` + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      {
        float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
        vec3 base = mix(uC0, uC1, smoothstep(0.0, 0.18, lum)); base = mix(base, uC2, smoothstep(0.3, 0.75, lum));
        vec3 p = vObj * uScale;
        if (uPat > 0.5 && uPat < 1.5) { // camo blobs
          float n = vnoise(p) * 0.6 + vnoise(p * 2.3) * 0.4;
          base = n < 0.42 ? uC0 : n < 0.6 ? uC1 : uC2;
        } else if (uPat > 1.5 && uPat < 2.5) { // diagonal stripes
          float s = sin((vObj.z + vObj.y) * uScale + vnoise(p * 0.2) * 2.0);
          base = s > 0.2 ? uC2 : mix(uC0, uC1, 0.5);
        } else if (uPat > 2.5 && uPat < 3.5) { // fade along the length
          float t = clamp(0.5 - vObj.z / uAlong + (vObj.y * 1.5), 0.0, 1.0);
          base = mix(mix(uC0, uC1, smoothstep(0.0, 0.5, t)), uC2, smoothstep(0.5, 1.0, t));
        } else if (uPat > 3.5) { // folded steel
          float w = sin(vObj.z * uScale + sin(vObj.y * uScale * 0.7) * 3.0 + vnoise(p * 0.15) * 4.0);
          base = mix(uC1, uC2, smoothstep(-0.2, 0.9, w)) * mix(0.75, 1.0, smoothstep(-1.0, -0.5, w));
        }
        diffuseColor.rgb = base;
      }`);
  };
  m.customProgramCacheKey = () => 'finish-' + fid;
  FINISH_MATS.set(key, m);
  return m;
}
function applyFinish(group, fid, along) {
  if (!fid || fid === 'factory') return;
  group.traverse((o) => {
    if (!o.isMesh || o.userData.noFinish) return;
    o.material = Array.isArray(o.material) ? o.material.map((m) => finishMaterial(m, fid, along)) : finishMaterial(o.material, fid, along);
  });
}

// ---------------------------------------------------------- knives
const KNIFE_TYPES = {
  combat: { name: 'Combat Knife' }, bayonet: { name: 'Bayonet' }, bowie: { name: 'Bowie Knife' },
  karambit: { name: 'Karambit' }, butterfly: { name: 'Butterfly Knife' }, dagger: { name: 'Tactical Dagger' },
};
function bladeGeo(shape, thick) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: true, bevelThickness: 0.0016, bevelSize: 0.0013, bevelSegments: 2, curveSegments: 16 });
  g.translate(0, 0, -thick / 2);
  g.computeVertexNormals();
  return g;
}
function shapeFrom(pts, curves) {
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) { const p = pts[i]; if (p.length === 4) s.quadraticCurveTo(p[0], p[1], p[2], p[3]); else s.lineTo(p[0], p[1]); }
  return s;
}
// Knife built along +X (blade forward), handle centered at the origin, then turned to point down -Z
function buildKnife(type, fid, team) {
  const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner);
  const steel = new THREE.MeshStandardMaterial({ color: 0xd2d7dc, metalness: 1, roughness: 0.22, envMapIntensity: 1.3 });
  const darkSteel = new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.9, roughness: 0.35 });
  const grip = new THREE.MeshStandardMaterial({ color: team === 'CT' ? 0x2c3442 : 0x2e2a24, roughness: 0.85 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a3d1e, roughness: 0.6 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc89a46, metalness: 1, roughness: 0.3 });
  if (typeof detailTex === 'function' && detailTex('brown_planks_05', 'nor', 3)) { wood.normalMap = detailTex('brown_planks_05', 'nor', 3); grip.normalMap = detailTex('asphalt_02', 'nor', 6); grip.normalScale.set(0.7, 0.7); }
  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, noFinish) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; if (noFinish) m.userData.noFinish = true; inner.add(m); return m; };
  const box = (w, h, d) => roundedBox(w, h, d);
  let bladeStart = 0.055, tipX = 0.2;
  if (type === 'combat') {
    add(bladeGeo(shapeFrom([[0, 0.012], [0.12, 0.012], [0.155, 0.007], [0.178, -0.001], [0.15, -0.012], [0.11, -0.017], [0, -0.016]]), 0.004), steel, bladeStart);
    add(box(0.012, 0.05, 0.026), darkSteel, bladeStart - 0.004, -0.002, 0, 0, 0, 0, true);
    add(box(0.11, 0.026, 0.022), grip, 0, -0.002, 0, 0, 0, 0, true);
    for (let i = 0; i < 5; i++) add(new THREE.TorusGeometry(0.0125, 0.0018, 6, 14), grip, -0.04 + i * 0.019, -0.002, 0, 0, Math.PI / 2, 0, true);
    add(box(0.014, 0.024, 0.024), darkSteel, -0.06, -0.002, 0, 0, 0, 0, true);
    tipX = bladeStart + 0.178;
  } else if (type === 'bayonet') {
    add(bladeGeo(shapeFrom([[0, 0.012], [0.17, 0.012], [0.2, 0.004], [0.212, -0.002], [0.185, -0.013], [0, -0.014]]), 0.0045), steel, bladeStart);
    add(box(0.15, 0.003, 0.0015), darkSteel, bladeStart + 0.085, 0.004, 0.0028, 0, 0, 0, true); // fuller
    add(box(0.012, 0.03, 0.03), darkSteel, bladeStart - 0.005, -0.001, 0, 0, 0, 0, true);
    add(new THREE.TorusGeometry(0.011, 0.0035, 8, 16), darkSteel, bladeStart - 0.005, 0.022, 0, 0, Math.PI / 2, 0, true); // muzzle ring
    add(box(0.105, 0.027, 0.024), grip, 0, -0.002, 0, 0, 0, 0, true);
    add(box(0.02, 0.028, 0.026), darkSteel, -0.06, -0.002, 0, 0, 0, 0, true);
    tipX = bladeStart + 0.212;
  } else if (type === 'bowie') {
    add(bladeGeo(shapeFrom([[0, 0.016], [0.15, 0.016], [0.17, 0.012, 0.19, 0.004], [0.215, -0.004], [0.2, -0.018, 0.15, -0.025], [0.02, -0.025], [0, -0.02]]), 0.0055), steel, bladeStart);
    add(box(0.012, 0.07, 0.03), brass, bladeStart - 0.004, -0.004, 0, 0, 0, 0, true);
    add(box(0.115, 0.03, 0.026), wood, -0.002, -0.004, 0, 0, 0, 0, true);
    add(box(0.018, 0.034, 0.03), brass, -0.064, -0.004, 0, 0, 0, 0, true);
    tipX = bladeStart + 0.215;
  } else if (type === 'karambit') {
    bladeStart = 0.045;
    add(bladeGeo(shapeFrom([[0, 0.012], [0.06, 0.034, 0.104, -0.012], [0.11, -0.03], [0.096, -0.02], [0.062, 0.004, 0, -0.012]]), 0.0045), steel, bladeStart);
    add(box(0.09, 0.026, 0.022), grip, 0, 0, 0, 0, 0, 0.12, true);
    add(new THREE.TorusGeometry(0.019, 0.005, 10, 20), darkSteel, -0.062, -0.006, 0, 0, 0, 0, true); // finger ring
    tipX = bladeStart + 0.1;
  } else if (type === 'butterfly') {
    add(bladeGeo(shapeFrom([[0, 0.01], [0.115, 0.01], [0.13, 0.002], [0.124, -0.009], [0, -0.011]]), 0.0035), steel, bladeStart);
    for (const z of [-0.0075, 0.0075]) {
      add(box(0.12, 0.024, 0.006), darkSteel, -0.004, -0.001, z, 0, 0, 0, true);
      for (let i = 0; i < 4; i++) add(box(0.016, 0.009, 0.007), new THREE.MeshStandardMaterial({ color: 0x0a0a0a }), -0.045 + i * 0.028, -0.001, z, 0, 0, 0, true);
    }
    add(box(0.014, 0.004, 0.02), darkSteel, -0.066, 0.012, 0, 0, 0, 0, true); // latch
    tipX = bladeStart + 0.13;
  } else { // dagger
    add(bladeGeo(shapeFrom([[0, 0.013], [0.12, 0.011], [0.168, 0], [0.12, -0.011], [0, -0.013]]), 0.0055), steel, bladeStart);
    add(box(0.012, 0.06, 0.026), darkSteel, bladeStart - 0.004, 0, 0, 0, 0, 0, true);
    add(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 12), grip, -0.002, 0, 0, 0, 0, Math.PI / 2, true);
    for (let i = 0; i < 7; i++) add(new THREE.TorusGeometry(0.0125, 0.0016, 5, 14), grip, -0.046 + i * 0.015, 0, 0, 0, Math.PI / 2, 0.3, true);
    add(new THREE.SphereGeometry(0.014, 12, 8), darkSteel, -0.058, 0, 0, 0, 0, 0, true);
    tipX = bladeStart + 0.168;
  }
  applyFinish(inner, fid, 0.2);
  inner.rotation.y = Math.PI / 2; // +X -> -Z
  return { group: g, muzzle: new THREE.Vector3(0, 0, -tipX), fore: new THREE.Vector3(0, -0.03, 0.02), mag: null, knife: type };
}

// ---------------------------------------------------------- catalog
const SKINNABLE = ['glock', 'usp', 'p250', 'deagle', 'fiveseven', 'tec9', 'mac10', 'mp9', 'ump45', 'p90', 'nova', 'xm1014', 'galil', 'famas', 'ak47', 'm4a4', 'm4a1s', 'sg553', 'aug', 'ssg08', 'awp'];
const itemName = (id) => {
  const [kind, a, f] = id.split(':');
  return kind === 'k' ? `${KNIFE_TYPES[a].name} | ${FINISHES[f].name}` : `${WEAPONS[a].name} | ${FINISHES[f].name}`;
};
const itemRarity = (id) => {
  const [kind, , f] = id.split(':');
  const r = RAR[FINISHES[f].rarity];
  return kind === 'k' ? RARITY[Math.max(r.tier, 4)] : r; // knives are always Legendary or better
};
// random item, weighted by rarity (knives are rare)
function rollDrop() {
  const tot = RARITY.reduce((s, r) => s + r.weight, 0);
  let x = Math.random() * tot, rar = RARITY[0];
  for (const r of RARITY) { if ((x -= r.weight) <= 0) { rar = r; break; } }
  if (rar.tier >= 4 && Math.random() < 0.6) {
    const k = pick(Object.keys(KNIFE_TYPES).filter((t) => t !== 'combat'));
    const f = pick(Object.keys(FINISHES).filter((f) => f !== 'factory'));
    return `k:${k}:${f}`;
  }
  const pool = Object.keys(FINISHES).filter((f) => FINISHES[f].rarity === rar.id && f !== 'factory');
  const f = pool.length ? pick(pool) : 'sandstorm';
  return `w:${pick(SKINNABLE)}:${f}`;
}
