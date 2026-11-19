'use strict';
/* =====================================================================
   HUD, buy menu, scoreboard, radar and menus (plain DOM).
   ===================================================================== */
const HUD = { cache: new Map(), dmgDirT: 0, radarBg: null };
function setText(id, v) { if (HUD.cache.get(id) === v) return; HUD.cache.set(id, v); $(id).textContent = v; }
function setHTML(id, v) { if (HUD.cache.get('h' + id) === v) return; HUD.cache.set('h' + id, v); $(id).innerHTML = v; }
function setClass(el, cls, on) { if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on); }
function showMsg(text, sub, t, cls) { G.msg = { t }; setText('center-msg', text); setText('sub-msg', sub); $('center-msg').className = cls || ''; }
function popMoney(amt) {
  const el = $('money-pop'); el.textContent = (amt > 0 ? '+$' : '-$') + Math.abs(amt);
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
function onMatchStart() {
  $('menu').classList.add('hidden'); $('matchover').classList.add('hidden'); $('hud').classList.remove('hidden');
  $('killfeed').innerHTML = ''; HUD.lastTeams = '';
}
function addKillfeed(k, v, key, hs, info, blind, noscope) {
  const el = document.createElement('div');
  el.className = 'kf' + ((k && k.isPlayer) || v.isPlayer ? ' mine' : '');
  // FFA has no sides, so names are neutral except your own
  const name = (a) => `<span class="${RULES.ffa ? (a.isPlayer ? 'you' : 'ffa') : a.team === 'T' ? 't' : 'ct'}">${a.name}</span>`;
  const wname = key === 'c4' ? 'C4' : WEAPONS[key] ? WEAPONS[key].name : '';
  const tags = [blind ? '<b class="tag">blind</b>' : '', info.smoke ? '<b class="tag">smoke</b>' : '', noscope ? '<b class="tag">no-scope</b>' : '', info.wallbang ? '<b class="tag">wallbang</b>' : '', hs ? '<b class="tag hs">HS</b>' : ''].join('');
  el.innerHTML = `${k && k !== v ? name(k) : ''}<em>${wname}</em>${tags}${name(v)}`;
  const feed = $('killfeed'); feed.prepend(el);
  while (feed.children.length > 6) feed.lastChild.remove();
  setTimeout(() => el.classList.add('fade'), 7000);
  setTimeout(() => el.remove(), 7800);
}

// ---------------------------------------------------------- radar
const RADAR_PX = 5;
function buildRadarBg() {
  const c = makeCanvas(MAP_W * RADAR_PX, MAP_D * RADAR_PX), g = c.getContext('2d');
  for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) {
    const ch = cellAt(cx, cz);
    g.fillStyle = ch === '#' ? 'rgba(0,0,0,0)' : ch === '~' ? 'rgba(40,70,90,0.5)' : ch === 'a' || ch === 'b' ? 'rgba(150,110,80,0.9)' : ch === 'h' || ch === 'g' ? 'rgba(170,165,150,0.95)' : ROOF_H[ch] ? 'rgba(105,100,92,0.92)' : 'rgba(128,124,114,0.9)';
    g.fillRect(cx * CELL * RADAR_PX, cz * CELL * RADAR_PX, CELL * RADAR_PX, CELL * RADAR_PX);
  }
  g.fillStyle = 'rgba(30,30,30,0.85)';
  for (const p of PROPS) g.fillRect(p.min[0] * RADAR_PX, p.min[2] * RADAR_PX, (p.max[0] - p.min[0]) * RADAR_PX, (p.max[2] - p.min[2]) * RADAR_PX);
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2;
  for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) {
    if (cellAt(cx, cz) === '#' || cellAt(cx, cz) === '~') continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (cellAt(cx + dx, cz + dz) === '#') {
      const x = (cx + (dx > 0 ? 1 : 0)) * CELL * RADAR_PX, z = (cz + (dz > 0 ? 1 : 0)) * CELL * RADAR_PX;
      g.beginPath(); if (dx) { g.moveTo(x, cz * CELL * RADAR_PX); g.lineTo(x, (cz + 1) * CELL * RADAR_PX); } else { g.moveTo(cx * CELL * RADAR_PX, z); g.lineTo((cx + 1) * CELL * RADAR_PX, z); } g.stroke();
    }
  }
  g.font = 'bold 44px sans-serif'; g.fillStyle = 'rgba(255,215,170,0.85)'; g.textAlign = 'center'; g.textBaseline = 'middle';
  // only label the sites that are in play (none in deathmatch, just A in Wingman)
  if (!RULES.ffa) for (const k of activeSites()) g.fillText(k, SITES[k].cx * RADAR_PX, SITES[k].cz * RADAR_PX);
  HUD.radarBg = c;
}
function drawRadar(v) {
  const c = $('radar'), g = c.getContext('2d'), S = c.width;
  g.clearRect(0, 0, S, S);
  g.save();
  g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, TAU); g.clip();
  g.fillStyle = 'rgba(10,12,14,0.78)'; g.fillRect(0, 0, S, S);
  g.translate(S / 2, S / 2);
  g.rotate(CAM.yaw);
  const cx = CAM.pos.x, cz = CAM.pos.z;
  g.translate(-cx * RADAR_PX * 0.9, -cz * RADAR_PX * 0.9);
  g.scale(0.9, 0.9);
  g.drawImage(HUD.radarBg, 0, 0);
  for (const sm of FX.smokes) { g.fillStyle = 'rgba(210,210,205,0.75)'; g.beginPath(); g.arc(sm.x * RADAR_PX, sm.z * RADAR_PX, (sm.r - 1) * RADAR_PX, 0, TAU); g.fill(); }
  for (const f of FX.fires) { g.fillStyle = 'rgba(255,120,30,0.7)'; g.beginPath(); g.arc(f.x * RADAR_PX, f.z * RADAR_PX, 2.6 * RADAR_PX, 0, TAU); g.fill(); }
  const pt = G.player.team;
  for (const a of G.agents) {
    if (a === v && a.alive) continue;
    const mine = !RULES.ffa && a.team === pt; // in FFA everyone else is an enemy
    if (!mine && (!a.alive || G.time - a.spottedT > 1.3)) continue;
    const x = a.x * RADAR_PX, z = a.z * RADAR_PX;
    if (!a.alive) { g.strokeStyle = mine ? '#9cb8ff' : '#ff6a5a'; g.lineWidth = 3; g.beginPath(); g.moveTo(x - 6, z - 6); g.lineTo(x + 6, z + 6); g.moveTo(x + 6, z - 6); g.lineTo(x - 6, z + 6); g.stroke(); continue; }
    g.fillStyle = mine ? (a.team === 'T' ? '#f2c14e' : '#6fa8ff') : '#ff4a3a';
    g.beginPath(); g.arc(x, z, 7, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 2; g.stroke();
    const f = dirFromAngles(a.yaw, 0); g.strokeStyle = g.fillStyle; g.beginPath(); g.moveTo(x, z); g.lineTo(x + f.x * 14, z + f.z * 14); g.stroke();
  }
  const b = G.bomb;
  const known = b.state === 'planted' || (pt === 'T' && (b.state === 'dropped' || b.state === 'carried'));
  if (known && b.state !== 'exploded') {
    const src = b.state === 'carried' && b.carrier ? b.carrier : b;
    g.fillStyle = b.state === 'planted' && (G.time * 4) % 2 < 1 ? '#ff2a1a' : '#ff9a2a';
    g.fillRect(src.x * RADAR_PX - 6, src.z * RADAR_PX - 5, 12, 10);
  }
  g.restore();
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(S / 2, S / 2 - 9); g.lineTo(S / 2 + 6, S / 2 + 7); g.lineTo(S / 2, S / 2 + 3); g.lineTo(S / 2 - 6, S / 2 + 7); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 2; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, TAU); g.stroke();
}

