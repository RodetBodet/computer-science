'use strict';
/* =====================================================================
   STRIKEPOINT: a 5v5 bomb-defusal shooter in plain HTML / CSS / JS.

   How it works
   - The 3D view is a grid raycaster (the Wolfenstein / Doom-era trick):
     one ray per screen column finds the nearest wall, floor pixels are
     projected back onto the map, and players are camera-facing sprites.
     Everything is written into a small pixel buffer that CSS scales up.
   - All textures, sprites and sounds are generated in code, so the game
     needs no image or audio files.
   - Gameplay: rounds, buy menu + economy, recoil, headshots, armor,
     bomb plant/defuse, and bots that path-find with A*.
   ===================================================================== */

// ============================== UTILITIES ==============================
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const angNorm = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; else if (a < -Math.PI) a += TAU; return a; };
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); };
const $ = (id) => document.getElementById(id);
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

// ================================ MAP ==================================
// # sandstone   % plaster   C crates   1/2 walls painted "A"/"B"
// . sand   , paving   a/b bombsite floor   T/K terrorist/CT spawn
const MAP_SRC = [
  '######2##########################1######',
  '#bbbbbbbbbbb###KKKKKKKKKK###aaaaaaaaaaa#',
  '#bbbbbbbbbCb###KKKKKKKKCK###aaaaaaaaaCa#',
  '#bbbCCbbbbbb,,,KCKKKKKKKK,,,aaaCCaaaaaa#',
  '#bbbCbbbbbbb,,,KKKKKKKKKK,,,aaaCaaaaaaa#',
  '2bbbbbbbbbbb,,,KKKKKKKKKK,,,aaaaaaaaaaa1',
  '#bbbbbbbbbbb###KKKKKKKKKK###aaaaaaaaaaa#',
  '#bbbbbbbCCbb######....######aaaaaaaCCaa#',
  '#bCbbbbbCbbb######....######aCaaaaaaaaa#',
  '#bbbbbbbbbbb######....######aaaaaCaaaaa#',
  '#bbbbbbbbbbb######%...######aaaaaaaaaaa#',
  '###,,,,###########....######,,,##.....##',
  '###,,,,###########.C..######,,,##.....##',
  '###,,,,###########....######,,,##.....##',
  '###,,,,###########....######,,,##.%...##',
  '###,,,,###########....,,,,,,,,,##.....##',
  '###,C,,###########....,,,,,,,,,##.....##',
  '###,,,,###########....,,,,,,,,,##.....##',
  '###,,,,###########...%###########.....##',
  '###,,,,,,,,,,,,,,,....###########.....##',
  '###,,,,,,,C,,,,,,,....###########..C..##',
  '###,,,,,,,,,,,,,,,....###########..C..##',
  '###,,,,###########..C.###########.....##',
  '###,,,,###########....###########.....##',
  '###,,,,###########....#########.......##',
  '###,,C,###########%%..#########.......##',
  '###,,,,###########....#########.....%.##',
  '###,,,,###########..%%#########.......##',
  '###,,,,###########....###########.....##',
  '###,,,,,,,,,TTTTTTTTTTTTTTTT..........##',
  '###,,,,,,,,,TTTTTTTTTTTTTTTT..........##',
  '###,,,,,,,,,TTTTTTTTTTTTTCTT..........##',
  '############TTCTTTT%%TTTTTTT############',
  '############TTTTTTTTTTTTTTTT############',
  '############TTTTTTTTTTTTTTTT############',
  '########################################',
];
const MAP_W = MAP_SRC[0].length, MAP_H = MAP_SRC.length;
const WALL_IDS = { '#': 0, '%': 1, C: 2, 1: 3, 2: 4 };
const FLOOR_IDS = { '.': 0, T: 0, ',': 1, K: 1, a: 2, b: 3 };
const wallMap = new Int8Array(MAP_W * MAP_H).fill(-1);
const floorMap = new Uint8Array(MAP_W * MAP_H);
const nearWall = new Uint8Array(MAP_W * MAP_H);
const SPAWNS = { T: [], CT: [] };
const SITE_CELLS = { A: [], B: [] };

for (let y = 0; y < MAP_H; y++) {
  for (let x = 0; x < MAP_W; x++) {
    const ch = MAP_SRC[y][x], i = y * MAP_W + x;
    if (ch in WALL_IDS) {
      let id = WALL_IDS[ch];
      if (id === 0 && (((x * 73856093) ^ (y * 19349663)) >>> 0) % 5 === 0) id = 5; // weathered variant
      wallMap[i] = id;
    } else {
      floorMap[i] = FLOOR_IDS[ch] ?? 0;
      if (ch === 'T' && y >= 32 && x >= 14 && x <= 25) SPAWNS.T.push([x, y]);
      if (ch === 'K' && y <= 4 && x >= 17 && x <= 22) SPAWNS.CT.push([x, y]);
      if (ch === 'a') SITE_CELLS.A.push([x, y]);
      if (ch === 'b') SITE_CELLS.B.push([x, y]);
    }
  }
}
function isWall(x, y) { return x < 0 || y < 0 || x >= MAP_W || y >= MAP_H || wallMap[y * MAP_W + x] >= 0; }
for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
  if (isWall(x, y)) continue;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isWall(x + dx, y + dy)) nearWall[y * MAP_W + x] = 1;
}
const cellChar = (x, y) => (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H ? '#' : MAP_SRC[y | 0][x | 0]);
const siteAt = (x, y) => { const c = cellChar(x | 0, y | 0); return c === 'a' ? 'A' : c === 'b' ? 'B' : null; };

const REGIONS = [
  ['B Site', 1, 1, 11, 10], ['CT Spawn', 15, 1, 24, 6], ['A Site', 28, 1, 38, 10],
  ['B Hall', 12, 3, 14, 5], ['A Hall', 25, 3, 27, 5], ['Catwalk', 22, 11, 30, 17], ['Mid', 18, 7, 21, 28],
  ['Tunnels', 3, 11, 6, 31], ['Lower Tunnels', 7, 29, 11, 31], ['Connector', 7, 19, 17, 21],
  ['Long Corner', 31, 24, 32, 27], ['Long A', 33, 11, 37, 31], ['Outside Long', 28, 29, 32, 31], ['T Spawn', 12, 29, 27, 34],
];
function regionAt(x, y) {
  x |= 0; y |= 0;
  for (const r of REGIONS) if (x >= r[1] && x <= r[3] && y >= r[2] && y <= r[4]) return r[0];
  return '';
}
const REGION_SITE = { 'A Site': 'A', 'Long A': 'A', Catwalk: 'A', 'A Hall': 'A', 'Long Corner': 'A', 'B Site': 'B', Tunnels: 'B', Connector: 'B', 'B Hall': 'B' };

// Bot knowledge of the map
const T_ROUTES = { A: [[35.5, 22.5], [24.5, 16]], B: [[4.5, 22.5], [13.5, 20]] };
const PLANT_SPOTS = { A: [[32.5, 6.5], [34.5, 5.5], [30.5, 7.5], [36.5, 4.5]], B: [[6.5, 5.5], [8.5, 4.5], [3.5, 6.5], [7.5, 2.5]] };
const CT_HOLDS = {
  A: [[30.5, 2.5, 35.5, 12], [36.5, 9.5, 35.5, 16], [33.5, 4.5, 29.5, 12], [29.5, 9.5, 29.5, 14]],
  B: [[2.5, 4.5, 4.5, 12], [9.5, 9.5, 4.5, 12], [6.5, 2.5, 4.5, 11], [10.5, 5.5, 4.5, 14]],
  mid: [[20.5, 8.5, 19.5, 26], [19.5, 7.5, 20, 27]],
};
const SITE_ENTRIES = { A: [[35.5, 12], [29.5, 12], [26, 4]], B: [[4.5, 12], [13, 4]] };

// ============================ CONSTANTS ================================
const WALL_H = 2.0;
const EYE_STAND = 1.0, EYE_CROUCH = 0.7;
const SOLDIER_W = 0.6, SOLDIER_H = 1.2, SPR_W = 64, SPR_H = 128;
const HEAD_V = 34, CHEST_V = 62, STOMACH_V = 80; // sprite rows where hit zones end
const DEAD_W = 1.2, DEAD_H = 0.5;
const RADIUS = 0.22;
const BASE_FOV = (90 * Math.PI) / 180;
const ZOOM_FOV = [BASE_FOV, (40 * Math.PI) / 180, (15 * Math.PI) / 180];
const FREEZE_TIME = 6, ROUND_TIME = 115, BUY_TIME = 20, BOMB_TIME = 40;
const PLANT_TIME = 3.2, DEFUSE_TIME = 10, KIT_DEFUSE_TIME = 5, ROUND_END_TIME = 5.5;
const START_MONEY = 800, MAX_MONEY = 16000;
const FOG_R = 214, FOG_G = 205, FOG_B = 186;

const DIFF = [
  { name: 'Easy', react: 0.75, aim: 0.055, turn: 3.2, hs: 0.08 },
  { name: 'Normal', react: 0.42, aim: 0.032, turn: 5.5, hs: 0.18 },
  { name: 'Hard', react: 0.24, aim: 0.019, turn: 9.0, hs: 0.32 },
];

// ============================== WEAPONS ================================
// Distances: 1 map cell ~ 64 game units. Speeds are cells/second.
const WEAPONS = {
  knife: { name: 'Knife', slot: 'knife', kind: 'knife', model: 'knife', price: 0, dmg: 40, rate: 0.42, range: 1.5, speed: 3.9, reward: 1500, deploy: 0.4 },
  glock: { name: 'Glock-18', slot: 'secondary', kind: 'pistol', model: 'pistol', team: 'T', price: 200, dmg: 30, rate: 0.15, mag: 20, reserve: 120, reload: 2.2, pen: 0.47, rangeMod: 0.85, spread: 0.007, moveSpread: 0.03, recoilV: 0.014, recoilH: 0.004, auto: false, speed: 3.75, reward: 300, sound: 'pistol', deploy: 0.5 },
  usp: { name: 'USP', slot: 'secondary', kind: 'pistol', model: 'pistol', team: 'CT', price: 200, dmg: 35, rate: 0.17, mag: 12, reserve: 24, reload: 2.2, pen: 0.505, rangeMod: 0.91, spread: 0.005, moveSpread: 0.03, recoilV: 0.016, recoilH: 0.004, auto: false, speed: 3.75, reward: 300, sound: 'pistol', deploy: 0.5 },
  deagle: { name: 'Desert Eagle', slot: 'secondary', kind: 'pistol', model: 'deagle', price: 700, dmg: 63, rate: 0.3, mag: 7, reserve: 35, reload: 2.2, pen: 0.93, rangeMod: 0.81, spread: 0.008, moveSpread: 0.07, recoilV: 0.06, recoilH: 0.01, auto: false, speed: 3.6, reward: 300, sound: 'deagle', deploy: 0.6 },
  mp5: { name: 'MP5', slot: 'primary', kind: 'smg', model: 'smg', price: 1500, dmg: 27, rate: 0.075, mag: 30, reserve: 120, reload: 2.6, pen: 0.625, rangeMod: 0.85, spread: 0.009, moveSpread: 0.022, recoilV: 0.009, recoilH: 0.005, auto: true, speed: 3.75, reward: 600, sound: 'smg', deploy: 0.6 },
  ak47: { name: 'AK-47', slot: 'primary', kind: 'rifle', model: 'ak', team: 'T', price: 2700, dmg: 36, rate: 0.1, mag: 30, reserve: 90, reload: 2.45, pen: 0.775, rangeMod: 0.98, spread: 0.0035, moveSpread: 0.09, recoilV: 0.016, recoilH: 0.009, auto: true, speed: 3.36, reward: 300, sound: 'ak', deploy: 0.7 },
  m4a1: { name: 'M4A1', slot: 'primary', kind: 'rifle', model: 'm4', team: 'CT', price: 3100, dmg: 33, rate: 0.09, mag: 30, reserve: 90, reload: 3.1, pen: 0.7, rangeMod: 0.97, spread: 0.003, moveSpread: 0.08, recoilV: 0.014, recoilH: 0.007, auto: true, speed: 3.52, reward: 300, sound: 'm4', deploy: 0.7 },
  awp: { name: 'AWP', slot: 'primary', kind: 'sniper', model: 'awp', price: 4750, dmg: 115, rate: 1.45, mag: 5, reserve: 30, reload: 3.6, pen: 0.975, rangeMod: 0.99, spread: 0.0008, unscoped: 0.09, moveSpread: 0.2, recoilV: 0, recoilH: 0, auto: false, speed: 3.12, reward: 100, sound: 'awp', deploy: 1.0, sniper: true },
  galil: { name: 'Galil AR', slot: 'primary', kind: 'rifle', model: 'galil', team: 'T', price: 1800, dmg: 30, rate: 0.09, mag: 35, reserve: 90, reload: 3.0, pen: 0.775, rangeMod: 0.98, spread: 0.005, moveSpread: 0.09, recoilV: 0.015, recoilH: 0.009, auto: true, speed: 3.36, reward: 300, sound: 'ak', deploy: 0.7 },
  famas: { name: 'FAMAS', slot: 'primary', kind: 'rifle', model: 'famas', team: 'CT', price: 2050, dmg: 30, rate: 0.09, mag: 25, reserve: 90, reload: 3.3, pen: 0.7, rangeMod: 0.96, spread: 0.0045, moveSpread: 0.085, recoilV: 0.014, recoilH: 0.008, auto: true, speed: 3.52, reward: 300, sound: 'm4', deploy: 0.7 },
  nova: { name: 'Nova', slot: 'primary', kind: 'shotgun', model: 'nova', price: 1050, dmg: 26, pellets: 9, rate: 0.88, mag: 8, reserve: 32, reload: 3.0, pen: 0.5, rangeMod: 0.7, spread: 0.055, moveSpread: 0.02, recoilV: 0.05, recoilH: 0.01, auto: false, speed: 3.52, reward: 900, sound: 'shotgun', deploy: 0.6 },
  ssg08: { name: 'SSG 08', slot: 'primary', kind: 'sniper', model: 'ssg', price: 1700, dmg: 88, rate: 1.25, mag: 10, reserve: 90, reload: 3.7, pen: 0.85, rangeMod: 0.98, spread: 0.001, unscoped: 0.045, moveSpread: 0.1, recoilV: 0, recoilH: 0, auto: false, speed: 3.84, reward: 300, sound: 'scout', deploy: 0.9, sniper: true },
  // grenades (counts live in agent.nades, the selected one in agent.inv.grenade)
  he: { name: 'HE Grenade', short: 'HE', slot: 'grenade', kind: 'grenade', model: 'nade_he', price: 300, max: 1, speed: 3.75, reward: 300, deploy: 0.45, pen: 0.5 },
  flash: { name: 'Flashbang', short: 'Flash', slot: 'grenade', kind: 'grenade', model: 'nade_flash', price: 200, max: 2, speed: 3.75, reward: 300, deploy: 0.45 },
  smoke: { name: 'Smoke Grenade', short: 'Smoke', slot: 'grenade', kind: 'grenade', model: 'nade_smoke', price: 300, max: 1, speed: 3.75, reward: 300, deploy: 0.45 },
};
const NADES = ['he', 'flash', 'smoke'];
const MAX_NADES = 4;
const GEAR = {
  kevlar: { name: 'Kevlar Vest', price: 650 },
  helmet: { name: 'Kevlar + Helmet', price: 1000 },
  kit: { name: 'Defuse Kit', price: 400, team: 'CT' },
};
// two-level buy menu: number picks a category, then a number picks the item
const BUY_LIST = {
  T: [['Pistols', ['glock', 'deagle']], ['Heavy & SMG', ['nova', 'mp5']], ['Rifles', ['galil', 'ak47', 'ssg08', 'awp']], ['Grenades', ['flash', 'smoke', 'he']], ['Gear', ['kevlar', 'helmet']]],
  CT: [['Pistols', ['usp', 'deagle']], ['Heavy & SMG', ['nova', 'mp5']], ['Rifles', ['famas', 'm4a1', 'ssg08', 'awp']], ['Grenades', ['flash', 'smoke', 'he']], ['Gear', ['kevlar', 'helmet', 'kit']]],
};

// Spray pattern: climbs for ~10 shots, then wanders sideways. n may be fractional (recovery).
function recoilFor(w, n) {
  if (!w.recoilV || n <= 0) return [0, 0];
  const k = Math.min(n, 10);
  const v = w.recoilV * k * (1 - k * 0.025);
  const h = n > 5 ? w.recoilH * 6 * Math.sin((n - 5) * 0.55) * Math.min(1, (n - 5) / 3) : w.recoilH * k * 0.15;
  return [h, v];
}

// ============================== TEXTURES ===============================
const TEX = { walls: [], floors: [], sky: null, soldier: {}, dead: {}, bomb: [], nade: {}, drop: {} };
const SKY_W = 512, SKY_H = 128;

function makeTexture(w, h, seed, noise, paint) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const rng = mulberry32(seed);
  paint(g, w, h, rng);
  const img = g.getImageData(0, 0, w, h), d = img.data;
  if (noise) {
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const n = (rng() - 0.5) * noise;
      d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.9;
    }
  }
  return { data: new Uint32Array(d.buffer), canvas: c, ctx: g, img };
}
function blotches(g, w, h, rng, n, colors, alpha, size) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(${pick(colors)},${alpha * (0.5 + rng())})`;
    g.beginPath();
    g.ellipse(rng() * w, rng() * h, size * (0.4 + rng()), size * (0.3 + rng() * 0.7), rng() * 3, 0, TAU);
    g.fill();
  }
}
function paintSandstone(g, w, h, rng, dark) {
  const k = dark ? 0.86 : 1;
  g.fillStyle = `rgb(${200 * k | 0},${168 * k | 0},${118 * k | 0})`;
  g.fillRect(0, 0, w, h);
  blotches(g, w, h, rng, 50, ['255,235,200', '150,115,70', '120,90,55'], 0.07, 9);
  for (let r = 0; r < 8; r++) {
    const y = r * 16, off = (r % 2) * 16 + (rng() * 4 | 0);
    g.fillStyle = 'rgba(95,70,42,0.55)'; g.fillRect(0, y, w, 1);
    g.fillStyle = 'rgba(255,240,210,0.22)'; g.fillRect(0, y + 1, w, 1);
    for (let x = off; x < w + 32; x += 32) {
      g.fillStyle = 'rgba(95,70,42,0.5)'; g.fillRect(x % w, y, 1, 16);
      g.fillStyle = 'rgba(255,240,210,0.16)'; g.fillRect((x + 1) % w, y + 1, 1, 15);
    }
  }
  for (let i = 0; i < 14; i++) { g.fillStyle = 'rgba(80,58,35,0.35)'; g.fillRect(rng() * w | 0, rng() * h | 0, 1 + rng() * 3 | 0, 1 + rng() * 2 | 0); }
  const gr = g.createLinearGradient(0, h * 0.7, 0, h);
  gr.addColorStop(0, 'rgba(70,45,20,0)'); gr.addColorStop(1, 'rgba(70,45,20,0.4)');
  g.fillStyle = gr; g.fillRect(0, h * 0.7, w, h * 0.3);
  g.fillStyle = 'rgba(255,248,225,0.3)'; g.fillRect(0, 0, w, 3);
  g.fillStyle = 'rgba(90,65,40,0.35)'; g.fillRect(0, 3, w, 1);
}
function paintPlaster(g, w, h, rng) {
  g.fillStyle = 'rgb(184,166,140)'; g.fillRect(0, 0, w, h);
  blotches(g, w, h, rng, 60, ['230,215,190', '140,120,95'], 0.08, 8);
  for (let i = 0; i < 4; i++) {
    const x = rng() * 44, y = 10 + rng() * 100, cw = 12 + rng() * 18, chh = 8 + rng() * 14;
    g.save(); g.beginPath(); g.ellipse(x + cw / 2, y + chh / 2, cw / 2, chh / 2, 0, 0, TAU); g.clip();
    g.fillStyle = 'rgb(150,82,58)'; g.fillRect(x, y, cw, chh);
    g.fillStyle = 'rgba(70,40,30,0.7)';
    for (let by = Math.floor(y / 6) * 6; by < y + chh; by += 6) { g.fillRect(x, by, cw, 1); for (let bx = ((by / 6) % 2) * 6; bx < 64; bx += 12) g.fillRect(bx, by, 1, 6); }
    g.restore();
    g.strokeStyle = 'rgba(90,70,50,0.5)'; g.beginPath(); g.ellipse(x + cw / 2, y + chh / 2, cw / 2, chh / 2, 0, 0, TAU); g.stroke();
  }
  const gr = g.createLinearGradient(0, h * 0.65, 0, h);
  gr.addColorStop(0, 'rgba(60,45,30,0)'); gr.addColorStop(1, 'rgba(60,45,30,0.45)');
  g.fillStyle = gr; g.fillRect(0, h * 0.65, w, h * 0.35);
  g.fillStyle = 'rgba(255,250,235,0.3)'; g.fillRect(0, 0, w, 3);
}
function paintCrates(g, w, h, rng) {
  for (let k = 0; k < 2; k++) {
    const y0 = k * 64, tone = k ? 0.92 : 1;
    g.fillStyle = `rgb(${152 * tone | 0},${110 * tone | 0},${64 * tone | 0})`; g.fillRect(0, y0, 64, 64);
    for (let y = 6; y < 64; y += 10) { g.fillStyle = 'rgba(80,50,25,0.5)'; g.fillRect(0, y0 + y, 64, 1); }
    blotches(g, 64, 64, rng, 12, ['90,60,30', '200,160,110'], 0.1, 5);
    g.strokeStyle = 'rgb(108,74,40)'; g.lineWidth = 7; g.strokeRect(3.5, y0 + 3.5, 57, 57);
    g.beginPath(); g.moveTo(7, y0 + 57); g.lineTo(57, y0 + 7); g.stroke();
    g.strokeStyle = 'rgba(230,190,140,0.35)'; g.lineWidth = 1;
    g.strokeRect(1, y0 + 1, 62, 62);
    g.beginPath(); g.moveTo(7, y0 + 54); g.lineTo(54, y0 + 7); g.stroke();
    g.fillStyle = 'rgba(40,30,20,0.85)';
    for (const [nx, ny] of [[4, 4], [59, 4], [4, 59], [59, 59]]) g.fillRect(nx, y0 + ny, 2, 2);
    g.fillStyle = 'rgba(30,20,10,0.6)'; g.fillRect(0, y0 + 62, 64, 2);
  }
}
function paintSign(letter) {
  return (g, w, h, rng) => {
    paintSandstone(g, w, h, rng, false);
    g.font = 'bold 62px Impact, "Arial Black", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(190,52,28,0.88)';
    g.fillText(letter, 32, 72);
    for (let i = 0; i < 6; i++) { g.fillRect(14 + rng() * 36, 92 + rng() * 4, 2, 4 + rng() * 10); }
    g.fillStyle = 'rgba(255,230,200,0.25)'; g.fillText(letter, 31, 71);
  };
}
function paintSand(g, w, h, rng) {
  g.fillStyle = 'rgb(198,170,122)'; g.fillRect(0, 0, w, h);
  blotches(g, w, h, rng, 30, ['230,205,160', '160,130,90'], 0.08, 8);
  for (let i = 0; i < 70; i++) { g.fillStyle = rng() < 0.5 ? 'rgba(120,95,60,0.5)' : 'rgba(240,225,190,0.5)'; g.fillRect(rng() * w | 0, rng() * h | 0, 1, 1); }
}
function paintPaving(tint) {
  return (g, w, h, rng) => {
    g.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`; g.fillRect(0, 0, w, h);
    for (let py = 0; py < 2; py++) for (let px = 0; px < 2; px++) {
      const t = 0.88 + rng() * 0.18;
      g.fillStyle = `rgba(${tint[0] * t | 0},${tint[1] * t | 0},${tint[2] * t | 0},1)`;
      g.fillRect(px * 32 + 1, py * 32 + 1, 30, 30);
      blotches(g, 32, 32, rng, 3, ['90,70,50', '240,220,190'], 0.06, 5);
    }
    g.fillStyle = 'rgba(70,55,40,0.6)';
    g.fillRect(0, 0, w, 1); g.fillRect(0, 32, w, 1); g.fillRect(0, 0, 1, h); g.fillRect(32, 0, 1, h);
    g.fillStyle = 'rgba(255,240,215,0.15)';
    g.fillRect(0, 1, w, 1); g.fillRect(0, 33, w, 1);
  };
}
function paintSky(g, w, h, rng) {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, 'rgb(58,110,182)'); gr.addColorStop(0.6, 'rgb(140,180,214)'); gr.addColorStop(1, 'rgb(222,214,196)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 60; i++) {
    const x = rng() * w, y = 14 + rng() * 60, rx = 20 + rng() * 60, ry = 4 + rng() * 9;
    g.fillStyle = `rgba(255,255,255,${0.04 + rng() * 0.08})`;
    for (const off of [-w, 0, w]) { g.beginPath(); g.ellipse(x + off, y, rx, ry, 0, 0, TAU); g.fill(); }
  }
  // distant town skyline
  g.fillStyle = 'rgb(196,182,158)';
  let x = 0;
  while (x < w) {
    const bw = 8 + rng() * 26, bh = 4 + rng() * 14;
    g.fillRect(x, h - bh, bw, bh);
    if (rng() < 0.15) { g.beginPath(); g.arc(x + bw / 2, h - bh, bw / 3, Math.PI, 0); g.fill(); }
    x += bw;
  }
}

