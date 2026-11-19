#!/usr/bin/env node
'use strict';
/* =====================================================================
   Map validator: node tools/validate_map.js [mapId ...]   (default: all maps)
   Loads src/maps.js in a sandbox, paints each grid with the map's own def,
   rebuilds a 0.5 m walk grid the same way world.js does (walls, raised
   platforms, stairs, props) and checks:
     - every bot point (routes, plants, holds incl. mid, entries, site
       centers) is on an open cell, outside props, and reachable from
       BOTH spawns (BFS with the game's step-up / drop-down rules)
     - plants lie inside their site rectangle
     - no open cell of one spawn zone has grid line-of-sight to the other
     - exactly 4 lamps, 2+ routes per site, decals for A and B
   Exit code 1 on any failure.
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CELL = 2, GW = 40, GH = 32, RAISED_H = 2.0, ROOF_H = { b: 6.2, w: 3.4 };
const MAP_W = GW * CELL, MAP_D = GH * CELL, RES = 0.5, NW = MAP_W / RES, ND = MAP_D / RES;

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'maps.js'), 'utf8');
const ctx = { CELL, GW, GH, RAISED_H, ROOF_H, Math };
vm.createContext(ctx);
vm.runInContext(src + '\nthis.MAP_DEFS = MAP_DEFS; this.MAP_ORDER = MAP_ORDER;', ctx);

const isOpen = (c) => c !== '#' && c !== '~';

function validate(id) {
  const d = ctx.MAP_DEFS[id]();
  const errs = [], warns = [];
  const cell = (cx, cz) => (cx < 0 || cz < 0 || cx >= GW || cz >= GH ? '#' : d.grid[cz][cx]);
  const cellM = (x, z) => cell(Math.floor(x / CELL), Math.floor(z / CELL));

  // ---- collision boxes (same rules as world.js buildWorld)
  const boxes = [];
  for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) {
    const c = cell(cx, cz), x0 = cx * CELL, z0 = cz * CELL;
    if (c === '#') boxes.push([x0, 0, z0, x0 + CELL, 7, z0 + CELL]);
    if (c === 'h' || c === 'g') boxes.push([x0, 0, z0, x0 + CELL, RAISED_H, z0 + CELL]);
  }
  for (const s of d.stairs) {
    const n = Math.ceil((s.h1 - s.h0) / 0.4), len = s.up[1] === 'x' ? s.x1 - s.x0 : s.z1 - s.z0;
    for (let i = 0; i < n; i++) {
      const top = s.h0 + ((i + 1) * (s.h1 - s.h0)) / n, a = (i * len) / n, b = ((i + 1) * len) / n;
      let x0 = s.x0, x1 = s.x1, z0 = s.z0, z1 = s.z1;
      if (s.up === '+x') { x0 = s.x0 + a; x1 = s.x0 + b; } else if (s.up === '-x') { x1 = s.x1 - a; x0 = s.x1 - b; }
      else if (s.up === '+z') { z0 = s.z0 + a; z1 = s.z0 + b; } else { z1 = s.z1 - a; z0 = s.z1 - b; }
      boxes.push([x0, 0, z0, x1, top, z1]);
    }
    // stairs must sit on open, non-raised cells
    for (let x = s.x0 + 0.5; x < s.x1; x += 1) for (let z = s.z0 + 0.5; z < s.z1; z += 1) {
      const c = cellM(x, z); if (!isOpen(c) || c === 'h' || c === 'g') errs.push(`stair over cell '${c}' at ${x},${z}`);
    }
  }
  for (const p of d.props) boxes.push([p.min[0], p.min[1], p.min[2], p.max[0], p.max[1], p.max[2]]);
  const overlap = (x0, y0, z0, x1, y1, z1) => boxes.filter((b) => b[3] > x0 && b[0] < x1 && b[4] > y0 && b[1] < y1 && b[5] > z0 && b[2] < z1);

  // ---- walk grid (mirrors buildNav)
  const h = new Float32Array(NW * ND), walk = new Uint8Array(NW * ND);
  for (let iz = 0; iz < ND; iz++) for (let ix = 0; ix < NW; ix++) {
    const i = iz * NW + ix, x = (ix + 0.5) * RES, z = (iz + 0.5) * RES, c = cellM(x, z);
    if (!isOpen(c)) continue;
    let floor = 0;
    for (const b of overlap(x - 0.01, -0.5, z - 0.01, x + 0.01, 3.0, z + 0.01)) if (b[4] <= 2.7 && b[4] > floor) floor = b[4];
    h[i] = floor;
    if (overlap(x - 0.3, floor + 0.45, z - 0.3, x + 0.3, floor + 1.8, z + 0.3).length) continue;
    walk[i] = 1;
  }
  const idx = (x, z) => { const ix = Math.floor(x / RES), iz = Math.floor(z / RES); return ix < 0 || iz < 0 || ix >= NW || iz >= ND ? -1 : iz * NW + ix; };
  const nearest = (x, z) => {
    const i0 = idx(x, z); if (i0 >= 0 && walk[i0]) return i0;
    for (let r = 1; r < 6; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const i = idx(x + dx * RES, z + dz * RES); if (i >= 0 && walk[i]) return i;
    }
    return -1;
  };
  const bfs = (start) => {
    const seen = new Uint8Array(NW * ND), q = [start]; seen[start] = 1;
    while (q.length) {
      const cur = q.pop(), cx = cur % NW, cz = (cur / NW) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = cx + dx, nz = cz + dz; if (nx < 0 || nz < 0 || nx >= NW || nz >= ND) continue;
        const ni = nz * NW + nx; if (seen[ni] || !walk[ni]) continue;
        const dh = h[ni] - h[cur]; if (dh > 0.5 || dh < -2.3) continue;
        if (dx && dz && (!walk[cz * NW + nx] || !walk[nz * NW + cx])) continue;
        seen[ni] = 1; q.push(ni);
      }
    }
    return seen;
  };
  const spawnStart = (z) => {
    for (let x = z.x0 + 0.25; x < z.x1; x += 0.5) for (let zz = z.z0 + 0.25; zz < z.z1; zz += 0.5) { const i = idx(x, zz); if (i >= 0 && walk[i]) return i; }
    return -1;
  };
  const reach = {};
  for (const team of ['T', 'CT']) {
    const s = spawnStart(d.spawns[team]);
    if (s < 0) { errs.push(`${team} spawn zone has no walkable cell`); reach[team] = new Uint8Array(NW * ND); } else reach[team] = bfs(s);
  }
  // spawn zones must be mostly walkable
  for (const team of ['T', 'CT']) {
    const z = d.spawns[team]; let n = 0, w = 0;
    for (let x = z.x0 + 0.25; x < z.x1; x += 0.5) for (let zz = z.z0 + 0.25; zz < z.z1; zz += 0.5) { if (z.ex0 !== undefined && x > z.ex0 && x < z.ex1) continue; n++; const i = idx(x, zz); if (walk[i] && reach.T[i] && reach.CT[i]) w++; }
    if (w < 10) errs.push(`${team} spawn zone: only ${w}/${n} walkable connected samples`);
  }

  // ---- point checks
  const points = [];
  for (const k of ['A', 'B']) {
    points.push([`site ${k} center`, d.sites[k].cx, d.sites[k].cz, false]);
    (d.routes[k] || []).forEach((r, ri) => r.forEach((p, pi) => points.push([`route ${k}${ri}[${pi}]`, p[0], p[1], false])));
    (d.plants[k] || []).forEach((p, pi) => points.push([`plant ${k}${pi}`, p[0], p[1], true]));
    (d.entries[k] || []).forEach((p, pi) => points.push([`entry ${k}${pi}`, p[0], p[1], false]));
    if ((d.routes[k] || []).length < 2) errs.push(`site ${k}: fewer than 2 routes`);
  }
  for (const k in d.holds) d.holds[k].forEach((p, pi) => points.push([`hold ${k}${pi}`, p[0], p[1], true]));
  const inProp = (x, z) => d.props.some((p) => x > p.min[0] && x < p.max[0] && z > p.min[2] && z < p.max[2] && p.max[1] > 0.45 && p.min[1] < 1.8);
  for (const [name, x, z, strict] of points) {
    const c = cellM(x, z);
    if (!isOpen(c)) { errs.push(`${name} (${x},${z}) on closed cell '${c}'`); continue; }
    if (inProp(x, z)) { errs.push(`${name} (${x},${z}) inside a prop`); continue; }
    const i = idx(x, z);
    if (strict && !walk[i]) { errs.push(`${name} (${x},${z}) not walkable (too close to geometry)`); continue; }
    const j = walk[i] ? i : nearest(x, z);
    if (j < 0) { errs.push(`${name} (${x},${z}) has no walkable cell nearby`); continue; }
    if (!reach.T[j]) errs.push(`${name} (${x},${z}) unreachable from T spawn`);
    if (!reach.CT[j]) errs.push(`${name} (${x},${z}) unreachable from CT spawn`);
  }
  for (const k of ['A', 'B']) for (const [x, z] of d.plants[k]) {
    const s = d.sites[k]; if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) errs.push(`plant ${k} (${x},${z}) outside site rect`);
  }
  // utility targets should at least land on open ground
  for (const k in d.utility) for (const u of d.utility[k]) if (!isOpen(cellM(u[3], u[4]))) warns.push(`utility ${k} ${u[0]} target (${u[3]},${u[4]}) on closed cell`);

  // ---- spawn-to-spawn grid visibility (walls only; props ignored = conservative)
  const losGrid = (ax, az, bx, bz) => {
    const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 0.05);
    for (let k = 1; k < n; k++) { const t = k / n; if (!isOpen(cellM(ax + (bx - ax) * t, az + (bz - az) * t))) return false; }
    return true;
  };
  const samples = (z) => {
    const out = [];
    for (let x = Math.floor(z.x0 / CELL) * CELL + 0.25; x < z.x1 + CELL; x += 0.5) for (let zz = Math.floor(z.z0 / CELL) * CELL + 0.25; zz < z.z1 + CELL; zz += 0.5) {
      if (x < z.x0 - 0.5 || x > z.x1 + 0.5 || zz < z.z0 - 0.5 || zz > z.z1 + 0.5) continue;
      if (isOpen(cellM(x, zz))) out.push([x, zz]);
    }
    return out;
  };
  const ts = samples(d.spawns.T), cs = samples(d.spawns.CT);
  let seen = null;
  outer: for (const a of ts) for (const b of cs) if (losGrid(a[0], a[1], b[0], b[1])) { seen = [a, b]; break outer; }
  if (seen) errs.push(`spawns can see each other: T ${seen[0]} <-> CT ${seen[1]}`);

  // ---- misc
  if (d.lamps.length !== 4) errs.push(`expected 4 lamps, got ${d.lamps.length}`);
  for (const k of ['A', 'B']) if (!d.decals.some((x) => x[0] === k) || !d.floorDecals.some((x) => x[0] === k)) warns.push(`missing ${k} decal`);
  for (const [name, x, , z] of d.lamps.map((l, i) => [`lamp${i}`, l[0], l[1], l[2]])) if (!isOpen(cellM(x, z))) warns.push(`${name} over closed cell`);

  return { id, errs, warns, samples: [ts.length, cs.length] };
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ctx.MAP_ORDER;
let bad = 0;
for (const id of ids) {
  if (!ctx.MAP_DEFS[id]) { console.log(`${id}: unknown map`); bad++; continue; }
  const r = validate(id);
  console.log(`${r.errs.length ? 'FAIL' : 'OK  '} ${id}  (${r.errs.length} errors, ${r.warns.length} warnings, LOS samples ${r.samples.join('x')})`);
  for (const e of r.errs) console.log('   error: ' + e);
  for (const w of r.warns) console.log('   warn:  ' + w);
  if (r.errs.length) bad++;
}
process.exit(bad ? 1 : 0);
