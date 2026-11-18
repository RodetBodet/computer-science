'use strict';
/* =====================================================================
   ASSETS: loads the CC0 photo-scanned textures (Poly Haven), the HDR sky
   and the recorded sounds (see assets/CREDITS.md).
   Browsers block reading local files from a page opened straight from
   disk, so when that happens the game falls back to its generated
   textures and synthesized sounds.
   ===================================================================== */
const ASSETS = { ok: false, tex: {}, sky: null, sunDir: null, sounds: {} };

// material key -> [Poly Haven name, meters per tile, normal strength]
const PBR_SET = {
  concrete: ['concrete_wall_004', 3, 1], block: ['concrete_wall_006', 3, 1.2], brick: ['red_brick_03', 2.4, 1.2], plaster: ['grey_plaster_02', 3, 1],
  corrugated: ['corrugated_iron_02', 2, 1.4], roof: ['rusty_corrugated_iron', 3, 1], concreteFloor: ['brushed_concrete', 3, 1],
  asphalt: ['asphalt_02', 4, 1], warehouseFloor: ['concrete_floor_worn_001', 3, 1], pavers: ['rectangular_paving', 2, 1.2],
  grate: ['metal_grate_rusty', 1.5, 1.2], metal: ['metal_plate', 2, 1], crate: ['brown_planks_05', 1.2, 1.3], pallet: ['brown_planks_05', 1.2, 1.3],
  container: ['container_side', 2.6, 1.3],
};
const SOUND_FILES = [
  'rifle_t', 'rifle_ct', 'pistol', 'deagle', 'smg', 'shotgun', 'scout', 'awp', 'silenced', 'silenced_rifle',
  'rifle_t_far', 'rifle_ct_far', 'pistol_far', 'awp_far', 'shotgun_far', 'smg_far',
  'reload_rifle', 'reload_pistol', 'shell_in', 'pump',
  'step1', 'step2', 'step3', 'step4', 'metal1', 'metal2', 'metal3', 'metal4',
];

