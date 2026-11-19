'use strict';
/* =====================================================================
   BOTS: perception -> decisions -> movement + aim.
   Individual brain (updateBot, 10 Hz perception) plus a small team
   brain per side (TEAM_AI, also 10 Hz): buys, execute timing, lurker,
   rotations, retakes, angle claims for trades and peeks.
   ===================================================================== */
const TEAM_AI = { T: null, CT: null };
const BOT_STATS = { trades: 0, tradeKills: 0, peeks: 0, jiggles: 0, offAngles: 0, saves: 0, drops: 0, lurks: 0, splits: 0, executes: 0, rotations: 0, regroups: 0, retakes: 0, buys: [] };
function freshTeamAI(team) {
  return {
    team, buy: null, buyRound: -1, claims: {}, nextTick: 0,
    // T side
    execAt: 0, split: false, rush: false, lurker: null, minExec: 0, deadline: 0,
    // CT side
    seen: { A: {}, B: {} }, level: { A: 0, B: 0 }, retake: null,
  };
}
const teamAI = (team) => TEAM_AI[team] || (TEAM_AI[team] = freshTeamAI(team));
function resetTeamAI() {
  for (const t of ['T', 'CT']) {
    const old = TEAM_AI[t]; TEAM_AI[t] = freshTeamAI(t);
    if (old && old.buyRound === G.round) { TEAM_AI[t].buy = old.buy; TEAM_AI[t].buyRound = old.buyRound; }
  }
}
// angle claims: one bot peeks/pushes a spot, the others cover it instead of double-peeking
const angleKey = (x, z) => Math.round(x / 3) + ':' + Math.round(z / 3);
function claimAngle(b, x, z, dur) {
  const T = teamAI(b.team), k = angleKey(x, z), c = T.claims[k];
  if (c && c.bot !== b && c.bot.alive && c.until > G.time) return false;
  T.claims[k] = { bot: b, until: G.time + dur };
  return true;
}
const otherSite = (s) => (s === 'A' ? 'B' : 'A');
function siteNear(x, z, m) {
  const s0 = siteAt(x, z); if (s0) return s0;
  for (const k in SITES) { const s = SITES[k]; if (x >= s.x0 - m && x <= s.x1 + m && z >= s.z0 - m && z <= s.z1 + m) return k; }
  return null;
}
const navY = (x, z) => { const i = navIndex(x, z); return i >= 0 ? WORLD.nav.h[i] || 0 : 0; };

function makeBot(team, name) {
  const a = makeAgent(team, name, false);
  a.bot = {
    plan: 'idle', goal: null, path: null, pathI: 0, pathGoalKey: '', repathT: 0, look: null, holdSite: null,
    target: null, reactT: 0, seenT: -99, lastSeen: null, errY: 0, errP: 0, aimZone: 'chest', burstLeft: 0, recoilComp: 0,
    heard: null, nadeTask: null, stuckT: 0, lastX: 0, lastZ: 0, strafe: 1, strafeT: 0, thinkT: Math.random() * 0.1,
    stageUntil: 0, route: null, routeI: 0, wantWalk: false, wantDuck: false, jumpCd: 0, usedUtil: false, rotateAt: 0, rotateTo: null, save: false,
    trade: null, resume: null, peek: null, peekCd: 0, peekOrigin: null, cleared: {}, threat: null, likely: null, likelyPlan: '',
    sync: true, utilOK: true, saveChecked: false, retakePhase: null, lurkGo: 0, holdDuck: false, giftPending: false, moveX: 0, moveZ: 0, cstrafe: true,
  };
  return a;
}
function resetBotRound(b) {
  const diff = D();
  Object.assign(b.bot, {
    target: null, heard: null, nadeTask: null, usedUtil: false, save: false, look: null, rotateAt: 0, rotateTo: null,
    trade: null, resume: null, peek: null, peekCd: 0, peekOrigin: null, cleared: {}, threat: null, likely: null, likelyPlan: '',
    sync: Math.random() < 0.15 + diff.team * 0.85, utilOK: Math.random() < diff.util, saveChecked: false, retakePhase: null, lurkGo: 0,
    holdDuck: false, giftPending: false, retakeVia: null, rotating: false, wantDrop: false,
  });
}
// a target worth engaging: alive, hostile (anyone in deathmatch) and not under spawn protection
const ENEMY = (b, e) => e.alive && hostile(b, e) && !(RULES.ffa && e.protectT > G.time);
function canSee(b, e) {
  if (b.blindT > 0.5) return false;
  const diff = D();
  const ex = b.x, ey = b.y + b.eye, ez = b.z;
  const dx = e.x - ex, dz = e.z - ez, d = Math.hypot(dx, dz);
  if (d > diff.see) return false;
  const yawTo_ = yawTo(ex, ez, e.x, e.z), off = Math.abs(angNorm(yawTo_ - b.yaw));
  if (d > 2.5 && off > diff.fov * DEG && !(b.hurtT > G.time)) return false;
  for (const zone of ['head', 'chest']) {
    const p = aimPoint(e, zone);
    if (losClear(ex, ey, ez, p.x, p.y, p.z) && !smokeBlocks(ex, ey, ez, p.x, p.y, p.z)) return true;
  }
  return false;
}
function botTurn(b, yaw, pitch, dt, speedDeg) {
  const dy = angNorm(yaw - b.yaw), dp = pitch - b.pitch;
  const maxStep = speedDeg * DEG * dt;
  const ease = (d) => Math.sign(d) * Math.min(Math.abs(d), maxStep * (0.25 + 0.75 * Math.min(1, Math.abs(d) / (25 * DEG))));
  b.yaw = angNorm(b.yaw + ease(dy)); b.pitch = clamp(b.pitch + ease(dp), -1.4, 1.4);
}
function setGoal(b, x, z, force) {
  const key = Math.round(x * 2) + ',' + Math.round(z * 2);
  if (!force && b.bot.pathGoalKey === key && b.bot.path) return;
  b.bot.goal = { x, z }; b.bot.pathGoalKey = key; b.bot.path = null; b.bot.repathT = 0;
}
// follow the current path; returns true when arrived (A* only when the goal changes or every 4-6 s)
function navigate(b, dt) {
  const B = b.bot;
  if (!B.goal) return true;
  B.repathT -= dt;
  if (!B.path || B.repathT <= 0) {
    B.path = findPath(b.x, b.z, B.goal.x, B.goal.z, b.y) || [];
    B.pathI = 0; B.repathT = 4 + Math.random() * 2;
  }
  if (!B.path.length) return Math.hypot(b.x - B.goal.x, b.z - B.goal.z) < 1.5;
  let p = B.path[B.pathI];
  let d = Math.hypot(p.x - b.x, p.z - b.z);
  while (d < 0.45 && B.pathI < B.path.length - 1) { B.pathI++; p = B.path[B.pathI]; d = Math.hypot(p.x - b.x, p.z - b.z); }
  if (B.pathI >= B.path.length - 1 && d < 0.45) return true;
  B.wishX = (p.x - b.x) / (d || 1); B.wishZ = (p.z - b.z) / (d || 1);
  return false;
}
// temporary goal (trade push) that remembers the plan's goal
function detour(b, x, z) {
  const B = b.bot;
  if (!B.resume) B.resume = B.goal ? { x: B.goal.x, z: B.goal.z } : { x: b.x, z: b.z };
  setGoal(b, x, z);
}
function endDetour(b) {
  const B = b.bot;
  if (B.resume) { setGoal(b, B.resume.x, B.resume.z, true); B.resume = null; }
}
function clearDetour(b) { b.bot.trade = null; b.bot.resume = null; b.bot.peek = null; }

