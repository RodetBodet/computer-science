'use strict';
/* =====================================================================
   TEXTURES: every surface is painted on a canvas at startup.
   Each entry also says how many meters one texture tile covers.
   ===================================================================== */
const TEXDEF = {};

function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function noiseLayer(g, w, h, amt, seed, mono = true) {
  const img = g.getImageData(0, 0, w, h), d = img.data, rng = mulberry32(seed);
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * amt;
    d[i] += n; d[i + 1] += mono ? n : (rng() - 0.5) * amt; d[i + 2] += mono ? n : (rng() - 0.5) * amt;
  }
  g.putImageData(img, 0, 0);
}
function blotch(g, w, h, rng, n, color, alpha, size) {
  for (let i = 0; i < n; i++) {
    const x = rng() * w, y = rng() * h, r = size * (0.4 + rng());
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${color},${alpha * (0.4 + rng() * 0.6)})`); gr.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = gr;
    for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { g.save(); g.translate(ox, oy); g.fillRect(x - r, y - r, r * 2, r * 2); g.restore(); }
  }
}
function grime(g, w, h, strength) {
  const gr = g.createLinearGradient(0, h * 0.55, 0, h);
  gr.addColorStop(0, 'rgba(40,32,24,0)'); gr.addColorStop(1, `rgba(40,32,24,${strength})`);
  g.fillStyle = gr; g.fillRect(0, h * 0.55, w, h * 0.45);
}

const PAINTERS = {
  concrete(g, w, h, rng) { // painted concrete wall panels (tile = 4 m wide, 4 m tall)
    g.fillStyle = '#b9b4aa'; g.fillRect(0, 0, w, h);
    blotch(g, w, h, rng, 40, '255,250,240', 0.12, 40); blotch(g, w, h, rng, 50, '90,84,74', 0.1, 30);
    g.fillStyle = 'rgba(60,56,50,0.45)'; g.fillRect(w / 2 - 1, 0, 2, h); g.fillRect(0, 0, 2, h); g.fillRect(0, h / 2 - 1, w, 2);
    for (const [x, y] of [[20, 20], [w / 2 - 20, 20], [w / 2 + 20, 20], [w - 20, 20], [20, h / 2 + 20], [w - 20, h / 2 + 20], [w / 2 - 20, h / 2 + 20], [w / 2 + 20, h / 2 + 20]]) { g.fillStyle = 'rgba(50,46,40,0.5)'; g.beginPath(); g.arc(x, y, 3, 0, TAU); g.fill(); }
    for (let i = 0; i < 6; i++) { const x = rng() * w; g.fillStyle = 'rgba(70,58,44,0.18)'; g.fillRect(x, rng() * h * 0.5, 3 + rng() * 4, h * 0.3 + rng() * h * 0.4); } // rain streaks
    grime(g, w, h, 0.35); noiseLayer(g, w, h, 18, 1);
  },
  brick(g, w, h, rng) { // tile = 2 m
    g.fillStyle = '#6b5448'; g.fillRect(0, 0, w, h);
    const bh = h / 16, bw = w / 6;
    for (let r = 0; r < 16; r++) for (let c = -1; c < 7; c++) {
      const x = c * bw + (r % 2) * bw / 2, t = 0.75 + rng() * 0.35;
      g.fillStyle = `rgb(${142 * t | 0},${70 * t | 0},${52 * t | 0})`; g.fillRect(x + 2, r * bh + 2, bw - 4, bh - 4);
      g.fillStyle = 'rgba(255,220,200,0.08)'; g.fillRect(x + 2, r * bh + 2, bw - 4, 2);
    }
    blotch(g, w, h, rng, 20, '40,30,25', 0.25, 50); grime(g, w, h, 0.3); noiseLayer(g, w, h, 22, 2);
  },
  corrugated(g, w, h, rng) { // vertical metal siding (tile = 2 m)
    for (let x = 0; x < w; x++) { const s = 0.72 + 0.28 * Math.sin((x / w) * TAU * 12); g.fillStyle = `rgb(${96 * s | 0},${116 * s | 0},${128 * s | 0})`; g.fillRect(x, 0, 1, h); }
    blotch(g, w, h, rng, 30, '140,90,60', 0.18, 26); blotch(g, w, h, rng, 20, '230,235,240', 0.08, 40);
    g.fillStyle = 'rgba(30,30,30,0.35)'; g.fillRect(0, h * 0.5 - 1, w, 2);
    grime(g, w, h, 0.4); noiseLayer(g, w, h, 14, 3);
  },
  plaster(g, w, h, rng) { // warm plaster (tile = 4 m)
    g.fillStyle = '#c9b9a0'; g.fillRect(0, 0, w, h);
    blotch(g, w, h, rng, 50, '255,245,225', 0.15, 36); blotch(g, w, h, rng, 40, '120,100,80', 0.12, 30);
    for (let i = 0; i < 3; i++) { const x = rng() * w * 0.8, y = rng() * h * 0.7; g.fillStyle = 'rgba(150,90,70,0.6)'; g.fillRect(x, y, 30 + rng() * 40, 18 + rng() * 26); }
    grime(g, w, h, 0.32); noiseLayer(g, w, h, 16, 4);
  },
  concreteFloor(g, w, h, rng) { // tile = 4 m, 2x2 slabs
    g.fillStyle = '#9a968e'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { const t = 0.92 + rng() * 0.12; g.fillStyle = `rgba(${150 * t | 0},${146 * t | 0},${138 * t | 0},1)`; g.fillRect(x * w / 2 + 2, y * h / 2 + 2, w / 2 - 4, h / 2 - 4); }
    blotch(g, w, h, rng, 40, '60,56,50', 0.14, 30); blotch(g, w, h, rng, 20, '230,225,215', 0.1, 40);
    noiseLayer(g, w, h, 20, 5);
  },
  asphalt(g, w, h, rng) { // tile = 4 m
    g.fillStyle = '#4c4b4a'; g.fillRect(0, 0, w, h);
    noiseLayer(g, w, h, 34, 6);
    blotch(g, w, h, rng, 30, '20,20,20', 0.25, 34); blotch(g, w, h, rng, 20, '120,118,112', 0.12, 30);
    g.strokeStyle = 'rgba(20,20,20,0.6)'; g.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) { let x = rng() * w, y = rng() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (rng() - 0.5) * 40; y += (rng() - 0.5) * 40; g.lineTo(x, y); } g.stroke(); }
  },
  warehouseFloor(g, w, h, rng) { // epoxy floor (tile = 4 m)
    g.fillStyle = '#6e7468'; g.fillRect(0, 0, w, h);
    blotch(g, w, h, rng, 50, '40,44,38', 0.2, 30); blotch(g, w, h, rng, 25, '170,176,160', 0.1, 40);
    for (let i = 0; i < 12; i++) { g.strokeStyle = 'rgba(30,30,28,0.25)'; g.lineWidth = 2; g.beginPath(); const x = rng() * w, y = rng() * h; g.arc(x, y, 20 + rng() * 40, rng() * 3, rng() * 3 + 1.5); g.stroke(); } // tire marks
    noiseLayer(g, w, h, 16, 7);
  },
  pavers(g, w, h, rng) { // tile = 2 m
    g.fillStyle = '#5d5953'; g.fillRect(0, 0, w, h);
    const n = 8, s = w / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const t = 0.85 + rng() * 0.25; g.fillStyle = `rgb(${150 * t | 0},${140 * t | 0},${128 * t | 0})`; g.fillRect(x * s + 2, y * s + 2, s - 4, s - 4); }
    blotch(g, w, h, rng, 20, '40,36,30', 0.2, 30); noiseLayer(g, w, h, 16, 8);
  },
  grate(g, w, h, rng) { // metal grating (tile = 1 m)
    g.fillStyle = '#26282a'; g.fillRect(0, 0, w, h);
    const n = 10, s = w / n;
    for (let i = 0; i <= n; i++) { g.fillStyle = '#5d6266'; g.fillRect(i * s - 2, 0, 4, h); g.fillRect(0, i * s - 2, w, 4); g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(i * s - 2, 0, 1, h); }
    blotch(g, w, h, rng, 12, '130,80,40', 0.3, 20); noiseLayer(g, w, h, 18, 9);
  },
  metal(g, w, h, rng) { // steel plate (tile = 2 m)
    g.fillStyle = '#6a6f72'; g.fillRect(0, 0, w, h);
    blotch(g, w, h, rng, 30, '140,90,50', 0.18, 24); blotch(g, w, h, rng, 20, '200,205,210', 0.12, 30);
    g.fillStyle = 'rgba(30,30,30,0.5)'; g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 2, h); g.fillRect(w / 2, 0, 2, h);
    for (let x = 8; x < w; x += w / 2) for (let y = 8; y < h; y += 30) { g.fillStyle = 'rgba(20,20,20,0.5)'; g.fillRect(x, y, 3, 3); }
    noiseLayer(g, w, h, 16, 10);
  },
  crate(g, w, h, rng) { // wooden crate face (tile = 1.2 m)
    g.fillStyle = '#9a6f42'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += h / 6) { const t = 0.85 + rng() * 0.25; g.fillStyle = `rgb(${160 * t | 0},${116 * t | 0},${70 * t | 0})`; g.fillRect(0, y + 1, w, h / 6 - 2); g.fillStyle = 'rgba(60,36,16,0.6)'; g.fillRect(0, y, w, 2); }
    for (let i = 0; i < 40; i++) { g.strokeStyle = 'rgba(80,50,22,0.25)'; g.beginPath(); const y = rng() * h; g.moveTo(0, y); g.bezierCurveTo(w / 3, y + rng() * 8 - 4, w * 2 / 3, y + rng() * 8 - 4, w, y); g.stroke(); }
    g.strokeStyle = '#6c4a26'; g.lineWidth = w * 0.09; g.strokeRect(w * 0.045, h * 0.045, w * 0.91, h * 0.91);
    g.beginPath(); g.moveTo(w * 0.1, h * 0.9); g.lineTo(w * 0.9, h * 0.1); g.stroke();
    g.fillStyle = 'rgba(30,20,10,0.7)'; for (const [x, y] of [[0.05, 0.05], [0.95, 0.05], [0.05, 0.95], [0.95, 0.95]]) g.fillRect(x * w - 3, y * h - 3, 6, 6);
    g.fillStyle = 'rgba(30,30,30,0.55)'; g.font = `bold ${w * 0.08}px monospace`; g.fillText('FRAGILE', w * 0.3, h * 0.75);
    noiseLayer(g, w, h, 16, 11);
  },
  vehicle(g, w, h, rng) { // painted metal panels (tile = 2 m)
    g.fillStyle = '#d8d6cf'; g.fillRect(0, 0, w, h);
    blotch(g, w, h, rng, 20, '90,80,70', 0.18, 30);
    g.fillStyle = '#2f5d8a'; g.fillRect(0, h * 0.62, w, h * 0.1);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(w * 0.48, 0, 2, h);
    grime(g, w, h, 0.4); noiseLayer(g, w, h, 12, 12);
  },
  dumpster(g, w, h, rng) {
    g.fillStyle = '#2f5a3a'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += w / 8) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, 0, 3, h); }
    blotch(g, w, h, rng, 30, '120,70,40', 0.3, 20); grime(g, w, h, 0.4); noiseLayer(g, w, h, 16, 13);
  },
  barrier(g, w, h, rng) {
    g.fillStyle = '#a8a49a'; g.fillRect(0, 0, w, h);
    for (let x = -h; x < w; x += 60) { g.fillStyle = 'rgba(200,60,40,0.85)'; g.beginPath(); g.moveTo(x, h); g.lineTo(x + 30, h); g.lineTo(x + 30 + h * 0.4, 0); g.lineTo(x + h * 0.4, 0); g.fill(); }
    blotch(g, w, h, rng, 20, '60,56,50', 0.2, 30); noiseLayer(g, w, h, 18, 14);
  },
  roof(g, w, h, rng) { // underside of roofs: beams + panels (tile = 4 m)
    g.fillStyle = '#4b4f52'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += w / 4) { g.fillStyle = '#2b2e30'; g.fillRect(x, 0, 10, h); }
    blotch(g, w, h, rng, 20, '20,20,20', 0.3, 40); noiseLayer(g, w, h, 12, 15);
  },
  railing(g, w, h) { g.fillStyle = '#c8a628'; g.fillRect(0, 0, w, h); noiseLayer(g, w, h, 20, 16); },
};
function containerPainter(base) {
  return (g, w, h, rng) => { // tile = 2.6 m (one container height)
    const [r, gg, b] = base;
    for (let x = 0; x < w; x++) { const s = 0.7 + 0.3 * Math.abs(Math.sin((x / w) * Math.PI * 10)); g.fillStyle = `rgb(${r * s | 0},${gg * s | 0},${b * s | 0})`; g.fillRect(x, 0, 1, h); }
    g.fillStyle = 'rgba(20,20,20,0.5)'; g.fillRect(0, 0, w, h * 0.04); g.fillRect(0, h * 0.96, w, h * 0.04);
    blotch(g, w, h, rng, 30, '120,70,40', 0.3, 18); blotch(g, w, h, rng, 15, '255,255,255', 0.06, 40);
    g.fillStyle = 'rgba(240,240,235,0.8)'; g.font = `bold ${h * 0.09}px monospace`; g.fillText('DKSU ' + (100000 + (rng() * 899999 | 0)), w * 0.12, h * 0.2);
    grime(g, w, h, 0.35); noiseLayer(g, w, h, 14, 17);
  };
}
const CONTAINER_COLORS = { red: [150, 46, 36], blue: [40, 78, 130], green: [52, 104, 64], orange: [196, 98, 34], yellow: [190, 150, 40] };

// meters covered by one tile, texture size, roughness, metalness
const MATDEFS = {
  concrete: ['concrete', 4, 512, 0.95, 0], block: ['concrete', 4, 512, 0.95, 0], brick: ['brick', 2, 512, 0.95, 0], corrugated: ['corrugated', 2, 256, 0.6, 0.4],
  plaster: ['plaster', 4, 512, 0.95, 0], concreteFloor: ['concreteFloor', 4, 512, 0.95, 0], asphalt: ['asphalt', 4, 512, 0.98, 0],
  warehouseFloor: ['warehouseFloor', 4, 512, 0.7, 0.05], pavers: ['pavers', 2, 256, 0.95, 0], grate: ['grate', 1, 256, 0.6, 0.6],
  metal: ['metal', 2, 256, 0.55, 0.55], crate: ['crate', 1.2, 256, 0.9, 0], vehicle: ['vehicle', 2, 256, 0.5, 0.3],
  dumpster: ['dumpster', 2, 256, 0.7, 0.3], barrier: ['barrier', 2, 256, 0.95, 0], roof: ['roof', 4, 256, 0.9, 0.2],
  railing: ['railing', 1, 64, 0.5, 0.5], pallet: ['crate', 1.2, 256, 0.95, 0],
};
for (const c in CONTAINER_COLORS) MATDEFS['container_' + c] = ['container_' + c, 2.6, 256, 0.6, 0.35];

const MATERIALS = {};
function buildMaterials() {
  for (const key in MATDEFS) {
    const [painter, meters, size, rough, metal] = MATDEFS[key];
    const c = makeCanvas(size, size), g = c.getContext('2d');
    const fn = PAINTERS[painter] || containerPainter(CONTAINER_COLORS[painter.split('_')[1]]);
    fn(g, size, size, mulberry32(hash2(size, painter.length * 31 + key.length)));
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    MATERIALS[key] = new THREE.MeshStandardMaterial({ map: tex, roughness: rough, metalness: metal, vertexColors: true });
    TEXDEF[key] = meters;
  }
  // swap in the photo-scanned PBR materials when they loaded
  if (ASSETS.ok) {
    for (const key in MATDEFS) {
      const set = PBR_SET[key.startsWith('container') ? 'container' : key];
      if (!set) continue;
      // muted, weathered paint: pull each tint a quarter of the way toward grey
      const tint = key.startsWith('container') && key !== 'container_green' ? CONTAINER_COLORS[key.split('_')[1]].map((c) => Math.min(255, (c * 0.75 + 110 * 0.25) * 1.1)) : null;
      MATERIALS[key] = pbrMaterial(key, tint);
      TEXDEF[key] = set[1];
    }
  }
}

// Painted site letters on walls/floors
function letterTexture(letter) {
  const c = makeCanvas(256, 256), g = c.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  g.font = 'bold 220px Impact, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(200,40,30,0.9)'; g.fillText(letter, 128, 136);
  const rng = mulberry32(letter.charCodeAt(0));
  for (let i = 0; i < 8; i++) { g.fillRect(70 + rng() * 120, 210 + rng() * 10, 3, 10 + rng() * 30); } // drips
  const img = g.getImageData(0, 0, 256, 256), d = img.data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) d[i] *= 0.75 + Math.random() * 0.25; // worn paint
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// soft round puff used for smoke and dust
function puffTexture() {
  const c = makeCanvas(128, 128), g = c.getContext('2d');
  const rng = mulberry32(99);
  for (let i = 0; i < 24; i++) {
    const x = 64 + (rng() - 0.5) * 50, y = 64 + (rng() - 0.5) * 50, r = 22 + rng() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c); return t;
}
function flameTexture() {
  const c = makeCanvas(64, 128), g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 92, 2, 32, 80, 60);
  gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.25, 'rgba(255,190,60,0.95)'); gr.addColorStop(0.6, 'rgba(230,80,20,0.6)'); gr.addColorStop(1, 'rgba(120,20,0,0)');
  g.fillStyle = gr; g.beginPath(); g.moveTo(32, 2); g.bezierCurveTo(60, 50, 64, 100, 32, 126); g.bezierCurveTo(0, 100, 4, 50, 32, 2); g.fill();
  const t = new THREE.CanvasTexture(c); return t;
}
function flashTexture() {
  const c = makeCanvas(128, 128), g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,240,1)'); gr.addColorStop(0.2, 'rgba(255,220,120,0.9)'); gr.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = gr; g.beginPath();
  for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU, r = i % 2 ? 22 : 64; g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); }
  g.fill();
  const t = new THREE.CanvasTexture(c); return t;
}
function decalTexture() { // bullet hole
  const c = makeCanvas(64, 64), g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  gr.addColorStop(0, 'rgba(10,10,10,1)'); gr.addColorStop(0.25, 'rgba(25,22,20,0.95)'); gr.addColorStop(0.45, 'rgba(60,55,50,0.5)'); gr.addColorStop(1, 'rgba(60,55,50,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); return t;
}
