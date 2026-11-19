'use strict';
/* =====================================================================
   LOBBY: a 3D showcase of your soldier on the current map, a top nav with
   Play / Loadout / Inventory / Missions / News, matchmaking, rewards.
   ===================================================================== */
const LOBBY = { tab: 'home', mode: 'competitive', pool: new Set(MAP_ORDER), side: 'R', queueT: null, foundT: null, accepted: false, lastMap: 'dockside',
  loTeam: 'T', loSlot: 'knife', invFilter: 'all', show: null, searching: false };
const TIERS = [[0, 'Recruit'], [900, 'Bronze'], [1100, 'Silver'], [1300, 'Gold'], [1500, 'Platinum'], [1700, 'Diamond'], [1900, 'Champion']];
const tierOf = (r) => { let t = TIERS[0][1]; for (const [min, name] of TIERS) if (r >= min) t = name; return t; };
const TIER_COLOR = { Recruit: '#8a949e', Bronze: '#b0743c', Silver: '#aab4bf', Gold: '#e2b23c', Platinum: '#56c8c0', Diamond: '#6aa8ff', Champion: '#ff5a7a' };
// Showcase spot per map, found automatically: open ground for character and camera, clear view,
// the character standing in direct sun, and a deep, interesting view behind (cached per map)
const SHOWCASE = {};
function findShowcase() {
  if (SHOWCASE[MAP_INFO.id]) return SHOWCASE[MAP_INFO.id];
  const sun = RENDER.sun.position.clone().sub(RENDER.sun.target.position).normalize(), dist = 4.4;
  let best = null, bestScore = -1e9;
  const open = (x, z) => { const i = navIndex(x, z); return i >= 0 && WORLD.nav.walk[i] && !WORLD.nav.near[i] && WORLD.nav.h[i] < 0.05 && !isIndoors(x, z); };
  for (let k = 0; k < 900; k++) {
    const x = rand(4, MAP_W - 4), z = rand(4, MAP_D - 4);
    if (!open(x, z)) continue;
    for (const face of [Math.PI, Math.PI - 0.6, Math.PI + 0.6, Math.PI / 2, -Math.PI / 2]) {
      const f = dirFromAngles(face, 0), cx = x + f.x * dist, cz = z + f.z * dist;
      if (!open(cx, cz)) continue;
      if (!losClear(cx, 1.3, cz, x, 1.6, z) || !losClear(cx, 1.3, cz, x, 0.15, z) || !losClear(cx, 1.3, cz, x + 0.5, 1.0, z) || !losClear(cx, 1.3, cz, x - 0.5, 1.0, z)) continue;
      if (!losClear(x, 1.2, z, x + sun.x * 60, 1.2 + sun.y * 60, z + sun.z * 60)) continue; // in the sun
      const back = rayCast(x, 1.4, z, -f.x, 0, -f.z, 80, false), depth = back ? back.t : 80;
      const site = Math.min(...['A', 'B'].map((q) => Math.hypot(x - SITES[q].cx, z - SITES[q].cz)));
      // the camera must stand on the sunny side so we see the lit front, not a silhouette
      const sl = Math.hypot(sun.x, sun.z) || 1, front = (f.x * sun.x + f.z * sun.z) / sl;
      if (front < 0.3) continue;
      const score = Math.min(depth, 35) + front * 6 - site * 0.4;
      if (score > bestScore) { bestScore = score; best = [x, z, face]; }
    }
  }
  return (SHOWCASE[MAP_INFO.id] = best || [MAP_W / 2, MAP_D / 2, Math.PI]);
}