function pickHold(b, where) {
  const B = b.bot;
  clearDetour(b);
  const list = CT_HOLDS[where] || CT_HOLDS.A;
  const spot = pick(list);
  let x = spot[0], z = spot[1];
  B.holdDuck = false;
  // sometimes hold an off-angle: shifted sideways from the standard spot, maybe crouched
  if (where !== 'mid' && Math.random() < 0.15 + 0.25 * D().peek) {
    const ly = yawTo(x, z, spot[2], spot[3]), r = dirFromAngles(ly + Math.PI / 2, 0), s = (Math.random() < 0.5 ? -1 : 1) * rand(1.5, 3);
    const ni = navIndex(x + r.x * s, z + r.z * s);
    if (ni >= 0 && WORLD.nav.walk[ni]) {
      const c = navCenter(ni);
      if (losClear(c.x, c.y + 1.6, c.z, spot[2], navY(spot[2], spot[3]) + 1.4, spot[3])) { x = c.x; z = c.z; BOT_STATS.offAngles++; }
    }
    B.holdDuck = Math.random() < 0.35;
  }
  B.holdSite = where; B.plan = 'hold'; B.look = { x: spot[2], z: spot[3] };
  setGoal(b, x + rand(-0.4, 0.4), z + rand(-0.4, 0.4), true);
}
function botsNewRound() {
  resetTeamAI();
  G.tSite = pick(activeSites()); // Wingman: always A
  const ts = G.agents.filter((a) => a.bot && a.team === 'T'), cts = G.agents.filter((a) => a.bot && a.team === 'CT');
  const TA = teamAI('T'), routes = T_ROUTES[G.tSite];
  TA.rush = Math.random() < (G.pistolRound ? 0.25 : TA.buy === 'eco' ? 0.3 : 0.1);
  TA.split = !TA.rush && routes.length > 1 && Math.random() < 0.6;
  TA.minExec = ROUND_TIME - rand(15, 28);
  TA.deadline = ROUND_TIME - rand(45, 55);
  const lurkers = ts.filter((b) => !b.hasC4);
  if (!TA.rush && !RULES.sites && ts.length >= 3 && lurkers.length && Math.random() < 0.45) { TA.lurker = pick(lurkers); BOT_STATS.lurks++; }
  const stackRoute = randInt(0, routes.length - 1);
  let n = 0;
  ts.forEach((b) => {
    const B = b.bot;
    resetBotRound(b);
    if (b === TA.lurker) {
      // lurk toward the other site, stop short of its entrance and wait for rotators
      const r = pick(T_ROUTES[otherSite(G.tSite)]);
      B.plan = 'lurk'; B.route = r.length > 2 ? r.slice(0, -1) : r.slice(); B.routeI = 0;
      setGoal(b, B.route[0][0], B.route[0][1], true);
      return;
    }
    B.plan = 'route'; B.route = TA.split ? routes[n % routes.length] : routes[stackRoute]; B.routeI = 0; n++;
    // unsynced bots (low team skill) go on their own clock, like before
    B.stageUntil = TA.rush ? ROUND_TIME + 1 : B.sync ? TA.deadline : ROUND_TIME - rand(22, 42);
    setGoal(b, B.route[0][0], B.route[0][1], true);
  });
  if (TA.split) BOT_STATS.splits++;
  let order;
  if (RULES.sites && RULES.sites.length === 1) order = cts.map(() => RULES.sites[0]); // single-site modes: everyone holds it
  else { order = shuffle(['A', 'A', 'B', 'B']).slice(0, cts.length); order.splice(randInt(0, Math.max(0, cts.length - 1)), 0, 'mid'); }
  cts.forEach((b, i) => { resetBotRound(b); pickHold(b, order[i] || pick(activeSites())); });
}
function botGotBomb(b) { if (G.phase !== 'planted' && b.bot.plan !== 'route') { b.bot.plan = 'execute'; executeGoal(b); } }
function executeGoal(b) {
  const B = b.bot;
  clearDetour(b);
  if (b.hasC4) { const s = pick(PLANT_SPOTS[G.tSite]); setGoal(b, s[0], s[1], true); B.look = null; }
  else {
    const s = SITES[G.tSite];
    const spot = randomWalkableIn({ x0: s.x0 + 2, x1: s.x1 - 2, z0: s.z0 + 2, z1: s.z1 - 2 });
    setGoal(b, spot.x, spot.z, true);
    const e = pick(SITE_ENTRIES[G.tSite]); B.look = { x: e[0], z: e[1] };
  }
  B.plan = 'execute';
}
function botBombPlanted(b) {
  const B = b.bot, bomb = G.bomb;
  B.nadeTask = null;
  clearDetour(b);
  if (B.save) return; // already saving: keep running
  if (b.team === 'T') {
    B.plan = 'postplant';
    let spot = null;
    for (let i = 0; i < 20; i++) {
      const ang = rand(0, TAU), r = rand(4, 9), x = bomb.x + Math.cos(ang) * r, z = bomb.z + Math.sin(ang) * r;
      const ni = navIndex(x, z); if (ni < 0 || !WORLD.nav.walk[ni]) continue;
      const c = navCenter(ni);
      if (losClear(c.x, c.y + 1.6, c.z, bomb.x, bomb.y + 0.3, bomb.z)) { spot = c; break; }
    }
    spot = spot || { x: bomb.x + 2, z: bomb.z };
    setGoal(b, spot.x, spot.z, true);
    const e = pick(SITE_ENTRIES[bomb.site]); B.look = { x: e[0], z: e[1] };
  } else {
    B.plan = 'retake';
    const CA = teamAI('CT');
    if (!CA.retake) CA.retake = planRetake(bomb);
    const R = CA.retake;
    if (R.go) { B.retakePhase = 'go'; setGoal(b, bomb.x, bomb.z, true); }
    else if (siteNear(b.x, b.z, 2) === bomb.site) { B.retakePhase = 'in'; B.goal = null; B.look = { x: bomb.x, z: bomb.z }; }
    else { B.retakePhase = 'regroup'; setGoal(b, R.x, R.z, true); B.look = { x: bomb.x, z: bomb.z }; }
  }
}
// pick the site entry most CTs are closest to, and decide if there is time to group up
function planRetake(bomb) {
  const diff = D(), site = bomb.site;
  const cts = G.agents.filter((a) => a.bot && a.alive && a.team === 'CT');
  const outs = cts.filter((a) => siteNear(a.x, a.z, 2) !== site);
  let best = SITE_ENTRIES[site][0], bs = 1e9;
  for (const e of SITE_ENTRIES[site]) {
    const s = outs.reduce((acc, a) => acc + Math.hypot(a.x - e[0], a.z - e[1]), 0);
    if (s < bs) { bs = s; best = e; }
  }
  const run = 6;
  const far = outs.reduce((m, a) => Math.max(m, Math.hypot(a.x - best[0], a.z - best[1])), 0);
  const toBomb = Math.hypot(best[0] - bomb.x, best[1] - bomb.z) / run;
  const defuse = cts.some((a) => a.defuser) ? KIT_DEFUSE_TIME : DEFUSE_TIME;
  const latest = toBomb + defuse + 2.5; // must leave the regroup point by this bomb timer
  const slack = bomb.timer - far / run - latest;
  const regroup = outs.length >= 2 && slack > 4 && Math.random() < 0.2 + diff.team;
  if (regroup) BOT_STATS.regroups++;
  BOT_STATS.retakes++;
  return { site, x: best[0], z: best[1], regroup, go: !regroup, goAt: G.time + (regroup ? Math.min(slack, far / run + 5) : 0), latest };
}
function botHear(b, x, z, kind, d, src) {
  const B = b.bot;
  if (B.target && G.time - B.seenT < 1) return;
  // sounds give a rough position, and repeated footsteps don't refresh it every step (no wall tracking)
  if (kind === 'step' && B.heard && B.heard.kind === 'step' && G.time - B.heard.t < 0.6) return;
  const err = d * D().hearErr;
  B.heard = { x: x + clamp(gauss(), -2, 2) * err, z: z + clamp(gauss(), -2, 2) * err, t: G.time, kind };
  if (src && b.team === 'CT' && !RULES.ffa) { const s = siteNear(x, z, 8); if (s) G.intel[s] = G.time; }
}
function botOnHurt(b, att) {
  b.hurtT = G.time + 1.5;
  if (b.hp > 0 && b.hp < 45) botCallout(b, 'hurt', att);
  if (att && att.alive && !b.bot.target) { b.bot.heard = { x: att.x, z: att.z, t: G.time, kind: 'hurt' }; }
}
function botFlashed(b) { b.bot.target = null; b.bot.reactT = 0.3; b.bot.wantDuck = Math.random() < 0.4; b.bot.peek = null; }
// a teammate died: the closest free bot pushes the killer's spot to trade, the next one covers it
function botTeammateDied(b, v, k) {
  const B = b.bot;
  if (RULES.ffa || !k || k === v || k.team === b.team) return; // no teammates to trade for in deathmatch
  const d = Math.hypot(b.x - v.x, b.z - v.z);
  if (k.alive && d < 40) B.heard = { x: k.x + rand(-2, 2), z: k.z + rand(-2, 2), t: G.time, kind: 'callout' };
  if (!k.alive || d > 22) return;
  const free = (m) => m.bot && m.alive && m.team === b.team && !m.bot.save && !m.planting && !m.defusing && !(m.bot.target && m.bot.target.alive && G.time - m.bot.seenT < 0.5) && Math.hypot(m.x - v.x, m.z - v.z) < 22;
  if (!free(b)) return;
  const rank = G.agents.filter((m) => free(m) && Math.hypot(m.x - v.x, m.z - v.z) < d).length;
  if (rank > 1 || Math.random() > D().trade) return;
  const role = rank === 0 && claimAngle(b, k.x, k.z, 2.6) ? 'push' : 'cover';
  B.trade = { x: k.x, z: k.z, until: G.time + rand(2.0, 2.6), killer: k, role };
  if (role === 'push') { detour(b, k.x, k.z); BOT_STATS.trades++; }
}

