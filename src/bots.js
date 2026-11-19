'use strict';
/* =====================================================================
   BOTS: perception -> decisions -> movement + aim.
   ===================================================================== */
function makeBot(team, name) {
  const a = makeAgent(team, name, false);
  a.bot = {
    plan: 'idle', goal: null, path: null, pathI: 0, pathGoalKey: '', repathT: 0, look: null, holdSite: null,
    target: null, reactT: 0, seenT: -99, lastSeen: null, errY: 0, errP: 0, aimZone: 'chest', burstLeft: 0, recoilComp: 0,
    heard: null, nadeTask: null, stuckT: 0, lastX: 0, lastZ: 0, strafe: 1, strafeT: 0, thinkT: Math.random() * 0.1,
    stageUntil: 0, route: null, routeI: 0, wantWalk: false, wantDuck: false, jumpCd: 0, usedUtil: false, rotateAt: 0, save: false,
  };
  return a;
}
// a target worth engaging: alive, hostile (anyone in deathmatch) and not under spawn protection
const ENEMY = (b, e) => e.alive && hostile(b, e) && !(RULES.ffa && e.protectT > G.time);
function canSee(b, e) {
  if (b.blindT > 0.5) return false;
  const ex = b.x, ey = b.y + b.eye, ez = b.z;
  const dx = e.x - ex, dz = e.z - ez, d = Math.hypot(dx, dz);
  if (d > 60) return false;
  const yawTo_ = yawTo(ex, ez, e.x, e.z), off = Math.abs(angNorm(yawTo_ - b.yaw));
  if (d > 2.5 && off > 75 * DEG && !(b.hurtT > G.time)) return false;
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
// follow the current path; returns true when arrived
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
function pickHold(b, where) {
  const spot = pick(CT_HOLDS[where]);
  b.bot.holdSite = where; b.bot.plan = 'hold'; b.bot.look = { x: spot[2], z: spot[3] };
  setGoal(b, spot[0] + rand(-0.4, 0.4), spot[1] + rand(-0.4, 0.4), true);
}
function botsNewRound() {
  G.tSite = pick(activeSites()); // Wingman: always A
  const ts = G.agents.filter((a) => a.bot && a.team === 'T'), cts = G.agents.filter((a) => a.bot && a.team === 'CT');
  const routes = T_ROUTES[G.tSite];
  const stage = ROUND_TIME - rand(22, 42);
  ts.forEach((b, i) => {
    const B = b.bot;
    Object.assign(B, { target: null, heard: null, nadeTask: null, usedUtil: false, save: false, look: null, rotateAt: 0 });
    B.plan = 'route'; B.route = routes[i % routes.length]; B.routeI = 0; B.stageUntil = stage;
    setGoal(b, B.route[0][0], B.route[0][1], true);
  });
  let order;
  if (RULES.sites && RULES.sites.length === 1) order = cts.map(() => RULES.sites[0]); // single-site modes: everyone holds it
  else { order = shuffle(['A', 'A', 'B', 'B']).slice(0, cts.length); order.splice(randInt(0, Math.max(0, cts.length - 1)), 0, 'mid'); }
  cts.forEach((b, i) => {
    Object.assign(b.bot, { target: null, heard: null, nadeTask: null, usedUtil: false, save: false, rotateAt: 0 });
    pickHold(b, order[i] || pick(['A', 'B']));
  });
}
function botGotBomb(b) { if (G.phase !== 'planted' && b.bot.plan !== 'route') { b.bot.plan = 'execute'; executeGoal(b); } }
function executeGoal(b) {
  const B = b.bot;
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
    const e = SITE_ENTRIES[bomb.site].slice().sort((p, q) => Math.hypot(p[0] - b.x, p[1] - b.z) - Math.hypot(q[0] - b.x, q[1] - b.z))[0];
    B.retakeVia = { x: e[0], z: e[1] };
    setGoal(b, e[0], e[1], true);
  }
}
function botHear(b, x, z, kind, d, src) {
  const B = b.bot;
  if (B.target && G.time - B.seenT < 1) return;
  B.heard = { x, z, t: G.time, kind };
  if (src && b.team === 'CT' && !RULES.ffa) { const s = siteAt(x, z) || (calloutAt(x, z).match(/Quay|Gantry|Yard/) ? 'A' : calloutAt(x, z).match(/Alley|B Doors|Link/) ? 'B' : null); if (s) G.intel[s] = G.time; }
}
function botOnHurt(b, att) {
  b.hurtT = G.time + 1.5;
  if (att && att.alive && !b.bot.target) { b.bot.heard = { x: att.x, z: att.z, t: G.time, kind: 'hurt' }; }
}
function botFlashed(b) { b.bot.target = null; b.bot.reactT = 0.3; b.bot.wantDuck = Math.random() < 0.4; }
function botTeammateDied(b, v, k) {
  if (k && k.alive && Math.hypot(b.x - v.x, b.z - v.z) < 40) b.bot.heard = { x: k.x + rand(-2, 2), z: k.z + rand(-2, 2), t: G.time, kind: 'callout' };
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
function planUtility(b, list) {
  const B = b.bot;
  if (B.usedUtil || B.nadeTask) return;
  for (const [type, , , tx, tz] of shuffle(list.slice())) {
    const key = type === 'molotov' && b.team === 'CT' ? 'incgrenade' : type === 'incgrenade' && b.team === 'T' ? 'molotov' : type;
    if (!b.nades[key]) continue;
    const d = Math.hypot(tx - b.x, tz - b.z);
    if (d < 6 || d > 27) continue;
    const ty = WORLD.nav.h[nearestWalkable(tx, tz)] || 0;
    const sol = solveThrow(b, tx, ty, tz);
    if (!sol) continue;
    B.nadeTask = { key, yaw: sol.yaw, pitch: sol.pitch, t: G.time + rand(0.2, 0.8), equipped: false };
    B.usedUtil = true;
    return;
  }
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
    if (task.key === 'flash') b.flashImmuneT = G.time + 2.2;
    throwNade(b, 1);
    b.pitch += bias;
    B.nadeTask = null;
  }
  return true;
}