function loadImage(url) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
}
// ---- Radiance .hdr (RGBE) decoder ----
function parseHDR(buf) {
  const d = new Uint8Array(buf);
  let p = 0;
  const line = () => { let s = ''; while (p < d.length && d[p] !== 10) s += String.fromCharCode(d[p++]); p++; return s; };
  if (!line().startsWith('#?')) throw new Error('not an HDR file');
  let l; while ((l = line()) !== '') { /* header lines */ }
  const m = line().match(/-Y (\d+) \+X (\d+)/);
  const H = +m[1], Wd = +m[2];
  const rgbe = new Uint8Array(Wd * H * 4), scan = new Uint8Array(Wd * 4);
  for (let y = 0; y < H; y++) {
    if (d[p] === 2 && d[p + 1] === 2 && ((d[p + 2] << 8) | d[p + 3]) === Wd) { // new-style RLE
      p += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < Wd) {
          let n = d[p++];
          if (n > 128) { n -= 128; const v = d[p++]; while (n--) scan[(x++) * 4 + c] = v; }
          else while (n--) scan[(x++) * 4 + c] = d[p++];
        }
      }
    } else { for (let x = 0; x < Wd * 4; x++) scan[x] = d[p++]; }
    rgbe.set(scan, (H - 1 - y) * Wd * 4); // store bottom row first so v=1 is the top of the sky
  }
  // to half floats + find the sun (brightest pixel)
  const half = new Uint16Array(Wd * H * 4);
  let best = 0, bx = 0, by = 0;
  for (let i = 0; i < Wd * H; i++) {
    const e = rgbe[i * 4 + 3], f = e ? Math.pow(2, e - 136) : 0;
    const r = rgbe[i * 4] * f, g = rgbe[i * 4 + 1] * f, b = rgbe[i * 4 + 2] * f;
    half[i * 4] = THREE.DataUtils.toHalfFloat(Math.min(r, 65000)); half[i * 4 + 1] = THREE.DataUtils.toHalfFloat(Math.min(g, 65000));
    half[i * 4 + 2] = THREE.DataUtils.toHalfFloat(Math.min(b, 65000)); half[i * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
    const lum = r + g + b; if (lum > best) { best = lum; bx = i % Wd; by = Math.floor(i / Wd); }
  }
  // texel -> direction, inverse of Three.js equirectUv(): u = atan(z, x)/2pi + 0.5, v = asin(y)/pi + 0.5
  const u = (bx + 0.5) / Wd, v = (by + 0.5) / H;
  const az = (u - 0.5) * TAU, lat = (v - 0.5) * Math.PI;
  const sun = new THREE.Vector3(Math.cos(az) * Math.cos(lat), Math.sin(lat), Math.sin(az) * Math.cos(lat)).normalize();
  const tex = new THREE.DataTexture(half, Wd, H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping; tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.flipY = false;
  tex.needsUpdate = true;
  return { tex, sun };
}
// greyscale the green container scan, then tint it
function tintedTexture(img, rgb) {
  const c = makeCanvas(img.width, img.height), g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const id = g.getImageData(0, 0, c.width, c.height), d = id.data;
  const k = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 128; // the scan averages ~128 luminance
    d[i] = clamp(l * k[0] * 255, 0, 255); d[i + 1] = clamp(l * k[1] * 255, 0, 255); d[i + 2] = clamp(l * k[2] * 255, 0, 255);
  }
  g.putImageData(id, 0, 0);
  return new THREE.CanvasTexture(c);
}
async function loadAssets(progress) {
  if (location.protocol === 'file:') return false;
  try {
    const names = [...new Set(Object.values(PBR_SET).map((v) => v[0]))];
    let done = 0;
    const total = names.length * 3 + 1;
    const tick = () => progress && progress(++done / total);
    const imgs = {};
    await Promise.all(names.map(async (n) => {
      const [diff, nor, arm] = await Promise.all(['diff', 'nor', 'arm'].map((s) => loadImage(`assets/textures/${n}_${s}.jpg`).then((i) => { tick(); return i; })));
      imgs[n] = { diff, nor, arm };
    }));
    const hdrBuf = await (await fetch('assets/sky/sky_2k.hdr')).arrayBuffer(); tick();
    const hdr = parseHDR(hdrBuf);
    ASSETS.sky = hdr.tex; ASSETS.sunDir = hdr.sun;
    ASSETS.imgs = imgs;
    ASSETS.ok = true;
  } catch (e) { console.warn('Asset load failed, using generated textures:', e); ASSETS.ok = false; }
  return ASSETS.ok;
}
async function loadSounds() {
  if (location.protocol === 'file:') return;
  const dec = new OfflineAudioContext(2, 44100, 44100);
  await Promise.all(SOUND_FILES.map(async (n) => {
    try {
      const r = await fetch(`assets/sounds/${n}.m4a`);
      if (!r.ok) return;
      ASSETS.sounds[n] = await dec.decodeAudioData(await r.arrayBuffer());
    } catch (e) { /* missing sound: the synth version is used */ }
  }));
}
// a PBR material from the downloaded maps
function pbrMaterial(key, tint) {
  const [name, , ns] = PBR_SET[key.startsWith('container') ? 'container' : key];
  const I = ASSETS.imgs[name];
  const mk = (img, srgb) => {
    const t = img instanceof THREE.Texture ? img : new THREE.Texture(img);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true; return t;
  };
  const map = tint ? mk(tintedTexture(I.diff, tint), true) : mk(I.diff, true);
  const arm = mk(I.arm, false);
  return new THREE.MeshStandardMaterial({
    map, normalMap: mk(I.nor, false), normalScale: new THREE.Vector2(ns, ns),
    aoMap: arm, aoMapIntensity: 1, roughnessMap: arm, metalnessMap: arm, roughness: 1, metalness: key === 'metal' || key === 'grate' || key === 'corrugated' || key === 'roof' ? 1 : 0, // painted containers are not bare metal
    vertexColors: true,
    // per-scan color correction: the metal plate scan is very dark, the planks are pale grey
    color: key === 'metal' ? new THREE.Color(2.6, 2.6, 2.8) : key === 'crate' || key === 'pallet' ? new THREE.Color(1.05, 0.8, 0.55) : new THREE.Color(1, 1, 1),
  });
}

// shared detail maps for small objects (guns, uniforms)
const DETAIL = {};
function detailTex(name, kind, rep) {
  const key = name + kind + rep;
  if (DETAIL[key]) return DETAIL[key];
  if (!ASSETS.ok || !ASSETS.imgs[name]) return null;
  const t = new THREE.Texture(ASSETS.imgs[name][kind]);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 4;
  t.colorSpace = kind === 'diff' ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true;
  return (DETAIL[key] = t);
}