// ----- Soldier sprite, drawn in a 64x128 box with soft cylinder shading -----
function shadeHex(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => clamp(Math.round(v * k), 0, 255);
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
// rounded box lit from the left, darker on the right (reads as a rounded volume)
function cyl(g, x, y, w, h, base, r = 0, light = 1) {
  const gr = g.createLinearGradient(x, 0, x + w, 0);
  gr.addColorStop(0, shadeHex(base, 1.18 * light));
  gr.addColorStop(0.38, shadeHex(base, 1.0 * light));
  gr.addColorStop(1, shadeHex(base, 0.58 * light));
  g.fillStyle = gr; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
}
// tapered limb between two joints, shaded across its width
function limb(g, x0, y0, x1, y1, w0, w1, base, light = 1) {
  const a = Math.atan2(y1 - y0, x1 - x0), nx = -Math.sin(a), ny = Math.cos(a);
  const gr = g.createLinearGradient(x0 - nx * w0 / 2, y0 - ny * w0 / 2, x0 + nx * w0 / 2, y0 + ny * w0 / 2);
  gr.addColorStop(0, shadeHex(base, 0.62 * light)); gr.addColorStop(0.6, shadeHex(base, 1.0 * light)); gr.addColorStop(1, shadeHex(base, 1.15 * light));
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(x0 + nx * w0 / 2, y0 + ny * w0 / 2); g.lineTo(x1 + nx * w1 / 2, y1 + ny * w1 / 2);
  g.lineTo(x1 - nx * w1 / 2, y1 - ny * w1 / 2); g.lineTo(x0 - nx * w0 / 2, y0 - ny * w0 / 2);
  g.closePath(); g.fill();
  g.fillStyle = shadeHex(base, 0.92 * light);
  g.beginPath(); g.arc(x0, y0, w0 / 2, 0, TAU); g.fill();
  g.beginPath(); g.arc(x1, y1, w1 / 2, 0, TAU); g.fill();
}
function ell(g, x, y, rx, ry, fill) { g.fillStyle = fill; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill(); }
function rectF(g, x, y, w, h, fill) { g.fillStyle = fill; g.fillRect(x, y, w, h); }
function headShade(g, x, y, rx, ry, base) {
  const gr = g.createRadialGradient(x - rx * 0.35, y - ry * 0.35, 1, x, y, Math.max(rx, ry) * 1.1);
  gr.addColorStop(0, shadeHex(base, 1.35)); gr.addColorStop(0.55, shadeHex(base, 1.0)); gr.addColorStop(1, shadeHex(base, 0.55));
  return gr;
}
function muzzleStar(g, x, y, r) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, 'rgba(255,255,235,1)'); gr.addColorStop(0.35, 'rgba(255,210,90,0.95)'); gr.addColorStop(1, 'rgba(255,140,30,0)');
  g.fillStyle = gr; g.beginPath();
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU, rr = i % 2 ? r * 0.38 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.fill();
}
const SOLDIER_PAL = {
  T: { skin: '#c08a5c', head: '#2f2b27', jacket: '#6d6748', vest: '#4b4331', pouch: '#62583e', pants: '#8a7a56', boots: '#2b241d', glove: '#2b2723', gun: '#232220', wood: '#8a5228', band: '#a8392a', pack: '#5a5038' },
  CT: { skin: '#d6a47e', head: '#46525a', jacket: '#3a4e6e', vest: '#263345', pouch: '#33445a', pants: '#3f4d61', boots: '#18191c', glove: '#1b1c20', gun: '#1b1c1f', wood: '#2c2e33', band: '#5f9cff', pack: '#2b3748' },
};

function paintSoldier(g, team, view, walk, shoot) {
  const C = SOLDIER_PAL[team];
  if (view === 'side') { paintSoldierSide(g, team, C, walk, shoot); return; }
  const front = view === 'front';
  // ---- legs (a lifted leg is drawn shorter) ----
  const lu = walk === 1 ? 5 : 0, ru = walk === -1 ? 5 : 0;
  for (const [x, up] of [[20, lu], [33, ru]]) {
    cyl(g, x, 79, 11, 23, C.pants, 3);
    cyl(g, x + 0.5, 99 - up, 10, 19, C.pants, 3, 0.94);
    if (front) cyl(g, x + 1, 97 - up, 9, 7, C.vest, 2); // knee pad
    rectF(g, x + 1, 89, 9, 1, 'rgba(0,0,0,0.18)'); // cargo pocket seam
    cyl(g, x - 1, 115 - up, 13, 10, C.boots, 3);
    rectF(g, x - 1, 123 - up, 13, 2, 'rgba(0,0,0,0.45)');
  }
  // ---- arms behind the torso (back view) ----
  if (!front) {
    cyl(g, 10, 38, 10, 22, C.jacket, 4); cyl(g, 44, 38, 10, 22, C.jacket, 4, 0.9);
    cyl(g, 11, 57, 9, 12, C.jacket, 4, 0.9); cyl(g, 44, 57, 9, 12, C.jacket, 4, 0.8);
    ell(g, 15.5, 70, 4.5, 4, C.glove); ell(g, 48.5, 70, 4.5, 4, C.glove);
    // rifle barrel poking out past the right side
    rectF(g, 50, 52, 13, 4, C.gun); rectF(g, 50, 52, 13, 1, 'rgba(255,255,255,0.15)');
  }
  // ---- torso ----
  cyl(g, 16, 35, 32, 46, C.jacket, 7);
  rectF(g, 18, 77, 28, 5, '#1d1b19'); // belt
  if (front) {
    rectF(g, 30, 77, 4, 5, '#8a8170');
    cyl(g, 19, 39, 26, 34, C.vest, 4);
    for (let i = 0; i < 3; i++) { cyl(g, 20 + i * 8.3, 58, 7.5, 12, C.pouch, 2); rectF(g, 20 + i * 8.3, 58, 7.5, 2.5, 'rgba(0,0,0,0.25)'); }
    cyl(g, 21, 41, 9, 11, C.pouch, 2); // radio pouch
    rectF(g, 24, 38, 2, 4, '#111'); // antenna
    // ---- arms wrapping forward to the rifle ----
    cyl(g, 9, 38, 10, 18, C.jacket, 4); cyl(g, 45, 38, 10, 18, C.jacket, 4, 0.85);
    rectF(g, 9, 46, 10, 3, C.band); // armband
    limb(g, 14, 54, 26, 63, 9, 8, C.jacket);
    limb(g, 50, 54, 40, 61, 9, 8, C.jacket, 0.85);
    // ---- rifle, pointed at the viewer (foreshortened) ----
    cyl(g, 23, 53, 19, 13, C.gun, 3);
    rectF(g, 24, 53, 17, 2, 'rgba(255,255,255,0.12)');
    g.fillStyle = C.wood; g.beginPath(); g.moveTo(31, 66); g.lineTo(37, 66); g.lineTo(39, 76); g.lineTo(33, 77); g.closePath(); g.fill(); // magazine
    rectF(g, 30, 49, 4, 5, C.gun); // front sight
    ell(g, 32.5, 59, 4.5, 4.5, '#0e0e0e'); ell(g, 32.5, 59, 2.3, 2.3, '#000');
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1; g.beginPath(); g.arc(32.5, 59, 4.5, Math.PI, Math.PI * 1.6); g.stroke();
    ell(g, 26, 63, 4.5, 4, C.glove); ell(g, 40, 61, 4.5, 4, C.glove);
    rectF(g, 23, 61, 6, 1, 'rgba(255,255,255,0.12)');
  } else {
    cyl(g, 19, 38, 26, 36, C.vest, 4);
    cyl(g, 22, 42, 20, 24, C.pack, 4); // hydration pack / radio
    rectF(g, 22, 50, 20, 2, 'rgba(0,0,0,0.3)');
    rectF(g, 22, 38, 3, 36, 'rgba(0,0,0,0.25)'); rectF(g, 39, 38, 3, 36, 'rgba(0,0,0,0.25)'); // straps
    if (team === 'CT') rectF(g, 38, 30, 2, 12, '#111');
  }
  // ---- neck + head ----
  cyl(g, 27, 29, 10, 8, team === 'T' ? C.head : C.skin, 2);
  if (team === 'T') {
    g.fillStyle = headShade(g, 32, 19, 10, 13, C.head); g.beginPath(); g.ellipse(32, 19, 10, 13, 0, 0, TAU); g.fill();
    if (front) {
      cyl(g, 24, 15, 16, 6, C.skin, 2); // eye slit in the balaclava
      ell(g, 28, 18, 1.6, 1.3, '#141210'); ell(g, 36, 18, 1.6, 1.3, '#141210');
      rectF(g, 25, 15, 14, 1, 'rgba(0,0,0,0.3)');
      rectF(g, 28, 25, 8, 1, 'rgba(0,0,0,0.25)'); // mouth seam
    } else {
      rectF(g, 24, 9, 16, 1, 'rgba(255,255,255,0.08)');
    }
  } else {
    if (front) {
      g.fillStyle = headShade(g, 32, 22, 8.5, 10.5, C.skin); g.beginPath(); g.ellipse(32, 22, 8.5, 10.5, 0, 0, TAU); g.fill();
      rectF(g, 29, 28, 6, 1.5, '#8f6446'); // mouth
      g.strokeStyle = '#141414'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(24, 22); g.lineTo(27, 31); g.moveTo(40, 22); g.lineTo(37, 31); g.stroke(); // chin strap
    } else ell(g, 32, 24, 8.5, 9, shadeHex(C.skin, 0.8));
    // helmet
    g.fillStyle = headShade(g, 32, 14, 12, 10, C.head);
    g.beginPath(); g.ellipse(32, 15, 12, 10, 0, Math.PI, TAU); g.lineTo(44, 18); g.lineTo(20, 18); g.closePath(); g.fill();
    rectF(g, 19, 17, 26, 3, shadeHex(C.head, 0.7));
    if (front) {
      cyl(g, 22, 13, 20, 6, '#181c20', 2); // goggles on the helmet
      ell(g, 27.5, 16, 3, 2.2, '#6fb0d6'); ell(g, 36.5, 16, 3, 2.2, '#6fb0d6');
      ell(g, 26.5, 15.2, 1, 0.7, '#e6f6ff'); ell(g, 35.5, 15.2, 1, 0.7, '#e6f6ff');
    } else rectF(g, 21, 15, 22, 3, '#181c20');
  }
  if (shoot && front) muzzleStar(g, 32.5, 59, 17);
}

function paintSoldierSide(g, team, C, walk, shoot) {
  // facing right; the far limbs are darker
  const hipX = 31, hipY = 81;
  const stride = walk === 0 ? [[27, 124, 0], [35, 124, 0]] : walk === 1 ? [[20, 121, -3], [42, 124, 3]] : [[42, 124, 3], [20, 121, -3]];
  const leg = (foot, light) => {
    const [fx, fy, bend] = foot;
    const kx = (hipX + fx) / 2 + bend + 2, ky = (hipY + fy) / 2 - 2;
    limb(g, hipX, hipY, kx, ky, 12, 10, C.pants, light);
    limb(g, kx, ky, fx, fy - 6, 10, 8, C.pants, light * 0.95);
    cyl(g, fx - 5, fy - 9, 14, 9, C.boots, 3, light);
    rectF(g, fx - 5, fy - 1, 14, 2, 'rgba(0,0,0,0.5)');
  };
  leg(stride[0], 0.72);
  // far arm reaches the handguard (behind the body)
  limb(g, 33, 40, 41, 53, 8, 7, C.jacket, 0.7);
  limb(g, 41, 53, 48, 54, 7, 6, C.jacket, 0.7);
  leg(stride[1], 1);
  // torso
  if (team === 'T') cyl(g, 15, 40, 9, 26, C.pack, 3, 0.9); // pack on the back
  cyl(g, 21, 35, 21, 47, C.jacket, 6);
  cyl(g, 23, 39, 20, 34, C.vest, 4);
  cyl(g, 36, 56, 7, 12, C.pouch, 2);
  rectF(g, 21, 77, 21, 5, '#1d1b19');
  // rifle held level, pointing right
  rectF(g, 13, 49, 11, 7, C.wood); // stock at the shoulder
  cyl(g, 22, 48, 23, 8, C.gun, 2);
  rectF(g, 23, 48, 21, 1.5, 'rgba(255,255,255,0.16)');
  rectF(g, 42, 49, 9, 6, team === 'T' ? C.wood : C.gun); // handguard
  rectF(g, 51, 50.5, 13, 3, C.gun); // barrel
  rectF(g, 46, 46, 2, 3, C.gun); // front sight
  g.fillStyle = team === 'T' ? C.wood : C.gun;
  g.beginPath(); g.moveTo(33, 56); g.lineTo(39, 56); g.lineTo(42, 66); g.lineTo(36, 67); g.closePath(); g.fill(); // magazine
  ell(g, 48, 54, 3.8, 3.4, C.glove);
  // near arm: shoulder -> elbow -> pistol grip
  limb(g, 29, 40, 27, 56, 10, 8, C.jacket);
  rectF(g, 24, 45, 9, 3, C.band);
  limb(g, 27, 56, 34, 57, 8, 7, C.jacket);
  ell(g, 35, 57, 4, 3.6, C.glove);
  // neck + head in profile
  cyl(g, 28, 29, 9, 8, team === 'T' ? C.head : C.skin, 2);
  if (team === 'T') {
    g.fillStyle = headShade(g, 32, 19, 9.5, 13, C.head); g.beginPath(); g.ellipse(32, 19, 9.5, 13, 0, 0, TAU); g.fill();
    cyl(g, 34, 15, 8, 6, C.skin, 2); ell(g, 38.5, 18, 1.4, 1.2, '#141210');
    g.fillStyle = C.head; g.beginPath(); g.moveTo(41, 21); g.lineTo(43, 24); g.lineTo(40, 25); g.closePath(); g.fill(); // nose
  } else {
    g.fillStyle = headShade(g, 33, 22, 8.5, 10, C.skin); g.beginPath(); g.ellipse(33, 22, 8.5, 10, 0, 0, TAU); g.fill();
    g.fillStyle = C.skin; g.beginPath(); g.moveTo(40, 20); g.lineTo(43.5, 24); g.lineTo(40, 25); g.closePath(); g.fill(); // nose
    rectF(g, 37, 28, 4, 1.4, '#8f6446');
    ell(g, 30, 22, 2, 2.6, shadeHex(C.skin, 0.75)); // ear
    g.fillStyle = headShade(g, 31, 14, 12, 10, C.head);
    g.beginPath(); g.ellipse(31, 15, 12, 10, 0, Math.PI, TAU); g.lineTo(43, 18); g.lineTo(19, 19); g.closePath(); g.fill();
    rectF(g, 19, 17, 25, 3, shadeHex(C.head, 0.7));
    cyl(g, 35, 13, 8, 5, '#181c20', 2); ell(g, 40, 15.5, 2.2, 1.8, '#6fb0d6');
    g.strokeStyle = '#141414'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(29, 20); g.lineTo(33, 31); g.stroke();
  }
  if (shoot) muzzleStar(g, 62, 52, 12);
}
function outlineSprite(tex, w, h) {
  const d = tex.data, out = new Uint32Array(d);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if ((d[i] >>> 24) !== 0) continue;
    if ((x > 0 && d[i - 1] >>> 24) || (x < w - 1 && d[i + 1] >>> 24) || (y > 0 && d[i - w] >>> 24) || (y < h - 1 && d[i + w] >>> 24)) out[i] = 0xff0f0c0a;
  }
  tex.data.set(out);
}
function buildTextures() {
  TEX.walls[0] = makeTexture(64, 128, 11, 16, (g, w, h, r) => paintSandstone(g, w, h, r, false)).data;
  TEX.walls[1] = makeTexture(64, 128, 12, 14, paintPlaster).data;
  TEX.walls[2] = makeTexture(64, 128, 13, 18, paintCrates).data;
  TEX.walls[3] = makeTexture(64, 128, 14, 16, paintSign('A')).data;
  TEX.walls[4] = makeTexture(64, 128, 15, 16, paintSign('B')).data;
  TEX.walls[5] = makeTexture(64, 128, 16, 16, (g, w, h, r) => paintSandstone(g, w, h, r, true)).data;
  TEX.floors[0] = makeTexture(64, 64, 21, 20, paintSand).data;
  TEX.floors[1] = makeTexture(64, 64, 22, 12, paintPaving([168, 152, 128])).data;
  TEX.floors[2] = makeTexture(64, 64, 23, 12, paintPaving([176, 136, 108])).data;
  TEX.floors[3] = makeTexture(64, 64, 24, 12, paintPaving([172, 140, 112])).data;
  TEX.sky = makeTexture(SKY_W, SKY_H, 31, 4, paintSky).data;

  for (const team of ['T', 'CT']) {
    const S = {};
    const make = (name, view, walk, shoot) => {
      const t = makeTexture(SPR_W, SPR_H, 40, 10, (g) => paintSoldier(g, team, view, walk, shoot));
      outlineSprite(t, SPR_W, SPR_H);
      S[name] = t;
    };
    make('f0', 'front', 0, false); make('f1', 'front', 1, false); make('f2', 'front', -1, false); make('fs', 'front', 0, true);
    make('b0', 'back', 0, false); make('b1', 'back', 1, false); make('b2', 'back', -1, false);
    make('s0', 'side', 0, false); make('s1', 'side', 1, false); make('s2', 'side', -1, false); make('ss', 'side', 0, true);
    // facing-left frames are mirror images of the side frames
    const mirror = (src) => {
      const out = new Uint32Array(SPR_W * SPR_H);
      for (let y = 0; y < SPR_H; y++) for (let x = 0; x < SPR_W; x++) out[y * SPR_W + x] = src[y * SPR_W + (SPR_W - 1 - x)];
      return out;
    };
    const T = {};
    for (const k in S) T[k] = S[k].data;
    for (const k of ['s0', 's1', 's2', 'ss']) T['m' + k[1]] = mirror(S[k].data);
    TEX.soldier[team] = T;
    // corpse: the idle sprite laid on its back, squashed by perspective
    const src = document.createElement('canvas'); src.width = SPR_W; src.height = SPR_H;
    src.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(S.f0.data.buffer.slice(0)), SPR_W, SPR_H), 0, 0);
    TEX.dead[team] = makeTexture(128, 48, 41, 0, (g) => {
      g.fillStyle = 'rgba(110,14,10,0.85)'; g.beginPath(); g.ellipse(70, 40, 44, 7, 0, 0, TAU); g.fill();
      g.save(); g.translate(64, 30); g.scale(1, 0.5); g.rotate(-Math.PI / 2); g.drawImage(src, -SPR_W / 2, -SPR_H / 2); g.restore();
    }).data;
  }
  for (let k = 0; k < 2; k++) {
    TEX.bomb[k] = makeTexture(32, 20, 50, 8, (g) => {
      g.fillStyle = '#4a4636'; g.fillRect(2, 6, 28, 13);
      g.fillStyle = '#b39a64'; for (let i = 0; i < 4; i++) g.fillRect(3 + i * 7, 7, 6, 11);
      g.fillStyle = '#222'; g.fillRect(9, 2, 14, 8);
      g.fillStyle = '#6e8f5a'; g.fillRect(10, 3, 12, 3);
      g.fillStyle = k ? '#ff2a1a' : '#4a0d08'; g.fillRect(20, 7, 3, 2);
      g.strokeStyle = '#c03020'; g.beginPath(); g.moveTo(5, 6); g.quadraticCurveTo(10, 1, 14, 6); g.stroke();
      g.strokeStyle = '#2050c0'; g.beginPath(); g.moveTo(26, 6); g.quadraticCurveTo(22, 0, 18, 6); g.stroke();
    }).data;
  }
  // grenades in flight
  const nadeCol = { he: ['#7d8650', '#3a3f20'], flash: ['#d0d3d6', '#6a6d71'], smoke: ['#9fab9e', '#47524a'] };
  for (const k of NADES) {
    TEX.nade[k] = makeTexture(12, 12, 60, 6, (g) => {
      const gr = g.createRadialGradient(4, 4, 1, 6, 7, 6); gr.addColorStop(0, nadeCol[k][0]); gr.addColorStop(1, nadeCol[k][1]);
      g.fillStyle = gr; g.beginPath(); g.roundRect(k === 'he' ? 1.5 : 3, 2, k === 'he' ? 9 : 6, 10, 3); g.fill();
      g.fillStyle = '#555'; g.fillRect(4, 0, 4, 3);
    }).data;
  }
  // guns lying on the floor, seen side-on
  const gunIcon = (body, stock, len, mag, scope) => (g) => {
    const y = 8;
    g.fillStyle = stock; g.fillRect(2, y, 12, 6); g.fillRect(2, y + 2, 4, 7);
    g.fillStyle = body; g.fillRect(13, y - 1, 24, 7); g.fillRect(36, y, len, 3);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(13, y - 1, 24, 1);
    g.fillStyle = body; g.fillRect(20, y + 5, 4, 6);
    if (mag) { g.fillStyle = mag; g.beginPath(); g.moveTo(27, y + 5); g.lineTo(32, y + 5); g.lineTo(34, y + 12); g.lineTo(29, y + 12); g.fill(); }
    if (scope) { g.fillStyle = '#121314'; g.fillRect(18, y - 5, 16, 4); }
  };
  TEX.drop.rifle = makeTexture(64, 20, 70, 8, gunIcon('#2b2b2d', '#7a4a26', 22, '#8a4a1c', false)).data;
  TEX.drop.smg = makeTexture(64, 20, 71, 8, gunIcon('#2b2c2f', '#1c1d1f', 10, '#202124', false)).data;
  TEX.drop.sniper = makeTexture(64, 20, 72, 8, gunIcon('#4a5536', '#4a5536', 26, '#1c1e1a', true)).data;
  TEX.drop.shotgun = makeTexture(64, 20, 73, 8, gunIcon('#2b2c2f', '#1b1c1e', 26, null, false)).data;
  TEX.drop.pistol = makeTexture(64, 20, 74, 8, (g) => { g.fillStyle = '#2c2d30'; g.fillRect(22, 7, 22, 5); g.fillRect(24, 11, 6, 8); g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(22, 7, 22, 1); }).data;
}