// ---------- buying ----------
function botBuy(b) {
  const team = G.agents.filter((a) => a.team === b.team);
  const avg = team.reduce((s, a) => s + a.money, 0) / team.length;
  const buy = (k) => buyItem(b, k);
  const rifle = b.team === 'T' ? 'ak47' : (Math.random() < 0.5 ? 'm4a4' : 'm4a1s');
  const cheap = b.team === 'T' ? 'galil' : 'famas';
  const smg = b.team === 'T' ? pick(['mac10', 'ump45', 'mp7']) : pick(['mp9', 'ump45', 'mp7']);
  if (G.pistolRound) {
    const r = Math.random();
    if (r < 0.5) buy('vest'); else if (r < 0.75) buy('p250'); else { buy(b.team === 'T' ? 'tec9' : 'fiveseven'); }
    if (Math.random() < 0.5) buy('flash');
    if (b.team === 'CT' && Math.random() < 0.3) buy('defuser');
  } else if (!b.inv.primary) {
    const full = avg >= 3900 || b.money >= 4300, force = !full && (G.lossCount[b.team] >= 3 || avg >= 2600) && b.money >= 2000;
    if (full) {
      const awpTaken = team.some((a) => a !== b && a.inv.primary === 'awp');
      if (!awpTaken && b.money >= 6000 && Math.random() < 0.3) buy('awp'); else if (!buy(rifle)) buy(cheap);
    } else if (force) { if (Math.random() < 0.5 ? !buy(cheap) : !buy(smg)) buy(smg); }
    else if (b.money >= 900 && Math.random() < 0.35) buy(Math.random() < 0.5 ? 'deagle' : 'p250');
  }
  if (b.inv.primary || b.money > 2000) { if (!buy('vesthelm')) buy('vest'); }
  if (b.team === 'CT' && b.inv.primary && Math.random() < 0.7) buy('defuser');
  if (b.inv.primary) {
    const fireNade = b.team === 'T' ? 'molotov' : 'incgrenade';
    for (const k of shuffle(['smoke', 'flash', 'flash', fireNade, 'he'])) if (b.money >= WEAPONS[k].price + 100 && Math.random() < 0.75) buy(k);
  }
  equip(b, bestSlot(b), true); b.drawT = 0;
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
      if (!RULES.ffa && b.team === G.player.team) e.spottedT = G.time; // teammates spot for your radar
      if (b.team === 'CT' && !RULES.ffa) { const s = siteAt(e.x, e.z); if (s) G.intel[s] = G.time; }
      if (d < bd) { bd = d; best = e; }
    }
    if (best) {
      if (best !== B.target || G.time - B.seenT > 1.2) {
        const moving = Math.hypot(best.vx, best.vz) > 2;
        B.reactT = diff.react * rand(0.75, 1.3) * (moving ? 1.15 : 1) * (b.blindT > 0 ? 2 : 1);
        const e = 1 + bd / 22;
        B.errY = gauss() * diff.aimErr * DEG * e; B.errP = gauss() * diff.aimErr * 0.6 * DEG * e;
        B.aimZone = Math.random() < diff.hs ? 'head' : 'chest';
        B.burstLeft = 0;
        // share the call with nearby teammates
        if (!RULES.ffa) for (const m of G.agents) if (m.bot && m !== b && m.alive && m.team === b.team && Math.hypot(m.x - b.x, m.z - b.z) < 35 && !m.bot.target) m.bot.heard = { x: best.x, z: best.z, t: G.time, kind: 'callout' };
      }
      B.target = best; B.seenT = G.time; B.lastSeen = { x: best.x, y: best.y, z: best.z };
    } else if (B.target && (!B.target.alive || G.time - B.seenT > 0.4)) {
      if (B.target.alive) B.heard = { x: B.lastSeen.x, z: B.lastSeen.z, t: G.time, kind: 'lost' };
      // enemy just broke line of sight: sometimes follow up with a grenade
      if (B.target.alive && nadeCount(b) && Math.random() < 0.3 && !B.nadeTask) {
        const k = ['he', 'flash', b.team === 'T' ? 'molotov' : 'incgrenade'].find((q) => b.nades[q]);
        if (k) { const sol = solveThrow(b, B.lastSeen.x, B.lastSeen.y, B.lastSeen.z); if (sol) B.nadeTask = { key: k, yaw: sol.yaw, pitch: sol.pitch, t: G.time + 0.3, equipped: false }; }
      }
      B.target = null;
    }
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
      if (!close && (w.cat === 'rifle' || sniper || w.cat === 'pistol' && dist > 12)) {
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
      B.wantDuck = !close && dist > 18 && w.auto && b.recoilIdx > 3 && G.difficulty >= 1;
      const yawErr = Math.abs(angNorm(yawTo(ex, ez, tx, tz) + B.errY - b.yaw)), pitchErr = Math.abs(Math.atan2(p.y - ey, dist) + B.errP - b.pitch);
      const tol = Math.atan(0.22 / Math.max(1, dist)) + 0.6 * DEG;
      const stillEnough = close || spd <= accurateSpeed * 1.25 || w.cat === 'smg' || w.cat === 'heavy';
      if (wantShoot && yawErr < tol + 1 * DEG && pitchErr < tol + 1 * DEG && stillEnough && canAttack(b) && (!sniper || b.zoom || dist < 8)) {
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
    // look: last-known enemy position, a noise, the hold angle, or where we're walking
    const heard = B.heard && G.time - B.heard.t < 3.5 ? B.heard : null;
    const am = b.ammo[b.weaponKey];
    if (am && am.mag < WEAPONS[b.weaponKey].mag * 0.45 && am.res > 0 && b.reloadT <= 0 && (!heard || G.time - heard.t > 1.5)) startReload(b);
    if (b.slot === 'secondary' && b.inv.primary && !B.nadeTask) equip(b, 'primary');
    if (B.nadeTask && runNadeTask(b, dt)) { /* turning to throw */ }
    else if (b.planting || b.defusing) { /* keep looking down */ }
    else if (heard) { faceYaw = yawTo(b.x, b.z, heard.x, heard.z); facePitch = 0; }
    else if (B.look && Math.hypot(b.x - B.goal.x, b.z - B.goal.z) < 4) { faceYaw = yawTo(b.x, b.z, B.look.x, B.look.z) + Math.sin(G.time * 0.7 + b.id) * 0.25; facePitch = 0; }
    else if (B.wishX || B.wishZ) { faceYaw = Math.atan2(-B.wishX, -B.wishZ); facePitch = 0; }
    if (faceYaw !== null) botTurn(b, faceYaw, facePitch, dt, 300);
  }
  // escape fire
  if (inFire(b.x, b.z)) { const f = dirFromAngles(b.yaw + Math.PI, 0); B.wishX = f.x; B.wishZ = f.z; }
  if (b.planting || b.defusing) { B.wishX = 0; B.wishZ = 0; }
  b.duck = B.wantDuck;
  b.walking = B.wantWalk && !fighting;
  // stuck detection
  const moved = Math.hypot(b.x - B.lastX, b.z - B.lastZ);
  B.lastX = b.x; B.lastZ = b.z;
  let jump = false;
  B.jumpCd -= dt;
  if ((B.wishX || B.wishZ) && moved < 0.3 * dt) {
    B.stuckT += dt;
    if (B.stuckT > 0.6) { B.path = null; if (B.jumpCd <= 0 && b.onGround) { jump = true; B.jumpCd = 1.2; } B.stuckT = 0; }
  } else B.stuckT = 0;
  const L = Math.hypot(B.wishX, B.wishZ);
  physicsStep(b, L ? B.wishX / L : 0, L ? B.wishZ / L : 0, jump, dt);
  footsteps(b, dt);
}

