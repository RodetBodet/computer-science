'use strict';
/* =====================================================================
   WORLD: turns the map description into
     - merged Three.js meshes (one draw call per material),
     - axis-aligned collision boxes with a spatial hash,
     - ray casts (with bullet penetration) and a navigation grid for bots.
   ===================================================================== */
const WORLD = { boxes: [], hash: null, group: null, nav: null };
const HASH_CELL = 4, HASH_W = Math.ceil((MAP_W + 8) / HASH_CELL), HASH_D = Math.ceil((MAP_D + 8) / HASH_CELL), HASH_OFF = 4;

function addBox(mat, x0, y0, z0, x1, y1, z1, opts) {
  const b = Object.assign({ mat, x0, y0, z0, x1, y1, z1, pen: 0, invisible: false, visualOnly: false, roof: false, localUV: false, surface: 'concrete' }, opts || {});
  WORLD.boxes.push(b);
  return b;
}

// ---------------------------------------------------------- geometry
class GeoBuilder {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; }
  quad(v, nrm, uvs, cols) {
    const base = this.p.length / 3;
    for (let k = 0; k < 4; k++) {
      this.p.push(v[k][0], v[k][1], v[k][2]); this.n.push(nrm[0], nrm[1], nrm[2]);
      this.uv.push(uvs[k][0], uvs[k][1]); const c = cols ? cols[k] : 1; this.c.push(c, c, c);
    }
    this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}
// darker near the floor: a cheap fake ambient occlusion
const aoY = (y) => 0.58 + 0.42 * smoothstep(0, 1.4, y);
function boxFaces(gb, b, s) {
  const { x0, y0, z0, x1, y1, z1 } = b;
  const L = b.localUV;
  const U = (v, o) => (L ? v - o : v) * s;
  const ao = b.noAO ? () => 1 : aoY;
  const c4 = (ya, yb) => [ao(ya), ao(ya), ao(yb), ao(yb)];
  // +X
  gb.quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], [[-U(z1, z1), U(y0, y0)], [-U(z0, z1), U(y0, y0)], [-U(z0, z1), U(y1, y0)], [-U(z1, z1), U(y1, y0)]], c4(y0, y1));
  // -X
  gb.quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], [[U(z0, z0), U(y0, y0)], [U(z1, z0), U(y0, y0)], [U(z1, z0), U(y1, y0)], [U(z0, z0), U(y1, y0)]], c4(y0, y1));
  // +Z
  gb.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], [[U(x0, x0), U(y0, y0)], [U(x1, x0), U(y0, y0)], [U(x1, x0), U(y1, y0)], [U(x0, x0), U(y1, y0)]], c4(y0, y1));
  // -Z
  gb.quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], [[-U(x1, x1), U(y0, y0)], [-U(x0, x1), U(y0, y0)], [-U(x0, x1), U(y1, y0)], [-U(x1, x1), U(y1, y0)]], c4(y0, y1));
  // +Y
  if (!b.noTop) gb.quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], [[U(x0, x0), -U(z1, z0)], [U(x1, x0), -U(z1, z0)], [U(x1, x0), -U(z0, z0)], [U(x0, x0), -U(z0, z0)]], null);
  // -Y
  if (y0 > 0.01) gb.quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], [[U(x0, x0), U(z0, z0)], [U(x1, x0), U(z0, z0)], [U(x1, x0), U(z1, z0)], [U(x0, x0), U(z1, z0)]], [0.8, 0.8, 0.8, 0.8]);
}

// ---------------------------------------------------------- build
const FLOOR_BASE = { '.': 'concreteFloor', ',': 'asphalt', a: 'concreteFloor', b: 'warehouseFloor', w: 'concreteFloor', T: 'asphalt', K: 'pavers', r: 'concreteFloor', p: 'pavers' };
const floorMat = (c) => (MAP_INFO.theme.floors && MAP_INFO.theme.floors[c]) || FLOOR_BASE[c] || 'concreteFloor';
const isOpen = (ch) => ch !== '#' && ch !== '~';
function wallMaterial(cx, cz) {
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const c = cellAt(cx + dx, cz + dz); if (c === 'b') return MAP_INFO.theme.interior || 'corrugated'; }
  const h = hash2(cx >> 2, cz >> 2) % 4;
  return MAP_INFO.theme.walls[h];
}
function wallHeight(cx, cz) {
  return 7 + (hash2((cx + 1) >> 2, (cz + 3) >> 2) % 3) * 1.5;
}