// ================================ AUDIO ================================
// Every sound is synthesized with WebAudio: filtered noise + oscillators.
const SFX = {
  ctx: null, master: null, noise: null,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.5;
      const comp = this.ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
      this.master.connect(comp); comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2; const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
    } catch (e) { this.ctx = null; }
  },
  // volume + stereo pan for a sound at world (x,y), heard from the camera
  spatial(x, y) {
    if (x === undefined) return { vol: 1, pan: 0, dist: 0 };
    const dx = x - CAM.x, dy = y - CAM.y, d = Math.hypot(dx, dy);
    const rel = angNorm(Math.atan2(dy, dx) - CAM.a);
    return { vol: 1 / (1 + d * 0.16), pan: clamp(Math.sin(rel), -1, 1) * Math.min(1, d / 3), dist: d };
  },
  out(vol, pan) {
    const g = this.ctx.createGain(); g.gain.value = vol;
    if (this.ctx.createStereoPanner) { const p = this.ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(this.master); }
    else g.connect(this.master);
    return g;
  },
  noiseBurst(out, t, dur, type, freq, q, gain, sweepTo) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); if (q) f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  },
  tone(out, t, dur, type, f0, f1, gain) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
  },
  GUNS: {
    pistol: { lp: 4200, dur: 0.2, thump: 190, tg: 0.5, crack: 0.5 },
    deagle: { lp: 2200, dur: 0.45, thump: 110, tg: 0.9, crack: 0.6 },
    smg: { lp: 4800, dur: 0.15, thump: 170, tg: 0.4, crack: 0.4 },
    ak: { lp: 2700, dur: 0.3, thump: 120, tg: 0.8, crack: 0.6 },
    m4: { lp: 3800, dur: 0.26, thump: 140, tg: 0.65, crack: 0.55 },
    awp: { lp: 1700, dur: 1.0, thump: 70, tg: 1.1, crack: 0.9 },
    shotgun: { lp: 1900, dur: 0.55, thump: 85, tg: 1.0, crack: 0.8 },
    scout: { lp: 2600, dur: 0.6, thump: 100, tg: 0.9, crack: 0.9 },
  },
  shot(kind, x, y) {
    if (!this.ctx) return;
    const s = this.spatial(x, y); if (s.vol < 0.03) return;
    const P = this.GUNS[kind] || this.GUNS.pistol, t = this.ctx.currentTime;
    const out = this.out(s.vol, s.pan);
    const lp = P.lp * (1 / (1 + s.dist * 0.06));
    this.noiseBurst(out, t, P.dur, 'lowpass', lp, 0.7, 0.9, lp * 0.3);
    this.noiseBurst(out, t, 0.04, 'highpass', 2500, 0, P.crack * (s.dist > 8 ? 0.3 : 1));
    this.tone(out, t, P.dur * 0.5, 'sine', P.thump, 40, P.tg);
    if (s.dist > 10) this.noiseBurst(out, t + 0.05, P.dur * 2, 'lowpass', 600, 0, 0.25);
  },
  play(name, x, y) {
    if (!this.ctx) return;
    const s = this.spatial(x, y); if (s.vol < 0.02) return;
    const t = this.ctx.currentTime, o = this.out(s.vol, s.pan);
    switch (name) {
      case 'step': this.noiseBurst(o, t, 0.07, 'bandpass', 300 + Math.random() * 200, 1.5, 0.5); break;
      case 'knife': this.noiseBurst(o, t, 0.16, 'bandpass', 1800, 1.2, 0.5, 6000); break;
      case 'hit': this.noiseBurst(o, t, 0.06, 'lowpass', 900, 0, 0.6); this.tone(o, t, 0.06, 'sine', 220, 90, 0.4); break;
      case 'headshot': this.tone(o, t, 0.18, 'sine', 2600, 2500, 0.25); this.tone(o, t, 0.12, 'sine', 3900, 3800, 0.12); this.noiseBurst(o, t, 0.05, 'highpass', 3000, 0, 0.3); break;
      case 'hurt': this.noiseBurst(o, t, 0.12, 'lowpass', 500, 0, 0.9); this.tone(o, t, 0.12, 'sine', 120, 60, 0.6); break;
      case 'armor': this.noiseBurst(o, t, 0.05, 'highpass', 2200, 0, 0.35); break;
      case 'clipout': this.tone(o, t, 0.03, 'square', 700, 0, 0.15); this.noiseBurst(o, t, 0.05, 'bandpass', 1500, 2, 0.4); break;
      case 'clipin': this.tone(o, t, 0.03, 'square', 1100, 0, 0.15); this.noiseBurst(o, t, 0.06, 'bandpass', 2400, 2, 0.5); break;
      case 'empty': this.tone(o, t, 0.02, 'square', 1500, 0, 0.12); break;
      case 'deploy': this.noiseBurst(o, t, 0.08, 'bandpass', 1200, 2, 0.3); break;
      case 'buy': this.tone(o, t, 0.06, 'triangle', 880, 0, 0.2); this.tone(o, t + 0.06, 0.08, 'triangle', 1320, 0, 0.2); break;
      case 'deny': this.tone(o, t, 0.12, 'square', 180, 0, 0.12); break;
      case 'beep': this.tone(o, t, 0.09, 'sine', 2100, 2050, 0.35); break;
      case 'plantkey': this.tone(o, t, 0.05, 'square', 900 + Math.random() * 600, 0, 0.08); break;
      case 'defuse': this.noiseBurst(o, t, 0.04, 'bandpass', 3000, 3, 0.3); break;
      case 'explode':
        this.noiseBurst(o, t, 2.6, 'lowpass', 900, 0, 1.6, 80); this.tone(o, t, 1.8, 'sine', 70, 25, 1.2);
        this.noiseBurst(o, t, 0.25, 'highpass', 1000, 0, 0.8); break;
      case 'death': this.noiseBurst(o, t, 0.25, 'lowpass', 400, 0, 0.5); break;
      case 'he': this.noiseBurst(o, t, 1.2, 'lowpass', 1400, 0, 1.4, 120); this.tone(o, t, 0.8, 'sine', 90, 30, 1.0); this.noiseBurst(o, t, 0.12, 'highpass', 1500, 0, 0.7); break;
      case 'flashbang': this.noiseBurst(o, t, 0.35, 'highpass', 1800, 0, 1.2); this.tone(o, t, 0.2, 'sine', 160, 60, 0.7); break;
      case 'smokepop': this.noiseBurst(o, t, 2.4, 'bandpass', 900, 0.6, 0.5, 300); break;
      case 'bounce': this.tone(o, t, 0.04, 'triangle', 1300 + Math.random() * 400, 0, 0.12); break;
      case 'pin': this.tone(o, t, 0.05, 'square', 2400, 0, 0.06); this.noiseBurst(o, t + 0.05, 0.05, 'bandpass', 3000, 3, 0.25); break;
      case 'throw': this.noiseBurst(o, t, 0.18, 'bandpass', 700, 1, 0.35, 2400); break;
      case 'pickup': this.noiseBurst(o, t, 0.1, 'bandpass', 1400, 2, 0.4); this.tone(o, t + 0.05, 0.04, 'square', 900, 0, 0.08); break;
      case 'ring': this.tone(this.master, t, 3, 'sine', 3300, 3200, 0.12); break;
      case 'go': this.tone(o, t, 0.1, 'square', 660, 0, 0.1); this.tone(o, t + 0.13, 0.15, 'square', 990, 0, 0.1); break;
      case 'win': [523, 659, 784].forEach((f, i) => this.tone(o, t + i * 0.12, 0.35, 'triangle', f, 0, 0.25)); break;
      case 'lose': [440, 370, 294].forEach((f, i) => this.tone(o, t + i * 0.14, 0.35, 'triangle', f, 0, 0.22)); break;
      case 'planted': [880, 880, 1320].forEach((f, i) => this.tone(o, t + i * 0.15, 0.1, 'square', f, 0, 0.12)); break;
    }
  },
};

// ============================== GAME STATE ==============================
const G = {
  state: 'menu', paused: false, time: 0, menuT: 0,
  playerTeam: 'T', difficulty: 1, winRounds: 8, quality: 480, sens: 1,
  phase: 'freeze', phaseT: 0, roundT: 0, round: 0,
  score: { T: 0, CT: 0 }, lossStreak: { T: 0, CT: 0 },
  agents: [], player: null, particles: [], killfeed: [], nades: [], smokes: [], drops: [], halftimeDone: false, lastHitSfx: 0,
  bomb: { state: 'carried', carrier: null, x: 0, y: 0, timer: 0, beepT: 0, site: null, defuser: null, progress: 0 },
  tSite: 'A', intel: { A: -99, B: -99 }, msg: { text: '', sub: '', t: 0, cls: '' },
  buyOpen: false, boardOpen: false, shake: 0, flash: 0, specIdx: 0, dmgDirT: 0, buyCat: null,
};
const D = () => DIFF[G.difficulty];
const CAM = { x: 33, y: 6.5, a: 0, pitch: 0, z: EYE_STAND, fov: BASE_FOV };

const BOT_NAMES = { T: ['Viper', 'Rook', 'Nomad', 'Ash', 'Kestrel'], CT: ['Hawk', 'Mason', 'Echo', 'Frost', 'Bishop'] };
let nextId = 1;
function makeAgent(team, name, isPlayer) {
  return {
    id: nextId++, team, name, isPlayer,
    x: 0, y: 0, a: 0, pitch: 0, vx: 0, vy: 0, alive: false,
    hp: 100, armor: 0, helmet: false, kit: false, money: START_MONEY, kills: 0, deaths: 0, dmgDealt: 0,
    inv: null, ammo: {}, slot: 'secondary', lastSlot: 'knife',
    fireCd: 0, reloadT: 0, switchT: 0, flashT: 0, shots: 0, lastShot: -9,
    eyeZ: EYE_STAND, jumpZ: 0, vz: 0, onGround: true, crouch: false, walking: false, zoom: 0,
    punchP: 0, punchY: 0, kickP: 0, vmKick: 0, bob: 0, swayX: 0, swayY: 0, knifeT: 0,
    planting: 0, defusing: false, hurtT: 0, walkPhase: 0, stepAcc: 0, spottedT: -99,
    nades: { he: 0, flash: 0, smoke: 0 }, blindT: 0, tagT: 0, throwT: 0, nadeAt: 0, nadeX: 0, nadeY: 0, nadePref: NADES, lastNadeT: -99, flashImmuneT: 0,
    // bot brain
    plan: '', goalX: 0, goalY: 0, lookX: null, lookY: null, path: null, pi: 0, pathKey: '', repathT: 0,
    target: null, reactT: 0, burst: 0, burstLen: 4, thinkT: Math.random() * 0.12, alertX: 0, alertY: 0, alertT: 0,
    stageUntil: 0, holdSite: null, rotateAt: 0, stuckT: 0, lastX: 0, lastY: 0, lostT: 0, lastSeenX: 0, lastSeenY: 0, strafe: 0, strafeT: 0,
    frame: null, deathT: 0, killer: null,
  };
}
const curWeapon = (a) => a.inv[a.slot] || a.inv.secondary || 'knife';
const alive = (team) => G.agents.filter((a) => a.alive && (!team || a.team === team));
const nadeCount = (a) => a.nades.he + a.nades.flash + a.nades.smoke;
// next grenade type the agent owns, starting after `after`
function nextNade(a, after) {
  const start = after ? NADES.indexOf(after) + 1 : 0;
  for (let i = 0; i < 3; i++) { const k = NADES[(start + i) % 3]; if (a.nades[k] > 0) return k; }
  return null;
}

// ============================== RAYCASTING =============================
let W = 480, H = 270, imgData = null, buf32 = null, zbuf = null;
const view = $('view'), vctx = view.getContext('2d', { alpha: false });
const fx = $('fx'), fxCtx = fx.getContext('2d');
const R = { x: 0, y: 0, z: 1, a: 0, dirX: 1, dirY: 0, plX: 0, plY: 1, pl: 1, f: 240, hor: 135 };
const RAY = { perp: 0, side: 0, id: -1, wallX: 0, mx: 0, my: 0 };

function resizeView() {
  W = G.quality;
  H = clamp(Math.round((W * innerHeight) / innerWidth), 120, W) & ~1;
  view.width = W; view.height = H;
  imgData = vctx.createImageData(W, H);
  buf32 = new Uint32Array(imgData.data.buffer);
  zbuf = new Float32Array(W);
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  fx.width = Math.round(innerWidth * dpr); fx.height = Math.round(innerHeight * dpr);
}

// DDA grid walk: first wall along ray (px,py)+t*(rdx,rdy). perp = t at the hit.
function castRay(px, py, rdx, rdy) {
  let mx = px | 0, my = py | 0;
  const ddx = rdx === 0 ? 1e30 : Math.abs(1 / rdx), ddy = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
  let stepX, stepY, sdx, sdy;
  if (rdx < 0) { stepX = -1; sdx = (px - mx) * ddx; } else { stepX = 1; sdx = (mx + 1 - px) * ddx; }
  if (rdy < 0) { stepY = -1; sdy = (py - my) * ddy; } else { stepY = 1; sdy = (my + 1 - py) * ddy; }
  let side = 0, id = 0;
  for (let i = 0; i < 96; i++) {
    if (sdx < sdy) { sdx += ddx; mx += stepX; side = 0; } else { sdy += ddy; my += stepY; side = 1; }
    if (mx < 0 || my < 0 || mx >= MAP_W || my >= MAP_H) { id = 0; break; }
    const w = wallMap[my * MAP_W + mx];
    if (w >= 0) { id = w; break; }
  }
  const perp = Math.max(side === 0 ? sdx - ddx : sdy - ddy, 0.0001);
  let wx = side === 0 ? py + perp * rdy : px + perp * rdx;
  wx -= Math.floor(wx);
  if ((side === 0 && rdx > 0) || (side === 1 && rdy < 0)) wx = 1 - wx;
  RAY.perp = perp; RAY.side = side; RAY.id = id; RAY.wallX = wx; RAY.mx = mx; RAY.my = my;
  return RAY;
}
// Line of sight through the grid (exact cell traversal)
function los(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  let mx = x0 | 0, my = y0 | 0;
  const ex = x1 | 0, ey = y1 | 0;
  const ddx = dx === 0 ? 1e30 : Math.abs(1 / dx), ddy = dy === 0 ? 1e30 : Math.abs(1 / dy);
  const stepX = dx < 0 ? -1 : 1, stepY = dy < 0 ? -1 : 1;
  let sdx = dx < 0 ? (x0 - mx) * ddx : (mx + 1 - x0) * ddx;
  let sdy = dy < 0 ? (y0 - my) * ddy : (my + 1 - y0) * ddy;
  for (let i = 0; i < 128; i++) {
    if (mx === ex && my === ey) return true;
    if (sdx < sdy) { if (sdx > 1) return true; sdx += ddx; mx += stepX; } else { if (sdy > 1) return true; sdy += ddy; my += stepY; }
    if (isWall(mx, my)) return false;
  }
  return true;
}

// shade (0..256) then mix toward fog (0..256)
function shadeFog(c, s, f) {
  let r = ((c & 255) * s) >> 8, g = (((c >> 8) & 255) * s) >> 8, b = (((c >> 16) & 255) * s) >> 8;
  if (f) { r += ((FOG_R - r) * f) >> 8; g += ((FOG_G - g) * f) >> 8; b += ((FOG_B - b) * f) >> 8; }
  return 0xff000000 | (b << 16) | (g << 8) | r;
}
const fogAt = (d) => (clamp((d - 7) / 38, 0, 0.6) * 256) | 0;

function setupCamera(cam) {
  R.x = cam.x; R.y = cam.y; R.z = cam.z; R.a = cam.a;
  R.dirX = Math.cos(cam.a); R.dirY = Math.sin(cam.a);
  R.pl = Math.tan(cam.fov / 2);
  R.plX = -R.dirY * R.pl; R.plY = R.dirX * R.pl;
  R.f = W / 2 / R.pl;
  R.hor = Math.round(H / 2 + Math.tan(cam.pitch) * R.f);
}

function drawSkyAndFloor() {
  const sky = TEX.sky, floors = TEX.floors, hor = R.hor;
  const K = (SKY_W * 2) / TAU;
  const halfAng = Math.atan(R.pl);
  const u0 = (R.a - halfAng) * K, du = (2 * halfAng * K) / W;
  const rdx0 = R.dirX - R.plX, rdy0 = R.dirY - R.plY;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    if (y < hor) {
      let v = SKY_H - 1 - (((hor - y) * 0.6 * SKY_H) / (H * 0.5)) | 0;
      if (v < 0) v = 0;
      const srow = v * SKY_W;
      let u = u0;
      for (let x = 0; x < W; x++) { buf32[row + x] = sky[srow + ((u | 0) & (SKY_W - 1))]; u += du; }
    } else {
      const rowDist = (R.z * R.f) / (y - hor + 0.5);
      const fog = fogAt(rowDist);
      const sx = (rowDist * 2 * R.plX) / W, sy = (rowDist * 2 * R.plY) / W;
      let fx0 = R.x + rowDist * rdx0, fy0 = R.y + rowDist * rdy0;
      for (let x = 0; x < W; x++) {
        const cx = fx0 | 0, cy = fy0 | 0;
        const t = cx >= 0 && cy >= 0 && cx < MAP_W && cy < MAP_H ? floors[floorMap[cy * MAP_W + cx]] : floors[0];
        const c = t[(((fy0 * 64) | 0) & 63) * 64 + (((fx0 * 64) | 0) & 63)];
        buf32[row + x] = fog ? shadeFog(c, 256, fog) : c;
        fx0 += sx; fy0 += sy;
      }
    }
  }
}

function drawWalls() {
  const hor = R.hor, f = R.f;
  for (let x = 0; x < W; x++) {
    const camX = (2 * x) / W - 1;
    const rdx = R.dirX + R.plX * camX, rdy = R.dirY + R.plY * camX;
    castRay(R.x, R.y, rdx, rdy);
    const perp = RAY.perp;
    zbuf[x] = perp;
    const lh = f / perp;
    const top = hor - (WALL_H - R.z) * lh, bot = hor + R.z * lh;
    const y0 = Math.max(0, Math.ceil(top)), y1 = Math.min(H - 1, Math.floor(bot));
    if (y1 < y0) continue;
    const tex = TEX.walls[RAY.id];
    const texX = (RAY.wallX * 64) | 0;
    // fake sun: each face direction gets its own brightness
    const s = RAY.side === 0 ? (rdx > 0 ? 176 : 256) : rdy > 0 ? 214 : 236;
    const fog = fogAt(perp);
    const vStep = 128 / (bot - top);
    let v = (y0 - top) * vStep;
    for (let y = y0; y <= y1; y++) {
      buf32[y * W + x] = shadeFog(tex[(((v | 0) & 127) << 6) + texX], s, fog);
      v += vStep;
    }
  }
}

// camera-space projection of a world point
function project(wx, wy) {
  const sx = wx - R.x, sy = wy - R.y;
  const depth = R.dirX * sx + R.dirY * sy;
  const lat = R.dirX * sy - R.dirY * sx;
  return { depth, screenX: W / 2 + (R.f * lat) / depth };
}
function drawSprite(tex, tw, th, wx, wy, worldW, worldH, zBase, shade) {
  const p = project(wx, wy);
  if (p.depth <= 0.1) return null;
  const scale = R.f / p.depth;
  const sw = worldW * scale, sh = worldH * scale;
  const left = p.screenX - sw / 2, top = R.hor - (zBase + worldH - R.z) * scale;
  const x0 = Math.max(0, Math.ceil(left)), x1 = Math.min(W - 1, Math.floor(left + sw));
  const y0 = Math.max(0, Math.ceil(top)), y1 = Math.min(H - 1, Math.floor(top + sh));
  const fog = fogAt(p.depth);
  for (let x = x0; x <= x1; x++) {
    if (p.depth >= zbuf[x]) continue;
    const u = Math.min(tw - 1, (((x - left) / sw) * tw) | 0);
    for (let y = y0; y <= y1; y++) {
      const v = Math.min(th - 1, (((y - top) / sh) * th) | 0);
      const c = tex[v * tw + u];
      if (c >>> 24 < 128) continue;
      buf32[y * W + x] = shadeFog(c, shade, fog);
    }
  }
  return { left, top, sw, sh, depth: p.depth };
}
function drawParticle(pt) {
  const p = project(pt.x, pt.y);
  if (p.depth <= 0.1) return;
  const scale = R.f / p.depth;
  const k = pt.life / pt.max;
  const size = Math.max(1, pt.size * scale * (pt.grow ? 1.6 - k * 0.6 : k));
  const cx = p.screenX, cy = R.hor - (pt.z - R.z) * scale;
  const x0 = Math.max(0, (cx - size / 2) | 0), x1 = Math.min(W - 1, (cx + size / 2) | 0);
  const y0 = Math.max(0, (cy - size / 2) | 0), y1 = Math.min(H - 1, (cy + size / 2) | 0);
  const fog = fogAt(p.depth);
  for (let x = x0; x <= x1; x++) {
    if (p.depth >= zbuf[x] + 0.02) continue;
    for (let y = y0; y <= y1; y++) {
      if (pt.dither && ((x + y) & 1)) continue;
      buf32[y * W + x] = shadeFog(pt.color, 256, fog);
    }
  }
}

// soft smoke puff: alpha-blended disc that fades toward its edge
function drawPuff(pf, dens) {
  const p = project(pf.x, pf.y);
  if (p.depth <= 0.3) return;
  const scale = R.f / p.depth;
  const rad = Math.min(W, pf.size * scale * (0.5 + 0.5 * dens)) / 2;
  const cx = p.screenX, cy = R.hor - (pf.z - R.z) * scale;
  const x0 = Math.max(0, (cx - rad) | 0), x1 = Math.min(W - 1, (cx + rad) | 0);
  const y0 = Math.max(0, (cy - rad) | 0), y1 = Math.min(H - 1, (cy + rad) | 0);
  const cr = (178 * pf.shade) | 0, cg = (176 * pf.shade) | 0, cb = (170 * pf.shade) | 0;
  const inv = 1 / (rad * rad), A = 0.92 * dens;
  for (let x = x0; x <= x1; x++) {
    if (p.depth >= zbuf[x] + 0.3) continue;
    const dx = x - cx;
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy, q = (dx * dx + dy * dy) * inv;
      if (q >= 1) continue;
      const al = (A * (1 - q) * 256) | 0, i = y * W + x, c = buf32[i];
      const r = c & 255, g = (c >> 8) & 255, b = (c >> 16) & 255;
      buf32[i] = 0xff000000 | ((b + (((cb - b) * al) >> 8)) << 16) | ((g + (((cg - g) * al) >> 8)) << 8) | (r + (((cr - r) * al) >> 8));
    }
  }
}
// standing inside a smoke: wash the whole view grey
function smokeOverlay() {
  let k = 0;
  for (const s of G.smokes) {
    const d = Math.hypot(s.x - R.x, s.y - R.y);
    k = Math.max(k, clamp((s.r * 0.95 - d) / (s.r * 0.5), 0, 1) * smokeDensity(s));
  }
  if (k <= 0) return;
  const al = (Math.min(0.97, k) * 256) | 0;
  for (let i = 0; i < buf32.length; i++) {
    const c = buf32[i], r = c & 255, g = (c >> 8) & 255, b = (c >> 16) & 255;
    buf32[i] = 0xff000000 | ((b + (((160 - b) * al) >> 8)) << 16) | ((g + (((166 - g) * al) >> 8)) << 8) | (r + (((168 - r) * al) >> 8));
  }
}

const spriteList = [];
function render3D() {
  setupCamera(CAM);
  drawSkyAndFloor();
  drawWalls();
  spriteList.length = 0;
  const viewer = cameraOwner();
  for (const a of G.agents) {
    if (a === viewer || (!a.alive && !a.deathT)) continue;
    const dx = a.x - R.x, dy = a.y - R.y;
    spriteList.push({ kind: 'agent', a, d: dx * dx + dy * dy });
  }
  const b = G.bomb;
  if (G.state === 'playing' && (b.state === 'dropped' || b.state === 'planted' || b.state === 'defused')) spriteList.push({ kind: 'bomb', d: (b.x - R.x) ** 2 + (b.y - R.y) ** 2 });
  for (const pt of G.particles) spriteList.push({ kind: 'pt', pt, d: (pt.x - R.x) ** 2 + (pt.y - R.y) ** 2 });
  if (G.state === 'playing') {
    for (const n of G.nades) spriteList.push({ kind: 'nade', n, d: (n.x - R.x) ** 2 + (n.y - R.y) ** 2 });
    for (const dr of G.drops) spriteList.push({ kind: 'drop', dr, d: (dr.x - R.x) ** 2 + (dr.y - R.y) ** 2 });
    for (const sm of G.smokes) {
      const dens = smokeDensity(sm);
      for (const pf of sm.puffs) if (sm.t > pf.delay) spriteList.push({ kind: 'puff', pf, dens: dens * clamp((sm.t - pf.delay) / 0.8, 0, 1), d: (pf.x - R.x) ** 2 + (pf.y - R.y) ** 2 });
    }
  }
  spriteList.sort((p, q) => q.d - p.d);
  for (const s of spriteList) {
    if (s.kind === 'pt') { drawParticle(s.pt); continue; }
    if (s.kind === 'puff') { drawPuff(s.pf, s.dens); continue; }
    if (s.kind === 'nade') { drawSprite(TEX.nade[s.n.type], 12, 12, s.n.x, s.n.y, 0.13, 0.13, s.n.z - 0.06, 256); continue; }
    if (s.kind === 'drop') { const m = TEX.drop[WEAPONS[s.dr.key].kind] || TEX.drop.rifle; drawSprite(m, 64, 20, s.dr.x, s.dr.y, 0.8, 0.25, 0, 240); continue; }
    if (s.kind === 'bomb') {
      const blink = b.state === 'planted' && b.timer % Math.max(0.15, b.timer / 40) < 0.08 ? 1 : 0;
      drawSprite(TEX.bomb[blink], 32, 20, b.x, b.y, 0.42, 0.26, 0, 256);
      continue;
    }
    const a = s.a;
    if (!a.alive) { a.frame = null; drawSprite(TEX.dead[a.team], 128, 48, a.x, a.y, DEAD_W, DEAD_H, 0, 220); continue; }
    const set = TEX.soldier[a.team];
    const tcx = R.x - a.x, tcy = R.y - a.y, tl = Math.hypot(tcx, tcy) || 1;
    const fx_ = Math.cos(a.a), fy_ = Math.sin(a.a);
    const toCam = (fx_ * tcx + fy_ * tcy) / tl; // 1 = looking at us
    const toRight = -fx_ * R.dirY + fy_ * R.dirX; // >0 = facing screen-right
    const moving = Math.hypot(a.vx, a.vy) > 0.4;
    const step = moving ? ((a.walkPhase | 0) % 2 ? 1 : 2) : 0;
    const shooting = a.flashT > 0;
    let frame;
    if (toCam > 0.62) frame = shooting ? set.fs : step === 1 ? set.f1 : step === 2 ? set.f2 : set.f0;
    else if (toCam < -0.62) frame = step === 1 ? set.b1 : step === 2 ? set.b2 : set.b0;
    else {
      const p = toRight > 0 ? 's' : 'm';
      frame = shooting ? set[p + 's'] : set[p + (step || 0)];
    }
    a.frame = frame;
    a.screen = drawSprite(frame, SPR_W, SPR_H, a.x, a.y, SOLDIER_W, SOLDIER_H, 0, a.hurtFlash > 0 ? 330 : 256);
  }
  if (G.state === 'playing') smokeOverlay();
  vctx.putImageData(imgData, 0, 0);
}