function objectives(b, dt) {
  const B = b.bot, bomb = G.bomb;
  // dropped bomb: closest T goes to get it
  if (b.team === 'T' && bomb.state === 'dropped' && G.phase === 'live') {
    let nearest = null, nd = 1e9;
    for (const o of G.agents) if (o.alive && o.team === 'T' && o.bot) { const d = Math.hypot(o.x - bomb.x, o.z - bomb.z); if (d < nd) { nd = d; nearest = o; } }
    const pl = G.player, playerCloser = pl.alive && pl.team === 'T' && Math.hypot(pl.x - bomb.x, pl.z - bomb.z) < nd - 3;
    if (nearest === b && !playerCloser) { setGoal(b, bomb.x, bomb.z); navigate(b, dt); return; }
  }
  // the clock is running out: everyone goes for the site
  if (b.team === 'T' && G.phase === 'live' && G.roundT < 35 && (B.plan === 'route' || B.plan === 'stage')) { executeGoal(b); planUtility(b, UTILITY[G.tSite]); }
  switch (B.plan) {
    case 'route': {
      if (navigate(b, dt)) {
        B.routeI++;
        if (B.routeI < B.route.length) setGoal(b, B.route[B.routeI][0], B.route[B.routeI][1], true);
        else { B.plan = 'stage'; const s = SITES[G.tSite]; B.look = { x: s.cx, z: s.cz }; }
      }
      B.wantWalk = false;
      break;
    }
    case 'stage':
      navigate(b, dt);
      B.wantWalk = true;
      if (G.roundT < B.stageUntil) { planUtility(b, UTILITY[G.tSite]); executeGoal(b); }
      break;
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
      B.wantWalk = true;
      navigate(b, dt);
      const other = B.holdSite === 'A' ? 'B' : B.holdSite === 'B' ? 'A' : null;
      const hot = activeSites().find((s) => G.intel[s] > G.time - 4) || null; // Wingman: never rotate to B
      if (hot && hot !== B.holdSite && !B.rotateAt && (B.holdSite === 'mid' || Math.random() < 0.5)) B.rotateAt = G.time + rand(1.5, 5);
      if (B.rotateAt > 0 && G.time > B.rotateAt) { if (hot) pickHold(b, hot); B.rotateAt = -1; B.wantWalk = false; }
      if (hot === B.holdSite && nadeCount(b) && !B.usedUtil) planUtility(b, UTILITY['CT_' + hot]);
      void other;
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
      if (B.retakeVia) { if (navigate(b, dt)) { B.retakeVia = null; setGoal(b, bomb.x, bomb.z, true); } break; }
      // not enough time to defuse: save the gun
      const need = (b.defuser ? KIT_DEFUSE_TIME : DEFUSE_TIME) + Math.hypot(b.x - bomb.x, b.z - bomb.z) / 5;
      if (bomb.timer < need - 0.5 && !b.defusing) { B.plan = 'save'; const s = SPAWN_ZONES.CT; setGoal(b, (s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2, true); break; }
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
    default: break;
  }
  // investigate a recent noise when there is nothing better to do
  const heard = B.heard && G.time - B.heard.t < 3 ? B.heard : null;
  if (heard && (B.plan === 'hold' || B.plan === 'postplant') && heard.kind === 'lost' && Math.random() < dt * 0.15) { setGoal(b, heard.x, heard.z); }
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