// ---------------------------------------------------------- scoreboard
// deathmatch: one free-for-all table ranked by kills
function dmBoardHTML(final) {
  const rows = dmRanking().map((a, i) => {
    const kd = (a.kills / Math.max(1, a.deaths)).toFixed(2);
    return `<tr class="${a.isPlayer ? 'me' : ''} ${a.alive || final ? '' : 'dead'}"><td>${i + 1}</td><td>${a.name}</td><td>${a.kills}</td><td>${a.deaths}</td><td>${kd}</td><td>${a.totalDmg}</td></tr>`;
  }).join('');
  return `<div class="sb-team dm"><div class="sb-head"><b>Deathmatch</b><span>${RULES.killLimit} to win</span></div><table><tr><th>#</th><th>Player</th><th>K</th><th>D</th><th>K/D</th><th>Damage</th></tr>${rows}</table></div>`;
}
function scoreboardHTML(final) {
  if (RULES.ffa) return dmBoardHTML(final);
  const rows = (team) => G.agents.filter((a) => a.team === team).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths).map((a) => {
    const adr = a.roundsPlayed ? Math.round(a.totalDmg / Math.max(1, G.roundsPlayed || 1)) : 0;
    const stars = a.mvps ? `★${a.mvps > 1 ? a.mvps : ''}` : '';
    return `<tr class="${a.isPlayer ? 'me' : ''} ${a.alive || final ? '' : 'dead'}"><td>${a.name}</td><td>${a.kills}</td><td>${a.assists}</td><td>${a.deaths}</td><td>${adr}</td><td class="mvp">${stars}</td><td>${team === G.player.team || final ? '$' + a.money : ''}</td></tr>`;
  }).join('');
  return ['CT', 'T'].map((team) => `<div class="sb-team ${team === 'T' ? 't' : 'ct'}"><div class="sb-head"><b>${team === 'T' ? 'Attackers' : 'Defenders'}</b><span>${G.score[team]}</span></div><table><tr><th>Player</th><th>K</th><th>A</th><th>D</th><th>ADR</th><th>MVP</th><th>Money</th></tr>${rows(team)}</table></div>`).join('');
}