// ============================== VIEWMODEL ==============================
// Guns are drawn as layered 2D shapes in "gun space" (x < 0 points toward the muzzle),
// then rotated + squashed into the bottom-right corner and given one shared lighting pass.
function P(c, pts, fill) {
  c.beginPath(); c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.closePath(); c.fillStyle = fill; c.fill();
}
function vgrad(c, y0, y1, a, b, mid) {
  const g = c.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, a); if (mid) g.addColorStop(0.45, mid); g.addColorStop(1, b);
  return g;
}
function L(c, x0, y0, x1, y1, color, w) { c.strokeStyle = color; c.lineWidth = w || 2; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
const hl = (c, x0, y0, x1, y1, a = 0.3, w = 2) => L(c, x0, y0, x1, y1, `rgba(255,255,255,${a})`, w); // edge highlight
const dk = (c, x0, y0, x1, y1, a = 0.45, w = 2) => L(c, x0, y0, x1, y1, `rgba(0,0,0,${a})`, w); // panel line
function dot(c, x, y, r, fill) { c.fillStyle = fill; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); }
function rr(c, x, y, w, h, r, fill) { c.fillStyle = fill; c.beginPath(); c.roundRect(x, y, w, h, r); c.fill(); }
// wood grain: wavy dark streaks clipped to a polygon
function grain(c, pts, x0, x1, y0, y1, seed) {
  c.save(); c.beginPath(); c.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); c.closePath(); c.clip();
  const rng = mulberry32(seed);
  c.strokeStyle = 'rgba(40,18,6,0.35)'; c.lineWidth = 1.5;
  for (let y = y0; y < y1; y += 5 + rng() * 5) {
    c.beginPath(); c.moveTo(x0, y);
    for (let x = x0; x <= x1; x += 30) c.lineTo(x, y + Math.sin(x * 0.02 + rng() * 6) * 3);
    c.stroke();
  }
  c.restore();
}
const SLEEVE = { T: ['#665e45', '#4a4432', '#35301f'], CT: ['#34476a', '#25344f', '#1a2539'] };
const GLOVE = { T: ['#3a332c', '#231f1b'], CT: ['#26282d', '#131417'] };
// forearm from hand (hx,hy) out of the screen to the elbow (ex,ey)
function arm(c, hx, hy, ex, ey, width, team) {
  const [sl, sm, sd] = SLEEVE[team], [gl, gd] = GLOVE[team];
  const ang = Math.atan2(ey - hy, ex - hx), nx = -Math.sin(ang) * width * 0.5, ny = Math.cos(ang) * width * 0.5;
  const g = c.createLinearGradient(hx + nx, hy + ny, hx - nx, hy - ny);
  g.addColorStop(0, sl); g.addColorStop(0.55, sm); g.addColorStop(1, sd);
  // sleeve, widening toward the elbow
  const cx = hx + (ex - hx) * 0.22, cy = hy + (ey - hy) * 0.22;
  P(c, [cx + nx * 0.85, cy + ny * 0.85, ex + nx * 1.25, ey + ny * 1.25, ex - nx * 1.25, ey - ny * 1.25, cx - nx * 0.85, cy - ny * 0.85], g);
  // fabric folds
  for (let k = 0.35; k < 0.9; k += 0.17) {
    const fx = hx + (ex - hx) * k, fy = hy + (ey - hy) * k;
    L(c, fx + nx * 0.9, fy + ny * 0.9, fx + nx * 0.2 + (ex - hx) * 0.03, fy + ny * 0.2 + (ey - hy) * 0.03, 'rgba(0,0,0,0.22)', 3);
  }
  // cuff
  P(c, [cx + nx * 0.9, cy + ny * 0.9, cx + nx * 0.9 + (ex - hx) * 0.06, cy + ny * 0.9 + (ey - hy) * 0.06, cx - nx * 0.9 + (ex - hx) * 0.06, cy - ny * 0.9 + (ey - hy) * 0.06, cx - nx * 0.9, cy - ny * 0.9], sd);
  // wrist + back of the glove
  const wg = c.createLinearGradient(hx + nx, hy + ny, hx - nx, hy - ny); wg.addColorStop(0, gl); wg.addColorStop(1, gd);
  P(c, [hx + nx * 0.62, hy + ny * 0.62, cx + nx * 0.8, cy + ny * 0.8, cx - nx * 0.8, cy - ny * 0.8, hx - nx * 0.62, hy - ny * 0.62], wg);
  c.fillStyle = wg; c.beginPath(); c.ellipse(hx, hy, width * 0.5, width * 0.38, ang, 0, TAU); c.fill();
  // knuckles
  for (let i = -1.5; i <= 1.5; i++) dot(c, hx + nx * i * 0.32 - Math.cos(ang) * width * 0.28, hy + ny * i * 0.32 - Math.sin(ang) * width * 0.28, width * 0.1, 'rgba(255,255,255,0.07)');
  c.fillStyle = 'rgba(255,255,255,0.1)'; c.beginPath(); c.ellipse(hx - 4, hy - 7, width * 0.26, width * 0.12, ang, 0, TAU); c.fill();
}
// fingers wrapped around a handguard from y0 (top) to y1 (bottom)
function fingers(c, x, y0, y1, team) {
  const [gl, gd] = GLOVE[team];
  for (let i = 0; i < 4; i++) {
    const fx = x - 30 + i * 14, h = y1 - y0 + 8;
    rr(c, fx, y0 - 2 + i, 13, h - i * 1.5, 6, vgrad(c, y0, y0 + h, gl, gd));
    hl(c, fx + 3, y0 + 2 + i, fx + 3, y0 + h - 6, 0.1, 2);
  }
  rr(c, x + 24, y0 - 6, 18, 14, 6, gd); // thumb over the top
}

const MODELS = {
  ak(c, t) {
    arm(c, 25, 28, 170, 340, 74, t);
    const stock = [55, -32, 210, -14, 220, 44, 150, 48, 55, 6];
    P(c, stock, vgrad(c, -30, 48, '#9a6436', '#4a2b14', '#7a4a24')); grain(c, stock, 50, 230, -35, 50, 3);
    hl(c, 58, -31, 208, -14, 0.25); P(c, [205, -15, 222, -13, 230, 44, 214, 45], '#2b2b2b'); // butt plate
    P(c, [-150, -44, 60, -40, 60, 2, -150, -4], vgrad(c, -44, 2, '#55565a', '#1a1a1c', '#38393c'));
    hl(c, -150, -43, 60, -39, 0.35); dk(c, -60, -36, 58, -33, 0.35); // dust cover seam
    for (let x = 18; x < 56; x += 7) dk(c, x, -38, x, -30, 0.4, 1.5); // rear ribs
    P(c, [-70, -30, 20, -26, 22, -19, -70, -23], '#2a2a2c'); hl(c, -70, -29, 20, -25, 0.2, 1); // selector lever
    for (const [x, y] of [[-135, -14], [-100, -12], [-30, -12], [40, -10]]) dot(c, x, y, 3, '#151516');
    P(c, [-2, 0, 30, 0, 48, 62, 16, 66], vgrad(c, 0, 66, '#5a3a20', '#24160c'));
    c.strokeStyle = '#18181a'; c.lineWidth = 5; c.beginPath(); c.moveTo(-40, 0); c.quadraticCurveTo(-30, 32, 0, 22); c.stroke(); // trigger guard
    const mag = [-118, -4, -72, -4, -54, 48, -72, 104, -114, 98, -108, 42];
    P(c, mag, vgrad(c, -4, 104, '#b0612c', '#5a2a10', '#8a4418'));
    for (let k = 0.2; k < 0.95; k += 0.15) dk(c, -114 + k * 4, -4 + k * 102, -70 + k * -4, -4 + k * 104 - (k > 0.5 ? 8 : 0), 0.3, 2);
    hl(c, -116, 0, -110, 90, 0.18, 3);
    const hg = [-335, -36, -150, -42, -150, -6, -335, -14];
    P(c, hg, vgrad(c, -42, -6, '#a56a38', '#55301a', '#80501e')); grain(c, hg, -340, -145, -45, -2, 7);
    hl(c, -335, -35, -150, -41, 0.25); P(c, [-160, -44, -148, -44, -148, -4, -160, -5], '#1d1d1e'); P(c, [-340, -38, -328, -38, -328, -12, -340, -13], '#1d1d1e');
    P(c, [-330, -46, -150, -54, -150, -44, -330, -38], vgrad(c, -54, -38, '#4a4a4c', '#18181a')); hl(c, -330, -45, -150, -53, 0.3, 1.5); // gas tube
    P(c, [-150, -46, -112, -48, -112, -60, -150, -58], '#252527'); P(c, [-140, -60, -124, -60, -124, -66, -140, -66], '#1a1a1b'); // rear sight
    P(c, [-478, -31, -335, -34, -335, -19, -478, -22], vgrad(c, -34, -19, '#3c3c3e', '#101011')); hl(c, -478, -30, -335, -33, 0.3, 1.5);
    P(c, [-457, -31, -442, -31, -444, -54, -455, -54], '#1b1b1c'); c.strokeStyle = '#1b1b1c'; c.lineWidth = 3; c.beginPath(); c.arc(-449, -50, 9, Math.PI, TAU); c.stroke(); // front sight + hood
    P(c, [-494, -35, -470, -35, -470, -18, -490, -18], '#0f0f10'); dk(c, -486, -33, -480, -20, 0.8, 3); // slant brake
    arm(c, -250, -8, -175, 360, 82, t);
    fingers(c, -250, -27, -3, t);
  },
  galil(c, t) {
    arm(c, 25, 28, 170, 340, 74, t);
    // skeleton folding stock
    c.strokeStyle = '#1c1c1e'; c.lineWidth = 12; c.beginPath(); c.moveTo(58, -26); c.lineTo(214, -10); c.lineTo(218, 40); c.lineTo(150, 24); c.stroke();
    hl(c, 60, -30, 212, -15, 0.2);
    P(c, [-160, -46, 62, -42, 62, 2, -160, -2], vgrad(c, -46, 2, '#4d4a42', '#1a1916', '#35332d'));
    hl(c, -160, -45, 62, -41, 0.32); dk(c, -70, -36, 60, -33, 0.35);
    P(c, [-110, -60, -20, -58, -20, -46, -110, -48], '#262624'); // carry handle base
    P(c, [-2, 0, 30, 0, 46, 62, 16, 66], vgrad(c, 0, 66, '#2b2a26', '#111'));
    const mag = [-120, -2, -78, -2, -66, 50, -76, 100, -116, 96, -112, 44];
    P(c, mag, vgrad(c, -2, 100, '#36352f', '#141412')); hl(c, -117, 2, -112, 90, 0.15, 3);
    P(c, [-345, -40, -160, -46, -160, -4, -345, -12], vgrad(c, -46, -4, '#2c2b27', '#0f0f0e'));
    for (let x = -330; x < -175; x += 20) P(c, [x, -30, x + 10, -31, x + 10, -20, x, -19], '#0a0a09'); // vents
    hl(c, -345, -39, -160, -45, 0.2);
    P(c, [-470, -31, -345, -33, -345, -20, -470, -22], vgrad(c, -33, -20, '#3a3a3a', '#101010'));
    P(c, [-450, -31, -440, -31, -442, -56, -449, -56], '#1a1a1a');
    P(c, [-492, -34, -468, -34, -468, -19, -492, -19], '#0d0d0d');
    arm(c, -255, -10, -175, 360, 82, t);
    fingers(c, -255, -29, -4, t);
  },
  m4(c, t) {
    arm(c, 25, 28, 170, 340, 74, t);
    P(c, [60, -30, 120, -30, 120, -18, 60, -18], '#1d1e20'); // buffer tube
    P(c, [110, -42, 215, -30, 225, 40, 150, 46, 112, 0], vgrad(c, -40, 46, '#45474c', '#141517', '#2a2c30'));
    for (let k = 0; k < 3; k++) dk(c, 125 + k * 25, -36 + k * 2, 140 + k * 25, 40, 0.3, 2);
    hl(c, 112, -41, 214, -30, 0.25);
    P(c, [-150, -46, 62, -42, 62, 2, -150, -2], vgrad(c, -46, 2, '#50535a', '#17181a', '#33363b'));
    hl(c, -150, -45, 62, -41, 0.35); dk(c, -100, -24, 55, -20, 0.3);
    dot(c, -10, -22, 7, '#2a2c30'); dot(c, -10, -22, 3, '#111'); // forward assist
    P(c, [-140, -60, 20, -58, 20, -46, -140, -48], '#26282c');
    for (let i = -132; i < 14; i += 12) P(c, [i, -66, i + 7, -66, i + 7, -59, i, -59], '#34363b'); // rail
    P(c, [-40, -84, 10, -82, 10, -64, -40, -66], vgrad(c, -84, -64, '#2e3034', '#141518')); dot(c, -15, -74, 6, 'rgba(255,80,60,0.85)'); // red dot sight
    P(c, [-2, 0, 30, 0, 46, 60, 16, 64], vgrad(c, 0, 64, '#2a2b2f', '#0f1011'));
    for (let y = 12; y < 58; y += 9) dk(c, 6 + y * 0.3, y, 30 + y * 0.28, y, 0.4, 1.5); // grip texture
    c.strokeStyle = '#16171a'; c.lineWidth = 5; c.beginPath(); c.moveTo(-40, 0); c.quadraticCurveTo(-30, 30, 0, 22); c.stroke();
    P(c, [-112, -2, -74, -2, -72, 96, -110, 94], vgrad(c, -2, 96, '#45474b', '#18191b')); hl(c, -110, 2, -108, 90, 0.2, 3);
    for (let y = 20; y < 90; y += 14) dk(c, -110, y, -73, y, 0.25, 1.5);
    P(c, [-340, -40, -150, -46, -150, -4, -340, -12], vgrad(c, -46, -4, '#44474d', '#121315', '#2a2d31'));
    for (let i = -330; i < -160; i += 22) P(c, [i, -44, i + 12, -45, i + 12, -38, i, -37], '#5c5f66');
    for (let i = -330; i < -170; i += 30) rr(c, i, -30, 16, 8, 4, '#0c0d0e');
    hl(c, -340, -39, -150, -45, 0.25);
    P(c, [-470, -30, -340, -32, -340, -20, -470, -22], vgrad(c, -32, -20, '#3a3c40', '#0e0f10'));
    P(c, [-432, -32, -418, -32, -420, -60, -428, -60], '#18191b');
    P(c, [-492, -33, -466, -33, -466, -19, -492, -19], '#0d0e0f'); for (let k = 0; k < 3; k++) dk(c, -488 + k * 7, -32, -488 + k * 7, -21, 0.9, 2);
    arm(c, -255, -8, -175, 360, 82, t);
    fingers(c, -255, -30, -2, t);
  },
  famas(c, t) {
    arm(c, 35, 30, 175, 340, 74, t);
    // bullpup body: the action sits behind the grip
    P(c, [-280, -50, 230, -40, 236, 50, 120, 58, 60, 10, -280, -2], vgrad(c, -50, 58, '#55585e', '#16171a', '#30333a'));
    hl(c, -280, -49, 230, -39, 0.3); dk(c, 70, -30, 225, -26, 0.4);
    P(c, [80, 8, 130, 8, 140, 80, 96, 84], vgrad(c, 8, 84, '#2a2b2f', '#0e0f10')); // magazine behind the grip
    // long carry handle with the sights
    P(c, [-250, -60, 40, -56, 40, -48, -250, -52], '#24262a');
    P(c, [-250, -104, 60, -98, 60, -84, -250, -90], vgrad(c, -104, -84, '#3e4147', '#16171a')); hl(c, -250, -103, 60, -97, 0.3);
    P(c, [-250, -92, -230, -92, -230, -52, -250, -52], '#1f2024'); P(c, [30, -88, 52, -88, 52, -50, 30, -50], '#1f2024');
    P(c, [-10, 4, 24, 4, 40, 64, 10, 68], vgrad(c, 4, 68, '#2a2b2f', '#0f1011'));
    c.strokeStyle = '#121315'; c.lineWidth = 8; c.beginPath(); c.moveTo(-70, 2); c.quadraticCurveTo(-60, 40, 0, 40); c.stroke(); // big trigger guard
    P(c, [-460, -30, -280, -34, -280, -18, -460, -20], vgrad(c, -34, -18, '#3a3c40', '#0e0f10'));
    P(c, [-478, -33, -456, -33, -456, -17, -478, -17], '#0c0d0e');
    arm(c, -230, -2, -170, 360, 82, t);
    fingers(c, -230, -20, 2, t);
  },
  awp(c, t) {
    arm(c, 30, 26, 175, 340, 74, t);
    P(c, [40, -34, 230, -24, 236, 54, 170, 56, 120, 20, 60, 10], vgrad(c, -34, 56, '#6a7a4f', '#28301c', '#4b5736'));
    P(c, [90, 0, 150, 4, 160, 30, 120, 24], 'rgba(0,0,0,0.35)'); // thumbhole
    hl(c, 42, -33, 228, -23, 0.25);
    P(c, [-180, -44, 50, -40, 50, 4, -180, 0], vgrad(c, -44, 4, '#66754d', '#232a18', '#45502f'));
    hl(c, -180, -43, 50, -39, 0.3);
    P(c, [-20, -50, 40, -48, 40, -40, -20, -42], '#2a2b2d'); dot(c, 46, -46, 8, '#2a2b2d'); hl(c, -20, -49, 40, -47, 0.3, 1.5); // bolt
    // scope with rings and turrets
    P(c, [-150, -106, 30, -102, 30, -62, -150, -66], vgrad(c, -106, -62, '#34373a', '#08090a', '#1c1e20'));
    hl(c, -150, -104, 30, -100, 0.4, 2);
    P(c, [-190, -116, -140, -112, -140, -58, -190, -60], vgrad(c, -116, -58, '#2a2c2f', '#0b0c0d'));
    P(c, [20, -110, 56, -108, 56, -58, 20, -58], vgrad(c, -110, -58, '#2a2c2f', '#0b0c0d'));
    P(c, [-70, -124, -40, -124, -40, -104, -70, -104], '#1e1f21'); P(c, [-90, -66, -70, -66, -70, -44, -90, -44], '#151617');
    P(c, [-60, -40, -40, -40, -40, -66, -60, -66], '#151617');
    c.fillStyle = 'rgba(120,180,255,0.45)'; c.beginPath(); c.ellipse(-188, -87, 7, 25, 0, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.5)'; c.beginPath(); c.ellipse(-190, -96, 2, 7, 0, 0, TAU); c.fill();
    P(c, [-90, 2, -50, 2, -50, 40, -90, 38], '#1c1e1a');
    P(c, [-600, -32, -180, -36, -180, -18, -600, -24], vgrad(c, -36, -18, '#45484a', '#101112')); hl(c, -600, -31, -180, -35, 0.3, 1.5);
    P(c, [-628, -36, -596, -36, -596, -20, -628, -20], '#0d0e0f'); for (let k = 0; k < 3; k++) dk(c, -622 + k * 8, -35, -622 + k * 8, -21, 0.9, 2);
    P(c, [-360, -40, -180, -44, -180, 2, -340, -8], vgrad(c, -44, 2, '#66754d', '#28301c')); hl(c, -360, -39, -180, -43, 0.25);
    arm(c, -260, -6, -180, 360, 82, t);
    fingers(c, -262, -30, -2, t);
  },
  ssg(c, t) {
    arm(c, 30, 26, 175, 340, 74, t);
    P(c, [40, -30, 220, -22, 226, 44, 170, 48, 120, 16, 60, 8], vgrad(c, -30, 48, '#3c4248', '#14171a', '#262b30'));
    hl(c, 42, -29, 218, -21, 0.22);
    P(c, [-170, -40, 50, -36, 50, 2, -170, -2], vgrad(c, -40, 2, '#40464d', '#121417', '#2a2f35'));
    hl(c, -170, -39, 50, -35, 0.3);
    P(c, [-10, -46, 36, -44, 36, -38, -10, -40], '#2a2b2d'); dot(c, 42, -42, 7, '#2a2b2d');
    P(c, [-130, -90, 20, -86, 20, -58, -130, -62], vgrad(c, -90, -58, '#2e3134', '#08090a')); hl(c, -130, -89, 20, -85, 0.35, 2);
    P(c, [-160, -98, -122, -95, -122, -54, -160, -56], vgrad(c, -98, -54, '#2a2c2f', '#0b0c0d'));
    P(c, [12, -94, 40, -92, 40, -56, 12, -56], vgrad(c, -94, -56, '#2a2c2f', '#0b0c0d'));
    c.fillStyle = 'rgba(120,180,255,0.4)'; c.beginPath(); c.ellipse(-158, -76, 5, 18, 0, 0, TAU); c.fill();
    P(c, [-80, -62, -60, -62, -60, -40, -80, -40], '#151617'); P(c, [-30, -62, -10, -62, -10, -38, -30, -38], '#151617');
    P(c, [-560, -28, -170, -32, -170, -18, -560, -22], vgrad(c, -32, -18, '#45484a', '#101112'));
    for (let x = -540; x < -200; x += 40) hl(c, x, -27, x + 26, -27, 0.15, 1.5); // fluting
    P(c, [-576, -31, -556, -31, -556, -19, -576, -19], '#0d0e0f');
    P(c, [-330, -36, -170, -40, -170, 0, -310, -8], vgrad(c, -40, 0, '#3c4248', '#14171a'));
    arm(c, -250, -6, -178, 360, 80, t);
    fingers(c, -252, -28, -2, t);
  },
  smg(c, t) {
    arm(c, 25, 28, 170, 340, 74, t);
    P(c, [55, -26, 140, -22, 140, -10, 55, -12], '#1c1d1f'); hl(c, 55, -25, 140, -21, 0.2, 1.5);
    P(c, [130, -30, 150, -30, 160, 40, 140, 40], '#1c1d1f'); rr(c, 134, 30, 30, 14, 4, '#242528'); // retractable stock
    P(c, [-220, -44, 60, -40, 60, 4, -220, 0], vgrad(c, -44, 4, '#484a4e', '#141516', '#2c2e31'));
    hl(c, -220, -43, 60, -39, 0.32); dk(c, -150, -22, 55, -18, 0.35);
    P(c, [-60, -40, -20, -40, -20, -30, -60, -30], '#0a0a0b'); // ejection port
    P(c, [-160, -50, -150, -66, -40, -64, -30, -48], '#26272a'); // drum rear sight
    P(c, [-2, 2, 28, 2, 42, 58, 14, 62], vgrad(c, 2, 62, '#2a2b2e', '#0f1011'));
    c.strokeStyle = '#161719'; c.lineWidth = 5; c.beginPath(); c.moveTo(-34, 2); c.quadraticCurveTo(-26, 28, 0, 20); c.stroke();
    P(c, [-150, 0, -114, 0, -100, 46, -112, 90, -142, 86, -140, 40], vgrad(c, 0, 90, '#36383b', '#121314')); hl(c, -146, 4, -140, 80, 0.15, 3);
    P(c, [-300, -36, -220, -38, -220, -6, -300, -12], vgrad(c, -38, -6, '#36383c', '#111214'));
    for (let x = -294; x < -226; x += 12) dk(c, x, -34, x, -10, 0.5, 2);
    P(c, [-336, -30, -300, -31, -300, -18, -336, -19], '#0e0f10'); P(c, [-330, -32, -318, -32, -318, -52, -326, -52], '#1a1b1d');
    arm(c, -255, -6, -175, 360, 80, t);
    fingers(c, -258, -28, -4, t);
  },
  nova(c, t) {
    arm(c, 25, 28, 170, 340, 74, t);
    P(c, [50, -34, 215, -16, 225, 44, 150, 50, 110, 10, 50, 8], vgrad(c, -34, 50, '#3a3b3e', '#111214', '#26272a'));
    P(c, [210, -18, 226, -16, 232, 44, 218, 45], '#141414'); hl(c, 52, -33, 210, -17, 0.22);
    P(c, [-170, -48, 56, -44, 56, 6, -170, 2], vgrad(c, -48, 6, '#4a4c50', '#141517', '#2e3034'));
    hl(c, -170, -47, 56, -43, 0.32); dk(c, -100, -24, 50, -20, 0.4);
    P(c, [-60, -40, -10, -40, -10, -26, -60, -26], '#0a0a0b'); // loading port
    P(c, [-2, 2, 30, 2, 46, 60, 16, 64], vgrad(c, 2, 64, '#2b2c2f', '#0f1011'));
    c.strokeStyle = '#151618'; c.lineWidth = 5; c.beginPath(); c.moveTo(-36, 4); c.quadraticCurveTo(-28, 30, 0, 22); c.stroke();
    // barrel over the tube magazine
    P(c, [-560, -44, -170, -46, -170, -26, -560, -28], vgrad(c, -46, -26, '#45484c', '#111213')); hl(c, -560, -43, -170, -45, 0.35, 1.5);
    P(c, [-540, -24, -170, -24, -170, -4, -540, -8], vgrad(c, -24, -4, '#2c2e31', '#0c0d0e'));
    dot(c, -552, -34, 6, '#e3e3e3'); // bead sight
    P(c, [-566, -46, -556, -46, -556, -4, -566, -8], '#0c0d0e');
    // pump forend, ribbed
    const pump = [-330, -30, -200, -32, -200, 12, -330, 8];
    P(c, pump, vgrad(c, -32, 12, '#2a2b2e', '#0b0c0d'));
    for (let x = -322; x < -205; x += 11) dk(c, x, -28, x, 8, 0.55, 3);
    arm(c, -268, -2, -180, 360, 84, t);
    fingers(c, -268, -24, 6, t);
  },
  pistol(c, t) {
    arm(c, 10, 34, 140, 340, 76, t);
    P(c, [-5, -6, 30, -6, 52, 70, 18, 74], vgrad(c, -6, 74, '#2f3033', '#101113'));
    for (let y = 8; y < 66; y += 8) dk(c, 0 + y * 0.32, y, 28 + y * 0.32, y, 0.35, 1.5); // grip stippling
    P(c, [-175, -42, 40, -40, 40, -6, -175, -8], vgrad(c, -42, -6, '#45474b', '#141517', '#2c2e32'));
    hl(c, -175, -41, 40, -39, 0.4, 2);
    for (let i = 0; i < 6; i++) P(c, [10 + i * 5, -40, 13 + i * 5, -40, 13 + i * 5, -10, 10 + i * 5, -10], '#1d1e20'); // serrations
    P(c, [-70, -38, -20, -38, -20, -24, -70, -24], '#0b0b0c'); // ejection port
    P(c, [-150, -8, -10, -8, -10, 10, -150, 6], vgrad(c, -8, 10, '#2a2b2e', '#141517'));
    c.strokeStyle = '#141517'; c.lineWidth = 4; c.beginPath(); c.moveTo(-40, 8); c.quadraticCurveTo(-34, 30, -6, 24); c.stroke();
    P(c, [-176, -50, -166, -50, -166, -42, -176, -42], '#111'); P(c, [24, -50, 36, -50, 36, -42, 24, -42], '#111'); dot(c, -171, -47, 1.5, '#9fffa0');
    dot(c, -176, -24, 6, '#050505');
    arm(c, -10, 50, -60, 360, 78, t);
  },
  deagle(c, t) {
    arm(c, 15, 36, 140, 340, 78, t);
    P(c, [-4, -6, 34, -6, 56, 74, 20, 78], vgrad(c, -6, 78, '#3a3a3a', '#121212'));
    for (let y = 10; y < 70; y += 9) dk(c, 2 + y * 0.32, y, 32 + y * 0.32, y, 0.35, 1.5);
    P(c, [-215, -52, 46, -48, 46, -6, -215, -10], vgrad(c, -52, -6, '#ececea', '#5c5d60', '#a8a9ab'));
    hl(c, -215, -51, 46, -47, 0.7, 2); dk(c, -210, -28, 40, -25, 0.25, 2);
    P(c, [-215, -60, 30, -56, 30, -48, -215, -52], vgrad(c, -60, -48, '#c0c1c3', '#7a7b7d')); // top rib
    P(c, [-190, -10, -10, -8, -10, 12, -190, 8], vgrad(c, -10, 12, '#8c8d8f', '#4a4b4d'));
    for (let i = 0; i < 6; i++) P(c, [6 + i * 6, -48, 10 + i * 6, -48, 10 + i * 6, -10, 6 + i * 6, -10], '#6a6b6d');
    P(c, [-90, -46, -30, -46, -30, -30, -90, -30], '#2a2a2b');
    dot(c, -215, -30, 9, '#050505');
    c.strokeStyle = '#2a2a2a'; c.lineWidth = 4; c.beginPath(); c.moveTo(-44, 10); c.quadraticCurveTo(-36, 34, -6, 28); c.stroke();
    arm(c, -5, 54, -55, 360, 80, t);
  },
  knife(c, t) {
    arm(c, 30, 30, 160, 340, 76, t);
    P(c, [0, -14, 90, -18, 96, 16, 0, 14], vgrad(c, -18, 16, '#3a3a3a', '#0d0d0d'));
    for (let x = 12; x < 90; x += 10) dk(c, x, -14, x, 14, 0.5, 2);
    P(c, [-10, -30, 6, -30, 6, 28, -10, 28], vgrad(c, -30, 28, '#5a5a5c', '#1e1e20')); // guard
    P(c, [-10, -14, -230, -26, -272, -4, -230, 10, -10, 12], vgrad(c, -26, 12, '#f6f8fa', '#6e747a', '#c4c9ce'));
    P(c, [-10, 2, -230, 4, -270, -4, -230, 10, -10, 12], 'rgba(60,64,70,0.55)');
    hl(c, -12, -13, -228, -25, 0.8, 2); dk(c, -20, -2, -200, -6, 0.25, 2); // fuller
    for (let x = -60; x < -10; x += 8) P(c, [x, -14, x + 4, -20, x + 8, -14], '#8a9096'); // spine teeth
  },
};
// grenade held in the hand
function nadeModel(type) {
  return (c, t) => {
    arm(c, 40, 30, 170, 340, 80, t);
    if (type === 'he') {
      const g = c.createRadialGradient(-30, -60, 6, -10, -30, 70);
      g.addColorStop(0, '#9aa070'); g.addColorStop(0.5, '#5b6238'); g.addColorStop(1, '#262a14');
      c.fillStyle = g; c.beginPath(); c.ellipse(-12, -30, 52, 60, 0, 0, TAU); c.fill();
      c.save(); c.beginPath(); c.ellipse(-12, -30, 52, 60, 0, 0, TAU); c.clip();
      for (let y = -80; y < 30; y += 18) dk(c, -70, y, 50, y + 4, 0.35, 3);
      for (let x = -60; x < 40; x += 20) dk(c, x, -100, x + 6, 40, 0.3, 3);
      c.restore();
      P(c, [-34, -96, 10, -96, 10, -82, -34, -82], '#3b3c38');
    } else {
      const top = type === 'flash' ? ['#d4d6d8', '#6b6e72', '#a9acaf'] : ['#9aa59a', '#3b443c', '#6f7b70'];
      const g = c.createLinearGradient(-60, 0, 40, 0); g.addColorStop(0, top[0]); g.addColorStop(0.45, top[2]); g.addColorStop(1, top[1]);
      rr(c, -60, -110, 96, 150, 12, g);
      if (type === 'flash') for (let y = -90; y < 30; y += 22) for (let x = -48; x < 30; x += 20) dot(c, x, y, 4, '#2b2c2e');
      else { rr(c, -60, -60, 96, 18, 2, '#c9b04a'); for (let y = -100; y < 30; y += 16) hl(c, -55, y, -50, y, 0.2, 2); }
      hl(c, -54, -104, -54, 32, 0.35, 3);
      P(c, [-40, -122, 20, -122, 20, -108, -40, -108], '#4a4b4d');
    }
    // spoon + pin ring
    P(c, [6, -96, 24, -96, 60, -10, 46, -6], '#7c7f84'); hl(c, 8, -95, 56, -12, 0.35, 2);
    c.strokeStyle = '#b9bcc0'; c.lineWidth = 5; c.beginPath(); c.arc(-36, -118, 16, 0, TAU); c.stroke();
    // fingers curled around it
    const [gl, gd] = GLOVE[t];
    for (let i = 0; i < 4; i++) rr(c, -70 + i * 6, -40 + i * 24, 70, 22, 10, vgrad(c, -40 + i * 24, -18 + i * 24, gl, gd));
    rr(c, -10, -80, 40, 24, 10, gd);
  };
}
MODELS.nade_he = nadeModel('he'); MODELS.nade_flash = nadeModel('flash'); MODELS.nade_smoke = nadeModel('smoke');