// ---------------------------------------------------------- 3D showcase
function showcaseAgent() {
  const team = LOBBY.tab === 'loadout' ? LOBBY.loTeam : LOBBY.side === 'CT' ? 'CT' : 'T';
  let key = team === 'T' ? 'ak47' : 'm4a4';
  if (LOBBY.tab === 'loadout') key = LOBBY.loSlot === 'knife' ? 'knife' : LOBBY.loSlot;
  const a = { team, weaponKey: key, x: 0, y: 0, z: 0, yaw: 0, pitch: key === 'knife' ? -0.25 : -0.62, alive: true, vx: 0, vz: 0, duckAmt: 0, hasC4: false, muzzleT: 0, onGround: true, showcase: true, isPlayer: true, skins: {} };
  a.skins[key] = PROFILE.equipped.finishes[key] || null;
  const kid = PROFILE.equipped.knife[team];
  if (kid) { const [, t, f] = kid.split(':'); a.knifeType = t; a.knifeFinish = f; } else { a.knifeType = 'combat'; a.knifeFinish = null; }
  return a;
}
function updateShowcase(dt, camera) {
  if (G.state !== 'menu' || !GLTF.ok) { if (LOBBY.show) LOBBY.show.model.root.visible = false; return false; }
  const a = showcaseAgent();
  if (!LOBBY.show || LOBBY.show.team !== a.team) {
    if (LOBBY.show) RENDER.scene.remove(LOBBY.show.model.root);
    LOBBY.show = { team: a.team, model: makeSoldierModel(a.team) };
    RENDER.scene.add(LOBBY.show.model.root);
  }
  const [x, z, face] = findShowcase();
  a.x = x; a.z = z; a.yaw = face - 0.6; // turned a little so the weapon reads in profile
  const m = LOBBY.show.model; m.root.visible = true;
  m.update(a, dt);
  // the camera stands in front of the character (the way it faces), with a slow breathing drift
  const t = performance.now() / 1000, f = dirFromAngles(face, 0), rx = Math.cos(face), rz = -Math.sin(face), dist = 4.4;
  camera.position.set(x + f.x * dist + rx * (0.15 + Math.sin(t * 0.3) * 0.05), 1.3 + Math.sin(t * 0.5) * 0.02, z + f.z * dist + rz * (0.15 + Math.sin(t * 0.3) * 0.05));
  camera.lookAt(x, 0.98, z);
  if (camera.fov !== 38) { camera.fov = 38; camera.updateProjectionMatrix(); }
  CAM.pos.copy(camera.position);
  return true;
}

// ---------------------------------------------------------- item thumbnails
const THUMBS = new Map();
function itemThumb(id) {
  if (THUMBS.has(id)) return THUMBS.get(id);
  const r = RENDER.renderer, W = 240, H = 120;
  if (!itemThumb.rt) {
    itemThumb.rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 }); itemThumb.rt.texture.colorSpace = THREE.SRGBColorSpace;
    itemThumb.scene = new THREE.Scene(); itemThumb.scene.environment = RENDER.env;
    itemThumb.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
    const d = new THREE.DirectionalLight(0xffffff, 2.2); d.position.set(1, 3, 2); itemThumb.scene.add(d);
    itemThumb.cam = new THREE.PerspectiveCamera(22, W / H, 0.01, 20);
  }
  const [kind, a, f] = id.split(':');
  const info = kind === 'k' ? gunModel('knife', { knife: a, finish: f, team: 'T' }) : gunModel(a, { finish: f === 'factory' ? null : f });
  const g = info.group; g.rotation.set(0, -Math.PI / 2, kind === 'k' ? 0.5 : 0);
  const sc = itemThumb.scene; sc.add(g); g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
  const dist = Math.max(sz.x / (2 * Math.tan(11 * DEG) * (W / H)), sz.y / (2 * Math.tan(11 * DEG))) * 1.25;
  itemThumb.cam.position.set(c.x, c.y + 0.02, c.z + dist); itemThumb.cam.lookAt(c);
  const prevBg = sc.background; sc.background = null;
  r.setRenderTarget(itemThumb.rt); r.setClearColor(0x000000, 0); r.clear(); r.render(sc, itemThumb.cam); r.setRenderTarget(null);
  sc.background = prevBg; sc.remove(g);
  const px = new Uint8Array(W * H * 4); r.readRenderTargetPixels(itemThumb.rt, 0, 0, W, H, px);
  const cv = makeCanvas(W, H), cg = cv.getContext('2d'), img = cg.createImageData(W, H);
  for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4); // flip vertically
  cg.putImageData(img, 0, 0);
  const url = cv.toDataURL();
  THUMBS.set(id, url);
  return url;
}
const finishOf = (id) => id.split(':')[2];
function itemTile(id, opts = {}) {
  const r = itemRarity(id), eq = opts.equipped, isNew = PROFILE.newItems.includes(id);
  return `<button class="item ${eq ? 'eq' : ''}" data-id="${id}" style="--rc:${r.color}">
    ${isNew ? '<span class="new">New</span>' : ''}${eq ? `<span class="eqb">${eq}</span>` : ''}
    <img src="${itemThumb(id)}" alt=""><b>${itemName(id).split(' | ')[0]}</b><small>${FINISHES[finishOf(id)].name}</small><i class="bar"></i></button>`;
}