// ---------------------------------------------------------- per-frame HUD
function updateHUD(dt) {
  if (G.state !== 'playing') return;
  const p = G.player, v = CAM.view || p;
  const w = curWeapon(v);
  setText('hp', String(Math.max(0, Math.ceil(v.hp))));
  setText('armor', String(Math.ceil(v.armor)));
  setClass($('armor-box'), 'helmet', v.helmet);
  setClass($('vitals'), 'low', v.hp <= 25);
  setText('money', '$' + p.money);
  setClass($('money-box'), 'hidden', !!RULES.ffa); // no economy in deathmatch
  setClass($('buyzone'), 'hidden', !canBuy(p));
  setText('weapon-name', w.name);
  const am = v.ammo[v.weaponKey];
  setText('ammo-mag', am ? String(am.mag) : '');
  setText('ammo-res', am ? '/ ' + am.res : '');
  setClass($('ammo'), 'hidden', !am);
  setClass($('ammo'), 'low', !!am && am.mag <= Math.ceil(w.mag * 0.2));
  setClass($('c4-icon'), 'hidden', !v.hasC4);
  setClass($('kit-icon'), 'hidden', !v.defuser);
  const nadeTxt = NADE_KEYS.filter((k) => v.nades[k] > 0).map((k) => {
    const t = WEAPONS[k].short + (v.nades[k] > 1 ? ' ×' + v.nades[k] : '');
    return v.slot === 'grenade' && v.nadeSel === k ? `<b>${t}</b>` : t;
  }).join(' · ');
  const inv = [['primary', 1], ['secondary', 2], ['knife', 3], ['taser', 3], ['grenade', 4], ['c4', 5]].map(([s, n]) => {
    const key = slotKey(v, s); if (!key) return '';
    return `<span class="${v.slot === s ? 'on' : ''}"><kbd>${n}</kbd>${s === 'grenade' ? nadeTxt : WEAPONS[key].name}</span>`;
  }).join('');
  setHTML('inventory', inv);
  // top bar
  const tl = G.player.team === 'T';
  setClass($('dm-board'), 'hidden', !RULES.ffa);
  if (RULES.ffa) {
    // deathmatch: your kills on the left, the kill goal on the right, top 3 underneath
    setText('score-l', String(p.kills)); setText('score-r', String(RULES.killLimit));
    if (HUD.lastTeams !== 'dm') {
      HUD.lastTeams = 'dm';
      $('side-l').className = 'side dm me'; $('side-r').className = 'side dm';
      $('alive-l').innerHTML = '<small>You</small>'; $('alive-r').innerHTML = '<small>Goal</small>';
    }
    setHTML('dm-board', dmRanking().slice(0, 3).map((a, i) => `<div class="${a.isPlayer ? 'me' : ''}"><em>${i + 1}</em><span>${a.name}</span><b>${a.kills}</b></div>`).join(''));
  } else {
    setText('score-l', String(G.score[tl ? 'T' : 'CT'])); setText('score-r', String(G.score[tl ? 'CT' : 'T']));
  }
  const teams = tl ? 'T|CT' : 'CT|T';
  if (!RULES.ffa && HUD.lastTeams !== teams + G.agents.length) {
    HUD.lastTeams = teams + G.agents.length;
    $('side-l').className = 'side ' + (tl ? 't' : 'ct'); $('side-r').className = 'side ' + (tl ? 'ct' : 't');
    for (const [el, team] of [['alive-l', tl ? 'T' : 'CT'], ['alive-r', tl ? 'CT' : 'T']]) {
      const box = $(el); box.innerHTML = '';
      for (const a of G.agents.filter((x) => x.team === team)) { const i = document.createElement('i'); i.dataset.id = a.id; if (a.isPlayer) i.className = 'me'; box.appendChild(i); }
    }
  }
  for (const i of document.querySelectorAll('.alive i')) { const a = G.agents.find((x) => x.id == i.dataset.id); setClass(i, 'dead', !a || !a.alive); }
  // overtime is numbered (each OT is 2 × OT_HALF rounds)
  const otN = 1 + Math.floor((G.roundsPlayed - REG_HALF * 2) / (OT_HALF * 2));
  const half = G.roundsPlayed < REG_HALF ? '1st half' : G.roundsPlayed < REG_HALF * 2 ? '2nd half' : `Overtime ${otN}`;
  if (RULES.ffa) setText('round-label', G.phase === 'freeze' ? 'Get ready' : G.phase === 'over' ? 'Match over' : `Deathmatch · first to ${RULES.killLimit}`);
  else setText('round-label', G.phase === 'freeze' ? 'Buy phase' : `Round ${G.round} · ${half}`);
  const tb = $('timer');
  if (G.phase === 'planted') { setText('timer', ''); setClass(tb, 'bomb', true); }
  else { setClass(tb, 'bomb', false); setText('timer', fmtTime(G.phase === 'freeze' ? G.phaseT : G.phase === 'over' ? 0 : G.roundT)); }
  setText('location', calloutAt(v.x, v.z));
  // crosshair (static), scope overlay
  const scoped = v.alive && v.zoom && w.scope;
  setClass($('scope'), 'hidden', !scoped);
  setClass($('scope'), 'rifle', !!scoped && w.cat !== 'sniper');
  const hideCh = !v.alive || scoped || w.cat === 'sniper' || G.buyOpen;
  setClass($('crosshair'), 'hidden', hideCh);
  // messages / hints
  if (G.msg && G.msg.t > 0) { G.msg.t -= dt; if (G.msg.t <= 0) { setText('center-msg', ''); setText('sub-msg', ''); } }
  let hint = '';
  const b = G.bomb;
  if (p.alive) {
    if (RULES.ffa) {
      if (p.protectT > G.time) hint = 'Spawn protection (ends when you shoot)';
      else if (canBuy(p)) hint = `B: pick your guns for free (${Math.ceil(buyTimeLeft(p))} s)`;
    } else if (p.team === 'T' && p.hasC4 && G.phase === 'live') hint = plantSiteAt(p.x, p.z) ? 'Hold LMB with the C4 (5) or hold E to plant' : `You have the C4: plant it on ${activeSites().join(' or ')}`;
    else if (p.team === 'T' && b.state === 'dropped') hint = 'The C4 was dropped: walk over it to pick it up';
    else if (p.team === 'CT' && G.phase === 'planted' && Math.hypot(p.x - b.x, p.z - b.z) < 1.6) hint = p.defuser ? 'Hold E to defuse (kit: 5 s)' : 'Hold E to defuse (10 s)';
    else if (p.team === 'CT' && G.phase === 'planted') hint = 'The bomb is planted: find it and defuse it';
    const near = G.drops.find((d) => Math.hypot(d.x - p.x, d.z - p.z) < 1.5);
    if (!hint && near && p.inv[WEAPONS[near.key].slot]) hint = `E: swap for ${WEAPONS[near.key].name}`;
  }
  setText('hint', hint);
  const prog = $('progress'), planting = v.planting > 0, defusing = b.defuser === v && v.defusing;
  setClass(prog, 'hidden', !(planting || defusing));
  if (planting) { setText('progress-label', 'Planting'); $('progress-fill').style.width = (v.planting / PLANT_TIME) * 100 + '%'; }
  if (defusing) { setText('progress-label', v.defuser ? 'Defusing (kit)' : 'Defusing'); $('progress-fill').style.width = (b.defuseT / b.defuseTotal) * 100 + '%'; }
  // spectating
  const spec = !p.alive && CAM.view && CAM.view !== p;
  setClass($('spectate'), 'hidden', p.alive);
  if (spec) setText('spectate', `Spectating ${CAM.view.name} · click to switch`);
  else if (!p.alive) {
    const by = p.killer && p.killer !== p ? `Killed by ${p.killer.name} (${p.killer.hp} HP left)` : 'You died';
    setText('spectate', RULES.ffa && p.respawnAt ? `${by} · respawning in ${Math.max(0, p.respawnAt - G.time).toFixed(1)} s` : by);
  }
  // damage + flash + smoke overlays
  const vg = $('dmg-vignette'), vo = parseFloat(vg.style.opacity || 0); if (vo > 0) vg.style.opacity = Math.max(0, vo - dt * 1.2).toFixed(3);
  if (HUD.dmgDirT > 0) { HUD.dmgDirT -= dt; $('dmg-dir').style.opacity = clamp(HUD.dmgDirT, 0, 1).toFixed(2); }
  const blind = v.alive ? clamp(v.blindT / 1.6, 0, 1) : 0;
  $('flash').style.opacity = blind.toFixed(3);
  $('flashimg').style.opacity = (v.alive ? clamp(v.blindT / 3, 0, 0.75) : 0).toFixed(3);
  const inSmoke = smokeDensityAt(CAM.pos.x, CAM.pos.y, CAM.pos.z);
  HUD.smokeOv = lerp(HUD.smokeOv || 0, inSmoke, Math.min(1, dt * 6));
  $('smoke-ov').style.opacity = (HUD.smokeOv * 0.97).toFixed(3);
  if (G.boardOpen) setHTML('scoreboard', scoreboardHTML(false));
  drawRadar(v);
}