const MUZZLE = { ak: [-494, -26], galil: [-492, -26], m4: [-492, -26], famas: [-478, -25], awp: [-628, -28], ssg: [-576, -25], smg: [-336, -24], nova: [-566, -36], pistol: [-180, -26], deagle: [-220, -31] };
function drawMuzzleFlash(c, x, y, big) {
  const r = (big ? 90 : 60) * (0.8 + Math.random() * 0.4);
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, 'rgba(255,255,235,1)'); g.addColorStop(0.25, 'rgba(255,214,110,0.95)'); g.addColorStop(1, 'rgba(255,120,20,0)');
  c.fillStyle = g; c.beginPath();
  const rot = Math.random() * TAU;
  for (let i = 0; i < 12; i++) { const a = rot + (i / 12) * TAU, rr = i % 2 ? r * 0.35 : r * (0.7 + Math.random() * 0.5); c.lineTo(x + Math.cos(a) * rr * 1.4, y + Math.sin(a) * rr * 0.8); }
  c.fill();
}
function drawViewmodel() {
  const c = fxCtx, Wd = fx.width, Hd = fx.height;
  c.clearRect(0, 0, Wd, Hd);
  const p = G.player;
  if (G.state !== 'playing' || !p || !p.alive) return;
  const key = curWeapon(p), w = WEAPONS[key];
  if (w.sniper && p.zoom > 0 && p.fireCd <= 0.05 && p.reloadT <= 0) return; // looking through the scope
  const s = Hd / 720;
  const spd = Math.min(1, Math.hypot(p.vx, p.vy) / 3.9) * (p.onGround ? 1 : 0.3);
  let ox = Math.sin(p.bob) * 14 * spd + p.swayX, oy = Math.abs(Math.cos(p.bob)) * 10 * spd + p.swayY + (p.crouch ? 8 : 0);
  let rot = 0;
  if (p.switchT > 0) { const k = p.switchT / w.deploy; oy += k * k * 420; rot += k * 0.4; }
  if (p.reloadT > 0) { const r = 1 - p.reloadT / w.reload, d = Math.sin(r * Math.PI); oy += d * 170; rot += d * 0.45; }
  if (p.knifeT > 0) { const k = p.knifeT / 0.35; rot -= Math.sin(k * Math.PI) * 0.9; ox -= Math.sin(k * Math.PI) * 260; oy -= Math.sin(k * Math.PI) * 60; }
  if (p.throwT > 0) { const k = 1 - p.throwT / 0.35; ox -= Math.sin(k * Math.PI) * 200; oy -= Math.sin(k * Math.PI) * 160 - k * 500; rot -= k * 0.6; }
  ox += p.vmKick * 22; oy += p.vmKick * 16; rot += p.vmKick * (w.sniper ? 0.2 : w.kind === 'shotgun' ? 0.18 : 0.06);
  if (!p.onGround) oy -= 14;
  const pistol = w.kind === 'pistol', knife = w.kind === 'knife', nade = w.kind === 'grenade';
  // squash the gun's length and fatten its thickness: cheap perspective, since it points into the screen
  const xs = (pistol || knife || nade ? 1.0 : 0.86) * s, ys = (pistol ? 1.45 : knife ? 1.3 : nade ? 1.1 : 1.6) * s;
  c.save();
  c.translate(Wd * (pistol ? 0.62 : knife ? 0.76 : nade ? 0.72 : 0.8) + ox * s, Hd * (pistol ? 0.87 : nade ? 0.86 : 0.99) + oy * s);
  c.rotate((knife ? 0.5 : pistol ? 0.22 : nade ? 0.12 : 0.36) + rot);
  c.scale(xs, ys);
  MODELS[w.model](c, p.team);
  c.restore();
  // one shared light: brighter top-left, falling off toward the bottom-right corner
  c.save();
  c.globalCompositeOperation = 'source-atop';
  const lg = c.createLinearGradient(Wd * 0.45, Hd * 0.45, Wd, Hd);
  lg.addColorStop(0, 'rgba(255,240,210,0.10)'); lg.addColorStop(0.5, 'rgba(0,0,0,0)'); lg.addColorStop(1, 'rgba(0,0,0,0.38)');
  c.fillStyle = lg; c.fillRect(0, 0, Wd, Hd);
  c.restore();
  if (p.flashT > 0 && MUZZLE[w.model]) {
    c.save();
    c.translate(Wd * (pistol ? 0.62 : 0.8) + ox * s, Hd * (pistol ? 0.87 : 0.99) + oy * s);
    c.rotate((pistol ? 0.22 : 0.36) + rot); c.scale(xs, ys);
    c.globalCompositeOperation = 'lighter';
    drawMuzzleFlash(c, MUZZLE[w.model][0], MUZZLE[w.model][1], !pistol);
    c.restore();
  }
}


// ============================ PATHFINDING ==============================
const N_CELLS = MAP_W * MAP_H;
const gScore = new Float32Array(N_CELLS), came = new Int32Array(N_CELLS), closed = new Uint8Array(N_CELLS);
const DIRS8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
function astar(sx, sy, gx, gy) {
  sx |= 0; sy |= 0; gx |= 0; gy |= 0;
  if (isWall(gx, gy)) return null;
  gScore.fill(1e9); came.fill(-1); closed.fill(0);
  const start = sy * MAP_W + sx, goal = gy * MAP_W + gx;
  const heapF = [], heapI = [];
  const push = (f, i) => {
    heapF.push(f); heapI.push(i);
    let k = heapF.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (heapF[p] <= heapF[k]) break; [heapF[p], heapF[k]] = [heapF[k], heapF[p]]; [heapI[p], heapI[k]] = [heapI[k], heapI[p]]; k = p; }
  };
  const pop = () => {
    const i = heapI[0], lf = heapF.pop(), li = heapI.pop();
    if (heapF.length) {
      heapF[0] = lf; heapI[0] = li; let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1; let m = k;
        if (l < heapF.length && heapF[l] < heapF[m]) m = l;
        if (r < heapF.length && heapF[r] < heapF[m]) m = r;
        if (m === k) break;
        [heapF[m], heapF[k]] = [heapF[k], heapF[m]]; [heapI[m], heapI[k]] = [heapI[k], heapI[m]]; k = m;
      }
    }
    return i;
  };
  const h = (i) => { const dx = Math.abs((i % MAP_W) - gx), dy = Math.abs(((i / MAP_W) | 0) - gy); return dx + dy - 0.586 * Math.min(dx, dy); };
  gScore[start] = 0; push(h(start), start);
  while (heapF.length) {
    const cur = pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % MAP_W, cy = (cur / MAP_W) | 0;
    for (const [dx, dy, cost] of DIRS8) {
      const nx = cx + dx, ny = cy + dy;
      if (isWall(nx, ny)) continue;
      if (dx && dy && (isWall(cx + dx, cy) || isWall(cx, cy + dy))) continue;
      const ni = ny * MAP_W + nx;
      const g = gScore[cur] + cost * (1 + nearWall[ni] * 0.7);
      if (g < gScore[ni]) { gScore[ni] = g; came[ni] = cur; push(g + h(ni), ni); }
    }
  }
  if (came[goal] === -1 && goal !== start) return null;
  const path = [];
  for (let i = goal; i !== start && i !== -1; i = came[i]) path.push([(i % MAP_W) + 0.5, ((i / MAP_W) | 0) + 0.5]);
  path.reverse();
  return path;
}
function collides(x, y, r) {
  return isWall((x - r) | 0, (y - r) | 0) || isWall((x + r) | 0, (y - r) | 0) || isWall((x - r) | 0, (y + r) | 0) || isWall((x + r) | 0, (y + r) | 0);
}
function clearPath(x0, y0, x1, y1) {
  const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 0.2);
  for (let i = 1; i <= n; i++) { const t = i / n; if (collides(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, RADIUS + 0.06)) return false; }
  return true;
}
function moveAgent(a, dx, dy) {
  const nx = a.x + dx; if (!collides(nx, a.y, RADIUS)) a.x = nx; else a.vx *= 0.3;
  const ny = a.y + dy; if (!collides(a.x, ny, RADIUS)) a.y = ny; else a.vy *= 0.3;
}

// ============================== COMBAT =================================
function giveWeapon(a, key) {
  const w = WEAPONS[key];
  a.inv[w.slot] = key;
  if (w.mag) a.ammo[key] = { mag: w.mag, res: w.reserve };
}
function switchTo(a, slot) {
  if (slot === 'grenade' && a.slot === 'grenade') {
    // pressing 4 again cycles through the grenades you carry
    const n = nextNade(a, a.inv.grenade);
    if (!n || n === a.inv.grenade) return;
    a.inv.grenade = n; a.switchT = WEAPONS[n].deploy; a.fireCd = Math.max(a.fireCd, 0.05);
    if (a.isPlayer) SFX.play('deploy');
    return;
  }
  if (!a.inv[slot] || a.slot === slot) return;
  a.lastSlot = a.slot; a.slot = slot;
  a.switchT = WEAPONS[a.inv[slot]].deploy; a.reloadT = 0; a.zoom = 0; a.rezoom = 0; a.shots = 0; a.fireCd = Math.max(a.fireCd, 0.05);
  if (a.isPlayer) SFX.play('deploy');
}
function startReload(a) {
  const key = curWeapon(a), w = WEAPONS[key], am = a.ammo[key];
  if (!w.mag || !am || a.reloadT > 0 || am.mag >= w.mag || am.res <= 0) return false;
  a.reloadT = w.reload; a.zoom = 0; a.rezoom = 0;
  if (a.isPlayer) SFX.play('clipout'); else if (Math.hypot(a.x - CAM.x, a.y - CAM.y) < 8) SFX.play('clipout', a.x, a.y);
  return true;
}
function finishReload(a) {
  const key = curWeapon(a), w = WEAPONS[key], am = a.ammo[key];
  if (!am) return;
  const take = Math.min(w.mag - am.mag, am.res);
  am.mag += take; am.res -= take;
  if (a.isPlayer) SFX.play('clipin');
}
function updateWeaponTimers(a, dt) {
  a.fireCd -= dt; a.flashT -= dt; a.switchT -= dt; a.hurtT -= dt; a.knifeT -= dt;
  a.blindT -= dt; a.tagT -= dt; a.throwT -= dt; a.flashImmuneT -= dt;
  if (a.hurtFlash > 0) a.hurtFlash -= dt;
  if (a.reloadT > 0) { a.reloadT -= dt; if (a.reloadT <= 0) { a.reloadT = 0; finishReload(a); } }
  const w = WEAPONS[curWeapon(a)];
  if (G.time - a.lastShot > (w.rate || 0.2) * 1.3) a.shots = Math.max(0, a.shots - dt * (w.kind === 'pistol' ? 9 : 14));
}

function spawnParticles(x, y, z, color, n, spread, size, life, grow) {
  for (let i = 0; i < n; i++) {
    G.particles.push({ x: x + rand(-0.04, 0.04), y: y + rand(-0.04, 0.04), z, vx: rand(-spread, spread), vy: rand(-spread, spread), vz: rand(-0.2, spread * 2), color, size, life, max: life, grow, dither: grow });
  }
  if (G.particles.length > 260) G.particles.splice(0, G.particles.length - 260);
}

function makeNoise(src, x, y, radius) {
  for (const b of G.agents) {
    if (b.isPlayer || !b.alive || b.team === src.team || b.target) continue;
    if (Math.hypot(b.x - x, b.y - y) < radius) { b.alertX = x; b.alertY = y; b.alertT = 2.2; }
  }
}

const ZONE_MULT = { head: 4, chest: 1, stomach: 1.25, legs: 0.75 };
function applyDamage(victim, attacker, wkey, dmg, zone) {
  if (!victim.alive) return;
  const w = WEAPONS[wkey];
  let d = dmg * (ZONE_MULT[zone] || 1);
  const armored = victim.armor > 0 && zone !== 'legs' && (zone !== 'head' || victim.helmet);
  if (armored && w && w.pen) { const hp = d * w.pen; victim.armor = Math.max(0, victim.armor - (d - hp) * 0.5); d = hp; }
  d = Math.max(1, Math.round(d));
  const real = Math.min(d, victim.hp);
  victim.hp -= d; victim.hurtT = 1.2; victim.hurtFlash = 0.08;
  victim.tagT = 0.45; // getting shot slows you down ("tagging")
  if (attacker) { attacker.dmgDealt += real; }
  if (victim.isPlayer) onPlayerHurt(attacker, d, armored);
  else if (attacker) { victim.alertX = attacker.x; victim.alertY = attacker.y; victim.alertT = 2.5; }
  if (attacker && attacker.isPlayer && (zone === 'head' || G.time - G.lastHitSfx > 0.04)) { G.lastHitSfx = G.time; SFX.play(zone === 'head' ? 'headshot' : 'hit'); }
  if (victim.hp <= 0) kill(victim, attacker, wkey, zone === 'head');
}
function kill(v, k, wkey, hs) {
  v.hp = 0; v.alive = false; v.deaths++; v.deathT = G.time; v.killer = k;
  v.planting = 0; v.defusing = false; v.reloadT = 0; v.zoom = 0;
  if (G.bomb.defuser === v) { G.bomb.defuser = null; G.bomb.progress = 0; }
  if (G.bomb.carrier === v) dropBomb(v);
  dropWeapon(v, v.inv.primary ? 'primary' : 'secondary', false);
  v.nades = { he: 0, flash: 0, smoke: 0 }; v.inv.grenade = null;
  if (k && k !== v && k.team !== v.team) {
    k.kills++;
    const reward = WEAPONS[wkey] ? WEAPONS[wkey].reward : 300;
    addMoney(k, reward);
  }
  addKillfeed(k, v, wkey, hs);
  SFX.play('death', v.x, v.y);
  if (v.isPlayer) { G.specIdx = 0; $('dmg-vignette').style.opacity = 0.9; }
}
// ============================ WEAPON DROPS =============================
function dropWeapon(a, slot, toss) {
  const key = a.inv[slot];
  if (!key || slot === 'knife' || slot === 'grenade') return false;
  const am = a.ammo[key] || { mag: 0, res: 0 };
  const sp = toss ? 4 : 0;
  G.drops.push({ key, x: a.x, y: a.y, vx: Math.cos(a.a) * sp, vy: Math.sin(a.a) * sp, mag: am.mag, res: am.res, t: G.time, owner: a });
  a.inv[slot] = null; delete a.ammo[key];
  if (a.slot === slot) { a.reloadT = 0; a.zoom = 0; a.rezoom = 0; }
  return true;
}
function updateDrops(dt) {
  for (const d of G.drops) {
    if (d.vx || d.vy) {
      const nx = d.x + d.vx * dt, ny = d.y + d.vy * dt;
      if (!collides(nx, d.y, 0.1)) d.x = nx; else d.vx = -d.vx * 0.3;
      if (!collides(d.x, ny, 0.1)) d.y = ny; else d.vy = -d.vy * 0.3;
      const f = Math.exp(-dt * 5); d.vx *= f; d.vy *= f;
      if (Math.hypot(d.vx, d.vy) < 0.05) { d.vx = 0; d.vy = 0; }
    }
  }
  // walking over a gun picks it up if that slot is free
  for (const a of G.agents) {
    if (!a.alive) continue;
    for (let i = G.drops.length - 1; i >= 0; i--) {
      const d = G.drops[i], w = WEAPONS[d.key];
      if (a.inv[w.slot]) continue; // enemy guns can be picked up too
      if (G.time - d.t < (d.owner === a ? 1.2 : 0.2)) continue;
      if (Math.hypot(a.x - d.x, a.y - d.y) > 0.55) continue;
      a.inv[w.slot] = d.key; a.ammo[d.key] = { mag: d.mag, res: d.res };
      G.drops.splice(i, 1);
      if (a.isPlayer) { SFX.play('pickup'); showMsg('', `Picked up ${w.name}`, 1.2, ''); }
      if (!a.isPlayer && w.slot === 'primary') switchTo(a, 'primary');
    }
  }
}
function nearestDrop(a, maxD) {
  let best = null, bd = maxD;
  for (const d of G.drops) {
    if (WEAPONS[d.key].slot !== 'primary') continue;
    const dd = Math.hypot(a.x - d.x, a.y - d.y);
    if (dd < bd && los(a.x, a.y, d.x, d.y)) { bd = dd; best = d; }
  }
  return best;
}

function addMoney(a, amt) {
  const before = a.money;
  a.money = clamp(a.money + amt, 0, MAX_MONEY);
  if (a.isPlayer && a.money !== before) popMoney(a.money - before);
}

// Player hitscan. offX/offY: angle (radians) from the screen center.
function playerHitscan(p, w, key, offX, offY) {
  setupCamera(CAM);
  const sx = W / 2 + Math.tan(offX) * R.f;
  const sy = H / 2 - Math.tan(offY) * R.f;
  const camX = (sx - W / 2) / (W / 2);
  const rdx = R.dirX + R.plX * camX, rdy = R.dirY + R.plY * camX;
  castRay(R.x, R.y, rdx, rdy);
  const wallPerp = RAY.perp;
  let best = null, bestD = wallPerp, bestV = 0;
  for (const a of G.agents) {
    if (!a.alive || a === p || a.team === p.team) continue;
    const pr = project(a.x, a.y);
    if (pr.depth <= 0.1 || pr.depth >= bestD) continue;
    const scale = R.f / pr.depth;
    const sw = SOLDIER_W * scale, sh = SOLDIER_H * scale;
    const left = pr.screenX - sw / 2, top = R.hor - (SOLDIER_H - R.z) * scale;
    if (sx < left || sx >= left + sw || sy < top || sy >= top + sh) continue;
    const frame = a.frame || TEX.soldier[a.team].f0;
    const u = clamp((((sx - left) / sw) * SPR_W) | 0, 0, SPR_W - 1), v = clamp((((sy - top) / sh) * SPR_H) | 0, 0, SPR_H - 1);
    let solid = false;
    for (let du = -1; du <= 1 && !solid; du++) { const uu = clamp(u + du, 0, SPR_W - 1); if (frame[v * SPR_W + uu] >>> 24 >= 128) solid = true; }
    if (!solid) continue;
    best = a; bestD = pr.depth; bestV = v;
  }
  if (best) {
    const zone = bestV < HEAD_V ? 'head' : bestV < CHEST_V ? 'chest' : bestV < STOMACH_V ? 'stomach' : 'legs';
    const dist = Math.hypot(best.x - p.x, best.y - p.y);
    const dmg = w.dmg * Math.pow(w.rangeMod, (dist * 64) / 500);
    const hz = R.z + ((R.hor - sy) * bestD) / R.f;
    spawnParticles(best.x - R.dirX * 0.2, best.y - R.dirY * 0.2, hz, 0xff1a14a8, 6, 0.6, 0.05, 0.35, false);
    applyDamage(best, p, key, dmg, zone);
    return;
  }
  // impact on wall or floor
  let hx = R.x + rdx * wallPerp, hy = R.y + rdy * wallPerp;
  let hz = R.z + ((R.hor - sy) * wallPerp) / R.f;
  if (hz < 0) { const d = (R.z * R.f) / Math.max(1, sy - R.hor); hx = R.x + rdx * d; hy = R.y + rdy * d; hz = 0.03; }
  else if (hz > WALL_H) return;
  hx -= rdx * 0.04; hy -= rdy * 0.04;
  spawnParticles(hx, hy, hz, 0xff7aa0c4, 5, 0.25, 0.07, 0.5, true);
  spawnParticles(hx, hy, hz, 0xff1b2630, 1, 0.01, 0.03, 4, false);
}