// ---------------------------------------------------------- views
function setTab(t) {
  LOBBY.tab = t;
  for (const s of document.querySelectorAll('.lobby2 .tab')) s.classList.toggle('hidden', s.id !== 'tab-' + t);
  for (const b of document.querySelectorAll('.tn-tabs button, .tn-left .icon[data-tab]')) b.classList.toggle('on', b.dataset.tab === t);
  renderLobby();
}
function renderLobby() {
  if (!PROFILE) return;
  const t = LOBBY.tab;
  if (t === 'home') renderHome();
  if (t === 'play') renderPlay();
  if (t === 'loadout') renderLoadout();
  if (t === 'inventory') renderInventory();
  if (t === 'missions') renderMissions();
  if (t === 'news') renderNews();
  renderPlayerCard();
}
function renderPlayerCard() {
  const p = PROFILE, tier = tierOf(p.rating);
  $('player-card').innerHTML = `<div class="pc-name">${p.name}</div>
    <div class="pc-level"><span>${p.level}</span></div>
    <div class="pc-tier" style="--tc:${TIER_COLOR[tier]}"><small>${tier}</small><b>${p.rating.toLocaleString()}</b></div>
    <div class="pc-xp"><i style="width:${Math.round(levelProgress() * 100)}%"></i></div>`;
}
function renderHome() {
  const m = PROFILE.missions.find((x) => !x.done) || PROFILE.missions[0];
  const featured = MAP_DEFS.oldquarter();
  const cards = [];
  if (m) cards.push(`<button class="hcard mission" data-go="missions"><div class="hc-tag">Mission <small>${PROFILE.missions.filter((x) => x.done).length}/3 done today</small></div>
    <div class="hc-title">${missionText(m)}</div><div class="hc-prog"><i style="width:${Math.min(100, (m.progress / m.target) * 100)}%"></i></div>
    <div class="hc-foot"><span>${m.progress} / ${m.target}</span><b>${m.xp} XP</b></div></button>`);
  cards.push(`<button class="hcard map" data-go="play" data-map="oldquarter"><div class="hc-tag hot">New map</div>
    <img src="${mapThumb('oldquarter').canvas.toDataURL()}" alt=""><div class="hc-title">${featured.name}</div><small>${featured.desc}</small></button>`);
  if (PROFILE.newItems.length) cards.push(`<button class="hcard items" data-go="inventory"><div class="hc-tag hot">New items</div>
    <img src="${itemThumb(PROFILE.newItems[PROFILE.newItems.length - 1])}" alt=""><div class="hc-title">${PROFILE.newItems.length} new item${PROFILE.newItems.length > 1 ? 's' : ''} in your inventory</div></button>`);
  cards.push(`<button class="hcard news" data-go="news"><div class="hc-tag">Update</div><div class="hc-title">Knives, finishes and a new lobby</div><small>Six knife types, twelve weapon finishes, daily missions and level-up drops.</small></button>`);
  $('home-cards').innerHTML = cards.join('');
  for (const c of document.querySelectorAll('.hcard')) c.onclick = () => { if (c.dataset.map) LOBBY.pool = new Set([c.dataset.map]); setTab(c.dataset.go); };
}
function renderPlay() {
  $('modes').innerHTML = Object.entries(MODES).map(([id, m]) => `<button class="mode ${LOBBY.mode === id ? 'on' : ''}" data-mode="${id}"><b>${m.name}</b><small>${m.desc}</small></button>`).join('');
  for (const b of document.querySelectorAll('.mode')) b.onclick = () => { LOBBY.mode = b.dataset.mode; saveSettings(); renderPlay(); };
  const wrap = $('maps'); wrap.innerHTML = '';
  for (const id of MAP_ORDER) {
    const { canvas, def } = mapThumb(id);
    const card = document.createElement('button');
    card.className = 'map-card' + (LOBBY.pool.has(id) ? ' on' : '');
    card.appendChild(canvas);
    const txt = document.createElement('div'); txt.innerHTML = `<b>${def.name}</b><small>${def.desc}</small>`; card.appendChild(txt);
    card.onclick = () => { if (LOBBY.pool.has(id)) { if (LOBBY.pool.size > 1) LOBBY.pool.delete(id); } else LOBBY.pool.add(id); saveSettings(); renderPlay(); };
    wrap.appendChild(card);
  }
  for (const b of document.querySelectorAll('#side-seg button')) b.classList.toggle('on', b.dataset.team === LOBBY.side);
  $('play-summary').innerHTML = `<b>${MODES[LOBBY.mode].name}</b> on ${[...LOBBY.pool].map((m) => MAP_DEFS[m]().name).join(', ')}<br><small>5v5 with bots · ${DIFFICULTY[G.difficulty].name}</small>`;
  $('find-btn').disabled = LOBBY.searching;
}
const LO_GROUPS = [['Knife', ['knife']], ['Pistols', ['glock', 'usp', 'p250', 'fiveseven', 'tec9', 'deagle']], ['SMGs', ['mac10', 'mp9', 'ump45', 'p90']], ['Heavy', ['nova', 'xm1014']], ['Rifles', ['galil', 'famas', 'ak47', 'm4a4', 'm4a1s', 'sg553', 'aug']], ['Snipers', ['ssg08', 'awp']]];
function renderLoadout() {
  const team = LOBBY.loTeam;
  for (const b of document.querySelectorAll('#lo-team button')) b.classList.toggle('on', b.dataset.team === team);
  let html = '';
  for (const [grp, keys] of LO_GROUPS) {
    const list = keys.filter((k) => k === 'knife' || !WEAPONS[k].team || WEAPONS[k].team === team);
    html += `<div class="lo-group">${grp}</div>`;
    for (const k of list) {
      let label, rc = '#9aa4ad';
      if (k === 'knife') { const id = PROFILE.equipped.knife[team]; label = id ? itemName(id) : 'Combat Knife'; if (id) rc = itemRarity(id).color; }
      else { const f = PROFILE.equipped.finishes[k]; label = f ? FINISHES[f].name : 'Factory'; if (f) rc = RAR[FINISHES[f].rarity].color; }
      html += `<button class="lo-row ${LOBBY.loSlot === k ? 'on' : ''}" data-k="${k}" style="--rc:${rc}"><span>${k === 'knife' ? 'Knife' : WEAPONS[k].name}</span><small>${label}</small></button>`;
    }
  }
  $('lo-slots').innerHTML = html;
  for (const b of document.querySelectorAll('.lo-row')) b.onclick = () => { LOBBY.loSlot = b.dataset.k; renderLoadout(); };
  // owned finishes for the selected slot
  const k = LOBBY.loSlot;
  const owned = PROFILE.inventory.filter((id) => (k === 'knife' ? id.startsWith('k:') : id.startsWith(`w:${k}:`)));
  const defaultId = k === 'knife' ? null : `w:${k}:factory`;
  let fin = `<h3>${k === 'knife' ? 'Knives' : WEAPONS[k].name}</h3><div class="inv-grid small">`;
  if (defaultId) fin += itemTile(defaultId, { equipped: !PROFILE.equipped.finishes[k] ? 'Equipped' : '' });
  else fin += `<button class="item ${!PROFILE.equipped.knife[team] ? 'eq' : ''}" data-id="default-knife" style="--rc:#9aa4ad">${!PROFILE.equipped.knife[team] ? '<span class="eqb">Equipped</span>' : ''}<img src="${itemThumbKnifeDefault(team)}" alt=""><b>Combat Knife</b><small>Standard issue</small><i class="bar"></i></button>`;
  for (const id of [...new Set(owned)]) fin += itemTile(id, { equipped: isEquipped(id, k === 'knife' ? team : null) ? 'Equipped' : '' });
  fin += '</div>';
  if (!owned.length) fin += `<p class="hint-small">Level up to earn ${k === 'knife' ? 'knives' : 'finishes for this weapon'}: each level drops a random item.</p>`;
  $('lo-finishes').innerHTML = fin;
  for (const b of document.querySelectorAll('#lo-finishes .item')) b.onclick = () => {
    const id = b.dataset.id;
    if (id === 'default-knife') PROFILE.equipped.knife[team] = null;
    else if (id.endsWith(':factory')) PROFILE.equipped.finishes[k] = null;
    else if (k === 'knife') PROFILE.equipped.knife[team] = id;
    else PROFILE.equipped.finishes[k] = finishOf(id);
    PROFILE.newItems = PROFILE.newItems.filter((x) => x !== id);
    saveProgress(); SFX.init(); SFX.play('deploy'); renderLoadout();
  };
}
function itemThumbKnifeDefault(team) {
  const id = 'default-knife-' + team;
  if (THUMBS.has(id)) return THUMBS.get(id);
  // reuse the thumbnail renderer with the standard knife
  const fake = `k:combat:factory`;
  const url = itemThumb(fake); THUMBS.set(id, url); return url;
}
const INV_FILTERS = [['all', 'All'], ['knife', 'Knives'], ['pistol', 'Pistols'], ['smg', 'SMGs'], ['heavy', 'Heavy'], ['rifle', 'Rifles'], ['sniper', 'Snipers']];
function renderInventory() {
  $('inv-filters').innerHTML = INV_FILTERS.map(([id, n]) => `<button class="${LOBBY.invFilter === id ? 'on' : ''}" data-f="${id}">${n}</button>`).join('') + `<span class="inv-count">${PROFILE.inventory.length} items</span>`;
  for (const b of document.querySelectorAll('#inv-filters button')) b.onclick = () => { LOBBY.invFilter = b.dataset.f; renderInventory(); };
  const f = LOBBY.invFilter;
  const items = PROFILE.inventory.filter((id) => { const [kind, a] = id.split(':'); return f === 'all' || (f === 'knife' ? kind === 'k' : kind === 'w' && WEAPONS[a].cat === f); })
    .sort((x, y) => itemRarity(y).tier - itemRarity(x).tier);
  $('inv-grid').innerHTML = items.length ? items.map((id) => {
    const [kind] = id.split(':');
    const eq = kind === 'k' ? ['T', 'CT'].filter((t) => PROFILE.equipped.knife[t] === id).map((t) => (t === 'T' ? 'Attackers' : 'Defenders')).join(' + ') : isEquipped(id) ? 'Equipped' : '';
    return itemTile(id, { equipped: eq });
  }).join('') : '<p class="hint-small">Nothing here yet.</p>';
  for (const b of document.querySelectorAll('#inv-grid .item')) b.onclick = () => {
    const id = b.dataset.id, [kind] = id.split(':');
    if (kind === 'k') { const on = isEquipped(id); for (const t of ['T', 'CT']) PROFILE.equipped.knife[t] = on ? null : id; }
    else equipItem(id);
    PROFILE.newItems = PROFILE.newItems.filter((x) => x !== id);
    saveProgress(); SFX.init(); SFX.play('deploy'); renderInventory(); renderPlayerCard();
  };
}
function renderMissions() {
  const p = PROFILE;
  $('missions-view').innerHTML = `<h2>Missions</h2><p class="sub">Three new missions every day. Completing one gives XP; every level gives an item drop.</p>
    <div class="lv-row"><div class="pc-level big"><span>${p.level}</span></div><div class="lv-info"><b>Level ${p.level}${p.level >= MAX_LEVEL ? ' (max)' : ''}</b><div class="pc-xp wide"><i style="width:${Math.round(levelProgress() * 100)}%"></i></div><small>${p.xp % XP_PER_LEVEL} / ${XP_PER_LEVEL} XP to the next level</small></div></div>
    ${p.missions.map((m) => `<div class="mrow ${m.done ? 'done' : ''}"><div><b>${missionText(m)}</b><div class="hc-prog"><i style="width:${Math.min(100, (m.progress / m.target) * 100)}%"></i></div></div><span>${m.done ? 'Done' : `${m.progress}/${m.target}`}</span><em>${m.xp} XP</em></div>`).join('')}`;
}
function renderNews() {
  $('news-view').innerHTML = `<h2>News</h2>
    <article><h3>Knives, finishes and a new lobby</h3><p>Six knife types (Combat, Bayonet, Bowie, Karambit, Butterfly, Tactical Dagger), each with its own inspect move, and twelve weapon finishes from Common to Mythic. Equip them in Loadout; they show in your hands, on your character in the lobby and on the guns you drop.</p></article>
    <article><h3>Levels, missions and drops</h3><p>Earn XP for round wins, kills, headshots, plants, defuses and finished missions. Every level up drops a random item. Three new missions every day.</p></article>
    <article><h3>New maps: Foundry and Old Quarter</h3><p>A steel works with an indoor B hall and a rail-road approach to A, and an old town with a terraced plaza and a walled courtyard. Pick your maps in Play.</p></article>
    <article><h3>Real weapon and character models</h3><p>Public-domain models for every gun, animated soldiers for both teams, photo-scanned surfaces, recorded gunshots and 3D sound.</p></article>`;
}

