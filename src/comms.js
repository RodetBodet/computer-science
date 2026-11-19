'use strict';
/* =====================================================================
   COMMS: radio menus (Z / X / C), team chat feed, bot callouts and
   team pings (middle mouse or V). Only the player's team is shown.
   ===================================================================== */
const PING_LIFE = 4;
// three menus of short team messages; ids drive bot reactions
const RADIO_MENUS = {
  KeyZ: { title: 'Plans', items: [
    ['goA', 'Heading to A'], ['goB', 'Heading to B'], ['hold', 'Holding this spot'],
    ['fallback', 'Fall back, pull out'], ['regroup', 'Group up on me'], ['push', 'Push in together'],
  ] },
  KeyX: { title: 'Calls', items: [
    ['spotted', 'Contact'], ['backup', 'Need backup'], ['clear', 'This area is clear'],
    ['fire', 'Taking fire!'], ['flank', 'Watch the flank'], ['bomb', 'Bomb is here'],
  ] },
  KeyC: { title: 'Replies', items: [
    ['yes', 'Affirmative'], ['no', 'Negative'], ['report', 'Status check, everyone?'],
    ['inpos', 'In position'], ['nice', 'Nice shot'], ['thanks', 'Cheers'],
  ] },
};
const COMMS = { menu: null, menuT: 0, queue: [], teamCallT: { T: -99, CT: -99 }, botCallT: {}, hurtCalled: new Set(), lastPing: -9, pingEls: [], lastRadio: -9 };

function resetComms() {
  closeRadio();
  COMMS.queue.length = 0; COMMS.hurtCalled.clear(); COMMS.botCallT = {};
  COMMS.teamCallT = { T: -99, CT: -99 };
  for (const el of COMMS.pingEls) el.style.display = 'none';
}

// ---------------------------------------------------------- team chat
function addChat(a, text) {
  if (!a || a.team !== G.player.team || G.state !== 'playing') return; // team chat only
  const el = document.createElement('div');
  el.className = 'chat-line';
  const loc = calloutAt(a.x, a.z);
  el.innerHTML = `<b class="${a.team === 'T' ? 't' : 'ct'}">${a.name}</b>${loc && a.alive ? `<small>${loc}</small>` : ''}<span></span>`;
  el.querySelector('span').textContent = text; // message text never goes through innerHTML
  const feed = $('chat'); feed.appendChild(el);
  while (feed.children.length > 7) feed.firstChild.remove();
  setTimeout(() => el.classList.add('fade'), 8000);
  setTimeout(() => el.remove(), 8800);
  SFX.play('tick');
}
// queue a teammate reply so it doesn't land on the same frame as the request
function queueSay(a, text, delay) { COMMS.queue.push({ t: G.time + delay, a, text }); }