function playerSpread(p, w) {
  let sp = w.spread;
  const frac = clamp(Math.hypot(p.vx, p.vy) / w.speed, 0, 1);
  if (frac > 0.34) sp += w.moveSpread * ((frac - 0.34) / 0.66);
  if (!p.onGround) sp += 0.12;
  if (p.crouch) sp *= 0.75;
  if (w.auto) sp += Math.min(p.shots, 10) * w.recoilV * 0.12; // sprays get sloppier
  if (w.sniper && p.zoom === 0) sp = w.unscoped + frac * 0.1;
  return sp;
}

function playerFire(p, underhand) {
  const key = curWeapon(p), w = WEAPONS[key];
  if (p.switchT > 0 || p.fireCd > 0 || p.planting || p.defusing) return;
  if (w.kind === 'knife') { knifeAttack(p, false); return; }
  if (w.kind === 'grenade') { playerThrow(p, key, underhand); return; }
  if (p.reloadT > 0) return;
  const am = p.ammo[key];
  if (am.mag <= 0) { SFX.play('empty'); p.fireCd = 0.25; if (!startReload(p)) p.fireCd = 0.4; return; }
  am.mag--;
  p.fireCd = w.rate; p.lastShot = G.time; p.flashT = 0.05; p.vmKick = 1;
  const sp = playerSpread(p, w);
  const rec = recoilFor(w, p.shots);
  // bullets land at recoil + spread; the view only shows half of the recoil
  if (w.pellets) {
    // shotgun: a fixed cone of pellets plus the usual movement inaccuracy
    const extra = Math.max(0, sp - w.spread);
    const er = extra * Math.sqrt(Math.random()), et = Math.random() * TAU;
    for (let i = 0; i < w.pellets; i++) {
      const r = w.spread * Math.sqrt(Math.random()), th = Math.random() * TAU;
      playerHitscan(p, w, key, Math.cos(et) * er + Math.cos(th) * r, rec[1] * 0.5 + Math.sin(et) * er + Math.sin(th) * r * 0.7);
    }
  } else {
    const r = sp * Math.sqrt(Math.random()), th = Math.random() * TAU;
    playerHitscan(p, w, key, rec[0] * 0.5 + Math.cos(th) * r, rec[1] * 0.5 + Math.sin(th) * r);
  }
  p.shots += 1;
  p.kickP += w.sniper ? 0.035 : w.pellets ? 0.05 : w.kind === 'pistol' ? 0.012 : 0.006;
  SFX.shot(w.sound);
  makeNoise(p, p.x, p.y, 22);
  if (w.sniper && p.zoom > 0) { p.rezoom = p.zoom; p.zoom = 0; }
  if (am.mag === 0 && am.res > 0) setTimeout(() => { if (p.alive && curWeapon(p) === key && p.ammo[key].mag === 0) startReload(p); }, 250);
}
function knifeAttack(a, heavy) {
  a.fireCd = heavy ? 1.0 : WEAPONS.knife.rate; a.knifeT = 0.35;
  SFX.play('knife', a.isPlayer ? undefined : a.x, a.isPlayer ? undefined : a.y);
  let best = null, bd = 1e9;
  for (const e of G.agents) {
    if (!e.alive || e.team === a.team) continue;
    const dx = e.x - a.x, dy = e.y - a.y, d = Math.hypot(dx, dy);
    if (d > WEAPONS.knife.range) continue;
    if (Math.abs(angNorm(Math.atan2(dy, dx) - a.a)) > 0.5) continue;
    if (!los(a.x, a.y, e.x, e.y)) continue;
    if (d < bd) { bd = d; best = e; }
  }
  if (best) {
    const back = Math.cos(best.a) * (best.x - a.x) + Math.sin(best.a) * (best.y - a.y) > 0.3 * bd;
    const dmg = (heavy ? 65 : 40) * (back ? 2.8 : 1);
    applyDamage(best, a, 'knife', dmg, 'chest');
    spawnParticles(best.x, best.y, 0.9, 0xff1a14a8, 6, 0.5, 0.05, 0.35, false);
  }
}

// ============================== GRENADES ===============================
const NADE_G = 9;
function spawnNade(a, type, vx, vy, vz) {
  const z = (a.isPlayer ? a.eyeZ + a.jumpZ : EYE_STAND) - 0.1;
  let x = a.x + Math.cos(a.a) * 0.15, y = a.y + Math.sin(a.a) * 0.15;
  if (collides(x, y, 0.06)) { x = a.x; y = a.y; }
  G.nades.push({ type, x, y, z, vx, vy, vz, t: 0, owner: a, bounceT: 0 });
  a.nades[type]--; a.lastNadeT = G.time;
  SFX.play('throw', a.isPlayer ? undefined : a.x, a.isPlayer ? undefined : a.y);
  makeNoise(a, a.x, a.y, 8);
}
function playerThrow(p, type, underhand) {
  if (p.nades[type] <= 0) return;
  const power = underhand ? 0.45 : 1;
  const sp = 12.5 * power, cp = Math.cos(p.pitch);
  spawnNade(p, type, Math.cos(p.a) * cp * sp + p.vx * 0.6, Math.sin(p.a) * cp * sp + p.vy * 0.6, Math.sin(p.pitch) * sp + (underhand ? 1 : 2.2));
  p.throwT = 0.35; p.fireCd = 0.6;
  // pull out the next grenade, or go back to a gun
  const next = p.nades[type] > 0 ? type : nextNade(p);
  if (next) { p.inv.grenade = next; p.switchT = WEAPONS[next].deploy + 0.3; }
  else { p.inv.grenade = null; switchTo(p, p.inv.primary ? 'primary' : 'secondary'); }
}
// bots lob a grenade so it lands near (tx, ty)
function botThrow(b, type, tx, ty) {
  if (b.nades[type] <= 0) return;
  const d = Math.hypot(tx - b.x, ty - b.y), ang = Math.atan2(ty - b.y, tx - b.x) + gauss() * 0.05;
  b.a = ang;
  const flight = 1.0, hs = Math.min(13, (d * 0.8) / flight);
  spawnNade(b, type, Math.cos(ang) * hs, Math.sin(ang) * hs, 3.5);
  if (type === 'flash') b.flashImmuneT = 2.2; // the thrower looks away
  if (!b.nades.he && !b.nades.flash && !b.nades.smoke) b.inv.grenade = null;
}
function nadeBounce(n) {
  if (G.time - n.bounceT > 0.08 && Math.hypot(n.x - CAM.x, n.y - CAM.y) < 14) SFX.play('bounce', n.x, n.y);
  n.bounceT = G.time;
}
function updateNades(dt) {
  for (let i = G.nades.length - 1; i >= 0; i--) {
    const n = G.nades[i];
    n.t += dt;
    const steps = 3, h = dt / steps;
    for (let s = 0; s < steps; s++) {
      n.vz -= NADE_G * h;
      const nx = n.x + n.vx * h;
      if (collides(nx, n.y, 0.06)) { n.vx = -n.vx * 0.45; n.vy *= 0.8; nadeBounce(n); } else n.x = nx;
      const ny = n.y + n.vy * h;
      if (collides(n.x, ny, 0.06)) { n.vy = -n.vy * 0.45; n.vx *= 0.8; nadeBounce(n); } else n.y = ny;
      n.z += n.vz * h;
      if (n.z < 0.06) {
        n.z = 0.06;
        if (n.vz < -1.2) nadeBounce(n);
        n.vz = Math.abs(n.vz) > 1.2 ? -n.vz * 0.35 : 0;
        n.vx *= 0.7; n.vy *= 0.7;
      }
    }
    if (n.z <= 0.07 && n.vz === 0) { const f = Math.exp(-dt * 3); n.vx *= f; n.vy *= f; }
    const sp = Math.hypot(n.vx, n.vy);
    const ready = n.type === 'smoke' ? (n.t > 1.0 && sp < 0.4 && n.z < 0.1) || n.t > 3 : n.t >= 1.6;
    if (ready) { detonate(n); G.nades.splice(i, 1); }
  }
  for (let i = G.smokes.length - 1; i >= 0; i--) { G.smokes[i].t += dt; if (G.smokes[i].t > G.smokes[i].life) G.smokes.splice(i, 1); }
}
function detonate(n) {
  const near = Math.hypot(n.x - CAM.x, n.y - CAM.y);
  if (n.type === 'he') {
    SFX.play('he', n.x, n.y);
    if (near < 6) G.shake = Math.max(G.shake, 0.5 * (1 - near / 6));
    for (let i = 0; i < 18; i++) spawnParticles(n.x + rand(-0.5, 0.5), n.y + rand(-0.5, 0.5), rand(0.1, 0.9), pick([0xff2a8cff, 0xff1060e0, 0xff3a4450, 0xff90c8f0]), 1, 1.2, 0.3, 0.9, true);
    for (const a of G.agents) {
      if (!a.alive) continue;
      const d = Math.hypot(a.x - n.x, a.y - n.y);
      if (d > 3.6 || !los(n.x, n.y, a.x, a.y)) continue;
      let dmg = 98 * (1 - d / 3.6);
      if (a.team === n.owner.team && a !== n.owner) dmg *= 0.35; // reduced team damage
      if (dmg >= 1) applyDamage(a, n.owner, 'he', dmg, 'chest');
    }
  } else if (n.type === 'flash') {
    SFX.play('flashbang', n.x, n.y);
    spawnParticles(n.x, n.y, n.z + 0.2, 0xffffffff, 1, 0, 0.9, 0.15, true);
    for (const a of G.agents) {
      if (!a.alive || a.flashImmuneT > 0) continue;
      const d = Math.hypot(a.x - n.x, a.y - n.y);
      if (d > 15 || !los(a.x, a.y, n.x, n.y) || smokeBlocks(a.x, a.y, n.x, n.y)) continue;
      const facing = Math.cos(angNorm(Math.atan2(n.y - a.y, n.x - a.x) - a.a));
      const f = facing > 0.5 ? 1 : facing > -0.1 ? 0.5 : 0.12;
      const blind = 4.6 * f * (0.35 + 0.65 * (1 - d / 15));
      if (blind < 0.25) continue;
      a.blindT = Math.max(a.blindT, blind);
      if (a.isPlayer && blind > 1.2) SFX.play('ring');
      if (!a.isPlayer) { a.target = null; a.reactT = 0.5; }
    }
  } else {
    SFX.play('smokepop', n.x, n.y);
    const puffs = [], rng = mulberry32((Math.random() * 1e9) | 0), R0 = 2.3;
    for (let i = 0; i < 26; i++) {
      const ang = rng() * TAU, r = Math.sqrt(rng()) * R0;
      const px = n.x + Math.cos(ang) * r, py = n.y + Math.sin(ang) * r;
      if (isWall(px | 0, py | 0) || !los(n.x, n.y, px, py)) continue;
      puffs.push({ x: px, y: py, z: 0.2 + rng() * 1.5, size: 1.3 + rng() * 0.8, shade: 0.86 + rng() * 0.16, delay: (r / R0) * 0.8 });
    }
    G.smokes.push({ x: n.x, y: n.y, r: R0, t: 0, life: 16, puffs });
  }
}
// 0..1 how dense a smoke is right now
const smokeDensity = (s) => clamp(s.t / 0.9, 0, 1) * clamp((s.life - s.t) / 2.2, 0, 1);
function smokeBlocks(x0, y0, x1, y1) {
  for (const s of G.smokes) {
    if (smokeDensity(s) < 0.55) continue;
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1;
    const t = clamp(((s.x - x0) * dx + (s.y - y0) * dy) / L2, 0, 1);
    if (Math.hypot(x0 + dx * t - s.x, y0 + dy * t - s.y) < s.r * 0.8) return true;
  }
  return false;
}

// ============================== BOMB ===================================
function dropBomb(a) {
  const b = G.bomb;
  b.state = 'dropped'; b.carrier = null; b.x = a.x; b.y = a.y;
}
function plantBomb(a) {
  const b = G.bomb;
  b.state = 'planted'; b.carrier = null; b.x = a.x + Math.cos(a.a) * 0.3; b.y = a.y + Math.sin(a.a) * 0.3;
  if (collides(b.x, b.y, 0.05)) { b.x = a.x; b.y = a.y; }
  b.site = siteAt(a.x, a.y) || 'A'; b.timer = BOMB_TIME; b.beepT = 0; b.defuser = null; b.progress = 0;
  G.phase = 'planted';
  a.planting = 0;
  addMoney(a, 300);
  showMsg('Bomb has been planted', `Site ${b.site}`, 2.5, 't');
  SFX.play('planted');
  for (const bot of G.agents) {
    if (bot.isPlayer || !bot.alive) continue;
    if (bot.team === 'T') { bot.plan = 'postplant'; setPostplantGoal(bot); }
    else { bot.plan = 'retake'; bot.goalX = b.x; bot.goalY = b.y; bot.path = null; }
  }
}
function updateBomb(dt) {
  const b = G.bomb;
  if (b.state === 'dropped') {
    for (const a of G.agents) {
      if (a.alive && a.team === 'T' && Math.hypot(a.x - b.x, a.y - b.y) < 0.7) {
        b.state = 'carried'; b.carrier = a;
        if (a.isPlayer) showMsg('You picked up the bomb', '', 1.6, 't');
        else { a.plan = 'execute'; setExecuteGoal(a); }
        break;
      }
    }
  }
  if (b.state === 'planted' && G.phase === 'planted') {
    b.timer -= dt;
    b.beepT -= dt;
    if (b.beepT <= 0) { SFX.play('beep', b.x, b.y); b.beepT = clamp(b.timer / 40, 0.12, 1); }
    if (b.defuser) {
      const d = b.defuser;
      if (!d.alive || Math.hypot(d.x - b.x, d.y - b.y) > 1.3 || !d.defusing) { b.defuser = null; b.progress = 0; if (d.alive) d.defusing = false; }
      else {
        b.progress += dt;
        if (Math.random() < dt * 6) SFX.play('defuse', b.x, b.y);
        if (b.progress >= (d.kit ? KIT_DEFUSE_TIME : DEFUSE_TIME)) {
          b.state = 'defused'; d.defusing = false; b.defuser = null;
          addMoney(d, 300);
          endRound('CT', 'Bomb defused');
          return;
        }
      }
    }
    if (b.timer <= 0) explodeBomb();
  }
}
function explodeBomb() {
  const b = G.bomb;
  b.state = 'exploded';
  SFX.play('explode', b.x, b.y);
  G.shake = 1.2; G.flash = 1;
  for (let i = 0; i < 40; i++) spawnParticles(b.x + rand(-1.5, 1.5), b.y + rand(-1.5, 1.5), rand(0, 1.5), pick([0xff2a8cff, 0xff1060e0, 0xff304050, 0xffa8d8ff]), 1, 1.5, 0.35, 1.3, true);
  for (const a of G.agents) {
    if (!a.alive) continue;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const dmg = 260 * Math.max(0, 1 - d / 11);
    if (dmg > 0) { a.hp -= dmg; if (a.isPlayer) onPlayerHurt(null, dmg, false); if (a.hp <= 0) kill(a, null, 'bomb', false); }
  }
  endRound('T', 'Target bombed');
}

// ================================ BOTS =================================
function setStageGoal(b, idx) {
  const route = T_ROUTES[G.tSite][idx % 2];
  b.goalX = route[0] + rand(-1, 1); b.goalY = route[1] + rand(-0.6, 0.6);
  b.stageUntil = ROUND_TIME - rand(14, 30);
  b.plan = 'stage'; b.path = null;
}
function setExecuteGoal(b) {
  const site = G.bomb.carrier === b ? G.tSite : G.tSite;
  const s = pick(PLANT_SPOTS[site]);
  b.goalX = s[0] + rand(-0.4, 0.4); b.goalY = s[1] + rand(-0.4, 0.4); b.path = null;
  b.lookX = null;
}
function setPostplantGoal(b) {
  const bomb = G.bomb, ang = rand(0, TAU), r = rand(2.5, 6);
  let gx = bomb.x + Math.cos(ang) * r, gy = bomb.y + Math.sin(ang) * r;
  for (let i = 0; i < 12 && isWall(gx | 0, gy | 0); i++) { const a2 = rand(0, TAU); gx = bomb.x + Math.cos(a2) * r; gy = bomb.y + Math.sin(a2) * r; }
  if (isWall(gx | 0, gy | 0)) { gx = bomb.x; gy = bomb.y; }
  b.goalX = gx; b.goalY = gy; b.path = null;
  const e = pick(SITE_ENTRIES[bomb.site] || SITE_ENTRIES.A);
  b.lookX = e[0]; b.lookY = e[1];
}
function setHold(b, where) {
  const spot = pick(CT_HOLDS[where]);
  b.holdSite = where; b.plan = 'hold';
  b.goalX = spot[0] + rand(-0.3, 0.3); b.goalY = spot[1] + rand(-0.3, 0.3);
  b.lookX = spot[2]; b.lookY = spot[3]; b.path = null; b.rotateAt = 0;
}
function assignPlans() {
  G.tSite = Math.random() < 0.5 ? 'A' : 'B';
  let ti = 0, ci = 0;
  const ctOrder = shuffle(['A', 'B']).concat(['mid']).concat(shuffle(['A', 'B']));
  for (const b of G.agents) {
    if (b.isPlayer) continue;
    b.target = null; b.alertT = 0; b.path = null; b.lookX = null;
    if (b.team === 'T') setStageGoal(b, ti++);
    else setHold(b, ctOrder[ci++ % ctOrder.length]);
  }
}

function navTo(b, gx, gy, dt) {
  const key = ((gx * 4) | 0) + ',' + ((gy * 4) | 0);
  b.repathT -= dt;
  if (!b.path || b.pathKey !== key || b.repathT <= 0) {
    b.path = astar(b.x, b.y, gx, gy) || [];
    if (b.path.length) b.path[b.path.length - 1] = [gx, gy];
    b.pi = 0; b.pathKey = key; b.repathT = 3 + Math.random();
  }
  if (b.pi >= b.path.length) return true;
  // string pulling: skip waypoints we can walk straight to
  for (let k = 0; k < 3 && b.pi + 1 < b.path.length; k++) {
    const n = b.path[b.pi + 1];
    if (clearPath(b.x, b.y, n[0], n[1])) b.pi++; else break;
  }
  const t = b.path[b.pi];
  const dx = t[0] - b.x, dy = t[1] - b.y, d = Math.hypot(dx, dy);
  if (d < 0.3) { b.pi++; if (b.pi >= b.path.length) return true; }
  b.wishX = dx / (d || 1); b.wishY = dy / (d || 1);
  return false;
}