// ---------------------------------------------------------- buy menu
function buyLabel(k, team) {
  const w = WEAPONS[k], gear = GEAR[k], p = G.player;
  let price = w ? w.price : gear.price;
  if (k === 'vesthelm' && p.armor >= 100 && !p.helmet) price = 350;
  const nade = w && w.slot === 'grenade';
  const owned = nade ? p.nades[k] >= w.max : w ? p.inv[w.slot] === k : (k === 'vest' && p.armor >= 100) || (k === 'vesthelm' && p.helmet && p.armor >= 100) || (k === 'defuser' && p.defuser);
  const stat = !w ? (k === 'defuser' ? 'Defuse in 5 s' : k === 'vesthelm' ? 'Body armor + helmet' : 'Body armor') : w.slot === 'grenade' ? ({ he: 'Explodes after 1.6 s', flash: 'Blinds anyone facing it', smoke: 'Blocks vision ~18 s', molotov: 'Burns an area for 7 s', incgrenade: 'Burns an area for 7 s', decoy: 'Fakes gunfire' })[k] : k === 'taser' ? 'One-shot, very short range' : `${w.dmg}${w.pellets > 1 ? '×' + w.pellets : ''} dmg · ${w.mag}/${w.reserve} · ${Math.round(w.ap * 100)}% armor pen`;
  return { name: w ? w.name : gear.name, price, owned, stat, afford: p.money >= price };
}
function renderBuyMenu() {
  const p = G.player;
  setText('buy-money', '$' + p.money);
  setText('buy-time', `${RULES.ffa ? 'Free pick' : 'Buy time left'}: ${Math.max(0, Math.ceil(buyTimeLeft(p)))} s`);
  let html = '';
  buyCats(p).forEach(([cat, items], ci) => {
    const open = G.buyCat === ci;
    html += `<div class="buy-cat ${open ? 'open' : ''}"><h3><kbd>${ci + 1}</kbd>${cat}</h3>`;
    items.forEach((k, ii) => {
      const L = buyLabel(k, p.team);
      const price = L.owned ? 'Owned' : RULES.ffa ? 'Free' : '$' + L.price;
      html += `<button class="buy-item ${L.owned ? 'owned' : ''} ${L.afford || RULES.ffa ? '' : 'poor'}" data-k="${k}"><kbd>${open ? ii + 1 : ''}</kbd><b>${L.name}</b><small>${L.stat}</small><span>${price}</span></button>`;
    });
    html += '</div>';
  });
  $('buy-grid').innerHTML = html;
  for (const btn of $('buy-grid').querySelectorAll('.buy-item')) btn.onclick = () => doBuy(btn.dataset.k);
}
function doBuy(k) { if (buyItem(G.player, k)) SFX.play('buy'); else SFX.play('deny'); renderBuyMenu(); }
function openBuy() {
  if (!canBuy(G.player)) { SFX.play('deny'); showMsg('', RULES.ffa ? 'You can pick guns only right after you respawn' : buyTimeLeft() <= 0 ? 'Buy time is over' : 'You can only buy in your spawn', 1.4); return; }
  G.buyOpen = true; G.buyCat = null; renderBuyMenu();
  $('buy').classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}
function closeBuy(silent) {
  if (!G.buyOpen) return;
  G.buyOpen = false; $('buy').classList.add('hidden');
  if (!silent) lockPointer();
}
function buyKey(e) {
  if (e.code === 'KeyB' || e.code === 'Escape') { closeBuy(false); return; }
  const m = e.code.match(/^Digit(\d)$/);
  const cats = buyCats(G.player);
  if (m) {
    const n = +m[1] - 1;
    if (G.buyCat === null) { if (cats[n]) { G.buyCat = n; renderBuyMenu(); } }
    else { const item = cats[G.buyCat][1][n]; G.buyCat = null; if (item) doBuy(item); else renderBuyMenu(); }
  }
  if (e.code === 'Backspace' && G.buyCat !== null) { G.buyCat = null; renderBuyMenu(); }
}