// ---------------------------------------------------------- matchmaking
function mapThumb(id) {
  const d = MAP_DEFS[id](), px = 3, c = makeCanvas(GW * CELL * px, GH * CELL * px), g = c.getContext('2d');
  g.fillStyle = '#1a1d21'; g.fillRect(0, 0, c.width, c.height);
  for (let z = 0; z < GH; z++) for (let x = 0; x < GW; x++) {
    const ch = d.grid[z][x];
    g.fillStyle = ch === '#' ? '#1a1d21' : ch === '~' ? '#26485a' : ch === 'h' || ch === 'g' ? '#a8a294' : ch === 'b' || ch === 'w' ? '#6a665d' : '#8c877b';
    g.fillRect(x * CELL * px, z * CELL * px, CELL * px, CELL * px);
  }
  g.fillStyle = 'rgba(20,20,20,0.85)';
  for (const p of d.props) g.fillRect(p.min[0] * px, p.min[2] * px, (p.max[0] - p.min[0]) * px, (p.max[2] - p.min[2]) * px);
  g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ffcf8a';
  for (const k of ['A', 'B']) g.fillText(k, d.sites[k].cx * px, d.sites[k].cz * px);
  g.fillStyle = 'rgba(232,176,74,0.55)'; const t = d.spawns.T; g.fillRect(t.x0 * px, t.z0 * px, (t.x1 - t.x0) * px, (t.z1 - t.z0) * px);
  g.fillStyle = 'rgba(111,162,255,0.55)'; const k = d.spawns.CT; g.fillRect(k.x0 * px, k.z0 * px, (k.x1 - k.x0) * px, (k.z1 - k.z0) * px);
  return { canvas: c, def: d };
}
function findMatch() {
  SFX.init(); SFX.setVolume(G.volume);
  LOBBY.searching = true; $('tn-queue').classList.remove('hidden'); renderLobby();
  const t0 = performance.now(), wait = rand(2.5, 6.5) * 1000;
  LOBBY.queueT = setInterval(() => {
    const e = performance.now() - t0;
    $('queue-time').textContent = fmtTime(e / 1000 - 0.5);
    if (e > wait) { clearInterval(LOBBY.queueT); matchFound(); }
  }, 200);
}
function cancelQueue() {
  clearInterval(LOBBY.queueT); clearInterval(LOBBY.foundT);
  LOBBY.searching = false; $('tn-queue').classList.add('hidden'); $('found').classList.add('hidden'); renderLobby();
}
function matchFound() {
  const map = pick([...LOBBY.pool]);
  LOBBY.pending = map; LOBBY.accepted = false;
  const def = MAP_DEFS[map]();
  $('found-map').innerHTML = `<b>${def.name}</b><span>${MODES[LOBBY.mode].name} · 5v5 with bots</span>`;
  $('found-dots').innerHTML = Array.from({ length: 10 }, (_, i) => `<i data-i="${i}"></i>`).join('');
  $('accept-btn').disabled = false; $('accept-btn').textContent = 'Accept';
  $('found').classList.remove('hidden');
  SFX.play('go');
  const total = 15, t0 = performance.now();
  const botAccept = Array.from({ length: 9 }, () => rand(0.6, 7));
  LOBBY.foundT = setInterval(() => {
    const e = (performance.now() - t0) / 1000;
    $('found-fill').style.width = Math.max(0, 100 - (e / total) * 100) + '%';
    const dots = document.querySelectorAll('#found-dots i');
    botAccept.forEach((t, i) => { if (e > t) dots[i + 1].classList.add('ok'); });
    if (LOBBY.accepted) dots[0].classList.add('ok', 'me');
    if (LOBBY.accepted && botAccept.every((t) => e > t)) { clearInterval(LOBBY.foundT); setTimeout(launchMatch, 500); }
    else if (e > total) { clearInterval(LOBBY.foundT); cancelQueue(); setTab('play'); showLobbyNote('You did not accept the match in time.'); }
  }, 100);
}
function acceptMatch() { LOBBY.accepted = true; $('accept-btn').disabled = true; $('accept-btn').textContent = 'Waiting for players…'; SFX.play('buy'); }
function showLobbyNote(t) { $('lobby-note').textContent = t; setTimeout(() => { if ($('lobby-note').textContent === t) $('lobby-note').textContent = ''; }, 6000); }
function launchMatch(mapId) {
  const map = mapId || LOBBY.pending || 'dockside';
  LOBBY.lastMap = map;
  clearInterval(LOBBY.queueT);
  LOBBY.searching = false; $('found').classList.add('hidden'); $('tn-queue').classList.add('hidden');
  $('load-msg').textContent = `Loading ${MAP_DEFS[map]().name}…`;
  $('loading').classList.remove('hidden');
  setTimeout(() => {
    loadMap(map);
    applyMode(LOBBY.mode);
    G.playerTeam = LOBBY.side === 'R' ? (Math.random() < 0.5 ? 'T' : 'CT') : LOBBY.side;
    saveSettings();
    $('loading').classList.add('hidden'); $('menu').classList.add('hidden');
    if (LOBBY.show) LOBBY.show.model.root.visible = false;
    SFX.startAmbience();
    SFX.init(); SFX.playMusic('match');
    startMatch();
    lockPointer();
  }, 60);
}