// ---------- utility ----------
// launch pitch so the grenade lands at (tx,ty,tz); returns pitch or null
function solveThrow(b, tx, ty, tz) {
  const v = 15.2, g = GRAV_NADE;
  const ex = b.x, ey = b.y + b.eye, ez = b.z, d = Math.hypot(tx - ex, tz - ez), h = ty - ey;
  const disc = v ** 4 - g * (g * d * d + 2 * h * v * v);
  if (disc < 0) return null;
  for (const sgn of [-1, 1]) {
    const th = Math.atan((v * v + sgn * Math.sqrt(disc)) / (g * d));
    // simulate to check nothing is in the way
    const yaw = yawTo(ex, ez, tx, tz), dir = dirFromAngles(yaw, th);
    let x = ex, y = ey, z = ez, vx = dir.x * v, vy = dir.y * v, vz = dir.z * v, ok = true;
    for (let t = 0; t < 4; t += 0.05) {
      vy -= g * 0.05; x += vx * 0.05; y += vy * 0.05; z += vz * 0.05;
      if (Math.hypot(x - tx, z - tz) < 1.5 && Math.abs(y - ty) < 2) break;
      if (pointSolid(x, y, z)) { ok = Math.hypot(x - tx, z - tz) < 2.5; break; }
      if (y < -1) { ok = false; break; }
    }
    if (ok) return { yaw, pitch: th };
  }
  return null;
}
const teamNadeKey = (b, type) => (type === 'molotov' && b.team === 'CT' ? 'incgrenade' : type === 'incgrenade' && b.team === 'T' ? 'molotov' : type);
function planUtility(b, list) {
  const B = b.bot;
  if (B.usedUtil || B.nadeTask || !B.utilOK || !list) return;
  for (const [type, , , tx, tz] of shuffle(list.slice())) {
    if (planThrowAt(b, teamNadeKey(b, type), tx, tz, rand(0.2, 0.8))) { B.usedUtil = true; return; }
  }
}
function planThrowAt(b, key, tx, tz, delay) {
  if (!b.nades[key]) return false;
  const d = Math.hypot(tx - b.x, tz - b.z);
  if (d < 6 || d > 27) return false;
  const ty = WORLD.nav.h[nearestWalkable(tx, tz)] || 0;
  const sol = solveThrow(b, tx, ty, tz);
  if (!sol) return false;
  b.bot.nadeTask = { key, yaw: sol.yaw, pitch: sol.pitch, t: G.time + delay, equipped: false };
  return true;
}
function runNadeTask(b, dt) {
  const B = b.bot, task = B.nadeTask;
  if (!task || G.time < task.t) return false;
  if (!b.nades[task.key]) { B.nadeTask = null; return false; }
  if (!task.equipped) { b.nadeSel = task.key; equip(b, 'grenade', true); task.equipped = true; }
  botTurn(b, task.yaw, task.pitch, dt, 500);
  B.wishX = 0; B.wishZ = 0;
  if (b.drawT <= 0 && Math.abs(angNorm(task.yaw - b.yaw)) < 2 * DEG && Math.abs(task.pitch - b.pitch) < 2 * DEG && G.time >= b.nextAttack) {
    // aim compensation: throwNade adds a small upward bias, so remove it here
    const bias = (10 * DEG) * (1 - Math.abs(b.pitch) / (Math.PI / 2));
    b.pitch -= bias;
    if (task.key === 'flash') {
      b.flashImmuneT = G.time + 2.2;
      // flash call: nearby bot teammates turn away
      for (const m of G.agents) if (m.bot && m !== b && m.alive && m.team === b.team && Math.hypot(m.x - b.x, m.z - b.z) < 25) m.flashImmuneT = G.time + 2.2;
    }
    throwNade(b, 1);
    b.pitch += bias;
    B.nadeTask = null;
  }
  return true;
}