// ---------------------------------------------------------- radio menu
function openRadio(code) {
  if (COMMS.menu === code) { closeRadio(); return; }
  COMMS.menu = code; COMMS.menuT = 5;
  const m = RADIO_MENUS[code];
  $('radio').innerHTML = `<h4>${m.title}</h4>` + m.items.map(([, t], i) => `<div><kbd>${i + 1}</kbd>${t}</div>`).join('') + '<div class="dim"><kbd>0</kbd>Close</div>';
  $('radio').classList.remove('hidden');
}
function closeRadio() { COMMS.menu = null; const r = $('radio'); if (r) r.classList.add('hidden'); }
// keydown hook from player.js; returns true when the key was used here
function radioKey(e) {
  if (RULES.ffa) return false; // deathmatch has no team to talk to
  if (RADIO_MENUS[e.code]) { openRadio(e.code); return true; }
  if (e.code === 'KeyV') { placePing(G.player); return true; }
  if (!COMMS.menu) return false;
  const m = e.code.match(/^Digit(\d)$/);
  if (!m) return false;
  const n = +m[1];
  const item = RADIO_MENUS[COMMS.menu].items[n - 1];
  closeRadio();
  if (n && item) playerRadio(item[0], item[1]);
  return true;
}
const teamBots = () => G.agents.filter((a) => a.bot && a.alive && a.team === G.player.team);
function playerRadio(id, text) {
  const p = G.player;
  if (G.time - COMMS.lastRadio < 0.6) return; // no spamming
  COMMS.lastRadio = G.time;
  const loc = calloutAt(p.x, p.z);
  if (id === 'spotted') {
    // name the spot of the enemy we can see, if any, else our own position
    const seen = G.agents.filter((e) => e.alive && e.team !== p.team && G.time - e.spottedT < 0.6)
      .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
    const where = seen ? calloutAt(seen.x, seen.z) : loc;
    text = where ? `Contact at ${where}` : 'Contact near me';
  }
  if (id === 'backup' && loc) text = `Need backup at ${loc}`;
  addChat(p, text);
  const bots = teamBots();
  if (!bots.length) return;
  if ((id === 'goA' || id === 'goB') && G.phase !== 'planted' && G.phase !== 'over') {
    const site = id === 'goA' ? 'A' : 'B';
    if (p.team === 'T' && activeSites().includes(site)) { redirectAttack(site); queueSay(pick(bots), `Copy, rotating to ${site}`, rand(0.6, 1.3)); }
    else queueSay(pick(bots), 'Copy', rand(0.6, 1.3));
  } else if (id === 'backup') {
    const free = bots.filter((b) => !b.hasC4 && !b.planting && !b.defusing && G.time - b.bot.seenT > 1)
      .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    const b = free[0];
    if (b) {
      b.bot.plan = 'support'; b.bot.supportUntil = G.time + 20; b.bot.supportRepath = 0; b.bot.nadeTask = null;
      queueSay(b, `On my way, ${Math.round(Math.hypot(b.x - p.x, b.z - p.z))} m out`, rand(0.5, 1.1));
    }
  } else if (id === 'report') {
    shuffle(bots.slice()).slice(0, 2).forEach((b, i) => {
      const w = b.inv.primary ? WEAPONS[b.inv.primary].name : 'pistol';
      queueSay(b, `${calloutAt(b.x, b.z) || 'Moving'}, ${b.hp} HP, ${w}`, 0.7 + i * 0.8 + rand(0, 0.4));
    });
  } else if (['fallback', 'regroup', 'push', 'hold'].includes(id) && Math.random() < 0.6) {
    queueSay(pick(bots), pick(['Copy', 'Got it', 'Roger']), rand(0.6, 1.4));
  }
}
// player as attacker calls a site: bots that haven't committed yet re-route to it
function redirectAttack(site) {
  G.tSite = site;
  const ts = G.agents.filter((a) => a.bot && a.alive && a.team === 'T');
  const routes = T_ROUTES[site];
  ts.forEach((b, i) => {
    const B = b.bot;
    if (B.plan === 'route' || B.plan === 'stage') {
      B.plan = 'route'; B.route = routes[i % routes.length]; B.routeI = 0;
      setGoal(b, B.route[0][0], B.route[0][1], true);
    } else if (B.plan === 'execute' && G.phase === 'live') executeGoal(b);
  });
}
// a support bot goes back to its normal job
function endSupport(b) {
  const B = b.bot; B.supportUntil = 0;
  if (G.phase === 'planted') botBombPlanted(b);
  else if (b.team === 'T') executeGoal(b);
  else pickHold(b, B.holdSite || 'A');
}

// ---------------------------------------------------------- bot callouts
// throttled so the feed stays readable: per team and per bot
function botCallout(b, kind, data) {
  if (RULES.ffa || !b.bot || b.team !== G.player.team || G.state !== 'playing' || G.phase === 'freeze') return;
  if (G.time - COMMS.teamCallT[b.team] < (kind === 'hurt' ? 2 : 3.5)) return;
  if (G.time - (COMMS.botCallT[b.id] || -99) < 8) return;
  let text = '';
  if (kind === 'spot' && data) {
    const loc = calloutAt(data.x, data.z);
    const near = G.agents.filter((e) => e.alive && e.team !== b.team && Math.hypot(e.x - data.x, e.z - data.z) < 6 && G.time - e.spottedT < 0.5).length;
    const who = near >= 3 ? 'Several' : near === 2 ? 'Two' : 'One';
    text = loc ? `${who} at ${loc}` : `${who} near me`;
  } else if (kind === 'hurt') {
    if (COMMS.hurtCalled.has(b.id)) return;
    COMMS.hurtCalled.add(b.id);
    text = pick([`I'm hit, ${b.hp} HP left`, `Hurt bad, ${b.hp} HP`, `Low, ${b.hp} HP`]);
  } else return;
  COMMS.teamCallT[b.team] = G.time; COMMS.botCallT[b.id] = G.time;
  addChat(b, text);
}
function commsBombPlanted(planter, site) {
  const pt = G.player.team;
  if (planter.team === pt && planter.bot) addChat(planter, `Bomb's down on ${site}, cover it`);
  else if (planter.team !== pt) { const bots = teamBots(); if (bots.length) queueSay(pick(bots), `They planted on ${site}, rotate!`, rand(0.4, 1)); }
}