// ---------------------------------------------------------- end of match
function endMatch() {
  G.state = 'matchover';
  if (document.exitPointerLock) document.exitPointerLock();
  const res = matchWinner();
  const mine = G.player.team, won = res === mine, draw = res === 'draw';
  $('mo-title').textContent = draw ? 'Draw' : won ? 'Victory' : 'Defeat';
  $('mo-title').className = draw ? '' : won ? 'win' : 'lose';
  $('mo-sub').textContent = `${MAP_INFO.name} · ${RULES.name} · Defenders ${G.score.CT} : ${G.score.T} Attackers`;
  const p = PROFILE, margin = Math.abs(G.score.CT - G.score.T);
  const k = (0.6 + G.difficulty * 0.3) * (LOBBY.mode === 'casual' ? 0.5 : 1);
  const delta = Math.round(draw ? 0 : (won ? 1 : -1) * (18 + margin * 2) * k);
  p.rating = Math.max(0, p.rating + delta);
  if (draw) p.draws++; else if (won) p.wins++; else p.losses++;
  const rw = awardMatch(won ? 'win' : draw ? 'draw' : 'loss');
  $('mo-rating').innerHTML = `<span class="${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${delta > 0 ? '+' : ''}${delta}</span> rating · ${p.rating} · ${tierOf(p.rating)}`;
  $('mo-xp').innerHTML = `<div class="xp-parts">${rw.parts.map(([n, v]) => `<span>${n}<b>+${v}</b></span>`).join('')}</div>
    <div class="xp-total">+${rw.gained} XP · Level ${p.level}${rw.levelUp ? ' <em>Level up!</em>' : ''}</div><div class="pc-xp wide"><i style="width:${Math.round(levelProgress() * 100)}%"></i></div>
    ${rw.completed.map((t) => `<div class="mdone">Mission complete: ${t}</div>`).join('')}`;
  $('mo-drops').innerHTML = rw.drops.length ? `<div class="label">Item drop${rw.drops.length > 1 ? 's' : ''}</div><div class="inv-grid small reveal">${rw.drops.map((id) => itemTile(id)).join('')}</div>` : '';
  $('mo-board').innerHTML = scoreboardHTML(true);
  $('hud').classList.add('hidden'); $('scope').classList.add('hidden');
  $('matchover').classList.remove('hidden');
  if (rw.drops.length) SFX.play('win');
}