// ---------- buying (team-level decision, then per bot) ----------
function roundsToWinNow() {
  const r = G.roundsPlayed;
  if (RULES.overtime && r >= REG_HALF * 2) return REG_HALF + OT_HALF * Math.floor((r - REG_HALF * 2) / (OT_HALF * 2)) + OT_HALF + 1;
  return REG_HALF + 1;
}
function lastRoundOfHalf() {
  const n = G.roundsPlayed + 1; // the round about to be played
  if (n === REG_HALF || n === REG_HALF * 2) return true;
  return RULES.overtime && n > REG_HALF * 2 && (n - REG_HALF * 2) % OT_HALF === 0;
}
const riflePrice = (team) => WEAPONS[team === 'T' ? 'ak47' : 'm4a4'].price;
function teamBuyDecision(team) {
  if (G.pistolRound) return 'pistol';
  const other = team === 'T' ? 'CT' : 'T';
  const mates = G.agents.filter((a) => a.team === team);
  const avg = mates.reduce((s, a) => s + a.money, 0) / mates.length;
  const kit = riflePrice(team) + 1000; // rifle + helmet + a nade
  // how many of us end up with a rifle if the rich drop for the poor
  let armed = 0, surplus = 0;
  for (const a of mates) {
    if (a.inv.primary) { armed++; surplus += Math.max(0, a.money - 1000); }
    else if (a.money >= kit) { armed++; surplus += a.money - kit; }
  }
  armed = Math.min(mates.length, armed + Math.floor(surplus / riflePrice(team)));
  if (armed >= mates.length - 1) return 'full';
  const need = roundsToWinNow();
  const matchPoint = G.score[team] === need - 1 || G.score[other] === need - 1;
  const wonPistol = (G.roundsPlayed === 1 || G.roundsPlayed === REG_HALF + 1) && G.lastWinner === team;
  if (wonPistol || matchPoint || lastRoundOfHalf()) return 'force';
  // would saving now give a full buy next round? then eco, otherwise force with what we have
  const nextLoss = 1400 + 500 * Math.min(4, G.lossCount[team]);
  if (avg + nextLoss >= kit) return 'eco';
  return avg >= 2200 ? 'force' : 'eco';
}
function botBuy(b) { teamBuy(b.team); }
function teamBuy(team) {
  const TA = teamAI(team);
  if (TA.buyRound === G.round) return;
  TA.buyRound = G.round;
  const mode = teamBuyDecision(team);
  TA.buy = mode;
  BOT_STATS.buys.push(`R${G.round} ${team} ${mode}`); if (BOT_STATS.buys.length > 40) BOT_STATS.buys.shift();
  const bots = G.agents.filter((a) => a.bot && a.team === team).sort((p, q) => q.money - p.money);
  for (const b of bots) b.bot.giftPending = false;
  for (const b of bots) buyGuns(b, mode);
  if (mode === 'full' || mode === 'force') teamDrops(team);
  for (const b of bots) buyExtras(b, mode);
  for (const b of bots) { equip(b, bestSlot(b), true); b.drawT = 0; }
}
function buyArmor(b) { if (!buyItem(b, 'vesthelm')) buyItem(b, 'vest'); }
function buyGuns(b, mode) {
  const buy = (k) => buyItem(b, k);
  const team = G.agents.filter((a) => a.team === b.team);
  const rifle = b.team === 'T' ? 'ak47' : (Math.random() < 0.5 ? 'm4a4' : 'm4a1s');
  const cheap = b.team === 'T' ? 'galil' : 'famas';
  const smg = b.team === 'T' ? pick(['mac10', 'ump45', 'mp7']) : pick(['mp9', 'ump45', 'mp7']);
  if (mode === 'pistol') {
    const r = Math.random();
    if (r < 0.5) buy('vest'); else if (r < 0.75) buy('p250'); else { buy(b.team === 'T' ? 'tec9' : 'fiveseven'); }
    if (Math.random() < 0.5) buy('flash');
    if (b.team === 'CT' && Math.random() < 0.3) buy('defuser');
    return;
  }
  if (b.inv.primary) { if (mode !== 'eco' || b.money >= 1500) buyArmor(b); return; }
  if (mode === 'full') {
    const awpTaken = team.some((a) => a !== b && a.inv.primary === 'awp');
    if (!awpTaken && b.money >= 6000 && Math.random() < 0.3) buy('awp');
    else if (b.money >= WEAPONS[rifle].price + 650) buy(rifle);
    else { b.bot.wantDrop = true; return; } // wait for a teammate's drop
    buyArmor(b);
  } else if (mode === 'force') {
    const opts = [rifle, cheap, smg].filter((k) => WEAPONS[k] && b.money >= WEAPONS[k].price + 650);
    if (opts.length) buy(opts[0] === rifle && Math.random() < 0.3 && opts[1] ? opts[1] : opts[0]);
    else if (b.money < 1700) { if (b.money >= 700) buy(Math.random() < 0.5 ? 'deagle' : 'p250'); }
    else { b.bot.wantDrop = true; return; }
    buyArmor(b);
  } else if (b.money >= 3000 && Math.random() < 0.3) buy(Math.random() < 0.5 ? 'deagle' : 'p250'); // eco: maybe a pistol upgrade
}
// rich bots buy an extra rifle for poor teammates (the human player included) during freeze time
function teamDrops(team) {
  const price = riflePrice(team);
  const poor = G.agents.filter((a) => a.team === team && a.alive && !a.inv.primary && (a.bot ? a.bot.wantDrop : a.money < price)).sort((p, q) => p.money - q.money);
  const donors = G.agents.filter((a) => a.bot && a.team === team && a.inv.primary).sort((p, q) => q.money - p.money);
  for (const mate of poor) {
    const donor = donors.find((d) => d !== mate && d.money >= price + 200);
    if (donor && dropRifleFor(donor, mate)) { if (mate.bot) mate.bot.giftPending = true; }
  }
  for (const a of G.agents) if (a.bot) a.bot.wantDrop = false;
}
function dropRifleFor(donor, mate) {
  const key = donor.team === 'T' ? 'ak47' : donor.inv.primary === 'm4a1s' ? 'm4a1s' : 'm4a4';
  const w = WEAPONS[key];
  if (!w || donor.money < w.price) return false;
  donor.money -= w.price;
  const dx = mate.x - donor.x, dz = mate.z - donor.z, d = Math.hypot(dx, dz) || 1;
  donor.yaw = yawTo(donor.x, donor.z, mate.x, mate.z);
  const drop = { key, x: mate.x - (dx / d) * 0.25, y: mate.y + 0.8, z: mate.z - (dz / d) * 0.25, vx: (dx / d) * 0.6, vy: 0, vz: (dz / d) * 0.6, mag: w.mag, res: w.reserve, t: G.time, owner: donor, rest: false };
  drop.skin = donor.skins[key] || null;
  drop.mesh = gunModel(key, { finish: drop.skin }).group; drop.mesh.rotation.set(0, rand(0, TAU), Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1));
  FX.scene.add(drop.mesh);
  G.drops.push(drop);
  BOT_STATS.drops++;
  // after the round banner (startRound shows it right after buying)
  if (mate.isPlayer) setTimeout(() => { if (G.state === 'playing' && G.phase === 'freeze') showMsg('', `${donor.name} dropped you a ${w.name}`, 2.5); }, 3600);
  return true;
}
function buyExtras(b, mode) {
  if (mode === 'pistol') return;
  const B = b.bot;
  if (!b.inv.primary && !B.giftPending && (mode === 'full' || mode === 'force')) {
    const smg = b.team === 'T' ? pick(['mac10', 'ump45']) : pick(['mp9', 'ump45']);
    if (b.money >= WEAPONS[smg].price + 650) buyItem(b, smg); else if (b.money >= 700) buyItem(b, 'p250');
  }
  if (mode !== 'eco' && (b.inv.primary || B.giftPending || b.money > 2000)) buyArmor(b);
  const armed = b.inv.primary || B.giftPending;
  if (b.team === 'CT' && armed && Math.random() < (mode === 'full' ? 0.75 : 0.4)) buyItem(b, 'defuser');
  if (armed && mode !== 'eco') {
    const fireNade = b.team === 'T' ? 'molotov' : 'incgrenade';
    for (const k of shuffle(['smoke', 'flash', 'flash', fireNade, 'he'])) if (b.money >= WEAPONS[k].price + 100 && Math.random() < 0.75) buyItem(b, k);
  }
}

// ---------- team brain (10 Hz, run by whichever bot ticks first) ----------
function teamTick(team) {
  const TA = teamAI(team);
  if (G.time < TA.nextTick) return;
  TA.nextTick = G.time + 0.1;
  if (team === 'T') tTeamTick(TA); else ctTeamTick(TA);
}
function tTeamTick(TA) {
  if (G.phase !== 'live' || TA.execAt) return;
  if (TA.rush) { TA.execAt = G.time; BOT_STATS.executes++; return; }
  const mem = G.agents.filter((a) => a.bot && a.alive && a.team === 'T' && a !== TA.lurker && a.bot.sync);
  if (!mem.length) return;
  const ready = mem.filter((a) => a.bot.plan === 'stage' || a.bot.plan === 'execute').length;
  const contact = mem.some((a) => a.bot.plan === 'stage' && G.time - a.bot.seenT < 1);
  if ((ready === mem.length && G.roundT <= TA.minExec) || contact || G.roundT < TA.deadline) {
    TA.execAt = G.time + (contact ? 0.2 : rand(0.4, 1.0) * (2 - D().team));
    BOT_STATS.executes++;
  }
}
function ctTeamTick(CA) {
  if (G.phase === 'live') {
    for (const s of activeSites()) {
      let n = 0;
      for (const id in CA.seen[s]) if (G.time - CA.seen[s][id] < 7) n++;
      const sound = G.intel[s] > G.time - 4;
      const level = n >= 3 || (n >= 2 && G.roundT < ROUND_TIME - 45) ? 2 : n >= 1 || sound ? 1 : 0;
      if (level > CA.level[s]) { CA.level[s] = level; assignRotation(s, level); }
    }
  } else if (G.phase === 'planted' && CA.retake && !CA.retake.go) {
    const R = CA.retake;
    const outs = G.agents.filter((a) => a.bot && a.alive && a.team === 'CT' && (a.bot.retakePhase === 'regroup' || a.bot.retakePhase === 'wait'));
    if (outs.every((a) => a.bot.retakePhase === 'wait') || G.time >= R.goAt || G.bomb.timer < R.latest) startRetake(R);
  }
}
// info on a site: mid rotates first; on heavy info the far site rotates too, keeping one anchor
function assignRotation(s, level) {
  const other = otherSite(s), k = 2 - D().team;
  const cts = G.agents.filter((a) => a.bot && a.alive && a.team === 'CT' && a.bot.plan === 'hold' && a.bot.holdSite !== s);
  const go = (b, base) => {
    if (b.bot.rotateAt > 0) return;
    b.bot.rotateAt = G.time + (base + Math.hypot(b.x - SITES[s].cx, b.z - SITES[s].cz) / 30) * k * rand(0.8, 1.2);
    b.bot.rotateTo = s; BOT_STATS.rotations++;
  };
  for (const b of cts) if (b.bot.holdSite === 'mid') go(b, level >= 2 ? 0.5 : 1.5);
  if (level >= 2) {
    const offs = cts.filter((b) => b.bot.holdSite === other).sort((p, q) => Math.hypot(p.x - SITES[other].cx, p.z - SITES[other].cz) - Math.hypot(q.x - SITES[other].cx, q.z - SITES[other].cz));
    offs.slice(1).forEach((b) => go(b, 1.2)); // offs[0] anchors
  }
}
function startRetake(R) {
  R.go = true;
  const bomb = G.bomb;
  let flashes = 0;
  for (const b of G.agents) {
    if (!b.bot || !b.alive || b.team !== 'CT' || b.bot.plan !== 'retake') continue;
    const B = b.bot;
    B.retakePhase = 'go'; setGoal(b, bomb.x, bomb.z, true);
    // utility into the site: a pop flash or two first, then smoke/fire/HE
    if (B.nadeTask || !B.utilOK) continue;
    if (b.nades.flash && flashes < 2 && planThrowAt(b, 'flash', bomb.x + rand(-2, 2), bomb.z + rand(-2, 2), 0.1 + flashes * 0.4)) { flashes++; continue; }
    const enemy = B.lastSeen && G.time - B.seenT < 8 && siteNear(B.lastSeen.x, B.lastSeen.z, 4) === R.site ? B.lastSeen : null;
    if (enemy && planThrowAt(b, b.nades.he ? 'he' : 'incgrenade', enemy.x, enemy.z, 0.6)) continue;
    const ent = SITE_ENTRIES[R.site].filter((e) => Math.hypot(e[0] - R.x, e[1] - R.z) > 4);
    if (ent.length && b.nades.smoke) { const e = pick(ent); planThrowAt(b, 'smoke', e[0], e[1], 0.5); }
  }
}