// Direction to watch: straight at the look point if visible, otherwise down the path toward it
function lookAngle(b) {
  const key = (b.x | 0) + ',' + (b.y | 0) + ',' + b.lookX + ',' + b.lookY;
  if (b.lookKey !== key) {
    b.lookKey = key;
    if (los(b.x, b.y, b.lookX, b.lookY)) b.lookAng = Math.atan2(b.lookY - b.y, b.lookX - b.x);
    else {
      const path = astar(b.x, b.y, b.lookX, b.lookY);
      let pt = null;
      if (path) for (let i = Math.min(path.length - 1, 6); i >= 0; i--) if (los(b.x, b.y, path[i][0], path[i][1])) { pt = path[i]; break; }
      b.lookAng = pt ? Math.atan2(pt[1] - b.y, pt[0] - b.x) : Math.atan2(b.lookY - b.y, b.lookX - b.x);
    }
  }
  return b.lookAng;
}
function botVision(b) {
  if (b.blindT > 0.4) return null; // flashed
  let best = null, bd = 1e9;
  for (const e of G.agents) {
    if (!e.alive || e.team === b.team) continue;
    const dx = e.x - b.x, dy = e.y - b.y, d = Math.hypot(dx, dy);
    if (d > 34) continue;
    const diff = Math.abs(angNorm(Math.atan2(dy, dx) - b.a));
    if (d > 2.5 && diff > 1.25 && b.hurtT <= 0) continue;
    if (!los(b.x, b.y, e.x, e.y) || (d > 1.2 && smokeBlocks(b.x, b.y, e.x, e.y))) continue;
    if (b.team === G.player.team) e.spottedT = G.time;
    if (b.team === 'CT') { const s = REGION_SITE[regionAt(e.x, e.y)]; if (s) G.intel[s] = G.time; }
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function botFire(b, t) {
  const key = curWeapon(b), w = WEAPONS[key], am = b.ammo[key];
  if (!am || am.mag <= 0) { startReload(b); return; }
  am.mag--;
  b.lastShot = G.time; b.flashT = 0.07;
  if (w.sniper) b.fireCd = w.rate + rand(0.1, 0.4);
  else if (!w.auto) b.fireCd = Math.max(w.rate, rand(0.2, 0.36));
  else {
    b.fireCd = w.rate; b.burst++;
    if (b.burst >= b.burstLen) { b.fireCd += rand(0.22, 0.45); b.burst = 0; b.burstLen = randInt(3, 7); }
  }
  SFX.shot(w.sound, b.x, b.y);
  makeNoise(b, b.x, b.y, 22);
  const dist = Math.hypot(t.x - b.x, t.y - b.y);
  const diff = D();
  let err = diff.aim * (w.sniper ? 0.55 : 1) + w.spread;
  if (Math.hypot(b.vx, b.vy) > 1.2) err += w.moveSpread * 0.6;
  if (w.auto) err += b.burst * w.recoilV * 0.4;
  if (t.isPlayer && t.crouch) err *= 1.12;
  if (Math.hypot(t.vx, t.vy) > 2.5) err += 0.006;
  const half = Math.atan(0.24 / Math.max(0.5, dist));
  if (Math.abs(gauss() * err) < half) {
    const r = Math.random(), hs = diff.hs * (dist < 14 ? 1 : 0.6);
    const zone = r < hs ? 'head' : r < hs + (1 - hs) * 0.55 ? 'chest' : r < hs + (1 - hs) * 0.75 ? 'stomach' : 'legs';
    let dmg = w.dmg * Math.pow(w.rangeMod, (dist * 64) / 500);
    if (w.pellets) dmg *= Math.max(1, Math.round(w.pellets * clamp(1.15 - dist / 9, 0.1, 1))); // pellets that connect
    if (!t.isPlayer) spawnParticles(t.x, t.y, zone === 'head' ? 1.05 : 0.7, 0xff1a14a8, 4, 0.5, 0.05, 0.3, false);
    applyDamage(t, b, key, dmg, zone);
  } else if (t.isPlayer || Math.hypot(t.x - CAM.x, t.y - CAM.y) < 12) {
    // missed shots kick up dust around the target
    const ang = Math.atan2(t.y - b.y, t.x - b.x) + gauss() * err;
    castRay(b.x, b.y, Math.cos(ang), Math.sin(ang));
    const px = b.x + Math.cos(ang) * (RAY.perp - 0.05), py = b.y + Math.sin(ang) * (RAY.perp - 0.05);
    spawnParticles(px, py, rand(0.2, 1.6), 0xff7aa0c4, 4, 0.25, 0.07, 0.45, true);
  }
}

function updateBot(b, dt) {
  const diff = D();
  const w = WEAPONS[curWeapon(b)];
  let speed = w.speed * (b.tagT > 0 ? 0.55 : 1);
  b.wishX = 0; b.wishY = 0;
  let face = null;

  if (G.phase === 'freeze' || G.phase === 'over' && !b.alive) { b.vx = 0; b.vy = 0; return; }

  // ---- perception ----
  b.thinkT -= dt;
  if (b.thinkT <= 0) {
    b.thinkT = 0.12;
    const seen = botVision(b);
    if (seen) {
      if (seen !== b.target) { b.reactT = diff.react * rand(0.8, 1.3) * (b.target ? 0.5 : 1) * (Math.hypot(b.vx, b.vy) < 0.6 ? 0.75 : 1); b.burst = 0; }
      b.target = seen; b.lostT = 0; b.lastSeenX = seen.x; b.lastSeenY = seen.y;
    } else if (b.target) {
      b.lostT += 0.12;
      if (b.lostT > 0.6 || !b.target.alive) {
        const wasAlive = b.target.alive;
        b.target = null; b.alertX = b.lastSeenX; b.alertY = b.lastSeenY; b.alertT = 2.5;
        // enemy ducked out of sight: sometimes follow up with a grenade
        const d = Math.hypot(b.lastSeenX - b.x, b.lastSeenY - b.y);
        if (wasAlive && nadeCount(b) && d > 3.5 && d < 16 && G.time - b.lastNadeT > 8 && Math.random() < 0.4 && b.blindT <= 0) {
          planNade(b, b.lastSeenX, b.lastSeenY, ['flash', 'he', 'smoke'], rand(0.3, 0.9));
        }
      }
    }
  }
  if (b.target && !b.target.alive) b.target = null;

  // ---- combat ----
  if (b.target && b.lostT === 0) {
    const t = b.target;
    face = Math.atan2(t.y - b.y, t.x - b.x);
    b.reactT -= dt;
    if (b.planting) b.planting = 0;
    if (b.defusing && G.bomb.timer > (b.kit ? 5.5 : 10.5) - G.bomb.progress + 1) { b.defusing = false; }
    if (!b.defusing) {
      // hard bots strafe between bursts, everyone else stands to shoot
      b.strafeT -= dt;
      if (b.strafeT <= 0) { b.strafe = Math.random() < 0.5 ? -1 : 1; b.strafeT = rand(0.35, 0.8); }
      if (G.difficulty >= 1 && b.fireCd > 0.15) { b.wishX = -Math.sin(face) * b.strafe; b.wishY = Math.cos(face) * b.strafe; speed *= 0.5; }
      const aimDiff = Math.abs(angNorm(face - b.a));
      if (aimDiff < 0.12 && b.reactT <= 0 && b.fireCd <= 0 && b.reloadT <= 0 && b.switchT <= 0) botFire(b, t);
    }
  } else {
    // ---- objectives ----
    if (b.reloadT <= 0 && b.ammo[curWeapon(b)] && b.ammo[curWeapon(b)].mag < WEAPONS[curWeapon(b)].mag * 0.4) startReload(b);
    const bomb = G.bomb;
    if (b.team === 'T' && bomb.state === 'dropped' && b.plan !== 'getbomb') {
      // nearest living T bot fetches the bomb
      let nearest = null, nd = 1e9;
      for (const o of G.agents) if (o.alive && o.team === 'T' && !o.isPlayer) { const d = Math.hypot(o.x - bomb.x, o.y - bomb.y); if (d < nd) { nd = d; nearest = o; } }
      const pl = G.player;
      const playerCloser = pl.alive && pl.team === 'T' && Math.hypot(pl.x - bomb.x, pl.y - bomb.y) < nd - 4;
      if (nearest === b && !playerCloser) { b.plan = 'getbomb'; b.path = null; }
    }
    // throw once the planned spot is in range (give up after a while)
    if (b.nadeAt && G.time > b.nadeAt + 14) b.nadeAt = 0;
    if (b.nadeAt && G.time > b.nadeAt && Math.hypot(b.nadeX - b.x, b.nadeY - b.y) < 15) {
      b.nadeAt = 0;
      const type = b.nadePref.find((k) => b.nades[k] > 0);
      if (type && b.blindT <= 0) { botThrow(b, type, b.nadeX, b.nadeY); b.fireCd = Math.max(b.fireCd, 0.5); }
    }
    // no primary? grab a gun lying nearby
    const loot = !b.inv.primary && !b.planting && !b.defusing && G.bomb.carrier !== b ? nearestDrop(b, 7) : null;
    let arrived = false;
    if (loot) navTo(b, loot.x, loot.y, dt);
    else switch (b.plan) {
      case 'stage':
        arrived = navTo(b, b.goalX, b.goalY, dt);
        if (arrived) { const c = PLANT_SPOTS[G.tSite][0]; b.lookX = c[0]; b.lookY = c[1]; }
        if (G.roundT < b.stageUntil) {
          b.plan = 'execute'; setExecuteGoal(b);
          // execute: smoke or flash a spot where CTs like to hold
          if (nadeCount(b) && Math.random() < 0.75) { const h = pick(CT_HOLDS[G.tSite]); planNade(b, h[0], h[1], ['smoke', 'flash', 'he'], rand(0.2, 1.2)); }
        }
        break;
      case 'execute':
        arrived = navTo(b, b.goalX, b.goalY, dt);
        if (bomb.carrier === b && siteAt(b.x, b.y) && G.phase === 'live') {
          if (!b.planting) b.planting = PLANT_TIME;
          b.wishX = 0; b.wishY = 0;
          b.planting -= dt;
          if (Math.random() < dt * 5) SFX.play('plantkey', b.x, b.y);
          if (b.planting <= 0) plantBomb(b);
        } else if (arrived && bomb.carrier !== b) {
          const e = pick(SITE_ENTRIES[G.tSite]); b.plan = 'siteHold'; b.lookX = e[0]; b.lookY = e[1];
        }
        break;
      case 'siteHold':
        navTo(b, b.goalX, b.goalY, dt);
        break;
      case 'getbomb':
        if (bomb.state !== 'dropped') { b.plan = 'execute'; setExecuteGoal(b); break; }
        navTo(b, bomb.x, bomb.y, dt);
        break;
      case 'postplant':
        navTo(b, b.goalX, b.goalY, dt);
        break;
      case 'hold': {
        arrived = navTo(b, b.goalX, b.goalY, dt);
        // rotate when teammates report enemies at the other site
        const other = b.holdSite === 'A' ? 'B' : b.holdSite === 'B' ? 'A' : null;
        const hot = G.intel.A > G.time - 4 ? 'A' : G.intel.B > G.time - 4 ? 'B' : null;
        if (hot && hot !== b.holdSite && !b.rotateAt && (b.holdSite === 'mid' || Math.random() < 0.5)) b.rotateAt = G.time + rand(2, 6);
        // site is being hit: nade the entrance the attackers come through
        if (b.holdSite !== 'mid' && G.intel[b.holdSite] > G.time - 1.5 && nadeCount(b) && G.time - b.lastNadeT > 10 && Math.random() < dt * 0.6) {
          const e = pick(SITE_ENTRIES[b.holdSite]); planNade(b, e[0], e[1], ['he', 'flash', 'smoke'], rand(0.1, 0.5));
        }
        if (b.rotateAt && G.time > b.rotateAt && hot) { setHold(b, hot); b.rotateAt = -1; }
        else if (b.rotateAt && G.time > b.rotateAt) b.rotateAt = -1;
        void other;
        break;
      }
      case 'retake': {
        const d = Math.hypot(b.x - bomb.x, b.y - bomb.y);
        if (d > 0.7) navTo(b, bomb.x, bomb.y, dt);
        if (d < 0.9 && bomb.state === 'planted') {
          if (!bomb.defuser) { bomb.defuser = b; bomb.progress = 0; b.defusing = true; }
          if (bomb.defuser === b) { b.wishX = 0; b.wishY = 0; b.defusing = true; face = Math.atan2(bomb.y - b.y, bomb.x - b.x); }
          else { const e = pick(SITE_ENTRIES[bomb.site || 'A']); b.lookX = e[0]; b.lookY = e[1]; }
        }
        break;
      }
    }
    if (face === null) {
      if (b.alertT > 0) { b.alertT -= dt; face = Math.atan2(b.alertY - b.y, b.alertX - b.x); }
      else if (Math.hypot(b.wishX, b.wishY) > 0.1) face = Math.atan2(b.wishY, b.wishX);
      else if (b.lookX !== null) face = lookAngle(b) + Math.sin(G.time * 0.6 + b.id) * 0.3;
    }
    if (b.alertT > 0 && b.plan === 'hold' && Math.hypot(b.x - b.goalX, b.y - b.goalY) < 1) { b.wishX = 0; b.wishY = 0; }
  }
  if (b.planting || b.defusing) { b.wishX = 0; b.wishY = 0; }

  // ---- turning ----
  if (face !== null) {
    const da = angNorm(face - b.a);
    const turn = (b.target ? diff.turn : 4) * dt;
    b.a = angNorm(b.a + clamp(da, -turn, turn));
  }
  // ---- movement ----
  const accel = Math.min(1, 10 * dt);
  b.vx += (b.wishX * speed - b.vx) * accel;
  b.vy += (b.wishY * speed - b.vy) * accel;
  const ox = b.x, oy = b.y;
  moveAgent(b, b.vx * dt, b.vy * dt);
  const moved = Math.hypot(b.x - ox, b.y - oy);
  b.walkPhase += moved * 1.7;
  b.stepAcc += moved;
  if (b.stepAcc > 1.15) { b.stepAcc = 0; if (Math.hypot(b.vx, b.vy) > 2.4 && Math.hypot(b.x - CAM.x, b.y - CAM.y) < 15) SFX.play('step', b.x, b.y); }
  // stuck: wiggle + repath
  if (Math.hypot(b.wishX, b.wishY) > 0.1 && moved < 0.2 * dt) { b.stuckT += dt; if (b.stuckT > 0.7) { b.stuckT = 0; b.path = null; b.vx += rand(-2, 2); b.vy += rand(-2, 2); } }
  else b.stuckT = 0;
}

function planNade(b, x, y, pref, delay) {
  if (b.nadeAt) return;
  b.nadeAt = G.time + delay; b.nadeX = x; b.nadeY = y; b.nadePref = pref;
}
function botBuy(b) {
  const rifle = b.team === 'T' ? 'ak47' : 'm4a1', cheapRifle = b.team === 'T' ? 'galil' : 'famas';
  const pistolRound = G.pistolRound;
  const teamHasAwp = G.agents.some((o) => o !== b && o.team === b.team && o.inv && o.inv.primary === 'awp');
  const buy = (k) => { const price = WEAPONS[k] ? WEAPONS[k].price : GEAR[k].price; if (b.money < price) return false; b.money -= price; if (WEAPONS[k]) giveWeapon(b, k); return true; };
  const armor = () => {
    if (b.armor >= 100 && b.helmet) return;
    if (b.money >= 1000 && !pistolRound) { if (buy('helmet')) { b.armor = 100; b.helmet = true; } }
    else if (b.money >= 650 && b.armor < 100) { if (buy('kevlar')) b.armor = 100; }
  };
  if (pistolRound) { if (Math.random() < 0.6) armor(); else if (Math.random() < 0.5) buy('deagle'); }
  else if (!b.inv.primary) {
    if (!teamHasAwp && b.money >= 5800 && Math.random() < 0.3) buy('awp');
    else if (b.money >= WEAPONS[rifle].price + 650) buy(rifle);
    else if (b.money >= WEAPONS[cheapRifle].price + 650 && Math.random() < 0.6) buy(cheapRifle);
    else if (b.money >= 2200 && Math.random() < 0.6) buy('mp5');
    else if (b.money >= 900 && Math.random() < 0.4 && b.inv.secondary !== 'deagle') buy('deagle');
  }
  armor();
  if (b.team === 'CT' && !b.kit && b.money >= 400 && Math.random() < 0.6) { if (buy('kit')) b.kit = true; }
  if (!pistolRound) {
    for (const [k, chance] of [['flash', 0.65], ['he', 0.45], ['smoke', 0.35], ['flash', 0.3]]) {
      if (b.money >= WEAPONS[k].price + 200 && Math.random() < chance && canHoldNade(b, k)) { b.money -= WEAPONS[k].price; giveNade(b, k); }
    }
  }
  b.slot = b.inv.primary ? 'primary' : 'secondary';
}
const canHoldNade = (a, k) => a.nades[k] < WEAPONS[k].max && nadeCount(a) < MAX_NADES;
function giveNade(a, k) { a.nades[k]++; if (!a.inv.grenade) a.inv.grenade = k; }

// ============================== PLAYER =================================
const keys = {};
const mouse = { left: false, right: false, fresh: false, dx: 0, dy: 0 };
function canBuy(p) {
  if (!p.alive || G.state !== 'playing') return false;
  if (!(G.phase === 'freeze' || (G.phase === 'live' && ROUND_TIME - G.roundT < BUY_TIME))) return false;
  const c = cellChar(p.x | 0, p.y | 0);
  return (p.team === 'T' && c === 'T') || (p.team === 'CT' && c === 'K');
}
function doBuy(p, item) {
  if (!canBuy(p)) { SFX.play('deny'); return; }
  const w = WEAPONS[item], gear = GEAR[item];
  if (w && w.kind === 'grenade') {
    if (p.money < w.price || !canHoldNade(p, item)) { SFX.play('deny'); return; }
    p.money -= w.price; giveNade(p, item);
  } else if (w) {
    if ((w.team && w.team !== p.team) || p.money < w.price || p.inv[w.slot] === item) { SFX.play('deny'); return; }
    p.money -= w.price;
    if (p.inv[w.slot] && w.slot !== 'knife') dropWeapon(p, w.slot, true); // old gun hits the floor
    giveWeapon(p, item); switchTo(p, w.slot); if (p.slot === w.slot) p.switchT = w.deploy;
  } else if (gear) {
    if (gear.team && gear.team !== p.team) { SFX.play('deny'); return; }
    let price = gear.price;
    if (item === 'helmet' && p.armor >= 100 && !p.helmet) price = 350;
    if ((item === 'kevlar' && p.armor >= 100) || (item === 'helmet' && p.armor >= 100 && p.helmet) || (item === 'kit' && p.kit) || p.money < price) { SFX.play('deny'); return; }
    p.money -= price;
    if (item === 'kevlar') p.armor = 100;
    if (item === 'helmet') { p.armor = 100; p.helmet = true; }
    if (item === 'kit') p.kit = true;
  }
  SFX.play('buy');
  renderBuyMenu();
}
function updatePlayer(dt) {
  const p = G.player;
  if (!p.alive) return;
  const key = curWeapon(p), w = WEAPONS[key];
  const frozen = G.phase === 'freeze' || p.planting > 0 || p.defusing;
  // look
  const zoomMul = p.zoom ? ZOOM_FOV[p.zoom] / BASE_FOV : 1;
  p.a = angNorm(p.a + mouse.dx * 0.0022 * G.sens * zoomMul);
  p.pitch = clamp(p.pitch - mouse.dy * 0.0022 * G.sens * zoomMul, -0.75, 0.75);
  p.swayX = lerp(p.swayX, clamp(-mouse.dx * 0.5, -30, 30), Math.min(1, dt * 8));
  p.swayY = lerp(p.swayY, clamp(-mouse.dy * 0.3, -20, 20), Math.min(1, dt * 8));
  mouse.dx = 0; mouse.dy = 0;

  // move
  p.crouch = !!(keys.KeyC || keys.ControlLeft || keys.ControlRight);
  p.walking = !!(keys.ShiftLeft || keys.ShiftRight);
  let speed = w.speed;
  if (p.tagT > 0) speed *= 0.55;
  if (w.sniper && p.zoom) speed *= 0.5;
  if (p.walking) speed *= 0.52;
  if (p.crouch) speed *= 0.34;
  let fwd = 0, side = 0;
  if (!G.buyOpen) {
    if (keys.KeyW || keys.ArrowUp) fwd++;
    if (keys.KeyS || keys.ArrowDown) fwd--;
    if (keys.KeyD || keys.ArrowRight) side++;
    if (keys.KeyA || keys.ArrowLeft) side--;
  }
  const ca = Math.cos(p.a), sa = Math.sin(p.a);
  let wx = ca * fwd - sa * side, wy = sa * fwd + ca * side;
  const wl = Math.hypot(wx, wy); if (wl > 0) { wx /= wl; wy /= wl; }
  if (frozen) { wx = 0; wy = 0; }
  const accel = Math.min(1, (p.onGround ? 12 : 2) * dt);
  p.vx += (wx * speed - p.vx) * accel;
  p.vy += (wy * speed - p.vy) * accel;
  const ox = p.x, oy = p.y;
  moveAgent(p, p.vx * dt, p.vy * dt);
  const moved = Math.hypot(p.x - ox, p.y - oy);
  p.bob += moved * 3.2; p.walkPhase += moved * 1.7;
  p.stepAcc += moved;
  if (p.stepAcc > 1.2) { p.stepAcc = 0; if (!p.walking && !p.crouch && p.onGround) { SFX.play('step'); makeNoise(p, p.x, p.y, 9); } }
  // crouch / jump
  p.eyeZ += ((p.crouch ? EYE_CROUCH : EYE_STAND) - p.eyeZ) * Math.min(1, dt * 12);
  if (keys.Space && p.onGround && !frozen && !G.buyOpen) { p.vz = 3.0; p.onGround = false; }
  if (!p.onGround) { p.jumpZ += p.vz * dt; p.vz -= 9.5 * dt; if (p.jumpZ <= 0) { p.jumpZ = 0; p.vz = 0; p.onGround = true; SFX.play('step'); } }

  // recoil view punch
  const rec = recoilFor(w, p.shots);
  p.punchP = lerp(p.punchP, rec[1] * 0.5, Math.min(1, dt * 20));
  p.punchY = lerp(p.punchY, rec[0] * 0.5, Math.min(1, dt * 20));
  p.kickP *= Math.exp(-dt * 12);
  p.vmKick *= Math.exp(-dt * 14);

  // scope re-zoom after the bolt
  if (p.rezoom && p.fireCd <= 0 && p.reloadT <= 0) { p.zoom = p.rezoom; p.rezoom = 0; }

  // shooting
  if (!G.buyOpen && G.phase !== 'freeze') {
    if (mouse.left && (w.auto || mouse.fresh)) playerFire(p);
    if (mouse.right && mouse.rightFresh) {
      if (w.sniper && p.reloadT <= 0 && p.switchT <= 0) { p.zoom = (p.zoom + 1) % 3; p.rezoom = 0; SFX.play('deploy'); }
      else if (w.kind === 'knife' && p.fireCd <= 0) knifeAttack(p, true);
      else if (w.kind === 'grenade') playerFire(p, true); // right click: short underhand lob
    }
  }
  mouse.fresh = false; mouse.rightFresh = false;

  // plant / defuse
  const b = G.bomb;
  if (keys.KeyE && p.team === 'T' && b.carrier === p && siteAt(p.x, p.y) && G.phase === 'live' && p.onGround) {
    if (!p.planting) { p.planting = 0.0001; p.zoom = 0; }
    p.planting += dt;
    if (Math.random() < dt * 6) SFX.play('plantkey');
    if (p.planting >= PLANT_TIME) plantBomb(p);
  } else p.planting = 0;
  if (keys.KeyE && p.team === 'CT' && b.state === 'planted' && G.phase === 'planted' && Math.hypot(p.x - b.x, p.y - b.y) < 1.2 && (!b.defuser || b.defuser === p)) {
    if (!b.defuser) { b.defuser = p; b.progress = 0; }
    p.defusing = true;
  } else { p.defusing = false; }

  // spot enemies on screen for the radar
  for (const e of G.agents) {
    if (!e.alive || e.team === p.team) continue;
    const da = Math.abs(angNorm(Math.atan2(e.y - p.y, e.x - p.x) - p.a));
    if (p.blindT <= 0.4 && da < CAM.fov * 0.55 && los(p.x, p.y, e.x, e.y) && !smokeBlocks(p.x, p.y, e.x, e.y)) e.spottedT = G.time;
  }
}
function onPlayerHurt(attacker, dmg, armored) {
  const p = G.player;
  SFX.play(armored ? 'armor' : 'hurt');
  p.kickP += 0.02;
  const v = $('dmg-vignette'); v.style.opacity = clamp(0.25 + dmg / 80, 0, 0.85);
  if (attacker) {
    const rel = angNorm(Math.atan2(attacker.y - p.y, attacker.x - p.x) - p.a);
    const dd = $('dmg-dir'); dd.style.transform = `translate(-50%,-50%) rotate(${rel}rad)`; dd.style.opacity = 1;
    G.dmgDirT = 1.2;
  }
}

// ============================== CAMERA =================================
function cameraOwner() {
  if (G.state !== 'playing') return null;
  const p = G.player;
  if (p.alive) return p;
  if (G.time - p.deathT < 2.2) return null;
  return spectateTarget();
}
function spectateTarget() {
  let list = G.agents.filter((a) => a.alive && a.team === G.player.team && !a.isPlayer);
  if (!list.length) list = G.agents.filter((a) => a.alive);
  if (!list.length) return null;
  return list[((G.specIdx % list.length) + list.length) % list.length];
}
function updateCamera(dt) {
  if (G.state !== 'playing') {
    // slow pan across A site behind the menu
    CAM.x = 33 + Math.sin(G.menuT * 0.07) * 1.5; CAM.y = 6.5; CAM.a = G.menuT * 0.12; CAM.pitch = 0.05; CAM.z = EYE_STAND; CAM.fov = BASE_FOV;
    return;
  }
  const p = G.player;
  if (p.alive) {
    CAM.x = p.x; CAM.y = p.y; CAM.a = p.a - p.punchY; CAM.pitch = clamp(p.pitch + p.punchP + p.kickP, -0.9, 0.9);
    CAM.z = p.eyeZ + p.jumpZ; CAM.fov = ZOOM_FOV[p.zoom];
  } else if (G.time - p.deathT < 2.2) {
    // death cam: drop to the floor, turn to the killer
    const k = Math.min(1, (G.time - p.deathT) / 0.6);
    CAM.x = p.x; CAM.y = p.y; CAM.z = lerp(p.eyeZ, 0.25, k); CAM.fov = BASE_FOV; CAM.pitch = lerp(CAM.pitch, 0.1, dt * 3);
    if (p.killer && p.killer !== p) CAM.a = angNorm(CAM.a + angNorm(Math.atan2(p.killer.y - p.y, p.killer.x - p.x) - CAM.a) * Math.min(1, dt * 3));
  } else {
    const s = spectateTarget();
    if (s) { CAM.x = s.x; CAM.y = s.y; CAM.a = angNorm(CAM.a + angNorm(s.a - CAM.a) * Math.min(1, dt * 12)); CAM.pitch = 0; CAM.z = EYE_STAND; CAM.fov = BASE_FOV; }
  }
  if (G.shake > 0) { G.shake -= dt; CAM.a += (Math.random() - 0.5) * 0.04 * G.shake; CAM.pitch += (Math.random() - 0.5) * 0.04 * G.shake; }
}

// ============================== ROUNDS =================================
function startMatch() {
  nextId = 1;
  G.agents = [];
  const pt = G.playerTeam, other = pt === 'T' ? 'CT' : 'T';
  G.player = makeAgent(pt, 'You', true);
  G.agents.push(G.player);
  for (let i = 0; i < 4; i++) G.agents.push(makeAgent(pt, BOT_NAMES[pt][i], false));
  for (let i = 0; i < 5; i++) G.agents.push(makeAgent(other, BOT_NAMES[other][i], false));
  G.score = { T: 0, CT: 0 }; G.lossStreak = { T: 0, CT: 0 }; G.round = 0; G.time = 0; G.halftimeDone = false;
  G.state = 'playing'; G.paused = false;
  $('menu').classList.add('hidden'); $('matchover').classList.add('hidden'); $('hud').classList.remove('hidden');
  $('killfeed').innerHTML = '';
  buildAliveBars();
  startRound();
}
// halftime: everyone swaps sides, money and gear reset
function swapSides() {
  G.halftimeDone = true;
  for (const a of G.agents) {
    a.team = a.team === 'T' ? 'CT' : 'T';
    a.inv = null; a.money = START_MONEY; a.armor = 0; a.helmet = false; a.kit = false;
    a.nades = { he: 0, flash: 0, smoke: 0 };
  }
  G.score = { T: G.score.CT, CT: G.score.T };
  G.lossStreak = { T: 0, CT: 0 };
  buildAliveBars();
}
function startRound() {
  G.round++;
  let halftime = false;
  if (!G.halftimeDone && G.round === G.winRounds) { swapSides(); halftime = true; }
  G.pistolRound = G.round === 1 || halftime;
  G.phase = 'freeze'; G.phaseT = FREEZE_TIME; G.roundT = ROUND_TIME;
  G.particles.length = 0; G.intel = { A: -99, B: -99 };
  G.nades.length = 0; G.smokes.length = 0; G.drops.length = 0;
  const b = G.bomb;
  Object.assign(b, { state: 'carried', carrier: null, timer: 0, defuser: null, progress: 0, site: null });
  const spawns = { T: shuffle(SPAWNS.T.slice()), CT: shuffle(SPAWNS.CT.slice()) };
  const idx = { T: 0, CT: 0 };
  for (const a of G.agents) {
    if (!a.alive || !a.inv) {
      a.inv = { primary: null, secondary: a.team === 'T' ? 'glock' : 'usp', knife: 'knife' };
      a.ammo = {}; giveWeapon(a, a.inv.secondary);
      a.armor = 0; a.helmet = false; a.kit = false;
      a.nades = { he: 0, flash: 0, smoke: 0 };
    } else {
      for (const k of [a.inv.primary, a.inv.secondary]) if (k) a.ammo[k] = { mag: WEAPONS[k].mag, res: WEAPONS[k].reserve };
    }
    a.alive = true; a.hp = 100; a.deathT = 0; a.killer = null;
    a.slot = a.inv.primary ? 'primary' : 'secondary';
    a.fireCd = 0; a.reloadT = 0; a.switchT = 0; a.shots = 0; a.zoom = 0; a.rezoom = 0; a.planting = 0; a.defusing = false;
    a.vx = 0; a.vy = 0; a.jumpZ = 0; a.vz = 0; a.onGround = true; a.punchP = 0; a.punchY = 0; a.kickP = 0;
    a.target = null; a.alertT = 0; a.hurtT = 0; a.spottedT = -99; a.dmgDealt = 0;
    a.blindT = 0; a.tagT = 0; a.throwT = 0; a.nadeAt = 0;
    a.inv.grenade = nextNade(a);
    const s = spawns[a.team][idx[a.team]++ % spawns[a.team].length];
    a.x = s[0] + 0.5; a.y = s[1] + 0.5;
    a.a = a.team === 'T' ? -Math.PI / 2 + rand(-0.3, 0.3) : Math.PI / 2 + rand(-0.3, 0.3);
    a.pitch = 0;
  }
  // bomb to the player if they're a T, otherwise a random T
  const ts = G.agents.filter((a) => a.team === 'T');
  b.carrier = G.player.team === 'T' ? G.player : pick(ts);
  for (const a of G.agents) if (!a.isPlayer) botBuy(a);
  assignPlans();
  G.msg.t = 0;
  const hint = G.player.team === 'T' ? 'Buy phase: press B. You carry the bomb.' : 'Buy phase: press B. Defend A and B.';
  showMsg(halftime ? 'Halftime: switching sides' : `Round ${G.round}`, halftime ? `You are now ${G.player.team === 'T' ? 'a Terrorist' : 'a Counter-Terrorist'}. ${hint}` : hint, halftime ? 4.5 : 3, halftime ? (G.player.team === 'T' ? 't' : 'ct') : '');
  closeBuy(true);
}
function endRound(winner, reason) {
  if (G.phase === 'over') return;
  G.phase = 'over'; G.phaseT = ROUND_END_TIME;
  const loser = winner === 'T' ? 'CT' : 'T';
  G.score[winner]++;
  G.lossStreak[winner] = 0; G.lossStreak[loser] = Math.min(G.lossStreak[loser] + 1, 5);
  const winMoney = reason === 'Target bombed' || reason === 'Bomb defused' ? 3500 : 3250;
  const lossMoney = 1400 + 500 * (G.lossStreak[loser] - 1);
  for (const a of G.agents) {
    if (a.team === winner) addMoney(a, winMoney);
    else addMoney(a, lossMoney + (a.team === 'T' && G.bomb.state !== 'carried' && G.bomb.state !== 'dropped' ? 800 : 0));
    a.planting = 0; a.defusing = false;
  }
  const mine = winner === G.player.team;
  showMsg(winner === 'T' ? 'Terrorists win' : 'Counter-Terrorists win', reason, ROUND_END_TIME, winner === 'T' ? 't' : 'ct');
  SFX.play(mine ? 'win' : 'lose');
}
function updateRound(dt) {
  if (G.phase === 'freeze') {
    G.phaseT -= dt;
    if (G.phaseT <= 0) { G.phase = 'live'; SFX.play('go'); showMsg('Go go go!', '', 1.2, ''); }
    return;
  }
  if (G.phase === 'over') {
    G.phaseT -= dt;
    if (G.phaseT <= 0) {
      if (G.score.T >= G.winRounds || G.score.CT >= G.winRounds) endMatch();
      else startRound();
    }
    return;
  }
  if (G.phase === 'live') {
    G.roundT -= dt;
    if (G.roundT <= 0) { G.roundT = 0; endRound('CT', 'Time ran out'); return; }
  }
  const aliveT = alive('T').length, aliveCT = alive('CT').length;
  if (aliveCT === 0) { endRound('T', 'Enemies eliminated'); return; }
  if (aliveT === 0 && G.phase === 'live') { endRound('CT', 'Enemies eliminated'); return; }
}
function endMatch() {
  G.state = 'matchover';
  document.exitPointerLock && document.exitPointerLock();
  const won = G.score[G.player.team] >= G.winRounds;
  $('mo-title').textContent = won ? 'Victory' : 'Defeat';
  $('mo-title').className = won ? 'win' : 'lose';
  $('mo-sub').textContent = `Terrorists ${G.score.T} : ${G.score.CT} Counter-Terrorists`;
  $('mo-board').innerHTML = scoreboardHTML(true);
  $('hud').classList.add('hidden'); $('scope').classList.add('hidden');
  $('matchover').classList.remove('hidden');
}

// ================================ UPDATE ===============================
function update(dt) {
  updateRound(dt);
  if (G.state !== 'playing') return;
  for (const a of G.agents) if (a.alive) updateWeaponTimers(a, dt);
  updatePlayer(dt);
  for (const a of G.agents) if (a.alive && !a.isPlayer) updateBot(a, dt);
  // keep agents from overlapping
  const list = alive();
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d > 0 && d < 0.46) {
      const push = (0.46 - d) * 0.5, nx = (dx / d) * push, ny = (dy / d) * push;
      if (!collides(a.x - nx, a.y - ny, RADIUS)) { a.x -= nx; a.y -= ny; }
      if (!collides(b.x + nx, b.y + ny, RADIUS)) { b.x += nx; b.y += ny; }
    }
  }
  updateBomb(dt);
  updateNades(dt);
  updateDrops(dt);
  for (let i = G.particles.length - 1; i >= 0; i--) {
    const pt = G.particles[i];
    pt.life -= dt;
    if (pt.life <= 0) { G.particles.splice(i, 1); continue; }
    pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.z = Math.max(0.02, pt.z + pt.vz * dt);
    if (!pt.grow) pt.vz -= 4 * dt;
    pt.vx *= 0.94; pt.vy *= 0.94;
  }
  if (G.flash > 0) G.flash -= dt * 0.8;
}