function buildWorld(scene) {
  if (WORLD.group) { // switching maps: drop the old one
    scene.remove(WORLD.group);
    WORLD.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    WORLD.group = null; WORLD.water = null; WORLD.fireBlocked = null;
  }
  WORLD.boxes.length = 0;
  // ground (collision only; its visible surface is built per cell below)
  addBox('concreteFloor', -4, -1, -4, MAP_W + 4, 0, MAP_D + 4, { invisible: true });

  // --- buildings: greedy-merge wall cells with the same height + material ---
  const used = Array.from({ length: GH }, () => Array(GW).fill(false));
  const key = (cx, cz) => wallMaterial(cx, cz) + '|' + wallHeight(cx, cz);
  for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) {
    if (used[cz][cx] || cellAt(cx, cz) !== '#') continue;
    const k = key(cx, cz);
    let w = 1; while (cx + w < GW && !used[cz][cx + w] && cellAt(cx + w, cz) === '#' && key(cx + w, cz) === k) w++;
    let d = 1;
    outer: while (cz + d < GH) { for (let i = 0; i < w; i++) if (used[cz + d][cx + i] || cellAt(cx + i, cz + d) !== '#' || key(cx + i, cz + d) !== k) break outer; d++; }
    for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) used[cz + j][cx + i] = true;
    const [mat, hh] = k.split('|');
    addBox(mat, cx * CELL, 0, cz * CELL, (cx + w) * CELL, +hh, (cz + d) * CELL, { surface: mat === 'corrugated' ? 'metal' : 'concrete' });
  }
  // --- raised dock + gantry (merge runs per row) ---
  for (const ch of ['h', 'g']) {
    for (let cz = 0; cz < GH; cz++) {
      let cx = 0;
      while (cx < GW) {
        if (cellAt(cx, cz) !== ch) { cx++; continue; }
        let w = 1; while (cellAt(cx + w, cz) === ch) w++;
        if (ch === 'h') addBox('concrete', cx * CELL, 0, cz * CELL, (cx + w) * CELL, RAISED_H, cz * CELL + CELL, { surface: 'concrete' });
        else addBox('metal', cx * CELL, 0, cz * CELL, (cx + w) * CELL, RAISED_H, cz * CELL + CELL, { surface: 'metal' });
        cx += w;
      }
    }
  }
  // railings wherever a walkway or platform drops off to open ground
  const inStairs = (cx, cz) => STAIRS.some((s) => (cx + 0.5) * CELL > s.x0 && (cx + 0.5) * CELL < s.x1 && (cz + 0.5) * CELL > s.z0 && (cz + 0.5) * CELL < s.z1);
  for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) {
    const c = cellAt(cx, cz); if (c !== 'g' && c !== 'h') continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = cellAt(cx + dx, cz + dz);
      if (n === c || !isOpen(n) || n === 'h' || n === 'g' || inStairs(cx + dx, cz + dz)) continue;
      const x0 = cx * CELL, z0 = cz * CELL, t = 0.1;
      if (dx) { const x = dx > 0 ? x0 + CELL - t : x0; addBox('railing', x, RAISED_H, z0, x + t, RAISED_H + 1.0, z0 + CELL, { surface: 'metal', noAO: true }); }
      else { const z = dz > 0 ? z0 + CELL - t : z0; addBox('railing', x0, RAISED_H, z, x0 + CELL, RAISED_H + 1.0, z + t, { surface: 'metal', noAO: true }); }
    }
  }
  // --- roofs and the lintels above openings ---
  for (const ch of ['b', 'w']) {
    for (let cz = 0; cz < GH; cz++) {
      let cx = 0;
      while (cx < GW) {
        if (cellAt(cx, cz) !== ch) { cx++; continue; }
        let w = 1; while (cellAt(cx + w, cz) === ch) w++;
        addBox('roof', cx * CELL, ROOF_H[ch], cz * CELL, (cx + w) * CELL, ROOF_H[ch] + 0.35, cz * CELL + CELL, { roof: true });
        cx += w;
      }
    }
  }
  const roofOf = (c) => ROOF_H[c] || 0;
  for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) {
    const c = cellAt(cx, cz);
    if (!ROOF_H[c]) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = cellAt(cx + dx, cz + dz);
      if (!isOpen(n) || roofOf(n) === roofOf(c) || (roofOf(n) > roofOf(c) && ROOF_H[n])) continue;
      const lo = roofOf(c), hi = ROOF_H[n] ? roofOf(n) + 0.35 : Math.max(lo + 1.5, 7);
      const t = 0.15;
      if (dx) { const x = (dx > 0 ? cx + 1 : cx) * CELL; addBox(c === 'b' ? 'corrugated' : 'concrete', x - t, lo, cz * CELL, x + t, hi, cz * CELL + CELL, { noAO: true }); }
      else { const z = (dz > 0 ? cz + 1 : cz) * CELL; addBox(c === 'b' ? 'corrugated' : 'concrete', cx * CELL, lo, z - t, cx * CELL + CELL, hi, z + t, { noAO: true }); }
    }
  }
  // --- harbor railing: visual rail + invisible blocker ---
  let rz0 = -1;
  for (let cz = 0; cz <= GH; cz++) {
    const on = cellAt(37, cz) === 'r';
    if (on && rz0 < 0) rz0 = cz;
    if (!on && rz0 >= 0) {
      const z0 = rz0 * CELL, z1 = cz * CELL;
      addBox('railing', 74.5, 1.0, z0, 74.62, 1.08, z1, { visualOnly: true, noAO: true });
      addBox('railing', 74.5, 0.5, z0, 74.62, 0.56, z1, { visualOnly: true, noAO: true });
      for (let z = z0 + 0.1; z < z1; z += 2) addBox('railing', 74.5, 0, z, 74.62, 1.08, z + 0.1, { visualOnly: true, noAO: true });
      addBox('concrete', 74.4, 0, z0, 74.7, 4, z1, { invisible: true, surface: 'metal' });
      rz0 = -1;
    }
  }
  if (MAP_INFO.theme.harbor) addBox('concrete', 75.6, -3, 0, 76, 0, MAP_D, { visualOnly: true }); // quay wall face
  // --- stairs ---
  for (const s of STAIRS) {
    const n = Math.ceil((s.h1 - s.h0) / 0.4), alongX = s.up[1] === 'x', len = alongX ? s.x1 - s.x0 : s.z1 - s.z0;
    for (let i = 0; i < n; i++) {
      const top = s.h0 + ((i + 1) * (s.h1 - s.h0)) / n;
      const a = (i * len) / n, bb = ((i + 1) * len) / n;
      let x0 = s.x0, x1 = s.x1, z0 = s.z0, z1 = s.z1;
      if (s.up === '+x') { x0 = s.x0 + a; x1 = s.x0 + bb; } else if (s.up === '-x') { x1 = s.x1 - a; x0 = s.x1 - bb; }
      else if (s.up === '+z') { z0 = s.z0 + a; z1 = s.z0 + bb; } else { z1 = s.z1 - a; z0 = s.z1 - bb; }
      addBox(s.mat, x0, 0, z0, x1, top, z1, { surface: s.mat === 'metal' ? 'metal' : 'concrete', stair: true });
    }
  }
  // --- props ---
  for (const p of PROPS) {
    const surf = p.mat.startsWith('container') || p.mat === 'metal' || p.mat === 'vehicle' || p.mat === 'dumpster' ? 'metal' : p.mat === 'crate' || p.mat === 'pallet' ? 'wood' : 'concrete';
    addBox(p.mat, p.min[0], p.min[1], p.min[2], p.max[0], p.max[1], p.max[2], { pen: p.pen || 0, localUV: !p.pillar, surface: surf, prop: true });
  }

  // ---------- meshes ----------
  const group = new THREE.Group();
  const builders = {};
  const gbFor = (m) => (builders[m] = builders[m] || new GeoBuilder());
  for (const b of WORLD.boxes) { if (b.invisible) continue; boxFaces(gbFor(b.mat), b, 1 / (TEXDEF[b.mat] || 2)); }
  // floor quads per cell with soft darkening next to walls
  const solid = (cx, cz) => !isOpen(cellAt(cx, cz));
  const vAO = (vx, vz) => { let n = 0; for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) if (solid(vx + dx, vz + dz)) n++; return n ? 0.7 : 1; };
  for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) {
    const c = cellAt(cx, cz);
    if (!isOpen(c) || c === 'h' || c === 'g') continue;
    const m = floorMat(c), s = 1 / TEXDEF[m];
    const x0 = cx * CELL, x1 = x0 + CELL, z0 = cz * CELL, z1 = z0 + CELL;
    gbFor(m).quad([[x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0]], [0, 1, 0], [[x0 * s, -z1 * s], [x1 * s, -z1 * s], [x1 * s, -z0 * s], [x0 * s, -z0 * s]],
      [vAO(cx, cz + 1), vAO(cx + 1, cz + 1), vAO(cx + 1, cz), vAO(cx, cz)]);
  }
  for (const m in builders) {
    const mesh = new THREE.Mesh(builders[m].build(), MATERIALS[m]);
    mesh.castShadow = !['concreteFloor', 'asphalt', 'warehouseFloor', 'pavers'].includes(m);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  // metal grating on top of every walkway run
  for (let cz = 0; cz < GH; cz++) {
    let cx = 0;
    while (cx < GW) {
      if (cellAt(cx, cz) !== 'g') { cx++; continue; }
      let w = 1; while (cellAt(cx + w, cz) === 'g') w++;
      const grate = new THREE.Mesh(new THREE.PlaneGeometry(w * CELL, CELL), MATERIALS.grate.clone());
      if (grate.material.map) { grate.material.map = grate.material.map.clone(); grate.material.map.repeat.set(w * CELL / TEXDEF.grate, CELL / TEXDEF.grate); grate.material.map.needsUpdate = true; }
      grate.material.vertexColors = false;
      grate.rotation.x = -Math.PI / 2; grate.position.set((cx + w / 2) * CELL, RAISED_H + 0.004, (cz + 0.5) * CELL); grate.receiveShadow = true;
      group.add(grate);
      cx += w;
    }
  }
  // site letters
  for (const [letter, x, y, z, ry, size] of MAP_INFO.decals) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: letterTexture(letter), transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.position.set(x, y, z); m.rotation.y = ry; m.receiveShadow = true; group.add(m);
  }
  for (const [letter, x, z, size] of MAP_INFO.floorDecals) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: letterTexture(letter), transparent: true, opacity: 0.55, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.01, z); m.receiveShadow = true; group.add(m);
  }
  // interior lamps (always four per map, so the shader light count never changes)
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2dc, emissiveIntensity: 6 });
  for (const [x, y, z, power] of MAP_INFO.lamps) {
    const fix = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.25), lampMat); fix.position.set(x, y + 0.1, z); group.add(fix);
    if (G.quality > 0) { const l = new THREE.PointLight(0xfff0d8, power, 18, 2); l.position.set(x, y - 0.2, z); group.add(l); }
  }
  buildScenery(group);
  decorate(group);
  buildGroundDetail(group);
  buildDustAndBeams(group);
  scene.add(group);
  WORLD.group = group;
  buildHash();
  buildNav();
}