// ---------- angles: likely enemy spots, pre-aim, peeking ----------
function likelySpots(b) {
  const B = b.bot, out = [];
  const add = (x, z) => out.push({ x, z, y: navY(x, z) + 1.65 });
  if (b.team === 'T') {
    const site = B.plan === 'lurk' ? otherSite(G.tSite) : G.tSite;
    for (const h of CT_HOLDS[site] || []) add(h[0], h[1]);
    if (CT_HOLDS.mid && B.plan !== 'execute') for (const h of CT_HOLDS.mid) add(h[0], h[1]);
  } else if (B.plan === 'retake' && G.bomb.site) {
    for (const p of PLANT_SPOTS[G.bomb.site] || []) add(p[0], p[1]);
    for (const h of CT_HOLDS[G.bomb.site] || []) add(h[0], h[1]);
  } else if (B.plan === 'hold' && B.holdSite && SITE_ENTRIES[B.holdSite]) {
    for (const e of SITE_ENTRIES[B.holdSite]) add(e[0], e[1]);
  }
  return out;
}
const PEEK_PLANS = { route: 1, stage: 1, lurk: 1, hold: 1, retake: 1, postplant: 1 };
function updateThreat(b) {
  const B = b.bot, diff = D(), now = G.time;
  if (B.likelyPlan !== B.plan) { B.likely = likelySpots(b); B.likelyPlan = B.plan; }
  const ex = b.x, ey = b.y + b.eye, ez = b.z;
  let threat = null;
  if (B.trade && now < B.trade.until) threat = { x: B.trade.x, z: B.trade.z, y: navY(B.trade.x, B.trade.z) + 1.65, src: 'trade' };
  else if (B.heard && now - B.heard.t < 4 && B.heard.kind !== 'bomb' && B.heard.kind !== 'defuse') threat = { x: B.heard.x, z: B.heard.z, y: navY(B.heard.x, B.heard.z) + 1.65, src: 'heard' };
  else if (B.likely && B.likely.length) {
    const moving = Math.hypot(B.moveX, B.moveZ) > 0.1, my = moving ? Math.atan2(-B.moveX, -B.moveZ) : b.yaw;
    const cands = [];
    for (const c of B.likely) {
      const d = Math.hypot(c.x - ex, c.z - ez);
      if (d < 3 || d > 35) continue;
      if (Math.abs(angNorm(yawTo(ex, ez, c.x, c.z) - my)) > 80 * DEG) continue;
      const k = angleKey(c.x, c.z);
      if (B.cleared[k] && now - B.cleared[k] < 8) continue;
      cands.push({ c, d, k });
    }
    cands.sort((p, q) => p.d - q.d);
    for (const { c, k } of cands.slice(0, 4)) {
      if (losClear(ex, ey, ez, c.x, c.y, c.z)) { B.cleared[k] = now; continue; } // in view and empty: cleared
      threat = { x: c.x, z: c.z, y: c.y, src: 'likely' };
      break;
    }
  }
  if (threat && B.threat && angleKey(threat.x, threat.z) === angleKey(B.threat.x, B.threat.z)) { threat.preaim = B.threat.preaim; threat.peekRoll = B.threat.peekRoll; }
  else if (threat) { threat.preaim = Math.random() < diff.preaim; threat.peekRoll = Math.random() < diff.peek; }
  B.threat = threat;
  // about to open the angle? (blocked now, visible a step ahead) -> stop and peek it properly
  if (!threat || B.peek || now < B.peekCd || !threat.peekRoll || threat.src === 'trade' || !PEEK_PLANS[B.plan] || teamAI('T').rush && b.team === 'T') return;
  const L = Math.hypot(B.moveX, B.moveZ);
  if (L < 0.1 || b.planting || b.defusing || B.nadeTask) return;
  const dx = B.moveX / L, dz = B.moveZ / L, ax = ex + dx * 1.4, az = ez + dz * 1.4;
  if (losClear(ex, ey, ez, threat.x, threat.y, threat.z) || !losClear(ax, ey, az, threat.x, threat.y, threat.z)) return;
  const jig = Math.random() < 0.55 ? randInt(1, 2) : 0;
  B.peek = { phase: 'wait', t: now, end: now + 5, dx, dz, threat, jiggles: jig, tries: 0 };
  B.peekOrigin = { x: b.x, z: b.z, t: now };
  BOT_STATS.peeks++; if (jig) BOT_STATS.jiggles++;
}
function runPeek(b, dt) {
  const B = b.bot, P = B.peek, now = G.time;
  const finish = () => { B.cleared[angleKey(P.threat.x, P.threat.z)] = now; B.peek = null; B.peekCd = now + rand(2, 4); };
  if (now > P.end) { finish(); return; }
  B.wishX = 0; B.wishZ = 0; B.wantWalk = false;
  switch (P.phase) {
    case 'wait': // someone else is peeking this angle: hold and be ready to trade
      if (now >= P.t) {
        if (claimAngle(b, P.threat.x, P.threat.z, 2.5)) { P.phase = 'stop'; P.t = now + rand(0.15, 0.35); }
        else if (++P.tries > 3) finish(); else P.t = now + 0.5;
      }
      break;
    case 'stop': // counter-strafe to a stop just before the corner
      if (Math.hypot(b.vx, b.vz) > 1.5) { B.wishX = -b.vx; B.wishZ = -b.vz; }
      if (now >= P.t) { P.phase = P.jiggles > 0 ? 'out' : 'wide'; P.t = now + (P.jiggles > 0 ? rand(0.18, 0.26) : rand(0.5, 0.7)); }
      break;
    case 'out': B.wishX = P.dx; B.wishZ = P.dz; if (now >= P.t) { P.phase = 'back'; P.t = now + rand(0.18, 0.26); } break;
    case 'back':
      B.wishX = -P.dx; B.wishZ = -P.dz;
      if (now >= P.t) { P.jiggles--; P.phase = P.jiggles > 0 ? 'out' : 'wide'; P.t = now + (P.jiggles > 0 ? rand(0.18, 0.26) : rand(0.5, 0.7)); }
      break;
    case 'wide': B.wishX = P.dx; B.wishZ = P.dz; if (now >= P.t) finish(); break;
    default: finish();
  }
}
// 1vX with bad odds late in the round: keep the gun
function considerSave(b) {
  const B = b.bot;
  if (RULES.ffa || B.save || B.saveChecked || !b.inv.primary) return;
  const other = b.team === 'T' ? 'CT' : 'T';
  const mine = aliveOf(b.team).length, theirs = aliveOf(other).length;
  if (mine !== 1 || theirs < 2 || (theirs === 2 && b.hp >= 40)) return;
  let late = false;
  if (b.team === 'T') late = G.phase === 'live' && G.roundT < 40;
  else late = G.phase === 'planted' ? G.bomb.timer < 30 && !b.defusing : G.phase === 'live' && G.roundT < 25;
  if (!late) return;
  B.saveChecked = true;
  if (Math.random() > 0.55 + D().team * 0.4) return;
  startSave(b);
}
function startSave(b) {
  const B = b.bot;
  clearDetour(b);
  B.plan = 'save'; B.save = true; B.nadeTask = null; BOT_STATS.saves++;
  const s = randomWalkableIn(SPAWN_ZONES[b.team]);
  setGoal(b, s.x, s.z, true);
}