// ================================= HUD =================================
const textCache = new Map();
function setText(id, v) { if (textCache.get(id) === v) return; textCache.set(id, v); $(id).textContent = v; }
function setClass(el, cls, on) { if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on); }
const fmtTime = (t) => { t = Math.max(0, Math.ceil(t)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
function showMsg(text, sub, t, cls) { G.msg = { text, sub, t, cls }; setText('center-msg', text); setText('sub-msg', sub); $('center-msg').className = cls || ''; }
function popMoney(amt) {
  const el = $('money-pop'); el.textContent = (amt > 0 ? '+$' : '-$') + Math.abs(amt);
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
function buildAliveBars() {
  for (const team of ['T', 'CT']) {
    const el = $(team === 'T' ? 'alive-t' : 'alive-ct'); el.innerHTML = '';
    for (const a of G.agents.filter((x) => x.team === team)) { const i = document.createElement('i'); i.dataset.id = a.id; if (a.isPlayer) i.className = 'me'; el.appendChild(i); }
  }
}
function addKillfeed(k, v, wkey, hs) {
  const el = document.createElement('div');
  el.className = 'kf' + ((k && k.isPlayer) || v.isPlayer ? ' mine' : '');
  const name = (a) => `<span class="${a.team === 'T' ? 't' : 'ct'}">${a.name}</span>`;
  const wname = wkey === 'bomb' ? 'C4' : WEAPONS[wkey] ? WEAPONS[wkey].name : '';
  el.innerHTML = `${k && k !== v ? name(k) : ''}<em>${wname}${hs ? ' <b class="hs">HS</b>' : ''}</em>${name(v)}`;
  const feed = $('killfeed'); feed.prepend(el);
  while (feed.children.length > 6) feed.lastChild.remove();
  setTimeout(() => el.classList.add('fade'), 6000);
  setTimeout(() => el.remove(), 6800);
}

let radarBg = null;
const RADAR_PX = 8;
function buildRadarBg() {
  radarBg = document.createElement('canvas');
  radarBg.width = MAP_W * RADAR_PX; radarBg.height = MAP_H * RADAR_PX;
  const g = radarBg.getContext('2d');
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const ch = MAP_SRC[y][x];
    if (ch in WALL_IDS) g.fillStyle = ch === 'C' ? 'rgba(70,58,40,0.9)' : 'rgba(18,20,22,0.9)';
    else if (ch === 'a' || ch === 'b') g.fillStyle = 'rgba(150,90,70,0.85)';
    else g.fillStyle = 'rgba(120,112,96,0.85)';
    g.fillRect(x * RADAR_PX, y * RADAR_PX, RADAR_PX, RADAR_PX);
  }
  g.font = 'bold 34px sans-serif'; g.fillStyle = 'rgba(255,220,180,0.75)'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('A', 33 * RADAR_PX, 6 * RADAR_PX); g.fillText('B', 6.5 * RADAR_PX, 6 * RADAR_PX);
}
function drawRadar() {
  const c = $('radar'), g = c.getContext('2d'), S = c.width;
  g.clearRect(0, 0, S, S);
  g.save();
  g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, TAU); g.clip();
  g.fillStyle = 'rgba(8,10,12,0.75)'; g.fillRect(0, 0, S, S);
  g.translate(S / 2, S / 2);
  g.rotate(-Math.PI / 2 - CAM.a);
  g.translate(-CAM.x * RADAR_PX, -CAM.y * RADAR_PX);
  g.drawImage(radarBg, 0, 0);
  for (const sm of G.smokes) { g.fillStyle = `rgba(200,200,195,${0.75 * smokeDensity(sm)})`; g.beginPath(); g.arc(sm.x * RADAR_PX, sm.y * RADAR_PX, sm.r * RADAR_PX, 0, TAU); g.fill(); }
  const pt = G.player.team;
  for (const a of G.agents) {
    if (a === G.player && a.alive) continue;
    const mineTeam = a.team === pt;
    if (!mineTeam && (!a.alive || G.time - a.spottedT > 1.2)) continue;
    const x = a.x * RADAR_PX, y = a.y * RADAR_PX;
    if (!a.alive) { g.strokeStyle = mineTeam ? '#8fb3ff' : '#ff6a5a'; g.lineWidth = 2; g.beginPath(); g.moveTo(x - 4, y - 4); g.lineTo(x + 4, y + 4); g.moveTo(x + 4, y - 4); g.lineTo(x - 4, y + 4); g.stroke(); continue; }
    g.fillStyle = mineTeam ? (a.team === 'T' ? '#f2c14e' : '#6fa8ff') : '#ff4a3a';
    g.beginPath(); g.arc(x, y, 5, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1.5; g.stroke();
  }
  const b = G.bomb;
  const bombKnown = b.state === 'planted' || b.state === 'dropped' && (pt === 'T') || b.state === 'carried' && b.carrier && b.carrier.team === pt;
  if (bombKnown && b.state !== 'exploded') {
    const bx = (b.state === 'carried' ? b.carrier.x : b.x) * RADAR_PX, by = (b.state === 'carried' ? b.carrier.y : b.y) * RADAR_PX;
    g.fillStyle = b.state === 'planted' && (G.time * 4) % 2 < 1 ? '#ff2a1a' : '#ff9a2a';
    g.fillRect(bx - 4, by - 3, 8, 6);
  }
  g.restore();
  // player arrow
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(S / 2, S / 2 - 8); g.lineTo(S / 2 + 6, S / 2 + 6); g.lineTo(S / 2, S / 2 + 3); g.lineTo(S / 2 - 6, S / 2 + 6); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 2; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, TAU); g.stroke();
}

function scoreboardHTML(final) {
  const rows = (team) => G.agents.filter((a) => a.team === team).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths).map((a) =>
    `<tr class="${a.isPlayer ? 'me' : ''} ${a.alive || final ? '' : 'dead'}"><td>${a.name}</td><td>${a.kills}</td><td>${a.deaths}</td><td>${team === G.player.team || final ? '$' + a.money : ''}</td></tr>`).join('');
  return ['T', 'CT'].map((team) => `<div class="sb-team ${team === 'T' ? 't' : 'ct'}"><div class="sb-head"><b>${team === 'T' ? 'Terrorists' : 'Counter-Terrorists'}</b><span>${G.score[team]}</span></div><table><tr><th>Player</th><th>K</th><th>D</th><th>Money</th></tr>${rows(team)}</table></div>`).join('');
}

function updateHUD(dt) {
  if (G.state !== 'playing') return;
  const p = G.player, spec = p.alive ? p : spectateTarget() || p;
  const key = curWeapon(spec), w = WEAPONS[key];
  setText('hp', String(Math.max(0, Math.ceil(spec.hp))));
  setText('armor', String(Math.ceil(spec.armor)));
  setClass($('vitals'), 'low', spec.hp <= 25);
  setText('money', '$' + p.money);
  setClass($('buyzone'), 'hidden', !canBuy(p));
  setText('weapon-name', w.name);
  const am = spec.ammo[key];
  setText('ammo-mag', am ? String(am.mag) : '');
  setText('ammo-res', am ? '/ ' + am.res : '');
  setClass($('ammo'), 'low', !!am && am.mag <= Math.ceil(w.mag * 0.2));
  setClass($('bomb-carried'), 'hidden', G.bomb.carrier !== spec || G.bomb.state !== 'carried');
  // grenade slot lists every grenade carried; the one in hand is bold
  const nadeTxt = NADES.filter((k) => spec.nades[k] > 0).map((k) => {
    const t = WEAPONS[k].short + (spec.nades[k] > 1 ? ' ×' + spec.nades[k] : '');
    return spec.slot === 'grenade' && spec.inv.grenade === k ? `<b>${t}</b>` : t;
  }).join(' · ');
  const inv = ['primary', 'secondary', 'knife', 'grenade'].map((s, i) => {
    if (!spec.inv[s]) return '';
    return `<span class="${spec.slot === s ? 'on' : ''}"><kbd>${i + 1}</kbd>${s === 'grenade' ? nadeTxt : WEAPONS[spec.inv[s]].name}</span>`;
  }).join('');
  if (textCache.get('inventory') !== inv) { textCache.set('inventory', inv); $('inventory').innerHTML = inv; }

  setText('score-t', String(G.score.T)); setText('score-ct', String(G.score.CT));
  setText('round-label', G.phase === 'freeze' ? 'Buy phase' : `Round ${G.round}`);
  const tb = $('timer');
  if (G.phase === 'planted') { setText('timer', 'C4'); setClass(tb, 'bomb', true); tb.style.opacity = (G.time * (G.bomb.timer < 10 ? 6 : 2)) % 2 < 1 ? 1 : 0.35; }
  else { setClass(tb, 'bomb', false); tb.style.opacity = 1; setText('timer', fmtTime(G.phase === 'freeze' ? G.phaseT : G.phase === 'over' ? 0 : G.roundT)); }
  for (const i of document.querySelectorAll('.alive i')) { const a = G.agents.find((x) => x.id == i.dataset.id); setClass(i, 'dead', !a || !a.alive); }
  setText('location', regionAt(spec.x, spec.y));

  // crosshair
  const ch = $('crosshair');
  const scoped = p.alive && w.sniper && p.zoom > 0 && p.fireCd <= 0.05 && p.reloadT <= 0;
  setClass($('scope'), 'hidden', !scoped);
  // static crosshair: fixed size, never spreads while moving or shooting
  const hideCh = !p.alive || scoped || (w.sniper && p.alive) || G.buyOpen;
  setClass(ch, 'hidden', hideCh);

  // messages / hints
  if (G.msg.t > 0) { G.msg.t -= dt; if (G.msg.t <= 0) { setText('center-msg', ''); setText('sub-msg', ''); } }
  let hint = '';
  const b = G.bomb;
  if (p.alive) {
    if (p.team === 'T' && b.carrier === p && G.phase === 'live') hint = siteAt(p.x, p.y) ? 'Hold E to plant the bomb' : 'You have the bomb: plant it at A or B';
    else if (p.team === 'T' && b.state === 'dropped') hint = 'The bomb was dropped: walk over it to pick it up';
    else if (p.team === 'CT' && G.phase === 'planted' && Math.hypot(p.x - b.x, p.y - b.y) < 1.2) hint = p.kit ? 'Hold E to defuse (kit: 5s)' : 'Hold E to defuse (10s)';
    else if (p.team === 'CT' && G.phase === 'planted') hint = `Bomb planted at ${b.site}: find it and defuse`;
  }
  setText('hint', hint);
  const prog = $('progress');
  const planting = p.planting > 0, defusing = b.defuser === p && p.defusing;
  setClass(prog, 'hidden', !(planting || defusing));
  if (planting) { setText('progress-label', 'Planting the bomb'); $('progress-fill').style.width = (p.planting / PLANT_TIME) * 100 + '%'; }
  if (defusing) { setText('progress-label', 'Defusing'); $('progress-fill').style.width = (b.progress / (p.kit ? KIT_DEFUSE_TIME : DEFUSE_TIME)) * 100 + '%'; }

  // spectating
  const specEl = $('spectate');
  const specOn = !p.alive && G.time - p.deathT > 2.2 && spectateTarget();
  setClass(specEl, 'hidden', !specOn);
  if (specOn) setText('spectate', `Spectating ${spectateTarget().name} · click to switch`);
  else if (!p.alive && p.killer && p.killer !== p) { setText('spectate', `Killed by ${p.killer.name}`); setClass(specEl, 'hidden', false); }

  // damage feedback fades
  const v = $('dmg-vignette'); const vo = parseFloat(v.style.opacity || 0); if (vo > 0 && p.alive) v.style.opacity = Math.max(0, vo - dt * 1.2).toFixed(3);
  if (G.dmgDirT > 0) { G.dmgDirT -= dt; $('dmg-dir').style.opacity = clamp(G.dmgDirT, 0, 1).toFixed(2); }
  $('flash').style.opacity = clamp(Math.max(G.flash, p.alive ? p.blindT / 1.3 : 0), 0, 1).toFixed(2);

  if (G.boardOpen) { const html = scoreboardHTML(false); if (textCache.get('board') !== html) { textCache.set('board', html); $('scoreboard').innerHTML = html; } }
  drawRadar();
}

// ============================== BUY MENU ===============================
const NADE_INFO = { he: 'Explodes after 1.6s', flash: 'Blinds anyone looking at it', smoke: 'Blocks vision for 16s' };
function renderBuyMenu() {
  const p = G.player;
  setText('buy-money', '$' + p.money);
  let html = '';
  BUY_LIST[p.team].forEach(([cat, items], ci) => {
    const open = G.buyCat === ci;
    html += `<div class="buy-cat ${open ? 'open' : ''}"><h3><kbd>${ci + 1}</kbd>${cat}</h3>`;
    items.forEach((k, ii) => {
      const w = WEAPONS[k], gear = GEAR[k];
      let price = w ? w.price : gear.price;
      if (k === 'helmet' && p.armor >= 100 && !p.helmet) price = 350;
      const nade = w && w.kind === 'grenade';
      const owned = nade ? !canHoldNade(p, k) : w ? p.inv[w.slot] === k : (k === 'kevlar' && p.armor >= 100) || (k === 'helmet' && p.helmet && p.armor >= 100) || (k === 'kit' && p.kit);
      const afford = p.money >= price;
      const stat = nade ? NADE_INFO[k] : w && w.dmg && w.mag ? `${w.dmg}${w.pellets ? '×' + w.pellets : ''} dmg · ${w.mag} rds` : gear ? (k === 'kit' ? 'Defuse in 5s' : k === 'helmet' ? 'Protects your head' : 'Body armor') : '';
      const ownedTxt = nade ? (p.nades[k] >= w.max ? 'Max carried' : 'Grenade limit') : 'Owned';
      html += `<button class="buy-item ${owned ? 'owned' : ''} ${afford ? '' : 'poor'}" data-k="${k}"><kbd>${open ? ii + 1 : ''}</kbd><b>${w ? w.name : gear.name}</b><small>${stat}</small><span>${owned ? ownedTxt : '$' + price}</span></button>`;
    });
    html += '</div>';
  });
  $('buy-grid').innerHTML = html;
  for (const btn of $('buy-grid').querySelectorAll('.buy-item')) btn.onclick = () => doBuy(G.player, btn.dataset.k);
}
function openBuy() {
  if (!canBuy(G.player)) { SFX.play('deny'); return; }
  G.buyOpen = true; G.buyCat = null; renderBuyMenu();
  $('buy').classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}
function closeBuy(silent) {
  if (!G.buyOpen) return;
  G.buyOpen = false; $('buy').classList.add('hidden');
  if (!silent) lockPointer();
}

// ================================ INPUT ================================
function lockPointer() {
  try { const r = view.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* ignore */ }
}
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === view;
  if (locked) { G.paused = false; $('pause').classList.add('hidden'); }
  else if (G.state === 'playing' && !G.buyOpen) { G.paused = true; $('pause').classList.remove('hidden'); for (const k in keys) keys[k] = false; mouse.left = mouse.right = false; }
});
document.addEventListener('pointerlockerror', () => {
  if (G.state === 'playing' && !G.buyOpen) { G.paused = true; $('pause').classList.remove('hidden'); }
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== view) return;
  mouse.dx += e.movementX; mouse.dy += e.movementY;
});
view.addEventListener('mousedown', (e) => {
  if (G.state !== 'playing') return;
  if (document.pointerLockElement !== view && !G.buyOpen) { lockPointer(); return; }
  if (e.button === 0) {
    mouse.left = true; mouse.fresh = true;
    if (!G.player.alive) G.specIdx = (G.specIdx || 0) + 1;
  }
  if (e.button === 2) { mouse.right = true; mouse.rightFresh = true; }
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) mouse.left = false; if (e.button === 2) mouse.right = false; });
window.addEventListener('contextmenu', (e) => { if (G.state === 'playing') e.preventDefault(); });
window.addEventListener('wheel', (e) => {
  if (G.state !== 'playing' || G.buyOpen || !G.player.alive) return;
  const order = ['primary', 'secondary', 'knife', 'grenade'].filter((s) => G.player.inv[s]);
  const i = order.indexOf(G.player.slot);
  switchTo(G.player, order[(i + (e.deltaY > 0 ? 1 : -1) + order.length) % order.length]);
}, { passive: true });
window.addEventListener('keydown', (e) => {
  if (G.state !== 'playing') return;
  if (e.code === 'Tab' || e.ctrlKey || e.code === 'Space') e.preventDefault();
  if (e.repeat) { keys[e.code] = true; return; }
  keys[e.code] = true;
  const p = G.player;
  if (e.code === 'Tab') { G.boardOpen = true; $('scoreboard').classList.remove('hidden'); textCache.delete('board'); }
  if (G.buyOpen) {
    if (e.code === 'KeyB' || e.code === 'Escape') closeBuy(false);
    const m = e.code.match(/^Digit(\d)$/);
    if (m) {
      const n = +m[1] - 1, cats = BUY_LIST[p.team];
      if (G.buyCat === null) { if (cats[n]) { G.buyCat = n; renderBuyMenu(); } }
      else { const item = cats[G.buyCat][1][n]; G.buyCat = null; if (item) doBuy(p, item); else renderBuyMenu(); }
    }
    if (e.code === 'Backspace' && G.buyCat !== null) { G.buyCat = null; renderBuyMenu(); }
    return;
  }
  if (!p.alive) return;
  if (e.code === 'KeyB') openBuy();
  if (e.code === 'KeyR') startReload(p);
  if (e.code === 'Digit1') switchTo(p, 'primary');
  if (e.code === 'Digit2') switchTo(p, 'secondary');
  if (e.code === 'Digit3') switchTo(p, 'knife');
  if (e.code === 'Digit4') switchTo(p, 'grenade');
  if (e.code === 'KeyG' && p.slot !== 'knife' && p.slot !== 'grenade' && p.switchT <= 0) {
    const slot = p.slot;
    if (dropWeapon(p, slot, true)) { SFX.play('deploy'); p.slot = 'none'; switchTo(p, p.inv.primary ? 'primary' : p.inv.secondary ? 'secondary' : 'knife'); }
  }
  if (e.code === 'KeyQ') switchTo(p, p.inv[p.lastSlot] ? p.lastSlot : 'knife');
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Tab') { G.boardOpen = false; $('scoreboard').classList.add('hidden'); }
});
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.left = mouse.right = false; });
window.addEventListener('beforeunload', (e) => { if (G.state === 'playing') { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('resize', resizeView);

// ================================ MENUS ================================
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('strikepoint') || '{}');
    if (s.sens) G.sens = s.sens;
    if (s.team) G.playerTeam = s.team;
    if (s.diff !== undefined) G.difficulty = s.diff;
    if (s.rounds) G.winRounds = s.rounds;
    if (s.quality) G.quality = s.quality;
  } catch (e) { /* storage unavailable */ }
}
function saveSettings() {
  try { localStorage.setItem('strikepoint', JSON.stringify({ sens: G.sens, team: G.playerTeam, diff: G.difficulty, rounds: G.winRounds, quality: G.quality })); } catch (e) { /* ignore */ }
}
function syncMenu() {
  for (const b of document.querySelectorAll('.team-btn')) b.classList.toggle('selected', b.dataset.team === G.playerTeam);
  $('opt-diff').value = G.difficulty; $('opt-rounds').value = G.winRounds; $('opt-quality').value = G.quality;
  for (const id of ['opt-sens', 'pause-sens']) $(id).value = G.sens;
  $('sens-val').textContent = $('pause-sens-val').textContent = G.sens.toFixed(2);
}
function initMenus() {
  for (const b of document.querySelectorAll('.team-btn')) b.onclick = () => { G.playerTeam = b.dataset.team; syncMenu(); };
  $('opt-diff').onchange = (e) => { G.difficulty = +e.target.value; };
  $('opt-rounds').onchange = (e) => { G.winRounds = +e.target.value; };
  $('opt-quality').onchange = (e) => { G.quality = +e.target.value; resizeView(); };
  for (const id of ['opt-sens', 'pause-sens']) $(id).oninput = (e) => { G.sens = +e.target.value; syncMenu(); saveSettings(); };
  $('start-btn').onclick = () => { SFX.init(); saveSettings(); resizeView(); startMatch(); lockPointer(); };
  $('resume-btn').onclick = () => { SFX.init(); lockPointer(); G.paused = false; $('pause').classList.add('hidden'); };
  $('quit-btn').onclick = () => toMenu();
  $('again-btn').onclick = () => { SFX.init(); startMatch(); lockPointer(); };
  $('menu-btn').onclick = () => toMenu();
  $('buy-close').onclick = () => closeBuy(false);
  syncMenu();
}
function toMenu() {
  G.state = 'menu'; G.paused = false; G.buyOpen = false;
  for (const id of ['pause', 'matchover', 'hud', 'buy', 'scope', 'scoreboard']) $(id).classList.add('hidden');
  $('menu').classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}

// ============================== MAIN LOOP ==============================
let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (G.state === 'playing' && !G.paused) { G.time += dt; update(dt); }
  else if (G.state === 'menu') G.menuT += dt;
  updateCamera(dt);
  render3D();
  drawViewmodel();
  updateHUD(dt);
}

loadSettings();
buildTextures();
buildRadarBg();
resizeView();
initMenus();
requestAnimationFrame(frame);

// handy for debugging from the console
window.__strike = { G, TEX, drawViewmodel, update, startMatch, startRound, plantBomb, render3D, updateCamera, mouse, keys, WEAPONS, CAM };