// ---------------------------------------------------------- pings
const _pingV = typeof THREE !== 'undefined' ? new THREE.Vector3() : null;
function placePing(a) {
  if (!a.alive || G.time - COMMS.lastPing < 0.5) return;
  const e = { x: CAM.pos.x, y: CAM.pos.y, z: CAM.pos.z }, d = dirFromAngles(CAM.yaw, CAM.pitch);
  const hit = rayCast(e.x, e.y, e.z, d.x, d.y, d.z, 150, false);
  let t = hit ? hit.t : (d.y < -0.01 ? -e.y / d.y : -1);
  if (t < 0) return; // pointing at the sky
  // an enemy in front of the wall makes this an enemy ping
  let kind = 'spot';
  for (const v of G.agents) {
    if (!v.alive || v.team === a.team) continue;
    const r = rayAgent(v, e.x, e.y, e.z, d.x, d.y, d.z, t);
    if (r && r.t < t) { t = r.t; kind = 'enemy'; }
  }
  COMMS.lastPing = G.time;
  const ping = { x: e.x + d.x * t, y: e.y + d.y * t, z: e.z + d.z * t, t: G.time, by: a, team: a.team, kind };
  G.pings = G.pings.filter((q) => q.by !== a); // one ping per player
  G.pings.push(ping);
  const loc = calloutAt(ping.x, ping.z);
  addChat(a, (kind === 'enemy' ? 'Enemy' : 'Marked') + (loc ? ` · ${loc}` : ''));
}
// per frame: queued replies, radio timeout, screen-space ping markers
function updateComms(dt) {
  const p = G.player;
  for (let i = COMMS.queue.length - 1; i >= 0; i--) {
    const q = COMMS.queue[i];
    if (G.time >= q.t) { COMMS.queue.splice(i, 1); if (q.a.alive) addChat(q.a, q.text); }
  }
  if (COMMS.menu) { COMMS.menuT -= dt; if (COMMS.menuT <= 0 || !p.alive) closeRadio(); }
  G.pings = G.pings.filter((q) => G.time - q.t < PING_LIFE && q.team === p.team);
  const box = $('pings'), cam = RENDER.camera, W = innerWidth, H = innerHeight;
  while (COMMS.pingEls.length < G.pings.length) {
    const el = document.createElement('div'); el.className = 'ping'; el.innerHTML = '<i></i><small></small>';
    box.appendChild(el); COMMS.pingEls.push(el);
  }
  COMMS.pingEls.forEach((el, i) => {
    const q = G.pings[i];
    if (!q) { el.style.display = 'none'; return; }
    _pingV.set(q.x, q.y + 0.3, q.z).project(cam);
    if (_pingV.z > 1) { el.style.display = 'none'; return; } // behind the camera
    const x = clamp((_pingV.x + 1) / 2 * W, 20, W - 20), y = clamp((1 - _pingV.y) / 2 * H, 20, H - 20);
    const age = G.time - q.t;
    el.style.display = '';
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    el.style.opacity = clamp((PING_LIFE - age) / 1.2, 0, 1).toFixed(2);
    el.className = 'ping ' + q.kind + (age < 0.3 ? ' fresh' : '');
    el.lastChild.textContent = Math.round(Math.hypot(q.x - CAM.pos.x, q.y - CAM.pos.y, q.z - CAM.pos.z)) + ' m';
  });
}
// drawn inside the radar's world transform (hud.js drawRadar)
function drawRadarPings(g) {
  for (const q of G.pings) {
    const a = clamp((PING_LIFE - (G.time - q.t)) / 1.2, 0, 1), x = q.x * RADAR_PX, z = q.z * RADAR_PX;
    g.globalAlpha = a;
    g.fillStyle = q.kind === 'enemy' ? '#ff5a4a' : '#ffd36a'; g.strokeStyle = 'rgba(0,0,0,0.8)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, z - 9); g.lineTo(x + 7, z); g.lineTo(x, z + 9); g.lineTo(x - 7, z); g.closePath(); g.fill(); g.stroke();
  }
  g.globalAlpha = 1;
}