// ---------- per-frame update ----------
function updateBot(b, dt) {
  const B = b.bot, diff = D();
  B.wishX = 0; B.wishZ = 0;
  b.walking = false;
  let faceYaw = null, facePitch = 0;
  if (G.phase === 'freeze') { physicsStep(b, 0, 0, false, dt); return; }
  // ---- perception (10 Hz) ----
  B.thinkT -= dt;
  if (B.thinkT <= 0) {
    B.thinkT = 0.1;
    let best = null, bd = 1e9;
    for (const e of G.agents) {
      if (!ENEMY(b, e) || !canSee(b, e)) continue;
      const d = Math.hypot(e.x - b.x, e.z - b.z);
      if (!RULES.ffa && b.team === G.player.team) e.spottedT = G.time;
      if (b.team === 'CT' && !RULES.ffa) { const s = siteNear(e.x, e.z, 12); if (s) { G.intel[s] = G.time; teamAI('CT').seen[s][e.id] = G.time; } }
      if (d < bd) { bd = d; best = e; }
    }
    if (best) {
      if (best !== B.target || G.time - B.seenT > 1.2) {
        const moving = Math.hypot(best.vx, best.vz) > 2;
        // pre-aimed at the right spot = faster first shot
        const preaimed = B.threat && B.threat.preaim && Math.hypot(B.threat.x - best.x, B.threat.z - best.z) < 3;
        B.reactT = diff.react * rand(0.75, 1.3) * (moving ? 1.15 : 1) * (b.blindT > 0 ? 2 : 1) * (preaimed ? 0.85 : 1) * (B.save ? 1.3 : 1);
        const e = 1 + bd / 22;
        B.errY = gauss() * diff.aimErr * DEG * e; B.errP = gauss() * diff.aimErr * 0.6 * DEG * e;
        if (preaimed) { B.errY *= 0.7; B.errP *= 0.7; }
        B.aimZone = Math.random() < diff.hs ? 'head' : 'chest';
        B.cstrafe = Math.random() < diff.cstrafe;
        B.burstLeft = 0;
        // teammates of the player also say it out loud in team chat (throttled in comms.js)
        if (best !== B.target) botCallout(b, 'spot', best);
        // share the call with nearby teammates
        if (!RULES.ffa) for (const m of G.agents) if (m.bot && m !== b && m.alive && m.team === b.team && Math.hypot(m.x - b.x, m.z - b.z) < 35 && !m.bot.target) m.bot.heard = { x: best.x, z: best.z, t: G.time, kind: 'callout' };
      }
      B.target = best; B.seenT = G.time; B.lastSeen = { x: best.x, y: best.y, z: best.z };
      B.peek = null;
    } else {
      if (B.target && (!B.target.alive || G.time - B.seenT > 0.4)) {
        if (B.target.alive) B.heard = { x: B.lastSeen.x, z: B.lastSeen.z, t: G.time, kind: 'lost' };
        // enemy just broke line of sight: sometimes follow up with a grenade
        if (B.target.alive && !B.save && nadeCount(b) && Math.random() < 0.3 * (0.5 + diff.util * 0.5) && !B.nadeTask) {
          const k = ['he', 'flash', b.team === 'T' ? 'molotov' : 'incgrenade'].find((q) => b.nades[q]);
          if (k) { const sol = solveThrow(b, B.lastSeen.x, B.lastSeen.y, B.lastSeen.z); if (sol) B.nadeTask = { key: k, yaw: sol.yaw, pitch: sol.pitch, t: G.time + 0.3, equipped: false }; }
        }
        B.target = null;
      }
      if (!B.target) updateThreat(b);
    }
    considerSave(b);
  }
  const w = curWeapon(b);
  const fighting = B.target && B.target.alive && G.time - B.seenT < 0.25;
  // ---- combat ----
  if (fighting) {
    const t = B.target;
    if (B.nadeTask) { B.nadeTask = null; }
    if (b.slot === 'grenade' || b.slot === 'c4' || b.slot === 'knife' && (b.inv.primary || b.inv.secondary)) equip(b, bestSlot(b));
    if (b.planting) b.planting = 0;
    const bomb = G.bomb;
    if (b.defusing && bomb.timer - (bomb.defuseTotal - bomb.defuseT) > 1.5) { b.defusing = false; }
    if (!b.defusing) {
      const am = b.ammo[b.weaponKey];
      if (am && am.mag === 0) { if (am.res > 0 && Math.hypot(t.x - b.x, t.z - b.z) > 10) startReload(b); else if (b.slot === 'primary' && b.inv.secondary) equip(b, 'secondary'); }
      const p = aimPoint(t, B.aimZone), ex = b.x, ey = b.y + b.eye, ez = b.z;
      const dist = Math.hypot(p.x - ex, p.z - ez);
      // lead a moving target slightly, settle the aim error over time
      const lead = clamp(dist / 120, 0, 0.12);
      const tx = p.x + t.vx * lead, tz = p.z + t.vz * lead;
      B.errY *= Math.exp(-dt * 3.2); B.errP *= Math.exp(-dt * 3.2);
      const tremble = diff.aimErr * 0.12 * DEG;
      faceYaw = yawTo(ex, ez, tx, tz) + B.errY + gauss() * tremble * 0.3;
      facePitch = Math.atan2(p.y - ey, dist) + B.errP;
      botTurn(b, faceYaw, facePitch, dt, diff.turn);
      faceYaw = null; // already turned
      B.reactT -= dt;
      const sniper = w.cat === 'sniper', close = dist < 7;
      if (sniper && !b.zoom && b.drawT <= 0 && dist > 5 && G.time >= b.nextAttack - 0.2) { b.zoom = 1; }
      // counter-strafe: stop before shooting with rifles/snipers unless very close
      const spd = Math.hypot(b.vx, b.vz), accurateSpeed = w.speed * UNIT * 0.34;
      const wantShoot = B.reactT <= 0;
      if (!close && B.cstrafe && (w.cat === 'rifle' || sniper || w.cat === 'pistol' && dist > 12)) {
        if (!wantShoot || spd > accurateSpeed || B.burstLeft <= 0 && b.recoilIdx > 0.5) {
          // between bursts better bots strafe; otherwise hold still
          if (G.difficulty >= 2 && B.burstLeft <= 0 && b.recoilIdx > 0.5) {
            B.strafeT -= dt; if (B.strafeT <= 0) { B.strafe = -B.strafe; B.strafeT = rand(0.3, 0.6); }
            const r = dirFromAngles(b.yaw + Math.PI / 2, 0); B.wishX = r.x * B.strafe; B.wishZ = r.z * B.strafe;
          }
        }
      } else {
        B.strafeT -= dt; if (B.strafeT <= 0) { B.strafe = -B.strafe; B.strafeT = rand(0.25, 0.55); }
        const r = dirFromAngles(b.yaw + Math.PI / 2, 0); B.wishX = r.x * B.strafe; B.wishZ = r.z * B.strafe;
        if (w.cat === 'knife') { const f = dirFromAngles(b.yaw, 0); B.wishX = f.x; B.wishZ = f.z; }
      }
      // saving: back off instead of taking the fight, unless shot at or point blank
      const avoid = B.save && dist > 14 && !(b.hurtT > G.time);
      // peeked and losing it (low hp / empty mag): fall back behind the corner we came from
      const O = B.peekOrigin;
      const fallBack = O && G.time - O.t < 6 && (b.hp < 40 || am && am.mag === 0) && dist > 6 && Math.hypot(b.x - O.x, b.z - O.z) > 0.4;
      if (avoid) { const ax = b.x - t.x, az = b.z - t.z, L = Math.hypot(ax, az) || 1; B.wishX = ax / L; B.wishZ = az / L; }
      else if (fallBack) { const ox = O.x - b.x, oz = O.z - b.z, L = Math.hypot(ox, oz) || 1; B.wishX = ox / L; B.wishZ = oz / L; }
      B.wantDuck = !close && dist > 18 && w.auto && b.recoilIdx > 3 && G.difficulty >= 1 && !avoid && !fallBack;
      const yawErr = Math.abs(angNorm(yawTo(ex, ez, tx, tz) + B.errY - b.yaw)), pitchErr = Math.abs(Math.atan2(p.y - ey, dist) + B.errP - b.pitch);
      const tol = Math.atan(0.22 / Math.max(1, dist)) + 0.6 * DEG;
      const stillEnough = close || !B.cstrafe || fallBack || spd <= accurateSpeed * 1.25 || w.cat === 'smg' || w.cat === 'heavy';
      if (!avoid && wantShoot && yawErr < tol + 1 * DEG && pitchErr < tol + 1 * DEG && stillEnough && canAttack(b) && (!sniper || b.zoom || dist < 8)) {
        if (B.burstLeft <= 0) {
          if (!w.auto || b.recoilIdx < 0.6 || close) B.burstLeft = w.auto ? (dist > 25 ? randInt(1, 3) : dist > 12 ? randInt(3, diff.burst) : 30) : 1;
        }
        if (B.burstLeft > 0) {
          B.recoilComp = diff.spray;
          if (w.cat === 'knife') { if (dist < 1.6) knifeAttack(b, false); }
          else fireWeapon(b);
          B.burstLeft--;
          if (!w.auto) b.nextAttack = Math.max(b.nextAttack, G.time + rand(0.12, 0.28) * (dist > 15 ? 1.6 : 1));
        }
      }
    }
  } else {
    if (b.zoom && G.time - B.seenT > 2) b.zoom = 0;
    B.wantDuck = false;
    objectives(b, dt);
    if (B.peek) runPeek(b, dt);
    // look: grenade lineup, the angle being peeked, a trade spot, a noise, a pre-aimed angle, the hold angle, or where we're walking
    const heard = B.heard && G.time - B.heard.t < 3.5 ? B.heard : null;
    const am = b.ammo[b.weaponKey];
    if (am && am.mag < WEAPONS[b.weaponKey].mag * 0.45 && am.res > 0 && b.reloadT <= 0 && !B.peek && (!heard || G.time - heard.t > 1.5)) startReload(b);
    if (b.slot === 'secondary' && b.inv.primary && !B.nadeTask) equip(b, 'primary');
    const ey = b.y + b.eye;
    const aimAt = (p) => { faceYaw = yawTo(b.x, b.z, p.x, p.z); facePitch = Math.atan2(p.y - ey, Math.max(1, Math.hypot(p.x - b.x, p.z - b.z))); };
    let turn = 300;
    if (B.nadeTask && runNadeTask(b, dt)) { /* turning to throw */ }
    else if (b.planting || b.defusing) { /* keep looking down */ }
    else if (B.peek) { aimAt(B.peek.threat); turn = Math.max(300, diff.turn * 0.7); }
    else if (B.trade && G.time < B.trade.until) { aimAt({ x: B.trade.x, z: B.trade.z, y: navY(B.trade.x, B.trade.z) + 1.65 }); turn = Math.max(300, diff.turn * 0.7); }
    else if (heard) { faceYaw = yawTo(b.x, b.z, heard.x, heard.z); facePitch = 0; }
    else if (B.threat && B.threat.preaim && (B.wishX || B.wishZ)) aimAt(B.threat);
    else if (B.look && (!B.goal || Math.hypot(b.x - B.goal.x, b.z - B.goal.z) < 4)) { faceYaw = yawTo(b.x, b.z, B.look.x, B.look.z) + Math.sin(G.time * 0.7 + b.id) * 0.25; facePitch = 0; }
    else if (B.wishX || B.wishZ) { faceYaw = Math.atan2(-B.wishX, -B.wishZ); facePitch = -0.15 * (1 - diff.preaim); }
    if (faceYaw !== null) botTurn(b, faceYaw, facePitch, dt, turn);
  }
  // escape fire
  if (inFire(b.x, b.z)) { const f = dirFromAngles(b.yaw + Math.PI, 0); B.wishX = f.x; B.wishZ = f.z; }
  if (b.planting || b.defusing) { B.wishX = 0; B.wishZ = 0; }
  b.duck = B.wantDuck;
  b.walking = B.wantWalk && !fighting;
  B.moveX = B.wishX; B.moveZ = B.wishZ;
  // stuck detection
  const moved = Math.hypot(b.x - B.lastX, b.z - B.lastZ);
  B.lastX = b.x; B.lastZ = b.z;
  let jump = false;
  B.jumpCd -= dt;
  if ((B.wishX || B.wishZ) && moved < 0.3 * dt) {
    B.stuckT += dt;
    if (B.stuckT > 0.6) { B.path = null; if (B.peek) B.peek = null; if (B.jumpCd <= 0 && b.onGround) { jump = true; B.jumpCd = 1.2; } B.stuckT = 0; }
  } else B.stuckT = 0;
  const L = Math.hypot(B.wishX, B.wishZ);
  physicsStep(b, L ? B.wishX / L : 0, L ? B.wishZ / L : 0, jump, dt);
  footsteps(b, dt);
}