// everything outside the playable area: harbor or a distant skyline
function buildScenery(group) {
  const th = MAP_INFO.theme, rng = mulberry32(hash2(MAP_INFO.id.length, 77));
  if (th.harbor) {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ color: 0x1d3a44, roughness: 0.06, metalness: 0.0, normalMap: waterNormals(), normalScale: new THREE.Vector2(0.6, 0.6) }));
    water.material.normalMap.repeat.set(140, 140);
    water.rotation.x = -Math.PI / 2; water.position.set(76 + 450, -1.1, 32); group.add(water);
    WORLD.water = water;
    const craneMat = new THREE.MeshStandardMaterial({ color: 0xb8462e, roughness: 0.7 });
    for (const [x, z] of [[150, -10], [170, 40], [210, 90]]) {
      const crane = new THREE.Group();
      for (const [lx, lz] of [[0, 0], [10, 0], [0, 10], [10, 10]]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 40, 1.2), craneMat); leg.position.set(lx, 20, lz); crane.add(leg); }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 70), craneMat); beam.position.set(5, 40, -10); crane.add(beam);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 8), craneMat); cab.position.set(5, 36, 2); crane.add(cab);
      crane.position.set(x, 0, z); group.add(crane);
    }
    const ship = new THREE.Mesh(new THREE.BoxGeometry(30, 10, 160), new THREE.MeshStandardMaterial({ color: 0x2b3440, roughness: 0.8 })); ship.position.set(125, 3, 30); group.add(ship);
    for (let i = 0; i < 14; i++) { const c = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 2.44), new THREE.MeshStandardMaterial({ color: pick([0x963028, 0x284e82, 0x346840, 0xc46222]), roughness: 0.7 })); c.position.set(118 + (i % 3) * 7, 9.3 + Math.floor(i / 9) * 2.6, -30 + (i % 9) * 15); group.add(c); }
  } else {
    // ground beyond the map edges
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), MATERIALS.asphalt.clone());
    if (ground.material.map) { ground.material.map = ground.material.map.clone(); ground.material.map.repeat.set(300, 300); ground.material.map.needsUpdate = true; }
    ground.material.vertexColors = false; ground.rotation.x = -Math.PI / 2; ground.position.set(MAP_W / 2, -0.05, MAP_D / 2); ground.receiveShadow = true;
    group.add(ground);
  }
  // a ring of distant buildings so the skyline isn't empty
  // plain boxes have no vertex-color attribute, so use copies without vertex colors
  const bmats = th.walls.map((k) => { const m = MATERIALS[k].clone(); m.vertexColors = false; m.color.multiplyScalar(0.8); return m; });
  const ring = (x0, z0, x1, z1) => {
    for (let i = 0; i < 14; i++) {
      const w = 8 + rng() * 14, d = 8 + rng() * 14, h = 9 + rng() * 22;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bmats[Math.floor(rng() * bmats.length)]);
      m.position.set(lerp(x0, x1, rng()), h / 2, lerp(z0, z1, rng())); group.add(m);
    }
  };
  ring(-60, -40, -12, MAP_D + 40); ring(-20, -60, MAP_W + 20, -14); ring(-20, MAP_D + 14, MAP_W + 20, MAP_D + 60);
  if (!th.harbor) ring(MAP_W + 12, -40, MAP_W + 60, MAP_D + 40);
  if (th.depot) {
    // rail depot skyline: a water tower and a few signal masts
    const steel = new THREE.MeshStandardMaterial({ color: 0x5d5a55, roughness: 0.7, metalness: 0.5 });
    const tank = new THREE.MeshStandardMaterial({ color: 0x8a6a4c, roughness: 0.8, metalness: 0.2 });
    const tower = new THREE.Group();
    for (const [lx, lz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 16, 6), steel); leg.position.set(lx, 8, lz); tower.add(leg); }
    const t = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 7, 20), tank); t.position.y = 19.5; tower.add(t);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(5.4, 2.4, 20), steel); cap.position.y = 24.2; tower.add(cap);
    tower.position.set(MAP_W + 26, 0, MAP_D * 0.72); group.add(tower);
    for (const [x, z] of [[-18, 8], [-22, 50], [MAP_W + 16, 10], [40, -20]]) {
      const mast = new THREE.Mesh(new THREE.BoxGeometry(0.3, 9, 0.3), steel); mast.position.set(x, 4.5, z); group.add(mast);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 0.5), steel); head.position.set(x, 8.6, z); group.add(head);
    }
  }
  if (th.stacks) {
    const sm = new THREE.MeshStandardMaterial({ color: 0x7a6a5e, roughness: 0.85 });
    for (const [x, z, h] of [[-30, 20, 55], [-24, 34, 48], [100, -30, 60]]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.4, h, 16), sm); c.position.set(x, h / 2, z); group.add(c); }
  }
}
// tiling normal map of small waves (scrolled every frame)
function waterNormals() {
  const N = 256, c = makeCanvas(N, N), g = c.getContext('2d'), img = g.createImageData(N, N), h = new Float32Array(N * N);
  const rng = mulberry32(5), waves = Array.from({ length: 24 }, () => [Math.floor(rng() * 6) + 1, Math.floor(rng() * 6) + 1, rng() * TAU, 0.3 + rng()]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let v = 0; for (const [kx, ky, ph, a] of waves) v += Math.sin(((x * kx + y * ky) / N) * TAU + ph) * a / (kx + ky); h[y * N + x] = v; }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = h[y * N + ((x + 1) % N)] - h[y * N + ((x + N - 1) % N)], dy = h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x];
    const nx = -dx * 2, ny = -dy * 2, nz = 1, l = Math.hypot(nx, ny, nz), i = (y * N + x) * 4;
    img.data[i] = (nx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[i + 2] = (nz / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
// facade details: windows, drain pipes, AC units and electrical boxes on outward-facing walls
function decorate(group) {
  const items = { glass: [], frame: [], sill: [], pipe: [], ac: [], box: [] };
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
  const put = (list, x, y, z, sx, sy, sz, ry) => { Q.setFromAxisAngle(_yAxis, ry); P.set(x, y, z); S.set(sx, sy, sz); list.push(M.clone().compose(P, Q, S)); };
  for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) {
    if (cellAt(cx, cz) !== '#') continue;
    const top = wallHeight(cx, cz);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = cellAt(cx + dx, cz + dz);
      if (!isOpen(n) || ROOF_H[n]) continue;
      const r = hash2(cx * 7 + dx * 3 + 11, cz * 13 + dz * 5 + 3) % 100;
      // face center, outward normal, rotation so local +z points out
      const fx = (cx + 0.5 + dx * 0.5) * CELL, fz = (cz + 0.5 + dz * 0.5) * CELL, ry = Math.atan2(dx, dz);
      const tx = -dz, tz = dx; // along the wall
      if (r < 45 && top >= 7) {
        for (const wy of top > 8 ? [3.9, 6.6] : [4.1]) {
          put(items.glass, fx + dx * 0.02, wy, fz + dz * 0.02, 1.1, 1.3, 0.04, ry);
          put(items.frame, fx + dx * 0.04, wy + 0.7, fz + dz * 0.04, 1.3, 0.1, 0.1, ry);
          put(items.frame, fx + dx * 0.04, wy - 0.7, fz + dz * 0.04, 1.3, 0.1, 0.1, ry);
          put(items.frame, fx + dx * 0.04 + tx * 0.6, wy, fz + dz * 0.04 + tz * 0.6, 0.1, 1.5, 0.1, ry);
          put(items.frame, fx + dx * 0.04 - tx * 0.6, wy, fz + dz * 0.04 - tz * 0.6, 0.1, 1.5, 0.1, ry);
          put(items.frame, fx + dx * 0.04, wy, fz + dz * 0.04, 0.05, 1.3, 0.06, ry);
          put(items.sill, fx + dx * 0.1, wy - 0.78, fz + dz * 0.1, 1.4, 0.06, 0.22, ry);
        }
      } else if (r < 55) put(items.pipe, fx + dx * 0.12 + tx * 0.7, top / 2, fz + dz * 0.12 + tz * 0.7, 0.1, top, 0.1, ry);
      else if (r < 63) put(items.ac, fx + dx * 0.28, 2.6 + (r % 3) * 0.3, fz + dz * 0.28, 0.9, 0.62, 0.55, ry);
      else if (r < 70) put(items.box, fx + dx * 0.08 + tx * 0.3, 1.5, fz + dz * 0.08 + tz * 0.3, 0.5, 0.65, 0.16, ry);
    }
  }
  const mats = {
    glass: new THREE.MeshStandardMaterial({ color: 0x1b2328, roughness: 0.05, metalness: 0.9 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x3b3f42, roughness: 0.6, metalness: 0.4 }),
    sill: new THREE.MeshStandardMaterial({ color: 0x8c877d, roughness: 0.9 }),
    pipe: new THREE.MeshStandardMaterial({ color: 0x6d6f70, roughness: 0.45, metalness: 0.8 }),
    ac: new THREE.MeshStandardMaterial({ color: 0xc8c6bf, roughness: 0.55, metalness: 0.3 }),
    box: new THREE.MeshStandardMaterial({ color: 0x8a8f86, roughness: 0.6, metalness: 0.5 }),
  };
  for (const k in items) {
    if (!items[k].length) continue;
    const geo = k === 'pipe' ? new THREE.CylinderGeometry(0.5, 0.5, 1, 8) : new THREE.BoxGeometry(1, 1, 1);
    const im = new THREE.InstancedMesh(geo, mats[k], items[k].length);
    items[k].forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = k !== 'glass'; im.receiveShadow = true;
    group.add(im);
  }
}
const _yAxis = new THREE.Vector3(0, 1, 0);

