'use strict';
/* =====================================================================
   ACTIVE MAP: the globals the rest of the game reads, filled from the
   registry in maps.js by loadMapDef().
   ===================================================================== */
const CELL = 2, GW = 40, GH = 32;
const MAP_W = GW * CELL, MAP_D = GH * CELL;
const RAISED_H = 2.0;
const ROOF_H = { b: 6.2, w: 3.4 };
let GRID, STAIRS, PROPS, SITES, SPAWN_ZONES, CALLOUTS, T_ROUTES, PLANT_SPOTS, CT_HOLDS, SITE_ENTRIES, UTILITY, MAP_INFO;
function loadMapDef(id) {
  const d = MAP_DEFS[id]();
  GRID = d.grid; STAIRS = d.stairs; PROPS = d.props; SITES = d.sites; SPAWN_ZONES = d.spawns; CALLOUTS = d.callouts;
  T_ROUTES = d.routes; PLANT_SPOTS = d.plants; CT_HOLDS = d.holds; SITE_ENTRIES = d.entries; UTILITY = d.utility;
  MAP_INFO = d;
}
loadMapDef('dockside');
const cellAt = (cx, cz) => (cx < 0 || cz < 0 || cx >= GW || cz >= GH ? '#' : GRID[cz][cx]);
const cellAtM = (x, z) => cellAt(Math.floor(x / CELL), Math.floor(z / CELL));
const siteAt = (x, z) => { for (const k in SITES) { const s = SITES[k]; if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return k; } return null; };
const calloutAt = (x, z) => { for (const c of CALLOUTS) if (x >= c[1] && x <= c[3] && z >= c[2] && z <= c[4]) return c[0]; return ''; };