// T: can this bot start its execute now?
function teamExecNow(b) {
  const TA = teamAI('T');
  if (!b.bot.sync) return G.roundT < b.bot.stageUntil;
  return (TA.execAt && G.time >= TA.execAt) || G.roundT < b.bot.stageUntil;
}
function objectives(b, dt) {
  const B = b.bot, bomb = G.bomb;
  if (!RULES.ffa) teamTick(b.team);
  // dropped bomb: closest T goes to get it
  if (b.team === 'T' && bomb.state === 'dropped' && G.phase === 'live' && !B.save) {
    let nearest = null, nd = 1e9;
    for (const o of G.agents) if (o.alive && o.team === 'T' && o.bot && !o.bot.save) { const d = Math.hypot(o.x - bomb.x, o.z - bomb.z); if (d < nd) { nd = d; nearest = o; } }
    const pl = G.player, playerCloser = pl.alive && pl.team === 'T' && Math.hypot(pl.x - bomb.x, pl.z - bomb.z) < nd - 3;
    if (nearest === b && !playerCloser) { setGoal(b, bomb.x, bomb.z); navigate(b, dt); return; }
  }
  // trade: push the killer's spot (or cover it), then go back to the plan
  if (B.trade) {
    const T = B.trade;
    if (G.time > T.until || !T.killer.alive || B.save) {
      if (!T.killer.alive && T.role === 'push') BOT_STATS.tradeKills++;
      B.trade = null; endDetour(b);
    } else if (T.role === 'push') { B.wantWalk = false; navigate(b, dt); return; }
    else { B.wishX = 0; B.wishZ = 0; return; } // cover: hold still on the angle
  }
  // the clock is running out: everyone goes for the site
  if (b.team === 'T' && G.phase === 'live' && G.roundT < 35 && (B.plan === 'route' || B.plan === 'stage' || B.plan === 'lurk')) { executeGoal(b); planUtility(b, UTILITY[G.tSite]); }
  switch (B.plan) {
    case 'route': {
      if (navigate(b, dt)) {
        B.routeI++;
        if (B.routeI < B.route.length) setGoal(b, B.route[B.routeI][0], B.route[B.routeI][1], true);
        else if (teamExecNow(b)) { planUtility(b, UTILITY[G.tSite]); executeGoal(b); }
        else { B.plan = 'stage'; const s = SITES[G.tSite]; B.look = { x: s.cx, z: s.cz }; }
      }
      B.wantWalk = false;
      break;
    }
    case 'stage':
      navigate(b, dt);
      B.wantWalk = true;
      if (teamExecNow(b)) { planUtility(b, UTILITY[G.tSite]); executeGoal(b); }
      break;
    case 'lurk': {
      B.wantWalk = true; // quiet
      if (B.routeI < B.route.length) {
        if (navigate(b, dt)) {
          B.routeI++;
          if (B.routeI < B.route.length) setGoal(b, B.route[B.routeI][0], B.route[B.routeI][1], true);
          else { const s = SITES[otherSite(G.tSite)]; B.look = { x: s.cx, z: s.cz }; }
        }
      } else navigate(b, dt);
      const TA = teamAI('T');
      if (!B.lurkGo && TA.execAt && G.time > TA.execAt) B.lurkGo = G.time + rand(3, 8);
      if (B.lurkGo && G.time > B.lurkGo) executeGoal(b); // rotate late to the team's site
      break;
    }
    case 'execute': {
      B.wantWalk = false;
      const arrived = navigate(b, dt);
      if (b.hasC4 && siteAt(b.x, b.z) === G.tSite && G.phase === 'live' && (arrived || Math.hypot(b.x - B.goal.x, b.z - B.goal.z) < 2.5)) {
        if (b.slot !== 'c4') equip(b, 'c4');
        B.wishX = 0; B.wishZ = 0;
        if (b.drawT <= 0 && b.onGround) {
          b.planting += dt;
          if (Math.random() < dt * 5) SFX.play('plantkey', { x: b.x, y: b.y + 0.5, z: b.z });
          b.pitch = lerp(b.pitch, -0.9, dt * 4);
          if (b.planting >= PLANT_TIME) plantBomb(b);
        }
      } else if (b.hasC4 && plantSiteAt(b.x, b.z) && plantSiteAt(b.x, b.z) !== G.tSite && G.phase === 'live') { G.tSite = plantSiteAt(b.x, b.z); executeGoal(b); } // only switch to a site we may plant on
      break;
    }
    case 'hold': {
      const arrived = navigate(b, dt);
      if (arrived) B.rotating = false;
      B.wantWalk = !B.rotating; // run when rotating, walk (silent) when setting up
      if (arrived && B.holdDuck && !(B.heard && G.time - B.heard.t < 2)) B.wantDuck = true;
      if (B.rotateAt > 0 && G.time > B.rotateAt) { const to = B.rotateTo; B.rotateAt = 0; B.rotateTo = null; if (to) { pickHold(b, to); B.rotating = true; } }
      const hot = activeSites().find((s) => G.intel[s] > G.time - 4) || null; // Wingman: only A
      if (hot && hot === B.holdSite && nadeCount(b) && !B.usedUtil) planUtility(b, UTILITY['CT_' + hot]);
      break;
    }
    case 'postplant': {
      navigate(b, dt);
      B.wantWalk = true;
      if (bomb.defuser && Math.hypot(b.x - bomb.x, b.z - bomb.z) < 30) { setGoal(b, bomb.x, bomb.z); B.wantWalk = false; }
      break;
    }
    case 'retake': {
      B.wantWalk = false;
      if (B.retakePhase === 'regroup') {
        const R = teamAI('CT').retake;
        if (navigate(b, dt) || (R && Math.hypot(b.x - R.x, b.z - R.z) < 2.5)) { B.retakePhase = 'wait'; B.goal = null; }
        break;
      }
      if (B.retakePhase === 'wait' || B.retakePhase === 'in') { B.wantWalk = true; B.look = { x: bomb.x, z: bomb.z }; break; }
      if (!B.goal) setGoal(b, bomb.x, bomb.z, true);
      // not enough time to defuse: save the gun
      const need = (b.defuser ? KIT_DEFUSE_TIME : DEFUSE_TIME) + Math.hypot(b.x - bomb.x, b.z - bomb.z) / 5;
      if (bomb.timer < need - 0.5 && !b.defusing) { startSave(b); break; }
      const d = Math.hypot(b.x - bomb.x, b.z - bomb.z);
      if (d > 1.1) navigate(b, dt);
      if (d < 1.4 && bomb.state === 'planted') {
        const recentEnemy = G.agents.some((m) => m.bot && m.alive && m.team === b.team && G.time - m.bot.seenT < 1.5);
        if (!recentEnemy || bomb.timer < need + 1) {
          if (startDefuse(b)) { B.wishX = 0; B.wishZ = 0; b.pitch = lerp(b.pitch, -0.8, dt * 4); b.yaw = yawTo(b.x, b.z, bomb.x, bomb.z); makeSound(b, bomb.x, bomb.z, 16, 'defuse'); }
        }
      }
      break;
    }
    case 'save': navigate(b, dt); break;
    case 'roam': roam(b, dt); break;
    case 'support': {
      // answering a "need backup" call: walk to the player, then cover them until the call expires
      const pl = G.player;
      if (!pl.alive || G.time > B.supportUntil) { endSupport(b); break; }
      const d = Math.hypot(b.x - pl.x, b.z - pl.z);
      if (d > 3.5) { if (G.time > (B.supportRepath || 0)) { setGoal(b, pl.x, pl.z, true); B.supportRepath = G.time + 1.5; } navigate(b, dt); }
      const f = dirFromAngles(pl.yaw, 0); B.look = { x: pl.x + f.x * 10, z: pl.z + f.z * 10 }; // watch where the player watches
      B.wantWalk = d < 8;
      break;
    }
    default: break;
  }
  // investigate a recent noise when there is nothing better to do
  const heard = B.heard && G.time - B.heard.t < 3 ? B.heard : null;
  if (heard && (B.plan === 'hold' || B.plan === 'postplant') && !B.rotateTo && heard.kind === 'lost' && Math.random() < dt * 0.15) { setGoal(b, heard.x, heard.z); }
}