/* ---------------------------------------------------------- visual-only detail
   Ground clutter, puddles, dust motes and sunbeams. None of these go through
   addBox(), so they never collide, block bullets or affect the nav grid.
   Everything is instanced (one draw call per kind) and capped per map. */
const GDETAIL = { tex: null, mats: null, motes: null };
function detailTextures() {
  if (GDETAIL.tex) return GDETAIL.tex;
  const blob = (seed, n, hard) => { // irregular soft blob with alpha
    const S = 128, c = makeCanvas(S, S), g = c.getContext('2d'), rng = mulberry32(seed);
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, r = rng() * 26, x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r, rr = 14 + rng() * 22;
      const gr = g.createRadialGradient(x, y, 0, x, y, rr);
      gr.addColorStop(0, `rgba(255,255,255,${hard})`); gr.addColorStop(0.7, `rgba(255,255,255,${hard * 0.6})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, S, S);
    }
    const img = g.getImageData(0, 0, S, S), d = img.data; // sharpen the edge a little so it reads as liquid
    for (let i = 3; i < d.length; i += 4) d[i] = 255 * smoothstep(0.25, 0.6, d[i] / 255);
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  const paper = (() => {
    const c = makeCanvas(64, 64), g = c.getContext('2d');
    g.fillStyle = '#e9e4d6'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(60,60,70,0.45)'; for (let y = 10; y < 58; y += 6) g.fillRect(8, y, 30 + ((y * 7) % 18), 2);
    g.fillStyle = 'rgba(120,100,70,0.25)'; g.fillRect(0, 44, 64, 20);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const soft = (() => {
    const c = makeCanvas(64, 64), g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  GDETAIL.tex = { puddle: blob(17, 7, 1), damp: blob(41, 9, 0.8), pool: blob(73, 6, 1), paper, soft };
  return GDETAIL.tex;
}
function detailMaterials() {
  if (GDETAIL.mats) return GDETAIL.mats;
  const T = detailTextures();
  const decal = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
  GDETAIL.mats = {
    puddle: new THREE.MeshStandardMaterial(Object.assign({ map: T.puddle, color: 0x2a3236, roughness: 0.04, metalness: 0.0, envMapIntensity: 1.6 }, decal)),
    oil: new THREE.MeshStandardMaterial(Object.assign({ map: T.puddle, color: 0x141210, roughness: 0.18, metalness: 0.2, envMapIntensity: 1.0 }, decal)),
    damp: new THREE.MeshStandardMaterial(Object.assign({ map: T.damp, color: 0x000000, roughness: 0.5, opacity: 0.32 }, decal)),
    paper: new THREE.MeshStandardMaterial({ map: T.paper, color: 0xb9b2a2, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }),
    debris: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }),
    cable: new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.55, metalness: 0.1 }),
    beam: new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(1.0, 0.92, 0.75) } },
      vertexShader: 'varying float vH; varying float vF; varying float vU; void main(){ vH = uv.y; vU = uv.x; vec4 wp = modelMatrix * vec4(position,1.0); vec3 n = normalize(mat3(modelMatrix) * normal); vF = abs(dot(n, normalize(cameraPosition - wp.xyz))); gl_Position = projectionMatrix * viewMatrix * wp; }',
      fragmentShader: 'uniform vec3 color; varying float vH; varying float vF; varying float vU; void main(){ float a = 0.06 * smoothstep(0.0, 0.3, vU) * smoothstep(1.0, 0.7, vU) * smoothstep(0.0, 0.35, vH) * (0.35 + 0.65 * vH) * pow(vF, 1.6); gl_FragColor = vec4(color * a, 1.0); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }),
    sunPool: new THREE.MeshBasicMaterial({ map: T.soft, color: 0x5a4e3a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2 }),
    skylight: new THREE.MeshBasicMaterial({ color: 0xfff4dc }),
  };
  return GDETAIL.mats;
}
function stairAt(x, z) { return STAIRS.some((s) => x > s.x0 - 0.2 && x < s.x1 + 0.2 && z > s.z0 - 0.2 && z < s.z1 + 0.2); }
function propAt(x, z, pad) { pad = pad || 0; return PROPS.some((p) => x > p.min[0] - pad && x < p.max[0] + pad && z > p.min[2] - pad && z < p.max[2] + pad && p.min[1] < 0.5); }
function buildGroundDetail(group) {
  const M = detailMaterials(), th = MAP_INFO.theme, rng = mulberry32(hash2(MAP_INFO.id.length * 131, MAP_INFO.id.charCodeAt(0)));
  const CAP = { puddle: 36, damp: 36, paper: 140, debris: 240, cable: 46 }, L = {}, debrisCol = [];
  for (const k in CAP) { L[k] = []; L[k].cap = CAP[k]; }
  const Mx = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S = new THREE.Vector3(), P = new THREE.Vector3();
  const put = (list, x, y, z, rx, ry, rz, sx, sy, sz) => { if (list.length >= list.cap) return false; E.set(rx, ry, rz, 'YXZ'); Q.setFromEuler(E); P.set(x, y, z); S.set(sx, sy, sz); list.push(Mx.clone().compose(P, Q, S)); return true; };
  const wetness = th.wet === undefined ? 1 : th.wet;
  const cells = [];
  for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) { const c = cellAt(cx, cz); if (isOpen(c) && c !== 'g' && c !== 'r') cells.push([cx, cz, c]); }
  cells.sort((a, b) => hash2(a[0] * 3 + 1, a[1] * 7 + 2) % 997 - hash2(b[0] * 3 + 1, b[1] * 7 + 2) % 997); // scattered but deterministic order, so the caps don't all fill in one corner
  for (const [cx, cz, c] of cells) {
    const roofed = !!ROOF_H[c], y0 = c === 'h' ? RAISED_H : 0;
    const walls = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => !isOpen(cellAt(cx + dx, cz + dz)));
    const free = (x, z, pad) => !propAt(x, z, pad) && !stairAt(x, z) && cellAtM(x, z) === c;
    // puddles on open ground (wet patch + reflective core)
    if (!roofed && c !== 'h' && rng() < 0.085 * wetness) {
      const x = (cx + 0.2 + rng() * 0.6) * CELL, z = (cz + 0.2 + rng() * 0.6) * CELL, s = 0.9 + rng() * 1.5, ry = rng() * TAU, ar = 0.6 + rng() * 0.5;
      if (free(x, z, 0.3)) { put(L.damp, x, 0.011, z, -Math.PI / 2, 0, ry, s * 1.5, s * ar * 1.5, 1); put(L.puddle, x, 0.013, z, -Math.PI / 2, 0, ry, s, s * ar, 1); }
    }
    // paper scraps
    const nPaper = rng() < (roofed ? 0.35 : 0.22) ? 1 + (rng() < 0.3 ? 1 : 0) : 0;
    for (let i = 0; i < nPaper; i++) {
      const x = (cx + 0.1 + rng() * 0.8) * CELL, z = (cz + 0.1 + rng() * 0.8) * CELL;
      if (free(x, z, 0.05)) put(L.paper, x, y0 + 0.008 + rng() * 0.004, z, -Math.PI / 2 + rng() * 0.08, rng() * TAU, 0, 0.21 * (0.8 + rng() * 0.4), 0.29 * (0.8 + rng() * 0.4), 1);
    }
    // rubble / debris chunks, mostly against walls
    const nDeb = walls.length ? Math.floor(rng() * 4) : rng() < 0.15 ? 1 : 0;
    for (let i = 0; i < nDeb; i++) {
      let x = (cx + 0.15 + rng() * 0.7) * CELL, z = (cz + 0.15 + rng() * 0.7) * CELL;
      if (walls.length) { const [dx, dz] = walls[Math.floor(rng() * walls.length)]; if (dx) x = (cx + 0.5 + dx * (0.38 + rng() * 0.08)) * CELL; else z = (cz + 0.5 + dz * (0.38 + rng() * 0.08)) * CELL; }
      if (!free(x, z, 0.05)) continue;
      const s = 0.04 + rng() * rng() * 0.16;
      if (put(L.debris, x, y0 + s * 0.35, z, rng() * 0.6, rng() * TAU, rng() * 0.6, s * (1 + rng()), s * (0.5 + rng() * 0.5), s * (1 + rng()))) {
        const k = 0.35 + rng() * 0.35; debrisCol.push(rng() < 0.2 ? [k * 1.1, k * 0.75, k * 0.55] : [k, k * 0.97, k * 0.92]);
      }
    }
    // cables running along walls
    if (walls.length && rng() < (roofed ? 0.3 : 0.12)) {
      const [dx, dz] = walls[0], len = 1.2 + rng() * 2.4, off = 0.45 - rng() * 0.05;
      const x = (cx + 0.5 + dx * off) * CELL, z = (cz + 0.5 + dz * off) * CELL;
      if (free(x, z, 0.1)) put(L.cable, x, y0 + 0.018, z, Math.PI / 2, dx ? 0 : Math.PI / 2, 0.08 * (rng() - 0.5), 1, len, 1);
      if (rng() < 0.4 && free(x + dz * 0.15, z + dx * 0.15, 0.1)) put(L.cable, x + dz * 0.12 - dx * 0.08, y0 + 0.018, z + dx * 0.12 - dz * 0.08, Math.PI / 2, (dx ? 0 : Math.PI / 2) + 0.12, 0, 0.8, len * 0.8, 0.8);
    }
  }
  const geos = {
    puddle: new THREE.PlaneGeometry(1, 1), damp: new THREE.PlaneGeometry(1, 1), paper: new THREE.PlaneGeometry(1, 1),
    debris: new THREE.DodecahedronGeometry(0.5, 0), cable: new THREE.CylinderGeometry(0.018, 0.018, 1, 5, 1, true),
  };
  const mats = { puddle: th.oilStains ? M.oil : M.puddle, damp: M.damp, paper: M.paper, debris: M.debris, cable: M.cable };
  for (const k in L) {
    if (!L[k].length) { geos[k].dispose(); continue; }
    const im = new THREE.InstancedMesh(geos[k], mats[k], L[k].length);
    L[k].forEach((m, i) => im.setMatrixAt(i, m));
    if (k === 'debris') { const col = new THREE.Color(); debrisCol.forEach((cc, i) => im.setColorAt(i, col.setRGB(cc[0], cc[1], cc[2]))); }
    im.castShadow = k === 'debris'; im.receiveShadow = k !== 'damp';
    im.renderOrder = k === 'damp' ? 1 : k === 'puddle' ? 2 : 0;
    im.userData.visualOnly = true;
    group.add(im);
  }
}
// dust motes drifting indoors, extra-dense inside slanted sunbeams that fall through skylights
function buildDustAndBeams(group) {
  const M = detailMaterials(), rng = mulberry32(hash2(MAP_INFO.id.charCodeAt(1) * 17, 5));
  const sd = RENDER.sun ? RENDER.sun.position.clone().sub(RENDER.sun.target.position).normalize() : new THREE.Vector3(-0.45, 0.72, 0.52).normalize();
  const pos = [], seed = [], MOTE_CAP = 1800;
  const addMote = (x, y, z, bright) => { if (pos.length / 3 >= MOTE_CAP) return; pos.push(x, y, z); seed.push(rng() * 100, bright); };
  // ambient motes in every roofed cell
  for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) {
    const c = cellAt(cx, cz); if (!ROOF_H[c]) continue;
    const n = c === 'b' ? 4 : 2;
    for (let i = 0; i < n; i++) addMote((cx + rng()) * CELL, 0.3 + rng() * (ROOF_H[c] - 0.6), (cz + rng()) * CELL, 0.35);
  }
  // sunbeams: pick a few hall cells whose beam lands inside the same hall
  const beams = [], cand = [];
  for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) if (cellAt(cx, cz) === 'b') cand.push([cx, cz]);
  cand.sort((a, b) => hash2(a[0] + 5, a[1] + 9) % 1009 - hash2(b[0] + 5, b[1] + 9) % 1009);
  const H = ROOF_H.b, k = H / Math.max(0.35, sd.y);
  for (const [cx, cz] of cand) {
    if (beams.length >= 5) break;
    const tx = (cx + 0.5) * CELL, tz = (cz + 0.5) * CELL, fx = tx - sd.x * k, fz = tz - sd.z * k;
    if (cellAtM(fx, fz) !== 'b' || cellAtM((tx + fx) / 2, (tz + fz) / 2) !== 'b') continue;
    if (propAt(fx, fz, 0.6) || propAt((tx + fx) / 2, (tz + fz) / 2, 0.6) || propAt(tx, tz, 0.6)) continue; // keep beams clear of big props
    if (beams.some((b) => Math.hypot(b[0] - tx, b[1] - tz) < 7)) continue;
    beams.push([tx, tz, fx, fz]);
  }
  if (beams.length) {
    const W = 1.3, p = [], uv = [], nrm = [], idx = [];
    for (const [tx, tz, fx, fz] of beams) {
      // four slanted side faces of a square shaft (top = skylight, bottom = floor patch)
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (let s = 0; s < 4; s++) {
        const a = corners[s], b = corners[(s + 1) % 4], base = p.length / 3;
        const nx = (a[0] + b[0]) / 2, nz = (a[1] + b[1]) / 2;
        p.push(fx + a[0] * W / 2, 0.02, fz + a[1] * W / 2, fx + b[0] * W / 2, 0.02, fz + b[1] * W / 2, tx + b[0] * W / 2, H - 0.02, tz + b[1] * W / 2, tx + a[0] * W / 2, H - 0.02, tz + a[1] * W / 2);
        uv.push(0, 0, 1, 0, 1, 1, 0, 1);
        for (let q = 0; q < 4; q++) nrm.push(nx, 0, nz);
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      for (let i = 0; i < 70; i++) { const t = rng(); addMote(lerp(fx, tx, t) + (rng() - 0.5) * W, 0.15 + t * (H - 0.4), lerp(fz, tz, t) + (rng() - 0.5) * W, 1); }
      const sky = new THREE.Mesh(new THREE.PlaneGeometry(W, W), M.skylight); sky.rotation.x = Math.PI / 2; sky.position.set(tx, H - 0.005, tz); group.add(sky);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.9, W * 1.9), M.sunPool); pool.rotation.x = -Math.PI / 2; pool.position.set(fx, 0.02, fz); pool.renderOrder = 3; group.add(pool);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setIndex(idx);
    const shaft = new THREE.Mesh(g, M.beam); shaft.renderOrder = 7; shaft.frustumCulled = false; group.add(shaft);
  }
  // a thin layer of motes near outdoor walls in the sun too
  for (let i = 0; i < 260; i++) {
    const cx = Math.floor(rng() * GW), cz = Math.floor(rng() * GH), c = cellAt(cx, cz);
    if (!isOpen(c) || ROOF_H[c]) continue;
    addMote((cx + rng()) * CELL, 0.4 + rng() * 2.6, (cz + rng()) * CELL, 0.22);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 2));
  if (!GDETAIL.moteMat) {
    GDETAIL.moteMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, scale: { value: 600 }, map: { value: detailTextures().soft } },
      vertexShader: `
        attribute vec2 seed; uniform float time, scale; varying float vA;
        void main(){
          float s = seed.x, t = time * (0.18 + fract(s * 0.37) * 0.2);
          vec3 p = position + vec3(sin(t + s) * 0.35, sin(t * 0.7 + s * 2.3) * 0.25 + fract(time * 0.01 + s) * 0.3, cos(t * 0.9 + s * 1.7) * 0.35);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          vA = seed.y * (0.55 + 0.45 * sin(time * 1.3 + s * 5.0)) * smoothstep(28.0, 6.0, d) * smoothstep(0.3, 1.2, d);
          gl_PointSize = clamp(scale * (0.022 + fract(s * 1.9) * 0.018) / d, 1.0, 8.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; varying float vA;
        void main(){ float a = texture2D(map, gl_PointCoord).a * vA; if (a < 0.01) discard; gl_FragColor = vec4(vec3(1.0, 0.93, 0.8) * a * 0.9, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
  }
  const pts = new THREE.Points(g, GDETAIL.moteMat); pts.frustumCulled = false; pts.renderOrder = 8;
  group.add(pts);
  GDETAIL.motes = pts;
}
// called every frame from FX.update
function updateDust() {
  if (!GDETAIL.moteMat) return;
  GDETAIL.moteMat.uniforms.time.value = performance.now() / 1000;
  GDETAIL.moteMat.uniforms.scale.value = innerHeight * 0.9;
}

// ---------------------------------------------------------- spatial hash
function buildHash() {
  const cells = Array.from({ length: HASH_W * HASH_D }, () => []);
  WORLD.boxes.forEach((b, idx) => {
    b.id = idx;
    if (b.visualOnly) return;
    const cx0 = clamp(Math.floor((b.x0 + HASH_OFF) / HASH_CELL), 0, HASH_W - 1), cx1 = clamp(Math.floor((b.x1 + HASH_OFF) / HASH_CELL), 0, HASH_W - 1);
    const cz0 = clamp(Math.floor((b.z0 + HASH_OFF) / HASH_CELL), 0, HASH_D - 1), cz1 = clamp(Math.floor((b.z1 + HASH_OFF) / HASH_CELL), 0, HASH_D - 1);
    for (let z = cz0; z <= cz1; z++) for (let x = cx0; x <= cx1; x++) cells[z * HASH_W + x].push(b);
  });
  WORLD.hash = cells;
  WORLD.stamp = new Uint32Array(WORLD.boxes.length);
  WORLD.stampN = 1;
}
const _q = [];
// all collision boxes overlapping an AABB
function queryBoxes(x0, y0, z0, x1, y1, z1) {
  _q.length = 0;
  const st = WORLD.stamp, sn = ++WORLD.stampN;
  const cx0 = clamp(Math.floor((x0 + HASH_OFF) / HASH_CELL), 0, HASH_W - 1), cx1 = clamp(Math.floor((x1 + HASH_OFF) / HASH_CELL), 0, HASH_W - 1);
  const cz0 = clamp(Math.floor((z0 + HASH_OFF) / HASH_CELL), 0, HASH_D - 1), cz1 = clamp(Math.floor((z1 + HASH_OFF) / HASH_CELL), 0, HASH_D - 1);
  for (let z = cz0; z <= cz1; z++) for (let x = cx0; x <= cx1; x++) {
    for (const b of WORLD.hash[z * HASH_W + x]) {
      if (st[b.id] === sn) continue; st[b.id] = sn;
      if (b.x1 > x0 && b.x0 < x1 && b.y1 > y0 && b.y0 < y1 && b.z1 > z0 && b.z0 < z1) _q.push(b);
    }
  }
  return _q;
}
const pointSolid = (x, y, z) => queryBoxes(x - 0.001, y - 0.001, z - 0.001, x + 0.001, y + 0.001, z + 0.001).length > 0;

// slab test; returns [tIn, tOut, axisIn] or null
function rayBox(ox, oy, oz, idx, idy, idz, b, maxT) {
  let t0 = 0, t1 = maxT, ax = -1;
  let ta = (b.x0 - ox) * idx, tb = (b.x1 - ox) * idx; if (ta > tb) { const t = ta; ta = tb; tb = t; }
  if (ta > t0) { t0 = ta; ax = 0; } if (tb < t1) t1 = tb; if (t0 > t1) return null;
  ta = (b.y0 - oy) * idy; tb = (b.y1 - oy) * idy; if (ta > tb) { const t = ta; ta = tb; tb = t; }
  if (ta > t0) { t0 = ta; ax = 1; } if (tb < t1) t1 = tb; if (t0 > t1) return null;
  ta = (b.z0 - oz) * idz; tb = (b.z1 - oz) * idz; if (ta > tb) { const t = ta; ta = tb; tb = t; }
  if (ta > t0) { t0 = ta; ax = 2; } if (tb < t1) t1 = tb; if (t0 > t1) return null;
  return [t0, t1, ax];
}
// Walk the hash cells under the ray. collect=false: nearest hit only; collect=true: every box crossed.
function rayCast(ox, oy, oz, dx, dy, dz, maxT, collect) {
  const idx = 1 / (dx || 1e-9), idy = 1 / (dy || 1e-9), idz = 1 / (dz || 1e-9);
  const st = WORLD.stamp, sn = ++WORLD.stampN;
  let best = null, bestT = maxT;
  const hits = collect ? [] : null;
  let cx = Math.floor((ox + HASH_OFF) / HASH_CELL), cz = Math.floor((oz + HASH_OFF) / HASH_CELL);
  const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  // a ray with no x (or z) movement never crosses a cell boundary on that axis
  const tdx = dx ? Math.abs(HASH_CELL / dx) : Infinity, tdz = dz ? Math.abs(HASH_CELL / dz) : Infinity;
  let tmx = dx ? ((dx > 0 ? (cx + 1) * HASH_CELL : cx * HASH_CELL) - HASH_OFF - ox) / dx : Infinity;
  let tmz = dz ? ((dz > 0 ? (cz + 1) * HASH_CELL : cz * HASH_CELL) - HASH_OFF - oz) / dz : Infinity;
  let tCell = 0;
  for (let guard = 0; guard < 256; guard++) {
    if (cx >= 0 && cz >= 0 && cx < HASH_W && cz < HASH_D) {
      for (const b of WORLD.hash[cz * HASH_W + cx]) {
        if (st[b.id] === sn) continue; st[b.id] = sn;
        const r = rayBox(ox, oy, oz, idx, idy, idz, b, maxT);
        if (!r) continue;
        if (collect) hits.push({ b, tIn: r[0], tOut: r[1], ax: r[2] });
        else if (r[0] < bestT) { bestT = r[0]; best = { b, t: r[0], ax: r[2] }; }
      }
    } else if ((cx < 0 && stepX < 0) || (cz < 0 && stepZ < 0) || (cx >= HASH_W && stepX > 0) || (cz >= HASH_D && stepZ > 0)) break;
    if (!collect && best && bestT <= Math.min(tmx, tmz)) break; // nothing in later cells can be closer
    if (tmx === Infinity && tmz === Infinity) break; // vertical ray: only this cell
    if (tmx < tmz) { tCell = tmx; tmx += tdx; cx += stepX; } else { tCell = tmz; tmz += tdz; cz += stepZ; }
    if (tCell > (collect ? maxT : bestT)) break;
  }
  if (collect) { hits.sort((a, b) => a.tIn - b.tIn); return hits; }
  if (best) {
    const n = [0, 0, 0]; n[best.ax < 0 ? 1 : best.ax] = -Math.sign([dx, dy, dz][best.ax < 0 ? 1 : best.ax]) || 1; best.n = n;
  }
  return best;
}
// line of sight between two points (no smoke check)
function losClear(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
  if (L < 1e-4) return true;
  return !rayCast(ax, ay, az, dx / L, dy / L, dz / L, L - 0.02, false);
}
const isIndoors = (x, z) => !!ROOF_H[cellAtM(x, z)];

// ---------------------------------------------------------- navigation grid
const NAV_RES = 0.5, NAV_W = MAP_W / NAV_RES, NAV_D = MAP_D / NAV_RES;
function buildNav() {
  const N = NAV_W * NAV_D;
  const nav = { h: new Float32Array(N), walk: new Uint8Array(N), near: new Uint8Array(N) };
  for (let iz = 0; iz < NAV_D; iz++) for (let ix = 0; ix < NAV_W; ix++) {
    const i = iz * NAV_W + ix, x = (ix + 0.5) * NAV_RES, z = (iz + 0.5) * NAV_RES;
    const ch = cellAtM(x, z);
    if (ch === '~' || ch === '#') continue;
    let floor = 0;
    for (const b of queryBoxes(x - 0.01, -0.5, z - 0.01, x + 0.01, 3.0, z + 0.01)) if (!b.roof && b.y1 <= 2.7 && b.y1 > floor) floor = b.y1;
    nav.h[i] = floor;
    // clearance starts a step above the floor, so a stair edge next to the cell doesn't block it
    if (queryBoxes(x - 0.3, floor + 0.45, z - 0.3, x + 0.3, floor + 1.8, z + 0.3).length) continue;
    nav.walk[i] = 1;
    if (queryBoxes(x - 0.6, floor + 0.5, z - 0.6, x + 0.6, floor + 1.6, z + 0.6).length) nav.near[i] = 1;
  }
  WORLD.nav = nav;
  WORLD.g = new Float32Array(N); WORLD.came = new Int32Array(N); WORLD.closed = new Uint8Array(N);
}
const navIndex = (x, z) => { const ix = Math.floor(x / NAV_RES), iz = Math.floor(z / NAV_RES); return ix < 0 || iz < 0 || ix >= NAV_W || iz >= NAV_D ? -1 : iz * NAV_W + ix; };
const navCenter = (i) => ({ x: ((i % NAV_W) + 0.5) * NAV_RES, z: (Math.floor(i / NAV_W) + 0.5) * NAV_RES, y: WORLD.nav.h[i] });
function nearestWalkable(x, z, preferH) {
  const nav = WORLD.nav, i0 = navIndex(x, z);
  if (i0 >= 0 && nav.walk[i0] && !nav.near[i0] && (preferH === undefined || Math.abs(nav.h[i0] - preferH) < 0.6)) return i0;
  let best = -1, bd = 1e9;
  const ix0 = Math.floor(x / NAV_RES), iz0 = Math.floor(z / NAV_RES);
  for (let r = 1; r < 14 && best < 0; r++) {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const ix = ix0 + dx, iz = iz0 + dz;
      if (ix < 0 || iz < 0 || ix >= NAV_W || iz >= NAV_D) continue;
      const i = iz * NAV_W + ix;
      if (!nav.walk[i]) continue;
      const d = dx * dx + dz * dz + (nav.near[i] ? 4 : 0) + (preferH !== undefined ? Math.abs(nav.h[i] - preferH) * 20 : 0);
      if (d < bd) { bd = d; best = i; }
    }
  }
  return best;
}
const NAV_DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
function navStepOK(a, b) { // can a bot walk from cell a to b?
  const dh = WORLD.nav.h[b] - WORLD.nav.h[a];
  return dh <= 0.5 && dh >= -2.3;
}
function findPath(sx, sz, gx, gz, sy) {
  const nav = WORLD.nav;
  const s = nearestWalkable(sx, sz, sy), goal = nearestWalkable(gx, gz);
  if (s < 0 || goal < 0) return null;
  const G = WORLD.g, came = WORLD.came, closed = WORLD.closed;
  G.fill(1e9); came.fill(-1); closed.fill(0);
  const gix = goal % NAV_W, giz = Math.floor(goal / NAV_W);
  const hfn = (i) => { const dx = Math.abs((i % NAV_W) - gix), dz = Math.abs(Math.floor(i / NAV_W) - giz); return dx + dz - 0.586 * Math.min(dx, dz); };
  const heap = new Heap();
  G[s] = 0; heap.push(hfn(s), s);
  let found = false, iters = 0;
  while (heap.size && iters++ < 40000) {
    const cur = heap.pop();
    if (cur === goal) { found = true; break; }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % NAV_W, cz = Math.floor(cur / NAV_W);
    for (const [dx, dz, cost] of NAV_DIRS) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= NAV_W || nz >= NAV_D) continue;
      const ni = nz * NAV_W + nx;
      if (!nav.walk[ni] || closed[ni] || !navStepOK(cur, ni)) continue;
      if (dx && dz && (!nav.walk[cz * NAV_W + nx] || !nav.walk[nz * NAV_W + cx])) continue;
      const g = G[cur] + cost * (nav.near[ni] ? 2.2 : 1);
      if (g < G[ni]) { G[ni] = g; came[ni] = cur; heap.push(g + hfn(ni), ni); }
    }
  }
  if (!found) return null;
  const cells = [];
  for (let i = goal; i !== -1; i = came[i]) { cells.push(i); if (i === s) break; }
  cells.reverse();
  // string pulling: keep only the corners needed
  const out = [];
  let a = 0;
  while (a < cells.length - 1) {
    let b = Math.min(cells.length - 1, a + 40);
    while (b > a + 1 && !navWalkLine(cells[a], cells[b])) b--;
    out.push(navCenter(cells[b]));
    a = b;
  }
  if (!out.length) out.push(navCenter(goal));
  out[out.length - 1].x = clamp(gx, out[out.length - 1].x - 0.24, out[out.length - 1].x + 0.24);
  out[out.length - 1].z = clamp(gz, out[out.length - 1].z - 0.24, out[out.length - 1].z + 0.24);
  return out;
}
function navWalkLine(ia, ib) {
  const nav = WORLD.nav, a = navCenter(ia), b = navCenter(ib);
  const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(L / 0.2);
  let prev = ia;
  for (let k = 1; k <= n; k++) {
    const t = k / n, i = navIndex(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
    if (i < 0 || !nav.walk[i] || nav.near[i] && !nav.near[ia] || !navStepOK(prev, i) || Math.abs(nav.h[i] - nav.h[prev]) > 0.5) return false;
    prev = i;
  }
  return true;
}
function randomWalkableIn(zone, avoid) {
  const nav = WORLD.nav;
  for (let tries = 0; tries < 400; tries++) {
    const x = rand(zone.x0, zone.x1), z = rand(zone.z0, zone.z1), i = navIndex(x, z);
    if (zone.ex0 !== undefined && x > zone.ex0 && x < zone.ex1) continue; // excluded strip
    if (i < 0 || !nav.walk[i] || nav.near[i]) continue;
    const c = navCenter(i);
    if (avoid && avoid.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < 1.3)) continue;
    return c;
  }
  return navCenter(nearestWalkable((zone.x0 + zone.x1) / 2, (zone.z0 + zone.z1) / 2));
}