// ---------------------------------------------------------- settings + wiring
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('strikepoint3d') || '{}');
    for (const k of ['sens', 'difficulty', 'volume', 'crosshairColor', 'quality', 'fullscreen']) if (s[k] !== undefined) G[k] = s[k];
    if (s.mode && MODES[s.mode]) LOBBY.mode = s.mode;
    if (s.side) LOBBY.side = s.side;
    if (Array.isArray(s.pool)) { const ok = s.pool.filter((m) => MAP_DEFS[m]); if (ok.length) LOBBY.pool = new Set(ok); }
  } catch (e) { /* storage unavailable */ }
}
function saveSettings() {
  try { localStorage.setItem('strikepoint3d', JSON.stringify({ fullscreen: G.fullscreen, sens: G.sens, difficulty: G.difficulty, volume: G.volume, crosshairColor: G.crosshairColor, quality: G.quality, mode: LOBBY.mode, side: LOBBY.side, pool: [...LOBBY.pool] })); } catch (e) { /* ignore */ }
}
function syncMenu() {
  $('opt-diff').value = G.difficulty; $('opt-quality').value = G.quality; $('opt-xcol').value = G.crosshairColor;
  for (const id of ['opt-sens', 'pause-sens']) $(id).value = G.sens;
  for (const id of ['sens-val', 'pause-sens-val']) $(id).textContent = (+G.sens).toFixed(2);
  $('opt-vol').value = G.volume;
  $('opt-fs').checked = G.fullscreen !== false;
  document.documentElement.style.setProperty('--xhair', G.crosshairColor);
}
function initMenus() {
  for (const b of document.querySelectorAll('[data-tab]')) b.onclick = () => { SFX.init(); setTab(b.dataset.tab); };
  for (const b of document.querySelectorAll('#side-seg button')) b.onclick = () => { LOBBY.side = b.dataset.team; renderLobby(); saveSettings(); };
  for (const b of document.querySelectorAll('#lo-team button')) b.onclick = () => { LOBBY.loTeam = b.dataset.team; renderLoadout(); };
  $('opt-diff').onchange = (e) => { G.difficulty = +e.target.value; saveSettings(); renderPlay(); };
  $('opt-quality').onchange = (e) => { G.quality = +e.target.value; applyQuality(); saveSettings(); };
  $('opt-xcol').oninput = (e) => { G.crosshairColor = e.target.value; syncMenu(); saveSettings(); };
  $('opt-vol').oninput = (e) => { G.volume = +e.target.value; SFX.setVolume(G.volume); saveSettings(); };
  $('opt-fs').onchange = (e) => { G.fullscreen = e.target.checked; saveSettings(); if (G.fullscreen) goFullscreen(); else if (document.fullscreenElement) document.exitFullscreen(); };
  // browsers only allow fullscreen after a click or key press, and Esc leaves it. So every
  // click or key press puts the game back into fullscreen, unless the setting is turned off.
  window.addEventListener('pointerdown', goFullscreen, true);
  window.addEventListener('keydown', goFullscreen, true);
  for (const id of ['opt-sens', 'pause-sens']) $(id).oninput = (e) => { G.sens = +e.target.value; syncMenu(); saveSettings(); };
  $('tn-settings').onclick = () => $('settings-modal').classList.remove('hidden');
  $('settings-close').onclick = () => $('settings-modal').classList.add('hidden');
  $('tn-quit').onclick = () => $('quit-modal').classList.remove('hidden');
  $('quit-no').onclick = () => $('quit-modal').classList.add('hidden');
  $('quit-yes').onclick = () => { saveProgress(); window.close(); $('quit-msg').textContent = 'Progress saved. You can close this tab now.'; };
  $('find-btn').onclick = () => { goFullscreen(); saveSettings(); SFX.init(); SFX.playMusic('lobby'); findMatch(); };
  $('queue-cancel').onclick = cancelQueue;
  $('accept-btn').onclick = () => { goFullscreen(); acceptMatch(); };
  $('resume-btn').onclick = () => { SFX.init(); lockPointer(); };
  $('quit-btn').onclick = () => toMenu();
  $('again-btn').onclick = () => { SFX.init(); $('matchover').classList.add('hidden'); launchMatch(LOBBY.lastMap); };
  $('menu-btn').onclick = () => toMenu();
  $('buy-close').onclick = () => closeBuy(false);
  syncMenu();
  SFX.playMusic('lobby'); // starts once audio is allowed (first click)
  setTab('home');
}
function goFullscreen() {
  if (G.fullscreen === false || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
  document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => { /* not allowed right now */ });
}
function toMenu() {
  G.state = 'menu'; G.paused = false; G.buyOpen = false;
  SFX.playMusic('lobby');
  SFX.updateAmbience(0, 0, false);
  for (const id of ['pause', 'matchover', 'hud', 'buy', 'scope', 'scoreboard', 'found']) $(id).classList.add('hidden');
  $('menu').classList.remove('hidden');
  for (const a of G.agents) if (a.model) a.model.root.visible = false;
  FX.reset();
  setTab('home');
  if (document.pointerLockElement) document.exitPointerLock();
}