// ---------- deathmatch ----------
function botDMSpawn(b) {
  Object.assign(b.bot, { plan: 'roam', goal: null, path: null, pathGoalKey: '', target: null, heard: null, nadeTask: null, look: null, roamT: 0, noiseCd: 0, wantWalk: false, wantDuck: false });
}
// Roam: walk to a fresh noise (gunfire carries far, which pulls bots toward fights), else
// head for the nearest enemy now and then, else a random point on the map.
function roam(b, dt) {
  const B = b.bot;
  B.wantWalk = false;
  const heard = B.heard && G.time - B.heard.t < 2 ? B.heard : null;
  // re-goal on noise at most every couple of seconds: every shot is a noise and pathing isn't free
  if (heard && G.time > B.noiseCd && Math.hypot(heard.x - b.x, heard.z - b.z) < 40) {
    B.noiseCd = G.time + rand(2, 3.5); B.roamT = rand(5, 9);
    setGoal(b, heard.x + rand(-2, 2), heard.z + rand(-2, 2), true);
  }
  B.roamT -= dt;
  const arrived = navigate(b, dt);
  if (arrived || B.roamT <= 0 || !B.goal) {
    B.roamT = rand(6, 12);
    let near = null, nd = 1e9;
    for (const e of G.agents) if (ENEMY(b, e)) { const d = Math.hypot(e.x - b.x, e.z - b.z); if (d < nd) { nd = d; near = e; } }
    if (near && Math.random() < 0.45) setGoal(b, near.x + rand(-3, 3), near.z + rand(-3, 3), true);
    else { const p = randomWalkableIn({ x0: 2, x1: MAP_W - 2, z0: 2, z1: MAP_D - 2 }); setGoal(b, p.x, p.z, true); }
  }
}
// ---------- debug: window.__botStats() in the console ----------
window.__botStats = function (quiet) {
  const rows = G.agents.filter((a) => a.bot).map((a) => {
    const B = a.bot;
    return {
      name: a.name, team: a.team, alive: a.alive, hp: a.hp, money: a.money, gun: a.inv.primary || a.inv.secondary, plan: B.plan,
      site: B.holdSite || (a.team === 'T' ? G.tSite : ''), target: B.target ? B.target.name : '', trade: B.trade ? B.trade.role : '',
      peek: B.peek ? B.peek.phase : '', threat: B.threat ? B.threat.src : '', save: B.save, sync: B.sync, retake: B.retakePhase || '',
      rotate: B.rotateTo || '', lurker: TEAM_AI.T && TEAM_AI.T.lurker === a,
    };
  });
  const T = TEAM_AI.T || {}, CT = TEAM_AI.CT || {};
  const teams = {
    T: { buy: T.buy, rush: T.rush, split: T.split, lurker: T.lurker ? T.lurker.name : null, execAt: T.execAt, site: G.tSite },
    CT: { buy: CT.buy, level: CT.level, retake: CT.retake ? { site: CT.retake.site, regroup: CT.retake.regroup, go: CT.retake.go } : null },
  };
  if (!quiet) { console.table(rows); console.log('teams', teams, 'stats', BOT_STATS); }
  return { rows, teams, stats: BOT_STATS };
};
